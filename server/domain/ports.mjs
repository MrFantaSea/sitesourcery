import { requiredString } from "./canonical.mjs";
import { invariant } from "./errors.mjs";
import { createDomainProviderContingency } from "./provider-contingency.mjs";

const REQUIRED = Object.freeze({
  repository: [
    "claimCommand",
    "finishCommand",
    "createOrder",
    "getOrder",
    "commit",
    "listAudit",
    "listOutbox"
  ],
  payments: ["authorize", "voidAuthorization", "capture", "refund"],
  secrets: ["issueOneTime"],
  clock: ["now"],
  ids: ["next"]
});

const REQUIRED_REGISTRAR = Object.freeze([
  "ensureContacts",
  "previewRegistration",
  "confirmRegistration",
  "getOperation",
  "getDomain",
  "assessTransferOut",
  "setTransferLock",
  "getAuthCode"
]);

/**
 * Validates the ordinary ports and composes exactly two registrar slots around
 * the reviewed contingency boundary. `ports.registrar` remains a temporary
 * compatibility input for isolated adapter proofs; production composition
 * should provide `ports.registrarProviders` explicitly.
 */
export function validatePorts(ports, { legacyRegistrarOfRecord = "Configured registrar" } = {}) {
  invariant(ports && typeof ports === "object", "invalid_ports", "ports are required", {
    status: 500
  });
  for (const [name, methods] of Object.entries(REQUIRED)) {
    invariant(ports[name], "invalid_ports", `missing port ${name}`, { status: 500 });
    for (const method of methods) {
      invariant(
        typeof ports[name][method] === "function",
        "invalid_ports",
        `missing port method ${name}.${method}`,
        { status: 500 }
      );
    }
  }
  const registrarProviders = normalizeRegistrarProviders(ports, legacyRegistrarOfRecord);
  return Object.freeze({ ...ports, registrarProviders });
}

function normalizeRegistrarProviders(ports, legacyRegistrarOfRecord) {
  const supplied = ports.registrarProviders ?? legacyRegistrarProviders(
    ports.registrar,
    legacyRegistrarOfRecord
  );
  invariant(
    supplied && typeof supplied === "object",
    "invalid_ports",
    "missing port registrarProviders",
    { status: 500 }
  );
  const primary = providerSlot(supplied.primary, "registrarProviders.primary");
  const secondary = providerSlot(supplied.secondary, "registrarProviders.secondary");
  invariant(
    primary.code !== secondary.code,
    "invalid_ports",
    "registrar provider codes must be unique",
    { status: 500 }
  );
  const slots = Object.freeze([primary, secondary]);
  const byCode = new Map(slots.map((slot) => [slot.code, slot]));
  const preference = normalizePreference(
    supplied.preference ?? slots.map((slot) => slot.code),
    byCode
  );
  const routed = slots.map((slot) => ({
    code: slot.code,
    registrarOfRecord: slot.registrarOfRecord,
    configured: slot.configured,
    healthy: slot.healthy,
    registrar: routingRegistrar(slot.registrar)
  }));
  const contingency = createDomainProviderContingency({
    primary: routed[0],
    secondary: routed[1],
    preference
  });

  return Object.freeze({
    primary,
    secondary,
    preference,
    contingency,
    get(providerCode) {
      const code = providerCodeValue(providerCode, "providerCode");
      const slot = byCode.get(code);
      invariant(slot, "unknown_domain_provider", "domain provider is unknown", { status: 500 });
      return slot;
    }
  });
}

function legacyRegistrarProviders(registrar, registrarOfRecord) {
  invariant(
    registrar && typeof registrar === "object",
    "invalid_ports",
    "missing port registrarProviders",
    { status: 500 }
  );
  const primaryCode = providerCodeValue(registrar.providerCode ?? "spaceship", "registrar.providerCode");
  const heldCode = primaryCode === "contingency_held" ? "contingency_backup_held" : "contingency_held";
  return {
    primary: {
      code: primaryCode,
      registrarOfRecord: requiredString(registrarOfRecord, "legacyRegistrarOfRecord", 128),
      configured: true,
      healthy: true,
      registrar
    },
    secondary: {
      code: heldCode,
      registrarOfRecord: "Secondary registrar (held)",
      configured: false,
      healthy: false,
      registrar: Object.freeze({})
    },
    preference: [primaryCode, heldCode]
  };
}

function providerSlot(value, label) {
  invariant(value && typeof value === "object", "invalid_ports", `${label} is required`, {
    status: 500
  });
  const code = providerCodeValue(value.code, `${label}.code`);
  const registrarOfRecord = requiredString(
    value.registrarOfRecord,
    `${label}.registrarOfRecord`,
    128
  );
  const configured = value.configured === true;
  const healthy = value.healthy === true;
  invariant(
    configured || !healthy,
    "invalid_ports",
    `${label} cannot be healthy while unconfigured`,
    { status: 500 }
  );
  const registrar = value.registrar ?? Object.freeze({});
  invariant(
    registrar && typeof registrar === "object",
    "invalid_ports",
    `${label}.registrar is invalid`,
    { status: 500 }
  );
  if (configured) {
    for (const method of REQUIRED_REGISTRAR) {
      invariant(
        typeof registrar[method] === "function",
        "invalid_ports",
        `missing port method ${label}.registrar.${method}`,
        { status: 500 }
      );
    }
    if (registrar.providerCode !== undefined) {
      invariant(
        registrar.providerCode === code,
        "invalid_ports",
        `${label} code does not match its registrar adapter`,
        { status: 500 }
      );
    }
  }
  return Object.freeze({ code, registrarOfRecord, configured, healthy, registrar });
}

function normalizePreference(value, byCode) {
  invariant(
    Array.isArray(value) && value.length === 2 && new Set(value).size === 2,
    "invalid_ports",
    "registrar provider preference must name both slots",
    { status: 500 }
  );
  const normalized = value.map((entry) => providerCodeValue(entry, "registrarProviders.preference"));
  invariant(
    normalized.every((code) => byCode.has(code)),
    "invalid_ports",
    "registrar provider preference contains an unknown provider",
    { status: 500 }
  );
  return Object.freeze(normalized);
}

function providerCodeValue(value, label) {
  const code = requiredString(value, label, 64);
  invariant(
    /^[a-z][a-z0-9_-]{1,63}$/u.test(code),
    "invalid_ports",
    `${label} is invalid`,
    { status: 500 }
  );
  return code;
}

function routingRegistrar(registrar) {
  const facade = {};
  const routedMethods = new Set([
    ...Object.keys(registrar),
    ...REQUIRED_REGISTRAR,
    "quoteRegistration",
    "getNameservers",
    "setNameservers",
    "listDnsRecords",
    "saveDnsRecords",
    "deleteDnsRecords",
    "renewDomain",
    "submitTransfer"
  ]);
  for (const key of routedMethods) {
    const value = registrar[key];
    if (value !== undefined) {
      facade[key] = typeof value === "function" ? value.bind(registrar) : value;
    }
  }
  if (typeof registrar.previewRegistration === "function") {
    facade.previewRegistration = async (input = {}) => {
      if (
        (input.contacts === undefined || input.contacts === null) &&
        typeof registrar.quoteRegistration === "function"
      ) {
        return registrar.quoteRegistration(input);
      }
      return registrar.previewRegistration(input);
    };
  }
  return Object.freeze(facade);
}
