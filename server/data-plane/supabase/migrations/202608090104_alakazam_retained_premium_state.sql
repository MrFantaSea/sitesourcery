begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v51()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v52()') is null
    or to_regprocedure('ss.hosted_alakazam_35_contract()') is null
    or to_regprocedure('ss.hosted_alakazam_50_contract()') is null
    or to_regprocedure(
      'ss.hosted_alakazam_publication_contract()'
    ) is null
  then
    raise exception
      'Site Sourcery Alakazam lifecycle and tier migrations must precede retained premium state'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.alakazam_export_grants
  drop constraint alakazam_export_grants_policy_version_check;

alter table ss.alakazam_export_grants
  add constraint alakazam_export_grants_policy_version_check
  check (
    policy_version is null
    or policy_version =
      'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1'
  ),
  add constraint alakazam_export_grants_canonical_window_check
  check (
    retention_state <> 'granted'
    or (
      policy_version =
        'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1'
      and retention_ends_at =
        paid_through_at + interval '30 days'
      and export_window_ends_at = retention_ends_at
    )
  );

create table ss.alakazam_premium_retention_windows (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  source_kind text not null
    constraint alakazam_premium_retention_source_check
    check (
      source_kind in (
        'payment_grace_expired',
        'period_end_cancellation'
      )
    ),
  source_event_id uuid not null,
  export_grant_id uuid,
  subscription_revision bigint not null
    constraint alakazam_premium_retention_revision_check
    check (subscription_revision > 0),
  provider_facts_digest ss.sha256_hex not null,
  provider_observed_at timestamptz not null,
  policy_id text not null
    constraint alakazam_premium_retention_policy_check
    check (
      policy_id =
        'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1'
    ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state text not null default 'active'
    constraint alakazam_premium_retention_state_check
    check (state in ('active', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint alakazam_premium_retention_customer_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_premium_retention_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_premium_retention_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  constraint alakazam_premium_retention_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_premium_retention_event_fk
    foreign key (organization_id, source_event_id)
    references ss.alakazam_tier_change_events(organization_id, id),
  constraint alakazam_premium_retention_export_fk
    foreign key (organization_id, export_grant_id)
    references ss.alakazam_export_grants(organization_id, id),
  constraint alakazam_premium_retention_scope_uniq
    unique (organization_id, id),
  constraint alakazam_premium_retention_source_uniq
    unique (organization_id, source_event_id),
  constraint alakazam_premium_retention_window_check
    check (ends_at = starts_at + interval '30 days'),
  constraint alakazam_premium_retention_source_shape_check
    check (
      (
        source_kind = 'payment_grace_expired'
        and export_grant_id is null
      )
      or (
        source_kind = 'period_end_cancellation'
        and export_grant_id is not null
      )
    )
);

create unique index alakazam_one_active_premium_retention_window
  on ss.alakazam_premium_retention_windows(subscription_id)
  where state = 'active';

create table ss.alakazam_50_premium_restorations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null
    constraint alakazam_premium_restore_subscription_revision_check
    check (subscription_revision > 0),
  source_configuration_id uuid not null,
  source_configuration_revision bigint not null
    constraint alakazam_premium_restore_source_revision_check
    check (source_configuration_revision > 0),
  source_configuration_digest ss.sha256_hex not null,
  restored_configuration_id uuid not null unique,
  restored_configuration_revision bigint not null
    constraint alakazam_premium_restore_result_revision_check
    check (restored_configuration_revision > 1),
  restored_configuration_digest ss.sha256_hex not null,
  downgrade_event_id uuid not null,
  downgrade_event_revision bigint not null
    constraint alakazam_premium_restore_downgrade_revision_check
    check (downgrade_event_revision > 1),
  downgrade_event_digest ss.sha256_hex not null,
  upgrade_event_id uuid not null,
  upgrade_event_revision bigint not null
    constraint alakazam_premium_restore_upgrade_revision_check
    check (upgrade_event_revision > 2),
  upgrade_event_digest ss.sha256_hex not null,
  provider_facts_digest ss.sha256_hex not null,
  provider_observed_at timestamptz not null,
  policy_id text not null
    constraint alakazam_premium_restore_policy_check
    check (
      policy_id =
        'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1'
    ),
  evidence_digest ss.sha256_hex not null unique,
  state text not null default 'held'
    constraint alakazam_premium_restore_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_premium_restore_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  restored_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint alakazam_premium_restore_customer_fk
    foreign key (customer_user_id)
    references auth.users(id),
  constraint alakazam_premium_restore_project_fk
    foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  constraint alakazam_premium_restore_membership_fk
    foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  constraint alakazam_premium_restore_subscription_fk
    foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id),
  constraint alakazam_premium_restore_source_configuration_fk
    foreign key (organization_id, source_configuration_id)
    references ss.alakazam_50_configurations(organization_id, id),
  constraint alakazam_premium_restore_result_configuration_fk
    foreign key (organization_id, restored_configuration_id)
    references ss.alakazam_50_configurations(organization_id, id),
  constraint alakazam_premium_restore_downgrade_event_fk
    foreign key (organization_id, downgrade_event_id)
    references ss.alakazam_tier_change_events(organization_id, id),
  constraint alakazam_premium_restore_upgrade_event_fk
    foreign key (organization_id, upgrade_event_id)
    references ss.alakazam_tier_change_events(organization_id, id),
  constraint alakazam_premium_restore_scope_uniq
    unique (organization_id, id),
  constraint alakazam_premium_restore_distinct_events_check
    check (downgrade_event_id <> upgrade_event_id),
  constraint alakazam_premium_restore_command_binding_check
    check (restored_configuration_id = id),
  constraint alakazam_premium_restore_revision_order_check
    check (
      source_configuration_revision <
        restored_configuration_revision
      and downgrade_event_revision < upgrade_event_revision
      and upgrade_event_revision = subscription_revision
    )
);

create table ss.alakazam_premium_purge_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  reason text not null
    constraint alakazam_premium_purge_reason_check
    check (
      reason in (
        'terminal_customer_deletion',
        'retained_exit_expiry'
      )
    ),
  policy_id text not null
    constraint alakazam_premium_purge_policy_check
    check (
      policy_id =
        'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1'
    ),
  configuration_count bigint not null
    constraint alakazam_premium_purge_configuration_count_check
    check (configuration_count >= 0),
  restoration_count bigint not null
    constraint alakazam_premium_purge_restoration_count_check
    check (restoration_count >= 0),
  latest_configuration_digest ss.sha256_hex,
  receipt_digest ss.sha256_hex not null unique,
  state text not null default 'held'
    constraint alakazam_premium_purge_state_check
    check (state = 'held'),
  hold_reason text not null
    default 'commercial_cutover_not_authorized'
    constraint alakazam_premium_purge_hold_reason_check
    check (hold_reason = 'commercial_cutover_not_authorized'),
  purged_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint alakazam_premium_purge_scope_uniq
    unique (organization_id, id),
  constraint alakazam_premium_purge_once_uniq
    unique (organization_id, project_id, subscription_id, reason),
  constraint alakazam_premium_purge_digest_shape_check
    check (
      (configuration_count = 0 and latest_configuration_digest is null)
      or (
        configuration_count > 0
        and latest_configuration_digest is not null
      )
    )
);

