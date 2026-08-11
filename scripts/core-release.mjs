import "../server/domain/assert-runtime.mjs";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";

import pg from "pg";

import {
  collectOriginMigrationInventory
} from "../ops/origin-seal-repository.mjs";
import {
  resolveMigrationVerificationInventory
} from "../server/data-plane/tests/migration-verification-inventory.mjs";

const { Client } = pg;

export const CORE_RELEASE_ADMIN_URL_ENV =
  "SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL";
export const CORE_RELEASE_DATABASE_NAME_ENV =
  "SITESOURCERY_PG_CORE_RELEASE_DATABASE_NAME";
export const CORE_RELEASE_CUSTOM_SERVICES_JOURNEY_COUNT = 4;
export const CORE_RELEASE_ALAKAZAM_CORE_JOURNEY_COUNT = 5;
export const CORE_RELEASE_ALAKAZAM_LIFECYCLE_JOURNEY_COUNT = 10;
export const CORE_RELEASE_ALAKAZAM_BILLING_JOURNEY_COUNT = 3;

const MIGRATION_TEST_URL_ENV =
  "SITESOURCERY_PG_MIGRATION_TEST_URL";
const CUSTOM_SERVICES_TEST_URL_ENV =
  "SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL";
const CUSTOM_SERVICE_QUOTES_TEST_URL_ENV =
  "SITESOURCERY_PG_CUSTOM_SERVICE_QUOTES_TEST_URL";
const ALAKAZAM_CORE_TEST_URL_ENV =
  "SITESOURCERY_PG_ALAKAZAM_TEST_URL";
const ALAKAZAM_LIFECYCLE_TEST_URL_ENV =
  "SITESOURCERY_PG_ALAKAZAM_LIFECYCLE_TEST_URL";
const ALAKAZAM_BILLING_TEST_URL_ENV =
  "SITESOURCERY_PG_ALAKAZAM_BILLING_TEST_URL";
const EXPECTED_POSTGRES_MAJOR = 16;
const CORE_RELEASE_MIGRATION_ROOT =
  "server/data-plane/supabase/migrations";
const DATABASE_PREFIX = "ss_core_release_";
const DATABASE_NAME_PATTERN =
  /^ss_core_release_[a-z0-9](?:[a-z0-9_]{6,45}[a-z0-9])$/u;
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

export class CoreReleaseError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CoreReleaseError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new CoreReleaseError(code, message, options);
}

export async function resolveCoreReleaseMigrationAuthority({
  projectRoot = PROJECT_ROOT
} = {}) {
  try {
    const inventory = await collectOriginMigrationInventory({
      projectRoot,
      migrationRoot: CORE_RELEASE_MIGRATION_ROOT
    });
    const prefix = `${CORE_RELEASE_MIGRATION_ROOT}/`;
    const files = inventory.files.map((entry) => {
      if (
        !entry.path.startsWith(prefix) ||
        entry.path.slice(prefix.length).includes("/")
      ) {
        throw new Error("Core release migration path escaped its exact root.");
      }
      return Object.freeze({
        name: entry.path.slice(prefix.length),
        byteCount: entry.byteCount,
        sha256: entry.sha256
      });
    });
    const names = files.map((entry) => entry.name);
    resolveMigrationVerificationInventory(names);
    if (
      inventory.root !== CORE_RELEASE_MIGRATION_ROOT ||
      inventory.domain !== "origin-migrations" ||
      inventory.count !== files.length ||
      inventory.fileCount !== files.length ||
      inventory.latest !== names.at(-1) ||
      !/^[a-f0-9]{64}$/u.test(inventory.sha256)
    ) {
      throw new Error(
        "Core release migration inventory is internally inconsistent."
      );
    }
    return Object.freeze({
      schema: "sitesourcery.core-release-migration-authority/v1",
      root: CORE_RELEASE_MIGRATION_ROOT,
      count: inventory.count,
      latest: inventory.latest,
      files: Object.freeze(files),
      manifestSha256: inventory.sha256
    });
  } catch (cause) {
    fail(
      "CORE_RELEASE_MIGRATION_AUTHORITY_INVALID",
      "Core release requires the exact reviewed ordered migration inventory.",
      { cause }
    );
  }
}

