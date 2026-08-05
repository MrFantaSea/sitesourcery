begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v34()') is null
    or to_regclass('ss.service_cases') is null
    or to_regclass('ss.service_intakes') is null
    or to_regclass('ss.operator_permissions') is null
  then
    raise exception
      'Site Sourcery migration 034 must be applied before custom-service quotes'
      using errcode = '55000';
  end if;
end
$$;

-- Operator identity and candidate capability rows remain held and immutable.
-- Actual authority is a separate append-only deployment-control event chain.
-- service_role can read this chain but cannot grant, revoke, update, or delete
-- authority. A normal first-party account can never appoint itself.
create function ss.service_operator_authority_event_digest(
  operator_user_id uuid,
  capability text,
  event_sequence bigint,
  event_kind text,
  predecessor_event_id uuid,
  effective_at timestamptz,
  expires_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(
    jsonb_build_object(
      'capability', capability,
      'effectiveAt', effective_at,
      'eventKind', event_kind,
      'eventSequence', event_sequence,
      'expiresAt', expires_at,
      'operatorUserId', operator_user_id,
      'predecessorEventId', predecessor_event_id,
      'schema', 'sitesourcery.service-operator-authority.v1'
    )
  )
$$;

create table ss.service_operator_authority_events (
  id uuid primary key default extensions.gen_random_uuid(),
  operator_user_id uuid not null,
  capability text not null,
  event_sequence bigint not null check (event_sequence > 0),
  event_kind text not null check (event_kind in ('grant', 'revoke')),
  predecessor_event_id uuid,
  recorded_by_kind text not null default 'deployment_control'
    check (recorded_by_kind = 'deployment_control'),
  effective_at timestamptz not null,
  expires_at timestamptz,
  event_digest ss.sha256_hex generated always as (
    ss.service_operator_authority_event_digest(
      operator_user_id,
      capability,
      event_sequence,
      event_kind,
      predecessor_event_id,
      effective_at,
      expires_at
    )
  ) stored,
  created_at timestamptz not null,
  foreign key (operator_user_id, capability)
    references ss.operator_permissions(operator_user_id, capability),
  unique (id, operator_user_id, capability),
  unique (operator_user_id, capability, event_sequence),
  foreign key (
    predecessor_event_id,
    operator_user_id,
    capability
  ) references ss.service_operator_authority_events(
    id,
    operator_user_id,
    capability
  ),
  check (
    (event_sequence = 1 and predecessor_event_id is null)
    or (event_sequence > 1 and predecessor_event_id is not null)
  ),
  check (
    (event_kind = 'grant' and expires_at is not null)
    or (event_kind = 'revoke' and expires_at is null)
  )
);

create function ss.prepare_service_operator_authority_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  previous_event record;
  recorded_at timestamptz := clock_timestamp();
begin
  perform 1
    from ss.operator_permissions permission
   where permission.operator_user_id = new.operator_user_id
     and permission.capability = new.capability
     and permission.state = 'held'
   for update;
  if not found then
    raise exception
      'operator authority requires one deployment-registered held capability'
      using errcode = '23514';
  end if;

  select event.* into previous_event
    from ss.service_operator_authority_events event
   where event.operator_user_id = new.operator_user_id
     and event.capability = new.capability
   order by event.event_sequence desc
   limit 1;

  if new.event_kind = 'grant' then
    if new.expires_at is null
      or new.expires_at <= recorded_at + interval '1 hour'
      or new.expires_at > recorded_at + interval '366 days'
    then
      raise exception 'operator grant expiry is outside the bounded window'
        using errcode = '23514';
    end if;
    if found
      and previous_event.event_kind = 'grant'
      and previous_event.expires_at > recorded_at
    then
      raise exception 'operator capability already has a current grant'
        using errcode = '23514';
    end if;
  elsif new.event_kind = 'revoke' then
    if not found or previous_event.event_kind <> 'grant' then
      raise exception 'operator revoke requires a preceding grant'
        using errcode = '23514';
    end if;
    new.expires_at := null;
  else
    raise exception 'operator authority event kind is invalid'
      using errcode = '23514';
  end if;

  new.event_sequence := coalesce(previous_event.event_sequence, 0) + 1;
  new.predecessor_event_id := previous_event.id;
  new.recorded_by_kind := 'deployment_control';
  new.effective_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create trigger service_operator_authority_events_prepare
before insert on ss.service_operator_authority_events
for each row execute function
  ss.prepare_service_operator_authority_event();

create trigger service_operator_authority_events_immutable
before update or delete on ss.service_operator_authority_events
for each row execute function ss.reject_update();

create function ss.service_operator_has_capability(
  target_operator_user_id uuid,
  target_capability text,
  observed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select
    exists (
      select 1
        from auth.users account_user
        join ss.hosted_account_profiles account_profile
          on account_profile.user_id = account_user.id
        join ss.operator_profiles operator_profile
          on operator_profile.user_id = account_user.id
        join ss.operator_permissions permission
          on permission.operator_user_id = operator_profile.user_id
       where account_user.id = target_operator_user_id
         and account_user.disabled_at is null
         and account_profile.state = 'active'
         and operator_profile.state = 'held'
         and permission.capability = target_capability
         and permission.state = 'held'
    )
    and coalesce(
      (
        select
          event.event_kind = 'grant'
          and event.effective_at <= observed_at
          and event.expires_at > observed_at
          from ss.service_operator_authority_events event
         where event.operator_user_id = target_operator_user_id
           and event.capability = target_capability
         order by event.event_sequence desc
         limit 1
      ),
      false
    )
$$;

create function ss.service_quote_digest(
  digest_kind text,
  organization_id uuid,
  project_id uuid,
  case_id uuid,
  customer_user_id uuid,
  quote_id uuid,
  quote_revision bigint,
  offering_id uuid,
  policy_id uuid,
  scope_boundary_digest ss.sha256_hex,
  project_profile_revision bigint,
  intake_id uuid,
  intake_revision bigint,
  intake_facts_digest ss.sha256_hex,
  review_targets text[],
  service_amount_minor bigint,
  currency text,
  tax_state text,
  payment_schedule text,
  delivery_date date,
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
  select ss.service_json_digest(
    jsonb_build_object(
      'commercialContractDigest', commercial_contract_digest,
      'commercialContractId', commercial_contract_id,
      'currency', currency,
      'customerUserId', customer_user_id,
      'deliveryDate', delivery_date,
      'digestKind', digest_kind,
      'expiresAt', expires_at,
      'intakeFactsDigest', intake_facts_digest,
      'intakeId', intake_id,
      'intakeRevision', intake_revision,
      'issuedAt', issued_at,
      'offeringId', offering_id,
      'organizationId', organization_id,
      'paymentSchedule', payment_schedule,
      'policyId', policy_id,
      'projectId', project_id,
      'projectProfileRevision', project_profile_revision,
      'caseId', case_id,
      'quoteId', quote_id,
      'quoteRevision', quote_revision,
      'reviewTargets', review_targets,
      'schema', 'sitesourcery.service-assessment-quote.v1',
      'scopeBoundaryDigest', scope_boundary_digest,
      'serviceAmountMinor', service_amount_minor,
      'taxState', tax_state
    )
  )
$$;

create function ss.service_quote_review_targets_are_canonical(value text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select
    value is not null
    and cardinality(value) between 1 and 5
    and not exists (
      select 1
        from unnest(value) target
       where not ss.service_text_excludes_credentials(target)
         or char_length(target) > 160
         or target !~ '^(page:/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*|type:[a-z][a-z0-9_]{1,79})$'
         or target ~ '(^|/)[.][.]?(/|$)'
    )
    and value = (
      select array_agg(target order by target)
        from (select distinct unnest(value) as target) canonical
    )
$$;

create table ss.service_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  offering_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  purpose text not null default 'assessment'
    check (purpose = 'assessment'),
  current_revision bigint not null default 0
    check (current_revision >= 0),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
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
  foreign key (organization_id, offering_id)
    references ss.service_case_offerings(organization_id, id),
  unique (organization_id, id),
  unique (case_id, purpose)
);

create function ss.prepare_service_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  recorded_at timestamptz := clock_timestamp();
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_user_id() is distinct from
       new.created_by_operator_user_id
    or ss.current_service_actor_org_id() is distinct from
       new.organization_id
    or not ss.service_operator_has_capability(
      new.created_by_operator_user_id,
      'service_quote_author',
      recorded_at
    )
  then
    raise exception 'service quote requires an exact authorized operator actor'
      using errcode = '42501';
  end if;

  if new.current_revision <> 0
    or new.purpose <> 'assessment'
    or not exists (
      select 1
        from ss.service_cases service_case
        join ss.service_case_offerings offering
          on offering.organization_id = service_case.organization_id
         and offering.project_id = service_case.project_id
         and offering.case_id = service_case.id
         and offering.customer_user_id = service_case.customer_user_id
        join ss.service_catalog_policies policy
          on policy.id = offering.policy_id
        join ss.organizations organization
          on organization.id = service_case.organization_id
        join ss.projects project
          on project.organization_id = service_case.organization_id
         and project.id = service_case.project_id
        join ss.organization_memberships membership
          on membership.organization_id = service_case.organization_id
         and membership.user_id = service_case.customer_user_id
        join auth.users customer_user
          on customer_user.id = service_case.customer_user_id
        join ss.hosted_account_profiles account_profile
          on account_profile.user_id = service_case.customer_user_id
       where service_case.organization_id = new.organization_id
         and service_case.project_id = new.project_id
         and service_case.id = new.case_id
         and service_case.customer_user_id = new.customer_user_id
         and service_case.state = 'submitted'
         and offering.id = new.offering_id
         and offering.state = 'requested'
         and policy.id = '00000000-0000-4000-8000-000000000341'
         and policy.service_key = 'website_assessment_standard'
         and policy.publication_state = 'held'
         and organization.state = 'active'
         and project.lifecycle = 'active'
         and membership.state = 'active'
         and membership.role in ('owner', 'admin')
         and customer_user.disabled_at is null
         and account_profile.state = 'active'
    )
    or not exists (
      select 1
        from ss.service_intakes intake
       where intake.organization_id = new.organization_id
         and intake.project_id = new.project_id
         and intake.case_id = new.case_id
         and intake.customer_user_id = new.customer_user_id
    )
  then
    raise exception 'service quote lacks one eligible submitted assessment request'
      using errcode = '23514';
  end if;

  new.created_at := recorded_at;
  new.updated_at := recorded_at;
  return new;
end
$$;

create trigger service_quotes_prepare
before insert on ss.service_quotes
for each row execute function ss.prepare_service_quote();

create function ss.guard_service_quote_update()
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
    new.offering_id,
    new.customer_user_id,
    new.purpose,
    new.created_by_operator_user_id,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.offering_id,
    old.customer_user_id,
    old.purpose,
    old.created_by_operator_user_id,
    old.created_at
  )
    or new.current_revision <> old.current_revision + 1
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
       old.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      clock_timestamp()
    )
  then
    raise exception 'service quote revision pointer is not an authorized append'
      using errcode = '55000';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger service_quotes_update_guard
before update on ss.service_quotes
for each row execute function ss.guard_service_quote_update();

create trigger service_quotes_no_delete
before delete on ss.service_quotes
for each row execute function ss.reject_update();

create table ss.service_quote_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  customer_user_id uuid not null references auth.users(id),
  offering_id uuid not null,
  intake_id uuid not null,
  project_profile_revision bigint not null
    check (project_profile_revision > 0),
  intake_revision bigint not null check (intake_revision > 0),
  intake_facts_digest ss.sha256_hex not null,
  review_targets text[] not null
    check (ss.service_quote_review_targets_are_canonical(review_targets)),
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  service_amount_minor bigint not null check (service_amount_minor = 20000),
  provider_direct_amount_minor bigint not null
    check (provider_direct_amount_minor = 0),
  credit_amount_minor bigint not null check (credit_amount_minor = 0),
  subtotal_minor bigint not null check (subtotal_minor = 20000),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'calculation_required'),
  payment_schedule text not null
    check (payment_schedule = 'full_before_work'),
  maximum_websites integer not null check (maximum_websites = 1),
  maximum_representative_pages_or_types integer not null
    check (maximum_representative_pages_or_types = 5),
  maximum_findings integer not null check (maximum_findings = 10),
  desktop_review_included boolean not null check (desktop_review_included),
  phone_review_included boolean not null check (phone_review_included),
  expanded_assessment_state text not null
    check (expanded_assessment_state = 'separately_quoted'),
  commercial_contract_id text not null,
  commercial_contract_digest ss.sha256_hex not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  delivery_date date not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  quote_digest ss.sha256_hex generated always as (
    ss.service_quote_digest(
      'snapshot',
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      quote_id,
      quote_revision,
      offering_id,
      policy_id,
      scope_boundary_digest,
      project_profile_revision,
      intake_id,
      intake_revision,
      intake_facts_digest,
      review_targets,
      service_amount_minor,
      currency,
      tax_state,
      payment_schedule,
      delivery_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  disclosure_digest ss.sha256_hex generated always as (
    ss.service_quote_digest(
      'customer_disclosure',
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      quote_id,
      quote_revision,
      offering_id,
      policy_id,
      scope_boundary_digest,
      project_profile_revision,
      intake_id,
      intake_revision,
      intake_facts_digest,
      review_targets,
      service_amount_minor,
      currency,
      tax_state,
      payment_schedule,
      delivery_date,
      commercial_contract_id,
      commercial_contract_digest,
      issued_at,
      expires_at
    )
  ) stored,
  created_at timestamptz not null,
  foreign key (organization_id, quote_id)
    references ss.service_quotes(organization_id, id),
  foreign key (organization_id, intake_id)
    references ss.service_intakes(organization_id, id),
  foreign key (organization_id, offering_id)
    references ss.service_case_offerings(organization_id, id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (organization_id, id),
  unique (quote_id, quote_revision),
  unique (organization_id, quote_id, quote_revision, id),
  check (expires_at > issued_at),
  check (expires_at <= issued_at + interval '30 days'),
  check (delivery_date > (issued_at at time zone 'UTC')::date),
  check (delivery_date <= (issued_at at time zone 'UTC')::date + 365),
  check (subtotal_minor = service_amount_minor),
  check (
    commercial_contract_id = 'SS-CUSTOM-SERVICES-2026-08-05.1'
    and commercial_contract_digest =
      '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'
  )
);

create table ss.service_quote_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  quote_id uuid not null,
  quote_revision_id uuid not null,
  line_number integer not null check (line_number = 1),
  policy_id uuid not null,
  component_key text not null check (component_key = 'website_assessment_standard'),
  display_name text not null check (display_name = 'Website assessment'),
  line_category text not null check (line_category = 'service'),
  quantity integer not null check (quantity = 1),
  unit_label text not null check (unit_label = 'assessment'),
  unit_amount_minor bigint not null check (unit_amount_minor = 20000),
  customer_amount_minor bigint not null check (customer_amount_minor = 20000),
  provider_direct_amount_minor bigint not null
    check (provider_direct_amount_minor = 0),
  scope_boundary_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id)
    references ss.service_quote_revisions(organization_id, id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (organization_id, id),
  unique (quote_revision_id, line_number),
  unique (organization_id, quote_revision_id, id),
  check (customer_amount_minor = quantity * unit_amount_minor)
);

create table ss.service_quote_line_coverages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_revision_id uuid not null,
  quote_line_id uuid not null,
  coverage_key text not null,
  coverage_mode text not null check (coverage_mode = 'includes'),
  scope_identity_kind text not null,
  boundary_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id, quote_line_id)
    references ss.service_quote_lines(
      organization_id,
      quote_revision_id,
      id
    ),
  unique (
    quote_revision_id,
    coverage_key,
    scope_identity_kind
  )
);

