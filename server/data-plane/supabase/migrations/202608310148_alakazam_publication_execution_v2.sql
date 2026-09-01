-- ALAKAZAM-PUBLICATION-EXECUTION-02: released command authority and leases.
--
-- The V1 publication-control command remains immutable held evidence. A V2
-- release row is the separate authority to execute one exact command. The
-- worker job and receipt make every attempt leased, replayable, and explicit
-- when an external effect cannot be reconciled automatically.

begin;

do $$
begin
  if to_regclass('ss.publication_control_commands') is null
    or to_regclass('ss.alakazam_policy_releases') is null
    or to_regprocedure('ss.hosted_publication_control_contract()') is null
    or ss.hosted_publication_control_contract() <>
      'canonical-publication-control-held-v1'
    or to_regprocedure(
      'ss.hosted_alakazam_policy_authority_contract_v2()'
    ) is null
    or ss.hosted_alakazam_policy_authority_contract_v2() <>
      'canonical-alakazam-policy-authority-v2-released'
  then
    raise exception
      'held publication authority and released Alakazam policy V2 must precede publication execution V2'
      using errcode = '55000';
  end if;
end
$$;

create table ss.publication_control_releases (
  command_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  command_digest ss.sha256_hex not null unique,
  policy_id text not null
    check (policy_id = 'SS-ALAKAZAM-POLICY-2026-08-31-V2'),
  policy_digest ss.sha256_hex not null,
  state text not null default 'released'
    check (state = 'released'),
  released_at timestamptz not null,
  release_basis text not null
    check (release_basis = 'owner_approved_2026_08_31'),
  foreign key (organization_id, command_id)
    references ss.publication_control_commands(organization_id, id),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (policy_id)
    references ss.alakazam_policy_releases(policy_id),
  unique (organization_id, command_id)
);

create function ss.validate_publication_control_release()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.publication_control_commands command
      join ss.alakazam_policy_releases policy
        on policy.policy_id = new.policy_id
       and policy.policy_digest = new.policy_digest
       and policy.state = 'released'
       and policy.commercial_effects
       and policy.provider_effects
       and policy.publication_effects
       and not policy.automatic_recovery_from_reversal_evidence
       and new.released_at >= policy.approved_at
     where command.organization_id = new.organization_id
       and command.project_id = new.project_id
       and command.customer_user_id = new.customer_user_id
       and command.id = new.command_id
       and command.command_digest = new.command_digest
       and command.state = 'held'
       and command.hold_reason =
         'privacy_v4_and_commercial_cutover_not_authorized'
       and command.requested_at = new.released_at
  ) then
    raise exception
      'publication release lacks the exact immutable command and released policy authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger publication_control_releases_validate
after insert on ss.publication_control_releases
deferrable initially deferred
for each row execute function ss.validate_publication_control_release();

create function ss.reject_publication_control_release_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'released publication-control authority is immutable'
    using errcode = '55000';
end
$$;

create trigger publication_control_releases_immutable
before update or delete on ss.publication_control_releases
for each row execute function
  ss.reject_publication_control_release_mutation();

create table ss.publication_control_worker_jobs (
  command_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  state text not null default 'queued'
    check (
      state in (
        'queued', 'running', 'failed', 'succeeded',
        'reconciliation_required'
      )
    ),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  max_attempts integer not null default 5
    check (max_attempts between 1 and 10),
  lease_fence bigint not null default 0
    check (lease_fence >= 0),
  leased_by text,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  run_at timestamptz not null,
  failure_code text,
  provider_request_id text,
  provider_result_digest ss.sha256_hex,
  completed_at timestamptz,
  manual_review_at timestamptz,
  queued_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (organization_id, command_id)
    references ss.publication_control_releases(
      organization_id,
      command_id
    ),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, command_id),
  check (
    (leased_by is null and leased_at is null and lease_expires_at is null)
    or (
      leased_by is not null and leased_at is not null
      and lease_expires_at > leased_at
    )
  ),
  check (
    (state = 'running' and leased_by is not null)
    or (state <> 'running' and leased_by is null)
  ),
  check (
    (state = 'succeeded' and completed_at is not null
      and manual_review_at is null and failure_code is null
      and provider_request_id is not null
      and provider_result_digest is not null)
    or state <> 'succeeded'
  ),
  check (
    (state = 'reconciliation_required'
      and manual_review_at is not null and failure_code is not null)
    or state <> 'reconciliation_required'
  )
);

