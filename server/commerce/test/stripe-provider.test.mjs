import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../domain/canonical.mjs";
import {
  STRIPE_API_VERSION,
  STRIPE_ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA,
  STRIPE_ALAKAZAM_PURPOSE_SCHEMA,
  createOfficialStripeClient,
  createStripeProviderAdapter
} from "../adapters/stripe.mjs";

const DISCLOSURE_DIGEST = "a".repeat(64);
const CANCELLATION_DIGEST = "b".repeat(64);
const ALAKAZAM_PRODUCT_ID = "prod_alakazam";
const ALAKAZAM_COUPON_ID =
  "alakazam_download_credit_500";
const ALAKAZAM_PORTAL_CONFIGURATION_ID =
  "bpc_alakazam_restricted";
const ALAKAZAM_PRICE_IDS = Object.freeze({
  alakazam_25: "price_alakazam_25",
  alakazam_35: "price_alakazam_35",
  alakazam_50: "price_alakazam_50"
});
const ALAKAZAM_PERIOD_START =
  "2026-08-01T12:00:00.000Z";
const ALAKAZAM_PERIOD_END =
  "2026-09-01T12:00:00.000Z";

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

function alakazamConfiguration(overrides = {}) {
  const base = configuration();
  return configuration({
    priceExpectations: [
      ...base.priceExpectations,
      ...Object.entries(ALAKAZAM_PRICE_IDS).map(
        ([tierId, id]) => ({
          id,
          productId: ALAKAZAM_PRODUCT_ID,
          currency: "usd",
          unitAmount: {
            alakazam_25: 2500,
            alakazam_35: 3500,
            alakazam_50: 5000
          }[tierId],
          livemode: false,
          recurring: {
            interval: "month",
            intervalCount: 1
          }
        })
      )
    ],
    alakazam: {
      productId: ALAKAZAM_PRODUCT_ID,
      downloadCreditCouponId: ALAKAZAM_COUPON_ID,
      portalConfigurationId:
        ALAKAZAM_PORTAL_CONFIGURATION_ID,
      tierPriceIds: ALAKAZAM_PRICE_IDS
    },
    ...overrides
  });
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

function serviceAssessmentPurpose(overrides = {}) {
  return {
    schema:
      "sitesourcery.custom-services-assessment-checkout-purpose/v1",
    tenantId:
      "10000000-0000-4000-8000-000000000001",
    customerId:
      "20000000-0000-4000-8000-000000000001",
    projectId:
      "30000000-0000-4000-8000-000000000001",
    invoiceId:
      "60000000-0000-4000-8000-000000000001",
    invoiceNumber:
      "SSA-60000000000040008000000000000001",
    quoteId:
      "50000000-0000-4000-8000-000000000001",
    acceptedDisclosureDigest: "e".repeat(64),
    invoiceDigest: "f".repeat(64),
    price: {
      amountMinor: 20000,
      currency: "USD",
      billing: "one_time",
      taxBehavior: "automatic_exclusive"
    },
    ...overrides
  };
}

function serviceAssessmentRequest(overrides = {}) {
  const purpose = serviceAssessmentPurpose(
    overrides.purpose
  );
  return {
    idempotencyKey: "assessment:checkout-command-1",
    purpose,
    purposeDigest: digest(purpose),
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => key !== "purpose"
      )
    )
  };
}

function serviceAssessmentMetadata(
  purpose = serviceAssessmentPurpose()
) {
  return {
    schema:
      "sitesourcery_service_assessment_checkout_v1",
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    invoice_id: purpose.invoiceId,
    invoice_number: purpose.invoiceNumber,
    quote_id: purpose.quoteId,
    accepted_disclosure_digest:
      purpose.acceptedDisclosureDigest,
    invoice_digest: purpose.invoiceDigest,
    purpose_digest: digest(purpose)
  };
}

function serviceAssessmentReadRequest(
  overrides = {}
) {
  const purpose = serviceAssessmentPurpose(
    overrides.purpose
  );
  return {
    checkoutSessionId:
      "cs_test_service_assessment_1",
    purpose,
    purposeDigest: digest(purpose),
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => key !== "purpose"
      )
    )
  };
}

function serviceAssessmentCheckoutReadback({
  purpose = serviceAssessmentPurpose(),
  taxMinor = 0,
  status = "complete",
  paymentStatus = "paid",
  overrides = {}
} = {}) {
  const subtotalMinor = 20000;
  const totalMinor = subtotalMinor + taxMinor;
  const metadata = serviceAssessmentMetadata(purpose);
  const customerId = "cus_test_service_assessment_1";
  const paymentIntentId =
    "pi_test_service_assessment_1";
  return {
    id: "cs_test_service_assessment_1",
    client_reference_id: purpose.invoiceId,
    livemode: false,
    mode: "payment",
    currency: "usd",
    amount_subtotal: subtotalMinor,
    amount_total: totalMinor,
    automatic_tax: {
      enabled: true,
      status: status === "complete" ? "complete" : null
    },
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: taxMinor
    },
    status,
    payment_status: paymentStatus,
    customer: customerId,
    metadata,
    payment_intent: {
      id: paymentIntentId,
      livemode: false,
      status: "succeeded",
      currency: "usd",
      amount: totalMinor,
      amount_received: totalMinor,
      amount_capturable: 0,
      customer: customerId,
      metadata,
      latest_charge: {
        id: "ch_test_service_assessment_1",
        livemode: false,
        status: "succeeded",
        paid: true,
        captured: true,
        refunded: false,
        currency: "usd",
        amount: totalMinor,
        amount_captured: totalMinor,
        amount_refunded: 0,
        customer: customerId,
        payment_intent: paymentIntentId,
        created: 1785672000
      }
    },
    ...overrides
  };
}

function alakazamCurrent({
  tierId = "alakazam_25",
  stripePriceId = ALAKAZAM_PRICE_IDS[tierId]
} = {}) {
  return {
    localSubscriptionId:
      "60000000-0000-4000-8000-000000000001",
    revision: 3,
    tierId,
    amountMinor: {
      alakazam_25: 2500,
      alakazam_35: 3500,
      alakazam_50: 5000
    }[tierId],
    stripeSubscriptionId:
      "sub_alakazam_subscription_1",
    stripeSubscriptionItemId:
      "si_alakazam_item_1",
    stripePriceId,
    currentPeriodStartsAt: ALAKAZAM_PERIOD_START,
    currentPeriodEndsAt: ALAKAZAM_PERIOD_END,
    providerFactsDigest: "e".repeat(64)
  };
}

function alakazamPurpose({
  changeKind = "start",
  targetTierId =
    changeKind === "downgrade"
      ? "alakazam_25"
      : changeKind === "upgrade"
        ? "alakazam_35"
        : "alakazam_25",
  currentSubscription =
    changeKind === "start"
      ? null
      : alakazamCurrent({
          tierId:
            changeKind === "downgrade"
              ? "alakazam_50"
              : "alakazam_25"
        }),
  downloadCredit =
    changeKind === "start"
      ? {
          entitlementId:
            "70000000-0000-4000-8000-000000000001",
          amountMinor: 500
        }
      : null,
  overrides = {}
} = {}) {
  const targetAmountMinor = {
    alakazam_25: 2500,
    alakazam_35: 3500,
    alakazam_50: 5000
  }[targetTierId];
  const dueNowSubtotalMinor =
    changeKind === "start"
      ? targetAmountMinor -
        (downloadCredit?.amountMinor ?? 0)
      : changeKind === "upgrade"
        ? targetAmountMinor -
          currentSubscription.amountMinor
        : 0;
  return {
    schema: STRIPE_ALAKAZAM_PURPOSE_SCHEMA,
    catalogVersion: "alakazam.2026-08-02.v1",
    termsVersion:
      "alakazam-owner-contract.2026-08-02.v1",
    organizationId:
      "10000000-0000-4000-8000-000000000001",
    customerId:
      "20000000-0000-4000-8000-000000000001",
    projectId:
      "30000000-0000-4000-8000-000000000001",
    quoteId:
      "80000000-0000-4000-8000-000000000001",
    stripeCustomerId: "cus_alakazam_customer_1",
    acceptedDisclosureDigest: "f".repeat(64),
    quoteDigest: "1".repeat(64),
    changeKind,
    currentSubscription,
    targetTierId,
    targetAmountMinor,
    dueNowSubtotalMinor,
    nextRenewalAmountMinor: targetAmountMinor,
    currency: "USD",
    taxMode: "disabled_by_owner",
    downloadCredit,
    ...overrides
  };
}

