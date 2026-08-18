import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION = "responder-session-token-000000000000000000";
const USER = "10000000-0000-4000-8000-000000000001";
const ORG_A = "20000000-0000-4000-8000-000000000001";
const ORG_B = "20000000-0000-4000-8000-000000000002";
const TARGET_ORG = "20000000-0000-4000-8000-000000000099";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const CUSTOMER = "40000000-0000-4000-8000-000000000001";
const QUOTE = "50000000-0000-4000-8000-000000000001";
const BINDING = "60000000-0000-4000-8000-000000000001";
const ONBOARDING = "70000000-0000-4000-8000-000000000001";
const INBOUND = "80000000-0000-4000-8000-000000000001";
const INSTALLATION = "90000000-0000-4000-8000-000000000001";

function canonicalService(organizationIds = [ORG_A]) {
  const calls = [];
  return {
    calls,
    async authenticate(token) {
      calls.push(["authenticate", token]);
      return token === SESSION ? { userId: USER } : null;
    },
    async listOrganizations(actor) {
      calls.push(["listOrganizations", actor]);
      return {
        organizations: organizationIds.map((id) => ({ id, state: "active" }))
      };
    }
  };
}

function responderSurfaces() {
  const calls = [];
  const service = {
    calls,
    kind: "responder-surfaces",
    mode: "held",
    providerEffects: false,
    billingEffects: false,
    sellable: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        providerEffects: false,
        billingEffects: false,
        sellable: false
      };
    }
  };
  for (const method of [
    "engageGlobalKill", "readCustomer", "readOperator",
    "recordCustomerConsent", "recordOperatorConsent", "requestHandoff",
    "reserveHeldMessage", "stop"
  ]) {
    service[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return service;
}

function responderCommerce() {
  const calls = [];
  const service = {
    calls,
    kind: "responder-commerce",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        durableCommercialState: true,
        catalogAuthorityVerified: true,
        taxPurposeReleased: false,
        sellable: false,
        commercialEffects: false,
        customerEffects: false,
        mailDeliveryEffects: false,
        paymentEffects: false,
        providerEffects: false
      };
    }
  };
  for (const method of [
    "cancelHeldReservation", "createHeldQuote", "markReservationAmbiguous",
    "readCustomerQuote", "readCustomerReservation", "readOperatorCatalog",
    "requestReversal", "reserveHeldBilling"
  ]) {
    service[method] = async (...args) => {
      calls.push([method, ...args]);
      return { method, providerEffects: false };
    };
  }
  return service;
}

function responderForwarding() {
  const calls = [];
  return {
    calls,
    repository: {
      kind: "responder-forwarding-postgres",
      mode: "held-local",
      automaticCarrierCommands: false,
      remoteWriteEffects: false,
      providerEffects: false,
      messageSendEffects: false,
      async readiness() {
        return {
          ready: true,
          verified: true,
          mode: "held-local",
          retainedCarrier: true,
          launchMode: "conditional_no_answer_forwarding",
          initialAdapter: "twilio",
          automaticCarrierCommands: false,
          remoteWriteEffects: false,
          providerEffects: false,
          messageSendEffects: false
        };
      },
      async list(...args) {
        calls.push(["list", ...args]);
        return { method: "list", providerEffects: false };
      },
      async create(...args) {
        calls.push(["create", ...args]);
        return { method: "create", providerEffects: false };
      },
      async recordObservation(...args) {
        calls.push(["recordObservation", ...args]);
        return { method: "recordObservation", providerEffects: false };
      },
      async retire(...args) {
        calls.push(["retire", ...args]);
        return { method: "retire", providerEffects: false };
      }
    },
    lookupDigests: {
      kind: "responder-lookup-digests",
      numberLookupCandidates(value) {
        assert.equal(value, "+18562441220");
        return [
          { digest: "a".repeat(64), keyVersion: "forward-v2" },
          { digest: "b".repeat(64), keyVersion: "forward-v1" }
        ];
      }
    },
    clock: { now: () => "2026-08-14T20:00:00.000Z" }
  };
}

