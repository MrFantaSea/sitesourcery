begin;

alter table ss.deletion_requests
  add column accepted_term_ids uuid[],
  add column billing_timestamps jsonb,
  add column address_disposition text,
  add column retained_customer_domains text[],
  add column removal_counts jsonb;

create table ss.project_retained_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  kind text not null,
  actor_kind text not null,
  actor_id text,
  occurred_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id)
);

create trigger project_retained_events_no_update
before update on ss.project_retained_events
for each row execute function ss.reject_update();

create function ss.write_audit_event(
  target_organization_id uuid,
  target_project_id uuid,
  event_actor_kind text,
  event_actor_id text,
  event_action text,
  event_target_type text,
  event_target_id text,
  event_request_id uuid,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss, extensions
as $$
declare
  prior_hash ss.sha256_hex;
  next_hash ss.sha256_hex;
  next_id uuid := extensions.gen_random_uuid();
  event_time timestamptz := clock_timestamp();
begin
  if event_actor_kind not in ('user', 'operator', 'system', 'provider') then
    raise exception 'invalid audit actor kind' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(event_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'audit metadata must be an object' using errcode = '22023';
  end if;

  select audit.event_hash
  into prior_hash
  from ss.audit_events audit
  where audit.organization_id is not distinct from target_organization_id
  order by audit.occurred_at desc, audit.id desc
  limit 1;

  next_hash := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          '|',
          coalesce(prior_hash::text, ''),
          next_id::text,
          coalesce(target_organization_id::text, ''),
          coalesce(target_project_id::text, ''),
          event_actor_kind,
          coalesce(event_actor_id, ''),
          event_action,
          event_target_type,
          event_target_id,
          coalesce(event_request_id::text, ''),
          coalesce(event_metadata, '{}'::jsonb)::text,
          event_time::text
        ),
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into ss.audit_events (
    id,
    organization_id,
    project_id,
    actor_kind,
    actor_id,
    action,
    target_type,
    target_id,
    request_id,
    metadata,
    previous_hash,
    event_hash,
    occurred_at
  ) values (
    next_id,
    target_organization_id,
    target_project_id,
    event_actor_kind,
    event_actor_id,
    event_action,
    event_target_type,
    event_target_id,
    event_request_id,
    coalesce(event_metadata, '{}'::jsonb),
    prior_hash,
    next_hash,
    event_time
  );

  return next_id;
end
$$;

revoke all on function ss.write_audit_event(
  uuid, uuid, text, text, text, text, text, uuid, jsonb
) from public;

create function ss.validate_release_screening()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_digest ss.sha256_hex;
  expected_project_id uuid;
begin
  select artifact.artifact_digest, version.project_id
  into expected_digest, expected_project_id
  from ss.site_versions version
  join ss.artifacts artifact
    on artifact.organization_id = version.organization_id
   and artifact.id = version.artifact_id
  where version.organization_id = new.organization_id
    and version.id = new.version_id;

  if not found
    or expected_project_id <> new.project_id
    or expected_digest <> new.artifact_digest
  then
    raise exception 'release screening does not match exact version artifact'
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger release_screenings_validate_artifact
before insert on ss.release_screenings
for each row execute function ss.validate_release_screening();

create function ss.transition_version(
  target_version_id uuid,
  next_state text,
  target_screening_id uuid default null,
  target_attestation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  version_record record;
  current_state text;
  actor_id uuid := ss.current_user_id();
  event_id uuid;
  screening_ok boolean;
  attestation_ok boolean;
begin
  select version.organization_id, version.project_id
  into version_record
  from ss.site_versions version
  where version.id = target_version_id;

  if not found or not ss.can_access_org(version_record.organization_id) then
    raise exception 'version not found' using errcode = 'P0002';
  end if;

  if not ss.has_org_role(
    version_record.organization_id,
    array['owner', 'admin', 'editor']
  ) then
    raise exception 'version transition is not authorized' using errcode = '42501';
  end if;

  select projection.state
  into current_state
  from ss.version_state_projection projection
  where projection.version_id = target_version_id
  for update;

  if next_state = 'draft' and current_state is null then
    null;
  elsif next_state = 'ready' and current_state = 'draft' then
    null;
  elsif next_state = 'accepted_release' and current_state = 'ready' then
    select exists (
      select 1
      from ss.release_screenings screening
      where screening.id = target_screening_id
        and screening.organization_id = version_record.organization_id
        and screening.project_id = version_record.project_id
        and screening.version_id = target_version_id
        and screening.stage = 'pre_acceptance'
        and screening.passed
    ) into screening_ok;

    select exists (
      select 1
      from ss.version_attestations attestation
      where attestation.id = target_attestation_id
        and attestation.organization_id = version_record.organization_id
        and attestation.project_id = version_record.project_id
        and attestation.version_id = target_version_id
        and attestation.user_id = actor_id
    ) into attestation_ok;

    if not screening_ok or not attestation_ok then
      raise exception 'accepted release requires exact passed screening and user attestation'
        using errcode = '23514';
    end if;
  elsif next_state = 'rejected' and current_state in ('draft', 'ready') then
    null;
  else
    raise exception 'invalid version state transition from % to %',
      coalesce(current_state, '<none>'),
      next_state
      using errcode = '23514';
  end if;

  event_id := extensions.gen_random_uuid();

  insert into ss.version_state_events (
    id,
    organization_id,
    project_id,
    version_id,
    state,
    screening_id,
    attestation_id,
    actor_user_id
  ) values (
    event_id,
    version_record.organization_id,
    version_record.project_id,
    target_version_id,
    next_state,
    target_screening_id,
    target_attestation_id,
    actor_id
  );

  insert into ss.version_state_projection (
    organization_id,
    project_id,
    version_id,
    state,
    last_event_id,
    updated_at
  ) values (
    version_record.organization_id,
    version_record.project_id,
    target_version_id,
    next_state,
    event_id,
    clock_timestamp()
  )
  on conflict (version_id) do update
  set state = excluded.state,
      last_event_id = excluded.last_event_id,
      updated_at = excluded.updated_at;

  perform ss.write_audit_event(
    version_record.organization_id,
    version_record.project_id,
    'user',
    actor_id::text,
    'version.' || next_state,
    'site_version',
    target_version_id::text,
    null,
    jsonb_build_object('state', next_state)
  );

  return event_id;
end
$$;

revoke all on function ss.transition_version(uuid, text, uuid, uuid) from public;

create function ss.request_release(
  target_project_id uuid,
  target_version_id uuid,
  target_screening_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  project_record record;
  address_record record;
  actor_id uuid := ss.current_user_id();
  request_id uuid := extensions.gen_random_uuid();
begin
  select project.organization_id, project.lifecycle
  into project_record
  from ss.projects project
  where project.id = target_project_id
  for update;

  if not found or not ss.can_access_org(project_record.organization_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not ss.has_org_role(
    project_record.organization_id,
    array['owner', 'admin', 'editor']
  ) then
    raise exception 'release is not authorized' using errcode = '42501';
  end if;

  if project_record.lifecycle <> 'active' then
    raise exception 'project is not active' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.project_safety_projection safety
    where safety.project_id = target_project_id
      and safety.state = 'clear'
  ) then
    raise exception 'project is under safety hold' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.stripe_subscriptions subscription
    where subscription.project_id = target_project_id
      and subscription.status in ('active', 'grace')
  ) then
    raise exception 'verified serving subscription is required' using errcode = '23514';
  end if;

  select address.*
  into address_record
  from ss.project_address_projection projection
  join ss.project_addresses address
    on address.organization_id = projection.organization_id
   and address.id = projection.current_address_id
  where projection.project_id = target_project_id
    and address.state = 'configured'
    and address.serving_hostname is not null;

  if not found then
    raise exception 'configured address is required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.version_state_projection state
    where state.version_id = target_version_id
      and state.project_id = target_project_id
      and state.state = 'accepted_release'
  ) then
    raise exception 'exact selected version is not an accepted release'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.release_screenings screening
    where screening.id = target_screening_id
      and screening.project_id = target_project_id
      and screening.version_id = target_version_id
      and screening.stage = 'pre_publication'
      and screening.passed
  ) then
    raise exception 'exact pre-publication screening is required'
      using errcode = '23514';
  end if;

  insert into ss.release_requests (
    id,
    organization_id,
    project_id,
    version_id,
    address_id,
    requested_by_user_id,
    prepublication_screening_id
  ) values (
    request_id,
    project_record.organization_id,
    target_project_id,
    target_version_id,
    address_record.id,
    actor_id,
    target_screening_id
  );

  insert into ss.release_events (
    organization_id,
    project_id,
    release_request_id,
    state
  ) values (
    project_record.organization_id,
    target_project_id,
    request_id,
    'queued'
  );

  insert into ss.project_serving_projection (
    organization_id,
    project_id,
    state,
    resume_state,
    updated_at
  ) values (
    project_record.organization_id,
    target_project_id,
    'deploying',
    'unpublished',
    clock_timestamp()
  )
  on conflict (project_id) do update
  set state = 'deploying',
      resume_state = case
        when ss.project_serving_projection.state = 'live' then 'live'
        else ss.project_serving_projection.resume_state
      end,
      updated_at = excluded.updated_at;

  insert into ss.transactional_outbox (
    organization_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    dedupe_key
  ) values (
    project_record.organization_id,
    'release_request',
    request_id,
    'release.deploy_requested',
    jsonb_build_object(
      'releaseRequestId', request_id,
      'projectId', target_project_id,
      'versionId', target_version_id
    ),
    'release.deploy:' || request_id::text
  );

  perform ss.write_audit_event(
    project_record.organization_id,
    target_project_id,
    'user',
    actor_id::text,
    'release.requested',
    'release_request',
    request_id::text,
    null,
    jsonb_build_object('versionId', target_version_id)
  );

  return request_id;
