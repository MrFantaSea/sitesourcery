import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
  ALAKAZAM_CHANGE_QUOTE_SCHEMA,
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_CUSTOMER_PROVISION_SCHEMA,
  ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA,
  ALAKAZAM_TERMS_VERSION,
  createAlakazamCheckoutDispatch,
  quoteAlakazamChange,
  resolveAlakazamTier
} from "./alakazam.mjs";
import {
  clone,
  CommerceV2Error,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_BILLING_RELEASE_SCHEMA =
  "sitesourcery.alakazam-billing-release.v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const QUOTE_TTL_MS = 30 * 60 * 1000;
const STRIPE_CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}
function exactKeys(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message
  );
  return value;
}

export function createAlakazamBillingRelease({
  approved = false,
  taxMode = null
} = {}) {
  invariant(
    typeof approved === "boolean" &&
      (
        approved
          ? TAX_MODES.has(taxMode)
          : taxMode === null
      ),
    "invalid_configuration",
    "Alakazam billing release configuration is invalid",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_BILLING_RELEASE_SCHEMA,
    approved,
    provider: "stripe",
    productId: "alakazam_hosting",
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    termsVersion: ALAKAZAM_TERMS_VERSION,
    taxMode
  });
}

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value &&
      JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam billing release does not match the reviewed tier contract",
    { status: 500 }
  );
  return expected;
}

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function validatePorts(repository, provider, clock) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "claimCustomerProvision",
        "claimCheckoutDispatch",
        "confirmCheckoutDispatch",
        "confirmCustomerProvision",
        "createQuote",
        "failCheckoutDispatch",
        "markCheckoutDispatchUnknown",
        "markCustomerProvisionAmbiguous",
        "releaseCustomerProvision"
      ]
    ],
    [
      "provider",
      provider,
      [
        "createAlakazamCustomer",
        "createAlakazamStartCheckout",
        "createAlakazamUpgradeCheckout",
        "readiness"
      ]
    ],
    ["clock", clock, ["now"]]
  ]) {
    invariant(
      value &&
        methods.every(
          (method) =>
            typeof value[method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return { repository, provider, clock };
}

function exactQuoteInput(value) {
  exactKeys(
    value,
    [
      "customerId",
      "projectId",
      "quoteId",
      "targetTierId",
      "tenantId"
    ],
    "invalid_input",
    "Alakazam quote accepts only project, target tier, and idempotency identity"
  );
  const target = resolveAlakazamTier(
    value.targetTierId
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
    targetTierId: target.tierId
  });
}

function exactCustomerInput(value) {
  exactKeys(
    value,
    [
      "acceptedDisclosureDigest",
      "customerId",
      "projectId",
      "provisionId",
      "quoteId",
      "siteSetupDigest",
      "tenantId"
    ],
    "invalid_input",
    "Alakazam Customer preparation accepts only quote, accepted disclosure, and idempotency identity"
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
    acceptedDisclosureDigest: requiredDigest(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest"
    ),
    siteSetupDigest:
      value.siteSetupDigest === null
        ? null
        : requiredDigest(
            value.siteSetupDigest,
            "siteSetupDigest"
          )
  });
}

function exactCheckoutInput(value) {
  exactKeys(
    value,
    [
      "acceptedDisclosureDigest",
      "commandId",
      "customerId",
      "projectId",
      "quoteId",
      "siteSetupDigest",
      "tenantId"
    ],
    "invalid_input",
    "Alakazam Checkout accepts only quote, accepted disclosure, and idempotency identity"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(
      value.customerId,
      "customerId"
    ),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    commandId: exactUuid(value.commandId, "commandId"),
    acceptedDisclosureDigest: requiredDigest(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest"
    ),
    siteSetupDigest:
      value.siteSetupDigest === null
        ? null
        : requiredDigest(
            value.siteSetupDigest,
            "siteSetupDigest"
          )
  });
}

