begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v44()') is null
    or to_regclass('ss.service_custom_build_change_orders') is null
    or to_regclass('ss.service_custom_build_change_acceptances') is null
  then
    raise exception
      'Site Sourcery migration 044 must be applied before Custom build change payment'
      using errcode = '55000';
  end if;
end
$$;

-- H1N Purpose 1 is deliberately separate from both the first build payment
-- and the completion-bound final payment. One accepted change order produces
-- one immutable invoice. Payment never becomes effective from browser input;
-- only a verified provider receipt can cross that boundary.
create function ss.assert_service_custom_build_change_payment_lock(
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
      'Custom build change payment mutation requires the shared H1M job lock'
      using errcode = '55000';
  end if;
end
$$;

-- Provider facts are a bounded flat JSON object. This function reproduces
-- the hosted canonical-JSON digest (sorted keys, no insignificant spaces)
-- after removing the self-describing digest field.
create function ss.custom_build_change_provider_facts_digest(
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

create function ss.custom_build_change_invoice_digest(
  organization_id uuid,
  project_id uuid,
  customer_user_id uuid,
  job_id uuid,
  change_order_id uuid,
  change_acceptance_id uuid,
  change_number integer,
  invoice_id uuid,
  invoice_number text,
  accepted_quote_digest ss.sha256_hex,
  accepted_disclosure_digest ss.sha256_hex,
  prior_effective_scope_digest ss.sha256_hex,
  target_completion_date date,
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
    'acceptedDisclosureDigest', accepted_disclosure_digest,
    'acceptedQuoteDigest', accepted_quote_digest,
    'changeAcceptanceId', change_acceptance_id,
    'changeNumber', change_number,
    'changeOrderId', change_order_id,
    'currency', currency,
    'customerUserId', customer_user_id,
    'invoiceId', invoice_id,
    'invoiceNumber', invoice_number,
    'issuedAt', issued_at,
    'jobId', job_id,
    'organizationId', organization_id,
    'priorEffectiveScopeDigest', prior_effective_scope_digest,
    'projectId', project_id,
    'schema', 'sitesourcery.custom-build-change-invoice/v1',
    'subtotalMinor', subtotal_minor,
    'targetCompletionDate', target_completion_date,
    'taxState', tax_state
  ))
$$;

create table ss.service_custom_build_change_invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_acceptance_id uuid not null,
  change_number integer not null check (change_number > 0),
  invoice_number text generated always as (
    'SSCB-CHG-' || upper(replace(id::text, '-', ''))
  ) stored,
  purpose text not null check (purpose = 'custom_build_change'),
  policy_id uuid not null,
  scope_boundary_digest ss.sha256_hex not null,
  accepted_quote_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  prior_effective_scope_digest ss.sha256_hex not null,
  target_completion_date date not null,
  subtotal_minor bigint not null check (subtotal_minor > 0),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'calculation_required'),
  tax_minor bigint check (tax_minor is null),
  total_minor bigint check (total_minor is null),
  state text not null check (state = 'tax_calculation_pending'),
  charge_occurred boolean not null check (charge_occurred = false),
  issued_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  invoice_digest ss.sha256_hex generated always as (
    ss.custom_build_change_invoice_digest(
      organization_id,
      project_id,
      customer_user_id,
      job_id,
      change_order_id,
      change_acceptance_id,
      change_number,
      id,
      'SSCB-CHG-' || upper(replace(id::text, '-', '')),
      accepted_quote_digest,
      accepted_disclosure_digest,
      prior_effective_scope_digest,
      target_completion_date,
      subtotal_minor,
      currency,
      tax_state,
      issued_at
    )
  ) stored,
  foreign key (organization_id, project_id, customer_user_id, case_id)
    references ss.service_cases(
      organization_id, project_id, customer_user_id, id
    ),
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  foreign key (organization_id, change_acceptance_id)
    references ss.service_custom_build_change_acceptances(
      organization_id, id
    ),
  foreign key (policy_id, scope_boundary_digest)
    references ss.service_catalog_policies(id, scope_boundary_digest),
  unique (invoice_number),
  unique (organization_id, id),
  unique (change_order_id),
  unique (change_acceptance_id),
  unique (organization_id, change_order_id, id),
  check (created_at >= issued_at)
);

