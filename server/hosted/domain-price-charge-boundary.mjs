import {
  createDomainProviderContingency,
  DOMAIN_PROVIDER_OUTCOME_SCHEMA
} from "../domain/provider-contingency.mjs";
import {
  digest,
  exactMoney,
  normalizeDomain,
  requiredInteger,
  requiredString,
  sameMoney
} from "../domain/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

export const DOMAIN_EXACT_QUOTE_PROJECTION_SCHEMA =
  "sitesourcery.domain-exact-quote-projection/v1";
export const DOMAIN_FINAL_CHARGE_EVIDENCE_SCHEMA =
  "sitesourcery.domain-final-charge-evidence/v1";
export const DOMAIN_FINAL_CHARGE_CUSTOMER_PROJECTION_SCHEMA =
  "sitesourcery.domain-final-charge-customer-projection/v1";
export const DOMAIN_FINAL_CHARGE_OPERATOR_PROJECTION_SCHEMA =
  "sitesourcery.domain-final-charge-operator-projection/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROVIDER_CODE = /^[a-z][a-z0-9_-]{1,63}$/u;
const PRICE_CLASSES = new Set(["standard", "premium"]);

function uuid(value, field) {
  const selected = String(value ?? "");
  invariant(UUID.test(selected), "INVALID_INPUT", `${field} is invalid.`, {
    status: 400
  });
  return selected;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "INVALID_DOMAIN_PRICE_EVIDENCE",
    `${field} is invalid.`,
    { status: 409 }
  );
  return value;
}

function instant(value, field) {
  const milliseconds = Date.parse(value ?? "");
  invariant(
    Number.isFinite(milliseconds),
    "INVALID_DOMAIN_PRICE_EVIDENCE",
    `${field} is invalid.`,
    { status: 409 }
  );
  return new Date(milliseconds).toISOString();
}

function priceClass(value, field = "priceClass") {
  invariant(
    typeof value === "string" &&
      value.length <= 16 &&
      PRICE_CLASSES.has(value),
    "DOMAIN_PROVIDER_PRICE_CLASS_UNVERIFIED",
    `The registrar did not classify ${field} as standard or premium.`,
    { status: 409 }
  );
  return value;
}

function requireActor(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before requesting registrar pricing evidence.",
      { status: 401 }
    );
  }
  return Object.freeze({ userId: value.userId });
}

function exactScope(value, actor, projectId) {
  const keys = ["actorId", "customerId", "organizationId", "projectId"];
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort()) &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId &&
      value.projectId === projectId &&
      UUID.test(value.organizationId),
    "PROJECT_UNAVAILABLE",
    "The selected domain project is unavailable.",
    { status: 404 }
  );
  return Object.freeze({
    actorId: actor.userId,
    customerId: actor.userId,
    organizationId: value.organizationId,
    projectId
  });
}

function providerSlots(registrarProviders) {
  const slots = [registrarProviders?.primary, registrarProviders?.secondary];
  const providers = new Map();
  for (const [index, slot] of slots.entries()) {
    invariant(
      slot && typeof slot === "object" &&
        typeof slot.code === "string" && PROVIDER_CODE.test(slot.code) &&
        typeof slot.registrarOfRecord === "string" &&
        slot.registrarOfRecord.length > 0 &&
        slot.registrarOfRecord.length <= 128 &&
        !providers.has(slot.code),
      "DOMAIN_PRICE_CHARGE_CONFIGURATION_REQUIRED",
      `Registrar provider slot ${index + 1} is invalid.`,
      { status: 500 }
    );
    providers.set(slot.code, slot);
  }
  return providers;
}

function exactQuoteProjection(route) {
  const selectedPriceClass = priceClass(
    route.route.priceClass,
    "route.priceClass"
  );
  const body = {
    schema: DOMAIN_EXACT_QUOTE_PROJECTION_SCHEMA,
    status: "held_exact_price",
    routeRef: route.id,
    domain: route.route.domain,
    registrarOfRecord: route.route.registrarOfRecord,
    providerCode: route.route.providerCode,
    priceClass: selectedPriceClass,
    price: route.route.expectedPrice,
    observedAt: route.route.observedAt,
    expiresAt: route.route.expiresAt,
    routeFingerprint: route.route.fingerprint,
    selectionDigest: route.selectionDigest,
    providerQuoteDigest: digest(route.route.quoteId),
    providerEffectsAuthorized: false,
    captureAuthorized: false,
    refundAuthorized: false
  };
  return Object.freeze({ ...body, evidenceDigest: digest(body) });
}

