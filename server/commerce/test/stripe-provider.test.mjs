import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../domain/canonical.mjs";
import {
  STRIPE_API_VERSION,
  createOfficialStripeClient,
  createStripeProviderAdapter
} from "../adapters/stripe.mjs";

const DISCLOSURE_DIGEST = "a".repeat(64);
const CANCELLATION_DIGEST = "b".repeat(64);

function configuration(overrides = {}) {
  return {
    livemode: false,
    successUrl:
      "https://account.sitesourcery.test/billing/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl:
      "https://account.sitesourcery.test/billing/cancel",
    portalReturnUrl:
      "https://account.sitesourcery.test/account",
    approvedReturnOrigins: [
      "https://account.sitesourcery.test"
    ],
    taxMode: "disabled_by_owner",
    webhookSecret: "whsec_contract_test",
    checkoutTtlSeconds: 1800,
    domainAuthorization: {
      successUrlTemplate:
        "https://account.sitesourcery.test/domain-orders/{ORDER_ID}/complete?session_id={CHECKOUT_SESSION_ID}",
      cancelUrlTemplate:
        "https://account.sitesourcery.test/domain-orders/{ORDER_ID}/cancel",
      authorizationDisclosure:
        "Your card is authorized now and captured only after the domain and registrant are verified."
    },
    priceExpectations: [
      {
        id: "price_site_once",
        currency: "usd",
        unitAmount: 35000,
        livemode: false,
        recurring: null
      },
      {
        id: "price_site_month",
        currency: "usd",
        unitAmount: 32500,
        livemode: false,
        recurring: {
          interval: "month",
          intervalCount: 1
        }
      }
    ],
    ...overrides
  };
}

function checkoutPurpose({
  oneTime = true,
  recurring = true,
  domain = false
} = {}) {
  const amounts = {
    ...(oneTime
      ? {
          oneTime: {
            amountMinor: 35000,
            currency: "USD"
          }
        }
      : {}),
    ...(recurring
      ? {
          recurring: {
            amountMinor: 32500,
            currency: "USD",
            interval: "month"
          }
        }
      : {})
  };
  const refs = {
    ...(oneTime ? { oneTime: "price_site_once" } : {}),
    ...(recurring
      ? { recurring: "price_site_month" }
      : {})
  };
  const lines = [
    {
      lineItemId: "website:spark.owned_managed.2026",
      receiptGroupId:
        "website:spark.owned_managed.2026",
      amounts,
      authority: {
        type: "stripe_price_refs",
        refs
      }
    }
  ];
  if (domain) {
    lines.push({
      lineItemId: "domain:example.com",
      receiptGroupId: "domain:example.com",
      amounts: {
        oneTime: {
          amountMinor: 1499,
          currency: "USD"
        }
      },
      authority: {
        type: "server_price_data",
        priceData: {
          currency: "usd",
          unitAmount: 1499
        }
      }
    });
  }
  return {
    tenantId: "tenant_a",
    customerId: "customer_a",
    projectId: "project_a",
    quoteId: "quote_a",
    quoteVersion: 2,
    catalogVersion: "catalog_2026_07",
    offerId: "spark.owned_managed.2026",
    disclosureDigest: DISCLOSURE_DIGEST,
    lines
  };
}

function checkoutRequest(options) {
  const purpose = checkoutPurpose(options);
  return {
    idempotencyKey: "commerce:tenant_a:command_a",
    purpose,
    purposeDigest: digest(purpose)
  };
}

function downloadPurpose(overrides = {}) {
  return {
    schema:
      "sitesourcery.abracadabra-checkout-purpose.v2",
    tenantId:
      "10000000-0000-4000-8000-000000000001",
    customerId:
      "20000000-0000-4000-8000-000000000001",
    projectId:
      "30000000-0000-4000-8000-000000000001",
    versionId:
      "40000000-0000-4000-8000-000000000001",
    quoteId:
      "50000000-0000-4000-8000-000000000001",
    quoteSnapshotDigest: "c".repeat(64),
    acceptedDisclosureDigest: "d".repeat(64),
    offerId: "spark_download",
    entitlementKind: "spark_download",
    price: {
      amountMinor: 500,
      currency: "USD",
      billing: "one_time",
      interval: null
    },
    ...overrides
  };
}

function downloadRequest(overrides = {}) {
  const purpose = downloadPurpose(
    overrides.purpose
  );
  return {
    idempotencyKey:
      "download:checkout-command-1",
    purpose,
    purposeDigest: digest(purpose),
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => key !== "purpose"
      )
    )
  };
}

function downloadMetadata(purpose = downloadPurpose()) {
  return {
    schema: "sitesourcery_download_checkout_v2",
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    version_id: purpose.versionId,
    quote_id: purpose.quoteId,
    offer_id: "spark_download",
    entitlement_kind: "spark_download",
    accepted_disclosure_digest:
      purpose.acceptedDisclosureDigest,
    quote_snapshot_digest:
      purpose.quoteSnapshotDigest,
    purpose_digest: digest(purpose)
  };
}

function fakePrice(expectation, overrides = {}) {
  return {
    id: expectation.id,
    active: true,
    livemode: expectation.livemode,
    currency: expectation.currency,
    unit_amount: expectation.unitAmount,
    recurring: expectation.recurring
      ? {
          interval: expectation.recurring.interval,
          interval_count: 1
        }
      : null,
    ...overrides
  };
}

