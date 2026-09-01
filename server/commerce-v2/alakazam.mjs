import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";
import {
  DOWNLOAD_ALAKAZAM_CREDIT_MINOR
} from "./constants.mjs";

export const ALAKAZAM_CATALOG_SCHEMA =
  "sitesourcery.alakazam-private-tier-catalog.v1";
export const ALAKAZAM_CHANGE_QUOTE_SCHEMA =
  "sitesourcery.alakazam-tier-change-quote.v1";
export const ALAKAZAM_ENTITLEMENT_SCHEMA =
  "sitesourcery.alakazam-project-entitlement.v1";
export const ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA =
  "sitesourcery.alakazam-stripe-customer-purpose.v1";
export const ALAKAZAM_CUSTOMER_PROVISION_SCHEMA =
  "sitesourcery.alakazam-customer-provision.v1";
export const ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-customer/v1";
export const ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA =
  "sitesourcery.alakazam-stripe-purpose.v1";
export const ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA =
  "sitesourcery.alakazam-checkout-dispatch.v1";
export const ALAKAZAM_DOWNGRADE_APPLICATION_SCHEMA =
  "sitesourcery.alakazam-downgrade-application/v1";
export const ALAKAZAM_PROVIDER_METADATA_SCHEMA =
  "sitesourcery_alakazam_change_v1";
export const ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-payment/v1";
export const ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-downgrade-schedule/v1";
export const ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-subscription/v1";
export const ALAKAZAM_CATALOG_VERSION =
  "alakazam.2026-08-02.v1";
export const ALAKAZAM_TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";
export const ALAKAZAM_CANCELLATION_POLICY_VERSION =
  "alakazam-cancellation.2026-08-31.v1";
export const ALAKAZAM_CANCELLATION_POLICY =
  "cancel_anytime_period_end_no_fee_no_partial_refund_30_day_export";
export const ALAKAZAM_DOWNLOAD_CREDIT_MINOR =
  DOWNLOAD_ALAKAZAM_CREDIT_MINOR;

const CURRENCY = "USD";
const MONTH = "month";
const ACTIVE_CHANGE_STATUS = "active";
const CHANGE_QUOTE_TTL_MS = 30 * 60 * 1000;
const CUSTOMER_PROVISION_LEASE_MS = 2 * 60 * 1000;
const CHECKOUT_DISPATCH_LEASE_MS = 2 * 60 * 1000;
const DOWNGRADE_APPLICATION_LEASE_MS = 2 * 60 * 1000;
const STRIPE_IDS = Object.freeze({
  customer: /^cus_[A-Za-z0-9_]+$/u,
  price: /^price_[A-Za-z0-9_]+$/u,
  subscription: /^sub_[A-Za-z0-9_]+$/u,
  subscriptionItem: /^si_[A-Za-z0-9_]+$/u
});

const BASE_CAPABILITIES = Object.freeze([
  "download_accepted_project_version",
  "host_at_sitesourcery_me",
  "look_crystal",
  "look_hearth",
  "look_midnight",
  "publish_accepted_project_version"
]);

const EXPANDED_CAPABILITIES = Object.freeze([
  ...BASE_CAPABILITIES,
  "care_request",
  "expanded_fonts",
  "photo_header",
  "section_toggles",
  "version_history"
]);

const RICH_CAPABILITIES = Object.freeze([
  ...EXPANDED_CAPABILITIES,
  "border_controls",
  "cash_app_link",
  "extended_font_controls",
  "site_menu",
  "venmo_link"
]);

