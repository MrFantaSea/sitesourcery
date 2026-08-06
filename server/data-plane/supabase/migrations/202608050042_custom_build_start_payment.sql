begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v41()') is null
    or to_regclass('ss.service_custom_build_quote_acceptances') is null
    or to_regclass('ss.service_credit_applications') is null
  then
    raise exception
      'Site Sourcery migration 041 must be applied before Custom build start payment'
      using errcode = '55000';
  end if;
end
$$;

-- One accepted Custom-build quote produces one exact first-installment invoice.
-- The seven-day payment window begins at acceptance. It bounds the credit
-- reservation without changing the accepted price or starting any work.
create function ss.custom_build_invoice_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  invoice_id uuid,
  invoice_number text,
  quote_id uuid,
  quote_revision_id uuid,
  quote_acceptance_id uuid,
  credit_application_id uuid,
  accepted_quote_digest ss.sha256_hex,
  accepted_disclosure_digest ss.sha256_hex,
  gross_start_minor bigint,
  credit_minor bigint,
  subtotal_minor bigint,
  final_due_minor bigint,
  currency text,
  tax_state text,
  issued_at timestamptz,
  payment_deadline timestamptz
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
    'creditApplicationId', credit_application_id,
    'creditMinor', credit_minor,
    'currency', currency,
    'customerUserId', customer_user_id,
    'finalDueMinor', final_due_minor,
    'grossStartMinor', gross_start_minor,
    'invoiceId', invoice_id,
    'invoiceNumber', invoice_number,
    'issuedAt', issued_at,
    'organizationId', organization_id,
    'paymentDeadline', payment_deadline,
    'projectId', project_id,
    'quoteAcceptanceId', quote_acceptance_id,
    'quoteId', quote_id,
    'quoteRevisionId', quote_revision_id,
    'schema', 'sitesourcery.custom-build-start-invoice/v1',
    'subtotalMinor', subtotal_minor,
    'taxState', tax_state
  ))
$$;

create table ss.service_custom_build_invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_number text generated always as (
    'SSCB-' || upper(replace(id::text, '-', ''))
  ) stored,
  purpose text not null check (purpose = 'custom_build_start'),
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  quote_revision_id uuid not null,
  quote_acceptance_id uuid not null,
  credit_application_id uuid not null,
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  tier_id text not null check (tier_id in (
    'card', 'card-plus', 'site', 'site-plus',
    'signature', 'flagship', 'scale'
  )),
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  gross_start_minor bigint not null check (gross_start_minor > 0),
  credit_minor bigint not null check (credit_minor = 20000),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  final_due_minor bigint not null check (final_due_minor >= 0),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'calculation_required'),
  tax_minor bigint check (tax_minor is null),
  total_minor bigint check (total_minor is null),
  state text not null check (state = 'tax_calculation_pending'),
  charge_occurred boolean not null check (charge_occurred = false),
  issued_at timestamptz not null,
  payment_deadline timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  invoice_digest ss.sha256_hex generated always as (
    ss.custom_build_invoice_digest(
      organization_id,
      project_id,
      customer_user_id,
      id,
      'SSCB-' || upper(replace(id::text, '-', '')),
      quote_id,
      quote_revision_id,
      quote_acceptance_id,
      credit_application_id,
      accepted_quote_digest,
      accepted_disclosure_digest,
      gross_start_minor,
      credit_minor,
      subtotal_minor,
      final_due_minor,
      currency,
      tax_state,
      issued_at,
      payment_deadline
    )
  ) stored,
  foreign key (organization_id, project_id, customer_user_id, case_id)
    references ss.service_cases(
      organization_id, project_id, customer_user_id, id
    ),
  foreign key (
    organization_id, quote_id, quote_revision, quote_revision_id
  ) references ss.service_custom_build_quote_revisions(
    organization_id, quote_id, quote_revision, id
  ),
  foreign key (organization_id, quote_acceptance_id)
    references ss.service_custom_build_quote_acceptances(organization_id, id),
  foreign key (organization_id, credit_application_id)
    references ss.service_credit_applications(organization_id, id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (invoice_number),
  unique (organization_id, id),
  unique (quote_acceptance_id),
  unique (credit_application_id),
  check (subtotal_minor = gross_start_minor - credit_minor),
  check (payment_deadline = issued_at + interval '7 days'),
  check (created_at >= issued_at)
);