function fakeStripe({
  config = configuration(),
  priceOverrides = {},
  priceError = null,
  checkoutError = null,
  checkoutResponse = null,
  checkoutRetrieveError = null,
  checkoutRetrieveResponse = null,
  paymentIntentRetrieveError = null,
  paymentIntentRetrieveResponse = null,
  captureError = null,
  captureResponse = null,
  voidError = null,
  voidResponse = null,
  refundError = null,
  refundResponse = null,
  portalError = null,
  portalResponse = null,
  cancellationError = null,
  cancellationResponse = null,
  webhookError = null,
  webhookEvent = null
} = {}) {
  const calls = {
    prices: [],
    checkouts: [],
    checkoutReads: [],
    paymentIntentReads: [],
    captures: [],
    voids: [],
    refunds: [],
    portals: [],
    cancellations: [],
    webhooks: []
  };
  const prices = new Map(
    config.priceExpectations.map((expectation) => [
      expectation.id,
      fakePrice(
        expectation,
        priceOverrides[expectation.id]
      )
    ])
  );
  const client = {
    prices: {
      async retrieve(id) {
        calls.prices.push(id);
        if (priceError) throw priceError;
        return structuredClone(prices.get(id));
      }
    },
    checkout: {
      sessions: {
        async create(params, requestOptions) {
          calls.checkouts.push({
            params: structuredClone(params),
            requestOptions:
              structuredClone(requestOptions)
          });
          if (checkoutError) throw checkoutError;
          return (
            checkoutResponse ?? {
              id: "cs_test_checkout_1",
              url: "https://checkout.stripe.com/c/pay/test_1",
              expires_at: 1785241800,
              livemode: false
            }
          );
        },
        async retrieve(id, params) {
          calls.checkoutReads.push({
            id,
            params: structuredClone(params)
          });
          if (checkoutRetrieveError) {
            throw checkoutRetrieveError;
          }
          return structuredClone(
            checkoutRetrieveResponse
          );
        }
      }
    },
    paymentIntents: {
      async retrieve(id, params) {
        calls.paymentIntentReads.push({
          id,
          params: structuredClone(params)
        });
        if (paymentIntentRetrieveError) {
          throw paymentIntentRetrieveError;
        }
        return structuredClone(
          paymentIntentRetrieveResponse
        );
      },
      async capture(id, params, requestOptions) {
        calls.captures.push({
          id,
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (captureError) throw captureError;
        return structuredClone(captureResponse);
      },
      async cancel(id, params, requestOptions) {
        calls.voids.push({
          id,
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (voidError) throw voidError;
        return structuredClone(voidResponse);
      }
    },
    refunds: {
      async create(params, requestOptions) {
        calls.refunds.push({
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (refundError) throw refundError;
        return structuredClone(refundResponse);
      }
    },
    billingPortal: {
      sessions: {
        async create(params, requestOptions) {
          calls.portals.push({
            params: structuredClone(params),
            requestOptions:
              structuredClone(requestOptions)
          });
          if (portalError) throw portalError;
          return (
            portalResponse ?? {
              id: "bps_test_portal_1",
              url: "https://billing.stripe.com/p/session/test_1"
            }
          );
        }
      }
    },
    subscriptions: {
      async update(id, params, requestOptions) {
        calls.cancellations.push({
          id,
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (cancellationError) throw cancellationError;
        return (
          cancellationResponse ?? {
            id,
            cancel_at_period_end: true,
            current_period_end: 1787832000,
            status: "active"
          }
        );
      }
    },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        calls.webhooks.push({
          rawBody: Buffer.isBuffer(rawBody)
            ? rawBody.toString("utf8")
            : rawBody,
          signature,
          secret
        });
        if (webhookError) throw webhookError;
        return (
          webhookEvent ?? {
            id: "evt_test_1",
            type: "checkout.session.completed",
            livemode: false,
            api_version: STRIPE_API_VERSION,
            created: 1785254400,
            data: {
              object: {
                id: "cs_test_checkout_1"
              }
            }
          }
        );
      }
    }
  };
  return { calls, client };
}

function adapterFixture({
  config = configuration(),
  fake = fakeStripe({ config })
} = {}) {
  return {
    ...fake,
    adapter: createStripeProviderAdapter({
      mode: "contract_test",
      testOnly: true,
      client: fake.client,
      config,
      clock: {
        now: () => "2026-07-28T12:00:00.000Z"
      }
    })
  };
}

const DOMAIN_PURPOSE = Object.freeze({
  schema: "sitesourcery.domain-authorization.v1",
  organizationId: "organization_a",
  projectId: "project_a",
  customerId: "customer_a",
  orderId: "order_a",
  quoteId: "quote_domain_a",
  domain: "example.com",
  years: 1,
  amount: {
    amountMinor: 1499,
    currency: "USD"
  },
  captureMethod: "manual"
});
const DOMAIN_PURPOSE_DIGEST = digest(DOMAIN_PURPOSE);
const DOMAIN_CHECKOUT_EXPIRES_AT = 1785241800;
const DOMAIN_AUTHORIZED_AT = 1785240600;
const DOMAIN_CAPTURE_BEFORE = 1785845400;
const DOMAIN_CAPTURED_AT = 1785241200;
const DOMAIN_REFUNDED_AT = 1785241500;
const DOMAIN_VOIDED_AT = 1785240900;

function domainAuthorizationRequest(overrides = {}) {
  return {
    organizationId: DOMAIN_PURPOSE.organizationId,
    projectId: DOMAIN_PURPOSE.projectId,
    customerId: DOMAIN_PURPOSE.customerId,
    orderId: DOMAIN_PURPOSE.orderId,
    quoteId: DOMAIN_PURPOSE.quoteId,
    domain: DOMAIN_PURPOSE.domain,
    years: DOMAIN_PURPOSE.years,
    amountMinor: DOMAIN_PURPOSE.amount.amountMinor,
    currency: DOMAIN_PURPOSE.amount.currency,
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    successUrl:
      "https://account.sitesourcery.test/domain-orders/order_a/complete?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl:
      "https://account.sitesourcery.test/domain-orders/order_a/cancel",
    idempotencyKey:
      "domain:organization_a:order_a:authorize",
    ...overrides
  };
}

function domainMetadata(overrides = {}) {
  return {
    schema: "sitesourcery_domain_authorization_v1",
    organization_id: DOMAIN_PURPOSE.organizationId,
    project_id: DOMAIN_PURPOSE.projectId,
    customer_id: DOMAIN_PURPOSE.customerId,
    order_id: DOMAIN_PURPOSE.orderId,
    quote_id: DOMAIN_PURPOSE.quoteId,
    domain: DOMAIN_PURPOSE.domain,
    years: String(DOMAIN_PURPOSE.years),
    amount_minor: String(
      DOMAIN_PURPOSE.amount.amountMinor
    ),
    currency: DOMAIN_PURPOSE.amount.currency,
    capture_method: DOMAIN_PURPOSE.captureMethod,
    purpose_digest: DOMAIN_PURPOSE_DIGEST,
    ...overrides
  };
}

function openDomainSession(overrides = {}) {
  return {
    id: "cs_test_domain_1",
    url: "https://checkout.stripe.com/c/pay/domain_1",
    expires_at: DOMAIN_CHECKOUT_EXPIRES_AT,
    livemode: false,
    metadata: domainMetadata(),
    client_reference_id: DOMAIN_PURPOSE.orderId,
    mode: "payment",
    currency: "usd",
    amount_total: DOMAIN_PURPOSE.amount.amountMinor,
    status: "open",
    payment_intent: null,
    ...overrides
  };
}

function authorizedDomainIntent(overrides = {}) {
  return {
    id: "pi_test_domain_1",
    livemode: false,
    currency: "usd",
    amount: DOMAIN_PURPOSE.amount.amountMinor,
    capture_method: "manual",
    metadata: domainMetadata(),
    status: "requires_capture",
    amount_capturable:
      DOMAIN_PURPOSE.amount.amountMinor,
    amount_received: 0,
    latest_charge: {
      id: "ch_test_domain_1",
      payment_intent: "pi_test_domain_1",
      livemode: false,
      currency: "usd",
      amount: DOMAIN_PURPOSE.amount.amountMinor,
      amount_captured: 0,
      amount_refunded: 0,
      captured: false,
      paid: true,
      status: "succeeded",
      created: DOMAIN_AUTHORIZED_AT,
      payment_method_details: {
        type: "card",
        card: {
          capture_before: DOMAIN_CAPTURE_BEFORE
        }
      }
    },
    ...overrides
  };
}

function capturedDomainIntent({
  refundedAmount = 0,
  refunds = [],
  capturedAmount = DOMAIN_PURPOSE.amount.amountMinor,
  ...overrides
} = {}) {
  return {
    id: "pi_test_domain_1",
    livemode: false,
    currency: "usd",
    amount: DOMAIN_PURPOSE.amount.amountMinor,
    capture_method: "manual",
    metadata: domainMetadata(),
    status: "succeeded",
    amount_capturable: 0,
    amount_received: capturedAmount,
    latest_charge: {
      id: "ch_test_domain_1",
      payment_intent: "pi_test_domain_1",
      livemode: false,
      currency: "usd",
      amount: DOMAIN_PURPOSE.amount.amountMinor,
      amount_captured: capturedAmount,
      amount_refunded: refundedAmount,
      captured: true,
      paid: true,
      status: "succeeded",
      created: DOMAIN_AUTHORIZED_AT,
      balance_transaction: {
        id: "txn_test_domain_1",
        created: DOMAIN_CAPTURED_AT,
        source: "ch_test_domain_1",
        currency: "usd",
        amount: capturedAmount,
        type: "charge"
      },
      refunds: {
        data: structuredClone(refunds)
      }
    },
    ...overrides
  };
}

function canceledDomainIntent(overrides = {}) {
  return {
    id: "pi_test_domain_1",
    livemode: false,
    currency: "usd",
    amount: DOMAIN_PURPOSE.amount.amountMinor,
    capture_method: "manual",
    metadata: domainMetadata(),
    status: "canceled",
    amount_capturable: 0,
    cancellation_reason: "abandoned",
    canceled_at: DOMAIN_VOIDED_AT,
    ...overrides
  };
}

function settledDomainSession(
  paymentIntent,
  overrides = {}
) {
  return openDomainSession({
    status: "complete",
    payment_intent: paymentIntent,
    ...overrides
  });
}

test("held mode exposes every operation but cannot perform a provider effect", async () => {
  const adapter = createStripeProviderAdapter();
  assert.deepEqual(await adapter.readiness(), {
    ready: false,
    reason: "stripe_not_configured",
    provider: "stripe",
    mode: "held"
  });
  for (const operation of [
    "createCheckout",
    "createBillingPortal",
    "createDomainAuthorizationCheckout",
    "retrieveDomainAuthorization",
    "captureDomainAuthorization",
    "voidDomainAuthorization",
    "refundDomainCapture",
    "scheduleCancellation",
    "verifyWebhook"
  ]) {
    await assert.rejects(
      adapter[operation]({}),
      (error) =>
        error.code === "stripe_not_configured" &&
        error.certainty === "not_submitted"
    );
  }
});

test("contract mode requires an injected no-network test client and Stripe test mode", () => {
  const fake = fakeStripe();
  for (const options of [
    {
      mode: "contract_test",
      client: fake.client,
      config: configuration()
    },
    {
      mode: "contract_test",
      testOnly: true,
      client: fake.client,
      secretKey: "sk_test_forbidden",
      config: configuration()
    },
    {
      mode: "contract_test",
      testOnly: true,
      client: fake.client,
      config: configuration({
        livemode: true,
        priceExpectations:
          configuration().priceExpectations.map(
            (expectation) => ({
              ...expectation,
              livemode: true
            })
          )
      })
    }
  ]) {
    assert.throws(
      () => createStripeProviderAdapter(options),
      (error) => error.code === "stripe_test_mode_invalid"
    );
  }
});

test("readiness reads back every exact owner-approved Price", async () => {
  const { adapter, calls } = adapterFixture();
  assert.deepEqual(await adapter.readiness(), {
    ready: true,
    provider: "stripe",
    mode: "contract_test",
    environment: "contract_test",
    livemode: false,
    apiVersion: STRIPE_API_VERSION,
    priceCount: 2,
    domainAuthorization: true,
    webhookVerification: true,
    taxMode: "disabled_by_owner"
  });
  assert.deepEqual(calls.prices, [
    "price_site_once",
    "price_site_month"
  ]);
});

test("readiness fails closed when Stripe Price readback drifts", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    priceOverrides: {
      price_site_month: { unit_amount: 1 }
    }
  });
  const { adapter } = adapterFixture({ config, fake });
  assert.deepEqual(await adapter.readiness(), {
    ready: false,
    provider: "stripe",
    mode: "contract_test",
    environment: "contract_test",
    livemode: false,
    code: "stripe_price_mismatch"
  });
  assert.equal(fake.calls.checkouts.length, 0);
});

test("mixed website purchase creates exact subscription Checkout parameters", async () => {
  const { adapter, calls } = adapterFixture();
  const result = await adapter.createCheckout(
    checkoutRequest()
  );
  assert.deepEqual(result, {
    checkoutId: "cs_test_checkout_1",
    url: "https://checkout.stripe.com/c/pay/test_1",
    expiresAt: "2026-07-28T12:30:00.000Z"
  });
  assert.equal(calls.checkouts.length, 1);
  const [{ params, requestOptions }] = calls.checkouts;
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.line_items, [
    { price: "price_site_once", quantity: 1 },
    { price: "price_site_month", quantity: 1 }
  ]);
  assert.equal(
    params.success_url,
    "https://account.sitesourcery.test/billing/success?session_id={CHECKOUT_SESSION_ID}"
  );
  assert.equal(params.customer_creation, undefined);
  assert.equal(
    params.subscription_data.metadata.purpose_digest,
    checkoutRequest().purposeDigest
  );
  assert.equal(params.metadata.line_count, "1");
  assert.match(
    params.metadata.receipt_groups_digest,
    /^[a-f0-9]{64}$/u
  );
  assert.equal(params.automatic_tax.enabled, false);
  assert.notEqual(
    requestOptions.idempotencyKey,
    checkoutRequest().idempotencyKey
  );
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:checkout:[a-f0-9]{64}$/u
  );
});

test("one-time website purchase uses payment mode and PaymentIntent metadata", async () => {
  const { adapter, calls } = adapterFixture();
  await adapter.createCheckout(
    checkoutRequest({ recurring: false })
  );
  const [{ params }] = calls.checkouts;
  assert.equal(params.mode, "payment");
  assert.equal(params.customer_creation, "always");
  assert.equal(params.subscription_data, undefined);
  assert.equal(
    params.payment_intent_data.metadata.schema,
    "sitesourcery_checkout_v1"
  );
});

test("one-time Download creates only the exact server-priced $5 Checkout", async () => {
  const { adapter, calls } = adapterFixture();
  const request = downloadRequest();
  const result =
    await adapter.createDownloadCheckout(request);
  assert.deepEqual(result, {
    checkoutId: "cs_test_checkout_1",
    url: "https://checkout.stripe.com/c/pay/test_1",
    expiresAt: "2026-07-28T12:30:00.000Z"
  });
  assert.equal(calls.checkouts.length, 1);
  assert.equal(calls.prices.length, 0);
  const [{ params, requestOptions }] =
    calls.checkouts;
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.payment_method_types, [
    "card"
  ]);
  assert.deepEqual(params.line_items, [
    {
      price_data: {
        currency: "usd",
        unit_amount: 500,
        product_data: {
          name: "Abracadabra Download"
        }
      },
      quantity: 1
    }
  ]);
  assert.equal(
    params.client_reference_id,
    request.purpose.quoteId
  );
  assert.equal(
    params.success_url,
    configuration().successUrl
      + "&download_project="
      + encodeURIComponent(request.purpose.projectId)
  );
  assert.deepEqual(
    params.metadata,
    downloadMetadata(request.purpose)
  );
  assert.deepEqual(
    params.payment_intent_data.metadata,
    params.metadata
  );
  assert.equal(params.customer_creation, "always");
  assert.equal(params.customer, undefined);
  assert.equal(params.automatic_tax.enabled, false);
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:download_checkout:[a-f0-9]{64}$/u
  );
});

