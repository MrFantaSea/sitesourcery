import assert from "node:assert/strict";
import { statfs } from "node:fs/promises";
import os from "node:os";
import test from "node:test";

import { createProductionMonitoringProbes } from "../monitor-ports.mjs";
import { diskVolumesFromEnvironment, monitorFromEnvironment } from "../monitor-held.mjs";
import { runOperationsMonitor, validateDiskVolumes } from "../monitor-runtime.mjs";
import { resolveOperationsStateEvidence } from "../operations-state.mjs";

const GIB = 1024 ** 3;
const NOW = new Date("2026-10-09T15:00:00.000Z");
const HELDS = Object.freeze({
  stripeMode: "held", registrationMailMode: "held", recoveryMailMode: "held",
  publication: "held", domainRuntime: "held", dns: "held"
});
const VOLUMES = Object.freeze([
  { name: "protected", path: "/srv/sitesourcery-storage", minimumFreeBytes: 2 * GIB, minimumFreeRatio: 0.2 },
  { name: "root", path: "/", minimumFreeBytes: 30 * GIB, minimumFreeRatio: 0.03 }
]);

function production(options = {}) {
  return createProductionMonitoringProbes({
    databaseUrl: "postgresql://monitor:fixture@127.0.0.1:1/not_connected",
    dataRoot: os.tmpdir(), backupDestinationRoot: os.tmpdir(),
    sourceFailureDomainId: "fixture-storage", expectedOperationsState: HELDS,
    ...options
  });
}

function reading(name, freeGiB, totalGiB) {
  return { name, available: true, freeBytes: freeGiB * GIB, totalBytes: totalGiB * GIB };
}

async function monitor(disk, diskVolumes, thresholds = {}) {
  if (arguments.length < 2) diskVolumes = VOLUMES;
  return runOperationsMonitor({
    now: () => NOW, providerEgress: "held",
    operationsStateEvidence: resolveOperationsStateEvidence({
      actualOperationsState: HELDS, sourceFailureDomainId: "fixture-storage",
      consumer: "monitor", now: NOW
    }),
    thresholds: { ...thresholds, diskVolumes },
    probes: {
      runtime: async () => ({ ok: true, publicationHeld: true, operationsState: HELDS }),
      database: async () => ({ ready: true, runtimeContractV13: true, runtimeContractV14: true,
        runtimeContractV15: true, shadowSchemaAbsent: true, domainHeld: true }),
      backup: async () => ({ verified: true, completedAt: "2026-10-09T14:00:00.000Z" }),
      disk: typeof disk === "function" ? disk : async () => disk,
      certificate: async () => ({ held: true }),
      backlog: async () => ({
        cancellationReady: 0, cancellationAmbiguous: 0, oldestCancellationReadyAt: null,
        exportQueued: 0, exportBuilding: 0, exportLeaseExpired: 0, exportManualReview: 0,
        oldestExportQueuedAt: null, oldestExportLeaseExpiredAt: null,
        reconciliationOpenCases: 0, reconciliationSuppressionConflicts: 0, oldestReconciliationOpenAt: null
      })
    }
  });
}

function diskCheck(result) { return result.report.checks.find(check => check.name === "disk"); }

test("explicit disk environment is bounded, immutable and rejects malformed coverage before other probes", async () => {
  assert.equal(diskVolumesFromEnvironment({}), undefined);
  const configured = diskVolumesFromEnvironment({ SITESOURCERY_MONITOR_DISK_VOLUMES_JSON: JSON.stringify(VOLUMES) });
  assert.deepEqual(configured, VOLUMES);
  assert.equal(Object.isFrozen(configured), true);
  assert.equal(configured.every(Object.isFrozen), true);
  for (const invalid of ["", "{", "null", "[]", " ".repeat(8193), 1]) {
    assert.throws(() => diskVolumesFromEnvironment({ SITESOURCERY_MONITOR_DISK_VOLUMES_JSON: invalid }));
  }
  for (const invalid of [
    [], {}, null, Array(2),
    [...VOLUMES, VOLUMES[0]],
    [VOLUMES[0], { ...VOLUMES[1], path: VOLUMES[0].path }],
    [{ ...VOLUMES[0], path: "relative" }],
    [{ ...VOLUMES[0], path: "/srv/../srv/sitesourcery-storage" }],
    [{ ...VOLUMES[0], path: "/bad\0path" }],
    [{ ...VOLUMES[0], name: "private /path" }],
    [{ ...VOLUMES[0], unexpected: true }],
    [{ ...VOLUMES[0], minimumFreeBytes: 0 }],
    [{ ...VOLUMES[0], minimumFreeBytes: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...VOLUMES[0], minimumFreeBytes: "2147483648" }],
    ...[0, 1, -0.1, Infinity, NaN, "0.2"].map(minimumFreeRatio => [{ ...VOLUMES[0], minimumFreeRatio }]),
    Array.from({ length: 9 }, (_, i) => ({ ...VOLUMES[0], name: "disk" + i, path: "/disk" + i }))
  ]) assert.throws(() => validateDiskVolumes(invalid));
  await assert.rejects(monitorFromEnvironment({ SITESOURCERY_MONITOR_DISK_VOLUMES_JSON: "[]" }), /disk volumes/u);
});

