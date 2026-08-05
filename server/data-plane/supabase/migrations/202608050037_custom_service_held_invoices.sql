begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v36()') is null
    or to_regclass('ss.service_quote_acceptances') is null
    or to_regclass('ss.service_quote_installments') is null
  then
    raise exception
      'Site Sourcery migration 036 must be applied before held custom-service invoices'
      using errcode = '55000';
  end if;
end
$$;

-- This is intentionally a held invoice slice. It records the exact accepted
-- assessment installment, but tax, total, Checkout, and every provider effect
-- remain unavailable until a later reviewed migration supplies those facts.
create function ss.service_invoice_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  invoice_id uuid,
  invoice_number text,
  quote_id uuid,
  quote_revision bigint,
  quote_revision_id uuid,
  quote_acceptance_id uuid,
  quote_installment_id uuid,
  accepted_quote_digest ss.sha256_hex,
  accepted_disclosure_digest ss.sha256_hex,
  legal_document_id uuid,
  subtotal_minor bigint,
  tax_state text,
  tax_minor bigint,
  total_minor bigint,
  currency text,
  invoice_state text,
  payable boolean,
  charge_occurred boolean,
  issued_at timestamptz
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(
    jsonb_build_object(
      'acceptedDisclosureDigest', accepted_disclosure_digest,
      'acceptedQuoteDigest', accepted_quote_digest,
      'chargeOccurred', charge_occurred,
      'currency', currency,
      'customerUserId', customer_user_id,
      'invoiceId', invoice_id,
      'invoiceNumber', invoice_number,
      'invoiceState', invoice_state,
      'issuedAt', issued_at,
      'legalDocumentId', legal_document_id,
      'organizationId', organization_id,
      'payable', payable,
      'projectId', project_id,
      'quoteAcceptanceId', quote_acceptance_id,
      'quoteId', quote_id,
      'quoteInstallmentId', quote_installment_id,
      'quoteRevision', quote_revision,
      'quoteRevisionId', quote_revision_id,
      'schema', 'sitesourcery.service-assessment-invoice.v1',
      'subtotalMinor', subtotal_minor,
      'taxMinor', tax_minor,
      'taxState', tax_state,
      'totalMinor', total_minor
    )
  )
$$;

create table ss.service_invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  purpose text not null check (purpose = 'assessment'),
  invoice_number text generated always as (
    'SSA-' || upper(replace(id::text, '-', ''))
  ) stored,
  quote_id uuid not null,
  quote_revision bigint not null check (quote_revision > 0),
  quote_revision_id uuid not null,
  quote_acceptance_id uuid not null,
  quote_installment_id uuid not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  installment_number integer not null check (installment_number = 1),
  subtotal_minor bigint not null check (subtotal_minor = 20000),
  tax_state text not null check (tax_state = 'calculation_required'),
  tax_minor bigint check (tax_minor is null),
  total_minor bigint check (total_minor is null),
  currency text not null check (currency = 'USD'),
  state text not null check (state = 'tax_calculation_pending'),
  payable boolean not null check (payable = false),
  charge_occurred boolean not null check (charge_occurred = false),
  due_at timestamptz check (due_at is null),
  issued_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  invoice_digest ss.sha256_hex generated always as (
    ss.service_invoice_digest(
      organization_id,
      project_id,
      customer_user_id,
      id,
      'SSA-' || upper(replace(id::text, '-', '')),
      quote_id,
      quote_revision,
      quote_revision_id,
      quote_acceptance_id,
      quote_installment_id,
      accepted_quote_digest,
      accepted_disclosure_digest,
      legal_document_id,
      subtotal_minor,
      tax_state,
      tax_minor,
      total_minor,
      currency,
      state,
      payable,
      charge_occurred,
      issued_at
    )
  ) stored,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.service_quotes(organization_id, id),
  foreign key (
    organization_id,
    quote_id,
    quote_revision,
    quote_revision_id
  ) references ss.service_quote_revisions(
    organization_id,
    quote_id,
    quote_revision,
    id
  ),
  foreign key (organization_id, quote_acceptance_id)
    references ss.service_quote_acceptances(organization_id, id),
  foreign key (organization_id, quote_installment_id)
    references ss.service_quote_installments(organization_id, id),
  unique (invoice_number),
  unique (organization_id, id),
  unique (quote_acceptance_id),
  unique (quote_installment_id),
  check (created_at >= issued_at)
);

