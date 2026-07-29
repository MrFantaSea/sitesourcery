PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  billing_policy_id TEXT NOT NULL REFERENCES billing_policies(id),
  name TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active', 'cancelled', 'deleting', 'deleted')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  cancelled_at TEXT,
  retention_ends_at TEXT,
  deletion_started_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  CHECK (
    (
      lifecycle IN ('active', 'cancelled')
      AND name IS NOT NULL
      AND length(name) BETWEEN 2 AND 120
    )
    OR (
      lifecycle IN ('deleting', 'deleted')
      AND name IS NULL
    )
  ),
  CHECK (
    retention_ends_at IS NULL
    OR cancelled_at IS NULL
    OR retention_ends_at >= cancelled_at
  )
) STRICT;

CREATE INDEX projects_org_updated
  ON projects(organization_id, updated_at DESC);

CREATE TABLE term_acceptances (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  document_id TEXT NOT NULL REFERENCES legal_documents(id),
  accepted_at TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  ip_address TEXT,
  user_agent_digest TEXT CHECK (
    user_agent_digest IS NULL
    OR (
      length(user_agent_digest) = 64
      AND user_agent_digest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (project_id, document_id, user_id, request_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE project_required_terms (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'privacy', 'website')),
  acceptance_id TEXT NOT NULL,
  PRIMARY KEY (project_id, kind),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, acceptance_id)
    REFERENCES term_acceptances(organization_id, id),
  UNIQUE (acceptance_id)
) STRICT;

CREATE TRIGGER project_required_terms_match
BEFORE INSERT ON project_required_terms
WHEN NOT EXISTS (
  SELECT 1
  FROM term_acceptances acceptance
  JOIN legal_documents document ON document.id = acceptance.document_id
  WHERE acceptance.id = NEW.acceptance_id
    AND acceptance.organization_id = NEW.organization_id
    AND acceptance.project_id = NEW.project_id
    AND document.kind = NEW.kind
)
BEGIN
  SELECT RAISE(ABORT, 'project term does not match exact acceptance');
END;

CREATE TABLE project_safety_projection (
  organization_id TEXT NOT NULL,
  project_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'clear'
    CHECK (state IN ('clear', 'held', 'appeal_pending', 'closed')),
  previous_serving_state TEXT
    CHECK (
      previous_serving_state IS NULL
      OR previous_serving_state IN ('unpublished', 'live')
    ),
  held_at TEXT,
  restored_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE safety_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('hold', 'appeal', 'restore', 'closed_by_deletion')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'operator', 'system')),
  actor_id TEXT,
  narrative TEXT,
  previous_serving_state TEXT,
  resulting_serving_state TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE project_access_credentials (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  password_phc TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL
    CHECK (
      length(credential_fingerprint) = 64
      AND credential_fingerprint NOT GLOB '*[^0-9a-f]*'
    ),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE UNIQUE INDEX project_access_credentials_one_current
  ON project_access_credentials(project_id)
  WHERE revoked_at IS NULL;

CREATE TABLE project_access_projection (
  organization_id TEXT NOT NULL,
  project_id TEXT PRIMARY KEY,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private', 'closed')),
  current_credential_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, current_credential_id)
    REFERENCES project_access_credentials(organization_id, id),
  CHECK (
    (visibility = 'private' AND current_credential_id IS NOT NULL)
    OR (visibility IN ('public', 'closed') AND current_credential_id IS NULL)
  )
) STRICT;

