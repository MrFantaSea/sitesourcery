import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../canonical.mjs";
import {
  ORDER_STATES,
  ambiguousFakeEffect,
  createDomainAccountBoundary,
  createDomainOrchestrator,
  createFakeDomainPorts,
  createMemoryDomainRepository
} from "../index.mjs";

const NOW = "2026-07-28T16:00:00.000Z";
const TENANT = "tenant_contingency";
const CUSTOMER = "customer_contingency";
const DOMAIN = "contingency-example.com";

function session() {
  return {
    tenantId: TENANT,
    customerId: CUSTOMER,
    actorId: CUSTOMER,
    roles: []
  };
}

function agreements() {
  return [
    "agency_authorization",
    "spaceship_disclosure",
    "customer_is_registrant",
    "irreversible_registration",
    "domain_price",
    "privacy_processing",
    "transfer_rights"
  ].map((key) => ({
    key,
    documentVersion: "2026-07-28",
    documentDigest: `${key}_digest`,
    acceptedAt: NOW
  }));
}

function provider(code, priceMinor) {
  const fake = createFakeDomainPorts({ now: NOW, priceMinor });
  const state = {
    quoteError: null,
    contactPreviewError: null,
    onEnsureContacts: null
  };

  function preview(value, input) {
    if (value?.status === "unavailable") {
      return { ...structuredClone(value), domain: input.domain };
    }
    return {
      ...structuredClone(value),
      domain: input.domain,
      years: input.years,
      observedAt: value?.observedAt ?? NOW,
      expiresAt: value?.expiresAt ?? "2026-07-28T16:05:00.000Z",
      noCharge: true
    };
  }

  const registrar = Object.freeze({
    providerCode: code,
    ...fake.registrar,
    async ensureContacts(input) {
      if (state.onEnsureContacts) await state.onEnsureContacts(structuredClone(input));
      return fake.registrar.ensureContacts(input);
    },
    async quoteRegistration(input) {
      if (state.quoteError) throw state.quoteError;
      return preview(await fake.registrar.previewRegistration(input), input);
    },
    async previewRegistration(input) {
      if (state.contactPreviewError) throw state.contactPreviewError;
      return preview(await fake.registrar.previewRegistration(input), input);
    }
  });

  return { fake, registrar, state };
}

function harness() {
  const alpha = provider("alpha", 1200);
  const beta = provider("beta", 1400);
  const repository = createMemoryDomainRepository();
  const orchestrator = createDomainOrchestrator({
    ports: {
      repository,
      registrarProviders: {
        primary: {
          code: "alpha",
          registrarOfRecord: "Alpha Registrar",
          configured: true,
          healthy: true,
          registrar: alpha.registrar
        },
        secondary: {
          code: "beta",
          registrarOfRecord: "Beta Registrar",
          configured: true,
          healthy: true,
          registrar: beta.registrar
        },
        preference: ["alpha", "beta"]
      },
      payments: alpha.fake.payments,
      secrets: alpha.fake.secrets,
      clock: alpha.fake.clock,
      ids: alpha.fake.ids
    },
    config: { mutationMode: "fake", serviceFeeMinor: 300 }
  });
  const boundary = createDomainAccountBoundary(orchestrator);
  return {
    alpha,
    beta,
    repository,
    execute(action, body) {
      return boundary.execute({ session: session(), action, body });
    }
  };
}

let sequence = 0;
function command(label) {
  sequence += 1;
  return `${label}_${sequence}`;
}

async function createAndConsent(context) {
  let order = await context.execute("create", {
    commandId: command("create"),
    projectId: "project_contingency",
    domain: DOMAIN,
    years: 1
  });
  assert.equal(order.registrar.providerCode, null);
  order = await context.execute("consent", {
    commandId: command("consent"),
    orderId: order.id,
    consentEvidenceId: "agency_consent_1",
    actorSessionId: "session_contingency_1",
    ipHash: "ip_digest",
    userAgentHash: "agent_digest",
    registrantProfileRef: "vault://contingency/contact",
    registrantProfileDigest: "contact_digest",
    agreements: agreements()
  });
  return order;
}

