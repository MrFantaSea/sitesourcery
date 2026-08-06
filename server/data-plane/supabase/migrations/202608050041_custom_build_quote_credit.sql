begin;

-- One assessment-backed Custom base-build quote lane. Money, installment
-- shape, and credit eligibility are database authority; browsers submit only
-- identifiers and exact reviewed digests.

create function ss.custom_build_amount_minor(
  selected_tier_id text,
  selected_scale_units integer
)
returns bigint
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_tier_id
    when 'card' then 40000
    when 'card-plus' then 65000
    when 'site' then 120000
    when 'site-plus' then 180000
    when 'signature' then 280000
    when 'flagship' then 400000
    when 'scale' then
      case
        when selected_scale_units between 1 and 15
          then 400000 + selected_scale_units::bigint * 27000
        else null
      end
    else null
  end
$$;

create function ss.custom_build_payment_schedule(selected_tier_id text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when selected_tier_id in ('card', 'card-plus') then 'full_before_work'
    when selected_tier_id in (
      'site', 'site-plus', 'signature', 'flagship', 'scale'
    ) then 'half_before_work_half_before_handoff'
    else null
  end
$$;

create function ss.custom_build_scale_units(
  crafted_pages integer,
  sections integer,
  unique_layouts integer,
  content_words integer,
  supplied_media integer
)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select greatest(
    greatest(crafted_pages - 15, 0),
    (greatest(sections - 60, 0) + 3) / 4,
    greatest(unique_layouts - 15, 0),
    (greatest(content_words - 7000, 0) + 499) / 500,
    (greatest(supplied_media - 60, 0) + 3) / 4
  )
$$;

create function ss.custom_build_footprint_is_valid(
  selected_tier_id text,
  selected_scale_units integer,
  crafted_pages integer,
  sections integer,
  unique_layouts integer,
  content_words integer,
  supplied_media integer
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select
    crafted_pages between 1 and 30
    and sections between 1 and 120
    and unique_layouts between 1 and 30
    and content_words between 0 and 14500
    and supplied_media between 0 and 120
    and case selected_tier_id
      when 'card' then selected_scale_units is null
        and crafted_pages <= 1 and sections <= 5 and unique_layouts <= 1
        and content_words <= 500 and supplied_media <= 2
      when 'card-plus' then selected_scale_units is null
        and crafted_pages <= 1 and sections <= 8 and unique_layouts <= 1
        and content_words <= 900 and supplied_media <= 8
      when 'site' then selected_scale_units is null
        and crafted_pages <= 4 and sections <= 16 and unique_layouts <= 4
        and content_words <= 1800 and supplied_media <= 12
      when 'site-plus' then selected_scale_units is null
        and crafted_pages <= 7 and sections <= 28 and unique_layouts <= 7
        and content_words <= 3000 and supplied_media <= 24
      when 'signature' then selected_scale_units is null
        and crafted_pages <= 10 and sections <= 40 and unique_layouts <= 10
        and content_words <= 4500 and supplied_media <= 36
      when 'flagship' then selected_scale_units is null
        and crafted_pages <= 15 and sections <= 60 and unique_layouts <= 15
        and content_words <= 7000 and supplied_media <= 60
      when 'scale' then
        selected_scale_units between 1 and 15
        and selected_scale_units = ss.custom_build_scale_units(
          crafted_pages,
          sections,
          unique_layouts,
          content_words,
          supplied_media
        )
      else false
    end
$$;

create function ss.custom_build_policy_id(selected_tier_id text)
returns uuid
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_tier_id
    when 'card' then '00000000-0000-4000-8000-000000000411'::uuid
    when 'card-plus' then '00000000-0000-4000-8000-000000000412'::uuid
    when 'site' then '00000000-0000-4000-8000-000000000413'::uuid
    when 'site-plus' then '00000000-0000-4000-8000-000000000414'::uuid
    when 'signature' then '00000000-0000-4000-8000-000000000415'::uuid
    when 'flagship' then '00000000-0000-4000-8000-000000000416'::uuid
    when 'scale' then '00000000-0000-4000-8000-000000000417'::uuid
    else null
  end
$$;

create function ss.custom_build_quote_digest(
  digest_kind text,
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  quote_id uuid,
  quote_revision bigint,
  source_report_id uuid,
  policy_id uuid,
  scope_boundary_digest ss.sha256_hex,
  tier_id text,
  scale_units integer,
  crafted_pages integer,
  sections integer,
  unique_layouts integer,
  content_words integer,
  supplied_media integer,
  creativity_level text,
  scope_statement text,
  service_amount_minor bigint,
  credit_grant_id uuid,
  credit_digest ss.sha256_hex,
  credit_acceptance_cutoff timestamptz,
  credit_amount_minor bigint,
  customer_amount_minor bigint,
  currency text,
  tax_state text,
  payment_schedule text,
  start_value_minor bigint,
  start_credit_minor bigint,
  start_due_minor bigint,
  final_due_minor bigint,
  workmanship_correction_days integer,
  target_completion_date date,
  commercial_contract_id text,
  commercial_contract_digest ss.sha256_hex,
  issued_at timestamptz,
  expires_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'commercialContractDigest', commercial_contract_digest,
    'commercialContractId', commercial_contract_id,
    'creativityLevel', creativity_level,
    'creditAcceptanceCutoff', credit_acceptance_cutoff,
    'creditAmountMinor', credit_amount_minor,
    'creditDigest', credit_digest,
    'creditGrantId', credit_grant_id,
    'currency', currency,
    'customerAmountMinor', customer_amount_minor,
    'customerId', customer_user_id,
    'digestKind', digest_kind,
    'expiresAt', expires_at,
    'finalDueMinor', final_due_minor,
    'footprint', jsonb_build_object(
      'contentWords', content_words,
      'craftedPages', crafted_pages,
      'sections', sections,
      'suppliedMedia', supplied_media,
      'uniqueLayouts', unique_layouts
    ),
    'issuedAt', issued_at,
    'organizationId', organization_id,
    'paymentSchedule', payment_schedule,
    'policyId', policy_id,
    'projectId', project_id,
    'quoteId', quote_id,
    'quoteRevision', quote_revision,
    'scaleUnits', scale_units,
    'schema', 'sitesourcery.custom-build-quote/v1',
    'scopeBoundaryDigest', scope_boundary_digest,
    'scopeStatement', scope_statement,
    'serviceAmountMinor', service_amount_minor,
    'sourceReportId', source_report_id,
    'startCreditMinor', start_credit_minor,
    'startDueMinor', start_due_minor,
    'startValueMinor', start_value_minor,
    'taxState', tax_state,
    'targetCompletionDate', target_completion_date,
    'tierId', tier_id,
    'workmanshipCorrectionDays', workmanship_correction_days
  ))
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
  tier.policy_id,
  'SS-PROFESSIONAL-2026.2',
  'custom_build_' || replace(tier.tier_id, '-', '_'),
  tier.label || ' Custom website build',
  tier.pricing_mode,
  'one_time',
  'USD',
  tier.amount_minor,
  'base build',
  1,
  1,
  jsonb_build_object(
    'assessmentCredit', jsonb_build_object(
      'amountMinor', 20000,
      'applicationScope', 'custom_base_build',
      'currency', 'USD',
      'maximumApplications', 1,
      'nonCash', true,
      'sameOrganizationAndProjectOnly', true
    ),
    'baseBuild', jsonb_build_object(
      'amountMinor', tier.amount_minor,
      'limits', jsonb_build_object(
        'contentWords', tier.maximum_words,
        'craftedPages', tier.maximum_pages,
        'sections', tier.maximum_sections,
        'suppliedMedia', tier.maximum_media,
        'uniqueLayouts', tier.maximum_layouts
      ),
      'tierId', tier.tier_id
    ),
    'creativityLevel', 'essential',
    'paymentSchedules', jsonb_build_object(
      'cardThroughCardPlus', 'full_before_work',
      'siteThroughScale', 'half_before_work_half_before_handoff'
    ),
    'publicCatalogDigest',
      'c1259ad9efe9fd0909bf431e2f008feb8e6f1fc1e53acd0b34304312358fe1a1',
    'scale', case when tier.tier_id = 'scale' then jsonb_build_object(
        'allowancePerUnit', jsonb_build_object(
          'contentWords', 500,
          'craftedPages', 1,
          'sections', 4,
          'suppliedMedia', 4,
          'uniqueLayouts', 1
        ),
        'baseAmountMinor', 400000,
        'baseTierId', 'flagship',
        'maximumCapacityUnits', 15,
        'minimumCapacityUnits', 1,
        'unitAmountMinor', 27000
      ) else null end,
    'workmanshipCorrectionDays', 30
  ),
  document.id,
  document.version,
  document.content_digest,
  'held',
  '2026-08-05T00:00:00Z'
from ss.legal_documents document
cross join (
  values
    (
      '00000000-0000-4000-8000-000000000411'::uuid,
      'card', 'Card', 'fixed', 40000::bigint, 1, 5, 1, 500, 2
    ),
    (
      '00000000-0000-4000-8000-000000000412'::uuid,
      'card-plus', 'Card Plus', 'fixed', 65000::bigint, 1, 8, 1, 900, 8
    ),
    (
      '00000000-0000-4000-8000-000000000413'::uuid,
      'site', 'Site', 'fixed', 120000::bigint, 4, 16, 4, 1800, 12
    ),
    (
      '00000000-0000-4000-8000-000000000414'::uuid,
      'site-plus', 'Site Plus', 'fixed', 180000::bigint, 7, 28, 7, 3000, 24
    ),
    (
      '00000000-0000-4000-8000-000000000415'::uuid,
      'signature', 'Signature', 'fixed', 280000::bigint, 10, 40, 10, 4500, 36
    ),
    (
      '00000000-0000-4000-8000-000000000416'::uuid,
      'flagship', 'Flagship', 'fixed', 400000::bigint, 15, 60, 15, 7000, 60
    ),
    (
      '00000000-0000-4000-8000-000000000417'::uuid,
      'scale', 'Scale', 'banded', null::bigint, 30, 120, 30, 14500, 120
    )
) as tier(
  policy_id,
  tier_id,
  label,
  pricing_mode,
  amount_minor,
  maximum_pages,
  maximum_sections,
  maximum_layouts,
  maximum_words,
  maximum_media
)
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
  'project',
  policy.scope_boundary_digest
from ss.service_catalog_policies policy
cross join (
  values
    ('custom_base_build'),
    ('essential_design'),
    ('responsive_build'),
    ('workmanship_correction')
) as coverage(coverage_key)
where policy.id between
  '00000000-0000-4000-8000-000000000411'::uuid and
  '00000000-0000-4000-8000-000000000417'::uuid;

alter table ss.service_credit_grants
  add constraint service_credit_grants_digest_identity
  unique (organization_id, id, credit_digest);

create table ss.service_custom_build_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  source_job_id uuid not null,
  source_report_id uuid not null,
  state text not null default 'issued'
    check (state in ('issued', 'accepted', 'voided')),
  current_revision bigint not null default 0 check (current_revision >= 0),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, customer_user_id, case_id)
    references ss.service_cases(
      organization_id,
      project_id,
      customer_user_id,
      id
    ),
  foreign key (organization_id, source_job_id, source_report_id)
    references ss.service_assessment_reports(organization_id, job_id, id),
  unique (organization_id, id),
  unique (organization_id, source_report_id, id)
);

