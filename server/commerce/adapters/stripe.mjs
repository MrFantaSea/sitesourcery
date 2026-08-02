import Stripe from "stripe";

import {
  digest,
  normalizeDomain
} from "../../domain/canonical.mjs";
import {
  ExternalEffectError,
  invariant
} from "../../domain/errors.mjs";
import { createHeldStripeAdapter } from "./held.mjs";

export const STRIPE_API_VERSION = "2026-06-24.dahlia";
export const STRIPE_PROVIDER_MODES = Object.freeze([
  "held",
  "contract_test",
  "approved_live"
]);

const LIVE_ENVIRONMENTS = new Set(["staging", "production"]);
const LIVE_CAPABILITIES = new Set([
  "billing_portal:create",
  "checkout:create",
  "domain_authorization:cancel",
  "domain_authorization:capture",
  "domain_authorization:create",
  "domain_authorization:read",
  "domain_refunds:create",
  "prices:read",
  "subscriptions:cancel",
  "webhooks:verify"
]);
const BILLING_INTERVALS = new Set(["month", "year"]);
const CANCELLABLE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "incomplete",
  "past_due",
  "paused",
  "trialing",
  "unpaid"
]);
const CHECKOUT_HOSTS = new Set(["checkout.stripe.com"]);
const PORTAL_HOSTS = new Set(["billing.stripe.com"]);
const PROVIDER_ID = /^(?:bps|ch|cs|cus|pi|price|re|sub|txn)_[A-Za-z0-9_]+$/u;
const SAFE_METADATA_VALUE = /^[A-Za-z0-9._:-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OFFICIAL_CLIENTS = new WeakSet();
const DOWNLOAD_CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.abracadabra-checkout-purpose.v2";
const DOWNLOAD_CHECKOUT_METADATA_SCHEMA =
  "sitesourcery_download_checkout_v2";
const DOWNLOAD_CHECKOUT_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-download-checkout-lifecycle/v2";

export function createOfficialStripeClient({
  secretKey,
  livemode,
  apiVersion = STRIPE_API_VERSION
} = {}) {
  const selectedKey = requiredText(
    secretKey,
    "Stripe secret key",
    500
  );
  invariant(
    typeof livemode === "boolean" &&
      apiVersion === STRIPE_API_VERSION &&
      (
        livemode
          ? selectedKey.startsWith("sk_live_")
          : selectedKey.startsWith("sk_test_")
      ),
    "stripe_configuration_required",
    "Stripe credentials must match the exact mode and pinned API version",
    { status: 500 }
  );
  const client = new Stripe(selectedKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    telemetry: false,
    appInfo: {
      name: "Site Sourcery",
      version: "0.0.0"
    }
  });
  OFFICIAL_CLIENTS.add(client);
  return client;
}

function noEffect(code, message, details = null) {
  return new ExternalEffectError(code, message, {
    certainty: "not_submitted",
    details
  });
}

function ambiguous(code, message, details = null) {
  return new ExternalEffectError(code, message, {
    certainty: "ambiguous",
    details
  });
}

function requiredText(value, field, maximum = 500) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum,
    "stripe_input_invalid",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function safeMetadataValue(value, field) {
  const selected = requiredText(value, field, 500);
  invariant(
    SAFE_METADATA_VALUE.test(selected),
    "stripe_metadata_invalid",
    `${field} contains unsafe metadata characters`,
    { status: 500 }
  );
  return selected;
}

function providerId(value, prefix, field) {
  const selected = requiredText(value, field, 255);
  invariant(
    selected.startsWith(`${prefix}_`) && PROVIDER_ID.test(selected),
    "stripe_provider_id_invalid",
    `${field} is invalid`,
    { status: 502 }
  );
  return selected;
}

function integer(value, field, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum,
    "stripe_input_invalid",
    `${field} is invalid`,
    { status: 500 }
  );
  return value;
}

function exactUrl(value, field, {
  checkoutSessionPlaceholder = false
} = {}) {
  const selected = requiredText(value, field, 2000);
  if (checkoutSessionPlaceholder) {
    invariant(
      selected.includes("{CHECKOUT_SESSION_ID}"),
      "stripe_redirect_invalid",
      `${field} must contain the Stripe Checkout Session placeholder`,
      { status: 500 }
    );
  }
  let parsed;
  try {
    parsed = new URL(selected);
  } catch {
    invariant(
      false,
      "stripe_redirect_invalid",
      `${field} must be an absolute URL`,
      { status: 500 }
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "stripe_redirect_invalid",
    `${field} must be a credential-free HTTPS URL without a fragment`,
    { status: 500 }
  );
  const normalized = parsed.toString();
  return checkoutSessionPlaceholder
    ? normalized.replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      )
    : normalized;
}

function returnOrigin(url) {
  const parsed = new URL(url);
  return parsed.origin;
}

function downloadReturnUrl(template, projectId) {
  const parsed = new URL(template);
  invariant(
    !parsed.searchParams.has("download_project"),
    "stripe_redirect_invalid",
    "Download return URL already contains project identity",
    { status: 500 }
  );
  parsed.searchParams.set(
    "download_project",
    safeMetadataValue(projectId, "projectId")
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Download success URL",
    { checkoutSessionPlaceholder: true }
  );
}

function renderDomainReturnUrl(
  template,
  orderId,
  field,
  { checkoutSessionPlaceholder = false } = {}
) {
  const selected = requiredText(template, field, 2000);
  invariant(
    selected.includes("{ORDER_ID}"),
    "stripe_redirect_invalid",
    `${field} must contain the exact order placeholder`,
    { status: 500 }
  );
  const rendered = selected.replace(
    "{ORDER_ID}",
    safeMetadataValue(orderId, "orderId")
  );
  invariant(
    !rendered.includes("{ORDER_ID}"),
    "stripe_redirect_invalid",
    `${field} can contain the order placeholder only once`,
    { status: 500 }
  );
  return exactUrl(rendered, field, {
    checkoutSessionPlaceholder
  });
}

function liveApproval(value) {
  invariant(
    value &&
      value.provider === "stripe" &&
      value.approved === true &&
      value.apiVersion === STRIPE_API_VERSION &&
      typeof value.livemode === "boolean" &&
      LIVE_ENVIRONMENTS.has(value.environment) &&
      typeof value.approvalId === "string" &&
      value.approvalId.length >= 8 &&
      value.approvalId.length <= 200 &&
      Number.isFinite(Date.parse(value.approvedAt)) &&
      Array.isArray(value.capabilities) &&
      value.capabilities.length > 0 &&
      value.capabilities.every((item) =>
        LIVE_CAPABILITIES.has(item)
      ) &&
      new Set(value.capabilities).size ===
        value.capabilities.length,
    "stripe_live_approval_missing",
    "Stripe live construction requires an exact environment-bound approval",
    { status: 500 }
  );
  return Object.freeze({
    ...structuredClone(value),
    capabilities: Object.freeze([...value.capabilities])
  });
}

function validateClient(client) {
  invariant(
    client &&
      typeof client.prices?.retrieve === "function" &&
      typeof client.checkout?.sessions?.create === "function" &&
      typeof client.billingPortal?.sessions?.create ===
        "function" &&
      typeof client.subscriptions?.update === "function" &&
      typeof client.webhooks?.constructEvent === "function",
    "stripe_client_invalid",
    "The official Stripe client contract is required",
    { status: 500 }
  );
  return client;
}

function normalizedExpectation(value, index, livemode) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "stripe_price_expectation_invalid",
    `Stripe Price expectation ${index} is invalid`,
    { status: 500 }
  );
  const id = providerId(value.id, "price", `priceExpectations[${index}].id`);
  const currency = requiredText(
    value.currency,
    `priceExpectations[${index}].currency`,
    3
  ).toLowerCase();
  invariant(
    currency === "usd",
    "stripe_price_expectation_invalid",
    "Only exact USD Stripe Prices are supported",
    { status: 500 }
  );
  const unitAmount = integer(
    value.unitAmount,
    `priceExpectations[${index}].unitAmount`,
    0,
    99_999_999
  );
  let recurring = null;
  if (value.recurring !== null && value.recurring !== undefined) {
    invariant(
      value.recurring &&
        BILLING_INTERVALS.has(value.recurring.interval) &&
        (value.recurring.intervalCount ?? 1) === 1,
      "stripe_price_expectation_invalid",
      `Stripe Price expectation ${id} has an invalid recurring interval`,
      { status: 500 }
    );
    recurring = {
      interval: value.recurring.interval,
      intervalCount: 1
    };
  }
  invariant(
    value.livemode === livemode,
    "stripe_price_expectation_invalid",
    `Stripe Price expectation ${id} has the wrong livemode`,
    { status: 500 }
  );
  return Object.freeze({
    id,
    active: true,
    currency,
    unitAmount,
    livemode,
    recurring
  });
}

