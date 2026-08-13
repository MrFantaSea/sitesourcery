import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderInboundFollowupExecutor,
  RESPONDER_MISSED_CALL_FOLLOWUP_BODY
} from "../responder-inbound-followup-worker-postgres.mjs";
import { digest } from "../security.mjs";

const IDS = Object.freeze({
  job: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  inbound: "10000000-0000-4000-8000-000000000004",
  interaction: "10000000-0000-4000-8000-000000000005",
  contact: "10000000-0000-4000-8000-000000000006",
  operation: "10000000-0000-4000-8000-000000000007"
});
const CALLER = "+18565550100";
const ROUTE = digest({ routeKind: "sms", address: CALLER });

function executor() {
  const calls = [];
  const inboundVault = {
    kind: "responder-inbound-material-vault",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async openInboundMaterial(authority, envelope) {
      calls.push(["open", authority, envelope]);
      return { from: CALLER, forwardedFrom: null };
    }
  };
  const deliveryVault = {
    kind: "responder-private-material-vault",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async sealSmsMaterial(authority, material) {
      calls.push(["seal", authority, material]);
      return {
        keyVersion: "2026-08",
        nonce: Buffer.alloc(12, 1),
        authenticationTag: Buffer.alloc(16, 2),
        ciphertext: Buffer.alloc(32, 3)
      };
    }
  };
  return {
    calls,
    executor: createResponderInboundFollowupExecutor({
      inboundVault,
      deliveryVault
    })
  };
}

function claim(overrides = {}) {
  return {
    jobId: IDS.job,
    organizationId: IDS.organization,
    projectId: IDS.project,
    inboundEventId: IDS.inbound,
    interactionId: IDS.interaction,
    contactAuthorityId: IDS.contact,
    deliveryOperationId: IDS.operation,
    commandId: `responder-followup:${IDS.inbound}`,
    messageKind: "missed_call_ack",
    routeDigest: ROUTE,
    eligibility: "eligible",
    inboundAuthority: {},
    inboundEnvelope: {},
    ...overrides
  };
}

test("eligible missed-call evidence becomes exact sealed delivery material", async () => {
  const selected = executor();
  const result = await selected.executor.execute(claim());
  assert.equal(result.receiptKind, "followup_materialized");
  assert.equal(result.routeDigest, ROUTE);
  assert.equal(
    result.contentDigest,
    digest({
      contentKind: "sms",
      body: RESPONDER_MISSED_CALL_FOLLOWUP_BODY
    })
  );
  assert.deepEqual(selected.calls[1][2], {
    to: CALLER,
    body: RESPONDER_MISSED_CALL_FOLLOWUP_BODY
  });
  assert.equal(selected.calls[1][2].body.includes("STOP"), true);
});

test("missing consent stops at manual review without opening caller material", async () => {
  const selected = executor();
  const result = await selected.executor.execute(claim({
    eligibility: "consent_required",
    contactAuthorityId: null,
    routeDigest: null,
    inboundAuthority: null,
    inboundEnvelope: null
  }));
  assert.deepEqual(result, {
    receiptKind: "manual_review",
    failureCode: "RESPONDER_INBOUND_FOLLOWUP_CONSENT_REQUIRED"
  });
  assert.deepEqual(selected.calls, []);
});

test("caller material must match the active consent route", async () => {
  const selected = executor();
  await assert.rejects(
    selected.executor.execute(claim({ routeDigest: "a".repeat(64) })),
    (error) => error?.code ===
      "RESPONDER_INBOUND_FOLLOWUP_AUTHORITY_CONFLICT"
  );
  assert.equal(selected.calls.length, 1);
});