create unique index service_custom_build_quotes_one_active_report
  on ss.service_custom_build_quotes(source_report_id)
  where state in ('issued', 'accepted');

create unique index service_custom_build_quotes_one_active_project
  on ss.service_custom_build_quotes(project_id)
  where state in ('issued', 'accepted');

create table ss.service_custom_build_quote_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  source_report_id uuid not null,
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  tier_id text not null
    check (tier_id in (
      'card', 'card-plus', 'site', 'site-plus',
      'signature', 'flagship', 'scale'
    )),
  scale_units integer,
  crafted_pages integer not null check (crafted_pages between 1 and 30),
  sections integer not null check (sections between 1 and 120),
  unique_layouts integer not null check (unique_layouts between 1 and 30),
  content_words integer not null check (content_words between 0 and 14500),
  supplied_media integer not null check (supplied_media between 0 and 120),
  creativity_level text not null check (creativity_level = 'essential'),
  scope_statement text not null
    check (
      char_length(scope_statement) between 20 and 2000
      and ss.service_text_excludes_credentials(scope_statement)
    ),
  service_amount_minor bigint not null check (service_amount_minor >= 40000),
  provider_direct_amount_minor bigint not null
    check (provider_direct_amount_minor = 0),
  credit_grant_id uuid not null,
  credit_digest ss.sha256_hex not null,
  credit_acceptance_cutoff timestamptz not null,
  credit_amount_minor bigint not null check (credit_amount_minor = 20000),
  customer_amount_minor bigint not null check (customer_amount_minor >= 0),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'calculation_required'),
  payment_schedule text not null
    check (payment_schedule in (
      'full_before_work',
      'half_before_work_half_before_handoff'
    )),
  start_value_minor bigint not null check (start_value_minor > 0),
  start_credit_minor bigint not null check (start_credit_minor = 20000),
  start_due_minor bigint not null check (start_due_minor >= 0),
  final_due_minor bigint not null check (final_due_minor >= 0),
  workmanship_correction_days integer not null
    check (workmanship_correction_days = 30),
  target_completion_date date not null,
  commercial_contract_id text not null,
  commercial_contract_digest ss.sha256_hex not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  quote_digest ss.sha256_hex generated always as (
    ss.custom_build_quote_digest(
      'snapshot',
      organization_id,
      project_id,
      customer_user_id,
      quote_id,
      quote_revision,
      source_report_id,
      policy_id,
      scope_boundary_digest,
      tier_id,
      scale_units,
      crafted_pages,
      sections,
      unique_layouts,
      content_words,
      supplied_media,
      creativity_level,
      scope_statement,
      service_amount_minor,
      credit_grant_id,
      credit_digest,
      credit_acceptance_cutoff,
      credit_amount_minor,
      customer_amount_minor,
      currency,
      tax_state,
      payment_schedule,
      start_value_minor,
      start_credit_minor,
      start_due_minor,
      final_due_minor,
      workmanship_correction_days,
      target_completion_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  disclosure_digest ss.sha256_hex generated always as (
    ss.custom_build_quote_digest(
      'customer_disclosure',
      organization_id,
      project_id,
      customer_user_id,
      quote_id,
      quote_revision,
      source_report_id,
      policy_id,
      scope_boundary_digest,
      tier_id,
      scale_units,
      crafted_pages,
      sections,
      unique_layouts,
      content_words,
      supplied_media,
      creativity_level,
      scope_statement,
      service_amount_minor,
      credit_grant_id,
      credit_digest,
      credit_acceptance_cutoff,
      credit_amount_minor,
      customer_amount_minor,
      currency,
      tax_state,
      payment_schedule,
      start_value_minor,
      start_credit_minor,
      start_due_minor,
      final_due_minor,
      workmanship_correction_days,
      target_completion_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, quote_id)
    references ss.service_custom_build_quotes(organization_id, id),
  foreign key (organization_id, source_report_id, quote_id)
    references ss.service_custom_build_quotes(
      organization_id, source_report_id, id
    ),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  foreign key (organization_id, credit_grant_id, credit_digest)
    references ss.service_credit_grants(organization_id, id, credit_digest),
  unique (organization_id, id),
  unique (quote_id, quote_revision),
  unique (organization_id, quote_id, quote_revision, id),
  check (
    (tier_id = 'scale' and scale_units between 1 and 15)
    or (tier_id <> 'scale' and scale_units is null)
  ),
  check (policy_id = ss.custom_build_policy_id(tier_id)),
  check (ss.custom_build_footprint_is_valid(
    tier_id,
    scale_units,
    crafted_pages,
    sections,
    unique_layouts,
    content_words,
    supplied_media
  )),
  check (service_amount_minor = ss.custom_build_amount_minor(tier_id, scale_units)),
  check (payment_schedule = ss.custom_build_payment_schedule(tier_id)),
  check (customer_amount_minor = service_amount_minor - credit_amount_minor),
  check (start_credit_minor = credit_amount_minor),
  check (start_due_minor = start_value_minor - start_credit_minor),
  check (
    (payment_schedule = 'full_before_work'
      and start_value_minor = service_amount_minor
      and final_due_minor = 0)
    or (payment_schedule = 'half_before_work_half_before_handoff'
      and start_value_minor = service_amount_minor / 2
      and final_due_minor = service_amount_minor - start_value_minor)
  ),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '30 days'),
  check (expires_at <= credit_acceptance_cutoff),
  check (target_completion_date > (issued_at at time zone 'UTC')::date),
  check (target_completion_date <= (issued_at at time zone 'UTC')::date + 730),
  check (
    commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
    and commercial_contract_digest =
      '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
  )
);

create table ss.service_custom_build_quote_base_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  quote_revision_id uuid not null,
  line_number integer not null check (line_number = 1),
  policy_id uuid not null,
  component_key text not null check (component_key = 'custom_base_build'),
  display_name text not null
    check (char_length(display_name) between 3 and 120),
  line_category text not null check (line_category = 'service'),
  quantity integer not null check (quantity = 1),
  unit_label text not null check (unit_label = 'base build'),
  unit_amount_minor bigint not null check (unit_amount_minor >= 40000),
  credit_amount_minor bigint not null check (credit_amount_minor = 20000),
  customer_amount_minor bigint not null check (customer_amount_minor >= 0),
  provider_direct_amount_minor bigint not null
    check (provider_direct_amount_minor = 0),
  scope_boundary_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id)
    references ss.service_custom_build_quote_revisions(organization_id, id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (quote_revision_id, line_number),
  unique (organization_id, id),
  check (customer_amount_minor = unit_amount_minor - credit_amount_minor)
);