test("one-time Download reuses the account's bound Stripe Customer", async () => {
  const { adapter, calls } = adapterFixture();
  await adapter.createDownloadCheckout({
    ...downloadRequest(),
    stripeCustomerId: "cus_test_account_1"
  });
  const [{ params }] = calls.checkouts;
  assert.equal(params.customer, "cus_test_account_1");
  assert.equal(params.customer_creation, undefined);
  assert.equal(
    params.billing_address_collection,
    undefined
  );
  assert.equal(params.customer_update, undefined);
});

test("Download Checkout rejects changed money and purpose before Stripe", async () => {
  const { adapter, calls } = adapterFixture();
  for (const request of [
    downloadRequest({
      purpose: {
        price: {
          amountMinor: 501,
          currency: "USD",
          billing: "one_time",
          interval: null
        }
      }
    }),
    {
      ...downloadRequest(),
      purposeDigest: "f".repeat(64)
    },
    {
      ...downloadRequest(),
      provider: "stripe"
    }
  ]) {
    await assert.rejects(
      adapter.createDownloadCheckout(request),
      (error) =>
        error.code ===
        "stripe_download_checkout_invalid"
    );
  }
  assert.equal(calls.checkouts.length, 0);
});

test("Download settlement reads back one exact paid Checkout and expanded PaymentIntent", async () => {
  const purpose = downloadPurpose();
  const metadata = downloadMetadata(purpose);
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: {
      id: "cs_test_download_1",
      client_reference_id: purpose.quoteId,
      mode: "payment",
      livemode: false,
      status: "complete",
      payment_status: "paid",
      currency: "usd",
      amount_subtotal: 500,
      amount_total: 500,
      automatic_tax: {
        enabled: false,
        status: null
      },
      customer: "cus_test_download_1",
      metadata,
      payment_intent: {
        id: "pi_test_download_1",
        livemode: false,
        status: "succeeded",
        currency: "usd",
        amount: 500,
        amount_received: 500,
        amount_capturable: 0,
        metadata
      }
    }
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const facts =
    await adapter.retrieveDownloadCheckout({
      checkoutSessionId: "cs_test_download_1",
      purpose,
      purposeDigest: digest(purpose)
    });
  assert.deepEqual(facts, {
    schema:
      "sitesourcery.stripe-download-payment-facts/v2",
    provider: "stripe",
    checkoutSessionId: "cs_test_download_1",
    paymentIntentId: "pi_test_download_1",
    customerId: "cus_test_download_1",
    paymentStatus: "paid",
    amountMinor: 500,
    taxMinor: 0,
    totalMinor: 500,
    taxMode: "disabled_by_owner",
    currency: "USD",
    purposeDigest: digest(purpose)
  });
  assert.deepEqual(calls.checkoutReads, [
    {
      id: "cs_test_download_1",
      params: { expand: ["payment_intent"] }
    }
  ]);
});

