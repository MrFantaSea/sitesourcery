import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PURPOSE = "project-lifecycle";
const WORKER = /^project-lifecycle-[A-Za-z0-9.-]{8,160}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const JOBS = new Set([
  "retention_expiry", "unpublish_project", "delete_blob", "finalize_deletion"
]);
const RESULTS = Object.freeze({
  approval_required: "manual_review",
  publication_removed: "succeeded",
  blob_deleted: "succeeded",
  project_deleted: "succeeded"
});

function exactInstant(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "PROJECT_LIFECYCLE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function claim(row) {
  invariant(
    UUID.test(row.id) && JOBS.has(row.job_type) &&
      WORKER.test(row.locked_by) && Number(row.lease_fence) > 0,
    "PROJECT_LIFECYCLE_REPOSITORY_INVALID",
    "The project lifecycle claim is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    schema: "sitesourcery.project-lifecycle-claim/v1",
    jobId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    jobType: row.job_type,
    payload: structuredClone(row.payload),
    attemptCount: Number(row.attempt_count),
    fence: Number(row.lease_fence),
    leaseExpiresAt: exactInstant(row.lease_expires_at, "Lease expiration")
  });
}

export function createPostgresProjectLifecycleRepository({ authority } = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "PROJECT_LIFECYCLE_CONFIGURATION_REQUIRED",
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
            to_regclass('ss.project_lifecycle_job_receipts') is not null
              as receipts_ready,
            (select count(*)::integer
               from ss.artifact_replicas replica
              where replica.deleted_at is null) as external_replicas
        `)
      );
      const row = result.rows[0] ?? {};
      const ready = row.contract_ready === true && row.receipts_ready === true;
      return Object.freeze({
        ready,
        verified: ready,
        kind: `${PURPOSE}-postgres`,
        externalReplicas: Number(row.external_replicas ?? 0),
        providerEffects: false,
        destructiveEffects: "owner-approved-jobs-only",
        code: ready ? null : "PROJECT_LIFECYCLE_STORAGE_NOT_READY"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        kind: `${PURPOSE}-postgres`,
        externalReplicas: 0,
        providerEffects: false,
        destructiveEffects: "owner-approved-jobs-only",
        code: "PROJECT_LIFECYCLE_STORAGE_NOT_READY"
      });
    }
  }

  async function claimNext({ workerId, observedAt, leaseSeconds } = {}) {
    invariant(WORKER.test(workerId ?? ""), "PROJECT_LIFECYCLE_INVALID",
      "Project lifecycle worker ID is invalid.", { status: 400 });
    const at = exactInstant(observedAt, "Claim time");
    invariant(Number.isSafeInteger(leaseSeconds) && leaseSeconds >= 30 && leaseSeconds <= 300,
      "PROJECT_LIFECYCLE_INVALID", "Project lifecycle lease is invalid.",
      { status: 400 });
    const result = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(`
          update ss.lifecycle_jobs
             set state = case when attempt_count >= max_attempts
                   then 'dead_letter' else 'failed' end,
                 run_at = $1,
                 failure_code = 'PROJECT_LIFECYCLE_LEASE_EXPIRED',
                 manual_review_at = case when attempt_count >= max_attempts
                   then $1::timestamptz else null::timestamptz end
           where state = 'running'
             and job_type = any($2::text[])
             and lease_expires_at <= $1
        `, [at, [...JOBS]]);
        return client.query(`
          with selected as (
            select id
              from ss.lifecycle_jobs
             where job_type = any($2::text[])
               and state in ('scheduled', 'failed')
               and run_at <= $1
               and attempt_count < max_attempts
             order by run_at,
               case job_type
                 when 'retention_expiry' then 1
                 when 'unpublish_project' then 2
                 when 'delete_blob' then 3
                 when 'finalize_deletion' then 4
                 else 9
               end,
               id
             for update skip locked
             limit 1
          )
          update ss.lifecycle_jobs job
             set state = 'running', attempt_count = job.attempt_count + 1,
                 lease_fence = job.lease_fence + 1,
                 locked_by = $3, locked_at = $1,
                 lease_expires_at = $1 + make_interval(secs => $4),
                 failure_code = null, last_error = null,
                 manual_review_at = null
            from selected
           where job.id = selected.id
          returning job.*
        `, [at, [...JOBS], workerId, leaseSeconds]);
      }
    );
    return result.rowCount === 0 ? null : claim(result.rows[0]);
  }

  async function completeClaim({
    jobId, fence, workerId, observedAt, result
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && result &&
        Object.hasOwn(RESULTS, result.receiptKind),
      "PROJECT_LIFECYCLE_INVALID",
      "Project lifecycle completion is invalid.",
      { status: 400 }
    );
    const at = exactInstant(observedAt, "Completion time");
    const located = await authority.service(
      { actorKind: "system", readOnly: true },
      (client) => client.query(
        `select * from ss.lifecycle_jobs where id = $1`,
        [jobId]
      )
    );
    invariant(located.rowCount === 1, "PROJECT_LIFECYCLE_NOT_FOUND",
      "Project lifecycle job was not found.", { status: 404 });
    const row = located.rows[0];
    return authority.service({
      actorKind: "system",
      organizationId: row.organization_id,
      isolation: "serializable"
    }, async (client) => {
      const locked = await client.query(
        `select * from ss.lifecycle_jobs
          where id = $1 and state = 'running' and locked_by = $2
            and lease_fence = $3 and lease_expires_at > $4
          for update`,
        [jobId, workerId, fence, at]
      );
      invariant(locked.rowCount === 1, "PROJECT_LIFECYCLE_LEASE_LOST",
        "Project lifecycle lease is no longer current.", { status: 409 });
      const job = locked.rows[0];
      invariant(
        (job.job_type === "retention_expiry" && result.receiptKind === "approval_required") ||
          (job.job_type === "unpublish_project" && result.receiptKind === "publication_removed") ||
          (job.job_type === "delete_blob" && result.receiptKind === "blob_deleted") ||
          (job.job_type === "finalize_deletion" && result.receiptKind === "project_deleted"),
        "PROJECT_LIFECYCLE_RESULT_INVALID",
        "Project lifecycle result does not match its allowlisted job.",
        { status: 409 }
      );
      if (job.job_type === "finalize_deletion") {
        const pending = await client.query(`
          select count(*)::integer as count
            from ss.lifecycle_jobs
           where project_id = $1
             and job_type in ('unpublish_project', 'delete_blob')
             and state <> 'succeeded'
        `, [job.project_id]);
        invariant(
          Number(pending.rows[0].count) === 0,
          "PROJECT_LIFECYCLE_DEPENDENCY_PENDING",
          "Project publication or object deletion is not complete.",
          { status: 409 }
        );
        await client.query("select ss.finalize_terminal_project_purge($1)", [job.project_id]);
      } else {
        await client.query(`
          update ss.lifecycle_jobs
             set state = $2, completed_at = case when $2 = 'succeeded'
                   then $3::timestamptz else null::timestamptz end,
                 manual_review_at = case when $2 = 'manual_review'
                   then $3::timestamptz else null::timestamptz end,
                 failure_code = case when $2 = 'manual_review'
                   then 'PROJECT_DELETION_APPROVAL_REQUIRED' else null end
           where id = $1 and state = 'running'
        `, [jobId, RESULTS[result.receiptKind], at]);
      }
      const resultDigest = digest({
        schema: "sitesourcery.project-lifecycle-result/v1",
        jobId,
        fence,
        receiptKind: result.receiptKind,
        result: result.result ?? null,
        recordedAt: at
      });
      await client.query(`
        insert into ss.project_lifecycle_job_receipts (
          organization_id, project_id, lifecycle_job_id, lease_fence,
          receipt_kind, result_digest, recorded_at
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (lifecycle_job_id) do nothing
      `, [
        job.organization_id, job.project_id, jobId, fence,
        result.receiptKind, resultDigest, at
      ]);
      return Object.freeze({
        status: RESULTS[result.receiptKind],
        jobId,
        receiptKind: result.receiptKind,
        resultDigest
      });
    });
  }

  async function releaseClaim({
    jobId, fence, workerId, failureCode, observedAt, retryAt
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && CODE.test(failureCode ?? ""),
      "PROJECT_LIFECYCLE_INVALID",
      "Project lifecycle release is invalid.",
      { status: 400 }
    );
    const at = exactInstant(observedAt, "Failure time");
    const retry = exactInstant(retryAt, "Retry time");
    const result = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.lifecycle_jobs
           set state = case when attempt_count >= max_attempts
                 then 'dead_letter' else 'failed' end,
               run_at = $5, failure_code = $4, last_error = $4,
               manual_review_at = case when attempt_count >= max_attempts
                 then $6::timestamptz else null::timestamptz end
         where id = $1 and state = 'running' and locked_by = $2
           and lease_fence = $3 and lease_expires_at > $6
        returning state
      `, [jobId, workerId, fence, failureCode, retry, at])
    );
    invariant(result.rowCount === 1, "PROJECT_LIFECYCLE_LEASE_LOST",
      "Project lifecycle lease is no longer current.", { status: 409 });
    return Object.freeze({ status: result.rows[0].state, jobId });
  }

  return Object.freeze({
    kind: `${PURPOSE}-postgres`,
    readiness,
    claimNext,
    completeClaim,
    releaseClaim
  });
}