CREATE TABLE project_addresses (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('licensed', 'customer_purchase', 'customer_byod')),
  ownership TEXT NOT NULL CHECK (ownership IN ('licensed', 'customer')),
  label TEXT CHECK (
    label IS NULL
    OR (
      length(label) BETWEEN 1 AND 63
      AND label = lower(label)
      AND label NOT GLOB '*[^a-z0-9-]*'
      AND substr(label, 1, 1) <> '-'
      AND substr(label, -1, 1) <> '-'
    )
  ),
  retained_domain TEXT CHECK (
    retained_domain IS NULL
    OR (
      retained_domain = lower(retained_domain)
      AND retained_domain NOT LIKE '%.'
      AND instr(retained_domain, '.') > 1
      AND length(retained_domain) <= 253
    )
  ),
  serving_hostname TEXT CHECK (
    serving_hostname IS NULL
    OR (
      serving_hostname = lower(serving_hostname)
      AND serving_hostname NOT LIKE '%.'
      AND instr(serving_hostname, '.') > 1
      AND length(serving_hostname) <= 253
    )
  ),
  state TEXT NOT NULL
    CHECK (state IN ('pending', 'pending_review', 'configured', 'detached', 'released')),
  allocated_at TEXT NOT NULL,
  configured_at TEXT,
  detached_at TEXT,
  released_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  CHECK (
    (kind = 'licensed' AND ownership = 'licensed')
    OR (kind <> 'licensed' AND ownership = 'customer')
  ),
  CHECK (kind <> 'licensed' OR retained_domain IS NULL),
  CHECK (kind = 'licensed' OR retained_domain IS NOT NULL),
  CHECK (
    state IN ('detached', 'released')
    OR serving_hostname IS NOT NULL
  )
) STRICT;

CREATE UNIQUE INDEX project_addresses_active_hostname
  ON project_addresses(lower(serving_hostname))
  WHERE serving_hostname IS NOT NULL
    AND state NOT IN ('detached', 'released');

CREATE TABLE project_address_projection (
  organization_id TEXT NOT NULL,
  project_id TEXT PRIMARY KEY,
  current_address_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, current_address_id)
    REFERENCES project_addresses(organization_id, id)
) STRICT;

