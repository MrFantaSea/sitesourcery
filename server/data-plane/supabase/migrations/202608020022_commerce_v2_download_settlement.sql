begin;

do $$
begin
  if to_regprocedure('ss.hosted_runtime_contract_v19()') is null
    or to_regprocedure('ss.hosted_runtime_contract_v21()') is null
    or to_regclass('ss.commerce_v2_checkout_preparations') is null
    or to_regclass('ss.commerce_v2_download_quotes') is null
    or to_regclass('ss.deletion_requests') is null
  then
    raise exception
      'commerce v2 preparation and canonical hosted runtime v21 must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- A held preparation remains immutable. This separate reservation is the only
-- row permitted to cross the reviewed $5 Download contract into Stripe.
create table ss.commerce_v2_download_dispatches (
  organization_id uuid not null,
  preparation_command_id text not null,
  quote_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  project_id uuid not null,
  version_id uuid not null,
  provider text not null
    check (provider = 'stripe'),
  state text not null
    check (
      state in (
        'dispatching',
        'ready',
        'effect_unknown',
        'expired',
        'settled'
      )
    ),
  purpose_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  quote_snapshot_digest ss.sha256_hex not null,
  lease_expires_at timestamptz not null,
  checkout_session_id text
    check (
      checkout_session_id is null
      or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    ),
  checkout_url text
    check (
      checkout_url is null
      or (
        char_length(checkout_url) between 1 and 4096
        and checkout_url ~
          '^https://checkout[.]stripe[.]com/'
        and checkout_url !~ '[#]'
      )
    ),
  provider_expires_at timestamptz,
  dispatched_at timestamptz,
  provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code)
           between 1 and 200
    ),
  result jsonb
    check (
      result is null
      or (
        jsonb_typeof(result) = 'object'
        and pg_column_size(result) <= 32768
      )
    ),
  created_at timestamptz not null
    default clock_timestamp(),
  updated_at timestamptz not null
    default clock_timestamp(),
  primary key (
    organization_id,
    preparation_command_id
  ),
  unique (checkout_session_id),
  unique (
    organization_id,
    preparation_command_id,
    checkout_session_id
  ),
  foreign key (
    organization_id,
    preparation_command_id
  ) references ss.commerce_v2_checkout_preparations(
    organization_id,
    command_id
  ) on delete cascade,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  check (lease_expires_at > created_at),
  check (
    (
      state = 'dispatching'
      and checkout_session_id is null
      and checkout_url is null
      and provider_expires_at is null
      and dispatched_at is null
      and provider_error_code is null
      and result is null
    )
    or (
      state = 'effect_unknown'
      and checkout_session_id is null
      and checkout_url is null
      and provider_expires_at is null
      and dispatched_at is null
      and provider_error_code is not null
      and result is null
    )
    or (
      state in ('ready', 'expired', 'settled')
      and checkout_session_id is not null
      and checkout_url is not null
      and provider_expires_at is not null
      and dispatched_at is not null
      and provider_error_code is null
      and result is not null
      and provider_expires_at > dispatched_at
    )
  ),
  check (
    result is null
    or (
      result ->> 'schema' =
        'sitesourcery.abracadabra-checkout-dispatch.v2'
      and result ->> 'commandId' =
        preparation_command_id
      and result ->> 'quoteId' = quote_id::text
      and result ->> 'projectId' = project_id::text
      and result ->> 'versionId' = version_id::text
      and result ->> 'offerId' = 'spark_download'
      and result ->> 'entitlementKind' =
        'spark_download'
      and result ->> 'state' = 'ready'
      and result -> 'dispatchAuthorized' =
        'true'::jsonb
      and result ->> 'provider' = provider
      and result ->> 'purposeDigest' =
        purpose_digest
      and result #>> '{checkout,id}' =
        checkout_session_id
      and result #>> '{checkout,url}' = checkout_url
      and result ->> 'checkoutUrl' = checkout_url
      and result #>> '{checkout,expiresAt}' =
        to_char(
          provider_expires_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      and result ->> 'dispatchedAt' =
        to_char(
          dispatched_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
    ) is true
  )
);

create unique index commerce_v2_download_one_open_payment
  on ss.commerce_v2_download_dispatches(
    organization_id,
    project_id
  )
  where state in (
    'dispatching',
    'ready',
    'effect_unknown',
    'settled'
  );

create index commerce_v2_download_dispatch_project
  on ss.commerce_v2_download_dispatches(
    organization_id,
    project_id,
    created_at desc
  );

create function ss.validate_commerce_v2_download_dispatch_insert()
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
       and quote.customer_user_id =
           prep.customer_user_id
      join ss.projects project
        on project.organization_id = prep.organization_id
       and project.id = prep.project_id
       and project.lifecycle = 'active'
      join ss.organizations organization
        on organization.id = prep.organization_id
       and organization.state = 'active'
      join ss.organization_memberships membership
        on membership.organization_id =
           prep.organization_id
       and membership.user_id = prep.customer_user_id
       and membership.state = 'active'
       and membership.role in ('owner', 'admin', 'editor')
      where prep.organization_id = new.organization_id
        and prep.command_id =
            new.preparation_command_id
        and prep.quote_id = new.quote_id
        and prep.customer_user_id =
            new.customer_user_id
        and prep.actor_user_id = new.customer_user_id
        and prep.project_id = new.project_id
        and prep.version_id = new.version_id
        and prep.offer_id = 'spark_download'
        and prep.entitlement_kind = 'spark_download'
        and prep.state = 'held'
        and prep.dispatch_authorized = false
        and prep.purpose_digest = new.purpose_digest
        and prep.accepted_disclosure_digest =
            new.accepted_disclosure_digest
        and prep.quote_snapshot_digest =
            new.quote_snapshot_digest
        and quote.amount_minor = 500
        and quote.currency = 'USD'
        and quote.billing = 'one_time'
        and quote.expires_at > new.created_at
    )
  then
    raise exception
      'Download dispatch requires one unexpired exact held preparation'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_dispatches_validate_insert
