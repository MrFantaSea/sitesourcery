begin;

do $$
begin
  if to_regclass('ss.legal_documents') is null
    or to_regclass('ss.term_acceptances') is null
    or to_regclass('ss.project_required_terms') is null
    or to_regclass('ss.projects') is null
    or to_regclass('auth.users') is null
    or to_regprocedure('ss.hosted_runtime_contract_v21()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v47()') is null
    or to_regprocedure(
      'ss.service_custom_build_handoff_canonical_json(jsonb)'
    ) is null
    or to_regprocedure('ss.reject_update()') is null
    or to_regprocedure('ss.validate_project_term()') is null
    or to_regprocedure('ss.current_user_id()') is null
  then
    raise exception
      'Site Sourcery migrations through v47 must precede hosted joint legal V3'
      using errcode = '55000';
  end if;

  if ss.hosted_runtime_contract_v47() <>
      'canonical-ss-v47-custom-build-handoff'
  then
    raise exception
      'Site Sourcery v47 contract does not match hosted joint legal V3'
      using errcode = '55000';
  end if;
end
$$;

do $$
begin
  if (
    select count(*)
      from ss.legal_documents document
     where document.id = '00000000-0000-4000-8000-000000000022'
       and document.kind = 'privacy'
       and document.version = 'SS-HOSTED-PRIVACY-2026-07-30-V2'
       and document.content_digest =
         'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
       and document.content_uri =
         'https://sitesourcery.com/legal/privacy/'
       and document.effective_at =
         '2026-07-30T00:00:00Z'::timestamptz
       and document.retired_at is null
  ) <> 1 then
    raise exception
      'Hosted Privacy V2 authority does not match migration 21'
      using errcode = '55000';
  end if;
end
$$;

create temporary table hosted_joint_legal_v3_release_constants (
  version text,
  content_digest text,
  content_uri text,
  effective_at timestamptz,
  byte_count bigint,
  artifact_uri text,
  website_terms_version text,
  website_terms_content_digest text,
  website_terms_artifact_uri text,
  website_terms_byte_count bigint,
  authority_digest text
) on commit drop;

-- Exact owner-approved joint finalization receipt generated at the real
-- cutover UTC. Keep this tuple byte-for-byte aligned with the retained receipt,
-- hosted artifacts, runtime environment, and project authority digest.
insert into hosted_joint_legal_v3_release_constants (
  version,
  content_digest,
  content_uri,
  effective_at,
  byte_count,
  artifact_uri,
  website_terms_version,
  website_terms_content_digest,
  website_terms_artifact_uri,
  website_terms_byte_count,
  authority_digest
) values (
  'SS-HOSTED-PRIVACY-2026-08-09-V3',
  '5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967',
  'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/',
  '2026-08-09T15:25:59.000Z'::timestamptz,
  29610,
  'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V3/',
  'SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3',
  'b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602',
  'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3/',
  26171,
  'ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf'
);

do $$
declare
  release_record record;
begin
  select * into strict release_record
  from hosted_joint_legal_v3_release_constants;

  if release_record.version = 'SS-HOSTED-PRIVACY-V3-UNSEALED'
    or release_record.version is null
    or release_record.version !~
      '^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$'
    or release_record.content_digest is null
    or release_record.content_digest !~ '^[a-f0-9]{64}$'
    or release_record.content_uri is null
    or release_record.content_uri !~ '^https://[^[:space:]]+$'
    or release_record.effective_at is null
    or release_record.byte_count is null
    or release_record.byte_count <= 0
    or release_record.artifact_uri is null
    or release_record.artifact_uri !~ '^https://[^[:space:]]+$'
    or release_record.website_terms_version =
      'SS-HOSTED-WEBSITE-TERMS-V3-UNSEALED'
    or release_record.website_terms_version is null
    or release_record.website_terms_version !~
      '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$'
    or substring(release_record.website_terms_version from
      '([0-9]{4}-[0-9]{2}-[0-9]{2})-V3$') <>
      substring(release_record.version from
        '([0-9]{4}-[0-9]{2}-[0-9]{2})-V3$')
    or release_record.website_terms_content_digest is null
    or release_record.website_terms_content_digest !~ '^[a-f0-9]{64}$'
    or release_record.website_terms_artifact_uri is null
    or release_record.website_terms_artifact_uri !~ '^https://[^[:space:]]+$'
    or release_record.website_terms_byte_count is null
    or release_record.website_terms_byte_count <= 0
    or release_record.authority_digest is null
    or release_record.authority_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception
      'Hosted joint Privacy V3 and Website Terms V3 constants are invalid or unsealed'
      using errcode = '55000';
  end if;