async function acceptAndAuthorize(context, order, amountMinor) {
  order = await context.execute("accept_quote", {
    commandId: command("accept"),
    orderId: order.id,
    acceptedAmountMinor: amountMinor,
    priceConsentEvidenceId: "selected_provider_and_price_consent"
  });
  order = await context.execute("authorize_payment", {
    commandId: command("authorize"),
    orderId: order.id,
    paymentMethodRef: "pm_contingency_test"
  });
  return order;
}

function approval(order) {
  return {
    approvalId: `approval_${order.id}`,
    approvedBy: CUSTOMER,
    approvedAt: NOW,
    scope: "domain_registration",
    environment: "fake",
    tenantId: TENANT,
    orderId: order.id,
    domain: order.domain,
    quoteDigest: digest(order.acceptedQuote)
  };
}

test("pre-contact failure falls through once, then contacts, mutation, reads, and pin stay on beta", async () => {
  const context = harness();
  context.alpha.state.quoteError = new Error("alpha preflight unavailable");
  let order = await createAndConsent(context);
  let beforeContacts;
  context.beta.state.onEnsureContacts = async () => {
    beforeContacts = await context.repository.inspect({
      tenantId: TENANT,
      orderId: order.id
    });
  };
  order = await context.execute("quote", {
    commandId: command("quote"),
    orderId: order.id
  });

  assert.equal(order.state, ORDER_STATES.FINAL_QUOTED);
  assert.equal(order.registrar.providerCode, "beta");
  assert.equal(order.registrar.registrarOfRecord, "Beta Registrar");
  assert.equal(order.quote.price.amountMinor, 1400);
  assert.equal(beforeContacts.state, ORDER_STATES.AGENCY_CONSENTED);
  assert.equal(beforeContacts.registrar.provider, "beta");
  assert.equal(beforeContacts.registrar.quoteRoute.providerCode, "beta");
  assert.equal(beforeContacts.registrar.contactIds, null);
  assert.equal(context.alpha.fake.calls.ensureContacts, 0);
  assert.equal(context.beta.fake.calls.ensureContacts, 1);
  assert.match(order.registrar.quoteRouteEvidence.fingerprint, /^[a-f0-9]{64}$/u);

  order = await acceptAndAuthorize(context, order, 1400);
  order = await context.execute("revalidate", {
    commandId: command("revalidate"),
    orderId: order.id
  });
  order = await context.execute("confirm", {
    commandId: command("confirm"),
    orderId: order.id,
    executionApproval: approval(order)
  });
  order = await context.execute("poll_registration", {
    commandId: command("poll"),
    orderId: order.id
  });

  assert.equal(order.state, ORDER_STATES.ACTIVE);
  assert.equal(order.registrar.providerPinEvidence.providerCode, "beta");
  assert.equal(order.registrar.providerPinEvidence.registrarOfRecord, "Beta Registrar");
  assert.equal(context.alpha.fake.calls.confirm, 0);
  assert.equal(context.alpha.fake.calls.operation, 0);
  assert.equal(context.alpha.fake.calls.domain, 0);
  assert.equal(context.beta.fake.calls.confirm, 1);
  assert.equal(context.beta.fake.calls.operation, 1);
  assert.equal(context.beta.fake.calls.domain, 2);
});