create table ss.service_invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  quote_revision_id uuid not null,
  quote_line_id uuid not null,
  line_number integer not null check (line_number = 1),
  component_key text not null
    check (component_key = 'website_assessment_standard'),
  display_name text not null check (display_name = 'Website assessment'),
  quantity integer not null check (quantity = 1),
  unit_label text not null check (unit_label = 'assessment'),
  unit_amount_minor bigint not null check (unit_amount_minor = 20000),
  subtotal_minor bigint not null check (subtotal_minor = 20000),
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null,
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  foreign key (
    organization_id,
    quote_revision_id,
    quote_line_id
  ) references ss.service_quote_lines(
    organization_id,
    quote_revision_id,
    id
  ),
  unique (organization_id, id),
  unique (invoice_id, line_number),
  unique (quote_line_id),
  check (subtotal_minor = quantity * unit_amount_minor)
);

create function ss.service_payment_reservation_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  invoice_id uuid,
  purpose text,
  provider text,
  reservation_state text,
  hold_reason text,
  dispatch_authorized boolean,
  provider_effect_certainty text,
  expected_subtotal_minor bigint,
  expected_tax_minor bigint,
  expected_total_minor bigint,
  currency text,
  invoice_digest ss.sha256_hex,
  accepted_disclosure_digest ss.sha256_hex
)
returns ss.sha256_hex
language sql
immutable
parallel safe
set search_path = pg_catalog, ss
as $$
  select ss.service_json_digest(
    jsonb_build_object(
      'acceptedDisclosureDigest', accepted_disclosure_digest,
      'currency', currency,
      'customerUserId', customer_user_id,
      'dispatchAuthorized', dispatch_authorized,
      'expectedSubtotalMinor', expected_subtotal_minor,
      'expectedTaxMinor', expected_tax_minor,
      'expectedTotalMinor', expected_total_minor,
      'holdReason', hold_reason,
      'invoiceDigest', invoice_digest,
      'invoiceId', invoice_id,
      'organizationId', organization_id,
      'projectId', project_id,
      'provider', provider,
      'providerEffectCertainty', provider_effect_certainty,
      'purpose', purpose,
      'schema', 'sitesourcery.service-payment-reservation.v1',
      'state', reservation_state
    )
  )
$$;

create table ss.service_payment_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  invoice_id uuid not null,
  purpose text not null check (purpose = 'assessment_invoice'),
  provider text not null check (provider = 'stripe'),
  state text not null check (state = 'held'),
  hold_reason text not null check (hold_reason = 'tax_calculation_required'),
  dispatch_authorized boolean not null check (dispatch_authorized = false),
  provider_effect_certainty text not null
    check (provider_effect_certainty = 'not_submitted'),
  expected_subtotal_minor bigint not null
    check (expected_subtotal_minor = 20000),
  expected_tax_minor bigint check (expected_tax_minor is null),
  expected_total_minor bigint check (expected_total_minor is null),
  currency text not null check (currency = 'USD'),
  invoice_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  purpose_digest ss.sha256_hex generated always as (
    ss.service_payment_reservation_digest(
      organization_id,
      project_id,
      customer_user_id,
      invoice_id,
      purpose,
      provider,
      state,
      hold_reason,
      dispatch_authorized,
      provider_effect_certainty,
      expected_subtotal_minor,
      expected_tax_minor,
      expected_total_minor,
      currency,
      invoice_digest,
      accepted_disclosure_digest
    )
  ) stored,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, invoice_id)
    references ss.service_invoices(organization_id, id),
  unique (organization_id, id),
  unique (invoice_id)
);

