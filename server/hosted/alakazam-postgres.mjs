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
import {
  ALAKAZAM_UPGRADE_APPLICATION_SCHEMA
} from "../commerce-v2/alakazam-upgrade.mjs";

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
const ALAKAZAM_START_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated"
]);
const ALAKAZAM_UPGRADE_EVENT_TYPE =
  "customer.subscription.updated";
const ALAKAZAM_EVENT_FACTS_SCHEMA =
  "sitesourcery.alakazam-stripe-event/v1";
const ALAKAZAM_TIER_EVENT_FACTS_SCHEMA =
  "sitesourcery.alakazam-tier-event/v1";
const ALAKAZAM_UPGRADE_RECONCILIATIONS = new Set([
  "confirmed",
  "confirmed_after_ambiguous_submit",
  "confirmed_before_submit",
  "readback_after_ambiguity"
]);
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

function exactStripeSubscriptionLookupInput(value) {
  exactKeys(
    value,
    ["stripeSubscriptionId"],
    "the Alakazam start activation lookup is invalid"
  );
  const stripeSubscriptionId = requiredText(
    value.stripeSubscriptionId,
    "stripeSubscriptionId",
    255
  );
  invariant(
    STRIPE_SUBSCRIPTION_ID.test(stripeSubscriptionId),
    "invalid_input",
    "stripeSubscriptionId is invalid"
  );
  return Object.freeze({ stripeSubscriptionId });
}

function exactUpgradeActivationLookupInput(value) {
  exactKeys(
    value,
    [
      "quoteId",
      "receiptId",
      "stripeSubscriptionId",
      "subscriptionId"
    ],
    "the Alakazam upgrade activation lookup is invalid"
  );
  const stripeSubscriptionId = requiredText(
    value.stripeSubscriptionId,
    "stripeSubscriptionId",
    255
  );
  invariant(
    STRIPE_SUBSCRIPTION_ID.test(stripeSubscriptionId),
    "invalid_input",
    "stripeSubscriptionId is invalid"
  );
  return Object.freeze({
    stripeSubscriptionId,
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscriptionId"
    ),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    receiptId: exactUuid(value.receiptId, "receiptId")
  });
}

function exactUpgradeSettlementValue(value) {
  exactKeys(
    value,
    [
      "changeKind",
      "dispatchId",
      "next",
      "paymentProviderFactsDigest",
      "projectId",
      "provider",
      "quoteId",
      "receiptId",
      "status",
      "subscriptionId"
    ],
    "the paid Alakazam upgrade handoff is invalid"
  );
  const selected = {
    status: value.status,
    provider: value.provider,
    changeKind: value.changeKind,
    dispatchId: exactUuid(value.dispatchId, "dispatchId"),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscriptionId"
    ),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    paymentProviderFactsDigest: exactSha(
      value.paymentProviderFactsDigest,
      "paymentProviderFactsDigest"
    ),
    next: value.next
  };
  invariant(
    selected.status === "payment_settled" &&
      selected.provider === "stripe" &&
      selected.changeKind === "upgrade" &&
      selected.next === "provider_change",
    "invalid_input",
    "the paid Alakazam upgrade handoff is invalid"
  );
  return Object.freeze(selected);
}

function exactUpgradeFindInput(value) {
  exactKeys(
    value,
    ["observedAt", "settlement"],
    "the Alakazam upgrade application lookup is invalid"
  );
  return Object.freeze({
    settlement: exactUpgradeSettlementValue(
      value.settlement
    ),
    observedAt: requiredIso(
      value.observedAt,
      "observedAt"
    )
  });
}

