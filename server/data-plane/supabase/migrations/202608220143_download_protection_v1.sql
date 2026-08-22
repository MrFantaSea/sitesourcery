-- FIN-012: preserve historical $5 Download evidence while making every newly
-- issued Download a $20 verified-account purchase with durable acceptance,
-- velocity control, a real-signal circuit breaker, access evidence, and a
-- private dispute dossier. This migration opens no provider or payment switch.

begin;

do $$
begin
  if to_regprocedure('ss.hosted_joint_legal_v5_contract()') is null
    or to_regclass('ss.commerce_v2_download_quotes') is null
    or to_regclass('ss.commerce_v2_checkout_preparations') is null
    or to_regclass('ss.commerce_v2_download_payment_receipts') is null
    or to_regclass('ss.commerce_v2_project_entitlements') is null
  then
    raise exception
      'Site Sourcery migration 142 and Download settlement must precede FIN-012 protection'
      using errcode = '55000';
  end if;
end
$$;

-- Preserve the historical contract exactly while admitting only the paired
-- successor catalog/terms/price tuple for newly issued quotes.
do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid =
             'ss.commerce_v2_download_quotes'::regclass
       and constraint_row.contype = 'c'
       and (
         pg_get_constraintdef(constraint_row.oid) like
           '%spark-actions.2026-07-30.v1%'
         or pg_get_constraintdef(constraint_row.oid) like
           '%spark-actions-held.2026-07-30.v1%'
         or pg_get_constraintdef(constraint_row.oid) ~
           'amount_minor = 500([^0-9]|$)'
       )
  loop
    execute format(
      'alter table ss.commerce_v2_download_quotes drop constraint %I',
      selected.conname
    );
  end loop;
end
$$;

alter table ss.commerce_v2_download_quotes
  add constraint commerce_v2_download_quotes_contract_v143
  check (
    (
      catalog_version = 'spark-actions.2026-07-30.v1'
      and terms_version = 'spark-actions-held.2026-07-30.v1'
      and amount_minor = 500
    )
    or (
      catalog_version = 'spark-actions.2026-08-22.v2'
      and terms_version = 'spark-download-protection.2026-08-22.v2'
      and amount_minor = 2000
    )
  );

alter table ss.commerce_v2_checkout_preparations
  add column purchase_acceptance_schema text,
  add column purchase_acceptance_statement text,
  add column purchase_accepted_at timestamptz,
  add column acceptance_request_id text,
  add column acceptance_client_address text,
  add column acceptance_user_agent_digest ss.sha256_hex,
  add column acceptance_digest ss.sha256_hex;

do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid =
             'ss.commerce_v2_checkout_preparations'::regclass
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) like '%amountMinor%'
  loop
    execute format(
      'alter table ss.commerce_v2_checkout_preparations drop constraint %I',
      selected.conname
    );
  end loop;
end
$$;

