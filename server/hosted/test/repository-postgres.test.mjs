import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCanonicalPostgresAuthority,
  createPostgresHostedRepository
} from "../repository-postgres.mjs";

function fakePool(readinessRow = {}) {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ text: "release", values: [] });
    }
  };
  return {
    calls,
    async query(text, values = []) {
      calls.push({ text, values });
      return { rows: [readinessRow], rowCount: 1 };
    },
    async connect() {
      calls.push({ text: "connect", values: [] });
      return client;
    },
    async end() {
      calls.push({ text: "end", values: [] });
    }
  };
}

function readyRow(overrides = {}) {
  return {
    database_name: "sitesourcery",
    shadow_schema_absent: true,
    users_ready: true,
    identity_ready: true,
    passwords_ready: true,
    sessions_ready: true,
    auth_limits_ready: true,
    registration_ready: true,
    registration_contract_ready: true,
    organizations_ready: true,
    memberships_ready: true,
    projects_ready: true,
    drafts_ready: true,
    versions_ready: true,
    addresses_ready: true,
    commerce_ready: true,
    offer_prices_ready: true,
    quote_prices_ready: true,
    checkout_prices_ready: true,
    runtime_contract_ready: true,
    verified_registration_contract_ready: true,
    recovery_deliveries_ready: true,
    recovery_delivery_contract_ready: true,
    legal_contract_ready: true,
    legal_authority_ready: true,
    commerce_v2_commands_ready: true,
    commerce_v2_quotes_ready: true,
    commerce_v2_preparations_ready: true,
    commerce_v2_contract_ready: true,
    commerce_v2_dispatches_ready: true,
    commerce_v2_download_events_ready: true,
    commerce_v2_download_receipts_ready: true,
    commerce_v2_entitlements_ready: true,
    commerce_v2_reversals_ready: true,
    commerce_v2_settlement_contract_ready: true,
    alakazam_subscriptions_ready: true,
    alakazam_quotes_ready: true,
    alakazam_dispatches_ready: true,
    alakazam_events_ready: true,
    alakazam_receipts_ready: true,
    alakazam_credits_ready: true,
    alakazam_downgrades_ready: true,
    alakazam_tier_events_ready: true,
    alakazam_contract_ready: true,
    alakazam_customer_provisions_ready: true,
    alakazam_customer_contract_ready: true,
    alakazam_checkout_contract_ready: true,
    alakazam_payment_contract_ready: true,
    alakazam_activation_contract_ready: true,
    alakazam_upgrade_contract_ready: true,
    alakazam_upgrade_activation_contract_ready: true,
    alakazam_downgrade_dispatch_contract_ready: true,
    alakazam_downgrade_activation_contract_ready: true,
    alakazam_fulfillment_intents_ready: true,
    alakazam_fulfillment_operations_ready: true,
    alakazam_fulfillment_projection_ready: true,
    alakazam_fulfillment_contract_ready: true,
    alakazam_tier_fulfillment_contract_ready: true,
    custom_services_schema_ready: true,
    custom_services_policy_ready: true,
    custom_services_security_ready: true,
    custom_services_contract_marker_ready: true,
    custom_service_quotes_schema_ready: true,
    custom_service_quotes_contract_marker_ready: true,
    custom_service_customer_commands_contract_marker_ready: true,
    custom_service_invoices_contract_marker_ready: true,
    custom_service_invoices_held_ready: true,
    custom_service_assessment_checkout_contract_marker_ready: true,
    custom_service_assessment_checkout_ready: true,
    custom_service_assessment_settlement_contract_marker_ready: true,
    custom_service_assessment_settlement_ready: true,
    custom_service_quotes_security_ready: true,
    custom_service_quotes_retention_ready: true,
    custom_service_quotes_digests_ready: true,
    custom_service_quotes_terms_ready: true,
    custom_service_quotes_operator_authority_ready: true,
    custom_service_quotes_acceptance_ready: true,
    custom_service_customer_commands_fences_ready: true,
    releases_ready: true,
    exports_ready: true,
    export_grants_ready: true,
    audit_ready: true,
    idempotency_ready: true,
    ...overrides
  };
}