function validateConfig(value, mode) {
  const config = value && typeof value === "object" ? value : {};
  invariant(
    typeof config.livemode === "boolean",
    "stripe_configuration_required",
    "Stripe livemode must be configured explicitly",
    { status: 500 }
  );
  const successUrl = exactUrl(
    config.successUrl,
    "successUrl",
    { checkoutSessionPlaceholder: true }
  );
  const cancelUrl = exactUrl(config.cancelUrl, "cancelUrl");
  const portalReturnUrl = exactUrl(
    config.portalReturnUrl,
    "portalReturnUrl"
  );
  const suppliedOrigins = Array.isArray(
    config.approvedReturnOrigins
  )
    ? config.approvedReturnOrigins
    : [];
  const approvedReturnOrigins = new Set();
  for (const [index, origin] of suppliedOrigins.entries()) {
    const parsed = exactUrl(
      origin,
      `approvedReturnOrigins[${index}]`
    );
    invariant(
      new URL(parsed).origin === parsed.replace(/\/$/u, ""),
      "stripe_redirect_invalid",
      "Approved Stripe return origins cannot contain a path, query, or fragment",
      { status: 500 }
    );
    approvedReturnOrigins.add(new URL(parsed).origin);
  }
  invariant(
    approvedReturnOrigins.size > 0 &&
      [successUrl, cancelUrl, portalReturnUrl].every((url) =>
        approvedReturnOrigins.has(returnOrigin(url))
      ),
    "stripe_redirect_invalid",
    "Every Stripe return URL must use an exact approved origin",
    { status: 500 }
  );
  invariant(
    config.taxMode === "automatic" ||
      config.taxMode === "disabled_by_owner",
    "stripe_tax_decision_required",
    "Stripe tax mode requires an explicit owner decision",
    { status: 500 }
  );
  const webhookSecret = requiredText(
    config.webhookSecret,
    "webhookSecret",
    500
  );
  if (mode === "approved_live") {
    invariant(
      webhookSecret.startsWith("whsec_"),
      "stripe_configuration_required",
      "Stripe webhook signing secret is invalid",
      { status: 500 }
    );
  }
  const priceExpectations = (
    Array.isArray(config.priceExpectations)
      ? config.priceExpectations
      : []
  ).map((item, index) =>
    normalizedExpectation(item, index, config.livemode)
  );
  invariant(
    new Set(priceExpectations.map(({ id }) => id)).size ===
      priceExpectations.length,
    "stripe_price_expectation_invalid",
    "Stripe Price expectations must be unique",
    { status: 500 }
  );
  let domainAuthorization = null;
  if (
    config.domainAuthorization !== null &&
    config.domainAuthorization !== undefined
  ) {
    invariant(
      config.domainAuthorization &&
        typeof config.domainAuthorization === "object" &&
        !Array.isArray(config.domainAuthorization),
      "stripe_domain_configuration_invalid",
      "Stripe domain authorization configuration is invalid",
      { status: 500 }
    );
    const successUrlTemplate = requiredText(
      config.domainAuthorization.successUrlTemplate,
      "domainAuthorization.successUrlTemplate",
      2000
    );
    const cancelUrlTemplate = requiredText(
      config.domainAuthorization.cancelUrlTemplate,
      "domainAuthorization.cancelUrlTemplate",
      2000
    );
    const renderedSuccess = renderDomainReturnUrl(
      successUrlTemplate,
      "order_template_probe",
      "domainAuthorization.successUrlTemplate",
      { checkoutSessionPlaceholder: true }
    );
    const renderedCancel = renderDomainReturnUrl(
      cancelUrlTemplate,
      "order_template_probe",
      "domainAuthorization.cancelUrlTemplate"
    );
    invariant(
      [renderedSuccess, renderedCancel].every((url) =>
        approvedReturnOrigins.has(returnOrigin(url))
      ),
      "stripe_redirect_invalid",
      "Every domain authorization return URL must use an exact approved origin",
      { status: 500 }
    );
    domainAuthorization = Object.freeze({
      successUrlTemplate,
      cancelUrlTemplate,
      authorizationDisclosure: requiredText(
        config.domainAuthorization
          .authorizationDisclosure,
        "domainAuthorization.authorizationDisclosure",
        500
      )
    });
  }
  return Object.freeze({
    apiVersion: STRIPE_API_VERSION,
    livemode: config.livemode,
    successUrl,
    cancelUrl,
    portalReturnUrl,
    approvedReturnOrigins: Object.freeze(
      [...approvedReturnOrigins].sort()
    ),
    taxMode: config.taxMode,
    webhookSecret,
    checkoutTtlSeconds: integer(
      config.checkoutTtlSeconds ?? 1800,
      "checkoutTtlSeconds",
      1800,
      86400
    ),
    priceExpectations: Object.freeze(priceExpectations),
    domainAuthorization
  });
}

function checkoutMoney(value, field, recurring = false) {
  invariant(
    value &&
      Number.isSafeInteger(value.amountMinor) &&
      value.amountMinor >= 0 &&
      value.currency === "USD" &&
      (
        !recurring ||
        BILLING_INTERVALS.has(value.interval)
      ),
    "stripe_checkout_purpose_invalid",
    `${field} is invalid`,
    { status: 500 }
  );
  return recurring
    ? {
        amountMinor: value.amountMinor,
        currency: "USD",
        interval: value.interval
      }
    : {
        amountMinor: value.amountMinor,
        currency: "USD"
      };
}

function validatePurpose(request) {
  invariant(
    request &&
      request.purpose &&
      typeof request.purpose === "object" &&
      !Array.isArray(request.purpose),
    "stripe_checkout_purpose_invalid",
    "Checkout purpose is required",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "quoteId",
    "catalogVersion",
    "offerId",
    "disclosureDigest"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  invariant(
    SHA256.test(identity.disclosureDigest),
    "stripe_checkout_purpose_invalid",
    "Checkout disclosure digest is invalid",
    { status: 500 }
  );
  integer(
    purpose.quoteVersion,
    "purpose.quoteVersion",
    1,
    Number.MAX_SAFE_INTEGER
  );
  invariant(
    Array.isArray(purpose.lines) &&
      purpose.lines.length > 0 &&
      purpose.lines.length <= 32,
    "stripe_checkout_purpose_invalid",
    "Checkout must contain between 1 and 32 authoritative lines",
    { status: 500 }
  );
  const lines = purpose.lines.map((line, index) => {
    invariant(
      line && typeof line === "object" && !Array.isArray(line),
      "stripe_checkout_purpose_invalid",
      `Checkout line ${index} is invalid`,
      { status: 500 }
    );
    const lineItemId = safeMetadataValue(
      line.lineItemId,
      `purpose.lines[${index}].lineItemId`
    );
    const receiptGroupId = safeMetadataValue(
      line.receiptGroupId,
      `purpose.lines[${index}].receiptGroupId`
    );
    const amounts = {};
    if (line.amounts?.oneTime) {
      amounts.oneTime = checkoutMoney(
        line.amounts.oneTime,
        `purpose.lines[${index}].amounts.oneTime`
      );
    }
    if (line.amounts?.recurring) {
      amounts.recurring = checkoutMoney(
        line.amounts.recurring,
        `purpose.lines[${index}].amounts.recurring`,
        true
      );
    }
    invariant(
      amounts.oneTime || amounts.recurring,
      "stripe_checkout_purpose_invalid",
      `Checkout line ${index} has no money`,
      { status: 500 }
    );
    const authority = line.authority;
    invariant(
      authority && typeof authority === "object",
      "stripe_checkout_purpose_invalid",
      `Checkout line ${index} has no server authority`,
      { status: 500 }
    );
    if (authority.type === "stripe_price_refs") {
      const refs = {};
      for (const component of ["oneTime", "recurring"]) {
        invariant(
          Boolean(amounts[component]) ===
            Boolean(authority.refs?.[component]),
          "stripe_checkout_purpose_invalid",
          `Checkout line ${index} Price references do not match its billing shape`,
          { status: 500 }
        );
        if (amounts[component]) {
          refs[component] = providerId(
            authority.refs[component],
            "price",
            `purpose.lines[${index}].authority.refs.${component}`
          );
        }
      }
      return {
        lineItemId,
        receiptGroupId,
        amounts,
        authority: { type: authority.type, refs }
      };
    }
    invariant(
      authority.type === "server_price_data" &&
        lineItemId.startsWith("domain:") &&
        amounts.oneTime &&
        !amounts.recurring &&
        authority.priceData?.currency === "usd" &&
        authority.priceData?.unitAmount ===
          amounts.oneTime.amountMinor,
      "stripe_checkout_purpose_invalid",
      `Checkout line ${index} dynamic price is invalid`,
      { status: 500 }
    );
    return {
      lineItemId,
      receiptGroupId,
      amounts,
      authority: {
        type: authority.type,
        priceData: {
          currency: "usd",
          unitAmount: amounts.oneTime.amountMinor
        }
      }
    };
  });
  invariant(
    new Set(lines.map(({ lineItemId }) => lineItemId)).size ===
        lines.length &&
      new Set(lines.map(({ receiptGroupId }) => receiptGroupId))
        .size === lines.length,
    "stripe_checkout_purpose_invalid",
    "Checkout line and receipt-group identities must be unique",
    { status: 500 }
  );
  const expectedDigest = digest(purpose);
  invariant(
    request.purposeDigest === expectedDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_checkout_purpose_invalid",
    "Checkout purpose digest does not match the authoritative purpose",
    { status: 500 }
  );
  const idempotencyKey = requiredText(
    request.idempotencyKey,
    "idempotencyKey",
    255
  );
  return {
    purpose,
    identity,
    lines,
    purposeDigest: expectedDigest,
    idempotencyKey,
    stripeCustomerId: request.stripeCustomerId
      ? providerId(
          request.stripeCustomerId,
          "cus",
          "stripeCustomerId"
        )
      : null
  };
}

function priceMatches(price, expected) {
  return (
    price &&
    price.id === expected.id &&
    price.active === true &&
    price.livemode === expected.livemode &&
    price.currency === expected.currency &&
    price.unit_amount === expected.unitAmount &&
    (
      expected.recurring === null
        ? price.recurring === null
        : price.recurring?.interval ===
            expected.recurring.interval &&
          price.recurring?.interval_count === 1
    )
  );
}

function metadata(validated) {
  return {
    schema: "sitesourcery_checkout_v1",
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    quote_id: validated.identity.quoteId,
    quote_version: String(
      validated.purpose.quoteVersion
    ),
    catalog_version: validated.identity.catalogVersion,
    offer_id: validated.identity.offerId,
    disclosure_digest:
      validated.identity.disclosureDigest,
    purpose_digest: validated.purposeDigest,
    receipt_groups_digest: digest(
      validated.lines.map(
        ({ lineItemId, receiptGroupId }) => ({
          lineItemId,
          receiptGroupId
        })
      )
    ),
    line_count: String(validated.lines.length)
  };
}

function providerIdempotencyKey(
  operation,
  operatorKey,
  purposeDigest
) {
  return `ss:${operation}:${digest({
    operation,
    operatorKey,
    purposeDigest
  })}`;
}

function exactObjectKeys(value, fields) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...fields].sort())
  );
}

