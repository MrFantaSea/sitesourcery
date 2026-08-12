-- CARE-CORE-01: held shared Care catalog, contract, period, capacity, and ticket authority.
begin;

do $$
begin
  if to_regprocedure('ss.direct_custom_reversal_normalization_contract_v1()') is null
    or to_regclass('ss.service_catalog_policies') is null
    or to_regclass('ss.service_project_profiles') is null
    or to_regclass('ss.service_assessment_report_findings') is null
    or to_regclass('ss.support_tickets') is null
    or to_regprocedure('ss.service_operator_has_capability(uuid,text,timestamp with time zone)') is null
  then
    raise exception
      'Site Sourcery migration 117 and the retained service foundations must precede CARE-CORE-01'
      using errcode = '55000';
  end if;
end
$$;

-- These are normalized identities, not released offers. Missing owner-redlined
-- Care terms remain visibly absent instead of inheriting a historical price.
create table ss.care_catalog_identities (
  id uuid primary key,
  catalog_version text not null
    check (catalog_version = 'SS-CARE-CORE-2026.1'),
  service_key text not null
    check (service_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  contract_kind text not null
    check (
      contract_kind in (
        'rescue', 'custom_care', 'outside_management', 'alakazam_care'
      )
    ),
  site_origin text not null
    check (
      site_origin in (
        'any_supported', 'sitesourcery_custom', 'external', 'alakazam'
      )
    ),
  billing_cadence text not null
    check (billing_cadence in ('one_time', 'month')),
  capacity_unit_kind text not null
    check (capacity_unit_kind in ('repair_unit', 'care_request')),
  commercial_authority_state text not null
    check (
      commercial_authority_state in ('exact_held', 'owner_redline_required')
    ),
  commercial_contract_id text,
  commercial_contract_digest ss.sha256_hex,
  legal_document_id uuid references ss.legal_documents(id),
  availability_state text not null default 'held'
    check (availability_state = 'held'),
  customer_effects_authorized boolean not null default false
    check (not customer_effects_authorized),
  payment_effects_authorized boolean not null default false
    check (not payment_effects_authorized),
  provider_effects_authorized boolean not null default false
    check (not provider_effects_authorized),
  created_at timestamptz not null default clock_timestamp(),
  unique (catalog_version, service_key),
  unique (id, contract_kind),
  check (
    (
      commercial_authority_state = 'exact_held'
      and commercial_contract_id is not null
      and commercial_contract_digest is not null
      and legal_document_id is not null
    ) or (
      commercial_authority_state = 'owner_redline_required'
      and commercial_contract_id is null
      and commercial_contract_digest is null
      and legal_document_id is null
    )
  ),
  check (
    (contract_kind = 'rescue' and site_origin = 'any_supported'
      and billing_cadence = 'one_time' and capacity_unit_kind = 'repair_unit')
    or (contract_kind = 'custom_care' and site_origin = 'sitesourcery_custom'
      and billing_cadence = 'month' and capacity_unit_kind = 'repair_unit')
    or (contract_kind = 'outside_management' and site_origin = 'external'
      and billing_cadence = 'month' and capacity_unit_kind = 'repair_unit')
    or (contract_kind = 'alakazam_care' and site_origin = 'alakazam'
      and billing_cadence = 'month' and capacity_unit_kind = 'care_request')
  )
);

insert into ss.care_catalog_identities (
  id, catalog_version, service_key, contract_kind, site_origin,
  billing_cadence, capacity_unit_kind, commercial_authority_state,
  commercial_contract_id, commercial_contract_digest, legal_document_id
) values
  (
    '00000000-0000-4000-8000-000000001211',
    'SS-CARE-CORE-2026.1', 'website_rescue', 'rescue', 'any_supported',
    'one_time', 'repair_unit', 'exact_held',
    'SS-CUSTOM-SERVICES-2026-08-05.1',
    '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
    '00000000-0000-4000-8000-000000000342'
  ),
  (
    '00000000-0000-4000-8000-000000001212',
    'SS-CARE-CORE-2026.1', 'outside_management', 'outside_management',
    'external', 'month', 'repair_unit', 'exact_held',
    'SS-CUSTOM-SERVICES-2026-08-05.1',
    '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
    '00000000-0000-4000-8000-000000000342'
  ),
  (
    '00000000-0000-4000-8000-000000001213',
    'SS-CARE-CORE-2026.1', 'custom_care', 'custom_care',
    'sitesourcery_custom', 'month', 'repair_unit',
    'owner_redline_required', null, null, null
  ),
  (
    '00000000-0000-4000-8000-000000001214',
    'SS-CARE-CORE-2026.1', 'alakazam_care', 'alakazam_care',
    'alakazam', 'month', 'care_request',
    'owner_redline_required', null, null, null
  );

create trigger care_catalog_identities_immutable
before update or delete on ss.care_catalog_identities
for each row execute function ss.reject_update();

create table ss.care_commands (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  command_id text not null unique
    check (
      char_length(command_id) between 8 and 200
      and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
  action text not null
    check (
      action in (
        'contract_register', 'period_open', 'period_close', 'scope_claim',
        'ticket_open', 'ticket_start', 'ticket_wait', 'ticket_resume',
        'ticket_resolve', 'ticket_reopen', 'ticket_close',
        'capacity_allocate'
      )
    ),
  resource_kind text not null
    check (resource_kind in ('contract', 'period', 'scope_claim', 'ticket', 'capacity')),
  resource_id uuid not null,
  actor_kind text not null check (actor_kind in ('operator', 'system')),
  actor_user_id uuid references auth.users(id),
  request_digest ss.sha256_hex not null,
  result_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, command_id),
  check (created_at = recorded_at),
  check (
    (actor_kind = 'operator' and actor_user_id is not null)
    or (actor_kind = 'system' and actor_user_id is null)
  )
);

create function ss.care_actor_is_authorized(target_organization_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select
    ss.current_service_actor_org_id() is not distinct from target_organization_id
    and (
      ss.current_service_actor_kind() = 'system'
      or (
        ss.current_service_actor_kind() = 'operator'
        and ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_management_manage',
          clock_timestamp()
        )
      )
    )
$$;

create function ss.guard_care_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or not ss.care_actor_is_authorized(new.organization_id)
    or new.actor_kind is distinct from ss.current_service_actor_kind()
    or (
      new.actor_kind = 'operator'
      and new.actor_user_id is distinct from ss.current_service_actor_user_id()
    )
    or (new.actor_kind = 'system' and new.actor_user_id is not null)
  then
    raise exception 'Care command lacks exact held actor authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger care_commands_guard
before insert or update or delete on ss.care_commands
for each row execute function ss.guard_care_command();

create table ss.care_customer_contracts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  catalog_identity_id uuid not null,
  contract_kind text not null,
  acceptance_reference_id uuid not null,
  acceptance_digest ss.sha256_hex not null,
  scope_digest ss.sha256_hex not null,
  provider_scope_digest ss.sha256_hex not null,
  authority_state text not null check (authority_state = 'held'),
  customer_effects_authorized boolean not null check (not customer_effects_authorized),
  payment_effects_authorized boolean not null check (not payment_effects_authorized),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  opening_command_id text not null unique references ss.care_commands(command_id),
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (catalog_identity_id, contract_kind)
    references ss.care_catalog_identities(id, contract_kind),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, acceptance_reference_id),
  check (created_at = recorded_at)
);