export const ALAKAZAM_TIER_DEFINITIONS = deepFreeze({
  alakazam_25: {
    tierId: "alakazam_25",
    rank: 1,
    name: "Alakazam 25",
    price: {
      amountMinor: 2500,
      currency: CURRENCY,
      billing: "recurring",
      interval: MONTH
    },
    capabilities: BASE_CAPABILITIES,
    limits: {
      careClass: "none",
      versionHistory: 0,
      fontControls: "base",
      borderControls: "base"
    },
    releaseBlockers: [
      "owner_tax_choice",
      "provider_price_readback",
      "cancellation_policy",
      "automatic_publication_proof",
      "owner_walkthrough"
    ]
  },
  alakazam_35: {
    tierId: "alakazam_35",
    rank: 2,
    name: "Alakazam 35",
    price: {
      amountMinor: 3500,
      currency: CURRENCY,
      billing: "recurring",
      interval: MONTH
    },
    capabilities: EXPANDED_CAPABILITIES,
    limits: {
      careClass: "modest",
      versionHistory: 3,
      fontControls: "expanded",
      borderControls: "base"
    },
    releaseBlockers: [
      "owner_tax_choice",
      "provider_price_readback",
      "cancellation_policy",
      "care_accounting_boundary",
      "automatic_publication_proof",
      "owner_walkthrough"
    ]
  },
  alakazam_50: {
    tierId: "alakazam_50",
    rank: 3,
    name: "Alakazam 50",
    price: {
      amountMinor: 5000,
      currency: CURRENCY,
      billing: "recurring",
      interval: MONTH
    },
    capabilities: RICH_CAPABILITIES,
    limits: {
      careClass: "more",
      versionHistory: 3,
      fontControls: "extended",
      borderControls: "extended"
    },
    releaseBlockers: [
      "owner_tax_choice",
      "provider_price_readback",
      "cancellation_policy",
      "care_accounting_boundary",
      "automatic_publication_proof",
      "owner_walkthrough"
    ]
  }
});

export const ALAKAZAM_TIER_IDS = Object.freeze(
  Object.keys(ALAKAZAM_TIER_DEFINITIONS)
);

const PRIVATE_CATALOG = deepFreeze({
  schema: ALAKAZAM_CATALOG_SCHEMA,
  catalogVersion: ALAKAZAM_CATALOG_VERSION,
  termsVersion: ALAKAZAM_TERMS_VERSION,
  visibility: "private",
  state: "held",
  providerEffectsAuthorized: false,
  product: {
    productId: "alakazam_hosting",
    name: "Alakazam",
    scope: "one_editor_project"
  },
  ladder: {
    downloadCreditMinor: ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
    upgradeRule: "fixed_target_minus_current_tier",
    downgradeRule: "renewal_boundary_no_refund_or_proration",
    premiumConfiguration: "preserved_when_inactive"
  },
  tiers: ALAKAZAM_TIER_IDS.map(
    (tierId) => ALAKAZAM_TIER_DEFINITIONS[tierId]
  )
});

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactTier(tierId) {
  const selected = requiredText(tierId, "tierId", 100);
  const tier = ALAKAZAM_TIER_DEFINITIONS[selected];
  invariant(
    Boolean(tier),
    "alakazam_tier_unavailable",
    "the Alakazam tier is unavailable",
    { status: 404 }
  );
  return tier;
}

function exactDownloadCredit(value) {
  if (value === null || value === undefined) return null;
  invariant(
    value &&
      typeof value === "object" &&
      value.state === "active" &&
      value.available === true &&
      value.amountMinor === ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
    "alakazam_credit_unavailable",
    "the project Download credit is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    kind: "download_purchase",
    sourceId: requiredText(
      value.entitlementId,
      "downloadCredit.entitlementId",
      200
    ),
    amountMinor: ALAKAZAM_DOWNLOAD_CREDIT_MINOR
  });
}

function exactSubscription(value) {
  if (value === null || value === undefined) return null;
  invariant(
    value && typeof value === "object",
    "invalid_input",
    "currentSubscription is invalid"
  );
  const tier = exactTier(value.tierId);
  invariant(
    value.status === ACTIVE_CHANGE_STATUS,
    "alakazam_change_unavailable",
    "resolve the current subscription payment state before changing tiers",
    { status: 409 }
  );
  invariant(
    value.pendingChange === null ||
      value.pendingChange === undefined,
    "alakazam_change_pending",
    "finish or cancel the existing tier change first",
    { status: 409 }
  );
  invariant(
    value.cancelAtPeriodEnd !== true,
    "alakazam_cancellation_pending",
    "cancel the pending subscription cancellation before changing tiers",
    { status: 409 }
  );
  const currentPeriodEndsAt = requiredIso(
    value.currentPeriodEndsAt,
    "currentSubscription.currentPeriodEndsAt"
  );
  return Object.freeze({
    subscriptionId: requiredText(
      value.subscriptionId,
      "currentSubscription.subscriptionId",
      200
    ),
    tier,
    revision: positiveInteger(
      value.revision,
      "currentSubscription.revision"
    ),
    currentPeriodEndsAt
  });
}

