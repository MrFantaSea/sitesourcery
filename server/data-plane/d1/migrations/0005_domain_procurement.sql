PRAGMA foreign_keys = ON;

CREATE TABLE domain_procurement_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  purchasing_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (purchasing_enabled IN (0, 1)),
  live_mode INTEGER NOT NULL DEFAULT 0 CHECK (live_mode IN (0, 1)),
  active_provider_code TEXT CHECK (
    active_provider_code IS NULL
    OR length(active_provider_code) BETWEEN 2 AND 80
  ),
  agent_legal_document_id TEXT REFERENCES legal_documents(id),
  renewal_legal_document_id TEXT REFERENCES legal_documents(id),
  enabled_at TEXT,
  enabled_by_user_id TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL,
  CHECK (
    purchasing_enabled = 0
    OR (
      active_provider_code IS NOT NULL
      AND agent_legal_document_id IS NOT NULL
      AND renewal_legal_document_id IS NOT NULL
      AND enabled_at IS NOT NULL
      AND enabled_by_user_id IS NOT NULL
    )
  )
) STRICT;

INSERT INTO domain_procurement_control (
  singleton, purchasing_enabled, live_mode, updated_at
) VALUES (
  1, 0, 0, '2026-07-28T00:00:00.000Z'
);

CREATE TRIGGER domain_procurement_control_exact_legal_kinds
BEFORE UPDATE OF purchasing_enabled, agent_legal_document_id,
  renewal_legal_document_id
ON domain_procurement_control
WHEN NEW.purchasing_enabled = 1
  AND NOT (
    EXISTS (
      SELECT 1
      FROM legal_documents document
      WHERE document.id = NEW.agent_legal_document_id
        AND document.kind = 'domain_agent'
        AND document.retired_at IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM legal_documents document
      WHERE document.id = NEW.renewal_legal_document_id
        AND document.kind = 'domain_renewal'
        AND document.retired_at IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'domain procurement requires active exact legal documents');
END;

CREATE TABLE domain_quotes (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  provider_quote_ref TEXT NOT NULL,
  quote_kind TEXT NOT NULL CHECK (quote_kind IN ('registration', 'renewal')),
  domain_name TEXT NOT NULL
    CHECK (
      domain_name = lower(domain_name)
      AND domain_name NOT LIKE '%.'
      AND instr(domain_name, '.') > 1
      AND length(domain_name) <= 253
    ),
  currency TEXT NOT NULL
    CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  customer_price_minor INTEGER NOT NULL CHECK (customer_price_minor >= 0),
  registrar_cost_minor INTEGER NOT NULL CHECK (registrar_cost_minor >= 0),
  renewal_price_minor INTEGER NOT NULL CHECK (renewal_price_minor >= 0),
  term_years INTEGER NOT NULL CHECK (term_years BETWEEN 1 AND 10),
  renewal_disclosure TEXT NOT NULL CHECK (length(renewal_disclosure) >= 20),
  renewal_disclosure_digest TEXT NOT NULL
    CHECK (
      length(renewal_disclosure_digest) = 64
      AND renewal_disclosure_digest NOT GLOB '*[^0-9a-f]*'
    ),
  quote_digest TEXT NOT NULL
    CHECK (
      length(quote_digest) = 64
      AND quote_digest NOT GLOB '*[^0-9a-f]*'
    ),
  provider_receipt_id TEXT NOT NULL,
  quoted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status = 'open'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (provider_code, provider_quote_ref),
  UNIQUE (organization_id, id),
  CHECK (expires_at > quoted_at)
) STRICT;

CREATE TRIGGER domain_quote_provider_receipt
BEFORE INSERT ON domain_quotes
WHEN NOT EXISTS (
  SELECT 1
  FROM provider_receipts receipt
  WHERE receipt.organization_id = NEW.organization_id
    AND receipt.project_id = NEW.project_id
    AND receipt.id = NEW.provider_receipt_id
    AND receipt.provider_code = NEW.provider_code
    AND receipt.receipt_kind = 'domain_quote'
    AND receipt.external_object_ref = NEW.provider_quote_ref
    AND json_extract(receipt.facts_json, '$.domainName') = NEW.domain_name
    AND json_extract(receipt.facts_json, '$.currency') = NEW.currency
    AND json_extract(receipt.facts_json, '$.customerPriceMinor') = NEW.customer_price_minor
    AND json_extract(receipt.facts_json, '$.registrarCostMinor') = NEW.registrar_cost_minor
    AND json_extract(receipt.facts_json, '$.renewalPriceMinor') = NEW.renewal_price_minor
    AND json_extract(receipt.facts_json, '$.termYears') = NEW.term_years
    AND json_extract(receipt.facts_json, '$.renewalDisclosureDigest')
      = NEW.renewal_disclosure_digest
    AND json_extract(receipt.facts_json, '$.quoteDigest') = NEW.quote_digest
    AND json_extract(receipt.facts_json, '$.expiresAt') = NEW.expires_at
)
BEGIN
  SELECT RAISE(ABORT, 'domain quote must match exact provider receipt');
END;

CREATE TABLE domain_registrant_snapshots (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  schema_version TEXT NOT NULL,
  encryption_algorithm TEXT NOT NULL CHECK (length(encryption_algorithm) >= 5),
  encryption_key_version TEXT NOT NULL CHECK (length(encryption_key_version) >= 3),
  contact_ciphertext BLOB NOT NULL,
  contact_digest TEXT NOT NULL
    CHECK (
      length(contact_digest) = 64
      AND contact_digest NOT GLOB '*[^0-9a-f]*'
    ),
  country_code TEXT NOT NULL
    CHECK (length(country_code) = 2 AND country_code NOT GLOB '*[^A-Z]*'),
  customer_is_registrant INTEGER NOT NULL DEFAULT 1
    CHECK (customer_is_registrant = 1),
  captured_at TEXT NOT NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id)
) STRICT;

