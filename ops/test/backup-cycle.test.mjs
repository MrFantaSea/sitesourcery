import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BACKUP_CYCLE_MAX_FENCE_MS,
  BACKUP_CYCLE_SCHEMA,
  BackupCycleFailure,
  beginBackupCycle,
  createProductionRehearsalLifecycle,
  recoverBackupCycle,
  runProductionRehearsalBackupCycle,
  runBackupCycle
} from "../backup-cycle.mjs";
import {
  QUIESCE_SCHEMA
} from "../backup-runtime.mjs";

const RUNTIME_UNIT =
  "sitesourcery-production.service";
const SOURCE_FAILURE_DOMAIN =
  "dell-sitesourcery-production-01";

async function setup(t) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-cycle-")
  );
  t.after(async () => {
    await rm(root, {
      recursive: true,
      force: true
    });
  });
  const runtimeRoot = path.join(root, "runtime");
  const stagingRoot = path.join(root, "staging");
  await Promise.all([
    mkdir(runtimeRoot, { mode: 0o700 }),
    mkdir(stagingRoot, { mode: 0o700 })
  ]);
  const state = { value: "active" };
  const calls = [];
  const lifecycle = {
    async runtimeState() {
      calls.push(["state", state.value]);
      return state.value;
    },
    async stopRuntime() {
      calls.push(["stop"]);
      state.value = "inactive";
    },
    async startRuntime() {
      calls.push(["start"]);
      state.value = "active";
    }
  };
  return {
    runtimeUnit: RUNTIME_UNIT,
    sourceFailureDomainId:
      SOURCE_FAILURE_DOMAIN,
    fencePath: path.join(
      runtimeRoot,
      "BACKUP_QUIESCE"
    ),
    statePath: path.join(
      runtimeRoot,
      "BACKUP_CYCLE_STATE.json"
    ),
    stagingRoot,
    lifecycle,
    uid: process.getuid(),
    now: () =>
      new Date("2026-08-02T12:00:00.000Z"),
    snapshotIdFactory: () =>
      "cycle-snapshot-001",
    state,
    calls
  };
}

async function absent(selectedPath) {
  await assert.rejects(
    lstat(selectedPath),
    (error) => error?.code === "ENOENT"
  );
}

test("successful cycle fences the writer and restores it after encrypted backup", async (t) => {
  const context = await setup(t);
  const result = await runBackupCycle({
    ...context,
    async backup() {
      context.calls.push(["backup"]);
      assert.equal(context.state.value, "inactive");
      const fence = JSON.parse(
        await readFile(
          context.fencePath,
          "utf8"
        )
      );
      assert.deepEqual(fence, {
        schema: QUIESCE_SCHEMA,
        runtimeUnit: RUNTIME_UNIT,
        sourceFailureDomainId:
          SOURCE_FAILURE_DOMAIN,
        writerFence: "engaged",
        snapshotId: "cycle-snapshot-001",
        expiresAt:
          "2026-08-02T12:25:00.000Z"
      });
      assert.equal(
        (await lstat(context.fencePath)).mode &
          0o777,
        0o600
      );
      assert.equal(
        (await lstat(context.statePath)).mode &
          0o777,
        0o600
      );
      return {
        attemptId: "attempt-001"
      };
    }
  });
  assert.deepEqual(result, {
    ok: true,
    snapshotId: "cycle-snapshot-001",
    backup: {
      attemptId: "attempt-001"
    }
  });
  assert.equal(context.state.value, "active");
  await Promise.all([
    absent(context.fencePath),
    absent(context.statePath)
  ]);
  assert.deepEqual(
    context.calls.map(([name]) => name),
    [
      "state",
      "stop",
      "state",
      "backup",
      "start",
      "state"
    ]
  );
});

