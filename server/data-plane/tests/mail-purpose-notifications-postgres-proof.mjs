import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

import {
  MAIL_PURPOSE_NOTIFICATION_AUTHORITIES,
  createMailPurposeNotifications
} from "../../hosted/mail-purpose-notifications.mjs";
import {
  createPostgresMailPurposeNotificationRepository
} from "../../hosted/mail-purpose-notifications-postgres.mjs";
import {
  createPostgresNotificationMailDispatchSource
} from "../../hosted/notification-mail-dispatch-postgres.mjs";
import {
  createCanonicalPostgresAuthority
} from "../../hosted/repository-postgres.mjs";

const { Pool } = pg;

const EXPECTED_AUTHORITIES = Object.freeze([
  Object.freeze([
    "custom_progress_updated",
    "project_progress",
    "ss.service_custom_build_progress_updates",
    "custom-build-progress-updated.v1"
  ]),
  Object.freeze([
    "publication_state_changed",
    "publication_domain",
    "ss.publication_control_commands",
    "publication-state-changed.v1"
  ]),
  Object.freeze([
    "domain_lifecycle_updated",
    "publication_domain",
    "ss.domain_provider_lifecycle_states",
    "domain-lifecycle-updated.v1"
  ]),
  Object.freeze([
    "care_ticket_acknowledgment",
    "care",
    "ss.care_commands",
    "care-ticket-acknowledgment.v1"
  ]),
  Object.freeze([
    "care_ticket_update",
    "care",
    "ss.care_commands",
    "care-ticket-update.v1"
  ]),
  Object.freeze([
    "care_ticket_resolved",
    "care",
    "ss.care_commands",
    "care-ticket-resolved.v1"
  ]),
  Object.freeze([
    "care_commerce_quote_held",
    "care",
    "ss.care_commerce_quotes",
    "care-commerce-quote-held.v1"
  ]),
  Object.freeze([
    "care_commerce_reservation_held",
    "care",
    "ss.care_commerce_reservation_events",
    "care-commerce-reservation-held.v1"
  ]),
  Object.freeze([
    "care_commerce_reservation_cancelled",
    "care",
    "ss.care_commerce_reservation_events",
    "care-commerce-reservation-cancelled.v1"
  ]),
  Object.freeze([
    "responder_commerce_quote_held",
    "responder",
    "ss.responder_commerce_quotes",
    "responder-commerce-quote-held.v1"
  ]),
  Object.freeze([
    "responder_commerce_reservation_held",
    "responder",
    "ss.responder_commerce_reservation_events",
    "responder-commerce-reservation-held.v1"
  ]),
  Object.freeze([
    "responder_commerce_reservation_cancelled",
    "responder",
    "ss.responder_commerce_reservation_events",
    "responder-commerce-reservation-cancelled.v1"
  ]),
  Object.freeze([
    "responder_forwarding_updated",
    "responder",
    "ss.responder_forwarding_commands",
    "responder-forwarding-state-changed.v1"
  ]),
  Object.freeze([
    "engagement_followup_ready",
    "marketing_followup",
    "ss.customer_engagements",
    "engagement-followup-ready.v1"
  ])
]);

const EXPECTED_GATES = Object.freeze([
  "readiness-contract-acl-guards",
  "exact-14-compiled-source-arms",
  "owner-publication-domain-identities",
  "real-source-operator-authority",
  "concurrent-semantic-single-reservation",
  "same-command-exact-replay",
  "different-command-semantic-replay",
  "same-command-evidence-conflict",
  "source-mismatch-zero-orphans",
  "cross-tenant-denial",
  "append-only-guard",
  "dispatch-candidate",
  "dispatch-purpose-claim",
  "zero-provider-effects-and-orphans"
]);

function opaque(character) {
  return character.repeat(64);
}

async function expectCode(work, code) {
  let selected = null;
  try {
    await work();
  } catch (error) {
    selected = error;
  }
  assert.ok(selected, `expected ${code}`);
  assert.equal(selected.code, code);
}

function authorityTuples() {
  return Object.entries(MAIL_PURPOSE_NOTIFICATION_AUTHORITIES).map(
    ([notificationKind, value]) => [
      notificationKind,
      value.purposeKind,
      value.table,
      value.templateVersion
    ]
  );
}