CREATE TABLE domain_agent_consents (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  quote_id TEXT NOT NULL,
  registrant_snapshot_id TEXT NOT NULL,
  legal_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  term_acceptance_id TEXT NOT NULL,
  agent_role TEXT NOT NULL CHECK (agent_role = 'authorized_registration_agent'),
  customer_remains_registrant INTEGER NOT NULL CHECK (customer_remains_registrant = 1),
  authorization_statement_digest TEXT NOT NULL
    CHECK (
      length(authorization_statement_digest) = 64
      AND authorization_statement_digest NOT GLOB '*[^0-9a-f]*'
    ),
  irreversible_disclosure_digest TEXT NOT NULL
    CHECK (
      length(irreversible_disclosure_digest) = 64
      AND irreversible_disclosure_digest NOT GLOB '*[^0-9a-f]*'
    ),
  ip_address TEXT,
  user_agent_digest TEXT,
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  consented_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, quote_id)
    REFERENCES domain_quotes(organization_id, id),
  FOREIGN KEY (organization_id, registrant_snapshot_id)
    REFERENCES domain_registrant_snapshots(organization_id, id),
  FOREIGN KEY (organization_id, term_acceptance_id)
    REFERENCES term_acceptances(organization_id, id),
  UNIQUE (quote_id, user_id, request_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_agent_consent_exact_evidence
BEFORE INSERT ON domain_agent_consents
WHEN NOT EXISTS (
  SELECT 1
  FROM legal_documents document
  JOIN term_acceptances acceptance
    ON acceptance.document_id = document.id
  JOIN domain_quotes quote
    ON quote.organization_id = acceptance.organization_id
   AND quote.project_id = acceptance.project_id
  JOIN domain_registrant_snapshots registrant
    ON registrant.organization_id = quote.organization_id
   AND registrant.project_id = quote.project_id
  WHERE document.id = NEW.legal_document_id
    AND document.kind = 'domain_agent'
    AND acceptance.organization_id = NEW.organization_id
    AND acceptance.project_id = NEW.project_id
    AND acceptance.id = NEW.term_acceptance_id
    AND acceptance.user_id = NEW.user_id
    AND quote.id = NEW.quote_id
    AND registrant.id = NEW.registrant_snapshot_id
    AND registrant.user_id = NEW.user_id
    AND registrant.customer_is_registrant = 1
)
BEGIN
  SELECT RAISE(ABORT, 'domain agent consent evidence does not match');
END;

CREATE TABLE domain_payment_allocations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  stripe_provider_receipt_id TEXT NOT NULL,
  stripe_payment_reference TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  state TEXT NOT NULL CHECK (state = 'captured'),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, quote_id)
    REFERENCES domain_quotes(organization_id, id),
  FOREIGN KEY (organization_id, stripe_provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (stripe_payment_reference),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_payment_is_stripe_not_registrar
BEFORE INSERT ON domain_payment_allocations
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_quotes quote
  JOIN provider_receipts receipt
    ON receipt.organization_id = quote.organization_id
   AND receipt.project_id = quote.project_id
  JOIN domain_procurement_control control
    ON control.singleton = 1
  WHERE quote.organization_id = NEW.organization_id
    AND quote.project_id = NEW.project_id
    AND quote.id = NEW.quote_id
    AND receipt.id = NEW.stripe_provider_receipt_id
    AND receipt.provider_code = 'stripe'
    AND receipt.receipt_kind = 'domain_payment_captured'
    AND receipt.external_object_ref = NEW.stripe_payment_reference
    AND control.purchasing_enabled = 1
    AND control.active_provider_code = quote.provider_code
    AND quote.currency = NEW.currency
    AND quote.customer_price_minor = NEW.amount_minor
    AND json_extract(receipt.facts_json, '$.quoteId') = NEW.quote_id
    AND json_extract(receipt.facts_json, '$.currency') = NEW.currency
    AND json_extract(receipt.facts_json, '$.amountMinor') = NEW.amount_minor
)
BEGIN
  SELECT RAISE(ABORT, 'domain payment must be separate exact Stripe evidence');
