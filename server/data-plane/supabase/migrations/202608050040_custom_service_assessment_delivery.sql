begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v39()') is null
    or to_regclass('ss.service_assessment_jobs') is null
    or to_regclass('ss.service_documents') is null
  then
    raise exception
      'Site Sourcery migration 039 must be applied before assessment delivery'
      using errcode = '55000';
  end if;
end
$$;

-- Assessment evidence and reports are deliberately small, private PostgreSQL
-- objects in v40. This keeps the first usable delivery path atomic: document
-- metadata can never claim bytes that failed to commit, and a report and its
-- credit either appear together or not at all. A later storage migration may
-- move exact digest-addressed bytes without changing customer truth.
alter table ss.service_documents
  add constraint service_documents_exact_payload_identity
  unique (
    organization_id,
    id,
    content_digest,
    byte_count,
    media_type
  );

alter table ss.service_catalog_policies
  add constraint service_catalog_policies_contract_identity
  unique (id, commercial_contract_digest);

create table ss.service_document_payloads (
  organization_id uuid not null,
  document_id uuid not null,
  media_type text not null
    check (
      media_type in (
        'application/json',
        'image/jpeg',
        'image/png',
        'image/webp'
      )
    ),
  payload bytea not null
    check (octet_length(payload) between 1 and 786432),
  content_digest ss.sha256_hex generated always as (
    encode(extensions.digest(payload, 'sha256'), 'hex')::ss.sha256_hex
  ) stored,
  byte_count bigint generated always as (
    octet_length(payload)::bigint
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, document_id),
  foreign key (
    organization_id,
    document_id,
    content_digest,
    byte_count,
    media_type
  ) references ss.service_documents(
    organization_id,
    id,
    content_digest,
    byte_count,
    media_type
  ) deferrable initially deferred
);

create table ss.service_assessment_evidence (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  job_id uuid not null,
  document_id uuid not null,
  review_target text not null
    check (
      ss.service_quote_review_targets_are_canonical(array[review_target])
    ),
  viewport text not null check (viewport in ('desktop', 'phone')),
  accessible_description text not null
    check (
      char_length(accessible_description) between 10 and 500
      and ss.service_text_excludes_credentials(accessible_description)
    ),
  command_id text not null
    check (
      char_length(command_id) between 8 and 200
      and command_id !~ '[[:cntrl:]]'
    ),
  request_digest ss.sha256_hex not null,
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  captured_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_assessment_jobs(organization_id, id),
  foreign key (organization_id, document_id)
    references ss.service_document_payloads(organization_id, document_id),
  unique (organization_id, id),
  unique (organization_id, job_id, id),
  unique (document_id),
  unique (created_by_operator_user_id, job_id, command_id),
  check (created_at >= captured_at)
);

