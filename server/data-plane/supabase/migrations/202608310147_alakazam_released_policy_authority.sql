-- ALAKAZAM-RELEASE-POLICY-02: immutable released customer-right authority.
--
-- The owner's 2026-08-31 ruling closes the Alakazam lifecycle policy. This
-- migration preserves the original held V1 row and adds one released V2 row.
-- It makes no provider, payment, publication, DNS, deployment, or customer
-- effect. Those effects still require their separate runtime configuration,
-- credentials, readiness proof, legal release, worker, and cutover gates.

begin;

do $$
begin
  if to_regprocedure(
    'ss.hosted_alakazam_policy_authority_contract_v1()'
  ) is null
    or ss.hosted_alakazam_policy_authority_contract_v1() <>
      'canonical-alakazam-policy-authority-v1-held'
    or not exists (
      select 1
        from ss.alakazam_policy_authorities
       where policy_id = 'SS-ALAKAZAM-POLICY-2026-08-10-V1'
         and state = 'held'
         and not commercial_effects
         and not provider_effects
         and not publication_effects
         and not automatic_recovery_from_reversal_evidence
    )
  then
    raise exception
      'immutable held Alakazam policy V1 must precede released policy V2'
      using errcode = '55000';
  end if;
end
$$;

create table ss.alakazam_policy_releases (
  policy_id text primary key
    check (policy_id = 'SS-ALAKAZAM-POLICY-2026-08-31-V2'),
  policy_schema text not null
    check (policy_schema = 'sitesourcery.alakazam-policy-authority/v1'),
  policy_document jsonb not null
    check (jsonb_typeof(policy_document) = 'object'),
  policy_digest ss.sha256_hex not null unique,
  state text not null default 'released'
    check (state = 'released'),
  hold_reason text check (hold_reason is null),
  commercial_effects boolean not null default true
    check (commercial_effects),
  provider_effects boolean not null default true
    check (provider_effects),
  publication_effects boolean not null default true
    check (publication_effects),
  automatic_recovery_from_reversal_evidence boolean not null default false
    check (not automatic_recovery_from_reversal_evidence),
  approved_at timestamptz not null,
  approval_basis text not null
    check (approval_basis = 'owner_approved_2026_08_31'),
  created_at timestamptz not null default clock_timestamp(),
  check (policy_digest = ss.project_legal_json_digest(policy_document)),
  check (policy_document ->> 'policyId' = policy_id),
  check (policy_document ->> 'schema' = policy_schema),
  check (policy_document ->> 'state' = state),
  check (policy_document ->> 'holdReason' is null),
  check (
    policy_document #>> '{effects,commercial}' = 'true'
    and policy_document #>> '{effects,provider}' = 'true'
    and policy_document #>> '{effects,publication}' = 'true'
    and policy_document #>>
      '{effects,automaticRecoveryFromReversalEvidence}' = 'false'
    and policy_document #>>
      '{subscription,cancellationPolicyVersion}' =
        'alakazam-cancellation.2026-08-31.v1'
    and policy_document #>>
      '{subscription,cancellationEffectiveAt}' =
        'paid_through_boundary'
    and policy_document #>>
      '{subscription,cancellationFeeMinor}' = '0'
    and policy_document #>>
      '{subscription,cancellationRefundTreatment}' =
        'no_partial_period_refund_or_proration'
    and policy_document #>>
      '{subscription,cancellationUndoTreatment}' =
        'resubscribe_separately'
    and policy_document #>>
      '{customerRights,paymentGraceHours}' = '168'
    and policy_document #>>
      '{customerRights,retainedExitHours}' = '720'
    and policy_document #>>
      '{customerRights,exportWindowHours}' = '720'
    and policy_document #>> '{tax,stripeTaxCode}' = 'txcd_10701100'
    and policy_document #>> '{tax,taxBehavior}' = 'exclusive'
    and policy_document #>> '{tax,collectionState}' = 'automatic'
  )
);

