import assert from "node:assert/strict";
import test from "node:test";

import {
  createTwilioResponderTransport,
  responderSmsContentDigest,
  responderSmsRouteDigest
} from "../twilio-responder-transport.mjs";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const API_KEY_SID = `SK${"b".repeat(32)}`;
const MESSAGING_SERVICE_SID = `MG${"c".repeat(32)}`;
const BRAND_SID = `BN${"d".repeat(32)}`;
const CAMPAIGN_SID = `QE${"e".repeat(32)}`;
const MESSAGE_SID = `SM${"f".repeat(32)}`;
const TO = "+18562441220";
const BODY = [
  "Sorry we missed you - this is Site Sourcery.",
  "Reply here and we will get straight back to you.",
  "Reply STOP to opt out."
].join(" ");
const ROUTE_DIGEST = responderSmsRouteDigest(TO);
const CONTENT_DIGEST = responderSmsContentDigest(BODY);
const NOW = "2026-08-12T21:00:00.000Z";
const ENVIRONMENT = Object.freeze({
  SITESOURCERY_TWILIO_ACCOUNT_SID: ACCOUNT_SID,
  SITESOURCERY_TWILIO_API_KEY_SID: API_KEY_SID,
  SITESOURCERY_TWILIO_API_KEY_SECRET:
    "fixture-api-key-secret-not-real-0001",
  SITESOURCERY_TWILIO_MESSAGING_SERVICE_SID:
    MESSAGING_SERVICE_SID,
  SITESOURCERY_TWILIO_BRAND_REGISTRATION_SID: BRAND_SID,
  SITESOURCERY_TWILIO_A2P_CAMPAIGN_SID: CAMPAIGN_SID,
  SITESOURCERY_TWILIO_STATUS_CALLBACK_URL:
    "https://sitesourcery.com/api/v1/provider-events/twilio"
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function providerReadback(url) {
  if (url.includes(`/Accounts/${ACCOUNT_SID}.json`)) {
    return json({ sid: ACCOUNT_SID, status: "active", type: "Full" });
  }
  if (url.endsWith(`/Services/${MESSAGING_SERVICE_SID}`)) {
    return json({
      sid: MESSAGING_SERVICE_SID,
      account_sid: ACCOUNT_SID,
      friendly_name: "Responder"
    });
  }
  if (url.endsWith(`/BrandRegistrations/${BRAND_SID}`)) {
    return json({
      sid: BRAND_SID,
      account_sid: ACCOUNT_SID,
      status: "APPROVED",
      identity_status: "VERIFIED",
      brand_type: "STANDARD",
      mock: false
    });
  }
  if (url.endsWith(`/Compliance/Usa2p/${CAMPAIGN_SID}`)) {
    return json({
      sid: CAMPAIGN_SID,
      account_sid: ACCOUNT_SID,
      messaging_service_sid: MESSAGING_SERVICE_SID,
      brand_registration_sid: BRAND_SID,
      campaign_status: "VERIFIED",
      usecase: "CUSTOMER_CARE"
    });
  }
  throw new Error(`unexpected readback URL ${url}`);
}

function materialResolver(overrides = {}) {
  return Object.freeze({
    kind: "responder-private-delivery-material-resolver",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async resolveSmsMaterial() {
      return {
        schema: "sitesourcery.responder-private-sms-material/v1",
        routeDigest: ROUTE_DIGEST,
        contentDigest: CONTENT_DIGEST,
        to: TO,
        body: BODY,
        ...overrides
      };
    }
  });
}

function delivery(overrides = {}) {
  return {
    schema: "sitesourcery.responder-fulfillment-request/v1",
    operationId: "10000000-0000-4000-8000-000000000001",
    commandId: "responder-message-command-0001",
    organizationId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    interactionId: "10000000-0000-4000-8000-000000000004",
    contactAuthorityId: "10000000-0000-4000-8000-000000000005",
    messageKind: "missed_call_ack",
    routeDigest: ROUTE_DIGEST,
    contentDigest: CONTENT_DIGEST,
    idempotencyKey: "responder-delivery-command-0001",
    signal: null,
    ...overrides
  };
}

test("Twilio Responder requires every exact provider identity and callback", () => {
  for (const environment of [
    {},
    { ...ENVIRONMENT, SITESOURCERY_TWILIO_ACCOUNT_SID: "ACwrong" },
    { ...ENVIRONMENT, SITESOURCERY_TWILIO_API_KEY_SECRET: "short" },
    {
      ...ENVIRONMENT,
      SITESOURCERY_TWILIO_STATUS_CALLBACK_URL:
        "https://example.test/api/v1/provider-events/twilio"
    }
  ]) {
    assert.throws(
      () => createTwilioResponderTransport({
        environment,
        materialResolver: materialResolver()
      }),
      (error) => error?.code ===
        "TWILIO_RESPONDER_CONFIGURATION_REQUIRED"
    );
  }
});

test("readiness proves full account, Responder service, brand, campaign, and private material", async () => {
  const calls = [];
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: materialResolver(),
    async fetchImpl(url, init) {
      calls.push({ url, init });
      return providerReadback(url);
    }
  });
  assert.deepEqual(await transport.readiness(), {
    ready: true,
    verified: true,
    provider: "twilio",
    code: null
  });
  assert.deepEqual(await transport.readiness(), {
    ready: true,
    verified: true,
    provider: "twilio",
    code: null
  });
  assert.equal(calls.length, 4);
  assert.equal(calls.every(({ init }) => init.method === "GET"), true);
  assert.equal(calls.every(({ init }) => init.body === undefined), true);
  const expectedAuthorization = `Basic ${Buffer.from(
    `${API_KEY_SID}:${ENVIRONMENT.SITESOURCERY_TWILIO_API_KEY_SECRET}`
  ).toString("base64")}`;
  assert.equal(calls.every(({ init }) =>
    new Headers(init.headers).get("authorization") ===
      expectedAuthorization), true);
  assert.equal(JSON.stringify(await transport.readiness()).includes("SID"), false);
});

