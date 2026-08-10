// MAIL-WIRING-02 — held bridge from the legacy registration/recovery mail
// contracts onto the MAIL-01 durable reservation/acceptance ledger.
//
// The legacy registration and recovery ports collapse provider ACCEPTANCE
// (Resend answers 200 the instant it accepts a message for its own queue) into
// a receipt whose `state` is "delivered". A hard bounce afterwards is never
// reconciled, so a bounced recovery mail is recorded as delivered and the
// account owner is silently locked out.
//
// This bridge represents the same two contracts with the honest lifecycle the
// MAIL-01 ledger already models:
//
//   reserved              a send is durably reserved BEFORE any dispatch
//   accepted-by-provider  the provider accepted the message for its queue
//   delivered / bounced   reachable ONLY by a real provider delivery/bounce
//                         signal (ingestProviderEvent) — which is not wired
//                         yet, so these states stay unreached here.
//
// Acceptance is never delivery. `deliver()` records a reservation and then a
// provider acceptance through the durable ledger and returns a receipt whose
// state is "accepted-by-provider". It never emits "delivered".
//
// Every provider effect is HELD. This module opens no socket, reads no secret,
// and constructs no real transport. The acceptance it records carries the held
// provider marker ("held") and digest-only evidence; nothing here can move a
// message to "delivered".

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { createHeldMailLifecycle } from "./mail-lifecycle.mjs";
import { digest } from "./security.mjs";

export const BRIDGED_MAIL_LIFECYCLE_STATES = Object.freeze({
  RESERVED: "reserved",
  ACCEPTED_BY_PROVIDER: "accepted-by-provider",
  // Only a real provider delivery/bounce signal may set these; the held bridge
  // never reaches them.
  DELIVERED: "delivered",
  BOUNCED: "bounced"
});

const HELD_PROVIDER = "held";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const CONTRACTS = Object.freeze({
  registration: Object.freeze({
    kind: "registration-mail",
    heldCode: "ACCOUNT_REGISTRATION_HELD",
    invalidCode: "REGISTRATION_DELIVERY_INVALID",
    conflictCode: "REGISTRATION_DELIVERY_IDEMPOTENCY_CONFLICT",
    configCode: "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
    messageType: "account_activation",
    templateVersion: "registration-verification.v1",
    requiresCustomerUser: false,
    maximumTtlMs: 24 * 60 * 60 * 1000
  }),
  recovery: Object.freeze({
    kind: "recovery-mail",
    heldCode: "RECOVERY_DELIVERY_HELD",
    invalidCode: "RECOVERY_DELIVERY_INVALID",
    conflictCode: "RECOVERY_DELIVERY_IDEMPOTENCY_CONFLICT",
    configCode: "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
    messageType: "account_recovery",
    templateVersion: "password-recovery.v1",
    requiresCustomerUser: true,
    maximumTtlMs: 2 * 60 * 60 * 1000
  })
});

function text(value, field, contract, maximum, minimum = 1) {
  const selected = String(value ?? "").trim();
  invariant(
    selected.length >= minimum && selected.length <= maximum,
    contract.invalidCode,
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function email(value, contract) {
  const selected = text(value, "Recipient", contract, 254).toLowerCase();
  invariant(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(selected),
    contract.invalidCode,
    "Recipient is invalid.",
    { status: 500 }
  );
  return selected;
}

function instant(value, field, contract) {
  const selected = String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)),
    contract.invalidCode,
    `${field} is invalid.`,
    { status: 500 }
  );
  return new Date(selected).toISOString();
}

function customerUserId(value, contract) {
  if (!contract.requiresCustomerUser) {
    invariant(
      value === undefined || value === null,
      contract.invalidCode,
      "This contract does not accept a customer account reference.",
      { status: 500 }
    );
    return null;
  }
  const selected = String(value ?? "");
  invariant(
    UUID.test(selected),
    contract.invalidCode,
    "A customer account reference is required for recovery mail.",
    { status: 500 }
  );
  return selected;
}

function currentTime(clock, contract) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  return instant(value, "Bridge clock", contract);
}

function safeBaseUrl(value, contract) {
  let selected;
  try {
    selected = new URL(String(value ?? ""));
  } catch {
    selected = null;
  }
  invariant(
    selected &&
      selected.protocol === "https:" &&
      !selected.username &&
      !selected.password &&
      !selected.search &&
      !selected.hash,
    contract.configCode,
    "An HTTPS application URL is required.",
    { status: 500 }
  );
  return selected.href;
}

// A single-use, deterministic command id derived from the request identity so a
// replay maps to the SAME durable reservation/acceptance and never creates a
// second effect. Matches the ledger safe-id shape ^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$.
function commandId(prefix, contract, idempotencyKey) {
  return `${prefix}-${digest(`${contract.messageType}:${idempotencyKey}`).slice(
    0,
    40
  )}`;
}

