import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
const SECRET_KEY = "sk_live_do-not-log-this";
const WEBHOOK_SECRET = "whsec_do-not-log-this";

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
    SITESOURCERY_STRIPE_TAX_MODE:
      "disabled_by_owner"
  };
  return { ...environment, ...environmentOverrides };
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
        "whsec_ignored-while-held"
    },
    adapterFactory: capture.factory
  });
  assert.equal(composition.mode, "held");
  assert.equal(composition.adapter, capture.adapter);
  assert.deepEqual(capture.calls, [{ mode: "held" }]);
  assert.doesNotMatch(
    JSON.stringify(composition),
    /sk_live|whsec_/u
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
      taxMode: "automatic",
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
    "taxMode",
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

test("the hosted server injects one configured adapter for Checkout and raw webhook verification", async () => {
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
});