END;

CREATE TABLE domain_registration_intents (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  quote_id TEXT NOT NULL,
  registrant_snapshot_id TEXT NOT NULL,
  agent_consent_id TEXT NOT NULL,
  payment_allocation_id TEXT NOT NULL,
  domain_name TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (
      state IN (
        'awaiting_confirmation',
        'confirmed',
        'submitted',
        'processing',
        'registered',
        'failed',
        'manual_review',
        'cancelled'
      )
    ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  irreversible_confirmed_at TEXT,
  confirmed_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  failure_code TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, quote_id)
    REFERENCES domain_quotes(organization_id, id),
  FOREIGN KEY (organization_id, registrant_snapshot_id)
    REFERENCES domain_registrant_snapshots(organization_id, id),
  FOREIGN KEY (organization_id, agent_consent_id)
    REFERENCES domain_agent_consents(organization_id, id),
  FOREIGN KEY (organization_id, payment_allocation_id)
    REFERENCES domain_payment_allocations(organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (quote_id),
  UNIQUE (agent_consent_id),
  UNIQUE (payment_allocation_id),
  UNIQUE (organization_id, id),
  CHECK (
    state IN ('awaiting_confirmation', 'cancelled')
    OR (
      irreversible_confirmed_at IS NOT NULL
      AND confirmed_by_user_id IS NOT NULL
    )
  )
) STRICT;

CREATE TRIGGER domain_registration_intent_exact_inputs
BEFORE INSERT ON domain_registration_intents
WHEN (SELECT purchasing_enabled FROM domain_procurement_control WHERE singleton = 1) <> 1
  OR NOT EXISTS (
  SELECT 1
  FROM projects project
  JOIN organization_memberships membership
    ON membership.organization_id = project.organization_id
  JOIN domain_quotes quote
    ON quote.organization_id = project.organization_id
   AND quote.project_id = project.id
  JOIN domain_registrant_snapshots registrant
    ON registrant.organization_id = project.organization_id
   AND registrant.project_id = project.id
  JOIN domain_agent_consents consent
    ON consent.organization_id = project.organization_id
   AND consent.project_id = project.id
  JOIN domain_payment_allocations payment
    ON payment.organization_id = project.organization_id
   AND payment.project_id = project.id
  WHERE project.organization_id = NEW.organization_id
    AND project.id = NEW.project_id
    AND project.lifecycle = 'active'
    AND quote.provider_code = (
      SELECT active_provider_code
      FROM domain_procurement_control
      WHERE singleton = 1
    )
    AND membership.user_id = NEW.requested_by_user_id
    AND membership.state = 'active'
    AND membership.role IN ('owner', 'admin', 'billing')
    AND quote.id = NEW.quote_id
    AND quote.quote_kind = 'registration'
    AND quote.status = 'open'
    AND quote.expires_at > NEW.created_at
    AND quote.domain_name = NEW.domain_name
    AND quote.provider_code = NEW.provider_code
    AND registrant.id = NEW.registrant_snapshot_id
    AND registrant.user_id = NEW.requested_by_user_id
    AND registrant.customer_is_registrant = 1
    AND consent.id = NEW.agent_consent_id
    AND consent.user_id = NEW.requested_by_user_id
    AND consent.quote_id = NEW.quote_id
    AND consent.registrant_snapshot_id = NEW.registrant_snapshot_id
    AND consent.customer_remains_registrant = 1
    AND payment.id = NEW.payment_allocation_id
    AND payment.quote_id = NEW.quote_id
    AND payment.state = 'captured'
)
BEGIN
  SELECT RAISE(ABORT, 'registration intent prerequisites do not match');
END;

CREATE TABLE domain_irreversible_confirmations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_intent_id TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL REFERENCES users(id),
  confirmation_statement_version TEXT NOT NULL,
  confirmation_evidence_digest TEXT NOT NULL
    CHECK (
      length(confirmation_evidence_digest) = 64
      AND confirmation_evidence_digest NOT GLOB '*[^0-9a-f]*'
    ),
  quote_digest TEXT NOT NULL
    CHECK (
      length(quote_digest) = 64
      AND quote_digest NOT GLOB '*[^0-9a-f]*'
    ),
  confirmed_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, registration_intent_id)
    REFERENCES domain_registration_intents(organization_id, id),
  UNIQUE (registration_intent_id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_irreversible_confirmation_barrier
BEFORE INSERT ON domain_irreversible_confirmations
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_registration_intents intent
  JOIN domain_quotes quote
    ON quote.organization_id = intent.organization_id
   AND quote.id = intent.quote_id
  JOIN domain_payment_allocations payment
    ON payment.organization_id = intent.organization_id
   AND payment.id = intent.payment_allocation_id
  JOIN domain_procurement_control control
    ON control.singleton = 1
  WHERE intent.organization_id = NEW.organization_id
    AND intent.project_id = NEW.project_id
    AND intent.id = NEW.registration_intent_id
    AND intent.requested_by_user_id = NEW.confirmed_by_user_id
    AND intent.state = 'awaiting_confirmation'
    AND quote.status = 'open'
    AND quote.expires_at > NEW.confirmed_at
    AND control.purchasing_enabled = 1
    AND control.active_provider_code = intent.provider_code
    AND payment.state = 'captured'
    AND NEW.quote_digest = quote.quote_digest
)
BEGIN
  SELECT RAISE(ABORT, 'irreversible confirmation barrier is not satisfied');
