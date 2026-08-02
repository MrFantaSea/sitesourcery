begin;

do $$
begin
  if to_regclass('ss.commerce_v2_project_entitlements') is null
    or to_regclass('ss.stripe_customers') is null
    or to_regclass('ss.projects') is null
    or to_regclass('ss.deletion_requests') is null
    or to_regprocedure(
      'ss.hosted_runtime_contract_v22()'
    ) is null
  then
    raise exception
      'Site Sourcery migration 022 must be applied before Alakazam billing'
      using errcode = '55000';
  end if;
end
$$;

create function ss.alakazam_tier_amount_minor(
  selected_tier text
)
returns bigint
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case selected_tier
    when 'alakazam_25' then 2500::bigint
    when 'alakazam_35' then 3500::bigint
    when 'alakazam_50' then 5000::bigint
    else null::bigint
  end
$$;

create function ss.alakazam_tier_rank(
  selected_tier text
)
returns smallint
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case selected_tier
    when 'alakazam_25' then 1::smallint
    when 'alakazam_35' then 2::smallint
    when 'alakazam_50' then 3::smallint
    else null::smallint
  end
$$;

create table ss.alakazam_subscriptions (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  stripe_customer_row_id uuid not null,
  stripe_subscription_id text not null unique
    check (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  stripe_subscription_item_id text not null unique
    check (
      stripe_subscription_item_id ~ '^si_[A-Za-z0-9_]+$'
    ),
  stripe_price_id text not null
    check (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  initial_quote_id uuid not null,
  activation_receipt_id uuid,
  tier_id text not null
    check (
      tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  status text not null
    check (
      status in (
        'pending',
        'active',
        'grace',
        'suspended',
        'cancelled',
        'ended'
      )
    ),
  currency text not null check (currency = 'USD'),
  amount_minor bigint not null,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  first_failed_at timestamptz,
  grace_ends_at timestamptz,
  suspended_at timestamptz,
  cancelled_at timestamptz,
  ended_at timestamptz,
  provider_observed_at timestamptz not null,
  provider_facts_digest ss.sha256_hex not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (
    organization_id,
    stripe_customer_row_id
  ) references ss.stripe_customers(
    organization_id,
    id
  ),
  check (
    amount_minor =
      ss.alakazam_tier_amount_minor(tier_id)
  ),
  check (
    (
      current_period_starts_at is null
      and current_period_ends_at is null
      and status = 'pending'
    )
    or (
      current_period_starts_at is not null
      and current_period_ends_at is not null
      and current_period_ends_at >
        current_period_starts_at
    )
  ),
  check (
    (status = 'pending' and activation_receipt_id is null)
    or (
      status <> 'pending'
      and activation_receipt_id is not null
    )
  ),
  check (
    grace_ends_at is null
    or first_failed_at is not null
  ),
  check (
    suspended_at is null
    or status in ('suspended', 'cancelled', 'ended')
  ),
  check (
    cancelled_at is null
    or status in ('cancelled', 'ended')
  ),
  check (
    (status = 'ended' and ended_at is not null)
    or (status <> 'ended' and ended_at is null)
  )
);

create unique index alakazam_one_current_subscription
  on ss.alakazam_subscriptions(
    organization_id,
    project_id
  )
  where status <> 'ended';

create table ss.alakazam_change_quotes (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  catalog_version text not null
    check (
      catalog_version = 'alakazam.2026-08-02.v1'
    ),
  terms_version text not null
    check (
      terms_version =
        'alakazam-owner-contract.2026-08-02.v1'
    ),
  change_kind text not null
    check (change_kind in ('start', 'upgrade', 'downgrade')),
  current_subscription_id uuid,
  current_subscription_revision bigint
    check (
      current_subscription_revision is null
      or current_subscription_revision > 0
    ),
  current_tier_id text
    check (
      current_tier_id is null
      or current_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  current_amount_minor bigint,
  current_period_ends_at timestamptz,
  target_tier_id text not null
    check (
      target_tier_id in (
        'alakazam_25',
        'alakazam_35',
        'alakazam_50'
      )
    ),
  target_amount_minor bigint not null,
  applied_value_kind text not null
    check (
      applied_value_kind in (
        'none',
        'download_purchase',
        'current_paid_tier'
      )
    ),
  applied_value_minor bigint not null
    check (applied_value_minor >= 0),
  download_entitlement_id uuid,
  due_now_subtotal_minor bigint not null
    check (due_now_subtotal_minor >= 0),
  next_renewal_amount_minor bigint not null,
  currency text not null check (currency = 'USD'),
  effective_rule text not null
    check (
      effective_rule in (
        'after_payment_and_provider_confirmation',
        'current_period_end'
      )
    ),
  effective_at timestamptz,
  no_mid_period_refund boolean not null,
  provider_proration_enabled boolean not null,
  premium_configuration_policy text not null
    check (
      premium_configuration_policy =
        'preserved_when_inactive'
    ),
  tax_state text not null
    check (
      tax_state in (
        'release_configuration_required',
        'automatic',
        'disabled_by_owner'
      )
    ),
  disclosure jsonb not null
    check (
      jsonb_typeof(disclosure) = 'object'
      and pg_column_size(disclosure) <= 32768
    ),
  disclosure_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null unique,
  state text not null
    check (
      state in (
        'held',
        'quoted',
        'checkout_dispatching',
        'checkout_ready',
        'payment_settled',
        'provider_change_pending',
        'schedule_dispatching',
        'applied',
        'scheduled',
        'expired',
        'failed',
        'reconciliation_required'
      )
    ),
  provider_effects_authorized boolean not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_by_user_id uuid not null
    references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (
    organization_id,
    current_subscription_id
  ) references ss.alakazam_subscriptions(
    organization_id,
    id
  ) on delete cascade,
  foreign key (
    organization_id,
    download_entitlement_id
  ) references ss.commerce_v2_project_entitlements(
    organization_id,
    id
  ),
  check (expires_at > issued_at),
  check (
    expires_at - issued_at <= interval '30 minutes'
  ),
  check (
    target_amount_minor =
      ss.alakazam_tier_amount_minor(target_tier_id)
    and next_renewal_amount_minor = target_amount_minor
  ),
  check (
    (state = 'held' and not provider_effects_authorized)
    or (state <> 'held' and provider_effects_authorized)
  ),
  check (
    provider_effects_authorized
    or tax_state = 'release_configuration_required'
  ),
  check (
    (change_kind = 'start' and (
      current_subscription_id is null
      and current_subscription_revision is null
      and current_tier_id is null
      and current_amount_minor is null
      and current_period_ends_at is null
      and applied_value_kind in ('none', 'download_purchase')
      and applied_value_minor in (0, 500)
      and (
        (
          applied_value_kind = 'none'
          and applied_value_minor = 0
          and download_entitlement_id is null
        )
        or (
          applied_value_kind = 'download_purchase'
          and applied_value_minor = 500
          and download_entitlement_id is not null
        )
      )
      and due_now_subtotal_minor =
        target_amount_minor - applied_value_minor
      and effective_rule =
        'after_payment_and_provider_confirmation'
      and effective_at is null
      and not no_mid_period_refund
      and not provider_proration_enabled
    )) or (change_kind = 'upgrade' and (
      current_subscription_id is not null
      and current_subscription_revision is not null
      and current_tier_id is not null
      and current_amount_minor =
        ss.alakazam_tier_amount_minor(current_tier_id)
      and current_period_ends_at is not null
      and ss.alakazam_tier_rank(target_tier_id) >
        ss.alakazam_tier_rank(current_tier_id)
      and applied_value_kind = 'current_paid_tier'
      and applied_value_minor = current_amount_minor
      and download_entitlement_id is null
      and due_now_subtotal_minor =
        target_amount_minor - current_amount_minor
      and effective_rule =
        'after_payment_and_provider_confirmation'
      and effective_at is null
      and not no_mid_period_refund
      and not provider_proration_enabled
    )) or (change_kind = 'downgrade' and (
      current_subscription_id is not null
      and current_subscription_revision is not null
      and current_tier_id is not null
      and current_amount_minor =
        ss.alakazam_tier_amount_minor(current_tier_id)
      and current_period_ends_at is not null
      and ss.alakazam_tier_rank(target_tier_id) <
        ss.alakazam_tier_rank(current_tier_id)
      and applied_value_kind = 'none'
      and applied_value_minor = 0
      and download_entitlement_id is null
      and due_now_subtotal_minor = 0
      and effective_rule = 'current_period_end'
      and effective_at = current_period_ends_at
      and no_mid_period_refund
      and not provider_proration_enabled
    ))
  )
);

alter table ss.alakazam_subscriptions
  add constraint alakazam_subscriptions_initial_quote_fk
  foreign key (organization_id, initial_quote_id)
  references ss.alakazam_change_quotes(organization_id, id);

create table ss.alakazam_checkout_dispatches (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  quote_id uuid not null unique,
  mode text not null
    check (mode in ('subscription_start', 'upgrade_difference')),
  provider text not null check (provider = 'stripe'),
  stripe_customer_id text not null
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  provider_idempotency_key text not null unique
    check (char_length(provider_idempotency_key) between 8 and 255),
  purpose_digest ss.sha256_hex not null,
  purpose jsonb not null
    check (
      jsonb_typeof(purpose) = 'object'
      and pg_column_size(purpose) <= 32768
    ),
  expected_subtotal_minor bigint not null
    check (expected_subtotal_minor > 0),
  expected_credit_minor bigint not null
    check (expected_credit_minor in (0, 500)),
  currency text not null check (currency = 'USD'),
  state text not null
    check (
      state in (
        'reserved',
        'ready',
        'settled',
        'expired',
        'failed',
        'persistence_unknown'
      )
    ),
  stripe_checkout_session_id text unique
    check (
      stripe_checkout_session_id is null
      or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    ),
  provider_checkout_url text,
  provider_expires_at timestamptz,
  dispatched_at timestamptz,
  settled_at timestamptz,
  provider_effect_certainty text not null
    check (
      provider_effect_certainty in (
        'not_submitted',
        'confirmed',
        'ambiguous'
      )
    ),
  provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code) between 1 and 200
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  check (
    (state = 'reserved' and (
      stripe_checkout_session_id is null
      and provider_checkout_url is null
      and provider_expires_at is null
      and dispatched_at is null
      and provider_effect_certainty = 'not_submitted'
    )) or (state <> 'reserved' and (
      stripe_checkout_session_id is not null
      or state in ('failed', 'persistence_unknown')
    ))
  ),
  check (
    (state in ('ready', 'settled', 'expired') and (
      provider_checkout_url is not null
      and provider_expires_at is not null
      and dispatched_at is not null
      and provider_effect_certainty = 'confirmed'
    )) or state not in ('ready', 'settled', 'expired')
  ),
  check (
    (state = 'settled' and settled_at is not null)
    or (state <> 'settled' and settled_at is null)
  )
);

create table ss.alakazam_stripe_events (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  quote_id uuid,
  subscription_id uuid,
  stripe_event_id text not null unique
    check (stripe_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  event_type text not null
    check (char_length(event_type) between 3 and 200),
  livemode boolean not null,
  api_version text
    check (
      api_version is null
      or char_length(api_version) between 3 and 100
    ),
  provider_object_id text not null
    check (char_length(provider_object_id) between 3 and 255),
  payload_digest ss.sha256_hex not null,
  facts jsonb not null
    check (
      jsonb_typeof(facts) = 'object'
      and pg_column_size(facts) <= 32768
    ),
  state text not null default 'received'
    check (
      state in (
        'received',
        'processing',
        'processed',
        'ignored',
        'failed'
      )
    ),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  signature_verified_at timestamptz not null,
  occurred_at timestamptz not null,
  processed_at timestamptz,
  failure_code text
    check (
      failure_code is null
      or char_length(failure_code) between 1 and 200
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  check (quote_id is not null or subscription_id is not null),
  check (
    (state in ('processed', 'ignored') and processed_at is not null)
    or (state not in ('processed', 'ignored') and processed_at is null)
  ),
  check (
    (state = 'failed' and failure_code is not null)
    or (state <> 'failed' and failure_code is null)
  )
);

create table ss.alakazam_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  subscription_id uuid not null,
  quote_id uuid,
  stripe_event_row_id uuid not null,
  receipt_kind text not null
    check (
      receipt_kind in (
        'start_payment',
        'upgrade_difference',
        'renewal_payment'
      )
    ),
  stripe_invoice_id text
    check (
      stripe_invoice_id is null
      or stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'
    ),
  stripe_payment_intent_id text not null
    check (
      stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
    ),
  list_subtotal_minor bigint not null
    check (list_subtotal_minor > 0),
  provider_discount_minor bigint not null
    check (provider_discount_minor in (0, 500)),
  net_subtotal_minor bigint not null
    check (net_subtotal_minor >= 0),
  tax_minor bigint not null check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  tax_mode text not null
    check (tax_mode in ('automatic', 'disabled_by_owner')),
  currency text not null check (currency = 'USD'),
  settled_at timestamptz not null,
  provider_facts jsonb not null
    check (
      jsonb_typeof(provider_facts) = 'object'
      and pg_column_size(provider_facts) <= 32768
    ),
  provider_facts_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (
    stripe_event_row_id,
    stripe_payment_intent_id,
    receipt_kind
  ),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  foreign key (organization_id, stripe_event_row_id)
    references ss.alakazam_stripe_events(organization_id, id)
    on delete cascade,
  check (
    net_subtotal_minor =
      list_subtotal_minor - provider_discount_minor
    and total_minor = net_subtotal_minor + tax_minor
  ),
  check (
    (tax_mode = 'automatic')
    or (tax_mode = 'disabled_by_owner' and tax_minor = 0)
  ),
  check (
    (receipt_kind = 'renewal_payment' and quote_id is null)
    or (receipt_kind <> 'renewal_payment' and quote_id is not null)
  ),
  check (
    receipt_kind = 'start_payment'
    or provider_discount_minor = 0
  )
);

alter table ss.alakazam_subscriptions
  add constraint alakazam_subscriptions_activation_receipt_fk
  foreign key (organization_id, activation_receipt_id)
  references ss.alakazam_payment_receipts(organization_id, id)
  deferrable initially deferred;

create table ss.alakazam_credit_applications (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  quote_id uuid not null unique,
  download_entitlement_id uuid not null unique,
  payment_receipt_id uuid not null unique,
  amount_minor bigint not null check (amount_minor = 500),
  state text not null default 'applied'
    check (state in ('applied', 'source_reversed')),
  applied_at timestamptz not null,
  source_reversal_event_id text,
  source_reversed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    download_entitlement_id
  ) references ss.commerce_v2_project_entitlements(
    organization_id,
    id
  ),
  foreign key (organization_id, payment_receipt_id)
    references ss.alakazam_payment_receipts(organization_id, id)
    on delete cascade,
  foreign key (
    organization_id,
    source_reversal_event_id
  ) references ss.commerce_v2_download_reversal_events(
    organization_id,
    id
  ),
  check (
    (state = 'applied' and (
      source_reversal_event_id is null
      and source_reversed_at is null
    ))
    or (
      state = 'source_reversed'
      and source_reversal_event_id is not null
      and source_reversed_at is not null
    )
  )
);

create table ss.alakazam_downgrade_schedules (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  quote_id uuid not null unique,
  current_tier_id text not null,
  target_tier_id text not null,
  current_stripe_price_id text not null
    check (current_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  target_stripe_price_id text not null
    check (target_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  effective_at timestamptz not null,
  provider_idempotency_key text not null unique
    check (char_length(provider_idempotency_key) between 8 and 255),
  purpose_digest ss.sha256_hex not null,
  stripe_schedule_id text unique
    check (
      stripe_schedule_id is null
      or stripe_schedule_id ~ '^sub_sched_[A-Za-z0-9_]+$'
    ),
  state text not null
    check (
      state in (
        'dispatching',
        'scheduled',
        'applied',
        'cancelled',
        'reconciliation_required'
      )
    ),
  provider_facts jsonb
    check (
      provider_facts is null
      or (
        jsonb_typeof(provider_facts) = 'object'
        and pg_column_size(provider_facts) <= 32768
      )
    ),
  provider_facts_digest ss.sha256_hex,
  scheduled_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  check (
    current_tier_id in (
      'alakazam_25', 'alakazam_35', 'alakazam_50'
    )
    and target_tier_id in (
      'alakazam_25', 'alakazam_35', 'alakazam_50'
    )
    and ss.alakazam_tier_rank(target_tier_id) <
      ss.alakazam_tier_rank(current_tier_id)
  ),
  check (
    (state = 'dispatching' and (
      stripe_schedule_id is null
      and provider_facts is null
      and provider_facts_digest is null
      and scheduled_at is null
    )) or (state in ('scheduled', 'applied', 'cancelled') and (
      stripe_schedule_id is not null
      and provider_facts is not null
      and provider_facts_digest is not null
      and scheduled_at is not null
    )) or state = 'reconciliation_required'
  ),
  check (
    (state = 'applied' and applied_at >= effective_at)
    or (state <> 'applied' and applied_at is null)
  ),
  check (
    (state = 'cancelled' and cancelled_at is not null)
    or (state <> 'cancelled' and cancelled_at is null)
  )
);

create unique index alakazam_one_open_downgrade
  on ss.alakazam_downgrade_schedules(subscription_id)
  where state in (
    'dispatching',
    'scheduled',
    'reconciliation_required'
  );

create function ss.validate_alakazam_downgrade_schedule()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'dispatching'
    or not exists (
      select 1
      from ss.alakazam_change_quotes quote
      join ss.alakazam_subscriptions subscription
        on subscription.organization_id = quote.organization_id
       and subscription.id = quote.current_subscription_id
      where quote.organization_id = new.organization_id
        and quote.project_id = new.project_id
        and quote.id = new.quote_id
        and quote.change_kind = 'downgrade'
        and quote.state = 'schedule_dispatching'
        and quote.current_subscription_id =
            new.subscription_id
        and quote.current_subscription_revision =
            subscription.revision
        and quote.current_tier_id = new.current_tier_id
        and quote.target_tier_id = new.target_tier_id
        and quote.effective_at = new.effective_at
        and subscription.project_id = new.project_id
        and subscription.status = 'active'
        and subscription.tier_id = new.current_tier_id
        and subscription.stripe_price_id =
            new.current_stripe_price_id
        and subscription.current_period_ends_at =
            new.effective_at
        and not subscription.cancel_at_period_end
    )
  then
    raise exception
      'Alakazam downgrade requires its exact current-period quote'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_downgrades_validate
before insert on ss.alakazam_downgrade_schedules
for each row execute function
  ss.validate_alakazam_downgrade_schedule();

create function ss.guard_alakazam_downgrade_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'stripe_schedule_id',
      'provider_facts',
      'provider_facts_digest',
      'scheduled_at',
      'applied_at',
      'cancelled_at',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'stripe_schedule_id',
      'provider_facts',
      'provider_facts_digest',
      'scheduled_at',
      'applied_at',
      'cancelled_at',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam downgrade purpose is immutable'
      using errcode = '55000';
  end if;
  if new.state <> old.state and not (
    (old.state = 'dispatching' and new.state in (
      'scheduled', 'reconciliation_required'
    ))
    or (old.state = 'scheduled' and new.state in (
      'applied', 'cancelled', 'reconciliation_required'
    ))
    or (
      old.state = 'reconciliation_required'
      and new.state in ('scheduled', 'applied', 'cancelled')
    )
  ) then
    raise exception 'invalid Alakazam downgrade transition'
      using errcode = '23514';
  end if;
  if old.state in ('scheduled', 'applied', 'cancelled')
    and (
      new.stripe_schedule_id is distinct from
        old.stripe_schedule_id
      or new.provider_facts is distinct from
        old.provider_facts
      or new.provider_facts_digest is distinct from
        old.provider_facts_digest
      or new.scheduled_at is distinct from old.scheduled_at
    )
  then
    raise exception
      'confirmed Alakazam downgrade evidence is immutable'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_downgrades_guard_update
before update on ss.alakazam_downgrade_schedules
for each row execute function
  ss.guard_alakazam_downgrade_update();

create table ss.alakazam_tier_change_events (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  quote_id uuid,
  stripe_event_row_id uuid,
  payment_receipt_id uuid,
  downgrade_schedule_id uuid,
  download_reversal_event_id text,
  result_subscription_revision bigint
    check (
      result_subscription_revision is null
      or result_subscription_revision > 1
    ),
  event_kind text not null
    check (
      event_kind in (
        'start_applied',
        'upgrade_payment_settled',
        'upgrade_applied',
        'downgrade_scheduled',
        'downgrade_applied',
        'downgrade_cancelled',
        'renewal_paid',
        'payment_failed',
        'payment_recovered',
        'suspended',
        'cancellation_scheduled',
        'cancelled',
        'ended',
        'credit_source_reversed',
        'provider_synced'
      )
    ),
  prior_tier_id text,
  result_tier_id text,
  occurred_at timestamptz not null,
  facts jsonb not null
    check (
      jsonb_typeof(facts) = 'object'
      and pg_column_size(facts) <= 32768
    ),
  facts_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, subscription_id)
    references ss.alakazam_subscriptions(organization_id, id)
    on delete cascade,
  foreign key (organization_id, quote_id)
    references ss.alakazam_change_quotes(organization_id, id)
    on delete cascade,
  foreign key (organization_id, stripe_event_row_id)
    references ss.alakazam_stripe_events(organization_id, id)
    on delete cascade,
  foreign key (organization_id, payment_receipt_id)
    references ss.alakazam_payment_receipts(organization_id, id)
    on delete cascade,
  foreign key (organization_id, downgrade_schedule_id)
    references ss.alakazam_downgrade_schedules(
      organization_id,
      id
    ) on delete cascade,
  foreign key (
    organization_id,
    download_reversal_event_id
  ) references ss.commerce_v2_download_reversal_events(
    organization_id,
    id
  ),
  check (
    prior_tier_id is null
    or prior_tier_id in (
      'alakazam_25', 'alakazam_35', 'alakazam_50'
    )
  ),
  check (
    result_tier_id is null
    or result_tier_id in (
      'alakazam_25', 'alakazam_35', 'alakazam_50'
    )
  ),
  check (
    (
      event_kind in (
        'upgrade_payment_settled',
        'downgrade_scheduled',
        'downgrade_cancelled'
      )
      and result_subscription_revision is null
    )
    or event_kind = 'credit_source_reversed'
    or (
      event_kind not in (
        'upgrade_payment_settled',
        'downgrade_scheduled',
        'downgrade_cancelled',
        'credit_source_reversed'
      )
      and result_subscription_revision is not null
    )
  )
);

create unique index alakazam_one_event_per_revision
  on ss.alakazam_tier_change_events(
    subscription_id,
    result_subscription_revision
  )
  where result_subscription_revision is not null;

create function ss.validate_alakazam_tier_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  if not found
    or subscription_record.project_id <> new.project_id
    or (
      new.result_subscription_revision is not null
      and new.result_subscription_revision <>
          subscription_record.revision
    )
  then
    raise exception
      'Alakazam tier event subscription binding is stale'
      using errcode = '23514';
  end if;

  if new.quote_id is not null
    and not exists (
      select 1
      from ss.alakazam_change_quotes quote
      where quote.organization_id = new.organization_id
        and quote.project_id = new.project_id
        and quote.id = new.quote_id
    )
  then
    raise exception 'Alakazam tier event quote is invalid'
      using errcode = '23514';
  end if;
  if new.payment_receipt_id is not null
    and not exists (
      select 1
      from ss.alakazam_payment_receipts receipt
      where receipt.organization_id = new.organization_id
        and receipt.project_id = new.project_id
        and receipt.subscription_id = new.subscription_id
        and receipt.id = new.payment_receipt_id
    )
  then
    raise exception 'Alakazam tier event receipt is invalid'
      using errcode = '23514';
  end if;
  if new.stripe_event_row_id is not null
    and not exists (
      select 1
      from ss.alakazam_stripe_events event
      where event.organization_id = new.organization_id
        and event.project_id = new.project_id
        and event.id = new.stripe_event_row_id
        and event.subscription_id = new.subscription_id
        and event.state = 'processed'
    )
  then
    raise exception
      'Alakazam tier event requires processed Stripe evidence'
      using errcode = '23514';
  end if;

  if new.event_kind = 'start_applied' then
    if new.prior_tier_id is not null
      or new.result_tier_id <>
           subscription_record.tier_id
      or subscription_record.status <> 'active'
      or new.quote_id is null
      or new.payment_receipt_id is null
      or new.stripe_event_row_id is null
      or new.downgrade_schedule_id is not null
      or new.download_reversal_event_id is not null
      or not exists (
        select 1
        from ss.alakazam_change_quotes quote
        join ss.alakazam_payment_receipts receipt
          on receipt.organization_id = quote.organization_id
         and receipt.id = new.payment_receipt_id
        join ss.alakazam_stripe_events event
          on event.organization_id = quote.organization_id
         and event.id = new.stripe_event_row_id
        where quote.organization_id = new.organization_id
          and quote.id = new.quote_id
          and quote.change_kind = 'start'
          and quote.target_tier_id = new.result_tier_id
          and receipt.subscription_id = new.subscription_id
          and receipt.quote_id = quote.id
          and receipt.receipt_kind = 'start_payment'
          and receipt.stripe_event_row_id <> event.id
          and event.event_type in (
            'customer.subscription.created',
            'customer.subscription.updated'
          )
          and event.provider_object_id =
              subscription_record.stripe_subscription_id
      )
    then
      raise exception 'invalid Alakazam start event evidence'
        using errcode = '23514';
    end if;
  elsif new.event_kind in (
    'upgrade_payment_settled',
    'upgrade_applied'
  ) then
    if new.quote_id is null
      or new.payment_receipt_id is null
      or new.downgrade_schedule_id is not null
      or new.download_reversal_event_id is not null
      or not exists (
        select 1
        from ss.alakazam_change_quotes quote
        join ss.alakazam_payment_receipts receipt
          on receipt.organization_id = quote.organization_id
         and receipt.id = new.payment_receipt_id
        where quote.organization_id = new.organization_id
          and quote.id = new.quote_id
          and quote.change_kind = 'upgrade'
          and quote.current_subscription_id =
              new.subscription_id
          and quote.current_tier_id = new.prior_tier_id
          and quote.target_tier_id = new.result_tier_id
          and receipt.subscription_id = new.subscription_id
          and receipt.quote_id = quote.id
          and receipt.receipt_kind = 'upgrade_difference'
      )
      or (
        new.event_kind = 'upgrade_payment_settled'
        and (
          new.result_subscription_revision is not null
          or new.stripe_event_row_id is distinct from (
            select receipt.stripe_event_row_id
            from ss.alakazam_payment_receipts receipt
            where receipt.organization_id = new.organization_id
              and receipt.id = new.payment_receipt_id
          )
        )
      )
      or (
        new.event_kind = 'upgrade_applied'
        and (
          new.result_subscription_revision is null
          or new.stripe_event_row_id is null
          or new.result_tier_id <>
               subscription_record.tier_id
          or subscription_record.status <> 'active'
          or not exists (
            select 1
            from ss.alakazam_stripe_events event
            where event.organization_id = new.organization_id
              and event.id = new.stripe_event_row_id
              and event.event_type =
                  'customer.subscription.updated'
              and event.provider_object_id =
                  subscription_record.stripe_subscription_id
          )
        )
      )
    then
      raise exception 'invalid Alakazam upgrade event evidence'
        using errcode = '23514';
    end if;
  elsif new.event_kind in (
    'downgrade_scheduled',
    'downgrade_applied',
    'downgrade_cancelled'
  ) then
    if new.quote_id is null
      or new.payment_receipt_id is not null
      or new.downgrade_schedule_id is null
      or new.download_reversal_event_id is not null
      or not exists (
        select 1
        from ss.alakazam_change_quotes quote
        join ss.alakazam_downgrade_schedules schedule
          on schedule.organization_id = quote.organization_id
         and schedule.id = new.downgrade_schedule_id
        where quote.organization_id = new.organization_id
          and quote.id = new.quote_id
          and quote.change_kind = 'downgrade'
          and quote.current_subscription_id =
              new.subscription_id
          and quote.current_tier_id = new.prior_tier_id
          and quote.target_tier_id = new.result_tier_id
          and schedule.subscription_id = new.subscription_id
          and schedule.quote_id = quote.id
          and schedule.current_tier_id = new.prior_tier_id
          and schedule.target_tier_id = new.result_tier_id
          and (
            (new.event_kind = 'downgrade_scheduled'
             and schedule.state = 'scheduled')
            or (new.event_kind = 'downgrade_applied'
                and schedule.state = 'applied')
            or (new.event_kind = 'downgrade_cancelled'
                and schedule.state = 'cancelled')
          )
      )
      or (
        new.event_kind = 'downgrade_applied'
        and (
          new.result_subscription_revision is null
          or new.stripe_event_row_id is null
          or new.result_tier_id <>
               subscription_record.tier_id
          or subscription_record.status <> 'active'
          or not exists (
            select 1
            from ss.alakazam_stripe_events event
            where event.organization_id = new.organization_id
              and event.id = new.stripe_event_row_id
              and event.event_type =
                  'customer.subscription.updated'
              and event.provider_object_id =
                  subscription_record.stripe_subscription_id
          )
        )
      )
      or (
        new.event_kind <> 'downgrade_applied'
        and new.stripe_event_row_id is not null
      )
    then
      raise exception 'invalid Alakazam downgrade event evidence'
        using errcode = '23514';
    end if;
  elsif new.event_kind in (
    'renewal_paid',
    'payment_recovered'
  ) then
    if new.quote_id is not null
      or new.payment_receipt_id is null
      or new.stripe_event_row_id is null
      or new.downgrade_schedule_id is not null
      or new.download_reversal_event_id is not null
      or new.prior_tier_id is distinct from
           subscription_record.tier_id
      or new.result_tier_id is distinct from
           subscription_record.tier_id
      or subscription_record.status <> 'active'
      or not exists (
        select 1
        from ss.alakazam_payment_receipts receipt
        where receipt.organization_id = new.organization_id
          and receipt.id = new.payment_receipt_id
          and receipt.subscription_id = new.subscription_id
          and receipt.receipt_kind = 'renewal_payment'
          and receipt.stripe_event_row_id =
              new.stripe_event_row_id
      )
    then
      raise exception 'invalid Alakazam renewal event evidence'
        using errcode = '23514';
    end if;
  elsif new.event_kind = 'credit_source_reversed' then
    if new.quote_id is not null
      or new.stripe_event_row_id is not null
      or new.payment_receipt_id is not null
      or new.downgrade_schedule_id is not null
      or new.download_reversal_event_id is null
      or new.prior_tier_id is distinct from
           subscription_record.tier_id
      or new.result_tier_id is distinct from
           subscription_record.tier_id
      or subscription_record.status not in (
        'suspended', 'cancelled', 'ended'
      )
      or not exists (
        select 1
        from ss.commerce_v2_download_reversal_events reversal
        where reversal.organization_id = new.organization_id
          and reversal.project_id = new.project_id
          and reversal.id = new.download_reversal_event_id
          and reversal.resulting_state in (
            'suspended', 'revoked'
          )
      )
    then
      raise exception
        'invalid Alakazam Download reversal event evidence'
        using errcode = '23514';
    end if;
  else
    if new.quote_id is not null
      or new.payment_receipt_id is not null
      or new.downgrade_schedule_id is not null
      or new.download_reversal_event_id is not null
      or new.stripe_event_row_id is null
      or new.prior_tier_id is distinct from
           subscription_record.tier_id
      or new.result_tier_id is distinct from
           subscription_record.tier_id
      or (
        new.event_kind = 'payment_failed'
        and (
          subscription_record.status <> 'grace'
          or not exists (
            select 1
            from ss.alakazam_stripe_events event
            where event.organization_id = new.organization_id
              and event.id = new.stripe_event_row_id
              and event.event_type = 'invoice.payment_failed'
          )
        )
      )
      or (
        new.event_kind = 'suspended'
        and subscription_record.status <> 'suspended'
      )
      or (
        new.event_kind = 'cancellation_scheduled'
        and (
          not subscription_record.cancel_at_period_end
          or not exists (
            select 1
            from ss.alakazam_stripe_events event
            where event.organization_id = new.organization_id
              and event.id = new.stripe_event_row_id
              and event.event_type =
                  'customer.subscription.updated'
          )
        )
      )
      or (
        new.event_kind = 'cancelled'
        and subscription_record.status <> 'cancelled'
      )
      or (
        new.event_kind = 'ended'
        and subscription_record.status <> 'ended'
      )
      or (
        new.event_kind = 'provider_synced'
        and not exists (
          select 1
          from ss.alakazam_stripe_events event
          where event.organization_id = new.organization_id
            and event.id = new.stripe_event_row_id
            and event.event_type in (
              'customer.subscription.created',
              'customer.subscription.updated',
              'customer.subscription.deleted'
            )
        )
      )
    then
      raise exception 'invalid Alakazam status event evidence'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create constraint trigger alakazam_tier_events_validate
after insert on ss.alakazam_tier_change_events
deferrable initially deferred
for each row execute function ss.validate_alakazam_tier_event();

create function ss.guard_alakazam_subscription_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.customer_user_id is distinct from
       old.customer_user_id
    or new.stripe_customer_row_id is distinct from
       old.stripe_customer_row_id
    or new.stripe_subscription_id is distinct from
       old.stripe_subscription_id
    or new.stripe_subscription_item_id is distinct from
       old.stripe_subscription_item_id
    or new.initial_quote_id is distinct from
       old.initial_quote_id
    or new.currency is distinct from old.currency
    or new.created_at is distinct from old.created_at
  then
    raise exception
      'Alakazam subscription identity is immutable'
      using errcode = '55000';
  end if;
  if old.status = 'ended'
    or new.provider_observed_at <= old.provider_observed_at
    or (
      old.current_period_ends_at is not null
      and (
        new.current_period_starts_at is null
        or new.current_period_ends_at is null
        or (
          new.current_period_ends_at =
            old.current_period_ends_at
          and new.current_period_starts_at <>
              old.current_period_starts_at
        )
        or (
          new.current_period_ends_at <>
            old.current_period_ends_at
          and new.current_period_starts_at <
              old.current_period_ends_at
        )
      )
    )
    or not (
      (old.status = 'pending' and new.status in (
        'pending', 'active'
      ))
      or (old.status = 'active' and new.status in (
        'active', 'grace', 'suspended', 'cancelled', 'ended'
      ))
      or (old.status = 'grace' and new.status in (
        'grace', 'active', 'suspended', 'cancelled', 'ended'
      ))
      or (old.status = 'suspended' and new.status in (
        'suspended', 'active', 'cancelled', 'ended'
      ))
      or (old.status = 'cancelled' and new.status in (
        'cancelled', 'ended'
      ))
    )
    or (
      new.tier_id is distinct from old.tier_id
      and (
        old.status <> 'active'
        or new.status <> 'active'
        or old.cancel_at_period_end
        or new.cancel_at_period_end
      )
    )
    or (
      old.status = 'pending'
      and new.status = 'active'
      and (
        new.tier_id <> old.tier_id
        or new.stripe_price_id <> old.stripe_price_id
        or new.activation_receipt_id is null
      )
    )
  then
    raise exception
      'invalid Alakazam subscription transition'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_subscriptions_guard
before update on ss.alakazam_subscriptions
for each row execute function
  ss.guard_alakazam_subscription_update();

create function ss.bump_alakazam_subscription_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.revision <> old.revision then
    raise exception
      'Alakazam subscription revision is managed by the database'
      using errcode = '55000';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_subscriptions_revision
before update on ss.alakazam_subscriptions
for each row execute function
  ss.bump_alakazam_subscription_revision();

create function ss.validate_alakazam_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  subscription_record record;
begin
  if new.created_by_user_id <> new.customer_user_id
    or not exists (
      select 1
      from ss.organization_memberships membership
      join ss.projects project
        on project.organization_id = membership.organization_id
       and project.id = new.project_id
      where membership.organization_id = new.organization_id
        and membership.user_id = new.customer_user_id
        and membership.state = 'active'
        and membership.role in ('owner', 'admin', 'editor')
        and project.lifecycle = 'active'
    )
  then
    raise exception
      'Alakazam quote requires one active project customer'
      using errcode = '23514';
  end if;

  if new.current_subscription_id is not null then
    select
      subscription.project_id,
      subscription.customer_user_id,
      subscription.tier_id,
      subscription.amount_minor,
      subscription.revision,
      subscription.status,
      subscription.current_period_ends_at,
      subscription.cancel_at_period_end
    into subscription_record
    from ss.alakazam_subscriptions subscription
    where subscription.organization_id = new.organization_id
      and subscription.id = new.current_subscription_id;

    if not found
      or subscription_record.project_id <> new.project_id
      or subscription_record.customer_user_id <>
           new.customer_user_id
      or subscription_record.tier_id <> new.current_tier_id
      or subscription_record.amount_minor <>
           new.current_amount_minor
      or subscription_record.revision <>
           new.current_subscription_revision
      or subscription_record.status <> 'active'
      or subscription_record.current_period_ends_at <>
           new.current_period_ends_at
      or subscription_record.current_period_ends_at <=
           new.issued_at
      or subscription_record.cancel_at_period_end
      or exists (
        select 1
        from ss.alakazam_downgrade_schedules schedule
        where schedule.subscription_id =
                new.current_subscription_id
          and schedule.state in (
            'dispatching',
            'scheduled',
            'reconciliation_required'
          )
      )
    then
      raise exception
        'Alakazam quote subscription binding is stale'
        using errcode = '23514';
    end if;
  end if;

  if new.change_kind = 'start'
    and exists (
      select 1
      from ss.alakazam_subscriptions subscription
      where subscription.organization_id = new.organization_id
        and subscription.project_id = new.project_id
        and subscription.status <> 'ended'
    )
  then
    raise exception
      'project already has a current Alakazam subscription'
      using errcode = '23514';
  end if;

  if new.download_entitlement_id is not null
    and not exists (
      select 1
      from ss.commerce_v2_project_entitlements entitlement
      where entitlement.organization_id = new.organization_id
        and entitlement.project_id = new.project_id
        and entitlement.customer_user_id = new.customer_user_id
        and entitlement.id = new.download_entitlement_id
        and entitlement.kind = 'spark_download'
        and entitlement.scope = 'editor_project'
        and entitlement.state = 'active'
        and not exists (
          select 1
          from ss.alakazam_credit_applications application
          where application.download_entitlement_id = entitlement.id
        )
    )
  then
    raise exception
      'Alakazam Download credit is unavailable'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_quotes_validate
after insert on ss.alakazam_change_quotes
deferrable initially immediate
for each row execute function ss.validate_alakazam_quote();

create function ss.guard_alakazam_quote_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array['state', 'updated_at']::text[]
  ) is distinct from (
    to_jsonb(old) - array['state', 'updated_at']::text[]
  ) then
    raise exception
      'Alakazam quote commercial facts are immutable'
      using errcode = '55000';
  end if;
  if new.state = old.state then
    return new;
  end if;
  if not (
    (old.state = 'quoted' and new.state in (
      'checkout_dispatching',
      'schedule_dispatching',
      'expired',
      'failed'
    ))
    or (old.state = 'checkout_dispatching' and new.state in (
      'checkout_ready',
      'reconciliation_required',
      'failed'
    ))
    or (old.state = 'checkout_ready' and new.state in (
      'payment_settled',
      'expired',
      'reconciliation_required'
    ))
    or (old.state = 'payment_settled' and new.state in (
      'provider_change_pending',
      'applied',
      'reconciliation_required'
    ))
    or (old.state = 'provider_change_pending' and new.state in (
      'applied',
      'reconciliation_required'
    ))
    or (old.state = 'schedule_dispatching' and new.state in (
      'scheduled',
      'reconciliation_required',
      'failed'
    ))
    or (old.state = 'scheduled' and new.state in (
      'applied',
      'reconciliation_required',
      'failed'
    ))
    or (old.state = 'reconciliation_required' and new.state in (
      'checkout_ready',
      'payment_settled',
      'provider_change_pending',
      'applied',
      'scheduled',
      'failed'
    ))
  ) then
    raise exception 'invalid Alakazam quote transition'
      using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_quotes_guard_update
before update on ss.alakazam_change_quotes
for each row execute function ss.guard_alakazam_quote_update();

create function ss.validate_alakazam_dispatch()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
begin
  select quote.* into quote_record
  from ss.alakazam_change_quotes quote
  where quote.organization_id = new.organization_id
    and quote.id = new.quote_id;
  if not found
    or quote_record.project_id <> new.project_id
    or quote_record.customer_user_id <> new.customer_user_id
    or quote_record.state <>
         'checkout_dispatching'
    or not quote_record.provider_effects_authorized
    or new.expected_subtotal_minor <>
         quote_record.due_now_subtotal_minor
    or (
      quote_record.applied_value_kind =
        'download_purchase'
      and new.expected_credit_minor <>
        quote_record.applied_value_minor
    )
    or (
      quote_record.applied_value_kind <>
        'download_purchase'
      and new.expected_credit_minor <> 0
    )
    or (
      quote_record.change_kind = 'start'
      and new.mode <> 'subscription_start'
    )
    or (
      quote_record.change_kind = 'upgrade'
      and new.mode <> 'upgrade_difference'
    )
    or quote_record.change_kind = 'downgrade'
  then
    raise exception
      'Alakazam Checkout dispatch does not match its quote'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_dispatches_validate
before insert on ss.alakazam_checkout_dispatches
for each row execute function ss.validate_alakazam_dispatch();

create function ss.guard_alakazam_dispatch_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'stripe_checkout_session_id',
      'provider_checkout_url',
      'provider_expires_at',
      'dispatched_at',
      'settled_at',
      'provider_effect_certainty',
      'provider_error_code',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'stripe_checkout_session_id',
      'provider_checkout_url',
      'provider_expires_at',
      'dispatched_at',
      'settled_at',
      'provider_effect_certainty',
      'provider_error_code',
      'updated_at'
    ]::text[]
  ) then
    raise exception
      'Alakazam Checkout purpose is immutable'
      using errcode = '55000';
  end if;
  if new.state <> old.state and not (
    (old.state = 'reserved' and new.state in (
      'ready', 'failed', 'persistence_unknown'
    ))
    or (old.state = 'ready' and new.state in (
      'settled', 'expired', 'persistence_unknown'
    ))
    or (old.state = 'persistence_unknown' and new.state in (
      'ready', 'settled', 'expired', 'failed'
    ))
  ) then
    raise exception 'invalid Alakazam Checkout transition'
      using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_dispatches_guard_update
before update on ss.alakazam_checkout_dispatches
for each row execute function
  ss.guard_alakazam_dispatch_update();

create function ss.validate_alakazam_stripe_event_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'received'
    or new.attempt_count <> 0
    or new.processed_at is not null
    or new.failure_code is not null
    or (
      new.quote_id is not null
      and not exists (
        select 1
        from ss.alakazam_change_quotes quote
        where quote.organization_id = new.organization_id
          and quote.project_id = new.project_id
          and quote.id = new.quote_id
      )
    )
    or (
      new.subscription_id is not null
      and not exists (
        select 1
        from ss.alakazam_subscriptions subscription
        where subscription.organization_id =
                new.organization_id
          and subscription.project_id = new.project_id
          and subscription.id = new.subscription_id
      )
    )
  then
    raise exception
      'invalid initial Alakazam Stripe event'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_stripe_events_validate_insert
before insert on ss.alakazam_stripe_events
for each row execute function
  ss.validate_alakazam_stripe_event_insert();

create function ss.guard_alakazam_stripe_event_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'attempt_count',
      'processed_at',
      'failure_code',
      'updated_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'attempt_count',
      'processed_at',
      'failure_code',
      'updated_at'
    ]::text[]
  )
    or new.attempt_count < old.attempt_count
    or (
      new.state <> old.state
      and not (
        (old.state = 'received' and new.state in (
          'processing', 'processed', 'ignored', 'failed'
        ))
        or (old.state = 'processing' and new.state in (
          'processed', 'ignored', 'failed'
        ))
        or (old.state = 'failed' and new.state = 'processing')
      )
    )
    or (
      new.state = 'processing'
      and old.state <> 'processing'
      and new.attempt_count <> old.attempt_count + 1
    )
  then
    raise exception
      'invalid Alakazam Stripe event transition'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger alakazam_stripe_events_guard_update
