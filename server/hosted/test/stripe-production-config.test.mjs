import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAlakazamCancellationService
} from "../../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  createAlakazamRenewalService
} from "../../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  createAlakazamReversalService
} from "../../commerce-v2/alakazam-lifecycle-reversal.mjs";
import {
  createAlakazamPaymentIncidentService,
  createAlakazamPaymentRecoveryService
} from "../../commerce-v2/alakazam-lifecycle-state.mjs";

import {
  STRIPE_PRODUCTION_CONTRACT,
  assertApprovedStripeReady,
  createConfiguredStripeProvider,
  redactStripeReadiness
} from "../stripe-production-config.mjs";

const HOSTED_CAPABILITIES = [
  ...STRIPE_PRODUCTION_CONTRACT.hostedCapabilities
];
const DOMAIN_CAPABILITIES = [
  ...STRIPE_PRODUCTION_CONTRACT.domainCapabilities
];
const ALAKAZAM_CAPABILITIES = [
  ...STRIPE_PRODUCTION_CONTRACT.alakazamCapabilities
];
const COMPLETE_ALAKAZAM_CAPABILITIES = [
  ...new Set([
    ...HOSTED_CAPABILITIES,
    ...ALAKAZAM_CAPABILITIES
  ])
];
const SECRET_KEY = "sk_live_do-not-log-this";
const WEBHOOK_SECRET = "whsec_do-not-log-this";
const ALAKAZAM_PRODUCT_ID =
  "prod_alakazam_contract_only";
const ALAKAZAM_COUPON_ID =
  "coupon_alakazam_download_credit_contract_only";
const ALAKAZAM_PORTAL_CONFIGURATION_ID =
  "bpc_alakazam_restricted_contract_only";
const ALAKAZAM_PRICE_IDS = Object.freeze({
  alakazam_25: "price_alakazam_25_contract_only",
  alakazam_35: "price_alakazam_35_contract_only",
  alakazam_50: "price_alakazam_50_contract_only"
});

function approval(overrides = {}) {
  return {
    provider: "stripe",
    approved: true,
    environment: "production",
    livemode: true,
    apiVersion: STRIPE_PRODUCTION_CONTRACT.apiVersion,
    approvalId: "approval-production-20260729",
    approvedAt: "2026-07-29T12:00:00.000Z",
    capabilities: HOSTED_CAPABILITIES,
    ...overrides
  };
}

