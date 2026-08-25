import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPABILITY_PROCESS_KEYS,
  CAPABILITY_PROCESS_KEYS_COUNT,
  CAPABILITY_PROCESS_PROCESS_COUNT,
  CAPABILITY_PROCESS_PROCESS_KEYS,
  createCapabilityProcessMatrix,
  validateCapabilityProcessMatrixSnapshot
} from "../capability-process-matrix.mjs";

function rows(overrides = {}) {
  return Object.fromEntries(CAPABILITY_PROCESS_KEYS.map((key) => [
    key,
    overrides[key] ?? {
      engineeringState: [
        "public_successor",
        "hosted_browser",
        "backup_restore",
        "monitoring_deadman"
      ].includes(key)
        ? "candidate"
        : "ready",
      effectState: ["public_successor", "hosted_browser"].includes(key)
        ? "static"
        : "held",
      code: [
        "public_successor",
        "hosted_browser",
        "backup_restore",
        "monitoring_deadman"
      ].includes(key)
        ? "candidate_not_installed"
        : "verified_all_held"
    }
  ]));
}

function processes() {
  return Object.fromEntries(CAPABILITY_PROCESS_PROCESS_KEYS.map((key) => [
    key,
    {
      engineeringState: "candidate",
      effectState: key === "public_static"
        ? "static"
        : key === "postgresql" ? "internal" : "held",
      code: "candidate_not_installed"
    }
  ]));
}

function installedRows() {
  return Object.fromEntries(CAPABILITY_PROCESS_KEYS.map((key) => [
    key,
    {
      engineeringState: "ready",
      effectState: ["public_successor", "hosted_browser"].includes(key)
        ? "static"
        : "held",
      code: "verified_installed_held"
    }
  ]));
}

function installedProcesses() {
  return Object.fromEntries(CAPABILITY_PROCESS_PROCESS_KEYS.map((key) => [
    key,
    {
      engineeringState: "ready",
      effectState: key === "public_static"
        ? "static"
        : key === "postgresql" ? "internal" : "held",
      code: "verified_installed_held"
    }
  ]));
}

test("freezes the exact twenty rows and six not-installed process boundaries", async () => {
  const matrix = createCapabilityProcessMatrix({
    loadRows: async () => rows(),
    processes: processes()
  });
  const snapshot = await matrix.snapshot();
  assert.equal(snapshot.rows.length, CAPABILITY_PROCESS_KEYS_COUNT);
  assert.equal(snapshot.processes.length, CAPABILITY_PROCESS_PROCESS_COUNT);
  assert.deepEqual(snapshot.rows.map(({ key }) => key), CAPABILITY_PROCESS_KEYS);
  assert.deepEqual(
    snapshot.processes.map(({ key }) => key),
    CAPABILITY_PROCESS_PROCESS_KEYS
  );
  assert.equal(snapshot.startupReady, true);
  assert.equal(snapshot.externalEffects, false);
  assert.equal(
    snapshot.processes.every((process) =>
      process.installationState === "not_installed" &&
      process.runtimeState === "not_asserted"
    ),
    true
  );
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(validateCapabilityProcessMatrixSnapshot(snapshot), snapshot);
  assert.deepEqual(await matrix.assertStartup(snapshot), snapshot);
});

test("projects an exact installed held topology without claiming external process liveness", async () => {
  const matrix = createCapabilityProcessMatrix({
    loadRows: async () => installedRows(),
    processes: installedProcesses(),
    installationState: "installed"
  });
  const snapshot = await matrix.snapshot();
  assert.equal(snapshot.releaseState, "installed");
  assert.equal(snapshot.installationState, "installed");
  assert.equal(
    snapshot.rows.every((row) =>
      row.engineeringState === "ready" &&
      row.installationState === "installed"
    ),
    true
  );
  assert.deepEqual(
    Object.fromEntries(snapshot.processes.map((process) => [
      process.key,
      process.runtimeState
    ])),
    {
      public_static: "external_not_asserted",
      hosted_api: "active",
      tenant_runtime: "external_not_asserted",
      postgresql: "ready",
      worker: "held_not_asserted",
      monitoring_deadman: "external_not_asserted"
    }
  );
  assert.equal(snapshot.externalEffects, false);
  assert.deepEqual(validateCapabilityProcessMatrixSnapshot(snapshot), snapshot);
});