create unique index publication_control_one_open_job_per_project
  on ss.publication_control_worker_jobs(organization_id, project_id)
  where state in ('queued', 'running', 'failed');

create index publication_control_worker_jobs_ready
  on ss.publication_control_worker_jobs(state, run_at, command_id)
  where state in ('queued', 'failed', 'running');

create function ss.validate_publication_control_worker_job()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.publication_control_releases release
      join ss.publication_control_commands command
        on command.organization_id = release.organization_id
       and command.id = release.command_id
     where release.organization_id = new.organization_id
       and release.project_id = new.project_id
       and release.command_id = new.command_id
       and release.state = 'released'
       and command.requested_at = new.queued_at
       and new.run_at >= new.queued_at
  ) then
    raise exception
      'publication worker job lacks released exact-command authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create constraint trigger publication_control_worker_jobs_validate
after insert on ss.publication_control_worker_jobs
deferrable initially deferred
for each row execute function
  ss.validate_publication_control_worker_job();

create function ss.guard_publication_control_worker_job()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if row(
    new.command_id,
    new.organization_id,
    new.project_id,
    new.max_attempts,
    new.queued_at
  ) is distinct from row(
    old.command_id,
    old.organization_id,
    old.project_id,
    old.max_attempts,
    old.queued_at
  ) then
    raise exception 'publication worker job evidence is immutable'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger publication_control_worker_jobs_guard
before update on ss.publication_control_worker_jobs
for each row execute function
  ss.guard_publication_control_worker_job();

create table ss.publication_control_execution_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  command_id uuid not null,
  lease_fence bigint not null check (lease_fence > 0),
  receipt_kind text not null
    check (receipt_kind in ('publication_applied', 'reconciliation_required')),
  provider_request_id text,
  provider_result jsonb not null
    check (jsonb_typeof(provider_result) = 'object'),
  result_digest ss.sha256_hex not null unique,
  recorded_at timestamptz not null,
  foreign key (organization_id, command_id)
    references ss.publication_control_worker_jobs(
      organization_id,
      command_id
    ),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (command_id),
  unique (organization_id, id),
  check (
    receipt_kind <> 'publication_applied'
    or provider_request_id is not null
  )
);

create function ss.reject_publication_control_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'publication execution receipts are immutable'
    using errcode = '55000';
end
$$;

create trigger publication_control_execution_receipts_immutable
before update or delete on ss.publication_control_execution_receipts
for each row execute function
  ss.reject_publication_control_receipt_mutation();

alter table ss.publication_control_releases enable row level security;
alter table ss.publication_control_releases force row level security;
alter table ss.publication_control_worker_jobs enable row level security;
alter table ss.publication_control_worker_jobs force row level security;
alter table ss.publication_control_execution_receipts
  enable row level security;
alter table ss.publication_control_execution_receipts
  force row level security;

revoke all on table
  ss.publication_control_releases,
  ss.publication_control_worker_jobs,
  ss.publication_control_execution_receipts
from public, anon, authenticated, service_role;
grant select, insert on table ss.publication_control_releases
to service_role;
grant select, insert, update on table
  ss.publication_control_worker_jobs
to service_role;
grant select, insert on table
  ss.publication_control_execution_receipts
to service_role;

revoke all on function
  ss.validate_publication_control_release(),
  ss.reject_publication_control_release_mutation(),
  ss.validate_publication_control_worker_job(),
  ss.guard_publication_control_worker_job(),
  ss.reject_publication_control_receipt_mutation()
from public, anon, authenticated;
grant execute on function
  ss.validate_publication_control_release(),
  ss.reject_publication_control_release_mutation(),
  ss.validate_publication_control_worker_job(),
  ss.guard_publication_control_worker_job(),
  ss.reject_publication_control_receipt_mutation()
to service_role;

create function ss.hosted_publication_control_contract_v2()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-publication-control-v2-released-leased'::text
$$;

revoke all on function ss.hosted_publication_control_contract_v2()
from public, anon, authenticated;
grant execute on function ss.hosted_publication_control_contract_v2()
to service_role;

commit;
