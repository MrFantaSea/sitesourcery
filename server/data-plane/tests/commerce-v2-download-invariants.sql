begin;

set local row_security = off;

do $$
declare
  forced_count integer;
begin
  select count(*)
  into forced_count
  from pg_class relation
  join pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'ss'
    and relation.relname in (
      'commerce_v2_commands',
      'commerce_v2_download_quotes',
      'commerce_v2_checkout_preparations'
    )
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if forced_count <> 3 then
    raise exception
      'commerce v2 tables do not all force row-level security';
  end if;

  if has_table_privilege(
    'authenticated',
    'ss.commerce_v2_commands',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'ss.commerce_v2_download_quotes',
    'select'
  ) or has_table_privilege(
    'authenticated',
    'ss.commerce_v2_checkout_preparations',
    'select'
  ) then
    raise exception
      'authenticated role received direct commerce v2 table access';
  end if;

  if not has_table_privilege(
    'service_role',
    'ss.commerce_v2_commands',
    'insert,select,update,delete'
  ) or not has_table_privilege(
    'service_role',
    'ss.commerce_v2_download_quotes',
    'insert,select,update,delete'
  ) or not has_table_privilege(
    'service_role',
    'ss.commerce_v2_checkout_preparations',
    'insert,select,update,delete'
  ) then
    raise exception
      'service role lacks the commerce v2 repository contract';
  end if;
end
$$;

insert into auth.users (id, email)
values (
  '00000000-0000-4000-8000-000000009100',
  'commerce-v2-owner@example.test'
);

insert into ss.organizations (
  id,
  created_by_user_id,
  name
) values (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009100',
  'Commerce v2 proof'
);

insert into ss.organization_memberships (
  organization_id,
  user_id,
  role,
  state,
  accepted_at
) values (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009100',
  'owner',
  'active',
  '2026-07-30T17:00:00Z'
);

insert into ss.projects (
  id,
  organization_id,
  created_by_user_id,
  billing_policy_id,
  name
) values (
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000000014',
  'Commerce v2 project'
);

insert into ss.fact_sets (
  id,
  organization_id,
  project_id,
  schema_version,
  theme,
  business_name,
  summary,
  about,
  offerings_count,
  email_display,
  email_href,
  primary_action,
  content_digest,
  normalized_digest
) values
  (
    '00000000-0000-4000-8000-000000009103',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    'abracadabra.spark/v1',
    'clear',
    'Accepted facts',
    'Accepted content for the Download proof.',
    'Accepted content.',
    0,
    'owner@example.test',
    'mailto:owner@example.test',
    'email',
    repeat('a', 64),
    repeat('b', 64)
  ),
  (
    '00000000-0000-4000-8000-000000009110',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    'abracadabra.spark/v1',
    'clear',
    'Unaccepted facts',
    'Unaccepted content for the Download proof.',
    'Unaccepted content.',
    0,
    'owner@example.test',
    'mailto:owner@example.test',
    'email',
    repeat('c', 64),
    repeat('d', 64)
  );

insert into ss.artifacts (
  id,
  organization_id,
  project_id,
  html_bytes
) values
  (
    '00000000-0000-4000-8000-000000009104',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    convert_to(repeat('A', 64), 'utf8')
  ),
  (
    '00000000-0000-4000-8000-000000009111',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    convert_to(repeat('B', 64), 'utf8')
  );

insert into ss.site_versions (
  id,
  organization_id,
  project_id,
  version_number,
  fact_set_id,
  artifact_id,
  raw_facts,
  compiler_schema,
  compiler_revision,
  created_by_user_id
) values
  (
    '00000000-0000-4000-8000-000000009105',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    1,
    '00000000-0000-4000-8000-000000009103',
    '00000000-0000-4000-8000-000000009104',
    '{}'::jsonb,
    'abracadabra.spark/v1',
    'commerce-v2-proof',
    '00000000-0000-4000-8000-000000009100'
  ),
  (
    '00000000-0000-4000-8000-000000009112',
    '00000000-0000-4000-8000-000000009101',
    '00000000-0000-4000-8000-000000009102',
    2,
    '00000000-0000-4000-8000-000000009110',
    '00000000-0000-4000-8000-000000009111',
    '{}'::jsonb,
    'abracadabra.spark/v1',
    'commerce-v2-proof',
    '00000000-0000-4000-8000-000000009100'
  );

