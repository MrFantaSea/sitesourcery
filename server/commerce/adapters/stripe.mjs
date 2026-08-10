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
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_TERMS_VERSION,
  ALAKAZAM_TIER_DEFINITIONS,
  ALAKAZAM_TIER_IDS,
  createAlakazamProviderMetadata
} from "../../commerce-v2/alakazam.mjs";
import {
  ALAKAZAM_CANCELLATION_FACTS_SCHEMA
} from "../../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA
} from "../../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  ALAKAZAM_REVERSAL_FACTS_SCHEMA
} from "../../commerce-v2/alakazam-lifecycle-reversal.mjs";
import {
  ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA
} from "../../commerce-v2/alakazam-lifecycle-state.mjs";
import { createHeldStripeAdapter } from "./held.mjs";

export const STRIPE_API_VERSION = "2026-06-24.dahlia";
export const STRIPE_PROVIDER_MODES = Object.freeze([
  "held",
  "contract_test",
  "approved_live"
]);
export const STRIPE_READINESS_PURPOSES = Object.freeze([
  "alakazam",
  "customBuildChange",
  "customBuildFinal",
  "customBuildStart",
  "domainRegistration",
  "download",
  "serviceAssessment",
  "siteService"
]);
export const STRIPE_ALAKAZAM_CAPABILITIES =
  Object.freeze([
    "billing_portal_configurations:read",
    "checkout:create",
    "checkout:read",
    "coupons:read",
    "charges:read",
    "customers:create",
    "customers:read",
    "disputes:read",
    "invoices:read",
    "prices:read",
    "products:read",
    "refunds:read",
    "subscriptions:read",
    "subscriptions:update",
    "subscription_schedules:read",
    "subscription_schedules:write"
  ]);

export const STRIPE_REQUIRED_WEBHOOK_EVENTS = Object.freeze([
  "charge.dispute.closed",
  "charge.dispute.created",
  "charge.dispute.funds_reinstated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.updated",
  "charge.refunded",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "invoice.paid",
  "invoice.payment_action_required",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
  "refund.created",
  "refund.failed",
  "refund.updated"
].sort());

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
  "webhook_endpoints:read",
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
const PROVIDER_ID = /^(bpc|bps|ch|cs|cus|dp|in|pi|price|prod|re|si|sub_sched|sub|txn|we)_[A-Za-z0-9_]+$/u;
const SAFE_METADATA_VALUE = /^[A-Za-z0-9._:-]+$/u;
const TAX_CODE = /^txcd_[A-Za-z0-9]+$/u;
const TAX_REGISTRATION_ID = /^taxreg_[A-Za-z0-9_]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OFFICIAL_CLIENTS = new WeakSet();
const DOWNLOAD_CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.abracadabra-checkout-purpose.v2";
const DOWNLOAD_CHECKOUT_METADATA_SCHEMA =
  "sitesourcery_download_checkout_v2";
const DOWNLOAD_CHECKOUT_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-download-checkout-lifecycle/v2";
export const STRIPE_SERVICE_ASSESSMENT_PURPOSE_SCHEMA =
  "sitesourcery.custom-services-assessment-checkout-purpose/v1";
const STRIPE_SERVICE_ASSESSMENT_METADATA_SCHEMA =
  "sitesourcery_service_assessment_checkout_v1";
const STRIPE_SERVICE_ASSESSMENT_PAYMENT_SCHEMA =
  "sitesourcery.stripe-service-assessment-payment-facts/v1";
const STRIPE_SERVICE_ASSESSMENT_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-service-assessment-checkout-lifecycle/v1";
export const STRIPE_CUSTOM_BUILD_START_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-start-checkout-purpose/v1";
const STRIPE_CUSTOM_BUILD_START_METADATA_SCHEMA =
  "sitesourcery_custom_build_start_checkout_v1";
const STRIPE_CUSTOM_BUILD_START_PAYMENT_SCHEMA =
  "sitesourcery.stripe-custom-build-start-payment-facts/v1";
const STRIPE_CUSTOM_BUILD_START_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-start-checkout-lifecycle/v1";
export const STRIPE_CUSTOM_BUILD_CHANGE_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-change-checkout-purpose/v1";
const STRIPE_CUSTOM_BUILD_CHANGE_METADATA_SCHEMA =
  "sitesourcery_custom_build_change_checkout_v1";
const STRIPE_CUSTOM_BUILD_CHANGE_PAYMENT_SCHEMA =
  "sitesourcery.stripe-custom-build-change-payment-facts/v1";
const STRIPE_CUSTOM_BUILD_CHANGE_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-change-checkout-lifecycle/v1";
export const STRIPE_CUSTOM_BUILD_FINAL_PURPOSE_SCHEMA =
  "sitesourcery.custom-build-final-checkout-purpose/v1";
export const STRIPE_CUSTOM_BUILD_FINAL_METADATA_SCHEMA =
  "sitesourcery_custom_build_final_checkout_v1";
export const STRIPE_CUSTOM_BUILD_FINAL_PAYMENT_SCHEMA =
  "sitesourcery.stripe-custom-build-final-payment-facts/v1";
export const STRIPE_CUSTOM_BUILD_FINAL_LIFECYCLE_SCHEMA =
  "sitesourcery.stripe-custom-build-final-checkout-lifecycle/v1";
export const STRIPE_ALAKAZAM_PURPOSE_SCHEMA =
  ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA;
export const STRIPE_ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA =
  ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA;
const STRIPE_ALAKAZAM_METADATA_SCHEMA =
  ALAKAZAM_PROVIDER_METADATA_SCHEMA;
const STRIPE_ALAKAZAM_CUSTOMER_METADATA_SCHEMA =
  "sitesourcery_alakazam_customer_v1";
const STRIPE_ALAKAZAM_CUSTOMER_SCHEMA =
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA;
const STRIPE_ALAKAZAM_SUBSCRIPTION_SCHEMA =
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA;
const STRIPE_ALAKAZAM_PAYMENT_SCHEMA =
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA;
const STRIPE_ALAKAZAM_SCHEDULE_SCHEMA =
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA;
const STRIPE_TAX_ATTESTATION_SCHEMA =
  "sitesourcery.stripe-tax-attestation/v1";
const STRIPE_TAX_PURPOSE_AUTHORITY_SCHEMA =
  "sitesourcery.stripe-tax-purpose-authority/v1";
const STRIPE_AUTOMATIC_TAX_ACTIVATION_SCHEMA =
  "sitesourcery.stripe-automatic-tax-activation/v1";
const STRIPE_TAX_CODE_FIELDS = Object.freeze([
  "alakazam",
  "customBuildChange",
  "customBuildFinal",
  "customBuildStart",
  "domainRegistration",
  "download",
  "serviceAssessment",
  "siteService"
]);
const STRIPE_TAX_PURPOSE_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const STRIPE_ALAKAZAM_REFUND_EVENTS = new Set([
  "charge.refunded",
  "refund.created",
  "refund.failed",
  "refund.updated"
]);
const STRIPE_ALAKAZAM_DISPUTE_EVENTS = new Set([
  "charge.dispute.closed",
  "charge.dispute.created",
  "charge.dispute.funds_reinstated",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.updated"
]);

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
          ? selectedKey.startsWith("sk_live_") ||
            selectedKey.startsWith("rk_live_")
          : selectedKey.startsWith("sk_test_") ||
            selectedKey.startsWith("rk_test_")
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

function serviceAssessmentReturnUrl(template, validated) {
  const parsed = new URL(template);
  invariant(
    !parsed.searchParams.has("assessment_project") &&
      !parsed.searchParams.has("assessment_invoice"),
    "stripe_redirect_invalid",
    "Assessment return URL already contains invoice identity",
    { status: 500 }
  );
  parsed.searchParams.set(
    "assessment_project",
    validated.identity.projectId
  );
  parsed.searchParams.set(
    "assessment_invoice",
    validated.identity.invoiceId
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Assessment success URL",
    { checkoutSessionPlaceholder: true }
  );
}

function customBuildStartReturnUrl(template, validated) {
  const parsed = new URL(template);
  invariant(
    !parsed.searchParams.has("custom_build_project") &&
      !parsed.searchParams.has("custom_build_invoice"),
    "stripe_redirect_invalid",
    "Custom-build return URL already contains invoice identity",
    { status: 500 }
  );
  parsed.searchParams.set(
    "custom_build_project",
    validated.identity.projectId
  );
  parsed.searchParams.set(
    "custom_build_invoice",
    validated.identity.invoiceId
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Custom-build success URL",
    { checkoutSessionPlaceholder: true }
  );
}

function customBuildChangeReturnUrl(template, validated) {
  const parsed = new URL(template);
  for (const field of [
    "custom_build_change_project",
    "custom_build_change_job",
    "custom_build_change_order",
    "custom_build_change_invoice"
  ]) {
    invariant(
      !parsed.searchParams.has(field),
      "stripe_redirect_invalid",
      "Custom-build change return URL already contains payment identity",
      { status: 500 }
    );
  }
  parsed.searchParams.set(
    "custom_build_change_project",
    validated.identity.projectId
  );
  parsed.searchParams.set(
    "custom_build_change_job",
    validated.identity.jobId
  );
  parsed.searchParams.set(
    "custom_build_change_order",
    validated.identity.changeOrderId
  );
  parsed.searchParams.set(
    "custom_build_change_invoice",
    validated.identity.invoiceId
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Custom-build change success URL",
    { checkoutSessionPlaceholder: true }
  );
}