alter table ss.commerce_v2_checkout_preparations
  add constraint commerce_v2_checkout_preparation_snapshot_v143
  check (
    (
      preparation ->> 'schema' =
        'sitesourcery.abracadabra-checkout-command.v2'
      and preparation ->> 'commandId' = command_id
      and preparation ->> 'quoteId' = quote_id::text
      and preparation ->> 'projectId' = project_id::text
      and preparation ->> 'versionId' = version_id::text
      and preparation ->> 'offerId' = offer_id
      and preparation ->> 'entitlementKind' = entitlement_kind
      and preparation ->> 'state' = state
      and preparation ->> 'holdReason' = hold_reason
      and preparation -> 'dispatchAuthorized' = 'false'::jsonb
      and preparation -> 'provider' = 'null'::jsonb
      and preparation ->> 'preparedAt' =
        to_char(
          prepared_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      and preparation ->> 'purposeDigest' = purpose_digest
      and preparation #>> '{purpose,tenantId}' = organization_id::text
      and preparation #>> '{purpose,customerId}' = customer_user_id::text
      and preparation #>> '{purpose,projectId}' = project_id::text
      and preparation #>> '{purpose,versionId}' = version_id::text
      and preparation #>> '{purpose,quoteId}' = quote_id::text
      and preparation #>> '{purpose,quoteSnapshotDigest}' =
        quote_snapshot_digest
      and preparation #>> '{purpose,acceptedDisclosureDigest}' =
        accepted_disclosure_digest
      and preparation #>> '{purpose,offerId}' = offer_id
      and preparation #>> '{purpose,entitlementKind}' = entitlement_kind
      and preparation #>> '{purpose,price,currency}' = 'USD'
      and preparation #>> '{purpose,price,billing}' = 'one_time'
      and preparation #> '{purpose,price,interval}' = 'null'::jsonb
      and (
        (
          preparation #> '{purpose,price,amountMinor}' = '500'::jsonb
          and not (preparation #> '{purpose}' ? 'purchaseTermsAccepted')
          and num_nonnulls(
            purchase_acceptance_schema,
            purchase_acceptance_statement,
            purchase_accepted_at,
            acceptance_request_id,
            acceptance_client_address,
            acceptance_user_agent_digest,
            acceptance_digest
          ) = 0
        )
        or (
          preparation #> '{purpose,price,amountMinor}' = '2000'::jsonb
          and preparation #> '{purpose,purchaseTermsAccepted}' = 'true'::jsonb
          and purchase_acceptance_schema =
            'sitesourcery.abracadabra-purchase-acceptance.v1'
          and purchase_acceptance_statement =
            'accepted_exact_download_quote_delivery_final_sale_and_credit_terms'
          and purchase_accepted_at = prepared_at
          and char_length(acceptance_request_id) between 1 and 200
          and char_length(acceptance_client_address) between 1 and 80
          and preparation #>> '{acceptance,schema}' =
            purchase_acceptance_schema
          and preparation #>> '{acceptance,statement}' =
            purchase_acceptance_statement
          and preparation #>> '{acceptance,acceptedAt}' =
            to_char(
              purchase_accepted_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          and preparation #>> '{acceptance,requestId}' =
            acceptance_request_id
          and preparation #>> '{acceptance,clientAddress}' =
            acceptance_client_address
          and preparation #>> '{acceptance,userAgentDigest}' =
            acceptance_user_agent_digest
          and preparation #>> '{acceptance,acceptedDisclosureDigest}' =
            accepted_disclosure_digest
        )
      )
    ) is true
  );

-- Existing receipts remain valid; the service and paired quote authority only
-- issue 2000-minor-unit successor receipts.
do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.conrelid =
             'ss.commerce_v2_download_payment_receipts'::regclass
       and constraint_row.contype = 'c'
       and pg_get_constraintdef(constraint_row.oid) ~
           'amount_minor = 500([^0-9]|$)'
  loop
    execute format(
      'alter table ss.commerce_v2_download_payment_receipts drop constraint %I',
      selected.conname
    );
  end loop;
end
$$;

alter table ss.commerce_v2_download_payment_receipts
  add constraint commerce_v2_download_receipt_amount_v143
  check (amount_minor in (500, 2000));

-- Preserve settled historical $5 Alakazam credits while admitting the new
-- exact $20 successor. Application remains once-only, same-project, and bound
-- to the active Download entitlement's original paid receipt.
do $$
declare
  selected record;
begin
  for selected in
    select constraint_row.conrelid::regclass as table_name,
           constraint_row.conname
      from pg_constraint constraint_row
     where constraint_row.contype = 'c'
       and constraint_row.conrelid in (
         'ss.alakazam_change_quotes'::regclass,
         'ss.alakazam_checkout_dispatches'::regclass,
         'ss.alakazam_payment_receipts'::regclass,
         'ss.alakazam_credit_applications'::regclass
       )
       and (
         pg_get_constraintdef(constraint_row.oid) ~
           'applied_value_minor = 500([^0-9]|$)'
         or pg_get_constraintdef(constraint_row.oid) ~
           'expected_credit_minor.*500'
         or pg_get_constraintdef(constraint_row.oid) ~
           'provider_discount_minor.*500'
         or pg_get_constraintdef(constraint_row.oid) ~
           'amount_minor = 500([^0-9]|$)'
       )
  loop
    execute format(
      'alter table %s drop constraint %I',
      selected.table_name,
      selected.conname
    );
  end loop;
end
$$;

alter table ss.alakazam_change_quotes
  add constraint alakazam_change_quote_shape_v143
  check (
    (change_kind = 'start' and (
      current_subscription_id is null
      and current_subscription_revision is null
      and current_tier_id is null
      and current_amount_minor is null
      and current_period_ends_at is null
      and applied_value_kind in ('none', 'download_purchase')
      and applied_value_minor in (0, 500, 2000)
      and (
        (
          applied_value_kind = 'none'
          and applied_value_minor = 0
          and download_entitlement_id is null
        )
        or (
          applied_value_kind = 'download_purchase'
          and applied_value_minor in (500, 2000)
          and download_entitlement_id is not null
        )
      )
      and due_now_subtotal_minor =
        target_amount_minor - applied_value_minor
      and effective_rule =
        'after_payment_and_provider_confirmation'
      and effective_at is null
      and not no_mid_period_refund
      and not provider_proration_enabled
    )) or (change_kind = 'upgrade' and (
      current_subscription_id is not null
      and current_subscription_revision is not null
      and current_tier_id is not null
      and current_amount_minor =
        ss.alakazam_tier_amount_minor(current_tier_id)
      and current_period_ends_at is not null
      and ss.alakazam_tier_rank(target_tier_id) >
        ss.alakazam_tier_rank(current_tier_id)
      and applied_value_kind = 'current_paid_tier'
      and applied_value_minor = current_amount_minor
      and download_entitlement_id is null
      and due_now_subtotal_minor =
        target_amount_minor - current_amount_minor
      and effective_rule =
        'after_payment_and_provider_confirmation'
      and effective_at is null
      and not no_mid_period_refund
      and not provider_proration_enabled
    )) or (change_kind = 'downgrade' and (
      current_subscription_id is not null
      and current_subscription_revision is not null
      and current_tier_id is not null
      and current_amount_minor =
        ss.alakazam_tier_amount_minor(current_tier_id)
      and current_period_ends_at is not null
      and ss.alakazam_tier_rank(target_tier_id) <
        ss.alakazam_tier_rank(current_tier_id)
      and applied_value_kind = 'none'
      and applied_value_minor = 0
      and download_entitlement_id is null
      and due_now_subtotal_minor = 0
      and effective_rule = 'current_period_end'
      and effective_at = current_period_ends_at
      and no_mid_period_refund
      and not provider_proration_enabled
    ))
  );

alter table ss.alakazam_checkout_dispatches
  add constraint alakazam_checkout_credit_amount_v143
  check (expected_credit_minor in (0, 500, 2000));

alter table ss.alakazam_payment_receipts
  add constraint alakazam_payment_discount_amount_v143
  check (provider_discount_minor in (0, 500, 2000));

alter table ss.alakazam_credit_applications
  add constraint alakazam_credit_application_amount_v143
  check (amount_minor in (500, 2000));

do $$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
           'ss.validate_alakazam_dispatch()'::regprocedure
         )
    into definition;
  updated_definition := replace(
    definition,
    '''amountMinor'', 500,',
    '''amountMinor'', quote_record.applied_value_minor,'
  );
  updated_definition := replace(
    updated_definition,
    'new.expected_credit_minor <> 500',
    'new.expected_credit_minor <> quote_record.applied_value_minor'
  );
  if updated_definition = definition
    or updated_definition like '%''amountMinor'', 500,%'
    or updated_definition like '%new.expected_credit_minor <> 500%'
  then
    raise exception
      'Alakazam dispatch credit validator did not upgrade exactly'
      using errcode = '55000';
  end if;
  execute updated_definition;
end
$$;

create or replace function ss.validate_alakazam_credit_application()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.amount_minor not in (500, 2000)
    or not exists (
      select 1
      from ss.alakazam_change_quotes quote
      join ss.alakazam_payment_receipts receipt
        on receipt.organization_id = quote.organization_id
       and receipt.id = new.payment_receipt_id
      join ss.commerce_v2_project_entitlements entitlement
        on entitlement.organization_id = quote.organization_id
       and entitlement.id = new.download_entitlement_id
      join ss.commerce_v2_download_payment_receipts source_receipt
        on source_receipt.organization_id = entitlement.organization_id
       and source_receipt.id = entitlement.source_receipt_id
      where quote.organization_id = new.organization_id
        and quote.project_id = new.project_id
        and quote.id = new.quote_id
        and quote.change_kind = 'start'
        and quote.applied_value_kind = 'download_purchase'
        and quote.download_entitlement_id = entitlement.id
        and quote.applied_value_minor = new.amount_minor
        and receipt.project_id = new.project_id
        and receipt.subscription_id = new.subscription_id
        and receipt.quote_id = new.quote_id
        and receipt.receipt_kind = 'start_payment'
        and receipt.provider_discount_minor = new.amount_minor
        and entitlement.project_id = new.project_id
        and entitlement.kind = 'spark_download'
        and entitlement.scope = 'editor_project'
        and entitlement.state = 'active'
        and source_receipt.project_id = new.project_id
        and source_receipt.customer_user_id = quote.customer_user_id
        and source_receipt.payment_status = 'paid'
        and source_receipt.amount_minor = new.amount_minor
        and source_receipt.currency = 'USD'
    )
  then
    raise exception
      'Alakazam credit application requires its exact paid Download receipt'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.validate_commerce_v2_download_dispatch_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'dispatching'
    or new.provider <> 'stripe'
    or new.lease_expires_at <>
       new.created_at + interval '2 minutes'
    or not exists (
      select 1
      from ss.commerce_v2_checkout_preparations prep
      join ss.commerce_v2_download_quotes quote
        on quote.organization_id = prep.organization_id
       and quote.id = prep.quote_id
       and quote.project_id = prep.project_id
       and quote.version_id = prep.version_id
       and quote.customer_user_id = prep.customer_user_id
      join ss.projects project
        on project.organization_id = prep.organization_id
       and project.id = prep.project_id
       and project.lifecycle = 'active'
      join ss.organizations organization
        on organization.id = prep.organization_id
       and organization.state = 'active'
      join ss.organization_memberships membership
        on membership.organization_id = prep.organization_id
       and membership.user_id = prep.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      where prep.organization_id = new.organization_id
        and prep.command_id = new.preparation_command_id
        and prep.quote_id = new.quote_id
        and prep.customer_user_id = new.customer_user_id
        and prep.actor_user_id = new.customer_user_id
        and prep.project_id = new.project_id
        and prep.version_id = new.version_id
        and prep.offer_id = 'spark_download'
        and prep.entitlement_kind = 'spark_download'
        and prep.state = 'held'
        and not prep.dispatch_authorized
        and prep.purpose_digest = new.purpose_digest
        and prep.accepted_disclosure_digest =
            new.accepted_disclosure_digest
        and prep.quote_snapshot_digest = new.quote_snapshot_digest
        and quote.amount_minor in (500, 2000)
        and quote.currency = 'USD'
        and quote.billing = 'one_time'
        and quote.expires_at > new.created_at
        and (
          quote.amount_minor = 500
          or (
            quote.amount_minor = 2000
            and prep.purchase_acceptance_schema =
              'sitesourcery.abracadabra-purchase-acceptance.v1'
            and prep.purchase_acceptance_statement =
              'accepted_exact_download_quote_delivery_final_sale_and_credit_terms'
            and prep.purchase_accepted_at is not null
            and prep.acceptance_digest is not null
          )
        )
    )
  then
    raise exception
      'Download dispatch requires one unexpired exact accepted preparation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function ss.validate_commerce_v2_project_entitlement()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.kind <> 'spark_download'
    or new.scope <> 'editor_project'
    or new.state <> 'active'
    or new.state_changed_at <> new.activated_at
    or new.state_reason <> 'payment_settled'
    or new.expires_at is not null
    or not exists (
      select 1
      from ss.commerce_v2_download_payment_receipts receipt
      join ss.projects project
        on project.organization_id = receipt.organization_id
       and project.id = receipt.project_id
       and project.lifecycle = 'active'
      join ss.organizations organization
        on organization.id = receipt.organization_id
       and organization.state = 'active'
      join ss.organization_memberships membership
        on membership.organization_id = receipt.organization_id
       and membership.user_id = receipt.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      where receipt.organization_id = new.organization_id
        and receipt.id = new.source_receipt_id
        and receipt.project_id = new.project_id
        and receipt.customer_user_id = new.customer_user_id
        and receipt.payment_status = 'paid'
        and receipt.amount_minor in (500, 2000)
        and receipt.currency = 'USD'
        and receipt.accepted_disclosure_digest =
            new.accepted_disclosure_digest
        and receipt.settled_at = new.activated_at
    )
  then
    raise exception
      'Download entitlement requires one exact paid project receipt'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create table ss.commerce_v2_download_checkout_gate (
  singleton boolean primary key default true check (singleton),
  state text not null check (state in ('open', 'held')),
  reason text not null check (char_length(reason) between 1 and 200),
  signal_type text,
  signal_id text,
  evidence_digest ss.sha256_hex,
  state_changed_at timestamptz not null,
  revision bigint not null check (revision > 0),
  check (
    (state = 'open' and signal_type is null and signal_id is null)
    or (
      state = 'held'
      and char_length(signal_type) between 1 and 100
      and char_length(signal_id) between 1 and 255
      and evidence_digest is not null
    )
  )
);

insert into ss.commerce_v2_download_checkout_gate (
  singleton, state, reason, signal_type, signal_id,
  evidence_digest, state_changed_at, revision
) values (
  true, 'open', 'owner_approved_protected_launch', null, null,
  null, clock_timestamp(), 1
);

create table ss.commerce_v2_download_gate_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  prior_state text not null check (prior_state in ('open', 'held')),
  resulting_state text not null check (resulting_state in ('open', 'held')),
  reason text not null check (char_length(reason) between 1 and 200),
  signal_type text not null check (char_length(signal_type) between 1 and 100),
  signal_id text not null check (char_length(signal_id) between 1 and 255),
  evidence_digest ss.sha256_hex not null,
  changed_by_user_id uuid references auth.users(id),
  changed_at timestamptz not null,
  unique (signal_type, signal_id, resulting_state)
);

create table ss.commerce_v2_download_checkout_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  preparation_command_id text not null,
  quote_id uuid not null,
  customer_user_id uuid not null,
  project_id uuid not null,
  client_address text not null check (char_length(client_address) between 1 and 80),
  accepted_disclosure_digest ss.sha256_hex not null,
  purpose_digest ss.sha256_hex not null,
  outcome text not null check (
    outcome in ('claimed', 'rate_limited', 'risk_held')
  ),
  gate_revision bigint not null check (gate_revision > 0),
  attempted_at timestamptz not null,
  unique (organization_id, preparation_command_id),
  foreign key (organization_id, preparation_command_id)
    references ss.commerce_v2_checkout_preparations(organization_id, command_id),
  foreign key (organization_id, quote_id)
    references ss.commerce_v2_download_quotes(organization_id, id)
);