function requiredEnvironmentValue(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(
      "CORE_RELEASE_ENV_REQUIRED",
      `${name} is required.`
    );
  }
  return value.trim();
}

export function validateCoreReleaseDatabaseName(name) {
  if (
    typeof name !== "string" ||
    !DATABASE_NAME_PATTERN.test(name) ||
    Buffer.byteLength(name, "utf8") > 63
  ) {
    fail(
      "CORE_RELEASE_DATABASE_NAME_INVALID",
      "The Core release database name must begin with " +
        `${DATABASE_PREFIX}, contain only lowercase letters, digits, and ` +
        "underscores, have a substantial unique suffix, and fit in a " +
        "PostgreSQL identifier."
    );
  }
  return name;
}

export function generateCoreReleaseDatabaseName({
  now = () => new Date(),
  uuid = randomUUID
} = {}) {
  const instant = now();
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    fail(
      "CORE_RELEASE_CLOCK_INVALID",
      "The Core release clock did not return a valid Date."
    );
  }
  const timestamp = instant
    .toISOString()
    .replace(/[-:.]/gu, "")
    .replace("Z", "z")
    .toLowerCase();
  const nonce = uuid().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(nonce)) {
    fail(
      "CORE_RELEASE_NONCE_INVALID",
      "The Core release nonce source did not return a UUID."
    );
  }
  return validateCoreReleaseDatabaseName(
    `${DATABASE_PREFIX}${timestamp}_${nonce.slice(0, 12)}`
  );
}

export function parseCoreReleaseAdminUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(
      "CORE_RELEASE_ADMIN_URL_INVALID",
      `${CORE_RELEASE_ADMIN_URL_ENV} must be a PostgreSQL URL.`
    );
  }
  if (
    parsed.protocol !== "postgresql:" &&
    parsed.protocol !== "postgres:"
  ) {
    fail(
      "CORE_RELEASE_ADMIN_URL_INVALID",
      `${CORE_RELEASE_ADMIN_URL_ENV} must use postgres:// or postgresql://.`
    );
  }
  if (parsed.hash.length > 0) {
    fail(
      "CORE_RELEASE_ADMIN_URL_INVALID",
      `${CORE_RELEASE_ADMIN_URL_ENV} must not contain a fragment.`
    );
  }
  let baseDatabase;
  try {
    baseDatabase = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    fail(
      "CORE_RELEASE_ADMIN_URL_INVALID",
      `${CORE_RELEASE_ADMIN_URL_ENV} has an invalid database path.`
    );
  }
  if (
    baseDatabase.length === 0 ||
    baseDatabase.includes("/") ||
    baseDatabase.includes("\0")
  ) {
    fail(
      "CORE_RELEASE_ADMIN_URL_INVALID",
      `${CORE_RELEASE_ADMIN_URL_ENV} must name one explicit admin/base database.`
    );
  }
  return Object.freeze({
    connectionString: value,
    baseDatabase,
    parsed
  });
}

export function buildTargetDatabaseUrl(adminUrl, databaseName) {
  const admin = parseCoreReleaseAdminUrl(adminUrl);
  const targetName = validateCoreReleaseDatabaseName(databaseName);
  if (admin.baseDatabase === targetName) {
    fail(
      "CORE_RELEASE_ADMIN_TARGET_COLLISION",
      "The admin/base database must differ from the disposable target."
    );
  }
  const target = new URL(admin.parsed.href);
  target.pathname = `/${targetName}`;
  return target.href;
}

