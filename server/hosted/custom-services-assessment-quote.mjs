import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";

export const CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA =
  "sitesourcery.custom-services-assessment-quote/v1";
export const CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA =
  "sitesourcery.custom-services-assessment-quote-snapshot/v1";

const ASSESSMENT_POLICY_ID =
  "00000000-0000-4000-8000-000000001411";
const LEGAL_DOCUMENT_ID =
  "00000000-0000-4000-8000-000000001410";
const COMMERCIAL_CONTRACT_ID =
  "SS-CUSTOM-SERVICES-2026-08-19.2";
const COMMERCIAL_CONTRACT_DIGEST =
  "0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d";
const ACCEPTANCE_STATEMENT =
  "accepted_exact_quote_and_delivery_date";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_HUNDRED_SIXTY_FIVE_DAYS_MS =
  365 * 24 * 60 * 60 * 1000;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^[a-f0-9]{64}$/u;
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
const PAGE_TARGET =
  /^page:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u;
const PAGE_TYPE_TARGET = /^type:[a-z][a-z0-9_]{1,79}$/u;
const PATH_TRAVERSAL = /(?:^|\/)[.][.]?(?:\/|$)/u;

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

function safeCustomerText(value, field, maximum) {
  const selected = requiredText(value, field, maximum);
  invariant(
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

function exactUuid(
  value,
  field,
  { code = "repository_conflict", status = 500 } = {}
) {
  const selected = requiredText(value, field, 36, { code, status });
  invariant(UUID.test(selected), code, `${field} is invalid`, { status });
  return selected;
}

function exactDigest(value, field) {
  const selected = requiredText(value, field, 64);
  invariant(
    DIGEST.test(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
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

function exactDate(value, field) {
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
    "the customer assessment quote is unavailable",
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
  const customerId = exactUuid(value.customerId, `${field}.customerId`);
  invariant(
    organizationId === scope.organizationId &&
      projectId === scope.projectId &&
      customerId === scope.customerId,
    "project_unavailable",
    "the customer assessment quote is unavailable",
    { status: 404 }
  );
  return Object.freeze({ organizationId, projectId, customerId });
}

function exactHiddenBinding(actual, expected, field) {
  invariant(
    actual === expected,
    "project_unavailable",
    "the customer assessment quote is unavailable",
    { status: 404, details: null }
  );
  return actual;
}

function exactCurrentProfile(value, scope) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "customerId",
      "organizationId",
      "projectId",
      "revision",
      "verifiedCurrent"
    ],
    "snapshot.currentProfile"
  );
  exactBinding(value, scope, "snapshot.currentProfile");
  invariant(
    value.verifiedCurrent === true,
    "repository_conflict",
    "the current customer website profile is stale",
    { status: 500 }
  );
  return Object.freeze({
    revision: positiveInteger(
      value.revision,
      "snapshot.currentProfile.revision"
    )
  });
}

function exactCurrentIntake(value, scope) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "caseId",
      "customerId",
      "factsDigest",
      "intakeId",
      "organizationId",
      "projectId",
      "revision",
      "state",
      "verifiedLatest"
    ],
    "snapshot.currentIntake"
  );
  exactBinding(value, scope, "snapshot.currentIntake");
  const state = requiredText(
    value.state,
    "snapshot.currentIntake.state",
    20
  );
  invariant(
    state === "submitted" && value.verifiedLatest === true,
    "repository_conflict",
    "the current customer assessment intake is stale",
    { status: 500 }
  );
  return Object.freeze({
    caseId: exactUuid(value.caseId, "snapshot.currentIntake.caseId"),
    intakeId: exactUuid(
      value.intakeId,
      "snapshot.currentIntake.intakeId"
    ),
    revision: positiveInteger(
      value.revision,
      "snapshot.currentIntake.revision"
    ),
    factsDigest: exactDigest(
      value.factsDigest,
      "snapshot.currentIntake.factsDigest"
    )
  });
}

