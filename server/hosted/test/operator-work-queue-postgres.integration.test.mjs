import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createOperatorWorkQueue } from "../operator-work-queue.mjs";
import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_OPERATOR_QUEUE_TEST_URL;
const { Pool } = pg;

test("operator queue persists digest-only finalization evidence and refreshes idempotently", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const operatorId = randomUUID();
    const authorizerId = randomUUID();
    const operatorOrganizationId = randomUUID();
    const otherOperatorOrganizationId = randomUUID();
    await pool.query(
      `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
      [
        operatorId, `queue-operator-${operatorId}@example.test`,
        authorizerId, `queue-authorizer-${authorizerId}@example.test`
      ]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (user_id, display_name, state)
       values ($1, 'Queue Operator', 'active'),
              ($2, 'Queue Authorizer', 'active')`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.organizations (
         id, created_by_user_id, name, state
       ) values
         ($1, $3, 'Queue integration operator', 'active'),
         ($2, $3, 'Queue integration cross-scope', 'active')`,
      [operatorOrganizationId, otherOperatorOrganizationId, authorizerId]
    );
    await pool.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
      [operatorOrganizationId, operatorId]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id, authorized_at
       ) values ($1, 'Queue Operator', 'held', $2, clock_timestamp())`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state,
         granted_by_user_id, granted_at
       ) values (
         $1, 'service_management_manage', 'held', $2, clock_timestamp()
       )`,
      [operatorId, authorizerId]
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
      [operatorId]
    );

    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresOperatorWorkQueueRepository({ authority });
    let selectedNow = new Date().toISOString();
    const service = createOperatorWorkQueue({
      repository,
      reversalRepair: {
        async reconcileEvidence() {
          assert.fail("finalization evidence has no repair command");
        }
      },
      clock: { now: () => selectedNow }
    });
    const payloadDigest = "a".repeat(64);
    const evidence = await service.recordInvoiceFinalizationFailure({
      commandId: "pg-invoice-finalization-001",
      providerEventIdDigest: "b".repeat(64),
      invoiceIdDigest: "c".repeat(64),
      payloadDigest,
      signatureVerificationDigest: "d".repeat(64),
      reasonCode: "unknown_review",
      providerCreatedAt: new Date(Date.now() - 60_000).toISOString()
    });
    const replay = await service.recordInvoiceFinalizationFailure({
      commandId: "pg-invoice-finalization-001",
      providerEventIdDigest: "b".repeat(64),
      invoiceIdDigest: "c".repeat(64),
      payloadDigest,
      signatureVerificationDigest: "d".repeat(64),
      reasonCode: "unknown_review",
      providerCreatedAt: evidence.providerCreatedAt
    });
    assert.equal(replay.id, evidence.id);

    const scope = { actorId: operatorId, operatorOrganizationId };
    const crossScope = {
      actorId: operatorId,
      operatorOrganizationId: otherOperatorOrganizationId
    };
    await assert.rejects(
      service.list(crossScope),
      (error) => error.code === "OPERATOR_QUEUE_UNAVAILABLE" &&
        error.status === 404
    );
    await assert.rejects(
      service.refresh(crossScope),
      (error) => error.code === "OPERATOR_QUEUE_UNAVAILABLE" &&
        error.status === 404
    );
    const first = await service.refresh(scope);
    assert.equal(first.items.length, 1);
    assert.deepEqual(first.items[0].source, {
      table: "ss.stripe_invoice_finalization_failures",
      id: evidence.id,
      revision: 1,
      digest: payloadDigest,
      state: "open"
    });
    assert.equal(first.items[0].kind, "invoice_finalization_failure");
    assert.equal(first.items[0].repair, null);
    const revision = first.items[0].revision;
    const itemDigest = first.items[0].digest;

    selectedNow = new Date(Date.now() + 1000).toISOString();
    const second = await service.refresh(scope);
    assert.equal(second.items[0].revision, revision);
    assert.equal(second.items[0].digest, itemDigest);
    assert.deepEqual(await service.list(scope), second);

    const contract = await pool.query(`
      select
        ss.hosted_operator_work_queue_contract_v1() =
          'canonical-operator-work-queue-v1-source-authoritative-held'
          as contract_ready,
        (
          select bool_and(relrowsecurity and relforcerowsecurity)
            from pg_class
           where oid = any(array[
             'ss.operator_work_queue_items'::regclass,
             'ss.stripe_invoice_finalization_failures'::regclass
           ])
        ) as forced_rls,
        not has_table_privilege(
          'authenticated', 'ss.operator_work_queue_items', 'SELECT'
        ) as authenticated_denied,
        not has_table_privilege(
          'service_role', 'ss.operator_work_queue_items',
          'INSERT,UPDATE,DELETE'
        ) as direct_mutation_denied,
        not exists (
          select 1
            from information_schema.columns
           where table_schema = 'ss'
             and table_name in (
               'operator_work_queue_items',
               'stripe_invoice_finalization_failures'
             )
             and column_name in (
               'raw_payload', 'email_address', 'phone_number',
               'message_body', 'provider_error_message'
             )
        ) as unsafe_columns_absent
    `);
    for (const [name, ready] of Object.entries(contract.rows[0])) {
      assert.equal(ready, true, `operator queue PostgreSQL proof failed: ${name}`);
    }
  } finally {
    await pool.end();
  }
});
