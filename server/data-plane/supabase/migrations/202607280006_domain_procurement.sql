begin;

create table ss.domain_procurement_control (
  singleton boolean primary key default true check (singleton),
  purchasing_enabled boolean not null default false,
  live_mode boolean not null default false,
  active_provider_code text check (
    active_provider_code is null
    or char_length(active_provider_code) between 2 and 80
  ),
  agent_legal_document_id uuid references ss.legal_documents(id),
  renewal_legal_document_id uuid references ss.legal_documents(id),
  enabled_at timestamptz,
  enabled_by_user_id uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    not purchasing_enabled
    or (
      active_provider_code is not null
      and agent_legal_document_id is not null
      and renewal_legal_document_id is not null
      and enabled_at is not null
      and enabled_by_user_id is not null
    )
  )
);

insert into ss.domain_procurement_control (
  singleton,
  purchasing_enabled,
  live_mode
) values (
  true,
  false,
  false
);

create table ss.domain_quotes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  provider_code text not null,
  provider_quote_ref text not null,
  quote_kind text not null check (quote_kind in ('registration', 'renewal')),
  domain_name ss.canonical_hostname not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  customer_price_minor bigint not null check (customer_price_minor >= 0),
  registrar_cost_minor bigint not null check (registrar_cost_minor >= 0),
  renewal_price_minor bigint not null check (renewal_price_minor >= 0),
  term_years integer not null check (term_years between 1 and 10),
  renewal_disclosure text not null check (char_length(renewal_disclosure) >= 20),
  renewal_disclosure_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null,
  provider_receipt_id uuid not null,
  quoted_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'open' check (status = 'open'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (provider_code, provider_quote_ref),
  unique (organization_id, id),
  check (expires_at > quoted_at)
);

create table ss.domain_registrant_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references auth.users(id),
  schema_version text not null,
  encryption_algorithm text not null check (char_length(encryption_algorithm) >= 5),
  encryption_key_version text not null check (char_length(encryption_key_version) >= 3),
  contact_ciphertext bytea not null,
  contact_digest ss.sha256_hex not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  customer_is_registrant boolean not null default true check (customer_is_registrant),
  captured_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id)
);

create table ss.domain_agent_consents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  registrant_snapshot_id uuid not null,
  legal_document_id uuid not null references ss.legal_documents(id),
  term_acceptance_id uuid not null,
  agent_role text not null check (agent_role = 'authorized_registration_agent'),
  customer_remains_registrant boolean not null check (customer_remains_registrant),
  authorization_statement_digest ss.sha256_hex not null,
  irreversible_disclosure_digest ss.sha256_hex not null,
  ip_address inet,
  user_agent_digest ss.sha256_hex,
  request_id uuid not null,
  consented_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.domain_quotes(organization_id, id),
  foreign key (organization_id, registrant_snapshot_id)
    references ss.domain_registrant_snapshots(organization_id, id),
  foreign key (organization_id, term_acceptance_id)
    references ss.term_acceptances(organization_id, id),
  unique (quote_id, user_id, request_id),
  unique (organization_id, id)
);

create table ss.domain_payment_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  quote_id uuid not null,
  stripe_provider_receipt_id uuid not null,
  stripe_payment_reference text not null unique,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  state text not null check (state = 'captured'),
  recorded_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.domain_quotes(organization_id, id),
  foreign key (organization_id, stripe_provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (organization_id, id)
);

create table ss.domain_registration_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  quote_id uuid not null,
  registrant_snapshot_id uuid not null,
  agent_consent_id uuid not null,
  payment_allocation_id uuid not null,
  domain_name ss.canonical_hostname not null,
  provider_code text not null,
  state text not null check (
    state in (
      'awaiting_confirmation',
      'confirmed',
      'submitted',
      'processing',
      'registered',
      'failed',
      'manual_review',
      'cancelled'
    )
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  irreversible_confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  failure_code text,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.domain_quotes(organization_id, id),
  foreign key (organization_id, registrant_snapshot_id)
    references ss.domain_registrant_snapshots(organization_id, id),
  foreign key (organization_id, agent_consent_id)
    references ss.domain_agent_consents(organization_id, id),
  foreign key (organization_id, payment_allocation_id)
    references ss.domain_payment_allocations(organization_id, id),
  unique (organization_id, idempotency_key),
  unique (quote_id),
  unique (agent_consent_id),
  unique (payment_allocation_id),
  unique (organization_id, id),
  check (
    state in ('awaiting_confirmation', 'cancelled')
    or (
      irreversible_confirmed_at is not null
      and confirmed_by_user_id is not null
    )
  )
);

