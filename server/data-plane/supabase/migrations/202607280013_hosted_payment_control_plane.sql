begin;

do $$
begin
  if to_regclass('ss.checkout_intents') is null
    or to_regclass('ss.checkout_quote_bindings') is null
    or to_regclass('ss.stripe_events') is null
    or to_regclass('ss.transactional_outbox') is null
  then
    raise exception
      'canonical checkout, webhook, and outbox migrations must be installed first'
      using errcode = '55000';
  end if;
end
$$;

-- A provider call and the PostgreSQL commit cannot be atomic. These fields
-- preserve the exact provider purpose and the last known effect certainty so
-- the same Stripe idempotency key can be reconciled without inventing a second
-- Checkout Session.
alter table ss.checkout_intents
  add column purpose_digest ss.sha256_hex,
  add column provider_idempotency_key text
    check (
      provider_idempotency_key is null
      or char_length(provider_idempotency_key) between 8 and 255
    ),
  add column provider_checkout_url text
    check (
      provider_checkout_url is null
      or (
        provider_checkout_url like 'https://checkout.stripe.com/%'
        and char_length(provider_checkout_url) <= 2000
      )
    ),
  add column provider_effect_certainty text
    check (
      provider_effect_certainty is null
      or provider_effect_certainty in (
        'not_submitted',
        'ambiguous',
        'confirmed'
      )
    ),
  add column provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code) between 1 and 200
    );

create unique index checkout_intents_provider_idempotency_key
  on ss.checkout_intents(provider_idempotency_key)
  where provider_idempotency_key is not null;

-- A one-time Own purchase is an entitlement, not a subscription. It is bound
-- to one exact paid checkout and immutable provider evidence. Refunds and
-- disputes transition this record away from completed so publication and
-- private serving fail closed without pretending the customer subscribed.
create table ss.site_ownership_entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  checkout_intent_id uuid not null,
  catalog_price_id uuid not null references ss.catalog_prices(id),
  provider_receipt_id uuid not null,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  refunded_amount_minor bigint not null default 0
    check (
      refunded_amount_minor >= 0
      and refunded_amount_minor <= amount_minor
    ),
  state text not null
    check (
      state in (
        'completed',
        'refunded',
        'disputed',
        'revoked'
      )
    ),
  completed_at timestamptz not null,
  refunded_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, checkout_intent_id)
    references ss.checkout_intents(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (organization_id, id),
  unique (checkout_intent_id),
  check (
    (state = 'completed' and refunded_at is null and revoked_at is null)
    or (state = 'refunded' and refunded_at is not null)
    or (state in ('disputed', 'revoked') and revoked_at is not null)
  )
);

create unique index site_ownership_entitlements_payment_intent
  on ss.site_ownership_entitlements(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index site_ownership_entitlements_current_project
  on ss.site_ownership_entitlements(project_id)
  where state = 'completed';

create trigger site_ownership_entitlements_updated_at
before update on ss.site_ownership_entitlements
for each row execute function ss.set_updated_at();

create table ss.site_ownership_entitlement_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  entitlement_id uuid not null,
  provider_receipt_id uuid not null,
  state text not null
    check (
      state in (
        'completed',
        'refunded',
        'disputed',
        'revoked'
      )
    ),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, entitlement_id)
    references ss.site_ownership_entitlements(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (organization_id, id),
  unique (entitlement_id, provider_receipt_id, state)
);

create trigger site_ownership_entitlement_events_no_update
before update or delete on ss.site_ownership_entitlement_events
for each row execute function ss.reject_update();

create function ss.purge_ownership_before_checkout_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  delete from ss.site_ownership_entitlement_events
  where entitlement_id in (
    select entitlement.id
    from ss.site_ownership_entitlements entitlement
    where entitlement.checkout_intent_id = old.id
  );
  delete from ss.site_ownership_entitlements
  where checkout_intent_id = old.id;
  return old;
end
$$;

revoke all on function ss.purge_ownership_before_checkout_delete()
from public, anon, authenticated;

create trigger checkout_intents_purge_ownership
before delete on ss.checkout_intents
for each row execute function ss.purge_ownership_before_checkout_delete();

