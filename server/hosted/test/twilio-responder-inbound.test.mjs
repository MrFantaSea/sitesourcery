import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import twilio from "twilio";

import {
  createHeldTwilioResponderInbound,
  createTwilioResponderInbound
} from "../twilio-responder-inbound.mjs";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const AUTH_TOKEN = "b".repeat(32);
const MESSAGE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages";
const VOICE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice";
const DIAL_RESULT_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";
const MESSAGE_SID = `SM${"1".repeat(32)}`;
const CALL_SID = `CA${"2".repeat(32)}`;
const FROM = "+18565550100";
const TO = "+18562441220";
const NOW = "2026-08-12T18:00:00.000Z";

function keyed(kind, address) {
  return createHmac("sha256", `test-${kind}`)
    .update(String(address), "utf8")
    .digest("hex");
}

function fakeLookupDigests() {
  return {
    kind: "responder-lookup-digests",
    providerEffects: false,
    writerVersion: "v2",
    verifierVersions: ["v2", "v1"],
    async readiness() {
      return {
        ready: true,
        verified: true,
        writerVersion: "v2",
        verifierVersions: ["v2", "v1"]
      };
    },
    numberLookupDigest(address) {
      return { digest: keyed("number-v2", address), keyVersion: "v2" };
    },
    numberLookupCandidates(address) {
      return [
        { digest: keyed("number-v2", address), keyVersion: "v2" },
        { digest: keyed("number-v1", address), keyVersion: "v1" }
      ];
    },
    callerRouteDigest(address) {
      return { digest: keyed("caller-v2", address), keyVersion: "v2" };
    }
  };
}

function fixture({
  receipt = null,
  repositoryReadiness = { ready: true, verified: true }
} = {}) {
  const facts = [];
  const repository = {
    kind: "twilio-responder-inbound-postgres",
    providerEffects: false,
    async readiness() {
      return repositoryReadiness;
    },
    async ingestInboundEvent(fact) {
      facts.push(fact);
      return receipt ?? {
        schema: "sitesourcery.responder-twilio-inbound-receipt/v1",
        channel: fact.channel,
        eventKind: fact.eventKind,
        eventState: "applied",
        stateReason: null,
        classifiedIntent: fact.classifiedIntent,
        coreApplied: true,
        suppression: null,
        replayed: false,
        providerEffects: false
      };
    }
  };
  const sealed = [];
  const vault = {
    kind: "responder-inbound-material-vault",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async sealInboundMaterial(authority, material) {
      sealed.push({ authority, material });
      return {
        keyVersion: "2026-08",
        nonce: Buffer.alloc(12, 1),
        authenticationTag: Buffer.alloc(16, 2),
        ciphertext: Buffer.alloc(32, 3)
      };
    }
  };
  const inbound = createTwilioResponderInbound({
    accountSid: ACCOUNT_SID,
    webhookAuthToken: AUTH_TOKEN,
    inboundMessageUrl: MESSAGE_URL,
    voiceUrl: VOICE_URL,
    dialResultUrl: DIAL_RESULT_URL,
    repository,
    vault,
    lookupDigests: fakeLookupDigests(),
    clock: { now: () => NOW }
  });
  return { inbound, facts, sealed };
}

function signedRequest(url, params) {
  const form = new URLSearchParams(params);
  return {
    rawBody: Buffer.from(form.toString(), "utf8"),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilio.getExpectedTwilioSignature(
        AUTH_TOKEN,
        url,
        params
      )
    }
  };
}

function smsParams(overrides = {}) {
  return {
    MessageSid: MESSAGE_SID,
    AccountSid: ACCOUNT_SID,
    From: FROM,
    To: TO,
    Body: "Sounds good, call me back",
    NumMedia: "0",
    NumSegments: "1",
    ...overrides
  };
}

