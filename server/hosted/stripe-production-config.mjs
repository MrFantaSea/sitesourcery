import {
  STRIPE_ALAKAZAM_CAPABILITIES,
  STRIPE_API_VERSION,
  STRIPE_READINESS_PURPOSES,
  createStripeProviderAdapter
} from "../commerce/adapters/stripe.mjs";
import {
  ALAKAZAM_TIER_DEFINITIONS,
  ALAKAZAM_TIER_IDS
} from "../commerce-v2/alakazam.mjs";

const PRODUCTION_MODES = new Set([
  "held",
  "approved_live"
]);
const ENVIRONMENT_LIVEMODE = Object.freeze({
  staging: false,
  production: true
});
const APPROVAL_FIELDS = Object.freeze([
  "apiVersion",
  "approvalId",
  "approved",
  "approvedAt",
  "capabilities",
  "environment",
  "livemode",
  "provider"
]);
const HOSTED_CAPABILITIES = Object.freeze([
  "charges:read",
  "checkout:create",
  "checkout:read",
  "disputes:read",
  "prices:read",
  "refunds:read",
  "webhook_endpoints:read",
  "webhooks:verify"
]);
const ALAKAZAM_CAPABILITIES = Object.freeze([
  ...new Set([
    ...STRIPE_ALAKAZAM_CAPABILITIES,
    "billing_portal:create",
    "subscriptions:cancel"
  ])
]);
const DOMAIN_CAPABILITIES = Object.freeze([
  "domain_authorization:cancel",
  "domain_authorization:capture",
  "domain_authorization:create",
  "domain_authorization:read",
  "domain_refunds:create"
]);
const APPROVED_CAPABILITIES = new Set([
  ...HOSTED_CAPABILITIES,
  ...DOMAIN_CAPABILITIES,
  ...ALAKAZAM_CAPABILITIES
]);
const ALAKAZAM_EXCLUSIVE_CAPABILITIES = Object.freeze(
  ALAKAZAM_CAPABILITIES.filter(
    (capability) =>
      !HOSTED_CAPABILITIES.includes(capability)
  )
);
const DOMAIN_ENVIRONMENT_FIELDS = Object.freeze([
  "SITESOURCERY_STRIPE_DOMAIN_SUCCESS_URL_TEMPLATE",
  "SITESOURCERY_STRIPE_DOMAIN_CANCEL_URL_TEMPLATE",
  "SITESOURCERY_STRIPE_DOMAIN_AUTHORIZATION_DISCLOSURE"
]);
const ALAKAZAM_CONFIGURATION_ENVIRONMENT_FIELD =
  "SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON";
const ALAKAZAM_CONFIGURATION_FIELDS = Object.freeze([
  "downloadCreditCouponId",
  "portalConfigurationId",
  "productId",
  "tierPriceIds"
]);
const ALAKAZAM_PRICE_EXPECTATION_FIELDS = Object.freeze([
  "currency",
  "id",
  "livemode",
  "productId",
  "recurring",
  "taxBehavior",
  "unitAmount"
]);
const RECURRING_PRICE_FIELDS = Object.freeze([
  "interval",
  "intervalCount"
]);
const SAFE_LOG_TOKEN = /^[A-Za-z0-9._:-]{1,200}$/u;
const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9._:-]{1,255}$/u;
const STRIPE_PROVIDER_ID =
  /^(bpc|price|prod)_[A-Za-z0-9_]+$/u;
const SENSITIVE_LOG_TOKEN =
  /^(?:approval|pk_|price_|rk_|sk_(?:live|test)|whsec_)/iu;

function configurationError(code, message) {
  const error = new Error(message);
  error.name = "StripeProductionConfigurationError";
  error.code = code;
  return error;
}

function fail(code, message) {
  throw configurationError(code, message);
}

function text(environment, name, maximum = 20_000) {
  const value = environment?.[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    fail(
      "STRIPE_PRODUCTION_CONFIGURATION_REQUIRED",
      `${name} is required for approved Stripe composition.`
    );
  }
  return value;
}

