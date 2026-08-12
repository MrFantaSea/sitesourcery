import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAIL_DELIVERY_ADMIN_URL_ENV,
  MAIL_DELIVERY_DATABASE_NAME_ENV,
  MailDeliveryProofError,
  createMailDeliveryProofPorts,
  generateMailDeliveryDatabaseName,
  parseLocalMailAdminUrl,
  runMailDeliveryProof,
  validateMailDeliveryDatabaseName
} from "../mail-delivery-e2e.mjs";

const DATABASE_NAME = "ss_mail_delivery_e2e_unit_20260811";
const RESTORE_NAME = `${DATABASE_NAME}_restore`;
const ADMIN_URL =
  "postgresql://proof-user:do-not-print@127.0.0.1:5432/postgres";
const IDENTITY = Object.freeze({
  schema: "sitesourcery.mail-delivery-e2e-backup-identity/v1",
  sha256: "a".repeat(64),
  counts: Object.freeze({
    claims: 2,
    deliveries: 2,
    events: 6,
    exceptions: 2,
    inbox: 5,
    reservations: 2,
    suppressions: 1
  }),
  providerEffects: false
});

test("mail proof database and local PostgreSQL bounds fail closed", () => {
  assert.equal(validateMailDeliveryDatabaseName(DATABASE_NAME), DATABASE_NAME);
  assert.equal(parseLocalMailAdminUrl(ADMIN_URL).baseDatabase, "postgres");
  assert.equal(
    parseLocalMailAdminUrl(
      "postgresql:///postgres?host=%2Fprivate%2Ftmp%2Fmail-proof&port=55461"
    ).baseDatabase,
    "postgres"
  );
  for (const invalid of [
    "postgres",
    "ss_mail_delivery_e2e_short",
    "ss_mail_delivery_e2e_UPPER_20260811",
    "ss_mail_delivery_e2e_unit-20260811",
    "ss_mail_delivery_e2e_unit_20260811;drop",
    `${DATABASE_NAME}_restore_too_long_for_the_reviewed_database_boundary`
  ]) {
    assert.throws(
      () => validateMailDeliveryDatabaseName(invalid),
      (error) =>
        error instanceof MailDeliveryProofError &&
        error.code === "MAIL_DELIVERY_DATABASE_NAME_INVALID"
    );
  }
  for (const invalid of [
    "https://127.0.0.1/postgres",
    "postgresql://db.example.test/postgres",
    "postgresql://127.0.0.1/",
    "postgresql://127.0.0.1/one/two",
    "postgresql://127.0.0.1/postgres#fragment",
    "postgresql:///postgres?host=db.example.test",
    "postgresql:///postgres?hostaddr=127.0.0.1",
    "postgresql:///postgres?port=70000"
  ]) {
    assert.throws(
      () => parseLocalMailAdminUrl(invalid),
      (error) =>
        error instanceof MailDeliveryProofError &&
        error.code === "MAIL_DELIVERY_ADMIN_URL_INVALID"
    );
  }
});

test("mail proof database generation is deterministic with injected inputs", () => {
  assert.equal(
    generateMailDeliveryDatabaseName({
      now: () => new Date("2026-08-11T12:34:56.789Z"),
      uuid: () => "01234567-89ab-4cde-8fab-0123456789ab"
    }),
    "ss_mail_delivery_e2e_20260811123456_01234567"
  );
});