before insert on ss.commerce_v2_download_dispatches
for each row execute function
  ss.validate_commerce_v2_download_dispatch_insert();

create function ss.validate_commerce_v2_download_dispatch_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.preparation_command_id is distinct from
       old.preparation_command_id
    or new.quote_id is distinct from old.quote_id
    or new.customer_user_id is distinct from
       old.customer_user_id
    or new.project_id is distinct from old.project_id
    or new.version_id is distinct from old.version_id
    or new.provider is distinct from old.provider
    or new.purpose_digest is distinct from old.purpose_digest
    or new.accepted_disclosure_digest is distinct from
       old.accepted_disclosure_digest
    or new.quote_snapshot_digest is distinct from
       old.quote_snapshot_digest
    or new.lease_expires_at is distinct from
       old.lease_expires_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Download dispatch identity is immutable'
      using errcode = '55000';
  end if;

  if not (
    (
      old.state = 'dispatching'
      and new.state in ('ready', 'effect_unknown')
    )
    or (
      old.state = 'ready'
      and new.state in ('expired', 'settled')
    )
  ) or new.updated_at <= old.updated_at
  then
    raise exception 'Download dispatch transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_dispatches_transition
before update on ss.commerce_v2_download_dispatches
for each row execute function
  ss.validate_commerce_v2_download_dispatch_transition();

create function ss.validate_commerce_v2_download_dispatch_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if old.state = 'dispatching' then
    return old;
  end if;
  if nullif(
    current_setting('app.terminal_purge_project_id', true),
    ''
  )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  raise exception 'durable Download dispatch is immutable'
    using errcode = '55000';
end
$$;

create trigger commerce_v2_download_dispatches_delete
before delete on ss.commerce_v2_download_dispatches
for each row execute function
  ss.validate_commerce_v2_download_dispatch_delete();