create table ss.service_custom_build_change_invoice_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  invoice_id uuid not null,
  change_order_id uuid not null,
  line_number integer not null check (line_number = 1),
  component_key text not null check (
    component_key = 'custom_build_change_units'
  ),
  display_name text not null check (
    char_length(display_name) between 3 and 160
  ),
  quantity integer not null check (quantity between 1 and 40),
  unit_amount_minor bigint not null check (unit_amount_minor = 12500),
  amount_minor bigint not null check (
    amount_minor = quantity::bigint * unit_amount_minor
  ),
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null,
  foreign key (organization_id, invoice_id)
    references ss.service_custom_build_change_invoices(organization_id, id),
  foreign key (organization_id, change_order_id)
    references ss.service_custom_build_change_orders(organization_id, id),
  unique (invoice_id, line_number),
  unique (invoice_id, change_order_id),
  unique (organization_id, id)
);

create function ss.ensure_service_custom_build_change_invoice(
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
  from ss.service_custom_build_change_invoices invoice
  join ss.service_custom_build_change_acceptances acceptance
    on acceptance.organization_id = invoice.organization_id
   and acceptance.change_order_id = invoice.change_order_id
  where acceptance.id = target_acceptance_id;
  if found then
    return selected_invoice_id;
  end if;

  select
    acceptance.organization_id,
    acceptance.project_id,
    acceptance.case_id,
    acceptance.customer_user_id,
    acceptance.job_id,
    acceptance.change_order_id,
    acceptance.id as change_acceptance_id,
    acceptance.change_number,
    acceptance.accepted_quote_digest,
    acceptance.accepted_disclosure_digest,
    acceptance.accepted_at,
    change_order.policy_id,
    change_order.scope_boundary_digest,
    change_order.prior_effective_scope_digest,
    change_order.target_completion_date,
    change_order.unit_count,
    change_order.subtotal_minor,
    change_order.currency
  into accepted
  from ss.service_custom_build_change_acceptances acceptance
  join ss.service_custom_build_change_orders change_order
    on change_order.organization_id = acceptance.organization_id
   and change_order.job_id = acceptance.job_id
   and change_order.id = acceptance.change_order_id
  where acceptance.id = target_acceptance_id
    and acceptance.accepted_quote_digest = change_order.quote_digest
    and acceptance.accepted_disclosure_digest = change_order.disclosure_digest
    and change_order.subtotal_minor =
      change_order.unit_count::bigint * 12500::bigint;

  if not found then
    raise exception
      'Custom build change invoice requires one exact accepted change order'
      using errcode = '55000';
  end if;

  insert into ss.service_custom_build_change_invoices (
    organization_id,
    project_id,
    case_id,
    customer_user_id,
    job_id,
    change_order_id,
    change_acceptance_id,
    change_number,
    purpose,
    policy_id,
    scope_boundary_digest,
    accepted_quote_digest,
    accepted_disclosure_digest,
    prior_effective_scope_digest,
    target_completion_date,
    subtotal_minor,
    currency,
    tax_state,
    state,
    charge_occurred,
    issued_at,
    created_at
  ) values (
    accepted.organization_id,
    accepted.project_id,
    accepted.case_id,
    accepted.customer_user_id,
    accepted.job_id,
    accepted.change_order_id,
    accepted.change_acceptance_id,
    accepted.change_number,
    'custom_build_change',
    accepted.policy_id,
    accepted.scope_boundary_digest,
    accepted.accepted_quote_digest,
    accepted.accepted_disclosure_digest,
    accepted.prior_effective_scope_digest,
    accepted.target_completion_date,
    accepted.subtotal_minor,
    accepted.currency,
    'calculation_required',
    'tax_calculation_pending',
    false,
    accepted.accepted_at,
    clock_timestamp()
  ) returning id into selected_invoice_id;

  insert into ss.service_custom_build_change_invoice_lines (
    organization_id,
    invoice_id,
    change_order_id,
    line_number,
    component_key,
    display_name,
    quantity,
    unit_amount_minor,
    amount_minor,
    currency,
    created_at
  ) values (
    accepted.organization_id,
    selected_invoice_id,
    accepted.change_order_id,
    1,
    'custom_build_change_units',
    'Custom build change #' || accepted.change_number::text ||
      ' — added-work units',
    accepted.unit_count,
    12500,
    accepted.subtotal_minor,
    'USD',
    accepted.accepted_at
  );

  return selected_invoice_id;
exception
  when unique_violation then
    select invoice.id into selected_invoice_id
    from ss.service_custom_build_change_invoices invoice
    join ss.service_custom_build_change_acceptances acceptance
      on acceptance.organization_id = invoice.organization_id
     and acceptance.change_order_id = invoice.change_order_id
    where acceptance.id = target_acceptance_id;
    if found then
      return selected_invoice_id;
    end if;
    raise;
end
$$;

create function ss.materialize_service_custom_build_change_invoice()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  perform ss.ensure_service_custom_build_change_invoice(new.id);
  return new;
end
$$;

create trigger service_custom_build_change_acceptances_payment_invoice
after insert on ss.service_custom_build_change_acceptances
for each row execute function ss.materialize_service_custom_build_change_invoice();

do $$
declare
  acceptance record;
begin
  for acceptance in
    select id from ss.service_custom_build_change_acceptances
  loop
    perform ss.ensure_service_custom_build_change_invoice(acceptance.id);
  end loop;
end
$$;

create trigger service_custom_build_change_invoices_immutable
before update or delete on ss.service_custom_build_change_invoices
for each row execute function ss.reject_update();

create trigger service_custom_build_change_invoice_lines_immutable
before update or delete on ss.service_custom_build_change_invoice_lines
for each row execute function ss.reject_update();

create table ss.service_custom_build_change_checkout_attempts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_acceptance_id uuid not null,
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
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  foreign key (organization_id, change_acceptance_id)
    references ss.service_custom_build_change_acceptances(
      organization_id, id
    ),
  foreign key (organization_id, change_order_id, invoice_id)
    references ss.service_custom_build_change_invoices(
      organization_id, change_order_id, id
    ),
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
  check (expires_at is null or expires_at = provider_request_expires_at)
);

