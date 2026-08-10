import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "../immutable-evidence.mjs";
import {
  DNS_PREFLIGHT_CUTOFF,
  DNS_PREFLIGHT_FACTS,
  parseDigResponse,
  runDnsCutoverPreflight
} from "../dns-cutover-preflight.mjs";
import { main } from "../dns-cutover-preflight-cli.mjs";

const AFTER_CUTOFF = new Date("2026-08-10T23:48:36.001Z");

function quote(value) {
  const midpoint = Math.ceil(value.length / 2);
  return `"${value.slice(0, midpoint)}" "${value.slice(midpoint)}"`;
}

function baselineQuery({ server, name, type }) {
  const isParent = DNS_PREFLIGHT_FACTS.parentAuthorities.includes(server);
  const isResolver = DNS_PREFLIGHT_FACTS.publicResolvers.includes(server);
  const authoritative = !isResolver && !isParent;
  let section = "answer";
  let records = [];
  if (type === "NS") {
    records = isParent || isResolver
      ? DNS_PREFLIGHT_FACTS.currentNameservers
      : DNS_PREFLIGHT_FACTS.cloudflareNameservers;
    if (isParent) section = "authority";
  } else if (type === "A") {
    records = DNS_PREFLIGHT_FACTS.fallbackAddresses;
  } else if (type === "MX") {
    records = [DNS_PREFLIGHT_FACTS.sendMx];
  } else if (type === "TXT") {
    records = [name.startsWith("send.")
      ? DNS_PREFLIGHT_FACTS.sendSpf
      : DNS_PREFLIGHT_FACTS.resendDkim];
  }
  return { authoritative, section, records, status: "NOERROR" };
}

