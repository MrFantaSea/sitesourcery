import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
  createAlakazamBillingRelease,
  createAlakazamBillingService,
  createAlakazamCheckoutDispatch,
  createAlakazamCustomerProvision,
  digest,
  quoteAlakazamChange
} from "../index.mjs";

const NOW = "2026-08-02T12:00:00.000Z";
const EXPIRES_AT = "2026-08-02T12:30:00.000Z";
const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "40000000-0000-4000-8000-000000000001";
const PROVISION_ID =
  "50000000-0000-4000-8000-000000000001";
const ACCEPTED_DISCLOSURE_DIGEST = "a".repeat(64);
const SITE_SETUP_DIGEST = "d".repeat(64);

function input(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    targetTierId: "alakazam_25",
    ...overrides
  };
}

function customerInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    provisionId: PROVISION_ID,
    acceptedDisclosureDigest:
      ACCEPTED_DISCLOSURE_DIGEST,
    siteSetupDigest: SITE_SETUP_DIGEST,
    ...overrides
  };
}

function checkoutInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    commandId: PROVISION_ID,
    acceptedDisclosureDigest:
      ACCEPTED_DISCLOSURE_DIGEST,
    siteSetupDigest: SITE_SETUP_DIGEST,
    ...overrides
  };
}

