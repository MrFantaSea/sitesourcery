import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createFin010UserUnitSet, parseFin010EnvironmentFile, readFin010EnvironmentValue
} from "../fin010-production-runtime.mjs";
import {
  WORKER_ALIGNMENT_RELEASE, WORKER_ALIGNMENT_ENVIRONMENT,
  WORKER_SHARED_NAMES, prepareWorkerAlignment
} from "../worker-release-alignment.mjs";
import { WORKER_PURPOSES, createWorkerConfiguration } from "../../server/hosted/worker-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const example = await readFile(path.join(root, "ops/workers.env.example"), "utf8");
function decode(text) {
  const parsed = parseFin010EnvironmentFile(text);
  return Object.fromEntries([...parsed.keys()].map((key) =>
    [key, readFin010EnvironmentValue(parsed, key)]));
}
function fixtures() {
  const values = parseFin010EnvironmentFile(example);
  const config = JSON.parse(readFin010EnvironmentValue(values, "SITESOURCERY_WORKER_CONFIG"));
  config.purposes = config.purposes.filter((p) => p !== "alakazam-publication");
  config.approvalPath = "/home/simtech/sitesourcery-production/run/WORKERS_APPROVED";
  values.set("SITESOURCERY_WORKER_CONFIG", `'${JSON.stringify(config)}'`);
  for (const key of [...values.keys()]) {
    if (key.startsWith("SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER_")) values.delete(key);
  }
  values.set("SITESOURCERY_PUBLICATION_COMMAND_TOKEN", "old-private-test-token");
  const previousWorkerText = [...values].map(([k,v]) => `${k}=${v}`).join("\n")+"\n";
  const hosted = new Map(WORKER_SHARED_NAMES.map((key) => [key, values.get(key)]));
  hosted.set("SITESOURCERY_PUBLICATION_COMMAND_TOKEN", "current-private-test-token");
  hosted.set("SITESOURCERY_IDENTITY_PEPPER", "never-copy-this-private-test-value");
  hosted.set("SITESOURCERY_STRIPE_SECRET_KEY", "never-copy-this-provider-test-value");
  return {
    previousWorkerText,
    previousUnitText: createFin010UserUnitSet()["sitesourcery-production-worker.service"],
    hostedText: [...hosted].map(([k,v]) => `${k}=${v}`).join("\n")+"\n"
  };
}
test("current held template matches all runtime purposes and publication remains explicitly held", () => {
  const env = decode(example);
  const config = createWorkerConfiguration({ configurationJson: env.SITESOURCERY_WORKER_CONFIG });
  assert.deepEqual(config.configuration.purposes, WORKER_PURPOSES);
  assert.equal(env.SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER_MODE, "held");
});
test("reproduces the installed approval-path failure without accepting that path in the runtime", () => {
  assert.throws(() => createWorkerConfiguration({
    configurationJson: decode(fixtures().previousWorkerText).SITESOURCERY_WORKER_CONFIG
  }), { code: "WORKER_CONFIGURATION_INVALID" });
});
test("aligns release, all12 purposes and approval while preserving exact held modes and pool budget", () => {
  const input = fixtures(); const result = prepareWorkerAlignment(input);
  const env = decode(result.environmentText);
  const config = createWorkerConfiguration({ configurationJson: env.SITESOURCERY_WORKER_CONFIG });
  assert.deepEqual(config.configuration.purposes, WORKER_PURPOSES);
  assert.equal(config.configuration.purposes.length, 12);
  assert.equal(config.configuration.approvalPath, "/etc/sitesourcery/WORKERS_APPROVED");
  assert.equal(config.configuration.activation, "held");
  assert.equal(result.summary.pool.totalConnections, 10);
  assert.equal(result.summary.pool.apiConnections + result.summary.pool.workerReservedConnections, 10);
  for (const [key,value] of Object.entries(env)) if (key.endsWith("_MODE")) assert.equal(value, "held");
  assert.match(result.unitText, new RegExp(`WorkingDirectory=.*${WORKER_ALIGNMENT_RELEASE}`));
  assert.ok(result.unitText.includes(`EnvironmentFile=${WORKER_ALIGNMENT_ENVIRONMENT}`));
  assert.match(result.unitText, /ConditionPathExists=\/etc\/sitesourcery\/WORKERS_APPROVED/u);
  assert.match(result.unitText, /ConditionPathExists=!\/etc\/sitesourcery\/WORKERS_HOLD/u);
  assert.match(result.unitText, /ConditionPathExists=!\/home\/simtech\/sitesourcery-production\/run\/WORKERS_HOLD/u);
  assert.match(result.unitText, /ConditionPathExists=!%t\/sitesourcery-production\/BACKUP_QUIESCE/u);
  assert.doesNotMatch(result.unitText, /e8862278/u);
  assert.equal(result.summary.workerStartAuthorized, false);
  assert.ok(result.summary.purposeStates.every((p) => !p.liveDeliveryVerified));
});
test("uses current shared API inputs without copying identity or provider credentials or leaking summary values", () => {
  const result = prepareWorkerAlignment(fixtures()); const env = decode(result.environmentText);
  assert.equal(env.SITESOURCERY_PUBLICATION_COMMAND_TOKEN, "current-private-test-token");
  assert.equal(env.SITESOURCERY_IDENTITY_PEPPER, undefined);
  assert.equal(env.SITESOURCERY_STRIPE_SECRET_KEY, undefined);
  assert.doesNotMatch(JSON.stringify(result.summary), /private-test|provider-test/u);
});
test("rejects predecessor authority, unit, unexpected environment and missing shared-input drift", () => {
  const input = fixtures();
  for (const altered of [
    { ...input, previousWorkerText: input.previousWorkerText.replace("SITESOURCERY_STRIPE_MODE=held", "SITESOURCERY_STRIPE_MODE=approved_live") },
    { ...input, previousWorkerText: input.previousWorkerText+"SITESOURCERY_IDENTITY_PEPPER=do-not-copy\n" },
    { ...input, previousUnitText: input.previousUnitText.replace("PrivateTmp=true", "PrivateTmp=false") },
    { ...input, hostedText: input.hostedText.replace(/^SITESOURCERY_DATABASE_URL=.*\n/mu, "") },
    { ...input, previousWorkerText: input.previousWorkerText.replace('"activation":"held"', '"activation":"owner-approved"') },
    { ...input, previousWorkerText: input.previousWorkerText.replace('"shutdownDeadlineMs":20000', '"shutdownDeadlineMs":999') }
  ]) assert.throws(() => prepareWorkerAlignment(altered));
});
test("real aligned held worker exits cleanly with12 purposes and never connects to a database", async () => {
  const server = net.createServer((socket) => { connections++; socket.destroy(); });
  let connections = 0;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = decode(prepareWorkerAlignment(fixtures()).environmentText);
    env.SITESOURCERY_DATABASE_URL = `postgresql://synthetic@127.0.0.1:${server.address().port}/unused`;
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      [path.join(root, "server/hosted/bin/worker.mjs")],
      { env: { PATH: process.env.PATH, NODE_ENV: "production", ...env }, timeout: 10_000 });
    const lines = stdout.trim().split("\n"); assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.event, "sitesourcery.worker.held");
    assert.equal(event.ready, false);
    assert.deepEqual(event.purposes, WORKER_PURPOSES);
    assert.equal(stderr, ""); assert.equal(connections, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