function optionalText(environment, name, maximum = 20_000) {
  const value = environment?.[name];
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    fail(
      "STRIPE_PRODUCTION_CONFIGURATION_INVALID",
      `${name} is invalid.`
    );
  }
  return value;
}

function json(environment, name) {
  const source = text(environment, name, 100_000);
  try {
    return JSON.parse(source);
  } catch {
    fail(
      "STRIPE_PRODUCTION_JSON_INVALID",
      `${name} must contain valid JSON.`
    );
  }
}

function optionalJson(environment, name) {
  const source = optionalText(environment, name, 100_000);
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch {
    fail(
      "STRIPE_PRODUCTION_JSON_INVALID",
      `${name} must contain valid JSON.`
    );
  }
}

function exactObject(value, fields, code, message) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...fields].sort())
  ) {
    fail(code, message);
  }
  return value;
}

function providerId(value, prefix, field) {
  const match =
    typeof value === "string" &&
    value.length <= 255
      ? STRIPE_PROVIDER_ID.exec(value)
      : null;
  if (match?.[1] !== prefix) {
    fail(
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      `${field} must contain an exact Stripe ${prefix} ID.`
    );
  }
  return value;
}

function providerToken(value, field) {
  if (
    typeof value !== "string" ||
    !SAFE_PROVIDER_TOKEN.test(value)
  ) {
    fail(
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      `${field} must contain an exact Stripe provider token.`
    );
  }
  return value;
}

function boolean(environment, name) {
  const value = text(environment, name, 5);
  if (value === "true") return true;
  if (value === "false") return false;
  fail(
    "STRIPE_PRODUCTION_CONFIGURATION_INVALID",
    `${name} must be exactly true or false.`
  );
}

function positiveInteger(environment, name) {
  const value = optionalText(environment, name, 20);
  if (value === null) return undefined;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    fail(
      "STRIPE_PRODUCTION_CONFIGURATION_INVALID",
      `${name} must be a positive integer.`
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail(
      "STRIPE_PRODUCTION_CONFIGURATION_INVALID",
      `${name} is outside the supported range.`
    );
  }
  return parsed;
}

function exactArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      "STRIPE_PRODUCTION_CONFIGURATION_INVALID",
      `${name} must contain a non-empty JSON array.`
    );
  }
  return value;
}