create function ss.guard_care_customer_contract()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op <> 'INSERT'
    or not ss.care_actor_is_authorized(new.organization_id)
    or not exists (
      select 1
        from ss.care_commands command
       where command.command_id = new.opening_command_id
         and command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.action = 'contract_register'
         and command.resource_kind = 'contract'
         and command.resource_id = new.id
         and command.recorded_at = new.recorded_at
    )
    or not exists (
      select 1
        from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.customer_user_id
         and membership.state = 'active'
         and membership.role in ('owner', 'admin')
    )
  then
    raise exception 'Care contract lacks exact held customer identity'
      using errcode = '42501';
  end if;

  if new.contract_kind in ('rescue', 'custom_care', 'outside_management')
    and not exists (
      select 1
        from ss.service_project_profiles profile
       where profile.organization_id = new.organization_id
         and profile.project_id = new.project_id
         and profile.customer_user_id = new.customer_user_id
         and (
           new.contract_kind = 'rescue'
           or (new.contract_kind = 'custom_care'
             and profile.origin = 'sitesourcery_custom')
           or (new.contract_kind = 'outside_management'
             and profile.origin = 'external')
         )
    )
  then
    raise exception 'Care contract kind does not match the canonical site origin'
      using errcode = '23514';
  end if;

  if new.contract_kind = 'alakazam_care'
    and not exists (
      select 1
        from ss.alakazam_subscriptions subscription
       where subscription.organization_id = new.organization_id
         and subscription.project_id = new.project_id
         and subscription.customer_user_id = new.customer_user_id
    )
  then
    raise exception 'Alakazam Care lacks its exact subscription identity'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger care_customer_contracts_guard