create function ss.ensure_service_assessment_invoice(
  target_acceptance_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, ss
as $$
declare
  accepted record;
  invoice_id uuid;
  invoice_digest ss.sha256_hex;
  invoice_created_at timestamptz;
begin
  select invoice.id into invoice_id
    from ss.service_invoices invoice
   where invoice.quote_acceptance_id = target_acceptance_id;
  if found then
    return invoice_id;
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
    acceptance.legal_document_id,
    acceptance.accepted_at,
    installment.id as installment_id,
    installment.installment_number,
    installment.amount_minor,
    installment.currency,
    quote_line.id as quote_line_id,
    quote_line.line_number,
    quote_line.component_key,
    quote_line.display_name,
    quote_line.quantity,
    quote_line.unit_label,
    quote_line.unit_amount_minor,
    quote_line.customer_amount_minor
  into accepted
    from ss.service_quote_acceptances acceptance
    join ss.service_quotes quote
      on quote.organization_id = acceptance.organization_id
     and quote.id = acceptance.quote_id
     and quote.purpose = 'assessment'
    join ss.service_quote_revisions revision
      on revision.organization_id = acceptance.organization_id
     and revision.quote_id = acceptance.quote_id
     and revision.quote_revision = acceptance.quote_revision
     and revision.id = acceptance.quote_revision_id
     and revision.quote_digest = acceptance.accepted_quote_digest
     and revision.disclosure_digest = acceptance.accepted_disclosure_digest
     and revision.legal_document_id = acceptance.legal_document_id
     and revision.service_amount_minor = 20000
     and revision.subtotal_minor = 20000
     and revision.currency = 'USD'
     and revision.tax_state = 'calculation_required'
     and revision.payment_schedule = 'full_before_work'
    join ss.service_quote_installments installment
      on installment.organization_id = acceptance.organization_id
     and installment.quote_revision_id = revision.id
     and installment.installment_number = 1
     and installment.installment_kind = 'full'
     and installment.amount_minor = 20000
     and installment.currency = 'USD'
     and installment.due_trigger = 'before_work'
    join ss.service_quote_lines quote_line
      on quote_line.organization_id = acceptance.organization_id
     and quote_line.quote_revision_id = revision.id
     and quote_line.line_number = 1
     and quote_line.component_key = 'website_assessment_standard'
     and quote_line.display_name = 'Website assessment'
     and quote_line.quantity = 1
     and quote_line.unit_label = 'assessment'
     and quote_line.unit_amount_minor = 20000
     and quote_line.customer_amount_minor = 20000
   where acceptance.id = target_acceptance_id
   for update of acceptance;

  if not found then
    raise exception
      'held assessment invoice requires one exact accepted quote installment'
      using errcode = '23514';
  end if;

  invoice_id := extensions.gen_random_uuid();
  insert into ss.service_invoices (
    id, organization_id, project_id, case_id, customer_user_id,
    purpose, quote_id, quote_revision, quote_revision_id,
    quote_acceptance_id, quote_installment_id, accepted_quote_digest,
    accepted_disclosure_digest, legal_document_id, installment_number,
    subtotal_minor, tax_state, tax_minor, total_minor, currency, state,
    payable, charge_occurred, due_at, issued_at, created_at
  ) values (
    invoice_id, accepted.organization_id, accepted.project_id,
    accepted.case_id, accepted.customer_user_id, 'assessment',
    accepted.quote_id, accepted.quote_revision,
    accepted.quote_revision_id, accepted.acceptance_id,
    accepted.installment_id, accepted.accepted_quote_digest,
    accepted.accepted_disclosure_digest, accepted.legal_document_id,
    accepted.installment_number, accepted.amount_minor,
    'calculation_required', null, null, accepted.currency,
    'tax_calculation_pending', false, false, null,
    accepted.accepted_at, clock_timestamp()
  )
  returning service_invoices.invoice_digest,
            service_invoices.created_at
       into invoice_digest, invoice_created_at;

  insert into ss.service_invoice_lines (
    organization_id, invoice_id, quote_revision_id, quote_line_id,
    line_number, component_key, display_name, quantity, unit_label,
    unit_amount_minor, subtotal_minor, currency, created_at
  ) values (
    accepted.organization_id, invoice_id, accepted.quote_revision_id,
    accepted.quote_line_id, accepted.line_number, accepted.component_key,
    accepted.display_name, accepted.quantity, accepted.unit_label,
    accepted.unit_amount_minor, accepted.customer_amount_minor,
    accepted.currency, invoice_created_at
  );

  insert into ss.service_payment_reservations (
    organization_id, project_id, customer_user_id, invoice_id,
    purpose, provider, state, hold_reason, dispatch_authorized,
    provider_effect_certainty, expected_subtotal_minor,
    expected_tax_minor, expected_total_minor, currency,
    invoice_digest, accepted_disclosure_digest, created_at
  ) values (
    accepted.organization_id, accepted.project_id,
    accepted.customer_user_id, invoice_id, 'assessment_invoice',
    'stripe', 'held', 'tax_calculation_required', false,
    'not_submitted', accepted.amount_minor, null, null,
    accepted.currency, invoice_digest,
    accepted.accepted_disclosure_digest, invoice_created_at
  );

  return invoice_id;
end
$$;

create function ss.materialize_service_assessment_invoice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.ensure_service_assessment_invoice(new.id);
  return new;
end
$$;

create trigger service_quote_acceptances_materialize_invoice
after insert on ss.service_quote_acceptances
for each row execute function ss.materialize_service_assessment_invoice();

-- Preserve an exact invoice for any accepted quote that predates this additive
-- migration. The helper serializes and is idempotent.
do $$
declare
  acceptance record;
begin
  for acceptance in
    select id from ss.service_quote_acceptances order by created_at, id
  loop
    perform ss.ensure_service_assessment_invoice(acceptance.id);
  end loop;
end
$$;

create trigger service_invoices_immutable
before update or delete on ss.service_invoices
for each row execute function ss.reject_update();

create trigger service_invoice_lines_immutable
before update or delete on ss.service_invoice_lines
for each row execute function ss.reject_update();

create trigger service_payment_reservations_immutable
before update or delete on ss.service_payment_reservations
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_invoices',
    'service_invoice_lines',
    'service_payment_reservations'
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
         'service_invoice_digest',
         'service_payment_reservation_digest',
         'ensure_service_assessment_invoice',
         'materialize_service_assessment_invoice'
       )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
  end loop;