function responderNativeClient() {
  const calls = [];
  const installation = {
    id: INSTALLATION,
    organizationId: ORG_A,
    projectId: PROJECT,
    customerUserId: USER,
    platform: "ios",
    bundleId: "com.sitesourcery.responder",
    appEnvironment: "sandbox",
    appVersion: "1.0.0",
    buildNumber: "1",
    installationKeyDigest: "1".repeat(64),
    state: "active",
    revision: 1,
    pushRegistrations: []
  };
  return {
    calls,
    repository: {
      kind: "responder-native-client-postgres",
      mode: "held-local",
      providerEffects: false,
      pushDeliveryEffects: false,
      voiceCallEffects: false,
      carrierCommandEffects: false,
      messageSendEffects: false,
      async readiness() {
        return {
          ready: true,
          verified: true,
          mode: "held-local",
          providerEffects: false,
          pushDeliveryEffects: false,
          voiceCallEffects: false,
          carrierCommandEffects: false,
          messageSendEffects: false
        };
      },
      async listInstallations(...args) {
        calls.push(["listInstallations", ...args]);
        return { installations: [installation] };
      },
      async createInstallation(...args) {
        calls.push(["createInstallation", ...args]);
        return { installation };
      },
      async getInstallation(...args) {
        calls.push(["getInstallation", ...args]);
        return installation;
      },
      async registerToken(...args) {
        calls.push(["registerToken", ...args]);
        return { installation: { ...installation, revision: 2 } };
      },
      async retireToken(...args) {
        calls.push(["retireToken", ...args]);
        return { installation: { ...installation, revision: 2 } };
      },
      async suspendInstallation(...args) {
        calls.push(["suspendInstallation", ...args]);
        return { installation: { ...installation, state: "suspended" } };
      },
      async resumeInstallation(...args) {
        calls.push(["resumeInstallation", ...args]);
        return { installation };
      },
      async revokeInstallation(...args) {
        calls.push(["revokeInstallation", ...args]);
        return { installation: { ...installation, state: "revoked" } };
      },
      async issueVoipSession(...args) {
        calls.push(["issueVoipSession", ...args]);
        const error = new Error("held");
        error.code = "RESPONDER_NATIVE_VOIP_HELD";
        error.status = 409;
        throw error;
      }
    },
    voiceAccess: {
      kind: "twilio-responder-voice-access",
      mode: "held",
      transports: ["twilio_voice_ios", "twilio_voice_android"],
      providerEffects: false,
      pushDeliveryEffects: false,
      voiceCallEffects: false,
      issueSession() {
        throw new Error("not reached");
      },
      openSession() {
        throw new Error("not reached");
      },
      async readiness() {
        return {
          ready: true,
          verified: true,
          kind: "twilio-responder-voice-access",
          mode: "held",
          transports: ["twilio_voice_ios", "twilio_voice_android"],
          providerAuthorizationEffects: false,
          providerEffects: false,
          pushDeliveryEffects: false,
          voiceCallEffects: false,
          routingReady: false,
          operationalCalls: false
        };
      }
    },
    tokenAuthority: {
      kind: "responder-native-token-authority",
      providerEffects: false,
      pushDeliveryEffects: false,
      async readiness() {
        return {
          ready: true,
          verified: true,
          kind: "responder-native-token-authority",
          providerEffects: false,
          pushDeliveryEffects: false
        };
      },
      tokenLookupCandidates() {
        return [{
          digest: "a".repeat(64),
          ownershipDigest: "b".repeat(64),
          keyVersion: "native-v1"
        }];
      },
      async sealToken() {
        return {
          keyVersion: "native-v1",
          tokenLookupDigest: "a".repeat(64),
          tokenOwnershipDigest: "b".repeat(64),
          nonce: Buffer.alloc(12),
          authenticationTag: Buffer.alloc(16),
          ciphertext: Buffer.alloc(64)
        };
      }
    },
    clock: { now: () => "2026-08-14T20:00:00.000Z" }
  };
}

function get(path, { organizationId = null } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    headers: {
      Cookie: `ss_session=${SESSION}`,
      ...(organizationId === null
        ? {}
        : { "X-SiteSourcery-Organization-Id": organizationId })
    }
  });
}