function alakazamRequest(options = {}, overrides = {}) {
  const purpose = alakazamPurpose(options);
  return {
    idempotencyKey:
      `alakazam:${purpose.changeKind}:command_1`,
    purpose,
    purposeDigest: digest(purpose),
    ...overrides
  };
}

function alakazamCustomerRequest(overrides = {}) {
  const purpose = {
    schema: STRIPE_ALAKAZAM_CUSTOMER_PURPOSE_SCHEMA,
    catalogVersion: "alakazam.2026-08-02.v1",
    termsVersion:
      "alakazam-owner-contract.2026-08-02.v1",
    organizationId:
      "10000000-0000-4000-8000-000000000001",
    customerId:
      "20000000-0000-4000-8000-000000000001",
    projectId:
      "30000000-0000-4000-8000-000000000001",
    quoteId:
      "80000000-0000-4000-8000-000000000001",
    provisionId:
      "90000000-0000-4000-8000-000000000001",
    acceptedDisclosureDigest: "f".repeat(64),
    quoteDigest: "1".repeat(64)
  };
  return {
    idempotencyKey: "alakazam:customer:command_1",
    purpose,
    purposeDigest: digest(purpose),
    ...overrides
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
    ...(expectation.productId
      ? { product: expectation.productId }
      : {}),
    ...overrides
  };
}