test("installed truth rejects candidate engineering and invented runtime state", async () => {
  assert.throws(
    () => createCapabilityProcessMatrix({
      loadRows: async () => installedRows(),
      processes: {
        ...installedProcesses(),
        worker: {
          engineeringState: "candidate",
          effectState: "held",
          code: "candidate_not_installed"
        }
      },
      installationState: "installed"
    }),
    /invalid reviewed status/u
  );

  const snapshot = await createCapabilityProcessMatrix({
    loadRows: async () => installedRows(),
    processes: installedProcesses(),
    installationState: "installed"
  }).snapshot();
  assert.throws(
    () => validateCapabilityProcessMatrixSnapshot({
      ...snapshot,
      processes: snapshot.processes.map((process) =>
        process.key === "worker"
          ? { ...process, runtimeState: "active" }
          : process
      )
    }),
    /drifted/u
  );
  assert.throws(
    () => validateCapabilityProcessMatrixSnapshot({
      ...snapshot,
      releaseState: "candidate"
    }),
    /invalid/u
  );
});

test("required engineering drift fails startup while later candidate rows do not", async () => {
  const requiredFailure = createCapabilityProcessMatrix({
    loadRows: async () => rows({
      transactional_mail: {
        engineeringState: "not_ready",
        effectState: "held",
        code: "mail_purpose_contract_missing"
      }
    }),
    processes: processes()
  });
  const failed = await requiredFailure.snapshot();
  assert.equal(failed.startupReady, false);
  await assert.rejects(
    () => requiredFailure.assertStartup(failed),
    (error) => error?.code === "CAPABILITY_PROCESS_STARTUP_NOT_READY"
  );

  const laterCandidate = createCapabilityProcessMatrix({
    loadRows: async () => rows({
      backup_restore: {
        engineeringState: "not_ready",
        effectState: "held",
        code: "successor_epoch_not_installed"
      },
      monitoring_deadman: {
        engineeringState: "not_ready",
        effectState: "held",
        code: "monitor_not_installed"
      }
    }),
    processes: processes()
  });
  assert.equal((await laterCandidate.snapshot()).startupReady, true);
});

test("single-flights row reads and rejects denominator or effect drift", async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const matrix = createCapabilityProcessMatrix({
    async loadRows() {
      loads += 1;
      await gate;
      return rows();
    },
    processes: processes()
  });
  const first = matrix.snapshot();
  const second = matrix.snapshot();
  release();
  assert.equal(await first, await second);
  assert.equal(loads, 1);

  await assert.rejects(
    () => createCapabilityProcessMatrix({
      loadRows: async () => ({
        ...rows(),
        invented: {
          engineeringState: "ready",
          effectState: "held",
          code: "invented"
        }
      }),
      processes: processes()
    }).snapshot(),
    /exact reviewed fields/u
  );
  assert.throws(
    () => createCapabilityProcessMatrix({
      loadRows: async () => rows(),
      processes: {
        ...processes(),
        worker: {
          engineeringState: "candidate",
          effectState: "live",
          code: "unsafe"
        }
      }
    }),
    /invalid reviewed status/u
  );
  await assert.rejects(
    () => createCapabilityProcessMatrix({
      loadRows: async () => rows({
        public_successor: {
          engineeringState: "candidate",
          effectState: "held",
          code: "candidate_not_installed"
        }
      }),
      processes: processes()
    }).snapshot(),
    /invalid reviewed status/u
  );
});