function exactUpgradeClaimInput(value) {
  exactKeys(
    value,
    ["applicationId", "claimedAt", "settlement"],
    "the Alakazam upgrade application claim is invalid"
  );
  return Object.freeze({
    settlement: exactUpgradeSettlementValue(
      value.settlement
    ),
    applicationId: exactUuid(
      value.applicationId,
      "applicationId"
    ),
    claimedAt: requiredIso(value.claimedAt, "claimedAt")
  });
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

async function selectStartActivation(
  client,
  {
    stripeSubscriptionId = null,
    tenantId = null,
    subscriptionId = null
  }
) {
  const byProvider = stripeSubscriptionId !== null;
  invariant(
    (byProvider && tenantId === null && subscriptionId === null) ||
      (!byProvider && UUID.test(tenantId) && UUID.test(subscriptionId)),
    "invalid_input",
    "the Alakazam start activation selector is invalid"
  );
  return client.query(
    `select dispatch.*,
            quote.state as activation_quote_state,
            local_subscription.id as activation_subscription_id,
            local_subscription.revision
              as activation_subscription_revision,
            local_subscription.stripe_subscription_id
              as activation_stripe_subscription_id,
            local_subscription.stripe_subscription_item_id
              as activation_stripe_subscription_item_id,
            local_subscription.stripe_price_id
              as activation_stripe_price_id,
            local_subscription.activation_receipt_id
              as activation_subscription_receipt_id,
            local_subscription.tier_id
              as activation_tier_id,
            local_subscription.status
              as activation_subscription_status,
            local_subscription.amount_minor
              as activation_amount_minor,
            local_subscription.current_period_starts_at
              as activation_period_starts_at,
            local_subscription.current_period_ends_at
              as activation_period_ends_at,
            local_subscription.cancel_at_period_end
              as activation_cancel_at_period_end,
            local_subscription.provider_observed_at
              as activation_provider_observed_at,
            local_subscription.provider_facts_digest
              as activation_provider_facts_digest,
            customer.stripe_customer_id
              as activation_stripe_customer_id,
            receipt.id as activation_receipt_id,
            receipt.receipt_kind
              as activation_receipt_kind,
            receipt.provider_facts_digest
              as activation_payment_provider_facts_digest,
            payment_event.livemode
              as activation_payment_livemode,
            payment_event.state
              as activation_payment_event_state
       from ss.alakazam_subscriptions local_subscription
       join ss.alakazam_change_quotes quote
         on quote.organization_id =
            local_subscription.organization_id
        and quote.id = local_subscription.initial_quote_id
       join ss.alakazam_checkout_dispatches dispatch
         on dispatch.organization_id = quote.organization_id
        and dispatch.quote_id = quote.id
       join ss.alakazam_payment_receipts receipt
         on receipt.organization_id = quote.organization_id
        and receipt.subscription_id = local_subscription.id
        and receipt.quote_id = quote.id
        and receipt.receipt_kind = 'start_payment'
       join ss.stripe_customers customer
         on customer.organization_id =
            local_subscription.organization_id
        and customer.id =
            local_subscription.stripe_customer_row_id
       join ss.alakazam_stripe_events payment_event
         on payment_event.organization_id =
            receipt.organization_id
        and payment_event.id = receipt.stripe_event_row_id
      where ${
        byProvider
          ? "local_subscription.stripe_subscription_id = $1"
          : `local_subscription.organization_id = $1
             and local_subscription.id = $2`
      }
      for update of local_subscription, quote, dispatch, receipt,
                    customer`,
    byProvider
      ? [stripeSubscriptionId]
      : [tenantId, subscriptionId]
  );
}

function pendingStartActivation(row, reservation) {
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
  invariant(
    reservation.purpose.changeKind === "start" &&
      row.state === "settled" &&
      row.activation_quote_state === "payment_settled" &&
      row.activation_subscription_status === "pending" &&
      exactDatabaseInteger(
        row.activation_subscription_revision,
        "startActivation.subscriptionRevision"
      ) === 1 &&
      UUID.test(row.activation_subscription_id) &&
      row.activation_stripe_subscription_id &&
      STRIPE_SUBSCRIPTION_ID.test(
        row.activation_stripe_subscription_id
      ) &&
      STRIPE_SUBSCRIPTION_ITEM_ID.test(
        row.activation_stripe_subscription_item_id
      ) &&
      STRIPE_PRICE_ID.test(
        row.activation_stripe_price_id
      ) &&
      row.activation_stripe_customer_id ===
        reservation.stripeCustomerId &&
      row.activation_tier_id === target.tierId &&
      exactDatabaseInteger(
        row.activation_amount_minor,
        "startActivation.amountMinor"
      ) === target.price.amountMinor &&
      row.activation_subscription_receipt_id === null &&
      row.activation_period_starts_at === null &&
      row.activation_period_ends_at === null &&
      row.activation_cancel_at_period_end === false &&
      row.activation_receipt_kind === "start_payment" &&
      row.activation_payment_event_state === "processed" &&
      typeof row.activation_payment_livemode === "boolean" &&
      UUID.test(row.activation_receipt_id),
    "repository_conflict",
    "the pending Alakazam start changed",
    { status: 500 }
  );
  return Object.freeze({
    subscriptionId: row.activation_subscription_id,
    receiptId: row.activation_receipt_id,
    revision: 1,
    stripeSubscriptionId:
      row.activation_stripe_subscription_id,
    stripeSubscriptionItemId:
      row.activation_stripe_subscription_item_id,
    stripePriceId: row.activation_stripe_price_id,
    tierId: row.activation_tier_id,
    amountMinor: exactDatabaseInteger(
      row.activation_amount_minor,
      "startActivation.amountMinor"
    ),
    providerObservedAt: exactDatabaseIso(
      row.activation_provider_observed_at,
      "startActivation.providerObservedAt"
    ),
    providerFactsDigest: exactSha(
      row.activation_provider_facts_digest,
      "startActivation.providerFactsDigest"
    ),
    paymentProviderFactsDigest: exactSha(
      row.activation_payment_provider_facts_digest,
      "startActivation.paymentProviderFactsDigest"
    )
  });
}

function startActivationResult({
  reservation,
  subscriptionId,
  receiptId,
  tierId,
  revision,
  currentPeriodStartsAt,
  currentPeriodEndsAt,
  providerFactsDigest
}) {
  return Object.freeze({
    status: "active",
    provider: "stripe",
    changeKind: "start",
    projectId: reservation.projectId,
    quoteId: reservation.quoteId,
    subscriptionId,
    receiptId,
    tierId,
    revision,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
    subscriptionProviderFactsDigest: providerFactsDigest
  });
}

async function storedStartActivation(
  client,
  reservation,
  subscriptionId
) {
  const selected = await client.query(
    `select local_subscription.id,
            local_subscription.revision,
            local_subscription.tier_id,
            local_subscription.status,
            local_subscription.current_period_starts_at,
            local_subscription.current_period_ends_at,
            local_subscription.provider_facts_digest,
            local_subscription.activation_receipt_id,
            tier_event.id as tier_event_id
       from ss.alakazam_subscriptions local_subscription
       join ss.alakazam_tier_change_events tier_event
         on tier_event.organization_id =
            local_subscription.organization_id
        and tier_event.subscription_id = local_subscription.id
        and tier_event.quote_id = $2
        and tier_event.payment_receipt_id =
            local_subscription.activation_receipt_id
        and tier_event.result_subscription_revision =
            local_subscription.revision
        and tier_event.event_kind = 'start_applied'
      where local_subscription.organization_id = $1
        and local_subscription.id = $3`,
    [reservation.tenantId, reservation.quoteId, subscriptionId]
  );
  const row = selected.rows[0];
  invariant(
    selected.rowCount === 1 &&
      row.status === "active" &&
      row.tier_id === reservation.purpose.targetTierId &&
      UUID.test(row.activation_receipt_id) &&
      UUID.test(row.tier_event_id),
    "repository_conflict",
    "the durable Alakazam start activation changed",
    { status: 500 }
  );
  return startActivationResult({
    reservation,
    subscriptionId: row.id,
    receiptId: row.activation_receipt_id,
    tierId: row.tier_id,
    revision: exactDatabaseInteger(
      row.revision,
      "startActivation.revision"
    ),
    currentPeriodStartsAt: exactDatabaseIso(
      row.current_period_starts_at,
      "startActivation.currentPeriodStartsAt"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "startActivation.currentPeriodEndsAt"
    ),
    providerFactsDigest: exactSha(
      row.provider_facts_digest,
      "startActivation.providerFactsDigest"
    )
  });
}

async function selectPaidUpgrade(
  client,
  settlement,
  { lock = false } = {}
) {
  return client.query(
    `select dispatch.*,
            quote.state as upgrade_quote_state,
            quote.current_subscription_revision
              as upgrade_quote_subscription_revision,
            quote.current_tier_id
              as upgrade_quote_current_tier_id,
            quote.target_tier_id
              as upgrade_quote_target_tier_id,
            local_subscription.id
              as upgrade_subscription_id,
            local_subscription.project_id
              as upgrade_subscription_project_id,
            local_subscription.customer_user_id
              as upgrade_subscription_customer_id,
            local_subscription.revision
              as upgrade_subscription_revision,
            local_subscription.tier_id
              as upgrade_subscription_tier_id,
            local_subscription.status
              as upgrade_subscription_status,
            local_subscription.amount_minor
              as upgrade_subscription_amount_minor,
            local_subscription.stripe_subscription_id
              as upgrade_stripe_subscription_id,
            local_subscription.stripe_subscription_item_id
              as upgrade_stripe_subscription_item_id,
            local_subscription.stripe_price_id
              as upgrade_stripe_price_id,
            local_subscription.current_period_starts_at
              as upgrade_period_starts_at,
            local_subscription.current_period_ends_at
              as upgrade_period_ends_at,
            local_subscription.cancel_at_period_end
              as upgrade_cancel_at_period_end,
            local_subscription.provider_facts_digest
              as upgrade_subscription_provider_facts_digest,
            receipt.id as upgrade_receipt_id,
            receipt.receipt_kind as upgrade_receipt_kind,
            receipt.provider_facts_digest
              as upgrade_payment_provider_facts_digest,
            receipt.stripe_event_row_id
              as upgrade_payment_event_row_id,
            payment_event.state
              as upgrade_payment_event_state,
            payment_event.livemode
              as upgrade_payment_livemode,
            payment_tier_event.id
              as upgrade_payment_tier_event_id,
            payment_tier_event.prior_tier_id
              as upgrade_payment_prior_tier_id,
            payment_tier_event.result_tier_id
              as upgrade_payment_target_tier_id,
            payment_tier_event.stripe_event_row_id
              as upgrade_tier_payment_event_row_id,
            customer.stripe_customer_id
              as upgrade_stripe_customer_id,
            exists (
              select 1
              from ss.alakazam_downgrade_schedules schedule
              where schedule.organization_id =
                      local_subscription.organization_id
                and schedule.subscription_id =
                      local_subscription.id
                and schedule.state in (
                  'dispatching',
                  'scheduled',
                  'reconciliation_required'
                )
            ) as upgrade_has_open_downgrade
       from ss.alakazam_change_quotes quote
       join ss.alakazam_checkout_dispatches dispatch
         on dispatch.organization_id = quote.organization_id
        and dispatch.quote_id = quote.id
       join ss.alakazam_subscriptions local_subscription
         on local_subscription.organization_id =
            quote.organization_id
        and local_subscription.id =
            quote.current_subscription_id
       join ss.alakazam_payment_receipts receipt
         on receipt.organization_id = quote.organization_id
        and receipt.subscription_id =
            local_subscription.id
        and receipt.quote_id = quote.id
        and receipt.receipt_kind = 'upgrade_difference'
       join ss.alakazam_stripe_events payment_event
         on payment_event.organization_id =
            receipt.organization_id
        and payment_event.id = receipt.stripe_event_row_id
       join ss.alakazam_tier_change_events payment_tier_event
         on payment_tier_event.organization_id =
            quote.organization_id
        and payment_tier_event.subscription_id =
            local_subscription.id
        and payment_tier_event.quote_id = quote.id
        and payment_tier_event.payment_receipt_id = receipt.id
        and payment_tier_event.event_kind =
            'upgrade_payment_settled'
       join ss.stripe_customers customer
         on customer.organization_id =
            local_subscription.organization_id
        and customer.id =
            local_subscription.stripe_customer_row_id
      where quote.id = $1
        and quote.project_id = $2
        and local_subscription.id = $3
        and receipt.id = $4
        and dispatch.id = $5
      ${
        lock
          ? `for update of quote, dispatch, local_subscription,
                           receipt, payment_event,
                           payment_tier_event, customer`
          : ""
      }`,
    [
      settlement.quoteId,
      settlement.projectId,
      settlement.subscriptionId,
      settlement.receiptId,
      settlement.dispatchId
    ]
  );
}

async function selectUpgradeActivation(client, input) {
  return client.query(
    `select dispatch.*,
            quote.state as upgrade_quote_state,
            quote.current_subscription_revision
              as upgrade_quote_subscription_revision,
            quote.current_tier_id
              as upgrade_quote_current_tier_id,
            quote.target_tier_id
              as upgrade_quote_target_tier_id,
            local_subscription.id
              as upgrade_subscription_id,
            local_subscription.project_id
              as upgrade_subscription_project_id,
            local_subscription.customer_user_id
              as upgrade_subscription_customer_id,
            local_subscription.revision
              as upgrade_subscription_revision,
            local_subscription.tier_id
              as upgrade_subscription_tier_id,
            local_subscription.status
              as upgrade_subscription_status,
            local_subscription.amount_minor
              as upgrade_subscription_amount_minor,
            local_subscription.stripe_subscription_id
              as upgrade_stripe_subscription_id,
            local_subscription.stripe_subscription_item_id
              as upgrade_stripe_subscription_item_id,
            local_subscription.stripe_price_id
              as upgrade_stripe_price_id,
            local_subscription.current_period_starts_at
              as upgrade_period_starts_at,
            local_subscription.current_period_ends_at
              as upgrade_period_ends_at,
            local_subscription.cancel_at_period_end
              as upgrade_cancel_at_period_end,
            local_subscription.provider_observed_at
              as upgrade_provider_observed_at,
            local_subscription.provider_facts_digest
              as upgrade_subscription_provider_facts_digest,
            receipt.id as upgrade_receipt_id,
            receipt.receipt_kind as upgrade_receipt_kind,
            receipt.provider_facts_digest
              as upgrade_payment_provider_facts_digest,
            receipt.stripe_event_row_id
              as upgrade_payment_event_row_id,
            payment_event.state
              as upgrade_payment_event_state,
            payment_event.livemode
              as upgrade_payment_livemode,
            payment_tier_event.id
              as upgrade_payment_tier_event_id,
            payment_tier_event.prior_tier_id
              as upgrade_payment_prior_tier_id,
            payment_tier_event.result_tier_id
              as upgrade_payment_target_tier_id,
            payment_tier_event.stripe_event_row_id
              as upgrade_tier_payment_event_row_id,
            customer.stripe_customer_id
              as upgrade_stripe_customer_id,
            exists (
              select 1
              from ss.alakazam_downgrade_schedules schedule
              where schedule.organization_id =
                      local_subscription.organization_id
                and schedule.subscription_id =
                      local_subscription.id
                and schedule.state in (
                  'dispatching',
                  'scheduled',
                  'reconciliation_required'
                )
            ) as upgrade_has_open_downgrade,
            upgrade_application.id
              as upgrade_application_id,
            upgrade_application.organization_id
              as upgrade_application_organization_id,
            upgrade_application.project_id
              as upgrade_application_project_id,
            upgrade_application.customer_user_id
              as upgrade_application_customer_id,
            upgrade_application.subscription_id
              as upgrade_application_subscription_id,
            upgrade_application.quote_id
              as upgrade_application_quote_id,
            upgrade_application.checkout_dispatch_id
              as upgrade_application_dispatch_id,
            upgrade_application.payment_receipt_id
              as upgrade_application_receipt_id,
            upgrade_application.provider
              as upgrade_application_provider,
            upgrade_application.provider_idempotency_key
              as upgrade_application_idempotency_key,
            upgrade_application.purpose
              as upgrade_application_purpose,
            upgrade_application.purpose_digest
              as upgrade_application_purpose_digest,
            upgrade_application.payment_provider_facts_digest
              as upgrade_application_payment_facts_digest,
            upgrade_application.state
              as upgrade_application_state,
            upgrade_application.provider_effect_certainty
              as upgrade_application_effect_certainty,
            upgrade_application.provider_facts
              as upgrade_application_provider_facts,
            upgrade_application.provider_facts_digest
              as upgrade_application_provider_facts_digest,
            upgrade_application.provider_reconciliation
              as upgrade_application_reconciliation,
            upgrade_application.provider_error_code
              as upgrade_application_error_code,
            upgrade_application.lease_expires_at
              as upgrade_application_lease_expires_at,
            upgrade_application.provider_confirmed_at
              as upgrade_application_confirmed_at,
            upgrade_application.applied_at
              as upgrade_application_applied_at,
            upgrade_application.created_at
              as upgrade_application_created_at,
            activation_tier_event.id
              as upgrade_activation_tier_event_id,
            activation_tier_event.stripe_event_row_id
              as upgrade_activation_event_row_id,
            activation_tier_event.payment_receipt_id
              as upgrade_activation_receipt_id,
            activation_tier_event.result_subscription_revision
              as upgrade_activation_revision,
            activation_tier_event.prior_tier_id
              as upgrade_activation_prior_tier_id,
            activation_tier_event.result_tier_id
              as upgrade_activation_target_tier_id,
            activation_tier_event.occurred_at
              as upgrade_activation_occurred_at,
            activation_tier_event.facts
              as upgrade_activation_facts,
            activation_tier_event.facts_digest
              as upgrade_activation_facts_digest,
            activation_event.stripe_event_id
              as upgrade_activation_stripe_event_id,
            activation_event.event_type
              as upgrade_activation_event_type,
            activation_event.provider_object_id
              as upgrade_activation_provider_object_id,
            activation_event.state
              as upgrade_activation_event_state,
            activation_event.livemode
              as upgrade_activation_livemode,
            activation_event.payload_digest
              as upgrade_activation_payload_digest,
            activation_event.facts
              as upgrade_activation_event_facts
       from ss.alakazam_upgrade_applications upgrade_application
       join ss.alakazam_change_quotes quote
         on quote.organization_id =
            upgrade_application.organization_id
        and quote.id = upgrade_application.quote_id
       join ss.alakazam_checkout_dispatches dispatch
         on dispatch.organization_id =
            upgrade_application.organization_id
        and dispatch.id =
            upgrade_application.checkout_dispatch_id
       join ss.alakazam_subscriptions local_subscription
         on local_subscription.organization_id =
            upgrade_application.organization_id
        and local_subscription.id =
            upgrade_application.subscription_id
       join ss.alakazam_payment_receipts receipt
         on receipt.organization_id =
            upgrade_application.organization_id
        and receipt.id =
            upgrade_application.payment_receipt_id
       join ss.alakazam_stripe_events payment_event
         on payment_event.organization_id =
            receipt.organization_id
        and payment_event.id = receipt.stripe_event_row_id
       join ss.alakazam_tier_change_events payment_tier_event
         on payment_tier_event.organization_id =
            upgrade_application.organization_id
        and payment_tier_event.subscription_id =
            upgrade_application.subscription_id
        and payment_tier_event.quote_id =
            upgrade_application.quote_id
        and payment_tier_event.payment_receipt_id =
            upgrade_application.payment_receipt_id
        and payment_tier_event.event_kind =
            'upgrade_payment_settled'
       join ss.stripe_customers customer
         on customer.organization_id =
            local_subscription.organization_id
        and customer.id =
            local_subscription.stripe_customer_row_id
       left join ss.alakazam_tier_change_events
            activation_tier_event
         on activation_tier_event.organization_id =
            upgrade_application.organization_id
        and activation_tier_event.subscription_id =
            upgrade_application.subscription_id
        and activation_tier_event.quote_id =
            upgrade_application.quote_id
        and activation_tier_event.payment_receipt_id =
            upgrade_application.payment_receipt_id
        and activation_tier_event.event_kind =
            'upgrade_applied'
       left join ss.alakazam_stripe_events activation_event
         on activation_event.organization_id =
            activation_tier_event.organization_id
        and activation_event.id =
            activation_tier_event.stripe_event_row_id
      where local_subscription.stripe_subscription_id = $1
        and upgrade_application.subscription_id = $2
        and upgrade_application.quote_id = $3
        and upgrade_application.payment_receipt_id = $4
      for update of upgrade_application, quote, dispatch,
                    local_subscription, receipt, payment_event,
                    payment_tier_event, customer`,
    [
      input.stripeSubscriptionId,
      input.subscriptionId,
      input.quoteId,
      input.receiptId
    ]
  );
}

function paidUpgradeReservation(selected, settlement) {
  invariant(
    selected.rowCount === 1,
    "alakazam_upgrade_unavailable",
    "the paid Alakazam upgrade handoff is unavailable",
    { status: 409 }
  );
  const row = selected.rows[0];
  const reservation = storedCheckoutDispatch(row);
  const current = reservation.purpose.currentSubscription;
  const currentTier = resolveAlakazamTier(current.tierId);
  invariant(
    reservation.mode === "upgrade_difference" &&
      reservation.purpose.changeKind === "upgrade" &&
      reservation.purpose.downloadCredit === null &&
      reservation.dispatchId === settlement.dispatchId &&
      reservation.projectId === settlement.projectId &&
      reservation.quoteId === settlement.quoteId &&
      row.state === "settled" &&
      row.provider_effect_certainty === "confirmed" &&
      [
        "provider_change_pending",
        "reconciliation_required"
      ].includes(row.upgrade_quote_state) &&
      row.upgrade_subscription_id ===
        settlement.subscriptionId &&
      row.upgrade_subscription_project_id ===
        reservation.projectId &&
      row.upgrade_subscription_customer_id ===
        reservation.customerId &&
      row.upgrade_subscription_status === "active" &&
      exactDatabaseInteger(
        row.upgrade_subscription_revision,
        "upgrade.subscriptionRevision"
      ) === current.revision &&
      exactDatabaseInteger(
        row.upgrade_quote_subscription_revision,
        "upgrade.quoteSubscriptionRevision"
      ) === current.revision &&
      row.upgrade_subscription_tier_id === current.tierId &&
      row.upgrade_quote_current_tier_id === current.tierId &&
      row.upgrade_quote_target_tier_id ===
        reservation.purpose.targetTierId &&
      exactDatabaseInteger(
        row.upgrade_subscription_amount_minor,
        "upgrade.subscriptionAmountMinor"
      ) === currentTier.price.amountMinor &&
      row.upgrade_stripe_subscription_id ===
        current.stripeSubscriptionId &&
      row.upgrade_stripe_subscription_item_id ===
        current.stripeSubscriptionItemId &&
      row.upgrade_stripe_price_id === current.stripePriceId &&
      exactDatabaseIso(
        row.upgrade_period_starts_at,
        "upgrade.currentPeriodStartsAt"
      ) === current.currentPeriodStartsAt &&
      exactDatabaseIso(
        row.upgrade_period_ends_at,
        "upgrade.currentPeriodEndsAt"
      ) === current.currentPeriodEndsAt &&
      row.upgrade_cancel_at_period_end === false &&
      row.upgrade_subscription_provider_facts_digest ===
        current.providerFactsDigest &&
      row.upgrade_receipt_id === settlement.receiptId &&
      row.upgrade_receipt_kind === "upgrade_difference" &&
      row.upgrade_payment_provider_facts_digest ===
        settlement.paymentProviderFactsDigest &&
      row.upgrade_payment_event_state === "processed" &&
      typeof row.upgrade_payment_livemode === "boolean" &&
      UUID.test(row.upgrade_payment_event_row_id) &&
      UUID.test(row.upgrade_payment_tier_event_id) &&
      row.upgrade_payment_prior_tier_id === current.tierId &&
      row.upgrade_payment_target_tier_id ===
        reservation.purpose.targetTierId &&
      row.upgrade_tier_payment_event_row_id ===
        row.upgrade_payment_event_row_id &&
      row.upgrade_stripe_customer_id ===
        reservation.stripeCustomerId &&
      row.upgrade_has_open_downgrade === false,
    "repository_conflict",
    "the durable paid Alakazam upgrade binding changed",
    { status: 500 }
  );
  return Object.freeze({ reservation, row });
}

function exactUpgradeApplicationValue(
  value,
  reservation,
  settlement = null
) {
  exactKeys(
    value,
    [
      "applicationId",
      "claimedAt",
      "idempotencyKey",
      "leaseExpiresAt",
      "paymentProviderFactsDigest",
      "receiptId",
      "schema",
      "subscriptionId"
    ],
    "the Alakazam upgrade application input is invalid"
  );
  const applicationId = exactUuid(
    value.applicationId,
    "applicationId"
  );
  const application = {
    schema: value.schema,
    applicationId,
    subscriptionId: exactUuid(
      value.subscriptionId,
      "application.subscriptionId"
    ),
    receiptId: exactUuid(
      value.receiptId,
      "application.receiptId"
    ),
    paymentProviderFactsDigest: exactSha(
      value.paymentProviderFactsDigest,
      "application.paymentProviderFactsDigest"
    ),
    idempotencyKey: requiredText(
      value.idempotencyKey,
      "application.idempotencyKey",
      255
    ),
    claimedAt: requiredIso(
      value.claimedAt,
      "application.claimedAt"
    ),
    leaseExpiresAt: requiredIso(
      value.leaseExpiresAt,
      "application.leaseExpiresAt"
    )
  };
  invariant(
    application.schema ===
        ALAKAZAM_UPGRADE_APPLICATION_SCHEMA &&
      application.idempotencyKey ===
        `alakazam:upgrade:apply:${applicationId}` &&
      Date.parse(application.leaseExpiresAt) ===
        Date.parse(application.claimedAt) + 2 * 60 * 1000 &&
      application.subscriptionId ===
        reservation.purpose.currentSubscription
          .localSubscriptionId &&
      (
        settlement === null ||
        (
          application.subscriptionId ===
            settlement.subscriptionId &&
          application.receiptId === settlement.receiptId &&
          application.paymentProviderFactsDigest ===
            settlement.paymentProviderFactsDigest
        )
      ),
    "repository_conflict",
    "the durable Alakazam upgrade application changed",
    { status: 500 }
  );
  return Object.freeze(application);
}

function storedUpgradeApplication(
  row,
  reservation,
  settlement
) {
  const purpose = jsonObject(
    row.purpose,
    "upgradeApplication.purpose"
  );
  const application = exactUpgradeApplicationValue(
    {
      schema: ALAKAZAM_UPGRADE_APPLICATION_SCHEMA,
      applicationId: row.id,
      subscriptionId: row.subscription_id,
      receiptId: row.payment_receipt_id,
      paymentProviderFactsDigest:
        row.payment_provider_facts_digest,
      idempotencyKey: row.provider_idempotency_key,
      claimedAt: exactDatabaseIso(
        row.created_at,
        "upgradeApplication.createdAt"
      ),
      leaseExpiresAt: exactDatabaseIso(
        row.lease_expires_at,
        "upgradeApplication.leaseExpiresAt"
      )
    },
    reservation,
    settlement
  );
  invariant(
    row.organization_id === reservation.tenantId &&
      row.project_id === reservation.projectId &&
      row.customer_user_id === reservation.customerId &&
      row.subscription_id === settlement.subscriptionId &&
      row.quote_id === settlement.quoteId &&
      row.checkout_dispatch_id === settlement.dispatchId &&
      row.payment_receipt_id === settlement.receiptId &&
      row.provider === "stripe" &&
      digest(purpose) === digest(reservation.purpose) &&
      row.purpose_digest === reservation.purposeDigest &&
      [
        "applied",
        "dispatching",
        "provider_confirmed",
        "reconciliation_required"
      ].includes(row.state),
    "repository_conflict",
    "the durable Alakazam upgrade application changed",
    { status: 500 }
  );
  return application;
}

function exactUpgradeApplicationQuoteState(
  row,
  quoteState
) {
  invariant(
    (
      row.state === "reconciliation_required"
        ? quoteState === "reconciliation_required"
        : ["dispatching", "provider_confirmed"].includes(
              row.state
            )
          ? quoteState === "provider_change_pending"
          : row.state === "applied" &&
            quoteState === "applied"
    ),
    "repository_conflict",
    "the Alakazam upgrade application and quote state disagree",
    { status: 500 }
  );
}

function upgradeProviderConfirmation(
  row,
  reservation,
  application
) {
  invariant(
    ["provider_confirmed", "applied"].includes(row.state) &&
      row.provider_effect_certainty === "confirmed" &&
      row.provider_error_code === null &&
      ALAKAZAM_UPGRADE_RECONCILIATIONS.has(
        row.provider_reconciliation
      ),
    "repository_conflict",
    "the durable Alakazam upgrade confirmation changed",
    { status: 500 }
  );
  jsonObject(
    row.provider_facts,
    "upgradeApplication.providerFacts"
  );
  const current = reservation.purpose.currentSubscription;
  return Object.freeze({
    status: row.state,
    provider: "stripe",
    changeKind: "upgrade",
    applicationId: application.applicationId,
    projectId: reservation.projectId,
    quoteId: reservation.quoteId,
    subscriptionId: application.subscriptionId,
    receiptId: application.receiptId,
    priorTierId: current.tierId,
    targetTierId: reservation.purpose.targetTierId,
    currentRevision: current.revision,
    currentPeriodStartsAt: current.currentPeriodStartsAt,
    currentPeriodEndsAt: current.currentPeriodEndsAt,
    paymentProviderFactsDigest:
      application.paymentProviderFactsDigest,
    subscriptionProviderFactsDigest: exactSha(
      row.provider_facts_digest,
      "upgradeApplication.providerFactsDigest"
    ),
    reconciliation: row.provider_reconciliation,
    next:
      row.state === "provider_confirmed"
        ? "subscription_event_confirmation"
        : "complete"
  });
}

function upgradeApplicationResolution(
  row,
  reservation,
  settlement,
  status = row.state
) {
  const application = storedUpgradeApplication(
    row,
    reservation,
    settlement
  );
  const publicStatus =
    status === "dispatching" ? "in_progress" : status;
  const confirmation = [
    "provider_confirmed",
    "applied"
  ].includes(status)
    ? upgradeProviderConfirmation(
        row,
        reservation,
        application
      )
    : null;
  if (confirmation) {
    return Object.freeze({
      status: publicStatus,
      provider: "stripe",
      reservation,
      application,
      confirmation
    });
  }
  return Object.freeze({
    status: publicStatus,
    provider: "stripe",
    reservation,
    application
  });
}

function upgradeApplicationFromActivationRow(row) {
  return {
    id: row.upgrade_application_id,
    organization_id:
      row.upgrade_application_organization_id,
    project_id: row.upgrade_application_project_id,
    customer_user_id:
      row.upgrade_application_customer_id,
    subscription_id:
      row.upgrade_application_subscription_id,
    quote_id: row.upgrade_application_quote_id,
    checkout_dispatch_id:
      row.upgrade_application_dispatch_id,
    payment_receipt_id:
      row.upgrade_application_receipt_id,
    provider: row.upgrade_application_provider,
    provider_idempotency_key:
      row.upgrade_application_idempotency_key,
    purpose: row.upgrade_application_purpose,
    purpose_digest:
      row.upgrade_application_purpose_digest,
    payment_provider_facts_digest:
      row.upgrade_application_payment_facts_digest,
    state: row.upgrade_application_state,
    provider_effect_certainty:
      row.upgrade_application_effect_certainty,
    provider_facts:
      row.upgrade_application_provider_facts,
    provider_facts_digest:
      row.upgrade_application_provider_facts_digest,
    provider_reconciliation:
      row.upgrade_application_reconciliation,
    provider_error_code:
      row.upgrade_application_error_code,
    lease_expires_at:
      row.upgrade_application_lease_expires_at,
    provider_confirmed_at:
      row.upgrade_application_confirmed_at,
    applied_at: row.upgrade_application_applied_at,
    created_at: row.upgrade_application_created_at
  };
}

function upgradeActivationSettlement(row, reservation) {
  return exactUpgradeSettlementValue({
    status: "payment_settled",
    provider: "stripe",
    changeKind: "upgrade",
    dispatchId: reservation.dispatchId,
    projectId: reservation.projectId,
    quoteId: reservation.quoteId,
    subscriptionId:
      row.upgrade_application_subscription_id,
    receiptId: row.upgrade_application_receipt_id,
    paymentProviderFactsDigest:
      row.upgrade_application_payment_facts_digest,
    next: "provider_change"
  });
}

function upgradeActivationEventFacts({
  event,
  reservation,
  application,
  subscription
}) {
  return {
    schema: ALAKAZAM_EVENT_FACTS_SCHEMA,
    provider: "stripe",
    stripeEventId: event.stripeEventId,
    eventType: event.eventType,
    stripeSubscriptionId: event.stripeSubscriptionId,
    purposeDigest: reservation.purposeDigest,
    payloadDigest: event.payloadDigest,
    metadata: event.metadata,
    applicationId: application.applicationId,
    paymentReceiptId: application.receiptId,
    subscription,
    subscriptionProviderFactsDigest:
      subscription.providerFactsDigest
  };
}

function upgradeActivationTierFacts({
  reservation,
  application,
  subscription
}) {
  const current = reservation.purpose.currentSubscription;
  return {
    schema: ALAKAZAM_TIER_EVENT_FACTS_SCHEMA,
    changeKind: "upgrade",
    purposeDigest: reservation.purposeDigest,
    applicationId: application.applicationId,
    receiptId: application.receiptId,
    paymentProviderFactsDigest:
      application.paymentProviderFactsDigest,
    subscriptionProviderFactsDigest:
      subscription.providerFactsDigest,
    priorTierId: current.tierId,
    targetTierId: reservation.purpose.targetTierId,
    resultRevision: current.revision + 1
  };
}

function upgradeActivationResult({
  reservation,
  application,
  subscription
}) {
  const current = reservation.purpose.currentSubscription;
  return Object.freeze({
    status: "active",
    provider: "stripe",
    changeKind: "upgrade",
    applicationId: application.applicationId,
    projectId: reservation.projectId,
    quoteId: reservation.quoteId,
    subscriptionId: application.subscriptionId,
    receiptId: application.receiptId,
    priorTierId: current.tierId,
    targetTierId: reservation.purpose.targetTierId,
    revision: current.revision + 1,
    currentPeriodStartsAt: current.currentPeriodStartsAt,
    currentPeriodEndsAt: current.currentPeriodEndsAt,
    paymentProviderFactsDigest:
      application.paymentProviderFactsDigest,
    subscriptionProviderFactsDigest:
      subscription.providerFactsDigest,
    next: "complete"
  });
}

function storedUpgradeActivation(
  row,
  reservation,
  application,
  applicationRow
) {
  const current = reservation.purpose.currentSubscription;
  exactUpgradeProviderFacts(
    jsonObject(
      applicationRow.provider_facts,
      "upgradeActivation.confirmedProviderFacts"
    ),
    reservation,
    application,
    exactDatabaseIso(
      applicationRow.provider_confirmed_at,
      "upgradeActivation.providerConfirmedAt"
    )
  );
  const storedEventFacts = jsonObject(
    row.upgrade_activation_event_facts,
    "upgradeActivation.eventFacts"
  );
  const storedSubscription = jsonObject(
    storedEventFacts.subscription,
    "upgradeActivation.eventSubscription"
  );
  const subscription = exactUpgradeProviderFacts(
    storedSubscription,
    reservation,
    application,
    requiredIso(
      storedSubscription.providerObservedAt,
      "upgradeActivation.eventProviderObservedAt"
    )
  );
  const event = {
    stripeEventId: row.upgrade_activation_stripe_event_id,
    eventType: row.upgrade_activation_event_type,
    stripeSubscriptionId:
      row.upgrade_activation_provider_object_id,
    payloadDigest: row.upgrade_activation_payload_digest,
    metadata: subscription.metadata
  };
  const expectedEventFacts = upgradeActivationEventFacts({
    event,
    reservation,
    application,
    subscription
  });
  const expectedTierFacts = upgradeActivationTierFacts({
    reservation,
    application,
    subscription
  });
  const currentRevision = exactDatabaseInteger(
    row.upgrade_subscription_revision,
    "upgradeActivation.currentSubscriptionRevision"
  );
  const activationRevision = exactDatabaseInteger(
    row.upgrade_activation_revision,
    "upgradeActivation.revision"
  );
  invariant(
    applicationRow.state === "applied" &&
      row.upgrade_quote_state === "applied" &&
      row.state === "settled" &&
      row.provider_effect_certainty === "confirmed" &&
      row.upgrade_subscription_id ===
        application.subscriptionId &&
      row.upgrade_subscription_project_id ===
        reservation.projectId &&
      row.upgrade_subscription_customer_id ===
        reservation.customerId &&
      row.upgrade_stripe_subscription_id ===
        current.stripeSubscriptionId &&
      row.upgrade_stripe_customer_id ===
        reservation.stripeCustomerId &&
      currentRevision >= current.revision + 1 &&
      exactDatabaseInteger(
        row.upgrade_quote_subscription_revision,
        "upgradeActivation.quoteSubscriptionRevision"
      ) === current.revision &&
      row.upgrade_quote_current_tier_id === current.tierId &&
      row.upgrade_quote_target_tier_id ===
        reservation.purpose.targetTierId &&
      row.upgrade_receipt_id === application.receiptId &&
      row.upgrade_receipt_kind === "upgrade_difference" &&
      row.upgrade_payment_provider_facts_digest ===
        application.paymentProviderFactsDigest &&
      row.upgrade_payment_event_state === "processed" &&
      typeof row.upgrade_payment_livemode === "boolean" &&
      UUID.test(row.upgrade_payment_event_row_id) &&
      UUID.test(row.upgrade_payment_tier_event_id) &&
      row.upgrade_payment_prior_tier_id === current.tierId &&
      row.upgrade_payment_target_tier_id ===
        reservation.purpose.targetTierId &&
      row.upgrade_tier_payment_event_row_id ===
        row.upgrade_payment_event_row_id &&
      UUID.test(row.upgrade_activation_tier_event_id) &&
      UUID.test(row.upgrade_activation_event_row_id) &&
      row.upgrade_activation_receipt_id ===
        application.receiptId &&
      activationRevision === current.revision + 1 &&
      row.upgrade_activation_prior_tier_id === current.tierId &&
      row.upgrade_activation_target_tier_id ===
        reservation.purpose.targetTierId &&
      row.upgrade_activation_event_type ===
        ALAKAZAM_UPGRADE_EVENT_TYPE &&
      row.upgrade_activation_provider_object_id ===
        current.stripeSubscriptionId &&
      row.upgrade_activation_event_state === "processed" &&
      row.upgrade_activation_livemode ===
        row.upgrade_payment_livemode &&
      exactSha(
        row.upgrade_activation_payload_digest,
        "upgradeActivation.payloadDigest"
      ) === event.payloadDigest &&
      digest(
        storedEventFacts
      ) === digest(expectedEventFacts) &&
      digest(
        jsonObject(
          row.upgrade_activation_facts,
          "upgradeActivation.tierFacts"
        )
      ) === digest(expectedTierFacts) &&
      exactSha(
        row.upgrade_activation_facts_digest,
        "upgradeActivation.tierFactsDigest"
      ) === digest(expectedTierFacts) &&
      Date.parse(
        exactDatabaseIso(
          row.upgrade_activation_occurred_at,
          "upgradeActivation.occurredAt"
        )
      ) <= Date.parse(subscription.providerObservedAt),
    "repository_conflict",
    "the durable Alakazam upgrade activation changed",
    { status: 500 }
  );
  if (currentRevision === activationRevision) {
    invariant(
      row.upgrade_subscription_status === "active" &&
        row.upgrade_subscription_tier_id ===
          reservation.purpose.targetTierId &&
        exactDatabaseInteger(
          row.upgrade_subscription_amount_minor,
          "upgradeActivation.amountMinor"
        ) === subscription.amountMinor &&
        row.upgrade_stripe_subscription_item_id ===
          subscription.stripeSubscriptionItemId &&
        row.upgrade_stripe_price_id ===
          subscription.stripePriceId &&
        exactDatabaseIso(
          row.upgrade_period_starts_at,
          "upgradeActivation.currentPeriodStartsAt"
        ) === subscription.currentPeriodStartsAt &&
        exactDatabaseIso(
          row.upgrade_period_ends_at,
          "upgradeActivation.currentPeriodEndsAt"
        ) === subscription.currentPeriodEndsAt &&
        row.upgrade_cancel_at_period_end === false &&
        row.upgrade_subscription_provider_facts_digest ===
          subscription.providerFactsDigest,
      "repository_conflict",
      "the current Alakazam upgrade activation changed",
      { status: 500 }
    );
  }
  return upgradeActivationResult({
    reservation,
    application,
    subscription
  });
}

function upgradeActivationResolution(selected, input) {
  invariant(
    selected.rowCount === 1,
    "stripe_event_binding_invalid",
    "the Stripe event has no durable paid Alakazam upgrade",
    { status: 400 }
  );
  const row = selected.rows[0];
  const reservation = storedCheckoutDispatch(row);
  const settlement = upgradeActivationSettlement(
    row,
    reservation
  );
  const applicationRow =
    upgradeApplicationFromActivationRow(row);
  const application = storedUpgradeApplication(
    applicationRow,
    reservation,
    settlement
  );
  invariant(
    reservation.purpose.changeKind === "upgrade" &&
      reservation.mode === "upgrade_difference" &&
      settlement.subscriptionId === input.subscriptionId &&
      settlement.quoteId === input.quoteId &&
      settlement.receiptId === input.receiptId &&
      reservation.purpose.currentSubscription
        .stripeSubscriptionId === input.stripeSubscriptionId &&
      applicationRow.state ===
        row.upgrade_application_state &&
      ["provider_confirmed", "applied"].includes(
        applicationRow.state
      ),
    "stripe_event_binding_invalid",
    "the Stripe event does not identify the paid Alakazam upgrade",
    { status: 400 }
  );
  exactUpgradeApplicationQuoteState(
    applicationRow,
    row.upgrade_quote_state
  );
  if (applicationRow.state === "provider_confirmed") {
    paidUpgradeReservation(selected, settlement);
    invariant(
      row.upgrade_activation_tier_event_id === null &&
        row.upgrade_activation_event_row_id === null,
      "repository_conflict",
      "the pending Alakazam upgrade has conflicting activation evidence",
      { status: 500 }
    );
  }
  const confirmation = upgradeProviderConfirmation(
    applicationRow,
    reservation,
    application
  );
  const base = {
    status: applicationRow.state,
    provider: "stripe",
    settlement,
    reservation,
    application,
    confirmation,
    stripeSubscriptionId: input.stripeSubscriptionId
  };
  if (applicationRow.state === "provider_confirmed") {
    return Object.freeze(base);
  }
  return Object.freeze({
    ...base,
    activation: storedUpgradeActivation(
      row,
      reservation,
      application,
      applicationRow
    )
  });
}

function exactUpgradeProviderFacts(
  value,
  reservation,
  application,
  confirmedAt
) {
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
    "the Alakazam upgrade provider evidence is invalid"
  );
  const current = reservation.purpose.currentSubscription;
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
  const expectedMetadata = {
    ...createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    }),
    payment_receipt_id: application.receiptId,
    payment_facts_digest:
      application.paymentProviderFactsDigest
  };
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const observedAt = requiredIso(
    value.providerObservedAt,
    "upgrade.providerObservedAt"
  );
  requiredIso(
    value.billingCycleAnchor,
    "upgrade.billingCycleAnchor"
  );
  invariant(
    value.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      value.stripeSubscriptionId ===
        current.stripeSubscriptionId &&
      value.stripeSubscriptionItemId ===
        current.stripeSubscriptionItemId &&
      value.stripeCustomerId === reservation.stripeCustomerId &&
      STRIPE_PRICE_ID.test(value.stripePriceId) &&
      value.stripePriceId !== current.stripePriceId &&
      value.stripeScheduleId === null &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      value.cancelAtPeriodEnd === false &&
      requiredIso(
        value.currentPeriodStartsAt,
        "upgrade.currentPeriodStartsAt"
      ) === current.currentPeriodStartsAt &&
      requiredIso(
        value.currentPeriodEndsAt,
        "upgrade.currentPeriodEndsAt"
      ) === current.currentPeriodEndsAt &&
      Date.parse(observedAt) >=
        Date.parse(application.claimedAt) &&
      Date.parse(confirmedAt) >= Date.parse(observedAt) &&
      sameExactObject(value.metadata, expectedMetadata) &&
      exactSha(
        value.providerFactsDigest,
        "upgrade.providerFactsDigest"
      ) === digest(facts),
    "invalid_input",
    "the Alakazam upgrade provider evidence changed"
  );
  return deepFreeze(clone(value));
}

