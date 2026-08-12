-- DOMAINS-COMPOSE-01
-- Durable provider selection, irreversible-attempt, and registrar-of-record
-- evidence. This migration authorizes no registrar, payment, DNS, or renewal
-- effect. External composition remains held.

begin;

create table ss.domain_provider_routes (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  selection_key text not null
    check (char_length(selection_key) between 8 and 200),
  route_schema text not null
    check (route_schema = 'sitesourcery.domain-provider-route/v1'),
  route_evidence jsonb not null
    check (jsonb_typeof(route_evidence) = 'object'),
  provider_code text not null
    check (provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  registrar_of_record text not null
    check (char_length(registrar_of_record) between 2 and 128),
  primary_provider_code text not null
    check (primary_provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  fallback_used boolean not null,
  fallback_from_provider_code text
    check (
      fallback_from_provider_code is null
      or fallback_from_provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'
    ),
  domain_name ss.canonical_hostname not null,
  term_years integer not null check (term_years between 1 and 10),
  provider_quote_ref text not null
    check (char_length(provider_quote_ref) between 1 and 256),
  expected_price_minor bigint not null
    check (expected_price_minor >= 0),
  currency text not null check (currency = 'USD'),
  provider_observed_at timestamptz not null,
  provider_expires_at timestamptz not null,
  route_fingerprint ss.sha256_hex not null,
  selection_digest ss.sha256_hex not null,
  selected_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, selection_key),
  unique (provider_code, provider_quote_ref),
  check (provider_expires_at > selected_at),
  check (provider_observed_at <= selected_at),
  check (
    (
      not fallback_used
      and provider_code = primary_provider_code
      and fallback_from_provider_code is null
    ) or (
      fallback_used
      and provider_code <> primary_provider_code
      and fallback_from_provider_code = primary_provider_code
    )
  )
);

create table ss.domain_provider_registration_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  provider_route_id uuid not null,
  provider_code text not null
    check (provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  domain_name ss.canonical_hostname not null,
  attempt_key text not null
    check (char_length(attempt_key) between 8 and 200),
  state text not null check (
    state in (
      'dispatching',
      'submitted',
      'not_submitted',
      'uncertain',
      'succeeded'
    )
  ),
  external_operation_ref text
    check (
      external_operation_ref is null
      or char_length(external_operation_ref) between 1 and 256
    ),
  submission_outcome jsonb,
  submission_outcome_digest ss.sha256_hex,
  reconciliation_outcome jsonb,
  reconciliation_outcome_digest ss.sha256_hex,
  requested_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_route_id)
    references ss.domain_provider_routes(organization_id, id),
  unique (organization_id, id),
  unique (organization_id, attempt_key),
  unique (provider_route_id),
  check (
    (submission_outcome is null) =
      (submission_outcome_digest is null)
  ),
  check (
    (reconciliation_outcome is null) =
      (reconciliation_outcome_digest is null)
  ),
  check (
    (
      state = 'dispatching'
      and external_operation_ref is null
      and submission_outcome is null
      and reconciliation_outcome is null
      and completed_at is null
    ) or (
      state = 'submitted'
      and external_operation_ref is not null
      and submission_outcome is not null
      and reconciliation_outcome is null
      and completed_at is null
    ) or (
      state in ('not_submitted', 'uncertain')
      and submission_outcome is not null
      and reconciliation_outcome is null
      and completed_at is not null
    ) or (
      state = 'succeeded'
      and external_operation_ref is not null
      and submission_outcome is not null
      and reconciliation_outcome is not null
      and completed_at is not null
    )
  )
);