function validateDownloadPurpose(
  request,
  { retrieval = false } = {}
) {
  const requestFields = retrieval
    ? [
        "checkoutSessionId",
        "purpose",
        "purposeDigest"
      ]
    : [
        "idempotencyKey",
        "purpose",
        "purposeDigest",
        ...(request?.stripeCustomerId === undefined
          ? []
          : ["stripeCustomerId"])
      ];
  invariant(
    exactObjectKeys(
      request,
      requestFields
    ) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "customerId",
        "entitlementKind",
        "offerId",
        "price",
        "projectId",
        "quoteId",
        "quoteSnapshotDigest",
        "schema",
        "tenantId",
        "versionId"
      ]),
    "stripe_download_checkout_invalid",
    "Download Checkout requires the exact server purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "versionId",
    "quoteId",
    "offerId",
    "entitlementKind"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  invariant(
    purpose.schema === DOWNLOAD_CHECKOUT_PURPOSE_SCHEMA &&
      identity.offerId === "spark_download" &&
      identity.entitlementKind === "spark_download" &&
      exactObjectKeys(purpose.price, [
        "amountMinor",
        "billing",
        "currency",
        "interval"
      ]) &&
      purpose.price.amountMinor === 500 &&
      purpose.price.currency === "USD" &&
      purpose.price.billing === "one_time" &&
      purpose.price.interval === null,
    "stripe_download_checkout_invalid",
    "Download Checkout permits only the reviewed one-time $5 offer",
    { status: 500 }
  );
  const acceptedDisclosureDigest = safeMetadataValue(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  const quoteSnapshotDigest = safeMetadataValue(
    purpose.quoteSnapshotDigest,
    "purpose.quoteSnapshotDigest"
  );
  invariant(
    SHA256.test(acceptedDisclosureDigest) &&
      SHA256.test(quoteSnapshotDigest),
    "stripe_download_checkout_invalid",
    "Download Checkout disclosure authority is invalid",
    { status: 500 }
  );
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_download_checkout_invalid",
    "Download Checkout purpose digest changed",
    { status: 500 }
  );
  return Object.freeze({
    purpose,
    identity,
    acceptedDisclosureDigest,
    quoteSnapshotDigest,
    purposeDigest,
    stripeCustomerId:
      retrieval ||
      request.stripeCustomerId === undefined
        ? null
        : providerId(
            request.stripeCustomerId,
            "cus",
            "stripeCustomerId"
          ),
    idempotencyKey: retrieval
      ? null
      : requiredText(
          request.idempotencyKey,
          "idempotencyKey",
          255
        )
  });
}

function downloadMetadata(validated) {
  return Object.freeze({
    schema: DOWNLOAD_CHECKOUT_METADATA_SCHEMA,
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    version_id: validated.identity.versionId,
    quote_id: validated.identity.quoteId,
    offer_id: "spark_download",
    entitlement_kind: "spark_download",
    accepted_disclosure_digest:
      validated.acceptedDisclosureDigest,
    quote_snapshot_digest:
      validated.quoteSnapshotDigest,
    purpose_digest: validated.purposeDigest
  });
}

function validateDownloadMetadata(value, expected) {
  invariant(
    exactObjectKeys(value, Object.keys(expected)) &&
      Object.entries(expected).every(
        ([key, expectedValue]) =>
          value[key] === expectedValue
      ),
    "stripe_download_checkout_response_invalid",
    "Stripe Download metadata changed",
    { status: 502 }
  );
}

function downloadCheckoutFacts(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Download Checkout Session ID"
  );
  const expectedMetadata =
    downloadMetadata(validated);
  validateDownloadMetadata(
    value.metadata,
    expectedMetadata
  );
  const automaticTax =
    config.taxMode === "automatic";
  const taxMinor = automaticTax
    ? integer(
        value.total_details?.amount_tax,
        "Stripe Download tax amount",
        0,
        99_999_999
      )
    : 0;
  const totalMinor = 500 + taxMinor;
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.quoteId &&
      value.mode === "payment" &&
      value.livemode === config.livemode &&
      value.status === "complete" &&
      value.payment_status === "paid" &&
      value.currency === "usd" &&
      value.amount_subtotal === 500 &&
      value.amount_total === totalMinor &&
      value.automatic_tax?.enabled === automaticTax &&
      (
        automaticTax
          ? value.automatic_tax?.status === "complete" &&
            value.total_details?.amount_discount === 0 &&
            value.total_details?.amount_shipping === 0
          : (
              value.automatic_tax?.status === null ||
              value.automatic_tax?.status === undefined
            )
      ),
    "stripe_download_checkout_response_invalid",
    "Stripe did not confirm the exact paid $5 Download Checkout",
    { status: 502 }
  );
  const intent = expandedProviderObject(
    value.payment_intent,
    "pi",
    "Stripe Download PaymentIntent"
  );
  validateDownloadMetadata(
    intent.metadata,
    expectedMetadata
  );
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === totalMinor &&
      intent.amount_received === totalMinor &&
      intent.amount_capturable === 0,
    "stripe_download_checkout_response_invalid",
    "Stripe did not confirm the exact succeeded $5 Download payment",
    { status: 502 }
  );
  return Object.freeze({
    schema:
      "sitesourcery.stripe-download-payment-facts/v2",
    provider: "stripe",
    checkoutSessionId: checkoutId,
    paymentIntentId: intent.id,
    customerId: providerId(
      value.customer,
      "cus",
      "Stripe Download Customer ID"
    ),
    paymentStatus: "paid",
    amountMinor: 500,
    taxMinor,
    totalMinor,
    taxMode: config.taxMode,
    currency: "USD",
    purposeDigest: validated.purposeDigest
  });
}

function downloadCheckoutLifecycle(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Download Checkout Session ID"
  );
  validateDownloadMetadata(
    value?.metadata,
    downloadMetadata(validated)
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.quoteId &&
      value.mode === "payment" &&
      value.livemode === config.livemode &&
      value.currency === "usd" &&
      value.amount_subtotal === 500 &&
      value.automatic_tax?.enabled ===
        (config.taxMode === "automatic"),
    "stripe_download_checkout_response_invalid",
    "Stripe did not return the exact Download Checkout lifecycle",
    { status: 502 }
  );
  let state;
  if (
    value.status === "expired" &&
    value.payment_status === "unpaid"
  ) {
    state = "expired_unpaid";
  } else if (
    value.status === "open" &&
    value.payment_status === "unpaid"
  ) {
    state = "open_unpaid";
  } else if (
    value.status === "complete" &&
    ["paid", "unpaid"].includes(
      value.payment_status
    )
  ) {
    state = "completion_pending";
  } else {
    invariant(
      false,
      "stripe_download_checkout_response_invalid",
      "Stripe returned an unsafe Download Checkout lifecycle",
      { status: 502 }
    );
  }
  return Object.freeze({
    schema: DOWNLOAD_CHECKOUT_LIFECYCLE_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    state
  });
}

function domainProviderClient(client) {
  invariant(
    typeof client.checkout?.sessions?.retrieve ===
        "function" &&
      typeof client.paymentIntents?.retrieve ===
        "function" &&
      typeof client.paymentIntents?.capture ===
        "function" &&
      typeof client.paymentIntents?.cancel ===
        "function" &&
      typeof client.refunds?.create === "function",
    "stripe_client_invalid",
    "Stripe domain authorization requires Checkout, PaymentIntent, and Refund provider methods",
    { status: 500 }
  );
  return client;
}