create function ss.alakazam_premium_timestamp(value timestamptz)
returns text
language sql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
  select to_char(
    value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create function ss.alakazam_premium_restoration_digest(
  restoration ss.alakazam_50_premium_restorations
)
returns ss.sha256_hex
language sql
stable
strict
set search_path = pg_catalog, ss
as $$
  select ss.project_legal_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.alakazam-retained-premium-restoration/v1',
    'policyId', restoration.policy_id,
    'restorationId', restoration.id::text,
    'projectId', restoration.project_id::text,
    'subscriptionId', restoration.subscription_id::text,
    'subscriptionRevision', restoration.subscription_revision,
    'sourceConfigurationId', restoration.source_configuration_id::text,
    'sourceConfigurationRevision',
      restoration.source_configuration_revision,
    'sourceConfigurationDigest',
      restoration.source_configuration_digest,
    'restoredConfigurationId',
      restoration.restored_configuration_id::text,
    'restoredConfigurationRevision',
      restoration.restored_configuration_revision,
    'restoredConfigurationDigest',
      restoration.restored_configuration_digest,
    'downgradeEventId', restoration.downgrade_event_id::text,
    'downgradeEventRevision', restoration.downgrade_event_revision,
    'downgradeEventDigest', restoration.downgrade_event_digest,
    'upgradeEventId', restoration.upgrade_event_id::text,
    'upgradeEventRevision', restoration.upgrade_event_revision,
    'upgradeEventDigest', restoration.upgrade_event_digest,
    'providerFactsDigest', restoration.provider_facts_digest,
    'providerObservedAt',
      ss.alakazam_premium_timestamp(restoration.provider_observed_at),
    'restoredAt',
      ss.alakazam_premium_timestamp(restoration.restored_at),
    'state', restoration.state,
    'holdReason', restoration.hold_reason
  ))
$$;

