begin;

set local row_security = off;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000100', 'owner@example.test');

do $$
begin
  begin
    insert into auth.users (id, email) values (
      '00000000-0000-4000-8000-000000000120',
      'OWNER@example.test'
    );
    raise exception 'canonical email uniqueness was bypassed';
  exception
    when unique_violation then null;
  end;
end
$$;

insert into ss.hosted_account_profiles (
  user_id,
  display_name
) values (
  '00000000-0000-4000-8000-000000000100',
  'Hosted Owner'
);

insert into ss.hosted_password_credentials (
  user_id,
  password_phc
) values (
  '00000000-0000-4000-8000-000000000100',
  'scrypt$32768$8$1$test-salt$test-verifier'
);

insert into ss.hosted_sessions (
  id,
  user_id,
  token_digest,
  created_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000100',
  repeat('a', 64),
  '2026-07-28T12:00:00Z',
  '2026-07-29T12:00:00Z'
);

insert into ss.organizations (
  id,
  created_by_user_id,
  name
) values (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000100',
  'Hosted API proof'
);

insert into ss.organization_memberships (
  organization_id,
  user_id,
  role,
  state,
  accepted_at
) values (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000100',
  'owner',
  'active',
  '2026-07-28T12:00:00Z'
);

insert into ss.projects (
  id,
  organization_id,
  created_by_user_id,
  billing_policy_id,
  name
) values (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000014',
  'Hosted project'
);

insert into ss.project_addresses (
  id,
  organization_id,
  project_id,
  kind,
  ownership,
  label,
  serving_hostname,
  state,
  configured_at
) values (
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  'licensed',
  'licensed',
  'hosted-proof',
  'hosted-proof.sitesourcery.com',
  'configured',
  '2026-07-28T12:00:00Z'
);

insert into ss.project_address_projection (
  organization_id,
  project_id,
  current_address_id
) values (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104'
);

insert into ss.catalog_plans (
  id,
  plan_key,
  catalog_version,
  display_name,
  active_from
) values (
  '00000000-0000-4000-8000-000000000105',
  'spark-rent',
  'abracadabra.spark.2026-07-28',
  'Spark rent',
  '2026-07-28T00:00:00Z'
);

insert into ss.catalog_prices (
  id,
  plan_id,
  currency,
  unit_amount_minor,
  cadence,
  approved_at,
  active_from
) values (
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000105',
  'USD',
  2500,
  'month',
  '2026-07-28T00:00:00Z',
  '2026-07-28T00:00:00Z'
);

insert into ss.catalog_offer_policies (
  id,
  offer_key,
  catalog_version,
  plan_id,
  price_id,
  product_id,
  tenure_id,
  terms_version,
  eligible_address_modes,
  disclosure_snapshot,
  active_from
) values
  (
    '00000000-0000-4000-8000-000000000107',
    'spark-rent',
    'abracadabra.spark.2026-07-28',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106',
    'spark',
    'rent',
    'abracadabra-product-terms/v1',
    array['licensed', 'customer_owned'],
    '{"summary":"Monthly Spark hosting"}',
    '2026-07-28T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-000000000108',
    'spark-own',
    'abracadabra.spark.2026-07-28',
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000106',
    'spark',
    'own',
    'abracadabra-product-terms/v1',
    array['customer_owned'],
    '{"summary":"Customer-owned Spark handoff"}',
    '2026-07-28T00:00:00Z'
  );

insert into ss.stripe_customers (
  id,
  organization_id,
  stripe_customer_id
) values (
  '00000000-0000-4000-8000-000000000109',
  '00000000-0000-4000-8000-000000000102',
  'cus_hosted_contract_proof'
);

insert into ss.stripe_subscriptions (
  id,
  organization_id,
  project_id,
  stripe_customer_row_id,
  stripe_subscription_id,
  stripe_price_id,
  catalog_price_id,
  billing_policy_id,
  status,
  currency,
  amount_minor,
  current_period_ends_at
) values (
  '00000000-0000-4000-8000-000000000110',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000109',
  'sub_hosted_contract_proof',
  'price_hosted_contract_proof',
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000014',
  'active',
  'USD',
  2500,
  '2026-08-28T12:00:00Z'
);

