#!/usr/bin/env node

import { Readable, Writable } from "node:stream";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  LOCAL_HOSTED_LOAD_SLO_PROFILE,
  createHostedLoadSloReceipt
} from "./hosted-load-slo-runtime.mjs";
import {
  DEFAULT_INGRESS_POLICY
} from "../server/hosted/ingress-policy.mjs";
import { createNodeHandler } from "../server/hosted/node-handler.mjs";
import {
  DEFAULT_POSTGRES_BUDGET_POLICY
} from "../server/hosted/postgres-budget-config.mjs";
import {
  createCanonicalPostgresAuthority
} from "../server/hosted/repository-postgres.mjs";
import {
  createReadinessSnapshot
} from "../server/hosted/readiness-snapshot.mjs";
import {
  WORKER_CONFIG_SCHEMA
} from "../server/hosted/worker-config.mjs";
import {
  createWorkerSupervisor
} from "../server/hosted/worker-supervisor.mjs";

const PINNED_NODE_VERSION = "24.18.0";

function fail(message) {
  throw new Error(message);
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function incoming() {
  const stream = Readable.from([]);
  stream.headers = { host: "load-slo.local" };
  stream.method = "GET";
  stream.url = "/api/v1/ready";
  stream.socket = {
    remoteAddress: "127.0.0.1",
    encrypted: false
  };
  return stream;
}

function outgoing() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name, value) => {
    stream.headers[String(name).toLowerCase()] = value;
  };
  stream.body = () => Buffer.concat(chunks).toString("utf8");
  return stream;
}

function bodyCode(output) {
  try {
    return JSON.parse(output.body()).error?.code ?? null;
  } catch {
    return null;
  }
}

async function waitFor(predicate, label) {
  for (let turn = 0; turn < 100; turn += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  fail(`${label} did not reach its deterministic checkpoint.`);
}

async function probeIngress(profile) {
  const gate = deferred();
  let admitted = 0;
  const handler = createNodeHandler(
    {
      fetch() {
        admitted += 1;
        return gate.promise.then(() => new Response("ok"));
      }
    },
    {
      ...DEFAULT_INGRESS_POLICY,
      node: {
        maxConcurrentRequests: profile.maxConcurrentRequests,
        requestDeadlineMs: profile.requestDeadlineMs
      }
    }
  );
  const admittedOutputs = Array.from(
    { length: profile.maxConcurrentRequests },
    () => outgoing()
  );
  const admittedRuns = admittedOutputs.map((output) =>
    handler(incoming(), output)
  );
  await waitFor(
    () => admitted === profile.maxConcurrentRequests,
    "Ingress admission"
  );
  const busyOutputs = Array.from(
    { length: profile.excessRequests },
    () => outgoing()
  );
  await Promise.all(
    busyOutputs.map((output) => handler(incoming(), output))
  );
  gate.resolve();
  await Promise.all(admittedRuns);
  if (
    admittedOutputs.some((output) => output.statusCode !== 200) ||
    busyOutputs.some((output) => output.statusCode !== 503)
  ) {
    fail("Ingress concurrency acceptance did not preserve its exact boundary.");
  }

  const postDrainOutput = outgoing();
  await handler(incoming(), postDrainOutput);
  if (postDrainOutput.statusCode !== 200) {
    fail("Ingress did not admit work after its bounded requests drained.");
  }

  const deadlineOutput = outgoing();
  const deadlineHandler = createNodeHandler(
    {
      fetch(request) {
        return new Promise((resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true }
          );
        });
      }
    },
    {
      ...DEFAULT_INGRESS_POLICY,
      node: {
        maxConcurrentRequests: profile.maxConcurrentRequests,
        requestDeadlineMs: profile.requestDeadlineMs
      }
    }
  );
  await deadlineHandler(incoming(), deadlineOutput);

  return Object.freeze({
    attemptedRequests:
      profile.maxConcurrentRequests + profile.excessRequests,
    admittedRequests: profile.maxConcurrentRequests,
    busyRequests: profile.excessRequests,
    busyStatus: busyOutputs[0].statusCode,
    busyCode: bodyCode(busyOutputs[0]),
    retryAfterSeconds: Number(busyOutputs[0].headers["retry-after"]),
    deadlineStatus: deadlineOutput.statusCode,
    deadlineCode: bodyCode(deadlineOutput),
    activeAfter: 0
  });
}

function createManualClock() {
  let now = 0;
  let sequence = 0;
  const scheduled = new Map();
  return Object.freeze({
    now: () => now,
    setTimeout(callback, milliseconds) {
      const timer = { id: sequence += 1 };
      scheduled.set(timer.id, {
        callback,
        at: now + milliseconds
      });
      return timer;
    },
    clearTimeout(timer) {
      scheduled.delete(timer?.id);
    },
    advance(milliseconds) {
      now += milliseconds;
      const ready = [...scheduled.entries()]
        .filter(([, entry]) => entry.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, entry] of ready) {
        scheduled.delete(id);
        entry.callback();
      }
    }
  });
}