function post(path, body, {
  csrf = true,
  origin = ORIGIN,
  organizationId = null
} = {}) {
  const token = "c".repeat(32);
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Cookie: `ss_session=${SESSION}; ss_csrf=${token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": "responder.root.command.0001",
      ...(csrf ? { "X-CSRF-Token": token } : {}),
      ...(organizationId === null
        ? {}
        : { "X-SiteSourcery-Organization-Id": organizationId })
    },
    body: JSON.stringify(body)
  });
}

test("Responder root derives one customer organization and preserves root headers", async () => {
  const canonical = canonicalService();
  const responder = responderSurfaces();
  const api = createHostedApi(canonical, { responderSurfaces: responder });
  const response = await api.fetch(get("/api/v1/responder"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("x-request-id"), /^req_/u);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(responder.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_A }
  ]]);
});

test("Responder root requires and verifies explicit multi-org selection", async () => {
  const responder = responderSurfaces();
  const api = createHostedApi(canonicalService([ORG_A, ORG_B]), {
    responderSurfaces: responder
  });
  const ambiguous = await api.fetch(get("/api/v1/responder"));
  assert.equal(ambiguous.status, 409);
  assert.equal(
    (await ambiguous.json()).error.code,
    "RESPONDER_ORGANIZATION_SELECTION_REQUIRED"
  );
  const selected = await api.fetch(get("/api/v1/responder", {
    organizationId: ORG_B
  }));
  assert.equal(selected.status, 200);
  assert.deepEqual(responder.calls, [[
    "readCustomer",
    { userId: USER, organizationId: ORG_B }
  ]]);
  const forged = await api.fetch(get("/api/v1/responder", {
    organizationId: TARGET_ORG
  }));
  assert.equal(forged.status, 404);
  assert.equal((await forged.json()).error.code, "NOT_FOUND");
  assert.equal(responder.calls.length, 1);
});

test("Responder root enforces same-origin, CSRF, idempotency, and one body consumer", async () => {
  const responder = responderSurfaces();
  const api = createHostedApi(canonicalService(), {
    responderSurfaces: responder
  });
  const path = "/api/v1/responder/contacts";
  const crossOrigin = await api.fetch(post(path, {}, {
    origin: "https://attacker.test"
  }));
  assert.equal(crossOrigin.status, 403);
  assert.equal(
    (await crossOrigin.json()).error.code,
    "CROSS_ORIGIN_REQUEST_REJECTED"
  );
  const missingCsrf = await api.fetch(post(path, {}, { csrf: false }));
  assert.equal(missingCsrf.status, 403);
  assert.equal((await missingCsrf.json()).error.code, "CSRF_TOKEN_REQUIRED");
  const accepted = await api.fetch(post(path, {
    projectId: "30000000-0000-4000-8000-000000000001",
    routeDigest: "a".repeat(64)
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(responder.calls, [[
    "recordCustomerConsent",
    { userId: USER, organizationId: ORG_A },
    {
      organizationId: ORG_A,
      commandId: "responder.root.command.0001",
      body: {
        projectId: "30000000-0000-4000-8000-000000000001",
        routeDigest: "a".repeat(64)
      }
    }
  ]]);
});

test("Responder operator paths preserve route organization for capability checks", async () => {
  const canonical = canonicalService([ORG_A, ORG_B]);
  const responder = responderSurfaces();
  const api = createHostedApi(canonical, { responderSurfaces: responder });
  const response = await api.fetch(get(
    `/api/v1/operator/responder/organizations/${TARGET_ORG}`
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(responder.calls, [[
    "readOperator",
    { userId: USER, organizationId: TARGET_ORG },
    TARGET_ORG
  ]]);
  assert.equal(
    canonical.calls.some(([method]) => method === "listOrganizations"),
    false
  );
});

test("Responder commerce narrows production authentication metadata to exact tenant authority", async () => {
  const canonical = canonicalService();
  canonical.authenticate = async () => ({
    userId: USER,
    sessionId: "70000000-0000-4000-8000-000000000001",
    sessionDigest: "s".repeat(64),
    expiresAt: "2026-08-15T00:00:00.000Z",
    reauthenticatedAt: "2026-08-14T18:00:00.000Z",
    user: { email: "private@example.test" }
  });
  const commerce = responderCommerce();
  const api = createHostedApi(canonical, { responderCommerce: commerce });
  const customerResponse = await api.fetch(get(
    `/api/v1/responder/projects/${PROJECT}/commerce/quotes/${QUOTE}`
  ));
  assert.equal(customerResponse.status, 200);
  const operatorResponse = await api.fetch(get(
    `/api/v1/operator/responder/organizations/${TARGET_ORG}` +
      `/projects/${PROJECT}/customers/${CUSTOMER}/commerce/catalog`
  ));
  assert.equal(operatorResponse.status, 200);
  assert.deepEqual(commerce.calls, [
    [
      "readCustomerQuote",
      { userId: USER, organizationId: ORG_A },
      { projectId: PROJECT, quoteId: QUOTE }
    ],
    [
      "readOperatorCatalog",
      { userId: USER, organizationId: TARGET_ORG },
      {
        customerUserId: CUSTOMER,
        organizationId: TARGET_ORG,
        projectId: PROJECT
      }
    ]
  ]);
  assert.equal(JSON.stringify(commerce.calls).includes("private@example.test"), false);
  assert.equal(JSON.stringify(commerce.calls).includes("sessionDigest"), false);
});

test("Responder forwarding is mounted through the root with narrow customer and operator authority", async () => {
  const canonical = canonicalService();
  canonical.authenticate = async () => ({
    userId: USER,
    sessionId: "90000000-0000-4000-8000-000000000001",
    sessionDigest: "s".repeat(64),
    expiresAt: "2026-08-15T00:00:00.000Z",
    reauthenticatedAt: "2026-08-14T18:00:00.000Z",
    user: { email: "forward-private@example.test" }
  });
  const forwarding = responderForwarding();
  const api = createHostedApi(canonical, {
    responderForwarding: forwarding
  });
  const customerRead = await api.fetch(get(
    `/api/v1/responder/projects/${PROJECT}/forwarding`
  ));
  assert.equal(customerRead.status, 200);
  const customerCreate = await api.fetch(post(
    `/api/v1/responder/projects/${PROJECT}/forwarding`,
    {
      businessLine: "+18562441220",
      consentEvidenceDigest: "c".repeat(64),
      numberBindingId: BINDING
    }
  ));
  assert.equal(customerCreate.status, 200);
  const operatorObservation = await api.fetch(post(
    `/api/v1/operator/responder/organizations/${TARGET_ORG}` +
      `/projects/${PROJECT}/forwarding/${ONBOARDING}/observations`,
    {
      expectedRevision: 1,
      observationKind: "unanswered_forwarding_reached",
      inboundEventId: INBOUND,
      evidenceDigest: "d".repeat(64),
      observedAt: "2026-08-14T19:59:00.000Z"
    }
  ));
  assert.equal(operatorObservation.status, 200);
  assert.equal(forwarding.calls.length, 3);
  assert.deepEqual(forwarding.calls[0], [
    "list",
    { kind: "customer", userId: USER, organizationId: ORG_A },
    { organizationId: ORG_A, projectId: PROJECT }
  ]);
  assert.equal(forwarding.calls[1][0], "create");
  assert.deepEqual(forwarding.calls[1][1], {
    kind: "customer", userId: USER, organizationId: ORG_A
  });
  assert.equal(forwarding.calls[1][2].businessLineLookupDigest, "a".repeat(64));
  assert.equal(forwarding.calls[2][0], "recordObservation");
  assert.deepEqual(forwarding.calls[2][1], {
    kind: "operator", userId: USER, organizationId: TARGET_ORG
  });
  assert.equal(forwarding.calls[2][2].organizationId, TARGET_ORG);
  assert.equal(forwarding.calls[2][2].inboundEventId, INBOUND);
  const durableCallShape = JSON.stringify(forwarding.calls);
  assert.equal(durableCallShape.includes("+18562441220"), false);
  assert.equal(durableCallShape.includes("forward-private@example.test"), false);
  assert.equal(durableCallShape.includes("sessionDigest"), false);
});

test("Responder native-client routes reuse hosted auth and seal raw APNs tokens", async () => {
  const canonical = canonicalService();
  canonical.authenticate = async () => ({
    userId: USER,
    sessionId: "90000000-0000-4000-8000-000000000009",
    sessionDigest: "s".repeat(64),
    user: { email: "native-private@example.test" }
  });
  const native = responderNativeClient();
  const api = createHostedApi(canonical, { responderNativeClient: native });
  const listed = await api.fetch(get(
    `/api/v1/responder/projects/${PROJECT}/native-installations`
  ));
  assert.equal(listed.status, 200);
  const token = "ab".repeat(32);
  const registered = await api.fetch(post(
    `/api/v1/responder/projects/${PROJECT}/native-installations/` +
      `${INSTALLATION}/push-tokens`,
    { expectedRevision: 1, purpose: "voip", token }
  ));
  assert.equal(registered.status, 200);
  assert.deepEqual(native.calls.map((entry) => entry[0]), [
    "listInstallations", "getInstallation", "registerToken"
  ]);
  assert.deepEqual(native.calls[0][1], {
    kind: "customer", userId: USER, organizationId: ORG_A
  });
  const durable = native.calls[2][2];
  assert.equal(Object.hasOwn(durable, "token"), false);
  assert.equal(durable.envelope.tokenLookupDigest, "a".repeat(64));
  const durableShape = JSON.stringify(native.calls);
  assert.equal(durableShape.includes(token), false);
  assert.equal(durableShape.includes("native-private@example.test"), false);
  assert.equal(durableShape.includes("sessionDigest"), false);
});

test("Responder root rejects any composition claiming external effects", () => {
  const unsafe = responderSurfaces();
  unsafe.billingEffects = true;
  assert.throws(
    () => createHostedApi(canonicalService(), {
      responderSurfaces: unsafe
    }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
  const unsafeForwarding = responderForwarding();
  unsafeForwarding.repository.remoteWriteEffects = true;
  assert.throws(
    () => createHostedApi(canonicalService(), {
      responderForwarding: unsafeForwarding
    }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
  const unsafeNative = responderNativeClient();
  unsafeNative.repository.pushDeliveryEffects = true;
  assert.throws(
    () => createHostedApi(canonicalService(), {
      responderNativeClient: unsafeNative
    }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
});