function unavailableQuoteProjection(outcome) {
  return Object.freeze({
    schema: DOMAIN_EXACT_QUOTE_PROJECTION_SCHEMA,
    status: "unavailable",
    domain: normalizeDomain(outcome.domain),
    providerCode: requiredString(outcome.providerCode, "providerCode", 64),
    registrarOfRecord: requiredString(
      outcome.registrarOfRecord,
      "registrarOfRecord",
      128
    ),
    reason: outcome.reason ?? null,
    providerEffectsAuthorized: false,
    captureAuthorized: false,
    refundAuthorized: false
  });
}

function finalChargeDocument({ route, attempt, reconciliation, raw, now }) {
  const routeEvidence = route.route;
  const selectedNow = instant(now, "Current time");
  const observedAt = instant(raw?.observedAt, "Final charge observedAt");
  const evidenceExpiresAt = instant(
    raw?.evidenceExpiresAt,
    "Final charge evidenceExpiresAt"
  );
  const routeExpiresAt = instant(
    raw?.quoteExpiresAt,
    "Final charge quoteExpiresAt"
  );
  const chargePrice = exactMoney(raw?.price, "Final registrar charge");
  const submittedPrice = exactMoney(
    attempt.submissionOutcome?.providerPrice,
    "Submitted registrar charge"
  );
  invariant(
    raw?.status === "final" && raw?.ambiguous === false,
    "DOMAIN_FINAL_CHARGE_AMBIGUOUS",
    "The registrar charge is not final and unambiguous.",
    { status: 409 }
  );
  invariant(
    raw.providerCode === routeEvidence.providerCode &&
      normalizeDomain(raw.domain) === routeEvidence.domain &&
      raw.operationId === attempt.operationId &&
      raw.quoteId === routeEvidence.quoteId,
    "DOMAIN_FINAL_CHARGE_BINDING_MISMATCH",
    "The final registrar charge changed domain, provider, quote, or operation.",
    { status: 409 }
  );
  invariant(
    routeExpiresAt === routeEvidence.expiresAt &&
      Date.parse(attempt.requestedAt) < Date.parse(routeEvidence.expiresAt) &&
      Date.parse(observedAt) >= Date.parse(attempt.requestedAt) &&
      Date.parse(observedAt) <= Date.parse(selectedNow) &&
      Date.parse(evidenceExpiresAt) > Date.parse(selectedNow),
    "DOMAIN_FINAL_CHARGE_EXPIRED",
    "The route or final registrar charge evidence is expired or time-drifted.",
    { status: 409 }
  );
  invariant(
    attempt.submissionOutcome?.exactProviderPriceConfirmed === true &&
      sameMoney(chargePrice, routeEvidence.expectedPrice) &&
      sameMoney(chargePrice, submittedPrice),
    "DOMAIN_FINAL_CHARGE_AMOUNT_MISMATCH",
    "The final registrar charge changed amount or currency.",
    { status: 409 }
  );
  const chargeReference = requiredString(
    raw.chargeReference,
    "Final charge reference",
    256
  );
  const body = {
    schema: DOMAIN_FINAL_CHARGE_EVIDENCE_SCHEMA,
    providerCode: routeEvidence.providerCode,
    registrarOfRecord: routeEvidence.registrarOfRecord,
    domain: routeEvidence.domain,
    years: requiredInteger(routeEvidence.years, "route.years", {
      minimum: 1,
      maximum: 10
    }),
    priceClass: priceClass(routeEvidence.priceClass, "route.priceClass"),
    price: chargePrice,
    routeFingerprint: sha256(
      routeEvidence.fingerprint,
      "route.fingerprint"
    ),
    selectionDigest: sha256(route.selectionDigest, "route.selectionDigest"),
    submissionOutcomeDigest: sha256(
      attempt.submissionOutcomeDigest,
      "attempt.submissionOutcomeDigest"
    ),
    providerPinFingerprint: sha256(
      reconciliation.providerPin?.fingerprint,
      "reconciliation.providerPin.fingerprint"
    ),
    providerQuoteDigest: digest(routeEvidence.quoteId),
    providerOperationDigest: digest(attempt.operationId),
    registrarChargeDigest: digest(chargeReference),
    routeObservedAt: routeEvidence.observedAt,
    routeExpiresAt,
    chargeObservedAt: observedAt,
    evidenceExpiresAt,
    ambiguous: false,
    providerEffectsAuthorized: false,
    captureAuthorized: false,
    refundAuthorized: false
  };
  return Object.freeze({ ...body, fingerprint: digest(body) });
}

