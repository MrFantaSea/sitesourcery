import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentRegistrationMailSink,
  createHeldRegistrationMailPort
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