create index commerce_v2_download_attempt_account_velocity
  on ss.commerce_v2_download_checkout_attempts(customer_user_id, attempted_at desc);
create index commerce_v2_download_attempt_address_velocity
  on ss.commerce_v2_download_checkout_attempts(client_address, attempted_at desc);
create index commerce_v2_download_attempt_global_velocity
  on ss.commerce_v2_download_checkout_attempts(attempted_at desc);

create table ss.commerce_v2_download_access_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  customer_user_id uuid not null,
  entitlement_id uuid not null,
  receipt_id uuid not null,
  artifact_digest ss.sha256_hex not null,
  byte_count bigint not null check (byte_count > 0),
  request_id text not null unique check (char_length(request_id) between 1 and 200),
  client_address text not null check (char_length(client_address) between 1 and 80),
  user_agent_digest ss.sha256_hex not null,
  state text not null check (state = 'response_issued'),
  response_issued_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, entitlement_id)
    references ss.commerce_v2_project_entitlements(organization_id, id),
  foreign key (organization_id, receipt_id)
    references ss.commerce_v2_download_payment_receipts(organization_id, id)
);

create index commerce_v2_download_access_receipt
  on ss.commerce_v2_download_access_events(
    organization_id, receipt_id, response_issued_at
  );

create table ss.commerce_v2_download_fraud_warning_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  receipt_id uuid not null,
  entitlement_id uuid not null,
  warning_id text not null check (warning_id ~ '^issfr_[A-Za-z0-9_]+$'),
  charge_id text not null check (charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  payment_intent_id text not null check (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  event_type text not null check (event_type in (
    'radar.early_fraud_warning.created',
    'radar.early_fraud_warning.updated'
  )),
  actionable boolean not null,
  fraud_type text not null check (fraud_type ~ '^[a-z_]{2,80}$'),
  livemode boolean not null,
  payload_digest ss.sha256_hex not null,
  provider_created_at timestamptz not null,
  result jsonb not null check (
    jsonb_typeof(result) = 'object'
    and pg_column_size(result) <= 8192
  ),
  completed_at timestamptz not null,
  unique (warning_id, event_type),
  foreign key (organization_id, receipt_id)
    references ss.commerce_v2_download_payment_receipts(organization_id, id),
  foreign key (organization_id, entitlement_id)
    references ss.commerce_v2_project_entitlements(organization_id, id)
);

create table ss.commerce_v2_download_dispute_dossiers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  receipt_id uuid not null,
  entitlement_id uuid not null,
  trigger_event_id text not null,
  trigger_type text not null check (char_length(trigger_type) between 1 and 100),
  dossier jsonb not null check (
    jsonb_typeof(dossier) = 'object'
    and pg_column_size(dossier) <= 131072
  ),
  dossier_digest ss.sha256_hex not null,
  created_at timestamptz not null,
  unique (trigger_type, trigger_event_id),
  unique (organization_id, id),
  foreign key (organization_id, receipt_id)
    references ss.commerce_v2_download_payment_receipts(organization_id, id),
  foreign key (organization_id, entitlement_id)
    references ss.commerce_v2_project_entitlements(organization_id, id)
);