create table ss.service_custom_build_quote_installments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_revision_id uuid not null,
  installment_number integer not null check (installment_number in (1, 2)),
  installment_kind text not null check (installment_kind in ('start', 'final')),
  gross_value_minor bigint not null check (gross_value_minor > 0),
  credit_amount_minor bigint not null check (credit_amount_minor in (0, 20000)),
  amount_due_minor bigint not null check (amount_due_minor >= 0),
  currency text not null check (currency = 'USD'),
  due_trigger text not null
    check (due_trigger in ('before_work', 'before_handoff')),
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id)
    references ss.service_custom_build_quote_revisions(organization_id, id),
  unique (quote_revision_id, installment_number),
  unique (organization_id, id),
  check (amount_due_minor = gross_value_minor - credit_amount_minor),
  check (
    (installment_number = 1
      and installment_kind = 'start'
      and credit_amount_minor = 20000
      and due_trigger = 'before_work')
    or (installment_number = 2
      and installment_kind = 'final'
      and credit_amount_minor = 0
      and due_trigger = 'before_handoff')
  )
);

create table ss.service_custom_build_quote_commands (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  quote_revision_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  operator_user_id uuid not null references ss.operator_profiles(user_id),
  command_kind text not null check (command_kind = 'issue'),
  command_id text not null
    check (
      char_length(command_id) between 8 and 200
      and command_id !~ '[[:cntrl:]]'
    ),
  request_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, quote_id, quote_revision, quote_revision_id)
    references ss.service_custom_build_quote_revisions(
      organization_id, quote_id, quote_revision, id
    ),
  unique (operator_user_id, quote_id, command_id),
  unique (quote_id, quote_revision),
  unique (organization_id, id)
);

