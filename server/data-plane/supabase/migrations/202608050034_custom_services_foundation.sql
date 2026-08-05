begin;

do $$
begin
  if to_regclass('ss.projects') is null
    or to_regclass('ss.hosted_account_profiles') is null
    or to_regclass('ss.organization_memberships') is null
    or to_regprocedure('ss.hosted_runtime_contract_v33()') is null
  then
    raise exception
      'Site Sourcery migration 033 must be applied before the custom-services foundation'
      using errcode = '55000';
  end if;
end
$$;

-- Custom-service and outside-management terms are separate from the
-- self-service website terms. Migration 034 only makes those document kinds
-- legal; later commercial slices bind customer acceptances to payable work.
alter table ss.legal_documents
  drop constraint legal_documents_kind_check;

alter table ss.legal_documents
  add constraint legal_documents_kind_check
  check (
    kind in (
      'product',
      'privacy',
      'website',
      'domain_agent',
      'domain_renewal',
      'custom_services',
      'outside_management'
    )
  ) not valid;

alter table ss.legal_documents
  validate constraint legal_documents_kind_check;

-- service_role bypasses RLS, so every customer-scoped write must carry an
-- exact transaction-local actor. The repository sets these values only for a
-- customer service transaction; missing or mismatched context rejects writes.
create function ss.current_service_actor_kind()
returns text
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.service_actor_kind', true), '')
$$;

create function ss.current_service_actor_user_id()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(
    current_setting('app.service_actor_user_id', true),
    ''
  )::uuid
$$;

create function ss.current_service_actor_org_id()
returns uuid
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(
    current_setting('app.service_actor_organization_id', true),
    ''
  )::uuid
$$;

