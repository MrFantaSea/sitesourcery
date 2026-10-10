import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExportWorkerHealthReader, createExportWorkerHealthRecorder } from "../export-worker-health.mjs";

const event = { event: "sitesourcery.worker.export", workerId: "hosted-export-fixture-1234", state: "running" };
const cycle = { ...event, cycle: 1, result: { processed: 0, ready: 0, failed: 0, aborted: false } };

async function fixture(work) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ss-export-health-"));
  const filePath = path.join(root, "export-worker-health.json");
  let at = 1_000_000;
  const options = { filePath, now: () => at };
  try { await work({ root, filePath, options, advance: value => { at += value; } }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("export health requires a recent actual completed worker cycle and clears on errors or stop", async () => fixture(async ({ options, advance }) => {
  const writer = createExportWorkerHealthRecorder(options), reader = createExportWorkerHealthReader(options);
  assert.equal((await reader.readiness()).ready, false);
  writer.record(event); await writer.flush(); assert.equal((await reader.readiness()).ready, false);
  writer.record(cycle); await writer.flush(); assert.equal((await reader.readiness()).ready, true);
  advance(120_001); assert.equal((await reader.readiness()).code, "EXPORT_WORKER_HEALTH_STALE");
  writer.record({ ...cycle, cycle: 2, errorCode: "EXPORT_FAILED" }); await writer.flush();
  assert.equal((await reader.readiness()).ready, false);
  writer.record({ ...cycle, cycle: 3 }); await writer.flush(); assert.equal((await reader.readiness()).ready, true);
  writer.record({ ...event, state: "stopped" }); await writer.flush(); assert.equal((await reader.readiness()).ready, false);
}));

test("health ignores other purposes and never records payload, errors or customer details", async () => fixture(async ({ options, filePath }) => {
  const writer = createExportWorkerHealthRecorder(options);
  writer.record({ ...cycle, event: "sitesourcery.worker.cancellation" }); await writer.flush();
  await assert.rejects(readFile(filePath), { code: "ENOENT" });
  writer.record({ ...cycle, recipient: "private@example.test", result: { ...cycle.result, secret: "never-copy" } }); await writer.flush();
  const bytes = await readFile(filePath, "utf8"); assert.doesNotMatch(bytes, /private|never-copy/u);
  assert.equal((await createExportWorkerHealthReader(options).readiness()).ready, true);
}));

test("reader rejects malformed, oversized, future and writable health records", async () => fixture(async ({ options, filePath, advance }) => {
  const writer = createExportWorkerHealthRecorder(options), reader = createExportWorkerHealthReader(options);
  writer.record(cycle); await writer.flush(); const good = await readFile(filePath);
  advance(-1); assert.equal((await reader.readiness()).ready, false); advance(1);
  for (const value of ["{", "x".repeat(2049), JSON.stringify({ ...JSON.parse(good), extra: true })]) {
    await writeFile(filePath, value); assert.equal((await reader.readiness()).ready, false);
  }
  await writeFile(filePath, good); await chmod(filePath, 0o666);
  assert.equal((await reader.readiness()).ready, false);
}));

test("symlinks cannot supply a healthy worker receipt", async () => fixture(async ({ options, filePath, root }) => {
  const elsewhere = path.join(root, "other.json");
  const writer = createExportWorkerHealthRecorder({ ...options, filePath: elsewhere });
  writer.record(cycle); await writer.flush(); await symlink(elsewhere, filePath);
  assert.equal((await createExportWorkerHealthReader(options).readiness()).ready, false);
}));

test("bounded coalescing preserves the latest stop and leaves no partial files", async () => fixture(async ({ options, root }) => {
  const writer = createExportWorkerHealthRecorder(options);
  for (let i = 1; i <= 1000; i++) writer.record({ ...cycle, cycle: i });
  writer.record({ ...event, state: "stopped" }); await writer.flush();
  assert.equal((await createExportWorkerHealthReader(options).readiness()).ready, false);
  assert.deepEqual(await readdir(root), ["export-worker-health.json"]);
}));

test("unsafe directories fail recording, remain unavailable, and recover when fixed", async () => fixture(async ({ options, root }) => {
  const writer = createExportWorkerHealthRecorder(options), reader = createExportWorkerHealthReader(options);
  await chmod(root, 0o777); writer.record(cycle); await assert.rejects(writer.flush(), /could not be recorded/u);
  assert.equal((await reader.readiness()).ready, false);
  await chmod(root, 0o700); writer.record(cycle); await writer.flush();
  assert.equal((await reader.readiness()).ready, true);
}));
