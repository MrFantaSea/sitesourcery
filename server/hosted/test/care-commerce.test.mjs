import assert from "node:assert/strict";
import test from "node:test";

import {
  getHeldCareCommerceCatalog,
  priceHeldCareSelection
} from "../care-commerce-catalog.mjs";
import { createMemoryCareCommerceRepository } from
  "../care-commerce-memory.mjs";
import {
  CARE_COMMERCE_ELIGIBILITY_SCHEMA,
  createCareCommerceMailReservationInterface,
  createHeldCareCommerceService
} from "../care-commerce.mjs";
import { digest } from "../security.mjs";

const IDS = Object.freeze({
  operator: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  quote: "70000000-0000-4000-8000-000000000001",
  reservation: "80000000-0000-4000-8000-000000000001",
  message: "90000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-11T16:00:00.000Z";
const LATER = "2026-08-11T17:00:00.000Z";
const DIGESTS = Object.freeze({
  acceptance: "1".repeat(64),
  scope: "2".repeat(64),
  provider: "3".repeat(64),
  cancel: "4".repeat(64),
  ambiguity: "5".repeat(64),
  recipient: "6".repeat(64),
  content: "7".repeat(64)
});
const operator = Object.freeze({
  userId: IDS.operator,
  organizationId: IDS.organization
});
const customer = Object.freeze({
  userId: IDS.customer,
  organizationId: IDS.organization
});

function eligibility(input, overrides = {}) {
  const selected = {
    schema: CARE_COMMERCE_ELIGIBILITY_SCHEMA,
    audience: input.audience,
    actorId: input.actorId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    customerId: IDS.customer,
    projectLifecycle: "active",
    catalogIdentityId: "00000000-0000-4000-8000-000000001211",
    catalogVersion: "SS-CARE-CORE-2026.1",
    serviceKey: "website_rescue",
    contractKind: "rescue",
    commercialAuthorityState: "exact_held",
    contractId: input.contractId,
    acceptanceDigest: DIGESTS.acceptance,
    scopeDigest: DIGESTS.scope,
    providerScopeDigest: DIGESTS.provider,
    contractAuthorityState: "held",
    periodId: input.periodId,
    periodState: "open",
    periodRevision: 1,
    startsOn: "2026-08-01",
    endsOn: "2026-09-01",
    customerEffects: false,
    paymentEffects: false,
    providerEffects: false,
    ...overrides
  };
  return { ...selected, eligibilityDigest: digest(selected) };
}

function fixture({
  corruptReservation = false,
  eligibilityOverrides = () => ({}),
  mailReadiness = { ready: true, verified: true }
} = {}) {
  const backingRepository = createMemoryCareCommerceRepository();
  const repository = corruptReservation
    ? Object.freeze({
        ...backingRepository,
        async findReservation(input) {
          const selected = await backingRepository.findReservation(input);
          if (selected) selected.providerRequest = { unreviewed: true };
          return selected;
        }
      })
    : backingRepository;
  const eligibilityCalls = [];
  const mailCalls = [];
  const ports = {
    eligibility: {
      async readiness() {
        return { ready: true, verified: true };
      },
      async resolve(input) {
        eligibilityCalls.push(structuredClone(input));
        return eligibility(input, eligibilityOverrides(input));
      }
    },
    repository,
    ids: {
      next(kind) {
        if (kind === "care_quote") return IDS.quote;
        if (kind === "care_invoice_reservation") return IDS.reservation;
        throw new Error(`Unexpected ID kind ${kind}`);
      }
    },
    clock: { now: () => NOW },
    mailReservations: {
      deliveryEffects: false,
      providerEffects: false,
      async readiness() {
        return structuredClone(mailReadiness);
      },
      async reserve(input) {
        mailCalls.push(input);
        throw new Error("mail should not be called implicitly");
      }
    }
  };
  return {
    backingRepository,
    eligibilityCalls,
    mailCalls,
    repository,
    service: createHeldCareCommerceService(ports)
  };
}

function operatorScope(extra = {}) {
  return {
    organizationId: IDS.organization,
    projectId: IDS.project,
    contractId: IDS.contract,
    periodId: IDS.period,
    ...extra
  };
}

async function quote(service, overrides = {}) {
  return service.createHeldQuote(operator, operatorScope({
    commandId: "care.commerce.quote.0001",
    serviceKey: "website_rescue",
    priceSelection: { kind: "repair_units", repairUnits: 2 },
    ...overrides
  }));
}

async function reserve(service, quoteProjection, overrides = {}) {
  return service.reserveHeldInvoice(operator, operatorScope({
    commandId: "care.commerce.reserve.0001",
    quoteId: IDS.quote,
    acceptedQuoteDigest: quoteProjection.record.quoteDigest,
    ...overrides
  }));
}

test("server-owned held catalog preserves exact prices and owner-redline gaps", () => {
  const catalog = getHeldCareCommerceCatalog();
  assert.equal(catalog.state, "held");
  assert.equal(catalog.effects.sellable, false);
  assert.match(catalog.catalogDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    priceHeldCareSelection("website_rescue", {
      kind: "repair_units",
      repairUnits: 2
    }),
    {
      componentKey: "website_rescue_repair_unit",
      description: "Website Rescue and Tune-Up",
      quantity: 2,
      unitAmountMinor: 12_500,
      subtotalMinor: 25_000,
      currency: "USD",
      billingCadence: "one_time",
      selection: { kind: "repair_units", repairUnits: 2 }
    }
  );
  assert.equal(priceHeldCareSelection("outside_management", {
    kind: "supportability_review",
    siteClass: "simple"
  }).subtotalMinor, 20_000);
  assert.equal(priceHeldCareSelection("outside_management", {
    kind: "onboarding_balance",
    siteClass: "supported_cms"
  }).subtotalMinor, 40_000);
  assert.equal(priceHeldCareSelection("outside_management", {
    kind: "monthly_base",
    siteClass: "simple"
  }).subtotalMinor, 12_500);
  assert.equal(priceHeldCareSelection("outside_management", {
    kind: "optional_capacity",
    repairUnits: 4
  }).subtotalMinor, 50_000);
  assert.throws(
    () => priceHeldCareSelection("custom_care", {}),
    (error) => error.code === "CARE_COMMERCE_OWNER_REDLINE_REQUIRED"
  );
  assert.throws(
    () => priceHeldCareSelection("outside_management", {
      kind: "monthly_base",
      siteClass: "complex"
    }),
    (error) => error.code === "CARE_COMMERCE_OWNER_REDLINE_REQUIRED"
  );
  assert.throws(
    () => priceHeldCareSelection("website_rescue", {
      amountMinor: 1,
      kind: "repair_units",
      repairUnits: 2
    }),
    (error) => error.code === "CARE_COMMERCE_INVALID"
  );
});

test("owner-redline catalog identities cannot produce even a held quote", async () => {
  const selected = fixture({
    eligibilityOverrides: () => ({
      catalogIdentityId: "00000000-0000-4000-8000-000000001213",
      serviceKey: "custom_care",
      contractKind: "custom_care",
      commercialAuthorityState: "owner_redline_required"
    })
  });
  await assert.rejects(
    quote(selected.service, {
      serviceKey: "custom_care",
      priceSelection: {}
    }),
    (error) => error.code === "CARE_COMMERCE_OWNER_REDLINE_REQUIRED"
  );
  assert.equal(selected.repository.inspect().quotes.length, 0);
});

test("held quote and invoice reservation bind exact org/project/contract/period and replay", async () => {
  const { service, repository, mailCalls } = fixture();
  const readiness = await service.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.commercialReady, false);
  assert.equal(readiness.durableCommercialState, false);
  assert.equal(readiness.taxPurposeReleased, false);

  const firstQuote = await quote(service);
  const replayedQuote = await quote(service);
  assert.deepEqual(replayedQuote, firstQuote);
  assert.equal(firstQuote.audience, "operator");
  assert.equal(firstQuote.record.subtotalMinor, undefined);
  assert.equal(firstQuote.record.line.subtotalMinor, 25_000);
  assert.equal(firstQuote.record.catalogVersion, "SS-CARE-COMMERCE-2026.1");
  assert.equal(firstQuote.record.careCoreCatalogVersion, "SS-CARE-CORE-2026.1");
  assert.equal(firstQuote.record.priceVersion, "SS-CUSTOM-SERVICES-2026-08-05.1");
  assert.equal(firstQuote.record.commercialContractDigest,
    "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8");
  assert.equal(firstQuote.record.payable, false);
  assert.equal(firstQuote.record.tax.taxMode, null);
  assert.equal(firstQuote.record.providerEffects, false);

  const firstReservation = await reserve(service, firstQuote);
  const replayedReservation = await reserve(service, firstQuote);
  assert.deepEqual(replayedReservation, firstReservation);
  assert.equal(firstReservation.record.state, "held");
  assert.equal(firstReservation.record.intendedProvider, "stripe");
  assert.equal(firstReservation.record.providerRequest, null);
  assert.equal(firstReservation.record.providerEffectCertainty, "not_submitted");
  assert.equal(firstReservation.record.taxMode, null);
  assert.equal(firstReservation.record.dispatchAuthorized, false);
  assert.equal(mailCalls.length, 0);

  const stored = repository.inspect();
  assert.equal(stored.quotes.length, 1);
  assert.equal(stored.reservations.length, 1);
  assert.equal(stored.commands.length, 2);

  const customerProjection = await service.readCustomerReservation(
    customer,
    {
      projectId: IDS.project,
      contractId: IDS.contract,
      periodId: IDS.period,
      reservationId: IDS.reservation
    }
  );
  assert.equal(customerProjection.audience, "customer");
  assert.equal("actorId" in customerProjection.record, false);
  assert.equal("customerId" in customerProjection.record, false);
  assert.match(customerProjection.projectionDigest, /^[0-9a-f]{64}$/u);
});

test("Care commerce readiness fails closed when mail reservation is unverified", async () => {
  const { service } = fixture({
    mailReadiness: { ready: true, verified: false }
  });
  assert.deepEqual(await service.readiness(), {
    schema: "sitesourcery.care-commerce-readiness/v1",
    ready: true,
    verified: false,
    commercialReady: false,
    durableCommercialState: false,
    taxPurposeReleased: false,
    mailReservationReady: false,
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false
  });
});

test("command reuse, reservation overlap, and eligibility drift fail closed", async () => {
  const selected = fixture();
  const firstQuote = await quote(selected.service);
  await assert.rejects(
    quote(selected.service, {
      priceSelection: { kind: "repair_units", repairUnits: 3 }
    }),
    (error) => error.code === "CARE_COMMERCE_IDEMPOTENCY_CONFLICT"
  );
  await reserve(selected.service, firstQuote);
  await assert.rejects(
    reserve(selected.service, firstQuote, {
      commandId: "care.commerce.reserve.0002"
    }),
    (error) => error.code === "CARE_COMMERCE_RESERVATION_OVERLAP"
  );

  let revision = 1;
  const drifted = fixture({
    eligibilityOverrides: () => ({ periodRevision: revision })
  });
  const driftQuote = await quote(drifted.service);
  revision = 2;
  await assert.rejects(
    reserve(drifted.service, driftQuote),
    (error) => error.code === "CARE_COMMERCE_ELIGIBILITY_DRIFT"
  );
  assert.equal(drifted.repository.inspect().reservations.length, 0);

  const corrupt = fixture({ corruptReservation: true });
  const corruptQuote = await quote(corrupt.service);
  await reserve(corrupt.service, corruptQuote);
  await assert.rejects(
    corrupt.service.readCustomerReservation(customer, {
      projectId: IDS.project,
      contractId: IDS.contract,
      periodId: IDS.period,
      reservationId: IDS.reservation
    }),
    (error) => error.code === "CARE_COMMERCE_RESERVATION_UNAVAILABLE"
  );
});

test("cancellation is no-effect and replay-safe while ambiguity blocks cancellation", async () => {
  const cancelled = fixture();
  const cancelledQuote = await quote(cancelled.service);
  await reserve(cancelled.service, cancelledQuote);
  const cancellationInput = operatorScope({
    commandId: "care.commerce.cancel.0001",
    reservationId: IDS.reservation,
    expectedRevision: 1,
    cancellationEvidenceDigest: DIGESTS.cancel
  });
  const first = await cancelled.service.cancelHeldReservation(
    operator,
    cancellationInput
  );
  const replay = await cancelled.service.cancelHeldReservation(
    operator,
    cancellationInput
  );
  assert.deepEqual(replay, first);
  assert.equal(first.record.state, "cancelled");
  assert.equal(first.record.providerEffectCertainty, "not_submitted");
  assert.equal(first.record.providerEffects, false);
  await assert.rejects(
    cancelled.service.requestReversal(operator, operatorScope({
      reservationId: IDS.reservation
    })),
    (error) => error.code === "CARE_COMMERCE_REVERSAL_AUTHORITY_HELD" &&
      error.details.paymentEffects === false &&
      error.details.providerEffects === false
  );

  const ambiguous = fixture();
  const ambiguousQuote = await quote(ambiguous.service);
  await reserve(ambiguous.service, ambiguousQuote);
  const held = await ambiguous.service.markReservationAmbiguous(
    operator,
    operatorScope({
      commandId: "care.commerce.ambiguity.0001",
      reservationId: IDS.reservation,
      expectedRevision: 1,
      ambiguityEvidenceDigest: DIGESTS.ambiguity
    })
  );
  assert.equal(held.record.state, "ambiguity_review_required");
  assert.equal(held.record.providerEffectCertainty, "ambiguous");
  await assert.rejects(
    ambiguous.service.cancelHeldReservation(operator, operatorScope({
      commandId: "care.commerce.cancel.0002",
      reservationId: IDS.reservation,
      expectedRevision: 2,
      cancellationEvidenceDigest: DIGESTS.cancel
    })),
    (error) => error.code === "CARE_COMMERCE_CANCELLATION_FENCED"
  );
});

test("customer and operator catalog reads use authenticated scoped eligibility", async () => {
  const selected = fixture();
  const customerCatalog = await selected.service.readCustomerCatalog(
    customer,
    {
      projectId: IDS.project,
      contractId: IDS.contract,
      periodId: IDS.period
    }
  );
  assert.equal(customerCatalog.audience, "customer");
  assert.equal("customerId" in customerCatalog.eligibility, false);
  const operatorCatalog = await selected.service.readOperatorCatalog(
    operator,
    operatorScope()
  );
  assert.equal(operatorCatalog.customerId, IDS.customer);
  assert.deepEqual(selected.eligibilityCalls.map((call) => call.audience), [
    "customer", "operator"
  ]);
});

test("held mail interface reserves digest-only lifecycle work and never sends", async () => {
  const calls = [];
  const notifications = {
    providerEffects: false,
    deliveryClaimed: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async reserveOperator(input) {
      calls.push(input);
      return {
        schema: "sitesourcery.mail-purpose-notification-read/v1",
        organizationId: input.operatorOrganizationId,
        projectId: IDS.project,
        sourceCustomerUserId: IDS.customer,
        source: { ...input.source, occurredAt: NOW },
        reservation: {
          state: "held",
          digest: DIGESTS.acceptance,
          reservedAt: NOW,
          expiresAt: input.expiresAt
        },
        mail: {
          messageId: IDS.message,
          lifecycleState: "pending",
          deliveryConfirmed: false
        },
        providerEffectsAuthorized: false,
        deliveryClaimed: false
      };
    }
  };
  const mail = createCareCommerceMailReservationInterface({
    notifications,
    clock: { now: () => NOW }
  });
  const receipt = await mail.reserve({
    actorId: IDS.operator,
    commandId: "care.commerce.mail.0001",
    organizationId: IDS.organization,
    projectId: IDS.project,
    customerUserId: IDS.customer,
    resourceDigest: DIGESTS.acceptance,
    source: {
      table: "ss.care_commerce_quotes",
      id: IDS.quote,
      revision: 1,
      digest: DIGESTS.acceptance,
      state: "held"
    },
    recipientDigest: DIGESTS.recipient,
    contentDigest: DIGESTS.content,
    templateVersion: "care-commerce-quote-held.v1",
    expiresAt: LATER
  });
  assert.equal(receipt.state, "reserved");
  assert.equal(receipt.deliveryEffects, false);
  assert.equal(receipt.providerEffects, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].purposeKind, "care");
  assert.equal(calls[0].notificationKind, "care_commerce_quote_held");
  assert.equal(calls[0].subjectReferenceDigest, DIGESTS.acceptance);
  assert.equal("recipient" in calls[0], false);
  assert.equal("send" in mail, false);
  assert.equal("dispatch" in mail, false);
});
