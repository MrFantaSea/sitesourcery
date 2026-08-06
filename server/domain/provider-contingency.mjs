import {
  digest,
  exactMoney,
  normalizeDomain,
  requiredInteger,
  requiredString,
  sameMoney
} from "./canonical.mjs";
import { DomainError, ExternalEffectError, invariant } from "./errors.mjs";

export const DOMAIN_PROVIDER_ROUTE_SCHEMA = "sitesourcery.domain-provider-route/v1";
export const DOMAIN_PROVIDER_PIN_SCHEMA = "sitesourcery.domain-provider-pin/v1";
export const DOMAIN_PROVIDER_OUTCOME_SCHEMA = "sitesourcery.domain-provider-outcome/v1";

const MUTATION_STATES = new Set(["not_started", "submitted", "uncertain"]);
const PINNED_READS = new Set([
  "getDomain",
  "assessTransferOut",
  "getAuthCode",
  "getNameservers",
  "listDnsRecords"
]);
const PINNED_MUTATIONS = new Set([
  "setTransferLock",
  "setNameservers",
  "saveDnsRecords",
  "deleteDnsRecords",
  "renewDomain",
  "submitTransfer"
]);
const BILLED_MUTATIONS = new Set(["renewDomain", "submitTransfer"]);

/**
 * Routes no-charge preflight across two registrar slots. Mutations never fail
 * over: the caller supplies durable route/pin evidence and an attempt ID, and
 * this boundary invokes at most one provider once.
 */