before update on ss.alakazam_stripe_events
for each row execute function
  ss.guard_alakazam_stripe_event_update();

create function ss.validate_alakazam_payment_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  subscription_record record;
begin
  select * into subscription_record
  from ss.alakazam_subscriptions subscription
  where subscription.organization_id = new.organization_id
    and subscription.id = new.subscription_id;
  if not found
    or subscription_record.project_id <> new.project_id
    or subscription_record.customer_user_id <>
         new.customer_user_id
  then
    raise exception
      'Alakazam payment receipt subscription is invalid'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.alakazam_stripe_events event
    where event.organization_id = new.organization_id
      and event.project_id = new.project_id
      and event.id = new.stripe_event_row_id
      and event.subscription_id = new.subscription_id
      and event.event_type in (
        'checkout.session.completed',
        'invoice.paid',
        'invoice.payment_succeeded'
      )
      and event.state = 'processed'
  ) then
    raise exception
      'Alakazam receipt requires one pending verified payment event'
      using errcode = '23514';
  end if;

  if new.quote_id is not null then
    select * into quote_record
    from ss.alakazam_change_quotes quote
    where quote.organization_id = new.organization_id
      and quote.id = new.quote_id;
    if not found
      or quote_record.project_id <> new.project_id
      or quote_record.customer_user_id <>
           new.customer_user_id
      or quote_record.state not in (
        'payment_settled',
        'provider_change_pending',
        'applied'
      )
      or not exists (
        select 1
        from ss.alakazam_checkout_dispatches dispatch
        where dispatch.organization_id = new.organization_id
          and dispatch.project_id = new.project_id
          and dispatch.customer_user_id = new.customer_user_id
          and dispatch.quote_id = new.quote_id
          and dispatch.state = 'settled'
          and dispatch.expected_subtotal_minor =
              new.net_subtotal_minor
          and dispatch.expected_credit_minor =
              new.provider_discount_minor
          and dispatch.currency = new.currency
      )
      or (
        new.receipt_kind = 'start_payment'
        and (
          quote_record.change_kind <> 'start'
          or quote_record.target_tier_id <>
               subscription_record.tier_id
          or new.list_subtotal_minor <>
               quote_record.target_amount_minor
          or new.provider_discount_minor <>
               quote_record.applied_value_minor
          or new.net_subtotal_minor <>
               quote_record.due_now_subtotal_minor
        )
      )
      or (
        new.receipt_kind = 'upgrade_difference'
        and (
          quote_record.change_kind <> 'upgrade'
          or quote_record.current_subscription_id <>
               new.subscription_id
          or new.list_subtotal_minor <>
               quote_record.due_now_subtotal_minor
          or new.net_subtotal_minor <>
               quote_record.due_now_subtotal_minor
        )
      )
    then
      raise exception
        'Alakazam payment receipt does not match its quote'
        using errcode = '23514';
    end if;
  elsif new.list_subtotal_minor <>
          subscription_record.amount_minor
    or new.net_subtotal_minor <>
         subscription_record.amount_minor
  then
    raise exception
      'Alakazam renewal receipt does not match its tier'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_payment_receipts_validate
