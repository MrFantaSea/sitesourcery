import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const REGISTRATION_SCHEMA =
  "sitesourcery.registration-verification-email/v1";
const MAXIMUM_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

function text(value, field, maximum, minimum = 1) {
  const selected = String(value ?? "").trim();
  invariant(
    selected.length >= minimum && selected.length <= maximum,
    "REGISTRATION_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function email(value) {
  const selected = text(
    value,
    "Registration recipient",
    254
  ).toLowerCase();
  invariant(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(selected),
    "REGISTRATION_DELIVERY_INVALID",
    "Registration recipient is invalid.",
    { status: 500 }
  );
  return selected;
}

function instant(value, field) {
  const selected = String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)),
    "REGISTRATION_DELIVERY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return new Date(selected).toISOString();
}

function currentTime(clock) {
  const value =
    typeof clock === "function" ? clock() : clock?.now?.();
  return instant(value, "Registration delivery clock");
}

function registrationBase(value) {
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
    "REGISTRATION_DELIVERY_CONFIGURATION_REQUIRED",
    "An HTTPS registration application URL is required.",
    { status: 500 }
  );
  return selected;
}

function normalizeRequest(input, { baseUrl, clock }) {
  const idempotencyKey = text(
    input?.idempotencyKey,
    "Registration delivery idempotency key",
    200,
    8
  );
  const recipient = email(input?.recipient);
  const token = text(
    input?.token,
    "Registration verification token",
    512,
    32
  );
  const expiresAt = instant(
    input?.expiresAt,
    "Registration verification expiry"
  );
  const requestedAt = instant(
    input?.requestedAt ?? currentTime(clock),
    "Registration request time"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(requestedAt) &&
      Date.parse(expiresAt) - Date.parse(requestedAt) <=
        MAXIMUM_REGISTRATION_TTL_MS,
    "REGISTRATION_DELIVERY_EXPIRED",
    "Registration verification delivery is expired or has an invalid lifetime.",
    { status: 409 }
  );
  const verificationUrl = new URL(baseUrl.href);
  verificationUrl.hash =
    `verify-registration=${encodeURIComponent(token)}`;
  const payload = {
    schema: REGISTRATION_SCHEMA,
    recipient,
    template: "registration_verification",
    verificationUrl: verificationUrl.href,
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
    "REGISTRATION_DELIVERY_IDEMPOTENCY_CONFLICT",
    "That registration delivery key was already used for another message.",
    { status: 409 }
  );
}

function heldError() {
  return new HostedError(
    "ACCOUNT_REGISTRATION_HELD",
    "New account registration is not open yet. Contact Site Sourcery for help.",
    {
      status: 503,
      details: {
        delivery: "held",
        emailSent: false
      }
    }
  );
}

function publicReceipt({
  state,
  mode,
  provider,
  providerMessageId,
  idempotencyKey,
  payloadDigest,
  acceptedAt,
  expiresAt
}) {
  const facts = {
    schema:
      "sitesourcery.registration-delivery-receipt/v1",
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
    state,
    receiptId: digest(facts)
  });
}

export function createHeldRegistrationMailPort({
  registrationBaseUrl =
    "https://sitesourcery.com/abracadabra/app/"
} = {}) {
  registrationBase(registrationBaseUrl);
  return Object.freeze({
    kind: "registration-mail",
    mode: "held",
    async readiness() {
      return {
        ready: false,
        verified: false,
        kind: "registration-mail",
        mode: "held",
        code: "ACCOUNT_REGISTRATION_HELD"
      };
    },
    async deliver() {
      throw heldError();
    }
  });
}

// This adapter is deliberately process-local. It exists for tests and private
// development only: it performs no network I/O and exposes messages solely
// through its explicit test reader.
export function createDevelopmentRegistrationMailSink({
  registrationBaseUrl =
    "https://staging.sitesourcery.test/abracadabra/app/",
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const baseUrl = registrationBase(registrationBaseUrl);
  const deliveries = new Map();
  const messages = [];

  return Object.freeze({
    kind: "registration-mail",
    mode: "dev-sink",
    async readiness() {
      return {
        ready: true,
        verified: true,
        kind: "registration-mail",
        mode: "dev-sink",
        provider: "development-sink"
      };
    },
    async deliver(input) {
      const request = normalizeRequest(input, {
        baseUrl,
        clock
      });
      const prior = deliveries.get(request.idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== request.payloadDigest) {
          throw idempotencyConflict();
        }
        return prior.receipt;
      }
      const acceptedAt = currentTime(clock);
      const receipt = publicReceipt({
        state: "delivered",
        mode: "dev-sink",
        provider: "development-sink",
        providerMessageId:
          `dev_${digest(request.idempotencyKey).slice(0, 24)}`,
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

export function createProductionRegistrationMailPort({
  transport = null,
  registrationBaseUrl =
    "https://sitesourcery.com/abracadabra/app/",
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const baseUrl = registrationBase(registrationBaseUrl);
  const deliveries = new Map();

  async function transportReadiness() {
    if (
      !transport ||
      typeof transport.readiness !== "function" ||
      typeof transport.sendRegistration !== "function"
    ) {
      return {
        ready: false,
        verified: false,
        kind: "registration-mail",
        mode: "production",
        code: "REGISTRATION_TRANSPORT_REQUIRED"
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
          kind: "registration-mail",
          mode: "production",
          code: "REGISTRATION_TRANSPORT_UNVERIFIED"
        };
      }
      return {
        ready: true,
        verified: true,
        kind: "registration-mail",
        mode: "production",
        provider: status.provider
      };
    } catch {
      return {
        ready: false,
        verified: false,
        kind: "registration-mail",
        mode: "production",
        code: "REGISTRATION_TRANSPORT_UNAVAILABLE"
      };
    }
  }

  return Object.freeze({
    kind: "registration-mail",
    mode: "production",
    providerEffects: true,
    readiness: transportReadiness,
    async deliver(input) {
      const status = await transportReadiness();
      if (!status.ready) throw heldError();
      const request = normalizeRequest(input, {
        baseUrl,
        clock
      });
      const prior = deliveries.get(request.idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== request.payloadDigest) {
          throw idempotencyConflict();
        }
        return prior.receipt;
      }
      const providerReceipt =
        await transport.sendRegistration({
          idempotencyKey: request.idempotencyKey,
          payloadDigest: request.payloadDigest,
          ...request.payload
        });
      const providerMessageId = text(
        providerReceipt?.providerMessageId,
        "Registration provider message ID",
        500
      );
      const acceptedAt = instant(
        providerReceipt?.acceptedAt,
        "Registration provider acceptance time"
      );
      invariant(
        providerReceipt?.accepted === true &&
          providerReceipt.provider === status.provider &&
          providerReceipt.idempotencyKey ===
            request.idempotencyKey &&
          providerReceipt.payloadDigest ===
            request.payloadDigest &&
          Date.parse(acceptedAt) >=
            Date.parse(request.payload.requestedAt) &&
          Date.parse(acceptedAt) <
            Date.parse(request.payload.expiresAt),
        "REGISTRATION_DELIVERY_RECEIPT_INVALID",
        "Registration transport returned an invalid delivery receipt.",
        { status: 502 }
      );
      const receipt = publicReceipt({
        state: "provider_accepted",
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
