-- Stripe owns the Checkout destination and currently encodes opaque routing
-- evidence in its URL fragment. Preserve that provider-owned fragment while
-- retaining the exact HTTPS host, length, identity, and no-retry fences.

begin;

do $$
begin
  if to_regclass('ss.commerce_v2_download_dispatches') is null
    or to_regclass('ss.alakazam_checkout_dispatches') is null
    or to_regprocedure(
      'ss.validate_commerce_v2_download_dispatch_transition()'
    ) is null
  then
    raise exception
      'Download and Alakazam Checkout dispatch authority must be installed first'
      using errcode = '55000';
  end if;
end
$$;

do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conrelid::regclass as table_name,
           constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.contype = 'c'
       and constraint_row.conrelid in (
         'ss.commerce_v2_download_dispatches'::regclass,
         'ss.alakazam_checkout_dispatches'::regclass
       )
       and pg_get_constraintdef(constraint_row.oid) like '%checkout%url%'
       and pg_get_constraintdef(constraint_row.oid) like '%!~%'
  loop
    execute format(
      'alter table %s drop constraint %I',
      selected.table_name,
      selected.conname
    );
  end loop;
end
$$;

alter table ss.commerce_v2_download_dispatches
  add constraint commerce_v2_download_checkout_url_v145
  check (
    checkout_url is null
    or (
      char_length(checkout_url) between 1 and 4096
      and checkout_url ~ '^https://checkout[.]stripe[.]com/'
    )
  );

alter table ss.alakazam_checkout_dispatches
  add constraint alakazam_checkout_dispatch_url_v145
  check (
    provider_checkout_url is null
    or (
      char_length(provider_checkout_url) between 1 and 4096
      and provider_checkout_url ~
        '^https://checkout[.]stripe[.]com/'
    )
  );

-- An effect-unknown Download reservation remains no-retry. A separately
-- verified provider readback may, however, attach the exact original Session
-- and either recover it while open or close it after provider expiry.
create or replace function ss.validate_commerce_v2_download_dispatch_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.preparation_command_id is distinct from
       old.preparation_command_id
    or new.quote_id is distinct from old.quote_id
    or new.customer_user_id is distinct from
       old.customer_user_id
    or new.project_id is distinct from old.project_id
    or new.version_id is distinct from old.version_id
    or new.provider is distinct from old.provider
    or new.purpose_digest is distinct from old.purpose_digest
    or new.accepted_disclosure_digest is distinct from
       old.accepted_disclosure_digest
    or new.quote_snapshot_digest is distinct from
       old.quote_snapshot_digest
    or new.lease_expires_at is distinct from
       old.lease_expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Download dispatch identity is immutable'
      using errcode = '55000';
  end if;

  if not (
    (
      old.state = 'dispatching'
      and new.state in ('ready', 'effect_unknown')
    )
    or (
      old.state = 'ready'
      and new.state in ('expired', 'settled')
    )
    or (
      old.state = 'effect_unknown'
      and old.provider_error_code is not null
      and (
        (
          new.state = 'ready'
          and new.provider_expires_at > clock_timestamp()
        )
        or (
          new.state = 'expired'
          and new.provider_expires_at <= clock_timestamp()
        )
      )
    )
  ) or new.updated_at <= old.updated_at
  then
    raise exception 'Download dispatch transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

commit;
