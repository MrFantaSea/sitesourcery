import { createHash, timingSafeEqual } from "node:crypto";
import { domainToASCII } from "node:url";
import { invariant } from "./errors.mjs";

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requiredString(value, label, maximum = 256) {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= maximum,
    "invalid_input",
    `${label} is required`,
    { status: 400 }
  );
  return value;
}

export function requiredInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "invalid_input",
    `${label} is invalid`,
    { status: 400 }
  );
  return value;
}

export function normalizeDomain(value) {
  const supplied = requiredString(value, "domain", 253).normalize("NFC").replace(/\.$/u, "");
  const domain = domainToASCII(supplied).toLowerCase();
  invariant(
    domain.length >= 4 &&
      domain.length <= 253 &&
      domain.includes(".") &&
      domain.split(".").every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
      ) &&
      /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/u.test(domain.split(".").at(-1)),
    "invalid_domain",
    "domain is invalid",
    { status: 400 }
  );
  return domain;
}

export function exactMoney(value, label = "money") {
  invariant(value && typeof value === "object", "price_unavailable", `${label} is unavailable`);
  const amountMinor = requiredInteger(value.amountMinor, `${label}.amountMinor`);
  invariant(value.currency === "USD", "unsupported_currency", `${label} must be USD`);
  return Object.freeze({ amountMinor, currency: "USD" });
}

export function sameMoney(left, right) {
  return left?.amountMinor === right?.amountMinor && left?.currency === right?.currency;
}

export function iso(value, label) {
  requiredString(value, label, 40);
  invariant(Number.isFinite(Date.parse(value)), "invalid_input", `${label} is invalid`, { status: 400 });
  return value;
}