function reservationInput({
  actorId,
  commandId,
  contentDigest = opaque("c"),
  operatorOrganizationId,
  source
}) {
  return {
    actorId,
    commandId,
    contentDigest,
    expiresAt: source.expiresAt,
    notificationKind: source.notificationKind,
    operatorOrganizationId,
    purposeKind: source.purposeKind,
    recipientDigest: opaque("a"),
    source: {
      table: source.table,
      id: source.id,
      revision: source.revision,
      digest: source.digest,
      state: source.state
    },
    subjectReferenceDigest: opaque("b"),
    templateVersion: source.templateVersion
  };
}

export async function verifyMailPurposeNotificationsPostgres(
  pool,
  { connectionString }
) {
  assert.equal(typeof connectionString, "string");
  const gates = [];
  const passed = (name) => gates.push(name);
  const proofPool = new Pool({ connectionString, max: 4 });
  const authority = createCanonicalPostgresAuthority({ pool: proofPool });
  try {
    const repository = createPostgresMailPurposeNotificationRepository({
      authority
    });
    const readiness = await repository.readiness();
    assert.equal(readiness.ready, true);
    assert.equal(readiness.verified, true);
    assert.equal(readiness.fiveFamilyReservationReady, true);
    assert.equal(readiness.mailReserved, true);
    assert.equal(readiness.providerEffects, false);
    assert.equal(readiness.deliveryClaimed, false);
    passed("readiness-contract-acl-guards");

    assert.deepEqual(authorityTuples(), EXPECTED_AUTHORITIES);
    const definitionResult = await pool.query(
      "select pg_get_viewdef(" +
      "'ss.mail_purpose_notification_sources'::regclass, true) " +
      "as definition"
    );
    const arms = definitionResult.rows[0].definition.split(/\nUNION ALL\n/u);
    assert.equal(arms.length, 14);
    for (const [
      notificationKind,
      purposeKind,
      sourceTable,
      templateVersion
    ] of EXPECTED_AUTHORITIES) {
      const matches = arms.filter((arm) =>
        arm.includes(`'${notificationKind}'::text AS notification_kind`)
      );
      assert.equal(matches.length, 1, notificationKind);
      assert.match(matches[0], new RegExp(
        `'${purposeKind}'::text AS purpose_kind`, "u"
      ));
      assert.match(matches[0], new RegExp(
        `'${sourceTable.replaceAll(".", "\\.")}'::text AS source_table`, "u"
      ));
      assert.match(matches[0], new RegExp(
        `'${templateVersion.replaceAll(".", "\\.")}'::text AS template_version`,
        "u"
      ));
    }
    passed("exact-14-compiled-source-arms");

    const publicationArm = arms.find((arm) =>
      arm.includes("'publication_state_changed'::text AS notification_kind")
    );
    const domainArm = arms.find((arm) =>
      arm.includes("'domain_lifecycle_updated'::text AS notification_kind")
    );
    assert.match(publicationArm, /command\.action AS source_state/u);
    assert.match(publicationArm, /command\.project_id::text AS reference_id/u);
    assert.match(domainArm, /state\.revision AS source_revision/u);
    assert.match(domainArm, /state\.state_digest AS source_digest/u);
    assert.match(domainArm, /state\.lifecycle_status AS source_state/u);
    assert.match(domainArm, /state\.domain_name::text AS reference_id/u);
    passed("owner-publication-domain-identities");

    const sourceResult = await pool.query(`
      select purpose_kind, notification_kind, template_version,
             source_table, source_id, source_revision, source_digest,
             source_state, source_occurred_at, reference_id,
             organization_id, project_id, source_customer_user_id
        from ss.mail_purpose_notification_sources source
       where notification_kind = 'responder_forwarding_updated'
         and not exists (
           select 1 from ss.mail_purpose_notification_outbox outbox
            where outbox.notification_kind =
                    'responder_forwarding_updated'
              and outbox.source_table = source.source_table
              and outbox.source_id = source.source_id
              and outbox.source_revision = source.source_revision
              and outbox.source_digest = source.source_digest
         )
       order by source_occurred_at desc, source_id
       limit 1
    `);
    assert.equal(sourceResult.rowCount, 1);
    const sourceRow = sourceResult.rows[0];
    const requestedAt = new Date(Math.max(
      Date.now() + 5_000,
      new Date(sourceRow.source_occurred_at).getTime() + 1_000
    )).toISOString();
    const expiresAt = new Date(
      Date.parse(requestedAt) + 2 * 60 * 60 * 1_000
    ).toISOString();
    const source = Object.freeze({
      purposeKind: sourceRow.purpose_kind,
      notificationKind: sourceRow.notification_kind,
      templateVersion: sourceRow.template_version,
      table: sourceRow.source_table,
      id: sourceRow.source_id,
      revision: Number(sourceRow.source_revision),
      digest: sourceRow.source_digest,
      state: sourceRow.source_state,
      expiresAt
    });

    const operatorId = randomUUID();
    const authorizerId = randomUUID();
    await pool.query(
      `insert into auth.users (id, email) values
         ($1, $2), ($3, $4)`,
      [
        operatorId, `mail-purpose-operator-${operatorId}@example.test`,
        authorizerId, `mail-purpose-authorizer-${authorizerId}@example.test`
      ]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (
         user_id, display_name, state
       ) values ($1, 'Mail Purpose Operator', 'active')`,
      [operatorId]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id, authorized_at
       ) values ($1, 'Mail Purpose Operator', 'held', $2, clock_timestamp())`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state, granted_by_user_id, granted_at
       ) values (
         $1, 'service_management_manage', 'held', $2, clock_timestamp()
       )`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at,
         expires_at, created_at
       ) values (
         $1, 'service_management_manage', 1, 'grant', null,
         'deployment_control', clock_timestamp() - interval '1 minute',
         clock_timestamp() + interval '1 day', clock_timestamp()
       )`,
      [operatorId]
    );
    await pool.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
      [sourceRow.organization_id, operatorId]
    );
    const operatorGate = await authority.service(
      { actorKind: "system", readOnly: true },
      (client) => client.query(
        `select
           exists (
             select 1 from ss.organization_memberships membership
              where membership.organization_id = $2
                and membership.user_id = $1
                and membership.state = 'active'
           ) as member,
           ss.service_operator_has_capability(
             $1, 'service_management_manage', $3::timestamptz
           ) as management_allowed`,
        [operatorId, sourceRow.organization_id, requestedAt]
      )
    );
    assert.deepEqual(operatorGate.rows[0], {
      member: true,
      management_allowed: true
    });
    passed("real-source-operator-authority");

    const before = (await pool.query(`
      select
        (select count(*)::integer
           from ss.mail_purpose_notification_outbox) as outbox_count,
        (select count(*)::integer
           from ss.hosted_mail_deliveries
          where message_type = 'purpose_customer_notification') as mail_count,
        (select count(*)::integer
           from ss.hosted_mail_provider_event_inbox) as provider_inbox_count,
        (select count(*)::integer
           from ss.hosted_mail_delivery_events) as delivery_event_count
    `)).rows[0];
    const notifications = createMailPurposeNotifications({
      repository,
      clock: { now: () => requestedAt }
    });
    const firstInput = reservationInput({
      actorId: operatorId,
      commandId: "mail-purpose-real-pg-concurrent-a",
      operatorOrganizationId: sourceRow.organization_id,
      source
    });
    const secondInput = reservationInput({
      actorId: operatorId,
      commandId: "mail-purpose-real-pg-concurrent-b",
      operatorOrganizationId: sourceRow.organization_id,
      source
    });
    const [first, second] = await Promise.all([
      notifications.reserveOperator(firstInput),
      notifications.reserveOperator(secondInput)
    ]);
    assert.equal(first.id, second.id);
    assert.equal(first.mail.messageId, second.mail.messageId);
    assert.equal(first.providerEffectsAuthorized, false);
    assert.equal(first.deliveryClaimed, false);
    passed("concurrent-semantic-single-reservation");

    const sameCommand = await notifications.reserveOperator(firstInput);
    assert.deepEqual(sameCommand, first);
    passed("same-command-exact-replay");

    const semanticReplay = await notifications.reserveOperator(
      reservationInput({
        actorId: operatorId,
        commandId: "mail-purpose-real-pg-semantic-replay",
        operatorOrganizationId: sourceRow.organization_id,
        source
      })
    );
    assert.equal(semanticReplay.id, first.id);
    assert.equal(semanticReplay.reservation.digest, first.reservation.digest);
    passed("different-command-semantic-replay");

    await expectCode(
      () => notifications.reserveOperator(reservationInput({
        actorId: operatorId,
        commandId: firstInput.commandId,
        contentDigest: opaque("d"),
        operatorOrganizationId: sourceRow.organization_id,
        source
      })),
      "MAIL_PURPOSE_NOTIFICATION_IDEMPOTENCY_CONFLICT"
    );
    passed("same-command-evidence-conflict");

    await expectCode(
      () => notifications.reserveOperator(reservationInput({
        actorId: operatorId,
        commandId: "mail-purpose-real-pg-source-mismatch",
        operatorOrganizationId: sourceRow.organization_id,
        source: { ...source, digest: opaque("e") }
      })),
      "MAIL_PURPOSE_NOTIFICATION_SOURCE_UNAVAILABLE"
    );
    const afterMismatch = (await pool.query(`
      select
        (select count(*)::integer
           from ss.mail_purpose_notification_outbox) as outbox_count,
        (select count(*)::integer
           from ss.hosted_mail_deliveries
          where message_type = 'purpose_customer_notification') as mail_count
    `)).rows[0];
    assert.equal(afterMismatch.outbox_count, before.outbox_count + 1);
    assert.equal(afterMismatch.mail_count, before.mail_count + 1);
    passed("source-mismatch-zero-orphans");

    await expectCode(
      () => notifications.reserveOperator(reservationInput({
        actorId: operatorId,
        commandId: "mail-purpose-real-pg-cross-tenant",
        operatorOrganizationId: randomUUID(),
        source
      })),
      "MAIL_PURPOSE_NOTIFICATION_UNAVAILABLE"
    );
    passed("cross-tenant-denial");

    await assert.rejects(
      () => authority.service(
        { actorKind: "system" },
        (client) => client.query(
          `update ss.mail_purpose_notification_outbox
              set template_version = 'invalid-template.v1'
            where id = $1`,
          [first.id]
        )
      ),
      (error) => error?.code === "42501"
    );
    passed("append-only-guard");

    const dispatch = createPostgresNotificationMailDispatchSource({
      authority,
      clock: { now: () => requestedAt }
    });
    const candidates = await dispatch.listDispatchable({ limit: 25 });
    assert.ok(candidates.includes(first.mail.messageId));
    passed("dispatch-candidate");

    const claim = await dispatch.claimForDispatch({
      leaseMs: 30_000,
      messageId: first.mail.messageId,
      workerId: "mail-purpose-proof-worker"
    });
    assert.equal(claim.status, "claimed");
    assert.equal(claim.sourceKind, "purpose");
    assert.equal(claim.sourceReservationId, first.id);
    assert.equal(claim.providerEffects, false);
    passed("dispatch-purpose-claim");

    const final = (await pool.query(`
      select
        (select count(*)::integer
           from ss.mail_purpose_notification_outbox) as outbox_count,
        (select count(*)::integer
           from ss.hosted_mail_deliveries
          where message_type = 'purpose_customer_notification') as mail_count,
        (select count(*)::integer
           from ss.hosted_mail_provider_event_inbox) as provider_inbox_count,
        (select count(*)::integer
           from ss.hosted_mail_delivery_events) as delivery_event_count,
        not exists (
          select 1
            from ss.hosted_mail_deliveries mail
           where mail.message_type = 'purpose_customer_notification'
             and not exists (
               select 1 from ss.mail_purpose_notification_outbox outbox
                where outbox.mail_message_id = mail.id
             )
        ) as no_orphan_mail,
        not exists (
          select 1
            from ss.mail_purpose_notification_outbox outbox
            join ss.hosted_mail_deliveries mail
              on mail.id = outbox.mail_message_id
           where outbox.provider_effects_authorized
              or outbox.delivery_claimed
              or outbox.state <> 'held'
              or mail.state <> 'pending'
              or mail.provider is not null
              or mail.provider_message_id_digest is not null
        ) as all_effects_held,
        (select count(*)::integer
           from ss.hosted_mail_dispatch_claims
          where message_id = $1
            and source_kind = 'purpose'
            and state = 'claimed') as exact_claim_count
    `, [first.mail.messageId])).rows[0];
    assert.equal(final.outbox_count, before.outbox_count + 1);
    assert.equal(final.mail_count, before.mail_count + 1);
    assert.equal(final.provider_inbox_count, before.provider_inbox_count);
    assert.equal(final.delivery_event_count, before.delivery_event_count);
    assert.equal(final.no_orphan_mail, true);
    assert.equal(final.all_effects_held, true);
    assert.equal(final.exact_claim_count, 1);
    passed("zero-provider-effects-and-orphans");

    assert.deepEqual(gates, EXPECTED_GATES);
    return Object.freeze({
      assertions: gates.length,
      expectedAssertions: EXPECTED_GATES.length,
      sourceArms: arms.length,
      reservations: final.outbox_count - before.outbox_count,
      purposeMail: final.mail_count - before.mail_count,
      dispatchClaims: final.exact_claim_count,
      providerEffects: false,
      deliveryEffects: false,
      orphanRows: 0
    });
  } finally {
    await proofPool.end();
  }
}