test("a signed inbound SMS becomes a keyed digest-only fact with sealed material", async () => {
  const { inbound, facts } = fixture();
  const receipt = await inbound.ingestInboundMessage(
    signedRequest(MESSAGE_URL, smsParams())
  );
  assert.equal(receipt.eventState, "applied");
  assert.equal(facts.length, 1);
  const fact = facts[0];
  assert.equal(fact.channel, "sms");
  assert.equal(fact.eventKind, "message_received");
  assert.equal(fact.classifiedIntent, "message");
  assert.equal(fact.toNumberLookupDigest, keyed("number-v2", TO));
  assert.equal(fact.toNumberKeyVersion, "v2");
  assert.deepEqual(fact.toNumberLookupCandidateDigests, [
    keyed("number-v2", TO),
    keyed("number-v1", TO)
  ]);
  assert.equal(fact.fromRouteDigest, keyed("caller-v2", FROM));
  assert.equal(fact.fromRouteKeyVersion, "v2");
  assert.match(fact.contactRouteDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(fact.material, {
    from: FROM,
    body: "Sounds good, call me back"
  });
  const durable = { ...fact };
  delete durable.material;
  delete durable.sealMaterial;
  const serialized = JSON.stringify(durable);
  assert.equal(serialized.includes(FROM), false);
  assert.equal(serialized.includes(TO), false);
  assert.equal(serialized.includes("Sounds good"), false);
  assert.equal(serialized.includes(MESSAGE_SID), false);
  assert.equal(serialized.includes(ACCOUNT_SID), false);
});

test("STOP classification uses OptOutType plus the exact keyword set, never a reply", async () => {
  const { inbound, facts } = fixture();
  await inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
    Body: "STOP",
    OptOutType: "STOP",
    MessageSid: `SM${"3".repeat(32)}`
  })));
  assert.equal(facts.at(-1).classifiedIntent, "stop");
  assert.equal(facts.at(-1).optOutType, "STOP");
  await inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
    Body: "  unsubscribe  ",
    MessageSid: `SM${"4".repeat(32)}`
  })));
  assert.equal(facts.at(-1).classifiedIntent, "stop");
  await inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
    Body: "please stop calling me",
    MessageSid: `SM${"5".repeat(32)}`
  })));
  assert.equal(
    facts.at(-1).classifiedIntent,
    "message",
    "a sentence containing stop is not an opt-out keyword"
  );
  for (const optOutType of ["START", "HELP"]) {
    await inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
      Body: optOutType,
      OptOutType: optOutType,
      MessageSid: `SM${"6".repeat(30)}${optOutType.length}${optOutType.length}`
    })));
    assert.equal(
      facts.at(-1).classifiedIntent,
      "message",
      "START and HELP never mutate consent automatically"
    );
  }
});

test("signature, account, and parameter verification fail closed", async () => {
  const { inbound, facts } = fixture();
  const good = signedRequest(MESSAGE_URL, smsParams());
  await assert.rejects(
    inbound.ingestInboundMessage({
      rawBody: good.rawBody,
      headers: {
        ...good.headers,
        "x-twilio-signature": twilio.getExpectedTwilioSignature(
          "c".repeat(32),
          MESSAGE_URL,
          smsParams()
        )
      }
    }),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_SIGNATURE_INVALID"
  );
  await assert.rejects(
    inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
      AccountSid: `AC${"f".repeat(32)}`
    }))),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
  await assert.rejects(
    inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
      MessageSid: "not-a-sid"
    }))),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
  await assert.rejects(
    inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams({
      OptOutType: "MAYBE"
    }))),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
  await assert.rejects(
    inbound.ingestInboundMessage({
      rawBody: good.rawBody,
      headers: { "content-type": "application/json" }
    }),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
  assert.equal(facts.length, 0, "nothing reaches storage without proof");
});