function customBuildFinalReturnUrl(template, validated) {
  const parsed = new URL(template);
  for (const field of [
    "custom_build_final_project",
    "custom_build_final_job",
    "custom_build_final_obligation",
    "custom_build_final_invoice"
  ]) {
    invariant(
      !parsed.searchParams.has(field),
      "stripe_redirect_invalid",
      "Custom-build final return URL already contains payment identity",
      { status: 500 }
    );
  }
  parsed.searchParams.set(
    "custom_build_final_project",
    validated.identity.projectId
  );
  parsed.searchParams.set(
    "custom_build_final_job",
    validated.identity.jobId
  );
  parsed.searchParams.set(
    "custom_build_final_obligation",
    validated.identity.finalObligationId
  );
  parsed.searchParams.set(
    "custom_build_final_invoice",
    validated.identity.invoiceId
  );
  return exactUrl(
    parsed
      .toString()
      .replace(
        "%7BCHECKOUT_SESSION_ID%7D",
        "{CHECKOUT_SESSION_ID}"
      ),
    "Custom-build final success URL",
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
      typeof client.webhookEndpoints?.retrieve === "function" &&
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
  invariant(
    value.taxBehavior === "exclusive",
    "stripe_price_expectation_invalid",
    `Stripe Price expectation ${id} must be exclusive of tax`,
    { status: 500 }
  );
  return Object.freeze({
    id,
    active: true,
    currency,
    unitAmount,
    livemode,
    recurring,
    productId,
    taxBehavior: "exclusive"
  });
}

function normalizedTaxCodes(value, domainAuthorization) {
  invariant(
    exactObjectKeys(value, STRIPE_TAX_CODE_FIELDS),
    "stripe_tax_codes_required",
    "Stripe requires one exact tax code for every payment purpose",
    { status: 500 }
  );
  const selected = {};
  for (const field of STRIPE_TAX_CODE_FIELDS) {
    if (
      field === "domainRegistration" &&
      value[field] === null &&
      domainAuthorization === null
    ) {
      selected[field] = null;
      continue;
    }
    invariant(
      typeof value[field] === "string" &&
        TAX_CODE.test(value[field]),
      "stripe_tax_codes_required",
      `Stripe tax code ${field} is invalid`,
      { status: 500 }
    );
    selected[field] = value[field];
  }
  invariant(
    domainAuthorization === null ||
      selected.domainRegistration !== null,
    "stripe_domain_tax_code_required",
    "Stripe domain authorization requires an exact owner-approved tax code",
    { status: 500 }
  );
  return Object.freeze(selected);
}

function normalizedTaxPurposeAuthority(value, config) {
  invariant(
    exactObjectKeys(value, [
      "approved",
      "approvedAt",
      "authorityId",
      "automaticActivation",
      "defaultTaxBehavior",
      "livemode",
      "provider",
      "purposes",
      "schema"
    ]) &&
      exactObjectKeys(
        value?.purposes,
        STRIPE_TAX_CODE_FIELDS
      ),
    "stripe_tax_purpose_authority_required",
    "Stripe Tax requires one exact purpose-bound authority",
    { status: 500 }
  );
  const purposes = {};
  for (const field of STRIPE_TAX_CODE_FIELDS) {
    const mode = value.purposes[field];
    invariant(
      field === "domainRegistration" && mode === null
        ? config.domainAuthorization === null &&
            config.taxCodes.domainRegistration === null
        : STRIPE_TAX_PURPOSE_MODES.has(mode) &&
            config.taxCodes[field] !== null,
      "stripe_tax_purpose_authority_invalid",
      `Stripe Tax purpose ${field} is not exactly authorized`,
      { status: 500 }
    );
    purposes[field] = mode;
  }
  invariant(
    value.schema === STRIPE_TAX_PURPOSE_AUTHORITY_SCHEMA &&
      value.provider === "stripe" &&
      value.approved === true &&
      value.livemode === config.livemode &&
      value.defaultTaxBehavior === "exclusive" &&
      typeof value.authorityId === "string" &&
      SAFE_METADATA_VALUE.test(value.authorityId) &&
      Number.isFinite(Date.parse(value.approvedAt)) &&
      (config.domainAuthorization === null
        ? purposes.domainRegistration === null
        : STRIPE_TAX_PURPOSE_MODES.has(
            purposes.domainRegistration
          )),
    "stripe_tax_purpose_authority_invalid",
    "Stripe Tax purpose authority does not match the exact runtime",
    { status: 500 }
  );
  const automaticPurposes = STRIPE_TAX_CODE_FIELDS.filter(
    (field) => purposes[field] === "automatic"
  );
  let automaticActivation = null;
  if (automaticPurposes.length > 0) {
    const activation = value.automaticActivation;
    invariant(
      exactObjectKeys(activation, [
        "activationId",
        "approved",
        "approvedAt",
        "effectiveAt",
        "livemode",
        "provider",
        "purposes",
        "registrationIds",
        "schema"
      ]),
      "stripe_automatic_tax_activation_required",
      "Automatic Stripe Tax requires a separate exact activation authority",
      { status: 500 }
    );
    const activationPurposes = Array.isArray(
      activation.purposes
    )
      ? [...activation.purposes].sort()
      : [];
    const registrationIds = Array.isArray(
      activation.registrationIds
    )
      ? [...activation.registrationIds].sort()
      : [];
    invariant(
      activation.schema ===
        STRIPE_AUTOMATIC_TAX_ACTIVATION_SCHEMA &&
        activation.provider === "stripe" &&
        activation.approved === true &&
        activation.livemode === config.livemode &&
        typeof activation.activationId === "string" &&
        SAFE_METADATA_VALUE.test(activation.activationId) &&
        Number.isFinite(Date.parse(activation.approvedAt)) &&
        Number.isFinite(Date.parse(activation.effectiveAt)) &&
        Date.now() >= Date.parse(activation.effectiveAt) &&
        JSON.stringify(activationPurposes) ===
          JSON.stringify(automaticPurposes.sort()) &&
        registrationIds.length > 0 &&
        registrationIds.every(
          (id) =>
            typeof id === "string" &&
            TAX_REGISTRATION_ID.test(id)
        ) &&
        new Set(registrationIds).size ===
          registrationIds.length,
      "stripe_automatic_tax_activation_invalid",
      "Automatic Stripe Tax activation is not yet effective or does not match the exact purposes",
      { status: 500 }
    );
    automaticActivation = Object.freeze({
      ...structuredClone(activation),
      purposes: Object.freeze(activationPurposes),
      registrationIds: Object.freeze(registrationIds)
    });
  } else {
    invariant(
      value.automaticActivation === null,
      "stripe_automatic_tax_activation_unexpected",
      "Disabled Stripe Tax purposes cannot carry latent automatic activation authority",
      { status: 500 }
    );
  }
  return Object.freeze({
    ...structuredClone(value),
    purposes: Object.freeze(purposes),
    automaticActivation
  });
}

function normalizedTaxAttestation(value, config, taxAuthority) {
  invariant(
    exactObjectKeys(value, [
      "approved",
      "approvedAt",
      "attestationId",
      "defaultTaxBehavior",
      "headOfficeCountry",
      "livemode",
      "provider",
      "registrationDecision",
      "registrationIds",
      "schema",
      "taxMode"
    ]),
    "stripe_tax_attestation_required",
    "Stripe Tax requires one exact owner attestation",
    { status: 500 }
  );
  const registrationIds = Array.isArray(value.registrationIds)
    ? value.registrationIds
    : [];
  invariant(
    value.schema === STRIPE_TAX_ATTESTATION_SCHEMA &&
      value.provider === "stripe" &&
      value.approved === true &&
      value.livemode === config.livemode &&
      value.taxMode ===
        (taxAuthority.automaticActivation === null
          ? "disabled_by_owner"
          : "automatic") &&
      value.defaultTaxBehavior === "exclusive" &&
      typeof value.attestationId === "string" &&
      SAFE_METADATA_VALUE.test(value.attestationId) &&
      Number.isFinite(Date.parse(value.approvedAt)) &&
      typeof value.headOfficeCountry === "string" &&
      /^[A-Z]{2}$/u.test(value.headOfficeCountry) &&
      ["registered", "none_registered"].includes(
        value.registrationDecision
      ) &&
      registrationIds.every(
        (id) =>
          typeof id === "string" &&
          TAX_REGISTRATION_ID.test(id)
      ) &&
      new Set(registrationIds).size ===
        registrationIds.length &&
      (value.registrationDecision === "registered"
        ? registrationIds.length > 0
        : registrationIds.length === 0),
    "stripe_tax_attestation_invalid",
    "Stripe Tax attestation does not match the exact account decision",
    { status: 500 }
  );
  if (taxAuthority.automaticActivation !== null) {
    invariant(
      value.registrationDecision === "registered" &&
        JSON.stringify([...registrationIds].sort()) ===
          JSON.stringify(
            taxAuthority.automaticActivation.registrationIds
          ),
      "stripe_automatic_tax_registration_mismatch",
      "Automatic Stripe Tax activation must bind the exact attested registrations",
      { status: 500 }
    );
  }
  return Object.freeze({
    ...structuredClone(value),
    registrationIds: Object.freeze(
      [...registrationIds].sort()
    )
  });
}

function taxModeFor(config, field) {
  const mode = config.taxAuthority.purposes[field];
  invariant(
    STRIPE_TAX_PURPOSE_MODES.has(mode),
    "stripe_tax_purpose_held",
    `Stripe Tax purpose ${field} is held without exact authority`,
    { status: 503 }
  );
  return mode;
}

function automaticTaxFor(config, field) {
  return taxModeFor(config, field) === "automatic";
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
  const portalPrivacyPolicyUrl = exactUrl(
    config.portalPrivacyPolicyUrl,
    "portalPrivacyPolicyUrl"
  );
  const portalTermsOfServiceUrl = exactUrl(
    config.portalTermsOfServiceUrl,
    "portalTermsOfServiceUrl"
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
      [
        successUrl,
        cancelUrl,
        portalReturnUrl,
        portalPrivacyPolicyUrl,
        portalTermsOfServiceUrl
      ].every((url) =>
        approvedReturnOrigins.has(returnOrigin(url))
      ),
    "stripe_redirect_invalid",
    "Every Stripe return URL must use an exact approved origin",
    { status: 500 }
  );
  const webhookSecret = requiredText(
    config.webhookSecret,
    "webhookSecret",
    500
  );
  const webhookEndpointId = providerId(
    config.webhookEndpointId,
    "we",
    "webhookEndpointId"
  );
  const webhookEndpointUrl = exactUrl(
    config.webhookEndpointUrl,
    "webhookEndpointUrl"
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
  const taxCodes = normalizedTaxCodes(
    config.taxCodes,
    domainAuthorization
  );
  const taxAuthority = normalizedTaxPurposeAuthority(
    config.taxAuthority,
    {
      ...config,
      domainAuthorization,
      taxCodes
    }
  );
  const taxAttestation = normalizedTaxAttestation(
    config.taxAttestation,
    config,
    taxAuthority
  );
  return Object.freeze({
    apiVersion: STRIPE_API_VERSION,
    livemode: config.livemode,
    successUrl,
    cancelUrl,
    portalReturnUrl,
    portalPrivacyPolicyUrl,
    portalTermsOfServiceUrl,
    approvedReturnOrigins: Object.freeze(
      [...approvedReturnOrigins].sort()
    ),
    taxAuthority,
    taxCodes,
    taxAttestation,
    webhookSecret,
    webhookEndpointId,
    webhookEndpointUrl,
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
    price.tax_behavior === expected.taxBehavior &&
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
  return createAlakazamProviderMetadata({
    purpose: validated.purpose,
    purposeDigest: validated.purposeDigest
  });
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
        "taxMode",
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
      purpose.price.interval === null &&
      STRIPE_TAX_PURPOSE_MODES.has(purpose.taxMode),
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

function validateServiceAssessmentPurpose(
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
    exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "customerId",
        "invoiceDigest",
        "invoiceId",
        "invoiceNumber",
        "price",
        "projectId",
        "quoteId",
        "schema",
        "taxMode",
        "tenantId"
      ]),
    "stripe_service_assessment_checkout_invalid",
    "Assessment Checkout requires the exact server invoice purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "invoiceId",
    "invoiceNumber",
    "quoteId"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  invariant(
    purpose.schema ===
      STRIPE_SERVICE_ASSESSMENT_PURPOSE_SCHEMA &&
      /^SSA-[0-9A-F]{32}$/u.test(identity.invoiceNumber) &&
      exactObjectKeys(purpose.price, [
        "amountMinor",
        "billing",
        "currency",
        "taxBehavior"
      ]) &&
      purpose.price.amountMinor === 20000 &&
      purpose.price.currency === "USD" &&
      purpose.price.billing === "one_time" &&
      purpose.price.taxBehavior === "exclusive" &&
      STRIPE_TAX_PURPOSE_MODES.has(purpose.taxMode),
    "stripe_service_assessment_checkout_invalid",
    "Assessment Checkout permits only the reviewed one-time $200 invoice",
    { status: 500 }
  );
  const acceptedDisclosureDigest = safeMetadataValue(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  const invoiceDigest = safeMetadataValue(
    purpose.invoiceDigest,
    "purpose.invoiceDigest"
  );
  invariant(
    SHA256.test(acceptedDisclosureDigest) &&
      SHA256.test(invoiceDigest),
    "stripe_service_assessment_checkout_invalid",
    "Assessment Checkout invoice authority is invalid",
    { status: 500 }
  );
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_service_assessment_checkout_invalid",
    "Assessment Checkout purpose digest changed",
    { status: 500 }
  );
  return Object.freeze({
    purpose,
    identity,
    acceptedDisclosureDigest,
    invoiceDigest,
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

function serviceAssessmentMetadata(validated) {
  return Object.freeze({
    schema: STRIPE_SERVICE_ASSESSMENT_METADATA_SCHEMA,
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    invoice_id: validated.identity.invoiceId,
    invoice_number: validated.identity.invoiceNumber,
    quote_id: validated.identity.quoteId,
    accepted_disclosure_digest:
      validated.acceptedDisclosureDigest,
    invoice_digest: validated.invoiceDigest,
    purpose_digest: validated.purposeDigest
  });
}

function serviceAssessmentCheckoutResponse(
  value,
  config,
  expectedExpiresAt,
  validated,
  expectedMetadata
) {
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkout = checkoutResponse(
    value,
    config,
    expectedExpiresAt
  );
  const metadata = value?.metadata;
  invariant(
    value?.client_reference_id ===
      validated.identity.invoiceId &&
      value?.mode === "payment" &&
      value?.currency === "usd" &&
      value?.amount_subtotal === 20000 &&
      value?.automatic_tax?.enabled === automaticTax &&
      value?.status === "open" &&
      value?.payment_status === "unpaid" &&
      exactObjectKeys(
        metadata,
        Object.keys(expectedMetadata)
      ) &&
      Object.entries(expectedMetadata).every(
        ([key, expected]) => metadata[key] === expected
      ),
    "stripe_service_assessment_checkout_response_invalid",
    "Stripe assessment Checkout did not preserve the exact invoice purpose",
    { status: 502 }
  );
  return checkout;
}

function validateServiceAssessmentMetadata(
  value,
  expected,
  code,
  message
) {
  invariant(
    exactObjectKeys(value, Object.keys(expected)) &&
      Object.entries(expected).every(
        ([key, expectedValue]) =>
          value[key] === expectedValue
      ),
    code,
    message,
    { status: 502 }
  );
}

function serviceAssessmentProviderObject(
  value,
  prefix,
  field,
  code
) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
    code,
    `${field} was not expanded by Stripe`,
    { status: 502 }
  );
  providerId(value.id, prefix, `${field}.id`);
  return value;
}

function serviceAssessmentProviderMinor(
  value,
  field,
  code
) {
  invariant(
    Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 99_999_999,
    code,
    `${field} is invalid`,
    { status: 502 }
  );
  return value;
}

function serviceAssessmentProviderTime(
  value,
  field,
  code
) {
  invariant(
    Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 8_640_000_000_000,
    code,
    `${field} is invalid`,
    { status: 502 }
  );
  return new Date(value * 1000).toISOString();
}

function serviceAssessmentPaymentFacts(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_service_assessment_payment_mismatch";
  const taxMode = validated.purpose.taxMode;
  const automaticTax = taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe assessment Checkout Session ID"
  );
  const expectedMetadata =
    serviceAssessmentMetadata(validated);
  validateServiceAssessmentMetadata(
    value?.metadata,
    expectedMetadata,
    code,
    "Stripe assessment payment metadata changed"
  );
  const taxMinor = serviceAssessmentProviderMinor(
    value?.total_details?.amount_tax,
    "Stripe assessment tax amount",
    code
  );
  const subtotalMinor = 20000;
  const totalMinor = subtotalMinor + taxMinor;
  const customerId = providerReferenceId(
    value?.customer,
    "cus",
    "Stripe assessment Checkout Customer ID"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal === subtotalMinor &&
      value.amount_total === totalMinor &&
      value.automatic_tax?.enabled === automaticTax &&
      (automaticTax
        ? value.automatic_tax?.status === "complete"
        : (value.automatic_tax?.status === null ||
            value.automatic_tax?.status === undefined) &&
          taxMinor === 0) &&
      value.total_details?.amount_discount === 0 &&
      value.total_details?.amount_shipping === 0 &&
      value.status === "complete" &&
      value.payment_status === "paid",
    code,
    "Stripe did not confirm the exact paid $200 assessment Checkout",
    { status: 502 }
  );
  const intent = serviceAssessmentProviderObject(
    value.payment_intent,
    "pi",
    "Stripe assessment PaymentIntent",
    code
  );
  validateServiceAssessmentMetadata(
    intent.metadata,
    expectedMetadata,
    code,
    "Stripe assessment PaymentIntent metadata changed"
  );
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === totalMinor &&
      intent.amount_received === totalMinor &&
      intent.amount_capturable === 0 &&
      providerReferenceId(
        intent.customer,
        "cus",
        "Stripe assessment PaymentIntent Customer ID"
      ) === customerId,
    code,
    "Stripe did not confirm the exact succeeded assessment PaymentIntent",
    { status: 502 }
  );
  const charge = serviceAssessmentProviderObject(
    intent.latest_charge,
    "ch",
    "Stripe assessment Charge",
    code
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
      charge.amount_refunded === 0 &&
      providerReferenceId(
        charge.customer,
        "cus",
        "Stripe assessment Charge Customer ID"
      ) === customerId &&
      providerReferenceId(
        charge.payment_intent,
        "pi",
        "Stripe assessment Charge PaymentIntent ID"
      ) === intent.id,
    code,
    "Stripe did not confirm the exact captured assessment Charge",
    { status: 502 }
  );
  const facts = {
    schema: STRIPE_SERVICE_ASSESSMENT_PAYMENT_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    paymentIntentId: intent.id,
    customerId,
    paymentStatus: "paid",
    subtotalMinor,
    taxMinor,
    totalMinor,
    taxMode,
    currency: "USD",
    purposeDigest: validated.purposeDigest,
    providerPaymentTime:
      serviceAssessmentProviderTime(
        charge.created,
        "Stripe assessment payment time",
        code
      )
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function serviceAssessmentCheckoutLifecycle(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_service_assessment_checkout_lifecycle_invalid";
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe assessment Checkout Session ID"
  );
  validateServiceAssessmentMetadata(
    value?.metadata,
    serviceAssessmentMetadata(validated),
    code,
    "Stripe assessment Checkout lifecycle metadata changed"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal === 20000 &&
      value.automatic_tax?.enabled === automaticTax,
    code,
    "Stripe did not return the exact assessment Checkout lifecycle",
    { status: 502 }
  );
  let state;
  if (
    value.status === "open" &&
    value.payment_status === "unpaid"
  ) {
    state = "open";
  } else if (
    value.status === "expired" &&
    value.payment_status === "unpaid"
  ) {
    state = "expired";
  } else if (
    value.status === "complete" &&
    value.payment_status === "paid" &&
    (automaticTax
      ? value.automatic_tax?.status === "complete"
      : (value.automatic_tax?.status === null ||
          value.automatic_tax?.status === undefined) &&
        value.total_details?.amount_tax === 0)
  ) {
    state = "paid";
  } else {
    invariant(
      false,
      code,
      "Stripe returned an unsafe assessment Checkout lifecycle",
      { status: 502 }
    );
  }
  return Object.freeze({
    schema:
      STRIPE_SERVICE_ASSESSMENT_LIFECYCLE_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    purposeDigest: validated.purposeDigest,
    state
  });
}

function validateCustomBuildStartPurpose(
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
    exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "acceptedQuoteDigest",
        "creditApplicationId",
        "customerId",
        "invoiceDigest",
        "invoiceId",
        "invoiceNumber",
        "price",
        "projectId",
        "quoteAcceptanceId",
        "quoteId",
        "quoteRevisionId",
        "schema",
        "taxMode",
        "tenantId"
      ]),
    "stripe_custom_build_start_checkout_invalid",
    "Custom-build Checkout requires the exact accepted quote and invoice purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "quoteId",
    "quoteRevisionId",
    "quoteAcceptanceId",
    "creditApplicationId",
    "invoiceId",
    "invoiceNumber"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  invariant(
    purpose.schema ===
      STRIPE_CUSTOM_BUILD_START_PURPOSE_SCHEMA &&
      [
        identity.quoteId,
        identity.quoteRevisionId,
        identity.quoteAcceptanceId,
        identity.creditApplicationId,
        identity.invoiceId
      ].every((value) => UUID.test(value)) &&
      /^SSCB-[0-9A-F]{32}$/u.test(
        identity.invoiceNumber
      ) &&
      exactObjectKeys(purpose.price, [
        "amountMinor",
        "billing",
        "currency",
        "taxBehavior"
      ]) &&
      Number.isSafeInteger(purpose.price.amountMinor) &&
      purpose.price.amountMinor > 0 &&
      purpose.price.amountMinor <= 99_999_999 &&
      purpose.price.currency === "USD" &&
      purpose.price.billing === "one_time" &&
      purpose.price.taxBehavior === "exclusive" &&
      STRIPE_TAX_PURPOSE_MODES.has(purpose.taxMode),
    "stripe_custom_build_start_checkout_invalid",
    "Custom-build Checkout permits only the exact positive first-installment invoice",
    { status: 500 }
  );
  const acceptedQuoteDigest = safeMetadataValue(
    purpose.acceptedQuoteDigest,
    "purpose.acceptedQuoteDigest"
  );
  const acceptedDisclosureDigest = safeMetadataValue(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  const invoiceDigest = safeMetadataValue(
    purpose.invoiceDigest,
    "purpose.invoiceDigest"
  );
  invariant(
    [
      acceptedQuoteDigest,
      acceptedDisclosureDigest,
      invoiceDigest
    ].every((value) => SHA256.test(value)),
    "stripe_custom_build_start_checkout_invalid",
    "Custom-build Checkout quote and invoice authority is invalid",
    { status: 500 }
  );
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_custom_build_start_checkout_invalid",
    "Custom-build Checkout purpose digest changed",
    { status: 500 }
  );
  return Object.freeze({
    purpose,
    identity,
    acceptedQuoteDigest,
    acceptedDisclosureDigest,
    invoiceDigest,
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

function customBuildStartMetadata(validated) {
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_START_METADATA_SCHEMA,
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    quote_id: validated.identity.quoteId,
    quote_revision_id:
      validated.identity.quoteRevisionId,
    quote_acceptance_id:
      validated.identity.quoteAcceptanceId,
    credit_application_id:
      validated.identity.creditApplicationId,
    invoice_id: validated.identity.invoiceId,
    invoice_number: validated.identity.invoiceNumber,
    accepted_quote_digest:
      validated.acceptedQuoteDigest,
    accepted_disclosure_digest:
      validated.acceptedDisclosureDigest,
    invoice_digest: validated.invoiceDigest,
    purpose_digest: validated.purposeDigest
  });
}

function customBuildStartCheckoutResponse(
  value,
  config,
  expectedExpiresAt,
  validated,
  expectedMetadata
) {
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkout = checkoutResponse(
    value,
    config,
    expectedExpiresAt
  );
  const metadata = value?.metadata;
  invariant(
    value?.client_reference_id ===
      validated.identity.invoiceId &&
      value?.mode === "payment" &&
      value?.currency === "usd" &&
      value?.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value?.automatic_tax?.enabled === automaticTax &&
      value?.status === "open" &&
      value?.payment_status === "unpaid" &&
      exactObjectKeys(
        metadata,
        Object.keys(expectedMetadata)
      ) &&
      Object.entries(expectedMetadata).every(
        ([key, expected]) => metadata[key] === expected
      ),
    "stripe_custom_build_start_checkout_response_invalid",
    "Stripe Custom-build Checkout did not preserve the exact invoice purpose",
    { status: 502 }
  );
  return checkout;
}

function customBuildStartPaymentFacts(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_start_payment_mismatch";
  const taxMode = validated.purpose.taxMode;
  const automaticTax = taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build Checkout Session ID"
  );
  const expectedMetadata =
    customBuildStartMetadata(validated);
  validateServiceAssessmentMetadata(
    value?.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build payment metadata changed"
  );
  const taxMinor = serviceAssessmentProviderMinor(
    value?.total_details?.amount_tax,
    "Stripe Custom-build tax amount",
    code
  );
  const subtotalMinor =
    validated.purpose.price.amountMinor;
  const totalMinor = subtotalMinor + taxMinor;
  const customerId = providerReferenceId(
    value?.customer,
    "cus",
    "Stripe Custom-build Checkout Customer ID"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal === subtotalMinor &&
      value.amount_total === totalMinor &&
      value.automatic_tax?.enabled === automaticTax &&
      (automaticTax
        ? value.automatic_tax?.status === "complete"
        : (value.automatic_tax?.status === null ||
            value.automatic_tax?.status === undefined) &&
          taxMinor === 0) &&
      value.total_details?.amount_discount === 0 &&
      value.total_details?.amount_shipping === 0 &&
      value.status === "complete" &&
      value.payment_status === "paid",
    code,
    "Stripe did not confirm the exact paid Custom-build first-installment Checkout",
    { status: 502 }
  );
  const intent = serviceAssessmentProviderObject(
    value.payment_intent,
    "pi",
    "Stripe Custom-build PaymentIntent",
    code
  );
  validateServiceAssessmentMetadata(
    intent.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build PaymentIntent metadata changed"
  );
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === totalMinor &&
      intent.amount_received === totalMinor &&
      intent.amount_capturable === 0 &&
      providerReferenceId(
        intent.customer,
        "cus",
        "Stripe Custom-build PaymentIntent Customer ID"
      ) === customerId,
    code,
    "Stripe did not confirm the exact succeeded Custom-build PaymentIntent",
    { status: 502 }
  );
  const charge = serviceAssessmentProviderObject(
    intent.latest_charge,
    "ch",
    "Stripe Custom-build Charge",
    code
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
      charge.amount_refunded === 0 &&
      providerReferenceId(
        charge.customer,
        "cus",
        "Stripe Custom-build Charge Customer ID"
      ) === customerId &&
      providerReferenceId(
        charge.payment_intent,
        "pi",
        "Stripe Custom-build Charge PaymentIntent ID"
      ) === intent.id,
    code,
    "Stripe did not confirm the exact captured Custom-build Charge",
    { status: 502 }
  );
  const facts = {
    schema: STRIPE_CUSTOM_BUILD_START_PAYMENT_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    paymentIntentId: intent.id,
    customerId,
    paymentStatus: "paid",
    subtotalMinor,
    taxMinor,
    totalMinor,
    taxMode,
    currency: "USD",
    purposeDigest: validated.purposeDigest,
    providerPaymentTime:
      serviceAssessmentProviderTime(
        charge.created,
        "Stripe Custom-build payment time",
        code
      )
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function customBuildStartCheckoutLifecycle(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_start_checkout_lifecycle_invalid";
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build Checkout Session ID"
  );
  validateServiceAssessmentMetadata(
    value?.metadata,
    customBuildStartMetadata(validated),
    code,
    "Stripe Custom-build Checkout lifecycle metadata changed"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value.automatic_tax?.enabled === automaticTax,
    code,
    "Stripe did not return the exact Custom-build Checkout lifecycle",
    { status: 502 }
  );
  let state;
  if (
    value.status === "open" &&
    value.payment_status === "unpaid"
  ) {
    state = "open";
  } else if (
    value.status === "expired" &&
    value.payment_status === "unpaid"
  ) {
    state = "expired";
  } else if (
    value.status === "complete" &&
    value.payment_status === "paid" &&
    (automaticTax
      ? value.automatic_tax?.status === "complete"
      : (value.automatic_tax?.status === null ||
          value.automatic_tax?.status === undefined) &&
        value.total_details?.amount_tax === 0)
  ) {
    state = "paid";
  } else {
    invariant(
      false,
      code,
      "Stripe returned an unsafe Custom-build Checkout lifecycle",
      { status: 502 }
    );
  }
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_START_LIFECYCLE_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    purposeDigest: validated.purposeDigest,
    state
  });
}

