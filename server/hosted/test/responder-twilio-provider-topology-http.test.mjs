import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderTwilioProviderTopologyHttpBoundary,
  matchResponderTwilioTopologyHttpRoute
} from "../responder-twilio-provider-topology-http.mjs";

const organizationId = "00000000-0000-4000-8000-000000000001";
const topologyId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const sid = (prefix, character) => `${prefix}${character.repeat(32)}`;
const evidenceDigest = "e".repeat(64);

function boundary(calls) {
  return createResponderTwilioProviderTopologyHttpBoundary({
    repository: {
      kind: "responder-twilio-provider-topology-postgres",
      providerEffects: false,
      async attestTopology(actor, input) {
        calls.push({ operation: "attest", actor, input });
        return { ok: true, providerEffects: false };
      },
      async retireTopology(actor, input) {
        calls.push({ operation: "retire", actor, input });
        return { ok: true, providerEffects: false };
      },
      async listTopologies(actor, selectedOrganizationId) {
        calls.push({ operation: "list", actor, selectedOrganizationId });
        return { topologies: [], providerEffects: false };
      }
    },
    authenticate: async () => ({ userId }),
    requireWriteGuard: async () => true,
    clock: { now: () => "2026-08-26T17:00:00.000Z" }
  });
}

function attestationBody(overrides = {}) {
  return {
    accountSid: sid("AC", "1"),
    messagingServiceSid: sid("MG", "2"),
    customerProfileSid: sid("BU", "3"),
    brandRegistrationSid: sid("BN", "4"),
    campaignSid: sid("QE", "5"),
    messagingApiKeySid: sid("SK", "6"),
    voiceApiKeySid: sid("SK", "7"),
    voiceSandboxPushCredentialSid: sid("CR", "8"),
    voiceProductionPushCredentialSid: sid("CR", "9"),
    voiceAndroidSandboxPushCredentialSid: sid("CR", "a"),
    voiceAndroidProductionPushCredentialSid: sid("CR", "b"),
    registrationClass: "LOW_VOLUME_STANDARD",
    campaignUseCase: "CUSTOMER_CARE",
    messagingApiKeySecretDigest: "c".repeat(64),
    webhookAuthTokenDigest: "d".repeat(64),
    voiceApiKeySecretDigest: "f".repeat(64),
    readbackAttestedAt: "2026-08-26T16:59:00.000Z",
    evidenceDigest,
    ...overrides
  };
}

test("topology routes are exact and operator-only", () => {
  assert.equal(matchResponderTwilioTopologyHttpRoute(
    "POST",
    `/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies`
  )?.operation, "attest");
  assert.equal(matchResponderTwilioTopologyHttpRoute(
    "POST",
    `/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies/${topologyId}/retire`
  )?.operation, "retire");
  assert.equal(matchResponderTwilioTopologyHttpRoute(
    "GET",
    `/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies?x=1`
  ), null);
});

test("attestation digests raw provider identifiers before persistence", async () => {
  const calls = [];
  const response = await boundary(calls).dispatch(new Request(
    `https://sitesourcery.com/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "twilio.topology.0001"
      },
      body: JSON.stringify(attestationBody())
    }
  ));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.accountSid, undefined);
  assert.match(calls[0].input.accountSidDigest, /^[0-9a-f]{64}$/u);
  assert.equal(calls[0].input.providerBrandType, "STANDARD");
  assert.equal(JSON.stringify(calls[0]).includes(sid("AC", "1")), false);
});

test("attestation rejects shared messaging and Voice API keys", async () => {
  const calls = [];
  await assert.rejects(
    boundary(calls).dispatch(new Request(
      `https://sitesourcery.com/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "twilio.topology.0002"
        },
        body: JSON.stringify(attestationBody({
          voiceApiKeySid: sid("SK", "6")
        }))
      }
    )),
    /invalid/u
  );
  assert.equal(calls.length, 0);
});

test("attestation rejects shared secret digests and Push Credentials", async () => {
  for (const overrides of [
    { voiceApiKeySecretDigest: "c".repeat(64) },
    { voiceProductionPushCredentialSid: sid("CR", "8") }
  ]) {
    const calls = [];
    await assert.rejects(
      boundary(calls).dispatch(new Request(
        `https://sitesourcery.com/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "twilio.topology.0004"
          },
          body: JSON.stringify(attestationBody(overrides))
        }
      )),
      /invalid/u
    );
    assert.equal(calls.length, 0);
  }
});

test("topology writes reject expanded media types before repository access", async () => {
  const calls = [];
  await assert.rejects(
    boundary(calls).dispatch(new Request(
      `https://sitesourcery.com/api/v1/operator/responder/organizations/${organizationId}/twilio-topologies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/jsonevil",
          "idempotency-key": "twilio.topology.0003"
        },
        body: JSON.stringify(attestationBody())
      }
    )),
    (error) => error?.status === 415
  );
  assert.equal(calls.length, 0);
});