create function ss.alakazam_premium_purge_receipt_digest(
  receipt ss.alakazam_premium_purge_receipts
)
returns ss.sha256_hex
language sql
stable
strict
set search_path = pg_catalog, ss
as $$
  select ss.project_legal_json_digest(jsonb_build_object(
    'schema', 'sitesourcery.alakazam-premium-purge-receipt/v1',
    'policyId', receipt.policy_id,
    'receiptId', receipt.id::text,
    'projectId', receipt.project_id::text,
    'subscriptionId', receipt.subscription_id::text,
    'reason', receipt.reason,
    'configurationCount', receipt.configuration_count,
    'restorationCount', receipt.restoration_count,
    'latestConfigurationDigest',
      receipt.latest_configuration_digest,
    'purgedAt', ss.alakazam_premium_timestamp(receipt.purged_at),
    'state', receipt.state,
    'holdReason', receipt.hold_reason
  ))
$$;

create function ss.validate_alakazam_premium_retention_window()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
  event_record record;
  grant_record record;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  select * into event_record
  from ss.alakazam_tier_change_events event
  where event.organization_id = new.organization_id
    and event.id = new.source_event_id;
  if subscription_record.id is null
    or event_record.id is null
    or subscription_record.project_id <> new.project_id
    or subscription_record.customer_user_id <>
         new.customer_user_id
    or subscription_record.revision <>
         new.subscription_revision
    or subscription_record.provider_facts_digest <>
         new.provider_facts_digest
    or subscription_record.provider_observed_at <>
         new.provider_observed_at
    or event_record.project_id <> new.project_id
    or event_record.subscription_id <> new.subscription_id
    or event_record.result_subscription_revision <>
         new.subscription_revision
    or not exists (
      select 1
      from ss.organization_memberships membership
      where membership.organization_id = new.organization_id
        and membership.user_id = new.customer_user_id
        and membership.state = 'active'
        and membership.role in ('owner', 'admin', 'editor')
    )
  then
    raise exception
      'Alakazam premium retention window lacks exact current authority'
      using errcode = '23514';
  end if;
  if new.source_kind = 'payment_grace_expired' then
    if subscription_record.status <> 'suspended'
      or subscription_record.first_failed_at is null
      or subscription_record.grace_ends_at <>
           subscription_record.first_failed_at + interval '7 days'
      or new.starts_at <> subscription_record.grace_ends_at
      or event_record.event_kind <> 'suspended'
      or new.export_grant_id is not null
    then
      raise exception
        'Alakazam payment-grace retained exit is not canonical'
        using errcode = '23514';
    end if;
  else
    select * into grant_record
    from ss.alakazam_export_grants export_record
    where export_record.organization_id = new.organization_id
      and export_record.id = new.export_grant_id;
    if subscription_record.status not in ('cancelled', 'ended')
      or grant_record.id is null
      or grant_record.project_id <> new.project_id
      or grant_record.subscription_id <> new.subscription_id
      or grant_record.state <> 'available'
      or grant_record.retention_state <> 'granted'
      or grant_record.policy_version <> new.policy_id
      or grant_record.retention_ends_at <> new.ends_at
      or grant_record.export_window_ends_at <> new.ends_at
      or grant_record.paid_through_at <> new.starts_at
      or event_record.event_kind not in ('cancelled', 'ended')
      or event_record.event_kind <> subscription_record.status
    then
      raise exception
        'Alakazam cancellation retained exit is not canonical'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create constraint trigger alakazam_premium_retention_windows_validate
after insert or update on ss.alakazam_premium_retention_windows
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_premium_retention_window();