function fakePool(processBudget) {
  return {
    totalCount: processBudget,
    idleCount: 0,
    waitingCount: 0,
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    },
    async end() {}
  };
}

async function probePool(profile, workload) {
  const processBudget = workload === "api"
    ? profile.apiConnections
    : profile.workerReservedConnections;
  const clock = createManualClock();
  const authority = createCanonicalPostgresAuthority({
    pool: fakePool(processBudget),
    workload,
    budgetTimers: clock,
    budgetPolicy: {
      timeouts: {
        ...DEFAULT_POSTGRES_BUDGET_POLICY.timeouts,
        acquisitionMs: profile.acquisitionMs
      },
      pool: {
        totalConnections: profile.totalConnections,
        apiConnections: profile.apiConnections,
        workerReservedConnections: profile.workerReservedConnections,
        connectionIncrease: "none"
      }
    }
  });
  const release = deferred();
  const active = Array.from(
    { length: processBudget },
    () => authority.service({}, () => release.promise)
  );
  await waitFor(
    () => {
      const telemetry = authority.budgetReadiness().telemetry;
      return telemetry.activeTransactions === processBudget &&
        telemetry.successfulAcquisitions === processBudget;
    },
    `${workload} pool saturation`
  );
  const overflow = authority.service(
    {},
    async () => "must-not-run"
  ).then(
    () => ({ code: null }),
    (error) => ({ code: error?.code ?? null })
  );
  await waitFor(
    () => authority.budgetReadiness().telemetry.queuedAcquisitions === 1,
    `${workload} pool waiter`
  );
  clock.advance(profile.acquisitionMs);
  const overflowResult = await overflow;
  if (overflowResult.code !== "DATABASE_ACQUISITION_TIMEOUT") {
    fail(`${workload} pool did not fail closed at its acquisition deadline.`);
  }
  release.resolve("done");
  await Promise.all(active);
  const readiness = authority.budgetReadiness();
  return Object.freeze({
    workload,
    totalConnections: readiness.pool.totalConnections,
    apiConnections: readiness.pool.apiConnections,
    workerReservedConnections: readiness.pool.workerReservedConnections,
    processConnectionBudget: readiness.pool.processConnectionBudget,
    requestedAcquisitions: readiness.telemetry.requestedAcquisitions,
    successfulAcquisitions: readiness.telemetry.successfulAcquisitions,
    saturationEvents: readiness.telemetry.saturationEvents,
    timedOutAcquisitions: readiness.telemetry.timedOutAcquisitions,
    queuedAfter: readiness.telemetry.queuedAcquisitions,
    activeAfter: readiness.telemetry.activeTransactions,
    pii: readiness.telemetry.pii
  });
}

async function probeReadiness(profile) {
  const pending = deferred();
  let dependencyCalls = 0;
  const snapshot = createReadinessSnapshot({
    check: async () => {
      dependencyCalls += 1;
      await pending.promise;
      return {
        ready: true,
        privateDetail: "must-not-escape"
      };
    },
    ttlMs: profile.ttlMs,
    timeoutMs: profile.timeoutMs,
    staleAfterMs: profile.staleAfterMs
  });
  const concurrent = Array.from(
    { length: profile.concurrentReads },
    () => snapshot.read()
  );
  await waitFor(() => dependencyCalls === 1, "Readiness singleflight");
  pending.resolve();
  const firstResults = await Promise.all(concurrent);
  const cached = await snapshot.read();
  const all = [...firstResults, cached];
  return Object.freeze({
    concurrentReads: profile.concurrentReads,
    totalReads: all.length,
    dependencyCalls,
    readyReads: all.filter((entry) => entry.ready === true).length,
    cacheHit: dependencyCalls === 1,
    singleflight: dependencyCalls === 1,
    escapedPrivateDetail: JSON.stringify(all).includes("must-not-escape")
  });
}

function workerConfiguration(profile, purposes = profile.purposes) {
  return {
    schema: WORKER_CONFIG_SCHEMA,
    activation: "owner-approved",
    purposes,
    approvalPath: "/etc/sitesourcery/load-slo-local-fixture",
    shutdownDeadlineMs: profile.deadlineMs,
    loop: {
      intervalMs: 100,
      errorBackoffMs: 100,
      maximumBackoffMs: 100
    }
  };
}

function workerFactories(purposes, events, { hangOnStop = false } = {}) {
  return Object.fromEntries(
    purposes.map((purpose) => [
      purpose,
      async () => ({
        async readiness() {
          return { ready: true };
        },
        worker: {
          start() {
            events.push(`start:${purpose}`);
            return true;
          },
          stop() {
            events.push(`stop:${purpose}`);
            return hangOnStop
              ? new Promise(() => {})
              : Promise.resolve(true);
          },
          snapshot() {
            return { state: "fixture" };
          }
        }
      })
    ])
  );
}

