begin;

do $$
begin
  if to_regclass('ss.export_requests') is null
    or to_regprocedure('ss.hosted_runtime_contract_v14()') is null
  then
    raise exception
      'canonical export requests and runtime contract v14 must be installed first'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.export_requests
  add column attempt_number bigint not null default 1,
  add column fence_token bigint not null default 0,
  add column worker_id text,
  add column lease_started_at timestamptz,
  add column lease_expires_at timestamptz,
  add column object_attempt_number bigint,
  add column object_fence_token bigint,
  add column failure_code text,
  add column failure_facts jsonb,
  add column failed_at timestamptz;

-- A v14 process could have stopped after changing the row to `building` and
-- before or after writing its legacy object key. No lease or fence exists to
-- distinguish those cases. Preserve that bounded uncertainty as a failed row
-- requiring an explicit customer retry; never silently replay or bless it.
update ss.export_requests
set state = 'failed',
    attempt_number = 1,
    fence_token = 1,
    worker_id = null,
    lease_started_at = null,
    lease_expires_at = null,
    manifest_digest = null,
    object_key = null,
    byte_count = null,
    object_attempt_number = null,
    object_fence_token = null,
    completed_at = null,
    expires_at = null,
    failure_code = 'EXPORT_LEGACY_BUILD_ORPHANED',
    failure_facts = jsonb_build_object(
      'phase', 'migration',
      'certainty', 'ambiguous',
      'objectKey',
        'exports/' || organization_id::text || '/' ||
        project_id::text || '/' || id::text || '.zip',
      'recovery', 'manual_retry_required'
    ),
    failed_at = clock_timestamp()
where state = 'building';

update ss.export_requests
set fence_token = greatest(fence_token, 1),
    manifest_digest = case
      when manifest_digest is not null
        and object_key is not null
        and byte_count is not null
      then manifest_digest
      else null
    end,
    object_key = case
      when manifest_digest is not null
        and object_key is not null
        and byte_count is not null
      then object_key
      else null
    end,
    byte_count = case
      when manifest_digest is not null
        and object_key is not null
        and byte_count is not null
      then byte_count
      else null
    end,
    object_attempt_number = case
      when manifest_digest is not null
        and object_key is not null
        and byte_count is not null
      then 1
      else null
    end,
    object_fence_token = case
      when manifest_digest is not null
        and object_key is not null
        and byte_count is not null
      then 1
      else null
    end,
    completed_at = case
      when state in ('ready', 'expired')
      then completed_at
      else null
    end,
    expires_at = case
      when state in ('ready', 'expired')
      then expires_at
      else null
    end
where state in ('ready', 'expired', 'failed');

update ss.export_requests
set failure_code = 'EXPORT_LEGACY_FAILURE',
    failure_facts = jsonb_build_object(
      'phase', 'legacy',
      'certainty', 'ambiguous',
      'recovery', 'manual_retry_required'
    ),
    failed_at = coalesce(completed_at, requested_at)
where state = 'failed'
  and failure_code is null;

alter table ss.export_requests
  add constraint export_requests_attempt_positive
    check (
      attempt_number > 0
      and attempt_number <= 9007199254740991
    ),
  add constraint export_requests_fence_monotonic_shape
    check (
      fence_token >= 0
      and fence_token <= 9007199254740991
    ),
  add constraint export_requests_worker_id_bounded
    check (
      worker_id is null
      or (
        char_length(worker_id) between 1 and 200
        and worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      )
    ),
  add constraint export_requests_lease_pair
    check (
      (
        worker_id is null
        and lease_started_at is null
        and lease_expires_at is null
      )
      or (
        worker_id is not null
        and lease_started_at is not null
        and lease_expires_at > lease_started_at
        and lease_expires_at <=
          lease_started_at + interval '5 minutes'
      )
    ),
  add constraint export_requests_building_lease
    check (
      (state = 'building') =
      (
        worker_id is not null
        and lease_started_at is not null
        and lease_expires_at is not null
        and fence_token > 0
      )
    ),
  add constraint export_requests_object_fact_set
    check (
      num_nonnulls(
        manifest_digest,
        object_key,
        byte_count,
        object_attempt_number,
        object_fence_token
      ) in (0, 5)
    ),
  add constraint export_requests_object_fence_shape
    check (
      object_attempt_number is null
      or (
        object_attempt_number > 0
        and object_attempt_number <= attempt_number
        and object_fence_token > 0
        and object_fence_token <= fence_token
        and byte_count > 0
        and byte_count <= 20971520
        and char_length(object_key) between 1 and 1000
      )
    ),
  add constraint export_requests_failure_code_bounded
    check (
      failure_code is null
      or (
        char_length(failure_code) between 1 and 128
        and failure_code ~ '^[A-Z][A-Z0-9_]*$'
      )
    ),
  add constraint export_requests_failure_facts_bounded
    check (
      failure_facts is null
      or (
        jsonb_typeof(failure_facts) = 'object'
        and pg_column_size(failure_facts) <= 2048
        and failure_facts - array[
          'phase',
          'certainty',
          'causeCode',
          'objectKey',
          'recovery'
        ] = '{}'::jsonb
        and jsonb_typeof(failure_facts -> 'phase') = 'string'
        and char_length(failure_facts ->> 'phase') between 1 and 64
        and jsonb_typeof(failure_facts -> 'certainty') = 'string'
        and failure_facts ->> 'certainty' in (
          'not_written',
          'ambiguous',
          'confirmed_not_finalized'
        )
        and (
          not (failure_facts ? 'causeCode')
          or (
            jsonb_typeof(failure_facts -> 'causeCode') = 'string'
            and char_length(failure_facts ->> 'causeCode')
              between 1 and 128
          )
        )
        and (
          not (failure_facts ? 'objectKey')
          or (
            jsonb_typeof(failure_facts -> 'objectKey') = 'string'
            and char_length(failure_facts ->> 'objectKey')
              between 1 and 1000
          )
        )
        and (
          not (failure_facts ? 'recovery')
          or (
            jsonb_typeof(failure_facts -> 'recovery') = 'string'
            and char_length(failure_facts ->> 'recovery')
              between 1 and 64
          )
        )
      )
    ),
  add constraint export_requests_failed_facts
    check (
      num_nonnulls(
        failure_code,
        failure_facts,
        failed_at
      ) in (0, 3)
      and
      (state = 'failed') =
      (
        failure_code is not null
        and failure_facts is not null
        and failed_at is not null
      )
    ),
  add constraint export_requests_state_fact_shape
    check (
      (
        state = 'queued'
        and manifest_digest is null
        and object_key is null
        and byte_count is null
        and completed_at is null
        and expires_at is null
      )
      or (
        state = 'building'
        and completed_at is null
        and expires_at is null
      )
      or (
        state = 'failed'
        and completed_at is null
        and expires_at is null
      )
      or (
        state in ('ready', 'expired')
        and manifest_digest is not null
        and object_key is not null
        and byte_count is not null
        and object_attempt_number is not null
        and object_fence_token is not null
        and completed_at is not null
        and expires_at is not null
        and fence_token > 0
      )
    );