END;

CREATE TRIGGER domain_intent_confirmed_state_barrier
BEFORE UPDATE OF state ON domain_registration_intents
WHEN NEW.state IN ('confirmed', 'submitted', 'processing', 'registered')
  AND NOT EXISTS (
    SELECT 1
    FROM domain_irreversible_confirmations confirmation
    WHERE confirmation.organization_id = NEW.organization_id
      AND confirmation.project_id = NEW.project_id
      AND confirmation.registration_intent_id = NEW.id
      AND confirmation.confirmed_by_user_id = NEW.confirmed_by_user_id
      AND confirmation.confirmed_at = NEW.irreversible_confirmed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'registration intent cannot cross irreversible barrier');
END;

CREATE TRIGGER domain_intent_evidence_frozen
BEFORE UPDATE OF quote_id, registrant_snapshot_id, agent_consent_id,
  payment_allocation_id, domain_name, provider_code
ON domain_registration_intents
WHEN OLD.irreversible_confirmed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'confirmed registration evidence is immutable');
END;

CREATE TABLE domain_provider_operations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL
    CHECK (subject_kind IN ('registration', 'renewal', 'transfer_out', 'dns')),
  subject_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL
    CHECK (
      operation_kind IN (
        'availability_check',
        'register',
        'configure_dns',
        'renew',
        'unlock',
        'request_auth_code',
        'transfer_out'
      )
    ),
  provider_code TEXT NOT NULL,
  external_operation_ref TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  state TEXT NOT NULL
    CHECK (
      state IN (
        'queued',
        'submitted',
        'processing',
        'succeeded',
        'failed',
        'manual_review'
      )
    ),
  provider_receipt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  failure_detail_ciphertext BLOB,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (provider_code, external_operation_ref),
  UNIQUE (subject_kind, subject_id, operation_kind, idempotency_key),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_register_operation_requires_confirmation
BEFORE INSERT ON domain_provider_operations
WHEN NEW.subject_kind = 'registration'
  AND NEW.operation_kind = 'register'
  AND NOT EXISTS (
    SELECT 1
    FROM domain_registration_intents intent
    JOIN domain_irreversible_confirmations confirmation
      ON confirmation.organization_id = intent.organization_id
     AND confirmation.registration_intent_id = intent.id
    JOIN domain_procurement_control control
      ON control.singleton = 1
    WHERE intent.organization_id = NEW.organization_id
      AND intent.project_id = NEW.project_id
      AND intent.id = NEW.subject_id
      AND intent.provider_code = NEW.provider_code
      AND intent.state = 'confirmed'
      AND control.purchasing_enabled = 1
      AND control.active_provider_code = NEW.provider_code
  )
BEGIN
  SELECT RAISE(ABORT, 'registration provider operation requires irreversible confirmation');
END;

