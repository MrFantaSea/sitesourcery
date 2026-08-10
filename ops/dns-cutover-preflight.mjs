import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const DNS_PREFLIGHT_CUTOFF =
  "2026-08-10T23:48:36.000Z";
export const DNS_PREFLIGHT_RECEIPT_SCHEMA =
  "sitesourcery.dns-cutover-preflight-receipt/v1";

export const DNS_PREFLIGHT_FACTS = Object.freeze({
  domain: "sitesourcery.com",
  parentAuthorities: Object.freeze(
    "abcdefghijklm".split("").map(
      (letter) => `${letter}.gtld-servers.net`
    )
  ),
  publicResolvers: Object.freeze([
    "1.1.1.1",
    "8.8.8.8",
    "9.9.9.9"
  ]),
  currentNameservers: Object.freeze([
    "launch1.spaceship.net",
    "launch2.spaceship.net"
  ]),
  cloudflareNameservers: Object.freeze([
    "jasmine.ns.cloudflare.com",
    "nash.ns.cloudflare.com"
  ]),
  fallbackAddresses: Object.freeze([
    "185.199.108.153",
    "185.199.109.153",
    "185.199.110.153",
    "185.199.111.153"
  ]),
  sendMx: "10 feedback-smtp.us-east-1.amazonses.com",
  sendSpf: "v=spf1 include:amazonses.com ~all",
  resendDkim:
    "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDTZRgU9DB7TuFzqRtHQj+Cx1DgQbG/cClNQ/aDzymuqA0JEsKtATrZHeIBqFBXtpaK6fRCW3LMrwlOx/19oIWb9NhqLbU56MrDb5LNB+KGPEZRWi8EJfHj32DgxhYDoRSdtP0f8s4yrc5ewRzDTmPQTOwpCFW1opqQnjCBL75hUwIDAQAB"
});

const CUTOFF_MS = Date.parse(DNS_PREFLIGHT_CUTOFF);
const SAFE_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const RECORD_TYPES = new Set(["A", "DS", "MX", "NS", "TXT"]);
const QUERY_OUTPUT_LIMIT = 128 * 1024;

class DnsPreflightError extends Error {
  constructor(code) {
    super("DNS cutover preflight failed closed.");
    this.name = "DnsPreflightError";
    this.code = code;
  }
}

function fail(code) {
  throw new DnsPreflightError(code);
}

function canonicalName(value) {
  const selected = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.]$/u, "");
  if (!SAFE_NAME.test(selected)) {
    fail("DNS_PREFLIGHT_RESPONSE_INVALID");
  }
  return selected;
}

function ipv4(value) {
  const selected = String(value ?? "").trim();
  const parts = selected.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) =>
      !/^(?:0|[1-9][0-9]{0,2})$/u.test(part) ||
      Number(part) > 255
    )
  ) {
    fail("DNS_PREFLIGHT_RESPONSE_INVALID");
  }
  return selected;
}

function quotedText(value) {
  const input = String(value ?? "").trim();
  const chunks = [];
  const pattern = /"((?:\\[0-9]{3}|\\.|[^"\\])*)"/gu;
  let match;
  let end = 0;
  while ((match = pattern.exec(input)) !== null) {
    if (input.slice(end, match.index).trim() !== "") {
      fail("DNS_PREFLIGHT_RESPONSE_INVALID");
    }
    chunks.push(match[1].replace(
      /\\([0-9]{3}|.)/gu,
      (_whole, escaped) =>
        /^[0-9]{3}$/u.test(escaped)
          ? String.fromCodePoint(Number(escaped))
          : escaped
    ));
    end = pattern.lastIndex;
  }
  if (
    chunks.length === 0 ||
    input.slice(end).trim() !== "" ||
    chunks.join("").length > 4096
  ) {
    fail("DNS_PREFLIGHT_RESPONSE_INVALID");
  }
  return chunks.join("");
}

function recordValue(type, value) {
  const selected = String(value ?? "").trim();
  if (type === "A") return ipv4(selected);
  if (type === "NS") return canonicalName(selected);
  if (type === "TXT") return quotedText(selected);
  if (type === "MX") {
    const match = /^(0|[1-9][0-9]{0,4})\s+(.+)$/u.exec(selected);
    if (!match || Number(match[1]) > 65535) {
      fail("DNS_PREFLIGHT_RESPONSE_INVALID");
    }
    return `${Number(match[1])} ${canonicalName(match[2])}`;
  }
  if (type === "DS") {
    const match = /^(0|[1-9][0-9]{0,4})\s+(0|[1-9][0-9]{0,2})\s+(0|[1-9][0-9]{0,2})\s+([A-Fa-f0-9]+)$/u.exec(
      selected
    );
    if (!match) fail("DNS_PREFLIGHT_RESPONSE_INVALID");
    return `${Number(match[1])} ${Number(match[2])} ${Number(match[3])} ${match[4].toUpperCase()}`;
  }
  fail("DNS_PREFLIGHT_RESPONSE_INVALID");
}