create function ss.validate_alakazam_50_premium_restoration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
  source_record record;
  restored_record record;
  downgrade_record record;
  upgrade_record record;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  select * into source_record
  from ss.alakazam_50_configurations configuration
  where configuration.organization_id = new.organization_id
    and configuration.id = new.source_configuration_id;
  select * into restored_record
  from ss.alakazam_50_configurations configuration
  where configuration.organization_id = new.organization_id
    and configuration.id = new.restored_configuration_id;
  select * into downgrade_record
  from ss.alakazam_tier_change_events event
  where event.organization_id = new.organization_id
    and event.id = new.downgrade_event_id;
  select * into upgrade_record
  from ss.alakazam_tier_change_events event
  where event.organization_id = new.organization_id
    and event.id = new.upgrade_event_id;
  if subscription_record.id is null
    or source_record.id is null
    or restored_record.id is null
    or downgrade_record.id is null
    or upgrade_record.id is null
    or not exists (
      select 1
      from ss.projects project
      join ss.organization_memberships membership
        on membership.organization_id = project.organization_id
       and membership.user_id = new.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      where project.organization_id = new.organization_id
        and project.id = new.project_id
        and project.lifecycle = 'active'
    )
    or subscription_record.project_id <> new.project_id
    or subscription_record.customer_user_id <>
         new.customer_user_id
    or subscription_record.status <> 'active'
    or subscription_record.tier_id <> 'alakazam_50'
    or subscription_record.revision <>
         new.subscription_revision
    or subscription_record.provider_facts_digest <>
         new.provider_facts_digest
    or subscription_record.provider_observed_at <>
         new.provider_observed_at
    or source_record.project_id <> new.project_id
    or source_record.customer_user_id <> new.customer_user_id
    or source_record.subscription_id <> new.subscription_id
    or source_record.subscription_revision >=
         new.subscription_revision
    or source_record.configuration_revision <>
         new.source_configuration_revision
    or source_record.configuration_digest <>
         new.source_configuration_digest
    or restored_record.project_id <> new.project_id
    or restored_record.customer_user_id <> new.customer_user_id
    or restored_record.subscription_id <> new.subscription_id
    or restored_record.subscription_revision <>
         new.subscription_revision
    or restored_record.configuration_revision <>
         new.restored_configuration_revision
    or restored_record.configuration_digest <>
         new.restored_configuration_digest
    or restored_record.id <> new.restored_configuration_id
    or new.restored_configuration_id <> new.id
    or restored_record.configuration_revision <>
         source_record.configuration_revision + 1
    or restored_record.cash_app_handle is distinct from
         source_record.cash_app_handle
    or restored_record.venmo_handle is distinct from
         source_record.venmo_handle
    or restored_record.font_choice_id <>
         source_record.font_choice_id
    or restored_record.border_choice_id <>
         source_record.border_choice_id
    or restored_record.menu <> source_record.menu
    or restored_record.configured_at <> new.restored_at
    or new.restored_at < new.provider_observed_at
    or downgrade_record.project_id <> new.project_id
    or downgrade_record.subscription_id <> new.subscription_id
    or downgrade_record.event_kind <> 'downgrade_applied'
    or downgrade_record.prior_tier_id <> 'alakazam_50'
    or downgrade_record.result_tier_id not in (
         'alakazam_25', 'alakazam_35'
       )
    or downgrade_record.result_subscription_revision <>
         new.downgrade_event_revision
    or downgrade_record.facts_digest <>
         new.downgrade_event_digest
    or downgrade_record.result_subscription_revision <=
         source_record.subscription_revision
    or upgrade_record.project_id <> new.project_id
    or upgrade_record.subscription_id <> new.subscription_id
    or upgrade_record.event_kind <> 'upgrade_applied'
    or upgrade_record.prior_tier_id <>
         downgrade_record.result_tier_id
    or upgrade_record.result_tier_id <> 'alakazam_50'
    or upgrade_record.result_subscription_revision <>
         new.upgrade_event_revision
    or upgrade_record.result_subscription_revision <>
         subscription_record.revision
    or upgrade_record.facts_digest <> new.upgrade_event_digest
    or upgrade_record.stripe_event_row_id is null
    or upgrade_record.quote_id is null
    or upgrade_record.payment_receipt_id is null
    or new.evidence_digest <>
         ss.alakazam_premium_restoration_digest(new)
  then
    raise exception
      'retained Alakazam premium restoration lacks exact provider and tier-change evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_50_premium_restorations_validate
after insert on ss.alakazam_50_premium_restorations
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_50_premium_restoration();

create function ss.reject_alakazam_retained_premium_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'alakazam_premium_purge_receipts'
      and old.receipt_digest = ss.project_legal_json_digest(
        jsonb_build_object('initialReceiptId', old.id::text)
      )
      and new.receipt_digest <> old.receipt_digest
      and (
        to_jsonb(new) - 'receipt_digest'
      ) = (
        to_jsonb(old) - 'receipt_digest'
      )
      and nullif(
        current_setting(
          'app.alakazam_premium_purge_project_id',
          true
        ),
        ''
      )::uuid = old.project_id
    then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE'
    and nullif(
      current_setting('app.terminal_purge_project_id', true),
      ''
    )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  if tg_op = 'DELETE'
    and tg_table_name = 'alakazam_50_premium_restorations'
    and nullif(
      current_setting(
        'app.alakazam_premium_purge_project_id',
        true
      ),
      ''
    )::uuid = old.project_id
  then
    return old;
  end if;
  raise exception 'retained Alakazam premium evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_50_premium_restorations_immutable
before update or delete on ss.alakazam_50_premium_restorations
for each row execute function
  ss.reject_alakazam_retained_premium_evidence_mutation();

create trigger alakazam_premium_purge_receipts_immutable
before update or delete on ss.alakazam_premium_purge_receipts
for each row execute function
  ss.reject_alakazam_retained_premium_evidence_mutation();

