import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const CONSTRAINT_CODES = new Set(["23503", "23505", "23514", "55000"]);
const ALLOWED_TRANSITIONS = Object.freeze({
  provider_accepted: new Set(["delivered", "bounced", "complained", "suppressed"]),
  delivered: new Set(["complained", "suppressed"]),
  bounced: new Set(["suppressed"]),
  complained: new Set(["suppressed"])
});

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "MAIL_LIFECYCLE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for mail lifecycle state.",
    { status: 500 }
  );
  return authority;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "MAIL_LIFECYCLE_RETRY_REQUIRED",
      "Mail lifecycle state changed concurrently; retry safely.",
      { status: 409 }
    );
  }
  if (CONSTRAINT_CODES.has(error?.code)) {
    return new HostedError(
      "MAIL_LIFECYCLE_REPOSITORY_CONFLICT",
      "The durable mail repository rejected inconsistent evidence.",
      { status: 409 }
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

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function publicDelivery(row) {
  return deepFreeze({
    schema: "sitesourcery.hosted-mail-delivery-receipt/v1",
    messageId: row.id,
    messageType: row.message_type,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    state: row.state,
    provider: row.provider,
    requestedAt: iso(row.requested_at),
    expiresAt: iso(row.expires_at),
    providerAcceptedAt: row.provider_accepted_at
      ? iso(row.provider_accepted_at)
      : null,
    terminalAt: row.terminal_at ? iso(row.terminal_at) : null,
    revision: Number(row.revision)
  });
}

function acceptanceReceipt(row) {
  return deepFreeze({
    schema: "sitesourcery.hosted-mail-provider-acceptance-receipt/v1",
    messageId: row.id,
    acceptanceState: "provider_accepted",
    currentState: row.state,
    provider: row.provider,
    acceptedAt: iso(row.provider_accepted_at),
    revision: Number(row.revision)
  });
}

async function lockDelivery(client, messageId) {
  const result = await client.query(
    `select * from ss.hosted_mail_deliveries where id = $1 for update`,
    [messageId]
  );
  invariant(
    result.rowCount === 1,
    "MAIL_DELIVERY_UNAVAILABLE",
    "The mail delivery is unavailable.",
    { status: 404 }
  );
  return result.rows[0];
}

async function resolveUnmatchedException(client, inboxId, resolvedAt) {
  await client.query(
    `update ss.hosted_mail_exception_projection
        set state = 'resolved', resolved_at = $2, updated_at = $2
      where provider_inbox_event_id = $1 and state = 'open'`,
    [inboxId, resolvedAt]
  );
}

async function projectMessageException(client, delivery, inbox, kind, at) {
  const safeReferenceDigest = digest({
    schema: "sitesourcery.hosted-mail-exception-reference/v1",
    messageId: delivery.id,
    eventKind: kind,
    eventDigest: inbox?.normalized_event_digest ?? null,
    observedAt: at
  });
  await client.query(
    `insert into ss.hosted_mail_exception_projection (
       id, message_id, provider_inbox_event_id, organization_id, project_id,
       message_type, exception_kind, safe_reference_digest, state,
       opened_at, resolved_at, revision, created_at, updated_at
     ) values ($1, $2, null, $3, $4, $5, $6, $7, 'open', $8, null, 1, $8, $8)
     on conflict (message_id) do update
       set exception_kind = excluded.exception_kind,
           safe_reference_digest = excluded.safe_reference_digest,
           state = 'open', resolved_at = null,
           updated_at = excluded.updated_at`,
    [
      systemRandomUUID(),
      delivery.id,
      delivery.organization_id,
      delivery.project_id,
      delivery.message_type,
      kind,
      safeReferenceDigest,
      at
    ]
  );
}

async function conflictInbox(client, delivery, inbox, code, at) {
  await client.query(
    `update ss.hosted_mail_provider_event_inbox
        set state = 'conflict', applied_message_id = $2,
            resolved_at = $3, conflict_code = $4
      where id = $1`,
    [inbox.id, delivery.id, at, code]
  );
  await resolveUnmatchedException(client, inbox.id, at);
  await projectMessageException(
    client,
    delivery,
    inbox,
    "provider_event_conflict",
    at
  );
  return deepFreeze({
    schema: "sitesourcery.hosted-mail-provider-event-receipt/v1",
    eventState: "conflict",
    eventKind: inbox.event_kind,
    currentState: delivery.state
  });
}

async function applyInbox(client, delivery, inbox, recordedAt) {
  const allowed = ALLOWED_TRANSITIONS[delivery.state]?.has(inbox.event_kind) === true;
  if (
    !allowed ||
    Date.parse(iso(inbox.occurred_at)) < Date.parse(iso(delivery.provider_accepted_at)) ||
    (delivery.terminal_at &&
      Date.parse(iso(inbox.occurred_at)) < Date.parse(iso(delivery.terminal_at)))
  ) {
    return conflictInbox(
      client,
      delivery,
      inbox,
      ["pending", "expired"].includes(delivery.state)
        ? "MESSAGE_NOT_PROVIDER_ACCEPTED"
        : "TERMINAL_TRANSITION_CONFLICT",
      recordedAt
    );
  }

  const changed = await client.query(
    `update ss.hosted_mail_deliveries
        set state = $2, terminal_at = $3, updated_at = $4
      where id = $1
      returning *`,
    [delivery.id, inbox.event_kind, inbox.occurred_at, recordedAt]
  );
  const updated = changed.rows[0];
  const eventId = systemRandomUUID();
  await client.query(
    `insert into ss.hosted_mail_delivery_events (
       id, message_id, event_sequence, predecessor_event_id, event_source,
       event_kind, provider, provider_event_id_digest,
       provider_message_id_digest, evidence_digest, resulting_state,
       occurred_at, recorded_at, event_digest, created_at
     ) values ($1, $2, 1, null, 'provider', $3, $4, $5, $6, $7,
       $3, $8, $9, $7, $9)`,
    [
      eventId,
      delivery.id,
      inbox.event_kind,
      inbox.provider,
      inbox.provider_event_id_digest,
      inbox.provider_message_id_digest,
      inbox.evidence_digest,
      inbox.occurred_at,
      recordedAt
    ]
  );
  await client.query(
    `update ss.hosted_mail_provider_event_inbox
        set state = 'applied', applied_message_id = $2,
            applied_delivery_event_id = $3, resolved_at = $4
      where id = $1`,
    [inbox.id, delivery.id, eventId, recordedAt]
  );
  await resolveUnmatchedException(client, inbox.id, recordedAt);
  if (["bounced", "complained", "suppressed"].includes(inbox.event_kind)) {
    await projectMessageException(
      client,
      updated,
      inbox,
      inbox.event_kind,
      recordedAt
    );
  }
  if (["complained", "suppressed"].includes(inbox.event_kind)) {
    await client.query(
      `insert into ss.hosted_mail_recipient_suppressions (
         recipient_digest, source_message_id, source_delivery_event_id,
         reason, suppression_digest, suppressed_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $6)
       on conflict (recipient_digest) do nothing`,
      [
        updated.recipient_digest,
        updated.id,
        eventId,
        inbox.event_kind,
        digest({
          schema: "sitesourcery.hosted-mail-recipient-suppression/v1",
          recipientDigest: updated.recipient_digest,
          sourceDeliveryEventId: eventId,
          reason: inbox.event_kind,
          suppressedAt: iso(inbox.occurred_at)
        }),
        inbox.occurred_at
      ]
    );
  }
  return deepFreeze({
    schema: "sitesourcery.hosted-mail-provider-event-receipt/v1",
    eventState: "applied",
    eventKind: inbox.event_kind,
    currentState: updated.state
  });
}

export function createPostgresMailLifecycleRepository({ authority } = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(
            `select
               to_regprocedure('ss.hosted_runtime_contract_v54()') is not null
                 and ss.hosted_runtime_contract_v54() =
                   'canonical-ss-v54-durable-mail-lifecycle' as contract_ready,
               to_regprocedure(
                 'ss.hosted_identity_delivery_acceptance_contract_v1()'
               ) is not null
                 and ss.hosted_identity_delivery_acceptance_contract_v1() =
                   'canonical-ss-hosted-identity-delivery-acceptance-v1'
                 as identity_delivery_ready,
               count(*) = 5 as tables_ready,
               bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])`,
            [[
              "hosted_mail_deliveries",
              "hosted_mail_provider_event_inbox",
              "hosted_mail_delivery_events",
              "hosted_mail_exception_projection",
              "hosted_mail_recipient_suppressions"
            ]]
          )
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.identity_delivery_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "durable-mail-lifecycle-postgres",
          code: ready ? null : "MAIL_LIFECYCLE_NOT_MIGRATED",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "durable-mail-lifecycle-postgres",
          code: "MAIL_LIFECYCLE_DATABASE_UNAVAILABLE",
          providerEffects: false
        });
      }
    },

    async reserve(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await client.query(
            `select * from ss.hosted_mail_deliveries where command_id = $1`,
            [input.commandId]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].request_digest === input.requestDigest,
              "MAIL_LIFECYCLE_IDEMPOTENCY_CONFLICT",
              "That mail command was already used for different evidence.",
              { status: 409 }
            );
            return publicDelivery(prior.rows[0]);
          }
          const messageId = systemRandomUUID();
          const created = await client.query(
            `insert into ss.hosted_mail_deliveries (
               id, command_id, request_digest, message_type, organization_id,
               project_id, customer_user_id, recipient_digest,
               subject_reference_digest, content_digest, template_version,
               state, requested_at, expires_at, created_at, updated_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'pending', $12, $13, $12, $12)
             returning *`,
            [
              messageId, input.commandId, input.requestDigest,
              input.messageType, input.organizationId, input.projectId,
              input.customerUserId, input.recipientDigest,
              input.subjectReferenceDigest, input.contentDigest,
              input.templateVersion, input.requestedAt, input.expiresAt
            ]
          );
          return publicDelivery(created.rows[0]);
        }
      ));
    },

    async recordProviderAcceptance(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const existingCommand = await client.query(
            `select * from ss.hosted_mail_deliveries
              where acceptance_command_id = $1`,
            [input.commandId]
          );
          if (existingCommand.rowCount === 1) {
            const row = existingCommand.rows[0];
            invariant(
              row.id === input.messageId &&
                row.acceptance_request_digest === input.requestDigest,
              "MAIL_LIFECYCLE_IDEMPOTENCY_CONFLICT",
              "That acceptance command was already used for different evidence.",
              { status: 409 }
            );
            return acceptanceReceipt(row);
          }
          const delivery = await lockDelivery(client, input.messageId);
          invariant(
            delivery.state === "pending" &&
              Date.parse(input.acceptedAt) >= Date.parse(iso(delivery.requested_at)) &&
              Date.parse(input.acceptedAt) < Date.parse(iso(delivery.expires_at)),
            "MAIL_ACCEPTANCE_UNAVAILABLE",
            "The provider acceptance cannot be applied to this delivery.",
            { status: 409 }
          );
          const accepted = await client.query(
            `update ss.hosted_mail_deliveries
                set state = 'provider_accepted', provider = $2,
                    provider_message_id_digest = $3,
                    acceptance_command_id = $4,
                    acceptance_request_digest = $5,
                    acceptance_evidence_digest = $6,
                    provider_accepted_at = $7, updated_at = $8
              where id = $1 returning *`,
            [
              delivery.id, input.provider, input.providerMessageIdDigest,
              input.commandId, input.requestDigest, input.evidenceDigest,
              input.acceptedAt, input.recordedAt
            ]
          );
          await client.query(
            `insert into ss.hosted_mail_delivery_events (
               id, message_id, event_sequence, predecessor_event_id,
               event_source, event_kind, provider,
               provider_event_id_digest, provider_message_id_digest,
               evidence_digest, resulting_state, occurred_at, recorded_at,
               event_digest, created_at
             ) values ($1, $2, 1, null, 'application', 'provider_accepted',
               $3, null, $4, $5, 'provider_accepted', $6, $7, $5, $7)`,
            [
              systemRandomUUID(), delivery.id, input.provider,
              input.providerMessageIdDigest, input.evidenceDigest,
              input.acceptedAt, input.recordedAt
            ]
          );
          let current = accepted.rows[0];
          const pending = await client.query(
            `select * from ss.hosted_mail_provider_event_inbox
              where provider = $1 and provider_message_id_digest = $2
                and state = 'pending'
              order by occurred_at, id
              for update`,
            [input.provider, input.providerMessageIdDigest]
          );
          for (const inbox of pending.rows) {
            await applyInbox(client, current, inbox, input.recordedAt);
            current = (await client.query(
              `select * from ss.hosted_mail_deliveries where id = $1`,
              [delivery.id]
            )).rows[0];
          }
          return acceptanceReceipt(current);
        }
      ));
    },

    async ingestProviderEvent(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const lockKey = `${input.provider}:${input.providerEventIdDigest}`;
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [lockKey]
          );
          const prior = await client.query(
            `select * from ss.hosted_mail_provider_event_inbox
              where provider = $1 and provider_event_id_digest = $2`,
            [input.provider, input.providerEventIdDigest]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].normalized_event_digest === input.normalizedEventDigest,
              "MAIL_PROVIDER_EVENT_IDEMPOTENCY_CONFLICT",
              "That provider event identity was reused for different evidence.",
              { status: 409 }
            );
            return deepFreeze({
              schema: "sitesourcery.hosted-mail-provider-event-receipt/v1",
              eventState: prior.rows[0].state,
              eventKind: prior.rows[0].event_kind,
              currentState: null
            });
          }
          const inboxId = systemRandomUUID();
          const inserted = await client.query(
            `insert into ss.hosted_mail_provider_event_inbox (
               id, provider, provider_event_id_digest,
               provider_message_id_digest, event_kind,
               normalized_event_digest, signature_verification_digest,
               evidence_digest, occurred_at, ingested_at, state, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               'pending', $10) returning *`,
            [
              inboxId, input.provider, input.providerEventIdDigest,
              input.providerMessageIdDigest, input.eventKind,
              input.normalizedEventDigest, input.signatureVerificationDigest,
              input.evidenceDigest, input.occurredAt, input.ingestedAt
            ]
          );
          const matched = await client.query(
            `select * from ss.hosted_mail_deliveries
              where provider = $1 and provider_message_id_digest = $2
              for update`,
            [input.provider, input.providerMessageIdDigest]
          );
          if (matched.rowCount === 0) {
            await client.query(
              `insert into ss.hosted_mail_exception_projection (
                 id, message_id, provider_inbox_event_id, organization_id,
                 project_id, message_type, exception_kind,
                 safe_reference_digest, state, opened_at, resolved_at,
                 revision, created_at, updated_at
               ) values ($1, null, $2, null, null, null,
                 'unmatched_provider_event', $3, 'open', $4, null, 1, $4, $4)`,
              [
                systemRandomUUID(), inboxId,
                digest({
                  schema: "sitesourcery.hosted-mail-unmatched-event/v1",
                  normalizedEventDigest: input.normalizedEventDigest,
                  ingestedAt: input.ingestedAt
                }),
                input.ingestedAt
              ]
            );
            return deepFreeze({
              schema: "sitesourcery.hosted-mail-provider-event-receipt/v1",
              eventState: "pending",
              eventKind: input.eventKind,
              currentState: null
            });
          }
          return applyInbox(client, matched.rows[0], inserted.rows[0], input.ingestedAt);
        }
      ));
    },

    async expire(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await client.query(
            `select * from ss.hosted_mail_deliveries
              where expiration_command_id = $1`,
            [input.commandId]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].id === input.messageId &&
                prior.rows[0].expiration_request_digest === input.requestDigest,
              "MAIL_LIFECYCLE_IDEMPOTENCY_CONFLICT",
              "That expiration command was already used for different evidence.",
              { status: 409 }
            );
            return publicDelivery(prior.rows[0]);
          }
          const delivery = await lockDelivery(client, input.messageId);
          invariant(
            ["pending", "provider_accepted"].includes(delivery.state) &&
              Date.parse(input.expiredAt) >= Date.parse(iso(delivery.expires_at)),
            "MAIL_EXPIRATION_UNAVAILABLE",
            "The mail delivery is not eligible for expiration.",
            { status: 409 }
          );
          const changed = await client.query(
            `update ss.hosted_mail_deliveries
                set state = 'expired', expiration_command_id = $2,
                    expiration_request_digest = $3, terminal_at = $4,
                    updated_at = $4
              where id = $1 returning *`,
            [delivery.id, input.commandId, input.requestDigest, input.expiredAt]
          );
          await client.query(
            `insert into ss.hosted_mail_delivery_events (
               id, message_id, event_sequence, predecessor_event_id,
               event_source, event_kind, provider, provider_event_id_digest,
               provider_message_id_digest, evidence_digest, resulting_state,
               occurred_at, recorded_at, event_digest, created_at
             ) values ($1, $2, 1, null, 'system', 'expired', null, null,
               null, $3, 'expired', $4, $4, $3, $4)`,
            [systemRandomUUID(), delivery.id, input.requestDigest, input.expiredAt]
          );
          await projectMessageException(
            client,
            changed.rows[0],
            null,
            "expired",
            input.expiredAt
          );
          return publicDelivery(changed.rows[0]);
        }
      ));
    },

    async listOwnerExceptions(input) {
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: input.actorId,
          organizationId: input.organizationId,
          readOnly: true
        },
        async (client) => {
          const allowed = await client.query(
            `select ss.service_operator_has_capability(
               $1, $2, clock_timestamp()
             ) as allowed`,
            [input.actorId, "service_case_manage"]
          );
          invariant(
            allowed.rows[0]?.allowed === true,
            "MAIL_EXCEPTION_QUEUE_UNAVAILABLE",
            "The mail exception queue is unavailable.",
            { status: 404 }
          );
          const rows = await client.query(
            `select id, organization_id, project_id, message_type,
                    exception_kind, safe_reference_digest, opened_at,
                    revision
               from ss.hosted_mail_exception_projection
              where state = 'open'
              order by opened_at, id
              limit 100`
          );
          return deepFreeze({
            schema: "sitesourcery.hosted-mail-exception-queue/v1",
            items: rows.rows.map((row) => ({
              id: row.id,
              organizationId: row.organization_id,
              projectId: row.project_id,
              messageType: row.message_type,
              kind: row.exception_kind,
              safeReferenceDigest: row.safe_reference_digest,
              openedAt: iso(row.opened_at),
              revision: Number(row.revision)
            }))
          });
        }
      ));
    }
  });
}
