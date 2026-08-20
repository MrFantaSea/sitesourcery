-- FIN-008 correction: install the exact owner-approved Legal V5 authority
-- while retaining all V2/V3/V4 documents, artifacts, receipts, and invitations.
begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v53()') is null
    or ss.hosted_runtime_contract_v53() <>
      'canonical-ss-v53-joint-legal-v4-authority'
    or to_regprocedure('ss.hosted_runtime_contract_v106()') is null
    or ss.hosted_runtime_contract_v106() <>
      'canonical-ss-v106-customer-engagement-bootstrap'
    or to_regprocedure(
      'ss.commercial_catalog_convergence_contract_v1()'
    ) is null
    or ss.commercial_catalog_convergence_contract_v1() <>
      'canonical-ss-v141-commercial-2026.6-credit-only-card-held-historical-compatible'
    or to_regprocedure(
      'ss.validate_project_legal_acceptance_receipt()'
    ) is null
    or to_regclass('ss.project_legal_acceptance_receipts') is null
    or to_regclass('ss.legal_document_artifacts') is null
    or to_regclass('ss.customer_engagement_invitations') is null
  then
    raise exception
      'Site Sourcery migrations through FIN-007 must precede Legal V5 authority'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from ss.legal_documents document
     where document.id in (
       '00000000-0000-4000-8000-000000000149'::uuid,
       '00000000-0000-4000-8000-000000000150'::uuid,
       '00000000-0000-4000-8000-000000000151'::uuid
     )
       or document.version in (
         'SS-HOSTED-PRIVACY-2026-08-20-V5',
         'SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5'
       )
  ) then
    raise exception 'Legal V5 identifiers must be unused before installation'
      using errcode = '55000';
  end if;
end
$$;

create temporary table hosted_joint_legal_v5_history_fingerprint
on commit drop
as
select
  (
    select jsonb_agg(to_jsonb(document) order by document.id)
      from ss.legal_documents document
  ) as documents,
  (
    select jsonb_agg(to_jsonb(artifact) order by artifact.document_id)
      from ss.legal_document_artifacts artifact
  ) as artifacts,
  (
    select count(*)
      from ss.project_legal_acceptance_receipts receipt
  ) as receipt_count,
  (
    select jsonb_agg(to_jsonb(invitation) order by invitation.id)
      from ss.customer_engagement_invitations invitation
  ) as invitations;

create temporary table hosted_joint_legal_v5_release_constants (
  privacy_version text,
  privacy_content_digest text,
  privacy_content_uri text,
  effective_at timestamptz,
  privacy_byte_count bigint,
  privacy_artifact_uri text,
  website_terms_version text,
  website_terms_content_digest text,
  website_terms_artifact_uri text,
  website_terms_byte_count bigint,
  authority_digest text
) on commit drop;

-- Exact approved tuple from the retained V5 finalization receipt. It remains
-- held from public deployment even though database/runtime integration is exact.
insert into hosted_joint_legal_v5_release_constants (
  privacy_version,
  privacy_content_digest,
  privacy_content_uri,
  effective_at,
  privacy_byte_count,
  privacy_artifact_uri,
  website_terms_version,
  website_terms_content_digest,
  website_terms_artifact_uri,
  website_terms_byte_count,
  authority_digest
) values (
  'SS-HOSTED-PRIVACY-2026-08-20-V5',
  '5660b786497c3d7a7399f8fdba239e23765a1d5a755e5e39c84e1a94e9c813c5',
  'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-20-V5/',
  '2026-08-21T04:00:00.000Z'::timestamptz,
  31316,
  'https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-20-V5/',
  'SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5',
  '8e80d65585e6adb10a838a08348e36876c616b01c9f1f632a12bc48ce674d38a',
  'https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5/',
  31764,
  '6bcd6a4bad033cfb6bdfa131afa02ec950b9ddd22d2bc2a5fed0834605bc0934'
);

do $$
declare
  release_record record;
