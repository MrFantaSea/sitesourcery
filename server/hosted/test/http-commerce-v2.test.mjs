import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommerceV2Boundary,
  createCommerceV2Service,
  createHostedDownloadCommerce,
  createMemoryCommerceV2Repository
} from "../../commerce-v2/index.mjs";
import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const CSRF = "c".repeat(43);
const SESSION_TOKEN = "session_download_owner";
const ACTOR = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001"
});
const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const PROJECT_A =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_B =
  "20000000-0000-4000-8000-000000000002";
const VERSION_A =
  "30000000-0000-4000-8000-000000000001";
const VERSION_B =
  "30000000-0000-4000-8000-000000000002";
const NOW = "2026-07-30T17:00:00.000Z";
const HELD_DOMAIN_CAPABILITY = Object.freeze({
  ready: false,
  verified: false,
  mounted: false,
  mode: "held",
  purchaseReady: false,
  registrar: "held",
  payments: "held",
  dns: "held",
  providerEffects: false,
  remoteWrites: false,
  automaticCommands: false
});
const HELD_RESPONDER_COMMERCE_CAPABILITY = Object.freeze({
  ready: false,
  mounted: false,
  mode: "held-local",
  durableCommercialState: false,
  catalogAuthorityVerified: false,
  taxPurposeReleased: false,
  sellable: false,
  commercialEffects: false,
  customerEffects: false,
  mailDeliveryEffects: false,
  paymentEffects: false,
  providerEffects: false
});

function writeRequest(
  path,
  {
    body,
    cookie =
      `ss_csrf=${CSRF}; ss_session=${SESSION_TOKEN}`,
    csrf = CSRF,
    idempotencyKey = "download-command-1"
  } = {}
) {
  const headers = {
    Origin: ORIGIN,
    Cookie: cookie
  };
  if (csrf !== null) {
    headers["X-CSRF-Token"] = csrf;
  }
  if (idempotencyKey !== null) {
    headers["Idempotency-Key"] =
      idempotencyKey;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) })
  });
}

function createBaseService() {
  const authenticateCalls = [];
  return {
    authenticateCalls,
    service: {
      async authenticate(token) {
        authenticateCalls.push(token);
        return token === SESSION_TOKEN ? ACTOR : null;
      },
      async readiness() {
        return {
          ready: true,
          registration: {
            ready: false,
            verified: false,
            mode: "held"
          },
          recovery: {
            ready: false,
            verified: false,
            mode: "held"
          },
          publication: {
            ready: true,
            held: true
          },
          providers: {
            domains: {
              ready: false,
              registrar: "held"
            }
          }
        };
      }
    }
  };
}

function createIds() {
  let value = 0;
  return {
    next(prefix) {
      value += 1;
      return `${prefix}_${value}`;
    }
  };
}

function createContext({
  held = false,
  payment = null
} = {}) {
  const base = createBaseService();
  let requestId = 0;
  if (held) {
    return {
      ...base,
      api: createHostedApi(base.service, {
        requestIds: {
          next() {
            requestId += 1;
            return `request_${requestId}`;
          }
        }
      })
    };
  }

  const repository =
    createMemoryCommerceV2Repository();
  const calls = {
    project: [],
    version: [],
    scope: []
  };
  const projects = [PROJECT_A, PROJECT_B].map(
    (projectId) => ({
      tenantId: TENANT_ID,
      customerId: ACTOR.userId,
      projectId,
      kind: "editor_project",
      purchaseEligible: true
    })
  );
  const versions = [
    {
      projectId: PROJECT_A,
      versionId: VERSION_A,
      state: "accepted",
      contentDigest: "a".repeat(64)
    },
    {
      projectId: PROJECT_B,
      versionId: VERSION_B,
      state: "accepted",
      contentDigest: "b".repeat(64)
    }
  ];
  const commerce = createCommerceV2Service({
    projects: {
      async resolveEditorProject(input) {
        calls.project.push(structuredClone(input));
        return structuredClone(
          projects.find(
            (project) =>
              project.tenantId === input.tenantId &&
              project.customerId ===
                input.customerId &&
              project.projectId === input.projectId
          ) ?? null
        );
      }
    },
    versions: {
      async resolveAcceptedVersion(input) {
        calls.version.push(structuredClone(input));
        return structuredClone(
          versions.find(
            (version) =>
              version.projectId === input.projectId &&
              version.versionId === input.versionId
          ) ?? null
        );
      }
    },
    repository,
    clock: {
      now() {
        return NOW;
      }
    },
    ids: createIds()
  });
  const downloadCommerce =
    createHostedDownloadCommerce({
      boundary: createCommerceV2Boundary(commerce),
      async resolveSession({ actor, projectId }) {
        calls.scope.push({
          actor: structuredClone(actor),
          projectId
        });
        if (
          actor.userId !== ACTOR.userId ||
          ![PROJECT_A, PROJECT_B].includes(
            projectId
          )
        ) {
          return null;
        }
        return {
          tenantId: TENANT_ID,
          customerId: ACTOR.userId,
          actorId: actor.userId,
          projectId
        };
      },
      ...(payment ? { payment } : {})
    });
  return {
    ...base,
    calls,
    repository,
    api: createHostedApi(base.service, {
      downloadCommerce,
      requestIds: {
        next() {
          requestId += 1;
          return `request_${requestId}`;
        }
      }
    })
  };
}

