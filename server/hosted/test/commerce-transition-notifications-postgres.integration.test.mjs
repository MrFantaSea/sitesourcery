import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createCommerceTransitionNotifications } from
  "../commerce-transition-notifications.mjs";
import { createPostgresCommerceTransitionNotificationRepository } from
  "../commerce-transition-notifications-postgres.mjs";
import { createOperatorWorkQueue } from "../operator-work-queue.mjs";
import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_COMMERCE_NOTIFY_TEST_URL;
const { Pool } = pg;

function opaqueDigest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("committed payment failure reserves one held MAIL row without claiming delivery", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const operatorId = randomUUID();
    const authorizerId = randomUUID();
    const operatorOrganizationId = randomUUID();
    await pool.query(
      `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
      [
        operatorId, `notify-operator-${operatorId}@example.test`,
        authorizerId, `notify-authorizer-${authorizerId}@example.test`
      ]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (user_id, display_name, state)
       values ($1, 'Notify Operator', 'active'),
              ($2, 'Notify Authorizer', 'active')`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id, authorized_at
       ) values ($1, 'Notify Operator', 'held', $2, clock_timestamp())`,
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
         'deployment_control', clock_timestamp(),
         clock_timestamp() + interval '1 day', clock_timestamp()
       )`,
      [operatorId]
    );

    const authority = createCanonicalPostgresAuthority({ pool });
    const queueRepository = createPostgresOperatorWorkQueueRepository({ authority });
    const selectedNow = new Date().toISOString();
    const queue = createOperatorWorkQueue({
      repository: queueRepository,
      reversalRepair: {
        async reconcileEvidence() {
          assert.fail("invoice finalization evidence has no repair command");
        }
      },
      clock: { now: () => selectedNow }
    });
    const evidenceNonce = randomUUID();
    const payloadDigest = opaqueDigest(`payload:${evidenceNonce}`);
    const evidence = await queue.recordInvoiceFinalizationFailure({
      commandId: `notify-invoice-failure-${randomUUID()}`,
      providerEventIdDigest: opaqueDigest(`event:${evidenceNonce}`),
      invoiceIdDigest: opaqueDigest(`invoice:${evidenceNonce}`),
      payloadDigest,
      signatureVerificationDigest: opaqueDigest(`signature:${evidenceNonce}`),
      reasonCode: "unknown_review",
      providerCreatedAt: new Date(Date.now() - 60_000).toISOString()
    });

    const repository = createPostgresCommerceTransitionNotificationRepository({
      authority
    });
    const notifications = createCommerceTransitionNotifications({
      repository,
      clock: { now: () => selectedNow }
    });
    const command = {
      commandId: `commerce-notify-${randomUUID()}`,
      audienceKind: "operator",
      notificationKind: "invoice_finalization_failed",
      source: {
        table: "ss.stripe_invoice_finalization_failures",
        id: evidence.id,
        revision: 1,
        digest: payloadDigest,
        state: "open"
      },
      recipientDigest: "e".repeat(64),
      subjectReferenceDigest: "f".repeat(64),
      contentDigest: "1".repeat(64),
      templateVersion: "invoice_finalization_failed_v1",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    };
    const reserved = await notifications.reserve(command);
    const replay = await notifications.reserve(command);
    assert.equal(replay.id, reserved.id);
    assert.equal(reserved.notificationKind, "invoice_finalization_failed");
    assert.equal(reserved.reservation.state, "held");
    assert.equal(reserved.mail.lifecycleState, "pending");
    assert.equal(reserved.mail.deliveryConfirmed, false);
    assert.equal(reserved.providerEffectsAuthorized, false);
    assert.equal(reserved.deliveryClaimed, false);

    const operatorRead = await notifications.listOperator({
      actorId: operatorId,
      operatorOrganizationId
    });
    assert.equal(operatorRead.items.some((item) => item.id === reserved.id), true);
    const stored = await pool.query(
      `select notification.state, notification.provider_effects_authorized,
              notification.delivery_claimed,
              notification.reservation_digest =
                ss.commerce_transition_notification_reservation_digest(
                  notification.id,
                  notification.request_digest,
                  notification.mail_message_id,
                  notification.mail_request_digest
                ) as reservation_digest_valid,
              mail.message_type,
              mail.state as mail_state
         from ss.commerce_transition_notification_outbox notification
         join ss.hosted_mail_deliveries mail
           on mail.id = notification.mail_message_id
        where notification.id = $1`,
      [reserved.id]
    );
    assert.deepEqual(stored.rows[0], {
      state: "held",
      provider_effects_authorized: false,
      delivery_claimed: false,
      reservation_digest_valid: true,
      message_type: "commerce_operator_notification",
      mail_state: "pending"
    });
  } finally {
    await pool.end();
  }
});
