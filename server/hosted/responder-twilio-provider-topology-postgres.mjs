import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REGISTRATION_CLASSES = new Set([
  "STANDARD", "LOW_VOLUME_STANDARD", "SOLE_PROPRIETOR"
]);
const RETIRED_REASONS = new Set([
  "customer_cancelled", "provider_replaced", "operator_correction"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const DIGEST_FIELDS = Object.freeze([
  "accountSidDigest",
  "messagingServiceSidDigest",
  "customerProfileSidDigest",
  "brandRegistrationSidDigest",
  "campaignSidDigest",
  "messagingApiKeySidDigest",
  "messagingApiKeySecretDigest",
  "webhookAuthTokenDigest",
  "voiceApiKeySidDigest",
  "voiceApiKeySecretDigest",
  "voiceSandboxPushCredentialSidDigest",
  "voiceProductionPushCredentialSidDigest",
  "voiceAndroidSandboxPushCredentialSidDigest",
  "voiceAndroidProductionPushCredentialSidDigest"
]);

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    `${field} is invalid.`,
    { status: 400, details: { providerEffects: false } }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    `${field} is invalid.`,
    { status: 400, details: { providerEffects: false } }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_TWILIO_TOPOLOGY_UNAVAILABLE",
      "Responder Twilio topology is unavailable.",
      { status: 404, details: { providerEffects: false } }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_TWILIO_TOPOLOGY_RETRY_REQUIRED",
      "Responder Twilio topology changed; retry safely.",
      { status: 409, details: { providerEffects: false } }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_TWILIO_TOPOLOGY_CONFLICT",
      "The Responder Twilio topology conflicts with durable evidence.",
      { status: 409, details: { providerEffects: false } }
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
    schema: "sitesourcery.responder-twilio-provider-topology-receipt/v1",
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    accountSidDigest: row.account_sid_digest,
    messagingServiceSidDigest: row.messaging_service_sid_digest,
    customerProfileSidDigest: row.customer_profile_sid_digest,
    brandRegistrationSidDigest: row.brand_registration_sid_digest,
    campaignSidDigest: row.campaign_sid_digest,
    messagingApiKeySidDigest: row.messaging_api_key_sid_digest,
    messagingApiKeySecretDigest: row.messaging_api_key_secret_digest,
    webhookAuthTokenDigest: row.webhook_auth_token_digest,
    voiceApiKeySidDigest: row.voice_api_key_sid_digest,
    voiceApiKeySecretDigest: row.voice_api_key_secret_digest,
    voiceSandboxPushCredentialSidDigest:
      row.voice_sandbox_push_credential_sid_digest,
    voiceProductionPushCredentialSidDigest:
      row.voice_production_push_credential_sid_digest,
    voiceAndroidSandboxPushCredentialSidDigest:
      row.voice_android_sandbox_push_credential_sid_digest,
    voiceAndroidProductionPushCredentialSidDigest:
      row.voice_android_production_push_credential_sid_digest,
    registrationClass: row.registration_class,
    providerBrandType: row.provider_brand_type,
    campaignUseCase: row.campaign_use_case,
    providerReadbackDigest: row.provider_readback_digest,
    topologyEvidenceDigest: row.topology_evidence_digest,
    state: row.state,
    attestedAt: row.attested_at instanceof Date
      ? row.attested_at.toISOString()
      : String(row.attested_at),
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
    "RESPONDER_TWILIO_TOPOLOGY_UNAVAILABLE",
    "Responder Twilio topology authority is unavailable.",
    { status: 404, details: { providerEffects: false } }
  );
  return {
    actorKind: "operator",
    userId: actor.userId,
    organizationId: actor.organizationId,
    isolation: "serializable"
  };
}

function selectedTopology(input) {
  const selected = {
    organizationId: uuid(input.organizationId, "Organization ID"),
    registrationClass: input.registrationClass,
    providerBrandType: input.providerBrandType,
    campaignUseCase: input.campaignUseCase
  };
  for (const field of DIGEST_FIELDS) {
    selected[field] = sha256(input[field], field);
  }
  invariant(
    REGISTRATION_CLASSES.has(selected.registrationClass) &&
      selected.campaignUseCase === "CUSTOMER_CARE" &&
      (
        (selected.registrationClass === "SOLE_PROPRIETOR" &&
          selected.providerBrandType === "SOLE_PROPRIETOR") ||
        (selected.registrationClass !== "SOLE_PROPRIETOR" &&
          selected.providerBrandType === "STANDARD")
      ),
    "RESPONDER_TWILIO_TOPOLOGY_INVALID",
    "The Responder Twilio registration authority is invalid.",
    { status: 400, details: { providerEffects: false } }
  );
  return selected;
}

