import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const STATUSES = new Set([
  "queued", "sending", "sent", "delivered",
  "undelivered", "failed", "canceled"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function exactObject(value, fields) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID",
    "Twilio Responder callback evidence is invalid.",
    { status: 500 }
  );
  return value;
}

function sha256(value, field, { nullable = false } = {}) {
  invariant(
    (nullable && value === null) ||
      (typeof value === "string" && SHA256.test(value)),
    "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function iso(value) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID",
    "Twilio callback receipt time is invalid.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "TWILIO_RESPONDER_EVENT_REPOSITORY_UNAVAILABLE",
      "Twilio Responder callback storage is unavailable.",
      { status: 503 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "TWILIO_RESPONDER_EVENT_RETRY_REQUIRED",
      "Twilio Responder callback storage changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT",
      "Twilio Responder callback evidence conflicts.",
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

function receipt(row, replayed) {
  return deepFreeze({
    schema: "sitesourcery.responder-twilio-delivery-event-receipt/v1",
    eventState: row.event_state,
    messageStatus: row.message_status,
    currentStatus: row.current_status ?? null,
    attentionRequired: row.attention_required === true,
    replayed,
    providerEffects: false
  });
}

export function createPostgresTwilioResponderEventsRepository({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function",
    "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Twilio callbacks.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "twilio-responder-events-postgres",
    providerEffects: false,
    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_twilio_delivery_events_contract_v1()'
              ) is not null
              and ss.hosted_responder_twilio_delivery_events_contract_v1() =
                'canonical-responder-twilio-delivery-events-v1-digest-only-race-safe'
                as contract_ready,
              count(*) = 2
                and bool_and(relation.relrowsecurity)
                and bool_and(relation.relforcerowsecurity) as tables_ready
              from pg_class relation
              join pg_namespace namespace
                on namespace.oid = relation.relnamespace
             where namespace.nspname = 'ss'
               and relation.relname = any($1::text[])
          `, [[
            "responder_delivery_provider_events",
            "responder_delivery_provider_statuses"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.tables_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "twilio-responder-events-postgres",
          providerEffects: false,
          code: ready ? null : "TWILIO_RESPONDER_EVENT_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "twilio-responder-events-postgres",
          providerEffects: false,
          code: "TWILIO_RESPONDER_EVENT_STORAGE_NOT_READY"
        });
      }
    },
    ingestDeliveryStatus(input) {
      exactObject(input, [
        "provider", "providerEventDigest", "providerMessageIdDigest",
        "accountSidDigest", "messageStatus", "errorCodeDigest",
        "signatureVerificationDigest", "payloadDigest", "receivedAt"
      ]);
      invariant(
        input.provider === "twilio" && STATUSES.has(input.messageStatus),
        "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID",
        "Twilio callback provider or status is invalid.",
        { status: 500 }
      );
      const selected = {
        ...input,
        providerEventDigest: sha256(
          input.providerEventDigest, "Provider event digest"
        ),
        providerMessageIdDigest: sha256(
          input.providerMessageIdDigest, "Provider message ID digest"
        ),
        accountSidDigest: sha256(
          input.accountSidDigest, "Account SID digest"
        ),
        errorCodeDigest: sha256(
          input.errorCodeDigest, "Error-code digest", { nullable: true }
        ),
        signatureVerificationDigest: sha256(
          input.signatureVerificationDigest, "Signature verification digest"
        ),
        payloadDigest: sha256(input.payloadDigest, "Payload digest"),
        receivedAt: iso(input.receivedAt)
      };
      invariant(
        selected.providerEventDigest === selected.payloadDigest,
        "TWILIO_RESPONDER_EVENT_REPOSITORY_INVALID",
        "Twilio callback identity must equal its exact raw-payload digest.",
        { status: 500 }
      );
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [selected.providerEventDigest]
          );
          const prior = await client.query(
            `select event.*, projection.current_status,
                    projection.attention_required
               from ss.responder_delivery_provider_events event
               left join ss.responder_delivery_provider_statuses projection
                 on projection.operation_id = event.operation_id
              where event.provider_event_digest = $1`,
            [selected.providerEventDigest]
          );
          if (prior.rowCount === 1) {
            const row = prior.rows[0];
            invariant(
              row.provider === selected.provider &&
                row.provider_message_id_digest ===
                  selected.providerMessageIdDigest &&
                row.account_sid_digest === selected.accountSidDigest &&
                row.message_status === selected.messageStatus &&
                row.error_code_digest === selected.errorCodeDigest &&
                row.signature_verification_digest ===
                  selected.signatureVerificationDigest &&
                row.payload_digest === selected.payloadDigest,
              "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT",
              "Twilio callback identity was reused for different evidence.",
              { status: 409 }
            );
            return receipt(row, true);
          }
          invariant(
            prior.rowCount === 0,
            "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT",
            "Twilio callback identity is not unique.",
            { status: 409 }
          );
          const inserted = await client.query(
            `insert into ss.responder_delivery_provider_events (
               id, provider, provider_event_digest,
               provider_message_id_digest, account_sid_digest,
               message_status, error_code_digest,
               signature_verification_digest, payload_digest,
               received_at, operation_id, organization_id,
               event_state, reconciled_at, created_at
             ) values (
               $1, 'twilio',
               ss.responder_delivery_provider_event_digest(
                 $2, $3, $4, $5, $6, $7
               ),
               $2, $3, $4, $5, $6, $7, $8,
               null, null, 'pending', null, $8
             ) returning id`,
            [
              randomUUID(), selected.providerMessageIdDigest,
              selected.accountSidDigest, selected.messageStatus,
              selected.errorCodeDigest,
              selected.signatureVerificationDigest,
              selected.payloadDigest, selected.receivedAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT",
            "Twilio callback evidence was not durably recorded.",
            { status: 409 }
          );
          const durable = await client.query(
            `select event.*, projection.current_status,
                    projection.attention_required
               from ss.responder_delivery_provider_events event
               left join ss.responder_delivery_provider_statuses projection
                 on projection.operation_id = event.operation_id
              where event.id = $1`,
            [inserted.rows[0].id]
          );
          invariant(
            durable.rowCount === 1 &&
              durable.rows[0].provider_event_digest ===
                selected.providerEventDigest,
            "TWILIO_RESPONDER_EVENT_REPOSITORY_CONFLICT",
            "Twilio callback evidence readback failed.",
            { status: 409 }
          );
          return receipt(durable.rows[0], false);
        }
      ));
    }
  });
}
