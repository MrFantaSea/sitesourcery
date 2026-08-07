begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v45()') is null
    or to_regclass('ss.service_custom_build_jobs') is null
    or to_regclass('ss.service_custom_build_completion_packages') is null
    or to_regclass('ss.service_custom_build_change_payment_receipts') is null
  then
    raise exception
      'Site Sourcery migration 045 must be applied before Custom build final payment'
      using errcode = '55000';
  end if;
end
$$;

-- One provider object may authorize exactly one Custom-build financial
-- purpose. This fence is deliberately global across first payment, accepted
-- changes, and completion-bound final payment.
create table ss.service_custom_build_stripe_payment_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references ss.organizations(id),
  provider text not null check (provider = 'stripe'),
  provider_object_kind text not null check (
    provider_object_kind in (
      'checkout_session', 'payment_intent', 'stripe_event'
    )
  ),
  provider_object_id text not null,
  purpose text not null check (
    purpose in (
      'custom_build_start',
      'custom_build_change',
      'custom_build_final'
    )
  ),
  authority_kind text not null check (
    authority_kind in (
      'checkout_attempt', 'payment_receipt', 'stripe_event'
    )
  ),
  authority_id text not null check (
    char_length(authority_id) between 3 and 200
    and authority_id !~ '[[:cntrl:]]'
  ),
  claimed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_object_kind, provider_object_id),
  unique (purpose, authority_kind, authority_id, provider_object_kind),
  check (
    (provider_object_kind = 'checkout_session'
      and provider_object_id ~ '^cs_[A-Za-z0-9_]+$'
      and authority_kind = 'checkout_attempt')
    or (provider_object_kind = 'payment_intent'
      and provider_object_id ~ '^pi_[A-Za-z0-9_]+$'
      and authority_kind = 'payment_receipt')
    or (provider_object_kind = 'stripe_event'
      and provider_object_id ~ '^evt_[A-Za-z0-9_]+$'
      and authority_kind = 'stripe_event')
  ),
  check (created_at >= claimed_at)
);