create table ss.service_custom_build_invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  quote_installment_id uuid not null,
  line_number integer not null check (line_number in (1, 2)),
  component_key text not null check (
    component_key in ('custom_build_start', 'assessment_build_credit')
  ),
  display_name text not null check (
    char_length(display_name) between 3 and 120
  ),
  amount_minor bigint not null,
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null,
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_invoices(organization_id, id),
  foreign key (organization_id, quote_installment_id)
    references ss.service_custom_build_quote_installments(organization_id, id),
  unique (invoice_id, line_number),
  unique (organization_id, id),
  check (
    (line_number = 1 and component_key = 'custom_build_start' and amount_minor > 0)
    or
    (line_number = 2 and component_key = 'assessment_build_credit' and amount_minor = -20000)
  )
);

create function ss.ensure_service_custom_build_invoice(
  target_acceptance_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  accepted record;
  selected_invoice_id uuid;
begin
  select invoice.id into selected_invoice_id
  from ss.service_custom_build_invoices invoice
  where invoice.quote_acceptance_id = target_acceptance_id;
  if found then
    return selected_invoice_id;
  end if;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.case_id,
    acceptance.customer_user_id,
    acceptance.quote_id,
    acceptance.quote_revision,
    acceptance.quote_revision_id,
    acceptance.id as acceptance_id,
    acceptance.accepted_quote_digest,
    acceptance.accepted_disclosure_digest,
    acceptance.accepted_at,
    revision.policy_id,
    revision.scope_boundary_digest,
    revision.tier_id,
    revision.start_value_minor,
    revision.start_credit_minor,
    revision.start_due_minor,
    revision.final_due_minor,
    revision.currency,
    application.id as credit_application_id,
    installment.id as quote_installment_id
  into accepted
  from ss.service_custom_build_quote_acceptances acceptance
  join ss.service_custom_build_quotes quote
    on quote.organization_id = acceptance.organization_id
   and quote.id = acceptance.quote_id
  join ss.service_custom_build_quote_revisions revision
    on revision.organization_id = acceptance.organization_id
   and revision.quote_id = acceptance.quote_id
   and revision.quote_revision = acceptance.quote_revision
   and revision.id = acceptance.quote_revision_id
  join ss.service_credit_applications application
    on application.organization_id = acceptance.organization_id
   and application.quote_acceptance_id = acceptance.id
  join ss.service_custom_build_quote_installments installment
    on installment.organization_id = revision.organization_id
   and installment.quote_revision_id = revision.id
   and installment.installment_number = 1
  where acceptance.id = target_acceptance_id
    and quote.state = 'accepted'
    and application.state = 'reserved'
    and revision.start_due_minor > 0
    and installment.gross_value_minor = revision.start_value_minor
    and installment.credit_amount_minor = revision.start_credit_minor
    and installment.amount_due_minor = revision.start_due_minor;

  if not found then
    raise exception 'Custom build invoice requires one exact accepted first installment'
      using errcode = '55000';
  end if;

  insert into ss.service_custom_build_invoices (
    organization_id,
    project_id,
    case_id,
    customer_user_id,
    purpose,
    quote_id,
    quote_revision,
    quote_revision_id,
    quote_acceptance_id,
    credit_application_id,
    policy_id,
    scope_boundary_digest,
    tier_id,
    accepted_quote_digest,
    accepted_disclosure_digest,
    gross_start_minor,
    credit_minor,
    subtotal_minor,
    final_due_minor,
    currency,
    tax_state,
    state,
    charge_occurred,
    issued_at,
    payment_deadline,
    created_at
  ) values (
    accepted.organization_id,
    accepted.project_id,
    accepted.case_id,
    accepted.customer_user_id,
    'custom_build_start',
    accepted.quote_id,
    accepted.quote_revision,
    accepted.quote_revision_id,
    accepted.acceptance_id,
    accepted.credit_application_id,
    accepted.policy_id,
    accepted.scope_boundary_digest,
    accepted.tier_id,
    accepted.accepted_quote_digest,
    accepted.accepted_disclosure_digest,
    accepted.start_value_minor,
    accepted.start_credit_minor,
    accepted.start_due_minor,
    accepted.final_due_minor,
    accepted.currency,
    'calculation_required',
    'tax_calculation_pending',
    false,
    accepted.accepted_at,
    accepted.accepted_at + interval '7 days',
    clock_timestamp()
  ) returning id into selected_invoice_id;

  insert into ss.service_custom_build_invoice_lines (
    organization_id,
    invoice_id,
    quote_installment_id,
    line_number,
    component_key,
    display_name,
    amount_minor,
    currency,
    created_at
  ) values
  (
    accepted.organization_id,
    selected_invoice_id,
    accepted.quote_installment_id,
    1,
    'custom_build_start',
    ss.custom_build_tier_label(accepted.tier_id) || ' first installment',
    accepted.start_value_minor,
    'USD',
    accepted.accepted_at
  ),
  (
    accepted.organization_id,
    selected_invoice_id,
    accepted.quote_installment_id,
    2,
    'assessment_build_credit',
    'Website assessment build credit',
    -20000,
    'USD',
    accepted.accepted_at
  );

  return selected_invoice_id;
end
$$;

create function ss.materialize_service_custom_build_invoice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.ensure_service_custom_build_invoice(new.id);
  return new;
end
$$;

create trigger service_custom_build_quote_acceptances_payment_invoice
after insert on ss.service_custom_build_quote_acceptances
for each row execute function ss.materialize_service_custom_build_invoice();

do $$
declare
  acceptance record;
begin
  for acceptance in
    select id from ss.service_custom_build_quote_acceptances
  loop
    perform ss.ensure_service_custom_build_invoice(acceptance.id);
  end loop;
end
$$;

create trigger service_custom_build_invoices_immutable
before update or delete on ss.service_custom_build_invoices
for each row execute function ss.reject_update();

create trigger service_custom_build_invoice_lines_immutable
before update or delete on ss.service_custom_build_invoice_lines
for each row execute function ss.reject_update();

create table ss.service_custom_build_checkout_attempts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id !~ '[[:cntrl:]]'
  ),
  provider text not null check (provider = 'stripe'),
  purpose_digest ss.sha256_hex not null,
  invoice_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  expected_subtotal_minor bigint not null check (expected_subtotal_minor > 0),
  currency text not null check (currency = 'USD'),
  tax_mode text not null check (tax_mode = 'automatic'),
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
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_invoices(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (customer_user_id, command_id),
  unique (checkout_session_id),
  check (
    (state = 'provider_pending'
      and provider_effect_certainty = 'not_submitted'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is null)
    or (state = 'ready'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id is not null
      and checkout_url is not null
      and expires_at is not null
      and provider_error_code is null)
    or (state = 'failed'
      and provider_effect_certainty = 'not_submitted'
      and checkout_session_id is null
      and checkout_url is null
      and expires_at is null
      and provider_error_code is not null)
    or (state = 'persistence_unknown'
      and provider_effect_certainty = 'ambiguous'
      and provider_error_code is not null)
    or (state = 'expired'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id is not null
      and checkout_url is not null
      and expires_at is not null)
    or (state = 'paid'
      and provider_effect_certainty = 'confirmed'
      and checkout_session_id is not null
      and checkout_url is not null
      and expires_at is not null)
  )
);