create function ss.guard_alakazam_premium_retention_window()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  observed_at timestamptz;
begin
  if (
    to_jsonb(new) - array['state', 'updated_at']::text[]
  ) is distinct from (
    to_jsonb(old) - array['state', 'updated_at']::text[]
  ) then
    raise exception 'Alakazam premium retention purpose is immutable'
      using errcode = '55000';
  end if;
  observed_at := nullif(
    current_setting('app.alakazam_premium_purge_observed_at', true),
    ''
  )::timestamptz;
  if old.state <> 'active'
    or new.state <> 'expired'
    or nullif(
      current_setting(
        'app.alakazam_premium_purge_project_id',
        true
      ),
      ''
    )::uuid <> old.project_id
    or observed_at is null
    or observed_at < old.ends_at
  then
    raise exception 'invalid Alakazam premium retention transition'
      using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_premium_retention_windows_guard_update
before update on ss.alakazam_premium_retention_windows
for each row execute function
  ss.guard_alakazam_premium_retention_window();

create trigger alakazam_premium_retention_windows_immutable
before delete on ss.alakazam_premium_retention_windows
for each row execute function
  ss.reject_alakazam_retained_premium_evidence_mutation();

create or replace function ss.validate_alakazam_35_subscription_authority(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_subscription_id uuid,
  selected_subscription_revision bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
      from ss.alakazam_subscriptions subscription
      join ss.organization_memberships membership
        on membership.organization_id = subscription.organization_id
       and membership.user_id = subscription.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
     where subscription.organization_id = selected_organization_id
       and subscription.project_id = selected_project_id
       and subscription.customer_user_id = selected_customer_user_id
       and subscription.id = selected_subscription_id
       and subscription.revision = selected_subscription_revision
       and subscription.status = 'active'
       and ss.alakazam_tier_rank(subscription.tier_id) >= 2
  )
$$;

create or replace function ss.validate_alakazam_50_subscription_authority(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_subscription_id uuid,
  selected_subscription_revision bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
      from ss.alakazam_subscriptions subscription
      join ss.organization_memberships membership
        on membership.organization_id = subscription.organization_id
       and membership.user_id = subscription.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
     where subscription.organization_id = selected_organization_id
       and subscription.project_id = selected_project_id
       and subscription.customer_user_id = selected_customer_user_id
       and subscription.id = selected_subscription_id
       and subscription.revision = selected_subscription_revision
       and subscription.status = 'active'
       and subscription.tier_id = 'alakazam_50'
  )
$$;

create or replace function ss.validate_alakazam_50_configuration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  current_revision bigint;
  latest_configuration record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-50-configuration:' || new.project_id::text,
      0
    )
  );
  if not ss.validate_alakazam_50_subscription_authority(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.subscription_id,
    new.subscription_revision
  ) then
    raise exception
      'Alakazam 50 configuration lacks exact active subscription authority'
      using errcode = '23514';
  end if;
  select configuration.* into latest_configuration
  from ss.alakazam_50_configurations configuration
  where configuration.organization_id = new.organization_id
    and configuration.project_id = new.project_id
    and configuration.id <> new.id
  order by configuration.configuration_revision desc,
    configuration.id desc
  limit 1;
  current_revision := coalesce(
    latest_configuration.configuration_revision,
    0
  );
  if new.configuration_revision <> current_revision + 1 then
    raise exception
      'Alakazam 50 configuration revision is stale'
      using errcode = '40001';
  end if;
  if latest_configuration.id is not null
    and latest_configuration.subscription_revision <>
        new.subscription_revision
    and not exists (
      select 1
      from ss.alakazam_50_premium_restorations restoration
      where restoration.organization_id = new.organization_id
        and restoration.project_id = new.project_id
        and restoration.subscription_id = new.subscription_id
        and restoration.subscription_revision =
            new.subscription_revision
        and restoration.source_configuration_id =
            latest_configuration.id
        and restoration.restored_configuration_id = new.id
    )
  then
    raise exception
      'Alakazam 50 premium restoration evidence is required after authority changed'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create function ss.reject_nonactive_alakazam_publication()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.alakazam_subscriptions subscription
    where subscription.organization_id = new.organization_id
      and subscription.project_id = new.project_id
      and subscription.customer_user_id = new.customer_user_id
      and subscription.id = new.subscription_id
      and subscription.revision = new.subscription_revision
      and subscription.status = 'active'
  ) then
    raise exception
      'Alakazam publication is unavailable outside active service'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_customer_publication_commands_00_active
before insert on ss.alakazam_customer_publication_commands
for each row execute function
  ss.reject_nonactive_alakazam_publication();

create or replace function ss.reject_alakazam_35_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and nullif(
      current_setting('app.terminal_purge_project_id', true),
      ''
    )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  raise exception 'Alakazam 35 authority evidence is immutable'
    using errcode = '55000';
end
$$;