export function createDomainProviderContingency({
  primary,
  secondary,
  preference
} = {}) {
  const providers = Object.freeze([
    providerSlot(primary, "primary"),
    providerSlot(secondary, "secondary")
  ]);
  invariant(
    providers[0].code !== providers[1].code,
    "duplicate_domain_provider",
    "domain provider codes must be unique",
    { status: 500 }
  );
  const byCode = new Map(providers.map((provider) => [provider.code, provider]));
  const defaultOrder = providerPreference(
    preference ?? providers.map((provider) => provider.code),
    byCode
  );

  function ordered(preferredProviderCode) {
    if (preferredProviderCode === undefined || preferredProviderCode === null) {
      return defaultOrder.map((code) => byCode.get(code));
    }
    const preferred = knownProvider(preferredProviderCode, byCode, "preferredProviderCode");
    return [preferred, ...defaultOrder.filter((code) => code !== preferred.code).map((code) => byCode.get(code))];
  }

  function selectRegistrationProvider({ preferredProviderCode } = {}) {
    const provider = ordered(preferredProviderCode).find(isAvailable);
    if (!provider) throw providersUnavailable(providers, []);
    return frozen({
      providerCode: provider.code,
      registrarOfRecord: provider.registrarOfRecord
    });
  }

  async function preflightRegistration({
    input,
    preferredProviderCode,
    lockedProviderCode
  } = {}) {
    const registration = registrationInput(input);
    const candidates =
      lockedProviderCode === undefined || lockedProviderCode === null
        ? ordered(preferredProviderCode)
        : [knownProvider(lockedProviderCode, byCode, "lockedProviderCode")];
    const failures = [];

    for (const provider of candidates) {
      if (!isAvailable(provider) || typeof provider.registrar.previewRegistration !== "function") {
        failures.push(providerAttempt(provider, "unavailable"));
        continue;
      }
      try {
        const raw = await provider.registrar.previewRegistration({
          ...structuredClone(input),
          ...registration
        });
        if (raw?.status === "unavailable") {
          return frozen({
            schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
            status: "unavailable",
            providerCode: provider.code,
            registrarOfRecord: provider.registrarOfRecord,
            domain: registration.domain,
            reason: optionalString(raw.reason, 128)
          });
        }
        const preview = safePreview(raw, registration);
        return frozen({
          schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
          status: "ready",
          route: createRoute(provider, registration, preview),
          preview,
          fallbackUsed: provider.code !== candidates[0].code
        });
      } catch (error) {
        // previewRegistration is contractually no-charge/read-only.
        failures.push(providerAttempt(provider, "preflight_failed", error));
      }
    }
    throw providersUnavailable(providers, failures);
  }

  async function submitRegistration({ route, input, mutationState = "not_started" } = {}) {
    const providerRoute = validateRoute(route, byCode);
    const provider = byCode.get(providerRoute.providerCode);
    const attemptId = requiredString(input?.attemptId, "attemptId", 256);
    assertRegistration(input, providerRoute);
    invariant(
      sameMoney(exactMoney(input.expectedPrice, "expectedPrice"), providerRoute.expectedPrice),
      "domain_provider_price_mismatch",
      "accepted registration price does not match the provider quote",
      { status: 409 }
    );
    const priorState = mutationStateOf(mutationState);
    if (priorState !== "not_started") {
      return held({
        provider,
        operation: "confirmRegistration",
        attemptId,
        effect: priorState,
        reason: "prior_registration_requires_reconciliation",
        reconciliationRequired: true
      });
    }
    if (!isAvailable(provider) || typeof provider.registrar.confirmRegistration !== "function") {
      return held({
        provider,
        operation: "confirmRegistration",
        attemptId,
        effect: "not_submitted",
        reason: "selected_provider_unavailable_before_dispatch",
        reconciliationRequired: false,
        newPreflightRequired: true
      });
    }

    let response;
    try {
      response = await provider.registrar.confirmRegistration({
        ...structuredClone(input),
        domain: providerRoute.domain,
        years: providerRoute.years,
        expectedPrice: structuredClone(providerRoute.expectedPrice),
        providerQuoteId: providerRoute.quoteId,
        attemptId
      });
    } catch (error) {
      const effect = effectCertainty(error);
      return held({
        provider,
        operation: "confirmRegistration",
        attemptId,
        effect,
        reason:
          effect === "not_submitted"
            ? "provider_rejected_before_submission"
            : "provider_mutation_requires_reconciliation",
        reconciliationRequired: effect !== "not_submitted",
        newPreflightRequired: effect === "not_submitted",
        error
      });
    }

    const operationId = boundedString(response?.operationId, 256);
    if (!operationId) {
      return held({
        provider,
        operation: "confirmRegistration",
        attemptId,
        effect: "uncertain",
        reason: "registration_response_missing_operation_id",
        reconciliationRequired: true
      });
    }
    let providerPrice = null;
    if (response?.price !== undefined && response?.price !== null) {
      try {
        providerPrice = exactMoney(response.price, "provider registration price");
      } catch {
        return held({
          provider,
          operation: "confirmRegistration",
          attemptId,
          operationId,
          effect: "submitted",
          reason: "registration_provider_price_invalid",
          reconciliationRequired: true
        });
      }
    }
    return frozen({
      schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
      status: "submitted",
      operation: "confirmRegistration",
      providerCode: provider.code,
      registrarOfRecord: provider.registrarOfRecord,
      attemptId,
      operationId,
      expectedPrice: providerRoute.expectedPrice,
      providerPrice,
      exactProviderPriceConfirmed: sameMoney(providerPrice, providerRoute.expectedPrice),
      automaticProviderSwitch: false
    });
  }

  async function reconcileRegistration({
    route,
    operationId,
    expectedRegistrantContactId
  } = {}) {
    const providerRoute = validateRoute(route, byCode);
    const provider = byCode.get(providerRoute.providerCode);
    const id = requiredString(operationId, "operationId", 256);
    const registrant = requiredString(
      expectedRegistrantContactId,
      "expectedRegistrantContactId",
      256
    );
    if (
      !isAvailable(provider) ||
      typeof provider.registrar.getOperation !== "function" ||
      typeof provider.registrar.getDomain !== "function"
    ) {
      return heldReconciliation(provider, id, "pinned_provider_readback_unavailable");
    }

    let operation;
    try {
      operation = await provider.registrar.getOperation({ operationId: id });
    } catch (error) {
      return heldReconciliation(provider, id, "registration_operation_readback_failed", error);
    }
    if (operation?.status === "pending") {
      return frozen({
        schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
        status: "pending",
        operation: "reconcileRegistration",
        providerCode: provider.code,
        registrarOfRecord: provider.registrarOfRecord,
        operationId: id,
        automaticProviderSwitch: false
      });
    }
    if (operation?.status !== "success") {
      return heldReconciliation(
        provider,
        id,
        operation?.status === "failed"
          ? "registration_failed_billing_requires_reconciliation"
          : "registration_operation_status_invalid"
      );
    }

    let domain;
    try {
      domain = await provider.registrar.getDomain({ domain: providerRoute.domain });
    } catch (error) {
      return heldReconciliation(provider, id, "registered_domain_readback_failed", error);
    }
    if (
      domain?.name !== providerRoute.domain ||
      domain?.lifecycleStatus !== "registered" ||
      domain?.contacts?.registrant !== registrant
    ) {
      return heldReconciliation(provider, id, "registered_domain_ownership_not_verified");
    }
    return frozen({
      schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
      status: "active",
      operation: "reconcileRegistration",
      operationId: id,
      providerPin: createPin(provider, providerRoute.domain),
      automaticProviderSwitch: false
    });
  }

  async function readPinned({ pin, operation, input = {} } = {}) {
    const providerPin = validatePin(pin, byCode);
    invariant(PINNED_READS.has(operation), "domain_provider_read_invalid", "invalid pinned read", {
      status: 400
    });
    const provider = byCode.get(providerPin.providerCode);
    if (!isAvailable(provider) || typeof provider.registrar[operation] !== "function") {
      return held({
        pin: providerPin,
        operation,
        reason: "pinned_provider_unavailable",
        reconciliationRequired: false
      });
    }
    const providerInput = bindDomain(providerPin, input);
    try {
      return frozen({
        schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
        status: "ok",
        operation,
        providerPin,
        result: await provider.registrar[operation](providerInput),
        automaticProviderSwitch: false
      });
    } catch (error) {
      return held({
        pin: providerPin,
        operation,
        reason: "pinned_provider_read_failed",
        reconciliationRequired: false,
        error
      });
    }
  }

  async function mutatePinned({
    pin,
    operation,
    input = {},
    mutationState = "not_started"
  } = {}) {
    const providerPin = validatePin(pin, byCode);
    invariant(
      PINNED_MUTATIONS.has(operation),
      "domain_provider_mutation_invalid",
      "invalid pinned mutation",
      { status: 400 }
    );
    const provider = byCode.get(providerPin.providerCode);
    const attemptId = requiredString(input.attemptId, "attemptId", 256);
    if (BILLED_MUTATIONS.has(operation)) validatePriceConfirmation(input.priceConfirmation);
    const priorState = mutationStateOf(mutationState);
    if (priorState !== "not_started") {
      return held({
        pin: providerPin,
        operation,
        attemptId,
        effect: priorState,
        reason: "prior_mutation_requires_reconciliation",
        reconciliationRequired: true
      });
    }
    if (!isAvailable(provider) || typeof provider.registrar[operation] !== "function") {
      return held({
        pin: providerPin,
        operation,
        attemptId,
        effect: "not_submitted",
        reason: "pinned_provider_unavailable",
        reconciliationRequired: false
      });
    }

    const providerInput = bindDomain(providerPin, input);
    try {
      const result = await provider.registrar[operation](providerInput);
      return frozen({
        schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
        status: "submitted",
        operation,
        providerPin,
        attemptId,
        result,
        existingPinRetained: true,
        transferRequiresExplicitCompletion: operation === "submitTransfer",
        automaticProviderSwitch: false
      });
    } catch (error) {
      const effect = effectCertainty(error);
      return held({
        pin: providerPin,
        operation,
        attemptId,
        effect,
        reason:
          effect === "not_submitted"
            ? "provider_rejected_before_submission"
            : "pinned_mutation_requires_reconciliation",
        reconciliationRequired: effect !== "not_submitted",
        error
      });
    }
  }

  return Object.freeze({
    selectRegistrationProvider,
    preflightRegistration,
    submitRegistration,
    reconcileRegistration,
    readPinned,
    mutatePinned
  });
}