-- Signed webhook bodies are wake-up signals. Only identity and a payload digest
-- are retained here; the payment receipt below requires provider readback.
create table ss.commerce_v2_download_stripe_events (
  id text primary key
    check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  preparation_command_id text not null,
  checkout_session_id text not null,
  event_type text not null
    check (event_type = 'checkout.session.completed'),
  livemode boolean not null,
  payload_digest ss.sha256_hex not null,
  provider_created_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'processed')),
  result jsonb,
  observed_at timestamptz not null
    default clock_timestamp(),
  completed_at timestamptz,
  foreign key (
    organization_id,
    preparation_command_id,
    checkout_session_id
  ) references ss.commerce_v2_download_dispatches(
    organization_id,
    preparation_command_id,
    checkout_session_id
  ) on delete cascade,
  check (
    (
      state = 'pending'
      and result is null
      and completed_at is null
    )
    or (
      state = 'processed'
      and jsonb_typeof(result) = 'object'
      and pg_column_size(result) <= 4096
      and completed_at is not null
      and completed_at >= observed_at
    )
  )
);

create index commerce_v2_download_events_project
  on ss.commerce_v2_download_stripe_events(
    organization_id,
    project_id,
    observed_at desc
  );

create function ss.validate_commerce_v2_download_event_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.state <> 'pending'
    or not exists (
      select 1
      from ss.commerce_v2_download_dispatches dispatch
      where dispatch.organization_id = new.organization_id
        and dispatch.project_id = new.project_id
        and dispatch.preparation_command_id =
            new.preparation_command_id
        and dispatch.checkout_session_id =
            new.checkout_session_id
        and dispatch.state in ('ready', 'settled')
    )
  then
    raise exception
      'Download Stripe event requires one ready dispatch'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_events_validate_insert
before insert on ss.commerce_v2_download_stripe_events
for each row execute function
  ss.validate_commerce_v2_download_event_insert();

create function ss.validate_commerce_v2_download_event_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.preparation_command_id is distinct from
       old.preparation_command_id
    or new.checkout_session_id is distinct from
       old.checkout_session_id
    or new.event_type is distinct from old.event_type
    or new.livemode is distinct from old.livemode
    or new.payload_digest is distinct from old.payload_digest
    or new.provider_created_at is distinct from
       old.provider_created_at
    or new.observed_at is distinct from old.observed_at
    or old.state <> 'pending'
    or new.state <> 'processed'
  then
    raise exception 'Download Stripe event transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_events_transition
before update on ss.commerce_v2_download_stripe_events
for each row execute function
  ss.validate_commerce_v2_download_event_transition();

create table ss.commerce_v2_download_payment_receipts (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  quote_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  preparation_command_id text not null,
  stripe_event_id text not null unique,
  provider text not null check (provider = 'stripe'),
  checkout_session_id text not null unique
    check (
      checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    ),
  payment_intent_id text not null unique
    check (
      payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
    ),
  stripe_customer_id text not null
    check (
      stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
    ),
  payment_status text not null
    check (payment_status = 'paid'),
  amount_minor integer not null
    check (amount_minor = 500),
  tax_minor integer not null
    check (tax_minor >= 0),
  total_minor integer not null
    check (total_minor = amount_minor + tax_minor),
  tax_mode text not null
    check (
      tax_mode in ('automatic', 'disabled_by_owner')
      and (
        tax_mode = 'automatic'
        or tax_minor = 0
      )
    ),
  currency text not null check (currency = 'USD'),
  purpose_digest ss.sha256_hex not null,
  accepted_disclosure_digest ss.sha256_hex not null,
  settled_at timestamptz not null,
  facts jsonb not null
    check (
      jsonb_typeof(facts) = 'object'
      and pg_column_size(facts) <= 16384
    ),
  created_at timestamptz not null
    default clock_timestamp(),
  unique (organization_id, id),
  foreign key (stripe_event_id)
    references ss.commerce_v2_download_stripe_events(id)
    on delete cascade,
  foreign key (
    organization_id,
    preparation_command_id,
    checkout_session_id
  ) references ss.commerce_v2_download_dispatches(
    organization_id,
    preparation_command_id,
    checkout_session_id
  ) on delete cascade,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    project_id,
    version_id
  ) references ss.site_versions(
    organization_id,
    project_id,
    id
  ),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  check (
    facts ->> 'schema' =
      'sitesourcery.abracadabra-payment-receipt.v2'
    and facts ->> 'receiptId' = id::text
    and facts ->> 'provider' = provider
    and facts ->> 'eventId' = stripe_event_id
    and facts ->> 'checkoutSessionId' =
      checkout_session_id
    and facts ->> 'paymentIntentId' =
      payment_intent_id
    and facts ->> 'stripeCustomerId' =
      stripe_customer_id
    and facts ->> 'projectId' = project_id::text
    and facts ->> 'versionId' = version_id::text
    and facts ->> 'quoteId' = quote_id::text
    and facts ->> 'purposeDigest' = purpose_digest
    and facts ->> 'acceptedDisclosureDigest' =
      accepted_disclosure_digest
    and facts #>> '{payment,status}' = payment_status
    and facts #>> '{payment,provider}' = provider
    and facts #>> '{payment,receiptId}' = id::text
    and facts #> '{payment,amountMinor}' =
      to_jsonb(amount_minor)
    and facts #> '{payment,taxMinor}' =
      to_jsonb(tax_minor)
    and facts #> '{payment,totalMinor}' =
      to_jsonb(total_minor)
    and facts #>> '{payment,taxMode}' = tax_mode
    and facts #>> '{payment,currency}' = currency
    and facts #>> '{payment,settledAt}' =
      to_char(
        settled_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
  )
);