test("failed backup removes plaintext staging and restores the runtime", async (t) => {
  const context = await setup(t);
  const failure = new Error("synthetic backup failure");
  failure.code = "BACKUP_SYNTHETIC_FAILURE";
  await assert.rejects(
    runBackupCycle({
      ...context,
      async backup() {
        const plaintext = path.join(
          context.stagingRoot,
          "sitesourcery-backup-orphan"
        );
        await mkdir(plaintext, {
          mode: 0o700
        });
        await writeFile(
          path.join(plaintext, "database.dump"),
          "plaintext",
          { mode: 0o600 }
        );
        throw failure;
      }
    }),
    (error) => error === failure
  );
  assert.equal(context.state.value, "active");
  await Promise.all([
    absent(context.fencePath),
    absent(context.statePath),
    absent(
      path.join(
        context.stagingRoot,
        "sitesourcery-backup-orphan"
      )
    )
  ]);
});

test("an independently invoked recovery repairs a terminated cycle", async (t) => {
  const context = await setup(t);
  const state = await beginBackupCycle(context);
  assert.equal(state.schema, BACKUP_CYCLE_SCHEMA);
  assert.equal(context.state.value, "inactive");
  const plaintext = path.join(
    context.stagingRoot,
    "sitesourcery-backup-terminated"
  );
  await mkdir(plaintext, { mode: 0o700 });
  await writeFile(
    path.join(plaintext, "app-state.tar"),
    "plaintext",
    { mode: 0o600 }
  );
  const recovered = await recoverBackupCycle(
    context
  );
  assert.deepEqual(recovered, {
    recovered: true,
    snapshotId: "cycle-snapshot-001",
    plaintextStagingRemoved: 1
  });
  assert.equal(context.state.value, "active");
  await Promise.all([
    absent(context.fencePath),
    absent(context.statePath),
    absent(plaintext)
  ]);
});

test("recovery scrubs power-loss plaintext even when volatile state is gone", async (t) => {
  const context = await setup(t);
  const plaintext = path.join(
    context.stagingRoot,
    "sitesourcery-backup-power-loss"
  );
  await mkdir(plaintext, { mode: 0o700 });
  await writeFile(
    path.join(plaintext, "postgresql.dump"),
    "plaintext",
    { mode: 0o600 }
  );
  const recovered = await recoverBackupCycle(
    context
  );
  assert.deepEqual(recovered, {
    recovered: false,
    plaintextStagingRemoved: 1
  });
  assert.equal(context.state.value, "active");
  assert.equal(
    context.calls.length,
    0
  );
  await absent(plaintext);
});

test("failed runtime recovery retains state for a safe retry", async (t) => {
  const context = await setup(t);
  await beginBackupCycle(context);
  let attempts = 0;
  context.lifecycle.startRuntime = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("synthetic start failure");
    }
    context.state.value = "active";
  };
  await assert.rejects(
    recoverBackupCycle(context),
    /synthetic start failure/u
  );
  await absent(context.fencePath);
  assert.equal(
    (await lstat(context.statePath)).isFile(),
    true
  );
  const retried = await recoverBackupCycle(
    context
  );
  assert.equal(retried.recovered, true);
  await absent(context.statePath);
});

test("cycle setup failure invokes recovery before returning the error", async (t) => {
  const context = await setup(t);
  const failure = new Error("synthetic stop failure");
  context.lifecycle.stopRuntime = async () => {
    context.state.value = "inactive";
    throw failure;
  };
  await assert.rejects(
    beginBackupCycle(context),
    (error) => error === failure
  );
  assert.equal(context.state.value, "active");
  await Promise.all([
    absent(context.fencePath),
    absent(context.statePath)
  ]);
});

