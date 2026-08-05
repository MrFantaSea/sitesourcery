import {
  deepFreeze
} from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

export const CUSTOM_SERVICES_ACCOUNT_SCHEMA =
  "sitesourcery.custom-services-account/v1";
export const CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA =
  "sitesourcery.custom-services-foundation-snapshot/v1";

const FOUNDATION_CONTRACT =
  "canonical-ss-v34-custom-services-foundation";
const CATALOG_VERSION = "SS-PROFESSIONAL-2026.1";
const SERVICE_KEY = "website_assessment_standard";
const LEGAL_VERSION = "SS-CUSTOM-SERVICES-2026-08-05.1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOSTNAME =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const CREDENTIAL_WORD =
  /(?:password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase|card[ _-]?(?:number|details)|cvv|cvc|health[ _-]?data|private[ _-]?customer[ _-]?records?)/iu;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const PROVIDER_TOKEN = /(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{8,}/u;
const GITHUB_TOKEN = /gh[pousr]_[A-Za-z0-9]{20,}/u;
const JWT =
  /eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}/u;
const CREDENTIALED_URL =
  /[a-z][a-z0-9+.-]*:\/\/[^\s\/:@]+:[^\s@\/]+@/iu;

const PLATFORM_LABELS = Object.freeze({
  custom: "Custom or unknown",
  other: "Another platform",
  shopify: "Shopify",
  squarespace: "Squarespace",
  unknown: "I do not know",
  wix: "Wix",
  wordpress: "WordPress"
});

const SIZE_LABELS = Object.freeze({
  application_or_unknown: "Application-like or unknown",
  eleven_to_fifty: "11–50 public pages",
  more_than_fifty: "More than 50 public pages",
  one_to_ten: "1–10 public pages"
});

const COMPLEXITY_LABELS = Object.freeze({
  authenticated_area: "Membership or sign-in area",
  commerce: "Ecommerce",
  forms: "Forms",
  large_content_set: "Large content set",
  multilingual: "Multiple languages",
  regulated_content: "Regulated subject matter",
  third_party_integrations: "Third-party integrations",
  unknown_platform: "Platform is unknown"
});

const HELD_REASON = Object.freeze({
  code: "customer_request_capability_held",
  message: "This customer request surface is not open yet."
});

function exactKeys(
  value,
  expected,
  field,
  { code = "repository_conflict", status = 500 } = {}
) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    `${field} is invalid`,
    { status }
  );
  return value;
}

function requiredText(
  value,
  field,
  maximum,
  { code = "repository_conflict", status = 500 } = {}
) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= maximum &&
      !CONTROL_CHARACTER.test(value),
    code,
    `${field} is invalid`,
    { status }
  );
  return value;
}

function safeCustomerText(value, field, maximum, minimum = 1) {
  const selected = requiredText(value, field, maximum);
  invariant(
    selected.length >= minimum &&
      !CREDENTIAL_WORD.test(selected) &&
      !PRIVATE_KEY_BLOCK.test(selected) &&
      !PROVIDER_TOKEN.test(selected) &&
      !GITHUB_TOKEN.test(selected) &&
      !JWT.test(selected) &&
      !CREDENTIALED_URL.test(selected),
    "repository_conflict",
    `${field} is not customer-safe`,
    { status: 500 }
  );
  return selected;
}

function nullableCustomerText(value, field, maximum, minimum = 1) {
  return value === null
    ? null
    : safeCustomerText(value, field, maximum, minimum);
}

function exactUuid(
  value,
  field,
  { code = "repository_conflict", status = 500 } = {}
) {
  const selected = requiredText(value, field, 36, { code, status });
  invariant(
    UUID.test(selected),
    code,
    `${field} is invalid`,
    { status }
  );
  return selected;
}