after insert on ss.alakazam_payment_receipts
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_payment_receipt();

create function ss.validate_alakazam_credit_application()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.alakazam_change_quotes quote
    join ss.alakazam_payment_receipts receipt
      on receipt.organization_id = quote.organization_id
     and receipt.id = new.payment_receipt_id
    join ss.commerce_v2_project_entitlements entitlement
      on entitlement.organization_id = quote.organization_id
     and entitlement.id = new.download_entitlement_id
    where quote.organization_id = new.organization_id
      and quote.project_id = new.project_id
      and quote.id = new.quote_id
      and quote.change_kind = 'start'
      and quote.download_entitlement_id = entitlement.id
      and quote.applied_value_minor = 500
      and receipt.project_id = new.project_id
      and receipt.subscription_id = new.subscription_id
      and receipt.quote_id = new.quote_id
      and receipt.receipt_kind = 'start_payment'
      and receipt.provider_discount_minor = 500
      and entitlement.project_id = new.project_id
      and entitlement.kind = 'spark_download'
      and entitlement.scope = 'editor_project'
      and entitlement.state = 'active'
  ) then
    raise exception
      'Alakazam credit application requires exact paid Download evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger alakazam_credit_applications_validate
before insert on ss.alakazam_credit_applications
for each row execute function
  ss.validate_alakazam_credit_application();

