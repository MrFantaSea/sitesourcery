import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createFakeResponderProvider,
  createResponderCore
} from "../responder-core.mjs";
import { createPostgresResponderCoreRepository } from
  "../responder-core-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_RESPONDER_CORE_TEST_URL;
const { Pool } = pg;

async function seed(pool) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    billing2: randomUUID(),
    customer: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    organization2: randomUUID(),
    outsider: randomUUID(),
    project: randomUUID(),
    project2: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
    [
      ids.customer, `responder-customer-${ids.customer}@example.test`,
      ids.outsider, `responder-outsider-${ids.outsider}@example.test`,
      ids.operator, `responder-operator-${ids.operator}@example.test`,
      ids.authorizer, `responder-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values
       ($1, $2, interval '14 days', interval '90 days', clock_timestamp()),
       ($3, $4, interval '14 days', interval '90 days', clock_timestamp())`,
    [
      ids.billing, `responder-${ids.billing}`,
      ids.billing2, `responder-${ids.billing2}`
    ]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name) values
       ($1, $2, 'Responder Test One'),
       ($3, $4, 'Responder Test Two')`,
    [
      ids.organization, ids.customer,
      ids.organization2, ids.outsider
    ]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values
       ($1, $2, 'owner', 'active', clock_timestamp()),
       ($3, $4, 'owner', 'active', clock_timestamp())`,
    [
      ids.organization, ids.customer,
      ids.organization2, ids.outsider
    ]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values
       ($1, $2, $3, $4, 'Responder Project One'),
       ($5, $6, $7, $8, 'Responder Project Two')`,
    [
      ids.project, ids.organization, ids.customer, ids.billing,
      ids.project2, ids.organization2, ids.outsider, ids.billing2
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Responder Operator', 'active'),
            ($2, 'Responder Authorizer', 'active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Responder Operator', 'held', $2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
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
  return ids;
}

test("Responder persists consent, replay, STOP, kill, handoff, and scoped projections", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  try {
    const ids = await seed(pool);
    let selectedNow = new Date().toISOString();
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresResponderCoreRepository({ authority });
    const service = createResponderCore({
      repository,
      provider: createFakeResponderProvider({
        classifyMessage(input) {
          return input.commandId.includes("stop") ? "stop" : "message";
        }
      }),
      clock: { now: () => selectedNow }
    });
    const customer = {
      kind: "customer",
      userId: ids.customer,
      organizationId: ids.organization
    };
    const operator = {
      kind: "operator",
      userId: ids.operator,
      organizationId: ids.organization
    };
    const routeDigest = "a".repeat(64);
    const consentInput = {
      commandId: "pg-responder-consent-001",
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      routeDigest,
      consentBasis: "inbound_call",
      consentEvidenceDigest: "b".repeat(64),
      consentedAt: selectedNow
    };
    const consent = await service.recordConsent(customer, consentInput);
    const replayedConsent = await service.recordConsent(customer, consentInput);
    assert.equal(replayedConsent.id, consent.id);
    assert.equal(replayedConsent.replayed, true);
    await assert.rejects(
      () => service.recordConsent(customer, {
        ...consentInput,
        routeDigest: "9".repeat(64)
      }),
      (error) => error.code === "RESPONDER_CORE_IDEMPOTENCY_CONFLICT"
    );

    selectedNow = new Date(Date.now() + 5).toISOString();
    const missedInput = {
      commandId: "pg-responder-event-missed-001",
      organizationId: ids.organization,
      projectId: ids.project,
      providerEventIdDigest: "c".repeat(64),
      routeDigest,
      eventKind: "missed_call",
      payloadDigest: "d".repeat(64),
      occurredAt: selectedNow
    };
    const missed = await service.ingestProviderEvent(missedInput);
    const missedReplay = await service.ingestProviderEvent(missedInput);
    assert.equal(missedReplay.id, missed.id);
    assert.equal(missedReplay.replayed, true);
    await assert.rejects(
      () => service.ingestProviderEvent({
        ...missedInput,
        commandId: "pg-responder-event-missed-conflict-001"
      }),
      (error) => error.code === "RESPONDER_CORE_IDEMPOTENCY_CONFLICT"
    );

    selectedNow = new Date(Date.now() + 10).toISOString();
    const held = await service.reserveHeldMessage(customer, {
      commandId: "pg-responder-message-001",
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: missed.interactionId,
      contactAuthorityId: consent.id,
      messageKind: "missed_call_ack",
      contentDigest: "e".repeat(64)
    });
    assert.deepEqual(
      {
        state: held.state,
        heldReason: held.heldReason,
        providerEffects: held.providerEffects,
        deliveryClaimed: held.deliveryClaimed
      },
      {
        state: "held",
        heldReason: "global_kill",
        providerEffects: false,
        deliveryClaimed: false
      }
    );
    const heldReplay = await service.reserveHeldMessage(customer, {
      commandId: "pg-responder-message-001",
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: missed.interactionId,
      contactAuthorityId: consent.id,
      messageKind: "missed_call_ack",
      contentDigest: "e".repeat(64)
    });
    assert.equal(heldReplay.id, held.id);
    assert.equal(heldReplay.replayed, true);

    selectedNow = new Date(Date.now() + 15).toISOString();
    const handoff = await service.requestHandoff(customer, {
      commandId: "pg-responder-handoff-001",
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: missed.interactionId,
      expectedRevision: 1,
      reason: "customer_request",
      evidenceDigest: "f".repeat(64)
    });
    assert.equal(handoff.state, "handoff_required");
    assert.equal(handoff.revision, 2);
    const handoffReplay = await service.requestHandoff(customer, {
      commandId: "pg-responder-handoff-001",
      organizationId: ids.organization,
      projectId: ids.project,
      interactionId: missed.interactionId,
      expectedRevision: 1,
      reason: "customer_request",
      evidenceDigest: "f".repeat(64)
    });
    assert.equal(handoffReplay.revision, 2);

    selectedNow = new Date(Date.now() + 20).toISOString();
    const stopInput = {
      commandId: "pg-responder-event-stop-001",
      organizationId: ids.organization,
      projectId: ids.project,
      providerEventIdDigest: "1".repeat(64),
      routeDigest,
      eventKind: "message_received",
      payloadDigest: "2".repeat(64),
      occurredAt: selectedNow
    };
    const stopped = await service.ingestProviderEvent(stopInput);
    assert.equal(stopped.messageIntent, "stop");
    const stoppedReplay = await service.ingestProviderEvent(stopInput);
    assert.equal(stoppedReplay.id, stopped.id);

    selectedNow = new Date(Date.now() + 25).toISOString();
    const killed = await service.engageGlobalKill(operator, {
      commandId: "pg-responder-global-kill-001",
      organizationId: ids.organization,
      evidenceDigest: "3".repeat(64)
    });
    const killedReplay = await service.engageGlobalKill(operator, {
      commandId: "pg-responder-global-kill-001",
      organizationId: ids.organization,
      evidenceDigest: "3".repeat(64)
    });
    assert.equal(killed.globalKillEngaged, true);
    assert.equal(killedReplay.replayed, true);

    const account = await service.accountProjection(customer);
    assert.equal(account.interactions.length, 2);
    assert.equal(
      account.interactions.every(
        (item) => item.organizationId === ids.organization
      ),
      true
    );
    const queue = await service.operatorProjection(operator);
    assert.equal(queue.interactions.length, 2);
    assert.deepEqual(
      new Set(queue.interactions.map((item) => item.state)),
      new Set(["handoff_required", "opted_out"])
    );

    await assert.rejects(
      () => service.accountProjection({
        kind: "customer",
        userId: ids.customer,
        organizationId: ids.organization2
      }),
      (error) => error.code === "RESPONDER_CORE_UNAVAILABLE"
    );

    const proof = await pool.query(`
      select
        ss.hosted_responder_core_contract_v1() =
          'canonical-responder-core-v1-provider-neutral-held'
          as contract_ready,
        (
          select bool_and(relrowsecurity and relforcerowsecurity)
            from pg_class
           where oid = any(array[
             'ss.responder_runtime_controls'::regclass,
             'ss.responder_contact_authorities'::regclass,
             'ss.responder_interactions'::regclass,
             'ss.responder_provider_events'::regclass,
             'ss.responder_message_commands'::regclass,
             'ss.responder_control_commands'::regclass
           ])
        ) as forced_rls,
        not has_table_privilege(
          'authenticated', 'ss.responder_interactions', 'SELECT'
        ) as authenticated_direct_read_denied,
        not exists (
          select 1 from ss.responder_message_commands
           where provider_effects_authorized or delivery_claimed
        ) as effects_wholly_held,
        (
          select state = 'opted_out'
            from ss.responder_contact_authorities where id = $1
        ) as stop_persisted,
        not exists (
          select 1 from information_schema.columns
           where table_schema = 'ss'
             and table_name like 'responder_%'
             and column_name in (
               'phone_number', 'message_body', 'recording_url',
               'provider_secret', 'payment_method'
             )
        ) as raw_sensitive_columns_absent
    `, [consent.id]);
    for (const [name, ready] of Object.entries(proof.rows[0])) {
      assert.equal(ready, true, `Responder PostgreSQL proof failed: ${name}`);
    }
  } finally {
    await pool.end();
  }
});
