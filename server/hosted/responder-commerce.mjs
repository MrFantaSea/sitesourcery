import { deepFreeze } from "../commerce-v2/canonical.mjs";
import {
  getHeldResponderCommerceCatalog,
  RESPONDER_COMMERCE_CATALOG_DIGEST,
  RESPONDER_COMMERCE_CATALOG_ID,
  RESPONDER_COMMERCE_CATALOG_VERSION,
  RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST
} from "./responder-commerce-catalog.mjs";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const QUOTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const RESPONDER_COMMERCE_QUOTE_SCHEMA =
  "sitesourcery.responder-commerce-quote/v1";
export const RESPONDER_COMMERCE_RESERVATION_SCHEMA =
  "sitesourcery.responder-commerce-billing-reservation/v1";

function clone(value) {
  return structuredClone(value);
}

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort()),
    "RESPONDER_COMMERCE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_COMMERCE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_COMMERCE_INVALID",
    `${field} must be an opaque lowercase digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_COMMERCE_INVALID",
    "The Responder commerce idempotency key is invalid.",
    { status: 400 }
  );
  return value;
}

function actor(authenticated) {
  exactObject(
    authenticated,
    ["organizationId", "userId"],
    "Authenticated Responder commerce actor"
  );
  return deepFreeze({
    actorId: uuid(authenticated.userId, "Authenticated user ID"),
    sessionOrganizationId: uuid(
      authenticated.organizationId,
      "Authenticated organization ID"
    )
  });
}

function clockNow(clock) {
  const value = clock.now();
  const parsed = Date.parse(value);
  invariant(
    typeof value === "string" &&
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString() === value,
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "Responder commerce clock returned an invalid instant.",
    { status: 500 }
  );
  return value;
}

function validatePorts(value) {
  invariant(
    value &&
      value.repository &&
      [
        "claimCommand",
        "commitQuoteCommand",
        "commitReservationCommand",
        "commitReservationTransition",
        "findQuote",
        "findReservation",
        "readiness",
        "resolveScope"
      ].every((method) => typeof value.repository[method] === "function") &&
      value.repository.durable === true &&
      value.repository.providerEffects === false &&
      value.ids &&
      typeof value.ids.next === "function" &&
      value.clock &&
      typeof value.clock.now === "function",
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "Durable held Responder commerce ports are required.",
    { status: 500 }
  );
  return value;
}

function baseScope(value, { operator = false } = {}) {
  const keys = operator
    ? ["customerUserId", "organizationId", "projectId"]
    : ["projectId"];
  exactObject(value, keys, "Responder commerce scope");
  return {
    ...(operator
      ? {
          organizationId: uuid(value.organizationId, "Responder organization ID"),
          customerId: uuid(value.customerUserId, "Responder customer ID")
        }
      : {}),
    projectId: uuid(value.projectId, "Responder project ID")
  };
}

function exactEligibility(value, expected) {
  invariant(
    value?.schema === "sitesourcery.responder-commerce-eligibility/v1" &&
      value.audience === expected.audience &&
      value.actorId === expected.actorId &&
      value.organizationId === expected.organizationId &&
      value.projectId === expected.projectId &&
      UUID.test(value.customerId) &&
      value.projectLifecycle === "active" &&
      value.customerMembershipState === "active" &&
      ["owner", "admin", "billing"].includes(value.customerMembershipRole) &&
      value.customerEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false &&
      SHA256.test(value.eligibilityDigest),
    "RESPONDER_COMMERCE_AUTHORITY_DRIFT",
    "Responder billing authority changed unexpectedly.",
    { status: 503 }
  );
  return deepFreeze(clone(value));
}

function exactQuote(value, expected, now, expectedDigest = null) {
  invariant(
    value?.schema === RESPONDER_COMMERCE_QUOTE_SCHEMA &&
      value.organizationId === expected.organizationId &&
      value.projectId === expected.projectId &&
      value.customerId === expected.customerId &&
      UUID.test(value.quoteId) &&
      value.catalogId === RESPONDER_COMMERCE_CATALOG_ID &&
      value.catalogVersion === RESPONDER_COMMERCE_CATALOG_VERSION &&
      value.sourceAuthorityDigest === RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST &&
      value.catalogDigest === RESPONDER_COMMERCE_CATALOG_DIGEST &&
      value.state === "held" &&
      value.payable === false &&
      value.dispatchAuthorized === false &&
      value.customerAcceptanceAuthorized === false &&
      value.customerEffects === false &&
      value.mailDeliveryEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false &&
      value.billing?.setupAmountMinor === 30_000 &&
      value.billing?.monthlyAmountMinor === 25_000 &&
      value.billing?.initialSubtotalMinor === 55_000 &&
      value.billing?.currency === "USD" &&
      value.billing?.recurringCadence === "month" &&
      value.tax?.state === "disabled_by_owner" &&
      value.tax?.amountMinor === 0 &&
      value.tax?.initialTotalMinor === 55_000 &&
      SHA256.test(value.eligibilityDigest) &&
      SHA256.test(value.disclosureDigest) &&
      SHA256.test(value.quoteDigest) &&
      Date.parse(value.expiresAt) > Date.parse(now) &&
      (expectedDigest === null || value.quoteDigest === expectedDigest),
    "RESPONDER_COMMERCE_QUOTE_UNAVAILABLE",
    "The held Responder quote is unavailable.",
    { status: 404 }
  );
  return deepFreeze(clone(value));
}

function exactReservation(value, expected) {
  invariant(
    value?.schema === RESPONDER_COMMERCE_RESERVATION_SCHEMA &&
      value.organizationId === expected.organizationId &&
      value.projectId === expected.projectId &&
      value.customerId === expected.customerId &&
      UUID.test(value.reservationId) &&
      UUID.test(value.quoteId) &&
      SHA256.test(value.quoteDigest) &&
      SHA256.test(value.reservationDigest) &&
      value.intendedProvider === "stripe" &&
      value.providerRequest === null &&
      Array.isArray(value.paymentPurposes) &&
      value.paymentPurposes.length === 2 &&
      value.paymentPurposes[0]?.purpose === "responder_setup" &&
      value.paymentPurposes[0]?.amountMinor === 30_000 &&
      value.paymentPurposes[0]?.cadence === "one_time" &&
      value.paymentPurposes[1]?.purpose === "responder_monthly" &&
      value.paymentPurposes[1]?.amountMinor === 25_000 &&
      value.paymentPurposes[1]?.cadence === "month" &&
      value.paymentPurposes[1]?.intervalCount === 1 &&
      value.dispatchAuthorized === false &&
      value.customerAcceptanceAuthorized === false &&
      value.customerEffects === false &&
      value.mailDeliveryEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false,
    "RESPONDER_COMMERCE_RESERVATION_UNAVAILABLE",
    "The held Responder billing reservation is unavailable.",
    { status: 404 }
  );
  return deepFreeze(clone(value));
}

function command({ operation, commandId: id, purpose }) {
  const selected = {
    ...purpose,
    commandId: commandId(id),
    operation
  };
  return deepFreeze({ ...selected, fingerprint: digest(selected) });
}

async function idempotent(repository, selected, commit, prepare) {
  const claim = await repository.claimCommand(selected);
  if (claim.status === "replay") return deepFreeze(clone(claim.result));
  invariant(
    claim.status === "claimed",
    "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT",
    "The Responder commerce command ID was already used differently.",
    { status: 409, details: { drift: claim.drift ?? [] } }
  );
  const result = await prepare();
  await commit(selected, result);
  return result;
}

function projection(value, audience) {
  const selected = clone(value);
  if (audience === "customer") {
    delete selected.actorId;
  }
  return deepFreeze(selected);
}

export function createHeldResponderCommerceService(inputPorts) {
  const ports = validatePorts(inputPorts);

  async function resolve(authenticated, selectedScope, audience) {
    const selectedActor = actor(authenticated);
    const organizationId = audience === "customer"
      ? selectedActor.sessionOrganizationId
      : selectedScope.organizationId;
    const expected = {
      audience,
      actorId: selectedActor.actorId,
      organizationId,
      projectId: selectedScope.projectId,
      ...(selectedScope.customerId ? { customerId: selectedScope.customerId } : {})
    };
    const eligibility = exactEligibility(
      await ports.repository.resolveScope(expected),
      expected
    );
    return {
      selectedActor,
      selectedScope: {
        organizationId,
        projectId: selectedScope.projectId,
        customerId: eligibility.customerId
      },
      eligibility
    };
  }

  async function findReservation(authenticated, value, audience) {
    const selectedScope = baseScope(
      audience === "operator"
        ? {
            customerUserId: value.customerUserId,
            organizationId: value.organizationId,
            projectId: value.projectId
          }
        : { projectId: value.projectId },
      { operator: audience === "operator" }
    );
    const resolved = await resolve(authenticated, selectedScope, audience);
    const reservation = exactReservation(
      await ports.repository.findReservation({
        ...resolved.selectedScope,
        actorId: resolved.selectedActor.actorId,
        audience,
        reservationId: uuid(value.reservationId, "Responder reservation ID")
      }),
      resolved.selectedScope
    );
    return { ...resolved, reservation };
  }

  return Object.freeze({
    kind: "responder-commerce",
    mode: "held-local",
    durable: true,
    sellable: false,
    commercialEffects: false,
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      const repository = await ports.repository.readiness();
      const ready = repository?.ready === true &&
        repository?.verified === true && repository?.durable === true;
      return deepFreeze({
        schema: "sitesourcery.responder-commerce-readiness/v1",
        ready,
        verified: ready,
        mounted: true,
        mode: "held-local",
        durableCommercialState: repository?.durable === true,
        catalogAuthorityVerified: repository?.catalogAuthorityVerified === true,
        taxPurposeReleased: false,
        sellable: false,
        commercialEffects: false,
        customerEffects: false,
        mailDeliveryEffects: false,
        paymentEffects: false,
        providerEffects: false
      });
    },
    async readOperatorCatalog(authenticated, value) {
      const resolved = await resolve(
        authenticated,
        baseScope(value, { operator: true }),
        "operator"
      );
      return deepFreeze({
        audience: "operator",
        eligibility: clone(resolved.eligibility),
        catalog: getHeldResponderCommerceCatalog()
      });
    },
    async createHeldQuote(authenticated, value) {
      exactObject(
        value,
        ["commandId", "customerUserId", "organizationId", "projectId"],
        "Responder quote command"
      );
      const resolved = await resolve(
        authenticated,
        baseScope({
          customerUserId: value.customerUserId,
          organizationId: value.organizationId,
          projectId: value.projectId
        }, { operator: true }),
        "operator"
      );
      const purpose = {
        operation: "responder_quote_create",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        eligibilityDigest: resolved.eligibility.eligibilityDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projection(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, quote) => ports.repository.commitQuoteCommand(selected, quote),
        async () => {
          const issuedAt = clockNow(ports.clock);
          const catalog = getHeldResponderCommerceCatalog();
          const disclosure = {
            schema: "sitesourcery.responder-commerce-disclosure/v1",
            catalogVersion: catalog.catalogVersion,
            catalogDigest: catalog.catalogDigest,
            sourceAuthorityDigest: catalog.sourceAuthorityDigest,
            state: "held",
            text: clone(catalog.disclosure),
            effects: clone(catalog.effects)
          };
          const selected = {
            schema: RESPONDER_COMMERCE_QUOTE_SCHEMA,
            quoteId: uuid(ports.ids.next("responder_quote"), "Responder quote ID"),
            actorId: resolved.selectedActor.actorId,
            ...resolved.selectedScope,
            catalogId: RESPONDER_COMMERCE_CATALOG_ID,
            catalogVersion: RESPONDER_COMMERCE_CATALOG_VERSION,
            sourceAuthorityDigest: RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST,
            catalogDigest: RESPONDER_COMMERCE_CATALOG_DIGEST,
            eligibilityDigest: resolved.eligibility.eligibilityDigest,
            state: "held",
            payable: false,
            dispatchAuthorized: false,
            customerAcceptanceAuthorized: false,
            billing: {
              setupAmountMinor: 30_000,
              monthlyAmountMinor: 25_000,
              initialSubtotalMinor: 55_000,
              currency: "USD",
              recurringCadence: "month"
            },
            tax: {
              state: "disabled_by_owner",
              amountMinor: 0,
              initialTotalMinor: 55_000
            },
            disclosure,
            disclosureDigest: digest(disclosure),
            issuedAt,
            expiresAt: new Date(Date.parse(issuedAt) + QUOTE_TTL_MS).toISOString(),
            customerEffects: false,
            mailDeliveryEffects: false,
            paymentEffects: false,
            providerEffects: false
          };
          return deepFreeze({ ...selected, quoteDigest: digest(selected) });
        }
      ), "operator");
    },
    async readCustomerQuote(authenticated, value) {
      exactObject(value, ["projectId", "quoteId"], "Responder customer quote read");
      const resolved = await resolve(
        authenticated,
        baseScope({ projectId: value.projectId }),
        "customer"
      );
      const quote = exactQuote(
        await ports.repository.findQuote({
          ...resolved.selectedScope,
          actorId: resolved.selectedActor.actorId,
          audience: "customer",
          quoteId: uuid(value.quoteId, "Responder quote ID")
        }),
        resolved.selectedScope,
        clockNow(ports.clock)
      );
      return projection(quote, "customer");
    },
    async reserveHeldBilling(authenticated, value) {
      exactObject(
        value,
        [
          "acceptedQuoteDigest", "commandId", "customerUserId",
          "organizationId", "projectId", "quoteId"
        ],
        "Responder billing reservation command"
      );
      const resolved = await resolve(
        authenticated,
        baseScope({
          customerUserId: value.customerUserId,
          organizationId: value.organizationId,
          projectId: value.projectId
        }, { operator: true }),
        "operator"
      );
      const now = clockNow(ports.clock);
      const quote = exactQuote(
        await ports.repository.findQuote({
          ...resolved.selectedScope,
          actorId: resolved.selectedActor.actorId,
          audience: "operator",
          quoteId: uuid(value.quoteId, "Responder quote ID")
        }),
        resolved.selectedScope,
        now,
        sha256(value.acceptedQuoteDigest, "Accepted Responder quote digest")
      );
      invariant(
        quote.eligibilityDigest === resolved.eligibility.eligibilityDigest,
        "RESPONDER_COMMERCE_ELIGIBILITY_DRIFT",
        "Responder billing authority changed after quote preparation.",
        { status: 409 }
      );
      const purpose = {
        operation: "responder_billing_reserve",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        quoteId: quote.quoteId,
        acceptedQuoteDigest: quote.quoteDigest,
        eligibilityDigest: resolved.eligibility.eligibilityDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      return projection(await idempotent(
        ports.repository,
        selectedCommand,
        (selected, reservation) =>
          ports.repository.commitReservationCommand(selected, reservation),
        async () => {
          const selected = {
            schema: RESPONDER_COMMERCE_RESERVATION_SCHEMA,
            reservationId: uuid(
              ports.ids.next("responder_billing_reservation"),
              "Responder reservation ID"
            ),
            actorId: resolved.selectedActor.actorId,
            ...resolved.selectedScope,
            quoteId: quote.quoteId,
            quoteDigest: quote.quoteDigest,
            eligibilityDigest: resolved.eligibility.eligibilityDigest,
            state: "held",
            revision: 1,
            reservationKind: "responder_setup_and_monthly",
            intendedProvider: "stripe",
            providerRequest: null,
            providerEffectCertainty: "not_submitted",
            holdReason: "responder_catalog_legal_provider_release_required",
            dispatchAuthorized: false,
            customerAcceptanceAuthorized: false,
            paymentPurposes: [
              {
                purpose: "responder_setup",
                amountMinor: 30_000,
                cadence: "one_time"
              },
              {
                purpose: "responder_monthly",
                amountMinor: 25_000,
                cadence: "month",
                intervalCount: 1
              }
            ],
            initialSubtotalMinor: 55_000,
            taxState: "disabled_by_owner",
            taxMinor: 0,
            initialTotalMinor: 55_000,
            currency: "USD",
            reservedAt: now,
            updatedAt: now,
            cancellationEvidenceDigest: null,
            ambiguityEvidenceDigest: null,
            customerEffects: false,
            mailDeliveryEffects: false,
            paymentEffects: false,
            providerEffects: false
          };
          return deepFreeze({
            ...selected,
            reservationDigest: digest(selected)
          });
        }
      ), "operator");
    },
    async readCustomerReservation(authenticated, value) {
      exactObject(
        value,
        ["projectId", "reservationId"],
        "Responder customer reservation read"
      );
      const resolved = await findReservation(authenticated, value, "customer");
      return projection(resolved.reservation, "customer");
    },
    async cancelHeldReservation(authenticated, value) {
      exactObject(
        value,
        [
          "cancellationEvidenceDigest", "commandId", "customerUserId",
          "expectedRevision", "organizationId", "projectId", "reservationId"
        ],
        "Responder cancellation command"
      );
      const resolved = await resolve(
        authenticated,
        baseScope({
          customerUserId: value.customerUserId,
          organizationId: value.organizationId,
          projectId: value.projectId
        }, { operator: true }),
        "operator"
      );
      const reservationId = uuid(
        value.reservationId,
        "Responder reservation ID"
      );
      const evidenceDigest = sha256(
        value.cancellationEvidenceDigest,
        "Responder cancellation evidence digest"
      );
      const purpose = {
        operation: "responder_reservation_cancel",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        reservationId,
        expectedRevision: value.expectedRevision,
        evidenceDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      const claim = await ports.repository.claimCommand(selectedCommand);
      if (claim.status === "replay") {
        return projection(deepFreeze(clone(claim.result)), "operator");
      }
      invariant(
        claim.status === "claimed",
        "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT",
        "The Responder commerce command ID was already used differently.",
        { status: 409, details: { drift: claim.drift ?? [] } }
      );
      const reservation = exactReservation(
        await ports.repository.findReservation({
          ...resolved.selectedScope,
          actorId: resolved.selectedActor.actorId,
          audience: "operator",
          reservationId
        }),
        resolved.selectedScope
      );
      invariant(
        value.expectedRevision === reservation.revision &&
          reservation.state === "held",
        "RESPONDER_COMMERCE_RESERVATION_CONFLICT",
        "The held Responder reservation changed.",
        { status: 409 }
      );
      const updatedAt = clockNow(ports.clock);
      const selected = {
        ...clone(reservation),
        actorId: resolved.selectedActor.actorId,
        state: "cancelled",
        revision: reservation.revision + 1,
        providerEffectCertainty: "not_submitted",
        holdReason: "cancelled_before_provider_submission",
        cancellationEvidenceDigest: evidenceDigest,
        updatedAt
      };
      delete selected.reservationDigest;
      const next = deepFreeze({
        ...selected,
        reservationDigest: digest(selected)
      });
      await ports.repository.commitReservationTransition(
        selectedCommand,
        reservation,
        next
      );
      return projection(next, "operator");
    },
    async markReservationAmbiguous(authenticated, value) {
      exactObject(
        value,
        [
          "ambiguityEvidenceDigest", "commandId", "customerUserId",
          "expectedRevision", "organizationId", "projectId", "reservationId"
        ],
        "Responder ambiguity command"
      );
      const resolved = await resolve(
        authenticated,
        baseScope({
          customerUserId: value.customerUserId,
          organizationId: value.organizationId,
          projectId: value.projectId
        }, { operator: true }),
        "operator"
      );
      const reservationId = uuid(
        value.reservationId,
        "Responder reservation ID"
      );
      const evidenceDigest = sha256(
        value.ambiguityEvidenceDigest,
        "Responder ambiguity evidence digest"
      );
      const purpose = {
        operation: "responder_reservation_ambiguity_hold",
        actorId: resolved.selectedActor.actorId,
        ...resolved.selectedScope,
        reservationId,
        expectedRevision: value.expectedRevision,
        evidenceDigest
      };
      const selectedCommand = command({
        ...purpose,
        commandId: value.commandId,
        purpose
      });
      const claim = await ports.repository.claimCommand(selectedCommand);
      if (claim.status === "replay") {
        return projection(deepFreeze(clone(claim.result)), "operator");
      }
      invariant(
        claim.status === "claimed",
        "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT",
        "The Responder commerce command ID was already used differently.",
        { status: 409, details: { drift: claim.drift ?? [] } }
      );
      const reservation = exactReservation(
        await ports.repository.findReservation({
          ...resolved.selectedScope,
          actorId: resolved.selectedActor.actorId,
          audience: "operator",
          reservationId
        }),
        resolved.selectedScope
      );
      invariant(
        value.expectedRevision === reservation.revision &&
          reservation.state === "held",
        "RESPONDER_COMMERCE_RESERVATION_CONFLICT",
        "The held Responder reservation changed.",
        { status: 409 }
      );
      const updatedAt = clockNow(ports.clock);
      const selected = {
        ...clone(reservation),
        actorId: resolved.selectedActor.actorId,
        state: "ambiguity_review_required",
        revision: reservation.revision + 1,
        providerEffectCertainty: "ambiguous",
        holdReason: "manual_provider_reconciliation_required",
        ambiguityEvidenceDigest: evidenceDigest,
        updatedAt
      };
      delete selected.reservationDigest;
      const next = deepFreeze({
        ...selected,
        reservationDigest: digest(selected)
      });
      await ports.repository.commitReservationTransition(
        selectedCommand,
        reservation,
        next
      );
      return projection(next, "operator");
    },
    async requestReversal(authenticated, value) {
      exactObject(
        value,
        ["customerUserId", "organizationId", "projectId", "reservationId"],
        "Responder reversal request"
      );
      await findReservation(authenticated, value, "operator");
      invariant(
        false,
        "RESPONDER_COMMERCE_REVERSAL_HELD",
        "Responder reversal remains held until an authoritative payment receipt exists.",
        { status: 409 }
      );
    }
  });
}
