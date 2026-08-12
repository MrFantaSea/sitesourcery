import "../server/hosted/assert-runtime.mjs";

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import { createSafeCommandRunner } from "../ops/backup-ports.mjs";
import {
  runMigrationVerification
} from "../server/data-plane/tests/verify-empty-postgres-migrations.mjs";
import {
  readMailDeliveryBackupIdentity,
  runMailDeliveryE2EJourney
} from "./mail-delivery-e2e-fixture.mjs";

const { Client, Pool } = pg;
export const MAIL_DELIVERY_ADMIN_URL_ENV =
  "SITESOURCERY_PG_MAIL_DELIVERY_ADMIN_URL";
export const MAIL_DELIVERY_DATABASE_NAME_ENV =
  "SITESOURCERY_PG_MAIL_DELIVERY_DATABASE_NAME";
const DATABASE_PREFIX = "ss_mail_delivery_e2e_";
const DATABASE_NAME_PATTERN =
  /^ss_mail_delivery_e2e_[a-z0-9](?:[a-z0-9_]{8,34}[a-z0-9])$/u;
const EXPECTED_POSTGRES_MAJOR = 16;

export class MailDeliveryProofError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "MailDeliveryProofError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new MailDeliveryProofError(code, message, options);
}

export function validateMailDeliveryDatabaseName(name) {
  if (
    typeof name !== "string" ||
    !DATABASE_NAME_PATTERN.test(name) ||
    Buffer.byteLength(name, "utf8") > 55
  ) {
    fail(
      "MAIL_DELIVERY_DATABASE_NAME_INVALID",
      "The disposable mail proof database name is invalid."
    );
  }
  return name;
}

export function generateMailDeliveryDatabaseName({
  now = () => new Date(),
  uuid = randomUUID
} = {}) {
  const instant = now();
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    fail("MAIL_DELIVERY_CLOCK_INVALID", "The mail proof clock is invalid.");
  }
  const nonce = uuid().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/u.test(nonce)) {
    fail("MAIL_DELIVERY_NONCE_INVALID", "The mail proof nonce is invalid.");
  }
  const timestamp = instant.toISOString()
    .slice(0, 19)
    .replace(/[-:T]/gu, "")
    .toLowerCase();
  return validateMailDeliveryDatabaseName(
    `${DATABASE_PREFIX}${timestamp}_${nonce.slice(0, 8)}`
  );
}

export function parseLocalMailAdminUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(
      "MAIL_DELIVERY_ADMIN_URL_INVALID",
      `${MAIL_DELIVERY_ADMIN_URL_ENV} must be a local PostgreSQL URL.`
    );
  }
  let baseDatabase;
  try {
    baseDatabase = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    fail(
      "MAIL_DELIVERY_ADMIN_URL_INVALID",
      `${MAIL_DELIVERY_ADMIN_URL_ENV} has an invalid database path.`
    );
  }
  const localHosts = new Set(["", "localhost", "127.0.0.1", "[::1]"]);
  const names = [...new Set(parsed.searchParams.keys())];
  const hosts = parsed.searchParams.getAll("host");
  const ports = parsed.searchParams.getAll("port");
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !localHosts.has(parsed.hostname) ||
    names.some((name) => !["host", "port"].includes(name)) ||
    hosts.length > 1 ||
    (hosts.length === 1 &&
      !hosts[0].startsWith("/") && !localHosts.has(hosts[0])) ||
    ports.length > 1 ||
    (ports.length === 1 &&
      (!/^[0-9]{1,5}$/u.test(ports[0]) ||
        Number(ports[0]) < 1 || Number(ports[0]) > 65_535)) ||
    parsed.hash ||
    !baseDatabase ||
    baseDatabase.includes("/") ||
    baseDatabase.includes("\0")
  ) {
    fail(
      "MAIL_DELIVERY_ADMIN_URL_INVALID",
      `${MAIL_DELIVERY_ADMIN_URL_ENV} must name one local PostgreSQL admin database.`
    );
  }
  return Object.freeze({ baseDatabase, connectionString: value, parsed });
}

function targetUrl(admin, databaseName) {
  const selected = new URL(admin.parsed.href);
  selected.pathname = `/${databaseName}`;
  return selected.href;
}

function quoteIdentifier(name) {
  return `"${validateMailDeliveryDatabaseName(name)}"`;
}

function postgresEnvironment(environment, databaseUrl) {
  const selected = new URL(databaseUrl);
  const queryHost = selected.searchParams.get("host");
  const queryPort = selected.searchParams.get("port");
  const result = {
    PATH: environment.PATH,
    LANG: environment.LANG ?? "C",
    LC_ALL: "C",
    PGDATABASE: decodeURIComponent(selected.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10"
  };
  if (queryHost || selected.hostname) {
    result.PGHOST = queryHost ?? decodeURIComponent(selected.hostname);
  }
  if (selected.port || queryPort) result.PGPORT = selected.port || queryPort;
  if (selected.username) result.PGUSER = decodeURIComponent(selected.username);
  if (selected.password) {
    result.PGPASSWORD = decodeURIComponent(selected.password);
  }
  return result;
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
      "MAIL_DELIVERY_DATABASE_IN_USE",
      `The disposable mail proof database has ${sessionCount} active session(s); ` +
        "none were terminated and the database was retained."
    );
  }
  await admin.query(`drop database ${quoteIdentifier(databaseName)}`);
  if (await databaseExists(admin, databaseName)) {
    fail(
      "MAIL_DELIVERY_DATABASE_DROP_UNPROVEN",
      "The disposable mail proof database still exists after cleanup."
    );
  }
}