create index export_requests_worker_claim
  on ss.export_requests(
    state,
    lease_expires_at,
    requested_at,
    id
  )
  where state in ('queued', 'building');

create function ss.validate_export_request_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  old_object_facts jsonb;
  new_object_facts jsonb;
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.requested_by_user_id is distinct from old.requested_by_user_id
    or new.requested_at is distinct from old.requested_at
  then
    raise exception 'export request identity is immutable'
      using errcode = '55000';
  end if;

  if new.attempt_number < old.attempt_number
    or new.fence_token < old.fence_token
  then
    raise exception 'export attempt and fence are monotonic'
      using errcode = '55000';
  end if;

  old_object_facts := jsonb_build_object(
    'manifestDigest', old.manifest_digest,
    'objectKey', old.object_key,
    'byteCount', old.byte_count,
    'objectAttempt', old.object_attempt_number,
    'objectFence', old.object_fence_token
  );
  new_object_facts := jsonb_build_object(
    'manifestDigest', new.manifest_digest,
    'objectKey', new.object_key,
    'byteCount', new.byte_count,
    'objectAttempt', new.object_attempt_number,
    'objectFence', new.object_fence_token
  );

  if old.state = 'queued' and new.state = 'building' then
    if new.attempt_number <> old.attempt_number
      or new.fence_token <> old.fence_token + 1
      or old_object_facts <> new_object_facts
    then
      raise exception 'queued export claim is invalid'
        using errcode = '23514';
    end if;
  elsif old.state = 'building' and new.state = 'building' then
    if new.attempt_number <> old.attempt_number then
      raise exception 'building export attempt cannot change'
        using errcode = '23514';
    end if;

    if new.fence_token = old.fence_token + 1 then
      if old.lease_expires_at > new.lease_started_at
        or old_object_facts <> new_object_facts
      then
        raise exception 'active export lease cannot be stolen'
          using errcode = '55000';
      end if;
    elsif new.fence_token = old.fence_token then
      if new.worker_id is distinct from old.worker_id
        or new.lease_started_at is distinct from old.lease_started_at
        or new.lease_expires_at is distinct from old.lease_expires_at
        or (
          old.object_fence_token is not null
          and old.object_fence_token = old.fence_token
          and old_object_facts <> new_object_facts
        )
        or (
          old_object_facts <> new_object_facts
          and (
            new.object_attempt_number <> new.attempt_number
            or new.object_fence_token <> new.fence_token
          )
        )
      then
        raise exception 'prepared export object facts are immutable'
          using errcode = '55000';
      end if;
    else
      raise exception 'building export fence must advance by one'
        using errcode = '23514';
    end if;
  elsif old.state = 'building'
    and new.state in ('ready', 'failed', 'queued')
  then
    if new.attempt_number <> old.attempt_number
      or new.fence_token <> old.fence_token
      or (
        new.state = 'ready'
        and old_object_facts <> new_object_facts
      )
    then
      raise exception 'export completion lost its claim fence'
        using errcode = '55000';
    end if;
  elsif old.state in ('failed', 'expired')
    and new.state = 'queued'
  then
    if new.attempt_number <> old.attempt_number + 1
      or new.fence_token <> old.fence_token
    then
      raise exception 'manual export retry must create one new attempt'
        using errcode = '23514';
    end if;
  elsif old.state = 'ready' and new.state = 'expired' then
    if new.attempt_number <> old.attempt_number
      or new.fence_token <> old.fence_token
      or old_object_facts <> new_object_facts
    then
      raise exception 'export expiry cannot change object authority'
        using errcode = '55000';
    end if;
  else
    raise exception 'invalid export request transition'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger export_requests_safe_transition
before update on ss.export_requests
for each row execute function ss.validate_export_request_transition();

revoke all on function ss.validate_export_request_transition()
from public, anon, authenticated;

create function ss.hosted_runtime_contract_v15()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v15-export-worker-fencing'::text
$$;

revoke all on function ss.hosted_runtime_contract_v15()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v15()
to authenticated, service_role;

commit;