create function ss.claim_service_custom_build_stripe_payment_effect(
  selected_organization_id uuid,
  selected_provider_object_kind text,
  selected_provider_object_id text,
  selected_purpose text,
  selected_authority_kind text,
  selected_authority_id text,
  selected_claimed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  object_claim record;
  authority_claim record;
begin
  select claim.* into object_claim
  from ss.service_custom_build_stripe_payment_claims claim
  where claim.provider = 'stripe'
    and claim.provider_object_kind = selected_provider_object_kind
    and claim.provider_object_id = selected_provider_object_id;

  select claim.* into authority_claim
  from ss.service_custom_build_stripe_payment_claims claim
  where claim.purpose = selected_purpose
    and claim.authority_kind = selected_authority_kind
    and claim.authority_id = selected_authority_id
    and claim.provider_object_kind = selected_provider_object_kind;

  if object_claim.id is not null or authority_claim.id is not null then
    if object_claim.id is not null
      and authority_claim.id is not null
      and object_claim.id = authority_claim.id
      and object_claim.organization_id = selected_organization_id
      and object_claim.provider_object_id = selected_provider_object_id
      and object_claim.purpose = selected_purpose
      and object_claim.authority_kind = selected_authority_kind
      and object_claim.authority_id = selected_authority_id
    then
      return;
    end if;
    if object_claim.id is not null then
      raise exception
        'Custom build Stripe % collision: object % belongs to % authority %',
        selected_provider_object_kind,
        selected_provider_object_id,
        object_claim.purpose,
        object_claim.authority_id
        using errcode = '23505';
    end if;
    raise exception
      'Custom build Stripe % collision: % authority % already maps to object %',
      selected_provider_object_kind,
      selected_purpose,
      selected_authority_id,
      authority_claim.provider_object_id
      using errcode = '23505';
  end if;

  begin
    insert into ss.service_custom_build_stripe_payment_claims (
      organization_id,
      provider,
      provider_object_kind,
      provider_object_id,
      purpose,
      authority_kind,
      authority_id,
      claimed_at,
      created_at
    ) values (
      selected_organization_id,
      'stripe',
      selected_provider_object_kind,
      selected_provider_object_id,
      selected_purpose,
      selected_authority_kind,
      selected_authority_id,
      selected_claimed_at,
      clock_timestamp()
    );
    return;
  exception
    when unique_violation then
      -- A concurrent insert can win either unique axis while this statement
      -- waits. Re-resolve both axes once; never retry indefinitely.
      select claim.* into object_claim
      from ss.service_custom_build_stripe_payment_claims claim
      where claim.provider = 'stripe'
        and claim.provider_object_kind = selected_provider_object_kind
        and claim.provider_object_id = selected_provider_object_id;

      select claim.* into authority_claim
      from ss.service_custom_build_stripe_payment_claims claim
      where claim.purpose = selected_purpose
        and claim.authority_kind = selected_authority_kind
        and claim.authority_id = selected_authority_id
        and claim.provider_object_kind = selected_provider_object_kind;

      if object_claim.id is not null
        and authority_claim.id is not null
        and object_claim.id = authority_claim.id
        and object_claim.organization_id = selected_organization_id
        and object_claim.provider_object_id = selected_provider_object_id
        and object_claim.purpose = selected_purpose
        and object_claim.authority_kind = selected_authority_kind
        and object_claim.authority_id = selected_authority_id
      then
        return;
      end if;
      if object_claim.id is not null then
        raise exception
          'Custom build Stripe % collision: object % belongs to % authority %',
          selected_provider_object_kind,
          selected_provider_object_id,
          object_claim.purpose,
          object_claim.authority_id
          using errcode = '23505';
      end if;
      if authority_claim.id is not null then
        raise exception
          'Custom build Stripe % collision: % authority % already maps to object %',
          selected_provider_object_kind,
          selected_purpose,
          selected_authority_id,
          authority_claim.provider_object_id
          using errcode = '23505';
      end if;
      raise exception
        'Custom build Stripe claim collided outside both canonical claim axes'
        using errcode = '23505';
  end;
end
$$;

create function ss.claim_service_custom_build_checkout_session()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_purpose text;
begin
  if new.checkout_session_id is null then
    return new;
  end if;
  selected_purpose := case tg_table_name
    when 'service_custom_build_checkout_attempts'
      then 'custom_build_start'
    when 'service_custom_build_change_checkout_attempts'
      then 'custom_build_change'
    when 'service_custom_build_final_checkout_attempts'
      then 'custom_build_final'
    else null
  end;
  if selected_purpose is null then
    raise exception 'Unsupported Custom build Checkout claim source'
      using errcode = '55000';
  end if;
  perform ss.claim_service_custom_build_stripe_payment_effect(
    new.organization_id,
    'checkout_session',
    new.checkout_session_id,
    selected_purpose,
    'checkout_attempt',
    new.id::text,
    new.created_at
  );
  return new;
end
$$;

create function ss.claim_service_custom_build_stripe_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_purpose text;
begin
  selected_purpose := case tg_table_name
    when 'service_custom_build_stripe_events'
      then 'custom_build_start'
    when 'service_custom_build_change_stripe_events'
      then 'custom_build_change'
    when 'service_custom_build_final_stripe_events'
      then 'custom_build_final'
    else null
  end;
  if selected_purpose is null then
    raise exception 'Unsupported Custom build Stripe-event claim source'
      using errcode = '55000';
  end if;
  perform ss.claim_service_custom_build_stripe_payment_effect(
    new.organization_id,
    'stripe_event',
    new.id,
    selected_purpose,
    'stripe_event',
    new.id,
    new.created_at
  );
  return new;
end
$$;

create function ss.claim_service_custom_build_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_purpose text;
begin
  selected_purpose := case tg_table_name
    when 'service_custom_build_payment_receipts'
      then 'custom_build_start'
    when 'service_custom_build_change_payment_receipts'
      then 'custom_build_change'
    when 'service_custom_build_final_payment_receipts'
      then 'custom_build_final'
    else null
  end;
  if selected_purpose is null then
    raise exception 'Unsupported Custom build payment-receipt claim source'
      using errcode = '55000';
  end if;

  -- The receipt reasserts its exact Session authority and claims its new
  -- PaymentIntent in the same transaction. A mismatch is never an upsert.
  perform ss.claim_service_custom_build_stripe_payment_effect(
    new.organization_id,
    'checkout_session',
    new.checkout_session_id,
    selected_purpose,
    'checkout_attempt',
    new.checkout_attempt_id::text,
    new.created_at
  );
  perform ss.claim_service_custom_build_stripe_payment_effect(
    new.organization_id,
    'payment_intent',
    new.payment_intent_id,
    selected_purpose,
    'payment_receipt',
    new.id::text,
    new.created_at
  );
  return new;
end
$$;

-- Backfill every retained v42/v45 authority before new claim triggers are
-- attached. The claim function raises on any historical cross-purpose reuse;
-- no collision can be hidden with ON CONFLICT.
do $$
declare
  retained record;
begin
  for retained in
    select organization_id, id, checkout_session_id, created_at,
           'custom_build_start'::text as purpose
    from ss.service_custom_build_checkout_attempts
    where checkout_session_id is not null
    union all
    select organization_id, id, checkout_session_id, created_at,
           'custom_build_change'::text
    from ss.service_custom_build_change_checkout_attempts
    where checkout_session_id is not null
    order by created_at, id
  loop
    perform ss.claim_service_custom_build_stripe_payment_effect(
      retained.organization_id,
      'checkout_session',
      retained.checkout_session_id,
      retained.purpose,
      'checkout_attempt',
      retained.id::text,
      retained.created_at
    );
  end loop;

  for retained in
    select organization_id, id, created_at,
           'custom_build_start'::text as purpose
    from ss.service_custom_build_stripe_events
    union all
    select organization_id, id, created_at,
           'custom_build_change'::text
    from ss.service_custom_build_change_stripe_events
    order by created_at, id
  loop
    perform ss.claim_service_custom_build_stripe_payment_effect(
      retained.organization_id,
      'stripe_event',
      retained.id,
      retained.purpose,
      'stripe_event',
      retained.id,
      retained.created_at
    );
  end loop;

  for retained in
    select organization_id, id, checkout_attempt_id,
           checkout_session_id, payment_intent_id, created_at,
           'custom_build_start'::text as purpose
    from ss.service_custom_build_payment_receipts
    union all
    select organization_id, id, checkout_attempt_id,
           checkout_session_id, payment_intent_id, created_at,
           'custom_build_change'::text
    from ss.service_custom_build_change_payment_receipts
    order by created_at, id
  loop
    perform ss.claim_service_custom_build_stripe_payment_effect(
      retained.organization_id,
      'checkout_session',
      retained.checkout_session_id,
      retained.purpose,
      'checkout_attempt',
      retained.checkout_attempt_id::text,
      retained.created_at
    );
    perform ss.claim_service_custom_build_stripe_payment_effect(
      retained.organization_id,
      'payment_intent',
      retained.payment_intent_id,
      retained.purpose,
      'payment_receipt',
      retained.id::text,
      retained.created_at
    );
  end loop;
end
$$;

create trigger service_custom_build_start_checkout_session_claim
after insert or update of checkout_session_id
on ss.service_custom_build_checkout_attempts
for each row execute function
  ss.claim_service_custom_build_checkout_session();

create trigger service_custom_build_change_checkout_session_claim
after insert or update of checkout_session_id
on ss.service_custom_build_change_checkout_attempts
for each row execute function
  ss.claim_service_custom_build_checkout_session();

create trigger service_custom_build_start_stripe_event_claim
after insert on ss.service_custom_build_stripe_events
for each row execute function ss.claim_service_custom_build_stripe_event();

create trigger service_custom_build_change_stripe_event_claim
after insert on ss.service_custom_build_change_stripe_events
for each row execute function ss.claim_service_custom_build_stripe_event();

create trigger service_custom_build_start_payment_receipt_claim
after insert on ss.service_custom_build_payment_receipts
for each row execute function
  ss.claim_service_custom_build_payment_receipt();

create trigger service_custom_build_change_payment_receipt_claim
after insert on ss.service_custom_build_change_payment_receipts
for each row execute function
  ss.claim_service_custom_build_payment_receipt();

create function ss.assert_service_custom_build_final_payment_lock(
  target_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  lock_key bigint := pg_catalog.hashtextextended(
    'ss-custom-build-h1m:' || target_job_id::text,
    0
  );
begin
  if not exists (
    select 1
    from pg_catalog.pg_locks held
    where held.locktype = 'advisory'
      and held.pid = pg_catalog.pg_backend_pid()
      and held.granted
      and held.mode = 'ExclusiveLock'
      and held.classid::bigint = ((lock_key >> 32) & 4294967295)
      and held.objid::bigint = (lock_key & 4294967295)
      and held.objsubid = 1
  ) then
    raise exception
      'Custom build final-payment mutation requires the shared H1M job lock'
      using errcode = '55000';
  end if;
end
$$;

create function ss.custom_build_final_obligation_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  job_id uuid,
  quote_id uuid,
  quote_revision bigint,
  quote_revision_id uuid,
  quote_acceptance_id uuid,
  completion_package_id uuid,
  completion_package_digest ss.sha256_hex,
  base_scope_digest ss.sha256_hex,
  effective_change_order_digests ss.sha256_hex[],
  effective_scope_digest ss.sha256_hex,
  accepted_quote_digest ss.sha256_hex,
  accepted_disclosure_digest ss.sha256_hex,
  commercial_contract_id text,
  commercial_contract_digest ss.sha256_hex,
  quote_installment_id uuid,
  final_due_minor bigint,
  currency text,
  workmanship_correction_days integer,
  bound_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'acceptedDisclosureDigest', accepted_disclosure_digest,
    'acceptedQuoteDigest', accepted_quote_digest,
    'baseScopeDigest', base_scope_digest,
    'boundAt', bound_at,
    'commercialContractDigest', commercial_contract_digest,
    'commercialContractId', commercial_contract_id,
    'completionPackageDigest', completion_package_digest,
    'completionPackageId', completion_package_id,
    'creditMinor', 0,
    'currency', currency,
    'customerUserId', customer_user_id,
    'effectiveChangeOrderDigests', effective_change_order_digests,
    'effectiveScopeDigest', effective_scope_digest,
    'finalDueMinor', final_due_minor,
    'jobId', job_id,
    'organizationId', organization_id,
    'projectId', project_id,
    'purpose', 'custom_build_final',
    'quoteAcceptanceId', quote_acceptance_id,
    'quoteId', quote_id,
    'quoteInstallmentId', quote_installment_id,
    'quoteRevision', quote_revision,
    'quoteRevisionId', quote_revision_id,
    'schema', 'sitesourcery.custom-build-final-obligation/v1',
    'workmanshipCorrectionDays', workmanship_correction_days
  ))
$$;