insert into ss.alakazam_policy_releases (
  policy_id,
  policy_schema,
  policy_document,
  policy_digest,
  approved_at,
  approval_basis
) values (
  'SS-ALAKAZAM-POLICY-2026-08-31-V2',
  'sitesourcery.alakazam-policy-authority/v1',
  '{"schema":"sitesourcery.alakazam-policy-authority/v1","policyId":"SS-ALAKAZAM-POLICY-2026-08-31-V2","state":"released","holdReason":null,"effects":{"commercial":true,"provider":true,"publication":true,"automaticRecoveryFromReversalEvidence":false},"subscription":{"tiers":["alakazam_25","alakazam_35","alakazam_50"],"billingModel":"stripe_subscription","renewalEvidence":"exact_invoice_readback","cancellationPolicyVersion":"alakazam-cancellation.2026-08-31.v1","cancellationEffectiveAt":"paid_through_boundary","cancellationFeeMinor":0,"cancellationRefundTreatment":"no_partial_period_refund_or_proration","cancellationRefundExceptions":["required_by_law","duplicate_or_unauthorized_charge","proven_service_failure"],"cancellationUndoTreatment":"resubscribe_separately"},"customerRights":{"paymentGraceHours":168,"retainedExitHours":720,"exportWindowHours":720,"cancellationExitRequires":["provider_confirmed_effective_cancellation","paid_through_boundary_reached","available_export_grant"],"purgeOnlyAt":["retained_exit_expiry","terminal_customer_deletion"]},"tax":{"authority":"purpose_bound_separate_activation","stripeTaxCode":"txcd_10701100","taxBehavior":"exclusive","collectionState":"automatic"},"prerequisites":{"fulfillment":"exact_paid_subscription_revision","publication":["exact_fulfillment_operation","accepted_release","licensed_address","separate_publication_cutover"],"reversal":"observation_and_owner_review_only"},"lifecycle":{"paymentGraceDays":7,"retainedExitDays":30,"paymentGraceExpiryTransition":"retained_exit","retainPremiumConfigurationDuring":["active","scheduled_to_cancel_active","payment_grace","retained_exit"],"activeAccess":{"privateRead":true,"customerExport":true,"edit":true,"publish":true,"care":true},"paymentGraceAccess":{"privateRead":true,"customerExport":true,"edit":false,"publish":false,"care":false},"retainedExitAccess":{"privateRead":true,"customerExport":true,"edit":false,"publish":false,"care":false},"lowerTierEffectiveOutput":"masked","restoreRequires":["exact_provider_readback","canonical_tier_change_evidence","current_membership","exact_subscription_revision"],"purgeAt":["terminal_customer_deletion","retained_exit_expiry"],"restoreAfterTerminalDeletion":false,"exportProjection":["borderChoiceId","cashAppHandle","configurationDigest","configurationRevision","configuredAt","fontChoiceId","menu","venmoHandle"]},"care":{"businessCalendar":{"timeZone":"America/New_York","businessWeekdays":["monday","tuesday","wednesday","thursday","friday"],"excludedHolidays":"us_federal_observed","nextBusinessDayAfterLocalHour":17},"modest":{"tasksPerProviderBillingPeriod":1,"maximumSecondsPerTask":900,"maximumSecondsPerPeriod":900,"acknowledgeWithinBusinessDays":3},"more":{"tasksPerProviderBillingPeriod":2,"maximumSecondsPerTask":900,"maximumSecondsPerPeriod":1800,"acknowledgeWithinBusinessDays":2},"nonConsumingClasses":["billing","access","security","service_defect"],"promisesNotMade":["rollover","completion_sla","continuous_availability","emergency_service","unlimited_work"]}}'::jsonb,
  '145892e43ab6f4a03ebbed84fd148633f9a4de9727ce4294a0eb9b08f329c320',
  '2026-08-31T19:00:22-04:00'::timestamptz,
  'owner_approved_2026_08_31'
);

create function ss.reject_alakazam_policy_release_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'released Alakazam policy authority is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_policy_releases_immutable
before insert or update or delete on ss.alakazam_policy_releases
for each row execute function ss.reject_alakazam_policy_release_mutation();

create view ss.alakazam_policy_subscription_authority_v2
with (security_barrier = true, security_invoker = true)
as
select
  legacy.organization_id,
  legacy.project_id,
  legacy.customer_user_id,
  legacy.subscription_id,
  legacy.source_subscription_revision,
  legacy.source_subscription_status,
  legacy.transition_event_id,
  legacy.transition_event_kind,
  legacy.cancellation_id,
  legacy.export_grant_id,
  legacy.retention_window_id,
  legacy.retention_ends_at,
  legacy.reversal_event_id,
  legacy.purge_receipt_id,
  legacy.lifecycle_state,
  legacy.legacy_evidence_compatible,
  policy.policy_id,
  policy.policy_digest as authority_digest,
  policy.state,
  policy.hold_reason,
  policy.commercial_effects,
  policy.provider_effects,
  policy.publication_effects,
  policy.automatic_recovery_from_reversal_evidence,
  legacy.observed_at
from ss.alakazam_policy_subscription_authority_v1 legacy
cross join ss.alakazam_policy_releases policy;

alter table ss.alakazam_policy_releases enable row level security;
alter table ss.alakazam_policy_releases force row level security;

revoke all on table ss.alakazam_policy_releases
from public, anon, authenticated, service_role;
grant select on table ss.alakazam_policy_releases to service_role;

revoke all on table ss.alakazam_policy_subscription_authority_v2
from public, anon, authenticated, service_role;
grant select on table ss.alakazam_policy_subscription_authority_v2
to service_role;

revoke all on function ss.reject_alakazam_policy_release_mutation()
from public, anon, authenticated, service_role;

create function ss.hosted_alakazam_policy_authority_contract_v2()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-policy-authority-v2-released'::text
$$;

revoke all on function ss.hosted_alakazam_policy_authority_contract_v2()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_alakazam_policy_authority_contract_v2()
to service_role;

commit;
