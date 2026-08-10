begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v54()') is null
    or ss.hosted_runtime_contract_v54() <>
      'canonical-ss-v54-durable-mail-lifecycle'
    or to_regprocedure('ss.hosted_runtime_contract_v108()') is null
    or ss.hosted_runtime_contract_v108() <>
      'canonical-ss-v108-professional-services-reversals'
    or to_regprocedure('ss.hosted_operator_work_queue_contract_v1()') is null
    or ss.hosted_operator_work_queue_contract_v1() <>
      'canonical-operator-work-queue-v1-source-authoritative-held'
    or to_regclass('ss.service_assessment_reports') is null
    or to_regclass('ss.service_custom_build_handoff_receipts') is null
    or to_regclass('ss.stripe_invoice_finalization_failures') is null
  then
    raise exception
      'MAIL-01, professional reversals, operator queue, and committed Custom transitions must precede COMMERCE-NOTIFY-01'
      using errcode = '55000';
  end if;
end
$$;

-- MAIL-01 previously had no truthful commerce routing category. These two
-- additions are reservations only. They neither construct content nor grant
-- any provider-delivery authority.
alter table ss.hosted_mail_deliveries
  drop constraint hosted_mail_deliveries_message_type_check,
  add constraint hosted_mail_deliveries_message_type_check check (
    message_type in (
      'account_activation',
      'account_recovery',
      'support_notification',
      'commerce_customer_notification',
      'commerce_operator_notification'
    )
  );

do $$
declare
  selected_name text;
  selected_count integer;
begin
  select min(constraint_row.conname), count(*)::integer
    into selected_name, selected_count
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'ss.hosted_mail_deliveries'::regclass
     and constraint_row.contype = 'c'
     and pg_get_constraintdef(constraint_row.oid) like
       '%message_type = ''account_activation''%'
     and pg_get_constraintdef(constraint_row.oid) like
       '%message_type = ''support_notification''%';
  if selected_count <> 1 then
    raise exception 'MAIL-01 scope constraint identity is ambiguous'
      using errcode = '55000';
  end if;
  execute format(
    'alter table ss.hosted_mail_deliveries drop constraint %I',
    selected_name
  );
end
$$;

alter table ss.hosted_mail_deliveries
  add constraint hosted_mail_deliveries_scope_check_v114 check (
    (message_type = 'account_activation'
      and organization_id is null
      and project_id is null
      and customer_user_id is null)
    or (message_type = 'account_recovery'
      and organization_id is null
      and project_id is null
      and customer_user_id is not null)
    or (message_type = 'support_notification'
      and organization_id is not null
      and project_id is not null
      and customer_user_id is not null)
    or (message_type = 'commerce_customer_notification'
      and organization_id is not null
      and project_id is not null
      and customer_user_id is not null)
    or (message_type = 'commerce_operator_notification'
      and customer_user_id is null
      and (
        (organization_id is null and project_id is null)
        or (organization_id is not null and project_id is not null)
      ))
  );

create function ss.guard_commerce_notification_mail_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.message_type = 'commerce_customer_notification'
    and not exists (
      select 1
        from ss.projects project
        join ss.organization_memberships membership
          on membership.organization_id = project.organization_id
         and membership.user_id = new.customer_user_id
       where project.organization_id = new.organization_id
         and project.id = new.project_id
         and project.lifecycle = 'active'
         and membership.state = 'active'
    )
  then
    raise exception 'commerce customer mail reservation scope is unavailable'
      using errcode = '23514';
  end if;
  if new.message_type = 'commerce_operator_notification'
    and new.project_id is not null
    and not exists (
      select 1
        from ss.projects project
       where project.organization_id = new.organization_id
         and project.id = new.project_id
    )
  then
    raise exception 'commerce operator mail reservation scope is unavailable'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_mail_commerce_scope_guard
before insert on ss.hosted_mail_deliveries
for each row execute function ss.guard_commerce_notification_mail_scope();

