CREATE TEMP TABLE invariant_results (
  name TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CHECK (passed = 1)
) STRICT;

INSERT INTO invariant_results
SELECT
  'checkout disabled',
  (
    SELECT checkout_enabled = 0 AND live_mode = 0
    FROM commerce_control
    WHERE singleton = 1
  );

INSERT INTO invariant_results
VALUES (
  'no launch price seed',
  (SELECT count(*) = 0 FROM catalog_prices)
);

INSERT INTO invariant_results
VALUES (
  'no provider object seed',
  (
    (SELECT count(*) FROM provider_receipts) = 0
    AND (SELECT count(*) FROM stripe_events) = 0
    AND (SELECT count(*) FROM stripe_customers) = 0
    AND (SELECT count(*) FROM stripe_subscriptions) = 0
  )
);

INSERT INTO invariant_results
VALUES (
  '14 day grace',
  (
    SELECT grace_seconds = 14 * 24 * 60 * 60
    FROM billing_policies
    WHERE policy_key = 'abracadabra-hosted-14d-grace-90d-retention/v1'
  )
);

INSERT INTO invariant_results
VALUES (
  '90 day retention',
  (
    SELECT retention_seconds = 90 * 24 * 60 * 60
    FROM billing_policies
    WHERE policy_key = 'abracadabra-hosted-14d-grace-90d-retention/v1'
  )
);

INSERT INTO invariant_results
VALUES (
  'current resolution view exists',
  (
    SELECT count(*) = 1
    FROM sqlite_schema
    WHERE type = 'view'
      AND name = 'current_site_resolution'
  )
);

INSERT INTO invariant_results
VALUES (
  'active hostname unique index exists',
  (
    SELECT count(*) = 1
    FROM sqlite_schema
    WHERE type = 'index'
      AND name = 'project_addresses_active_hostname'
  )
);

INSERT INTO invariant_results
VALUES (
  'no domain provider or purchase seed',
  (
    (SELECT count(*) FROM domain_quotes) = 0
    AND (SELECT count(*) FROM domain_payment_allocations) = 0
    AND (SELECT count(*) FROM domain_registration_intents) = 0
    AND (SELECT count(*) FROM domain_provider_operations) = 0
    AND (SELECT count(*) FROM domain_registrations) = 0
  )
);

INSERT INTO invariant_results
VALUES (
  'domain purchasing disabled',
  (
    SELECT purchasing_enabled = 0
      AND live_mode = 0
      AND active_provider_code IS NULL
      AND agent_legal_document_id IS NULL
      AND renewal_legal_document_id IS NULL
    FROM domain_procurement_control
    WHERE singleton = 1
  )
);

INSERT INTO invariant_results
VALUES (
  'irreversible domain barriers exist',
  (
    SELECT count(*) = 4
    FROM sqlite_schema
    WHERE type = 'trigger'
      AND name IN (
        'domain_irreversible_confirmation_barrier',
        'domain_register_operation_requires_confirmation',
        'domain_registration_exact_provider_result',
        'domain_intent_registered_barrier'
      )
  )
);

INSERT INTO invariant_results
VALUES (
  'encrypted registrant envelope required',
  (
    SELECT count(*) = 3
    FROM pragma_table_info('domain_registrant_snapshots')
    WHERE name IN (
      'encryption_algorithm',
      'encryption_key_version',
      'contact_ciphertext'
    )
      AND "notnull" = 1
  )
);

INSERT INTO invariant_results
VALUES (
  'domain lifecycle tables exist',
  (
    SELECT count(*) = 8
    FROM sqlite_schema
    WHERE type = 'table'
      AND name IN (
        'domain_registrations',
        'domain_dns_change_sets',
        'domain_dns_records',
        'domain_renewal_intents',
        'domain_transfer_out_requests',
        'domain_transfer_exports',
        'domain_manual_reviews',
        'domain_registrar_debits'
      )
  )
);

SELECT name, passed
FROM invariant_results
ORDER BY name;