function exactReviewTargets(value) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 5,
    "repository_conflict",
    "snapshot.quote.revision.reviewTargets is invalid",
    { status: 500 }
  );
  const canonical = value.map((target, index) => {
    const selected = safeCustomerText(
      target,
      `snapshot.quote.revision.reviewTargets[${index}]`,
      160
    );
    invariant(
      (PAGE_TARGET.test(selected) || PAGE_TYPE_TARGET.test(selected)) &&
        !PATH_TRAVERSAL.test(selected),
      "repository_conflict",
      `snapshot.quote.revision.reviewTargets[${index}] is invalid`,
      { status: 500 }
    );
    return selected;
  });
  invariant(
    JSON.stringify(canonical) ===
      JSON.stringify([...new Set(canonical)].sort()),
    "repository_conflict",
    "snapshot.quote.revision.reviewTargets is not canonical",
    { status: 500 }
  );
  return Object.freeze(
    canonical.map((target) =>
      Object.freeze({
        kind: target.startsWith("page:") ? "page" : "page_type",
        value: target.slice(5)
      })
    )
  );
}

function exactQuoteRevision(
  value,
  scope,
  quoteBinding,
  observedAt
) {
  exactKeys(
    value,
    [
      "caseId",
      "commercialContractDigest",
      "commercialContractId",
      "createdAt",
      "creditAmountMinor",
      "currency",
      "customerId",
      "deliveryDate",
      "desktopReviewIncluded",
      "disclosureDigest",
      "expandedAssessmentState",
      "expiresAt",
      "intakeFactsDigest",
      "intakeId",
      "intakeRevision",
      "issuedAt",
      "legalDocumentId",
      "maximumFindings",
      "maximumRepresentativePagesOrTypes",
      "maximumWebsites",
      "offeringId",
      "organizationId",
      "paymentSchedule",
      "phoneReviewIncluded",
      "policyId",
      "policyScopeBoundaryDigest",
      "projectId",
      "projectProfileRevision",
      "providerDirectAmountMinor",
      "quoteDigest",
      "quoteId",
      "quoteRevision",
      "recomputedDisclosureDigest",
      "recomputedQuoteDigest",
      "revisionId",
      "reviewTargets",
      "scopeBoundaryDigest",
      "serviceAmountMinor",
      "subtotalMinor",
      "taxState"
    ],
    "snapshot.quote.revision"
  );
  exactBinding(value, scope, "snapshot.quote.revision");
  const caseId = exactUuid(
    value.caseId,
    "snapshot.quote.revision.caseId"
  );
  const offeringId = exactUuid(
    value.offeringId,
    "snapshot.quote.revision.offeringId"
  );
  const quoteId = exactUuid(
    value.quoteId,
    "snapshot.quote.revision.quoteId"
  );
  exactHiddenBinding(
    caseId,
    quoteBinding.caseId,
    "snapshot.quote.revision.caseId"
  );
  exactHiddenBinding(
    offeringId,
    quoteBinding.offeringId,
    "snapshot.quote.revision.offeringId"
  );
  exactHiddenBinding(
    quoteId,
    quoteBinding.quoteId,
    "snapshot.quote.revision.quoteId"
  );

  const quoteRevision = positiveInteger(
    value.quoteRevision,
    "snapshot.quote.revision.quoteRevision"
  );
  invariant(
    quoteRevision === quoteBinding.currentRevision,
    "repository_conflict",
    "the assessment quote current revision changed",
    { status: 500 }
  );

  const revisionId = exactUuid(
    value.revisionId,
    "snapshot.quote.revision.revisionId"
  );
  const intakeId = exactUuid(
    value.intakeId,
    "snapshot.quote.revision.intakeId"
  );
  const projectProfileRevision = positiveInteger(
    value.projectProfileRevision,
    "snapshot.quote.revision.projectProfileRevision"
  );
  const intakeRevision = positiveInteger(
    value.intakeRevision,
    "snapshot.quote.revision.intakeRevision"
  );
  const intakeFactsDigest = exactDigest(
    value.intakeFactsDigest,
    "snapshot.quote.revision.intakeFactsDigest"
  );
  const scopeBoundaryDigest = exactDigest(
    value.scopeBoundaryDigest,
    "snapshot.quote.revision.scopeBoundaryDigest"
  );
  const policyScopeBoundaryDigest = exactDigest(
    value.policyScopeBoundaryDigest,
    "snapshot.quote.revision.policyScopeBoundaryDigest"
  );
  const quoteDigest = exactDigest(
    value.quoteDigest,
    "snapshot.quote.revision.quoteDigest"
  );
  const disclosureDigest = exactDigest(
    value.disclosureDigest,
    "snapshot.quote.revision.disclosureDigest"
  );
  const recomputedQuoteDigest = exactDigest(
    value.recomputedQuoteDigest,
    "snapshot.quote.revision.recomputedQuoteDigest"
  );
  const recomputedDisclosureDigest = exactDigest(
    value.recomputedDisclosureDigest,
    "snapshot.quote.revision.recomputedDisclosureDigest"
  );
  invariant(
    scopeBoundaryDigest === policyScopeBoundaryDigest &&
      quoteDigest === recomputedQuoteDigest &&
      disclosureDigest === recomputedDisclosureDigest &&
      quoteDigest !== disclosureDigest,
    "repository_conflict",
    "the assessment quote digests changed",
    { status: 500 }
  );

  const policyId = exactUuid(
    value.policyId,
    "snapshot.quote.revision.policyId"
  );
  const legalDocumentId = exactUuid(
    value.legalDocumentId,
    "snapshot.quote.revision.legalDocumentId"
  );
  const commercialContractId = requiredText(
    value.commercialContractId,
    "snapshot.quote.revision.commercialContractId",
    120
  );
  const commercialContractDigest = exactDigest(
    value.commercialContractDigest,
    "snapshot.quote.revision.commercialContractDigest"
  );
  invariant(
    policyId === ASSESSMENT_POLICY_ID &&
      legalDocumentId === LEGAL_DOCUMENT_ID &&
      commercialContractId === COMMERCIAL_CONTRACT_ID &&
      commercialContractDigest === COMMERCIAL_CONTRACT_DIGEST,
    "repository_conflict",
    "the assessment quote policy changed",
    { status: 500 }
  );

  invariant(
    value.serviceAmountMinor === 35000 &&
      value.providerDirectAmountMinor === 0 &&
      value.creditAmountMinor === 0 &&
      value.subtotalMinor === 35000 &&
      value.currency === "USD" &&
      value.taxState === "disabled_by_owner" &&
      value.paymentSchedule === "full_before_work",
    "repository_conflict",
    "the assessment quote money changed",
    { status: 500 }
  );
  invariant(
    value.maximumWebsites === 1 &&
      value.maximumRepresentativePagesOrTypes === 5 &&
      value.maximumFindings === 10 &&
      value.desktopReviewIncluded === true &&
      value.phoneReviewIncluded === true &&
      value.expandedAssessmentState === "separately_quoted",
    "repository_conflict",
    "the assessment quote scope changed",
    { status: 500 }
  );
  const reviewTargets = exactReviewTargets(value.reviewTargets);

  const issuedAt = exactIso(
    value.issuedAt,
    "snapshot.quote.revision.issuedAt"
  );
  const expiresAt = exactIso(
    value.expiresAt,
    "snapshot.quote.revision.expiresAt"
  );
  const createdAt = exactIso(
    value.createdAt,
    "snapshot.quote.revision.createdAt"
  );
  const deliveryDate = exactDate(
    value.deliveryDate,
    "snapshot.quote.revision.deliveryDate"
  );
  const issuedTime = Date.parse(issuedAt);
  const expiresTime = Date.parse(expiresAt);
  const deliveryTime = Date.parse(`${deliveryDate}T00:00:00.000Z`);
  const issuedDateTime = Date.parse(
    `${issuedAt.slice(0, 10)}T00:00:00.000Z`
  );
  invariant(
    createdAt === issuedAt &&
      issuedTime <= Date.parse(observedAt) &&
      expiresTime > issuedTime &&
      expiresTime - issuedTime <= THIRTY_DAYS_MS &&
      deliveryTime > issuedDateTime &&
      deliveryTime - issuedDateTime <=
        THREE_HUNDRED_SIXTY_FIVE_DAYS_MS,
    "repository_conflict",
    "the assessment quote chronology changed",
    { status: 500 }
  );

  return Object.freeze({
    revisionId,
    quoteRevision,
    intakeId,
    projectProfileRevision,
    intakeRevision,
    intakeFactsDigest,
    scopeBoundaryDigest,
    reviewTargets,
    deliveryDate,
    issuedAt,
    expiresAt,
    quoteDigest,
    disclosureDigest,
    legalDocumentId
  });
}

