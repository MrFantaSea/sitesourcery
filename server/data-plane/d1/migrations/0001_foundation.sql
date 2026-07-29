PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'locked', 'deleting', 'deleted')),
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_code TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_authenticated_at TEXT,
  UNIQUE (provider_code, provider_subject)
) STRICT;

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_organization_id TEXT,
  family_id TEXT NOT NULL CHECK (length(family_id) = 36),
  refresh_token_digest TEXT NOT NULL UNIQUE
    CHECK (
      length(refresh_token_digest) = 64
      AND refresh_token_digest NOT GLOB '*[^0-9a-f]*'
    ),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
) STRICT;

CREATE INDEX auth_sessions_live
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'suspended', 'deleting', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (id, id)
) STRICT;

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'admin', 'editor', 'billing', 'viewer')),
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('invited', 'active', 'suspended', 'removed')),
  invited_at TEXT,
  accepted_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
) STRICT;

CREATE INDEX organization_memberships_user
  ON organization_memberships(user_id, organization_id)
  WHERE state = 'active';

CREATE TRIGGER auth_sessions_current_org_insert
BEFORE INSERT ON auth_sessions
WHEN NEW.current_organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships membership
    WHERE membership.organization_id = NEW.current_organization_id
      AND membership.user_id = NEW.user_id
      AND membership.state = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'session organization is not an active membership');
END;

CREATE TRIGGER auth_sessions_current_org_update
BEFORE UPDATE OF current_organization_id ON auth_sessions
WHEN NEW.current_organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM organization_memberships membership
    WHERE membership.organization_id = NEW.current_organization_id
      AND membership.user_id = NEW.user_id
      AND membership.state = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'session organization is not an active membership');
END;

CREATE TABLE legal_documents (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  kind TEXT NOT NULL
    CHECK (kind IN ('product', 'privacy', 'website', 'domain_agent', 'domain_renewal')),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 3 AND 120),
  content_digest TEXT NOT NULL
    CHECK (
      length(content_digest) = 64
      AND content_digest NOT GLOB '*[^0-9a-f]*'
    ),
  content_uri TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (kind, version),
  CHECK (retired_at IS NULL OR retired_at >= effective_at)
) STRICT;

CREATE TABLE billing_policies (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  policy_key TEXT NOT NULL UNIQUE,
  grace_seconds INTEGER NOT NULL CHECK (grace_seconds > 0),
  retention_seconds INTEGER NOT NULL CHECK (retention_seconds > 0),
  effective_at TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (retired_at IS NULL OR retired_at >= effective_at)
) STRICT;

INSERT INTO billing_policies (
  id,
  policy_key,
  grace_seconds,
  retention_seconds,
  effective_at,
  created_at
) VALUES (
  '00000000-0000-4000-8000-000000000014',
  'abracadabra-hosted-14d-grace-90d-retention/v1',
  1209600,
  7776000,
  '2026-07-28T00:00:00.000Z',
  '2026-07-28T00:00:00.000Z'
);

CREATE TABLE catalog_plans (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  plan_key TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (plan_key, catalog_version),
  CHECK (active_until IS NULL OR active_until >= active_from)
) STRICT;

CREATE TABLE catalog_variants (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  plan_id TEXT NOT NULL REFERENCES catalog_plans(id),
  variant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(configuration_json) AND json_type(configuration_json) = 'object'),
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (plan_id, variant_key),
  CHECK (active_until IS NULL OR active_until >= active_from)
) STRICT;

CREATE TABLE catalog_entitlements (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  variant_id TEXT NOT NULL REFERENCES catalog_variants(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  created_at TEXT NOT NULL,
  UNIQUE (variant_id, entitlement_key)
) STRICT;

CREATE TABLE catalog_prices (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  variant_id TEXT NOT NULL REFERENCES catalog_variants(id),
  currency TEXT NOT NULL
    CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  unit_amount_minor INTEGER NOT NULL CHECK (unit_amount_minor >= 0),
  cadence TEXT NOT NULL CHECK (cadence IN ('one_time', 'month', 'year')),
  approved_at TEXT NOT NULL,
  active_from TEXT NOT NULL,
  active_until TEXT,
  created_at TEXT NOT NULL,
  CHECK (active_until IS NULL OR active_until >= active_from)
) STRICT;

CREATE TABLE commerce_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  checkout_enabled INTEGER NOT NULL DEFAULT 0 CHECK (checkout_enabled IN (0, 1)),
  live_mode INTEGER NOT NULL DEFAULT 0 CHECK (live_mode IN (0, 1)),
  active_catalog_version TEXT,
  enabled_at TEXT,
  enabled_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  CHECK (
    checkout_enabled = 0
    OR (
      active_catalog_version IS NOT NULL
      AND enabled_at IS NOT NULL
      AND enabled_by_user_id IS NOT NULL
    )
  )
) STRICT;

INSERT INTO commerce_control (
  singleton,
  checkout_enabled,
  live_mode,
  active_catalog_version,
  updated_at
) VALUES (
  1,
  0,
  0,
  NULL,
  '2026-07-28T00:00:00.000Z'
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT REFERENCES organizations(id),
  project_id TEXT,
  actor_kind TEXT NOT NULL
    CHECK (actor_kind IN ('user', 'operator', 'system', 'provider')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  previous_hash TEXT,
  event_hash TEXT NOT NULL
    CHECK (
      length(event_hash) = 64
      AND event_hash NOT GLOB '*[^0-9a-f]*'
    ),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_events_org_time
  ON audit_events(organization_id, occurred_at DESC);

CREATE TABLE idempotency_keys (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT REFERENCES organizations(id),
  principal_id TEXT NOT NULL REFERENCES users(id),
  route_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  response_status INTEGER CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  response_body_json TEXT CHECK (
    response_body_json IS NULL OR json_valid(response_body_json)
  ),
  resource_type TEXT,
  resource_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (principal_id, route_key, idempotency_key),
  CHECK (expires_at > created_at)
) STRICT;

CREATE TABLE transactional_outbox (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT REFERENCES organizations(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  dedupe_key TEXT NOT NULL UNIQUE,
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_at TEXT,
  locked_by TEXT,
  published_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX transactional_outbox_ready
  ON transactional_outbox(available_at, id)
  WHERE published_at IS NULL;

CREATE TABLE lifecycle_jobs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT REFERENCES organizations(id),
  project_id TEXT,
  job_type TEXT NOT NULL
    CHECK (
      job_type IN (
        'deploy_release',
        'verify_domain',
        'grace_expiry',
        'retention_expiry',
        'delete_blob',
        'finalize_deletion',
        'build_export',
        'expire_session'
      )
    ),
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'running', 'succeeded', 'failed', 'cancelled')),
  run_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 12 CHECK (max_attempts > 0),
  locked_at TEXT,
  locked_by TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE INDEX lifecycle_jobs_ready
  ON lifecycle_jobs(run_at, id)
  WHERE state IN ('scheduled', 'failed');

CREATE TRIGGER legal_documents_immutable
BEFORE UPDATE ON legal_documents
BEGIN
  SELECT RAISE(ABORT, 'legal_documents is immutable');
END;

CREATE TRIGGER billing_policies_immutable
BEFORE UPDATE ON billing_policies
BEGIN
  SELECT RAISE(ABORT, 'billing_policies is immutable');
END;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is immutable');
END;