begin
  select * into strict release_record
    from hosted_joint_legal_v5_release_constants;
  if release_record.privacy_version <>
      'SS-HOSTED-PRIVACY-2026-08-20-V5'
    or release_record.privacy_content_digest !~ '^[a-f0-9]{64}$'
    or release_record.privacy_content_uri <>
      release_record.privacy_artifact_uri
    or release_record.effective_at <>
      '2026-08-21T04:00:00.000Z'::timestamptz
    or release_record.privacy_byte_count <> 31316
    or release_record.website_terms_version <>
      'SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5'
    or release_record.website_terms_content_digest !~ '^[a-f0-9]{64}$'
    or release_record.website_terms_artifact_uri !~ '^https://[^[:space:]]+$'
    or release_record.website_terms_byte_count <> 31764
    or release_record.authority_digest !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Hosted joint Legal V5 constants are invalid'
      using errcode = '55000';
  end if;
end
$$;

insert into ss.legal_documents (
  id, kind, version, content_digest, content_uri, effective_at
)
select
  '00000000-0000-4000-8000-000000000149'::uuid,
  'privacy',
  release.privacy_version,
  release.privacy_content_digest::ss.sha256_hex,
  release.privacy_content_uri,
  release.effective_at
from hosted_joint_legal_v5_release_constants release
union all
select
  '00000000-0000-4000-8000-000000000150'::uuid,
  'product',
  release.website_terms_version,
  release.website_terms_content_digest::ss.sha256_hex,
  'https://sitesourcery.com/legal/website-terms/#self-service',
  release.effective_at
from hosted_joint_legal_v5_release_constants release
union all
select
  '00000000-0000-4000-8000-000000000151'::uuid,
  'website',
  release.website_terms_version,
  release.website_terms_content_digest::ss.sha256_hex,
  'https://sitesourcery.com/legal/website-terms/',
  release.effective_at
from hosted_joint_legal_v5_release_constants release;

insert into ss.legal_document_artifacts (
  document_id, artifact_uri, artifact_sha256, byte_count, media_type
)
select
  '00000000-0000-4000-8000-000000000149'::uuid,
  release.privacy_artifact_uri,
  release.privacy_content_digest::ss.sha256_hex,
  release.privacy_byte_count,
  'text/html; charset=utf-8'
from hosted_joint_legal_v5_release_constants release
union all
select
  '00000000-0000-4000-8000-000000000151'::uuid,
  release.website_terms_artifact_uri,
  release.website_terms_content_digest::ss.sha256_hex,
  release.website_terms_byte_count,
  'text/html; charset=utf-8'
from hosted_joint_legal_v5_release_constants release;

do $$
declare
  release_record record;
  computed_authority_digest ss.sha256_hex;
