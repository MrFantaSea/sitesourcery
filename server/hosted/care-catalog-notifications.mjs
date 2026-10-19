import { randomUUID } from 'node:crypto';
import { previewReviewedNotificationMail } from '../../ops/notification-mail-private-renderer.mjs';
import { reserveMailPurposeNotificationInTransaction } from './mail-purpose-notifications-postgres.mjs';
import { digest } from './security.mjs';
import { invariant } from './errors.mjs';

export function careCatalogPaymentProblem({ providerStatus, invalidationReason, period = false }) {
  if (period) return invalidationReason ?? 'resolved';
  if (['past_due', 'unpaid'].includes(providerStatus)) return providerStatus;
  return ['active', 'trialing'].includes(providerStatus) ? 'resolved' : null;
}

// Runs only inside the already-authorized Care business transaction while its
// agreement row is locked. No renderer output or recipient leaves this scope.
export async function reserveCareCatalogNotification(db, agreement, kind, state,
  { paidPeriodId = null, requestId = null } = {}) {
  if (state === null) return null;
  // Financial reconciliation must survive recipient removal or site archival.
  // Only a known ineligible recipient is skipped; storage/render/digest errors
  // still fail atomically and are never silently treated as successful mail.
  const eligible=(await db.query(`select exists(select 1 from auth.users u
    join ss.hosted_account_profiles profile on profile.user_id=u.id and profile.state='active'
    join ss.organization_memberships membership on membership.user_id=u.id and membership.organization_id=$2 and membership.state='active'
    join ss.projects project on project.id=$3 and project.organization_id=$2 and project.lifecycle='active'
    where u.id=$1 and u.disabled_at is null) as eligible`,
    [agreement.customer_user_id,agreement.organization_id,agreement.project_id])).rows[0].eligible;
  if (!eligible) return null;
  const subjectId = paidPeriodId ?? requestId ?? agreement.id;
  const prior = (await db.query(`select * from ss.care_catalog_notification_events
    where agreement_id=$1 and notification_kind=$2 and subject_id=$3
    order by event_sequence desc limit 1`, [agreement.id, kind, subjectId])).rows[0];
  if (prior?.state === state || (!prior && state === 'resolved')) return null;
  const priorActor = (await db.query("select current_setting('app.service_actor_kind',true) as kind")).rows[0].kind;
  // The caller already authorized the customer/operator and locked the exact
  // scoped agreement. The existing mail guards require system reservations.
  await db.query("select set_config('app.service_actor_kind','system',true)");
  const event = (await db.query(`insert into ss.care_catalog_notification_events
    (id,agreement_id,organization_id,project_id,customer_user_id,notification_kind,
     state,subject_id,paid_period_id,request_id,event_sequence,occurred_at)
    select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      coalesce(max(event_sequence),0)+1,date_trunc('milliseconds',clock_timestamp())
    from ss.care_catalog_notification_events where agreement_id=$2 returning *`,
  [randomUUID(), agreement.id, agreement.organization_id, agreement.project_id,
    agreement.customer_user_id, kind, state, subjectId, paidPeriodId, requestId])).rows[0];
  const source = (await db.query(`select * from ss.mail_purpose_notification_sources
    where source_table='ss.care_catalog_notification_events' and source_id=$1`, [event.id])).rows[0];
  const account = (await db.query('select email from auth.users where id=$1 and disabled_at is null',
    [agreement.customer_user_id])).rows[0];
  invariant(source && account, 'CARE_MAIL_SOURCE_UNAVAILABLE', 'The Care notification source is unavailable.', { status: 409 });
  const preview = previewReviewedNotificationMail({ templateVersion: source.template_version,
    to: account.email, variables: { reference: source.reference_id, revision: Number(source.source_revision), state } });
  const requestedAt = new Date(event.occurred_at).toISOString();
  const input = { commandId: `care-mail:${event.id}`, purposeKind: 'care', notificationKind: kind,
    templateVersion: source.template_version, source: { table: source.source_table, id: source.source_id,
      revision: Number(source.source_revision), digest: source.source_digest, state },
    requestedAt, expiresAt: new Date(Date.parse(requestedAt) + 30 * 86400000).toISOString(),
    ...preview.evidence };
  input.requestDigest = digest({ schema: 'sitesourcery.care-catalog-mail-reservation/v1', ...input });
  const reserved = await reserveMailPurposeNotificationInTransaction(db, input, source);
  await db.query("select set_config('app.service_actor_kind',$1,true)", [priorActor ?? '']);
  return { eventId: event.id, notificationId: reserved.id };
}