function withoutDatabaseSecrets(environment) {
  const sanitized = { ...environment };
  delete sanitized[CORE_RELEASE_ADMIN_URL_ENV];
  delete sanitized[CORE_RELEASE_DATABASE_NAME_ENV];
  delete sanitized[MIGRATION_TEST_URL_ENV];
  delete sanitized[CUSTOM_SERVICES_TEST_URL_ENV];
  delete sanitized[CUSTOM_SERVICE_QUOTES_TEST_URL_ENV];
  delete sanitized[ALAKAZAM_CORE_TEST_URL_ENV];
  return sanitized;
}

export function buildCoreReleaseCommands({
  environment,
  nodeExecutable,
  projectRoot = PROJECT_ROOT,
  targetDatabaseUrl
}) {
  if (
    typeof nodeExecutable !== "string" ||
    nodeExecutable.length === 0
  ) {
    fail(
      "CORE_RELEASE_NODE_INVALID",
      "The current Node executable is required."
    );
  }
  if (
    typeof targetDatabaseUrl !== "string" ||
    targetDatabaseUrl.length === 0
  ) {
    fail(
      "CORE_RELEASE_TARGET_URL_INVALID",
      "The disposable target database URL is required."
    );
  }
  const cleanEnvironment = withoutDatabaseSecrets(environment);
  const migrationEnvironment = {
    ...cleanEnvironment,
    [MIGRATION_TEST_URL_ENV]: targetDatabaseUrl
  };
  const customServicesEnvironment = {
    ...cleanEnvironment,
    [CUSTOM_SERVICES_TEST_URL_ENV]: targetDatabaseUrl,
    [CUSTOM_SERVICE_QUOTES_TEST_URL_ENV]: targetDatabaseUrl,
    [ALAKAZAM_CORE_TEST_URL_ENV]: targetDatabaseUrl,
    [ALAKAZAM_LIFECYCLE_TEST_URL_ENV]: targetDatabaseUrl,
    [ALAKAZAM_BILLING_TEST_URL_ENV]: targetDatabaseUrl
  };
  const npmExecPath =
    typeof cleanEnvironment.npm_execpath === "string" &&
      path.isAbsolute(cleanEnvironment.npm_execpath)
      ? cleanEnvironment.npm_execpath
      : null;
  const candidateEnvironment = {
    ...cleanEnvironment,
    PATH: [
      path.dirname(nodeExecutable),
      cleanEnvironment.PATH
    ].filter((value) =>
      typeof value === "string" && value.length > 0
    ).join(path.delimiter)
  };
  return Object.freeze([
    Object.freeze({
      id: "migration-replay",
      label: "Fresh PostgreSQL migration replay",
      command: nodeExecutable,
      args: Object.freeze([
        path.join(
          projectRoot,
          "server/data-plane/tests/verify-empty-postgres-migrations.mjs"
        )
      ]),
      cwd: projectRoot,
      environment: Object.freeze(migrationEnvironment)
    }),
    Object.freeze({
      id: "custom-services-postgres",
      label: "Launch-critical and held Alakazam PostgreSQL journeys",
      command: nodeExecutable,
      args: Object.freeze([
        "--test",
        "--test-concurrency=1",
        path.join(
          projectRoot,
          "server/data-plane/tests/custom-services-foundation-postgres.integration.test.mjs"
        ),
        path.join(
          projectRoot,
          "server/data-plane/tests/custom-service-quotes-postgres.integration.test.mjs"
        ),
        path.join(
          projectRoot,
          "server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs"
        ),
        path.join(
          projectRoot,
          "server/data-plane/tests/alakazam-lifecycle-postgres.integration.test.mjs"
        ),
        path.join(
          projectRoot,
          "server/hosted/test/alakazam-billing-postgres.integration.test.mjs"
        )
      ]),
      cwd: projectRoot,
      environment: Object.freeze(customServicesEnvironment)
    }),
    Object.freeze({
      id: "candidate-test",
      label: "Existing candidate npm test",
      command: npmExecPath
        ? nodeExecutable
        : process.platform === "win32"
          ? "npm.cmd"
          : "npm",
      args: Object.freeze(
        npmExecPath
          ? [npmExecPath, "test"]
          : ["test"]
      ),
      cwd: projectRoot,
      environment: Object.freeze(candidateEnvironment)
    })
  ]);
}

