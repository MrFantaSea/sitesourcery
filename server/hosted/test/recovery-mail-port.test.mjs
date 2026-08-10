import assert from "node:assert/strict";
import test from "node:test";

import {
  createDevelopmentRecoveryMailSink,
  createHeldRecoveryMailPort,
  createProductionRecoveryMailPort
} from "../recovery-mail-port.mjs";

const NOW = "2026-07-28T20:00:00.000Z";
const EXPIRES = "2026-07-28T20:30:00.000Z";
const TOKEN = "recovery-token-which-is-long-and-secret-0001";
const REQUEST = Object.freeze({
  idempotencyKey: "recovery-command-0001",
  recipient: "owner@example.test",
  token: TOKEN,
  requestedAt: NOW,
  expiresAt: EXPIRES
});

test("held recovery delivery is explicit and exposes no secret", async () => {
  const port = createHeldRecoveryMailPort();
  assert.deepEqual(await port.readiness(), {
    ready: false,
    verified: false,
    kind: "recovery-mail",
    mode: "held",
    code: "RECOVERY_DELIVERY_HELD"
  });
  await assert.rejects(
    port.deliver(REQUEST),
    (error) =>
      error?.code === "RECOVERY_DELIVERY_HELD" &&
      !JSON.stringify(error).includes(TOKEN)
  );
});

test("development sink is exact, expiring, and idempotent without public token leakage", async () => {
  const sink = createDevelopmentRecoveryMailSink({
    clock: { now: () => NOW }
  });
  const first = await sink.deliver(REQUEST);
  const replay = await sink.deliver(REQUEST);
  assert.deepEqual(replay, first);
  assert.equal(sink.readForTest(REQUEST.recipient).length, 1);
  assert.match(
    sink.readForTest(REQUEST.recipient)[0].recoveryUrl,
    /#recovery=recovery-token/iu
  );
  assert.doesNotMatch(JSON.stringify(first), /owner@example|recovery-token/iu);
  assert.equal(first.expiresAt, EXPIRES);
  await assert.rejects(
    sink.deliver({ ...REQUEST, token: `${TOKEN}-different` }),
    (error) => error?.code === "RECOVERY_DELIVERY_IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    sink.deliver({
      ...REQUEST,
      idempotencyKey: "recovery-command-expired",
      expiresAt: NOW
    }),
    (error) => error?.code === "RECOVERY_DELIVERY_EXPIRED"
  );
});

test("production refuses readiness without a configured verified transport", async () => {
  let port = createProductionRecoveryMailPort();
  assert.equal((await port.readiness()).code, "RECOVERY_TRANSPORT_REQUIRED");
  await assert.rejects(
    port.deliver(REQUEST),
    (error) => error?.code === "RECOVERY_DELIVERY_HELD"
  );

  port = createProductionRecoveryMailPort({
    transport: {
      async readiness() {
        return {
          ready: true,
          verified: false,
          provider: "unverified"
        };
      },
      async sendRecovery() {
        assert.fail("an unverified transport must never receive a secret");
      }
    }
  });
  assert.equal(
    (await port.readiness()).code,
    "RECOVERY_TRANSPORT_UNVERIFIED"
  );
});

test("verified production transport must return one exact bound receipt", async () => {
  const sends = [];
  const transport = {
    async readiness() {
      return {
        ready: true,
        verified: true,
        provider: "test-transactional-mail"
      };
    },
    async sendRecovery(input) {
      sends.push(input);
      return {
        accepted: true,
        provider: "test-transactional-mail",
        providerMessageId: "message_0001",
        idempotencyKey: input.idempotencyKey,
        payloadDigest: input.payloadDigest,
        acceptedAt: NOW
      };
    }
  };
  const port = createProductionRecoveryMailPort({
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
  assert.doesNotMatch(JSON.stringify(first), /owner@example|recovery-token/iu);

  const invalid = createProductionRecoveryMailPort({
    transport: {
      ...transport,
      async sendRecovery(input) {
        return {
          accepted: true,
          provider: "test-transactional-mail",
          providerMessageId: "message_tampered",
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
      idempotencyKey: "recovery-command-tampered"
    }),
    (error) => error?.code === "RECOVERY_DELIVERY_RECEIPT_INVALID"
  );
});