function validatePersistedFinalCharge(value, route, attempt, now) {
  invariant(
    value?.schema === DOMAIN_FINAL_CHARGE_EVIDENCE_SCHEMA &&
      value.fingerprint === digest(
        Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== "fingerprint")
        )
      ),
    "INVALID_DOMAIN_PRICE_EVIDENCE",
    "Persisted registrar charge evidence changed.",
    { status: 409 }
  );
  const routeEvidence = route.route;
  invariant(
    value.providerCode === routeEvidence.providerCode &&
      value.registrarOfRecord === routeEvidence.registrarOfRecord &&
      value.domain === routeEvidence.domain &&
      value.years === routeEvidence.years &&
      value.priceClass === routeEvidence.priceClass &&
      sameMoney(value.price, routeEvidence.expectedPrice) &&
      value.routeFingerprint === routeEvidence.fingerprint &&
      value.selectionDigest === route.selectionDigest &&
      value.submissionOutcomeDigest === attempt.submissionOutcomeDigest &&
      value.providerPinFingerprint ===
        attempt.reconciliationOutcome?.providerPin?.fingerprint &&
      value.providerQuoteDigest === digest(routeEvidence.quoteId) &&
      value.providerOperationDigest === digest(attempt.operationId) &&
      value.routeObservedAt === routeEvidence.observedAt &&
      value.routeExpiresAt === routeEvidence.expiresAt &&
      SHA256.test(value.registrarChargeDigest) &&
      value.ambiguous === false &&
      value.providerEffectsAuthorized === false &&
      value.captureAuthorized === false &&
      value.refundAuthorized === false,
    "DOMAIN_FINAL_CHARGE_BINDING_MISMATCH",
    "Persisted registrar charge evidence does not match its route and attempt.",
    { status: 409 }
  );
  invariant(
    Date.parse(instant(value.evidenceExpiresAt, "evidenceExpiresAt")) >
      Date.parse(instant(now, "Current time")),
    "DOMAIN_FINAL_CHARGE_EXPIRED",
    "The final registrar charge evidence has expired.",
    { status: 409 }
  );
  return Object.freeze(structuredClone(value));
}

function projections(evidence) {
  const customerBody = {
    schema: DOMAIN_FINAL_CHARGE_CUSTOMER_PROJECTION_SCHEMA,
    status: "ready_for_payment_capture_review",
    domain: evidence.domain,
    registrarOfRecord: evidence.registrarOfRecord,
    priceClass: evidence.priceClass,
    price: evidence.price,
    evidenceExpiresAt: evidence.evidenceExpiresAt,
    evidenceDigest: evidence.fingerprint,
    captureAuthorized: false,
    refundAuthorized: false
  };
  const operatorBody = {
    schema: DOMAIN_FINAL_CHARGE_OPERATOR_PROJECTION_SCHEMA,
    status: "ready_for_payment_capture_review",
    domain: evidence.domain,
    providerCode: evidence.providerCode,
    registrarOfRecord: evidence.registrarOfRecord,
    priceClass: evidence.priceClass,
    price: evidence.price,
    routeFingerprint: evidence.routeFingerprint,
    selectionDigest: evidence.selectionDigest,
    submissionOutcomeDigest: evidence.submissionOutcomeDigest,
    providerPinFingerprint: evidence.providerPinFingerprint,
    providerQuoteDigest: evidence.providerQuoteDigest,
    providerOperationDigest: evidence.providerOperationDigest,
    registrarChargeDigest: evidence.registrarChargeDigest,
    evidenceExpiresAt: evidence.evidenceExpiresAt,
    evidenceDigest: evidence.fingerprint,
    captureAuthorized: false,
    refundAuthorized: false
  };
  return Object.freeze({
    customer: Object.freeze({
      ...customerBody,
      projectionDigest: digest(customerBody)
    }),
    operator: Object.freeze({
      ...operatorBody,
      projectionDigest: digest(operatorBody)
    })
  });
}

function heldFinalCharge(reason, reconciliation = null) {
  return Object.freeze({
    status: "held",
    reason,
    reconciliationStatus: reconciliation?.status ?? null,
    providerEffectsAuthorized: false,
    captureAuthorized: false,
    refundAuthorized: false
  });
}

