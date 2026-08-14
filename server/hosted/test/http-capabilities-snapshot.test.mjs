import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://staging.sitesourcery.com";
const NAMES = Object.freeze([
  "service",
  "download",
  "billing",
  "alakazam35",
  "alakazam50",
  "retained",
  "publication",
  "mailEvents",
  "responderEvents",
  "responderInbound",
  "care",
  "careCommerce",
  "responder",
  "responderCommerce",
  "responderForwarding",
  "responderNativeClient",
  "responderNativeToken"
]);
const FULL_DOMAIN_READINESS = Object.freeze({
  ready: true,
  verified: true,
  mounted: true,
  mode: "approved_live",
  purchaseReady: true,
  registrar: "ready",
  payments: "ready",
  dns: "ready",
  providerEffects: true,
  remoteWrites: true,
  automaticCommands: false
});
const MOUNTED_HELD_DOMAIN_READINESS = Object.freeze({
  ready: true,
  verified: true,
  mounted: true,
  mode: "held",
  purchaseReady: false,
  registrar: "held",
  payments: "held",
  dns: "held",
  providerEffects: false,
  remoteWrites: false,
  automaticCommands: false
});
const FULL_CARE_COMMERCE_READINESS = Object.freeze({
  ready: true,
  verified: true,
  commercialReady: false,
  durableCommercialState: true,
  taxPurposeReleased: false,
  mailReservationReady: true,
  commercialEffects: false,
  customerEffects: false,
  mailDeliveryEffects: false,
  paymentEffects: false,
  providerEffects: false
});
const FULL_CARE_COMMERCE_CAPABILITY = Object.freeze({
  ready: true,
  mounted: true,
  mode: "held-local",
  commercialReady: false,
  taxPurposeReleased: false,
  commercialEffects: false,
  customerEffects: false,
  mailDeliveryEffects: false,
  paymentEffects: false,
  providerEffects: false
});
const FULL_RESPONDER_COMMERCE_READINESS = Object.freeze({
  ready: true,
  verified: true,
  mounted: true,
  durableCommercialState: true,
  catalogAuthorityVerified: true,
  taxPurposeReleased: false,
  sellable: false,
  commercialEffects: false,
  customerEffects: false,
  mailDeliveryEffects: false,
  paymentEffects: false,
  providerEffects: false
});
const FULL_RESPONDER_COMMERCE_CAPABILITY = Object.freeze({
  ready: true,
  mounted: true,
  mode: "held-local",
  durableCommercialState: true,
  catalogAuthorityVerified: true,
  taxPurposeReleased: false,
  sellable: false,
  commercialEffects: false,
  customerEffects: false,
  mailDeliveryEffects: false,
  paymentEffects: false,
  providerEffects: false
});
const FULL_RESPONDER_FORWARDING_READINESS = Object.freeze({
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
});
const FULL_RESPONDER_FORWARDING_CAPABILITY = Object.freeze({
  ready: true,
  mounted: true,
  mode: "held-local",
  retainedCarrier: true,
  launchMode: "conditional_no_answer_forwarding",
  initialAdapter: "twilio",
  automaticCarrierCommands: false,
  remoteWriteEffects: false,
  providerEffects: false,
  messageSendEffects: false
});
const FULL_RESPONDER_NATIVE_CLIENT_READINESS = Object.freeze({
  ready: true,
  verified: true,
  mode: "held-local",
  providerEffects: false,
  pushDeliveryEffects: false,
  voiceCallEffects: false,
  carrierCommandEffects: false,
  messageSendEffects: false
});
const FULL_RESPONDER_NATIVE_TOKEN_READINESS = Object.freeze({
  ready: true,
  verified: true,
  kind: "responder-native-token-authority",
  providerEffects: false,
  pushDeliveryEffects: false
});
const FULL_RESPONDER_NATIVE_CLIENT_CAPABILITY = Object.freeze({
  ready: false,
  backendReady: true,
  clientsReady: false,
  mounted: true,
  mode: "held-local",
  acceptedRegistrationPlatforms: Object.freeze(["ios", "android"]),
  initialClient: "ios",
  clientArtifacts: Object.freeze({ ios: false, android: false }),
  tokenStorage: "sealed",
  voipSessionState: "held",
  providerEffects: false,
  pushDeliveryEffects: false,
  voiceCallEffects: false,
  carrierCommandEffects: false,
  messageSendEffects: false
});
const EXPECTED = Object.freeze({
  accountRegistration: true,
  accountRecoveryEmail: true,
  downloadQuote: true,
  downloadPayment: true,
  alakazamQuote: true,
  alakazamCheckout: true,
  alakazamDowngrade: true,
  alakazam35: true,
  alakazam50: true,
  alakazamRetainedPremium: true,
  alakazamPublication: true,
  mailProviderEvents: true,
  responderProviderEvents: true,
  responderInboundEvents: true,
  care: true,
  careCommerce: FULL_CARE_COMMERCE_CAPABILITY,
  responder: false,
  responderForwarding: FULL_RESPONDER_FORWARDING_CAPABILITY,
  responderNativeClient: FULL_RESPONDER_NATIVE_CLIENT_CAPABILITY,
  responderCommerce: FULL_RESPONDER_COMMERCE_CAPABILITY,
  adjacentIntegrations: Object.freeze({
    ready: false,
    mode: "held",
    systems: Object.freeze([]),
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  }),
  domains: FULL_DOMAIN_READINESS,
  domainPurchase: true,
  publishing: true
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function methods(names, readiness) {
  return Object.freeze({
    readiness,
    ...Object.fromEntries(
      names.map((name) => [name, async () => {
        throw new Error("not reached");
      }])
    )
  });
}

function apiFixture({
  at = () => Date.now(),
  careCommerceReadiness = FULL_CARE_COMMERCE_READINESS,
  includeCareCommerce = true,
  responderCommerceReadiness = FULL_RESPONDER_COMMERCE_READINESS,
  includeResponderCommerce = true,
  responderForwardingReadiness = FULL_RESPONDER_FORWARDING_READINESS,
  includeResponderForwarding = true,
  responderNativeClientReadiness = FULL_RESPONDER_NATIVE_CLIENT_READINESS,
  responderNativeTokenReadiness = FULL_RESPONDER_NATIVE_TOKEN_READINESS,
  includeResponderNativeClient = true,
  serviceReadiness
} = {}) {
  const calls = Object.fromEntries(NAMES.map((name) => [name, 0]));
  function counted(name, result) {
    return async () => {
      calls[name] += 1;
      return typeof result === "function" ? result() : result;
    };
  }
  const service = {
    async authenticate() {
      throw new Error("not reached");
    },
    readiness: counted("service", serviceReadiness ?? {
      ready: true,
      registration: { ready: true, verified: true },
      recovery: { ready: true, verified: true },
      providers: {
        domains: FULL_DOMAIN_READINESS
      },
      publication: { ready: true, held: false },
      privateCustomer: "customer@example.test"
    })
  };
  const api = createHostedApi(service, {
    capabilitiesPolicy: {
      ttlMs: 20,
      timeoutMs: 10,
      now: at
    },
    downloadCommerce: methods(
      ["createQuote", "prepareCheckout", "download"],
      counted("download", { quote: true, payment: true })
    ),
    alakazamBilling: methods(
      ["createQuote", "createCheckout", "scheduleDowngrade"],
      counted("billing", {
        quote: true,
        checkout: true,
        downgrade: true
      })
    ),
    alakazam35: methods(
      ["getSnapshot", "requestCare", "saveConfiguration", "uploadPhoto"],
      counted("alakazam35", {
        authorization: true,
        providerEffects: false
      })
    ),
    alakazam50: methods(
      ["getSnapshot", "requestCare", "saveConfiguration"],
      counted("alakazam50", {
        authorization: true,
        providerEffects: false
      })
    ),
    alakazamRetainedPremium: methods(
      ["getSnapshot", "getExport", "restoreConfiguration"],
      counted("retained", {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held"
      })
    ),
    alakazamPublication: methods(
      ["getSnapshot", "requestCommand"],
      counted("publication", {
        authorization: true,
        providerEffects: false
      })
    ),
    resendMailEvents: {
      kind: "resend-mail-event-http-adapter",
      mode: "raw-body",
      providerEffects: false,
      readiness: counted("mailEvents", {
        ready: true,
        verified: true
      }),
      async handle() {
        throw new Error("not reached");
      }
    },
    twilioResponderEvents: {
      kind: "twilio-responder-events-http-adapter",
      mode: "raw-form",
      providerEffects: false,
      readiness: counted("responderEvents", {
        ready: true,
        verified: true,
        providerEffects: false
      }),
      async handle() {
        throw new Error("not reached");
      }
    },
    twilioResponderInbound: {
      kind: "twilio-responder-inbound-http-adapter",
      mode: "raw-form",
      providerEffects: false,
      readiness: counted("responderInbound", {
        ready: true,
        verified: true,
        providerEffects: false
      }),
      async handle() {
        throw new Error("not reached");
      }
    },
    careSurfaces: {
      kind: "care-surfaces",
      mode: "held-local",
      customerEffects: false,
      mailDeliveryEffects: false,
      paymentEffects: false,
      providerEffects: false,
      readiness: counted("care", {
        ready: true,
        verified: true,
        customerEffects: false,
        mailReservation: {
          deliveryEffects: false,
          providerEffects: false
        },
        paymentEffects: false,
        providerEffects: false
      }),
      ...Object.fromEntries([
        "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
        "readCustomer", "readOperator", "requestCustomerTicket",
        "reserveTicketMail", "transitionTicket"
      ].map((name) => [name, async () => {
        throw new Error("not reached");
      }]))
    },
    careCommerce: includeCareCommerce
      ? {
          kind: "care-commerce",
          mode: "held-local",
          commercialEffects: false,
          customerEffects: false,
          mailDeliveryEffects: false,
          paymentEffects: false,
          providerEffects: false,
          readiness: counted(
            "careCommerce",
            careCommerceReadiness
          ),
          ...Object.fromEntries([
            "cancelHeldReservation", "createHeldQuote",
            "markReservationAmbiguous", "readCustomerCatalog",
            "readCustomerReservation", "readOperatorCatalog",
            "requestReversal", "reserveHeldInvoice"
          ].map((name) => [name, async () => {
            throw new Error("not reached");
          }]))
        }
      : null,
    responderSurfaces: {
      kind: "responder-surfaces",
      mode: "held",
      providerEffects: false,
      billingEffects: false,
      sellable: false,
      readiness: counted("responder", {
        ready: true,
        verified: true,
        providerEffects: false,
        billingEffects: false,
        sellable: false
      }),
      ...Object.fromEntries([
        "engageGlobalKill", "readCustomer", "readOperator",
        "recordCustomerConsent", "recordOperatorConsent", "requestHandoff",
        "reserveHeldMessage", "stop"
      ].map((name) => [name, async () => {
        throw new Error("not reached");
      }]))
    },
    responderCommerce: includeResponderCommerce
      ? {
          kind: "responder-commerce",
          mode: "held-local",
          commercialEffects: false,
          customerEffects: false,
          mailDeliveryEffects: false,
          paymentEffects: false,
          providerEffects: false,
          readiness: counted(
            "responderCommerce",
            responderCommerceReadiness
          ),
          ...Object.fromEntries([
            "cancelHeldReservation", "createHeldQuote",
            "markReservationAmbiguous", "readCustomerQuote",
            "readCustomerReservation", "readOperatorCatalog",
            "requestReversal", "reserveHeldBilling"
          ].map((name) => [name, async () => {
            throw new Error("not reached");
          }]))
        }
      : null,
    responderForwarding: includeResponderForwarding
      ? {
          repository: {
            kind: "responder-forwarding-postgres",
            mode: "held-local",
            automaticCarrierCommands: false,
            remoteWriteEffects: false,
            providerEffects: false,
            messageSendEffects: false,
            readiness: counted(
              "responderForwarding",
              responderForwardingReadiness
            ),
            async list() {
              throw new Error("not reached");
            },
            async create() {
              throw new Error("not reached");
            },
            async recordObservation() {
              throw new Error("not reached");
            },
            async retire() {
              throw new Error("not reached");
            }
          },
          lookupDigests: {
            kind: "responder-lookup-digests",
            numberLookupCandidates() {
              throw new Error("not reached");
            }
          }
        }
      : null,
    responderNativeClient: includeResponderNativeClient
      ? {
          repository: {
            kind: "responder-native-client-postgres",
            mode: "held-local",
            providerEffects: false,
            pushDeliveryEffects: false,
            voiceCallEffects: false,
            carrierCommandEffects: false,
            messageSendEffects: false,
            readiness: counted(
              "responderNativeClient",
              responderNativeClientReadiness
            ),
            ...Object.fromEntries([
              "createInstallation", "getInstallation",
              "listInstallations", "registerToken",
              "requireHeldVoipSession", "suspendInstallation",
              "resumeInstallation", "revokeInstallation"
            ].map((name) => [name, async () => {
              throw new Error("not reached");
            }]))
          },
          tokenAuthority: {
            kind: "responder-native-token-authority",
            providerEffects: false,
            pushDeliveryEffects: false,
            readiness: counted(
              "responderNativeToken",
              responderNativeTokenReadiness
            ),
            tokenLookupCandidates() {
              throw new Error("not reached");
            },
            async sealToken() {
              throw new Error("not reached");
            }
          }
        }
      : null
  });
  return { api, calls };
}

function get(api, path = "/api/v1/capabilities") {
  return api.fetch(new Request(`${ORIGIN}${path}`));
}

test("capabilities singleflight the complete public fanout, cache by TTL, and stay separate from readiness", async () => {
  let at = 1_000;
  const gate = deferred();
  const fixture = apiFixture({
    at: () => at,
    serviceReadiness: async () => {
      await gate.promise;
      return {
        ready: true,
        registration: { ready: true, verified: true },
        recovery: { ready: true, verified: true },
        providers: {
          domains: FULL_DOMAIN_READINESS
        },
        publication: { ready: true, held: false },
        privateProviderDetail: "must-not-escape"
      };
    }
  });
  const pending = Array.from({ length: 24 }, () => get(fixture.api));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  gate.resolve();
  const responses = await Promise.all(pending);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(responses.every((response) => response.status === 200), true);
  assert.deepEqual([...new Set(bodies.map(JSON.stringify))], [
    JSON.stringify(EXPECTED)
  ]);
  assert.equal(JSON.stringify(bodies).includes("must-not-escape"), false);

  assert.deepEqual(await (await get(fixture.api)).json(), EXPECTED);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));

  const ready = await get(fixture.api, "/api/v1/ready");
  assert.equal(ready.status, 200);
  assert.equal(fixture.calls.service, 2);
  assert.equal(fixture.calls.download, 1);

  at += 21;
  assert.deepEqual(await (await get(fixture.api)).json(), EXPECTED);
  assert.equal(fixture.calls.service, 3);
  for (const name of NAMES.filter((name) => name !== "service")) {
    assert.equal(fixture.calls[name], 2, name);
  }
});

