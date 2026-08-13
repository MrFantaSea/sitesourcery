import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";
import { createPostgresProviderReconciliationOperator } from
  "../provider-reconciliation-operator-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL =
  process.env.SITESOURCERY_PG_OPERATOR_RECONCILIATION_TEST_URL;
const { Pool } = pg;

test("operator sees, resolves, replays, and clears one digest-only reconciliation case", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  try {
    const ids = {
      operator: randomUUID(),
      authorizer: randomUUID(),
      operatorOrganization: randomUUID(),
      otherOrganization: randomUUID(),
      case: randomUUID(),
      manualJob: randomUUID()
    };
    await pool.query(
      `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
      [
        ids.operator, `fin004u-operator-${ids.operator}@example.test`,
        ids.authorizer, `fin004u-authorizer-${ids.authorizer}@example.test`
      ]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (user_id, display_name, state)
       values ($1, 'FIN004U Operator', 'active'),
              ($2, 'FIN004U Authorizer', 'active')`,
      [ids.operator, ids.authorizer]
    );
    await pool.query(
      `insert into ss.organizations (
         id, created_by_user_id, name, state
       ) values ($1, $3, 'FIN004U operator', 'active'),
                ($2, $3, 'FIN004U other', 'active')`,
      [ids.operatorOrganization, ids.otherOrganization, ids.authorizer]
    );
    await pool.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
      [ids.operatorOrganization, ids.operator]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id, authorized_at
       ) values ($1, 'FIN004U Operator', 'held', $2, clock_timestamp())`,
      [ids.operator, ids.authorizer]
    );
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state,
         granted_by_user_id, granted_at
       ) values (
         $1, 'service_management_manage', 'held', $2, clock_timestamp()
       )`,
      [ids.operator, ids.authorizer]
    );
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at,
         expires_at, created_at
       ) values (
         $1, 'service_management_manage', 1, 'grant', null,
         'deployment_control', clock_timestamp(),
         clock_timestamp() + interval '1 day', clock_timestamp()
       )`,
      [ids.operator]
    );

    const authority = createCanonicalPostgresAuthority({ pool });
    const subjectDigest = createHash("sha256").update(ids.case).digest("hex");
    const evidenceDigest = "2".repeat(64);
    const resolutionEvidenceDigest = "3".repeat(64);
    const openedAt = new Date().toISOString();
    await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(
        `insert into ss.provider_reconciliation_cases (
           id, provider, case_kind, case_digest,
           subject_phone_number_sid_digest, evidence_digest,
           detected_by_worker_id, readback_state, state, revision,
           opened_at, created_at, updated_at
         ) values (
           $1, 'twilio', 'ambiguous_number_binding',
           ss.provider_reconciliation_case_digest(
             'twilio', 'ambiguous_number_binding', $2
           ), $2, $3, 'fin004u-operator-proof', 'none', 'open', 1,
           $4, $4, $4
         )`,
        [ids.case, subjectDigest, evidenceDigest, openedAt]
      )
    );
    await pool.query(
      `insert into ss.lifecycle_jobs (
         id, organization_id, project_id, job_type, dedupe_key, state,
         run_at, attempt_count, max_attempts, payload, failure_code,
         manual_review_at
       ) values (
         $1, null, null, 'expire_session', $2, 'manual_review',
         clock_timestamp(), 12, 12, '{}'::jsonb,
         'SESSION_EXPIRY_RETRY_EXHAUSTED', clock_timestamp()
       )`,
      [ids.manualJob, `fin004u-manual-${ids.manualJob}`]
    );

    const queue = createPostgresOperatorWorkQueueRepository({ authority });
    const service = createPostgresProviderReconciliationOperator({
      authority,
      clock: () => new Date(),
      randomUUID
    });
    assert.equal((await service.readiness()).ready, true);
    const scope = {
      actorId: ids.operator,
      operatorOrganizationId: ids.operatorOrganization
    };
    await assert.rejects(service.readCase({
      ...scope,
      operatorOrganizationId: ids.otherOrganization,
      caseId: ids.case
    }), (error) => error.code === "OPERATOR_RECONCILIATION_UNAVAILABLE" &&
      error.status === 404);

    const projected = await service.readCase({ ...scope, caseId: ids.case });
    assert.equal(projected.caseKind, "ambiguous_number_binding");
    assert.deepEqual(projected.allowedResolutions, [
      "operator_binding_retired"
    ]);
    assert.equal(projected.providerEffects, false);
    assert.equal(projected.matchedProviderMessageIdDigest, null);
    assert.equal(Object.hasOwn(projected, "phoneNumber"), false);

    const refreshed = await queue.refresh({
      ...scope, observedAt: new Date().toISOString()
    });
    const queued = refreshed.items.find((item) =>
      item.source.table === "ss.provider_reconciliation_cases" &&
      item.source.id === ids.case
    );
    assert.ok(queued);
    assert.equal(queued.kind, "provider_reconciliation_case");
    assert.equal(queued.repair, null);
    const manual = refreshed.items.find((item) =>
      item.source.table === "ss.lifecycle_jobs" &&
      item.source.id === ids.manualJob
    );
    assert.ok(manual);
    assert.equal(manual.kind, "project_lifecycle_manual_review");
    assert.equal(manual.status, "blocked");
    assert.equal(manual.repair, null);

    const input = {
      ...scope,
      caseId: ids.case,
      commandId: `fin004u-resolution-${ids.case}`,
      expectedRevision: projected.revision,
      resolutionKind: "operator_binding_retired",
      evidenceDigest: resolutionEvidenceDigest
    };
    const first = await service.resolveCase(input);
    assert.equal(first.replayed, false);
    assert.equal(first.case.state, "resolved");
    assert.equal(first.providerEffects, false);
    const replay = await service.resolveCase(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.requestDigest, first.requestDigest);
    await assert.rejects(service.resolveCase({
      ...input,
      commandId: `fin004u-resolution-conflict-${ids.case}`
    }), (error) => error.code === "OPERATOR_RECONCILIATION_CONFLICT" &&
      error.status === 409);

    const after = await queue.refresh({
      ...scope, observedAt: new Date().toISOString()
    });
    assert.equal(after.items.some((item) =>
      item.source.table === "ss.provider_reconciliation_cases" &&
      item.source.id === ids.case
    ), false);

    const proof = await pool.query(`
      select
        ss.operator_resolution_surfaces_contract_v1() =
          'canonical-fin-004u-operator-resolution-v1-digest-only-held'
          as contract_ready,
        (select relrowsecurity and relforcerowsecurity
           from pg_class
          where oid =
            'ss.provider_reconciliation_resolution_commands'::regclass)
          as forced_rls,
        not has_table_privilege(
          'authenticated',
          'ss.provider_reconciliation_resolution_commands', 'SELECT'
        ) as authenticated_denied,
        not exists (
          select 1 from information_schema.columns
           where table_schema = 'ss'
             and table_name =
               'provider_reconciliation_resolution_commands'
             and column_name in (
               'raw_payload', 'phone_number', 'message_body',
               'provider_message_id'
             )
        ) as raw_columns_absent
    `);
    for (const [name, ready] of Object.entries(proof.rows[0])) {
      assert.equal(ready, true, `FIN-004U PostgreSQL proof failed: ${name}`);
    }
  } finally {
    await pool.end();
  }
});