function exactIso(value, field) {
  const selected = requiredText(value, field, 40);
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function nullableIso(value, field) {
  return value === null ? null : exactIso(value, field);
}

function exactDate(value, field) {
  if (value === null) return null;
  const selected = requiredText(value, field, 10);
  invariant(
    /^\d{4}-\d{2}-\d{2}$/u.test(selected) &&
      new Date(`${selected}T00:00:00.000Z`)
        .toISOString()
        .slice(0, 10) === selected,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "organizationId", "projectId"],
    "scope",
    { code: "invalid_input", status: 400 }
  );
  const actorId = exactUuid(value.actorId, "scope.actorId", {
    code: "invalid_input",
    status: 400
  });
  const customerId = exactUuid(value.customerId, "scope.customerId", {
    code: "invalid_input",
    status: 400
  });
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId,
    customerId,
    organizationId: exactUuid(
      value.organizationId,
      "scope.organizationId",
      { code: "invalid_input", status: 400 }
    ),
    projectId: exactUuid(value.projectId, "scope.projectId", {
      code: "invalid_input",
      status: 400
    })
  });
}

function exactBinding(value, scope, field) {
  const organizationId = exactUuid(
    value.organizationId,
    `${field}.organizationId`
  );
  const projectId = exactUuid(value.projectId, `${field}.projectId`);
  const customerId = exactUuid(
    value.customerId,
    `${field}.customerId`
  );
  invariant(
    organizationId === scope.organizationId &&
      projectId === scope.projectId &&
      customerId === scope.customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({ organizationId, projectId, customerId });
}

function exactAccount(value, scope) {
  exactKeys(
    value,
    [
      "accountState",
      "customerId",
      "displayName",
      "email",
      "membershipState",
      "organizationDisplayName",
      "organizationId",
      "projectId",
      "projectState"
    ],
    "snapshot.account"
  );
  exactBinding(value, scope, "snapshot.account");
  const email = requiredText(value.email, "snapshot.account.email", 254);
  invariant(
    EMAIL.test(email) &&
      value.accountState === "active" &&
      value.membershipState === "active" &&
      value.projectState === "active",
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    displayName: safeCustomerText(
      value.displayName,
      "snapshot.account.displayName",
      100
    ),
    email,
    organizationDisplayName: safeCustomerText(
      value.organizationDisplayName,
      "snapshot.account.organizationDisplayName",
      160
    )
  });
}