create function ss.guard_alakazam_credit_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if (
    to_jsonb(new) - array[
      'state',
      'source_reversal_event_id',
      'source_reversed_at'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'state',
      'source_reversal_event_id',
      'source_reversed_at'
    ]::text[]
  )
    or old.state <> 'applied'
    or new.state <> 'source_reversed'
  then
    raise exception
      'invalid Alakazam Download credit transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger alakazam_credit_applications_guard_update
before update on ss.alakazam_credit_applications
for each row execute function ss.guard_alakazam_credit_update();

create function ss.validate_alakazam_credit_reversal()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.commerce_v2_download_reversal_events reversal
    join ss.commerce_v2_project_entitlements entitlement
      on entitlement.organization_id = reversal.organization_id
     and entitlement.id = reversal.entitlement_id
    join ss.alakazam_subscriptions subscription
      on subscription.organization_id = reversal.organization_id
     and subscription.id = new.subscription_id
    join ss.alakazam_tier_change_events event
      on event.organization_id = reversal.organization_id
     and event.subscription_id = subscription.id
     and event.download_reversal_event_id = reversal.id
    where reversal.organization_id = new.organization_id
      and reversal.project_id = new.project_id
      and reversal.id = new.source_reversal_event_id
      and reversal.entitlement_id =
          new.download_entitlement_id
      and reversal.resulting_state in ('suspended', 'revoked')
      and entitlement.project_id = new.project_id
      and entitlement.state = reversal.resulting_state
      and subscription.project_id = new.project_id
      and subscription.status in (
        'suspended', 'cancelled', 'ended'
      )
      and event.project_id = new.project_id
      and event.event_kind = 'credit_source_reversed'
      and event.occurred_at = new.source_reversed_at
      and (
        event.result_subscription_revision is null
        or event.result_subscription_revision =
            subscription.revision
      )
      and new.source_reversed_at = reversal.completed_at
  ) then
    raise exception
      'Alakazam credit reversal lacks exact defensive evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger alakazam_credit_reversals_validate
