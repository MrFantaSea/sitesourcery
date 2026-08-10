import assert from "node:assert/strict";
import test from "node:test";

import {
  BRIDGED_MAIL_LIFECYCLE_STATES,
  createHeldBridgedMailComposition,
  createHeldMailDeliveryBridge
} from "../mail-delivery-bridge.mjs";
import {
  createHeldMailLifecycle,
  createMailLifecycle
} from "../mail-lifecycle.mjs";
import { digest } from "../security.mjs";

const NOW = "2026-08-10T14:00:00.000Z";
const EXPIRES = "2026-08-10T14:30:00.000Z";
const CLOCK = { now: () => NOW };
const ACCOUNT = "50000000-0000-4000-8000-000000000001";

const REGISTRATION = Object.freeze({
  idempotencyKey: "registration-command-0001",
  recipient: "owner@example.test",
  token: "v".repeat(43),
  requestedAt: NOW,
  expiresAt: EXPIRES
});
const RECOVERY = Object.freeze({
  idempotencyKey: "recovery-command-0001",
  recipient: "owner@example.test",
  token: "recovery-token-which-is-long-and-secret-0001",
  customerUserId: ACCOUNT,
  requestedAt: NOW,
  expiresAt: EXPIRES
});

// A faithful in-memory double of the MAIL-01 durable ledger repository. It
// enforces the exact reserve -> provider_accepted state machine, the acceptance
// window, single-use command idempotency, and — the property under test —
// that ONLY a real provider event (ingestProviderEvent) can reach delivered or
// bounced. Acceptance never sets a terminal delivery state.
function createDurableDouble({ ready = true } = {}) {
  const rowsByMessage = new Map();
  const rowsByCommand = new Map();
  const rowsByAcceptCommand = new Map();
  const log = [];
  let sequence = 0;

  function idempotencyConflict() {
    const error = new Error("idempotency conflict");
    error.code = "MAIL_LIFECYCLE_IDEMPOTENCY_CONFLICT";
    error.status = 409;
    return error;
  }

  return {
    log,
    rowsByMessage,
    async readiness() {
      return { ready, verified: ready, providerEffects: false };
    },
    async reserve(input) {
      const existing = rowsByCommand.get(input.commandId);
      if (existing) {
        if (existing.request_digest !== input.requestDigest) {
          throw idempotencyConflict();
        }
        return { messageId: existing.id, state: existing.state };
      }
      sequence += 1;
      const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
      const row = {
        id,
        command_id: input.commandId,
        request_digest: input.requestDigest,
        message_type: input.messageType,
        recipient_digest: input.recipientDigest,
        content_digest: input.contentDigest,
        subject_reference_digest: input.subjectReferenceDigest,
        template_version: input.templateVersion,
        customer_user_id: input.customerUserId,
        requested_at: input.requestedAt,
        expires_at: input.expiresAt,
        state: "pending",
        provider: null,
        provider_message_id_digest: null,
        provider_accepted_at: null,
        reservation: input
      };
      rowsByCommand.set(input.commandId, row);
      rowsByMessage.set(id, row);
      log.push("reserve");
      return { messageId: id, state: row.state };
    },
    async recordProviderAcceptance(input) {
      const existing = rowsByAcceptCommand.get(input.commandId);
      if (existing) {
        if (existing.id !== input.messageId) throw idempotencyConflict();
        return {
          messageId: existing.id,
          acceptanceState: "provider_accepted",
          currentState: existing.state
        };
      }
      const row = rowsByMessage.get(input.messageId);
      if (!row || row.state !== "pending") {
        const error = new Error("acceptance unavailable");
        error.code = "MAIL_ACCEPTANCE_UNAVAILABLE";
        error.status = 409;
        throw error;
      }
      assert.ok(
        Date.parse(input.acceptedAt) >= Date.parse(row.requested_at) &&
          Date.parse(input.acceptedAt) < Date.parse(row.expires_at),
        "acceptance must fall within the reservation window"
      );
      row.state = "provider_accepted";
      row.provider = input.provider;
      row.provider_message_id_digest = input.providerMessageIdDigest;
      row.provider_accepted_at = input.acceptedAt;
      rowsByAcceptCommand.set(input.commandId, row);
      log.push("accept");
      // Acceptance NEVER advances to delivered/bounced.
      return {
        messageId: row.id,
        acceptanceState: "provider_accepted",
        currentState: row.state
      };
    },
    // The ONLY path to a terminal delivery state — a real provider signal.
    async ingestProviderEvent(input) {
      log.push("event");
      for (const row of rowsByMessage.values()) {
        if (
          row.provider === input.provider &&
          row.provider_message_id_digest === input.providerMessageIdDigest &&
          row.state === "provider_accepted"
        ) {
          row.state = input.eventKind;
          return { eventState: "applied", currentState: row.state };
        }
      }
      return { eventState: "pending", currentState: null };
    },
    async expire() {
      throw new Error("not exercised");
    },
    async listOwnerExceptions() {
      return { items: [] };
    }
  };
}

