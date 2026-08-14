import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderForwardingHttpBoundary,
  matchResponderForwardingHttpRoute
} from "../responder-forwarding-http.mjs";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const PROJECT = "10000000-0000-4000-8000-000000000002";
const CUSTOMER = "10000000-0000-4000-8000-000000000003";
const OPERATOR = "10000000-0000-4000-8000-000000000004";
const BINDING = "10000000-0000-4000-8000-000000000005";
const ONBOARDING = "10000000-0000-4000-8000-000000000006";
const INBOUND = "10000000-0000-4000-8000-000000000007";
const NOW = "2026-08-14T19:00:00.000Z";

function repository(calls) {
  return {
    kind: "responder-forwarding-postgres",
    mode: "held-local",
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false,
    async list(actor, input) {
      calls.push({ method: "list", actor, input });
      return { schema: "sitesourcery.responder-forwarding-list/v1" };
    },
    async create(actor, input) {
      calls.push({ method: "create", actor, input });
      return { schema: "sitesourcery.responder-forwarding-command-receipt/v1" };
    },
    async recordObservation(actor, input) {
      calls.push({ method: "observe", actor, input });
      return { schema: "sitesourcery.responder-forwarding-command-receipt/v1" };
    },
    async retire(actor, input) {
      calls.push({ method: "retire", actor, input });
      return { schema: "sitesourcery.responder-forwarding-command-receipt/v1" };
    }
  };
}

function boundary(calls, { write = true } = {}) {
  return createResponderForwardingHttpBoundary({
    repository: repository(calls),
    lookupDigests: {
      kind: "responder-lookup-digests",
      numberLookupCandidates(value) {
        assert.equal(value, "+18562441220");
        return [{ digest: "a".repeat(64), keyVersion: "v2" },
          { digest: "b".repeat(64), keyVersion: "v1" }];
      }
    },
    async authenticate(_request, route) {
      return {
        userId: route.audience === "operator" ? OPERATOR : CUSTOMER,
        organizationId: ORGANIZATION,
        sessionDigest: "must-not-cross"
      };
    },
    async requireWriteGuard() {
      return write;
    },
    randomUUID: () => ONBOARDING,
    clock: { now: () => NOW }
  });
}

function request(path, { body = null, key = "forwarding-command-001" } = {}) {
  return new Request(`https://sitesourcery.com${path}`, {
    method: body === null ? "GET" : "POST",
    headers: body === null ? {} : {
      "content-type": "application/json",
      "idempotency-key": key
    },
    ...(body === null ? {} : { body: JSON.stringify(body) })
  });
}

test("forwarding routes keep customer and operator authority distinct", () => {
  assert.equal(matchResponderForwardingHttpRoute(
    "GET", `/api/v1/responder/projects/${PROJECT}/forwarding`
  ).audience, "customer");
  assert.equal(matchResponderForwardingHttpRoute(
    "POST",
    `/api/v1/operator/responder/organizations/${ORGANIZATION}/projects/${PROJECT}/forwarding/${ONBOARDING}/observations`
  ).operation, "observe");
  assert.equal(matchResponderForwardingHttpRoute(
    "GET", `/api/v1/responder/projects/${PROJECT}/forwarding?x=1`
  ), null);
});

test("customer onboarding persists only keyed line identity and exact tenant authority", async () => {
  const calls = [];
  const response = await boundary(calls).dispatch(request(
    `/api/v1/responder/projects/${PROJECT}/forwarding`,
    { body: {
      businessLine: "+18562441220",
      consentEvidenceDigest: "c".repeat(64),
      numberBindingId: BINDING
    } }
  ));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "create");
  assert.deepEqual(calls[0].actor, {
    kind: "customer",
    organizationId: ORGANIZATION,
    userId: CUSTOMER
  });
  assert.equal(calls[0].input.customerUserId, CUSTOMER);
  assert.equal(calls[0].input.businessLineLookupDigest, "a".repeat(64));
  assert.deepEqual(
    calls[0].input.businessLineLookupCandidateDigests,
    ["a".repeat(64), "b".repeat(64)]
  );
  assert.equal(JSON.stringify(calls[0]).includes("+18562441220"), false);
  assert.equal(JSON.stringify(calls[0]).includes("must-not-cross"), false);
});

test("operator observations bind exact revision and inbound evidence", async () => {
  const calls = [];
  const response = await boundary(calls).dispatch(request(
    `/api/v1/operator/responder/organizations/${ORGANIZATION}/projects/${PROJECT}/forwarding/${ONBOARDING}/observations`,
    { key: "forwarding-observation-001", body: {
      expectedRevision: 2,
      observationKind: "unanswered_forwarding_reached",
      inboundEventId: INBOUND,
      evidenceDigest: "d".repeat(64),
      observedAt: NOW
    } }
  ));
  assert.equal(response.status, 200);
  assert.equal(calls[0].method, "observe");
  assert.equal(calls[0].actor.kind, "operator");
  assert.equal(calls[0].input.onboardingId, ONBOARDING);
  assert.equal(calls[0].input.inboundEventId, INBOUND);
  assert.equal(calls[0].input.expectedRevision, 2);
});

test("customer retirement is cancellation-only and every write requires its guard", async () => {
  const path =
    `/api/v1/responder/projects/${PROJECT}/forwarding/${ONBOARDING}/retire`;
  await assert.rejects(
    boundary([], { write: false }).dispatch(request(path, { body: {
      expectedRevision: 1,
      reason: "customer_cancelled",
      evidenceDigest: "e".repeat(64)
    } })),
    (error) => error?.code ===
      "RESPONDER_FORWARDING_WRITE_GUARD_REQUIRED"
  );
  const calls = [];
  await assert.rejects(
    boundary(calls).dispatch(request(path, { body: {
      expectedRevision: 1,
      reason: "operator_correction",
      evidenceDigest: "e".repeat(64)
    } })),
    (error) => error?.code === "RESPONDER_FORWARDING_INVALID"
  );
  assert.equal(calls.length, 0);
});

test("malformed bodies and missing idempotency fail before repository use", async () => {
  const calls = [];
  const api = boundary(calls);
  await assert.rejects(
    api.dispatch(request(
      `/api/v1/responder/projects/${PROJECT}/forwarding`,
      { key: "bad", body: {
        businessLine: "+18562441220",
        consentEvidenceDigest: "c".repeat(64),
        numberBindingId: BINDING
      } }
    )),
    (error) => error?.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
  await assert.rejects(
    api.dispatch(request(
      `/api/v1/responder/projects/${PROJECT}/forwarding`,
      { body: {
        businessLine: "+18562441220",
        consentEvidenceDigest: "c".repeat(64),
        numberBindingId: BINDING,
        rawCarrierCode: "forbidden"
      } }
    )),
    (error) => error?.code === "RESPONDER_FORWARDING_INVALID"
  );
  assert.equal(calls.length, 0);
});
