-- CARE-COMMERCE-PERSISTENCE-04: canonical held quote and invoice evidence.
begin;

do $$
begin
  if to_regprocedure('ss.hosted_care_core_contract_v1()') is null
    or to_regprocedure('ss.project_legal_json_digest(jsonb)') is null
    or to_regclass('ss.care_customer_contracts') is null
    or to_regclass('ss.care_periods') is null
    or to_regprocedure('ss.activate_hosted_edge_purge()') is null
  then
    raise exception 'CARE-CORE-01 and terminal purge authority must precede CARE-COMMERCE-PERSISTENCE-04'
      using errcode = '55000';
  end if;
end
$$;

create function ss.care_commerce_actor_is_authorized(
  target_organization_id uuid,
  target_actor_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select
    ss.current_service_actor_kind() = 'operator'
    and ss.current_service_actor_org_id() is not distinct from target_organization_id
    and ss.current_service_actor_user_id() is not distinct from target_actor_id
    and ss.service_operator_has_capability(
      target_actor_id, 'service_management_manage', clock_timestamp()
    )
    and ss.service_operator_has_capability(
      target_actor_id, 'service_invoice_manage', clock_timestamp()
    )
$$;

-- Reuse migration 121's canonical Care command ledger. A commerce command is
-- inserted atomically with its result, so a failed preparation leaves no
-- durable claim and a concurrent winner forces the loser to retry/read back.
alter table ss.care_commands
  drop constraint care_commands_action_check,
  drop constraint care_commands_resource_kind_check;
alter table ss.care_commands
  add constraint care_commands_action_check check (action in (
    'contract_register', 'period_open', 'period_close', 'scope_claim',
    'ticket_open', 'ticket_start', 'ticket_wait', 'ticket_resume',
    'ticket_resolve', 'ticket_reopen', 'ticket_close', 'capacity_allocate',
    'care_quote_create', 'care_invoice_reserve',
    'care_reservation_cancel', 'care_reservation_ambiguity_hold'
  )),
  add constraint care_commands_resource_kind_check check (resource_kind in (
    'contract', 'period', 'scope_claim', 'ticket', 'capacity',
    'commerce_quote', 'commerce_reservation'
  ));

create or replace function ss.guard_care_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and nullif(current_setting('app.terminal_purge_project_id', true), '')::uuid
      is not distinct from old.project_id
    and exists (
      select 1 from ss.deletion_requests request
       where request.organization_id = old.organization_id
         and request.project_id = old.project_id and request.state = 'purging'
    )
  then
    return old;
  end if;
  if tg_op <> 'INSERT'
    or not ss.care_actor_is_authorized(new.organization_id)
    or new.actor_kind is distinct from ss.current_service_actor_kind()
    or (new.actor_kind = 'operator'
      and new.actor_user_id is distinct from ss.current_service_actor_user_id())
    or (new.actor_kind = 'system' and new.actor_user_id is not null)
  then
    raise exception 'Care command lacks exact held actor authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create function ss.guard_care_commerce_command_capability()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.action in (
      'care_quote_create', 'care_invoice_reserve',
      'care_reservation_cancel', 'care_reservation_ambiguity_hold'
    ) and not ss.care_commerce_actor_is_authorized(
      new.organization_id, new.actor_user_id
    )
  then
    raise exception 'Care commerce command lacks invoice authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger care_commands_commerce_capability_guard
before insert on ss.care_commands
for each row execute function ss.guard_care_commerce_command_capability();