insert into ss.release_screenings (
  id,
  organization_id,
  project_id,
  version_id,
  stage,
  method,
  passed,
  artifact_digest,
  findings,
  checker_revision,
  checked_at
)
select
  '00000000-0000-4000-8000-000000009106',
  artifact.organization_id,
  artifact.project_id,
  '00000000-0000-4000-8000-000000009105',
  'pre_acceptance',
  'commerce-v2-proof',
  true,
  artifact.artifact_digest,
  '[]'::jsonb,
  'commerce-v2-proof',
  '2026-07-30T17:30:00Z'
from ss.artifacts artifact
where artifact.id =
  '00000000-0000-4000-8000-000000009104';

insert into ss.version_attestations (
  id,
  organization_id,
  project_id,
  version_id,
  user_id,
  statement_version,
  attested_at,
  request_id
) values (
  '00000000-0000-4000-8000-000000009107',
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009105',
  '00000000-0000-4000-8000-000000009100',
  'commerce-v2-proof',
  '2026-07-30T17:31:00Z',
  '00000000-0000-4000-8000-000000009107'
);

insert into ss.version_state_events (
  id,
  organization_id,
  project_id,
  version_id,
  state,
  screening_id,
  attestation_id,
  actor_user_id,
  occurred_at
) values (
  '00000000-0000-4000-8000-000000009108',
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009105',
  'accepted_release',
  '00000000-0000-4000-8000-000000009106',
  '00000000-0000-4000-8000-000000009107',
  '00000000-0000-4000-8000-000000009100',
  '2026-07-30T17:32:00Z'
);

insert into ss.version_state_projection (
  organization_id,
  project_id,
  version_id,
  state,
  last_event_id,
  updated_at
) values (
  '00000000-0000-4000-8000-000000009101',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009105',
  'accepted_release',
  '00000000-0000-4000-8000-000000009108',
  '2026-07-30T17:32:00Z'
);

insert into ss.commerce_v2_commands (
  organization_id,
  command_id,
  operation,
  fingerprint,
  project_id,
  customer_user_id,
  actor_user_id
) values (
  '00000000-0000-4000-8000-000000009101',
  'quote-proof',
  'create_v2_quote',
  repeat('1', 64),
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100'
);

insert into ss.commerce_v2_download_quotes (
  id,
  organization_id,
  command_id,
  customer_user_id,
  actor_user_id,
  project_id,
  version_id,
  catalog_version,
  terms_version,
  version_content_digest,
  offer_id,
  entitlement_kind,
  amount_minor,
  currency,
  billing,
  state,
  dispatch_authorized,
  issued_at,
  expires_at,
  disclosure_digest,
  snapshot_digest,
  snapshot
) values (
  '00000000-0000-4000-8000-000000009109',
  '00000000-0000-4000-8000-000000009101',
  'quote-proof',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009105',
  'spark-actions.2026-07-30.v1',
  'spark-actions-held.2026-07-30.v1',
  repeat('a', 64),
  'spark_download',
  'spark_download',
  500,
  'USD',
  'one_time',
  'held',
  false,
  '2026-07-30T18:00:00.000Z',
  '2026-07-30T18:30:00.000Z',
  repeat('e', 64),
  repeat('f', 64),
  jsonb_build_object(
    'schema',
      'sitesourcery.abracadabra-quote-snapshot.v2',
    'quoteId',
      '00000000-0000-4000-8000-000000009109',
    'tenantId',
      '00000000-0000-4000-8000-000000009101',
    'customerId',
      '00000000-0000-4000-8000-000000009100',
    'actorId',
      '00000000-0000-4000-8000-000000009100',
    'catalogVersion',
      'spark-actions.2026-07-30.v1',
    'termsVersion',
      'spark-actions-held.2026-07-30.v1',
    'state', 'held',
    'dispatchAuthorized', false,
    'project', jsonb_build_object(
      'projectId',
        '00000000-0000-4000-8000-000000009102',
      'kind', 'editor_project'
    ),
    'version', jsonb_build_object(
      'versionId',
        '00000000-0000-4000-8000-000000009105',
      'state', 'accepted',
      'contentDigest', repeat('a', 64)
    ),
    'offerId', 'spark_download',
    'entitlementKind', 'spark_download',
    'price', jsonb_build_object(
      'amountMinor', 500,
      'currency', 'USD',
      'billing', 'one_time',
      'interval', null
    ),
    'issuedAt', '2026-07-30T18:00:00.000Z',
    'expiresAt', '2026-07-30T18:30:00.000Z',
    'disclosure', jsonb_build_object(
      'catalogVersion',
        'spark-actions.2026-07-30.v1',
      'termsVersion',
        'spark-actions-held.2026-07-30.v1',
      'project', jsonb_build_object(
        'versionContentDigest', repeat('a', 64)
      )
    ),
    'disclosureDigest', repeat('e', 64),
    'snapshotDigest', repeat('f', 64)
  )
);