create table ss.domain_irreversible_confirmations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_intent_id uuid not null,
  confirmed_by_user_id uuid not null references auth.users(id),
  confirmation_statement_version text not null,
  confirmation_evidence_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null,
  confirmed_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_intent_id)
    references ss.domain_registration_intents(organization_id, id),
  unique (registration_intent_id),
  unique (organization_id, id)
);

create table ss.domain_provider_operations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  subject_kind text not null
    check (subject_kind in ('registration', 'renewal', 'transfer_out', 'dns')),
  subject_id uuid not null,
  operation_kind text not null check (
    operation_kind in (
      'availability_check',
      'register',
      'configure_dns',
      'renew',
      'unlock',
      'request_auth_code',
      'transfer_out'
    )
  ),
  provider_code text not null,
  external_operation_ref text,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  state text not null check (
    state in ('queued', 'submitted', 'processing', 'succeeded', 'failed', 'manual_review')
  ),
  provider_receipt_id uuid,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  requested_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  failure_code text,
  failure_detail_ciphertext bytea,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (provider_code, external_operation_ref),
  unique (subject_kind, subject_id, operation_kind, idempotency_key),
  unique (organization_id, id)
);

create table ss.domain_provider_operation_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  operation_id uuid not null,
  state text not null check (
    state in ('queued', 'submitted', 'processing', 'succeeded', 'failed', 'manual_review')
  ),
  provider_receipt_id uuid,
  failure_code text,
  occurred_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, operation_id)
    references ss.domain_provider_operations(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (organization_id, id)
);

create table ss.domain_registrar_debits (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  operation_id uuid not null,
  registrar_provider_receipt_id uuid not null,
  registrar_debit_reference text not null unique,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  debited_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, operation_id)
    references ss.domain_provider_operations(organization_id, id),
  foreign key (organization_id, registrar_provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (organization_id, id)
);

create table ss.domain_registrations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_intent_id uuid not null,
  provider_operation_id uuid not null,
  registrant_snapshot_id uuid not null,
  provider_code text not null,
  provider_domain_ref text not null,
  domain_name ss.canonical_hostname not null unique,
  state text not null check (
    state in (
      'active',
      'renewal_due',
      'expired',
      'transfer_pending',
      'transferred_out',
      'failed',
      'manual_review'
    )
  ),
  customer_is_registrant boolean not null check (customer_is_registrant),
  site_sourcery_role text not null check (site_sourcery_role = 'authorized_agent'),
  auto_renew boolean not null default false,
  registered_at timestamptz not null,
  expires_at timestamptz not null,
  current_provider_receipt_id uuid not null,
  renewal_disclosure_digest ss.sha256_hex not null,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_intent_id)
    references ss.domain_registration_intents(organization_id, id),
  foreign key (organization_id, provider_operation_id)
    references ss.domain_provider_operations(organization_id, id),
  foreign key (organization_id, registrant_snapshot_id)
    references ss.domain_registrant_snapshots(organization_id, id),
  foreign key (organization_id, current_provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (provider_code, provider_domain_ref),
  unique (registration_intent_id),
  unique (organization_id, id),
  check (expires_at > registered_at)
);

create table ss.domain_dns_change_sets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  provider_operation_id uuid,
  state text not null check (
    state in ('draft', 'queued', 'processing', 'applied', 'failed', 'manual_review')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  requested_at timestamptz not null,
  applied_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_id)
    references ss.domain_registrations(organization_id, id),
  foreign key (organization_id, provider_operation_id)
    references ss.domain_provider_operations(organization_id, id),
  unique (registration_id, idempotency_key),
  unique (organization_id, id)
);

create table ss.domain_dns_records (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  change_set_id uuid not null,
  record_type text not null check (record_type in ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA')),
  name text not null check (char_length(name) between 1 and 253),
  value text not null check (char_length(value) between 1 and 4096),
  ttl_seconds integer not null check (ttl_seconds between 60 and 86400),
  priority integer check (priority is null or priority between 0 and 65535),
  state text not null check (state in ('desired', 'applied', 'failed')),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, change_set_id)
    references ss.domain_dns_change_sets(organization_id, id),
  unique (change_set_id, record_type, name, value),
  unique (organization_id, id)
);

