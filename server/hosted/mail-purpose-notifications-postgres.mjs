import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { normalizeMailReservation } from "./mail-lifecycle.mjs";

const CONFLICT_CODES = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const TICKET_KINDS = new Set([
  "care_ticket_acknowledgment",
  "care_ticket_update",
  "care_ticket_resolved"
]);

function selectedAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "MAIL_PURPOSE_NOTIFICATION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for mail-purpose notifications.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "MAIL_PURPOSE_NOTIFICATION_UNAVAILABLE",
      "Mail-purpose notifications are unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "MAIL_PURPOSE_NOTIFICATION_RETRY_REQUIRED",
      "The notification source changed; retry from authoritative state.",
      { status: 409 }
    );
  }
  if (CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "MAIL_PURPOSE_NOTIFICATION_REPOSITORY_CONFLICT",
      "The durable mail-purpose outbox rejected inconsistent evidence.",
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

async function retryOnceForSerialization(work) {
  try {
    return await work();
  } catch (error) {
    if (!RETRY_CODES.has(error?.code)) throw error;
    return work();
  }
}

function iso(value) {
  return value === null || value === undefined
    ? null
    : value instanceof Date ? value.toISOString() : String(value);
}

function item(row) {
  return deepFreeze({
    schema: "sitesourcery.mail-purpose-notification-read/v1",
    id: row.id,
    purposeKind: row.purpose_kind,
    notificationKind: row.notification_kind,
    templateVersion: row.template_version,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sourceCustomerUserId: row.source_customer_user_id,
    referenceId: row.reference_id,
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
  select notification.id, notification.command_id,
         notification.request_digest, notification.purpose_kind,
         notification.notification_kind, notification.template_version,
         notification.organization_id, notification.project_id,
         notification.source_customer_user_id, notification.reference_id,
         notification.source_table, notification.source_id,
         notification.source_revision, notification.source_digest,
         notification.source_state, notification.source_occurred_at,
         notification.mail_message_id, notification.reservation_digest,
         notification.state, notification.reserved_at,
         notification.expires_at, notification.revision,
         mail.state as mail_state,
         mail.recipient_digest, mail.subject_reference_digest,
         mail.content_digest, mail.request_digest as mail_request_digest
    from ss.mail_purpose_notification_outbox notification
    join ss.hosted_mail_deliveries mail
      on mail.id = notification.mail_message_id`;

async function readById(client, id) {
  const selected = await client.query(
    `${ITEM_SELECT} where notification.id = $1`,
    [id]
  );
  invariant(
    selected.rowCount === 1,
    "MAIL_PURPOSE_NOTIFICATION_UNAVAILABLE",
    "The mail-purpose notification is unavailable.",
    { status: 404 }
  );
  return item(selected.rows[0]);
}

async function requireOperator(client, input) {
  const result = await client.query(
    `select
       exists (
         select 1
           from ss.organization_memberships membership
          where membership.organization_id = $2
            and membership.user_id = $1
            and membership.state = 'active'
       )
       and ss.service_operator_has_capability(
         $1, 'service_management_manage', $3::timestamptz
       ) as management_allowed,
       ss.service_operator_has_capability(
         $1, 'service_case_manage', $3::timestamptz
       ) as case_allowed`,
    [input.actorId, input.operatorOrganizationId, input.requestedAt]
  );
  const row = result.rows[0] ?? {};
  const needsCase = TICKET_KINDS.has(input.notificationKind) ||
    input.purposeKind === "marketing_followup";
  invariant(
    row.management_allowed === true &&
      (needsCase === false || row.case_allowed === true),
    "MAIL_PURPOSE_NOTIFICATION_UNAVAILABLE",
    "Mail-purpose notifications are unavailable.",
    { status: 404 }
  );
}

export function createPostgresMailPurposeNotificationRepository({
  authority
} = {}) {
  const database = selectedAuthority(authority);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_mail_purpose_notification_contract_v1()'
              ) is not null
                and ss.hosted_mail_purpose_notification_contract_v1() =
                  'canonical-mail-purpose-notifications-v1-five-families-14-sources-held'
                as purpose_contract_ready,
              to_regprocedure(
                'ss.hosted_mail_dispatch_contract_v2()'
              ) is not null
                and ss.hosted_mail_dispatch_contract_v2() =
                  'canonical-mail-dispatch-v2-support-commerce-purpose-leased-held'
                as dispatch_contract_ready,
              to_regclass('ss.mail_purpose_notification_sources')
                is not null as sources_ready,
              relation.relrowsecurity and relation.relforcerowsecurity
                as rls_ready,
              exists (
                select 1
                  from pg_trigger trigger_record
                 where trigger_record.tgrelid = relation.oid
                   and trigger_record.tgname =
                     'mail_purpose_notification_guard'
                   and trigger_record.tgfoid =
                     'ss.guard_mail_purpose_notification()'::regprocedure
                   and trigger_record.tgenabled = 'O'
                   and not trigger_record.tgisinternal
              ) as trigger_ready,
              exists (
                select 1
                  from pg_trigger trigger_record
                 where trigger_record.tgrelid =
                   'ss.hosted_mail_deliveries'::regclass
                   and trigger_record.tgname =
                     'hosted_mail_purpose_scope_guard'
                   and trigger_record.tgfoid =
                     'ss.guard_mail_purpose_notification_mail_scope()'::regprocedure
                   and trigger_record.tgenabled = 'O'
                   and not trigger_record.tgisinternal
              ) as scope_trigger_ready,
              exists (
                select 1
                  from pg_constraint constraint_row
                 where constraint_row.conrelid =
                   'ss.hosted_mail_deliveries'::regclass
                   and constraint_row.conname in (
                     'hosted_mail_deliveries_message_type_check',
                     'hosted_mail_deliveries_scope_check_v140'
                   )
                   and constraint_row.convalidated
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%purpose_customer_notification%'
                 group by constraint_row.conrelid
                having count(*) = 2
              ) as mail_constraints_ready,
              exists (
                select 1
                  from pg_constraint constraint_row
                 where constraint_row.conrelid =
                   'ss.hosted_mail_exception_projection'::regclass
                   and constraint_row.conname =
                     'hosted_mail_exception_projection_message_type_check_v140'
                   and constraint_row.convalidated
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%purpose_customer_notification%'
              ) as exception_constraint_ready,
              exists (
                select 1
                  from pg_constraint constraint_row
                 where constraint_row.conrelid =
                   'ss.hosted_mail_dispatch_claims'::regclass
                   and constraint_row.conname =
                     'hosted_mail_dispatch_claims_source_kind_check_v140'
                   and constraint_row.convalidated
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%purpose%'
              ) as dispatch_constraint_ready,
              exists (
                select 1
                  from pg_trigger trigger_record
                 where trigger_record.tgrelid =
                   'ss.hosted_mail_dispatch_claims'::regclass
                   and trigger_record.tgname =
                     'hosted_mail_dispatch_claims_guard'
                   and trigger_record.tgfoid =
                     'ss.guard_hosted_mail_dispatch_claim()'::regprocedure
                   and trigger_record.tgenabled = 'O'
                   and not trigger_record.tgisinternal
              ) as dispatch_trigger_ready,
              exists (
                select 1
                  from pg_class source_relation
                  join pg_namespace source_namespace
                    on source_namespace.oid = source_relation.relnamespace
                 where source_namespace.nspname = 'ss'
                   and source_relation.relname =
                     'mail_purpose_notification_sources'
                   and source_relation.relkind = 'v'
                   and has_table_privilege(
                     'service_role', source_relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'service_role', source_relation.oid, 'TRIGGER'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'anon', source_relation.oid, 'TRIGGER'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'authenticated', source_relation.oid, 'TRIGGER'
                   )
                   and not exists (
                     select 1
                       from aclexplode(coalesce(
                         source_relation.relacl,
                         acldefault('r', source_relation.relowner)
                       )) source_acl
                      where source_acl.grantee <>
                        source_relation.relowner
                        and source_acl.grantee <> coalesce((
                          select role_record.oid
                            from pg_roles role_record
                           where role_record.rolname = 'service_role'
                        ), 0::oid)
                        and source_acl.privilege_type = any(array[
                          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                          'REFERENCES', 'TRIGGER'
                        ])
                   )
              ) as source_acl_ready,
              has_table_privilege(
                'service_role', relation.oid, 'SELECT'
              ) and has_table_privilege(
                'service_role', relation.oid, 'INSERT'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'TRIGGER'
              ) and coalesce((
                select role_record.rolbypassrls
                  from pg_roles role_record
                 where role_record.rolname = 'service_role'
              ), false) and not has_table_privilege(
                'authenticated', relation.oid, 'SELECT'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'INSERT'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'TRIGGER'
              ) and not has_table_privilege(
                'anon', relation.oid, 'INSERT'
              ) and not has_table_privilege(
                'anon', relation.oid, 'SELECT'
              ) and not has_table_privilege(
                'anon', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'anon', relation.oid, 'TRIGGER'
              ) and not exists (
                select 1
                  from aclexplode(coalesce(
                    relation.relacl,
                    acldefault('r', relation.relowner)
                  )) relation_acl
                 where relation_acl.grantee <> relation.relowner
                   and relation_acl.grantee <> coalesce((
                     select role_record.oid
                       from pg_roles role_record
                      where role_record.rolname = 'service_role'
                   ), 0::oid)
                   and relation_acl.privilege_type = any(array[
                     'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                     'REFERENCES', 'TRIGGER'
                   ])
              ) as acl_ready
            from pg_class relation
            join pg_namespace namespace
              on namespace.oid = relation.relnamespace
           where namespace.nspname = 'ss'
             and relation.relname = 'mail_purpose_notification_outbox'
          `)
        );
        const row = result.rows[0] ?? {};
        const ready = row.purpose_contract_ready === true &&
          row.dispatch_contract_ready === true &&
          row.sources_ready === true && row.rls_ready === true &&
          row.trigger_ready === true && row.scope_trigger_ready === true &&
          row.mail_constraints_ready === true &&
          row.exception_constraint_ready === true &&
          row.dispatch_constraint_ready === true &&
          row.dispatch_trigger_ready === true &&
          row.source_acl_ready === true && row.acl_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "mail-purpose-notifications-postgres",
          code: ready ? null : "MAIL_PURPOSE_NOTIFICATION_NOT_MIGRATED",
          purposeCount: 5,
          sourceCount: 14,
          fiveFamilyReservationReady: ready,
          sourceAuthoritative: true,
          mailReserved: ready,
          providerEffects: false,
          deliveryClaimed: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "mail-purpose-notifications-postgres",
          code: "MAIL_PURPOSE_NOTIFICATION_DATABASE_UNAVAILABLE",
          purposeCount: 5,
          sourceCount: 14,
          fiveFamilyReservationReady: false,
          sourceAuthoritative: true,
          mailReserved: false,
          providerEffects: false,
          deliveryClaimed: false
        });
      }
    },

    reserveOperator(input) {
      return translated(() => retryOnceForSerialization(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`mail-purpose:${input.operatorOrganizationId}:${input.commandId}`]
          );
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [
              `mail-purpose-source:${input.operatorOrganizationId}:` +
              `${input.purposeKind}:${input.notificationKind}:` +
              `${input.source.table}:${input.source.id}:` +
              `${input.source.revision}:${input.source.digest}`
            ]
          );
          await requireOperator(client, input);
          const prior = await client.query(
            `${ITEM_SELECT}
              where notification.organization_id = $8
                and (
                  notification.command_id = $1
                 or (
                   notification.purpose_kind = $2
                   and notification.notification_kind = $3
                   and notification.source_table = $4
                   and notification.source_id = $5
                   and notification.source_revision = $6
                   and notification.source_digest = $7
                 ))`,
            [
              input.commandId, input.purposeKind, input.notificationKind,
              input.source.table, input.source.id, input.source.revision,
              input.source.digest, input.operatorOrganizationId
            ]
          );
          if (prior.rowCount > 0) {
            invariant(
              prior.rowCount === 1 &&
                (
                  (
                    prior.rows[0].command_id === input.commandId &&
                    prior.rows[0].request_digest === input.requestDigest
                  ) ||
                  (
                    prior.rows[0].purpose_kind === input.purposeKind &&
                    prior.rows[0].notification_kind === input.notificationKind &&
                    prior.rows[0].source_table === input.source.table &&
                    prior.rows[0].source_id === input.source.id &&
                    Number(prior.rows[0].source_revision) ===
                      input.source.revision &&
                    prior.rows[0].source_digest === input.source.digest &&
                    prior.rows[0].source_state === input.source.state &&
                    prior.rows[0].template_version === input.templateVersion &&
                    prior.rows[0].recipient_digest === input.recipientDigest &&
                    prior.rows[0].subject_reference_digest ===
                      input.subjectReferenceDigest &&
                    prior.rows[0].content_digest === input.contentDigest &&
                    iso(prior.rows[0].expires_at) === input.expiresAt
                  )
                ),
              "MAIL_PURPOSE_NOTIFICATION_IDEMPOTENCY_CONFLICT",
              "That source was reserved with different notification evidence.",
              { status: 409 }
            );
            return item(prior.rows[0]);
          }

          const sourceResult = await client.query(
            `select source.*
               from ss.mail_purpose_notification_sources source
              where source.purpose_kind = $1
                and source.notification_kind = $2
                and source.template_version = $3
                and source.source_table = $4
                and source.source_id = $5
                and source.source_revision = $6
                and source.source_digest = $7
                and source.source_state = $8
                and source.source_occurred_at <= $9::timestamptz
                and source.organization_id = $10::uuid`,
            [
              input.purposeKind, input.notificationKind,
              input.templateVersion, input.source.table, input.source.id,
              input.source.revision, input.source.digest, input.source.state,
              input.requestedAt, input.operatorOrganizationId
            ]
          );
          invariant(
            sourceResult.rowCount === 1,
            "MAIL_PURPOSE_NOTIFICATION_SOURCE_UNAVAILABLE",
            "The exact committed notification source is unavailable.",
            { status: 409 }
          );
          const source = sourceResult.rows[0];

          const messageId = systemRandomUUID();
          const mail = normalizeMailReservation({
            commandId: `mail-purpose:${input.requestDigest}`,
            messageType: "purpose_customer_notification",
            organizationId: source.organization_id,
            projectId: source.project_id,
            customerUserId: source.source_customer_user_id,
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
          const inserted = await client.query(
            `insert into ss.mail_purpose_notification_outbox (
               id, command_id, request_digest, purpose_kind,
               notification_kind, template_version, source_table, source_id,
               source_revision, source_digest, source_state,
               source_occurred_at, reference_id, organization_id, project_id,
               source_customer_user_id, mail_message_id, mail_request_digest,
               reservation_digest, state, provider_effects_authorized,
               delivery_claimed, reserved_at, expires_at, revision, created_at
             )
             select
               $1::uuid, $2::text, $3::ss.sha256_hex, $4::text,
               $5::text, $6::text, $7::text, $8::text, $9::bigint,
               $10::ss.sha256_hex, $11::text, source.source_occurred_at,
               source.reference_id, source.organization_id,
               source.project_id, source.source_customer_user_id, $12::uuid,
               $13::ss.sha256_hex,
               ss.mail_purpose_notification_reservation_digest(
                 $1::uuid, $3::ss.sha256_hex, $12::uuid,
                 $13::ss.sha256_hex
               ),
               'held', false, false, $14::timestamptz,
               $15::timestamptz, 1, $14::timestamptz
              from ss.mail_purpose_notification_sources source
             where source.purpose_kind = $4
               and source.notification_kind = $5
               and source.template_version = $6
               and source.source_table = $7
               and source.source_id = $8
               and source.source_revision = $9
               and source.source_digest = $10::ss.sha256_hex
               and source.source_state = $11
               and source.source_occurred_at <= $14::timestamptz
             returning id`,
            [
              notificationId, input.commandId, input.requestDigest,
              input.purposeKind, input.notificationKind,
              input.templateVersion, input.source.table, input.source.id,
              input.source.revision, input.source.digest, input.source.state,
              messageId, mail.requestDigest, input.requestedAt,
              input.expiresAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "MAIL_PURPOSE_NOTIFICATION_SOURCE_UNAVAILABLE",
            "The exact committed notification source is unavailable.",
            { status: 409 }
          );
          return readById(client, notificationId);
        }
      )));
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
              where notification.source_customer_user_id = $1
                and notification.organization_id = $2
                and notification.project_id = $3
                and exists (
                  select 1
                    from ss.organization_memberships membership
                    join ss.projects project
                      on project.organization_id = membership.organization_id
                     and project.id = $3
                     and project.lifecycle = 'active'
                   where membership.organization_id = $2
                     and membership.user_id = $1
                     and membership.state = 'active'
                )
              order by notification.reserved_at desc, notification.id
              limit 100`,
            [input.actorId, input.organizationId, input.projectId]
          );
          return deepFreeze({
            schema: "sitesourcery.customer-mail-purpose-notifications/v1",
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
          const allowed = await client.query(
            `select exists (
               select 1 from ss.organization_memberships membership
                where membership.organization_id = $2
                  and membership.user_id = $1
                  and membership.state = 'active'
             ) and ss.service_operator_has_capability(
               $1, 'service_management_manage', clock_timestamp()
             ) as allowed`,
            [input.actorId, input.operatorOrganizationId]
          );
          invariant(
            allowed.rows[0]?.allowed === true,
            "MAIL_PURPOSE_NOTIFICATION_UNAVAILABLE",
            "Mail-purpose notifications are unavailable.",
            { status: 404 }
          );
          const selected = await client.query(
            `${ITEM_SELECT}
              where notification.organization_id = $1
              order by notification.reserved_at desc, notification.id
              limit 200`,
            [input.operatorOrganizationId]
          );
          return deepFreeze({
            schema: "sitesourcery.operator-mail-purpose-notifications/v1",
            sourceAuthoritative: true,
            items: selected.rows.map(item)
          });
        }
      ));
    }
  });
}
