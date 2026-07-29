PRAGMA foreign_keys = ON;

CREATE TABLE provider_receipts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT,
  project_id TEXT,
  provider_code TEXT NOT NULL,
  receipt_kind TEXT NOT NULL,
  external_object_ref TEXT NOT NULL,
  source_event_ref TEXT,
  facts_json TEXT NOT NULL
    CHECK (json_valid(facts_json) AND json_type(facts_json) = 'object'),
  facts_digest TEXT NOT NULL
    CHECK (
      length(facts_digest) = 64
      AND facts_digest NOT GLOB '*[^0-9a-f]*'
    ),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (provider_code, receipt_kind, external_object_ref),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER provider_receipts_immutable
BEFORE UPDATE ON provider_receipts
BEGIN
  SELECT RAISE(ABORT, 'provider_receipts is immutable');
END;

CREATE TRIGGER domain_attempt_receipt_scope
BEFORE INSERT ON domain_verification_attempts
WHEN NEW.provider_receipt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM provider_receipts receipt
    WHERE receipt.organization_id = NEW.organization_id
      AND receipt.project_id = NEW.project_id
      AND receipt.id = NEW.provider_receipt_id
  )
BEGIN
  SELECT RAISE(ABORT, 'domain verification receipt is outside project scope');
END;

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  api_version TEXT,
  payload_digest TEXT NOT NULL
    CHECK (
      length(payload_digest) = 64
      AND payload_digest NOT GLOB '*[^0-9a-f]*'
    ),
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  signature_verified_at TEXT NOT NULL,
  received_at TEXT NOT NULL
) STRICT;

