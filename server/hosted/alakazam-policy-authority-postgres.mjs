import {
  ALAKAZAM_POLICY_AUTHORITY_DIGEST,
  ALAKAZAM_POLICY_AUTHORITY_ID,
  createAlakazamPolicySnapshot,
  exactAlakazamPolicyAuthority
} from "../commerce-v2/alakazam-policy-authority.mjs";
import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const RUNTIME_CONTRACT =
  "canonical-alakazam-policy-authority-v1-held";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_CONFLICTS = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "ALAKAZAM_POLICY_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Alakazam policy state.",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "ALAKAZAM_POLICY_RETRY_REQUIRED",
      "The Alakazam policy evidence changed; retry the exact read.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "ALAKAZAM_POLICY_REPOSITORY_CONFLICT",
      "The Alakazam policy repository rejected inconsistent evidence.",
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

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "ALAKAZAM_POLICY_INPUT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "ALAKAZAM_POLICY_INPUT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function scope(value) {
  exactKeys(
    value,
    ["customerId", "projectId", "subscriptionId", "tenantId"],
    "scope"
  );
  return Object.freeze({
    tenantId: uuid(value.tenantId, "scope.tenantId"),
    projectId: uuid(value.projectId, "scope.projectId"),
    customerId: uuid(value.customerId, "scope.customerId"),
    subscriptionId: uuid(value.subscriptionId, "scope.subscriptionId")
  });
}

function snapshotFromRow(row) {
  invariant(
    row.legacy_evidence_compatible === true &&
      row.lifecycle_state !== "held_evidence_incomplete",
    "ALAKAZAM_POLICY_EVIDENCE_INCOMPLETE",
    "The existing Alakazam evidence does not satisfy the canonical policy.",
    { status: 409 }
  );
  return createAlakazamPolicySnapshot({
    policyId: row.policy_id,
    authorityDigest: row.authority_digest,
    tenantId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    subscriptionId: row.subscription_id,
    sourceSubscriptionRevision: Number(
      row.source_subscription_revision
    ),
    sourceSubscriptionStatus: row.source_subscription_status,
    lifecycleState: row.lifecycle_state,
    transitionEventId: row.transition_event_id,
    cancellationId: row.cancellation_id,
    retentionWindowId: row.retention_window_id,
    retentionEndsAt: row.retention_ends_at === null
      ? null
      : row.retention_ends_at.toISOString(),
    reversalEventId: row.reversal_event_id,
    commercialEffects: row.commercial_effects,
    providerEffects: row.provider_effects,
    publicationEffects: row.publication_effects,
    automaticRecoveryFromReversalEvidence:
      row.automatic_recovery_from_reversal_evidence,
    holdReason: row.hold_reason,
    observedAt: row.observed_at.toISOString()
  });
}

export function createPostgresAlakazamPolicyAuthorityRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              ss.hosted_alakazam_policy_authority_contract_v1() = $1
                as contract_ready,
              policy.policy_id = $2
                and policy.policy_digest = $3
                and policy.state = 'held'
                and not policy.commercial_effects
                and not policy.provider_effects
                and not policy.publication_effects
                and not policy.automatic_recovery_from_reversal_evidence
                as policy_ready,
              relation.relrowsecurity and relation.relforcerowsecurity
                as rls_ready,
              has_table_privilege(
                'service_role', 'ss.alakazam_policy_authorities', 'SELECT'
              )
                and not has_table_privilege(
                  'service_role', 'ss.alakazam_policy_authorities',
                  'INSERT,UPDATE,DELETE'
                )
                and has_table_privilege(
                  'service_role',
                  'ss.alakazam_policy_subscription_authority_v1',
                  'SELECT'
                )
                and not has_table_privilege(
                  'anon', 'ss.alakazam_policy_authorities', 'SELECT'
                )
                and not has_table_privilege(
                  'authenticated', 'ss.alakazam_policy_authorities', 'SELECT'
                ) as grants_ready
            from ss.alakazam_policy_authorities policy
            join pg_catalog.pg_class relation
              on relation.oid = 'ss.alakazam_policy_authorities'::regclass
            where policy.policy_id = $2
          `, [
            RUNTIME_CONTRACT,
            ALAKAZAM_POLICY_AUTHORITY_ID,
            ALAKAZAM_POLICY_AUTHORITY_DIGEST
          ])
        );
        const row = result.rows[0] ?? {};
        const ready = result.rowCount === 1 &&
          row.contract_ready === true &&
          row.policy_ready === true &&
          row.rls_ready === true &&
          row.grants_ready === true;
        return deepFreeze({
          schema: "sitesourcery.alakazam-policy-readiness/v1",
          ready,
          verified: ready,
          state: "held",
          policyId: ALAKAZAM_POLICY_AUTHORITY_ID,
          authorityDigest: ALAKAZAM_POLICY_AUTHORITY_DIGEST,
          commercialEffects: false,
          providerEffects: false,
          publicationEffects: false,
          automaticRecoveryFromReversalEvidence: false,
          code: ready ? null : "ALAKAZAM_POLICY_NOT_READY"
        });
      } catch {
        return deepFreeze({
          schema: "sitesourcery.alakazam-policy-readiness/v1",
          ready: false,
          verified: false,
          state: "held",
          policyId: ALAKAZAM_POLICY_AUTHORITY_ID,
          authorityDigest: ALAKAZAM_POLICY_AUTHORITY_DIGEST,
          commercialEffects: false,
          providerEffects: false,
          publicationEffects: false,
          automaticRecoveryFromReversalEvidence: false,
          code: "ALAKAZAM_POLICY_DATABASE_UNAVAILABLE"
        });
      }
    },

    policy() {
      return translated(() => database.service(
        { actorKind: "system", readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select policy_document, policy_digest
               from ss.alakazam_policy_authorities
              where policy_id = $1`,
            [ALAKAZAM_POLICY_AUTHORITY_ID]
          );
          invariant(
            selected.rowCount === 1 &&
              selected.rows[0].policy_digest ===
                ALAKAZAM_POLICY_AUTHORITY_DIGEST,
            "ALAKAZAM_POLICY_REPOSITORY_CONFLICT",
            "The canonical Alakazam policy is unavailable.",
            { status: 500 }
          );
          return exactAlakazamPolicyAuthority(
            selected.rows[0].policy_document
          );
        }
      ));
    },

    read(value) {
      const input = scope(value);
      return translated(() => database.service(
        {
          actorKind: "system",
          organizationId: input.tenantId,
          readOnly: true
        },
        async (client) => {
          const selected = await client.query(
            `select *
               from ss.alakazam_policy_subscription_authority_v1
              where organization_id = $1
                and project_id = $2
                and customer_user_id = $3
                and subscription_id = $4`,
            [
              input.tenantId,
              input.projectId,
              input.customerId,
              input.subscriptionId
            ]
          );
          invariant(
            selected.rowCount === 1,
            "ALAKAZAM_POLICY_UNAVAILABLE",
            "The canonical Alakazam policy state is unavailable.",
            { status: 404 }
          );
          return snapshotFromRow(selected.rows[0]);
        }
      ));
    }
  });
}
