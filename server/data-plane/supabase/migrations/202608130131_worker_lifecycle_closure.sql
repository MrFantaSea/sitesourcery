-- FIN-004T worker lifecycle closure
-- Adds only durable worker leases, fences, retries, and receipts. It grants no
-- provider, commercial, publication, DNS, payment, or deletion approval.

begin;

do $$
begin
  if to_regclass('ss.lifecycle_jobs') is null
    or to_regclass('ss.domain_provider_lifecycle_states') is null
    or to_regclass('ss.care_periods') is null
    or to_regprocedure('ss.finalize_terminal_project_purge(uuid)') is null
  then
    raise exception 'FIN-004T requires the canonical project, Domain, and Care lifecycle foundations'
      using errcode = '55000';
  end if;
end
$$;

-- Project lifecycle ---------------------------------------------------------

alter table ss.lifecycle_jobs
  drop constraint lifecycle_jobs_job_type_check,
  drop constraint lifecycle_jobs_state_check,
  add column lease_fence bigint not null default 0
    check (lease_fence between 0 and 9007199254740991),
  add column lease_expires_at timestamptz,
  add column failure_code text,
  add column manual_review_at timestamptz,
  add constraint lifecycle_jobs_state_check check (
    state in (
      'scheduled', 'running', 'succeeded', 'failed', 'cancelled',
      'manual_review', 'dead_letter'
    )
  ),
  add constraint lifecycle_jobs_job_type_check check (
    job_type in (
      'deploy_release', 'verify_domain', 'grace_expiry', 'retention_expiry',
      'unpublish_project', 'delete_blob', 'finalize_deletion',
      'build_export', 'expire_session'
    )
  ),
  add constraint lifecycle_jobs_worker_shape check (
    (
      state = 'running'
      and locked_by is not null
      and locked_at is not null
      and lease_expires_at > locked_at
      and lease_expires_at <= locked_at + interval '5 minutes'
      and lease_fence > 0
    ) or (
      state <> 'running'
      and locked_by is null
      and locked_at is null
      and lease_expires_at is null
    )
  ),
  add constraint lifecycle_jobs_failure_shape check (
    failure_code is null or (
      char_length(failure_code) between 1 and 128
      and failure_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  add constraint lifecycle_jobs_manual_review_shape check (
    (state in ('manual_review', 'dead_letter')) = (manual_review_at is not null)
  );

drop index ss.lifecycle_jobs_ready;
create index lifecycle_jobs_ready
  on ss.lifecycle_jobs(run_at, lease_expires_at, id)
  where state in ('scheduled', 'failed', 'running');

create function ss.clear_lifecycle_job_lease_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.state = 'running' and new.state <> 'running' then
    new.locked_by := null;
    new.locked_at := null;
    new.lease_expires_at := null;
  end if;
  return new;
end
$$;

create trigger lifecycle_jobs_clear_terminal_lease
before update of state on ss.lifecycle_jobs
for each row execute function ss.clear_lifecycle_job_lease_v1();

alter table ss.deletion_requests
  add column purge_serving_hostname ss.canonical_hostname;

create function ss.capture_terminal_purge_hostname_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' and new.purge_serving_hostname is null then
    select address.serving_hostname
      into new.purge_serving_hostname
      from ss.project_address_projection projection
      join ss.project_addresses address
        on address.organization_id = projection.organization_id
       and address.id = projection.current_address_id
     where projection.project_id = new.project_id;
  end if;
  return new;
end
$$;

create trigger deletion_requests_capture_purge_hostname
before insert or update of state on ss.deletion_requests
for each row execute function ss.capture_terminal_purge_hostname_v1();

create function ss.enqueue_terminal_unpublish_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_hostname ss.canonical_hostname;
begin
  if old.lifecycle <> 'deleting' and new.lifecycle = 'deleting' then
    select request.purge_serving_hostname
      into selected_hostname
      from ss.deletion_requests request
     where request.project_id = new.id
       and request.state = 'purging';
    if selected_hostname is not null then
      insert into ss.lifecycle_jobs (
        organization_id, project_id, job_type, dedupe_key, run_at, payload
      ) values (
        new.organization_id, new.id, 'unpublish_project',
        'unpublish-project:' || new.id::text, clock_timestamp(),
        jsonb_build_object(
          'projectId', new.id,
          'hostname', selected_hostname
        )
      ) on conflict (dedupe_key) do nothing;
    end if;
  end if;
  return new;
end
$$;

create trigger projects_enqueue_terminal_unpublish
after update of lifecycle on ss.projects
for each row execute function ss.enqueue_terminal_unpublish_v1();

create table ss.project_lifecycle_job_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  -- The sealed purge function removes its precursor lifecycle rows before it
  -- enqueues delete/finalize work. Keep this digest-only approval receipt.
  lifecycle_job_id uuid not null,
  lease_fence bigint not null check (lease_fence > 0),
  receipt_kind text not null check (
    receipt_kind in (
      'approval_required', 'publication_removed', 'blob_deleted',
      'project_deleted'
    )
  ),
  result_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (lifecycle_job_id),
  unique (organization_id, id)
);

alter table ss.project_lifecycle_job_receipts enable row level security;
alter table ss.project_lifecycle_job_receipts force row level security;
create policy lifecycle_jobs_system
on ss.lifecycle_jobs
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
);
create policy project_lifecycle_job_receipts_system
on ss.project_lifecycle_job_receipts
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
);