create table ss.domain_renewal_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_id uuid not null,
  quote_id uuid not null,
  payment_allocation_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  legal_document_id uuid not null references ss.legal_documents(id),
  term_acceptance_id uuid not null,
  renewal_disclosure_digest ss.sha256_hex not null,
  acknowledged_at timestamptz not null,
  state text not null check (
    state in ('queued', 'processing', 'renewed', 'failed', 'manual_review', 'cancelled')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  provider_operation_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_id)
    references ss.domain_registrations(organization_id, id),
  foreign key (organization_id, quote_id)
    references ss.domain_quotes(organization_id, id),
  foreign key (organization_id, payment_allocation_id)
    references ss.domain_payment_allocations(organization_id, id),
  foreign key (organization_id, term_acceptance_id)
    references ss.term_acceptances(organization_id, id),
  foreign key (organization_id, provider_operation_id)
    references ss.domain_provider_operations(organization_id, id),
  unique (registration_id, idempotency_key),
  unique (organization_id, id)
);

create table ss.domain_transfer_out_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  registration_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  state text not null check (
    state in (
      'requested',
      'unlock_pending',
      'auth_code_ready',
      'export_ready',
      'completed',
      'failed',
      'manual_review'
    )
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_digest ss.sha256_hex not null,
  provider_operation_id uuid,
  auth_code_ciphertext bytea,
  auth_code_digest ss.sha256_hex,
  requested_at timestamptz not null,
  completed_at timestamptz,
  failure_code text,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, registration_id)
    references ss.domain_registrations(organization_id, id),
  foreign key (organization_id, provider_operation_id)
    references ss.domain_provider_operations(organization_id, id),
  unique (registration_id, idempotency_key),
  unique (organization_id, id)
);

create table ss.domain_transfer_exports (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  transfer_request_id uuid not null,
  manifest_digest ss.sha256_hex not null,
  object_key text not null check (char_length(object_key) between 1 and 1024),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, transfer_request_id)
    references ss.domain_transfer_out_requests(organization_id, id),
  unique (transfer_request_id),
  unique (organization_id, id),
  check (expires_at > created_at)
);

create table ss.domain_manual_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  subject_kind text not null
    check (subject_kind in ('registration', 'provider_operation', 'renewal', 'transfer_out')),
  subject_id uuid not null,
  reason_code text not null,
  state text not null check (state in ('open', 'resolved', 'rejected')),
  assigned_operator_id text,
  detail_ciphertext bytea,
  opened_at timestamptz not null,
  resolved_at timestamptz,
  resolution_code text,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (subject_kind, subject_id, reason_code, state),
  unique (organization_id, id)
);

create function ss.validate_domain_procurement_control()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.purchasing_enabled and not (
    exists (
      select 1
      from ss.legal_documents document
      where document.id = new.agent_legal_document_id
        and document.kind = 'domain_agent'
        and document.retired_at is null
    )
    and exists (
      select 1
      from ss.legal_documents document
      where document.id = new.renewal_legal_document_id
        and document.kind = 'domain_renewal'
        and document.retired_at is null
    )
  ) then
    raise exception 'domain procurement requires active exact legal documents'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_procurement_control_exact_legal_kinds
before update on ss.domain_procurement_control
for each row execute function ss.validate_domain_procurement_control();

create function ss.validate_domain_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.provider_receipts receipt
    where receipt.organization_id = new.organization_id
      and receipt.project_id = new.project_id
      and receipt.id = new.provider_receipt_id
      and receipt.provider_code = new.provider_code
      and receipt.receipt_kind = 'domain_quote'
      and receipt.external_object_ref = new.provider_quote_ref
      and receipt.facts ->> 'domainName' = new.domain_name::text
      and receipt.facts ->> 'currency' = new.currency
      and (receipt.facts ->> 'customerPriceMinor')::bigint = new.customer_price_minor
      and (receipt.facts ->> 'registrarCostMinor')::bigint = new.registrar_cost_minor
      and (receipt.facts ->> 'renewalPriceMinor')::bigint = new.renewal_price_minor
      and (receipt.facts ->> 'termYears')::integer = new.term_years
      and receipt.facts ->> 'renewalDisclosureDigest'
        = new.renewal_disclosure_digest::text
      and receipt.facts ->> 'quoteDigest' = new.quote_digest::text
      and (receipt.facts ->> 'expiresAt')::timestamptz = new.expires_at
  ) then
    raise exception 'domain quote must match exact provider receipt'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_quote_provider_receipt