CREATE TABLE domain_provider_operation_events (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (
      state IN (
        'queued',
        'submitted',
        'processing',
        'succeeded',
        'failed',
        'manual_review'
      )
    ),
  provider_receipt_id TEXT,
  failure_code TEXT,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  FOREIGN KEY (organization_id, provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_provider_operation_event_matches_projection
BEFORE INSERT ON domain_provider_operation_events
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_provider_operations operation
  WHERE operation.organization_id = NEW.organization_id
    AND operation.project_id = NEW.project_id
    AND operation.id = NEW.operation_id
    AND operation.state = NEW.state
    AND (
      (NEW.provider_receipt_id IS NULL AND operation.provider_receipt_id IS NULL)
      OR NEW.provider_receipt_id = operation.provider_receipt_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'domain operation event must match current projection');
END;

CREATE TRIGGER domain_provider_operation_state_transition
BEFORE UPDATE OF state ON domain_provider_operations
WHEN NOT (
  OLD.state = NEW.state
  OR (OLD.state = 'queued' AND NEW.state IN ('submitted', 'processing', 'succeeded', 'failed', 'manual_review'))
  OR (OLD.state = 'submitted' AND NEW.state IN ('processing', 'succeeded', 'failed', 'manual_review'))
  OR (OLD.state = 'processing' AND NEW.state IN ('succeeded', 'failed', 'manual_review'))
  OR (OLD.state = 'failed' AND NEW.state IN ('queued', 'manual_review'))
  OR (OLD.state = 'manual_review' AND NEW.state IN ('queued', 'failed'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid domain provider operation transition');
END;

CREATE TRIGGER domain_provider_operation_success_receipt
BEFORE UPDATE OF state, provider_receipt_id ON domain_provider_operations
WHEN NEW.state = 'succeeded'
  AND NOT EXISTS (
    SELECT 1
    FROM provider_receipts receipt
    WHERE receipt.organization_id = NEW.organization_id
      AND receipt.project_id = NEW.project_id
      AND receipt.id = NEW.provider_receipt_id
      AND receipt.provider_code = NEW.provider_code
      AND receipt.receipt_kind = 'domain_operation_result'
      AND json_extract(receipt.facts_json, '$.operationId') = NEW.id
      AND json_extract(receipt.facts_json, '$.state') = 'succeeded'
  )
BEGIN
  SELECT RAISE(ABORT, 'successful domain operation requires exact provider receipt');
END;

CREATE TRIGGER domain_provider_operation_receipt_scope
BEFORE UPDATE OF provider_receipt_id ON domain_provider_operations
WHEN NEW.provider_receipt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM provider_receipts receipt
    WHERE receipt.organization_id = NEW.organization_id
      AND receipt.project_id = NEW.project_id
      AND receipt.id = NEW.provider_receipt_id
      AND receipt.provider_code = NEW.provider_code
  )
BEGIN
  SELECT RAISE(ABORT, 'domain provider receipt is outside operation scope');
END;

CREATE TABLE domain_registrar_debits (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  registrar_provider_receipt_id TEXT NOT NULL,
  registrar_debit_reference TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  debited_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  FOREIGN KEY (organization_id, registrar_provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (registrar_debit_reference),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_registrar_debit_not_stripe
BEFORE INSERT ON domain_registrar_debits
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_provider_operations operation
  JOIN provider_receipts receipt
    ON receipt.organization_id = operation.organization_id
   AND receipt.project_id = operation.project_id
  WHERE operation.organization_id = NEW.organization_id
    AND operation.project_id = NEW.project_id
    AND operation.id = NEW.operation_id
    AND operation.provider_code <> 'stripe'
    AND receipt.id = NEW.registrar_provider_receipt_id
    AND receipt.provider_code = operation.provider_code
    AND receipt.provider_code <> 'stripe'
    AND receipt.receipt_kind = 'registrar_debit'
    AND receipt.external_object_ref = NEW.registrar_debit_reference
    AND json_extract(receipt.facts_json, '$.operationId') = NEW.operation_id
    AND json_extract(receipt.facts_json, '$.currency') = NEW.currency
    AND json_extract(receipt.facts_json, '$.amountMinor') = NEW.amount_minor
)
BEGIN
  SELECT RAISE(ABORT, 'registrar debit must be separate non-Stripe evidence');
END;

CREATE TABLE domain_registrations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_intent_id TEXT NOT NULL,
  provider_operation_id TEXT NOT NULL,
  registrant_snapshot_id TEXT NOT NULL,
  provider_code TEXT NOT NULL,
  provider_domain_ref TEXT NOT NULL,
  domain_name TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (
      state IN (
        'active',
        'renewal_due',
        'expired',
        'transfer_pending',
        'transferred_out',
        'failed',
        'manual_review'
      )
    ),
  customer_is_registrant INTEGER NOT NULL CHECK (customer_is_registrant = 1),
  site_sourcery_role TEXT NOT NULL CHECK (site_sourcery_role = 'authorized_agent'),
  auto_renew INTEGER NOT NULL DEFAULT 0 CHECK (auto_renew IN (0, 1)),
  registered_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  current_provider_receipt_id TEXT NOT NULL,
  renewal_disclosure_digest TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, registration_intent_id)
    REFERENCES domain_registration_intents(organization_id, id),
  FOREIGN KEY (organization_id, provider_operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  FOREIGN KEY (organization_id, registrant_snapshot_id)
    REFERENCES domain_registrant_snapshots(organization_id, id),
  FOREIGN KEY (organization_id, current_provider_receipt_id)
    REFERENCES provider_receipts(organization_id, id),
  UNIQUE (domain_name),
  UNIQUE (provider_code, provider_domain_ref),
  UNIQUE (registration_intent_id),
  UNIQUE (organization_id, id),
  CHECK (
    domain_name = lower(domain_name)
    AND domain_name NOT LIKE '%.'
    AND instr(domain_name, '.') > 1
    AND length(domain_name) <= 253
  ),
  CHECK (expires_at > registered_at),
  CHECK (
    length(renewal_disclosure_digest) = 64
    AND renewal_disclosure_digest NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

CREATE TRIGGER domain_registration_exact_provider_result
BEFORE INSERT ON domain_registrations
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_registration_intents intent
  JOIN domain_quotes quote
    ON quote.organization_id = intent.organization_id
   AND quote.id = intent.quote_id
  JOIN domain_provider_operations operation
    ON operation.organization_id = intent.organization_id
   AND operation.project_id = intent.project_id
   AND operation.subject_kind = 'registration'
   AND operation.subject_id = intent.id
   AND operation.operation_kind = 'register'
  JOIN provider_receipts receipt
    ON receipt.organization_id = operation.organization_id
   AND receipt.project_id = operation.project_id
   AND receipt.id = operation.provider_receipt_id
  WHERE intent.organization_id = NEW.organization_id
    AND intent.project_id = NEW.project_id
    AND intent.id = NEW.registration_intent_id
    AND intent.registrant_snapshot_id = NEW.registrant_snapshot_id
    AND intent.domain_name = NEW.domain_name
    AND intent.provider_code = NEW.provider_code
    AND intent.irreversible_confirmed_at IS NOT NULL
    AND operation.id = NEW.provider_operation_id
    AND operation.state = 'succeeded'
    AND receipt.id = NEW.current_provider_receipt_id
    AND receipt.provider_code = NEW.provider_code
    AND receipt.receipt_kind = 'domain_operation_result'
    AND json_extract(receipt.facts_json, '$.operationId') = operation.id
    AND json_extract(receipt.facts_json, '$.state') = 'succeeded'
    AND json_extract(receipt.facts_json, '$.domainName') = NEW.domain_name
    AND json_extract(receipt.facts_json, '$.providerDomainRef') = NEW.provider_domain_ref
    AND json_extract(receipt.facts_json, '$.registeredAt') = NEW.registered_at
    AND json_extract(receipt.facts_json, '$.expiresAt') = NEW.expires_at
    AND NEW.customer_is_registrant = 1
    AND NEW.site_sourcery_role = 'authorized_agent'
    AND NEW.renewal_disclosure_digest = quote.renewal_disclosure_digest
)
BEGIN
  SELECT RAISE(ABORT, 'domain registration must match exact successful provider result');
END;

CREATE TRIGGER domain_intent_submitted_operation_barrier
BEFORE UPDATE OF state ON domain_registration_intents
WHEN NEW.state IN ('submitted', 'processing')
  AND NOT EXISTS (
    SELECT 1
    FROM domain_provider_operations operation
    WHERE operation.organization_id = NEW.organization_id
      AND operation.project_id = NEW.project_id
      AND operation.subject_kind = 'registration'
      AND operation.subject_id = NEW.id
      AND operation.operation_kind = 'register'
      AND operation.provider_code = NEW.provider_code
      AND operation.state IN ('queued', 'submitted', 'processing')
  )
BEGIN
  SELECT RAISE(ABORT, 'submitted registration intent requires provider operation');
END;

CREATE TRIGGER domain_intent_registered_barrier
BEFORE UPDATE OF state ON domain_registration_intents
WHEN NEW.state = 'registered'
  AND NOT EXISTS (
    SELECT 1
    FROM domain_registrations registration
    WHERE registration.organization_id = NEW.organization_id
      AND registration.project_id = NEW.project_id
      AND registration.registration_intent_id = NEW.id
      AND registration.state = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'registered intent requires active domain registration');
END;

CREATE TABLE domain_dns_change_sets (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  provider_operation_id TEXT,
  state TEXT NOT NULL
    CHECK (state IN ('draft', 'queued', 'processing', 'applied', 'failed', 'manual_review')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  requested_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, registration_id)
    REFERENCES domain_registrations(organization_id, id),
  FOREIGN KEY (organization_id, provider_operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  UNIQUE (registration_id, idempotency_key),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE domain_dns_records (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  change_set_id TEXT NOT NULL,
  record_type TEXT NOT NULL
    CHECK (record_type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 253),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 4096),
  ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds BETWEEN 60 AND 86400),
  priority INTEGER CHECK (priority IS NULL OR priority BETWEEN 0 AND 65535),
  state TEXT NOT NULL CHECK (state IN ('desired', 'applied', 'failed')),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, change_set_id)
    REFERENCES domain_dns_change_sets(organization_id, id),
  UNIQUE (change_set_id, record_type, name, value),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE domain_renewal_intents (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  payment_allocation_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  legal_document_id TEXT NOT NULL REFERENCES legal_documents(id),
  term_acceptance_id TEXT NOT NULL,
  renewal_disclosure_digest TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('queued', 'processing', 'renewed', 'failed', 'manual_review', 'cancelled')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  provider_operation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, registration_id)
    REFERENCES domain_registrations(organization_id, id),
  FOREIGN KEY (organization_id, quote_id)
    REFERENCES domain_quotes(organization_id, id),
  FOREIGN KEY (organization_id, payment_allocation_id)
    REFERENCES domain_payment_allocations(organization_id, id),
  FOREIGN KEY (organization_id, term_acceptance_id)
    REFERENCES term_acceptances(organization_id, id),
  FOREIGN KEY (organization_id, provider_operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  UNIQUE (registration_id, idempotency_key),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_renewal_exact_quote
BEFORE INSERT ON domain_renewal_intents
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_registrations registration
  JOIN domain_quotes quote
    ON quote.organization_id = registration.organization_id
   AND quote.project_id = registration.project_id
  JOIN domain_payment_allocations payment
    ON payment.organization_id = quote.organization_id
   AND payment.quote_id = quote.id
  JOIN domain_procurement_control control
    ON control.singleton = 1
  WHERE registration.organization_id = NEW.organization_id
    AND registration.project_id = NEW.project_id
    AND registration.id = NEW.registration_id
    AND quote.id = NEW.quote_id
    AND quote.quote_kind = 'renewal'
    AND quote.status = 'open'
    AND control.purchasing_enabled = 1
    AND control.active_provider_code = registration.provider_code
    AND quote.domain_name = registration.domain_name
    AND quote.expires_at > NEW.created_at
    AND quote.renewal_disclosure_digest = NEW.renewal_disclosure_digest
    AND payment.id = NEW.payment_allocation_id
    AND payment.state = 'captured'
    AND EXISTS (
      SELECT 1
      FROM term_acceptances acceptance
      JOIN legal_documents document
        ON document.id = acceptance.document_id
      WHERE acceptance.organization_id = NEW.organization_id
        AND acceptance.project_id = NEW.project_id
        AND acceptance.id = NEW.term_acceptance_id
        AND acceptance.user_id = NEW.requested_by_user_id
        AND document.id = NEW.legal_document_id
        AND document.kind = 'domain_renewal'
    )
)
BEGIN
  SELECT RAISE(ABORT, 'renewal must match quote, disclosure, and payment');
END;

CREATE TABLE domain_transfer_out_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL
    CHECK (
      state IN (
        'requested',
        'unlock_pending',
        'auth_code_ready',
        'export_ready',
        'completed',
        'failed',
        'manual_review'
      )
    ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_digest TEXT NOT NULL
    CHECK (
      length(request_digest) = 64
      AND request_digest NOT GLOB '*[^0-9a-f]*'
    ),
  provider_operation_id TEXT,
  auth_code_ciphertext BLOB,
  auth_code_digest TEXT CHECK (
    auth_code_digest IS NULL
    OR (
      length(auth_code_digest) = 64
      AND auth_code_digest NOT GLOB '*[^0-9a-f]*'
    )
  ),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, registration_id)
    REFERENCES domain_registrations(organization_id, id),
  FOREIGN KEY (organization_id, provider_operation_id)
    REFERENCES domain_provider_operations(organization_id, id),
  UNIQUE (registration_id, idempotency_key),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TABLE domain_transfer_exports (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  transfer_request_id TEXT NOT NULL,
  manifest_digest TEXT NOT NULL
    CHECK (
      length(manifest_digest) = 64
      AND manifest_digest NOT GLOB '*[^0-9a-f]*'
    ),
  object_key TEXT NOT NULL CHECK (length(object_key) BETWEEN 1 AND 1024),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  FOREIGN KEY (organization_id, transfer_request_id)
    REFERENCES domain_transfer_out_requests(organization_id, id),
  UNIQUE (transfer_request_id),
  UNIQUE (organization_id, id),
  CHECK (expires_at > created_at)
) STRICT;

CREATE TRIGGER domain_transfer_export_ready
BEFORE INSERT ON domain_transfer_exports
WHEN NOT EXISTS (
  SELECT 1
  FROM domain_transfer_out_requests request
  WHERE request.organization_id = NEW.organization_id
    AND request.project_id = NEW.project_id
    AND request.id = NEW.transfer_request_id
    AND request.state = 'export_ready'
    AND request.auth_code_ciphertext IS NOT NULL
    AND request.auth_code_digest IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'transfer export requires encrypted authorization code');
END;

CREATE TRIGGER domain_provider_operation_subject_exists
BEFORE INSERT ON domain_provider_operations
WHEN (
  (NEW.subject_kind = 'renewal' AND NOT EXISTS (
    SELECT 1
    FROM domain_renewal_intents subject
    WHERE subject.organization_id = NEW.organization_id
      AND subject.project_id = NEW.project_id
      AND subject.id = NEW.subject_id
  ))
  OR
  (NEW.subject_kind = 'transfer_out' AND NOT EXISTS (
    SELECT 1
    FROM domain_transfer_out_requests subject
    WHERE subject.organization_id = NEW.organization_id
      AND subject.project_id = NEW.project_id
      AND subject.id = NEW.subject_id
  ))
  OR
  (NEW.subject_kind = 'dns' AND NOT EXISTS (
    SELECT 1
    FROM domain_dns_change_sets subject
    WHERE subject.organization_id = NEW.organization_id
      AND subject.project_id = NEW.project_id
      AND subject.id = NEW.subject_id
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'domain provider operation subject is outside project scope');
END;

CREATE TRIGGER domain_provider_operation_subject_contract
BEFORE INSERT ON domain_provider_operations
WHEN (
  (NEW.subject_kind = 'renewal' AND (
    NEW.operation_kind <> 'renew'
    OR NOT EXISTS (
      SELECT 1
      FROM domain_renewal_intents renewal
      JOIN domain_registrations registration
        ON registration.organization_id = renewal.organization_id
       AND registration.id = renewal.registration_id
      WHERE renewal.organization_id = NEW.organization_id
        AND renewal.project_id = NEW.project_id
        AND renewal.id = NEW.subject_id
        AND registration.provider_code = NEW.provider_code
    )
  ))
  OR
  (NEW.subject_kind = 'transfer_out' AND NEW.operation_kind NOT IN (
    'unlock', 'request_auth_code', 'transfer_out'
  ))
  OR
  (NEW.subject_kind = 'dns' AND NEW.operation_kind <> 'configure_dns')
)
BEGIN
  SELECT RAISE(ABORT, 'domain provider operation does not match subject contract');
END;

CREATE TABLE domain_manual_reviews (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL
    CHECK (subject_kind IN ('registration', 'provider_operation', 'renewal', 'transfer_out')),
  subject_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved', 'rejected')),
  assigned_operator_id TEXT,
  detail_ciphertext BLOB,
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_code TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id),
  UNIQUE (subject_kind, subject_id, reason_code, state),
  UNIQUE (organization_id, id)
) STRICT;

CREATE TRIGGER domain_quotes_immutable
BEFORE UPDATE ON domain_quotes
BEGIN
  SELECT RAISE(ABORT, 'domain_quotes is immutable');
END;

CREATE TRIGGER domain_registrant_snapshots_immutable
BEFORE UPDATE ON domain_registrant_snapshots
BEGIN
  SELECT RAISE(ABORT, 'domain_registrant_snapshots is immutable');
END;

CREATE TRIGGER domain_agent_consents_immutable
BEFORE UPDATE ON domain_agent_consents
BEGIN
  SELECT RAISE(ABORT, 'domain_agent_consents is immutable');
END;

CREATE TRIGGER domain_payment_allocations_immutable
BEFORE UPDATE ON domain_payment_allocations
BEGIN
  SELECT RAISE(ABORT, 'domain_payment_allocations is immutable');
END;

CREATE TRIGGER domain_irreversible_confirmations_immutable
BEFORE UPDATE ON domain_irreversible_confirmations
BEGIN
  SELECT RAISE(ABORT, 'domain_irreversible_confirmations is immutable');
END;

CREATE TRIGGER domain_provider_operation_events_immutable
BEFORE UPDATE ON domain_provider_operation_events
BEGIN
  SELECT RAISE(ABORT, 'domain_provider_operation_events is immutable');
END;

CREATE TRIGGER domain_registrar_debits_immutable
BEFORE UPDATE ON domain_registrar_debits
BEGIN
  SELECT RAISE(ABORT, 'domain_registrar_debits is immutable');
END;

CREATE TRIGGER domain_transfer_exports_immutable
BEFORE UPDATE ON domain_transfer_exports
BEGIN
  SELECT RAISE(ABORT, 'domain_transfer_exports is immutable');
END;