create table ss.commerce_v2_download_gate_review_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  dossier_id uuid not null,
  operator_user_id uuid not null references auth.users(id),
  decision_kind text not null check (decision_kind = 'reopen_checkouts'),
  reason text not null check (char_length(reason) between 2 and 200),
  reviewed_dossier_digest ss.sha256_hex not null,
  decision jsonb not null check (
    jsonb_typeof(decision) = 'object'
    and pg_column_size(decision) <= 16384
  ),
  decision_digest ss.sha256_hex not null unique,
  decided_at timestamptz not null,
  unique (dossier_id, decision_kind),
  foreign key (organization_id, dossier_id)
    references ss.commerce_v2_download_dispute_dossiers(organization_id, id)
);

create function ss.guard_download_checkout_gate_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Download Checkout gate cannot be deleted'
      using errcode = '55000';
  end if;
  if new.singleton is distinct from old.singleton
    or new.revision <> old.revision + 1
    or new.state = old.state
    or new.state_changed_at < old.state_changed_at
    or not exists (
      select 1
      from ss.commerce_v2_download_gate_transitions transition
      where transition.prior_state = old.state
        and transition.resulting_state = new.state
        and transition.reason = new.reason
        and transition.evidence_digest = new.evidence_digest
        and transition.changed_at = new.state_changed_at
        and (
          (
            new.state = 'held'
            and transition.signal_type = new.signal_type
            and transition.signal_id = new.signal_id
            and transition.changed_by_user_id is null
          )
          or (
            new.state = 'open'
            and new.signal_type is null
            and new.signal_id is null
            and transition.signal_type = 'operator_review'
            and transition.changed_by_user_id is not null
            and exists (
              select 1
              from ss.commerce_v2_download_gate_review_decisions decision
              where decision.id::text = transition.signal_id
                and decision.operator_user_id =
                    transition.changed_by_user_id
                and decision.decision_digest =
                    transition.evidence_digest
            )
          )
        )
    )
  then
    raise exception
      'Download Checkout gate mutation lacks an exact immutable transition'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create function ss.reject_download_protection_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  raise exception 'Download protection evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger commerce_v2_download_attempts_immutable
