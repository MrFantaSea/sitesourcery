import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createHeldResendMailEventWebhook,
  createResendMailEventWebhook
} from "../resend-mail-events.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const CLOCK = { now: () => NOW };
const KEY = Buffer.from("fixed-test-resend-webhook-key-01", "utf8");
const SECRET = `whsec_${KEY.toString("base64")}`;
const WEBHOOK_ID = "msg_event_00000001";
const MESSAGE_ID = "49f9f02a-93f5-4ddf-9e84-01df500701d4";

function request(type, {
  payload = {
    type,
    created_at: NOW,
    data: { email_id: MESSAGE_ID }
  },
  bodyTransform = (value) => value,
  timestamp = String(Date.parse(NOW) / 1000),
  signatureTransform = (value) => value,
  contentType = "application/json"
} = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const rawBody = bodyTransform(body);
  const signature = createHmac("sha256", KEY)
    .update(Buffer.from(`${WEBHOOK_ID}.${timestamp}.`, "utf8"))
    .update(body)
    .digest("base64");
  return {
    rawBody,
    headers: {
      "content-type": contentType,
      "svix-id": WEBHOOK_ID,
      "svix-timestamp": timestamp,
      "svix-signature": signatureTransform(`v1,${signature}`)
    }
  };
}

function lifecycle({ result = { eventState: "applied", currentState: "delivered" } } = {}) {
  const calls = [];
  return {
    calls,
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true, providerEffects: false };
    },
    async ingestProviderEvent(input) {
      calls.push(input);
      return { eventKind: input.eventKind, ...result };
    }
  };
}

test("held Resend event ingress is explicit and performs no provider effect", async () => {
  const webhook = createHeldResendMailEventWebhook();
  assert.equal(webhook.providerEffects, false);
  assert.equal((await webhook.readiness()).ready, false);
  await assert.rejects(
    webhook.ingest(request("email.delivered")),
    (error) => error?.code === "RESEND_WEBHOOK_HELD" &&
      error?.details?.providerEffects === false
  );
});

test("verified terminal events map to digest-only durable lifecycle facts", async () => {
  const mappings = [
    ["email.delivered", "delivered"],
    ["email.bounced", "bounced"],
    ["email.failed", "bounced"],
    ["email.complained", "complained"],
    ["email.suppressed", "suppressed"]
  ];
  for (const [providerType, eventKind] of mappings) {
    const durable = lifecycle({
      result: { eventState: "applied", currentState: eventKind }
    });
    const webhook = createResendMailEventWebhook({
      signingSecret: SECRET,
      lifecycle: durable,
      clock: CLOCK
    });
    const receipt = await webhook.ingest(request(providerType));
    assert.deepEqual(receipt, {
      schema: "sitesourcery.resend-mail-event-receipt/v1",
      httpStatus: 200,
      eventState: "applied",
      eventKind,
      currentState: eventKind,
      providerEffects: false
    });
    assert.equal(durable.calls.length, 1);
    const fact = durable.calls[0];
    assert.equal(fact.provider, "resend");
    assert.equal(fact.eventKind, eventKind);
    assert.equal(fact.occurredAt, NOW);
    for (const field of [
      "providerEventIdDigest",
      "providerMessageIdDigest",
      "signatureVerificationDigest",
      "evidenceDigest"
    ]) assert.match(fact[field], /^[0-9a-f]{64}$/u);
    const serialized = JSON.stringify({ receipt, fact });
    assert.equal(serialized.includes(MESSAGE_ID), false);
    assert.equal(serialized.includes(WEBHOOK_ID), false);
    assert.equal(serialized.includes(SECRET), false);
  }
});

test("a verified but unauthorized nonterminal event fails without lifecycle mutation", async () => {
  const durable = lifecycle();
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle: durable,
    clock: CLOCK
  });
  await assert.rejects(
    webhook.ingest(request("email.sent")),
    (error) => error?.code === "RESEND_WEBHOOK_INVALID"
  );
  assert.equal(durable.calls.length, 0);
});

