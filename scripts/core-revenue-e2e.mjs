import "../server/hosted/assert-runtime.mjs";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";

import pg from "pg";

const { Client } = pg;

export const CORE_REVENUE_ADMIN_URL_ENV =
  "SITESOURCERY_PG_CORE_REVENUE_ADMIN_URL";
export const CORE_REVENUE_DATABASE_NAME_ENV =
  "SITESOURCERY_PG_CORE_REVENUE_DATABASE_NAME";
const SERVICE_TEST_URL_ENV =
  "SITESOURCERY_PG_SERVICE_TEST_URL";
const DATABASE_PREFIX = "ss_core_revenue_e2e_";
const DATABASE_NAME_PATTERN =
  /^ss_core_revenue_e2e_[a-z0-9](?:[a-z0-9_]{6,34}[a-z0-9])$/u;
const EXPECTED_POSTGRES_MAJOR = 16;
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const JOURNEY_PATTERN =
  "canonical PostgreSQL service completes the owned customer path|" +
  "CORE-REVENUE-E2E-01|" +
  "ambiguous Checkout creation is terminal";

export class CoreRevenueProofError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "CoreRevenueProofError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new CoreRevenueProofError(code, message, options);
}

export function validateCoreRevenueDatabaseName(name) {
  if (
    typeof name !== "string" ||
    !DATABASE_NAME_PATTERN.test(name) ||
    Buffer.byteLength(name, "utf8") > 63
  ) {
    fail(
      "CORE_REVENUE_DATABASE_NAME_INVALID",
      "The disposable proof database name is invalid."
    );
  }
  return name;
}

export function generateCoreRevenueDatabaseName({
  now = () => new Date(),
  uuid = randomUUID
} = {}) {
  const instant = now();
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    fail("CORE_REVENUE_CLOCK_INVALID", "The proof clock is invalid.");
  }
  const nonce = uuid().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(nonce)) {
    fail("CORE_REVENUE_NONCE_INVALID", "The proof nonce is invalid.");
  }
  const timestamp = instant.toISOString()
    .replace(/[-:.]/gu, "")
    .replace("Z", "z")
    .toLowerCase();
  return validateCoreRevenueDatabaseName(
    `${DATABASE_PREFIX}${timestamp}_${nonce.slice(0, 10)}`
  );
}

export function parseLocalAdminUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(
      "CORE_REVENUE_ADMIN_URL_INVALID",
      `${CORE_REVENUE_ADMIN_URL_ENV} must be a local PostgreSQL URL.`
    );
  }
  let baseDatabase;
  try {
    baseDatabase = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    fail(
      "CORE_REVENUE_ADMIN_URL_INVALID",
      `${CORE_REVENUE_ADMIN_URL_ENV} has an invalid database path.`
    );
  }
  const localHosts = new Set(["", "localhost", "127.0.0.1", "[::1]"]);
  const parameterNames = [...new Set(parsed.searchParams.keys())];
  const queryHosts = parsed.searchParams.getAll("host");
  const queryPorts = parsed.searchParams.getAll("port");
  const queryHostIsLocal = queryHosts.length === 0 ||
    (
      queryHosts.length === 1 &&
      (
        queryHosts[0].startsWith("/") ||
        localHosts.has(queryHosts[0])
      )
    );
  const queryPortIsValid = queryPorts.length === 0 ||
    (
      queryPorts.length === 1 &&
      /^[0-9]{1,5}$/u.test(queryPorts[0]) &&
      Number(queryPorts[0]) >= 1 &&
      Number(queryPorts[0]) <= 65535
    );
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !localHosts.has(parsed.hostname) ||
    parameterNames.some((name) => !["host", "port"].includes(name)) ||
    !queryHostIsLocal ||
    !queryPortIsValid ||
    parsed.hash ||
    !baseDatabase ||
    baseDatabase.includes("/") ||
    baseDatabase.includes("\0")
  ) {
    fail(
      "CORE_REVENUE_ADMIN_URL_INVALID",
      `${CORE_REVENUE_ADMIN_URL_ENV} must name one local PostgreSQL admin database.`
    );
  }
  return Object.freeze({
    baseDatabase,
    connectionString: value,
    parsed
  });
}

function targetUrl(admin, databaseName) {
  const selected = new URL(admin.parsed.href);
  selected.pathname = `/${databaseName}`;
  return selected.href;
}

