import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresResponderSurfaceRepository } from
  "../responder-surfaces-postgres.mjs";

const IDS = Object.freeze({
  authority: "10000000-0000-4000-8000-000000000001",
  command: "20000000-0000-4000-8000-000000000001",
  customer: "30000000-0000-4000-8000-000000000001",
  event: "40000000-0000-4000-8000-000000000001",
  interaction: "50000000-0000-4000-8000-000000000001",
  operator: "60000000-0000-4000-8000-000000000001",
  organization: "70000000-0000-4000-8000-000000000001",
  project: "80000000-0000-4000-8000-000000000001"
});
const TIME = new Date("2026-08-11T17:00:00.000Z");

function fixture({ operatorAllowed = true } = {}) {
  const calls = [];
  const contact = {
    id: IDS.authority,
    project_id: IDS.project,
    customer_user_id: IDS.customer,
    route_kind: "sms",
    route_digest: "a".repeat(64),
    purpose: "missed_call_response",
    consent_basis: "explicit_service_request",
    state: "active",
    consented_at: TIME,
    opted_out_at: null,
    revision: 1
  };
  const interaction = {
    id: IDS.interaction,
    project_id: IDS.project,
    contact_authority_id: IDS.authority,
    route_digest: "a".repeat(64),
    source_kind: "missed_call",
    state: "open",
    handoff_reason: null,
    opened_at: TIME,
    last_event_at: TIME,
    revision: 1
  };
  const client = {
    query(sql, parameters = []) {
      calls.push([String(sql), parameters]);
      if (String(sql).includes("hosted_responder_core_contract_v1")) {
        return { rows: [{
          contract_ready: true,
          tables_ready: true,
          rls_ready: true
        }] };
      }
      if (String(sql).includes("organization_memberships")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (String(sql).includes("service_operator_has_capability")) {
        return { rows: [{ allowed: operatorAllowed }] };
      }
      if (String(sql).includes("from ss.responder_contact_authorities")) {
        return { rows: [contact] };
      }
      if (String(sql).includes("from ss.responder_interactions")) {
        return { rows: [interaction] };
      }
      if (String(sql).includes("from ss.responder_provider_events")) {
        return { rows: [{
          id: IDS.event,
          interaction_id: IDS.interaction,
          event_kind: "missed_call",
          message_intent: "not_applicable",
          state: "applied",
          occurred_at: TIME,
          recorded_at: TIME,
          provider: "fake",
          provider_event_id_digest: "b".repeat(64),
          payload_digest: "c".repeat(64)
        }] };
      }
      if (String(sql).includes("from ss.responder_message_commands")) {
        return { rows: [{
          id: IDS.command,
          interaction_id: IDS.interaction,
          contact_authority_id: IDS.authority,
          message_kind: "missed_call_ack",
          state: "held",
          held_reason: "global_kill",
          requested_at: TIME,
          content_digest: "d".repeat(64)
        }] };
      }
      if (String(sql).includes("responder_runtime_controls")) {
        return { rows: [{
          global_kill_engaged: true,
          state: "held",
          revision: 1,
          updated_at: TIME,
          observed_at: TIME
        }] };
      }
      throw new Error(`Unexpected query: ${String(sql)}`);
    }
  };
  const authority = {
    service(context, work) {
      calls.push(["service", context]);
      return work(client);
    }
  };
  return {
    calls,
    repository: createPostgresResponderSurfaceRepository({ authority })
  };
}

test("projection readiness proves exact core contract, tables, and forced RLS", async () => {
  const { repository } = fixture();
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "responder-surfaces-postgres",
    mode: "held",
    providerEffects: false
  });
});

test("customer projection is tenant/member scoped and omits private evidence", async () => {
  const { calls, repository } = fixture();
  const projection = await repository.readCustomer({
    userId: IDS.customer,
    organizationId: IDS.organization
  });
  assert.equal(projection.audience, "customer");
  assert.equal(projection.organizationId, IDS.organization);
  assert.equal(projection.globalKillEngaged, true);
  assert.equal(projection.providerEffects, false);
  assert.equal(projection.contacts[0].routeDigest, "a".repeat(64));
  assert.equal(projection.interactions[0].events[0].eventKind, "missed_call");
  assert.equal(projection.interactions[0].heldCommands[0].deliveryClaimed, false);
  assert.equal(
    JSON.stringify(projection).match(
      /providerEventId|payloadDigest|signature|evidenceDigest|contentDigest|phone|messageBody/gu
    ),
    null
  );
  const context = calls.find((entry) => entry[0] === "service")[1];
  assert.deepEqual(context, {
    actorKind: "customer",
    userId: IDS.customer,
    organizationId: IDS.organization,
    readOnly: true
  });
  assert.equal(calls.some(([sql, parameters]) =>
    typeof sql === "string" && sql.includes("authority.customer_user_id = $2") &&
      parameters[1] === IDS.customer
  ), true);
});

test("operator projection requires capability and stays target-organization scoped", async () => {
  const allowed = fixture();
  const projection = await allowed.repository.readOperator({
    userId: IDS.operator,
    organizationId: IDS.organization
  });
  assert.equal(projection.audience, "operator");
  assert.equal(allowed.calls.some(([sql, parameters]) =>
    typeof sql === "string" && sql.includes("service_management_manage") &&
      parameters[0] === IDS.operator
  ), true);
  assert.equal(allowed.calls.some(([sql, parameters]) =>
    typeof sql === "string" && sql.includes("responder_interactions") &&
      parameters[0] === IDS.organization
  ), true);

  const denied = fixture({ operatorAllowed: false });
  await assert.rejects(
    denied.repository.readOperator({
      userId: IDS.operator,
      organizationId: IDS.organization
    }),
    (error) => error.code === "RESPONDER_SURFACE_UNAVAILABLE" &&
      error.status === 404
  );
  assert.equal(denied.calls.some(([sql]) =>
    typeof sql === "string" && sql.includes("responder_interactions")
  ), false);
});