test("disk probe actually reads configured local filesystems without changing the legacy data-root result", async () => {
  const legacy = production();
  try {
    const observed = await legacy.probes.disk();
    assert.deepEqual(Object.keys(observed).sort(), ["freeBytes", "totalBytes"]);
    assert.equal(Number.isSafeInteger(observed.freeBytes), true);
    const expected = await statfs(os.tmpdir(), { bigint: true });
    assert.equal(observed.totalBytes, Number(expected.blocks * expected.bsize));
  } finally { await legacy.close(); }
  const configured = production({ diskVolumes: [{ ...VOLUMES[1] }] });
  try {
    const result = await configured.probes.disk();
    assert.equal(result.volumes.length, 1);
    assert.equal(result.volumes[0].name, "root");
    assert.equal(result.volumes[0].available, true);
    const expected = await statfs("/", { bigint: true });
    assert.equal(result.volumes[0].totalBytes, Number(expected.blocks * expected.bsize));
    assert.equal(JSON.stringify(result).includes('"path"'), false);
  } finally { await configured.close(); }
});

test("one inaccessible volume does not hide the other volume and does not leak filesystem diagnostics", async () => {
  const calls = [];
  const configured = production({ diskVolumes: VOLUMES, statfsImpl: async (path, options) => {
    calls.push([path, options]);
    if (path === VOLUMES[0].path) throw new Error("private path and filesystem diagnostic");
    return { bavail: 25n, blocks: 916n, bsize: BigInt(GIB) };
  } });
  try {
    const result = await configured.probes.disk();
    assert.deepEqual(calls, VOLUMES.map(volume => [volume.path, { bigint: true }]));
    assert.deepEqual(result.volumes[0], { name: "protected", available: false });
    assert.equal(result.volumes[1].freeBytes, 25 * GIB);
    const checked = await monitor(result);
    assert.deepEqual(checked.report.alerts.map(alert => alert.code).sort(), ["DISK_CAPACITY_LOW", "DISK_PROBE_UNAVAILABLE"]);
    assert.equal(diskCheck(checked).volumes[1].code, "DISK_CAPACITY_LOW");
    assert.doesNotMatch(JSON.stringify(checked.report), /private path|filesystem diagnostic|\/srv/u);
    assert.deepEqual(checked.delivery, { attempted: false, delivered: false, mode: "held", code: "OUTBOUND_ALERTS_HELD" });
  } finally { await configured.close(); }
});

test("malformed, negative or unsafe filesystem capacity is unavailable rather than healthy", async () => {
  for (const capacity of [
    {}, { bavail: 1, blocks: 2, bsize: 4096 },
    { bavail: -1n, blocks: 8n, bsize: 4096n },
    { bavail: 1n, blocks: 0n, bsize: 4096n },
    { bavail: 9n, blocks: 8n, bsize: 4096n },
    { bavail: 1n, blocks: 8n, bsize: 0n },
    { bavail: 1n, blocks: BigInt(Number.MAX_SAFE_INTEGER), bsize: 4096n }
  ]) {
    const configured = production({ diskVolumes: VOLUMES, statfsImpl: async () => capacity });
    try {
      const checked = await monitor(await configured.probes.disk());
      assert.equal(checked.report.ok, false);
      assert.deepEqual(checked.report.alerts.map(alert => alert.code), ["DISK_PROBE_UNAVAILABLE"]);
      assert.equal(diskCheck(checked).volumes.every(volume => volume.code === "DISK_PROBE_UNAVAILABLE"), true);
    } finally { await configured.close(); }
  }
});