-- These checks reject recognizable credential material and credentialed URLs.
-- They are defense in depth, not a claim that arbitrary prose can be proven
-- secret-free. Customer intake therefore uses bounded typed fields, not JSON.
create function ss.service_text_excludes_credentials(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    value is not null
    and value !~ '[[:cntrl:]]'
    and value !~*
      '(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase)'
    and value !~ '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    and value !~ '(sk|rk)_(live|test)_[A-Za-z0-9_-]{8,}'
    and value !~ 'gh[pousr]_[A-Za-z0-9]{20,}'
    and value !~
      'eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}'
    and value !~*
      '[a-z][a-z0-9+.-]*://[^[:space:]/:@]+:[^[:space:]@/]+@'
$$;

create function ss.service_reference_is_safe(value text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select
    char_length(value) between 1 and 254
    and ss.service_text_excludes_credentials(value)
$$;

create function ss.service_json_digest(value jsonb)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, extensions, ss
as $$
  select encode(
    extensions.digest(convert_to(value::text, 'UTF8'), 'sha256'),
    'hex'
  )::ss.sha256_hex
$$;

create table ss.service_catalog_policies (
  id uuid primary key,
  catalog_version text not null
    check (char_length(catalog_version) between 3 and 120),
  service_key text not null
    check (
      char_length(service_key) between 3 and 80
      and service_key ~ '^[a-z][a-z0-9_]*$'
    ),
  display_name text not null
    check (char_length(display_name) between 2 and 120),
  pricing_mode text not null
    check (
      pricing_mode in (
        'fixed',
        'from',
        'unit',
        'banded',
        'percentage',
        'custom_quote'
      )
    ),
  billing_cadence text not null
    check (billing_cadence in ('one_time', 'month', 'custom')),
  currency text not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),
  unit_amount_minor bigint check (unit_amount_minor >= 0),
  minimum_amount_minor bigint check (minimum_amount_minor >= 0),
  unit_label text
    check (unit_label is null or char_length(unit_label) between 1 and 80),
  minimum_quantity integer not null default 1
    check (minimum_quantity between 1 and 10000),
  maximum_quantity integer
    check (maximum_quantity is null or maximum_quantity between 1 and 10000),
  generic_plan_id uuid references ss.catalog_plans(id),
  generic_price_id uuid references ss.catalog_prices(id),
  scope_boundary jsonb not null
    check (
      jsonb_typeof(scope_boundary) = 'object'
      and octet_length(scope_boundary::text) <= 32768
    ),
  scope_boundary_digest ss.sha256_hex generated always as (
    ss.service_json_digest(scope_boundary)
  ) stored,
  legal_document_id uuid not null references ss.legal_documents(id),
  commercial_contract_id text not null
    check (char_length(commercial_contract_id) between 3 and 120),
  commercial_contract_digest ss.sha256_hex not null,
  publication_state text not null default 'held'
    check (publication_state = 'held'),
  active_from timestamptz not null,
  active_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (catalog_version, service_key),
  unique (id, service_key),
  unique (id, scope_boundary_digest),
  check (
    (pricing_mode in ('fixed', 'unit') and unit_amount_minor is not null)
    or (pricing_mode = 'from' and minimum_amount_minor is not null)
    or pricing_mode in ('banded', 'percentage', 'custom_quote')
  ),
  check (pricing_mode in ('fixed', 'unit') or unit_amount_minor is null),
  check (pricing_mode = 'from' or minimum_amount_minor is null),
  check (
    maximum_quantity is null
    or maximum_quantity >= minimum_quantity
  ),
  check (
    (generic_plan_id is null and generic_price_id is null)
    or (generic_plan_id is not null and generic_price_id is not null)
  ),
  check (active_until is null or active_until >= active_from)
);

create table ss.service_catalog_coverage (
  id uuid primary key default extensions.gen_random_uuid(),
  policy_id uuid not null,
  coverage_key text not null
    check (
      char_length(coverage_key) between 3 and 80
      and coverage_key ~ '^[a-z][a-z0-9_]*$'
    ),
  coverage_mode text not null
    check (coverage_mode in ('includes', 'requires', 'excludes')),
  scope_identity_kind text not null
    check (
      scope_identity_kind in (
        'project',
        'hostname',
        'page_set',
        'domain',
        'mailbox_set',
        'provider_account',
        'location'
      )
    ),
  boundary_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (policy_id, boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (policy_id, coverage_key, scope_identity_kind)
);

create function ss.validate_service_catalog_policy()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.legal_documents document
     where document.id = new.legal_document_id
       and document.kind = 'custom_services'
       and document.version = new.commercial_contract_id
       and document.content_digest = new.commercial_contract_digest
       and document.retired_at is null
  ) then
    raise exception
      'service catalog policy lacks exact immutable legal authority'
      using errcode = '23514';
  end if;

  if new.generic_plan_id is not null
    and not exists (
      select 1
        from ss.catalog_prices price
       where price.id = new.generic_price_id
         and price.plan_id = new.generic_plan_id
         and price.currency = new.currency
         and (
           new.unit_amount_minor is null
           or price.unit_amount_minor = new.unit_amount_minor
         )
         and (
           (new.billing_cadence = 'one_time' and price.cadence = 'one_time')
           or (new.billing_cadence = 'month' and price.cadence = 'month')
         )
    )
  then
    raise exception
      'service catalog policy does not match its generic plan and price'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_catalog_policies_validate
after insert on ss.service_catalog_policies
for each row execute function ss.validate_service_catalog_policy();

create trigger service_catalog_policies_immutable
before update or delete on ss.service_catalog_policies
for each row execute function ss.reject_update();

create trigger service_catalog_coverage_immutable
before update or delete on ss.service_catalog_coverage
for each row execute function ss.reject_update();

-- The first policy is exact but held. It cannot become payable or public until
-- quote, invoice, settlement, report delivery, and credit authority exist.
insert into ss.legal_documents (
  id,
  kind,
  version,
  content_digest,
  content_uri,
  effective_at
) values (
  '00000000-0000-4000-8000-000000000342',
  'custom_services',
  'SS-CUSTOM-SERVICES-2026-08-05.1',
  '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8',
  'urn:sitesourcery:custom-services:2026-08-05.1',
  '2026-08-05T00:00:00Z'
) on conflict (kind, version) do nothing;

do $$
begin
  if not exists (
    select 1
      from ss.legal_documents
     where id = '00000000-0000-4000-8000-000000000342'
       and kind = 'custom_services'
       and version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
       and content_digest =
         '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
       and content_uri =
         'urn:sitesourcery:custom-services:2026-08-05.1'
       and retired_at is null
  ) then
    raise exception 'custom-service legal authority does not match migration 034'
      using errcode = '55000';
  end if;
end
$$;

insert into ss.service_catalog_policies (
  id,
  catalog_version,
  service_key,
  display_name,
  pricing_mode,
  billing_cadence,
  currency,
  unit_amount_minor,
  unit_label,
  minimum_quantity,
  maximum_quantity,
  scope_boundary,
  legal_document_id,
  commercial_contract_id,
  commercial_contract_digest,
  publication_state,
  active_from
)
select
  '00000000-0000-4000-8000-000000000341',
  'SS-PROFESSIONAL-2026.1',
  'website_assessment_standard',
  'Website assessment',
  'fixed',
  'one_time',
  'USD',
  20000,
  'assessment',
  1,
  1,
  jsonb_build_object(
    'expandedAssessmentState', 'separately_quoted',
    'maximumFindings', 10,
    'maximumRepresentativePagesOrTypes', 5,
    'maximumWebsites', 1,
    'requiredViewports', jsonb_build_array('desktop', 'phone')
  ),
  document.id,
  document.version,
  document.content_digest,
  'held',
  '2026-08-05T00:00:00Z'
from ss.legal_documents document
where document.id = '00000000-0000-4000-8000-000000000342';

insert into ss.service_catalog_coverage (
  policy_id,
  coverage_key,
  coverage_mode,
  scope_identity_kind,
  boundary_digest
)
select
  policy.id,
  coverage.coverage_key,
  'includes',
  coverage.scope_identity_kind,
  policy.scope_boundary_digest
from ss.service_catalog_policies policy
cross join (
  values
    ('public_site_inventory', 'project'),
    ('representative_page_review', 'page_set'),
    ('responsive_viewport_review', 'page_set'),
    ('written_assessment_report', 'project')
) as coverage(coverage_key, scope_identity_kind)
where policy.id = '00000000-0000-4000-8000-000000000341';

create table ss.service_project_profiles (
  organization_id uuid not null,
  project_id uuid primary key,
  customer_user_id uuid not null references auth.users(id),
  origin text not null
    check (origin in ('sitesourcery_custom', 'external')),
  observed_hostname ss.canonical_hostname,
  observed_at timestamptz,
  platform_family text not null default 'unknown'
    check (
      char_length(platform_family) between 2 and 40
      and platform_family ~ '^[a-z][a-z0-9_]*$'
    ),
  ownership_state text not null default 'customer_stated'
    check (ownership_state = 'customer_stated'),
  takeover_required boolean not null,
  takeover_state text not null
    check (takeover_state in ('not_required', 'review_required')),
  supportability_state text not null
    check (supportability_state in ('not_applicable', 'not_reviewed')),
  delegated_access_state text not null default 'not_requested'
    check (delegated_access_state = 'not_requested'),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, project_id),
  check (
    (observed_hostname is null and observed_at is null)
    or (observed_hostname is not null and observed_at is not null)
  ),
  check (
    (origin = 'external'
      and takeover_required
      and takeover_state = 'review_required'
      and supportability_state = 'not_reviewed')
    or (origin = 'sitesourcery_custom'
      and not takeover_required
      and takeover_state = 'not_required'
      and supportability_state = 'not_applicable')
  )
);