create table ss.commerce_v2_project_entitlements (
  id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  customer_user_id uuid not null
    references auth.users(id),
  kind text not null check (kind = 'spark_download'),
  scope text not null check (scope = 'editor_project'),
  state text not null
    check (state in ('active', 'suspended', 'revoked')),
  source_receipt_id uuid not null unique,
  accepted_disclosure_digest ss.sha256_hex not null,
  activated_at timestamptz not null,
  state_changed_at timestamptz not null,
  state_reason text not null
    check (
      char_length(state_reason) between 1 and 200
    ),
  expires_at timestamptz
    check (expires_at is null),
  created_at timestamptz not null
    default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, project_id, kind),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (
    organization_id,
    customer_user_id
  ) references ss.organization_memberships(
    organization_id,
    user_id
  ),
  foreign key (organization_id, source_receipt_id)
    references ss.commerce_v2_download_payment_receipts(
      organization_id,
      id
    ) on delete cascade
);

create function ss.validate_commerce_v2_download_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.commerce_v2_download_stripe_events event
    join ss.commerce_v2_download_dispatches dispatch
      on dispatch.organization_id = event.organization_id
     and dispatch.preparation_command_id =
         event.preparation_command_id
     and dispatch.checkout_session_id =
         event.checkout_session_id
    join ss.commerce_v2_checkout_preparations prep
      on prep.organization_id = dispatch.organization_id
     and prep.command_id =
         dispatch.preparation_command_id
    where event.id = new.stripe_event_id
      and event.organization_id = new.organization_id
      and event.project_id = new.project_id
      and event.state = 'pending'
      and event.checkout_session_id =
          new.checkout_session_id
      and dispatch.state = 'ready'
      and dispatch.project_id = new.project_id
      and dispatch.version_id = new.version_id
      and dispatch.quote_id = new.quote_id
      and dispatch.customer_user_id =
          new.customer_user_id
      and dispatch.purpose_digest = new.purpose_digest
      and dispatch.accepted_disclosure_digest =
          new.accepted_disclosure_digest
      and prep.offer_id = 'spark_download'
      and prep.entitlement_kind = 'spark_download'
  )
  then
    raise exception
      'Download receipt requires provider readback for one pending verified event'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_receipts_validate
before insert on ss.commerce_v2_download_payment_receipts
for each row execute function
  ss.validate_commerce_v2_download_receipt();

create function ss.validate_commerce_v2_project_entitlement()
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
        and receipt.customer_user_id =
            new.customer_user_id
        and receipt.payment_status = 'paid'
        and receipt.amount_minor = 500
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

