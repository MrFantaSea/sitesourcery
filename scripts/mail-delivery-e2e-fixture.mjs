import assert from "node:assert/strict";
import {
  createHmac,
  randomBytes,
  randomUUID
} from "node:crypto";

import pg from "pg";

import {
  REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
  createNotificationMailPrivateRenderer,
  previewReviewedNotificationMail
} from "../ops/notification-mail-private-renderer.mjs";
import { createMailLifecycle } from
  "../server/hosted/mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "../server/hosted/mail-lifecycle-postgres.mjs";
import {
  createPostgresNotificationMailDispatchSource
} from "../server/hosted/notification-mail-dispatch-postgres.mjs";
import {
  notificationMailEvidence
} from "../server/hosted/notification-mail-dispatcher.mjs";
import {
  createResendMailEventHttpAdapter
} from "../server/hosted/resend-mail-events-http.mjs";
import {
  createResendMailEventWebhook
} from "../server/hosted/resend-mail-events.mjs";
import {
  createCanonicalPostgresAuthority
} from "../server/hosted/repository-postgres.mjs";
import { digest } from "../server/hosted/security.mjs";

const { Pool } = pg;
const WORKERS = Object.freeze({
  primary: "mail-e2e-primary-worker-0001",
  bounced: "mail-e2e-bounced-worker-0001"
});
const SUPPORTED_PROVIDER_EVENTS = Object.freeze([
  "delivered",
  "bounced",
  "complained",
  "suppressed"
]);

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function addMilliseconds(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function fixtureSigningKey() {
  return randomBytes(32);
}

function signedRawEvent({
  key,
  now,
  occurredAt,
  providerMessageId,
  providerType,
  webhookId
}) {
  const timestamp = String(Math.floor(Date.parse(now) / 1000));
  const rawBody = Buffer.from(JSON.stringify({
    type: providerType,
    created_at: occurredAt,
    data: { email_id: providerMessageId }
  }));
  const signature = createHmac("sha256", key)
    .update(Buffer.from(`${webhookId}.${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest("base64");
  return Object.freeze({
    method: "POST",
    pathname: "/api/v1/webhooks/resend",
    rawBody,
    headers: Object.freeze({
      "content-type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`
    })
  });
}

function createFakeProvider({ now }) {
  const calls = [];
  return Object.freeze({
    kind: "local-fake-notification-provider",
    mode: "disposable-fixture",
    providerEffects: false,
    calls,
    async readiness() {
      return Object.freeze({
        ready: true,
        verified: true,
        kind: "local-fake-notification-provider",
        mode: "disposable-fixture",
        providerEffects: false,
        code: null
      });
    },
    async sendNotification(input) {
      assert.deepEqual(Object.keys(input).sort(), [
        "html",
        "idempotencyKey",
        "messageType",
        "subject",
        "templateVersion",
        "text",
        "to"
      ]);
      assert.equal(input.messageType, "support_notification");
      assert.match(input.to, /^[^@\s]+@[^@\s]+[.][^@\s]+$/u);
      assert.equal(input.to.endsWith("@example.test"), true);
      assert.equal(calls.some((call) =>
        call.idempotencyKey === input.idempotencyKey
      ), false);
      const providerMessageId = `mail_e2e_fixture_${calls.length + 1}_0001`;
      const receipt = Object.freeze({
        state: "provider_accepted",
        provider: "resend",
        providerMessageId,
        idempotencyKey: input.idempotencyKey,
        payloadDigest: digest(input),
        acceptedAt: now(),
        providerEffects: false
      });
      calls.push(Object.freeze({
        idempotencyKey: input.idempotencyKey,
        payloadDigest: receipt.payloadDigest,
        providerMessageId,
        providerEffects: false
      }));
      return receipt;
    }
  });
}

async function supportScope(pool) {
  const result = await pool.query(`
    select support_case.id as case_id,
           support_case.organization_id,
           support_case.project_id,
           support_case.requester_user_id as customer_user_id,
           account_user.email
      from ss.hosted_support_cases support_case
      join auth.users account_user
        on account_user.id = support_case.requester_user_id
       and account_user.disabled_at is null
     where support_case.scope_kind = 'project'
       and support_case.request_kind = 'support'
       and exists (
         select 1
           from ss.hosted_support_case_mail_reservations reservation
          where reservation.case_id = support_case.id
            and reservation.notification_kind = 'response'
       )
     order by support_case.opened_at, support_case.id
     limit 2`);
  assert.equal(result.rowCount, 1);
  const selected = result.rows[0];
  assert.equal(selected.email, selected.email.trim().toLowerCase());
  assert.equal(selected.email.endsWith("@example.test"), true);
  return selected;
}