before insert on ss.domain_quotes
for each row execute function ss.validate_domain_quote();

create function ss.validate_domain_consent()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.legal_documents document
    join ss.term_acceptances acceptance
      on acceptance.document_id = document.id
    join ss.domain_quotes quote
      on quote.organization_id = acceptance.organization_id
     and quote.project_id = acceptance.project_id
    join ss.domain_registrant_snapshots registrant
      on registrant.organization_id = quote.organization_id
     and registrant.project_id = quote.project_id
    where document.id = new.legal_document_id
      and document.kind = 'domain_agent'
      and acceptance.organization_id = new.organization_id
      and acceptance.project_id = new.project_id
      and acceptance.id = new.term_acceptance_id
      and acceptance.user_id = new.user_id
      and quote.id = new.quote_id
      and registrant.id = new.registrant_snapshot_id
      and registrant.user_id = new.user_id
      and registrant.customer_is_registrant
  ) then
    raise exception 'domain agent consent evidence does not match'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_agent_consent_exact_evidence
before insert on ss.domain_agent_consents
for each row execute function ss.validate_domain_consent();

create function ss.validate_domain_payment()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_quotes quote
    join ss.provider_receipts receipt
      on receipt.organization_id = quote.organization_id
     and receipt.project_id = quote.project_id
    join ss.domain_procurement_control control
      on control.singleton
    where quote.organization_id = new.organization_id
      and quote.project_id = new.project_id
      and quote.id = new.quote_id
      and receipt.id = new.stripe_provider_receipt_id
      and receipt.provider_code = 'stripe'
      and receipt.receipt_kind = 'domain_payment_captured'
      and receipt.external_object_ref = new.stripe_payment_reference
      and control.purchasing_enabled
      and control.active_provider_code = quote.provider_code
      and quote.currency = new.currency
      and quote.customer_price_minor = new.amount_minor
      and receipt.facts ->> 'quoteId' = new.quote_id::text
      and receipt.facts ->> 'currency' = new.currency
      and (receipt.facts ->> 'amountMinor')::bigint = new.amount_minor
  ) then
    raise exception 'domain payment must be separate exact Stripe evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_payment_is_stripe_not_registrar
before insert on ss.domain_payment_allocations
for each row execute function ss.validate_domain_payment();

create function ss.validate_domain_registration_intent()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.projects project
    join ss.organization_memberships membership
      on membership.organization_id = project.organization_id
    join ss.domain_quotes quote
      on quote.organization_id = project.organization_id
     and quote.project_id = project.id
    join ss.domain_registrant_snapshots registrant
      on registrant.organization_id = project.organization_id
     and registrant.project_id = project.id
    join ss.domain_agent_consents consent
      on consent.organization_id = project.organization_id
     and consent.project_id = project.id
    join ss.domain_payment_allocations payment
      on payment.organization_id = project.organization_id
     and payment.project_id = project.id
    join ss.domain_procurement_control control
      on control.singleton
    where project.organization_id = new.organization_id
      and project.id = new.project_id
      and project.lifecycle = 'active'
      and control.purchasing_enabled
      and control.active_provider_code = new.provider_code
      and membership.user_id = new.requested_by_user_id
      and membership.state = 'active'
      and membership.role in ('owner', 'admin', 'billing')
      and quote.id = new.quote_id
      and quote.quote_kind = 'registration'
      and quote.status = 'open'
      and quote.expires_at > new.created_at
      and quote.domain_name = new.domain_name
      and quote.provider_code = new.provider_code
      and registrant.id = new.registrant_snapshot_id
      and registrant.user_id = new.requested_by_user_id
      and registrant.customer_is_registrant
      and consent.id = new.agent_consent_id
      and consent.user_id = new.requested_by_user_id
      and consent.quote_id = new.quote_id
      and consent.registrant_snapshot_id = new.registrant_snapshot_id
      and consent.customer_remains_registrant
      and payment.id = new.payment_allocation_id
      and payment.quote_id = new.quote_id
      and payment.state = 'captured'
  ) then
    raise exception 'registration intent prerequisites do not match'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_registration_intent_exact_inputs