update ss.commerce_v2_commands command
set state = 'complete',
    result = quote.snapshot,
    completed_at = clock_timestamp()
from ss.commerce_v2_download_quotes quote
where command.organization_id =
      quote.organization_id
  and command.command_id = quote.command_id
  and command.command_id = 'quote-proof';

insert into ss.commerce_v2_commands (
  organization_id,
  command_id,
  operation,
  fingerprint,
  project_id,
  customer_user_id,
  actor_user_id
) values (
  '00000000-0000-4000-8000-000000009101',
  'checkout-proof',
  'prepare_v2_checkout',
  repeat('2', 64),
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100'
);

insert into ss.commerce_v2_checkout_preparations (
  organization_id,
  command_id,
  quote_id,
  customer_user_id,
  actor_user_id,
  project_id,
  version_id,
  offer_id,
  entitlement_kind,
  state,
  hold_reason,
  dispatch_authorized,
  prepared_at,
  purpose_digest,
  accepted_disclosure_digest,
  quote_snapshot_digest,
  preparation
) values (
  '00000000-0000-4000-8000-000000009101',
  'checkout-proof',
  '00000000-0000-4000-8000-000000009109',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009105',
  'spark_download',
  'spark_download',
  'held',
  'provider_dispatch_not_authorized',
  false,
  '2026-07-30T18:05:00.000Z',
  repeat('3', 64),
  repeat('e', 64),
  repeat('f', 64),
  jsonb_build_object(
    'schema',
      'sitesourcery.abracadabra-checkout-command.v2',
    'commandId', 'checkout-proof',
    'quoteId',
      '00000000-0000-4000-8000-000000009109',
    'projectId',
      '00000000-0000-4000-8000-000000009102',
    'versionId',
      '00000000-0000-4000-8000-000000009105',
    'offerId', 'spark_download',
    'entitlementKind', 'spark_download',
    'state', 'held',
    'holdReason',
      'provider_dispatch_not_authorized',
    'dispatchAuthorized', false,
    'provider', null,
    'preparedAt', '2026-07-30T18:05:00.000Z',
    'purposeDigest', repeat('3', 64),
    'purpose', jsonb_build_object(
      'tenantId',
        '00000000-0000-4000-8000-000000009101',
      'customerId',
        '00000000-0000-4000-8000-000000009100',
      'projectId',
        '00000000-0000-4000-8000-000000009102',
      'versionId',
        '00000000-0000-4000-8000-000000009105',
      'quoteId',
        '00000000-0000-4000-8000-000000009109',
      'quoteSnapshotDigest', repeat('f', 64),
      'acceptedDisclosureDigest', repeat('e', 64),
      'offerId', 'spark_download',
      'entitlementKind', 'spark_download',
      'price', jsonb_build_object(
        'amountMinor', 500,
        'currency', 'USD',
        'billing', 'one_time',
        'interval', null
      )
    )
  )
);

update ss.commerce_v2_commands command
set state = 'complete',
    result = preparation.preparation,
    completed_at = clock_timestamp()
from ss.commerce_v2_checkout_preparations preparation
where command.organization_id =
      preparation.organization_id
  and command.command_id = preparation.command_id
  and command.command_id = 'checkout-proof';