create function ss.service_assessment_viewports_are_canonical(value text[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select value in (
    array['desktop']::text[],
    array['phone']::text[],
    array['desktop', 'phone']::text[]
  )
$$;

create function ss.service_assessment_evidence_ids_are_canonical(value uuid[])
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select
    value is not null
    and cardinality(value) between 1 and 10
    and array_position(value, null) is null
    and value = (
      select array_agg(candidate order by candidate::text)
        from (select distinct unnest(value) as candidate) selected
    )
$$;

create table ss.service_assessment_finding_drafts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  job_id uuid not null,
  priority integer not null check (priority between 1 and 10),
  included boolean not null default true,
  severity text not null
    check (severity in ('critical', 'high', 'moderate', 'low', 'positive')),
  category text not null
    check (
      category in (
        'accessibility',
        'content',
        'functionality',
        'performance',
        'responsive_design',
        'search_visibility',
        'security_observation',
        'usability',
        'visual_design'
      )
    ),
  primary_target text not null
    check (
      ss.service_quote_review_targets_are_canonical(array[primary_target])
    ),
  viewports text[] not null
    check (ss.service_assessment_viewports_are_canonical(viewports)),
  summary text not null
    check (
      char_length(summary) between 10 and 240
      and ss.service_text_excludes_credentials(summary)
    ),
  recommendation text not null
    check (
      char_length(recommendation) between 10 and 1500
      and ss.service_text_excludes_credentials(recommendation)
    ),
  evidence_ids uuid[] not null
    check (ss.service_assessment_evidence_ids_are_canonical(evidence_ids)),
  revision bigint not null default 1 check (revision > 0),
  finding_digest ss.sha256_hex not null,
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_assessment_jobs(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, job_id, id),
  unique (job_id, priority),
  check (updated_at >= created_at)
);

create table ss.service_assessment_reports (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  payment_receipt_id uuid not null,
  document_id uuid not null,
  report_schema text not null
    check (report_schema = 'sitesourcery.assessment-report/v1'),
  overall_summary text not null
    check (
      char_length(overall_summary) between 20 and 2000
      and ss.service_text_excludes_credentials(overall_summary)
    ),
  review_target_count integer not null check (review_target_count between 1 and 5),
  finding_count integer not null check (finding_count between 0 and 10),
  delivered_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  delivery_command_id text not null
    check (
      char_length(delivery_command_id) between 8 and 200
      and delivery_command_id !~ '[[:cntrl:]]'
    ),
  work_digest ss.sha256_hex not null,
  delivery_digest ss.sha256_hex not null,
  delivered_at timestamptz not null,
  build_credit_acceptance_cutoff timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_assessment_jobs(organization_id, id),
  foreign key (organization_id, payment_receipt_id)
    references ss.service_assessment_payment_receipts(organization_id, id),
  foreign key (organization_id, document_id)
    references ss.service_document_payloads(organization_id, document_id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (organization_id, job_id, id),
  unique (delivered_by_operator_user_id, job_id, delivery_command_id),
  unique (job_id),
  unique (document_id),
  check (
    build_credit_acceptance_cutoff = delivered_at + interval '90 days'
  ),
  check (created_at >= delivered_at)
);

create table ss.service_assessment_report_findings (
  report_id uuid not null,
  organization_id uuid not null,
  job_id uuid not null,
  finding_id uuid not null,
  finding_revision bigint not null check (finding_revision > 0),
  priority integer not null check (priority between 1 and 10),
  finding_digest ss.sha256_hex not null,
  evidence_ids uuid[] not null
    check (ss.service_assessment_evidence_ids_are_canonical(evidence_ids)),
  created_at timestamptz not null,
  primary key (report_id, finding_id),
  foreign key (organization_id, job_id, report_id)
    references ss.service_assessment_reports(organization_id, job_id, id),
  foreign key (organization_id, job_id, finding_id)
    references ss.service_assessment_finding_drafts(organization_id, job_id, id),
  unique (report_id, priority)
);

create table ss.service_credit_grants (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  source_kind text not null check (source_kind = 'standard_assessment'),
  source_job_id uuid not null,
  source_payment_receipt_id uuid not null,
  source_report_id uuid not null,
  policy_id uuid not null,
  governing_contract_id text not null,
  governing_contract_digest ss.sha256_hex not null,
  amount_minor bigint not null check (amount_minor = 20000),
  currency text not null check (currency = 'USD'),
  application_scope text not null check (application_scope = 'custom_base_build'),
  eligible_tier_ids text[] not null
    check (
      eligible_tier_ids = array[
        'card',
        'card-plus',
        'site',
        'site-plus',
        'signature',
        'flagship',
        'scale'
      ]::text[]
    ),
  maximum_applications integer not null check (maximum_applications = 1),
  non_cash boolean not null check (non_cash),
  delivered_at timestamptz not null,
  acceptance_cutoff timestamptz not null,
  credit_digest ss.sha256_hex not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, source_job_id)
    references ss.service_assessment_jobs(organization_id, id),
  foreign key (organization_id, source_payment_receipt_id)
    references ss.service_assessment_payment_receipts(organization_id, id),
  foreign key (organization_id, source_job_id, source_report_id)
    references ss.service_assessment_reports(organization_id, job_id, id),
  foreign key (policy_id, governing_contract_digest)
    references ss.service_catalog_policies(id, commercial_contract_digest),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (source_job_id),
  unique (source_payment_receipt_id),
  unique (source_report_id),
  check (acceptance_cutoff = delivered_at + interval '90 days')
);

-- The operator can revise working findings before delivery, but every other
-- assessment artifact is append-only. Delivery freezes exact draft revisions
-- into service_assessment_report_findings.
create function ss.guard_service_assessment_work()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_evidence_count integer;
  selected_priorities integer[];
  expected_priorities integer[];
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      clock_timestamp()
    )
  then
    raise exception 'assessment work mutation lacks operator authority'
      using errcode = '42501';
  end if;

  select job.* into selected_job
    from ss.service_assessment_jobs job
   where job.organization_id = new.organization_id
     and job.id = new.job_id;
  if not found then
    raise exception 'assessment job is unavailable'
      using errcode = '23503';
  end if;
  if selected_job.project_id <> new.project_id
    or selected_job.case_id <> new.case_id
  then
    raise exception 'assessment work scope does not match its job'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from ss.service_assessment_reports report
     where report.job_id = new.job_id
  ) then
    raise exception 'delivered assessment work is immutable'
      using errcode = '55000';
  end if;

  if tg_table_name = 'service_assessment_evidence' then
    if ss.current_service_actor_user_id() is distinct from
      new.created_by_operator_user_id
      or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      clock_timestamp()
    ) or not (new.review_target = any(selected_job.review_targets))
    then
      raise exception 'assessment evidence is outside the paid job boundary'
        using errcode = '23514';
    end if;
    if (
      select count(*)
        from ss.service_assessment_evidence evidence
       where evidence.job_id = new.job_id
    ) >= 30 then
      raise exception 'assessment evidence upload limit reached'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from ss.service_documents document
        join ss.service_document_payloads payload
          on payload.organization_id = document.organization_id
         and payload.document_id = document.id
         and payload.content_digest = document.content_digest
         and payload.byte_count = document.byte_count
         and payload.media_type = document.media_type
       where document.organization_id = new.organization_id
         and document.project_id = new.project_id
         and document.case_id = new.case_id
         and document.id = new.document_id
         and document.document_kind = 'assessment_evidence'
         and document.visibility = 'customer'
         and document.retention_class = 'project'
         and document.media_type in ('image/jpeg', 'image/png', 'image/webp')
    ) then
      raise exception 'assessment evidence document is invalid'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'service_assessment_finding_drafts' then
    if ss.current_service_actor_user_id() is distinct from
      new.created_by_operator_user_id
      or not (new.primary_target = any(selected_job.review_targets))
    then
      raise exception 'assessment finding target is outside the paid job boundary'
        using errcode = '23514';
    end if;
    select count(*) into selected_evidence_count
      from ss.service_assessment_evidence evidence
     where evidence.organization_id = new.organization_id
       and evidence.job_id = new.job_id
       and evidence.id = any(new.evidence_ids)
       and evidence.review_target = new.primary_target;
    if selected_evidence_count <> cardinality(new.evidence_ids) then
      raise exception 'assessment finding evidence is outside its target or job'
        using errcode = '23514';
    end if;
    if exists (
      select 1
        from unnest(new.viewports) required(viewport)
       where not exists (
         select 1
           from ss.service_assessment_evidence evidence
          where evidence.organization_id = new.organization_id
            and evidence.job_id = new.job_id
            and evidence.id = any(new.evidence_ids)
            and evidence.viewport = required.viewport
       )
    ) or exists (
      select 1
        from ss.service_assessment_evidence evidence
       where evidence.organization_id = new.organization_id
         and evidence.job_id = new.job_id
         and evidence.id = any(new.evidence_ids)
         and not (evidence.viewport = any(new.viewports))
    ) then
      raise exception 'assessment finding viewport evidence is incomplete'
        using errcode = '23514';
    end if;
    if tg_op = 'INSERT' then
      if new.revision <> 1 then
        raise exception 'new assessment finding must begin at revision one'
          using errcode = '23514';
      end if;
    else
      if row(
        new.id,
        new.organization_id,
        new.project_id,
        new.case_id,
        new.job_id,
        new.priority,
        new.created_by_operator_user_id,
        new.created_at
      ) is distinct from row(
        old.id,
        old.organization_id,
        old.project_id,
        old.case_id,
        old.job_id,
        old.priority,
        old.created_by_operator_user_id,
        old.created_at
      ) or new.revision <> old.revision
      then
        raise exception 'assessment finding identity or revision is invalid'
          using errcode = '55000';
      end if;
      new.revision := old.revision + 1;
      new.updated_at := clock_timestamp();
    end if;
    new.finding_digest := ss.service_json_digest(
      jsonb_build_object(
        'category', new.category,
        'evidenceIds', new.evidence_ids,
        'findingId', new.id,
        'included', new.included,
        'jobId', new.job_id,
        'primaryTarget', new.primary_target,
        'priority', new.priority,
        'recommendation', new.recommendation,
        'revision', new.revision,
        'schema', 'sitesourcery.assessment-finding-draft/v1',
        'severity', new.severity,
        'summary', new.summary,
        'viewports', new.viewports
      )
    );
  elsif tg_table_name = 'service_assessment_reports' then
    select coalesce(
      array_agg(finding.priority order by finding.priority),
      array[]::integer[]
    ) into selected_priorities
      from ss.service_assessment_finding_drafts finding
     where finding.organization_id = new.organization_id
       and finding.job_id = new.job_id
       and finding.included;
    select coalesce(
      array_agg(sequence order by sequence),
      array[]::integer[]
    ) into expected_priorities
      from generate_series(1, new.finding_count) sequence;
    if ss.current_service_actor_user_id() is distinct from
      new.delivered_by_operator_user_id
      or new.customer_user_id <> selected_job.customer_user_id
      or new.payment_receipt_id <> selected_job.payment_receipt_id
      or new.review_target_count <> cardinality(selected_job.review_targets)
      or new.build_credit_acceptance_cutoff <>
        new.delivered_at + interval '90 days'
    then
      raise exception 'assessment report does not match its paid job'
        using errcode = '23514';
    end if;
    if (
      select count(*)
        from (
          select evidence.review_target, evidence.viewport
            from ss.service_assessment_evidence evidence
           where evidence.organization_id = new.organization_id
             and evidence.job_id = new.job_id
           group by evidence.review_target, evidence.viewport
        ) coverage
    ) <> cardinality(selected_job.review_targets) * 2
      or exists (
        select 1
          from unnest(selected_job.review_targets) target(review_target)
          cross join unnest(array['desktop', 'phone']::text[]) required(viewport)
         where not exists (
           select 1
             from ss.service_assessment_evidence evidence
            where evidence.organization_id = new.organization_id
              and evidence.job_id = new.job_id
              and evidence.review_target = target.review_target
              and evidence.viewport = required.viewport
         )
      )
      or new.finding_count <> (
        select count(*)
          from ss.service_assessment_finding_drafts finding
         where finding.organization_id = new.organization_id
           and finding.job_id = new.job_id
           and finding.included
      )
      or selected_priorities <> expected_priorities
    then
      raise exception 'assessment report lacks exact coverage or finding proof'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
        from ss.service_documents document
        join ss.service_document_payloads payload
          on payload.organization_id = document.organization_id
         and payload.document_id = document.id
         and payload.content_digest = document.content_digest
         and payload.byte_count = document.byte_count
         and payload.media_type = document.media_type
       where document.organization_id = new.organization_id
         and document.project_id = new.project_id
         and document.case_id = new.case_id
         and document.id = new.document_id
         and document.document_kind = 'assessment_report'
         and document.visibility = 'customer'
         and document.retention_class = 'project'
         and document.media_type = 'application/json'
    ) then
      raise exception 'assessment report document is invalid'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create function ss.materialize_service_assessment_delivery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