insert into ss.commerce_quotes (
  id,
  organization_id,
  project_id,
  offer_policy_id,
  offer_key,
  catalog_version,
  terms_version,
  product_id,
  tenure_id,
  eligible_address_modes,
  address_id,
  address_mode,
  address_revision,
  subscription_id,
  subscription_revision,
  currency,
  line_items,
  totals,
  disclosure_digest,
  issued_at,
  expires_at,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000107',
  'spark-rent',
  'abracadabra.spark.2026-07-28',
  'abracadabra-product-terms/v1',
  'spark',
  'rent',
  array['licensed', 'customer_owned'],
  '00000000-0000-4000-8000-000000000104',
  'licensed',
  1,
  '00000000-0000-4000-8000-000000000110',
  1,
  'USD',
  '[{"kind":"abracadabra_product","recurring":{"amountMinor":2500,"currency":"USD","interval":"month"}}]',
  '{"oneTime":{"amountMinor":0,"currency":"USD"},"recurring":[{"amountMinor":2500,"currency":"USD","interval":"month"}]}',
  repeat('b', 64),
  '2026-07-28T12:00:00Z',
  '2026-07-28T12:30:00Z',
  '00000000-0000-4000-8000-000000000100'
);

do $$
begin
  begin
    insert into ss.commerce_quotes (
      id,
      organization_id,
      project_id,
      offer_policy_id,
      offer_key,
      catalog_version,
      terms_version,
      product_id,
      tenure_id,
      eligible_address_modes,
      address_id,
      address_mode,
      address_revision,
      subscription_id,
      subscription_revision,
      currency,
      line_items,
      totals,
      disclosure_digest,
      issued_at,
      expires_at,
      created_by_user_id
    ) values (
      '00000000-0000-4000-8000-000000000112',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000108',
      'spark-own',
      'abracadabra.spark.2026-07-28',
      'abracadabra-product-terms/v1',
      'spark',
      'own',
      array['customer_owned'],
      '00000000-0000-4000-8000-000000000104',
      'licensed',
      1,
      '00000000-0000-4000-8000-000000000110',
      1,
      'USD',
      '[]',
      '{"oneTime":{"amountMinor":35000,"currency":"USD"},"recurring":[]}',
      repeat('c', 64),
      '2026-07-28T12:00:00Z',
      '2026-07-28T12:30:00Z',
      '00000000-0000-4000-8000-000000000100'
    );
    raise exception 'Own plus licensed address was accepted';
  exception
    when check_violation then null;
  end;
end
$$;

insert into ss.checkout_intents (
  id,
  organization_id,
  project_id,
  catalog_price_id,
  currency,
  amount_minor,
  state,
  created_by_user_id,
  created_at,
  updated_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000113',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000106',
  'USD',
  2500,
  'created',
  '00000000-0000-4000-8000-000000000100',
  '2026-07-28T12:00:00Z',
  '2026-07-28T12:00:00Z',
  '2026-07-28T12:30:00Z'
);

update ss.project_addresses
set configured_at = '2026-07-28T12:01:00Z'
where id = '00000000-0000-4000-8000-000000000104';

do $$
begin
  begin
    insert into ss.checkout_quote_bindings (
      organization_id,
      project_id,
      checkout_intent_id,
      quote_id,
      accepted_disclosure_digest,
      accepted_by_user_id,
      accepted_at
    ) values (
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000113',
      '00000000-0000-4000-8000-000000000111',
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000100',
      '2026-07-28T12:02:00Z'
    );
    raise exception 'stale address quote reached checkout';
  exception
    when check_violation then null;
  end;
end
$$;

insert into ss.subscription_cancellation_previews (
  id,
  organization_id,
  project_id,
  subscription_id,
  subscription_revision,
  subscription_status,
  offer_key,
  current_period_ends_at,
  effective_at,
  retention_ends_at,
  disclosure_digest,
  issued_by_user_id,
  issued_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000114',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000110',
  1,
  'active',
  'spark-rent',
  '2026-08-28T12:00:00Z',
  '2026-08-28T12:00:00Z',
  '2026-11-26T12:00:00Z',
  repeat('d', 64),
  '00000000-0000-4000-8000-000000000100',
  '2026-07-28T12:00:00Z',
  '2026-07-28T12:10:00Z'
);

