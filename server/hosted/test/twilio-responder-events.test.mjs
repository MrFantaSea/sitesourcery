import assert from "node:assert/strict";
import test from "node:test";
import twilio from "twilio";

import {
  createHeldTwilioResponderEvents,
  createTwilioResponderEvents
} from "../twilio-responder-events.mjs";

const NOW = "2026-08-12T21:00:00.000Z";
const CALLBACK =
  "https://sitesourcery.com/api/v1/provider-events/twilio";
const ACCOUNT = `AC${"1".repeat(32)}`;
const MESSAGE = `SM${"2".repeat(32)}`;
const TOKEN = "3".repeat(32);
const OTHER_ACCOUNT = `AC${"4".repeat(32)}`;
const OTHER_TOKEN = "5".repeat(32);

function providerDependencies() {
  const topology = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    accountSidDigest: "a".repeat(64)
  };
  const otherTopology = {
    organizationId: "00000000-0000-4000-8000-000000000002",
    accountSidDigest: "b".repeat(64)
  };
  return {
    providerRegistry: {
      kind: "twilio-isv-provider-registry",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      resolveAccountSid(accountSid) {
        if (accountSid === ACCOUNT) {
          return { webhookAuthToken: TOKEN, topology };
        }
        if (accountSid === OTHER_ACCOUNT) {
          return { webhookAuthToken: OTHER_TOKEN, topology: otherTopology };
        }
        throw new Error("unknown account");
      }
    },
    providerTopologyRepository: {
      kind: "responder-twilio-provider-topology-postgres",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async requireActiveTopology(selected) {
        assert.equal(
          selected === topology || selected === otherTopology,
          true
        );
        return selected;
      }
    }
  };
}

function repository() {
  const calls = [];
  return {
    calls,
    selected: {
      kind: "twilio-responder-events-postgres",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async ingestDeliveryStatus(input) {
        calls.push(structuredClone(input));
        return {
          schema:
            "sitesourcery.responder-twilio-delivery-event-receipt/v1",
          eventState: "applied",
          messageStatus: input.messageStatus,
          currentStatus: input.messageStatus,
          attentionRequired: false,
          replayed: false,
          providerEffects: false
        };
      }
    }
  };
}

function signed({
  status = "delivered",
  extra = {},
  signature = null,
  signatureToken = TOKEN,
  accountSid = ACCOUNT,
  messageSid = MESSAGE
} = {}) {
  const params = {
    AccountSid: accountSid,
    MessageSid: messageSid,
    MessageStatus: status,
    SmsSid: messageSid,
    SmsStatus: status,
    From: "+15555550100",
    To: "+15555550101",
    ...extra
  };
  const rawBody = Buffer.from(new URLSearchParams(params).toString());
  return {
    rawBody,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature ??
        twilio.getExpectedTwilioSignature(signatureToken, CALLBACK, params)
    }
  };
}

test("official Twilio validation accepts every received form field and stores digests only", async () => {
  const durable = repository();
  const events = createTwilioResponderEvents({
    ...providerDependencies(),
    callbackUrl: CALLBACK,
    repository: durable.selected,
    clock: { now: () => NOW }
  });
  assert.deepEqual(await events.readiness(), {
    ready: true,
    verified: true,
    kind: "twilio-responder-events",
    mode: "verified-status-callback",
    providerEffects: false,
    code: null
  });
  const result = await events.ingest(signed({
    extra: { FutureProviderField: "accepted-by-validator" }
  }));
  assert.equal(result.eventState, "applied");
  assert.equal(durable.calls.length, 1);
  assert.deepEqual(Object.keys(durable.calls[0]).sort(), [
    "accountSidDigest", "errorCodeDigest", "messageStatus",
    "payloadDigest", "provider", "providerEventDigest",
    "providerMessageIdDigest", "receivedAt",
    "signatureVerificationDigest"
  ].sort());
  assert.match(durable.calls[0].providerMessageIdDigest, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(durable.calls),
    /SM222|AC111|\+1555|FutureProviderField|accepted-by-validator/u
  );
});

test("signature, account, SID, and status drift fail before durable mutation", async () => {
  for (const request of [
    signed({ signature: "A".repeat(27) + "=" }),
    signed({ accountSid: `AC${"9".repeat(32)}` }),
    signed({ messageSid: "SMbad" }),
    signed({ status: "accepted" }),
    signed({ extra: { SmsStatus: "failed" } })
  ]) {
    const durable = repository();
    const events = createTwilioResponderEvents({
      ...providerDependencies(),
      callbackUrl: CALLBACK,
      repository: durable.selected,
      clock: { now: () => NOW }
    });
    await assert.rejects(
      events.ingest(request),
      (error) => [
        "TWILIO_RESPONDER_EVENT_INVALID",
        "TWILIO_RESPONDER_EVENT_SIGNATURE_INVALID"
      ].includes(error?.code)
    );
    assert.equal(durable.calls.length, 0);
  }
});

test("one customer's Auth Token cannot authenticate another customer's delivery callback", async () => {
  const durable = repository();
  const events = createTwilioResponderEvents({
    ...providerDependencies(),
    callbackUrl: CALLBACK,
    repository: durable.selected,
    clock: { now: () => NOW }
  });
  await assert.rejects(
    events.ingest(signed({ signatureToken: OTHER_TOKEN })),
    (error) => error?.code === "TWILIO_RESPONDER_EVENT_SIGNATURE_INVALID"
  );
  assert.equal(durable.calls.length, 0);
});

test("Twilio callback stays held by default and configuration is exact", async () => {
  const held = createHeldTwilioResponderEvents();
  assert.equal((await held.readiness()).ready, false);
  await assert.rejects(
    held.ingest({}),
    (error) => error?.code === "TWILIO_RESPONDER_EVENTS_HELD"
  );
  assert.throws(
    () => createTwilioResponderEvents({
      ...providerDependencies(),
      callbackUrl: "https://example.test/api/v1/provider-events/twilio",
      repository: repository().selected
    }),
    (error) => error?.code ===
      "TWILIO_RESPONDER_EVENT_CONFIGURATION_REQUIRED"
  );
});