begin
  insert into ss.service_assessment_report_findings (
    report_id,
    organization_id,
    job_id,
    finding_id,
    finding_revision,
    priority,
    finding_digest,
    evidence_ids,
    created_at
  )
  select
    new.id,
    finding.organization_id,
    finding.job_id,
    finding.id,
    finding.revision,
    finding.priority,
    finding.finding_digest,
    finding.evidence_ids,
    new.delivered_at
  from ss.service_assessment_finding_drafts finding
  where finding.organization_id = new.organization_id
    and finding.job_id = new.job_id
    and finding.included
  order by finding.priority;

  insert into ss.service_credit_grants (
    id,
    organization_id,
    project_id,
    case_id,
    customer_user_id,
    source_kind,
    source_job_id,
    source_payment_receipt_id,
    source_report_id,
    policy_id,
    governing_contract_id,
    governing_contract_digest,
    amount_minor,
    currency,
    application_scope,
    eligible_tier_ids,
    maximum_applications,
    non_cash,
    delivered_at,
    acceptance_cutoff,
    credit_digest,
    created_at
  )
  select
    extensions.gen_random_uuid(),
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    'standard_assessment',
    new.job_id,
    new.payment_receipt_id,
    new.id,
    job.policy_id,
    policy.commercial_contract_id,
    policy.commercial_contract_digest,
    20000,
    'USD',
    'custom_base_build',
    array[
      'card',
      'card-plus',
      'site',
      'site-plus',
      'signature',
      'flagship',
      'scale'
    ]::text[],
    1,
    true,
    new.delivered_at,
    new.build_credit_acceptance_cutoff,
    repeat('0', 64)::ss.sha256_hex,
    new.delivered_at
  from ss.service_assessment_jobs job
  join ss.service_catalog_policies policy
    on policy.id = job.policy_id
  where job.organization_id = new.organization_id
    and job.id = new.job_id;

  if not found then
    raise exception 'assessment delivery could not create its exact credit'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.guard_service_assessment_document()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from new.created_by_user_id
    or new.created_by_kind <> 'operator'
    or new.document_kind not in ('assessment_evidence', 'assessment_report')
    or new.visibility <> 'customer'
    or new.retention_class <> 'project'
    or new.object_key not like
      'service-documents/' || new.organization_id::text || '/' ||
      new.project_id::text || '/%'
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      clock_timestamp()
    )
  then
    raise exception 'assessment document mutation lacks bounded authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create function ss.guard_service_assessment_credit_grant()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  source record;
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      clock_timestamp()
    )
  then
    raise exception 'assessment credit grant lacks operator authority'
      using errcode = '42501';
  end if;
  select
    report.project_id,
    report.case_id,
    report.customer_user_id,
    report.payment_receipt_id,
    report.delivered_at,
    report.build_credit_acceptance_cutoff,
    job.policy_id,
    policy.commercial_contract_id,
    policy.commercial_contract_digest
  into source
  from ss.service_assessment_reports report
  join ss.service_assessment_jobs job
    on job.organization_id = report.organization_id
   and job.id = report.job_id
  join ss.service_catalog_policies policy
    on policy.id = job.policy_id
  where report.organization_id = new.organization_id
    and report.id = new.source_report_id
    and report.job_id = new.source_job_id;
  if not found
    or new.project_id <> source.project_id
    or new.case_id <> source.case_id
    or new.customer_user_id <> source.customer_user_id
    or new.source_payment_receipt_id <> source.payment_receipt_id
    or new.policy_id <> source.policy_id
    or new.governing_contract_id <> source.commercial_contract_id
    or new.governing_contract_digest <> source.commercial_contract_digest
    or new.delivered_at <> source.delivered_at
    or new.acceptance_cutoff <> source.build_credit_acceptance_cutoff
  then
    raise exception 'assessment credit grant does not match delivered paid work'
      using errcode = '23514';
  end if;
  new.credit_digest := ss.service_json_digest(
    jsonb_build_object(
      'acceptanceCutoff', new.acceptance_cutoff,
      'amountMinor', new.amount_minor,
      'applicationScope', new.application_scope,
      'creditId', new.id,
      'currency', new.currency,
      'customerId', new.customer_user_id,
      'deliveredAt', new.delivered_at,
      'eligibleTierIds', new.eligible_tier_ids,
      'governingContractDigest', new.governing_contract_digest,
      'governingContractId', new.governing_contract_id,
      'maximumApplications', new.maximum_applications,
      'nonCash', new.non_cash,
      'organizationId', new.organization_id,
      'projectId', new.project_id,
      'schema', 'sitesourcery.custom-build-credit-grant/v1',
      'sourceJobId', new.source_job_id,
      'sourceKind', new.source_kind,
      'sourceReportId', new.source_report_id
    )
  );
  return new;
