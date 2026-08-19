-- MAIL-PURPOSE-01
-- Five previously uncovered customer-notification families, all reserved and
-- provider-held. This migration stores no recipient address, message body,
-- provider payload, carrier command, or live-delivery authority.
begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v54()') is null
    or ss.hosted_runtime_contract_v54() <>
      'canonical-ss-v54-durable-mail-lifecycle'
    or to_regprocedure('ss.hosted_mail_dispatch_contract_v1()') is null
    or ss.hosted_mail_dispatch_contract_v1() <>
      'canonical-mail-dispatch-v1-leased-digest-only-held'
    or to_regprocedure('ss.hosted_runtime_contract_v43()') is null
    or ss.hosted_runtime_contract_v43() <>
      'canonical-ss-v43-custom-build-progress'
    or to_regprocedure('ss.hosted_publication_control_contract()') is null
    or ss.hosted_publication_control_contract() <>
      'canonical-publication-control-held-v1'
    or to_regprocedure(
      'ss.domain_provider_lifecycle_persistence_contract_v1()'
    ) is null
    or ss.domain_provider_lifecycle_persistence_contract_v1() <>
      'canonical-domain-provider-lifecycle-persistence-v1-held'
    or to_regprocedure('ss.hosted_care_core_contract_v1()') is null
    or ss.hosted_care_core_contract_v1() <>
      'canonical-care-core-v1-held-catalog-contract-period-capacity-ticket'
    or to_regprocedure(
      'ss.hosted_care_commerce_persistence_contract_v1()'
    ) is null
    or ss.hosted_care_commerce_persistence_contract_v1() <>
      'canonical-care-commerce-v1-held-command-quote-one-per-quote-reservation'
    or to_regprocedure('ss.hosted_responder_commerce_contract_v1()') is null
    or ss.hosted_responder_commerce_contract_v1() <>
      'canonical-responder-commerce-v1-held-30000-25000-no-provider-effect'
    or to_regprocedure('ss.hosted_responder_forwarding_contract_v1()') is null
    or ss.hosted_responder_forwarding_contract_v1() <>
      'canonical-responder-forwarding-v1-carrier-preserving-held-no-loop'
    or to_regprocedure('ss.hosted_runtime_contract_v106()') is null
    or ss.hosted_runtime_contract_v106() <>
      'canonical-ss-v106-customer-engagement-bootstrap'
    or to_regclass('ss.hosted_mail_dispatch_claims') is null
    or to_regclass('ss.commerce_transition_notification_outbox') is null
    or to_regclass('ss.hosted_support_case_mail_reservations') is null
  then
    raise exception
      'all held mail-purpose source and predecessor dispatch contracts must be applied first'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.hosted_mail_deliveries
  drop constraint hosted_mail_deliveries_message_type_check,
  add constraint hosted_mail_deliveries_message_type_check check (
    message_type in (
      'account_activation',
      'account_recovery',
      'support_notification',
      'commerce_customer_notification',
      'commerce_operator_notification',
      'purpose_customer_notification'
    )
  ),
  drop constraint hosted_mail_deliveries_scope_check_v114,
  add constraint hosted_mail_deliveries_scope_check_v140 check (
    (message_type = 'account_activation'
      and organization_id is null
      and project_id is null
      and customer_user_id is null)
    or (message_type = 'account_recovery'
      and organization_id is null
      and project_id is null
      and customer_user_id is not null)
    or (message_type in (
        'support_notification',
        'commerce_customer_notification',
        'purpose_customer_notification'
      )
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

alter table ss.hosted_mail_exception_projection
  drop constraint hosted_mail_exception_projection_message_type_check,
  add constraint hosted_mail_exception_projection_message_type_check_v140
  check (
    message_type is null
    or message_type in (
      'account_activation',
      'account_recovery',
      'support_notification',
      'commerce_customer_notification',
      'commerce_operator_notification',
      'purpose_customer_notification'
    )
  );

create function ss.guard_mail_purpose_notification_mail_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.message_type = 'purpose_customer_notification'
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
    raise exception 'purpose customer mail reservation scope is unavailable'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger hosted_mail_purpose_scope_guard
before insert on ss.hosted_mail_deliveries
for each row execute function
  ss.guard_mail_purpose_notification_mail_scope();

-- Every arm is exact committed source evidence. The Domain lifecycle arm is
-- the reviewed state authority and binds its stable ID, monotonic revision,
-- state digest, lifecycle status, and observation timestamp as one snapshot.
create view ss.mail_purpose_notification_sources as
select
  'project_progress'::text as purpose_kind,
  'custom_progress_updated'::text as notification_kind,
  'custom-build-progress-updated.v1'::text as template_version,
  'ss.service_custom_build_progress_updates'::text as source_table,
  progress.id::text as source_id,
  progress.revision::bigint as source_revision,
  progress.request_digest as source_digest,
  progress.stage::text as source_state,
  progress.recorded_at as source_occurred_at,
  progress.job_id::text as reference_id,
  progress.organization_id,
  progress.project_id,
  progress.customer_user_id as source_customer_user_id
from ss.service_custom_build_progress_updates progress

union all
select
  'publication_domain', 'publication_state_changed',
  'publication-state-changed.v1',
  'ss.publication_control_commands', command.id::text,
  command.target_serving_revision, command.command_digest,
  command.action, command.requested_at, command.project_id::text,
  command.organization_id, command.project_id, command.customer_user_id
from ss.publication_control_commands command
where command.state = 'held'

union all
select
  'publication_domain', 'domain_lifecycle_updated',
  'domain-lifecycle-updated.v1',
  'ss.domain_provider_lifecycle_states', state.id::text,
  state.revision, state.state_digest, state.lifecycle_status,
  state.updated_at, state.domain_name::text, state.organization_id,
  state.project_id, state.customer_id
from ss.domain_provider_lifecycle_states state
where state.lifecycle_status in (
  'active', 'grace', 'redemption', 'expired', 'transferred_out'
)

union all
select
  'care', 'care_ticket_acknowledgment',
  'care-ticket-acknowledgment.v1', 'ss.care_commands',
  command.id::text, 1::bigint, command.result_digest,
  command.action, command.recorded_at, command.resource_id::text,
  command.organization_id, command.project_id, contract.customer_user_id
from ss.care_commands command
join ss.care_tickets ticket
  on ticket.organization_id = command.organization_id
 and ticket.project_id = command.project_id
 and ticket.id = command.resource_id
join ss.care_customer_contracts contract
  on contract.organization_id = ticket.organization_id
 and contract.project_id = ticket.project_id
 and contract.id = ticket.contract_id
where command.resource_kind = 'ticket'
  and command.action = 'ticket_open'

union all
select
  'care', 'care_ticket_update', 'care-ticket-update.v1',
  'ss.care_commands', command.id::text, 1::bigint,
  command.result_digest, command.action, command.recorded_at,
  command.resource_id::text, command.organization_id,
  command.project_id, contract.customer_user_id
from ss.care_commands command
join ss.care_tickets ticket
  on ticket.organization_id = command.organization_id
 and ticket.project_id = command.project_id
 and ticket.id = command.resource_id
join ss.care_customer_contracts contract
  on contract.organization_id = ticket.organization_id
 and contract.project_id = ticket.project_id
 and contract.id = ticket.contract_id
where command.resource_kind = 'ticket'
  and command.action in (
    'ticket_start', 'ticket_wait', 'ticket_resume', 'ticket_reopen'
  )

union all
select
  'care', 'care_ticket_resolved', 'care-ticket-resolved.v1',
  'ss.care_commands', command.id::text, 1::bigint,
  command.result_digest, command.action, command.recorded_at,
  command.resource_id::text, command.organization_id,
  command.project_id, contract.customer_user_id
from ss.care_commands command
join ss.care_tickets ticket
  on ticket.organization_id = command.organization_id
 and ticket.project_id = command.project_id
 and ticket.id = command.resource_id
join ss.care_customer_contracts contract
  on contract.organization_id = ticket.organization_id
 and contract.project_id = ticket.project_id
 and contract.id = ticket.contract_id
where command.resource_kind = 'ticket'
  and command.action in ('ticket_resolve', 'ticket_close')

union all
select
  'care', 'care_commerce_quote_held',
  'care-commerce-quote-held.v1', 'ss.care_commerce_quotes',
  quote.id::text, 1::bigint, quote.quote_digest, quote.state,
  quote.issued_at, quote.id::text, quote.organization_id,
  quote.project_id, quote.customer_user_id
from ss.care_commerce_quotes quote
where quote.state = 'held'
  and not quote.dispatch_authorized
  and not quote.customer_effects_authorized
  and not quote.payment_effects_authorized
  and not quote.provider_effects_authorized

union all
select
  'care', 'care_commerce_reservation_held',
  'care-commerce-reservation-held.v1',
  'ss.care_commerce_reservation_events', event.id::text,
  event.revision, event.reservation_digest, event.state,
  event.recorded_at, event.reservation_id::text,
  event.organization_id, event.project_id, reservation.customer_user_id
from ss.care_commerce_reservation_events event
join ss.care_commerce_reservations reservation
  on reservation.organization_id = event.organization_id
 and reservation.project_id = event.project_id
 and reservation.id = event.reservation_id
 and reservation.quote_id = event.quote_id
where event.state = 'held'
  and not event.provider_effects_authorized

union all
select
  'care', 'care_commerce_reservation_cancelled',
  'care-commerce-reservation-cancelled.v1',
  'ss.care_commerce_reservation_events', event.id::text,
  event.revision, event.reservation_digest, event.state,
  event.recorded_at, event.reservation_id::text,
  event.organization_id, event.project_id, reservation.customer_user_id
from ss.care_commerce_reservation_events event
join ss.care_commerce_reservations reservation
  on reservation.organization_id = event.organization_id
 and reservation.project_id = event.project_id
 and reservation.id = event.reservation_id
 and reservation.quote_id = event.quote_id
where event.state = 'cancelled'
  and not event.provider_effects_authorized

union all
select
  'responder', 'responder_commerce_quote_held',
  'responder-commerce-quote-held.v1', 'ss.responder_commerce_quotes',
  quote.id::text, 1::bigint, quote.quote_digest, quote.state,
  quote.issued_at, quote.id::text, quote.organization_id,
  quote.project_id, quote.customer_user_id
from ss.responder_commerce_quotes quote
where quote.state = 'held'
  and not quote.dispatch_authorized
  and not quote.customer_acceptance_authorized
  and not quote.customer_effects_authorized
  and not quote.mail_delivery_effects_authorized
  and not quote.payment_effects_authorized
  and not quote.provider_effects_authorized

union all
select
  'responder', 'responder_commerce_reservation_held',
  'responder-commerce-reservation-held.v1',
  'ss.responder_commerce_reservation_events', event.id::text,
  event.revision, event.reservation_digest, event.state,
  event.recorded_at, event.reservation_id::text,
  event.organization_id, event.project_id, reservation.customer_user_id
from ss.responder_commerce_reservation_events event
join ss.responder_commerce_reservations reservation
  on reservation.organization_id = event.organization_id
 and reservation.project_id = event.project_id
 and reservation.id = event.reservation_id
 and reservation.quote_id = event.quote_id
where event.state = 'held'
  and not event.provider_effects_authorized

union all
select
  'responder', 'responder_commerce_reservation_cancelled',
  'responder-commerce-reservation-cancelled.v1',
  'ss.responder_commerce_reservation_events', event.id::text,
  event.revision, event.reservation_digest, event.state,
  event.recorded_at, event.reservation_id::text,
  event.organization_id, event.project_id, reservation.customer_user_id
from ss.responder_commerce_reservation_events event
join ss.responder_commerce_reservations reservation
  on reservation.organization_id = event.organization_id
 and reservation.project_id = event.project_id
 and reservation.id = event.reservation_id
 and reservation.quote_id = event.quote_id
where event.state = 'cancelled'
  and not event.provider_effects_authorized

union all
select
  'responder', 'responder_forwarding_updated',
  'responder-forwarding-state-changed.v1',
  'ss.responder_forwarding_commands',
  ss.service_json_digest(jsonb_build_object(
    'commandId', command.command_id,
    'organizationId', command.organization_id,
    'schema', 'sitesourcery.mail-purpose-source-id/v1',
    'sourceTable', 'ss.responder_forwarding_commands'
  ))::text,
  command.expected_revision + 1, command.request_digest,
  command.resulting_state, command.created_at, command.onboarding_id::text,
  command.organization_id, command.project_id, onboarding.customer_user_id
from ss.responder_forwarding_commands command
join ss.responder_forwarding_onboardings onboarding
  on onboarding.organization_id = command.organization_id
 and onboarding.project_id = command.project_id
 and onboarding.id = command.onboarding_id
where not command.automatic_carrier_commands
  and not command.remote_write_effects
  and not command.provider_effects
  and not command.message_send_effects

union all
select
  'marketing_followup', 'engagement_followup_ready',
  'engagement-followup-ready.v1', 'ss.customer_engagements',
  engagement.id::text, 1::bigint, engagement.engagement_digest,
  invitation.state, engagement.claimed_at, engagement.id::text,
  engagement.organization_id, engagement.project_id,
  engagement.customer_user_id
from ss.customer_engagements engagement
join ss.customer_engagement_invitations invitation
  on invitation.id = engagement.invitation_id
 and invitation.reserved_organization_id = engagement.organization_id
 and invitation.reserved_project_id = engagement.project_id
 and invitation.reserved_customer_user_id = engagement.customer_user_id
 and invitation.claimed_by_user_id = engagement.customer_user_id
 and invitation.claimed_at = engagement.claimed_at
where invitation.account_mode = 'existing_account'
  and invitation.state = 'claimed';

revoke all on ss.mail_purpose_notification_sources
from public, anon, authenticated, service_role;
grant select on ss.mail_purpose_notification_sources to service_role;

create table ss.mail_purpose_notification_outbox (
  id uuid primary key,
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  request_digest ss.sha256_hex not null,
  purpose_kind text not null check (
    purpose_kind in (
      'project_progress', 'publication_domain', 'care', 'responder',
      'marketing_followup'
    )
  ),
  notification_kind text not null check (
    notification_kind in (
      'custom_progress_updated',
      'publication_state_changed',
      'domain_lifecycle_updated',
      'care_ticket_acknowledgment',
      'care_ticket_update',
      'care_ticket_resolved',
      'care_commerce_quote_held',
      'care_commerce_reservation_held',
      'care_commerce_reservation_cancelled',
      'responder_commerce_quote_held',
      'responder_commerce_reservation_held',
      'responder_commerce_reservation_cancelled',
      'responder_forwarding_updated',
      'engagement_followup_ready'
    )
  ),
  template_version text not null check (
    char_length(template_version) between 2 and 80
    and template_version ~ '^[a-z0-9][a-z0-9._:-]{1,79}$'
  ),
  source_table text not null check (
    source_table in (
      'ss.service_custom_build_progress_updates',
      'ss.publication_control_commands',
      'ss.domain_provider_lifecycle_states',
      'ss.care_commands',
      'ss.care_commerce_quotes',
      'ss.care_commerce_reservation_events',
      'ss.responder_commerce_quotes',
      'ss.responder_commerce_reservation_events',
      'ss.responder_forwarding_commands',
      'ss.customer_engagements'
    )
  ),
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
  reference_id text not null check (
    char_length(reference_id) between 1 and 200
    and reference_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  organization_id uuid not null,
  project_id uuid not null,
  source_customer_user_id uuid not null references auth.users(id),
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
  unique (organization_id, command_id),
  unique (
    purpose_kind, notification_kind, source_table, source_id,
    source_revision, source_digest
  ),
  check (
    (purpose_kind = 'project_progress'
      and notification_kind = 'custom_progress_updated')
    or (purpose_kind = 'publication_domain'
      and notification_kind in (
        'publication_state_changed', 'domain_lifecycle_updated'
      ))
    or (purpose_kind = 'care'
      and notification_kind in (
        'care_ticket_acknowledgment', 'care_ticket_update',
        'care_ticket_resolved', 'care_commerce_quote_held',
        'care_commerce_reservation_held',
        'care_commerce_reservation_cancelled'
      ))
    or (purpose_kind = 'responder'
      and notification_kind in (
        'responder_commerce_quote_held',
        'responder_commerce_reservation_held',
        'responder_commerce_reservation_cancelled',
        'responder_forwarding_updated'
      ))
    or (purpose_kind = 'marketing_followup'
      and notification_kind = 'engagement_followup_ready')
  ),
  check (expires_at > reserved_at),
  check (reserved_at >= source_occurred_at),
  check (created_at = reserved_at)
);

create index mail_purpose_notification_customer_read
  on ss.mail_purpose_notification_outbox(
    organization_id, project_id, source_customer_user_id,
    reserved_at desc, id
  );

create function ss.mail_purpose_notification_reservation_digest(
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
    'schema', 'sitesourcery.mail-purpose-notification-reservation/v1'
  ))
$$;

create function ss.guard_mail_purpose_notification()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or ss.current_service_actor_kind() <> 'system'
  then
    raise exception
      'mail purpose notifications are append-only system authority'
      using errcode = '42501';
  end if;
  if new.state <> 'held'
    or new.provider_effects_authorized
    or new.delivery_claimed
    or new.revision <> 1
    or new.reservation_digest <>
      ss.mail_purpose_notification_reservation_digest(
        new.id,
        new.request_digest,
        new.mail_message_id,
        new.mail_request_digest
      )
    or new.reserved_at < clock_timestamp() - interval '5 minutes'
    or new.reserved_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'mail purpose notification hold is invalid'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
      from ss.mail_purpose_notification_sources source
      join ss.hosted_mail_deliveries mail
        on mail.id = new.mail_message_id
     where source.purpose_kind = new.purpose_kind
       and source.notification_kind = new.notification_kind
       and source.template_version = new.template_version
       and source.source_table = new.source_table
       and source.source_id = new.source_id
       and source.source_revision = new.source_revision
       and source.source_digest = new.source_digest
       and source.source_state = new.source_state
       and source.source_occurred_at = new.source_occurred_at
       and source.reference_id = new.reference_id
       and source.organization_id = new.organization_id
       and source.project_id = new.project_id
       and source.source_customer_user_id = new.source_customer_user_id
       and mail.request_digest = new.mail_request_digest
       and mail.command_id = ('mail-purpose:' || new.request_digest)
       and mail.template_version = new.template_version
       and mail.state = 'pending'
       and mail.message_type = 'purpose_customer_notification'
       and mail.requested_at = new.reserved_at
       and mail.expires_at = new.expires_at
       and mail.organization_id = new.organization_id
       and mail.project_id = new.project_id
       and mail.customer_user_id = new.source_customer_user_id
  )
  then
    raise exception
      'mail purpose notification lacks exact source and pending MAIL-01 reservation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger mail_purpose_notification_guard
before insert or update or delete
on ss.mail_purpose_notification_outbox
for each row execute function ss.guard_mail_purpose_notification();

alter table ss.mail_purpose_notification_outbox enable row level security;
alter table ss.mail_purpose_notification_outbox force row level security;

revoke all on ss.mail_purpose_notification_outbox
from public, anon, authenticated, service_role;
grant select, insert on ss.mail_purpose_notification_outbox to service_role;

revoke all on function ss.guard_mail_purpose_notification_mail_scope()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_mail_purpose_notification()
from public, anon, authenticated, service_role;
revoke all on function ss.mail_purpose_notification_reservation_digest(
  uuid, ss.sha256_hex, uuid, ss.sha256_hex
)
from public, anon, authenticated;
grant execute on function ss.mail_purpose_notification_reservation_digest(
  uuid, ss.sha256_hex, uuid, ss.sha256_hex
)
to service_role;

alter table ss.hosted_mail_dispatch_claims
  drop constraint hosted_mail_dispatch_claims_source_kind_check,
  add constraint hosted_mail_dispatch_claims_source_kind_check_v140
    check (source_kind in ('support', 'commerce', 'purpose'));

create or replace function ss.guard_hosted_mail_dispatch_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_delivery ss.hosted_mail_deliveries%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'mail dispatch claims cannot be deleted'
      using errcode = '55000';
  end if;
  if ss.current_service_actor_kind() <> 'system' then
    raise exception 'mail dispatch claim mutation lacks system authority'
      using errcode = '42501';
  end if;

  select * into strict selected_delivery
    from ss.hosted_mail_deliveries delivery
   where delivery.id = new.message_id;

  if tg_op = 'INSERT' then
    if new.state <> 'claimed'
      or new.attempt_number <> 1
      or new.fence_token <> 1
      or new.revision <> 1
      or new.created_at <> new.lease_started_at
      or new.updated_at <> new.created_at
      or selected_delivery.state <> 'pending'
      or selected_delivery.expires_at <= new.lease_expires_at
      or new.claim_command_id <> ('notify-claim:' || new.message_id::text)
      or new.claim_request_digest <> ss.hosted_mail_dispatch_claim_digest(
        new.message_id,
        new.source_kind,
        new.source_reservation_id,
        new.source_reservation_digest
      )
      or not (
        (new.source_kind = 'support' and exists (
          select 1
            from ss.hosted_support_case_mail_reservations reservation
           where reservation.id = new.source_reservation_id
             and reservation.mail_message_id = new.message_id
             and reservation.reservation_digest =
               new.source_reservation_digest
             and selected_delivery.message_type = 'support_notification'
        ))
        or (new.source_kind = 'commerce' and exists (
          select 1
            from ss.commerce_transition_notification_outbox reservation
           where reservation.id = new.source_reservation_id
             and reservation.mail_message_id = new.message_id
             and reservation.reservation_digest =
               new.source_reservation_digest
             and reservation.state = 'held'
             and not reservation.provider_effects_authorized
             and not reservation.delivery_claimed
             and selected_delivery.message_type in (
               'commerce_customer_notification',
               'commerce_operator_notification'
             )
        ))
        or (new.source_kind = 'purpose' and exists (
          select 1
            from ss.mail_purpose_notification_outbox reservation
           where reservation.id = new.source_reservation_id
             and reservation.mail_message_id = new.message_id
             and reservation.reservation_digest =
               new.source_reservation_digest
             and reservation.state = 'held'
             and not reservation.provider_effects_authorized
             and not reservation.delivery_claimed
             and selected_delivery.message_type =
               'purpose_customer_notification'
        ))
      )
    then
      raise exception 'mail dispatch claim lacks an exact held reservation'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.message_id, new.source_kind, new.source_reservation_id,
    new.source_reservation_digest, new.claim_command_id,
    new.claim_request_digest, new.created_at
  ) is distinct from row(
    old.message_id, old.source_kind, old.source_reservation_id,
    old.source_reservation_digest, old.claim_command_id,
    old.claim_request_digest, old.created_at
  ) or old.state = 'closed'
  then
    raise exception 'mail dispatch claim identity is immutable'
      using errcode = '55000';
  end if;

  if new.state = 'claimed' then
    if old.state <> 'claimed'
      or old.lease_expires_at > new.lease_started_at
      or new.attempt_number <> old.attempt_number + 1
      or new.fence_token <> old.fence_token + 1
      or new.lifecycle_state is not null
      or new.closure_evidence_digest is not null
      or new.closed_at is not null
      or selected_delivery.state <> 'pending'
      or selected_delivery.expires_at <= new.lease_expires_at
    then
      raise exception 'mail dispatch reclaim lacks an expired predecessor'
        using errcode = '23514';
    end if;
  elsif new.state = 'closed' then
    if old.state <> 'claimed'
      or new.worker_id is not null
      or new.lease_started_at is not null
      or new.lease_expires_at is not null
      or new.attempt_number <> old.attempt_number
      or new.fence_token <> old.fence_token
      or new.lifecycle_state <> selected_delivery.state
      or selected_delivery.state = 'pending'
      or new.closure_evidence_digest is distinct from coalesce(
        selected_delivery.acceptance_evidence_digest,
        selected_delivery.expiration_request_digest
      )
      or new.closed_at < old.lease_started_at
    then
      raise exception 'mail dispatch closure lacks exact MAIL-01 evidence'
        using errcode = '23514';
    end if;
  else
    raise exception 'mail dispatch claim transition is invalid'
      using errcode = '23514';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := greatest(
    clock_timestamp(), old.updated_at + interval '1 microsecond'
  );
  return new;
end
$$;

revoke all on function ss.guard_hosted_mail_dispatch_claim()
from public, anon, authenticated, service_role;

create function ss.hosted_mail_dispatch_contract_v2()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-mail-dispatch-v2-support-commerce-purpose-leased-held'::text
$$;

revoke all on function ss.hosted_mail_dispatch_contract_v2()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_mail_dispatch_contract_v2()
to service_role;

create function ss.hosted_mail_purpose_notification_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-mail-purpose-notifications-v1-five-families-14-sources-held'::text
$$;

revoke all on function ss.hosted_mail_purpose_notification_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_mail_purpose_notification_contract_v1()
to service_role;

commit;
