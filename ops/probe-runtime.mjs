#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  canonicalJson
} from "./immutable-evidence.mjs";
import {
  DEFAULT_HELD_OPERATIONS_STATE,
  operationsStateFromEnvironment,
  validateOperationsState
} from "./operations-state.mjs";

const HOSTED_OPERATIONS_STATE_SCHEMA =
  "sitesourcery.hosted-operations-state/v1";

function port(value, field, fallback) {
  const selected = Number(value ?? fallback);
  if (
    !Number.isSafeInteger(selected) ||
    selected < 1024 ||
    selected > 65535
  ) {
    throw new Error(`${field} must be an unprivileged TCP port.`);
  }
  return selected;
}

async function jsonProbe(
  fetchImpl,
  url,
  {
    expectedStatus,
    timeoutMs,
    validate
  }
) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json"
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${url.pathname} returned HTTP ${response.status}; expected ${expectedStatus}.`
    );
  }
  const contentType =
    response.headers.get("content-type") ?? "";
  if (
    !contentType
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw new Error(
      `${url.pathname} returned a non-JSON response.`
    );
  }
  const body = await response.json();
  if (!validate(body)) {
    throw new Error(
      `${url.pathname} returned an invalid readiness envelope.`
    );
  }
  return body;
}

export async function probeRuntime({
  fetchImpl = globalThis.fetch,
  apiPort = 8788,
  tenantPort = 8080,
  expectedOperationsState =
    DEFAULT_HELD_OPERATIONS_STATE,
  timeoutMs = 3000
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch implementation is required.");
  }
  const selectedApiPort = port(
    apiPort,
    "API port",
    8788
  );
  const selectedTenantPort = port(
    tenantPort,
    "Tenant port",
    8080
  );
  if (selectedApiPort === selectedTenantPort) {
    throw new Error(
      "API and tenant probes must use different ports."
    );
  }
  const expected = validateOperationsState(
    expectedOperationsState
  );
  const publication = expected.publication;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 10_000
  ) {
    throw new Error(
      "Probe timeout must be between 250 and 10000 milliseconds."
    );
  }
  const apiBase = new URL(
    `http://127.0.0.1:${selectedApiPort}/`
  );
  const tenantBase = new URL(
    `http://127.0.0.1:${selectedTenantPort}/`
  );

  const apiHealth = await jsonProbe(
    fetchImpl,
    new URL("api/v1/health", apiBase),
    {
      expectedStatus: 200,
      timeoutMs,
      validate: (body) =>
        body?.ok === true &&
        body.service ===
          "sitesourcery-hosted-runtime"
    }
  );
  const apiReady = await jsonProbe(
    fetchImpl,
    new URL("api/v1/ready", apiBase),
    {
      expectedStatus: 200,
      timeoutMs,
      validate: (body) =>
        body?.ready === true &&
        body.service ===
          "sitesourcery-hosted-runtime"
    }
  );
  const observedOperationsEnvelope =
    await jsonProbe(
      fetchImpl,
      new URL(
        "_sitesourcery/operations-state",
        apiBase
      ),
      {
        expectedStatus: 200,
        timeoutMs,
        validate: (body) =>
          body?.schema ===
            HOSTED_OPERATIONS_STATE_SCHEMA &&
          body.operationsState &&
          typeof body.operationsState === "object"
      }
    );
  const observedOperationsState =
    validateOperationsState(
      observedOperationsEnvelope.operationsState
    );
  if (
    canonicalJson(observedOperationsState) !==
    canonicalJson(expected)
  ) {
    throw new Error(
      "Hosted operations state differs from its reviewed expectation."
    );
  }
  const tenantHealth = await jsonProbe(
    fetchImpl,
    new URL(
      "_sitesourcery/health",
      tenantBase
    ),
    {
      expectedStatus: 200,
      timeoutMs,
      validate: (body) =>
        body?.ok === true &&
        body.service ===
          "sitesourcery-selfhost-foundation" &&
        body.publicationHeld ===
          (publication === "held")
    }
  );
  const tenantReady = await jsonProbe(
    fetchImpl,
    new URL(
      "_sitesourcery/ready",
      tenantBase
    ),
    {
      expectedStatus:
        publication === "approved" ? 200 : 503,
      timeoutMs,
      validate: (body) =>
        body?.ready ===
        (publication === "approved")
    }
  );

  return Object.freeze({
    ok: true,
    service: apiHealth.service,
    publicationHeld:
      tenantHealth.publicationHeld,
    operationsState: observedOperationsState,
    tenantControlRevision:
      tenantReady.controlRevision ?? null
  });
}

async function main() {
  const result = await probeRuntime({
    apiPort:
      process.env.SITESOURCERY_HOSTED_PORT,
    tenantPort:
      process.env.SITESOURCERY_TENANT_PORT,
    expectedOperationsState:
      operationsStateFromEnvironment(
        process.env
      ),
    timeoutMs: Number(
      process.env.SITESOURCERY_PROBE_TIMEOUT_MS ??
        "3000"
    )
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code: "SITESOURCERY_PROBE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Runtime probe failed."
      })}\n`
    );
    process.exitCode = 1;
  });
}
