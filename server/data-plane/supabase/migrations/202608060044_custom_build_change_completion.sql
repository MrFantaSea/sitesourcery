begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v43()') is null
    or to_regclass('ss.service_custom_build_jobs') is null
    or to_regclass('ss.service_custom_build_progress_updates') is null
    or to_regclass('ss.service_custom_build_work_requests') is null
    or to_regclass('ss.service_documents') is null
    or to_regclass('ss.service_document_payloads') is null
    or to_regclass('ss.service_catalog_policies') is null
  then
    raise exception
      'Site Sourcery migration 043 must be applied before Custom build change and completion storage'
      using errcode = '55000';
  end if;
end
$$;

-- Added work is a held one-time unit, never an adjustment to the assessment
-- credit or a negative base-build line. Publication and provider payment stay
-- outside this migration.
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
  '00000000-0000-4000-8000-000000000441',
  'SS-PROFESSIONAL-2026.3',
  'custom_build_change_unit',
  'Custom build added-work unit',
  'unit',
  'one_time',
  'USD',
  12500,
  'added-work unit',
  1,
  40,
  jsonb_build_object(
    'addedWorkOnly', true,
    'assessmentCreditApplied', false,
    'cashRefund', false,
    'maximumUnits', 40,
    'minimumUnits', 1,
    'negativeLine', false,
    'originalScopeRemains', true,
    'plainScope',
      'Added work only. The original scope remains. Customer acceptance and provider-confirmed payment are required before changed work begins. No assessment credit, cash refund, or negative line applies.',
    'requiresCustomerAcceptance', true,
    'requiresProviderConfirmedPaymentBeforeChangedWork', true,
    'unitAmountMinor', 12500
  ),
  document.id,
  document.version,
  document.content_digest,
  'held',
  '2026-08-06T00:00:00Z'
from ss.legal_documents document
where document.id = '00000000-0000-4000-8000-000000000342'
  and document.kind = 'custom_services'
  and document.version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
  and document.content_digest =
    '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
  and document.retired_at is null;

insert into ss.service_catalog_coverage (
  policy_id,
  coverage_key,
  coverage_mode,
  scope_identity_kind,
  boundary_digest
)
select
  policy.id,
  'custom_build_added_work',
  'includes',
  'project',
  policy.scope_boundary_digest
from ss.service_catalog_policies policy
where policy.id = '00000000-0000-4000-8000-000000000441'
  and policy.service_key = 'custom_build_change_unit';

do $$
begin
  if not exists (
    select 1
    from ss.service_catalog_policies policy
    join ss.legal_documents document
      on document.id = policy.legal_document_id
    where policy.id = '00000000-0000-4000-8000-000000000441'
      and policy.catalog_version = 'SS-PROFESSIONAL-2026.3'
      and policy.service_key = 'custom_build_change_unit'
      and policy.pricing_mode = 'unit'
      and policy.billing_cadence = 'one_time'
      and policy.currency = 'USD'
      and policy.unit_amount_minor = 12500
      and policy.minimum_quantity = 1
      and policy.maximum_quantity = 40
      and policy.publication_state = 'held'
      and document.kind = 'custom_services'
      and document.version = 'SS-CUSTOM-SERVICES-2026-08-05.1'
      and document.content_digest =
        '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
  ) then
    raise exception 'Custom build change unit lacks its exact held policy'
      using errcode = '55000';
  end if;
end
$$;

create function ss.service_custom_build_change_quote_digest(
  digest_kind text,
  organization_id uuid,
  project_id uuid,
  case_id uuid,
  customer_user_id uuid,
  job_id uuid,
  change_order_id uuid,
  change_number integer,
  policy_id uuid,
  scope_boundary_digest ss.sha256_hex,
  added_scope text,
  unit_count integer,
  prior_effective_scope_digest ss.sha256_hex,
  current_effective_target_completion_date date,
  target_completion_date date,
  commercial_contract_id text,
  commercial_contract_digest ss.sha256_hex,
  issued_at timestamptz,
  expires_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'addedScope', added_scope,
    'addedWorkOnly', true,
    'assessmentCreditApplied', false,
    'cashRefund', false,
    'caseId', case_id,
    'changeNumber', change_number,
    'changeOrderId', change_order_id,
    'commercialContractDigest', commercial_contract_digest,
    'commercialContractId', commercial_contract_id,
    'currency', 'USD',
    'currentEffectiveTargetCompletionDate',
      current_effective_target_completion_date,
    'customerUserId', customer_user_id,
    'digestKind', digest_kind,
    'expiresAt', expires_at,
    'issuedAt', issued_at,
    'jobId', job_id,
    'negativeLine', false,
    'organizationId', organization_id,
    'originalScopeRemains', true,
    'paymentRequirement', 'due_before_changed_work',
    'policyId', policy_id,
    'priorEffectiveScopeDigest', prior_effective_scope_digest,
    'projectId', project_id,
    'requiresCustomerAcceptance', true,
    'requiresProviderConfirmedPaymentBeforeChangedWork', true,
    'schema', 'sitesourcery.custom-build-change-quote/v1',
    'scopeBoundaryDigest', scope_boundary_digest,
    'subtotalMinor', unit_count::bigint * 12500::bigint,
    'targetCompletionDate', target_completion_date,
    'taxState', 'automatic_tax_pending',
    'unitAmountMinor', 12500,
    'unitCount', unit_count
  ))
$$;

