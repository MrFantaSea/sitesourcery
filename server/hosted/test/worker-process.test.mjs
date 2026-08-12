import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WORKER_CONFIG_ENVIRONMENT,
  WORKER_CONFIG_SCHEMA,
  WORKER_PURPOSES,
  createWorkerConfiguration,
  workerConfigurationFromEnvironment
} from "../worker-config.mjs";
import { createWorkerSupervisor } from "../worker-supervisor.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

function configuration(overrides = {}) {
  return {
    schema: WORKER_CONFIG_SCHEMA,
    activation: "held",
    purposes: [...WORKER_PURPOSES],
    approvalPath: "/etc/sitesourcery/WORKERS_APPROVED",
    shutdownDeadlineMs: 20_000,
    loop: {
      intervalMs: 5_000,
      errorBackoffMs: 5_000,
      maximumBackoffMs: 60_000
    },
    ...overrides
  };
}

function fakeFactories(events, overrides = {}) {
  return Object.fromEntries(
    WORKER_PURPOSES.map((purpose) => [
      purpose,
      async () => {
        events.push(`factory:${purpose}`);
        return {
          async readiness() {
            events.push(`ready:${purpose}`);
            return {
              ready: overrides[purpose]?.ready !== false
            };
          },
          worker: {
            start() {
              events.push(`start:${purpose}`);
              return true;
            },
            async stop() {
              events.push(`stop:${purpose}`);
              return true;
            },
            snapshot() {
              return { state: "test" };
            }
          }
        };
      }
    ])
  );
}