create table ss.service_custom_build_quote_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  quote_revision_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  accepted_by_user_id uuid not null references auth.users(id),
  source text not null default 'account' check (source = 'account'),
  acceptance_statement text not null
    check (acceptance_statement = 'accepted_exact_custom_build_quote'),
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  command_id text not null
    check (
      char_length(command_id) between 8 and 200
      and command_id !~ '[[:cntrl:]]'
    ),
  request_digest ss.sha256_hex not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  accepted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, quote_id)
    references ss.service_custom_build_quotes(organization_id, id),
  foreign key (organization_id, quote_id, quote_revision, quote_revision_id)
    references ss.service_custom_build_quote_revisions(
      organization_id, quote_id, quote_revision, id
    ),
  unique (quote_id),
  unique (customer_user_id, command_id),
  unique (organization_id, id),
  check (accepted_by_user_id = customer_user_id)
);

create table ss.service_credit_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  credit_grant_id uuid not null,
  credit_digest ss.sha256_hex not null,
  quote_id uuid not null,
  quote_acceptance_id uuid not null,
  amount_minor bigint not null check (amount_minor = 20000),
  currency text not null check (currency = 'USD'),
  state text not null default 'reserved'
    check (state in ('reserved', 'settled', 'released', 'reconciliation_required')),
  reserved_at timestamptz not null,
  settled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, credit_grant_id, credit_digest)
    references ss.service_credit_grants(organization_id, id, credit_digest),
  foreign key (organization_id, quote_id)
    references ss.service_custom_build_quotes(organization_id, id),
  foreign key (organization_id, quote_acceptance_id)
    references ss.service_custom_build_quote_acceptances(organization_id, id),
  unique (quote_acceptance_id),
  unique (organization_id, id),
  check (
    (state = 'reserved' and settled_at is null and released_at is null)
    or (state = 'settled' and settled_at is not null and released_at is null)
    or (state = 'released' and settled_at is null and released_at is not null)
    or (state = 'reconciliation_required' and released_at is null)
  )
);

create unique index service_credit_applications_one_active_grant
  on ss.service_credit_applications(credit_grant_id)
  where state in ('reserved', 'settled', 'reconciliation_required');

create table ss.service_custom_build_quote_voids (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_id uuid not null,
  operator_user_id uuid not null references ss.operator_profiles(user_id),
  command_id text not null
    check (
      char_length(command_id) between 8 and 200
      and command_id !~ '[[:cntrl:]]'
    ),
  request_digest ss.sha256_hex not null,
  reason text not null
    check (
      char_length(reason) between 10 and 500
      and ss.service_text_excludes_credentials(reason)
    ),
  voided_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, quote_id)
    references ss.service_custom_build_quotes(organization_id, id),
  unique (quote_id),
  unique (operator_user_id, command_id),
  unique (organization_id, id)
);

create function ss.custom_build_tier_label(selected_tier_id text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case selected_tier_id
    when 'card' then 'Card'
    when 'card-plus' then 'Card Plus'
    when 'site' then 'Site'
    when 'site-plus' then 'Site Plus'
    when 'signature' then 'Signature'
    when 'flagship' then 'Flagship'
    when 'scale' then 'Scale'
    else null
  end
$$;

create function ss.prepare_service_custom_build_quote()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  source record;
  recorded_at timestamptz := clock_timestamp();
begin
  select
    report.organization_id,
    report.project_id,
    report.case_id,
    report.customer_user_id,
    report.job_id,
    report.id as report_id
  into source
  from ss.service_assessment_reports report
  join ss.service_cases service_case
    on service_case.organization_id = report.organization_id
   and service_case.project_id = report.project_id
   and service_case.id = report.case_id
   and service_case.customer_user_id = report.customer_user_id
  join ss.organizations organization
    on organization.id = report.organization_id
  join ss.projects project
    on project.organization_id = report.organization_id
   and project.id = report.project_id
  join ss.organization_memberships membership
    on membership.organization_id = report.organization_id
   and membership.user_id = report.customer_user_id
  join auth.users customer_user
    on customer_user.id = report.customer_user_id
  join ss.hosted_account_profiles account_profile
    on account_profile.user_id = report.customer_user_id
  where report.id = new.source_report_id
    and service_case.state = 'submitted'
    and organization.state = 'active'
    and project.lifecycle = 'active'
    and membership.state = 'active'
    and membership.role in ('owner', 'admin')
    and customer_user.disabled_at is null
    and account_profile.state = 'active';

  if not found
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from source.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    or new.current_revision <> 0
    or new.state <> 'issued'
  then
    raise exception 'custom build quote requires one eligible delivered assessment'
      using errcode = '42501';
  end if;

  new.organization_id := source.organization_id;
  new.project_id := source.project_id;
  new.case_id := source.case_id;
  new.customer_user_id := source.customer_user_id;
  new.source_job_id := source.job_id;
  new.source_report_id := source.report_id;
  new.state := 'issued';
  new.current_revision := 0;
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.created_at := recorded_at;
  new.updated_at := recorded_at;
  return new;
end
$$;

create function ss.guard_service_custom_build_quote_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  recorded_at timestamptz := clock_timestamp();
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.source_job_id,
    new.source_report_id,
    new.created_by_operator_user_id,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.source_job_id,
    old.source_report_id,
    old.created_by_operator_user_id,
    old.created_at
  ) then
    raise exception 'custom build quote identity is immutable'
      using errcode = '55000';
  end if;

  if new.current_revision = old.current_revision + 1
    and new.state = old.state
    and old.state = 'issued'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
  then
    new.updated_at := recorded_at;
    return new;
  end if;

  if new.current_revision = old.current_revision
    and old.state = 'issued'
    and new.state = 'accepted'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
    and exists (
      select 1
      from ss.service_custom_build_quote_acceptances acceptance
      where acceptance.quote_id = old.id
    )
  then
    new.updated_at := recorded_at;
    return new;
  end if;

  if new.current_revision = old.current_revision
    and old.state in ('issued', 'accepted')
    and new.state = 'voided'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    and exists (
      select 1
      from ss.service_custom_build_quote_voids quote_void
      where quote_void.quote_id = old.id
    )
  then
    new.updated_at := recorded_at;
    return new;
  end if;

  raise exception 'custom build quote transition is not an authorized append'
    using errcode = '55000';
end
$$;