function fixture({
  approved = true,
  taxMode = "disabled_by_owner",
  providerStatus = null,
  repositoryResult = null,
  customerClaimResult = null,
  customerClaimError = null,
  customerProviderResult = null,
  customerProviderError = null,
  customerConfirmError = null,
  customerAmbiguousResult = null,
  checkoutClaimResult = null,
  checkoutProviderResult = null,
  checkoutProviderError = null,
  checkoutConfirmError = null,
  checkoutUnknownResult = null,
  checkoutFailResult = null
} = {}) {
  const calls = {
    readiness: 0,
    quotes: [],
    customerClaims: [],
    customerCreates: [],
    customerConfirms: [],
    customerAmbiguities: [],
    customerReleases: [],
    checkoutClaims: [],
    checkoutCreates: [],
    checkoutConfirms: [],
    checkoutUnknown: [],
    checkoutFailures: []
  };
  async function createProviderCheckout(
    changeKind,
    value
  ) {
    calls.checkoutCreates.push({
      changeKind,
      value: structuredClone(value)
    });
    if (checkoutProviderError) {
      throw checkoutProviderError;
    }
    return checkoutProviderResult
      ? structuredClone(checkoutProviderResult)
      : {
          checkoutId: "cs_alakazam_checkout_1",
          url:
            "https://checkout.stripe.com/c/pay/alakazam_checkout_1",
          expiresAt: EXPIRES_AT
        };
  }
  const provider = {
    async readiness() {
      calls.readiness += 1;
      return providerStatus ?? {
        ready: true,
        provider: "stripe",
        alakazam: true,
        livemode: false,
        taxModes: { alakazam: taxMode }
      };
    },
    async createAlakazamCustomer(value) {
      calls.customerCreates.push(
        structuredClone(value)
      );
      if (customerProviderError) {
        throw customerProviderError;
      }
      if (customerProviderResult) {
        return structuredClone(customerProviderResult);
      }
      const purpose = value.purpose;
      const facts = {
        schema:
          ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
        stripeCustomerId: "cus_alakazam_customer_1",
        organizationId: purpose.organizationId,
        customerId: purpose.customerId,
        projectId: purpose.projectId,
        quoteId: purpose.quoteId,
        provisionId: purpose.provisionId,
        providerCreatedAt: NOW,
        purposeDigest: value.purposeDigest
      };
      return {
        ...facts,
        providerFactsDigest: digest(facts)
      };
    },
    async createAlakazamStartCheckout(value) {
      return createProviderCheckout("start", value);
    },
    async createAlakazamUpgradeCheckout(value) {
      return createProviderCheckout("upgrade", value);
    }
  };
  const repository = {
    async createQuote(value) {
      calls.quotes.push(structuredClone(value));
      return repositoryResult ?? quoteAlakazamChange({
        quoteId: value.quoteId,
        tenantId: value.tenantId,
        customerId: value.customerId,
        projectId: value.projectId,
        targetTierId: value.targetTierId,
        issuedAt: value.issuedAt,
        expiresAt: value.expiresAt,
        providerEffectsAuthorized: true,
        taxMode: value.taxMode
      });
    },
    async claimCustomerProvision(value) {
      calls.customerClaims.push(
        structuredClone(value)
      );
      if (customerClaimError) {
        throw customerClaimError;
      }
      if (customerClaimResult) {
        return structuredClone(customerClaimResult);
      }
      return {
        status: "create",
        provider: "stripe",
        provision: createAlakazamCustomerProvision({
          tenantId: value.tenantId,
          customerId: value.customerId,
          projectId: value.projectId,
          quoteId: value.quoteId,
          provisionId: value.provisionId,
          acceptedDisclosureDigest:
            value.acceptedDisclosureDigest,
          quoteDigest: "b".repeat(64),
          claimedAt: value.claimedAt
        })
      };
    },
    async confirmCustomerProvision(value) {
      calls.customerConfirms.push(
        structuredClone(value)
      );
      if (customerConfirmError) {
        throw customerConfirmError;
      }
      return {
        status: "bound",
        provider: "stripe",
        stripeCustomerId:
          value.providerFacts.stripeCustomerId,
        provisionId: value.provisionId
      };
    },
    async markCustomerProvisionAmbiguous(value) {
      calls.customerAmbiguities.push(
        structuredClone(value)
      );
      return customerAmbiguousResult
        ? structuredClone(customerAmbiguousResult)
        : {
            status: "reconciliation_required",
            provider: "stripe",
            provisionId: value.provisionId,
            stripeCustomerId:
              value.stripeCustomerId,
            code: value.errorCode
          };
    },
    async releaseCustomerProvision(value) {
      calls.customerReleases.push(
        structuredClone(value)
      );
      return { status: "released" };
    },
    async claimCheckoutDispatch(value) {
      calls.checkoutClaims.push(
        structuredClone(value)
      );
      if (checkoutClaimResult) {
        return structuredClone(checkoutClaimResult);
      }
      return {
        status: "create",
        provider: "stripe",
        dispatch: createAlakazamCheckoutDispatch({
          dispatchId: value.dispatchId,
          tenantId: value.tenantId,
          customerId: value.customerId,
          projectId: value.projectId,
          quoteId: value.quoteId,
          stripeCustomerId: value.stripeCustomerId,
          acceptedDisclosureDigest:
            value.acceptedDisclosureDigest,
          quoteDigest: "b".repeat(64),
          changeKind: "start",
          targetTierId: "alakazam_25",
          dueNowSubtotalMinor: 2500,
          taxMode,
          claimedAt: value.claimedAt
        })
      };
    },
    async confirmCheckoutDispatch(value) {
      calls.checkoutConfirms.push(
        structuredClone(value)
      );
      if (checkoutConfirmError) {
        throw checkoutConfirmError;
      }
      return {
        status: "ready",
        provider: "stripe",
        dispatchId: value.dispatchId,
        quoteId: value.quoteId,
        projectId: value.projectId,
        purposeDigest: value.purposeDigest,
        checkout: structuredClone(value.providerResult)
      };
    },
    async markCheckoutDispatchUnknown(value) {
      calls.checkoutUnknown.push(
        structuredClone(value)
      );
      return checkoutUnknownResult
        ? structuredClone(checkoutUnknownResult)
        : {
            status: "reconciliation_required",
            provider: "stripe",
            dispatchId: value.dispatchId,
            purposeDigest: value.purposeDigest,
            code: value.errorCode
          };
    },
    async failCheckoutDispatch(value) {
      calls.checkoutFailures.push(
        structuredClone(value)
      );
      return checkoutFailResult
        ? structuredClone(checkoutFailResult)
        : {
            status: "failed",
            provider: "stripe",
            dispatchId: value.dispatchId,
            purposeDigest: value.purposeDigest,
            code: value.errorCode
          };
    }
  };
  const service = createAlakazamBillingService({
    repository,
    provider,
    clock: { now: () => NOW },
    release: createAlakazamBillingRelease({
      approved,
      taxMode: approved ? taxMode : null
    })
  });
  return { service, calls };
}

test("Alakazam billing is held before repository or provider authority", async () => {
  const { service, calls } = fixture({ approved: false });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    quote: false,
    payment: false,
    state: "held",
    code: "alakazam_billing_release_held"
  });
  await assert.rejects(
    service.createQuote(input()),
    (error) => error.code === "alakazam_billing_unavailable"
  );
  assert.equal(calls.readiness, 0);
  assert.equal(calls.quotes.length, 0);
});