async function ensureFixtureOperator(pool, scope) {
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values ($1, 'service_payment_reconcile', 'held', $1, clock_timestamp())
     on conflict (operator_user_id, capability) do nothing`,
    [scope.customer_user_id]
  );
  const current = await pool.query(
    `select ss.service_operator_has_capability(
       $1, 'service_payment_reconcile', clock_timestamp()
     ) as allowed`,
    [scope.customer_user_id]
  );
  if (current.rows[0]?.allowed !== true) {
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at,
         expires_at, created_at
       ) values (
         $1, 'service_payment_reconcile', 1, 'grant', null,
         'deployment_control', clock_timestamp(),
         clock_timestamp() + interval '1 day', clock_timestamp()
       )`,
      [scope.customer_user_id]
    );
  }
  const observed = await pool.query(
    `select clock_timestamp() - interval '5 minutes' as observed_at,
            ss.service_operator_has_capability(
              $1, 'service_payment_reconcile', clock_timestamp()
            ) as allowed`,
    [scope.customer_user_id]
  );
  assert.equal(observed.rows[0]?.allowed, true);
  return iso(observed.rows[0].observed_at);
}

async function reserveSupportNotification({
  authority,
  clock,
  kind,
  lifecycle,
  scope,
  templateVersion,
  uuid
}) {
  const preview = previewReviewedNotificationMail({
    templateVersion,
    to: scope.email,
    variables: { reference: scope.case_id }
  });
  const mail = await lifecycle.reserve({
    commandId: `mail-e2e-${kind}-reserve-0001`,
    messageType: "support_notification",
    organizationId: scope.organization_id,
    projectId: scope.project_id,
    customerUserId: scope.customer_user_id,
    recipientDigest: preview.evidence.recipientDigest,
    subjectReferenceDigest: preview.evidence.subjectReferenceDigest,
    contentDigest: preview.evidence.contentDigest,
    templateVersion,
    expiresAt: addMilliseconds(clock.now(), 60 * 60 * 1000)
  });
  assert.equal(mail.state, "pending");
  const reservationId = uuid();
  const reservationDigest = digest({
    schema: "sitesourcery.support-case-mail-reservation/v1",
    caseId: scope.case_id,
    mailMessageId: mail.messageId,
    notificationKind: kind
  });
  await authority.service(
    { actorKind: "system", isolation: "serializable" },
    (client) => client.query(
      `insert into ss.hosted_support_case_mail_reservations (
         id, case_id, notification_kind, mail_message_id,
         reservation_digest, reserved_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $6)`,
      [
        reservationId,
        scope.case_id,
        kind,
        mail.messageId,
        reservationDigest,
        clock.now()
      ]
    )
  );
  return Object.freeze({
    messageId: mail.messageId,
    preview,
    reservationDigest,
    reservationId,
    templateVersion
  });
}