async function probeShutdown(profile) {
  const events = [];
  const supervisor = createWorkerSupervisor({
    configuration: workerConfiguration(profile),
    factories: workerFactories(profile.purposes, events),
    approvalExists: () => true
  });
  if (await supervisor.start() !== true) {
    fail("Local shutdown fixture did not start its isolated workers.");
  }
  if (await supervisor.stop() !== true) {
    fail("Local shutdown fixture did not stop its isolated workers.");
  }
  const secondStop = await supervisor.stop();

  let fireDeadline = null;
  const deadlinePurpose = [profile.purposes[0]];
  const deadlineSupervisor = createWorkerSupervisor({
    configuration: workerConfiguration(profile, deadlinePurpose),
    factories: workerFactories(deadlinePurpose, [], { hangOnStop: true }),
    approvalExists: () => true,
    timers: {
      setTimeout(callback, milliseconds) {
        if (milliseconds !== profile.deadlineMs) {
          fail("Worker shutdown deadline drifted from the local profile.");
        }
        fireDeadline = callback;
        return { unref() {} };
      },
      clearTimeout() {}
    }
  });
  await deadlineSupervisor.start();
  const deadlineResult = deadlineSupervisor.stop().then(
    () => ({ code: null }),
    (error) => ({ code: error?.code ?? null })
  );
  if (typeof fireDeadline !== "function") {
    fail("Worker shutdown did not install its bounded deadline.");
  }
  fireDeadline();
  const deadlineFailure = await deadlineResult;
  const startedPurposes = events
    .filter((entry) => entry.startsWith("start:"))
    .map((entry) => entry.slice("start:".length));
  const stoppedPurposes = events
    .filter((entry) => entry.startsWith("stop:"))
    .map((entry) => entry.slice("stop:".length));
  return Object.freeze({
    startedPurposes,
    stoppedPurposes,
    reverseOrder:
      canonicalJson(stoppedPurposes) ===
      canonicalJson([...profile.purposes].reverse()),
    stateAfter: supervisor.snapshot().state,
    secondStop,
    deadlineEnforced:
      deadlineFailure.code === "WORKER_SHUTDOWN_TIMEOUT",
    deadlineFailureCode: deadlineFailure.code
  });
}

export async function runHostedLoadSloAcceptance({
  runId,
  observedAt,
  source,
  profile = LOCAL_HOSTED_LOAD_SLO_PROFILE
}) {
  if (process.versions.node !== PINNED_NODE_VERSION) {
    fail(`Hosted load acceptance requires Node ${PINNED_NODE_VERSION}.`);
  }
  const observations = Object.freeze({
    ingress: await probeIngress(profile.ingress),
    apiPool: await probePool(profile.postgres, "api"),
    workerPool: await probePool(profile.postgres, "worker"),
    readiness: await probeReadiness(profile.readiness),
    shutdown: await probeShutdown(profile.shutdown)
  });
  return createHostedLoadSloReceipt({
    runId,
    observedAt,
    source,
    profile,
    observations
  });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== "run" || rest.length !== 10) {
    fail("Hosted load acceptance requires run and five exact flag/value pairs.");
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (values.has(flag)) fail("Hosted load acceptance rejects duplicate flags.");
    values.set(flag, value);
  }
  const expected = [
    "--output",
    "--run-id",
    "--observed-at",
    "--source-commit",
    "--source-tree"
  ];
  if (canonicalJson([...values.keys()].sort()) !== canonicalJson(expected.sort())) {
    fail("Hosted load acceptance flags are incomplete or unsupported.");
  }
  return values;
}

async function requireFreshOutput(selected) {
  const absolute = path.resolve(selected);
  if (!path.isAbsolute(selected) || path.extname(absolute) !== ".json") {
    fail("Hosted load receipt output must be an absolute JSON path.");
  }
  const parent = await lstat(path.dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    fail("Hosted load receipt parent must be a real directory.");
  }
  try {
    await lstat(absolute);
    fail("Hosted load receipt output already exists.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return absolute;
}

export async function main({
  argv = process.argv.slice(2),
  runAcceptance = runHostedLoadSloAcceptance,
  writeEvidence = writeImmutableEvidence,
  write = (value) => process.stdout.write(value)
} = {}) {
  const values = parseArguments(argv);
  const output = await requireFreshOutput(values.get("--output"));
  const receipt = await runAcceptance({
    runId: values.get("--run-id"),
    observedAt: values.get("--observed-at"),
    source: {
      commitSha: values.get("--source-commit"),
      treeSha: values.get("--source-tree"),
      nodeVersion: process.versions.node,
      classification: "caller_supplied_local_fixture_identity"
    }
  });
  const retained = await writeEvidence(output, receipt);
  write(`${canonicalJson({
    ok: true,
    path: retained.path,
    sha256: retained.sha256,
    bytes: retained.bytes,
    receiptDigest: receipt.digest,
    productionReady: false,
    externalEffects: "none"
  })}\n`);
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      ok: false,
      code: "HOSTED_LOAD_SLO_ACCEPTANCE_FAILED",
      productionReady: false,
      externalEffects: "none",
      message: error instanceof Error
        ? error.message
        : "Hosted load acceptance failed."
    })}\n`);
    process.exitCode = 1;
  });
}
