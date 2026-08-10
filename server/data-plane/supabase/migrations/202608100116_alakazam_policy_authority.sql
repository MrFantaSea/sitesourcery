-- ALAKAZAM-POLICY-01: one held lifecycle/customer-right authority.
-- This migration projects existing immutable Alakazam evidence. It does not
-- authorize provider, commercial, publication, tax, purge, or recovery effects.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v52()') is null
    or to_regprocedure(
      'ss.hosted_alakazam_retained_premium_contract()'
    ) is null
    or to_regprocedure(
      'ss.hosted_alakazam_publication_contract()'
    ) is null
    or to_regprocedure(
      'ss.hosted_publication_control_contract()'
    ) is null
    or to_regclass('ss.alakazam_fulfillment_projection') is null
  then
    raise exception
      'canonical Alakazam lifecycle, retained exit, fulfillment, and publication evidence must precede policy authority'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_policy_authorities (
  policy_id text primary key
    check (policy_id = 'SS-ALAKAZAM-POLICY-2026-08-10-V1'),
  policy_schema text not null
    check (policy_schema = 'sitesourcery.alakazam-policy-authority/v1'),
  policy_document jsonb not null
    check (jsonb_typeof(policy_document) = 'object'),
  policy_digest ss.sha256_hex not null unique,
  state text not null default 'held'
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_and_publication_cutover_not_authorized'
    check (
      hold_reason =
        'commercial_and_publication_cutover_not_authorized'
    ),
  commercial_effects boolean not null default false
    check (not commercial_effects),
  provider_effects boolean not null default false
    check (not provider_effects),
  publication_effects boolean not null default false
    check (not publication_effects),
  automatic_recovery_from_reversal_evidence boolean not null default false
    check (not automatic_recovery_from_reversal_evidence),
  created_at timestamptz not null default clock_timestamp(),
  check (policy_digest = ss.project_legal_json_digest(policy_document)),
  check (policy_document ->> 'policyId' = policy_id),
  check (policy_document ->> 'schema' = policy_schema),
  check (policy_document ->> 'state' = state),
  check (policy_document ->> 'holdReason' = hold_reason),
  check (
    policy_document #>> '{customerRights,paymentGraceHours}' = '168'
    and policy_document #>> '{customerRights,retainedExitHours}' = '720'
    and policy_document #>> '{customerRights,exportWindowHours}' = '720'
    and policy_document #>> '{tax,stripeTaxCode}' = 'txcd_10701100'
    and policy_document #>> '{tax,taxBehavior}' = 'exclusive'
    and policy_document #>> '{tax,collectionState}' = 'held'
    and policy_document #>>
      '{effects,automaticRecoveryFromReversalEvidence}' = 'false'
  )
);