create function ss.prepare_service_custom_build_quote_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  quote_record record;
  policy_record record;
  credit_record record;
  recorded_at timestamptz := clock_timestamp();
  requested_tier_id text := new.tier_id;
  requested_crafted_pages integer := new.crafted_pages;
  requested_sections integer := new.sections;
  requested_unique_layouts integer := new.unique_layouts;
  requested_content_words integer := new.content_words;
  requested_supplied_media integer := new.supplied_media;
  requested_scope_statement text := new.scope_statement;
  requested_target_completion_date date := new.target_completion_date;
  requested_expires_at timestamptz := new.expires_at;
  exact_scale_units integer;
  exact_service_amount_minor bigint;
  exact_payment_schedule text;
  exact_start_value_minor bigint;
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = new.quote_id
  for update;

  if not found
    or quote_record.state <> 'issued'
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
       quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    or exists (
      select 1
      from ss.service_custom_build_quote_acceptances acceptance
      where acceptance.quote_id = quote_record.id
    )
    or exists (
      select 1
      from ss.service_custom_build_quote_voids quote_void
      where quote_void.quote_id = quote_record.id
    )
  then
    raise exception 'custom build quote revision lacks current operator authority'
      using errcode = '42501';
  end if;

  if requested_tier_id = 'scale' then
    exact_scale_units := ss.custom_build_scale_units(
      requested_crafted_pages,
      requested_sections,
      requested_unique_layouts,
      requested_content_words,
      requested_supplied_media
    );
  else
    exact_scale_units := null;
  end if;

  if not ss.custom_build_footprint_is_valid(
    requested_tier_id,
    exact_scale_units,
    requested_crafted_pages,
    requested_sections,
    requested_unique_layouts,
    requested_content_words,
    requested_supplied_media
  )
    or requested_scope_statement is null
    or char_length(requested_scope_statement) not between 20 and 2000
    or not ss.service_text_excludes_credentials(requested_scope_statement)
  then
    raise exception 'custom build quote scope is outside its exact tier boundary'
      using errcode = '23514';
  end if;

  select
    policy.*,
    document.id as exact_legal_document_id
  into policy_record
  from ss.service_catalog_policies policy
  join ss.legal_documents document
    on document.id = policy.legal_document_id
   and document.version = policy.commercial_contract_id
   and document.content_digest = policy.commercial_contract_digest
   and document.kind = 'custom_services'
   and document.retired_at is null
  where policy.id = ss.custom_build_policy_id(requested_tier_id)
    and policy.catalog_version = 'SS-PROFESSIONAL-2026.2'
    and policy.service_key =
      'custom_build_' || replace(requested_tier_id, '-', '_')
    and policy.currency = 'USD'
    and policy.publication_state = 'held'
    and (
      (requested_tier_id = 'scale'
        and policy.pricing_mode = 'banded'
        and policy.unit_amount_minor is null)
      or (requested_tier_id <> 'scale'
        and policy.pricing_mode = 'fixed'
        and policy.unit_amount_minor = ss.custom_build_amount_minor(
          requested_tier_id,
          null
        ))
    );

  if not found then
    raise exception 'custom build quote lacks its exact held catalog policy'
      using errcode = '23514';
  end if;

  select credit.* into credit_record
  from ss.service_credit_grants credit
  where credit.organization_id = quote_record.organization_id
    and credit.project_id = quote_record.project_id
    and credit.case_id = quote_record.case_id
    and credit.customer_user_id = quote_record.customer_user_id
    and credit.source_report_id = quote_record.source_report_id
    and credit.source_job_id = quote_record.source_job_id
    and credit.amount_minor = 20000
    and credit.currency = 'USD'
    and credit.application_scope = 'custom_base_build'
    and requested_tier_id = any(credit.eligible_tier_ids)
    and credit.maximum_applications = 1
    and credit.non_cash
    and credit.acceptance_cutoff > recorded_at
    and not exists (
      select 1
      from ss.service_credit_applications application
      where application.credit_grant_id = credit.id
        and application.state in (
          'reserved', 'settled', 'reconciliation_required'
        )
    )
  for update of credit;

  if not found then
    raise exception 'custom build quote lacks one available assessment credit'
      using errcode = '23514';
  end if;

  if requested_expires_at is null
    or requested_expires_at <= recorded_at
    or requested_expires_at > recorded_at + interval '30 days'
    or requested_expires_at > credit_record.acceptance_cutoff
    or requested_target_completion_date is null
    or requested_target_completion_date <=
       (recorded_at at time zone 'UTC')::date
    or requested_target_completion_date >
       (recorded_at at time zone 'UTC')::date + 730
  then
    raise exception 'custom build quote timing exceeds its bounded authority'
      using errcode = '23514';
  end if;

  exact_service_amount_minor := ss.custom_build_amount_minor(
    requested_tier_id,
    exact_scale_units
  );
  exact_payment_schedule := ss.custom_build_payment_schedule(requested_tier_id);
  exact_start_value_minor := case exact_payment_schedule
    when 'full_before_work' then exact_service_amount_minor
    else exact_service_amount_minor / 2
  end;

  new.organization_id := quote_record.organization_id;
  new.project_id := quote_record.project_id;
  new.case_id := quote_record.case_id;
  new.customer_user_id := quote_record.customer_user_id;
  new.quote_revision := quote_record.current_revision + 1;
  new.source_report_id := quote_record.source_report_id;
  new.policy_id := policy_record.id;
  new.scope_boundary_digest := policy_record.scope_boundary_digest;
  new.tier_id := requested_tier_id;
  new.scale_units := exact_scale_units;
  new.crafted_pages := requested_crafted_pages;
  new.sections := requested_sections;
  new.unique_layouts := requested_unique_layouts;
  new.content_words := requested_content_words;
  new.supplied_media := requested_supplied_media;
  new.creativity_level := 'essential';
  new.scope_statement := requested_scope_statement;
  new.service_amount_minor := exact_service_amount_minor;
  new.provider_direct_amount_minor := 0;
  new.credit_grant_id := credit_record.id;
  new.credit_digest := credit_record.credit_digest;
  new.credit_acceptance_cutoff := credit_record.acceptance_cutoff;
  new.credit_amount_minor := 20000;
  new.customer_amount_minor := exact_service_amount_minor - 20000;
  new.currency := 'USD';
  new.tax_state := 'calculation_required';
  new.payment_schedule := exact_payment_schedule;
  new.start_value_minor := exact_start_value_minor;
  new.start_credit_minor := 20000;
  new.start_due_minor := exact_start_value_minor - 20000;
  new.final_due_minor := exact_service_amount_minor - exact_start_value_minor;
  new.workmanship_correction_days := 30;
  new.target_completion_date := requested_target_completion_date;
  new.commercial_contract_id := policy_record.commercial_contract_id;
  new.commercial_contract_digest := policy_record.commercial_contract_digest;
  new.legal_document_id := policy_record.exact_legal_document_id;
  new.issued_at := recorded_at;
  new.expires_at := requested_expires_at;
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.created_at := recorded_at;

  update ss.service_custom_build_quotes
  set current_revision = new.quote_revision
  where id = quote_record.id;
  return new;