create table ss.service_custom_build_change_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_number integer not null check (change_number > 0),
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  added_scope text not null check (
    char_length(added_scope) between 20 and 2000
    and ss.service_text_excludes_credentials(added_scope)
  ),
  unit_count integer not null check (unit_count between 1 and 40),
  unit_amount_minor bigint generated always as (12500::bigint) stored,
  subtotal_minor bigint generated always as (
    unit_count::bigint * 12500::bigint
  ) stored,
  currency text generated always as ('USD'::text) stored,
  tax_state text generated always as (
    'automatic_tax_pending'::text
  ) stored,
  payment_requirement text generated always as (
    'due_before_changed_work'::text
  ) stored,
  prior_effective_scope_digest ss.sha256_hex not null,
  current_effective_target_completion_date date not null,
  target_completion_date date not null,
  commercial_contract_id text not null,
  commercial_contract_digest ss.sha256_hex not null,
  state text not null default 'issued' check (
    state in (
      'issued',
      'accepted_payment_required',
      'effective',
      'declined',
      'expired',
      'voided'
    )
  ),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  issue_command_id text not null check (
    char_length(issue_command_id) between 8 and 200
    and issue_command_id !~ '[[:cntrl:]]'
  ),
  issue_request_digest ss.sha256_hex not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  quote_digest ss.sha256_hex generated always as (
    ss.service_custom_build_change_quote_digest(
      'quote',
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      job_id,
      id,
      change_number,
      policy_id,
      scope_boundary_digest,
      added_scope,
      unit_count,
      prior_effective_scope_digest,
      current_effective_target_completion_date,
      target_completion_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  disclosure_digest ss.sha256_hex generated always as (
    ss.service_custom_build_change_quote_digest(
      'customer_disclosure',
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      job_id,
      id,
      change_number,
      policy_id,
      scope_boundary_digest,
      added_scope,
      unit_count,
      prior_effective_scope_digest,
      current_effective_target_completion_date,
      target_completion_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  foreign key (policy_id, commercial_contract_digest)
    references ss.service_catalog_policies(id, commercial_contract_digest),
  unique (organization_id, id),
  unique (organization_id, job_id, id),
  unique (job_id, change_number),
  unique (created_by_operator_user_id, job_id, issue_command_id),
  check (target_completion_date >= current_effective_target_completion_date),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '14 days'),
  check (created_at = issued_at),
  check (updated_at >= created_at)
);

create unique index service_custom_build_change_orders_one_active
on ss.service_custom_build_change_orders(job_id)
where state in ('issued', 'accepted_payment_required');

create table ss.service_custom_build_change_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_number integer not null check (change_number > 0),
  accepted_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  acceptance_statement text not null check (
    acceptance_statement =
      'accepted_exact_change_order_and_payment_requirement'
  ),
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  unique (organization_id, id),
  unique (change_order_id),
  unique (customer_user_id, job_id, command_id),
  check (accepted_by_user_id = customer_user_id),
  check (created_at = accepted_at)
);

create table ss.service_custom_build_change_declines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_number integer not null check (change_number > 0),
  declined_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  decline_statement text not null check (
    decline_statement = 'declined_exact_custom_build_change_quote'
  ),
  declined_quote_digest ss.sha256_hex not null,
  declined_disclosure_digest ss.sha256_hex not null,
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  declined_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  unique (organization_id, id),
  unique (change_order_id),
  unique (customer_user_id, job_id, command_id),
  check (declined_by_user_id = customer_user_id),
  check (created_at = declined_at)
);

create table ss.service_custom_build_change_voids (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  change_order_id uuid not null,
  change_number integer not null check (change_number > 0),
  quote_author_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  reason text not null check (
    char_length(reason) between 20 and 500
    and ss.service_text_excludes_credentials(reason)
  ),
  voided_quote_digest ss.sha256_hex not null,
  voided_disclosure_digest ss.sha256_hex not null,
  voided_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  unique (organization_id, id),
  unique (change_order_id),
  unique (quote_author_operator_user_id, job_id, command_id),
  check (created_at = voided_at)
);

-- Expiration is an immutable fact, not an inferred UI label. Any currently
-- authorized quote author may seal an untouched issued quote after its exact
-- deadline so one stale quote cannot block the paid job forever.
create table ss.service_custom_build_change_expirations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  change_order_id uuid not null,
  change_number integer not null check (change_number > 0),
  expired_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  expired_quote_digest ss.sha256_hex not null,
  expired_disclosure_digest ss.sha256_hex not null,
  expired_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  unique (organization_id, id),
  unique (change_order_id),
  unique (expired_by_operator_user_id, job_id, command_id),
  check (created_at = expired_at)
);

create table ss.service_custom_build_completion_evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  document_id uuid not null,
  viewport text not null check (viewport in ('desktop', 'phone')),
  progress_revision bigint not null check (progress_revision > 0),
  effective_scope_digest ss.sha256_hex not null,
  content_digest ss.sha256_hex not null,
  image_width integer not null check (image_width between 240 and 2048),
  image_height integer not null check (image_height between 1 and 5000),
  validator_version text not null check (
    validator_version = 'service-image-evidence/v1'
  ),
  accessible_description text not null check (
    char_length(accessible_description) between 10 and 500
    and ss.service_text_excludes_credentials(accessible_description)
  ),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, document_id)
    references ss.service_document_payloads(organization_id, document_id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (organization_id, job_id, id),
  unique (document_id),
  unique (created_by_operator_user_id, job_id, command_id),
  check (
    (viewport = 'desktop' and image_width between 768 and 2048)
    or (viewport = 'phone' and image_width between 240 and 767)
  ),
  check (image_width::bigint * image_height::bigint <= 10240000::bigint),
  check (created_at >= captured_at)
);

create function ss.service_custom_build_completion_evidence_ids_are_canonical(
  value uuid[]
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    value is not null
    and cardinality(value) between 2 and 12
    and array_position(value, null) is null
    and value = (
      select array_agg(candidate order by candidate::text)
      from (select distinct unnest(value) as candidate) selected
    )
$$;

create table ss.service_custom_build_completion_packages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  progress_revision bigint not null check (progress_revision > 0),
  base_scope_digest ss.sha256_hex not null,
  effective_change_order_digests ss.sha256_hex[] not null,
  effective_scope_digest ss.sha256_hex not null,
  evidence_ids uuid[] not null check (
    ss.service_custom_build_completion_evidence_ids_are_canonical(
      evidence_ids
    )
  ),
  scope_check_passed boolean not null,
  desktop_check_passed boolean not null,
  phone_check_passed boolean not null,
  links_check_passed boolean not null,
  contact_actions_check_passed boolean not null,
  accessibility_basics_check_passed boolean not null,
  customer_summary text not null check (
    char_length(customer_summary) between 20 and 1000
    and ss.service_text_excludes_credentials(customer_summary)
  ),
  state text not null check (
    state in ('ready_for_final_payment', 'ready_for_delivery')
  ),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  package_digest ss.sha256_hex not null,
  prepared_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (job_id),
  unique (created_by_operator_user_id, job_id, command_id),
  check (
    scope_check_passed
    and desktop_check_passed
    and phone_check_passed
    and links_check_passed
    and contact_actions_check_passed
    and accessibility_basics_check_passed
  ),
  check (created_at = prepared_at)
);