-- This view is the entire source registry. Every row is an already committed,
-- bounded transition with an exact identity. It contains no body, recipient,
-- provider payload, checkout URL, error text, or free-form customer content.
create view ss.commerce_transition_notification_sources as
select
  'assessment_quote_issued'::text as notification_kind,
  'customer'::text as audience_kind,
  'ss.service_quote_revisions'::text as source_table,
  revision.id::text as source_id,
  revision.quote_revision::bigint as source_revision,
  revision.quote_digest as source_digest,
  'issued'::text as source_state,
  revision.organization_id,
  revision.project_id,
  revision.customer_user_id as source_customer_user_id,
  revision.issued_at as source_occurred_at
from ss.service_quote_revisions revision

union all
select
  'assessment_invoice_prepared', 'customer', 'ss.service_invoices',
  invoice.id::text, invoice.quote_revision::bigint, invoice.invoice_digest,
  invoice.state, invoice.organization_id, invoice.project_id,
  invoice.customer_user_id, invoice.issued_at
from ss.service_invoices invoice
where invoice.state = 'tax_calculation_pending'

union all
select
  'assessment_payment_settled', 'customer',
  'ss.service_assessment_payment_receipts', receipt.id::text, 1::bigint,
  receipt.provider_facts_digest, receipt.payment_status,
  receipt.organization_id, receipt.project_id, receipt.customer_user_id,
  receipt.settled_at
from ss.service_assessment_payment_receipts receipt

union all
select
  'assessment_report_delivered', 'customer',
  'ss.service_assessment_reports', report.id::text, 1::bigint,
  report.delivery_digest, 'delivered', report.organization_id,
  report.project_id, report.customer_user_id, report.delivered_at
from ss.service_assessment_reports report

union all
select
  'custom_quote_issued', 'customer',
  'ss.service_custom_build_quote_revisions', revision.id::text,
  revision.quote_revision::bigint, revision.quote_digest, 'issued',
  revision.organization_id, revision.project_id,
  revision.customer_user_id, revision.issued_at
from ss.service_custom_build_quote_revisions revision

union all
select
  'custom_initial_invoice_prepared', 'customer',
  'ss.service_custom_build_invoices', invoice.id::text,
  invoice.quote_revision::bigint, invoice.invoice_digest, invoice.state,
  invoice.organization_id, invoice.project_id, invoice.customer_user_id,
  invoice.issued_at
from ss.service_custom_build_invoices invoice
where invoice.state = 'tax_calculation_pending'

union all
select
  'custom_initial_payment_settled', 'customer',
  'ss.service_custom_build_payment_receipts', receipt.id::text, 1::bigint,
  receipt.provider_facts_digest, receipt.payment_status,
  receipt.organization_id, receipt.project_id, receipt.customer_user_id,
  receipt.settled_at
from ss.service_custom_build_payment_receipts receipt

union all
select
  'custom_change_quote_issued', 'customer',
  'ss.service_custom_build_change_orders', change_order.id::text,
  change_order.change_number::bigint, change_order.quote_digest, 'issued',
  change_order.organization_id, change_order.project_id,
  change_order.customer_user_id, change_order.issued_at
from ss.service_custom_build_change_orders change_order

union all
select
  'custom_change_invoice_prepared', 'customer',
  'ss.service_custom_build_change_invoices', invoice.id::text,
  invoice.change_number::bigint, invoice.invoice_digest, invoice.state,
  invoice.organization_id, invoice.project_id, invoice.customer_user_id,
  invoice.issued_at
from ss.service_custom_build_change_invoices invoice
where invoice.state = 'tax_calculation_pending'

union all
select
  'custom_change_payment_settled', 'customer',
  'ss.service_custom_build_change_payment_receipts', receipt.id::text,
  change_order.change_number::bigint, receipt.provider_facts_digest,
  receipt.payment_status, receipt.organization_id, receipt.project_id,
  receipt.customer_user_id, receipt.settled_at
from ss.service_custom_build_change_payment_receipts receipt
join ss.service_custom_build_change_orders change_order
  on change_order.organization_id = receipt.organization_id
 and change_order.id = receipt.change_order_id

union all
select
  'custom_completion_ready', 'customer',
  'ss.service_custom_build_completion_packages', package.id::text,
  package.progress_revision::bigint, package.package_digest, package.state,
  package.organization_id, package.project_id, package.customer_user_id,
  package.prepared_at