function quoteWindow(issuedAt, expiresAt) {
  const issued = requiredIso(issuedAt, "issuedAt");
  const expires = requiredIso(expiresAt, "expiresAt");
  invariant(
    Date.parse(expires) > Date.parse(issued) &&
      Date.parse(expires) - Date.parse(issued) <=
        CHANGE_QUOTE_TTL_MS,
    "invalid_input",
    "the Alakazam quote window is invalid"
  );
  return { issuedAt: issued, expiresAt: expires };
}

function publicTier(tier) {
  return {
    tierId: tier.tierId,
    rank: tier.rank,
    name: tier.name,
    price: clone(tier.price),
    capabilities: clone(tier.capabilities),
    limits: clone(tier.limits)
  };
}

function quoteDisclosure({
  changeKind,
  current,
  target,
  dueNowMinor,
  appliedValue,
  effectiveAt,
  taxMode
}) {
  const fixedTax = taxMode === "disabled_by_owner";
  return {
    schema: "sitesourcery.alakazam-tier-change-disclosure.v1",
    changeKind,
    currentTierId: current?.tier.tierId ?? null,
    targetTierId: target.tierId,
    dueNow: {
      subtotalMinor: dueNowMinor,
      currency: CURRENCY,
      taxMinor: fixedTax ? 0 : null,
      totalMinor: fixedTax ? dueNowMinor : null,
      taxState: taxMode
    },
    appliedValue,
    effectiveAt,
    renewal: {
      tierId: target.tierId,
      amountMinor: target.price.amountMinor,
      currency: CURRENCY,
      interval: MONTH
    },
    downgrade: {
      cashRefundMinor: 0,
      providerProration: false,
      currentTierKeptThroughPeriod:
        changeKind === "downgrade"
    },
    premiumConfiguration: "preserved_when_inactive",
    cancellationPolicy: ALAKAZAM_CANCELLATION_POLICY,
    cancellationPolicyVersion:
      ALAKAZAM_CANCELLATION_POLICY_VERSION
  };
}

export function getPrivateAlakazamCatalog() {
  return deepFreeze(clone(PRIVATE_CATALOG));
}

export function getBrowserSafeAlakazamCatalog() {
  return deepFreeze({
    schema: "sitesourcery.alakazam-public-tier-catalog.v1",
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    state: "held",
    product: clone(PRIVATE_CATALOG.product),
    ladder: clone(PRIVATE_CATALOG.ladder),
    tiers: PRIVATE_CATALOG.tiers.map(publicTier)
  });
}

export function resolveAlakazamTier(tierId) {
  return deepFreeze(clone(exactTier(tierId)));
}

export function createAlakazamCustomerProvision({
  tenantId,
  customerId,
  projectId,
  quoteId,
  provisionId,
  acceptedDisclosureDigest,
  quoteDigest,
  claimedAt
}) {
  const identity = {
    tenantId: requiredText(tenantId, "tenantId", 36),
    customerId: requiredText(
      customerId,
      "customerId",
      36
    ),
    projectId: requiredText(projectId, "projectId", 36),
    quoteId: requiredText(quoteId, "quoteId", 36),
    provisionId: requiredText(
      provisionId,
      "provisionId",
      36
    )
  };
  requiredDigest(
    acceptedDisclosureDigest,
    "acceptedDisclosureDigest"
  );
  requiredDigest(
    quoteDigest,
    "quoteDigest"
  );
  const disclosureDigest = acceptedDisclosureDigest;
  const selectedQuoteDigest = quoteDigest;
  const createdAt = requiredIso(claimedAt, "claimedAt");
  const purpose = {
    acceptedDisclosureDigest: disclosureDigest,
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    customerId: identity.customerId,
    organizationId: identity.tenantId,
    projectId: identity.projectId,
    provisionId: identity.provisionId,
    quoteDigest: selectedQuoteDigest,
    quoteId: identity.quoteId,
    schema: ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA,
    termsVersion: ALAKAZAM_TERMS_VERSION
  };
  const purposeDigest = digest(purpose);
  return deepFreeze({
    schema: ALAKAZAM_CUSTOMER_PROVISION_SCHEMA,
    state: "reserved",
    provider: "stripe",
    ...identity,
    idempotencyKey:
      `alakazam:customer:${identity.provisionId}`,
    purpose,
    purposeDigest,
    claimedAt: createdAt,
    leaseExpiresAt: new Date(
      Date.parse(createdAt) +
        CUSTOMER_PROVISION_LEASE_MS
    ).toISOString()
  });
}

