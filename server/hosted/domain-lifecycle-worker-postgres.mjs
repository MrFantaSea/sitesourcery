import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PURPOSE = "domain-lifecycle";
const WORKER = /^domain-lifecycle-[A-Za-z0-9.-]{8,160}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function instant(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "DOMAIN_LIFECYCLE_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function selectedClaim(row) {
  invariant(
    UUID.test(row.id) && UUID.test(row.lifecycle_state_id) &&
      row.action === "refresh_authoritative" && WORKER.test(row.leased_by),
    "DOMAIN_LIFECYCLE_WORKER_REPOSITORY_INVALID",
    "The Domain lifecycle claim is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    schema: "sitesourcery.domain-lifecycle-worker-claim/v1",
    jobId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    lifecycleStateId: row.lifecycle_state_id,
    action: row.action,
    lifecycle: structuredClone(row.state_document),
    attemptCount: Number(row.attempt_count),
    fence: Number(row.lease_fence),
    leaseExpiresAt: instant(row.lease_expires_at, "Domain lifecycle lease expiration")
  });
}

export function createPostgresDomainLifecycleWorkerRepository({ authority } = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const result = await authority.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(`
          select
            ss.worker_lifecycle_closure_contract_v1() =
              'canonical-fin-004t-project-domain-care-leases-v1-held'
              as contract_ready,
            to_regclass('ss.domain_lifecycle_worker_jobs') is not null
              as jobs_ready
        `)
      );
      const row = result.rows[0] ?? {};
      const ready = row.contract_ready === true && row.jobs_ready === true;
      return Object.freeze({
        ready,
        verified: ready,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        readbackOnly: true,
        code: ready ? null : "DOMAIN_LIFECYCLE_WORKER_STORAGE_NOT_READY"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        readbackOnly: true,
        code: "DOMAIN_LIFECYCLE_WORKER_STORAGE_NOT_READY"
      });
    }
  }

  async function claimNext({ workerId, observedAt, leaseSeconds } = {}) {
    invariant(WORKER.test(workerId ?? ""), "DOMAIN_LIFECYCLE_WORKER_INVALID",
      "Domain lifecycle worker ID is invalid.", { status: 400 });
    const at = instant(observedAt, "Domain lifecycle claim time");
    invariant(Number.isSafeInteger(leaseSeconds) && leaseSeconds >= 30 && leaseSeconds <= 300,
      "DOMAIN_LIFECYCLE_WORKER_INVALID", "Domain lifecycle lease is invalid.",
      { status: 400 });
    const result = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(`
          update ss.domain_lifecycle_worker_jobs
             set state = case when attempt_count >= max_attempts
                   then 'dead_letter' else 'failed' end,
                 run_at = $1,
                 failure_code = 'DOMAIN_LIFECYCLE_LEASE_EXPIRED',
                 manual_review_at = case when attempt_count >= max_attempts
                   then $1::timestamptz else null::timestamptz end,
                 leased_by = null, leased_at = null, lease_expires_at = null,
                 updated_at = $1
           where state = 'running' and lease_expires_at <= $1
        `, [at]);
        return client.query(`
          with selected as (
            select id
              from ss.domain_lifecycle_worker_jobs
             where state in ('scheduled', 'failed') and run_at <= $1
               and attempt_count < max_attempts
             order by run_at, id
             for update skip locked
             limit 1
          )
          update ss.domain_lifecycle_worker_jobs job
             set state = 'running', attempt_count = job.attempt_count + 1,
                 lease_fence = job.lease_fence + 1,
                 leased_by = $2, leased_at = $1,
                 lease_expires_at = $1 + make_interval(secs => $3),
                 failure_code = null, manual_review_at = null,
                 updated_at = $1
            from selected, ss.domain_provider_lifecycle_states lifecycle
           where job.id = selected.id
             and lifecycle.id = job.lifecycle_state_id
          returning job.*, lifecycle.state_document
        `, [at, workerId, leaseSeconds]);
      }
    );
    return result.rowCount === 0 ? null : selectedClaim(result.rows[0]);
  }

  async function completeClaim({
    jobId, fence, workerId, observedAt, result
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && result &&
        ["lifecycle_refreshed", "manual_review"].includes(result.receiptKind),
      "DOMAIN_LIFECYCLE_WORKER_INVALID",
      "Domain lifecycle completion is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Domain lifecycle completion time");
    const resultDigest = digest({
      schema: "sitesourcery.domain-lifecycle-worker-result/v1",
      jobId,
      fence,
      receiptKind: result.receiptKind,
      result: result.result ?? null,
      recordedAt: at
    });
    const manual = result.receiptKind === "manual_review";
    const terminal = result.result?.terminal === true;
    const updated = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.domain_lifecycle_worker_jobs
           set state = case when $5 then 'manual_review'
                            when $6 then 'succeeded'
                            else 'scheduled' end,
               run_at = case when not $5 and not $6
                         then $4::timestamptz + interval '1 day'
                         else run_at end,
               result_digest = $7,
               completed_at = case when $6 then $4::timestamptz else null end,
               manual_review_at = case when $5 then $4::timestamptz else null end,
               failure_code = case when $5
                 then 'DOMAIN_LIFECYCLE_MANUAL_REVIEW' else null end,
               leased_by = null, leased_at = null, lease_expires_at = null,
               updated_at = $4
         where id = $1 and state = 'running' and leased_by = $2
           and lease_fence = $3 and lease_expires_at > $4
        returning state
      `, [jobId, workerId, fence, at, manual, terminal, resultDigest])
    );
    invariant(updated.rowCount === 1, "DOMAIN_LIFECYCLE_WORKER_LEASE_LOST",
      "Domain lifecycle lease is no longer current.", { status: 409 });
    return Object.freeze({
      status: manual ? "manual_review" : "completed",
      jobId,
      resultDigest
    });
  }

  async function releaseClaim({
    jobId, fence, workerId, failureCode, observedAt, retryAt
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && CODE.test(failureCode ?? ""),
      "DOMAIN_LIFECYCLE_WORKER_INVALID",
      "Domain lifecycle release is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Domain lifecycle failure time");
    const retry = instant(retryAt, "Domain lifecycle retry time");
    const updated = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.domain_lifecycle_worker_jobs
           set state = case when attempt_count >= max_attempts
                 then 'dead_letter' else 'failed' end,
               run_at = $5, failure_code = $4,
               manual_review_at = case when attempt_count >= max_attempts
                 then $6::timestamptz else null::timestamptz end,
               leased_by = null, leased_at = null, lease_expires_at = null,
               updated_at = $6
         where id = $1 and state = 'running' and leased_by = $2
           and lease_fence = $3 and lease_expires_at > $6
        returning state
      `, [jobId, workerId, fence, failureCode, retry, at])
    );
    invariant(updated.rowCount === 1, "DOMAIN_LIFECYCLE_WORKER_LEASE_LOST",
      "Domain lifecycle lease is no longer current.", { status: 409 });
    return Object.freeze({
      status: updated.rows[0].state === "dead_letter" ? "manual_review" : "released",
      jobId
    });
  }

  return Object.freeze({
    kind: `${PURPOSE}-postgres`,
    readiness,
    claimNext,
    completeClaim,
    releaseClaim
  });
}