from ss.service_custom_build_completion_packages package

union all
select
  'custom_final_invoice_prepared', 'customer',
  'ss.service_custom_build_final_invoices', invoice.id::text, 1::bigint,
  invoice.invoice_digest, invoice.state, invoice.organization_id,
  invoice.project_id, invoice.customer_user_id, invoice.issued_at
from ss.service_custom_build_final_invoices invoice
where invoice.state = 'tax_calculation_pending'

union all
select
  'custom_final_payment_settled', 'customer',
  'ss.service_custom_build_final_payment_receipts', receipt.id::text,
  1::bigint, receipt.provider_facts_digest, receipt.payment_status,
  receipt.organization_id, receipt.project_id, receipt.customer_user_id,
  receipt.settled_at
from ss.service_custom_build_final_payment_receipts receipt

union all
select
  'custom_handoff_completed', 'customer',
  'ss.service_custom_build_handoff_receipts', handoff.id::text, 1::bigint,
  handoff.handoff_digest, 'handed_off', handoff.organization_id,
  handoff.project_id, handoff.customer_user_id, handoff.handed_off_at
from ss.service_custom_build_handoff_receipts handoff

union all
select
  'professional_reversal_recorded', 'customer',
  'ss.service_professional_payment_lifecycles', lifecycle.id::text,
  lifecycle.revision, evidence.provider_facts_digest, lifecycle.state,
  lifecycle.organization_id, lifecycle.project_id,
  lifecycle.customer_user_id, evidence.recorded_at
from ss.service_professional_payment_lifecycles lifecycle
join ss.service_professional_reversal_evidence evidence
  on evidence.lifecycle_id = lifecycle.id
 and evidence.id = lifecycle.latest_evidence_id
where evidence.evidence_certainty = 'verified'

union all
select
  'assessment_payment_reconciliation_required', 'operator',
  'ss.service_assessment_stripe_events',
  ss.service_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.commerce-notification-source-id/v1',
    'sourceId', event.id,
    'sourceTable', 'ss.service_assessment_stripe_events'
  ))::text,
  1::bigint,
  event.payload_digest, event.state, event.organization_id,
  event.project_id, event.customer_user_id, event.completed_at
from ss.service_assessment_stripe_events event
where event.state = 'reconciliation_required'

union all
select
  'custom_initial_payment_reconciliation_required', 'operator',
  'ss.service_custom_build_stripe_events',
  ss.service_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.commerce-notification-source-id/v1',
    'sourceId', event.id,
    'sourceTable', 'ss.service_custom_build_stripe_events'
  ))::text,
  1::bigint,
  event.payload_digest, event.state, event.organization_id,
  event.project_id, event.customer_user_id, event.completed_at
from ss.service_custom_build_stripe_events event
where event.state = 'reconciliation_required'

union all
select
  'custom_change_payment_reconciliation_required', 'operator',
  'ss.service_custom_build_change_stripe_events',
  ss.service_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.commerce-notification-source-id/v1',
    'sourceId', event.id,
    'sourceTable', 'ss.service_custom_build_change_stripe_events'
  ))::text,
  1::bigint,
  event.payload_digest, event.state, event.organization_id,
  event.project_id, event.customer_user_id, event.completed_at
from ss.service_custom_build_change_stripe_events event
where event.state = 'reconciliation_required'

union all
select
  'custom_final_payment_reconciliation_required', 'operator',
  'ss.service_custom_build_final_stripe_events',
  ss.service_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.commerce-notification-source-id/v1',
    'sourceId', event.id,
    'sourceTable', 'ss.service_custom_build_final_stripe_events'
  ))::text,
  1::bigint,
  event.payload_digest, event.state, event.organization_id,
  event.project_id, event.customer_user_id, event.completed_at
from ss.service_custom_build_final_stripe_events event
where event.state = 'reconciliation_required'

union all
select
  'professional_reversal_review_required', 'operator',
  'ss.service_professional_payment_lifecycles', lifecycle.id::text,
  lifecycle.revision, evidence.provider_facts_digest, lifecycle.state,
  lifecycle.organization_id, lifecycle.project_id,
  lifecycle.customer_user_id, evidence.recorded_at