end
$$;

create function ss.materialize_service_custom_build_quote()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
begin
  insert into ss.service_custom_build_quote_base_lines (
    organization_id,
    project_id,
    quote_revision_id,
    line_number,
    policy_id,
    component_key,
    display_name,
    line_category,
    quantity,
    unit_label,
    unit_amount_minor,
    credit_amount_minor,
    customer_amount_minor,
    provider_direct_amount_minor,
    scope_boundary_digest,
    created_at
  ) values (
    new.organization_id,
    new.project_id,
    new.id,
    1,
    new.policy_id,
    'custom_base_build',
    ss.custom_build_tier_label(new.tier_id) || ' Custom website build',
    'service',
    1,
    'base build',
    new.service_amount_minor,
    new.credit_amount_minor,
    new.customer_amount_minor,
    0,
    new.scope_boundary_digest,
    new.created_at
  );

  insert into ss.service_custom_build_quote_installments (
    organization_id,
    quote_revision_id,
    installment_number,
    installment_kind,
    gross_value_minor,
    credit_amount_minor,
    amount_due_minor,
    currency,
    due_trigger,
    created_at
  ) values (
    new.organization_id,
    new.id,
    1,
    'start',
    new.start_value_minor,
    new.start_credit_minor,
    new.start_due_minor,
    'USD',
    'before_work',
    new.created_at
  );

  if new.final_due_minor > 0 then
    insert into ss.service_custom_build_quote_installments (
      organization_id,
      quote_revision_id,
      installment_number,
      installment_kind,
      gross_value_minor,
      credit_amount_minor,
      amount_due_minor,
      currency,
      due_trigger,
      created_at
    ) values (
      new.organization_id,
      new.id,
      2,
      'final',
      new.final_due_minor,
      0,
      new.final_due_minor,
      'USD',
      'before_handoff',
      new.created_at
    );
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_quote_command()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  revision_record record;
  recorded_at timestamptz := clock_timestamp();
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = new.quote_id
  for update;

  if not found
    or quote_record.state <> 'issued'
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
       quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
  then
    raise exception 'custom build quote command lacks operator authority'
      using errcode = '42501';
  end if;

  select revision.* into revision_record
  from ss.service_custom_build_quote_revisions revision
  where revision.quote_id = quote_record.id
    and revision.quote_revision = quote_record.current_revision;

  if not found then
    raise exception 'custom build quote command lacks its exact current revision'
      using errcode = '23514';
  end if;

  new.organization_id := quote_record.organization_id;
  new.quote_revision_id := revision_record.id;
  new.quote_revision := revision_record.quote_revision;
  new.operator_user_id := ss.current_service_actor_user_id();
  new.command_kind := 'issue';
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'commandId', new.command_id,
    'commandKind', 'issue',
    'operatorUserId', new.operator_user_id,
    'organizationId', new.organization_id,
    'quoteDigest', revision_record.quote_digest,
    'quoteId', quote_record.id,
    'quoteRevision', revision_record.quote_revision,
    'schema', 'sitesourcery.custom-build-quote-command/v1'
  ));
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.validate_service_custom_build_quote_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  new_record jsonb := to_jsonb(new);
  target_quote_id uuid := coalesce(
    nullif(new_record ->> 'quote_id', '')::uuid,
    nullif(new_record ->> 'id', '')::uuid
  );
  quote_record record;
  revision_record record;
  installment_count integer;
  installment_gross bigint;
  installment_credit bigint;
  installment_due bigint;
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = target_quote_id;

  select revision.* into revision_record
  from ss.service_custom_build_quote_revisions revision
  where revision.quote_id = target_quote_id
    and revision.quote_revision = quote_record.current_revision;

  select
    count(*)::integer,
    coalesce(sum(installment.gross_value_minor), 0),
    coalesce(sum(installment.credit_amount_minor), 0),
    coalesce(sum(installment.amount_due_minor), 0)
  into
    installment_count,
    installment_gross,
    installment_credit,
    installment_due
  from ss.service_custom_build_quote_installments installment
  where installment.quote_revision_id = revision_record.id;

  if quote_record.id is null
    or revision_record.id is null
    or quote_record.current_revision <> revision_record.quote_revision
    or quote_record.current_revision is distinct from (
      select coalesce(max(revision.quote_revision), 0)
      from ss.service_custom_build_quote_revisions revision
      where revision.quote_id = quote_record.id
    )
    or not exists (
      select 1
      from ss.service_custom_build_quote_commands command
      where command.quote_id = revision_record.quote_id
        and command.quote_revision = revision_record.quote_revision
        and command.quote_revision_id = revision_record.id
    )
    or not exists (
      select 1
      from ss.service_custom_build_quote_base_lines line
      where line.quote_revision_id = revision_record.id
        and line.unit_amount_minor = revision_record.service_amount_minor
        and line.credit_amount_minor = revision_record.credit_amount_minor
        and line.customer_amount_minor = revision_record.customer_amount_minor
    )
    or installment_count <> (case
      when revision_record.final_due_minor = 0 then 1 else 2
    end)
    or installment_gross <> revision_record.service_amount_minor
    or installment_credit <> revision_record.credit_amount_minor
    or installment_due <> revision_record.customer_amount_minor
  then
    raise exception 'custom build quote revision lacks exact append evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  revision_record record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_revision bigint := new.quote_revision;
  claimed_quote_digest ss.sha256_hex := new.accepted_quote_digest;
  claimed_disclosure_digest ss.sha256_hex := new.accepted_disclosure_digest;
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = new.quote_id
  for update;

  if not found then
    raise exception 'custom build quote acceptance target is missing'
      using errcode = '23514';
  end if;

  select revision.* into revision_record
  from ss.service_custom_build_quote_revisions revision
  where revision.quote_id = quote_record.id
    and revision.quote_revision = quote_record.current_revision;

  if not found
    or quote_record.state <> 'issued'
    or revision_record.expires_at <= recorded_at
    or revision_record.credit_acceptance_cutoff <= recorded_at
    or claimed_quote_revision is distinct from revision_record.quote_revision
    or claimed_quote_digest is distinct from revision_record.quote_digest
    or claimed_disclosure_digest is distinct from revision_record.disclosure_digest
    or new.acceptance_statement <> 'accepted_exact_custom_build_quote'
    or not exists (
      select 1
      from ss.service_custom_build_quote_commands command
      where command.quote_id = revision_record.quote_id
        and command.quote_revision_id = revision_record.id
        and command.quote_revision = revision_record.quote_revision
    )
  then
    raise exception 'custom build quote acceptance no longer matches current quote'
      using errcode = '23514';
  end if;

  if ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from
       quote_record.customer_user_id
    or ss.current_service_actor_org_id() is distinct from
       quote_record.organization_id
    or not exists (
      select 1
      from ss.projects project
      join ss.organizations organization
        on organization.id = project.organization_id
      join ss.organization_memberships membership
        on membership.organization_id = project.organization_id
       and membership.user_id = quote_record.customer_user_id
      join auth.users customer_user
        on customer_user.id = quote_record.customer_user_id
      join ss.hosted_account_profiles account_profile
        on account_profile.user_id = quote_record.customer_user_id
      where project.organization_id = quote_record.organization_id
        and project.id = quote_record.project_id
        and project.lifecycle = 'active'
        and organization.state = 'active'
        and membership.state = 'active'
        and membership.role in ('owner', 'admin')
        and customer_user.disabled_at is null
        and account_profile.state = 'active'
    )
  then
    raise exception 'custom build quote acceptance lacks exact customer authority'
      using errcode = '42501';
  end if;

  perform 1
  from ss.service_credit_grants credit
  where credit.id = revision_record.credit_grant_id
    and credit.organization_id = revision_record.organization_id
    and credit.project_id = revision_record.project_id
    and credit.customer_user_id = revision_record.customer_user_id
    and credit.credit_digest = revision_record.credit_digest
    and credit.acceptance_cutoff = revision_record.credit_acceptance_cutoff
    and credit.acceptance_cutoff > recorded_at
    and not exists (
      select 1
      from ss.service_credit_applications application
      where application.credit_grant_id = credit.id
        and application.state in (
          'reserved', 'settled', 'reconciliation_required'
        )
    )
  for update of credit;

  if not found then
    raise exception 'custom build quote assessment credit is no longer available'
      using errcode = '23514';
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
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'acceptedDisclosureDigest', revision_record.disclosure_digest,
    'acceptedQuoteDigest', revision_record.quote_digest,
    'acceptanceStatement', 'accepted_exact_custom_build_quote',
    'commandId', new.command_id,
    'customerUserId', quote_record.customer_user_id,
    'organizationId', quote_record.organization_id,
    'quoteId', quote_record.id,
    'quoteRevision', revision_record.quote_revision,
    'schema', 'sitesourcery.custom-build-quote-acceptance-command/v1'
  ));
  new.legal_document_id := revision_record.legal_document_id;
  new.accepted_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.guard_service_credit_application()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'service credit application history is append-only'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'reserved'
      or new.reserved_at is null
      or new.settled_at is not null
      or new.released_at is not null
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or not exists (
        select 1
        from ss.service_custom_build_quote_acceptances acceptance
        join ss.service_custom_build_quote_revisions revision
          on revision.organization_id = acceptance.organization_id
         and revision.quote_id = acceptance.quote_id
         and revision.quote_revision = acceptance.quote_revision
         and revision.id = acceptance.quote_revision_id
        where acceptance.organization_id = new.organization_id
          and acceptance.id = new.quote_acceptance_id
          and acceptance.quote_id = new.quote_id
          and acceptance.customer_user_id = new.customer_user_id
          and revision.project_id = new.project_id
          and revision.credit_grant_id = new.credit_grant_id
          and revision.credit_digest = new.credit_digest
          and revision.credit_amount_minor = new.amount_minor
          and revision.currency = new.currency
      )
    then
      raise exception 'service credit reservation lacks exact acceptance evidence'
        using errcode = '42501';
    end if;
    new.created_at := new.reserved_at;
    new.updated_at := new.reserved_at;
    return new;
  end if;

  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    new.credit_grant_id,
    new.credit_digest,
    new.quote_id,
    new.quote_acceptance_id,
    new.amount_minor,
    new.currency,
    new.reserved_at,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.customer_user_id,
    old.credit_grant_id,
    old.credit_digest,
    old.quote_id,
    old.quote_acceptance_id,
    old.amount_minor,
    old.currency,
    old.reserved_at,
    old.created_at
  )
    or old.state <> 'reserved'
    or new.state <> 'released'
    or new.settled_at is not null
    or new.released_at is null
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from old.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      new.released_at
    )
    or not exists (
      select 1
      from ss.service_custom_build_quote_voids quote_void
      where quote_void.quote_id = old.quote_id
        and quote_void.organization_id = old.organization_id
        and quote_void.voided_at = new.released_at
    )
  then
    raise exception 'service credit application transition lacks void evidence'
      using errcode = '55000';
  end if;
  new.updated_at := new.released_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  revision_record record;