function exactCustomerClaim(value, input, claimedAt) {
  exactKeys(
    value,
    ["provider", "provision", "status"],
    "repository_conflict",
    "the durable Alakazam Customer claim is invalid"
  );
  const provision = value.provision;
  exactKeys(
    provision,
    [
      "claimedAt",
      "customerId",
      "idempotencyKey",
      "leaseExpiresAt",
      "projectId",
      "provider",
      "provisionId",
      "purpose",
      "purposeDigest",
      "quoteId",
      "schema",
      "state",
      "tenantId"
    ],
    "repository_conflict",
    "the durable Alakazam Customer reservation is invalid"
  );
  requiredDigest(
    provision.purposeDigest,
    "customerProvision.purposeDigest"
  );
  exactKeys(
    provision.purpose,
    [
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
    ],
    "repository_conflict",
    "the durable Alakazam Customer purpose is invalid"
  );
  requiredDigest(
    provision.purpose.acceptedDisclosureDigest,
    "customerProvision.acceptedDisclosureDigest"
  );
  requiredDigest(
    provision.purpose.quoteDigest,
    "customerProvision.quoteDigest"
  );
  const leaseExpiresAt = requiredIso(
    provision.leaseExpiresAt,
    "customerProvision.leaseExpiresAt"
  );
  invariant(
    value.status === "create" &&
      value.provider === "stripe" &&
      provision.schema ===
        ALAKAZAM_CUSTOMER_PROVISION_SCHEMA &&
      provision.state === "reserved" &&
      provision.provider === "stripe" &&
      provision.tenantId === input.tenantId &&
      provision.customerId === input.customerId &&
      provision.projectId === input.projectId &&
      provision.quoteId === input.quoteId &&
      provision.provisionId === input.provisionId &&
      provision.claimedAt === claimedAt &&
      provision.idempotencyKey ===
        `alakazam:customer:${input.provisionId}` &&
      provision.purpose.schema ===
        ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA &&
      provision.purpose.catalogVersion ===
        ALAKAZAM_CATALOG_VERSION &&
      provision.purpose.termsVersion ===
        ALAKAZAM_TERMS_VERSION &&
      provision.purpose.organizationId ===
        input.tenantId &&
      provision.purpose.customerId ===
        input.customerId &&
      provision.purpose.projectId === input.projectId &&
      provision.purpose.quoteId === input.quoteId &&
      provision.purpose.provisionId ===
        input.provisionId &&
      digest(provision.purpose) ===
        provision.purposeDigest &&
      Date.parse(leaseExpiresAt) -
        Date.parse(claimedAt) === 2 * 60 * 1000,
    "repository_conflict",
    "the durable Alakazam Customer reservation changed",
    { status: 500 }
  );
  return deepFreeze(clone(provision));
}