create function ss.bump_service_project_profile_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.origin,
    new.created_at
  ) is distinct from row(
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.origin,
    old.created_at
  ) then
    raise exception 'service project profile identity is immutable'
      using errcode = '55000';
  end if;
  if new.revision <> old.revision then
    raise exception 'service project profile revision is managed by the database'
      using errcode = '55000';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_project_profiles_revision
before update on ss.service_project_profiles
for each row execute function ss.bump_service_project_profile_revision();

-- Operator authority is deliberately inert in migration 034. No active state
-- exists and service_role receives no mutation privilege. A later reviewed
-- migration must define activation and permission evidence before operator use.
create table ss.operator_profiles (
  user_id uuid primary key references auth.users(id),
  display_label text not null
    check (char_length(display_label) between 1 and 100),
  state text not null default 'held' check (state = 'held'),
  authorized_by_user_id uuid not null references auth.users(id),
  authorized_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (revoked_at is null)
);

create trigger operator_profiles_immutable
before update or delete on ss.operator_profiles
for each row execute function ss.reject_update();

create table ss.operator_permissions (
  operator_user_id uuid not null references ss.operator_profiles(user_id),
  capability text not null
    check (
      capability in (
        'service_case_manage',
        'service_quote_author',
        'service_invoice_manage',
        'service_payment_reconcile',
        'service_job_manage',
        'service_access_verify',
        'service_management_manage',
        'service_document_manage',
        'service_catalog_manage'
      )
    ),
  state text not null default 'held' check (state = 'held'),
  granted_by_user_id uuid not null references auth.users(id),
  granted_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  primary key (operator_user_id, capability),
  check (revoked_at is null)
);