async function exerciseClaimRendererAcceptance({
  claim,
  clock,
  lifecycle,
  provider,
  renderer,
  source
}) {
  const rendered = await renderer.render({
    messageId: claim.messageId,
    messageType: claim.messageType,
    templateVersion: claim.templateVersion,
    recipientDigest: claim.recipientDigest,
    subjectReferenceDigest: claim.subjectReferenceDigest,
    contentDigest: claim.contentDigest,
    sourceKind: claim.sourceKind,
    sourceReservationId: claim.sourceReservationId,
    sourceReservationDigest: claim.sourceReservationDigest,
    observedAt: clock.now()
  });
  const evidence = notificationMailEvidence(rendered);
  assert.equal(evidence.recipientDigest, claim.recipientDigest);
  assert.equal(evidence.subjectReferenceDigest, claim.subjectReferenceDigest);
  assert.equal(evidence.contentDigest, claim.contentDigest);
  const providerRequest = Object.freeze({
    messageType: claim.messageType,
    templateVersion: claim.templateVersion,
    to: evidence.to,
    subject: evidence.subject,
    text: evidence.text,
    html: evidence.html,
    idempotencyKey: claim.providerIdempotencyKey
  });
  const providerReceipt = await provider.sendNotification(providerRequest);
  assert.equal(providerReceipt.providerEffects, false);
  const providerMessageIdDigest = digest(providerReceipt.providerMessageId);
  const acceptanceEvidenceDigest = digest({
    schema: "sitesourcery.notification-mail-acceptance-evidence/v1",
    messageId: claim.messageId,
    messageType: claim.messageType,
    templateVersion: claim.templateVersion,
    recipientDigest: claim.recipientDigest,
    subjectReferenceDigest: claim.subjectReferenceDigest,
    contentDigest: claim.contentDigest,
    provider: providerReceipt.provider,
    providerMessageIdDigest,
    payloadDigest: providerReceipt.payloadDigest,
    idempotencyKey: claim.providerIdempotencyKey,
    acceptedAt: providerReceipt.acceptedAt
  });
  const acceptance = await lifecycle.recordProviderAcceptance({
    commandId: `notify-accept:${claim.messageId}`,
    messageId: claim.messageId,
    provider: providerReceipt.provider,
    providerMessageIdDigest,
    evidenceDigest: acceptanceEvidenceDigest,
    acceptedAt: providerReceipt.acceptedAt
  });
  assert.equal(acceptance.acceptanceState, "provider_accepted");
  const completion = await source.completeDispatch({
    messageId: claim.messageId,
    workerId: claim.workerId,
    fenceToken: claim.fenceToken,
    closureEvidenceDigest: acceptanceEvidenceDigest
  });
  assert.equal(completion.status, "closed");
  assert.equal(completion.providerEffects, false);
  return Object.freeze({
    acceptanceEvidenceDigest,
    providerMessageId: providerReceipt.providerMessageId,
    providerMessageIdDigest
  });
}

async function assertInheritedMigration118Recovery(pool) {
  const result = await pool.query(
    `select count(*)::integer as recovered
       from ss.hosted_mail_dispatch_claims claim
       join ss.hosted_mail_deliveries delivery
         on delivery.id = claim.message_id
      where claim.state = 'closed'
        and claim.attempt_number = 2
        and claim.fence_token = 2
        and claim.worker_id is null
        and claim.lease_started_at is null
        and claim.lease_expires_at is null
        and claim.lifecycle_state = 'provider_accepted'
        and claim.closure_evidence_digest is not null
        and delivery.state = 'provider_accepted'`
  );
  assert.equal(result.rows[0]?.recovered >= 1, true);
  return true;
}

export async function readMailDeliveryBackupIdentity(pool, messageIds) {
  assert.equal(Array.isArray(messageIds), true);
  assert.equal(messageIds.length, 2);
  assert.equal(new Set(messageIds).size, 2);
  const result = await pool.query(
    `select
       ss.service_json_digest(jsonb_build_object(
         'schema', 'sitesourcery.mail-delivery-e2e-backup/v1',
         'mailContract', ss.hosted_runtime_contract_v54(),
         'dispatchContract', ss.hosted_mail_dispatch_contract_v1(),
         'deliveries', coalesce((
           select jsonb_agg(to_jsonb(selected) order by selected.id)
             from (select * from ss.hosted_mail_deliveries
                    where id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'reservations', coalesce((
           select jsonb_agg(to_jsonb(selected) order by selected.id)
             from (select * from ss.hosted_support_case_mail_reservations
                    where mail_message_id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'claims', coalesce((
           select jsonb_agg(to_jsonb(selected) order by selected.message_id)
             from (select * from ss.hosted_mail_dispatch_claims
                    where message_id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'inbox', coalesce((
           select jsonb_agg(to_jsonb(selected) order by selected.id)
             from (select * from ss.hosted_mail_provider_event_inbox
                    where applied_message_id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'events', coalesce((
           select jsonb_agg(to_jsonb(selected)
                    order by selected.message_id, selected.event_sequence)
             from (select * from ss.hosted_mail_delivery_events
                    where message_id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'exceptions', coalesce((
           select jsonb_agg(to_jsonb(selected) order by selected.id)
             from (select * from ss.hosted_mail_exception_projection
                    where message_id = any($1::uuid[])) selected
         ), '[]'::jsonb),
         'suppressions', coalesce((
           select jsonb_agg(to_jsonb(selected)
                    order by selected.recipient_digest)
             from (select * from ss.hosted_mail_recipient_suppressions
                    where source_message_id = any($1::uuid[])) selected
         ), '[]'::jsonb)
       )) as identity,
       (select count(*)::integer from ss.hosted_mail_deliveries
         where id = any($1::uuid[])) as deliveries,
       (select count(*)::integer from ss.hosted_support_case_mail_reservations
         where mail_message_id = any($1::uuid[])) as reservations,
       (select count(*)::integer from ss.hosted_mail_dispatch_claims
         where message_id = any($1::uuid[])) as claims,
       (select count(*)::integer from ss.hosted_mail_provider_event_inbox
         where applied_message_id = any($1::uuid[])) as inbox,
       (select count(*)::integer from ss.hosted_mail_delivery_events
         where message_id = any($1::uuid[])) as events,
       (select count(*)::integer from ss.hosted_mail_exception_projection
         where message_id = any($1::uuid[])) as exceptions,
       (select count(*)::integer from ss.hosted_mail_recipient_suppressions
         where source_message_id = any($1::uuid[])) as suppressions`,
    [messageIds]
  );
  const row = result.rows[0];
  return Object.freeze({
    schema: "sitesourcery.mail-delivery-e2e-backup-identity/v1",
    sha256: row.identity,
    counts: Object.freeze({
      claims: row.claims,
      deliveries: row.deliveries,
      events: row.events,
      exceptions: row.exceptions,
      inbox: row.inbox,
      reservations: row.reservations,
      suppressions: row.suppressions
    }),
    providerEffects: false
  });
}

