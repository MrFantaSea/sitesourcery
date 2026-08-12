import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const CARE_CORE_CONTRACT_SCHEMA =
  "sitesourcery.care-customer-contract/v1";
export const CARE_CORE_PERIOD_SCHEMA =
  "sitesourcery.care-period/v1";
export const CARE_CORE_SCOPE_SCHEMA =
  "sitesourcery.care-scope-claim/v1";
export const CARE_CORE_TICKET_SCHEMA =
  "sitesourcery.care-ticket-command/v1";
export const CARE_CORE_CAPACITY_SCHEMA =
  "sitesourcery.care-capacity-command/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const CONTRACT_KINDS = new Set([
  "rescue", "custom_care", "outside_management", "alakazam_care"
]);
const CAPACITY_SOURCES = new Set(["carried", "included"]);
const TICKET_BASIS_KINDS = new Set([
  "assessment_finding", "customer_request", "monitoring_incident",
  "rescue_scope"
]);
const TICKET_TRANSITIONS = Object.freeze({
  open: Object.freeze({ action: "ticket_open", state: "open" }),
  start: Object.freeze({ action: "ticket_start", state: "in_progress" }),
  wait: Object.freeze({ action: "ticket_wait", state: "waiting_customer" }),
  resume: Object.freeze({ action: "ticket_resume", state: "in_progress" }),
  resolve: Object.freeze({ action: "ticket_resolve", state: "resolved" }),
  reopen: Object.freeze({ action: "ticket_reopen", state: "in_progress" }),
  close: Object.freeze({ action: "ticket_close", state: "closed" })
});

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "CARE_CORE_INVALID",
    "Care command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function date(value, field) {
  invariant(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function nextCalendarMonth(value) {
  const selected = new Date(`${value}T00:00:00.000Z`);
  const targetMonth = selected.getUTCMonth() + 1;
  const targetYear = selected.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = targetMonth % 12;
  const lastTargetDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    Math.min(selected.getUTCDate(), lastTargetDay)
  )).toISOString().slice(0, 10);
}

function actor(value) {
  exactObject(
    value,
    ["actorId", "actorKind", "organizationId"],
    "Care actor"
  );
  invariant(
    ["operator", "system"].includes(value.actorKind),
    "CARE_CORE_INVALID",
    "Care actor kind is invalid.",
    { status: 400 }
  );
  return {
    actorKind: value.actorKind,
    actorId: uuid(value.actorId, "Care actor ID", {
      nullable: value.actorKind === "system"
    }),
    organizationId: uuid(value.organizationId, "Care actor organization ID")
  };
}

