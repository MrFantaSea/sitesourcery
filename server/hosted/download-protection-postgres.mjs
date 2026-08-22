import { randomUUID } from "node:crypto";

import {
  CommerceV2Error,
  clone,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTRACT =
  "fin012-download-2000-credit-2000-verified-billing-3ds-requested-velocity-6h-12h-120x5m-real-signal-gate-private-dossier";
const TABLES = Object.freeze([
  "commerce_v2_download_access_events",
  "commerce_v2_download_checkout_attempts",
  "commerce_v2_download_checkout_gate",
  "commerce_v2_download_dispute_dossiers",
  "commerce_v2_download_fraud_warning_events",
  "commerce_v2_download_gate_review_decisions",
  "commerce_v2_download_gate_transitions"
]);
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "42501",
  "55000"
]);

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactClock(clock) {
  const value =
    typeof clock === "function"
      ? clock()
      : clock?.now?.();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function validateAuthority(authority) {
  invariant(
    authority &&
      typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "download_protection_repository_conflict",
      "the durable Download protection repository rejected inconsistent evidence",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function exactScope(input) {
  return Object.freeze({
    operatorId: exactUuid(
      input?.operatorId,
      "operatorId"
    ),
    operatorOrganizationId: exactUuid(
      input?.operatorOrganizationId,
      "operatorOrganizationId"
    )
  });
}

async function requireOwnerOperator(client, scope) {
  const result = await client.query(
    `select exists (
       select 1
       from ss.organization_memberships membership
       join ss.organizations organization
         on organization.id = membership.organization_id
        and organization.state = 'active'
      where membership.organization_id = $2
        and membership.user_id = $1
        and membership.role = 'owner'
        and membership.state = 'active'
        and ss.service_operator_has_capability(
          $1, 'service_job_manage', clock_timestamp()
        )
     ) as authorized`,
    [scope.operatorId, scope.operatorOrganizationId]
  );
  invariant(
    result.rowCount === 1 &&
      result.rows[0].authorized === true,
    "download_protection_operator_required",
    "Download protection review is restricted to an authorized organization owner",
    { status: 403 }
  );
}

function publicGate(row) {
  invariant(
    row &&
      ["open", "held"].includes(row.state) &&
      Number.isSafeInteger(Number(row.revision)),
    "download_protection_repository_conflict",
    "the Download Checkout gate is invalid",
    { status: 500 }
  );
  return Object.freeze({
    schema:
      "sitesourcery.download-checkout-gate/v1",
    state: row.state,
    reason: row.reason,
    signalType: row.signal_type ?? null,
    signalId: row.signal_id ?? null,
    evidenceDigest: row.evidence_digest ?? null,
    stateChangedAt: new Date(
      row.state_changed_at
    ).toISOString(),
    revision: Number(row.revision)
  });
}

function privateDossier(row) {
  invariant(
    row &&
      UUID.test(String(row.id ?? "")) &&
      row.dossier?.schema ===
        "sitesourcery.download-private-dispute-dossier/v1" &&
      digest(row.dossier) === row.dossier_digest,
    "download_protection_repository_conflict",
    "the private Download dispute dossier is invalid",
    { status: 500 }
  );
  return Object.freeze({
    schema:
      "sitesourcery.download-private-dispute-dossier-export/v1",
    private: true,
    immutable: true,
    dossierId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    receiptId: row.receipt_id,
    entitlementId: row.entitlement_id,
    triggerEventId: row.trigger_event_id,
    triggerType: row.trigger_type,
    dossier: clone(row.dossier),
    dossierDigest: row.dossier_digest,
    createdAt: new Date(row.created_at).toISOString()
  });
}

export function createPostgresDownloadProtectionRepository({
  authority,
  clock = () => new Date(),
  ids = { next: () => randomUUID() }
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    ids && typeof ids.next === "function",
    "invalid_configuration",
    "Download protection decision IDs are required",
    { status: 500 }
  );

  return Object.freeze({
    async readiness() {
      return translated(() =>
        database.service(
          { actorKind: "system", readOnly: true },
          async (client) => {
            const result = await client.query(
              `select
                 ss.download_protection_contract_v1() = $1
                   as contract_ready,
                 count(*) = $3::integer as tables_ready,
                 bool_and(
                   relation.relrowsecurity
                   and relation.relforcerowsecurity
                 ) as rls_ready
               from pg_class relation
               join pg_namespace namespace
                 on namespace.oid = relation.relnamespace
              where namespace.nspname = 'ss'
                and relation.relname = any($2::text[])`,
              [CONTRACT, TABLES, TABLES.length]
            );
            const row = result.rows[0];
            const ready =
              result.rowCount === 1 &&
              row.contract_ready === true &&
              row.tables_ready === true &&
              row.rls_ready === true;
            return Object.freeze({
              ready,
              verified: ready,
              kind: "download-protection-postgres",
              privateEvidence: true,
              providerEffects: false,
              paymentEffects: false
            });
          }
        )
      );
    },

    async readGate(input) {
      const scope = exactScope(input);
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: scope.operatorId,
            organizationId:
              scope.operatorOrganizationId,
            readOnly: true
          },
          async (client) => {
            await requireOwnerOperator(client, scope);
            const result = await client.query(
              `select *
                 from ss.commerce_v2_download_checkout_gate
                where singleton = true`
            );
            invariant(
              result.rowCount === 1,
              "download_protection_repository_conflict",
              "the Download Checkout gate is unavailable",
              { status: 500 }
            );
            return publicGate(result.rows[0]);
          }
        )
      );
    },

    async exportDossier(input) {
      const scope = exactScope(input);
      const dossierId = exactUuid(
        input?.dossierId,
        "dossierId"
      );
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: scope.operatorId,
            organizationId:
              scope.operatorOrganizationId,
            readOnly: true
          },
          async (client) => {
            await requireOwnerOperator(client, scope);
            const result = await client.query(
              `select *
                 from ss.commerce_v2_download_dispute_dossiers
                where organization_id = $1
                  and id = $2`,
              [scope.operatorOrganizationId, dossierId]
            );
            invariant(
              result.rowCount === 1,
              "download_protection_dossier_not_found",
              "the private Download dispute dossier is unavailable",
              { status: 404 }
            );
            return privateDossier(result.rows[0]);
          }
        )
      );
    },

    async reopenGate(input) {
      const scope = exactScope(input);
      const dossierId = exactUuid(
        input?.dossierId,
        "dossierId"
      );
      const reviewedDossierDigest = requiredDigest(
        input?.reviewedDossierDigest,
        "reviewedDossierDigest"
      );
      const reason = requiredText(
        input?.reason,
        "reason",
        200
      );
      invariant(
        reason.length >= 2,
        "invalid_input",
        "reason is too short"
      );
      const decidedAt = exactClock(clock);
      const decisionId = exactUuid(
        ids.next("download_gate_review"),
        "decisionId"
      );
      return translated(() =>
        database.service(
          {
            actorKind: "operator",
            userId: scope.operatorId,
            organizationId:
              scope.operatorOrganizationId,
            isolation: "serializable"
          },
          async (client) => {
            await requireOwnerOperator(client, scope);
            const dossierResult = await client.query(
              `select *
                 from ss.commerce_v2_download_dispute_dossiers
                where organization_id = $1
                  and id = $2`,
              [scope.operatorOrganizationId, dossierId]
            );
            invariant(
              dossierResult.rowCount === 1,
              "download_protection_dossier_not_found",
              "the private Download dispute dossier is unavailable",
              { status: 404 }
            );
            const dossier = privateDossier(
              dossierResult.rows[0]
            );
            invariant(
              dossier.dossierDigest ===
                reviewedDossierDigest,
              "download_protection_review_stale",
              "the reviewed Download dossier digest changed",
              { status: 409 }
            );
            const gateResult = await client.query(
              `select *
                 from ss.commerce_v2_download_checkout_gate
                where singleton = true
                for update`
            );
            invariant(
              gateResult.rowCount === 1,
              "download_protection_repository_conflict",
              "the Download Checkout gate is unavailable",
              { status: 500 }
            );
            const gate = publicGate(gateResult.rows[0]);
            invariant(
              gate.state === "held",
              "download_protection_gate_not_held",
              "the Download Checkout gate is not held",
              { status: 409 }
            );
            invariant(
              gate.signalId === dossier.triggerEventId &&
                gate.signalType === dossier.triggerType,
              "download_protection_review_stale",
              "the dossier does not match the current Checkout hold",
              { status: 409 }
            );
            const decision = {
              schema:
                "sitesourcery.download-gate-owner-review/v1",
              decisionId,
              decision: "reopen_checkouts",
              operatorId: scope.operatorId,
              operatorOrganizationId:
                scope.operatorOrganizationId,
              dossierId,
              reviewedDossierDigest,
              trigger: {
                eventId: dossier.triggerEventId,
                eventType: dossier.triggerType
              },
              priorGateRevision: gate.revision,
              reason,
              decidedAt
            };
            const decisionDigest = digest(decision);
            await client.query(
              `insert into ss.commerce_v2_download_gate_review_decisions (
                 id, organization_id, dossier_id,
                 operator_user_id, decision_kind, reason,
                 reviewed_dossier_digest, decision,
                 decision_digest, decided_at
               ) values (
                 $1, $2, $3, $4, 'reopen_checkouts', $5,
                 $6, $7::jsonb, $8, $9
               )`,
              [
                decisionId,
                scope.operatorOrganizationId,
                dossierId,
                scope.operatorId,
                reason,
                reviewedDossierDigest,
                JSON.stringify(decision),
                decisionDigest,
                decidedAt
              ]
            );
            await client.query(
              `insert into ss.commerce_v2_download_gate_transitions (
                 prior_state, resulting_state, reason,
                 signal_type, signal_id, evidence_digest,
                 changed_by_user_id, changed_at
               ) values (
                 'held', 'open', $1, 'operator_review',
                 $2, $3, $4, $5
               )`,
              [
                reason,
                decisionId,
                decisionDigest,
                scope.operatorId,
                decidedAt
              ]
            );
            const reopened = await client.query(
              `update ss.commerce_v2_download_checkout_gate
                  set state = 'open',
                      reason = $1,
                      signal_type = null,
                      signal_id = null,
                      evidence_digest = $2,
                      state_changed_at = $3,
                      revision = revision + 1
                where singleton = true
                  and state = 'held'
                  and revision = $4
                returning *`,
              [
                reason,
                decisionDigest,
                decidedAt,
                gate.revision
              ]
            );
            invariant(
              reopened.rowCount === 1,
              "download_protection_review_stale",
              "the Download Checkout hold changed during review",
              { status: 409 }
            );
            return Object.freeze({
              status: "reopened",
              decision: clone(decision),
              decisionDigest,
              gate: publicGate(reopened.rows[0])
            });
          }
        )
      );
    }
  });
}