export function createPostgresResponderTwilioProviderTopologyRepository({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    typeof authority?.service === "function" && typeof randomUUID === "function",
    "RESPONDER_TWILIO_TOPOLOGY_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Twilio topology.",
    { status: 500, details: { providerEffects: false } }
  );

  const repository = {
    kind: "responder-twilio-provider-topology-postgres",
    providerEffects: false,
    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_twilio_isv_topology_contract_v1()'
              ) is not null
              and ss.hosted_responder_twilio_isv_topology_contract_v1() =
                'canonical-responder-twilio-isv-topology-v1-customer-subaccount'
                as contract_ready,
              (select count(*) = 1
                 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname =
                   'responder_twilio_provider_topologies') as table_ready,
              not exists (
                select 1
                  from ss.responder_provider_number_bindings binding
                 where binding.state = 'active'
                   and not exists (
                     select 1
                       from ss.responder_twilio_provider_topologies topology
                      where topology.organization_id = binding.organization_id
                        and topology.provider = binding.provider
                        and topology.state = 'active'
                        and topology.account_sid_digest =
                          binding.account_sid_digest
                        and (
                          binding.messaging_service_sid_digest is null
                          or topology.messaging_service_sid_digest =
                            binding.messaging_service_sid_digest
                        )
                   )
              ) as bindings_match
          `)
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.table_ready === true &&
          row.bindings_match === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-twilio-provider-topology-postgres",
          providerEffects: false,
          code: ready ? null : "RESPONDER_TWILIO_TOPOLOGY_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-twilio-provider-topology-postgres",
          providerEffects: false,
          code: "RESPONDER_TWILIO_TOPOLOGY_STORAGE_NOT_READY"
        });
      }
    },

    attestTopology(actor, input) {
      const topology = selectedTopology(input);
      const selected = {
        ...topology,
        commandId: input.commandId,
        requestDigest: sha256(input.requestDigest, "Request digest"),
        providerReadbackDigest: sha256(
          input.providerReadbackDigest, "Provider readback digest"
        ),
        topologyEvidenceDigest: sha256(
          input.topologyEvidenceDigest, "Topology evidence digest"
        ),
        recordedAt: input.recordedAt
      };
      return translated(() => authority.service(
        operatorContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-twilio-topology:${selected.commandId}`]
          );
          const prior = await client.query(
            `select * from ss.responder_twilio_provider_topologies
              where command_id = $1`,
            [selected.commandId]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].request_digest === selected.requestDigest,
              "RESPONDER_TWILIO_TOPOLOGY_IDEMPOTENCY_CONFLICT",
              "The topology command was reused for different facts.",
              { status: 409, details: { providerEffects: false } }
            );
            return receipt(prior.rows[0], true);
          }
          const inserted = await client.query(
            `insert into ss.responder_twilio_provider_topologies (
               id, command_id, request_digest, organization_id, provider,
               account_sid_digest, messaging_service_sid_digest,
               customer_profile_sid_digest, brand_registration_sid_digest,
               campaign_sid_digest, messaging_api_key_sid_digest,
               messaging_api_key_secret_digest, webhook_auth_token_digest,
               voice_api_key_sid_digest, voice_api_key_secret_digest,
               voice_sandbox_push_credential_sid_digest,
               voice_production_push_credential_sid_digest,
               voice_android_sandbox_push_credential_sid_digest,
               voice_android_production_push_credential_sid_digest,
               registration_class, provider_brand_type, campaign_use_case,
               provider_readback_digest, topology_evidence_digest, state,
               attested_by_user_id, attested_at, revision, created_at, updated_at
             ) values (
               $1, $2, $3, $4, 'twilio', $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
               $23, 'active', $24, $25, 1, $25, $25
             ) returning *`,
            [
              randomUUID(), selected.commandId, selected.requestDigest,
              selected.organizationId, selected.accountSidDigest,
              selected.messagingServiceSidDigest,
              selected.customerProfileSidDigest,
              selected.brandRegistrationSidDigest, selected.campaignSidDigest,
              selected.messagingApiKeySidDigest,
              selected.messagingApiKeySecretDigest,
              selected.webhookAuthTokenDigest,
              selected.voiceApiKeySidDigest,
              selected.voiceApiKeySecretDigest,
              selected.voiceSandboxPushCredentialSidDigest,
              selected.voiceProductionPushCredentialSidDigest,
              selected.voiceAndroidSandboxPushCredentialSidDigest,
              selected.voiceAndroidProductionPushCredentialSidDigest,
              selected.registrationClass, selected.providerBrandType,
              selected.campaignUseCase, selected.providerReadbackDigest,
              selected.topologyEvidenceDigest, actor.userId, selected.recordedAt
            ]
          );
          return receipt(inserted.rows[0]);
        }
      ));
    },

    retireTopology(actor, input) {
      const selected = {
        organizationId: uuid(input.organizationId, "Organization ID"),
        topologyId: uuid(input.topologyId, "Topology ID"),
        reason: input.reason,
        retireEvidenceDigest: sha256(
          input.retireEvidenceDigest, "Retire evidence digest"
        ),
        recordedAt: input.recordedAt
      };
      invariant(
        RETIRED_REASONS.has(selected.reason),
        "RESPONDER_TWILIO_TOPOLOGY_INVALID",
        "The topology retirement reason is invalid.",
        { status: 400, details: { providerEffects: false } }
      );
      return translated(() => authority.service(
        operatorContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-twilio-topology:${selected.topologyId}`]
          );
          const existing = await client.query(
            `select * from ss.responder_twilio_provider_topologies
              where id = $1 and organization_id = $2 for update`,
            [selected.topologyId, selected.organizationId]
          );
          invariant(
            existing.rowCount === 1,
            "RESPONDER_TWILIO_TOPOLOGY_UNAVAILABLE",
            "Responder Twilio topology is unavailable.",
            { status: 404, details: { providerEffects: false } }
          );
          const row = existing.rows[0];
          if (row.state === "retired") {
            invariant(
              row.retired_reason === selected.reason &&
                row.retire_evidence_digest === selected.retireEvidenceDigest,
              "RESPONDER_TWILIO_TOPOLOGY_IDEMPOTENCY_CONFLICT",
              "The topology retirement was reused for different facts.",
              { status: 409, details: { providerEffects: false } }
            );
            return receipt(row, true);
          }
          const changed = await client.query(
            `update ss.responder_twilio_provider_topologies
                set state = 'retired', retired_at = $3,
                    retired_by_user_id = $4, retire_evidence_digest = $5,
                    retired_reason = $6, revision = revision + 1,
                    updated_at = $3
              where id = $1 and organization_id = $2 and state = 'active'
              returning *`,
            [
              selected.topologyId, selected.organizationId,
              selected.recordedAt, actor.userId,
              selected.retireEvidenceDigest, selected.reason
            ]
          );
          invariant(
            changed.rowCount === 1,
            "RESPONDER_TWILIO_TOPOLOGY_RETRY_REQUIRED",
            "Responder Twilio topology changed; retry safely.",
            { status: 409, details: { providerEffects: false } }
          );
          return receipt(changed.rows[0]);
        }
      ));
    },

    listTopologies(actor, organizationId) {
      const selectedOrganization = uuid(organizationId, "Organization ID");
      return translated(() => authority.service(
        { ...operatorContext(actor), readOnly: true },
        async (client) => {
          const rows = await client.query(
            `select * from ss.responder_twilio_provider_topologies
              where organization_id = $1
              order by attested_at desc, id desc limit 100`,
            [selectedOrganization]
          );
          return deepFreeze({
            schema: "sitesourcery.responder-twilio-provider-topology-list/v1",
            organizationId: selectedOrganization,
            providerEffects: false,
            topologies: rows.rows.map((row) => receipt(row))
          });
        }
      ));
    },

    requireActiveTopology(input) {
      const selected = selectedTopology(input);
      return translated(() => authority.service(
        { actorKind: "system", readOnly: true },
        async (client) => {
          const values = [
            selected.organizationId,
            ...DIGEST_FIELDS.map((field) => selected[field]),
            selected.registrationClass,
            selected.providerBrandType,
            selected.campaignUseCase
          ];
          const result = await client.query(
            `select * from ss.responder_twilio_provider_topologies
              where organization_id = $1 and provider = 'twilio'
                and state = 'active'
                and account_sid_digest = $2
                and messaging_service_sid_digest = $3
                and customer_profile_sid_digest = $4
                and brand_registration_sid_digest = $5
                and campaign_sid_digest = $6
                and messaging_api_key_sid_digest = $7
                and messaging_api_key_secret_digest = $8
                and webhook_auth_token_digest = $9
                and voice_api_key_sid_digest = $10
                and voice_api_key_secret_digest = $11
                and voice_sandbox_push_credential_sid_digest = $12
                and voice_production_push_credential_sid_digest = $13
                and voice_android_sandbox_push_credential_sid_digest = $14
                and voice_android_production_push_credential_sid_digest = $15
                and registration_class = $16
                and provider_brand_type = $17
                and campaign_use_case = $18
              limit 2`,
            values
          );
          invariant(
            result.rowCount === 1,
            "RESPONDER_TWILIO_TOPOLOGY_NOT_ACTIVE",
            "The customer Twilio topology is not active.",
            { status: 503, details: { providerEffects: false } }
          );
          return receipt(result.rows[0]);
        }
      ));
    }
  };
  return Object.freeze(repository);
}