begin
  select revision.* into strict revision_record
  from ss.service_custom_build_quote_revisions revision
  where revision.organization_id = new.organization_id
    and revision.quote_id = new.quote_id
    and revision.quote_revision = new.quote_revision
    and revision.id = new.quote_revision_id;

  insert into ss.service_credit_applications (
    organization_id,
    project_id,
    customer_user_id,
    credit_grant_id,
    credit_digest,
    quote_id,
    quote_acceptance_id,
    amount_minor,
    currency,
    state,
    reserved_at
  ) values (
    new.organization_id,
    new.project_id,
    new.customer_user_id,
    revision_record.credit_grant_id,
    revision_record.credit_digest,
    new.quote_id,
    new.id,
    revision_record.credit_amount_minor,
    revision_record.currency,
    'reserved',
    new.accepted_at
  );

  update ss.service_custom_build_quotes
  set state = 'accepted'
  where id = new.quote_id
    and state = 'issued';

  if not found then
    raise exception 'custom build quote acceptance could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.prepare_service_custom_build_quote_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  application_record record;
  recorded_at timestamptz := clock_timestamp();
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = new.quote_id
  for update;

  if not found
    or quote_record.state not in ('issued', 'accepted')
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
       quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
  then
    raise exception 'custom build quote void lacks operator authority'
      using errcode = '42501';
  end if;

  select application.* into application_record
  from ss.service_credit_applications application
  where application.quote_id = quote_record.id
  for update;

  if found and application_record.state <> 'reserved' then
    raise exception 'custom build quote cannot release a consumed or uncertain credit'
      using errcode = '55000';
  end if;

  if quote_record.state = 'accepted' and application_record.id is null then
    raise exception 'accepted custom build quote lacks its credit reservation'
      using errcode = '55000';
  end if;

  new.organization_id := quote_record.organization_id;
  new.operator_user_id := ss.current_service_actor_user_id();
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'commandId', new.command_id,
    'operatorUserId', new.operator_user_id,
    'organizationId', new.organization_id,
    'quoteId', quote_record.id,
    'reason', new.reason,
    'schema', 'sitesourcery.custom-build-quote-void-command/v1'
  ));
  new.voided_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.materialize_service_custom_build_quote_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  update ss.service_credit_applications
  set
    state = 'released',
    released_at = new.voided_at,
    updated_at = new.voided_at
  where quote_id = new.quote_id
    and state = 'reserved';

  update ss.service_custom_build_quotes
  set state = 'voided'
  where id = new.quote_id
    and state in ('issued', 'accepted');

  if not found then
    raise exception 'custom build quote void could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_quotes_prepare