test("Alakazam quote readiness requires the exact reviewed provider and tax mode", async () => {
  for (const providerStatus of [
    {
      ready: true,
      provider: "stripe",
      alakazam: false,
      livemode: false,
      taxModes: { alakazam: "disabled_by_owner" }
    },
    {
      ready: true,
      provider: "stripe",
      alakazam: true,
      livemode: false,
      taxModes: { alakazam: "automatic" }
    }
  ]) {
    const { service, calls } = fixture({ providerStatus });
    const status = await service.readiness();
    assert.equal(status.ready, false);
    await assert.rejects(
      service.createQuote(input()),
      (error) =>
        error.code === "alakazam_billing_unavailable"
    );
    assert.equal(calls.quotes.length, 0);
  }
});

test("Alakazam quote sends only identity, target, server time, and reviewed tax authority to the repository", async () => {
  const { service, calls } = fixture();
  const quote = await service.createQuote(input());
  assert.equal(quote.state, "quoted");
  assert.equal(quote.providerEffectsAuthorized, true);
  assert.equal(
    quote.dueNow.taxState,
    "disabled_by_owner"
  );
  assert.equal(quote.dueNow.totalMinor, 2500);
  assert.deepEqual(calls.quotes, [
    {
      ...input(),
      issuedAt: NOW,
      expiresAt: EXPIRES_AT,
      taxMode: "disabled_by_owner"
    }
  ]);
  assert.equal(
    Object.hasOwn(calls.quotes[0], "amountMinor"),
    false
  );
  assert.equal(
    Object.hasOwn(calls.quotes[0], "downloadCredit"),
    false
  );
  assert.equal(
    Object.hasOwn(calls.quotes[0], "currentSubscription"),
    false
  );
});

test("Alakazam quote rejects browser money or subscription authority before provider readiness", async () => {
  for (const forged of [
    { amountMinor: 1 },
    { downloadCredit: { amountMinor: 500 } },
    { currentSubscription: { tierId: "alakazam_50" } },
    { stripePriceId: "price_forged" }
  ]) {
    const { service, calls } = fixture();
    await assert.rejects(
      service.createQuote(input(forged)),
      (error) => error.code === "invalid_input"
    );
    assert.equal(calls.readiness, 0);
    assert.equal(calls.quotes.length, 0);
  }
});

test("Alakazam quote refuses a repository result with changed money or digest", async () => {
  const changed = structuredClone(
    quoteAlakazamChange({
      ...input(),
      issuedAt: NOW,
      expiresAt: EXPIRES_AT,
      providerEffectsAuthorized: true,
      taxMode: "disabled_by_owner"
    })
  );
  changed.dueNow.subtotalMinor = 1;
  const { service } = fixture({ repositoryResult: changed });
  await assert.rejects(
    service.createQuote(input()),
    (error) => error.code === "repository_conflict"
  );
});

test("Alakazam direct start creates and binds one metadata-only Stripe Customer", async () => {
  const { service, calls } = fixture();
  assert.equal(
    (await service.readiness()).customerProvisioning,
    true
  );
  const binding = await service.ensureCheckoutCustomer(
    customerInput()
  );
  assert.deepEqual(binding, {
    status: "bound",
    provider: "stripe",
    stripeCustomerId: "cus_alakazam_customer_1",
    provisionId: PROVISION_ID
  });
  assert.deepEqual(calls.customerClaims, [
    {
      ...customerInput(),
      claimedAt: NOW
    }
  ]);
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(
    calls.customerCreates[0].idempotencyKey,
    `alakazam:customer:${PROVISION_ID}`
  );
  assert.deepEqual(
    Object.keys(calls.customerCreates[0].purpose).sort(),
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
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(calls.customerCreates[0]),
    /\b(?:email|name|phone|address)\b/iu
  );
  assert.equal(calls.customerConfirms.length, 1);
  assert.equal(
    calls.customerConfirms[0]
      .providerFacts.providerFactsDigest,
    digest(
      Object.fromEntries(
        Object.entries(
          calls.customerConfirms[0].providerFacts
        ).filter(
          ([key]) => key !== "providerFactsDigest"
        )
      )
    )
  );
  assert.equal(calls.customerAmbiguities.length, 0);
  assert.equal(calls.customerReleases.length, 0);
});

test("an existing Customer binding bypasses every new provider effect", async () => {
  const { service, calls } = fixture({
    customerClaimResult: {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_existing_customer",
      provisionId: null
    }
  });
  assert.deepEqual(
    await service.ensureCheckoutCustomer(customerInput()),
    {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_existing_customer",
      provisionId: null
    }
  );
  assert.equal(calls.customerCreates.length, 0);
  assert.equal(calls.customerConfirms.length, 0);
});