create unique index service_custom_build_checkout_one_active
  on ss.service_custom_build_checkout_attempts(invoice_id)
  where state in ('provider_pending', 'ready', 'persistence_unknown', 'paid');

create function ss.guard_service_custom_build_checkout_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  invoice_record record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build Checkout history is append-only'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    select invoice.* into invoice_record
    from ss.service_custom_build_invoices invoice
    join ss.service_credit_applications application
      on application.organization_id = invoice.organization_id
     and application.id = invoice.credit_application_id
    join ss.service_custom_build_quotes quote
      on quote.organization_id = invoice.organization_id
     and quote.id = invoice.quote_id
    where invoice.organization_id = new.organization_id
      and invoice.id = new.invoice_id
      and invoice.project_id = new.project_id
      and invoice.customer_user_id = new.customer_user_id
      and invoice.invoice_digest = new.invoice_digest
      and invoice.accepted_quote_digest = new.accepted_quote_digest
      and invoice.accepted_disclosure_digest = new.accepted_disclosure_digest
      and invoice.subtotal_minor = new.expected_subtotal_minor
      and invoice.payment_deadline > clock_timestamp()
      and application.state = 'reserved'
      and quote.state = 'accepted';
    if not found
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or new.state <> 'provider_pending'
      or new.provider_effect_certainty <> 'not_submitted'
    then
      raise exception 'Custom build Checkout lacks current invoice authority'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.invoice_id, new.command_id, new.provider, new.purpose_digest,
    new.invoice_digest, new.accepted_quote_digest,
    new.accepted_disclosure_digest, new.expected_subtotal_minor,
    new.currency, new.tax_mode, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.invoice_id, old.command_id, old.provider, old.purpose_digest,
    old.invoice_digest, old.accepted_quote_digest,
    old.accepted_disclosure_digest, old.expected_subtotal_minor,
    old.currency, old.tax_mode, old.created_at
  ) then
    raise exception 'Custom build Checkout identity is immutable'
      using errcode = '55000';
  end if;

  if ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and ss.current_service_actor_user_id() is not distinct from old.customer_user_id
    and (
      (old.state = 'provider_pending'
        and new.state in ('ready', 'failed', 'persistence_unknown'))
      or (old.state = 'ready' and new.state = 'expired')
    )
  then
    return new;
  end if;

  if ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and old.state = 'ready'
    and new.state = 'paid'
  then
    return new;
  end if;

  raise exception 'Custom build Checkout transition lacks authority'
    using errcode = '42501';