function exactHostname(value, field) {
  const selected = requiredText(value, field, 253);
  invariant(
    HOSTNAME.test(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function exactPlatform(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const selected = requiredText(value, field, 40);
  invariant(
    Object.hasOwn(PLATFORM_LABELS, selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function exactProfile(value, scope) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "createdAt",
      "customerId",
      "delegatedAccessState",
      "observedAt",
      "observedHostname",
      "organizationId",
      "origin",
      "ownershipState",
      "platformFamily",
      "projectId",
      "revision",
      "supportabilityState",
      "takeoverRequired",
      "takeoverState",
      "updatedAt"
    ],
    "snapshot.profile"
  );
  exactBinding(value, scope, "snapshot.profile");
  const observedHostname =
    value.observedHostname === null
      ? null
      : exactHostname(
          value.observedHostname,
          "snapshot.profile.observedHostname"
        );
  const observedAt = nullableIso(
    value.observedAt,
    "snapshot.profile.observedAt"
  );
  const createdAt = exactIso(
    value.createdAt,
    "snapshot.profile.createdAt"
  );
  const updatedAt = exactIso(
    value.updatedAt,
    "snapshot.profile.updatedAt"
  );
  invariant(
    value.origin === "external" &&
      value.ownershipState === "customer_stated" &&
      value.takeoverRequired === true &&
      value.takeoverState === "review_required" &&
      value.supportabilityState === "not_reviewed" &&
      value.delegatedAccessState === "not_requested" &&
      (observedHostname === null) === (observedAt === null) &&
      Date.parse(createdAt) <= Date.parse(updatedAt) &&
      (
        observedAt === null ||
        (
          Date.parse(createdAt) <= Date.parse(observedAt) &&
          Date.parse(observedAt) <= Date.parse(updatedAt)
        )
      ),
    "repository_conflict",
    "the customer website profile changed",
    { status: 500 }
  );
  return Object.freeze({
    observedHostname,
    observedAt,
    platformFamily: exactPlatform(
      value.platformFamily,
      "snapshot.profile.platformFamily"
    ),
    revision: positiveInteger(
      value.revision,
      "snapshot.profile.revision"
    ),
    createdAt,
    updatedAt
  });
}

function exactServiceCase(value, scope) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "caseId",
      "createdAt",
      "createdByCustomerId",
      "customerId",
      "organizationId",
      "projectId",
      "revision",
      "source",
      "state",
      "title",
      "updatedAt",
      "withdrawnAt"
    ],
    "snapshot.serviceCase"
  );
  exactBinding(value, scope, "snapshot.serviceCase");
  const caseId = exactUuid(
    value.caseId,
    "snapshot.serviceCase.caseId"
  );
  const createdByCustomerId = exactUuid(
    value.createdByCustomerId,
    "snapshot.serviceCase.createdByCustomerId"
  );
  invariant(
    createdByCustomerId === scope.customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  const state = requiredText(
    value.state,
    "snapshot.serviceCase.state",
    20
  );
  const revision = positiveInteger(
    value.revision,
    "snapshot.serviceCase.revision"
  );
  const createdAt = exactIso(
    value.createdAt,
    "snapshot.serviceCase.createdAt"
  );
  const updatedAt = exactIso(
    value.updatedAt,
    "snapshot.serviceCase.updatedAt"
  );
  const withdrawnAt = nullableIso(
    value.withdrawnAt,
    "snapshot.serviceCase.withdrawnAt"
  );
  invariant(
    value.source === "account" &&
      ["draft", "submitted", "withdrawn"].includes(state) &&
      (state === "draft" ? revision === 1 : revision >= 2) &&
      (state === "withdrawn") === (withdrawnAt !== null) &&
      Date.parse(createdAt) <= Date.parse(updatedAt) &&
      (
        withdrawnAt === null ||
        (
          Date.parse(createdAt) <= Date.parse(withdrawnAt) &&
          Date.parse(withdrawnAt) <= Date.parse(updatedAt)
        )
      ),
    "repository_conflict",
    "the customer assessment request changed",
    { status: 500 }
  );
  return Object.freeze({
    caseId,
    state,
    title: safeCustomerText(
      value.title,
      "snapshot.serviceCase.title",
      160,
      2
    ),
    revision,
    createdAt,
    updatedAt,
    withdrawnAt
  });
}

function exactOffering(value, scope, serviceCase) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "caseId",
      "customerId",
      "organizationId",
      "policyPublicationState",
      "projectId",
      "removedAt",
      "requestedAt",
      "requestedByCustomerId",
      "serviceKey",
      "state",
      "updatedAt"
    ],
    "snapshot.offering"
  );
  exactBinding(value, scope, "snapshot.offering");
  const caseId = exactUuid(value.caseId, "snapshot.offering.caseId");
  const requester = exactUuid(
    value.requestedByCustomerId,
    "snapshot.offering.requestedByCustomerId"
  );
  invariant(
    serviceCase !== null &&
      caseId === serviceCase.caseId &&
      requester === scope.customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  const requestedAt = exactIso(
    value.requestedAt,
    "snapshot.offering.requestedAt"
  );
  const updatedAt = exactIso(
    value.updatedAt,
    "snapshot.offering.updatedAt"
  );
  const removedAt = nullableIso(
    value.removedAt,
    "snapshot.offering.removedAt"
  );
  invariant(
    value.serviceKey === SERVICE_KEY &&
      value.policyPublicationState === "held" &&
      ["requested", "removed"].includes(value.state) &&
      (value.state === "removed") === (removedAt !== null) &&
      Date.parse(serviceCase.createdAt) <= Date.parse(requestedAt) &&
      Date.parse(requestedAt) <= Date.parse(updatedAt) &&
      (removedAt === null || Date.parse(removedAt) <= Date.parse(updatedAt)),
    "repository_conflict",
    "the customer assessment offering changed",
    { status: 500 }
  );
  return Object.freeze({
    caseId,
    state: value.state,
    requestedAt,
    removedAt,
    updatedAt
  });
}

