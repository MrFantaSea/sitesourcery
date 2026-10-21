import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { optionalRuntimeId } from "./runtime-filesystem-policy.mjs";

export const EXPORT_WORKER_HEALTH_PATH = "/run/sitesourcery/export-worker-health.json";
const SCHEMA = "sitesourcery.export-worker-health/v1";
const WORKER_ID = /^hosted-export-[A-Za-z0-9.-]{8,180}$/u;
const STATES = new Set(["running", "stopped", "held", "stopping"]);
const FIELDS = ["schema", "purpose", "workerId", "state", "checkedAtMs", "cycle", "successful"];
const MAX_BYTES = 2048;

function configuration(filePath, now) {
  if (!path.isAbsolute(filePath) || typeof now !== "function") {
    throw new TypeError("Export worker health requires an absolute path and clock.");
  }
}

function status(ready, code) {
  return Object.freeze({ ready, kind: "export-worker-health", code });
}

function validRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === FIELDS.length &&
    FIELDS.every((key) => Object.hasOwn(value, key)) &&
    value.schema === SCHEMA && value.purpose === "export" &&
    typeof value.workerId === "string" && WORKER_ID.test(value.workerId) &&
    STATES.has(value.state) && typeof value.successful === "boolean" &&
    Number.isSafeInteger(value.cycle) && value.cycle >= 0 &&
    Number.isSafeInteger(value.checkedAtMs) && value.checkedAtMs > 0;
}

export function createExportWorkerHealthReader({
  filePath = EXPORT_WORKER_HEALTH_PATH,
  now = Date.now,
  maxAgeMs = 120_000,
  ownerUid = process.getuid?.(),
  sharedGroupId = null
} = {}) {
  configuration(filePath, now);
  optionalRuntimeId(ownerUid, "Worker health owner");
  optionalRuntimeId(sharedGroupId, "Worker health reader group");
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 100 || maxAgeMs > 120_000) {
    throw new TypeError("Export worker health expiry must be bounded by two minutes.");
  }
  return Object.freeze({
    async readiness() {
      let file;
      try {
        file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        const metadata = await file.stat();
        if (!metadata.isFile() || metadata.size > MAX_BYTES ||
            metadata.uid !== ownerUid || (metadata.mode & 0o022) !== 0 ||
            (sharedGroupId !== null && (metadata.gid !== sharedGroupId ||
              (metadata.mode & 0o777) !== 0o640))) {
          return status(false, "EXPORT_WORKER_HEALTH_INVALID");
        }
        // Bound the read even if an unexpected writer grows the opened inode.
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead > MAX_BYTES) return status(false, "EXPORT_WORKER_HEALTH_INVALID");
        const value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
        if (!validRecord(value)) return status(false, "EXPORT_WORKER_HEALTH_INVALID");
        const age = now() - value.checkedAtMs;
        if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) {
          return status(false, "EXPORT_WORKER_HEALTH_STALE");
        }
        return value.state === "running" && value.cycle > 0 && value.successful
          ? status(true, "EXPORT_WORKER_READY")
          : status(false, "EXPORT_WORKER_UNAVAILABLE");
      } catch {
        return status(false, "EXPORT_WORKER_UNAVAILABLE");
      } finally {
        await file?.close().catch(() => {});
      }
    }
  });
}

export function createExportWorkerHealthRecorder({
  filePath = EXPORT_WORKER_HEALTH_PATH,
  now = Date.now,
  ownerUid = process.getuid?.(),
  sharedGroupId = null
} = {}) {
  configuration(filePath, now);
  optionalRuntimeId(ownerUid, "Worker health owner");
  optionalRuntimeId(sharedGroupId, "Worker health reader group");
  if (ownerUid !== process.getuid?.()) {
    throw new TypeError("Worker health must be recorded by its configured owner.");
  }
  let pending = null;
  let writing = null;
  let failure = null;

  async function write(value) {
    const parent = await lstat(path.dirname(filePath));
    if (!parent.isDirectory() || parent.isSymbolicLink() ||
        parent.uid !== ownerUid || (parent.mode & 0o022) !== 0 ||
        (sharedGroupId !== null && (parent.gid !== sharedGroupId ||
          (parent.mode & 0o2777) !== 0o2750))) {
      throw new Error("Export worker health directory must be private to its service user.");
    }
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT |
        constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const metadata = await handle.stat();
      if (metadata.uid !== ownerUid || (sharedGroupId !== null && metadata.gid !== sharedGroupId)) {
        throw new Error("Worker health file identity does not match its directory.");
      }
      await handle.writeFile(JSON.stringify(value) + "\n");
      // fchmod is intentional: the service umask remains 0077 for every other
      // file, while this non-secret receipt is readable by the API only.
      await handle.chmod(sharedGroupId === null ? 0o600 : 0o640);
      await handle.close(); handle = null;
      await rename(temporary, filePath);
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function drain() {
    while (pending) {
      const next = pending;
      pending = null;
      try { await write(next); failure = null; }
      catch { failure = new Error("Export worker health could not be recorded."); }
    }
  }

  function launch() {
    writing = drain().finally(() => {
      writing = null;
      if (pending) launch();
    });
  }

  return Object.freeze({
    record(entry) {
      if (entry?.event !== "sitesourcery.worker.export" ||
          typeof entry.workerId !== "string" || !WORKER_ID.test(entry.workerId) ||
          !STATES.has(entry.state)) return;
      const cycle = Number.isSafeInteger(entry.cycle) && entry.cycle > 0 ? entry.cycle : 0;
      const result = entry.result;
      const successful = entry.state === "running" && cycle > 0 && !entry.errorCode &&
        result && Number.isSafeInteger(result.processed) && result.processed >= 0 &&
        Number.isSafeInteger(result.ready) && result.ready >= 0 &&
        Number.isSafeInteger(result.failed) && result.failed >= 0 &&
        result.ready + result.failed <= result.processed && result.aborted === false;
      const next = {
        schema: SCHEMA, purpose: "export", workerId: entry.workerId,
        state: entry.state, checkedAtMs: now(), cycle, successful: Boolean(successful)
      };
      if (!validRecord(next)) return;
      // At most one active write and one newest pending record, even on slow disks.
      pending = next;
      if (!writing) launch();
    },
    async flush() {
      while (writing) await writing;
      if (failure) throw failure;
    }
  });
}