CREATE TABLE stripe_event_processing (
  stripe_event_row_id TEXT PRIMARY KEY
    REFERENCES stripe_events(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at TEXT,
  locked_by TEXT,
  processed_at TEXT,
  failure_code TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE stripe_customers (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_from_receipt_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, created_from_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (organization_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER stripe_customer_receipt_authority
BEFORE INSERT ON stripe_customers
WHEN NOT EXISTS (
  SELECT 1
  FROM provider_receipts receipt
  WHERE receipt.organization_id = NEW.organization_id
    AND receipt.id = NEW.created_from_receipt_id
    AND receipt.provider_code = 'stripe'
    AND receipt.receipt_kind = 'customer_verified'
)
BEGIN
  SELECT RAISE(ABORT, 'verified Stripe customer receipt required');
END;

CREATE TABLE checkout_intents (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  catalog_price_id TEXT NOT NULL REFERENCES catalog_prices(id),
  currency TEXT NOT NULL
    CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  stripe_checkout_session_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'created'
    CHECK (
      state IN (
        'created',
        'provider_pending',
        'open',
        'completed',
        'expired',
        'failed'
      )
    ),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (organization_id, id),
  CHECK (expires_at IS NULL OR expires_at > created_at)
) STRICT;

CREATE TRIGGER checkout_must_be_enabled
BEFORE INSERT ON checkout_intents
WHEN (SELECT checkout_enabled FROM commerce_control WHERE singleton = 1) <> 1
BEGIN
  SELECT RAISE(ABORT, 'CHECKOUT_DISABLED');
END;

CREATE TRIGGER checkout_server_price_only
BEFORE INSERT ON checkout_intents
WHEN NOT EXISTS (
  SELECT 1
  FROM catalog_prices price
  WHERE price.id = NEW.catalog_price_id
    AND price.currency = NEW.currency
    AND price.unit_amount_minor = NEW.amount_minor
    AND price.approved_at IS NOT NULL
    AND price.active_from <= NEW.created_at
    AND (price.active_until IS NULL OR price.active_until > NEW.created_at)
)
BEGIN
  SELECT RAISE(ABORT, 'checkout amount must match approved catalog price');
END;

CREATE TABLE stripe_subscriptions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  stripe_customer_row_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL,
  catalog_price_id TEXT NOT NULL REFERENCES catalog_prices(id),
  billing_policy_id TEXT NOT NULL REFERENCES billing_policies(id),
  current_receipt_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (
      status IN ('pending', 'active', 'grace', 'suspended', 'cancelled', 'deleted')
    ),
  currency TEXT NOT NULL
    CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  first_failed_at TEXT,
  grace_ends_at TEXT,
  suspended_at TEXT,
  retention_ends_at TEXT,
  cancelled_at TEXT,
  current_period_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, stripe_customer_row_id)
    REFERENCES stripe_customers(organization_id, id),
  FOREIGN KEY (organization_id, current_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (organization_id, id),
  UNIQUE (project_id),
  CHECK (grace_ends_at IS NULL OR first_failed_at IS NOT NULL),
  CHECK (
    retention_ends_at IS NULL
    OR suspended_at IS NOT NULL
    OR cancelled_at IS NOT NULL
  )
) STRICT;

CREATE TRIGGER stripe_subscription_receipt_authority_insert
BEFORE INSERT ON stripe_subscriptions
WHEN NOT EXISTS (
  SELECT 1
  FROM provider_receipts receipt
  WHERE receipt.organization_id = NEW.organization_id
    AND receipt.project_id = NEW.project_id
    AND receipt.id = NEW.current_receipt_id
    AND receipt.provider_code = 'stripe'
    AND receipt.receipt_kind IN (
      'subscription_created',
      'subscription_updated',
      'invoice_paid',
      'invoice_failed',
      'subscription_cancelled'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'verified Stripe subscription receipt required');
END;

CREATE TRIGGER stripe_subscription_receipt_authority_update
BEFORE UPDATE OF status, current_receipt_id ON stripe_subscriptions
WHEN NOT EXISTS (
  SELECT 1
  FROM provider_receipts receipt
  WHERE receipt.organization_id = NEW.organization_id
    AND receipt.project_id = NEW.project_id
    AND receipt.id = NEW.current_receipt_id
    AND receipt.provider_code = 'stripe'
    AND receipt.receipt_kind IN (
      'subscription_created',
      'subscription_updated',
      'invoice_paid',
      'invoice_failed',
      'subscription_cancelled',
      'terminal_deletion'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'verified Stripe subscription receipt required');
END;

CREATE TABLE stripe_receipts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_receipt_id TEXT NOT NULL,
  stripe_event_row_id TEXT NOT NULL REFERENCES stripe_events(id),
  stripe_object_id TEXT NOT NULL,
  receipt_kind TEXT NOT NULL
    CHECK (
      receipt_kind IN (
        'checkout_completed',
        'subscription_created',
        'subscription_updated',
        'invoice_paid',
        'invoice_failed',
        'subscription_cancelled',
        'refund'
      )
    ),
  currency TEXT CHECK (
    currency IS NULL
    OR (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')
  ),
  amount_minor INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (stripe_event_row_id, stripe_object_id, receipt_kind),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER stripe_receipt_authority
BEFORE INSERT ON stripe_receipts
WHEN NOT EXISTS (
  SELECT 1
  FROM provider_receipts receipt
  JOIN stripe_events event
    ON event.id = NEW.stripe_event_row_id
  WHERE receipt.organization_id = NEW.organization_id
    AND receipt.project_id = NEW.project_id
    AND receipt.id = NEW.provider_receipt_id
    AND receipt.provider_code = 'stripe'
    AND receipt.source_event_ref = event.stripe_event_id
)
BEGIN
  SELECT RAISE(ABORT, 'Stripe receipt must match verified event and project');
END;

CREATE TABLE subscription_state_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('pending', 'active', 'grace', 'suspended', 'cancelled', 'deleted')),
  stripe_receipt_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES stripe_subscriptions(organization_id, id),
  FOREIGN KEY (organization_id, stripe_receipt_id)
    REFERENCES stripe_receipts(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE subscription_entitlements (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  variant_id TEXT NOT NULL REFERENCES catalog_variants(id),
  entitlement_key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  source_receipt_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES stripe_subscriptions(organization_id, id),
  FOREIGN KEY (organization_id, source_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (subscription_id, entitlement_key),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER subscription_entitlement_catalog_match
BEFORE INSERT ON subscription_entitlements
WHEN NOT EXISTS (
  SELECT 1
  FROM stripe_subscriptions subscription
  JOIN catalog_prices price ON price.id = subscription.catalog_price_id
  JOIN catalog_entitlements entitlement
    ON entitlement.variant_id = price.variant_id
  WHERE subscription.organization_id = NEW.organization_id
    AND subscription.project_id = NEW.project_id
    AND subscription.id = NEW.subscription_id
    AND price.variant_id = NEW.variant_id
    AND entitlement.entitlement_key = NEW.entitlement_key
    AND json(entitlement.value_json) = json(NEW.value_json)
)
BEGIN
  SELECT RAISE(ABORT, 'entitlement must match subscribed catalog variant');
END;

CREATE TABLE release_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  address_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  prepublication_screening_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  FOREIGN KEY (organization_id, address_id)
    REFERENCES project_addresses(organization_id, id),
  FOREIGN KEY (organization_id, prepublication_screening_id)
    REFERENCES release_screenings(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER release_request_exact_gate
BEFORE INSERT ON release_requests
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM projects project
    JOIN project_safety_projection safety
      ON safety.organization_id = project.organization_id
     AND safety.project_id = project.id
    JOIN stripe_subscriptions subscription
      ON subscription.organization_id = project.organization_id
     AND subscription.project_id = project.id
    JOIN project_address_projection address_projection
      ON address_projection.organization_id = project.organization_id
     AND address_projection.project_id = project.id
    JOIN project_addresses address
      ON address.organization_id = address_projection.organization_id
     AND address.id = address_projection.current_address_id
    JOIN version_state_projection version_state
      ON version_state.organization_id = project.organization_id
     AND version_state.project_id = project.id
     AND version_state.version_id = NEW.version_id
    JOIN release_screenings screening
      ON screening.organization_id = project.organization_id
     AND screening.project_id = project.id
     AND screening.version_id = NEW.version_id
     AND screening.id = NEW.prepublication_screening_id
    WHERE project.organization_id = NEW.organization_id
      AND project.id = NEW.project_id
      AND project.lifecycle = 'active'
      AND safety.state = 'clear'
      AND subscription.status IN ('active', 'grace')
      AND address.id = NEW.address_id
      AND address.state = 'configured'
      AND address.serving_hostname IS NOT NULL
      AND version_state.state = 'accepted_release'
      AND screening.stage = 'pre_publication'
      AND screening.passed = 1
  )
)
BEGIN
  SELECT RAISE(ABORT, 'release request failed exact publication gate');
END;

CREATE TABLE release_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  release_request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'deploying', 'failed', 'released')),
  reason_code TEXT,
  provider_receipt_id TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, release_request_id)
    REFERENCES release_requests(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (organization_id, id),
  CHECK (
    (state = 'released' AND provider_receipt_id IS NOT NULL)
    OR state <> 'released'
  )
) STRICT;

CREATE TABLE releases (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  release_request_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL
    CHECK (
      length(artifact_digest) = 64
      AND artifact_digest NOT GLOB '*[^0-9a-f]*'
    ),
  hostname TEXT NOT NULL,
  deployment_receipt_id TEXT NOT NULL,
  released_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, release_request_id)
    REFERENCES release_requests(organization_id, id),
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  FOREIGN KEY (organization_id, artifact_id)
    REFERENCES artifacts(organization_id, id),
  FOREIGN KEY (organization_id, deployment_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (release_request_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER release_exact_deployment_receipt
BEFORE INSERT ON releases
WHEN NOT EXISTS (
  SELECT 1
  FROM release_requests request
  JOIN project_addresses address
    ON address.organization_id = request.organization_id
   AND address.id = request.address_id
  JOIN site_versions version
    ON version.organization_id = request.organization_id
   AND version.id = request.version_id
  JOIN artifacts artifact
    ON artifact.organization_id = version.organization_id
   AND artifact.id = version.artifact_id
  JOIN provider_receipts receipt
    ON receipt.organization_id = request.organization_id
   AND receipt.project_id = request.project_id
   AND receipt.id = NEW.deployment_receipt_id
  WHERE request.organization_id = NEW.organization_id
    AND request.project_id = NEW.project_id
    AND request.id = NEW.release_request_id
    AND request.version_id = NEW.version_id
    AND version.artifact_id = NEW.artifact_id
    AND artifact.artifact_digest = NEW.artifact_digest
    AND address.serving_hostname = NEW.hostname
    AND receipt.receipt_kind = 'deployment_verified'
    AND json_extract(receipt.facts_json, '$.projectId') = NEW.project_id
    AND json_extract(receipt.facts_json, '$.versionId') = NEW.version_id
    AND json_extract(receipt.facts_json, '$.artifactDigest') = NEW.artifact_digest
    AND json_extract(receipt.facts_json, '$.hostname') = NEW.hostname
)
BEGIN
  SELECT RAISE(ABORT, 'deployment receipt does not match exact release tuple');
END;

CREATE TABLE project_serving_projection (
  organization_id TEXT NOT NULL,
  project_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'unpublished'
    CHECK (state IN ('unpublished', 'deploying', 'live', 'dark', 'deleted')),
  current_release_id TEXT,
  previous_release_id TEXT,
  resume_state TEXT NOT NULL DEFAULT 'unpublished'
    CHECK (resume_state IN ('unpublished', 'live')),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, current_release_id)
    REFERENCES releases(organization_id, id),
  FOREIGN KEY (organization_id, previous_release_id)
    REFERENCES releases(organization_id, id),
  CHECK (
    (state = 'live' AND current_release_id IS NOT NULL)
    OR state <> 'live'
  )
) STRICT;

CREATE TABLE serving_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  release_id TEXT,
  event_kind TEXT NOT NULL
    CHECK (
      event_kind IN (
        'deploy_requested',
        'deploy_failed',
        'published',
        'unpublished',
        'safety_dark',
        'billing_dark',
        'deleted'
      )
    ),
  source_receipt_id TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, release_id)
    REFERENCES releases(organization_id, id),
  FOREIGN KEY (organization_id, source_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE viewer_sessions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  release_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  hostname TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility = 'private'),
  token_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, credential_id)
    REFERENCES project_access_credentials(organization_id, id),
  FOREIGN KEY (organization_id, release_id)
    REFERENCES releases(organization_id, id),
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  CHECK (expires_at > created_at)
) STRICT;

CREATE INDEX viewer_sessions_current
  ON viewer_sessions(project_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  opened_by_user_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 120),
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'waiting_customer', 'waiting_support', 'resolved', 'closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE support_messages (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('customer', 'support', 'system')),
  author_user_id TEXT REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, ticket_id)
    REFERENCES support_tickets(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE export_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'building', 'ready', 'failed', 'expired')),
  manifest_digest TEXT,
  object_key TEXT,
  byte_count INTEGER CHECK (byte_count IS NULL OR byte_count >= 0),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  CHECK (
    state <> 'ready'
    OR (
      manifest_digest IS NOT NULL
      AND object_key IS NOT NULL
      AND byte_count IS NOT NULL
      AND completed_at IS NOT NULL
      AND expires_at IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE deletion_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requested_by_user_id TEXT REFERENCES users(id),
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'sealing'
    CHECK (state IN ('sealing', 'purging', 'verifying', 'completed', 'failed')),
  accepted_term_ids_json TEXT,
  billing_timestamps_json TEXT,
  address_disposition TEXT,
  retained_customer_domains_json TEXT,
  removal_counts_json TEXT,
  requested_at TEXT NOT NULL,
  sealed_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (project_id),
  UNIQUE (organization_id, id),
  CHECK (accepted_term_ids_json IS NULL OR json_valid(accepted_term_ids_json)),
  CHECK (billing_timestamps_json IS NULL OR json_valid(billing_timestamps_json)),
  CHECK (retained_customer_domains_json IS NULL OR json_valid(retained_customer_domains_json)),
  CHECK (removal_counts_json IS NULL OR json_valid(removal_counts_json))
) STRICT;

CREATE TABLE project_deletion_tombstones (
  project_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  deletion_request_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  accepted_term_ids_json TEXT NOT NULL CHECK (json_valid(accepted_term_ids_json)),
  billing_policy_id TEXT NOT NULL REFERENCES billing_policies(id),
  billing_timestamps_json TEXT NOT NULL CHECK (json_valid(billing_timestamps_json)),
  address_disposition TEXT NOT NULL
    CHECK (
      address_disposition IN (
        'licensed_address_released',
        'customer_domain_retained_detached',
        'no_address'
      )
    ),
  retained_customer_domains_json TEXT NOT NULL
    CHECK (json_valid(retained_customer_domains_json)),
  removal_counts_json TEXT NOT NULL CHECK (json_valid(removal_counts_json)),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, deletion_request_id)
    REFERENCES deletion_requests(organization_id, id),
  UNIQUE (organization_id, project_id)
) STRICT;

