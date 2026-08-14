import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  ADJACENT_INTEGRATION_CONTRACT,
  ADJACENT_INTEGRATION_SYSTEM_KEYS,
  ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST
} from "./adjacent-integration.mjs";

const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const SHA256 = /^[0-9a-f]{64}$/u;

function configured(value) {
  invariant(
    value && typeof value.service === "function",
    "ADJACENT_INTEGRATION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for adjacent integration.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "ADJACENT_INTEGRATION_UNAVAILABLE",
      "Adjacent integration evidence is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "ADJACENT_INTEGRATION_RETRY_REQUIRED",
      "Adjacent evidence changed; refresh and retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "ADJACENT_INTEGRATION_CONFLICT",
      "Adjacent integration rejected conflicting identity or evidence.",
      { status: 409 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translatedError(error);
  }
}

function operatorActor(input, readOnly = true) {
  return {
    actorKind: "operator",
    userId: input.actorId,
    organizationId: input.operatorOrganizationId,
    isolation: "serializable",
    readOnly
  };
}

function systemActor(input) {
  return {
    actorKind: "system",
    userId: input.actorId,
    organizationId: null,
    isolation: "serializable"
  };
}

async function requireCapability(client, input) {
  const result = await client.query(
    `select
       ss.service_operator_has_capability(
         $1, 'service_management_manage', clock_timestamp()
       )
       and exists (
         select 1
           from ss.organizations organization
           join ss.organization_memberships membership
             on membership.organization_id = organization.id
            and membership.user_id = $1
          where organization.id = $2
            and organization.state = 'active'
            and membership.state = 'active'
       ) as allowed`,
    [input.actorId, input.operatorOrganizationId]
  );
  invariant(
    result.rows[0]?.allowed === true,
    "ADJACENT_INTEGRATION_UNAVAILABLE",
    "Adjacent integration evidence is unavailable.",
    { status: 404 }
  );
}

async function locks(client, commandId, semanticDigest) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`adjacent:command:${commandId}`]
  );
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`adjacent:semantic:${semanticDigest}`]
  );
}

function iso(value) {
  return value === null || value === undefined
    ? null
    : value instanceof Date ? value.toISOString() : String(value);
}

function receipt(kind, row, replay) {
  const crosswalkCreation = kind === "crosswalk";
  return deepFreeze({
    schema: `sitesourcery.adjacent-${kind}-receipt/v1`,
    id: row.id,
    commandId: row.command_id,
    requestDigest: row.request_digest,
    semanticEvidenceDigest: row.semantic_evidence_digest,
    systemKey: row.system_key,
    organizationId: row.organization_id ??
      row.operator_organization_id ?? null,
    projectId: row.project_id ?? null,
    state: crosswalkCreation
      ? row.initial_state
      : row.state ?? row.observation_state ?? row.resulting_state ?? null,
    revision: crosswalkCreation
      ? 1
      : row.revision === undefined ? null : Number(row.revision),
    recordedAt: iso(row.recorded_at),
    replay,
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  });
}

function resolutionReceipt(row, replay) {
  return deepFreeze({
    ...receipt("resolution", row, replay),
    crosswalkState: row.resulting_state,
    crosswalkRevision: Number(row.expected_crosswalk_revision) + 1,
    crosswalkUpdatedAt: iso(row.recorded_at)
  });
}

function sameCommandOrSemantic(rows, input, semanticDigest) {
  if (rows.length === 0) return null;
  invariant(
    rows.length === 1 &&
      rows[0].semantic_evidence_digest === semanticDigest &&
      (rows[0].command_id === input.commandId ||
        rows[0].semantic_evidence_digest === semanticDigest),
    "ADJACENT_INTEGRATION_IDEMPOTENCY_CONFLICT",
    "Command or semantic evidence was reused for different facts.",
    { status: 409 }
  );
  return rows[0];
}

function contract(row) {
  return deepFreeze({
    systemKey: row.system_key,
    authorityOwner: row.authority_owner,
    readEventDirection: row.read_event_direction,
    writeEffectDirection: row.write_effect_direction,
    authenticationBoundary: row.authentication_boundary,
    identityScopePolicy: row.identity_scope_policy,
    semanticIdempotencyPolicy: row.semantic_idempotency_policy,
    conflictOwner: row.conflict_owner,
    retryPolicy: row.retry_policy,
    reconciliationPolicy: row.reconciliation_policy,
    auditPolicy: row.audit_policy,
    failureBehavior: row.failure_behavior,
    heldBehavior: row.held_behavior,
    adapterMode: row.adapter_mode,
    automaticCommands: false,
    remoteWrites: false,
    providerEffects: false,
    contractRevision: Number(row.contract_revision)
  });
}