after update on ss.alakazam_credit_applications
deferrable initially deferred
for each row execute function ss.validate_alakazam_credit_reversal();

create function ss.validate_alakazam_subscription()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_event_kinds text[];
begin
  if exists (
    select 1
    from ss.stripe_subscriptions legacy
    where legacy.organization_id = new.organization_id
      and legacy.project_id = new.project_id
      and legacy.status <> 'deleted'
  ) then
    raise exception
      'project already has a legacy subscription'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
    from ss.alakazam_change_quotes quote
    where quote.organization_id = new.organization_id
      and quote.project_id = new.project_id
      and quote.customer_user_id = new.customer_user_id
      and quote.id = new.initial_quote_id
      and quote.change_kind = 'start'
      and (
        tg_op <> 'INSERT'
        or quote.target_tier_id = new.tier_id
      )
  ) then
    raise exception
      'Alakazam subscription requires its exact start quote'
      using errcode = '23514';
  end if;
  if new.activation_receipt_id is not null
    and not exists (
      select 1
      from ss.alakazam_payment_receipts receipt
      where receipt.organization_id = new.organization_id
        and receipt.project_id = new.project_id
        and receipt.subscription_id = new.id
        and receipt.id = new.activation_receipt_id
        and receipt.receipt_kind = 'start_payment'
    )
  then
    raise exception
      'Alakazam activation requires its exact payment receipt'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'active' then
      expected_event_kinds := array['start_applied'];
    elsif ss.alakazam_tier_rank(new.tier_id) >
          ss.alakazam_tier_rank(old.tier_id) then
      if new.current_period_starts_at <>
           old.current_period_starts_at
        or new.current_period_ends_at <>
           old.current_period_ends_at
        or new.stripe_price_id = old.stripe_price_id
      then
        raise exception
          'Alakazam upgrade must preserve the paid billing boundary'
          using errcode = '23514';
      end if;
      expected_event_kinds := array['upgrade_applied'];
    elsif ss.alakazam_tier_rank(new.tier_id) <
          ss.alakazam_tier_rank(old.tier_id) then
      if new.current_period_starts_at <
           old.current_period_ends_at
        or new.stripe_price_id = old.stripe_price_id
      then
        raise exception
          'Alakazam downgrade must begin at the renewal boundary'
          using errcode = '23514';
      end if;
      expected_event_kinds := array['downgrade_applied'];
    elsif old.status <> 'grace' and new.status = 'grace' then
      expected_event_kinds := array['payment_failed'];
    elsif old.status <> 'suspended'
      and new.status = 'suspended'
    then
      expected_event_kinds := array[
        'suspended',
        'credit_source_reversed'
      ];
    elsif old.status in ('grace', 'suspended')
      and new.status = 'active'
    then
      expected_event_kinds := array['payment_recovered'];
    elsif old.status <> 'cancelled'
      and new.status = 'cancelled'
    then
      expected_event_kinds := array['cancelled'];
    elsif old.status <> 'ended' and new.status = 'ended' then
      expected_event_kinds := array['ended'];
    elsif not old.cancel_at_period_end
      and new.cancel_at_period_end
    then
      expected_event_kinds := array['cancellation_scheduled'];
    elsif old.current_period_ends_at is not null
      and new.current_period_ends_at >
          old.current_period_ends_at
    then
      expected_event_kinds := array['renewal_paid'];
    else
      expected_event_kinds := array['provider_synced'];
    end if;

    if not exists (
      select 1
      from ss.alakazam_tier_change_events event
      where event.organization_id = new.organization_id
        and event.project_id = new.project_id
        and event.subscription_id = new.id
        and event.result_subscription_revision = new.revision
        and event.event_kind = any(expected_event_kinds)
        and event.result_tier_id = new.tier_id
        and (
          (event.event_kind = 'start_applied'
           and event.prior_tier_id is null)
          or (
            event.event_kind <> 'start_applied'
            and event.prior_tier_id = old.tier_id
          )
        )
        and event.occurred_at <= new.provider_observed_at
    )
    then
      raise exception
        'Alakazam subscription change lacks exact revision evidence'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create constraint trigger alakazam_subscriptions_validate