function domainAuthorizationRequest(request, config) {
  invariant(
    request && typeof request === "object" &&
      !Array.isArray(request) &&
      config.domainAuthorization,
    "stripe_domain_authorization_held",
    "Stripe domain authorization is not configured",
    { status: 503 }
  );
  const identity = {};
  for (const field of [
    "organizationId",
    "projectId",
    "customerId",
    "orderId",
    "quoteId"
  ]) {
    identity[field] = safeMetadataValue(
      request[field],
      field
    );
  }
  const domain = normalizeDomain(request.domain);
  const years = integer(request.years, "years", 1, 10);
  const amountMinor = integer(
    request.amountMinor,
    "amountMinor",
    50,
    99_999_999
  );
  invariant(
    request.currency === "USD",
    "stripe_domain_authorization_invalid",
    "Domain authorization supports exact USD money only",
    { status: 500 }
  );
  const purpose = Object.freeze({
    schema: "sitesourcery.domain-authorization.v1",
    organizationId: identity.organizationId,
    projectId: identity.projectId,
    customerId: identity.customerId,
    orderId: identity.orderId,
    quoteId: identity.quoteId,
    domain,
    years,
    amount: {
      amountMinor,
      currency: "USD"
    },
    captureMethod: "manual"
  });
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_domain_authorization_invalid",
    "Domain authorization purpose does not match the exact server quote",
    { status: 500 }
  );
  const successUrl = exactUrl(
    request.successUrl,
    "successUrl",
    { checkoutSessionPlaceholder: true }
  );
  const cancelUrl = exactUrl(
    request.cancelUrl,
    "cancelUrl"
  );
  const expectedSuccess = renderDomainReturnUrl(
    config.domainAuthorization.successUrlTemplate,
    identity.orderId,
    "domainAuthorization.successUrlTemplate",
    { checkoutSessionPlaceholder: true }
  );
  const expectedCancel = renderDomainReturnUrl(
    config.domainAuthorization.cancelUrlTemplate,
    identity.orderId,
    "domainAuthorization.cancelUrlTemplate"
  );
  invariant(
    successUrl === expectedSuccess &&
      cancelUrl === expectedCancel,
    "stripe_redirect_invalid",
    "Domain authorization return URLs do not match the exact configured templates",
    { status: 500 }
  );
  return Object.freeze({
    identity: Object.freeze(identity),
    domain,
    years,
    amountMinor,
    currency: "USD",
    purpose,
    purposeDigest,
    successUrl,
    cancelUrl,
    idempotencyKey: requiredText(
      request.idempotencyKey,
      "idempotencyKey",
      255
    )
  });
}

function domainProviderMetadata(validated) {
  return {
    schema: "sitesourcery_domain_authorization_v1",
    organization_id: validated.identity.organizationId,
    project_id: validated.identity.projectId,
    customer_id: validated.identity.customerId,
    order_id: validated.identity.orderId,
    quote_id: validated.identity.quoteId,
    domain: validated.domain,
    years: String(validated.years),
    amount_minor: String(validated.amountMinor),
    currency: "USD",
    capture_method: "manual",
    purpose_digest: validated.purposeDigest
  };
}

function exactProviderTime(value, field) {
  const seconds = integer(
    value,
    field,
    1,
    Number.MAX_SAFE_INTEGER
  );
  return new Date(seconds * 1000).toISOString();
}

function domainMetadataFacts(
  metadataValue,
  {
    orderId,
    purposeDigest,
    amountMinor = null
  }
) {
  const metadata =
    metadataValue &&
    typeof metadataValue === "object" &&
    !Array.isArray(metadataValue)
      ? metadataValue
      : {};
  invariant(
    metadata.schema ===
        "sitesourcery_domain_authorization_v1" &&
      metadata.order_id === orderId &&
      metadata.purpose_digest === purposeDigest &&
      metadata.currency === "USD" &&
      metadata.capture_method === "manual" &&
      /^[0-9]{2,8}$/u.test(metadata.amount_minor),
    "stripe_domain_authorization_response_invalid",
    "Stripe domain authorization metadata changed",
    { status: 502 }
  );
  const observedAmount = Number(metadata.amount_minor);
  invariant(
    Number.isSafeInteger(observedAmount) &&
      observedAmount >= 50 &&
      (
        amountMinor === null ||
        observedAmount === amountMinor
      ),
    "stripe_domain_authorization_response_invalid",
    "Stripe domain authorization amount metadata changed",
    { status: 502 }
  );
  return {
    amountMinor: observedAmount,
    organizationId: safeMetadataValue(
      metadata.organization_id,
      "metadata.organization_id"
    ),
    projectId: safeMetadataValue(
      metadata.project_id,
      "metadata.project_id"
    ),
    customerId: safeMetadataValue(
      metadata.customer_id,
      "metadata.customer_id"
    ),
    quoteId: safeMetadataValue(
      metadata.quote_id,
      "metadata.quote_id"
    ),
    domain: normalizeDomain(metadata.domain),
    years: integer(
      Number(metadata.years),
      "metadata.years",
      1,
      10
    )
  };
}

function expandedProviderObject(value, prefix, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
    "stripe_domain_authorization_response_invalid",
    `${field} was not expanded by Stripe`,
    { status: 502 }
  );
  providerId(value.id, prefix, `${field}.id`);
  return value;
}

function domainSessionFacts(
  value,
  config,
  {
    checkoutSessionId = null,
    orderId,
    purposeDigest,
    amountMinor = null
  }
) {
  const sessionId = providerId(
    value?.id,
    "cs",
    "Stripe domain Checkout Session ID"
  );
  const metadata = domainMetadataFacts(
    value.metadata,
    { orderId, purposeDigest, amountMinor }
  );
  invariant(
    (
      checkoutSessionId === null ||
      sessionId === checkoutSessionId
    ) &&
      value.client_reference_id === orderId &&
      value.mode === "payment" &&
      value.livemode === config.livemode &&
      value.currency === "usd" &&
      value.amount_total === metadata.amountMinor &&
      ["open", "complete", "expired"].includes(
        value.status
      ),
    "stripe_domain_authorization_response_invalid",
    "Stripe domain Checkout readback changed",
    { status: 502 }
  );
  return {
    checkoutSessionId: sessionId,
    amountMinor: metadata.amountMinor,
    metadata,
    paymentIntent: value.payment_intent ?? null,
    sessionStatus: value.status,
    expiresAt: exactProviderTime(
      value.expires_at,
      "Stripe domain Checkout expiry"
    )
  };
}

function paymentIntentFacts(
  value,
  config,
  {
    orderId,
    purposeDigest,
    paymentIntentId = null,
    amountMinor = null
  }
) {
  const intentId = providerId(
    value?.id,
    "pi",
    "Stripe PaymentIntent ID"
  );
  const metadata = domainMetadataFacts(
    value.metadata,
    { orderId, purposeDigest, amountMinor }
  );
  invariant(
    (
      paymentIntentId === null ||
      intentId === paymentIntentId
    ) &&
      value.livemode === config.livemode &&
      value.currency === "usd" &&
      value.amount === metadata.amountMinor &&
      value.capture_method === "manual",
    "stripe_domain_authorization_response_invalid",
    "Stripe PaymentIntent readback changed",
    { status: 502 }
  );
  return {
    paymentIntentId: intentId,
    amountMinor: metadata.amountMinor,
    metadata,
    paymentIntent: value
  };
}