create unique index service_custom_build_change_checkout_one_active
on ss.service_custom_build_change_checkout_attempts(invoice_id)
where state in ('provider_pending', 'ready', 'persistence_unknown', 'paid');

create function ss.guard_service_custom_build_change_checkout_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  invoice_record record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build change Checkout history is append-only'
      using errcode = '55000';
  end if;

  perform ss.assert_service_custom_build_change_payment_lock(new.job_id);

  if tg_op = 'INSERT' then
    select invoice.* into invoice_record
    from ss.service_custom_build_change_invoices invoice
    join ss.service_custom_build_change_orders change_order
      on change_order.organization_id = invoice.organization_id
     and change_order.id = invoice.change_order_id
    left join ss.service_custom_build_change_payment_receipts receipt
      on receipt.organization_id = invoice.organization_id
     and receipt.invoice_id = invoice.id
    where invoice.organization_id = new.organization_id
      and invoice.project_id = new.project_id
      and invoice.customer_user_id = new.customer_user_id
      and invoice.job_id = new.job_id
      and invoice.change_order_id = new.change_order_id
      and invoice.change_acceptance_id = new.change_acceptance_id
      and invoice.id = new.invoice_id
      and invoice.invoice_digest = new.invoice_digest
      and invoice.accepted_quote_digest = new.accepted_quote_digest
      and invoice.accepted_disclosure_digest = new.accepted_disclosure_digest
      and invoice.subtotal_minor = new.expected_subtotal_minor
      and change_order.state = 'accepted_payment_required'
      and receipt.id is null;
    if not found
      or ss.current_service_actor_kind() <> 'customer'
      or ss.current_service_actor_org_id() is distinct from new.organization_id
      or ss.current_service_actor_user_id() is distinct from new.customer_user_id
      or new.state <> 'provider_pending'
      or new.provider_effect_certainty <> 'ambiguous'
    then
      raise exception 'Custom build change Checkout lacks current invoice authority'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.job_id, new.change_order_id, new.change_acceptance_id,
    new.invoice_id, new.command_id,
    new.provider, new.purpose_digest, new.invoice_digest,
    new.accepted_quote_digest, new.accepted_disclosure_digest,
    new.expected_subtotal_minor, new.currency, new.tax_mode,
    new.provider_request_expires_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.job_id, old.change_order_id, old.change_acceptance_id,
    old.invoice_id, old.command_id,
    old.provider, old.purpose_digest, old.invoice_digest,
    old.accepted_quote_digest, old.accepted_disclosure_digest,
    old.expected_subtotal_minor, old.currency, old.tax_mode,
    old.provider_request_expires_at, old.created_at
  ) then
    raise exception 'Custom build change Checkout identity is immutable'
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

  if ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
    and (
      (old.state in ('provider_pending', 'persistence_unknown')
        and new.state = 'ready')
      or (old.state = 'provider_pending'
        and new.state = 'persistence_unknown')
      or (old.state in ('provider_pending', 'persistence_unknown', 'ready')
        and new.state = 'expired')
    )
    and ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_payment_reconcile',
      clock_timestamp()
    )
  then
    return new;
  end if;

  if ss.current_service_actor_kind() in ('system', 'operator')
    and ss.current_service_actor_org_id() is not distinct from old.organization_id
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
      from ss.service_custom_build_change_payment_receipts receipt
      where receipt.organization_id = old.organization_id
        and receipt.checkout_attempt_id = old.id
        and receipt.invoice_id = old.invoice_id
    )
  then
    return new;
  end if;

  raise exception 'Custom build change Checkout transition lacks authority'
    using errcode = '42501';
