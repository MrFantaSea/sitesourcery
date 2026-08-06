import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { digest } from "../../server/domain/canonical.mjs";
import {
  ORDER_STATES,
  PROVIDER_FACTS,
  ambiguousFakeEffect,
  createDomainAccountBoundary,
  createDomainOrchestrator,
  createFakeDomainPorts,
  createHeldExternalPorts,
  createMemoryDomainRepository
} from "../../server/domain/index.mjs";

const TENANT = "tenant_atelier";
const OTHER_TENANT = "tenant_rival";
const CUSTOMER = "customer_debra";
const OTHER_CUSTOMER = "customer_rival";
const DOMAIN = "debradinote.com";

function customerSession(overrides = {}) {
  return {
    tenantId: TENANT,
    customerId: CUSTOMER,
    actorId: CUSTOMER,
    roles: [],
    ...overrides
  };
}

function operatorSession(overrides = {}) {
  return {
    tenantId: TENANT,
    customerId: null,
    actorId: "operator_zack",
    roles: ["domain_refund_operator", "domain_audit_operator"],
    ...overrides
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
    documentDigest: `${key}_sha256`,
    acceptedAt: "2026-07-28T16:00:00.000Z"
  }));
}

function twoSlotTestRegistrar(fake) {
  function exactPreview(value, input) {
    if (value?.status === "unavailable") {
      return { ...structuredClone(value), domain: input.domain };
    }
    return {
      ...structuredClone(value),
      domain: input.domain,
      years: input.years,
      observedAt: value?.observedAt ?? fake.clock.now(),
      expiresAt:
        value?.expiresAt ?? new Date(Date.parse(fake.clock.now()) + 5 * 60 * 1000).toISOString(),
      noCharge: true
    };
  }

  return Object.freeze({
    ...fake.registrar,
    async quoteRegistration(input) {
      return exactPreview(await fake.registrar.previewRegistration(input), input);
    },
    async previewRegistration(input) {
      return exactPreview(await fake.registrar.previewRegistration(input), input);
    }
  });
}

function harness({ mutationMode = "fake" } = {}) {
  const repository = createMemoryDomainRepository();
  const fake = createFakeDomainPorts();
  const held = createHeldExternalPorts();
  const orchestrator = createDomainOrchestrator({
    ports: {
      repository,
      registrarProviders: {
        primary: {
          code: "spaceship",
          registrarOfRecord: "Spaceship, Inc.",
          configured: true,
          healthy: true,
          registrar: twoSlotTestRegistrar(fake)
        },
        secondary: {
          code: "contingency_held",
          registrarOfRecord: "Secondary registrar (held)",
          configured: false,
          healthy: false,
          registrar: held.registrar
        },
        preference: ["spaceship", "contingency_held"]
      },
      payments: fake.payments,
      secrets: fake.secrets,
      clock: fake.clock,
      ids: fake.ids
    },
    config: { mutationMode, serviceFeeMinor: 300 }
  });
  return {
    repository,
    fake,
    orchestrator,
    boundary: createDomainAccountBoundary(orchestrator)
  };
}

let commandSequence = 0;
function command(prefix) {
  commandSequence += 1;
  return `${prefix}_${String(commandSequence).padStart(4, "0")}`;
}

async function execute(context, session, action, body) {
  return context.boundary.execute({ session, action, body });
}

async function reachAuthorized(context, session = customerSession()) {
  let order = await execute(context, session, "create", {
    commandId: command("create"),
    projectId: "project_1",
    domain: DOMAIN,
    years: 1
  });
  order = await execute(context, session, "consent", {
    commandId: command("consent"),
    orderId: order.id,
    consentEvidenceId: "consent_agency_1",
    actorSessionId: "session_customer_1",
    ipHash: "ip_sha256",
    userAgentHash: "ua_sha256",
    registrantProfileRef: "vault://tenant/customer/domain-contact",
    registrantProfileDigest: "profile_sha256",
    agreements: agreements()
  });
  order = await execute(context, session, "quote", {
    commandId: command("quote"),
    orderId: order.id
  });
  order = await execute(context, session, "accept_quote", {
    commandId: command("accept"),
    orderId: order.id,
    acceptedAmountMinor: 1200,
    priceConsentEvidenceId: "consent_price_1"
  });
  order = await execute(context, session, "authorize_payment", {
    commandId: command("authorize"),
    orderId: order.id,
    paymentMethodRef: "pm_fake_1"
  });
  assert.equal(order.state, ORDER_STATES.PAYMENT_AUTHORIZED);
  return order;
}