test("expired Download Checkout readback proves unpaid before another payment can open", async () => {
  const purpose = downloadPurpose();
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: {
      id: "cs_test_download_1",
      client_reference_id: purpose.quoteId,
      mode: "payment",
      livemode: false,
      status: "expired",
      payment_status: "unpaid",
      currency: "usd",
      amount_subtotal: 500,
      automatic_tax: {
        enabled: false,
        status: null
      },
      metadata: downloadMetadata(purpose)
    }
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  assert.deepEqual(
    await adapter.retrieveDownloadCheckoutLifecycle({
      checkoutSessionId: "cs_test_download_1",
      purpose,
      purposeDigest: digest(purpose)
    }),
    {
      schema:
        "sitesourcery.stripe-download-checkout-lifecycle/v2",
      provider: "stripe",
      checkoutSessionId: "cs_test_download_1",
      state: "expired_unpaid"
    }
  );
  assert.deepEqual(calls.checkoutReads, [
    {
      id: "cs_test_download_1",
      params: undefined
    }
  ]);
});

test("automatic tax Download collects an address and reconciles item, tax, and total separately", async () => {
  const purpose = downloadPurpose();
  const metadata = downloadMetadata(purpose);
  const config = configuration({ taxMode: "automatic" });
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: {
      id: "cs_test_download_1",
      client_reference_id: purpose.quoteId,
      mode: "payment",
      livemode: false,
      status: "complete",
      payment_status: "paid",
      currency: "usd",
      amount_subtotal: 500,
      amount_total: 533,
      automatic_tax: {
        enabled: true,
        status: "complete"
      },
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 33
      },
      customer: "cus_test_download_1",
      metadata,
      payment_intent: {
        id: "pi_test_download_1",
        livemode: false,
        status: "succeeded",
        currency: "usd",
        amount: 533,
        amount_received: 533,
        amount_capturable: 0,
        metadata
      }
    }
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  await adapter.createDownloadCheckout({
    ...downloadRequest(),
    stripeCustomerId: "cus_test_account_1"
  });
  const [{ params }] = calls.checkouts;
  assert.deepEqual(params.automatic_tax, {
    enabled: true
  });
  assert.equal(
    params.line_items[0].price_data.tax_behavior,
    "exclusive"
  );
  assert.equal(
    params.billing_address_collection,
    "required"
  );
  assert.deepEqual(params.customer_update, {
    address: "auto"
  });
  assert.deepEqual(
    await adapter.retrieveDownloadCheckout({
      checkoutSessionId: "cs_test_download_1",
      purpose,
      purposeDigest: digest(purpose)
    }),
    {
      schema:
        "sitesourcery.stripe-download-payment-facts/v2",
      provider: "stripe",
      checkoutSessionId: "cs_test_download_1",
      paymentIntentId: "pi_test_download_1",
      customerId: "cus_test_download_1",
      paymentStatus: "paid",
      amountMinor: 500,
      taxMinor: 33,
      totalMinor: 533,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: digest(purpose)
    }
  );
});