export function createAlakazamCheckoutDispatch({
  dispatchId,
  tenantId,
  customerId,
  projectId,
  quoteId,
  stripeCustomerId,
  acceptedDisclosureDigest,
  quoteDigest,
  changeKind,
  currentSubscription = null,
  targetTierId,
  dueNowSubtotalMinor,
  taxMode,
  downloadCredit = null,
  claimedAt
}) {
  const identity = {
    dispatchId: requiredText(
      dispatchId,
      "dispatchId",
      36
    ),
    tenantId: requiredText(tenantId, "tenantId", 36),
    customerId: requiredText(
      customerId,
      "customerId",
      36
    ),
    projectId: requiredText(projectId, "projectId", 36),
    quoteId: requiredText(quoteId, "quoteId", 36),
    stripeCustomerId: requiredText(
      stripeCustomerId,
      "stripeCustomerId",
      255
    )
  };
  invariant(
    STRIPE_IDS.customer.test(identity.stripeCustomerId),
    "invalid_input",
    "stripeCustomerId is invalid"
  );
  requiredDigest(
    acceptedDisclosureDigest,
    "acceptedDisclosureDigest"
  );
  requiredDigest(quoteDigest, "quoteDigest");
  invariant(
    changeKind === "start" || changeKind === "upgrade",
    "invalid_input",
    "Alakazam Checkout supports only start or upgrade"
  );
  invariant(
    taxMode === "automatic" ||
      taxMode === "disabled_by_owner",
    "invalid_input",
    "taxMode is invalid"
  );
  const target = exactTier(targetTierId);
  positiveInteger(
    dueNowSubtotalMinor,
    "dueNowSubtotalMinor"
  );
  let current = null;
  let credit = null;

  if (changeKind === "start") {
    invariant(
      currentSubscription === null,
      "invalid_input",
      "an Alakazam start cannot bind a subscription"
    );
    if (downloadCredit !== null) {
      invariant(
        downloadCredit &&
          typeof downloadCredit === "object" &&
          downloadCredit.amountMinor ===
            ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
        "invalid_input",
        "Alakazam Download credit must be exactly $20"
      );
      credit = {
        entitlementId: requiredText(
          downloadCredit.entitlementId,
          "downloadCredit.entitlementId",
          200
        ),
        amountMinor: ALAKAZAM_DOWNLOAD_CREDIT_MINOR
      };
    }
    invariant(
      dueNowSubtotalMinor ===
        target.price.amountMinor -
          (credit?.amountMinor ?? 0),
      "invalid_input",
      "Alakazam start subtotal is invalid"
    );
  } else {
    invariant(
      downloadCredit === null &&
        currentSubscription &&
        typeof currentSubscription === "object",
      "invalid_input",
      "an Alakazam upgrade requires one current subscription"
    );
    const currentTier = exactTier(
      currentSubscription.tierId
    );
    const startsAt = requiredIso(
      currentSubscription.currentPeriodStartsAt,
      "currentSubscription.currentPeriodStartsAt"
    );
    const endsAt = requiredIso(
      currentSubscription.currentPeriodEndsAt,
      "currentSubscription.currentPeriodEndsAt"
    );
    requiredDigest(
      currentSubscription.providerFactsDigest,
      "currentSubscription.providerFactsDigest"
    );
    invariant(
      currentSubscription.amountMinor ===
        currentTier.price.amountMinor &&
        positiveInteger(
          currentSubscription.revision,
          "currentSubscription.revision"
        ) > 0 &&
        STRIPE_IDS.subscription.test(
          currentSubscription.stripeSubscriptionId
        ) &&
        STRIPE_IDS.subscriptionItem.test(
          currentSubscription.stripeSubscriptionItemId
        ) &&
        STRIPE_IDS.price.test(
          currentSubscription.stripePriceId
        ) &&
        Date.parse(endsAt) > Date.parse(startsAt) &&
        target.rank > currentTier.rank &&
        dueNowSubtotalMinor ===
          target.price.amountMinor -
            currentTier.price.amountMinor,
      "invalid_input",
      "Alakazam upgrade subscription evidence is invalid"
    );
    current = {
      localSubscriptionId: requiredText(
        currentSubscription.localSubscriptionId,
        "currentSubscription.localSubscriptionId",
        200
      ),
      revision: currentSubscription.revision,
      tierId: currentTier.tierId,
      amountMinor: currentTier.price.amountMinor,
      stripeSubscriptionId:
        currentSubscription.stripeSubscriptionId,
      stripeSubscriptionItemId:
        currentSubscription.stripeSubscriptionItemId,
      stripePriceId: currentSubscription.stripePriceId,
      currentPeriodStartsAt: startsAt,
      currentPeriodEndsAt: endsAt,
      providerFactsDigest:
        currentSubscription.providerFactsDigest
    };
  }

  const createdAt = requiredIso(claimedAt, "claimedAt");
  const purpose = {
    schema: ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA,
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    organizationId: identity.tenantId,
    customerId: identity.customerId,
    projectId: identity.projectId,
    quoteId: identity.quoteId,
    stripeCustomerId: identity.stripeCustomerId,
    acceptedDisclosureDigest,
    quoteDigest,
    changeKind,
    currentSubscription: current,
    targetTierId: target.tierId,
    targetAmountMinor: target.price.amountMinor,
    dueNowSubtotalMinor,
    nextRenewalAmountMinor: target.price.amountMinor,
    currency: CURRENCY,
    taxMode,
    downloadCredit: credit
  };
  const purposeDigest = digest(purpose);
  return deepFreeze({
    schema: ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
    state: "reserved",
    provider: "stripe",
    mode:
      changeKind === "start"
        ? "subscription_start"
        : "upgrade_difference",
    ...identity,
    idempotencyKey:
      `alakazam:${changeKind}:checkout:${identity.dispatchId}`,
    purpose,
    purposeDigest,
    expectedSubtotalMinor: dueNowSubtotalMinor,
    expectedCreditMinor: credit?.amountMinor ?? 0,
    currency: CURRENCY,
    claimedAt: createdAt,
    leaseExpiresAt: new Date(
      Date.parse(createdAt) +
        CHECKOUT_DISPATCH_LEASE_MS
    ).toISOString()
  });
}

