import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { normalizeMailReservation } from "./mail-lifecycle.mjs";

const CONFLICT_CODES = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function authority(value) {
  invariant(
    value && typeof value.service === "function",
    "COMMERCE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for commerce notifications.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "COMMERCE_NOTIFICATION_UNAVAILABLE",
      "Commerce transition notifications are unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "COMMERCE_NOTIFICATION_RETRY_REQUIRED",
      "The notification source changed; retry from authoritative state.",
      { status: 409 }
    );
  }
  if (CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "COMMERCE_NOTIFICATION_REPOSITORY_CONFLICT",
      "The durable notification outbox rejected inconsistent evidence.",
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

function item(row) {
  return deepFreeze({
    schema: "sitesourcery.commerce-transition-notification-read/v1",
    id: row.id,
    audienceKind: row.audience_kind,
    notificationKind: row.notification_kind,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sourceCustomerUserId: row.source_customer_user_id,
    source: {
      table: row.source_table,
      id: row.source_id,
      revision: Number(row.source_revision),
      digest: row.source_digest,
      state: row.source_state,
      occurredAt: iso(row.source_occurred_at)
    },
    reservation: {
      state: row.state,
      digest: row.reservation_digest,
      reservedAt: iso(row.reserved_at),
      expiresAt: iso(row.expires_at)
    },
    mail: {
      messageId: row.mail_message_id,
      lifecycleState: row.mail_state,
      deliveryConfirmed: row.mail_state === "delivered"
    },
    providerEffectsAuthorized: false,
    deliveryClaimed: false,
    revision: Number(row.revision)
  });
}

const ITEM_SELECT = `
  select notification.id, notification.audience_kind,
         notification.notification_kind, notification.organization_id,
         notification.project_id, notification.source_customer_user_id,
         notification.source_table, notification.source_id,
         notification.source_revision, notification.source_digest,
         notification.source_state, notification.source_occurred_at,
         notification.mail_message_id, notification.reservation_digest,
         notification.state, notification.reserved_at,
         notification.expires_at, notification.revision,
         mail.state as mail_state
    from ss.commerce_transition_notification_outbox notification
    join ss.hosted_mail_deliveries mail
      on mail.id = notification.mail_message_id`;

async function readById(client, id) {
  const selected = await client.query(`${ITEM_SELECT} where notification.id = $1`, [id]);
  invariant(
    selected.rowCount === 1,
    "COMMERCE_NOTIFICATION_UNAVAILABLE",
    "The commerce transition notification is unavailable.",
    { status: 404 }
  );
  return item(selected.rows[0]);
}

async function requireOperator(client, actorId) {
  const result = await client.query(
    `select ss.service_operator_has_capability(
       $1, 'service_management_manage', clock_timestamp()
     ) as allowed`,
    [actorId]
  );
  invariant(
    result.rows[0]?.allowed === true,
    "COMMERCE_NOTIFICATION_UNAVAILABLE",
    "Commerce transition notifications are unavailable.",
    { status: 404 }
  );
}

export function createPostgresCommerceTransitionNotificationRepository({
  authority: input
} = {}) {
  const database = authority(input);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_commerce_notification_contract_v1()'
              ) is not null
                and ss.hosted_commerce_notification_contract_v1() =
                  'canonical-commerce-transition-notifications-v1-mail-reserved-held'
                as contract_ready,
              to_regclass(
                'ss.commerce_transition_notification_sources'
              ) is not null as sources_ready,
              relation.relrowsecurity and relation.relforcerowsecurity
                as rls_ready,
              exists (
                select 1
                  from pg_constraint constraint_row
                 where constraint_row.conrelid =
                   'ss.hosted_mail_deliveries'::regclass
                   and constraint_row.contype = 'c'
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%commerce_customer_notification%'
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%commerce_operator_notification%'
              ) as mail_types_ready
            from pg_class relation
            join pg_namespace namespace
              on namespace.oid = relation.relnamespace
           where namespace.nspname = 'ss'
             and relation.relname =
               'commerce_transition_notification_outbox'
          `)
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.sources_ready === true && row.rls_ready === true &&
          row.mail_types_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "commerce-transition-notifications-postgres",
          code: ready ? null : "COMMERCE_NOTIFICATION_NOT_MIGRATED",
          sourceAuthoritative: true,
          mailReserved: true,
          providerEffects: false,
          deliveryClaimed: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "commerce-transition-notifications-postgres",
          code: "COMMERCE_NOTIFICATION_DATABASE_UNAVAILABLE",
          sourceAuthoritative: true,
          mailReserved: false,
          providerEffects: false,
          deliveryClaimed: false
        });
      }
    },

    reserve(input) {
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await client.query(
            `select id, command_id, request_digest
               from ss.commerce_transition_notification_outbox
              where command_id = $1
                 or (
                   audience_kind = $2 and notification_kind = $3
                   and source_table = $4 and source_id = $5
                   and source_revision = $6 and source_digest = $7
                 )`,
            [
              input.commandId, input.audienceKind, input.notificationKind,
              input.source.table, input.source.id, input.source.revision,
              input.source.digest
            ]
          );
          if (prior.rowCount > 0) {
            invariant(
              prior.rowCount === 1 &&
                prior.rows[0].command_id === input.commandId &&
                prior.rows[0].request_digest === input.requestDigest,
              "COMMERCE_NOTIFICATION_IDEMPOTENCY_CONFLICT",
              "That notification transition was reserved with different evidence.",
              { status: 409 }
            );
            return readById(client, prior.rows[0].id);
          }

          const sourceResult = await client.query(
            `select *
               from ss.commerce_transition_notification_sources
              where audience_kind = $1 and notification_kind = $2
                and source_table = $3 and source_id = $4
                and source_revision = $5 and source_digest = $6
                and source_state = $7`,
            [
              input.audienceKind, input.notificationKind,
              input.source.table, input.source.id, input.source.revision,
              input.source.digest, input.source.state
            ]
          );
          invariant(
            sourceResult.rowCount === 1,
            "COMMERCE_NOTIFICATION_SOURCE_UNAVAILABLE",
            "The exact committed notification source is unavailable.",
            { status: 409 }
          );
          const source = sourceResult.rows[0];
          invariant(
            Date.parse(input.requestedAt) >=
              Date.parse(iso(source.source_occurred_at)),
            "COMMERCE_NOTIFICATION_SOURCE_UNAVAILABLE",
            "The notification reservation predates its committed source.",
            { status: 409 }
          );

          const messageId = systemRandomUUID();
          const messageType = input.audienceKind === "customer"
            ? "commerce_customer_notification"
            : "commerce_operator_notification";
          const mail = normalizeMailReservation({
            commandId: input.commandId,
            messageType,
            organizationId: source.organization_id,
            projectId: source.project_id,
            customerUserId: input.audienceKind === "customer"
              ? source.source_customer_user_id
              : null,
            recipientDigest: input.recipientDigest,
            subjectReferenceDigest: input.subjectReferenceDigest,
            contentDigest: input.contentDigest,
            templateVersion: input.templateVersion,
            expiresAt: input.expiresAt
          }, input.requestedAt);
          await client.query(
            `insert into ss.hosted_mail_deliveries (
               id, command_id, request_digest, message_type,
               organization_id, project_id, customer_user_id,
               recipient_digest, subject_reference_digest, content_digest,
               template_version, state, requested_at, expires_at,
               created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               'pending', $12, $13, $12, $12
             )`,
            [
              messageId, mail.commandId, mail.requestDigest, mail.messageType,
              mail.organizationId, mail.projectId, mail.customerUserId,
              mail.recipientDigest, mail.subjectReferenceDigest,
              mail.contentDigest, mail.templateVersion, mail.requestedAt,
              mail.expiresAt
            ]
          );

          const notificationId = systemRandomUUID();
          const sourceOccurredAt = iso(source.source_occurred_at);
          await client.query(
            `insert into ss.commerce_transition_notification_outbox (
               id, command_id, request_digest, audience_kind,
               notification_kind, source_table, source_id, source_revision,
               source_digest, source_state, source_occurred_at,
               organization_id, project_id, source_customer_user_id,
               mail_message_id, mail_request_digest, reservation_digest,
               state, provider_effects_authorized, delivery_claimed,
               reserved_at, expires_at, revision, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16,
               ss.commerce_transition_notification_reservation_digest(
                 $1, $3, $15, $16
               ),
               'held', false, false, $17, $18, 1, $17
             )`,
            [
              notificationId, input.commandId, input.requestDigest,
              input.audienceKind, input.notificationKind,
              input.source.table, input.source.id, input.source.revision,
              input.source.digest, input.source.state, sourceOccurredAt,
              source.organization_id, source.project_id,
              source.source_customer_user_id, messageId, mail.requestDigest,
              input.requestedAt, input.expiresAt
            ]
          );
          return readById(client, notificationId);
        }
      ));
    },

    listCustomer(input) {
      return translated(() => database.service(
        {
          actorKind: "customer",
          userId: input.actorId,
          organizationId: input.organizationId,
          readOnly: true
        },
        async (client) => {
          const selected = await client.query(
            `${ITEM_SELECT}
              where notification.audience_kind = 'customer'
                and notification.source_customer_user_id = $1
                and notification.organization_id = $2
                and notification.project_id = $3
              order by notification.reserved_at desc, notification.id
              limit 100`,
            [input.actorId, input.organizationId, input.projectId]
          );
          return deepFreeze({
            schema: "sitesourcery.customer-commerce-notifications/v1",
            sourceAuthoritative: true,
            items: selected.rows.map(item)
          });
        }
      ));
    },

    listOperator(input) {
      return translated(() => database.service(
        {
          actorKind: "operator",
          userId: input.actorId,
          organizationId: input.operatorOrganizationId,
          readOnly: true
        },
        async (client) => {
          await requireOperator(client, input.actorId);
          const selected = await client.query(
            `${ITEM_SELECT}
              where notification.audience_kind = 'operator'
              order by notification.reserved_at desc, notification.id
              limit 200`
          );
          return deepFreeze({
            schema: "sitesourcery.operator-commerce-notifications/v1",
            sourceAuthoritative: true,
            items: selected.rows.map(item)
          });
        }
      ));
    }
  });
}