create table ss.service_quote_review_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_revision_id uuid not null,
  target_number integer not null check (target_number between 1 and 5),
  target_kind text not null check (target_kind in ('page', 'page_type')),
  target_value text not null
    check (
      char_length(target_value) between 1 and 154
      and ss.service_text_excludes_credentials(target_value)
    ),
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id)
    references ss.service_quote_revisions(organization_id, id),
  unique (quote_revision_id, target_number),
  unique (quote_revision_id, target_kind, target_value),
  unique (organization_id, id),
  check (
    (target_kind = 'page' and target_value ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$')
    or (target_kind = 'page_type' and target_value ~ '^[a-z][a-z0-9_]{1,79}$')
  ),
  check (target_value !~ '(^|/)[.][.]?(/|$)')
);

create table ss.service_quote_installments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  quote_revision_id uuid not null,
  installment_number integer not null check (installment_number = 1),
  installment_kind text not null check (installment_kind = 'full'),
  amount_minor bigint not null check (amount_minor = 20000),
  currency text not null check (currency = 'USD'),
  due_trigger text not null check (due_trigger = 'before_work'),
  created_at timestamptz not null,
  foreign key (organization_id, quote_revision_id)
    references ss.service_quote_revisions(organization_id, id),
  unique (quote_revision_id, installment_number),
  unique (organization_id, id)
);

