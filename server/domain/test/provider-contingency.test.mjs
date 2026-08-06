import assert from "node:assert/strict";
import test from "node:test";

import { ExternalEffectError } from "../errors.mjs";
import { createDomainProviderContingency } from "../provider-contingency.mjs";

const DOMAIN = "client-example.com";
const PRICE = Object.freeze({ amountMinor: 1400, currency: "USD" });
const REGISTRANT = "contact_customer_registrant";

function fakeProvider(code, options = {}) {
  const calls = {
    previewRegistration: [],
    confirmRegistration: [],
    getOperation: [],
    getDomain: [],
    assessTransferOut: [],
    getAuthCode: [],
    setTransferLock: [],
    renewDomain: [],
    submitTransfer: []
  };
  const state = {
    previewError: options.previewError ?? null,
    confirmError: options.confirmError ?? null,
    mutationErrors: new Map(),
    previewStatus: options.previewStatus ?? "confirmation_required",
    operationStatus: options.operationStatus ?? "success"
  };

  function record(method, input) {
    calls[method].push(structuredClone(input));
  }

  const registrar = {
    async previewRegistration(input) {
      record("previewRegistration", input);
      if (state.previewError) throw state.previewError;
      if (state.previewStatus === "unavailable") {
        return { status: "unavailable", reason: "taken" };
      }
      return {
        status: "confirmation_required",
        domain: input.domain,
        price: structuredClone(options.price ?? PRICE),
        quoteId: `${code}_quote_1`,
        observedAt: "2026-08-06T12:00:00.000Z",
        expiresAt: "2026-08-06T12:05:00.000Z",
        noCharge: true
      };
    },
    async confirmRegistration(input) {
      record("confirmRegistration", input);
      if (state.confirmError) throw state.confirmError;
      return {
        operationId: `${code}_registration_1`,
        price: structuredClone(options.confirmPrice ?? PRICE)
      };
    },
    async getOperation(input) {
      record("getOperation", input);
      return { status: state.operationStatus };
    },
    async getDomain(input) {
      record("getDomain", input);
      return {
        name: input.domain,
        lifecycleStatus: "registered",
        contacts: { registrant: REGISTRANT }
      };
    },
    async assessTransferOut(input) {
      record("assessTransferOut", input);
      return { eligible: true };
    },
    async getAuthCode(input) {
      record("getAuthCode", input);
      return { authCode: "test-only-code", expiresAt: "2026-08-07T12:00:00.000Z" };
    },
    async setTransferLock(input) {
      record("setTransferLock", input);
      if (state.mutationErrors.has("setTransferLock")) {
        throw state.mutationErrors.get("setTransferLock");
      }
      return { locked: input.locked, changed: true };
    },
    async renewDomain(input) {
      record("renewDomain", input);
      if (state.mutationErrors.has("renewDomain")) {
        throw state.mutationErrors.get("renewDomain");
      }
      return { operationId: `${code}_renewal_1` };
    },
    async submitTransfer(input) {
      record("submitTransfer", input);
      if (state.mutationErrors.has("submitTransfer")) {
        throw state.mutationErrors.get("submitTransfer");
      }
      return { operationId: `${code}_transfer_1` };
    }
  };

  return {
    descriptor: {
      code,
      registrarOfRecord: `${code} Registrar`,
      configured: options.configured ?? true,
      healthy: options.healthy ?? true,
      registrar
    },
    calls,
    state
  };
}

function boundary(alpha, beta) {
  return createDomainProviderContingency({
    primary: alpha.descriptor,
    secondary: beta.descriptor,
    preference: ["alpha", "beta"]
  });
}

async function routeFor(router, preferredProviderCode) {
  const result = await router.preflightRegistration({
    input: { domain: DOMAIN, years: 1 },
    preferredProviderCode
  });
  assert.equal(result.status, "ready");
  return result.route;
}

async function activePin(router, route) {
  const result = await router.reconcileRegistration({
    route,
    operationId: `${route.providerCode}_registration_1`,
    expectedRegistrantContactId: REGISTRANT
  });
  assert.equal(result.status, "active");
  return result.providerPin;
}

test("read-only registration preflight falls through symmetrically", async () => {
  const alpha = fakeProvider("alpha", {
    previewError: new Error("alpha read unavailable")
  });
  const beta = fakeProvider("beta");
  let router = boundary(alpha, beta);
  let result = await router.preflightRegistration({
    input: { domain: DOMAIN, years: 1 },
    preferredProviderCode: "alpha"
  });
  assert.equal(result.route.providerCode, "beta");
  assert.equal(result.fallbackUsed, true);
  assert.equal(alpha.calls.previewRegistration.length, 1);
  assert.equal(beta.calls.previewRegistration.length, 1);

  const alphaSecond = fakeProvider("alpha");
  const betaSecond = fakeProvider("beta", {
    previewError: new Error("beta read unavailable")
  });
  router = boundary(alphaSecond, betaSecond);
  result = await router.preflightRegistration({
    input: { domain: DOMAIN, years: 1 },
    preferredProviderCode: "beta"
  });
  assert.equal(result.route.providerCode, "alpha");
  assert.equal(result.fallbackUsed, true);
  assert.equal(betaSecond.calls.previewRegistration.length, 1);
  assert.equal(alphaSecond.calls.previewRegistration.length, 1);
});