end
$$;

create trigger service_custom_build_change_checkout_attempt_guard
before insert or update or delete
on ss.service_custom_build_change_checkout_attempts
for each row execute function ss.guard_service_custom_build_change_checkout_attempt();

create function ss.custom_build_change_reconciliation_request_digest(
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
      'sitesourcery.custom-build-change-payment-reconciliation-command/v1'
  ))
$$;

create table ss.service_custom_build_change_reconciliation_commands (
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
    references ss.service_custom_build_change_checkout_attempts(
      organization_id, id
    ),
  unique (command_id),
  unique (organization_id, id),
  check (
    request_digest = ss.custom_build_change_reconciliation_request_digest(
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

create function ss.guard_service_custom_build_change_reconciliation_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Custom build change reconciliation commands are append-only'
      using errcode = '55000';
  end if;

  perform ss.assert_service_custom_build_change_payment_lock(new.job_id);

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
      'Custom build change reconciliation command lacks operator authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'running'
      or new.result is not null
      or new.result_digest is not null
      or new.completed_at is not null
      or not exists (
        select 1
        from ss.service_custom_build_change_checkout_attempts attempt
        where attempt.organization_id = new.organization_id
          and attempt.job_id = new.job_id
          and attempt.id = new.checkout_attempt_id
      )
    then
      raise exception
        'Custom build change reconciliation command is invalid'
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
      'Custom build change reconciliation command transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_change_reconciliation_command_guard
before insert or update or delete
on ss.service_custom_build_change_reconciliation_commands
for each row execute function
  ss.guard_service_custom_build_change_reconciliation_command();

create table ss.service_custom_build_change_stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_acceptance_id uuid not null,
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
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  foreign key (organization_id, change_acceptance_id)
    references ss.service_custom_build_change_acceptances(
      organization_id, id
    ),
  foreign key (organization_id, change_order_id, invoice_id)
    references ss.service_custom_build_change_invoices(
      organization_id, change_order_id, id
    ),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_change_checkout_attempts(
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

create function ss.guard_service_custom_build_change_stripe_event()
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
      'Custom build change Stripe event mutation lacks system authority'
      using errcode = '42501';
  end if;

  perform ss.assert_service_custom_build_change_payment_lock(new.job_id);

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
      or new.result is not null
      or new.reconciliation_code is not null
      or new.completed_at is not null
    then
      raise exception 'Custom build change Stripe event must begin pending'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.project_id, new.customer_user_id,
    new.job_id, new.change_order_id, new.change_acceptance_id,
    new.invoice_id,
    new.checkout_attempt_id, new.event_type, new.livemode,
    new.api_version, new.checkout_session_id, new.payload_digest,
    new.provider_created_at, new.signature_verified_at, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.project_id, old.customer_user_id,
    old.job_id, old.change_order_id, old.change_acceptance_id,
    old.invoice_id,
    old.checkout_attempt_id, old.event_type, old.livemode,
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
    raise exception 'Custom build change Stripe event transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger service_custom_build_change_stripe_event_guard
before insert or update on ss.service_custom_build_change_stripe_events
for each row execute function ss.guard_service_custom_build_change_stripe_event();

create trigger service_custom_build_change_stripe_event_no_delete
before delete on ss.service_custom_build_change_stripe_events
for each row execute function ss.reject_update();

create table ss.service_custom_build_change_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  case_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  job_id uuid not null,
  change_order_id uuid not null,
  change_acceptance_id uuid not null,
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
  foreign key (organization_id, job_id, change_order_id)
    references ss.service_custom_build_change_orders(
      organization_id, job_id, id
    ),
  foreign key (organization_id, change_acceptance_id)
    references ss.service_custom_build_change_acceptances(
      organization_id, id
    ),
  foreign key (organization_id, change_order_id, invoice_id)
    references ss.service_custom_build_change_invoices(
      organization_id, change_order_id, id
    ),
  foreign key (organization_id, checkout_attempt_id)
    references ss.service_custom_build_change_checkout_attempts(
      organization_id, id
    ),
  foreign key (organization_id, stripe_event_id)
    references ss.service_custom_build_change_stripe_events(
      organization_id, id
    ),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, id),
  unique (change_order_id),
  unique (change_acceptance_id),
  unique (invoice_id),
  unique (checkout_attempt_id),
  unique (stripe_event_id),
  check (settled_at >= provider_paid_at),
  check (
    (receipt_source = 'stripe_event' and stripe_event_id is not null)
    or (receipt_source = 'provider_readback'
      and stripe_event_id is null
      and reconciled_by_operator_user_id is not null)
  )
);

create function ss.guard_service_custom_build_change_payment_receipt()
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
        and ss.service_operator_has_capability(
          ss.current_service_actor_user_id(),
          'service_payment_reconcile',
          clock_timestamp()
        )
      )
    )
  then
    raise exception
      'Custom build change receipt lacks system authority'
      using errcode = '42501';
  end if;

  perform ss.assert_service_custom_build_change_payment_lock(new.job_id);

  if (
    select count(*)
    from jsonb_object_keys(new.provider_facts)
  ) <> 14
    or not new.provider_facts ?& array[
      'checkoutSessionId',
      'currency',
      'customerId',
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
      'sitesourcery.stripe-custom-build-change-payment-facts/v1'
    or new.provider_facts ->> 'provider' <> new.provider
    or new.provider_facts ->> 'checkoutSessionId' <>
      new.checkout_session_id
    or new.provider_facts ->> 'paymentIntentId' <> new.payment_intent_id
    or new.provider_facts ->> 'customerId' <> new.stripe_customer_id
    or new.provider_facts ->> 'paymentStatus' <> new.payment_status
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
    or ss.custom_build_change_provider_facts_digest(
      new.provider_facts
    ) <> new.provider_facts_digest
  then
    raise exception
      'Custom build change receipt provider facts are internally inconsistent'
      using errcode = '23514';
  end if;

  if not exists (
      select 1
      from ss.service_custom_build_change_invoices invoice
      join ss.service_custom_build_change_orders change_order
        on change_order.organization_id = invoice.organization_id
       and change_order.id = invoice.change_order_id
      join ss.service_custom_build_change_checkout_attempts attempt
        on attempt.organization_id = invoice.organization_id
       and attempt.invoice_id = invoice.id
      left join ss.service_custom_build_change_stripe_events event
        on event.organization_id = invoice.organization_id
       and event.invoice_id = invoice.id
       and event.checkout_attempt_id = attempt.id
      where invoice.organization_id = new.organization_id
        and invoice.project_id = new.project_id
        and invoice.case_id = new.case_id
        and invoice.customer_user_id = new.customer_user_id
        and invoice.job_id = new.job_id
        and invoice.change_order_id = new.change_order_id
        and invoice.change_acceptance_id = new.change_acceptance_id
        and invoice.id = new.invoice_id
        and attempt.id = new.checkout_attempt_id
        and attempt.change_acceptance_id = new.change_acceptance_id
        and change_order.state = 'accepted_payment_required'
        and attempt.state = 'ready'
        and attempt.checkout_session_id = new.checkout_session_id
        and invoice.subtotal_minor = new.subtotal_minor
        and invoice.currency = new.currency
        and attempt.expected_subtotal_minor = new.subtotal_minor
        and attempt.purpose_digest = new.purpose_digest
        and invoice.invoice_digest = new.invoice_digest
        and attempt.invoice_digest = new.invoice_digest
        and invoice.accepted_quote_digest = new.accepted_quote_digest
        and attempt.accepted_quote_digest = new.accepted_quote_digest
        and invoice.accepted_disclosure_digest =
          new.accepted_disclosure_digest
        and attempt.accepted_disclosure_digest =
          new.accepted_disclosure_digest
        and (
          (new.receipt_source = 'stripe_event'
            and event.id = new.stripe_event_id
            and event.change_acceptance_id = new.change_acceptance_id
            and event.state in ('pending', 'reconciliation_required')
            and event.checkout_session_id = new.checkout_session_id)
          or (new.receipt_source = 'provider_readback'
            and new.stripe_event_id is null)
        )
    )
  then
    raise exception
      'Custom build change receipt lacks exact verified payment evidence'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_custom_build_change_payment_receipt_guard
before insert on ss.service_custom_build_change_payment_receipts
for each row execute function ss.guard_service_custom_build_change_payment_receipt();

create trigger service_custom_build_change_payment_receipt_immutable
before update or delete on ss.service_custom_build_change_payment_receipts
for each row execute function ss.reject_update();

-- Replace v44's deliberate fail-closed placeholder only after the named,
-- immutable receipt relation exists.
create or replace function ss.service_custom_build_change_has_payment_evidence(
  selected_change_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select exists (
    select 1
    from ss.service_custom_build_change_checkout_attempts attempt
    where attempt.change_order_id = selected_change_order_id
      and attempt.state in (
        'provider_pending', 'ready', 'persistence_unknown', 'paid'
      )
  ) or exists (
    select 1
    from ss.service_custom_build_change_stripe_events event
    where event.change_order_id = selected_change_order_id
  ) or exists (
    select 1
    from ss.service_custom_build_change_payment_receipts receipt
    where receipt.change_order_id = selected_change_order_id
  )
$$;

create or replace function ss.prepare_service_custom_build_change_void()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  selected_change record;
  recorded_at timestamptz := clock_timestamp();
  claimed_quote_digest ss.sha256_hex := new.voided_quote_digest;
begin
  if new.change_order_id is null then
    raise exception 'Custom build change void lacks an exact change order'
      using errcode = '42501';
  end if;

  select change_order.job_id into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id;
  if not found then
    raise exception 'Custom build change void lacks exact quote-author evidence'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ss-custom-build-h1m:' || selected_change.job_id::text,
      0
    )
  );

  select change_order.* into selected_change
  from ss.service_custom_build_change_orders change_order
  where change_order.id = new.change_order_id
  for update;

  if not found
    or selected_change.state not in (
      'issued', 'accepted_payment_required'
    )
    or ss.current_service_actor_kind() <> 'operator'
    or ss.current_service_actor_org_id() is distinct from
      selected_change.organization_id
    or ss.current_service_actor_user_id() is distinct from
      selected_change.created_by_operator_user_id
    or claimed_quote_digest is distinct from selected_change.quote_digest
    or not ss.service_operator_has_capability(
      ss.current_service_actor_user_id(),
      'service_quote_author',
      recorded_at
    )
    or char_length(new.reason) not between 20 and 500
    or not ss.service_text_excludes_credentials(new.reason)
  then
    raise exception 'Custom build change void lacks exact quote-author evidence'
      using errcode = '42501';
  end if;

  if selected_change.state = 'accepted_payment_required'
    and ss.service_custom_build_change_has_payment_evidence(
      selected_change.id
    )
  then
    raise exception 'Accepted Custom build change has payment evidence'
      using errcode = '55000';
  end if;

  new.organization_id := selected_change.organization_id;
  new.job_id := selected_change.job_id;
  new.change_number := selected_change.change_number;
  new.quote_author_operator_user_id :=
    selected_change.created_by_operator_user_id;
  new.voided_quote_digest := selected_change.quote_digest;
  new.voided_disclosure_digest := selected_change.disclosure_digest;
  new.request_digest := ss.service_json_digest(jsonb_build_object(
    'changeNumber', selected_change.change_number,
    'changeOrderId', selected_change.id,
    'commandId', new.command_id,
    'jobId', selected_change.job_id,
    'quoteAuthorOperatorUserId',
      selected_change.created_by_operator_user_id,
    'reason', new.reason,
    'schema', 'sitesourcery.custom-build-change-void-command/v1',
    'voidedDisclosureDigest', selected_change.disclosure_digest,
    'voidedQuoteDigest', selected_change.quote_digest
  ));
  new.voided_at := recorded_at;
  new.created_at := recorded_at;
  return new;
