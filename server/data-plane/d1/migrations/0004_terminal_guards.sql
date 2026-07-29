PRAGMA foreign_keys = ON;

CREATE TABLE deletion_object_queue (
  deletion_request_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('artifact_replica', 'export')),
  state TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'running', 'succeeded', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (deletion_request_id, object_key),
  FOREIGN KEY (organization_id, deletion_request_id)
    REFERENCES deletion_requests(organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id)
) STRICT;

CREATE INDEX deletion_object_queue_ready
  ON deletion_object_queue(state, deletion_request_id, object_key)
  WHERE state IN ('scheduled', 'failed');

CREATE TRIGGER deletion_tombstone_requires_sealed_purge
BEFORE INSERT ON project_deletion_tombstones
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM projects project
    JOIN deletion_requests request
      ON request.organization_id = project.organization_id
     AND request.project_id = project.id
    WHERE project.organization_id = NEW.organization_id
      AND project.id = NEW.project_id
      AND project.lifecycle = 'deleting'
      AND project.name IS NULL
      AND request.id = NEW.deletion_request_id
      AND request.state = 'purging'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM deletion_object_queue queued
    WHERE queued.organization_id = NEW.organization_id
      AND queued.project_id = NEW.project_id
      AND queued.state <> 'succeeded'
  )
  AND NOT EXISTS (
    SELECT 1 FROM site_versions
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM artifacts
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM fact_sets
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM project_drafts
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM support_tickets
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM domain_verification_requests
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
    UNION ALL
    SELECT 1 FROM project_access_credentials
      WHERE organization_id = NEW.organization_id AND project_id = NEW.project_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'terminal purge is not sealed and empty');
END;

CREATE TRIGGER deletion_completion_requires_tombstone
BEFORE UPDATE OF state ON deletion_requests
WHEN NEW.state = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM project_deletion_tombstones tombstone
    WHERE tombstone.organization_id = NEW.organization_id
      AND tombstone.project_id = NEW.project_id
      AND tombstone.deletion_request_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'deletion cannot complete without tombstone');
END;

CREATE TRIGGER artifact_delete_requires_purge
BEFORE DELETE ON artifacts
WHEN NOT EXISTS (
  SELECT 1 FROM deletion_requests request
  WHERE request.organization_id = OLD.organization_id
    AND request.project_id = OLD.project_id
    AND request.state = 'purging'
)
BEGIN
  SELECT RAISE(ABORT, 'artifact deletion requires terminal purge');
END;

CREATE TRIGGER version_delete_requires_purge
BEFORE DELETE ON site_versions
WHEN NOT EXISTS (
  SELECT 1 FROM deletion_requests request
  WHERE request.organization_id = OLD.organization_id
    AND request.project_id = OLD.project_id
    AND request.state = 'purging'
)
BEGIN
  SELECT RAISE(ABORT, 'version deletion requires terminal purge');
END;

CREATE TRIGGER fact_set_delete_requires_purge
BEFORE DELETE ON fact_sets
WHEN NOT EXISTS (
  SELECT 1 FROM deletion_requests request
  WHERE request.organization_id = OLD.organization_id
    AND request.project_id = OLD.project_id
    AND request.state = 'purging'
)
BEGIN
  SELECT RAISE(ABORT, 'fact deletion requires terminal purge');
END;

CREATE TRIGGER release_delete_requires_purge
BEFORE DELETE ON releases
WHEN NOT EXISTS (
  SELECT 1 FROM deletion_requests request
  WHERE request.organization_id = OLD.organization_id
    AND request.project_id = OLD.project_id
    AND request.state = 'purging'
)
BEGIN
  SELECT RAISE(ABORT, 'release deletion requires terminal purge');
END;

CREATE TRIGGER support_ticket_delete_requires_purge
BEFORE DELETE ON support_tickets
WHEN NOT EXISTS (
  SELECT 1 FROM deletion_requests request
  WHERE request.organization_id = OLD.organization_id
    AND request.project_id = OLD.project_id
    AND request.state = 'purging'
)
BEGIN
  SELECT RAISE(ABORT, 'support deletion requires terminal purge');
END;

CREATE VIEW current_site_resolution AS
SELECT
  project.organization_id,
  project.id AS project_id,
  address.serving_hostname AS hostname,
  access.visibility,
  release.id AS release_id,
  release.version_id,
  release.artifact_id,
  release.artifact_digest,
  artifact.html_bytes,
  credential.id AS credential_id,
  credential.credential_fingerprint
FROM projects project
JOIN project_serving_projection serving
  ON serving.organization_id = project.organization_id
 AND serving.project_id = project.id
 AND serving.state = 'live'
JOIN releases release
  ON release.organization_id = serving.organization_id
 AND release.id = serving.current_release_id
JOIN artifacts artifact
  ON artifact.organization_id = release.organization_id
 AND artifact.id = release.artifact_id
 AND artifact.artifact_digest = release.artifact_digest
JOIN project_address_projection address_projection
  ON address_projection.organization_id = project.organization_id
 AND address_projection.project_id = project.id
JOIN project_addresses address
  ON address.organization_id = address_projection.organization_id
 AND address.id = address_projection.current_address_id
 AND address.state = 'configured'
 AND address.serving_hostname = release.hostname
JOIN project_access_projection access
  ON access.organization_id = project.organization_id
 AND access.project_id = project.id
LEFT JOIN project_access_credentials credential
  ON credential.organization_id = access.organization_id
 AND credential.id = access.current_credential_id
 AND credential.revoked_at IS NULL
JOIN project_safety_projection safety
  ON safety.organization_id = project.organization_id
 AND safety.project_id = project.id
 AND safety.state = 'clear'
JOIN stripe_subscriptions subscription
  ON subscription.organization_id = project.organization_id
 AND subscription.project_id = project.id
 AND subscription.status IN ('active', 'grace')
WHERE project.lifecycle = 'active';