export function createAlakazamDowngradeApplication({
  scheduleId,
  tenantId,
  customerId,
  projectId,
  quoteId,
  stripeCustomerId,
  acceptedDisclosureDigest,
  quoteDigest,
  currentSubscription,
  targetTierId,
  taxMode,
  claimedAt
}) {
  const identity = {
    scheduleId: requiredText(
      scheduleId,
      "scheduleId",
      36
    ),
    tenantId: requiredText(tenantId, "tenantId", 36),
    customerId: requiredText(
      customerId,
      "customerId",
      36
    ),
    projectId: requiredText(projectId, "projectId", 36),
    quoteId: requiredText(quoteId, "quoteId", 36),
    stripeCustomerId: requiredText(
      stripeCustomerId,
      "stripeCustomerId",
      255
    )
  };
  invariant(
    STRIPE_IDS.customer.test(identity.stripeCustomerId),
    "invalid_input",
    "stripeCustomerId is invalid"
  );
  requiredDigest(
    acceptedDisclosureDigest,
    "acceptedDisclosureDigest"
  );
  requiredDigest(quoteDigest, "quoteDigest");
  invariant(
    taxMode === "automatic" ||
      taxMode === "disabled_by_owner",
    "invalid_input",
    "taxMode is invalid"
  );
  invariant(
    currentSubscription &&
      typeof currentSubscription === "object" &&
      !Array.isArray(currentSubscription),
    "invalid_input",
    "an Alakazam downgrade requires one current subscription"
  );
  const currentTier = exactTier(
    currentSubscription.tierId
  );
  const target = exactTier(targetTierId);
  const startsAt = requiredIso(
    currentSubscription.currentPeriodStartsAt,
    "currentSubscription.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    currentSubscription.currentPeriodEndsAt,
    "currentSubscription.currentPeriodEndsAt"
  );
  requiredDigest(
    currentSubscription.providerFactsDigest,
    "currentSubscription.providerFactsDigest"
  );
  invariant(
    currentSubscription.amountMinor ===
        currentTier.price.amountMinor &&
      positiveInteger(
        currentSubscription.revision,
        "currentSubscription.revision"
      ) > 0 &&
      STRIPE_IDS.subscription.test(
        currentSubscription.stripeSubscriptionId
      ) &&
      STRIPE_IDS.subscriptionItem.test(
        currentSubscription.stripeSubscriptionItemId
      ) &&
      STRIPE_IDS.price.test(
        currentSubscription.stripePriceId
      ) &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      target.rank < currentTier.rank,
    "invalid_input",
    "Alakazam downgrade subscription evidence is invalid"
  );
  const current = {
    localSubscriptionId: requiredText(
      currentSubscription.localSubscriptionId,
      "currentSubscription.localSubscriptionId",
      200
    ),
    revision: currentSubscription.revision,
    tierId: currentTier.tierId,
    amountMinor: currentTier.price.amountMinor,
    stripeSubscriptionId:
      currentSubscription.stripeSubscriptionId,
    stripeSubscriptionItemId:
      currentSubscription.stripeSubscriptionItemId,
    stripePriceId: currentSubscription.stripePriceId,
    currentPeriodStartsAt: startsAt,
    currentPeriodEndsAt: endsAt,
    providerFactsDigest:
      currentSubscription.providerFactsDigest
  };
  const createdAt = requiredIso(claimedAt, "claimedAt");
  const purpose = {
    schema: ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA,
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    organizationId: identity.tenantId,
    customerId: identity.customerId,
    projectId: identity.projectId,
    quoteId: identity.quoteId,
    stripeCustomerId: identity.stripeCustomerId,
    acceptedDisclosureDigest,
    quoteDigest,
    changeKind: "downgrade",
    currentSubscription: current,
    targetTierId: target.tierId,
    targetAmountMinor: target.price.amountMinor,
    dueNowSubtotalMinor: 0,
    nextRenewalAmountMinor: target.price.amountMinor,
    currency: CURRENCY,
    taxMode,
    downloadCredit: null
  };
  const purposeDigest = digest(purpose);
  return deepFreeze({
    schema: ALAKAZAM_DOWNGRADE_APPLICATION_SCHEMA,
    state: "reserved",
    provider: "stripe",
    ...identity,
    subscriptionId: current.localSubscriptionId,
    idempotencyKey:
      `alakazam:downgrade:schedule:${identity.scheduleId}`,
    purpose,
    purposeDigest,
    effectiveAt: current.currentPeriodEndsAt,
    claimedAt: createdAt,
    leaseExpiresAt: new Date(
      Date.parse(createdAt) +
        DOWNGRADE_APPLICATION_LEASE_MS
    ).toISOString()
  });
}

