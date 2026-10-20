import { previewReviewedNotificationMail } from '../../ops/notification-mail-private-renderer.mjs';
import { COMMERCE_NOTIFICATION_AUTHORITIES, normalizeCommerceNotification } from './commerce-transition-notifications.mjs';
import { reserveCommerceNotificationInTransaction } from './commerce-transition-notifications-postgres.mjs';
import { digest } from './security.mjs';
import { invariant } from './errors.mjs';

const INVOICE_PARENT = Object.freeze({
  assessment_invoice_prepared: 'quote_id',
  custom_initial_invoice_prepared: 'quote_id',
  custom_change_invoice_prepared: 'change_order_id',
  custom_final_invoice_prepared: 'completion_package_id'
});

// Called only by a newly executed business mutation, on its existing client.
// No lookup by time, pending backlog, project, or customer may trigger mail.
async function reserveSelected(client, source) {
  const identity = [source.audience_kind, source.notification_kind, source.source_table,
    source.source_id, Number(source.source_revision), source.source_digest];
  const commandId = `commerce-auto:${digest(identity)}`;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [commandId]);
  const prior = await client.query(`/* commerce-auto:prior */
    select id from ss.commerce_transition_notification_outbox
    where audience_kind=$1 and notification_kind=$2 and source_table=$3
      and source_id=$4 and source_revision=$5 and source_digest=$6`, identity);
  invariant(prior.rowCount <= 1, 'COMMERCE_AUTO_MAIL_CONFLICT',
    'The notification transition is ambiguous.', { status: 409 });
  if (prior.rowCount === 1) return { id: prior.rows[0].id, replay: true };

  let account;
  if (source.audience_kind === 'customer') {
    const selected = await client.query(`/* commerce-auto:customer */
      select account.email from auth.users account
      join ss.hosted_account_profiles profile on profile.user_id=account.id and profile.state='active'
      join ss.organization_memberships membership on membership.user_id=account.id
        and membership.organization_id=$2 and membership.state='active'
      join ss.projects project on project.id=$3 and project.organization_id=$2 and project.lifecycle='active'
      where account.id=$1 and account.disabled_at is null`,
    [source.source_customer_user_id, source.organization_id, source.project_id]);
    // A removed recipient cannot prevent financial reconciliation. Unexpected
    // database/rendering failures still abort the business transaction.
    if (selected.rowCount === 0) return null;
    invariant(selected.rowCount === 1, 'COMMERCE_AUTO_MAIL_RECIPIENT_CONFLICT',
      'The customer notification recipient is ambiguous.', { status: 409 });
    account = selected.rows[0];
  } else {
    const recipient = process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
    invariant(typeof recipient === 'string' && recipient === recipient.trim().toLowerCase()
      && recipient.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(recipient),
    'COMMERCE_AUTO_MAIL_OPERATOR_CONFIGURATION_REQUIRED',
    'The reviewed operator notification recipient is required.', { status: 503 });
    const selected = await client.query(`/* commerce-auto:operator */
      select account.email from auth.users account
      where lower(account.email)=$1 and account.disabled_at is null
        and ss.service_operator_has_capability(account.id,'service_payment_reconcile',clock_timestamp())
      limit 2`, [recipient]);
    invariant(selected.rowCount === 1, 'COMMERCE_AUTO_MAIL_OPERATOR_UNAVAILABLE',
      'The reviewed operator notification recipient is unavailable.', { status: 503 });
    account = selected.rows[0];
  }
  const templateVersion = `commerce-${source.notification_kind.replaceAll('_','-')}.v1`;
  const preview = previewReviewedNotificationMail({ templateVersion, to: account.email,
    variables: { reference: source.source_id, revision: Number(source.source_revision), state: source.source_state } });
  const suppressed = await client.query(`/* commerce-auto:suppression */
    select recipient_digest from ss.hosted_mail_recipient_suppressions where recipient_digest=$1`,
  [preview.evidence.recipientDigest]);
  if (suppressed.rowCount > 0) return null;
  // The source is immutable evidence; round upward so PostgreSQL microseconds
  // cannot put the source after its JavaScript millisecond reservation time.
  const requestedAt = new Date(new Date(source.source_occurred_at).getTime() + 1).toISOString();
  const input = normalizeCommerceNotification({ commandId, audienceKind: source.audience_kind,
    notificationKind: source.notification_kind, templateVersion,
    source: { table: source.source_table, id: source.source_id,
      revision: Number(source.source_revision), digest: source.source_digest, state: source.source_state },
    expiresAt: new Date(Date.parse(requestedAt) + 30 * 86400000).toISOString(), ...preview.evidence }, requestedAt);
  const actor = (await client.query("select current_setting('app.service_actor_kind',true) as kind")).rows[0].kind;
  await client.query("select set_config('app.service_actor_kind','system',true)");
  const reserved = await reserveCommerceNotificationInTransaction(client, input);
  await client.query("select set_config('app.service_actor_kind',$1,true)", [actor ?? '']);
  return reserved;
}