function validateCustomBuildChangePurpose(
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
        "checkoutExpiresAt",
        "idempotencyKey",
        "purpose",
        "purposeDigest",
        ...(request?.stripeCustomerId === undefined
          ? []
          : ["stripeCustomerId"])
      ];
  invariant(
    exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "acceptedQuoteDigest",
        "changeAcceptanceId",
        "changeNumber",
        "changeOrderId",
        "customerId",
        "invoiceDigest",
        "invoiceId",
        "invoiceNumber",
        "jobId",
        "price",
        "priorEffectiveScopeDigest",
        "projectId",
        "schema",
        "scopeBoundaryDigest",
        "targetCompletionDate",
        "taxMode",
        "tenantId"
      ]),
    "stripe_custom_build_change_checkout_invalid",
    "Custom-build change Checkout requires the exact accepted change and invoice purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "jobId",
    "changeOrderId",
    "changeAcceptanceId",
    "invoiceId",
    "invoiceNumber"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  const targetCompletionDate = safeMetadataValue(
    purpose.targetCompletionDate,
    "purpose.targetCompletionDate"
  );
  const parsedTargetCompletionDate = new Date(
    `${targetCompletionDate}T00:00:00.000Z`
  );
  invariant(
    purpose.schema ===
      STRIPE_CUSTOM_BUILD_CHANGE_PURPOSE_SCHEMA &&
      [
        identity.tenantId,
        identity.customerId,
        identity.projectId,
        identity.jobId,
        identity.changeOrderId,
        identity.changeAcceptanceId,
        identity.invoiceId
      ].every((value) => UUID.test(value)) &&
      /^SSCB-CHG-[0-9A-F]{32}$/u.test(
        identity.invoiceNumber
      ) &&
      /^\d{4}-\d{2}-\d{2}$/u.test(
        targetCompletionDate
      ) &&
      !Number.isNaN(parsedTargetCompletionDate.getTime()) &&
      parsedTargetCompletionDate
        .toISOString()
        .slice(0, 10) === targetCompletionDate &&
      exactObjectKeys(purpose.price, [
        "amountMinor",
        "billing",
        "currency",
        "quantity",
        "taxBehavior",
        "unitAmountMinor"
      ]) &&
      Number.isSafeInteger(purpose.price.amountMinor) &&
      purpose.price.amountMinor > 0 &&
      purpose.price.amountMinor <= 99_999_999 &&
      purpose.price.unitAmountMinor === 12_500 &&
      Number.isSafeInteger(purpose.price.quantity) &&
      purpose.price.quantity >= 1 &&
      purpose.price.quantity <= 40 &&
      purpose.price.amountMinor ===
        purpose.price.unitAmountMinor *
          purpose.price.quantity &&
      purpose.price.currency === "USD" &&
      purpose.price.billing === "one_time" &&
      purpose.price.taxBehavior === "exclusive" &&
      STRIPE_TAX_PURPOSE_MODES.has(purpose.taxMode) &&
      Number.isSafeInteger(purpose.changeNumber) &&
      purpose.changeNumber > 0 &&
      purpose.changeNumber <= 100000,
    "stripe_custom_build_change_checkout_invalid",
    "Custom-build change Checkout permits only the exact positive accepted-change invoice",
    { status: 500 }
  );
  const acceptedQuoteDigest = safeMetadataValue(
    purpose.acceptedQuoteDigest,
    "purpose.acceptedQuoteDigest"
  );
  const acceptedDisclosureDigest = safeMetadataValue(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  const priorEffectiveScopeDigest = safeMetadataValue(
    purpose.priorEffectiveScopeDigest,
    "purpose.priorEffectiveScopeDigest"
  );
  const scopeBoundaryDigest = safeMetadataValue(
    purpose.scopeBoundaryDigest,
    "purpose.scopeBoundaryDigest"
  );
  const invoiceDigest = safeMetadataValue(
    purpose.invoiceDigest,
    "purpose.invoiceDigest"
  );
  invariant(
    [
      acceptedQuoteDigest,
      acceptedDisclosureDigest,
      scopeBoundaryDigest,
      priorEffectiveScopeDigest,
      invoiceDigest
    ].every((value) => SHA256.test(value)),
    "stripe_custom_build_change_checkout_invalid",
    "Custom-build change Checkout authority is invalid",
    { status: 500 }
  );
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_custom_build_change_checkout_invalid",
    "Custom-build change Checkout purpose digest changed",
    { status: 500 }
  );
  let checkoutExpiresAt = null;
  let checkoutExpiresAtSeconds = null;
  if (!retrieval) {
    checkoutExpiresAt = requiredText(
      request.checkoutExpiresAt,
      "checkoutExpiresAt",
      40
    );
    const checkoutExpiresAtMilliseconds = Date.parse(
      checkoutExpiresAt
    );
    invariant(
      Number.isFinite(checkoutExpiresAtMilliseconds) &&
        new Date(
          checkoutExpiresAtMilliseconds
        ).toISOString() === checkoutExpiresAt &&
        checkoutExpiresAtMilliseconds % 1000 === 0,
      "stripe_custom_build_change_checkout_invalid",
      "Custom-build change Checkout expiration must be an exact provider-second ISO timestamp",
      { status: 500 }
    );
    checkoutExpiresAtSeconds =
      checkoutExpiresAtMilliseconds / 1000;
    invariant(
      Number.isSafeInteger(checkoutExpiresAtSeconds) &&
        checkoutExpiresAtSeconds > 0,
      "stripe_custom_build_change_checkout_invalid",
      "Custom-build change Checkout expiration is invalid",
      { status: 500 }
    );
  }
  return Object.freeze({
    purpose,
    identity,
    acceptedQuoteDigest,
    acceptedDisclosureDigest,
    scopeBoundaryDigest,
    priorEffectiveScopeDigest,
    invoiceDigest,
    targetCompletionDate,
    purposeDigest,
    checkoutExpiresAt,
    checkoutExpiresAtSeconds,
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

function customBuildChangeMetadata(validated) {
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_CHANGE_METADATA_SCHEMA,
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    job_id: validated.identity.jobId,
    change_order_id: validated.identity.changeOrderId,
    change_acceptance_id:
      validated.identity.changeAcceptanceId,
    change_number: String(validated.purpose.changeNumber),
    invoice_id: validated.identity.invoiceId,
    invoice_number: validated.identity.invoiceNumber,
    accepted_quote_digest:
      validated.acceptedQuoteDigest,
    accepted_disclosure_digest:
      validated.acceptedDisclosureDigest,
    scope_boundary_digest:
      validated.scopeBoundaryDigest,
    prior_effective_scope_digest:
      validated.priorEffectiveScopeDigest,
    target_completion_date:
      validated.targetCompletionDate,
    invoice_digest: validated.invoiceDigest,
    purpose_digest: validated.purposeDigest
  });
}