do $$
begin
  begin
    delete from ss.commerce_v2_download_quotes
    where id =
      '00000000-0000-4000-8000-000000009109';
    raise exception
      'ordinary transaction deleted an immutable Download quote';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    update ss.commerce_v2_commands
    set result = '{}'::jsonb
    where organization_id =
          '00000000-0000-4000-8000-000000009101'
      and command_id = 'quote-proof';
    raise exception
      'completed command replay result was replaceable';
  exception
    when object_not_in_prerequisite_state then null;
  end;
end
$$;

insert into ss.commerce_v2_commands (
  organization_id,
  command_id,
  operation,
  fingerprint,
  project_id,
  customer_user_id,
  actor_user_id
) values (
  '00000000-0000-4000-8000-000000009101',
  'unaccepted-proof',
  'create_v2_quote',
  repeat('4', 64),
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100'
);

do $$
begin
  begin
    insert into ss.commerce_v2_download_quotes (
      id,
      organization_id,
      command_id,
      customer_user_id,
      actor_user_id,
      project_id,
      version_id,
      catalog_version,
      terms_version,
      version_content_digest,
      offer_id,
      entitlement_kind,
      amount_minor,
      currency,
      billing,
      state,
      dispatch_authorized,
      issued_at,
      expires_at,
      disclosure_digest,
      snapshot_digest,
      snapshot
    ) values (
      '00000000-0000-4000-8000-000000009113',
      '00000000-0000-4000-8000-000000009101',
      'unaccepted-proof',
      '00000000-0000-4000-8000-000000009100',
      '00000000-0000-4000-8000-000000009100',
      '00000000-0000-4000-8000-000000009102',
      '00000000-0000-4000-8000-000000009112',
      'spark-actions.2026-07-30.v1',
      'spark-actions-held.2026-07-30.v1',
      repeat('c', 64),
      'spark_download',
      'spark_download',
      500,
      'USD',
      'one_time',
      'held',
      false,
      '2026-07-30T18:00:00.000Z',
      '2026-07-30T18:30:00.000Z',
      repeat('e', 64),
      repeat('f', 64),
      jsonb_build_object(
        'schema',
          'sitesourcery.abracadabra-quote-snapshot.v2',
        'quoteId',
          '00000000-0000-4000-8000-000000009113',
        'tenantId',
          '00000000-0000-4000-8000-000000009101',
        'customerId',
          '00000000-0000-4000-8000-000000009100',
        'actorId',
          '00000000-0000-4000-8000-000000009100',
        'catalogVersion',
          'spark-actions.2026-07-30.v1',
        'termsVersion',
          'spark-actions-held.2026-07-30.v1',
        'state', 'held',
        'dispatchAuthorized', false,
        'project', jsonb_build_object(
          'projectId',
            '00000000-0000-4000-8000-000000009102'
        ),
        'version', jsonb_build_object(
          'versionId',
            '00000000-0000-4000-8000-000000009112',
          'state', 'accepted',
          'contentDigest', repeat('c', 64)
        ),
        'offerId', 'spark_download',
        'entitlementKind', 'spark_download',
        'price', jsonb_build_object(
          'amountMinor', 500,
          'currency', 'USD',
          'billing', 'one_time',
          'interval', null
        ),
        'issuedAt', '2026-07-30T18:00:00.000Z',
        'expiresAt', '2026-07-30T18:30:00.000Z',
        'disclosure', jsonb_build_object(
          'catalogVersion',
            'spark-actions.2026-07-30.v1',
          'termsVersion',
            'spark-actions-held.2026-07-30.v1',
          'project', jsonb_build_object(
            'versionContentDigest', repeat('c', 64)
          )
        ),
        'disclosureDigest', repeat('e', 64),
        'snapshotDigest', repeat('f', 64)
      )
    );
    raise exception
      'unaccepted project version produced a Download quote';
  exception
    when check_violation then null;
  end;
end
$$;

delete from ss.commerce_v2_commands
where organization_id =
      '00000000-0000-4000-8000-000000009101'
  and command_id = 'unaccepted-proof';