test("any provider or private-material readback drift keeps Twilio held", async () => {
  const cases = [
    ["account", (url) => url.includes("Accounts/")
      ? json({ sid: ACCOUNT_SID, status: "suspended", type: "Full" })
      : providerReadback(url)],
    ["service", (url) => url.endsWith(`/Services/${MESSAGING_SERVICE_SID}`)
      ? json({ sid: MESSAGING_SERVICE_SID, account_sid: ACCOUNT_SID,
          friendly_name: "Other" })
      : providerReadback(url)],
    ["campaign", (url) => url.includes("Compliance/Usa2p")
      ? json({ sid: CAMPAIGN_SID, account_sid: ACCOUNT_SID,
          messaging_service_sid: MESSAGING_SERVICE_SID,
          brand_registration_sid: BRAND_SID,
          campaign_status: "IN_PROGRESS", usecase: "CUSTOMER_CARE" })
      : providerReadback(url)]
  ];
  for (const [name, fetchImpl] of cases) {
    const transport = createTwilioResponderTransport({
      environment: ENVIRONMENT,
      materialResolver: materialResolver(),
      fetchImpl,
      readinessCacheMs: 0
    });
    const status = await transport.readiness();
    assert.equal(status.ready, false, name);
    assert.equal(status.code, "TWILIO_RESPONDER_NOT_VERIFIED", name);
  }

  const heldMaterial = materialResolver();
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: {
      ...heldMaterial,
      async readiness() { return { ready: false, verified: false }; }
    },
    fetchImpl: providerReadback,
    readinessCacheMs: 0
  });
  assert.equal((await transport.readiness()).ready, false);
});