function productionEnvironment(overrides = {}) {
  const {
    approval: selectedApproval = approval(),
    ...environmentOverrides
  } = overrides;
  const environment = {
    SITESOURCERY_STRIPE_MODE: "approved_live",
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT:
      "production",
    SITESOURCERY_STRIPE_API_VERSION:
      STRIPE_PRODUCTION_CONTRACT.apiVersion,
    SITESOURCERY_STRIPE_LIVEMODE: "true",
    SITESOURCERY_STRIPE_APPROVAL_JSON:
      JSON.stringify(selectedApproval),
    SITESOURCERY_STRIPE_SECRET_KEY: SECRET_KEY,
    SITESOURCERY_STRIPE_WEBHOOK_SECRET:
      WEBHOOK_SECRET,
    SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON:
      JSON.stringify([
        {
          id: "price_live_website_monthly",
          livemode: true,
          currency: "usd",
          unitAmount: 2500,
          taxBehavior: "exclusive",
          recurring: {
            interval: "month",
            intervalCount: 1
          }
        }
      ]),
    SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON:
      JSON.stringify(["https://sitesourcery.com"]),
    SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL:
      "https://sitesourcery.com/abracadabra/app/?checkout={CHECKOUT_SESSION_ID}",
    SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL:
      "https://sitesourcery.com/abracadabra/app/?checkout=cancelled",
    SITESOURCERY_STRIPE_PORTAL_RETURN_URL:
      "https://sitesourcery.com/abracadabra/app/",
    SITESOURCERY_STRIPE_PORTAL_PRIVACY_POLICY_URL:
      "https://sitesourcery.com/legal/privacy/",
    SITESOURCERY_STRIPE_PORTAL_TERMS_OF_SERVICE_URL:
      "https://sitesourcery.com/legal/website-terms/",
    SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_ID:
      "we_sitesourcery_contract_only",
    SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_URL:
      "https://sitesourcery.com/api/v1/webhooks/stripe",
    SITESOURCERY_STRIPE_TAX_MODE:
      "disabled_by_owner",
    SITESOURCERY_STRIPE_TAX_CODES_JSON:
      JSON.stringify({
        alakazam: "txcd_10701100",
        customBuildChange: "txcd_10701200",
        customBuildFinal: "txcd_10701200",
        customBuildStart: "txcd_10701200",
        domainRegistration: null,
        download: "txcd_10701200",
        serviceAssessment: "txcd_10701200",
        siteService: "txcd_10701200"
      }),
    SITESOURCERY_STRIPE_TAX_ATTESTATION_JSON:
      JSON.stringify({
        schema: "sitesourcery.stripe-tax-attestation/v1",
        provider: "stripe",
        approved: true,
        attestationId: "tax-attestation-contract-only",
        approvedAt: "2026-08-09T12:00:00.000Z",
        livemode: selectedApproval.livemode,
        taxMode: "disabled_by_owner",
        headOfficeCountry: "US",
        defaultTaxBehavior: "exclusive",
        registrationDecision: "none_registered",
        registrationIds: []
      })
  };
  return { ...environment, ...environmentOverrides };
}

function alakazamProviderConfiguration(overrides = {}) {
  return {
    productId: ALAKAZAM_PRODUCT_ID,
    downloadCreditCouponId: ALAKAZAM_COUPON_ID,
    portalConfigurationId:
      ALAKAZAM_PORTAL_CONFIGURATION_ID,
    tierPriceIds: { ...ALAKAZAM_PRICE_IDS },
    ...overrides
  };
}

function alakazamPriceExpectations({
  livemode = true,
  productId = ALAKAZAM_PRODUCT_ID
} = {}) {
  return Object.entries(ALAKAZAM_PRICE_IDS).map(
    ([tierId, id]) => ({
      id,
      productId,
      livemode,
      currency: "usd",
      unitAmount: {
        alakazam_25: 2500,
        alakazam_35: 3500,
        alakazam_50: 5000
      }[tierId],
      taxBehavior: "exclusive",
      recurring: {
        interval: "month",
        intervalCount: 1
      }
    })
  );
}

function alakazamEnvironment(overrides = {}) {
  const {
    approval: selectedApproval = approval({
      capabilities: COMPLETE_ALAKAZAM_CAPABILITIES
    }),
    configuration =
      alakazamProviderConfiguration(),
    priceExpectations =
      alakazamPriceExpectations(),
    ...environmentOverrides
  } = overrides;
  return productionEnvironment({
    approval: selectedApproval,
    SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON:
      JSON.stringify(priceExpectations),
    SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON:
      JSON.stringify(configuration),
    ...environmentOverrides
  });
}

function capturingFactory() {
  const calls = [];
  const adapter = Object.freeze({
    async readiness() {
      return {
        ready: true,
        provider: "stripe",
        mode: "approved_live"
      };
    }
  });
  return {
    calls,
    adapter,
    factory(options) {
      calls.push(structuredClone(options));
      return adapter;
    }
  };
}

test("production Stripe composition defaults to held and supplies no latent configuration", () => {
  const capture = capturingFactory();
  const composition = createConfiguredStripeProvider({
    environment: {
      SITESOURCERY_STRIPE_SECRET_KEY:
        "sk_live_ignored-while-held",
      SITESOURCERY_STRIPE_WEBHOOK_SECRET:
        "whsec_ignored-while-held",
      SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON:
        JSON.stringify(
          alakazamProviderConfiguration()
        )
    },
    adapterFactory: capture.factory
  });
  assert.equal(composition.mode, "held");
  assert.equal(composition.adapter, capture.adapter);
  assert.deepEqual(capture.calls, [{ mode: "held" }]);
  assert.doesNotMatch(
    JSON.stringify(composition),
    /sk_live|whsec_|alakazam_contract_only/u
  );
});