function exactComplexityFlags(value) {
  invariant(
    Array.isArray(value) &&
      value.length <= 8 &&
      value.every(
        (item) =>
          typeof item === "string" &&
          Object.hasOwn(COMPLEXITY_LABELS, item)
      ) &&
      new Set(value).size === value.length &&
      JSON.stringify([...value].sort()) === JSON.stringify(value),
    "repository_conflict",
    "snapshot.intake.complexityFlags is invalid",
    { status: 500 }
  );
  return Object.freeze([...value]);
}

function exactIntake(value, scope, serviceCase) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "approximatePublicSize",
      "businessName",
      "caseId",
      "complexityFlags",
      "createdAt",
      "createdByCustomerId",
      "customerId",
      "customerObservation",
      "customerOwnershipAffirmed",
      "importantDate",
      "organizationId",
      "platformFamily",
      "primaryGoal",
      "projectId",
      "publicHostname",
      "publicScheme",
      "revision",
      "siteDisplayName",
      "source",
      "state",
      "submittedAt"
    ],
    "snapshot.intake"
  );
  exactBinding(value, scope, "snapshot.intake");
  const caseId = exactUuid(value.caseId, "snapshot.intake.caseId");
  const creator = exactUuid(
    value.createdByCustomerId,
    "snapshot.intake.createdByCustomerId"
  );
  invariant(
    serviceCase !== null &&
      caseId === serviceCase.caseId &&
      creator === scope.customerId,
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  const publicScheme = requiredText(
    value.publicScheme,
    "snapshot.intake.publicScheme",
    5
  );
  const approximatePublicSize = requiredText(
    value.approximatePublicSize,
    "snapshot.intake.approximatePublicSize",
    40
  );
  const submittedAt = exactIso(
    value.submittedAt,
    "snapshot.intake.submittedAt"
  );
  const createdAt = exactIso(
    value.createdAt,
    "snapshot.intake.createdAt"
  );
  invariant(
    value.source === "account" &&
      value.state === "submitted" &&
      ["http", "https"].includes(publicScheme) &&
      Object.hasOwn(SIZE_LABELS, approximatePublicSize) &&
      value.customerOwnershipAffirmed === true &&
      submittedAt === createdAt &&
      Date.parse(serviceCase.createdAt) <= Date.parse(submittedAt),
    "repository_conflict",
    "the customer assessment intake changed",
    { status: 500 }
  );
  return Object.freeze({
    caseId,
    revision: positiveInteger(
      value.revision,
      "snapshot.intake.revision"
    ),
    siteDisplayName: safeCustomerText(
      value.siteDisplayName,
      "snapshot.intake.siteDisplayName",
      120,
      2
    ),
    publicScheme,
    publicHostname: exactHostname(
      value.publicHostname,
      "snapshot.intake.publicHostname"
    ),
    businessName: nullableCustomerText(
      value.businessName,
      "snapshot.intake.businessName",
      120,
      2
    ),
    primaryGoal: safeCustomerText(
      value.primaryGoal,
      "snapshot.intake.primaryGoal",
      500,
      2
    ),
    customerObservation: nullableCustomerText(
      value.customerObservation,
      "snapshot.intake.customerObservation",
      1000,
      2
    ),
    platformFamily: exactPlatform(
      value.platformFamily,
      "snapshot.intake.platformFamily",
      { nullable: true }
    ),
    approximatePublicSize,
    complexityFlags: exactComplexityFlags(value.complexityFlags),
    importantDate: exactDate(
      value.importantDate,
      "snapshot.intake.importantDate"
    ),
    customerOwnershipAffirmed: true,
    submittedAt,
    createdAt
  });
}