create trigger operator_permissions_immutable
before update or delete on ss.operator_permissions
for each row execute function ss.reject_update();

create table ss.service_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  created_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  state text not null default 'draft'
    check (state in ('draft', 'submitted', 'withdrawn')),
  title text not null
    check (
      char_length(title) between 2 and 160
      and ss.service_text_excludes_credentials(title)
    ),
  withdrawn_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.service_project_profiles(organization_id, project_id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, project_id, customer_user_id, id),
  check (
    (state = 'withdrawn' and withdrawn_at is not null)
    or (state <> 'withdrawn' and withdrawn_at is null)
  )
);

create index service_cases_customer_recent
  on ss.service_cases(
    organization_id,
    customer_user_id,
    updated_at desc
  );

create function ss.guard_service_case_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.state <> 'draft'
    or new.withdrawn_at is not null
    or new.revision <> 1
  then
    raise exception 'new service case must begin as a database-managed draft'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_cases_insert_guard
before insert on ss.service_cases
for each row execute function ss.guard_service_case_insert();

create function ss.bump_service_case_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.created_by_user_id,
    new.source,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.created_by_user_id,
    old.source,
    old.created_at
  ) then
    raise exception 'service case identity is immutable'
      using errcode = '55000';
  end if;
  if new.revision <> old.revision then
    raise exception 'service case revision is managed by the database'
      using errcode = '55000';
  end if;
  if old.state = 'withdrawn' then
    raise exception 'withdrawn service case is terminal'
      using errcode = '23514';
  end if;
  if new.state <> old.state
    and not (
      (old.state = 'draft' and new.state in ('submitted', 'withdrawn'))
      or (old.state = 'submitted' and new.state = 'withdrawn')
    )
  then
    raise exception 'service case pre-commerce transition is invalid'
      using errcode = '23514';
  end if;
  if old.state = 'submitted'
    and new.state = 'submitted'
    and new.title is distinct from old.title
  then
    raise exception 'submitted service case content is immutable'
      using errcode = '55000';
  end if;
  if new.state = 'withdrawn' and old.state <> 'withdrawn' then
    new.withdrawn_at := clock_timestamp();
  else
    new.withdrawn_at := null;
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_cases_revision
before update on ss.service_cases
for each row execute function ss.bump_service_case_revision();