function exactUpgradeConfirmationInput(value) {
  exactKeys(
    value,
    [
      "application",
      "confirmedAt",
      "reconciliation",
      "reservation",
      "subscription"
    ],
    "the Alakazam upgrade confirmation input is invalid"
  );
  const reservation = exactCheckoutReservationValue(
    value.reservation
  );
  invariant(
    reservation.purpose.changeKind === "upgrade",
    "invalid_input",
    "only an Alakazam upgrade can confirm here"
  );
  const application = exactUpgradeApplicationValue(
    value.application,
    reservation
  );
  const confirmedAt = requiredIso(
    value.confirmedAt,
    "confirmedAt"
  );
  invariant(
    ALAKAZAM_UPGRADE_RECONCILIATIONS.has(
      value.reconciliation
    ),
    "invalid_input",
    "the Alakazam upgrade reconciliation is invalid"
  );
  return Object.freeze({
    reservation,
    application,
    confirmedAt,
    reconciliation: value.reconciliation,
    subscription: exactUpgradeProviderFacts(
      value.subscription,
      reservation,
      application,
      confirmedAt
    )
  });
}

function exactUpgradeReconciliationInput(value) {
  exactKeys(
    value,
    [
      "application",
      "errorCode",
      "markedAt",
      "reservation"
    ],
    "the Alakazam upgrade reconciliation input is invalid"
  );
  const reservation = exactCheckoutReservationValue(
    value.reservation
  );
  invariant(
    reservation.purpose.changeKind === "upgrade",
    "invalid_input",
    "only an Alakazam upgrade can be reconciled here"
  );
  const errorCode = requiredText(
    value.errorCode,
    "errorCode",
    200
  );
  invariant(
    /^[a-z0-9_]+$/u.test(errorCode),
    "invalid_input",
    "errorCode is invalid"
  );
  return Object.freeze({
    reservation,
    application: exactUpgradeApplicationValue(
      value.application,
      reservation
    ),
    errorCode,
    markedAt: requiredIso(value.markedAt, "markedAt")
  });
}