function exactPolicy(value) {
  exactKeys(
    value,
    [
      "catalogVersion",
      "legalVersion",
      "publicationState",
      "serviceKey"
    ],
    "snapshot.policy"
  );
  invariant(
    value.catalogVersion === CATALOG_VERSION &&
      value.serviceKey === SERVICE_KEY &&
      value.legalVersion === LEGAL_VERSION &&
      value.publicationState === "held",
    "repository_conflict",
    "the held assessment policy changed",
    { status: 500 }
  );
}

function exactSnapshot(value, scope) {
  exactKeys(
    value,
    [
      "account",
      "intake",
      "offering",
      "policy",
      "profile",
      "runtimeContract",
      "schema",
      "serviceCase"
    ],
    "snapshot"
  );
  invariant(
    value.schema === CUSTOM_SERVICES_FOUNDATION_SNAPSHOT_SCHEMA &&
      value.runtimeContract === FOUNDATION_CONTRACT,
    "repository_conflict",
    "the custom-services foundation contract changed",
    { status: 500 }
  );
  exactPolicy(value.policy);
  const account = exactAccount(value.account, scope);
  const profile = exactProfile(value.profile, scope);
  const serviceCase = exactServiceCase(value.serviceCase, scope);
  const offering = exactOffering(
    value.offering,
    scope,
    serviceCase
  );
  const intake = exactIntake(value.intake, scope, serviceCase);

  invariant(
    profile !== null ||
      (serviceCase === null && offering === null && intake === null),
    "repository_conflict",
    "the customer website request binding changed",
    { status: 500 }
  );
  invariant(
    serviceCase !== null || (offering === null && intake === null),
    "repository_conflict",
    "the customer assessment request binding changed",
    { status: 500 }
  );

  if (profile !== null && serviceCase !== null) {
    invariant(
      Date.parse(profile.createdAt) <= Date.parse(serviceCase.createdAt),
      "repository_conflict",
      "the customer website request chronology changed",
      { status: 500 }
    );
  }

  if (serviceCase?.state === "draft") {
    invariant(
      offering === null && intake === null,
      "repository_conflict",
      "the draft assessment request contains stale submitted facts",
      { status: 500 }
    );
  }

  if (serviceCase?.state === "submitted") {
    invariant(
      offering !== null &&
        offering.state === "requested" &&
        intake !== null &&
        profile?.observedHostname !== null &&
        profile.observedHostname === intake.publicHostname &&
        (
          intake.platformFamily === null ||
          profile.platformFamily === "unknown" ||
          profile.platformFamily === intake.platformFamily
        ) &&
        Date.parse(profile.updatedAt) <= Date.parse(intake.submittedAt) &&
        Date.parse(serviceCase.updatedAt) <=
          Date.parse(offering.requestedAt) &&
        Date.parse(offering.requestedAt) <=
          Date.parse(intake.submittedAt),
      "repository_conflict",
      "the submitted assessment request contains stale or incomplete facts",
      { status: 500 }
    );
  }

  if (serviceCase?.state === "withdrawn") {
    invariant(
      (
        intake === null && offering === null
      ) || (
        intake !== null &&
        offering !== null &&
        Date.parse(offering.requestedAt) <=
          Date.parse(intake.submittedAt) &&
        Date.parse(intake.submittedAt) <=
          Date.parse(serviceCase.withdrawnAt)
      ),
      "repository_conflict",
      "the withdrawn assessment request contains stale or incomplete facts",
      { status: 500 }
    );
  }

  return Object.freeze({
    account,
    profile,
    serviceCase,
    offering,
    intake
  });
}

function platformProjection(platformFamily) {
  if (platformFamily === null) return null;
  return Object.freeze({
    key: platformFamily,
    label: PLATFORM_LABELS[platformFamily]
  });
}

function websiteProjection(profile, intake) {
  if (profile === null) return null;
  const platformFamily = intake?.platformFamily ?? profile.platformFamily;
  return Object.freeze({
    state: intake === null ? "details_required" : "saved",
    displayName: intake?.siteDisplayName ?? null,
    publicUrl:
      intake === null
        ? null
        : `${intake.publicScheme}://${intake.publicHostname}/`,
    platform: platformProjection(platformFamily),
    origin: "external",
    customerOwnershipAffirmed:
      intake?.customerOwnershipAffirmed ?? false,
    updatedAt: intake?.submittedAt ?? profile.updatedAt
  });
}

