import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPABILITY_PROCESS_KEYS,
  CAPABILITY_PROCESS_PROCESS_KEYS,
  createCapabilityProcessMatrix
} from "../capability-process-matrix.mjs";
import { createHostedApi } from "../http.mjs";

const ORIGIN = "https://staging.sitesourcery.com";

function processStates() {
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

function rowStates(failedKey = null) {
  return Object.fromEntries(CAPABILITY_PROCESS_KEYS.map((key) => [
    key,
    {
      engineeringState:
        key === failedKey
          ? "not_ready"
          : [
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
      code: key === failedKey
        ? "required_dependency_missing"
        : "verified_all_held"
    }
  ]));
}

function service() {
  return {
    async authenticate() {
      throw new Error("not reached");
    },
    async readiness() {
      return {
        ready: true,
        registration: { ready: true, verified: true },
        recovery: { ready: true, verified: true },
        providers: { domains: {} },
        publication: { ready: true, held: true }
      };
    }
  };
}

function api(failedKey = null) {
  const matrix = createCapabilityProcessMatrix({
    loadRows: async () => rowStates(failedKey),
    processes: processStates()
  });
  return createHostedApi(service(), {
    capabilityProcessMatrix: matrix,
    strictCapabilityProcessMatrix: true
  });
}

test("strict capabilities and readiness expose the same exact green matrix", async () => {
  const selected = api();
  const capabilitiesResponse = await selected.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.capabilityProcessMatrix.rows.length, 20);
  assert.equal(capabilities.capabilityProcessMatrix.processes.length, 6);
  assert.equal(capabilities.capabilityProcessMatrix.startupReady, true);
  assert.equal(
    capabilities.capabilityProcessMatrix.processes.find(
      ({ key }) => key === "postgresql"
    ).effectState,
    "internal"
  );
  assert.deepEqual(
    capabilities.capabilityProcessMatrix.rows.find(
      ({ key }) => key === "backup_restore"
    ).processes,
    ["hosted_api", "postgresql", "tenant_runtime", "monitoring_deadman"]
  );
  assert.equal(
    capabilities.capabilityProcessMatrix.processes.every((process) =>
      process.installationState === "not_installed" &&
      process.runtimeState === "not_asserted"
    ),
    true
  );

  const readyResponse = await selected.fetch(
    new Request(`${ORIGIN}/api/v1/ready`)
  );
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.ready, true);
  assert.deepEqual(
    ready.capabilityProcessMatrix,
    capabilities.capabilityProcessMatrix
  );
});

test("strict readiness singleflights the shared service readiness fanout", async () => {
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const selectedService = service();
  const load = selectedService.readiness;
  selectedService.readiness = async () => {
    calls += 1;
    await blocked;
    return load();
  };
  const matrix = createCapabilityProcessMatrix({
    loadRows: async () => rowStates(),
    processes: processStates()
  });
  const selected = createHostedApi(selectedService, {
    capabilityProcessMatrix: matrix,
    strictCapabilityProcessMatrix: true
  });
  const response = selected.fetch(
    new Request(`${ORIGIN}/api/v1/ready`)
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.equal((await response).status, 200);
  assert.equal(calls, 1);
});

test("required matrix drift fails readiness while capabilities stay inspectable", async () => {
  const selected = api("transactional_mail");
  const readyResponse = await selected.fetch(
    new Request(`${ORIGIN}/api/v1/ready`)
  );
  assert.equal(readyResponse.status, 503);
  const ready = await readyResponse.json();
  assert.equal(ready.ready, false);
  assert.equal(ready.code, "CAPABILITY_PROCESS_STARTUP_NOT_READY");
  assert.equal(ready.capabilityProcessMatrix.startupReady, false);

  const capabilitiesResponse = await selected.fetch(
    new Request(`${ORIGIN}/api/v1/capabilities`)
  );
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.capabilityProcessMatrix.startupReady, false);
});

test("strict mode refuses an omitted matrix without changing default fixtures", () => {
  assert.throws(
    () => createHostedApi(service(), {
      strictCapabilityProcessMatrix: true
    }),
    (error) => error?.code === "RUNTIME_CONFIGURATION_ERROR"
  );
  assert.doesNotThrow(() => createHostedApi(service()));
});

test("production entrypoint constructs, mounts, and asserts the strict matrix before TCP listen", async () => {
  const [source, tenantSource] = await Promise.all([
    readFile(new URL("../bin/server.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../../selfhost/bin/server.mjs", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(
    source,
    /const capabilityProcessMatrix = createCapabilityProcessMatrix\(\{/u
  );
  assert.match(source, /installationState: "installed"/u);
  assert.match(source, /const installedRow = \(effectState = "held"\)/u);
  assert.match(source, /strictCapabilityProcessMatrix: true/u);
  assert.match(source, /capabilityProcessMatrix,/u);
  assert.match(
    source,
    /const PRODUCTION_READINESS_POLICY = Object[.]freeze\(\{\s*ttlMs: 1_000,\s*timeoutMs: 12_000,\s*staleAfterMs: 15_000\s*\}\);/u
  );
  assert.match(
    source,
    /const PRODUCTION_CAPABILITIES_POLICY = Object[.]freeze\(\{\s*ttlMs: 1_000,\s*timeoutMs: 12_000\s*\}\);/u
  );
  assert.match(
    source,
    /readinessPolicy: PRODUCTION_READINESS_POLICY/u
  );
  assert.match(
    source,
    /capabilitiesPolicy: PRODUCTION_CAPABILITIES_POLICY/u
  );
  assert.match(
    source,
    /readiness[.]registration\?\.mode !== "production"[\s\S]{0,240}readiness[.]registration\?\.ready === true[\s\S]{0,160}readiness[.]registration\?\.verified === true/u
  );
  assert.match(
    source,
    /readiness[.]recovery\?\.mode !== "production"[\s\S]{0,240}readiness[.]recovery\?\.ready === true[\s\S]{0,160}readiness[.]recovery\?\.verified === true/u
  );
  assert.match(
    source,
    /await capabilityProcessMatrix\.assertStartup\(\s*await capabilityProcessMatrix\.snapshot\(\)\s*\);/u
  );
  assert.ok(
    source.indexOf("await capabilityProcessMatrix.assertStartup(") <
      source.indexOf("await listen(apiServer, apiPort)")
  );
  assert.match(source, /apiPort !== 8788/u);
  assert.match(tenantSource, /port !== 8080/u);
  assert.match(tenantSource, /SelfHostRuntime\.openServing/u);
});