export function createHeldDomainPriceChargeBoundary({
  repository,
  registrarProviders,
  resolveProjectScope,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    repository &&
      [
        "persistRoute",
        "readRegistrationAttempt",
        "persistSuccessfulPin"
      ].every((method) => typeof repository[method] === "function") &&
      typeof resolveProjectScope === "function" &&
      typeof clock?.now === "function",
    "DOMAIN_PRICE_CHARGE_CONFIGURATION_REQUIRED",
    "The held domain price/charge boundary is not configured.",
    { status: 500 }
  );
  const routing = createDomainProviderContingency(registrarProviders);
  const providers = providerSlots(registrarProviders);
  const defaultPrimaryProviderCode = requiredString(
    registrarProviders?.preference?.[0],
    "registrarProviders.preference[0]",
    64
  );

  async function scopeFor(actorInput, projectIdInput) {
    const actor = requireActor(actorInput);
    const projectId = uuid(projectIdInput, "Project ID");
    return exactScope(
      await resolveProjectScope({ actor, projectId }),
      actor,
      projectId
    );
  }

  async function quoteExactRegistration({
    actor,
    projectId,
    selectionKey,
    domain,
    years = 1,
    preferredProviderCode = null
  } = {}) {
    const scope = await scopeFor(actor, projectId);
    const key = requiredString(selectionKey, "selectionKey", 200);
    invariant(key.length >= 8, "INVALID_INPUT", "selectionKey is invalid.", {
      status: 400
    });
    const preferred = preferredProviderCode ?? defaultPrimaryProviderCode;
    const outcome = await routing.preflightRegistration({
      input: { domain, years },
      preferredProviderCode: preferred
    });
    if (outcome.status !== "ready") return unavailableQuoteProjection(outcome);
    priceClass(outcome.route.priceClass, "provider quote priceClass");
    const route = await repository.persistRoute({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      selectionKey: key,
      primaryProviderCode: preferred,
      fallbackUsed: outcome.fallbackUsed,
      route: outcome.route
    });
    invariant(
      Date.parse(route.route.expiresAt) > Date.parse(instant(clock.now(), "Current time")),
      "DOMAIN_PROVIDER_ROUTE_STALE",
      "The exact registrar quote expired before it became durable.",
      { status: 409 }
    );
    return exactQuoteProjection(route);
  }

  async function prepareFinalCharge({
    actor,
    projectId,
    routeId,
    attemptKey,
    expectedRegistrantContactId
  } = {}) {
    const scope = await scopeFor(actor, projectId);
    const persisted = await repository.readRegistrationAttempt({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      routeId,
      attemptKey
    });
    const { route, attempt } = persisted;
    if (attempt.state === "succeeded") {
      const evidence = validatePersistedFinalCharge(
        attempt.reconciliationOutcome?.finalChargeEvidence,
        route,
        attempt,
        clock.now()
      );
      return Object.freeze({
        status: "ready_for_payment_capture_review",
        replayed: true,
        ...projections(evidence),
        providerEffectsAuthorized: false,
        captureAuthorized: false,
        refundAuthorized: false
      });
    }
    if (
      !["submitted", "uncertain"].includes(attempt.state) ||
      !attempt.operationId
    ) {
      return heldFinalCharge("registration_requires_reconciliation");
    }
    const reconciliation = await routing.reconcileRegistration({
      route: route.route,
      operationId: attempt.operationId,
      expectedRegistrantContactId
    });
    if (reconciliation.status !== "active") {
      return heldFinalCharge(
        "registration_readback_not_active",
        reconciliation
      );
    }
    const provider = providers.get(route.route.providerCode);
    if (
      provider?.configured !== true ||
      provider?.healthy !== true ||
      typeof provider.registrar?.readRegistrationCharge !== "function"
    ) {
      return heldFinalCharge("final_registrar_charge_readback_unavailable");
    }
    let raw;
    try {
      raw = await provider.registrar.readRegistrationCharge({
        domain: route.route.domain,
        years: route.route.years,
        providerQuoteId: route.route.quoteId,
        operationId: attempt.operationId
      });
    } catch {
      return heldFinalCharge("final_registrar_charge_readback_failed");
    }
    const evidence = finalChargeDocument({
      route,
      attempt,
      reconciliation,
      raw,
      now: clock.now()
    });
    const durableOutcome = Object.freeze({
      ...reconciliation,
      finalChargeEvidence: evidence
    });
    const saved = await repository.persistSuccessfulPin({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      attemptId: attempt.id,
      providerDomainRef: route.route.domain,
      reconciliationOutcome: durableOutcome
    });
    invariant(
      saved.attempt.reconciliationOutcomeDigest === digest(durableOutcome),
      "DOMAIN_FINAL_CHARGE_PERSISTENCE_FAILED",
      "The exact final registrar charge evidence was not persisted.",
      { status: 409 }
    );
    return Object.freeze({
      status: "ready_for_payment_capture_review",
      replayed: saved.replayed,
      ...projections(evidence),
      providerEffectsAuthorized: false,
      captureAuthorized: false,
      refundAuthorized: false
    });
  }

  return Object.freeze({
    quoteExactRegistration,
    prepareFinalCharge
  });
}