function exactUpgradeActivationEventValue(
  value,
  reservation,
  application,
  stripeSubscriptionId
) {
  exactKeys(
    value,
    [
      "apiVersion",
      "eventType",
      "livemode",
      "metadata",
      "occurredAt",
      "payloadDigest",
      "signatureVerifiedAt",
      "stripeEventId",
      "stripeSubscriptionId"
    ],
    "the Alakazam upgrade Subscription event input is invalid"
  );
  const expectedMetadata = {
    ...createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    }),
    payment_receipt_id: application.receiptId,
    payment_facts_digest:
      application.paymentProviderFactsDigest
  };
  invariant(
    STRIPE_EVENT_ID.test(value.stripeEventId) &&
      value.eventType === ALAKAZAM_UPGRADE_EVENT_TYPE &&
      typeof value.livemode === "boolean" &&
      typeof value.apiVersion === "string" &&
      value.apiVersion.length >= 3 &&
      value.apiVersion.length <= 100 &&
      value.stripeSubscriptionId === stripeSubscriptionId &&
      sameExactObject(value.metadata, expectedMetadata),
    "invalid_input",
    "the Alakazam upgrade Subscription event changed"
  );
  return Object.freeze({
    stripeEventId: value.stripeEventId,
    eventType: value.eventType,
    livemode: value.livemode,
    apiVersion: value.apiVersion,
    stripeSubscriptionId,
    metadata: expectedMetadata,
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

function exactUpgradeActivationInput(value) {
  exactKeys(
    value,
    [
      "application",
      "event",
      "eventRowId",
      "reservation",
      "subscription",
      "tierEventId"
    ],
    "the Alakazam upgrade activation input is invalid"
  );
  const reservation = exactCheckoutReservationValue(
    value.reservation
  );
  invariant(
    reservation.purpose.changeKind === "upgrade",
    "invalid_input",
    "only an Alakazam upgrade can activate here"
  );
  const application = exactUpgradeApplicationValue(
    value.application,
    reservation
  );
  const subscription = exactUpgradeProviderFacts(
    value.subscription,
    reservation,
    application,
    requiredIso(
      value.subscription?.providerObservedAt,
      "subscription.providerObservedAt"
    )
  );
  const event = exactUpgradeActivationEventValue(
    value.event,
    reservation,
    application,
    subscription.stripeSubscriptionId
  );
  invariant(
    Date.parse(event.occurredAt) <=
        Date.parse(event.signatureVerifiedAt) &&
      Date.parse(subscription.providerObservedAt) >=
        Date.parse(event.signatureVerifiedAt),
    "invalid_input",
    "the Alakazam upgrade Subscription confirmation is stale"
  );
  return Object.freeze({
    reservation,
    application,
    subscription,
    event,
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    tierEventId: exactUuid(
      value.tierEventId,
      "tierEventId"
    )
  });
}

function exactStartActivationEventValue(
  value,
  reservation,
  stripeSubscriptionId
) {
  exactKeys(
    value,
    [
      "apiVersion",
      "eventType",
      "livemode",
      "metadata",
      "occurredAt",
      "payloadDigest",
      "signatureVerifiedAt",
      "stripeEventId",
      "stripeSubscriptionId"
    ],
    "the Alakazam Subscription event input is invalid"
  );
  const metadata = createAlakazamProviderMetadata({
    purpose: reservation.purpose,
    purposeDigest: reservation.purposeDigest
  });
  invariant(
    STRIPE_EVENT_ID.test(value.stripeEventId) &&
      ALAKAZAM_START_EVENT_TYPES.has(value.eventType) &&
      typeof value.livemode === "boolean" &&
      typeof value.apiVersion === "string" &&
      value.apiVersion.length >= 3 &&
      value.apiVersion.length <= 100 &&
      value.stripeSubscriptionId === stripeSubscriptionId &&
      sameExactObject(value.metadata, metadata),
    "invalid_input",
    "the Alakazam Subscription event changed"
  );
  return Object.freeze({
    stripeEventId: value.stripeEventId,
    eventType: value.eventType,
    livemode: value.livemode,
    apiVersion: value.apiVersion,
    stripeSubscriptionId,
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

function exactStartActivationInput(value, reservation) {
  exactKeys(
    value,
    [
      "event",
      "eventRowId",
      "receiptId",
      "reservation",
      "subscription",
      "subscriptionId",
      "tierEventId"
    ],
    "the Alakazam start activation input is invalid"
  );
  invariant(
    reservation.purpose.changeKind === "start",
    "invalid_input",
    "only an Alakazam start can activate here"
  );
  const subscription = exactSubscriptionPaymentFacts(
    value.subscription,
    reservation
  );
  const event = exactStartActivationEventValue(
    value.event,
    reservation,
    subscription.stripeSubscriptionId
  );
  return Object.freeze({
    reservation,
    subscription,
    event,
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscriptionId"
    ),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    tierEventId: exactUuid(
      value.tierEventId,
      "tierEventId"
    )
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

    async findStartActivationBySubscription(value) {
      const input = exactStripeSubscriptionLookupInput(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectStartActivation(
            client,
            {
              stripeSubscriptionId:
                input.stripeSubscriptionId
            }
          );
          invariant(
            selected.rowCount === 1,
            "stripe_event_binding_invalid",
            "the Stripe event has no durable pending Alakazam start",
            { status: 400 }
          );
          const row = selected.rows[0];
          const reservation = storedCheckoutDispatch(row);
          invariant(
            reservation.purpose.changeKind === "start" &&
              reservation.mode === "subscription_start" &&
              row.state === "settled" &&
              row.activation_stripe_subscription_id ===
                input.stripeSubscriptionId &&
              row.activation_stripe_customer_id ===
                reservation.stripeCustomerId &&
              row.activation_receipt_kind === "start_payment" &&
              row.activation_payment_event_state === "processed" &&
              ["pending", "active"].includes(
                row.activation_subscription_status
              ) &&
              (
                row.activation_subscription_status === "pending"
                  ? row.activation_quote_state ===
                    "payment_settled"
                  : row.activation_quote_state === "applied"
              ),
            "repository_conflict",
            "the durable Alakazam start activation binding changed",
            { status: 500 }
          );
          if (row.activation_subscription_status === "active") {
            return Object.freeze({
              status: "active",
              provider: "stripe",
              reservation,
              stripeSubscriptionId:
                row.activation_stripe_subscription_id,
              activation: await storedStartActivation(
                client,
                reservation,
                row.activation_subscription_id
              )
            });
          }
          return Object.freeze({
            status: "pending",
            provider: "stripe",
            reservation,
            pending: pendingStartActivation(row, reservation)
          });
        })
      );
    },

    async findUpgradeActivationBySubscription(value) {
      const input = exactUpgradeActivationLookupInput(value);
      return translated(() =>
        database.service({}, async (client) =>
          upgradeActivationResolution(
            await selectUpgradeActivation(client, input),
            input
          )
        )
      );
    },

    async findUpgradeApplication(value) {
      const input = exactUpgradeFindInput(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectPaidUpgrade(
            client,
            input.settlement,
            { lock: true }
          );
          const { reservation, row: binding } =
            paidUpgradeReservation(
              selected,
              input.settlement
            );
          const applications = await client.query(
            `select *
               from ss.alakazam_upgrade_applications
              where quote_id = $1
              for update`,
            [input.settlement.quoteId]
          );
          if (applications.rowCount === 0) return null;
          invariant(
            applications.rowCount === 1,
            "repository_conflict",
            "the paid Alakazam upgrade has conflicting applications",
            { status: 500 }
          );
          let applicationRow = applications.rows[0];
          storedUpgradeApplication(
            applicationRow,
            reservation,
            input.settlement
          );
          exactUpgradeApplicationQuoteState(
            applicationRow,
            binding.upgrade_quote_state
          );
          if (
            applicationRow.state === "dispatching" &&
            Date.parse(
              exactDatabaseIso(
                applicationRow.lease_expires_at,
                "upgradeApplication.leaseExpiresAt"
              )
            ) <= Date.parse(input.observedAt)
          ) {
            const fenced = await client.query(
              `update ss.alakazam_upgrade_applications
                  set state = 'reconciliation_required',
                      provider_effect_certainty = 'ambiguous',
                      provider_error_code =
                        'upgrade_worker_interrupted'
                where id = $1
                  and state = 'dispatching'
                returning *`,
              [applicationRow.id]
            );
            invariant(
              fenced.rowCount === 1,
              "repository_conflict",
              "the interrupted Alakazam upgrade was not fenced",
              { status: 500 }
            );
            const held = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'reconciliation_required'
                where organization_id = $1
                  and id = $2
                  and state = 'provider_change_pending'
                returning id`,
              [reservation.tenantId, reservation.quoteId]
            );
            invariant(
              held.rowCount === 1,
              "repository_conflict",
              "the interrupted Alakazam upgrade quote was not fenced",
              { status: 500 }
            );
            applicationRow = fenced.rows[0];
          }
          return upgradeApplicationResolution(
            applicationRow,
            reservation,
            input.settlement
          );
        })
      );
    },

    async claimUpgradeApplication(value) {
      const input = exactUpgradeClaimInput(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectPaidUpgrade(
            client,
            input.settlement,
            { lock: true }
          );
          const { reservation, row: binding } =
            paidUpgradeReservation(
              selected,
              input.settlement
            );
          const existing = await client.query(
            `select *
               from ss.alakazam_upgrade_applications
              where quote_id = $1
              for update`,
            [input.settlement.quoteId]
          );
          if (existing.rowCount === 1) {
            exactUpgradeApplicationQuoteState(
              existing.rows[0],
              binding.upgrade_quote_state
            );
            return upgradeApplicationResolution(
              existing.rows[0],
              reservation,
              input.settlement
            );
          }
          invariant(
            existing.rowCount === 0 &&
              binding.upgrade_quote_state ===
                "provider_change_pending",
            "repository_conflict",
            "the paid Alakazam upgrade cannot open an application",
            { status: 500 }
          );
          const inserted = await client.query(
            `insert into ss.alakazam_upgrade_applications (
               id, organization_id, project_id,
               customer_user_id, subscription_id,
               quote_id, checkout_dispatch_id,
               payment_receipt_id, provider,
               provider_idempotency_key,
               purpose, purpose_digest,
               payment_provider_facts_digest,
               state, provider_effect_certainty,
               lease_expires_at, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               'stripe', $9, $10::jsonb, $11, $12,
               'dispatching', 'not_submitted',
               $13::timestamptz + interval '2 minutes',
               $13, $13
             )
             returning *`,
            [
              input.applicationId,
              reservation.tenantId,
              reservation.projectId,
              reservation.customerId,
              input.settlement.subscriptionId,
              input.settlement.quoteId,
              input.settlement.dispatchId,
              input.settlement.receiptId,
              `alakazam:upgrade:apply:${input.applicationId}`,
              JSON.stringify(reservation.purpose),
              reservation.purposeDigest,
              input.settlement.paymentProviderFactsDigest,
              input.claimedAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "repository_conflict",
            "the paid Alakazam upgrade application was not reserved",
            { status: 500 }
          );
          return upgradeApplicationResolution(
            inserted.rows[0],
            reservation,
            input.settlement,
            "claimed"
          );
        })
      );
    },

    async confirmUpgradeProvider(value) {
      const input = exactUpgradeConfirmationInput(value);
      const settlement = Object.freeze({
        status: "payment_settled",
        provider: "stripe",
        changeKind: "upgrade",
        dispatchId: input.reservation.dispatchId,
        projectId: input.reservation.projectId,
        quoteId: input.reservation.quoteId,
        subscriptionId: input.application.subscriptionId,
        receiptId: input.application.receiptId,
        paymentProviderFactsDigest:
          input.application.paymentProviderFactsDigest,
        next: "provider_change"
      });
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectPaidUpgrade(
            client,
            settlement,
            { lock: true }
          );
          const { reservation, row: binding } =
            paidUpgradeReservation(selected, settlement);
          invariant(
            digest(reservation) ===
              digest(input.reservation),
            "repository_conflict",
            "the paid Alakazam upgrade purpose changed",
            { status: 500 }
          );
          const applications = await client.query(
            `select *
               from ss.alakazam_upgrade_applications
              where id = $1
                and quote_id = $2
              for update`,
            [
              input.application.applicationId,
              reservation.quoteId
            ]
          );
          invariant(
            applications.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade application is unavailable",
            { status: 500 }
          );
          const applicationRow = applications.rows[0];
          const storedApplication = storedUpgradeApplication(
            applicationRow,
            reservation,
            settlement
          );
          invariant(
            digest(storedApplication) ===
              digest(input.application),
            "repository_conflict",
            "the Alakazam upgrade application changed",
            { status: 500 }
          );
          exactUpgradeApplicationQuoteState(
            applicationRow,
            binding.upgrade_quote_state
          );
          if (
            ["provider_confirmed", "applied"].includes(
              applicationRow.state
            )
          ) {
            invariant(
              applicationRow.provider_facts_digest ===
                input.subscription.providerFactsDigest,
              "repository_conflict",
              "the confirmed Alakazam upgrade evidence changed",
              { status: 500 }
            );
            return upgradeProviderConfirmation(
              applicationRow,
              reservation,
              storedApplication
            );
          }
          invariant(
            [
              "dispatching",
              "reconciliation_required"
            ].includes(applicationRow.state),
            "repository_conflict",
            "the Alakazam upgrade application cannot confirm",
            { status: 500 }
          );
          const confirmed = await client.query(
            `update ss.alakazam_upgrade_applications
                set state = 'provider_confirmed',
                    provider_effect_certainty = 'confirmed',
                    provider_facts = $2::jsonb,
                    provider_facts_digest = $3,
                    provider_reconciliation = $4,
                    provider_error_code = null,
                    provider_confirmed_at = $5
              where id = $1
                and state in (
                  'dispatching',
                  'reconciliation_required'
                )
              returning *`,
            [
              applicationRow.id,
              JSON.stringify(input.subscription),
              input.subscription.providerFactsDigest,
              input.reconciliation,
              input.confirmedAt
            ]
          );
          invariant(
            confirmed.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade provider confirmation was not stored",
            { status: 500 }
          );
          if (
            binding.upgrade_quote_state ===
            "reconciliation_required"
          ) {
            const resumed = await client.query(
              `update ss.alakazam_change_quotes
                  set state = 'provider_change_pending'
                where organization_id = $1
                  and id = $2
                  and state = 'reconciliation_required'
                returning id`,
              [reservation.tenantId, reservation.quoteId]
            );
            invariant(
              resumed.rowCount === 1,
              "repository_conflict",
              "the confirmed Alakazam upgrade quote was not resumed",
              { status: 500 }
            );
          }
          return upgradeProviderConfirmation(
            confirmed.rows[0],
            reservation,
            storedApplication
          );
        })
      );
    },

    async activateUpgradeSubscription(value) {
      const input = exactUpgradeActivationInput(value);
      const lookup = Object.freeze({
        stripeSubscriptionId:
          input.subscription.stripeSubscriptionId,
        subscriptionId: input.application.subscriptionId,
        quoteId: input.reservation.quoteId,
        receiptId: input.application.receiptId
      });
      return translated(() =>
        database.service({}, async (client) => {
          let selected = await selectUpgradeActivation(
            client,
            lookup
          );
          let resolved = upgradeActivationResolution(
            selected,
            lookup
          );
          invariant(
            digest(resolved.reservation) ===
                digest(input.reservation) &&
              digest(resolved.application) ===
                digest(input.application),
            "repository_conflict",
            "the paid Alakazam upgrade activation purpose changed",
            { status: 500 }
          );
          if (resolved.status === "applied") {
            return resolved.activation;
          }

          const row = selected.rows[0];
          const applicationRow =
            upgradeApplicationFromActivationRow(row);
          const confirmedSubscription =
            exactUpgradeProviderFacts(
              jsonObject(
                applicationRow.provider_facts,
                "upgradeActivation.confirmedProviderFacts"
              ),
              resolved.reservation,
              resolved.application,
              exactDatabaseIso(
                applicationRow.provider_confirmed_at,
                "upgradeActivation.providerConfirmedAt"
              )
            );
          const stableConfirmed = clone(
            confirmedSubscription
          );
          const stableLatest = clone(input.subscription);
          for (const facts of [stableConfirmed, stableLatest]) {
            delete facts.providerObservedAt;
            delete facts.providerFactsDigest;
          }
          invariant(
            resolved.status === "provider_confirmed" &&
              digest(stableLatest) ===
                digest(stableConfirmed) &&
              input.event.livemode ===
                row.upgrade_payment_livemode &&
              Date.parse(input.event.signatureVerifiedAt) >=
                Date.parse(
                  exactDatabaseIso(
                    applicationRow.provider_confirmed_at,
                    "upgradeActivation.providerConfirmedAt"
                  )
                ) &&
              Date.parse(
                input.subscription.providerObservedAt
              ) > Date.parse(
                exactDatabaseIso(
                  row.upgrade_provider_observed_at,
                  "upgradeActivation.currentProviderObservedAt"
                )
              ),
            "alakazam_upgrade_activation_reconciliation_unavailable",
            "the Alakazam upgrade Subscription confirmation is stale",
            { status: 409 }
          );

          const existingEvent = await client.query(
            `select id
               from ss.alakazam_stripe_events
              where stripe_event_id = $1
              for update`,
            [input.event.stripeEventId]
          );
          invariant(
            existingEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam upgrade Subscription event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = upgradeActivationEventFacts({
            event: input.event,
            reservation: resolved.reservation,
            application: resolved.application,
            subscription: input.subscription
          });
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
              resolved.reservation.tenantId,
              resolved.reservation.projectId,
              resolved.reservation.quoteId,
              resolved.application.subscriptionId,
              input.event.stripeEventId,
              input.event.eventType,
              input.event.livemode,
              input.event.apiVersion,
              input.event.stripeSubscriptionId,
              input.event.payloadDigest,
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            insertedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade Subscription event was not recorded",
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
            [resolved.reservation.tenantId, input.eventRowId]
          );
          invariant(
            claimedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade Subscription event was not claimed",
            { status: 500 }
          );
          const processedEvent = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed',
                    processed_at = $3
              where organization_id = $1
                and id = $2
                and state = 'processing'
              returning id`,
            [
              resolved.reservation.tenantId,
              input.eventRowId,
              input.event.signatureVerifiedAt
            ]
          );
          invariant(
            processedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade Subscription event was not completed",
            { status: 500 }
          );

          const tierFacts = upgradeActivationTierFacts({
            reservation: resolved.reservation,
            application: resolved.application,
            subscription: input.subscription
          });
          const current =
            resolved.reservation.purpose.currentSubscription;
          const resultRevision = current.revision + 1;
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
               null, null, $8,
               'upgrade_applied', $9, $10, $11,
               $12::jsonb, $13
             )
             returning id`,
            [
              input.tierEventId,
              resolved.reservation.tenantId,
              resolved.reservation.projectId,
              resolved.application.subscriptionId,
              resolved.reservation.quoteId,
              input.eventRowId,
              resolved.application.receiptId,
              resultRevision,
              current.tierId,
              resolved.reservation.purpose.targetTierId,
              input.event.occurredAt,
              JSON.stringify(tierFacts),
              digest(tierFacts)
            ]
          );
          invariant(
            tierEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade tier event was not recorded",
            { status: 500 }
          );

          const activated = await client.query(
            `update ss.alakazam_subscriptions
                set tier_id = $3,
                    amount_minor = $4,
                    stripe_price_id = $5,
                    provider_observed_at = $6,
                    provider_facts_digest = $7
              where organization_id = $1
                and id = $2
                and status = 'active'
                and revision = $8
                and tier_id = $9
                and stripe_subscription_id = $10
                and stripe_subscription_item_id = $11
                and stripe_price_id = $12
                and current_period_starts_at = $13
                and current_period_ends_at = $14
                and cancel_at_period_end = false
              returning id, tier_id, amount_minor,
                        stripe_price_id, revision,
                        current_period_starts_at,
                        current_period_ends_at,
                        provider_facts_digest`,
            [
              resolved.reservation.tenantId,
              resolved.application.subscriptionId,
              input.subscription.tierId,
              input.subscription.amountMinor,
              input.subscription.stripePriceId,
              input.subscription.providerObservedAt,
              input.subscription.providerFactsDigest,
              current.revision,
              current.tierId,
              current.stripeSubscriptionId,
              current.stripeSubscriptionItemId,
              current.stripePriceId,
              current.currentPeriodStartsAt,
              current.currentPeriodEndsAt
            ]
          );
          invariant(
            activated.rowCount === 1 &&
              activated.rows[0].tier_id ===
                resolved.reservation.purpose.targetTierId &&
              exactDatabaseInteger(
                activated.rows[0].amount_minor,
                "upgradeActivation.amountMinor"
              ) === input.subscription.amountMinor &&
              activated.rows[0].stripe_price_id ===
                input.subscription.stripePriceId &&
              exactDatabaseInteger(
                activated.rows[0].revision,
                "upgradeActivation.revision"
              ) === resultRevision &&
              exactSha(
                activated.rows[0].provider_facts_digest,
                "upgradeActivation.providerFactsDigest"
              ) === input.subscription.providerFactsDigest,
            "repository_conflict",
            "the paid Alakazam subscription was not upgraded",
            { status: 500 }
          );

          const appliedQuote = await client.query(
            `update ss.alakazam_change_quotes
                set state = 'applied'
              where organization_id = $1
                and id = $2
                and state = 'provider_change_pending'
              returning id`,
            [
              resolved.reservation.tenantId,
              resolved.reservation.quoteId
            ]
          );
          invariant(
            appliedQuote.rowCount === 1,
            "repository_conflict",
            "the activated Alakazam upgrade quote was not applied",
            { status: 500 }
          );
          const appliedApplication = await client.query(
            `update ss.alakazam_upgrade_applications
                set state = 'applied',
                    applied_at = $2
              where id = $1
                and state = 'provider_confirmed'
              returning id`,
            [
              resolved.application.applicationId,
              input.event.signatureVerifiedAt
            ]
          );
          invariant(
            appliedApplication.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade application was not applied",
            { status: 500 }
          );

          selected = await selectUpgradeActivation(
            client,
            lookup
          );
          resolved = upgradeActivationResolution(
            selected,
            lookup
          );
          invariant(
            resolved.status === "applied",
            "repository_conflict",
            "the Alakazam upgrade activation was not committed",
            { status: 500 }
          );
          return resolved.activation;
        })
      );
    },

    async markUpgradeReconciliationRequired(value) {
      const input = exactUpgradeReconciliationInput(value);
      const settlement = Object.freeze({
        status: "payment_settled",
        provider: "stripe",
        changeKind: "upgrade",
        dispatchId: input.reservation.dispatchId,
        projectId: input.reservation.projectId,
        quoteId: input.reservation.quoteId,
        subscriptionId: input.application.subscriptionId,
        receiptId: input.application.receiptId,
        paymentProviderFactsDigest:
          input.application.paymentProviderFactsDigest,
        next: "provider_change"
      });
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectPaidUpgrade(
            client,
            settlement,
            { lock: true }
          );
          const { reservation, row: binding } =
            paidUpgradeReservation(selected, settlement);
          invariant(
            digest(reservation) ===
              digest(input.reservation),
            "repository_conflict",
            "the paid Alakazam upgrade purpose changed",
            { status: 500 }
          );
          const applications = await client.query(
            `select *
               from ss.alakazam_upgrade_applications
              where id = $1
                and quote_id = $2
              for update`,
            [
              input.application.applicationId,
              reservation.quoteId
            ]
          );
          invariant(
            applications.rowCount === 1,
            "repository_conflict",
            "the Alakazam upgrade application is unavailable",
            { status: 500 }
          );
          const applicationRow = applications.rows[0];
          const storedApplication = storedUpgradeApplication(
            applicationRow,
            reservation,
            settlement
          );
          invariant(
            digest(storedApplication) ===
              digest(input.application),
            "repository_conflict",
            "the Alakazam upgrade application changed",
            { status: 500 }
          );
          exactUpgradeApplicationQuoteState(
            applicationRow,
            binding.upgrade_quote_state
          );
          if (applicationRow.state !== "dispatching") {
            return upgradeApplicationResolution(
              applicationRow,
              reservation,
              settlement
            );
          }
          const fenced = await client.query(
            `update ss.alakazam_upgrade_applications
                set state = 'reconciliation_required',
                    provider_effect_certainty = 'ambiguous',
                    provider_error_code = $2
              where id = $1
                and state = 'dispatching'
              returning *`,
            [applicationRow.id, input.errorCode]
          );
          const held = await client.query(
            `update ss.alakazam_change_quotes
                set state = 'reconciliation_required'
              where organization_id = $1
                and id = $2
                and state = 'provider_change_pending'
              returning id`,
            [reservation.tenantId, reservation.quoteId]
          );
          invariant(
            fenced.rowCount === 1 && held.rowCount === 1,
            "repository_conflict",
            "the ambiguous Alakazam upgrade was not fenced",
            { status: 500 }
          );
          return upgradeApplicationResolution(
            fenced.rows[0],
            reservation,
            settlement
          );
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

    async activateStartSubscription(value) {
      const reservation =
        exactCheckoutReservationValue(
          value?.reservation
        );
      const input = exactStartActivationInput(
        value,
        reservation
      );
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectStartActivation(
            client,
            {
              tenantId: reservation.tenantId,
              subscriptionId: input.subscriptionId
            }
          );
          invariant(
            selected.rowCount === 1,
            "stripe_event_binding_invalid",
            "the pending Alakazam start is unavailable for activation",
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
            digest(storedReservation) === digest(reservation) &&
              row.activation_subscription_id ===
                input.subscriptionId &&
              row.activation_stripe_subscription_id ===
                input.event.stripeSubscriptionId &&
              row.activation_stripe_customer_id ===
                reservation.stripeCustomerId &&
              row.activation_receipt_id === input.receiptId &&
              row.activation_payment_livemode ===
                input.event.livemode,
            "stripe_event_binding_invalid",
            "the Alakazam start activation binding changed",
            { status: 409 }
          );
          if (row.activation_subscription_status === "active") {
            return storedStartActivation(
              client,
              reservation,
              input.subscriptionId
            );
          }
          const pending = pendingStartActivation(
            row,
            reservation
          );
          invariant(
            input.subscription.stripeSubscriptionId ===
                pending.stripeSubscriptionId &&
              input.subscription.stripeSubscriptionItemId ===
                pending.stripeSubscriptionItemId &&
              input.subscription.stripePriceId ===
                pending.stripePriceId &&
              Date.parse(
                input.subscription.providerObservedAt
              ) > Date.parse(pending.providerObservedAt) &&
              Date.parse(
                input.subscription.providerObservedAt
              ) >= Date.parse(
                input.event.signatureVerifiedAt
              ) &&
              Date.parse(input.event.occurredAt) <=
                Date.parse(input.event.signatureVerifiedAt),
            "alakazam_activation_reconciliation_unavailable",
            "the Alakazam Subscription confirmation is stale",
            { status: 409 }
          );

          const existingEvent = await client.query(
            `select id
               from ss.alakazam_stripe_events
              where stripe_event_id = $1
              for update`,
            [input.event.stripeEventId]
          );
          invariant(
            existingEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam Subscription event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = {
            schema: ALAKAZAM_EVENT_FACTS_SCHEMA,
            provider: "stripe",
            stripeEventId: input.event.stripeEventId,
            eventType: input.event.eventType,
            stripeSubscriptionId:
              input.event.stripeSubscriptionId,
            purposeDigest: reservation.purposeDigest,
            payloadDigest: input.event.payloadDigest,
            metadata: input.event.metadata,
            subscriptionProviderFactsDigest:
              input.subscription.providerFactsDigest
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
              input.event.stripeSubscriptionId,
              input.event.payloadDigest,
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            insertedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam Subscription event was not recorded",
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
            "the Alakazam Subscription event was not claimed",
            { status: 500 }
          );
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
            "the Alakazam Subscription event was not completed",
            { status: 500 }
          );

          const tierFacts = {
            schema: ALAKAZAM_TIER_EVENT_FACTS_SCHEMA,
            changeKind: "start",
            purposeDigest: reservation.purposeDigest,
            subscriptionProviderFactsDigest:
              input.subscription.providerFactsDigest,
            receiptId: input.receiptId
          };
          const resultRevision = pending.revision + 1;
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
               null, null, $8,
               'start_applied', null, $9, $10,
               $11::jsonb, $12
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
              resultRevision,
              input.subscription.tierId,
              input.event.occurredAt,
              JSON.stringify(tierFacts),
              digest(tierFacts)
            ]
          );
          invariant(
            tierEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam start activation event was not recorded",
            { status: 500 }
          );

          const activated = await client.query(
            `update ss.alakazam_subscriptions
                set activation_receipt_id = $3,
                    status = 'active',
                    current_period_starts_at = $4,
                    current_period_ends_at = $5,
                    cancel_at_period_end = false,
                    provider_observed_at = $6,
                    provider_facts_digest = $7
              where organization_id = $1
                and id = $2
                and status = 'pending'
                and revision = $8
              returning id, tier_id, revision,
                        current_period_starts_at,
                        current_period_ends_at,
                        provider_facts_digest`,
            [
              reservation.tenantId,
              input.subscriptionId,
              input.receiptId,
              input.subscription.currentPeriodStartsAt,
              input.subscription.currentPeriodEndsAt,
              input.subscription.providerObservedAt,
              input.subscription.providerFactsDigest,
              pending.revision
            ]
          );
          invariant(
            activated.rowCount === 1 &&
              exactDatabaseInteger(
                activated.rows[0].revision,
                "startActivation.revision"
              ) === resultRevision,
            "repository_conflict",
            "the pending Alakazam subscription was not activated",
            { status: 500 }
          );
          const appliedQuote = await client.query(
            `update ss.alakazam_change_quotes
                set state = 'applied'
              where organization_id = $1
                and id = $2
                and state = 'payment_settled'
              returning id`,
            [reservation.tenantId, reservation.quoteId]
          );
          invariant(
            appliedQuote.rowCount === 1,
            "repository_conflict",
            "the activated Alakazam start quote was not applied",
            { status: 500 }
          );

          return startActivationResult({
            reservation,
            subscriptionId: activated.rows[0].id,
            receiptId: input.receiptId,
            tierId: activated.rows[0].tier_id,
            revision: resultRevision,
            currentPeriodStartsAt: exactDatabaseIso(
              activated.rows[0].current_period_starts_at,
              "startActivation.currentPeriodStartsAt"
            ),
            currentPeriodEndsAt: exactDatabaseIso(
              activated.rows[0].current_period_ends_at,
              "startActivation.currentPeriodEndsAt"
            ),
            providerFactsDigest: exactSha(
              activated.rows[0].provider_facts_digest,
              "startActivation.providerFactsDigest"
            )
          });
        })
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
