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
      "select ss.current_user_id(), ss.current_org_id()",
      "commit",
      "release"
    ]
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
  assert.match(source, /authoritySchema: "ss"/u);
});