function providerSlot(value, label) {
  invariant(value && typeof value === "object", "invalid_domain_provider", `${label} is required`, {
    status: 500
  });
  const code = requiredString(value.code, `${label}.code`, 64);
  invariant(/^[a-z][a-z0-9_-]{1,63}$/u.test(code), "invalid_domain_provider", "invalid provider code", {
    status: 500
  });
  const configured = value.configured === true;
  invariant(
    !configured || (value.registrar && typeof value.registrar === "object"),
    "invalid_domain_provider",
    "configured provider requires an adapter",
    { status: 500 }
  );
  return Object.freeze({
    code,
    registrarOfRecord: requiredString(value.registrarOfRecord, `${label}.registrarOfRecord`, 128),
    configured,
    healthy: value.healthy === true,
    registrar: value.registrar ?? Object.freeze({})
  });
}

function providerPreference(value, byCode) {
  invariant(
    Array.isArray(value) && value.length === 2 && new Set(value).size === 2,
    "invalid_domain_provider_preference",
    "provider preference must name both providers",
    { status: 500 }
  );
  value.forEach((code) =>
    invariant(byCode.has(code), "invalid_domain_provider_preference", "unknown preferred provider", {
      status: 500
    })
  );
  return Object.freeze([...value]);
}

function knownProvider(value, byCode, label) {
  const code = requiredString(value, label, 64);
  invariant(byCode.has(code), "unknown_domain_provider", `${label} is unknown`, { status: 400 });
  return byCode.get(code);
}

