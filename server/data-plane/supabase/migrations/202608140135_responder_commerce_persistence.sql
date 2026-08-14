-- RESPONDER-COMMERCE-01: exact held setup/monthly commercial persistence.
begin;

do $$
begin
  if to_regprocedure('ss.hosted_responder_core_contract_v1()') is null
    or to_regprocedure('ss.project_legal_json_digest(jsonb)') is null
    or to_regprocedure('ss.activate_hosted_edge_purge()') is null
    or to_regclass('ss.projects') is null
    or to_regclass('ss.organization_memberships') is null
  then
    raise exception 'Responder core, hosted identity, and terminal purge authority must precede RESPONDER-COMMERCE-01'
      using errcode = '55000';
  end if;
end
$$;

create function ss.responder_commerce_actor_is_authorized(
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

create function ss.responder_commerce_terminal_purge_allowed(
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

create table ss.responder_commerce_catalog (
  id uuid primary key,
  catalog_version text not null unique
    check (catalog_version = 'SS-RESPONDER-COMMERCE-2026.1'),
  source_authority_digest ss.sha256_hex not null
    check (source_authority_digest =
      'b62255bdcea5f04882ac1b6bbb415069410c915858bb6a4b26fb3598fa28613c'),
  catalog_digest ss.sha256_hex not null unique
    check (catalog_digest =
      '49961dfa89ca4780aa7c5cfc55728ba7c0eddb2851eb73c400d847184e6f8424'),
  product_key text not null check (product_key = 'responder'),
  currency text not null check (currency = 'USD'),
  state text not null check (state = 'held'),
  setup_amount_minor integer not null check (setup_amount_minor = 30000),
  monthly_amount_minor integer not null check (monthly_amount_minor = 25000),
  initial_subtotal_minor integer not null check (initial_subtotal_minor = 55000),
  recurring_cadence text not null check (recurring_cadence = 'month'),
  tax_state text not null check (tax_state = 'disabled_by_owner'),
  sellable boolean not null check (not sellable),
  customer_acceptance_authorized boolean not null
    check (not customer_acceptance_authorized),
  invoice_dispatch_authorized boolean not null
    check (not invoice_dispatch_authorized),
  mail_delivery_effects_authorized boolean not null
    check (not mail_delivery_effects_authorized),
  payment_effects_authorized boolean not null
    check (not payment_effects_authorized),
  provider_effects_authorized boolean not null
    check (not provider_effects_authorized),
  created_at timestamptz not null
);

insert into ss.responder_commerce_catalog (
  id,catalog_version,source_authority_digest,catalog_digest,product_key,
  currency,state,setup_amount_minor,monthly_amount_minor,
  initial_subtotal_minor,recurring_cadence,tax_state,sellable,
  customer_acceptance_authorized,invoice_dispatch_authorized,
  mail_delivery_effects_authorized,payment_effects_authorized,
  provider_effects_authorized,created_at
) values (
  '00000000-0000-4000-8000-000000001351',
  'SS-RESPONDER-COMMERCE-2026.1',
  'b62255bdcea5f04882ac1b6bbb415069410c915858bb6a4b26fb3598fa28613c',
  '49961dfa89ca4780aa7c5cfc55728ba7c0eddb2851eb73c400d847184e6f8424',
  'responder','USD','held',30000,25000,55000,'month',
  'disabled_by_owner',false,false,false,false,false,false,
  '2026-08-14T13:55:01-04:00'::timestamptz
);

create trigger responder_commerce_catalog_immutable
before insert or update or delete on ss.responder_commerce_catalog
for each row execute function ss.reject_update();

create table ss.responder_commerce_commands (
  id uuid primary key,
  organization_id uuid not null references ss.organizations(id),
  project_id uuid not null,
  customer_user_id uuid not null references auth.users(id),
  command_id text not null check (
    char_length(command_id) between 8 and 200
    and command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  ),
  operation text not null check (operation in (
    'responder_quote_create','responder_billing_reserve',
    'responder_reservation_cancel','responder_reservation_ambiguity_hold'
  )),
  resource_kind text not null check (resource_kind in (
    'quote','billing_reservation'
  )),
  resource_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  request_digest ss.sha256_hex not null,
  result_digest ss.sha256_hex not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  unique (organization_id, command_id),
  unique (organization_id, id),
  check (created_at = recorded_at)
);

create table ss.responder_commerce_quotes (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  catalog_id uuid not null references ss.responder_commerce_catalog(id),
  actor_user_id uuid not null references auth.users(id),
  command_id text not null,
  catalog_version text not null
    check (catalog_version = 'SS-RESPONDER-COMMERCE-2026.1'),
  source_authority_digest ss.sha256_hex not null
    check (source_authority_digest =
      'b62255bdcea5f04882ac1b6bbb415069410c915858bb6a4b26fb3598fa28613c'),
  catalog_digest ss.sha256_hex not null
    check (catalog_digest =
      '49961dfa89ca4780aa7c5cfc55728ba7c0eddb2851eb73c400d847184e6f8424'),
  eligibility_digest ss.sha256_hex not null,
  state text not null check (state = 'held'),
  setup_amount_minor integer not null check (setup_amount_minor = 30000),
  monthly_amount_minor integer not null check (monthly_amount_minor = 25000),
  initial_subtotal_minor integer not null check (initial_subtotal_minor = 55000),
  currency text not null check (currency = 'USD'),
  recurring_cadence text not null check (recurring_cadence = 'month'),
  tax_state text not null check (tax_state = 'disabled_by_owner'),
  tax_minor integer not null check (tax_minor = 0),
  initial_total_minor integer not null check (initial_total_minor = 55000),
  payable boolean not null check (not payable),
  dispatch_authorized boolean not null check (not dispatch_authorized),
  customer_acceptance_authorized boolean not null
    check (not customer_acceptance_authorized),
  customer_effects_authorized boolean not null
    check (not customer_effects_authorized),
  mail_delivery_effects_authorized boolean not null
    check (not mail_delivery_effects_authorized),
  payment_effects_authorized boolean not null
    check (not payment_effects_authorized),
  provider_effects_authorized boolean not null
    check (not provider_effects_authorized),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  disclosure_digest ss.sha256_hex not null,
  quote_digest ss.sha256_hex not null unique,
  quote_document jsonb not null check (
    jsonb_typeof(quote_document) = 'object'
    and pg_column_size(quote_document) <= 131072
  ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (organization_id, command_id)
    references ss.responder_commerce_commands(organization_id, command_id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, command_id),
  check (created_at >= issued_at)
);

create index responder_commerce_quotes_scope
  on ss.responder_commerce_quotes(
    organization_id, project_id, customer_user_id, issued_at desc, id
  );

create table ss.responder_commerce_reservations (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null,
  quote_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  opening_command_id text not null,
  latest_command_id text not null,
  quote_digest ss.sha256_hex not null,
  eligibility_digest ss.sha256_hex not null,
  state text not null check (state in (
    'held','cancelled','ambiguity_review_required'
  )),
  revision bigint not null check (revision in (1,2)),
  reservation_kind text not null
    check (reservation_kind = 'responder_setup_and_monthly'),
  intended_provider text not null check (intended_provider = 'stripe'),
  provider_request jsonb check (provider_request is null),
  provider_effect_certainty text not null check (
    provider_effect_certainty in ('not_submitted','ambiguous')
  ),
  hold_reason text not null check (hold_reason in (
    'responder_catalog_legal_provider_release_required',
    'cancelled_before_provider_submission',
    'manual_provider_reconciliation_required'
  )),
  dispatch_authorized boolean not null check (not dispatch_authorized),
  customer_acceptance_authorized boolean not null
    check (not customer_acceptance_authorized),
  setup_amount_minor integer not null check (setup_amount_minor = 30000),
  monthly_amount_minor integer not null check (monthly_amount_minor = 25000),
  initial_subtotal_minor integer not null check (initial_subtotal_minor = 55000),
  tax_state text not null check (tax_state = 'disabled_by_owner'),
  tax_minor integer not null check (tax_minor = 0),
  initial_total_minor integer not null check (initial_total_minor = 55000),
  currency text not null check (currency = 'USD'),
  cancellation_evidence_digest ss.sha256_hex,
  ambiguity_evidence_digest ss.sha256_hex,
  customer_effects_authorized boolean not null
    check (not customer_effects_authorized),
  mail_delivery_effects_authorized boolean not null
    check (not mail_delivery_effects_authorized),
  payment_effects_authorized boolean not null
    check (not payment_effects_authorized),
  provider_effects_authorized boolean not null
    check (not provider_effects_authorized),
  reserved_at timestamptz not null,
  updated_at timestamptz not null check (updated_at >= reserved_at),
  reservation_digest ss.sha256_hex not null,
  reservation_document jsonb not null check (
    jsonb_typeof(reservation_document) = 'object'
    and pg_column_size(reservation_document) <= 131072
  ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id, quote_id)
    references ss.responder_commerce_quotes(organization_id, project_id, id),
  foreign key (organization_id, customer_user_id)
    references ss.organization_memberships(organization_id, user_id),
  foreign key (organization_id, opening_command_id)
    references ss.responder_commerce_commands(organization_id, command_id),
  foreign key (organization_id, latest_command_id)
    references ss.responder_commerce_commands(organization_id, command_id),
  unique (organization_id, id),
  unique (organization_id, project_id, id),
  unique (organization_id, quote_id),
  unique (organization_id, opening_command_id),
  check (
    (state = 'held' and revision = 1
      and provider_effect_certainty = 'not_submitted'
      and hold_reason = 'responder_catalog_legal_provider_release_required'
      and cancellation_evidence_digest is null
      and ambiguity_evidence_digest is null)
    or (state = 'cancelled' and revision = 2
      and provider_effect_certainty = 'not_submitted'
      and hold_reason = 'cancelled_before_provider_submission'
      and cancellation_evidence_digest is not null
      and ambiguity_evidence_digest is null)
    or (state = 'ambiguity_review_required' and revision = 2
      and provider_effect_certainty = 'ambiguous'
      and hold_reason = 'manual_provider_reconciliation_required'
      and cancellation_evidence_digest is null
      and ambiguity_evidence_digest is not null)
  )
);

create index responder_commerce_reservations_scope
  on ss.responder_commerce_reservations(
    organization_id, project_id, customer_user_id, updated_at desc, id
  );

create table ss.responder_commerce_reservation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  reservation_id uuid not null,
  quote_id uuid not null,
  command_id text not null,
  actor_user_id uuid not null,
  state text not null check (state in (
    'held','cancelled','ambiguity_review_required'
  )),
  revision bigint not null check (revision in (1,2)),
  reservation_digest ss.sha256_hex not null,
  reservation_document jsonb not null check (
    jsonb_typeof(reservation_document) = 'object'
    and pg_column_size(reservation_document) <= 131072
  ),
  provider_effects_authorized boolean not null
    check (not provider_effects_authorized),
  recorded_at timestamptz not null,
  foreign key (organization_id, project_id, reservation_id)
    references ss.responder_commerce_reservations(
      organization_id, project_id, id
    ),
  foreign key (organization_id, command_id)
    references ss.responder_commerce_commands(organization_id, command_id),
  unique (organization_id, reservation_id, revision),
  unique (organization_id, command_id)
);

create function ss.guard_responder_commerce_command()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    if ss.responder_commerce_terminal_purge_allowed(
      old.organization_id, old.project_id
    ) then return old; end if;
    raise exception 'Responder commerce command evidence is immutable'
      using errcode = '55000';
  end if;
  if tg_op <> 'INSERT'
    or not ss.responder_commerce_actor_is_authorized(
      new.organization_id, new.actor_user_id
    )
    or not exists (
      select 1 from ss.organization_memberships membership
       where membership.organization_id = new.organization_id
         and membership.user_id = new.customer_user_id
         and membership.state = 'active'
         and membership.role in ('owner','admin','billing')
    )
    or (new.resource_kind = 'quote'
      and new.operation <> 'responder_quote_create')
    or (new.resource_kind = 'billing_reservation'
      and new.operation not in (
        'responder_billing_reserve','responder_reservation_cancel',
        'responder_reservation_ambiguity_hold'
      ))
  then
    raise exception 'Responder commerce command lacks exact invoice authority'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger responder_commerce_commands_guard
before insert or update or delete on ss.responder_commerce_commands
for each row execute function ss.guard_responder_commerce_command();

create function ss.guard_responder_commerce_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    if ss.responder_commerce_terminal_purge_allowed(
      old.organization_id, old.project_id
    ) then return old; end if;
    raise exception 'Responder commerce quote evidence is immutable'
      using errcode = '55000';
  end if;
  if tg_op <> 'INSERT'
    or not ss.responder_commerce_actor_is_authorized(
      new.organization_id, new.actor_user_id
    )
    or new.quote_digest is distinct from
      ss.project_legal_json_digest(new.quote_document - 'quoteDigest')
    or new.quote_document ->> 'schema' is distinct from
      'sitesourcery.responder-commerce-quote/v1'
    or new.quote_document ->> 'quoteId' is distinct from new.id::text
    or new.quote_document ->> 'organizationId' is distinct from new.organization_id::text
    or new.quote_document ->> 'projectId' is distinct from new.project_id::text
    or new.quote_document ->> 'customerId' is distinct from new.customer_user_id::text
    or new.quote_document ->> 'actorId' is distinct from new.actor_user_id::text
    or new.quote_document ->> 'catalogId' is distinct from new.catalog_id::text
    or new.quote_document ->> 'catalogVersion' is distinct from new.catalog_version
    or new.quote_document ->> 'sourceAuthorityDigest' is distinct from
      new.source_authority_digest
    or new.quote_document ->> 'catalogDigest' is distinct from new.catalog_digest
    or new.quote_document ->> 'eligibilityDigest' is distinct from new.eligibility_digest
    or new.quote_document ->> 'state' is distinct from 'held'
    or (new.quote_document #>> '{billing,setupAmountMinor}')::integer is distinct from 30000
    or (new.quote_document #>> '{billing,monthlyAmountMinor}')::integer is distinct from 25000
    or (new.quote_document #>> '{billing,initialSubtotalMinor}')::integer is distinct from 55000
    or new.quote_document #>> '{billing,currency}' is distinct from 'USD'
    or new.quote_document #>> '{billing,recurringCadence}' is distinct from 'month'
    or new.quote_document #>> '{tax,state}' is distinct from 'disabled_by_owner'
    or (new.quote_document #>> '{tax,amountMinor}')::integer is distinct from 0
    or (new.quote_document #>> '{tax,initialTotalMinor}')::integer is distinct from 55000
    or new.quote_document ->> 'disclosureDigest' is distinct from new.disclosure_digest
    or (new.quote_document ->> 'issuedAt')::timestamptz is distinct from new.issued_at
    or (new.quote_document ->> 'expiresAt')::timestamptz is distinct from new.expires_at
    or new.quote_document -> 'payable' is distinct from 'false'::jsonb
    or new.quote_document -> 'dispatchAuthorized' is distinct from 'false'::jsonb
    or new.quote_document -> 'customerAcceptanceAuthorized' is distinct from 'false'::jsonb
    or new.quote_document -> 'customerEffects' is distinct from 'false'::jsonb
    or new.quote_document -> 'mailDeliveryEffects' is distinct from 'false'::jsonb
    or new.quote_document -> 'paymentEffects' is distinct from 'false'::jsonb
    or new.quote_document -> 'providerEffects' is distinct from 'false'::jsonb
    or not exists (
      select 1 from ss.responder_commerce_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.customer_user_id = new.customer_user_id
         and command.command_id = new.command_id
         and command.operation = 'responder_quote_create'
         and command.resource_kind = 'quote'
         and command.resource_id = new.id
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.quote_digest
    )
  then
    raise exception 'Responder commerce quote is not one exact held snapshot'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_commerce_quotes_guard
before insert or update or delete on ss.responder_commerce_quotes
for each row execute function ss.guard_responder_commerce_quote();

create function ss.guard_responder_commerce_reservation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
declare quote_record record;
begin
  if tg_op = 'DELETE' then
    if ss.responder_commerce_terminal_purge_allowed(
      old.organization_id, old.project_id
    ) then return old; end if;
    raise exception 'Responder commerce reservation evidence is immutable'
      using errcode = '55000';
  end if;
  if not ss.responder_commerce_actor_is_authorized(
      new.organization_id, new.actor_user_id
    )
    or new.reservation_digest is distinct from
      ss.project_legal_json_digest(
        new.reservation_document - 'reservationDigest'
      )
    or new.reservation_document ->> 'schema' is distinct from
      'sitesourcery.responder-commerce-billing-reservation/v1'
    or new.reservation_document ->> 'reservationId' is distinct from new.id::text
    or new.reservation_document ->> 'organizationId' is distinct from new.organization_id::text
    or new.reservation_document ->> 'projectId' is distinct from new.project_id::text
    or new.reservation_document ->> 'customerId' is distinct from new.customer_user_id::text
    or new.reservation_document ->> 'quoteId' is distinct from new.quote_id::text
    or new.reservation_document ->> 'actorId' is distinct from new.actor_user_id::text
    or new.reservation_document ->> 'quoteDigest' is distinct from new.quote_digest
    or new.reservation_document ->> 'eligibilityDigest' is distinct from new.eligibility_digest
    or new.reservation_document ->> 'state' is distinct from new.state
    or (new.reservation_document ->> 'revision')::bigint is distinct from new.revision
    or new.reservation_document ->> 'reservationKind' is distinct from new.reservation_kind
    or new.reservation_document ->> 'intendedProvider' is distinct from new.intended_provider
    or new.reservation_document -> 'providerRequest' is distinct from 'null'::jsonb
    or new.reservation_document ->> 'providerEffectCertainty' is distinct from
      new.provider_effect_certainty
    or new.reservation_document ->> 'holdReason' is distinct from new.hold_reason
    or (new.reservation_document ->> 'initialSubtotalMinor')::integer is distinct from 55000
    or new.reservation_document ->> 'taxState' is distinct from 'disabled_by_owner'
    or (new.reservation_document ->> 'taxMinor')::integer is distinct from 0
    or (new.reservation_document ->> 'initialTotalMinor')::integer is distinct from 55000
    or new.reservation_document ->> 'currency' is distinct from 'USD'
    or jsonb_array_length(new.reservation_document -> 'paymentPurposes') is distinct from 2
    or new.reservation_document #>> '{paymentPurposes,0,purpose}' is distinct from
      'responder_setup'
    or (new.reservation_document #>>
      '{paymentPurposes,0,amountMinor}')::integer is distinct from 30000
    or new.reservation_document #>> '{paymentPurposes,0,cadence}'
      is distinct from 'one_time'
    or new.reservation_document #>> '{paymentPurposes,1,purpose}' is distinct from
      'responder_monthly'
    or (new.reservation_document #>>
      '{paymentPurposes,1,amountMinor}')::integer is distinct from 25000
    or new.reservation_document #>> '{paymentPurposes,1,cadence}'
      is distinct from 'month'
    or (new.reservation_document #>>
      '{paymentPurposes,1,intervalCount}')::integer is distinct from 1
    or new.reservation_document -> 'dispatchAuthorized' is distinct from 'false'::jsonb
    or new.reservation_document -> 'customerAcceptanceAuthorized' is distinct from
      'false'::jsonb
    or new.reservation_document -> 'customerEffects' is distinct from 'false'::jsonb
    or new.reservation_document -> 'mailDeliveryEffects' is distinct from 'false'::jsonb
    or new.reservation_document -> 'paymentEffects' is distinct from 'false'::jsonb
    or new.reservation_document -> 'providerEffects' is distinct from 'false'::jsonb
    or new.reservation_document ->> 'cancellationEvidenceDigest'
      is distinct from new.cancellation_evidence_digest
    or new.reservation_document ->> 'ambiguityEvidenceDigest'
      is distinct from new.ambiguity_evidence_digest
    or (new.reservation_document ->> 'reservedAt')::timestamptz is distinct from
      new.reserved_at
    or (new.reservation_document ->> 'updatedAt')::timestamptz is distinct from
      new.updated_at
  then
    raise exception 'Responder commerce reservation is not exact held evidence'
      using errcode = '23514';
  end if;
  select quote.* into quote_record
    from ss.responder_commerce_quotes quote
   where quote.organization_id = new.organization_id
     and quote.project_id = new.project_id and quote.id = new.quote_id;
  if not found then
    raise exception 'Responder reservation quote authority drifted'
      using errcode = '23514';
  end if;
  if row(
      quote_record.customer_user_id,quote_record.quote_digest,
      quote_record.eligibility_digest,quote_record.setup_amount_minor,
      quote_record.monthly_amount_minor,quote_record.initial_subtotal_minor,
      quote_record.tax_state,quote_record.tax_minor,
      quote_record.initial_total_minor,quote_record.currency
    ) is distinct from row(
      new.customer_user_id,new.quote_digest,new.eligibility_digest,
      new.setup_amount_minor,new.monthly_amount_minor,
      new.initial_subtotal_minor,new.tax_state,new.tax_minor,
      new.initial_total_minor,new.currency
    )
  then
    raise exception 'Responder reservation quote authority drifted'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'held' or new.revision <> 1
      or new.opening_command_id <> new.latest_command_id
      or not exists (
        select 1 from ss.responder_commerce_commands command
         where command.organization_id = new.organization_id
           and command.project_id = new.project_id
           and command.customer_user_id = new.customer_user_id
           and command.command_id = new.opening_command_id
           and command.operation = 'responder_billing_reserve'
           and command.resource_kind = 'billing_reservation'
           and command.resource_id = new.id
           and command.actor_user_id = new.actor_user_id
           and command.result_digest = new.reservation_digest
      )
    then
      raise exception 'Responder reservation lacks its exact claim'
        using errcode = '23514';
    end if;
  elsif row(
      new.id,new.organization_id,new.project_id,new.customer_user_id,
      new.quote_id,new.opening_command_id,new.quote_digest,
      new.eligibility_digest,new.reservation_kind,new.intended_provider,
      new.provider_request,new.dispatch_authorized,
      new.customer_acceptance_authorized,new.setup_amount_minor,
      new.monthly_amount_minor,new.initial_subtotal_minor,new.tax_state,
      new.tax_minor,new.initial_total_minor,new.currency,
      new.customer_effects_authorized,new.mail_delivery_effects_authorized,
      new.payment_effects_authorized,new.provider_effects_authorized,
      new.reserved_at,new.created_at
    ) is distinct from row(
      old.id,old.organization_id,old.project_id,old.customer_user_id,
      old.quote_id,old.opening_command_id,old.quote_digest,
      old.eligibility_digest,old.reservation_kind,old.intended_provider,
      old.provider_request,old.dispatch_authorized,
      old.customer_acceptance_authorized,old.setup_amount_minor,
      old.monthly_amount_minor,old.initial_subtotal_minor,old.tax_state,
      old.tax_minor,old.initial_total_minor,old.currency,
      old.customer_effects_authorized,old.mail_delivery_effects_authorized,
      old.payment_effects_authorized,old.provider_effects_authorized,
      old.reserved_at,old.created_at
    )
    or old.state <> 'held' or old.revision <> 1 or new.revision <> 2
    or not (
      (new.state = 'cancelled'
        and new.provider_effect_certainty = 'not_submitted')
      or (new.state = 'ambiguity_review_required'
        and new.provider_effect_certainty = 'ambiguous')
    )
    or not exists (
      select 1 from ss.responder_commerce_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.customer_user_id = new.customer_user_id
         and command.command_id = new.latest_command_id
         and command.operation = case new.state
           when 'cancelled' then 'responder_reservation_cancel'
           else 'responder_reservation_ambiguity_hold' end
         and command.resource_kind = 'billing_reservation'
         and command.resource_id = new.id
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.reservation_digest
    )
  then
    raise exception 'Responder commerce reservation transition is fenced'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger responder_commerce_reservations_guard
before insert or update or delete on ss.responder_commerce_reservations
for each row execute function ss.guard_responder_commerce_reservation();

create function ss.guard_responder_commerce_reservation_event()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    if ss.responder_commerce_terminal_purge_allowed(
      old.organization_id, old.project_id
    ) then return old; end if;
    raise exception 'Responder commerce reservation event is immutable'
      using errcode = '55000';
  end if;
  if tg_op <> 'INSERT'
    or not ss.responder_commerce_actor_is_authorized(
      new.organization_id, new.actor_user_id
    )
    or not exists (
      select 1 from ss.responder_commerce_reservations reservation
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
      select 1 from ss.responder_commerce_commands command
       where command.organization_id = new.organization_id
         and command.project_id = new.project_id
         and command.command_id = new.command_id
         and command.resource_kind = 'billing_reservation'
         and command.resource_id = new.reservation_id
         and command.actor_user_id = new.actor_user_id
         and command.result_digest = new.reservation_digest
    )
  then
    raise exception 'Responder reservation event does not match current evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger responder_commerce_reservation_events_guard
before insert or update or delete
on ss.responder_commerce_reservation_events
for each row execute function ss.guard_responder_commerce_reservation_event();

create function ss.activate_responder_commerce_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    new.removal_counts := coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'responderCommerceCommands', (select count(*)
          from ss.responder_commerce_commands where project_id = new.project_id),
        'responderCommerceQuotes', (select count(*)
          from ss.responder_commerce_quotes where project_id = new.project_id),
        'responderCommerceReservations', (select count(*)
          from ss.responder_commerce_reservations where project_id = new.project_id),
        'responderCommerceReservationEvents', (select count(*)
          from ss.responder_commerce_reservation_events
          where project_id = new.project_id)
      );
  end if;
  return new;
end
$$;

create trigger deletion_requests_activate_responder_commerce_purge
before insert or update of state on ss.deletion_requests
for each row execute function ss.activate_responder_commerce_purge();

create function ss.purge_responder_commerce_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if old.lifecycle <> 'deleting' and new.lifecycle = 'deleting' then
    if not ss.responder_commerce_terminal_purge_allowed(
      new.organization_id, new.id
    ) then
      raise exception 'Responder commerce purge requires sealed terminal deletion'
        using errcode = '42501';
    end if;
    delete from ss.responder_commerce_reservation_events
      where project_id = new.id;
    delete from ss.responder_commerce_reservations where project_id = new.id;
    delete from ss.responder_commerce_quotes where project_id = new.id;
    delete from ss.responder_commerce_commands where project_id = new.id;
  end if;
  return new;
end
$$;

create trigger projects_purge_responder_commerce
before update of lifecycle on ss.projects
for each row execute function ss.purge_responder_commerce_on_project_seal();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'responder_commerce_catalog','responder_commerce_commands',
    'responder_commerce_quotes','responder_commerce_reservations',
    'responder_commerce_reservation_events'
  ] loop
    execute format('alter table ss.%I enable row level security', table_name);
    execute format('alter table ss.%I force row level security', table_name);
    execute format(
      'revoke all on table ss.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;
end
$$;

grant select on
  ss.responder_commerce_catalog,
  ss.responder_commerce_commands,
  ss.responder_commerce_quotes,
  ss.responder_commerce_reservations,
  ss.responder_commerce_reservation_events
to service_role;
grant insert on
  ss.responder_commerce_commands,
  ss.responder_commerce_quotes,
  ss.responder_commerce_reservations,
  ss.responder_commerce_reservation_events
to service_role;
grant update on ss.responder_commerce_reservations to service_role;

revoke all on function
  ss.responder_commerce_actor_is_authorized(uuid,uuid),
  ss.responder_commerce_terminal_purge_allowed(uuid,uuid),
  ss.guard_responder_commerce_command(),
  ss.guard_responder_commerce_quote(),
  ss.guard_responder_commerce_reservation(),
  ss.guard_responder_commerce_reservation_event(),
  ss.activate_responder_commerce_purge(),
  ss.purge_responder_commerce_on_project_seal()
from public, anon, authenticated, service_role;
grant execute on function
  ss.responder_commerce_actor_is_authorized(uuid,uuid)
to service_role;

create function ss.hosted_responder_commerce_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'canonical-responder-commerce-v1-held-30000-25000-no-provider-effect'::text
$$;
revoke all on function ss.hosted_responder_commerce_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.hosted_responder_commerce_contract_v1()
to service_role;

commit;