create or replace function ss.reject_alakazam_50_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and nullif(
      current_setting('app.terminal_purge_project_id', true),
      ''
    )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  if tg_op = 'DELETE'
    and tg_table_name = 'alakazam_50_configurations'
    and nullif(
      current_setting(
        'app.alakazam_premium_purge_project_id',
        true
      ),
      ''
    )::uuid = old.project_id
  then
    return old;
  end if;
  raise exception 'Alakazam 50 authority evidence is immutable'
    using errcode = '55000';
end
$$;

create function ss.apply_alakazam_premium_retained_exit_policy(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_subscription_id uuid,
  selected_window_id uuid,
  selected_observed_at timestamptz
)
returns ss.alakazam_premium_retention_windows
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
  event_record record;
  grant_record record;
  existing_window ss.alakazam_premium_retention_windows%rowtype;
  result_window ss.alakazam_premium_retention_windows%rowtype;
  source_kind text;
  starts_at timestamptz;
  ends_at timestamptz;
  export_grant_id uuid;
begin
  if selected_observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'future retained-exit observation is invalid'
      using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-premium-retained-exit:' ||
        selected_subscription_id::text,
      0
    )
  );
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = selected_organization_id
    and subscription.project_id = selected_project_id
    and subscription.id = selected_subscription_id
  for update;
  if not found then
    raise exception 'Alakazam retained-exit subscription is unavailable'
      using errcode = 'P0002';
  end if;
  select * into existing_window
  from ss.alakazam_premium_retention_windows retention_record
  where retention_record.organization_id = selected_organization_id
    and retention_record.subscription_id = selected_subscription_id
    and retention_record.state = 'active';
  if found then
    if existing_window.id <> selected_window_id then
      raise exception 'Alakazam retained-exit idempotency conflict'
        using errcode = '23505';
    end if;
    return existing_window;
  end if;
  if subscription_record.status = 'suspended' then
    if subscription_record.first_failed_at is null
      or subscription_record.grace_ends_at <>
           subscription_record.first_failed_at + interval '7 days'
      or selected_observed_at < subscription_record.grace_ends_at
    then
      raise exception 'Alakazam payment grace has not expired canonically'
        using errcode = '23514';
    end if;
    select * into event_record
    from ss.alakazam_tier_change_events event
    where event.organization_id = selected_organization_id
      and event.project_id = selected_project_id
      and event.subscription_id = selected_subscription_id
      and event.event_kind = 'suspended'
      and event.result_subscription_revision =
          subscription_record.revision
      and event.stripe_event_row_id is not null
    order by event.occurred_at desc, event.id desc
    limit 1;
    source_kind := 'payment_grace_expired';
    starts_at := subscription_record.grace_ends_at;
    export_grant_id := null;
  elsif subscription_record.status in ('cancelled', 'ended') then
    select export_record.* into grant_record
    from ss.alakazam_export_grants export_record
    join ss.alakazam_cancellations cancellation
      on cancellation.organization_id = export_record.organization_id
     and cancellation.id = export_record.cancellation_id
     and cancellation.project_id = export_record.project_id
     and cancellation.subscription_id = export_record.subscription_id
     and cancellation.state = 'effective'
     and cancellation.provider_effect_certainty = 'confirmed'
    where export_record.organization_id = selected_organization_id
      and export_record.project_id = selected_project_id
      and export_record.subscription_id = selected_subscription_id
    for update of export_record;
    if not found or selected_observed_at < grant_record.paid_through_at then
      raise exception 'Alakazam cancellation retained exit is unavailable'
        using errcode = '23514';
    end if;
    update ss.alakazam_export_grants
    set retention_state = 'granted',
        policy_version =
          'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1',
        retention_ends_at =
          grant_record.paid_through_at + interval '30 days',
        export_window_ends_at =
          grant_record.paid_through_at + interval '30 days'
    where organization_id = selected_organization_id
      and id = grant_record.id;
    select * into event_record
    from ss.alakazam_tier_change_events event
    where event.organization_id = selected_organization_id
      and event.project_id = selected_project_id
      and event.subscription_id = selected_subscription_id
      and event.event_kind = subscription_record.status
      and event.result_subscription_revision =
          subscription_record.revision
      and event.stripe_event_row_id is not null
    order by event.occurred_at desc, event.id desc
    limit 1;
    source_kind := 'period_end_cancellation';
    starts_at := grant_record.paid_through_at;
    export_grant_id := grant_record.id;
  else
    raise exception 'Alakazam subscription has no retained-exit authority'
      using errcode = '23514';
  end if;
  if event_record.id is null then
    raise exception 'Alakazam retained exit lacks canonical lifecycle evidence'
      using errcode = '23514';
  end if;
  ends_at := starts_at + interval '30 days';
  insert into ss.alakazam_premium_retention_windows (
    id, organization_id, project_id, customer_user_id,
    subscription_id, source_kind, source_event_id,
    export_grant_id, subscription_revision,
    provider_facts_digest, provider_observed_at, policy_id,
    starts_at, ends_at, state
  ) values (
    selected_window_id, selected_organization_id,
    selected_project_id, subscription_record.customer_user_id,
    selected_subscription_id, source_kind, event_record.id,
    export_grant_id, subscription_record.revision,
    subscription_record.provider_facts_digest,
    subscription_record.provider_observed_at,
    'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1',
    starts_at, ends_at, 'active'
  ) returning * into result_window;
  return result_window;