begin
  select * into strict release_record
    from hosted_joint_legal_v5_release_constants;

  if (
    select count(*)
      from ss.legal_documents document
     where (
       document.id = '00000000-0000-4000-8000-000000000149'::uuid
       and document.kind = 'privacy'
       and document.version = release_record.privacy_version
       and document.content_digest =
         release_record.privacy_content_digest::ss.sha256_hex
       and document.content_uri = release_record.privacy_content_uri
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     ) or (
       document.id = '00000000-0000-4000-8000-000000000150'::uuid
       and document.kind = 'product'
       and document.version = release_record.website_terms_version
       and document.content_digest =
         release_record.website_terms_content_digest::ss.sha256_hex
       and document.content_uri =
         'https://sitesourcery.com/legal/website-terms/#self-service'
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     ) or (
       document.id = '00000000-0000-4000-8000-000000000151'::uuid
       and document.kind = 'website'
       and document.version = release_record.website_terms_version
       and document.content_digest =
         release_record.website_terms_content_digest::ss.sha256_hex
       and document.content_uri =
         'https://sitesourcery.com/legal/website-terms/'
       and document.effective_at = release_record.effective_at
       and document.retired_at is null
     )
  ) <> 3 then
    raise exception 'Hosted joint Legal V5 document postcondition failed'
      using errcode = '55000';
  end if;

  if (
    select count(*)
      from ss.legal_document_artifacts artifact
     where (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000149'::uuid
       and artifact.artifact_uri = release_record.privacy_artifact_uri
       and artifact.artifact_sha256 =
         release_record.privacy_content_digest::ss.sha256_hex
       and artifact.byte_count = release_record.privacy_byte_count
       and artifact.media_type = 'text/html; charset=utf-8'
     ) or (
       artifact.document_id =
         '00000000-0000-4000-8000-000000000151'::uuid
       and artifact.artifact_uri =
         release_record.website_terms_artifact_uri
       and artifact.artifact_sha256 =
         release_record.website_terms_content_digest::ss.sha256_hex
       and artifact.byte_count = release_record.website_terms_byte_count
       and artifact.media_type = 'text/html; charset=utf-8'
     )
  ) <> 2 or exists (
    select 1 from ss.legal_document_artifacts artifact
     where artifact.document_id =
       '00000000-0000-4000-8000-000000000150'::uuid
  ) then
    raise exception 'Hosted joint Legal V5 artifact postcondition failed'
      using errcode = '55000';
  end if;

  select ss.project_legal_json_digest(jsonb_build_object(
    'documents', jsonb_build_array(
      jsonb_build_object(
        'kind', privacy.kind,
        'version', privacy.version,
        'contentDigest', privacy.content_digest,
        'contentUri', privacy.content_uri,
        'effectiveAt', to_char(privacy.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      jsonb_build_object(
        'kind', product.kind,
        'version', product.version,
        'contentDigest', product.content_digest,
        'contentUri', product.content_uri,
        'effectiveAt', to_char(product.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      jsonb_build_object(
        'kind', website.kind,
        'version', website.version,
        'contentDigest', website.content_digest,
        'contentUri', website.content_uri,
        'effectiveAt', to_char(website.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    'schema', 'sitesourcery.project-legal-authority/v5'
  ))
  into computed_authority_digest
  from ss.legal_documents privacy
  cross join ss.legal_documents product
  cross join ss.legal_documents website
  where privacy.id = '00000000-0000-4000-8000-000000000149'::uuid
    and product.id = '00000000-0000-4000-8000-000000000150'::uuid
    and website.id = '00000000-0000-4000-8000-000000000151'::uuid;

  if computed_authority_digest is null
    or computed_authority_digest <>
      release_record.authority_digest::ss.sha256_hex
  then
    raise exception 'Hosted joint Legal V5 authority digest changed'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.project_legal_acceptance_receipts
  drop constraint project_legal_acceptance_receipts_schema_version_v4_check;

alter table ss.project_legal_acceptance_receipts
  add constraint project_legal_acceptance_receipts_schema_version_v5_check
  check (
    schema_version in (
      'sitesourcery.project-legal-acceptance/v3',
      'sitesourcery.project-legal-acceptance/v4',
      'sitesourcery.project-legal-acceptance/v5'
    )
  );

alter table ss.customer_engagement_invitations
  drop constraint
    customer_engagement_invitations_legal_acceptance_schema_check;

alter table ss.customer_engagement_invitations
  add constraint customer_engagement_invitations_legal_schema_v5_check
  check (
    legal_acceptance_schema in (
      'sitesourcery.project-legal-acceptance/v4',
      'sitesourcery.project-legal-acceptance/v5'
    )
  );

create or replace function ss.validate_project_legal_acceptance_receipt()
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
  privacy_document_id uuid;
  product_document_id uuid;
  website_document_id uuid;
  authority_schema text;
  privacy_pattern text;
  website_pattern text;
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

  select receipt.* into receipt_record
    from ss.project_legal_acceptance_receipts receipt
   where receipt.id = receipt_id
     and receipt.organization_id = receipt_organization_id;
  if not found then
    raise exception 'Project legal receipt is missing or cross-organization'
      using errcode = '23514';
  end if;

  if receipt_record.schema_version =
      'sitesourcery.project-legal-acceptance/v3'
  then
    privacy_document_id :=
      '00000000-0000-4000-8000-000000000048'::uuid;
    product_document_id :=
      '00000000-0000-4000-8000-000000000103'::uuid;
    website_document_id :=
      '00000000-0000-4000-8000-000000000104'::uuid;
    authority_schema := 'sitesourcery.project-legal-authority/v3';
    privacy_pattern :=
      '^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$';
    website_pattern :=
      '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V3$';
  elsif receipt_record.schema_version =
      'sitesourcery.project-legal-acceptance/v4'
  then
    privacy_document_id :=
      '00000000-0000-4000-8000-000000000049'::uuid;
    product_document_id :=
      '00000000-0000-4000-8000-000000000105'::uuid;
    website_document_id :=
      '00000000-0000-4000-8000-000000000106'::uuid;
    authority_schema := 'sitesourcery.project-legal-authority/v4';
    privacy_pattern :=
      '^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V4$';
    website_pattern :=
      '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V4$';
  elsif receipt_record.schema_version =
      'sitesourcery.project-legal-acceptance/v5'
  then
    privacy_document_id :=
      '00000000-0000-4000-8000-000000000149'::uuid;
    product_document_id :=
      '00000000-0000-4000-8000-000000000150'::uuid;
    website_document_id :=
      '00000000-0000-4000-8000-000000000151'::uuid;
    authority_schema := 'sitesourcery.project-legal-authority/v5';
    privacy_pattern :=
      '^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V5$';
    website_pattern :=
      '^SS-HOSTED-WEBSITE-TERMS-[0-9]{4}-[0-9]{2}-[0-9]{2}-V5$';
  else
    raise exception 'Project legal receipt schema is unsupported'
      using errcode = '23514';
  end if;

  select
    count(*) = 3
    and count(*) filter (
      where document.id = product_document_id
        and document.kind = 'product'
        and document.version ~ website_pattern
    ) = 1
    and count(*) filter (
      where document.id = privacy_document_id
        and document.kind = 'privacy'
        and document.version ~ privacy_pattern
    ) = 1
    and count(*) filter (
      where document.id = website_document_id
        and document.kind = 'website'
        and document.version ~ website_pattern
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
        'effectiveAt', to_char(privacy.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      jsonb_build_object(
        'kind', product.kind,
        'version', product.version,
        'contentDigest', product.content_digest,
        'contentUri', product.content_uri,
        'effectiveAt', to_char(product.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      jsonb_build_object(
        'kind', website.kind,
        'version', website.version,
        'contentDigest', website.content_digest,
        'contentUri', website.content_uri,
        'effectiveAt', to_char(website.effective_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    'schema', authority_schema
  ))
  into expected_authority_digest
  from ss.legal_documents privacy
  cross join ss.legal_documents product
  cross join ss.legal_documents website
  where privacy.id = privacy_document_id
    and product.id = product_document_id
    and website.id = website_document_id
    and privacy.version ~ privacy_pattern
    and product.version ~ website_pattern
    and website.version = product.version
    and website.content_digest = product.content_digest
    and website.effective_at = product.effective_at
    and privacy.effective_at = website.effective_at;

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

create function ss.hosted_joint_legal_v5_contract()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-hosted-joint-legal-v5-authority'
$$;

revoke all on function ss.hosted_joint_legal_v5_contract()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_joint_legal_v5_contract()
to service_role;

do $$
declare
  before_record record;
begin
  select * into strict before_record
    from hosted_joint_legal_v5_history_fingerprint;

  if before_record.documents is distinct from (
      select jsonb_agg(to_jsonb(document) order by document.id)
        from ss.legal_documents document
       where document.id not in (
         '00000000-0000-4000-8000-000000000149'::uuid,
         '00000000-0000-4000-8000-000000000150'::uuid,
         '00000000-0000-4000-8000-000000000151'::uuid
       )
    )
    or before_record.artifacts is distinct from (
      select jsonb_agg(to_jsonb(artifact) order by artifact.document_id)
        from ss.legal_document_artifacts artifact
       where artifact.document_id not in (
         '00000000-0000-4000-8000-000000000149'::uuid,
         '00000000-0000-4000-8000-000000000151'::uuid
       )
    )
    or before_record.receipt_count <> (
      select count(*) from ss.project_legal_acceptance_receipts
    )
    or before_record.invitations is distinct from (
      select jsonb_agg(to_jsonb(invitation) order by invitation.id)
        from ss.customer_engagement_invitations invitation
    )
  then
    raise exception 'Legal V5 integration rewrote retained evidence'
      using errcode = '55000';
  end if;
end
$$;

commit;
