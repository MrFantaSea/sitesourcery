import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const environment = {
  SITESOURCERY_ALERT_MODE: "held",
  SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held"
};
const cases = [
  {
    file: "run-hq-backup-cycle.mjs",
    args: ["run"],
    failure: { ok: false, code: "BACKUP_CYCLE_CONFIGURATION_INVALID" }
  },
  {
    file: "monitor-held.mjs",
    args: [],
    failure: {
      ok: false,
      providerEgress: "held",
      code: "OPERATIONS_MONITOR_FAILED"
    }
  },
  {
    file: "verify-final-release-epoch-v2.mjs",
    args: [],
    failure: {
      schema: "sitesourcery.final-release-epoch-failure/v2",
      ok: false,
      code: "FINAL_RELEASE_EPOCH_INVALID"
    }
  }
];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-cli-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = path.join(root, "current");
  await symlink(repository, current, "dir");
  return { root, current };
}

function launch(entry, args = []) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

for (const item of cases) {
  test(`${item.file} executes through a current-directory symlink`, async (t) => {
    const { current } = await fixture(t);
    // Missing HQ configuration/monitor source domain and verifier arguments
    // fail before filesystem custody, service control, database or provider work.
    for (const root of [repository, current]) {
      const result = launch(path.join(root, "ops", item.file), item.args);
      assert.equal(result.status, 1, `${root}: ${result.stderr}`);
      assert.equal(result.stdout, "");
      assert.deepEqual(JSON.parse(result.stderr), item.failure);
    }
  });
}

test("importing the three CLI modules does not execute their main functions", async (t) => {
  const { root, current } = await fixture(t);
  const entry = path.join(root, "import-only.mjs");
  const urls = cases.map(({ file }) => pathToFileURL(path.join(current, "ops", file)).href);
  const source = `
    import assert from "node:assert/strict";
    const mask = process.umask();
    for (const url of ${JSON.stringify(urls)}) await import(url);
    assert.equal(process.umask(), mask);
    assert.equal(process.exitCode, undefined);
    process.stdout.write("imports-inert\\n");
  `;
  await writeFile(entry, source);
  // --eval may populate argv[1] with an arbitrary non-file argument.
  for (const [command, args] of [
    [entry, []],
    ["--input-type=module", ["--eval", source, path.join(root, "absent-entry")]]
  ]) {
    const result = launch(command, args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "imports-inert\n");
    assert.equal(result.stderr, "");
  }
});