test("contact preparation locks revalidation; switching requires a fresh quote and acceptance cycle", async () => {
  const context = harness();
  let order = await createAndConsent(context);
  order = await context.execute("quote", {
    commandId: command("initial_quote"),
    orderId: order.id
  });
  assert.equal(order.registrar.providerCode, "alpha");
  assert.equal(context.alpha.fake.calls.ensureContacts, 1);
  order = await acceptAndAuthorize(context, order, 1200);

  context.alpha.state.contactPreviewError = new Error("alpha locked preview unavailable");
  context.alpha.state.quoteError = new Error("alpha fresh preflight unavailable");
  const betaPreflightBefore = context.beta.fake.calls.preview;
  order = await context.execute("revalidate", {
    commandId: command("locked_revalidate"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.REQUOTE_REQUIRED);
  assert.equal(order.payment.status, "voided");
  assert.equal(order.acceptedQuote, null);
  assert.equal(context.beta.fake.calls.preview, betaPreflightBefore);
  assert.equal(context.beta.fake.calls.ensureContacts, 0);

  order = await context.execute("quote", {
    commandId: command("fresh_quote_cycle"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.FINAL_QUOTED);
  assert.equal(order.registrar.providerCode, "beta");
  assert.equal(order.quote.price.amountMinor, 1400);
  assert.equal(order.acceptedQuote, null);
  assert.equal(context.alpha.fake.calls.ensureContacts, 1);
  assert.equal(context.beta.fake.calls.ensureContacts, 1);
});

test("an ambiguous alpha registration remains held and never calls healthy beta", async () => {
  const context = harness();
  let order = await createAndConsent(context);
  order = await context.execute("quote", {
    commandId: command("quote_for_ambiguous"),
    orderId: order.id
  });
  order = await acceptAndAuthorize(context, order, 1200);
  order = await context.execute("revalidate", {
    commandId: command("revalidate_for_ambiguous"),
    orderId: order.id
  });
  context.alpha.fake.controls.setConfirmError(ambiguousFakeEffect("alpha timeout"));
  order = await context.execute("confirm", {
    commandId: command("ambiguous_confirm"),
    orderId: order.id,
    executionApproval: approval(order)
  });

  assert.equal(order.state, ORDER_STATES.CONFIRM_UNKNOWN);
  assert.equal(order.registration.providerCode, "alpha");
  assert.equal(order.review.reason, "provider_mutation_requires_reconciliation");
  assert.equal(context.alpha.fake.calls.confirm, 1);
  assert.equal(context.beta.fake.calls.confirm, 0);
  assert.equal(context.alpha.fake.calls.void, 0);
  assert.equal(context.alpha.fake.calls.capture, 0);
});

test("a held result with an operation ID reconciles only against the attempted provider", async () => {
  const context = harness();
  let order = await createAndConsent(context);
  order = await context.execute("quote", {
    commandId: command("quote_for_reconcile"),
    orderId: order.id
  });
  order = await acceptAndAuthorize(context, order, 1200);
  order = await context.execute("revalidate", {
    commandId: command("revalidate_for_reconcile"),
    orderId: order.id
  });
  context.alpha.fake.controls.setConfirm({
    operationId: "alpha_operation_with_unknown_price",
    price: { amountMinor: "unknown", currency: "USD" }
  });
  order = await context.execute("confirm", {
    commandId: command("held_with_operation"),
    orderId: order.id,
    executionApproval: approval(order)
  });
  assert.equal(order.state, ORDER_STATES.CONFIRM_UNKNOWN);
  assert.equal(context.alpha.fake.calls.confirm, 1);
  assert.equal(context.beta.fake.calls.confirm, 0);

  order = await context.execute("poll_registration", {
    commandId: command("reconcile_attempted_provider"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.ACTIVE_PAYMENT_REVIEW);
  assert.equal(order.review.reason, "active_domain_provider_charge_unknown");
  assert.equal(order.registrar.providerPinEvidence.providerCode, "alpha");
  assert.equal(context.alpha.fake.calls.operation, 1);
  assert.equal(context.alpha.fake.calls.domain, 2);
  assert.equal(context.beta.fake.calls.operation, 0);
  assert.equal(context.beta.fake.calls.domain, 0);
  assert.equal(context.alpha.fake.calls.capture, 0);
});