CREATE TABLE domain_verification_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  address_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('registrar_receipt', 'dns_challenge')),
  proof_reference_ciphertext BLOB NOT NULL,
  proof_reference_digest TEXT NOT NULL
    CHECK (
      length(proof_reference_digest) = 64
      AND proof_reference_digest NOT GLOB '*[^0-9a-f]*'
    ),
  state TEXT NOT NULL
    CHECK (state IN ('pending_review', 'approved', 'rejected', 'superseded')),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, address_id)
    REFERENCES project_addresses(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE UNIQUE INDEX domain_verification_one_pending
  ON domain_verification_requests(address_id)
  WHERE state = 'pending_review';

CREATE TABLE domain_verification_attempts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  verifier_kind TEXT NOT NULL
    CHECK (verifier_kind IN ('dns_worker', 'registrar_adapter', 'operator')),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'inconclusive')),
  observed_digest TEXT CHECK (
    observed_digest IS NULL
    OR (
      length(observed_digest) = 64
      AND observed_digest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  provider_receipt_id TEXT,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, request_id)
    REFERENCES domain_verification_requests(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE project_drafts (
  organization_id TEXT NOT NULL,
  project_id TEXT PRIMARY KEY,
  raw_facts_json TEXT NOT NULL
    CHECK (json_valid(raw_facts_json) AND json_type(raw_facts_json) = 'object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE fact_sets (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'abracadabra.spark/v1'),
  theme TEXT NOT NULL CHECK (theme IN ('clear', 'warm', 'arcane')),
  business_name TEXT NOT NULL CHECK (length(business_name) BETWEEN 1 AND 80),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 180),
  about TEXT CHECK (about IS NULL OR length(about) <= 800),
  offerings_count INTEGER NOT NULL CHECK (offerings_count BETWEEN 0 AND 6),
  location TEXT CHECK (location IS NULL OR length(location) <= 160),
  hours TEXT CHECK (hours IS NULL OR length(hours) <= 240),
  phone_display TEXT CHECK (phone_display IS NULL OR length(phone_display) <= 32),
  phone_href TEXT,
  email_display TEXT CHECK (email_display IS NULL OR length(email_display) <= 254),
  email_href TEXT,
  website_display TEXT CHECK (website_display IS NULL OR length(website_display) <= 2048),
  website_href TEXT,
  primary_action TEXT NOT NULL
    CHECK (primary_action IN ('none', 'phone', 'email', 'website')),
  content_digest TEXT NOT NULL
    CHECK (
      length(content_digest) = 64
      AND content_digest NOT GLOB '*[^0-9a-f]*'
    ),
  normalized_digest TEXT NOT NULL
    CHECK (
      length(normalized_digest) = 64
      AND normalized_digest NOT GLOB '*[^0-9a-f]*'
    ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, normalized_digest),
  UNIQUE (organization_id, id),
  CHECK (
    about IS NOT NULL
    OR offerings_count > 0
    OR location IS NOT NULL
    OR hours IS NOT NULL
  ),
  CHECK (phone_href IS NOT NULL OR email_href IS NOT NULL OR website_href IS NOT NULL),
  CHECK (primary_action <> 'phone' OR phone_href IS NOT NULL),
  CHECK (primary_action <> 'email' OR email_href IS NOT NULL),
  CHECK (primary_action <> 'website' OR website_href IS NOT NULL),
  CHECK ((phone_display IS NULL) = (phone_href IS NULL)),
  CHECK ((email_display IS NULL) = (email_href IS NULL)),
  CHECK ((website_display IS NULL) = (website_href IS NULL))
) STRICT;

CREATE TABLE fact_offerings (
  organization_id TEXT NOT NULL,
  fact_set_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 6),
  offering TEXT NOT NULL CHECK (length(offering) BETWEEN 1 AND 100),
  PRIMARY KEY (fact_set_id, position),
  FOREIGN KEY (organization_id, fact_set_id)
    REFERENCES fact_sets(organization_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8'
    CHECK (media_type = 'text/html; charset=utf-8'),
  html_bytes BLOB NOT NULL CHECK (length(html_bytes) BETWEEN 64 AND 250000),
  artifact_digest TEXT NOT NULL
    CHECK (
      length(artifact_digest) = 64
      AND artifact_digest NOT GLOB '*[^0-9a-f]*'
    ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 64 AND 250000),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, project_id, artifact_digest),
  UNIQUE (organization_id, id),
  CHECK (byte_count = length(html_bytes))
) STRICT;

CREATE TABLE artifact_replicas (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  object_key TEXT NOT NULL,
  replica_digest TEXT NOT NULL
    CHECK (
      length(replica_digest) = 64
      AND replica_digest NOT GLOB '*[^0-9a-f]*'
    ),
  verified_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (organization_id, artifact_id)
    REFERENCES artifacts(organization_id, id) ON DELETE CASCADE,
  UNIQUE (provider_code, object_key)
) STRICT;

CREATE TABLE site_versions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  fact_set_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  raw_facts_json TEXT NOT NULL
    CHECK (json_valid(raw_facts_json) AND json_type(raw_facts_json) = 'object'),
  compiler_schema TEXT NOT NULL,
  compiler_revision TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, fact_set_id)
    REFERENCES fact_sets(organization_id, id),
  FOREIGN KEY (organization_id, artifact_id)
    REFERENCES artifacts(organization_id, id),
  UNIQUE (project_id, version_number),
  UNIQUE (project_id, fact_set_id, artifact_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER site_versions_offering_count
BEFORE INSERT ON site_versions
WHEN (
  SELECT fact.offerings_count
  FROM fact_sets fact
  WHERE fact.organization_id = NEW.organization_id
    AND fact.id = NEW.fact_set_id
) <> (
  SELECT count(*)
  FROM fact_offerings offering
  WHERE offering.organization_id = NEW.organization_id
    AND offering.fact_set_id = NEW.fact_set_id
)
BEGIN
  SELECT RAISE(ABORT, 'fact offering count mismatch');
END;

CREATE TABLE release_screenings (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('pre_acceptance', 'pre_publication')),
  method TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  artifact_digest TEXT NOT NULL
    CHECK (
      length(artifact_digest) = 64
      AND artifact_digest NOT GLOB '*[^0-9a-f]*'
    ),
  findings_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(findings_json) AND json_type(findings_json) = 'array'),
  checker_revision TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER release_screenings_exact_artifact
BEFORE INSERT ON release_screenings
WHEN NOT EXISTS (
  SELECT 1
  FROM site_versions version
  JOIN artifacts artifact
    ON artifact.organization_id = version.organization_id
   AND artifact.id = version.artifact_id
  WHERE version.organization_id = NEW.organization_id
    AND version.project_id = NEW.project_id
    AND version.id = NEW.version_id
    AND artifact.artifact_digest = NEW.artifact_digest
)
BEGIN
  SELECT RAISE(ABORT, 'screening does not match exact version artifact');