test("tampered fence blocks recovery until exact state is restored", async (t) => {
  const context = await setup(t);
  await beginBackupCycle(context);
  const original = await readFile(
    context.fencePath,
    "utf8"
  );
  const tampered = JSON.parse(original);
  tampered.snapshotId = "cycle-snapshot-tampered";
  await writeFile(
    context.fencePath,
    `${JSON.stringify(tampered)}\n`,
    { mode: 0o600 }
  );
  await chmod(context.fencePath, 0o600);
  await assert.rejects(
    recoverBackupCycle(context),
    (error) =>
      error instanceof BackupCycleFailure &&
      error.code ===
        "BACKUP_CYCLE_FENCE_INVALID"
  );
  assert.equal(context.state.value, "inactive");
  assert.equal(
    (await lstat(context.statePath)).isFile(),
    true
  );
  await writeFile(
    context.fencePath,
    original,
    { mode: 0o600 }
  );
  await recoverBackupCycle(context);
  assert.equal(context.state.value, "active");
});

test("production lifecycle pins the user manager and exact runtime unit", async () => {
  const calls = [];
  let state = "active";
  const commandRunner = {
    async run(command, args, options) {
      calls.push({ command, args, options });
      if (args[1] === "stop") state = "inactive";
      if (args[1] === "start") state = "active";
      return {
        code: state === "active" ? 0 : 3,
        stdout:
          args[1] === "is-active"
            ? `${state}\n`
            : ""
      };
    }
  };
  const lifecycle =
    createProductionRehearsalLifecycle({
      environment: {
        PATH: "/usr/bin:/bin"
      },
      uid: 1234,
      commandRunner
    });
  assert.equal(
    await lifecycle.runtimeState(),
    "active"
  );
  await lifecycle.stopRuntime();
  assert.equal(
    await lifecycle.runtimeState(),
    "inactive"
  );
  await lifecycle.startRuntime();
  assert.equal(
    await lifecycle.runtimeState(),
    "active"
  );
  for (const call of calls) {
    assert.equal(
      call.command,
      "/usr/bin/systemctl"
    );
    assert.equal(call.args[0], "--user");
    assert.equal(
      call.args.at(-1),
      RUNTIME_UNIT
    );
    assert.equal(
      call.options.env.XDG_RUNTIME_DIR,
      "/run/user/1234"
    );
    assert.equal(
      call.options.env
        .DBUS_SESSION_BUS_ADDRESS,
      "unix:path=/run/user/1234/bus"
    );
  }
});

test("production wrapper rejects environment boundary drift before mutation", () => {
  let mutated = false;
  const lifecycle = {
    async runtimeState() {
      mutated = true;
      return "active";
    },
    async stopRuntime() {
      mutated = true;
    },
    async startRuntime() {
      mutated = true;
    }
  };
  assert.throws(
    () =>
      runProductionRehearsalBackupCycle({
        uid: 1234,
        lifecycle,
        environment: {
          SITESOURCERY_SOURCE_FAILURE_DOMAIN:
            SOURCE_FAILURE_DOMAIN,
          SITESOURCERY_BACKUP_STAGING_ROOT:
            "/tmp/drifted-staging",
          SITESOURCERY_BACKUP_QUIESCE_PATH:
            "/run/user/1234/sitesourcery-production/BACKUP_QUIESCE"
        },
        async backup() {
          mutated = true;
        }
      }),
    (error) =>
      error instanceof BackupCycleFailure &&
      error.code ===
        "BACKUP_CYCLE_CONFIGURATION_INVALID"
  );
  assert.equal(mutated, false);
});

test("orphan fences and overlong fence lifetimes fail closed", async (t) => {
  const context = await setup(t);
  await writeFile(
    context.fencePath,
    "{}\n",
    { mode: 0o600 }
  );
  await assert.rejects(
    recoverBackupCycle(context),
    (error) =>
      error instanceof BackupCycleFailure &&
      error.code ===
        "BACKUP_CYCLE_ORPHAN_FENCE"
  );
  await assert.rejects(
    beginBackupCycle({
      ...context,
      maxFenceMs:
        BACKUP_CYCLE_MAX_FENCE_MS +
        6 * 60 * 1000
    }),
    (error) =>
      error instanceof BackupCycleFailure &&
      error.code ===
        "BACKUP_CYCLE_CONFIGURATION_INVALID"
  );
});