before update or delete on ss.commerce_v2_download_checkout_attempts
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_access_immutable
before update or delete on ss.commerce_v2_download_access_events
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_dossiers_immutable
before update or delete on ss.commerce_v2_download_dispute_dossiers
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_fraud_warnings_immutable
before update or delete on ss.commerce_v2_download_fraud_warning_events
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_gate_reviews_immutable
before update or delete on ss.commerce_v2_download_gate_review_decisions
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_gate_transitions_immutable
before update or delete on ss.commerce_v2_download_gate_transitions
for each row execute function ss.reject_download_protection_evidence_mutation();
create trigger commerce_v2_download_gate_guard
before update or delete on ss.commerce_v2_download_checkout_gate
for each row execute function ss.guard_download_checkout_gate_mutation();

alter table ss.commerce_v2_download_checkout_gate enable row level security;
alter table ss.commerce_v2_download_checkout_gate force row level security;
alter table ss.commerce_v2_download_gate_transitions enable row level security;
alter table ss.commerce_v2_download_gate_transitions force row level security;
alter table ss.commerce_v2_download_checkout_attempts enable row level security;
alter table ss.commerce_v2_download_checkout_attempts force row level security;
alter table ss.commerce_v2_download_access_events enable row level security;
alter table ss.commerce_v2_download_access_events force row level security;
alter table ss.commerce_v2_download_dispute_dossiers enable row level security;
alter table ss.commerce_v2_download_dispute_dossiers force row level security;
alter table ss.commerce_v2_download_fraud_warning_events enable row level security;
alter table ss.commerce_v2_download_fraud_warning_events force row level security;
alter table ss.commerce_v2_download_gate_review_decisions enable row level security;
alter table ss.commerce_v2_download_gate_review_decisions force row level security;