end
$$;

create function ss.reject_delete_v48()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is immutable', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end
$$;

revoke all on function ss.reject_delete_v48()
from public, anon, authenticated, service_role;

create function ss.project_legal_json_digest(value jsonb)
returns ss.sha256_hex
language sql
immutable
strict
parallel safe
security definer
set search_path = pg_catalog, extensions, ss
as $$
  select encode(
    extensions.digest(
      convert_to(
        ss.service_custom_build_handoff_canonical_json(value),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )::ss.sha256_hex
$$;

revoke all on function ss.project_legal_json_digest(jsonb)
from public, anon, authenticated, service_role;
grant execute on function ss.project_legal_json_digest(jsonb)
to service_role;

create table ss.legal_document_artifacts (
  document_id uuid primary key references ss.legal_documents(id),
  artifact_uri text not null unique,
  artifact_sha256 ss.sha256_hex not null,
  byte_count bigint not null check (byte_count > 0),
  media_type text not null
    check (media_type = 'text/html; charset=utf-8'),
  created_at timestamptz not null default clock_timestamp()
);

create function ss.validate_legal_document_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  expected_digest ss.sha256_hex;
begin
  select document.content_digest
  into expected_digest
  from ss.legal_documents document
  where document.id = new.document_id;

  if not found or new.artifact_sha256 <> expected_digest then
    raise exception
      'Legal artifact digest must match its immutable legal document'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function ss.validate_legal_document_artifact()
from public, anon, authenticated, service_role;

create constraint trigger legal_document_artifact_matches_document
after insert or update on ss.legal_document_artifacts
deferrable initially deferred
for each row execute function ss.validate_legal_document_artifact();

create trigger legal_document_artifacts_no_update
before update on ss.legal_document_artifacts
for each row execute function ss.reject_update();

create trigger legal_document_artifacts_no_delete
before delete on ss.legal_document_artifacts
for each row execute function ss.reject_delete_v48();

alter table ss.legal_document_artifacts enable row level security;
alter table ss.legal_document_artifacts force row level security;

create policy legal_document_artifacts_authenticated_read
on ss.legal_document_artifacts
for select
to authenticated
using (ss.current_user_id() is not null);

revoke all on table ss.legal_document_artifacts
from public, anon, authenticated, service_role;

insert into ss.legal_documents (
  id,
  kind,
  version,
  content_digest,
  content_uri,
  effective_at
)
select
  '00000000-0000-4000-8000-000000000048'::uuid,
  'privacy',
  release.version,
  release.content_digest::ss.sha256_hex,
  release.content_uri,
  release.effective_at
from hosted_joint_legal_v3_release_constants release
union all
select
  '00000000-0000-4000-8000-000000000103'::uuid,
  'product',
  release.website_terms_version,
  release.website_terms_content_digest::ss.sha256_hex,
  'https://sitesourcery.com/legal/website-terms/#self-service',
  release.effective_at
from hosted_joint_legal_v3_release_constants release
union all
select
  '00000000-0000-4000-8000-000000000104'::uuid,
  'website',
  release.website_terms_version,
  release.website_terms_content_digest::ss.sha256_hex,
  'https://sitesourcery.com/legal/website-terms/',
  release.effective_at
from hosted_joint_legal_v3_release_constants release
on conflict (kind, version) do nothing;

do $$
declare
  release_record record;
begin
  select * into strict release_record
  from hosted_joint_legal_v3_release_constants;

  if (
    select count(*)
      from ss.legal_documents document
     where (
       document.id = '00000000-0000-4000-8000-000000000048'
       and document.kind = 'privacy'
       and document.version = release_record.version
       and document.content_digest = release_record.content_digest::ss.sha256_hex
       and document.content_uri = release_record.content_uri
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     ) or (
       document.id = '00000000-0000-4000-8000-000000000103'
       and document.kind = 'product'
       and document.version = release_record.website_terms_version
       and document.content_digest = release_record.website_terms_content_digest::ss.sha256_hex
       and document.content_uri = 'https://sitesourcery.com/legal/website-terms/#self-service'
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     ) or (
       document.id = '00000000-0000-4000-8000-000000000104'
       and document.kind = 'website'
       and document.version = release_record.website_terms_version
       and document.content_digest = release_record.website_terms_content_digest::ss.sha256_hex
       and document.content_uri = 'https://sitesourcery.com/legal/website-terms/'
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     )
  ) <> 3 then
    raise exception
      'Hosted joint legal V3 document postcondition failed'
      using errcode = '55000';
  end if;
end
$$;

insert into ss.legal_document_artifacts (
  document_id,
  artifact_uri,
  artifact_sha256,
  byte_count,
  media_type
) values (
  '00000000-0000-4000-8000-000000000022',
  'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/',
  'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b',
  19935,
  'text/html; charset=utf-8'
);

insert into ss.legal_document_artifacts (
  document_id,
  artifact_uri,
  artifact_sha256,
  byte_count,
  media_type
) values (
  '00000000-0000-4000-8000-000000000023',
  'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/',
  'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196',
  21380,
  'text/html; charset=utf-8'
);

insert into ss.legal_document_artifacts (
  document_id,
  artifact_uri,
  artifact_sha256,
  byte_count,
  media_type
)
select
  '00000000-0000-4000-8000-000000000048'::uuid,
  release.artifact_uri,
  release.content_digest::ss.sha256_hex,
  release.byte_count,
  'text/html; charset=utf-8'
from hosted_joint_legal_v3_release_constants release;

insert into ss.legal_document_artifacts (
  document_id,
  artifact_uri,
  artifact_sha256,
  byte_count,
  media_type
)
select
  '00000000-0000-4000-8000-000000000104'::uuid,
  release.website_terms_artifact_uri,
  release.website_terms_content_digest::ss.sha256_hex,
  release.website_terms_byte_count,
  'text/html; charset=utf-8'
from hosted_joint_legal_v3_release_constants release;

do $$
declare
  release_record record;
begin
  select * into strict release_record
  from hosted_joint_legal_v3_release_constants;

  if (
    select count(*)
      from ss.legal_document_artifacts artifact
     where (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000022'
       and artifact.artifact_uri =
         'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/'
       and artifact.artifact_sha256 =
         'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
       and artifact.byte_count = 19935
       and artifact.media_type = 'text/html; charset=utf-8'
     ) or (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000023'
       and artifact.artifact_uri =
         'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/'
       and artifact.artifact_sha256 =
         'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
       and artifact.byte_count = 21380
       and artifact.media_type = 'text/html; charset=utf-8'
     ) or (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000048'
       and artifact.artifact_uri = release_record.artifact_uri
       and artifact.artifact_sha256 =
         release_record.content_digest::ss.sha256_hex
       and artifact.byte_count = release_record.byte_count
       and artifact.media_type = 'text/html; charset=utf-8'
     ) or (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000104'
       and artifact.artifact_uri = release_record.website_terms_artifact_uri
       and artifact.artifact_sha256 =
         release_record.website_terms_content_digest::ss.sha256_hex
       and artifact.byte_count = release_record.website_terms_byte_count
       and artifact.media_type = 'text/html; charset=utf-8'
     )
  ) <> 4 then
    raise exception
      'Hosted joint legal artifact metadata postcondition failed'
      using errcode = '55000';
  end if;
end
$$;

create table ss.project_legal_acceptance_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  schema_version text not null
    check (schema_version = 'sitesourcery.project-legal-acceptance/v3'),
  acceptance_statement text not null
    check (
      acceptance_statement =
        'accepted_exact_project_terms_and_acknowledged_privacy'
    ),
  authority_digest ss.sha256_hex not null,
  user_agent_digest ss.sha256_hex,
  accepted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id),
  unique (project_id, request_id)
);