end
$$;

create trigger service_custom_build_checkout_attempt_guard
before insert or update or delete on ss.service_custom_build_checkout_attempts
for each row execute function ss.guard_service_custom_build_checkout_attempt();

create table ss.service_custom_build_stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
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
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_checkout_attempts(organization_id, id),
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

create function ss.guard_service_custom_build_stripe_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'Custom build Stripe event mutation lacks system authority'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.result is not null
      or new.reconciliation_code is not null or new.completed_at is not null
    then
      raise exception 'Custom build Stripe event must begin pending'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.invoice_id, new.checkout_attempt_id, new.event_type, new.livemode,
    new.api_version, new.checkout_session_id, new.payload_digest,
    new.provider_created_at, new.signature_verified_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.invoice_id, old.checkout_attempt_id, old.event_type, old.livemode,
    old.api_version, old.checkout_session_id, old.payload_digest,
    old.provider_created_at, old.signature_verified_at, old.created_at
  ) or old.state <> 'pending'
    or new.state not in ('processed', 'reconciliation_required')
  then
    raise exception 'Custom build Stripe event transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_stripe_event_guard
before insert or update on ss.service_custom_build_stripe_events
for each row execute function ss.guard_service_custom_build_stripe_event();

create trigger service_custom_build_stripe_event_no_delete
before delete on ss.service_custom_build_stripe_events
for each row execute function ss.reject_update();