create table ss.service_custom_build_final_obligations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  quote_revision_id uuid not null,
  quote_acceptance_id uuid not null,
  quote_installment_id uuid,
  installment_number integer check (installment_number is null or installment_number = 2),
  completion_package_id uuid not null,
  completion_package_digest ss.sha256_hex not null,
  base_scope_digest ss.sha256_hex not null,
  effective_change_order_digests ss.sha256_hex[] not null,
  effective_scope_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  commercial_contract_id text not null,
  commercial_contract_digest ss.sha256_hex not null,
  tier_id text not null check (tier_id in (
    'card', 'card-plus', 'site', 'site-plus',
    'signature', 'flagship', 'scale'
  )),
  final_due_minor bigint not null check (final_due_minor >= 0),
  credit_minor bigint not null check (credit_minor = 0),
  currency text not null check (currency = 'USD'),
  workmanship_correction_days integer not null check (
    workmanship_correction_days = 30
  ),
  bound_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  obligation_digest ss.sha256_hex generated always as (
    ss.custom_build_final_obligation_digest(
      organization_id,
      project_id,
      customer_user_id,
      job_id,
      quote_id,
      quote_revision,
      quote_revision_id,
      quote_acceptance_id,
      completion_package_id,
      completion_package_digest,
      base_scope_digest,
      effective_change_order_digests,
      effective_scope_digest,
      accepted_quote_digest,
      accepted_disclosure_digest,
      commercial_contract_id,
      commercial_contract_digest,
      quote_installment_id,
      final_due_minor,
      currency,
      workmanship_correction_days,
      bound_at
    )
  ) stored,
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (
    organization_id, quote_id, quote_revision, quote_revision_id
  ) references ss.service_custom_build_quote_revisions(
    organization_id, quote_id, quote_revision, id
  ),
  foreign key (organization_id, quote_acceptance_id)
    references ss.service_custom_build_quote_acceptances(organization_id, id),
  foreign key (organization_id, quote_installment_id)
    references ss.service_custom_build_quote_installments(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (job_id),
  unique (completion_package_id),
  unique (quote_acceptance_id),
  unique (quote_installment_id),
  check (
    (final_due_minor = 0
      and tier_id in ('card', 'card-plus')
      and quote_installment_id is null
      and installment_number is null)
    or (final_due_minor > 0
      and tier_id in ('site', 'site-plus', 'signature', 'flagship', 'scale')
      and quote_installment_id is not null
      and installment_number = 2)
  ),
  check (created_at >= bound_at)
);

create function ss.custom_build_final_invoice_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  job_id uuid,
  obligation_id uuid,
  obligation_digest ss.sha256_hex,
  completion_package_id uuid,
  completion_package_digest ss.sha256_hex,
  invoice_id uuid,
  invoice_number text,
  subtotal_minor bigint,
  currency text,
  tax_state text,
  issued_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'completionPackageDigest', completion_package_digest,
    'completionPackageId', completion_package_id,
    'creditMinor', 0,
    'currency', currency,
    'customerUserId', customer_user_id,
    'invoiceId', invoice_id,
    'invoiceNumber', invoice_number,
    'issuedAt', issued_at,
    'jobId', job_id,
    'obligationDigest', obligation_digest,
    'obligationId', obligation_id,
    'organizationId', organization_id,
    'projectId', project_id,
    'purpose', 'custom_build_final',
    'schema', 'sitesourcery.custom-build-final-invoice/v1',
    'subtotalMinor', subtotal_minor,
    'taxState', tax_state
  ))
$$;

create table ss.service_custom_build_final_invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  obligation_id uuid not null,
  completion_package_id uuid not null,
  invoice_number text generated always as (
    'SSCB-FINAL-' || upper(replace(id::text, '-', ''))
  ) stored,
  purpose text not null check (purpose = 'custom_build_final'),
  obligation_digest ss.sha256_hex not null,
  completion_package_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  subtotal_minor bigint not null check (subtotal_minor > 0),
  credit_minor bigint not null check (credit_minor = 0),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'calculation_required'),
  tax_minor bigint check (tax_minor is null),
  total_minor bigint check (total_minor is null),
  state text not null check (state = 'tax_calculation_pending'),
  charge_occurred boolean not null check (charge_occurred = false),
  issued_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  invoice_digest ss.sha256_hex generated always as (
    ss.custom_build_final_invoice_digest(
      organization_id,
      project_id,
      customer_user_id,
      job_id,
      obligation_id,
      obligation_digest,
      completion_package_id,
      completion_package_digest,
      id,
      'SSCB-FINAL-' || upper(replace(id::text, '-', '')),
      subtotal_minor,
      currency,
      tax_state,
      issued_at
    )
  ) stored,
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (invoice_number),
  unique (organization_id, id),
  unique (job_id),
  unique (obligation_id),
  unique (completion_package_id),
  check (created_at >= issued_at)
);

create table ss.service_custom_build_final_invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  obligation_id uuid not null,
  quote_installment_id uuid not null,
  line_number integer not null check (line_number = 1),
  component_key text not null check (
    component_key = 'custom_build_final_installment'
  ),
  display_name text not null check (
    display_name = 'Custom website build final installment'
  ),
  quantity integer not null check (quantity = 1),
  unit_amount_minor bigint not null check (unit_amount_minor > 0),
  credit_minor bigint not null check (credit_minor = 0),
  amount_minor bigint not null check (
    amount_minor = quantity::bigint * unit_amount_minor
  ),
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null,
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_final_invoices(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, quote_installment_id)
    references ss.service_custom_build_quote_installments(organization_id, id),
  unique (invoice_id, line_number),
  unique (invoice_id, obligation_id),
  unique (quote_installment_id),
  unique (organization_id, id)
);

create function ss.custom_build_final_zero_clearance_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  job_id uuid,
  obligation_id uuid,
  obligation_digest ss.sha256_hex,
  completion_package_id uuid,
  completion_package_digest ss.sha256_hex,
  cleared_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'completionPackageDigest', completion_package_digest,
    'completionPackageId', completion_package_id,
    'customerUserId', customer_user_id,
    'finalDueMinor', 0,
    'jobId', job_id,
    'obligationDigest', obligation_digest,
    'obligationId', obligation_id,
    'organizationId', organization_id,
    'projectId', project_id,
    'reason', 'accepted_quote_has_no_final_balance',
    'schema', 'sitesourcery.custom-build-final-zero-balance-clearance/v1',
    'clearedAt', cleared_at
  ))
$$;

create table ss.service_custom_build_final_zero_balance_clearances (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  obligation_id uuid not null,
  completion_package_id uuid not null,
  obligation_digest ss.sha256_hex not null,
  completion_package_digest ss.sha256_hex not null,
  final_due_minor bigint not null check (final_due_minor = 0),
  currency text not null check (currency = 'USD'),
  reason text not null check (
    reason = 'accepted_quote_has_no_final_balance'
  ),
  cleared_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  clearance_digest ss.sha256_hex generated always as (
    ss.custom_build_final_zero_clearance_digest(
      organization_id,
      project_id,
      customer_user_id,
      job_id,
      obligation_id,
      obligation_digest,
      completion_package_id,
      completion_package_digest,
      cleared_at
    )
  ) stored,
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (job_id),
  unique (obligation_id),
  unique (completion_package_id),
  check (created_at >= cleared_at)
);