export function sanitizedProofEnvironment(
  environment,
  targetDatabaseUrl
) {
  const selected = { ...environment };
  for (const name of Object.keys(selected)) {
    const upper = name.toUpperCase();
    if (
      name === CORE_REVENUE_ADMIN_URL_ENV ||
      name === CORE_REVENUE_DATABASE_NAME_ENV ||
      name === SERVICE_TEST_URL_ENV ||
      upper.startsWith("SITESOURCERY_PG_") ||
      upper.endsWith("DATABASE_URL") ||
      /STRIPE|RESEND|SPACESHIP|CLOUDFLARE|MAILGUN|SENDGRID|POSTMARK|SMTP|AWS_|S3_/u
        .test(upper)
    ) {
      delete selected[name];
    }
  }
  selected[SERVICE_TEST_URL_ENV] = targetDatabaseUrl;
  selected.SITESOURCERY_CORE_REVENUE_E2E_ONLY = "1";
  return selected;
}

export function buildCoreRevenueCommand({
  environment,
  nodeExecutable,
  projectRoot = PROJECT_ROOT,
  targetDatabaseUrl
}) {
  const specification = Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([
      "--experimental-websocket",
      "--test",
      "--test-concurrency=1",
      `--test-name-pattern=${JOURNEY_PATTERN}`,
      path.join(
        projectRoot,
        "server/hosted/test/postgres-service.integration.test.mjs"
      ),
      path.join(
        projectRoot,
        "server/commerce-v2/test/payment.test.mjs"
      )
    ]),
    cwd: projectRoot,
    environment: Object.freeze(
      sanitizedProofEnvironment(environment, targetDatabaseUrl)
    )
  });
  if (
    [specification.command, ...specification.args].some((value) =>
      value.includes(targetDatabaseUrl)
    )
  ) {
    fail(
      "CORE_REVENUE_SECRET_IN_ARGV",
      "The proof database URL must not appear in subprocess arguments."
    );
  }
  return specification;
}

function quoteIdentifier(name) {
  return `"${validateCoreRevenueDatabaseName(name)}"`;
}

export function createCoreRevenuePorts() {
  return Object.freeze({
    now: () => new Date(),
    uuid: randomUUID,
    async connectAdmin({ connectionString }) {
      const client = new Client({ connectionString });
      await client.connect();
      return Object.freeze({
        query: client.query.bind(client),
        close: client.end.bind(client)
      });
    },
    runCommand(specification) {
      return new Promise((resolve, reject) => {
        const child = spawn(
          specification.command,
          specification.args,
          {
            cwd: specification.cwd,
            env: specification.environment,
            stdio: ["ignore", "inherit", "inherit"]
          }
        );
        child.once("error", reject);
        child.once("exit", (exitCode, signal) => {
          resolve({ exitCode, signal });
        });
      });
    },
    writeStatus(message) {
      process.stderr.write(`${message}\n`);
    }
  });
}

async function databaseExists(admin, databaseName) {
  const result = await admin.query(
    `select exists (
       select 1 from pg_database where datname = $1
     ) as exists`,
    [databaseName]
  );
  return result.rows[0]?.exists === true;
}

async function removeExactDatabase(admin, databaseName) {
  if (!(await databaseExists(admin, databaseName))) return;
  const sessions = await admin.query(
    `select count(*)::integer as session_count
       from pg_stat_activity where datname = $1`,
    [databaseName]
  );
  const sessionCount = Number(sessions.rows[0]?.session_count);
  if (sessionCount !== 0) {
    fail(
      "CORE_REVENUE_DATABASE_IN_USE",
      `The disposable proof database has ${sessionCount} active session(s); ` +
        "none were terminated and the database was left in place."
    );
  }
  await admin.query(`drop database ${quoteIdentifier(databaseName)}`);
  if (await databaseExists(admin, databaseName)) {
    fail(
      "CORE_REVENUE_DATABASE_DROP_UNPROVEN",
      "The disposable proof database still exists after cleanup."
    );
  }
}