insert into ss.alakazam_policy_authorities (
  policy_id,
  policy_schema,
  policy_document,
  policy_digest
) values (
  'SS-ALAKAZAM-POLICY-2026-08-10-V1',
  'sitesourcery.alakazam-policy-authority/v1',
  '{"schema":"sitesourcery.alakazam-policy-authority/v1","policyId":"SS-ALAKAZAM-POLICY-2026-08-10-V1","state":"held","holdReason":"commercial_and_publication_cutover_not_authorized","effects":{"commercial":false,"provider":false,"publication":false,"automaticRecoveryFromReversalEvidence":false},"subscription":{"tiers":["alakazam_25","alakazam_35","alakazam_50"],"billingModel":"stripe_subscription","renewalEvidence":"exact_invoice_readback","cancellationEffectiveAt":"paid_through_boundary"},"customerRights":{"paymentGraceHours":168,"retainedExitHours":720,"exportWindowHours":720,"cancellationExitRequires":["provider_confirmed_effective_cancellation","paid_through_boundary_reached","available_export_grant"],"purgeOnlyAt":["retained_exit_expiry","terminal_customer_deletion"]},"tax":{"authority":"purpose_bound_separate_activation","stripeTaxCode":"txcd_10701100","taxBehavior":"exclusive","collectionState":"held"},"prerequisites":{"fulfillment":"exact_paid_subscription_revision","publication":["exact_fulfillment_operation","accepted_release","licensed_address","separate_publication_cutover"],"reversal":"observation_and_owner_review_only"},"lifecycle":{"paymentGraceDays":7,"retainedExitDays":30,"paymentGraceExpiryTransition":"retained_exit","retainPremiumConfigurationDuring":["active","scheduled_to_cancel_active","payment_grace","retained_exit"],"activeAccess":{"privateRead":true,"customerExport":true,"edit":true,"publish":true,"care":true},"paymentGraceAccess":{"privateRead":true,"customerExport":true,"edit":false,"publish":false,"care":false},"retainedExitAccess":{"privateRead":true,"customerExport":true,"edit":false,"publish":false,"care":false},"lowerTierEffectiveOutput":"masked","restoreRequires":["exact_provider_readback","canonical_tier_change_evidence","current_membership","exact_subscription_revision"],"purgeAt":["terminal_customer_deletion","retained_exit_expiry"],"restoreAfterTerminalDeletion":false,"exportProjection":["borderChoiceId","cashAppHandle","configurationDigest","configurationRevision","configuredAt","fontChoiceId","menu","venmoHandle"]},"care":{"businessCalendar":{"timeZone":"America/New_York","businessWeekdays":["monday","tuesday","wednesday","thursday","friday"],"excludedHolidays":"us_federal_observed","nextBusinessDayAfterLocalHour":17},"modest":{"tasksPerProviderBillingPeriod":1,"maximumSecondsPerTask":900,"maximumSecondsPerPeriod":900,"acknowledgeWithinBusinessDays":3},"more":{"tasksPerProviderBillingPeriod":2,"maximumSecondsPerTask":900,"maximumSecondsPerPeriod":1800,"acknowledgeWithinBusinessDays":2},"nonConsumingClasses":["billing","access","security","service_defect"],"promisesNotMade":["rollover","completion_sla","continuous_availability","emergency_service","unlimited_work"]}}'::jsonb,
  '8b7562daef4b3d91fff1bea04da5cdd982755b901e58f0e60a780fde17ce9bb1'
);

create function ss.reject_alakazam_policy_authority_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'canonical Alakazam policy authority is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_policy_authorities_immutable
before insert or update or delete on ss.alakazam_policy_authorities
for each row execute function
  ss.reject_alakazam_policy_authority_mutation();

-- Existing subscriptions already require one database-managed increasing
-- revision and one exact tier-change event for each state change. This
-- additional constraint narrows every payment-grace clock to seven days and
-- restates that a return from grace/suspension can only be payment recovery,
-- never refund/dispute evidence.
create function ss.validate_alakazam_policy_subscription_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.status in ('grace', 'suspended')
    and new.first_failed_at is not null
    and new.grace_ends_at is distinct from
        new.first_failed_at + interval '7 days'
  then
    raise exception 'Alakazam payment grace must remain exactly seven days'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('grace', 'suspended')
    and new.status = 'active'
    and not exists (
      select 1
      from ss.alakazam_tier_change_events event
      where event.organization_id = new.organization_id
        and event.project_id = new.project_id
        and event.subscription_id = new.id
        and event.result_subscription_revision = new.revision
        and event.event_kind = 'payment_recovered'
        and event.download_reversal_event_id is null
    )
  then
    raise exception
      'Alakazam recovery requires exact payment-recovered evidence, never reversal evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_subscriptions_policy_transition
after insert or update on ss.alakazam_subscriptions
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_policy_subscription_transition();