create function ss.validate_service_account_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  new_record jsonb;
  authority_user_id uuid;
  authority_creator_user_id uuid;
  authority_requester_user_id uuid;
  authority_source text;
begin
  new_record := to_jsonb(new);
  authority_user_id := (new_record ->> 'customer_user_id')::uuid;
  authority_creator_user_id :=
    nullif(new_record ->> 'created_by_user_id', '')::uuid;
  authority_requester_user_id :=
    nullif(new_record ->> 'requested_by_user_id', '')::uuid;
  authority_source := coalesce(new_record ->> 'source', 'account');

  if ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from authority_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception
      'custom-service write is not bound to the exact customer transaction actor'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from ss.organizations organization
      join ss.projects project
        on project.organization_id = organization.id
       and project.id = new.project_id
      join ss.organization_memberships membership
        on membership.organization_id = organization.id
      join auth.users account_user
        on account_user.id = membership.user_id
      join ss.hosted_account_profiles account_profile
        on account_profile.user_id = account_user.id
     where organization.id = new.organization_id
       and organization.state = 'active'
       and project.lifecycle = 'active'
       and membership.user_id = authority_user_id
       and membership.state = 'active'
       and account_user.disabled_at is null
       and account_profile.state = 'active'
  ) then
    raise exception
      'custom-service authority requires an active first-party account and membership'
      using errcode = '23514';
  end if;

  if authority_source <> 'account'
    or (
      authority_creator_user_id is not null
      and authority_creator_user_id <> authority_user_id
    )
    or (
      authority_requester_user_id is not null
      and authority_requester_user_id <> authority_user_id
    )
  then
    raise exception
      'custom-service row actor fields do not match the customer transaction actor'
      using errcode = '42501';
  end if;

  return new;
end
$$;

create trigger service_project_profiles_account_authority
after insert or update on ss.service_project_profiles
for each row execute function ss.validate_service_account_authority();

create trigger service_cases_account_authority
after insert or update on ss.service_cases
for each row execute function ss.validate_service_account_authority();

create table ss.service_case_offerings (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  requested_by_user_id uuid not null references auth.users(id),
  policy_id uuid not null references ss.service_catalog_policies(id),
  state text not null default 'requested'
    check (state in ('requested', 'removed')),
  requested_at timestamptz not null default clock_timestamp(),
  removed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.service_project_profiles(organization_id, project_id),
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
  unique (case_id, policy_id),
  check (requested_by_user_id = customer_user_id),
  check (
    (state = 'removed' and removed_at is not null)
    or (state = 'requested' and removed_at is null)
  )
);

create function ss.guard_service_case_offering_insert()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.state <> 'requested' or new.removed_at is not null then
    raise exception 'new service offering must begin as requested'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_case_offerings_insert_guard
before insert on ss.service_case_offerings
for each row execute function ss.guard_service_case_offering_insert();

create function ss.guard_service_case_offering_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.requested_by_user_id,
    new.policy_id,
    new.requested_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.requested_by_user_id,
    old.policy_id,
    old.requested_at
  ) then
    raise exception 'service case offering identity is immutable'
      using errcode = '55000';
  end if;
  if old.state = 'removed' then
    raise exception 'removed service case offering is terminal'
      using errcode = '23514';
  end if;
  if new.state <> old.state and new.state <> 'removed' then
    raise exception 'service case offering transition is invalid'
      using errcode = '23514';
  end if;
  if new.state = 'removed' then
    new.removed_at := clock_timestamp();
  else
    new.removed_at := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_case_offerings_guard
before update on ss.service_case_offerings
for each row execute function ss.guard_service_case_offering_update();

create trigger service_case_offerings_account_authority
after insert or update on ss.service_case_offerings
for each row execute function ss.validate_service_account_authority();

