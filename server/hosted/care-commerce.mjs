import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  CARE_COMMERCE_PRICE_VERSION,
  CARE_COMMERCIAL_CONTRACT_DIGEST,
  CARE_COMMERCE_CATALOG_VERSION,
  CARE_CORE_CATALOG_VERSION,
  getHeldCareCommerceCatalog,
  priceHeldCareSelection,
  resolveHeldCareOffer
} from "./care-commerce-catalog.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const CARE_COMMERCE_ELIGIBILITY_SCHEMA =
  "sitesourcery.care-commerce-eligibility/v1";
export const CARE_COMMERCE_QUOTE_SCHEMA =
  "sitesourcery.care-commerce-quote/v1";
export const CARE_COMMERCE_RESERVATION_SCHEMA =
  "sitesourcery.care-commerce-invoice-reservation/v1";
export const CARE_COMMERCE_PROJECTION_SCHEMA =
  "sitesourcery.care-commerce-projection/v1";
export const CARE_COMMERCE_MAIL_RESERVATION_SCHEMA =
  "sitesourcery.care-commerce-mail-reservation/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const QUOTE_TTL_MS = 30 * 60 * 1000;
const MAX_MAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAIL_TEMPLATES = new Set([
  "care-commerce-quote-held.v1",
  "care-commerce-reservation-held.v1",
  "care-commerce-reservation-cancelled.v1"
]);

function clone(value) {
  return structuredClone(value);
}

function exactObject(value, keys, field, { status = 400 } = {}) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    status === 400
      ? "CARE_COMMERCE_INVALID"
      : "CARE_COMMERCE_AUTHORITY_DRIFT",
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function uuid(value, field, { status = 400 } = {}) {
  invariant(
    typeof value === "string" && UUID.test(value),
    status === 400
      ? "CARE_COMMERCE_INVALID"
      : "CARE_COMMERCE_AUTHORITY_DRIFT",
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function sha256(value, field, { status = 400 } = {}) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    status === 400
      ? "CARE_COMMERCE_INVALID"
      : "CARE_COMMERCE_AUTHORITY_DRIFT",
    `${field} must be an opaque lowercase SHA-256 digest.`,
    { status }
  );
  return value;
}

function safeId(value, field) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "CARE_COMMERCE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field, { status = 400 } = {}) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    status === 400
      ? "CARE_COMMERCE_INVALID"
      : "CARE_COMMERCE_AUTHORITY_DRIFT",
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function calendarDate(value, field, { status = 400 } = {}) {
  invariant(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
    status === 400
      ? "CARE_COMMERCE_INVALID"
      : "CARE_COMMERCE_AUTHORITY_DRIFT",
    `${field} is invalid.`,
    { status }
  );
  return value;
}

function clockNow(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  return instant(
    selected instanceof Date ? selected.toISOString() : selected,
    "Care commerce clock",
    { status: 500 }
  );
}

function actor(authenticated) {
  exactObject(
    authenticated,
    ["organizationId", "userId"],
    "Authenticated Care actor"
  );
  return deepFreeze({
    actorId: uuid(authenticated.userId, "Authenticated user ID"),
    sessionOrganizationId: uuid(
      authenticated.organizationId,
      "Authenticated organization ID"
    )
  });
}

function scope(value, { operator = false } = {}) {
  return deepFreeze({
    organizationId: operator
      ? uuid(value.organizationId, "Care organization ID")
      : null,
    projectId: uuid(value.projectId, "Care project ID"),
    contractId: uuid(value.contractId, "Care contract ID"),
    periodId: uuid(value.periodId, "Care period ID")
  });
}