create table ss.domain_provider_pins (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  provider_route_id uuid not null,
  registration_attempt_id uuid not null,
  pin_schema text not null
    check (pin_schema = 'sitesourcery.domain-provider-pin/v1'),
  pin_evidence jsonb not null
    check (jsonb_typeof(pin_evidence) = 'object'),
  provider_code text not null
    check (provider_code ~ '^[a-z][a-z0-9_-]{1,63}$'),
  registrar_of_record text not null
    check (char_length(registrar_of_record) between 2 and 128),
  domain_name ss.canonical_hostname not null,
  provider_domain_ref text not null
    check (char_length(provider_domain_ref) between 1 and 256),
  pin_fingerprint ss.sha256_hex not null,
  pinned_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_route_id)
    references ss.domain_provider_routes(organization_id, id),
  foreign key (organization_id, registration_attempt_id)
    references ss.domain_provider_registration_attempts(organization_id, id),
  unique (organization_id, id),
  unique (provider_route_id),
  unique (registration_attempt_id),
  unique (domain_name),
  unique (provider_code, provider_domain_ref)
);

create function ss.validate_domain_provider_route_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.project_legal_json_digest(new.route_evidence) <>
       new.route_fingerprint
    or new.route_evidence ->> 'schema' <> new.route_schema
    or new.route_evidence ->> 'providerCode' <> new.provider_code
    or new.route_evidence ->> 'registrarOfRecord' <>
       new.registrar_of_record
    or new.route_evidence ->> 'domain' <> new.domain_name::text
    or (new.route_evidence ->> 'years')::integer <> new.term_years
    or new.route_evidence ->> 'quoteId' <> new.provider_quote_ref
    or (new.route_evidence -> 'expectedPrice' ->> 'amountMinor')::bigint <>
       new.expected_price_minor
    or new.route_evidence -> 'expectedPrice' ->> 'currency' <> new.currency
    or (
      new.route_evidence ? 'priceClass'
      and coalesce(new.route_evidence ->> 'priceClass', '')
            not in ('standard', 'premium')
    )
    or (new.route_evidence ->> 'observedAt')::timestamptz <>
       new.provider_observed_at
    or (new.route_evidence ->> 'expiresAt')::timestamptz <>
       new.provider_expires_at
  then
    raise exception 'domain provider route evidence digest or fields changed'
      using errcode = '23514';
  end if;

  if ss.project_legal_json_digest(jsonb_build_object(
       'schema', 'sitesourcery.domain-provider-route-selection/v1',
       'organizationId', new.organization_id::text,
       'projectId', new.project_id::text,
       'selectionKey', new.selection_key,
       'primaryProviderCode', new.primary_provider_code,
       'fallbackUsed', new.fallback_used,
       'fallbackFromProviderCode', new.fallback_from_provider_code,
       'routeFingerprint', new.route_fingerprint
     )) <> new.selection_digest
  then
    raise exception 'domain provider route selection digest changed'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_route_exact_evidence
before insert on ss.domain_provider_routes
for each row execute function ss.validate_domain_provider_route_v1();

