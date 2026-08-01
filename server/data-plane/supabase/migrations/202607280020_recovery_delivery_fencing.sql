begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v19()') is null
    or to_regclass('ss.hosted_recovery_tokens') is null
    or to_regclass('ss.provider_receipts') is null
  then
    raise exception
      'canonical hosted runtime v19 and recovery dependencies must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- Reserve every recovery-message effect before crossing the provider
-- boundary. The table deliberately stores no recipient, token, or action URL.
-- A pending or unknown row is terminal for automatic retry: an operator must
-- reconcile it rather than risk sending the same security message twice.
create table ss.hosted_recovery_delivery_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  command_id text not null unique
    check (char_length(command_id) between 8 and 200),
  request_digest ss.sha256_hex not null,
  delivery_idempotency_key text not null unique
    check (char_length(delivery_idempotency_key) between 8 and 200),
  delivery_mode text not null
    check (delivery_mode in ('production', 'dev-sink')),
  delivery_provider text not null
    check (char_length(delivery_provider) between 1 and 120),
  state text not null default 'pending_delivery'
    check (
      state in (
        'pending_delivery',
        'delivered',
        'delivery_unknown'
      )
    ),
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  provider_receipt_id uuid unique
    references ss.provider_receipts(id),
  delivered_at timestamptz,
  failure_code text check (
    failure_code is null
    or failure_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expires_at > requested_at),
  check (
    (
      state = 'pending_delivery'
      and provider_receipt_id is null
      and delivered_at is null
      and failure_code is null
    )
    or (
      state = 'delivered'
      and provider_receipt_id is not null
      and delivered_at is not null
      and failure_code is null
      and delivered_at >= requested_at
      and delivered_at < expires_at
    )
    or (
      state = 'delivery_unknown'
      and provider_receipt_id is null
      and delivered_at is null
      and failure_code is not null
    )
  )
);

create index hosted_recovery_delivery_requests_expiry
  on ss.hosted_recovery_delivery_requests(expires_at)
  where state in ('pending_delivery', 'delivery_unknown');

create function ss.validate_hosted_recovery_delivery_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.id is distinct from old.id
    or new.command_id is distinct from old.command_id
    or new.request_digest is distinct from old.request_digest
    or new.delivery_idempotency_key is distinct from old.delivery_idempotency_key
    or new.delivery_mode is distinct from old.delivery_mode
    or new.delivery_provider is distinct from old.delivery_provider
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'recovery delivery reservation facts are immutable'
      using errcode = '23514';
  end if;

  if old.state <> 'pending_delivery'
    or new.state not in ('delivered', 'delivery_unknown')
  then
    raise exception 'recovery delivery state is terminal'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger hosted_recovery_delivery_requests_transition
before update on ss.hosted_recovery_delivery_requests
for each row execute function
  ss.validate_hosted_recovery_delivery_transition();

alter table ss.hosted_recovery_delivery_requests
  enable row level security;
alter table ss.hosted_recovery_delivery_requests
  force row level security;

revoke all on ss.hosted_recovery_delivery_requests
from public, anon, authenticated;
grant all privileges on ss.hosted_recovery_delivery_requests
to service_role;

revoke all on function
  ss.validate_hosted_recovery_delivery_transition()
from public, anon, authenticated;
grant execute on function
  ss.validate_hosted_recovery_delivery_transition()
to service_role;

create function ss.hosted_runtime_contract_v20()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v20-recovery-delivery-fencing'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v20()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v20()
to authenticated, service_role;

commit;