async function reachReady(context, session = customerSession()) {
  let order = await reachAuthorized(context, session);
  order = await execute(context, session, "revalidate", {
    commandId: command("revalidate"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.READY_TO_CONFIRM);
  return order;
}

function approval(order) {
  return {
    approvalId: `fake_approval_${order.id}`,
    approvedBy: order.customerId,
    approvedAt: "2026-07-28T16:00:00.000Z",
    scope: "domain_registration",
    environment: "fake",
    tenantId: order.tenantId,
    orderId: order.id,
    domain: order.domain,
    quoteDigest: digest(order.acceptedQuote)
  };
}

async function reachActive(
  context,
  session = customerSession(),
  expectedState = ORDER_STATES.ACTIVE
) {
  let order = await reachReady(context, session);
  order = await execute(context, session, "confirm", {
    commandId: command("confirm"),
    orderId: order.id,
    executionApproval: approval(order)
  });
  assert.ok(
    [ORDER_STATES.REGISTRATION_PENDING, ORDER_STATES.REGISTRATION_PENDING_REVIEW].includes(
      order.state
    )
  );
  order = await execute(context, session, "poll_registration", {
    commandId: command("poll"),
    orderId: order.id
  });
  assert.equal(order.state, expectedState);
  return order;
}

test("account boundary pins authority to the trusted session and isolates tenants", async () => {
  const context = harness();
  const order = await execute(context, customerSession(), "create", {
    commandId: command("isolation"),
    projectId: "project_1",
    domain: DOMAIN,
    tenantId: OTHER_TENANT,
    customerId: OTHER_CUSTOMER,
    actorId: OTHER_CUSTOMER,
    roles: ["domain_audit_operator"]
  });
  assert.equal(order.tenantId, TENANT);
  assert.equal(order.customerId, CUSTOMER);
  assert.equal(order.registrar.providerCode, null);
  assert.equal(order.registrar.registrarOfRecord, null);
  assert.equal(order.registrar.quoteRouteEvidence, null);

  await assert.rejects(
    () =>
      execute(
        context,
        customerSession({
          tenantId: OTHER_TENANT,
          customerId: OTHER_CUSTOMER,
          actorId: OTHER_CUSTOMER
        }),
        "get",
        { orderId: order.id }
      ),
    (error) => error.code === "order_not_found" && error.status === 404
  );
  await assert.rejects(
    () =>
      execute(
        context,
        customerSession({ customerId: OTHER_CUSTOMER, actorId: OTHER_CUSTOMER }),
        "export",
        { orderId: order.id }
      ),
    (error) => error.code === "order_not_found"
  );
});

test("repository rejects a malformed atomic unit without changing order, audit, or outbox", async () => {
  const context = harness();
  const created = await execute(context, customerSession(), "create", {
    commandId: command("atomic_create"),
    projectId: "project_atomic",
    domain: "atomic-example.com"
  });
  const before = await context.repository.inspect({ tenantId: TENANT, orderId: created.id });
  const auditBefore = await context.repository.listAudit({
    tenantId: TENANT,
    orderId: created.id
  });
  const outboxBefore = await context.repository.listOutbox({ tenantId: TENANT });
  const next = structuredClone(before);
  next.version += 1;
  next.updatedAt = "2026-07-28T16:01:00.000Z";

  await assert.rejects(
    () =>
      context.repository.commit({
        tenantId: TENANT,
        orderId: created.id,
        expectedVersion: before.version,
        order: next,
        audit: {
          eventId: "malformed_event",
          tenantId: TENANT,
          orderId: created.id,
          orderVersion: 999,
          type: "malformed",
          occurredAt: next.updatedAt,
          detail: {}
        },
        outbox: {
          outboxId: "malformed_event",
          tenantId: TENANT,
          orderId: created.id,
          type: "malformed",
          occurredAt: next.updatedAt,
          payload: {}
        },
        command: null
      }),
    (error) => error.code === "repository_error"
  );
  assert.deepEqual(
    await context.repository.inspect({ tenantId: TENANT, orderId: created.id }),
    before
  );
  assert.deepEqual(
    await context.repository.listAudit({ tenantId: TENANT, orderId: created.id }),
    auditBefore
  );
  assert.deepEqual(await context.repository.listOutbox({ tenantId: TENANT }), outboxBefore);
});

test("payment authorization is exact, purpose-bound, manual-capture, and durably pre-dispatched", async () => {
  const context = harness();
  let observed;
  context.fake.controls.onAuthorize(async (input) => {
    observed = await context.repository.inspect({
      tenantId: input.tenantId,
      orderId: input.orderId
    });
  });
  const order = await reachReady(context);
  assert.equal(observed.state, ORDER_STATES.PAYMENT_AUTHORIZING);
  assert.equal(observed.payment.status, "authorizing");
  assert.equal(context.fake.state.lastAuthorization.captureMode, "manual");
  assert.equal(context.fake.state.lastAuthorization.amountMinor, 1500);
  assert.equal(
    context.fake.state.lastAuthorization.purposeDigest,
    order.payment.purposeDigest
  );
  assert.equal(context.fake.state.lastAuthorization.purpose.tenantId, TENANT);
  assert.equal(context.fake.state.lastAuthorization.purpose.domain, DOMAIN);
  assert.equal(JSON.stringify(observed).includes("pm_fake_1"), false);
});

test("purpose mismatch fails closed before any registration dispatch", async () => {
  const context = harness();
  context.fake.controls.setPurposeMismatch(true);
  let order = await execute(context, customerSession(), "create", {
    commandId: command("purpose_create"),
    projectId: "project_1",
    domain: DOMAIN
  });
  order = await execute(context, customerSession(), "consent", {
    commandId: command("purpose_consent"),
    orderId: order.id,
    consentEvidenceId: "consent_agency_1",
    actorSessionId: "session_customer_1",
    ipHash: "ip_sha256",
    userAgentHash: "ua_sha256",
    registrantProfileRef: "vault://contact",
    registrantProfileDigest: "profile_sha256",
    agreements: agreements()
  });
  order = await execute(context, customerSession(), "quote", {
    commandId: command("purpose_quote"),
    orderId: order.id
  });
  order = await execute(context, customerSession(), "accept_quote", {
    commandId: command("purpose_accept"),
    orderId: order.id,
    acceptedAmountMinor: 1200,
    priceConsentEvidenceId: "consent_price_1"
  });
  order = await execute(context, customerSession(), "authorize_payment", {
    commandId: command("purpose_authorize"),
    orderId: order.id,
    paymentMethodRef: "pm_fake_1"
  });
  assert.equal(order.state, ORDER_STATES.PAYMENT_VOID_REVIEW);
  assert.equal(order.payment.status, "authorization_unknown");
  assert.equal(context.fake.calls.confirm, 0);
});

test("fresh price divergence voids authorization and requires new consent", async () => {
  const context = harness();
  let order = await reachAuthorized(context);
  context.fake.controls.setPreview({
    status: "confirmation_required",
    price: { amountMinor: 1600, currency: "USD" },
    quoteId: "changed_quote"
  });
  order = await execute(context, customerSession(), "revalidate", {
    commandId: command("changed_price"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.REQUOTE_REQUIRED);
  assert.equal(order.payment.status, "voided");
  assert.equal(order.acceptedQuote, null);
  assert.equal(order.quote.price.amountMinor, 1600);
  assert.equal(context.fake.calls.void, 1);
  assert.equal(context.fake.calls.confirm, 0);
});

test("registration is durably dispatching before the irreversible fake call", async () => {
  const context = harness();
  const ready = await reachReady(context);
  let observed;
  context.fake.controls.onConfirm(async () => {
    observed = await context.repository.inspect({ tenantId: TENANT, orderId: ready.id });
  });
  const submitted = await execute(context, customerSession(), "confirm", {
    commandId: command("durable_confirm"),
    orderId: ready.id,
    executionApproval: approval(ready)
  });
  assert.equal(observed.state, ORDER_STATES.CONFIRM_DISPATCHING);
  assert.equal(observed.registration.status, "dispatching");
  assert.ok(observed.registration.attemptId);
  assert.equal(observed.registration.attemptedProvider, "spaceship");
  assert.equal(observed.registrar.quoteRoute.providerCode, "spaceship");
  assert.equal(submitted.state, ORDER_STATES.REGISTRATION_PENDING);
});

test("ambiguous irreversible confirmation never retries, voids, or captures", async () => {
  const context = harness();
  const ready = await reachReady(context);
  context.fake.controls.setConfirmError(ambiguousFakeEffect());
  const confirmCommand = command("ambiguous_confirm");
  const body = {
    commandId: confirmCommand,
    orderId: ready.id,
    executionApproval: approval(ready)
  };
  const unknown = await execute(context, customerSession(), "confirm", body);
  assert.equal(unknown.state, ORDER_STATES.CONFIRM_UNKNOWN);
  assert.equal(context.fake.calls.confirm, 1);
  assert.equal(context.fake.calls.void, 0);
  assert.equal(context.fake.calls.capture, 0);

  const replay = await execute(context, customerSession(), "confirm", body);
  assert.equal(replay.state, ORDER_STATES.CONFIRM_UNKNOWN);
  assert.equal(context.fake.calls.confirm, 1);
  await assert.rejects(
    () =>
      execute(context, customerSession(), "confirm", {
        ...body,
        commandId: command("second_confirm")
      }),
    (error) => error.code === "invalid_order_state"
  );
  assert.equal(context.fake.calls.confirm, 1);
});

test("registrant contact readback is mandatory before customer capture", async () => {
  const context = harness();
  let order = await reachReady(context);
  order = await execute(context, customerSession(), "confirm", {
    commandId: command("mismatch_confirm"),
    orderId: order.id,
    executionApproval: approval(order)
  });
  context.fake.controls.setRegistrarDomain({
    name: DOMAIN,
    lifecycleStatus: "registered",
    contacts: { registrant: "someone_else_contact" },
    registrationDate: "2026-07-28T16:01:00.000Z",
    expirationDate: "2027-07-28T16:01:00.000Z"
  });
  order = await execute(context, customerSession(), "poll_registration", {
    commandId: command("mismatch_poll"),
    orderId: order.id
  });
  assert.equal(order.state, ORDER_STATES.ACTIVE_PAYMENT_REVIEW);
  assert.equal(order.review.reason, "registered_domain_ownership_not_verified");
  assert.equal(order.registrar.providerPinEvidence, null);
  assert.equal(context.fake.calls.capture, 0);
});

test("successful registration captures only after ownership verification and never above consent", async () => {
  const context = harness();
  let beforeCapture;
  context.fake.controls.onCapture(async () => {
    const orders = await context.repository.listOutbox({ tenantId: TENANT });
    const verificationEvent = orders.find(
      (row) => row.type === "domain.registration.verification_pending"
    );
    beforeCapture = Boolean(verificationEvent) && verificationEvent.payload.detail.captureStarted === false;
  });
  context.fake.controls.setConfirm({
    operationId: "fake_operation_lower_price",
    price: { amountMinor: 1000, currency: "USD" }
  });
  const order = await reachActive(
    context,
    customerSession(),
    ORDER_STATES.ACTIVE_RECONCILIATION
  );
  assert.equal(order.state, ORDER_STATES.ACTIVE_RECONCILIATION);
  assert.equal(order.registrar.providerCode, "spaceship");
  assert.equal(order.registrar.registrarOfRecord, "Spaceship, Inc.");
  assert.equal(order.registrar.providerPinEvidence.providerCode, "spaceship");
  assert.match(order.registrar.providerPinEvidence.fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(beforeCapture, true);
  assert.equal(context.fake.calls.capture, 1);
  assert.equal(context.fake.state.lastCapture.amountMinor, 1300);
  assert.equal(context.fake.state.lastCapture.purposeDigest, order.payment.purposeDigest);
});

test("renewal is manual and fail-closed with no billed registrar or payment call", async () => {
  const context = harness();
  let order = await reachActive(context);
  const before = structuredClone(context.fake.calls);
  order = await execute(context, customerSession(), "renewal_review", {
    commandId: command("renewal"),
    orderId: order.id
  });
  assert.equal(order.renewal.status, "manual_review");
  assert.equal(order.review.reason, "manual_fail_closed_renewal");
  assert.equal(order.renewal.reviewReason, "standard_renewal_price_preview_not_publicly_documented");
  assert.equal(context.fake.calls.authorize, before.authorize);
  assert.equal(context.fake.calls.confirm, before.confirm);
  assert.equal(context.fake.calls.capture, before.capture);
});

test("refund uses the idempotent provider port and duplicate commands replay safely", async () => {
  const context = harness();
  const active = await reachActive(context);
  const refundCommand = command("refund");
  const body = {
    commandId: refundCommand,
    orderId: active.id,
    amountMinor: 500,
    reason: "approved goodwill refund",
    operatorEvidenceId: "operator_evidence_1"
  };
  const refunded = await execute(context, operatorSession(), "refund", body);
  assert.equal(refunded.refund.status, "settled");
  assert.equal(refunded.refund.refundedAmountMinor, 500);
  assert.equal(context.fake.calls.refund, 1);
  assert.match(context.fake.state.lastRefund.idempotencyKey, /domain-refund/u);
  assert.equal(
    context.fake.state.lastRefund.purposeDigest,
    active.payment.purposeDigest
  );

  const replay = await execute(context, operatorSession(), "refund", body);
  assert.equal(replay.refund.refundedAmountMinor, 500);
  assert.equal(context.fake.calls.refund, 1);
  await assert.rejects(
    () => execute(context, customerSession(), "refund", { ...body, commandId: command("bad_refund") }),
    (error) => error.code === "operator_forbidden"
  );
});

test("ambiguous refund is a no-retry reconciliation state", async () => {
  const context = harness();
  const active = await reachActive(context);
  context.fake.controls.setRefundError(ambiguousFakeEffect("refund timeout"));
  const refundCommand = command("unknown_refund");
  const body = {
    commandId: refundCommand,
    orderId: active.id,
    amountMinor: 400,
    reason: "approved refund",
    operatorEvidenceId: "operator_evidence_2"
  };
  const unknown = await execute(context, operatorSession(), "refund", body);
  assert.equal(unknown.state, ORDER_STATES.REFUND_UNKNOWN);
  assert.equal(context.fake.calls.refund, 1);
  await execute(context, operatorSession(), "refund", body);
  assert.equal(context.fake.calls.refund, 1);
  await assert.rejects(
    () =>
      execute(context, operatorSession(), "refund", {
        ...body,
        commandId: command("unknown_refund_second")
      }),
    (error) => error.code === "invalid_order_state"
  );
});

test("transfer auth code is delivered once and absent from order, audit, outbox, and export", async () => {
  const context = harness();
  const active = await reachActive(context);
  const transferCommand = command("transfer");
  const body = {
    commandId: transferCommand,
    orderId: active.id,
    transferConsentEvidenceId: "transfer_consent_1"
  };
  const transferred = await execute(context, customerSession(), "transfer_out", body);
  assert.equal(transferred.state, ORDER_STATES.TRANSFER_READY);
  assert.equal(transferred.transfer.providerCode, "spaceship");
  assert.equal(context.fake.calls.secretDelivery, 1);
  assert.equal(context.fake.state.deliveredSecret, "fake-secret-epp-code");
  assert.equal(JSON.stringify(transferred).includes("fake-secret-epp-code"), false);

  await execute(context, customerSession(), "transfer_out", body);
  assert.equal(context.fake.calls.secretDelivery, 1);
  const stored = await context.repository.inspect({ tenantId: TENANT, orderId: active.id });
  const audit = await context.repository.listAudit({ tenantId: TENANT, orderId: active.id });
  const outbox = await context.repository.listOutbox({ tenantId: TENANT });
  const exported = await execute(context, customerSession(), "export", { orderId: active.id });
  for (const value of [stored, audit, outbox, exported]) {
    assert.equal(JSON.stringify(value).includes("fake-secret-epp-code"), false);
  }
  assert.equal(exported.transfer.rawAuthCode, null);
  assert.equal(exported.transfer.deliveryToken, null);
});

test("authorized custody export is redacted while audit and outbox stay tenant-scoped", async () => {
  const context = harness();
  const active = await reachActive(context);
  const exported = await execute(context, customerSession(), "export", { orderId: active.id });
  assert.equal(exported.tenantId, TENANT);
  assert.equal(exported.customerId, CUSTOMER);
  assert.equal(exported.registrar.customerIsRegistrant, true);
  assert.equal(exported.registrar.providerCode, "spaceship");
  assert.equal(exported.registrar.providerPinEvidence.providerCode, "spaceship");
  assert.match(exported.registrar.providerPinEvidence.fingerprint, /^[a-f0-9]{64}$/u);
  assert.match(exported.registrar.contactReferences.registrant, /…/u);
  assert.equal(JSON.stringify(exported).includes("fake_authorization_1"), false);
  assert.equal(JSON.stringify(exported).includes("vault://"), false);

  const outbox = await context.orchestrator.listOutbox({
    ...operatorSession(),
    tenantId: TENANT
  });
  assert.ok(outbox.length > 0);
  assert.ok(outbox.every((row) => row.tenantId === TENANT));
  assert.deepEqual(
    await context.repository.listOutbox({ tenantId: OTHER_TENANT }),
    []
  );
  assert.equal(exported.audit.length, outbox.length);
  assert.ok(
    exported.audit
      .filter((row) => row.type !== "domain.order.created")
      .some((row) => row.detail.providerCode === "spaceship")
  );
});

test("held external ports refuse every provider capability without plausible data", async () => {
  const held = createHeldExternalPorts();
  for (const group of Object.values(held)) {
    for (const method of Object.values(group)) {
      await assert.rejects(
        () => method({}),
        (error) =>
          error.code === "external_effect_held" && error.certainty === "not_submitted"
      );
    }
  }
});

test("provider facts and migration preserve the current fail-closed boundary", async () => {
  assert.equal(PROVIDER_FACTS.standardRenewalPreviewDocumented, false);
  assert.equal(PROVIDER_FACTS.atomicRegistrationMaximumPriceDocumented, false);
  assert.equal(PROVIDER_FACTS.registrationIdempotencyKeyDocumented, false);
  assert.equal(PROVIDER_FACTS.customerPortfolioSubaccountsDocumented, false);

  const migration = await readFile(
    new URL("../../server/domain/migrations/001_domain_orchestration.sql", import.meta.url),
    "utf8"
  );
  for (const table of ["domain_orders", "domain_commands", "domain_audit", "domain_outbox"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`, "u"));
  }
  assert.doesNotMatch(migration, /raw_auth_code|payment_method|registrant_email/iu);
  assert.match(migration, /tenant_id/u);
});
