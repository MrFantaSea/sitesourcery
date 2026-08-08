import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CORE_RELEASE_ALAKAZAM_BILLING_JOURNEY_COUNT,
  CORE_RELEASE_ALAKAZAM_LIFECYCLE_JOURNEY_COUNT,
  CORE_RELEASE_ADMIN_URL_ENV,
  CORE_RELEASE_CUSTOM_SERVICES_JOURNEY_COUNT,
  CORE_RELEASE_DATABASE_NAME_ENV,
  CORE_RELEASE_MIGRATION_COUNT,
  CoreReleaseError,
  buildCoreReleaseCommands,
  buildTargetDatabaseUrl,
  generateCoreReleaseDatabaseName,
  parseCoreReleaseAdminUrl,
  runCoreRelease,
  validateCoreReleaseDatabaseName
} from "../core-release.mjs";
import {
  CORE_RELEASE_ADMIN_URL_ENV as MIGRATION_ADMIN_URL_ENV,
  MIGRATION_TEST_URL_ENV,
  resolveMigrationDatabasePlan
} from "../../server/data-plane/tests/verify-empty-postgres-migrations.mjs";

const DATABASE_NAME =
  "ss_core_release_unit_20260806";
const ADMIN_URL =
  "postgresql://release-user:do-not-print@127.0.0.1:55439/postgres?sslmode=disable";
const BASE_ENVIRONMENT = Object.freeze({
  PATH: "/unit/bin",
  [CORE_RELEASE_ADMIN_URL_ENV]: ADMIN_URL,
  [CORE_RELEASE_DATABASE_NAME_ENV]: DATABASE_NAME
});

