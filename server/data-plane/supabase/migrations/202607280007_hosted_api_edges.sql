begin;

-- This migration is deliberately additive to the canonical Site Sourcery data
-- plane. Migrations 202607280001 through 202607280006 own organizations,
-- projects, content, addresses, subscriptions, releases, support, exports,
-- idempotency, audit, outbox, and domains. Do not create shadow copies here.
do $$
begin
  if to_regclass('ss.organizations') is null
    or to_regclass('ss.projects') is null
    or to_regclass('ss.checkout_intents') is null
    or to_regclass('ss.stripe_subscriptions') is null
    or to_regclass('ss.export_requests') is null
    or to_regclass('ss.domain_registrations') is null
  then
    raise exception
      'Site Sourcery canonical migrations 202607280001 through 202607280006 must be applied first'
      using errcode = '55000';
  end if;
end
$$;

-- The API does not own auth.users. Supabase Auth, or the reviewed self-hosted
-- identity bridge, creates that row first. These tables add only the profile,
-- credential verifier, and opaque session material needed by the same-origin
-- Node API. They must never be exposed directly to browser roles.
create table ss.hosted_account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  state text not null default 'active'
    check (state in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger hosted_account_profiles_updated_at
before update on ss.hosted_account_profiles
for each row execute function ss.set_updated_at();

create table ss.hosted_password_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_phc text not null
    check (password_phc like 'scrypt$32768$8$1$%'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger hosted_password_credentials_updated_at
before update on ss.hosted_password_credentials
for each row execute function ss.set_updated_at();

create table ss.hosted_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_digest ss.sha256_hex not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create index hosted_sessions_current_user
  on ss.hosted_sessions(user_id, expires_at)
  where revoked_at is null;

create table ss.hosted_recovery_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_digest ss.sha256_hex not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at),
  check (used_at is null or used_at >= created_at)
);

create index hosted_recovery_tokens_current_user
  on ss.hosted_recovery_tokens(user_id, expires_at)
  where used_at is null;

-- catalog_plans/catalog_prices remain the pricing authority. This table adds
-- the reviewed Abracadabra offer policy that those generic catalog rows lack.
create table ss.catalog_offer_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  offer_key text not null,
  catalog_version text not null,
  plan_id uuid not null references ss.catalog_plans(id),
  price_id uuid not null references ss.catalog_prices(id),
  product_id text not null check (product_id = 'spark'),
  tenure_id text not null
    check (tenure_id in ('rent', 'own', 'owned_managed')),
  terms_version text not null check (char_length(terms_version) between 3 and 120),
  eligible_address_modes text[] not null,
  disclosure_snapshot jsonb not null
    check (jsonb_typeof(disclosure_snapshot) = 'object'),
  active_from timestamptz not null,
  active_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (offer_key, catalog_version),
  check (
    (
      tenure_id = 'own'
      and eligible_address_modes = array['customer_owned']::text[]
    )
    or (
      tenure_id in ('rent', 'owned_managed')
      and eligible_address_modes =
        array['licensed', 'customer_owned']::text[]
    )
  ),
  check (active_until is null or active_until >= active_from)
);

-- Revisions bind a quote to the exact address and subscription facts that were
-- shown. Application writes never assign these counters directly.
alter table ss.project_addresses
  add column revision bigint not null default 1 check (revision > 0);

create function ss.bump_project_address_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.revision <> old.revision then
    raise exception 'project address revision is managed by the database'
      using errcode = '55000';
  end if;
  new.revision := old.revision + 1;
  return new;
end
$$;

create trigger project_addresses_revision
before update on ss.project_addresses
for each row execute function ss.bump_project_address_revision();

alter table ss.stripe_subscriptions
  add column revision bigint not null default 1 check (revision > 0);

create function ss.bump_stripe_subscription_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.revision <> old.revision then
    raise exception 'subscription revision is managed by the database'
      using errcode = '55000';
  end if;
  new.revision := old.revision + 1;
  return new;
end
$$;