before insert on ss.domain_registration_intents
for each row execute function ss.validate_domain_registration_intent();

create function ss.validate_domain_confirmation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_registration_intents intent
    join ss.domain_quotes quote
      on quote.organization_id = intent.organization_id
     and quote.id = intent.quote_id
    join ss.domain_payment_allocations payment
      on payment.organization_id = intent.organization_id
     and payment.id = intent.payment_allocation_id
    join ss.domain_procurement_control control
      on control.singleton
    where intent.organization_id = new.organization_id
      and intent.project_id = new.project_id
      and intent.id = new.registration_intent_id
      and intent.requested_by_user_id = new.confirmed_by_user_id
      and intent.state = 'awaiting_confirmation'
      and quote.status = 'open'
      and quote.expires_at > new.confirmed_at
      and control.purchasing_enabled
      and control.active_provider_code = intent.provider_code
      and quote.quote_digest = new.quote_digest
      and payment.state = 'captured'
  ) then
    raise exception 'irreversible confirmation barrier is not satisfied'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_irreversible_confirmation_barrier
before insert on ss.domain_irreversible_confirmations
for each row execute function ss.validate_domain_confirmation();

create function ss.validate_domain_provider_operation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.subject_kind = 'registration' and new.operation_kind = 'register'
    and not exists (
      select 1
      from ss.domain_registration_intents intent
      join ss.domain_irreversible_confirmations confirmation
        on confirmation.organization_id = intent.organization_id
       and confirmation.registration_intent_id = intent.id
      join ss.domain_procurement_control control
        on control.singleton
      where intent.organization_id = new.organization_id
        and intent.project_id = new.project_id
        and intent.id = new.subject_id
        and intent.provider_code = new.provider_code
        and intent.state = 'confirmed'
        and control.purchasing_enabled
        and control.active_provider_code = new.provider_code
    )
  then
    raise exception 'registration provider operation requires irreversible confirmation'
      using errcode = '23514';
  end if;
  if new.subject_kind = 'renewal' and (
    new.operation_kind <> 'renew'
    or not exists (
      select 1
      from ss.domain_renewal_intents renewal
      join ss.domain_registrations registration
        on registration.organization_id = renewal.organization_id
       and registration.id = renewal.registration_id
      where renewal.organization_id = new.organization_id
        and renewal.project_id = new.project_id
        and renewal.id = new.subject_id
        and registration.provider_code = new.provider_code
    )
  ) then
    raise exception 'renewal operation does not match subject'
      using errcode = '23514';
  end if;
  if new.subject_kind = 'transfer_out' and (
    new.operation_kind not in ('unlock', 'request_auth_code', 'transfer_out')
    or not exists (
      select 1
      from ss.domain_transfer_out_requests request
      where request.organization_id = new.organization_id
        and request.project_id = new.project_id
        and request.id = new.subject_id
    )
  ) then
    raise exception 'transfer operation does not match subject'
      using errcode = '23514';
  end if;
  if new.subject_kind = 'dns' and (
    new.operation_kind <> 'configure_dns'
    or not exists (
      select 1
      from ss.domain_dns_change_sets change_set
      where change_set.organization_id = new.organization_id
        and change_set.project_id = new.project_id
        and change_set.id = new.subject_id
    )
  ) then
    raise exception 'DNS operation does not match subject'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_operation_subject_barrier
before insert on ss.domain_provider_operations
for each row execute function ss.validate_domain_provider_operation();