test("canonical readiness rejects missing migrations and any ss_hosted shadow", async () => {
  let authority = createCanonicalPostgresAuthority({
    pool: fakePool(readyRow({ versions_ready: false }))
  });
  assert.deepEqual(await authority.readiness(), {
    ready: false,
    kind: "canonical-postgres",
    code: "DATABASE_NOT_MIGRATED",
    database: "sitesourcery",
    missing: ["versions"]
  });

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(readyRow({ runtime_contract_ready: false }))
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "runtime_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        custom_service_assessment_settlement_contract_marker_ready: false,
        custom_service_assessment_settlement_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_service_assessment_settlement",
    "custom_service_assessment_settlement_contract_marker"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        legal_contract_ready: false,
        legal_authority_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "legal_authority",
    "legal_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        registration_contract_ready: false,
        verified_registration_contract_ready:
          false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "registration_contract",
    "verified_registration_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        recovery_deliveries_ready: false,
        recovery_delivery_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "recovery_deliveries",
    "recovery_delivery_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        commerce_v2_commands_ready: false,
        commerce_v2_quotes_ready: false,
        commerce_v2_preparations_ready: false,
        commerce_v2_contract_ready: false,
        commerce_v2_dispatches_ready: false,
        commerce_v2_download_events_ready: false,
        commerce_v2_download_receipts_ready: false,
        commerce_v2_entitlements_ready: false,
        commerce_v2_reversals_ready: false,
        commerce_v2_settlement_contract_ready:
          false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "commerce_v2_commands",
    "commerce_v2_contract",
    "commerce_v2_dispatches",
    "commerce_v2_download_events",
    "commerce_v2_download_receipts",
    "commerce_v2_entitlements",
    "commerce_v2_preparations",
    "commerce_v2_quotes",
    "commerce_v2_reversals",
    "commerce_v2_settlement_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_customer_provisions_ready: false,
        alakazam_customer_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_customer_contract",
    "alakazam_customer_provisions"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_checkout_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_checkout_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_payment_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_payment_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_activation_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_activation_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_upgrade_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_upgrade_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        alakazam_upgrade_activation_contract_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "alakazam_upgrade_activation_contract"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        custom_services_policy_ready: false,
        custom_services_security_ready: false,
        custom_services_contract_marker_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_services_contract_marker",
    "custom_services_policy",
    "custom_services_security"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        custom_service_quotes_contract_marker_ready: false,
        custom_service_quotes_security_ready: false,
        custom_service_quotes_retention_ready: false,
        custom_service_quotes_digests_ready: false,
        custom_service_quotes_terms_ready: false,
        custom_service_quotes_operator_authority_ready: false,
        custom_service_quotes_acceptance_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_service_quotes_acceptance",
    "custom_service_quotes_contract_marker",
    "custom_service_quotes_digests",
    "custom_service_quotes_operator_authority",
    "custom_service_quotes_retention",
    "custom_service_quotes_security",
    "custom_service_quotes_terms"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        custom_service_invoices_contract_marker_ready: false,
        custom_service_invoices_held_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_service_invoices_contract_marker",
    "custom_service_invoices_held"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({
        custom_service_assessment_checkout_contract_marker_ready: false,
        custom_service_assessment_checkout_ready: false
      })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_service_assessment_checkout",
    "custom_service_assessment_checkout_contract_marker"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(
      readyRow({ custom_service_quotes_schema_ready: false })
    )
  });
  assert.deepEqual((await authority.readiness()).missing, [
    "custom_service_assessment_checkout",
    "custom_service_assessment_checkout_contract_marker",
    "custom_service_assessment_settlement",
    "custom_service_assessment_settlement_contract_marker",
    "custom_service_customer_commands_contract_marker",
    "custom_service_customer_commands_fences",
    "custom_service_invoices_contract_marker",
    "custom_service_invoices_held",
    "custom_service_quotes_acceptance",
    "custom_service_quotes_contract_marker",
    "custom_service_quotes_digests",
    "custom_service_quotes_operator_authority",
    "custom_service_quotes_retention",
    "custom_service_quotes_schema",
    "custom_service_quotes_security",
    "custom_service_quotes_terms"
  ]);

  authority = createCanonicalPostgresAuthority({
    pool: fakePool(readyRow({ shadow_schema_absent: false }))
  });
  assert.equal((await authority.readiness()).code, "SHADOW_SCHEMA_PRESENT");
});