test("versioned worker config is held, exact, bounded, and canonically allowlisted", () => {
  const selected = workerConfigurationFromEnvironment({
    [WORKER_CONFIG_ENVIRONMENT]: JSON.stringify(configuration())
  });
  assert.equal(selected.configuration.activation, "held");
  assert.deepEqual(selected.configuration.purposes, WORKER_PURPOSES);
  assert.equal(selected.readiness.ready, false);
  assert.equal(selected.readiness.credentials, "redacted");
  assert.throws(
    () => workerConfigurationFromEnvironment({}),
    (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
  );
  for (const invalid of [
    configuration({ extra: true }),
    configuration({ activation: "enabled" }),
    configuration({ purposes: ["unknown"] }),
    configuration({ purposes: ["export", "export"] }),
    configuration({ purposes: ["cancellation", "export"] }),
    configuration({ approvalPath: "/tmp/approved" }),
    configuration({ shutdownDeadlineMs: 999 }),
    configuration({
      loop: {
        intervalMs: 99,
        errorBackoffMs: 5_000,
        maximumBackoffMs: 60_000
      }
    }),
    configuration({
      loop: {
        intervalMs: 5_000,
        errorBackoffMs: 10_000,
        maximumBackoffMs: 9_999
      }
    })
  ]) {
    assert.throws(
      () => createWorkerConfiguration({
        configurationJson: JSON.stringify(invalid)
      }),
      (error) => error?.code === "WORKER_CONFIGURATION_INVALID"
    );
  }
});

test("held supervisor creates no dependency and starts no worker", async () => {
  const events = [];
  const supervisor = createWorkerSupervisor({
    configuration: configuration(),
    factories: fakeFactories(events),
    approvalExists: () => true
  });
  assert.equal(await supervisor.start(), false);
  assert.deepEqual(events, []);
  assert.equal(supervisor.snapshot().state, "held");
});

test("owner approval and every dependency readback precede every start", async () => {
  const events = [];
  const supervisor = createWorkerSupervisor({
    configuration: configuration({ activation: "owner-approved" }),
    factories: fakeFactories(events),
    approvalExists(pathname) {
      events.push(`approval:${pathname}`);
      return true;
    }
  });
  assert.equal(await supervisor.start(), true);
  const firstStart = events.findIndex((entry) => entry.startsWith("start:"));
  assert.equal(
    events.slice(0, firstStart).filter((entry) => entry.startsWith("ready:")).length,
    WORKER_PURPOSES.length
  );
  assert.deepEqual(supervisor.snapshot().runningPurposes, WORKER_PURPOSES);
  assert.equal(await supervisor.stop(), true);
  assert.deepEqual(
    events.filter((entry) => entry.startsWith("stop:")),
    [...WORKER_PURPOSES].reverse().map((purpose) => `stop:${purpose}`)
  );
  assert.equal(supervisor.snapshot().state, "stopped");
});

test("missing approval, unavailable purpose, or failed readiness starts nothing", async () => {
  let events = [];
  let supervisor = createWorkerSupervisor({
    configuration: configuration({ activation: "owner-approved" }),
    factories: fakeFactories(events),
    approvalExists: () => false
  });
  await assert.rejects(
    supervisor.start(),
    (error) => error?.code === "WORKER_APPROVAL_REQUIRED"
  );
  assert.deepEqual(events, []);

  events = [];
  supervisor = createWorkerSupervisor({
    configuration: configuration({ activation: "owner-approved" }),
    factories: {
      "alakazam-fulfillment": fakeFactories(events)["alakazam-fulfillment"],
      "alakazam-retained-lifecycle":
        fakeFactories(events)["alakazam-retained-lifecycle"]
    },
    approvalExists: () => true
  });
  await assert.rejects(
    supervisor.start(),
    (error) => error?.code === "WORKER_PURPOSE_UNAVAILABLE"
  );
  assert.deepEqual(events, []);

  events = [];
  supervisor = createWorkerSupervisor({
    configuration: configuration({ activation: "owner-approved" }),
    factories: fakeFactories(events, {
      cancellation: { ready: false }
    }),
    approvalExists: () => true
  });
  await assert.rejects(
    supervisor.start(),
    (error) => error?.code === "WORKER_DEPENDENCY_NOT_READY"
  );
  assert.equal(
    events.some((entry) => entry.startsWith("start:")),
    false
  );
});

test("abort performs one reverse graceful stop without overlapping starts", async () => {
  const events = [];
  const shutdown = new AbortController();
  const supervisor = createWorkerSupervisor({
    configuration: configuration({ activation: "owner-approved" }),
    factories: fakeFactories(events),
    approvalExists: () => true
  });
  assert.equal(await supervisor.start({ signal: shutdown.signal }), true);
  assert.equal(await supervisor.start(), false);
  shutdown.abort();
  for (let turn = 0; turn < 10; turn += 1) {
    if (supervisor.snapshot().state === "stopped") break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(supervisor.snapshot().state, "stopped");
  assert.equal(
    events.filter((entry) => entry.startsWith("start:")).length,
    WORKER_PURPOSES.length
  );
});

test("graceful stop fails closed at the exact configured deadline", async () => {
  let fireDeadline = null;
  const supervisor = createWorkerSupervisor({
    configuration: configuration({
      activation: "owner-approved",
      purposes: ["alakazam-fulfillment"],
      shutdownDeadlineMs: 1_000
    }),
    factories: {
      async "alakazam-fulfillment"() {
        return {
          async readiness() {
            return { ready: true };
          },
          worker: {
            start() {
              return true;
            },
            stop() {
              return new Promise(() => {});
            },
            snapshot() {
              return { state: "running" };
            }
          }
        };
      }
    },
    approvalExists: () => true,
    timers: {
      setTimeout(callback, milliseconds) {
        assert.equal(milliseconds, 1_000);
        fireDeadline = callback;
        return { unref() {} };
      },
      clearTimeout() {}
    }
  });
  assert.equal(await supervisor.start(), true);
  const stopping = supervisor.stop();
  assert.equal(typeof fireDeadline, "function");
  fireDeadline();
  await assert.rejects(
    stopping,
    (error) => error?.code === "WORKER_SHUTDOWN_TIMEOUT"
  );
  assert.equal(supervisor.snapshot().state, "failed");
});

test("production entrypoints split pools and keep notification mail in the worker process", async () => {
  const [api, worker, core, alakazam, unit, example, runbook] = await Promise.all([
    readFile(path.join(root, "server/hosted/bin/server.mjs"), "utf8"),
    readFile(path.join(root, "server/hosted/bin/worker.mjs"), "utf8"),
    readFile(path.join(root, "server/hosted/worker-core-composition.mjs"), "utf8"),
    readFile(path.join(root, "server/hosted/worker-alakazam-composition.mjs"), "utf8"),
    readFile(path.join(root, "ops/sitesourcery-workers.service.held"), "utf8"),
    readFile(path.join(root, "ops/workers.env.example"), "utf8"),
    readFile(path.join(root, "ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md"), "utf8")
  ]);
  assert.doesNotMatch(
    api,
    /createExportWorker|createCancellationWorker|createAlakazamFulfillmentWorker|\.start\(\{\s*signal:\s*shutdownController/u
  );
  assert.match(api, /pool\.apiConnections/u);
  assert.match(api, /backgroundWorkers: "external_process_required"/u);
  assert.match(worker, /pool\.workerReservedConnections/u);
  assert.match(worker, /workload: "worker"/u);
  assert.match(worker, /createCoreWorkerFactories/u);
  assert.match(worker, /createNotificationMailWorkerFactories/u);
  assert.doesNotMatch(
    `${worker}\n${core}\n${alakazam}`,
    /identity-postgres|identity-pepper|registrationMail|recoveryMail/iu
  );
  assert.match(unit, /ConditionPathExists=\/etc\/sitesourcery\/WORKERS_APPROVED/u);
  assert.match(unit, /ConditionPathExists=!\/etc\/sitesourcery\/WORKERS_HOLD/u);
  assert.doesNotMatch(example, /IDENTITY|SITESOURCERY_RESEND_API_KEY/u);
  assert.match(example, /SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE=held/u);
  assert.match(runbook, /WORKERS-02 resolves/u);
  assert.match(runbook, /MAIL-HOSTED-WIRING-03/u);
});
