import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { normalizeEvent } from "./responder-core.mjs";
import { ingestVerifiedEvent } from "./responder-core-postgres.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const CHANNELS = new Set(["sms", "voice"]);
const EVENT_KINDS = new Set([
  "message_received", "call_received", "dial_result"
]);
const DIAL_CALL_STATUSES = new Set([
  "completed", "busy", "no-answer", "failed", "canceled"
]);
const MISSED_DIAL_STATUSES = new Set([
  "busy", "no-answer", "failed", "canceled"
]);
const OPT_OUT_TYPES = new Set(["START", "STOP", "HELP"]);
const INTENTS = new Set(["not_applicable", "message", "stop"]);
const RECEIPT_SCHEMA = "sitesourcery.responder-twilio-inbound-receipt/v1";
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const RETRYABLE_HOSTED = new Set([
  "TWILIO_RESPONDER_INBOUND_RETRY_REQUIRED",
  "RESPONDER_CORE_RETRY_REQUIRED"
]);
const MAXIMUM_ATTEMPTS = 3;
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;

function exactObject(value, fields) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
    "Twilio inbound evidence is invalid.",
    { status: 500 }
  );
  return value;
}

function sha256(value, field, { nullable = false } = {}) {
  invariant(
    (nullable && value === null) ||
      (typeof value === "string" && SHA256.test(value)),
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function iso(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "TWILIO_RESPONDER_INBOUND_REPOSITORY_UNAVAILABLE",
      "Twilio inbound storage is unavailable.",
      { status: 503 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "TWILIO_RESPONDER_INBOUND_RETRY_REQUIRED",
      "Twilio inbound storage changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
      "Twilio inbound evidence conflicts.",
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

function receipt(row, { replayed, suppression = null }) {
  return deepFreeze({
    schema: RECEIPT_SCHEMA,
    channel: row.channel,
    eventKind: row.event_kind,
    eventState: row.state,
    stateReason: row.state_reason ?? null,
    classifiedIntent: row.classified_intent ?? null,
    coreApplied: row.core_provider_event_id !== null &&
      row.core_provider_event_id !== undefined,
    suppression,
    replayed,
    providerEffects: false
  });
}

// Keyed lookup columns are deliberately excluded: they vary across pepper
// rotations, while a Twilio retry replays the exact raw payload. The
// payload digest is the byte-exact identity; the unkeyed derived columns
// are integrity cross-checks.
function identityColumnsMatch(row, fact) {
  return row.provider === "twilio" &&
    row.channel === fact.channel &&
    row.event_kind === fact.eventKind &&
    row.provider_event_id_digest === fact.providerEventIdDigest &&
    row.account_sid_digest === fact.accountSidDigest &&
    (row.messaging_service_sid_digest ?? null) ===
      fact.messagingServiceSidDigest &&
    (row.dial_call_status ?? null) === fact.dialCallStatus &&
    (row.opt_out_type ?? null) === fact.optOutType &&
    row.signature_verification_digest === fact.signatureVerificationDigest &&
    row.payload_digest === fact.payloadDigest;
}

function normalizedFact(input) {
  exactObject(input, [
    "channel", "eventKind", "providerEventIdDigest", "providerEventDigest",
    "payloadDigest", "accountSidDigest", "messagingServiceSidDigest",
    "toNumberLookupDigest", "toNumberKeyVersion",
    "toNumberLookupCandidateDigests", "fromRouteDigest",
    "fromRouteKeyVersion", "contactRouteDigest", "fromRouteEligible",
    "classifiedIntent", "dialCallStatus", "optOutType",
    "signatureVerificationDigest", "evidenceDigest", "receivedAt",
    "material", "sealMaterial"
  ]);
  invariant(
    CHANNELS.has(input.channel) &&
      EVENT_KINDS.has(input.eventKind) &&
      (input.channel === "sms") ===
        (input.eventKind === "message_received") &&
      typeof input.fromRouteEligible === "boolean" &&
      (input.fromRouteEligible === (input.fromRouteDigest !== null)) &&
      (input.fromRouteEligible === (input.fromRouteKeyVersion !== null)) &&
      (input.fromRouteEligible === (input.contactRouteDigest !== null)) &&
      KEY_VERSION.test(input.toNumberKeyVersion ?? "") &&
      (input.fromRouteKeyVersion === null ||
        KEY_VERSION.test(input.fromRouteKeyVersion)) &&
      Array.isArray(input.toNumberLookupCandidateDigests) &&
      input.toNumberLookupCandidateDigests.length >= 1 &&
      input.toNumberLookupCandidateDigests.length <= 8 &&
      input.toNumberLookupCandidateDigests[0] ===
        input.toNumberLookupDigest &&
      (input.classifiedIntent === null ||
        INTENTS.has(input.classifiedIntent)) &&
      (input.dialCallStatus === null ||
        DIAL_CALL_STATUSES.has(input.dialCallStatus)) &&
      (input.eventKind === "dial_result") ===
        (input.dialCallStatus !== null) &&
      (input.optOutType === null || OPT_OUT_TYPES.has(input.optOutType)) &&
      (input.channel === "sms" || input.optOutType === null) &&
      (input.material === null || typeof input.material === "object") &&
      typeof input.sealMaterial === "function",
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
    "Twilio inbound evidence shape is invalid.",
    { status: 500 }
  );
  const selected = {
    ...input,
    providerEventIdDigest: sha256(
      input.providerEventIdDigest, "Provider event ID digest"
    ),
    providerEventDigest: sha256(
      input.providerEventDigest, "Provider event digest"
    ),
    payloadDigest: sha256(input.payloadDigest, "Payload digest"),
    accountSidDigest: sha256(input.accountSidDigest, "Account SID digest"),
    messagingServiceSidDigest: sha256(
      input.messagingServiceSidDigest, "Messaging Service SID digest",
      { nullable: true }
    ),
    toNumberLookupDigest: sha256(
      input.toNumberLookupDigest, "Number lookup digest"
    ),
    toNumberLookupCandidateDigests: input.toNumberLookupCandidateDigests
      .map((candidate) => sha256(candidate, "Number lookup candidate")),
    fromRouteDigest: sha256(
      input.fromRouteDigest, "Caller route lookup digest", { nullable: true }
    ),
    contactRouteDigest: sha256(
      input.contactRouteDigest, "Contact route digest", { nullable: true }
    ),
    signatureVerificationDigest: sha256(
      input.signatureVerificationDigest, "Signature verification digest"
    ),
    evidenceDigest: sha256(input.evidenceDigest, "Evidence digest"),
    receivedAt: iso(input.receivedAt, "Receipt time")
  };
  invariant(
    selected.providerEventDigest === selected.payloadDigest,
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
    "Twilio inbound identity must equal its exact raw-payload digest.",
    { status: 500 }
  );
  return selected;
}

function outcomeForBoundEvent(fact) {
  if (fact.eventKind === "call_received") {
    return { state: "recorded", reason: "call_arrival" };
  }
  if (
    fact.eventKind === "dial_result" &&
    !MISSED_DIAL_STATUSES.has(fact.dialCallStatus)
  ) {
    return { state: "recorded", reason: "call_answered" };
  }
  if (!fact.fromRouteEligible) {
    return {
      state: "recorded",
      reason: fact.channel === "voice" ? "anonymous_caller"
        : "ineligible_route"
    };
  }
  return { state: "applied", reason: null };
}

export function createPostgresTwilioResponderInboundRepository({
  authority,
  verifierKeyVersions,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function" &&
      Array.isArray(verifierKeyVersions) &&
      verifierKeyVersions.length >= 1 &&
      verifierKeyVersions.length <= 8 &&
      verifierKeyVersions.every(
        (entry) => typeof entry === "string" && KEY_VERSION.test(entry)
      ),
    "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Twilio inbound events.",
    { status: 500 }
  );

  async function priorLedgerRow(client, providerEventDigest) {
    const prior = await client.query(
      `select * from ss.responder_twilio_inbound_events
        where provider_event_digest = $1`,
      [providerEventDigest]
    );
    invariant(
      prior.rowCount <= 1,
      "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
      "Twilio inbound identity is not unique.",
      { status: 409 }
    );
    return prior.rows[0] ?? null;
  }

  function replayReceipt(row, fact, suppression = null) {
    invariant(
      identityColumnsMatch(row, fact),
      "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
      "Twilio inbound identity was reused for different evidence.",
      { status: 409 }
    );
    return receipt(row, { replayed: true, suppression });
  }

  async function resolveBinding(fact) {
    return authority.service(
      { actorKind: "system", readOnly: true },
      async (client) => {
        const prior = await priorLedgerRow(client, fact.providerEventDigest);
        if (prior !== null) return { prior };
        const active = await client.query(
          `select * from ss.responder_provider_number_bindings
            where provider = 'twilio'
              and number_lookup_digest = any($1::text[])
              and state = 'active'`,
          [fact.toNumberLookupCandidateDigests]
        );
        invariant(
          active.rowCount <= 1,
          "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
          "Responder number bindings are ambiguous.",
          { status: 409 }
        );
        if (active.rowCount === 0) {
          const retired = await client.query(
            `select 1 from ss.responder_provider_number_bindings
              where provider = 'twilio'
                and number_lookup_digest = any($1::text[])
                and state = 'retired'
              limit 1`,
            [fact.toNumberLookupCandidateDigests]
          );
          return {
            prior: null,
            binding: null,
            unboundReason: retired.rowCount === 1
              ? "retired_binding"
              : "no_binding"
          };
        }
        const binding = active.rows[0];
        if (binding.account_sid_digest !== fact.accountSidDigest) {
          return { prior: null, binding: null,
            unboundReason: "account_mismatch" };
        }
        if (
          fact.channel === "sms" &&
          binding.messaging_service_sid_digest !== null &&
          binding.messaging_service_sid_digest !==
            fact.messagingServiceSidDigest
        ) {
          return { prior: null, binding: null,
            unboundReason: "service_mismatch" };
        }
        return { prior: null, binding, unboundReason: null };
      }
    );
  }

  async function insertLedgerRow(client, fact, {
    id, state, reason, organizationId, projectId, coreProviderEventId
  }) {
    const inserted = await client.query(
      `insert into ss.responder_twilio_inbound_events (
         id, provider, channel, event_kind, provider_event_digest,
         provider_event_id_digest, account_sid_digest,
         messaging_service_sid_digest, to_number_lookup_digest,
         to_number_key_version, from_route_digest, from_route_key_version,
         dial_call_status, opt_out_type, classified_intent,
         signature_verification_digest, payload_digest,
         state, state_reason, organization_id, project_id,
         core_provider_event_id, received_at, created_at
       ) values (
         $1, 'twilio', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $22
       ) returning *`,
      [
        id, fact.channel, fact.eventKind, fact.providerEventDigest,
        fact.providerEventIdDigest, fact.accountSidDigest,
        fact.messagingServiceSidDigest, fact.toNumberLookupDigest,
        fact.toNumberKeyVersion, fact.fromRouteDigest,
        fact.fromRouteKeyVersion, fact.dialCallStatus, fact.optOutType,
        fact.classifiedIntent, fact.signatureVerificationDigest,
        fact.payloadDigest, state, reason, organizationId, projectId,
        coreProviderEventId, fact.receivedAt
      ]
    );
    invariant(
      inserted.rowCount === 1,
      "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
      "Twilio inbound evidence was not durably recorded.",
      { status: 409 }
    );
    return inserted.rows[0];
  }

  async function recordUnbound(fact, unboundReason) {
    return authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`responder-inbound:${fact.providerEventDigest}`]
        );
        const prior = await priorLedgerRow(client, fact.providerEventDigest);
        if (prior !== null) return replayReceipt(prior, fact);
        const row = await insertLedgerRow(client, fact, {
          id: randomUUID(),
          state: "unbound",
          reason: unboundReason,
          organizationId: null,
          projectId: null,
          coreProviderEventId: null
        });
        return receipt(row, { replayed: false });
      }
    );
  }

  // After a durable STOP, no operation for the opted-out contact may retain
  // provider-dispatch authority — including one already claimed but not yet
  // accepted. Cancelling a claimed operation revokes its lease; the material
  // resolver re-validates lease, claim, and consent immediately before any
  // provider call, so a swept operation can no longer dispatch.
  async function suppressionSweep(organizationId, receivedAt) {
    return authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        const swept = await client.query(
          `update ss.responder_delivery_operations operation
              set state = 'cancelled',
                  provider_effects_authorized = false,
                  available_at = null,
                  lease_owner = null,
                  lease_started_at = null,
                  lease_expires_at = null,
                  failure_code = 'RESPONDER_DELIVERY_OPTED_OUT',
                  updated_at = greatest(operation.updated_at, $2::timestamptz)
            where operation.organization_id = $1
              and operation.state in ('queued', 'retry_wait', 'claimed')
              and exists (
                select 1 from ss.responder_contact_authorities authority
                 where authority.id = operation.contact_authority_id
                   and authority.organization_id = operation.organization_id
                   and authority.state <> 'active'
              )`,
          [organizationId, receivedAt]
        );
        return { cancelledOperations: swept.rowCount };
      }
    );
  }

  async function recordBound(fact, binding) {
    const organizationId = binding.organization_id;
    const projectId = binding.project_id;
    const outcome = outcomeForBoundEvent(fact);
    const inboundEventId = randomUUID();

    let sealedEnvelope = null;
    if (outcome.state === "applied" && fact.material !== null) {
      sealedEnvelope = await fact.sealMaterial({
        inboundEventId,
        organizationId,
        projectId,
        channel: fact.channel,
        fromRouteDigest: fact.fromRouteDigest,
        payloadDigest: fact.payloadDigest
      }, fact.material);
      invariant(
        sealedEnvelope &&
          typeof sealedEnvelope.keyVersion === "string" &&
          Buffer.isBuffer(sealedEnvelope.nonce) &&
          Buffer.isBuffer(sealedEnvelope.authenticationTag) &&
          Buffer.isBuffer(sealedEnvelope.ciphertext),
        "TWILIO_RESPONDER_INBOUND_REPOSITORY_INVALID",
        "Twilio inbound material sealing failed.",
        { status: 503 }
      );
    }

    const result = await authority.service(
      {
        actorKind: "system",
        organizationId,
        isolation: "serializable"
      },
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`responder-inbound:${fact.providerEventDigest}`]
        );
        const prior = await priorLedgerRow(client, fact.providerEventDigest);
        if (prior !== null) {
          return { row: prior, replayed: true };
        }
        // The binding was resolved in a separate read-only transaction. A
        // concurrent retire/re-provision must not attribute this evidence
        // to the previous owner, so the exact still-active binding is
        // re-verified here; drift retries the whole resolution.
        const bindingStillCurrent = await client.query(
          `select 1 from ss.responder_provider_number_bindings
            where id = $1 and state = 'active'
              and organization_id = $2 and project_id = $3`,
          [binding.id, organizationId, projectId]
        );
        invariant(
          bindingStillCurrent.rowCount === 1,
          "TWILIO_RESPONDER_INBOUND_RETRY_REQUIRED",
          "Twilio inbound storage changed; retry safely.",
          { status: 409 }
        );
        if (outcome.state === "applied") {
          const existing = await client.query(
            `select 1 from ss.responder_twilio_inbound_events
              where event_kind = $1 and provider_event_id_digest = $2
                and state = 'applied'
              limit 1`,
            [fact.eventKind, fact.providerEventIdDigest]
          );
          if (existing.rowCount === 1) {
            const row = await insertLedgerRow(client, fact, {
              id: inboundEventId,
              state: "superseded",
              reason: "duplicate_payload_variant",
              organizationId,
              projectId,
              coreProviderEventId: null
            });
            return { row, replayed: false };
          }
          const coreEventKind = fact.eventKind === "message_received"
            ? "message_received"
            : "missed_call";
          const normalized = normalizeEvent(
            {
              commandId: `responder-inbound-twilio:${fact.payloadDigest}`,
              eventKind: coreEventKind,
              occurredAt: fact.receivedAt,
              organizationId,
              payloadDigest: fact.payloadDigest,
              projectId,
              providerEventIdDigest: fact.providerEventIdDigest,
              // The proved core consent contract joins on its own unkeyed
              // route-digest family; this transient value is never stored
              // in the keyed inbound ledger, binding, or material tables.
              routeDigest: fact.contactRouteDigest
            },
            {
              provider: "twilio",
              messageIntent: coreEventKind === "missed_call"
                ? "not_applicable"
                : fact.classifiedIntent,
              signatureVerificationDigest: fact.signatureVerificationDigest,
              evidenceDigest: fact.evidenceDigest
            },
            fact.receivedAt
          );
          const coreReceipt = await ingestVerifiedEvent(client, normalized);
          const row = await insertLedgerRow(client, fact, {
            id: inboundEventId,
            state: "applied",
            reason: null,
            organizationId,
            projectId,
            coreProviderEventId: coreReceipt.id
          });
          if (sealedEnvelope !== null) {
            const material = await client.query(
              `insert into ss.responder_inbound_private_materials (
                 inbound_event_id, organization_id, project_id, channel,
                 from_route_digest, payload_digest, key_version, nonce,
                 authentication_tag, ciphertext, envelope_digest, state,
                 created_at, updated_at
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 ss.responder_inbound_material_envelope_digest(
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                 ),
                 'active', $11, $11
               ) returning inbound_event_id`,
              [
                inboundEventId, organizationId, projectId, fact.channel,
                fact.fromRouteDigest, fact.payloadDigest,
                sealedEnvelope.keyVersion, sealedEnvelope.nonce,
                sealedEnvelope.authenticationTag, sealedEnvelope.ciphertext,
                fact.receivedAt
              ]
            );
            invariant(
              material.rowCount === 1,
              "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
              "Twilio inbound material was not durably recorded.",
              { status: 409 }
            );
          }
          return { row, replayed: false };
        }
        const row = await insertLedgerRow(client, fact, {
          id: inboundEventId,
          state: outcome.state,
          reason: outcome.reason,
          organizationId,
          projectId,
          coreProviderEventId: null
        });
        return { row, replayed: false };
      }
    );

    let suppression = null;
    if (
      result.row.state === "applied" &&
      result.row.classified_intent === "stop"
    ) {
      suppression = await suppressionSweep(
        result.row.organization_id,
        fact.receivedAt
      );
    }
    if (result.replayed) {
      return replayReceipt(result.row, fact, suppression);
    }
    return receipt(result.row, { replayed: false, suppression });
  }

  return Object.freeze({
    kind: "twilio-responder-inbound-postgres",
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
              (select count(*) = 3
                 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname = any($1::text[])
              ) as tables_ready,
              not exists (
                select 1 from ss.responder_provider_number_bindings binding
                 where binding.state = 'active'
                   and binding.lookup_key_version <> all($2::text[])
              ) as lookup_keys_cover_bindings
          `, [[
            "responder_provider_number_bindings",
            "responder_twilio_inbound_events",
            "responder_inbound_private_materials"
          ], verifierKeyVersions])
        );
        const row = result.rows[0] ?? {};
        const storageReady = row.contract_ready === true &&
          row.tables_ready === true;
        const coverageReady = row.lookup_keys_cover_bindings === true;
        const ready = storageReady && coverageReady;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "twilio-responder-inbound-postgres",
          providerEffects: false,
          code: ready
            ? null
            : storageReady
              ? "TWILIO_RESPONDER_INBOUND_LOOKUP_KEY_COVERAGE_REQUIRED"
              : "TWILIO_RESPONDER_INBOUND_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "twilio-responder-inbound-postgres",
          providerEffects: false,
          code: "TWILIO_RESPONDER_INBOUND_STORAGE_NOT_READY"
        });
      }
    },

    ingestInboundEvent(input) {
      const fact = normalizedFact(input);
      return translated(async () => {
        let lastError = null;
        for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
          try {
            const resolved = await resolveBinding(fact);
            if (resolved.prior) {
              let suppression = null;
              if (
                resolved.prior.state === "applied" &&
                resolved.prior.classified_intent === "stop"
              ) {
                suppression = await suppressionSweep(
                  resolved.prior.organization_id,
                  fact.receivedAt
                );
              }
              return replayReceipt(resolved.prior, fact, suppression);
            }
            if (resolved.binding === null) {
              return await recordUnbound(fact, resolved.unboundReason);
            }
            return await recordBound(fact, resolved.binding);
          } catch (error) {
            const translatedFailure = translatedError(error);
            if (
              RETRYABLE_HOSTED.has(translatedFailure?.code) &&
              attempt < MAXIMUM_ATTEMPTS
            ) {
              lastError = translatedFailure;
              continue;
            }
            throw translatedFailure;
          }
        }
        throw lastError ?? new HostedError(
          "TWILIO_RESPONDER_INBOUND_RETRY_REQUIRED",
          "Twilio inbound storage changed; retry safely.",
          { status: 409 }
        );
      });
    }
  });
}