create function ss.ensure_service_custom_build_final_obligation(
  target_completion_package_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  discovered_job_id uuid;
  source record;
  scope_snapshot record;
  selected_obligation_id uuid;
  selected_invoice_id uuid;
begin
  -- The immutable job is discovered without a row lock before any mutable or
  -- idempotency authority is consulted.
  select package.job_id into discovered_job_id
  from ss.service_custom_build_completion_packages package
  where package.id = target_completion_package_id;
  if not found then
    raise exception 'Custom build final obligation lacks completion authority'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || discovered_job_id::text,
      0
    )
  );

  select obligation.id into selected_obligation_id
  from ss.service_custom_build_final_obligations obligation
  where obligation.completion_package_id = target_completion_package_id;
  if found then
    return selected_obligation_id;
  end if;

  select
    package.organization_id,
    package.project_id,
    package.case_id,
    package.customer_user_id,
    package.job_id,
    package.id as completion_package_id,
    package.package_digest as completion_package_digest,
    package.base_scope_digest,
    package.effective_change_order_digests,
    package.effective_scope_digest,
    package.state as completion_state,
    package.prepared_at,
    job.quote_id,
    job.quote_revision,
    job.quote_revision_id,
    job.quote_acceptance_id,
    job.policy_id,
    job.scope_boundary_digest,
    job.tier_id,
    job.accepted_quote_digest,
    job.accepted_disclosure_digest,
    job.final_due_minor,
    job.final_payment_state,
    job.currency,
    job.state as job_state,
    quote.state as quote_state,
    revision.quote_digest,
    revision.disclosure_digest,
    revision.payment_schedule,
    revision.final_due_minor as revision_final_due_minor,
    revision.currency as revision_currency,
    revision.workmanship_correction_days,
    revision.commercial_contract_id,
    revision.commercial_contract_digest,
    acceptance.accepted_quote_digest as acceptance_quote_digest,
    acceptance.accepted_disclosure_digest as acceptance_disclosure_digest,
    installment.id as quote_installment_id,
    installment.installment_number,
    installment.installment_kind,
    installment.gross_value_minor as installment_gross_minor,
    installment.credit_amount_minor as installment_credit_minor,
    installment.amount_due_minor as installment_due_minor,
    installment.currency as installment_currency,
    installment.due_trigger
  into source
  from ss.service_custom_build_completion_packages package
  join ss.service_custom_build_jobs job
    on job.organization_id = package.organization_id
   and job.id = package.job_id
  join ss.service_custom_build_quotes quote
    on quote.organization_id = job.organization_id
   and quote.id = job.quote_id
  join ss.service_custom_build_quote_revisions revision
    on revision.organization_id = job.organization_id
   and revision.quote_id = job.quote_id
   and revision.quote_revision = job.quote_revision
   and revision.id = job.quote_revision_id
  join ss.service_custom_build_quote_acceptances acceptance
    on acceptance.organization_id = job.organization_id
   and acceptance.id = job.quote_acceptance_id
   and acceptance.quote_id = job.quote_id
   and acceptance.quote_revision = job.quote_revision
   and acceptance.quote_revision_id = job.quote_revision_id
  left join ss.service_custom_build_quote_installments installment
    on installment.organization_id = job.organization_id
   and installment.quote_revision_id = job.quote_revision_id
   and installment.installment_number = 2
  where package.id = target_completion_package_id;

  if not found or source.job_id is distinct from discovered_job_id then
    raise exception 'Custom build final obligation lacks exact immutable sources'
      using errcode = '23514';
  end if;

  select snapshot.* into scope_snapshot
  from ss.service_custom_build_effective_scope_snapshot(
    source.organization_id,
    source.job_id
  ) snapshot;

  if source.job_state <> 'open'
    or source.quote_state <> 'accepted'
    or source.quote_digest is distinct from source.accepted_quote_digest
    or source.disclosure_digest is distinct from
      source.accepted_disclosure_digest
    or source.acceptance_quote_digest is distinct from
      source.accepted_quote_digest
    or source.acceptance_disclosure_digest is distinct from
      source.accepted_disclosure_digest
    or source.revision_final_due_minor is distinct from source.final_due_minor
    or source.revision_currency is distinct from source.currency
    or source.workmanship_correction_days <> 30
    or source.commercial_contract_id is null
    or source.commercial_contract_digest is null
    or source.base_scope_digest is distinct from
      scope_snapshot.base_scope_digest
    or source.effective_change_order_digests is distinct from
      scope_snapshot.effective_change_order_digests
    or source.effective_scope_digest is distinct from
      scope_snapshot.effective_scope_digest
    or exists (
      select 1
      from ss.service_custom_build_change_orders change_order
      where change_order.organization_id = source.organization_id
        and change_order.job_id = source.job_id
        and change_order.state in ('issued', 'accepted_payment_required')
    )
    or (
      source.final_due_minor = 0
      and (
        source.tier_id not in ('card', 'card-plus')
        or source.payment_schedule <> 'full_before_work'
        or source.final_payment_state <> 'not_required'
        or source.completion_state <> 'ready_for_delivery'
        or source.quote_installment_id is not null
      )
    )
    or (
      source.final_due_minor > 0
      and (
        source.tier_id not in (
          'site', 'site-plus', 'signature', 'flagship', 'scale'
        )
        or source.payment_schedule <>
          'half_before_work_half_before_handoff'
        or source.final_payment_state <> 'unpaid'
        or source.completion_state <> 'ready_for_final_payment'
        or source.quote_installment_id is null
        or source.installment_number <> 2
        or source.installment_kind <> 'final'
        or source.installment_gross_minor <> source.final_due_minor
        or source.installment_credit_minor <> 0
        or source.installment_due_minor <> source.final_due_minor
        or source.installment_currency <> source.currency
        or source.due_trigger <> 'before_handoff'
      )
    )
  then
    raise exception
      'Custom build final obligation does not match completion and installment 2'
      using errcode = '23514';
  end if;

  insert into ss.service_custom_build_final_obligations (
    organization_id,
    project_id,
    case_id,
    customer_user_id,
    job_id,
    quote_id,
    quote_revision,
    quote_revision_id,
    quote_acceptance_id,
    quote_installment_id,
    installment_number,
    completion_package_id,
    completion_package_digest,
    base_scope_digest,
    effective_change_order_digests,
    effective_scope_digest,
    accepted_quote_digest,
    accepted_disclosure_digest,
    commercial_contract_id,
    commercial_contract_digest,
    tier_id,
    final_due_minor,
    credit_minor,
    currency,
    workmanship_correction_days,
    bound_at,
    created_at
  ) values (
    source.organization_id,
    source.project_id,
    source.case_id,
    source.customer_user_id,
    source.job_id,
    source.quote_id,
    source.quote_revision,
    source.quote_revision_id,
    source.quote_acceptance_id,
    source.quote_installment_id,
    source.installment_number,
    source.completion_package_id,
    source.completion_package_digest,
    source.base_scope_digest,
    source.effective_change_order_digests,
    source.effective_scope_digest,
    source.accepted_quote_digest,
    source.accepted_disclosure_digest,
    source.commercial_contract_id,
    source.commercial_contract_digest,
    source.tier_id,
    source.final_due_minor,
    0,
    source.currency,
    source.workmanship_correction_days,
    source.prepared_at,
    clock_timestamp()
  ) returning id into selected_obligation_id;

  if source.final_due_minor > 0 then
    insert into ss.service_custom_build_final_invoices (
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      job_id,
      obligation_id,
      completion_package_id,
      purpose,
      obligation_digest,
      completion_package_digest,
      accepted_quote_digest,
      accepted_disclosure_digest,
      subtotal_minor,
      credit_minor,
      currency,
      tax_state,
      state,
      charge_occurred,
      issued_at,
      created_at
    )
    select
      obligation.organization_id,
      obligation.project_id,
      obligation.case_id,
      obligation.customer_user_id,
      obligation.job_id,
      obligation.id,
      obligation.completion_package_id,
      'custom_build_final',
      obligation.obligation_digest,
      obligation.completion_package_digest,
      obligation.accepted_quote_digest,
      obligation.accepted_disclosure_digest,
      obligation.final_due_minor,
      0,
      obligation.currency,
      'calculation_required',
      'tax_calculation_pending',
      false,
      obligation.bound_at,
      clock_timestamp()
    from ss.service_custom_build_final_obligations obligation
    where obligation.id = selected_obligation_id
    returning id into selected_invoice_id;

    insert into ss.service_custom_build_final_invoice_lines (
      organization_id,
      invoice_id,
      obligation_id,
      quote_installment_id,
      line_number,
      component_key,
      display_name,
      quantity,
      unit_amount_minor,
      credit_minor,
      amount_minor,
      currency,
      created_at
    ) values (
      source.organization_id,
      selected_invoice_id,
      selected_obligation_id,
      source.quote_installment_id,
      1,
      'custom_build_final_installment',
      'Custom website build final installment',
      1,
      source.final_due_minor,
      0,
      source.final_due_minor,
      source.currency,
      source.prepared_at
    );
  else
    insert into ss.service_custom_build_final_zero_balance_clearances (
      organization_id,
      project_id,
      case_id,
      customer_user_id,
      job_id,
      obligation_id,
      completion_package_id,
      obligation_digest,
      completion_package_digest,
      final_due_minor,
      currency,
      reason,
      cleared_at,
      created_at
    )
    select
      obligation.organization_id,
      obligation.project_id,
      obligation.case_id,
      obligation.customer_user_id,
      obligation.job_id,
      obligation.id,
      obligation.completion_package_id,
      obligation.obligation_digest,
      obligation.completion_package_digest,
      0,
      obligation.currency,
      'accepted_quote_has_no_final_balance',
      obligation.bound_at,
      clock_timestamp()
    from ss.service_custom_build_final_obligations obligation
    where obligation.id = selected_obligation_id;
  end if;

  return selected_obligation_id;