function exactCustomerProviderFacts(value, provision) {
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
    "stripe_alakazam_customer_mismatch",
    "Stripe did not return exact Alakazam Customer evidence"
  );
  const facts = {
    schema: value.schema,
    stripeCustomerId: value.stripeCustomerId,
    organizationId: value.organizationId,
    customerId: value.customerId,
    projectId: value.projectId,
    quoteId: value.quoteId,
    provisionId: value.provisionId,
    providerCreatedAt: requiredIso(
      value.providerCreatedAt,
      "providerFacts.providerCreatedAt"
    ),
    purposeDigest: value.purposeDigest
  };
  requiredDigest(
    value.providerFactsDigest,
    "providerFacts.providerFactsDigest"
  );
  invariant(
    value.schema ===
      ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA &&
      STRIPE_CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.organizationId === provision.tenantId &&
      value.customerId === provision.customerId &&
      value.projectId === provision.projectId &&
      value.quoteId === provision.quoteId &&
      value.provisionId === provision.provisionId &&
      value.purposeDigest === provision.purposeDigest &&
      digest(facts) === value.providerFactsDigest,
    "stripe_alakazam_customer_mismatch",
    "Stripe did not return exact Alakazam Customer evidence",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function customerReference(provision) {
  return Object.freeze({
    tenantId: provision.tenantId,
    customerId: provision.customerId,
    projectId: provision.projectId,
    quoteId: provision.quoteId,
    provisionId: provision.provisionId,
    purposeDigest: provision.purposeDigest
  });
}

function exactCustomerBinding(
  value,
  {
    provisionId = undefined,
    stripeCustomerId = undefined
  } = {}
) {
  exactKeys(
    value,
    [
      "provider",
      "provisionId",
      "status",
      "stripeCustomerId"
    ],
    "repository_conflict",
    "the Stripe Customer binding is invalid"
  );
  invariant(
    value.status === "bound" &&
      value.provider === "stripe" &&
      STRIPE_CUSTOMER_ID.test(value.stripeCustomerId) &&
      (
        value.provisionId === null ||
        UUID.test(value.provisionId)
      ) &&
      (
        provisionId === undefined ||
        value.provisionId === provisionId
      ) &&
      (
        stripeCustomerId === undefined ||
        value.stripeCustomerId === stripeCustomerId
      ),
    "repository_conflict",
    "the Stripe Customer binding is invalid",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function customerReconciliationError(code) {
  return new CommerceV2Error(
    "alakazam_customer_reconciliation_required",
    "Alakazam Customer setup needs reconciliation before another attempt. Nothing was charged.",
    { status: 409, details: { code } }
  );
}

function exactCheckoutClaim(
  value,
  input,
  binding,
  claimedAt
) {
  exactKeys(
    value,
    ["dispatch", "provider", "status"],
    "repository_conflict",
    "the durable Alakazam Checkout claim is invalid"
  );
  const dispatch = value.dispatch;
  exactKeys(
    dispatch,
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
    "repository_conflict",
    "the durable Alakazam Checkout reservation is invalid"
  );
  requiredDigest(
    dispatch.purposeDigest,
    "checkoutDispatch.purposeDigest"
  );
  let expected;
  try {
    expected = createAlakazamCheckoutDispatch({
      dispatchId: input.commandId,
      tenantId: input.tenantId,
      customerId: input.customerId,
      projectId: input.projectId,
      quoteId: input.quoteId,
      stripeCustomerId: binding.stripeCustomerId,
      acceptedDisclosureDigest:
        dispatch.purpose.acceptedDisclosureDigest,
      quoteDigest: dispatch.purpose.quoteDigest,
      changeKind: dispatch.purpose.changeKind,
      currentSubscription:
        dispatch.purpose.currentSubscription,
      targetTierId: dispatch.purpose.targetTierId,
      dueNowSubtotalMinor:
        dispatch.purpose.dueNowSubtotalMinor,
      taxMode: dispatch.purpose.taxMode,
      downloadCredit: dispatch.purpose.downloadCredit,
      claimedAt
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
    value.status === "create" &&
      value.provider === "stripe" &&
      dispatch.schema ===
        ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      digest(dispatch) === digest(expected),
    "repository_conflict",
    "the durable Alakazam Checkout reservation changed",
    { status: 500 }
  );
  return deepFreeze(clone(dispatch));
}

function exactCheckoutUrl(value) {
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
      "stripe_alakazam_checkout_response_invalid",
      "Stripe returned an invalid Checkout destination",
      { status: 502 }
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "stripe_alakazam_checkout_response_invalid",
    "Stripe returned an invalid Checkout destination",
    { status: 502 }
  );
  return parsed.toString();
}

function exactCheckoutProviderResult(value) {
  exactKeys(
    value,
    ["checkoutId", "expiresAt", "url"],
    "stripe_alakazam_checkout_response_invalid",
    "Stripe returned invalid Alakazam Checkout evidence"
  );
  const checkoutId = requiredText(
    value.checkoutId,
    "checkout.checkoutId",
    255
  );
  invariant(
    /^cs_[A-Za-z0-9_]+$/u.test(checkoutId),
    "stripe_alakazam_checkout_response_invalid",
    "Stripe returned invalid Alakazam Checkout evidence",
    { status: 502 }
  );
  return deepFreeze({
    checkoutId,
    url: exactCheckoutUrl(value.url),
    expiresAt: requiredIso(
      value.expiresAt,
      "checkout.expiresAt"
    )
  });
}

function exactCheckoutReady(value, expected = {}) {
  exactKeys(
    value,
    [
      "checkout",
      "dispatchId",
      "projectId",
      "provider",
      "purposeDigest",
      "quoteId",
      "status"
    ],
    "repository_conflict",
    "the durable Alakazam Checkout result is invalid"
  );
  requiredDigest(
    value.purposeDigest,
    "checkout.purposeDigest"
  );
  const checkout = exactCheckoutProviderResult(value.checkout);
  invariant(
    value.status === "ready" &&
      value.provider === "stripe" &&
      UUID.test(value.dispatchId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.quoteId) &&
      (
        expected.dispatchId === undefined ||
        value.dispatchId === expected.dispatchId
      ) &&
      (
        expected.projectId === undefined ||
        value.projectId === expected.projectId
      ) &&
      (
        expected.quoteId === undefined ||
        value.quoteId === expected.quoteId
      ) &&
      (
        expected.purposeDigest === undefined ||
        value.purposeDigest === expected.purposeDigest
      ) &&
      (
        expected.providerResult === undefined ||
        digest(checkout) ===
          digest(expected.providerResult)
      ),
    "repository_conflict",
    "the durable Alakazam Checkout result changed",
    { status: 500 }
  );
  return deepFreeze({
    ...clone(value),
    checkout
  });
}

function checkoutReference(dispatch) {
  return Object.freeze({
    tenantId: dispatch.tenantId,
    customerId: dispatch.customerId,
    projectId: dispatch.projectId,
    quoteId: dispatch.quoteId,
    dispatchId: dispatch.dispatchId,
    purposeDigest: dispatch.purposeDigest
  });
}

function checkoutReconciliationError() {
  return new CommerceV2Error(
    "alakazam_checkout_reconciliation_required",
    "Alakazam Checkout needs reconciliation before another attempt. Nothing was charged by Site Sourcery.",
    { status: 409 }
  );
}

function quoteWithoutDigest(value) {
  const selected = clone(value);
  delete selected.quoteDigest;
  return selected;
}

function exactAuthorizedQuote(value, input, taxMode, now) {
  invariant(
    value?.schema === ALAKAZAM_CHANGE_QUOTE_SCHEMA &&
      value.quoteId === input.quoteId &&
      value.tenantId === input.tenantId &&
      value.customerId === input.customerId &&
      value.projectId === input.projectId &&
      value.catalogVersion === ALAKAZAM_CATALOG_VERSION &&
      value.termsVersion === ALAKAZAM_TERMS_VERSION &&
      value.state === "quoted" &&
      value.providerEffectsAuthorized === true &&
      value.targetTier?.tierId === input.targetTierId &&
      value.dueNow?.currency === "USD" &&
      value.dueNow?.taxState === taxMode &&
      value.nextRenewal?.tierId === input.targetTierId &&
      value.nextRenewal?.currency === "USD" &&
      value.nextRenewal?.interval === "month" &&
      value.disclosure?.dueNow?.taxState === taxMode &&
      digest(value.disclosure) ===
        value.disclosureDigest &&
      digest(quoteWithoutDigest(value)) ===
        value.quoteDigest,
    "repository_conflict",
    "the durable Alakazam quote failed its exact server contract",
    { status: 500 }
  );
  requiredDigest(
    value.disclosureDigest,
    "quote.disclosureDigest"
  );
  requiredDigest(value.quoteDigest, "quote.quoteDigest");
  const issuedAt = requiredIso(
    value.issuedAt,
    "quote.issuedAt"
  );
  const expiresAt = requiredIso(
    value.expiresAt,
    "quote.expiresAt"
  );
  invariant(
    Date.parse(expiresAt) > Date.parse(now) &&
      Date.parse(expiresAt) > Date.parse(issuedAt) &&
      Date.parse(expiresAt) - Date.parse(issuedAt) <=
        QUOTE_TTL_MS,
    "alakazam_quote_expired",
    "Request a fresh Alakazam quote before continuing.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

export function createAlakazamBillingService({
  repository,
  provider,
  clock,
  release = createAlakazamBillingRelease()
} = {}) {
  const ports = validatePorts(repository, provider, clock);
  const authority = exactRelease(release);

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "held",
        code: "alakazam_billing_release_held"
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxMode !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        quote: false,
        payment: false,
        state: "unavailable",
        code:
          status?.code ??
          "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      quote: true,
      payment: false,
      customerProvisioning: true,
      checkout: true,
      state: "quote_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  async function fenceCustomerEffect(
    provision,
    errorCode,
    stripeCustomerId
  ) {
    try {
      return await ports.repository
        .markCustomerProvisionAmbiguous({
          ...customerReference(provision),
          errorCode,
          stripeCustomerId:
            STRIPE_CUSTOMER_ID.test(
              stripeCustomerId ?? ""
            )
              ? stripeCustomerId
              : null
        });
    } catch {
      return null;
    }
  }

  async function fenceCheckoutEffect(
    dispatch,
    errorCode
  ) {
    try {
      return await ports.repository
        .markCheckoutDispatchUnknown({
          ...checkoutReference(dispatch),
          errorCode
        });
    } catch {
      return null;
    }
  }

  const service = {
    readiness,

    async ensureCheckoutCustomer(input) {
      const selected = exactCustomerInput(input);
      const status = await readiness();
      invariant(
        status.ready === true &&
          status.customerProvisioning === true,
        "alakazam_billing_unavailable",
        "Alakazam billing is not open. Nothing was charged.",
        { status: 503 }
      );
      const claimedAt = exactClock(ports.clock);
      const claim =
        await ports.repository.claimCustomerProvision({
          ...selected,
          claimedAt
        });
      if (claim?.status === "bound") {
        return exactCustomerBinding(claim);
      }
      if (claim?.status === "pending") {
        throw new CommerceV2Error(
          "alakazam_customer_provision_pending",
          "Alakazam Customer setup is already in progress.",
          { status: 409 }
        );
      }
      if (
        claim?.status === "reconciliation_required"
      ) {
        throw customerReconciliationError(
          claim.code ??
            "alakazam_customer_reconciliation_required"
        );
      }
      const provision = exactCustomerClaim(
        claim,
        selected,
        claimedAt
      );
      let rawProviderFacts;
      try {
        rawProviderFacts =
          await ports.provider.createAlakazamCustomer({
            idempotencyKey: provision.idempotencyKey,
            purpose: clone(provision.purpose),
            purposeDigest: provision.purposeDigest
          });
      } catch (error) {
        if (error?.certainty === "ambiguous") {
          await fenceCustomerEffect(
            provision,
            error.code ??
              "stripe_alakazam_customer_effect_unknown",
            error.details?.stripeCustomerId ?? null
          );
          throw customerReconciliationError(
            error.code ??
              "stripe_alakazam_customer_effect_unknown"
          );
        }
        await ports.repository.releaseCustomerProvision(
          customerReference(provision)
        );
        throw error;
      }

      let providerFacts;
      try {
        providerFacts = exactCustomerProviderFacts(
          rawProviderFacts,
          provision
        );
      } catch {
        await fenceCustomerEffect(
          provision,
          "stripe_alakazam_customer_result_invalid",
          rawProviderFacts?.stripeCustomerId ?? null
        );
        throw customerReconciliationError(
          "stripe_alakazam_customer_result_invalid"
        );
      }

      try {
        const binding =
          await ports.repository.confirmCustomerProvision({
            ...customerReference(provision),
            providerFacts,
            confirmedAt: exactClock(ports.clock)
          });
        return exactCustomerBinding(binding, {
          provisionId: provision.provisionId,
          stripeCustomerId:
            providerFacts.stripeCustomerId
        });
      } catch {
        const fenced = await fenceCustomerEffect(
          provision,
          "alakazam_customer_binding_persistence_unknown",
          providerFacts.stripeCustomerId
        );
        if (fenced?.status === "bound") {
          return exactCustomerBinding(fenced, {
            provisionId: provision.provisionId,
            stripeCustomerId:
              providerFacts.stripeCustomerId
          });
        }
        throw customerReconciliationError(
          "alakazam_customer_binding_persistence_unknown"
        );
      }
    },

    async createCheckout(input) {
      const selected = exactCheckoutInput(input);
      const binding = await service.ensureCheckoutCustomer({
        tenantId: selected.tenantId,
        customerId: selected.customerId,
        projectId: selected.projectId,
        quoteId: selected.quoteId,
        provisionId: selected.commandId,
        acceptedDisclosureDigest:
          selected.acceptedDisclosureDigest,
        siteSetupDigest: selected.siteSetupDigest
      });
      const claimedAt = exactClock(ports.clock);
      const claim = await ports.repository
        .claimCheckoutDispatch({
          tenantId: selected.tenantId,
          customerId: selected.customerId,
          projectId: selected.projectId,
          quoteId: selected.quoteId,
          dispatchId: selected.commandId,
          stripeCustomerId: binding.stripeCustomerId,
          acceptedDisclosureDigest:
            selected.acceptedDisclosureDigest,
          siteSetupDigest: selected.siteSetupDigest,
          claimedAt
        });
      if (claim?.status === "ready") {
        return exactCheckoutReady(claim, {
          projectId: selected.projectId,
          quoteId: selected.quoteId
        });
      }
      if (claim?.status === "settled") {
        throw new CommerceV2Error(
          "alakazam_payment_already_settled",
          "This Alakazam payment is already settled.",
          { status: 409 }
        );
      }
      if (claim?.status === "pending") {
        throw new CommerceV2Error(
          "alakazam_checkout_pending",
          "Alakazam Checkout setup is already in progress.",
          { status: 409 }
        );
      }
      if (
        claim?.status === "reconciliation_required"
      ) {
        throw checkoutReconciliationError();
      }
      if (claim?.status === "reconcile_expiry") {
        throw new CommerceV2Error(
          "alakazam_checkout_expiry_reconciliation_required",
          "The prior Checkout must be reconciled before another payment can open.",
          { status: 409 }
        );
      }
      if (
        claim?.status === "failed" ||
        claim?.status === "expired"
      ) {
        throw new CommerceV2Error(
          "alakazam_quote_refresh_required",
          "Request a fresh Alakazam quote before continuing.",
          { status: 409 }
        );
      }
      const dispatch = exactCheckoutClaim(
        claim,
        selected,
        binding,
        claimedAt
      );

      let rawProviderResult;
      try {
        const create =
          dispatch.purpose.changeKind === "start"
            ? ports.provider
                .createAlakazamStartCheckout
            : ports.provider
                .createAlakazamUpgradeCheckout;
        rawProviderResult = await create.call(
          ports.provider,
          {
            idempotencyKey: dispatch.idempotencyKey,
            purpose: clone(dispatch.purpose),
            purposeDigest: dispatch.purposeDigest
          }
        );
      } catch (error) {
        if (error?.certainty === "ambiguous") {
          await fenceCheckoutEffect(
            dispatch,
            error.code ??
              "stripe_alakazam_checkout_effect_unknown"
          );
          throw checkoutReconciliationError();
        }
        const failed =
          await ports.repository.failCheckoutDispatch({
            ...checkoutReference(dispatch),
            errorCode:
              error?.code ??
              "stripe_alakazam_checkout_not_submitted"
          });
        if (failed?.status === "ready") {
          return exactCheckoutReady(failed, {
            projectId: dispatch.projectId,
            quoteId: dispatch.quoteId
          });
        }
        throw error;
      }

      let providerResult;
      try {
        providerResult = exactCheckoutProviderResult(
          rawProviderResult
        );
      } catch {
        await fenceCheckoutEffect(
          dispatch,
          "stripe_alakazam_checkout_response_invalid"
        );
        throw checkoutReconciliationError();
      }

      try {
        const ready =
          await ports.repository.confirmCheckoutDispatch({
            ...checkoutReference(dispatch),
            providerResult,
            dispatchedAt: exactClock(ports.clock)
          });
        return exactCheckoutReady(ready, {
          dispatchId: dispatch.dispatchId,
          projectId: dispatch.projectId,
          quoteId: dispatch.quoteId,
          purposeDigest: dispatch.purposeDigest,
          providerResult
        });
      } catch {
        const fenced = await fenceCheckoutEffect(
          dispatch,
          "alakazam_checkout_persistence_unknown"
        );
        if (fenced?.status === "ready") {
          return exactCheckoutReady(fenced, {
            dispatchId: dispatch.dispatchId,
            projectId: dispatch.projectId,
            quoteId: dispatch.quoteId,
            purposeDigest: dispatch.purposeDigest,
            providerResult
          });
        }
        throw checkoutReconciliationError();
      }
    },

    async createQuote(input) {
      const selected = exactQuoteInput(input);
      const status = await readiness();
      invariant(
        status.ready === true && status.quote === true,
        "alakazam_billing_unavailable",
        "Alakazam billing is not open. Nothing was charged.",
        { status: 503 }
      );
      const issuedAt = exactClock(ports.clock);
      const expiresAt = new Date(
        Date.parse(issuedAt) + QUOTE_TTL_MS
      ).toISOString();
      const quote = await ports.repository.createQuote({
        ...selected,
        issuedAt,
        expiresAt,
        taxMode: authority.taxMode
      });
      return exactAuthorizedQuote(
        quote,
        selected,
        authority.taxMode,
        issuedAt
      );
    }
  };
  return Object.freeze(service);
}