create table ss.service_quote_acceptances (
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
    check (acceptance_statement = 'accepted_exact_quote_and_delivery_date'),
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  request_id uuid not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, quote_id)
    references ss.service_quotes(organization_id, id),
  foreign key (
    organization_id,
    quote_id,
    quote_revision,
    quote_revision_id
  ) references ss.service_quote_revisions(
    organization_id,
    quote_id,
    quote_revision,
    id
  ),
  unique (quote_id),
  unique (organization_id, request_id),
  unique (organization_id, id),
  check (accepted_by_user_id = customer_user_id)
);

create function ss.prepare_service_quote_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  quote_record record;
  profile_record record;
  intake_record record;
  policy_record record;
  recorded_at timestamptz := clock_timestamp();
  requested_expires_at timestamptz := new.expires_at;
  requested_delivery_date date := new.delivery_date;
  requested_review_targets text[] := new.review_targets;
begin
  select quote.* into quote_record
    from ss.service_quotes quote
   where quote.id = new.quote_id
   for update;
  if not found
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
        from ss.service_quote_acceptances acceptance
       where acceptance.quote_id = quote_record.id
    )
  then
    raise exception 'service quote revision lacks current operator authority'
      using errcode = '42501';
  end if;

  select profile.* into profile_record
    from ss.service_project_profiles profile
   where profile.organization_id = quote_record.organization_id
     and profile.project_id = quote_record.project_id
     and profile.customer_user_id = quote_record.customer_user_id;
  if not found then
    raise exception 'service quote revision lacks its current site profile'
      using errcode = '23514';
  end if;

  select intake.* into intake_record
    from ss.service_intakes intake
   where intake.id = new.intake_id
     and intake.organization_id = quote_record.organization_id
     and intake.project_id = quote_record.project_id
     and intake.case_id = quote_record.case_id
     and intake.customer_user_id = quote_record.customer_user_id
     and intake.state = 'submitted';
  if not found
    or exists (
      select 1
        from ss.service_intakes later_intake
       where later_intake.case_id = quote_record.case_id
         and later_intake.revision > intake_record.revision
    )
  then
    raise exception 'service quote revision requires the latest submitted intake'
      using errcode = '23514';
  end if;

  select
    policy.*,
    document.id as exact_legal_document_id
  into policy_record
    from ss.service_case_offerings offering
    join ss.service_catalog_policies policy
      on policy.id = offering.policy_id
    join ss.legal_documents document
      on document.id = policy.legal_document_id
     and document.version = policy.commercial_contract_id
     and document.content_digest = policy.commercial_contract_digest
     and document.kind = 'custom_services'
     and document.retired_at is null
   where offering.id = quote_record.offering_id
     and offering.organization_id = quote_record.organization_id
     and offering.case_id = quote_record.case_id
     and offering.state = 'requested'
     and policy.id = '00000000-0000-4000-8000-000000000341'
     and policy.service_key = 'website_assessment_standard'
     and policy.unit_amount_minor = 20000
     and policy.currency = 'USD'
     and policy.publication_state = 'held';
  if not found then
    raise exception 'service quote revision lacks exact held assessment policy'
      using errcode = '23514';
  end if;

  if requested_expires_at is null
    or requested_expires_at <= recorded_at
    or requested_expires_at > recorded_at + interval '30 days'
    or requested_delivery_date is null
    or requested_delivery_date <= (recorded_at at time zone 'UTC')::date
    or requested_delivery_date >
       (recorded_at at time zone 'UTC')::date + 365
    or not ss.service_quote_review_targets_are_canonical(
      requested_review_targets
    )
  then
    raise exception 'service quote timing is invalid'
      using errcode = '23514';
  end if;

  new.organization_id := quote_record.organization_id;
  new.project_id := quote_record.project_id;
  new.case_id := quote_record.case_id;
  new.quote_revision := quote_record.current_revision + 1;
  new.customer_user_id := quote_record.customer_user_id;
  new.offering_id := quote_record.offering_id;
  new.project_profile_revision := profile_record.revision;
  new.intake_revision := intake_record.revision;
  new.intake_facts_digest := intake_record.facts_digest;
  new.review_targets := requested_review_targets;
  new.policy_id := policy_record.id;
  new.scope_boundary_digest := policy_record.scope_boundary_digest;
  new.service_amount_minor := 20000;
  new.provider_direct_amount_minor := 0;
  new.credit_amount_minor := 0;
  new.subtotal_minor := 20000;
  new.currency := 'USD';
  new.tax_state := 'calculation_required';
  new.payment_schedule := 'full_before_work';
  new.maximum_websites := 1;
  new.maximum_representative_pages_or_types := 5;
  new.maximum_findings := 10;
  new.desktop_review_included := true;
  new.phone_review_included := true;
  new.expanded_assessment_state := 'separately_quoted';
  new.commercial_contract_id := policy_record.commercial_contract_id;
  new.commercial_contract_digest := policy_record.commercial_contract_digest;
  new.legal_document_id := policy_record.exact_legal_document_id;
  new.delivery_date := requested_delivery_date;
  new.issued_at := recorded_at;
  new.expires_at := requested_expires_at;
  new.created_by_operator_user_id := ss.current_service_actor_user_id();
  new.created_at := recorded_at;

  update ss.service_quotes
     set current_revision = new.quote_revision
   where id = quote_record.id;
  return new;
