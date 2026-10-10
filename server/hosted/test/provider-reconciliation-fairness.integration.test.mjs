import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createFakeResponderProvider, createResponderCore } from "../responder-core.mjs";
import { createPostgresResponderCoreRepository } from "../responder-core-postgres.mjs";
import { createPostgresProviderReconciliationRepository } from "../provider-reconciliation-postgres.mjs";
import { createProviderReconciliationWorker } from "../provider-reconciliation-worker.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { digest } from "../security.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_RECONCILIATION_FAIRNESS_TEST_URL;

async function seed(pool) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    customer: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values ($1,$2),($3,$4),($5,$6)`,
    [
      ids.customer, `rec-customer-${ids.customer}@example.test`,
      ids.operator, `rec-operator-${ids.operator}@example.test`,
      ids.authorizer, `rec-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values ($1,$2, interval '14 days', interval '90 days', clock_timestamp())`,
    [ids.billing, `rec-${ids.billing}`]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name)
     values ($1,$2,'Reconciliation Test')`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1,$2,'owner','active', clock_timestamp()),
              ($1,$3,'owner','active', clock_timestamp())`,
    [ids.organization, ids.customer, ids.operator]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1,$2,$3,$4,'Reconciliation Project')`,
    [ids.project, ids.organization, ids.customer, ids.billing]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1,'Rec Operator','active'),($2,'Rec Authorizer','active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1,'Rec Operator','held',$2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values ($1,'service_management_manage','held',$2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at, expires_at,
       created_at
     ) values ($1,'service_management_manage',1,'grant',null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp())`,
    [ids.operator]
  );
  return ids;
}

test("real PostgreSQL reservations stay fair across expiry, incomplete reads, failures and restarts", {
  skip: !DATABASE_URL
}, async (t) => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  const run = randomUUID();
  const baseNow = new Date().toISOString();
  let observedAt = baseNow;
  let operationTime = baseNow;
  let number = 0;
  const calls = [];
  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = () => createPostgresProviderReconciliationRepository({ authority });
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_reconciliation_fairness_(?:[0-9]+|ci_[0-9]+_[0-9]+)$/u, "dedicated disposable only");
    const ids = await seed(pool);
    const customer = { kind: "customer", userId: ids.customer, organizationId: ids.organization };
    const core = createResponderCore({
      repository: createPostgresResponderCoreRepository({ authority }),
      provider: createFakeResponderProvider(), clock: { now: () => operationTime }
    });
    const advance = (ms = 1000) => {
      observedAt = new Date(Date.parse(observedAt) + ms).toISOString();
    };
    async function cases(count, ageDays = 0) {
      const result = [];
      for (let i = 0; i < count; i += 1) {
        const sequence = ++number;
        operationTime = new Date(Date.parse(baseNow) - ageDays * 86400000 - 60000 + sequence).toISOString();
        const routeDigest = digest({ test: run, sequence });
        const command = (kind) => `fair-${run}-${sequence}-${kind}`;
        const consent = await core.recordConsent(customer, {
          commandId: command("consent"), organizationId: ids.organization,
          projectId: ids.project, customerUserId: ids.customer, routeDigest,
          consentBasis: "inbound_call", consentEvidenceDigest: digest(command("proof")),
          consentedAt: operationTime
        });
        const missed = await core.ingestProviderEvent({
          commandId: command("event"), organizationId: ids.organization, projectId: ids.project,
          providerEventIdDigest: digest(command("provider")), routeDigest,
          eventKind: "missed_call", payloadDigest: digest(command("payload")), occurredAt: operationTime
        });
        await core.reserveHeldMessage(customer, {
          commandId: command("message"), organizationId: ids.organization, projectId: ids.project,
          interactionId: missed.interactionId, contactAuthorityId: consent.id,
          messageKind: "missed_call_ack", contentDigest: digest(command("body"))
        });
        const op = (await pool.query(
          "select id from ss.responder_delivery_operations where command_id = $1",
          [command("message")])).rows[0];
        const id = randomUUID();
        await authority.service({ actorKind: "system" }, client => client.query(`
          insert into ss.provider_reconciliation_cases (
            id, provider, case_kind, case_digest, subject_operation_id,
            subject_operation_attempt, organization_id, project_id, evidence_digest,
            readback_state, state, revision, opened_at, created_at, updated_at
          ) values ($1,'twilio','ambiguous_message_create',
            ss.provider_reconciliation_case_digest('twilio','ambiguous_message_create',$2::text),
            $2::uuid,1,$3,$4,$5,'none','open',1,$6,$6,$6)
        `, [id, op.id, ids.organization, ids.project, digest(command("case")), operationTime]));
        result.push(id);
      }
      return result;
    }
    function worker(response = "not_found", repo = repository()) {
      return createProviderReconciliationWorker({
        repository: repo, enabled: true, clock: { now: () => observedAt },
        readback: {
          providerEffects: false, readOnly: true,
          async readiness() { return { ready: true, verified: true }; },
          async findMessages({ targets }) {
            calls.push(targets[0]);
            if (response === "throw") throw Object.assign(new Error("synthetic read failure"), { code: "TEST_LOOKUP_FAILED" });
            return { results: [{
              targetDigest: digest({ schema: "sitesourcery.twilio-readback-target/v1", ...targets[0] }),
              state: response, matchCount: 0, readbackEvidenceDigest: digest({ test: run, response })
            }] };
          }
        }
      });
    }
    async function unresolved(caseIds) {
      const rows = await pool.query(`select state, readback_state, readback_at,
        readback_evidence_digest, resolution_kind from ss.provider_reconciliation_cases
        where id = any($1::uuid[])`, [caseIds]);
      assert.equal(rows.rowCount, caseIds.length);
      for (const row of rows.rows) assert.deepEqual(row, {
        state: "open", readback_state: "none", readback_at: null,
        readback_evidence_digest: null, resolution_kind: null
      });
    }

    await t.test("eight expired cases rotate durably; ninth current case progresses after worker restart", async () => {
      const old = await cases(8, 15);
      await cases(1);
      const first = await worker().runOnce();
      assert.equal(first.readbacksIncomplete, 8);
      assert.equal(calls.length, 0, "expiry never asks provider or asserts non-delivery");
      advance();
      const second = await worker().runOnce();
      assert.equal(second.readbacksRecorded, 1);
      assert.equal(calls.length, 1);
      await unresolved(old);
    });
    advance();
    await t.test("eight persistently incomplete lookups cannot occupy the next batch", async () => {
      const incomplete = await cases(8);
      await cases(1);
      assert.equal((await worker("incomplete").runOnce()).readbacksIncomplete, 8);
      advance();
      assert.equal((await worker().runOnce()).readbacksRecorded, 1);
      await unresolved(incomplete);
    });
    advance();
    await t.test("reserved batch survives provider failure and a new process reaches the ninth case", async () => {
      const failed = await cases(8);
      await cases(1);
      await assert.rejects(worker("throw").runOnce(), { code: "TEST_LOOKUP_FAILED" });
      advance();
      assert.equal((await worker().runOnce()).readbacksRecorded, 1);
      await unresolved(failed);
    });
    advance();
    await t.test("parallel reservations never overlap and cooldown bounds empty retries", async () => {
      const parallel = await cases(4);
      const selected = await Promise.all([1, 2].map(async () => {
        for (let i = 0; i < 3; i += 1) {
          try { return await repository().claimReadbackCandidates({ limit: 2, observedAt }); }
          catch (error) {
            if (error.code !== "PROVIDER_RECONCILIATION_RETRY_REQUIRED" || i === 2) throw error;
          }
        }
      }));
      const all = selected.flatMap(batch => batch.candidates.map(c => c.caseId));
      assert.equal(all.length, 4);
      assert.equal(new Set(all).size, 4);
      assert.deepEqual(all.toSorted(), parallel.toSorted());
      assert.equal((await repository().claimReadbackCandidates({ limit: 8, observedAt })).candidates.length, 0);
      await unresolved(parallel);
    });
    await t.test("reservation guard preserves authority, immutable evidence and exact revision", async () => {
      const one = (await pool.query(`select id from ss.provider_reconciliation_cases
        where organization_id=$1 and readback_state='none' limit 1`, [ids.organization])).rows[0].id;
      for (const change of ["evidence_digest=repeat('f',64)", "readback_evidence_digest=repeat('f',64)", "revision=revision+2"]) {
        await assert.rejects(authority.service({ actorKind: "system" }, client => client.query(
          `update ss.provider_reconciliation_cases set ${change}, updated_at=$2` +
          (change.startsWith("revision=") ? "" : ", revision=revision+1") + " where id=$1",
          [one, observedAt])), error => ["23514", "55000"].includes(error.code));
      }
      await assert.rejects(authority.service({ actorKind: "customer", userId: ids.customer,
        organizationId: ids.organization }, client => client.query(`update ss.provider_reconciliation_cases
          set revision=revision+1, updated_at=$2 where id=$1`, [one, observedAt])), { code: "42501" });
    });
    await t.test("unknown outcomes become eligible again after bounded cooldown without changing delivery", async () => {
      advance(60000);
      const retry = await repository().claimReadbackCandidates({ limit: 8, observedAt });
      assert.equal(retry.candidates.length, 8);
      await unresolved(retry.candidates.map(c => c.caseId));
      assert.equal((await pool.query(`select count(*)::integer as count
        from ss.responder_delivery_operations where organization_id=$1 and
          (state <> 'held' or provider_effects_authorized or attempt_count <> 0)`, [ids.organization])).rows[0].count, 0);
      assert.equal((await repository().readiness()).ready, true);
    });
  } finally { await pool.end(); }
});


test("populated pre-fairness guard upgrades without changing open or recorded evidence", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const authority = createCanonicalPostgresAuthority({ pool });
  const repo = createPostgresProviderReconciliationRepository({ authority });
  const at = new Date().toISOString();
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_reconciliation_fairness_(?:[0-9]+|ci_[0-9]+_[0-9]+)$/u, "dedicated disposable only");
    const cases = [randomUUID(), randomUUID()];
    for (const id of cases) {
      await authority.service({ actorKind: "system" }, client => client.query(`
        insert into ss.provider_reconciliation_cases (
          id, provider, case_kind, case_digest, subject_provider_message_id_digest,
          evidence_digest, state, opened_at, created_at, updated_at
        ) values ($1,'twilio','unmatched_provider_event',
          ss.provider_reconciliation_case_digest('twilio','unmatched_provider_event',$2),
          $2,$2,'open',$3,$3,$3)
      `, [id, digest(id), at]));
    }
    await repo.recordReadback({ caseId: cases[1], readbackState: "matched",
      readbackEvidenceDigest: digest("upgrade-proof"), matchedProviderMessageIdDigest: digest(cases[1]),
      matchCount: 1, observedAt: at });
    const facts = () => pool.query(`select count(*)::integer as count,
      md5(string_agg(to_jsonb(c)::text, E'\n' order by id)) as digest
      from ss.provider_reconciliation_cases c`);
    const before = (await facts()).rows[0];
    const old = await readFile(new URL("../../data-plane/supabase/migrations/202608120129_provider_reconciliation.sql", import.meta.url), "utf8");
    const start = old.indexOf("create function ss.guard_provider_reconciliation_case()");
    const end = old.indexOf("create trigger provider_reconciliation_cases_guard", start);
    assert.ok(start > 0 && end > start);
    await pool.query(old.slice(start, end).replace("create function", "create or replace function"));
    await pool.query("drop index ss.provider_reconciliation_cases_readback_fair");
    await pool.query("drop function ss.hosted_provider_reconciliation_fairness_contract_v1()");
    assert.equal((await repo.readiness()).ready, false, "unmigrated scheduler stays held");
    const migration = await readFile(new URL("../../data-plane/supabase/migrations/202610090153_provider_reconciliation_fairness.sql", import.meta.url), "utf8");
    await pool.query(migration);
    assert.deepEqual((await facts()).rows[0], before, "migration changes no existing evidence bytes");
    assert.equal((await repo.readiness()).ready, true);
    await assert.rejects(authority.service({ actorKind: "system" }, client => client.query(`
      update ss.provider_reconciliation_cases set updated_at=$2, revision=revision+1 where id=$1
    `, [cases[1], at])), { code: "23514" }, "final readback cannot be reserved or rewritten");
  } finally { await pool.end(); }
});