test("signature, raw-byte, freshness, and content gates fail before mutation", async () => {
  const durable = lifecycle();
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle: durable,
    clock: CLOCK
  });
  const cases = [
    request("email.delivered", {
      bodyTransform: (body) => Buffer.concat([body, Buffer.from(" ")])
    }),
    request("email.delivered", {
      timestamp: String(Date.parse(NOW) / 1000 - 301)
    }),
    request("email.delivered", {
      timestamp: String(Date.parse(NOW) / 1000 + 301)
    }),
    request("email.delivered", {
      signatureTransform: () => `v1,${Buffer.alloc(32).toString("base64")}`
    }),
    request("email.delivered", { signatureTransform: () => "v1,garbage" }),
    request("email.delivered", { contentType: "text/plain" })
  ];
  for (const input of cases) {
    await assert.rejects(
      webhook.ingest(input),
      (error) => [
        "RESEND_WEBHOOK_INVALID",
        "RESEND_WEBHOOK_SIGNATURE_INVALID"
      ].includes(error?.code)
    );
  }
  await assert.rejects(
    webhook.ingest({ ...request("email.delivered"), rawBody: "not raw bytes" }),
    (error) => error?.code === "RESEND_WEBHOOK_INVALID"
  );
  await assert.rejects(
    webhook.ingest({
      ...request("email.delivered"),
      rawBody: Buffer.alloc(64 * 1024 + 1, 97)
    }),
    (error) => error?.code === "RESEND_WEBHOOK_INVALID"
  );
  assert.equal(durable.calls.length, 0);
});

test("unknown or malformed signed payloads fail closed", async () => {
  const durable = lifecycle();
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle: durable,
    clock: CLOCK
  });
  await assert.rejects(
    webhook.ingest(request("email.unreviewed")),
    (error) => error?.code === "RESEND_WEBHOOK_INVALID"
  );
  const missingId = request("email.complained", {
    payload: {
      type: "email.complained",
      created_at: NOW,
      data: {}
    }
  });
  await assert.rejects(
    webhook.ingest(missingId),
    (error) => error?.code === "RESEND_WEBHOOK_INVALID"
  );
  assert.equal(durable.calls.length, 0);
});

test("replay identity is stable and readiness follows the durable lifecycle", async () => {
  const durable = lifecycle({ result: { eventState: "applied", currentState: "bounced" } });
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle: durable,
    clock: CLOCK
  });
  assert.equal((await webhook.readiness()).ready, true);
  await webhook.ingest(request("email.bounced"));
  await webhook.ingest(request("email.bounced"));
  assert.equal(durable.calls.length, 2);
  assert.deepEqual(durable.calls[1], durable.calls[0]);
});

test("HTTP-success receipt is withheld for an unknown durable response", async () => {
  const durable = lifecycle({ result: { eventState: "unknown", currentState: null } });
  const webhook = createResendMailEventWebhook({
    signingSecret: SECRET,
    lifecycle: durable,
    clock: CLOCK
  });
  await assert.rejects(
    webhook.ingest(request("email.delivered")),
    (error) => error?.code === "RESEND_WEBHOOK_DURABLE_RECEIPT_INVALID" &&
      error?.status === 503
  );
});

test("construction rejects malformed secret and lifecycle authority", () => {
  assert.throws(
    () => createResendMailEventWebhook({
      signingSecret: "whsec_not-base64!",
      lifecycle: lifecycle(),
      clock: CLOCK
    }),
    (error) => error?.code === "RESEND_WEBHOOK_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createResendMailEventWebhook({
      signingSecret: SECRET,
      lifecycle: { providerEffects: true, async ingestProviderEvent() {} },
      clock: CLOCK
    }),
    (error) => error?.code === "RESEND_WEBHOOK_CONFIGURATION_REQUIRED"
  );
});