test("Download settlement rejects signed-event money without matching Stripe readback", async () => {
  const purpose = downloadPurpose();
  const metadata = downloadMetadata(purpose);
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: {
      id: "cs_test_download_1",
      client_reference_id: purpose.quoteId,
      mode: "payment",
      livemode: false,
      status: "complete",
      payment_status: "paid",
      currency: "usd",
      amount_subtotal: 500,
      amount_total: 1,
      automatic_tax: {
        enabled: false,
        status: null
      },
      customer: "cus_test_download_1",
      metadata,
      payment_intent: {
        id: "pi_test_download_1",
        livemode: false,
        status: "succeeded",
        currency: "usd",
        amount: 1,
        amount_received: 1,
        amount_capturable: 0,
        metadata
      }
    }
  });
  const { adapter } = adapterFixture({
    config,
    fake
  });
  await assert.rejects(
    adapter.retrieveDownloadCheckout({
      checkoutSessionId: "cs_test_download_1",
      purpose,
      purposeDigest: digest(purpose)
    }),
    (error) =>
      error.code ===
      "stripe_download_checkout_response_invalid"
  );
});

test("checkout rejects a forged purpose digest before any Stripe call", async () => {
  const { adapter, calls } = adapterFixture();
  await assert.rejects(
    adapter.createCheckout({
      ...checkoutRequest(),
      purposeDigest: "f".repeat(64)
    }),
    (error) =>
      error.code === "stripe_checkout_purpose_invalid"
  );
  assert.equal(calls.prices.length, 0);
  assert.equal(calls.checkouts.length, 0);
});

test("checkout rejects money that does not match an approved Price before creating a Session", async () => {
  const { adapter, calls } = adapterFixture();
  const request = checkoutRequest();
  request.purpose.lines[0].amounts.oneTime.amountMinor = 1;
  request.purposeDigest = digest(request.purpose);
  await assert.rejects(
    adapter.createCheckout(request),
    (error) => error.code === "stripe_price_not_authorized"
  );
  assert.equal(calls.checkouts.length, 0);
});

test("ordinary Checkout holds domain money for the separate authorize-register-capture workflow", async () => {
  const { adapter, calls } = adapterFixture();
  await assert.rejects(
    adapter.createCheckout(
      checkoutRequest({ domain: true })
    ),
    (error) =>
      error.code === "stripe_domain_checkout_held" &&
      error.certainty === "not_submitted"
  );
  assert.equal(calls.prices.length, 0);
  assert.equal(calls.checkouts.length, 0);
});

test("domain purchase creates an exact manual-capture Checkout separate from website Checkout", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutResponse: openDomainSession()
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const request = domainAuthorizationRequest();
  assert.deepEqual(
    await adapter.createDomainAuthorizationCheckout(
      request
    ),
    {
      status: "open",
      checkoutSessionId: "cs_test_domain_1",
      url:
        "https://checkout.stripe.com/c/pay/domain_1",
      expiresAt: "2026-07-28T12:30:00.000Z",
      amountMinor: 1499,
      currency: "USD",
      captureMethod: "manual",
      purposeDigest: DOMAIN_PURPOSE_DIGEST
    }
  );
  assert.equal(calls.prices.length, 0);
  assert.equal(calls.checkouts.length, 1);
  const [{ params, requestOptions }] =
    calls.checkouts;
  const metadata = domainMetadata();
  assert.deepEqual(params, {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: 1499,
          product_data: {
            name: "example.com registration — 1 year",
            description:
              "Authorized now; captured only after registrar and registrant readback.",
            metadata
          }
        },
        quantity: 1
      }
    ],
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    client_reference_id: "order_a",
    metadata,
    expires_at: DOMAIN_CHECKOUT_EXPIRES_AT,
    customer_creation: "always",
    automatic_tax: { enabled: false },
    payment_intent_data: {
      capture_method: "manual",
      metadata
    },
    custom_text: {
      submit: {
        message:
          config.domainAuthorization
            .authorizationDisclosure
      }
    }
  });
  assert.equal(
    requestOptions.idempotencyKey,
    `ss:domain_authorization:${digest({
      operation: "domain_authorization",
      operatorKey: request.idempotencyKey,
      purposeDigest: DOMAIN_PURPOSE_DIGEST
    })}`
  );
});

test("domain Checkout rejects forged purpose, money, and return routes before Stripe", async () => {
  const { adapter, calls } = adapterFixture();
  for (const [request, code] of [
    [
      domainAuthorizationRequest({
        purposeDigest: "f".repeat(64)
      }),
      "stripe_domain_authorization_invalid"
    ],
    [
      domainAuthorizationRequest({
        amountMinor: 1500
      }),
      "stripe_domain_authorization_invalid"
    ],
    [
      domainAuthorizationRequest({
        successUrl:
          "https://account.sitesourcery.test/domain-orders/order_b/complete?session_id={CHECKOUT_SESSION_ID}"
      }),
      "stripe_redirect_invalid"
    ]
  ]) {
    await assert.rejects(
      adapter.createDomainAuthorizationCheckout(
        request
      ),
      (error) => error.code === code
    );
  }
  assert.equal(calls.checkouts.length, 0);
});

test("domain Checkout transport and unsafe post-effect responses remain ambiguous", async () => {
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutError: new Error("timeout")
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.createDomainAuthorizationCheckout(
          domainAuthorizationRequest()
        ),
      (error) =>
        error.code ===
          "stripe_domain_checkout_effect_unknown" &&
        error.certainty === "ambiguous" &&
        /^ss:domain_authorization:/u.test(
          error.details.idempotencyKey
        )
    );
  }
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutResponse: openDomainSession({
        metadata: domainMetadata({
          amount_minor: "1500"
        })
      })
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.createDomainAuthorizationCheckout(
          domainAuthorizationRequest()
        ),
      (error) =>
        error.code ===
          "stripe_domain_authorization_response_invalid" &&
        error.certainty === "ambiguous"
    );
  }
});

