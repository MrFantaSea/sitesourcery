-- CUSTOM-DIRECT-01: direct Engagement projects may enter the Custom quote
-- lifecycle without buying an assessment. Assessment credit remains an
-- explicit, same-project, one-use choice; absence of a credit is never
-- represented as a synthetic grant or application.

begin;

do $$
begin
  if to_regclass('ss.customer_engagements') is null
    or to_regclass('ss.service_custom_build_quotes') is null
    or to_regclass('ss.service_custom_build_invoices') is null
    or to_regprocedure('ss.hosted_runtime_contract_v108()') is null
  then
    raise exception
      'Engagement, Custom build, and professional reversal authority must exist before CUSTOM-DIRECT-01'
      using errcode = '55000';
  end if;
end
$$;

create table ss.service_custom_build_direct_opportunities (
  id uuid primary key,
  engagement_id uuid not null unique,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  engagement_digest ss.sha256_hex not null,
  state text not null default 'available' check (state = 'available'),
  created_at timestamptz not null,
  foreign key (engagement_id) references ss.customer_engagements(id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, project_id, customer_user_id, case_id)
    references ss.service_cases(
      organization_id, project_id, customer_user_id, id
    ),
  unique (organization_id, id),
  unique (organization_id, project_id)
);

create function ss.materialize_service_custom_build_direct_opportunity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  project_record record;
  selected_case_id uuid := extensions.gen_random_uuid();
begin
  if new.provenance <> 'direct_custom_inquiry' then return new; end if;
  select project.name into project_record
    from ss.projects project
   where project.organization_id = new.organization_id
     and project.id = new.project_id
     and project.created_by_user_id = new.customer_user_id
     and project.lifecycle = 'active';
  if not found
    or ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from new.customer_user_id
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or new.source_assessment_report_id is not null
  then
    raise exception 'direct Custom opportunity lacks exact Engagement authority'
      using errcode = '42501';
  end if;
  insert into ss.service_cases (
    id, organization_id, project_id, customer_user_id,
    created_by_user_id, source, state, title, created_at, updated_at
  ) values (
    selected_case_id, new.organization_id, new.project_id,
    new.customer_user_id, new.customer_user_id, 'account', 'draft',
    'Custom website: ' || project_record.name,
    new.claimed_at, new.claimed_at
  );
  update ss.service_cases set state = 'submitted'
   where id = selected_case_id and state = 'draft';
  if not found then
    raise exception 'direct Custom opportunity case could not be submitted'
      using errcode = '55000';
  end if;
  insert into ss.service_custom_build_direct_opportunities (
    id, engagement_id, organization_id, project_id, case_id,
    customer_user_id, engagement_digest, state, created_at
  ) values (
    new.id, new.id, new.organization_id, new.project_id,
    selected_case_id, new.customer_user_id, new.engagement_digest,
    'available', new.claimed_at
  );
  return new;
end
$$;

create trigger customer_engagements_custom_direct_opportunity
after insert on ss.customer_engagements
for each row execute function
  ss.materialize_service_custom_build_direct_opportunity();

do $$
begin
  if exists (
    select 1 from ss.customer_engagements engagement
     where engagement.provenance = 'direct_custom_inquiry'
  ) then
    raise exception
      'retained direct Engagements require an explicit CUSTOM-DIRECT-01 backfill decision'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.service_custom_build_quotes
  add column origin text,
  add column direct_opportunity_id uuid,
  add column credit_selection text;

update ss.service_custom_build_quotes
   set origin = 'assessment_successor',
       credit_selection = 'apply_assessment_credit';