create function ss.service_complexity_flags_are_canonical(value text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    value is not null
    and cardinality(value) between 0 and 8
    and value <@ array[
      'authenticated_area',
      'commerce',
      'forms',
      'large_content_set',
      'multilingual',
      'regulated_content',
      'third_party_integrations',
      'unknown_platform'
    ]::text[]
    and value = coalesce(
      (
        select array_agg(item order by item)
          from (select distinct unnest(value) as item) canonical
      ),
      array[]::text[]
    )
$$;

create function ss.service_intake_facts_digest(
  service_revision bigint,
  site_display_name text,
  public_scheme text,
  public_hostname ss.canonical_hostname,
  business_name text,
  primary_goal text,
  customer_observation text,
  platform_family text,
  approximate_public_size text,
  complexity_flags text[],
  important_date date,
  customer_ownership_affirmed boolean
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, extensions, ss
as $$
  select ss.service_json_digest(
    jsonb_build_object(
      'approximatePublicSize', approximate_public_size,
      'businessName', business_name,
      'complexityFlags', complexity_flags,
      'customerObservation', customer_observation,
      'customerOwnershipAffirmed', customer_ownership_affirmed,
      'importantDate', important_date,
      'platformFamily', platform_family,
      'primaryGoal', primary_goal,
      'publicHostname', public_hostname,
      'publicScheme', public_scheme,
      'revision', service_revision,
      'siteDisplayName', site_display_name
    )
  )
$$;

create table ss.service_intakes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  created_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  revision bigint not null check (revision > 0),
  state text not null default 'submitted' check (state = 'submitted'),
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
  customer_ownership_affirmed boolean not null
    check (customer_ownership_affirmed),
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
  submitted_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.service_project_profiles(organization_id, project_id),
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
  unique (case_id, revision)
);

create function ss.prepare_service_intake()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.service_cases service_case
     where service_case.organization_id = new.organization_id
       and service_case.project_id = new.project_id
       and service_case.customer_user_id = new.customer_user_id
       and service_case.id = new.case_id
       and service_case.state = 'submitted'
  ) then
    raise exception 'service intake requires a submitted customer case'
      using errcode = '23514';
  end if;

  new.source := 'account';
  new.state := 'submitted';
  new.revision := coalesce(
    (
      select max(intake.revision) + 1
        from ss.service_intakes intake
       where intake.case_id = new.case_id
    ),
    1
  );
  new.submitted_at := clock_timestamp();
  new.created_at := new.submitted_at;
  return new;
end
$$;

create trigger service_intakes_prepare
before insert on ss.service_intakes
for each row execute function ss.prepare_service_intake();

create trigger service_intakes_account_authority
after insert on ss.service_intakes
for each row execute function ss.validate_service_account_authority();

create trigger service_intakes_immutable
before update or delete on ss.service_intakes
for each row execute function ss.reject_update();

-- Documents and delegated access are schema-only in this migration. Their
-- tables are retention-safe and credential-free, but service_role receives
-- SELECT only. Later slices add evidence-backed operator write authority.
create table ss.service_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  document_kind text not null
    check (
      document_kind in (
        'assessment_report',
        'assessment_evidence',
        'quote_render',
        'invoice_render',
        'onboarding_result',
        'access_instruction',
        'job_evidence',
        'handoff',
        'monthly_receipt'
      )
    ),
  object_key text not null
    check (
      char_length(object_key) between 3 and 512
      and object_key !~ '[[:cntrl:]]'
      and object_key !~ '(^/|(^|/)[.][.]?(/|$))'
    ),
  content_digest ss.sha256_hex not null,
  media_type text not null
    check (
      media_type in (
        'application/json',
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'text/plain'
      )
    ),
  byte_count bigint not null check (byte_count between 1 and 104857600),
  visibility text not null
    check (visibility in ('customer', 'operator', 'shared')),
  retention_class text not null
    check (
      retention_class in (
        'project',
        'accounting',
        'support',
        'security',
        'ephemeral_private'
      )
    ),
  created_by_kind text not null
    check (created_by_kind in ('operator', 'system')),
  created_by_user_id uuid references ss.operator_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.service_project_profiles(organization_id, project_id),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  unique (organization_id, id),
  unique (object_key),
  check (
    (created_by_kind = 'system' and created_by_user_id is null)
    or (created_by_kind = 'operator' and created_by_user_id is not null)
  )
);