export function parseDigResponse(output, requestedType) {
  const text = String(output ?? "");
  if (
    !RECORD_TYPES.has(requestedType) ||
    text.length === 0 ||
    Buffer.byteLength(text, "utf8") > QUERY_OUTPUT_LIMIT ||
    /[\u0000]/u.test(text)
  ) {
    fail("DNS_PREFLIGHT_RESPONSE_INVALID");
  }
  const status = /status:\s*([A-Z]+),/u.exec(text)?.[1] ?? null;
  const flags = /;; flags:\s*([^;]*);/u.exec(text)?.[1]
    ?.trim()
    .split(/\s+/u) ?? [];
  if (status === null) fail("DNS_PREFLIGHT_RESPONSE_INVALID");
  let section = null;
  const answerValues = [];
  const authorityValues = [];
  const unexpectedAnswerTypes = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line === ";; ANSWER SECTION:") {
      section = "answer";
      continue;
    }
    if (line === ";; AUTHORITY SECTION:") {
      section = "authority";
      continue;
    }
    if (line.startsWith(";;")) {
      section = null;
      continue;
    }
    if (section === null || line.trim() === "") continue;
    const parts = line.trim().split(/\s+/u);
    if (
      parts.length < 5 ||
      !/^[0-9]+$/u.test(parts[1]) ||
      parts[2].toUpperCase() !== "IN" ||
      !/^[A-Z0-9]+$/u.test(parts[3].toUpperCase())
    ) {
      fail("DNS_PREFLIGHT_RESPONSE_INVALID");
    }
    const type = parts[3].toUpperCase();
    if (type === requestedType) {
      const values = section === "answer"
        ? answerValues
        : authorityValues;
      values.push(recordValue(type, parts.slice(4).join(" ")));
    } else if (section === "answer") {
      unexpectedAnswerTypes.push(type);
    }
  }
  return Object.freeze({
    rcode: status,
    authoritative: flags.includes("aa"),
    answerValues: Object.freeze([...new Set(answerValues)].sort()),
    authorityValues: Object.freeze([...new Set(authorityValues)].sort()),
    unexpectedAnswerTypes: Object.freeze(
      [...new Set(unexpectedAnswerTypes)].sort()
    )
  });
}

function queryArgs({ server, name, type, recursive }) {
  return Object.freeze([
    `@${server}`,
    name,
    type,
    "+time=3",
    "+tries=1",
    "+noall",
    "+comments",
    "+answer",
    "+authority",
    recursive ? "+recurse" : "+norecurse"
  ]);
}

async function query(commandRunner, specification) {
  let result;
  try {
    result = await commandRunner.run(Object.freeze({
      command: "dig",
      args: queryArgs(specification),
      timeoutMs: 5000
    }));
  } catch {
    fail("DNS_PREFLIGHT_QUERY_FAILED");
  }
  if (
    !result || result.exitCode !== 0 ||
    typeof result.stdout !== "string"
  ) {
    fail("DNS_PREFLIGHT_QUERY_FAILED");
  }
  const parsed = parseDigResponse(result.stdout, specification.type);
  if (
    parsed.rcode !== "NOERROR" ||
    parsed.unexpectedAnswerTypes.length !== 0
  ) {
    fail("DNS_PREFLIGHT_QUERY_FAILED");
  }
  return parsed;
}