end
$$;

grant execute on function ss.service_invoice_digest(
  uuid, uuid, uuid, uuid, text, uuid, bigint, uuid, uuid, uuid,
  ss.sha256_hex, ss.sha256_hex, uuid, bigint, text, bigint, bigint,
  text, text, boolean, boolean, timestamptz
) to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_invoices',
    'service_invoice_lines',
    'service_payment_reservations'
  ]
  loop
    if has_table_privilege(
      'service_role', format('ss.%I', table_name), 'INSERT'
    ) or has_table_privilege(
      'service_role', format('ss.%I', table_name), 'UPDATE'
    ) or has_table_privilege(
      'service_role', format('ss.%I', table_name), 'DELETE'
    ) or has_table_privilege(
      'service_role', format('ss.%I', table_name), 'TRUNCATE'
    ) then
      raise exception 'held invoice table has unsafe mutation privilege: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_function_privilege(
    'service_role',
    'ss.ensure_service_assessment_invoice(uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'ss.materialize_service_assessment_invoice()',
    'EXECUTE'
  ) then
    raise exception 'held invoice materialization is directly callable'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v37()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v37-custom-service-held-invoices'::text
$$;

revoke all on function ss.hosted_runtime_contract_v37()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v37()
to authenticated, service_role;

commit;