function positiveInteger(value, field, maximum = 10_000) {
  invariant(
    Number.isSafeInteger(value) && value > 0 && value <= maximum,
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function nonnegativeInteger(value, field, maximum = 10_000) {
  invariant(
    Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    "CARE_CORE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandEnvelope(value, keys, schema, action) {
  exactObject(
    value,
    ["actor", "commandId", "recordedAt", ...keys],
    "Care command"
  );
  const selected = {
    schema,
    action,
    ...actor(value.actor),
    commandId: commandId(value.commandId),
    recordedAt: instant(value.recordedAt, "Care command time")
  };
  return selected;
}

function sealCommand(selected) {
  return deepFreeze({ ...selected, requestDigest: digest(selected) });
}

export function createCareContractRegistration(value) {
  const selected = commandEnvelope(
    value,
    [
      "acceptanceDigest", "acceptanceReferenceId", "catalogIdentityId",
      "contractId", "contractKind", "customerId", "projectId",
      "providerScopeDigest", "scopeDigest"
    ],
    CARE_CORE_CONTRACT_SCHEMA,
    "contract_register"
  );
  invariant(
    CONTRACT_KINDS.has(value.contractKind),
    "CARE_CORE_INVALID",
    "Care contract kind is invalid.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    contractId: uuid(value.contractId, "Care contract ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    customerId: uuid(value.customerId, "Care customer ID"),
    catalogIdentityId: uuid(
      value.catalogIdentityId,
      "Care catalog identity ID"
    ),
    contractKind: value.contractKind,
    acceptanceReferenceId: uuid(
      value.acceptanceReferenceId,
      "Care acceptance reference ID"
    ),
    acceptanceDigest: sha256(value.acceptanceDigest, "Care acceptance digest"),
    scopeDigest: sha256(value.scopeDigest, "Care scope digest"),
    providerScopeDigest: sha256(
      value.providerScopeDigest,
      "Care provider scope digest"
    ),
    authorityState: "held",
    customerEffects: false,
    paymentEffects: false,
    providerEffects: false
  });
}

export function createCarePeriodOpen(value) {
  const selected = commandEnvelope(
    value,
    [
      "carriedFromPeriodId", "carriedUnits", "contractId", "endsOn",
      "includedUnits", "periodId", "projectId", "providerPeriodKey",
      "providerScopeDigest", "startsOn"
    ],
    CARE_CORE_PERIOD_SCHEMA,
    "period_open"
  );
  const startsOn = date(value.startsOn, "Care period start");
  const endsOn = date(value.endsOn, "Care period end");
  invariant(
    nextCalendarMonth(startsOn) === endsOn,
    "CARE_CORE_INVALID",
    "Care periods must cover exactly one calendar month.",
    { status: 400 }
  );
  const carriedUnits = nonnegativeInteger(value.carriedUnits, "Carried units", 100);
  const carriedFromPeriodId = uuid(
    value.carriedFromPeriodId,
    "Carried-from period ID",
    { nullable: true }
  );
  invariant(
    (carriedUnits === 0) === (carriedFromPeriodId === null),
    "CARE_CORE_INVALID",
    "Care rollover authority is incomplete.",
    { status: 400 }
  );
  invariant(
    typeof value.providerPeriodKey === "string" &&
      SAFE_ID.test(value.providerPeriodKey),
    "CARE_CORE_INVALID",
    "Care provider period key is invalid.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    periodId: uuid(value.periodId, "Care period ID"),
    contractId: uuid(value.contractId, "Care contract ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    providerScopeDigest: sha256(
      value.providerScopeDigest,
      "Care provider scope digest"
    ),
    providerPeriodKey: value.providerPeriodKey,
    startsOn,
    endsOn,
    includedUnits: positiveInteger(value.includedUnits, "Included units", 100),
    carriedUnits,
    carriedFromPeriodId,
    authorityState: "held",
    providerEffects: false
  });
}

export function createCarePeriodClose(value) {
  const selected = commandEnvelope(
    value,
    ["expectedRevision", "periodId", "projectId"],
    CARE_CORE_PERIOD_SCHEMA,
    "period_close"
  );
  return sealCommand({
    ...selected,
    periodId: uuid(value.periodId, "Care period ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    expectedRevision: positiveInteger(
      value.expectedRevision,
      "Care period revision"
    ),
    providerEffects: false
  });
}

export function createCareScopeClaim(value) {
  const selected = commandEnvelope(
    value,
    [
      "claimId", "claimMode", "coverageKey", "includedByClaimId",
      "periodEndsOn", "periodId", "periodStartsOn", "projectId",
      "scopeIdentityDigest"
    ],
    CARE_CORE_SCOPE_SCHEMA,
    "scope_claim"
  );
  invariant(
    ["primary", "included"].includes(value.claimMode),
    "CARE_CORE_INVALID",
    "Care scope claim mode is invalid.",
    { status: 400 }
  );
  invariant(
    typeof value.coverageKey === "string" &&
      /^[a-z][a-z0-9_]{2,79}$/u.test(value.coverageKey),
    "CARE_CORE_INVALID",
    "Care coverage key is invalid.",
    { status: 400 }
  );
  const includedByClaimId = uuid(
    value.includedByClaimId,
    "Included-by Care claim ID",
    { nullable: true }
  );
  invariant(
    (value.claimMode === "included") === (includedByClaimId !== null),
    "CARE_CORE_INVALID",
    "Included Care scope authority is incomplete.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    claimId: uuid(value.claimId, "Care scope claim ID"),
    periodId: uuid(value.periodId, "Care period ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    periodStartsOn: date(value.periodStartsOn, "Care scope period start"),
    periodEndsOn: date(value.periodEndsOn, "Care scope period end"),
    coverageKey: value.coverageKey,
    scopeIdentityDigest: sha256(
      value.scopeIdentityDigest,
      "Care scope identity digest"
    ),
    claimMode: value.claimMode,
    includedByClaimId,
    paymentEffects: false,
    providerEffects: false
  });
}

export function createCareTicketOpen(value) {
  const selected = commandEnvelope(
    value,
    [
      "basisDigest", "basisKind", "basisReferenceId", "contractId",
      "periodId", "projectId", "supportTicketId", "ticketId",
      "workScopeDigest"
    ],
    CARE_CORE_TICKET_SCHEMA,
    "ticket_open"
  );
  invariant(
    TICKET_BASIS_KINDS.has(value.basisKind),
    "CARE_CORE_INVALID",
    "Care ticket basis is invalid.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    ticketId: uuid(value.ticketId, "Care ticket ID"),
    contractId: uuid(value.contractId, "Care contract ID"),
    periodId: uuid(value.periodId, "Care period ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    supportTicketId: uuid(value.supportTicketId, "Support ticket ID"),
    basisKind: value.basisKind,
    basisReferenceId: uuid(
      value.basisReferenceId,
      "Care ticket basis reference ID",
      { nullable: true }
    ),
    basisDigest: sha256(value.basisDigest, "Care ticket basis digest"),
    workScopeDigest: sha256(
      value.workScopeDigest,
      "Care ticket work-scope digest"
    ),
    state: "open",
    providerEffects: false,
    mailEffects: false
  });
}

export function createCareTicketTransition(value) {
  const selected = commandEnvelope(
    value,
    ["expectedRevision", "projectId", "ticketId", "transition"],
    CARE_CORE_TICKET_SCHEMA,
    "ticket_transition"
  );
  const transition = TICKET_TRANSITIONS[value.transition];
  invariant(
    transition && value.transition !== "open",
    "CARE_CORE_INVALID",
    "Care ticket transition is invalid.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    action: transition.action,
    transition: value.transition,
    targetState: transition.state,
    ticketId: uuid(value.ticketId, "Care ticket ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    expectedRevision: positiveInteger(
      value.expectedRevision,
      "Care ticket revision"
    ),
    providerEffects: false,
    mailEffects: false
  });
}