function normalizeRequest(input, contract, { baseUrl, clock }) {
  const idempotencyKey = text(
    input?.idempotencyKey,
    "Idempotency key",
    contract,
    200,
    8
  );
  const recipient = email(input?.recipient, contract);
  // The raw token is reduced to a digest immediately and never stored, echoed,
  // or embedded anywhere. Only the digest binds the reservation.
  const token = text(input?.token, "Token", contract, 512, 32);
  const tokenDigest = digest(token);
  const account = customerUserId(input?.customerUserId, contract);
  const expiresAt = instant(input?.expiresAt, "Expiry", contract);
  const requestedAt = instant(
    input?.requestedAt ?? currentTime(clock, contract),
    "Request time",
    contract
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(requestedAt) &&
      Date.parse(expiresAt) - Date.parse(requestedAt) <= contract.maximumTtlMs,
    contract.invalidCode,
    "Delivery is expired or has an invalid lifetime.",
    { status: 500 }
  );
  const recipientDigest = digest(recipient);
  const subjectReferenceDigest = digest({
    schema: "sitesourcery.bridged-mail-subject-reference/v1",
    contract: contract.kind,
    template: contract.templateVersion
  });
  const contentDigest = digest({
    schema: "sitesourcery.bridged-mail-content-reference/v1",
    contract: contract.kind,
    template: contract.templateVersion,
    recipientDigest,
    tokenDigest,
    baseUrl
  });
  // Non-secret binding for idempotency + the receipt fingerprint.
  const payloadDigest = digest({
    schema: "sitesourcery.bridged-mail-payload/v1",
    contract: contract.kind,
    messageType: contract.messageType,
    template: contract.templateVersion,
    recipientDigest,
    tokenDigest,
    customerUserId: account,
    requestedAt,
    expiresAt
  });
  return deepFreeze({
    idempotencyKey,
    account,
    recipientDigest,
    subjectReferenceDigest,
    contentDigest,
    payloadDigest,
    expiresAt
  });
}

function acceptanceReceipt(contract, request, { messageId, acceptedAt }) {
  const facts = {
    schema: "sitesourcery.bridged-mail-acceptance-receipt/v1",
    contract: contract.kind,
    mode: "held",
    providerEffects: false,
    // Honest lifecycle state. Acceptance is NEVER delivery.
    state: BRIDGED_MAIL_LIFECYCLE_STATES.ACCEPTED_BY_PROVIDER,
    provider: HELD_PROVIDER,
    messageId,
    idempotencyKey: request.idempotencyKey,
    payloadDigest: request.payloadDigest,
    acceptedAt,
    expiresAt: request.expiresAt
  };
  return Object.freeze({
    ...facts,
    receiptId: digest(facts)
  });
}

function conflict(contract) {
  return new HostedError(
    contract.conflictCode,
    "That delivery key was already used for another message.",
    { status: 409 }
  );
}

function validateLifecycle(lifecycle) {
  invariant(
    lifecycle &&
      typeof lifecycle.readiness === "function" &&
      typeof lifecycle.reserve === "function" &&
      typeof lifecycle.recordProviderAcceptance === "function" &&
      lifecycle.providerEffects === false,
    "MAIL_BRIDGE_CONFIGURATION_REQUIRED",
    "A durable mail lifecycle with provider effects held is required.",
    { status: 500 }
  );
  return lifecycle;
}