-- Completion is a terminal work-state boundary. The same advisory lock used
-- by completion serializes every later progress/request attempt, including a
-- customer response racing the package insert.
create function ss.guard_service_custom_build_after_completion()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job_id uuid := new.job_id;
  selected_organization_id uuid := new.organization_id;
begin
  if tg_table_name = 'service_access_requests' then
    if
      selected_job_id is null
      or new.reason_code <> 'custom_build_execution'
    then
      return new;
    end if;
  end if;

  if selected_job_id is null or selected_organization_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || selected_job_id::text,
      0
    )
  );

  if exists (
    select 1
    from ss.service_custom_build_completion_packages package
    where package.organization_id = selected_organization_id
      and package.job_id = selected_job_id
  ) then
    raise exception 'Custom build work is closed by its completion package'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create function ss.service_custom_build_effective_scope_snapshot(
  selected_organization_id uuid,
  selected_job_id uuid
)
returns table (
  base_scope_digest ss.sha256_hex,
  effective_change_order_digests ss.sha256_hex[],
  effective_scope_digest ss.sha256_hex,
  effective_target_completion_date date
)
language plpgsql
stable
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_base_scope_digest ss.sha256_hex;
  selected_change_digests ss.sha256_hex[];
  selected_effective_scope_digest ss.sha256_hex;
  selected_effective_target_date date;
begin
  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = selected_organization_id
    and job.id = selected_job_id;

  if not found then
    raise exception 'Custom build effective scope lacks its paid job'
      using errcode = '23514';
  end if;

  selected_base_scope_digest := ss.service_json_digest(
    jsonb_build_object(
      'acceptedDisclosureDigest', selected_job.accepted_disclosure_digest,
      'acceptedQuoteDigest', selected_job.accepted_quote_digest,
      'contentWords', selected_job.content_words,
      'craftedPages', selected_job.crafted_pages,
      'jobId', selected_job.id,
      'organizationId', selected_job.organization_id,
      'policyId', selected_job.policy_id,
      'projectId', selected_job.project_id,
      'quoteId', selected_job.quote_id,
      'quoteRevision', selected_job.quote_revision,
      'quoteRevisionId', selected_job.quote_revision_id,
      'schema', 'sitesourcery.custom-build-base-scope/v1',
      'scopeBoundaryDigest', selected_job.scope_boundary_digest,
      'scopeStatement', selected_job.scope_statement,
      'sections', selected_job.sections,
      'suppliedMedia', selected_job.supplied_media,
      'targetCompletionDate', selected_job.target_completion_date,
      'tierId', selected_job.tier_id,
      'uniqueLayouts', selected_job.unique_layouts
    )
  );

  select
    coalesce(
      array_agg(
        change_order.quote_digest
        order by change_order.change_number
      ),
      array[]::ss.sha256_hex[]
    ),
    greatest(
      selected_job.target_completion_date,
      coalesce(
        max(change_order.target_completion_date),
        selected_job.target_completion_date
      )
    )
  into selected_change_digests, selected_effective_target_date
  from ss.service_custom_build_change_orders change_order
  where change_order.organization_id = selected_organization_id
    and change_order.job_id = selected_job_id
    and change_order.state = 'effective';

  selected_effective_scope_digest := ss.service_json_digest(
    jsonb_build_object(
      'baseScopeDigest', selected_base_scope_digest,
      'effectiveChangeOrderDigests', selected_change_digests,
      'jobId', selected_job.id,
      'schema', 'sitesourcery.custom-build-effective-scope/v1'
    )
  );

  return query select
    selected_base_scope_digest,
    selected_change_digests,
    selected_effective_scope_digest,
    selected_effective_target_date;
end
$$;

-- No payment evidence relation exists in v44. The payment migration must
-- replace this fail-closed gate before it creates the named receipt table.
create function ss.service_custom_build_change_has_payment_evidence(
  selected_change_order_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if to_regclass('ss.service_custom_build_change_payment_receipts')
    is not null
  then
    raise exception
      'Custom build change payment gate must be replaced before void authority continues'
      using errcode = '55000';
  end if;
  return false;
end
$$;

create function ss.prepare_service_custom_build_change_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_policy record;
  scope_snapshot record;
  recorded_at timestamptz := clock_timestamp();
  requested_target_completion_date date := new.target_completion_date;
  requested_expires_at timestamptz := new.expires_at;
begin
  if new.job_id is null
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is null
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
  then
    raise exception 'Custom build change issue lacks quote-author authority'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || new.job_id::text,
      0
    )
  );

  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = ss.current_service_actor_org_id()
    and job.id = new.job_id;

  if selected_job.id is null
    or selected_job.state <> 'open'
    or exists (
      select 1
      from ss.service_custom_build_completion_packages package
      where package.organization_id = selected_job.organization_id
        and package.job_id = selected_job.id
    )
    or exists (
      select 1
      from ss.service_custom_build_change_orders active_change
      where active_change.organization_id = selected_job.organization_id
        and active_change.job_id = selected_job.id
        and active_change.state in (
          'issued', 'accepted_payment_required'
        )
    )
  then
    raise exception 'Custom build change is outside an active paid job'
      using errcode = '23514';
  end if;

  select policy.* into selected_policy
  from ss.service_catalog_policies policy
  where policy.id = '00000000-0000-4000-8000-000000000441'
    and policy.catalog_version = 'SS-PROFESSIONAL-2026.3'
    and policy.service_key = 'custom_build_change_unit'
    and policy.pricing_mode = 'unit'
    and policy.billing_cadence = 'one_time'
    and policy.currency = 'USD'
    and policy.unit_amount_minor = 12500
    and policy.minimum_quantity = 1
    and policy.maximum_quantity = 40
    and policy.publication_state = 'held';

  if not found then
    raise exception 'Custom build change lacks the held unit policy'
      using errcode = '55000';
  end if;

  select snapshot.* into scope_snapshot
  from ss.service_custom_build_effective_scope_snapshot(
    selected_job.organization_id,
    selected_job.id
  ) snapshot;

  if new.unit_count not between 1 and 40
    or char_length(new.added_scope) not between 20 and 2000
    or not ss.service_text_excludes_credentials(new.added_scope)
    or requested_target_completion_date is null
    or requested_target_completion_date <
      scope_snapshot.effective_target_completion_date
    or requested_expires_at is null
    or requested_expires_at <= recorded_at
    or requested_expires_at > recorded_at + interval '14 days'
    or new.issue_command_id is null
  then
    raise exception 'Custom build change issue is outside its bounded terms'
      using errcode = '23514';
  end if;

  new.organization_id := selected_job.organization_id;
  new.project_id := selected_job.project_id;
  new.case_id := selected_job.case_id;
  new.customer_user_id := selected_job.customer_user_id;
  new.change_number := coalesce((
    select max(prior_change.change_number) + 1
    from ss.service_custom_build_change_orders prior_change
    where prior_change.organization_id = selected_job.organization_id
      and prior_change.job_id = selected_job.id
  ), 1);
  new.policy_id := selected_policy.id;
  new.scope_boundary_digest := selected_policy.scope_boundary_digest;
  new.prior_effective_scope_digest :=
    scope_snapshot.effective_scope_digest;
  new.current_effective_target_completion_date :=
    scope_snapshot.effective_target_completion_date;
  new.target_completion_date := requested_target_completion_date;
  new.commercial_contract_id := selected_policy.commercial_contract_id;
  new.commercial_contract_digest :=
    selected_policy.commercial_contract_digest;
  new.state := 'issued';
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.issued_at := recorded_at;
  new.expires_at := requested_expires_at;
  new.issue_request_digest := ss.service_json_digest(jsonb_build_object(
    'addedScope', new.added_scope,
    'commandId', new.issue_command_id,
    'currentEffectiveTargetCompletionDate',
      new.current_effective_target_completion_date,
    'jobId', new.job_id,
    'operatorUserId', new.created_by_operator_user_id,
    'priorEffectiveScopeDigest', new.prior_effective_scope_digest,
    'schema', 'sitesourcery.custom-build-change-issue-command/v1',
    'targetCompletionDate', new.target_completion_date,
    'unitCount', new.unit_count
  ));
  new.created_at := recorded_at;
  new.updated_at := recorded_at;
  return new;