test("capabilities distinguish a mounted held Domain runtime from purchase authority", async () => {
  const fixture = apiFixture({
    serviceReadiness: {
      ready: true,
      registration: { ready: true, verified: true },
      recovery: { ready: true, verified: true },
      providers: {
        domains: MOUNTED_HELD_DOMAIN_READINESS
      },
      publication: { ready: true, held: false }
    }
  });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...EXPECTED,
    domains: MOUNTED_HELD_DOMAIN_READINESS,
    domainPurchase: false
  });
});

test("capabilities do not claim complete Care without its commerce mount", async () => {
  const fixture = apiFixture({ includeCareCommerce: false });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...EXPECTED,
    care: false,
    careCommerce: {
      ready: false,
      mounted: false,
      mode: "held-local",
      commercialReady: false,
      taxPurposeReleased: false,
      commercialEffects: false,
      customerEffects: false,
      mailDeliveryEffects: false,
      paymentEffects: false,
      providerEffects: false
    }
  });
  assert.equal(fixture.calls.care, 1);
  assert.equal(fixture.calls.careCommerce, 0);
});

test("capabilities fail Care closed when mail reservation is unverified", async () => {
  const fixture = apiFixture({
    careCommerceReadiness: {
      ...FULL_CARE_COMMERCE_READINESS,
      verified: false,
      mailReservationReady: false
    }
  });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.care, false);
  assert.deepEqual(body.careCommerce, {
    ...FULL_CARE_COMMERCE_CAPABILITY,
    ready: false
  });
});