function build({ ready = true } = {}) {
  const repository = createDurableDouble({ ready });
  const lifecycle = createMailLifecycle({ repository, clock: CLOCK });
  const bridge = createHeldMailDeliveryBridge({ lifecycle, clock: CLOCK });
  return { repository, lifecycle, bridge };
}

test("held bridge (default lifecycle) fails closed and performs no effect", async () => {
  const composition = createHeldBridgedMailComposition({ clock: CLOCK });
  assert.equal(composition.providerEffects, false);
  const readiness = await composition.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.providerEffects, false);

  for (const [port, request] of [
    [composition.registration, REGISTRATION],
    [composition.recovery, RECOVERY]
  ]) {
    await assert.rejects(
      port.deliver(request),
      (error) =>
        error?.code === "MAIL_LIFECYCLE_HELD" &&
        error?.details?.providerEffects === false &&
        !JSON.stringify(error).includes(request.token) &&
        !JSON.stringify(error).includes(request.recipient)
    );
  }
});

test("bridge records reservation THEN acceptance and returns an acceptance (never delivered) receipt", async () => {
  const { repository, bridge } = build();
  const receipt = await bridge.registration.deliver(REGISTRATION);

  assert.equal(
    receipt.state,
    BRIDGED_MAIL_LIFECYCLE_STATES.ACCEPTED_BY_PROVIDER
  );
  assert.notEqual(receipt.state, "delivered");
  assert.equal(receipt.provider, "held");
  assert.equal(receipt.providerEffects, false);
  assert.equal(receipt.mode, "held");
  assert.match(receipt.messageId, /^[0-9a-f-]{36}$/u);
  assert.match(receipt.receiptId, /^[a-f0-9]{64}$/u);
  assert.match(receipt.payloadDigest, /^[a-f0-9]{64}$/u);

  // Reservation strictly precedes acceptance; delivered is never touched.
  assert.deepEqual(repository.log, ["reserve", "accept"]);
  const row = repository.rowsByMessage.get(receipt.messageId);
  assert.equal(row.state, "provider_accepted");
  assert.equal(repository.log.includes("event"), false);
});

test("acceptance is distinct from delivery: only a real provider event reaches a terminal state", async () => {
  const { repository, lifecycle, bridge } = build();
  const receipt = await bridge.registration.deliver(REGISTRATION);
  const row = repository.rowsByMessage.get(receipt.messageId);
  assert.equal(row.state, "provider_accepted");

  // A real hard bounce arriving later is what would move the message — the
  // bridge itself never does this.
  await lifecycle.ingestProviderEvent({
    provider: "held",
    providerEventIdDigest: digest("held-bounce-event"),
    providerMessageIdDigest: row.provider_message_id_digest,
    eventKind: "bounced",
    signatureVerificationDigest: digest("held-bounce-signature"),
    evidenceDigest: digest("held-bounce-evidence"),
    occurredAt: NOW
  });
  assert.equal(row.state, "bounced");
  // The acceptance receipt the bridge already returned still says accepted,
  // never delivered — acceptance and delivery are separate facts.
  assert.equal(receipt.state, "accepted-by-provider");
});

test("token and recipient are never present; only digests are recorded", async () => {
  const { repository, bridge } = build();
  const receipt = await bridge.recovery.deliver(RECOVERY);

  const receiptText = JSON.stringify(receipt);
  assert.equal(receiptText.includes(RECOVERY.recipient), false);
  assert.equal(receiptText.includes(RECOVERY.token), false);

  const row = repository.rowsByMessage.get(receipt.messageId);
  const reservationText = JSON.stringify(row.reservation);
  assert.equal(reservationText.includes(RECOVERY.recipient), false);
  assert.equal(reservationText.includes(RECOVERY.token), false);
  assert.equal("recipient" in row.reservation, false);
  assert.equal("token" in row.reservation, false);
  // The token and recipient survive only as sha256 digests bound into content.
  assert.equal(row.recipient_digest, digest(RECOVERY.recipient));
  assert.match(row.content_digest, /^[a-f0-9]{64}$/u);
});

test("idempotent: a replay yields one reservation, one acceptance, and the same receipt", async () => {
  const { repository, bridge } = build();
  const first = await bridge.registration.deliver(REGISTRATION);
  const replay = await bridge.registration.deliver(REGISTRATION);
  assert.deepEqual(replay, first);
  assert.deepEqual(repository.log, ["reserve", "accept"]);

  // Same key, different token => conflict, no second effect.
  await assert.rejects(
    bridge.registration.deliver({ ...REGISTRATION, token: "x".repeat(43) }),
    (error) => error?.code === "REGISTRATION_DELIVERY_IDEMPOTENCY_CONFLICT"
  );
  assert.deepEqual(repository.log, ["reserve", "accept"]);
});