create table ss.billing_portal_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  stripe_customer_row_id uuid not null,
  created_by_user_id uuid not null references auth.users(id),
  provider_idempotency_key text not null
    check (char_length(provider_idempotency_key) between 8 and 255),
  purpose_digest ss.sha256_hex not null,
  state text not null default 'provider_pending'
    check (state in ('provider_pending', 'open', 'failed')),
  stripe_portal_session_id text unique,
  provider_portal_url text
    check (
      provider_portal_url is null
      or (
        provider_portal_url like 'https://billing.stripe.com/%'
        and char_length(provider_portal_url) <= 2000
      )
    ),
  provider_effect_certainty text
    check (
      provider_effect_certainty is null
      or provider_effect_certainty in (
        'not_submitted',
        'ambiguous',
        'confirmed'
      )
    ),
  provider_error_code text
    check (
      provider_error_code is null
      or char_length(provider_error_code) between 1 and 200
    ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, stripe_customer_row_id)
    references ss.stripe_customers(organization_id, id),
  unique (organization_id, id),
  unique (provider_idempotency_key),
  check (
    (
      state = 'open'
      and stripe_portal_session_id is not null
      and provider_portal_url is not null
      and provider_effect_certainty = 'confirmed'
      and provider_error_code is null
    )
    or state <> 'open'
  )
);

create trigger billing_portal_sessions_updated_at
before update on ss.billing_portal_sessions
for each row execute function ss.set_updated_at();

create function ss.purge_billing_portals_on_project_seal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if old.lifecycle <> 'deleting' and new.lifecycle = 'deleting' then
    delete from ss.billing_portal_sessions
    where project_id = new.id;
  end if;
  return new;
end
$$;

revoke all on function ss.purge_billing_portals_on_project_seal()
from public, anon, authenticated;

create trigger projects_purge_billing_portals
before update of lifecycle on ss.projects
for each row execute function ss.purge_billing_portals_on_project_seal();

alter table ss.billing_portal_sessions enable row level security;
alter table ss.billing_portal_sessions force row level security;
alter table ss.site_ownership_entitlements enable row level security;
alter table ss.site_ownership_entitlements force row level security;
alter table ss.site_ownership_entitlement_events enable row level security;
alter table ss.site_ownership_entitlement_events force row level security;

create policy billing_portal_sessions_tenant_read
on ss.billing_portal_sessions for select
using (ss.can_access_org(organization_id));

create policy site_ownership_entitlements_tenant_read
on ss.site_ownership_entitlements for select
using (ss.can_access_org(organization_id));

create policy site_ownership_entitlement_events_tenant_read
on ss.site_ownership_entitlement_events for select
using (ss.can_access_org(organization_id));

revoke all on
  ss.billing_portal_sessions,
  ss.site_ownership_entitlements,
  ss.site_ownership_entitlement_events
from public, anon, authenticated;

grant select on ss.site_ownership_entitlements
to authenticated;

grant all privileges on
  ss.billing_portal_sessions,
  ss.site_ownership_entitlements,
  ss.site_ownership_entitlement_events
to service_role;