function fakeStripe({
  config = configuration(),
  priceOverrides = {},
  priceError = null,
  productError = null,
  productResponse = null,
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
  portalConfigurationError = null,
  portalConfigurationResponse = null,
  couponError = null,
  couponResponse = null,
  customerCreateError = null,
  customerCreateResponse = null,
  customerRetrieveError = null,
  customerRetrieveResponse = null,
  cancellationError = null,
  cancellationResponse = null,
  subscriptionRetrieveError = null,
  subscriptionRetrieveResponses = [],
  subscriptionUpdateError = null,
  subscriptionUpdateResponse = null,
  scheduleCreateError = null,
  scheduleCreateResponse = null,
  scheduleRetrieveError = null,
  scheduleRetrieveResponses = [],
  scheduleUpdateError = null,
  scheduleUpdateResponse = null,
  webhookError = null,
  webhookEvent = null
} = {}) {
  const calls = {
    prices: [],
    products: [],
    checkouts: [],
    checkoutReads: [],
    paymentIntentReads: [],
    captures: [],
    voids: [],
    refunds: [],
    portals: [],
    portalConfigurations: [],
    coupons: [],
    customerCreates: [],
    customerReads: [],
    cancellations: [],
    subscriptionReads: [],
    subscriptionUpdates: [],
    scheduleCreates: [],
    scheduleReads: [],
    scheduleUpdates: [],
    webhooks: []
  };
  let subscriptionReadIndex = 0;
  let scheduleReadIndex = 0;
  let lastCustomer = null;
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
    products: {
      async retrieve(id) {
        calls.products.push(id);
        if (productError) throw productError;
        return structuredClone(
          productResponse ?? {
            id,
            active: true,
            livemode: false,
            name: "Alakazam"
          }
        );
      }
    },
    prices: {
      async retrieve(id) {
        calls.prices.push(id);
        if (priceError) throw priceError;
        return structuredClone(prices.get(id));
      }
    },
    coupons: {
      async retrieve(id) {
        calls.coupons.push(id);
        if (couponError) throw couponError;
        return structuredClone(
          couponResponse ?? {
            id,
            valid: true,
            livemode: false,
            amount_off: 500,
            currency: "usd",
            duration: "once",
            duration_in_months: null,
            max_redemptions: null,
            percent_off: null,
            redeem_by: null,
            applies_to: {
              products: [ALAKAZAM_PRODUCT_ID]
            }
          }
        );
      }
    },
    customers: {
      async create(params, requestOptions) {
        calls.customerCreates.push({
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (customerCreateError) {
          throw customerCreateError;
        }
        lastCustomer = structuredClone(
          customerCreateResponse ?? {
            id: "cus_alakazam_customer_1",
            object: "customer",
            created: 1785672000,
            deleted: false,
            livemode: false,
            metadata: params.metadata
          }
        );
        return structuredClone(lastCustomer);
      },
      async retrieve(id) {
        calls.customerReads.push(id);
        if (customerRetrieveError) {
          throw customerRetrieveError;
        }
        return structuredClone(
          customerRetrieveResponse ?? lastCustomer
        );
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
          const selectedCheckoutResponse =
            typeof checkoutResponse === "function"
              ? checkoutResponse(params)
              : checkoutResponse;
          return structuredClone({
            client_reference_id:
              params.client_reference_id ?? null,
            metadata: params.metadata ?? {},
            mode: params.mode,
            currency:
              params.line_items?.[0]?.price_data?.currency ??
              null,
            amount_subtotal:
              params.line_items?.[0]?.price_data?.unit_amount ??
              null,
            automatic_tax:
              params.automatic_tax ?? { enabled: false },
            status: "open",
            payment_status: "unpaid",
            id: "cs_test_checkout_1",
            url: "https://checkout.stripe.com/c/pay/test_1",
            expires_at: 1785241800,
            livemode: false,
            ...(selectedCheckoutResponse ?? {})
          });
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
      configurations: {
        async retrieve(id) {
          calls.portalConfigurations.push(id);
          if (portalConfigurationError) {
            throw portalConfigurationError;
          }
          return structuredClone(
            portalConfigurationResponse ?? {
              id,
              active: true,
              livemode: false,
              default_return_url:
                config.portalReturnUrl,
              features: {
                customer_update: { enabled: false },
                invoice_history: { enabled: true },
                payment_method_update: {
                  enabled: true
                },
                subscription_cancel: {
                  enabled: false
                },
                subscription_update: {
                  enabled: false
                }
              }
            }
          );
        }
      },
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
      async retrieve(id, params) {
        calls.subscriptionReads.push({
          id,
          params: structuredClone(params)
        });
        if (subscriptionRetrieveError) {
          throw subscriptionRetrieveError;
        }
        const response =
          subscriptionRetrieveResponses[
            Math.min(
              subscriptionReadIndex,
              Math.max(
                subscriptionRetrieveResponses.length - 1,
                0
              )
            )
          ];
        subscriptionReadIndex += 1;
        return structuredClone(response);
      },
      async update(id, params, requestOptions) {
        const call = {
          id,
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        };
        calls.subscriptionUpdates.push(call);
        if (params.cancel_at_period_end === true) {
          calls.cancellations.push(call);
        }
        if (subscriptionUpdateError) {
          throw subscriptionUpdateError;
        }
        if (cancellationError) throw cancellationError;
        return (
          subscriptionUpdateResponse ??
          cancellationResponse ?? {
            id,
            cancel_at_period_end: true,
            current_period_end: 1787832000,
            status: "active"
          }
        );
      }
    },
    subscriptionSchedules: {
      async create(params, requestOptions) {
        calls.scheduleCreates.push({
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (scheduleCreateError) {
          throw scheduleCreateError;
        }
        return structuredClone(scheduleCreateResponse);
      },
      async retrieve(id, params) {
        calls.scheduleReads.push({
          id,
          params: structuredClone(params)
        });
        if (scheduleRetrieveError) {
          throw scheduleRetrieveError;
        }
        const response =
          scheduleRetrieveResponses[
            Math.min(
              scheduleReadIndex,
              Math.max(
                scheduleRetrieveResponses.length - 1,
                0
              )
            )
          ];
        scheduleReadIndex += 1;
        return structuredClone(response);
      },
      async update(id, params, requestOptions) {
        calls.scheduleUpdates.push({
          id,
          params: structuredClone(params),
          requestOptions:
            structuredClone(requestOptions)
        });
        if (scheduleUpdateError) {
          throw scheduleUpdateError;
        }
        return structuredClone(scheduleUpdateResponse);
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

function fakeAlakazamSubscription({
  tierId = "alakazam_25",
  schedule = null,
  metadata = {},
  status = "active",
  periodStart = ALAKAZAM_PERIOD_START,
  periodEnd = ALAKAZAM_PERIOD_END
} = {}) {
  const amountMinor = {
    alakazam_25: 2500,
    alakazam_35: 3500,
    alakazam_50: 5000
  }[tierId];
  return {
    id: "sub_alakazam_subscription_1",
    customer: "cus_alakazam_customer_1",
    livemode: false,
    status,
    collection_method: "charge_automatically",
    cancel_at_period_end: false,
    automatic_tax: { enabled: false },
    pending_update: null,
    pause_collection: null,
    billing_cycle_anchor:
      Date.parse(periodStart) / 1000,
    schedule,
    metadata,
    items: {
      data: [
        {
          id: "si_alakazam_item_1",
          quantity: 1,
          current_period_start:
            Date.parse(periodStart) / 1000,
          current_period_end:
            Date.parse(periodEnd) / 1000,
          price: {
            id: ALAKAZAM_PRICE_IDS[tierId],
            active: true,
            livemode: false,
            currency: "usd",
            unit_amount: amountMinor,
            recurring: {
              interval: "month",
              interval_count: 1
            },
            product: ALAKAZAM_PRODUCT_ID
          }
        }
      ]
    }
  };
}

function fakeAlakazamSchedule(
  request,
  {
    scheduleId = "sub_sched_alakazam_1",
    targetPeriodEnd =
      "2026-10-01T12:00:00.000Z"
  } = {}
) {
  const purpose = request.purpose;
  const current = purpose.currentSubscription;
  const start =
    Date.parse(current.currentPeriodStartsAt) / 1000;
  const effective =
    Date.parse(current.currentPeriodEndsAt) / 1000;
  return {
    id: scheduleId,
    subscription: current.stripeSubscriptionId,
    customer: purpose.stripeCustomerId,
    livemode: false,
    status: "active",
    end_behavior: "release",
    current_phase: {
      start_date: start,
      end_date: effective
    },
    metadata: {
      schema: "sitesourcery_alakazam_change_v1",
      purpose_digest: request.purposeDigest,
      target_tier_id: purpose.targetTierId
    },
    phases: [
      {
        start_date: start,
        end_date: effective,
        proration_behavior: "none",
        collection_method: "charge_automatically",
        automatic_tax: { enabled: false },
        items: [
          {
            price: current.stripePriceId,
            quantity: 1
          }
        ]
      },
      {
        start_date: effective,
        end_date:
          Date.parse(targetPeriodEnd) / 1000,
        proration_behavior: "none",
        collection_method: "charge_automatically",
        automatic_tax: { enabled: false },
        items: [
          {
            price:
              ALAKAZAM_PRICE_IDS[
                purpose.targetTierId
              ],
            quantity: 1
          }
        ]
      }
    ]
  };
}

function alakazamExpectedMetadata(request) {
  const purpose = request.purpose;
  return {
    schema: "sitesourcery_alakazam_change_v1",
    organization_id: purpose.organizationId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    quote_id: purpose.quoteId,
    change_kind: purpose.changeKind,
    target_tier_id: purpose.targetTierId,
    accepted_disclosure_digest:
      purpose.acceptedDisclosureDigest,
    quote_digest: purpose.quoteDigest,
    catalog_version: purpose.catalogVersion,
    terms_version: purpose.termsVersion,
    tax_mode: purpose.taxMode,
    purpose_digest: request.purposeDigest,
    ...(purpose.currentSubscription
      ? {
          prior_tier_id:
            purpose.currentSubscription.tierId,
          local_subscription_id:
            purpose.currentSubscription
              .localSubscriptionId,
          subscription_revision: String(
            purpose.currentSubscription.revision
          )
        }
      : {}),
    ...(purpose.downloadCredit
      ? {
          download_entitlement_id:
            purpose.downloadCredit.entitlementId
        }
      : {})
  };
}

function paidAlakazamCheckout(request) {
  const purpose = request.purpose;
  const metadata = alakazamExpectedMetadata(request);
  const start = purpose.changeKind === "start";
  const listSubtotalMinor = start
    ? purpose.targetAmountMinor
    : purpose.dueNowSubtotalMinor;
  const discountMinor =
    purpose.downloadCredit?.amountMinor ?? 0;
  const totalMinor = listSubtotalMinor - discountMinor;
  const paymentIntent = {
    id: start
      ? "pi_alakazam_start_1"
      : "pi_alakazam_upgrade_1",
    customer: purpose.stripeCustomerId,
    livemode: false,
    status: "succeeded",
    currency: "usd",
    amount: totalMinor,
    amount_received: totalMinor,
    amount_capturable: 0,
    created: 1785672000,
    metadata: start ? {} : metadata,
    latest_charge: start
      ? null
      : {
          id: "ch_alakazam_upgrade_1",
          customer: purpose.stripeCustomerId,
          payment_intent: "pi_alakazam_upgrade_1",
          livemode: false,
          status: "succeeded",
          paid: true,
          captured: true,
          refunded: false,
          currency: "usd",
          amount: totalMinor,
          amount_captured: totalMinor,
          created: 1785672000
        }
  };
  const subscription = start
    ? fakeAlakazamSubscription({
        tierId: purpose.targetTierId,
        metadata
      })
    : null;
  return {
    id: "cs_alakazam_paid_1",
    client_reference_id: purpose.quoteId,
    mode: start ? "subscription" : "payment",
    livemode: false,
    status: "complete",
    payment_status: "paid",
    currency: "usd",
    amount_subtotal: listSubtotalMinor,
    amount_total: totalMinor,
    customer: purpose.stripeCustomerId,
    metadata,
    automatic_tax: {
      enabled: false,
      status: null
    },
    total_details: {
      amount_discount: discountMinor,
      amount_shipping: 0,
      amount_tax: 0,
      breakdown: {
        discounts: discountMinor
          ? [
              {
                amount: discountMinor,
                discount: {
                  coupon: {
                    id: ALAKAZAM_COUPON_ID
                  }
                }
              }
            ]
          : []
      }
    },
    line_items: {
      has_more: false,
      data: [
        {
          quantity: 1,
          price: start
            ? subscription.items.data[0].price
            : {
                id: "price_alakazam_upgrade_difference_1",
                active: true,
                livemode: false,
                currency: "usd",
                unit_amount: listSubtotalMinor,
                recurring: null,
                product: ALAKAZAM_PRODUCT_ID
              }
        }
      ]
    },
    subscription,
    invoice: start
      ? {
          id: "in_alakazam_start_1",
          customer: purpose.stripeCustomerId,
          parent: {
            type: "subscription_details",
            subscription_details: {
              subscription: subscription.id,
              metadata
            }
          },
          livemode: false,
          status: "paid",
          currency: "usd",
          subtotal: listSubtotalMinor,
          total_discount_amounts: discountMinor
            ? [{ amount: discountMinor }]
            : [],
          total: totalMinor,
          amount_paid: totalMinor,
          amount_remaining: 0,
          payments: {
            data: [
              {
                status: "paid",
                livemode: false,
                currency: "usd",
                amount_paid: totalMinor,
                amount_requested: totalMinor,
                payment: {
                  type: "payment_intent",
                  payment_intent: paymentIntent
                },
                status_transitions: {
                  paid_at: 1785672000
                }
              }
            ]
          }
        }
      : null,
    payment_intent: start ? null : paymentIntent
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
    "createServiceAssessmentCheckout",
    "retrieveServiceAssessmentPayment",
    "retrieveServiceAssessmentCheckoutLifecycle",
    "createAlakazamCustomer",
    "retrieveAlakazamCustomer",
    "createAlakazamStartCheckout",
    "createAlakazamUpgradeCheckout",
    "retrieveAlakazamPayment",
    "retrieveAlakazamSubscription",
    "retrieveAlakazamSchedule",
    "applyAlakazamUpgrade",
    "scheduleAlakazamDowngrade",
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

test("Alakazam construction requires three distinct exact monthly Prices bound to one Product", () => {
  const missingProduct = alakazamConfiguration();
  missingProduct.priceExpectations =
    missingProduct.priceExpectations.map((expectation) =>
      expectation.id === ALAKAZAM_PRICE_IDS.alakazam_35
        ? { ...expectation, productId: null }
        : expectation
    );
  const duplicatePrice = alakazamConfiguration({
    alakazam: {
      ...alakazamConfiguration().alakazam,
      tierPriceIds: {
        ...ALAKAZAM_PRICE_IDS,
        alakazam_35: ALAKAZAM_PRICE_IDS.alakazam_25
      }
    }
  });
  for (const config of [missingProduct, duplicatePrice]) {
    const fake = fakeStripe({ config });
    assert.throws(
      () =>
        createStripeProviderAdapter({
          mode: "contract_test",
          testOnly: true,
          client: fake.client,
          config
        }),
      (error) =>
        error.code ===
        "stripe_alakazam_configuration_invalid"
    );
    assert.equal(fake.calls.prices.length, 0);
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

test("Alakazam readiness proves all three Product-bound Prices, the exact $5 Coupon, and a restricted Portal", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter } = adapterFixture({ config, fake });
  assert.deepEqual(await adapter.readiness(), {
    ready: true,
    provider: "stripe",
    mode: "contract_test",
    environment: "contract_test",
    livemode: false,
    apiVersion: STRIPE_API_VERSION,
    priceCount: 5,
    domainAuthorization: true,
    webhookVerification: true,
    taxMode: "disabled_by_owner",
    alakazam: true
  });
  assert.deepEqual(fake.calls.coupons, [
    ALAKAZAM_COUPON_ID
  ]);
  assert.deepEqual(fake.calls.products, [
    ALAKAZAM_PRODUCT_ID
  ]);
  assert.deepEqual(fake.calls.portalConfigurations, [
    ALAKAZAM_PORTAL_CONFIGURATION_ID
  ]);
  assert.deepEqual(
    fake.calls.prices.slice(-3),
    Object.values(ALAKAZAM_PRICE_IDS)
  );
});

test("Alakazam readiness fails closed when its Product, Coupon, or Portal drifts outside the owner contract", async () => {
  const config = alakazamConfiguration();
  for (const fake of [
    fakeStripe({
      config,
      productResponse: {
        id: ALAKAZAM_PRODUCT_ID,
        active: true,
        livemode: false,
        name: "Unreviewed product"
      }
    }),
    fakeStripe({
      config,
      couponResponse: {
        id: ALAKAZAM_COUPON_ID,
        valid: true,
        livemode: false,
        amount_off: 500,
        currency: "usd",
        duration: "forever",
        duration_in_months: null,
        percent_off: null,
        applies_to: {
          products: [ALAKAZAM_PRODUCT_ID]
        }
      }
    }),
    fakeStripe({
      config,
      portalConfigurationResponse: {
        id: ALAKAZAM_PORTAL_CONFIGURATION_ID,
        active: true,
        livemode: false,
        default_return_url: config.portalReturnUrl,
        features: {
          customer_update: { enabled: false },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: false },
          subscription_update: { enabled: true }
        }
      }
    })
  ]) {
    const readiness = await adapterFixture({
      config,
      fake
    }).adapter.readiness();
    assert.equal(readiness.ready, false);
    assert.match(
      readiness.code,
      /^stripe_alakazam_(?:product|coupon|portal_configuration)_mismatch$/u
    );
    assert.equal(fake.calls.checkouts.length, 0);
  }
});

test("Alakazam Billing Portal sessions are pinned to the restricted configuration", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  await adapter.createBillingPortal({
    stripeCustomerId: "cus_alakazam_customer_1",
    idempotencyKey: "portal:alakazam:command_1"
  });
  assert.deepEqual(calls.portals[0].params, {
    customer: "cus_alakazam_customer_1",
    return_url: config.portalReturnUrl,
    configuration: ALAKAZAM_PORTAL_CONFIGURATION_ID
  });
});

test("Alakazam Customer provisioning creates one metadata-only Customer and requires exact readback", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const request = alakazamCustomerRequest();
  const result =
    await adapter.createAlakazamCustomer(request);
  assert.equal(
    result.schema,
    "sitesourcery.stripe-alakazam-customer/v1"
  );
  assert.equal(
    result.stripeCustomerId,
    "cus_alakazam_customer_1"
  );
  assert.equal(
    result.providerCreatedAt,
    "2026-08-02T12:00:00.000Z"
  );
  assert.match(result.providerFactsDigest, /^[a-f0-9]{64}$/u);
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(calls.customerReads.length, 1);
  const [{ params, requestOptions }] =
    calls.customerCreates;
  assert.deepEqual(Object.keys(params).sort(), [
    "description",
    "metadata"
  ]);
  assert.equal(
    params.description,
    "Site Sourcery Alakazam customer"
  );
  assert.equal("email" in params, false);
  assert.equal("name" in params, false);
  assert.deepEqual(params.metadata, {
    schema: "sitesourcery_alakazam_customer_v1",
    organization_id: request.purpose.organizationId,
    customer_id: request.purpose.customerId,
    project_id: request.purpose.projectId,
    quote_id: request.purpose.quoteId,
    provision_id: request.purpose.provisionId,
    accepted_disclosure_digest:
      request.purpose.acceptedDisclosureDigest,
    quote_digest: request.purpose.quoteDigest,
    catalog_version: request.purpose.catalogVersion,
    terms_version: request.purpose.termsVersion,
    purpose_digest: request.purposeDigest
  });
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:alakazam_customer:[a-f0-9]{64}$/u
  );

  assert.deepEqual(
    await adapter.retrieveAlakazamCustomer({
      purpose: request.purpose,
      purposeDigest: request.purposeDigest,
      stripeCustomerId: result.stripeCustomerId
    }),
    result
  );
  assert.equal(calls.customerCreates.length, 1);
  assert.equal(calls.customerReads.length, 2);
});

test("Alakazam Customer transport or post-create readback uncertainty never submits a second Customer", async () => {
  const config = alakazamConfiguration();
  for (const options of [
    { customerCreateError: new Error("reset") },
    { customerRetrieveError: new Error("timeout") }
  ]) {
    const fake = fakeStripe({ config, ...options });
    const { adapter, calls } = adapterFixture({
      config,
      fake
    });
    await assert.rejects(
      adapter.createAlakazamCustomer(
        alakazamCustomerRequest()
      ),
      (error) =>
        error.certainty === "ambiguous" &&
        error.code.startsWith(
          "stripe_alakazam_customer_"
        )
    );
    assert.equal(calls.customerCreates.length, 1);
    assert.equal(
      calls.customerReads.length,
      options.customerCreateError ? 0 : 1
    );
  }
});

test("Alakazam start Checkout uses one monthly Price and only the pinned one-invoice $5 credit", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const request = alakazamRequest();
  assert.deepEqual(
    await adapter.createAlakazamStartCheckout(request),
    {
      checkoutId: "cs_test_checkout_1",
      url: "https://checkout.stripe.com/c/pay/test_1",
      expiresAt: "2026-07-28T12:30:00.000Z"
    }
  );
  assert.equal(calls.checkouts.length, 1);
  const [{ params, requestOptions }] = calls.checkouts;
  assert.equal(params.mode, "subscription");
  assert.deepEqual(params.line_items, [
    {
      price: ALAKAZAM_PRICE_IDS.alakazam_25,
      quantity: 1
    }
  ]);
  assert.deepEqual(params.discounts, [
    { coupon: ALAKAZAM_COUPON_ID }
  ]);
  assert.equal(params.customer, "cus_alakazam_customer_1");
  assert.equal(
    params.metadata.purpose_digest,
    request.purposeDigest
  );
  assert.equal(
    params.subscription_data.metadata.purpose_digest,
    request.purposeDigest
  );
  assert.equal("allow_promotion_codes" in params, false);
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:alakazam_start_checkout:[a-f0-9]{64}$/u
  );
});

test("Alakazam can start directly at $50 without a Download credit and never exposes promotion entry", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  await adapter.createAlakazamStartCheckout(
    alakazamRequest({
      targetTierId: "alakazam_50",
      downloadCredit: null
    })
  );
  const [{ params }] = calls.checkouts;
  assert.deepEqual(params.line_items, [
    {
      price: ALAKAZAM_PRICE_IDS.alakazam_50,
      quantity: 1
    }
  ]);
  assert.equal("discounts" in params, false);
  assert.equal("allow_promotion_codes" in params, false);
});

test("Alakazam Checkout rejects forged tier money before any Stripe call", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter } = adapterFixture({ config, fake });
  const purpose = alakazamPurpose({
    overrides: { dueNowSubtotalMinor: 1 }
  });
  await assert.rejects(
    adapter.createAlakazamStartCheckout({
      idempotencyKey: "alakazam:start:forged",
      purpose,
      purposeDigest: digest(purpose)
    }),
    (error) =>
      error.code === "stripe_alakazam_purpose_invalid"
  );
  assert.equal(fake.calls.prices.length, 0);
  assert.equal(fake.calls.coupons.length, 0);
  assert.equal(fake.calls.checkouts.length, 0);
});

test("Alakazam upgrade Checkout collects only the fixed tier difference", async () => {
  const config = alakazamConfiguration();
  const fake = fakeStripe({ config });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  await adapter.createAlakazamUpgradeCheckout(request);
  const [{ params, requestOptions }] = calls.checkouts;
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.line_items, [
    {
      price_data: {
        currency: "usd",
        unit_amount: 1000,
        product: ALAKAZAM_PRODUCT_ID
      },
      quantity: 1
    }
  ]);
  assert.equal("discounts" in params, false);
  assert.equal("allow_promotion_codes" in params, false);
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:alakazam_upgrade_checkout:[a-f0-9]{64}$/u
  );
});