function exactEligibility(value, expected) {
  exactObject(
    value,
    [
      "acceptanceDigest", "actorId", "audience", "catalogIdentityId",
      "catalogVersion", "commercialAuthorityState", "contractAuthorityState",
      "contractId", "contractKind", "customerEffects", "customerId",
      "eligibilityDigest", "endsOn", "organizationId", "paymentEffects",
      "periodId", "periodRevision", "periodState", "projectId",
      "projectLifecycle", "providerEffects", "providerScopeDigest",
      "scopeDigest", "schema", "serviceKey", "startsOn"
    ],
    "Care commerce eligibility",
    { status: 503 }
  );
  const withoutDigest = clone(value);
  delete withoutDigest.eligibilityDigest;
  invariant(
    value.schema === CARE_COMMERCE_ELIGIBILITY_SCHEMA &&
      value.audience === expected.audience &&
      value.actorId === expected.actorId &&
      value.organizationId === expected.organizationId &&
      value.projectId === expected.projectId &&
      value.contractId === expected.contractId &&
      value.periodId === expected.periodId &&
      UUID.test(value.customerId) &&
      UUID.test(value.catalogIdentityId) &&
      value.catalogVersion === CARE_CORE_CATALOG_VERSION &&
      ["exact_held", "owner_redline_required"].includes(
        value.commercialAuthorityState
      ) &&
      ["rescue", "custom_care", "outside_management", "alakazam_care"]
        .includes(value.contractKind) &&
      typeof value.serviceKey === "string" &&
      /^[a-z][a-z0-9_]{2,79}$/u.test(value.serviceKey) &&
      value.projectLifecycle === "active" &&
      value.contractAuthorityState === "held" &&
      value.periodState === "open" &&
      Number.isSafeInteger(value.periodRevision) &&
      value.periodRevision >= 1 &&
      value.customerEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false &&
      (value.audience !== "customer" || value.actorId === value.customerId) &&
      SHA256.test(value.acceptanceDigest) &&
      SHA256.test(value.scopeDigest) &&
      SHA256.test(value.providerScopeDigest) &&
      Date.parse(`${calendarDate(
        value.endsOn,
        "Care period end",
        { status: 503 }
      )}T00:00:00.000Z`) >
        Date.parse(`${calendarDate(
          value.startsOn,
          "Care period start",
          { status: 503 }
        )}T00:00:00.000Z`) &&
      value.eligibilityDigest === digest(withoutDigest),
    "CARE_COMMERCE_AUTHORITY_DRIFT",
    "Care commercial eligibility changed or is not held.",
    { status: 503 }
  );
  return deepFreeze(clone(value));
}

function validatePorts({ eligibility, repository, ids, clock, mailReservations }) {
  for (const [name, value, methods] of [
    ["eligibility", eligibility, ["readiness", "resolve"]],
    [
      "repository",
      repository,
      [
        "readiness", "claimCommand", "abandonCommand", "commitQuoteCommand",
        "findQuote", "commitReservationCommand", "findReservation",
        "commitReservationTransition"
      ]
    ],
    ["ids", ids, ["next"]]
  ]) {
    invariant(
      value && methods.every((method) => typeof value[method] === "function"),
      "CARE_COMMERCE_CONFIGURATION_REQUIRED",
      `${name} port is incomplete.`,
      { status: 500 }
    );
  }
  invariant(
    clock && typeof clock.now === "function" &&
      mailReservations &&
      typeof mailReservations.readiness === "function" &&
      typeof mailReservations.reserve === "function" &&
      mailReservations.deliveryEffects === false &&
      mailReservations.providerEffects === false,
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "The held Care clock or mail reservation port is incomplete.",
    { status: 500 }
  );
  return { eligibility, repository, ids, clock, mailReservations };
}

function command({
  actorId, organizationId, projectId, customerId, contractId, periodId,
  commandId, operation, purpose
}) {
  return deepFreeze({
    actorId,
    organizationId,
    projectId,
    customerId,
    contractId,
    periodId,
    commandId: safeId(commandId, "Care commerce idempotency key"),
    operation,
    fingerprint: digest(purpose)
  });
}