end
$$;

create function ss.materialize_service_custom_build_final_obligation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.ensure_service_custom_build_final_obligation(new.id);
  return new;
end
$$;

create trigger service_custom_build_completion_final_obligation
after insert on ss.service_custom_build_completion_packages
for each row execute function
  ss.materialize_service_custom_build_final_obligation();

-- Completion packages sealed before v46 receive the identical obligation,
-- positive invoice, or zero-balance clearance under the same job lock.
do $$
declare
  retained record;
begin
  for retained in
    select id
    from ss.service_custom_build_completion_packages
    order by prepared_at, id
  loop
    perform ss.ensure_service_custom_build_final_obligation(retained.id);
  end loop;
end
$$;

create trigger service_custom_build_final_obligations_immutable
before update or delete on ss.service_custom_build_final_obligations
for each row execute function ss.reject_update();

create trigger service_custom_build_final_invoices_immutable
before update or delete on ss.service_custom_build_final_invoices
for each row execute function ss.reject_update();

create trigger service_custom_build_final_invoice_lines_immutable
before update or delete on ss.service_custom_build_final_invoice_lines
for each row execute function ss.reject_update();

create trigger service_custom_build_final_zero_clearances_immutable
before update or delete
on ss.service_custom_build_final_zero_balance_clearances
for each row execute function ss.reject_update();

create table ss.service_custom_build_final_checkout_attempts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  obligation_id uuid not null,
  completion_package_id uuid not null,
  invoice_id uuid not null,
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  provider text not null check (provider = 'stripe'),
  purpose text not null check (purpose = 'custom_build_final'),
  purpose_digest ss.sha256_hex not null,
  obligation_digest ss.sha256_hex not null,
  completion_package_digest ss.sha256_hex not null,
  invoice_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  expected_subtotal_minor bigint not null check (expected_subtotal_minor > 0),
  currency text not null check (currency = 'USD'),
  tax_mode text not null check (tax_mode = 'automatic'),
  provider_request_expires_at timestamptz not null,
  state text not null check (state in (
    'provider_pending', 'ready', 'failed',
    'persistence_unknown', 'expired', 'paid'
  )),
  provider_effect_certainty text not null check (
    provider_effect_certainty in ('not_submitted', 'confirmed', 'ambiguous')
  ),
  checkout_session_id text check (
    checkout_session_id is null
    or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
  ),
  checkout_url text check (
    checkout_url is null
    or (
      char_length(checkout_url) between 20 and 2000
      and checkout_url like 'https://checkout.stripe.com/%'
    )
  ),
  expires_at timestamptz,
  provider_error_code text check (
    provider_error_code is null
    or provider_error_code ~ '^[A-Za-z0-9._:-]{1,200}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_final_invoices(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (customer_user_id, command_id),
  unique (checkout_session_id),
  check (
    (state = 'provider_pending'
      and provider_effect_certainty = 'ambiguous'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is null)
    or (state = 'ready'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id is not null
      and checkout_url is not null
      and expires_at = provider_request_expires_at
      and provider_error_code is null)
    or (state = 'failed'
      and provider_effect_certainty = 'not_submitted'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is not null)
    or (state = 'persistence_unknown'
      and provider_effect_certainty = 'ambiguous'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is not null)
    or (state = 'expired'
      and (
        (provider_effect_certainty = 'confirmed'
          and checkout_session_id is not null
          and checkout_url is not null
          and expires_at = provider_request_expires_at)
        or (provider_effect_certainty = 'ambiguous'
          and checkout_session_id is null
          and checkout_url is null
          and expires_at is null)
      ))
    or (state = 'paid'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id is not null
      and checkout_url is not null
      and expires_at = provider_request_expires_at)
  ),
  check (provider_request_expires_at > created_at),
  check (provider_request_expires_at <= created_at + interval '24 hours'),
  check (expires_at is null or expires_at = provider_request_expires_at)
);

create unique index service_custom_build_final_checkout_one_active
on ss.service_custom_build_final_checkout_attempts(invoice_id)
where state in ('provider_pending', 'ready', 'persistence_unknown', 'paid');

create function ss.guard_service_custom_build_final_checkout_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  invoice_record record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build final Checkout history is append-only'
      using errcode = '55000';
  end if;

  perform ss.assert_service_custom_build_final_payment_lock(new.job_id);

  if tg_op = 'INSERT' then
    select invoice.* into invoice_record
    from ss.service_custom_build_final_invoices invoice
    join ss.service_custom_build_final_obligations obligation
      on obligation.organization_id = invoice.organization_id
     and obligation.id = invoice.obligation_id
    left join ss.service_custom_build_final_payment_receipts receipt
      on receipt.organization_id = invoice.organization_id
     and receipt.invoice_id = invoice.id
    where invoice.organization_id = new.organization_id
      and invoice.project_id = new.project_id
      and invoice.customer_user_id = new.customer_user_id
      and invoice.job_id = new.job_id
      and invoice.obligation_id = new.obligation_id
      and invoice.completion_package_id = new.completion_package_id
      and invoice.id = new.invoice_id
      and invoice.invoice_digest = new.invoice_digest
      and invoice.obligation_digest = new.obligation_digest
      and invoice.completion_package_digest =
        new.completion_package_digest
      and invoice.accepted_quote_digest = new.accepted_quote_digest
      and invoice.accepted_disclosure_digest =
        new.accepted_disclosure_digest
      and invoice.subtotal_minor = new.expected_subtotal_minor
      and obligation.final_due_minor = new.expected_subtotal_minor
      and obligation.credit_minor = 0
      and receipt.id is null;
    if not found
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or new.state <> 'provider_pending'
      or new.provider_effect_certainty <> 'ambiguous'
    then
      raise exception 'Custom build final Checkout lacks current invoice authority'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.job_id, new.obligation_id, new.completion_package_id,
    new.invoice_id, new.command_id, new.provider, new.purpose,
    new.purpose_digest, new.obligation_digest,
    new.completion_package_digest, new.invoice_digest,
    new.accepted_quote_digest, new.accepted_disclosure_digest,
    new.expected_subtotal_minor, new.currency, new.tax_mode,
    new.provider_request_expires_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.job_id, old.obligation_id, old.completion_package_id,
    old.invoice_id, old.command_id, old.provider, old.purpose,
    old.purpose_digest, old.obligation_digest,
    old.completion_package_digest, old.invoice_digest,
    old.accepted_quote_digest, old.accepted_disclosure_digest,
    old.expected_subtotal_minor, old.currency, old.tax_mode,
    old.provider_request_expires_at, old.created_at
  ) then
    raise exception 'Custom build final Checkout identity is immutable'
      using errcode = '55000';
  end if;

  if ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() is not distinct from
      old.organization_id
    and ss.current_service_actor_user_id() is not distinct from
      old.customer_user_id
    and (
      (old.state = 'provider_pending'
        and new.state in ('ready', 'failed', 'persistence_unknown'))
      or (old.state = 'ready' and new.state = 'expired')
    )
  then
    return new;
  end if;

  if ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from
      old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_payment_reconcile',
      clock_timestamp()
    )
    and exists (
      select 1
      from ss.service_custom_build_final_reconciliation_commands command
      where command.organization_id = old.organization_id
        and command.job_id = old.job_id
        and command.checkout_attempt_id = old.id
        and command.operator_user_id = ss.current_service_actor_user_id()
        and command.state = 'running'
    )
    and (
      (old.state in ('provider_pending', 'persistence_unknown')
        and new.state = 'ready')
      or (old.state = 'provider_pending'
        and new.state = 'persistence_unknown')
      or (old.state in ('provider_pending', 'persistence_unknown', 'ready')
        and new.state = 'expired')
    )
  then
    return new;
  end if;

  if ss.current_service_actor_kind() in ('system', 'operator')
    and ss.current_service_actor_org_id() is not distinct from
      old.organization_id
    and old.state = 'ready'
    and new.state = 'paid'
    and (
      ss.current_service_actor_kind() = 'system'
      or ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_payment_reconcile',
        clock_timestamp()
      )
    )
    and exists (
      select 1
      from ss.service_custom_build_final_payment_receipts receipt
      where receipt.organization_id = old.organization_id
        and receipt.checkout_attempt_id = old.id
        and receipt.invoice_id = old.invoice_id
    )
  then
    return new;
  end if;

  raise exception 'Custom build final Checkout transition lacks authority'
    using errcode = '42501';