test("domain authorization readback projects pending, authorized, captured, refunded, voided, and manual-review states", async () => {
  const refund = {
    id: "re_test_domain_1",
    status: "succeeded",
    payment_intent: "pi_test_domain_1",
    charge: "ch_test_domain_1",
    currency: "usd",
    amount: 499,
    created: DOMAIN_REFUNDED_AT
  };
  const scenarios = [
    {
      response: openDomainSession(),
      status: "pending",
      expected: {
        paymentIntentId: null,
        capturedAmountMinor: 0,
        refundedAmountMinor: 0
      }
    },
    {
      response: settledDomainSession(
        authorizedDomainIntent()
      ),
      status: "authorized",
      expected: {
        paymentIntentId: "pi_test_domain_1",
        authorizedAt: new Date(
          DOMAIN_AUTHORIZED_AT * 1000
        ).toISOString(),
        authorizationExpiresAt: new Date(
          DOMAIN_CAPTURE_BEFORE * 1000
        ).toISOString()
      }
    },
    {
      response: settledDomainSession(
        capturedDomainIntent()
      ),
      status: "captured",
      expected: {
        paymentIntentId: "pi_test_domain_1",
        captureId: "ch_test_domain_1",
        capturedAmountMinor: 1499,
        refundedAmountMinor: 0,
        capturedAt: new Date(
          DOMAIN_CAPTURED_AT * 1000
        ).toISOString()
      }
    },
    {
      response: settledDomainSession(
        capturedDomainIntent({
          refundedAmount: 499,
          refunds: [refund]
        })
      ),
      status: "refunded",
      expected: {
        paymentIntentId: "pi_test_domain_1",
        captureId: "ch_test_domain_1",
        capturedAmountMinor: 1499,
        refundedAmountMinor: 499,
        refundedAt: new Date(
          DOMAIN_REFUNDED_AT * 1000
        ).toISOString()
      }
    },
    {
      response: settledDomainSession(
        canceledDomainIntent()
      ),
      status: "voided",
      expected: {
        paymentIntentId: "pi_test_domain_1",
        voidedAt: new Date(
          DOMAIN_VOIDED_AT * 1000
        ).toISOString()
      }
    },
    {
      response: settledDomainSession(
        "pi_test_domain_1"
      ),
      status: "manual_review",
      expected: {
        paymentIntentId: null,
        capturedAmountMinor: 0
      }
    }
  ];
  for (const scenario of scenarios) {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        scenario.response
    });
    const result = await adapterFixture({
      config,
      fake
    }).adapter.retrieveDomainAuthorization({
      checkoutSessionId: "cs_test_domain_1",
      orderId: "order_a",
      purposeDigest: DOMAIN_PURPOSE_DIGEST
    });
    assert.equal(result.status, scenario.status);
    assert.equal(result.checkoutSessionId,
      "cs_test_domain_1");
    assert.equal(result.amountMinor, 1499);
    assert.equal(result.currency, "USD");
    assert.equal(result.captureMethod, "manual");
    assert.equal(
      result.purposeDigest,
      DOMAIN_PURPOSE_DIGEST
    );
    for (const [key, value] of Object.entries(
      scenario.expected
    )) {
      assert.equal(result[key], value);
    }
    assert.deepEqual(
      fake.calls.checkoutReads[0],
      {
        id: "cs_test_domain_1",
        params: {
          expand: [
            "payment_intent.latest_charge.balance_transaction",
            "payment_intent.latest_charge.refunds"
          ]
        }
      }
    );
  }
});

test("domain authorization readback fails closed on session money or identity drift", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: openDomainSession({
      amount_total: 1
    })
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.retrieveDomainAuthorization({
        checkoutSessionId: "cs_test_domain_1",
        orderId: "order_a",
        purposeDigest: DOMAIN_PURPOSE_DIGEST
      }),
    (error) =>
      error.code ===
      "stripe_domain_authorization_response_invalid"
  );
});

test("domain capture reconciles first, captures the exact authorization once, and returns provider proof", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      settledDomainSession(
        authorizedDomainIntent()
      ),
    captureResponse: capturedDomainIntent({
      capturedAmount: 1299
    })
  });
  const result = await adapterFixture({
    config,
    fake
  }).adapter.captureDomainAuthorization({
    checkoutSessionId: "cs_test_domain_1",
    paymentIntentId: "pi_test_domain_1",
    orderId: "order_a",
    amountMinor: 1299,
    currency: "USD",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    idempotencyKey:
      "domain:order_a:capture:attempt_1"
  });
  assert.deepEqual(result, {
    status: "captured",
    paymentIntentId: "pi_test_domain_1",
    captureId: "ch_test_domain_1",
    amountMinor: 1299,
    currency: "USD",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    capturedAt: new Date(
      DOMAIN_CAPTURED_AT * 1000
    ).toISOString()
  });
  assert.equal(fake.calls.checkoutReads.length, 1);
  assert.equal(fake.calls.captures.length, 1);
  assert.deepEqual(fake.calls.captures[0].params, {
    amount_to_capture: 1299,
    final_capture: true,
    metadata: {
      domain_capture_purpose_digest:
        DOMAIN_PURPOSE_DIGEST,
      domain_capture_order_id: "order_a"
    },
    expand: [
      "latest_charge.balance_transaction"
    ]
  });
  assert.match(
    fake.calls.captures[0].requestOptions
      .idempotencyKey,
    /^ss:domain_capture:[a-f0-9]{64}$/u
  );
});

test("domain capture will not over-capture and treats post-submit uncertainty as ambiguous", async () => {
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        settledDomainSession(
          authorizedDomainIntent()
        )
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.captureDomainAuthorization({
          checkoutSessionId: "cs_test_domain_1",
          paymentIntentId: "pi_test_domain_1",
          orderId: "order_a",
          amountMinor: 1500,
          currency: "USD",
          purposeDigest: DOMAIN_PURPOSE_DIGEST,
          idempotencyKey:
            "domain:order_a:capture:over"
        }),
      (error) =>
        error.code ===
        "stripe_domain_capture_invalid"
    );
    assert.equal(fake.calls.captures.length, 0);
  }
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        settledDomainSession(
          authorizedDomainIntent()
        ),
      captureError: new Error("timeout")
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.captureDomainAuthorization({
          checkoutSessionId: "cs_test_domain_1",
          paymentIntentId: "pi_test_domain_1",
          orderId: "order_a",
          amountMinor: 1499,
          currency: "USD",
          purposeDigest: DOMAIN_PURPOSE_DIGEST,
          idempotencyKey:
            "domain:order_a:capture:timeout"
        }),
      (error) =>
        error.code ===
          "stripe_domain_capture_effect_unknown" &&
        error.certainty === "ambiguous"
    );
  }
});