end
$$;

create function ss.guard_service_assessment_payload()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_document_manage',
      clock_timestamp()
    )
  then
    raise exception 'assessment document payload lacks operator authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create function ss.guard_service_assessment_report_finding()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  finding record;
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      clock_timestamp()
    )
  then
    raise exception 'assessment report finding lacks operator authority'
      using errcode = '42501';
  end if;
  select draft.* into finding
    from ss.service_assessment_finding_drafts draft
   where draft.organization_id = new.organization_id
     and draft.job_id = new.job_id
     and draft.id = new.finding_id;
  if not found
    or not finding.included
    or new.finding_revision <> finding.revision
    or new.priority <> finding.priority
    or new.finding_digest <> finding.finding_digest
    or new.evidence_ids <> finding.evidence_ids
  then
    raise exception 'assessment report finding is not an exact delivered snapshot'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_documents_assessment_guard
before insert on ss.service_documents
for each row execute function ss.guard_service_assessment_document();

create trigger service_document_payloads_immutable
before update or delete on ss.service_document_payloads
for each row execute function ss.reject_update();

create trigger service_document_payloads_guard
before insert on ss.service_document_payloads
for each row execute function ss.guard_service_assessment_payload();

create trigger service_assessment_evidence_guard
before insert on ss.service_assessment_evidence
for each row execute function ss.guard_service_assessment_work();

