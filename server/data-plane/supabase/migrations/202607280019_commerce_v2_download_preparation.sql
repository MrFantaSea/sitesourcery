begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v18()') is null
    or to_regprocedure('ss.activate_hosted_edge_purge()') is null
    or to_regclass('ss.projects') is null
    or to_regclass('ss.fact_sets') is null
    or to_regclass('ss.site_versions') is null
    or to_regclass('ss.version_state_projection') is null
    or to_regclass('ss.deletion_requests') is null
  then
    raise exception
      'canonical hosted runtime v18 and terminal purge support must be installed first'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.site_versions
  add constraint site_versions_org_project_id_v19
  unique (organization_id, project_id, id);

-- These rows persist only a held, authenticated Download decision. Provider
-- dispatch, payment evidence, and entitlement issuance deliberately have no
-- representation in this migration.
create table ss.commerce_v2_commands (
  organization_id uuid not null
    references ss.organizations(id),
  command_id text not null
    check (char_length(command_id) between 1 and 200),
  operation text not null
    check (
      operation in (
        'create_v2_quote',
        'prepare_v2_checkout'
      )
    ),
  fingerprint ss.sha256_hex not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  actor_user_id uuid not null
    references auth.users(id),
  state text not null default 'pending'
    check (state in ('pending', 'complete')),
  result jsonb,
  claimed_at timestamptz not null
    default clock_timestamp(),
  completed_at timestamptz,
  primary key (organization_id, command_id),
  unique (
    organization_id,
    command_id,
    project_id,
    customer_user_id,
    actor_user_id
  ),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (
    organization_id,
    actor_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  check (customer_user_id = actor_user_id),
  check (
    result is null
    or (
      jsonb_typeof(result) = 'object'
      and pg_column_size(result) <= 65536
    )
  ),
  check (
    (
      state = 'pending'
      and result is null
      and completed_at is null
    )
    or (
      state = 'complete'
      and result is not null
      and completed_at is not null
      and completed_at >= claimed_at
    )
  )
);

create index commerce_v2_commands_project
  on ss.commerce_v2_commands(
    organization_id,
    project_id,
    claimed_at
  );

create function ss.validate_commerce_v2_command_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'pending'
    or new.result is not null
    or new.completed_at is not null
    or not exists (
      select 1
      from ss.projects project
      join ss.organizations organization
        on organization.id = project.organization_id
       and organization.state = 'active'
      join ss.organization_memberships customer
        on customer.organization_id = project.organization_id
       and customer.user_id = new.customer_user_id
       and customer.state = 'active'
       and customer.role in ('owner', 'admin', 'editor')
      join ss.organization_memberships actor
        on actor.organization_id = project.organization_id
       and actor.user_id = new.actor_user_id
       and actor.state = 'active'
       and actor.role in ('owner', 'admin', 'editor')
      where project.organization_id = new.organization_id
        and project.id = new.project_id
        and project.lifecycle = 'active'
    )
  then
    raise exception
      'commerce v2 command requires an active editor project scope'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_commands_validate_insert
before insert on ss.commerce_v2_commands
for each row execute function
  ss.validate_commerce_v2_command_insert();

create table ss.commerce_v2_download_quotes (
  id uuid primary key,
  organization_id uuid not null,
  command_id text not null,
  customer_user_id uuid not null
    references auth.users(id),
  actor_user_id uuid not null
    references auth.users(id),
  project_id uuid not null,
  version_id uuid not null,
  catalog_version text not null
    check (
      catalog_version =
        'spark-actions.2026-07-30.v1'
    ),
  terms_version text not null
    check (
      terms_version =
        'spark-actions-held.2026-07-30.v1'
    ),
  version_content_digest ss.sha256_hex not null,
  offer_id text not null
    check (offer_id = 'spark_download'),
  entitlement_kind text not null
    check (entitlement_kind = 'spark_download'),
  amount_minor integer not null
    check (amount_minor = 500),
  currency text not null
    check (currency = 'USD'),
  billing text not null
    check (billing = 'one_time'),
  state text not null
    check (state = 'held'),
  dispatch_authorized boolean not null
    check (dispatch_authorized = false),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  disclosure_digest ss.sha256_hex not null,
  snapshot_digest ss.sha256_hex not null,
  snapshot jsonb not null
    check (
      jsonb_typeof(snapshot) = 'object'
      and pg_column_size(snapshot) <= 65536
    ),
  created_at timestamptz not null
    default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, command_id),
  unique (
    organization_id,
    id,
    project_id,
    version_id,
    customer_user_id,
    actor_user_id
  ),
  foreign key (
    organization_id,
    command_id,
    project_id,
    customer_user_id,
    actor_user_id
  ) references ss.commerce_v2_commands(
    organization_id,
    command_id,
    project_id,
    customer_user_id,
    actor_user_id
  ) on delete cascade,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    project_id,
    version_id
  ) references ss.site_versions(
    organization_id,
    project_id,
    id
  ),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (
    organization_id,
    actor_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  check (customer_user_id = actor_user_id),
  check (
    expires_at = issued_at + interval '30 minutes'
  ),
  check (
    (
      snapshot ->> 'schema' =
      'sitesourcery.abracadabra-quote-snapshot.v2'
    and snapshot ->> 'quoteId' = id::text
    and snapshot ->> 'tenantId' =
      organization_id::text
    and snapshot ->> 'customerId' =
      customer_user_id::text
    and snapshot ->> 'actorId' =
      actor_user_id::text
    and snapshot ->> 'catalogVersion' =
      catalog_version
    and snapshot ->> 'termsVersion' =
      terms_version
    and snapshot #>> '{project,projectId}' =
      project_id::text
    and snapshot #>> '{version,versionId}' =
      version_id::text
    and snapshot #>> '{version,state}' = 'accepted'
    and snapshot #>> '{version,contentDigest}' =
      version_content_digest
    and snapshot
      #>> '{disclosure,catalogVersion}' =
      catalog_version
    and snapshot
      #>> '{disclosure,termsVersion}' =
      terms_version
    and snapshot
      #>> '{disclosure,project,versionContentDigest}' =
      version_content_digest
    and snapshot ->> 'offerId' = offer_id
    and snapshot ->> 'entitlementKind' =
      entitlement_kind
    and snapshot #> '{price,amountMinor}' =
      to_jsonb(amount_minor)
    and snapshot #>> '{price,currency}' = currency
    and snapshot #>> '{price,billing}' = billing
    and snapshot #> '{price,interval}' = 'null'::jsonb
    and snapshot ->> 'state' = state
    and snapshot -> 'dispatchAuthorized' =
      'false'::jsonb
    and snapshot ->> 'issuedAt' =
      to_char(
        issued_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    and snapshot ->> 'expiresAt' =
      to_char(
        expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    and snapshot ->> 'disclosureDigest' =
      disclosure_digest
    and snapshot ->> 'snapshotDigest' =
      snapshot_digest
    ) is true
  )
);

create index commerce_v2_download_quotes_project
  on ss.commerce_v2_download_quotes(
    organization_id,
    project_id,
    issued_at desc
  );

create function ss.validate_commerce_v2_download_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.commerce_v2_commands command
    where command.organization_id = new.organization_id
      and command.command_id = new.command_id
      and command.operation = 'create_v2_quote'
      and command.project_id = new.project_id
      and command.customer_user_id =
        new.customer_user_id
      and command.actor_user_id = new.actor_user_id
      and command.state = 'pending'
  ) or not exists (
    select 1
    from ss.site_versions version
    join ss.projects project
      on project.organization_id =
         version.organization_id
     and project.id = version.project_id
     and project.lifecycle = 'active'
    join ss.organizations organization
      on organization.id = version.organization_id
     and organization.state = 'active'
    join ss.organization_memberships customer
      on customer.organization_id =
         version.organization_id
     and customer.user_id = new.customer_user_id
     and customer.state = 'active'
     and customer.role in ('owner', 'admin', 'editor')
    join ss.organization_memberships actor
      on actor.organization_id =
         version.organization_id
     and actor.user_id = new.actor_user_id
     and actor.state = 'active'
     and actor.role in ('owner', 'admin', 'editor')
    join ss.version_state_projection state
      on state.organization_id =
         version.organization_id
     and state.project_id = version.project_id
     and state.version_id = version.id
     and state.state = 'accepted_release'
    join ss.fact_sets fact
      on fact.organization_id = version.organization_id
     and fact.project_id = version.project_id
     and fact.id = version.fact_set_id
     and fact.content_digest =
         new.version_content_digest
    where version.organization_id = new.organization_id
      and version.project_id = new.project_id
      and version.id = new.version_id
  )
  then
    raise exception
      'commerce v2 quote requires the exact active accepted project version'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_quotes_validate
before insert on ss.commerce_v2_download_quotes
for each row execute function
  ss.validate_commerce_v2_download_quote();

create trigger commerce_v2_download_quotes_immutable
before update or delete on
  ss.commerce_v2_download_quotes
for each row execute function ss.reject_update();

create table ss.commerce_v2_checkout_preparations (
  organization_id uuid not null,
  command_id text not null,
  quote_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  actor_user_id uuid not null
    references auth.users(id),
  project_id uuid not null,
  version_id uuid not null,
  offer_id text not null
    check (offer_id = 'spark_download'),
  entitlement_kind text not null
    check (entitlement_kind = 'spark_download'),
  state text not null
    check (state = 'held'),
  hold_reason text not null
    check (
      hold_reason =
        'provider_dispatch_not_authorized'
    ),
  dispatch_authorized boolean not null
    check (dispatch_authorized = false),
  prepared_at timestamptz not null,
  purpose_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  quote_snapshot_digest ss.sha256_hex not null,
  preparation jsonb not null
    check (
      jsonb_typeof(preparation) = 'object'
      and pg_column_size(preparation) <= 65536
    ),
  created_at timestamptz not null
    default clock_timestamp(),
  primary key (organization_id, command_id),
  foreign key (
    organization_id,
    command_id,
    project_id,
    customer_user_id,
    actor_user_id
  ) references ss.commerce_v2_commands(
    organization_id,
    command_id,
    project_id,
    customer_user_id,
    actor_user_id
  ) on delete cascade,
  foreign key (
    organization_id,
    quote_id,
    project_id,
    version_id,
    customer_user_id,
    actor_user_id
  ) references ss.commerce_v2_download_quotes(
    organization_id,
    id,
    project_id,
    version_id,
    customer_user_id,
    actor_user_id
  ) on delete cascade,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    project_id,
    version_id
  ) references ss.site_versions(
    organization_id,
    project_id,
    id
  ),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (
    organization_id,
    actor_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  check (customer_user_id = actor_user_id),
  check (
    (
      preparation ->> 'schema' =
      'sitesourcery.abracadabra-checkout-command.v2'
    and preparation ->> 'commandId' = command_id
    and preparation ->> 'quoteId' = quote_id::text
    and preparation ->> 'projectId' =
      project_id::text
    and preparation ->> 'versionId' =
      version_id::text
    and preparation ->> 'offerId' = offer_id
    and preparation ->> 'entitlementKind' =
      entitlement_kind
    and preparation ->> 'state' = state
    and preparation ->> 'holdReason' = hold_reason
    and preparation -> 'dispatchAuthorized' =
      'false'::jsonb
    and preparation -> 'provider' = 'null'::jsonb
    and preparation ->> 'preparedAt' =
      to_char(
        prepared_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    and preparation ->> 'purposeDigest' =
      purpose_digest
    and preparation #>> '{purpose,tenantId}' =
      organization_id::text
    and preparation #>> '{purpose,customerId}' =
      customer_user_id::text
    and preparation #>> '{purpose,projectId}' =
      project_id::text
    and preparation #>> '{purpose,versionId}' =
      version_id::text
    and preparation #>> '{purpose,quoteId}' =
      quote_id::text
    and preparation
      #>> '{purpose,quoteSnapshotDigest}' =
      quote_snapshot_digest
    and preparation
      #>> '{purpose,acceptedDisclosureDigest}' =
      accepted_disclosure_digest
    and preparation #>> '{purpose,offerId}' =
      offer_id
    and preparation
      #>> '{purpose,entitlementKind}' =
      entitlement_kind
    and preparation
      #> '{purpose,price,amountMinor}' = '500'::jsonb
    and preparation
      #>> '{purpose,price,currency}' = 'USD'
    and preparation
      #>> '{purpose,price,billing}' = 'one_time'
    and preparation
      #> '{purpose,price,interval}' = 'null'::jsonb
    ) is true
  )
);

create index commerce_v2_checkout_project
  on ss.commerce_v2_checkout_preparations(
    organization_id,
    project_id,
    prepared_at desc
  );

create function ss.validate_commerce_v2_checkout_preparation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.commerce_v2_commands command
    where command.organization_id = new.organization_id
      and command.command_id = new.command_id
      and command.operation = 'prepare_v2_checkout'
      and command.project_id = new.project_id
      and command.customer_user_id =
        new.customer_user_id
      and command.actor_user_id = new.actor_user_id
      and command.state = 'pending'
  ) or not exists (
    select 1
    from ss.commerce_v2_download_quotes quote
    join ss.projects project
      on project.organization_id =
         quote.organization_id
     and project.id = quote.project_id
     and project.lifecycle = 'active'
    join ss.organizations organization
      on organization.id = quote.organization_id
     and organization.state = 'active'
    join ss.site_versions version
      on version.organization_id =
         quote.organization_id
     and version.project_id = quote.project_id
     and version.id = quote.version_id
    join ss.version_state_projection version_state
      on version_state.organization_id =
         version.organization_id
     and version_state.project_id = version.project_id
     and version_state.version_id = version.id
     and version_state.state = 'accepted_release'
    join ss.fact_sets fact
      on fact.organization_id = version.organization_id
     and fact.project_id = version.project_id
     and fact.id = version.fact_set_id
     and fact.content_digest =
         quote.version_content_digest
    join ss.organization_memberships customer
      on customer.organization_id =
         quote.organization_id
     and customer.user_id = new.customer_user_id
     and customer.state = 'active'
     and customer.role in ('owner', 'admin', 'editor')
    join ss.organization_memberships actor
      on actor.organization_id = quote.organization_id
     and actor.user_id = new.actor_user_id
     and actor.state = 'active'
     and actor.role in ('owner', 'admin', 'editor')
    where quote.organization_id = new.organization_id
      and quote.id = new.quote_id
      and quote.project_id = new.project_id
      and quote.version_id = new.version_id
      and quote.customer_user_id =
          new.customer_user_id
      and quote.actor_user_id = new.actor_user_id
      and quote.offer_id = 'spark_download'
      and quote.entitlement_kind = 'spark_download'
      and quote.state = 'held'
      and quote.dispatch_authorized = false
      and quote.disclosure_digest =
          new.accepted_disclosure_digest
      and quote.snapshot_digest =
          new.quote_snapshot_digest
      and new.prepared_at >= quote.issued_at
      and new.prepared_at < quote.expires_at
  )
  then
    raise exception
      'commerce v2 checkout preparation does not match an unexpired held quote'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_checkout_preparations_validate
before insert on ss.commerce_v2_checkout_preparations
for each row execute function
  ss.validate_commerce_v2_checkout_preparation();

create trigger commerce_v2_checkout_preparations_immutable
before update or delete on
  ss.commerce_v2_checkout_preparations
for each row execute function ss.reject_update();

create function ss.validate_commerce_v2_command_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.command_id is distinct from old.command_id
    or new.operation is distinct from old.operation
    or new.fingerprint is distinct from old.fingerprint
    or new.project_id is distinct from old.project_id
    or new.customer_user_id is distinct from
       old.customer_user_id
    or new.actor_user_id is distinct from
       old.actor_user_id
    or new.claimed_at is distinct from old.claimed_at
  then
    raise exception 'commerce v2 command identity is immutable'
      using errcode = '55000';
  end if;

  if old.state <> 'pending'
    or new.state <> 'complete'
    or (
      new.operation = 'create_v2_quote'
      and not exists (
        select 1
        from ss.commerce_v2_download_quotes quote
        where quote.organization_id =
              new.organization_id
          and quote.command_id = new.command_id
          and quote.project_id = new.project_id
          and quote.customer_user_id =
              new.customer_user_id
          and quote.actor_user_id = new.actor_user_id
          and quote.snapshot = new.result
      )
    )
    or (
      new.operation = 'prepare_v2_checkout'
      and not exists (
        select 1
        from ss.commerce_v2_checkout_preparations prep
        where prep.organization_id =
              new.organization_id
          and prep.command_id = new.command_id
          and prep.project_id = new.project_id
          and prep.customer_user_id =
              new.customer_user_id
          and prep.actor_user_id = new.actor_user_id
          and prep.preparation = new.result
      )
    )
  then
    raise exception
      'commerce v2 command permits only a child-backed pending to complete transition'
      using errcode = '55000';
  end if;

  return new;
end
$$;

create trigger commerce_v2_commands_transition
before update on ss.commerce_v2_commands
for each row execute function
  ss.validate_commerce_v2_command_transition();

create function ss.validate_commerce_v2_command_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if old.state = 'pending' then
    return old;
  end if;

  if nullif(
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

  raise exception 'completed commerce v2 commands are immutable'
    using errcode = '55000';
end
$$;

create trigger commerce_v2_commands_delete
before delete on ss.commerce_v2_commands
for each row execute function
  ss.validate_commerce_v2_command_delete();

-- Terminal project deletion retains the project/tombstone row. Purge the
-- commerce-v2 edges as soon as the deletion request becomes visible in its
-- sealed purging state, before the older purge function deletes site_versions.
create function ss.activate_commerce_v2_purge()
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
        'commerceV2Commands', (
          select count(*)
          from ss.commerce_v2_commands
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadQuotes', (
          select count(*)
          from ss.commerce_v2_download_quotes
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2CheckoutPreparations', (
          select count(*)
          from ss.commerce_v2_checkout_preparations
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_activate_commerce_v2_purge
before insert or update of state on ss.deletion_requests
for each row execute function
  ss.activate_commerce_v2_purge();

create function ss.purge_commerce_v2_on_project_seal()
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
        'commerce v2 purge requires the sealed deletion boundary'
        using errcode = '42501';
    end if;

    delete from ss.commerce_v2_checkout_preparations
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.commerce_v2_download_quotes
    where organization_id = new.organization_id
      and project_id = new.project_id;
    delete from ss.commerce_v2_commands
    where organization_id = new.organization_id
      and project_id = new.project_id;
  end if;
  return new;
end
$$;

create trigger deletion_requests_purge_commerce_v2
after insert or update of state on ss.deletion_requests
for each row execute function
  ss.purge_commerce_v2_on_project_seal();

alter table ss.commerce_v2_commands
  enable row level security;
alter table ss.commerce_v2_commands
  force row level security;
alter table ss.commerce_v2_download_quotes
  enable row level security;
alter table ss.commerce_v2_download_quotes
  force row level security;
alter table ss.commerce_v2_checkout_preparations
  enable row level security;
alter table ss.commerce_v2_checkout_preparations
  force row level security;

revoke all on
  ss.commerce_v2_commands,
  ss.commerce_v2_download_quotes,
  ss.commerce_v2_checkout_preparations
from public, anon, authenticated;

grant all privileges on
  ss.commerce_v2_commands,
  ss.commerce_v2_download_quotes,
  ss.commerce_v2_checkout_preparations
to service_role;

revoke all on function
  ss.validate_commerce_v2_command_insert(),
  ss.validate_commerce_v2_download_quote(),
  ss.validate_commerce_v2_checkout_preparation(),
  ss.validate_commerce_v2_command_transition(),
  ss.validate_commerce_v2_command_delete(),
  ss.activate_commerce_v2_purge(),
  ss.purge_commerce_v2_on_project_seal()
from public, anon, authenticated;

grant execute on function
  ss.validate_commerce_v2_command_insert(),
  ss.validate_commerce_v2_download_quote(),
  ss.validate_commerce_v2_checkout_preparation(),
  ss.validate_commerce_v2_command_transition(),
  ss.validate_commerce_v2_command_delete(),
  ss.activate_commerce_v2_purge(),
  ss.purge_commerce_v2_on_project_seal()
to service_role;

create function ss.hosted_runtime_contract_v19()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v19-commerce-v2-download-preparation'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v19()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v19()
to authenticated, service_role;

commit;