test("approved production composition passes one exact bound configuration to the reviewed adapter", () => {
  const capture = capturingFactory();
  const environment = productionEnvironment({
    SITESOURCERY_STRIPE_CHECKOUT_TTL_SECONDS:
      "3600"
  });
  const composition = createConfiguredStripeProvider({
    environment,
    adapterFactory: capture.factory
  });
  assert.deepEqual(
    {
      mode: composition.mode,
      environment: composition.environment,
      livemode: composition.livemode,
      apiVersion: composition.apiVersion
    },
    {
      mode: "approved_live",
      environment: "production",
      livemode: true,
      apiVersion:
        STRIPE_PRODUCTION_CONTRACT.apiVersion
    }
  );
  assert.equal(capture.calls.length, 1);
  const [constructed] = capture.calls;
  assert.equal(constructed.mode, "approved_live");
  assert.equal(constructed.secretKey, SECRET_KEY);
  assert.deepEqual(
    constructed.liveApproval,
    approval()
  );
  assert.equal(
    constructed.config.webhookSecret,
    WEBHOOK_SECRET
  );
  assert.equal(
    constructed.config.checkoutTtlSeconds,
    3600
  );
  assert.equal(
    constructed.config.domainAuthorization,
    null
  );
  assert.doesNotMatch(
    JSON.stringify(composition),
    /do-not-log-this/u
  );
});

test("complete Alakazam approval binds one exact Product, tier ladder, Coupon, and restricted Portal configuration", () => {
  const capture = capturingFactory();
  const configuration =
    alakazamProviderConfiguration();
  const priceExpectations =
    alakazamPriceExpectations();
  const environment = alakazamEnvironment({
    configuration,
    priceExpectations
  });
  const composition = createConfiguredStripeProvider({
    environment,
    adapterFactory: capture.factory
  });
  assert.equal(composition.mode, "approved_live");
  assert.equal(capture.calls.length, 1);
  const [constructed] = capture.calls;
  assert.deepEqual(
    constructed.liveApproval.capabilities,
    COMPLETE_ALAKAZAM_CAPABILITIES
  );
  assert.deepEqual(
    constructed.config.alakazam,
    configuration
  );
  assert.deepEqual(
    constructed.config.priceExpectations,
    priceExpectations
  );
  assert.deepEqual(
    {
      deployment: constructed.liveApproval.environment,
      approvalLivemode:
        constructed.liveApproval.livemode,
      configuredLivemode: constructed.config.livemode,
      approvalApiVersion:
        constructed.liveApproval.apiVersion,
      configuredApiVersion:
        constructed.config.apiVersion,
      taxMode: constructed.config.taxMode,
      successUrl: constructed.config.successUrl,
      cancelUrl: constructed.config.cancelUrl,
      portalReturnUrl:
        constructed.config.portalReturnUrl
    },
    {
      deployment: "production",
      approvalLivemode: true,
      configuredLivemode: true,
      approvalApiVersion:
        STRIPE_PRODUCTION_CONTRACT.apiVersion,
      configuredApiVersion:
        STRIPE_PRODUCTION_CONTRACT.apiVersion,
      taxMode: "disabled_by_owner",
      successUrl:
        environment.SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL,
      cancelUrl:
        environment.SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL,
      portalReturnUrl:
        environment.SITESOURCERY_STRIPE_PORTAL_RETURN_URL
    }
  );
  assert.doesNotMatch(
    JSON.stringify(composition),
    /alakazam_contract_only|coupon_alakazam/u
  );
});

