import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CORE_REVENUE_ADMIN_URL_ENV,
  CORE_REVENUE_DATABASE_NAME_ENV,
  CoreRevenueProofError,
  buildCoreRevenueCommand,
  generateCoreRevenueDatabaseName,
  parseLocalAdminUrl,
  runCoreRevenueProof,
  sanitizedProofEnvironment,
  validateCoreRevenueDatabaseName
} from "../core-revenue-e2e.mjs";

const DATABASE_NAME =
  "ss_core_revenue_e2e_unit_20260811";
const ADMIN_URL =
  "postgresql://proof-user:do-not-print@127.0.0.1:5432/postgres";
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

test("core revenue database and local-admin bounds fail closed", () => {
  assert.equal(
    validateCoreRevenueDatabaseName(DATABASE_NAME),
    DATABASE_NAME
  );
  assert.equal(
    parseLocalAdminUrl("postgresql:///postgres").baseDatabase,
    "postgres"
  );
  assert.equal(
    parseLocalAdminUrl(ADMIN_URL).baseDatabase,
    "postgres"
  );
  assert.equal(
    parseLocalAdminUrl(
      "postgresql:///postgres?host=%2Fprivate%2Ftmp%2Fproof&port=55461"
    ).baseDatabase,
    "postgres"
  );
  for (const invalidName of [
    "postgres",
    "ss_core_revenue_e2e_short",
    "ss_core_revenue_e2e_UPPERCASE_20260811",
    "ss_core_revenue_e2e_unit-20260811",
    "ss_core_revenue_e2e_unit_20260811;drop"
  ]) {
    assert.throws(
      () => validateCoreRevenueDatabaseName(invalidName),
      (error) =>
        error instanceof CoreRevenueProofError &&
        error.code === "CORE_REVENUE_DATABASE_NAME_INVALID"
    );
  }
  for (const invalidUrl of [
    "https://127.0.0.1/postgres",
    "postgresql://db.example.com/postgres",
    "postgresql://127.0.0.1/",
    "postgresql://127.0.0.1/one/two",
    "postgresql://127.0.0.1/postgres#fragment",
    "postgresql:///postgres?host=db.example.com",
    "postgresql:///postgres?hostaddr=203.0.113.1",
    "postgresql:///postgres?port=70000"
  ]) {
    assert.throws(
      () => parseLocalAdminUrl(invalidUrl),
      (error) =>
        error instanceof CoreRevenueProofError &&
        error.code === "CORE_REVENUE_ADMIN_URL_INVALID"
    );
  }
});

test("database name generation is deterministic through injected inputs", () => {
  assert.equal(
    generateCoreRevenueDatabaseName({
      now: () => new Date("2026-08-11T12:34:56.789Z"),
      uuid: () => "01234567-89ab-4cde-8fab-0123456789ab"
    }),
    "ss_core_revenue_e2e_20260811t123456789z_0123456789"
  );
});

test("proof command carries only the disposable URL and local test selector", () => {
  const target =
    "postgresql://proof-user:target-secret@127.0.0.1:5432/" +
    DATABASE_NAME;
  const environment = sanitizedProofEnvironment(
    {
      PATH: "/unit/bin",
      SITESOURCERY_CHROMIUM: "/unit/reviewed-browser",
      STRIPE_SECRET_KEY: "must-not-cross",
      SITESOURCERY_STRIPE_WEBHOOK_SECRET:
        "must-not-cross-either",
      SITESOURCERY_PG_OTHER_TEST_URL:
        "postgresql://other-secret@127.0.0.1/other",
      DATABASE_URL: "postgresql://production-secret@example.com/live"
    },
    target
  );
  assert.deepEqual(environment, {
    PATH: "/unit/bin",
    SITESOURCERY_CHROMIUM: "/unit/reviewed-browser",
    SITESOURCERY_CORE_REVENUE_E2E_ONLY: "1",
    SITESOURCERY_PG_SERVICE_TEST_URL: target
  });
  const command = buildCoreRevenueCommand({
    environment,
    nodeExecutable: "/unit/node",
    projectRoot: PROJECT_ROOT,
    targetDatabaseUrl: target
  });
  assert.equal(command.command, "/unit/node");
  assert.ok(
    command.args.some((argument) =>
      argument.includes("CORE-REVENUE-E2E-01")
    )
  );
  assert.ok(
    command.args.some((argument) => argument.endsWith(
      "server/hosted/test/postgres-service.integration.test.mjs"
    ))
  );
  assert.ok(
    command.args.some((argument) => argument.endsWith(
      "server/commerce-v2/test/payment.test.mjs"
    ))
  );
  assert.equal(
    [command.command, ...command.args].join(" ").includes(target),
    false
  );
});