end
$$;

create function ss.guard_service_custom_build_change_order_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  transition_at timestamptz;
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.job_id,
    new.change_number,
    new.policy_id,
    new.scope_boundary_digest,
    new.added_scope,
    new.unit_count,
    new.prior_effective_scope_digest,
    new.current_effective_target_completion_date,
    new.target_completion_date,
    new.commercial_contract_id,
    new.commercial_contract_digest,
    new.created_by_operator_user_id,
    new.issue_command_id,
    new.issue_request_digest,
    new.issued_at,
    new.expires_at,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.job_id,
    old.change_number,
    old.policy_id,
    old.scope_boundary_digest,
    old.added_scope,
    old.unit_count,
    old.prior_effective_scope_digest,
    old.current_effective_target_completion_date,
    old.target_completion_date,
    old.commercial_contract_id,
    old.commercial_contract_digest,
    old.created_by_operator_user_id,
    old.issue_command_id,
    old.issue_request_digest,
    old.issued_at,
    old.expires_at,
    old.created_at
  ) then
    raise exception 'Custom build change-order identity is immutable'
      using errcode = '55000';
  end if;

  if old.state = 'issued'
    and new.state = 'accepted_payment_required'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
  then
    select acceptance.accepted_at into transition_at
    from ss.service_custom_build_change_acceptances acceptance
    where acceptance.change_order_id = old.id
      and acceptance.accepted_quote_digest = old.quote_digest
      and acceptance.accepted_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state = 'issued'
    and new.state = 'declined'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
  then
    select decline.declined_at into transition_at
    from ss.service_custom_build_change_declines decline
    where decline.change_order_id = old.id
      and decline.declined_quote_digest = old.quote_digest
      and decline.declined_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state = 'issued'
    and new.state = 'expired'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
  then
    select expiration.expired_at into transition_at
    from ss.service_custom_build_change_expirations expiration
    where expiration.change_order_id = old.id
      and expiration.expired_by_operator_user_id =
        ss.current_service_actor_user_id()
      and expiration.expired_quote_digest = old.quote_digest
      and expiration.expired_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state in ('issued', 'accepted_payment_required')
    and new.state = 'voided'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() =
      old.created_by_operator_user_id
  then
    select quote_void.voided_at into transition_at
    from ss.service_custom_build_change_voids quote_void
    where quote_void.change_order_id = old.id
      and quote_void.quote_author_operator_user_id =
        old.created_by_operator_user_id
      and quote_void.voided_quote_digest = old.quote_digest
      and quote_void.voided_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  raise exception
    'Custom build change-order transition lacks exact append evidence'
    using errcode = '55000';
end
$$;

create function ss.prepare_service_custom_build_change_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_change record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.accepted_quote_digest;
  claimed_disclosure_digest ss.sha256_hex :=
    new.accepted_disclosure_digest;
begin
  select change_order.* into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id
  for update;

  if not found
    or selected_change.state <> 'issued'
    or selected_change.expires_at <= recorded_at
    or claimed_quote_digest is distinct from selected_change.quote_digest
    or claimed_disclosure_digest is distinct from
      selected_change.disclosure_digest
    or new.acceptance_statement <>
      'accepted_exact_change_order_and_payment_requirement'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_org_id() is distinct from
      selected_change.organization_id
    or ss.current_service_actor_user_id() is distinct from
      selected_change.customer_user_id
    or not exists (
      select 1
      from ss.projects project
      join ss.organizations organization
        on organization.id = project.organization_id
      join ss.organization_memberships membership
        on membership.organization_id = project.organization_id
       and membership.user_id = selected_change.customer_user_id
      join auth.users customer_user
        on customer_user.id = selected_change.customer_user_id
      join ss.hosted_account_profiles account_profile
        on account_profile.user_id = selected_change.customer_user_id
      where project.organization_id = selected_change.organization_id
        and project.id = selected_change.project_id
        and project.lifecycle = 'active'
        and organization.state = 'active'
        and membership.state = 'active'
        and membership.role in ('owner', 'admin')
        and customer_user.disabled_at is null
        and account_profile.state = 'active'
    )
  then
    raise exception
      'Custom build change acceptance lacks exact current customer evidence'
      using errcode = '42501';
  end if;

  new.organization_id := selected_change.organization_id;
  new.project_id := selected_change.project_id;
  new.case_id := selected_change.case_id;
  new.customer_user_id := selected_change.customer_user_id;
  new.job_id := selected_change.job_id;
  new.change_number := selected_change.change_number;
  new.accepted_by_user_id := selected_change.customer_user_id;
  new.source := 'account';
  new.accepted_quote_digest := selected_change.quote_digest;
  new.accepted_disclosure_digest := selected_change.disclosure_digest;
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'acceptedDisclosureDigest', selected_change.disclosure_digest,
    'acceptedQuoteDigest', selected_change.quote_digest,
    'acceptanceStatement',
      'accepted_exact_change_order_and_payment_requirement',
    'changeNumber', selected_change.change_number,
    'changeOrderId', selected_change.id,
    'commandId', new.command_id,
    'customerUserId', selected_change.customer_user_id,
    'jobId', selected_change.job_id,
    'schema', 'sitesourcery.custom-build-change-acceptance-command/v1'
  ));
  new.accepted_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_change_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  update ss.service_custom_build_change_orders
  set state = 'accepted_payment_required'
  where id = new.change_order_id
    and state = 'issued';

  if not found then
    raise exception 'Custom build change acceptance could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_change_decline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_change record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.declined_quote_digest;
  claimed_disclosure_digest ss.sha256_hex :=
    new.declined_disclosure_digest;