test("durable idempotency survives a lost local cache: same commands, no second effect", async () => {
  const repository = createDurableDouble();
  const lifecycle = createMailLifecycle({ repository, clock: CLOCK });
  const bridgeA = createHeldMailDeliveryBridge({ lifecycle, clock: CLOCK });
  const bridgeB = createHeldMailDeliveryBridge({ lifecycle, clock: CLOCK });

  const first = await bridgeA.registration.deliver(REGISTRATION);
  const second = await bridgeB.registration.deliver(REGISTRATION);
  assert.deepEqual(second, first);
  // The durable ledger deduped the replay: still exactly one reserve + accept.
  assert.deepEqual(repository.log, ["reserve", "accept"]);
});

test("enumeration safety: the held path answers identically regardless of recipient", async () => {
  const composition = createHeldBridgedMailComposition({ clock: CLOCK });
  const errors = [];
  for (const recipient of ["known@example.test", "unknown@example.test"]) {
    try {
      await composition.recovery.deliver({
        ...RECOVERY,
        idempotencyKey: "recovery-enumeration-probe",
        recipient
      });
      assert.fail("held recovery must reject");
    } catch (error) {
      errors.push({ code: error.code, status: error.status });
    }
  }
  assert.deepEqual(errors[0], errors[1]);

  // In repository mode the acceptance receipt shape is identical for any
  // recipient; the bridge branches on nothing account-specific.
  const { bridge } = build();
  const a = await bridge.recovery.deliver({
    ...RECOVERY,
    idempotencyKey: "recovery-shape-a",
    recipient: "a@example.test"
  });
  const b = await bridge.recovery.deliver({
    ...RECOVERY,
    idempotencyKey: "recovery-shape-b",
    recipient: "b@example.test"
  });
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

test("recovery requires a customer account reference; registration refuses one", async () => {
  const { bridge } = build();
  await assert.rejects(
    bridge.recovery.deliver({ ...RECOVERY, customerUserId: undefined }),
    (error) => error?.code === "RECOVERY_DELIVERY_INVALID"
  );
  await assert.rejects(
    bridge.registration.deliver({ ...REGISTRATION, customerUserId: ACCOUNT }),
    (error) => error?.code === "REGISTRATION_DELIVERY_INVALID"
  );
  const ok = await bridge.recovery.deliver(RECOVERY);
  assert.equal(ok.state, "accepted-by-provider");
});

test("held composition refuses any real provider effect (no switch lift, no transport)", () => {
  assert.throws(
    () => createHeldBridgedMailComposition({ allowProviderEffects: true }),
    (error) => error?.code === "MAIL_BRIDGE_SWITCH_LIFT_FORBIDDEN"
  );
  assert.throws(
    () => createHeldBridgedMailComposition({ transport: { sendRegistration() {} } }),
    (error) => error?.code === "MAIL_BRIDGE_SWITCH_LIFT_FORBIDDEN"
  );
  // The bridge insists its lifecycle keeps provider effects held.
  assert.throws(
    () =>
      createHeldMailDeliveryBridge({
        lifecycle: {
          providerEffects: true,
          readiness() {},
          reserve() {},
          recordProviderAcceptance() {}
        }
      }),
    (error) => error?.code === "MAIL_BRIDGE_CONFIGURATION_REQUIRED"
  );
});

test("defense: a ledger that reports acceptance as delivery is rejected", async () => {
  const dishonest = {
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true, providerEffects: false };
    },
    async reserve() {
      return { messageId: "00000000-0000-4000-8000-000000000009", state: "pending" };
    },
    async recordProviderAcceptance() {
      return { acceptanceState: "delivered", currentState: "delivered" };
    }
  };
  const bridge = createHeldMailDeliveryBridge({
    lifecycle: dishonest,
    clock: CLOCK
  });
  await assert.rejects(
    bridge.registration.deliver(REGISTRATION),
    (error) => error?.code === "MAIL_BRIDGE_ACCEPTANCE_NOT_DELIVERY"
  );
});

test("held composition readiness reflects a ready ledger with provider effects held", async () => {
  const repository = createDurableDouble({ ready: true });
  const lifecycle = createMailLifecycle({ repository, clock: CLOCK });
  const composition = createHeldBridgedMailComposition({ lifecycle, clock: CLOCK });
  const readiness = await composition.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.providerEffects, false);
  assert.equal(readiness.mode, "held-bridge");
  assert.equal(readiness.registration.kind, "registration-mail");
  assert.equal(readiness.recovery.kind, "recovery-mail");

  // A held ledger keeps the composition not-ready.
  const heldComposition = createHeldBridgedMailComposition({
    lifecycle: createHeldMailLifecycle(),
    clock: CLOCK
  });
  assert.equal((await heldComposition.readiness()).ready, false);
});