create table ss.care_commerce_quotes (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  contract_id uuid not null,
  period_id uuid not null,
  catalog_identity_id uuid not null,
  actor_user_id uuid not null,
  command_id text not null,
  catalog_version text not null check (catalog_version = 'SS-CARE-COMMERCE-2026.1'),
  care_core_catalog_version text not null check (care_core_catalog_version = 'SS-CARE-CORE-2026.1'),
  price_version text not null check (price_version = 'SS-CUSTOM-SERVICES-2026-08-05.1'),
  commercial_contract_digest ss.sha256_hex not null
    check (commercial_contract_digest = '9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8'),
  catalog_digest ss.sha256_hex not null,
  eligibility_digest ss.sha256_hex not null,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  state text not null check (state = 'held'),
  component_key text not null check (component_key ~ '^[a-z][a-z0-9_]{2,119}$'),
  quantity integer not null check (quantity between 1 and 100),
  unit_amount_minor integer not null check (unit_amount_minor > 0),
  subtotal_minor integer not null check (subtotal_minor = quantity * unit_amount_minor),
  currency text not null check (currency = 'USD'),
  tax_state text not null check (tax_state = 'held'),
  tax_mode text,
  tax_minor integer,
  total_minor integer,
  payable boolean not null check (not payable),
  dispatch_authorized boolean not null check (not dispatch_authorized),
  customer_effects_authorized boolean not null check (not customer_effects_authorized),
  payment_effects_authorized boolean not null check (not payment_effects_authorized),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  disclosure_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null,
  quote_document jsonb not null
    check (jsonb_typeof(quote_document) = 'object' and pg_column_size(quote_document) <= 131072),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, contract_id)
    references ss.care_customer_contracts(organization_id, project_id, id),
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  foreign key (organization_id, command_id)
    references ss.care_commands(organization_id, command_id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, command_id),
  check (tax_mode is null and tax_minor is null and total_minor is null),
  check (created_at >= issued_at)
);

create index care_commerce_quotes_scope
  on ss.care_commerce_quotes(organization_id, project_id, contract_id, period_id, issued_at);

create table ss.care_commerce_reservations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  contract_id uuid not null,
  period_id uuid not null,
  quote_id uuid not null,
  actor_user_id uuid not null,
  opening_command_id text not null,
  latest_command_id text not null,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  quote_digest ss.sha256_hex not null,
  eligibility_digest ss.sha256_hex not null,
  tax_evidence_digest ss.sha256_hex not null,
  state text not null check (state in ('held', 'cancelled', 'ambiguity_review_required')),
  revision bigint not null check (revision in (1, 2)),
  reservation_kind text not null check (reservation_kind = 'professional_invoice'),
  intended_provider text not null check (intended_provider = 'stripe'),
  provider_request jsonb,
  provider_effect_certainty text not null check (provider_effect_certainty in ('not_submitted', 'ambiguous')),
  hold_reason text not null check (hold_reason in (
    'care_commercial_and_tax_release_required',
    'cancelled_before_provider_submission',
    'manual_provider_reconciliation_required'
  )),
  dispatch_authorized boolean not null check (not dispatch_authorized),
  subtotal_minor integer not null check (subtotal_minor > 0),
  tax_mode text,
  tax_minor integer,
  total_minor integer,
  currency text not null check (currency = 'USD'),
  cancellation_evidence_digest ss.sha256_hex,
  ambiguity_evidence_digest ss.sha256_hex,
  customer_effects_authorized boolean not null check (not customer_effects_authorized),
  payment_effects_authorized boolean not null check (not payment_effects_authorized),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  reserved_at timestamptz not null,
  updated_at timestamptz not null check (updated_at >= reserved_at),
  reservation_digest ss.sha256_hex not null,
  reservation_document jsonb not null
    check (jsonb_typeof(reservation_document) = 'object' and pg_column_size(reservation_document) <= 131072),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, quote_id)
    references ss.care_commerce_quotes(organization_id, project_id, id),
  foreign key (organization_id, project_id, contract_id)
    references ss.care_customer_contracts(organization_id, project_id, id),
  foreign key (organization_id, project_id, period_id)
    references ss.care_periods(organization_id, project_id, id),
  foreign key (organization_id, opening_command_id)
    references ss.care_commands(organization_id, command_id),
  foreign key (organization_id, latest_command_id)
    references ss.care_commands(organization_id, command_id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, quote_id),
  unique (organization_id, opening_command_id),
  check (provider_request is null),
  check (tax_mode is null and tax_minor is null and total_minor is null),
  check (
    (state = 'held' and revision = 1
      and provider_effect_certainty = 'not_submitted'
      and hold_reason = 'care_commercial_and_tax_release_required'
      and cancellation_evidence_digest is null and ambiguity_evidence_digest is null)
    or (state = 'cancelled' and revision = 2
      and provider_effect_certainty = 'not_submitted'
      and hold_reason = 'cancelled_before_provider_submission'
      and cancellation_evidence_digest is not null and ambiguity_evidence_digest is null)
    or (state = 'ambiguity_review_required' and revision = 2
      and provider_effect_certainty = 'ambiguous'
      and hold_reason = 'manual_provider_reconciliation_required'
      and cancellation_evidence_digest is null and ambiguity_evidence_digest is not null)
  )
);