test("approved configuration constructs the pinned official adapter without exposing its secrets", () => {
  const composition = createConfiguredStripeProvider({
    environment: productionEnvironment()
  });
  assert.equal(composition.mode, "approved_live");
  for (const method of [
    "readiness",
    "createCheckout",
    "createBillingPortal",
    "scheduleCancellation",
    "verifyWebhook"
  ]) {
    assert.equal(
      typeof composition.adapter[method],
      "function"
    );
  }
  const output = JSON.stringify(composition);
  assert.doesNotMatch(output, /sk_live_/u);
  assert.doesNotMatch(output, /whsec_/u);
});

test("approved composition accepts only a mode-matched restricted runtime key and keeps it out of diagnostics", () => {
  for (const [secretKey, livemode, deployment] of [
    ["rk_live_contract-only", true, "production"],
    ["rk_test_contract-only", false, "staging"]
  ]) {
    const selectedApproval = approval({
      environment: deployment,
      livemode,
      approvalId: `approval-${deployment}-restricted-key`
    });
    const environment = productionEnvironment({
      approval: selectedApproval,
      SITESOURCERY_DEPLOYMENT_ENVIRONMENT: deployment,
      SITESOURCERY_STRIPE_LIVEMODE: String(livemode),
      SITESOURCERY_STRIPE_SECRET_KEY: secretKey
    });
    const expectations = JSON.parse(
      environment.SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON
    );
    expectations[0].livemode = livemode;
    environment.SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON =
      JSON.stringify(expectations);
    const composition = createConfiguredStripeProvider({
      environment
    });
    assert.equal(composition.livemode, livemode);
    assert.doesNotMatch(
      JSON.stringify(composition),
      /rk_(?:live|test)_/u
    );
  }
});

test("approved Alakazam environment constructs the pinned adapter without making provider calls", () => {
  const composition = createConfiguredStripeProvider({
    environment: alakazamEnvironment()
  });
  assert.equal(composition.mode, "approved_live");
  for (const method of [
    "createAlakazamCustomer",
    "createAlakazamStartCheckout",
    "createAlakazamUpgradeCheckout",
    "retrieveAlakazamPayment",
    "retrieveAlakazamRenewalInvoice",
    "retrieveAlakazamIncidentInvoice",
    "retrieveAlakazamCancellation",
    "retrieveAlakazamReversal",
    "retrieveAlakazamSubscription",
    "applyAlakazamUpgrade",
    "scheduleAlakazamDowngrade"
  ]) {
    assert.equal(
      typeof composition.adapter[method],
      "function"
    );
  }
  assert.doesNotMatch(
    JSON.stringify(composition),
    /alakazam_contract_only|coupon_alakazam/u
  );
});

test("held and approved production construction satisfy every Alakazam lifecycle provider port without a provider call", () => {
  const adapters = [
    createConfiguredStripeProvider({ environment: {} }).adapter,
    createConfiguredStripeProvider({
      environment: alakazamEnvironment()
    }).adapter
  ];
  const repository = {
    async findRenewalSubscriptionByInvoice() {},
    async settleRenewalPayment() {},
    async findIncidentSubscriptionByInvoice() {},
    async recordPaymentIncident() {},
    async findRecoverySubscriptionByInvoice() {},
    async recordPaymentRecovery() {},
    async readCancellationSubscription() {},
    async findCancellationBySubscription() {},
    async confirmCancellationSchedule() {},
    async findReversalPaymentByCharge() {},
    async recordReversal() {}
  };
  const clock = {
    now: () => "2026-08-09T12:00:00.000Z"
  };
  const ids = {
    next: () =>
      "10000000-0000-4000-8000-000000000001"
  };
  for (const provider of adapters) {
    const services = [
      createAlakazamRenewalService({
        repository,
        provider,
        clock,
        ids
      }),
      createAlakazamPaymentIncidentService({
        repository,
        provider,
        clock,
        ids
      }),
      createAlakazamPaymentRecoveryService({
        repository,
        provider,
        clock,
        ids
      }),
      createAlakazamCancellationService({
        repository,
        provider,
        clock,
        ids
      }),
      createAlakazamReversalService({
        repository,
        provider,
        clock,
        ids
      })
    ];
    assert.ok(
      services.every(
        (service) =>
          typeof service.readiness === "function" &&
          typeof service.ingestStripeEvent === "function"
      )
    );
  }
});

