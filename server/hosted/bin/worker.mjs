#!/usr/bin/env node
import "../assert-runtime.mjs";

import { existsSync } from "node:fs";

import {
  postgresBudgetConfigurationFromEnvironment
} from "../postgres-budget-config.mjs";
import {
  createCanonicalPostgresAuthority,
  createPostgresPool
} from "../repository-postgres.mjs";
import {
  createAlakazamWorkerFactories
} from "../worker-alakazam-composition.mjs";
import {
  createCoreWorkerFactories
} from "../worker-core-composition.mjs";
import {
  createNotificationMailWorkerFactories
} from "../notification-mail-worker-composition.mjs";
import {
  createResponderWorkerFactories
} from "../worker-responder-composition.mjs";
import {
  workerConfigurationFromEnvironment
} from "../worker-config.mjs";
import { createWorkerSupervisor } from "../worker-supervisor.mjs";

function write(entry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function waitForShutdown(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const keepAlive = setInterval(() => {}, 60_000);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearInterval(keepAlive);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

const selected = workerConfigurationFromEnvironment(process.env);
if (selected.configuration.activation === "held") {
  write({
    event: "sitesourcery.worker.held",
    ...selected.readiness
  });
} else {
  let authority = null;
  let supervisor = null;
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once("SIGTERM", requestShutdown);
  process.once("SIGINT", requestShutdown);
  try {
    const postgres =
      postgresBudgetConfigurationFromEnvironment(process.env);
    const workerConnections =
      postgres.policy.pool.workerReservedConnections;
    const pool = createPostgresPool({
      max: workerConnections,
      connectionTimeoutMillis:
        postgres.policy.timeouts.acquisitionMs,
      statementTimeoutMillis:
        postgres.policy.timeouts.statementMs,
      lockTimeoutMillis:
        postgres.policy.timeouts.lockMs,
      idleInTransactionTimeoutMillis:
        postgres.policy.timeouts.idleInTransactionMs,
      queryTimeoutMillis:
        postgres.policy.timeouts.statementMs,
      ssl:
        process.env.SITESOURCERY_DATABASE_SSL === "require"
          ? { rejectUnauthorized: true }
          : undefined
    });
    authority = createCanonicalPostgresAuthority({
      pool,
      budgetPolicy: postgres.policy,
      workload: "worker"
    });
    await authority.assertReady();
    const factories = Object.freeze({
      ...createCoreWorkerFactories({
        authority,
        purposes: selected.configuration.purposes,
        environment: process.env,
        log: write
      }),
      ...createNotificationMailWorkerFactories({
        authority,
        purposes: selected.configuration.purposes,
        environment: process.env,
        log: write
      }),
      ...createAlakazamWorkerFactories({
        authority,
        environment: process.env,
        log: write
      }),
      ...createResponderWorkerFactories({
        authority,
        purposes: selected.configuration.purposes,
        environment: process.env,
        log: write
      })
    });
    supervisor = createWorkerSupervisor({
      configuration: selected.configuration,
      factories,
      approvalExists: existsSync,
      log: write
    });
    await supervisor.start({ signal: shutdown.signal });
    write({
      event: "sitesourcery.worker.started",
      state: supervisor.snapshot(),
      postgresBudget: authority.budgetReadiness()
    });
    await waitForShutdown(shutdown.signal);
    await supervisor.stop();
  } catch (error) {
    write({
      event: "sitesourcery.worker.failed",
      errorCode:
        typeof error?.code === "string"
          ? error.code
          : "WORKER_PROCESS_FAILED"
    });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", requestShutdown);
    process.removeListener("SIGINT", requestShutdown);
    if (supervisor) await supervisor.stop().catch(() => {});
    if (authority) await authority.close().catch(() => {});
  }
}