export function createAlakazamProviderMetadata({
  purpose,
  purposeDigest
}) {
  requiredDigest(purposeDigest, "purposeDigest");
  invariant(
    purpose &&
      typeof purpose === "object" &&
      !Array.isArray(purpose) &&
      purpose.schema === ALAKAZAM_CHECKOUT_PURPOSE_SCHEMA &&
      purpose.catalogVersion === ALAKAZAM_CATALOG_VERSION &&
      purpose.termsVersion === ALAKAZAM_TERMS_VERSION &&
      ["start", "upgrade", "downgrade"].includes(
        purpose.changeKind
      ) &&
      digest(purpose) === purposeDigest,
    "invalid_input",
    "Alakazam provider metadata requires one exact purpose"
  );
  const metadata = {
    schema: ALAKAZAM_PROVIDER_METADATA_SCHEMA,
    organization_id: requiredText(
      purpose.organizationId,
      "purpose.organizationId",
      36
    ),
    customer_id: requiredText(
      purpose.customerId,
      "purpose.customerId",
      36
    ),
    project_id: requiredText(
      purpose.projectId,
      "purpose.projectId",
      36
    ),
    quote_id: requiredText(
      purpose.quoteId,
      "purpose.quoteId",
      36
    ),
    change_kind: purpose.changeKind,
    target_tier_id: exactTier(
      purpose.targetTierId
    ).tierId,
    accepted_disclosure_digest: requiredDigest(
      purpose.acceptedDisclosureDigest,
      "purpose.acceptedDisclosureDigest"
    ),
    quote_digest: requiredDigest(
      purpose.quoteDigest,
      "purpose.quoteDigest"
    ),
    catalog_version: purpose.catalogVersion,
    terms_version: purpose.termsVersion,
    tax_mode: purpose.taxMode,
    purpose_digest: purposeDigest
  };
  if (purpose.changeKind !== "start") {
    invariant(
      purpose.currentSubscription &&
        purpose.downloadCredit === null,
      "invalid_input",
      "Alakazam tier-change metadata lacks its current subscription"
    );
    metadata.prior_tier_id = exactTier(
      purpose.currentSubscription.tierId
    ).tierId;
    metadata.local_subscription_id = requiredText(
      purpose.currentSubscription.localSubscriptionId,
      "purpose.currentSubscription.localSubscriptionId",
      200
    );
    metadata.subscription_revision = String(
      positiveInteger(
        purpose.currentSubscription.revision,
        "purpose.currentSubscription.revision"
      )
    );
  } else {
    invariant(
      purpose.currentSubscription === null,
      "invalid_input",
      "Alakazam start metadata cannot bind a subscription"
    );
    if (purpose.downloadCredit !== null) {
      invariant(
        purpose.downloadCredit?.amountMinor ===
          ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
        "invalid_input",
        "Alakazam start metadata has invalid Download credit"
      );
      metadata.download_entitlement_id = requiredText(
        purpose.downloadCredit.entitlementId,
        "purpose.downloadCredit.entitlementId",
        200
      );
    }
  }
  return deepFreeze(metadata);
}