END;

CREATE TABLE version_attestations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  statement_version TEXT NOT NULL,
  attested_at TEXT NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  UNIQUE (version_id, user_id, request_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE version_state_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('draft', 'ready', 'accepted_release', 'rejected')),
  screening_id TEXT,
  attestation_id TEXT,
  actor_user_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  FOREIGN KEY (organization_id, screening_id)
    REFERENCES release_screenings(organization_id, id),
  FOREIGN KEY (organization_id, attestation_id)
    REFERENCES version_attestations(organization_id, id),
  UNIQUE (organization_id, id),
  CHECK (
    state <> 'accepted_release'
    OR (screening_id IS NOT NULL AND attestation_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE version_state_projection (
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version_id TEXT PRIMARY KEY,
  state TEXT NOT NULL
    CHECK (state IN ('draft', 'ready', 'accepted_release', 'rejected')),
  last_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, version_id)
    REFERENCES site_versions(organization_id, id),
  FOREIGN KEY (organization_id, last_event_id)
    REFERENCES version_state_events(organization_id, id)
) STRICT;

CREATE TRIGGER accepted_version_requires_exact_proof
BEFORE INSERT ON version_state_events
WHEN NEW.state = 'accepted_release'
  AND NOT (
    EXISTS (
      SELECT 1
      FROM version_state_projection current
      WHERE current.organization_id = NEW.organization_id
        AND current.project_id = NEW.project_id
        AND current.version_id = NEW.version_id
        AND current.state = 'ready'
    )
    AND EXISTS (
      SELECT 1
      FROM release_screenings screening
      WHERE screening.organization_id = NEW.organization_id
        AND screening.project_id = NEW.project_id
        AND screening.version_id = NEW.version_id
        AND screening.id = NEW.screening_id
        AND screening.stage = 'pre_acceptance'
        AND screening.passed = 1
    )
    AND EXISTS (
      SELECT 1
      FROM version_attestations attestation
      WHERE attestation.organization_id = NEW.organization_id
        AND attestation.project_id = NEW.project_id
        AND attestation.version_id = NEW.version_id
        AND attestation.id = NEW.attestation_id
        AND attestation.user_id = NEW.actor_user_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'accepted release requires exact screening and user attestation');
END;

CREATE TRIGGER safety_events_immutable
BEFORE UPDATE ON safety_events
BEGIN
  SELECT RAISE(ABORT, 'safety_events is immutable');
END;

CREATE TRIGGER domain_verification_attempts_immutable
BEFORE UPDATE ON domain_verification_attempts
BEGIN
  SELECT RAISE(ABORT, 'domain_verification_attempts is immutable');
END;

CREATE TRIGGER fact_sets_immutable
BEFORE UPDATE ON fact_sets
BEGIN
  SELECT RAISE(ABORT, 'fact_sets is immutable');
END;

CREATE TRIGGER fact_offerings_immutable
BEFORE UPDATE ON fact_offerings
BEGIN
  SELECT RAISE(ABORT, 'fact_offerings is immutable');
END;

CREATE TRIGGER artifacts_immutable
BEFORE UPDATE ON artifacts
BEGIN
  SELECT RAISE(ABORT, 'artifacts is immutable');
END;

CREATE TRIGGER site_versions_immutable
BEFORE UPDATE ON site_versions
BEGIN
  SELECT RAISE(ABORT, 'site_versions is immutable');
END;

CREATE TRIGGER release_screenings_immutable
BEFORE UPDATE ON release_screenings
BEGIN
  SELECT RAISE(ABORT, 'release_screenings is immutable');
END;

CREATE TRIGGER version_attestations_immutable
BEFORE UPDATE ON version_attestations
BEGIN
  SELECT RAISE(ABORT, 'version_attestations is immutable');
END;

CREATE TRIGGER version_state_events_immutable
BEFORE UPDATE ON version_state_events
BEGIN
  SELECT RAISE(ABORT, 'version_state_events is immutable');
END;