function assessmentFacts(intake) {
  if (intake === null) return null;
  return Object.freeze({
    businessName: intake.businessName,
    primaryGoal: intake.primaryGoal,
    customerObservation: intake.customerObservation,
    approximatePublicSize: Object.freeze({
      key: intake.approximatePublicSize,
      label: SIZE_LABELS[intake.approximatePublicSize]
    }),
    complexity: Object.freeze(
      intake.complexityFlags.map((key) =>
        Object.freeze({ key, label: COMPLEXITY_LABELS[key] })
      )
    ),
    importantDate: intake.importantDate
  });
}

function heldAction(eligible, reason) {
  const selected = eligible ? HELD_REASON : reason;
  return Object.freeze({
    available: false,
    reason: selected.code,
    message: selected.message
  });
}

function actionsProjection(profile, serviceCase) {
  const state = serviceCase?.state ?? "not_started";
  const canSaveWebsite =
    state === "not_started" ||
    state === "draft" ||
    state === "withdrawn";
  const canSubmitRequest =
    state === "draft" && profile?.observedHostname !== null;
  const canWithdrawRequest =
    state === "draft" || state === "submitted";

  const stateReason =
    state === "submitted"
      ? Object.freeze({
          code: "assessment_request_already_submitted",
          message: "The current assessment request is already submitted."
        })
      : state === "withdrawn"
        ? Object.freeze({
            code: "assessment_request_withdrawn",
            message: "The current assessment request was withdrawn."
          })
        : Object.freeze({
            code: "assessment_draft_required",
            message: "Save a website assessment draft first."
          });

  return Object.freeze({
    saveWebsite: heldAction(
      canSaveWebsite,
      Object.freeze({
        code: "submitted_request_locks_website",
        message: "Withdraw the submitted request before changing this website."
      })
    ),
    submitAssessmentRequest: heldAction(
      canSubmitRequest,
      stateReason
    ),
    withdrawAssessmentRequest: heldAction(
      canWithdrawRequest,
      state === "withdrawn"
        ? stateReason
        : Object.freeze({
            code: "assessment_request_not_submitted",
            message: "There is no current assessment request to withdraw."
          })
    )
  });
}

/**
 * Maps one exact migration-34 read snapshot into a customer-safe response.
 *
 * The source bindings are validation-only. They are deliberately absent from
 * the result, as are every later commercial, provider, operator, and document
 * authority. Migration 34 remains capability-held even when a state is
 * otherwise eligible for a customer write.
 */
export function projectCustomServicesAccount(value) {
  exactKeys(
    value,
    ["scope", "snapshot"],
    "customServicesAccountInput",
    { code: "invalid_input", status: 400 }
  );
  const scope = exactScope(value.scope);
  const stored = exactSnapshot(value.snapshot, scope);
  const assessmentState = stored.serviceCase?.state ?? "not_started";

  return deepFreeze({
    schema: CUSTOM_SERVICES_ACCOUNT_SCHEMA,
    account: {
      displayName: stored.account.displayName,
      email: stored.account.email,
      organizationDisplayName:
        stored.account.organizationDisplayName,
      state: "active"
    },
    website: websiteProjection(stored.profile, stored.intake),
    assessment: {
      state: assessmentState,
      title: stored.serviceCase?.title ?? null,
      submittedAt: stored.intake?.submittedAt ?? null,
      withdrawnAt: stored.serviceCase?.withdrawnAt ?? null,
      facts: assessmentFacts(stored.intake)
    },
    capabilities: {
      customerRequestWrites: {
        available: false,
        state: "held",
        reason: HELD_REASON.code,
        message: HELD_REASON.message
      }
    },
    actions: actionsProjection(stored.profile, stored.serviceCase)
  });
}