end
$$;

-- Preserve every v44 transition and add exactly one new edge: a system actor
-- may move accepted_payment_required to effective only while inserting the
-- exact immutable payment receipt in the same transaction.
create or replace function ss.guard_service_custom_build_change_order_update()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  transition_at timestamptz;
begin
  if row(
    new.id,
    new.organization_id,
    new.project_id,
    new.case_id,
    new.customer_user_id,
    new.job_id,
    new.change_number,
    new.policy_id,
    new.scope_boundary_digest,
    new.added_scope,
    new.unit_count,
    new.prior_effective_scope_digest,
    new.current_effective_target_completion_date,
    new.target_completion_date,
    new.commercial_contract_id,
    new.commercial_contract_digest,
    new.created_by_operator_user_id,
    new.issue_command_id,
    new.issue_request_digest,
    new.issued_at,
    new.expires_at,
    new.created_at
  ) is distinct from row(
    old.id,
    old.organization_id,
    old.project_id,
    old.case_id,
    old.customer_user_id,
    old.job_id,
    old.change_number,
    old.policy_id,
    old.scope_boundary_digest,
    old.added_scope,
    old.unit_count,
    old.prior_effective_scope_digest,
    old.current_effective_target_completion_date,
    old.target_completion_date,
    old.commercial_contract_id,
    old.commercial_contract_digest,
    old.created_by_operator_user_id,
    old.issue_command_id,
    old.issue_request_digest,
    old.issued_at,
    old.expires_at,
    old.created_at
  ) then
    raise exception 'Custom build change-order identity is immutable'
      using errcode = '55000';
  end if;

  if old.state = 'issued'
    and new.state = 'accepted_payment_required'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
  then
    select acceptance.accepted_at into transition_at
    from ss.service_custom_build_change_acceptances acceptance
    where acceptance.change_order_id = old.id
      and acceptance.accepted_quote_digest = old.quote_digest
      and acceptance.accepted_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state = 'accepted_payment_required'
    and new.state = 'effective'
    and ss.current_service_actor_kind() in ('system', 'operator')
    and ss.current_service_actor_org_id() = old.organization_id
    and (
      ss.current_service_actor_kind() = 'system'
      or ss.service_operator_has_capability(
        ss.current_service_actor_user_id(),
        'service_payment_reconcile',
        clock_timestamp()
      )
    )
  then
    perform ss.assert_service_custom_build_change_payment_lock(old.job_id);
    select receipt.settled_at into transition_at
    from ss.service_custom_build_change_payment_receipts receipt
    where receipt.organization_id = old.organization_id
      and receipt.job_id = old.job_id
      and receipt.change_order_id = old.id
      and receipt.accepted_quote_digest = old.quote_digest
      and receipt.accepted_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state = 'issued'
    and new.state = 'declined'
    and ss.current_service_actor_kind() = 'customer'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.customer_user_id
  then
    select decline.declined_at into transition_at
    from ss.service_custom_build_change_declines decline
    where decline.change_order_id = old.id
      and decline.declined_quote_digest = old.quote_digest
      and decline.declined_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state = 'issued'
    and new.state = 'expired'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
  then
    select expiration.expired_at into transition_at
    from ss.service_custom_build_change_expirations expiration
    where expiration.change_order_id = old.id
      and expiration.expired_by_operator_user_id =
        ss.current_service_actor_user_id()
      and expiration.expired_quote_digest = old.quote_digest
      and expiration.expired_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  if old.state in ('issued', 'accepted_payment_required')
    and new.state = 'voided'
    and ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() = old.organization_id
    and ss.current_service_actor_user_id() = old.created_by_operator_user_id
  then
    select quote_void.voided_at into transition_at
    from ss.service_custom_build_change_voids quote_void
    where quote_void.change_order_id = old.id
      and quote_void.quote_author_operator_user_id =
        old.created_by_operator_user_id
      and quote_void.voided_quote_digest = old.quote_digest
      and quote_void.voided_disclosure_digest = old.disclosure_digest;
    if transition_at is not null then
      new.updated_at := transition_at;
      return new;
    end if;
  end if;

  raise exception
    'Custom build change-order transition lacks exact append evidence'
    using errcode = '55000';
