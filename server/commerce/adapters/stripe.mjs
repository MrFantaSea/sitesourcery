import Stripe from "stripe";

import {
  digest,
  normalizeDomain
} from "../../domain/canonical.mjs";
import {
  ExternalEffectError,
  invariant
} from "../../domain/errors.mjs";
import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA,
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA,
  ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
  ALAKAZAM_TERMS_VERSION,
  ALAKAZAM_TIER_DEFINITIONS,
  ALAKAZAM_TIER_IDS
} from "../../commerce-v2/alakazam.mjs";
import { createHeldStripeAdapter } from "./held.mjs";

export const STRIPE_API_VERSION = "2026-06-24.dahlia";
export const STRIPE_PROVIDER_MODES = Object.freeze([
  "held",
  "contract_test",
  "approved_live"
]);
export const STRIPE_ALAKAZAM_CAPABILITIES =
  Object.freeze([
    "billing_portal_configurations:read",
    "checkout:create",
    "checkout:read",
    "coupons:read",
    "customers:create",
    "customers:read",
    "prices:read",
    "products:read",
    "subscriptions:read",
    "subscriptions:update",
    "subscription_schedules:read",
    "subscription_schedules:write"
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
  "webhooks:verify",
  ...STRIPE_ALAKAZAM_CAPABILITIES
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
const PROVIDER_ID = /^(bpc|bps|ch|cs|cus|in|pi|price|prod|re|si|sub_sched|sub|txn)_[A-Za-z0-9_]+$/u;
const SAFE_METADATA_VALUE = /^[A-Za-z0-9._:-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OFFICIAL_CLIENTS = new WeakSet();
const DOWNLOAD_CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.abracadabra-checkout-purpose.v2";
const DOWNLOAD_CHECKOUT_METADATA_SCHEMA =
  "sitesourcery_download_checkout_v2";
const DOWNLOAD_CHECKOUT_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-download-checkout-lifecycle/v2";
export const STRIPE_ALAKAZAM_PURPOSE_SCHEMA =
  ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA;
export const STRIPE_ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA =
  ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA;
const STRIPE_ALAKAZAM_METADATA_SCHEMA =
  "sitesourcery_alakazam_change_v1";
const STRIPE_ALAKAZAM_CUSTOMER_METADATA_SCHEMA =
  "sitesourcery_alakazam_customer_v1";
const STRIPE_ALAKAZAM_CUSTOMER_SCHEMA =
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA;
const STRIPE_ALAKAZAM_SUBSCRIPTION_SCHEMA =
  "sitesourcery.stripe-alakazam-subscription/v1";
const STRIPE_ALAKAZAM_PAYMENT_SCHEMA =
  "sitesourcery.stripe-alakazam-payment/v1";
const STRIPE_ALAKAZAM_SCHEDULE_SCHEMA =
  "sitesourcery.stripe-alakazam-downgrade-schedule/v1";

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
  const match = PROVIDER_ID.exec(selected);
  invariant(
    match?.[1] === prefix,
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
  const productId =
    value.productId === null ||
    value.productId === undefined
      ? null
      : providerId(
          value.productId,
          "prod",
          `priceExpectations[${index}].productId`
        );
  return Object.freeze({
    id,
    active: true,
    currency,
    unitAmount,
    livemode,
    recurring,
    productId
  });
}

function normalizedAlakazamConfig(
  value,
  priceExpectations,
  livemode
) {
  if (value === null || value === undefined) {
    return null;
  }
  invariant(
    exactObjectKeys(value, [
      "downloadCreditCouponId",
      "portalConfigurationId",
      "productId",
      "tierPriceIds"
    ]),
    "stripe_alakazam_configuration_invalid",
    "Stripe Alakazam configuration requires the exact reviewed fields",
    { status: 500 }
  );
  const productId = providerId(
    value.productId,
    "prod",
    "alakazam.productId"
  );
  const portalConfigurationId = providerId(
    value.portalConfigurationId,
    "bpc",
    "alakazam.portalConfigurationId"
  );
  const downloadCreditCouponId = requiredText(
    value.downloadCreditCouponId,
    "alakazam.downloadCreditCouponId",
    255
  );
  invariant(
    SAFE_METADATA_VALUE.test(downloadCreditCouponId),
    "stripe_alakazam_configuration_invalid",
    "Stripe Alakazam Download credit Coupon ID is invalid",
    { status: 500 }
  );
  invariant(
    exactObjectKeys(value.tierPriceIds, ALAKAZAM_TIER_IDS),
    "stripe_alakazam_configuration_invalid",
    "Stripe Alakazam tier Price bindings are incomplete",
    { status: 500 }
  );
  const expectations = new Map(
    priceExpectations.map((expectation) => [
      expectation.id,
      expectation
    ])
  );
  const tierPriceIds = {};
  for (const tierId of ALAKAZAM_TIER_IDS) {
    const priceId = providerId(
      value.tierPriceIds[tierId],
      "price",
      `alakazam.tierPriceIds.${tierId}`
    );
    const expected = expectations.get(priceId);
    const tier = ALAKAZAM_TIER_DEFINITIONS[tierId];
    invariant(
      expected &&
        expected.productId === productId &&
        expected.unitAmount === tier.price.amountMinor &&
        expected.currency === "usd" &&
        expected.livemode === livemode &&
        expected.recurring?.interval === "month" &&
        expected.recurring?.intervalCount === 1,
      "stripe_alakazam_configuration_invalid",
      `Stripe Alakazam Price ${tierId} does not match the owner contract`,
      { status: 500 }
    );
    tierPriceIds[tierId] = priceId;
  }
  invariant(
    new Set(Object.values(tierPriceIds)).size ===
      ALAKAZAM_TIER_IDS.length,
    "stripe_alakazam_configuration_invalid",
    "Stripe Alakazam tiers require three distinct Prices",
    { status: 500 }
  );
  return Object.freeze({
    productId,
    portalConfigurationId,
    downloadCreditCouponId,
    tierPriceIds: Object.freeze(tierPriceIds)
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
  const alakazam = normalizedAlakazamConfig(
    config.alakazam,
    priceExpectations,
    config.livemode
  );
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
    domainAuthorization,
    alakazam
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
  const productId =
    typeof price?.product === "string"
      ? price.product
      : price?.product?.id;
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
    ) &&
    (
      expected.productId === null ||
      productId === expected.productId
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

function canonicalIso(value, field) {
  const selected = requiredText(value, field, 40);
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "stripe_alakazam_purpose_invalid",
    `${field} must be an exact ISO timestamp`,
    { status: 500 }
  );
  return selected;
}

function isoToProviderSeconds(value, field) {
  const selected = canonicalIso(value, field);
  const milliseconds = Date.parse(selected);
  invariant(
    milliseconds % 1000 === 0,
    "stripe_alakazam_purpose_invalid",
    `${field} must resolve to an exact provider second`,
    { status: 500 }
  );
  return milliseconds / 1000;
}

function alakazamTier(tierId) {
  const selected = requiredText(tierId, "targetTierId", 100);
  const tier = ALAKAZAM_TIER_DEFINITIONS[selected];
  invariant(
    Boolean(tier),
    "stripe_alakazam_purpose_invalid",
    "Alakazam purpose contains an unavailable tier",
    { status: 500 }
  );
  return tier;
}

function validatedAlakazamCurrent(value, config) {
  invariant(
    exactObjectKeys(value, [
      "amountMinor",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "localSubscriptionId",
      "providerFactsDigest",
      "revision",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "tierId"
    ]),
    "stripe_alakazam_purpose_invalid",
    "Alakazam current subscription binding is invalid",
    { status: 500 }
  );
  const tier = alakazamTier(value.tierId);
  const currentPeriodStartsAt = canonicalIso(
    value.currentPeriodStartsAt,
    "currentSubscription.currentPeriodStartsAt"
  );
  const currentPeriodEndsAt = canonicalIso(
    value.currentPeriodEndsAt,
    "currentSubscription.currentPeriodEndsAt"
  );
  invariant(
    Date.parse(currentPeriodEndsAt) >
      Date.parse(currentPeriodStartsAt) &&
      value.amountMinor === tier.price.amountMinor &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      SHA256.test(value.providerFactsDigest),
    "stripe_alakazam_purpose_invalid",
    "Alakazam current subscription facts do not match the owner contract",
    { status: 500 }
  );
  const stripePriceId = providerId(
    value.stripePriceId,
    "price",
    "currentSubscription.stripePriceId"
  );
  invariant(
    stripePriceId === config.tierPriceIds[tier.tierId],
    "stripe_alakazam_purpose_invalid",
    "Alakazam current subscription Price does not match its tier",
    { status: 500 }
  );
  return Object.freeze({
    localSubscriptionId: safeMetadataValue(
      value.localSubscriptionId,
      "currentSubscription.localSubscriptionId"
    ),
    revision: value.revision,
    tier,
    amountMinor: value.amountMinor,
    stripeSubscriptionId: providerId(
      value.stripeSubscriptionId,
      "sub",
      "currentSubscription.stripeSubscriptionId"
    ),
    stripeSubscriptionItemId: providerId(
      value.stripeSubscriptionItemId,
      "si",
      "currentSubscription.stripeSubscriptionItemId"
    ),
    stripePriceId,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
    providerFactsDigest: value.providerFactsDigest
  });
}

function validateAlakazamCustomerPurpose(
  request,
  requestFields
) {
  invariant(
    exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "catalogVersion",
        "customerId",
        "organizationId",
        "projectId",
        "provisionId",
        "quoteDigest",
        "quoteId",
        "schema",
        "termsVersion"
      ]),
    "stripe_alakazam_customer_purpose_invalid",
    "Alakazam Customer provisioning requires the exact server purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const purposeDigest = digest(purpose);
  invariant(
    purpose.schema ===
      STRIPE_ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA &&
      purpose.catalogVersion ===
        ALAKAZAM_CATALOG_VERSION &&
      purpose.termsVersion === ALAKAZAM_TERMS_VERSION &&
      SHA256.test(purpose.acceptedDisclosureDigest) &&
      SHA256.test(purpose.quoteDigest) &&
      request.purposeDigest === purposeDigest,
    "stripe_alakazam_customer_purpose_invalid",
    "Alakazam Customer purpose does not match its authoritative digest",
    { status: 500 }
  );
  const identity = Object.freeze({
    organizationId: safeMetadataValue(
      purpose.organizationId,
      "purpose.organizationId"
    ),
    customerId: safeMetadataValue(
      purpose.customerId,
      "purpose.customerId"
    ),
    projectId: safeMetadataValue(
      purpose.projectId,
      "purpose.projectId"
    ),
    quoteId: safeMetadataValue(
      purpose.quoteId,
      "purpose.quoteId"
    ),
    provisionId: safeMetadataValue(
      purpose.provisionId,
      "purpose.provisionId"
    )
  });
  return Object.freeze({
    purpose,
    purposeDigest,
    identity,
    idempotencyKey: requestFields.includes(
      "idempotencyKey"
    )
      ? requiredText(
          request.idempotencyKey,
          "idempotencyKey",
          255
        )
      : null,
    stripeCustomerId: requestFields.includes(
      "stripeCustomerId"
    )
      ? providerId(
          request.stripeCustomerId,
          "cus",
          "stripeCustomerId"
        )
      : null
  });
}

function alakazamCustomerMetadata(validated) {
  return {
    schema: STRIPE_ALAKAZAM_CUSTOMER_METADATA_SCHEMA,
    organization_id: validated.identity.organizationId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    quote_id: validated.identity.quoteId,
    provision_id: validated.identity.provisionId,
    accepted_disclosure_digest:
      validated.purpose.acceptedDisclosureDigest,
    quote_digest: validated.purpose.quoteDigest,
    catalog_version: validated.purpose.catalogVersion,
    terms_version: validated.purpose.termsVersion,
    purpose_digest: validated.purposeDigest
  };
}

function alakazamCustomerFacts(
  value,
  config,
  validated
) {
  const customerId = providerId(
    value?.id,
    "cus",
    "Stripe Alakazam Customer ID"
  );
  const expectedMetadata =
    alakazamCustomerMetadata(validated);
  invariant(
    value.object === "customer" &&
      value.deleted !== true &&
      value.livemode === config.livemode &&
      exactObjectKeys(
        value.metadata,
        Object.keys(expectedMetadata)
      ) &&
      Object.entries(expectedMetadata).every(
        ([key, expectedValue]) =>
          value.metadata[key] === expectedValue
      ),
    "stripe_alakazam_customer_mismatch",
    "Stripe did not confirm the exact Site Sourcery Customer binding",
    { status: 502 }
  );
  const facts = {
    schema: STRIPE_ALAKAZAM_CUSTOMER_SCHEMA,
    stripeCustomerId: customerId,
    organizationId: validated.identity.organizationId,
    customerId: validated.identity.customerId,
    projectId: validated.identity.projectId,
    quoteId: validated.identity.quoteId,
    provisionId: validated.identity.provisionId,
    providerCreatedAt: exactProviderTime(
      value.created,
      "Stripe Alakazam Customer created time"
    ),
    purposeDigest: validated.purposeDigest
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function validateAlakazamPurpose(
  request,
  config,
  expectedChangeKind,
  requestFields,
  taxMode
) {
  invariant(
    config &&
      exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "catalogVersion",
        "changeKind",
        "currency",
        "currentSubscription",
        "customerId",
        "downloadCredit",
        "dueNowSubtotalMinor",
        "nextRenewalAmountMinor",
        "organizationId",
        "projectId",
        "quoteDigest",
        "quoteId",
        "schema",
        "stripeCustomerId",
        "taxMode",
        "targetAmountMinor",
        "targetTierId",
        "termsVersion"
      ]),
    "stripe_alakazam_purpose_invalid",
    "Alakazam operation requires the exact server purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const target = alakazamTier(purpose.targetTierId);
  const purposeDigest = digest(purpose);
  invariant(
    purpose.schema === STRIPE_ALAKAZAM_PURPOSE_SCHEMA &&
      purpose.catalogVersion ===
        ALAKAZAM_CATALOG_VERSION &&
      purpose.termsVersion === ALAKAZAM_TERMS_VERSION &&
      purpose.changeKind === expectedChangeKind &&
      purpose.currency === "USD" &&
      purpose.taxMode === taxMode &&
      purpose.targetAmountMinor ===
        target.price.amountMinor &&
      purpose.nextRenewalAmountMinor ===
        target.price.amountMinor &&
      SHA256.test(purpose.acceptedDisclosureDigest) &&
      SHA256.test(purpose.quoteDigest) &&
      request.purposeDigest === purposeDigest,
    "stripe_alakazam_purpose_invalid",
    "Alakazam purpose does not match its authoritative digest or tier",
    { status: 500 }
  );
  const identity = Object.freeze({
    organizationId: safeMetadataValue(
      purpose.organizationId,
      "purpose.organizationId"
    ),
    customerId: safeMetadataValue(
      purpose.customerId,
      "purpose.customerId"
    ),
    projectId: safeMetadataValue(
      purpose.projectId,
      "purpose.projectId"
    ),
    quoteId: safeMetadataValue(
      purpose.quoteId,
      "purpose.quoteId"
    ),
    stripeCustomerId: providerId(
      purpose.stripeCustomerId,
      "cus",
      "purpose.stripeCustomerId"
    )
  });
  let current = null;
  let downloadCredit = null;
  if (expectedChangeKind === "start") {
    invariant(
      purpose.currentSubscription === null,
      "stripe_alakazam_purpose_invalid",
      "An Alakazam start cannot bind an existing subscription",
      { status: 500 }
    );
    if (purpose.downloadCredit !== null) {
      invariant(
        exactObjectKeys(purpose.downloadCredit, [
          "amountMinor",
          "entitlementId"
        ]) &&
          purpose.downloadCredit.amountMinor ===
            ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
        "stripe_alakazam_purpose_invalid",
        "Alakazam Download credit must be exactly $5",
        { status: 500 }
      );
      downloadCredit = Object.freeze({
        entitlementId: safeMetadataValue(
          purpose.downloadCredit.entitlementId,
          "purpose.downloadCredit.entitlementId"
        ),
        amountMinor: ALAKAZAM_DOWNLOAD_CREDIT_MINOR
      });
    }
    invariant(
      purpose.dueNowSubtotalMinor ===
        target.price.amountMinor -
          (downloadCredit?.amountMinor ?? 0),
      "stripe_alakazam_purpose_invalid",
      "Alakazam start subtotal does not match its tier and Download credit",
      { status: 500 }
    );
  } else {
    invariant(
      purpose.downloadCredit === null,
      "stripe_alakazam_purpose_invalid",
      "Download credit applies only to the first Alakazam subscription",
      { status: 500 }
    );
    current = validatedAlakazamCurrent(
      purpose.currentSubscription,
      config
    );
    invariant(
      expectedChangeKind === "upgrade"
        ? target.rank > current.tier.rank &&
            purpose.dueNowSubtotalMinor ===
              target.price.amountMinor -
                current.tier.price.amountMinor
        : target.rank < current.tier.rank &&
            purpose.dueNowSubtotalMinor === 0,
      "stripe_alakazam_purpose_invalid",
      "Alakazam tier change does not match the fixed ladder",
      { status: 500 }
    );
  }
  const idempotencyKey = requestFields.includes(
    "idempotencyKey"
  )
    ? requiredText(
        request.idempotencyKey,
        "idempotencyKey",
        255
      )
    : null;
  return Object.freeze({
    purpose,
    purposeDigest,
    identity,
    target,
    targetPriceId: config.tierPriceIds[target.tierId],
    current,
    downloadCredit,
    idempotencyKey
  });
}

function alakazamMetadata(validated) {
  return {
    schema: STRIPE_ALAKAZAM_METADATA_SCHEMA,
    organization_id: validated.identity.organizationId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    quote_id: validated.identity.quoteId,
    change_kind: validated.purpose.changeKind,
    target_tier_id: validated.target.tierId,
    accepted_disclosure_digest:
      validated.purpose.acceptedDisclosureDigest,
    quote_digest: validated.purpose.quoteDigest,
    catalog_version: validated.purpose.catalogVersion,
    terms_version: validated.purpose.termsVersion,
    tax_mode: validated.purpose.taxMode,
    purpose_digest: validated.purposeDigest,
    ...(validated.current
      ? {
          prior_tier_id: validated.current.tier.tierId,
          local_subscription_id:
            validated.current.localSubscriptionId,
          subscription_revision: String(
            validated.current.revision
          )
        }
      : {}),
    ...(validated.downloadCredit
      ? {
          download_entitlement_id:
            validated.downloadCredit.entitlementId
        }
      : {})
  };
}

function alakazamReturnUrl(template, validated) {
  const parsed = new URL(template);
  invariant(
    !parsed.searchParams.has("alakazam_project") &&
      !parsed.searchParams.has("alakazam_change"),
    "stripe_redirect_invalid",
    "Alakazam return URL already contains change identity",
    { status: 500 }
  );
  parsed.searchParams.set(
    "alakazam_project",
    validated.identity.projectId
  );
  parsed.searchParams.set(
    "alakazam_change",
    validated.purpose.changeKind
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Alakazam success URL",
    { checkoutSessionPlaceholder: true }
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

function validateAlakazamMetadata(value, expected) {
  invariant(
    exactObjectKeys(value, Object.keys(expected)) &&
      Object.entries(expected).every(
        ([key, expectedValue]) =>
          value[key] === expectedValue
      ),
    "stripe_alakazam_payment_mismatch",
    "Stripe Alakazam payment metadata changed",
    { status: 502 }
  );
}

function expandedAlakazamObject(value, prefix, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
    "stripe_alakazam_payment_mismatch",
    `${field} was not expanded by Stripe`,
    { status: 502 }
  );
  providerId(value.id, prefix, `${field}.id`);
  return value;
}

function alakazamPaymentIntentFacts(
  value,
  config,
  validated,
  expectedTotalMinor
) {
  const intent = expandedAlakazamObject(
    value,
    "pi",
    "Stripe Alakazam PaymentIntent"
  );
  if (validated.purpose.changeKind === "upgrade") {
    validateAlakazamMetadata(
      intent.metadata,
      alakazamMetadata(validated)
    );
  }
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === expectedTotalMinor &&
      intent.amount_received === expectedTotalMinor &&
      intent.amount_capturable === 0 &&
      providerReferenceId(
        intent.customer,
        "cus",
        "Stripe Alakazam PaymentIntent Customer ID"
      ) === validated.identity.stripeCustomerId,
    "stripe_alakazam_payment_mismatch",
    "Stripe did not confirm the exact Alakazam PaymentIntent",
    { status: 502 }
  );
  return intent;
}

function alakazamPaymentFacts(
  value,
  config,
  validated,
  checkoutSessionId,
  observedAt
) {
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Alakazam Checkout Session ID"
  );
  const expectedMetadata =
    alakazamMetadata(validated);
  validateAlakazamMetadata(
    value.metadata,
    expectedMetadata
  );
  const automaticTax = config.taxMode === "automatic";
  const discountMinor =
    validated.downloadCredit?.amountMinor ?? 0;
  const listSubtotalMinor =
    validated.purpose.changeKind === "start"
      ? validated.target.price.amountMinor
      : validated.purpose.dueNowSubtotalMinor;
  const netSubtotalMinor =
    listSubtotalMinor - discountMinor;
  const taxMinor = automaticTax
    ? integer(
        value.total_details?.amount_tax,
        "Stripe Alakazam tax amount",
        0,
        99_999_999
      )
    : 0;
  const totalMinor = netSubtotalMinor + taxMinor;
  const discounts = Array.isArray(
    value.total_details?.breakdown?.discounts
  )
    ? value.total_details.breakdown.discounts
    : [];
  const discountMatches =
    discountMinor === 0
      ? discounts.length === 0
      : discounts.length === 1 &&
        discounts[0].amount === discountMinor &&
        (
          typeof discounts[0].discount?.coupon ===
          "string"
            ? discounts[0].discount.coupon
            : discounts[0].discount?.coupon?.id
        ) === config.alakazam.downloadCreditCouponId;
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.quoteId &&
      value.mode ===
        (validated.purpose.changeKind === "start"
          ? "subscription"
          : "payment") &&
      value.livemode === config.livemode &&
      value.status === "complete" &&
      value.payment_status === "paid" &&
      value.currency === "usd" &&
      value.amount_subtotal === listSubtotalMinor &&
      value.amount_total === totalMinor &&
      value.total_details?.amount_discount ===
        discountMinor &&
      value.total_details?.amount_shipping === 0 &&
      discountMatches &&
      value.automatic_tax?.enabled === automaticTax &&
      (
        automaticTax
          ? value.automatic_tax?.status === "complete"
          : value.automatic_tax?.status === null ||
            value.automatic_tax?.status === undefined
      ) &&
      providerReferenceId(
        value.customer,
        "cus",
        "Stripe Alakazam Checkout Customer ID"
      ) === validated.identity.stripeCustomerId &&
      Array.isArray(value.line_items?.data) &&
      value.line_items.data.length === 1 &&
      value.line_items.has_more === false &&
      value.line_items.data[0].quantity === 1,
    "stripe_alakazam_payment_mismatch",
    "Stripe did not confirm the exact paid Alakazam Checkout",
    { status: 502 }
  );
  const linePrice = expandedAlakazamObject(
    value.line_items.data[0].price,
    "price",
    "Stripe Alakazam Checkout line Price"
  );
  if (validated.purpose.changeKind === "start") {
    const expectedPrice = config.priceExpectations.find(
      ({ id }) => id === validated.targetPriceId
    );
    invariant(
      expectedPrice &&
        priceMatches(linePrice, expectedPrice),
      "stripe_alakazam_payment_mismatch",
      "Stripe Alakazam start Checkout used the wrong recurring Price",
      { status: 502 }
    );
  } else {
    invariant(
      linePrice.active === true &&
        linePrice.livemode === config.livemode &&
        linePrice.currency === "usd" &&
        linePrice.unit_amount === listSubtotalMinor &&
        linePrice.recurring === null &&
        providerReferenceId(
          linePrice.product,
          "prod",
          "Stripe Alakazam upgrade Product ID"
        ) === config.alakazam.productId,
      "stripe_alakazam_payment_mismatch",
      "Stripe Alakazam upgrade Checkout used the wrong fixed-difference Price",
      { status: 502 }
    );
  }
  let invoiceId = null;
  let subscriptionFacts = null;
  let intent;
  let providerPaymentTime;
  if (validated.purpose.changeKind === "start") {
    subscriptionFacts = alakazamSubscriptionFacts(
      expandedAlakazamObject(
        value.subscription,
        "sub",
        "Stripe Alakazam Subscription"
      ),
      config,
      validated.identity.stripeCustomerId,
      observedAt
    );
    invariant(
      subscriptionFacts.tierId ===
        validated.target.tierId &&
        subscriptionFacts.providerStatus === "active" &&
        subscriptionFacts.cancelAtPeriodEnd === false &&
        Object.entries(expectedMetadata).every(
          ([key, expectedValue]) =>
            subscriptionFacts.metadata[key] === expectedValue
        ),
      "stripe_alakazam_payment_mismatch",
      "Stripe did not confirm the exact active Alakazam start Subscription",
      { status: 502 }
    );
    const invoice = expandedAlakazamObject(
      value.invoice,
      "in",
      "Stripe Alakazam first Invoice"
    );
    invoiceId = invoice.id;
    const invoicePayments = invoice.payments?.data;
    const invoiceDiscountMinor = Array.isArray(
      invoice.total_discount_amounts
    )
      ? invoice.total_discount_amounts.reduce(
          (sum, item) =>
            sum +
            integer(
              item?.amount,
              "Stripe Alakazam Invoice discount amount",
              0,
              99_999_999
            ),
          0
        )
      : 0;
    invariant(
      invoice.livemode === config.livemode &&
        invoice.status === "paid" &&
        invoice.currency === "usd" &&
        invoiceDiscountMinor === discountMinor &&
        invoice.total === totalMinor &&
        invoice.amount_paid === totalMinor &&
        invoice.amount_remaining === 0 &&
        providerReferenceId(
          invoice.customer,
          "cus",
          "Stripe Alakazam Invoice Customer ID"
        ) === validated.identity.stripeCustomerId &&
        invoice.parent?.type ===
          "subscription_details" &&
        providerReferenceId(
          invoice.parent.subscription_details
            ?.subscription,
          "sub",
          "Stripe Alakazam Invoice Subscription ID"
        ) === subscriptionFacts.stripeSubscriptionId &&
        Object.entries(expectedMetadata).every(
          ([key, expectedValue]) =>
            invoice.parent.subscription_details
              ?.metadata?.[key] === expectedValue
        ) &&
        Array.isArray(invoicePayments) &&
        invoicePayments.length === 1 &&
        invoicePayments[0].status === "paid" &&
        invoicePayments[0].livemode === config.livemode &&
        invoicePayments[0].currency === "usd" &&
        invoicePayments[0].amount_paid === totalMinor &&
        invoicePayments[0].amount_requested === totalMinor &&
        invoicePayments[0].payment?.type ===
          "payment_intent",
      "stripe_alakazam_payment_mismatch",
      "Stripe did not confirm the exact paid first Alakazam Invoice",
      { status: 502 }
    );
    intent = alakazamPaymentIntentFacts(
      invoicePayments[0].payment.payment_intent,
      config,
      validated,
      totalMinor
    );
    providerPaymentTime = exactProviderTime(
      invoicePayments[0].status_transitions?.paid_at,
      "Stripe Alakazam Invoice payment time"
    );
  } else {
    invariant(
      value.subscription === null &&
        value.invoice === null,
      "stripe_alakazam_payment_mismatch",
      "Stripe upgrade difference Checkout cannot create another Subscription or Invoice",
      { status: 502 }
    );
    intent = alakazamPaymentIntentFacts(
      value.payment_intent,
      config,
      validated,
      totalMinor
    );
    const charge = expandedAlakazamObject(
      intent.latest_charge,
      "ch",
      "Stripe Alakazam upgrade Charge"
    );
    invariant(
      charge.livemode === config.livemode &&
        charge.status === "succeeded" &&
        charge.paid === true &&
        charge.captured === true &&
        charge.refunded === false &&
        charge.currency === "usd" &&
        charge.amount === totalMinor &&
        charge.amount_captured === totalMinor &&
        providerReferenceId(
          charge.customer,
          "cus",
          "Stripe Alakazam Charge Customer ID"
        ) === validated.identity.stripeCustomerId &&
        providerReferenceId(
          charge.payment_intent,
          "pi",
          "Stripe Alakazam Charge PaymentIntent ID"
        ) === intent.id,
      "stripe_alakazam_payment_mismatch",
      "Stripe did not confirm the exact captured Alakazam upgrade Charge",
      { status: 502 }
    );
    providerPaymentTime = exactProviderTime(
      charge.created,
      "Stripe Alakazam upgrade payment time"
    );
  }
  const facts = {
    schema: STRIPE_ALAKAZAM_PAYMENT_SCHEMA,
    provider: "stripe",
    changeKind: validated.purpose.changeKind,
    checkoutSessionId: checkoutId,
    stripeCustomerId: validated.identity.stripeCustomerId,
    stripeSubscriptionId:
      subscriptionFacts?.stripeSubscriptionId ??
      validated.current?.stripeSubscriptionId ?? null,
    stripeSubscriptionItemId:
      subscriptionFacts?.stripeSubscriptionItemId ??
      validated.current?.stripeSubscriptionItemId ?? null,
    stripePriceId:
      subscriptionFacts?.stripePriceId ??
      validated.targetPriceId,
    stripeInvoiceId: invoiceId,
    stripePaymentIntentId: intent.id,
    targetTierId: validated.target.tierId,
    listSubtotalMinor,
    providerDiscountMinor: discountMinor,
    netSubtotalMinor,
    taxMinor,
    totalMinor,
    taxMode: config.taxMode,
    currency: "USD",
    paymentStatus: "paid",
    purposeDigest: validated.purposeDigest,
    providerPaymentTime,
    subscription: subscriptionFacts
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
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

function alakazamProviderClient(client) {
  invariant(
    typeof client.checkout?.sessions?.retrieve ===
        "function" &&
      typeof client.coupons?.retrieve === "function" &&
      typeof client.customers?.create === "function" &&
      typeof client.customers?.retrieve === "function" &&
      typeof client.products?.retrieve === "function" &&
      typeof client.billingPortal?.configurations
        ?.retrieve === "function" &&
      typeof client.subscriptions?.retrieve ===
        "function" &&
      typeof client.subscriptions?.update === "function" &&
      typeof client.subscriptionSchedules?.create ===
        "function" &&
      typeof client.subscriptionSchedules?.retrieve ===
        "function" &&
      typeof client.subscriptionSchedules?.update ===
        "function",
    "stripe_client_invalid",
    "The Stripe Alakazam provider contract is incomplete",
    { status: 500 }
  );
  return client;
}

function productMatchesAlakazam(value, config, livemode) {
  return (
    value &&
    value.id === config.productId &&
    value.active === true &&
    value.livemode === livemode &&
    value.name === "Alakazam"
  );
}

function couponMatchesAlakazam(value, config, livemode) {
  return (
    value &&
    value.id === config.downloadCreditCouponId &&
    value.valid === true &&
    value.livemode === livemode &&
    value.amount_off === ALAKAZAM_DOWNLOAD_CREDIT_MINOR &&
    value.currency === "usd" &&
    value.duration === "once" &&
    value.duration_in_months === null &&
    value.max_redemptions === null &&
    value.percent_off === null &&
    value.redeem_by === null &&
    Array.isArray(value.applies_to?.products) &&
    value.applies_to.products.length === 1 &&
    value.applies_to.products[0] === config.productId
  );
}

function portalConfigurationMatchesAlakazam(
  value,
  config,
  livemode,
  portalReturnUrl
) {
  return (
    value &&
    value.id === config.portalConfigurationId &&
    value.active === true &&
    value.livemode === livemode &&
    value.default_return_url === portalReturnUrl &&
    value.features?.payment_method_update?.enabled ===
      true &&
    value.features?.invoice_history?.enabled === true &&
    value.features?.customer_update?.enabled === false &&
    value.features?.subscription_update?.enabled ===
      false &&
    value.features?.subscription_cancel?.enabled === false
  );
}

function providerReferenceId(value, prefix, field) {
  return providerId(
    typeof value === "string" ? value : value?.id,
    prefix,
    field
  );
}

function alakazamSubscriptionFacts(
  value,
  config,
  expectedCustomerId,
  observedAt
) {
  const subscriptionId = providerId(
    value?.id,
    "sub",
    "Stripe Alakazam Subscription ID"
  );
  const stripeCustomerId = providerReferenceId(
    value.customer,
    "cus",
    "Stripe Alakazam Customer ID"
  );
  invariant(
    stripeCustomerId === expectedCustomerId &&
      value.livemode === config.livemode &&
      value.collection_method === "charge_automatically" &&
      value.automatic_tax?.enabled ===
        (config.taxMode === "automatic") &&
      value.pending_update === null &&
      value.pause_collection === null &&
      [
        "active",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "past_due",
        "paused",
        "trialing",
        "unpaid"
      ].includes(value.status) &&
      Array.isArray(value.items?.data) &&
      value.items.data.length === 1,
    "stripe_alakazam_subscription_mismatch",
    "Stripe Alakazam Subscription no longer matches its exact account contract",
    { status: 503 }
  );
  const item = value.items.data[0];
  const stripeSubscriptionItemId = providerId(
    item?.id,
    "si",
    "Stripe Alakazam Subscription Item ID"
  );
  const stripePriceId = providerReferenceId(
    item?.price,
    "price",
    "Stripe Alakazam Subscription Price ID"
  );
  const tierId = ALAKAZAM_TIER_IDS.find(
    (candidate) =>
      config.alakazam.tierPriceIds[candidate] ===
      stripePriceId
  );
  invariant(
    tierId &&
      item.quantity === 1 &&
      Number.isSafeInteger(item.current_period_start) &&
      Number.isSafeInteger(item.current_period_end) &&
      item.current_period_start > 0 &&
      item.current_period_end > item.current_period_start &&
      Number.isSafeInteger(value.billing_cycle_anchor) &&
      value.billing_cycle_anchor > 0,
    "stripe_alakazam_subscription_mismatch",
    "Stripe Alakazam Subscription has an unexpected item, Price, quantity, or billing period",
    { status: 503 }
  );
  const expectedPrice = config.priceExpectations.find(
    ({ id }) => id === stripePriceId
  );
  invariant(
    expectedPrice && priceMatches(item.price, expectedPrice),
    "stripe_alakazam_subscription_mismatch",
    "Stripe Alakazam Subscription Price readback drifted",
    { status: 503 }
  );
  let stripeScheduleId = null;
  if (value.schedule !== null && value.schedule !== undefined) {
    stripeScheduleId = providerReferenceId(
      value.schedule,
      "sub_sched",
      "Stripe Alakazam Subscription Schedule ID"
    );
  }
  const facts = {
    schema: STRIPE_ALAKAZAM_SUBSCRIPTION_SCHEMA,
    stripeSubscriptionId: subscriptionId,
    stripeSubscriptionItemId,
    stripeCustomerId,
    stripePriceId,
    stripeScheduleId,
    tierId,
    amountMinor:
      ALAKAZAM_TIER_DEFINITIONS[tierId].price.amountMinor,
    currency: "USD",
    providerStatus: value.status,
    cancelAtPeriodEnd:
      value.cancel_at_period_end === true,
    currentPeriodStartsAt: exactProviderTime(
      item.current_period_start,
      "Stripe Alakazam current period start"
    ),
    currentPeriodEndsAt: exactProviderTime(
      item.current_period_end,
      "Stripe Alakazam current period end"
    ),
    billingCycleAnchor: exactProviderTime(
      value.billing_cycle_anchor,
      "Stripe Alakazam billing cycle anchor"
    ),
    providerObservedAt: canonicalIso(
      observedAt,
      "providerObservedAt"
    ),
    metadata:
      value.metadata &&
      typeof value.metadata === "object" &&
      !Array.isArray(value.metadata)
        ? structuredClone(value.metadata)
        : {}
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function schedulePhasePriceId(phase, field) {
  invariant(
    Array.isArray(phase?.items) &&
      phase.items.length === 1 &&
      phase.items[0].quantity === 1,
    "stripe_alakazam_schedule_mismatch",
    `${field} must contain one quantity-one Price`,
    { status: 503 }
  );
  return providerReferenceId(
    phase.items[0].price,
    "price",
    `${field} Price ID`
  );
}

function alakazamScheduleFacts(
  value,
  config,
  validated,
  observedAt
) {
  const scheduleId = providerId(
    value?.id,
    "sub_sched",
    "Stripe Alakazam Subscription Schedule ID"
  );
  const subscriptionId = providerReferenceId(
    value.subscription,
    "sub",
    "Stripe Alakazam scheduled Subscription ID"
  );
  const customerId = providerReferenceId(
    value.customer,
    "cus",
    "Stripe Alakazam scheduled Customer ID"
  );
  const phases = value.phases;
  const currentStart = isoToProviderSeconds(
    validated.current.currentPeriodStartsAt,
    "currentSubscription.currentPeriodStartsAt"
  );
  const effectiveAt = isoToProviderSeconds(
    validated.current.currentPeriodEndsAt,
    "currentSubscription.currentPeriodEndsAt"
  );
  invariant(
    value.livemode === config.livemode &&
      value.status === "active" &&
      subscriptionId ===
        validated.current.stripeSubscriptionId &&
      customerId === validated.identity.stripeCustomerId,
    "stripe_alakazam_schedule_identity_mismatch",
    "Stripe Alakazam Schedule identity no longer matches its Subscription",
    { status: 503 }
  );
  invariant(
    value.end_behavior === "release" &&
      Array.isArray(phases) &&
      phases.length === 2 &&
      value.current_phase?.start_date === currentStart &&
      value.current_phase?.end_date === effectiveAt &&
      phases[0].start_date === currentStart &&
      phases[0].end_date === effectiveAt &&
      phases[0].proration_behavior === "none" &&
      phases[0].collection_method ===
        "charge_automatically" &&
      phases[0].automatic_tax?.enabled ===
        (config.taxMode === "automatic") &&
      phases[1].start_date === effectiveAt &&
      Number.isSafeInteger(phases[1].end_date) &&
      phases[1].end_date > effectiveAt &&
      phases[1].proration_behavior === "none" &&
      phases[1].collection_method ===
        "charge_automatically" &&
      phases[1].automatic_tax?.enabled ===
        (config.taxMode === "automatic") &&
      schedulePhasePriceId(
        phases[0],
        "Stripe Alakazam current schedule phase"
      ) === validated.current.stripePriceId &&
      schedulePhasePriceId(
        phases[1],
        "Stripe Alakazam target schedule phase"
      ) === validated.targetPriceId &&
      value.metadata?.schema ===
        STRIPE_ALAKAZAM_METADATA_SCHEMA &&
      value.metadata?.purpose_digest ===
        validated.purposeDigest &&
      value.metadata?.target_tier_id ===
        validated.target.tierId,
    "stripe_alakazam_schedule_mismatch",
    "Stripe did not confirm the exact renewal-boundary Alakazam downgrade",
    { status: 503 }
  );
  const facts = {
    schema: STRIPE_ALAKAZAM_SCHEDULE_SCHEMA,
    stripeScheduleId: scheduleId,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId,
    currentTierId: validated.current.tier.tierId,
    targetTierId: validated.target.tierId,
    currentPriceId: validated.current.stripePriceId,
    targetPriceId: validated.targetPriceId,
    effectiveAt: validated.current.currentPeriodEndsAt,
    endBehavior: "release",
    providerProration: false,
    providerObservedAt: canonicalIso(
      observedAt,
      "providerObservedAt"
    )
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function alakazamCurrentMatches(
  facts,
  validated,
  expectedScheduleId = null
) {
  return (
    facts.stripeSubscriptionId ===
      validated.current.stripeSubscriptionId &&
    facts.stripeSubscriptionItemId ===
      validated.current.stripeSubscriptionItemId &&
    facts.stripeCustomerId ===
      validated.identity.stripeCustomerId &&
    facts.stripePriceId ===
      validated.current.stripePriceId &&
    facts.tierId === validated.current.tier.tierId &&
    facts.currentPeriodStartsAt ===
      validated.current.currentPeriodStartsAt &&
    facts.currentPeriodEndsAt ===
      validated.current.currentPeriodEndsAt &&
    facts.providerStatus === "active" &&
    facts.cancelAtPeriodEnd === false &&
    facts.stripeScheduleId === expectedScheduleId
  );
}

function alakazamUpgradeMatches(
  facts,
  before,
  validated,
  paymentEvidence
) {
  return (
    facts.stripeSubscriptionId ===
      validated.current.stripeSubscriptionId &&
    facts.stripeSubscriptionItemId ===
      validated.current.stripeSubscriptionItemId &&
    facts.stripeCustomerId ===
      validated.identity.stripeCustomerId &&
    facts.stripePriceId === validated.targetPriceId &&
    facts.tierId === validated.target.tierId &&
    facts.currentPeriodStartsAt ===
      before.currentPeriodStartsAt &&
    facts.currentPeriodEndsAt === before.currentPeriodEndsAt &&
    facts.billingCycleAnchor === before.billingCycleAnchor &&
    facts.providerStatus === "active" &&
    facts.cancelAtPeriodEnd === false &&
    facts.stripeScheduleId === null &&
    facts.metadata?.schema ===
      STRIPE_ALAKAZAM_METADATA_SCHEMA &&
    facts.metadata?.purpose_digest ===
      validated.purposeDigest &&
    facts.metadata?.payment_facts_digest ===
      paymentEvidence.providerFactsDigest
  );
}

function alakazamUpgradeAlreadyApplied(
  facts,
  validated,
  paymentEvidence
) {
  return (
    facts.stripeSubscriptionId ===
      validated.current.stripeSubscriptionId &&
    facts.stripeSubscriptionItemId ===
      validated.current.stripeSubscriptionItemId &&
    facts.stripeCustomerId ===
      validated.identity.stripeCustomerId &&
    facts.stripePriceId === validated.targetPriceId &&
    facts.tierId === validated.target.tierId &&
    facts.currentPeriodStartsAt ===
      validated.current.currentPeriodStartsAt &&
    facts.currentPeriodEndsAt ===
      validated.current.currentPeriodEndsAt &&
    facts.providerStatus === "active" &&
    facts.cancelAtPeriodEnd === false &&
    facts.stripeScheduleId === null &&
    facts.metadata?.schema ===
      STRIPE_ALAKAZAM_METADATA_SCHEMA &&
    facts.metadata?.purpose_digest ===
      validated.purposeDigest &&
    facts.metadata?.payment_facts_digest ===
      paymentEvidence.providerFactsDigest
  );
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
      createAlakazamCustomer: reject,
      retrieveAlakazamCustomer: reject,
      createAlakazamStartCheckout: reject,
      createAlakazamUpgradeCheckout: reject,
      retrieveAlakazamPayment: reject,
      retrieveAlakazamSubscription: reject,
      applyAlakazamUpgrade: reject,
      scheduleAlakazamDowngrade: reject,
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
  const alakazamCapabilities =
    STRIPE_ALAKAZAM_CAPABILITIES;
  if (config.alakazam) {
    invariant(
      alakazamCapabilities.every((capability) =>
        capabilities.has(capability)
      ),
      "stripe_alakazam_configuration_invalid",
      "Stripe Alakazam configuration requires its complete approved capability set",
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

  async function verifyAlakazamConfiguration() {
    invariant(
      config.alakazam,
      "stripe_alakazam_not_configured",
      "Stripe Alakazam effects are held",
      { status: 503 }
    );
    for (const capability of alakazamCapabilities) {
      requireCapability(capability);
    }
    alakazamProviderClient(client);
    await verifyPrices();
    let product;
    try {
      product = await client.products.retrieve(
        config.alakazam.productId
      );
    } catch {
      throw noEffect(
        "stripe_alakazam_product_unavailable",
        "The exact Alakazam Product could not be verified"
      );
    }
    invariant(
      productMatchesAlakazam(
        product,
        config.alakazam,
        config.livemode
      ),
      "stripe_alakazam_product_mismatch",
      "The Alakazam Product no longer matches the owner contract",
      { status: 503 }
    );
    let coupon;
    try {
      coupon = await client.coupons.retrieve(
        config.alakazam.downloadCreditCouponId
      );
    } catch {
      throw noEffect(
        "stripe_alakazam_coupon_unavailable",
        "The exact Alakazam Download credit Coupon could not be verified"
      );
    }
    invariant(
      couponMatchesAlakazam(
        coupon,
        config.alakazam,
        config.livemode
      ),
      "stripe_alakazam_coupon_mismatch",
      "The Alakazam Download credit Coupon no longer matches the owner contract",
      { status: 503 }
    );
    let portal;
    try {
      portal =
        await client.billingPortal.configurations.retrieve(
          config.alakazam.portalConfigurationId
        );
    } catch {
      throw noEffect(
        "stripe_alakazam_portal_configuration_unavailable",
        "The restricted Alakazam Billing Portal configuration could not be verified"
      );
    }
    invariant(
      portalConfigurationMatchesAlakazam(
        portal,
        config.alakazam,
        config.livemode,
        config.portalReturnUrl
      ),
      "stripe_alakazam_portal_configuration_mismatch",
      "The Alakazam Billing Portal can bypass the reviewed account boundary",
      { status: 503 }
    );
  }

  async function retrieveAlakazamSubscriptionInternal({
    stripeSubscriptionId,
    stripeCustomerId
  }) {
    requireCapability("subscriptions:read");
    alakazamProviderClient(client);
    const subscriptionId = providerId(
      stripeSubscriptionId,
      "sub",
      "stripeSubscriptionId"
    );
    const customerId = providerId(
      stripeCustomerId,
      "cus",
      "stripeCustomerId"
    );
    let response;
    try {
      response = await client.subscriptions.retrieve(
        subscriptionId,
        {
          expand: ["items.data.price", "schedule"]
        }
      );
    } catch {
      throw noEffect(
        "stripe_alakazam_subscription_read_unavailable",
        "Stripe Alakazam Subscription could not be read for reconciliation",
        { stripeSubscriptionId: subscriptionId }
      );
    }
    return alakazamSubscriptionFacts(
      response,
      config,
      customerId,
      clock.now()
    );
  }

  async function retrieveAlakazamScheduleInternal({
    stripeScheduleId,
    validated
  }) {
    requireCapability("subscription_schedules:read");
    alakazamProviderClient(client);
    const scheduleId = providerId(
      stripeScheduleId,
      "sub_sched",
      "stripeScheduleId"
    );
    let response;
    try {
      response = await client.subscriptionSchedules.retrieve(
        scheduleId,
        { expand: ["phases.items.price"] }
      );
    } catch {
      throw noEffect(
        "stripe_alakazam_schedule_read_unavailable",
        "Stripe Alakazam downgrade Schedule could not be read for reconciliation",
        { stripeScheduleId: scheduleId }
      );
    }
    return alakazamScheduleFacts(
      response,
      config,
      validated,
      clock.now()
    );
  }

  async function createAlakazamCheckoutInternal(
    validated,
    params,
    operation
  ) {
    const stripeIdempotencyKey =
      providerIdempotencyKey(
        operation,
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
        "stripe_alakazam_checkout_effect_unknown",
        "Stripe Alakazam Checkout creation must be reconciled by idempotency key",
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
        params.expires_at
      );
    } catch {
      throw ambiguous(
        "stripe_alakazam_checkout_response_invalid",
        "Stripe Alakazam Checkout returned an unsafe response that requires reconciliation",
        {
          idempotencyKey: stripeIdempotencyKey,
          purposeDigest: validated.purposeDigest
        }
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
        if (config.alakazam) {
          await verifyAlakazamConfiguration();
        } else if (capabilities.has("prices:read")) {
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
          taxMode: config.taxMode,
          ...(config.alakazam
            ? { alakazam: true }
            : {})
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

    async createAlakazamCustomer(request) {
      requireCapability("customers:create");
      requireCapability("customers:read");
      const validated =
        validateAlakazamCustomerPurpose(request, [
          "idempotencyKey",
          "purpose",
          "purposeDigest"
        ]);
      await verifyAlakazamConfiguration();
      const params = {
        description: "Site Sourcery Alakazam customer",
        metadata: alakazamCustomerMetadata(validated)
      };
      const idempotencyKey = providerIdempotencyKey(
        "alakazam_customer",
        validated.idempotencyKey,
        validated.purposeDigest
      );
      let created;
      try {
        created = await client.customers.create(
          params,
          { idempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_alakazam_customer_create_unknown",
          "Stripe Customer creation must be reconciled before retry",
          {
            idempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      let stripeCustomerId;
      try {
        stripeCustomerId = providerId(
          created?.id,
          "cus",
          "Stripe Alakazam created Customer ID"
        );
      } catch {
        throw ambiguous(
          "stripe_alakazam_customer_create_invalid",
          "Stripe Customer creation returned an unsafe response that requires reconciliation",
          {
            idempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      let observed;
      try {
        observed = await client.customers.retrieve(
          stripeCustomerId
        );
        return alakazamCustomerFacts(
          observed,
          config,
          validated
        );
      } catch {
        throw ambiguous(
          "stripe_alakazam_customer_readback_unknown",
          "Stripe Customer creation requires exact readback before use",
          {
            idempotencyKey,
            stripeCustomerId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveAlakazamCustomer(request) {
      requireCapability("customers:read");
      const validated =
        validateAlakazamCustomerPurpose(request, [
          "purpose",
          "purposeDigest",
          "stripeCustomerId"
        ]);
      await verifyAlakazamConfiguration();
      let observed;
      try {
        observed = await client.customers.retrieve(
          validated.stripeCustomerId
        );
      } catch {
        throw noEffect(
          "stripe_alakazam_customer_read_unavailable",
          "The exact Stripe Customer could not be read for reconciliation",
          {
            stripeCustomerId:
              validated.stripeCustomerId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return alakazamCustomerFacts(
        observed,
        config,
        validated
      );
    },

    async createAlakazamStartCheckout(request) {
      requireCapability("checkout:create");
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        "start",
        ["idempotencyKey", "purpose", "purposeDigest"],
        config.taxMode
      );
      await verifyAlakazamConfiguration();
      const providerMetadata =
        alakazamMetadata(validated);
      const expiresAt =
        Math.floor(Date.parse(clock.now()) / 1000) +
        config.checkoutTtlSeconds;
      invariant(
        Number.isSafeInteger(expiresAt),
        "stripe_clock_invalid",
        "Stripe Alakazam Checkout clock is invalid",
        { status: 500 }
      );
      const params = {
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price: validated.targetPriceId,
            quantity: 1
          }
        ],
        ...(validated.downloadCredit
          ? {
              discounts: [
                {
                  coupon:
                    config.alakazam
                      .downloadCreditCouponId
                }
              ]
            }
          : {}),
        success_url: alakazamReturnUrl(
          config.successUrl,
          validated
        ),
        cancel_url: config.cancelUrl,
        customer: validated.identity.stripeCustomerId,
        client_reference_id: validated.identity.quoteId,
        metadata: providerMetadata,
        expires_at: expiresAt,
        automatic_tax: {
          enabled: config.taxMode === "automatic"
        },
        ...(config.taxMode === "automatic"
          ? {
              billing_address_collection: "required",
              customer_update: { address: "auto" }
            }
          : {}),
        subscription_data: {
          metadata: providerMetadata
        }
      };
      return createAlakazamCheckoutInternal(
        validated,
        params,
        "alakazam_start_checkout"
      );
    },

    async createAlakazamUpgradeCheckout(request) {
      requireCapability("checkout:create");
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        "upgrade",
        ["idempotencyKey", "purpose", "purposeDigest"],
        config.taxMode
      );
      await verifyAlakazamConfiguration();
      const providerMetadata =
        alakazamMetadata(validated);
      const expiresAt =
        Math.floor(Date.parse(clock.now()) / 1000) +
        config.checkoutTtlSeconds;
      invariant(
        Number.isSafeInteger(expiresAt),
        "stripe_clock_invalid",
        "Stripe Alakazam Checkout clock is invalid",
        { status: 500 }
      );
      const params = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount:
                validated.purpose.dueNowSubtotalMinor,
              ...(config.taxMode === "automatic"
                ? { tax_behavior: "exclusive" }
                : {}),
              product: config.alakazam.productId
            },
            quantity: 1
          }
        ],
        success_url: alakazamReturnUrl(
          config.successUrl,
          validated
        ),
        cancel_url: config.cancelUrl,
        customer: validated.identity.stripeCustomerId,
        client_reference_id: validated.identity.quoteId,
        metadata: providerMetadata,
        expires_at: expiresAt,
        automatic_tax: {
          enabled: config.taxMode === "automatic"
        },
        ...(config.taxMode === "automatic"
          ? {
              billing_address_collection: "required",
              customer_update: { address: "auto" }
            }
          : {}),
        payment_intent_data: {
          metadata: providerMetadata
        }
      };
      return createAlakazamCheckoutInternal(
        validated,
        params,
        "alakazam_upgrade_checkout"
      );
    },

    async retrieveAlakazamPayment(request) {
      requireCapability("checkout:read");
      const changeKind = request?.purpose?.changeKind;
      invariant(
        changeKind === "start" ||
          changeKind === "upgrade",
        "stripe_alakazam_payment_read_invalid",
        "Only an Alakazam start or upgrade Checkout can settle payment",
        { status: 500 }
      );
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        changeKind,
        [
          "checkoutSessionId",
          "purpose",
          "purposeDigest"
        ],
        config.taxMode
      );
      alakazamProviderClient(client);
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      let response;
      try {
        response = await client.checkout.sessions.retrieve(
          checkoutSessionId,
          {
            expand: [
              "invoice.payments.data.payment.payment_intent",
              "line_items.data.price.product",
              "payment_intent.latest_charge",
              "subscription.items.data.price"
            ]
          }
        );
      } catch {
        throw noEffect(
          "stripe_alakazam_payment_read_unavailable",
          "Stripe Alakazam payment could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return alakazamPaymentFacts(
        response,
        config,
        validated,
        checkoutSessionId,
        clock.now()
      );
    },

    async retrieveAlakazamSubscription(request = {}) {
      invariant(
        config.alakazam &&
          exactObjectKeys(request, [
            "stripeCustomerId",
            "stripeSubscriptionId"
          ]),
        "stripe_alakazam_subscription_read_invalid",
        "Alakazam Subscription readback requires exact provider identity",
        { status: 500 }
      );
      return retrieveAlakazamSubscriptionInternal(
        request
      );
    },

    async applyAlakazamUpgrade(request) {
      requireCapability("subscriptions:update");
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        "upgrade",
        [
          "idempotencyKey",
          "paymentEvidence",
          "purpose",
          "purposeDigest"
        ],
        config.taxMode
      );
      invariant(
        exactObjectKeys(request.paymentEvidence, [
          "providerFactsDigest",
          "receiptId"
        ]) &&
          SHA256.test(
            request.paymentEvidence.providerFactsDigest
          ),
        "stripe_alakazam_upgrade_evidence_invalid",
        "Alakazam upgrade requires exact settled-payment evidence",
        { status: 500 }
      );
      const paymentEvidence = Object.freeze({
        receiptId: safeMetadataValue(
          request.paymentEvidence.receiptId,
          "paymentEvidence.receiptId"
        ),
        providerFactsDigest:
          request.paymentEvidence.providerFactsDigest
      });
      await verifyAlakazamConfiguration();
      const before =
        await retrieveAlakazamSubscriptionInternal({
          stripeSubscriptionId:
            validated.current.stripeSubscriptionId,
          stripeCustomerId:
            validated.identity.stripeCustomerId
        });
      if (
        alakazamUpgradeAlreadyApplied(
          before,
          validated,
          paymentEvidence
        )
      ) {
        return Object.freeze({
          ...before,
          reconciliation:
            "confirmed_before_submit"
        });
      }
      invariant(
        alakazamCurrentMatches(before, validated),
        "stripe_alakazam_upgrade_stale",
        "Stripe Alakazam Subscription changed before the upgrade could be applied",
        { status: 409 }
      );
      const stripeIdempotencyKey =
        providerIdempotencyKey(
          "alakazam_upgrade_apply",
          validated.idempotencyKey,
          digest({
            purposeDigest: validated.purposeDigest,
            paymentFactsDigest:
              paymentEvidence.providerFactsDigest
          })
        );
      const params = {
        items: [
          {
            id: validated.current
              .stripeSubscriptionItemId,
            price: validated.targetPriceId,
            quantity: 1
          }
        ],
        proration_behavior: "none",
        billing_cycle_anchor: "unchanged",
        metadata: {
          ...alakazamMetadata(validated),
          payment_receipt_id: paymentEvidence.receiptId,
          payment_facts_digest:
            paymentEvidence.providerFactsDigest
        }
      };
      try {
        await client.subscriptions.update(
          validated.current.stripeSubscriptionId,
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        try {
          const reconciled =
            await retrieveAlakazamSubscriptionInternal({
              stripeSubscriptionId:
                validated.current.stripeSubscriptionId,
              stripeCustomerId:
                validated.identity.stripeCustomerId
            });
          if (
            alakazamUpgradeMatches(
              reconciled,
              before,
              validated,
              paymentEvidence
            )
          ) {
            return Object.freeze({
              ...reconciled,
              reconciliation:
                "confirmed_after_ambiguous_submit"
            });
          }
        } catch {
          // The original provider write remains ambiguous.
        }
        throw ambiguous(
          "stripe_alakazam_upgrade_effect_unknown",
          "Stripe Alakazam upgrade must be reconciled without collecting another payment",
          {
            idempotencyKey: stripeIdempotencyKey,
            stripeSubscriptionId:
              validated.current.stripeSubscriptionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      let confirmed;
      try {
        confirmed =
          await retrieveAlakazamSubscriptionInternal({
            stripeSubscriptionId:
              validated.current.stripeSubscriptionId,
            stripeCustomerId:
              validated.identity.stripeCustomerId
          });
      } catch {
        throw ambiguous(
          "stripe_alakazam_upgrade_confirmation_unknown",
          "Stripe accepted the Alakazam upgrade but exact readback is unavailable",
          {
            idempotencyKey: stripeIdempotencyKey,
            stripeSubscriptionId:
              validated.current.stripeSubscriptionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      if (
        !alakazamUpgradeMatches(
          confirmed,
          before,
          validated,
          paymentEvidence
        )
      ) {
        throw ambiguous(
          "stripe_alakazam_upgrade_confirmation_mismatch",
          "Stripe upgrade readback does not prove the exact target tier and unchanged billing boundary",
          {
            idempotencyKey: stripeIdempotencyKey,
            stripeSubscriptionId:
              validated.current.stripeSubscriptionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return Object.freeze({
        ...confirmed,
        reconciliation: "confirmed"
      });
    },

    async scheduleAlakazamDowngrade(request) {
      requireCapability("subscription_schedules:write");
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        "downgrade",
        [
          "idempotencyKey",
          "purpose",
          "purposeDigest",
          "stripeScheduleId"
        ],
        config.taxMode
      );
      const expectedScheduleId =
        request.stripeScheduleId === null
          ? null
          : providerId(
              request.stripeScheduleId,
              "sub_sched",
              "stripeScheduleId"
            );
      await verifyAlakazamConfiguration();
      const before =
        await retrieveAlakazamSubscriptionInternal({
          stripeSubscriptionId:
            validated.current.stripeSubscriptionId,
          stripeCustomerId:
            validated.identity.stripeCustomerId
        });
      invariant(
        alakazamCurrentMatches(
          before,
          validated,
          expectedScheduleId
        ),
        "stripe_alakazam_downgrade_stale",
        "Stripe Alakazam Subscription changed before the downgrade could be scheduled",
        { status: 409 }
      );
      if (expectedScheduleId !== null) {
        try {
          return await retrieveAlakazamScheduleInternal({
            stripeScheduleId: expectedScheduleId,
            validated
          });
        } catch (error) {
          if (
            error?.code !==
            "stripe_alakazam_schedule_mismatch"
          ) {
            throw error;
          }
        }
      }
      let scheduleId = expectedScheduleId;
      if (scheduleId === null) {
        const attachIdempotencyKey =
          providerIdempotencyKey(
            "alakazam_schedule_attach",
            validated.idempotencyKey,
            validated.purposeDigest
          );
        let attached;
        try {
          attached =
            await client.subscriptionSchedules.create(
              {
                from_subscription:
                  validated.current
                    .stripeSubscriptionId
              },
              {
                idempotencyKey: attachIdempotencyKey
              }
            );
        } catch {
          throw ambiguous(
            "stripe_alakazam_schedule_attach_unknown",
            "Stripe Alakazam Schedule attachment must be reconciled before retry",
            {
              idempotencyKey: attachIdempotencyKey,
              stripeSubscriptionId:
                validated.current.stripeSubscriptionId,
              purposeDigest: validated.purposeDigest
            }
          );
        }
        try {
          scheduleId = providerId(
            attached?.id,
            "sub_sched",
            "Stripe Alakazam attached Schedule ID"
          );
          invariant(
            attached.livemode === config.livemode &&
              ["active", "not_started"].includes(
                attached.status
              ) &&
              providerReferenceId(
                attached.subscription,
                "sub",
                "Stripe Alakazam attached Subscription ID"
              ) ===
                validated.current.stripeSubscriptionId,
            "stripe_alakazam_schedule_attach_invalid",
            "Stripe attached an unsafe Alakazam Schedule",
            { status: 502 }
          );
        } catch {
          throw ambiguous(
            "stripe_alakazam_schedule_attach_invalid",
            "Stripe Schedule attachment returned an unsafe response that requires reconciliation",
            {
              idempotencyKey: attachIdempotencyKey,
              stripeSubscriptionId:
                validated.current.stripeSubscriptionId,
              purposeDigest: validated.purposeDigest
            }
          );
        }
      }
      const updateIdempotencyKey =
        providerIdempotencyKey(
          "alakazam_schedule_update",
          validated.idempotencyKey,
          digest({
            purposeDigest: validated.purposeDigest,
            scheduleId
          })
        );
      const currentStart = isoToProviderSeconds(
        validated.current.currentPeriodStartsAt,
        "currentSubscription.currentPeriodStartsAt"
      );
      const effectiveAt = isoToProviderSeconds(
        validated.current.currentPeriodEndsAt,
        "currentSubscription.currentPeriodEndsAt"
      );
      const metadata = alakazamMetadata(validated);
      const params = {
        end_behavior: "release",
        proration_behavior: "none",
        metadata,
        phases: [
          {
            start_date: currentStart,
            end_date: effectiveAt,
            automatic_tax: {
              enabled: config.taxMode === "automatic"
            },
            collection_method: "charge_automatically",
            items: [
              {
                price:
                  validated.current.stripePriceId,
                quantity: 1
              }
            ],
            proration_behavior: "none",
            metadata: {
              ...metadata,
              active_tier_id:
                validated.current.tier.tierId
            }
          },
          {
            duration: {
              interval: "month",
              interval_count: 1
            },
            automatic_tax: {
              enabled: config.taxMode === "automatic"
            },
            collection_method: "charge_automatically",
            items: [
              {
                price: validated.targetPriceId,
                quantity: 1
              }
            ],
            proration_behavior: "none",
            metadata: {
              ...metadata,
              active_tier_id:
                validated.target.tierId
            }
          }
        ]
      };
      try {
        await client.subscriptionSchedules.update(
          scheduleId,
          params,
          { idempotencyKey: updateIdempotencyKey }
        );
      } catch {
        try {
          return await retrieveAlakazamScheduleInternal({
            stripeScheduleId: scheduleId,
            validated
          });
        } catch {
          throw ambiguous(
            "stripe_alakazam_schedule_effect_unknown",
            "Stripe Alakazam downgrade Schedule must be reconciled without creating another Schedule",
            {
              idempotencyKey: updateIdempotencyKey,
              stripeScheduleId: scheduleId,
              purposeDigest: validated.purposeDigest
            }
          );
        }
      }
      try {
        return await retrieveAlakazamScheduleInternal({
          stripeScheduleId: scheduleId,
          validated
        });
      } catch {
        throw ambiguous(
          "stripe_alakazam_schedule_confirmation_unknown",
          "Stripe accepted the Alakazam downgrade Schedule but exact readback is unavailable",
          {
            idempotencyKey: updateIdempotencyKey,
            stripeScheduleId: scheduleId,
            purposeDigest: validated.purposeDigest
          }
        );
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
      if (config.alakazam) {
        await verifyAlakazamConfiguration();
      }
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
            returnUrl: config.portalReturnUrl,
            configurationId:
              config.alakazam
                ?.portalConfigurationId ?? null
          })
        );
      let response;
      try {
        response =
          await client.billingPortal.sessions.create(
            {
              customer,
              return_url: config.portalReturnUrl,
              ...(config.alakazam
                ? {
                    configuration:
                      config.alakazam
                        .portalConfigurationId
                  }
                : {})
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