create trigger stripe_subscriptions_revision
before update on ss.stripe_subscriptions
for each row execute function ss.bump_stripe_subscription_revision();

-- A quote is a server-authored, exact commercial snapshot. It does not replace
-- checkout_intents; the immutable binding below joins the accepted quote to
-- the provider-facing checkout row.
create table ss.commerce_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  offer_policy_id uuid not null,
  offer_key text not null,
  catalog_version text not null,
  terms_version text not null,
  product_id text not null check (product_id = 'spark'),
  tenure_id text not null
    check (tenure_id in ('rent', 'own', 'owned_managed')),
  eligible_address_modes text[] not null,
  address_id uuid not null,
  address_mode text not null
    check (address_mode in ('licensed', 'customer_owned')),
  address_revision bigint not null check (address_revision > 0),
  subscription_id uuid,
  subscription_revision bigint check (
    subscription_revision is null or subscription_revision > 0
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array'),
  totals jsonb not null check (jsonb_typeof(totals) = 'object'),
  disclosure_digest ss.sha256_hex not null,
  state text not null default 'quoted'
    check (
      state in (
        'quoted',
        'checkout_dispatching',
        'checkout_created',
        'void',
        'expired'
      )
    ),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  voided_at timestamptz,
  void_reason text,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, address_id)
    references ss.project_addresses(organization_id, id),
  foreign key (organization_id, subscription_id)
    references ss.stripe_subscriptions(organization_id, id),
  foreign key (offer_policy_id)
    references ss.catalog_offer_policies(id),
  unique (organization_id, id),
  check (expires_at > issued_at),
  check (address_mode = any(eligible_address_modes)),
  check (
    eligible_address_modes <@ array['licensed', 'customer_owned']::text[]
  ),
  check (tenure_id <> 'own' or address_mode = 'customer_owned'),
  check (
    (subscription_id is null and subscription_revision is null)
    or (subscription_id is not null and subscription_revision is not null)
  ),
  check (
    (state = 'void' and voided_at is not null and void_reason is not null)
    or (state <> 'void' and voided_at is null and void_reason is null)
  )
);

create index commerce_quotes_project_time
  on ss.commerce_quotes(organization_id, project_id, issued_at desc);

create function ss.validate_commerce_quote_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  offer_record record;
  address_record record;
  subscription_record record;
begin
  select
    offer.offer_key,
    offer.catalog_version,
    offer.product_id,
    offer.tenure_id,
    offer.terms_version,
    offer.eligible_address_modes
  into offer_record
  from ss.catalog_offer_policies offer
  where offer.id = new.offer_policy_id
    and offer.active_from <= new.issued_at
    and (offer.active_until is null or offer.active_until > new.issued_at);

  if not found
    or offer_record.offer_key <> new.offer_key
    or offer_record.catalog_version <> new.catalog_version
    or offer_record.product_id <> new.product_id
    or offer_record.tenure_id <> new.tenure_id
    or offer_record.terms_version <> new.terms_version
    or offer_record.eligible_address_modes <> new.eligible_address_modes
  then
    raise exception 'commerce quote offer binding is stale or inconsistent'
      using errcode = '23514';
  end if;

  select
    address.project_id,
    address.revision,
    case when address.kind = 'licensed' then 'licensed' else 'customer_owned' end
      as address_mode
  into address_record
  from ss.project_addresses address
  where address.organization_id = new.organization_id
    and address.id = new.address_id;

  if not found
    or address_record.project_id <> new.project_id
    or address_record.revision <> new.address_revision
    or address_record.address_mode <> new.address_mode
  then
    raise exception 'commerce quote address binding is stale or inconsistent'
      using errcode = '23514';
  end if;

  if new.subscription_id is not null then
    select subscription.project_id, subscription.revision
    into subscription_record
    from ss.stripe_subscriptions subscription
    where subscription.organization_id = new.organization_id
      and subscription.id = new.subscription_id;

    if not found
      or subscription_record.project_id <> new.project_id
      or subscription_record.revision <> new.subscription_revision
    then
      raise exception 'commerce quote subscription binding is stale or inconsistent'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$$;