test("provider-specific preflight can be locked after provider preparation begins", async () => {
  const alpha = fakeProvider("alpha", {
    previewError: new Error("alpha read unavailable")
  });
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  assert.equal(
    router.selectRegistrationProvider({ preferredProviderCode: "beta" }).providerCode,
    "beta"
  );
  await assert.rejects(
    () =>
      router.preflightRegistration({
        input: { domain: DOMAIN, years: 1 },
        lockedProviderCode: "alpha"
      }),
    (error) => error.code === "domain_providers_unavailable"
  );
  assert.equal(alpha.calls.previewRegistration.length, 1);
  assert.equal(beta.calls.previewRegistration.length, 0);
});

test("an authoritative unavailable result is terminal and zero healthy providers fail closed", async () => {
  const alpha = fakeProvider("alpha", { previewStatus: "unavailable" });
  const beta = fakeProvider("beta");
  let router = boundary(alpha, beta);
  const unavailable = await router.preflightRegistration({
    input: { domain: DOMAIN, years: 1 }
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.providerCode, "alpha");
  assert.equal(beta.calls.previewRegistration.length, 0);

  const heldAlpha = fakeProvider("alpha", { configured: false, healthy: false });
  const heldBeta = fakeProvider("beta", { configured: false, healthy: false });
  router = boundary(heldAlpha, heldBeta);
  await assert.rejects(
    () => router.preflightRegistration({ input: { domain: DOMAIN, years: 1 } }),
    (error) => error.code === "domain_providers_unavailable" && error.status === 503
  );
  assert.equal(heldAlpha.calls.previewRegistration.length, 0);
  assert.equal(heldBeta.calls.previewRegistration.length, 0);
});

test("registration submission preserves exact quote and attempt identity", async () => {
  const alpha = fakeProvider("alpha");
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "alpha");

  await assert.rejects(
    () =>
      router.submitRegistration({
        route,
        input: {
          domain: DOMAIN,
          years: 1,
          expectedPrice: { amountMinor: 1401, currency: "USD" },
          attemptId: "attempt_wrong_price"
        }
      }),
    (error) => error.code === "domain_provider_price_mismatch"
  );
  assert.equal(alpha.calls.confirmRegistration.length, 0);

  const submitted = await router.submitRegistration({
    route,
    input: {
      domain: DOMAIN,
      years: 1,
      expectedPrice: PRICE,
      attemptId: "attempt_exact_1"
    }
  });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.providerCode, "alpha");
  assert.equal(submitted.exactProviderPriceConfirmed, true);
  assert.equal(alpha.calls.confirmRegistration.length, 1);
  assert.equal(alpha.calls.confirmRegistration[0].attemptId, "attempt_exact_1");
  assert.deepEqual(alpha.calls.confirmRegistration[0].expectedPrice, PRICE);
  assert.equal(beta.calls.confirmRegistration.length, 0);
});

test("uncertain registration never switches provider or retries", async () => {
  const alpha = fakeProvider("alpha", {
    confirmError: new ExternalEffectError("alpha_timeout", "timeout", {
      certainty: "ambiguous"
    })
  });
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "alpha");
  const input = {
    domain: DOMAIN,
    years: 1,
    expectedPrice: PRICE,
    attemptId: "attempt_uncertain_1"
  };

  const held = await router.submitRegistration({ route, input });
  assert.equal(held.status, "held");
  assert.equal(held.effect, "uncertain");
  assert.equal(held.reconciliationRequired, true);
  assert.equal(held.newPreflightRequired, false);
  assert.equal(held.automaticProviderSwitch, false);
  assert.equal(alpha.calls.confirmRegistration.length, 1);
  assert.equal(beta.calls.confirmRegistration.length, 0);

  const replayGuard = await router.submitRegistration({
    route,
    input,
    mutationState: "uncertain"
  });
  assert.equal(replayGuard.status, "held");
  assert.equal(alpha.calls.confirmRegistration.length, 1);
  assert.equal(beta.calls.confirmRegistration.length, 0);
});