CREATE TABLE project_retained_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER stripe_events_immutable
BEFORE UPDATE ON stripe_events
BEGIN
  SELECT RAISE(ABORT, 'stripe_events is immutable');
END;

CREATE TRIGGER stripe_receipts_immutable
BEFORE UPDATE ON stripe_receipts
BEGIN
  SELECT RAISE(ABORT, 'stripe_receipts is immutable');
END;

CREATE TRIGGER subscription_state_events_immutable
BEFORE UPDATE ON subscription_state_events
BEGIN
  SELECT RAISE(ABORT, 'subscription_state_events is immutable');
END;

CREATE TRIGGER subscription_entitlements_immutable
BEFORE UPDATE ON subscription_entitlements
BEGIN
  SELECT RAISE(ABORT, 'subscription_entitlements is immutable');
END;

CREATE TRIGGER release_requests_immutable
BEFORE UPDATE ON release_requests
BEGIN
  SELECT RAISE(ABORT, 'release_requests is immutable');
END;

CREATE TRIGGER release_events_immutable
BEFORE UPDATE ON release_events
BEGIN
  SELECT RAISE(ABORT, 'release_events is immutable');
END;

CREATE TRIGGER releases_immutable
BEFORE UPDATE ON releases
BEGIN
  SELECT RAISE(ABORT, 'releases is immutable');
END;

CREATE TRIGGER serving_events_immutable
BEFORE UPDATE ON serving_events
BEGIN
  SELECT RAISE(ABORT, 'serving_events is immutable');
END;

CREATE TRIGGER support_messages_immutable
BEFORE UPDATE ON support_messages
BEGIN
  SELECT RAISE(ABORT, 'support_messages is immutable');
END;

CREATE TRIGGER project_deletion_tombstones_immutable
BEFORE UPDATE ON project_deletion_tombstones
BEGIN
  SELECT RAISE(ABORT, 'project_deletion_tombstones is immutable');
END;

CREATE TRIGGER project_retained_events_immutable
BEFORE UPDATE ON project_retained_events
BEGIN
  SELECT RAISE(ABORT, 'project_retained_events is immutable');
END;