function createPorts({ commandExitCode = 0 } = {}) {
  const state = {
    exists: false,
    creates: 0,
    drops: 0,
    commands: [],
    statuses: [],
    closed: 0
  };
  const admin = {
    async query(sql) {
      const normalized = sql.replace(/\s+/gu, " ").trim().toLowerCase();
      if (normalized.startsWith("select current_database()")) {
        return {
          rows: [{
            database_name: "postgres",
            server_version_num: 160014
          }]
        };
      }
      if (normalized.includes("from pg_database")) {
        return { rows: [{ exists: state.exists }] };
      }
      if (normalized.startsWith("create database")) {
        assert.equal(state.exists, false);
        state.exists = true;
        state.creates += 1;
        return { rows: [] };
      }
      if (normalized.includes("from pg_stat_activity")) {
        return { rows: [{ session_count: 0 }] };
      }
      if (normalized.startsWith("drop database")) {
        assert.equal(state.exists, true);
        state.exists = false;
        state.drops += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    async close() {
      state.closed += 1;
    }
  };
  return {
    state,
    ports: {
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      uuid: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      async connectAdmin({ connectionString }) {
        assert.equal(connectionString, ADMIN_URL);
        return admin;
      },
      async runCommand(specification) {
        state.commands.push(specification);
        return { exitCode: commandExitCode, signal: null };
      },
      writeStatus(message) {
        state.statuses.push(message);
      }
    }
  };
}

test("proof lifecycle creates, runs, and removes only its exact database", async () => {
  const { ports, state } = createPorts();
  const result = await runCoreRevenueProof({
    environment: {
      PATH: "/unit/bin",
      [CORE_REVENUE_ADMIN_URL_ENV]: ADMIN_URL,
      [CORE_REVENUE_DATABASE_NAME_ENV]: DATABASE_NAME,
      STRIPE_SECRET_KEY: "must-not-cross"
    },
    nodeExecutable: "/unit/node",
    ports,
    projectRoot: PROJECT_ROOT
  });
  assert.deepEqual(
    {
      ok: result.ok,
      databaseAbsent: result.databaseAbsent,
      providerEffects: result.providerEffects,
      journey: result.journey
    },
    {
      ok: true,
      databaseAbsent: true,
      providerEffects: false,
      journey: "CORE-REVENUE-E2E-01"
    }
  );
  assert.equal(state.creates, 1);
  assert.equal(state.drops, 1);
  assert.equal(state.exists, false);
  assert.equal(state.commands.length, 1);
  assert.equal(state.closed, 1);
  assert.equal(
    Object.hasOwn(
      state.commands[0].environment,
      "STRIPE_SECRET_KEY"
    ),
    false
  );
});

test("failed journey is cleaned without masking the primary failure", async () => {
  const { ports, state } = createPorts({ commandExitCode: 17 });
  await assert.rejects(
    runCoreRevenueProof({
      environment: {
        [CORE_REVENUE_ADMIN_URL_ENV]: ADMIN_URL,
        [CORE_REVENUE_DATABASE_NAME_ENV]: DATABASE_NAME
      },
      nodeExecutable: "/unit/node",
      ports,
      projectRoot: PROJECT_ROOT
    }),
    (error) =>
      error instanceof CoreRevenueProofError &&
      error.code === "CORE_REVENUE_SUBPROCESS_FAILED" &&
      error.databaseAbsent === true
  );
  assert.equal(state.creates, 1);
  assert.equal(state.drops, 1);
  assert.equal(state.exists, false);
  assert.equal(state.closed, 1);
});