update ss.stripe_subscriptions
set current_period_ends_at = '2026-08-29T12:00:00Z'
where id = '00000000-0000-4000-8000-000000000110';

do $$
begin
  begin
    insert into ss.subscription_cancellation_acceptances (
      preview_id,
      organization_id,
      project_id,
      subscription_id,
      accepted_disclosure_digest,
      accepted_by_user_id,
      request_id,
      accepted_at
    ) values (
      '00000000-0000-4000-8000-000000000114',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000110',
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000100',
      '00000000-0000-4000-8000-000000000115',
      '2026-07-28T12:03:00Z'
    );
    raise exception 'stale cancellation preview was accepted';
  exception
    when check_violation then null;
  end;
end
$$;

insert into ss.subscription_cancellation_previews (
  id,
  organization_id,
  project_id,
  subscription_id,
  subscription_revision,
  subscription_status,
  offer_key,
  current_period_ends_at,
  effective_at,
  retention_ends_at,
  disclosure_digest,
  issued_by_user_id,
  issued_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000116',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000110',
  2,
  'active',
  'spark-rent',
  '2026-08-29T12:00:00Z',
  '2026-08-29T12:00:00Z',
  '2026-11-27T12:00:00Z',
  repeat('e', 64),
  '00000000-0000-4000-8000-000000000100',
  '2026-07-28T12:04:00Z',
  '2026-07-28T12:14:00Z'
);

insert into ss.subscription_cancellation_acceptances (
  preview_id,
  organization_id,
  project_id,
  subscription_id,
  accepted_disclosure_digest,
  accepted_by_user_id,
  request_id,
  accepted_at
) values (
  '00000000-0000-4000-8000-000000000116',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000110',
  repeat('e', 64),
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000117',
  '2026-07-28T12:05:00Z'
);

do $$
begin
  begin
    update ss.subscription_cancellation_previews
    set expires_at = '2026-07-28T12:20:00Z'
    where id = '00000000-0000-4000-8000-000000000116';
    raise exception 'immutable cancellation preview was updated';
  exception
    when sqlstate '55000' then null;
  end;
end
$$;

insert into ss.export_requests (
  id,
  organization_id,
  project_id,
  requested_by_user_id,
  state,
  manifest_digest,
  object_key,
  byte_count,
  requested_at,
  completed_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000118',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000100',
  'ready',
  repeat('f', 64),
  'exports/00000000-0000-4000-8000-000000000118.zip',
  4096,
  '2026-07-28T12:00:00Z',
  '2026-07-28T12:06:00Z',
  '2026-10-26T12:06:00Z'
);

insert into ss.export_download_authorizations (
  id,
  organization_id,
  project_id,
  export_request_id,
  issued_to_user_id,
  token_digest,
  issued_at,
  expires_at
) values (
  '00000000-0000-4000-8000-000000000119',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000118',
  '00000000-0000-4000-8000-000000000100',
  repeat('1', 64),
  '2026-07-28T12:07:00Z',
  '2026-07-28T12:12:00Z'
);

update ss.export_download_authorizations
set consumed_at = '2026-07-28T12:08:00Z'
where id = '00000000-0000-4000-8000-000000000119';

do $$
begin
  begin
    update ss.export_download_authorizations
    set consumed_at = '2026-07-28T12:09:00Z'
    where id = '00000000-0000-4000-8000-000000000119';
    raise exception 'one-time export token was consumed twice';
  exception
    when sqlstate '55000' then null;
  end;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'ss_hosted'
  ) then
    raise exception 'competing ss_hosted schema must not exist';
  end if;

  if (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute on attribute.attrelid = relation.oid
    where namespace.nspname = 'ss'
      and relation.relkind = 'r'
      and attribute.attname = 'organization_id'
      and relation.relname in (
        'commerce_quotes',
        'checkout_quote_bindings',
        'subscription_cancellation_previews',
        'subscription_cancellation_acceptances',
        'export_download_authorizations'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 5 then
    raise exception 'hosted API tenant tables must enable and force RLS';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'users'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'first-party auth users must enable and force RLS';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ss'
      and relation.relname = 'hosted_auth_rate_limits'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception 'hosted authentication rate limits must enable and force RLS';
  end if;
end
$$;

select 'HOSTED_API_INVARIANTS_PASS' as result;

rollback;