test("Alakazam start settlement reads back the paid Invoice, PaymentIntent, one-item Subscription, and exact Download credit", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest();
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      paidAlakazamCheckout(request)
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result = await adapter.retrieveAlakazamPayment({
    checkoutSessionId: "cs_alakazam_paid_1",
    purpose: request.purpose,
    purposeDigest: request.purposeDigest
  });
  assert.equal(result.changeKind, "start");
  assert.equal(result.targetTierId, "alakazam_25");
  assert.equal(result.listSubtotalMinor, 2500);
  assert.equal(result.providerDiscountMinor, 500);
  assert.equal(result.netSubtotalMinor, 2000);
  assert.equal(result.totalMinor, 2000);
  assert.equal(
    result.stripeInvoiceId,
    "in_alakazam_start_1"
  );
  assert.equal(
    result.stripePaymentIntentId,
    "pi_alakazam_start_1"
  );
  assert.equal(
    result.providerPaymentTime,
    "2026-08-02T12:00:00.000Z"
  );
  assert.equal("paidAt" in result, false);
  assert.equal(result.subscription.tierId, "alakazam_25");
  assert.match(result.providerFactsDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(calls.checkoutReads, [
    {
      id: "cs_alakazam_paid_1",
      params: {
        expand: [
          "invoice.payments.data.payment.payment_intent",
          "line_items.data.price.product",
          "payment_intent.latest_charge",
          "subscription.items.data.price"
        ]
      }
    }
  ]);
});

