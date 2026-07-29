import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function jsonEnvelope(schema, payload) {
  return {
    schema,
    checksum: sha256(canonicalJson(payload)),
    payload
  };
}

export function verifyEnvelope(value, schema) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.schema === schema &&
    typeof value.checksum === "string" &&
    value.checksum === sha256(canonicalJson(value.payload))
  );
}