alter table ss.term_acceptances
add column legal_receipt_id uuid;

alter table ss.term_acceptances
add constraint term_acceptances_legal_receipt_fk
foreign key (organization_id, legal_receipt_id)
references ss.project_legal_acceptance_receipts(organization_id, id);

create function ss.validate_project_legal_acceptance_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  bundle_matches boolean;
  expected_authority_digest ss.sha256_hex;
  receipt_id uuid;
  receipt_organization_id uuid;
  receipt_record record;
begin
  if tg_relid = 'ss.project_legal_acceptance_receipts'::regclass then
    receipt_id := new.id;
    receipt_organization_id := new.organization_id;
  elsif tg_relid = 'ss.term_acceptances'::regclass then
    if new.legal_receipt_id is null then
      return new;
    end if;
    receipt_id := new.legal_receipt_id;
    receipt_organization_id := new.organization_id;
  else
    raise exception 'Unexpected project legal receipt validation relation'
      using errcode = '55000';
  end if;

  select receipt.*
  into receipt_record
  from ss.project_legal_acceptance_receipts receipt
  where receipt.id = receipt_id
    and receipt.organization_id = receipt_organization_id;

  if not found then
    raise exception 'Project legal receipt is missing or cross-organization'
      using errcode = '23514';
  end if;

  select
    count(*) = 3
    and count(*) filter (
      where document.id = '00000000-0000-4000-8000-000000000103'
        and document.kind = 'product'
        and document.version ~
          '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$'
    ) = 1
    and count(*) filter (
      where document.id = '00000000-0000-4000-8000-000000000048'
        and document.kind = 'privacy'
        and document.version <> 'SS-HOSTED-PRIVACY-V3-UNSEALED'
    ) = 1
    and count(*) filter (
      where document.id = '00000000-0000-4000-8000-000000000104'
        and document.kind = 'website'
        and document.version ~
          '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$'
    ) = 1
    and bool_and(
      acceptance.organization_id = receipt_record.organization_id
      and acceptance.project_id = receipt_record.project_id
      and acceptance.user_id = receipt_record.user_id
      and acceptance.request_id = receipt_record.request_id
      and acceptance.accepted_at = receipt_record.accepted_at
      and acceptance.legal_receipt_id = receipt_record.id
    )
  into bundle_matches
  from ss.term_acceptances acceptance
  join ss.legal_documents document on document.id = acceptance.document_id
  where acceptance.legal_receipt_id = receipt_record.id;

  select ss.project_legal_json_digest(jsonb_build_object(
    'documents', jsonb_build_array(
      jsonb_build_object(
        'kind', privacy.kind,
        'version', privacy.version,
        'contentDigest', privacy.content_digest,
        'contentUri', privacy.content_uri,
        'effectiveAt', to_char(
          privacy.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      jsonb_build_object(
        'kind', product.kind,
        'version', product.version,
        'contentDigest', product.content_digest,
        'contentUri', product.content_uri,
        'effectiveAt', to_char(
          product.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      jsonb_build_object(
        'kind', website.kind,
        'version', website.version,
        'contentDigest', website.content_digest,
        'contentUri', website.content_uri,
        'effectiveAt', to_char(
          website.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    ),
    'schema', 'sitesourcery.project-legal-authority/v3'
  ))
  into expected_authority_digest
  from ss.legal_documents privacy
  cross join ss.legal_documents product
  cross join ss.legal_documents website
  where privacy.id = '00000000-0000-4000-8000-000000000048'
    and product.id = '00000000-0000-4000-8000-000000000103'
    and website.id = '00000000-0000-4000-8000-000000000104';

  if bundle_matches is not true
    or expected_authority_digest is null
    or receipt_record.authority_digest <> expected_authority_digest
  then
    raise exception
      'Project legal receipt must bind the exact reviewed three-document bundle'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function ss.validate_project_legal_acceptance_receipt()
from public, anon, authenticated, service_role;

create constraint trigger project_legal_receipt_exact_bundle
after insert or update on ss.project_legal_acceptance_receipts
deferrable initially deferred
for each row execute function
  ss.validate_project_legal_acceptance_receipt();

create constraint trigger term_acceptance_legal_receipt_exact_bundle
after insert on ss.term_acceptances
deferrable initially deferred
for each row execute function
  ss.validate_project_legal_acceptance_receipt();

create trigger project_legal_receipts_no_update
before update on ss.project_legal_acceptance_receipts
for each row execute function ss.reject_update();

create trigger project_legal_receipts_no_delete
before delete on ss.project_legal_acceptance_receipts
for each row execute function ss.reject_delete_v48();

create trigger term_acceptances_no_update_v48
before update on ss.term_acceptances
for each row execute function ss.reject_update();

create trigger term_acceptances_no_delete_v48
before delete on ss.term_acceptances
for each row execute function ss.reject_delete_v48();

create trigger legal_documents_no_delete_v48
before delete on ss.legal_documents
for each row execute function ss.reject_delete_v48();

create function ss.validate_project_required_term_monotonicity()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  old_acceptance record;
  new_acceptance record;
begin
  if to_jsonb(new) - 'acceptance_id' is distinct from
      to_jsonb(old) - 'acceptance_id'
    or new.acceptance_id is not distinct from old.acceptance_id
  then
    raise exception
      'Project required terms may update only to a new acceptance'
      using errcode = '23514';
  end if;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.accepted_at,
    document.kind,
    document.effective_at
  into old_acceptance
  from ss.term_acceptances acceptance
  join ss.legal_documents document on document.id = acceptance.document_id
  where acceptance.id = old.acceptance_id;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.accepted_at,
    document.kind,
    document.effective_at
  into new_acceptance
  from ss.term_acceptances acceptance
  join ss.legal_documents document on document.id = acceptance.document_id
  where acceptance.id = new.acceptance_id;

  if old_acceptance.organization_id is null
    or new_acceptance.organization_id is null
    or old_acceptance.organization_id <> new.organization_id
    or new_acceptance.organization_id <> new.organization_id
    or old_acceptance.project_id <> new.project_id
    or new_acceptance.project_id <> new.project_id
    or old_acceptance.kind <> new.kind
    or new_acceptance.kind <> new.kind
    or new_acceptance.accepted_at < old_acceptance.accepted_at
    or new_acceptance.effective_at < old_acceptance.effective_at
  then
    raise exception
      'Project required terms cannot move to older or unrelated authority'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function ss.validate_project_required_term_monotonicity()
from public, anon, authenticated, service_role;

create trigger project_required_terms_no_delete_v48
before delete on ss.project_required_terms
for each row execute function ss.reject_delete_v48();

create trigger project_required_terms_monotonic_v48
before update on ss.project_required_terms
for each row execute function
  ss.validate_project_required_term_monotonicity();

alter table ss.project_legal_acceptance_receipts enable row level security;
alter table ss.project_legal_acceptance_receipts force row level security;

create policy project_legal_acceptance_receipts_service_read
on ss.project_legal_acceptance_receipts
for select
to service_role
using (true);

create policy project_legal_acceptance_receipts_service_insert
on ss.project_legal_acceptance_receipts
for insert
to service_role
with check (true);

revoke all on table ss.project_legal_acceptance_receipts
from public, anon, authenticated, service_role;

grant select on table ss.legal_document_artifacts
to authenticated, service_role;

grant select, insert on table ss.project_legal_acceptance_receipts
to service_role;

create function ss.hosted_runtime_contract_v48()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-ss-v48-hosted-joint-legal-v3'
$$;

revoke all on function ss.hosted_runtime_contract_v48()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_runtime_contract_v48()
to service_role;

do $$
declare
  release_record record;
  expected_authority_digest ss.sha256_hex;
begin
  select * into strict release_record
  from hosted_joint_legal_v3_release_constants;

  select ss.project_legal_json_digest(jsonb_build_object(
    'documents', jsonb_build_array(
      jsonb_build_object(
        'kind', privacy.kind,
        'version', privacy.version,
        'contentDigest', privacy.content_digest,
        'contentUri', privacy.content_uri,
        'effectiveAt', to_char(
          privacy.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      jsonb_build_object(
        'kind', product.kind,
        'version', product.version,
        'contentDigest', product.content_digest,
        'contentUri', product.content_uri,
        'effectiveAt', to_char(
          product.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      jsonb_build_object(
        'kind', website.kind,
        'version', website.version,
        'contentDigest', website.content_digest,
        'contentUri', website.content_uri,
        'effectiveAt', to_char(
          website.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    ),
    'schema', 'sitesourcery.project-legal-authority/v3'
  ))
  into expected_authority_digest
  from ss.legal_documents privacy
  cross join ss.legal_documents product
  cross join ss.legal_documents website
  where privacy.id = '00000000-0000-4000-8000-000000000048'
    and product.id = '00000000-0000-4000-8000-000000000103'
    and website.id = '00000000-0000-4000-8000-000000000104';

  if expected_authority_digest is null
    or expected_authority_digest <>
      release_record.authority_digest::ss.sha256_hex
    or ss.hosted_runtime_contract_v48() <>
      'canonical-ss-v48-hosted-joint-legal-v3'
    or (
      select count(*)
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and relation.relname in (
           'legal_document_artifacts',
           'project_legal_acceptance_receipts'
         )
         and relation.relrowsecurity
         and relation.relforcerowsecurity
    ) <> 2
    or (
      select count(*)
        from pg_trigger trigger_record
        join pg_class relation on relation.oid = trigger_record.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'ss'
         and not trigger_record.tgisinternal
         and trigger_record.tgname in (
           'legal_document_artifact_matches_document',
           'legal_document_artifacts_no_update',
           'legal_document_artifacts_no_delete',
           'project_legal_receipt_exact_bundle',
           'project_legal_receipts_no_update',
           'project_legal_receipts_no_delete',
           'term_acceptance_legal_receipt_exact_bundle',
           'term_acceptances_no_update_v48',
           'term_acceptances_no_delete_v48',
           'legal_documents_no_delete_v48',
           'project_required_terms_no_delete_v48',
           'project_required_terms_monotonic_v48'
         )
    ) <> 12
    or not has_table_privilege(
      'authenticated',
      'ss.legal_document_artifacts',
      'SELECT'
    )
    or has_table_privilege(
      'authenticated',
      'ss.legal_document_artifacts',
      'INSERT'
    )
    or has_table_privilege(
      'anon',
      'ss.legal_document_artifacts',
      'SELECT'
    )
    or not has_table_privilege(
      'service_role',
      'ss.project_legal_acceptance_receipts',
      'SELECT'
    )
    or not has_table_privilege(
      'service_role',
      'ss.project_legal_acceptance_receipts',
      'INSERT'
    )
    or has_table_privilege(
      'service_role',
      'ss.project_legal_acceptance_receipts',
      'UPDATE'
    )
    or has_table_privilege(
      'service_role',
      'ss.project_legal_acceptance_receipts',
      'DELETE'
    )
    or has_table_privilege(
      'service_role',
      'ss.project_legal_acceptance_receipts',
      'TRUNCATE'
    )
    or has_table_privilege(
      'authenticated',
      'ss.project_legal_acceptance_receipts',
      'SELECT'
    )
    or has_table_privilege(
      'authenticated',
      'ss.project_legal_acceptance_receipts',
      'INSERT'
    )
    or has_table_privilege(
      'anon',
      'ss.project_legal_acceptance_receipts',
      'SELECT'
    )
    or has_table_privilege(
      'anon',
      'ss.project_legal_acceptance_receipts',
      'INSERT'
    )
  then
    raise exception
      'Hosted joint legal V3 migration postcondition failed'
      using errcode = '55000';
  end if;
end
$$;

commit;