test("Alakazam upgrade settlement proves the one-time difference without creating a second Subscription", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      paidAlakazamCheckout(request)
  });
  const { adapter } = adapterFixture({ config, fake });
  const result = await adapter.retrieveAlakazamPayment({
    checkoutSessionId: "cs_alakazam_paid_1",
    purpose: request.purpose,
    purposeDigest: request.purposeDigest
  });
  assert.equal(result.changeKind, "upgrade");
  assert.equal(result.listSubtotalMinor, 1000);
  assert.equal(result.providerDiscountMinor, 0);
  assert.equal(result.totalMinor, 1000);
  assert.equal(result.stripeInvoiceId, null);
  assert.equal(
    result.stripeSubscriptionId,
    "sub_alakazam_subscription_1"
  );
  assert.equal(
    result.stripePaymentIntentId,
    "pi_alakazam_upgrade_1"
  );
  assert.equal(
    result.providerPaymentTime,
    "2026-08-02T12:00:00.000Z"
  );
  assert.equal("paidAt" in result, false);
  assert.equal(result.subscription, null);
});

test("Alakazam upgrade settlement rejects an under-captured or refunded Charge", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  for (const mutateCharge of [
    (charge) => {
      charge.amount_captured = 999;
    },
    (charge) => {
      charge.refunded = true;
    }
  ]) {
    const response = paidAlakazamCheckout(request);
    mutateCharge(response.payment_intent.latest_charge);
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse: response
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.retrieveAlakazamPayment({
          checkoutSessionId: "cs_alakazam_paid_1",
          purpose: request.purpose,
          purposeDigest: request.purposeDigest
        }),
      (error) =>
        error.code === "stripe_alakazam_payment_mismatch"
    );
    assert.equal(fake.calls.subscriptionUpdates.length, 0);
    assert.equal(fake.calls.scheduleCreates.length, 0);
  }
});

test("Alakazam settlement rejects provider money drift even after a signed webhook wake-up", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest();
  const response = paidAlakazamCheckout(request);
  response.amount_total = 1;
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: response
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.retrieveAlakazamPayment({
        checkoutSessionId: "cs_alakazam_paid_1",
        purpose: request.purpose,
        purposeDigest: request.purposeDigest
      }),
    (error) =>
      error.code === "stripe_alakazam_payment_mismatch"
  );
  assert.equal(fake.calls.subscriptionUpdates.length, 0);
  assert.equal(fake.calls.scheduleCreates.length, 0);
});