end
$$;

create trigger service_custom_build_final_checkout_attempt_guard
before insert or update or delete
on ss.service_custom_build_final_checkout_attempts
for each row execute function
  ss.guard_service_custom_build_final_checkout_attempt();

create function ss.custom_build_final_reconciliation_request_digest(
  operator_user_id uuid,
  organization_id uuid,
  job_id uuid,
  checkout_attempt_id uuid,
  command_id text
)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(jsonb_build_object(
    'attemptId', checkout_attempt_id,
    'commandId', command_id,
    'jobId', job_id,
    'operatorId', operator_user_id,
    'organizationId', organization_id,
    'schema',
      'sitesourcery.custom-build-final-payment-reconciliation-command/v1'
  ))
$$;

create table ss.service_custom_build_final_reconciliation_commands (
  id uuid primary key,
  organization_id uuid not null,
  job_id uuid not null,
  checkout_attempt_id uuid not null,
  operator_user_id uuid not null references ss.operator_profiles(user_id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  request_digest ss.sha256_hex not null,
  state text not null check (state in ('running', 'completed')),
  result jsonb check (
    result is null
    or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 16384)
  ),
  result_digest ss.sha256_hex,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_final_checkout_attempts(
      organization_id, id
    ),
  unique (command_id),
  unique (organization_id, id),
  check (
    request_digest = ss.custom_build_final_reconciliation_request_digest(
      operator_user_id,
      organization_id,
      job_id,
      checkout_attempt_id,
      command_id
    )
  ),
  check (
    (state = 'running' and result is null
      and result_digest is null and completed_at is null)
    or (state = 'completed' and result is not null
      and result_digest = ss.service_json_digest(result)
      and completed_at is not null)
  )
);

create function ss.guard_service_custom_build_final_reconciliation_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build final reconciliation commands are append-only'
      using errcode = '55000';
  end if;

  perform ss.assert_service_custom_build_final_payment_lock(new.job_id);

  if ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
    or ss.current_service_actor_user_id() is distinct from new.operator_user_id
    or not ss.service_operator_has_capability(
      new.operator_user_id,
      'service_payment_reconcile',
      clock_timestamp()
    )
  then
    raise exception
      'Custom build final reconciliation command lacks operator authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'running'
      or new.result is not null
      or new.result_digest is not null
      or new.completed_at is not null
      or not exists (
        select 1
        from ss.service_custom_build_final_checkout_attempts attempt
        where attempt.organization_id = new.organization_id
          and attempt.job_id = new.job_id
          and attempt.id = new.checkout_attempt_id
      )
    then
      raise exception
        'Custom build final reconciliation command is invalid'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.job_id, new.checkout_attempt_id,
    new.operator_user_id, new.command_id, new.request_digest, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.job_id, old.checkout_attempt_id,
    old.operator_user_id, old.command_id, old.request_digest, old.created_at
  ) or old.state <> 'running' or new.state <> 'completed'
  then
    raise exception
      'Custom build final reconciliation command transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_final_reconciliation_command_guard
before insert or update or delete
on ss.service_custom_build_final_reconciliation_commands
for each row execute function
  ss.guard_service_custom_build_final_reconciliation_command();

create table ss.service_custom_build_final_stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  obligation_id uuid not null,
  completion_package_id uuid not null,
  invoice_id uuid not null,
  checkout_attempt_id uuid not null,
  event_type text not null check (event_type = 'checkout.session.completed'),
  livemode boolean not null,
  api_version text not null check (char_length(api_version) between 3 and 100),
  checkout_session_id text not null check (
    checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
  ),
  payload_digest ss.sha256_hex not null,
  provider_created_at timestamptz not null,
  signature_verified_at timestamptz not null,
  state text not null check (
    state in ('pending', 'processed', 'reconciliation_required')
  ),
  reconciliation_code text check (
    reconciliation_code is null
    or reconciliation_code ~ '^[A-Za-z0-9._:-]{1,200}$'
  ),
  result jsonb check (
    result is null
    or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 16384)
  ),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_final_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_final_checkout_attempts(
      organization_id, id
    ),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  check (signature_verified_at >= provider_created_at),
  check (
    (state = 'pending' and reconciliation_code is null
      and result is null and completed_at is null)
    or (state = 'processed' and reconciliation_code is null
      and result is not null and completed_at is not null)
    or (state = 'reconciliation_required' and reconciliation_code is not null
      and result is null and completed_at is not null)
  )
);

create function ss.guard_service_custom_build_final_stripe_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_org_id() is distinct from new.organization_id
    or (
      ss.current_service_actor_kind() <> 'system'
      and not (
        ss.current_service_actor_kind() = 'operator'
        and ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_payment_reconcile',
          clock_timestamp()
        )
      )
    )
  then
    raise exception
      'Custom build final Stripe event mutation lacks authority'
      using errcode = '42501';
  end if;

  perform ss.assert_service_custom_build_final_payment_lock(new.job_id);

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
      or new.result is not null
      or new.reconciliation_code is not null
      or new.completed_at is not null
      or not exists (
        select 1
        from ss.service_custom_build_final_checkout_attempts attempt
        join ss.service_custom_build_final_invoices invoice
          on invoice.organization_id = attempt.organization_id
         and invoice.id = attempt.invoice_id
        where attempt.organization_id = new.organization_id
          and attempt.project_id = new.project_id
          and attempt.customer_user_id = new.customer_user_id
          and attempt.job_id = new.job_id
          and attempt.obligation_id = new.obligation_id
          and attempt.completion_package_id = new.completion_package_id
          and attempt.invoice_id = new.invoice_id
          and attempt.id = new.checkout_attempt_id
          and attempt.state = 'ready'
          and attempt.checkout_session_id = new.checkout_session_id
          and invoice.obligation_id = new.obligation_id
          and invoice.completion_package_id = new.completion_package_id
      )
    then
      raise exception 'Custom build final Stripe event is not exact'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.job_id, new.obligation_id, new.completion_package_id,
    new.invoice_id, new.checkout_attempt_id, new.event_type, new.livemode,
    new.api_version, new.checkout_session_id, new.payload_digest,
    new.provider_created_at, new.signature_verified_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.job_id, old.obligation_id, old.completion_package_id,
    old.invoice_id, old.checkout_attempt_id, old.event_type, old.livemode,
    old.api_version, old.checkout_session_id, old.payload_digest,
    old.provider_created_at, old.signature_verified_at, old.created_at
  ) or not (
    (old.state = 'pending'
      and new.state in ('processed', 'reconciliation_required'))
    or (old.state = 'reconciliation_required'
      and new.state = 'processed'
      and ss.current_service_actor_kind() = 'operator')
  )
  then
    raise exception 'Custom build final Stripe event transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_final_stripe_event_guard
before insert or update on ss.service_custom_build_final_stripe_events
for each row execute function
  ss.guard_service_custom_build_final_stripe_event();

create trigger service_custom_build_final_stripe_event_no_delete
before delete on ss.service_custom_build_final_stripe_events
for each row execute function ss.reject_update();