alter table ss.service_custom_build_quotes
  alter column origin set not null,
  alter column credit_selection set not null,
  alter column source_job_id drop not null,
  alter column source_report_id drop not null,
  add constraint service_custom_build_quotes_origin_check
    check (origin in ('direct', 'assessment_successor')),
  add constraint service_custom_build_quotes_credit_selection_check
    check (credit_selection in ('no_credit', 'apply_assessment_credit')),
  add constraint service_custom_build_quotes_source_authority_check
    check (
      (origin = 'direct'
        and direct_opportunity_id is not null
        and source_job_id is null
        and source_report_id is null
        and credit_selection = 'no_credit')
      or
      (origin = 'assessment_successor'
        and direct_opportunity_id is null
        and source_job_id is not null
        and source_report_id is not null)
    ),
  add foreign key (organization_id, direct_opportunity_id)
    references ss.service_custom_build_direct_opportunities(
      organization_id, id
    );

alter table ss.service_custom_build_quote_revisions
  alter column source_report_id drop not null,
  alter column credit_grant_id drop not null,
  alter column credit_digest drop not null,
  alter column credit_acceptance_cutoff drop not null,
  drop constraint service_custom_build_quote_revisions_credit_amount_minor_check,
  add constraint service_custom_build_quote_revisions_credit_amount_minor_check
    check (credit_amount_minor in (0, 20000)),
  drop constraint service_custom_build_quote_revisions_start_credit_minor_check,
  add constraint service_custom_build_quote_revisions_start_credit_minor_check
    check (start_credit_minor in (0, 20000)),
  add constraint service_custom_build_quote_revisions_credit_authority_check
    check (
      (credit_amount_minor = 0
        and credit_grant_id is null
        and credit_digest is null
        and credit_acceptance_cutoff is null
        and start_credit_minor = 0)
      or
      (credit_amount_minor = 20000
        and credit_grant_id is not null
        and credit_digest is not null
        and credit_acceptance_cutoff is not null
        and start_credit_minor = 20000)
    );

alter table ss.service_custom_build_quote_base_lines
  drop constraint service_custom_build_quote_base_lines_credit_amount_minor_check,
  add constraint service_custom_build_quote_base_lines_credit_amount_minor_check
    check (credit_amount_minor in (0, 20000));

alter table ss.service_custom_build_quote_installments
  drop constraint service_custom_build_quote_installments_check1,
  add constraint service_custom_build_quote_installments_kind_check
    check (
      (installment_number = 1
        and installment_kind = 'start'
        and credit_amount_minor in (0, 20000)
        and due_trigger = 'before_work')
      or
      (installment_number = 2
        and installment_kind = 'final'
        and credit_amount_minor = 0
        and due_trigger = 'before_handoff')
    );

alter table ss.service_custom_build_invoices
  alter column credit_application_id drop not null,
  drop constraint service_custom_build_invoices_credit_minor_check,
  add constraint service_custom_build_invoices_credit_minor_check
    check (credit_minor in (0, 20000)),
  add constraint service_custom_build_invoices_credit_authority_check
    check (
      (credit_minor = 0 and credit_application_id is null)
      or (credit_minor = 20000 and credit_application_id is not null)
    );

alter table ss.service_custom_build_payment_receipts
  alter column credit_application_id drop not null;

alter table ss.service_custom_build_jobs
  drop constraint service_custom_build_jobs_start_credit_minor_check,
  add constraint service_custom_build_jobs_start_credit_minor_check
    check (start_credit_minor in (0, 20000));

create or replace function ss.prepare_service_custom_build_quote()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  source record;
  recorded_at timestamptz := clock_timestamp();
