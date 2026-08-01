begin;

do $$
begin
  if to_regclass('ss.legal_documents') is null
    or to_regclass('ss.projects') is null
    or to_regclass('ss.project_required_terms') is null
  then
    raise exception
      'canonical project and legal migrations must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- These digests bind acceptance to the exact reviewed hosted HTML artifacts.
-- Product and website terms are sections of the same versioned document; they
-- remain separate acceptance kinds so later product- or site-specific changes
-- can require fresh acceptance independently.
insert into ss.legal_documents (
  id, kind, version, content_digest, content_uri, effective_at
) values
  (
    '00000000-0000-4000-8000-000000000021',
    'product',
    'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2',
    'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196',
    'https://sitesourcery.com/legal/website-terms/#self-service',
    '2026-07-30T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000022',
    'privacy',
    'SS-HOSTED-PRIVACY-2026-07-30-V2',
    'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b',
    'https://sitesourcery.com/legal/privacy/',
    '2026-07-30T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000023',
    'website',
    'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2',
    'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196',
    'https://sitesourcery.com/legal/website-terms/',
    '2026-07-30T00:00:00Z'
  )
on conflict (kind, version) do nothing;

do $$
begin
  if (
    select count(*)
      from ss.legal_documents
     where (
       kind = 'product'
       and version = 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
       and content_digest = 'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
       and content_uri = 'https://sitesourcery.com/legal/website-terms/#self-service'
     ) or (
       kind = 'privacy'
       and version = 'SS-HOSTED-PRIVACY-2026-07-30-V2'
       and content_digest = 'b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b'
       and content_uri = 'https://sitesourcery.com/legal/privacy/'
     ) or (
       kind = 'website'
       and version = 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
       and content_digest = 'bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196'
       and content_uri = 'https://sitesourcery.com/legal/website-terms/'
     )
  ) <> 3 then
    raise exception
      'hosted legal authority does not match the reviewed V2 artifacts'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v21()
returns jsonb
language sql
stable
set search_path = pg_catalog, ss
as $$
  select jsonb_build_object(
    'schema', 'sitesourcery.hosted-runtime-contract/v21',
    'legalAuthority', jsonb_build_object(
      'product', 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2',
      'privacy', 'SS-HOSTED-PRIVACY-2026-07-30-V2',
      'website', 'SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2'
    )
  )
$$;

revoke all on function ss.hosted_runtime_contract_v21()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v21()
to service_role;

commit;