function crosswalk(row) {
  return deepFreeze({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    systemKey: row.system_key,
    sourceSnapshotId: row.source_snapshot_id,
    localEntityKind: row.local_entity_kind,
    localEntityId: row.local_entity_id,
    remoteEntityKind: row.remote_entity_kind,
    safeRemoteReference: row.safe_remote_reference,
    remoteReferenceDigest: row.remote_reference_digest,
    sourceRevisionDigest: row.source_revision_digest,
    provenanceDigest: row.provenance_digest,
    state: row.state,
    supersedesCrosswalkId: row.supersedes_crosswalk_id,
    revision: Number(row.revision),
    requestDigest: row.request_digest,
    recordedAt: iso(row.recorded_at),
    updatedAt: iso(row.updated_at)
  });
}

function observation(row) {
  return deepFreeze({
    id: row.id,
    crosswalkId: row.crosswalk_id,
    sourceSnapshotId: row.source_snapshot_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    systemKey: row.system_key,
    observationKind: row.observation_kind,
    observationState: row.observation_state,
    payloadDigest: row.payload_digest,
    provenanceDigest: row.provenance_digest,
    sourceObservedAt: iso(row.source_observed_at),
    recordedAt: iso(row.recorded_at)
  });
}

function snapshot(row) {
  return deepFreeze({
    id: row.id,
    systemKey: row.system_key,
    remoteEntityKind: row.remote_entity_kind,
    remoteReferenceDigest: row.remote_reference_digest,
    observationKind: row.observation_kind,
    observationState: row.observation_state,
    payloadDigest: row.payload_digest,
    provenanceDigest: row.provenance_digest,
    sourceObservedAt: iso(row.source_observed_at),
    recordedAt: iso(row.recorded_at)
  });
}