test("Alakazam upgrade swaps the existing item with no proration and proves the unchanged billing boundary", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  const paymentEvidence = {
    receiptId:
      "90000000-0000-4000-8000-000000000001",
    providerFactsDigest: "2".repeat(64)
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription(),
      fakeAlakazamSubscription({
        tierId: "alakazam_35",
        metadata: {
          schema: "sitesourcery_alakazam_change_v1",
          purpose_digest: request.purposeDigest,
          payment_receipt_id: paymentEvidence.receiptId,
          payment_facts_digest:
            paymentEvidence.providerFactsDigest
        }
      })
    ]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result = await adapter.applyAlakazamUpgrade({
    ...request,
    paymentEvidence
  });
  assert.equal(result.tierId, "alakazam_35");
  assert.equal(result.reconciliation, "confirmed");
  assert.equal(calls.subscriptionReads.length, 2);
  assert.equal(calls.subscriptionUpdates.length, 1);
  const [{ id, params, requestOptions }] =
    calls.subscriptionUpdates;
  assert.equal(id, "sub_alakazam_subscription_1");
  assert.deepEqual(params.items, [
    {
      id: "si_alakazam_item_1",
      price: ALAKAZAM_PRICE_IDS.alakazam_35,
      quantity: 1
    }
  ]);
  assert.equal(params.proration_behavior, "none");
  assert.equal(params.billing_cycle_anchor, "unchanged");
  assert.equal(
    params.metadata.payment_facts_digest,
    paymentEvidence.providerFactsDigest
  );
  assert.equal(
    params.metadata.download_entitlement_id,
    ""
  );
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:alakazam_upgrade_apply:[a-f0-9]{64}$/u
  );
});

test("a completed Alakazam upgrade replay confirms provider state without another mutation", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  const paymentEvidence = {
    receiptId:
      "90000000-0000-4000-8000-000000000001",
    providerFactsDigest: "2".repeat(64)
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_35",
        metadata: {
          schema: "sitesourcery_alakazam_change_v1",
          purpose_digest: request.purposeDigest,
          payment_receipt_id: paymentEvidence.receiptId,
          payment_facts_digest:
            paymentEvidence.providerFactsDigest
        }
      })
    ]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result = await adapter.applyAlakazamUpgrade({
    ...request,
    paymentEvidence
  });
  assert.equal(
    result.reconciliation,
    "confirmed_before_submit"
  );
  assert.equal(calls.subscriptionReads.length, 1);
  assert.equal(calls.subscriptionUpdates.length, 0);
});

test("an applied Alakazam upgrade cannot replay across its paid receipt", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest({
    changeKind: "upgrade"
  });
  const paymentEvidence = {
    receiptId:
      "90000000-0000-4000-8000-000000000001",
    providerFactsDigest: "2".repeat(64)
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_35",
        metadata: {
          schema: "sitesourcery_alakazam_change_v1",
          purpose_digest: request.purposeDigest,
          payment_receipt_id:
            "90000000-0000-4000-8000-000000000099",
          payment_facts_digest:
            paymentEvidence.providerFactsDigest
        }
      })
    ]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  await assert.rejects(
    adapter.applyAlakazamUpgrade({
      ...request,
      paymentEvidence
    }),
    (error) =>
      error.code === "stripe_alakazam_upgrade_stale" &&
      error.status === 409
  );
  assert.equal(calls.subscriptionReads.length, 1);
  assert.equal(calls.subscriptionUpdates.length, 0);
});

test("Alakazam provider uncertainty never opens a second difference payment or retries a Price mutation", async () => {
  const config = alakazamConfiguration();
  {
    const fake = fakeStripe({
      config,
      checkoutError: new Error("timeout")
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.createAlakazamUpgradeCheckout(
          alakazamRequest({ changeKind: "upgrade" })
        ),
      (error) =>
        error.code ===
          "stripe_alakazam_checkout_effect_unknown" &&
        error.certainty === "ambiguous"
    );
    assert.equal(fake.calls.checkouts.length, 1);
  }
  {
    const request = alakazamRequest({
      changeKind: "upgrade"
    });
    const fake = fakeStripe({
      config,
      subscriptionRetrieveResponses: [
        fakeAlakazamSubscription()
      ],
      subscriptionUpdateError: new Error("timeout")
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.applyAlakazamUpgrade({
          ...request,
          paymentEvidence: {
            receiptId:
              "90000000-0000-4000-8000-000000000001",
            providerFactsDigest: "2".repeat(64)
          }
        }),
      (error) =>
        error.code ===
          "stripe_alakazam_upgrade_effect_unknown" &&
        error.certainty === "ambiguous"
    );
    assert.equal(fake.calls.subscriptionUpdates.length, 1);
    assert.equal(fake.calls.subscriptionReads.length, 2);
    assert.equal(fake.calls.checkouts.length, 0);
  }
});

test("Alakazam downgrade keeps the current Price through renewal and schedules one lower-Price phase with no proration", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const schedule = fakeAlakazamSchedule(request);
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50"
      })
    ],
    scheduleCreateResponse: {
      id: schedule.id,
      subscription:
        request.purpose.currentSubscription
          .stripeSubscriptionId,
      livemode: false,
      status: "active"
    },
    scheduleRetrieveResponses: [schedule]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result =
    await adapter.scheduleAlakazamDowngrade(request);
  assert.equal(result.targetTierId, "alakazam_25");
  assert.equal(result.effectiveAt, ALAKAZAM_PERIOD_END);
  assert.equal(result.providerProration, false);
  assert.deepEqual(
    calls.scheduleCreates[0].params,
    {
      from_subscription:
        "sub_alakazam_subscription_1"
    }
  );
  const [{ params, requestOptions }] =
    calls.scheduleUpdates;
  assert.equal(params.end_behavior, "release");
  assert.equal(params.proration_behavior, "none");
  assert.equal(params.phases.length, 2);
  assert.deepEqual(params.phases[0].items, [
    {
      price: ALAKAZAM_PRICE_IDS.alakazam_50,
      quantity: 1
    }
  ]);
  assert.equal(
    params.phases[0].end_date,
    Date.parse(ALAKAZAM_PERIOD_END) / 1000
  );
  assert.deepEqual(params.phases[1].items, [
    {
      price: ALAKAZAM_PRICE_IDS.alakazam_25,
      quantity: 1
    }
  ]);
  assert.deepEqual(params.phases[1].duration, {
    interval: "month",
    interval_count: 1
  });
  assert.equal(
    params.phases.every(
      (phase) => phase.proration_behavior === "none"
    ),
    true
  );
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:alakazam_schedule_update:[a-f0-9]{64}$/u
  );
});

test("a completed Alakazam Schedule replay is read back without another provider mutation", async () => {
  const config = alakazamConfiguration();
  const seed = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const schedule = fakeAlakazamSchedule(seed);
  const request = {
    ...seed,
    stripeScheduleId: schedule.id
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50",
        schedule: schedule.id
      })
    ],
    scheduleRetrieveResponses: [schedule]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result =
    await adapter.scheduleAlakazamDowngrade(request);
  assert.equal(result.stripeScheduleId, schedule.id);
  assert.equal(calls.scheduleCreates.length, 0);
  assert.equal(calls.scheduleUpdates.length, 0);
  assert.equal(calls.scheduleReads.length, 1);
});