function customBuildChangeCheckoutResponse(
  value,
  config,
  expectedExpiresAt,
  validated,
  expectedMetadata
) {
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkout = checkoutResponse(
    value,
    config,
    expectedExpiresAt
  );
  const metadata = value?.metadata;
  const observedCustomerId =
    value?.customer === null ||
    value?.customer === undefined
      ? null
      : providerReferenceId(
          value.customer,
          "cus",
          "Stripe Custom-build change Checkout Customer ID"
        );
  invariant(
    value?.client_reference_id ===
      validated.identity.invoiceId &&
      value?.mode === "payment" &&
      value?.currency === "usd" &&
      value?.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value?.automatic_tax?.enabled === automaticTax &&
      value?.status === "open" &&
      value?.payment_status === "unpaid" &&
      (
        validated.stripeCustomerId === null ||
        observedCustomerId === validated.stripeCustomerId
      ) &&
      exactObjectKeys(
        metadata,
        Object.keys(expectedMetadata)
      ) &&
      Object.entries(expectedMetadata).every(
        ([key, expected]) => metadata[key] === expected
      ),
    "stripe_custom_build_change_checkout_response_invalid",
    "Stripe Custom-build change Checkout did not preserve the exact invoice purpose",
    { status: 502 }
  );
  return checkout;
}

function customBuildChangePaymentFacts(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_change_payment_mismatch";
  const taxMode = validated.purpose.taxMode;
  const automaticTax = taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build change Checkout Session ID"
  );
  const expectedMetadata =
    customBuildChangeMetadata(validated);
  validateServiceAssessmentMetadata(
    value?.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build change payment metadata changed"
  );
  const taxMinor = serviceAssessmentProviderMinor(
    value?.total_details?.amount_tax,
    "Stripe Custom-build change tax amount",
    code
  );
  const subtotalMinor =
    validated.purpose.price.amountMinor;
  const totalMinor = subtotalMinor + taxMinor;
  const customerId = providerReferenceId(
    value?.customer,
    "cus",
    "Stripe Custom-build change Checkout Customer ID"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal === subtotalMinor &&
      value.amount_total === totalMinor &&
      value.automatic_tax?.enabled === automaticTax &&
      (automaticTax
        ? value.automatic_tax?.status === "complete"
        : (value.automatic_tax?.status === null ||
            value.automatic_tax?.status === undefined) &&
          taxMinor === 0) &&
      value.total_details?.amount_discount === 0 &&
      value.total_details?.amount_shipping === 0 &&
      value.status === "complete" &&
      value.payment_status === "paid",
    code,
    "Stripe did not confirm the exact paid Custom-build change Checkout",
    { status: 502 }
  );
  const intent = serviceAssessmentProviderObject(
    value.payment_intent,
    "pi",
    "Stripe Custom-build change PaymentIntent",
    code
  );
  validateServiceAssessmentMetadata(
    intent.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build change PaymentIntent metadata changed"
  );
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === totalMinor &&
      intent.amount_received === totalMinor &&
      intent.amount_capturable === 0 &&
      providerReferenceId(
        intent.customer,
        "cus",
        "Stripe Custom-build change PaymentIntent Customer ID"
      ) === customerId,
    code,
    "Stripe did not confirm the exact succeeded Custom-build change PaymentIntent",
    { status: 502 }
  );
  const charge = serviceAssessmentProviderObject(
    intent.latest_charge,
    "ch",
    "Stripe Custom-build change Charge",
    code
  );
  validateServiceAssessmentMetadata(
    charge.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build change Charge metadata changed"
  );
  invariant(
    charge.livemode === config.livemode &&
      charge.status === "succeeded" &&
      charge.paid === true &&
      charge.captured === true &&
      charge.refunded === false &&
      charge.disputed === false &&
      charge.failure_code === null &&
      charge.failure_message === null &&
      charge.currency === "usd" &&
      charge.amount === totalMinor &&
      charge.amount_captured === totalMinor &&
      charge.amount_refunded === 0 &&
      providerReferenceId(
        charge.customer,
        "cus",
        "Stripe Custom-build change Charge Customer ID"
      ) === customerId &&
      providerReferenceId(
        charge.payment_intent,
        "pi",
        "Stripe Custom-build change Charge PaymentIntent ID"
      ) === intent.id,
    code,
    "Stripe did not confirm one uncontested captured Custom-build change Charge",
    { status: 502 }
  );
  const facts = {
    schema: STRIPE_CUSTOM_BUILD_CHANGE_PAYMENT_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    paymentIntentId: intent.id,
    customerId,
    paymentStatus: "paid",
    subtotalMinor,
    taxMinor,
    totalMinor,
    taxMode,
    currency: "USD",
    purposeDigest: validated.purposeDigest,
    providerPaymentTime:
      serviceAssessmentProviderTime(
        charge.created,
        "Stripe Custom-build change payment time",
        code
      )
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function customBuildChangeCheckoutLifecycle(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_change_checkout_lifecycle_invalid";
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build change Checkout Session ID"
  );
  validateServiceAssessmentMetadata(
    value?.metadata,
    customBuildChangeMetadata(validated),
    code,
    "Stripe Custom-build change Checkout lifecycle metadata changed"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value.automatic_tax?.enabled === automaticTax,
    code,
    "Stripe did not return the exact Custom-build change Checkout lifecycle",
    { status: 502 }
  );
  let state;
  if (
    value.status === "open" &&
    value.payment_status === "unpaid"
  ) {
    state = "open";
  } else if (
    value.status === "expired" &&
    value.payment_status === "unpaid"
  ) {
    state = "expired";
  } else if (
    value.status === "complete" &&
    value.payment_status === "paid" &&
    (automaticTax
      ? value.automatic_tax?.status === "complete"
      : (value.automatic_tax?.status === null ||
          value.automatic_tax?.status === undefined) &&
        value.total_details?.amount_tax === 0)
  ) {
    const taxMinor = serviceAssessmentProviderMinor(
      value?.total_details?.amount_tax,
      "Stripe Custom-build change lifecycle tax amount",
      code
    );
    invariant(
      value.amount_total ===
        validated.purpose.price.amountMinor + taxMinor &&
        value.total_details?.amount_discount === 0 &&
        value.total_details?.amount_shipping === 0,
      code,
      "Stripe returned unsafe paid Custom-build change totals",
      { status: 502 }
    );
    state = "paid";
  } else {
    invariant(
      false,
      code,
      "Stripe returned an unsafe Custom-build change Checkout lifecycle",
      { status: 502 }
    );
  }
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_CHANGE_LIFECYCLE_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    purposeDigest: validated.purposeDigest,
    state
  });
}