export function createPostgresAdjacentIntegrationRepository({ authority } = {}) {
  const database = configured(authority);
  return Object.freeze({
    kind: "adjacent-integration-postgres",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false,

    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.adjacent_integration_crosswalks_contract_v1()'
              ) is not null
              and ss.adjacent_integration_crosswalks_contract_v1() = $1
                as contract_ready,
              ss.adjacent_integration_contract_count_v1() = 6
                as contract_count_ready,
              (select count(*) = 16
                 from ss.adjacent_integration_identity_pairs)
                as pair_count_ready,
              (select count(*) = 21
                 from ss.adjacent_integration_observation_contracts)
                as observation_count_ready,
              ss.adjacent_integration_system_contracts_digest_v1()
                as contract_digest,
              ss.adjacent_integration_system_contracts_digest_v1() = $3
                as contract_digest_ready,
              count(*) = 7 as tables_ready,
              bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
                as rls_ready
            from pg_class relation
            join pg_namespace namespace
              on namespace.oid = relation.relnamespace
           where namespace.nspname = 'ss'
             and relation.relname = any($2::text[])
          `, [ADJACENT_INTEGRATION_CONTRACT, [
            "adjacent_integration_system_contracts",
            "adjacent_integration_identity_pairs",
            "adjacent_integration_observation_contracts",
            "adjacent_integration_crosswalks",
            "adjacent_integration_observations",
            "adjacent_integration_global_snapshots",
            "adjacent_integration_crosswalk_resolutions"
          ], ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.contract_count_ready === true && row.pair_count_ready === true &&
          row.observation_count_ready === true && row.tables_ready === true &&
          row.rls_ready === true && row.contract_digest_ready === true &&
          SHA256.test(row.contract_digest ?? "");
        return deepFreeze({
          ready,
          verified: ready,
          kind: "adjacent-integration-postgres",
          code: ready ? null : "ADJACENT_INTEGRATION_NOT_MIGRATED",
          contractDigest: ready ? row.contract_digest : null,
          systems: ADJACENT_INTEGRATION_SYSTEM_KEYS,
          mode: "manual-read-only",
          remoteWrites: false,
          providerEffects: false,
          automaticCommands: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "adjacent-integration-postgres",
          code: "ADJACENT_INTEGRATION_DATABASE_UNAVAILABLE",
          contractDigest: null,
          systems: ADJACENT_INTEGRATION_SYSTEM_KEYS,
          mode: "held",
          remoteWrites: false,
          providerEffects: false,
          automaticCommands: false
        });
      }
    },

    listContracts(input) {
      return translated(() => database.service(
        operatorActor(input),
        async (client) => {
          await requireCapability(client, input);
          const result = await client.query(
            `select *
               from ss.operator_adjacent_integration_contracts_v1()`
          );
          invariant(
            result.rowCount === 6,
            "ADJACENT_INTEGRATION_CONFLICT",
            "The exact adjacent system contract set is unavailable.",
            { status: 409 }
          );
          return deepFreeze({
            schema: "sitesourcery.adjacent-contracts/v1",
            systems: result.rows.map(contract),
            mode: "manual-read-only",
            remoteWrites: false,
            providerEffects: false,
            automaticCommands: false
          });
        }
      ));
    },

    listTrace(input) {
      return translated(() => database.service(
        operatorActor(input),
        async (client) => {
          await requireCapability(client, input);
          const values = [
            input.operatorOrganizationId,
            input.projectId,
            input.systemKey,
            input.crosswalkId
          ];
          const trace = await client.query(
            `select ss.operator_adjacent_integration_trace_v1(
               $1::uuid, $2::text, $3::uuid
             ) as payload`,
            values.slice(1)
          );
          const payload = trace.rows[0]?.payload ?? {};
          const exactSnapshotId = input.crosswalkId === null
            ? null
            : payload.crosswalks?.[0]?.source_snapshot_id ?? null;
          const snapshots = await client.query(
            `select * from
               ss.operator_adjacent_integration_global_snapshots_v1($1, $2)`,
            [input.systemKey, exactSnapshotId]
          );
          return deepFreeze({
            schema: "sitesourcery.adjacent-trace/v1",
            organizationId: input.operatorOrganizationId,
            projectId: input.projectId,
            systemKey: input.systemKey,
            crosswalks: (payload.crosswalks ?? []).map(crosswalk),
            observations: (payload.observations ?? []).map(observation),
            sourceSnapshots: snapshots.rows.map(snapshot),
            remoteWrites: false,
            providerEffects: false,
            automaticCommands: false
          });
        }
      ));
    },

    recordGlobalSnapshot(input) {
      return translated(() => database.service(
        systemActor(input),
        async (client) => {
          await requireCapability(client, input);
          const digestResult = await client.query(
            `select ss.adjacent_integration_global_snapshot_digest_for_actor_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
             ) as semantic_digest`,
            [input.systemKey, input.remoteEntityKind, input.remoteReference,
              input.observationKind, input.observationState,
              input.sourceRevision, input.sourcePayloadDigest,
              input.sourceObservedAt, input.operatorOrganizationId,
              input.actorId]
          );
          const semanticDigest = digestResult.rows[0].semantic_digest;
          await locks(client, input.commandId, semanticDigest);
          const prior = await client.query(
            `select * from ss.adjacent_integration_global_snapshots
              where command_id = $1 or semantic_evidence_digest = $2`,
            [input.commandId, semanticDigest]
          );
          const replay = sameCommandOrSemantic(
            prior.rows, input, semanticDigest
          );
          if (replay) return receipt("snapshot", replay, true);
          const inserted = await client.query(
            `select * from ss.record_adjacent_integration_global_snapshot_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
             )`,
            [input.id, input.commandId, input.systemKey,
              input.remoteEntityKind, input.remoteReference,
              input.observationKind, input.observationState,
              input.sourceRevision, input.sourcePayloadDigest,
              input.sourceObservedAt, input.operatorOrganizationId,
              input.actorId, input.recordedAt]
          );
          return receipt("snapshot", inserted.rows[0], false);
        }
      ));
    },

    recordCrosswalk(input) {
      return translated(() => database.service(
        systemActor(input),
        async (client) => {
          await requireCapability(client, input);
          const digestResult = await client.query(
            `select ss.adjacent_integration_crosswalk_digest_for_actor_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
             ) as semantic_digest`,
            [input.organizationId, input.projectId, input.systemKey,
              input.sourceSnapshotId, input.localEntityKind,
              input.localEntityId, input.remoteEntityKind,
              input.remoteReference, input.sourceRevision,
              input.sourceEvidenceDigest, input.supersedesCrosswalkId,
              input.state, input.actorId]
          );
          const semanticDigest = digestResult.rows[0].semantic_digest;
          await locks(client, input.commandId, semanticDigest);
          const prior = await client.query(
            `select * from ss.adjacent_integration_crosswalks
              where command_id = $1 or semantic_evidence_digest = $2`,
            [input.commandId, semanticDigest]
          );
          const replay = sameCommandOrSemantic(
            prior.rows, input, semanticDigest
          );
          if (replay) return receipt("crosswalk", replay, true);
          const inserted = await client.query(
            `select * from ss.record_adjacent_integration_crosswalk_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
             )`,
            [input.id, input.commandId, input.organizationId, input.projectId,
              input.systemKey, input.sourceSnapshotId, input.localEntityKind,
              input.localEntityId, input.remoteEntityKind,
              input.referencePolicy, input.remoteReference,
              input.sourceRevision, input.sourceEvidenceDigest,
              input.supersedesCrosswalkId, input.state, input.actorId,
              input.recordedAt]
          );
          return receipt("crosswalk", inserted.rows[0], false);
        }
      ));
    },

    recordObservation(input) {
      return translated(() => database.service(
        systemActor(input),
        async (client) => {
          await requireCapability(client, input);
          const digestResult = await client.query(
            `select ss.adjacent_integration_observation_digest_for_actor_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
             ) as semantic_digest`,
            [input.crosswalkId, input.sourceSnapshotId, input.organizationId,
              input.systemKey, input.observationKind, input.observationState,
              input.sourceRevision, input.sourcePayloadDigest,
              input.sourceObservedAt, input.actorId]
          );
          const semanticDigest = digestResult.rows[0].semantic_digest;
          await locks(client, input.commandId, semanticDigest);
          const prior = await client.query(
            `select * from ss.adjacent_integration_observations
              where command_id = $1 or semantic_evidence_digest = $2`,
            [input.commandId, semanticDigest]
          );
          const replay = sameCommandOrSemantic(
            prior.rows, input, semanticDigest
          );
          if (replay) return receipt("observation", replay, true);
          const inserted = await client.query(
            `select * from ss.record_adjacent_integration_observation_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
             )`,
            [input.id, input.commandId, input.crosswalkId,
              input.sourceSnapshotId, input.organizationId, input.projectId,
              input.systemKey, input.observationKind,
              input.observationState, input.sourceRevision,
              input.sourcePayloadDigest, input.sourceObservedAt,
              input.actorId, input.recordedAt]
          );
          return receipt("observation", inserted.rows[0], false);
        }
      ));
    },

    resolveCrosswalk(input) {
      return translated(() => database.service(
        systemActor(input),
        async (client) => {
          await requireCapability(client, input);
          const digestResult = await client.query(
            `select ss.adjacent_integration_resolution_digest_for_actor_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9
             ) as semantic_digest`,
            [input.crosswalkId, input.expectedCrosswalkRequestDigest,
              input.expectedCrosswalkRevision, input.priorState,
              input.resolutionKind, input.resultingState,
              input.resolutionEvidenceDigest, input.organizationId,
              input.actorId]
          );
          const semanticDigest = digestResult.rows[0].semantic_digest;
          await locks(client, input.commandId, semanticDigest);
          const prior = await client.query(
            `select * from ss.adjacent_integration_crosswalk_resolutions
              where command_id = $1 or semantic_evidence_digest = $2`,
            [input.commandId, semanticDigest]
          );
          const replay = sameCommandOrSemantic(
            prior.rows, input, semanticDigest
          );
          if (replay) {
            return resolutionReceipt(replay, true);
          }
          const inserted = await client.query(
            `select * from ss.record_adjacent_integration_resolution_v1(
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
             )`,
            [input.id, input.commandId, input.crosswalkId,
              input.organizationId, input.systemKey,
              input.expectedCrosswalkRequestDigest,
              input.expectedCrosswalkRevision, input.priorState,
              input.resolutionKind, input.resultingState,
              input.resolutionEvidenceDigest, input.actorId,
              input.recordedAt]
          );
          return resolutionReceipt(inserted.rows[0], false);
        }
      ));
    }
  });
}