export function quoteAlakazamChange({
  quoteId,
  tenantId,
  customerId,
  projectId,
  targetTierId,
  currentSubscription = null,
  downloadCredit = null,
  issuedAt,
  expiresAt,
  providerEffectsAuthorized = false,
  taxMode = "release_configuration_required"
}) {
  invariant(
    typeof providerEffectsAuthorized === "boolean" &&
      (
        providerEffectsAuthorized
          ? ["automatic", "disabled_by_owner"].includes(
              taxMode
            )
          : taxMode ===
              "release_configuration_required"
      ),
    "invalid_input",
    "the Alakazam quote release configuration is invalid"
  );
  const identity = {
    quoteId: requiredText(quoteId, "quoteId", 200),
    tenantId: requiredText(tenantId, "tenantId", 200),
    customerId: requiredText(customerId, "customerId", 200),
    projectId: requiredText(projectId, "projectId", 200)
  };
  const target = exactTier(targetTierId);
  const current = exactSubscription(currentSubscription);
  const window = quoteWindow(issuedAt, expiresAt);
  invariant(
    !current ||
      Date.parse(current.currentPeriodEndsAt) >
        Date.parse(window.issuedAt),
    "alakazam_change_unavailable",
    "the current paid subscription period has ended",
    { status: 409 }
  );
  let changeKind;
  let dueNowMinor;
  let effectiveAt;
  let appliedValue;

  if (!current) {
    changeKind = "start";
    const credit = exactDownloadCredit(downloadCredit);
    appliedValue = credit ?? {
      kind: "none",
      sourceId: null,
      amountMinor: 0
    };
    dueNowMinor =
      target.price.amountMinor -
      appliedValue.amountMinor;
    effectiveAt =
      "after_payment_and_provider_confirmation";
  } else {
    invariant(
      downloadCredit === null ||
        downloadCredit === undefined,
      "alakazam_credit_not_applicable",
      "Download credit applies only when the first subscription starts",
      { status: 409 }
    );
    invariant(
      current.tier.tierId !== target.tierId,
      "alakazam_tier_unchanged",
      "the project already has that Alakazam tier",
      { status: 409 }
    );
    if (target.rank > current.tier.rank) {
      changeKind = "upgrade";
      appliedValue = {
        kind: "current_paid_tier",
        sourceId: current.subscriptionId,
        amountMinor: current.tier.price.amountMinor
      };
      dueNowMinor =
        target.price.amountMinor -
        current.tier.price.amountMinor;
      effectiveAt =
        "after_payment_and_provider_confirmation";
    } else {
      changeKind = "downgrade";
      appliedValue = {
        kind: "none",
        sourceId: null,
        amountMinor: 0
      };
      dueNowMinor = 0;
      effectiveAt = current.currentPeriodEndsAt;
    }
  }

  invariant(
    Number.isSafeInteger(dueNowMinor) &&
      dueNowMinor >= 0,
    "alakazam_change_invalid",
    "the Alakazam tier difference is invalid",
    { status: 500 }
  );

  const disclosure = quoteDisclosure({
    changeKind,
    current,
    target,
    dueNowMinor,
    appliedValue,
    effectiveAt,
    taxMode
  });
  const quote = {
    schema: ALAKAZAM_CHANGE_QUOTE_SCHEMA,
    ...identity,
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    state: providerEffectsAuthorized
      ? "quoted"
      : "held",
    providerEffectsAuthorized,
    changeKind,
    currentSubscriptionBinding: current
      ? {
          subscriptionId: current.subscriptionId,
          tierId: current.tier.tierId,
          revision: current.revision,
          currentPeriodEndsAt:
            current.currentPeriodEndsAt
        }
      : null,
    targetTier: publicTier(target),
    dueNow: clone(disclosure.dueNow),
    appliedValue: clone(appliedValue),
    effectiveAt,
    nextRenewal: clone(disclosure.renewal),
    noMidPeriodRefundOrProration:
      changeKind === "downgrade",
    premiumConfiguration:
      disclosure.premiumConfiguration,
    disclosure,
    ...window
  };
  quote.disclosureDigest = digest(disclosure);
  quote.quoteDigest = digest(quote);
  return deepFreeze(quote);
}