create table ss.service_custom_build_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  checkout_attempt_id uuid not null,
  stripe_event_id text not null,
  credit_application_id uuid not null,
  provider text not null check (provider = 'stripe'),
  checkout_session_id text not null unique check (
    checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
  ),
  payment_intent_id text not null unique check (
    payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
  ),
  stripe_customer_id text not null
    references ss.stripe_customers(stripe_customer_id)
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  payment_status text not null check (payment_status = 'paid'),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  tax_minor bigint not null check (tax_minor between 0 and 99999999),
  total_minor bigint not null check (total_minor = subtotal_minor + tax_minor),
  tax_mode text not null check (tax_mode = 'automatic'),
  currency text not null check (currency = 'USD'),
  purpose_digest ss.sha256_hex not null,
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
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_invoices(organization_id, id),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_checkout_attempts(organization_id, id),
  foreign key (organization_id, stripe_event_id)
    references ss.service_custom_build_stripe_events(organization_id, id),
  foreign key (organization_id, credit_application_id)
    references ss.service_credit_applications(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (invoice_id),
  unique (checkout_attempt_id),
  unique (stripe_event_id),
  unique (credit_application_id),
  check (settled_at >= provider_paid_at)
);

create table ss.service_custom_build_jobs (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  payment_receipt_id uuid not null,
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  quote_revision_id uuid not null,
  quote_acceptance_id uuid not null,
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  tier_id text not null check (tier_id in (
    'card', 'card-plus', 'site', 'site-plus',
    'signature', 'flagship', 'scale'
  )),
  scope_statement text not null check (
    char_length(scope_statement) between 20 and 2000
    and ss.service_text_excludes_credentials(scope_statement)
  ),
  crafted_pages integer not null check (crafted_pages between 1 and 30),
  sections integer not null check (sections between 1 and 120),
  unique_layouts integer not null check (unique_layouts between 1 and 30),
  content_words integer not null check (content_words between 0 and 14500),
  supplied_media integer not null check (supplied_media between 0 and 120),
  target_completion_date date not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  start_gross_minor bigint not null check (start_gross_minor > 0),
  start_credit_minor bigint not null check (start_credit_minor = 20000),
  start_paid_subtotal_minor bigint not null check (start_paid_subtotal_minor > 0),
  final_due_minor bigint not null check (final_due_minor >= 0),
  final_payment_state text not null check (
    final_payment_state in ('not_required', 'unpaid')
  ),
  currency text not null check (currency = 'USD'),
  purpose text not null check (purpose = 'custom_build'),
  state text not null check (state = 'open'),
  opened_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, case_id)
    references ss.service_cases(organization_id, project_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_invoices(organization_id, id),
  foreign key (organization_id, payment_receipt_id)
    references ss.service_custom_build_payment_receipts(organization_id, id),
  foreign key (
    organization_id, quote_id, quote_revision, quote_revision_id
  ) references ss.service_custom_build_quote_revisions(
    organization_id, quote_id, quote_revision, id
  ),
  foreign key (organization_id, quote_acceptance_id)
    references ss.service_custom_build_quote_acceptances(organization_id, id),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (invoice_id),
  unique (payment_receipt_id),
  unique (quote_acceptance_id),
  check (start_paid_subtotal_minor = start_gross_minor - start_credit_minor),
  check (
    (final_due_minor = 0 and final_payment_state = 'not_required')
    or (final_due_minor > 0 and final_payment_state = 'unpaid')
  ),
  check (created_at >= opened_at)
);

create function ss.guard_service_custom_build_settlement_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.current_service_actor_kind() <> 'system'
    or ss.current_service_actor_org_id() is distinct from new.organization_id
  then
    raise exception 'Custom build settlement mutation lacks system authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_custom_build_payment_receipt_guard
before insert on ss.service_custom_build_payment_receipts
for each row execute function ss.guard_service_custom_build_settlement_insert();

create trigger service_custom_build_payment_receipt_immutable
before update or delete on ss.service_custom_build_payment_receipts
for each row execute function ss.reject_update();

