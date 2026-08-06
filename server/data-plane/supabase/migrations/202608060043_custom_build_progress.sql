begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v42()') is null
    or to_regclass('ss.service_custom_build_jobs') is null
    or to_regclass('ss.service_access_requests') is null
  then
    raise exception
      'Site Sourcery migration 042 must be applied before Custom build progress'
      using errcode = '55000';
  end if;
end
$$;

-- Progress is a short append-only customer-safe history. It deliberately is
-- not a general task system and cannot change the paid job or its money facts.
create table ss.service_custom_build_progress_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  revision bigint not null check (revision = expected_revision + 1),
  stage text not null check (
    stage in ('preparing', 'building', 'checking')
  ),
  structure_milestone text not null check (
    structure_milestone in ('pending', 'in_progress', 'done')
  ),
  content_milestone text not null check (
    content_milestone in ('pending', 'in_progress', 'done')
  ),
  responsive_milestone text not null check (
    responsive_milestone in ('pending', 'in_progress', 'done')
  ),
  quality_milestone text not null check (
    quality_milestone in ('pending', 'in_progress', 'done')
  ),
  customer_summary text not null check (
    char_length(customer_summary) between 10 and 500
    and ss.service_text_excludes_credentials(customer_summary)
  ),
  next_step text not null check (
    char_length(next_step) between 5 and 500
    and ss.service_text_excludes_credentials(next_step)
  ),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (job_id, revision),
  unique (created_by_operator_user_id, job_id, command_id),
  check (created_at = recorded_at)
);

-- The existing access record becomes usable only for this one exact paid-job
-- request. Other access purposes remain held for their own service slices.
alter table ss.service_access_requests
  drop constraint service_access_requests_reason_code_check;

alter table ss.service_access_requests
  add constraint service_access_requests_reason_code_check
  check (
    reason_code in (
      'assessment_private_access',
      'takeover_inventory',
      'repair_execution',
      'migration_export',
      'domain_configuration',
      'mailbox_configuration',
      'management_operations',
      'custom_build_execution'
    )
  ) not valid;

alter table ss.service_access_requests
  validate constraint service_access_requests_reason_code_check;

alter table ss.service_access_requests
  drop constraint service_access_requests_state_check;

alter table ss.service_access_requests
  add constraint service_access_requests_state_check
  check (state in ('drafted', 'sent')) not valid;

alter table ss.service_access_requests
  validate constraint service_access_requests_state_check;

alter table ss.service_access_requests
  add column job_id uuid,
  add foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  add unique (organization_id, job_id, id);

-- One active request keeps the customer experience calm and unambiguous.
-- Answers remain on the same bounded record when the owner later resolves it.
create table ss.service_custom_build_work_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  access_request_id uuid,
  request_kind text not null check (
    request_kind in (
      'customer_content',
      'customer_decision',
      'delegated_access',
      'outside_dependency'
    )
  ),
  title text not null check (
    char_length(title) between 5 and 120
    and ss.service_text_excludes_credentials(title)
  ),
  customer_message text not null check (
    char_length(customer_message) between 10 and 1000
    and ss.service_text_excludes_credentials(customer_message)
  ),
  safe_instructions text not null check (
    char_length(safe_instructions) between 10 and 1000
    and ss.service_text_excludes_credentials(safe_instructions)
  ),
  target_date_impact text not null check (
    target_date_impact in ('none', 'under_review')
  ),
  response_required boolean generated always as (
    request_kind <> 'outside_dependency'
  ) stored,
  state text not null default 'open' check (
    state in ('open', 'answered', 'resolved', 'withdrawn')
  ),
  revision bigint not null default 1 check (revision > 0),
  expected_progress_revision bigint not null
    check (expected_progress_revision >= 0),
  created_by_operator_user_id uuid not null
    references ss.operator_profiles(user_id),
  create_command_id text not null check (
    char_length(create_command_id) between 8 and 200
    and create_command_id !~ '[[:cntrl:]]'
  ),
  create_digest ss.sha256_hex not null,
  response_kind text check (
    response_kind is null
    or response_kind in ('provided', 'cannot_provide')
  ),
  response_note text check (
    response_note is null
    or (
      char_length(response_note) between 1 and 1000
      and ss.service_text_excludes_credentials(response_note)
    )
  ),
  response_by_customer_user_id uuid references auth.users(id),
  response_command_id text check (
    response_command_id is null
    or (
      char_length(response_command_id) between 8 and 200
      and response_command_id !~ '[[:cntrl:]]'
    )
  ),
  response_digest ss.sha256_hex,
  answered_at timestamptz,
  resolved_by_operator_user_id uuid references ss.operator_profiles(user_id),
  resolution_note text check (
    resolution_note is null
    or (
      char_length(resolution_note) between 5 and 500
      and ss.service_text_excludes_credentials(resolution_note)
    )
  ),
  resolution_command_id text check (
    resolution_command_id is null
    or (
      char_length(resolution_command_id) between 8 and 200
      and resolution_command_id !~ '[[:cntrl:]]'
    )
  ),
  resolution_digest ss.sha256_hex,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (organization_id, job_id, access_request_id)
    references ss.service_access_requests(organization_id, job_id, id),
  unique (organization_id, id),
  unique (created_by_operator_user_id, job_id, create_command_id),
  check (
    (request_kind = 'delegated_access' and access_request_id is not null)
    or (request_kind <> 'delegated_access' and access_request_id is null)
  ),
  check (
    request_kind <> 'outside_dependency'
    or target_date_impact = 'under_review'
  ),
  check (
    row(
      response_kind,
      response_by_customer_user_id,
      response_command_id,
      response_digest,
      answered_at
    ) is null
    or row(
      response_kind,
      response_by_customer_user_id,
      response_command_id,
      response_digest,
      answered_at
    ) is not null
  ),
  check (
    row(
      resolved_by_operator_user_id,
      resolution_note,
      resolution_command_id,
      resolution_digest,
      resolved_at
    ) is null
    or row(
      resolved_by_operator_user_id,
      resolution_note,
      resolution_command_id,
      resolution_digest,
      resolved_at
    ) is not null
  ),
  check (
    (state = 'open' and response_command_id is null
      and resolution_command_id is null)
    or (state = 'answered' and response_command_id is not null
      and resolution_command_id is null and response_required)
    or (state in ('resolved', 'withdrawn')
      and resolution_command_id is not null)
  ),
  check (updated_at >= created_at)
);

