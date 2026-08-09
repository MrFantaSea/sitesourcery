import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  assertPostgres16,
  runMigrationVerification
} from "../server/data-plane/tests/verify-empty-postgres-migrations.mjs";

const { Pool } = pg;
const PREFIX = "ss_f06_20260809_";
const generated = `${PREFIX}${process.pid}${Math.floor(Math.random() * 1_000_000)}`;
if (!/^ss_f06_20260809_[0-9]+$/u.test(generated)) {
  process.exit(97);
}

function adminUrl() {
  const value =
    process.env.SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL ?? "";
  assert.ok(value, "SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL is required");
  const parsed = new URL(value);
  assert.match(parsed.protocol, /^postgres(?:ql)?:$/u);
  assert.ok(parsed.pathname.length > 1);
  return parsed;
}

function quotedIdentifier(value) {
  assert.match(value, /^ss_f06_20260809_[0-9]+$/u);
  return `"${value}"`;
}

async function runJourney(databaseUrl) {
  const child = spawn(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      "server/data-plane/tests/alakazam-retained-premium-postgres.integration.test.mjs"
    ],
    {
      cwd: path.resolve(new URL("../", import.meta.url).pathname),
      env: {
        ...process.env,
        SITESOURCERY_PG_ALAKAZAM_RETAINED_PREMIUM_TEST_URL:
          databaseUrl
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, "the F06 PostgreSQL journey failed");
  assert.match(output, /ℹ pass 3/u);
  assert.match(output, /ℹ fail 0/u);
}

export async function proveAlakazamRetainedPremiumPostgres() {
  const admin = adminUrl();
  const databaseName = generated;
  assert.match(databaseName, /^ss_f06_20260809_[0-9]+$/u);
  const target = new URL(admin.href);
  target.pathname = `/${databaseName}`;
  const adminDatabase = decodeURIComponent(admin.pathname.slice(1));
  const pool = new Pool({ connectionString: admin.href, max: 1 });
  let created = false;
  let failure = null;
  let databaseAbsent = false;
  try {
    await assertPostgres16(pool, {
      expectedDatabase: adminDatabase,
      label: "F06 proof admin connection"
    });
    await pool.query(`create database ${quotedIdentifier(databaseName)}`);
    created = true;
    await runMigrationVerification({
      environment: {
        SITESOURCERY_PG_MIGRATION_TEST_URL: target.href
      }
    });
    await runJourney(target.href);
  } catch (error) {
    failure = error;
  } finally {
    if (created) {
      try {
        await pool.query(
          `select pg_terminate_backend(pid)
             from pg_stat_activity
            where datname = $1
              and pid <> pg_backend_pid()`,
          [databaseName]
        );
        await pool.query(
          `drop database ${quotedIdentifier(databaseName)}`
        );
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      const absence = await pool.query(
        `select not exists (
           select 1 from pg_database where datname = $1
         ) as database_absent`,
        [databaseName]
      );
      databaseAbsent = absence.rows[0]?.database_absent === true;
    } catch (error) {
      failure ??= error;
    }
    try {
      await pool.end();
    } catch (error) {
      failure ??= error;
    }
  }
  process.stdout.write(`databaseName ${databaseName}\n`);
  process.stdout.write(`databaseAbsent ${databaseAbsent}\n`);
  if (failure) throw failure;
  assert.equal(databaseAbsent, true);
  return Object.freeze({ databaseName, databaseAbsent });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await proveAlakazamRetainedPremiumPostgres();
}