create constraint trigger commerce_quotes_exact_binding
after insert on ss.commerce_quotes
deferrable initially immediate
for each row execute function ss.validate_commerce_quote_binding();

create function ss.guard_commerce_quote_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.organization_id,
    new.project_id,
    new.offer_policy_id,
    new.offer_key,
    new.catalog_version,
    new.terms_version,
    new.product_id,
    new.tenure_id,
    new.eligible_address_modes,
    new.address_id,
    new.address_mode,
    new.address_revision,
    new.subscription_id,
    new.subscription_revision,
    new.currency,
    new.line_items,
    new.totals,
    new.disclosure_digest,
    new.issued_at,
    new.expires_at,
    new.created_by_user_id,
    new.created_at
  ) is distinct from row(
    old.organization_id,
    old.project_id,
    old.offer_policy_id,
    old.offer_key,
    old.catalog_version,
    old.terms_version,
    old.product_id,
    old.tenure_id,
    old.eligible_address_modes,
    old.address_id,
    old.address_mode,
    old.address_revision,
    old.subscription_id,
    old.subscription_revision,
    old.currency,
    old.line_items,
    old.totals,
    old.disclosure_digest,
    old.issued_at,
    old.expires_at,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'commerce quote commercial facts are immutable'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger commerce_quotes_guard_update
before update on ss.commerce_quotes
for each row execute function ss.guard_commerce_quote_update();

create table ss.checkout_quote_bindings (
  organization_id uuid not null,
  project_id uuid not null,
  checkout_intent_id uuid primary key,
  quote_id uuid not null unique,
  accepted_disclosure_digest ss.sha256_hex not null,
  accepted_by_user_id uuid not null references auth.users(id),
  accepted_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, checkout_intent_id)
    references ss.checkout_intents(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.commerce_quotes(organization_id, id),
  unique (organization_id, checkout_intent_id)
);

create trigger checkout_quote_bindings_no_update
before update or delete on ss.checkout_quote_bindings
for each row execute function ss.reject_update();

create function ss.validate_checkout_quote_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  checkout_record record;
begin
  select
    quote.project_id,
    quote.disclosure_digest,
    quote.state,
    quote.expires_at,
    quote.address_id,
    quote.address_revision,
    quote.address_mode
  into quote_record
  from ss.commerce_quotes quote
  where quote.organization_id = new.organization_id
    and quote.id = new.quote_id
  for update;

  select checkout.project_id, checkout.currency, checkout.amount_minor
  into checkout_record
  from ss.checkout_intents checkout
  where checkout.organization_id = new.organization_id
    and checkout.id = new.checkout_intent_id;

  if not found
    or quote_record.project_id <> new.project_id
    or checkout_record.project_id <> new.project_id
    or quote_record.disclosure_digest <> new.accepted_disclosure_digest
    or quote_record.state <> 'quoted'
    or quote_record.expires_at <= new.accepted_at
    or not exists (
      select 1
      from ss.project_addresses address
      where address.organization_id = new.organization_id
        and address.project_id = new.project_id
        and address.id = quote_record.address_id
        and address.revision = quote_record.address_revision
        and (
          case when address.kind = 'licensed'
            then 'licensed'
            else 'customer_owned'
          end
        ) = quote_record.address_mode
    )
  then
    raise exception 'checkout quote binding is stale or inconsistent'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create constraint trigger checkout_quote_bindings_exact
after insert on ss.checkout_quote_bindings
deferrable initially immediate
for each row execute function ss.validate_checkout_quote_binding();

-- Preview facts never change. Acceptance is a separate immutable evidence row,
-- so a stale/mismatched preview cannot be rewritten into a valid one.
create table ss.subscription_cancellation_previews (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  subscription_revision bigint not null check (subscription_revision > 0),
  subscription_status text not null
    check (subscription_status in ('active', 'grace')),
  offer_key text not null,
  current_period_ends_at timestamptz not null,
  effective_at timestamptz not null,
  retention_ends_at timestamptz not null,
  disclosure_digest ss.sha256_hex not null,
  issued_by_user_id uuid not null references auth.users(id),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, subscription_id)
    references ss.stripe_subscriptions(organization_id, id),
  unique (organization_id, id),
  check (effective_at = current_period_ends_at),
  check (retention_ends_at > effective_at),
  check (expires_at > issued_at)
);

