import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const SESSION_TOKEN = "session_alakazam_billing";
const CSRF = "c".repeat(40);
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "40000000-0000-4000-8000-000000000001";
const CHECKOUT_COMMAND_ID =
  "50000000-0000-4000-8000-000000000001";
const DOWNGRADE_COMMAND_ID =
  "60000000-0000-4000-8000-000000000001";
const DISCLOSURE_DIGEST = "d".repeat(64);
const SITE_SETUP_DIGEST = "c".repeat(64);
const QUOTE_DIGEST = "e".repeat(64);

function service() {
  return {
    async readiness() {
      return {};
    },
    async authenticate(token) {
      return token === SESSION_TOKEN
        ? { userId: CUSTOMER_ID }
        : null;
    }
  };
}

function writeRequest(
  path,
  {
    body,
    idempotencyKey,
    signedIn = true,
    csrf = true
  }
) {
  const headers = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
    Cookie:
      `${signedIn ? `ss_session=${SESSION_TOKEN}; ` : ""}` +
      `ss_csrf=${CSRF}`
  };
  if (csrf) headers["X-CSRF-Token"] = CSRF;
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

test("Alakazam quote, Checkout, and downgrade routes preserve distinct route and idempotency identity", async () => {
  const calls = {
    quotes: [],
    checkouts: [],
    downgrades: []
  };
  const api = createHostedApi(service(), {
    alakazamBilling: {
      async readiness() {
        return {
          ready: true,
          quote: true,
          checkout: true,
          downgrade: true,
          state: "quote_ready"
        };
      },
      async createQuote(actor, projectId, input) {
        calls.quotes.push({
          actor: structuredClone(actor),
          projectId,
          input: structuredClone(input)
        });
        return {
          schema:
            "sitesourcery.alakazam-tier-change-quote.v1",
          quoteId: input.commandId,
          projectId,
          state: "quoted"
        };
      },
      async createCheckout(
        actor,
        projectId,
        quoteId,
        input
      ) {
        calls.checkouts.push({
          actor: structuredClone(actor),
          projectId,
          quoteId,
          input: structuredClone(input)
        });
        return {
          schema:
            "sitesourcery.alakazam-checkout-ready/v1",
          commandId: input.commandId,
          projectId,
          quoteId,
          state: "ready"
        };
      },
      async scheduleDowngrade(
        actor,
        projectId,
        quoteId,
        input
      ) {
        calls.downgrades.push({
          actor: structuredClone(actor),
          projectId,
          quoteId,
          input: structuredClone(input)
        });
        return {
          schema:
            "sitesourcery.alakazam-downgrade-scheduled/v1",
          commandId: input.commandId,
          projectId,
          quoteId,
          state: "scheduled"
        };
      }
    }
  });

  const quoteResponse = await api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_ID}/alakazam-quotes`,
      {
        body: { targetTierId: "alakazam_25" },
        idempotencyKey: QUOTE_ID
      }
    )
  );
  assert.equal(quoteResponse.status, 201);
  assert.equal((await quoteResponse.json()).quoteId, QUOTE_ID);
  assert.deepEqual(calls.quotes, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      input: {
        targetTierId: "alakazam_25",
        commandId: QUOTE_ID
      }
    }
  ]);

  const checkoutResponse = await api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_ID}` +
        `/alakazam-quotes/${QUOTE_ID}/checkout-command`,
      {
        body: {
          acceptedDisclosureDigest: DISCLOSURE_DIGEST,
          siteSetupDigest: SITE_SETUP_DIGEST
        },
        idempotencyKey: CHECKOUT_COMMAND_ID
      }
    )
  );
  assert.equal(checkoutResponse.status, 201);
  assert.equal(
    (await checkoutResponse.json()).commandId,
    CHECKOUT_COMMAND_ID
  );
  assert.deepEqual(calls.checkouts, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      input: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        commandId: CHECKOUT_COMMAND_ID,
        siteSetupDigest: SITE_SETUP_DIGEST
      }
    }
  ]);

  const downgradeResponse = await api.fetch(
    writeRequest(
      `/api/v1/projects/${PROJECT_ID}` +
        `/alakazam-quotes/${QUOTE_ID}` +
        "/downgrade-schedule-command",
      {
        body: {
          acceptedDisclosureDigest: DISCLOSURE_DIGEST,
          quoteDigest: QUOTE_DIGEST
        },
        idempotencyKey: DOWNGRADE_COMMAND_ID
      }
    )
  );
  assert.equal(downgradeResponse.status, 201);
  assert.equal(
    (await downgradeResponse.json()).commandId,
    DOWNGRADE_COMMAND_ID
  );
  assert.deepEqual(calls.downgrades, [
    {
      actor: { userId: CUSTOMER_ID },
      projectId: PROJECT_ID,
      quoteId: QUOTE_ID,
      input: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST,
        commandId: DOWNGRADE_COMMAND_ID
      }
    }
  ]);
  for (const extra of [
    { commandId: DOWNGRADE_COMMAND_ID },
    { amountMinor: 0 },
    { targetTierId: "alakazam_25" },
    { providerProration: false },
    { cashRefundMinor: 0 }
  ]) {
    const rejected = await api.fetch(
      writeRequest(
        `/api/v1/projects/${PROJECT_ID}` +
          `/alakazam-quotes/${QUOTE_ID}` +
          "/downgrade-schedule-command",
        {
          body: {
            acceptedDisclosureDigest:
              DISCLOSURE_DIGEST,
            quoteDigest: QUOTE_DIGEST,
            ...extra
          },
          idempotencyKey: DOWNGRADE_COMMAND_ID
        }
      )
    );
    assert.equal(rejected.status, 400);
    assert.equal(
      (await rejected.json()).error.code,
      "ALAKAZAM_ROUTE_BINDING_REJECTED"
    );
  }
  assert.equal(calls.downgrades.length, 1);
  assert.equal(calls.checkouts.length, 1);
});