create function ss.validate_domain_operation_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not (
    old.state = new.state
    or (old.state = 'queued' and new.state in ('submitted', 'processing', 'succeeded', 'failed', 'manual_review'))
    or (old.state = 'submitted' and new.state in ('processing', 'succeeded', 'failed', 'manual_review'))
    or (old.state = 'processing' and new.state in ('succeeded', 'failed', 'manual_review'))
    or (old.state = 'failed' and new.state in ('queued', 'manual_review'))
    or (old.state = 'manual_review' and new.state in ('queued', 'failed'))
  ) then
    raise exception 'invalid domain provider operation transition'
      using errcode = '23514';
  end if;
  if new.provider_receipt_id is not null and not exists (
    select 1
    from ss.provider_receipts receipt
    where receipt.organization_id = new.organization_id
      and receipt.project_id = new.project_id
      and receipt.id = new.provider_receipt_id
      and receipt.provider_code = new.provider_code
  ) then
    raise exception 'domain provider receipt is outside operation scope'
      using errcode = '23514';
  end if;
  if new.state = 'succeeded' and not exists (
    select 1
    from ss.provider_receipts receipt
    where receipt.organization_id = new.organization_id
      and receipt.project_id = new.project_id
      and receipt.id = new.provider_receipt_id
      and receipt.provider_code = new.provider_code
      and receipt.receipt_kind = 'domain_operation_result'
      and receipt.facts ->> 'operationId' = new.id::text
      and receipt.facts ->> 'state' = 'succeeded'
  ) then
    raise exception 'successful domain operation requires exact provider receipt'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_operation_state_barrier
before update on ss.domain_provider_operations
for each row execute function ss.validate_domain_operation_update();

create function ss.validate_domain_registration()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_registration_intents intent
    join ss.domain_quotes quote
      on quote.organization_id = intent.organization_id
     and quote.id = intent.quote_id
    join ss.domain_provider_operations operation
      on operation.organization_id = intent.organization_id
     and operation.project_id = intent.project_id
     and operation.subject_kind = 'registration'
     and operation.subject_id = intent.id
     and operation.operation_kind = 'register'
    join ss.provider_receipts receipt
      on receipt.organization_id = operation.organization_id
     and receipt.project_id = operation.project_id
     and receipt.id = operation.provider_receipt_id
    where intent.organization_id = new.organization_id
      and intent.project_id = new.project_id
      and intent.id = new.registration_intent_id
      and intent.registrant_snapshot_id = new.registrant_snapshot_id
      and intent.domain_name = new.domain_name
      and intent.provider_code = new.provider_code
      and intent.irreversible_confirmed_at is not null
      and operation.id = new.provider_operation_id
      and operation.state = 'succeeded'
      and receipt.id = new.current_provider_receipt_id
      and receipt.receipt_kind = 'domain_operation_result'
      and receipt.facts ->> 'operationId' = operation.id::text
      and receipt.facts ->> 'state' = 'succeeded'
      and receipt.facts ->> 'domainName' = new.domain_name::text
      and receipt.facts ->> 'providerDomainRef' = new.provider_domain_ref
      and (receipt.facts ->> 'registeredAt')::timestamptz = new.registered_at
      and (receipt.facts ->> 'expiresAt')::timestamptz = new.expires_at
      and new.customer_is_registrant
      and new.site_sourcery_role = 'authorized_agent'
      and new.renewal_disclosure_digest = quote.renewal_disclosure_digest
  ) then
    raise exception 'domain registration must match exact successful provider result'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_registration_exact_provider_result
before insert on ss.domain_registrations
for each row execute function ss.validate_domain_registration();

create function ss.validate_domain_intent_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if old.irreversible_confirmed_at is not null and (
    new.quote_id is distinct from old.quote_id
    or new.registrant_snapshot_id is distinct from old.registrant_snapshot_id
    or new.agent_consent_id is distinct from old.agent_consent_id
    or new.payment_allocation_id is distinct from old.payment_allocation_id
    or new.domain_name is distinct from old.domain_name
    or new.provider_code is distinct from old.provider_code
  ) then
    raise exception 'confirmed registration evidence is immutable'
      using errcode = '55000';
  end if;
  if new.state in ('confirmed', 'submitted', 'processing', 'registered')
    and not exists (
      select 1
      from ss.domain_irreversible_confirmations confirmation
      where confirmation.organization_id = new.organization_id
        and confirmation.project_id = new.project_id
        and confirmation.registration_intent_id = new.id
        and confirmation.confirmed_by_user_id = new.confirmed_by_user_id
        and confirmation.confirmed_at = new.irreversible_confirmed_at
    )
  then
    raise exception 'registration intent cannot cross irreversible barrier'
      using errcode = '23514';
  end if;
  if new.state in ('submitted', 'processing') and not exists (
    select 1
    from ss.domain_provider_operations operation
    where operation.organization_id = new.organization_id
      and operation.project_id = new.project_id
      and operation.subject_kind = 'registration'
      and operation.subject_id = new.id
      and operation.operation_kind = 'register'
      and operation.provider_code = new.provider_code
      and operation.state in ('queued', 'submitted', 'processing')
  ) then
    raise exception 'submitted registration intent requires provider operation'
      using errcode = '23514';
  end if;
  if new.state = 'registered' and not exists (
    select 1
    from ss.domain_registrations registration
    where registration.organization_id = new.organization_id
      and registration.project_id = new.project_id
      and registration.registration_intent_id = new.id
      and registration.state = 'active'
  ) then
    raise exception 'registered intent requires active domain registration'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_registration_intent_state_barrier