test("contract_test and every mismatched approval boundary are impossible in production composition", () => {
  const cases = [
    {
      environment: {
        SITESOURCERY_STRIPE_MODE: "contract_test"
      },
      code: "STRIPE_PRODUCTION_MODE_INVALID"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          environment: "staging"
        })
      }),
      code: "STRIPE_PRODUCTION_APPROVAL_INVALID"
    },
    {
      environment: productionEnvironment({
        SITESOURCERY_STRIPE_LIVEMODE: "false"
      }),
      code: "STRIPE_PRODUCTION_LIVEMODE_MISMATCH"
    },
    {
      environment: productionEnvironment({
        SITESOURCERY_STRIPE_API_VERSION:
          "2025-01-01"
      }),
      code: "STRIPE_PRODUCTION_API_VERSION_MISMATCH"
    },
    {
      environment: productionEnvironment({
        SITESOURCERY_STRIPE_SECRET_KEY:
          "sk_test_wrong-mode"
      }),
      code: "STRIPE_PRODUCTION_KEY_MODE_MISMATCH"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          capabilities:
            HOSTED_CAPABILITIES.slice(1)
        })
      }),
      code:
        "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          capabilities: [
            ...HOSTED_CAPABILITIES,
            DOMAIN_CAPABILITIES[0]
          ]
        })
      }),
      code:
        "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          capabilities: [
            ...HOSTED_CAPABILITIES,
            "checkout:read"
          ]
        })
      }),
      code:
        "STRIPE_PRODUCTION_CAPABILITIES_INCOMPLETE"
    },
    {
      environment: productionEnvironment({
        SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON:
          JSON.stringify(
            alakazamProviderConfiguration()
          )
      }),
      code:
        "STRIPE_PRODUCTION_ALAKAZAM_APPROVAL_REQUIRED"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          capabilities:
            COMPLETE_ALAKAZAM_CAPABILITIES
        })
      }),
      code: "STRIPE_PRODUCTION_CONFIGURATION_REQUIRED"
    },
    {
      environment: productionEnvironment({
        approval: {
          ...approval(),
          unreviewed: true
        }
      }),
      code: "STRIPE_PRODUCTION_APPROVAL_INVALID"
    },
    {
      environment: productionEnvironment({
        approval: approval({
          capabilities: [
            ...HOSTED_CAPABILITIES,
            "customers:delete"
          ]
        })
      }),
      code: "STRIPE_PRODUCTION_APPROVAL_INVALID"
    },
    {
      environment: productionEnvironment({
        SITESOURCERY_STRIPE_DOMAIN_SUCCESS_URL_TEMPLATE:
          "https://sitesourcery.com/domain/{ORDER_ID}/success?session={CHECKOUT_SESSION_ID}"
      }),
      code:
        "STRIPE_PRODUCTION_DOMAIN_APPROVAL_REQUIRED"
    }
  ];
  for (const selected of cases) {
    assert.throws(
      () =>
        createConfiguredStripeProvider({
          environment: selected.environment,
          adapterFactory() {
            assert.fail(
              "invalid configuration reached the adapter"
            );
          }
        }),
      (error) => error?.code === selected.code
    );
  }
});