create function ss.validate_domain_provider_attempt_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
      from ss.domain_provider_routes route
     where route.organization_id = new.organization_id
       and route.project_id = new.project_id
       and route.id = new.provider_route_id
       and route.provider_code = new.provider_code
       and route.domain_name = new.domain_name
  ) then
    raise exception 'domain provider attempt does not match its durable route'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or new.provider_route_id is distinct from old.provider_route_id
      or new.provider_code is distinct from old.provider_code
      or new.domain_name is distinct from old.domain_name
      or new.attempt_key is distinct from old.attempt_key
      or new.requested_at is distinct from old.requested_at
    then
      raise exception 'domain provider attempt authority is immutable'
        using errcode = '55000';
    end if;
    if old.external_operation_ref is not null and
      new.external_operation_ref is distinct from old.external_operation_ref
    then
      raise exception 'domain provider operation reference is immutable'
        using errcode = '55000';
    end if;
    if old.submission_outcome is not null and (
      new.submission_outcome is distinct from old.submission_outcome
      or new.submission_outcome_digest is distinct from
         old.submission_outcome_digest
    ) then
      raise exception 'domain provider submission outcome is immutable'
        using errcode = '55000';
    end if;
    if old.reconciliation_outcome is not null and (
      new.reconciliation_outcome is distinct from old.reconciliation_outcome
      or new.reconciliation_outcome_digest is distinct from
         old.reconciliation_outcome_digest
    ) then
      raise exception 'domain provider reconciliation outcome is immutable'
        using errcode = '55000';
    end if;
    if not (
      new.state = old.state
      or (
        old.state = 'dispatching'
        and new.state in ('submitted', 'not_submitted', 'uncertain')
      )
      or (
        old.state in ('submitted', 'uncertain')
        and new.state = 'succeeded'
      )
    ) then
      raise exception 'invalid domain provider attempt transition'
        using errcode = '23514';
    end if;
  end if;

  if new.submission_outcome is not null and not (
    new.submission_outcome ->> 'schema' =
      'sitesourcery.domain-provider-outcome/v1'
    and new.submission_outcome ->> 'providerCode' = new.provider_code
  ) then
    raise exception 'domain provider submission outcome changed provider'
      using errcode = '23514';
  end if;
  if new.submission_outcome is not null and
    ss.project_legal_json_digest(new.submission_outcome) <>
      new.submission_outcome_digest
  then
    raise exception 'domain provider submission outcome digest changed'
      using errcode = '23514';
  end if;
  if new.reconciliation_outcome is not null and not (
    new.reconciliation_outcome ->> 'schema' =
      'sitesourcery.domain-provider-outcome/v1'
    and new.reconciliation_outcome ->> 'status' = 'active'
    and new.reconciliation_outcome ->> 'operationId' =
      new.external_operation_ref
  ) then
    raise exception 'domain provider reconciliation outcome is invalid'
      using errcode = '23514';
  end if;
  if new.reconciliation_outcome is not null and
    ss.project_legal_json_digest(new.reconciliation_outcome) <>
      new.reconciliation_outcome_digest
  then
    raise exception 'domain provider reconciliation outcome digest changed'
      using errcode = '23514';
  end if;
  if new.reconciliation_outcome ? 'finalChargeEvidence' and not (
    new.reconciliation_outcome -> 'finalChargeEvidence' ->> 'schema' =
      'sitesourcery.domain-final-charge-evidence/v1'
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'providerCode' = new.provider_code
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'domain' = new.domain_name::text
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'ambiguous' = 'false'
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'providerEffectsAuthorized' = 'false'
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'captureAuthorized' = 'false'
    and new.reconciliation_outcome -> 'finalChargeEvidence' ->>
          'refundAuthorized' = 'false'
    and ss.project_legal_json_digest(
          (new.reconciliation_outcome -> 'finalChargeEvidence') -
            'fingerprint'
        ) = new.reconciliation_outcome -> 'finalChargeEvidence' ->>
              'fingerprint'
    and exists (
      select 1
        from ss.domain_provider_routes route
       where route.organization_id = new.organization_id
         and route.project_id = new.project_id
         and route.id = new.provider_route_id
         and route.route_fingerprint =
               new.reconciliation_outcome -> 'finalChargeEvidence' ->>
                 'routeFingerprint'
         and route.selection_digest =
               new.reconciliation_outcome -> 'finalChargeEvidence' ->>
                 'selectionDigest'
         and route.expected_price_minor =
               (new.reconciliation_outcome -> 'finalChargeEvidence' ->
                 'price' ->> 'amountMinor')::bigint
         and route.currency =
               new.reconciliation_outcome -> 'finalChargeEvidence' ->
                 'price' ->> 'currency'
    )
  ) then
    raise exception 'domain final registrar charge evidence is invalid'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_registration_attempt_guard
before insert or update on ss.domain_provider_registration_attempts
for each row execute function ss.validate_domain_provider_attempt_v1();