function exactAcceptance(
  value,
  scope,
  quoteBinding,
  revision,
  quoteUpdatedAt,
  observedAt
) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "acceptanceStatement",
      "acceptedAt",
      "acceptedByCustomerId",
      "acceptedDisclosureDigest",
      "acceptedQuoteDigest",
      "caseId",
      "customerId",
      "legalDocumentId",
      "organizationId",
      "projectId",
      "quoteId",
      "quoteRevision",
      "revisionId",
      "source"
    ],
    "snapshot.quote.acceptance"
  );
  exactBinding(value, scope, "snapshot.quote.acceptance");
  exactHiddenBinding(
    exactUuid(value.caseId, "snapshot.quote.acceptance.caseId"),
    quoteBinding.caseId,
    "snapshot.quote.acceptance.caseId"
  );
  exactHiddenBinding(
    exactUuid(value.quoteId, "snapshot.quote.acceptance.quoteId"),
    quoteBinding.quoteId,
    "snapshot.quote.acceptance.quoteId"
  );
  exactHiddenBinding(
    exactUuid(
      value.acceptedByCustomerId,
      "snapshot.quote.acceptance.acceptedByCustomerId"
    ),
    scope.customerId,
    "snapshot.quote.acceptance.acceptedByCustomerId"
  );
  exactHiddenBinding(
    exactUuid(value.revisionId, "snapshot.quote.acceptance.revisionId"),
    revision.revisionId,
    "snapshot.quote.acceptance.revisionId"
  );
  invariant(
    value.quoteRevision === revision.quoteRevision,
    "repository_conflict",
    "the accepted assessment quote revision changed",
    { status: 500 }
  );
  invariant(
    value.source === "account" &&
      value.acceptanceStatement === ACCEPTANCE_STATEMENT,
    "repository_conflict",
    "the assessment quote acceptance changed",
    { status: 500 }
  );
  const acceptedQuoteDigest = exactDigest(
    value.acceptedQuoteDigest,
    "snapshot.quote.acceptance.acceptedQuoteDigest"
  );
  const acceptedDisclosureDigest = exactDigest(
    value.acceptedDisclosureDigest,
    "snapshot.quote.acceptance.acceptedDisclosureDigest"
  );
  const legalDocumentId = exactUuid(
    value.legalDocumentId,
    "snapshot.quote.acceptance.legalDocumentId"
  );
  invariant(
    acceptedQuoteDigest === revision.quoteDigest &&
      acceptedDisclosureDigest === revision.disclosureDigest &&
      legalDocumentId === revision.legalDocumentId,
    "repository_conflict",
    "the accepted assessment quote digests changed",
    { status: 500 }
  );
  const acceptedAt = exactIso(
    value.acceptedAt,
    "snapshot.quote.acceptance.acceptedAt"
  );
  invariant(
    Date.parse(acceptedAt) >= Date.parse(revision.issuedAt) &&
      Date.parse(acceptedAt) >= Date.parse(quoteUpdatedAt) &&
      Date.parse(acceptedAt) < Date.parse(revision.expiresAt) &&
      Date.parse(acceptedAt) <= Date.parse(observedAt),
    "repository_conflict",
    "the assessment quote acceptance chronology changed",
    { status: 500 }
  );
  return Object.freeze({ acceptedAt });
}