insert into ss.commerce_v2_commands (
  organization_id,
  command_id,
  operation,
  fingerprint,
  project_id,
  customer_user_id,
  actor_user_id
) values (
  '00000000-0000-4000-8000-000000009101',
  'mismatch-proof',
  'prepare_v2_checkout',
  repeat('5', 64),
  '00000000-0000-4000-8000-000000009102',
  '00000000-0000-4000-8000-000000009100',
  '00000000-0000-4000-8000-000000009100'
);

do $$
begin
  begin
    insert into ss.commerce_v2_checkout_preparations (
      organization_id,
      command_id,
      quote_id,
      customer_user_id,
      actor_user_id,
      project_id,
      version_id,
      offer_id,
      entitlement_kind,
      state,
      hold_reason,
      dispatch_authorized,
      prepared_at,
      purpose_digest,
      accepted_disclosure_digest,
      quote_snapshot_digest,
      preparation
    )
    select
      quote.organization_id,
      'mismatch-proof',
      quote.id,
      quote.customer_user_id,
      quote.actor_user_id,
      quote.project_id,
      quote.version_id,
      quote.offer_id,
      quote.entitlement_kind,
      'held',
      'provider_dispatch_not_authorized',
      false,
      '2026-07-30T18:05:00.000Z',
      repeat('6', 64),
      repeat('a', 64),
      quote.snapshot_digest,
      jsonb_build_object(
        'schema',
          'sitesourcery.abracadabra-checkout-command.v2',
        'commandId', 'mismatch-proof',
        'quoteId', quote.id::text,
        'projectId', quote.project_id::text,
        'versionId', quote.version_id::text,
        'offerId', quote.offer_id,
        'entitlementKind', quote.entitlement_kind,
        'state', 'held',
        'holdReason',
          'provider_dispatch_not_authorized',
        'dispatchAuthorized', false,
        'provider', null,
        'preparedAt', '2026-07-30T18:05:00.000Z',
        'purposeDigest', repeat('6', 64),
        'purpose', jsonb_build_object(
          'tenantId', quote.organization_id::text,
          'customerId', quote.customer_user_id::text,
          'projectId', quote.project_id::text,
          'versionId', quote.version_id::text,
          'quoteId', quote.id::text,
          'quoteSnapshotDigest',
            quote.snapshot_digest,
          'acceptedDisclosureDigest',
            repeat('a', 64),
          'offerId', quote.offer_id,
          'entitlementKind', quote.entitlement_kind,
          'price', jsonb_build_object(
            'amountMinor', 500,
            'currency', 'USD',
            'billing', 'one_time',
            'interval', null
          )
        )
      )
    from ss.commerce_v2_download_quotes quote
    where quote.id =
      '00000000-0000-4000-8000-000000009109';
    raise exception
      'mismatched disclosure produced a checkout preparation';
  exception
    when check_violation then null;
  end;
end
$$;

delete from ss.commerce_v2_commands
where organization_id =
      '00000000-0000-4000-8000-000000009101'
  and command_id = 'mismatch-proof';

select ss.begin_terminal_project_purge(
  '00000000-0000-4000-8000-000000009102',
  'commerce-v2-proof',
  '00000000-0000-4000-8000-000000009100'
);

do $$
begin
  if exists (
    select 1
    from ss.commerce_v2_commands
    where project_id =
      '00000000-0000-4000-8000-000000009102'
    union all
    select 1
    from ss.commerce_v2_download_quotes
    where project_id =
      '00000000-0000-4000-8000-000000009102'
    union all
    select 1
    from ss.commerce_v2_checkout_preparations
    where project_id =
      '00000000-0000-4000-8000-000000009102'
  ) then
    raise exception
      'terminal purge retained commerce v2 rows';
  end if;

  if not exists (
    select 1
    from ss.deletion_requests request
    where request.project_id =
      '00000000-0000-4000-8000-000000009102'
      and request.state = 'purging'
      and request.removal_counts @> '{
        "commerceV2Commands": 2,
        "commerceV2DownloadQuotes": 1,
        "commerceV2CheckoutPreparations": 1
      }'::jsonb
  ) then
    raise exception
      'terminal purge did not seal commerce v2 removal counts';
  end if;
end
$$;

select 'COMMERCE_V2_DOWNLOAD_INVARIANTS_PASS' as result;

rollback;
