BEGIN;

CREATE TABLE abracadabra_quotes (
  tenant_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  state TEXT NOT NULL CHECK (state IN ('quoted', 'checkout_dispatching', 'checkout_ready')),
  catalog_version TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  disclosure_digest TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  document_json TEXT NOT NULL,
  checkout_json TEXT,
  PRIMARY KEY (tenant_id, quote_id)
);

CREATE TABLE abracadabra_commerce_commands (
  tenant_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (tenant_id, command_id)
);

CREATE TABLE abracadabra_commerce_audit (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  quote_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  UNIQUE (tenant_id, quote_id, quote_version),
  FOREIGN KEY (tenant_id, quote_id)
    REFERENCES abracadabra_quotes (tenant_id, quote_id)
);

CREATE TABLE abracadabra_commerce_outbox (
  outbox_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (tenant_id, quote_id)
    REFERENCES abracadabra_quotes (tenant_id, quote_id)
);

CREATE INDEX abracadabra_quotes_customer
  ON abracadabra_quotes (tenant_id, customer_id, project_id, issued_at);
CREATE INDEX abracadabra_commerce_outbox_unpublished
  ON abracadabra_commerce_outbox (published_at, occurred_at);

COMMIT;