function exactQuote(
  value,
  scope,
  currentProfile,
  currentIntake,
  observedAt
) {
  if (value === null) return null;
  exactKeys(
    value,
    [
      "acceptance",
      "caseId",
      "createdAt",
      "currentRevision",
      "customerId",
      "offeringId",
      "organizationId",
      "projectId",
      "purpose",
      "quoteId",
      "revision",
      "updatedAt"
    ],
    "snapshot.quote"
  );
  exactBinding(value, scope, "snapshot.quote");
  const caseId = exactUuid(value.caseId, "snapshot.quote.caseId");
  const offeringId = exactUuid(
    value.offeringId,
    "snapshot.quote.offeringId"
  );
  const quoteId = exactUuid(value.quoteId, "snapshot.quote.quoteId");
  const currentRevision = positiveInteger(
    value.currentRevision,
    "snapshot.quote.currentRevision"
  );
  invariant(
    value.purpose === "assessment",
    "repository_conflict",
    "the customer assessment quote purpose changed",
    { status: 500 }
  );
  invariant(
    currentProfile !== null && currentIntake !== null,
    "repository_conflict",
    "the assessment quote lacks current customer facts",
    { status: 500 }
  );
  exactHiddenBinding(
    currentIntake.caseId,
    caseId,
    "snapshot.currentIntake.caseId"
  );

  const quoteBinding = Object.freeze({
    caseId,
    offeringId,
    quoteId,
    currentRevision
  });
  const revision = exactQuoteRevision(
    value.revision,
    scope,
    quoteBinding,
    observedAt
  );
  const createdAt = exactIso(value.createdAt, "snapshot.quote.createdAt");
  const updatedAt = exactIso(value.updatedAt, "snapshot.quote.updatedAt");
  invariant(
    Date.parse(createdAt) <= Date.parse(revision.issuedAt) &&
      Date.parse(revision.issuedAt) <= Date.parse(updatedAt) &&
      Date.parse(updatedAt) <= Date.parse(observedAt),
    "repository_conflict",
    "the assessment quote chronology changed",
    { status: 500 }
  );

  invariant(
    currentProfile.revision >= revision.projectProfileRevision &&
      currentIntake.revision >= revision.intakeRevision,
    "repository_conflict",
    "the assessment quote is bound to future customer facts",
    { status: 500 }
  );
  if (currentIntake.revision === revision.intakeRevision) {
    invariant(
      currentIntake.intakeId === revision.intakeId &&
        currentIntake.factsDigest === revision.intakeFactsDigest,
      "repository_conflict",
      "the current assessment intake binding changed",
      { status: 500 }
    );
  } else {
    invariant(
      currentIntake.intakeId !== revision.intakeId,
      "repository_conflict",
      "the current assessment intake revision is stale",
      { status: 500 }
    );
  }

  const acceptance = exactAcceptance(
    value.acceptance,
    scope,
    quoteBinding,
    revision,
    updatedAt,
    observedAt
  );
  return Object.freeze({
    quoteId,
    revision,
    acceptance,
    customerFactsChanged:
      currentProfile.revision > revision.projectProfileRevision ||
      currentIntake.revision > revision.intakeRevision
  });
}