test("backup and restore commands bind secrets to local libpq environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mail-e2e-port-test-"));
  const dumpPath = path.join(root, "mail-e2e.dump");
  const calls = [];
  const commandRunner = {
    async run(command, args, options) {
      calls.push({ command, args, options });
      assert.equal(args.some((value) => value.includes("do-not-print")), false);
      if (command === "pg_dump") {
        await writeFile(dumpPath, Buffer.from("bounded-fixture-archive"));
      }
      return { code: 0, stdout: "" };
    }
  };
  try {
    const ports = createMailDeliveryProofPorts({ commandRunner });
    const databaseUrl = ADMIN_URL.replace("/postgres", `/${DATABASE_NAME}`);
    const backup = await ports.createBackup({
      databaseUrl,
      dumpPath,
      environment: { PATH: "/unit/bin" }
    });
    assert.equal(backup.byteCount, 23);
    assert.match(backup.sha256, /^[0-9a-f]{64}$/u);
    await ports.restoreBackup({
      databaseUrl,
      databaseName: DATABASE_NAME,
      dumpPath,
      environment: { PATH: "/unit/bin" }
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "pg_dump");
    assert.equal(calls[1].command, "pg_restore");
    assert.deepEqual(
      calls[1].args.filter((value) => value.startsWith("--section=")),
      ["--section=pre-data", "--section=data"]
    );
    for (const call of calls) {
      assert.equal(call.options.env.PGDATABASE, DATABASE_NAME);
      assert.equal(call.options.env.PGHOST, "127.0.0.1");
      assert.equal(call.options.env.PGUSER, "proof-user");
      assert.equal(call.options.env.PGPASSWORD, "do-not-print");
      assert.deepEqual(call.options.secretValues, ["do-not-print"]);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

function createPorts({
  journeyFailure = null,
  restoredIdentity = IDENTITY,
  cleanupSessions = 0
} = {}) {
  const state = {
    databases: new Set(),
    creates: [],
    drops: [],
    journeyCalls: 0,
    backups: 0,
    restores: 0,
    temporaryCreated: 0,
    temporaryRemoved: 0,
    closed: 0,
    statuses: []
  };
  const admin = {
    async query(sql, parameters = []) {
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
        return { rows: [{ exists: state.databases.has(parameters[0]) }] };
      }
      if (normalized.startsWith("create database")) {
        const name = /create database "([a-z0-9_]+)"/u.exec(
          normalized
        )?.[1];
        assert.ok(name);
        assert.equal(state.databases.has(name), false);
        state.databases.add(name);
        state.creates.push(name);
        return { rows: [] };
      }
      if (normalized.includes("from pg_stat_activity")) {
        return { rows: [{ session_count: cleanupSessions }] };
      }
      if (normalized.startsWith("drop database")) {
        const name = /drop database "([a-z0-9_]+)"/u.exec(
          normalized
        )?.[1];
        assert.ok(name);
        assert.equal(state.databases.delete(name), true);
        state.drops.push(name);
        return { rows: [] };
      }
      throw new Error(`Unexpected proof SQL: ${normalized}`);
    },
    async close() { state.closed += 1; }
  };
  return {
    state,
    ports: {
      now: () => new Date("2026-08-11T12:34:56.789Z"),
      uuid: () => "01234567-89ab-4cde-8fab-0123456789ab",
      async connectAdmin({ connectionString }) {
        assert.equal(connectionString, ADMIN_URL);
        return admin;
      },
      async createTemporaryDirectory() {
        state.temporaryCreated += 1;
        return "/private/tmp/sitesourcery-mail-e2e-fixture-unit";
      },
      async removeTemporaryDirectory(selectedPath) {
        assert.equal(
          selectedPath,
          "/private/tmp/sitesourcery-mail-e2e-fixture-unit"
        );
        state.temporaryRemoved += 1;
      },
      async runJourney({ databaseUrl }) {
        state.journeyCalls += 1;
        assert.equal(new URL(databaseUrl).pathname, `/${DATABASE_NAME}`);
        if (journeyFailure) throw journeyFailure;
        return {
          providerEffects: false,
          poolShutdown: true,
          messageIds: [
            "40000000-0000-4000-8000-000000000001",
            "40000000-0000-4000-8000-000000000002"
          ],
          backupIdentity: IDENTITY,
          providerCallCount: 2,
          signedEventKinds: [
            "delivered", "bounced", "complained", "suppressed"
          ],
          duplicateAccepted: true,
          outOfOrderConflict: true,
          migration118RecoveryReused: true,
          operatorProjectionSafe: true
        };
      },
      async createBackup({ databaseUrl, dumpPath }) {
        state.backups += 1;
        assert.equal(new URL(databaseUrl).pathname, `/${DATABASE_NAME}`);
        assert.equal(
          dumpPath,
          "/private/tmp/sitesourcery-mail-e2e-fixture-unit/mail-e2e.dump"
        );
        return { sha256: "b".repeat(64), byteCount: 4096 };
      },
      async restoreBackup({ databaseName, databaseUrl }) {
        state.restores += 1;
        assert.equal(databaseName, RESTORE_NAME);
        assert.equal(new URL(databaseUrl).pathname, `/${RESTORE_NAME}`);
      },
      async readRestoredIdentity() { return restoredIdentity; },
      writeStatus(message) { state.statuses.push(message); }
    }
  };
}

test("proof migrates, delivers, backs up, restores exact identity, and removes both databases", async () => {
  const { ports, state } = createPorts();
  const result = await runMailDeliveryProof({
    environment: {
      PATH: "/unit/bin",
      [MAIL_DELIVERY_ADMIN_URL_ENV]: ADMIN_URL,
      [MAIL_DELIVERY_DATABASE_NAME_ENV]: DATABASE_NAME,
      SITESOURCERY_RESEND_API_KEY: "must-not-cross-the-fake-provider"
    },
    ports
  });
  assert.deepEqual(result, {
    schema: "sitesourcery.mail-delivery-e2e-proof/v1",
    ok: true,
    postgresMajor: 16,
    databaseAbsent: true,
    restoreDatabaseAbsent: true,
    temporaryBackupAbsent: true,
    backupSha256: "b".repeat(64),
    backupByteCount: 4096,
    restoredIdentitySha256: IDENTITY.sha256,
    providerCallCount: 2,
    signedEventKinds: [
      "delivered", "bounced", "complained", "suppressed"
    ],
    duplicateAccepted: true,
    outOfOrderConflict: true,
    migration118RecoveryReused: true,
    operatorProjectionSafe: true,
    providerEffects: false
  });
  assert.deepEqual(state.creates, [DATABASE_NAME, RESTORE_NAME]);
  assert.deepEqual(state.drops, [RESTORE_NAME, DATABASE_NAME]);
  assert.equal(state.databases.size, 0);
  assert.equal(state.journeyCalls, 1);
  assert.equal(state.backups, 1);
  assert.equal(state.restores, 1);
  assert.equal(state.temporaryCreated, 1);
  assert.equal(state.temporaryRemoved, 1);
  assert.equal(state.closed, 1);
});

test("journey failure removes its exact database and temporary backup root", async () => {
  const primary = new Error("local fixture failure");
  const { ports, state } = createPorts({ journeyFailure: primary });
  await assert.rejects(
    runMailDeliveryProof({
      environment: {
        [MAIL_DELIVERY_ADMIN_URL_ENV]: ADMIN_URL,
        [MAIL_DELIVERY_DATABASE_NAME_ENV]: DATABASE_NAME
      },
      ports
    }),
    (error) =>
      error === primary &&
      error.databaseAbsent === true &&
      error.temporaryBackupAbsent === true
  );
  assert.deepEqual(state.creates, [DATABASE_NAME]);
  assert.deepEqual(state.drops, [DATABASE_NAME]);
  assert.equal(state.databases.size, 0);
  assert.equal(state.temporaryRemoved, 1);
  assert.equal(state.closed, 1);
});

test("restore identity drift fails closed and cleans both disposable databases", async () => {
  const { ports, state } = createPorts({
    restoredIdentity: { ...IDENTITY, sha256: "c".repeat(64) }
  });
  await assert.rejects(
    runMailDeliveryProof({
      environment: {
        [MAIL_DELIVERY_ADMIN_URL_ENV]: ADMIN_URL,
        [MAIL_DELIVERY_DATABASE_NAME_ENV]: DATABASE_NAME
      },
      ports
    }),
    (error) =>
      error?.code === "MAIL_DELIVERY_RESTORE_IDENTITY_CONFLICT" &&
      error.databaseAbsent === true &&
      error.temporaryBackupAbsent === true
  );
  assert.deepEqual(state.drops, [RESTORE_NAME, DATABASE_NAME]);
  assert.equal(state.databases.size, 0);
});

test("cleanup refuses an occupied database and reports retained state", async () => {
  const { ports, state } = createPorts({
    journeyFailure: new Error("local fixture failure"),
    cleanupSessions: 1
  });
  await assert.rejects(
    runMailDeliveryProof({
      environment: {
        [MAIL_DELIVERY_ADMIN_URL_ENV]: ADMIN_URL,
        [MAIL_DELIVERY_DATABASE_NAME_ENV]: DATABASE_NAME
      },
      ports
    }),
    (error) =>
      error?.code === "MAIL_DELIVERY_CLEANUP_FAILED" &&
      error.databaseAbsent === false &&
      error.cleanupError?.code === "MAIL_DELIVERY_DATABASE_IN_USE"
  );
  assert.equal(state.databases.has(DATABASE_NAME), true);
  assert.equal(state.drops.length, 0);
  assert.equal(state.temporaryRemoved, 1);
});

test("fixture source has no real provider, network, Care, or secret boundary", async () => {
  const sources = await Promise.all([
    readFile(new URL("../mail-delivery-e2e.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../mail-delivery-e2e-fixture.mjs", import.meta.url),
      "utf8"
    )
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /(?:https?:\/\/api[.]resend[.]com|fetch\s*\(|SITESOURCERY_RESEND_API_KEY|care[_-].*claim|migration\s+124)/iu
  );
  assert.doesNotMatch(combined, /\b(?:re_|whsec_)[A-Za-z0-9+/]{8,}/u);
  assert.match(combined, /providerEffects:\s*false/u);
});