create unique index service_custom_build_work_requests_one_active
on ss.service_custom_build_work_requests(job_id)
where state in ('open', 'answered');

create unique index service_custom_build_work_requests_response_command
on ss.service_custom_build_work_requests(
  customer_user_id,
  job_id,
  response_command_id
)
where response_command_id is not null;

create unique index service_custom_build_work_requests_resolution_command
on ss.service_custom_build_work_requests(
  resolved_by_operator_user_id,
  job_id,
  resolution_command_id
)
where resolution_command_id is not null;

create function ss.service_custom_build_stage_rank(value text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case value
    when 'preparing' then 1
    when 'building' then 2
    when 'checking' then 3
  end
$$;

create function ss.service_custom_build_milestone_rank(value text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case value
    when 'pending' then 1
    when 'in_progress' then 2
    when 'done' then 3
  end
$$;

create function ss.prepare_service_custom_build_progress_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  prior_update record;
  recorded_at timestamptz := clock_timestamp();
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from
      new.created_by_operator_user_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      recorded_at
    )
  then
    raise exception 'Custom build progress mutation lacks operator authority'
      using errcode = '42501';
  end if;

  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = new.organization_id
    and job.id = new.job_id;

  if not found
    or selected_job.project_id <> new.project_id
    or selected_job.case_id <> new.case_id
    or selected_job.customer_user_id <> new.customer_user_id
    or selected_job.state <> 'open'
  then
    raise exception 'Custom build progress is outside its paid job'
      using errcode = '23514';
  end if;

  select progress.* into prior_update
  from ss.service_custom_build_progress_updates progress
  where progress.organization_id = new.organization_id
    and progress.job_id = new.job_id
  order by progress.revision desc
  limit 1;

  if new.expected_revision <> coalesce(prior_update.revision, 0)
    or new.revision <> new.expected_revision + 1
  then
    raise exception 'Custom build progress revision changed'
      using errcode = '40001';
  end if;

  if prior_update.id is not null and (
    ss.service_custom_build_stage_rank(new.stage) <
      ss.service_custom_build_stage_rank(prior_update.stage)
    or ss.service_custom_build_milestone_rank(new.structure_milestone) <
      ss.service_custom_build_milestone_rank(
        prior_update.structure_milestone
      )
    or ss.service_custom_build_milestone_rank(new.content_milestone) <
      ss.service_custom_build_milestone_rank(prior_update.content_milestone)
    or ss.service_custom_build_milestone_rank(new.responsive_milestone) <
      ss.service_custom_build_milestone_rank(
        prior_update.responsive_milestone
      )
    or ss.service_custom_build_milestone_rank(new.quality_milestone) <
      ss.service_custom_build_milestone_rank(prior_update.quality_milestone)
  ) then
    raise exception 'Custom build progress cannot move backward'
      using errcode = '23514';
  end if;

  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'commandId', new.command_id,
    'contentMilestone', new.content_milestone,
    'customerSummary', new.customer_summary,
    'expectedRevision', new.expected_revision,
    'jobId', new.job_id,
    'nextStep', new.next_step,
    'qualityMilestone', new.quality_milestone,
    'responsiveMilestone', new.responsive_milestone,
    'schema', 'sitesourcery.custom-build-progress-command/v1',
    'stage', new.stage,
    'structureMilestone', new.structure_milestone
  ));
  new.recorded_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.guard_service_custom_build_access_request()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  recorded_at timestamptz := clock_timestamp();