test("pending or ambiguous Customer claims never call Stripe again", async () => {
  for (const [customerClaimResult, code] of [
    [
      {
        status: "pending",
        provider: "stripe",
        provisionId: PROVISION_ID,
        leaseExpiresAt:
          "2026-08-02T12:02:00.000Z"
      },
      "alakazam_customer_provision_pending"
    ],
    [
      {
        status: "reconciliation_required",
        provider: "stripe",
        provisionId: PROVISION_ID,
        stripeCustomerId: null,
        code: "customer_effect_unknown"
      },
      "alakazam_customer_reconciliation_required"
    ]
  ]) {
    const { service, calls } = fixture({
      customerClaimResult
    });
    await assert.rejects(
      service.ensureCheckoutCustomer(customerInput()),
      (error) => error.code === code
    );
    assert.equal(calls.customerCreates.length, 0);
    assert.equal(calls.customerConfirms.length, 0);
  }
});

test("ambiguous Stripe Customer creation is fenced and never released for retry", async () => {
  const providerError = Object.assign(
    new Error("timeout after create"),
    {
      code: "stripe_alakazam_customer_readback_unknown",
      certainty: "ambiguous",
      details: {
        stripeCustomerId: "cus_ambiguous_customer"
      }
    }
  );
  const { service, calls } = fixture({
    customerProviderError: providerError
  });
  await assert.rejects(
    service.ensureCheckoutCustomer(customerInput()),
    (error) =>
      error.code ===
      "alakazam_customer_reconciliation_required"
  );
  assert.equal(calls.customerCreates.length, 1);
  assert.deepEqual(calls.customerAmbiguities, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      provisionId: PROVISION_ID,
      purposeDigest:
        calls.customerCreates[0].purposeDigest,
      errorCode:
        "stripe_alakazam_customer_readback_unknown",
      stripeCustomerId: "cus_ambiguous_customer"
    }
  ]);
  assert.equal(calls.customerReleases.length, 0);
  assert.equal(calls.customerConfirms.length, 0);
});

test("a pre-effect provider failure releases only the unused reservation", async () => {
  const providerError = Object.assign(
    new Error("configuration unavailable"),
    { code: "stripe_not_ready" }
  );
  const { service, calls } = fixture({
    customerProviderError: providerError
  });
  await assert.rejects(
    service.ensureCheckoutCustomer(customerInput()),
    (error) => error === providerError
  );
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(calls.customerReleases.length, 1);
  assert.equal(calls.customerAmbiguities.length, 0);
});

test("post-create persistence uncertainty reconciles a concurrently committed binding", async () => {
  const { service, calls } = fixture({
    customerConfirmError: new Error("commit response lost"),
    customerAmbiguousResult: {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_alakazam_customer_1",
      provisionId: PROVISION_ID
    }
  });
  assert.deepEqual(
    await service.ensureCheckoutCustomer(customerInput()),
    {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_alakazam_customer_1",
      provisionId: PROVISION_ID
    }
  );
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(calls.customerConfirms.length, 1);
  assert.equal(calls.customerAmbiguities.length, 1);
  assert.equal(
    calls.customerAmbiguities[0].errorCode,
    "alakazam_customer_binding_persistence_unknown"
  );
});

test("Customer preparation rejects browser money before readiness or persistence", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.ensureCheckoutCustomer(
      customerInput({ amountMinor: 1 })
    ),
    (error) => error.code === "invalid_input"
  );
  assert.equal(calls.readiness, 0);
  assert.equal(calls.customerClaims.length, 0);
});

test("Alakazam start Checkout binds one Customer, one durable claim, and one Stripe effect", async () => {
  const { service, calls } = fixture();
  const ready = await service.createCheckout(
    checkoutInput()
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.dispatchId, PROVISION_ID);
  assert.equal(ready.quoteId, QUOTE_ID);
  assert.equal(
    ready.checkout.checkoutId,
    "cs_alakazam_checkout_1"
  );
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(calls.checkoutClaims.length, 1);
  assert.deepEqual(calls.checkoutClaims[0], {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    dispatchId: PROVISION_ID,
    stripeCustomerId: "cus_alakazam_customer_1",
    acceptedDisclosureDigest:
      ACCEPTED_DISCLOSURE_DIGEST,
    siteSetupDigest: SITE_SETUP_DIGEST,
    claimedAt: NOW
  });
  assert.equal(calls.checkoutCreates.length, 1);
  assert.equal(calls.checkoutCreates[0].changeKind, "start");
  assert.equal(
    calls.checkoutCreates[0].value.purpose
      .dueNowSubtotalMinor,
    2500
  );
  assert.equal(calls.checkoutConfirms.length, 1);
  assert.equal(calls.checkoutUnknown.length, 0);
  assert.equal(calls.checkoutFailures.length, 0);
});