function validateCustomBuildFinalPurpose(
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
        "checkoutExpiresAt",
        "idempotencyKey",
        "purpose",
        "purposeDigest",
        ...(request?.stripeCustomerId === undefined
          ? []
          : ["stripeCustomerId"])
      ];
  invariant(
    exactObjectKeys(request, requestFields) &&
      exactObjectKeys(request.purpose, [
        "acceptedDisclosureDigest",
        "acceptedQuoteDigest",
        "baseScopeDigest",
        "commercialContractDigest",
        "completionPackageDigest",
        "completionPackageId",
        "customerId",
        "effectiveChangeOrderDigests",
        "effectiveScopeDigest",
        "finalObligationDigest",
        "finalObligationId",
        "installmentNumber",
        "invoiceDigest",
        "invoiceId",
        "invoiceNumber",
        "jobId",
        "price",
        "projectId",
        "quoteAcceptanceId",
        "quoteId",
        "quoteRevisionId",
        "schema",
        "taxMode",
        "tenantId",
        "workmanshipCorrectionDays"
      ]),
    "stripe_custom_build_final_checkout_invalid",
    "Custom-build final Checkout requires the exact completion-bound obligation and invoice purpose",
    { status: 500 }
  );
  const purpose = request.purpose;
  const identity = {};
  for (const field of [
    "tenantId",
    "customerId",
    "projectId",
    "jobId",
    "quoteId",
    "quoteRevisionId",
    "quoteAcceptanceId",
    "completionPackageId",
    "finalObligationId",
    "invoiceId",
    "invoiceNumber"
  ]) {
    identity[field] = safeMetadataValue(
      purpose[field],
      `purpose.${field}`
    );
  }
  const effectiveChangeOrderDigests =
    purpose.effectiveChangeOrderDigests;
  invariant(
    purpose.schema ===
      STRIPE_CUSTOM_BUILD_FINAL_PURPOSE_SCHEMA &&
      [
        identity.tenantId,
        identity.customerId,
        identity.projectId,
        identity.jobId,
        identity.quoteId,
        identity.quoteRevisionId,
        identity.quoteAcceptanceId,
        identity.completionPackageId,
        identity.finalObligationId,
        identity.invoiceId
      ].every((value) => UUID.test(value)) &&
      /^SSCB-FINAL-[0-9A-F]{32}$/u.test(
        identity.invoiceNumber
      ) &&
      purpose.installmentNumber === 2 &&
      purpose.workmanshipCorrectionDays === 30 &&
      Array.isArray(effectiveChangeOrderDigests) &&
      effectiveChangeOrderDigests.length <= 1000 &&
      effectiveChangeOrderDigests.every(
        (value) => typeof value === "string" && SHA256.test(value)
      ) &&
      new Set(effectiveChangeOrderDigests).size ===
        effectiveChangeOrderDigests.length &&
      exactObjectKeys(purpose.price, [
        "amountMinor",
        "billing",
        "currency",
        "taxBehavior"
      ]) &&
      Number.isSafeInteger(purpose.price.amountMinor) &&
      purpose.price.amountMinor > 0 &&
      purpose.price.amountMinor <= 99_999_999 &&
      purpose.price.currency === "USD" &&
      purpose.price.billing === "one_time" &&
      purpose.price.taxBehavior === "exclusive" &&
      STRIPE_TAX_PURPOSE_MODES.has(purpose.taxMode),
    "stripe_custom_build_final_checkout_invalid",
    "Custom-build final Checkout permits only one exact positive second installment",
    { status: 500 }
  );
  const acceptedQuoteDigest = safeMetadataValue(
    purpose.acceptedQuoteDigest,
    "purpose.acceptedQuoteDigest"
  );
  const acceptedDisclosureDigest = safeMetadataValue(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  const commercialContractDigest = safeMetadataValue(
    purpose.commercialContractDigest,
    "purpose.commercialContractDigest"
  );
  const baseScopeDigest = safeMetadataValue(
    purpose.baseScopeDigest,
    "purpose.baseScopeDigest"
  );
  const effectiveScopeDigest = safeMetadataValue(
    purpose.effectiveScopeDigest,
    "purpose.effectiveScopeDigest"
  );
  const completionPackageDigest = safeMetadataValue(
    purpose.completionPackageDigest,
    "purpose.completionPackageDigest"
  );
  const finalObligationDigest = safeMetadataValue(
    purpose.finalObligationDigest,
    "purpose.finalObligationDigest"
  );
  const invoiceDigest = safeMetadataValue(
    purpose.invoiceDigest,
    "purpose.invoiceDigest"
  );
  invariant(
    [
      acceptedQuoteDigest,
      acceptedDisclosureDigest,
      commercialContractDigest,
      baseScopeDigest,
      effectiveScopeDigest,
      completionPackageDigest,
      finalObligationDigest,
      invoiceDigest
    ].every((value) => SHA256.test(value)),
    "stripe_custom_build_final_checkout_invalid",
    "Custom-build final Checkout obligation and invoice authority is invalid",
    { status: 500 }
  );
  const effectiveChangeOrderDigestsDigest = digest(
    effectiveChangeOrderDigests
  );
  const purposeDigest = digest(purpose);
  invariant(
    request.purposeDigest === purposeDigest &&
      SHA256.test(request.purposeDigest),
    "stripe_custom_build_final_checkout_invalid",
    "Custom-build final Checkout purpose digest changed",
    { status: 500 }
  );
  let checkoutExpiresAt = null;
  let checkoutExpiresAtSeconds = null;
  if (!retrieval) {
    checkoutExpiresAt = requiredText(
      request.checkoutExpiresAt,
      "checkoutExpiresAt",
      40
    );
    const checkoutExpiresAtMilliseconds = Date.parse(
      checkoutExpiresAt
    );
    invariant(
      Number.isFinite(checkoutExpiresAtMilliseconds) &&
        new Date(
          checkoutExpiresAtMilliseconds
        ).toISOString() === checkoutExpiresAt &&
        checkoutExpiresAtMilliseconds % 1000 === 0,
      "stripe_custom_build_final_checkout_invalid",
      "Custom-build final Checkout expiration must be an exact provider-second ISO timestamp",
      { status: 500 }
    );
    checkoutExpiresAtSeconds =
      checkoutExpiresAtMilliseconds / 1000;
    invariant(
      Number.isSafeInteger(checkoutExpiresAtSeconds) &&
        checkoutExpiresAtSeconds > 0,
      "stripe_custom_build_final_checkout_invalid",
      "Custom-build final Checkout expiration is invalid",
      { status: 500 }
    );
  }
  return Object.freeze({
    purpose,
    identity,
    acceptedQuoteDigest,
    acceptedDisclosureDigest,
    commercialContractDigest,
    baseScopeDigest,
    effectiveChangeOrderDigestsDigest,
    effectiveScopeDigest,
    completionPackageDigest,
    finalObligationDigest,
    invoiceDigest,
    purposeDigest,
    checkoutExpiresAt,
    checkoutExpiresAtSeconds,
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

function customBuildFinalMetadata(validated) {
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_FINAL_METADATA_SCHEMA,
    tenant_id: validated.identity.tenantId,
    customer_id: validated.identity.customerId,
    project_id: validated.identity.projectId,
    job_id: validated.identity.jobId,
    quote_id: validated.identity.quoteId,
    quote_revision_id: validated.identity.quoteRevisionId,
    quote_acceptance_id:
      validated.identity.quoteAcceptanceId,
    completion_package_id:
      validated.identity.completionPackageId,
    final_obligation_id:
      validated.identity.finalObligationId,
    invoice_id: validated.identity.invoiceId,
    invoice_number: validated.identity.invoiceNumber,
    installment_number: "2",
    workmanship_correction_days: "30",
    accepted_quote_digest:
      validated.acceptedQuoteDigest,
    accepted_disclosure_digest:
      validated.acceptedDisclosureDigest,
    commercial_contract_digest:
      validated.commercialContractDigest,
    base_scope_digest: validated.baseScopeDigest,
    effective_change_order_digests_digest:
      validated.effectiveChangeOrderDigestsDigest,
    effective_scope_digest:
      validated.effectiveScopeDigest,
    completion_package_digest:
      validated.completionPackageDigest,
    final_obligation_digest:
      validated.finalObligationDigest,
    invoice_digest: validated.invoiceDigest,
    purpose_digest: validated.purposeDigest
  });
}

function customBuildFinalCheckoutResponse(
  value,
  config,
  expectedExpiresAt,
  validated,
  expectedMetadata
) {
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkout = checkoutResponse(
    value,
    config,
    expectedExpiresAt
  );
  const metadata = value?.metadata;
  const observedCustomerId =
    value?.customer === null ||
    value?.customer === undefined
      ? null
      : providerReferenceId(
          value.customer,
          "cus",
          "Stripe Custom-build final Checkout Customer ID"
        );
  invariant(
    value?.client_reference_id ===
      validated.identity.invoiceId &&
      value?.mode === "payment" &&
      value?.currency === "usd" &&
      value?.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value?.automatic_tax?.enabled === automaticTax &&
      value?.status === "open" &&
      value?.payment_status === "unpaid" &&
      (
        validated.stripeCustomerId === null ||
        observedCustomerId === validated.stripeCustomerId
      ) &&
      exactObjectKeys(
        metadata,
        Object.keys(expectedMetadata)
      ) &&
      Object.entries(expectedMetadata).every(
        ([key, expected]) => metadata[key] === expected
      ),
    "stripe_custom_build_final_checkout_response_invalid",
    "Stripe Custom-build final Checkout did not preserve the exact final invoice purpose",
    { status: 502 }
  );
  return checkout;
}

function customBuildFinalPaymentFacts(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_final_payment_mismatch";
  const taxMode = validated.purpose.taxMode;
  const automaticTax = taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build final Checkout Session ID"
  );
  const expectedMetadata =
    customBuildFinalMetadata(validated);
  validateServiceAssessmentMetadata(
    value?.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build final payment metadata changed"
  );
  const taxMinor = serviceAssessmentProviderMinor(
    value?.total_details?.amount_tax,
    "Stripe Custom-build final tax amount",
    code
  );
  const subtotalMinor =
    validated.purpose.price.amountMinor;
  const totalMinor = subtotalMinor + taxMinor;
  const customerId = providerReferenceId(
    value?.customer,
    "cus",
    "Stripe Custom-build final Checkout Customer ID"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal === subtotalMinor &&
      value.amount_total === totalMinor &&
      value.automatic_tax?.enabled === automaticTax &&
      (automaticTax
        ? value.automatic_tax?.status === "complete"
        : (value.automatic_tax?.status === null ||
            value.automatic_tax?.status === undefined) &&
          taxMinor === 0) &&
      value.total_details?.amount_discount === 0 &&
      value.total_details?.amount_shipping === 0 &&
      value.status === "complete" &&
      value.payment_status === "paid",
    code,
    "Stripe did not confirm the exact paid Custom-build final Checkout",
    { status: 502 }
  );
  const lineItems = value.line_items;
  invariant(
    lineItems &&
      Array.isArray(lineItems.data) &&
      lineItems.data.length === 1 &&
      lineItems.has_more === false,
    code,
    "Stripe did not return one exact Custom-build final line item",
    { status: 502 }
  );
  const line = lineItems.data[0];
  const linePrice = serviceAssessmentProviderObject(
    line?.price,
    "price",
    "Stripe Custom-build final line Price",
    code
  );
  const lineProduct = serviceAssessmentProviderObject(
    linePrice.product,
    "prod",
    "Stripe Custom-build final line Product",
    code
  );
  invariant(
    line.quantity === 1 &&
      line.currency === "usd" &&
      line.description ===
        "Site Sourcery Custom build — final installment" &&
      line.amount_subtotal === subtotalMinor &&
      line.amount_discount === 0 &&
      line.amount_tax === taxMinor &&
      line.amount_total === totalMinor &&
      linePrice.currency === "usd" &&
      linePrice.type === "one_time" &&
      linePrice.unit_amount === subtotalMinor &&
      linePrice.tax_behavior === "exclusive" &&
      lineProduct.name ===
        "Site Sourcery Custom build — final installment" &&
      lineProduct.tax_code ===
        config.taxCodes.customBuildFinal,
    code,
    "Stripe changed the exact Custom-build final installment line",
    { status: 502 }
  );
  const intent = serviceAssessmentProviderObject(
    value.payment_intent,
    "pi",
    "Stripe Custom-build final PaymentIntent",
    code
  );
  validateServiceAssessmentMetadata(
    intent.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build final PaymentIntent metadata changed"
  );
  invariant(
    intent.livemode === config.livemode &&
      intent.status === "succeeded" &&
      intent.currency === "usd" &&
      intent.amount === totalMinor &&
      intent.amount_received === totalMinor &&
      intent.amount_capturable === 0 &&
      providerReferenceId(
        intent.customer,
        "cus",
        "Stripe Custom-build final PaymentIntent Customer ID"
      ) === customerId,
    code,
    "Stripe did not confirm the exact succeeded Custom-build final PaymentIntent",
    { status: 502 }
  );
  const charge = serviceAssessmentProviderObject(
    intent.latest_charge,
    "ch",
    "Stripe Custom-build final Charge",
    code
  );
  validateServiceAssessmentMetadata(
    charge.metadata,
    expectedMetadata,
    code,
    "Stripe Custom-build final Charge metadata changed"
  );
  invariant(
    charge.livemode === config.livemode &&
      charge.status === "succeeded" &&
      charge.paid === true &&
      charge.captured === true &&
      charge.refunded === false &&
      charge.disputed === false &&
      charge.failure_code === null &&
      charge.failure_message === null &&
      charge.currency === "usd" &&
      charge.amount === totalMinor &&
      charge.amount_captured === totalMinor &&
      charge.amount_refunded === 0 &&
      providerReferenceId(
        charge.customer,
        "cus",
        "Stripe Custom-build final Charge Customer ID"
      ) === customerId &&
      providerReferenceId(
        charge.payment_intent,
        "pi",
        "Stripe Custom-build final Charge PaymentIntent ID"
      ) === intent.id,
    code,
    "Stripe did not confirm one uncontested captured Custom-build final Charge",
    { status: 502 }
  );
  const facts = {
    schema: STRIPE_CUSTOM_BUILD_FINAL_PAYMENT_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    paymentIntentId: intent.id,
    chargeId: charge.id,
    customerId,
    paymentStatus: "paid",
    chargeCaptured: charge.captured,
    amountRefundedMinor: charge.amount_refunded,
    disputed: charge.disputed,
    subtotalMinor,
    taxMinor,
    totalMinor,
    taxMode,
    currency: "USD",
    purposeDigest: validated.purposeDigest,
    providerPaymentTime:
      serviceAssessmentProviderTime(
        charge.created,
        "Stripe Custom-build final payment time",
        code
      )
  };
  return Object.freeze({
    ...facts,
    providerFactsDigest: digest(facts)
  });
}

