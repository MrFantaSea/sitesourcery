begin;

create table ss.provider_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references ss.organizations(id),
  project_id uuid,
  provider_code text not null,
  receipt_kind text not null,
  external_object_ref text not null,
  source_event_ref text,
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  facts_digest ss.sha256_hex not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (provider_code, receipt_kind, external_object_ref),
  unique (organization_id, id)
);

create trigger provider_receipts_no_update
before update on ss.provider_receipts
for each row execute function ss.reject_update();

alter table ss.domain_verification_attempts
  add constraint domain_verification_attempts_receipt_fk
  foreign key (organization_id, provider_receipt_id)
  references ss.provider_receipts(organization_id, id);

create table ss.stripe_customers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references ss.organizations(id),
  stripe_customer_id text not null unique,
  created_from_receipt_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id),
  unique (organization_id, id),
  foreign key (organization_id, created_from_receipt_id)
    references ss.provider_receipts(organization_id, id)
);

create table ss.stripe_events (
  id uuid primary key default extensions.gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  livemode boolean not null,
  api_version text,
  payload_digest ss.sha256_hex not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  signature_verified_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp()
);

create trigger stripe_events_no_update
before update on ss.stripe_events
for each row execute function ss.reject_update();

create table ss.stripe_event_processing (
  stripe_event_row_id uuid primary key references ss.stripe_events(id) on delete cascade,
  state text not null default 'received'
    check (state in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  failure_code text,
  updated_at timestamptz not null default clock_timestamp()
);

create trigger stripe_event_processing_updated_at
before update on ss.stripe_event_processing
for each row execute function ss.set_updated_at();

create table ss.checkout_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  catalog_price_id uuid not null references ss.catalog_prices(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  stripe_checkout_session_id text unique,
  state text not null default 'created'
    check (
      state in (
        'created',
        'provider_pending',
        'open',
        'completed',
        'expired',
        'failed'
      )
    ),
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (organization_id, id),
  check (expires_at is null or expires_at > created_at)
);

create trigger checkout_intents_updated_at
before update on ss.checkout_intents
for each row execute function ss.set_updated_at();

create table ss.stripe_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  stripe_customer_row_id uuid not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  catalog_price_id uuid not null references ss.catalog_prices(id),
  billing_policy_id uuid not null references ss.billing_policies(id),
  status text not null
    check (
      status in (
        'pending',
        'active',
        'grace',
        'suspended',
        'cancelled',
        'deleted'
      )
    ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  first_failed_at timestamptz,
  grace_ends_at timestamptz,
  suspended_at timestamptz,
  retention_ends_at timestamptz,
  cancelled_at timestamptz,
  current_period_ends_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, stripe_customer_row_id)
    references ss.stripe_customers(organization_id, id),
  unique (organization_id, id),
  unique (project_id),
  check (grace_ends_at is null or first_failed_at is not null),
  check (retention_ends_at is null or suspended_at is not null or cancelled_at is not null)
);

create trigger stripe_subscriptions_updated_at
before update on ss.stripe_subscriptions
for each row execute function ss.set_updated_at();

create table ss.stripe_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  provider_receipt_id uuid not null,
  stripe_event_row_id uuid not null references ss.stripe_events(id),
  stripe_object_id text not null,
  receipt_kind text not null
    check (
      receipt_kind in (
        'checkout_completed',
        'subscription_created',
        'subscription_updated',
        'invoice_paid',
        'invoice_failed',
        'subscription_cancelled',
        'refund'
      )
    ),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  occurred_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (stripe_event_row_id, stripe_object_id, receipt_kind),
  unique (organization_id, id)
);

create trigger stripe_receipts_no_update
before update on ss.stripe_receipts
for each row execute function ss.reject_update();

create table ss.subscription_state_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  subscription_id uuid not null,
  state text not null
    check (state in ('pending', 'active', 'grace', 'suspended', 'cancelled', 'deleted')),
  stripe_receipt_id uuid not null,
  occurred_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, subscription_id)
    references ss.stripe_subscriptions(organization_id, id),
  foreign key (organization_id, stripe_receipt_id)
    references ss.stripe_receipts(organization_id, id)
);

create trigger subscription_state_events_no_update
before update on ss.subscription_state_events
for each row execute function ss.reject_update();

create table ss.release_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  version_id uuid not null,
  address_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  prepublication_screening_id uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  foreign key (organization_id, address_id)
    references ss.project_addresses(organization_id, id),
  foreign key (organization_id, prepublication_screening_id)
    references ss.release_screenings(organization_id, id),
  unique (organization_id, id)
);

create trigger release_requests_no_update
before update on ss.release_requests
for each row execute function ss.reject_update();

create table ss.release_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  release_request_id uuid not null,
  state text not null
    check (state in ('queued', 'deploying', 'failed', 'released')),
  reason_code text,
  provider_receipt_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, release_request_id)
    references ss.release_requests(organization_id, id) on delete cascade,
  foreign key (organization_id, provider_receipt_id)
    references ss.provider_receipts(organization_id, id),
  check (
    (state = 'released' and provider_receipt_id is not null)
    or state <> 'released'
  )
);

create trigger release_events_no_update
before update on ss.release_events
for each row execute function ss.reject_update();

