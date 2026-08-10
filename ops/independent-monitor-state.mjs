import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  parseJsonObject,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  validateIndependentMonitorHeartbeat
} from "./independent-monitor-runtime.mjs";

export const INDEPENDENT_MONITOR_APPROVAL_SCHEMA =
  "sitesourcery.independent-monitor-approval/v1";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_PRIVATE_JSON_BYTES = 64 * 1024;
const MAXIMUM_APPROVAL_LIFETIME_MS =
  31 * 24 * 60 * 60 * 1000;

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    throw new Error(`${label} must contain only its exact fields.`);
  }
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return selected;
}

function approvalPayload(value) {
  return {
    schema: INDEPENDENT_MONITOR_APPROVAL_SCHEMA,
    approvalId: value.approvalId,
    state: value.state,
    releaseBindingSha256: value.releaseBindingSha256,
    configurationSha256: value.configurationSha256,
    approvedAt: value.approvedAt,
    expiresAt: value.expiresAt
  };
}

export function independentMonitorApprovalDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(approvalPayload(value))}\n`, "utf8")
  );
}

export function validateIndependentMonitorApproval(
  value,
  {
    releaseBindingSha256,
    configurationSha256,
    now = new Date()
  }
) {
  exactObject(
    value,
    [
      "schema",
      "approvalId",
      "state",
      "releaseBindingSha256",
      "configurationSha256",
      "approvedAt",
      "expiresAt",
      "digest"
    ],
    "Independent monitor approval"
  );
  const approvedAt = exactInstant(
    value.approvedAt,
    "Independent monitor approval start"
  );
  const expiresAt = exactInstant(
    value.expiresAt,
    "Independent monitor approval expiry"
  );
  if (
    !(now instanceof Date) ||
    Number.isNaN(now.valueOf()) ||
    value.schema !== INDEPENDENT_MONITOR_APPROVAL_SCHEMA ||
    value.state !== "approved_read_only" ||
    safeIdentifier(value.approvalId, "Independent monitor approval ID") !==
      value.approvalId ||
    !SHA256.test(releaseBindingSha256) ||
    !SHA256.test(configurationSha256) ||
    value.releaseBindingSha256 !== releaseBindingSha256 ||
    value.configurationSha256 !== configurationSha256 ||
    approvedAt > now ||
    expiresAt <= now ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAXIMUM_APPROVAL_LIFETIME_MS ||
    value.digest !== independentMonitorApprovalDigest(value)
  ) {
    throw new Error("Independent monitor approval is invalid or expired.");
  }
  return Object.freeze({ ...value });
}

async function readPrivateJson(filePath, label) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size < 1 ||
    metadata.size > MAXIMUM_PRIVATE_JSON_BYTES
  ) {
    throw new Error(`${label} must be a bounded private regular file.`);
  }
  return parseJsonObject(await readFile(filePath, "utf8"), label);
}

export async function readIndependentMonitorApproval(
  filePath,
  expected
) {
  return validateIndependentMonitorApproval(
    await readPrivateJson(filePath, "Independent monitor approval"),
    expected
  );
}

export async function readIndependentMonitorHeartbeat(filePath) {
  return validateIndependentMonitorHeartbeat(
    await readPrivateJson(filePath, "Independent monitor heartbeat")
  );
}

export async function writeIndependentMonitorHeartbeat(
  filePath,
  heartbeat,
  { token = randomUUID() } = {}
) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new Error("Independent monitor heartbeat path must be absolute.");
  }
  const selected = validateIndependentMonitorHeartbeat(heartbeat);
  const parent = path.dirname(filePath);
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    throw new Error("Independent monitor state directory is invalid.");
  }
  try {
    const current = await lstat(filePath);
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new Error("Independent monitor heartbeat target is invalid.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(
    parent,
    `.${path.basename(filePath)}.${token}.tmp`
  );
  const bytes = Buffer.from(`${canonicalJson(selected)}\n`, "utf8");
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256Bytes(bytes)
  });
}
