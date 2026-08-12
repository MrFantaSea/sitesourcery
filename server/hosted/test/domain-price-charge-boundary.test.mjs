import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../../domain/canonical.mjs";
import {
  createHeldDomainPriceChargeBoundary,
  DOMAIN_FINAL_CHARGE_CUSTOMER_PROJECTION_SCHEMA,
  DOMAIN_FINAL_CHARGE_OPERATOR_PROJECTION_SCHEMA
} from "../domain-price-charge-boundary.mjs";

const USER = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const ROUTE = "44444444-4444-4444-8444-444444444444";
const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-11T12:00:00.000Z";
const OBSERVED = "2026-08-11T11:59:00.000Z";
const EXPIRES = "2026-08-11T12:05:00.000Z";

function harness({ domain = "premium-proof.example", priceClass = "premium" } = {}) {
  const amountMinor = priceClass === "premium" ? 1400 : 1200;
  const calls = {
    primaryPreview: 0,
    secondaryPreview: 0,
    operation: 0,
    domain: 0,
    charge: 0,
    persistPin: 0,
    resolve: 0
  };
  const state = {
    route: null,
    attempt: null,
    charge: {
      status: "final",
      ambiguous: false,
      providerCode: "secondary",
      domain,
      operationId: "operation_exact_001",
      quoteId: `quote_${domain}`,
      quoteExpiresAt: EXPIRES,
      price: { amountMinor, currency: "USD" },
      chargeReference: "charge_exact_001",
      observedAt: NOW,
      evidenceExpiresAt: "2026-08-11T12:04:00.000Z"
    }
  };
  const primary = {
    async previewRegistration() {
      calls.primaryPreview += 1;
      throw new Error("primary unavailable");
    }
  };
  const secondary = {
    async previewRegistration(input) {
      calls.secondaryPreview += 1;
      return {
        status: "confirmation_required",
        noCharge: true,
        domain: input.domain,
        years: input.years,
        price: { amountMinor, currency: "USD" },
        ...(priceClass === null ? {} : { priceClass }),
        quoteId: `quote_${input.domain}`,
        observedAt: OBSERVED,
        expiresAt: EXPIRES
      };
    },
    async getOperation() {
      calls.operation += 1;
      return { status: "success" };
    },
    async getDomain(input) {
      calls.domain += 1;
      return {
        name: input.domain,
        lifecycleStatus: "registered",
        contacts: { registrant: "customer_contact_001" }
      };
    },
    async readRegistrationCharge() {
      calls.charge += 1;
      return structuredClone(state.charge);
    }
  };
  const registrarProviders = {
    primary: {
      code: "primary",
      registrarOfRecord: "Primary Registrar",
      configured: true,
      healthy: true,
      registrar: primary
    },
    secondary: {
      code: "secondary",
      registrarOfRecord: "Secondary Registrar",
      configured: true,
      healthy: true,
      registrar: secondary
    },
    preference: ["primary", "secondary"]
  };
  const repository = {
    async persistRoute(input) {
      if (state.route) return state.route;
      state.route = Object.freeze({
        id: ROUTE,
        organizationId: ORGANIZATION,
        projectId: PROJECT,
        selectionKey: input.selectionKey,
        primaryProviderCode: input.primaryProviderCode,
        fallbackUsed: input.fallbackUsed,
        fallbackFromProviderCode: input.primaryProviderCode,
        selectionDigest: digest({ selection: input.selectionKey }),
        selectedAt: NOW,
        route: input.route
      });
      return state.route;
    },
    async readRegistrationAttempt() {
      assert.ok(state.attempt, "test must stage a submitted attempt");
      return Object.freeze({
        route: state.route,
        attempt: state.attempt,
        pin: state.attempt.state === "succeeded"
          ? { pin: state.attempt.reconciliationOutcome.providerPin }
          : null
      });
    },
    async persistSuccessfulPin(input) {
      calls.persistPin += 1;
      const reconciliationOutcome = structuredClone(
        input.reconciliationOutcome
      );
      state.attempt = Object.freeze({
        ...state.attempt,
        state: "succeeded",
        reconciliationOutcome,
        reconciliationOutcomeDigest: digest(reconciliationOutcome)
      });
      return Object.freeze({
        replayed: false,
        attempt: state.attempt,
        pin: Object.freeze({
          id: "66666666-6666-4666-8666-666666666666",
          pin: reconciliationOutcome.providerPin
        })
      });
    }
  };
  const boundary = createHeldDomainPriceChargeBoundary({
    repository,
    registrarProviders,
    clock: { now: () => NOW },
    async resolveProjectScope({ actor, projectId }) {
      calls.resolve += 1;
      assert.equal(actor.userId, USER);
      assert.equal(projectId, PROJECT);
      return {
        actorId: USER,
        customerId: USER,
        organizationId: ORGANIZATION,
        projectId: PROJECT
      };
    }
  });

  async function quote() {
    return boundary.quoteExactRegistration({
      actor: { userId: USER },
      projectId: PROJECT,
      selectionKey: `selection-${priceClass ?? "unknown"}-001`,
      domain,
      years: 1
    });
  }

  function stageAttempt() {
    const submissionOutcome = {
      schema: "sitesourcery.domain-provider-outcome/v1",
      status: "submitted",
      providerCode: "secondary",
      registrarOfRecord: "Secondary Registrar",
      operationId: "operation_exact_001",
      expectedPrice: { amountMinor, currency: "USD" },
      providerPrice: { amountMinor, currency: "USD" },
      exactProviderPriceConfirmed: true
    };
    state.attempt = Object.freeze({
      id: ATTEMPT,
      providerRouteId: ROUTE,
      attemptKey: "attempt-price-charge-001",
      state: "submitted",
      operationId: "operation_exact_001",
      submissionOutcome,
      submissionOutcomeDigest: digest(submissionOutcome),
      reconciliationOutcome: null,
      reconciliationOutcomeDigest: null,
      requestedAt: NOW
    });
  }

  async function prepare() {
    return boundary.prepareFinalCharge({
      actor: { userId: USER },
      projectId: PROJECT,
      routeId: ROUTE,
      attemptKey: "attempt-price-charge-001",
      expectedRegistrantContactId: "customer_contact_001"
    });
  }

  return { boundary, calls, state, quote, stageAttempt, prepare };
}