function effectiveTier(subscription, now) {
  invariant(
    subscription && typeof subscription === "object",
    "alakazam_entitlement_unavailable",
    "the Alakazam entitlement is unavailable",
    { status: 404 }
  );
  const observedAt = requiredIso(now, "now");
  const status = requiredText(
    subscription.status,
    "subscription.status",
    50
  );
  invariant(
    status === "active" || status === "grace",
    "alakazam_entitlement_unavailable",
    "the Alakazam entitlement is unavailable",
    { status: 404 }
  );
  if (status === "grace") {
    invariant(
      subscription.graceEndsAt &&
        Date.parse(
          requiredIso(
            subscription.graceEndsAt,
            "subscription.graceEndsAt"
          )
        ) > Date.parse(observedAt),
      "alakazam_entitlement_unavailable",
      "the Alakazam payment grace period has ended",
      { status: 404 }
    );
  }
  const periodEnd = requiredIso(
    subscription.currentPeriodEndsAt,
    "subscription.currentPeriodEndsAt"
  );
  invariant(
    subscription.cancelAtPeriodEnd !== true ||
      Date.parse(observedAt) < Date.parse(periodEnd),
    "alakazam_entitlement_unavailable",
    "the Alakazam paid period has ended",
    { status: 404 }
  );
  const currentTier = exactTier(subscription.tierId);
  let tierId = currentTier.tierId;
  if (
    subscription.scheduledTierId &&
    (() => {
      const scheduledTier = exactTier(
        subscription.scheduledTierId
      );
      const scheduledEffectiveAt = requiredIso(
        subscription.scheduledEffectiveAt,
        "subscription.scheduledEffectiveAt"
      );
      invariant(
        scheduledTier.rank < currentTier.rank &&
          scheduledEffectiveAt === periodEnd,
        "alakazam_entitlement_unavailable",
        "the scheduled Alakazam downgrade is invalid",
        { status: 404 }
      );
      return (
        Date.parse(scheduledEffectiveAt) <=
        Date.parse(observedAt)
      );
    })()
  ) {
    tierId = subscription.scheduledTierId;
  }
  return exactTier(tierId);
}

export function authorizeAlakazamCapability(
  subscription,
  { capability, now }
) {
  const selectedCapability = requiredText(
    capability,
    "capability",
    100
  );
  const tier = effectiveTier(subscription, now);
  invariant(
    tier.capabilities.includes(selectedCapability),
    "alakazam_capability_unavailable",
    "the active Alakazam tier does not include that capability",
    { status: 404 }
  );
  return deepFreeze({
    schema: ALAKAZAM_ENTITLEMENT_SCHEMA,
    subscriptionId: requiredText(
      subscription.subscriptionId,
      "subscription.subscriptionId",
      200
    ),
    projectId: requiredText(
      subscription.projectId,
      "subscription.projectId",
      200
    ),
    tierId: tier.tierId,
    capability: selectedCapability,
    limits: clone(tier.limits),
    authorizedAt: requiredIso(now, "now")
  });
}