export function createProjectLifecycleExecutor({ objectStore, publicationPort } = {}) {
  invariant(
    objectStore && typeof objectStore.delete === "function" &&
      publicationPort && typeof publicationPort.unpublish === "function",
    "PROJECT_LIFECYCLE_CONFIGURATION_REQUIRED",
    "The project lifecycle object deletion port is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: false,
    async readiness() {
      return Object.freeze({ ready: true, verified: true, providerEffects: false });
    },
    async execute(selected) {
      if (selected.jobType === "retention_expiry") {
        return Object.freeze({
          receiptKind: "approval_required",
          result: { destructiveApproval: "required" }
        });
      }
      if (selected.jobType === "finalize_deletion") {
        return Object.freeze({
          receiptKind: "project_deleted",
          result: { databaseFinalization: "required" }
        });
      }
      if (selected.jobType === "unpublish_project") {
        invariant(
          typeof selected.payload?.hostname === "string",
          "PROJECT_LIFECYCLE_JOB_INVALID",
          "The publication lifecycle job is invalid.",
          { status: 409 }
        );
        const unpublished = await publicationPort.unpublish({
          projectId: selected.projectId,
          hostname: selected.payload.hostname
        });
        invariant(
          unpublished?.published === false,
          "PROJECT_LIFECYCLE_EFFECT_UNCONFIRMED",
          "Project publication removal was not confirmed.",
          { status: 503 }
        );
        return Object.freeze({
          receiptKind: "publication_removed",
          result: { unpublished: true }
        });
      }
      invariant(
        selected.jobType === "delete_blob" &&
          typeof selected.payload?.objectKey === "string",
        "PROJECT_LIFECYCLE_JOB_INVALID",
        "The project lifecycle job is not allowlisted.",
        { status: 409 }
      );
      const deleted = await objectStore.delete({ key: selected.payload.objectKey });
      return Object.freeze({
        receiptKind: "blob_deleted",
        result: { deleted: deleted?.deleted === true }
      });
    }
  });
}