test("Alakazam Schedule reconciliation is strictly read-only", async () => {
  const config = alakazamConfiguration();
  const seed = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const schedule = fakeAlakazamSchedule(seed);
  const request = {
    purpose: seed.purpose,
    purposeDigest: seed.purposeDigest,
    stripeScheduleId: schedule.id
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50",
        schedule: schedule.id
      })
    ],
    scheduleRetrieveResponses: [schedule]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result =
    await adapter.retrieveAlakazamSchedule(request);
  assert.equal(result.stripeScheduleId, schedule.id);
  assert.equal(result.targetTierId, "alakazam_25");
  assert.equal(calls.scheduleCreates.length, 0);
  assert.equal(calls.scheduleUpdates.length, 0);
  assert.equal(calls.scheduleReads.length, 1);
});

test("an ambiguous Alakazam phase update reconciles the known Schedule and never creates another", async () => {
  const config = alakazamConfiguration();
  const seed = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const schedule = fakeAlakazamSchedule(seed);
  const partial = {
    ...schedule,
    metadata: {}
  };
  const request = {
    ...seed,
    stripeScheduleId: schedule.id
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50",
        schedule: schedule.id
      })
    ],
    scheduleUpdateError: new Error("timeout"),
    scheduleRetrieveResponses: [partial, schedule]
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  const result =
    await adapter.scheduleAlakazamDowngrade(request);
  assert.equal(result.stripeScheduleId, schedule.id);
  assert.equal(calls.scheduleCreates.length, 0);
  assert.equal(calls.scheduleUpdates.length, 1);
  assert.equal(calls.scheduleReads.length, 2);
});

test("an attached Schedule with conflicting provider identity is never rewritten", async () => {
  const config = alakazamConfiguration();
  const seed = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const schedule = fakeAlakazamSchedule(seed);
  const request = {
    ...seed,
    stripeScheduleId: schedule.id
  };
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50",
        schedule: schedule.id
      })
    ],
    scheduleRetrieveResponses: [
      {
        ...schedule,
        customer: "cus_conflicting_customer"
      }
    ]
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.scheduleAlakazamDowngrade(request),
    (error) =>
      error.code ===
      "stripe_alakazam_schedule_identity_mismatch"
  );
  assert.equal(fake.calls.scheduleUpdates.length, 0);
});

test("an uncertain Alakazam Schedule attachment stops before phase mutation", async () => {
  const config = alakazamConfiguration();
  const request = alakazamRequest(
    { changeKind: "downgrade" },
    { stripeScheduleId: null }
  );
  const fake = fakeStripe({
    config,
    subscriptionRetrieveResponses: [
      fakeAlakazamSubscription({
        tierId: "alakazam_50"
      })
    ],
    scheduleCreateError: new Error("timeout")
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.scheduleAlakazamDowngrade(request),
    (error) =>
      error.code ===
        "stripe_alakazam_schedule_attach_unknown" &&
      error.certainty === "ambiguous"
  );
  assert.equal(fake.calls.scheduleCreates.length, 1);
  assert.equal(fake.calls.scheduleUpdates.length, 0);
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

test("assessment invoice creates one exact automatic-tax $200 Checkout", async () => {
  const config = configuration({ taxMode: "automatic" });
  const { adapter, calls } = adapterFixture({ config });
  const request = serviceAssessmentRequest();
  const result =
    await adapter.createServiceAssessmentCheckout(request);
  assert.deepEqual(result, {
    checkoutId: "cs_test_checkout_1",
    url: "https://checkout.stripe.com/c/pay/test_1",
    expiresAt: "2026-07-28T12:30:00.000Z"
  });
  assert.equal(calls.checkouts.length, 1);
  const [{ params, requestOptions }] = calls.checkouts;
  assert.equal(params.mode, "payment");
  assert.deepEqual(params.line_items, [
    {
      price_data: {
        currency: "usd",
        unit_amount: 20000,
        tax_behavior: "exclusive",
        product_data: {
          name: "Site Sourcery website assessment"
        }
      },
      quantity: 1
    }
  ]);
  assert.equal(params.automatic_tax.enabled, true);
  assert.equal(params.billing_address_collection, "required");
  assert.equal(params.customer_creation, "always");
  assert.equal(
    params.client_reference_id,
    request.purpose.invoiceId
  );
  assert.equal(
    params.success_url,
    config.successUrl
      + "&assessment_project="
      + encodeURIComponent(request.purpose.projectId)
      + "&assessment_invoice="
      + encodeURIComponent(request.purpose.invoiceId)
  );
  assert.deepEqual(
    params.payment_intent_data.metadata,
    params.metadata
  );
  assert.equal(
    params.metadata.invoice_digest,
    request.purpose.invoiceDigest
  );
  assert.match(
    requestOptions.idempotencyKey,
    /^ss:service_assessment_checkout:[a-f0-9]{64}$/u
  );
});

test("assessment Checkout rejects changed price and disabled automatic tax before Stripe", async () => {
  let fixture = adapterFixture({
    config: configuration({ taxMode: "automatic" })
  });
  await assert.rejects(
    fixture.adapter.createServiceAssessmentCheckout(
      serviceAssessmentRequest({
        purpose: {
          price: {
            amountMinor: 19999,
            currency: "USD",
            billing: "one_time",
            taxBehavior: "automatic_exclusive"
          }
        }
      })
    ),
    (error) =>
      error.code ===
        "stripe_service_assessment_checkout_invalid" &&
      error.certainty === "not_submitted"
  );
  assert.equal(fixture.calls.checkouts.length, 0);

  fixture = adapterFixture();
  await assert.rejects(
    fixture.adapter.createServiceAssessmentCheckout(
      serviceAssessmentRequest()
    ),
    (error) =>
      error.code ===
        "stripe_service_assessment_tax_required" &&
      error.certainty === "not_submitted"
  );
  assert.equal(fixture.calls.checkouts.length, 0);
});

test("assessment Checkout treats every wrong-but-valid Stripe Session as ambiguous", async () => {
  const config = configuration({ taxMode: "automatic" });
  const drifts = [
    () => ({
      client_reference_id:
        "60000000-0000-4000-8000-000000000099"
    }),
    (params) => ({
      metadata: {
        ...params.metadata,
        purpose_digest: "0".repeat(64)
      }
    }),
    () => ({ mode: "subscription" }),
    () => ({ currency: "eur" }),
    () => ({ amount_subtotal: 19999 }),
    () => ({ automatic_tax: { enabled: false } }),
    () => ({ status: "complete" }),
    () => ({ payment_status: "paid" }),
    () => ({
      url: "https://checkout.stripe.com:444/c/pay/unsafe"
    })
  ];
  for (const drift of drifts) {
    const fake = fakeStripe({
      config,
      checkoutResponse: drift
    });
    const fixture = adapterFixture({ config, fake });
    await assert.rejects(
      fixture.adapter.createServiceAssessmentCheckout(
        serviceAssessmentRequest()
      ),
      (error) =>
        [
          "stripe_checkout_response_invalid",
          "stripe_service_assessment_checkout_response_invalid"
        ].includes(error.code) &&
        error.certainty === "ambiguous"
    );
    assert.equal(fixture.calls.checkouts.length, 1);
  }
});

test("assessment settlement returns frozen redacted facts for tax-zero and tax-positive exact payments", async () => {
  const purpose = serviceAssessmentPurpose();
  for (const taxMinor of [0, 1450]) {
    const config = configuration({ taxMode: "automatic" });
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        serviceAssessmentCheckoutReadback({
          purpose,
          taxMinor
        })
    });
    const { adapter, calls } = adapterFixture({
      config,
      fake
    });
    const facts =
      await adapter.retrieveServiceAssessmentPayment(
        serviceAssessmentReadRequest({ purpose })
      );
    const {
      providerFactsDigest,
      ...factsWithoutDigest
    } = facts;
    assert.deepEqual(factsWithoutDigest, {
      schema:
        "sitesourcery.stripe-service-assessment-payment-facts/v1",
      provider: "stripe",
      checkoutSessionId:
        "cs_test_service_assessment_1",
      paymentIntentId:
        "pi_test_service_assessment_1",
      customerId: "cus_test_service_assessment_1",
      paymentStatus: "paid",
      subtotalMinor: 20000,
      taxMinor,
      totalMinor: 20000 + taxMinor,
      taxMode: "automatic",
      currency: "USD",
      purposeDigest: digest(purpose),
      providerPaymentTime:
        "2026-08-02T12:00:00.000Z"
    });
    assert.equal(
      providerFactsDigest,
      digest(factsWithoutDigest)
    );
    assert.equal(Object.isFrozen(facts), true);
    assert.equal("chargeId" in facts, false);
    assert.deepEqual(calls.checkoutReads, [
      {
        id: "cs_test_service_assessment_1",
        params: {
          expand: ["payment_intent.latest_charge"]
        }
      }
    ]);
  }
});

test("assessment readback accepts only retrieval identity and the exact purpose digest", async () => {
  const purpose = serviceAssessmentPurpose();
  const config = configuration({ taxMode: "automatic" });
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      serviceAssessmentCheckoutReadback({ purpose })
  });
  const { adapter, calls } = adapterFixture({
    config,
    fake
  });
  for (const request of [
    {
      ...serviceAssessmentReadRequest({ purpose }),
      idempotencyKey: "assessment:creation-only"
    },
    {
      ...serviceAssessmentReadRequest({ purpose }),
      stripeCustomerId: "cus_test_service_assessment_1"
    },
    {
      ...serviceAssessmentReadRequest({ purpose }),
      purposeDigest: "0".repeat(64)
    }
  ]) {
    await assert.rejects(
      adapter.retrieveServiceAssessmentPayment(request),
      (error) =>
        error.code ===
          "stripe_service_assessment_checkout_invalid" &&
        error.status === 500 &&
        error.certainty === undefined
    );
  }
  assert.equal(calls.checkoutReads.length, 0);
});