revoke all on ss.lifecycle_jobs, ss.project_lifecycle_job_receipts
from public, anon, authenticated, service_role;
grant select, insert, update on ss.lifecycle_jobs to service_role;
grant select, insert on ss.project_lifecycle_job_receipts to service_role;
revoke all on function ss.clear_lifecycle_job_lease_v1()
from public, anon, authenticated;
grant execute on function ss.clear_lifecycle_job_lease_v1()
to service_role;
revoke all on function
  ss.capture_terminal_purge_hostname_v1(),
  ss.enqueue_terminal_unpublish_v1()
from public, anon, authenticated;
grant execute on function
  ss.capture_terminal_purge_hostname_v1(),
  ss.enqueue_terminal_unpublish_v1()
to service_role;

-- Domain lifecycle ----------------------------------------------------------

create table ss.domain_lifecycle_worker_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  lifecycle_state_id uuid not null,
  action text not null check (action = 'refresh_authoritative'),
  state text not null default 'scheduled' check (
    state in ('scheduled', 'running', 'succeeded', 'failed', 'manual_review', 'dead_letter')
  ),
  run_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 50),
  max_attempts integer not null default 12 check (max_attempts between 1 and 50),
  lease_fence bigint not null default 0
    check (lease_fence between 0 and 9007199254740991),
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  failure_code text check (
    failure_code is null or (
      char_length(failure_code) between 1 and 128
      and failure_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  result_digest ss.sha256_hex,
  completed_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, lifecycle_state_id)
    references ss.domain_provider_lifecycle_states(organization_id, id),
  unique (lifecycle_state_id, action),
  unique (organization_id, id),
  check (
    (
      state = 'running' and leased_by is not null and leased_at is not null
      and lease_expires_at > leased_at
      and lease_expires_at <= leased_at + interval '5 minutes'
      and lease_fence > 0
    ) or (
      state <> 'running' and leased_by is null and leased_at is null
      and lease_expires_at is null
    )
  ),
  check ((state in ('manual_review', 'dead_letter')) = (manual_review_at is not null)),
  check ((state = 'succeeded') = (completed_at is not null))
);

create index domain_lifecycle_worker_jobs_ready
  on ss.domain_lifecycle_worker_jobs(run_at, lease_expires_at, id)
  where state in ('scheduled', 'failed', 'running');

create function ss.schedule_domain_lifecycle_refresh_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss, extensions
as $$
begin
  if new.lifecycle_status = 'transferred_out' then
    return new;
  end if;
  insert into ss.domain_lifecycle_worker_jobs (
    organization_id, project_id, lifecycle_state_id, action, state, run_at,
    created_at, updated_at
  ) values (
    new.organization_id, new.project_id, new.id, 'refresh_authoritative',
    'scheduled', new.updated_at + interval '1 day', new.updated_at, new.updated_at
  )
  on conflict (lifecycle_state_id, action) do update
    set state = 'scheduled',
        run_at = excluded.run_at,
        leased_by = null,
        leased_at = null,
        lease_expires_at = null,
        failure_code = null,
        completed_at = null,
        manual_review_at = null,
        updated_at = excluded.updated_at
    where ss.domain_lifecycle_worker_jobs.state <> 'running';
  return new;
end
$$;

create trigger domain_lifecycle_schedule_refresh
after insert or update of state_digest on ss.domain_provider_lifecycle_states
for each row execute function ss.schedule_domain_lifecycle_refresh_v1();

insert into ss.domain_lifecycle_worker_jobs (
  organization_id, project_id, lifecycle_state_id, action, run_at,
  created_at, updated_at
)
select organization_id, project_id, id, 'refresh_authoritative',
       updated_at + interval '1 day', updated_at, updated_at