test("Alakazam upgrade Checkout selects only the fixed-difference provider operation", async () => {
  const dispatch = createAlakazamCheckoutDispatch({
    dispatchId: PROVISION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_existing_customer",
    acceptedDisclosureDigest: "a".repeat(64),
    quoteDigest: "b".repeat(64),
    changeKind: "upgrade",
    currentSubscription: {
      localSubscriptionId:
        "60000000-0000-4000-8000-000000000001",
      revision: 3,
      tierId: "alakazam_25",
      amountMinor: 2500,
      stripeSubscriptionId: "sub_alakazam_1",
      stripeSubscriptionItemId: "si_alakazam_1",
      stripePriceId: "price_alakazam_25",
      currentPeriodStartsAt: NOW,
      currentPeriodEndsAt:
        "2026-09-02T12:00:00.000Z",
      providerFactsDigest: "c".repeat(64)
    },
    targetTierId: "alakazam_35",
    dueNowSubtotalMinor: 1000,
    taxMode: "disabled_by_owner",
    claimedAt: NOW
  });
  const { service, calls } = fixture({
    customerClaimResult: {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_existing_customer",
      provisionId: null
    },
    checkoutClaimResult: {
      status: "create",
      provider: "stripe",
      dispatch
    }
  });
  const ready = await service.createCheckout(
    checkoutInput({ siteSetupDigest: null })
  );
  assert.equal(ready.status, "ready");
  assert.equal(calls.customerCreates.length, 0);
  assert.equal(calls.checkoutCreates.length, 1);
  assert.equal(
    calls.checkoutCreates[0].changeKind,
    "upgrade"
  );
  assert.equal(
    calls.checkoutCreates[0].value.purpose
      .dueNowSubtotalMinor,
    1000
  );
  assert.equal(
    calls.checkoutCreates[0].value.purpose
      .currentSubscription.revision,
    3
  );
});

test("a ready Checkout replay returns its durable destination without another Stripe effect", async () => {
  const checkout = {
    checkoutId: "cs_existing_checkout",
    url:
      "https://checkout.stripe.com/c/pay/existing_checkout",
    expiresAt: EXPIRES_AT
  };
  const { service, calls } = fixture({
    customerClaimResult: {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_existing_customer",
      provisionId: null
    },
    checkoutClaimResult: {
      status: "ready",
      provider: "stripe",
      dispatchId: PROVISION_ID,
      quoteId: QUOTE_ID,
      projectId: PROJECT_ID,
      purposeDigest: "d".repeat(64),
      checkout
    }
  });
  assert.equal(
    (
      await service.createCheckout(checkoutInput())
    ).checkout.checkoutId,
    "cs_existing_checkout"
  );
  assert.equal(calls.checkoutCreates.length, 0);
  assert.equal(calls.checkoutConfirms.length, 0);
});

test("ambiguous Stripe Checkout creation is fenced and never failed as no-effect", async () => {
  const providerError = Object.assign(
    new Error("timeout"),
    {
      code: "stripe_alakazam_checkout_effect_unknown",
      certainty: "ambiguous"
    }
  );
  const { service, calls } = fixture({
    checkoutProviderError: providerError
  });
  await assert.rejects(
    service.createCheckout(checkoutInput()),
    (error) =>
      error.code ===
      "alakazam_checkout_reconciliation_required"
  );
  assert.equal(calls.checkoutCreates.length, 1);
  assert.equal(calls.checkoutUnknown.length, 1);
  assert.equal(
    calls.checkoutUnknown[0].errorCode,
    "stripe_alakazam_checkout_effect_unknown"
  );
  assert.equal(calls.checkoutFailures.length, 0);
  assert.equal(calls.checkoutConfirms.length, 0);
});

test("a pre-effect Checkout failure closes the quote without retrying Stripe", async () => {
  const providerError = Object.assign(
    new Error("configuration unavailable"),
    { code: "stripe_not_ready" }
  );
  const { service, calls } = fixture({
    checkoutProviderError: providerError
  });
  await assert.rejects(
    service.createCheckout(checkoutInput()),
    (error) => error === providerError
  );
  assert.equal(calls.checkoutCreates.length, 1);
  assert.equal(calls.checkoutFailures.length, 1);
  assert.equal(calls.checkoutUnknown.length, 0);
});