revoke all on
  ss.commerce_v2_download_checkout_gate,
  ss.commerce_v2_download_gate_transitions,
  ss.commerce_v2_download_checkout_attempts,
  ss.commerce_v2_download_access_events,
  ss.commerce_v2_download_dispute_dossiers,
  ss.commerce_v2_download_fraud_warning_events,
  ss.commerce_v2_download_gate_review_decisions
from public, anon, authenticated;

grant all privileges on
  ss.commerce_v2_download_checkout_gate,
  ss.commerce_v2_download_gate_transitions,
  ss.commerce_v2_download_checkout_attempts,
  ss.commerce_v2_download_access_events,
  ss.commerce_v2_download_dispute_dossiers,
  ss.commerce_v2_download_fraud_warning_events,
  ss.commerce_v2_download_gate_review_decisions
to service_role;

revoke all on function
  ss.reject_download_protection_evidence_mutation()
from public, anon, authenticated;
grant execute on function
  ss.reject_download_protection_evidence_mutation()
to service_role;

revoke all on function ss.guard_download_checkout_gate_mutation()
from public, anon, authenticated;
grant execute on function ss.guard_download_checkout_gate_mutation()
to service_role;

create function ss.download_protection_contract_v1()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select 'fin012-download-2000-credit-2000-verified-billing-3ds-requested-velocity-6h-12h-120x5m-real-signal-gate-private-dossier'::text
$$;

revoke all on function ss.download_protection_contract_v1()
from public, anon, authenticated, service_role;
grant execute on function ss.download_protection_contract_v1()
to service_role;

commit;