end
$$;

create function ss.purge_alakazam_premium_rows(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_subscription_id uuid,
  selected_receipt_id uuid,
  selected_reason text,
  selected_observed_at timestamptz
)
returns ss.alakazam_premium_purge_receipts
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  result_receipt ss.alakazam_premium_purge_receipts%rowtype;
  configuration_count bigint;
  restoration_count bigint;
  latest_digest ss.sha256_hex;
begin
  select * into result_receipt
  from ss.alakazam_premium_purge_receipts receipt
  where receipt.organization_id = selected_organization_id
    and receipt.project_id = selected_project_id
    and receipt.subscription_id = selected_subscription_id
    and receipt.reason = selected_reason;
  if found then
    if result_receipt.id <> selected_receipt_id then
      raise exception 'Alakazam premium purge idempotency conflict'
        using errcode = '23505';
    end if;
    return result_receipt;
  end if;
  select count(*)::bigint into configuration_count
  from ss.alakazam_50_configurations configuration
  where configuration.organization_id = selected_organization_id
    and configuration.project_id = selected_project_id
    and configuration.subscription_id = selected_subscription_id;
  select configuration.configuration_digest into latest_digest
  from ss.alakazam_50_configurations configuration
  where configuration.organization_id = selected_organization_id
    and configuration.project_id = selected_project_id
    and configuration.subscription_id = selected_subscription_id
  order by configuration.configuration_revision desc,
    configuration.id desc
  limit 1;
  select count(*)::bigint into restoration_count
  from ss.alakazam_50_premium_restorations restoration
  where restoration.organization_id = selected_organization_id
    and restoration.project_id = selected_project_id
    and restoration.subscription_id = selected_subscription_id;
  perform set_config(
    'app.alakazam_premium_purge_project_id',
    selected_project_id::text,
    true
  );
  perform set_config(
    'app.alakazam_premium_purge_observed_at',
    selected_observed_at::text,
    true
  );
  delete from ss.alakazam_50_premium_restorations
  where organization_id = selected_organization_id
    and project_id = selected_project_id
    and subscription_id = selected_subscription_id;
  delete from ss.alakazam_50_configurations
  where organization_id = selected_organization_id
    and project_id = selected_project_id
    and subscription_id = selected_subscription_id;
  insert into ss.alakazam_premium_purge_receipts (
    id, organization_id, project_id, subscription_id,
    reason, policy_id, configuration_count,
    restoration_count, latest_configuration_digest,
    receipt_digest, state, hold_reason, purged_at
  ) values (
    selected_receipt_id, selected_organization_id,
    selected_project_id, selected_subscription_id,
    selected_reason,
    'SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1',
    configuration_count, restoration_count, latest_digest,
    ss.project_legal_json_digest(jsonb_build_object(
      'initialReceiptId', selected_receipt_id::text
    )), 'held',
    'commercial_cutover_not_authorized', selected_observed_at
  ) returning * into result_receipt;
  update ss.alakazam_premium_purge_receipts
  set receipt_digest =
    ss.alakazam_premium_purge_receipt_digest(result_receipt)
  where organization_id = selected_organization_id
    and id = selected_receipt_id
  returning * into result_receipt;
  return result_receipt;
end
$$;

create function ss.purge_expired_alakazam_premium(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_subscription_id uuid,
  selected_receipt_id uuid,
  selected_observed_at timestamptz
)
returns ss.alakazam_premium_purge_receipts
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  window_record ss.alakazam_premium_retention_windows%rowtype;
  result_receipt ss.alakazam_premium_purge_receipts%rowtype;
begin
  if selected_observed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'future Alakazam premium purge is invalid'
      using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-alakazam-premium-purge:' || selected_subscription_id::text,
      0
    )
  );
  select * into window_record
  from ss.alakazam_premium_retention_windows retention_record
  where retention_record.organization_id = selected_organization_id
    and retention_record.project_id = selected_project_id
    and retention_record.subscription_id = selected_subscription_id
  order by retention_record.ends_at desc, retention_record.id desc
  limit 1
  for update;
  if not found
    or window_record.ends_at > selected_observed_at
    or window_record.state not in ('active', 'expired')
  then
    raise exception 'Alakazam premium retained exit has not expired'
      using errcode = '23514';
  end if;
  perform set_config(
    'app.alakazam_premium_purge_project_id',
    selected_project_id::text,
    true
  );
  perform set_config(
    'app.alakazam_premium_purge_observed_at',
    selected_observed_at::text,
    true
  );
  if window_record.state = 'active' then
    update ss.alakazam_premium_retention_windows
    set state = 'expired'
    where organization_id = selected_organization_id
      and id = window_record.id;
  end if;
  result_receipt := ss.purge_alakazam_premium_rows(
    selected_organization_id,
    selected_project_id,
    selected_subscription_id,
    selected_receipt_id,
    'retained_exit_expiry',
    selected_observed_at
  );
  return result_receipt;