export function createMailDeliveryProofPorts({
  commandRunner = createSafeCommandRunner()
} = {}) {
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
    async createTemporaryDirectory() {
      return mkdtemp(path.join(os.tmpdir(), "sitesourcery-mail-e2e-"));
    },
    async removeTemporaryDirectory(selectedPath) {
      await rm(selectedPath, { recursive: true });
    },
    async runJourney({ databaseUrl }) {
      await runMigrationVerification({
        environment: {
          SITESOURCERY_PG_MIGRATION_TEST_URL: databaseUrl
        },
        writeOutput: () => {}
      });
      return runMailDeliveryE2EJourney({ databaseUrl });
    },
    async createBackup({ databaseUrl, dumpPath, environment }) {
      const parsed = new URL(databaseUrl);
      await commandRunner.run(
        "pg_dump",
        [
          "--format=custom",
          "--compress=9",
          "--no-owner",
          "--no-privileges",
          `--file=${dumpPath}`
        ],
        {
          env: postgresEnvironment(environment, databaseUrl),
          secretValues: [decodeURIComponent(parsed.password)],
          label: "Disposable mail PostgreSQL backup"
        }
      );
      const metadata = await lstat(dumpPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
        fail(
          "MAIL_DELIVERY_BACKUP_INVALID",
          "The disposable mail backup is not one nonempty regular file."
        );
      }
      const bytes = await readFile(dumpPath);
      return Object.freeze({
        byteCount: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    },
    async restoreBackup({
      databaseUrl,
      databaseName,
      dumpPath,
      environment
    }) {
      const parsed = new URL(databaseUrl);
      await commandRunner.run(
        "pg_restore",
        [
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-privileges",
          "--section=pre-data",
          "--section=data",
          "--dbname",
          databaseName,
          dumpPath
        ],
        {
          env: postgresEnvironment(environment, databaseUrl),
          secretValues: [decodeURIComponent(parsed.password)],
          label: "Disposable mail PostgreSQL restore"
        }
      );
    },
    async readRestoredIdentity({ databaseUrl, messageIds }) {
      const pool = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        return await readMailDeliveryBackupIdentity(pool, messageIds);
      } finally {
        await pool.end();
      }
    },
    writeStatus(message) {
      process.stderr.write(`${message}\n`);
    }
  });
}