create function ss.validate_domain_provider_pin_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if ss.project_legal_json_digest(new.pin_evidence) <>
       new.pin_fingerprint
    or new.pin_evidence ->> 'schema' <> new.pin_schema
    or new.pin_evidence ->> 'providerCode' <> new.provider_code
    or new.pin_evidence ->> 'registrarOfRecord' <>
       new.registrar_of_record
    or new.pin_evidence ->> 'domain' <> new.domain_name::text
  then
    raise exception 'domain provider pin evidence digest or fields changed'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
      from ss.domain_provider_routes route
      join ss.domain_provider_registration_attempts attempt
        on attempt.organization_id = route.organization_id
       and attempt.project_id = route.project_id
       and attempt.provider_route_id = route.id
     where route.organization_id = new.organization_id
       and route.project_id = new.project_id
       and route.id = new.provider_route_id
       and attempt.id = new.registration_attempt_id
       and attempt.state = 'succeeded'
       and attempt.provider_code = new.provider_code
       and attempt.domain_name = new.domain_name
       and route.provider_code = new.provider_code
       and route.registrar_of_record = new.registrar_of_record
       and route.domain_name = new.domain_name
  ) then
    raise exception 'domain provider pin does not match successful route evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger domain_provider_pin_exact_route
before insert on ss.domain_provider_pins
for each row execute function ss.validate_domain_provider_pin_v1();

create trigger domain_provider_routes_no_update
before update on ss.domain_provider_routes
for each row execute function ss.reject_update();

create trigger domain_provider_pins_no_update
before update on ss.domain_provider_pins
for each row execute function ss.reject_update();

create function ss.reject_domain_provider_evidence_delete_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name
    using errcode = '55000';
end
$$;

create trigger domain_provider_routes_no_delete
before delete on ss.domain_provider_routes
for each row execute function ss.reject_domain_provider_evidence_delete_v1();

create trigger domain_provider_registration_attempts_no_delete
before delete on ss.domain_provider_registration_attempts
for each row execute function ss.reject_domain_provider_evidence_delete_v1();

create trigger domain_provider_pins_no_delete
before delete on ss.domain_provider_pins
for each row execute function ss.reject_domain_provider_evidence_delete_v1();

alter table ss.domain_provider_routes enable row level security;
alter table ss.domain_provider_routes force row level security;
alter table ss.domain_provider_registration_attempts enable row level security;
alter table ss.domain_provider_registration_attempts force row level security;
alter table ss.domain_provider_pins enable row level security;
alter table ss.domain_provider_pins force row level security;

create policy domain_provider_routes_tenant_read
on ss.domain_provider_routes
for select using (ss.can_access_org(organization_id));

create policy domain_provider_registration_attempts_tenant_read
on ss.domain_provider_registration_attempts
for select using (ss.can_access_org(organization_id));

create policy domain_provider_pins_tenant_read
on ss.domain_provider_pins
for select using (ss.can_access_org(organization_id));

revoke all on
  ss.domain_provider_routes,
  ss.domain_provider_registration_attempts,
  ss.domain_provider_pins
from public, anon, authenticated, service_role;

grant select on
  ss.domain_provider_routes,
  ss.domain_provider_pins
to authenticated;

grant select, insert on
  ss.domain_provider_routes,
  ss.domain_provider_pins
to service_role;

grant select, insert, update on
  ss.domain_provider_registration_attempts
to service_role;

revoke all on function
  ss.validate_domain_provider_route_v1(),
  ss.validate_domain_provider_attempt_v1(),
  ss.validate_domain_provider_pin_v1(),
  ss.reject_domain_provider_evidence_delete_v1()
from public, anon, authenticated;

grant execute on function
  ss.validate_domain_provider_route_v1(),
  ss.validate_domain_provider_attempt_v1(),
  ss.validate_domain_provider_pin_v1(),
  ss.reject_domain_provider_evidence_delete_v1()
to service_role;

create function ss.domain_provider_route_persistence_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-domain-provider-route-persistence-v1-held'::text
$$;

revoke all on function ss.domain_provider_route_persistence_contract_v1()
from public, anon, authenticated;
grant execute on function ss.domain_provider_route_persistence_contract_v1()
to service_role;

commit;