export async function reserveCommerceTransitionMail(client, kind, sourceId) {
  const authority = COMMERCE_NOTIFICATION_AUTHORITIES[kind];
  invariant(authority, 'COMMERCE_AUTO_MAIL_KIND_INVALID', 'The notification transition is invalid.', { status: 500 });
  const hashedId = kind.endsWith('_payment_reconciliation_required');
  const selected = await client.query(`/* commerce-auto:source */
    select source.* from ss.commerce_transition_notification_sources source
    where source.notification_kind=$1 and source.source_table=$2 and source.source_id=
      ${hashedId ? "ss.service_json_digest(jsonb_build_object('schema','sitesourcery.commerce-notification-source-id/v1','sourceId',$3::text,'sourceTable',$2::text))::text" : '$3::text'}`,
  [kind, authority.table, sourceId]);
  invariant(selected.rowCount === 1, 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE',
    'The exact notification transition is unavailable.', { status: 409 });
  return reserveSelected(client, selected.rows[0]);
}

export async function reserveCommerceInvoiceMail(client, kind, parentId) {
  const authority = COMMERCE_NOTIFICATION_AUTHORITIES[kind];
  const parentColumn = INVOICE_PARENT[kind];
  invariant(authority && parentColumn, 'COMMERCE_AUTO_MAIL_KIND_INVALID', 'The invoice transition is invalid.', { status: 500 });
  const selected = await client.query(`/* commerce-auto:invoice-source */
    select source.* from ss.commerce_transition_notification_sources source
    join ${authority.table} invoice on invoice.id::text=source.source_id
    where source.notification_kind=$1 and source.source_table=$2 and invoice.${parentColumn}=$3`,
  [kind, authority.table, parentId]);
  invariant(selected.rowCount <= 1, 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE',
    'The invoice notification transition is ambiguous.', { status: 409 });
  if (selected.rowCount === 0) {
    // Only these two canonical zero-balance transitions lack an eligible
    // pending-invoice source. Missing Assessment/change invoices are errors.
    let zero;
    if (kind === 'custom_initial_invoice_prepared') {
      zero = await client.query(`/* commerce-auto:zero-invoice */
        select id from ss.service_custom_build_invoices where quote_id=$1
          and state='credit_settled' and subtotal_minor=0
          and gross_start_minor=credit_minor and not charge_occurred`, [parentId]);
    } else if (kind === 'custom_final_invoice_prepared') {
      zero = await client.query(`/* commerce-auto:zero-invoice */
        select package.id from ss.service_custom_build_completion_packages package
        join ss.service_custom_build_final_obligations obligation on obligation.completion_package_id=package.id
        where package.id=$1 and package.state='ready_for_delivery' and obligation.final_due_minor=0
          and not exists(select 1 from ss.service_custom_build_final_invoices invoice
            where invoice.completion_package_id=package.id)`, [parentId]);
    }
    invariant(zero?.rowCount === 1, 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE',
      'The generated invoice notification source is unavailable.', { status: 409 });
    return null;
  }
  return reserveSelected(client, selected.rows[0]);
}
