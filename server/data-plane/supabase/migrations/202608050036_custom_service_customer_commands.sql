begin;

-- Customer commands serialize on one current assessment case. Historical
-- withdrawn cases remain retained, but a site cannot carry competing draft or
-- submitted authority.
create unique index service_cases_one_current_assessment
  on ss.service_cases(
    organization_id,
    project_id,
    customer_user_id
  )
  where state in ('draft', 'submitted');

-- A title-only case is not a resumable customer draft. Retain one typed draft
-- with the same bounded vocabulary as the immutable submitted intake. The
-- customer may save it before affirming ownership; submission later requires
-- that final affirmation and copies these exact facts into service_intakes.
create table ss.service_intake_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  created_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  revision bigint not null default 1 check (revision > 0),
  site_display_name text not null
    check (
      char_length(site_display_name) between 2 and 120
      and ss.service_text_excludes_credentials(site_display_name)
    ),
  public_scheme text not null check (public_scheme in ('http', 'https')),
  public_hostname ss.canonical_hostname not null,
  business_name text
    check (
      business_name is null
      or (
        char_length(business_name) between 2 and 120
        and ss.service_text_excludes_credentials(business_name)
      )
    ),
  primary_goal text not null
    check (
      char_length(primary_goal) between 2 and 500
      and ss.service_text_excludes_credentials(primary_goal)
    ),
  customer_observation text
    check (
      customer_observation is null
      or (
        char_length(customer_observation) between 2 and 1000
        and ss.service_text_excludes_credentials(customer_observation)
      )
    ),
  platform_family text
    check (
      platform_family is null
      or (
        char_length(platform_family) between 2 and 40
        and platform_family ~ '^[a-z][a-z0-9_]*$'
      )
    ),
  approximate_public_size text not null
    check (
      approximate_public_size in (
        'one_to_ten',
        'eleven_to_fifty',
        'more_than_fifty',
        'application_or_unknown'
      )
    ),
  complexity_flags text[] not null default array[]::text[]
    check (ss.service_complexity_flags_are_canonical(complexity_flags)),
  important_date date,
  customer_ownership_affirmed boolean not null default false,
  facts_digest ss.sha256_hex generated always as (
    ss.service_intake_facts_digest(
      revision,
      site_display_name,
      public_scheme,
      public_hostname,
      business_name,
      primary_goal,
      customer_observation,
      platform_family,
      approximate_public_size,
      complexity_flags,
      important_date,
      customer_ownership_affirmed
    )
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (
    organization_id,
    project_id,
    customer_user_id,
    case_id
  ) references ss.service_cases(
    organization_id,
    project_id,
    customer_user_id,
    id
  ),
  unique (organization_id, id),
  unique (case_id)
);

create function ss.guard_service_intake_draft_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.revision <> 1
    or not exists (
      select 1
        from ss.service_cases service_case
       where service_case.organization_id = new.organization_id
         and service_case.project_id = new.project_id
         and service_case.customer_user_id = new.customer_user_id
         and service_case.id = new.case_id
         and service_case.state = 'draft'
    )
  then
    raise exception 'service intake draft requires one current draft case'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_intake_drafts_insert_guard
before insert on ss.service_intake_drafts
for each row execute function ss.guard_service_intake_draft_insert();

create function ss.bump_service_intake_draft_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.created_by_user_id,
    new.source,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.created_by_user_id,
    old.source,
    old.created_at
  ) then
    raise exception 'service intake draft identity is immutable'
      using errcode = '55000';
  end if;
  if new.revision <> old.revision then
    raise exception 'service intake draft revision is managed by the database'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
      from ss.service_cases service_case
     where service_case.organization_id = old.organization_id
       and service_case.project_id = old.project_id
       and service_case.customer_user_id = old.customer_user_id
       and service_case.id = old.case_id
       and service_case.state = 'draft'
  ) then
    raise exception 'service intake draft is immutable after submission or withdrawal'
      using errcode = '55000';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_intake_drafts_revision
before update on ss.service_intake_drafts
for each row execute function ss.bump_service_intake_draft_revision();

create trigger service_intake_drafts_account_authority
after insert or update on ss.service_intake_drafts
for each row execute function ss.validate_service_account_authority();

-- Withdrawal is one atomic commercial boundary: a withdrawn case cannot leave
-- a requested offering behind, and a requested offering cannot be restored on
-- a withdrawn case. The deferred checks let the service update both retained
-- rows in either order inside one transaction.
create function ss.validate_service_case_offering_terminal_state()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_case_id uuid;
begin
  selected_case_id := coalesce(
    nullif(to_jsonb(new) ->> 'case_id', '')::uuid,
    nullif(to_jsonb(new) ->> 'id', '')::uuid
  );

  if exists (
    select 1
      from ss.service_cases service_case
      join ss.service_case_offerings offering
        on offering.organization_id = service_case.organization_id
       and offering.project_id = service_case.project_id
       and offering.case_id = service_case.id
       and offering.customer_user_id = service_case.customer_user_id
     where service_case.id = selected_case_id
       and service_case.state = 'withdrawn'
       and offering.state = 'requested'
  ) then
    raise exception 'withdrawn service case retains a requested offering'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from ss.service_quotes quote
      join ss.service_quote_acceptances acceptance
        on acceptance.organization_id = quote.organization_id
       and acceptance.quote_id = quote.id
     where quote.case_id = selected_case_id
       and not exists (
         select 1
           from ss.service_cases service_case
           join ss.service_case_offerings offering
             on offering.organization_id = service_case.organization_id
            and offering.project_id = service_case.project_id
            and offering.case_id = service_case.id
            and offering.customer_user_id = service_case.customer_user_id
          where service_case.id = quote.case_id
            and service_case.state = 'submitted'
            and offering.id = quote.offering_id
            and offering.state = 'requested'
       )
  ) then
    raise exception 'accepted service quote keeps its submitted request retained'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger service_cases_offering_terminal_state