end
$$;

create trigger service_quote_revisions_prepare
before insert on ss.service_quote_revisions
for each row execute function ss.prepare_service_quote_revision();

create trigger service_quote_revisions_immutable
before update or delete on ss.service_quote_revisions
for each row execute function ss.reject_update();

create function ss.materialize_standard_assessment_quote()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  quote_line_id uuid := extensions.gen_random_uuid();
begin
  insert into ss.service_quote_lines (
    id,
    organization_id,
    project_id,
    quote_id,
    quote_revision_id,
    line_number,
    policy_id,
    component_key,
    display_name,
    line_category,
    quantity,
    unit_label,
    unit_amount_minor,
    customer_amount_minor,
    provider_direct_amount_minor,
    scope_boundary_digest,
    created_at
  ) values (
    quote_line_id,
    new.organization_id,
    new.project_id,
    new.quote_id,
    new.id,
    1,
    new.policy_id,
    'website_assessment_standard',
    'Website assessment',
    'service',
    1,
    'assessment',
    20000,
    20000,
    0,
    new.scope_boundary_digest,
    new.created_at
  );

  insert into ss.service_quote_line_coverages (
    organization_id,
    quote_revision_id,
    quote_line_id,
    coverage_key,
    coverage_mode,
    scope_identity_kind,
    boundary_digest,
    created_at
  )
  select
    new.organization_id,
    new.id,
    quote_line_id,
    coverage.coverage_key,
    coverage.coverage_mode,
    coverage.scope_identity_kind,
    coverage.boundary_digest,
    new.created_at
  from ss.service_catalog_coverage coverage
  where coverage.policy_id = new.policy_id;

  insert into ss.service_quote_installments (
    organization_id,
    quote_revision_id,
    installment_number,
    installment_kind,
    amount_minor,
    currency,
    due_trigger,
    created_at
  ) values (
    new.organization_id,
    new.id,
    1,
    'full',
    20000,
    'USD',
    'before_work',
    new.created_at
  );

  insert into ss.service_quote_review_targets (
    organization_id,
    quote_revision_id,
    target_number,
    target_kind,
    target_value,
    created_at
  )
  select
    new.organization_id,
    new.id,
    target.ordinality::integer,
    case
      when target.value like 'page:%' then 'page'
      else 'page_type'
    end,
    case
      when target.value like 'page:%' then substring(target.value from 6)
      else substring(target.value from 6)
    end,
    new.created_at
  from unnest(new.review_targets) with ordinality
    as target(value, ordinality);
  return new;
