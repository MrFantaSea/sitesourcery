import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresProviderReconciliationRepository
} from "../provider-reconciliation-postgres.mjs";

const NOW = "2026-08-12T18:00:00.000Z";
const WORKER = "provider-reconciliation-test000001";
const OPERATION = "10000000-0000-4000-8000-0000000000a1";
const INBOUND = "10000000-0000-4000-8000-0000000000a2";
const ORG = "10000000-0000-4000-8000-0000000000a3";
const PROJECT = "10000000-0000-4000-8000-0000000000a4";
const CASE = "10000000-0000-4000-8000-0000000000a5";

function fakeAuthority(handler) {
  const calls = [];
  return {
    calls,
    authority: {
      kind: "canonical-postgres",
      async service(context, work) {
        const scope = { context, queries: [] };
        calls.push(scope);
        return work({
          query(text, values = []) {
            scope.queries.push({ text, values });
            return handler(text, values, scope);
          }
        });
      }
    }
  };
}

function repository(handler) {
  const fake = fakeAuthority(handler);
  return {
    fake,
    repo: createPostgresProviderReconciliationRepository({
      authority: fake.authority,
      randomUUID: () => CASE
    })
  };
}

function emptyDetection(text) {
  if (text.includes("state = 'claimed'")) return { rowCount: 0, rows: [] };
  if (text.includes("not projection.terminal")) {
    return { rowCount: 0, rows: [] };
  }
  if (text.includes("event.event_state = 'pending'")) {
    return { rowCount: 0, rows: [] };
  }
  if (text.includes("inbound.state = 'unbound'")) {
    return { rowCount: 0, rows: [] };
  }
  throw new Error(`unhandled detection query: ${text.slice(0, 50)}`);
}

test("detection opens digest-idempotent cases for every case kind", async () => {
  const inserts = [];
  const { repo } = repository((text, values) => {
    if (text.includes("state = 'claimed'")) {
      return {
        rowCount: 1,
        rows: [{
          id: OPERATION, organization_id: ORG, project_id: PROJECT,
          last_worker_id: "responder-fulfillment-dead0001",
          lease_expires_at: "2026-08-12T17:00:00.000Z", attempt_count: 1
        }]
      };
    }
    if (text.includes("not projection.terminal")) {
      return { rowCount: 0, rows: [] };
    }
    if (text.includes("event.event_state = 'pending'")) {
      return {
        rowCount: 1,
        rows: [{ provider_message_id_digest: "d".repeat(64) }]
      };
    }
    if (text.includes("inbound.state = 'unbound'")) {
      return { rowCount: 1, rows: [{ id: INBOUND }] };
    }
    if (text.includes("insert into ss.provider_reconciliation_cases")) {
      inserts.push(values);
      return { rowCount: 1, rows: [{ id: CASE }] };
    }
    throw new Error(`unhandled: ${text.slice(0, 50)}`);
  });
  const result = await repo.runDetection({
    workerId: WORKER,
    observedAt: NOW
  });
  assert.equal(result.openedCases, 3);
  assert.equal(result.counters.abandonedClaim, 1);
  assert.equal(result.counters.unmatchedProviderEvent, 1);
  assert.equal(result.counters.unboundInboundEvent, 1);
  // case_kind is the 2nd insert parameter across every case.
  const kinds = inserts.map((values) => values[1]);
  assert.deepEqual(kinds.sort(), [
    "abandoned_claim", "unbound_inbound_event", "unmatched_provider_event"
  ]);
});

test("a stale non-terminal status self-heals through the idempotent reconciler before opening a case", async () => {
  let reconcilerCalled = 0;
  const { repo } = repository((text) => {
    if (text.includes("state = 'claimed'")) return { rowCount: 0, rows: [] };
    if (text.includes("not projection.terminal")) {
      return {
        rowCount: 1,
        rows: [{
          operation_id: OPERATION, organization_id: ORG, project_id: PROJECT,
          provider_message_id_digest: "d".repeat(64),
          current_status: "sent", accepted_at: "2026-08-12T16:00:00.000Z"
        }]
      };
    }
    if (text.includes("reconcile_responder_delivery_provider_events")) {
      reconcilerCalled += 1;
      return { rowCount: 1, rows: [{}] };
    }
    if (text.includes("select terminal from")) {
      return { rowCount: 1, rows: [{ terminal: true }] };
    }
    if (text.includes("insert into ss.provider_reconciliation_cases")) {
      throw new Error("a self-healed status must not open a case");
    }
    return emptyDetection(text);
  });
  const result = await repo.runDetection({ workerId: WORKER, observedAt: NOW });
  assert.equal(reconcilerCalled, 1);
  assert.equal(result.counters.selfHealedProjections, 1);
  assert.equal(result.counters.staleDeliveryStatus, 0);
  assert.equal(result.openedCases, 0);
});

