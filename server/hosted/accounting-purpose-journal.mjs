import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const ACCOUNTING_PURPOSE_JOURNAL_SCHEMA =
  "sitesourcery.accounting-purpose-journal/v1";
export const ACCOUNTING_PURPOSE_EXPORT_SCHEMA =
  "sitesourcery.accounting-purpose-journal-export/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "ACCOUNTING_PURPOSE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "ACCOUNTING_PURPOSE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "ACCOUNTING_PURPOSE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function operatorScope(value, field) {
  exactObject(value, ["actorId", "operatorOrganizationId"], field);
  return deepFreeze({
    actorId: uuid(value.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      value.operatorOrganizationId,
      "Operator organization ID"
    )
  });
}

function cursor(value) {
  if (value === null) return null;
  exactObject(value, ["idempotencyDigest", "occurredAt"], "Journal cursor");
  invariant(
    typeof value.idempotencyDigest === "string" &&
      SHA256.test(value.idempotencyDigest),
    "ACCOUNTING_PURPOSE_INVALID",
    "Journal cursor digest is invalid.",
    { status: 400 }
  );
  return deepFreeze({
    occurredAt: instant(value.occurredAt, "Journal cursor time"),
    idempotencyDigest: value.idempotencyDigest
  });
}

function heldError() {
  return new HostedError(
    "ACCOUNTING_PURPOSE_HELD",
    "The accounting purpose journal is not connected to production composition.",
    {
      status: 503,
      details: {
        authoritativeAccounting: false,
        commercialEffects: false,
        providerEffects: false
      }
    }
  );
}

const METHODS = Object.freeze(["synchronize", "list", "export"]);

export function createHeldAccountingPurposeJournal() {
  const service = {
    kind: "accounting-purpose-journal",
    mode: "held",
    sourceAuthoritative: false,
    authoritativeAccounting: false,
    commercialEffects: false,
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "accounting-purpose-journal",
        mode: "held",
        code: "ACCOUNTING_PURPOSE_HELD",
        sourceAuthoritative: false,
        authoritativeAccounting: false,
        commercialEffects: false,
        providerEffects: false
      });
    }
  };
  for (const method of METHODS) {
    service[method] = async () => { throw heldError(); };
  }
  return Object.freeze(service);
}

export function createAccountingPurposeJournal({ repository } = {}) {
  invariant(
    repository && ["readiness", "synchronize", "list", "exportRows"]
      .every((method) => typeof repository[method] === "function"),
    "ACCOUNTING_PURPOSE_CONFIGURATION_REQUIRED",
    "A complete accounting purpose journal repository is required.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "accounting-purpose-journal",
    mode: "repository",
    sourceAuthoritative: false,
    authoritativeAccounting: false,
    commercialEffects: false,
    providerEffects: false,
    readiness: () => repository.readiness(),
    synchronize: () => repository.synchronize(),
    list(value) {
      exactObject(
        value,
        ["actorId", "cursor", "limit", "operatorOrganizationId"],
        "Accounting purpose journal read"
      );
      invariant(
        Number.isSafeInteger(value.limit) &&
          value.limit >= 1 && value.limit <= 200,
        "ACCOUNTING_PURPOSE_INVALID",
        "Journal read limit must be between 1 and 200.",
        { status: 400 }
      );
      return repository.list({
        ...operatorScope({
          actorId: value.actorId,
          operatorOrganizationId: value.operatorOrganizationId
        }, "Accounting purpose journal operator"),
        cursor: cursor(value.cursor),
        limit: value.limit
      });
    },
    async export(value) {
      exactObject(
        value,
        ["actorId", "asOf", "operatorOrganizationId"],
        "Accounting purpose journal export"
      );
      const input = {
        ...operatorScope({
          actorId: value.actorId,
          operatorOrganizationId: value.operatorOrganizationId
        }, "Accounting purpose journal export operator"),
        asOf: instant(value.asOf, "Accounting purpose export time")
      };
      const entries = await repository.exportRows(input);
      const selected = {
        schema: ACCOUNTING_PURPOSE_EXPORT_SCHEMA,
        sourceAuthoritative: false,
        authoritativeAccounting: false,
        providerEffects: false,
        asOf: input.asOf,
        rowCount: entries.length,
        entries
      };
      return deepFreeze({ ...selected, exportDigest: digest(selected) });
    }
  });
}
