import path from "node:path";
import { invariant } from "./errors.mjs";

const SAFE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9_.:-]{0,126}[A-Za-z0-9])?$/u;
const SAFE_SEGMENT = /^[A-Za-z0-9_@+](?:[A-Za-z0-9._@+-]{0,254})$/u;
const SAFE_TYPE =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;\s*charset=[a-z0-9._-]+)?$/iu;

export function safeId(value, name = "id") {
  invariant(
    typeof value === "string" && value.length <= 128 && SAFE_ID.test(value),
    "INVALID_ID",
    `${name} is invalid`
  );
  return value;
}

export function nonNegativeInteger(value, name) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_INTEGER", `${name} is invalid`);
  return value;
}

export function relativeFilePath(value) {
  invariant(
    typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 1024 &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0"),
    "INVALID_FILE_PATH",
    "release file path is invalid"
  );
  const parts = value.split("/");
  invariant(
    parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        SAFE_SEGMENT.test(part)
    ),
    "INVALID_FILE_PATH",
    "release file path contains an unsafe segment"
  );
  invariant(path.posix.normalize(value) === value, "INVALID_FILE_PATH", "path is not normalized");
  return value;
}

export function requestFilePath(pathname) {
  if (pathname === "/") return "index.html";
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (
    !decoded.startsWith("/") ||
    decoded.endsWith("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /[\u0000-\u001f\u007f]/u.test(decoded)
  ) {
    return null;
  }
  try {
    const result = relativeFilePath(decoded.slice(1));
    return result === "release-manifest.json" ? null : result;
  } catch {
    return null;
  }
}

export function contentType(value) {
  invariant(
    typeof value === "string" &&
      value.length <= 128 &&
      !value.includes("\r") &&
      !value.includes("\n") &&
      SAFE_TYPE.test(value),
    "INVALID_CONTENT_TYPE",
    "content type is invalid"
  );
  return value.toLowerCase().replace(/\s*;\s*/gu, "; ");
}

export function bytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  invariant(false, "INVALID_BYTES", "release file is not bytes");
}