async function createDownloadQuote(
  context,
  {
    projectId = PROJECT_A,
    versionId = VERSION_A,
    idempotencyKey = "download-quote-command-a",
    body = null
  } = {}
) {
  return context.api.fetch(
    writeRequest(
      `/api/v1/projects/${projectId}/download-quotes`,
      {
        body: body ?? { versionId },
        idempotencyKey
      }
    )
  );
}

test("held runtime authenticates but cannot create a Download quote", async () => {
  const context = createContext({ held: true });
  const response =
    await createDownloadQuote(context);
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "DOWNLOAD_COMMERCE_HELD"
  );
  assert.deepEqual(context.authenticateCalls, [
    SESSION_TOKEN
  ]);

  const signedOut = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_A}/download-quotes`,
      {
        body: { versionId: VERSION_A },
        cookie: `ss_csrf=${CSRF}`
      }
    )
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
});

test("public capabilities enable only actions whose server boundary can succeed", async () => {
  const held = createContext({ held: true });
  const heldResponse = await held.api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(heldResponse.status, 200);
  assert.deepEqual(await heldResponse.json(), {
    accountRegistration: false,
    accountRecoveryEmail: false,
    downloadQuote: false,
    downloadPayment: false,
    alakazamQuote: false,
    alakazamCheckout: false,
    alakazamDowngrade: false,
    alakazam35: false,
    alakazam50: false,
    alakazamRetainedPremium: false,
    alakazamPublication: false,
    mailProviderEvents: false,
    responderProviderEvents: false,
    responderInboundEvents: false,
    care: false,
    careCommerce: {
      ready: false,
      mounted: false,
      mode: "held-local",
      commercialReady: false,
      taxPurposeReleased: false,
      commercialEffects: false,
      customerEffects: false,
      mailDeliveryEffects: false,
      paymentEffects: false,
      providerEffects: false
    },
    responder: false,
    responderCommerce: HELD_RESPONDER_COMMERCE_CAPABILITY,
    adjacentIntegrations: {
      ready: false,
      mode: "held",
      systems: [],
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    },
    domains: HELD_DOMAIN_CAPABILITY,
    domainPurchase: false,
    publishing: false
  });

  const quoteReady = createContext();
  const quoteResponse = await quoteReady.api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(quoteResponse.status, 200);
  assert.deepEqual(await quoteResponse.json(), {
    accountRegistration: false,
    accountRecoveryEmail: false,
    downloadQuote: true,
    downloadPayment: false,
    alakazamQuote: false,
    alakazamCheckout: false,
    alakazamDowngrade: false,
    alakazam35: false,
    alakazam50: false,
    alakazamRetainedPremium: false,
    alakazamPublication: false,
    mailProviderEvents: false,
    responderProviderEvents: false,
    responderInboundEvents: false,
    care: false,
    careCommerce: {
      ready: false,
      mounted: false,
      mode: "held-local",
      commercialReady: false,
      taxPurposeReleased: false,
      commercialEffects: false,
      customerEffects: false,
      mailDeliveryEffects: false,
      paymentEffects: false,
      providerEffects: false
    },
    responder: false,
    responderCommerce: HELD_RESPONDER_COMMERCE_CAPABILITY,
    adjacentIntegrations: {
      ready: false,
      mode: "held",
      systems: [],
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    },
    domains: HELD_DOMAIN_CAPABILITY,
    domainPurchase: false,
    publishing: false
  });
});

test("ready Download payment returns only a Stripe destination and entitlement-gated HTML", async () => {
  const paymentCalls = {
    dispatch: [],
    download: []
  };
  const payment = {
    async readiness() {
      return {
        ready: true,
        payment: true,
        state: "ready"
      };
    },
    async dispatch(preparation) {
      paymentCalls.dispatch.push(
        structuredClone(preparation)
      );
      return {
        schema:
          "sitesourcery.abracadabra-checkout-dispatch.v2",
        commandId: preparation.commandId,
        quoteId: preparation.quoteId,
        projectId: preparation.projectId,
        versionId: preparation.versionId,
        offerId: "spark_download",
        entitlementKind: "spark_download",
        state: "ready",
        dispatchAuthorized: true,
        provider: "stripe",
        dispatchedAt: NOW,
        purposeDigest: preparation.purposeDigest,
        checkout: {
          id: "cs_test_download_http_1",
          url:
            "https://checkout.stripe.com/c/pay/http_1",
          expiresAt:
            "2026-07-30T17:30:00.000Z"
        },
        checkoutUrl:
          "https://checkout.stripe.com/c/pay/http_1"
      };
    },
    async ingestStripeEvent() {
      return { status: "processed" };
    },
    async download(input) {
      paymentCalls.download.push(
        structuredClone(input)
      );
      return {
        bytes: Buffer.from(
          "<!doctype html><title>Download</title>"
        ),
        filename: "sitesourcery-download.html",
        sha256:
          "a40fb8b9f7c90d7dd58f215627fb584509f286396229f9160872dc4b4ff19838"
      };
    }
  };
  const context = createContext({ payment });
  const capabilities = await context.api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(
    (await capabilities.json()).downloadPayment,
    true
  );

  const quote = await (
    await createDownloadQuote(context)
  ).json();
  const checkout = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_A}` +
        `/download-quotes/${quote.quoteId}` +
        "/checkout-command",
      {
        body: {
          acceptedDisclosureDigest:
            quote.disclosureDigest
        },
        idempotencyKey:
          "download-checkout-ready"
      }
    )
  );
  assert.equal(checkout.status, 201);
  const dispatched = await checkout.json();
  assert.equal(dispatched.state, "ready");
  assert.equal(
    dispatched.checkoutUrl,
    "https://checkout.stripe.com/c/pay/http_1"
  );
  assert.equal(paymentCalls.dispatch.length, 1);
  assert.equal(
    Object.hasOwn(
      dispatched,
      "purpose"
    ),
    false
  );

  const download = await context.api.fetch(
    new Request(
      `${ORIGIN}/api/v1/projects/${PROJECT_A}` +
        `/versions/${VERSION_A}/download`,
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `ss_session=${SESSION_TOKEN}`
        }
      }
    )
  );
  assert.equal(download.status, 200);
  assert.equal(
    download.headers.get("content-type"),
    "text/html; charset=utf-8"
  );
  assert.match(
    download.headers.get("content-disposition"),
    /attachment/u
  );
  assert.equal(
    await download.text(),
    "<!doctype html><title>Download</title>"
  );
  assert.deepEqual(paymentCalls.download, [
    {
      tenantId: TENANT_ID,
      customerId: ACTOR.userId,
      actorId: ACTOR.userId,
      projectId: PROJECT_A,
      versionId: VERSION_A
    }
  ]);
});