async function idempotent(repository, selected, commit, work) {
  const claim = await repository.claimCommand(selected);
  invariant(
    claim?.status !== "conflict",
    "CARE_COMMERCE_IDEMPOTENCY_CONFLICT",
    "The Care commerce command ID was already used differently.",
    {
      status: 409,
      details: {
        drift: Array.isArray(claim?.drift) ? [...claim.drift] : []
      }
    }
  );
  invariant(
    claim?.status !== "pending",
    "CARE_COMMERCE_COMMAND_IN_PROGRESS",
    "The Care commerce command outcome is still pending.",
    { status: 409 }
  );
  if (claim?.status === "replay") return deepFreeze(clone(claim.result));
  invariant(
    claim?.status === "claimed",
    "CARE_COMMERCE_REPOSITORY_CONFLICT",
    "The Care commerce repository returned an invalid claim state.",
    { status: 500 }
  );
  try {
    const result = await work();
    await commit(selected, result);
    return deepFreeze(clone(result));
  } catch (error) {
    await repository.abandonCommand(selected);
    throw error;
  }
}

function taxEvidence(quoteIdentity) {
  const selected = {
    schema: "sitesourcery.care-commerce-tax-evidence/v1",
    state: "held",
    taxMode: null,
    taxMinor: null,
    totalMinor: null,
    authority: "care_tax_purpose_not_released",
    authoritative: false,
    quoteIdentity
  };
  return deepFreeze({ ...selected, evidenceDigest: digest(selected) });
}

function recordDigest(record, digestField) {
  const selected = clone(record);
  delete selected[digestField];
  return digest(selected);
}

function validateQuote(quote, expected, now, acceptedDigest) {
  invariant(
    quote &&
      quote.schema === CARE_COMMERCE_QUOTE_SCHEMA &&
      quote.organizationId === expected.organizationId &&
      quote.projectId === expected.projectId &&
      quote.contractId === expected.contractId &&
      quote.periodId === expected.periodId &&
      quote.state === "held" &&
      quote.payable === false &&
      quote.dispatchAuthorized === false &&
      quote.customerEffects === false &&
      quote.paymentEffects === false &&
      quote.providerEffects === false &&
      quote.quoteDigest === acceptedDigest &&
      quote.quoteDigest === recordDigest(quote, "quoteDigest") &&
      Date.parse(quote.expiresAt) > Date.parse(now),
    "CARE_COMMERCE_QUOTE_UNAVAILABLE",
    "The held Care quote is unavailable, changed, or expired.",
    { status: 409 }
  );
  return quote;
}

function validateReservation(value, expected) {
  const stateEvidenceMatches =
    (value?.state === "held" &&
      value.revision === 1 &&
      value.holdReason === "care_commercial_and_tax_release_required" &&
      value.providerEffectCertainty === "not_submitted" &&
      value.cancellationEvidenceDigest === null &&
      value.ambiguityEvidenceDigest === null) ||
    (value?.state === "cancelled" &&
      value.revision === 2 &&
      value.holdReason === "cancelled_before_provider_submission" &&
      value.providerEffectCertainty === "not_submitted" &&
      SHA256.test(value.cancellationEvidenceDigest) &&
      value.ambiguityEvidenceDigest === null) ||
    (value?.state === "ambiguity_review_required" &&
      value.revision === 2 &&
      value.holdReason === "manual_provider_reconciliation_required" &&
      value.providerEffectCertainty === "ambiguous" &&
      value.cancellationEvidenceDigest === null &&
      SHA256.test(value.ambiguityEvidenceDigest));
  invariant(
    value &&
      value.schema === CARE_COMMERCE_RESERVATION_SCHEMA &&
      value.organizationId === expected.organizationId &&
      value.projectId === expected.projectId &&
      value.contractId === expected.contractId &&
      value.periodId === expected.periodId &&
      UUID.test(value.reservationId) &&
      UUID.test(value.quoteId) &&
      UUID.test(value.customerId) &&
      typeof value.serviceKey === "string" &&
      /^[a-z][a-z0-9_]{2,79}$/u.test(value.serviceKey) &&
      SHA256.test(value.quoteDigest) &&
      SHA256.test(value.eligibilityDigest) &&
      SHA256.test(value.taxEvidenceDigest) &&
      Number.isSafeInteger(value.subtotalMinor) && value.subtotalMinor > 0 &&
      value.currency === "USD" &&
      value.reservationKind === "professional_invoice" &&
      value.intendedProvider === "stripe" &&
      value.providerRequest === null &&
      value.taxMode === null &&
      value.taxMinor === null &&
      value.totalMinor === null &&
      stateEvidenceMatches &&
      value.dispatchAuthorized === false &&
      value.customerEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false &&
      Number.isFinite(Date.parse(value.reservedAt)) &&
      Number.isFinite(Date.parse(value.updatedAt)) &&
      new Date(value.reservedAt).toISOString() === value.reservedAt &&
      new Date(value.updatedAt).toISOString() === value.updatedAt &&
      Date.parse(value.updatedAt) >= Date.parse(value.reservedAt) &&
      value.reservationDigest === recordDigest(value, "reservationDigest"),
    "CARE_COMMERCE_RESERVATION_UNAVAILABLE",
    "The held Care invoice reservation is unavailable or changed.",
    { status: 409 }
  );
  return value;
}