function isAvailable(provider) {
  return provider.configured && provider.healthy;
}

function registrationInput(value) {
  return Object.freeze({
    domain: normalizeDomain(value?.domain),
    years: requiredInteger(value?.years ?? 1, "years", { minimum: 1, maximum: 10 })
  });
}

function safePreview(value, registration) {
  invariant(
    value?.status === "confirmation_required" && value.noCharge === true,
    "unsafe_registrar_preview",
    "provider did not return a no-charge confirmation preview",
    { status: 502 }
  );
  if (value.domain !== undefined) {
    invariant(
      normalizeDomain(value.domain) === registration.domain,
      "unsafe_registrar_preview",
      "preview domain changed",
      { status: 502 }
    );
  }
  return frozen({
    status: "confirmation_required",
    ...registration,
    price: exactMoney(value.price, "registration preview"),
    quoteId: requiredString(value.quoteId, "registration preview quoteId", 256),
    observedAt: optionalString(value.observedAt, 40),
    expiresAt: optionalString(value.expiresAt, 40),
    noCharge: true
  });
}

function createRoute(provider, registration, preview) {
  return evidence(DOMAIN_PROVIDER_ROUTE_SCHEMA, {
    providerCode: provider.code,
    registrarOfRecord: provider.registrarOfRecord,
    ...registration,
    quoteId: preview.quoteId,
    expectedPrice: preview.price,
    observedAt: preview.observedAt,
    expiresAt: preview.expiresAt
  });
}

function validateRoute(value, byCode) {
  const provider = evidenceProvider(value, DOMAIN_PROVIDER_ROUTE_SCHEMA, byCode, "route");
  const body = {
    providerCode: provider.code,
    registrarOfRecord: provider.registrarOfRecord,
    ...registrationInput(value),
    quoteId: requiredString(value.quoteId, "route.quoteId", 256),
    expectedPrice: exactMoney(value.expectedPrice, "route.expectedPrice"),
    observedAt: optionalString(value.observedAt, 40),
    expiresAt: optionalString(value.expiresAt, 40)
  };
  return verifyEvidence(value, DOMAIN_PROVIDER_ROUTE_SCHEMA, body, "route");
}

function assertRegistration(input, route) {
  const actual = registrationInput(input);
  invariant(
    actual.domain === route.domain && actual.years === route.years,
    "domain_provider_route_mismatch",
    "registration does not match its provider route",
    { status: 409 }
  );
}

function createPin(provider, domain) {
  return evidence(DOMAIN_PROVIDER_PIN_SCHEMA, {
    providerCode: provider.code,
    registrarOfRecord: provider.registrarOfRecord,
    domain
  });
}

function validatePin(value, byCode) {
  const provider = evidenceProvider(value, DOMAIN_PROVIDER_PIN_SCHEMA, byCode, "pin");
  // A provider pin can outlive the registrar's current display or legal name.
  // Route by the stable provider code while preserving and verifying the
  // registrar-of-record name captured when the domain was acquired.
  const registrarOfRecord = requiredString(
    value.registrarOfRecord,
    "pin.registrarOfRecord",
    128
  );
  return verifyEvidence(
    value,
    DOMAIN_PROVIDER_PIN_SCHEMA,
    {
      providerCode: provider.code,
      registrarOfRecord,
      domain: normalizeDomain(value.domain)
    },
    "pin"
  );
}

