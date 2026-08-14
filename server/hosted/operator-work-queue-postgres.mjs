import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function authority(value) {
  invariant(
    value && typeof value.service === "function",
    "OPERATOR_QUEUE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for the operator queue.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "OPERATOR_QUEUE_UNAVAILABLE",
      "The operator work queue is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "OPERATOR_QUEUE_RETRY_REQUIRED",
      "The operator queue changed; refresh and retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "OPERATOR_QUEUE_REPOSITORY_CONFLICT",
      "The durable operator queue rejected inconsistent source evidence.",
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

function iso(value) {
  return value === null || value === undefined
    ? null
    : value instanceof Date ? value.toISOString() : String(value);
}

function actor(input, readOnly = false) {
  return {
    actorKind: "operator",
    userId: input.actorId,
    organizationId: input.operatorOrganizationId,
    isolation: "serializable",
    readOnly
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
    "OPERATOR_QUEUE_UNAVAILABLE",
    "The operator work queue is unavailable.",
    { status: 404 }
  );
}

function item(row) {
  return deepFreeze({
    schema: "sitesourcery.operator-work-queue-item/v1",
    id: row.id,
    source: {
      table: row.source_table,
      id: row.source_id,
      revision: Number(row.source_revision),
      digest: row.source_digest,
      state: row.source_state
    },
    organizationId: row.organization_id,
    projectId: row.project_id,
    kind: row.item_kind,
    severity: row.severity,
    status: row.status,
    deadlineAt: iso(row.deadline_at),
    repair: row.repair_kind === null
      ? null
      : { kind: row.repair_kind },
    openedAt: iso(row.opened_at),
    revision: Number(row.revision),
    digest: row.item_digest,
    updatedAt: iso(row.updated_at)
  });
}

async function readActive(client) {
  const selected = await client.query(
    `select * from (
       select id, source_table, source_id, source_revision, source_digest,
              source_state, organization_id, project_id, item_kind,
              severity, status, deadline_at, repair_kind, opened_at,
              revision, item_digest, updated_at
         from ss.operator_work_queue_items
        where status <> 'resolved'
       union all
       select projection.id,
              'ss.alakazam_invoice_finalization_projection'::text,
              projection.id::text, projection.revision,
              projection.evidence_digest, projection.state,
              projection.organization_id, projection.project_id,
              'invoice_finalization_failure'::text, 'high'::text,
              'open'::text, null::timestamptz, null::text,
              projection.first_observed_at, projection.revision,
              projection.evidence_digest, projection.updated_at
         from ss.alakazam_invoice_finalization_projection projection
        where projection.state = 'failed'
       union all
       select manual.id, manual.source_table, manual.source_id,
              manual.source_revision, manual.source_digest,
              manual.source_state, manual.organization_id,
              manual.project_id, manual.item_kind, manual.severity,
              manual.status, manual.deadline_at, manual.repair_kind,
              manual.opened_at, manual.revision, manual.item_digest,
              manual.updated_at
         from ss.operator_manual_review_queue_v1() manual
       union all
       select adjacent.*
         from ss.operator_adjacent_integration_review_queue_v1() adjacent
     ) active
      order by
        case severity
          when 'critical' then 1
          when 'high' then 2
          when 'normal' then 3
          else 4
        end,
        deadline_at nulls last,
        opened_at,
        id
      limit 200`
  );
  return deepFreeze({
    schema: "sitesourcery.operator-work-queue/v1",
    sourceAuthoritative: true,
    genericRepair: false,
    items: selected.rows.map(item)
  });
}

function evidence(row) {
  return deepFreeze({
    schema: "sitesourcery.invoice-finalization-failure-evidence-read/v1",
    id: row.id,
    providerEventIdDigest: row.provider_event_id_digest,
    invoiceIdDigest: row.invoice_id_digest,
    payloadDigest: row.payload_digest,
    signatureVerificationDigest: row.signature_verification_digest,
    reasonCode: row.reason_code,
    state: row.state,
    ownerAlertRequired: row.owner_alert_required,
    providerCreatedAt: iso(row.provider_created_at),
    recordedAt: iso(row.recorded_at),
    revision: Number(row.revision)
  });
}

export function createPostgresOperatorWorkQueueRepository({ authority: input } = {}) {
  const database = authority(input);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_operator_work_queue_contract_v1()'
              ) is not null
              and ss.hosted_operator_work_queue_contract_v1() =
                  'canonical-operator-work-queue-v1-source-authoritative-held'
                as contract_ready,
              to_regprocedure(
                'ss.operator_resolution_surfaces_contract_v1()'
              ) is not null
                and ss.operator_resolution_surfaces_contract_v1() =
                  'canonical-fin-004u-operator-resolution-v1-digest-only-held'
                as resolution_contract_ready,
              count(*) = 6 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "operator_work_queue_items",
            "stripe_invoice_finalization_failures",
            "alakazam_invoice_finalization_observations",
            "alakazam_invoice_finalization_projection",
            "provider_reconciliation_resolution_commands",
            "adjacent_integration_crosswalks"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.resolution_contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "operator-work-queue-postgres",
          code: ready ? null : "OPERATOR_QUEUE_NOT_MIGRATED",
          sourceAuthoritative: true,
          providerEffects: false,
          alertEffects: false,
          genericRepair: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "operator-work-queue-postgres",
          code: "OPERATOR_QUEUE_DATABASE_UNAVAILABLE",
          sourceAuthoritative: true,
          providerEffects: false,
          alertEffects: false,
          genericRepair: false
        });
      }
    },

    list(input) {
      return translated(() => database.service(
        actor(input, true),
        async (client) => {
          await requireCapability(client, input);
          return readActive(client);
        }
      ));
    },

    refresh(input) {
      return translated(() => database.service(
        actor(input),
        async (client) => {
          await requireCapability(client, input);
          await client.query(
            "select * from ss.reconcile_operator_work_queue_v1($1)",
            [input.observedAt]
          );
          return readActive(client);
        }
      ));
    },

    recordInvoiceFinalizationFailure(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await client.query(
            `select * from ss.stripe_invoice_finalization_failures
              where command_id = $1 or provider_event_id_digest = $2`,
            [input.commandId, input.providerEventIdDigest]
          );
          if (prior.rowCount > 0) {
            invariant(
              prior.rowCount === 1 &&
                prior.rows[0].command_id === input.commandId &&
                prior.rows[0].request_digest === input.requestDigest &&
                prior.rows[0].provider_event_id_digest ===
                  input.providerEventIdDigest,
              "OPERATOR_QUEUE_IDEMPOTENCY_CONFLICT",
              "Invoice finalization evidence was reused for different facts.",
              { status: 409 }
            );
            return evidence(prior.rows[0]);
          }
          const inserted = await client.query(
            `insert into ss.stripe_invoice_finalization_failures (
               id, command_id, request_digest, provider_event_id_digest,
               invoice_id_digest, payload_digest,
               signature_verification_digest, reason_code,
               provider_created_at, recorded_at, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
             returning *`,
            [
              systemRandomUUID(), input.commandId, input.requestDigest,
              input.providerEventIdDigest, input.invoiceIdDigest,
              input.payloadDigest, input.signatureVerificationDigest,
              input.reasonCode, input.providerCreatedAt, input.recordedAt
            ]
          );
          return evidence(inserted.rows[0]);
        }
      ));
    },

    prepareProfessionalReversalRepair(input) {
      return translated(() => database.service(
        actor(input, true),
        async (client) => {
          await requireCapability(client, input);
          const selected = await client.query(
            `select lifecycle.organization_id,
                    lifecycle.id as lifecycle_id,
                    lifecycle.revision as lifecycle_revision,
                    evidence.id as evidence_id
               from ss.operator_work_queue_items item
               join ss.service_professional_payment_lifecycles lifecycle
                 on item.source_table =
                    'ss.service_professional_payment_lifecycles'
                and item.source_id = lifecycle.id::text
               join ss.service_professional_reversal_evidence evidence
                 on evidence.lifecycle_id = lifecycle.id
                and evidence.id = lifecycle.latest_evidence_id
              where item.id = $1
                and item.revision = $2
                and item.status = 'open'
                and item.repair_kind =
                  'professional_reversal_reconcile'
                and item.repair_reference_id = evidence.id
                and item.source_revision = lifecycle.revision
                and item.source_digest = evidence.provider_facts_digest
                and lifecycle.reconciliation_required`,
            [input.queueItemId, input.expectedQueueRevision]
          );
          invariant(
            selected.rowCount === 1,
            "OPERATOR_QUEUE_REPAIR_UNAVAILABLE",
            "The bounded repair changed; refresh the queue before retrying.",
            { status: 409 }
          );
          const row = selected.rows[0];
          return deepFreeze({
            organizationId: row.organization_id,
            lifecycleId: row.lifecycle_id,
            lifecycleRevision: Number(row.lifecycle_revision),
            evidenceId: row.evidence_id
          });
        }
      ));
    }
  });
}