function exactValues(actual, expected, code) {
  if (
    JSON.stringify([...actual].sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    fail(code);
  }
}

function values(result) {
  return [...result.answerValues, ...result.authorityValues];
}

function requireDsAbsent(result, code) {
  if (values(result).length !== 0) fail(code);
}

function requireAuthoritative(result) {
  if (result.authoritative !== true) {
    fail("DNS_PREFLIGHT_CLOUDFLARE_NOT_AUTHORITATIVE");
  }
}

function expectedFactsDigest() {
  return sha256Bytes(canonicalJson(DNS_PREFLIGHT_FACTS));
}

export async function runDnsCutoverPreflight({
  commandRunner,
  now = new Date()
} = {}) {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) fail("DNS_PREFLIGHT_CLOCK_INVALID");
  const observedAt = now.toISOString();
  if (now.getTime() < CUTOFF_MS) {
    fail("DNS_PREFLIGHT_CUTOFF_NOT_REACHED");
  }
  if (
    !commandRunner || typeof commandRunner.run !== "function"
  ) {
    fail("DNS_PREFLIGHT_RUNNER_REQUIRED");
  }

  let queryCount = 0;
  for (const server of DNS_PREFLIGHT_FACTS.parentAuthorities) {
    const ds = await query(commandRunner, {
      server,
      name: DNS_PREFLIGHT_FACTS.domain,
      type: "DS",
      recursive: false
    });
    queryCount += 1;
    requireDsAbsent(ds, "DNS_PREFLIGHT_PARENT_DS_PRESENT");
    const ns = await query(commandRunner, {
      server,
      name: DNS_PREFLIGHT_FACTS.domain,
      type: "NS",
      recursive: false
    });
    queryCount += 1;
    exactValues(
      values(ns),
      DNS_PREFLIGHT_FACTS.currentNameservers,
      "DNS_PREFLIGHT_PARENT_DELEGATION_DRIFT"
    );
  }

  for (const server of DNS_PREFLIGHT_FACTS.publicResolvers) {
    const ds = await query(commandRunner, {
      server,
      name: DNS_PREFLIGHT_FACTS.domain,
      type: "DS",
      recursive: true
    });
    queryCount += 1;
    requireDsAbsent(ds, "DNS_PREFLIGHT_RESOLVER_DS_PRESENT");
    const ns = await query(commandRunner, {
      server,
      name: DNS_PREFLIGHT_FACTS.domain,
      type: "NS",
      recursive: true
    });
    queryCount += 1;
    exactValues(
      values(ns),
      DNS_PREFLIGHT_FACTS.currentNameservers,
      "DNS_PREFLIGHT_PUBLIC_DELEGATION_DRIFT"
    );
  }

  for (const server of DNS_PREFLIGHT_FACTS.cloudflareNameservers) {
    const checks = [
      [DNS_PREFLIGHT_FACTS.domain, "NS",
        DNS_PREFLIGHT_FACTS.cloudflareNameservers,
        "DNS_PREFLIGHT_CLOUDFLARE_NS_DRIFT"],
      [DNS_PREFLIGHT_FACTS.domain, "A",
        DNS_PREFLIGHT_FACTS.fallbackAddresses,
        "DNS_PREFLIGHT_CLOUDFLARE_A_DRIFT"],
      [`send.${DNS_PREFLIGHT_FACTS.domain}`, "MX",
        [DNS_PREFLIGHT_FACTS.sendMx],
        "DNS_PREFLIGHT_CLOUDFLARE_MX_DRIFT"],
      [`send.${DNS_PREFLIGHT_FACTS.domain}`, "TXT",
        [DNS_PREFLIGHT_FACTS.sendSpf],
        "DNS_PREFLIGHT_CLOUDFLARE_SPF_DRIFT"],
      [`resend._domainkey.${DNS_PREFLIGHT_FACTS.domain}`, "TXT",
        [DNS_PREFLIGHT_FACTS.resendDkim],
        "DNS_PREFLIGHT_CLOUDFLARE_DKIM_DRIFT"]
    ];
    for (const [name, type, expected, code] of checks) {
      const result = await query(commandRunner, {
        server,
        name,
        type,
        recursive: false
      });
      queryCount += 1;
      requireAuthoritative(result);
      exactValues(result.answerValues, expected, code);
      if (result.authorityValues.length !== 0) fail(code);
    }
    const ds = await query(commandRunner, {
      server,
      name: DNS_PREFLIGHT_FACTS.domain,
      type: "DS",
      recursive: false
    });
    queryCount += 1;
    requireAuthoritative(ds);
    requireDsAbsent(ds, "DNS_PREFLIGHT_CLOUDFLARE_DS_PRESENT");
  }

  if (queryCount !== 44) fail("DNS_PREFLIGHT_QUERY_COUNT_INVALID");
  return Object.freeze({
    schema: DNS_PREFLIGHT_RECEIPT_SCHEMA,
    ok: true,
    observedAt,
    cutoffAt: DNS_PREFLIGHT_CUTOFF,
    domain: DNS_PREFLIGHT_FACTS.domain,
    queryCount,
    authorities: Object.freeze({
      parent: DNS_PREFLIGHT_FACTS.parentAuthorities.length,
      recursive: DNS_PREFLIGHT_FACTS.publicResolvers.length,
      cloudflare: DNS_PREFLIGHT_FACTS.cloudflareNameservers.length
    }),
    checks: Object.freeze({
      cutoff: "passed",
      parentDs: "absent_all_13",
      recursiveDs: "absent_all_3",
      currentDelegation: "spaceship_pair_exact",
      cloudflareDelegation: "assigned_pair_exact",
      cloudflareFallback: "four_dns_only_a_exact",
      cloudflareMail: "send_mx_spf_resend_dkim_exact",
      cloudflareDs: "absent_both"
    }),
    expectedFactsDigest: expectedFactsDigest(),
    mutationAuthorized: false
  });
}
