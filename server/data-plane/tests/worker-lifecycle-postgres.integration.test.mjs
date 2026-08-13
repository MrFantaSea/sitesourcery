import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createPostgresCareCoreRepository } from
  "../../hosted/care-core-postgres.mjs";
import {
  createCareLifecycleExecutor,
  createPostgresCareLifecycleWorkerRepository
} from "../../hosted/care-lifecycle-worker-postgres.mjs";
import {
  createPostgresDomainLifecycleWorkerRepository
} from "../../hosted/domain-lifecycle-worker-postgres.mjs";
import { createLeasedLifecycleWorker } from
  "../../hosted/leased-lifecycle-worker.mjs";
import { createPostgresProjectLifecycleRepository } from
  "../../hosted/project-lifecycle-postgres.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";

const url = process.env.SITESOURCERY_PG_MIGRATION_TEST_URL;
const enabled = typeof url === "string" && url.length > 0;
const { Pool } = pg;

function executor(purpose, execute) {
  return Object.freeze({
    kind: `${purpose}-executor`,
    async readiness() { return { ready: true, verified: true }; },
    execute
  });
}

test("FIN-004T project, Domain, and Care leases persist on real PostgreSQL", {
  skip: !enabled
}, async () => {
  const pool = new Pool({ connectionString: url, max: 4 });
  const authority = createCanonicalPostgresAuthority({ pool });
  try {
    await pool.query(`
      delete from ss.project_lifecycle_job_receipts receipt
       where receipt.lifecycle_job_id in (
         select id from ss.lifecycle_jobs
          where dedupe_key like 'fin004t-retention:%'
       )
    `);
    await pool.query(`
      delete from ss.lifecycle_jobs
       where dedupe_key like 'fin004t-retention:%'
    `);
    const projectRow = (await pool.query(`
      select organization_id, id
        from ss.projects
       where lifecycle = 'active'
       order by created_at, id
       limit 1
    `)).rows[0];
    assert.ok(projectRow);
    const projectJobId = randomUUID();
    await pool.query(`
      insert into ss.lifecycle_jobs (
        id, organization_id, project_id, job_type, dedupe_key, state,
        run_at, payload
      ) values ($1, $2, $3, 'retention_expiry', $4, 'scheduled', $5,
        jsonb_build_object('projectId', $3::uuid))
    `, [
      projectJobId,
      projectRow.organization_id,
      projectRow.id,
      `fin004t-retention:${projectJobId}`,
      "2026-08-13T12:00:00.000Z"
    ]);
    const projectWorker = createLeasedLifecycleWorker({
      purpose: "project-lifecycle",
      repository: createPostgresProjectLifecycleRepository({ authority }),
      executor: executor("project-lifecycle", async () => ({
        receiptKind: "approval_required",
        result: { destructiveApproval: "required" }
      })),
      clock: { now: () => "2026-08-13T12:00:01.000Z" },
      enabled: true,
      workerId: "project-lifecycle-real-postgres",
      intervalMs: 1_000,
      errorBackoffMs: 100,
      maximumBackoffMs: 1_000,
      batchLimit: 1,
      leaseSeconds: 60
    });
    const projectResult = await projectWorker.runOnce();
    assert.equal(projectResult.manualReview, 1);
    const retainedProject = (await pool.query(`
      select job.state, job.failure_code, receipt.receipt_kind
        from ss.lifecycle_jobs job
        join ss.project_lifecycle_job_receipts receipt
          on receipt.lifecycle_job_id = job.id
       where job.id = $1
    `, [projectJobId])).rows[0];
    assert.deepEqual(retainedProject, {
      state: "manual_review",
      failure_code: "PROJECT_DELETION_APPROVAL_REQUIRED",
      receipt_kind: "approval_required"
    });

    const domainJob = (await pool.query(`
      update ss.domain_lifecycle_worker_jobs
         set state = 'scheduled', run_at = $1, completed_at = null,
             manual_review_at = null, leased_by = null, leased_at = null,
             lease_expires_at = null
       where id = (
         select id from ss.domain_lifecycle_worker_jobs order by id limit 1
       )
      returning id
    `, ["2026-08-13T12:00:00.000Z"])).rows[0];
    assert.ok(domainJob);
    const domainWorker = createLeasedLifecycleWorker({
      purpose: "domain-lifecycle",
      repository: createPostgresDomainLifecycleWorkerRepository({ authority }),
      executor: executor("domain-lifecycle", async (claim) => ({
        receiptKind: "lifecycle_refreshed",
        result: {
          lifecycleStateId: claim.lifecycleStateId,
          terminal: false,
          providerEffects: false
        }
      })),
      clock: { now: () => "2026-08-13T12:00:01.000Z" },
      enabled: true,
      workerId: "domain-lifecycle-real-postgres",
      intervalMs: 1_000,
      errorBackoffMs: 100,
      maximumBackoffMs: 1_000,
      batchLimit: 1,
      leaseSeconds: 60
    });
    assert.equal((await domainWorker.runOnce()).completed, 1);
    const retainedDomain = (await pool.query(`
      select state, run_at > $2::timestamptz as rescheduled,
             result_digest is not null as receipt
        from ss.domain_lifecycle_worker_jobs where id = $1
    `, [domainJob.id, "2026-08-13T12:00:01.000Z"])).rows[0];
    assert.deepEqual(retainedDomain, {
      state: "scheduled",
      rescheduled: true,
      receipt: true
    });

    const openCare = (await pool.query(`
      select job.id, period.ends_on::text as ends_on
        from ss.care_lifecycle_worker_jobs job
        join ss.care_periods period on period.id = job.period_id
       where period.state = 'open'
       order by period.ends_on, job.id
       limit 1
    `)).rows[0];
    assert.ok(openCare);
    await pool.query(`
      update ss.care_lifecycle_worker_jobs
         set run_at = case when id = $1 then $2::timestamptz
                           else '2999-01-01T00:00:00.000Z'::timestamptz end,
             state = 'scheduled', completed_at = null, manual_review_at = null,
             leased_by = null, leased_at = null, lease_expires_at = null
       where state in ('scheduled', 'failed', 'succeeded')
    `, [openCare.id, `${openCare.ends_on}T00:00:00.000Z`]);
    const careClock = new Date(
      Date.parse(`${openCare.ends_on}T00:00:00.000Z`) + 1_000
    ).toISOString();
    const careWorker = createLeasedLifecycleWorker({
      purpose: "care-lifecycle",
      repository: createPostgresCareLifecycleWorkerRepository({ authority }),
      executor: createCareLifecycleExecutor({
        careRepository: createPostgresCareCoreRepository({ authority })
      }),
      clock: { now: () => careClock },
      enabled: true,
      workerId: "care-lifecycle-real-postgres",
      intervalMs: 1_000,
      errorBackoffMs: 100,
      maximumBackoffMs: 1_000,
      batchLimit: 1,
      leaseSeconds: 60
    });
    assert.equal((await careWorker.runOnce()).completed, 1);
    const retainedCare = (await pool.query(`
      select job.state, prior.state as prior_state,
             next.id is not null as next_opened,
             next.carried_from_period_id is null
               or next.carried_from_period_id = prior.id as rollover_bound
        from ss.care_lifecycle_worker_jobs job
        join ss.care_periods prior on prior.id = job.period_id
        left join ss.care_periods next on next.id = job.next_period_id
       where job.id = $1
    `, [openCare.id])).rows[0];
    assert.deepEqual(retainedCare, {
      state: "succeeded",
      prior_state: "closed",
      next_opened: true,
      rollover_bound: true
    });
  } finally {
    await authority.close();
  }
});