test("capabilities do not claim complete Responder without durable commerce", async () => {
  const fixture = apiFixture({ includeResponderCommerce: false });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...EXPECTED,
    responder: false,
    responderCommerce: {
      ready: false,
      mounted: false,
      mode: "held-local",
      durableCommercialState: false,
      catalogAuthorityVerified: false,
      taxPurposeReleased: false,
      sellable: false,
      commercialEffects: false,
      customerEffects: false,
      mailDeliveryEffects: false,
      paymentEffects: false,
      providerEffects: false
    }
  });
  assert.equal(fixture.calls.responder, 1);
  assert.equal(fixture.calls.responderCommerce, 0);
});

test("capabilities do not claim complete Responder without carrier-preserving forwarding", async () => {
  const fixture = apiFixture({ includeResponderForwarding: false });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...EXPECTED,
    responder: false,
    responderForwarding: {
      ready: false,
      mounted: false,
      mode: "held-local",
      retainedCarrier: true,
      launchMode: "conditional_no_answer_forwarding",
      initialAdapter: "twilio",
      automaticCarrierCommands: false,
      remoteWriteEffects: false,
      providerEffects: false,
      messageSendEffects: false
    }
  });
  assert.equal(fixture.calls.responder, 1);
  assert.equal(fixture.calls.responderForwarding, 0);
});