export async function runMailDeliveryE2EJourney({
  databaseUrl,
  PoolImpl = Pool,
  uuid = randomUUID
} = {}) {
  assert.equal(typeof databaseUrl, "string");
  const pool = new PoolImpl({ connectionString: databaseUrl, max: 4 });
  let poolShutdown = false;
  try {
    const scope = await supportScope(pool);
    let current = await ensureFixtureOperator(pool, scope);
    const clock = Object.freeze({ now: () => current });
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresMailLifecycleRepository({ authority });
    const lifecycle = createMailLifecycle({ repository, clock });
    const source = createPostgresNotificationMailDispatchSource({
      authority,
      clock
    });
    const renderer = createNotificationMailPrivateRenderer({
      authority,
      configuration: {
        mode: "reviewed",
        operatorRecipient: scope.email,
        templateRegistrySha256:
          REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
      }
    });
    const provider = createFakeProvider({ now: () => current });
    for (const boundary of [repository, source, renderer, provider]) {
      const status = await boundary.readiness();
      assert.equal(status.ready, true);
      assert.equal(status.verified, true);
      assert.equal(status.providerEffects, false);
    }
    assert.equal(source.providerEffects, false);
    assert.equal(renderer.providerEffects, false);
    assert.equal(provider.providerEffects, false);

    const primary = await reserveSupportNotification({
      authority,
      clock,
      kind: "acknowledgment",
      lifecycle,
      scope,
      templateVersion: "support-case-acknowledgment.v1",
      uuid
    });
    const bounceTarget = await reserveSupportNotification({
      authority,
      clock,
      kind: "closure",
      lifecycle,
      scope,
      templateVersion: "support-case-closure.v1",
      uuid
    });

    current = addMilliseconds(current, 1_000);
    const primaryClaim = await source.claimForDispatch({
      messageId: primary.messageId,
      workerId: WORKERS.primary,
      leaseMs: 120_000
    });
    assert.equal(primaryClaim.status, "claimed");
    const primaryAccepted = await exerciseClaimRendererAcceptance({
      claim: primaryClaim,
      clock,
      lifecycle,
      provider,
      renderer,
      source
    });

    current = addMilliseconds(current, 1_000);
    const bouncedClaim = await source.claimForDispatch({
      messageId: bounceTarget.messageId,
      workerId: WORKERS.bounced,
      leaseMs: 120_000
    });
    assert.equal(bouncedClaim.status, "claimed");
    assert.equal(bouncedClaim.attemptNumber, 1);
    assert.equal(bouncedClaim.fenceToken, 1);
    const bouncedAccepted = await exerciseClaimRendererAcceptance({
      claim: bouncedClaim,
      clock,
      lifecycle,
      provider,
      renderer,
      source
    });
    assert.equal(provider.calls.length, 2);
    const migration118RecoveryReused =
      await assertInheritedMigration118Recovery(pool);

    const signingKey = fixtureSigningKey();
    const webhook = createResendMailEventWebhook({
      signingSecret: `whsec_${signingKey.toString("base64")}`,
      lifecycle,
      clock
    });
    const http = createResendMailEventHttpAdapter({ webhook });
    assert.equal(http.providerEffects, false);
    assert.equal((await http.readiness()).ready, true);
    const sendEvent = async ({
      message,
      providerType,
      webhookId,
      occurredAt = current
    }) => {
      const response = await http.handle(signedRawEvent({
        key: signingKey,
        now: current,
        occurredAt,
        providerMessageId: message.providerMessageId,
        providerType,
        webhookId
      }));
      assert.equal(response.status, 200);
      assert.equal(response.body.received, true);
      return response.body;
    };

    current = addMilliseconds(current, 1_000);
    const deliveredAt = current;
    const deliveredInput = {
      message: primaryAccepted,
      providerType: "email.delivered",
      webhookId: "mail_e2e_delivered_0001"
    };
    const delivered = await sendEvent(deliveredInput);
    assert.equal(delivered.eventState, "applied");
    assert.equal(delivered.currentState, "delivered");
    assert.deepEqual(await sendEvent(deliveredInput), {
      received: true,
      eventState: "applied",
      eventKind: "delivered",
      currentState: null
    });

    current = addMilliseconds(current, 1_000);
    const complained = await sendEvent({
      message: primaryAccepted,
      providerType: "email.complained",
      webhookId: "mail_e2e_complained_0001"
    });
    assert.equal(complained.currentState, "complained");
    current = addMilliseconds(current, 1_000);
    const suppressed = await sendEvent({
      message: primaryAccepted,
      providerType: "email.suppressed",
      webhookId: "mail_e2e_suppressed_0001"
    });
    assert.equal(suppressed.currentState, "suppressed");
    current = addMilliseconds(current, 1_000);
    const outOfOrder = await sendEvent({
      message: primaryAccepted,
      providerType: "email.bounced",
      webhookId: "mail_e2e_out_of_order_0001",
      occurredAt: deliveredAt
    });
    assert.equal(outOfOrder.eventState, "conflict");
    assert.equal(outOfOrder.currentState, "suppressed");

    current = addMilliseconds(current, 1_000);
    const bounced = await sendEvent({
      message: bouncedAccepted,
      providerType: "email.bounced",
      webhookId: "mail_e2e_bounced_0001"
    });
    assert.equal(bounced.eventState, "applied");
    assert.equal(bounced.currentState, "bounced");

    const operatorQueue = await lifecycle.listOwnerExceptions({
      actorId: scope.customer_user_id,
      organizationId: scope.organization_id
    });
    assert.equal(operatorQueue.items.length >= 2, true);
    assert.equal(
      operatorQueue.items.every((item) =>
        JSON.stringify(Object.keys(item).sort()) === JSON.stringify([
          "id",
          "kind",
          "messageType",
          "openedAt",
          "organizationId",
          "projectId",
          "revision",
          "safeReferenceDigest"
        ])
      ),
      true
    );
    assert.equal(
      /@|recipient|providerMessage|rawBody|subject|text|html/iu.test(
        JSON.stringify(operatorQueue)
      ),
      false
    );
    assert.equal(
      operatorQueue.items.some((item) => item.kind === "bounced"),
      true
    );
    assert.equal(
      operatorQueue.items.some(
        (item) => item.kind === "provider_event_conflict"
      ),
      true
    );

    const messageIds = Object.freeze([
      primary.messageId,
      bounceTarget.messageId
    ].sort());
    const backupIdentity = await readMailDeliveryBackupIdentity(
      pool,
      messageIds
    );
    assert.deepEqual(backupIdentity.counts, {
      claims: 2,
      deliveries: 2,
      events: 6,
      exceptions: 2,
      inbox: 5,
      reservations: 2,
      suppressions: 1
    });
    assert.match(backupIdentity.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(
      provider.calls.every((call) => call.providerEffects === false),
      true
    );
    return Object.freeze({
      schema: "sitesourcery.mail-delivery-e2e-journey/v1",
      messageIds,
      backupIdentity,
      providerCallCount: provider.calls.length,
      providerEffects: false,
      signedEventKinds: SUPPORTED_PROVIDER_EVENTS,
      duplicateAccepted: true,
      outOfOrderConflict: true,
      migration118RecoveryReused,
      operatorProjectionSafe: true,
      poolShutdown: true
    });
  } finally {
    await pool.end();
    poolShutdown = true;
    assert.equal(poolShutdown, true);
  }
}
