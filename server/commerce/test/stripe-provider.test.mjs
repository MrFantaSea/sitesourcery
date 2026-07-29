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
        }
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

test("held mode exposes every operation but cannot perform a provider effect", async () => {
  const adapter = createStripeProviderAdapter();
  assert.deepEqual(await adapter.readiness(), {
    ready: false,
    reason: "stripe_not_configured"
  });
  for (const operation of [
    "createCheckout",
    "createBillingPortal",
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