create trigger service_custom_build_job_guard
before insert on ss.service_custom_build_jobs
for each row execute function ss.guard_service_custom_build_settlement_insert();

create trigger service_custom_build_job_immutable
before update or delete on ss.service_custom_build_jobs
for each row execute function ss.reject_update();

-- Extend the v41 credit ledger with only two payment-evidence transitions.
create or replace function ss.guard_service_credit_application()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'service credit application history is append-only'
      using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'reserved'
      or new.reserved_at is null
      or new.settled_at is not null
      or new.released_at is not null
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or not exists (
        select 1
        from ss.service_custom_build_quote_acceptances acceptance
        join ss.service_custom_build_quote_revisions revision
          on revision.organization_id = acceptance.organization_id
         and revision.quote_id = acceptance.quote_id
         and revision.quote_revision = acceptance.quote_revision
         and revision.id = acceptance.quote_revision_id
        where acceptance.organization_id = new.organization_id
          and acceptance.id = new.quote_acceptance_id
          and acceptance.quote_id = new.quote_id
          and acceptance.customer_user_id = new.customer_user_id
          and revision.project_id = new.project_id
          and revision.credit_grant_id = new.credit_grant_id
          and revision.credit_digest = new.credit_digest
          and revision.credit_amount_minor = new.amount_minor
          and revision.currency = new.currency
      )
    then
      raise exception 'service credit reservation lacks exact acceptance evidence'
        using errcode = '42501';
    end if;
    new.created_at := new.reserved_at;
    new.updated_at := new.reserved_at;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.credit_grant_id, new.credit_digest, new.quote_id,
    new.quote_acceptance_id, new.amount_minor, new.currency,
    new.reserved_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.credit_grant_id, old.credit_digest, old.quote_id,
    old.quote_acceptance_id, old.amount_minor, old.currency,
    old.reserved_at, old.created_at
  ) or old.state <> 'reserved'
  then
    raise exception 'service credit application identity or source state changed'
      using errcode = '55000';
  end if;

  if new.state = 'released'
    and new.settled_at is null
    and new.released_at is not null
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', new.released_at
    )
    and exists (
      select 1 from ss.service_custom_build_quote_voids quote_void
      where quote_void.quote_id = old.quote_id
        and quote_void.organization_id = old.organization_id
        and quote_void.voided_at = new.released_at
    )
  then
    new.updated_at := new.released_at;
    return new;
  end if;

  if new.state = 'settled'
    and new.settled_at is not null
    and ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and exists (
      select 1
      from ss.service_custom_build_payment_receipts receipt
      where receipt.organization_id = old.organization_id
        and receipt.credit_application_id = old.id
        and receipt.settled_at = new.settled_at
    )
  then
    new.updated_at := new.settled_at;
    return new;
  end if;

  if new.state = 'reconciliation_required'
    and new.settled_at is null
    and ss.current_service_actor_kind() = 'system'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and exists (
      select 1
      from ss.service_custom_build_invoices invoice
      join ss.service_custom_build_stripe_events event
        on event.organization_id = invoice.organization_id
       and event.invoice_id = invoice.id
      where invoice.organization_id = old.organization_id
        and invoice.credit_application_id = old.id
        and event.state = 'reconciliation_required'
    )
  then
    new.updated_at := clock_timestamp();
    return new;
  end if;

  raise exception 'service credit application transition lacks exact evidence'
    using errcode = '55000';
end
$$;

-- Once Checkout may have been created, an operator cannot release the credit
-- until every retained attempt is definitely failed or provider-confirmed
-- expired. Paid or uncertain attempts always block voiding.
create or replace function ss.prepare_service_custom_build_quote_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
  application_record record;
  recorded_at timestamptz := clock_timestamp();