end
$$;

create function ss.materialize_service_custom_build_change_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  changed_count integer;
begin
  update ss.service_custom_build_change_orders
  set state = 'effective'
  where organization_id = new.organization_id
    and id = new.change_order_id
    and state = 'accepted_payment_required';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception
      'Custom build change payment could not activate exact added scope'
      using errcode = '55000';
  end if;

  update ss.service_custom_build_change_checkout_attempts
  set state = 'paid'
  where organization_id = new.organization_id
    and id = new.checkout_attempt_id
    and state = 'ready';
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Custom build change payment could not seal Checkout'
      using errcode = '55000';
  end if;

  if new.stripe_event_id is not null then
    update ss.service_custom_build_change_stripe_events
    set
      state = 'processed',
      reconciliation_code = null,
      result = jsonb_build_object(
        'changeOrderId', new.change_order_id,
        'invoiceId', new.invoice_id,
        'next', 'custom_build_changed_work',
        'projectId', new.project_id,
        'receiptId', new.id,
        'schema', 'sitesourcery.custom-build-change-settlement/v1',
        'status', 'payment_settled'
      ),
      completed_at = new.settled_at
    where organization_id = new.organization_id
      and id = new.stripe_event_id
      and state in ('pending', 'reconciliation_required');
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      raise exception 'Custom build change payment could not seal Stripe event'
        using errcode = '55000';
    end if;
  end if;
  return new;