end
$$;

create trigger service_quote_revisions_materialize
after insert on ss.service_quote_revisions
for each row execute function ss.materialize_standard_assessment_quote();

create function ss.validate_service_quote_current_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
begin
  select quote.* into quote_record
    from ss.service_quotes quote
   where quote.id = new.id;
  if not found
    or (
      quote_record.current_revision = 0
      and exists (
        select 1 from ss.service_quote_revisions revision
         where revision.quote_id = quote_record.id
      )
    )
    or (
      quote_record.current_revision > 0
      and not exists (
        select 1
          from ss.service_quote_revisions revision
         where revision.quote_id = quote_record.id
           and revision.quote_revision = quote_record.current_revision
      )
    )
    or quote_record.current_revision is distinct from (
      select coalesce(max(revision.quote_revision), 0)
        from ss.service_quote_revisions revision
       where revision.quote_id = quote_record.id
    )
  then
    raise exception 'service quote current revision lacks exact append evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger service_quotes_current_revision
after insert or update on ss.service_quotes
deferrable initially deferred
for each row execute function ss.validate_service_quote_current_revision();

create function ss.prepare_service_quote_acceptance()
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

create trigger service_quote_acceptances_prepare
before insert on ss.service_quote_acceptances
for each row execute function ss.prepare_service_quote_acceptance();