after insert or update on ss.alakazam_subscriptions
deferrable initially deferred
for each row execute function
  ss.validate_alakazam_subscription();

create function ss.prevent_legacy_alakazam_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.status <> 'deleted'
    and exists (
      select 1
      from ss.alakazam_subscriptions subscription
      where subscription.organization_id = new.organization_id
        and subscription.project_id = new.project_id
    )
  then
    raise exception
      'project already has an Alakazam subscription'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger stripe_subscriptions_no_alakazam_overlap
after insert or update of project_id, status
on ss.stripe_subscriptions
deferrable initially deferred
for each row execute function
  ss.prevent_legacy_alakazam_overlap();

create function ss.reject_alakazam_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and nullif(
      current_setting(
        'app.terminal_purge_project_id',
        true
      ),
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
  raise exception 'Alakazam billing evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger alakazam_events_immutable
before delete on ss.alakazam_stripe_events
for each row execute function
  ss.reject_alakazam_evidence_mutation();

create trigger alakazam_receipts_immutable
before update or delete on ss.alakazam_payment_receipts
for each row execute function
  ss.reject_alakazam_evidence_mutation();

create trigger alakazam_credit_applications_immutable
before delete on ss.alakazam_credit_applications
for each row execute function
  ss.reject_alakazam_evidence_mutation();

create trigger alakazam_tier_events_immutable
before update or delete on ss.alakazam_tier_change_events
for each row execute function
  ss.reject_alakazam_evidence_mutation();

create function ss.activate_alakazam_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    perform set_config(
      'app.terminal_purge_project_id',
      new.project_id::text,
      true
    );
    new.removal_counts :=
      coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'alakazamSubscriptions', (
          select count(*)
          from ss.alakazam_subscriptions
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamChangeQuotes', (
          select count(*)
          from ss.alakazam_change_quotes
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamCheckoutDispatches', (
          select count(*)
          from ss.alakazam_checkout_dispatches
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamStripeEvents', (
          select count(*)
          from ss.alakazam_stripe_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamPaymentReceipts', (
          select count(*)
          from ss.alakazam_payment_receipts
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamCreditApplications', (
          select count(*)
          from ss.alakazam_credit_applications
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamDowngradeSchedules', (
          select count(*)
          from ss.alakazam_downgrade_schedules
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'alakazamTierChangeEvents', (
          select count(*)
          from ss.alakazam_tier_change_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_activate_alakazam_purge
before insert or update of state on ss.deletion_requests
for each row execute function ss.activate_alakazam_purge();

create function ss.purge_alakazam_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    if nullif(
      current_setting(
        'app.terminal_purge_project_id',
        true
      ),
      ''
    )::uuid is distinct from new.project_id
    then
      raise exception
        'Alakazam purge requires the sealed deletion boundary'
        using errcode = '42501';
    end if;
    delete from ss.alakazam_subscriptions
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.alakazam_change_quotes
    where organization_id = new.organization_id
      and project_id = new.project_id;
  end if;
  return new;
end
$$;

create trigger deletion_requests_purge_alakazam
after insert or update of state on ss.deletion_requests
for each row execute function
  ss.purge_alakazam_on_project_seal();

do $$
declare
  table_name text;
  tables text[] := array[
    'alakazam_subscriptions',
    'alakazam_change_quotes',
    'alakazam_checkout_dispatches',
    'alakazam_stripe_events',
    'alakazam_payment_receipts',
    'alakazam_credit_applications',
    'alakazam_downgrade_schedules',
    'alakazam_tier_change_events'
  ];
begin
  foreach table_name in array tables loop
    execute format(
      'alter table ss.%I enable row level security',
      table_name
    );
    execute format(
      'alter table ss.%I force row level security',
      table_name
    );
    execute format(
      'revoke all on ss.%I from public, anon, authenticated',
      table_name
    );
    execute format(
      'grant all privileges on ss.%I to service_role',
      table_name
    );
  end loop;
end
$$;

revoke all on function
  ss.alakazam_tier_amount_minor(text),
  ss.alakazam_tier_rank(text),
  ss.validate_alakazam_downgrade_schedule(),
  ss.guard_alakazam_downgrade_update(),
  ss.validate_alakazam_tier_event(),
  ss.guard_alakazam_subscription_update(),
  ss.bump_alakazam_subscription_revision(),
  ss.validate_alakazam_quote(),
  ss.guard_alakazam_quote_update(),
  ss.validate_alakazam_dispatch(),
  ss.guard_alakazam_dispatch_update(),
  ss.validate_alakazam_stripe_event_insert(),
  ss.guard_alakazam_stripe_event_update(),
  ss.validate_alakazam_payment_receipt(),
  ss.validate_alakazam_credit_application(),
  ss.guard_alakazam_credit_update(),
  ss.validate_alakazam_credit_reversal(),
  ss.validate_alakazam_subscription(),
  ss.prevent_legacy_alakazam_overlap(),
  ss.reject_alakazam_evidence_mutation(),
  ss.activate_alakazam_purge(),
  ss.purge_alakazam_on_project_seal()
from public, anon, authenticated;

grant execute on function
  ss.alakazam_tier_amount_minor(text),
  ss.alakazam_tier_rank(text),
  ss.validate_alakazam_downgrade_schedule(),
  ss.guard_alakazam_downgrade_update(),
  ss.validate_alakazam_tier_event(),
  ss.guard_alakazam_subscription_update(),
  ss.bump_alakazam_subscription_revision(),
  ss.validate_alakazam_quote(),
  ss.guard_alakazam_quote_update(),
  ss.validate_alakazam_dispatch(),
  ss.guard_alakazam_dispatch_update(),
  ss.validate_alakazam_stripe_event_insert(),
  ss.guard_alakazam_stripe_event_update(),
  ss.validate_alakazam_payment_receipt(),
  ss.validate_alakazam_credit_application(),
  ss.guard_alakazam_credit_update(),
  ss.validate_alakazam_credit_reversal(),
  ss.validate_alakazam_subscription(),
  ss.prevent_legacy_alakazam_overlap(),
  ss.reject_alakazam_evidence_mutation(),
  ss.activate_alakazam_purge(),
  ss.purge_alakazam_on_project_seal()
to service_role;

create function ss.hosted_runtime_contract_v23()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v23-alakazam-subscription-contract'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v23()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v23()
to authenticated, service_role;

commit;