begin
  select quote.* into quote_record
  from ss.service_custom_build_quotes quote
  where quote.id = new.quote_id
  for update;

  if not found
    or quote_record.state not in ('issued', 'accepted')
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from quote_record.organization_id
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(), 'service_quote_author', recorded_at
    )
  then
    raise exception 'custom build quote void lacks operator authority'
      using errcode = '42501';
  end if;

  select application.* into application_record
  from ss.service_credit_applications application
  where application.quote_id = quote_record.id
  for update;

  if found and application_record.state <> 'reserved' then
    raise exception 'custom build quote cannot release a consumed or uncertain credit'
      using errcode = '55000';
  end if;
  if quote_record.state = 'accepted' and application_record.id is null then
    raise exception 'accepted custom build quote lacks its credit reservation'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from ss.service_custom_build_invoices invoice
    join ss.service_custom_build_checkout_attempts attempt
      on attempt.organization_id = invoice.organization_id
     and attempt.invoice_id = invoice.id
    where invoice.organization_id = quote_record.organization_id
      and invoice.quote_id = quote_record.id
      and attempt.state not in ('failed', 'expired')
  ) or exists (
    select 1 from ss.service_custom_build_payment_receipts receipt
    join ss.service_custom_build_invoices invoice
      on invoice.organization_id = receipt.organization_id
     and invoice.id = receipt.invoice_id
    where invoice.organization_id = quote_record.organization_id
      and invoice.quote_id = quote_record.id
  ) then
    raise exception 'custom build quote has unresolved or settled payment evidence'
      using errcode = '55000';
  end if;

  new.organization_id := quote_record.organization_id;
  new.operator_user_id := ss.current_service_actor_user_id();
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'commandId', new.command_id,
    'operatorUserId', new.operator_user_id,
    'organizationId', new.organization_id,
    'quoteId', quote_record.id,
    'reason', new.reason,
    'schema', 'sitesourcery.custom-build-quote-void-command/v1'
  ));
  new.voided_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_invoices',
    'service_custom_build_invoice_lines',
    'service_custom_build_checkout_attempts',
    'service_custom_build_stripe_events',
    'service_custom_build_payment_receipts',
    'service_custom_build_jobs'
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

grant update on table
  ss.service_custom_build_checkout_attempts,
  ss.service_custom_build_stripe_events,
  ss.service_credit_applications
to service_role;

grant insert on table
  ss.service_custom_build_checkout_attempts,
  ss.service_custom_build_stripe_events,
  ss.service_custom_build_payment_receipts,
  ss.service_custom_build_jobs
to service_role;

do $$
declare
  function_signature text;
  function_names text[] := array[
    'custom_build_invoice_digest',
    'ensure_service_custom_build_invoice',
    'materialize_service_custom_build_invoice',
    'guard_service_custom_build_checkout_attempt',
    'guard_service_custom_build_stripe_event',
    'guard_service_custom_build_settlement_insert'
  ];
begin
  for function_signature in
    select procedure.oid::regprocedure::text
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'ss'
      and procedure.proname = any(function_names)
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end
$$;

revoke all on function ss.materialize_service_custom_build_invoice()
from public, anon, authenticated, service_role;
revoke all on function ss.ensure_service_custom_build_invoice(uuid)
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_invoices',
    'service_custom_build_invoice_lines',
    'service_custom_build_checkout_attempts',
    'service_custom_build_stripe_events',
    'service_custom_build_payment_receipts',
    'service_custom_build_jobs'
  ]
  loop
    if has_table_privilege('service_role', format('ss.%I', table_name), 'DELETE')
      or has_table_privilege('service_role', format('ss.%I', table_name), 'TRUNCATE')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('authenticated', format('ss.%I', table_name), 'INSERT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'SELECT')
      or has_table_privilege('anon', format('ss.%I', table_name), 'INSERT')
    then
      raise exception 'Custom build payment privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role', 'ss.service_custom_build_invoices', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_invoice_lines', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_payment_receipts', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_jobs', 'UPDATE'
  ) then
    raise exception 'Custom build immutable payment evidence is writable'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v42()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v42-custom-build-start-payment'::text
$$;

revoke all on function ss.hosted_runtime_contract_v42()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v42()
to service_role;

commit;