create trigger service_documents_immutable
before update or delete on ss.service_documents
for each row execute function ss.reject_update();

create table ss.service_access_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  requested_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  provider_label text not null
    check (ss.service_reference_is_safe(provider_label)),
  account_label text not null
    check (ss.service_reference_is_safe(account_label)),
  delegated_role text not null
    check (ss.service_reference_is_safe(delegated_role)),
  reason_code text not null
    check (
      reason_code in (
        'assessment_private_access',
        'takeover_inventory',
        'repair_execution',
        'migration_export',
        'domain_configuration',
        'mailbox_configuration',
        'management_operations'
      )
    ),
  state text not null default 'drafted' check (state = 'drafted'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.service_project_profiles(organization_id, project_id),
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
  check (expires_at > created_at)
);

create trigger service_access_requests_immutable
before update or delete on ss.service_access_requests
for each row execute function ss.reject_update();

-- Raw records remain service-role-only. Customers and owner tools receive
-- purpose-built projections in later slices. No API role receives DELETE or
-- TRUNCATE, and held operator/document/access tables are read-only here.
do $$
declare
  table_name text;
  tables text[] := array[
    'service_catalog_policies',
    'service_catalog_coverage',
    'service_project_profiles',
    'operator_profiles',
    'operator_permissions',
    'service_cases',
    'service_case_offerings',
    'service_intakes',
    'service_documents',
    'service_access_requests'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;
end
$$;

grant select on table
  ss.service_catalog_policies,
  ss.service_catalog_coverage,
  ss.service_project_profiles,
  ss.operator_profiles,
  ss.operator_permissions,
  ss.service_cases,
  ss.service_case_offerings,
  ss.service_intakes,
  ss.service_documents,
  ss.service_access_requests
to service_role;

grant insert, update on table
  ss.service_project_profiles,
  ss.service_cases,
  ss.service_case_offerings
to service_role;

grant insert on table ss.service_intakes to service_role;

do $$
declare
  function_signature text;
  function_names text[] := array[
    'current_service_actor_kind',
    'current_service_actor_user_id',
    'current_service_actor_org_id',
    'service_text_excludes_credentials',
    'service_reference_is_safe',
    'service_json_digest',
    'validate_service_catalog_policy',
    'bump_service_project_profile_revision',
    'guard_service_case_insert',
    'bump_service_case_revision',
    'validate_service_account_authority',
    'guard_service_case_offering_insert',
    'guard_service_case_offering_update',
    'service_complexity_flags_are_canonical',
    'service_intake_facts_digest',
    'prepare_service_intake'
  ];
begin
  for function_signature in
    select procedure.oid::regprocedure::text
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'ss'
       and procedure.proname = any(function_names)
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_signature
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_catalog_policies',
    'service_catalog_coverage',
    'service_project_profiles',
    'operator_profiles',
    'operator_permissions',
    'service_cases',
    'service_case_offerings',
    'service_intakes',
    'service_documents',
    'service_access_requests'
  ]
  loop
    if has_table_privilege(
      'service_role',
      format('ss.%I', table_name),
      'DELETE'
    ) or has_table_privilege(
      'service_role',
      format('ss.%I', table_name),
      'TRUNCATE'
    ) then
      raise exception 'service_role has destructive custom-service privilege on %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role',
    'ss.operator_profiles',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.operator_permissions',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_documents',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_access_requests',
    'INSERT'
  ) then
    raise exception 'held custom-service authority is writable by service_role'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v34()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v34-custom-services-foundation'::text
$$;

revoke all on function ss.hosted_runtime_contract_v34()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v34()
to authenticated, service_role;

commit;