function exactApproval(environment, deployment, livemode) {
  const approval = exactObject(
    json(environment, "SITESOURCERY_STRIPE_APPROVAL_JSON"),
    APPROVAL_FIELDS,
    "STRIPE_PRODUCTION_APPROVAL_INVALID",
    "SITESOURCERY_STRIPE_APPROVAL_JSON must contain the exact approval fields."
  );
  if (
    approval.provider !== "stripe" ||
    approval.approved !== true ||
    approval.environment !== deployment ||
    approval.livemode !== livemode ||
    approval.apiVersion !== STRIPE_API_VERSION ||
    typeof approval.approvalId !== "string" ||
    approval.approvalId.length < 8 ||
    approval.approvalId.length > 200 ||
    !Number.isFinite(Date.parse(approval.approvedAt)) ||
    !Array.isArray(approval.capabilities) ||
    approval.capabilities.length === 0 ||
    approval.capabilities.some(
      (capability) =>
        typeof capability !== "string" ||
        !SAFE_LOG_TOKEN.test(capability) ||
        !APPROVED_CAPABILITIES.has(capability)
    ) ||
    new Set(approval.capabilities).size !==
      approval.capabilities.length
  ) {
    fail(
      "STRIPE_PRODUCTION_APPROVAL_INVALID",
      "Stripe approval is not bound to the exact deployment, livemode, API version, and capability set."
    );
  }
  const capabilities = new Set(approval.capabilities);
  if (
    HOSTED_CAPABILITIES.some(
      (capability) => !capabilities.has(capability)
    )
  ) {
    fail(
      "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE",
      "Stripe approval does not include the complete hosted payment capability set."
    );
  }
  const approvedDomainCapabilities =
    DOMAIN_CAPABILITIES.filter((capability) =>
      capabilities.has(capability)
    );
  if (
    approvedDomainCapabilities.length !== 0 &&
    approvedDomainCapabilities.length !==
      DOMAIN_CAPABILITIES.length
  ) {
    fail(
      "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE",
      "Stripe domain approval must include the complete manual-authorization capability set."
    );
  }
  const approvedAlakazamCapabilities =
    ALAKAZAM_CAPABILITIES.filter(
      (capability) => capabilities.has(capability)
    );
  const approvedExclusiveAlakazamCapabilities =
    ALAKAZAM_EXCLUSIVE_CAPABILITIES.filter(
      (capability) => capabilities.has(capability)
    );
  if (
    approvedExclusiveAlakazamCapabilities.length !== 0 &&
    approvedAlakazamCapabilities.length !==
      ALAKAZAM_CAPABILITIES.length
  ) {
    fail(
      "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE",
      "Stripe Alakazam approval must include the complete provider capability set."
    );
  }
  return {
    approval,
    domainApproved:
      approvedDomainCapabilities.length ===
        DOMAIN_CAPABILITIES.length,
    alakazamApproved:
      approvedAlakazamCapabilities.length ===
      ALAKAZAM_CAPABILITIES.length
  };
}

function domainAuthorization(
  environment,
  domainApproved
) {
  const supplied = DOMAIN_ENVIRONMENT_FIELDS.filter(
    (name) => optionalText(environment, name) !== null
  );
  if (!domainApproved) {
    if (supplied.length > 0) {
      fail(
        "STRIPE_PRODUCTION_DOMAIN_APPROVAL_REQUIRED",
        "Stripe domain templates cannot be configured without the complete approved domain capability set."
      );
    }
    return null;
  }
  return {
    successUrlTemplate: text(
      environment,
      "SITESOURCERY_STRIPE_DOMAIN_SUCCESS_URL_TEMPLATE"
    ),
    cancelUrlTemplate: text(
      environment,
      "SITESOURCERY_STRIPE_DOMAIN_CANCEL_URL_TEMPLATE"
    ),
    authorizationDisclosure: text(
      environment,
      "SITESOURCERY_STRIPE_DOMAIN_AUTHORIZATION_DISCLOSURE",
      500
    )
  };
}