create trigger commerce_v2_project_entitlements_validate
before insert on ss.commerce_v2_project_entitlements
for each row execute function
  ss.validate_commerce_v2_project_entitlement();

create function ss.validate_commerce_v2_project_entitlement_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.customer_user_id is distinct from old.customer_user_id
    or new.kind is distinct from old.kind
    or new.scope is distinct from old.scope
    or new.source_receipt_id is distinct from
       old.source_receipt_id
    or new.accepted_disclosure_digest is distinct from
       old.accepted_disclosure_digest
    or new.activated_at is distinct from old.activated_at
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at
    or not (
      (old.state = 'active'
       and new.state in ('suspended', 'revoked'))
      or (old.state = 'suspended'
          and new.state = 'revoked')
    )
    or new.state_changed_at <= old.state_changed_at
    or new.state_reason not in (
      'payment_fully_refunded',
      'payment_partially_refunded',
      'payment_dispute_open',
      'payment_dispute_lost',
      'payment_dispute_review_required'
    )
  then
    raise exception
      'Download entitlement transition is invalid'
      using errcode = '55000';
  end if;
  return new;
end
$$;

create trigger commerce_v2_project_entitlements_transition
before update on ss.commerce_v2_project_entitlements
for each row execute function
  ss.validate_commerce_v2_project_entitlement_transition();

-- Refunds and disputes do not carry Checkout metadata. A verified Stripe
-- event is bound back to the immutable PaymentIntent receipt before it can
-- suspend or revoke the project entitlement. Events are immutable and
-- monotonic: automatic processing can make access stricter, never looser.
create table ss.commerce_v2_download_reversal_events (
  id text primary key
    check (id ~ '^evt_[A-Za-z0-9_]+$'),
  organization_id uuid not null,
  project_id uuid not null,
  receipt_id uuid not null,
  entitlement_id uuid not null,
  payment_intent_id text not null
    check (
      payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
    ),
  event_type text not null
    check (
      event_type in (
        'charge.refunded',
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated'
      )
    ),
  provider_object_id text not null
    check (
      provider_object_id ~
        '^(ch|dp|du)_[A-Za-z0-9_]+$'
    ),
  livemode boolean not null,
  payload_digest ss.sha256_hex not null,
  provider_created_at timestamptz not null,
  amount_minor integer not null
    check (amount_minor between 1 and 99999999),
  provider_status text not null
    check (
      char_length(provider_status) between 1 and 200
    ),
  target_state text not null
    check (target_state in ('suspended', 'revoked')),
  reason text not null
    check (
      reason in (
        'payment_fully_refunded',
        'payment_partially_refunded',
        'payment_dispute_open',
        'payment_dispute_lost',
        'payment_dispute_review_required'
      )
    ),
  prior_state text not null
    check (prior_state in ('active', 'suspended', 'revoked')),
  prior_reason text not null
    check (
      char_length(prior_reason) between 1 and 200
    ),
  resulting_state text not null
    check (
      resulting_state in ('suspended', 'revoked')
    ),
  result jsonb not null
    check (
      jsonb_typeof(result) = 'object'
      and pg_column_size(result) <= 4096
    ),
  observed_at timestamptz not null
    default clock_timestamp(),
  completed_at timestamptz not null,
  unique (organization_id, id),
  foreign key (organization_id, receipt_id)
    references ss.commerce_v2_download_payment_receipts(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, entitlement_id)
    references ss.commerce_v2_project_entitlements(
      organization_id,
      id
    ) on delete cascade,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  check (completed_at >= observed_at),
  check (
    (
      prior_state = 'active'
      and resulting_state = target_state
    )
    or (
      prior_state = 'suspended'
      and resulting_state = case
        when target_state = 'revoked'
          then 'revoked'
        else 'suspended'
      end
    )
    or (
      prior_state = 'revoked'
      and resulting_state = 'revoked'
    )
  ),
  check (
    result ->> 'status' = 'processed'
    and result ->> 'projectId' = project_id::text
    and result ->> 'entitlementId' =
      entitlement_id::text
    and result ->> 'entitlementState' =
      resulting_state
    and result ->> 'reason' = case
      when resulting_state = prior_state
        then prior_reason
      else reason
    end
  )
);