test("Alakazam provider configuration rejects every partial, extra, duplicate, or mismatched binding before adapter construction", () => {
  const configuration =
    alakazamProviderConfiguration();
  const priceExpectations =
    alakazamPriceExpectations();
  const missingCoupon = {
    productId: configuration.productId,
    portalConfigurationId:
      configuration.portalConfigurationId,
    tierPriceIds: configuration.tierPriceIds
  };
  const invalidCases = [
    {
      name: "invalid JSON",
      environment: alakazamEnvironment({
        SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON:
          "{not-json"
      }),
      code: "STRIPE_PRODUCTION_JSON_INVALID"
    },
    {
      name: "missing configuration field",
      environment: alakazamEnvironment({
        configuration: missingCoupon
      })
    },
    {
      name: "extra configuration field",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          unreviewedProduct: "prod_unreviewed"
        }
      })
    },
    {
      name: "missing tier binding",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          tierPriceIds: {
            alakazam_25:
              ALAKAZAM_PRICE_IDS.alakazam_25,
            alakazam_35:
              ALAKAZAM_PRICE_IDS.alakazam_35
          }
        }
      })
    },
    {
      name: "extra tier binding",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          tierPriceIds: {
            ...ALAKAZAM_PRICE_IDS,
            alakazam_75: "price_unreviewed"
          }
        }
      })
    },
    {
      name: "duplicate tier Price",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          tierPriceIds: {
            ...ALAKAZAM_PRICE_IDS,
            alakazam_35:
              ALAKAZAM_PRICE_IDS.alakazam_25
          }
        }
      })
    },
    {
      name: "wrong Product ID type",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          productId: "price_not_a_product"
        }
      })
    },
    {
      name: "wrong Portal configuration ID type",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          portalConfigurationId:
            "prod_not_a_portal_configuration"
        }
      })
    },
    {
      name: "unsafe Coupon token",
      environment: alakazamEnvironment({
        configuration: {
          ...configuration,
          downloadCreditCouponId:
            "coupon contains whitespace"
        }
      })
    },
    {
      name: "missing selected Price expectation",
      environment: alakazamEnvironment({
        priceExpectations:
          priceExpectations.slice(0, 2)
      })
    },
    {
      name: "extra selected Price field",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation, index) =>
            index === 0
              ? {
                  ...expectation,
                  nickname: "unreviewed"
                }
              : expectation
        )
      })
    },
    {
      name: "wrong monthly amount",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation) =>
            expectation.id ===
            ALAKAZAM_PRICE_IDS.alakazam_35
              ? { ...expectation, unitAmount: 3600 }
              : expectation
        )
      })
    },
    {
      name: "wrong Product binding",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation) =>
            expectation.id ===
            ALAKAZAM_PRICE_IDS.alakazam_50
              ? {
                  ...expectation,
                  productId: "prod_somewhere_else"
                }
              : expectation
        )
      })
    },
    {
      name: "wrong currency",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation) =>
            expectation.id ===
            ALAKAZAM_PRICE_IDS.alakazam_25
              ? { ...expectation, currency: "eur" }
              : expectation
        )
      })
    },
    {
      name: "wrong recurrence",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation) =>
            expectation.id ===
            ALAKAZAM_PRICE_IDS.alakazam_25
              ? {
                  ...expectation,
                  recurring: {
                    interval: "year",
                    intervalCount: 1
                  }
                }
              : expectation
        )
      })
    },
    {
      name: "wrong provider mode",
      environment: alakazamEnvironment({
        priceExpectations: priceExpectations.map(
          (expectation) => ({
            ...expectation,
            livemode: false
          })
        )
      })
    },
    {
      name: "extra Product Price",
      environment: alakazamEnvironment({
        priceExpectations: [
          ...priceExpectations,
          {
            ...priceExpectations[0],
            id: "price_alakazam_extra_contract_only",
            unitAmount: 7500
          }
        ]
      })
    }
  ];
  for (const selected of invalidCases) {
    let factoryCalls = 0;
    assert.throws(
      () =>
        createConfiguredStripeProvider({
          environment: selected.environment,
          adapterFactory() {
            factoryCalls += 1;
            assert.fail(
              `${selected.name} reached the adapter`
            );
          }
        }),
      (error) =>
        error?.code ===
        (selected.code ??
          "STRIPE_PRODUCTION_ALAKAZAM_CONFIGURATION_INVALID"),
      selected.name
    );
    assert.equal(factoryCalls, 0, selected.name);
  }
});