test("a status that stays non-terminal after the reconciler opens a case", async () => {
  const inserts = [];
  const { repo } = repository((text, values) => {
    if (text.includes("state = 'claimed'")) return { rowCount: 0, rows: [] };
    if (text.includes("not projection.terminal")) {
      return {
        rowCount: 1,
        rows: [{
          operation_id: OPERATION, organization_id: ORG, project_id: PROJECT,
          provider_message_id_digest: "d".repeat(64),
          current_status: "sent", accepted_at: "2026-08-12T16:00:00.000Z"
        }]
      };
    }
    if (text.includes("reconcile_responder_delivery_provider_events")) {
      return { rowCount: 1, rows: [{}] };
    }
    if (text.includes("select terminal from")) {
      return { rowCount: 1, rows: [{ terminal: false }] };
    }
    if (text.includes("insert into ss.provider_reconciliation_cases")) {
      inserts.push(values);
      return { rowCount: 1, rows: [{ id: CASE }] };
    }
    return emptyDetection(text);
  });
  const result = await repo.runDetection({ workerId: WORKER, observedAt: NOW });
  assert.equal(result.counters.staleDeliveryStatus, 1);
  assert.equal(inserts[0][1], "stale_delivery_status");
});

test("escalation preserves the dead worker's lease identity and is idempotent", async () => {
  let update = null;
  const { repo } = repository((text, values) => {
    if (text.includes("from ss.provider_reconciliation_cases reconciliation")) {
      return {
        rowCount: 1,
        rows: [{
          id: CASE, state: "open", subject_operation_id: OPERATION,
          operation_state: "claimed",
          lease_owner: "responder-fulfillment-dead0001",
          last_worker_id: "responder-fulfillment-dead0001", attempt_count: 1
        }]
      };
    }
    if (text.includes("update ss.responder_delivery_operations")) {
      update = { text, values };
      return { rowCount: 1, rows: [{ id: OPERATION }] };
    }
    throw new Error(`unhandled: ${text.slice(0, 50)}`);
  });
  const result = await repo.escalateAbandonedClaim({
    caseId: CASE,
    escalatedAt: NOW
  });
  assert.equal(result.status, "escalated");
  assert.match(update.text, /state = 'manual_review'/u);
  assert.match(update.text, /last_worker_id = \$2/u);
  assert.match(update.text, /where id = \$1 and state = 'claimed' and lease_owner = \$2/u);
  assert.equal(update.values[1], "responder-fulfillment-dead0001");

  const already = repository((text) => {
    if (text.includes("from ss.provider_reconciliation_cases reconciliation")) {
      return {
        rowCount: 1,
        rows: [{
          id: CASE, state: "open", subject_operation_id: OPERATION,
          operation_state: "manual_review",
          lease_owner: null, last_worker_id: "responder-fulfillment-dead0001",
          attempt_count: 1
        }]
      };
    }
    throw new Error("already-escalated must not update");
  });
  assert.equal(
    (await already.repo.escalateAbandonedClaim({
      caseId: CASE, escalatedAt: NOW
    })).status,
    "already_escalated"
  );
});

test("readback records exactly once and self-heal closes without operator authority", async () => {
  const readbackRepo = repository((text) => {
    if (text.includes("update ss.provider_reconciliation_cases")) {
      assert.match(text, /state = 'open' and readback_state = 'none'/u);
      return {
        rowCount: 1,
        rows: [{
          id: CASE, provider: "twilio", case_kind: "unmatched_provider_event",
          case_digest: "f".repeat(64), state: "open",
          readback_state: "matched", resolution_kind: null
        }]
      };
    }
    throw new Error(`unhandled: ${text.slice(0, 50)}`);
  });
  const receipt = await readbackRepo.repo.recordReadback({
    caseId: CASE,
    readbackState: "matched",
    readbackEvidenceDigest: "a".repeat(64),
    observedAt: NOW
  });
  assert.equal(receipt.readbackState, "matched");

  const healRepo = repository((text) => {
    if (text.includes("update ss.provider_reconciliation_cases")) {
      assert.match(text, /resolution_kind = 'self_healed'/u);
      return {
        rowCount: 1,
        rows: [{
          id: CASE, provider: "twilio", case_kind: "stale_delivery_status",
          case_digest: "f".repeat(64), state: "resolved",
          readback_state: "matched", resolution_kind: "self_healed"
        }]
      };
    }
    throw new Error(`unhandled: ${text.slice(0, 50)}`);
  });
  const resolved = await healRepo.repo.resolveBySelfHeal({
    caseId: CASE,
    resolutionEvidenceDigest: "b".repeat(64),
    resolvedAt: NOW
  });
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.resolutionKind, "self_healed");
});

test("detection and listing run under system authority without tenant context", async () => {
  const { fake, repo } = repository((text) => emptyDetection(text));
  await repo.runDetection({ workerId: WORKER, observedAt: NOW });
  assert.equal(fake.calls[0].context.actorKind, "system");
  assert.equal(fake.calls[0].context.organizationId, undefined);
  assert.equal(fake.calls[0].context.isolation, "serializable");

  const listRepo = repository((text) => {
    if (text.includes("where state = 'open'")) {
      return { rowCount: 0, rows: [] };
    }
    throw new Error("unexpected list query");
  });
  const list = await listRepo.repo.listOpenCases();
  assert.deepEqual(list.cases, []);
  assert.equal(listRepo.fake.calls[0].context.readOnly, true);
});

test("configuration bounds are enforced", () => {
  assert.throws(
    () => createPostgresProviderReconciliationRepository({
      authority: { kind: "canonical-postgres", service: () => {} },
      staleAfterMs: 10
    }),
    (error) =>
      error?.code === "PROVIDER_RECONCILIATION_CONFIGURATION_REQUIRED"
  );
});