export function projectCareCommerceRecord(record, audience) {
  invariant(
    record && ["customer", "operator"].includes(audience) &&
      [CARE_COMMERCE_QUOTE_SCHEMA, CARE_COMMERCE_RESERVATION_SCHEMA]
        .includes(record.schema),
    "CARE_COMMERCE_PROJECTION_INVALID",
    "The Care commerce projection is invalid.",
    { status: 500 }
  );
  const selected = clone(record);
  delete selected.actorId;
  if (audience === "customer") delete selected.customerId;
  return deepFreeze({
    schema: CARE_COMMERCE_PROJECTION_SCHEMA,
    audience,
    commercialRelease: "held",
    record: selected,
    projectionDigest: digest({ audience, record: selected })
  });
}

export function createCareCommerceMailReservationInterface({ lifecycle, clock } = {}) {
  invariant(
    lifecycle &&
      typeof lifecycle.readiness === "function" &&
      typeof lifecycle.reserve === "function" &&
      lifecycle.providerEffects === false,
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "A durable provider-held mail lifecycle is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "care-commerce-mail-reservation",
    deliveryEffects: false,
    providerEffects: false,
    readiness: () => lifecycle.readiness(),
    async reserve(input) {
      exactObject(
        input,
        [
          "commandId", "contentDigest", "customerUserId", "expiresAt",
          "organizationId", "projectId", "recipientDigest",
          "resourceDigest", "templateVersion"
        ],
        "Care commerce mail reservation"
      );
      const requestedAt = clockNow(clock);
      const expiresAt = instant(input.expiresAt, "Care commerce mail expiry");
      invariant(
        MAIL_TEMPLATES.has(input.templateVersion) &&
          Date.parse(expiresAt) > Date.parse(requestedAt) &&
          Date.parse(expiresAt) - Date.parse(requestedAt) <= MAX_MAIL_TTL_MS,
        "CARE_COMMERCE_INVALID",
        "Care commerce mail template or expiry is invalid.",
        { status: 400 }
      );
      const resourceDigest = sha256(input.resourceDigest, "Care resource digest");
      const receipt = await lifecycle.reserve({
        commandId: `care.commerce.mail.${digest({
          commandId: safeId(input.commandId, "Care mail idempotency key"),
          resourceDigest
        })}`,
        messageType: "commerce_customer_notification",
        organizationId: uuid(input.organizationId, "Care organization ID"),
        projectId: uuid(input.projectId, "Care project ID"),
        customerUserId: uuid(input.customerUserId, "Care customer ID"),
        recipientDigest: sha256(input.recipientDigest, "Recipient digest"),
        subjectReferenceDigest: resourceDigest,
        contentDigest: sha256(input.contentDigest, "Content digest"),
        templateVersion: input.templateVersion,
        expiresAt
      });
      invariant(
        receipt?.schema === "sitesourcery.hosted-mail-delivery-receipt/v1" &&
          UUID.test(receipt.messageId) &&
          receipt.messageType === "commerce_customer_notification" &&
          receipt.organizationId === input.organizationId &&
          receipt.projectId === input.projectId &&
          receipt.customerUserId === input.customerUserId &&
          ["pending", "reserved"].includes(receipt.state) &&
          receipt.provider === null &&
          receipt.expiresAt === expiresAt,
        "CARE_COMMERCE_MAIL_CONFLICT",
        "The held Care mail reservation returned inconsistent evidence.",
        { status: 500 }
      );
      return deepFreeze({
        schema: CARE_COMMERCE_MAIL_RESERVATION_SCHEMA,
        messageId: receipt.messageId,
        resourceDigest,
        state: "reserved",
        requestedAt: instant(receipt.requestedAt ?? requestedAt, "Mail request time"),
        expiresAt: instant(receipt.expiresAt, "Mail expiry"),
        deliveryEffects: false,
        providerEffects: false
      });
    }
  });
}