end
$$;

create trigger service_custom_build_change_payment_materialize
after insert on ss.service_custom_build_change_payment_receipts
for each row execute function ss.materialize_service_custom_build_change_payment();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_change_invoices',
    'service_custom_build_change_invoice_lines',
    'service_custom_build_change_checkout_attempts',
    'service_custom_build_change_reconciliation_commands',
    'service_custom_build_change_stripe_events',
    'service_custom_build_change_payment_receipts'
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
  ss.service_custom_build_change_checkout_attempts,
  ss.service_custom_build_change_reconciliation_commands,
  ss.service_custom_build_change_stripe_events
to service_role;

grant insert on table
  ss.service_custom_build_change_payment_receipts
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
        'assert_service_custom_build_change_payment_lock',
        'custom_build_change_provider_facts_digest',
        'custom_build_change_invoice_digest',
        'custom_build_change_reconciliation_request_digest',
        'ensure_service_custom_build_change_invoice',
        'materialize_service_custom_build_change_invoice',
        'guard_service_custom_build_change_checkout_attempt',
        'guard_service_custom_build_change_reconciliation_command',
        'guard_service_custom_build_change_stripe_event',
        'guard_service_custom_build_change_payment_receipt',
        'service_custom_build_change_has_payment_evidence',
        'guard_service_custom_build_change_order_update',
        'materialize_service_custom_build_change_payment'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_signature
    );
  end loop;
