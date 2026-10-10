begin;

-- Preserve deletion-job provenance before terminal purge removes the source
-- artifact/export records. Unknown or mixed providers require their own adapter;
-- they must never be passed to the private export filesystem by object key alone.
create function ss.classify_project_deletion_object_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  target_object_key text := new.payload ->> 'objectKey';
  has_replica boolean;
  has_export boolean;
  replica_providers text[];
begin
  select coalesce(array_agg(distinct replica.provider_code order by replica.provider_code), '{}'::text[])
    from ss.artifact_replicas replica
    join ss.artifacts artifact on artifact.id = replica.artifact_id
    where artifact.organization_id = new.organization_id
      and artifact.project_id = new.project_id
      and replica.object_key = target_object_key and replica.deleted_at is null
    into replica_providers;
  has_replica := cardinality(replica_providers) > 0;
  select exists (
    select 1 from ss.export_requests export
    where export.organization_id = new.organization_id
      and export.project_id = new.project_id and export.object_key = target_object_key
  ) into has_export;
  new.payload := new.payload || jsonb_build_object(
    'storageOrigins', jsonb_build_object('artifactProviders', replica_providers, 'privateExport', has_export),
    'storageKind',
    case when has_export and not has_replica and
      starts_with(target_object_key, 'exports/' || new.organization_id || '/' || new.project_id || '/')
      then 'private_export' else 'unsupported' end);
  new.dedupe_key := 'delete-blob:' || new.organization_id || ':' || new.project_id || ':' ||
    encode(extensions.digest(convert_to(target_object_key, 'utf8'), 'sha256'), 'hex');
  return new;
end
$$;

create trigger lifecycle_jobs_classify_deletion_object
before insert on ss.lifecycle_jobs
for each row when (new.job_type = 'delete_blob')
execute function ss.classify_project_deletion_object_v1();

-- Reuse the existing digest-only lifecycle receipt. The worker inserts it only
-- after exact project/request-bound filesystem erasure, in the transaction that
-- finalizes deletion. Direct SQL finalization without a current receipt fails.
create function ss.require_publication_erasure_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if exists (
    select 1 from ss.lifecycle_jobs job
    where job.organization_id = new.organization_id and job.project_id = new.id
      and job.job_type in ('unpublish_project', 'delete_blob')
      and job.state <> 'succeeded'
  ) then
    raise exception 'publication or object deletion is incomplete' using errcode = '55000';
  end if;
  if not exists (
    select 1 from ss.lifecycle_jobs job
    join ss.project_lifecycle_job_receipts receipt
      on receipt.lifecycle_job_id = job.id
      and receipt.organization_id = job.organization_id
      and receipt.project_id = job.project_id
      and receipt.lease_fence = job.lease_fence
      and receipt.receipt_kind = 'project_deleted'
    join ss.deletion_requests request
      on request.organization_id = job.organization_id
      and request.project_id = job.project_id
      and request.id::text = job.payload ->> 'deletionRequestId'
      and request.state = 'purging'
    where job.organization_id = new.organization_id and job.project_id = new.id
      and job.job_type = 'finalize_deletion' and job.state = 'running'
      and job.lease_fence > 0 and job.lease_expires_at > clock_timestamp()
  ) then
    raise exception 'exact terminal publication erasure receipt is required' using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger projects_require_publication_erasure
before update of lifecycle on ss.projects
for each row when (new.lifecycle = 'deleted' and old.lifecycle <> 'deleted')
execute function ss.require_publication_erasure_v1();

revoke all on function ss.classify_project_deletion_object_v1(),
  ss.require_publication_erasure_v1() from public, anon, authenticated, service_role;

commit;