export async function runMailDeliveryProof({
  environment = process.env,
  ports = createMailDeliveryProofPorts()
} = {}) {
  const adminValue = environment[MAIL_DELIVERY_ADMIN_URL_ENV];
  if (typeof adminValue !== "string" || adminValue.trim() === "") {
    fail(
      "MAIL_DELIVERY_ENV_REQUIRED",
      `${MAIL_DELIVERY_ADMIN_URL_ENV} is required.`
    );
  }
  const adminConfig = parseLocalMailAdminUrl(adminValue.trim());
  const requestedName = environment[MAIL_DELIVERY_DATABASE_NAME_ENV];
  const databaseName = requestedName === undefined
    ? generateMailDeliveryDatabaseName({ now: ports.now, uuid: ports.uuid })
    : validateMailDeliveryDatabaseName(String(requestedName).trim());
  const restoreDatabaseName = validateMailDeliveryDatabaseName(
    `${databaseName}_restore`
  );
  if (
    databaseName === adminConfig.baseDatabase ||
    restoreDatabaseName === adminConfig.baseDatabase
  ) {
    fail(
      "MAIL_DELIVERY_ADMIN_TARGET_COLLISION",
      "The admin and disposable mail databases must differ."
    );
  }
  const databaseUrl = targetUrl(adminConfig, databaseName);
  const restoreDatabaseUrl = targetUrl(adminConfig, restoreDatabaseName);
  let admin;
  let temporaryDirectory = null;
  const created = new Set();
  const removed = new Set();
  let temporaryRemoved = false;
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
        "MAIL_DELIVERY_ADMIN_DATABASE_MISMATCH",
        "The PostgreSQL connection did not reach the named admin database."
      );
    }
    if (
      Math.floor(Number(identity.rows[0]?.server_version_num) / 10_000) !==
        EXPECTED_POSTGRES_MAJOR
    ) {
      fail(
        "MAIL_DELIVERY_POSTGRES_MAJOR_UNSUPPORTED",
        `The mail proof requires PostgreSQL ${EXPECTED_POSTGRES_MAJOR}.`
      );
    }
    for (const selected of [databaseName, restoreDatabaseName]) {
      if (await databaseExists(admin, selected)) {
        fail(
          "MAIL_DELIVERY_DATABASE_EXISTS",
          "A disposable mail proof database already exists; it was not changed."
        );
      }
    }

    ports.writeStatus(`Creating disposable mail database ${databaseName}...`);
    await admin.query(
      `create database ${quoteIdentifier(databaseName)} template template0`
    );
    created.add(databaseName);
    temporaryDirectory = await ports.createTemporaryDirectory();
    const dumpPath = path.join(temporaryDirectory, "mail-e2e.dump");

    ports.writeStatus("Running MAIL-DELIVERY-E2E-FIXTURE-05...");
    const journey = await ports.runJourney({ databaseUrl });
    if (
      journey?.providerEffects !== false ||
      journey?.poolShutdown !== true ||
      journey?.messageIds?.length !== 2
    ) {
      fail(
        "MAIL_DELIVERY_JOURNEY_INVALID",
        "The disposable mail journey returned invalid held evidence."
      );
    }

    ports.writeStatus("Creating local disposable PostgreSQL backup...");
    const backup = await ports.createBackup({
      databaseUrl,
      dumpPath,
      environment
    });
    if (!/^[0-9a-f]{64}$/u.test(backup?.sha256) || backup.byteCount < 1) {
      fail(
        "MAIL_DELIVERY_BACKUP_INVALID",
        "The disposable mail backup identity is invalid."
      );
    }

    ports.writeStatus(`Creating clean restore database ${restoreDatabaseName}...`);
    await admin.query(
      `create database ${quoteIdentifier(restoreDatabaseName)} template template0`
    );
    created.add(restoreDatabaseName);
    await ports.restoreBackup({
      databaseUrl: restoreDatabaseUrl,
      databaseName: restoreDatabaseName,
      dumpPath,
      environment
    });
    const restoredIdentity = await ports.readRestoredIdentity({
      databaseUrl: restoreDatabaseUrl,
      messageIds: journey.messageIds
    });
    if (
      JSON.stringify(restoredIdentity) !==
        JSON.stringify(journey.backupIdentity)
    ) {
      fail(
        "MAIL_DELIVERY_RESTORE_IDENTITY_CONFLICT",
        "The restored mail evidence differs from its exact backup identity."
      );
    }

    for (const selected of [restoreDatabaseName, databaseName]) {
      ports.writeStatus(`Removing disposable database ${selected}...`);
      await removeExactDatabase(admin, selected);
      removed.add(selected);
    }
    await ports.removeTemporaryDirectory(temporaryDirectory);
    temporaryRemoved = true;
    temporaryDirectory = null;
    return Object.freeze({
      schema: "sitesourcery.mail-delivery-e2e-proof/v1",
      ok: true,
      postgresMajor: EXPECTED_POSTGRES_MAJOR,
      databaseAbsent: true,
      restoreDatabaseAbsent: true,
      temporaryBackupAbsent: true,
      backupSha256: backup.sha256,
      backupByteCount: backup.byteCount,
      restoredIdentitySha256: restoredIdentity.sha256,
      providerCallCount: journey.providerCallCount,
      signedEventKinds: journey.signedEventKinds,
      duplicateAccepted: journey.duplicateAccepted,
      outOfOrderConflict: journey.outOfOrderConflict,
      migration118RecoveryReused: journey.migration118RecoveryReused,
      operatorProjectionSafe: journey.operatorProjectionSafe,
      providerEffects: false
    });
  } catch (error) {
    let cleanupFailure = null;
    if (admin) {
      for (const selected of [...created].reverse()) {
        if (removed.has(selected)) continue;
        try {
          await removeExactDatabase(admin, selected);
          removed.add(selected);
        } catch (cleanupError) {
          cleanupFailure ??= cleanupError;
        }
      }
    }
    if (temporaryDirectory && !temporaryRemoved) {
      try {
        await ports.removeTemporaryDirectory(temporaryDirectory);
        temporaryRemoved = true;
      } catch (cleanupError) {
        cleanupFailure ??= cleanupError;
      }
    }
    if (cleanupFailure) {
      const combined = new MailDeliveryProofError(
        "MAIL_DELIVERY_CLEANUP_FAILED",
        "The mail proof failed and its disposable state could not be removed.",
        { cause: error }
      );
      combined.cleanupError = cleanupFailure;
      combined.databaseAbsent = false;
      throw combined;
    }
    if (error && typeof error === "object" && Object.isExtensible(error)) {
      error.databaseAbsent = created.size === removed.size;
      error.temporaryBackupAbsent = temporaryRemoved;
    }
    throw error;
  } finally {
    await admin?.close().catch(() => {});
  }
}

async function main() {
  const result = await runMailDeliveryProof();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error.code ?? error.name ?? "MAIL_DELIVERY_E2E_ERROR"}: ` +
        `${error.message}\n`
    );
    process.exitCode = 1;
  });
}