before update on ss.domain_registration_intents
for each row execute function ss.validate_domain_intent_update();

create function ss.validate_domain_operation_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_provider_operations operation
    where operation.organization_id = new.organization_id
      and operation.project_id = new.project_id
      and operation.id = new.operation_id
      and operation.state = new.state
      and operation.provider_receipt_id is not distinct from new.provider_receipt_id
  ) then
    raise exception 'domain operation event must match current projection'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_operation_event_matches_projection
before insert on ss.domain_provider_operation_events
for each row execute function ss.validate_domain_operation_event();

create function ss.validate_domain_renewal()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_registrations registration
    join ss.domain_quotes quote
      on quote.organization_id = registration.organization_id
     and quote.project_id = registration.project_id
    join ss.domain_payment_allocations payment
      on payment.organization_id = quote.organization_id
     and payment.quote_id = quote.id
    join ss.domain_procurement_control control
      on control.singleton
    join ss.term_acceptances acceptance
      on acceptance.organization_id = registration.organization_id
     and acceptance.project_id = registration.project_id
    join ss.legal_documents document
      on document.id = acceptance.document_id
    where registration.organization_id = new.organization_id
      and registration.project_id = new.project_id
      and registration.id = new.registration_id
      and quote.id = new.quote_id
      and quote.quote_kind = 'renewal'
      and quote.status = 'open'
      and control.purchasing_enabled
      and control.active_provider_code = registration.provider_code
      and quote.domain_name = registration.domain_name
      and quote.expires_at > new.created_at
      and quote.renewal_disclosure_digest = new.renewal_disclosure_digest
      and payment.id = new.payment_allocation_id
      and payment.state = 'captured'
      and acceptance.id = new.term_acceptance_id
      and acceptance.user_id = new.requested_by_user_id
      and document.id = new.legal_document_id
      and document.kind = 'domain_renewal'
  ) then
    raise exception 'renewal must match quote, disclosure, payment, and terms'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_renewal_exact_quote
before insert on ss.domain_renewal_intents
for each row execute function ss.validate_domain_renewal();

create function ss.validate_domain_registrar_debit()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_provider_operations operation
    join ss.provider_receipts receipt
      on receipt.organization_id = operation.organization_id
     and receipt.project_id = operation.project_id
    where operation.organization_id = new.organization_id
      and operation.project_id = new.project_id
      and operation.id = new.operation_id
      and operation.provider_code <> 'stripe'
      and receipt.id = new.registrar_provider_receipt_id
      and receipt.provider_code = operation.provider_code
      and receipt.provider_code <> 'stripe'
      and receipt.receipt_kind = 'registrar_debit'
      and receipt.external_object_ref = new.registrar_debit_reference
      and receipt.facts ->> 'operationId' = new.operation_id::text
      and receipt.facts ->> 'currency' = new.currency
      and (receipt.facts ->> 'amountMinor')::bigint = new.amount_minor
  ) then
    raise exception 'registrar debit must be separate non-Stripe evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_registrar_debit_not_stripe
before insert on ss.domain_registrar_debits
for each row execute function ss.validate_domain_registrar_debit();

create function ss.validate_domain_transfer_export()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.domain_transfer_out_requests request
    where request.organization_id = new.organization_id
      and request.project_id = new.project_id
      and request.id = new.transfer_request_id
      and request.state = 'export_ready'
      and request.auth_code_ciphertext is not null
      and request.auth_code_digest is not null
  ) then
    raise exception 'transfer export requires encrypted authorization code'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_transfer_export_ready