function createContractPort(contract, { lifecycle, baseUrl, clock }) {
  // Process-local idempotency mirror of the durable ledger: a replay of the
  // same key returns the same receipt; the same key with different evidence is
  // a conflict. The durable ledger independently rejects a second effect.
  const receiptsByKey = new Map();

  async function readiness() {
    const status = await lifecycle.readiness();
    const ready = status?.ready === true && status?.verified === true;
    return deepFreeze({
      ready,
      verified: ready,
      kind: contract.kind,
      mode: "held-bridge",
      providerEffects: false,
      code: ready ? null : status?.code ?? contract.heldCode
    });
  }

  async function deliver(input) {
    const request = normalizeRequest(input, contract, { baseUrl, clock });
    const prior = receiptsByKey.get(request.idempotencyKey);
    if (prior) {
      if (prior.payloadDigest !== request.payloadDigest) throw conflict(contract);
      return prior.receipt;
    }

    // 1) Reserve durably BEFORE any dispatch. When the ledger is held this
    // rejects with MAIL_LIFECYCLE_HELD, so the bridge is held by default and
    // performs no effect.
    const reservation = await lifecycle.reserve({
      commandId: commandId("mailbridge-reserve", contract, request.idempotencyKey),
      messageType: contract.messageType,
      organizationId: null,
      projectId: null,
      customerUserId: request.account,
      recipientDigest: request.recipientDigest,
      subjectReferenceDigest: request.subjectReferenceDigest,
      contentDigest: request.contentDigest,
      templateVersion: contract.templateVersion,
      expiresAt: request.expiresAt
    });
    const messageId = String(reservation?.messageId ?? "");
    invariant(
      UUID.test(messageId),
      "MAIL_BRIDGE_CONFIGURATION_REQUIRED",
      "The durable reservation did not return a message reference.",
      { status: 500 }
    );

    // 2) Record provider acceptance — HELD. No network, held provider marker,
    // digest-only evidence. This can move the message to
    // 'provider_accepted' and NOTHING beyond it.
    const acceptedAt = currentTime(clock, contract);
    const acceptance = await lifecycle.recordProviderAcceptance({
      commandId: commandId("mailbridge-accept", contract, request.idempotencyKey),
      messageId,
      provider: HELD_PROVIDER,
      providerMessageIdDigest: digest({
        schema: "sitesourcery.bridged-mail-held-provider-message/v1",
        contract: contract.kind,
        messageId,
        idempotencyKey: request.idempotencyKey
      }),
      evidenceDigest: digest({
        schema: "sitesourcery.bridged-mail-held-acceptance-evidence/v1",
        contract: contract.kind,
        messageId,
        idempotencyKey: request.idempotencyKey,
        providerEffects: false,
        acceptedAt
      }),
      acceptedAt
    });
    // Defense in depth: the acceptance step must record acceptance, never
    // delivery. A ledger that answered otherwise is a contract violation.
    invariant(
      acceptance?.acceptanceState === "provider_accepted",
      "MAIL_BRIDGE_ACCEPTANCE_NOT_DELIVERY",
      "Provider acceptance must never be recorded as delivery.",
      { status: 500 }
    );

    const receipt = acceptanceReceipt(contract, request, { messageId, acceptedAt });
    receiptsByKey.set(request.idempotencyKey, {
      payloadDigest: request.payloadDigest,
      receipt
    });
    return receipt;
  }

  return Object.freeze({
    kind: contract.kind,
    mode: "held-bridge",
    providerEffects: false,
    readiness,
    deliver
  });
}

// The bridge itself. Given a durable mail lifecycle (MAIL-01) whose provider
// effects are held, it exposes a registration and a recovery port that record
// reservation + held acceptance and return acceptance (never delivery)
// receipts. A held lifecycle (the default) makes every deliver() fail closed.
export function createHeldMailDeliveryBridge({
  lifecycle,
  registrationBaseUrl = "https://sitesourcery.com/abracadabra/app/",
  recoveryBaseUrl = "https://sitesourcery.com/abracadabra/app/",
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const durable = validateLifecycle(lifecycle);
  return Object.freeze({
    kind: "held-mail-delivery-bridge",
    mode: "held-bridge",
    providerEffects: false,
    registration: createContractPort(CONTRACTS.registration, {
      lifecycle: durable,
      baseUrl: safeBaseUrl(registrationBaseUrl, CONTRACTS.registration),
      clock
    }),
    recovery: createContractPort(CONTRACTS.recovery, {
      lifecycle: durable,
      baseUrl: safeBaseUrl(recoveryBaseUrl, CONTRACTS.recovery),
      clock
    })
  });
}

// Held readiness/composition helper for the bridged mail path. Defaults held
// (no lifecycle => the MAIL-01 held ledger => every deliver() fails closed) and
// refuses any real provider effect: it accepts no transport and throws if asked
// to lift the switch.
export function createHeldBridgedMailComposition({
  lifecycle = null,
  registrationBaseUrl = "https://sitesourcery.com/abracadabra/app/",
  recoveryBaseUrl = "https://sitesourcery.com/abracadabra/app/",
  clock = { now: () => new Date().toISOString() },
  allowProviderEffects = false,
  transport = null
} = {}) {
  invariant(
    allowProviderEffects === false && transport === null,
    "MAIL_BRIDGE_SWITCH_LIFT_FORBIDDEN",
    "The bridged mail path is held; real provider effects are refused.",
    { status: 500 }
  );
  const durable = lifecycle ?? createHeldMailLifecycle();
  const bridge = createHeldMailDeliveryBridge({
    lifecycle: durable,
    registrationBaseUrl,
    recoveryBaseUrl,
    clock
  });
  return Object.freeze({
    kind: "held-bridged-mail-composition",
    mode: "held-bridge",
    providerEffects: false,
    registration: bridge.registration,
    recovery: bridge.recovery,
    async readiness() {
      const [registration, recovery] = await Promise.all([
        bridge.registration.readiness(),
        bridge.recovery.readiness()
      ]);
      return deepFreeze({
        kind: "held-bridged-mail-composition",
        mode: "held-bridge",
        providerEffects: false,
        ready: registration.ready === true && recovery.ready === true,
        registration,
        recovery
      });
    }
  });
}