test("capabilities do not claim complete Responder without native-client authority", async () => {
  const fixture = apiFixture({ includeResponderNativeClient: false });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...EXPECTED,
    responder: false,
    responderNativeClient: {
      ready: false,
      backendReady: false,
      clientsReady: false,
      mounted: false,
      mode: "held-local",
      acceptedRegistrationPlatforms: ["ios", "android"],
      initialClient: "ios",
      clientArtifacts: { ios: false, android: false },
      tokenStorage: "sealed",
      voipSessionState: "held",
      providerEffects: false,
      pushDeliveryEffects: false,
      voiceCallEffects: false,
      carrierCommandEffects: false,
      messageSendEffects: false
    }
  });
  assert.equal(fixture.calls.responder, 1);
  assert.equal(fixture.calls.responderNativeClient, 0);
  assert.equal(fixture.calls.responderNativeToken, 0);
});

test("capabilities report backend-only native authority without claiming apps", async () => {
  const fixture = apiFixture();
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.responder, false);
  assert.deepEqual(
    body.responderNativeClient,
    FULL_RESPONDER_NATIVE_CLIENT_CAPABILITY
  );
});

test("capabilities fail native backend closed when token authority degrades", async () => {
  const fixture = apiFixture({
    responderNativeTokenReadiness: {
      ...FULL_RESPONDER_NATIVE_TOKEN_READINESS,
      ready: false,
      verified: false
    }
  });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.responder, false);
  assert.deepEqual(body.responderNativeClient, {
    ...FULL_RESPONDER_NATIVE_CLIENT_CAPABILITY,
    backendReady: false
  });
});

