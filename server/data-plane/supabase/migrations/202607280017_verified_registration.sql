begin;

do $$
begin
  if to_regclass('ss.hosted_account_profiles') is null
    or to_regclass('ss.hosted_password_credentials') is null
    or to_regclass('ss.hosted_sessions') is null
    or to_regclass('ss.hosted_auth_rate_limits') is null
  then
    raise exception
      'canonical hosted identity migrations must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- No auth.users, organization, membership, credential, or session row exists
-- until possession of the one-time token delivered to this email is proven.
-- This table is service-role-only and deliberately keeps the pending password
-- verifier separate from the active credential table.
create table ss.hosted_registration_requests (
  id uuid primary key,
  command_id text not null unique
    check (char_length(command_id) between 8 and 200),
  request_digest ss.sha256_hex not null,
  email text not null
    check (
      char_length(email) between 3 and 254
      and email = lower(email)
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  display_name text not null
    check (char_length(display_name) between 1 and 100),
  organization_name text not null
    check (char_length(organization_name) between 2 and 120),
  password_phc text not null
    check (password_phc like 'scrypt$32768$8$1$%'),
  pepper_version text not null
    check (char_length(pepper_version) between 1 and 80),
  token_digest ss.sha256_hex not null unique,
  state text not null check (
    state in (
      'pending_delivery',
      'delivered',
      'delivery_unknown',
      'activated',
      'superseded'
    )
  ),
  delivery_provider text,
  delivery_receipt jsonb,
  delivery_receipt_digest ss.sha256_hex,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  activated_at timestamptz,
  activated_user_id uuid
    references auth.users(id) on delete cascade,
  activated_organization_id uuid
    references ss.organizations(id) on delete cascade,
  superseded_at timestamptz,
  check (expires_at > created_at),
  check (
    num_nonnulls(
      delivery_provider,
      delivery_receipt,
      delivery_receipt_digest,
      delivered_at
    ) in (0, 4)
  ),
  check (
    delivery_receipt is null
    or (
      jsonb_typeof(delivery_receipt) = 'object'
      and pg_column_size(delivery_receipt) <= 4096
    )
  ),
  check (
    (
      state in ('delivered', 'activated')
      and delivered_at is not null
    )
    or (
      state = 'superseded'
    )
    or (
      state in (
        'pending_delivery',
        'delivery_unknown'
      )
      and delivered_at is null
    )
  ),
  check (
    (
      state = 'activated'
      and activated_at is not null
      and activated_user_id is not null
      and activated_organization_id is not null
    )
    or (
      state <> 'activated'
      and activated_at is null
      and activated_user_id is null
      and activated_organization_id is null
    )
  ),
  check (
    (state = 'superseded') =
    (superseded_at is not null)
  ),
  check (
    activated_at is null
    or (
      delivered_at is not null
      and activated_at >= delivered_at
    )
  ),
  check (
    superseded_at is null
    or superseded_at >= created_at
  )
);

create unique index hosted_registration_one_current_email
  on ss.hosted_registration_requests(lower(email))
  where state in (
    'pending_delivery',
    'delivered',
    'delivery_unknown'
  );

create index hosted_registration_expiry
  on ss.hosted_registration_requests(expires_at)
  where state in (
    'pending_delivery',
    'delivered',
    'delivery_unknown'
  );

alter table ss.hosted_registration_requests
  enable row level security;
alter table ss.hosted_registration_requests
  force row level security;

revoke all on ss.hosted_registration_requests
from public, anon, authenticated;
grant all privileges on ss.hosted_registration_requests
to service_role;

commit;
