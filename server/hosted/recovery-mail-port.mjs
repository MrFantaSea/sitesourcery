import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const RECOVERY_SCHEMA = "sitesourcery.recovery-email/v1";
const MAXIMUM_RECOVERY_TTL_MS = 2 * 60 * 60 * 1000;

function text(value, field, maximum, minimum = 1) {
  const selected = String(value ?? "").trim();
  invariant(
    selected.length >= minimum && selected.length <= maximum,
    "RECOVERY_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function email(value) {
  const selected = text(value, "Recovery recipient", 254).toLowerCase();
  invariant(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(selected),
    "RECOVERY_DELIVERY_INVALID",
    "Recovery recipient is invalid.",
    { status: 500 }
  );
  return selected;
}

function instant(value, field) {
  const selected = String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)),
    "RECOVERY_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return new Date(selected).toISOString();
}

function currentTime(clock) {
  const value =
    typeof clock === "function" ? clock() : clock?.now?.();
  return instant(value, "Recovery delivery clock");
}

function recoveryBase(value) {
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
    "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED",
    "An HTTPS recovery application URL is required.",
    { status: 500 }
  );
  return selected;
}

function normalizeRequest(input, { baseUrl, clock }) {
  const idempotencyKey = text(
    input?.idempotencyKey,
    "Recovery delivery idempotency key",
    200,
    8
  );
  const recipient = email(input?.recipient);
  const token = text(input?.token, "Recovery token", 512, 32);
  const expiresAt = instant(input?.expiresAt, "Recovery expiry");
  const requestedAt = instant(
    input?.requestedAt ?? currentTime(clock),
    "Recovery request time"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(requestedAt) &&
      Date.parse(expiresAt) - Date.parse(requestedAt) <=
        MAXIMUM_RECOVERY_TTL_MS,
    "RECOVERY_DELIVERY_EXPIRED",
    "Recovery delivery is expired or has an invalid lifetime.",
    { status: 409 }
  );
  const recoveryUrl = new URL(baseUrl.href);
  recoveryUrl.hash = `recovery=${encodeURIComponent(token)}`;
  const payload = {
    schema: RECOVERY_SCHEMA,
    recipient,
    template: "password_recovery",
    recoveryUrl: recoveryUrl.href,
    requestedAt,
    expiresAt
  };
  return {
    idempotencyKey,
    payload,
    payloadDigest: digest(payload)
  };
}

function idempotencyConflict() {
  return new HostedError(
    "RECOVERY_DELIVERY_IDEMPOTENCY_CONFLICT",
    "That recovery delivery key was already used for another message.",
    { status: 409 }
  );
}

function heldError() {
  return new HostedError(
    "RECOVERY_DELIVERY_HELD",
    "Recovery email is not available. Contact Site Sourcery for help.",
    {
      status: 503,
      details: {
        delivery: "manual_operator",
        emailSent: false
      }
    }
  );
}

function publicReceipt({
  mode,
  provider,
  providerMessageId,
  idempotencyKey,
  payloadDigest,
  acceptedAt,
  expiresAt
}) {
  const facts = {
    schema: "sitesourcery.recovery-delivery-receipt/v1",
    mode,
    provider,
    providerMessageId,
    idempotencyKey,
    payloadDigest,
    acceptedAt,
    expiresAt
  };
  return Object.freeze({
    ...facts,
    state: "delivered",
    receiptId: digest(facts)
  });
}

export function createHeldRecoveryMailPort({
  recoveryBaseUrl = "https://sitesourcery.com/abracadabra/app/"
} = {}) {
  recoveryBase(recoveryBaseUrl);
  return Object.freeze({
    kind: "recovery-mail",
    mode: "held",
    async readiness() {
      return {
        ready: false,
        verified: false,
        kind: "recovery-mail",
        mode: "held",
        code: "RECOVERY_DELIVERY_HELD"
      };
    },
    async deliver() {
      throw heldError();
    }
  });
}

