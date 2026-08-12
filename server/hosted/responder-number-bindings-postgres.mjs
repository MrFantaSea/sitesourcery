import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RETIRED_REASONS = new Set([
  "reprovisioned", "customer_cancelled", "number_released",
  "operator_correction"
]);
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function sha256(value, field, { nullable = false } = {}) {
  invariant(
    (nullable && value === null) ||
      (typeof value === "string" && SHA256.test(value)),
    "RESPONDER_NUMBER_BINDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_NUMBER_BINDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_NUMBER_BINDING_UNAVAILABLE",
      "Responder number binding state is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_NUMBER_BINDING_RETRY_REQUIRED",
      "Responder number binding state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_NUMBER_BINDING_CONFLICT",
      "The Responder number binding conflicts with durable evidence.",
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

function receipt(row, replayed = false) {
  return deepFreeze({
    schema: "sitesourcery.responder-number-binding-receipt/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    provider: row.provider,
    numberLookupDigest: row.number_lookup_digest,
    lookupKeyVersion: row.lookup_key_version,
    phoneNumberSidDigest: row.phone_number_sid_digest,
    providerReadbackDigest: row.provider_readback_digest,
    accountSidDigest: row.account_sid_digest,
    messagingServiceSidDigest: row.messaging_service_sid_digest ?? null,
    state: row.state,
    provisionedAt: row.provisioned_at instanceof Date
      ? row.provisioned_at.toISOString()
      : String(row.provisioned_at),
    retiredAt: row.retired_at === null || row.retired_at === undefined
      ? null
      : row.retired_at instanceof Date
        ? row.retired_at.toISOString()
        : String(row.retired_at),
    retiredReason: row.retired_reason ?? null,
    revision: Number(row.revision),
    replayed,
    providerEffects: false
  });
}

function operatorContext(actor) {
  invariant(
    actor?.kind === "operator" &&
      typeof actor.organizationId === "string" &&
      typeof actor.userId === "string",
    "RESPONDER_NUMBER_BINDING_UNAVAILABLE",
    "Responder number binding authority is unavailable.",
    { status: 404 }
  );
  return {
    actorKind: "operator",
    userId: actor.userId,
    organizationId: actor.organizationId,
    isolation: "serializable"
  };
}

export function createPostgresResponderNumberBindingsRepository({
  authority,
  verifierKeyVersions,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    typeof authority?.service === "function" &&
      typeof randomUUID === "function" &&
      Array.isArray(verifierKeyVersions) &&
      verifierKeyVersions.length >= 1 &&
      verifierKeyVersions.length <= 8 &&
      verifierKeyVersions.every(
        (entry) => typeof entry === "string" && KEY_VERSION.test(entry)
      ),
    "RESPONDER_NUMBER_BINDING_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for number bindings.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-number-bindings-postgres",
    providerEffects: false,
    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_twilio_inbound_contract_v1()'
              ) is not null
              and ss.hosted_responder_twilio_inbound_contract_v1() =
                'canonical-responder-twilio-inbound-v1-keyed-lookup-tenant-bound'
                as contract_ready,
              (select count(*) = 1
                 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname = 'responder_provider_number_bindings'
              ) as tables_ready,
              not exists (
                select 1 from ss.responder_provider_number_bindings binding
                 where binding.state = 'active'
                   and binding.lookup_key_version <> all($1::text[])
              ) as lookup_keys_cover_bindings
          `, [verifierKeyVersions])
        );
        const row = result.rows[0] ?? {};
        const storageReady = row.contract_ready === true &&
          row.tables_ready === true;
        const ready = storageReady && row.lookup_keys_cover_bindings === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-number-bindings-postgres",
          providerEffects: false,
          code: ready
            ? null
            : storageReady
              ? "RESPONDER_NUMBER_BINDING_LOOKUP_KEY_COVERAGE_REQUIRED"
              : "RESPONDER_NUMBER_BINDING_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-number-bindings-postgres",
          providerEffects: false,
          code: "RESPONDER_NUMBER_BINDING_STORAGE_NOT_READY"
        });
      }
    },

    provisionBinding(actor, input) {
      const selected = {
        commandId: input.commandId,
        requestDigest: sha256(input.requestDigest, "Request digest"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        numberLookupDigest: sha256(
          input.numberLookupDigest, "Number lookup digest"
        ),
        numberLookupCandidateDigests: input.numberLookupCandidateDigests,
        lookupKeyVersion: input.lookupKeyVersion,
        phoneNumberSidDigest: sha256(
          input.phoneNumberSidDigest, "Phone Number SID digest"
        ),
        providerReadbackDigest: sha256(
          input.providerReadbackDigest, "Provider readback digest"
        ),
        accountSidDigest: sha256(
          input.accountSidDigest, "Account SID digest"
        ),
        messagingServiceSidDigest: sha256(
          input.messagingServiceSidDigest, "Messaging Service SID digest",
          { nullable: true }
        ),
        provisionEvidenceDigest: sha256(
          input.provisionEvidenceDigest, "Provision evidence digest"
        ),
        recordedAt: input.recordedAt
      };
      invariant(
        typeof selected.lookupKeyVersion === "string" &&
          KEY_VERSION.test(selected.lookupKeyVersion) &&
          Array.isArray(selected.numberLookupCandidateDigests) &&
          selected.numberLookupCandidateDigests.length >= 1 &&
          selected.numberLookupCandidateDigests.length <= 8 &&
          selected.numberLookupCandidateDigests[0] ===
            selected.numberLookupDigest &&
          selected.numberLookupCandidateDigests.every(
            (candidate) => typeof candidate === "string" &&
              /^[0-9a-f]{64}$/u.test(candidate)
          ),
        "RESPONDER_NUMBER_BINDING_INVALID",
        "The binding lookup key version is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        operatorContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-number-binding:${selected.commandId}`]
          );
          const prior = await client.query(
            `select * from ss.responder_provider_number_bindings
              where command_id = $1`,
            [selected.commandId]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].request_digest === selected.requestDigest,
              "RESPONDER_NUMBER_BINDING_IDEMPOTENCY_CONFLICT",
              "The binding command was reused for different facts.",
              { status: 409 }
            );
            return receipt(prior.rows[0], true);
          }
          // The partial unique index is per digest, so an active binding
          // provisioned under a prior identity-pepper version would not
          // collide with the current writer digest. One real number must
          // never resolve twice, so every keyring version is checked.
          const conflicting = await client.query(
            `select 1 from ss.responder_provider_number_bindings
              where provider = 'twilio' and state = 'active'
                and number_lookup_digest = any($1::text[])
              limit 1`,
            [selected.numberLookupCandidateDigests]
          );
          invariant(
            conflicting.rowCount === 0,
            "RESPONDER_NUMBER_BINDING_CONFLICT",
            "The Responder number binding conflicts with durable evidence.",
            { status: 409 }
          );
          const inserted = await client.query(
            `insert into ss.responder_provider_number_bindings (
               id, command_id, request_digest, organization_id, project_id,
               provider, number_lookup_digest, lookup_key_version,
               phone_number_sid_digest, account_sid_digest,
               messaging_service_sid_digest, provider_readback_digest,
               state, provisioned_by_user_id, provision_evidence_digest,
               provisioned_at, revision, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, 'twilio', $6, $7, $8, $9, $10, $11,
               'active', $12, $13, $14, 1, $14, $14
             ) returning *`,
            [
              randomUUID(), selected.commandId, selected.requestDigest,
              selected.organizationId, selected.projectId,
              selected.numberLookupDigest, selected.lookupKeyVersion,
              selected.phoneNumberSidDigest, selected.accountSidDigest,
              selected.messagingServiceSidDigest,
              selected.providerReadbackDigest, actor.userId,
              selected.provisionEvidenceDigest, selected.recordedAt
            ]
          );
          return receipt(inserted.rows[0]);
        }
      ));
    },

    retireBinding(actor, input) {
      const selected = {
        commandId: input.commandId,
        requestDigest: sha256(input.requestDigest, "Request digest"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        bindingId: uuid(input.bindingId, "Binding ID"),
        retiredReason: input.retiredReason,
        retireEvidenceDigest: sha256(
          input.retireEvidenceDigest, "Retire evidence digest"
        ),
        recordedAt: input.recordedAt
      };
      invariant(
        RETIRED_REASONS.has(selected.retiredReason),
        "RESPONDER_NUMBER_BINDING_INVALID",
        "The binding retirement reason is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        operatorContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-number-binding:${selected.bindingId}`]
          );
          const existing = await client.query(
            `select * from ss.responder_provider_number_bindings
              where id = $1 and organization_id = $2
              for update`,
            [selected.bindingId, selected.organizationId]
          );
          invariant(
            existing.rowCount === 1,
            "RESPONDER_NUMBER_BINDING_UNAVAILABLE",
            "Responder number binding state is unavailable.",
            { status: 404 }
          );
          const row = existing.rows[0];
          if (row.state === "retired") {
            invariant(
              row.retire_evidence_digest === selected.retireEvidenceDigest &&
                row.retired_reason === selected.retiredReason,
              "RESPONDER_NUMBER_BINDING_IDEMPOTENCY_CONFLICT",
              "The binding retirement was reused for different facts.",
              { status: 409 }
            );
            return receipt(row, true);
          }
          const changed = await client.query(
            `update ss.responder_provider_number_bindings
                set state = 'retired', retired_at = $3,
                    retired_by_user_id = $4, retire_evidence_digest = $5,
                    retired_reason = $6, revision = revision + 1,
                    updated_at = $3
              where id = $1 and organization_id = $2 and state = 'active'
              returning *`,
            [
              selected.bindingId, selected.organizationId,
              selected.recordedAt, actor.userId,
              selected.retireEvidenceDigest, selected.retiredReason
            ]
          );
          invariant(
            changed.rowCount === 1,
            "RESPONDER_NUMBER_BINDING_RETRY_REQUIRED",
            "Responder number binding state changed; retry safely.",
            { status: 409 }
          );
          return receipt(changed.rows[0]);
        }
      ));
    },

    listBindings(actor, organizationId) {
      const selectedOrganization = uuid(organizationId, "Organization ID");
      return translated(() => authority.service(
        { ...operatorContext(actor), readOnly: true },
        async (client) => {
          const rows = await client.query(
            `select * from ss.responder_provider_number_bindings
              where organization_id = $1
              order by provisioned_at desc, id desc
              limit 200`,
            [selectedOrganization]
          );
          return deepFreeze({
            schema: "sitesourcery.responder-number-binding-list/v1",
            organizationId: selectedOrganization,
            providerEffects: false,
            bindings: rows.rows.map((row) => receipt(row))
          });
        }
      ));
    }
  });
}