end
$$;

revoke all on function ss.request_release(uuid, uuid, uuid) from public;

create function ss.complete_release(
  target_release_request_id uuid,
  target_deployment_receipt_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  request_record record;
  receipt_record record;
  artifact_record record;
  release_id uuid := extensions.gen_random_uuid();
  old_release_id uuid;
begin
  select
    request.organization_id,
    request.project_id,
    request.version_id,
    request.address_id,
    address.serving_hostname
  into request_record
  from ss.release_requests request
  join ss.project_addresses address
    on address.organization_id = request.organization_id
   and address.id = request.address_id
  where request.id = target_release_request_id
  for update of request;

  if not found
    or request_record.serving_hostname is null
    or not exists (
      select 1
      from ss.projects project
      where project.id = request_record.project_id
        and project.lifecycle = 'active'
    )
  then
    raise exception 'release request is not deployable' using errcode = '23514';
  end if;

  select receipt.*
  into receipt_record
  from ss.provider_receipts receipt
  where receipt.id = target_deployment_receipt_id
    and receipt.organization_id = request_record.organization_id
    and receipt.project_id = request_record.project_id
    and receipt.receipt_kind = 'deployment_verified';

  if not found then
    raise exception 'verified deployment receipt is required' using errcode = '23514';
  end if;

  select artifact.id, artifact.artifact_digest
  into artifact_record
  from ss.site_versions version
  join ss.artifacts artifact
    on artifact.organization_id = version.organization_id
   and artifact.id = version.artifact_id
  where version.organization_id = request_record.organization_id
    and version.id = request_record.version_id;

  if not found
    or receipt_record.facts ->> 'projectId' <> request_record.project_id::text
    or receipt_record.facts ->> 'versionId' <> request_record.version_id::text
    or receipt_record.facts ->> 'artifactDigest' <> artifact_record.artifact_digest::text
    or receipt_record.facts ->> 'hostname' <> request_record.serving_hostname::text
  then
    raise exception 'deployment receipt does not match exact release tuple'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from ss.releases release
    where release.release_request_id = target_release_request_id
  ) then
    select release.id into release_id
    from ss.releases release
    where release.release_request_id = target_release_request_id;
    return release_id;
  end if;

  select serving.current_release_id
  into old_release_id
  from ss.project_serving_projection serving
  where serving.project_id = request_record.project_id
  for update;

  insert into ss.releases (
    id,
    organization_id,
    project_id,
    release_request_id,
    version_id,
    artifact_id,
    artifact_digest,
    hostname,
    deployment_receipt_id,
    released_at
  ) values (
    release_id,
    request_record.organization_id,
    request_record.project_id,
    target_release_request_id,
    request_record.version_id,
    artifact_record.id,
    artifact_record.artifact_digest,
    request_record.serving_hostname,
    target_deployment_receipt_id,
    clock_timestamp()
  );

  update ss.project_serving_projection
  set previous_release_id = old_release_id,
      current_release_id = release_id,
      state = 'live',
      resume_state = 'live',
      updated_at = clock_timestamp()
  where project_id = request_record.project_id;

  insert into ss.release_events (
    organization_id,
    project_id,
    release_request_id,
    state,
    provider_receipt_id
  ) values (
    request_record.organization_id,
    request_record.project_id,
    target_release_request_id,
    'released',
    target_deployment_receipt_id
  );

  insert into ss.serving_events (
    organization_id,
    project_id,
    release_id,
    event_kind,
    source_receipt_id
  ) values (
    request_record.organization_id,
    request_record.project_id,
    release_id,
    'published',
    target_deployment_receipt_id
  );

  update ss.viewer_sessions
  set revoked_at = clock_timestamp()
  where project_id = request_record.project_id
    and revoked_at is null;

  perform ss.write_audit_event(
    request_record.organization_id,
    request_record.project_id,
    'provider',
    receipt_record.provider_code,
    'release.published',
    'release',
    release_id::text,
    null,
    jsonb_build_object(
      'versionId', request_record.version_id,
      'artifactDigest', artifact_record.artifact_digest
    )
  );

  return release_id;
