import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

import { HostedError, invariant } from "./errors.mjs";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;

export function digest(value) {
  const source =
    typeof value === "string" || value instanceof Uint8Array
      ? value
      : canonicalJson(value);
  return createHash("sha256").update(source).digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createSequentialIds() {
  let sequence = 0;
  return Object.freeze({
    next(prefix) {
      sequence += 1;
      return `${prefix}_${String(sequence).padStart(8, "0")}`;
    }
  });
}

export function createRandomIds() {
  return Object.freeze({
    next(prefix) {
      return `${prefix}_${randomBytes(16).toString("hex")}`;
    }
  });
}

export async function hashPassword(password) {
  const normalized = validatePassword(password);
  const salt = randomBytes(16);
  const key = await scrypt(normalized, salt, SCRYPT_KEY_LENGTH, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${Buffer.from(key).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (N !== 32768 || r !== 8 || p !== 1) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
  let actual;
  try {
    actual = await scrypt(String(password ?? ""), salt, SCRYPT_KEY_LENGTH, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024
    });
  } catch {
    return false;
  }
  return timingSafeEqual(expected, Buffer.from(actual));
}

export function validatePassword(value) {
  const password = String(value ?? "");
  invariant(
    password.length >= 12 && password.length <= 256,
    "INVALID_INPUT",
    "Password must be between 12 and 256 characters.",
    { status: 400 }
  );
  return password;
}

export function requiredText(value, field, maximum, minimum = 1) {
  const text = String(value ?? "").trim();
  invariant(
    text.length >= minimum && text.length <= maximum,
    "INVALID_INPUT",
    `${field} is required and must be ${maximum} characters or fewer.`,
    { status: 400 }
  );
  return text;
}

export function optionalText(value, maximum) {
  const text = String(value ?? "").trim();
  invariant(
    text.length <= maximum,
    "INVALID_INPUT",
    "A supplied value is too long.",
    { status: 400 }
  );
  return text || null;
}

export function normalizeEmail(value) {
  const email = requiredText(value, "Email", 254).toLowerCase();
  invariant(
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email),
    "INVALID_INPUT",
    "Enter a valid email address.",
    { status: 400 }
  );
  return email;
}

export function normalizeHostname(value) {
  const hostname = String(value ?? "").trim().toLowerCase().replace(/\.$/u, "");
  invariant(
    hostname.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname),
    "INVALID_INPUT",
    "Enter a valid domain name.",
    { status: 400 }
  );
  return hostname;
}

export function safeRawFacts(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_INPUT",
    "Website facts must be an object.",
    { status: 400 }
  );
  const serialized = JSON.stringify(value);
  invariant(
    Buffer.byteLength(serialized) <= 256 * 1024,
    "INVALID_INPUT",
    "Website facts are too large.",
    { status: 413 }
  );
  return JSON.parse(serialized);
}

export function isoNow(clock) {
  const value = clock.now();
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
    "RUNTIME_CONFIGURATION_ERROR",
    "The runtime clock is invalid.",
    { status: 500 }
  );
  return value;
}

export function addMs(iso, milliseconds) {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

export function addDays(iso, days) {
  return addMs(iso, days * 24 * 60 * 60 * 1000);
}

export function assertSafeId(value, field = "ID") {
  const id = requiredText(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id)) {
    throw new HostedError("INVALID_INPUT", `${field} is invalid.`, { status: 400 });
  }
  return id;
}

export function clone(value) {
  return structuredClone(value);
}