begin
  if new.origin = 'direct' then
    select
      opportunity.organization_id,
      opportunity.project_id,
      opportunity.case_id,
      opportunity.customer_user_id,
      null::uuid as job_id,
      null::uuid as report_id
    into source
    from ss.service_custom_build_direct_opportunities opportunity
    join ss.customer_engagements engagement
      on engagement.id = opportunity.engagement_id
     and engagement.organization_id = opportunity.organization_id
     and engagement.project_id = opportunity.project_id
     and engagement.customer_user_id = opportunity.customer_user_id
     and engagement.provenance = 'direct_custom_inquiry'
     and engagement.engagement_digest = opportunity.engagement_digest
    join ss.service_cases service_case
      on service_case.organization_id = opportunity.organization_id
     and service_case.project_id = opportunity.project_id
     and service_case.customer_user_id = opportunity.customer_user_id
     and service_case.id = opportunity.case_id
    join ss.organizations organization
      on organization.id = opportunity.organization_id
    join ss.projects project
      on project.organization_id = opportunity.organization_id
     and project.id = opportunity.project_id
    join ss.organization_memberships membership
      on membership.organization_id = opportunity.organization_id
     and membership.user_id = opportunity.customer_user_id
    join auth.users customer_user
      on customer_user.id = opportunity.customer_user_id
    join ss.hosted_account_profiles account_profile
      on account_profile.user_id = opportunity.customer_user_id
    where opportunity.id = new.direct_opportunity_id
      and opportunity.state = 'available'
      and service_case.state = 'submitted'
      and organization.state = 'active'
      and project.lifecycle = 'active'
      and membership.state = 'active'
      and membership.role in ('owner', 'admin')
      and customer_user.disabled_at is null
      and account_profile.state = 'active';
  elsif new.origin = 'assessment_successor' then
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
  else
    select
      null::uuid as organization_id,
      null::uuid as project_id,
      null::uuid as case_id,
      null::uuid as customer_user_id,
      null::uuid as job_id,
      null::uuid as report_id
    into source;
  end if;

  if source.organization_id is null
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from source.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    or new.current_revision <> 0
    or new.state <> 'issued'
    or (new.origin = 'direct' and new.credit_selection <> 'no_credit')
    or (new.origin = 'assessment_successor' and new.credit_selection not in (
      'no_credit', 'apply_assessment_credit'
    ))
  then
    raise exception 'custom build quote requires one exact Custom opportunity'
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

create or replace function ss.prepare_service_custom_build_quote_revision()
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
  exact_credit_minor bigint := 0;
  selected_credit_id uuid;
  selected_credit_digest ss.sha256_hex;
  selected_credit_cutoff timestamptz;