before insert on ss.domain_transfer_exports
for each row execute function ss.validate_domain_transfer_export();

create trigger domain_quotes_no_update
before update on ss.domain_quotes
for each row execute function ss.reject_update();

create trigger domain_registrant_snapshots_no_update
before update on ss.domain_registrant_snapshots
for each row execute function ss.reject_update();

create trigger domain_agent_consents_no_update
before update on ss.domain_agent_consents
for each row execute function ss.reject_update();

create trigger domain_payment_allocations_no_update
before update on ss.domain_payment_allocations
for each row execute function ss.reject_update();

create trigger domain_irreversible_confirmations_no_update
before update on ss.domain_irreversible_confirmations
for each row execute function ss.reject_update();

create trigger domain_provider_operation_events_no_update
before update on ss.domain_provider_operation_events
for each row execute function ss.reject_update();

create trigger domain_registrar_debits_no_update
before update on ss.domain_registrar_debits
for each row execute function ss.reject_update();

create trigger domain_transfer_exports_no_update
before update on ss.domain_transfer_exports
for each row execute function ss.reject_update();

do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'domain_quotes',
    'domain_registrant_snapshots',
    'domain_agent_consents',
    'domain_payment_allocations',
    'domain_registration_intents',
    'domain_irreversible_confirmations',
    'domain_provider_operations',
    'domain_provider_operation_events',
    'domain_registrar_debits',
    'domain_registrations',
    'domain_dns_change_sets',
    'domain_dns_records',
    'domain_renewal_intents',
    'domain_transfer_out_requests',
    'domain_transfer_exports',
    'domain_manual_reviews'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'create policy %I on ss.%I for select using (ss.can_access_org(organization_id))',
      table_name || '_tenant_read',
      table_name
    );
  end loop;
end
$$;

alter table ss.domain_procurement_control enable row level security;
alter table ss.domain_procurement_control force row level security;

create policy domain_procurement_control_authenticated_read
on ss.domain_procurement_control for select
using (ss.current_user_id() is not null);

revoke all on
  ss.domain_procurement_control,
  ss.domain_quotes,
  ss.domain_registrant_snapshots,
  ss.domain_agent_consents,
  ss.domain_payment_allocations,
  ss.domain_registration_intents,
  ss.domain_irreversible_confirmations,
  ss.domain_provider_operations,
  ss.domain_provider_operation_events,
  ss.domain_registrar_debits,
  ss.domain_registrations,
  ss.domain_dns_change_sets,
  ss.domain_dns_records,
  ss.domain_renewal_intents,
  ss.domain_transfer_out_requests,
  ss.domain_transfer_exports,
  ss.domain_manual_reviews
from public;

grant select on
  ss.domain_procurement_control,
  ss.domain_quotes,
  ss.domain_registration_intents,
  ss.domain_registrations,
  ss.domain_dns_change_sets,
  ss.domain_dns_records,
  ss.domain_renewal_intents,
  ss.domain_transfer_out_requests,
  ss.domain_transfer_exports
to authenticated;

grant all privileges on
  ss.domain_procurement_control,
  ss.domain_quotes,
  ss.domain_registrant_snapshots,
  ss.domain_agent_consents,
  ss.domain_payment_allocations,
  ss.domain_registration_intents,
  ss.domain_irreversible_confirmations,
  ss.domain_provider_operations,
  ss.domain_provider_operation_events,
  ss.domain_registrar_debits,
  ss.domain_registrations,
  ss.domain_dns_change_sets,
  ss.domain_dns_records,
  ss.domain_renewal_intents,
  ss.domain_transfer_out_requests,
  ss.domain_transfer_exports,
  ss.domain_manual_reviews
to service_role;

grant execute on function
  ss.validate_domain_procurement_control(),
  ss.validate_domain_quote(),
  ss.validate_domain_consent(),
  ss.validate_domain_payment(),
  ss.validate_domain_registration_intent(),
  ss.validate_domain_confirmation(),
  ss.validate_domain_provider_operation(),
  ss.validate_domain_operation_update(),
  ss.validate_domain_registration(),
  ss.validate_domain_intent_update(),
  ss.validate_domain_operation_event(),
  ss.validate_domain_renewal(),
  ss.validate_domain_registrar_debit(),
  ss.validate_domain_transfer_export()
to service_role;

commit;