function evidenceProvider(value, schema, byCode, label) {
  invariant(value?.schema === schema, `invalid_domain_provider_${label}`, `invalid provider ${label}`, {
    status: 409
  });
  const provider = byCode.get(value.providerCode);
  invariant(provider, "unknown_domain_provider", `provider ${label} is unknown`, { status: 409 });
  return provider;
}

function evidence(schema, body) {
  const value = { schema, ...body };
  return frozen({ ...value, fingerprint: digest(value) });
}

function verifyEvidence(value, schema, body, label) {
  const normalized = { schema, ...body };
  invariant(
    value.registrarOfRecord === body.registrarOfRecord && value.fingerprint === digest(normalized),
    `invalid_domain_provider_${label}`,
    `provider ${label} evidence changed`,
    { status: 409 }
  );
  return frozen({ ...normalized, fingerprint: value.fingerprint });
}

function bindDomain(pin, input) {
  invariant(input && typeof input === "object", "invalid_input", "provider input is required", {
    status: 400
  });
  if (input.domain !== undefined) {
    invariant(
      normalizeDomain(input.domain) === pin.domain,
      "domain_provider_pin_mismatch",
      "domain does not match provider pin",
      { status: 409 }
    );
  }
  return { ...structuredClone(input), domain: pin.domain };
}

function mutationStateOf(value) {
  invariant(MUTATION_STATES.has(value), "invalid_domain_mutation_state", "invalid mutation state", {
    status: 400
  });
  return value;
}

function validatePriceConfirmation(value) {
  invariant(
    value && typeof value === "object",
    "domain_price_confirmation_required",
    "exact price confirmation is required",
    { status: 409 }
  );
  invariant(
    sameMoney(
      exactMoney(value.quotedPrice, "quotedPrice"),
      exactMoney(value.acceptedPrice, "acceptedPrice")
    ),
    "domain_provider_price_mismatch",
    "accepted price does not match provider quote",
    { status: 409 }
  );
  requiredString(value.quoteId, "priceConfirmation.quoteId", 256);
}

function held({
  provider,
  pin,
  operation,
  attemptId,
  operationId,
  effect,
  reason,
  reconciliationRequired,
  newPreflightRequired = false,
  error = null
}) {
  const target = pin
    ? { providerPin: pin }
    : { providerCode: provider.code, registrarOfRecord: provider.registrarOfRecord };
  return frozen({
    schema: DOMAIN_PROVIDER_OUTCOME_SCHEMA,
    status: "held",
    operation,
    ...target,
    attemptId: attemptId ?? null,
    operationId: operationId ?? null,
    effect: effect ?? null,
    reason,
    providerErrorCode: errorCode(error),
    reconciliationRequired,
    newPreflightRequired,
    automaticProviderSwitch: false
  });
}

function heldReconciliation(provider, operationId, reason, error = null) {
  return held({
    provider,
    operation: "reconcileRegistration",
    operationId,
    reason,
    reconciliationRequired: true,
    error
  });
}

function effectCertainty(error) {
  return error instanceof ExternalEffectError && error.certainty === "not_submitted"
    ? "not_submitted"
    : "uncertain";
}

function providerAttempt(provider, reason, error = null) {
  return Object.freeze({
    providerCode: provider.code,
    reason,
    providerErrorCode: errorCode(error)
  });
}

function providersUnavailable(providers, failures) {
  const attempts = failures.length
    ? failures
    : providers.map((provider) => providerAttempt(provider, "unavailable"));
  return new DomainError(
    "domain_providers_unavailable",
    "No configured healthy domain provider can safely complete preflight",
    { status: 503, details: { attempts: frozen(attempts) } }
  );
}

function errorCode(error) {
  return typeof error?.code === "string" && /^[a-zA-Z0-9_.-]{1,128}$/u.test(error.code)
    ? error.code
    : null;
}

function boundedString(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function optionalString(value, maximum) {
  return value === undefined || value === null ? null : boundedString(value, maximum);
}

function frozen(value) {
  return deepFreeze(structuredClone(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