after insert or update on ss.service_cases
deferrable initially deferred
for each row execute function ss.validate_service_case_offering_terminal_state();

create constraint trigger service_case_offerings_terminal_state
after insert or update on ss.service_case_offerings
deferrable initially deferred
for each row execute function ss.validate_service_case_offering_terminal_state();

-- Acceptance remains an exact digest replay, but now also requires the current
-- case to remain submitted and its selected offering to remain requested.
-- Withdrawing a request therefore closes acceptance authority immediately.
create or replace function ss.prepare_service_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  revision_record record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.accepted_quote_digest;
  claimed_disclosure_digest ss.sha256_hex := new.accepted_disclosure_digest;
begin
  select quote.* into quote_record
    from ss.service_quotes quote
   where quote.id = new.quote_id
   for update;
  if not found then
    raise exception 'service quote acceptance target is missing'
      using errcode = '23514';
  end if;

  select revision.* into revision_record
    from ss.service_quote_revisions revision
   where revision.quote_id = quote_record.id
     and revision.quote_revision = quote_record.current_revision;
  if not found
    or revision_record.expires_at <= recorded_at
    or claimed_quote_digest is distinct from revision_record.quote_digest
    or claimed_disclosure_digest is distinct from revision_record.disclosure_digest
    or new.acceptance_statement <>
       'accepted_exact_quote_and_delivery_date'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from
       quote_record.customer_user_id
    or ss.current_service_actor_org_id() is distinct from
       quote_record.organization_id
    or not exists (
      select 1
        from ss.service_cases service_case
        join ss.service_case_offerings offering
          on offering.organization_id = service_case.organization_id
         and offering.project_id = service_case.project_id
         and offering.case_id = service_case.id
         and offering.customer_user_id = service_case.customer_user_id
       where service_case.organization_id = quote_record.organization_id
         and service_case.project_id = quote_record.project_id
         and service_case.id = quote_record.case_id
         and service_case.customer_user_id = quote_record.customer_user_id
         and service_case.state = 'submitted'
         and offering.id = quote_record.offering_id
         and offering.state = 'requested'
    )
    or not exists (
      select 1
        from ss.service_project_profiles profile
       where profile.organization_id = quote_record.organization_id
         and profile.project_id = quote_record.project_id
         and profile.customer_user_id = quote_record.customer_user_id
         and profile.revision = revision_record.project_profile_revision
    )
    or not exists (
      select 1
        from ss.service_intakes intake
       where intake.organization_id = quote_record.organization_id
         and intake.project_id = quote_record.project_id
         and intake.case_id = quote_record.case_id
         and intake.customer_user_id = quote_record.customer_user_id
         and intake.id = revision_record.intake_id
         and intake.revision = revision_record.intake_revision
         and intake.facts_digest = revision_record.intake_facts_digest
         and not exists (
           select 1
             from ss.service_intakes later_intake
            where later_intake.case_id = intake.case_id
              and later_intake.revision > intake.revision
         )
    )
    or not exists (
      select 1
        from ss.organization_memberships membership
       where membership.organization_id = quote_record.organization_id
         and membership.user_id = quote_record.customer_user_id
         and membership.state = 'active'
         and membership.role in ('owner', 'admin')
    )
  then
    raise exception 'service quote acceptance lacks exact current customer authority'
      using errcode = '42501';
  end if;

  new.organization_id := quote_record.organization_id;
  new.project_id := quote_record.project_id;
  new.case_id := quote_record.case_id;
  new.customer_user_id := quote_record.customer_user_id;
  new.quote_revision_id := revision_record.id;
  new.quote_revision := revision_record.quote_revision;
  new.accepted_by_user_id := quote_record.customer_user_id;
  new.source := 'account';
  new.accepted_quote_digest := revision_record.quote_digest;
  new.accepted_disclosure_digest := revision_record.disclosure_digest;
  new.legal_document_id := revision_record.legal_document_id;
  new.accepted_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

revoke all on function ss.validate_service_case_offering_terminal_state()
from public, anon, authenticated, service_role;
grant execute on function ss.validate_service_case_offering_terminal_state()
to service_role;

revoke all on function ss.prepare_service_quote_acceptance()
from public, anon, authenticated, service_role;
grant execute on function ss.prepare_service_quote_acceptance()
to service_role;

alter table ss.service_intake_drafts enable row level security;
alter table ss.service_intake_drafts force row level security;
revoke all on table ss.service_intake_drafts
from public, anon, authenticated, service_role;
grant select, insert, update on table ss.service_intake_drafts
to service_role;

revoke all on function ss.guard_service_intake_draft_insert()
from public, anon, authenticated, service_role;
grant execute on function ss.guard_service_intake_draft_insert()
to service_role;

revoke all on function ss.bump_service_intake_draft_revision()
from public, anon, authenticated, service_role;
grant execute on function ss.bump_service_intake_draft_revision()
to service_role;

do $$
begin
  if has_table_privilege(
    'service_role',
    'ss.service_intake_drafts',
    'DELETE'
  ) or has_table_privilege(
    'service_role',
    'ss.service_intake_drafts',
    'TRUNCATE'
  ) or has_table_privilege(
    'authenticated',
    'ss.service_intake_drafts',
    'SELECT'
  ) or has_table_privilege(
    'anon',
    'ss.service_intake_drafts',
    'SELECT'
  ) then
    raise exception 'service intake draft privilege boundary is unsafe'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v36()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v36-custom-service-customer-commands'::text
$$;

revoke all on function ss.hosted_runtime_contract_v36()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v36()
to authenticated, service_role;

commit;