from ss.service_professional_payment_lifecycles lifecycle
join ss.service_professional_reversal_evidence evidence
  on evidence.lifecycle_id = lifecycle.id
 and evidence.id = lifecycle.latest_evidence_id
where lifecycle.reconciliation_required
  and evidence.evidence_certainty = 'ambiguous'

union all
select
  'invoice_finalization_failed', 'operator',
  'ss.stripe_invoice_finalization_failures', failure.id::text,
  failure.revision, failure.payload_digest, failure.state,
  null::uuid, null::uuid, null::uuid, failure.recorded_at
from ss.stripe_invoice_finalization_failures failure
where failure.state = 'open';

revoke all on ss.commerce_transition_notification_sources
from public, anon, authenticated, service_role;
grant select on ss.commerce_transition_notification_sources to service_role;

create table ss.commerce_transition_notification_outbox (
  id uuid primary key,
  command_id text not null unique check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  audience_kind text not null check (
    audience_kind in ('customer', 'operator')
  ),
  notification_kind text not null check (
    notification_kind in (
      'assessment_quote_issued',
      'assessment_invoice_prepared',
      'assessment_payment_settled',
      'assessment_report_delivered',
      'custom_quote_issued',
      'custom_initial_invoice_prepared',
      'custom_initial_payment_settled',
      'custom_change_quote_issued',
      'custom_change_invoice_prepared',
      'custom_change_payment_settled',
      'custom_completion_ready',
      'custom_final_invoice_prepared',
      'custom_final_payment_settled',
      'custom_handoff_completed',
      'professional_reversal_recorded',
      'assessment_payment_reconciliation_required',
      'custom_initial_payment_reconciliation_required',
      'custom_change_payment_reconciliation_required',
      'custom_final_payment_reconciliation_required',
      'professional_reversal_review_required',
      'invoice_finalization_failed'
    )
  ),
  source_table text not null,
  source_id text not null check (
    char_length(source_id) between 1 and 200
    and source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  source_revision bigint not null check (source_revision >= 0),
  source_digest ss.sha256_hex not null,
  source_state text not null check (
    char_length(source_state) between 1 and 64
    and source_state ~ '^[a-z][a-z0-9_:-]{0,63}$'
  ),
  source_occurred_at timestamptz not null,
  organization_id uuid,
  project_id uuid,
  source_customer_user_id uuid references auth.users(id),
  mail_message_id uuid not null unique
    references ss.hosted_mail_deliveries(id),
  mail_request_digest ss.sha256_hex not null,
  reservation_digest ss.sha256_hex not null,
  state text not null default 'held' check (state = 'held'),
  provider_effects_authorized boolean not null default false
    check (not provider_effects_authorized),
  delivery_claimed boolean not null default false
    check (not delivery_claimed),
  reserved_at timestamptz not null,
  expires_at timestamptz not null,
  revision bigint not null default 1 check (revision = 1),
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, source_customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (
    audience_kind, notification_kind, source_table, source_id,
    source_revision, source_digest
  ),
  check (
    (project_id is null and organization_id is null)
    or (project_id is not null and organization_id is not null)
  ),
  check (
    source_customer_user_id is null or organization_id is not null
  ),
  check (
    (audience_kind = 'customer' and notification_kind in (
      'assessment_quote_issued',
      'assessment_invoice_prepared',
      'assessment_payment_settled',
      'assessment_report_delivered',
      'custom_quote_issued',
      'custom_initial_invoice_prepared',
      'custom_initial_payment_settled',
      'custom_change_quote_issued',
      'custom_change_invoice_prepared',
      'custom_change_payment_settled',
      'custom_completion_ready',
      'custom_final_invoice_prepared',
      'custom_final_payment_settled',
      'custom_handoff_completed',
      'professional_reversal_recorded'
    ))
    or (audience_kind = 'operator' and notification_kind in (
      'assessment_payment_reconciliation_required',
      'custom_initial_payment_reconciliation_required',
      'custom_change_payment_reconciliation_required',
      'custom_final_payment_reconciliation_required',
      'professional_reversal_review_required',
      'invoice_finalization_failed'
    ))
  ),
  check (expires_at > reserved_at),
  check (reserved_at >= source_occurred_at),
  check (created_at = reserved_at)
);

create index commerce_transition_notification_customer_read
  on ss.commerce_transition_notification_outbox(
    organization_id, project_id, source_customer_user_id,
    reserved_at desc, id
  ) where audience_kind = 'customer';

create index commerce_transition_notification_operator_read
  on ss.commerce_transition_notification_outbox(
    reserved_at desc, id
  ) where audience_kind = 'operator';

create function ss.commerce_transition_notification_reservation_digest(
  selected_notification_id uuid,
  selected_notification_request_digest ss.sha256_hex,
  selected_mail_message_id uuid,
  selected_mail_request_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'mailMessageId', selected_mail_message_id,
    'mailRequestDigest', selected_mail_request_digest,
    'notificationId', selected_notification_id,
    'notificationRequestDigest', selected_notification_request_digest,
    'schema', 'sitesourcery.commerce-notification-reservation/v1'
  ))