test("one exact private SMS material record creates one Twilio Message without fake idempotency", async () => {
  const calls = [];
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: materialResolver(),
    clock: { now: () => NOW },
    async fetchImpl(url, init) {
      calls.push({ url, init });
      if (init.method === "GET") return providerReadback(url);
      return json({
        sid: MESSAGE_SID,
        account_sid: ACCOUNT_SID,
        messaging_service_sid: MESSAGING_SERVICE_SID,
        to: TO,
        body: BODY,
        status: "accepted"
      }, 201);
    }
  });
  const receipt = await transport.sendMessage(delivery());
  assert.deepEqual(receipt, {
    status: "accepted",
    provider: "twilio",
    idempotencyKey: "responder-delivery-command-0001",
    providerMessageIdDigest: receipt.providerMessageIdDigest,
    providerReceiptDigest: receipt.providerReceiptDigest,
    acceptedAt: NOW
  });
  assert.match(receipt.providerReceiptDigest, /^[0-9a-f]{64}$/u);
  assert.match(receipt.providerMessageIdDigest, /^[0-9a-f]{64}$/u);
  const sent = calls.at(-1);
  assert.equal(
    sent.url,
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`
  );
  assert.equal(sent.init.method, "POST");
  const headers = new Headers(sent.init.headers);
  assert.equal(headers.has("idempotency-key"), false);
  assert.equal(headers.get("content-type"),
    "application/x-www-form-urlencoded");
  assert.ok(sent.init.body instanceof URLSearchParams);
  assert.deepEqual(Object.fromEntries(sent.init.body), {
    To: TO,
    MessagingServiceSid: MESSAGING_SERVICE_SID,
    Body: BODY,
    StatusCallback:
      "https://sitesourcery.com/api/v1/provider-events/twilio",
    ValidityPeriod: "300"
  });
  assert.equal(JSON.stringify(receipt).includes(MESSAGE_SID), false);
  assert.equal(JSON.stringify(receipt).includes(TO), false);
  assert.equal(JSON.stringify(receipt).includes(BODY), false);
});

test("route, content, STOP copy, and expanded request drift fail before provider send", async () => {
  let postCalls = 0;
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: materialResolver({
      body: "Sorry we missed you.",
      contentDigest: responderSmsContentDigest("Sorry we missed you.")
    }),
    async fetchImpl(url, init) {
      if (init.method === "POST") postCalls += 1;
      return providerReadback(url);
    }
  });
  await assert.rejects(
    transport.sendMessage(delivery({
      contentDigest: responderSmsContentDigest("Sorry we missed you.")
    })),
    (error) => error?.code === "TWILIO_RESPONDER_MATERIAL_INVALID"
  );
  await assert.rejects(
    transport.sendMessage(delivery({ phoneNumber: TO })),
    (error) => error?.code === "TWILIO_RESPONDER_DELIVERY_INVALID"
  );
  assert.equal(postCalls, 0);
});

test("an uncertain Twilio create result is manual-review-only", async () => {
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: materialResolver(),
    async fetchImpl(url, init) {
      if (init.method === "GET") return providerReadback(url);
      throw new Error("socket ended after request bytes");
    }
  });
  await assert.rejects(
    transport.sendMessage(delivery()),
    (error) =>
      error?.code === "TWILIO_RESPONDER_DELIVERY_UNCERTAIN" &&
      error.deliveryDisposition === "manual_review" &&
      error.providerEffectCertainty === "unknown" &&
      !JSON.stringify(error).includes(TO)
  );
});

test("a malformed Twilio acceptance never becomes a durable receipt", async () => {
  const transport = createTwilioResponderTransport({
    environment: ENVIRONMENT,
    materialResolver: materialResolver(),
    async fetchImpl(url, init) {
      if (init.method === "GET") return providerReadback(url);
      return json({
        sid: MESSAGE_SID,
        account_sid: ACCOUNT_SID,
        messaging_service_sid: MESSAGING_SERVICE_SID,
        to: TO,
        body: BODY,
        status: "queued"
      }, 201);
    }
  });
  await assert.rejects(
    transport.sendMessage(delivery()),
    (error) => error?.code === "TWILIO_RESPONDER_RECEIPT_INVALID"
  );
});