begin
  select change_order.* into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id
  for update;

  if not found
    or selected_change.state <> 'issued'
    or claimed_quote_digest is distinct from selected_change.quote_digest
    or claimed_disclosure_digest is distinct from
      selected_change.disclosure_digest
    or new.decline_statement <>
      'declined_exact_custom_build_change_quote'
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_org_id() is distinct from
      selected_change.organization_id
    or ss.current_service_actor_user_id() is distinct from
      selected_change.customer_user_id
    or not exists (
      select 1
      from ss.organization_memberships membership
      where membership.organization_id = selected_change.organization_id
        and membership.user_id = selected_change.customer_user_id
        and membership.state = 'active'
        and membership.role in ('owner', 'admin')
    )
  then
    raise exception
      'Custom build change decline lacks exact current customer evidence'
      using errcode = '42501';
  end if;

  new.organization_id := selected_change.organization_id;
  new.project_id := selected_change.project_id;
  new.case_id := selected_change.case_id;
  new.customer_user_id := selected_change.customer_user_id;
  new.job_id := selected_change.job_id;
  new.change_number := selected_change.change_number;
  new.declined_by_user_id := selected_change.customer_user_id;
  new.source := 'account';
  new.declined_quote_digest := selected_change.quote_digest;
  new.declined_disclosure_digest := selected_change.disclosure_digest;
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'changeNumber', selected_change.change_number,
    'changeOrderId', selected_change.id,
    'commandId', new.command_id,
    'customerUserId', selected_change.customer_user_id,
    'declineStatement', 'declined_exact_custom_build_change_quote',
    'declinedDisclosureDigest', selected_change.disclosure_digest,
    'declinedQuoteDigest', selected_change.quote_digest,
    'jobId', selected_change.job_id,
    'schema', 'sitesourcery.custom-build-change-decline-command/v1'
  ));
  new.declined_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_change_decline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  update ss.service_custom_build_change_orders
  set state = 'declined'
  where id = new.change_order_id
    and state = 'issued';

  if not found then
    raise exception 'Custom build change decline could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_change_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_change record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.voided_quote_digest;
begin
  select change_order.* into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id
  for update;

  if not found
    or selected_change.state not in (
      'issued', 'accepted_payment_required'
    )
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
      selected_change.organization_id
    or ss.current_service_actor_user_id() is distinct from
      selected_change.created_by_operator_user_id
    or claimed_quote_digest is distinct from selected_change.quote_digest
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    or char_length(new.reason) not between 20 and 500
    or not ss.service_text_excludes_credentials(new.reason)
  then
    raise exception 'Custom build change void lacks exact quote-author evidence'
      using errcode = '42501';
  end if;

  if selected_change.state = 'accepted_payment_required'
    and ss.service_custom_build_change_has_payment_evidence(
      selected_change.id
    )
  then
    raise exception 'Accepted Custom build change has payment evidence'
      using errcode = '55000';
  end if;

  new.organization_id := selected_change.organization_id;
  new.job_id := selected_change.job_id;
  new.change_number := selected_change.change_number;
  new.quote_author_operator_user_id :=
    selected_change.created_by_operator_user_id;
  new.voided_quote_digest := selected_change.quote_digest;
  new.voided_disclosure_digest := selected_change.disclosure_digest;
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'changeNumber', selected_change.change_number,
    'changeOrderId', selected_change.id,
    'commandId', new.command_id,
    'jobId', selected_change.job_id,
    'quoteAuthorOperatorUserId',
      selected_change.created_by_operator_user_id,
    'reason', new.reason,
    'schema', 'sitesourcery.custom-build-change-void-command/v1',
    'voidedDisclosureDigest', selected_change.disclosure_digest,
    'voidedQuoteDigest', selected_change.quote_digest
  ));
  new.voided_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_change_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  update ss.service_custom_build_change_orders
  set state = 'voided'
  where id = new.change_order_id
    and state in ('issued', 'accepted_payment_required');

  if not found then
    raise exception 'Custom build change void could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_change_expiration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_change record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.expired_quote_digest;
begin
  if new.job_id is null then
    raise exception 'Custom build change expiration lacks a paid job'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || new.job_id::text,
      0
    )
  );

  select change_order.* into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id
  for update;

  if not found
    or selected_change.organization_id is distinct from
      ss.current_service_actor_org_id()
    or selected_change.job_id is distinct from new.job_id
    or selected_change.state <> 'issued'
    or recorded_at < selected_change.expires_at
    or claimed_quote_digest is distinct from selected_change.quote_digest
    or ss.current_service_actor_kind() <> 'operator'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
  then
    raise exception 'Custom build change expiration lacks exact expired quote evidence'
      using errcode = '42501';
  end if;

  new.organization_id := selected_change.organization_id;
  new.job_id := selected_change.job_id;
  new.change_number := selected_change.change_number;
  new.expired_by_operator_user_id := ss.current_service_actor_user_id();
  new.expired_quote_digest := selected_change.quote_digest;
  new.expired_disclosure_digest := selected_change.disclosure_digest;
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'changeNumber', selected_change.change_number,
    'changeOrderId', selected_change.id,
    'commandId', new.command_id,
    'expiredByOperatorUserId', new.expired_by_operator_user_id,
    'expiredDisclosureDigest', selected_change.disclosure_digest,
    'expiredQuoteDigest', selected_change.quote_digest,
    'jobId', selected_change.job_id,
    'schema', 'sitesourcery.custom-build-change-expiration-command/v1'
  ));
  new.expired_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_change_expiration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  update ss.service_custom_build_change_orders
  set state = 'expired'
  where id = new.change_order_id
    and state = 'issued';

  if not found then
    raise exception 'Custom build change expiration could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

