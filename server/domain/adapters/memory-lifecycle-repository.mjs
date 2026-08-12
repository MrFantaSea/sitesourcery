import { normalizeDomain, requiredString } from "../canonical.mjs";
import { invariant } from "../errors.mjs";

function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
}

function keyOf({ organizationId, projectId, domain }) {
  return [
    requiredString(organizationId, "organizationId", 128),
    requiredString(projectId, "projectId", 128),
    normalizeDomain(domain)
  ].join(":");
}

export function createMemoryDomainLifecycleRepository() {
  const states = new Map();
  const commands = new Map();

  async function transact({
    scope,
    domain,
    commandId,
    commandFingerprint,
    initialize = null,
    apply
  } = {}) {
    const stateKey = keyOf({
      organizationId: scope?.organizationId,
      projectId: scope?.projectId,
      domain
    });
    const id = requiredString(commandId, "commandId", 200);
    const fingerprint = requiredString(
      commandFingerprint,
      "commandFingerprint",
      64
    );
    invariant(
      /^[a-f0-9]{64}$/u.test(fingerprint),
      "invalid_lifecycle_command",
      "command fingerprint is invalid",
      { status: 400 }
    );
    invariant(typeof apply === "function", "invalid_lifecycle_repository", "apply is required", {
      status: 500
    });
    const commandKey = `${stateKey}:${id}`;
    const prior = commands.get(commandKey);
    if (prior) {
      invariant(
        prior.fingerprint === fingerprint,
        "lifecycle_idempotency_conflict",
        "command ID was reused with different lifecycle input",
        { status: 409 }
      );
      return Object.freeze({ replayed: true, result: clone(prior.result) });
    }
    let current = states.get(stateKey) ?? null;
    if (current === null && typeof initialize === "function") {
      current = await initialize();
    }
    const draft = clone(current);
    const applied = await apply(draft);
    invariant(
      applied && typeof applied === "object" && applied.state && applied.result,
      "invalid_lifecycle_repository",
      "lifecycle transaction returned invalid state",
      { status: 500 }
    );
    states.set(stateKey, clone(applied.state));
    commands.set(commandKey, Object.freeze({
      fingerprint,
      result: clone(applied.result)
    }));
    return Object.freeze({ replayed: false, result: clone(applied.result) });
  }

  async function read({ scope, domain } = {}) {
    const selected = states.get(keyOf({
      organizationId: scope?.organizationId,
      projectId: scope?.projectId,
      domain
    }));
    invariant(
      selected,
      "lifecycle_not_found",
      "domain lifecycle state was not found",
      { status: 404 }
    );
    return clone(selected);
  }

  async function inspect({ organizationId, projectId, domain } = {}) {
    const selected = states.get(keyOf({ organizationId, projectId, domain }));
    return clone(selected ?? null);
  }

  async function readiness() {
    return Object.freeze({
      ready: true,
      mode: "memory_test_only",
      canonicalPersistence: false,
      providerEffects: false,
      paymentEffects: false,
      dnsEffects: false
    });
  }

  return Object.freeze({ transact, read, inspect, readiness });
}
