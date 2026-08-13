import { randomUUID } from "node:crypto";

import { createCarePeriodClose, createCarePeriodOpen } from "./care-core.mjs";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PURPOSE = "care-lifecycle";
const WORKER = /^care-lifecycle-[A-Za-z0-9.-]{8,160}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function instant(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "CARE_LIFECYCLE_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function date(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function nextCalendarMonth(value) {
  const selected = new Date(`${value}T00:00:00.000Z`);
  const targetMonth = selected.getUTCMonth() + 1;
  const year = selected.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(selected.getUTCDate(), lastDay)
  )).toISOString().slice(0, 10);
}

function selectedClaim(row) {
  invariant(
    UUID.test(row.id) && UUID.test(row.period_id) &&
      UUID.test(row.next_period_id) && row.action === "advance_period" &&
      WORKER.test(row.leased_by),
    "CARE_LIFECYCLE_WORKER_REPOSITORY_INVALID",
    "The Care lifecycle claim is invalid.",
    { status: 500 }
  );
  const startsOn = date(row.ends_on);
  return Object.freeze({
    schema: "sitesourcery.care-lifecycle-worker-claim/v1",
    jobId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    contractId: row.contract_id,
    periodId: row.period_id,
    nextPeriodId: row.next_period_id,
    action: row.action,
    currentPeriod: Object.freeze({
      state: row.period_state,
      revision: Number(row.period_revision),
      providerScopeDigest: row.provider_scope_digest,
      includedUnits: Number(row.included_units),
      usedIncludedUnits: Number(row.used_included_units),
      endsOn: startsOn
    }),
    nextPeriod: Object.freeze({
      startsOn,
      endsOn: nextCalendarMonth(startsOn),
      includedUnits: Number(row.included_units),
      carriedUnits: Math.max(
        Number(row.included_units) - Number(row.used_included_units),
        0
      ),
      providerPeriodKey: `care.period.${row.contract_id}.${startsOn}`
    }),
    attemptCount: Number(row.attempt_count),
    fence: Number(row.lease_fence),
    leaseExpiresAt: instant(row.lease_expires_at, "Care lifecycle lease expiration")
  });
}