end
$$;

revoke all on function ss.ensure_service_custom_build_change_invoice(uuid)
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_change_invoice()
from public, anon, authenticated, service_role;
revoke all on function ss.materialize_service_custom_build_change_payment()
from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'service_custom_build_change_invoices',
    'service_custom_build_change_invoice_lines',
    'service_custom_build_change_checkout_attempts',
    'service_custom_build_change_reconciliation_commands',
    'service_custom_build_change_stripe_events',
    'service_custom_build_change_payment_receipts'
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
      raise exception
        'Custom build change payment privilege boundary is unsafe: %',
        table_name using errcode = '55000';
    end if;
  end loop;

  if has_table_privilege(
    'service_role', 'ss.service_custom_build_change_invoices', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_invoices', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_invoice_lines', 'INSERT'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_invoice_lines', 'UPDATE'
  ) or has_table_privilege(
    'service_role', 'ss.service_custom_build_change_payment_receipts', 'UPDATE'
  ) then
    raise exception
      'Custom build change invoice or receipt evidence is not append-only'
      using errcode = '55000';
  end if;
end
$$;

create function ss.hosted_runtime_contract_v45()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select 'canonical-ss-v45-custom-build-change-payment'::text
$$;

revoke all on function ss.hosted_runtime_contract_v45()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v45()
to service_role;

commit;
