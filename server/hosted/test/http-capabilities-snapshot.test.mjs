import assert from "node:assert/strict";
import test from "node:test";

import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://staging.sitesourcery.com";
const NAMES = Object.freeze([
  "service",
  "download",
  "billing",
  "alakazam35",
  "alakazam50",
  "retained",
  "publication"
]);
const EXPECTED = Object.freeze({
  accountRegistration: true,
  accountRecoveryEmail: true,
  downloadQuote: true,
  downloadPayment: true,
  alakazamQuote: true,
  alakazamCheckout: true,
  alakazamDowngrade: true,
  alakazam35: true,
  alakazam50: true,
  alakazamRetainedPremium: true,
  alakazamPublication: true,
  domainPurchase: true,
  publishing: true
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function methods(names, readiness) {
  return Object.freeze({
    readiness,
    ...Object.fromEntries(
      names.map((name) => [name, async () => {
        throw new Error("not reached");
      }])
    )
  });
}

function apiFixture({
  at = () => Date.now(),
  serviceReadiness
} = {}) {
  const calls = Object.fromEntries(NAMES.map((name) => [name, 0]));
  function counted(name, result) {
    return async () => {
      calls[name] += 1;
      return typeof result === "function" ? result() : result;
    };
  }
  const service = {
    async authenticate() {
      throw new Error("not reached");
    },
    readiness: counted("service", serviceReadiness ?? {
      ready: true,
      registration: { ready: true, verified: true },
      recovery: { ready: true, verified: true },
      providers: {
        domains: { ready: true, registrar: "ready" }
      },
      publication: { ready: true, held: false },
      privateCustomer: "customer@example.test"
    })
  };
  const api = createHostedApi(service, {
    capabilitiesPolicy: {
      ttlMs: 20,
      timeoutMs: 10,
      now: at
    },
    downloadCommerce: methods(
      ["createQuote", "prepareCheckout", "download"],
      counted("download", { quote: true, payment: true })
    ),
    alakazamBilling: methods(
      ["createQuote", "createCheckout", "scheduleDowngrade"],
      counted("billing", {
        quote: true,
        checkout: true,
        downgrade: true
      })
    ),
    alakazam35: methods(
      ["getSnapshot", "requestCare", "saveConfiguration", "uploadPhoto"],
      counted("alakazam35", {
        authorization: true,
        providerEffects: false
      })
    ),
    alakazam50: methods(
      ["getSnapshot", "requestCare", "saveConfiguration"],
      counted("alakazam50", {
        authorization: true,
        providerEffects: false
      })
    ),
    alakazamRetainedPremium: methods(
      ["getSnapshot", "getExport", "restoreConfiguration"],
      counted("retained", {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held"
      })
    ),
    alakazamPublication: methods(
      ["getSnapshot", "requestCommand"],
      counted("publication", {
        authorization: true,
        providerEffects: false
      })
    )
  });
  return { api, calls };
}

function get(api, path = "/api/v1/capabilities") {
  return api.fetch(new Request(`${ORIGIN}${path}`));
}

test("capabilities singleflight the complete public fanout, cache by TTL, and stay separate from readiness", async () => {
  let at = 1_000;
  const gate = deferred();
  const fixture = apiFixture({
    at: () => at,
    serviceReadiness: async () => {
      await gate.promise;
      return {
        ready: true,
        registration: { ready: true, verified: true },
        recovery: { ready: true, verified: true },
        providers: {
          domains: { ready: true, registrar: "ready" }
        },
        publication: { ready: true, held: false },
        privateProviderDetail: "must-not-escape"
      };
    }
  });
  const pending = Array.from({ length: 24 }, () => get(fixture.api));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  gate.resolve();
  const responses = await Promise.all(pending);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(responses.every((response) => response.status === 200), true);
  assert.deepEqual([...new Set(bodies.map(JSON.stringify))], [
    JSON.stringify(EXPECTED)
  ]);
  assert.equal(JSON.stringify(bodies).includes("must-not-escape"), false);

  assert.deepEqual(await (await get(fixture.api)).json(), EXPECTED);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));

  const ready = await get(fixture.api, "/api/v1/ready");
  assert.equal(ready.status, 200);
  assert.equal(fixture.calls.service, 2);
  assert.equal(fixture.calls.download, 1);

  at += 21;
  assert.deepEqual(await (await get(fixture.api)).json(), EXPECTED);
  assert.equal(fixture.calls.service, 3);
  for (const name of NAMES.filter((name) => name !== "service")) {
    assert.equal(fixture.calls[name], 2, name);
  }
});

test("capabilities timeout once without amplifying a hung dependency", async () => {
  const fixture = apiFixture({
    serviceReadiness: () => new Promise(() => {})
  });
  const responses = await Promise.all(
    Array.from({ length: 16 }, () => get(fixture.api))
  );
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  for (const response of responses) {
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "CAPABILITIES_UNAVAILABLE");
    assert.equal(body.error.message, "Hosted capabilities are unavailable.");
  }
  assert.equal((await get(fixture.api)).status, 503);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
});

test("capabilities failure is fixed, PII-free, cached, and singleflighted", async () => {
  const gate = deferred();
  const fixture = apiFixture({
    at: () => 1_000,
    serviceReadiness: async () => {
      await gate.promise;
      throw new Error("customer@example.test sk_live_must_not_escape");
    }
  });
  const pending = Array.from({ length: 16 }, () => get(fixture.api));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
  gate.resolve();
  const responses = await Promise.all(pending);
  for (const response of responses) {
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, "CAPABILITIES_UNAVAILABLE");
    assert.equal(JSON.stringify(body).includes("customer@example.test"), false);
    assert.equal(JSON.stringify(body).includes("sk_live"), false);
  }
  assert.equal((await get(fixture.api)).status, 503);
  assert.deepEqual(fixture.calls,
    Object.fromEntries(NAMES.map((name) => [name, 1])));
});