begin
  select quote.* into quote_record
    from ss.service_custom_build_quotes quote
   where quote.id = new.quote_id
   for update;

  if not found
    or quote_record.state <> 'issued'
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', recorded_at
    )
    or exists (
      select 1 from ss.service_custom_build_quote_acceptances acceptance
       where acceptance.quote_id = quote_record.id
    )
    or exists (
      select 1 from ss.service_custom_build_quote_voids quote_void
       where quote_void.quote_id = quote_record.id
    )
  then
    raise exception 'custom build quote revision lacks current operator authority'
      using errcode = '42501';
  end if;

  exact_scale_units := case when requested_tier_id = 'scale'
    then ss.custom_build_scale_units(
      requested_crafted_pages, requested_sections,
      requested_unique_layouts, requested_content_words,
      requested_supplied_media
    ) else null end;

  if not ss.custom_build_footprint_is_valid(
    requested_tier_id, exact_scale_units, requested_crafted_pages,
    requested_sections, requested_unique_layouts,
    requested_content_words, requested_supplied_media
  )
    or requested_scope_statement is null
    or char_length(requested_scope_statement) not between 20 and 2000
    or not ss.service_text_excludes_credentials(requested_scope_statement)
  then
    raise exception 'custom build quote scope is outside its exact tier boundary'
      using errcode = '23514';
  end if;

  select policy.*, document.id as exact_legal_document_id
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
       or
       (requested_tier_id <> 'scale'
         and policy.pricing_mode = 'fixed'
         and policy.unit_amount_minor = ss.custom_build_amount_minor(
           requested_tier_id, null
         ))
     );
  if not found then
    raise exception 'custom build quote lacks its exact held catalog policy'
      using errcode = '23514';
  end if;

  if quote_record.credit_selection = 'apply_assessment_credit' then
    select credit.* into credit_record
      from ss.service_credit_grants credit
     where quote_record.origin = 'assessment_successor'
       and credit.organization_id = quote_record.organization_id
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
         select 1 from ss.service_credit_applications application
          where application.credit_grant_id = credit.id
            and application.state in (
              'reserved', 'settled', 'reconciliation_required'
            )
       )
     for update of credit;
    if not found then
      raise exception 'selected assessment credit is unavailable for this project'
        using errcode = '23514';
    end if;
    exact_credit_minor := 20000;
    selected_credit_id := credit_record.id;
    selected_credit_digest := credit_record.credit_digest;
    selected_credit_cutoff := credit_record.acceptance_cutoff;
  elsif quote_record.credit_selection <> 'no_credit' then
    raise exception 'custom build quote credit selection is invalid'
      using errcode = '23514';
  end if;

  if requested_expires_at is null
    or requested_expires_at <= recorded_at
    or requested_expires_at > recorded_at + interval '30 days'
    or (
      exact_credit_minor = 20000
      and requested_expires_at > selected_credit_cutoff
    )
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
    requested_tier_id, exact_scale_units
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
  new.credit_grant_id := case when exact_credit_minor = 20000
    then selected_credit_id else null end;
  new.credit_digest := case when exact_credit_minor = 20000
    then selected_credit_digest else null end;
  new.credit_acceptance_cutoff := case when exact_credit_minor = 20000
    then selected_credit_cutoff else null end;
  new.credit_amount_minor := exact_credit_minor;
  new.customer_amount_minor := exact_service_amount_minor - exact_credit_minor;
  new.currency := 'USD';
  new.tax_state := 'calculation_required';
  new.payment_schedule := exact_payment_schedule;
  new.start_value_minor := exact_start_value_minor;
  new.start_credit_minor := exact_credit_minor;
  new.start_due_minor := exact_start_value_minor - exact_credit_minor;
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

create or replace function ss.prepare_service_custom_build_quote_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  revision_record record;
  recorded_at timestamptz := clock_timestamp();
  credit_ready boolean := false;
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
    or (
      revision_record.credit_amount_minor = 20000
      and revision_record.credit_acceptance_cutoff <= recorded_at
    )
    or new.quote_revision is distinct from revision_record.quote_revision
    or new.accepted_quote_digest is distinct from revision_record.quote_digest
    or new.accepted_disclosure_digest is distinct from revision_record.disclosure_digest
    or new.acceptance_statement <> 'accepted_exact_custom_build_quote'
    or not exists (
      select 1 from ss.service_custom_build_quote_commands command
       where command.quote_id = revision_record.quote_id
         and command.quote_revision_id = revision_record.id
         and command.quote_revision = revision_record.quote_revision
    )
  then
    raise exception 'custom build quote acceptance no longer matches current quote'
      using errcode = '23514';
  end if;

  if ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_user_id() is distinct from quote_record.customer_user_id
    or ss.current_service_actor_org_id() is distinct from quote_record.organization_id
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

  if revision_record.credit_amount_minor = 20000 then
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
         select 1 from ss.service_credit_applications application
          where application.credit_grant_id = credit.id
            and application.state in (
              'reserved', 'settled', 'reconciliation_required'
            )
       )
     for update of credit;
    credit_ready := found;
  else
    credit_ready := revision_record.credit_amount_minor = 0
      and revision_record.credit_grant_id is null
      and revision_record.credit_digest is null
      and revision_record.credit_acceptance_cutoff is null;
  end if;
  if not credit_ready then
    raise exception 'custom build quote credit selection is no longer available'
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