test("capabilities fail native backend closed when storage ACL readiness drifts", async () => {
  const fixture = apiFixture({
    responderNativeClientReadiness: {
      ...FULL_RESPONDER_NATIVE_CLIENT_READINESS,
      ready: false,
      verified: false,
      code: "RESPONDER_NATIVE_CLIENT_STORAGE_NOT_READY"
    }
  });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.responder, false);
  assert.deepEqual(body.responderNativeClient, {
    ...FULL_RESPONDER_NATIVE_CLIENT_CAPABILITY,
    backendReady: false
  });
});

test("capabilities fail Responder closed when commerce catalog authority drifts", async () => {
  const fixture = apiFixture({
    responderCommerceReadiness: {
      ...FULL_RESPONDER_COMMERCE_READINESS,
      verified: false,
      catalogAuthorityVerified: false
    }
  });
  const response = await get(fixture.api);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.responder, false);
  assert.deepEqual(body.responderCommerce, {
    ...FULL_RESPONDER_COMMERCE_CAPABILITY,
    ready: false,
    catalogAuthorityVerified: false
  });
});

test("capabilities timeout once without amplifying a hung dependency", async () => {
  const fixture = apiFixture({
    serviceReadiness: () => new Promise(() => {})
  });
  const responses = await Promise.all(
    Array.from({ length: 16 }, () => get(fixture.api))
  );
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  for (const response of responses) {
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "CAPABILITIES_UNAVAILABLE");
    assert.equal(body.error.message, "Hosted capabilities are unavailable.");
  }
  assert.equal((await get(fixture.api)).status, 503);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
});

test("capabilities failure is fixed, PII-free, cached, and singleflighted", async () => {
  const gate = deferred();
  const fixture = apiFixture({
    at: () => 1_000,
    serviceReadiness: async () => {
      await gate.promise;
      throw new Error("customer@example.test sk_live_must_not_escape");
    }
  });
  const pending = Array.from({ length: 16 }, () => get(fixture.api));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  gate.resolve();
  const responses = await Promise.all(pending);
  for (const response of responses) {
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "CAPABILITIES_UNAVAILABLE");
    assert.equal(JSON.stringify(body).includes("customer@example.test"), false);
    assert.equal(JSON.stringify(body).includes("sk_live"), false);
  }
  assert.equal((await get(fixture.api)).status, 503);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
});