create trigger subscription_cancellation_previews_no_update
before update or delete on ss.subscription_cancellation_previews
for each row execute function ss.reject_update();

create function ss.validate_cancellation_preview_binding()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.stripe_subscriptions subscription
    join ss.catalog_prices price on price.id = subscription.catalog_price_id
    join ss.catalog_plans plan on plan.id = price.plan_id
    where subscription.organization_id = new.organization_id
      and subscription.project_id = new.project_id
      and subscription.id = new.subscription_id
      and subscription.revision = new.subscription_revision
      and subscription.status = new.subscription_status
      and subscription.current_period_ends_at = new.current_period_ends_at
      and plan.plan_key = new.offer_key
  ) then
    raise exception 'cancellation preview subscription binding is stale'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger subscription_cancellation_previews_exact
after insert on ss.subscription_cancellation_previews
deferrable initially immediate
for each row execute function ss.validate_cancellation_preview_binding();

create table ss.subscription_cancellation_acceptances (
  preview_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  accepted_by_user_id uuid not null references auth.users(id),
  request_id uuid not null,
  accepted_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, subscription_id)
    references ss.stripe_subscriptions(organization_id, id),
  foreign key (organization_id, preview_id)
    references ss.subscription_cancellation_previews(organization_id, id),
  unique (organization_id, request_id)
);

create trigger subscription_cancellation_acceptances_no_update
before update or delete on ss.subscription_cancellation_acceptances
for each row execute function ss.reject_update();

create function ss.validate_cancellation_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  preview_record record;
begin
  select preview.*
  into preview_record
  from ss.subscription_cancellation_previews preview
  where preview.organization_id = new.organization_id
    and preview.id = new.preview_id
  for share;

  if not found
    or preview_record.project_id <> new.project_id
    or preview_record.subscription_id <> new.subscription_id
    or preview_record.disclosure_digest <> new.accepted_disclosure_digest
    or preview_record.expires_at <= new.accepted_at
    or not exists (
      select 1
      from ss.stripe_subscriptions subscription
      where subscription.organization_id = new.organization_id
        and subscription.project_id = new.project_id
        and subscription.id = new.subscription_id
        and subscription.revision = preview_record.subscription_revision
        and subscription.status = preview_record.subscription_status
        and subscription.current_period_ends_at =
          preview_record.current_period_ends_at
    )
  then
    raise exception 'cancellation acceptance is stale or inconsistent'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger subscription_cancellation_acceptances_exact
after insert on ss.subscription_cancellation_acceptances
deferrable initially immediate
for each row execute function ss.validate_cancellation_acceptance();

-- export_requests owns export lifecycle/object metadata. This table only owns
-- the short-lived one-time authorization used by the same-origin download.
create table ss.export_download_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  export_request_id uuid not null,
  issued_to_user_id uuid not null references auth.users(id),
  token_digest ss.sha256_hex not null unique,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, export_request_id)
    references ss.export_requests(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (expires_at > issued_at),
  check (consumed_at is null or consumed_at >= issued_at)
);

create index export_download_authorizations_current
  on ss.export_download_authorizations(
    organization_id,
    project_id,
    export_request_id,
    expires_at
  )
  where consumed_at is null;