create trigger service_quote_acceptances_account_authority
after insert on ss.service_quote_acceptances
for each row execute function ss.validate_service_account_authority();

create trigger service_quote_acceptances_immutable
before update or delete on ss.service_quote_acceptances
for each row execute function ss.reject_update();

create trigger service_quote_lines_immutable
before update or delete on ss.service_quote_lines
for each row execute function ss.reject_update();

create trigger service_quote_line_coverages_immutable
before update or delete on ss.service_quote_line_coverages
for each row execute function ss.reject_update();

create trigger service_quote_review_targets_immutable
before update or delete on ss.service_quote_review_targets
for each row execute function ss.reject_update();

create trigger service_quote_installments_immutable
before update or delete on ss.service_quote_installments
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
  tables text[] := array[
    'service_operator_authority_events',
    'service_quotes',
    'service_quote_revisions',
    'service_quote_lines',
    'service_quote_line_coverages',
    'service_quote_review_targets',
    'service_quote_installments',
    'service_quote_acceptances'
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
  ss.service_operator_authority_events,
  ss.service_quotes,
  ss.service_quote_revisions,
  ss.service_quote_lines,
  ss.service_quote_line_coverages,
  ss.service_quote_review_targets,
  ss.service_quote_installments,
  ss.service_quote_acceptances
to service_role;

grant insert on table
  ss.service_quotes,
  ss.service_quote_revisions,
  ss.service_quote_acceptances
to service_role;

do $$
declare
  function_signature text;
  service_function_names text[] := array[
    'service_operator_authority_event_digest',
    'service_operator_has_capability',
    'service_quote_digest',
    'service_quote_review_targets_are_canonical',
    'prepare_service_quote',
    'guard_service_quote_update',
    'prepare_service_quote_revision',
    'materialize_standard_assessment_quote',
    'validate_service_quote_current_revision',
    'prepare_service_quote_acceptance'
  ];
begin
  for function_signature in
    select procedure.oid::regprocedure::text
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'ss'
       and procedure.proname = any(service_function_names)
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

revoke all on function ss.prepare_service_operator_authority_event()
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_operator_authority_events',
    'service_quotes',
    'service_quote_revisions',
    'service_quote_lines',
    'service_quote_line_coverages',
    'service_quote_review_targets',
    'service_quote_installments',
    'service_quote_acceptances'
  ]
  loop
    if has_table_privilege(
      'service_role',
      format('ss.%I', table_name),
      'UPDATE'
    ) or has_table_privilege(
      'service_role',
      format('ss.%I', table_name),
      'DELETE'
    ) or has_table_privilege(
      'service_role',
      format('ss.%I', table_name),
      'TRUNCATE'
    ) then
      raise exception 'service quote table has unsafe mutation privilege: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role',
    'ss.service_operator_authority_events',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_quote_lines',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_quote_line_coverages',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_quote_review_targets',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_quote_installments',
    'INSERT'
  ) then
    raise exception 'service quote derived or operator authority is directly writable'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v35()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v35-custom-service-quotes'::text
$$;

revoke all on function ss.hosted_runtime_contract_v35()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v35()
to authenticated, service_role;

commit;
