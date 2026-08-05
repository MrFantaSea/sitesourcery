import { createHash } from "node:crypto";

export class CommerceV2Error extends Error {
  constructor(code, message, { status = 400 } = {}) {
    super(message);
    this.name = "CommerceV2Error";
    this.code = code;
    this.status = status;
  }
}

export function invariant(condition, code, message, options) {
  if (!condition) {
    throw new CommerceV2Error(code, message, options);
  }
}

export function requiredText(value, field, maximum = 200) {
  invariant(
    typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= maximum,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

export function requiredIso(value, field) {
  requiredText(value, field, 40);
  invariant(
    Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "invalid_input",
    `${field} must be an exact ISO timestamp`
  );
  return value;
}

export function requiredDigest(value, field) {
  invariant(
    typeof value === "string" &&
      /^[a-f0-9]{64}$/u.test(value),
    "invalid_input",
    `${field} must be a SHA-256 digest`
  );
  return value;
}

export function clone(value) {
  return structuredClone(value);
}

export function deepFreeze(value) {
  // ECMAScript rejects Object.freeze() for non-empty typed-array views.
  // Binary evidence is copied and checksum-verified at its trust boundaries;
  // freeze the containing proof while leaving the byte view usable.
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function canonicalValue(value, path) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    invariant(
      Number.isSafeInteger(value),
      "invalid_canonical_value",
      `${path} must be a safe integer`,
      { status: 500 }
    );
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      canonicalValue(child, `${path}[${index}]`)
    );
  }
  invariant(
    value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "invalid_canonical_value",
    `${path} must contain only plain JSON values`,
    { status: 500 }
  );
  const result = {};
  for (const key of Object.keys(value).sort()) {
    invariant(
      value[key] !== undefined,
      "invalid_canonical_value",
      `${path}.${key} cannot be undefined`,
      { status: 500 }
    );
    result[key] = canonicalValue(value[key], `${path}.${key}`);
  }
  return result;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, "value"));
}

export function digest(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}
