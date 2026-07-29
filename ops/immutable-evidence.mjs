import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  open,
  readFile,
  unlink
} from "node:fs/promises";
import path from "node:path";

export function canonicalJson(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Evidence cannot contain a non-finite number."
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => canonicalJson(entry))
      .join(",")}]`;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) =>
        left.localeCompare(right)
      );
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalJson(entry)}`
      )
      .join(",")}}`;
  }
  throw new TypeError(
    "Evidence must contain only plain JSON values."
  );
}

export function sha256Bytes(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

export async function sha256File(filePath) {
  return sha256Bytes(await readFile(filePath));
}

export function parseJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

export async function readJsonObject(filePath, label) {
  return parseJsonObject(
    await readFile(filePath, "utf8"),
    label
  );
}

export function safeIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(value)
  ) {
    throw new Error(
      `${label} must be a lowercase safe identifier.`
    );
  }
  return value;
}

export async function writeImmutableEvidence(
  filePath,
  value,
  {
    mode = 0o440,
    token = randomUUID()
  } = {}
) {
  const bytes = Buffer.from(
    `${canonicalJson(value)}\n`,
    "utf8"
  );
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${token}.tmp`
  );
  const handle = await open(
    temporaryPath,
    "wx",
    0o600
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, filePath);
    await chmod(filePath, mode);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return Object.freeze({
    path: filePath,
    sha256: sha256Bytes(bytes),
    bytes: bytes.length
  });
}

export async function verifyImmutableEvidence(
  filePath,
  expectedSha256
) {
  const bytes = await readFile(filePath);
  const actualSha256 = sha256Bytes(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      "Immutable evidence digest does not match."
    );
  }
  return Object.freeze({
    value: parseJsonObject(
      bytes.toString("utf8"),
      "Immutable evidence"
    ),
    sha256: actualSha256,
    bytes: bytes.length
  });
}