test("Alakazam downgrade scheduling retains the global CSRF and idempotency fences", async () => {
  let calls = 0;
  const boundary = {
    async readiness() {
      return {
        ready: true,
        quote: true,
        checkout: true,
        downgrade: true,
        state: "quote_ready"
      };
    },
    async createQuote() {
      calls += 1;
      return {};
    },
    async createCheckout() {
      calls += 1;
      return {};
    },
    async scheduleDowngrade() {
      calls += 1;
      return {};
    }
  };
  const api = createHostedApi(service(), {
    alakazamBilling: boundary
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}` +
    `/alakazam-quotes/${QUOTE_ID}` +
    "/downgrade-schedule-command";

  const noCsrf = await api.fetch(
    writeRequest(path, {
      body: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST
      },
      idempotencyKey: DOWNGRADE_COMMAND_ID,
      csrf: false
    })
  );
  assert.equal(noCsrf.status, 403);
  assert.equal(
    (await noCsrf.json()).error.code,
    "CSRF_TOKEN_REQUIRED"
  );

  const noIdempotency = await api.fetch(
    writeRequest(path, {
      body: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST
      }
    })
  );
  assert.equal(noIdempotency.status, 400);
  assert.equal(
    (await noIdempotency.json()).error.code,
    "IDEMPOTENCY_KEY_REQUIRED"
  );

  const signedOut = await api.fetch(
    writeRequest(path, {
      body: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST,
        amountMinor: 0
      },
      idempotencyKey: DOWNGRADE_COMMAND_ID,
      signedIn: false
    })
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
  assert.equal(calls, 0);
});

test("Alakazam capabilities reflect only the billing boundary readiness", async () => {
  const api = createHostedApi(service(), {
    alakazamBilling: {
      async readiness() {
        return {
          ready: true,
          quote: true,
          checkout: true,
          downgrade: true,
          state: "quote_ready"
        };
      },
      async createQuote() {
        throw new Error("unused");
      },
      async createCheckout() {
        throw new Error("unused");
      },
      async scheduleDowngrade() {
        throw new Error("unused");
      }
    }
  });
  const ready = await api.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(ready.status, 200);
  const readyCapabilities = await ready.json();
  assert.equal(readyCapabilities.alakazamQuote, true);
  assert.equal(readyCapabilities.alakazamCheckout, true);
  assert.equal(readyCapabilities.alakazamDowngrade, true);

  const held = await createHostedApi(service()).fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(held.status, 200);
  const heldCapabilities = await held.json();
  assert.deepEqual(
    {
      quote: heldCapabilities.alakazamQuote,
      checkout: heldCapabilities.alakazamCheckout,
      downgrade: heldCapabilities.alakazamDowngrade
    },
    { quote: false, checkout: false, downgrade: false }
  );
});

test("the default Alakazam billing and downgrade routes authenticate and remain explicitly held", async () => {
  const api = createHostedApi(service());
  const path =
    `/api/v1/projects/${PROJECT_ID}/alakazam-quotes`;
  const held = await api.fetch(
    writeRequest(path, {
      body: { targetTierId: "alakazam_25" },
      idempotencyKey: QUOTE_ID
    })
  );
  assert.equal(held.status, 503);
  assert.equal(
    (await held.json()).error.code,
    "ALAKAZAM_BILLING_HELD"
  );

  const signedOut = await api.fetch(
    writeRequest(path, {
      body: { targetTierId: "alakazam_25" },
      idempotencyKey: QUOTE_ID,
      signedIn: false
    })
  );
  assert.equal(signedOut.status, 401);
  assert.equal(
    (await signedOut.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );

  const downgradePath =
    `/api/v1/projects/${PROJECT_ID}` +
    `/alakazam-quotes/${QUOTE_ID}` +
    "/downgrade-schedule-command";
  const heldDowngrade = await api.fetch(
    writeRequest(downgradePath, {
      body: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST
      },
      idempotencyKey: DOWNGRADE_COMMAND_ID
    })
  );
  assert.equal(heldDowngrade.status, 503);
  assert.equal(
    (await heldDowngrade.json()).error.code,
    "ALAKAZAM_BILLING_HELD"
  );

  const signedOutDowngrade = await api.fetch(
    writeRequest(downgradePath, {
      body: {
        acceptedDisclosureDigest: DISCLOSURE_DIGEST,
        quoteDigest: QUOTE_DIGEST
      },
      idempotencyKey: DOWNGRADE_COMMAND_ID,
      signedIn: false
    })
  );
  assert.equal(signedOutDowngrade.status, 401);
  assert.equal(
    (await signedOutDowngrade.json()).error.code,
    "AUTHENTICATION_REQUIRED"
  );
});

test("the production executable composes held Alakazam billing and downgrade scheduling through canonical scope and PostgreSQL", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createHostedAlakazamBilling\(\{\s*billing:\s*createAlakazamBillingService\(\s*alakazamServicePorts\s*\),\s*downgrade:\s*createAlakazamDowngradeService\(\s*alakazamServicePorts\s*\),\s*resolveSession:\s*commerceV2\.resolveSession\s*\}\)/u
  );
  assert.match(
    source,
    /createAlakazamDowngradeService,/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{\s*downloadCommerce,\s*alakazamAccount,\s*alakazamPublication,\s*alakazamBilling,/u
  );
  assert.match(
    source,
    /const alakazamRepository\s*=\s*createPostgresAlakazamRepository\(\{ authority \}\)/u
  );
});