function createHarness({
  databaseExists = false,
  failCommandId = null,
  postgresVersionNumber = 160014,
  sessionsDuringCleanup = 0
} = {}) {
  const state = {
    databaseExists,
    createCount: 0,
    dropCount: 0,
    closeCount: 0,
    commands: [],
    queries: [],
    statuses: [],
    errors: [],
    events: []
  };
  const admin = {
    async query(sql, values = []) {
      const normalized = sql
        .replace(/\s+/gu, " ")
        .trim()
        .toLowerCase();
      state.queries.push({ sql: normalized, values });
      state.events.push(`query:${normalized}`);
      if (
        normalized ===
          "select current_database() as database_name, " +
          "current_setting('server_version_num')::integer as server_version_num"
      ) {
        return {
          rows: [{
            database_name: "postgres",
            server_version_num: postgresVersionNumber
          }]
        };
      }
      if (normalized.includes("from pg_database")) {
        return { rows: [{ exists: state.databaseExists }] };
      }
      if (normalized.startsWith("create database")) {
        assert.equal(state.databaseExists, false);
        state.databaseExists = true;
        state.createCount += 1;
        return { rows: [] };
      }
      if (normalized.includes("from pg_stat_activity")) {
        return {
          rows: [{
            session_count: sessionsDuringCleanup
          }]
        };
      }
      if (normalized.startsWith("drop database")) {
        state.databaseExists = false;
        state.dropCount += 1;
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
    async close() {
      state.closeCount += 1;
    }
  };
  const ports = {
    now: () => new Date("2026-08-06T12:34:56.000Z"),
    uuid: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    async connectAdmin({ connectionString }) {
      assert.equal(connectionString, ADMIN_URL);
      return admin;
    },
    async runCommand(specification) {
      state.commands.push(specification);
      state.events.push(`command:${specification.id}`);
      return {
        exitCode:
          specification.id === failCommandId
            ? 17
            : 0,
        signal: null
      };
    },
    writeStatus(message) {
      state.statuses.push(message);
    },
    writeError(message) {
      state.errors.push(message);
    }
  };
  return { ports, state };
}

test("database names are strict disposable identifiers", () => {
  assert.equal(
    validateCoreReleaseDatabaseName(DATABASE_NAME),
    DATABASE_NAME
  );
  for (const invalid of [
    "sitesourcery",
    "ss_core_release_short",
    "ss_core_release_UPPERCASE_123",
    "ss_core_release_unit-20260806",
    "ss_core_release_unit_20260806;drop database postgres",
    `ss_core_release_${"a".repeat(60)}`
  ]) {
    assert.throws(
      () => validateCoreReleaseDatabaseName(invalid),
      (error) =>
        error instanceof CoreReleaseError &&
        error.code ===
          "CORE_RELEASE_DATABASE_NAME_INVALID"
    );
  }
});

test("database-name generation is deterministic through injected time and UUID", () => {
  assert.equal(
    generateCoreReleaseDatabaseName({
      now: () =>
        new Date("2026-08-06T12:34:56.789Z"),
      uuid: () =>
        "01234567-89ab-4cde-8fab-0123456789ab"
    }),
    "ss_core_release_20260806t123456789z_0123456789ab"
  );
});

test("admin URL validation requires one PostgreSQL base database", () => {
  assert.equal(
    parseCoreReleaseAdminUrl(ADMIN_URL).baseDatabase,
    "postgres"
  );
  for (const invalid of [
    "not-a-url",
    "https://127.0.0.1/postgres",
    "postgresql://127.0.0.1",
    "postgresql://127.0.0.1/one/two",
    "postgresql://127.0.0.1/postgres#fragment"
  ]) {
    assert.throws(
      () => parseCoreReleaseAdminUrl(invalid),
      (error) =>
        error instanceof CoreReleaseError &&
        error.code === "CORE_RELEASE_ADMIN_URL_INVALID"
    );
  }
  assert.throws(
    () => buildTargetDatabaseUrl(
      `postgresql://127.0.0.1/${DATABASE_NAME}`,
      DATABASE_NAME
    ),
    (error) =>
      error.code ===
        "CORE_RELEASE_ADMIN_TARGET_COLLISION"
  );
});

test("command construction keeps URLs in scoped env and out of argv", () => {
  const targetUrl = buildTargetDatabaseUrl(
    ADMIN_URL,
    DATABASE_NAME
  );
  const commands = buildCoreReleaseCommands({
    environment: BASE_ENVIRONMENT,
    nodeExecutable: "/unit/node-24",
    projectRoot: "/unit/project",
    targetDatabaseUrl: targetUrl
  });
  assert.deepEqual(
    commands.map(({ id }) => id),
    [
      "migration-replay",
      "custom-services-postgres",
      "candidate-test"
    ]
  );
  assert.equal(commands[0].command, "/unit/node-24");
  assert.equal(commands[1].command, "/unit/node-24");
  assert.deepEqual(commands[2].args, ["test"]);
  assert.match(
    commands[0].args[0],
    /verify-empty-postgres-migrations\.mjs$/u
  );
  assert.match(
    commands[1].args[2],
    /custom-services-foundation-postgres\.integration\.test\.mjs$/u
  );
  assert.match(
    commands[1].args[3],
    /custom-service-quotes-postgres\.integration\.test\.mjs$/u
  );
  assert.match(
    commands[1].args[4],
    /alakazam-lifecycle-postgres\.integration\.test\.mjs$/u
  );
  assert.match(
    commands[1].args[5],
    /alakazam-billing-postgres\.integration\.test\.mjs$/u
  );
  for (const command of commands) {
    const argv = JSON.stringify([
      command.command,
      ...command.args
    ]);
    assert.doesNotMatch(argv, /do-not-print/u);
    assert.equal(
      command.environment[CORE_RELEASE_ADMIN_URL_ENV],
      undefined
    );
    assert.equal(
      command.environment[
        CORE_RELEASE_DATABASE_NAME_ENV
      ],
      undefined
    );
  }
  assert.equal(
    commands[0].environment[
      "SITESOURCERY_PG_MIGRATION_TEST_URL"
    ],
    targetUrl
  );
  assert.equal(
    commands[1].environment[
      "SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL"
    ],
    targetUrl
  );
  assert.equal(
    commands[1].environment[
      "SITESOURCERY_PG_CUSTOM_SERVICE_QUOTES_TEST_URL"
    ],
    targetUrl
  );
  assert.equal(
    commands[1].environment[
      "SITESOURCERY_PG_ALAKAZAM_LIFECYCLE_TEST_URL"
    ],
    targetUrl
  );
  assert.equal(
    commands[1].environment[
      "SITESOURCERY_PG_ALAKAZAM_BILLING_TEST_URL"
    ],
    targetUrl
  );
  assert.equal(
    commands[2].environment[
      "SITESOURCERY_PG_MIGRATION_TEST_URL"
    ],
    undefined
  );
  assert.deepEqual(
    resolveMigrationDatabasePlan({
      environment: commands[0].environment,
      uuid: () => {
        throw new Error("caller-owned mode must not allocate a database");
      }
    }),
    {
      ownership: "caller",
      adminUrl: null,
      databaseName: DATABASE_NAME,
      databaseUrl: targetUrl
    }
  );
});

test("candidate npm runs through the exact pinned Node when npm exposes its CLI", () => {
  const commands = buildCoreReleaseCommands({
    environment: {
      ...BASE_ENVIRONMENT,
      npm_execpath: "/unit/npm-cli.js"
    },
    nodeExecutable: "/unit/node-24",
    projectRoot: "/unit/project",
    targetDatabaseUrl: buildTargetDatabaseUrl(
      ADMIN_URL,
      DATABASE_NAME
    )
  });
  assert.equal(commands[2].command, "/unit/node-24");
  assert.deepEqual(
    commands[2].args,
    ["/unit/npm-cli.js", "test"]
  );
  assert.equal(
    commands[2].environment.PATH,
    ["/unit", "/unit/bin"].join(path.delimiter)
  );
});

test("migration verifier keeps caller ownership distinct from standalone ownership", () => {
  const standalone = resolveMigrationDatabasePlan({
    environment: {
      [MIGRATION_ADMIN_URL_ENV]: ADMIN_URL
    },
    uuid: () => "01234567-89ab-4cde-8fab-0123456789ab"
  });
  assert.deepEqual(standalone, {
    ownership: "verifier",
    adminDatabaseName: "postgres",
    adminUrl: ADMIN_URL,
    databaseName:
      "ss_privacy_v3_0123456789ab4cde8fab0123456789ab",
    databaseUrl:
      "postgresql://release-user:do-not-print@127.0.0.1:55439/" +
      "ss_privacy_v3_0123456789ab4cde8fab0123456789ab?sslmode=disable"
  });
  assert.throws(
    () => resolveMigrationDatabasePlan({
      environment: {
        [MIGRATION_TEST_URL_ENV]: buildTargetDatabaseUrl(
          ADMIN_URL,
          DATABASE_NAME
        ),
        [MIGRATION_ADMIN_URL_ENV]: ADMIN_URL
      }
    }),
    /mutually exclusive/u
  );
});

test("successful orchestration drops the exact database before npm test", async () => {
  const { ports, state } = createHarness();
  const result = await runCoreRelease({
    environment: BASE_ENVIRONMENT,
    nodeExecutable: "/unit/node-24",
    ports,
    projectRoot: "/unit/project"
  });
  assert.deepEqual(result, {
    ok: true,
    databaseName: DATABASE_NAME,
    postgresMajor: 16,
    migrationsApplied: CORE_RELEASE_MIGRATION_COUNT,
    customServicesJourneys:
      CORE_RELEASE_CUSTOM_SERVICES_JOURNEY_COUNT,
    alakazamLifecycleJourneys:
      CORE_RELEASE_ALAKAZAM_LIFECYCLE_JOURNEY_COUNT,
    alakazamBillingJourneys:
      CORE_RELEASE_ALAKAZAM_BILLING_JOURNEY_COUNT,
    databaseAbsent: true
  });
  assert.deepEqual(
    state.commands.map(({ id }) => id),
    [
      "migration-replay",
      "custom-services-postgres",
      "candidate-test"
    ]
  );
  assert.equal(state.createCount, 1);
  assert.equal(state.dropCount, 1);
  assert.equal(state.databaseExists, false);
  assert.equal(state.closeCount, 1);
  const dropQueryIndex = state.queries.findIndex(
    ({ sql }) => sql.startsWith("drop database")
  );
  assert.notEqual(dropQueryIndex, -1);
  assert.equal(
    state.queries[dropQueryIndex].sql,
    `drop database "${DATABASE_NAME}"`
  );
  const sessionProofEvent = state.events.findIndex(
    (event) => event.includes("from pg_stat_activity")
  );
  const dropEvent = state.events.findIndex(
    (event) => event.startsWith("query:drop database")
  );
  const npmEvent = state.events.indexOf(
    "command:candidate-test"
  );
  assert.ok(sessionProofEvent < dropEvent);
  assert.ok(dropEvent < npmEvent);
  assert.equal(state.errors.length, 0);
});

test("release refuses a non-PostgreSQL-16 server before creating a database", async () => {
  const { ports, state } = createHarness({
    postgresVersionNumber: 150013
  });
  await assert.rejects(
    runCoreRelease({
      environment: BASE_ENVIRONMENT,
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code === "CORE_RELEASE_POSTGRES_MAJOR_UNSUPPORTED"
  );
  assert.equal(state.createCount, 0);
  assert.equal(state.dropCount, 0);
  assert.equal(state.commands.length, 0);
  assert.equal(state.closeCount, 1);
});

test("a pre-existing exact name is never created, dropped, or tested", async () => {
  const { ports, state } = createHarness({
    databaseExists: true
  });
  await assert.rejects(
    runCoreRelease({
      environment: BASE_ENVIRONMENT,
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code === "CORE_RELEASE_DATABASE_EXISTS"
  );
  assert.equal(state.createCount, 0);
  assert.equal(state.dropCount, 0);
  assert.equal(state.commands.length, 0);
  assert.equal(state.databaseExists, true);
});

test("a PostgreSQL journey failure cleans only the proven exact target", async () => {
  const { ports, state } = createHarness({
    failCommandId: "custom-services-postgres"
  });
  await assert.rejects(
    runCoreRelease({
      environment: BASE_ENVIRONMENT,
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code === "CORE_RELEASE_SUBPROCESS_FAILED"
        && error.databaseName === DATABASE_NAME
        && error.databaseAbsent === true
  );
  assert.deepEqual(
    state.commands.map(({ id }) => id),
    ["migration-replay", "custom-services-postgres"]
  );
  assert.equal(state.createCount, 1);
  assert.equal(state.dropCount, 1);
  assert.equal(state.databaseExists, false);
  assert.equal(state.errors.length, 0);
});

test("cleanup refuses active sessions, reports failure, and never terminates them", async () => {
  const { ports, state } = createHarness({
    failCommandId: "migration-replay",
    sessionsDuringCleanup: 2
  });
  await assert.rejects(
    runCoreRelease({
      environment: BASE_ENVIRONMENT,
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code === "CORE_RELEASE_CLEANUP_FAILED" &&
      error.cleanupError?.code ===
        "CORE_RELEASE_DATABASE_IN_USE" &&
      error.databaseAbsent === false
  );
  assert.equal(state.dropCount, 0);
  assert.equal(state.databaseExists, true);
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /left in place/u);
  assert.doesNotMatch(state.errors[0], /do-not-print/u);
  assert.equal(
    state.queries.some(({ sql }) =>
      sql.includes("pg_terminate_backend")
    ),
    false
  );
});

test("missing admin URL fails before opening a database or running tests", async () => {
  const { ports, state } = createHarness();
  await assert.rejects(
    runCoreRelease({
      environment: {},
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code === "CORE_RELEASE_ENV_REQUIRED"
  );
  assert.equal(state.queries.length, 0);
  assert.equal(state.commands.length, 0);
});

test("an explicitly blank target name fails instead of silently generating one", async () => {
  const { ports, state } = createHarness();
  await assert.rejects(
    runCoreRelease({
      environment: {
        ...BASE_ENVIRONMENT,
        [CORE_RELEASE_DATABASE_NAME_ENV]: "   "
      },
      nodeExecutable: "/unit/node-24",
      ports,
      projectRoot: "/unit/project"
    }),
    (error) =>
      error.code ===
        "CORE_RELEASE_DATABASE_NAME_INVALID"
  );
  assert.equal(state.queries.length, 0);
  assert.equal(state.commands.length, 0);
});