$$;

create function ss.guard_commerce_transition_notification()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
  then
    raise exception 'commerce transition notifications are append-only system authority'
      using errcode = '42501';
  end if;
  if new.state <> 'held'
    or new.provider_effects_authorized
    or new.delivery_claimed
    or new.revision <> 1
    or new.reservation_digest <>
      ss.commerce_transition_notification_reservation_digest(
        new.id,
        new.request_digest,
        new.mail_message_id,
        new.mail_request_digest
      )
    or new.reserved_at < clock_timestamp() - interval '5 minutes'
    or new.reserved_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'commerce transition notification hold is invalid'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
      from ss.commerce_transition_notification_sources source
      join ss.hosted_mail_deliveries mail
        on mail.id = new.mail_message_id
     where source.notification_kind = new.notification_kind
       and source.audience_kind = new.audience_kind
       and source.source_table = new.source_table
       and source.source_id = new.source_id
       and source.source_revision = new.source_revision
       and source.source_digest = new.source_digest
       and source.source_state = new.source_state
       and source.source_occurred_at = new.source_occurred_at
       and source.organization_id is not distinct from new.organization_id
       and source.project_id is not distinct from new.project_id
       and source.source_customer_user_id is not distinct from
         new.source_customer_user_id
       and mail.request_digest = new.mail_request_digest
       and mail.state = 'pending'
       and mail.requested_at = new.reserved_at
       and mail.expires_at = new.expires_at
       and mail.organization_id is not distinct from new.organization_id
       and mail.project_id is not distinct from new.project_id
       and (
         (new.audience_kind = 'customer'
           and mail.message_type = 'commerce_customer_notification'
           and mail.customer_user_id = new.source_customer_user_id)
         or (new.audience_kind = 'operator'
           and mail.message_type = 'commerce_operator_notification'
           and mail.customer_user_id is null)
       )
  )
  then
    raise exception 'commerce notification lacks exact committed source and pending MAIL-01 reservation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_transition_notification_guard
before insert or update or delete
on ss.commerce_transition_notification_outbox
for each row execute function ss.guard_commerce_transition_notification();

alter table ss.commerce_transition_notification_outbox
  enable row level security;
alter table ss.commerce_transition_notification_outbox
  force row level security;

revoke all on ss.commerce_transition_notification_outbox
from public, anon, authenticated, service_role;
grant select, insert on ss.commerce_transition_notification_outbox
to service_role;

revoke all on function ss.guard_commerce_notification_mail_scope()
from public, anon, authenticated, service_role;
revoke all on function
  ss.commerce_transition_notification_reservation_digest(
    uuid, ss.sha256_hex, uuid, ss.sha256_hex
  )
from public, anon, authenticated;
grant execute on function
  ss.commerce_transition_notification_reservation_digest(
    uuid, ss.sha256_hex, uuid, ss.sha256_hex
  )
to service_role;
revoke all on function ss.guard_commerce_transition_notification()
from public, anon, authenticated, service_role;

create function ss.hosted_commerce_notification_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-commerce-transition-notifications-v1-mail-reserved-held'::text
$$;

revoke all on function ss.hosted_commerce_notification_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_commerce_notification_contract_v1()
to service_role;

commit;