end
$$;

create function ss.purge_alakazam_tier_data_on_project_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss, extensions
as $$
declare
  subscription_record record;
  receipt_id uuid;
begin
  if new.state = 'purging' then
    if nullif(
      current_setting('app.terminal_purge_project_id', true),
      ''
    )::uuid is distinct from new.project_id
    then
      raise exception
        'Alakazam tier-data purge requires the sealed deletion boundary'
        using errcode = '42501';
    end if;
    for subscription_record in
      select subscription.id
      from ss.alakazam_subscriptions subscription
      where subscription.organization_id = new.organization_id
        and subscription.project_id = new.project_id
    loop
      receipt_id := extensions.gen_random_uuid();
      perform ss.purge_alakazam_premium_rows(
        new.organization_id,
        new.project_id,
        subscription_record.id,
        receipt_id,
        'terminal_customer_deletion',
        clock_timestamp()
      );
    end loop;
    delete from ss.alakazam_premium_retention_windows
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.alakazam_50_care_requests
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.alakazam_35_care_requests
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.alakazam_35_configurations
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.alakazam_35_photo_assets
    where organization_id = new.organization_id
      and project_id = new.project_id;
  end if;
  return new;
end
$$;

create trigger deletion_requests_00_purge_alakazam_tier_data
after insert or update of state on ss.deletion_requests
for each row execute function
  ss.purge_alakazam_tier_data_on_project_deletion();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'alakazam_50_premium_restorations',
    'alakazam_premium_purge_receipts',
    'alakazam_premium_retention_windows'
  ] loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on ss.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;
end
$$;

grant select, insert on ss.alakazam_50_premium_restorations
to service_role;
grant select on ss.alakazam_premium_purge_receipts
to service_role;
grant select on ss.alakazam_premium_retention_windows
to service_role;

revoke all on function
  ss.alakazam_premium_timestamp(timestamptz),
  ss.alakazam_premium_restoration_digest(
    ss.alakazam_50_premium_restorations
  ),
  ss.alakazam_premium_purge_receipt_digest(
    ss.alakazam_premium_purge_receipts
  ),
  ss.validate_alakazam_premium_retention_window(),
  ss.validate_alakazam_50_premium_restoration(),
  ss.reject_alakazam_retained_premium_evidence_mutation(),
  ss.guard_alakazam_premium_retention_window(),
  ss.reject_nonactive_alakazam_publication(),
  ss.apply_alakazam_premium_retained_exit_policy(
    uuid, uuid, uuid, uuid, timestamptz
  ),
  ss.purge_alakazam_premium_rows(
    uuid, uuid, uuid, uuid, text, timestamptz
  ),
  ss.purge_expired_alakazam_premium(
    uuid, uuid, uuid, uuid, timestamptz
  ),
  ss.purge_alakazam_tier_data_on_project_deletion()
from public, anon, authenticated, service_role;

grant execute on function
  ss.alakazam_premium_timestamp(timestamptz),
  ss.alakazam_premium_restoration_digest(
    ss.alakazam_50_premium_restorations
  ),
  ss.alakazam_premium_purge_receipt_digest(
    ss.alakazam_premium_purge_receipts
  ),
  ss.validate_alakazam_premium_retention_window(),
  ss.validate_alakazam_50_premium_restoration(),
  ss.reject_alakazam_retained_premium_evidence_mutation(),
  ss.guard_alakazam_premium_retention_window(),
  ss.reject_nonactive_alakazam_publication()
to service_role;

grant execute on function
  ss.apply_alakazam_premium_retained_exit_policy(
    uuid, uuid, uuid, uuid, timestamptz
  ),
  ss.purge_expired_alakazam_premium(
    uuid, uuid, uuid, uuid, timestamptz
  )
to service_role;

create function ss.hosted_alakazam_retained_premium_contract()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-alakazam-retained-premium-held-v1'::text
$$;

revoke all on function
  ss.hosted_alakazam_retained_premium_contract()
from public, anon, authenticated;
grant execute on function
  ss.hosted_alakazam_retained_premium_contract()
to service_role;

commit;