test("domain authorization void reads back the exact PaymentIntent before releasing the hold", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    paymentIntentRetrieveResponse:
      authorizedDomainIntent(),
    voidResponse: canceledDomainIntent()
  });
  const result = await adapterFixture({
    config,
    fake
  }).adapter.voidDomainAuthorization({
    paymentIntentId: "pi_test_domain_1",
    orderId: "order_a",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    idempotencyKey:
      "domain:order_a:void:attempt_1"
  });
  assert.deepEqual(result, {
    status: "voided",
    paymentIntentId: "pi_test_domain_1",
    voidId: "pi_test_domain_1",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    voidedAt: new Date(
      DOMAIN_VOIDED_AT * 1000
    ).toISOString()
  });
  assert.deepEqual(fake.calls.paymentIntentReads, [
    {
      id: "pi_test_domain_1",
      params: { expand: ["latest_charge"] }
    }
  ]);
  assert.deepEqual(fake.calls.voids[0].params, {
    cancellation_reason: "abandoned"
  });
  assert.match(
    fake.calls.voids[0].requestOptions.idempotencyKey,
    /^ss:domain_void:[a-f0-9]{64}$/u
  );
});

test("domain refund reconciles captured balance and records exact operator evidence", async () => {
  const config = configuration();
  const reason =
    "registrar could not complete registration";
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      settledDomainSession(
        capturedDomainIntent()
      ),
    refundResponse: {
      id: "re_test_domain_1",
      status: "succeeded",
      payment_intent: "pi_test_domain_1",
      charge: "ch_test_domain_1",
      amount: 1499,
      currency: "usd",
      created: DOMAIN_REFUNDED_AT,
      metadata: {
        schema: "sitesourcery_domain_refund_v1",
        order_id: "order_a",
        purpose_digest: DOMAIN_PURPOSE_DIGEST,
        operator_evidence_id: "evidence_a",
        reason_digest: digest(reason)
      }
    }
  });
  const result = await adapterFixture({
    config,
    fake
  }).adapter.refundDomainCapture({
    checkoutSessionId: "cs_test_domain_1",
    paymentIntentId: "pi_test_domain_1",
    captureId: "ch_test_domain_1",
    orderId: "order_a",
    amountMinor: 1499,
    currency: "USD",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    reason,
    operatorEvidenceId: "evidence_a",
    idempotencyKey:
      "domain:order_a:refund:attempt_1"
  });
  assert.deepEqual(result, {
    status: "refunded",
    paymentIntentId: "pi_test_domain_1",
    captureId: "ch_test_domain_1",
    refundId: "re_test_domain_1",
    amountMinor: 1499,
    currency: "USD",
    purposeDigest: DOMAIN_PURPOSE_DIGEST,
    refundedAt: new Date(
      DOMAIN_REFUNDED_AT * 1000
    ).toISOString()
  });
  assert.deepEqual(fake.calls.refunds[0].params, {
    payment_intent: "pi_test_domain_1",
    amount: 1499,
    reason: "requested_by_customer",
    metadata: {
      schema: "sitesourcery_domain_refund_v1",
      order_id: "order_a",
      purpose_digest: DOMAIN_PURPOSE_DIGEST,
      operator_evidence_id: "evidence_a",
      reason_digest: digest(reason)
    }
  });
  assert.match(
    fake.calls.refunds[0].requestOptions.idempotencyKey,
    /^ss:domain_refund:[a-f0-9]{64}$/u
  );
});

test("domain refund rejects an amount above the reconciled balance and keeps provider failures ambiguous", async () => {
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        settledDomainSession(
          capturedDomainIntent({
            refundedAmount: 1000,
            refunds: [
              {
                id: "re_test_domain_prior",
                status: "succeeded",
                payment_intent:
                  "pi_test_domain_1",
                charge: "ch_test_domain_1",
                currency: "usd",
                amount: 1000,
                created: DOMAIN_REFUNDED_AT
              }
            ]
          })
        )
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.refundDomainCapture({
          checkoutSessionId: "cs_test_domain_1",
          paymentIntentId: "pi_test_domain_1",
          captureId: "ch_test_domain_1",
          orderId: "order_a",
          amountMinor: 500,
          currency: "USD",
          purposeDigest: DOMAIN_PURPOSE_DIGEST,
          reason: "requested correction",
          operatorEvidenceId: "evidence_b",
          idempotencyKey:
            "domain:order_a:refund:over"
        }),
      (error) =>
        error.code ===
        "stripe_domain_refund_invalid"
    );
    assert.equal(fake.calls.refunds.length, 0);
  }
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        settledDomainSession(
          capturedDomainIntent()
        ),
      refundError: new Error("timeout")
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.refundDomainCapture({
          checkoutSessionId: "cs_test_domain_1",
          paymentIntentId: "pi_test_domain_1",
          captureId: "ch_test_domain_1",
          orderId: "order_a",
          amountMinor: 1499,
          currency: "USD",
          purposeDigest: DOMAIN_PURPOSE_DIGEST,
          reason: "registrar failure",
          operatorEvidenceId: "evidence_c",
          idempotencyKey:
            "domain:order_a:refund:timeout"
        }),
      (error) =>
        error.code ===
          "stripe_domain_refund_effect_unknown" &&
        error.certainty === "ambiguous"
    );
  }
});

test("Checkout transport failures and unsafe post-effect responses stay ambiguous", async () => {
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutError: new Error("timeout")
    });
    const { adapter } = adapterFixture({ config, fake });
    await assert.rejects(
      adapter.createCheckout(checkoutRequest()),
      (error) =>
        error.code === "stripe_checkout_effect_unknown" &&
        error.certainty === "ambiguous" &&
        /^ss:checkout:/u.test(
          error.details.idempotencyKey
        )
    );
  }
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutResponse: {
        id: "cs_test_checkout_unsafe",
        url: "https://attacker.example/session",
        expires_at: 1785241800,
        livemode: false
      }
    });
    const { adapter } = adapterFixture({ config, fake });
    await assert.rejects(
      adapter.createCheckout(checkoutRequest()),
      (error) =>
        error.code ===
          "stripe_checkout_response_invalid" &&
        error.certainty === "ambiguous"
    );
  }
  {
    const config = configuration();
    const fake = fakeStripe({
      config,
      checkoutResponse: {
        id: "cs_test_checkout_wrong_expiry",
        url: "https://checkout.stripe.com/c/pay/test_2",
        expires_at: 1785241801,
        livemode: false
      }
    });
    const { adapter } = adapterFixture({ config, fake });
    await assert.rejects(
      adapter.createCheckout(checkoutRequest()),
      (error) =>
        error.code ===
          "stripe_checkout_response_invalid" &&
        error.certainty === "ambiguous"
    );
  }
});