test("voice arrival records evidence only and never fabricates a missed call", async () => {
  const { inbound, facts, sealed } = fixture();
  await inbound.ingestVoiceCall(signedRequest(VOICE_URL, {
    CallSid: CALL_SID,
    AccountSid: ACCOUNT_SID,
    From: FROM,
    To: TO,
    CallStatus: "ringing",
    Direction: "inbound"
  }));
  const fact = facts.at(-1);
  assert.equal(fact.channel, "voice");
  assert.equal(fact.eventKind, "call_received");
  assert.equal(fact.classifiedIntent, null);
  assert.equal(fact.dialCallStatus, null);
  assert.equal(fact.material, null, "arrival seals no caller material");
  assert.equal(sealed.length, 0);
  await assert.rejects(
    inbound.ingestVoiceCall(signedRequest(VOICE_URL, {
      CallSid: CALL_SID,
      AccountSid: ACCOUNT_SID,
      From: FROM,
      To: TO,
      Direction: "outbound-api"
    })),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
});

test("anonymous callers are recorded without route digests or material", async () => {
  const { inbound, facts } = fixture();
  await inbound.ingestVoiceCall(signedRequest(VOICE_URL, {
    CallSid: CALL_SID,
    AccountSid: ACCOUNT_SID,
    From: "anonymous",
    To: TO,
    CallStatus: "ringing"
  }));
  const fact = facts.at(-1);
  assert.equal(fact.fromRouteEligible, false);
  assert.equal(fact.fromRouteDigest, null);
  assert.equal(fact.fromRouteKeyVersion, null);
  assert.equal(fact.contactRouteDigest, null);
  assert.equal(fact.material, null);
});

test("only a non-completed DialCallStatus is missed-call evidence", async () => {
  const { inbound, facts } = fixture();
  for (const dialCallStatus of ["busy", "no-answer", "failed", "canceled"]) {
    await inbound.ingestDialResult(signedRequest(DIAL_RESULT_URL, {
      CallSid: CALL_SID,
      AccountSid: ACCOUNT_SID,
      From: FROM,
      To: TO,
      DialCallStatus: dialCallStatus,
      ForwardedFrom: "+18565550111"
    }));
    const fact = facts.at(-1);
    assert.equal(fact.eventKind, "dial_result");
    assert.equal(fact.dialCallStatus, dialCallStatus);
    assert.equal(fact.classifiedIntent, "not_applicable");
    assert.deepEqual(fact.material, {
      from: FROM,
      forwardedFrom: "+18565550111"
    });
  }
  await inbound.ingestDialResult(signedRequest(DIAL_RESULT_URL, {
    CallSid: CALL_SID,
    AccountSid: ACCOUNT_SID,
    From: FROM,
    To: TO,
    DialCallStatus: "completed"
  }));
  const answered = facts.at(-1);
  assert.equal(answered.classifiedIntent, null);
  assert.equal(answered.material, null, "an answered call is never missed");
  await assert.rejects(
    inbound.ingestDialResult(signedRequest(DIAL_RESULT_URL, {
      CallSid: CALL_SID,
      AccountSid: ACCOUNT_SID,
      From: FROM,
      To: TO
    })),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID"
  );
  await assert.rejects(
    inbound.ingestVoiceCall(signedRequest(VOICE_URL, {
      CallSid: CALL_SID,
      AccountSid: ACCOUNT_SID,
      From: FROM,
      To: TO,
      DialCallStatus: "no-answer"
    })),
    (error) => error?.code === "TWILIO_RESPONDER_INBOUND_INVALID",
    "CallStatus alone can never be treated as a dial result"
  );
});

test("readiness composes storage, vault, and keys and reports the voice hold", async () => {
  const { inbound } = fixture();
  const readiness = await inbound.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.voiceOperational, false);
  assert.equal(readiness.voiceDialPlan, "blocked-fin-004t");
  assert.equal(readiness.lookupWriterVersion, "v2");
  const blocked = fixture({
    repositoryReadiness: { ready: false, verified: false, code: "X" }
  });
  const notReady = await blocked.inbound.readiness();
  assert.equal(notReady.ready, false);
  assert.equal(notReady.voiceOperational, false);
});

test("an inexact durable receipt fails HTTP-visible ingestion closed", async () => {
  const { inbound } = fixture({
    receipt: { schema: "wrong", providerEffects: false }
  });
  await assert.rejects(
    inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, smsParams())),
    (error) =>
      error?.code === "TWILIO_RESPONDER_INBOUND_DURABILITY_REQUIRED"
  );
});

test("held inbound ingestion refuses every channel with 503", async () => {
  const held = createHeldTwilioResponderInbound();
  for (const method of [
    held.ingestInboundMessage,
    held.ingestVoiceCall,
    held.ingestDialResult
  ]) {
    await assert.rejects(
      method(),
      (error) => error?.code === "TWILIO_RESPONDER_INBOUND_HELD" &&
        error.status === 503
    );
  }
  const readiness = await held.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, "held");
});

test("only the exact production webhook URLs are configurable", () => {
  for (const [field, value] of [
    ["inboundMessageUrl", "https://evil.example/inbound"],
    ["voiceUrl", "http://sitesourcery.com/api/v1/provider-events/twilio/voice"],
    ["dialResultUrl", `${DIAL_RESULT_URL}?x=1`]
  ]) {
    assert.throws(
      () => fixtureWithUrl(field, value),
      (error) =>
        error?.code === "TWILIO_RESPONDER_INBOUND_CONFIGURATION_REQUIRED"
    );
  }
});

function fixtureWithUrl(field, value) {
  return createTwilioResponderInbound({
    accountSid: ACCOUNT_SID,
    webhookAuthToken: AUTH_TOKEN,
    inboundMessageUrl: MESSAGE_URL,
    voiceUrl: VOICE_URL,
    dialResultUrl: DIAL_RESULT_URL,
    [field]: value,
    repository: {
      kind: "twilio-responder-inbound-postgres",
      providerEffects: false,
      readiness: async () => ({ ready: true, verified: true }),
      ingestInboundEvent: async () => null
    },
    vault: {
      kind: "responder-inbound-material-vault",
      providerEffects: false,
      readiness: async () => ({ ready: true, verified: true }),
      sealInboundMaterial: async () => null
    },
    lookupDigests: fakeLookupDigests()
  });
}