test("complete domain approval requires and binds exact order templates and disclosure", () => {
  const capture = capturingFactory();
  const domainApproval = approval({
    capabilities: [
      ...HOSTED_CAPABILITIES,
      ...DOMAIN_CAPABILITIES
    ]
  });
  assert.throws(
    () =>
      createConfiguredStripeProvider({
        environment: productionEnvironment({
          approval: domainApproval
        }),
        adapterFactory: capture.factory
      }),
    (error) =>
      error?.code ===
      "STRIPE_PRODUCTION_CONFIGURATION_REQUIRED"
  );
  const composition = createConfiguredStripeProvider({
    environment: productionEnvironment({
      approval: domainApproval,
      SITESOURCERY_STRIPE_DOMAIN_SUCCESS_URL_TEMPLATE:
        "https://sitesourcery.com/domain/{ORDER_ID}/success?session={CHECKOUT_SESSION_ID}",
      SITESOURCERY_STRIPE_DOMAIN_CANCEL_URL_TEMPLATE:
        "https://sitesourcery.com/domain/{ORDER_ID}/cancel",
      SITESOURCERY_STRIPE_DOMAIN_AUTHORIZATION_DISCLOSURE:
        "Authorize the exact domain total; capture follows verified registrar readback."
    }),
    adapterFactory: capture.factory
  });
  assert.equal(composition.mode, "approved_live");
  assert.deepEqual(
    capture.calls.at(-1).config.domainAuthorization,
    {
      successUrlTemplate:
        "https://sitesourcery.com/domain/{ORDER_ID}/success?session={CHECKOUT_SESSION_ID}",
      cancelUrlTemplate:
        "https://sitesourcery.com/domain/{ORDER_ID}/cancel",
      authorizationDisclosure:
        "Authorize the exact domain total; capture follows verified registrar readback."
    }
  );
});

test("staging is pinned to Stripe test mode and the matching key", () => {
  const capture = capturingFactory();
  const stagingApproval = approval({
    environment: "staging",
    livemode: false,
    approvalId: "approval-staging-20260729"
  });
  const environment = productionEnvironment({
    approval: stagingApproval,
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT:
      "staging",
    SITESOURCERY_STRIPE_LIVEMODE: "false",
    SITESOURCERY_STRIPE_SECRET_KEY:
      "sk_test_staging-only"
  });
  const priceExpectations = JSON.parse(
    environment
      .SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON
  );
  priceExpectations[0].livemode = false;
  environment.SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON =
    JSON.stringify(priceExpectations);
  const composition = createConfiguredStripeProvider({
    environment,
    adapterFactory: capture.factory
  });
  assert.equal(composition.environment, "staging");
  assert.equal(composition.livemode, false);
  assert.match(
    capture.calls[0].secretKey,
    /^sk_test_/u
  );
});

test("Alakazam staging configuration binds every provider expectation to test mode", () => {
  const capture = capturingFactory();
  const stagingApproval = approval({
    environment: "staging",
    livemode: false,
    approvalId:
      "approval-alakazam-staging-20260804",
    capabilities: COMPLETE_ALAKAZAM_CAPABILITIES
  });
  const environment = alakazamEnvironment({
    approval: stagingApproval,
    priceExpectations: alakazamPriceExpectations({
      livemode: false
    }),
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT:
      "staging",
    SITESOURCERY_STRIPE_LIVEMODE: "false",
    SITESOURCERY_STRIPE_SECRET_KEY:
      "sk_test_alakazam-staging-only"
  });
  const composition = createConfiguredStripeProvider({
    environment,
    adapterFactory: capture.factory
  });
  assert.equal(composition.environment, "staging");
  assert.equal(composition.livemode, false);
  assert.equal(
    capture.calls[0].config.alakazam.productId,
    ALAKAZAM_PRODUCT_ID
  );
  assert.ok(
    capture.calls[0].config.priceExpectations.every(
      (expectation) => expectation.livemode === false
    )
  );
});