-- Keep the original assessment path exact. Add only bounded job_evidence for
-- an open paid Custom-build job; handoff and every other held kind stay blocked.
create or replace function ss.guard_service_assessment_document()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  recorded_at timestamptz := clock_timestamp();
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from new.created_by_user_id
    or new.created_by_kind <> 'operator'
    or new.document_kind not in (
      'assessment_evidence', 'assessment_report', 'job_evidence'
    )
    or new.visibility <> 'customer'
    or new.retention_class <> 'project'
    or new.object_key not like
      'service-documents/' || new.organization_id::text || '/' ||
      new.project_id::text || '/%'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      recorded_at
    )
    or (
      new.document_kind = 'job_evidence'
      and (
        new.media_type not in ('image/jpeg', 'image/png', 'image/webp')
        or not ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_job_manage',
          recorded_at
        )
        or not exists (
          select 1
          from ss.service_custom_build_jobs job
          where job.organization_id = new.organization_id
            and job.project_id = new.project_id
            and job.case_id = new.case_id
            and job.state = 'open'
            and new.object_key like
              'service-documents/' || new.organization_id::text || '/' ||
              new.project_id::text || '/custom-build-jobs/' ||
              job.id::text || '/evidence/%'
        )
      )
    )
  then
    raise exception 'service document mutation lacks bounded authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create function ss.guard_service_custom_build_completion_payload()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_document record;
  recorded_at timestamptz := clock_timestamp();
begin
  select document.* into selected_document
  from ss.service_documents document
  where document.organization_id = new.organization_id
    and document.id = new.document_id;

  if not found then
    raise exception 'Custom build evidence payload lacks document identity'
      using errcode = '23514';
  end if;

  if selected_document.document_kind = 'job_evidence'
    and (
      ss.current_service_actor_kind() <> 'operator'
      or ss.current_service_actor_org_id() is distinct from
        selected_document.organization_id
      or ss.current_service_actor_user_id() is distinct from
        selected_document.created_by_user_id
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_document_manage',
        recorded_at
      )
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_job_manage',
        recorded_at
      )
    )
  then
    raise exception 'Custom build evidence payload lacks bounded authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_custom_build_change_orders_prepare
before insert on ss.service_custom_build_change_orders
for each row execute function ss.prepare_service_custom_build_change_order();

create trigger service_custom_build_change_orders_transition_guard
before update on ss.service_custom_build_change_orders
for each row execute function ss.guard_service_custom_build_change_order_update();

create trigger service_custom_build_change_orders_no_delete
before delete on ss.service_custom_build_change_orders
for each row execute function ss.reject_update();

create trigger service_custom_build_change_acceptances_prepare
before insert on ss.service_custom_build_change_acceptances
for each row execute function ss.prepare_service_custom_build_change_acceptance();

create trigger service_custom_build_change_acceptances_materialize
after insert on ss.service_custom_build_change_acceptances
for each row execute function ss.materialize_service_custom_build_change_acceptance();

create trigger service_custom_build_change_acceptances_immutable
before update or delete on ss.service_custom_build_change_acceptances
for each row execute function ss.reject_update();

create trigger service_custom_build_change_declines_prepare
before insert on ss.service_custom_build_change_declines
for each row execute function ss.prepare_service_custom_build_change_decline();

create trigger service_custom_build_change_declines_materialize
after insert on ss.service_custom_build_change_declines
for each row execute function ss.materialize_service_custom_build_change_decline();

create trigger service_custom_build_change_declines_immutable
before update or delete on ss.service_custom_build_change_declines
for each row execute function ss.reject_update();

create trigger service_custom_build_change_voids_prepare
before insert on ss.service_custom_build_change_voids
for each row execute function ss.prepare_service_custom_build_change_void();

create trigger service_custom_build_change_voids_materialize
after insert on ss.service_custom_build_change_voids
for each row execute function ss.materialize_service_custom_build_change_void();

create trigger service_custom_build_change_voids_immutable
before update or delete on ss.service_custom_build_change_voids
for each row execute function ss.reject_update();

create trigger service_custom_build_change_expirations_prepare
before insert on ss.service_custom_build_change_expirations
for each row execute function ss.prepare_service_custom_build_change_expiration();

create trigger service_custom_build_change_expirations_materialize
after insert on ss.service_custom_build_change_expirations
for each row execute function ss.materialize_service_custom_build_change_expiration();

create trigger service_custom_build_change_expirations_immutable
before update or delete on ss.service_custom_build_change_expirations
for each row execute function ss.reject_update();

create trigger service_custom_build_progress_updates_completion_guard
before insert on ss.service_custom_build_progress_updates
for each row execute function ss.guard_service_custom_build_after_completion();

create trigger service_custom_build_work_requests_completion_guard
before insert or update on ss.service_custom_build_work_requests
for each row execute function ss.guard_service_custom_build_after_completion();

create trigger service_access_requests_custom_build_completion_guard
before insert on ss.service_access_requests
for each row execute function ss.guard_service_custom_build_after_completion();

-- The original payload guard still protects assessment bytes. This additional
-- guard narrows only job_evidence payloads to the exact document author and
-- paid-job capabilities.
create trigger service_document_payloads_custom_build_completion_guard
before insert on ss.service_document_payloads
for each row execute function ss.guard_service_custom_build_completion_payload();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_change_orders',
    'service_custom_build_change_acceptances',
    'service_custom_build_change_declines',
    'service_custom_build_change_voids',
    'service_custom_build_change_expirations',
    'service_custom_build_completion_evidence',
    'service_custom_build_completion_packages'
  ]
  loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format('grant select, insert on table ss.%I to service_role', table_name);
  end loop;
end
$$;

grant update on table ss.service_custom_build_change_orders to service_role;

do $$
declare
  function_signature text;
