import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHostedListenerConfiguration } from "../hosted-listener-config.mjs";

test("hosted listener keeps the default and accepts unprivileged alternate ports", () => {
  assert.deepEqual(createHostedListenerConfiguration(), {
    host: "127.0.0.1",
    port: 8788,
    listener: "127.0.0.1:8788"
  });
  for (const port of [1024, 18988, 65535]) {
    const selected = createHostedListenerConfiguration({ port });
    assert.deepEqual(selected, {
      host: "127.0.0.1", port, listener: `127.0.0.1:${port}`
    });
    assert.equal(Object.isFrozen(selected), true);
  }
});

test("hosted listener rejects public hosts and invalid or privileged ports", () => {
  for (const host of ["0.0.0.0", "::", "::1", "localhost", "192.0.2.1", "", null]) {
    assert.throws(() => createHostedListenerConfiguration({ host }), /loopback/u);
  }
  for (const port of [0, -1, 1023, 65536, 18988.5, NaN, Infinity, "18988", null]) {
    assert.throws(() => createHostedListenerConfiguration({ port }), /unprivileged TCP port/u);
  }
});

function startup(environment) {
  // A malformed budget stops startup before pool creation. No inherited
  // credentials, database or provider environment is passed to this process.
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../bin/server.mjs", import.meta.url))
  ], {
    env: { SITESOURCERY_POSTGRES_BUDGET_CONFIG: "invalid-json", ...environment },
    encoding: "utf8",
    timeout: 10_000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  return result.stderr;
}

test("real entrypoint accepts default and alternate ports before database configuration", () => {
  for (const environment of [{}, { SITESOURCERY_HOSTED_PORT: "18988" }]) {
    assert.match(startup(environment), /POSTGRES_BUDGET_CONFIGURATION_INVALID/u);
  }
});

test("real entrypoint rejects unsafe bindings before database configuration", () => {
  const cases = [
    [{ SITESOURCERY_HOSTED_HOST: "0.0.0.0" }, /loopback/u],
    [{ SITESOURCERY_HOSTED_PORT: "1023" }, /unprivileged TCP port/u],
    [{ SITESOURCERY_HOSTED_PORT: "65536" }, /unprivileged TCP port/u],
    [{ SITESOURCERY_HOSTED_PORT: "18988.5" }, /unprivileged TCP port/u],
    [{ SITESOURCERY_HOSTED_PORT: "not-a-port" }, /unprivileged TCP port/u]
  ];
  for (const [environment, expected] of cases) {
    const error = startup(environment);
    assert.match(error, expected);
    assert.doesNotMatch(error, /POSTGRES_BUDGET_CONFIGURATION_INVALID/u);
  }
});