test("billing portal is exact and unsafe post-effect responses are ambiguous", async () => {
  const { adapter, calls } = adapterFixture();
  assert.deepEqual(
    await adapter.createBillingPortal({
      stripeCustomerId: "cus_test_customer_1",
      idempotencyKey: "portal:command_1"
    }),
    {
      portalSessionId: "bps_test_portal_1",
      url: "https://billing.stripe.com/p/session/test_1"
    }
  );
  assert.deepEqual(calls.portals[0].params, {
    customer: "cus_test_customer_1",
    return_url:
      "https://account.sitesourcery.test/account"
  });
  assert.match(
    calls.portals[0].requestOptions.idempotencyKey,
    /^ss:billing_portal:[a-f0-9]{64}$/u
  );

  const config = configuration();
  const unsafe = fakeStripe({
    config,
    portalResponse: {
      id: "bps_test_portal_unsafe",
      url: "https://attacker.example/portal"
    }
  });
  const unsafeAdapter = adapterFixture({
    config,
    fake: unsafe
  }).adapter;
  await assert.rejects(
    unsafeAdapter.createBillingPortal({
      stripeCustomerId: "cus_test_customer_1",
      idempotencyKey: "portal:command_2"
    }),
    (error) =>
      error.code ===
        "stripe_billing_portal_response_invalid" &&
      error.certainty === "ambiguous"
  );
});

test("cancellation schedules period-end only and unsafe confirmation is ambiguous", async () => {
  const { adapter, calls } = adapterFixture();
  const result = await adapter.scheduleCancellation({
    stripeSubscriptionId: "sub_test_subscription_1",
    idempotencyKey: "cancel:command_1",
    cancellationDigest: CANCELLATION_DIGEST
  });
  assert.equal(result.cancelAtPeriodEnd, true);
  assert.equal(
    result.effectiveAt,
    "2026-08-27T12:00:00.000Z"
  );
  assert.deepEqual(calls.cancellations[0].params, {
    cancel_at_period_end: true,
    metadata: {
      cancellation_digest: CANCELLATION_DIGEST
    }
  });
  assert.match(
    calls.cancellations[0].requestOptions.idempotencyKey,
    /^ss:subscription_cancel:[a-f0-9]{64}$/u
  );

  const config = configuration();
  const unsafe = fakeStripe({
    config,
    cancellationResponse: {
      id: "sub_test_subscription_1",
      cancel_at_period_end: false,
      current_period_end: 1787832000,
      status: "active"
    }
  });
  await assert.rejects(
    adapterFixture({ config, fake: unsafe })
      .adapter.scheduleCancellation({
        stripeSubscriptionId:
          "sub_test_subscription_1",
        idempotencyKey: "cancel:command_2",
        cancellationDigest: CANCELLATION_DIGEST
      }),
    (error) =>
      error.code ===
        "stripe_subscription_response_invalid" &&
      error.certainty === "ambiguous"
  );
});

test("webhooks require raw bytes, an exact signature, and matching livemode", async () => {
  const { adapter, calls } = adapterFixture();
  const rawBody = Buffer.from(
    '{"id":"evt_test_1"}',
    "utf8"
  );
  const event = await adapter.verifyWebhook({
    rawBody,
    signature: "t=1,v1=signature"
  });
  assert.equal(event.id, "evt_test_1");
  assert.deepEqual(calls.webhooks, [
    {
      rawBody: '{"id":"evt_test_1"}',
      signature: "t=1,v1=signature",
      secret: "whsec_contract_test"
    }
  ]);
  for (const request of [
    {
      rawBody: { parsed: true },
      signature: "t=1,v1=signature"
    },
    { rawBody, signature: "" }
  ]) {
    await assert.rejects(
      adapter.verifyWebhook(request),
      (error) => error.status === 400
    );
  }

  const config = configuration();
  const wrongMode = fakeStripe({
    config,
    webhookEvent: {
      id: "evt_test_wrong_mode",
      type: "customer.subscription.updated",
      livemode: true,
      api_version: STRIPE_API_VERSION,
      created: 1785254400,
      data: { object: { id: "sub_test_1" } }
    }
  });
  await assert.rejects(
    adapterFixture({ config, fake: wrongMode })
      .adapter.verifyWebhook({
        rawBody,
        signature: "t=1,v1=signature"
      }),
    (error) =>
      error.code === "stripe_webhook_event_invalid" &&
      error.status === 400
  );

  const wrongVersion = fakeStripe({
    config,
    webhookEvent: {
      id: "evt_test_wrong_version",
      type: "customer.subscription.updated",
      livemode: false,
      api_version: "unreviewed",
      created: 1785254400,
      data: { object: { id: "sub_test_1" } }
    }
  });
  await assert.rejects(
    adapterFixture({ config, fake: wrongVersion })
      .adapter.verifyWebhook({
        rawBody,
        signature: "t=1,v1=signature"
      }),
    (error) =>
      error.code === "stripe_webhook_event_invalid" &&
      error.status === 400
  );
});

test("webhook signature failures are public-safe 400 errors", async () => {
  const config = configuration();
  const fake = fakeStripe({
    config,
    webhookError: new Error("bad signature")
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.verifyWebhook({
        rawBody: Buffer.from("{}"),
        signature: "bad"
      }),
    (error) =>
      error.code ===
        "stripe_webhook_signature_invalid" &&
      error.status === 400
  );
});

test("approved effects require exact owner approval and a pinned official client", () => {
  const fake = fakeStripe();
  const approval = {
    provider: "stripe",
    approved: true,
    approvalId: "approval_2026_07_28",
    approvedAt: "2026-07-28T12:00:00.000Z",
    environment: "staging",
    livemode: false,
    apiVersion: STRIPE_API_VERSION,
    capabilities: [
      "prices:read",
      "checkout:create",
      "webhooks:verify"
    ]
  };
  assert.throws(
    () =>
      createStripeProviderAdapter({
        mode: "approved_live",
        client: fake.client,
        config: configuration(),
        liveApproval: approval
      }),
    (error) => error.code === "stripe_client_invalid"
  );
  assert.throws(
    () =>
      createStripeProviderAdapter({
        mode: "approved_live",
        client: fake.client,
        config: configuration(),
        liveApproval: {
          ...approval,
          apiVersion: "unreviewed"
        }
      }),
    (error) =>
      error.code === "stripe_live_approval_missing"
  );
});

test("official client construction enforces pinned version and key/mode pairing without exposing the key", () => {
  for (const input of [
    {
      secretKey: "sk_live_wrong",
      livemode: false
    },
    {
      secretKey: "sk_test_wrong",
      livemode: true
    },
    {
      secretKey: "sk_test_wrong_version",
      livemode: false,
      apiVersion: "unreviewed"
    }
  ]) {
    assert.throws(
      () => createOfficialStripeClient(input),
      (error) =>
        error.code === "stripe_configuration_required" &&
        !error.message.includes(input.secretKey)
    );
  }
  const client = createOfficialStripeClient({
    secretKey: "sk_test_contract_only",
    livemode: false
  });
  assert.equal(typeof client.checkout.sessions.create, "function");
});