create trigger service_assessment_evidence_immutable
before update or delete on ss.service_assessment_evidence
for each row execute function ss.reject_update();

create trigger service_assessment_finding_drafts_guard
before insert or update on ss.service_assessment_finding_drafts
for each row execute function ss.guard_service_assessment_work();

create trigger service_assessment_finding_drafts_no_delete
before delete on ss.service_assessment_finding_drafts
for each row execute function ss.reject_update();

create trigger service_assessment_reports_guard
before insert on ss.service_assessment_reports
for each row execute function ss.guard_service_assessment_work();

create trigger service_assessment_reports_immutable
before update or delete on ss.service_assessment_reports
for each row execute function ss.reject_update();

create trigger service_assessment_reports_materialize
after insert on ss.service_assessment_reports
for each row execute function ss.materialize_service_assessment_delivery();

create trigger service_assessment_report_findings_immutable
before update or delete on ss.service_assessment_report_findings
for each row execute function ss.reject_update();

create trigger service_assessment_report_findings_guard
before insert on ss.service_assessment_report_findings
for each row execute function ss.guard_service_assessment_report_finding();

create trigger service_credit_grants_guard
before insert on ss.service_credit_grants
for each row execute function ss.guard_service_assessment_credit_grant();

create trigger service_credit_grants_immutable
before update or delete on ss.service_credit_grants
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_document_payloads',
    'service_assessment_evidence',
    'service_assessment_finding_drafts',
    'service_assessment_reports',
    'service_assessment_report_findings',
    'service_credit_grants'
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

