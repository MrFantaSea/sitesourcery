-- Site Sourcery provider-neutral domain orchestration.
-- Apply only through a reviewed adapter/migration runner.
-- The order update, audit append, outbox append, and command completion MUST
-- commit in one database transaction. This file performs no provider call.

CREATE TABLE domain_orders (
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  domain_name TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL,
  order_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, order_id),
  UNIQUE (tenant_id, domain_name)
);

CREATE INDEX domain_orders_customer_idx
  ON domain_orders (tenant_id, customer_id, updated_at);

CREATE TABLE domain_commands (
  tenant_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id, command_id)
);

CREATE TABLE domain_audit (
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, order_id, order_version),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES domain_orders (tenant_id, order_id)
);

CREATE TABLE domain_outbox (
  tenant_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  PRIMARY KEY (tenant_id, outbox_id),
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES domain_orders (tenant_id, order_id)
);

CREATE INDEX domain_outbox_pending_idx
  ON domain_outbox (tenant_id, published_at, occurred_at);

-- Full registrant PII, payment methods, provider API credentials, raw EPP/auth
-- codes, and one-time delivery tokens are deliberately absent. Store them only
-- behind dedicated encrypted contact/payment/secret providers.
