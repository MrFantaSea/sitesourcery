import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const ADJACENT_INTEGRATION_SCHEMA =
  "sitesourcery.adjacent-integration/v1";
export const ADJACENT_INTEGRATION_CONTRACT =
  "canonical-fin-004v-six-system-identity-snapshot-resolution-v1-held";
export const ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST =
  "3253dafa276acd700900c9f6b72c8b7e2bde9f7f2ce1e40318591859b4d7a6ec";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DIGEST_REFERENCE = /^sha256:[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SOURCE_REVISION = /^(git:[0-9a-f]{40}|sha256:[0-9a-f]{64})$/u;
const HUB_CLIENT = /^SSC-[0-9]{4}-[0-9]{3,}$/u;
const HUB_PROJECT = /^SS-[0-9]{4}-[0-9]{3,}$/u;
const OBSERVATION_STATES = new Set([
  "available", "unavailable", "matched", "changed", "held",
  "manual_review"
]);
const INITIAL_LINK_STATES = new Set(["manual_review", "conflict"]);

const SYSTEMS = deepFreeze({
  private_messenger: {
    global: { relay_service: ["availability"] },
    tenant: { organization: { encrypted_session_digest: "digest_only" } },
    observations: ["encrypted_session_summary"]
  },
  command_deck: {
    global: {
      service: ["availability", "status_snapshot", "backup_verification"]
    },
    tenant: {},
    observations: []
  },
  phone_bridge: {
    global: {
      identity_route: [
        "availability", "identity_route", "proxy_transport_status"
      ]
    },
    tenant: {},
    observations: []
  },
  client_profile_hub: {
    global: { service: ["availability", "registry_revision"] },
    tenant: {
      organization: { client: "hub_client_id" },
      project: { project: "hub_project_id" }
    },
    observations: ["identity_readback", "crm_revision", "activity_receipt"]
  },
  marketing_desk: {
    global: {
      prospect: ["prospect_revision"],
      campaign: ["campaign_status"],
      suppression: ["suppression"]
    },
    tenant: {
      engagement: { qualified_promotion: "digest_only" },
      direct_opportunity: { qualified_promotion: "digest_only" }
    },
    observations: ["promotion_receipt"]
  },
  dell_commercial_engine: {
    global: { catalog: ["catalog_readback"] },
    tenant: {
      project: {
        scope: "digest_only",
        quote: "digest_only",
        work_receipt: "digest_only"
      }
    },
    observations: ["scope_readback", "quote_readback", "work_receipt"]
  }
});

export const ADJACENT_INTEGRATION_SYSTEM_KEYS =
  deepFreeze(Object.keys(SYSTEMS));

function exactObject(value, keys, field) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "ADJACENT_INTEGRATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field, nullable = false) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "ADJACENT_INTEGRATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "ADJACENT_INTEGRATION_INVALID",
    `${field} must be an opaque lowercase SHA-256 digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && COMMAND_ID.test(value),
    "IDEMPOTENCY_KEY_REQUIRED",
    "A valid command ID is required.",
    { status: 400 }
  );
  return value;
}

function selectedSystem(value) {
  invariant(
    Object.hasOwn(SYSTEMS, value),
    "ADJACENT_INTEGRATION_INVALID",
    "Adjacent system is invalid.",
    { status: 400 }
  );
  return value;
}

function sourceRevision(value) {
  invariant(
    typeof value === "string" && SOURCE_REVISION.test(value),
    "ADJACENT_INTEGRATION_INVALID",
    "Source revision must be an exact Git or SHA-256 identity.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "ADJACENT_INTEGRATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    Number.isFinite(selected.getTime()),
    "ADJACENT_INTEGRATION_CONFIGURATION_REQUIRED",
    "Adjacent integration clock is invalid.",
    { status: 500 }
  );
  return selected.toISOString();
}

function idSource(ids) {
  invariant(
    ids && typeof ids.next === "function",
    "ADJACENT_INTEGRATION_CONFIGURATION_REQUIRED",
    "Adjacent integration ID source is required.",
    { status: 500 }
  );
  return ids;
}

function scope(input) {
  return {
    actorId: uuid(input.actorId, "Operator user ID"),
    operatorOrganizationId: uuid(
      input.operatorOrganizationId,
      "Operator organization ID"
    )
  };
}

function observationState(value) {
  invariant(
    OBSERVATION_STATES.has(value),
    "ADJACENT_INTEGRATION_INVALID",
    "Observation state is invalid.",
    { status: 400 }
  );
  return value;
}

function digestReference(value, field) {
  invariant(
    typeof value === "string" && DIGEST_REFERENCE.test(value),
    "ADJACENT_INTEGRATION_INVALID",
    `${field} must be digest-only.`,
    { status: 400 }
  );
  return value;
}

function exactRemoteReference(value, policy) {
  if (policy === "digest_only") {
    return digestReference(value, "Remote reference");
  }
  const pattern = policy === "hub_client_id" ? HUB_CLIENT : HUB_PROJECT;
  invariant(
    typeof value === "string" && pattern.test(value),
    "ADJACENT_INTEGRATION_INVALID",
    "Hub reference is not canonical.",
    { status: 400 }
  );
  return value;
}

function semanticLock(kind, value) {
  return `adjacent:${kind}:${digest(value)}`;
}

function snapshotInput(value, clock, ids) {
  exactObject(value, [
    "actorId", "commandId", "observationKind", "observationState",
    "operatorOrganizationId", "remoteEntityKind", "remoteReference",
    "sourceObservedAt", "sourcePayloadDigest", "sourceRevision", "systemKey"
  ], "Adjacent global snapshot");
  const selected = {
    ...scope(value),
    id: uuid(ids.next(), "Snapshot ID"),
    commandId: commandId(value.commandId),
    systemKey: selectedSystem(value.systemKey),
    remoteEntityKind: value.remoteEntityKind,
    remoteReference: digestReference(
      value.remoteReference,
      "Global source reference"
    ),
    observationKind: value.observationKind,
    observationState: observationState(value.observationState),
    sourceRevision: sourceRevision(value.sourceRevision),
    sourcePayloadDigest: sha256(
      value.sourcePayloadDigest,
      "Source payload digest"
    ),
    sourceObservedAt: instant(value.sourceObservedAt, "Source observation time"),
    recordedAt: now(clock)
  };
  invariant(
    SYSTEMS[selected.systemKey].global[selected.remoteEntityKind]?.includes(
      selected.observationKind
    ) === true,
    "ADJACENT_INTEGRATION_INVALID",
    "Global snapshot kind conflicts with its system contract.",
    { status: 400 }
  );
  selected.semanticLock = semanticLock("snapshot", {
    systemKey: selected.systemKey,
    remoteEntityKind: selected.remoteEntityKind,
    remoteReference: selected.remoteReference,
    observationKind: selected.observationKind,
    observationState: selected.observationState,
    sourceRevision: selected.sourceRevision,
    sourcePayloadDigest: selected.sourcePayloadDigest,
    sourceObservedAt: selected.sourceObservedAt
  });
  return deepFreeze(selected);
}

function crosswalkInput(value, clock, ids) {
  exactObject(value, [
    "actorId", "commandId", "localEntityId", "localEntityKind",
    "operatorOrganizationId", "projectId", "referencePolicy",
    "remoteEntityKind", "remoteReference", "sourceEvidenceDigest",
    "sourceRevision", "sourceSnapshotId", "state", "supersedesCrosswalkId",
    "systemKey"
  ], "Adjacent crosswalk");
  const selected = {
    ...scope(value),
    id: uuid(ids.next(), "Crosswalk ID"),
    commandId: commandId(value.commandId),
    organizationId: uuid(
      value.operatorOrganizationId,
      "Crosswalk organization ID"
    ),
    projectId: uuid(value.projectId, "Crosswalk project ID", true),
    systemKey: selectedSystem(value.systemKey),
    sourceSnapshotId: uuid(value.sourceSnapshotId, "Source snapshot ID"),
    localEntityKind: value.localEntityKind,
    localEntityId: uuid(value.localEntityId, "Local entity ID"),
    remoteEntityKind: value.remoteEntityKind,
    referencePolicy: value.referencePolicy,
    sourceRevision: sourceRevision(value.sourceRevision),
    sourceEvidenceDigest: sha256(
      value.sourceEvidenceDigest,
      "Source evidence digest"
    ),
    supersedesCrosswalkId: uuid(
      value.supersedesCrosswalkId,
      "Superseded crosswalk ID",
      true
    ),
    state: value.state,
    recordedAt: now(clock)
  };
  const policy = SYSTEMS[selected.systemKey]
    .tenant[selected.localEntityKind]?.[selected.remoteEntityKind];
  invariant(
    policy !== undefined && policy === selected.referencePolicy &&
      INITIAL_LINK_STATES.has(selected.state),
    "ADJACENT_INTEGRATION_INVALID",
    "Crosswalk kind or initial state conflicts with its system contract.",
    { status: 400 }
  );
  selected.remoteReference = exactRemoteReference(
    value.remoteReference,
    policy
  );
  selected.semanticLock = semanticLock("crosswalk", {
    organizationId: selected.organizationId,
    projectId: selected.projectId,
    systemKey: selected.systemKey,
    sourceSnapshotId: selected.sourceSnapshotId,
    localEntityKind: selected.localEntityKind,
    localEntityId: selected.localEntityId,
    remoteEntityKind: selected.remoteEntityKind,
    remoteReference: selected.remoteReference,
    sourceRevision: selected.sourceRevision,
    sourceEvidenceDigest: selected.sourceEvidenceDigest
  });
  return deepFreeze(selected);
}

function tenantObservationInput(value, clock, ids) {
  exactObject(value, [
    "actorId", "commandId", "crosswalkId", "observationKind",
    "observationState", "operatorOrganizationId", "projectId",
    "sourceObservedAt", "sourcePayloadDigest", "sourceRevision",
    "sourceSnapshotId", "systemKey"
  ], "Adjacent tenant observation");
  const selected = {
    ...scope(value),
    id: uuid(ids.next(), "Observation ID"),
    commandId: commandId(value.commandId),
    crosswalkId: uuid(value.crosswalkId, "Crosswalk ID"),
    sourceSnapshotId: uuid(value.sourceSnapshotId, "Source snapshot ID"),
    organizationId: uuid(
      value.operatorOrganizationId,
      "Observation organization ID"
    ),
    projectId: uuid(value.projectId, "Observation project ID", true),
    systemKey: selectedSystem(value.systemKey),
    observationKind: value.observationKind,
    observationState: observationState(value.observationState),
    sourceRevision: sourceRevision(value.sourceRevision),
    sourcePayloadDigest: sha256(
      value.sourcePayloadDigest,
      "Source payload digest"
    ),
    sourceObservedAt: instant(value.sourceObservedAt, "Source event time"),
    recordedAt: now(clock)
  };
  invariant(
    SYSTEMS[selected.systemKey].observations.includes(
      selected.observationKind
    ),
    "ADJACENT_INTEGRATION_INVALID",
    "Tenant observation kind conflicts with its system contract.",
    { status: 400 }
  );
  selected.semanticLock = semanticLock("observation", {
    crosswalkId: selected.crosswalkId,
    sourceSnapshotId: selected.sourceSnapshotId,
    observationKind: selected.observationKind,
    observationState: selected.observationState,
    sourceRevision: selected.sourceRevision,
    sourcePayloadDigest: selected.sourcePayloadDigest,
    sourceObservedAt: selected.sourceObservedAt
  });
  return deepFreeze(selected);
}

function resolutionInput(value, clock, ids) {
  exactObject(value, [
    "actorId", "commandId", "crosswalkId", "expectedCrosswalkRequestDigest",
    "expectedCrosswalkRevision", "operatorOrganizationId", "priorState",
    "resolutionEvidenceDigest", "resolutionKind", "resultingState", "systemKey"
  ], "Adjacent crosswalk resolution");
  const selected = {
    ...scope(value),
    id: uuid(ids.next(), "Resolution ID"),
    commandId: commandId(value.commandId),
    crosswalkId: uuid(value.crosswalkId, "Crosswalk ID"),
    organizationId: uuid(
      value.operatorOrganizationId,
      "Resolution organization ID"
    ),
    systemKey: selectedSystem(value.systemKey),
    expectedCrosswalkRequestDigest: sha256(
      value.expectedCrosswalkRequestDigest,
      "Expected crosswalk request digest"
    ),
    expectedCrosswalkRevision: value.expectedCrosswalkRevision,
    priorState: value.priorState,
    resolutionKind: value.resolutionKind,
    resultingState: value.resultingState,
    resolutionEvidenceDigest: sha256(
      value.resolutionEvidenceDigest,
      "Resolution evidence digest"
    ),
    recordedAt: now(clock)
  };
  invariant(
    Number.isSafeInteger(selected.expectedCrosswalkRevision) &&
      selected.expectedCrosswalkRevision > 0,
    "ADJACENT_INTEGRATION_INVALID",
    "Expected crosswalk revision is invalid.",
    { status: 400 }
  );
  const transition = `${selected.priorState}:${selected.resolutionKind}:${selected.resultingState}`;
  invariant(
    new Set([
      "manual_review:operator_confirm_link:linked",
      "conflict:operator_confirm_link:linked",
      "manual_review:operator_reject_link:superseded",
      "conflict:operator_reject_link:superseded",
      "linked:operator_supersede_link:superseded",
      "conflict:operator_supersede_link:superseded",
      "linked:operator_flag_conflict:conflict"
    ]).has(transition),
    "ADJACENT_INTEGRATION_INVALID",
    "Crosswalk resolution transition is invalid.",
    { status: 400 }
  );
  selected.semanticLock = semanticLock("resolution", {
    crosswalkId: selected.crosswalkId,
    expectedCrosswalkRequestDigest: selected.expectedCrosswalkRequestDigest,
    expectedCrosswalkRevision: selected.expectedCrosswalkRevision,
    priorState: selected.priorState,
    resolutionKind: selected.resolutionKind,
    resultingState: selected.resultingState,
    resolutionEvidenceDigest: selected.resolutionEvidenceDigest
  });
  return deepFreeze(selected);
}

export function createAdjacentIntegrationService({
  repository,
  clock,
  ids
} = {}) {
  invariant(
    repository && [
      "readiness", "listContracts", "listTrace", "recordGlobalSnapshot",
      "recordCrosswalk", "recordObservation", "resolveCrosswalk"
    ].every((method) => typeof repository[method] === "function") &&
      clock && (typeof clock === "function" || typeof clock.now === "function"),
    "ADJACENT_INTEGRATION_CONFIGURATION_REQUIRED",
    "Adjacent integration repository and clock are required.",
    { status: 500 }
  );
  const selectedIds = idSource(ids);
  return Object.freeze({
    kind: "adjacent-integration",
    mode: "manual-read-only",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false,
    systems: ADJACENT_INTEGRATION_SYSTEM_KEYS,
    readiness: () => repository.readiness(),
    listContracts(input = {}) {
      exactObject(input, ["actorId", "operatorOrganizationId"], "Operator scope");
      return repository.listContracts(scope(input));
    },
    listTrace(input = {}) {
      const keys = Object.keys(input).sort();
      invariant(
        canonicalJson(keys) === canonicalJson([
          "actorId", "operatorOrganizationId", "projectId", "systemKey"
        ].sort()) || canonicalJson(keys) === canonicalJson([
          "actorId", "crosswalkId", "operatorOrganizationId", "projectId",
          "systemKey"
        ].sort()),
        "ADJACENT_INTEGRATION_INVALID",
        "Adjacent trace query is invalid.",
        { status: 400 }
      );
      return repository.listTrace({
        ...scope(input),
        crosswalkId: uuid(input.crosswalkId ?? null, "Trace crosswalk ID", true),
        projectId: uuid(input.projectId, "Trace project ID", true),
        systemKey: input.systemKey === null
          ? null
          : selectedSystem(input.systemKey)
      });
    },
    recordGlobalSnapshot(input) {
      return repository.recordGlobalSnapshot(
        snapshotInput(input, clock, selectedIds)
      );
    },
    recordCrosswalk(input) {
      return repository.recordCrosswalk(
        crosswalkInput(input, clock, selectedIds)
      );
    },
    recordObservation(input) {
      return repository.recordObservation(
        tenantObservationInput(input, clock, selectedIds)
      );
    },
    resolveCrosswalk(input) {
      return repository.resolveCrosswalk(
        resolutionInput(input, clock, selectedIds)
      );
    }
  });
}

export function createHeldAdjacentIntegration() {
  const unavailable = () => {
    throw new HostedError(
      "ADJACENT_INTEGRATION_HELD",
      "Adjacent integration is not connected to canonical PostgreSQL.",
      {
        status: 503,
        details: {
          remoteWrites: false,
          providerEffects: false,
          automaticCommands: false
        }
      }
    );
  };
  return Object.freeze({
    kind: "adjacent-integration",
    mode: "held",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false,
    systems: ADJACENT_INTEGRATION_SYSTEM_KEYS,
    readiness: async () => deepFreeze({
      ready: false,
      verified: false,
      kind: "adjacent-integration-postgres",
      code: "ADJACENT_INTEGRATION_HELD",
      systems: ADJACENT_INTEGRATION_SYSTEM_KEYS,
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    }),
    listContracts: unavailable,
    listTrace: unavailable,
    recordGlobalSnapshot: unavailable,
    recordCrosswalk: unavailable,
    recordObservation: unavailable,
    resolveCrosswalk: unavailable
  });
}
