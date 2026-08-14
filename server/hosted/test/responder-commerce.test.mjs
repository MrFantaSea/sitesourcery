import assert from "node:assert/strict";
import test from "node:test";

import {
  getHeldResponderCommerceCatalog,
  RESPONDER_COMMERCE_CATALOG_DIGEST
} from "../responder-commerce-catalog.mjs";
import { createHeldResponderCommerceService } from
  "../responder-commerce.mjs";
import { digest } from "../security.mjs";

const IDS = Object.freeze({
  operator: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  quote: "50000000-0000-4000-8000-000000000001",
  reservation: "60000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-14T18:00:00.000Z";
const operator = Object.freeze({
  userId: IDS.operator,
  organizationId: IDS.organization
});
const customer = Object.freeze({
  userId: IDS.customer,
  organizationId: IDS.organization
});

function memoryRepository() {
  const commands = new Map();
  const quotes = new Map();
  const reservations = new Map();
  return Object.freeze({
    durable: true,
    providerEffects: false,
    async readiness() {
      return {
        ready: true,
        verified: true,
        durable: true,
        catalogAuthorityVerified: true,
        providerEffects: false
      };
    },
    async resolveScope(input) {
      const selected = {
        schema: "sitesourcery.responder-commerce-eligibility/v1",
        audience: input.audience,
        actorId: input.actorId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        customerId: input.audience === "customer"
          ? input.actorId
          : input.customerId,
        projectLifecycle: "active",
        customerMembershipState: "active",
        customerMembershipRole: "owner",
        customerEffects: false,
        paymentEffects: false,
        providerEffects: false
      };
      return { ...selected, eligibilityDigest: digest(selected) };
    },
    async claimCommand(command) {
      const previous = commands.get(command.commandId);
      if (!previous) return { status: "claimed" };
      return previous.command.fingerprint === command.fingerprint
        ? { status: "replay", result: structuredClone(previous.result) }
        : { status: "conflict", drift: ["fingerprint"] };
    },
    async commitQuoteCommand(command, quote) {
      commands.set(command.commandId, {
        command: structuredClone(command),
        result: structuredClone(quote)
      });
      quotes.set(quote.quoteId, structuredClone(quote));
    },
    async commitReservationCommand(command, reservation) {
      if ([...reservations.values()].some(
        (value) => value.quoteId === reservation.quoteId
      )) {
        const error = new Error("overlap");
        error.code = "23505";
        throw error;
      }
      commands.set(command.commandId, {
        command: structuredClone(command),
        result: structuredClone(reservation)
      });
      reservations.set(reservation.reservationId, structuredClone(reservation));
    },
    async commitReservationTransition(command, prior, next) {
      const current = reservations.get(next.reservationId);
      assert.equal(current.reservationDigest, prior.reservationDigest);
      commands.set(command.commandId, {
        command: structuredClone(command),
        result: structuredClone(next)
      });
      reservations.set(next.reservationId, structuredClone(next));
    },
    async findQuote(input) {
      const value = quotes.get(input.quoteId);
      return value?.organizationId === input.organizationId &&
          value?.projectId === input.projectId &&
          value?.customerId === input.customerId
        ? structuredClone(value)
        : null;
    },
    async findReservation(input) {
      const value = reservations.get(input.reservationId);
      return value?.organizationId === input.organizationId &&
          value?.projectId === input.projectId &&
          value?.customerId === input.customerId
        ? structuredClone(value)
        : null;
    },
    inspect() {
      return { commands, quotes, reservations };
    }
  });
}

function fixture() {
  const repository = memoryRepository();
  const service = createHeldResponderCommerceService({
    repository,
    ids: {
      next(kind) {
        if (kind === "responder_quote") return IDS.quote;
        if (kind === "responder_billing_reservation") return IDS.reservation;
        throw new Error(`unexpected ID kind ${kind}`);
      }
    },
    clock: { now: () => NOW }
  });
  return { repository, service };
}

function scope(extra = {}) {
  return {
    organizationId: IDS.organization,
    projectId: IDS.project,
    customerUserId: IDS.customer,
    ...extra
  };
}

async function quote(service, extra = {}) {
  return service.createHeldQuote(operator, scope({
    commandId: "responder.commerce.quote.0001",
    ...extra
  }));
}

async function reserve(service, quoteValue, extra = {}) {
  return service.reserveHeldBilling(operator, scope({
    commandId: "responder.commerce.reserve.0001",
    quoteId: IDS.quote,
    acceptedQuoteDigest: quoteValue.quoteDigest,
    ...extra
  }));
}

test("held Responder catalog fixes setup and monthly prices without effect authority", () => {
  const catalog = getHeldResponderCommerceCatalog();
  assert.equal(catalog.catalogDigest, RESPONDER_COMMERCE_CATALOG_DIGEST);
  assert.equal(catalog.prices.setup.amountMinor, 30_000);
  assert.equal(catalog.prices.recurring.amountMinor, 25_000);
  assert.equal(catalog.prices.initialSubtotalMinor, 55_000);
  assert.equal(catalog.taxState, "disabled_by_owner");
  assert.deepEqual(catalog.effects, {
    sellable: false,
    customerAcceptanceAuthorized: false,
    invoiceDispatchAuthorized: false,
    mailDeliveryAuthorized: false,
    paymentEffectsAuthorized: false,
    providerEffectsAuthorized: false
  });
});

test("held quote and setup-plus-monthly reservation are durable, replay-safe, and customer-readable", async () => {
  const { repository, service } = fixture();
  assert.equal((await service.readiness()).ready, true);
  const firstQuote = await quote(service);
  assert.deepEqual(await quote(service), firstQuote);
  assert.equal(firstQuote.billing.setupAmountMinor, 30_000);
  assert.equal(firstQuote.billing.monthlyAmountMinor, 25_000);
  assert.equal(firstQuote.tax.state, "disabled_by_owner");
  assert.equal(firstQuote.payable, false);

  const firstReservation = await reserve(service, firstQuote);
  assert.deepEqual(await reserve(service, firstQuote), firstReservation);
  assert.equal(firstReservation.state, "held");
  assert.equal(firstReservation.intendedProvider, "stripe");
  assert.equal(firstReservation.providerRequest, null);
  assert.equal(firstReservation.providerEffects, false);
  assert.equal(repository.inspect().quotes.size, 1);
  assert.equal(repository.inspect().reservations.size, 1);

  const customerQuote = await service.readCustomerQuote(customer, {
    projectId: IDS.project,
    quoteId: IDS.quote
  });
  const customerReservation = await service.readCustomerReservation(customer, {
    projectId: IDS.project,
    reservationId: IDS.reservation
  });
  assert.equal("actorId" in customerQuote, false);
  assert.equal("actorId" in customerReservation, false);
});

test("command drift, cross-customer reads, and payment reversal fail closed", async () => {
  const { service } = fixture();
  const firstQuote = await quote(service);
  await assert.rejects(
    quote(service, { customerUserId: IDS.operator }),
    (error) => error?.code === "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT"
  );
  await reserve(service, firstQuote);
  await assert.rejects(
    service.readCustomerReservation(
      { userId: IDS.operator, organizationId: IDS.organization },
      { projectId: IDS.project, reservationId: IDS.reservation }
    ),
    (error) => error?.code === "RESPONDER_COMMERCE_RESERVATION_UNAVAILABLE"
  );
  await assert.rejects(
    service.requestReversal(operator, scope({ reservationId: IDS.reservation })),
    (error) => error?.code === "RESPONDER_COMMERCE_REVERSAL_HELD"
  );
});

test("held cancellation and ambiguous-provider transitions are immutable alternatives", async () => {
  const cancelled = fixture();
  const cancelledQuote = await quote(cancelled.service);
  await reserve(cancelled.service, cancelledQuote);
  const cancellationInput = scope({
    reservationId: IDS.reservation,
    commandId: "responder.commerce.cancel.0001",
    expectedRevision: 1,
    cancellationEvidenceDigest: "c".repeat(64)
  });
  const cancellation = await cancelled.service.cancelHeldReservation(
    operator,
    cancellationInput
  );
  assert.deepEqual(
    await cancelled.service.cancelHeldReservation(operator, cancellationInput),
    cancellation
  );
  assert.equal(cancellation.state, "cancelled");
  assert.equal(cancellation.providerEffectCertainty, "not_submitted");
  assert.equal(cancellation.revision, 2);

  const ambiguous = fixture();
  const ambiguousQuote = await quote(ambiguous.service);
  await reserve(ambiguous.service, ambiguousQuote);
  const ambiguityInput = scope({
    reservationId: IDS.reservation,
    commandId: "responder.commerce.ambiguity.0001",
    expectedRevision: 1,
    ambiguityEvidenceDigest: "a".repeat(64)
  });
  const held = await ambiguous.service.markReservationAmbiguous(
    operator,
    ambiguityInput
  );
  assert.deepEqual(
    await ambiguous.service.markReservationAmbiguous(operator, ambiguityInput),
    held
  );
  assert.equal(held.state, "ambiguity_review_required");
  assert.equal(held.providerEffectCertainty, "ambiguous");
  assert.equal(held.providerEffects, false);
});
