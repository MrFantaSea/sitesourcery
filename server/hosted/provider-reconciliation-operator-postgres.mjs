import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const RESOLUTION_KINDS = new Set([
  "operator_confirmed_effect",
  "operator_confirmed_no_effect",
  "operator_late_binding_applied",
  "operator_binding_retired",
  "operator_closed"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const CONTRACT =
  "canonical-fin-004u-operator-resolution-v1-digest-only-held";

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "OPERATOR_RECONCILIATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "OPERATOR_RECONCILIATION_INVALID",
    `${field} is invalid.`,
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

function positiveRevision(value) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "OPERATOR_RECONCILIATION_INVALID",
    "The expected case revision is invalid.",
    { status: 400 }
  );
  return value;
}

function resolutionKind(value) {
  invariant(
    RESOLUTION_KINDS.has(value),
    "OPERATOR_RECONCILIATION_INVALID",
    "The resolution kind is invalid.",
    { status: 400 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "OPERATOR_RECONCILIATION_UNAVAILABLE",
      "The provider reconciliation case is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "OPERATOR_RECONCILIATION_RETRY_REQUIRED",
      "The provider reconciliation case changed; refresh and retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "OPERATOR_RECONCILIATION_CONFLICT",
      "The resolution conflicts with retained reconciliation evidence.",
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

function isoNow(clock) {
  const value = clock();
  const selected = value instanceof Date ? value : new Date(value);
  invariant(
    Number.isFinite(selected.getTime()),
    "OPERATOR_RECONCILIATION_CONFIGURATION_REQUIRED",
    "The operator reconciliation clock is invalid.",
    { status: 500 }
  );
  return selected.toISOString();
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

function receipt(caseRow, commandRow, replayed) {
  return deepFreeze({
    schema: "sitesourcery.operator-provider-reconciliation-resolution/v1",
    commandId: commandRow.command_id,
    requestDigest: commandRow.request_digest,
    case: {
      id: caseRow.id,
      caseKind: caseRow.case_kind,
      caseDigest: caseRow.case_digest,
      state: caseRow.state,
      revision: Number(caseRow.revision),
      resolutionKind: caseRow.resolution_kind,
      resolutionEvidenceDigest: caseRow.resolution_evidence_digest,
      resolvedAt: caseRow.resolved_at instanceof Date
        ? caseRow.resolved_at.toISOString()
        : String(caseRow.resolved_at)
    },
    replayed,
    providerEffects: false,
    genericRepair: false
  });
}

function projectedCase(value) {
  const selected = { ...value };
  for (const field of ["openedAt", "readbackAt", "resolvedAt"]) {
    if (selected[field] !== null && selected[field] !== undefined) {
      const parsed = new Date(selected[field]);
      invariant(
        Number.isFinite(parsed.getTime()),
        "OPERATOR_RECONCILIATION_REPOSITORY_INVALID",
        "The reconciliation projection contains an invalid timestamp.",
        { status: 500 }
      );
      selected[field] = parsed.toISOString();
    }
  }
  return deepFreeze(selected);
}

export function createPostgresProviderReconciliationOperator({
  authority,
  clock = () => new Date(),
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority && typeof authority.service === "function" &&
      typeof clock === "function" && typeof randomUUID === "function",
    "OPERATOR_RECONCILIATION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for operator reconciliation.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "provider-reconciliation-operator-postgres",
    providerEffects: false,
    genericRepair: false,

    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.operator_resolution_surfaces_contract_v1()'
              ) is not null
              and ss.operator_resolution_surfaces_contract_v1() = $1
                as contract_ready,
              count(*) = 1
                and bool_and(relation.relrowsecurity)
                and bool_and(relation.relforcerowsecurity) as table_ready
            from pg_class relation
            join pg_namespace namespace
              on namespace.oid = relation.relnamespace
           where namespace.nspname = 'ss'
             and relation.relname =
               'provider_reconciliation_resolution_commands'
          `, [CONTRACT])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.table_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "provider-reconciliation-operator-postgres",
          code: ready ? null : "OPERATOR_RECONCILIATION_NOT_MIGRATED",
          providerEffects: false,
          genericRepair: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "provider-reconciliation-operator-postgres",
          code: "OPERATOR_RECONCILIATION_DATABASE_UNAVAILABLE",
          providerEffects: false,
          genericRepair: false
        });
      }
    },

    readCase(input = {}) {
      const selected = {
        actorId: uuid(input.actorId, "Operator user ID"),
        operatorOrganizationId: uuid(
          input.operatorOrganizationId, "Operator organization ID"
        ),
        caseId: uuid(input.caseId, "Reconciliation case ID")
      };
      return translated(() => authority.service(
        operatorActor(selected),
        async (client) => {
          const result = await client.query(
            "select ss.operator_provider_reconciliation_case_v1($1) as case_data",
            [selected.caseId]
          );
          invariant(
            result.rows[0]?.case_data !== null &&
              result.rows[0]?.case_data !== undefined,
            "OPERATOR_RECONCILIATION_UNAVAILABLE",
            "The provider reconciliation case is unavailable.",
            { status: 404 }
          );
          return projectedCase(result.rows[0].case_data);
        }
      ));
    },

    resolveCase(input = {}) {
      const selected = {
        actorId: uuid(input.actorId, "Operator user ID"),
        operatorOrganizationId: uuid(
          input.operatorOrganizationId, "Operator organization ID"
        ),
        caseId: uuid(input.caseId, "Reconciliation case ID"),
        commandId: commandId(input.commandId),
        expectedRevision: positiveRevision(input.expectedRevision),
        resolutionKind: resolutionKind(input.resolutionKind),
        evidenceDigest: sha256(input.evidenceDigest, "Evidence digest")
      };
      const requestDigest = digest({
        schema: "sitesourcery.operator-provider-reconciliation-command/v1",
        actorId: selected.actorId,
        operatorOrganizationId: selected.operatorOrganizationId,
        caseId: selected.caseId,
        expectedRevision: selected.expectedRevision,
        resolutionKind: selected.resolutionKind,
        evidenceDigest: selected.evidenceDigest
      });

      return translated(() => authority.service(
        {
          actorKind: "system",
          userId: selected.actorId,
          isolation: "serializable"
        },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`operator-reconciliation:${selected.commandId}`]
          );
          const prior = await client.query(
            `select *
               from ss.provider_reconciliation_resolution_commands
              where command_id = $1 or case_id = $2
              order by command_id`,
            [selected.commandId, selected.caseId]
          );
          if (prior.rowCount > 0) {
            invariant(
              prior.rowCount === 1 &&
                prior.rows[0].command_id === selected.commandId &&
                prior.rows[0].request_digest === requestDigest &&
                prior.rows[0].case_id === selected.caseId &&
                prior.rows[0].operator_organization_id ===
                  selected.operatorOrganizationId &&
                prior.rows[0].operator_user_id === selected.actorId &&
                Number(prior.rows[0].expected_case_revision) ===
                  selected.expectedRevision &&
                prior.rows[0].resolution_kind === selected.resolutionKind &&
                prior.rows[0].evidence_digest === selected.evidenceDigest,
              "OPERATOR_RECONCILIATION_CONFLICT",
              "The command ID or case already carries different evidence.",
              { status: 409 }
            );
            const existing = await client.query(
              "select * from ss.provider_reconciliation_cases where id = $1",
              [selected.caseId]
            );
            invariant(
              existing.rowCount === 1 && existing.rows[0].state === "resolved",
              "OPERATOR_RECONCILIATION_RETRY_REQUIRED",
              "The prior resolution command has not completed.",
              { status: 409 }
            );
            return receipt(existing.rows[0], prior.rows[0], true);
          }

          const resolvedAt = isoNow(clock);
          const inserted = await client.query(
            `insert into ss.provider_reconciliation_resolution_commands (
               id, command_id, request_digest, case_id,
               expected_case_revision, operator_organization_id,
               operator_user_id, resolution_kind, evidence_digest,
               resolved_at, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
             returning *`,
            [
              randomUUID(), selected.commandId, requestDigest, selected.caseId,
              selected.expectedRevision, selected.operatorOrganizationId,
              selected.actorId, selected.resolutionKind,
              selected.evidenceDigest, resolvedAt
            ]
          );
          const changed = await client.query(
            `update ss.provider_reconciliation_cases
                set state = 'resolved', resolution_kind = $2,
                    resolved_by_operator_user_id = $3,
                    resolution_evidence_digest = $4,
                    resolved_at = $5, revision = revision + 1,
                    updated_at = $5
              where id = $1 and state = 'open' and revision = $6
              returning *`,
            [
              selected.caseId, selected.resolutionKind, selected.actorId,
              selected.evidenceDigest, resolvedAt, selected.expectedRevision
            ]
          );
          invariant(
            changed.rowCount === 1,
            "OPERATOR_RECONCILIATION_RETRY_REQUIRED",
            "The provider reconciliation case changed; refresh and retry.",
            { status: 409 }
          );
          return receipt(changed.rows[0], inserted.rows[0], false);
        }
      ));
    }
  });
}