test("healthy protected storage cannot mask root reserve failure and each uses its own threshold", async () => {
  const result = await monitor({ volumes: [reading("protected", 3, 8), reading("root", 25, 916)] });
  assert.equal(result.report.ok, false);
  assert.deepEqual(diskCheck(result).volumes.map(volume => [volume.name, volume.ok]), [["protected", true], ["root", false]]);
  assert.deepEqual(result.report.alerts.map(alert => alert.code), ["DISK_CAPACITY_LOW"]);
  assert.match(result.report.alerts[0].summary, /root/u);
  assert.equal(diskCheck(result).volumes[0].minimumFreeBytes, 2 * GIB);
  assert.equal(diskCheck(result).volumes[1].minimumFreeBytes, 30 * GIB);
});

test("healthy root storage cannot mask protected reserve failure; multiple failures emit one alert code", async () => {
  const result = await monitor({ volumes: [reading("protected", 1, 8), reading("root", 100, 916)] });
  assert.deepEqual(diskCheck(result).volumes.map(volume => volume.ok), [false, true]);
  const both = await monitor({ volumes: [reading("protected", 1, 8), reading("root", 25, 916)] });
  assert.equal(both.report.alerts.length, 1);
  assert.equal(both.report.alerts[0].code, "DISK_CAPACITY_LOW");
  assert.match(both.report.alerts[0].summary, /protected, root/u);
});

test("per-volume byte and ratio reserves are inclusive and both must pass", async () => {
  const boundary = await monitor({ volumes: [reading("protected", 2, 10), reading("root", 30, 1000)] });
  assert.equal(boundary.report.ok, true);
  const bytesLow = await monitor({ volumes: [reading("protected", 1.5, 5), reading("root", 29, 500)] });
  assert.equal(diskCheck(bytesLow).volumes.every(volume => !volume.ok), true);
  const ratioLow = await monitor({ volumes: [reading("protected", 2, 20), reading("root", 30, 2000)] });
  assert.equal(diskCheck(ratioLow).volumes.every(volume => !volume.ok), true);
});

test("missing, duplicate, unexpected or malformed readings fail explicit coverage closed", async () => {
  for (const value of [
    null, {}, { freeBytes: 100 * GIB, totalBytes: 200 * GIB }, { volumes: [] }, { volumes: Array(2) },
    { volumes: [reading("root", 100, 916)] },
    { volumes: [reading("root", 100, 916), reading("root", 100, 916)] },
    { volumes: [reading("unknown", 3, 8), reading("root", 100, 916)] },
    { volumes: [reading("protected", NaN, 8), reading("root", 100, 916)] },
    { volumes: [reading("protected", Infinity, 8), reading("root", 100, 916)] },
    { volumes: [reading("protected", 3, 0), reading("root", 100, 916)] },
    { volumes: [reading("protected", 9, 8), reading("root", 100, 916)] },
    { volumes: [{ ...reading("protected", 3, 8), available: "true" }, reading("root", 100, 916)] }
  ]) {
    const result = await monitor(value);
    assert.equal(result.report.ok, false);
    assert.equal(diskCheck(result).code, "DISK_PROBE_UNAVAILABLE");
    assert.deepEqual(result.report.alerts.map(alert => alert.code), ["DISK_PROBE_UNAVAILABLE"]);
  }
  const threw = await monitor(async () => { throw new Error("not for telemetry"); });
  assert.equal(diskCheck(threw).code, "DISK_PROBE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(threw), /not for telemetry/u);
});

test("unset explicit volume coverage preserves legacy defaults and byte overrides", async () => {
  const disk = { freeBytes: 4 * GIB, totalBytes: 8 * GIB };
  const legacy = await monitor(disk, undefined);
  assert.deepEqual(diskCheck(legacy), { name: "disk", ok: false, code: "DISK_CAPACITY_LOW" });
  const override = await monitor(disk, undefined, { diskMinimumFreeBytes: 2 * GIB });
  assert.deepEqual(diskCheck(override), { name: "disk", ok: true, code: null });
});