test("readiness and startup diagnostics expose only an allowlisted projection", () => {
  const composition = {
    mode: "approved_live",
    environment: "production",
    livemode: true,
    apiVersion:
      STRIPE_PRODUCTION_CONTRACT.apiVersion
  };
  const redacted = redactStripeReadiness(
    {
      ready: false,
      provider: "stripe",
      mode: "approved_live",
      environment: "production",
      livemode: true,
      apiVersion:
        STRIPE_PRODUCTION_CONTRACT.apiVersion,
      priceCount: 3,
      domainAuthorization: true,
      webhookVerification: true,
      webhookEndpoint: true,
      taxMode: "automatic",
      taxAttestation: true,
      code: "stripe_price_mismatch",
      secretKey: SECRET_KEY,
      webhookSecret: WEBHOOK_SECRET,
      priceIds: ["price_live_secret"],
      approvalId: "approval-secret",
      urls: ["https://private.example/path"]
    },
    composition
  );
  assert.deepEqual(Object.keys(redacted).sort(), [
    "apiVersion",
    "code",
    "domainAuthorization",
    "environment",
    "livemode",
    "mode",
    "priceCount",
    "provider",
    "ready",
    "taxAttestation",
    "taxMode",
    "webhookEndpoint",
    "webhookVerification"
  ]);
  const output = JSON.stringify(redacted);
  for (const secret of [
    SECRET_KEY,
    WEBHOOK_SECRET,
    "price_live_secret",
    "approval-secret",
    "private.example"
  ]) {
    assert.doesNotMatch(output, new RegExp(secret, "u"));
  }
  assert.throws(
    () =>
      assertApprovedStripeReady(
        composition,
        redacted
      ),
    (error) =>
      error?.code === "STRIPE_PRODUCTION_NOT_READY" &&
      !JSON.stringify(error).includes(SECRET_KEY)
  );
  assert.doesNotThrow(() =>
    assertApprovedStripeReady(
      { mode: "held" },
      { ready: false }
    )
  );
  assert.equal(
    redactStripeReadiness(
      {
        ready: false,
        code: SECRET_KEY,
        mode: WEBHOOK_SECRET,
        environment: "price_live_secret",
        taxMode: "approval-secret"
      },
      composition
    ).code,
    "stripe_not_ready"
  );
});

test("the hosted server injects one configured adapter for Checkout and every verified webhook branch", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createConfiguredStripeProvider\(\)/u
  );
  assert.match(
    source,
    /paymentProvider:\s*stripeComposition\.adapter/u
  );
  assert.match(
    source,
    /createConfiguredAlakazamRelease\(\)/u
  );
  assert.match(
    source,
    /createPostgresAlakazamRepository\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /createAlakazamStripeEventRouter\(\{/u
  );
  assert.match(
    source,
    /const alakazamUpgrade\s*=\s*createAlakazamUpgradeService\([\s\S]*upgradeActivation:\s*alakazamUpgrade,\s*upgradeApplication:\s*alakazamUpgrade/u
  );
  assert.match(
    source,
    /downloadCommerce,\s*assessmentCommerce:\s*customServicesAssessmentSettlement,\s*customBuildCommerce:\s*customBuildPayment,\s*alakazamCommerce/u
  );
  assert.match(
    source,
    /const domainRuntime\s*=\s*createHeldDomainRuntime\(\)/u
  );
  assert.match(
    source,
    /paymentProvider:\s*stripeComposition\.adapter,\s*domainRuntime/u
  );
  assert.equal(
    source.match(
      /createConfiguredStripeProvider\(\)/gu
    )?.length,
    1
  );
  assert.equal(
    source.match(
      /createAlakazamUpgradeService\(/gu
    )?.length,
    1
  );
});
