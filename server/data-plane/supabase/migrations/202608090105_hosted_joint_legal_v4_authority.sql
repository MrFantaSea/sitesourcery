begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v48()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v52()') is null
    or to_regprocedure(
      'ss.hosted_alakazam_retained_premium_contract()'
    ) is null
    or to_regprocedure(
      'ss.hosted_publication_control_contract()'
    ) is null
    or to_regprocedure(
      'ss.validate_project_legal_acceptance_receipt()'
    ) is null
    or to_regclass('ss.project_legal_acceptance_receipts') is null
    or to_regclass('ss.legal_document_artifacts') is null
  then
    raise exception
      'Site Sourcery migrations through the retained premium hold must precede held joint legal V4 authority'
      using errcode = '55000';
  end if;

  if ss.hosted_runtime_contract_v48() <>
      'canonical-ss-v48-hosted-joint-legal-v3'
    or ss.hosted_runtime_contract_v52() <>
      'canonical-ss-v52-alakazam-reversal-defence'
    or ss.hosted_alakazam_retained_premium_contract() <>
      'canonical-alakazam-retained-premium-held-v1'
    or ss.hosted_publication_control_contract() <>
      'canonical-publication-control-held-v1'
  then
    raise exception
      'Site Sourcery predecessor contracts do not match held joint legal V4 authority'
      using errcode = '55000';
  end if;
end
$$;

create temporary table hosted_joint_legal_v4_v3_fingerprint
on commit drop
as
select
  (
    select jsonb_agg(to_jsonb(document) order by document.id)
      from ss.legal_documents document
     where document.id in (
       '00000000-0000-4000-8000-000000000048'::uuid,
       '00000000-0000-4000-8000-000000000103'::uuid,
       '00000000-0000-4000-8000-000000000104'::uuid
     )
  ) as documents,
  (
    select jsonb_agg(to_jsonb(artifact) order by artifact.document_id)
      from ss.legal_document_artifacts artifact
     where artifact.document_id in (
       '00000000-0000-4000-8000-000000000048'::uuid,
       '00000000-0000-4000-8000-000000000104'::uuid
     )
  ) as artifacts,
  (
    select count(*)
      from ss.project_legal_acceptance_receipts receipt
     where receipt.schema_version =
       'sitesourcery.project-legal-acceptance/v3'
  ) as receipt_count;

do $$
begin
  if (
    select count(*) from ss.legal_documents document
     where document.id in (
       '00000000-0000-4000-8000-000000000048'::uuid,
       '00000000-0000-4000-8000-000000000103'::uuid,
       '00000000-0000-4000-8000-000000000104'::uuid
     )
  ) <> 3
  then
    raise exception 'Sealed joint legal V3 authority is incomplete'
      using errcode = '55000';
  end if;
end
$$;

alter table ss.project_legal_acceptance_receipts
  drop constraint project_legal_acceptance_receipts_schema_version_check;

alter table ss.project_legal_acceptance_receipts
  add constraint project_legal_acceptance_receipts_schema_version_v4_check
  check (
    schema_version in (
      'sitesourcery.project-legal-acceptance/v3',
      'sitesourcery.project-legal-acceptance/v4'
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

  select receipt.*
  into receipt_record
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

create function ss.hosted_runtime_contract_v53()
returns text
language sql
stable
set search_path = pg_catalog
as $$
select 'canonical-ss-v53-held-joint-legal-v4-authority'
$$;

revoke all on function ss.hosted_runtime_contract_v53()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_runtime_contract_v53()
to service_role;

do $$
declare
  before_record record;
begin
  select * into strict before_record
    from hosted_joint_legal_v4_v3_fingerprint;

  if before_record.documents is distinct from (
      select jsonb_agg(to_jsonb(document) order by document.id)
        from ss.legal_documents document
       where document.id in (
         '00000000-0000-4000-8000-000000000048'::uuid,
         '00000000-0000-4000-8000-000000000103'::uuid,
         '00000000-0000-4000-8000-000000000104'::uuid
       )
    )
    or before_record.artifacts is distinct from (
      select jsonb_agg(to_jsonb(artifact) order by artifact.document_id)
        from ss.legal_document_artifacts artifact
       where artifact.document_id in (
         '00000000-0000-4000-8000-000000000048'::uuid,
         '00000000-0000-4000-8000-000000000104'::uuid
       )
    )
    or before_record.receipt_count <> (
      select count(*)
        from ss.project_legal_acceptance_receipts receipt
       where receipt.schema_version =
         'sitesourcery.project-legal-acceptance/v3'
    )
    or exists (
      select 1 from ss.legal_documents document
       where document.id in (
         '00000000-0000-4000-8000-000000000049'::uuid,
         '00000000-0000-4000-8000-000000000105'::uuid,
         '00000000-0000-4000-8000-000000000106'::uuid
       )
    )
    or exists (
      select 1 from ss.legal_document_artifacts artifact
       where artifact.document_id in (
         '00000000-0000-4000-8000-000000000049'::uuid,
         '00000000-0000-4000-8000-000000000105'::uuid,
         '00000000-0000-4000-8000-000000000106'::uuid
       )
    )
  then
    raise exception
      'Held joint legal V4 migration changed V3 evidence or created release authority'
      using errcode = '55000';
  end if;
end
$$;

commit;