function digOutput(query) {
  const flags = query.authoritative ? "qr aa" : "qr rd ra";
  const lines = [
    `;; ->>HEADER<<- opcode: QUERY, status: ${query.status}, id: 1`,
    `;; flags: ${flags}; QUERY: 1, ANSWER: ${query.records.length}`
  ];
  if (query.records.length > 0) {
    lines.push(`;; ${query.section.toUpperCase()} SECTION:`);
    for (const value of query.records) {
      const rendered = query.type === "TXT"
        ? quote(value)
        : query.type === "NS" || query.type === "MX"
          ? `${value}.`
          : value;
      lines.push(`${query.name}. 300 IN ${query.type} ${rendered}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function fakeRunner({ alter } = {}) {
  const calls = [];
  return {
    calls,
    async run(specification) {
      calls.push(specification);
      const [serverArgument, name, type] = specification.args;
      const identity = {
        server: serverArgument.slice(1),
        name,
        type
      };
      const baseline = { ...baselineQuery(identity), ...identity };
      const selected = alter?.(baseline, calls.length) ?? baseline;
      if (selected.exitCode !== undefined) {
        return { exitCode: selected.exitCode, stdout: selected.stdout ?? "" };
      }
      return { exitCode: 0, stdout: digOutput(selected) };
    }
  };
}

test("preflight proves the exact injected 44-query public DNS matrix", async () => {
  const runner = fakeRunner();
  const receipt = await runDnsCutoverPreflight({
    commandRunner: runner,
    now: AFTER_CUTOFF
  });

  assert.equal(runner.calls.length, 44);
  assert.deepEqual(receipt.authorities, {
    parent: 13,
    recursive: 3,
    cloudflare: 2
  });
  assert.equal(receipt.observedAt, AFTER_CUTOFF.toISOString());
  assert.equal(receipt.cutoffAt, DNS_PREFLIGHT_CUTOFF);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.mutationAuthorized, false);
  assert.match(receipt.expectedFactsDigest, /^[a-f0-9]{64}$/u);
  for (const call of runner.calls) {
    assert.equal(call.command, "dig");
    assert.equal(call.timeoutMs, 5000);
    assert.equal(call.args.includes("+answer"), true);
    assert.equal(call.args.includes("+authority"), true);
  }
});

test("preflight refuses before cutoff without touching its runner", async () => {
  const runner = fakeRunner();
  await assert.rejects(
    runDnsCutoverPreflight({
      commandRunner: runner,
      now: new Date("2026-08-10T23:48:35.999Z")
    }),
    { code: "DNS_PREFLIGHT_CUTOFF_NOT_REACHED" }
  );
  assert.equal(runner.calls.length, 0);
});

test("the exact cutoff is accepted", async () => {
  const runner = fakeRunner();
  await runDnsCutoverPreflight({
    commandRunner: runner,
    now: new Date(DNS_PREFLIGHT_CUTOFF)
  });
  assert.equal(runner.calls.length, 44);
});

const driftCases = [
  {
    label: "parent DS",
    match: (query) => query.type === "DS" && query.server.startsWith("a."),
    records: ["2371 13 2 AABB"],
    code: "DNS_PREFLIGHT_PARENT_DS_PRESENT"
  },
  {
    label: "recursive DS",
    match: (query) => query.type === "DS" && query.server === "1.1.1.1",
    records: ["2371 13 2 AABB"],
    code: "DNS_PREFLIGHT_RESOLVER_DS_PRESENT"
  },
  {
    label: "parent delegation",
    match: (query) => query.type === "NS" && query.server.startsWith("a."),
    records: ["wrong.example.com"],
    code: "DNS_PREFLIGHT_PARENT_DELEGATION_DRIFT"
  },
  {
    label: "recursive delegation",
    match: (query) => query.type === "NS" && query.server === "1.1.1.1",
    records: ["wrong.example.com"],
    code: "DNS_PREFLIGHT_PUBLIC_DELEGATION_DRIFT"
  },
  {
    label: "assigned Cloudflare nameservers",
    match: (query) => query.type === "NS" && query.server.startsWith("jasmine."),
    records: ["wrong.example.com"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_NS_DRIFT"
  },
  {
    label: "Cloudflare apex address",
    match: (query) => query.type === "A",
    records: ["192.0.2.1"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_A_DRIFT"
  },
  {
    label: "send MX",
    match: (query) => query.type === "MX",
    records: ["20 wrong.example.com"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_MX_DRIFT"
  },
  {
    label: "send SPF",
    match: (query) => query.type === "TXT" && query.name.startsWith("send."),
    records: ["v=spf1 -all"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_SPF_DRIFT"
  },
  {
    label: "resend DKIM",
    match: (query) => query.type === "TXT" && query.name.startsWith("resend."),
    records: ["p=wrong"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_DKIM_DRIFT"
  },
  {
    label: "Cloudflare DS",
    match: (query) => query.type === "DS" && query.server.startsWith("jasmine."),
    records: ["2371 13 2 AABB"],
    code: "DNS_PREFLIGHT_CLOUDFLARE_DS_PRESENT"
  }
];

for (const drift of driftCases) {
  test(`preflight fails closed on ${drift.label} drift`, async () => {
    const runner = fakeRunner({
      alter(query) {
        return drift.match(query) ? { ...query, records: drift.records } : query;
      }
    });
    await assert.rejects(
      runDnsCutoverPreflight({ commandRunner: runner, now: AFTER_CUTOFF }),
      { code: drift.code }
    );
  });
}

test("preflight requires authoritative direct Cloudflare answers", async () => {
  const runner = fakeRunner({
    alter(query) {
      return query.type === "A" ? { ...query, authoritative: false } : query;
    }
  });
  await assert.rejects(
    runDnsCutoverPreflight({ commandRunner: runner, now: AFTER_CUTOFF }),
    { code: "DNS_PREFLIGHT_CLOUDFLARE_NOT_AUTHORITATIVE" }
  );
});

test("preflight maps command failures to one fixed code", async () => {
  const runner = fakeRunner({
    alter(query, count) {
      return count === 1 ? { ...query, exitCode: 9 } : query;
    }
  });
  await assert.rejects(
    runDnsCutoverPreflight({ commandRunner: runner, now: AFTER_CUTOFF }),
    { code: "DNS_PREFLIGHT_QUERY_FAILED" }
  );
});

test("dig parser joins bounded TXT chunks and rejects extra answer types", () => {
  const parsed = parseDigResponse(
    [
      ";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1",
      ";; flags: qr aa; QUERY: 1, ANSWER: 1",
      ";; ANSWER SECTION:",
      "send.sitesourcery.com. 300 IN TXT \"v=spf1 \" \"~all\""
    ].join("\n"),
    "TXT"
  );
  assert.deepEqual(parsed.answerValues, ["v=spf1 ~all"]);
  assert.deepEqual(
    parseDigResponse(
      [
        ";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1",
        ";; flags: qr aa; QUERY: 1, ANSWER: 1",
        ";; ANSWER SECTION:",
        "sitesourcery.com. 300 IN CNAME wrong.example.com."
      ].join("\n"),
      "A"
    ).unexpectedAnswerTypes,
    ["CNAME"]
  );
});

test("CLI writes only one canonical non-authorizing receipt with injected DNS", async () => {
  const runner = fakeRunner();
  let output = "";
  const receipt = await main({
    argv: [],
    now: AFTER_CUTOFF,
    commandRunner: runner,
    write(value) { output += value; }
  });
  assert.equal(output, `${canonicalJson(receipt)}\n`);
  assert.equal(JSON.parse(output).mutationAuthorized, false);
});

test("preflight sources contain no provider mutation or browser mechanism", async () => {
  const sources = await Promise.all([
    readFile(new URL("../dns-cutover-preflight.mjs", import.meta.url), "utf8"),
    readFile(new URL("../dns-cutover-preflight-cli.mjs", import.meta.url), "utf8")
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /\b(?:curl|fetch|https?|playwright|puppeteer|osascript)\b/iu);
  assert.doesNotMatch(joined, /(?:registrar|cloudflare)\s*(?:api|mutation)/iu);
  assert.match(joined, /mutationAuthorized:\s*false/u);
});