create function ss.has_current_serving_entitlement(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ss
as $$
  select
    exists (
      select 1
      from ss.stripe_subscriptions subscription
      where subscription.project_id = target_project_id
        and subscription.status in ('active', 'grace')
    )
    or exists (
      select 1
      from ss.site_ownership_entitlements entitlement
      where entitlement.project_id = target_project_id
        and entitlement.state = 'completed'
        and entitlement.refunded_amount_minor = 0
    )
$$;

revoke all on function ss.has_current_serving_entitlement(uuid)
from public, anon, authenticated;
grant execute on function ss.has_current_serving_entitlement(uuid)
to service_role;

create or replace function ss.request_release(
  target_project_id uuid,
  target_version_id uuid,
  target_screening_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
declare
  project_record record;
  address_record record;
  actor_id uuid := ss.current_user_id();
  request_id uuid := extensions.gen_random_uuid();
begin
  select project.organization_id, project.lifecycle
  into project_record
  from ss.projects project
  where project.id = target_project_id
  for update;

  if not found or not ss.can_access_org(project_record.organization_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not ss.has_org_role(
    project_record.organization_id,
    array['owner', 'admin', 'editor']
  ) then
    raise exception 'release is not authorized' using errcode = '42501';
  end if;

  if project_record.lifecycle <> 'active' then
    raise exception 'project is not active' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.project_safety_projection safety
    where safety.project_id = target_project_id
      and safety.state = 'clear'
  ) then
    raise exception 'project is under safety hold' using errcode = '23514';
  end if;

  if not ss.has_current_serving_entitlement(target_project_id) then
    raise exception 'verified paid serving entitlement is required'
      using errcode = '23514';
  end if;

  select address.*
  into address_record
  from ss.project_address_projection projection
  join ss.project_addresses address
    on address.organization_id = projection.organization_id
   and address.id = projection.current_address_id
  where projection.project_id = target_project_id
    and address.state = 'configured'
    and address.serving_hostname is not null;

  if not found then
    raise exception 'configured address is required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.version_state_projection state
    where state.version_id = target_version_id
      and state.project_id = target_project_id
      and state.state = 'accepted_release'
  ) then
    raise exception 'exact selected version is not an accepted release'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from ss.release_screenings screening
    where screening.id = target_screening_id
      and screening.project_id = target_project_id
      and screening.version_id = target_version_id
      and screening.stage = 'pre_publication'
      and screening.passed
  ) then
    raise exception 'exact pre-publication screening is required'
      using errcode = '23514';
  end if;

  insert into ss.release_requests (
    id,
    organization_id,
    project_id,
    version_id,
    address_id,
    requested_by_user_id,
    prepublication_screening_id
  ) values (
    request_id,
    project_record.organization_id,
    target_project_id,
    target_version_id,
    address_record.id,
    actor_id,
    target_screening_id
  );

  insert into ss.release_events (
    organization_id,
    project_id,
    release_request_id,
    state
  ) values (
    project_record.organization_id,
    target_project_id,
    request_id,
    'queued'
  );

  insert into ss.project_serving_projection (
    organization_id,
    project_id,
    state,
    resume_state,
    updated_at
  ) values (
    project_record.organization_id,
    target_project_id,
    'deploying',
    'unpublished',
    clock_timestamp()
  )
  on conflict (project_id) do update
  set state = 'deploying',
      resume_state = case
        when ss.project_serving_projection.state = 'live'
          then 'live'
        else ss.project_serving_projection.resume_state
      end,
      updated_at = excluded.updated_at;

  insert into ss.transactional_outbox (
    organization_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    dedupe_key
  ) values (
    project_record.organization_id,
    'release_request',
    request_id,
    'release.deploy_requested',
    jsonb_build_object(
      'releaseRequestId', request_id,
      'projectId', target_project_id,
      'versionId', target_version_id
    ),
    'release.deploy:' || request_id::text
  );

  perform ss.write_audit_event(
    project_record.organization_id,
    target_project_id,
    'user',
    actor_id::text,
    'release.requested',
    'release_request',
    request_id::text,
    null,
    jsonb_build_object('versionId', target_version_id)
  );

  return request_id;
end
$$;

create or replace function ss.acknowledge_private_lifecycle(
  presented_token_digest ss.sha256_hex,
  expected_project_id uuid,
  expected_version_id uuid,
  expected_artifact_digest ss.sha256_hex,
  expected_hostname ss.canonical_hostname,
  expected_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ss
as $$
begin
  if expected_visibility <> 'private' or not exists (
    select 1
    from ss.viewer_sessions viewer
    join ss.project_access_projection access
      on access.organization_id = viewer.organization_id
     and access.project_id = viewer.project_id
     and access.visibility = 'private'
     and access.current_credential_id = viewer.credential_id
    join ss.project_access_credentials credential
      on credential.organization_id = viewer.organization_id
     and credential.id = viewer.credential_id
     and credential.revoked_at is null
     and credential.credential_fingerprint =
       viewer.credential_fingerprint
    join ss.project_serving_projection serving
      on serving.organization_id = viewer.organization_id
     and serving.project_id = viewer.project_id
     and serving.state = 'live'
     and serving.current_release_id = viewer.release_id
    join ss.releases release
      on release.organization_id = viewer.organization_id
     and release.id = viewer.release_id
     and release.version_id = viewer.version_id
     and release.artifact_digest = viewer.artifact_digest
     and release.hostname = viewer.hostname
    join ss.projects project
      on project.organization_id = viewer.organization_id
     and project.id = viewer.project_id
     and project.lifecycle = 'active'
    join ss.project_safety_projection safety
      on safety.organization_id = viewer.organization_id
     and safety.project_id = viewer.project_id
     and safety.state = 'clear'
    where viewer.token_digest = presented_token_digest
      and viewer.revoked_at is null
      and viewer.expires_at > clock_timestamp()
      and viewer.project_id = expected_project_id
      and viewer.version_id = expected_version_id
      and viewer.artifact_digest = expected_artifact_digest
      and viewer.hostname = expected_hostname
      and viewer.visibility = expected_visibility
      and ss.has_current_serving_entitlement(viewer.project_id)
  ) then
    raise exception 'private lifecycle not acknowledged'
      using errcode = '42501';
  end if;

  return jsonb_build_object('acknowledged', true);
end
$$;

create function ss.hosted_runtime_contract_v13()
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select true
$$;

revoke all on function ss.hosted_runtime_contract_v13()
from public, anon, authenticated;
grant execute on function ss.hosted_runtime_contract_v13()
to service_role;

commit;