grant insert on table ss.service_documents to service_role;
grant update on table ss.service_assessment_finding_drafts to service_role;
revoke insert on table
  ss.service_assessment_report_findings,
  ss.service_credit_grants
from service_role;

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
         'service_assessment_viewports_are_canonical',
         'service_assessment_evidence_ids_are_canonical',
         'guard_service_assessment_work',
         'guard_service_assessment_document',
         'guard_service_assessment_credit_grant',
         'guard_service_assessment_payload',
         'guard_service_assessment_report_finding'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;

  if has_table_privilege(
    'service_role',
    'ss.service_assessment_report_findings',
    'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_credit_grants',
    'INSERT'
  ) then
    raise exception 'assessment delivery materialization is directly writable'
      using errcode = '55000';
  end if;
end
$$;

revoke all on function ss.materialize_service_assessment_delivery()
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_document_payloads',
    'service_assessment_evidence',
    'service_assessment_finding_drafts',
    'service_assessment_reports',
    'service_assessment_report_findings',
    'service_credit_grants'
  ]
  loop
    if has_table_privilege('service_role', format('ss.%I', table_name), 'DELETE')
      or has_table_privilege('service_role', format('ss.%I', table_name), 'TRUNCATE')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'INSERT')
    then
      raise exception 'assessment delivery privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege('service_role', 'ss.service_documents', 'UPDATE')
    or has_table_privilege('service_role', 'ss.service_documents', 'DELETE')
    or has_table_privilege('service_role', 'ss.service_documents', 'TRUNCATE')
  then
    raise exception 'assessment document authority is not append-only'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v40()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v40-custom-service-assessment-delivery'::text
$$;

revoke all on function ss.hosted_runtime_contract_v40()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v40()
to authenticated, service_role;

commit;