function alakazamConfiguration(
  environment,
  alakazamApproved,
  priceExpectations,
  livemode
) {
  const supplied = optionalText(
    environment,
    ALAKAZAM_CONFIGURATION_ENVIRONMENT_FIELD,
    100_000
  );
  if (supplied === null) {
    if (alakazamApproved) {
      fail(
        "STRIPE_PRODUCTION_CONFIGURATION_REQUIRED",
        `${ALAKAZAM_CONFIGURATION_ENVIRONMENT_FIELD} is required for approved Alakazam composition.`
      );
    }
    return null;
  }
  if (!alakazamApproved) {
    fail(
      "STRIPE_PRODUCTION_ALAKAZAM_APPROVAL_REQUIRED",
      "Stripe Alakazam configuration requires the complete approved provider capability set."
    );
  }
  const configured = exactObject(
    json(
      environment,
      ALAKAZAM_CONFIGURATION_ENVIRONMENT_FIELD
    ),
    ALAKAZAM_CONFIGURATION_FIELDS,
    "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
    `${ALAKAZAM_CONFIGURATION_ENVIRONMENT_FIELD} must contain the exact Alakazam provider fields.`
  );
  const productId = providerId(
    configured.productId,
    "prod",
    "Alakazam Product"
  );
  const portalConfigurationId = providerId(
    configured.portalConfigurationId,
    "bpc",
    "Alakazam Billing Portal configuration"
  );
  const downloadCreditCouponId = providerToken(
    configured.downloadCreditCouponId,
    "Alakazam Download credit Coupon"
  );
  const configuredTierPriceIds = exactObject(
    configured.tierPriceIds,
    ALAKAZAM_TIER_IDS,
    "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
    "Stripe Alakazam configuration must bind exactly the $25, $35, and $50 tier Prices."
  );
  const tierPriceIds = {};
  for (const tierId of ALAKAZAM_TIER_IDS) {
    tierPriceIds[tierId] = providerId(
      configuredTierPriceIds[tierId],
      "price",
      `Alakazam ${tierId} Price`
    );
  }
  const selectedPriceIds = new Set(
    Object.values(tierPriceIds)
  );
  if (selectedPriceIds.size !== ALAKAZAM_TIER_IDS.length) {
    fail(
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      "Stripe Alakazam tiers require three distinct Price IDs."
    );
  }
  for (const tierId of ALAKAZAM_TIER_IDS) {
    const priceId = tierPriceIds[tierId];
    const matches = priceExpectations.filter(
      (expectation) => expectation?.id === priceId
    );
    if (matches.length !== 1) {
      fail(
        "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
        `Stripe Alakazam ${tierId} must bind one exact Price expectation.`
      );
    }
    const expectation = exactObject(
      matches[0],
      ALAKAZAM_PRICE_EXPECTATION_FIELDS,
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      `Stripe Alakazam ${tierId} Price expectation must contain the exact reviewed fields.`
    );
    const recurring = exactObject(
      expectation.recurring,
      RECURRING_PRICE_FIELDS,
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      `Stripe Alakazam ${tierId} must be an exact monthly Price.`
    );
    const tier = ALAKAZAM_TIER_DEFINITIONS[tierId];
    if (
      expectation.productId !== productId ||
      expectation.currency !== "usd" ||
      expectation.unitAmount !== tier.price.amountMinor ||
      expectation.livemode !== livemode ||
      expectation.taxBehavior !== "exclusive" ||
      recurring.interval !== "month" ||
      recurring.intervalCount !== 1
    ) {
      fail(
        "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
        `Stripe Alakazam ${tierId} Price does not match the owner-approved monthly contract.`
      );
    }
  }
  const productPriceIds = priceExpectations
    .filter(
      (expectation) =>
        expectation?.productId === productId
    )
    .map((expectation) => expectation.id);
  if (
    productPriceIds.length !== ALAKAZAM_TIER_IDS.length ||
    productPriceIds.some(
      (priceId) => !selectedPriceIds.has(priceId)
    )
  ) {
    fail(
      "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID",
      "Stripe Alakazam configuration must contain exactly its three reviewed Product Prices."
    );
  }
  return Object.freeze({
    productId,
    portalConfigurationId,
    downloadCreditCouponId,
    tierPriceIds: Object.freeze(tierPriceIds)
  });
}

function keyForMode(environment, livemode) {
  const secretKey = text(
    environment,
    "SITESOURCERY_STRIPE_SECRET_KEY",
    500
  );
  if (
    !(
      livemode
        ? secretKey.startsWith("sk_live_") ||
          secretKey.startsWith("rk_live_")
        : secretKey.startsWith("sk_test_") ||
          secretKey.startsWith("rk_test_")
    )
  ) {
    fail(
      "STRIPE_PRODUCTION_KEY_MODE_MISMATCH",
      "Stripe secret key does not match the approved livemode."
    );
  }
  return secretKey;
}

function webhookSecret(environment) {
  const selected = text(
    environment,
    "SITESOURCERY_STRIPE_WEBHOOK_SECRET",
    500
  );
  if (!selected.startsWith("whsec_")) {
    fail(
      "STRIPE_PRODUCTION_WEBHOOK_SECRET_INVALID",
      "Stripe webhook signing secret is invalid."
    );
  }
  return selected;
}