create table ss.releases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  release_request_id uuid not null,
  version_id uuid not null,
  artifact_id uuid not null,
  artifact_digest ss.sha256_hex not null,
  hostname ss.canonical_hostname not null,
  deployment_receipt_id uuid not null,
  released_at timestamptz not null,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, release_request_id)
    references ss.release_requests(organization_id, id),
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  foreign key (organization_id, artifact_id)
    references ss.artifacts(organization_id, id),
  foreign key (organization_id, deployment_receipt_id)
    references ss.provider_receipts(organization_id, id),
  unique (release_request_id),
  unique (organization_id, id)
);

create trigger releases_no_update
before update on ss.releases
for each row execute function ss.reject_update();

create table ss.project_serving_projection (
  organization_id uuid not null,
  project_id uuid primary key,
  state text not null default 'unpublished'
    check (state in ('unpublished', 'deploying', 'live', 'dark', 'deleted')),
  current_release_id uuid,
  previous_release_id uuid,
  resume_state text not null default 'unpublished'
    check (resume_state in ('unpublished', 'live')),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, current_release_id)
    references ss.releases(organization_id, id),
  foreign key (organization_id, previous_release_id)
    references ss.releases(organization_id, id),
  check (
    (state = 'live' and current_release_id is not null)
    or state <> 'live'
  )
);

create table ss.serving_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  release_id uuid,
  event_kind text not null
    check (
      event_kind in (
        'deploy_requested',
        'deploy_failed',
        'published',
        'unpublished',
        'safety_dark',
        'billing_dark',
        'deleted'
      )
    ),
  source_receipt_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, release_id)
    references ss.releases(organization_id, id),
  foreign key (organization_id, source_receipt_id)
    references ss.provider_receipts(organization_id, id)
);

create trigger serving_events_no_update
before update on ss.serving_events
for each row execute function ss.reject_update();

create table ss.viewer_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  credential_id uuid not null,
  credential_fingerprint ss.sha256_hex not null,
  release_id uuid not null,
  version_id uuid not null,
  artifact_digest ss.sha256_hex not null,
  hostname ss.canonical_hostname not null,
  visibility text not null check (visibility = 'private'),
  token_digest ss.sha256_hex not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, credential_id)
    references ss.project_access_credentials(organization_id, id),
  foreign key (organization_id, release_id)
    references ss.releases(organization_id, id),
  foreign key (organization_id, version_id)
    references ss.site_versions(organization_id, id),
  check (expires_at > created_at)
);

create index viewer_sessions_current
  on ss.viewer_sessions(project_id, expires_at)
  where revoked_at is null;

create table ss.support_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  opened_by_user_id uuid not null references auth.users(id),
  subject text not null check (char_length(subject) between 3 and 120),
  state text not null default 'open'
    check (state in ('open', 'waiting_customer', 'waiting_support', 'resolved', 'closed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create trigger support_tickets_updated_at
before update on ss.support_tickets
for each row execute function ss.set_updated_at();

create table ss.support_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  ticket_id uuid not null,
  author_kind text not null check (author_kind in ('customer', 'support', 'system')),
  author_user_id uuid references auth.users(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, ticket_id)
    references ss.support_tickets(organization_id, id) on delete cascade
);

create trigger support_messages_no_update
before update on ss.support_messages
for each row execute function ss.reject_update();

create table ss.export_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  requested_by_user_id uuid not null references auth.users(id),
  state text not null default 'queued'
    check (state in ('queued', 'building', 'ready', 'failed', 'expired')),
  manifest_digest ss.sha256_hex,
  object_key text,
  byte_count bigint check (byte_count is null or byte_count >= 0),
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (
    state <> 'ready'
    or (
      manifest_digest is not null
      and object_key is not null
      and byte_count is not null
      and completed_at is not null
      and expires_at is not null
    )
  )
);

create table ss.deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  requested_by_user_id uuid references auth.users(id),
  policy_version text not null,
  state text not null default 'sealing'
    check (state in ('sealing', 'purging', 'verifying', 'completed', 'failed')),
  requested_at timestamptz not null default clock_timestamp(),
  sealed_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  unique (project_id),
  unique (organization_id, id)
);

create table ss.project_deletion_tombstones (
  project_id uuid primary key,
  organization_id uuid not null,
  deletion_request_id uuid not null,
  policy_version text not null,
  deleted_at timestamptz not null,
  accepted_term_ids uuid[] not null,
  billing_policy_id uuid not null references ss.billing_policies(id),
  billing_timestamps jsonb not null check (jsonb_typeof(billing_timestamps) = 'object'),
  address_disposition text not null
    check (
      address_disposition in (
        'licensed_address_released',
        'customer_domain_retained_detached',
        'no_address'
      )
    ),
  retained_customer_domains text[] not null default '{}'::text[],
  removal_counts jsonb not null check (jsonb_typeof(removal_counts) = 'object'),
  foreign key (organization_id, project_id)
    references ss.projects(organization_id, id),
  foreign key (organization_id, deletion_request_id)
    references ss.deletion_requests(organization_id, id),
  unique (organization_id, project_id)
);

create trigger project_deletion_tombstones_no_update
before update on ss.project_deletion_tombstones
for each row execute function ss.reject_update();

commit;