test("post-create Checkout persistence uncertainty recovers a concurrently committed destination", async () => {
  const dispatch = createAlakazamCheckoutDispatch({
    dispatchId: PROVISION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_existing_customer",
    acceptedDisclosureDigest: "a".repeat(64),
    siteSetupDigest: SITE_SETUP_DIGEST,
    quoteDigest: "b".repeat(64),
    changeKind: "start",
    targetTierId: "alakazam_25",
    dueNowSubtotalMinor: 2500,
    taxMode: "disabled_by_owner",
    claimedAt: NOW
  });
  const providerResult = {
    checkoutId: "cs_alakazam_checkout_1",
    url:
      "https://checkout.stripe.com/c/pay/alakazam_checkout_1",
    expiresAt: EXPIRES_AT
  };
  const { service, calls } = fixture({
    customerClaimResult: {
      status: "bound",
      provider: "stripe",
      stripeCustomerId: "cus_existing_customer",
      provisionId: null
    },
    checkoutClaimResult: {
      status: "create",
      provider: "stripe",
      dispatch
    },
    checkoutConfirmError: new Error("commit response lost"),
    checkoutUnknownResult: {
      status: "ready",
      provider: "stripe",
      dispatchId: PROVISION_ID,
      quoteId: QUOTE_ID,
      projectId: PROJECT_ID,
      purposeDigest: dispatch.purposeDigest,
      checkout: providerResult
    }
  });
  assert.equal(
    (
      await service.createCheckout(checkoutInput())
    ).checkout.checkoutId,
    "cs_alakazam_checkout_1"
  );
  assert.equal(calls.checkoutCreates.length, 1);
  assert.equal(calls.checkoutConfirms.length, 1);
  assert.equal(calls.checkoutUnknown.length, 1);
  assert.equal(
    calls.checkoutUnknown[0].errorCode,
    "alakazam_checkout_persistence_unknown"
  );
});

test("Alakazam Checkout rejects browser money before Customer or provider work", async () => {
  const { service, calls } = fixture();
  await assert.rejects(
    service.createCheckout(
      checkoutInput({ amountMinor: 1 })
    ),
    (error) => error.code === "invalid_input"
  );
  assert.equal(calls.readiness, 0);
  assert.equal(calls.customerClaims.length, 0);
  assert.equal(calls.checkoutClaims.length, 0);
  assert.equal(calls.checkoutCreates.length, 0);
});

test("Alakazam Checkout binds accepted disclosure before Customer or provider work", async () => {
  const repositoryError = Object.assign(
    new Error("accepted disclosure changed"),
    { code: "alakazam_change_unavailable" }
  );
  const { service, calls } = fixture({
    customerClaimError: repositoryError
  });
  const changedDigest = "f".repeat(64);
  await assert.rejects(
    service.createCheckout(
      checkoutInput({
        acceptedDisclosureDigest: changedDigest
      })
    ),
    (error) => error === repositoryError
  );
  assert.equal(
    calls.customerClaims[0].acceptedDisclosureDigest,
    changedDigest
  );
  assert.equal(calls.customerCreates.length, 0);
  assert.equal(calls.checkoutClaims.length, 0);
  assert.equal(calls.checkoutCreates.length, 0);

  const malformed = fixture();
  await assert.rejects(
    malformed.service.createCheckout(
      checkoutInput({ acceptedDisclosureDigest: "short" })
    ),
    (error) => error.code === "invalid_input"
  );
  assert.equal(malformed.calls.readiness, 0);
  assert.equal(malformed.calls.customerClaims.length, 0);
});

test("stale website setup fails before any Stripe Customer or Checkout effect", async () => {
  const repositoryError = Object.assign(
    new Error("accepted website setup changed"),
    { code: "alakazam_site_setup_changed" }
  );
  const { service, calls } = fixture({
    customerClaimError: repositoryError
  });
  const changedSetupDigest = "e".repeat(64);
  await assert.rejects(
    service.createCheckout(
      checkoutInput({
        siteSetupDigest: changedSetupDigest
      })
    ),
    (error) => error === repositoryError
  );
  assert.equal(
    calls.customerClaims[0].siteSetupDigest,
    changedSetupDigest
  );
  assert.equal(calls.customerCreates.length, 0);
  assert.equal(calls.checkoutClaims.length, 0);
  assert.equal(calls.checkoutCreates.length, 0);
});