test("even authoritative not-submitted mutation does not auto-switch without a fresh quote", async () => {
  const alpha = fakeProvider("alpha", {
    confirmError: new ExternalEffectError("alpha_rejected", "rejected", {
      certainty: "not_submitted"
    })
  });
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "alpha");
  const held = await router.submitRegistration({
    route,
    input: {
      domain: DOMAIN,
      years: 1,
      expectedPrice: PRICE,
      attemptId: "attempt_rejected_1"
    }
  });
  assert.equal(held.status, "held");
  assert.equal(held.effect, "not_submitted");
  assert.equal(held.reconciliationRequired, false);
  assert.equal(held.newPreflightRequired, true);
  assert.equal(alpha.calls.confirmRegistration.length, 1);
  assert.equal(beta.calls.confirmRegistration.length, 0);
});

test("authoritative readback pins an acquired domain to its provider", async () => {
  const alpha = fakeProvider("alpha");
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "beta");
  const pin = await activePin(router, route);
  assert.equal(pin.providerCode, "beta");
  assert.equal(beta.calls.getOperation.length, 1);
  assert.equal(beta.calls.getDomain.length, 1);
  assert.equal(alpha.calls.getOperation.length, 0);
  assert.equal(alpha.calls.getDomain.length, 0);

  const read = await router.readPinned({ pin, operation: "getDomain", input: {} });
  assert.equal(read.status, "ok");
  assert.equal(read.providerPin.providerCode, "beta");
  assert.equal(beta.calls.getDomain.length, 2);
  assert.equal(alpha.calls.getDomain.length, 0);

  await assert.rejects(
    () =>
      router.readPinned({
        pin,
        operation: "getDomain",
        input: { domain: "different-example.com" }
      }),
    (error) => error.code === "domain_provider_pin_mismatch"
  );
});

test("a durable provider pin survives a later registrar display-name change", async () => {
  const alpha = fakeProvider("alpha");
  const beta = fakeProvider("beta");
  const originalRouter = boundary(alpha, beta);
  const route = await routeFor(originalRouter, "beta");
  const pin = await activePin(originalRouter, route);

  const renamedBeta = {
    ...beta.descriptor,
    registrarOfRecord: "Beta Registrar Holdings, Inc."
  };
  const restartedRouter = createDomainProviderContingency({
    primary: alpha.descriptor,
    secondary: renamedBeta,
    preference: ["alpha", "beta"]
  });
  const read = await restartedRouter.readPinned({
    pin,
    operation: "getDomain",
    input: {}
  });

  assert.equal(read.status, "ok");
  assert.equal(read.providerPin.registrarOfRecord, "beta Registrar");
  assert.equal(beta.calls.getDomain.length, 2);
  assert.equal(alpha.calls.getDomain.length, 0);
});

test("uncertain renewal remains held on the registrar of record", async () => {
  const alpha = fakeProvider("alpha");
  const beta = fakeProvider("beta");
  beta.state.mutationErrors.set(
    "renewDomain",
    new ExternalEffectError("beta_renewal_timeout", "timeout", { certainty: "ambiguous" })
  );
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "beta");
  const pin = await activePin(router, route);
  const input = {
    attemptId: "renewal_attempt_1",
    priceConfirmation: {
      quoteId: "beta_renewal_quote_1",
      quotedPrice: PRICE,
      acceptedPrice: PRICE
    }
  };

  const held = await router.mutatePinned({ pin, operation: "renewDomain", input });
  assert.equal(held.status, "held");
  assert.equal(held.effect, "uncertain");
  assert.equal(held.providerPin.providerCode, "beta");
  assert.equal(held.reconciliationRequired, true);
  assert.equal(beta.calls.renewDomain.length, 1);
  assert.equal(alpha.calls.renewDomain.length, 0);

  await router.mutatePinned({
    pin,
    operation: "renewDomain",
    input,
    mutationState: "uncertain"
  });
  assert.equal(beta.calls.renewDomain.length, 1);
  assert.equal(alpha.calls.renewDomain.length, 0);
});

test("a transfer is explicit and retains the old pin until authoritative completion", async () => {
  const alpha = fakeProvider("alpha");
  const beta = fakeProvider("beta");
  const router = boundary(alpha, beta);
  const route = await routeFor(router, "alpha");
  const pin = await activePin(router, route);
  const submitted = await router.mutatePinned({
    pin,
    operation: "submitTransfer",
    input: {
      attemptId: "transfer_attempt_1",
      priceConfirmation: {
        quoteId: "transfer_quote_1",
        quotedPrice: PRICE,
        acceptedPrice: PRICE
      }
    }
  });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.providerPin.providerCode, "alpha");
  assert.equal(submitted.existingPinRetained, true);
  assert.equal(submitted.transferRequiresExplicitCompletion, true);
  assert.equal(alpha.calls.submitTransfer.length, 1);
  assert.equal(beta.calls.submitTransfer.length, 0);
});