create function ss.guard_export_download_authorization()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.organization_id,
    new.project_id,
    new.export_request_id,
    new.issued_to_user_id,
    new.token_digest,
    new.issued_at,
    new.expires_at
  ) is distinct from row(
    old.organization_id,
    old.project_id,
    old.export_request_id,
    old.issued_to_user_id,
    old.token_digest,
    old.issued_at,
    old.expires_at
  ) or old.consumed_at is not null
  then
    raise exception 'export download authorization is immutable after issue'
      using errcode = '55000';
  end if;
  if new.consumed_at is null or new.consumed_at < old.issued_at then
    raise exception 'export download authorization may only be consumed once'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger export_download_authorizations_guard
before update on ss.export_download_authorizations
for each row execute function ss.guard_export_download_authorization();

create trigger export_download_authorizations_no_delete
before delete on ss.export_download_authorizations
for each row execute function ss.reject_update();

-- All tenant additions follow the same forced-RLS posture as migration 005.
do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'commerce_quotes',
    'checkout_quote_bindings',
    'subscription_cancellation_previews',
    'subscription_cancellation_acceptances',
    'export_download_authorizations'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'create policy %I on ss.%I for select using (ss.can_access_org(organization_id))',
      table_name || '_tenant_read',
      table_name
    );
  end loop;
end
$$;

alter table ss.hosted_account_profiles enable row level security;
alter table ss.hosted_account_profiles force row level security;
create policy hosted_account_profiles_self_read
on ss.hosted_account_profiles for select
using (user_id = ss.current_user_id());

alter table ss.hosted_password_credentials enable row level security;
alter table ss.hosted_password_credentials force row level security;
alter table ss.hosted_sessions enable row level security;
alter table ss.hosted_sessions force row level security;
alter table ss.hosted_recovery_tokens enable row level security;
alter table ss.hosted_recovery_tokens force row level security;

alter table ss.catalog_offer_policies enable row level security;
alter table ss.catalog_offer_policies force row level security;
create policy catalog_offer_policies_authenticated_read
on ss.catalog_offer_policies for select
using (ss.current_user_id() is not null);

revoke all on
  ss.hosted_account_profiles,
  ss.hosted_password_credentials,
  ss.hosted_sessions,
  ss.hosted_recovery_tokens,
  ss.catalog_offer_policies,
  ss.commerce_quotes,
  ss.checkout_quote_bindings,
  ss.subscription_cancellation_previews,
  ss.subscription_cancellation_acceptances,
  ss.export_download_authorizations
from public, anon, authenticated;

grant select on
  ss.hosted_account_profiles,
  ss.catalog_offer_policies,
  ss.commerce_quotes,
  ss.checkout_quote_bindings,
  ss.subscription_cancellation_previews,
  ss.subscription_cancellation_acceptances,
  ss.export_download_authorizations
to authenticated;

grant all privileges on
  ss.hosted_account_profiles,
  ss.hosted_password_credentials,
  ss.hosted_sessions,
  ss.hosted_recovery_tokens,
  ss.catalog_offer_policies,
  ss.commerce_quotes,
  ss.checkout_quote_bindings,
  ss.subscription_cancellation_previews,
  ss.subscription_cancellation_acceptances,
  ss.export_download_authorizations
to service_role;

revoke all on function ss.bump_project_address_revision()
from public, anon, authenticated;
revoke all on function ss.bump_stripe_subscription_revision()
from public, anon, authenticated;
revoke all on function ss.validate_commerce_quote_binding()
from public, anon, authenticated;
revoke all on function ss.guard_commerce_quote_update()
from public, anon, authenticated;
revoke all on function ss.validate_checkout_quote_binding()
from public, anon, authenticated;
revoke all on function ss.validate_cancellation_preview_binding()
from public, anon, authenticated;
revoke all on function ss.validate_cancellation_acceptance()
from public, anon, authenticated;
revoke all on function ss.guard_export_download_authorization()
from public, anon, authenticated;

grant execute on function ss.validate_commerce_quote_binding() to service_role;
grant execute on function ss.validate_checkout_quote_binding() to service_role;
grant execute on function ss.validate_cancellation_preview_binding() to service_role;
grant execute on function ss.validate_cancellation_acceptance() to service_role;

commit;