begin
  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from
      new.requested_by_operator_user_id
    or new.reason_code <> 'custom_build_execution'
    or new.state <> 'sent'
    or new.job_id is null
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      recorded_at
    )
  then
    raise exception 'Custom build delegated-access request lacks authority'
      using errcode = '42501';
  end if;

  select job.* into selected_job
  from ss.service_custom_build_jobs job
  where job.organization_id = new.organization_id
    and job.id = new.job_id;

  if not found
    or selected_job.project_id <> new.project_id
    or selected_job.case_id <> new.case_id
    or selected_job.customer_user_id <> new.customer_user_id
    or selected_job.state <> 'open'
    or new.expires_at <= recorded_at
    or new.expires_at > recorded_at + interval '30 days'
  then
    raise exception 'Custom build delegated-access request is outside its job'
      using errcode = '23514';
  end if;

  new.created_at := recorded_at;
  return new;
end
$$;

create function ss.guard_service_custom_build_work_request()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  selected_job record;
  selected_progress_revision bigint;
  selected_access record;
  recorded_at timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    if ss.current_service_actor_kind() <> 'operator'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from
        new.created_by_operator_user_id
      or not ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_job_manage',
        recorded_at
      )
    then
      raise exception 'Custom build request lacks operator authority'
        using errcode = '42501';
    end if;

    select job.* into selected_job
    from ss.service_custom_build_jobs job
    where job.organization_id = new.organization_id
      and job.id = new.job_id;

    if not found
      or selected_job.project_id <> new.project_id
      or selected_job.case_id <> new.case_id
      or selected_job.customer_user_id <> new.customer_user_id
      or selected_job.state <> 'open'
    then
      raise exception 'Custom build request is outside its paid job'
        using errcode = '23514';
    end if;

    select coalesce(max(progress.revision), 0)
      into selected_progress_revision
    from ss.service_custom_build_progress_updates progress
    where progress.organization_id = new.organization_id
      and progress.job_id = new.job_id;

    if new.expected_progress_revision <> selected_progress_revision then
      raise exception 'Custom build progress changed before the request'
        using errcode = '40001';
    end if;

    if new.request_kind = 'delegated_access' then
      select access.* into selected_access
      from ss.service_access_requests access
      where access.organization_id = new.organization_id
        and access.job_id = new.job_id
        and access.id = new.access_request_id;
      if not found
        or selected_access.project_id <> new.project_id
        or selected_access.case_id <> new.case_id
        or selected_access.customer_user_id <> new.customer_user_id
        or selected_access.requested_by_operator_user_id <>
          new.created_by_operator_user_id
        or selected_access.reason_code <> 'custom_build_execution'
        or selected_access.state <> 'sent'
      then
        raise exception 'Custom build delegated access is not exact'
          using errcode = '23514';
      end if;
    end if;

    if new.state <> 'open'
      or new.revision <> 1
      or new.response_command_id is not null
      or new.resolution_command_id is not null
    then
      raise exception 'Custom build request must start open'
        using errcode = '23514';
    end if;

    new.create_digest := ss.service_json_digest(jsonb_build_object(
      'accessRequestId', new.access_request_id,
      'commandId', new.create_command_id,
      'customerMessage', new.customer_message,
      'expectedProgressRevision', new.expected_progress_revision,
      'jobId', new.job_id,
      'requestKind', new.request_kind,
      'safeInstructions', new.safe_instructions,
      'schema', 'sitesourcery.custom-build-work-request-command/v1',
      'targetDateImpact', new.target_date_impact,
      'title', new.title
    ));
    new.created_at := recorded_at;
    new.updated_at := recorded_at;
    return new;
  end if;

  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.job_id,
    new.access_request_id,
    new.request_kind,
    new.title,
    new.customer_message,
    new.safe_instructions,
    new.target_date_impact,
    new.expected_progress_revision,
    new.created_by_operator_user_id,
    new.create_command_id,
    new.create_digest,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.job_id,
    old.access_request_id,
    old.request_kind,
    old.title,
    old.customer_message,
    old.safe_instructions,
    old.target_date_impact,
    old.expected_progress_revision,
    old.created_by_operator_user_id,
    old.create_command_id,
    old.create_digest,
    old.created_at
  ) or new.revision <> old.revision + 1
  then
    raise exception 'Custom build request identity changed'
      using errcode = '55000';
  end if;

  if ss.current_service_actor_kind() = 'customer' then
    if ss.current_service_actor_org_id() is distinct from old.organization_id
      or ss.current_service_actor_user_id() is distinct from
        old.customer_user_id
      or old.state <> 'open'
      or not old.response_required
      or new.state <> 'answered'
      or new.response_by_customer_user_id is distinct from
        old.customer_user_id
      or new.response_command_id is null
      or new.response_kind is null
      or new.response_note is null
      or row(
        new.resolved_by_operator_user_id,
        new.resolution_note,
        new.resolution_command_id,
        new.resolution_digest,
        new.resolved_at
      ) is distinct from row(
        old.resolved_by_operator_user_id,
        old.resolution_note,
        old.resolution_command_id,
        old.resolution_digest,
        old.resolved_at
      )
    then
      raise exception 'Custom build response lacks customer authority'
        using errcode = '42501';
    end if;

    new.response_digest := ss.service_json_digest(jsonb_build_object(
      'commandId', new.response_command_id,
      'jobId', new.job_id,
      'requestId', new.id,
      'responseKind', new.response_kind,
      'responseNote', new.response_note,
      'schema', 'sitesourcery.custom-build-work-response-command/v1'
    ));
    new.answered_at := recorded_at;
    new.updated_at := recorded_at;
    return new;
  end if;

  if ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from
      old.organization_id
    and ss.current_service_actor_user_id() is not distinct from
      new.resolved_by_operator_user_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_job_manage',
      recorded_at
    )
    and old.state in ('open', 'answered')
    and new.state in ('resolved', 'withdrawn')
    and new.resolution_command_id is not null
    and row(
      new.response_kind,
      new.response_note,
      new.response_by_customer_user_id,
      new.response_command_id,
      new.response_digest,
      new.answered_at
    ) is not distinct from row(
      old.response_kind,
      old.response_note,
      old.response_by_customer_user_id,
      old.response_command_id,
      old.response_digest,
      old.answered_at
    )
  then
    new.resolution_digest := ss.service_json_digest(jsonb_build_object(
      'commandId', new.resolution_command_id,
      'jobId', new.job_id,
      'requestId', new.id,
      'resolutionNote', new.resolution_note,
      'schema', 'sitesourcery.custom-build-work-resolution-command/v1',
      'state', new.state
    ));
    new.resolved_at := recorded_at;
    new.updated_at := recorded_at;
    return new;
  end if;

  raise exception 'Custom build request transition lacks authority'
    using errcode = '42501';