create function ss.custom_build_final_provider_facts_digest(
  provider_facts jsonb
)
returns ss.sha256_hex
language sql
immutable
parallel safe
security definer
set search_path = pg_catalog, extensions, ss
as $$
  select encode(
    extensions.digest(
      convert_to(
        '{' || coalesce(string_agg(
          to_jsonb(fact.key)::text || ':' || fact.value::text,
          ',' order by fact.key
        ), '') || '}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )::ss.sha256_hex
  from jsonb_each(provider_facts - 'providerFactsDigest') fact
$$;

-- A Stripe Customer is global at the provider, but every final-payment
-- receipt must bind that provider identity to the same SiteSourcery
-- organization as the obligation. The historical single-column provider ID
-- uniqueness is retained; this composite key is the tenant-scoped reference
-- authority for v46 receipts.
alter table ss.stripe_customers
  add constraint stripe_customers_organization_stripe_customer_unique
  unique (organization_id, stripe_customer_id);

create table ss.service_custom_build_final_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  obligation_id uuid not null,
  completion_package_id uuid not null,
  invoice_id uuid not null,
  checkout_attempt_id uuid not null,
  receipt_source text not null check (
    receipt_source in ('stripe_event', 'provider_readback')
  ),
  stripe_event_id text,
  reconciled_by_operator_user_id uuid
    references ss.operator_profiles(user_id),
  provider text not null check (provider = 'stripe'),
  checkout_session_id text not null unique check (
    checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
  ),
  payment_intent_id text not null unique check (
    payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
  ),
  charge_id text not null unique check (
    charge_id ~ '^ch_[A-Za-z0-9_]+$'
  ),
  stripe_customer_id text not null
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  payment_status text not null check (payment_status = 'paid'),
  charge_captured boolean not null check (charge_captured),
  amount_refunded_minor bigint not null check (amount_refunded_minor = 0),
  disputed boolean not null check (not disputed),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  tax_minor bigint not null check (tax_minor between 0 and 99999999),
  total_minor bigint not null check (total_minor = subtotal_minor + tax_minor),
  tax_mode text not null check (tax_mode = 'automatic'),
  currency text not null check (currency = 'USD'),
  purpose text not null check (purpose = 'custom_build_final'),
  purpose_digest ss.sha256_hex not null,
  obligation_digest ss.sha256_hex not null,
  completion_package_digest ss.sha256_hex not null,
  invoice_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  provider_facts jsonb not null check (
    jsonb_typeof(provider_facts) = 'object'
    and pg_column_size(provider_facts) <= 16384
  ),
  provider_facts_digest ss.sha256_hex not null,
  provider_paid_at timestamptz not null,
  settled_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, job_id)
    references ss.service_custom_build_jobs(organization_id, id),
  foreign key (organization_id, obligation_id)
    references ss.service_custom_build_final_obligations(organization_id, id),
  foreign key (organization_id, completion_package_id)
    references ss.service_custom_build_completion_packages(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_final_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_final_checkout_attempts(
      organization_id, id
    ),
  foreign key (organization_id, stripe_event_id)
    references ss.service_custom_build_final_stripe_events(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  constraint service_custom_build_final_receipt_stripe_customer_org_fk
    foreign key (organization_id, stripe_customer_id)
    references ss.stripe_customers(
      organization_id, stripe_customer_id
    ),
  unique (organization_id, id),
  unique (job_id),
  unique (obligation_id),
  unique (completion_package_id),
  unique (invoice_id),
  unique (checkout_attempt_id),
  unique (stripe_event_id),
  check (settled_at >= provider_paid_at),
  check (
    (receipt_source = 'stripe_event' and stripe_event_id is not null
      and reconciled_by_operator_user_id is null)
    or (receipt_source = 'provider_readback'
      and stripe_event_id is null
      and reconciled_by_operator_user_id is not null)
  )
);

create function ss.guard_service_custom_build_final_payment_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_org_id() is distinct from new.organization_id
    or not (
      (ss.current_service_actor_kind() = 'system'
        and new.reconciled_by_operator_user_id is null
        and new.receipt_source = 'stripe_event')
      or (
        ss.current_service_actor_kind() = 'operator'
        and ss.current_service_actor_user_id() is not distinct from
          new.reconciled_by_operator_user_id
        and new.receipt_source = 'provider_readback'
        and ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_payment_reconcile',
          clock_timestamp()
        )
      )
    )
  then
    raise exception 'Custom build final receipt lacks payment authority'
      using errcode = '42501';
  end if;

  perform ss.assert_service_custom_build_final_payment_lock(new.job_id);

  if (
    select count(*)
    from jsonb_object_keys(new.provider_facts)
  ) <> 18
    or not new.provider_facts ?& array[
      'amountRefundedMinor',
      'chargeCaptured',
      'chargeId',
      'checkoutSessionId',
      'currency',
      'customerId',
      'disputed',
      'paymentIntentId',
      'paymentStatus',
      'provider',
      'providerFactsDigest',
      'providerPaymentTime',
      'purposeDigest',
      'schema',
      'subtotalMinor',
      'taxMinor',
      'taxMode',
      'totalMinor'
    ]
    or new.provider_facts ->> 'schema' <>
      'sitesourcery.stripe-custom-build-final-payment-facts/v1'
    or new.provider_facts ->> 'provider' <> new.provider
    or new.provider_facts ->> 'checkoutSessionId' <>
      new.checkout_session_id
    or new.provider_facts ->> 'paymentIntentId' <> new.payment_intent_id
    or new.provider_facts ->> 'chargeId' <> new.charge_id
    or new.provider_facts ->> 'customerId' <> new.stripe_customer_id
    or new.provider_facts ->> 'paymentStatus' <> new.payment_status
    or jsonb_typeof(new.provider_facts -> 'chargeCaptured') <> 'boolean'
    or (new.provider_facts ->> 'chargeCaptured')::boolean is distinct from
      new.charge_captured
    or jsonb_typeof(new.provider_facts -> 'amountRefundedMinor') <> 'number'
    or (new.provider_facts ->> 'amountRefundedMinor')::bigint <>
      new.amount_refunded_minor
    or jsonb_typeof(new.provider_facts -> 'disputed') <> 'boolean'
    or (new.provider_facts ->> 'disputed')::boolean is distinct from
      new.disputed
    or jsonb_typeof(new.provider_facts -> 'subtotalMinor') <> 'number'
    or (new.provider_facts ->> 'subtotalMinor')::bigint <>
      new.subtotal_minor
    or jsonb_typeof(new.provider_facts -> 'taxMinor') <> 'number'
    or (new.provider_facts ->> 'taxMinor')::bigint <> new.tax_minor
    or jsonb_typeof(new.provider_facts -> 'totalMinor') <> 'number'
    or (new.provider_facts ->> 'totalMinor')::bigint <> new.total_minor
    or new.provider_facts ->> 'taxMode' <> new.tax_mode
    or new.provider_facts ->> 'currency' <> new.currency
    or new.provider_facts ->> 'purposeDigest' <> new.purpose_digest
    or (new.provider_facts ->> 'providerPaymentTime')::timestamptz <>
      new.provider_paid_at
    or new.provider_facts ->> 'providerFactsDigest' <>
      new.provider_facts_digest
    or ss.custom_build_final_provider_facts_digest(new.provider_facts) <>
      new.provider_facts_digest
  then
    raise exception
      'Custom build final receipt provider facts are internally inconsistent'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.service_custom_build_final_obligations obligation
    join ss.service_custom_build_final_invoices invoice
      on invoice.organization_id = obligation.organization_id
     and invoice.obligation_id = obligation.id
    join ss.service_custom_build_final_invoice_lines line
      on line.organization_id = invoice.organization_id
     and line.invoice_id = invoice.id
    join ss.service_custom_build_final_checkout_attempts attempt
      on attempt.organization_id = invoice.organization_id
     and attempt.invoice_id = invoice.id
    left join ss.service_custom_build_final_stripe_events event
      on event.organization_id = invoice.organization_id
     and event.invoice_id = invoice.id
     and event.checkout_attempt_id = attempt.id
    where obligation.organization_id = new.organization_id
      and obligation.project_id = new.project_id
      and obligation.case_id = new.case_id
      and obligation.customer_user_id = new.customer_user_id
      and obligation.job_id = new.job_id
      and obligation.id = new.obligation_id
      and obligation.completion_package_id = new.completion_package_id
      and obligation.final_due_minor > 0
      and obligation.credit_minor = 0
      and invoice.id = new.invoice_id
      and invoice.subtotal_minor = obligation.final_due_minor
      and invoice.credit_minor = 0
      and invoice.invoice_digest = new.invoice_digest
      and invoice.obligation_digest = new.obligation_digest
      and invoice.completion_package_digest =
        new.completion_package_digest
      and invoice.accepted_quote_digest = new.accepted_quote_digest
      and invoice.accepted_disclosure_digest =
        new.accepted_disclosure_digest
      and line.line_number = 1
      and line.component_key = 'custom_build_final_installment'
      and line.amount_minor = obligation.final_due_minor
      and line.credit_minor = 0
      and attempt.id = new.checkout_attempt_id
      and attempt.state = 'ready'
      and attempt.checkout_session_id = new.checkout_session_id
      and attempt.expected_subtotal_minor = new.subtotal_minor
      and attempt.purpose_digest = new.purpose_digest
      and attempt.obligation_digest = new.obligation_digest
      and attempt.completion_package_digest =
        new.completion_package_digest
      and attempt.invoice_digest = new.invoice_digest
      and new.subtotal_minor = obligation.final_due_minor
      and new.currency = obligation.currency
      and (
        (new.receipt_source = 'stripe_event'
          and event.id = new.stripe_event_id
          and event.state in ('pending', 'reconciliation_required')
          and event.checkout_session_id = new.checkout_session_id)
        or (new.receipt_source = 'provider_readback'
          and new.stripe_event_id is null)
      )
  ) then
    raise exception
      'Custom build final receipt lacks exact provider-confirmed obligation'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_custom_build_final_payment_receipt_guard
before insert on ss.service_custom_build_final_payment_receipts
for each row execute function
  ss.guard_service_custom_build_final_payment_receipt();

create trigger service_custom_build_final_payment_receipt_immutable
before update or delete on ss.service_custom_build_final_payment_receipts
for each row execute function ss.reject_update();

create function ss.materialize_service_custom_build_final_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  changed_count integer;
begin
  update ss.service_custom_build_final_checkout_attempts
  set state = 'paid'
  where organization_id = new.organization_id
    and id = new.checkout_attempt_id
    and state = 'ready';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Custom build final payment could not seal Checkout'
      using errcode = '55000';
  end if;

  if new.stripe_event_id is not null then
    update ss.service_custom_build_final_stripe_events
    set
      state = 'processed',
      reconciliation_code = null,
      result = jsonb_build_object(
        'completionPackageId', new.completion_package_id,
        'invoiceId', new.invoice_id,
        'jobId', new.job_id,
        'next', 'custom_build_handoff',
        'receiptId', new.id,
        'schema', 'sitesourcery.custom-build-final-settlement/v1',
        'status', 'payment_settled'
      ),
      completed_at = new.settled_at
    where organization_id = new.organization_id
      and id = new.stripe_event_id
      and state in ('pending', 'reconciliation_required');
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise exception 'Custom build final payment could not seal Stripe event'
        using errcode = '55000';
    end if;
  end if;
  return new;
end
$$;

create trigger service_custom_build_final_payment_materialize
after insert on ss.service_custom_build_final_payment_receipts
for each row execute function
  ss.materialize_service_custom_build_final_payment();

create trigger service_custom_build_final_checkout_session_claim
after insert or update of checkout_session_id
on ss.service_custom_build_final_checkout_attempts
for each row execute function
  ss.claim_service_custom_build_checkout_session();

create trigger service_custom_build_final_stripe_event_claim
after insert on ss.service_custom_build_final_stripe_events
for each row execute function ss.claim_service_custom_build_stripe_event();

create trigger service_custom_build_final_payment_receipt_claim
after insert on ss.service_custom_build_final_payment_receipts
for each row execute function
  ss.claim_service_custom_build_payment_receipt();

create trigger service_custom_build_stripe_payment_claims_immutable
before update or delete on ss.service_custom_build_stripe_payment_claims
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_stripe_payment_claims',
    'service_custom_build_final_obligations',
    'service_custom_build_final_invoices',
    'service_custom_build_final_invoice_lines',
    'service_custom_build_final_zero_balance_clearances',
    'service_custom_build_final_checkout_attempts',
    'service_custom_build_final_reconciliation_commands',
    'service_custom_build_final_stripe_events',
    'service_custom_build_final_payment_receipts'
  ]
  loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format('grant select on table ss.%I to service_role', table_name);
  end loop;