export function createConfiguredStripeProvider({
  environment = process.env,
  adapterFactory = createStripeProviderAdapter
} = {}) {
  if (typeof adapterFactory !== "function") {
    fail(
      "STRIPE_PRODUCTION_FACTORY_INVALID",
      "Stripe production composition requires the reviewed adapter factory."
    );
  }
  const mode =
    optionalText(
      environment,
      "SITESOURCERY_STRIPE_MODE",
      50
    ) ?? "held";
  if (!PRODUCTION_MODES.has(mode)) {
    fail(
      "STRIPE_PRODUCTION_MODE_INVALID",
      "Production composition permits only held or approved_live Stripe mode."
    );
  }
  if (mode === "held") {
    return Object.freeze({
      adapter: adapterFactory({ mode: "held" }),
      mode: "held",
      environment: null,
      livemode: null,
      apiVersion: STRIPE_API_VERSION
    });
  }

  const deployment = text(
    environment,
    "SITESOURCERY_DEPLOYMENT_ENVIRONMENT",
    50
  );
  if (!(deployment in ENVIRONMENT_LIVEMODE)) {
    fail(
      "STRIPE_PRODUCTION_ENVIRONMENT_INVALID",
      "Approved Stripe composition requires the exact staging or production deployment environment."
    );
  }
  const apiVersion = text(
    environment,
    "SITESOURCERY_STRIPE_API_VERSION",
    100
  );
  if (apiVersion !== STRIPE_API_VERSION) {
    fail(
      "STRIPE_PRODUCTION_API_VERSION_MISMATCH",
      "Stripe API version does not match the pinned runtime version."
    );
  }
  const livemode = boolean(
    environment,
    "SITESOURCERY_STRIPE_LIVEMODE"
  );
  if (
    livemode !==
    ENVIRONMENT_LIVEMODE[deployment]
  ) {
    fail(
      "STRIPE_PRODUCTION_LIVEMODE_MISMATCH",
      "Stripe livemode does not match the deployment environment."
    );
  }
  const {
    approval,
    domainApproved,
    alakazamApproved
  } =
    exactApproval(
      environment,
      deployment,
      livemode
    );
  const priceExpectations = exactArray(
    json(
      environment,
      "SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON"
    ),
    "SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON"
  );
  const approvedReturnOrigins = exactArray(
    json(
      environment,
      "SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON"
    ),
    "SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON"
  );
  const checkoutTtlSeconds = positiveInteger(
    environment,
    "SITESOURCERY_STRIPE_CHECKOUT_TTL_SECONDS"
  );
  const alakazam = alakazamConfiguration(
    environment,
    alakazamApproved,
    priceExpectations,
    livemode
  );
  const config = {
    apiVersion,
    livemode,
    successUrl: text(
      environment,
      "SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL"
    ),
    cancelUrl: text(
      environment,
      "SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL"
    ),
    portalReturnUrl: text(
      environment,
      "SITESOURCERY_STRIPE_PORTAL_RETURN_URL"
    ),
    portalPrivacyPolicyUrl: text(
      environment,
      "SITESOURCERY_STRIPE_PORTAL_PRIVACY_POLICY_URL"
    ),
    portalTermsOfServiceUrl: text(
      environment,
      "SITESOURCERY_STRIPE_PORTAL_TERMS_OF_SERVICE_URL"
    ),
    approvedReturnOrigins,
    taxCodes: json(
      environment,
      "SITESOURCERY_STRIPE_TAX_CODES_JSON"
    ),
    taxAuthority: json(
      environment,
      "SITESOURCERY_STRIPE_TAX_PURPOSE_AUTHORITY_JSON"
    ),
    taxAttestation: optionalJson(
      environment,
      "SITESOURCERY_STRIPE_TAX_ATTESTATION_JSON"
    ),
    webhookSecret: webhookSecret(environment),
    webhookEndpointId: text(
      environment,
      "SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_ID",
      255
    ),
    webhookEndpointUrl: text(
      environment,
      "SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_URL"
    ),
    priceExpectations,
    domainAuthorization: domainAuthorization(
      environment,
      domainApproved
    ),
    ...(alakazam === null ? {} : { alakazam }),
    ...(checkoutTtlSeconds === undefined
      ? {}
      : { checkoutTtlSeconds })
  };
  const adapter = adapterFactory({
    mode: "approved_live",
    secretKey: keyForMode(environment, livemode),
    liveApproval: approval,
    config
  });
  return Object.freeze({
    adapter,
    mode: "approved_live",
    environment: deployment,
    livemode,
    apiVersion
  });
}