test("tenant transaction sets role and transaction-local principal before work", async () => {
  const pool = fakePool(readyRow());
  const authority = createCanonicalPostgresAuthority({ pool });
  const value = await authority.tenant(
    {
      userId: "00000000-0000-4000-8000-000000000101",
      organizationId: "00000000-0000-4000-8000-000000000201",
      readOnly: true,
      isolation: "repeatable-read"
    },
    async (client) => {
      await client.query("select ss.current_user_id(), ss.current_org_id()");
      return "done";
    }
  );
  assert.equal(value, "done");
  assert.deepEqual(
    pool.calls.map((call) => call.text),
    [
      "connect",
      "begin",
      "set transaction isolation level REPEATABLE READ read only",
      "set local role authenticated",
      "select set_config('request.jwt.claim.sub', $1, true)",
      "select set_config('request.jwt.claims', $1, true)",
      "select set_config('app.organization_id', $1, true)",
      "select set_config('app.service_actor_kind', $1, true)",
      "select set_config('app.service_actor_user_id', $1, true)",
      "select set_config('app.service_actor_organization_id', $1, true)",
      "select ss.current_user_id(), ss.current_org_id()",
      "commit",
      "release"
    ]
  );
});

test("customer service transaction binds the exact actor locally", async () => {
  const pool = fakePool(readyRow());
  const authority = createCanonicalPostgresAuthority({ pool });
  const userId = "00000000-0000-4000-8000-000000000101";
  const organizationId = "00000000-0000-4000-8000-000000000201";

  await authority.service(
    {
      actorKind: "customer",
      userId,
      organizationId
    },
    async (client) => {
      await client.query("select ss.current_service_actor_kind()");
    }
  );

  const settings = pool.calls.filter((call) =>
    call.text.startsWith("select set_config('app.service_actor_")
  );
  assert.deepEqual(settings, [
    {
      text: "select set_config('app.service_actor_kind', $1, true)",
      values: ["customer"]
    },
    {
      text: "select set_config('app.service_actor_user_id', $1, true)",
      values: [userId]
    },
    {
      text:
        "select set_config('app.service_actor_organization_id', $1, true)",
      values: [organizationId]
    }
  ]);
});

test("customer service actor fails before connection without full context", async () => {
  const pool = fakePool(readyRow());
  const authority = createCanonicalPostgresAuthority({ pool });

  await assert.rejects(
    authority.service(
      {
        actorKind: "customer",
        userId: "00000000-0000-4000-8000-000000000101"
      },
      async () => {}
    ),
    (error) => error?.code === "DATABASE_SERVICE_ACTOR_REQUIRED"
  );
  assert.equal(
    pool.calls.some((call) => call.text === "connect"),
    false
  );
});

test("service transaction is explicit and rollback preserves the original error", async () => {
  const pool = fakePool(readyRow());
  const authority = createCanonicalPostgresAuthority({ pool });
  const failure = new Error("work failed");
  await assert.rejects(
    authority.service({}, async () => {
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal(
    pool.calls.some((call) => call.text === "set local role service_role"),
    true
  );
  assert.equal(pool.calls.some((call) => call.text === "rollback"), true);
});

test("legacy aggregate PostgreSQL entrypoint fails closed", () => {
  assert.throws(
    () => createPostgresHostedRepository(),
    (error) => error?.code === "AGGREGATE_POSTGRES_REMOVED"
  );
});

test("production PostgreSQL source contains no aggregate or ss_hosted persistence", async () => {
  const source = await readFile(
    new URL("../repository-postgres.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /runtime_state|runtime_revisions|payload jsonb/u);
  assert.doesNotMatch(source, /repository-memory/u);
  assert.match(source, /to_regnamespace\('ss_hosted'\) is null/u);
  assert.match(source, /hosted_runtime_contract_v35/u);
  assert.match(source, /canonical-ss-v35-custom-service-quotes/u);
  assert.match(source, /hosted_runtime_contract_v36/u);
  assert.match(
    source,
    /canonical-ss-v36-custom-service-customer-commands/u
  );
  assert.match(source, /hosted_runtime_contract_v37/u);
  assert.match(
    source,
    /canonical-ss-v37-custom-service-held-invoices/u
  );
  assert.match(source, /hosted_runtime_contract_v38/u);
  assert.match(
    source,
    /canonical-ss-v38-custom-service-assessment-checkout/u
  );
  assert.match(source, /hosted_runtime_contract_v39/u);
  assert.match(
    source,
    /canonical-ss-v39-custom-service-assessment-settlement/u
  );
  assert.match(source, /authoritySchema: "ss"/u);
});
