import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentRegistrationMailSink,
  createHeldRegistrationMailPort,
  createProductionRegistrationMailPort
} from "../registration-mail-port.mjs";

const NOW = "2026-07-30T12:00:00.000Z";
const EXPIRES = "2026-07-30T12:30:00.000Z";
const REQUEST = Object.freeze({
  idempotencyKey: "registration-command-001",
  recipient: "owner@example.test",
  token: "v".repeat(43),
  requestedAt: NOW,
  expiresAt: EXPIRES
});

test("held registration mail is explicit and has no delivery path", async () => {
  const held = createHeldRegistrationMailPort();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    verified: false,
    kind: "registration-mail",
    mode: "held",
    code: "ACCOUNT_REGISTRATION_HELD"
  });
  await assert.rejects(
    held.deliver(REQUEST),
    (error) =>
      error?.code === "ACCOUNT_REGISTRATION_HELD" &&
      error?.status === 503
  );
});

test("development registration sink stays in memory and returns a nonsecret receipt", async () => {
  const sink = createDevelopmentRegistrationMailSink({
    clock: { now: () => NOW }
  });
  const first = await sink.deliver(REQUEST);
  const replay = await sink.deliver(REQUEST);
  assert.deepEqual(replay, first);
  assert.deepEqual(await sink.readiness(), {
    ready: true,
    verified: true,
    kind: "registration-mail",
    mode: "dev-sink",
    provider: "development-sink"
  });

  const messages = sink.readForTest(REQUEST.recipient);
  assert.equal(messages.length, 1);
  assert.match(
    messages[0].verificationUrl,
    /^https:\/\/staging\.sitesourcery\.test\/abracadabra\/app\/#verify-registration=/u
  );
  assert.equal(
    new URL(messages[0].verificationUrl).search,
    ""
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /owner@example\.test|vvvvvvvv/iu
  );
  assert.match(first.receiptId, /^[a-f0-9]{64}$/u);
  assert.match(first.payloadDigest, /^[a-f0-9]{64}$/u);

  await assert.rejects(
    sink.deliver({
      ...REQUEST,
      token: "x".repeat(43)
    }),
    (error) =>
      error?.code ===
      "REGISTRATION_DELIVERY_IDEMPOTENCY_CONFLICT"
  );
});

test("registration mail adapters reject unsafe base URLs", () => {
  for (const registrationBaseUrl of [
    "http://sitesourcery.test/app/",
    "https://user:password@sitesourcery.test/app/",
    "https://sitesourcery.test/app/?token=query",
    "https://sitesourcery.test/app/#token"
  ]) {
    assert.throws(
      () =>
        createHeldRegistrationMailPort({
          registrationBaseUrl
        }),
      (error) =>
        error?.code ===
        "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED"
    );
  }
});

test("production registration refuses an absent or unverified transport", async () => {
  let port = createProductionRegistrationMailPort();
  assert.equal(
    (await port.readiness()).code,
    "REGISTRATION_TRANSPORT_REQUIRED"
  );
  await assert.rejects(
    port.deliver(REQUEST),
    (error) => error?.code === "ACCOUNT_REGISTRATION_HELD"
  );

  port = createProductionRegistrationMailPort({
    transport: {
      async readiness() {
        return {
          ready: true,
          verified: false,
          provider: "unverified"
        };
      },
      async sendRegistration() {
        assert.fail(
          "an unverified transport must never receive a secret"
        );
      }
    }
  });
  assert.equal(
    (await port.readiness()).code,
    "REGISTRATION_TRANSPORT_UNVERIFIED"
  );
});

test("verified registration transport returns one exact bound receipt", async () => {
  const sends = [];
  const transport = {
    async readiness() {
      return {
        ready: true,
        verified: true,
        provider: "test-transactional-mail"
      };
    },
    async sendRegistration(input) {
      sends.push(input);
      return {
        accepted: true,
        provider: "test-transactional-mail",
        providerMessageId: "registration_message_0001",
        idempotencyKey: input.idempotencyKey,
        payloadDigest: input.payloadDigest,
        acceptedAt: NOW
      };
    }
  };
  const port = createProductionRegistrationMailPort({
    transport,
    clock: { now: () => NOW }
  });
  const first = await port.deliver(REQUEST);
  const replay = await port.deliver(REQUEST);
  assert.deepEqual(replay, first);
  assert.equal(sends.length, 1);
  assert.equal(first.state, "provider_accepted");
  assert.equal(first.provider, "test-transactional-mail");
  assert.match(first.receiptId, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(first),
    /owner@example|vvvvvvvv/iu
  );

  const invalid = createProductionRegistrationMailPort({
    transport: {
      ...transport,
      async sendRegistration(input) {
        return {
          accepted: true,
          provider: "test-transactional-mail",
          providerMessageId: "registration_message_tampered",
          idempotencyKey: input.idempotencyKey,
          payloadDigest: "0".repeat(64),
          acceptedAt: NOW
        };
      }
    },
    clock: { now: () => NOW }
  });
  await assert.rejects(
    invalid.deliver({
      ...REQUEST,
      idempotencyKey: "registration-command-tampered"
    }),
    (error) =>
      error?.code ===
      "REGISTRATION_DELIVERY_RECEIPT_INVALID"
  );
});