export function createHeldCareCommerceService(inputPorts) {
  const ports = validatePorts(inputPorts);

  async function resolve(authenticated, selectedScope, audience) {
    const selectedActor = actor(authenticated);
    const organizationId = audience === "customer"
      ? selectedActor.sessionOrganizationId
      : selectedScope.organizationId;
    const expected = {
      audience,
      actorId: selectedActor.actorId,
      organizationId,
      projectId: selectedScope.projectId,
      contractId: selectedScope.contractId,
      periodId: selectedScope.periodId
    };
    const eligibility = exactEligibility(
      await ports.eligibility.resolve(expected),
      expected
    );
    return { selectedActor, selectedScope: { ...selectedScope, organizationId }, eligibility };
  }

  async function findReservation(authenticated, value, audience) {
    const selectedScope = scope(value, { operator: audience === "operator" });
    const resolved = await resolve(authenticated, selectedScope, audience);
    const reservation = validateReservation(
      await ports.repository.findReservation({
        ...resolved.selectedScope,
        actorId: resolved.selectedActor.actorId,
        reservationId: uuid(value.reservationId, "Care reservation ID")
      }),
      resolved.selectedScope
    );
    invariant(
      reservation.customerId === resolved.eligibility.customerId,
      "CARE_COMMERCE_RESERVATION_UNAVAILABLE",
      "The held Care invoice reservation is unavailable.",
      { status: 404 }
    );
    return { ...resolved, reservation };
  }

  return Object.freeze({
    kind: "care-commerce",
    mode: "held-local",
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      const [eligibility, repository, mail] = await Promise.all([
        ports.eligibility.readiness(),
        ports.repository.readiness(),
        ports.mailReservations.readiness()
      ]);
      return deepFreeze({
        schema: "sitesourcery.care-commerce-readiness/v1",
        ready: eligibility?.ready === true && repository?.ready === true,
        verified: eligibility?.verified === true && repository?.verified === true,
        commercialReady: false,
        durableCommercialState: repository?.durable === true,
        taxPurposeReleased: false,
        mailReservationReady: mail?.ready === true,
        commercialEffects: false,
        customerEffects: false,
        mailDeliveryEffects: false,
        paymentEffects: false,
        providerEffects: false
      });
    },
    async readCustomerCatalog(authenticated, value) {
      exactObject(
        value,
        ["contractId", "periodId", "projectId"],
        "Care customer catalog read"
      );
      const resolved = await resolve(authenticated, scope(value), "customer");
      return deepFreeze({
        audience: "customer",
        eligibility: {
          organizationId: resolved.eligibility.organizationId,
          projectId: resolved.eligibility.projectId,
          contractId: resolved.eligibility.contractId,
          periodId: resolved.eligibility.periodId,
          serviceKey: resolved.eligibility.serviceKey,
          commercialAuthorityState:
            resolved.eligibility.commercialAuthorityState,
          eligibilityDigest: resolved.eligibility.eligibilityDigest
        },
        catalog: getHeldCareCommerceCatalog()
      });
    },
    async readOperatorCatalog(authenticated, value) {
      exactObject(
        value,
        ["contractId", "organizationId", "periodId", "projectId"],
        "Care operator catalog read"
      );
      const resolved = await resolve(
        authenticated,
        scope(value, { operator: true }),
        "operator"
      );
      return deepFreeze({
        audience: "operator",
        customerId: resolved.eligibility.customerId,
        eligibility: clone(resolved.eligibility),
        catalog: getHeldCareCommerceCatalog()
      });
    },
    async createHeldQuote(authenticated, value) {
      exactObject(
        value,
        [
          "commandId", "contractId", "organizationId", "periodId",
          "priceSelection", "projectId", "serviceKey"
        ],
        "Care quote command"
      );
      const resolved = await resolve(
        authenticated,
        scope(value, { operator: true }),
        "operator"
      );
      const offer = resolveHeldCareOffer(value.serviceKey);
      invariant(
        offer.serviceKey === resolved.eligibility.serviceKey &&
          offer.catalogIdentityId === resolved.eligibility.catalogIdentityId &&
          offer.contractKind === resolved.eligibility.contractKind &&
          offer.commercialAuthorityState ===
            resolved.eligibility.commercialAuthorityState,
        "CARE_COMMERCE_ELIGIBILITY_MISMATCH",
        "The Care contract is not eligible for this catalog offer.",
        { status: 409 }
      );
      const line = priceHeldCareSelection(value.serviceKey, value.priceSelection);
      const purpose = {
        operation: "care_quote_create",
        actorId: resolved.selectedActor.actorId,
        organizationId: resolved.selectedScope.organizationId,
        projectId: resolved.selectedScope.projectId,
        customerId: resolved.eligibility.customerId,
        contractId: resolved.selectedScope.contractId,
        periodId: resolved.selectedScope.periodId,
        serviceKey: offer.serviceKey,
        eligibilityDigest: resolved.eligibility.eligibilityDigest,
        line
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projectCareCommerceRecord(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, quote) => ports.repository.commitQuoteCommand(selected, quote),
        async () => {
          const issuedAt = clockNow(ports.clock);
          const catalog = getHeldCareCommerceCatalog();
          const disclosure = {
            schema: "sitesourcery.care-commerce-disclosure/v1",
            catalogVersion: CARE_COMMERCE_CATALOG_VERSION,
            careCoreCatalogVersion: CARE_CORE_CATALOG_VERSION,
            priceVersion: CARE_COMMERCE_PRICE_VERSION,
            commercialContractDigest: CARE_COMMERCIAL_CONTRACT_DIGEST,
            catalogDigest: catalog.catalogDigest,
            serviceKey: offer.serviceKey,
            commercialAuthorityState: offer.commercialAuthorityState,
            terms: offer.disclosure,
            line,
            release: offer.effects
          };
          const quoteIdentity = {
            organizationId: resolved.selectedScope.organizationId,
            projectId: resolved.selectedScope.projectId,
            contractId: resolved.selectedScope.contractId,
            periodId: resolved.selectedScope.periodId,
            customerId: resolved.eligibility.customerId,
            catalogIdentityId: resolved.eligibility.catalogIdentityId,
            eligibilityDigest: resolved.eligibility.eligibilityDigest,
            catalogDigest: catalog.catalogDigest
          };
          const selected = {
            schema: CARE_COMMERCE_QUOTE_SCHEMA,
            quoteId: uuid(ports.ids.next("care_quote"), "Care quote ID"),
            actorId: resolved.selectedActor.actorId,
            ...quoteIdentity,
            catalogVersion: CARE_COMMERCE_CATALOG_VERSION,
            careCoreCatalogVersion: CARE_CORE_CATALOG_VERSION,
            priceVersion: CARE_COMMERCE_PRICE_VERSION,
            commercialContractDigest: CARE_COMMERCIAL_CONTRACT_DIGEST,
            serviceKey: offer.serviceKey,
            state: "held",
            payable: false,
            dispatchAuthorized: false,
            line,
            tax: taxEvidence(quoteIdentity),
            disclosure,
            disclosureDigest: digest(disclosure),
            issuedAt,
            expiresAt: new Date(Date.parse(issuedAt) + QUOTE_TTL_MS).toISOString(),
            customerEffects: false,
            paymentEffects: false,
            providerEffects: false
          };
          return deepFreeze({ ...selected, quoteDigest: digest(selected) });
        }
      ), "operator");
    },
    async reserveHeldInvoice(authenticated, value) {
      exactObject(
        value,
        [
          "acceptedQuoteDigest", "commandId", "contractId",
          "organizationId", "periodId", "projectId", "quoteId"
        ],
        "Care invoice reservation command"
      );
      const resolved = await resolve(
        authenticated,
        scope(value, { operator: true }),
        "operator"
      );
      const now = clockNow(ports.clock);
      const quote = validateQuote(
        await ports.repository.findQuote({
          ...resolved.selectedScope,
          actorId: resolved.selectedActor.actorId,
          quoteId: uuid(value.quoteId, "Care quote ID")
        }),
        resolved.selectedScope,
        now,
        sha256(value.acceptedQuoteDigest, "Accepted Care quote digest")
      );
      invariant(
        quote.customerId === resolved.eligibility.customerId &&
          quote.eligibilityDigest === resolved.eligibility.eligibilityDigest,
        "CARE_COMMERCE_ELIGIBILITY_DRIFT",
        "The Care contract or period changed after quote creation.",
        { status: 409 }
      );
      const purpose = {
        operation: "care_invoice_reserve",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        customerId: resolved.eligibility.customerId,
        quoteId: quote.quoteId,
        acceptedQuoteDigest: quote.quoteDigest,
        eligibilityDigest: resolved.eligibility.eligibilityDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projectCareCommerceRecord(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, reservation) =>
          ports.repository.commitReservationCommand(selected, reservation),
        async () => {
          const selected = {
            schema: CARE_COMMERCE_RESERVATION_SCHEMA,
            reservationId: uuid(
              ports.ids.next("care_invoice_reservation"),
              "Care reservation ID"
            ),
            actorId: resolved.selectedActor.actorId,
            customerId: resolved.eligibility.customerId,
            ...resolved.selectedScope,
            quoteId: quote.quoteId,
            quoteDigest: quote.quoteDigest,
            eligibilityDigest: resolved.eligibility.eligibilityDigest,
            serviceKey: quote.serviceKey,
            state: "held",
            revision: 1,
            reservationKind: "professional_invoice",
            intendedProvider: "stripe",
            providerRequest: null,
            providerEffectCertainty: "not_submitted",
            holdReason: "care_commercial_and_tax_release_required",
            dispatchAuthorized: false,
            subtotalMinor: quote.line.subtotalMinor,
            taxMode: null,
            taxMinor: null,
            totalMinor: null,
            currency: "USD",
            taxEvidenceDigest: quote.tax.evidenceDigest,
            reservedAt: now,
            updatedAt: now,
            cancellationEvidenceDigest: null,
            ambiguityEvidenceDigest: null,
            customerEffects: false,
            paymentEffects: false,
            providerEffects: false
          };
          return deepFreeze({
            ...selected,
            reservationDigest: digest(selected)
          });
        }
      ), "operator");
    },
    async readCustomerReservation(authenticated, value) {
      exactObject(
        value,
        ["contractId", "periodId", "projectId", "reservationId"],
        "Care customer reservation read"
      );
      const resolved = await findReservation(
        authenticated,
        value,
        "customer"
      );
      return projectCareCommerceRecord(resolved.reservation, "customer");
    },
    async cancelHeldReservation(authenticated, value) {
      exactObject(
        value,
        [
          "cancellationEvidenceDigest", "commandId", "contractId",
          "expectedRevision", "organizationId", "periodId", "projectId",
          "reservationId"
        ],
        "Care cancellation command"
      );
      const resolved = await findReservation(authenticated, value, "operator");
      const evidenceDigest = sha256(
        value.cancellationEvidenceDigest,
        "Care cancellation evidence digest"
      );
      const purpose = {
        operation: "care_reservation_cancel",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        customerId: resolved.eligibility.customerId,
        reservationId: resolved.reservation.reservationId,
        expectedRevision: value.expectedRevision,
        cancellationEvidenceDigest: evidenceDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projectCareCommerceRecord(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, next) => ports.repository.commitReservationTransition(
          selected,
          resolved.reservation,
          next
        ),
        async () => {
          invariant(
            resolved.reservation.state === "held" &&
              resolved.reservation.providerEffectCertainty ===
                "not_submitted" &&
              value.expectedRevision === resolved.reservation.revision,
            "CARE_COMMERCE_CANCELLATION_FENCED",
            "The Care reservation cannot be cancelled from its current state.",
            { status: 409 }
          );
          const next = {
            ...clone(resolved.reservation),
            actorId: resolved.selectedActor.actorId,
            state: "cancelled",
            revision: resolved.reservation.revision + 1,
            holdReason: "cancelled_before_provider_submission",
            updatedAt: clockNow(ports.clock),
            cancellationEvidenceDigest: evidenceDigest
          };
          delete next.reservationDigest;
          return deepFreeze({ ...next, reservationDigest: digest(next) });
        }
      ), "operator");
    },
    async markReservationAmbiguous(authenticated, value) {
      exactObject(
        value,
        [
          "ambiguityEvidenceDigest", "commandId", "contractId",
          "expectedRevision", "organizationId", "periodId", "projectId",
          "reservationId"
        ],
        "Care ambiguity command"
      );
      const resolved = await findReservation(authenticated, value, "operator");
      const evidenceDigest = sha256(
        value.ambiguityEvidenceDigest,
        "Care ambiguity evidence digest"
      );
      const purpose = {
        operation: "care_reservation_ambiguity_hold",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        customerId: resolved.eligibility.customerId,
        reservationId: resolved.reservation.reservationId,
        expectedRevision: value.expectedRevision,
        ambiguityEvidenceDigest: evidenceDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projectCareCommerceRecord(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, next) => ports.repository.commitReservationTransition(
          selected,
          resolved.reservation,
          next
        ),
        async () => {
          invariant(
            resolved.reservation.state === "held" &&
              resolved.reservation.providerEffectCertainty ===
                "not_submitted" &&
              value.expectedRevision === resolved.reservation.revision,
            "CARE_COMMERCE_AMBIGUITY_FENCED",
            "The Care reservation cannot enter ambiguity review from its current state.",
            { status: 409 }
          );
          const next = {
            ...clone(resolved.reservation),
            actorId: resolved.selectedActor.actorId,
            state: "ambiguity_review_required",
            revision: resolved.reservation.revision + 1,
            providerEffectCertainty: "ambiguous",
            holdReason: "manual_provider_reconciliation_required",
            updatedAt: clockNow(ports.clock),
            ambiguityEvidenceDigest: evidenceDigest
          };
          delete next.reservationDigest;
          return deepFreeze({ ...next, reservationDigest: digest(next) });
        }
      ), "operator");
    },
    async requestReversal(authenticated, value) {
      exactObject(
        value,
        [
          "contractId", "organizationId", "periodId", "projectId",
          "reservationId"
        ],
        "Care reversal request"
      );
      await findReservation(authenticated, value, "operator");
      throw new HostedError(
        "CARE_COMMERCE_REVERSAL_AUTHORITY_HELD",
        "No authoritative Care payment receipt exists, so reversal is unavailable.",
        {
          status: 503,
          details: {
            accountingEffects: false,
            paymentEffects: false,
            providerEffects: false
          }
        }
      );
    }
  });
}
