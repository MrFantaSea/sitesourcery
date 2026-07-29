import Stripe from "stripe";

import { digest } from "../../domain/canonical.mjs";
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
  "prices:read",
  "subscriptions:cancel",
  "webhooks:verify"
]);
const BILLING_INTERVALS = new Set(["month", "year"]);
const CHECKOUT_HOSTS = new Set(["checkout.stripe.com"]);
const PORTAL_HOSTS = new Set(["billing.stripe.com"]);
const PROVIDER_ID = /^(?:bps|cs|cus|price|sub)_[A-Za-z0-9_]+$/u;
const SAFE_METADATA_VALUE = /^[A-Za-z0-9._:-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OFFICIAL_CLIENTS = new WeakSet();

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
  if (mode === "approved_live") {
    invariant(
      priceExpectations.length > 0,
      "stripe_configuration_required",
      "At least one owner-approved Stripe Price is required",
      { status: 500 }
    );
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
    priceExpectations: Object.freeze(priceExpectations)
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

function checkoutResponse(value, config) {
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
    url.password
  ) {
    throw ambiguous(
      "stripe_checkout_response_invalid",
      "Stripe created a Checkout Session outside the approved host",
      { checkoutId }
    );
  }
  integer(
    value.expires_at,
    "Stripe Checkout Session expiry",
    1,
    Number.MAX_SAFE_INTEGER
  );
  invariant(
    value.livemode === config.livemode,
    "stripe_checkout_response_invalid",
    "Stripe Checkout Session livemode changed",
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
    url.password
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
      createCheckout: reject,
      createBillingPortal: reject,
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

  const adapter = {
    async readiness() {
      try {
        await verifyPrices();
        return {
          ready: true,
          provider: "stripe",
          mode,
          environment:
            approval?.environment ?? "contract_test",
          livemode: config.livemode,
          apiVersion: config.apiVersion,
          priceCount: config.priceExpectations.length,
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
        return checkoutResponse(response, config);
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