test("Download quote route exposes only the exact held $5 snapshot", async () => {
  const context = createContext();
  const response =
    await createDownloadQuote(context);
  assert.equal(response.status, 201);
  const quote = await response.json();
  assert.equal(quote.offerId, "spark_download");
  assert.deepEqual(quote.price, {
    amountMinor: 500,
    currency: "USD",
    billing: "one_time",
    interval: null
  });
  assert.equal(
    quote.entitlementKind,
    "spark_download"
  );
  assert.equal(quote.project.projectId, PROJECT_A);
  assert.equal(quote.version.versionId, VERSION_A);
  assert.equal(quote.state, "held");
  assert.equal(quote.dispatchAuthorized, false);
  assert.equal(
    quote.disclosure.offer.commercialStatus,
    "owner_accepted"
  );
  assert.equal(typeof quote.disclosureDigest, "string");
  assert.equal(typeof quote.snapshotDigest, "string");
  assert.equal(
    Object.hasOwn(quote, "tenantId"),
    false
  );
  assert.equal(
    Object.hasOwn(quote, "customerId"),
    false
  );
  assert.equal(Object.hasOwn(quote, "actorId"), false);
  assert.doesNotMatch(
    JSON.stringify(quote),
    /stripe/iu
  );
  assert.equal(
    context.repository.inspect().quotes.length,
    1
  );
  assert.equal(context.calls.scope.length, 1);
  assert.equal(context.calls.project.length, 1);
  assert.equal(context.calls.version.length, 1);
});