function createCommandRunner(spawnImpl = spawn) {
  return Object.freeze({
    run(specification) {
      return new Promise((resolve, reject) => {
        const child = spawnImpl(
          specification.command,
          specification.args,
          {
            cwd: specification.cwd,
            env: specification.environment,
            stdio: ["ignore", "inherit", "inherit"]
          }
        );
        child.once("error", () => {
          reject(
            new CoreReleaseError(
              "CORE_RELEASE_SUBPROCESS_UNAVAILABLE",
              `${specification.label} could not start.`
            )
          );
        });
        child.once("close", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      });
    }
  });
}

export function createCoreReleasePorts({
  ClientImpl = Client,
  spawnImpl = spawn,
  now = () => new Date(),
  uuid = randomUUID,
  writeStatus = (message) => process.stdout.write(`${message}\n`),
  writeError = (message) => process.stderr.write(`${message}\n`)
} = {}) {
  const commandRunner = createCommandRunner(spawnImpl);
  return Object.freeze({
    now,
    uuid,
    async connectAdmin({ connectionString }) {
      const client = new ClientImpl({
        connectionString,
        application_name: "sitesourcery-core-release"
      });
      await client.connect();
      return Object.freeze({
        query: client.query.bind(client),
        close: client.end.bind(client)
      });
    },
    runCommand: commandRunner.run,
    writeStatus,
    writeError
  });
}

function quoteIdentifier(identifier) {
  validateCoreReleaseDatabaseName(identifier);
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function databaseExists(admin, databaseName) {
  const result = await admin.query(
    `select exists (
       select 1
       from pg_database
       where datname = $1
     ) as exists`,
    [databaseName]
  );
  return result.rows[0]?.exists === true;
}

async function countTargetSessions(admin, databaseName) {
  const result = await admin.query(
    `select count(*)::integer as session_count
     from pg_stat_activity
     where datname = $1`,
    [databaseName]
  );
  const count = Number(result.rows[0]?.session_count);
  if (!Number.isSafeInteger(count) || count < 0) {
    fail(
      "CORE_RELEASE_SESSION_PROOF_INVALID",
      "PostgreSQL returned an invalid target-session count."
    );
  }
  return count;
}

async function assertConnectedToBase(admin, expectedDatabase) {
  const result = await admin.query(
    `select
       current_database() as database_name,
       current_setting('server_version_num')::integer as server_version_num`
  );
  if (result.rows[0]?.database_name !== expectedDatabase) {
    fail(
      "CORE_RELEASE_ADMIN_DATABASE_MISMATCH",
      "The PostgreSQL connection did not reach the explicit admin/base database."
    );
  }
  const versionNumber = Number(
    result.rows[0]?.server_version_num
  );
  if (
    !Number.isSafeInteger(versionNumber)
    || versionNumber <= 0
  ) {
    fail(
      "CORE_RELEASE_POSTGRES_VERSION_INVALID",
      "PostgreSQL returned an invalid server version."
    );
  }
  if (
    Math.floor(versionNumber / 10000)
      !== EXPECTED_POSTGRES_MAJOR
  ) {
    fail(
      "CORE_RELEASE_POSTGRES_MAJOR_UNSUPPORTED",
      `Core release requires PostgreSQL ${EXPECTED_POSTGRES_MAJOR}.`
    );
  }
  return Object.freeze({
    major: EXPECTED_POSTGRES_MAJOR,
    serverVersionNumber: versionNumber
  });
}

async function removeExactDatabase({
  admin,
  databaseName
}) {
  validateCoreReleaseDatabaseName(databaseName);
  if (!(await databaseExists(admin, databaseName))) {
    return Object.freeze({ alreadyAbsent: true });
  }
  const sessionCount = await countTargetSessions(
    admin,
    databaseName
  );
  if (sessionCount !== 0) {
    fail(
      "CORE_RELEASE_DATABASE_IN_USE",
      `The exact disposable database has ${sessionCount} active ` +
        "session(s); no sessions were terminated and the database was not dropped."
    );
  }
  await admin.query(
    `drop database ${quoteIdentifier(databaseName)}`
  );
  if (await databaseExists(admin, databaseName)) {
    fail(
      "CORE_RELEASE_DATABASE_DROP_UNPROVEN",
      "The exact disposable database still exists after DROP DATABASE."
    );
  }
  return Object.freeze({ alreadyAbsent: false });
}

async function runRequiredCommand(ports, specification) {
  ports.writeStatus(`${specification.label}...`);
  const result = await ports.runCommand(specification);
  if (result?.exitCode !== 0) {
    fail(
      "CORE_RELEASE_SUBPROCESS_FAILED",
      `${specification.label} failed.`
    );
  }
}

function resolveConfiguration({
  environment,
  ports
}) {
  const adminUrl = requiredEnvironmentValue(
    environment,
    CORE_RELEASE_ADMIN_URL_ENV
  );
  const admin = parseCoreReleaseAdminUrl(adminUrl);
  const requestedName =
    environment?.[CORE_RELEASE_DATABASE_NAME_ENV];
  const databaseName =
    Object.prototype.hasOwnProperty.call(
      environment ?? {},
      CORE_RELEASE_DATABASE_NAME_ENV
    )
      ? validateCoreReleaseDatabaseName(
          typeof requestedName === "string"
            ? requestedName.trim()
            : requestedName
        )
      : generateCoreReleaseDatabaseName({
          now: ports.now,
          uuid: ports.uuid
        });
  const targetDatabaseUrl = buildTargetDatabaseUrl(
    adminUrl,
    databaseName
  );
  return Object.freeze({
    adminUrl,
    baseDatabase: admin.baseDatabase,
    databaseName,
    targetDatabaseUrl
  });
}

function cleanupFailure(primaryError, cleanupError, databaseName) {
  const failure = new CoreReleaseError(
    "CORE_RELEASE_CLEANUP_FAILED",
    `Core release failed and cleanup of ${databaseName} also failed.`,
    { cause: primaryError }
  );
  failure.cleanupError = cleanupError;
  failure.databaseName = databaseName;
  failure.databaseAbsent = false;
  return failure;
}

export async function runCoreRelease({
  environment = process.env,
  nodeExecutable = process.execPath,
  ports = createCoreReleasePorts(),
  projectRoot = PROJECT_ROOT
} = {}) {
  const configuration = resolveConfiguration({
    environment,
    ports
  });
  const migrationAuthority =
    await resolveCoreReleaseMigrationAuthority({ projectRoot });
  const commands = buildCoreReleaseCommands({
    environment,
    nodeExecutable,
    projectRoot,
    targetDatabaseUrl:
      configuration.targetDatabaseUrl
  });
  const secretValues = [
    configuration.adminUrl,
    configuration.targetDatabaseUrl
  ];
  for (const specification of commands) {
    const argv = [
      specification.command,
      ...specification.args
    ];
    if (
      argv.some((argument) =>
        secretValues.some((secret) =>
          argument.includes(secret)
        )
      )
    ) {
      fail(
        "CORE_RELEASE_SECRET_IN_ARGV",
        "A PostgreSQL URL was placed in subprocess argv."
      );
    }
  }

  let admin;
  let createdByThisRun = false;
  let removed = false;
  try {
    admin = await ports.connectAdmin({
      connectionString: configuration.adminUrl
    });
    const postgresIdentity = await assertConnectedToBase(
      admin,
      configuration.baseDatabase
    );
    if (
      await databaseExists(
        admin,
        configuration.databaseName
      )
    ) {
      fail(
        "CORE_RELEASE_DATABASE_EXISTS",
        "The exact disposable database already exists; it was not changed."
      );
    }

    ports.writeStatus(
      `Creating ${configuration.databaseName}...`
    );
    await admin.query(
      `create database ${quoteIdentifier(
        configuration.databaseName
      )} template template0`
    );
    createdByThisRun = true;
    if (
      !(await databaseExists(
        admin,
        configuration.databaseName
      ))
    ) {
      fail(
        "CORE_RELEASE_DATABASE_CREATE_UNPROVEN",
        "PostgreSQL did not prove creation of the exact disposable database."
      );
    }

    await runRequiredCommand(ports, commands[0]);
    await runRequiredCommand(ports, commands[1]);

    ports.writeStatus(
      `Removing ${configuration.databaseName}...`
    );
    await removeExactDatabase({
      admin,
      databaseName: configuration.databaseName
    });
    removed = true;

    await runRequiredCommand(ports, commands[2]);
    return Object.freeze({
      ok: true,
      databaseName: configuration.databaseName,
      postgresMajor: postgresIdentity.major,
      migrationsApplied: migrationAuthority.count,
      migrationAuthority,
      customServicesJourneys:
        CORE_RELEASE_CUSTOM_SERVICES_JOURNEY_COUNT,
      alakazamCoreJourneys:
        CORE_RELEASE_ALAKAZAM_CORE_JOURNEY_COUNT,
      alakazamLifecycleJourneys:
        CORE_RELEASE_ALAKAZAM_LIFECYCLE_JOURNEY_COUNT,
      alakazamBillingJourneys:
        CORE_RELEASE_ALAKAZAM_BILLING_JOURNEY_COUNT,
      databaseAbsent: true
    });
  } catch (primaryError) {
    if (
      admin &&
      createdByThisRun &&
      !removed
    ) {
      try {
        await removeExactDatabase({
          admin,
          databaseName: configuration.databaseName
        });
        removed = true;
      } catch (cleanupError) {
        ports.writeError(
          `Cleanup failed for exact disposable database ` +
            `${configuration.databaseName}; it was left in place. ` +
            "No sessions were terminated."
        );
        throw cleanupFailure(
          primaryError,
          cleanupError,
          configuration.databaseName
        );
      }
    }
    if (
      primaryError
      && typeof primaryError === "object"
      && Object.isExtensible(primaryError)
    ) {
      primaryError.databaseName = configuration.databaseName;
      primaryError.databaseAbsent = createdByThisRun
        ? removed
        : null;
    }
    throw primaryError;
  } finally {
    await admin?.close().catch(() => {});
  }
}

async function main() {
  const result = await runCoreRelease();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      databaseName: result.databaseName,
      postgresMajor: result.postgresMajor,
      migrationsApplied: result.migrationsApplied,
      migrationAuthority: result.migrationAuthority,
      customServicesJourneys:
        result.customServicesJourneys,
      alakazamCoreJourneys:
        result.alakazamCoreJourneys,
      alakazamLifecycleJourneys:
        result.alakazamLifecycleJourneys,
      alakazamBillingJourneys:
        result.alakazamBillingJourneys,
      databaseAbsent: result.databaseAbsent
    })}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code:
          typeof error?.code === "string"
            ? error.code
            : "CORE_RELEASE_FAILED",
        databaseName:
          typeof error?.databaseName === "string"
            ? error.databaseName
            : null,
        databaseAbsent:
          typeof error?.databaseAbsent === "boolean"
            ? error.databaseAbsent
            : null
      })}\n`
    );
    process.exitCode = 1;
  });
}