before insert or update or delete on ss.care_customer_contracts
for each row execute function ss.guard_care_customer_contract();

create table ss.care_periods (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  contract_id uuid not null,
  provider_scope_digest ss.sha256_hex not null,
  provider_period_key text not null
    check (
      char_length(provider_period_key) between 8 and 200
      and provider_period_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    ),
  starts_on date not null,
  ends_on date not null,
  included_units integer not null check (included_units between 1 and 100),
  carried_units integer not null check (carried_units between 0 and 100),
  carried_from_period_id uuid,
  state text not null check (state in ('open', 'closed')),
  authority_state text not null check (authority_state = 'held'),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  revision bigint not null check (revision > 0),
  opening_command_id text not null unique references ss.care_commands(command_id),
  latest_command_id text not null references ss.care_commands(command_id),
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id, contract_id)
    references ss.care_customer_contracts(organization_id, project_id, id),
  foreign key (organization_id, carried_from_period_id)
    references ss.care_periods(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, provider_period_key),
  unique (
    organization_id, project_id, provider_scope_digest, starts_on, ends_on
  ),
  check (ends_on = (starts_on + interval '1 month')::date),
  check ((carried_units = 0) = (carried_from_period_id is null)),
  check (
    (state = 'open' and closed_at is null)
    or (state = 'closed' and closed_at is not null)
  )
);

create function ss.guard_care_period()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  command_record record;
  prior_period record;
  used_prior_included integer;
begin
  if not ss.care_actor_is_authorized(coalesce(new.organization_id, old.organization_id))
  then
    raise exception 'Care period lacks exact held actor authority'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Care periods are durable'
      using errcode = '55000';
  end if;

  select command.* into command_record
    from ss.care_commands command
   where command.command_id = new.latest_command_id;
  if command_record.organization_id is distinct from new.organization_id
    or command_record.project_id is distinct from new.project_id
    or command_record.resource_kind <> 'period'
    or command_record.resource_id is distinct from new.id
  then
    raise exception 'Care period command identity is invalid'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'open'
      or new.revision <> 1
      or new.opening_command_id <> new.latest_command_id
      or command_record.action <> 'period_open'
      or command_record.recorded_at <> new.opened_at
      or new.created_at <> new.opened_at
      or new.updated_at <> new.opened_at
      or not exists (
        select 1
          from ss.care_customer_contracts contract
         where contract.organization_id = new.organization_id
           and contract.project_id = new.project_id
           and contract.id = new.contract_id
           and contract.provider_scope_digest = new.provider_scope_digest
           and contract.authority_state = 'held'
           and not contract.customer_effects_authorized
           and not contract.payment_effects_authorized
           and not contract.provider_effects_authorized
      )
    then
      raise exception 'Care period lacks one exact held contract'
        using errcode = '23514';
    end if;

    if new.carried_from_period_id is not null then
      select period.* into prior_period
        from ss.care_periods period
       where period.id = new.carried_from_period_id
       for update;
      select coalesce(sum(entry.units), 0)::integer
        into used_prior_included
        from ss.care_capacity_entries entry
       where entry.period_id = prior_period.id
         and entry.capacity_source = 'included';
      if prior_period.id is null
        or prior_period.organization_id <> new.organization_id
        or prior_period.project_id <> new.project_id
        or prior_period.contract_id <> new.contract_id
        or prior_period.provider_scope_digest <> new.provider_scope_digest
        or prior_period.state <> 'closed'
        or prior_period.ends_on <> new.starts_on
        or new.carried_units >
          greatest(prior_period.included_units - used_prior_included, 0)
      then
        raise exception 'Care rollover is outside the immediately prior included allowance'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.contract_id,
    new.provider_scope_digest, new.provider_period_key, new.starts_on,
    new.ends_on, new.included_units, new.carried_units,
    new.carried_from_period_id, new.authority_state,
    new.provider_effects_authorized, new.opening_command_id, new.opened_at,
    new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.contract_id,
    old.provider_scope_digest, old.provider_period_key, old.starts_on,
    old.ends_on, old.included_units, old.carried_units,
    old.carried_from_period_id, old.authority_state,
    old.provider_effects_authorized, old.opening_command_id, old.opened_at,
    old.created_at
  )
    or old.state <> 'open'
    or new.state <> 'closed'
    or new.revision <> old.revision + 1
    or command_record.action <> 'period_close'
    or new.closed_at <> command_record.recorded_at
    or new.updated_at <> command_record.recorded_at
  then
    raise exception 'Care period transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger care_periods_guard