function domainAuthorizationProjection(
  session,
  config,
  {
    orderId,
    purposeDigest
  }
) {
  const base = {
    checkoutSessionId: session.checkoutSessionId,
    paymentIntentId: null,
    captureId: null,
    amountMinor: session.amountMinor,
    currency: "USD",
    captureMethod: "manual",
    purposeDigest,
    authorizedAt: null,
    authorizationExpiresAt: null,
    capturedAmountMinor: 0,
    refundedAmountMinor: 0,
    capturedAt: null,
    refundedAt: null,
    voidedAt: null
  };
  if (session.paymentIntent === null) {
    return {
      ...base,
      status:
        session.sessionStatus === "expired"
          ? "expired"
          : "pending"
    };
  }
  if (
    typeof session.paymentIntent !== "object" ||
    Array.isArray(session.paymentIntent)
  ) {
    return { ...base, status: "manual_review" };
  }
  let facts;
  try {
    facts = paymentIntentFacts(
      session.paymentIntent,
      config,
      {
        orderId,
        purposeDigest,
        amountMinor: session.amountMinor
      }
    );
  } catch {
    return { ...base, status: "manual_review" };
  }
  const intent = facts.paymentIntent;
  const projected = {
    ...base,
    paymentIntentId: facts.paymentIntentId
  };
  if (intent.status === "requires_capture") {
    let charge;
    try {
      charge = expandedProviderObject(
        intent.latest_charge,
        "ch",
        "PaymentIntent.latest_charge"
      );
      invariant(
        charge.payment_intent ===
            facts.paymentIntentId &&
          charge.livemode === config.livemode &&
          charge.currency === "usd" &&
          charge.amount === facts.amountMinor &&
          charge.amount_captured === 0 &&
          charge.captured === false &&
          charge.paid === true &&
          charge.status === "succeeded" &&
          charge.payment_method_details?.type ===
            "card",
        "stripe_domain_authorization_response_invalid",
        "Stripe manual authorization charge changed",
        { status: 502 }
      );
      projected.authorizedAt = exactProviderTime(
        charge.created,
        "Stripe authorization time"
      );
      projected.authorizationExpiresAt =
        exactProviderTime(
          charge.payment_method_details.card
            .capture_before,
          "Stripe authorization expiry"
        );
      invariant(
        intent.amount_capturable ===
          facts.amountMinor,
        "stripe_domain_authorization_response_invalid",
        "Stripe capturable amount changed",
        { status: 502 }
      );
    } catch {
      return { ...projected, status: "manual_review" };
    }
    return { ...projected, status: "authorized" };
  }
  if (intent.status === "succeeded") {
    let charge;
    try {
      charge = expandedProviderObject(
        intent.latest_charge,
        "ch",
        "PaymentIntent.latest_charge"
      );
      invariant(
        charge.payment_intent ===
            facts.paymentIntentId &&
          charge.livemode === config.livemode &&
          charge.currency === "usd" &&
          charge.amount === facts.amountMinor &&
          charge.captured === true &&
          charge.paid === true &&
          charge.status === "succeeded" &&
          Number.isSafeInteger(
            intent.amount_received
          ) &&
          intent.amount_received > 0 &&
          intent.amount_received <=
            facts.amountMinor &&
          charge.amount_captured ===
            intent.amount_received &&
          Number.isSafeInteger(
            charge.amount_refunded
          ) &&
          charge.amount_refunded >= 0 &&
          charge.amount_refunded <=
            charge.amount_captured,
        "stripe_domain_authorization_response_invalid",
        "Stripe captured domain payment changed",
        { status: 502 }
      );
      const balance = expandedProviderObject(
        charge.balance_transaction,
        "txn",
        "Charge.balance_transaction"
      );
      invariant(
        balance.source === charge.id &&
          balance.currency === "usd" &&
          balance.amount ===
            charge.amount_captured &&
          balance.type === "charge",
        "stripe_domain_authorization_response_invalid",
        "Stripe capture balance transaction changed",
        { status: 502 }
      );
      projected.capturedAmountMinor =
        charge.amount_captured;
      projected.captureId = charge.id;
      projected.capturedAt = exactProviderTime(
        balance.created,
        "Stripe capture time"
      );
      projected.refundedAmountMinor =
        charge.amount_refunded;
      if (charge.amount_refunded > 0) {
        const refunds = charge.refunds?.data;
        invariant(
          Array.isArray(refunds) &&
            refunds.length > 0 &&
            refunds.every((refund) => {
              providerId(
                refund.id,
                "re",
                "Stripe Refund ID"
              );
              return (
                refund.status === "succeeded" &&
                refund.payment_intent ===
                  facts.paymentIntentId &&
                refund.charge === charge.id &&
                refund.currency === "usd" &&
                Number.isSafeInteger(
                  refund.amount
                ) &&
                refund.amount > 0
              );
            }) &&
            refunds.reduce(
              (sum, refund) => sum + refund.amount,
              0
            ) === charge.amount_refunded,
          "stripe_domain_authorization_response_invalid",
          "Stripe refund readback changed",
          { status: 502 }
        );
        projected.refundedAt = exactProviderTime(
          Math.max(
            ...refunds.map(({ created }) => created)
          ),
          "Stripe refund time"
        );
        return { ...projected, status: "refunded" };
      }
      return { ...projected, status: "captured" };
    } catch {
      return { ...projected, status: "manual_review" };
    }
  }
  if (intent.status === "canceled") {
    try {
      projected.voidedAt = exactProviderTime(
        intent.canceled_at,
        "Stripe authorization cancellation time"
      );
    } catch {
      return { ...projected, status: "manual_review" };
    }
    return {
      ...projected,
      status:
        session.sessionStatus === "expired"
          ? "expired"
          : "voided"
    };
  }
  if (
    session.sessionStatus === "open" &&
    [
      "processing",
      "requires_action",
      "requires_confirmation",
      "requires_payment_method"
    ].includes(intent.status)
  ) {
    return { ...projected, status: "pending" };
  }
  return { ...projected, status: "manual_review" };
}

function checkoutLineItems(validated) {
  const items = [];
  for (const line of validated.lines) {
    if (line.authority.type === "stripe_price_refs") {
      if (line.amounts.oneTime) {
        items.push({
          price: line.authority.refs.oneTime,
          quantity: 1
        });
      }
      if (line.amounts.recurring) {
        items.push({
          price: line.authority.refs.recurring,
          quantity: 1
        });
      }
      continue;
    }
    items.push({
      price_data: {
        currency: "usd",
        unit_amount: line.authority.priceData.unitAmount,
        product_data: {
          name: line.lineItemId.startsWith("domain:")
            ? "Domain registration"
            : "Site Sourcery service"
        }
      },
      quantity: 1
    });
  }
  const recurringCount = validated.lines.filter(
    ({ amounts }) => amounts.recurring
  ).length;
  const oneTimeCount = items.length - recurringCount;
  invariant(
    recurringCount <= 20 && oneTimeCount <= 20,
    "stripe_checkout_purpose_invalid",
    "Checkout exceeds Stripe line-item limits",
    { status: 500 }
  );
  return items;
}

function validatePurposePrices(validated, expectations) {
  const configured = new Map(
    expectations.map((expectation) => [
      expectation.id,
      expectation
    ])
  );
  for (const [lineIndex, line] of validated.lines.entries()) {
    if (line.authority.type !== "stripe_price_refs") {
      continue;
    }
    for (const component of ["oneTime", "recurring"]) {
      const priceId = line.authority.refs[component];
      if (!priceId) continue;
      const expected = configured.get(priceId);
      const amount = line.amounts[component];
      invariant(
        expected &&
          expected.unitAmount === amount.amountMinor &&
          expected.currency === "usd" &&
          (
            component === "oneTime"
              ? expected.recurring === null
              : expected.recurring?.interval ===
                  amount.interval
          ),
        "stripe_price_not_authorized",
        `Checkout line ${lineIndex} does not match an owner-approved Stripe Price`,
        { status: 503, details: { priceId } }
      );
    }
  }
}

function checkoutResponse(
  value,
  config,
  expectedExpiresAt
) {
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Checkout Session ID"
  );
  let url;
  try {
    url = new URL(value?.url);
  } catch {
    throw ambiguous(
      "stripe_checkout_response_invalid",
      "Stripe created a Checkout Session with an invalid URL",
      { checkoutId }
    );
  }
  if (
    url.protocol !== "https:" ||
    !CHECKOUT_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw ambiguous(
      "stripe_checkout_response_invalid",
      "Stripe created a Checkout Session outside the approved host",
      { checkoutId }
    );
  }
  const observedExpiresAt = integer(
    value.expires_at,
    "Stripe Checkout Session expiry",
    1,
    Number.MAX_SAFE_INTEGER
  );
  invariant(
    value.livemode === config.livemode &&
      observedExpiresAt === expectedExpiresAt,
    "stripe_checkout_response_invalid",
    "Stripe Checkout Session mode or expiry changed",
    { status: 502 }
  );
  return Object.freeze({
    checkoutId,
    url: url.toString(),
    expiresAt: new Date(value.expires_at * 1000).toISOString()
  });
}

function portalResponse(value) {
  providerId(value?.id, "bps", "Stripe Billing Portal Session ID");
  let url;
  try {
    url = new URL(value?.url);
  } catch {
    throw ambiguous(
      "stripe_billing_portal_response_invalid",
      "Stripe created a Billing Portal Session with an invalid URL"
    );
  }
  if (
    url.protocol !== "https:" ||
    !PORTAL_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw ambiguous(
      "stripe_billing_portal_response_invalid",
      "Stripe created a Billing Portal Session outside the approved host"
    );
  }
  return Object.freeze({
    portalSessionId: value.id,
    url: url.toString()
  });
}

function cancellationResponse(value, subscriptionId) {
  invariant(
    value?.id === subscriptionId &&
      value.cancel_at_period_end === true &&
      CANCELLABLE_SUBSCRIPTION_STATUSES.has(
        value.status
      ) &&
      Number.isSafeInteger(value.current_period_end) &&
      value.current_period_end > 0,
    "stripe_subscription_response_invalid",
    "Stripe did not schedule the exact subscription cancellation",
    { status: 502 }
  );
  return Object.freeze({
    subscriptionId,
    providerStatus: value.status,
    cancelAtPeriodEnd: true,
    effectiveAt: new Date(
      value.current_period_end * 1000
    ).toISOString()
  });
}