export function createDevelopmentRecoveryMailSink({
  recoveryBaseUrl = "https://staging.sitesourcery.test/abracadabra/app/",
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const baseUrl = recoveryBase(recoveryBaseUrl);
  const deliveries = new Map();
  const messages = [];

  return Object.freeze({
    kind: "recovery-mail",
    mode: "dev-sink",
    async readiness() {
      return {
        ready: true,
        verified: true,
        kind: "recovery-mail",
        mode: "dev-sink",
        provider: "development-sink"
      };
    },
    async deliver(input) {
      const request = normalizeRequest(input, { baseUrl, clock });
      const prior = deliveries.get(request.idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== request.payloadDigest) {
          throw idempotencyConflict();
        }
        return prior.receipt;
      }
      const acceptedAt = currentTime(clock);
      const receipt = publicReceipt({
        mode: "dev-sink",
        provider: "development-sink",
        providerMessageId: `dev_${digest(request.idempotencyKey).slice(0, 24)}`,
        idempotencyKey: request.idempotencyKey,
        payloadDigest: request.payloadDigest,
        acceptedAt,
        expiresAt: request.payload.expiresAt
      });
      deliveries.set(request.idempotencyKey, {
        payloadDigest: request.payloadDigest,
        receipt
      });
      messages.push(Object.freeze({ ...request.payload }));
      return receipt;
    },
    readForTest(recipient) {
      const selected = email(recipient);
      return messages
        .filter((message) => message.recipient === selected)
        .map((message) => ({ ...message }));
    }
  });
}

export function createProductionRecoveryMailPort({
  transport = null,
  recoveryBaseUrl = "https://sitesourcery.com/abracadabra/app/",
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const baseUrl = recoveryBase(recoveryBaseUrl);
  const deliveries = new Map();

  async function transportReadiness() {
    if (
      !transport ||
      typeof transport.readiness !== "function" ||
      typeof transport.sendRecovery !== "function"
    ) {
      return {
        ready: false,
        verified: false,
        kind: "recovery-mail",
        mode: "production",
        code: "RECOVERY_TRANSPORT_REQUIRED"
      };
    }
    try {
      const status = await transport.readiness();
      if (
        status?.ready !== true ||
        status?.verified !== true ||
        typeof status.provider !== "string" ||
        status.provider.length === 0
      ) {
        return {
          ready: false,
          verified: false,
          kind: "recovery-mail",
          mode: "production",
          code: "RECOVERY_TRANSPORT_UNVERIFIED"
        };
      }
      return {
        ready: true,
        verified: true,
        kind: "recovery-mail",
        mode: "production",
        provider: status.provider
      };
    } catch {
      return {
        ready: false,
        verified: false,
        kind: "recovery-mail",
        mode: "production",
        code: "RECOVERY_TRANSPORT_UNAVAILABLE"
      };
    }
  }

  return Object.freeze({
    kind: "recovery-mail",
    mode: "production",
    readiness: transportReadiness,
    async deliver(input) {
      const status = await transportReadiness();
      if (!status.ready) throw heldError();
      const request = normalizeRequest(input, { baseUrl, clock });
      const prior = deliveries.get(request.idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== request.payloadDigest) {
          throw idempotencyConflict();
        }
        return prior.receipt;
      }
      const providerReceipt = await transport.sendRecovery({
        idempotencyKey: request.idempotencyKey,
        payloadDigest: request.payloadDigest,
        ...request.payload
      });
      const providerMessageId = text(
        providerReceipt?.providerMessageId,
        "Recovery provider message ID",
        500
      );
      const acceptedAt = instant(
        providerReceipt?.acceptedAt,
        "Recovery provider acceptance time"
      );
      invariant(
        providerReceipt?.accepted === true &&
          providerReceipt.provider === status.provider &&
          providerReceipt.idempotencyKey === request.idempotencyKey &&
          providerReceipt.payloadDigest === request.payloadDigest &&
          Date.parse(acceptedAt) >=
            Date.parse(request.payload.requestedAt) &&
          Date.parse(acceptedAt) <
            Date.parse(request.payload.expiresAt),
        "RECOVERY_DELIVERY_RECEIPT_INVALID",
        "Recovery transport returned an invalid delivery receipt.",
        { status: 502 }
      );
      const receipt = publicReceipt({
        mode: "production",
        provider: status.provider,
        providerMessageId,
        idempotencyKey: request.idempotencyKey,
        payloadDigest: request.payloadDigest,
        acceptedAt,
        expiresAt: request.payload.expiresAt
      });
      deliveries.set(request.idempotencyKey, {
        payloadDigest: request.payloadDigest,
        receipt
      });
      return receipt;
    }
  });
}