begin
  for function_signature in
    select procedure.oid::regprocedure::text
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'ss'
      and procedure.proname in (
        'service_custom_build_change_quote_digest',
        'service_custom_build_completion_evidence_ids_are_canonical',
        'guard_service_custom_build_after_completion',
        'service_custom_build_effective_scope_snapshot',
        'service_custom_build_change_has_payment_evidence',
        'prepare_service_custom_build_change_order',
        'guard_service_custom_build_change_order_update',
        'prepare_service_custom_build_change_acceptance',
        'materialize_service_custom_build_change_acceptance',
        'prepare_service_custom_build_change_decline',
        'materialize_service_custom_build_change_decline',
        'prepare_service_custom_build_change_void',
        'materialize_service_custom_build_change_void',
        'prepare_service_custom_build_change_expiration',
        'materialize_service_custom_build_change_expiration',
        'guard_service_assessment_document',
        'guard_service_custom_build_completion_payload',
        'guard_service_custom_build_completion_evidence',
        'guard_service_custom_build_completion_package'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_change_orders',
    'service_custom_build_change_acceptances',
    'service_custom_build_change_declines',
    'service_custom_build_change_voids',
    'service_custom_build_change_expirations',
    'service_custom_build_completion_evidence',
    'service_custom_build_completion_packages'
  ]
  loop
    if has_table_privilege('service_role', format('ss.%I', table_name), 'DELETE')
      or has_table_privilege('service_role', format('ss.%I', table_name), 'TRUNCATE')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'INSERT')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'UPDATE')
      or has_table_privilege('anon', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'UPDATE')
    then
      raise exception 'Custom build change/completion privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role', 'ss.service_custom_build_change_acceptances', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_declines', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_voids', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_expirations', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_completion_evidence', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_completion_packages', 'UPDATE'
  ) then
    raise exception 'Custom build change/completion evidence is not append-only'
      using errcode = '55000';
  end if;
end
$$;

create function ss.guard_service_custom_build_completion_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_document record;
  selected_progress record;
  scope_snapshot record;
  recorded_at timestamptz := clock_timestamp();
  prior_evidence_count integer;
begin
  if new.job_id is null
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is null
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      recorded_at
    )
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      recorded_at
    )
  then
    raise exception 'Custom build completion evidence lacks operator authority'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || new.job_id::text,
      0
    )
  );

  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = ss.current_service_actor_org_id()
    and job.id = new.job_id;

  select progress.* into selected_progress
  from ss.service_custom_build_progress_updates progress
  where progress.organization_id = selected_job.organization_id
    and progress.job_id = selected_job.id
  order by progress.revision desc
  limit 1;

  if selected_job.id is null
    or selected_job.state <> 'open'
    or selected_progress.id is null
    or selected_progress.stage <> 'checking'
    or new.viewport not in ('desktop', 'phone')
    or new.captured_at < selected_progress.recorded_at
    or new.captured_at > recorded_at
    or new.validator_version <> 'service-image-evidence/v1'
    or new.image_width is null
    or new.image_height is null
    or new.image_height not between 1 and 5000
    or new.image_width::bigint * new.image_height::bigint >
      10240000::bigint
    or (
      new.viewport = 'desktop'
      and new.image_width not between 768 and 2048
    )
    or (
      new.viewport = 'phone'
      and new.image_width not between 240 and 767
    )
    or exists (
      select 1
      from ss.service_custom_build_completion_packages package
      where package.organization_id = selected_job.organization_id
        and package.job_id = selected_job.id
    )
  then
    raise exception 'Custom build completion evidence is outside its paid job'
      using errcode = '23514';
  end if;

  select document.* into selected_document
  from ss.service_documents document
  join ss.service_document_payloads payload
    on payload.organization_id = document.organization_id
   and payload.document_id = document.id
   and payload.content_digest = document.content_digest
   and payload.byte_count = document.byte_count
   and payload.media_type = document.media_type
  where document.organization_id = selected_job.organization_id
    and document.project_id = selected_job.project_id
    and document.case_id = selected_job.case_id
    and document.id = new.document_id
    and document.document_kind = 'job_evidence'
    and document.visibility = 'customer'
    and document.retention_class = 'project'
    and document.created_by_kind = 'operator'
    and document.created_by_user_id = ss.current_service_actor_user_id()
    and document.media_type in ('image/jpeg', 'image/png', 'image/webp')
    and document.byte_count between 1 and 716800
    and document.object_key like
      'service-documents/' || selected_job.organization_id::text || '/' ||
      selected_job.project_id::text || '/custom-build-jobs/' ||
      selected_job.id::text || '/evidence/%';

  if not found then
    raise exception 'Custom build completion evidence document is not exact'
      using errcode = '23514';
  end if;

  select count(*)::integer into prior_evidence_count
  from ss.service_custom_build_completion_evidence evidence
  where evidence.organization_id = selected_job.organization_id
    and evidence.job_id = selected_job.id;

  if prior_evidence_count >= 12 then
    raise exception 'Custom build completion evidence is limited to 12 images'
      using errcode = '23514';
  end if;

  select snapshot.* into scope_snapshot
  from ss.service_custom_build_effective_scope_snapshot(
    selected_job.organization_id,
    selected_job.id
  ) snapshot;

  new.organization_id := selected_job.organization_id;
  new.project_id := selected_job.project_id;
  new.case_id := selected_job.case_id;
  new.customer_user_id := selected_job.customer_user_id;
  new.progress_revision := selected_progress.revision;
  new.effective_scope_digest := scope_snapshot.effective_scope_digest;
  new.content_digest := selected_document.content_digest;
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'accessibleDescription', new.accessible_description,
    'capturedAt', new.captured_at,
    'commandId', new.command_id,
    'contentDigest', new.content_digest,
    'documentId', new.document_id,
    'effectiveScopeDigest', new.effective_scope_digest,
    'imageHeight', new.image_height,
    'imageWidth', new.image_width,
    'jobId', new.job_id,
    'operatorUserId', new.created_by_operator_user_id,
    'progressRevision', new.progress_revision,
    'schema', 'sitesourcery.custom-build-completion-evidence-command/v1',
    'validatorVersion', new.validator_version,
    'viewport', new.viewport
  ));
  new.created_at := recorded_at;
  return new;
end
$$;

create trigger service_custom_build_completion_evidence_guard
before insert on ss.service_custom_build_completion_evidence
for each row execute function ss.guard_service_custom_build_completion_evidence();

create trigger service_custom_build_completion_evidence_immutable
before update or delete on ss.service_custom_build_completion_evidence
for each row execute function ss.reject_update();

do $$
declare
  function_signature text;
begin
  for function_signature in
    select procedure.oid::regprocedure::text
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'ss'
      and procedure.proname = 'guard_service_custom_build_completion_evidence'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end
