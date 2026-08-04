import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_TERMS_VERSION,
  createAlakazamCheckoutDispatch,
  createAlakazamCustomerProvision,
  createAlakazamProviderMetadata,
  quoteAlakazamChange,
  resolveAlakazamTier
} from "../commerce-v2/alakazam.mjs";
import {
  CommerceV2Error,
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ROLES = Object.freeze([
  "owner",
  "admin",
  "editor"
]);
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const STRIPE_CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const STRIPE_SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const STRIPE_SUBSCRIPTION_ITEM_ID = /^si_[A-Za-z0-9_]+$/u;
const STRIPE_PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const STRIPE_INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const STRIPE_PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const ALAKAZAM_PAYMENT_EVENT_TYPE =
  "checkout.session.completed";
const ALAKAZAM_EVENT_FACTS_SCHEMA =
  "sitesourcery.alakazam-stripe-event/v1";
const ALAKAZAM_TIER_EVENT_FACTS_SCHEMA =
  "sitesourcery.alakazam-tier-event/v1";
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "55000"
]);

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactKeys(
  value,
  expected,
  message = "the Alakazam quote repository input is invalid"
) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    message
  );
  return value;
}

function exactCustomerClaimInput(value) {
  exactKeys(
    value,
    [
      "claimedAt",
      "customerId",
      "projectId",
      "provisionId",
      "quoteId",
      "tenantId"
    ],
    "the Alakazam Customer claim input is invalid"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    provisionId: exactUuid(
      value.provisionId,
      "provisionId"
    ),
    claimedAt: requiredIso(value.claimedAt, "claimedAt")
  });
}

function exactCustomerReference(value, extraFields = []) {
  exactKeys(
    value,
    [
      "customerId",
      "projectId",
      "provisionId",
      "purposeDigest",
      "quoteId",
      "tenantId",
      ...extraFields
    ],
    "the Alakazam Customer evidence input is invalid"
  );
  const purposeDigest = requiredText(
    value.purposeDigest,
    "purposeDigest",
    64
  );
  invariant(
    /^[a-f0-9]{64}$/u.test(purposeDigest),
    "invalid_input",
    "purposeDigest is invalid"
  );
  return {
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    provisionId: exactUuid(
      value.provisionId,
      "provisionId"
    ),
    purposeDigest
  };
}

function exactCheckoutClaimInput(value) {
  exactKeys(
    value,
    [
      "claimedAt",
      "customerId",
      "dispatchId",
      "projectId",
      "quoteId",
      "stripeCustomerId",
      "tenantId"
    ],
    "the Alakazam Checkout claim input is invalid"
  );
  const stripeCustomerId = requiredText(
    value.stripeCustomerId,
    "stripeCustomerId",
    255
  );
  invariant(
    STRIPE_CUSTOMER_ID.test(stripeCustomerId),
    "invalid_input",
    "stripeCustomerId is invalid"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    dispatchId: exactUuid(
      value.dispatchId,
      "dispatchId"
    ),
    stripeCustomerId,
    claimedAt: requiredIso(value.claimedAt, "claimedAt")
  });
}

function exactCheckoutReference(value, extraFields = []) {
  exactKeys(
    value,
    [
      "customerId",
      "dispatchId",
      "projectId",
      "purposeDigest",
      "quoteId",
      "tenantId",
      ...extraFields
    ],
    "the Alakazam Checkout evidence input is invalid"
  );
  const purposeDigest = requiredText(
    value.purposeDigest,
    "purposeDigest",
    64
  );
  invariant(
    /^[a-f0-9]{64}$/u.test(purposeDigest),
    "invalid_input",
    "purposeDigest is invalid"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    dispatchId: exactUuid(
      value.dispatchId,
      "dispatchId"
    ),
    purposeDigest
  });
}

function exactQuoteInput(value) {
  exactKeys(value, [
    "customerId",
    "expiresAt",
    "issuedAt",
    "projectId",
    "quoteId",
    "targetTierId",
    "taxMode",
    "tenantId"
  ]);
  const taxMode = requiredText(
    value.taxMode,
    "taxMode",
    40
  );
  invariant(
    TAX_MODES.has(taxMode),
    "invalid_input",
    "taxMode is invalid"
  );
  const issuedAt = requiredIso(
    value.issuedAt,
    "issuedAt"
  );
  const expiresAt = requiredIso(
    value.expiresAt,
    "expiresAt"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(issuedAt) &&
      Date.parse(expiresAt) - Date.parse(issuedAt) <=
        30 * 60 * 1000,
    "invalid_input",
    "the Alakazam quote window is invalid"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "projectId"
    ),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    targetTierId: requiredText(
      value.targetTierId,
      "targetTierId",
      100
    ),
    taxMode,
    issuedAt,
    expiresAt
  });
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam repository rejected inconsistent evidence",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function validateAuthority(authority) {
  invariant(
    authority &&
      typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function exactDatabaseIso(value, field) {
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    field
  );
}

function exactDatabaseInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function jsonObject(value, field) {
  let selected = value;
  if (typeof selected === "string") {
    try {
      selected = JSON.parse(selected);
    } catch {
      invariant(
        false,
        "repository_conflict",
        `${field} is invalid`,
        { status: 500 }
      );
    }
  }
  invariant(
    selected &&
      typeof selected === "object" &&
      !Array.isArray(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return clone(selected);
}

function storedCustomerProvision(row) {
  invariant(
    row &&
      row.provider === "stripe" &&
      [
        "reserved",
        "confirmed",
        "reconciliation_required"
      ].includes(row.state),
    "repository_conflict",
    "the durable Alakazam Customer reservation is invalid",
    { status: 500 }
  );
  const reservation = createAlakazamCustomerProvision({
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    quoteId: row.quote_id,
    provisionId: row.id,
    acceptedDisclosureDigest:
      row.accepted_disclosure_digest,
    quoteDigest: row.quote_digest,
    claimedAt: exactDatabaseIso(
      row.created_at,
      "customerProvision.claimedAt"
    )
  });
  const purpose = jsonObject(
    row.purpose,
    "customerProvision.purpose"
  );
  invariant(
    row.provider_idempotency_key ===
      reservation.idempotencyKey &&
      row.purpose_digest ===
        reservation.purposeDigest &&
      digest(purpose) === reservation.purposeDigest &&
      exactDatabaseIso(
        row.lease_expires_at,
        "customerProvision.leaseExpiresAt"
      ) === reservation.leaseExpiresAt &&
      (
        row.stripe_customer_id === null ||
        STRIPE_CUSTOMER_ID.test(
          row.stripe_customer_id
        )
      ),
    "repository_conflict",
    "the durable Alakazam Customer purpose changed",
    { status: 500 }
  );
  return reservation;
}

function exactCustomerProviderFacts(value, reference) {
  exactKeys(
    value,
    [
      "customerId",
      "organizationId",
      "projectId",
      "providerCreatedAt",
      "providerFactsDigest",
      "provisionId",
      "purposeDigest",
      "quoteId",
      "schema",
      "stripeCustomerId"
    ],
    "the Alakazam Customer provider evidence is invalid"
  );
  const stripeCustomerId = requiredText(
    value.stripeCustomerId,
    "providerFacts.stripeCustomerId",
    255
  );
  const providerCreatedAt = requiredIso(
    value.providerCreatedAt,
    "providerFacts.providerCreatedAt"
  );
  const providerFactsDigest = requiredText(
    value.providerFactsDigest,
    "providerFacts.providerFactsDigest",
    64
  );
  const facts = {
    schema: value.schema,
    stripeCustomerId,
    organizationId: value.organizationId,
    customerId: value.customerId,
    projectId: value.projectId,
    quoteId: value.quoteId,
    provisionId: value.provisionId,
    providerCreatedAt,
    purposeDigest: value.purposeDigest
  };
  invariant(
    value.schema ===
      ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA &&
      STRIPE_CUSTOMER_ID.test(stripeCustomerId) &&
      value.organizationId === reference.tenantId &&
      value.customerId === reference.customerId &&
      value.projectId === reference.projectId &&
      value.quoteId === reference.quoteId &&
      value.provisionId === reference.provisionId &&
      value.purposeDigest === reference.purposeDigest &&
      /^[a-f0-9]{64}$/u.test(providerFactsDigest) &&
      digest(facts) === providerFactsDigest,
    "repository_conflict",
    "the Alakazam Customer provider evidence changed",
    { status: 500 }
  );
  return Object.freeze({
    facts: Object.freeze({
      ...facts,
      providerFactsDigest
    }),
    stripeCustomerId,
    providerCreatedAt,
    providerFactsDigest
  });
}

function exactProvisionRowIdentity(row, reference) {
  const reservation = storedCustomerProvision(row);
  invariant(
    reservation.tenantId === reference.tenantId &&
      reservation.customerId === reference.customerId &&
      reservation.projectId === reference.projectId &&
      reservation.quoteId === reference.quoteId &&
      reservation.provisionId ===
        reference.provisionId &&
      reservation.purposeDigest ===
        reference.purposeDigest,
    "idempotency_conflict",
    "the Alakazam Customer command was already used for another purpose",
    { status: 409 }
  );
  return reservation;
}

function customerBinding(stripeCustomerId, provisionId = null) {
  invariant(
    STRIPE_CUSTOMER_ID.test(stripeCustomerId),
    "repository_conflict",
    "the Stripe Customer binding is invalid",
    { status: 500 }
  );
  return Object.freeze({
    status: "bound",
    provider: "stripe",
    stripeCustomerId,
    provisionId
  });
}

function exactStripeCheckoutUrl(value) {
  const selected = requiredText(
    value,
    "checkout.url",
    4096
  );
  let parsed;
  try {
    parsed = new URL(selected);
  } catch {
    invariant(
      false,
      "repository_conflict",
      "the Stripe Checkout URL is invalid",
      { status: 500 }
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "repository_conflict",
    "the Stripe Checkout URL is invalid",
    { status: 500 }
  );
  return parsed.toString();
}

function storedCheckoutDispatch(row) {
  invariant(
    row &&
      row.provider === "stripe" &&
      [
        "reserved",
        "ready",
        "settled",
        "expired",
        "failed",
        "persistence_unknown"
      ].includes(row.state),
    "repository_conflict",
    "the durable Alakazam Checkout reservation is invalid",
    { status: 500 }
  );
  const purpose = jsonObject(
    row.purpose,
    "checkoutDispatch.purpose"
  );
  let reservation;
  try {
    reservation = createAlakazamCheckoutDispatch({
      dispatchId: row.id,
      tenantId: row.organization_id,
      customerId: row.customer_user_id,
      projectId: row.project_id,
      quoteId: row.quote_id,
      stripeCustomerId: row.stripe_customer_id,
      acceptedDisclosureDigest:
        purpose.acceptedDisclosureDigest,
      quoteDigest: purpose.quoteDigest,
      changeKind: purpose.changeKind,
      currentSubscription: purpose.currentSubscription,
      targetTierId: purpose.targetTierId,
      dueNowSubtotalMinor: purpose.dueNowSubtotalMinor,
      taxMode: purpose.taxMode,
      downloadCredit: purpose.downloadCredit,
      claimedAt: exactDatabaseIso(
        row.created_at,
        "checkoutDispatch.claimedAt"
      )
    });
  } catch {
    invariant(
      false,
      "repository_conflict",
      "the durable Alakazam Checkout purpose is invalid",
      { status: 500 }
    );
  }
  invariant(
    reservation.schema ===
      ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      row.mode === reservation.mode &&
      row.provider_idempotency_key ===
        reservation.idempotencyKey &&
      row.purpose_digest ===
        reservation.purposeDigest &&
      digest(purpose) === reservation.purposeDigest &&
      exactDatabaseInteger(
        row.expected_subtotal_minor,
        "checkoutDispatch.expectedSubtotalMinor"
      ) === reservation.expectedSubtotalMinor &&
      exactDatabaseInteger(
        row.expected_credit_minor,
        "checkoutDispatch.expectedCreditMinor"
      ) === reservation.expectedCreditMinor &&
      row.currency === reservation.currency &&
      exactDatabaseIso(
        row.lease_expires_at,
        "checkoutDispatch.leaseExpiresAt"
      ) === reservation.leaseExpiresAt,
    "repository_conflict",
    "the durable Alakazam Checkout purpose changed",
    { status: 500 }
  );
  return reservation;
}

function exactCheckoutRowIdentity(row, reference) {
  const reservation = storedCheckoutDispatch(row);
  invariant(
    reservation.tenantId === reference.tenantId &&
      reservation.customerId === reference.customerId &&
      reservation.projectId === reference.projectId &&
      reservation.quoteId === reference.quoteId &&
      reservation.dispatchId === reference.dispatchId &&
      reservation.purposeDigest ===
        reference.purposeDigest,
    "idempotency_conflict",
    "the Alakazam Checkout command was already used for another purpose",
    { status: 409 }
  );
  return reservation;
}

function exactCheckoutProviderResult(value) {
  exactKeys(
    value,
    ["checkoutId", "expiresAt", "url"],
    "the Stripe Checkout provider result is invalid"
  );
  const checkoutId = requiredText(
    value.checkoutId,
    "checkout.checkoutId",
    255
  );
  invariant(
    STRIPE_CHECKOUT_ID.test(checkoutId),
    "repository_conflict",
    "the Stripe Checkout Session ID is invalid",
    { status: 500 }
  );
  return Object.freeze({
    checkoutId,
    url: exactStripeCheckoutUrl(value.url),
    expiresAt: requiredIso(
      value.expiresAt,
      "checkout.expiresAt"
    )
  });
}

function checkoutReady(row, reservation = null) {
  const selected = reservation ?? storedCheckoutDispatch(row);
  invariant(
    row.state === "ready" || row.state === "settled",
    "repository_conflict",
    "the Alakazam Checkout is not ready",
    { status: 500 }
  );
  const checkout = exactCheckoutProviderResult({
    checkoutId: row.stripe_checkout_session_id,
    url: row.provider_checkout_url,
    expiresAt: exactDatabaseIso(
      row.provider_expires_at,
      "checkout.providerExpiresAt"
    )
  });
  return Object.freeze({
    status: row.state === "settled" ? "settled" : "ready",
    provider: "stripe",
    dispatchId: selected.dispatchId,
    quoteId: selected.quoteId,
    projectId: selected.projectId,
    purposeDigest: selected.purposeDigest,
    checkout
  });
}

function sameExactObject(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(
      ([key, selected]) => value[key] === selected
    )
  );
}

function exactSha(value, field) {
  const selected = requiredText(value, field, 64);
  invariant(
    /^[a-f0-9]{64}$/u.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactCheckoutSessionInput(value) {
  exactKeys(
    value,
    ["checkoutSessionId"],
    "the Alakazam Checkout settlement lookup is invalid"
  );
  const checkoutSessionId = requiredText(
    value.checkoutSessionId,
    "checkoutSessionId",
    255
  );
  invariant(
    STRIPE_CHECKOUT_ID.test(checkoutSessionId),
    "invalid_input",
    "checkoutSessionId is invalid"
  );
  return Object.freeze({ checkoutSessionId });
}

function exactCheckoutReservationValue(value) {
  exactKeys(
    value,
    [
      "claimedAt",
      "currency",
      "customerId",
      "dispatchId",
      "expectedCreditMinor",
      "expectedSubtotalMinor",
      "idempotencyKey",
      "leaseExpiresAt",
      "mode",
      "projectId",
      "provider",
      "purpose",
      "purposeDigest",
      "quoteId",
      "schema",
      "state",
      "stripeCustomerId",
      "tenantId"
    ],
    "the Alakazam Checkout reservation input is invalid"
  );
  let expected;
  try {
    expected = createAlakazamCheckoutDispatch({
      dispatchId: value.dispatchId,
      tenantId: value.tenantId,
      customerId: value.customerId,
      projectId: value.projectId,
      quoteId: value.quoteId,
      stripeCustomerId: value.stripeCustomerId,
      acceptedDisclosureDigest:
        value.purpose.acceptedDisclosureDigest,
      quoteDigest: value.purpose.quoteDigest,
      changeKind: value.purpose.changeKind,
      currentSubscription:
        value.purpose.currentSubscription,
      targetTierId: value.purpose.targetTierId,
      dueNowSubtotalMinor:
        value.purpose.dueNowSubtotalMinor,
      taxMode: value.purpose.taxMode,
      downloadCredit: value.purpose.downloadCredit,
      claimedAt: value.claimedAt
    });
  } catch {
    invariant(
      false,
      "invalid_input",
      "the Alakazam Checkout purpose input is invalid"
    );
  }
  invariant(
    value.schema === ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      digest(value) === digest(expected),
    "invalid_input",
    "the Alakazam Checkout reservation input changed"
  );
  return expected;
}

function exactCheckoutEvidence(value, reservation) {
  exactKeys(
    value,
    ["checkoutId", "expiresAt", "url"],
    "the Alakazam Checkout provider evidence is invalid"
  );
  const checkoutId = requiredText(
    value.checkoutId,
    "checkout.checkoutId",
    255
  );
  invariant(
    STRIPE_CHECKOUT_ID.test(checkoutId),
    "invalid_input",
    "checkout.checkoutId is invalid"
  );
  return Object.freeze({
    checkoutId,
    url: exactStripeCheckoutUrl(value.url),
    expiresAt: requiredIso(
      value.expiresAt,
      "checkout.expiresAt"
    ),
    dispatchId: reservation.dispatchId
  });
}

function exactPaymentEventValue(value, reservation, checkout) {
  exactKeys(
    value,
    [
      "apiVersion",
      "checkoutSessionId",
      "eventType",
      "livemode",
      "metadata",
      "occurredAt",
      "payloadDigest",
      "signatureVerifiedAt",
      "stripeEventId"
    ],
    "the Alakazam Stripe event input is invalid"
  );
  const metadata = createAlakazamProviderMetadata({
    purpose: reservation.purpose,
    purposeDigest: reservation.purposeDigest
  });
  invariant(
    STRIPE_EVENT_ID.test(value.stripeEventId) &&
      value.eventType === ALAKAZAM_PAYMENT_EVENT_TYPE &&
      typeof value.livemode === "boolean" &&
      typeof value.apiVersion === "string" &&
      value.apiVersion.length >= 3 &&
      value.apiVersion.length <= 100 &&
      value.checkoutSessionId === checkout.checkoutId &&
      sameExactObject(value.metadata, metadata),
    "invalid_input",
    "the Alakazam Stripe event changed"
  );
  return Object.freeze({
    stripeEventId: value.stripeEventId,
    eventType: value.eventType,
    livemode: value.livemode,
    apiVersion: value.apiVersion,
    checkoutSessionId: value.checkoutSessionId,
    metadata,
    payloadDigest: exactSha(
      value.payloadDigest,
      "event.payloadDigest"
    ),
    signatureVerifiedAt: requiredIso(
      value.signatureVerifiedAt,
      "event.signatureVerifiedAt"
    ),
    occurredAt: requiredIso(
      value.occurredAt,
      "event.occurredAt"
    )
  });
}

function exactSubscriptionPaymentFacts(value, reservation) {
  exactKeys(
    value,
    [
      "amountMinor",
      "billingCycleAnchor",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "metadata",
      "providerFactsDigest",
      "providerObservedAt",
      "providerStatus",
      "schema",
      "stripeCustomerId",
      "stripePriceId",
      "stripeScheduleId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "tierId"
    ],
    "the Alakazam Subscription payment evidence is invalid"
  );
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const startsAt = requiredIso(
    value.currentPeriodStartsAt,
    "payment.subscription.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    value.currentPeriodEndsAt,
    "payment.subscription.currentPeriodEndsAt"
  );
  requiredIso(
    value.billingCycleAnchor,
    "payment.subscription.billingCycleAnchor"
  );
  requiredIso(
    value.providerObservedAt,
    "payment.subscription.providerObservedAt"
  );
  invariant(
    value.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      STRIPE_SUBSCRIPTION_ID.test(
        value.stripeSubscriptionId
      ) &&
      STRIPE_SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      STRIPE_CUSTOMER_ID.test(value.stripeCustomerId) &&
      STRIPE_PRICE_ID.test(value.stripePriceId) &&
      value.stripeScheduleId === null &&
      value.stripeCustomerId ===
        reservation.stripeCustomerId &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      value.cancelAtPeriodEnd === false &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      sameExactObject(
        value.metadata,
        createAlakazamProviderMetadata({
          purpose: reservation.purpose,
          purposeDigest: reservation.purposeDigest
        })
      ) &&
      exactSha(
        value.providerFactsDigest,
        "payment.subscription.providerFactsDigest"
      ) === digest(facts),
    "invalid_input",
    "the Alakazam Subscription payment evidence changed"
  );
  return deepFreeze(clone(value));
}

function exactCheckoutPaymentFacts(value, reservation, checkout) {
  exactKeys(
    value,
    [
      "changeKind",
      "checkoutSessionId",
      "currency",
      "listSubtotalMinor",
      "netSubtotalMinor",
      "paymentStatus",
      "provider",
      "providerDiscountMinor",
      "providerFactsDigest",
      "providerPaymentTime",
      "purposeDigest",
      "schema",
      "stripeCustomerId",
      "stripeInvoiceId",
      "stripePaymentIntentId",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "subscription",
      "targetTierId",
      "taxMinor",
      "taxMode",
      "totalMinor"
    ],
    "the Alakazam Checkout payment evidence is invalid"
  );
  const purpose = reservation.purpose;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  invariant(
    value.schema === ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.changeKind === purpose.changeKind &&
      value.checkoutSessionId === checkout.checkoutId &&
      value.stripeCustomerId === reservation.stripeCustomerId &&
      STRIPE_SUBSCRIPTION_ID.test(
        value.stripeSubscriptionId
      ) &&
      STRIPE_SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      STRIPE_PRICE_ID.test(value.stripePriceId) &&
      STRIPE_PAYMENT_INTENT_ID.test(
        value.stripePaymentIntentId
      ) &&
      value.targetTierId === purpose.targetTierId &&
      value.listSubtotalMinor ===
        (purpose.changeKind === "start"
          ? purpose.targetAmountMinor
          : purpose.dueNowSubtotalMinor) &&
      value.providerDiscountMinor ===
        (purpose.downloadCredit?.amountMinor ?? 0) &&
      value.netSubtotalMinor === purpose.dueNowSubtotalMinor &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.totalMinor ===
        value.netSubtotalMinor + value.taxMinor &&
      value.taxMode === purpose.taxMode &&
      (value.taxMode === "automatic" || value.taxMinor === 0) &&
      value.currency === "USD" &&
      value.paymentStatus === "paid" &&
      value.purposeDigest === reservation.purposeDigest &&
      exactSha(
        value.providerFactsDigest,
        "payment.providerFactsDigest"
      ) === digest(facts),
    "invalid_input",
    "the Alakazam Checkout payment evidence changed"
  );
  requiredIso(
    value.providerPaymentTime,
    "payment.providerPaymentTime"
  );
  if (purpose.changeKind === "start") {
    const subscription = exactSubscriptionPaymentFacts(
      value.subscription,
      reservation
    );
    invariant(
      STRIPE_INVOICE_ID.test(value.stripeInvoiceId) &&
        value.stripeSubscriptionId ===
          subscription.stripeSubscriptionId &&
        value.stripeSubscriptionItemId ===
          subscription.stripeSubscriptionItemId &&
        value.stripePriceId === subscription.stripePriceId,
      "invalid_input",
      "the Alakazam start payment evidence disagrees"
    );
  } else {
    invariant(
      value.stripeInvoiceId === null &&
        value.subscription === null &&
        value.stripeSubscriptionId ===
          purpose.currentSubscription.stripeSubscriptionId &&
        value.stripeSubscriptionItemId ===
          purpose.currentSubscription.stripeSubscriptionItemId,
      "invalid_input",
      "the Alakazam upgrade payment evidence disagrees"
    );
  }
  return deepFreeze(clone(value));
}

function exactSettlementIds(value, reservation) {
  exactKeys(
    value,
    [
      "checkout",
      "creditApplicationId",
      "event",
      "eventRowId",
      "payment",
      "receiptId",
      "reservation",
      "subscriptionId",
      "tierEventId"
    ],
    "the Alakazam payment settlement input is invalid"
  );
  const checkout = exactCheckoutEvidence(
    value.checkout,
    reservation
  );
  const event = exactPaymentEventValue(
    value.event,
    reservation,
    checkout
  );
  const payment = exactCheckoutPaymentFacts(
    value.payment,
    reservation,
    checkout
  );
  const start = reservation.purpose.changeKind === "start";
  const subscriptionId = exactUuid(
    value.subscriptionId,
    "subscriptionId"
  );
  invariant(
    (start &&
      subscriptionId !==
        reservation.purpose.currentSubscription
          ?.localSubscriptionId &&
      value.tierEventId === null) ||
      (!start &&
        subscriptionId ===
          reservation.purpose.currentSubscription
            .localSubscriptionId &&
        UUID.test(value.tierEventId)),
    "invalid_input",
    "the Alakazam payment subscription identity is invalid"
  );
  invariant(
    (reservation.purpose.downloadCredit &&
      UUID.test(value.creditApplicationId)) ||
      (!reservation.purpose.downloadCredit &&
        value.creditApplicationId === null),
    "invalid_input",
    "the Alakazam credit application identity is invalid"
  );
  return Object.freeze({
    reservation,
    checkout,
    event,
    payment,
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    subscriptionId,
    creditApplicationId: value.creditApplicationId,
    tierEventId: value.tierEventId
  });
}

function paymentSettlementResult({
  reservation,
  subscriptionId,
  receiptId,
  providerFactsDigest
}) {
  return Object.freeze({
    status: "payment_settled",
    provider: "stripe",
    changeKind: reservation.purpose.changeKind,
    dispatchId: reservation.dispatchId,
    projectId: reservation.projectId,
    quoteId: reservation.quoteId,
    subscriptionId,
    receiptId,
    paymentProviderFactsDigest: providerFactsDigest,
    next:
      reservation.purpose.changeKind === "start"
        ? "subscription_confirmation"
        : "provider_change"
  });
}

async function storedPaymentSettlement(
  client,
  reservation,
  expectedProviderFactsDigest = null
) {
  const receipts = await client.query(
    `select receipt.id, receipt.subscription_id,
            receipt.provider_facts_digest
       from ss.alakazam_payment_receipts receipt
      where receipt.organization_id = $1
        and receipt.quote_id = $2
        and receipt.receipt_kind = $3
      for update`,
    [
      reservation.tenantId,
      reservation.quoteId,
      reservation.purpose.changeKind === "start"
        ? "start_payment"
        : "upgrade_difference"
    ]
  );
  invariant(
    receipts.rowCount === 1 &&
      (
        expectedProviderFactsDigest === null ||
        receipts.rows[0].provider_facts_digest ===
          expectedProviderFactsDigest
      ),
    "repository_conflict",
    "the durable Alakazam payment receipt changed",
    { status: 500 }
  );
  return paymentSettlementResult({
    reservation,
    subscriptionId: receipts.rows[0].subscription_id,
    receiptId: receipts.rows[0].id,
    providerFactsDigest:
      receipts.rows[0].provider_facts_digest
  });
}

function projectStoredQuote(row, input) {
  invariant(
    row &&
      row.id === input.quoteId &&
      row.organization_id === input.tenantId &&
      row.project_id === input.projectId &&
      row.customer_user_id === input.customerId &&
      row.created_by_user_id === input.customerId &&
      row.catalog_version === ALAKAZAM_CATALOG_VERSION &&
      row.terms_version === ALAKAZAM_TERMS_VERSION &&
      row.target_tier_id === input.targetTierId &&
      row.tax_state === input.taxMode &&
      row.provider_effects_authorized === true &&
      row.state !== "held" &&
      row.currency === "USD" &&
      row.provider_proration_enabled === false &&
      row.premium_configuration_policy ===
        "preserved_when_inactive",
    "idempotency_conflict",
    "the Alakazam quote ID was already used for another purpose",
    { status: 409 }
  );
  const currentSubscription = row.current_subscription_id
    ? {
        subscriptionId: row.current_subscription_id,
        tierId: row.current_tier_id,
        status: "active",
        revision: exactDatabaseInteger(
          row.current_subscription_revision,
          "quote.currentSubscriptionRevision"
        ),
        currentPeriodEndsAt: exactDatabaseIso(
          row.current_period_ends_at,
          "quote.currentPeriodEndsAt"
        ),
        cancelAtPeriodEnd: false,
        pendingChange: null
      }
    : null;
  const expectedCurrentAmountMinor = currentSubscription
    ? resolveAlakazamTier(currentSubscription.tierId)
        .price.amountMinor
    : null;
  const downloadCredit = row.download_entitlement_id
    ? {
        entitlementId: row.download_entitlement_id,
        state: "active",
        available: true,
        amountMinor: exactDatabaseInteger(
          row.applied_value_minor,
          "quote.appliedValueMinor"
        )
      }
    : null;
  const expected = quoteAlakazamChange({
    quoteId: row.id,
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    targetTierId: row.target_tier_id,
    currentSubscription,
    downloadCredit,
    issuedAt: exactDatabaseIso(
      row.issued_at,
      "quote.issuedAt"
    ),
    expiresAt: exactDatabaseIso(
      row.expires_at,
      "quote.expiresAt"
    ),
    providerEffectsAuthorized: true,
    taxMode: row.tax_state
  });
  const expectedEffectiveRule =
    expected.changeKind === "downgrade"
      ? "current_period_end"
      : "after_payment_and_provider_confirmation";
  const storedDisclosure = jsonObject(
    row.disclosure,
    "quote.disclosure"
  );
  invariant(
    row.change_kind === expected.changeKind &&
      row.current_subscription_id ===
        (expected.currentSubscriptionBinding
          ?.subscriptionId ?? null) &&
      Number(row.current_subscription_revision) ===
        (expected.currentSubscriptionBinding
          ?.revision ?? 0) &&
      row.current_tier_id ===
        (expected.currentSubscriptionBinding?.tierId ??
          null) &&
      (
        row.current_amount_minor === null ||
        row.current_amount_minor === undefined
          ? expected.currentSubscriptionBinding === null
          : exactDatabaseInteger(
              row.current_amount_minor,
              "quote.currentAmountMinor"
            ) === expectedCurrentAmountMinor
      ) &&
      exactDatabaseInteger(
        row.target_amount_minor,
        "quote.targetAmountMinor"
      ) === expected.targetTier.price.amountMinor &&
      row.applied_value_kind ===
        expected.appliedValue.kind &&
      exactDatabaseInteger(
        row.applied_value_minor,
        "quote.appliedValueMinor"
      ) === expected.appliedValue.amountMinor &&
      exactDatabaseInteger(
        row.due_now_subtotal_minor,
        "quote.dueNowSubtotalMinor"
      ) === expected.dueNow.subtotalMinor &&
      exactDatabaseInteger(
        row.next_renewal_amount_minor,
        "quote.nextRenewalAmountMinor"
      ) === expected.nextRenewal.amountMinor &&
      row.effective_rule === expectedEffectiveRule &&
      (
        expected.changeKind === "downgrade"
          ? exactDatabaseIso(
              row.effective_at,
              "quote.effectiveAt"
            ) === expected.effectiveAt
          : row.effective_at === null ||
            row.effective_at === undefined
      ) &&
      row.no_mid_period_refund ===
        expected.noMidPeriodRefundOrProration &&
      digest(storedDisclosure) ===
        expected.disclosureDigest &&
      row.disclosure_digest ===
        expected.disclosureDigest &&
      row.quote_digest === expected.quoteDigest,
    "repository_conflict",
    "the stored Alakazam quote failed its immutable digest projection",
    { status: 500 }
  );
  return expected;
}

function currentSubscription(row, pendingChange) {
  if (!row) return null;
  invariant(
    row.customer_user_id,
    "repository_conflict",
    "the current Alakazam subscription identity is invalid",
    { status: 500 }
  );
  const tierId = requiredText(
    row.tier_id,
    "currentSubscription.tierId",
    100
  );
  const status = requiredText(
    row.status,
    "currentSubscription.status",
    50
  );
  invariant(
    status === "active",
    "alakazam_change_unavailable",
    "resolve the current subscription payment state before changing tiers",
    { status: 409 }
  );
  invariant(
    exactDatabaseInteger(
      row.amount_minor,
      "currentSubscription.amountMinor"
    ) === resolveAlakazamTier(tierId).price.amountMinor,
    "repository_conflict",
    "the current Alakazam tier amount is invalid",
    { status: 500 }
  );
  return Object.freeze({
    subscriptionId: exactUuid(
      row.id,
      "currentSubscription.subscriptionId"
    ),
    tierId,
    status,
    revision: exactDatabaseInteger(
      row.revision,
      "currentSubscription.revision"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "currentSubscription.currentPeriodEndsAt"
    ),
    cancelAtPeriodEnd:
      row.cancel_at_period_end === true,
    pendingChange
  });
}

export function createPostgresAlakazamRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async createQuote(value) {
      const input = exactQuoteInput(value);
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId
          },
          async (client) => {
            const project = await client.query(
              `select project.id
                 from ss.projects project
                 join ss.organizations organization
                   on organization.id =
                      project.organization_id
                  and organization.state = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      project.organization_id
                  and membership.user_id = $2
                  and membership.state = 'active'
                  and membership.role = any($4::text[])
                where project.organization_id = $1
                  and project.id = $3
                  and project.lifecycle = 'active'
                for update of project`,
              [
                input.tenantId,
                input.customerId,
                input.projectId,
                PROJECT_ROLES
              ]
            );
            invariant(
              project.rowCount === 1,
              "project_unavailable",
              "the editor project is unavailable",
              { status: 404 }
            );

            const existing = await client.query(
              `select *
                 from ss.alakazam_change_quotes
                where organization_id = $1
                  and id = $2`,
              [input.tenantId, input.quoteId]
            );
            if (existing.rowCount === 1) {
              return projectStoredQuote(
                existing.rows[0],
                input
              );
            }
            invariant(
              existing.rowCount === 0,
              "repository_conflict",
              "the Alakazam quote repository returned duplicate identity",
              { status: 500 }
            );

            const subscriptions = await client.query(
              `select *
                 from ss.alakazam_subscriptions
                where organization_id = $1
                  and project_id = $2
                  and status <> 'ended'
                for update`,
              [input.tenantId, input.projectId]
            );
            invariant(
              subscriptions.rowCount <= 1,
              "repository_conflict",
              "the project has conflicting Alakazam subscriptions",
              { status: 500 }
            );
            const subscriptionRow =
              subscriptions.rows[0] ?? null;
            invariant(
              !subscriptionRow ||
                subscriptionRow.customer_user_id ===
                  input.customerId,
              "alakazam_change_unavailable",
              "the current Alakazam billing owner is unavailable",
              { status: 409 }
            );

            let pendingChange = null;
            if (subscriptionRow) {
              const schedules = await client.query(
                `select id, target_tier_id,
                        effective_at, state
                   from ss.alakazam_downgrade_schedules
                  where organization_id = $1
                    and subscription_id = $2
                    and state in (
                      'dispatching', 'scheduled',
                      'reconciliation_required'
                    )
                  for update`,
                [input.tenantId, subscriptionRow.id]
              );
              invariant(
                schedules.rowCount <= 1,
                "repository_conflict",
                "the subscription has conflicting tier changes",
                { status: 500 }
              );
              if (schedules.rowCount === 1) {
                pendingChange = {
                  scheduleId: schedules.rows[0].id,
                  targetTierId:
                    schedules.rows[0].target_tier_id,
                  effectiveAt: exactDatabaseIso(
                    schedules.rows[0].effective_at,
                    "pendingChange.effectiveAt"
                  ),
                  state: schedules.rows[0].state
                };
              }
            }

            let downloadCredit = null;
            if (!subscriptionRow) {
              const entitlements = await client.query(
                `select entitlement.id
                   from ss.commerce_v2_project_entitlements entitlement
                  where entitlement.organization_id = $1
                    and entitlement.project_id = $2
                    and entitlement.customer_user_id = $3
                    and entitlement.kind = 'spark_download'
                    and entitlement.scope = 'editor_project'
                    and entitlement.state = 'active'
                    and not exists (
                      select 1
                        from ss.alakazam_credit_applications application
                       where application.download_entitlement_id =
                             entitlement.id
                    )
                  order by entitlement.activated_at, entitlement.id
                  limit 2
                  for update of entitlement`,
                [
                  input.tenantId,
                  input.projectId,
                  input.customerId
                ]
              );
              invariant(
                entitlements.rowCount <= 1,
                "repository_conflict",
                "the project has conflicting Download credit authority",
                { status: 500 }
              );
              if (entitlements.rowCount === 1) {
                downloadCredit = {
                  entitlementId:
                    entitlements.rows[0].id,
                  state: "active",
                  available: true,
                  amountMinor: 500
                };
              }
            }

            const quote = quoteAlakazamChange({
              quoteId: input.quoteId,
              tenantId: input.tenantId,
              customerId: input.customerId,
              projectId: input.projectId,
              targetTierId: input.targetTierId,
              currentSubscription: currentSubscription(
                subscriptionRow,
                pendingChange
              ),
              downloadCredit,
              issuedAt: input.issuedAt,
              expiresAt: input.expiresAt,
              providerEffectsAuthorized: true,
              taxMode: input.taxMode
            });
            const current =
              quote.currentSubscriptionBinding;
            const currentAmountMinor = current
              ? resolveAlakazamTier(current.tierId)
                  .price.amountMinor
              : null;
            const effectiveRule =
              quote.changeKind === "downgrade"
                ? "current_period_end"
                : "after_payment_and_provider_confirmation";
            const inserted = await client.query(
              `insert into ss.alakazam_change_quotes (
                 id, organization_id, project_id,
                 customer_user_id, catalog_version,
                 terms_version, change_kind,
                 current_subscription_id,
                 current_subscription_revision,
                 current_tier_id, current_amount_minor,
                 current_period_ends_at, target_tier_id,
                 target_amount_minor, applied_value_kind,
                 applied_value_minor, download_entitlement_id,
                 due_now_subtotal_minor,
                 next_renewal_amount_minor, currency,
                 effective_rule, effective_at,
                 no_mid_period_refund,
                 provider_proration_enabled,
                 premium_configuration_policy, tax_state,
                 disclosure, disclosure_digest, quote_digest,
                 state, provider_effects_authorized,
                 issued_at, expires_at, created_by_user_id
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11, $12, $13, $14,
                 $15, $16, $17, $18, $14, 'USD',
                 $19, $20, $21, false,
                 'preserved_when_inactive', $22,
                 $23::jsonb, $24, $25,
                 'quoted', true, $26, $27, $4
               )
               returning *`,
              [
                quote.quoteId,
                quote.tenantId,
                quote.projectId,
                quote.customerId,
                quote.catalogVersion,
                quote.termsVersion,
                quote.changeKind,
                current?.subscriptionId ?? null,
                current?.revision ?? null,
                current?.tierId ?? null,
                currentAmountMinor,
                current?.currentPeriodEndsAt ?? null,
                quote.targetTier.tierId,
                quote.targetTier.price.amountMinor,
                quote.appliedValue.kind,
                quote.appliedValue.amountMinor,
                quote.appliedValue.kind ===
                "download_purchase"
                  ? quote.appliedValue.sourceId
                  : null,
                quote.dueNow.subtotalMinor,
                effectiveRule,
                quote.changeKind === "downgrade"
                  ? quote.effectiveAt
                  : null,
                quote.noMidPeriodRefundOrProration,
                quote.dueNow.taxState,
                JSON.stringify(quote.disclosure),
                quote.disclosureDigest,
                quote.quoteDigest,
                quote.issuedAt,
                quote.expiresAt
              ]
            );
            invariant(
              inserted.rowCount === 1,
              "repository_conflict",
              "the Alakazam quote was not committed durably",
              { status: 500 }
            );
            return projectStoredQuote(
              inserted.rows[0],
              input
            );
          }
        )
      );
    },

    async claimCustomerProvision(value) {
      const input = exactCustomerClaimInput(value);
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId
          },
          async (client) => {
            const organization = await client.query(
              `select organization.id
                 from ss.organizations organization
                where organization.id = $1
                  and organization.state = 'active'
                for update`,
              [input.tenantId]
            );
            invariant(
              organization.rowCount === 1,
              "project_unavailable",
              "the Alakazam organization is unavailable",
              { status: 404 }
            );

            const quote = await client.query(
              `select quote.*
                 from ss.alakazam_change_quotes quote
                 join ss.projects project
                   on project.organization_id =
                      quote.organization_id
                  and project.id = quote.project_id
                  and project.lifecycle = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      quote.organization_id
                  and membership.user_id =
                      quote.customer_user_id
                  and membership.state = 'active'
                  and membership.role = any($5::text[])
                where quote.organization_id = $1
                  and quote.id = $2
                  and quote.customer_user_id = $3
                  and quote.project_id = $4
                for update of quote`,
              [
                input.tenantId,
                input.quoteId,
                input.customerId,
                input.projectId,
                PROJECT_ROLES
              ]
            );
            const quoteRow = quote.rows[0];
            invariant(
              quote.rowCount === 1 &&
                ["start", "upgrade"].includes(
                  quoteRow.change_kind
                ) &&
                quoteRow.state === "quoted" &&
                quoteRow.provider_effects_authorized ===
                  true &&
                exactDatabaseInteger(
                  quoteRow.due_now_subtotal_minor,
                  "quote.dueNowSubtotalMinor"
                ) > 0 &&
                Date.parse(
                  exactDatabaseIso(
                    quoteRow.expires_at,
                    "quote.expiresAt"
                  )
                ) > Date.parse(input.claimedAt),
              "alakazam_change_unavailable",
              "the Alakazam payment quote is unavailable",
              { status: 409 }
            );

            const binding = await client.query(
              `select stripe_customer_id
                 from ss.stripe_customers
                where organization_id = $1
                for update`,
              [input.tenantId]
            );
            invariant(
              binding.rowCount <= 1,
              "repository_conflict",
              "the organization has conflicting Stripe Customers",
              { status: 500 }
            );
            if (binding.rowCount === 1) {
              return customerBinding(
                binding.rows[0].stripe_customer_id
              );
            }

            const existing = await client.query(
              `select *
                 from ss.alakazam_customer_provisions
                where organization_id = $1
                for update`,
              [input.tenantId]
            );
            invariant(
              existing.rowCount <= 1,
              "repository_conflict",
              "the organization has conflicting Customer reservations",
              { status: 500 }
            );
            if (existing.rowCount === 1) {
              const row = existing.rows[0];
              const reservation =
                storedCustomerProvision(row);
              if (row.state === "confirmed") {
                invariant(
                  false,
                  "repository_conflict",
                  "confirmed Customer evidence lacks its durable binding",
                  { status: 500 }
                );
              }
              if (
                row.state === "reconciliation_required"
              ) {
                return Object.freeze({
                  status: "reconciliation_required",
                  provider: "stripe",
                  provisionId: reservation.provisionId,
                  stripeCustomerId:
                    row.stripe_customer_id ?? null,
                  code: row.provider_error_code
                });
              }
              if (
                Date.parse(reservation.leaseExpiresAt) <=
                Date.parse(input.claimedAt)
              ) {
                const interrupted = await client.query(
                  `update ss.alakazam_customer_provisions
                      set state = 'reconciliation_required',
                          provider_effect_certainty = 'ambiguous',
                          provider_error_code =
                            'alakazam_customer_provision_interrupted'
                    where organization_id = $1
                      and id = $2
                      and state = 'reserved'
                    returning *`,
                  [input.tenantId, reservation.provisionId]
                );
                invariant(
                  interrupted.rowCount === 1,
                  "repository_conflict",
                  "the interrupted Customer reservation was not fenced",
                  { status: 500 }
                );
                return Object.freeze({
                  status: "reconciliation_required",
                  provider: "stripe",
                  provisionId: reservation.provisionId,
                  stripeCustomerId: null,
                  code:
                    "alakazam_customer_provision_interrupted"
                });
              }
              return Object.freeze({
                status: "pending",
                provider: "stripe",
                provisionId: reservation.provisionId,
                leaseExpiresAt:
                  reservation.leaseExpiresAt
              });
            }

            invariant(
              quoteRow.change_kind === "start",
              "alakazam_change_unavailable",
              "a missing Stripe Customer can only be created for the first Alakazam subscription",
              { status: 409 }
            );
            const reservation =
              createAlakazamCustomerProvision({
                tenantId: input.tenantId,
                customerId: input.customerId,
                projectId: input.projectId,
                quoteId: input.quoteId,
                provisionId: input.provisionId,
                acceptedDisclosureDigest:
                  quoteRow.disclosure_digest,
                quoteDigest: quoteRow.quote_digest,
                claimedAt: input.claimedAt
              });
            const inserted = await client.query(
              `insert into ss.alakazam_customer_provisions (
                 id, organization_id, project_id,
                 customer_user_id, quote_id, provider,
                 provider_idempotency_key, purpose,
                 purpose_digest,
                 accepted_disclosure_digest,
                 quote_digest, state,
                 provider_effect_certainty,
                 lease_expires_at, created_at, updated_at
               ) values (
                 $1, $2, $3, $4, $5, 'stripe',
                 $6, $7::jsonb, $8, $9, $10,
                 'reserved', 'not_submitted',
                 $11, $12, $12
               )
               returning *`,
              [
                reservation.provisionId,
                reservation.tenantId,
                reservation.projectId,
                reservation.customerId,
                reservation.quoteId,
                reservation.idempotencyKey,
                JSON.stringify(reservation.purpose),
                reservation.purposeDigest,
                reservation.purpose
                  .acceptedDisclosureDigest,
                reservation.purpose.quoteDigest,
                reservation.leaseExpiresAt,
                reservation.claimedAt
              ]
            );
            invariant(
              inserted.rowCount === 1,
              "repository_conflict",
              "the Alakazam Customer reservation was not committed",
              { status: 500 }
            );
            const stored = storedCustomerProvision(
              inserted.rows[0]
            );
            invariant(
              stored.purposeDigest ===
                reservation.purposeDigest,
              "repository_conflict",
              "the Alakazam Customer reservation changed during commit",
              { status: 500 }
            );
            return Object.freeze({
              status: "create",
              provider: "stripe",
              provision: stored
            });
          }
        )
      );
    },

    async confirmCustomerProvision(value) {
      const reference = exactCustomerReference(value, [
        "confirmedAt",
        "providerFacts"
      ]);
      const confirmedAt = requiredIso(
        value.confirmedAt,
        "confirmedAt"
      );
      const evidence = exactCustomerProviderFacts(
        value.providerFacts,
        reference
      );
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const selected = await client.query(
              `select *
                 from ss.alakazam_customer_provisions
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.provisionId]
            );
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the Alakazam Customer reservation is unavailable",
              { status: 409 }
            );
            const row = selected.rows[0];
            exactProvisionRowIdentity(row, reference);

            const binding = await client.query(
              `select stripe_customer_id
                 from ss.stripe_customers
                where organization_id = $1
                for update`,
              [reference.tenantId]
            );
            invariant(
              binding.rowCount <= 1,
              "repository_conflict",
              "the organization has conflicting Stripe Customers",
              { status: 500 }
            );
            if (row.state === "confirmed") {
              const storedEvidence =
                exactCustomerProviderFacts(
                  jsonObject(
                    row.provider_facts,
                    "customerProvision.providerFacts"
                  ),
                  reference
                );
              invariant(
                storedEvidence.providerFactsDigest ===
                  evidence.providerFactsDigest &&
                  binding.rowCount === 1 &&
                  binding.rows[0].stripe_customer_id ===
                    evidence.stripeCustomerId,
                "idempotency_conflict",
                "the confirmed Customer evidence changed",
                { status: 409 }
              );
              return customerBinding(
                evidence.stripeCustomerId,
                reference.provisionId
              );
            }
            invariant(
              row.state === "reserved" ||
                row.state ===
                  "reconciliation_required",
              "repository_conflict",
              "the Customer reservation cannot be confirmed",
              { status: 409 }
            );
            if (binding.rowCount === 0) {
              await client.query(
                `insert into ss.stripe_customers (
                   organization_id,
                   stripe_customer_id,
                   created_from_receipt_id
                 ) values ($1, $2, null)`,
                [
                  reference.tenantId,
                  evidence.stripeCustomerId
                ]
              );
            } else {
              invariant(
                binding.rows[0].stripe_customer_id ===
                  evidence.stripeCustomerId,
                "stripe_customer_binding_invalid",
                "the Stripe Customer does not match this organization",
                { status: 409 }
              );
            }
            const updated = await client.query(
              `update ss.alakazam_customer_provisions
                  set state = 'confirmed',
                      stripe_customer_id = $3,
                      provider_facts = $4::jsonb,
                      provider_facts_digest = $5,
                      provider_created_at = $6,
                      provider_effect_certainty = 'confirmed',
                      provider_error_code = null,
                      confirmed_at = $7
                where organization_id = $1
                  and id = $2
                returning *`,
              [
                reference.tenantId,
                reference.provisionId,
                evidence.stripeCustomerId,
                JSON.stringify(evidence.facts),
                evidence.providerFactsDigest,
                evidence.providerCreatedAt,
                confirmedAt
              ]
            );
            invariant(
              updated.rowCount === 1 &&
                updated.rows[0].state === "confirmed",
              "repository_conflict",
              "the Stripe Customer binding was not committed",
              { status: 500 }
            );
            return customerBinding(
              evidence.stripeCustomerId,
              reference.provisionId
            );
          }
        )
      );
    },

    async markCustomerProvisionAmbiguous(value) {
      const reference = exactCustomerReference(value, [
        "errorCode",
        "stripeCustomerId"
      ]);
      const errorCode = requiredText(
        value.errorCode,
        "errorCode",
        200
      );
      const stripeCustomerId =
        value.stripeCustomerId === null
          ? null
          : requiredText(
              value.stripeCustomerId,
              "stripeCustomerId",
              255
            );
      invariant(
        stripeCustomerId === null ||
          STRIPE_CUSTOMER_ID.test(stripeCustomerId),
        "invalid_input",
        "stripeCustomerId is invalid"
      );
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const selected = await client.query(
              `select *
                 from ss.alakazam_customer_provisions
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.provisionId]
            );
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the Alakazam Customer reservation is unavailable",
              { status: 409 }
            );
            const row = selected.rows[0];
            exactProvisionRowIdentity(row, reference);
            if (row.state === "confirmed") {
              return customerBinding(
                row.stripe_customer_id,
                reference.provisionId
              );
            }
            if (row.state === "reconciliation_required") {
              invariant(
                row.stripe_customer_id ===
                  stripeCustomerId &&
                  row.provider_error_code === errorCode,
                "idempotency_conflict",
                "the ambiguous Customer evidence changed",
                { status: 409 }
              );
              return Object.freeze({
                status: "reconciliation_required",
                provider: "stripe",
                provisionId: reference.provisionId,
                stripeCustomerId,
                code: errorCode
              });
            }
            invariant(
              row.state === "reserved",
              "repository_conflict",
              "the Customer reservation cannot be reconciled",
              { status: 409 }
            );
            const updated = await client.query(
              `update ss.alakazam_customer_provisions
                  set state = 'reconciliation_required',
                      stripe_customer_id = $3,
                      provider_effect_certainty = 'ambiguous',
                      provider_error_code = $4
                where organization_id = $1
                  and id = $2
                returning *`,
              [
                reference.tenantId,
                reference.provisionId,
                stripeCustomerId,
                errorCode
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the ambiguous Customer effect was not fenced",
              { status: 500 }
            );
            return Object.freeze({
              status: "reconciliation_required",
              provider: "stripe",
              provisionId: reference.provisionId,
              stripeCustomerId,
              code: errorCode
            });
          }
        )
      );
    },

    async releaseCustomerProvision(value) {
      const reference = exactCustomerReference(value);
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const selected = await client.query(
              `select *
                 from ss.alakazam_customer_provisions
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.provisionId]
            );
            if (selected.rowCount === 0) {
              return Object.freeze({ status: "released" });
            }
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the organization has conflicting Customer reservations",
              { status: 500 }
            );
            const row = selected.rows[0];
            exactProvisionRowIdentity(row, reference);
            invariant(
              row.state === "reserved" &&
                row.provider_effect_certainty ===
                  "not_submitted",
              "alakazam_customer_reconciliation_required",
              "the Customer reservation may have reached Stripe",
              { status: 409 }
            );
            const removed = await client.query(
              `delete from ss.alakazam_customer_provisions
                where organization_id = $1
                  and id = $2
                  and state = 'reserved'`,
              [reference.tenantId, reference.provisionId]
            );
            invariant(
              removed.rowCount === 1,
              "repository_conflict",
              "the unused Customer reservation was not released",
              { status: 500 }
            );
            return Object.freeze({ status: "released" });
          }
        )
      );
    },

    async findCheckoutDispatchBySession(value) {
      const input = exactCheckoutSessionInput(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await client.query(
            `select *
               from ss.alakazam_checkout_dispatches
              where stripe_checkout_session_id = $1
                and state in ('ready', 'settled')
              for update`,
            [input.checkoutSessionId]
          );
          invariant(
            selected.rowCount === 1,
            "stripe_event_binding_invalid",
            "the Stripe event has no durable Alakazam Checkout",
            { status: 400 }
          );
          const row = selected.rows[0];
          const reservation = storedCheckoutDispatch(row);
          const ready = checkoutReady(row, reservation);
          return Object.freeze({
            status: row.state,
            provider: "stripe",
            reservation,
            checkout: ready.checkout,
            ...(row.state === "settled"
              ? {
                  settlement:
                    await storedPaymentSettlement(
                      client,
                      reservation
                    )
                }
              : {})
          });
        })
      );
    },

    async claimCheckoutDispatch(value) {
      const input = exactCheckoutClaimInput(value);
      return translated(() =>
        database.service(
          {
            userId: input.customerId,
            organizationId: input.tenantId
          },
          async (client) => {
            const quote = await client.query(
              `select quote.*
                 from ss.alakazam_change_quotes quote
                 join ss.projects project
                   on project.organization_id =
                      quote.organization_id
                  and project.id = quote.project_id
                  and project.lifecycle = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      quote.organization_id
                  and membership.user_id =
                      quote.customer_user_id
                  and membership.state = 'active'
                  and membership.role = any($5::text[])
                where quote.organization_id = $1
                  and quote.id = $2
                  and quote.customer_user_id = $3
                  and quote.project_id = $4
                for update of project, quote`,
              [
                input.tenantId,
                input.quoteId,
                input.customerId,
                input.projectId,
                PROJECT_ROLES
              ]
            );
            invariant(
              quote.rowCount === 1,
              "alakazam_change_unavailable",
              "the Alakazam payment quote is unavailable",
              { status: 409 }
            );
            const quoteRow = quote.rows[0];

            const binding = await client.query(
              `select stripe_customer_id
                 from ss.stripe_customers
                where organization_id = $1
                for update`,
              [input.tenantId]
            );
            invariant(
              binding.rowCount === 1 &&
                binding.rows[0].stripe_customer_id ===
                  input.stripeCustomerId,
              "stripe_customer_binding_invalid",
              "the Stripe Customer does not match this organization",
              { status: 409 }
            );

            const existing = await client.query(
              `select *
                 from ss.alakazam_checkout_dispatches
                where organization_id = $1
                  and (id = $2 or quote_id = $3)
                for update`,
              [
                input.tenantId,
                input.dispatchId,
                input.quoteId
              ]
            );
            invariant(
              existing.rowCount <= 1,
              "idempotency_conflict",
              "the Alakazam Checkout identity conflicts",
              { status: 409 }
            );
            if (existing.rowCount === 1) {
              const row = existing.rows[0];
              const reservation = storedCheckoutDispatch(row);
              invariant(
                reservation.tenantId === input.tenantId &&
                  reservation.customerId ===
                    input.customerId &&
                  reservation.projectId === input.projectId &&
                  reservation.quoteId === input.quoteId &&
                  reservation.stripeCustomerId ===
                    input.stripeCustomerId,
                "idempotency_conflict",
                "the Alakazam Checkout identity changed",
                { status: 409 }
              );
              if (row.state === "ready") {
                const ready = checkoutReady(row, reservation);
                if (
                  Date.parse(ready.checkout.expiresAt) <=
                  Date.parse(input.claimedAt)
                ) {
                  return Object.freeze({
                    status: "reconcile_expiry",
                    provider: "stripe",
                    dispatchId: reservation.dispatchId,
                    quoteId: reservation.quoteId,
                    projectId: reservation.projectId,
                    purposeDigest:
                      reservation.purposeDigest,
                    checkout: ready.checkout
                  });
                }
                return ready;
              }
              if (row.state === "settled") {
                return checkoutReady(row, reservation);
              }
              if (row.state === "reserved") {
                if (
                  Date.parse(reservation.leaseExpiresAt) >
                  Date.parse(input.claimedAt)
                ) {
                  return Object.freeze({
                    status: "pending",
                    provider: "stripe",
                    dispatchId: reservation.dispatchId,
                    leaseExpiresAt:
                      reservation.leaseExpiresAt
                  });
                }
                const interrupted = await client.query(
                  `update ss.alakazam_checkout_dispatches
                      set state = 'persistence_unknown',
                          provider_effect_certainty = 'ambiguous',
                          provider_error_code =
                            'alakazam_checkout_dispatch_interrupted'
                    where organization_id = $1
                      and id = $2
                      and state = 'reserved'
                    returning *`,
                  [input.tenantId, reservation.dispatchId]
                );
                invariant(
                  interrupted.rowCount === 1,
                  "repository_conflict",
                  "the interrupted Checkout was not fenced",
                  { status: 500 }
                );
                const quoteUpdate = await client.query(
                  `update ss.alakazam_change_quotes
                      set state = 'reconciliation_required'
                    where organization_id = $1
                      and id = $2
                      and state = 'checkout_dispatching'`,
                  [input.tenantId, reservation.quoteId]
                );
                invariant(
                  quoteUpdate.rowCount === 1,
                  "repository_conflict",
                  "the interrupted Checkout quote was not fenced",
                  { status: 500 }
                );
                return Object.freeze({
                  status: "reconciliation_required",
                  provider: "stripe",
                  dispatchId: reservation.dispatchId,
                  purposeDigest: reservation.purposeDigest,
                  code:
                    "alakazam_checkout_dispatch_interrupted"
                });
              }
              if (row.state === "persistence_unknown") {
                return Object.freeze({
                  status: "reconciliation_required",
                  provider: "stripe",
                  dispatchId: reservation.dispatchId,
                  purposeDigest: reservation.purposeDigest,
                  code: row.provider_error_code
                });
              }
              return Object.freeze({
                status: row.state,
                provider: "stripe",
                dispatchId: reservation.dispatchId,
                purposeDigest: reservation.purposeDigest
              });
            }

            const open = await client.query(
              `select id, state
                 from ss.alakazam_checkout_dispatches
                where organization_id = $1
                  and project_id = $2
                  and state in (
                    'reserved',
                    'ready',
                    'persistence_unknown'
                  )
                for update`,
              [input.tenantId, input.projectId]
            );
            invariant(
              open.rowCount === 0,
              "alakazam_change_pending",
              "finish or reconcile the existing Alakazam Checkout first",
              { status: 409 }
            );
            invariant(
              ["start", "upgrade"].includes(
                quoteRow.change_kind
              ) &&
                quoteRow.state === "quoted" &&
                quoteRow.provider_effects_authorized ===
                  true &&
                exactDatabaseInteger(
                  quoteRow.due_now_subtotal_minor,
                  "quote.dueNowSubtotalMinor"
                ) > 0 &&
                Date.parse(
                  exactDatabaseIso(
                    quoteRow.expires_at,
                    "quote.expiresAt"
                  )
                ) > Date.parse(input.claimedAt),
              "alakazam_change_unavailable",
              "the Alakazam payment quote is unavailable",
              { status: 409 }
            );

            let currentSubscription = null;
            let downloadCredit = null;
            if (quoteRow.change_kind === "upgrade") {
              const current = await client.query(
                `select *
                   from ss.alakazam_subscriptions
                  where organization_id = $1
                    and id = $2
                  for update`,
                [
                  input.tenantId,
                  quoteRow.current_subscription_id
                ]
              );
              const row = current.rows[0];
              invariant(
                current.rowCount === 1 &&
                  row.project_id === input.projectId &&
                  row.customer_user_id === input.customerId &&
                  row.status === "active" &&
                  Number(row.revision) ===
                    Number(
                      quoteRow.current_subscription_revision
                    ) &&
                  row.tier_id === quoteRow.current_tier_id &&
                  Number(row.amount_minor) ===
                    Number(quoteRow.current_amount_minor) &&
                  exactDatabaseIso(
                    row.current_period_ends_at,
                    "subscription.currentPeriodEndsAt"
                  ) ===
                    exactDatabaseIso(
                      quoteRow.current_period_ends_at,
                      "quote.currentPeriodEndsAt"
                    ) &&
                  row.cancel_at_period_end === false,
                "alakazam_change_unavailable",
                "the Alakazam upgrade subscription is stale",
                { status: 409 }
              );
              currentSubscription = {
                localSubscriptionId: row.id,
                revision: exactDatabaseInteger(
                  row.revision,
                  "subscription.revision"
                ),
                tierId: row.tier_id,
                amountMinor: exactDatabaseInteger(
                  row.amount_minor,
                  "subscription.amountMinor"
                ),
                stripeSubscriptionId:
                  row.stripe_subscription_id,
                stripeSubscriptionItemId:
                  row.stripe_subscription_item_id,
                stripePriceId: row.stripe_price_id,
                currentPeriodStartsAt: exactDatabaseIso(
                  row.current_period_starts_at,
                  "subscription.currentPeriodStartsAt"
                ),
                currentPeriodEndsAt: exactDatabaseIso(
                  row.current_period_ends_at,
                  "subscription.currentPeriodEndsAt"
                ),
                providerFactsDigest:
                  row.provider_facts_digest
              };
            } else if (
              quoteRow.applied_value_kind ===
                "download_purchase"
            ) {
              downloadCredit = {
                entitlementId:
                  quoteRow.download_entitlement_id,
                amountMinor: 500
              };
            }

            const reservation =
              createAlakazamCheckoutDispatch({
                dispatchId: input.dispatchId,
                tenantId: input.tenantId,
                customerId: input.customerId,
                projectId: input.projectId,
                quoteId: input.quoteId,
                stripeCustomerId:
                  input.stripeCustomerId,
                acceptedDisclosureDigest:
                  quoteRow.disclosure_digest,
                quoteDigest: quoteRow.quote_digest,
                changeKind: quoteRow.change_kind,
                currentSubscription,
                targetTierId: quoteRow.target_tier_id,
                dueNowSubtotalMinor:
                  exactDatabaseInteger(
                    quoteRow.due_now_subtotal_minor,
                    "quote.dueNowSubtotalMinor"
                  ),
                taxMode: quoteRow.tax_state,
                downloadCredit,
                claimedAt: input.claimedAt
              });
            const moved = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'checkout_dispatching'
                where organization_id = $1
                  and id = $2
                  and state = 'quoted'`,
              [input.tenantId, input.quoteId]
            );
            invariant(
              moved.rowCount === 1,
              "repository_conflict",
              "the Alakazam quote was not reserved for Checkout",
              { status: 500 }
            );
            const inserted = await client.query(
              `insert into ss.alakazam_checkout_dispatches (
                 id, organization_id, project_id,
                 customer_user_id, quote_id, mode,
                 provider, stripe_customer_id,
                 provider_idempotency_key,
                 purpose_digest, purpose,
                 expected_subtotal_minor,
                 expected_credit_minor, currency,
                 state, provider_effect_certainty,
                 lease_expires_at, created_at, updated_at
               ) values (
                 $1, $2, $3, $4, $5, $6,
                 'stripe', $7, $8, $9, $10::jsonb,
                 $11, $12, 'USD',
                 'reserved', 'not_submitted',
                 $13, $14, $14
               )
               returning *`,
              [
                reservation.dispatchId,
                reservation.tenantId,
                reservation.projectId,
                reservation.customerId,
                reservation.quoteId,
                reservation.mode,
                reservation.stripeCustomerId,
                reservation.idempotencyKey,
                reservation.purposeDigest,
                JSON.stringify(reservation.purpose),
                reservation.expectedSubtotalMinor,
                reservation.expectedCreditMinor,
                reservation.leaseExpiresAt,
                reservation.claimedAt
              ]
            );
            invariant(
              inserted.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout reservation was not committed",
              { status: 500 }
            );
            return Object.freeze({
              status: "create",
              provider: "stripe",
              dispatch: storedCheckoutDispatch(
                inserted.rows[0]
              )
            });
          }
        )
      );
    },

    async confirmCheckoutDispatch(value) {
      const reference = exactCheckoutReference(value, [
        "dispatchedAt",
        "providerResult"
      ]);
      const dispatchedAt = requiredIso(
        value.dispatchedAt,
        "dispatchedAt"
      );
      const providerResult = exactCheckoutProviderResult(
        value.providerResult
      );
      invariant(
        Date.parse(providerResult.expiresAt) >
          Date.parse(dispatchedAt),
        "repository_conflict",
        "the Stripe Checkout expiry is invalid",
        { status: 500 }
      );
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const quote = await client.query(
              `select state
                 from ss.alakazam_change_quotes
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              quote.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout quote is unavailable",
              { status: 409 }
            );
            const selected = await client.query(
              `select *
                 from ss.alakazam_checkout_dispatches
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.dispatchId]
            );
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout reservation is unavailable",
              { status: 409 }
            );
            const row = selected.rows[0];
            const reservation = exactCheckoutRowIdentity(
              row,
              reference
            );
            if (
              row.state === "ready" ||
              row.state === "settled"
            ) {
              const ready = checkoutReady(row, reservation);
              invariant(
                ready.checkout.checkoutId ===
                  providerResult.checkoutId &&
                  ready.checkout.url === providerResult.url &&
                  ready.checkout.expiresAt ===
                    providerResult.expiresAt,
                "idempotency_conflict",
                "the confirmed Checkout provider result changed",
                { status: 409 }
              );
              return ready;
            }
            invariant(
              row.state === "reserved" ||
                row.state === "persistence_unknown",
              "repository_conflict",
              "the Alakazam Checkout cannot be confirmed",
              { status: 409 }
            );
            const updated = await client.query(
              `update ss.alakazam_checkout_dispatches
                  set state = 'ready',
                      stripe_checkout_session_id = $3,
                      provider_checkout_url = $4,
                      provider_expires_at = $5,
                      dispatched_at = $6,
                      provider_effect_certainty = 'confirmed',
                      provider_error_code = null
                where organization_id = $1
                  and id = $2
                returning *`,
              [
                reference.tenantId,
                reference.dispatchId,
                providerResult.checkoutId,
                providerResult.url,
                providerResult.expiresAt,
                dispatchedAt
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the Stripe Checkout result was not committed",
              { status: 500 }
            );
            const moved = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'checkout_ready'
                where organization_id = $1
                  and id = $2
                  and state in (
                    'checkout_dispatching',
                    'reconciliation_required'
                  )`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              moved.rowCount === 1,
              "repository_conflict",
              "the Alakazam quote did not confirm Checkout",
              { status: 500 }
            );
            return checkoutReady(
              updated.rows[0],
              reservation
            );
          }
        )
      );
    },

    async markCheckoutDispatchUnknown(value) {
      const reference = exactCheckoutReference(value, [
        "errorCode"
      ]);
      const errorCode = requiredText(
        value.errorCode,
        "errorCode",
        200
      );
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const quote = await client.query(
              `select state
                 from ss.alakazam_change_quotes
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              quote.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout quote is unavailable",
              { status: 409 }
            );
            const selected = await client.query(
              `select *
                 from ss.alakazam_checkout_dispatches
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.dispatchId]
            );
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout reservation is unavailable",
              { status: 409 }
            );
            const row = selected.rows[0];
            const reservation = exactCheckoutRowIdentity(
              row,
              reference
            );
            if (
              row.state === "ready" ||
              row.state === "settled"
            ) {
              return checkoutReady(row, reservation);
            }
            if (row.state === "persistence_unknown") {
              return Object.freeze({
                status: "reconciliation_required",
                provider: "stripe",
                dispatchId: reservation.dispatchId,
                purposeDigest: reservation.purposeDigest,
                code: row.provider_error_code
              });
            }
            invariant(
              row.state === "reserved",
              "repository_conflict",
              "the Alakazam Checkout cannot enter reconciliation",
              { status: 409 }
            );
            const updated = await client.query(
              `update ss.alakazam_checkout_dispatches
                  set state = 'persistence_unknown',
                      provider_effect_certainty = 'ambiguous',
                      provider_error_code = $3
                where organization_id = $1
                  and id = $2
                returning id`,
              [
                reference.tenantId,
                reference.dispatchId,
                errorCode
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the ambiguous Checkout effect was not fenced",
              { status: 500 }
            );
            const moved = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'reconciliation_required'
                where organization_id = $1
                  and id = $2
                  and state = 'checkout_dispatching'`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              moved.rowCount === 1,
              "repository_conflict",
              "the ambiguous Checkout quote was not fenced",
              { status: 500 }
            );
            return Object.freeze({
              status: "reconciliation_required",
              provider: "stripe",
              dispatchId: reservation.dispatchId,
              purposeDigest: reservation.purposeDigest,
              code: errorCode
            });
          }
        )
      );
    },

    async failCheckoutDispatch(value) {
      const reference = exactCheckoutReference(value, [
        "errorCode"
      ]);
      const errorCode = requiredText(
        value.errorCode,
        "errorCode",
        200
      );
      return translated(() =>
        database.service(
          {
            userId: reference.customerId,
            organizationId: reference.tenantId
          },
          async (client) => {
            const quote = await client.query(
              `select state
                 from ss.alakazam_change_quotes
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              quote.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout quote is unavailable",
              { status: 409 }
            );
            const selected = await client.query(
              `select *
                 from ss.alakazam_checkout_dispatches
                where organization_id = $1
                  and id = $2
                for update`,
              [reference.tenantId, reference.dispatchId]
            );
            invariant(
              selected.rowCount === 1,
              "repository_conflict",
              "the Alakazam Checkout reservation is unavailable",
              { status: 409 }
            );
            const row = selected.rows[0];
            const reservation = exactCheckoutRowIdentity(
              row,
              reference
            );
            if (
              row.state === "ready" ||
              row.state === "settled"
            ) {
              return checkoutReady(row, reservation);
            }
            if (row.state === "failed") {
              return Object.freeze({
                status: "failed",
                provider: "stripe",
                dispatchId: reservation.dispatchId,
                purposeDigest: reservation.purposeDigest,
                code: row.provider_error_code
              });
            }
            invariant(
              row.state === "reserved" &&
                row.provider_effect_certainty ===
                  "not_submitted",
              "alakazam_checkout_reconciliation_required",
              "the Checkout reservation may have reached Stripe",
              { status: 409 }
            );
            const updated = await client.query(
              `update ss.alakazam_checkout_dispatches
                  set state = 'failed',
                      provider_effect_certainty = 'not_submitted',
                      provider_error_code = $3
                where organization_id = $1
                  and id = $2
                returning id`,
              [
                reference.tenantId,
                reference.dispatchId,
                errorCode
              ]
            );
            invariant(
              updated.rowCount === 1,
              "repository_conflict",
              "the unused Checkout reservation was not failed",
              { status: 500 }
            );
            const moved = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'failed'
                where organization_id = $1
                  and id = $2
                  and state = 'checkout_dispatching'`,
              [reference.tenantId, reference.quoteId]
            );
            invariant(
              moved.rowCount === 1,
              "repository_conflict",
              "the unused Checkout quote was not failed",
              { status: 500 }
            );
            return Object.freeze({
              status: "failed",
              provider: "stripe",
              dispatchId: reservation.dispatchId,
              purposeDigest: reservation.purposeDigest,
              code: errorCode
            });
          }
        )
      );
    },

    async settleCheckoutPayment(value) {
      const reservation =
        exactCheckoutReservationValue(
          value?.reservation
        );
      const input = exactSettlementIds(
        value,
        reservation
      );
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await client.query(
            `select dispatch.*,
                    quote.state as quote_state,
                    quote.change_kind as quote_change_kind
               from ss.alakazam_checkout_dispatches dispatch
               join ss.alakazam_change_quotes quote
                 on quote.organization_id =
                    dispatch.organization_id
                and quote.id = dispatch.quote_id
              where dispatch.organization_id = $1
                and dispatch.id = $2
              for update of dispatch, quote`,
            [reservation.tenantId, reservation.dispatchId]
          );
          invariant(
            selected.rowCount === 1,
            "stripe_event_binding_invalid",
            "the Alakazam Checkout is unavailable for settlement",
            { status: 409 }
          );
          const row = selected.rows[0];
          const storedReservation =
            exactCheckoutRowIdentity(row, {
              tenantId: reservation.tenantId,
              customerId: reservation.customerId,
              projectId: reservation.projectId,
              quoteId: reservation.quoteId,
              dispatchId: reservation.dispatchId,
              purposeDigest: reservation.purposeDigest
            });
          invariant(
            digest(storedReservation) ===
              digest(reservation) &&
              row.stripe_checkout_session_id ===
                input.checkout.checkoutId &&
              exactDatabaseIso(
                row.provider_expires_at,
                "checkout.providerExpiresAt"
              ) === input.checkout.expiresAt &&
              exactStripeCheckoutUrl(
                row.provider_checkout_url
              ) === input.checkout.url &&
              row.quote_change_kind ===
                reservation.purpose.changeKind,
            "stripe_event_binding_invalid",
            "the Alakazam Checkout payment binding changed",
            { status: 409 }
          );
          if (row.state === "settled") {
            return storedPaymentSettlement(
              client,
              reservation,
              input.payment.providerFactsDigest
            );
          }
          invariant(
            row.state === "ready" &&
              row.quote_state === "checkout_ready",
            "stripe_event_binding_invalid",
            "the Alakazam Checkout is not ready to settle",
            { status: 409 }
          );

          const existingEvent = await client.query(
            `select *
               from ss.alakazam_stripe_events
              where stripe_event_id = $1
                 or (
                   provider_object_id = $2
                   and event_type = $3
                 )
              for update`,
            [
              input.event.stripeEventId,
              input.checkout.checkoutId,
              input.event.eventType
            ]
          );
          invariant(
            existingEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam payment event was already used for different evidence",
            { status: 409 }
          );

          const customer = await client.query(
            `select id, stripe_customer_id
               from ss.stripe_customers
              where organization_id = $1
              for update`,
            [reservation.tenantId]
          );
          invariant(
            customer.rowCount === 1 &&
              customer.rows[0].stripe_customer_id ===
                reservation.stripeCustomerId,
            "stripe_customer_binding_invalid",
            "the Alakazam payment Customer binding changed",
            { status: 409 }
          );

          if (reservation.purpose.changeKind === "start") {
            const subscription = input.payment.subscription;
            const insertedSubscription = await client.query(
              `insert into ss.alakazam_subscriptions (
                 id, organization_id, project_id,
                 customer_user_id, stripe_customer_row_id,
                 stripe_subscription_id,
                 stripe_subscription_item_id,
                 stripe_price_id, initial_quote_id,
                 activation_receipt_id, tier_id, status,
                 currency, amount_minor,
                 current_period_starts_at,
                 current_period_ends_at,
                 cancel_at_period_end,
                 provider_observed_at,
                 provider_facts_digest
               ) values (
                 $1, $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 null, $10, 'pending', 'USD', $11,
                 null, null, false, $12, $13
               )
               returning id`,
              [
                input.subscriptionId,
                reservation.tenantId,
                reservation.projectId,
                reservation.customerId,
                customer.rows[0].id,
                subscription.stripeSubscriptionId,
                subscription.stripeSubscriptionItemId,
                subscription.stripePriceId,
                reservation.quoteId,
                subscription.tierId,
                subscription.amountMinor,
                subscription.providerObservedAt,
                subscription.providerFactsDigest
              ]
            );
            invariant(
              insertedSubscription.rowCount === 1,
              "repository_conflict",
              "the pending Alakazam subscription was not created",
              { status: 500 }
            );
          } else {
            const current =
              reservation.purpose.currentSubscription;
            const subscription = await client.query(
              `select *
                 from ss.alakazam_subscriptions
                where organization_id = $1
                  and id = $2
                for update`,
              [reservation.tenantId, input.subscriptionId]
            );
            const currentRow = subscription.rows[0];
            invariant(
              subscription.rowCount === 1 &&
                currentRow.project_id ===
                  reservation.projectId &&
                currentRow.customer_user_id ===
                  reservation.customerId &&
                currentRow.stripe_customer_row_id ===
                  customer.rows[0].id &&
                currentRow.status === "active" &&
                exactDatabaseInteger(
                  currentRow.revision,
                  "subscription.revision"
                ) === current.revision &&
                currentRow.tier_id === current.tierId &&
                exactDatabaseInteger(
                  currentRow.amount_minor,
                  "subscription.amountMinor"
                ) === current.amountMinor &&
                currentRow.stripe_subscription_id ===
                  current.stripeSubscriptionId &&
                currentRow.stripe_subscription_item_id ===
                  current.stripeSubscriptionItemId &&
                currentRow.stripe_price_id ===
                  current.stripePriceId &&
                exactDatabaseIso(
                  currentRow.current_period_starts_at,
                  "subscription.currentPeriodStartsAt"
                ) === current.currentPeriodStartsAt &&
                exactDatabaseIso(
                  currentRow.current_period_ends_at,
                  "subscription.currentPeriodEndsAt"
                ) === current.currentPeriodEndsAt &&
                currentRow.provider_facts_digest ===
                  current.providerFactsDigest &&
                currentRow.cancel_at_period_end === false,
              "alakazam_change_unavailable",
              "the Alakazam upgrade subscription changed before settlement",
              { status: 409 }
            );
          }

          const eventFacts = {
            schema: ALAKAZAM_EVENT_FACTS_SCHEMA,
            provider: "stripe",
            stripeEventId: input.event.stripeEventId,
            eventType: input.event.eventType,
            checkoutSessionId: input.checkout.checkoutId,
            purposeDigest: reservation.purposeDigest,
            payloadDigest: input.event.payloadDigest,
            metadata: input.event.metadata
          };
          const insertedEvent = await client.query(
            `insert into ss.alakazam_stripe_events (
               id, organization_id, project_id,
               quote_id, subscription_id,
               stripe_event_id, event_type,
               livemode, api_version,
               provider_object_id, payload_digest,
               facts, state, attempt_count,
               signature_verified_at, occurred_at
             ) values (
               $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11,
               $12::jsonb, 'received', 0, $13, $14
             )
             returning id`,
            [
              input.eventRowId,
              reservation.tenantId,
              reservation.projectId,
              reservation.quoteId,
              input.subscriptionId,
              input.event.stripeEventId,
              input.event.eventType,
              input.event.livemode,
              input.event.apiVersion,
              input.checkout.checkoutId,
              input.event.payloadDigest,
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            insertedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment event was not recorded",
            { status: 500 }
          );
          const claimedEvent = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1
                and id = $2
                and state = 'received'
              returning id`,
            [reservation.tenantId, input.eventRowId]
          );
          invariant(
            claimedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment event was not claimed",
            { status: 500 }
          );

          const settledDispatch = await client.query(
            `update ss.alakazam_checkout_dispatches
                set state = 'settled',
                    settled_at = $3
              where organization_id = $1
                and id = $2
                and state = 'ready'
              returning id`,
            [
              reservation.tenantId,
              reservation.dispatchId,
              input.payment.providerPaymentTime
            ]
          );
          const settledQuote = await client.query(
            `update ss.alakazam_change_quotes
                set state = 'payment_settled'
              where organization_id = $1
                and id = $2
                and state = 'checkout_ready'
              returning id`,
            [reservation.tenantId, reservation.quoteId]
          );
          invariant(
            settledDispatch.rowCount === 1 &&
              settledQuote.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment state was not reserved",
            { status: 500 }
          );

          const receiptKind =
            reservation.purpose.changeKind === "start"
              ? "start_payment"
              : "upgrade_difference";
          const insertedReceipt = await client.query(
            `insert into ss.alakazam_payment_receipts (
               id, organization_id, project_id,
               customer_user_id, subscription_id,
               quote_id, stripe_event_row_id,
               receipt_kind, stripe_invoice_id,
               stripe_payment_intent_id,
               list_subtotal_minor,
               provider_discount_minor,
               net_subtotal_minor, tax_minor,
               total_minor, tax_mode, currency,
               settled_at, provider_facts,
               provider_facts_digest
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14, $15,
               $16, 'USD', $17, $18::jsonb, $19
             )
             returning id`,
            [
              input.receiptId,
              reservation.tenantId,
              reservation.projectId,
              reservation.customerId,
              input.subscriptionId,
              reservation.quoteId,
              input.eventRowId,
              receiptKind,
              input.payment.stripeInvoiceId,
              input.payment.stripePaymentIntentId,
              input.payment.listSubtotalMinor,
              input.payment.providerDiscountMinor,
              input.payment.netSubtotalMinor,
              input.payment.taxMinor,
              input.payment.totalMinor,
              input.payment.taxMode,
              input.payment.providerPaymentTime,
              JSON.stringify(input.payment),
              input.payment.providerFactsDigest
            ]
          );
          invariant(
            insertedReceipt.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment receipt was not recorded",
            { status: 500 }
          );

          if (input.creditApplicationId) {
            const credit = await client.query(
              `insert into ss.alakazam_credit_applications (
                 id, organization_id, project_id,
                 subscription_id, quote_id,
                 download_entitlement_id,
                 payment_receipt_id, amount_minor,
                 state, applied_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 500, 'applied', $8
               )
               returning id`,
              [
                input.creditApplicationId,
                reservation.tenantId,
                reservation.projectId,
                input.subscriptionId,
                reservation.quoteId,
                reservation.purpose.downloadCredit
                  .entitlementId,
                input.receiptId,
                input.payment.providerPaymentTime
              ]
            );
            invariant(
              credit.rowCount === 1,
              "repository_conflict",
              "the Alakazam Download credit was not recorded",
              { status: 500 }
            );
          }

          if (input.tierEventId) {
            const tierFacts = {
              schema: ALAKAZAM_TIER_EVENT_FACTS_SCHEMA,
              changeKind: "upgrade",
              purposeDigest: reservation.purposeDigest,
              paymentProviderFactsDigest:
                input.payment.providerFactsDigest,
              receiptId: input.receiptId
            };
            const tierEvent = await client.query(
              `insert into ss.alakazam_tier_change_events (
                 id, organization_id, project_id,
                 subscription_id, quote_id,
                 stripe_event_row_id, payment_receipt_id,
                 downgrade_schedule_id,
                 download_reversal_event_id,
                 result_subscription_revision,
                 event_kind, prior_tier_id,
                 result_tier_id, occurred_at,
                 facts, facts_digest
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 null, null, null,
                 'upgrade_payment_settled', $8, $9,
                 $10, $11::jsonb, $12
               )
               returning id`,
              [
                input.tierEventId,
                reservation.tenantId,
                reservation.projectId,
                input.subscriptionId,
                reservation.quoteId,
                input.eventRowId,
                input.receiptId,
                reservation.purpose.currentSubscription
                  .tierId,
                reservation.purpose.targetTierId,
                input.payment.providerPaymentTime,
                JSON.stringify(tierFacts),
                digest(tierFacts)
              ]
            );
            invariant(
              tierEvent.rowCount === 1,
              "repository_conflict",
              "the Alakazam paid upgrade handoff was not recorded",
              { status: 500 }
            );
          }

          const processedEvent = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed',
                    processed_at = $3
              where organization_id = $1
                and id = $2
                and state = 'processing'
              returning id`,
            [
              reservation.tenantId,
              input.eventRowId,
              input.event.signatureVerifiedAt
            ]
          );
          invariant(
            processedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment event was not completed",
            { status: 500 }
          );

          if (reservation.purpose.changeKind === "upgrade") {
            const pendingProviderChange = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'provider_change_pending'
                where organization_id = $1
                  and id = $2
                  and state = 'payment_settled'
                returning id`,
              [reservation.tenantId, reservation.quoteId]
            );
            invariant(
              pendingProviderChange.rowCount === 1,
              "repository_conflict",
              "the paid Alakazam upgrade was not staged",
              { status: 500 }
            );
          }

          return paymentSettlementResult({
            reservation,
            subscriptionId: input.subscriptionId,
            receiptId: input.receiptId,
            providerFactsDigest:
              input.payment.providerFactsDigest
          });
        })
      );
    }
  });
}