export async function runCoreRevenueProof({
  environment = process.env,
  nodeExecutable = process.execPath,
  ports = createCoreRevenuePorts(),
  projectRoot = PROJECT_ROOT
} = {}) {
  const adminValue = environment[CORE_REVENUE_ADMIN_URL_ENV];
  if (typeof adminValue !== "string" || adminValue.trim() === "") {
    fail(
      "CORE_REVENUE_ENV_REQUIRED",
      `${CORE_REVENUE_ADMIN_URL_ENV} is required.`
    );
  }
  const adminConfig = parseLocalAdminUrl(adminValue.trim());
  const requestedName = environment[CORE_REVENUE_DATABASE_NAME_ENV];
  const databaseName = requestedName === undefined
    ? generateCoreRevenueDatabaseName({
        now: ports.now,
        uuid: ports.uuid
      })
    : validateCoreRevenueDatabaseName(String(requestedName).trim());
  if (databaseName === adminConfig.baseDatabase) {
    fail(
      "CORE_REVENUE_ADMIN_TARGET_COLLISION",
      "The admin and disposable proof databases must differ."
    );
  }
  const targetDatabaseUrl = targetUrl(adminConfig, databaseName);
  const command = buildCoreRevenueCommand({
    environment,
    nodeExecutable,
    projectRoot,
    targetDatabaseUrl
  });

  let admin;
  let created = false;
  let removed = false;
  try {
    admin = await ports.connectAdmin({
      connectionString: adminConfig.connectionString
    });
    const identity = await admin.query(
      `select current_database() as database_name,
              current_setting('server_version_num')::integer
                as server_version_num`
    );
    if (identity.rows[0]?.database_name !== adminConfig.baseDatabase) {
      fail(
        "CORE_REVENUE_ADMIN_DATABASE_MISMATCH",
        "The PostgreSQL connection did not reach the named admin database."
      );
    }
    const version = Number(identity.rows[0]?.server_version_num);
    if (Math.floor(version / 10000) !== EXPECTED_POSTGRES_MAJOR) {
      fail(
        "CORE_REVENUE_POSTGRES_MAJOR_UNSUPPORTED",
        `The proof requires PostgreSQL ${EXPECTED_POSTGRES_MAJOR}.`
      );
    }
    if (await databaseExists(admin, databaseName)) {
      fail(
        "CORE_REVENUE_DATABASE_EXISTS",
        "The exact disposable proof database already exists; it was not changed."
      );
    }

    ports.writeStatus(`Creating disposable proof database ${databaseName}...`);
    await admin.query(
      `create database ${quoteIdentifier(databaseName)} template template0`
    );
    created = true;
    if (!(await databaseExists(admin, databaseName))) {
      fail(
        "CORE_REVENUE_DATABASE_CREATE_UNPROVEN",
        "PostgreSQL did not prove creation of the disposable database."
      );
    }

    ports.writeStatus("Running CORE-REVENUE-E2E-01 with local fake effects...");
    const result = await ports.runCommand(command);
    if (result?.exitCode !== 0) {
      fail(
        "CORE_REVENUE_SUBPROCESS_FAILED",
        "CORE-REVENUE-E2E-01 failed."
      );
    }

    ports.writeStatus(`Removing disposable proof database ${databaseName}...`);
    await removeExactDatabase(admin, databaseName);
    removed = true;
    return Object.freeze({
      ok: true,
      databaseAbsent: true,
      databaseName,
      postgresMajor: EXPECTED_POSTGRES_MAJOR,
      providerEffects: false,
      journey: "CORE-REVENUE-E2E-01"
    });
  } catch (error) {
    if (admin && created && !removed) {
      try {
        await removeExactDatabase(admin, databaseName);
        removed = true;
      } catch (cleanupError) {
        const combined = new CoreRevenueProofError(
          "CORE_REVENUE_CLEANUP_FAILED",
          `Proof failed and ${databaseName} could not be removed.`,
          { cause: error }
        );
        combined.cleanupError = cleanupError;
        combined.databaseName = databaseName;
        combined.databaseAbsent = false;
        throw combined;
      }
    }
    if (error && typeof error === "object" && Object.isExtensible(error)) {
      error.databaseName = databaseName;
      error.databaseAbsent = created ? removed : null;
    }
    throw error;
  } finally {
    await admin?.close().catch(() => {});
  }
}

async function main() {
  const result = await runCoreRevenueProof();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error.code ?? error.name ?? "CORE_REVENUE_ERROR"}: ` +
        `${error.message}\n`
    );
    if (error.databaseName) {
      process.stderr.write(
        `database=${error.databaseName} ` +
          `absent=${String(error.databaseAbsent)}\n`
      );
    }
    process.exitCode = 1;
  });
}