create view ss.alakazam_policy_subscription_authority_v1
with (security_barrier = true, security_invoker = true)
as
select
  subscription.organization_id,
  subscription.project_id,
  subscription.customer_user_id,
  subscription.id as subscription_id,
  subscription.revision as source_subscription_revision,
  subscription.status as source_subscription_status,
  transition.id as transition_event_id,
  transition.event_kind as transition_event_kind,
  cancellation.id as cancellation_id,
  export_grant.id as export_grant_id,
  retention.id as retention_window_id,
  retention.ends_at as retention_ends_at,
  reversal.id as reversal_event_id,
  purge.id as purge_receipt_id,
  case
    when purge.id is not null then 'terminal'
    when retention.id is not null and retention.state = 'active'
      then 'retained_exit'
    when subscription.status = 'pending' then 'pending'
    when subscription.status = 'active'
      and subscription.cancel_at_period_end
      then 'scheduled_to_cancel_active'
    when subscription.status = 'active'
      then 'active'
    when subscription.status = 'grace'
      and subscription.first_failed_at is not null
      and subscription.grace_ends_at =
          subscription.first_failed_at + interval '7 days'
      then 'payment_grace'
    else 'held_evidence_incomplete'
  end as lifecycle_state,
  case
    when purge.id is not null
      and purge.reason in (
        'terminal_customer_deletion',
        'retained_exit_expiry'
      ) then true
    when retention.source_kind = 'payment_grace_expired'
      and retention.starts_at = subscription.grace_ends_at
      and retention.ends_at = retention.starts_at + interval '30 days'
      then true
    when retention.source_kind = 'period_end_cancellation'
      and cancellation.state = 'effective'
      and cancellation.provider_effect_certainty = 'confirmed'
      and cancellation.effective_confirmed_at >=
          export_grant.paid_through_at
      and retention.starts_at = export_grant.paid_through_at
      and retention.ends_at =
          export_grant.paid_through_at + interval '30 days'
      and export_grant.state = 'available'
      and export_grant.retention_ends_at = retention.ends_at
      and export_grant.export_window_ends_at = retention.ends_at
      then true
    when subscription.status = 'pending'
      and subscription.revision = 1 then true
    when subscription.status = 'active'
      and (
        subscription.revision = 1
        or transition.result_subscription_revision =
            subscription.revision
      ) then true
    when subscription.status = 'grace'
      and subscription.first_failed_at is not null
      and subscription.grace_ends_at =
          subscription.first_failed_at + interval '7 days'
      and transition.event_kind = 'payment_failed'
      and transition.result_subscription_revision =
          subscription.revision
      then true
    else false
  end as legacy_evidence_compatible,
  policy.policy_id,
  policy.policy_digest as authority_digest,
  policy.state,
  policy.hold_reason,
  policy.commercial_effects,
  policy.provider_effects,
  policy.publication_effects,
  policy.automatic_recovery_from_reversal_evidence,
  subscription.provider_observed_at as observed_at
from ss.alakazam_subscriptions subscription
cross join ss.alakazam_policy_authorities policy
left join lateral (
  select event.*
  from ss.alakazam_tier_change_events event
  where event.organization_id = subscription.organization_id
    and event.project_id = subscription.project_id
    and event.subscription_id = subscription.id
    and event.result_subscription_revision = subscription.revision
  order by event.occurred_at desc, event.id desc
  limit 1
) transition on true
left join lateral (
  select record.*
  from ss.alakazam_cancellations record
  where record.organization_id = subscription.organization_id
    and record.project_id = subscription.project_id
    and record.subscription_id = subscription.id
  order by record.requested_at desc, record.id desc
  limit 1
) cancellation on true
left join ss.alakazam_export_grants export_grant
  on export_grant.organization_id = cancellation.organization_id
 and export_grant.cancellation_id = cancellation.id
left join lateral (
  select record.*
  from ss.alakazam_premium_retention_windows record
  where record.organization_id = subscription.organization_id
    and record.project_id = subscription.project_id
    and record.subscription_id = subscription.id
  order by (record.state = 'active') desc, record.ends_at desc, record.id desc
  limit 1
) retention on true
left join lateral (
  select record.*
  from ss.alakazam_reversal_events record
  where record.organization_id = subscription.organization_id
    and record.project_id = subscription.project_id
    and record.subscription_id = subscription.id
  order by record.severity desc, record.occurred_at desc, record.id desc
  limit 1
) reversal on true
left join lateral (
  select record.*
  from ss.alakazam_premium_purge_receipts record
  where record.organization_id = subscription.organization_id
    and record.project_id = subscription.project_id
    and record.subscription_id = subscription.id
  order by record.purged_at desc, record.id desc
  limit 1
) purge on true;

alter table ss.alakazam_policy_authorities enable row level security;
alter table ss.alakazam_policy_authorities force row level security;

revoke all on table ss.alakazam_policy_authorities
from public, anon, authenticated, service_role;
grant select on table ss.alakazam_policy_authorities to service_role;

revoke all on table ss.alakazam_policy_subscription_authority_v1
from public, anon, authenticated, service_role;
grant select on table ss.alakazam_policy_subscription_authority_v1
to service_role;

revoke all on function
  ss.reject_alakazam_policy_authority_mutation(),
  ss.validate_alakazam_policy_subscription_transition()
from public, anon, authenticated, service_role;
grant execute on function
  ss.validate_alakazam_policy_subscription_transition()
to service_role;

create function ss.hosted_alakazam_policy_authority_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-policy-authority-v1-held'::text
$$;

revoke all on function ss.hosted_alakazam_policy_authority_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_alakazam_policy_authority_contract_v1()
to service_role;

commit;