test("authenticated exact-price bridge preserves standard and premium provider readback", async () => {
  for (const [selectedClass, amountMinor] of [
    ["standard", 1200],
    ["premium", 1400]
  ]) {
    const context = harness({
      domain: `${selectedClass}-proof.example`,
      priceClass: selectedClass
    });
    const quote = await context.quote();
    assert.equal(quote.status, "held_exact_price");
    assert.equal(quote.priceClass, selectedClass);
    assert.deepEqual(quote.price, { amountMinor, currency: "USD" });
    assert.match(quote.providerQuoteDigest, /^[a-f0-9]{64}$/u);
    assert.equal(quote.captureAuthorized, false);
    assert.equal(quote.refundAuthorized, false);
    assert.equal(context.calls.primaryPreview, 1);
    assert.equal(context.calls.secondaryPreview, 1);
  }
});

test("price bridge rejects unauthenticated and unclassified provider pricing", async () => {
  const unauthenticated = harness();
  await assert.rejects(
    unauthenticated.boundary.quoteExactRegistration({
      actor: null,
      projectId: PROJECT,
      selectionKey: "selection-auth-required",
      domain: "premium-proof.example",
      years: 1
    }),
    (error) => error?.code === "AUTHENTICATION_REQUIRED"
  );
  assert.equal(unauthenticated.calls.primaryPreview, 0);
  const unclassified = harness({
    domain: "unclassified-proof.example",
    priceClass: null
  });
  await assert.rejects(
    unclassified.quote(),
    (error) => error?.code === "DOMAIN_PROVIDER_PRICE_CLASS_UNVERIFIED"
  );
});

test("final-charge evidence is durable, replayed, digest-safe, and effect-free", async () => {
  const context = harness();
  await context.quote();
  context.stageAttempt();
  const prepared = await context.prepare();
  assert.equal(prepared.status, "ready_for_payment_capture_review");
  assert.equal(prepared.replayed, false);
  assert.equal(prepared.customer.schema, DOMAIN_FINAL_CHARGE_CUSTOMER_PROJECTION_SCHEMA);
  assert.equal(prepared.operator.schema, DOMAIN_FINAL_CHARGE_OPERATOR_PROJECTION_SCHEMA);
  assert.equal(prepared.captureAuthorized, false);
  assert.equal(prepared.refundAuthorized, false);
  assert.match(prepared.operator.registrarChargeDigest, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(prepared),
    /quote_premium-proof|operation_exact_001|charge_exact_001/u
  );
  assert.deepEqual(Object.keys(context.boundary).sort(), [
    "prepareFinalCharge",
    "quoteExactRegistration"
  ]);
  assert.equal(context.calls.persistPin, 1);
  assert.equal(context.calls.charge, 1);
  const replayed = await context.prepare();
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.operator.evidenceDigest, prepared.operator.evidenceDigest);
  assert.equal(context.calls.charge, 1);
  assert.equal(context.calls.persistPin, 1);
});

test("final-charge boundary fails closed on every material provider drift", async () => {
  const cases = [
    ["amount", (value) => { value.price.amountMinor += 1; }],
    ["currency", (value) => { value.price.currency = "EUR"; }],
    ["domain", (value) => { value.domain = "other.example"; }],
    ["provider", (value) => { value.providerCode = "primary"; }],
    ["quote", (value) => { value.quoteId = "different_quote"; }],
    ["operation", (value) => { value.operationId = "different_operation"; }],
    ["route expiry", (value) => { value.quoteExpiresAt = "2026-08-11T12:06:00.000Z"; }],
    ["evidence expiry", (value) => { value.evidenceExpiresAt = NOW; }],
    ["ambiguity", (value) => { value.ambiguous = true; }]
  ];
  for (const [label, mutate] of cases) {
    const context = harness();
    await context.quote();
    context.stageAttempt();
    mutate(context.state.charge);
    await assert.rejects(
      context.prepare(),
      undefined,
      `${label} drift must fail closed`
    );
    assert.equal(context.calls.persistPin, 0, `${label} drift persisted`);
  }
});