create index care_commerce_reservations_scope
  on ss.care_commerce_reservations(organization_id, project_id, contract_id, period_id, updated_at);

create table ss.care_commerce_reservation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  reservation_id uuid not null,
  quote_id uuid not null,
  command_id text not null,
  actor_user_id uuid not null,
  state text not null check (state in ('held', 'cancelled', 'ambiguity_review_required')),
  revision bigint not null check (revision in (1, 2)),
  reservation_digest ss.sha256_hex not null,
  reservation_document jsonb not null
    check (jsonb_typeof(reservation_document) = 'object' and pg_column_size(reservation_document) <= 131072),
  provider_effects_authorized boolean not null check (not provider_effects_authorized),
  recorded_at timestamptz not null,
  foreign key (organization_id, project_id, reservation_id)
    references ss.care_commerce_reservations(organization_id, project_id, id),
  foreign key (organization_id, command_id)
    references ss.care_commands(organization_id, command_id),
  unique (organization_id, reservation_id, revision),
  unique (organization_id, command_id)
);

create function ss.care_commerce_terminal_purge_allowed(
  target_organization_id uuid,
  target_project_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog, ss
as $$
  select nullif(current_setting('app.terminal_purge_project_id', true), '')::uuid
      is not distinct from target_project_id
    and exists (
      select 1 from ss.deletion_requests request
       where request.organization_id = target_organization_id
         and request.project_id = target_project_id
         and request.state = 'purging'
    )
$$;

create function ss.guard_care_commerce_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    if ss.care_commerce_terminal_purge_allowed(old.organization_id, old.project_id) then return old; end if;
    raise exception 'Care commerce quote evidence is immutable' using errcode = '55000';
  end if;
  if tg_op <> 'INSERT'
    or not ss.care_commerce_actor_is_authorized(new.organization_id, new.actor_user_id)
    or new.quote_digest <> ss.project_legal_json_digest(new.quote_document - 'quoteDigest')
    or new.quote_document ->> 'schema' <> 'sitesourcery.care-commerce-quote/v1'
    or new.quote_document ->> 'quoteId' <> new.id::text
    or new.quote_document ->> 'organizationId' <> new.organization_id::text
    or new.quote_document ->> 'projectId' <> new.project_id::text
    or new.quote_document ->> 'customerId' <> new.customer_user_id::text
    or new.quote_document ->> 'contractId' <> new.contract_id::text
    or new.quote_document ->> 'periodId' <> new.period_id::text
    or new.quote_document ->> 'catalogIdentityId' <> new.catalog_identity_id::text
    or new.quote_document ->> 'actorId' <> new.actor_user_id::text
    or new.quote_document ->> 'catalogVersion' <> new.catalog_version
    or new.quote_document ->> 'careCoreCatalogVersion' <> new.care_core_catalog_version
    or new.quote_document ->> 'priceVersion' <> new.price_version
    or new.quote_document ->> 'commercialContractDigest' <> new.commercial_contract_digest
    or new.quote_document ->> 'catalogDigest' <> new.catalog_digest
    or new.quote_document ->> 'eligibilityDigest' <> new.eligibility_digest
    or new.quote_document ->> 'serviceKey' <> new.service_key
    or new.quote_document ->> 'state' <> new.state
    or new.quote_document #>> '{line,componentKey}' <> new.component_key
    or (new.quote_document #>> '{line,quantity}')::integer <> new.quantity
    or (new.quote_document #>> '{line,unitAmountMinor}')::integer <> new.unit_amount_minor
    or (new.quote_document #>> '{line,subtotalMinor}')::integer <> new.subtotal_minor
    or new.quote_document #>> '{line,currency}' <> new.currency
    or new.quote_document #>> '{tax,state}' <> new.tax_state
    or new.quote_document #> '{tax,taxMode}' <> 'null'::jsonb
    or new.quote_document #> '{tax,taxMinor}' <> 'null'::jsonb
    or new.quote_document #> '{tax,totalMinor}' <> 'null'::jsonb
    or new.quote_document ->> 'disclosureDigest' <> new.disclosure_digest
    or (new.quote_document ->> 'issuedAt')::timestamptz <> new.issued_at
    or (new.quote_document ->> 'expiresAt')::timestamptz <> new.expires_at
    or new.quote_document -> 'payable' <> 'false'::jsonb
    or new.quote_document -> 'dispatchAuthorized' <> 'false'::jsonb
    or new.quote_document -> 'customerEffects' <> 'false'::jsonb
    or new.quote_document -> 'paymentEffects' <> 'false'::jsonb
    or new.quote_document -> 'providerEffects' <> 'false'::jsonb
    or not exists (
      select 1 from ss.care_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.command_id = new.command_id
         and command.action = 'care_quote_create'
         and command.resource_kind = 'commerce_quote'
         and command.resource_id = new.id
         and command.actor_kind = 'operator'
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.quote_digest
    )
  then
    raise exception 'Care commerce quote is not one exact held snapshot' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger care_commerce_quotes_guard
before insert or update or delete on ss.care_commerce_quotes
for each row execute function ss.guard_care_commerce_quote();

create function ss.guard_care_commerce_reservation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare
  quote_record record;
begin
  if tg_op = 'DELETE' then
    if ss.care_commerce_terminal_purge_allowed(old.organization_id, old.project_id) then return old; end if;
    raise exception 'Care commerce reservation evidence is immutable outside terminal cleanup' using errcode = '55000';
  end if;
  if not ss.care_commerce_actor_is_authorized(new.organization_id, new.actor_user_id)
    or new.reservation_digest <> ss.project_legal_json_digest(new.reservation_document - 'reservationDigest')
    or new.reservation_document ->> 'schema' <> 'sitesourcery.care-commerce-invoice-reservation/v1'
    or new.reservation_document ->> 'reservationId' <> new.id::text
    or new.reservation_document ->> 'organizationId' <> new.organization_id::text
    or new.reservation_document ->> 'projectId' <> new.project_id::text
    or new.reservation_document ->> 'customerId' <> new.customer_user_id::text
    or new.reservation_document ->> 'contractId' <> new.contract_id::text
    or new.reservation_document ->> 'periodId' <> new.period_id::text
    or new.reservation_document ->> 'quoteId' <> new.quote_id::text
    or new.reservation_document ->> 'actorId' <> new.actor_user_id::text
    or new.reservation_document ->> 'serviceKey' <> new.service_key
    or new.reservation_document ->> 'quoteDigest' <> new.quote_digest
    or new.reservation_document ->> 'eligibilityDigest' <> new.eligibility_digest
    or new.reservation_document ->> 'taxEvidenceDigest' <> new.tax_evidence_digest
    or new.reservation_document ->> 'state' <> new.state
    or (new.reservation_document ->> 'revision')::bigint <> new.revision
    or new.reservation_document ->> 'reservationKind' <> new.reservation_kind
    or new.reservation_document ->> 'intendedProvider' <> new.intended_provider
    or new.reservation_document -> 'providerRequest' <> 'null'::jsonb
    or new.reservation_document ->> 'providerEffectCertainty' <> new.provider_effect_certainty
    or new.reservation_document ->> 'holdReason' <> new.hold_reason
    or (new.reservation_document ->> 'subtotalMinor')::integer <> new.subtotal_minor
    or new.reservation_document ->> 'currency' <> new.currency
    or new.reservation_document -> 'taxMode' <> 'null'::jsonb
    or new.reservation_document -> 'taxMinor' <> 'null'::jsonb
    or new.reservation_document -> 'totalMinor' <> 'null'::jsonb
    or new.reservation_document -> 'dispatchAuthorized' <> 'false'::jsonb
    or new.reservation_document -> 'customerEffects' <> 'false'::jsonb
    or new.reservation_document -> 'paymentEffects' <> 'false'::jsonb
    or new.reservation_document -> 'providerEffects' <> 'false'::jsonb
    or (new.reservation_document ->> 'reservedAt')::timestamptz <> new.reserved_at
    or (new.reservation_document ->> 'updatedAt')::timestamptz <> new.updated_at
  then
    raise exception 'Care commerce reservation is not exact held evidence' using errcode = '23514';
  end if;
  select quote.* into quote_record from ss.care_commerce_quotes quote
   where quote.organization_id = new.organization_id and quote.project_id = new.project_id
     and quote.id = new.quote_id;
  if quote_record.id is null
    or row(quote_record.customer_user_id, quote_record.contract_id, quote_record.period_id,
           quote_record.service_key, quote_record.quote_digest, quote_record.eligibility_digest,
           quote_record.subtotal_minor, quote_record.currency)
       is distinct from
       row(new.customer_user_id, new.contract_id, new.period_id,
           new.service_key, new.quote_digest, new.eligibility_digest,
           new.subtotal_minor, new.currency)
  then
    raise exception 'Care reservation quote authority drifted' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'held' or new.revision <> 1 or new.opening_command_id <> new.latest_command_id
      or not exists (
        select 1 from ss.care_commands command
         where command.organization_id = new.organization_id
           and command.project_id = new.project_id
           and command.command_id = new.opening_command_id
           and command.action = 'care_invoice_reserve'
           and command.resource_kind = 'commerce_reservation'
           and command.resource_id = new.id
           and command.actor_kind = 'operator'
           and command.actor_user_id = new.actor_user_id
           and command.result_digest = new.reservation_digest
      )
    then
      raise exception 'Care commerce reservation lacks its exact claim' using errcode = '23514';
    end if;
  elsif row(new.id, new.organization_id, new.project_id, new.customer_user_id,
            new.contract_id, new.period_id, new.quote_id, new.opening_command_id,
            new.service_key, new.quote_digest, new.eligibility_digest,
            new.tax_evidence_digest, new.reservation_kind, new.intended_provider,
            new.provider_request, new.dispatch_authorized, new.subtotal_minor,
            new.tax_mode, new.tax_minor, new.total_minor, new.currency,
            new.customer_effects_authorized, new.payment_effects_authorized,
            new.provider_effects_authorized, new.reserved_at, new.created_at)
      is distinct from
      row(old.id, old.organization_id, old.project_id, old.customer_user_id,
          old.contract_id, old.period_id, old.quote_id, old.opening_command_id,
          old.service_key, old.quote_digest, old.eligibility_digest,
          old.tax_evidence_digest, old.reservation_kind, old.intended_provider,
          old.provider_request, old.dispatch_authorized, old.subtotal_minor,
          old.tax_mode, old.tax_minor, old.total_minor, old.currency,
          old.customer_effects_authorized, old.payment_effects_authorized,
          old.provider_effects_authorized, old.reserved_at, old.created_at)
    or old.state <> 'held' or old.revision <> 1 or new.revision <> 2
    or not (
      (new.state = 'cancelled' and new.provider_effect_certainty = 'not_submitted')
      or (new.state = 'ambiguity_review_required' and new.provider_effect_certainty = 'ambiguous')
    )
    or not exists (
      select 1 from ss.care_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.command_id = new.latest_command_id
         and command.action = case new.state
           when 'cancelled' then 'care_reservation_cancel'
           else 'care_reservation_ambiguity_hold' end
         and command.resource_kind = 'commerce_reservation'
         and command.resource_id = new.id
         and command.actor_kind = 'operator'
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.reservation_digest
    )
  then
    raise exception 'Care commerce reservation transition is fenced' using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger care_commerce_reservations_guard
before insert or update or delete on ss.care_commerce_reservations
for each row execute function ss.guard_care_commerce_reservation();

create function ss.guard_care_commerce_reservation_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    if ss.care_commerce_terminal_purge_allowed(old.organization_id, old.project_id) then return old; end if;
    raise exception 'Care commerce reservation event is immutable' using errcode = '55000';
  end if;
  if tg_op <> 'INSERT'
    or not ss.care_commerce_actor_is_authorized(new.organization_id, new.actor_user_id)
    or not exists (
      select 1 from ss.care_commerce_reservations reservation
       where reservation.organization_id = new.organization_id
         and reservation.project_id = new.project_id
         and reservation.id = new.reservation_id
         and reservation.quote_id = new.quote_id
         and reservation.latest_command_id = new.command_id
         and reservation.actor_user_id = new.actor_user_id
         and reservation.state = new.state
         and reservation.revision = new.revision
         and reservation.reservation_digest = new.reservation_digest
         and reservation.reservation_document = new.reservation_document
    )
    or not exists (
      select 1 from ss.care_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.command_id = new.command_id
         and command.resource_kind = 'commerce_reservation'
         and command.resource_id = new.reservation_id
         and command.actor_kind = 'operator'
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.reservation_digest
    )
  then
    raise exception 'Care commerce reservation event does not match current evidence' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger care_commerce_reservation_events_guard
before insert or update or delete on ss.care_commerce_reservation_events
for each row execute function ss.guard_care_commerce_reservation_event();

create function ss.activate_care_commerce_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb) || jsonb_build_object(
      'careCommerceCommands', (select count(*) from ss.care_commands
        where project_id = new.project_id and action in (
          'care_quote_create', 'care_invoice_reserve',
          'care_reservation_cancel', 'care_reservation_ambiguity_hold'
        )),
      'careCommerceQuotes', (select count(*) from ss.care_commerce_quotes where project_id = new.project_id),
      'careCommerceReservations', (select count(*) from ss.care_commerce_reservations where project_id = new.project_id),
      'careCommerceReservationEvents', (select count(*) from ss.care_commerce_reservation_events where project_id = new.project_id)
    );
  end if;
  return new;
end
$$;

create trigger deletion_requests_activate_care_commerce_purge
before insert or update of state on ss.deletion_requests
for each row execute function ss.activate_care_commerce_purge();

create function ss.purge_care_commerce_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if old.lifecycle <> 'deleting' and new.lifecycle = 'deleting' then
    if not ss.care_commerce_terminal_purge_allowed(new.organization_id, new.id) then
      raise exception 'Care commerce purge requires sealed terminal deletion' using errcode = '42501';
    end if;
    delete from ss.care_commerce_reservation_events where project_id = new.id;
    delete from ss.care_commerce_reservations where project_id = new.id;
    delete from ss.care_commerce_quotes where project_id = new.id;
    delete from ss.care_commands where project_id = new.id and action in (
      'care_quote_create', 'care_invoice_reserve',
      'care_reservation_cancel', 'care_reservation_ambiguity_hold'
    );
  end if;
  return new;
end
$$;

create trigger projects_purge_care_commerce
before update of lifecycle on ss.projects
for each row execute function ss.purge_care_commerce_on_project_seal();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'care_commerce_quotes', 'care_commerce_reservations',
    'care_commerce_reservation_events'
  ] loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format('revoke all on table ss.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end
$$;

grant select on ss.care_commerce_quotes, ss.care_commerce_reservations,
  ss.care_commerce_reservation_events to service_role;
grant insert on ss.care_commerce_quotes, ss.care_commerce_reservations,
  ss.care_commerce_reservation_events to service_role;
grant update on ss.care_commerce_reservations to service_role;

revoke all on function ss.care_commerce_actor_is_authorized(uuid,uuid),
  ss.care_commerce_terminal_purge_allowed(uuid,uuid),
  ss.guard_care_commerce_command_capability(), ss.guard_care_commerce_quote(),
  ss.guard_care_commerce_reservation(), ss.guard_care_commerce_reservation_event(),
  ss.activate_care_commerce_purge(), ss.purge_care_commerce_on_project_seal()
from public, anon, authenticated, service_role;
grant execute on function ss.care_commerce_actor_is_authorized(uuid,uuid)
to service_role;

create function ss.hosted_care_commerce_persistence_contract_v1()
returns text language sql stable set search_path = pg_catalog
as $$
  select 'canonical-care-commerce-v1-held-command-quote-one-per-quote-reservation'::text
$$;
revoke all on function ss.hosted_care_commerce_persistence_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_care_commerce_persistence_contract_v1()
to service_role;

commit;