test("checkout-command route prepares one exact held command and never dispatches", async () => {
  const context = createContext();
  const quoteResponse =
    await createDownloadQuote(context);
  const quote = await quoteResponse.json();
  const path =
    `/api/v1/projects/${PROJECT_A}` +
    `/download-quotes/${quote.quoteId}` +
    "/checkout-command";
  const first = await context.api.fetch(
    writeRequest(path, {
      body: {
        acceptedDisclosureDigest:
          quote.disclosureDigest
      },
      idempotencyKey:
        "download-checkout-command-a"
    })
  );
  assert.equal(first.status, 201);
  const preparation = await first.json();
  assert.equal(preparation.quoteId, quote.quoteId);
  assert.equal(preparation.projectId, PROJECT_A);
  assert.equal(preparation.versionId, VERSION_A);
  assert.equal(
    preparation.offerId,
    "spark_download"
  );
  assert.equal(
    preparation.entitlementKind,
    "spark_download"
  );
  assert.equal(preparation.state, "held");
  assert.equal(
    preparation.holdReason,
    "provider_dispatch_not_authorized"
  );
  assert.equal(
    preparation.dispatchAuthorized,
    false
  );
  assert.equal(preparation.provider, null);
  assert.equal(
    Object.hasOwn(preparation, "purpose"),
    false
  );
  assert.equal(
    typeof preparation.purposeDigest,
    "string"
  );
  assert.doesNotMatch(
    JSON.stringify(preparation),
    /stripe|https?:/iu
  );

  const replay = await context.api.fetch(
    writeRequest(path, {
      body: {
        acceptedDisclosureDigest:
          quote.disclosureDigest
      },
      idempotencyKey:
        "download-checkout-command-a"
    })
  );
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), preparation);
  assert.equal(
    context.repository.inspect()
      .checkoutPreparations.length,
    1
  );
});

test("Download HTTP boundary rejects client money, entitlement, routes, tenures, and offer selection", async () => {
  for (const [name, body, expectedCode] of [
    [
      "money",
      { versionId: VERSION_A, amountMinor: 1 },
      "COMMERCE_V2_CLIENT_COMMERCE_AUTHORITY_REJECTED"
    ],
    [
      "provider",
      {
        versionId: VERSION_A,
        metadata: { priceId: "price_attacker" }
      },
      "COMMERCE_V2_CLIENT_COMMERCE_AUTHORITY_REJECTED"
    ],
    [
      "entitlement",
      {
        versionId: VERSION_A,
        entitlementKind: "spark_download"
      },
      "COMMERCE_V2_CLIENT_COMMERCE_AUTHORITY_REJECTED"
    ],
    [
      "tenure",
      { versionId: VERSION_A, tenureId: "own" },
      "COMMERCE_V2_LEGACY_TENURE_REJECTED"
    ],
    [
      "offer",
      {
        versionId: VERSION_A,
        offerId: "not_the_download"
      },
      "COMMERCE_V2_OFFER_NOT_AVAILABLE"
    ],
    [
      "route-project",
      {
        versionId: VERSION_A,
        projectId: PROJECT_B
      },
      "COMMERCE_V2_ROUTE_BINDING_REJECTED"
    ]
  ]) {
    const context = createContext();
    const response = await createDownloadQuote(
      context,
      {
        body,
        idempotencyKey: `attack-${name}`
      }
    );
    assert.equal(response.status, 400, name);
    assert.equal(
      (await response.json()).error.code,
      expectedCode,
      name
    );
    assert.equal(
      context.repository.inspect().quotes.length,
      0,
      name
    );
    assert.equal(
      context.repository.inspect()
        .checkoutPreparations.length,
      0,
      name
    );
  }
});