from ss.domain_provider_lifecycle_states
where lifecycle_status <> 'transferred_out'
on conflict (lifecycle_state_id, action) do nothing;

alter table ss.domain_lifecycle_worker_jobs enable row level security;
alter table ss.domain_lifecycle_worker_jobs force row level security;
create policy domain_lifecycle_worker_jobs_system
on ss.domain_lifecycle_worker_jobs
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
);

revoke all on ss.domain_lifecycle_worker_jobs
from public, anon, authenticated, service_role;
grant select, insert, update on ss.domain_lifecycle_worker_jobs to service_role;
revoke all on function ss.schedule_domain_lifecycle_refresh_v1()
from public, anon, authenticated;
grant execute on function ss.schedule_domain_lifecycle_refresh_v1()
to service_role;

-- Care lifecycle ------------------------------------------------------------

create table ss.care_lifecycle_worker_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  contract_id uuid not null,
  period_id uuid not null,
  action text not null check (action = 'advance_period'),
  state text not null default 'scheduled' check (
    state in ('scheduled', 'running', 'succeeded', 'failed', 'manual_review', 'dead_letter')
  ),
  run_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 50),
  max_attempts integer not null default 12 check (max_attempts between 1 and 50),
  lease_fence bigint not null default 0
    check (lease_fence between 0 and 9007199254740991),
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  failure_code text check (
    failure_code is null or (
      char_length(failure_code) between 1 and 128
      and failure_code ~ '^[A-Z][A-Z0-9_]*$'
    )
  ),
  next_period_id uuid,
  result_digest ss.sha256_hex,
  completed_at timestamptz,
  manual_review_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, project_id, contract_id)
    references ss.care_customer_contracts(organization_id, project_id, id),
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  unique (period_id, action),
  unique (organization_id, id),
  check (
    (
      state = 'running' and leased_by is not null and leased_at is not null
      and lease_expires_at > leased_at
      and lease_expires_at <= leased_at + interval '5 minutes'
      and lease_fence > 0
    ) or (
      state <> 'running' and leased_by is null and leased_at is null
      and lease_expires_at is null
    )
  ),
  check ((state in ('manual_review', 'dead_letter')) = (manual_review_at is not null)),
  check ((state = 'succeeded') = (completed_at is not null))
);

create index care_lifecycle_worker_jobs_ready
  on ss.care_lifecycle_worker_jobs(run_at, lease_expires_at, id)
  where state in ('scheduled', 'failed', 'running');

create function ss.schedule_care_period_advance_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'open' then return new; end if;
  insert into ss.care_lifecycle_worker_jobs (
    organization_id, project_id, contract_id, period_id, action, run_at,
    created_at, updated_at
  ) values (
    new.organization_id, new.project_id, new.contract_id, new.id,
    'advance_period', new.ends_on::timestamptz, new.opened_at, new.updated_at
  ) on conflict (period_id, action) do nothing;
  return new;
end
$$;

create trigger care_period_schedule_advance
after insert on ss.care_periods
for each row execute function ss.schedule_care_period_advance_v1();

insert into ss.care_lifecycle_worker_jobs (
  organization_id, project_id, contract_id, period_id, action, run_at,
  created_at, updated_at
)
select organization_id, project_id, contract_id, id, 'advance_period',
       ends_on::timestamptz, opened_at, updated_at
from ss.care_periods
where state = 'open'
on conflict (period_id, action) do nothing;

alter table ss.care_lifecycle_worker_jobs enable row level security;
alter table ss.care_lifecycle_worker_jobs force row level security;
create policy care_lifecycle_worker_jobs_system
on ss.care_lifecycle_worker_jobs
for all using (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
) with check (
  ss.current_service_actor_kind() = 'system'
  and ss.current_service_actor_org_id() is not distinct from organization_id
);

revoke all on ss.care_lifecycle_worker_jobs
from public, anon, authenticated, service_role;
grant select, insert, update on ss.care_lifecycle_worker_jobs to service_role;
revoke all on function ss.schedule_care_period_advance_v1()
from public, anon, authenticated;
grant execute on function ss.schedule_care_period_advance_v1()
to service_role;

create function ss.worker_lifecycle_closure_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-fin-004t-project-domain-care-leases-v1-held'::text
$$;

revoke all on function ss.worker_lifecycle_closure_contract_v1()
from public, anon, authenticated;
grant execute on function ss.worker_lifecycle_closure_contract_v1()
to service_role;

commit;