end
$$;

revoke all on function ss.complete_release(uuid, uuid) from public;

create function ss.acknowledge_private_lifecycle(
  presented_token_digest ss.sha256_hex,
  expected_project_id uuid,
  expected_version_id uuid,
  expected_artifact_digest ss.sha256_hex,
  expected_hostname ss.canonical_hostname,
  expected_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if expected_visibility <> 'private' or not exists (
    select 1
    from ss.viewer_sessions viewer
    join ss.project_access_projection access
      on access.organization_id = viewer.organization_id
     and access.project_id = viewer.project_id
     and access.visibility = 'private'
     and access.current_credential_id = viewer.credential_id
    join ss.project_access_credentials credential
      on credential.organization_id = viewer.organization_id
     and credential.id = viewer.credential_id
     and credential.revoked_at is null
     and credential.credential_fingerprint = viewer.credential_fingerprint
    join ss.project_serving_projection serving
      on serving.organization_id = viewer.organization_id
     and serving.project_id = viewer.project_id
     and serving.state = 'live'
     and serving.current_release_id = viewer.release_id
    join ss.releases release
      on release.organization_id = viewer.organization_id
     and release.id = viewer.release_id
     and release.version_id = viewer.version_id
     and release.artifact_digest = viewer.artifact_digest
     and release.hostname = viewer.hostname
    join ss.projects project
      on project.organization_id = viewer.organization_id
     and project.id = viewer.project_id
     and project.lifecycle = 'active'
    join ss.project_safety_projection safety
      on safety.organization_id = viewer.organization_id
     and safety.project_id = viewer.project_id
     and safety.state = 'clear'
    join ss.stripe_subscriptions subscription
      on subscription.organization_id = viewer.organization_id
     and subscription.project_id = viewer.project_id
     and subscription.status in ('active', 'grace')
    where viewer.token_digest = presented_token_digest
      and viewer.revoked_at is null
      and viewer.expires_at > clock_timestamp()
      and viewer.project_id = expected_project_id
      and viewer.version_id = expected_version_id
      and viewer.artifact_digest = expected_artifact_digest
      and viewer.hostname = expected_hostname
      and viewer.visibility = expected_visibility
  ) then
    raise exception 'private lifecycle not acknowledged' using errcode = '42501';
  end if;

  return jsonb_build_object('acknowledged', true);
end
$$;

revoke all on function ss.acknowledge_private_lifecycle(
  ss.sha256_hex, uuid, uuid, ss.sha256_hex, ss.canonical_hostname, text
) from public;

create function ss.cancel_project(target_project_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  project_record record;
  actor_id uuid := ss.current_user_id();
  cancellation_time timestamptz := clock_timestamp();
  proposed_retention_end timestamptz;
  final_retention_end timestamptz;
begin
  select
    project.organization_id,
    project.lifecycle,
    project.cancelled_at,
    project.retention_ends_at,
    policy.retention_period
  into project_record
  from ss.projects project
  join ss.billing_policies policy on policy.id = project.billing_policy_id
  where project.id = target_project_id
  for update of project;

  if not found or not ss.can_access_org(project_record.organization_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not ss.has_org_role(
    project_record.organization_id,
    array['owner', 'admin', 'billing']
  ) then
    raise exception 'cancellation is not authorized' using errcode = '42501';
  end if;

  if project_record.lifecycle in ('deleting', 'deleted') then
    raise exception 'project is already deleting or deleted' using errcode = '23514';
  end if;

  proposed_retention_end := cancellation_time + project_record.retention_period;
  final_retention_end := case
    when project_record.retention_ends_at is null then proposed_retention_end
    else least(project_record.retention_ends_at, proposed_retention_end)
  end;

  update ss.projects
  set lifecycle = 'cancelled',
      cancelled_at = coalesce(cancelled_at, cancellation_time),
      retention_ends_at = final_retention_end,
      revision = revision + 1
  where id = target_project_id;

  update ss.project_serving_projection
  set resume_state = case when state = 'live' then 'live' else resume_state end,
      state = 'dark',
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  update ss.viewer_sessions
  set revoked_at = clock_timestamp()
  where project_id = target_project_id
    and revoked_at is null;

  insert into ss.lifecycle_jobs (
    organization_id,
    project_id,
    job_type,
    dedupe_key,
    run_at,
    payload
  ) values (
    project_record.organization_id,
    target_project_id,
    'retention_expiry',
    'retention-expiry:' || target_project_id::text,
    final_retention_end,
    jsonb_build_object('projectId', target_project_id)
  )
  on conflict (dedupe_key) do update
  set run_at = least(ss.lifecycle_jobs.run_at, excluded.run_at),
      state = case
        when ss.lifecycle_jobs.state = 'succeeded' then ss.lifecycle_jobs.state
        else 'scheduled'
      end;

  perform ss.write_audit_event(
    project_record.organization_id,
    target_project_id,
    'user',
    actor_id::text,
    'project.cancelled',
    'project',
    target_project_id::text,
    null,
    jsonb_build_object('retentionEndsAt', final_retention_end)
  );

  return final_retention_end;
end
$$;

revoke all on function ss.cancel_project(uuid) from public;

create function ss.begin_terminal_project_purge(
  target_project_id uuid,
  target_policy_version text,
  requested_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss, extensions
as $$
declare
  project_record record;
  existing_request ss.deletion_requests%rowtype;
  deletion_id uuid := extensions.gen_random_uuid();
  terms_snapshot uuid[];
  billing_snapshot jsonb;
  domain_snapshot text[];
  disposition text;
  counts jsonb;
  object_record record;
  safety_record record;
begin
  select project.*
  into project_record
  from ss.projects project
  where project.id = target_project_id
  for update;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  select request.*
  into existing_request
  from ss.deletion_requests request
  where request.project_id = target_project_id;

  if found and existing_request.state <> 'failed' then
    return existing_request.id;
  end if;

  if project_record.lifecycle = 'deleted' then
    raise exception 'deleted project is missing its sealed deletion request'
      using errcode = '55000';
  end if;

  select coalesce(array_agg(required.acceptance_id order by required.kind), '{}'::uuid[])
  into terms_snapshot
  from ss.project_required_terms required
  where required.project_id = target_project_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subscriptionId', subscription.id,
        'status', subscription.status,
        'firstFailedAt', subscription.first_failed_at,
        'graceEndsAt', subscription.grace_ends_at,
        'suspendedAt', subscription.suspended_at,
        'retentionEndsAt', subscription.retention_ends_at,
        'cancelledAt', subscription.cancelled_at
      )
      order by subscription.created_at
    ),
    '[]'::jsonb
  )
  into billing_snapshot
  from ss.stripe_subscriptions subscription
  where subscription.project_id = target_project_id;

  select coalesce(
    array_agg(address.retained_domain::text order by address.allocated_at)
      filter (where address.ownership = 'customer' and address.retained_domain is not null),
    '{}'::text[]
  )
  into domain_snapshot
  from ss.project_addresses address
  where address.project_id = target_project_id;

  disposition := case
    when cardinality(domain_snapshot) > 0 then 'customer_domain_retained_detached'
    when exists (
      select 1 from ss.project_addresses address
      where address.project_id = target_project_id
        and address.ownership = 'licensed'
    ) then 'licensed_address_released'
    else 'no_address'
  end;

  counts := jsonb_build_object(
    'projectName', (project_record.name is not null)::integer,
    'draft', (select count(*) from ss.project_drafts where project_id = target_project_id),
    'factSets', (select count(*) from ss.fact_sets where project_id = target_project_id),
    'versions', (select count(*) from ss.site_versions where project_id = target_project_id),
    'artifacts', (select count(*) from ss.artifacts where project_id = target_project_id),
    'screeningAttempts', (select count(*) from ss.release_screenings where project_id = target_project_id),
    'attestations', (select count(*) from ss.version_attestations where project_id = target_project_id),
    'releaseRequests', (select count(*) from ss.release_requests where project_id = target_project_id),
    'releases', (select count(*) from ss.releases where project_id = target_project_id),
    'accessCredentials', (select count(*) from ss.project_access_credentials where project_id = target_project_id),
    'domainProofRecords', (
      (select count(*) from ss.domain_verification_requests where project_id = target_project_id)
      + (select count(*) from ss.domain_verification_attempts where project_id = target_project_id)
    ),
    'supportTickets', (select count(*) from ss.support_tickets where project_id = target_project_id),
    'supportMessages', (select count(*) from ss.support_messages where project_id = target_project_id),
    'exports', (select count(*) from ss.export_requests where project_id = target_project_id),
    'safetyNarratives', (
      select count(*) from ss.safety_events
      where project_id = target_project_id and narrative is not null
    )
  );

  if existing_request.id is null then
    insert into ss.deletion_requests (
      id,
      organization_id,
      project_id,
      requested_by_user_id,
      policy_version,
      state,
      sealed_at,
      accepted_term_ids,
      billing_timestamps,
      address_disposition,
      retained_customer_domains,
      removal_counts
    ) values (
      deletion_id,
      project_record.organization_id,
      target_project_id,
      requested_by,
      target_policy_version,
      'purging',
      clock_timestamp(),
      terms_snapshot,
      billing_snapshot,
      disposition,
      domain_snapshot,
      counts
    );
  else
    deletion_id := existing_request.id;
    update ss.deletion_requests
    set policy_version = target_policy_version,
        state = 'purging',
        failure_code = null,
        sealed_at = clock_timestamp(),
        accepted_term_ids = terms_snapshot,
        billing_timestamps = billing_snapshot,
        address_disposition = disposition,
        retained_customer_domains = domain_snapshot,
        removal_counts = counts
    where id = deletion_id;
  end if;

  delete from ss.lifecycle_jobs
  where project_id = target_project_id;

  for object_record in
    select replica.object_key
    from ss.artifact_replicas replica
    join ss.artifacts artifact on artifact.id = replica.artifact_id
    where artifact.project_id = target_project_id
      and replica.deleted_at is null
    union
    select export.object_key
    from ss.export_requests export
    where export.project_id = target_project_id
      and export.object_key is not null
  loop
    insert into ss.lifecycle_jobs (
      organization_id,
      project_id,
      job_type,
      dedupe_key,
      run_at,
      payload
    ) values (
      project_record.organization_id,
      target_project_id,
      'delete_blob',
      'delete-blob:' || encode(
        extensions.digest(convert_to(object_record.object_key, 'utf8'), 'sha256'),
        'hex'
      ),
      clock_timestamp(),
      jsonb_build_object('objectKey', object_record.object_key)
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  for safety_record in
    select event.kind, event.actor_kind, event.actor_id, event.occurred_at
    from ss.safety_events event
    where event.project_id = target_project_id
    order by event.occurred_at, event.id
  loop
    insert into ss.project_retained_events (
      organization_id,
      project_id,
      kind,
      actor_kind,
      actor_id,
      occurred_at
    ) values (
      project_record.organization_id,
      target_project_id,
      safety_record.kind,
      safety_record.actor_kind,
      safety_record.actor_id,
      safety_record.occurred_at
    );
  end loop;

  update ss.project_serving_projection
  set state = 'dark',
      current_release_id = null,
      previous_release_id = null,
      resume_state = 'unpublished',
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  update ss.project_access_projection
  set visibility = 'closed',
      current_credential_id = null,
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  update ss.project_address_projection
  set current_address_id = null,
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  update ss.project_safety_projection
  set state = 'closed',
      previous_serving_state = null,
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  delete from ss.viewer_sessions where project_id = target_project_id;
  delete from ss.support_messages where project_id = target_project_id;
  delete from ss.support_tickets where project_id = target_project_id;
  delete from ss.domain_verification_attempts where project_id = target_project_id;
  delete from ss.domain_verification_requests where project_id = target_project_id;
  delete from ss.serving_events where project_id = target_project_id;
  delete from ss.release_events where project_id = target_project_id;
  delete from ss.releases where project_id = target_project_id;
  delete from ss.release_requests where project_id = target_project_id;
  delete from ss.version_state_projection where project_id = target_project_id;
  delete from ss.version_state_events where project_id = target_project_id;
  delete from ss.version_attestations where project_id = target_project_id;
  delete from ss.release_screenings where project_id = target_project_id;
  delete from ss.site_versions where project_id = target_project_id;
  delete from ss.artifact_replicas replica
    using ss.artifacts artifact
    where replica.artifact_id = artifact.id
      and artifact.project_id = target_project_id;
  delete from ss.artifacts where project_id = target_project_id;
  delete from ss.fact_offerings offering
    using ss.fact_sets fact
    where offering.fact_set_id = fact.id
      and fact.project_id = target_project_id;
  delete from ss.fact_sets where project_id = target_project_id;
  delete from ss.project_drafts where project_id = target_project_id;
  delete from ss.project_access_credentials where project_id = target_project_id;
  delete from ss.safety_events where project_id = target_project_id;
  delete from ss.export_requests where project_id = target_project_id;
  delete from ss.checkout_intents where project_id = target_project_id;
  delete from ss.transactional_outbox
    where aggregate_id = target_project_id
       or payload ->> 'projectId' = target_project_id::text;

  update ss.project_addresses
  set serving_hostname = null,
      label = case when ownership = 'licensed' then null else label end,
      state = case when ownership = 'licensed' then 'released' else 'detached' end,
      configured_at = null,
      detached_at = case when ownership = 'customer' then clock_timestamp() else detached_at end,
      released_at = case when ownership = 'licensed' then clock_timestamp() else released_at end
  where project_id = target_project_id;

  update ss.stripe_subscriptions
  set status = 'deleted',
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  update ss.projects
  set lifecycle = 'deleting',
      name = null,
      deletion_started_at = coalesce(deletion_started_at, clock_timestamp()),
      revision = revision + 1
  where id = target_project_id;

  insert into ss.lifecycle_jobs (
    organization_id,
    project_id,
    job_type,
    dedupe_key,
    run_at,
    payload
  ) values (
    project_record.organization_id,
    target_project_id,
    'finalize_deletion',
    'finalize-deletion:' || target_project_id::text,
    clock_timestamp(),
    jsonb_build_object('projectId', target_project_id, 'deletionRequestId', deletion_id)
  )
  on conflict (dedupe_key) do nothing;

  perform ss.write_audit_event(
    project_record.organization_id,
    target_project_id,
    'system',
    'terminal-purge',
    'project.deletion_sealed',
    'project',
    target_project_id::text,
    null,
    jsonb_build_object(
      'policyVersion', target_policy_version,
      'addressDisposition', disposition,
      'removalCounts', counts
    )
  );

  return deletion_id;
end
$$;

revoke all on function ss.begin_terminal_project_purge(uuid, text, uuid) from public;

create function ss.finalize_terminal_project_purge(target_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  project_record record;
  deletion_record ss.deletion_requests%rowtype;
  tombstone_id uuid;
begin
  select project.*
  into project_record
  from ss.projects project
  where project.id = target_project_id
  for update;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if project_record.lifecycle = 'deleted' then
    return target_project_id;
  end if;

  if project_record.lifecycle <> 'deleting' then
    raise exception 'project has not been sealed for deletion' using errcode = '23514';
  end if;

  select request.*
  into deletion_record
  from ss.deletion_requests request
  where request.project_id = target_project_id
  for update;

  if not found or deletion_record.state <> 'purging' then
    raise exception 'deletion request is not ready to finalize' using errcode = '23514';
  end if;

  if exists (
    select 1
    from ss.lifecycle_jobs job
    where job.project_id = target_project_id
      and job.job_type = 'delete_blob'
      and job.state <> 'succeeded'
  ) then
    raise exception 'external object deletion is incomplete' using errcode = '55000';
  end if;

  if exists (
    select 1 from ss.site_versions where project_id = target_project_id
    union all
    select 1 from ss.artifacts where project_id = target_project_id
    union all
    select 1 from ss.fact_sets where project_id = target_project_id
    union all
    select 1 from ss.project_drafts where project_id = target_project_id
    union all
    select 1 from ss.support_tickets where project_id = target_project_id
    union all
    select 1 from ss.domain_verification_requests where project_id = target_project_id
    union all
    select 1 from ss.project_access_credentials where project_id = target_project_id
  ) then
    raise exception 'customer content remains after terminal purge' using errcode = '55000';
  end if;

  update ss.project_serving_projection
  set state = 'deleted',
      current_release_id = null,
      previous_release_id = null,
      resume_state = 'unpublished',
      updated_at = clock_timestamp()
  where project_id = target_project_id;

  insert into ss.serving_events (
    organization_id,
    project_id,
    event_kind
  ) values (
    project_record.organization_id,
    target_project_id,
    'deleted'
  );

  update ss.projects
  set lifecycle = 'deleted',
      name = null,
      deleted_at = clock_timestamp(),
      revision = revision + 1
  where id = target_project_id;

  insert into ss.project_deletion_tombstones (
    project_id,
    organization_id,
    deletion_request_id,
    policy_version,
    deleted_at,
    accepted_term_ids,
    billing_policy_id,
    billing_timestamps,
    address_disposition,
    retained_customer_domains,
    removal_counts
  ) values (
    target_project_id,
    project_record.organization_id,
    deletion_record.id,
    deletion_record.policy_version,
    clock_timestamp(),
    coalesce(deletion_record.accepted_term_ids, '{}'::uuid[]),
    project_record.billing_policy_id,
    coalesce(deletion_record.billing_timestamps, '[]'::jsonb),
    deletion_record.address_disposition,
    coalesce(deletion_record.retained_customer_domains, '{}'::text[]),
    coalesce(deletion_record.removal_counts, '{}'::jsonb)
  )
  on conflict (project_id) do nothing;

  update ss.deletion_requests
  set state = 'completed',
      completed_at = clock_timestamp()
  where id = deletion_record.id;

  update ss.lifecycle_jobs
  set state = 'succeeded',
      completed_at = clock_timestamp()
  where project_id = target_project_id
    and job_type = 'finalize_deletion'
    and state <> 'succeeded';

  perform ss.write_audit_event(
    project_record.organization_id,
    target_project_id,
    'system',
    'terminal-purge',
    'project.deleted',
    'project',
    target_project_id::text,
    null,
    jsonb_build_object('policyVersion', deletion_record.policy_version)
  );

  tombstone_id := target_project_id;
  return tombstone_id;
end
$$;

revoke all on function ss.finalize_terminal_project_purge(uuid) from public;

commit;