create index commerce_v2_download_reversals_payment
  on ss.commerce_v2_download_reversal_events(
    payment_intent_id,
    provider_created_at desc
  );

create function ss.validate_commerce_v2_download_reversal()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if not exists (
    select 1
    from ss.commerce_v2_download_payment_receipts receipt
    join ss.commerce_v2_download_stripe_events settled_event
      on settled_event.id = receipt.stripe_event_id
     and settled_event.livemode = new.livemode
    join ss.commerce_v2_project_entitlements entitlement
      on entitlement.organization_id = receipt.organization_id
     and entitlement.id = new.entitlement_id
     and entitlement.source_receipt_id = receipt.id
     and entitlement.state = new.prior_state
     and entitlement.state_reason = new.prior_reason
    where receipt.organization_id = new.organization_id
      and receipt.project_id = new.project_id
      and receipt.id = new.receipt_id
      and receipt.payment_intent_id =
          new.payment_intent_id
  ) or (
    new.event_type = 'charge.refunded'
    and (
      new.provider_object_id !~ '^ch_'
      or new.provider_status not in (
        'fully_refunded',
        'partially_refunded'
      )
      or (
        new.provider_status = 'fully_refunded'
        and (
          new.target_state <> 'revoked'
          or new.reason <>
             'payment_fully_refunded'
        )
      )
      or (
        new.provider_status = 'partially_refunded'
        and (
          new.target_state <> 'suspended'
          or new.reason <>
             'payment_partially_refunded'
        )
      )
    )
  ) or (
    new.event_type <> 'charge.refunded'
    and (
      new.provider_object_id !~ '^(dp|du)_'
      or (
        new.provider_status = 'lost'
        and (
          new.target_state <> 'revoked'
          or new.reason <> 'payment_dispute_lost'
        )
      )
      or (
        new.provider_status <> 'lost'
        and new.target_state <> 'suspended'
      )
    )
  )
  then
    raise exception
      'Download reversal requires exact settled payment evidence'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger commerce_v2_download_reversals_validate
before insert on ss.commerce_v2_download_reversal_events
for each row execute function
  ss.validate_commerce_v2_download_reversal();

create function ss.reject_commerce_v2_download_evidence_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ss
as $$
begin
  if tg_op = 'DELETE'
    and nullif(
      current_setting(
        'app.terminal_purge_project_id',
        true
      ),
      ''
    )::uuid = old.project_id
    and exists (
      select 1
      from ss.deletion_requests request
      where request.organization_id = old.organization_id
        and request.project_id = old.project_id
        and request.state = 'purging'
    )
  then
    return old;
  end if;
  raise exception 'Download payment evidence is immutable'
    using errcode = '55000';
end
$$;

create trigger commerce_v2_download_events_immutable_delete
before delete on ss.commerce_v2_download_stripe_events
for each row execute function
  ss.reject_commerce_v2_download_evidence_mutation();

create trigger commerce_v2_download_receipts_immutable
before update or delete on
  ss.commerce_v2_download_payment_receipts
for each row execute function
  ss.reject_commerce_v2_download_evidence_mutation();

create trigger commerce_v2_project_entitlements_immutable
before delete on
  ss.commerce_v2_project_entitlements
for each row execute function
  ss.reject_commerce_v2_download_evidence_mutation();

create trigger commerce_v2_download_reversals_immutable
before update or delete on
  ss.commerce_v2_download_reversal_events
for each row execute function
  ss.reject_commerce_v2_download_evidence_mutation();

