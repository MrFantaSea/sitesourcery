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

-- Stripe redacts Session.url after expiry. Replace the original unnamed
-- Download state/result checks with named equivalents that preserve every
-- ready/settled invariant while admitting one exact expired reconciliation
-- tombstone: provider Session identity retained, URL explicitly unavailable,
-- and provider/payment facts frozen as expired and unpaid.
do $$
declare
  matched_count integer;
  selected_name text;
begin
  select count(*), min(constraint_row.conname::text)
    into matched_count, selected_name
    from pg_constraint constraint_row
   where constraint_row.contype = 'c'
     and constraint_row.conrelid =
         'ss.commerce_v2_download_dispatches'::regclass
     and pg_get_constraintdef(constraint_row.oid) like
         '%state = ''dispatching''%'
     and pg_get_constraintdef(constraint_row.oid) like
         '%state = ''effect_unknown''%'
     and pg_get_constraintdef(constraint_row.oid) like
         '%checkout_session_id IS NULL%';
  if matched_count <> 1 then
    raise exception
      'expected one original Download dispatch state constraint, found %',
      matched_count
      using errcode = '55000';
  end if;
  execute format(
    'alter table ss.commerce_v2_download_dispatches drop constraint %I',
    selected_name
  );

  select count(*), min(constraint_row.conname::text)
    into matched_count, selected_name
    from pg_constraint constraint_row
   where constraint_row.contype = 'c'
     and constraint_row.conrelid =
         'ss.commerce_v2_download_dispatches'::regclass
     and pg_get_constraintdef(constraint_row.oid) like
         '%sitesourcery.abracadabra-checkout-dispatch.v2%'
     and pg_get_constraintdef(constraint_row.oid) like
         '%result%checkout%url%';
  if matched_count <> 1 then
    raise exception
      'expected one original Download dispatch result constraint, found %',
      matched_count
      using errcode = '55000';
  end if;
  execute format(
    'alter table ss.commerce_v2_download_dispatches drop constraint %I',
    selected_name
  );
end
$$;

alter table ss.commerce_v2_download_dispatches
  add constraint commerce_v2_download_dispatch_state_v145
  check (
    (
      state = 'dispatching'
      and checkout_session_id is null
      and checkout_url is null
      and provider_expires_at is null
      and dispatched_at is null
      and provider_error_code is null
      and result is null
    )
    or (
      state = 'effect_unknown'
      and checkout_session_id is null
      and checkout_url is null
      and provider_expires_at is null
      and dispatched_at is null
      and provider_error_code is not null
      and result is null
    )
    or (
      state in ('ready', 'settled')
      and checkout_session_id is not null
      and checkout_url is not null
      and provider_expires_at is not null
      and dispatched_at is not null
      and provider_error_code is null
      and result is not null
      and provider_expires_at > dispatched_at
    )
    or (
      state = 'expired'
      and checkout_session_id is not null
      and provider_expires_at is not null
      and dispatched_at is not null
      and provider_error_code is null
      and result is not null
      and provider_expires_at > dispatched_at
      and (
        checkout_url is not null
        or (
          checkout_url is null
          and result ->> 'schema' =
              'sitesourcery.abracadabra-checkout-expired-reconciliation.v1'
        )
      )
    )
  );

alter table ss.commerce_v2_download_dispatches
  add constraint commerce_v2_download_dispatch_result_v145
  check (
    result is null
    or (
      result ->> 'schema' =
        'sitesourcery.abracadabra-checkout-dispatch.v2'
      and result ->> 'commandId' = preparation_command_id
      and result ->> 'quoteId' = quote_id::text
      and result ->> 'projectId' = project_id::text
      and result ->> 'versionId' = version_id::text
      and result ->> 'offerId' = 'spark_download'
      and result ->> 'entitlementKind' = 'spark_download'
      and result ->> 'state' = 'ready'
      and result -> 'dispatchAuthorized' = 'true'::jsonb
      and result ->> 'provider' = provider
      and result ->> 'purposeDigest' = purpose_digest
      and result #>> '{checkout,id}' = checkout_session_id
      and result #>> '{checkout,url}' = checkout_url
      and result ->> 'checkoutUrl' = checkout_url
      and result #>> '{checkout,expiresAt}' =
        to_char(
          provider_expires_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      and result ->> 'dispatchedAt' =
        to_char(
          dispatched_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
    )
    or (
      state = 'expired'
      and checkout_url is null
      and result ->> 'schema' =
        'sitesourcery.abracadabra-checkout-expired-reconciliation.v1'
      and result ->> 'commandId' = preparation_command_id
      and result ->> 'quoteId' = quote_id::text
      and result ->> 'projectId' = project_id::text
      and result ->> 'versionId' = version_id::text
      and result ->> 'offerId' = 'spark_download'
      and result ->> 'entitlementKind' = 'spark_download'
      and result ->> 'state' = 'expired'
      and result -> 'reconciliationAuthorized' = 'true'::jsonb
      and result ->> 'provider' = provider
      and result ->> 'providerStatus' = 'expired'
      and result ->> 'paymentStatus' = 'unpaid'
      and result -> 'paymentIntentPresent' = 'false'::jsonb
      and result ->> 'purposeDigest' = purpose_digest
      and result #>> '{checkout,id}' = checkout_session_id
      and result -> 'checkout' -> 'url' = 'null'::jsonb
      and result #>> '{checkout,expiresAt}' =
        to_char(
          provider_expires_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      and result ->> 'dispatchedAt' =
        to_char(
          dispatched_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
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