create or replace function ss.materialize_service_custom_build_acceptance()
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

  if revision_record.credit_amount_minor = 20000 then
    insert into ss.service_credit_applications (
      organization_id, project_id, customer_user_id,
      credit_grant_id, credit_digest, quote_id,
      quote_acceptance_id, amount_minor, currency, state, reserved_at
    ) values (
      new.organization_id, new.project_id, new.customer_user_id,
      revision_record.credit_grant_id, revision_record.credit_digest,
      new.quote_id, new.id, revision_record.credit_amount_minor,
      revision_record.currency, 'reserved', new.accepted_at
    );
  end if;

  update ss.service_custom_build_quotes
     set state = 'accepted'
   where id = new.quote_id and state = 'issued';
  if not found then
    raise exception 'custom build quote acceptance could not seal quote state'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create or replace function ss.ensure_service_custom_build_invoice(
  target_acceptance_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  accepted record;
  selected_invoice_id uuid;
begin
  select invoice.id into selected_invoice_id
    from ss.service_custom_build_invoices invoice
   where invoice.quote_acceptance_id = target_acceptance_id;
  if found then return selected_invoice_id; end if;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.case_id,
    acceptance.customer_user_id,
    acceptance.quote_id,
    acceptance.quote_revision,
    acceptance.quote_revision_id,
    acceptance.id as acceptance_id,
    acceptance.accepted_quote_digest,
    acceptance.accepted_disclosure_digest,
    acceptance.accepted_at,
    revision.policy_id,
    revision.scope_boundary_digest,
    revision.tier_id,
    revision.start_value_minor,
    revision.start_credit_minor,
    revision.start_due_minor,
    revision.final_due_minor,
    revision.currency,
    application.id as credit_application_id,
    application.state as credit_application_state,
    installment.id as quote_installment_id
  into accepted
    from ss.service_custom_build_quote_acceptances acceptance
    join ss.service_custom_build_quotes quote
      on quote.organization_id = acceptance.organization_id
     and quote.id = acceptance.quote_id
    join ss.service_custom_build_quote_revisions revision
      on revision.organization_id = acceptance.organization_id
     and revision.quote_id = acceptance.quote_id
     and revision.quote_revision = acceptance.quote_revision
     and revision.id = acceptance.quote_revision_id
    left join ss.service_credit_applications application
      on application.organization_id = acceptance.organization_id
     and application.quote_acceptance_id = acceptance.id
    join ss.service_custom_build_quote_installments installment
      on installment.organization_id = revision.organization_id
     and installment.quote_revision_id = revision.id
     and installment.installment_number = 1
   where acceptance.id = target_acceptance_id
     and quote.state = 'accepted'
     and (
       (revision.start_credit_minor = 0
         and application.id is null)
       or
       (revision.start_credit_minor = 20000
         and application.state = 'reserved')
     )
     and revision.start_due_minor > 0
     and installment.gross_value_minor = revision.start_value_minor
     and installment.credit_amount_minor = revision.start_credit_minor
     and installment.amount_due_minor = revision.start_due_minor;

  if not found then
    raise exception 'Custom build invoice requires one exact accepted first installment'
      using errcode = '55000';
  end if;

  insert into ss.service_custom_build_invoices (
    organization_id, project_id, case_id, customer_user_id, purpose,
    quote_id, quote_revision, quote_revision_id, quote_acceptance_id,
    credit_application_id, policy_id, scope_boundary_digest, tier_id,
    accepted_quote_digest, accepted_disclosure_digest,
    gross_start_minor, credit_minor, subtotal_minor, final_due_minor,
    currency, tax_state, state, charge_occurred,
    issued_at, payment_deadline, created_at
  ) values (
    accepted.organization_id, accepted.project_id, accepted.case_id,
    accepted.customer_user_id, 'custom_build_start', accepted.quote_id,
    accepted.quote_revision, accepted.quote_revision_id,
    accepted.acceptance_id, accepted.credit_application_id,
    accepted.policy_id, accepted.scope_boundary_digest, accepted.tier_id,
    accepted.accepted_quote_digest, accepted.accepted_disclosure_digest,
    accepted.start_value_minor, accepted.start_credit_minor,
    accepted.start_due_minor, accepted.final_due_minor, accepted.currency,
    'calculation_required', 'tax_calculation_pending', false,
    accepted.accepted_at, accepted.accepted_at + interval '7 days',
    clock_timestamp()
  ) returning id into selected_invoice_id;

  insert into ss.service_custom_build_invoice_lines (
    organization_id, invoice_id, quote_installment_id, line_number,
    component_key, display_name, amount_minor, currency, created_at
  ) values (
    accepted.organization_id, selected_invoice_id,
    accepted.quote_installment_id, 1, 'custom_build_start',
    ss.custom_build_tier_label(accepted.tier_id) || ' first installment',
    accepted.start_value_minor, 'USD', accepted.accepted_at
  );

  if accepted.start_credit_minor = 20000 then
    insert into ss.service_custom_build_invoice_lines (
      organization_id, invoice_id, quote_installment_id, line_number,
      component_key, display_name, amount_minor, currency, created_at
    ) values (
      accepted.organization_id, selected_invoice_id,
      accepted.quote_installment_id, 2, 'assessment_build_credit',
      'Website assessment build credit', -20000, 'USD',
      accepted.accepted_at
    );
  end if;
  return selected_invoice_id;
end
$$;

create or replace function ss.guard_service_custom_build_checkout_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  invoice_record record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build Checkout history is append-only'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    select invoice.* into invoice_record
      from ss.service_custom_build_invoices invoice
      join ss.service_custom_build_quotes quote
        on quote.organization_id = invoice.organization_id
       and quote.id = invoice.quote_id
      left join ss.service_credit_applications application
        on application.organization_id = invoice.organization_id
       and application.id = invoice.credit_application_id
     where invoice.organization_id = new.organization_id
       and invoice.id = new.invoice_id
       and invoice.project_id = new.project_id
       and invoice.customer_user_id = new.customer_user_id
       and invoice.invoice_digest = new.invoice_digest
       and invoice.accepted_quote_digest = new.accepted_quote_digest
       and invoice.accepted_disclosure_digest = new.accepted_disclosure_digest
       and invoice.subtotal_minor = new.expected_subtotal_minor
       and invoice.payment_deadline > clock_timestamp()
       and (
         (invoice.credit_minor = 0 and application.id is null)
         or (invoice.credit_minor = 20000 and application.state = 'reserved')
       )
       and quote.state = 'accepted';
    if not found
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or new.state <> 'provider_pending'
      or new.provider_effect_certainty <> 'not_submitted'
    then
      raise exception 'Custom build Checkout lacks current invoice authority'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.invoice_id, new.command_id, new.provider, new.purpose_digest,
    new.invoice_digest, new.accepted_quote_digest,
    new.accepted_disclosure_digest, new.expected_subtotal_minor,
    new.currency, new.tax_mode, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.invoice_id, old.command_id, old.provider, old.purpose_digest,
    old.invoice_digest, old.accepted_quote_digest,
    old.accepted_disclosure_digest, old.expected_subtotal_minor,
    old.currency, old.tax_mode, old.created_at
  ) then
    raise exception 'Custom build Checkout identity is immutable'
      using errcode = '55000';
  end if;

  if ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and ss.current_service_actor_user_id() is not distinct from old.customer_user_id
    and (
      (old.state = 'provider_pending'
        and new.state in ('ready', 'failed', 'persistence_unknown'))
      or (old.state = 'ready' and new.state = 'expired')
    )
  then return new; end if;

  if ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and old.state = 'ready' and new.state = 'paid'
  then return new; end if;

  raise exception 'Custom build Checkout transition lacks authority'
    using errcode = '42501';