test("assessment settlement rejects an unpaid Checkout as a 502 validation mismatch", async () => {
  const purpose = serviceAssessmentPurpose();
  const config = configuration({ taxMode: "automatic" });
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      serviceAssessmentCheckoutReadback({
        purpose,
        status: "open",
        paymentStatus: "unpaid"
      })
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.retrieveServiceAssessmentPayment(
        serviceAssessmentReadRequest({ purpose })
      ),
    (error) =>
      error.code ===
        "stripe_service_assessment_payment_mismatch" &&
      error.status === 502 &&
      error.certainty === undefined
  );
});

test("assessment settlement rejects underpaid PaymentIntent evidence", async () => {
  const purpose = serviceAssessmentPurpose();
  const response =
    serviceAssessmentCheckoutReadback({ purpose });
  response.payment_intent.amount_received = 19999;
  const config = configuration({ taxMode: "automatic" });
  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse: response
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter.retrieveServiceAssessmentPayment(
        serviceAssessmentReadRequest({ purpose })
      ),
    (error) =>
      error.code ===
        "stripe_service_assessment_payment_mismatch" &&
      error.status === 502
  );
});

test("assessment settlement rejects refunded Charge evidence", async () => {
  const purpose = serviceAssessmentPurpose();
  for (const mutate of [
    (charge) => {
      charge.refunded = true;
    },
    (charge) => {
      charge.amount_refunded = 1;
    }
  ]) {
    const response =
      serviceAssessmentCheckoutReadback({ purpose });
    mutate(response.payment_intent.latest_charge);
    const config = configuration({
      taxMode: "automatic"
    });
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse: response
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.retrieveServiceAssessmentPayment(
          serviceAssessmentReadRequest({ purpose })
        ),
      (error) =>
        error.code ===
          "stripe_service_assessment_payment_mismatch" &&
        error.status === 502
    );
  }
});

test("assessment settlement rejects exact metadata, tax, and total drift", async () => {
  const purpose = serviceAssessmentPurpose();
  for (const mutate of [
    (response) => {
      response.metadata.purpose_digest = "0".repeat(64);
    },
    (response) => {
      response.payment_intent.metadata.invoice_digest =
        "0".repeat(64);
    },
    (response) => {
      response.total_details.amount_tax = 1;
    },
    (response) => {
      response.amount_total = 20001;
    }
  ]) {
    const response =
      serviceAssessmentCheckoutReadback({ purpose });
    mutate(response);
    const config = configuration({
      taxMode: "automatic"
    });
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse: response
    });
    await assert.rejects(
      adapterFixture({ config, fake })
        .adapter.retrieveServiceAssessmentPayment(
          serviceAssessmentReadRequest({ purpose })
        ),
      (error) =>
        error.code ===
          "stripe_service_assessment_payment_mismatch" &&
        error.status === 502 &&
        error.certainty === undefined
    );
  }
});

test("assessment provider read transport failures are not submitted", async () => {
  const purpose = serviceAssessmentPurpose();
  const config = configuration({ taxMode: "automatic" });
  for (const [operation, code] of [
    [
      "retrieveServiceAssessmentPayment",
      "stripe_service_assessment_payment_read_unavailable"
    ],
    [
      "retrieveServiceAssessmentCheckoutLifecycle",
      "stripe_service_assessment_checkout_lifecycle_unavailable"
    ]
  ]) {
    const fake = fakeStripe({
      config,
      checkoutRetrieveError:
        new Error("transport down")
    });
    await assert.rejects(
      adapterFixture({ config, fake }).adapter[
        operation
      ](serviceAssessmentReadRequest({ purpose })),
      (error) =>
        error.name === "ExternalEffectError" &&
        error.code === code &&
        error.certainty === "not_submitted"
    );
    assert.equal(fake.calls.checkoutReads.length, 1);
  }
});

test("assessment lifecycle readback projects only open, expired, or paid", async () => {
  const purpose = serviceAssessmentPurpose();
  const config = configuration({ taxMode: "automatic" });
  for (const [status, paymentStatus, state] of [
    ["open", "unpaid", "open"],
    ["expired", "unpaid", "expired"],
    ["complete", "paid", "paid"]
  ]) {
    const fake = fakeStripe({
      config,
      checkoutRetrieveResponse:
        serviceAssessmentCheckoutReadback({
          purpose,
          status,
          paymentStatus
        })
    });
    const { adapter, calls } = adapterFixture({
      config,
      fake
    });
    const lifecycle =
      await adapter
        .retrieveServiceAssessmentCheckoutLifecycle(
          serviceAssessmentReadRequest({ purpose })
        );
    assert.deepEqual(lifecycle, {
      schema:
        "sitesourcery.stripe-service-assessment-checkout-lifecycle/v1",
      provider: "stripe",
      checkoutSessionId:
        "cs_test_service_assessment_1",
      purposeDigest: digest(purpose),
      state
    });
    assert.equal(Object.isFrozen(lifecycle), true);
    assert.deepEqual(calls.checkoutReads, [
      {
        id: "cs_test_service_assessment_1",
        params: undefined
      }
    ]);
  }

  const fake = fakeStripe({
    config,
    checkoutRetrieveResponse:
      serviceAssessmentCheckoutReadback({
        purpose,
        status: "complete",
        paymentStatus: "unpaid"
      })
  });
  await assert.rejects(
    adapterFixture({ config, fake })
      .adapter
      .retrieveServiceAssessmentCheckoutLifecycle(
        serviceAssessmentReadRequest({ purpose })
      ),
    (error) =>
      error.code ===
        "stripe_service_assessment_checkout_lifecycle_invalid" &&
      error.status === 502
  );
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
