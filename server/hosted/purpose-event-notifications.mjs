import { previewReviewedNotificationMail } from '../../ops/notification-mail-private-renderer.mjs';
import { invariant } from './errors.mjs';
import { MAIL_PURPOSE_NOTIFICATION_AUTHORITIES } from './mail-purpose-notifications.mjs';
import { reserveMailPurposeNotificationInTransaction } from './mail-purpose-notifications-postgres.mjs';
import { digest } from './security.mjs';

const AUTOMATIC_TABLES = new Set([
  'ss.service_custom_build_progress_updates', 'ss.publication_control_commands',
  'ss.domain_provider_lifecycle_states', 'ss.care_commands',
  'ss.care_commerce_quotes', 'ss.care_commerce_reservation_events',
  'ss.responder_commerce_quotes', 'ss.responder_commerce_reservation_events',
  'ss.responder_forwarding_commands'
]);

// Called after a new, authorized business event, inside that event's transaction.
// The caller supplies one exact source identity, never a history or customer list.
// Forwarding uses its command ID; PostgreSQL derives the canonical source digest.
export async function reserveAutomaticPurposeEvent(client, { table, id, organizationId }) {
  invariant(AUTOMATIC_TABLES.has(table), 'PURPOSE_EVENT_MAIL_SOURCE_INVALID',
    'This source does not authorize automatic purpose mail.', { status: 500 });
  const selected = await client.query(`select source.*,
      date_trunc('milliseconds', greatest(clock_timestamp(), source.source_occurred_at))
        + interval '1 millisecond' as reservation_requested_at
    from ss.mail_purpose_notification_sources source
    where source.source_table=$1 and source.organization_id=$3
      and source.source_id=case when $1='ss.responder_forwarding_commands'
        then ss.service_json_digest(jsonb_build_object('commandId',$2::text,
          'organizationId',$3::uuid,'schema','sitesourcery.mail-purpose-source-id/v1',
          'sourceTable','ss.responder_forwarding_commands'))::text else $2 end`,
  [table, id, organizationId]);
  invariant(selected.rowCount === 1, 'PURPOSE_EVENT_MAIL_SOURCE_UNAVAILABLE',
    'The new purpose notification source is unavailable.', { status: 409 });
  const source = selected.rows[0];
  const authority = MAIL_PURPOSE_NOTIFICATION_AUTHORITIES[source.notification_kind];
  invariant(authority && authority.table === table && authority.purposeKind === source.purpose_kind &&
    authority.templateVersion === source.template_version && authority.states.includes(source.source_state),
  'PURPOSE_EVENT_MAIL_SOURCE_INVALID', 'The purpose notification authority does not match.', { status: 409 });

  const prior = await client.query(`select id from ss.mail_purpose_notification_outbox
    where organization_id=$1 and notification_kind=$2 and source_table=$3
      and source_id=$4 and source_revision=$5 and source_digest=$6`,
  [organizationId, source.notification_kind, table, source.source_id, source.source_revision, source.source_digest]);
  if (prior.rowCount === 1) return { notificationId: prior.rows[0].id, replayed: true };

  // Removed customers and archived projects remain valid business transitions.
  // All other persistence/rendering failures abort the original transaction.
  const account = await client.query(`select u.email from auth.users u
    join ss.hosted_account_profiles profile on profile.user_id=u.id and profile.state='active'
    join ss.organization_memberships membership on membership.user_id=u.id
      and membership.organization_id=$2 and membership.state='active'
    join ss.projects project on project.id=$3 and project.organization_id=$2 and project.lifecycle='active'
    where u.id=$1 and u.disabled_at is null`,
  [source.source_customer_user_id, organizationId, source.project_id]);
  if (account.rowCount === 0) return null;
  invariant(account.rowCount === 1, 'PURPOSE_EVENT_MAIL_RECIPIENT_INVALID',
    'The purpose notification recipient is ambiguous.', { status: 409 });
  const preview = previewReviewedNotificationMail({ templateVersion: source.template_version,
    to: account.rows[0].email, variables: { reference: source.reference_id,
      revision: Number(source.source_revision), state: source.source_state } });
  const suppression = await client.query('select recipient_digest from ss.hosted_mail_recipient_suppressions where recipient_digest=$1',
    [preview.evidence.recipientDigest]);
  if (suppression.rowCount > 0) return null;
  const requestedAt = new Date(source.reservation_requested_at).toISOString();
  const input = { commandId: `purpose-event:${digest({ table, id: source.source_id,
    revision: Number(source.source_revision), digest: source.source_digest, kind: source.notification_kind })}`,
  purposeKind: source.purpose_kind, notificationKind: source.notification_kind,
  templateVersion: source.template_version,
  source: { table, id: source.source_id, revision: Number(source.source_revision),
    digest: source.source_digest, state: source.source_state }, requestedAt,
  expiresAt: new Date(Date.parse(requestedAt) + 30 * 86400000).toISOString(), ...preview.evidence };
  input.requestDigest = digest({ schema: 'sitesourcery.automatic-purpose-mail-reservation/v1', ...input });
  const priorActor = (await client.query("select current_setting('app.service_actor_kind',true) as kind")).rows[0].kind;
  await client.query("select set_config('app.service_actor_kind','system',true)");
  let failure;
  try {
    const reserved = await reserveMailPurposeNotificationInTransaction(client, input, source);
    return { notificationId: reserved.id, replayed: false };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    // A failed SQL statement may have aborted the transaction already. Preserve
    // its original error; the transaction owner will roll back both writes.
    try { await client.query("select set_config('app.service_actor_kind',$1,true)", [priorActor ?? '']); }
    catch (error) { if (!failure) throw error; }
  }
}