export function createStripeProviderAdapter(options = {}) {
  const mode = options.mode ?? "held";
  invariant(
    STRIPE_PROVIDER_MODES.includes(mode),
    "stripe_mode_invalid",
    "Stripe mode must be held, contract_test, or approved_live",
    { status: 500 }
  );
  if (mode === "held") {
    const held = createHeldStripeAdapter();
    const reject = async () => {
      throw noEffect(
        "stripe_not_configured",
        "Stripe provider effects are held"
      );
    };
    return Object.freeze({
      ...held,
      async readiness() {
        return Object.freeze({
          ...(await held.readiness()),
          provider: "stripe",
          mode: "held"
        });
      },
      createCheckout: reject,
      createDownloadCheckout: reject,
      retrieveDownloadCheckoutLifecycle: reject,
      retrieveDownloadCheckout: reject,
      createBillingPortal: reject,
      createDomainAuthorizationCheckout: reject,
      retrieveDomainAuthorization: reject,
      captureDomainAuthorization: reject,
      voidDomainAuthorization: reject,
      refundDomainCapture: reject,
      scheduleCancellation: reject,
      verifyWebhook: reject
    });
  }
  const config = validateConfig(options.config, mode);
  if (mode === "contract_test") {
    invariant(
      options.testOnly === true &&
        options.client &&
        options.secretKey === undefined &&
        config.livemode === false &&
        !OFFICIAL_CLIENTS.has(options.client),
      "stripe_test_mode_invalid",
      "Stripe contract_test mode requires a non-network injected test client, testOnly=true, and test livemode",
      { status: 500 }
    );
  }
  const approval =
    mode === "approved_live"
      ? liveApproval(options.liveApproval)
      : null;
  if (approval) {
    invariant(
      approval.livemode === config.livemode,
      "stripe_live_approval_missing",
      "Stripe approval and configured livemode do not match",
      { status: 500 }
    );
  }
  const capabilities = new Set(
    approval?.capabilities ?? LIVE_CAPABILITIES
  );
  if (capabilities.has("checkout:create")) {
    invariant(
      capabilities.has("prices:read") &&
        config.priceExpectations.length > 0,
      "stripe_configuration_required",
      "Stripe website Checkout requires Price readback capability and at least one exact Price",
      { status: 500 }
    );
  }
  const domainCapabilities = [
    ...capabilities
  ].filter((capability) =>
    capability.startsWith("domain_")
  );
  if (domainCapabilities.length > 0) {
    invariant(
      config.domainAuthorization,
      "stripe_domain_configuration_invalid",
      "Approved Stripe domain capabilities require exact domain authorization configuration",
      { status: 500 }
    );
  }
  const selectedClient =
    mode === "approved_live" && !options.client
      ? createOfficialStripeClient({
          secretKey: options.secretKey,
          livemode: config.livemode
        })
      : options.client;
  if (mode === "approved_live") {
    invariant(
      OFFICIAL_CLIENTS.has(selectedClient),
      "stripe_client_invalid",
      "Approved Stripe effects require the pinned official client",
      { status: 500 }
    );
  }
  const client = validateClient(selectedClient);
  const clock =
    typeof options.clock?.now === "function"
      ? options.clock
      : { now: () => new Date().toISOString() };

  function requireCapability(capability) {
    invariant(
      capabilities.has(capability),
      "stripe_capability_not_approved",
      `Stripe capability ${capability} is not approved`,
      { status: 500 }
    );
  }

  async function verifyPrices() {
    requireCapability("prices:read");
    for (const expected of config.priceExpectations) {
      let observed;
      try {
        observed = await client.prices.retrieve(expected.id);
      } catch {
        throw noEffect(
          "stripe_price_unavailable",
          "An owner-approved Stripe Price could not be verified",
          { priceId: expected.id }
        );
      }
      invariant(
        priceMatches(observed, expected),
        "stripe_price_mismatch",
        "An owner-approved Stripe Price no longer matches the exact catalog",
        { status: 503, details: { priceId: expected.id } }
      );
    }
  }

  async function retrieveDomainAuthorizationInternal({
    checkoutSessionId,
    orderId,
    purposeDigest
  } = {}) {
    requireCapability("domain_authorization:read");
    domainProviderClient(client);
    const sessionId = providerId(
      checkoutSessionId,
      "cs",
      "checkoutSessionId"
    );
    const selectedOrderId = safeMetadataValue(
      orderId,
      "orderId"
    );
    invariant(
      SHA256.test(purposeDigest),
      "stripe_domain_authorization_invalid",
      "Domain authorization purpose digest is invalid",
      { status: 500 }
    );
    let response;
    try {
      response = await client.checkout.sessions.retrieve(
        sessionId,
        {
          expand: [
            "payment_intent.latest_charge.balance_transaction",
            "payment_intent.latest_charge.refunds"
          ]
        }
      );
    } catch {
      throw noEffect(
        "stripe_domain_authorization_read_unavailable",
        "Stripe domain authorization could not be read for reconciliation",
        {
          checkoutSessionId: sessionId,
          purposeDigest
        }
      );
    }
    const session = domainSessionFacts(
      response,
      config,
      {
        checkoutSessionId: sessionId,
        orderId: selectedOrderId,
        purposeDigest
      }
    );
    return Object.freeze(
      domainAuthorizationProjection(
        session,
        config,
        {
          orderId: selectedOrderId,
          purposeDigest
        }
      )
    );
  }

  const adapter = {
    async readiness() {
      try {
        if (capabilities.has("prices:read")) {
          await verifyPrices();
        }
        if (domainCapabilities.length > 0) {
          domainProviderClient(client);
        }
        return {
          ready: true,
          provider: "stripe",
          mode,
          environment:
            approval?.environment ?? "contract_test",
          livemode: config.livemode,
          apiVersion: config.apiVersion,
          priceCount: config.priceExpectations.length,
          domainAuthorization:
            domainCapabilities.length > 0 &&
            Boolean(config.domainAuthorization),
          webhookVerification: true,
          taxMode: config.taxMode
        };
      } catch (error) {
        return {
          ready: false,
          provider: "stripe",
          mode,
          environment:
            approval?.environment ?? "contract_test",
          livemode: config.livemode,
          code: error?.code ?? "stripe_not_ready"
        };
      }
    },

    async createCheckout(request) {
      requireCapability("checkout:create");
      const validated = validatePurpose(request);
      const dynamicLine = validated.lines.find(
        ({ authority }) =>
          authority.type === "server_price_data"
      );
      if (dynamicLine) {
        throw noEffect(
          "stripe_domain_checkout_held",
          "Domain payment uses the separate authorize-register-capture workflow and cannot enter ordinary Checkout",
          { lineItemId: dynamicLine.lineItemId }
        );
      }
      await verifyPrices();
      validatePurposePrices(
        validated,
        config.priceExpectations
      );
      const items = checkoutLineItems(validated);
      const hasRecurring = validated.lines.some(
        ({ amounts }) => amounts.recurring
      );
      const modeName = hasRecurring
        ? "subscription"
        : "payment";
      const providerMetadata = metadata(validated);
      const expiresAt =
        Math.floor(Date.parse(clock.now()) / 1000) +
        config.checkoutTtlSeconds;
      invariant(
        Number.isSafeInteger(expiresAt),
        "stripe_clock_invalid",
        "Stripe checkout clock is invalid",
        { status: 500 }
      );
      const params = {
        mode: modeName,
        line_items: items,
        success_url: config.successUrl,
        cancel_url: config.cancelUrl,
        client_reference_id: validated.identity.quoteId,
        metadata: providerMetadata,
        expires_at: expiresAt,
        automatic_tax: {
          enabled: config.taxMode === "automatic"
        },
        ...(validated.stripeCustomerId
          ? { customer: validated.stripeCustomerId }
          : modeName === "payment"
            ? { customer_creation: "always" }
            : {}),
        ...(modeName === "subscription"
          ? {
              subscription_data: {
                metadata: providerMetadata
              }
            }
          : {
              payment_intent_data: {
                metadata: providerMetadata
              }
            })
      };
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_checkout_effect_unknown",
          "Stripe Checkout creation must be reconciled by idempotency key",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return checkoutResponse(
          response,
          config,
          expiresAt
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_checkout_response_invalid",
          "Stripe Checkout creation returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async createDownloadCheckout(request) {
      requireCapability("checkout:create");
      const validated =
        validateDownloadPurpose(request);
      const providerMetadata =
        downloadMetadata(validated);
      const expiresAt =
        Math.floor(Date.parse(clock.now()) / 1000) +
        config.checkoutTtlSeconds;
      invariant(
        Number.isSafeInteger(expiresAt),
        "stripe_clock_invalid",
        "Stripe checkout clock is invalid",
        { status: 500 }
      );
      const params = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: 500,
              ...(config.taxMode === "automatic"
                ? { tax_behavior: "exclusive" }
                : {}),
              product_data: {
                name: "Abracadabra Download"
              }
            },
            quantity: 1
          }
        ],
        success_url: downloadReturnUrl(
          config.successUrl,
          validated.identity.projectId
        ),
        cancel_url: config.cancelUrl,
        client_reference_id:
          validated.identity.quoteId,
        metadata: providerMetadata,
        expires_at: expiresAt,
        automatic_tax: {
          enabled: config.taxMode === "automatic"
        },
        ...(validated.stripeCustomerId
          ? { customer: validated.stripeCustomerId }
          : { customer_creation: "always" }),
        ...(config.taxMode === "automatic"
          ? {
              billing_address_collection: "required",
              ...(validated.stripeCustomerId
                ? {
                    customer_update: {
                      address: "auto"
                    }
                  }
                : {})
            }
          : {}),
        payment_intent_data: {
          metadata: providerMetadata
        }
      };
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "download_checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_download_checkout_effect_unknown",
          "Stripe Download Checkout creation must be reconciled by idempotency key",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return checkoutResponse(
          response,
          config,
          expiresAt
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) {
          throw error;
        }
        throw ambiguous(
          "stripe_download_checkout_response_invalid",
          "Stripe Download Checkout returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveDownloadCheckout(request) {
      requireCapability("checkout:create");
      const validated = validateDownloadPurpose(
        request,
        { retrieval: true }
      );
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Download reconciliation requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId,
            { expand: ["payment_intent"] }
          );
      } catch {
        throw noEffect(
          "stripe_download_checkout_read_unavailable",
          "Stripe Download Checkout could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return downloadCheckoutFacts(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async retrieveDownloadCheckoutLifecycle(request) {
      requireCapability("checkout:create");
      const validated = validateDownloadPurpose(
        request,
        { retrieval: true }
      );
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Download lifecycle reconciliation requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId
          );
      } catch {
        throw noEffect(
          "stripe_download_checkout_lifecycle_unavailable",
          "Stripe Download Checkout lifecycle could not be read",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return downloadCheckoutLifecycle(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async createDomainAuthorizationCheckout(request) {
      requireCapability("domain_authorization:create");
      domainProviderClient(client);
      const validated = domainAuthorizationRequest(
        request,
        config
      );
      const providerMetadata =
        domainProviderMetadata(validated);
      const expiresAt =
        Math.floor(Date.parse(clock.now()) / 1000) +
        config.checkoutTtlSeconds;
      invariant(
        Number.isSafeInteger(expiresAt),
        "stripe_clock_invalid",
        "Stripe domain Checkout clock is invalid",
        { status: 500 }
      );
      const params = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: validated.amountMinor,
              product_data: {
                name: `${validated.domain} registration — ${validated.years} ${
                  validated.years === 1
                    ? "year"
                    : "years"
                }`,
                description:
                  "Authorized now; captured only after registrar and registrant readback.",
                metadata: providerMetadata
              }
            },
            quantity: 1
          }
        ],
        success_url: validated.successUrl,
        cancel_url: validated.cancelUrl,
        client_reference_id:
          validated.identity.orderId,
        metadata: providerMetadata,
        expires_at: expiresAt,
        customer_creation: "always",
        automatic_tax: {
          enabled: config.taxMode === "automatic"
        },
        payment_intent_data: {
          capture_method: "manual",
          metadata: providerMetadata
        },
        custom_text: {
          submit: {
            message:
              config.domainAuthorization
                .authorizationDisclosure
          }
        }
      };
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "domain_authorization",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_domain_checkout_effect_unknown",
          "Stripe domain authorization Checkout must be reconciled by idempotency key",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        const checkout = checkoutResponse(
          response,
          config,
          expiresAt
        );
        const session = domainSessionFacts(
          response,
          config,
          {
            checkoutSessionId: checkout.checkoutId,
            orderId: validated.identity.orderId,
            purposeDigest: validated.purposeDigest,
            amountMinor: validated.amountMinor
          }
        );
        invariant(
          session.sessionStatus === "open" &&
            session.paymentIntent === null,
          "stripe_domain_authorization_response_invalid",
          "A new domain authorization Checkout was not open and unpaid",
          { status: 502 }
        );
        return Object.freeze({
          status: "open",
          checkoutSessionId: checkout.checkoutId,
          url: checkout.url,
          expiresAt: checkout.expiresAt,
          amountMinor: validated.amountMinor,
          currency: "USD",
          captureMethod: "manual",
          purposeDigest: validated.purposeDigest
        });
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_domain_authorization_response_invalid",
          "Stripe domain authorization Checkout returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveDomainAuthorization(request) {
      return retrieveDomainAuthorizationInternal(request);
    },

    async captureDomainAuthorization({
      checkoutSessionId,
      paymentIntentId,
      orderId,
      amountMinor,
      currency,
      purposeDigest,
      idempotencyKey
    } = {}) {
      requireCapability("domain_authorization:capture");
      domainProviderClient(client);
      invariant(
        currency === "USD",
        "stripe_domain_capture_invalid",
        "Domain capture supports exact USD money only",
        { status: 500 }
      );
      const selectedAmount = integer(
        amountMinor,
        "amountMinor",
        1,
        99_999_999
      );
      const selectedIntentId = providerId(
        paymentIntentId,
        "pi",
        "paymentIntentId"
      );
      const selectedOrderId = safeMetadataValue(
        orderId,
        "orderId"
      );
      const projection =
        await retrieveDomainAuthorizationInternal({
          checkoutSessionId,
          orderId: selectedOrderId,
          purposeDigest
        });
      invariant(
        projection.status === "authorized" &&
          projection.paymentIntentId ===
            selectedIntentId &&
          selectedAmount <= projection.amountMinor,
        "stripe_domain_capture_invalid",
        "Only the exact current manual authorization can be captured",
        { status: 409 }
      );
      const key = requiredText(
        idempotencyKey,
        "idempotencyKey",
        255
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "domain_capture",
          key,
          digest({
            paymentIntentId: selectedIntentId,
            amountMinor: selectedAmount,
            purposeDigest
          })
        );
      let response;
      try {
        response = await client.paymentIntents.capture(
          selectedIntentId,
          {
            amount_to_capture: selectedAmount,
            final_capture: true,
            metadata: {
              domain_capture_purpose_digest:
                purposeDigest,
              domain_capture_order_id:
                selectedOrderId
            },
            expand: [
              "latest_charge.balance_transaction"
            ]
          },
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_domain_capture_effect_unknown",
          "Stripe domain capture must be reconciled before any retry",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            purposeDigest
          }
        );
      }
      try {
        const facts = paymentIntentFacts(
          response,
          config,
          {
            orderId: selectedOrderId,
            purposeDigest,
            paymentIntentId: selectedIntentId,
            amountMinor: projection.amountMinor
          }
        );
        const charge = expandedProviderObject(
          response.latest_charge,
          "ch",
          "PaymentIntent.latest_charge"
        );
        const balance = expandedProviderObject(
          charge.balance_transaction,
          "txn",
          "Charge.balance_transaction"
        );
        invariant(
          facts.paymentIntent.status ===
              "succeeded" &&
            facts.paymentIntent.amount_received ===
              selectedAmount &&
            facts.paymentIntent.amount_capturable ===
              0 &&
            charge.payment_intent ===
              selectedIntentId &&
            charge.livemode === config.livemode &&
            charge.captured === true &&
            charge.paid === true &&
            charge.status === "succeeded" &&
            charge.currency === "usd" &&
            charge.amount ===
              projection.amountMinor &&
            charge.amount_captured === selectedAmount &&
            charge.amount_refunded === 0 &&
            balance.source === charge.id &&
            balance.currency === "usd" &&
            balance.amount === selectedAmount &&
            balance.type === "charge",
          "stripe_domain_capture_response_invalid",
          "Stripe did not confirm the exact domain capture",
          { status: 502 }
        );
        return Object.freeze({
          status: "captured",
          paymentIntentId: selectedIntentId,
          captureId: charge.id,
          amountMinor: selectedAmount,
          currency: "USD",
          purposeDigest,
          capturedAt: exactProviderTime(
            balance.created,
            "Stripe capture time"
          )
        });
      } catch {
        throw ambiguous(
          "stripe_domain_capture_response_invalid",
          "Stripe domain capture returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            purposeDigest
          }
        );
      }
    },

    async voidDomainAuthorization({
      paymentIntentId,
      orderId,
      purposeDigest,
      idempotencyKey
    } = {}) {
      requireCapability("domain_authorization:cancel");
      domainProviderClient(client);
      const selectedIntentId = providerId(
        paymentIntentId,
        "pi",
        "paymentIntentId"
      );
      const selectedOrderId = safeMetadataValue(
        orderId,
        "orderId"
      );
      invariant(
        SHA256.test(purposeDigest),
        "stripe_domain_void_invalid",
        "Domain authorization purpose digest is invalid",
        { status: 500 }
      );
      let current;
      try {
        current = await client.paymentIntents.retrieve(
          selectedIntentId,
          {
            expand: ["latest_charge"]
          }
        );
      } catch {
        throw noEffect(
          "stripe_domain_authorization_read_unavailable",
          "Stripe domain authorization could not be read before cancellation",
          {
            paymentIntentId: selectedIntentId,
            purposeDigest
          }
        );
      }
      const facts = paymentIntentFacts(
        current,
        config,
        {
          orderId: selectedOrderId,
          purposeDigest,
          paymentIntentId: selectedIntentId
        }
      );
      const currentCharge =
        expandedProviderObject(
          facts.paymentIntent.latest_charge,
          "ch",
          "PaymentIntent.latest_charge"
        );
      invariant(
        facts.paymentIntent.status ===
            "requires_capture" &&
          facts.paymentIntent.amount_capturable ===
            facts.amountMinor &&
          currentCharge.payment_intent ===
            selectedIntentId &&
          currentCharge.livemode === config.livemode &&
          currentCharge.currency === "usd" &&
          currentCharge.amount === facts.amountMinor &&
          currentCharge.amount_captured === 0 &&
          currentCharge.captured === false &&
          currentCharge.paid === true &&
          currentCharge.status === "succeeded" &&
          currentCharge.payment_method_details?.type ===
            "card" &&
          Number.isSafeInteger(
            currentCharge.payment_method_details
              .card.capture_before
          ),
        "stripe_domain_void_invalid",
        "Only a current uncaptured domain authorization can be canceled",
        { status: 409 }
      );
      const key = requiredText(
        idempotencyKey,
        "idempotencyKey",
        255
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "domain_void",
          key,
          digest({
            paymentIntentId: selectedIntentId,
            purposeDigest
          })
        );
      let response;
      try {
        response = await client.paymentIntents.cancel(
          selectedIntentId,
          { cancellation_reason: "abandoned" },
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_domain_void_effect_unknown",
          "Stripe domain authorization cancellation must be reconciled before any retry",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            purposeDigest
          }
        );
      }
      try {
        paymentIntentFacts(response, config, {
          orderId: selectedOrderId,
          purposeDigest,
          paymentIntentId: selectedIntentId,
          amountMinor: facts.amountMinor
        });
        invariant(
          response.status === "canceled" &&
            response.amount_capturable === 0 &&
            response.cancellation_reason ===
              "abandoned",
          "stripe_domain_void_response_invalid",
          "Stripe did not confirm the exact authorization cancellation",
          { status: 502 }
        );
        return Object.freeze({
          status: "voided",
          paymentIntentId: selectedIntentId,
          voidId: selectedIntentId,
          purposeDigest,
          voidedAt: exactProviderTime(
            response.canceled_at,
            "Stripe cancellation time"
          )
        });
      } catch {
        throw ambiguous(
          "stripe_domain_void_response_invalid",
          "Stripe authorization cancellation returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            purposeDigest
          }
        );
      }
    },

    async refundDomainCapture({
      checkoutSessionId,
      paymentIntentId,
      captureId,
      orderId,
      amountMinor,
      currency,
      purposeDigest,
      reason,
      operatorEvidenceId,
      idempotencyKey
    } = {}) {
      requireCapability("domain_refunds:create");
      domainProviderClient(client);
      invariant(
        currency === "USD",
        "stripe_domain_refund_invalid",
        "Domain refunds support exact USD money only",
        { status: 500 }
      );
      const selectedIntentId = providerId(
        paymentIntentId,
        "pi",
        "paymentIntentId"
      );
      const selectedCaptureId = providerId(
        captureId,
        "ch",
        "captureId"
      );
      const selectedOrderId = safeMetadataValue(
        orderId,
        "orderId"
      );
      const selectedAmount = integer(
        amountMinor,
        "amountMinor",
        1,
        99_999_999
      );
      const selectedReason = requiredText(
        reason,
        "reason",
        256
      );
      const evidenceId = safeMetadataValue(
        operatorEvidenceId,
        "operatorEvidenceId"
      );
      const projection =
        await retrieveDomainAuthorizationInternal({
          checkoutSessionId,
          orderId: selectedOrderId,
          purposeDigest
        });
      invariant(
        ["captured", "refunded"].includes(
          projection.status
        ) &&
          projection.paymentIntentId ===
            selectedIntentId &&
          projection.captureId === selectedCaptureId &&
          selectedAmount <=
            projection.capturedAmountMinor -
              projection.refundedAmountMinor,
        "stripe_domain_refund_invalid",
        "Domain refund exceeds the exact captured balance",
        { status: 409 }
      );
      const key = requiredText(
        idempotencyKey,
        "idempotencyKey",
        255
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "domain_refund",
          key,
          digest({
            paymentIntentId: selectedIntentId,
            captureId: selectedCaptureId,
            amountMinor: selectedAmount,
            purposeDigest
          })
        );
      let response;
      try {
        response = await client.refunds.create(
          {
            payment_intent: selectedIntentId,
            amount: selectedAmount,
            reason: "requested_by_customer",
            metadata: {
              schema: "sitesourcery_domain_refund_v1",
              order_id: selectedOrderId,
              purpose_digest: purposeDigest,
              operator_evidence_id: evidenceId,
              reason_digest: digest(selectedReason)
            }
          },
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_domain_refund_effect_unknown",
          "Stripe domain refund must be reconciled before any retry",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            captureId: selectedCaptureId,
            purposeDigest
          }
        );
      }
      try {
        const refundId = providerId(
          response?.id,
          "re",
          "Stripe Refund ID"
        );
        invariant(
          response.status === "succeeded" &&
            response.payment_intent ===
              selectedIntentId &&
            response.charge === selectedCaptureId &&
            response.amount === selectedAmount &&
            response.currency === "usd" &&
            response.metadata?.schema ===
              "sitesourcery_domain_refund_v1" &&
            response.metadata?.order_id ===
              selectedOrderId &&
            response.metadata?.purpose_digest ===
              purposeDigest &&
            response.metadata
              ?.operator_evidence_id === evidenceId &&
            response.metadata?.reason_digest ===
              digest(selectedReason),
          "stripe_domain_refund_response_invalid",
          "Stripe did not confirm the exact domain refund",
          { status: 502 }
        );
        return Object.freeze({
          status: "refunded",
          paymentIntentId: selectedIntentId,
          captureId: selectedCaptureId,
          refundId,
          amountMinor: selectedAmount,
          currency: "USD",
          purposeDigest,
          refundedAt: exactProviderTime(
            response.created,
            "Stripe refund time"
          )
        });
      } catch {
        throw ambiguous(
          "stripe_domain_refund_response_invalid",
          "Stripe domain refund returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            paymentIntentId: selectedIntentId,
            captureId: selectedCaptureId,
            purposeDigest
          }
        );
      }
    },

    async createBillingPortal({
      stripeCustomerId,
      idempotencyKey
    } = {}) {
      requireCapability("billing_portal:create");
      const customer = providerId(
        stripeCustomerId,
        "cus",
        "stripeCustomerId"
      );
      const key = requiredText(
        idempotencyKey,
        "idempotencyKey",
        255
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "billing_portal",
          key,
          digest({
            customer,
            returnUrl: config.portalReturnUrl
          })
        );
      let response;
      try {
        response =
          await client.billingPortal.sessions.create(
            {
              customer,
              return_url: config.portalReturnUrl
            },
            { idempotencyKey: stripeIdempotencyKey }
          );
      } catch {
        throw ambiguous(
          "stripe_billing_portal_effect_unknown",
          "Stripe Billing Portal creation must be reconciled by idempotency key",
          { idempotencyKey: stripeIdempotencyKey }
        );
      }
      try {
        return portalResponse(response);
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_billing_portal_response_invalid",
          "Stripe Billing Portal creation returned an unsafe response that requires reconciliation",
          { idempotencyKey: stripeIdempotencyKey }
        );
      }
    },

    async scheduleCancellation({
      stripeSubscriptionId,
      idempotencyKey,
      cancellationDigest
    } = {}) {
      requireCapability("subscriptions:cancel");
      const subscriptionId = providerId(
        stripeSubscriptionId,
        "sub",
        "stripeSubscriptionId"
      );
      const key = requiredText(
        idempotencyKey,
        "idempotencyKey",
        255
      );
      invariant(
        SHA256.test(cancellationDigest),
        "stripe_cancellation_invalid",
        "Cancellation disclosure digest is invalid",
        { status: 500 }
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "subscription_cancel",
          key,
          digest({
            subscriptionId,
            cancellationDigest
          })
        );
      let response;
      try {
        response = await client.subscriptions.update(
          subscriptionId,
          {
            cancel_at_period_end: true,
            metadata: {
              cancellation_digest: cancellationDigest
            }
          },
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_cancellation_effect_unknown",
          "Stripe subscription cancellation must be reconciled by idempotency key",
          {
            idempotencyKey: stripeIdempotencyKey,
            subscriptionId
          }
        );
      }
      try {
        return cancellationResponse(
          response,
          subscriptionId
        );
      } catch {
        throw ambiguous(
          "stripe_subscription_response_invalid",
          "Stripe cancellation returned an unsafe response that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            subscriptionId
          }
        );
      }
    },

    async verifyWebhook({ rawBody, signature } = {}) {
      requireCapability("webhooks:verify");
      invariant(
        Buffer.isBuffer(rawBody) ||
          typeof rawBody === "string",
        "stripe_webhook_body_required",
        "Stripe webhook verification requires the exact raw body",
        { status: 400 }
      );
      invariant(
        typeof signature === "string" &&
          signature.length > 0 &&
          signature.length <= 4000,
        "stripe_webhook_signature_required",
        "Stripe-Signature is required",
        { status: 400 }
      );
      const selectedSignature = signature;
      let event;
      try {
        event = client.webhooks.constructEvent(
          rawBody,
          selectedSignature,
          config.webhookSecret
        );
      } catch {
        invariant(
          false,
          "stripe_webhook_signature_invalid",
          "Stripe webhook signature is invalid",
          { status: 400 }
        );
      }
      invariant(
        event &&
          typeof event.id === "string" &&
          event.id.startsWith("evt_") &&
          typeof event.type === "string" &&
          event.type.length > 0 &&
          event.type.length <= 200 &&
          event.livemode === config.livemode &&
          event.api_version === config.apiVersion &&
          Number.isSafeInteger(event.created) &&
          event.created > 0 &&
          event.data?.object &&
          typeof event.data.object === "object",
        "stripe_webhook_event_invalid",
        "Stripe webhook event is invalid or belongs to another mode",
        { status: 400 }
      );
      try {
        return structuredClone(event);
      } catch {
        invariant(
          false,
          "stripe_webhook_event_invalid",
          "Stripe webhook event is not safely serializable",
          { status: 400 }
        );
      }
    }
  };

  return Object.freeze(adapter);
}