before insert or update or delete on ss.care_periods
for each row execute function ss.guard_care_period();

create table ss.care_period_scope_claims (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  period_id uuid not null,
  coverage_key text not null
    check (coverage_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  scope_identity_digest ss.sha256_hex not null,
  claim_mode text not null check (claim_mode in ('primary', 'included')),
  included_by_claim_id uuid,
  command_id text not null unique references ss.care_commands(command_id),
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  foreign key (organization_id, included_by_claim_id)
    references ss.care_period_scope_claims(organization_id, id),
  unique (organization_id, id),
  unique (period_id, coverage_key, scope_identity_digest, claim_mode),
  check ((claim_mode = 'included') = (included_by_claim_id is not null)),
  check (created_at = recorded_at)
);

-- Copy the exact period identity into the claim so concurrent primary claims
-- collide at the unique index without relying on an application precheck.
alter table ss.care_period_scope_claims
  add column period_starts_on date not null,
  add column period_ends_on date not null;
create unique index care_period_scope_one_primary
  on ss.care_period_scope_claims(
    organization_id, project_id, period_starts_on, period_ends_on,
    coverage_key, scope_identity_digest
  ) where claim_mode = 'primary';

create function ss.guard_care_period_scope_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  period_record record;
begin
  if tg_op <> 'INSERT'
    or not ss.care_actor_is_authorized(new.organization_id)
    or not exists (
      select 1
        from ss.care_commands command
       where command.command_id = new.command_id
         and command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.action = 'scope_claim'
         and command.resource_kind = 'scope_claim'
         and command.resource_id = new.id
         and command.recorded_at = new.recorded_at
    )
  then
    raise exception 'Care scope claim lacks exact held authority'
      using errcode = '42501';
  end if;
  select period.* into period_record
    from ss.care_periods period
   where period.id = new.period_id
   for update;
  if period_record.organization_id is distinct from new.organization_id
    or period_record.project_id is distinct from new.project_id
    or period_record.state <> 'open'
    or new.period_starts_on <> period_record.starts_on
    or new.period_ends_on <> period_record.ends_on
  then
    raise exception 'Care scope claim period is unavailable'
      using errcode = '23514';
  end if;
  if new.claim_mode = 'included' and not exists (
    select 1
      from ss.care_period_scope_claims primary_claim
     where primary_claim.id = new.included_by_claim_id
       and primary_claim.organization_id = new.organization_id
       and primary_claim.project_id = new.project_id
       and primary_claim.period_starts_on = new.period_starts_on
       and primary_claim.period_ends_on = new.period_ends_on
       and primary_claim.coverage_key = new.coverage_key
       and primary_claim.scope_identity_digest = new.scope_identity_digest
       and primary_claim.claim_mode = 'primary'
  ) then
    raise exception 'Included Care scope lacks its exact primary claim'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger care_period_scope_claims_guard
before insert or update or delete on ss.care_period_scope_claims
for each row execute function ss.guard_care_period_scope_claim();

create table ss.care_tickets (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  contract_id uuid not null,
  period_id uuid not null,
  support_ticket_id uuid not null,
  basis_kind text not null
    check (
      basis_kind in (
        'assessment_finding', 'customer_request', 'monitoring_incident',
        'rescue_scope'
      )
    ),
  basis_reference_id uuid,
  basis_digest ss.sha256_hex not null,
  work_scope_digest ss.sha256_hex not null,
  state text not null
    check (state in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  revision bigint not null check (revision > 0),
  opening_command_id text not null unique references ss.care_commands(command_id),
  latest_command_id text not null references ss.care_commands(command_id),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  mail_effects_authorized boolean not null check (not mail_effects_authorized),
  opened_at timestamptz not null,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, project_id, contract_id)
    references ss.care_customer_contracts(organization_id, project_id, id),
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  foreign key (organization_id, support_ticket_id)
    references ss.support_tickets(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, support_ticket_id),
  unique (period_id, work_scope_digest),
  check ((basis_kind = 'assessment_finding') = (basis_reference_id is not null)),
  check ((state in ('resolved', 'closed')) = (resolved_at is not null)),
  check ((state = 'closed') = (closed_at is not null))
);

create function ss.guard_care_ticket()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  command_record record;
  allowed boolean;
begin
  if not ss.care_actor_is_authorized(coalesce(new.organization_id, old.organization_id))
  then
    raise exception 'Care ticket lacks exact held actor authority'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Care tickets are durable'
      using errcode = '55000';
  end if;
  select command.* into command_record
    from ss.care_commands command
   where command.command_id = new.latest_command_id;
  if command_record.organization_id is distinct from new.organization_id
    or command_record.project_id is distinct from new.project_id
    or command_record.resource_kind <> 'ticket'
    or command_record.resource_id is distinct from new.id
  then
    raise exception 'Care ticket command identity is invalid'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'open'
      or new.revision <> 1
      or new.opening_command_id <> new.latest_command_id
      or command_record.action <> 'ticket_open'
      or command_record.recorded_at <> new.opened_at
      or new.created_at <> new.opened_at
      or new.updated_at <> new.opened_at
      or not exists (
        select 1
          from ss.care_periods period
          join ss.care_customer_contracts contract
            on contract.organization_id = period.organization_id
           and contract.project_id = period.project_id
           and contract.id = period.contract_id
          join ss.support_tickets support
            on support.organization_id = period.organization_id
           and support.project_id = period.project_id
           and support.id = new.support_ticket_id
         where period.organization_id = new.organization_id
           and period.project_id = new.project_id
           and period.id = new.period_id
           and period.contract_id = new.contract_id
           and period.state = 'open'
      )
    then
      raise exception 'Care ticket lacks one exact contract, period, and support identity'
        using errcode = '23514';
    end if;
    if new.basis_kind = 'assessment_finding' and not exists (
      select 1
        from ss.service_assessment_report_findings finding
        join ss.service_assessment_reports report
          on report.organization_id = finding.organization_id
         and report.job_id = finding.job_id
         and report.id = finding.report_id
        join ss.service_assessment_jobs job
          on job.organization_id = report.organization_id
         and job.id = report.job_id
       where finding.organization_id = new.organization_id
         and finding.finding_id = new.basis_reference_id
         and finding.finding_digest = new.basis_digest
         and job.project_id = new.project_id
    ) then
      raise exception 'Care ticket assessment basis is not authoritative'
        using errcode = '23514';
    end if;
    return new;
  end if;

  allowed :=
    (old.state = 'open' and command_record.action in ('ticket_start', 'ticket_wait', 'ticket_close'))
    or (old.state = 'in_progress' and command_record.action in ('ticket_wait', 'ticket_resolve'))
    or (old.state = 'waiting_customer' and command_record.action in ('ticket_resume', 'ticket_resolve'))
    or (old.state = 'resolved' and command_record.action in ('ticket_reopen', 'ticket_close'));
  if not allowed
    or new.revision <> old.revision + 1
    or row(
      new.id, new.organization_id, new.project_id, new.contract_id,
      new.period_id, new.support_ticket_id, new.basis_kind,
      new.basis_reference_id, new.basis_digest, new.work_scope_digest,
      new.opening_command_id, new.provider_effects_authorized,
      new.mail_effects_authorized, new.opened_at, new.created_at
    ) is distinct from row(
      old.id, old.organization_id, old.project_id, old.contract_id,
      old.period_id, old.support_ticket_id, old.basis_kind,
      old.basis_reference_id, old.basis_digest, old.work_scope_digest,
      old.opening_command_id, old.provider_effects_authorized,
      old.mail_effects_authorized, old.opened_at, old.created_at
    )
    or new.state <> (case command_record.action
      when 'ticket_start' then 'in_progress'
      when 'ticket_wait' then 'waiting_customer'
      when 'ticket_resume' then 'in_progress'
      when 'ticket_resolve' then 'resolved'
      when 'ticket_reopen' then 'in_progress'
      when 'ticket_close' then 'closed'
      else null
    end)
    or new.updated_at <> command_record.recorded_at
  then
    raise exception 'Care ticket lifecycle transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger care_tickets_guard
before insert or update or delete on ss.care_tickets
for each row execute function ss.guard_care_ticket();

create table ss.care_capacity_entries (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  period_id uuid not null,
  ticket_id uuid not null,
  capacity_source text not null check (capacity_source in ('carried', 'included')),
  units integer not null check (units between 1 and 100),
  command_id text not null unique references ss.care_commands(command_id),
  payment_effects_authorized boolean not null check (not payment_effects_authorized),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  foreign key (organization_id, project_id, ticket_id)
    references ss.care_tickets(organization_id, project_id, id),
  unique (organization_id, id),
  unique (ticket_id, command_id),
  check (created_at = recorded_at)
);

create function ss.guard_care_capacity_entry()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  period_record record;
  used_carried integer;
  used_included integer;
begin
  if tg_op <> 'INSERT'
    or not ss.care_actor_is_authorized(new.organization_id)
    or not exists (
      select 1
        from ss.care_commands command
       where command.command_id = new.command_id
         and command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.action = 'capacity_allocate'
         and command.resource_kind = 'capacity'
         and command.resource_id = new.id
         and command.recorded_at = new.recorded_at
    )
  then
    raise exception 'Care capacity entry lacks exact held authority'
      using errcode = '42501';
  end if;
  select period.* into period_record
    from ss.care_periods period
   where period.id = new.period_id
   for update;
  if period_record.organization_id is distinct from new.organization_id
    or period_record.project_id is distinct from new.project_id
    or period_record.state <> 'open'
    or not exists (
      select 1
        from ss.care_tickets ticket
       where ticket.organization_id = new.organization_id
         and ticket.project_id = new.project_id
         and ticket.id = new.ticket_id
         and ticket.period_id = new.period_id
         and ticket.state in ('open', 'in_progress', 'waiting_customer')
    )
  then
    raise exception 'Care capacity target is unavailable'
      using errcode = '23514';
  end if;
  select
    coalesce(sum(entry.units) filter (
      where entry.capacity_source = 'carried'
    ), 0)::integer,
    coalesce(sum(entry.units) filter (
      where entry.capacity_source = 'included'
    ), 0)::integer
    into used_carried, used_included
    from ss.care_capacity_entries entry
   where entry.period_id = new.period_id;
  if (
    new.capacity_source = 'carried'
    and used_carried + new.units > period_record.carried_units
  ) or (
    new.capacity_source = 'included'
    and (
      used_carried <> period_record.carried_units
      or used_included + new.units > period_record.included_units
    )
  ) then
    raise exception 'Care capacity allocation exceeds its exact allowance'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger care_capacity_entries_guard
before insert or update or delete on ss.care_capacity_entries
for each row execute function ss.guard_care_capacity_entry();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'care_catalog_identities',
    'care_commands',
    'care_customer_contracts',
    'care_periods',
    'care_period_scope_claims',
    'care_tickets',
    'care_capacity_entries'
  ]
  loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;
end
$$;

grant select on
  ss.care_catalog_identities,
  ss.care_commands,
  ss.care_customer_contracts,
  ss.care_periods,
  ss.care_period_scope_claims,
  ss.care_tickets,
  ss.care_capacity_entries
to service_role;

grant insert on
  ss.care_commands,
  ss.care_customer_contracts,
  ss.care_periods,
  ss.care_period_scope_claims,
  ss.care_tickets,
  ss.care_capacity_entries
to service_role;

grant update on ss.care_periods, ss.care_tickets to service_role;

revoke all on function ss.care_actor_is_authorized(uuid)
from public, anon, authenticated, service_role;
grant execute on function ss.care_actor_is_authorized(uuid)
to service_role;
revoke all on function ss.guard_care_command()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_care_customer_contract()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_care_period()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_care_period_scope_claim()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_care_ticket()
from public, anon, authenticated, service_role;
revoke all on function ss.guard_care_capacity_entry()
from public, anon, authenticated, service_role;

create function ss.hosted_care_core_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-care-core-v1-held-catalog-contract-period-capacity-ticket'::text
$$;

revoke all on function ss.hosted_care_core_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_care_core_contract_v1()
to service_role;

commit;