function exactSnapshot(value, scope) {
  exactKeys(
    value,
    ["currentIntake", "currentProfile", "observedAt", "quote", "schema"],
    "snapshot"
  );
  invariant(
    value.schema === CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
    "repository_conflict",
    "the assessment quote snapshot contract changed",
    { status: 500 }
  );
  const observedAt = exactIso(value.observedAt, "snapshot.observedAt");
  const currentProfile = exactCurrentProfile(value.currentProfile, scope);
  const currentIntake = exactCurrentIntake(value.currentIntake, scope);
  invariant(
    currentIntake === null || currentProfile !== null,
    "repository_conflict",
    "the current assessment intake lacks its website profile",
    { status: 500 }
  );
  const quote = exactQuote(
    value.quote,
    scope,
    currentProfile,
    currentIntake,
    observedAt
  );
  return Object.freeze({ observedAt, quote });
}

function quoteState(stored) {
  if (stored.quote === null) return "not_available";
  if (stored.quote.acceptance !== null) return "accepted";
  if (stored.quote.customerFactsChanged) return "changes_required";
  if (
    Date.parse(stored.quote.revision.expiresAt) <=
    Date.parse(stored.observedAt)
  ) {
    return "expired";
  }
  return "review_required";
}

function acceptAction(state) {
  if (state === "review_required") {
    return Object.freeze({
      available: true,
      reason: null,
      message: "Accept this exact quote and its delivery date.",
      acceptanceStatement: ACCEPTANCE_STATEMENT
    });
  }
  const unavailable = {
    not_available: Object.freeze({
      reason: "quote_not_available",
      message: "There is no assessment quote to accept yet."
    }),
    expired: Object.freeze({
      reason: "quote_expired",
      message: "This assessment quote has expired. Ask for a current quote."
    }),
    changes_required: Object.freeze({
      reason: "customer_facts_changed",
      message:
        "Your current website details changed. Ask for a revised quote."
    }),
    accepted: Object.freeze({
      reason: "quote_already_accepted",
      message: "This exact assessment quote is already accepted."
    })
  };
  return Object.freeze({
    available: false,
    reason: unavailable[state].reason,
    message: unavailable[state].message,
    acceptanceStatement: null
  });
}

