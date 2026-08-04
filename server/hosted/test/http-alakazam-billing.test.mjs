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
const DISCLOSURE_DIGEST = "d".repeat(64);

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

test("Alakazam quote and Checkout routes preserve route and idempotency identity", async () => {
  const calls = { quotes: [], checkouts: [] };
  const api = createHostedApi(service(), {
    alakazamBilling: {
      async readiness() {
        return {
          ready: true,
          quote: true,
          checkout: true,
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
          acceptedDisclosureDigest: DISCLOSURE_DIGEST
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
        commandId: CHECKOUT_COMMAND_ID
      }
    }
  ]);
});

test("Alakazam writes retain the global CSRF and idempotency fences", async () => {
  let calls = 0;
  const boundary = {
    async readiness() {
      return {
        ready: true,
        quote: true,
        checkout: true,
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
    }
  };
  const api = createHostedApi(service(), {
    alakazamBilling: boundary
  });
  const path =
    `/api/v1/projects/${PROJECT_ID}/alakazam-quotes`;

  const noCsrf = await api.fetch(
    writeRequest(path, {
      body: { targetTierId: "alakazam_25" },
      idempotencyKey: QUOTE_ID,
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
      body: { targetTierId: "alakazam_25" }
    })
  );
  assert.equal(noIdempotency.status, 400);
  assert.equal(
    (await noIdempotency.json()).error.code,
    "IDEMPOTENCY_KEY_REQUIRED"
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
          state: "quote_ready"
        };
      },
      async createQuote() {
        throw new Error("unused");
      },
      async createCheckout() {
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

  const held = await createHostedApi(service()).fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(held.status, 200);
  const heldCapabilities = await held.json();
  assert.deepEqual(
    {
      quote: heldCapabilities.alakazamQuote,
      checkout: heldCapabilities.alakazamCheckout
    },
    { quote: false, checkout: false }
  );
});

test("the default Alakazam billing route authenticates and remains explicitly held", async () => {
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
});

test("the production executable composes held Alakazam billing through canonical scope and PostgreSQL", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createHostedAlakazamBilling\(\{\s*billing:\s*createAlakazamBillingService\(\s*alakazamServicePorts\s*\),\s*resolveSession:\s*commerceV2\.resolveSession\s*\}\)/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{\s*downloadCommerce,\s*alakazamAccount,\s*alakazamBilling,/u
  );
  assert.match(
    source,
    /const alakazamRepository\s*=\s*createPostgresAlakazamRepository\(\{ authority \}\)/u
  );
});