end
$$;

create trigger service_custom_build_progress_updates_prepare
before insert on ss.service_custom_build_progress_updates
for each row execute function ss.prepare_service_custom_build_progress_update();

create trigger service_custom_build_progress_updates_immutable
before update or delete on ss.service_custom_build_progress_updates
for each row execute function ss.reject_update();

create trigger service_access_requests_custom_build_guard
before insert on ss.service_access_requests
for each row execute function ss.guard_service_custom_build_access_request();

create trigger service_custom_build_work_requests_guard
before insert or update on ss.service_custom_build_work_requests
for each row execute function ss.guard_service_custom_build_work_request();

create trigger service_custom_build_work_requests_no_delete
before delete on ss.service_custom_build_work_requests
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_progress_updates',
    'service_custom_build_work_requests'
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

grant update on table ss.service_custom_build_work_requests to service_role;
grant insert on table ss.service_access_requests to service_role;

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
        'service_custom_build_stage_rank',
        'service_custom_build_milestone_rank',
        'prepare_service_custom_build_progress_update',
        'guard_service_custom_build_access_request',
        'guard_service_custom_build_work_request'
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
    'service_custom_build_progress_updates',
    'service_custom_build_work_requests'
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
      raise exception 'Custom build progress privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role', 'ss.service_custom_build_progress_updates', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_access_requests', 'UPDATE'
  ) then
    raise exception 'Custom build progress history is not append-only'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v43()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v43-custom-build-progress'::text
$$;

revoke all on function ss.hosted_runtime_contract_v43()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v43()
to service_role;

commit;