end
$$;

create function ss.lock_service_custom_build_checkout_invoice(
  selected_organization_id uuid,
  selected_project_id uuid,
  selected_customer_user_id uuid,
  selected_invoice_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'customer'
    or ss.current_service_actor_org_id()
      is distinct from selected_organization_id
    or ss.current_service_actor_user_id()
      is distinct from selected_customer_user_id
  then
    return false;
  end if;

  perform quote.id
    from ss.service_custom_build_invoices invoice
    join ss.service_custom_build_quotes quote
      on quote.organization_id = invoice.organization_id
     and quote.id = invoice.quote_id
   where invoice.organization_id = selected_organization_id
     and invoice.project_id = selected_project_id
     and invoice.customer_user_id = selected_customer_user_id
     and invoice.id = selected_invoice_id
     and quote.state = 'accepted'
   for update of quote;
  return found;
end
$$;

create or replace function ss.prepare_service_custom_build_quote_void()
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
    or ss.current_service_actor_org_id() is distinct from quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', recorded_at
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

  if exists (
    select 1
      from ss.service_custom_build_invoices invoice
      join ss.service_custom_build_checkout_attempts attempt
        on attempt.organization_id = invoice.organization_id
       and attempt.invoice_id = invoice.id
     where invoice.organization_id = quote_record.organization_id
       and invoice.quote_id = quote_record.id
       and attempt.state not in ('failed', 'expired')
  ) or exists (
    select 1
      from ss.service_custom_build_payment_receipts receipt
      join ss.service_custom_build_invoices invoice
        on invoice.organization_id = receipt.organization_id
       and invoice.id = receipt.invoice_id
     where invoice.organization_id = quote_record.organization_id
       and invoice.quote_id = quote_record.id
  ) then
    raise exception 'custom build quote has unresolved or settled payment evidence'
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

create or replace function ss.guard_service_custom_build_quote_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  recorded_at timestamptz := clock_timestamp();
begin
  if row(
    new.id, new.organization_id, new.project_id, new.case_id,
    new.customer_user_id, new.origin, new.direct_opportunity_id,
    new.source_job_id, new.source_report_id, new.credit_selection,
    new.created_by_operator_user_id, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.case_id,
    old.customer_user_id, old.origin, old.direct_opportunity_id,
    old.source_job_id, old.source_report_id, old.credit_selection,
    old.created_by_operator_user_id, old.created_at
  ) then
    raise exception 'custom build quote identity is immutable'
      using errcode = '55000';
  end if;
  if new.current_revision = old.current_revision + 1
    and new.state = old.state and old.state = 'issued'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', recorded_at
    )
  then
    new.updated_at := recorded_at;
    return new;
  end if;
  if new.current_revision = old.current_revision
    and old.state = 'issued' and new.state = 'accepted'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
    and exists (
      select 1 from ss.service_custom_build_quote_acceptances acceptance
       where acceptance.quote_id = old.id
    )
  then
    new.updated_at := recorded_at;
    return new;
  end if;
  if new.current_revision = old.current_revision
    and old.state in ('issued', 'accepted') and new.state = 'voided'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', recorded_at
    )
    and exists (
      select 1 from ss.service_custom_build_quote_voids quote_void
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

alter table ss.service_custom_build_direct_opportunities
  enable row level security;
alter table ss.service_custom_build_direct_opportunities
  force row level security;
revoke all on ss.service_custom_build_direct_opportunities
from public, anon, authenticated, service_role;
grant select on ss.service_custom_build_direct_opportunities to service_role;

revoke all on function
  ss.materialize_service_custom_build_direct_opportunity()
from public, anon, authenticated, service_role;

revoke all on function ss.lock_service_custom_build_checkout_invoice(
  uuid, uuid, uuid, uuid
)
from public, anon, authenticated, service_role;
grant execute on function ss.lock_service_custom_build_checkout_invoice(
  uuid, uuid, uuid, uuid
)
to service_role;

create function ss.custom_build_direct_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-custom-direct-v1-engagement-optional-credit'::text
$$;

revoke all on function ss.custom_build_direct_contract_v1()
from public, anon, authenticated;
grant execute on function ss.custom_build_direct_contract_v1()
to service_role;

commit;