end
$$;

grant insert, update on table
  ss.service_custom_build_final_checkout_attempts,
  ss.service_custom_build_final_reconciliation_commands,
  ss.service_custom_build_final_stripe_events
to service_role;

grant insert on table
  ss.service_custom_build_final_payment_receipts
to service_role;

do $$
declare
  function_signature text;
begin
  for function_signature in
    select procedure.oid::regprocedure::text
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'ss'
      and procedure.proname in (
        'claim_service_custom_build_stripe_payment_effect',
        'claim_service_custom_build_checkout_session',
        'claim_service_custom_build_stripe_event',
        'claim_service_custom_build_payment_receipt',
        'assert_service_custom_build_final_payment_lock',
        'custom_build_final_obligation_digest',
        'custom_build_final_invoice_digest',
        'custom_build_final_zero_clearance_digest',
        'ensure_service_custom_build_final_obligation',
        'materialize_service_custom_build_final_obligation',
        'guard_service_custom_build_final_checkout_attempt',
        'custom_build_final_reconciliation_request_digest',
        'guard_service_custom_build_final_reconciliation_command',
        'guard_service_custom_build_final_stripe_event',
        'custom_build_final_provider_facts_digest',
        'guard_service_custom_build_final_payment_receipt',
        'materialize_service_custom_build_final_payment'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end
$$;

-- Trigger-only materializers and the global claim writer are not API
-- authority, even for service_role.
revoke all on function
  ss.claim_service_custom_build_stripe_payment_effect(
    uuid, text, text, text, text, text, timestamptz
  )
from public, anon, authenticated, service_role;
revoke all on function ss.ensure_service_custom_build_final_obligation(uuid)
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_final_obligation()
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_final_payment()
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_stripe_payment_claims',
    'service_custom_build_final_obligations',
    'service_custom_build_final_invoices',
    'service_custom_build_final_invoice_lines',
    'service_custom_build_final_zero_balance_clearances',
    'service_custom_build_final_checkout_attempts',
    'service_custom_build_final_reconciliation_commands',
    'service_custom_build_final_stripe_events',
    'service_custom_build_final_payment_receipts'
  ]
  loop
    if has_table_privilege(
      'service_role', format('ss.%I', table_name), 'DELETE'
    ) or has_table_privilege(
      'service_role', format('ss.%I', table_name), 'TRUNCATE'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'authenticated', format('ss.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'SELECT'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'anon', format('ss.%I', table_name), 'UPDATE'
    ) then
      raise exception 'Custom build final-payment privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role', 'ss.service_custom_build_stripe_payment_claims', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_stripe_payment_claims', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_obligations', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_obligations', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_invoices', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_invoices', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_invoice_lines', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_invoice_lines', 'UPDATE'
  ) or has_table_privilege(
    'service_role',
    'ss.service_custom_build_final_zero_balance_clearances', 'INSERT'
  ) or has_table_privilege(
    'service_role',
    'ss.service_custom_build_final_zero_balance_clearances', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_final_payment_receipts', 'UPDATE'
  ) then
    raise exception 'Custom build final obligation evidence is not append-only'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v46()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v46-custom-build-final-payment'::text
$$;

revoke all on function ss.hosted_runtime_contract_v46()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v46()
to service_role;

commit;