export function createCareCapacityAllocation(value) {
  const selected = commandEnvelope(
    value,
    [
      "capacitySource", "entryId", "periodId", "projectId", "ticketId",
      "units"
    ],
    CARE_CORE_CAPACITY_SCHEMA,
    "capacity_allocate"
  );
  invariant(
    CAPACITY_SOURCES.has(value.capacitySource),
    "CARE_CORE_INVALID",
    "Care capacity source is invalid.",
    { status: 400 }
  );
  return sealCommand({
    ...selected,
    entryId: uuid(value.entryId, "Care capacity entry ID"),
    periodId: uuid(value.periodId, "Care period ID"),
    ticketId: uuid(value.ticketId, "Care ticket ID"),
    projectId: uuid(value.projectId, "Care project ID"),
    capacitySource: value.capacitySource,
    units: positiveInteger(value.units, "Care capacity units", 100),
    providerEffects: false,
    paymentEffects: false
  });
}

function heldError() {
  return new HostedError(
    "CARE_CORE_HELD",
    "Care contracts and fulfillment remain held.",
    {
      status: 503,
      details: {
        customerEffects: false,
        mailEffects: false,
        paymentEffects: false,
        providerEffects: false
      }
    }
  );
}

export function createHeldCareCoreService({ repository } = {}) {
  invariant(
    repository && typeof repository.readiness === "function",
    "CARE_CORE_CONFIGURATION_REQUIRED",
    "The held Care repository is required.",
    { status: 500 }
  );
  const reject = async () => { throw heldError(); };
  return Object.freeze({
    kind: "care-core",
    mode: "held",
    customerEffects: false,
    mailEffects: false,
    paymentEffects: false,
    providerEffects: false,
    readiness: () => repository.readiness(),
    registerContract: reject,
    openPeriod: reject,
    closePeriod: reject,
    claimScope: reject,
    openTicket: reject,
    transitionTicket: reject,
    allocateCapacity: reject
  });
}