-- Extend the existing pre-purge inventory. Child rows then cascade from the
-- held preparation before site_versions is removed by the older purge path.
create or replace function ss.activate_commerce_v2_purge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if new.state = 'purging' then
    perform set_config(
      'app.terminal_purge_project_id',
      new.project_id::text,
      true
    );
    new.removal_counts :=
      coalesce(new.removal_counts, '{}'::jsonb)
      || jsonb_build_object(
        'commerceV2Commands', (
          select count(*)
          from ss.commerce_v2_commands
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadQuotes', (
          select count(*)
          from ss.commerce_v2_download_quotes
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2CheckoutPreparations', (
          select count(*)
          from ss.commerce_v2_checkout_preparations
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadDispatches', (
          select count(*)
          from ss.commerce_v2_download_dispatches
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadStripeEvents', (
          select count(*)
          from ss.commerce_v2_download_stripe_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadPaymentReceipts', (
          select count(*)
          from ss.commerce_v2_download_payment_receipts
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2ProjectEntitlements', (
          select count(*)
          from ss.commerce_v2_project_entitlements
          where organization_id = new.organization_id
            and project_id = new.project_id
        ),
        'commerceV2DownloadReversalEvents', (
          select count(*)
          from ss.commerce_v2_download_reversal_events
          where organization_id = new.organization_id
            and project_id = new.project_id
        )
      );
  end if;
  return new;
end
$$;

alter table ss.commerce_v2_download_dispatches
  enable row level security;
alter table ss.commerce_v2_download_dispatches
  force row level security;
alter table ss.commerce_v2_download_stripe_events
  enable row level security;
alter table ss.commerce_v2_download_stripe_events
  force row level security;
alter table ss.commerce_v2_download_payment_receipts
  enable row level security;
alter table ss.commerce_v2_download_payment_receipts
  force row level security;
alter table ss.commerce_v2_project_entitlements
  enable row level security;
alter table ss.commerce_v2_project_entitlements
  force row level security;
alter table ss.commerce_v2_download_reversal_events
  enable row level security;
alter table ss.commerce_v2_download_reversal_events
  force row level security;

revoke all on
  ss.commerce_v2_download_dispatches,
  ss.commerce_v2_download_stripe_events,
  ss.commerce_v2_download_payment_receipts,
  ss.commerce_v2_project_entitlements,
  ss.commerce_v2_download_reversal_events
from public, anon, authenticated;

grant all privileges on
  ss.commerce_v2_download_dispatches,
  ss.commerce_v2_download_stripe_events,
  ss.commerce_v2_download_payment_receipts,
  ss.commerce_v2_project_entitlements,
  ss.commerce_v2_download_reversal_events
to service_role;

revoke all on function
  ss.validate_commerce_v2_download_dispatch_insert(),
  ss.validate_commerce_v2_download_dispatch_transition(),
  ss.validate_commerce_v2_download_dispatch_delete(),
  ss.validate_commerce_v2_download_event_insert(),
  ss.validate_commerce_v2_download_event_transition(),
  ss.validate_commerce_v2_download_receipt(),
  ss.validate_commerce_v2_project_entitlement(),
  ss.validate_commerce_v2_project_entitlement_transition(),
  ss.validate_commerce_v2_download_reversal(),
  ss.reject_commerce_v2_download_evidence_mutation()
from public, anon, authenticated;

grant execute on function
  ss.validate_commerce_v2_download_dispatch_insert(),
  ss.validate_commerce_v2_download_dispatch_transition(),
  ss.validate_commerce_v2_download_dispatch_delete(),
  ss.validate_commerce_v2_download_event_insert(),
  ss.validate_commerce_v2_download_event_transition(),
  ss.validate_commerce_v2_download_receipt(),
  ss.validate_commerce_v2_project_entitlement(),
  ss.validate_commerce_v2_project_entitlement_transition(),
  ss.validate_commerce_v2_download_reversal(),
  ss.reject_commerce_v2_download_evidence_mutation()
to service_role;

create function ss.hosted_runtime_contract_v22()
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select
    'canonical-ss-v22-commerce-v2-download-settlement'
    ::text
$$;

revoke all on function ss.hosted_runtime_contract_v22()
from public, anon;
grant execute on function ss.hosted_runtime_contract_v22()
to authenticated, service_role;

commit;