function quoteProjection(storedQuote) {
  if (storedQuote === null) return null;
  const revision = storedQuote.revision;
  return Object.freeze({
    quoteId: storedQuote.quoteId,
    revision: revision.quoteRevision,
    quoteDigest: revision.quoteDigest,
    disclosureDigest: revision.disclosureDigest,
    servicePrice: Object.freeze({
      amountMinor: 35000,
      currency: "USD",
      formatted: "$350.00"
    }),
    tax: Object.freeze({
      state: "disabled_by_owner",
      message:
        "Prices exclude tax. Tax calculation and collection remain disabled by the owner; this quote is not a payable total."
    }),
    payment: Object.freeze({
      schedule: "full_before_work",
      invoice: "later_separate_invoice",
      message:
        "After acceptance, Site Sourcery will issue a separate invoice. That invoice must be paid in full before work begins."
    }),
    scope: Object.freeze({
      service: "Website assessment",
      maximumWebsites: 1,
      reviewTargets: revision.reviewTargets,
      includedViewports: Object.freeze(["desktop", "phone"]),
      maximumFindings: 10,
      expandedAssessment: Object.freeze({
        state: "separately_quoted",
        message: "A larger assessment requires a separate quote."
      })
    }),
    dates: Object.freeze({
      issuedAt: revision.issuedAt,
      expiresAt: revision.expiresAt,
      deliveryDate: revision.deliveryDate
    }),
    acceptedAt: storedQuote.acceptance?.acceptedAt ?? null
  });
}

/**
 * Projects one exact migration-35 repository snapshot into customer-safe quote
 * state. Hidden row bindings are validation-only and never enter the result.
 */
export function projectCustomServicesAssessmentQuote(value) {
  exactKeys(
    value,
    ["scope", "snapshot"],
    "customServicesAssessmentQuoteInput",
    { code: "invalid_input", status: 400 }
  );
  const scope = exactScope(value.scope);
  const stored = exactSnapshot(value.snapshot, scope);
  const state = quoteState(stored);

  return deepFreeze({
    schema: CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA,
    state,
    quote: quoteProjection(stored.quote),
    actions: {
      acceptQuote: acceptAction(state)
    }
  });
}