$$;

create function ss.guard_service_custom_build_completion_package()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_progress record;
  scope_snapshot record;
  selected_evidence_count integer;
  includes_desktop boolean;
  includes_phone boolean;
  recorded_at timestamptz := clock_timestamp();
begin
  if new.job_id is null
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is null
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      recorded_at
    )
  then
    raise exception 'Custom build completion package lacks operator authority'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || new.job_id::text,
      0
    )
  );

  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = ss.current_service_actor_org_id()
    and job.id = new.job_id;

  select progress.* into selected_progress
  from ss.service_custom_build_progress_updates progress
  where progress.organization_id = selected_job.organization_id
    and progress.job_id = selected_job.id
  order by progress.revision desc
  limit 1;

  if selected_job.id is null
    or selected_job.state <> 'open'
    or selected_progress.id is null
    or new.progress_revision is distinct from selected_progress.revision
    or selected_progress.stage <> 'checking'
    or selected_progress.structure_milestone <> 'done'
    or selected_progress.content_milestone <> 'done'
    or selected_progress.responsive_milestone <> 'done'
    or selected_progress.quality_milestone <> 'done'
    or not coalesce(
      ss.service_custom_build_completion_evidence_ids_are_canonical(
        new.evidence_ids
      ),
      false
    )
    or not (
      new.scope_check_passed
      and new.desktop_check_passed
      and new.phone_check_passed
      and new.links_check_passed
      and new.contact_actions_check_passed
      and new.accessibility_basics_check_passed
    )
    or exists (
      select 1
      from ss.service_custom_build_work_requests request
      where request.organization_id = selected_job.organization_id
        and request.job_id = selected_job.id
        and request.state in ('open', 'answered')
    )
    or exists (
      select 1
      from ss.service_custom_build_change_orders change_order
      where change_order.organization_id = selected_job.organization_id
        and change_order.job_id = selected_job.id
        and change_order.state in (
          'issued', 'accepted_payment_required'
        )
    )
  then
    raise exception 'Custom build completion package lacks exact ready proof'
      using errcode = '23514';
  end if;

  select snapshot.* into scope_snapshot
  from ss.service_custom_build_effective_scope_snapshot(
    selected_job.organization_id,
    selected_job.id
  ) snapshot;

  select
    count(*)::integer,
    coalesce(bool_or(evidence.viewport = 'desktop'), false),
    coalesce(bool_or(evidence.viewport = 'phone'), false)
  into selected_evidence_count, includes_desktop, includes_phone
  from ss.service_custom_build_completion_evidence evidence
  where evidence.organization_id = selected_job.organization_id
    and evidence.project_id = selected_job.project_id
    and evidence.case_id = selected_job.case_id
    and evidence.customer_user_id = selected_job.customer_user_id
    and evidence.job_id = selected_job.id
    and evidence.progress_revision = selected_progress.revision
    and evidence.effective_scope_digest = scope_snapshot.effective_scope_digest
    and evidence.id = any(new.evidence_ids);

  if selected_evidence_count <> cardinality(new.evidence_ids)
    or not includes_desktop
    or not includes_phone
    or exists (
      select 1
      from ss.service_custom_build_completion_evidence desktop_evidence
      join ss.service_custom_build_completion_evidence phone_evidence
        on phone_evidence.organization_id = desktop_evidence.organization_id
       and phone_evidence.job_id = desktop_evidence.job_id
       and phone_evidence.content_digest = desktop_evidence.content_digest
      where desktop_evidence.organization_id = selected_job.organization_id
        and desktop_evidence.job_id = selected_job.id
        and desktop_evidence.viewport = 'desktop'
        and phone_evidence.viewport = 'phone'
        and desktop_evidence.id = any(new.evidence_ids)
        and phone_evidence.id = any(new.evidence_ids)
    )
  then
    raise exception
      'Custom build completion package lacks current distinct desktop and phone job evidence'
      using errcode = '23514';
  end if;

  new.organization_id := selected_job.organization_id;
  new.project_id := selected_job.project_id;
  new.case_id := selected_job.case_id;
  new.customer_user_id := selected_job.customer_user_id;
  new.base_scope_digest := scope_snapshot.base_scope_digest;
  new.effective_change_order_digests :=
    scope_snapshot.effective_change_order_digests;
  new.effective_scope_digest := scope_snapshot.effective_scope_digest;
  new.state := case
    when selected_job.final_due_minor > 0
      then 'ready_for_final_payment'
    else 'ready_for_delivery'
  end;
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'accessibilityBasicsCheckPassed',
      new.accessibility_basics_check_passed,
    'commandId', new.command_id,
    'contactActionsCheckPassed', new.contact_actions_check_passed,
    'customerSummary', new.customer_summary,
    'desktopCheckPassed', new.desktop_check_passed,
    'evidenceIds', new.evidence_ids,
    'jobId', new.job_id,
    'linksCheckPassed', new.links_check_passed,
    'phoneCheckPassed', new.phone_check_passed,
    'progressRevision', new.progress_revision,
    'schema', 'sitesourcery.custom-build-completion-package-command/v1',
    'scopeCheckPassed', new.scope_check_passed
  ));
  new.package_digest := ss.service_json_digest(jsonb_build_object(
    'baseScopeDigest', new.base_scope_digest,
    'customerSummary', new.customer_summary,
    'effectiveChangeOrderDigests', new.effective_change_order_digests,
    'effectiveScopeDigest', new.effective_scope_digest,
    'evidenceIds', new.evidence_ids,
    'jobId', new.job_id,
    'progressRevision', new.progress_revision,
    'requestDigest', new.request_digest,
    'schema', 'sitesourcery.custom-build-completion-package/v1',
    'state', new.state
  ));
  new.prepared_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create trigger service_custom_build_completion_packages_guard
before insert on ss.service_custom_build_completion_packages
for each row execute function ss.guard_service_custom_build_completion_package();

create trigger service_custom_build_completion_packages_immutable
before update or delete on ss.service_custom_build_completion_packages
for each row execute function ss.reject_update();

revoke all on function ss.guard_service_custom_build_completion_package()
from public, anon, authenticated, service_role;
grant execute on function ss.guard_service_custom_build_completion_package()
to service_role;

create function ss.hosted_runtime_contract_v44()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v44-custom-build-change-completion'::text
$$;

revoke all on function ss.hosted_runtime_contract_v44()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v44()
to service_role;

commit;