function customBuildFinalCheckoutLifecycle(
  value,
  config,
  validated,
  checkoutSessionId
) {
  const code =
    "stripe_custom_build_final_checkout_lifecycle_invalid";
  const automaticTax =
    validated.purpose.taxMode === "automatic";
  const checkoutId = providerId(
    value?.id,
    "cs",
    "Stripe Custom-build final Checkout Session ID"
  );
  validateServiceAssessmentMetadata(
    value?.metadata,
    customBuildFinalMetadata(validated),
    code,
    "Stripe Custom-build final Checkout lifecycle metadata changed"
  );
  invariant(
    checkoutId === checkoutSessionId &&
      value.client_reference_id ===
        validated.identity.invoiceId &&
      value.livemode === config.livemode &&
      value.mode === "payment" &&
      value.currency === "usd" &&
      value.amount_subtotal ===
        validated.purpose.price.amountMinor &&
      value.automatic_tax?.enabled === automaticTax,
    code,
    "Stripe did not return the exact Custom-build final Checkout lifecycle",
    { status: 502 }
  );
  let state;
  if (
    value.status === "open" &&
    value.payment_status === "unpaid"
  ) {
    state = "open";
  } else if (
    value.status === "expired" &&
    value.payment_status === "unpaid"
  ) {
    state = "expired";
  } else if (
    value.status === "complete" &&
    value.payment_status === "paid" &&
    (automaticTax
      ? value.automatic_tax?.status === "complete"
      : (value.automatic_tax?.status === null ||
          value.automatic_tax?.status === undefined) &&
        value.total_details?.amount_tax === 0)
  ) {
    const taxMinor = serviceAssessmentProviderMinor(
      value?.total_details?.amount_tax,
      "Stripe Custom-build final lifecycle tax amount",
      code
    );
    invariant(
      value.amount_total ===
        validated.purpose.price.amountMinor + taxMinor &&
        value.total_details?.amount_discount === 0 &&
        value.total_details?.amount_shipping === 0,
      code,
      "Stripe returned unsafe paid Custom-build final totals",
      { status: 502 }
    );
    state = "paid";
  } else {
    invariant(
      false,
      code,
      "Stripe returned an unsafe Custom-build final Checkout lifecycle",
      { status: 502 }
    );
  }
  return Object.freeze({
    schema: STRIPE_CUSTOM_BUILD_FINAL_LIFECYCLE_SCHEMA,
    provider: "stripe",
    checkoutSessionId: checkoutId,
    purposeDigest: validated.purposeDigest,
    state
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
  const taxMode = validated.purpose.taxMode;
  const automaticTax = taxMode === "automatic";
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
    taxMode,
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
  const taxMode = taxModeFor(config, "alakazam");
  const automaticTax = taxMode === "automatic";
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
    const lineProduct = expandedAlakazamObject(
      linePrice.product,
      "prod",
      "Stripe Alakazam upgrade Product"
    );
    invariant(
      linePrice.active === true &&
        linePrice.livemode === config.livemode &&
        linePrice.currency === "usd" &&
        linePrice.unit_amount === listSubtotalMinor &&
        linePrice.recurring === null &&
        linePrice.tax_behavior === "exclusive" &&
        lineProduct.id === config.alakazam.productId &&
        lineProduct.tax_code === config.taxCodes.alakazam,
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
    taxMode,
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
        (validated.purpose.taxMode === "automatic"),
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

function checkoutLineItems(validated, taxCodes) {
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
        tax_behavior: "exclusive",
        product_data: {
          name: line.lineItemId.startsWith("domain:")
            ? "Domain registration"
            : "Site Sourcery service",
          tax_code: line.lineItemId.startsWith("domain:")
            ? taxCodes.domainRegistration
            : taxCodes.siteService
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
    url.port ||
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
        "function" &&
      typeof client.invoices?.retrieve === "function" &&
      typeof client.charges?.retrieve === "function" &&
      typeof client.refunds?.list === "function" &&
      typeof client.disputes?.list === "function",
    "stripe_client_invalid",
    "The Stripe Alakazam provider contract is incomplete",
    { status: 500 }
  );
  return client;
}

function productMatchesAlakazam(
  value,
  config,
  livemode,
  taxCode
) {
  return (
    value &&
    value.id === config.productId &&
    value.active === true &&
    value.livemode === livemode &&
    value.name === "Alakazam" &&
    value.tax_code === taxCode
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
  portalReturnUrl,
  privacyPolicyUrl,
  termsOfServiceUrl
) {
  return (
    value &&
    value.id === config.portalConfigurationId &&
    value.active === true &&
    value.livemode === livemode &&
    value.default_return_url === portalReturnUrl &&
    value.business_profile?.privacy_policy_url ===
      privacyPolicyUrl &&
    value.business_profile?.terms_of_service_url ===
      termsOfServiceUrl &&
    value.login_page?.enabled === false &&
    value.login_page?.url === null &&
    value.features?.payment_method_update?.enabled ===
      true &&
    value.features?.invoice_history?.enabled === true &&
    value.features?.customer_update?.enabled === false &&
    value.features?.subscription_update?.enabled ===
      false &&
    value.features?.subscription_cancel?.enabled === false
  );
}

function webhookEndpointMatches(value, config) {
  return (
    value &&
    value.id === config.webhookEndpointId &&
    value.livemode === config.livemode &&
    value.status === "enabled" &&
    value.api_version === config.apiVersion &&
    value.url === config.webhookEndpointUrl &&
    value.application === null &&
    Array.isArray(value.enabled_events) &&
    JSON.stringify([...value.enabled_events].sort()) ===
      JSON.stringify(STRIPE_REQUIRED_WEBHOOK_EVENTS)
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
        automaticTaxFor(config, "alakazam") &&
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
        automaticTaxFor(config, "alakazam") &&
      phases[1].start_date === effectiveAt &&
      Number.isSafeInteger(phases[1].end_date) &&
      phases[1].end_date > effectiveAt &&
      phases[1].proration_behavior === "none" &&
      phases[1].collection_method ===
        "charge_automatically" &&
      phases[1].automatic_tax?.enabled ===
        automaticTaxFor(config, "alakazam") &&
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
    facts.metadata?.payment_receipt_id ===
      paymentEvidence.receiptId &&
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
    facts.metadata?.payment_receipt_id ===
      paymentEvidence.receiptId &&
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
      createServiceAssessmentCheckout: reject,
      retrieveServiceAssessmentPayment: reject,
      retrieveServiceAssessmentCheckoutLifecycle: reject,
      createCustomBuildStartCheckout: reject,
      retrieveCustomBuildStartPayment: reject,
      retrieveCustomBuildStartCheckoutLifecycle: reject,
      createCustomBuildChangeCheckout: reject,
      retrieveCustomBuildChangePayment: reject,
      retrieveCustomBuildChangeCheckoutLifecycle: reject,
      createCustomBuildFinalCheckout: reject,
      retrieveCustomBuildFinalPayment: reject,
      retrieveCustomBuildFinalCheckoutLifecycle: reject,
      createAlakazamCustomer: reject,
      retrieveAlakazamCustomer: reject,
      createAlakazamStartCheckout: reject,
      createAlakazamUpgradeCheckout: reject,
      retrieveAlakazamPayment: reject,
      retrieveAlakazamRenewalInvoice: reject,
      retrieveAlakazamIncidentInvoice: reject,
      retrieveAlakazamCancellation: reject,
      retrieveAlakazamReversal: reject,
      retrieveAlakazamSubscription: reject,
      retrieveAlakazamSchedule: reject,
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
        config.livemode,
        config.taxCodes.alakazam
      ),
      "stripe_alakazam_product_mismatch",
      "The Alakazam Product no longer matches the owner contract",
      { status: 503 }
    );
    let coupon;
    try {
      coupon = await client.coupons.retrieve(
        config.alakazam.downloadCreditCouponId,
        { expand: ["applies_to"] }
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
        config.portalReturnUrl,
        config.portalPrivacyPolicyUrl,
        config.portalTermsOfServiceUrl
      ),
      "stripe_alakazam_portal_configuration_mismatch",
      "The Alakazam Billing Portal can bypass the reviewed account boundary",
      { status: 503 }
    );
  }

  async function verifyWebhookEndpoint() {
    requireCapability("webhook_endpoints:read");
    let endpoint;
    try {
      endpoint = await client.webhookEndpoints.retrieve(
        config.webhookEndpointId
      );
    } catch {
      throw noEffect(
        "stripe_webhook_endpoint_unavailable",
        "The exact Stripe Webhook Endpoint could not be verified"
      );
    }
    invariant(
      webhookEndpointMatches(endpoint, config),
      "stripe_webhook_endpoint_mismatch",
      "Stripe Webhook Endpoint drifted from its exact release contract",
      { status: 503 }
    );
  }

  async function retrieveAlakazamSubscriptionInternal({
    stripeSubscriptionId,
    stripeCustomerId,
    observedAt = clock.now()
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
      observedAt
    );
  }

  async function retrieveAlakazamLifecycleInvoiceInternal({
    stripeInvoiceId,
    stripeSubscriptionId,
    stripeCustomerId,
    kind
  }) {
    requireCapability("invoices:read");
    requireCapability("subscriptions:read");
    invariant(
      kind === "renewal" || kind === "incident",
      "stripe_alakazam_invoice_read_invalid",
      "Stripe Alakazam invoice read kind is invalid",
      { status: 500 }
    );
    const invoiceId = providerId(
      stripeInvoiceId,
      "in",
      "stripeInvoiceId"
    );
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
    const observedAt = canonicalIso(
      clock.now(),
      "providerObservedAt"
    );
    let invoice;
    try {
      invoice = await client.invoices.retrieve(invoiceId, {
        expand: [
          "lines.data.pricing.price_details.price",
          "payments.data.payment.payment_intent"
        ]
      });
    } catch {
      throw noEffect(
        kind === "renewal"
          ? "stripe_alakazam_renewal_invoice_unavailable"
          : "stripe_alakazam_incident_invoice_unavailable",
        "Stripe Alakazam Invoice could not be read for reconciliation",
        { stripeInvoiceId: invoiceId }
      );
    }
    const subscription =
      await retrieveAlakazamSubscriptionInternal({
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
        observedAt
      });
    invariant(
      invoice?.id === invoiceId &&
        invoice.livemode === config.livemode &&
        invoice.currency === "usd" &&
        providerReferenceId(
          invoice.customer,
          "cus",
          "Stripe Alakazam Invoice Customer ID"
        ) === customerId &&
        invoice.parent?.type === "subscription_details" &&
        providerReferenceId(
          invoice.parent.subscription_details?.subscription,
          "sub",
          "Stripe Alakazam Invoice Subscription ID"
        ) === subscriptionId &&
        invoice.collection_method === "charge_automatically" &&
        invoice.automatic_tax?.enabled ===
          automaticTaxFor(config, "alakazam") &&
        (!automaticTaxFor(config, "alakazam") ||
          invoice.automatic_tax?.status === "complete") &&
        Array.isArray(invoice.lines?.data) &&
        invoice.lines.data.length === 1 &&
        invoice.lines.has_more === false &&
        Array.isArray(invoice.payments?.data) &&
        invoice.payments.data.length === 1 &&
        invoice.payments.has_more === false,
      kind === "renewal"
        ? "stripe_alakazam_renewal_mismatch"
        : "stripe_alakazam_incident_mismatch",
      "Stripe Alakazam Invoice identity or collection settings changed",
      { status: 502 }
    );
    const line = invoice.lines.data[0];
    const priceId = providerReferenceId(
      line.pricing?.price_details?.price,
      "price",
      "Stripe Alakazam Invoice Price ID"
    );
    const lineSubscriptionId = providerReferenceId(
      line.parent?.subscription_item_details?.subscription,
      "sub",
      "Stripe Alakazam Invoice line Subscription ID"
    );
    const lineSubscriptionItemId = providerReferenceId(
      line.parent?.subscription_item_details?.subscription_item,
      "si",
      "Stripe Alakazam Invoice Subscription Item ID"
    );
    invariant(
      line.livemode === config.livemode &&
        line.currency === "usd" &&
        line.parent?.type === "subscription_item_details" &&
        line.parent.subscription_item_details?.proration === false &&
        lineSubscriptionId === subscriptionId &&
        lineSubscriptionItemId ===
          subscription.stripeSubscriptionItemId &&
        line.pricing?.type === "price_details" &&
        priceId === subscription.stripePriceId &&
        line.quantity === 1 &&
        line.amount === subscription.amountMinor &&
        line.subtotal === subscription.amountMinor &&
        Number.isSafeInteger(line.period?.start) &&
        Number.isSafeInteger(line.period?.end) &&
        line.period.start > 0 &&
        line.period.end > line.period.start &&
        invoice.subtotal === subscription.amountMinor &&
        invoice.total_discount_amounts?.length === 0 &&
        invoice.pre_payment_credit_notes_amount === 0 &&
        invoice.post_payment_credit_notes_amount === 0 &&
        Number.isSafeInteger(invoice.total_excluding_tax) &&
        invoice.total_excluding_tax === subscription.amountMinor &&
        Number.isSafeInteger(invoice.total) &&
        invoice.total >= subscription.amountMinor &&
        Number.isSafeInteger(invoice.amount_paid_off_stripe),
      kind === "renewal"
        ? "stripe_alakazam_renewal_mismatch"
        : "stripe_alakazam_incident_mismatch",
      "Stripe Alakazam Invoice line or totals changed",
      { status: 502 }
    );
    const payment = invoice.payments.data[0];
    const paymentIntent = expandedAlakazamObject(
      payment.payment?.payment_intent,
      "pi",
      "Stripe Alakazam Invoice PaymentIntent"
    );
    invariant(
      payment.livemode === config.livemode &&
        payment.currency === "usd" &&
        payment.payment?.type === "payment_intent" &&
        paymentIntent.livemode === config.livemode &&
        paymentIntent.currency === "usd" &&
        providerReferenceId(
          paymentIntent.customer,
          "cus",
          "Stripe Alakazam Invoice PaymentIntent Customer ID"
        ) === customerId &&
        paymentIntent.amount === invoice.total,
      kind === "renewal"
        ? "stripe_alakazam_renewal_mismatch"
        : "stripe_alakazam_incident_mismatch",
      "Stripe Alakazam Invoice PaymentIntent binding changed",
      { status: 502 }
    );
    return Object.freeze({
      invoice,
      line,
      payment,
      paymentIntent,
      subscription,
      observedAt,
      periodStartsAt: exactProviderTime(
        line.period.start,
        "Stripe Alakazam Invoice period start"
      ),
      periodEndsAt: exactProviderTime(
        line.period.end,
        "Stripe Alakazam Invoice period end"
      ),
      taxMinor: invoice.total - invoice.total_excluding_tax
    });
  }

  async function retrieveAlakazamRenewalInvoiceInternal(
    request
  ) {
    const readback =
      await retrieveAlakazamLifecycleInvoiceInternal({
        ...request,
        kind: "renewal"
      });
    const {
      invoice,
      payment,
      paymentIntent,
      subscription
    } = readback;
    invariant(
      invoice.status === "paid" &&
        invoice.billing_reason === "subscription_cycle" &&
        invoice.amount_due === invoice.total &&
        invoice.amount_paid === invoice.total &&
        invoice.amount_remaining === 0 &&
        invoice.amount_paid_off_stripe === 0 &&
        payment.status === "paid" &&
        payment.amount_requested === invoice.total &&
        payment.amount_paid === invoice.total &&
        paymentIntent.status === "succeeded" &&
        paymentIntent.amount_received === invoice.total,
      "stripe_alakazam_renewal_mismatch",
      "Stripe did not confirm one paid automatic Alakazam renewal",
      { status: 502 }
    );
    const facts = {
      schema: ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
      provider: "stripe",
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeSubscriptionItemId:
        subscription.stripeSubscriptionItemId,
      stripeCustomerId: subscription.stripeCustomerId,
      stripePriceId: subscription.stripePriceId,
      stripePaymentIntentId: paymentIntent.id,
      tierId: subscription.tierId,
      status: invoice.status,
      billingReason: invoice.billing_reason,
      collectionMethod: invoice.collection_method,
      paidOutOfBand: false,
      listSubtotalMinor: subscription.amountMinor,
      netSubtotalMinor: invoice.total_excluding_tax,
      taxMinor: readback.taxMinor,
      totalMinor: invoice.total,
      amountPaidMinor: invoice.amount_paid,
      amountRemainingMinor: invoice.amount_remaining,
      taxMode: taxModeFor(config, "alakazam"),
      currency: "USD",
      periodStartsAt: readback.periodStartsAt,
      periodEndsAt: readback.periodEndsAt,
      providerPaymentTime: exactProviderTime(
        payment.status_transitions?.paid_at,
        "Stripe Alakazam Invoice payment time"
      ),
      providerObservedAt: readback.observedAt,
      subscription
    };
    return Object.freeze({
      ...facts,
      providerFactsDigest: digest(facts)
    });
  }

  async function retrieveAlakazamIncidentInvoiceInternal(
    request
  ) {
    const readback =
      await retrieveAlakazamLifecycleInvoiceInternal({
        ...request,
        kind: "incident"
      });
    const {
      invoice,
      payment,
      paymentIntent,
      subscription
    } = readback;
    invariant(
      ["open", "uncollectible"].includes(invoice.status) &&
        invoice.amount_due > 0 &&
        invoice.amount_paid === 0 &&
        invoice.amount_remaining === invoice.amount_due &&
        invoice.attempt_count >= 1 &&
        payment.status !== "paid" &&
        paymentIntent.status !== "succeeded" &&
        paymentIntent.amount_received === 0,
      "stripe_alakazam_incident_mismatch",
      "Stripe did not confirm one unpaid Alakazam incident",
      { status: 502 }
    );
    const facts = {
      schema: ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
      provider: "stripe",
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      stripePaymentIntentId: paymentIntent.id,
      tierId: subscription.tierId,
      status: invoice.status,
      amountDueMinor: invoice.amount_due,
      amountPaidMinor: invoice.amount_paid,
      currency: "USD",
      attemptCount: invoice.attempt_count,
      nextPaymentAttemptAt:
        invoice.next_payment_attempt === null
          ? null
          : exactProviderTime(
              invoice.next_payment_attempt,
              "Stripe Alakazam next payment attempt"
            ),
      paymentIntentStatus: paymentIntent.status,
      subscriptionStatus: subscription.providerStatus,
      providerObservedAt: readback.observedAt
    };
    return Object.freeze({
      ...facts,
      providerFactsDigest: digest(facts)
    });
  }

  async function retrieveAlakazamCancellationInternal({
    stripeSubscriptionId,
    stripeCustomerId
  }) {
    const subscription =
      await retrieveAlakazamSubscriptionInternal({
        stripeSubscriptionId,
        stripeCustomerId
      });
    invariant(
      subscription.cancelAtPeriodEnd === true &&
        ["active", "past_due", "unpaid"].includes(
          subscription.providerStatus
        ),
      "stripe_alakazam_cancellation_mismatch",
      "Stripe did not confirm a current period-end Alakazam cancellation",
      { status: 502 }
    );
    const facts = {
      schema: ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
      provider: "stripe",
      stripeSubscriptionId:
        subscription.stripeSubscriptionId,
      stripeCustomerId: subscription.stripeCustomerId,
      tierId: subscription.tierId,
      providerStatus: subscription.providerStatus,
      cancelAtPeriodEnd: true,
      cancelAt: subscription.currentPeriodEndsAt,
      currentPeriodStartsAt:
        subscription.currentPeriodStartsAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      currency: "USD",
      providerObservedAt: subscription.providerObservedAt
    };
    return Object.freeze({
      ...facts,
      providerFactsDigest: digest(facts)
    });
  }

  async function retrieveAlakazamReversalInternal({
    eventType,
    stripeChargeId,
    stripePaymentIntentId
  }) {
    requireCapability("charges:read");
    const refundEvent =
      STRIPE_ALAKAZAM_REFUND_EVENTS.has(eventType);
    const disputeEvent =
      STRIPE_ALAKAZAM_DISPUTE_EVENTS.has(eventType);
    invariant(
      refundEvent !== disputeEvent,
      "stripe_alakazam_reversal_read_invalid",
      "Stripe Alakazam reversal requires one exact wake event type",
      { status: 500 }
    );
    const chargeId = providerId(
      stripeChargeId,
      "ch",
      "stripeChargeId"
    );
    const paymentIntentId = providerId(
      stripePaymentIntentId,
      "pi",
      "stripePaymentIntentId"
    );
    const observedAt = canonicalIso(
      clock.now(),
      "providerObservedAt"
    );
    let charge;
    try {
      charge = await client.charges.retrieve(chargeId);
    } catch {
      throw noEffect(
        "stripe_alakazam_reversal_charge_unavailable",
        "Stripe Alakazam Charge could not be read for reversal reconciliation",
        { stripeChargeId: chargeId }
      );
    }
    invariant(
      charge?.id === chargeId &&
        charge.livemode === config.livemode &&
        charge.currency === "usd" &&
        charge.paid === true &&
        charge.status === "succeeded" &&
        Number.isSafeInteger(charge.amount) &&
        charge.amount > 0 &&
        providerReferenceId(
          charge.payment_intent,
          "pi",
          "Stripe Alakazam Charge PaymentIntent ID"
        ) === paymentIntentId,
      "stripe_alakazam_reversal_mismatch",
      "Stripe Alakazam Charge identity or amount changed",
      { status: 502 }
    );
    let reversalKind;
    let outcome;
    let amountReversedMinor;
    let stripeRefundId = null;
    let stripeDisputeId = null;
    if (refundEvent) {
      requireCapability("refunds:read");
      let page;
      try {
        page = await client.refunds.list({
          charge: chargeId,
          limit: 2
        });
      } catch {
        throw noEffect(
          "stripe_alakazam_refund_unavailable",
          "Stripe Alakazam Refund could not be read for reconciliation",
          { stripeChargeId: chargeId }
        );
      }
      invariant(
        Array.isArray(page?.data) &&
          page.data.length === 1 &&
          page.has_more === false,
        "stripe_alakazam_reversal_mismatch",
        "Stripe Alakazam reversal requires one exact Refund",
        { status: 502 }
      );
      const refund = page.data[0];
      stripeRefundId = providerId(
        refund?.id,
        "re",
        "Stripe Alakazam Refund ID"
      );
      invariant(
        refund.livemode === config.livemode &&
          refund.currency === "usd" &&
          providerReferenceId(
            refund.charge,
            "ch",
            "Stripe Alakazam Refund Charge ID"
          ) === chargeId &&
          providerReferenceId(
            refund.payment_intent,
            "pi",
            "Stripe Alakazam Refund PaymentIntent ID"
          ) === paymentIntentId &&
          Number.isSafeInteger(refund.amount) &&
          refund.amount > 0 &&
          refund.amount <= charge.amount &&
          ["failed", "succeeded"].includes(refund.status),
        "stripe_alakazam_reversal_mismatch",
        "Stripe Alakazam Refund identity, amount, or status changed",
        { status: 502 }
      );
      reversalKind = "refund";
      amountReversedMinor =
        refund.status === "succeeded" ? refund.amount : 0;
      outcome =
        refund.status === "failed"
          ? "refund_failed"
          : refund.amount === charge.amount
            ? "refund_full"
            : "refund_partial";
      invariant(
        charge.amount_refunded === amountReversedMinor &&
          charge.refunded ===
            (outcome === "refund_full"),
        "stripe_alakazam_reversal_mismatch",
        "Stripe Charge and Refund totals disagree",
        { status: 502 }
      );
    } else {
      requireCapability("disputes:read");
      let page;
      try {
        page = await client.disputes.list({
          charge: chargeId,
          limit: 2
        });
      } catch {
        throw noEffect(
          "stripe_alakazam_dispute_unavailable",
          "Stripe Alakazam Dispute could not be read for reconciliation",
          { stripeChargeId: chargeId }
        );
      }
      invariant(
        Array.isArray(page?.data) &&
          page.data.length === 1 &&
          page.has_more === false,
        "stripe_alakazam_reversal_mismatch",
        "Stripe Alakazam reversal requires one exact Dispute",
        { status: 502 }
      );
      const dispute = page.data[0];
      stripeDisputeId = providerId(
        dispute?.id,
        "dp",
        "Stripe Alakazam Dispute ID"
      );
      const transactions = Array.isArray(
        dispute.balance_transactions
      )
        ? dispute.balance_transactions
        : [];
      invariant(
        dispute.livemode === config.livemode &&
          dispute.currency === "usd" &&
          providerReferenceId(
            dispute.charge,
            "ch",
            "Stripe Alakazam Dispute Charge ID"
          ) === chargeId &&
          providerReferenceId(
            dispute.payment_intent,
            "pi",
            "Stripe Alakazam Dispute PaymentIntent ID"
          ) === paymentIntentId &&
          Number.isSafeInteger(dispute.amount) &&
          dispute.amount > 0 &&
          dispute.amount <= charge.amount &&
          transactions.length <= 2 &&
          transactions.every(
            (transaction) =>
              Number.isSafeInteger(transaction?.amount) &&
              transaction.amount !== 0
          ),
        "stripe_alakazam_reversal_mismatch",
        "Stripe Alakazam Dispute identity, amount, or balance evidence changed",
        { status: 502 }
      );
      const withdrawn = transactions.some(
        ({ amount }) => amount < 0
      );
      const reinstated = transactions.some(
        ({ amount }) => amount > 0
      );
      reversalKind = "dispute";
      if (
        eventType === "charge.dispute.funds_withdrawn"
      ) {
        invariant(
          withdrawn,
          "stripe_alakazam_reversal_mismatch",
          "Stripe did not confirm withdrawn dispute funds",
          { status: 502 }
        );
        outcome = "dispute_funds_withdrawn";
        amountReversedMinor = dispute.amount;
      } else if (
        eventType === "charge.dispute.funds_reinstated"
      ) {
        invariant(
          withdrawn && reinstated,
          "stripe_alakazam_reversal_mismatch",
          "Stripe did not confirm reinstated dispute funds",
          { status: 502 }
        );
        outcome = "dispute_funds_reinstated";
        amountReversedMinor = 0;
      } else if (dispute.status === "lost") {
        invariant(
          withdrawn,
          "stripe_alakazam_reversal_mismatch",
          "Stripe lost Dispute has no withdrawn-funds evidence",
          { status: 502 }
        );
        outcome = "dispute_lost";
        amountReversedMinor = dispute.amount;
      } else if (
        ["won", "warning_closed"].includes(dispute.status)
      ) {
        outcome = "dispute_won";
        amountReversedMinor = 0;
      } else {
        invariant(
          [
            "needs_response",
            "under_review",
            "warning_needs_response",
            "warning_under_review"
          ].includes(dispute.status),
          "stripe_alakazam_reversal_mismatch",
          "Stripe Dispute status is unsupported",
          { status: 502 }
        );
        outcome = "dispute_open";
        amountReversedMinor = withdrawn
          ? dispute.amount
          : 0;
      }
    }
    const facts = {
      schema: ALAKAZAM_REVERSAL_FACTS_SCHEMA,
      provider: "stripe",
      reversalKind,
      outcome,
      stripeChargeId: chargeId,
      stripePaymentIntentId: paymentIntentId,
      stripeRefundId,
      stripeDisputeId,
      amountChargedMinor: charge.amount,
      amountReversedMinor,
      currency: "USD",
      providerObservedAt: observedAt
    };
    return Object.freeze({
      ...facts,
      providerFactsDigest: digest(facts)
    });
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

  function readinessProjection({ purpose = null } = {}) {
    return {
      ready: true,
      provider: "stripe",
      mode,
      environment:
        approval?.environment ?? "contract_test",
      livemode: config.livemode,
      apiVersion: config.apiVersion,
      ...(purpose === null ? {} : { purpose }),
      priceCount:
        purpose === null || purpose === "alakazam"
          ? config.priceExpectations.length
          : 0,
      domainAuthorization:
        (purpose === null || purpose === "domainRegistration") &&
        domainCapabilities.length > 0 &&
        Boolean(config.domainAuthorization),
      webhookVerification:
        purpose === "domainRegistration" ? false : true,
      webhookEndpoint:
        purpose === "domainRegistration" ? false : true,
      taxModes: config.taxAuthority.purposes,
      taxPurposeAuthority: true,
      automaticTaxActivation:
        config.taxAuthority.automaticActivation !== null,
      taxAttestation: true,
      ...(purpose === "alakazam" ||
      (purpose === null && config.alakazam)
        ? { alakazam: true }
        : {})
    };
  }

  async function readinessForPurpose(purpose) {
    try {
      invariant(
        STRIPE_READINESS_PURPOSES.includes(purpose),
        "stripe_readiness_purpose_invalid",
        "Stripe readiness requires one exact payment purpose",
        { status: 500 }
      );
      if (purpose === "domainRegistration") {
        invariant(
          domainCapabilities.length > 0 &&
            Boolean(config.domainAuthorization),
          "stripe_domain_authorization_held",
          "Stripe Domain authorization is held",
          { status: 503 }
        );
        domainProviderClient(client);
      } else {
        await verifyWebhookEndpoint();
      }
      if (purpose === "alakazam") {
        invariant(
          Boolean(config.alakazam),
          "stripe_alakazam_held",
          "Stripe Alakazam is held",
          { status: 503 }
        );
        await verifyAlakazamConfiguration();
      }
      return readinessProjection({ purpose });
    } catch (error) {
      return {
        ready: false,
        provider: "stripe",
        mode,
        environment:
          approval?.environment ?? "contract_test",
        livemode: config.livemode,
        purpose:
          STRIPE_READINESS_PURPOSES.includes(purpose)
            ? purpose
            : null,
        code: error?.code ?? "stripe_not_ready"
      };
    }
  }

  const adapter = {
    readinessForPurpose,
    async readiness() {
      try {
        await verifyWebhookEndpoint();
        if (config.alakazam) {
          await verifyAlakazamConfiguration();
        } else if (capabilities.has("prices:read")) {
          await verifyPrices();
        }
        if (domainCapabilities.length > 0) {
          domainProviderClient(client);
        }
        return readinessProjection();
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
        taxModeFor(config, "alakazam")
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
          enabled: automaticTaxFor(config, "alakazam")
        },
        ...(automaticTaxFor(config, "alakazam")
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
        taxModeFor(config, "alakazam")
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
              tax_behavior: "exclusive",
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
          enabled: automaticTaxFor(config, "alakazam")
        },
        ...(automaticTaxFor(config, "alakazam")
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
        taxModeFor(config, "alakazam")
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

    async retrieveAlakazamRenewalInvoice(request = {}) {
      invariant(
        config.alakazam &&
          exactObjectKeys(request, [
            "stripeCustomerId",
            "stripeInvoiceId",
            "stripeSubscriptionId"
          ]),
        "stripe_alakazam_renewal_read_invalid",
        "Alakazam renewal readback requires exact Invoice, Subscription, and Customer identity",
        { status: 500 }
      );
      return retrieveAlakazamRenewalInvoiceInternal(request);
    },

    async retrieveAlakazamIncidentInvoice(request = {}) {
      invariant(
        config.alakazam &&
          exactObjectKeys(request, [
            "stripeCustomerId",
            "stripeInvoiceId",
            "stripeSubscriptionId"
          ]),
        "stripe_alakazam_incident_read_invalid",
        "Alakazam incident readback requires exact Invoice, Subscription, and Customer identity",
        { status: 500 }
      );
      return retrieveAlakazamIncidentInvoiceInternal(request);
    },

    async retrieveAlakazamCancellation(request = {}) {
      invariant(
        config.alakazam &&
          exactObjectKeys(request, [
            "stripeCustomerId",
            "stripeSubscriptionId"
          ]),
        "stripe_alakazam_cancellation_read_invalid",
        "Alakazam cancellation readback requires exact Subscription and Customer identity",
        { status: 500 }
      );
      return retrieveAlakazamCancellationInternal(request);
    },

    async retrieveAlakazamReversal(request = {}) {
      invariant(
        config.alakazam &&
          exactObjectKeys(request, [
            "eventType",
            "stripeChargeId",
            "stripePaymentIntentId"
          ]),
        "stripe_alakazam_reversal_read_invalid",
        "Alakazam reversal readback requires exact event, Charge, and PaymentIntent identity",
        { status: 500 }
      );
      return retrieveAlakazamReversalInternal(request);
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
        taxModeFor(config, "alakazam")
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
          download_entitlement_id: "",
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

    async retrieveAlakazamSchedule(request) {
      requireCapability("subscription_schedules:read");
      const validated = validateAlakazamPurpose(
        request,
        config.alakazam,
        "downgrade",
        ["purpose", "purposeDigest", "stripeScheduleId"],
        taxModeFor(config, "alakazam")
      );
      const stripeScheduleId = providerId(
        request.stripeScheduleId,
        "sub_sched",
        "stripeScheduleId"
      );
      await verifyAlakazamConfiguration();
      const current =
        await retrieveAlakazamSubscriptionInternal({
          stripeSubscriptionId:
            validated.current.stripeSubscriptionId,
          stripeCustomerId:
            validated.identity.stripeCustomerId
        });
      invariant(
        alakazamCurrentMatches(
          current,
          validated,
          stripeScheduleId
        ),
        "stripe_alakazam_downgrade_stale",
        "Stripe Alakazam Subscription changed before Schedule reconciliation",
        { status: 409 }
      );
      return retrieveAlakazamScheduleInternal({
        stripeScheduleId,
        validated
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
        taxModeFor(config, "alakazam")
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
              enabled: automaticTaxFor(config, "alakazam")
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
              enabled: automaticTaxFor(config, "alakazam")
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
      const items = checkoutLineItems(
        validated,
        config.taxCodes
      );
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
          enabled: automaticTaxFor(config, "siteService")
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
      invariant(
        validated.purpose.taxMode ===
          taxModeFor(config, "download"),
        "stripe_download_tax_authority_mismatch",
        "Download Checkout tax mode does not match its current purpose authority",
        { status: 503 }
      );
      const automaticTax =
        validated.purpose.taxMode === "automatic";
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
              tax_behavior: "exclusive",
              product_data: {
                name: "Abracadabra Download",
                tax_code: config.taxCodes.download
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
          enabled: automaticTax
        },
        ...(validated.stripeCustomerId
          ? { customer: validated.stripeCustomerId }
          : { customer_creation: "always" }),
        ...(automaticTax
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

    async createServiceAssessmentCheckout(request) {
      let validated;
      let providerMetadata;
      let expiresAt;
      let params;
      let stripeIdempotencyKey;
      try {
        requireCapability("checkout:create");
        validated =
          validateServiceAssessmentPurpose(request);
        invariant(
          validated.purpose.taxMode ===
            taxModeFor(config, "serviceAssessment"),
          "stripe_service_assessment_tax_authority_mismatch",
          "Assessment Checkout tax mode does not match its current purpose authority",
          { status: 503 }
        );
        const automaticTax =
          validated.purpose.taxMode === "automatic";
        providerMetadata =
          serviceAssessmentMetadata(validated);
        expiresAt =
          Math.floor(Date.parse(clock.now()) / 1000) +
          config.checkoutTtlSeconds;
        invariant(
          Number.isSafeInteger(expiresAt),
          "stripe_clock_invalid",
          "Stripe checkout clock is invalid",
          { status: 500 }
        );
        params = {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 20000,
                tax_behavior: "exclusive",
                product_data: {
                  name: "Site Sourcery website assessment",
                  tax_code:
                    config.taxCodes.serviceAssessment
                }
              },
              quantity: 1
            }
          ],
          success_url: serviceAssessmentReturnUrl(
            config.successUrl,
            validated
          ),
          cancel_url: config.cancelUrl,
          client_reference_id:
            validated.identity.invoiceId,
          metadata: providerMetadata,
          expires_at: expiresAt,
          automatic_tax: { enabled: automaticTax },
          ...(automaticTax
            ? { billing_address_collection: "required" }
            : {}),
          ...(validated.stripeCustomerId
            ? {
                customer: validated.stripeCustomerId,
                ...(automaticTax
                  ? { customer_update: { address: "auto" } }
                  : {})
              }
            : { customer_creation: "always" }),
          payment_intent_data: {
            metadata: providerMetadata
          }
        };
        stripeIdempotencyKey = providerIdempotencyKey(
          "service_assessment_checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw noEffect(
          typeof error?.code === "string"
            ? error.code
            : "stripe_service_assessment_checkout_not_submitted",
          "Assessment Checkout was rejected before Stripe submission"
        );
      }
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_service_assessment_checkout_effect_unknown",
          "Stripe assessment Checkout creation requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return serviceAssessmentCheckoutResponse(
          response,
          config,
          expiresAt,
          validated,
          providerMetadata
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_service_assessment_checkout_response_invalid",
          "Stripe assessment Checkout returned unsafe evidence that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveServiceAssessmentPayment(request) {
      requireCapability("checkout:read");
      const validated =
        validateServiceAssessmentPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe assessment settlement requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId,
            {
              expand: ["payment_intent.latest_charge"]
            }
          );
      } catch {
        throw noEffect(
          "stripe_service_assessment_payment_read_unavailable",
          "Stripe assessment payment could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return serviceAssessmentPaymentFacts(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async retrieveServiceAssessmentCheckoutLifecycle(
      request
    ) {
      requireCapability("checkout:read");
      const validated =
        validateServiceAssessmentPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe assessment lifecycle requires Checkout readback",
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
          "stripe_service_assessment_checkout_lifecycle_unavailable",
          "Stripe assessment Checkout lifecycle could not be read",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return serviceAssessmentCheckoutLifecycle(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async createCustomBuildStartCheckout(request) {
      let validated;
      let providerMetadata;
      let expiresAt;
      let params;
      let stripeIdempotencyKey;
      try {
        requireCapability("checkout:create");
        validated =
          validateCustomBuildStartPurpose(request);
        invariant(
          validated.purpose.taxMode ===
            taxModeFor(config, "customBuildStart"),
          "stripe_custom_build_start_tax_authority_mismatch",
          "Custom-build Checkout tax mode does not match its current purpose authority",
          { status: 503 }
        );
        const automaticTax =
          validated.purpose.taxMode === "automatic";
        providerMetadata =
          customBuildStartMetadata(validated);
        expiresAt =
          Math.floor(Date.parse(clock.now()) / 1000) +
          config.checkoutTtlSeconds;
        invariant(
          Number.isSafeInteger(expiresAt),
          "stripe_clock_invalid",
          "Stripe checkout clock is invalid",
          { status: 500 }
        );
        params = {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount:
                  validated.purpose.price.amountMinor,
                tax_behavior: "exclusive",
                product_data: {
                  name: "Site Sourcery Custom build — first installment",
                  tax_code: config.taxCodes.customBuildStart
                }
              },
              quantity: 1
            }
          ],
          success_url: customBuildStartReturnUrl(
            config.successUrl,
            validated
          ),
          cancel_url: config.cancelUrl,
          client_reference_id:
            validated.identity.invoiceId,
          metadata: providerMetadata,
          expires_at: expiresAt,
          automatic_tax: { enabled: automaticTax },
          ...(automaticTax
            ? { billing_address_collection: "required" }
            : {}),
          ...(validated.stripeCustomerId
            ? {
                customer: validated.stripeCustomerId,
                ...(automaticTax
                  ? { customer_update: { address: "auto" } }
                  : {})
              }
            : { customer_creation: "always" }),
          payment_intent_data: {
            metadata: providerMetadata
          }
        };
        stripeIdempotencyKey = providerIdempotencyKey(
          "custom_build_start_checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw noEffect(
          typeof error?.code === "string"
            ? error.code
            : "stripe_custom_build_start_checkout_not_submitted",
          "Custom-build Checkout was rejected before Stripe submission"
        );
      }
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_custom_build_start_checkout_effect_unknown",
          "Stripe Custom-build Checkout creation requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return customBuildStartCheckoutResponse(
          response,
          config,
          expiresAt,
          validated,
          providerMetadata
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_custom_build_start_checkout_response_invalid",
          "Stripe Custom-build Checkout returned unsafe evidence that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveCustomBuildStartPayment(request) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildStartPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build settlement requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId,
            {
              expand: ["payment_intent.latest_charge"]
            }
          );
      } catch {
        throw noEffect(
          "stripe_custom_build_start_payment_read_unavailable",
          "Stripe Custom-build payment could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildStartPaymentFacts(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async retrieveCustomBuildStartCheckoutLifecycle(
      request
    ) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildStartPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build lifecycle requires Checkout readback",
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
          "stripe_custom_build_start_checkout_lifecycle_unavailable",
          "Stripe Custom-build Checkout lifecycle could not be read",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildStartCheckoutLifecycle(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async createCustomBuildChangeCheckout(request) {
      let validated;
      let providerMetadata;
      let expiresAt;
      let params;
      let stripeIdempotencyKey;
      try {
        requireCapability("checkout:create");
        validated =
          validateCustomBuildChangePurpose(request);
        invariant(
          validated.purpose.taxMode ===
            taxModeFor(config, "customBuildChange"),
          "stripe_custom_build_change_tax_authority_mismatch",
          "Custom-build change Checkout tax mode does not match its current purpose authority",
          { status: 503 }
        );
        const automaticTax =
          validated.purpose.taxMode === "automatic";
        providerMetadata =
          customBuildChangeMetadata(validated);
        expiresAt = validated.checkoutExpiresAtSeconds;
        params = {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount:
                  validated.purpose.price.unitAmountMinor,
                tax_behavior: "exclusive",
                product_data: {
                  name: "Site Sourcery Custom build — accepted change order",
                  tax_code:
                    config.taxCodes.customBuildChange
                }
              },
              quantity: validated.purpose.price.quantity
            }
          ],
          success_url: customBuildChangeReturnUrl(
            config.successUrl,
            validated
          ),
          cancel_url: config.cancelUrl,
          client_reference_id:
            validated.identity.invoiceId,
          metadata: providerMetadata,
          expires_at: expiresAt,
          automatic_tax: { enabled: automaticTax },
          ...(automaticTax
            ? { billing_address_collection: "required" }
            : {}),
          ...(validated.stripeCustomerId
            ? {
                customer: validated.stripeCustomerId,
                ...(automaticTax
                  ? { customer_update: { address: "auto" } }
                  : {})
              }
            : { customer_creation: "always" }),
          payment_intent_data: {
            metadata: providerMetadata
          }
        };
        stripeIdempotencyKey = providerIdempotencyKey(
          "custom_build_change_checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw noEffect(
          typeof error?.code === "string"
            ? error.code
            : "stripe_custom_build_change_checkout_not_submitted",
          "Custom-build change Checkout was rejected before Stripe submission"
        );
      }
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_custom_build_change_checkout_effect_unknown",
          "Stripe Custom-build change Checkout creation requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return customBuildChangeCheckoutResponse(
          response,
          config,
          expiresAt,
          validated,
          providerMetadata
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_custom_build_change_checkout_response_invalid",
          "Stripe Custom-build change Checkout returned unsafe evidence that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveCustomBuildChangePayment(request) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildChangePurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build change settlement requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId,
            {
              expand: ["payment_intent.latest_charge"]
            }
          );
      } catch {
        throw noEffect(
          "stripe_custom_build_change_payment_read_unavailable",
          "Stripe Custom-build change payment could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildChangePaymentFacts(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async retrieveCustomBuildChangeCheckoutLifecycle(
      request
    ) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildChangePurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build change lifecycle requires Checkout readback",
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
          "stripe_custom_build_change_checkout_lifecycle_unavailable",
          "Stripe Custom-build change Checkout lifecycle could not be read",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildChangeCheckoutLifecycle(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async createCustomBuildFinalCheckout(request) {
      let validated;
      let providerMetadata;
      let expiresAt;
      let params;
      let stripeIdempotencyKey;
      try {
        requireCapability("checkout:create");
        validated =
          validateCustomBuildFinalPurpose(request);
        invariant(
          validated.purpose.taxMode ===
            taxModeFor(config, "customBuildFinal"),
          "stripe_custom_build_final_tax_authority_mismatch",
          "Custom-build final Checkout tax mode does not match its current purpose authority",
          { status: 503 }
        );
        const automaticTax =
          validated.purpose.taxMode === "automatic";
        providerMetadata =
          customBuildFinalMetadata(validated);
        expiresAt = validated.checkoutExpiresAtSeconds;
        params = {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount:
                  validated.purpose.price.amountMinor,
                tax_behavior: "exclusive",
                product_data: {
                  name: "Site Sourcery Custom build — final installment",
                  tax_code: config.taxCodes.customBuildFinal
                }
              },
              quantity: 1
            }
          ],
          success_url: customBuildFinalReturnUrl(
            config.successUrl,
            validated
          ),
          cancel_url: config.cancelUrl,
          client_reference_id:
            validated.identity.invoiceId,
          metadata: providerMetadata,
          expires_at: expiresAt,
          automatic_tax: { enabled: automaticTax },
          ...(automaticTax
            ? { billing_address_collection: "required" }
            : {}),
          ...(validated.stripeCustomerId
            ? {
                customer: validated.stripeCustomerId,
                ...(automaticTax
                  ? { customer_update: { address: "auto" } }
                  : {})
              }
            : { customer_creation: "always" }),
          payment_intent_data: {
            metadata: providerMetadata
          }
        };
        stripeIdempotencyKey = providerIdempotencyKey(
          "custom_build_final_checkout",
          validated.idempotencyKey,
          validated.purposeDigest
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw noEffect(
          typeof error?.code === "string"
            ? error.code
            : "stripe_custom_build_final_checkout_not_submitted",
          "Custom-build final Checkout was rejected before Stripe submission"
        );
      }
      let response;
      try {
        response = await client.checkout.sessions.create(
          params,
          { idempotencyKey: stripeIdempotencyKey }
        );
      } catch {
        throw ambiguous(
          "stripe_custom_build_final_checkout_effect_unknown",
          "Stripe Custom-build final Checkout creation requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      try {
        return customBuildFinalCheckoutResponse(
          response,
          config,
          expiresAt,
          validated,
          providerMetadata
        );
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw ambiguous(
          "stripe_custom_build_final_checkout_response_invalid",
          "Stripe Custom-build final Checkout returned unsafe evidence that requires reconciliation",
          {
            idempotencyKey: stripeIdempotencyKey,
            purposeDigest: validated.purposeDigest
          }
        );
      }
    },

    async retrieveCustomBuildFinalPayment(request) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildFinalPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build final settlement requires Checkout readback",
        { status: 500 }
      );
      let response;
      try {
        response =
          await client.checkout.sessions.retrieve(
            checkoutSessionId,
            {
              expand: [
                "line_items.data.price.product",
                "payment_intent.latest_charge"
              ]
            }
          );
      } catch {
        throw noEffect(
          "stripe_custom_build_final_payment_read_unavailable",
          "Stripe Custom-build final payment could not be read for reconciliation",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildFinalPaymentFacts(
        response,
        config,
        validated,
        checkoutSessionId
      );
    },

    async retrieveCustomBuildFinalCheckoutLifecycle(
      request
    ) {
      requireCapability("checkout:read");
      const validated =
        validateCustomBuildFinalPurpose(request, {
          retrieval: true
        });
      const checkoutSessionId = providerId(
        request.checkoutSessionId,
        "cs",
        "checkoutSessionId"
      );
      invariant(
        typeof client.checkout?.sessions?.retrieve ===
          "function",
        "stripe_client_invalid",
        "Stripe Custom-build final lifecycle requires Checkout readback",
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
          "stripe_custom_build_final_checkout_lifecycle_unavailable",
          "Stripe Custom-build final Checkout lifecycle could not be read",
          {
            checkoutSessionId,
            purposeDigest: validated.purposeDigest
          }
        );
      }
      return customBuildFinalCheckoutLifecycle(
        response,
        config,
        validated,
        checkoutSessionId
      );
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
              tax_behavior: "exclusive",
              product_data: {
                name: `${validated.domain} registration — ${validated.years} ${
                  validated.years === 1
                    ? "year"
                    : "years"
                }`,
                description:
                  "Authorized now; captured only after registrar and registrant readback.",
                tax_code:
                  config.taxCodes.domainRegistration,
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
          enabled: automaticTaxFor(
            config,
            "domainRegistration"
          )
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