test("Download quote and command identity cannot cross projects", async () => {
  const context = createContext();
  const quoteA = await (
    await createDownloadQuote(context)
  ).json();
  const crossProject = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_B}` +
        `/download-quotes/${quoteA.quoteId}` +
        "/checkout-command",
      {
        body: {
          acceptedDisclosureDigest:
            quoteA.disclosureDigest
        },
        idempotencyKey: "cross-project-command"
      }
    )
  );
  assert.equal(crossProject.status, 404);
  assert.equal(
    (await crossProject.json()).error.code,
    "COMMERCE_V2_QUOTE_UNAVAILABLE"
  );
  assert.equal(
    context.repository.inspect()
      .checkoutPreparations.length,
    0
  );

  const validA = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_A}` +
        `/download-quotes/${quoteA.quoteId}` +
        "/checkout-command",
      {
        body: {
          acceptedDisclosureDigest:
            quoteA.disclosureDigest
        },
        idempotencyKey: "shared-checkout-command"
      }
    )
  );
  assert.equal(validA.status, 201);
  const quoteB = await (
    await createDownloadQuote(context, {
      projectId: PROJECT_B,
      versionId: VERSION_B,
      idempotencyKey: "download-quote-command-b"
    })
  ).json();
  const reused = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_B}` +
        `/download-quotes/${quoteB.quoteId}` +
        "/checkout-command",
      {
        body: {
          acceptedDisclosureDigest:
            quoteB.disclosureDigest
        },
        idempotencyKey: "shared-checkout-command"
      }
    )
  );
  assert.equal(reused.status, 409);
  assert.equal(
    (await reused.json()).error.code,
    "COMMERCE_V2_IDEMPOTENCY_CONFLICT"
  );
  assert.equal(
    context.repository.inspect()
      .checkoutPreparations.length,
    1
  );
});

test("HTTP exposes no v2 catalog, provisional quote, dispatch, or settlement route", async () => {
  const context = createContext();
  for (const request of [
    new Request(
      `${ORIGIN}/api/v1/commerce-v2/offers`,
      {
        headers: {
          Origin: ORIGIN,
          Cookie: `ss_session=${SESSION_TOKEN}`
        }
      }
    ),
    writeRequest(
      `/api/v1/projects/${PROJECT_A}/publish-quotes`,
      { body: { versionId: VERSION_A } }
    ),
    writeRequest(
      `/api/v1/projects/${PROJECT_A}` +
        "/download-quotes/quote_x/dispatch",
      { body: {} }
    ),
    writeRequest(
      `/api/v1/projects/${PROJECT_A}` +
        "/download-quotes/quote_x/settlement",
      { body: {} }
    )
  ]) {
    const response = await context.api.fetch(request);
    assert.equal(response.status, 404);
    assert.equal(
      (await response.json()).error.code,
      "NOT_FOUND"
    );
  }
  assert.equal(
    context.repository.inspect().quotes.length,
    0
  );
});

test("CSRF and idempotency gates reject Download writes before commerce", async () => {
  const context = createContext();
  const missingCsrf = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_A}/download-quotes`,
      {
        body: { versionId: VERSION_A },
        csrf: null
      }
    )
  );
  assert.equal(missingCsrf.status, 403);
  assert.equal(
    (await missingCsrf.json()).error.code,
    "CSRF_TOKEN_REQUIRED"
  );

  const missingCommand = await context.api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_A}/download-quotes`,
      {
        body: { versionId: VERSION_A },
        idempotencyKey: null
      }
    )
  );
  assert.equal(missingCommand.status, 400);
  assert.equal(
    (await missingCommand.json()).error.code,
    "IDEMPOTENCY_KEY_REQUIRED"
  );
  assert.equal(context.calls.scope.length, 0);
  assert.equal(
    context.repository.inspect().quotes.length,
    0
  );
});