export function createPostgresCareLifecycleWorkerRepository({ authority } = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "CARE_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
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
            to_regclass('ss.care_lifecycle_worker_jobs') is not null
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
        paymentEffects: false,
        code: ready ? null : "CARE_LIFECYCLE_WORKER_STORAGE_NOT_READY"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        paymentEffects: false,
        code: "CARE_LIFECYCLE_WORKER_STORAGE_NOT_READY"
      });
    }
  }

  async function claimNext({ workerId, observedAt, leaseSeconds } = {}) {
    invariant(WORKER.test(workerId ?? ""), "CARE_LIFECYCLE_WORKER_INVALID",
      "Care lifecycle worker ID is invalid.", { status: 400 });
    const at = instant(observedAt, "Care lifecycle claim time");
    invariant(Number.isSafeInteger(leaseSeconds) && leaseSeconds >= 30 && leaseSeconds <= 300,
      "CARE_LIFECYCLE_WORKER_INVALID", "Care lifecycle lease is invalid.",
      { status: 400 });
    const nextPeriodId = randomUUID();
    const result = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(`
          update ss.care_lifecycle_worker_jobs
             set state = case when attempt_count >= max_attempts
                   then 'dead_letter' else 'failed' end,
                 run_at = $1,
                 failure_code = 'CARE_LIFECYCLE_LEASE_EXPIRED',
                 manual_review_at = case when attempt_count >= max_attempts
                   then $1::timestamptz else null::timestamptz end,
                 leased_by = null, leased_at = null, lease_expires_at = null,
                 updated_at = $1
           where state = 'running' and lease_expires_at <= $1
        `, [at]);
        return client.query(`
          with selected as (
            select id
              from ss.care_lifecycle_worker_jobs
             where state in ('scheduled', 'failed') and run_at <= $1
               and attempt_count < max_attempts
             order by run_at, id
             for update skip locked
             limit 1
          )
          update ss.care_lifecycle_worker_jobs job
             set state = 'running', attempt_count = job.attempt_count + 1,
                 lease_fence = job.lease_fence + 1,
                 leased_by = $2, leased_at = $1,
                 lease_expires_at = $1 + make_interval(secs => $3),
                 next_period_id = coalesce(job.next_period_id, $4),
                 failure_code = null, manual_review_at = null,
                 updated_at = $1
            from selected, ss.care_periods period
           where job.id = selected.id and period.id = job.period_id
          returning job.*, period.state as period_state,
            period.revision as period_revision,
            period.provider_scope_digest, period.included_units,
            period.ends_on,
            (select coalesce(sum(entry.units), 0)::integer
               from ss.care_capacity_entries entry
              where entry.period_id = period.id
                and entry.capacity_source = 'included') as used_included_units
        `, [at, workerId, leaseSeconds, nextPeriodId]);
      }
    );
    return result.rowCount === 0 ? null : selectedClaim(result.rows[0]);
  }

  async function completeClaim({
    jobId, fence, workerId, observedAt, result
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && result?.receiptKind === "period_advanced",
      "CARE_LIFECYCLE_WORKER_INVALID",
      "Care lifecycle completion is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Care lifecycle completion time");
    const resultDigest = digest({
      schema: "sitesourcery.care-lifecycle-worker-result/v1",
      jobId,
      fence,
      receiptKind: result.receiptKind,
      result: result.result ?? null,
      recordedAt: at
    });
    const updated = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.care_lifecycle_worker_jobs
           set state = 'succeeded', result_digest = $5, completed_at = $4,
               failure_code = null, leased_by = null, leased_at = null,
               lease_expires_at = null, updated_at = $4
         where id = $1 and state = 'running' and leased_by = $2
           and lease_fence = $3 and lease_expires_at > $4
        returning id
      `, [jobId, workerId, fence, at, resultDigest])
    );
    invariant(updated.rowCount === 1, "CARE_LIFECYCLE_WORKER_LEASE_LOST",
      "Care lifecycle lease is no longer current.", { status: 409 });
    return Object.freeze({ status: "completed", jobId, resultDigest });
  }

  async function releaseClaim({
    jobId, fence, workerId, failureCode, observedAt, retryAt
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && CODE.test(failureCode ?? ""),
      "CARE_LIFECYCLE_WORKER_INVALID",
      "Care lifecycle release is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Care lifecycle failure time");
    const retry = instant(retryAt, "Care lifecycle retry time");
    const updated = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.care_lifecycle_worker_jobs
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
    invariant(updated.rowCount === 1, "CARE_LIFECYCLE_WORKER_LEASE_LOST",
      "Care lifecycle lease is no longer current.", { status: 409 });
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

export function createCareLifecycleExecutor({ careRepository } = {}) {
  invariant(
    careRepository && typeof careRepository.readiness === "function" &&
      typeof careRepository.closePeriod === "function" &&
      typeof careRepository.openPeriod === "function",
    "CARE_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "The canonical Care repository is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: false,
    paymentEffects: false,
    async readiness() {
      const ready = await careRepository.readiness();
      return Object.freeze({
        ready: ready?.ready === true && ready?.verified === true,
        verified: ready?.ready === true && ready?.verified === true,
        providerEffects: false,
        paymentEffects: false
      });
    },
    async execute(claim) {
      invariant(
        claim?.action === "advance_period",
        "CARE_LIFECYCLE_WORKER_JOB_INVALID",
        "The Care lifecycle action is not allowlisted.",
        { status: 409 }
      );
      const recordedAt = `${claim.currentPeriod.endsOn}T00:00:00.000Z`;
      const actor = {
        actorKind: "system",
        actorId: null,
        organizationId: claim.organizationId
      };
      await careRepository.closePeriod(createCarePeriodClose({
        actor,
        commandId: `care.lifecycle.close.${claim.periodId}`,
        recordedAt,
        periodId: claim.periodId,
        projectId: claim.projectId,
        expectedRevision: claim.currentPeriod.revision
      }));
      const carriedUnits = claim.nextPeriod.carriedUnits;
      const opened = await careRepository.openPeriod(createCarePeriodOpen({
        actor,
        commandId: `care.lifecycle.open.${claim.nextPeriodId}`,
        recordedAt,
        periodId: claim.nextPeriodId,
        contractId: claim.contractId,
        projectId: claim.projectId,
        providerScopeDigest: claim.currentPeriod.providerScopeDigest,
        providerPeriodKey: claim.nextPeriod.providerPeriodKey,
        startsOn: claim.nextPeriod.startsOn,
        endsOn: claim.nextPeriod.endsOn,
        includedUnits: claim.nextPeriod.includedUnits,
        carriedUnits,
        carriedFromPeriodId: carriedUnits === 0 ? null : claim.periodId
      }));
      return Object.freeze({
        receiptKind: "period_advanced",
        result: {
          priorPeriodId: claim.periodId,
          nextPeriodId: opened.id,
          carriedUnits,
          providerEffects: false,
          paymentEffects: false
        }
      });
    }
  });
}