before insert on ss.service_custom_build_quotes
for each row execute function ss.prepare_service_custom_build_quote();

create trigger service_custom_build_quotes_update_guard
before update on ss.service_custom_build_quotes
for each row execute function ss.guard_service_custom_build_quote_update();

create trigger service_custom_build_quotes_no_delete
before delete on ss.service_custom_build_quotes
for each row execute function ss.reject_update();

create trigger service_custom_build_quote_revisions_prepare
before insert on ss.service_custom_build_quote_revisions
for each row execute function ss.prepare_service_custom_build_quote_revision();

create trigger service_custom_build_quote_revisions_immutable
before update or delete on ss.service_custom_build_quote_revisions
for each row execute function ss.reject_update();

create trigger service_custom_build_quote_revisions_materialize
after insert on ss.service_custom_build_quote_revisions
for each row execute function ss.materialize_service_custom_build_quote();

create constraint trigger service_custom_build_quotes_exact_revision
after insert or update on ss.service_custom_build_quotes
deferrable initially deferred
for each row execute function ss.validate_service_custom_build_quote_revision();

create constraint trigger service_custom_build_quote_revisions_exact_append
after insert on ss.service_custom_build_quote_revisions
deferrable initially deferred
for each row execute function ss.validate_service_custom_build_quote_revision();

create trigger service_custom_build_quote_base_lines_immutable
before update or delete on ss.service_custom_build_quote_base_lines
for each row execute function ss.reject_update();

create trigger service_custom_build_quote_installments_immutable
before update or delete on ss.service_custom_build_quote_installments
for each row execute function ss.reject_update();

create trigger service_custom_build_quote_commands_prepare
before insert on ss.service_custom_build_quote_commands
for each row execute function ss.prepare_service_custom_build_quote_command();

create trigger service_custom_build_quote_commands_immutable
before update or delete on ss.service_custom_build_quote_commands
for each row execute function ss.reject_update();

create trigger service_custom_build_quote_acceptances_prepare
before insert on ss.service_custom_build_quote_acceptances
for each row execute function ss.prepare_service_custom_build_quote_acceptance();

create trigger service_custom_build_quote_acceptances_account_authority
after insert on ss.service_custom_build_quote_acceptances
for each row execute function ss.validate_service_account_authority();

create trigger service_custom_build_quote_acceptances_materialize
after insert on ss.service_custom_build_quote_acceptances
for each row execute function ss.materialize_service_custom_build_acceptance();

create trigger service_custom_build_quote_acceptances_immutable
before update or delete on ss.service_custom_build_quote_acceptances
for each row execute function ss.reject_update();

create trigger service_credit_applications_guard
before insert or update or delete on ss.service_credit_applications
for each row execute function ss.guard_service_credit_application();

create trigger service_custom_build_quote_voids_prepare
before insert on ss.service_custom_build_quote_voids
for each row execute function ss.prepare_service_custom_build_quote_void();

create trigger service_custom_build_quote_voids_materialize
after insert on ss.service_custom_build_quote_voids
for each row execute function ss.materialize_service_custom_build_quote_void();

create trigger service_custom_build_quote_voids_immutable
before update or delete on ss.service_custom_build_quote_voids
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_quotes',
    'service_custom_build_quote_revisions',
    'service_custom_build_quote_base_lines',
    'service_custom_build_quote_installments',
    'service_custom_build_quote_commands',
    'service_custom_build_quote_acceptances',
    'service_credit_applications',
    'service_custom_build_quote_voids'
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

grant select on table
  ss.service_custom_build_quotes,
  ss.service_custom_build_quote_revisions,
  ss.service_custom_build_quote_base_lines,
  ss.service_custom_build_quote_installments,
  ss.service_custom_build_quote_commands,
  ss.service_custom_build_quote_acceptances,
  ss.service_credit_applications,
  ss.service_custom_build_quote_voids
to service_role;

grant insert on table
  ss.service_custom_build_quotes,
  ss.service_custom_build_quote_revisions,
  ss.service_custom_build_quote_commands,
  ss.service_custom_build_quote_acceptances,
  ss.service_custom_build_quote_voids
to service_role;

do $$
declare
  function_signature text;
  function_names text[] := array[
    'custom_build_amount_minor',
    'custom_build_payment_schedule',
    'custom_build_scale_units',
    'custom_build_footprint_is_valid',
    'custom_build_policy_id',
    'custom_build_quote_digest',
    'custom_build_tier_label',
    'prepare_service_custom_build_quote',
    'guard_service_custom_build_quote_update',
    'prepare_service_custom_build_quote_revision',
    'materialize_service_custom_build_quote',
    'prepare_service_custom_build_quote_command',
    'validate_service_custom_build_quote_revision',
    'prepare_service_custom_build_quote_acceptance',
    'guard_service_credit_application',
    'materialize_service_custom_build_acceptance',
    'prepare_service_custom_build_quote_void',
    'materialize_service_custom_build_quote_void'
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

revoke all on function ss.materialize_service_custom_build_quote()
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_acceptance()
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_quote_void()
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_quotes',
    'service_custom_build_quote_revisions',
    'service_custom_build_quote_base_lines',
    'service_custom_build_quote_installments',
    'service_custom_build_quote_commands',
    'service_custom_build_quote_acceptances',
    'service_credit_applications',
    'service_custom_build_quote_voids'
  ]
  loop
    if has_table_privilege('service_role', format('ss.%I', table_name), 'UPDATE')
      or has_table_privilege('service_role', format('ss.%I', table_name), 'DELETE')
      or has_table_privilege('service_role', format('ss.%I', table_name), 'TRUNCATE')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'INSERT')
    then
      raise exception 'custom build quote privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role',
    'ss.service_custom_build_quote_base_lines',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_custom_build_quote_installments',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_credit_applications',
    'INSERT'
  ) then
    raise exception 'custom build materialization is directly writable'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v41()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v41-custom-build-quote-credit'::text
$$;

revoke all on function ss.hosted_runtime_contract_v41()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v41()
to service_role;

commit;