function safeToken(value, fallback) {
  return typeof value === "string" &&
    SAFE_LOG_TOKEN.test(value) &&
    !SENSITIVE_LOG_TOKEN.test(value)
    ? value
    : fallback;
}

export function redactStripeReadiness(
  readiness,
  composition = {}
) {
  const value =
    readiness &&
    typeof readiness === "object" &&
    !Array.isArray(readiness)
      ? readiness
      : {};
  return Object.freeze({
    ready: value.ready === true,
    provider: "stripe",
    mode:
      value.mode === "approved_live" ||
      value.mode === "held"
        ? value.mode
        : composition.mode === "approved_live"
          ? "approved_live"
          : "held",
    environment:
      value.environment === "staging" ||
      value.environment === "production"
        ? value.environment
        : composition.environment ?? "unbound",
    livemode:
      typeof value.livemode === "boolean"
        ? value.livemode
        : composition.livemode ?? null,
    apiVersion:
      value.apiVersion === STRIPE_API_VERSION
        ? value.apiVersion
        : composition.apiVersion ===
            STRIPE_API_VERSION
          ? composition.apiVersion
          : STRIPE_API_VERSION,
    priceCount: Number.isSafeInteger(
      value.priceCount
    )
      ? value.priceCount
      : 0,
    domainAuthorization:
      value.domainAuthorization === true,
    webhookVerification:
      value.webhookVerification === true,
    webhookEndpoint:
      value.webhookEndpoint === true,
    taxModes: Object.freeze(
      Object.fromEntries(
        [
          "alakazam",
          "customBuildChange",
          "customBuildFinal",
          "customBuildStart",
          "domainRegistration",
          "download",
          "serviceAssessment",
          "siteService"
        ].map((purpose) => [
          purpose,
          value.taxModes?.[purpose] === "automatic" ||
          value.taxModes?.[purpose] ===
            "disabled_by_owner" ||
          (purpose === "domainRegistration" &&
            value.taxModes?.[purpose] === null)
            ? value.taxModes[purpose]
            : "unconfigured"
        ])
      )
    ),
    taxPurposeAuthority:
      value.taxPurposeAuthority === true,
    automaticTaxActivation:
      value.automaticTaxActivation === true,
    taxAttestation:
      value.taxAttestation === true,
    code: safeToken(
      value.code ?? value.reason,
      value.ready === true
        ? "ready"
        : "stripe_not_ready"
    )
  });
}

export function assertApprovedStripeReady(
  composition,
  readiness
) {
  if (
    composition?.mode === "approved_live" &&
    readiness?.ready !== true
  ) {
    throw configurationError(
      "STRIPE_PRODUCTION_NOT_READY",
      "Approved Stripe composition failed exact provider readiness."
    );
  }
}

export const STRIPE_PRODUCTION_CONTRACT =
  Object.freeze({
    apiVersion: STRIPE_API_VERSION,
    modes: Object.freeze([...PRODUCTION_MODES]),
    hostedCapabilities: HOSTED_CAPABILITIES,
    domainCapabilities: DOMAIN_CAPABILITIES,
    alakazamCapabilities: ALAKAZAM_CAPABILITIES,
    readinessPurposes: STRIPE_READINESS_PURPOSES
  });
