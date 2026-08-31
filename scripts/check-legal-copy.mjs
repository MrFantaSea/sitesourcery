#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANNED_CUSTOMER_COPY,
  htmlToText,
  mainHtml,
  readingGrade,
  stripClosedDetails,
  words,
} from "./check-customer-copy.mjs";
import {
  PRIVACY_SECTION_IDS,
  TERMS_SECTION_IDS,
} from "./legal-section-ids.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const SELLER_IDENTITY = "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.";
const SELLER_IDENTITY_BY_FILE = Object.freeze({
  "legal/privacy/index.html": "Desiderata Labs LLC operates this website under the filed New Jersey alternate name SITESOURCERY. Site Sourcery is the brand presentation of SITESOURCERY. Desiderata Labs LLC is the legal seller.",
});
const SUMMARY_WORD_LIMIT = 26;
const SUMMARY_GRADE_LIMIT = 8;
const DEFAULT_VISIBLE_GRADE_LIMIT = 8.5;

const LEGAL_CLAUSE_DIGESTS = Object.freeze({
  "legal/index.html": Object.freeze({
    "current-product": "e2755ae06e771d6cc07d23f7e208ec9e3d070283e4aba1150f62b2c1a008d44f",
  }),
  "legal/privacy/index.html": Object.freeze({
    "operator": "62383f7f641ee17ac563ccc743b76f44605b7fc18e5651d3e439223ab971ff8e",
    "public-pages": "8fb6db213198a7dd5e5194560ebab2910f2ce68c66d7ee20ea523f8bedd95085",
    "accounts": "46053f73c2eadf928c1630847a32834dd33f7be46a794f8cc2a5f27e1bc1f7c2",
    "projects": "97b5bc793aaec50eccae3fe0e7adfc52684b5b6f05fae840c8eb07682df027b7",
    "published-sites": "9de07583286d4c9b6e412590f6766334d8d1e1557398788fa57bd9ddf5b35224",
    "hive-planner": "a04e01948f6b071e28430c213a968be70f39cf71d87aaae3a8802391bffbfa9f",
    "network-records": "b7279451fddd5d77f279916690662fade1b6dd425ef6f2c9b85fa83d11620c2b",
    "domains": "eebb67189a2f140a1474ff50c94e480591ba4f9b8875d175f26f915f27bdc12f",
    "billing": "302253bb2c3eab9135809da45e2a2ee136d274aec2274ff6da20694e2ebd4fcf",
    "retention": "b64a4e7a0a0116a9befe56aab7930c1b0290a90cecab896d68389d3b243adcdc",
    "safety-support": "51d33e15c109fdc3629af8bedd648b626d7bf6115fb36709e2329f0a28849832",
    "communications": "82317ea5a50f039a4dac1c929399c24fbbc3286bb038d27a7af3f4d937d5a2c8",
    "choices": "0a3e378d38122104023e52ea4e793b33b36aadf59c38d808cf0382887641d773",
    "security": "09e1365b1015e1d50bc34b56ffd1656b2e8155b116f2dff01ed6f3e696580de7",
    "changes": "a4cef0b60477478e5471d3cb7ad543853d21171fe1e53ee92cada5cbb6b67a1f",
    "contact": "07551c660983f830c823ed55567081452e702d6af9b8bbe3bc6cbbedd7a35a58",
  }),
  "legal/website-terms/index.html": Object.freeze({
    "acceptance": "f1c5901fd0a3e6053ab9796603b780896e1bbcdb47e85501edb9f4f8edecc370",
    "self-service": "01932472484125214a74e5af9fa4ab132604cd1230db140fd5a3c1b017e78d1f",
    "address-modes": "d913e52c7bcc64bac60aff12e4946d079433e196fd7d4c6f1d669d87133e6729",
    "customer-domains": "11a9310059aa5cb8c6ce1cc6bc8018c2d3e3ca08a8f70658858a068398f7d118",
    "billing-cancellation": "2aa7586c211fbffdb0399c9da02c1391cd14064f9c85c2b88311e374308444c6",
    "publication": "e399af58323f42ce50b3cf1a8172a851769bd143d6f337221c3f2ae83c21ab92",
    "customer-content": "5fa6dbffc0e4c54e84882096a5c831a41d48b08717152cd4c1568c855c751daa",
    "prohibited-uses": "5826a9ec8f03fb7842dd816bfc62cb2ff90b334d51a7e5e00d1fbaf3ae00e41e",
    "safety-holds": "51bc2295d80b5ea94e4f087cfeb4d2e2cd6fa8b0df34cb52e1cd42d39ad320d6",
    "custom-work": "d698e14977422177072f5e6846d0cc1669dc632a395ab257824ace30b70c3a77",
    "assessment": "e9d82d942d304c008af72ef2d8c0109a76522c5c26ec8e68c1c4747310b15f04",
    "hive-planner": "b7675fa092e67005e73626f70558b0a36609a7c483f488866965cc76cb2954a2",
    "care": "d937eb3d0edae3189c01f7038ce447c6acaa2ccb747e9433f0fc6829710175cd",
    "site-ownership": "a263b5a395522792b4723aa43b89abb61be551d823f00070ed6a77e9da47cfec",
    "warranty": "96406ff0d7e12fecfb57ec881731430227b62a9a93f1c84c3509792957be02c8",
    "limits": "0e505216c205278449e44aa3cd9cd844e25d183e1d9e45ab1366ef5c9c24e260",
    "changes-contact": "77c1170bff5ee40eaf036a2495902b416f9ae23014aa92f871af9950fbed958b",
  }),
});

export const LEGAL_COPY_ROUTES = Object.freeze([
  Object.freeze({
    route: "/legal/",
    file: "legal/index.html",
    topics: Object.freeze(["current-product"]),
    summaries: Object.freeze(["hero", "privacy", "terms", "contact"]),
    links: Object.freeze([
      "/legal/privacy/",
      "/legal/website-terms/",
      "tel:+18562441220",
      "mailto:sitesourcery@proton.me",
    ]),
    maxVisibleWords: 220,
  }),
  Object.freeze({
    route: "/legal/privacy/",
    file: "legal/privacy/index.html",
    topics: PRIVACY_SECTION_IDS,
    summaries: Object.freeze(["hero", ...PRIVACY_SECTION_IDS]),
    links: Object.freeze([
      ...PRIVACY_SECTION_IDS.map((id) => `#${id}`),
      "https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/",
      "tel:+18562441220",
      "mailto:sitesourcery@proton.me",
    ]),
    maxVisibleWords: 650,
  }),
  Object.freeze({
    route: "/legal/website-terms/",
    file: "legal/website-terms/index.html",
    topics: TERMS_SECTION_IDS,
    summaries: Object.freeze(["hero", ...TERMS_SECTION_IDS]),
    links: Object.freeze([
      ...TERMS_SECTION_IDS.map((id) => `#${id}`),
      "tel:+18562441220",
      "mailto:sitesourcery@proton.me",
    ]),
    maxVisibleWords: 700,
  }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function attributeValues(source, attribute) {
  const expression = new RegExp(`<[^>]+\\b${attribute}="([^"]+)"[^>]*>`, "giu");
  return [...source.matchAll(expression)].map((match) => match[1]);
}

function attributeContents(source, attribute) {
  const expression = new RegExp(
    `<([a-z][a-z0-9-]*)\\b[^>]*\\b${attribute}="([^"]+)"[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "giu",
  );
  return [...source.matchAll(expression)].map((match) => ({
    value: match[2],
    html: match[3],
    text: htmlToText(match[3]),
  }));
}

function mainLinks(source) {
  return [...mainHtml(source).matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/giu)]
    .map((match) => match[1]);
}

function identifiedH2s(source) {
  return [...source.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>/giu)]
    .map((match) => match[1]);
}

function exactOrder(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function analyzeLegalCopySource(file, source, routeConfig) {
  const main = mainHtml(source);
  const visibleText = htmlToText(stripClosedDetails(main));
  const topics = attributeValues(main, "data-legal-topic");
  const clauses = attributeContents(main, "data-legal-clause");
  const summaries = attributeContents(main, "data-legal-summary");
  const details = [...main.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/giu)].map((match) => {
    const topic = match[1].match(/\bdata-legal-topic="([^"]+)"/iu)?.[1] ?? "";
    const body = match[2];
    const summary = body.match(/^\s*<summary\b([^>]*)>([\s\S]*?)<\/summary>/iu);
    return {
      topic,
      openingAttributes: match[1],
      body,
      summaryAttributes: summary?.[1] ?? "",
      summaryHtml: summary?.[2] ?? "",
      summaryText: htmlToText(summary?.[2] ?? ""),
      summaryIsFirst: Boolean(summary),
    };
  });
  return {
    route: routeConfig.route,
    file,
    source,
    main,
    topics,
    clauses,
    clauseDigests: Object.fromEntries(clauses.map(({ value, text }) => [value, sha256(text)])),
    summaries,
    details,
    identifiedH2s: identifiedH2s(main),
    links: mainLinks(source),
    visibleWords: words(visibleText).length,
    visibleGrade: readingGrade(visibleText),
    visibleText,
  };
}

export function validateLegalCopyAnalysis(analysis, routeConfig) {
  const errors = [];
  const prefix = `${analysis.file}:`;
  const sellerIdentity = SELLER_IDENTITY_BY_FILE[analysis.file] ?? SELLER_IDENTITY;
  if (!analysis.source.includes(sellerIdentity)) {
    errors.push(`${prefix} missing exact legal seller identity`);
  }
  if (!exactOrder(analysis.topics, routeConfig.topics)) {
    errors.push(`${prefix} legal topics must exactly equal ${routeConfig.topics.join(", ")} in order`);
  }
  if (!exactOrder(analysis.clauses.map(({ value }) => value), routeConfig.topics)) {
    errors.push(`${prefix} substantive clause markers must exactly match every legal topic in order`);
  }
  if (!exactOrder(analysis.summaries.map(({ value }) => value), routeConfig.summaries)) {
    errors.push(`${prefix} plain-language summaries must exactly equal ${routeConfig.summaries.join(", ")} in order`);
  }
  if (routeConfig.topics.length > 1 && !exactOrder(analysis.identifiedH2s, routeConfig.topics)) {
    errors.push(`${prefix} stable legal section IDs must remain on h2 headings in order`);
  }
  if (!exactOrder(analysis.links, routeConfig.links)) {
    errors.push(`${prefix} main legal links changed; expected ${routeConfig.links.join(", ")}`);
  }
  const expectedDigests = LEGAL_CLAUSE_DIGESTS[analysis.file] ?? {};
  for (const topic of routeConfig.topics) {
    const expected = expectedDigests[topic];
    const actual = analysis.clauseDigests[topic];
    if (!expected || actual !== expected) {
      errors.push(`${prefix} substantive clause ${topic} changed`);
    }
  }
  for (const summary of analysis.summaries) {
    const count = words(summary.text).length;
    const grade = readingGrade(summary.text);
    if (count === 0 || count > SUMMARY_WORD_LIMIT) {
      errors.push(`${prefix} summary ${summary.value} is ${count} words; expected 1-${SUMMARY_WORD_LIMIT}`);
    }
    if (grade > SUMMARY_GRADE_LIMIT) {
      errors.push(`${prefix} summary ${summary.value} is grade ${grade}; maximum ${SUMMARY_GRADE_LIMIT}`);
    }
    for (const banned of BANNED_CUSTOMER_COPY) {
      if (banned.expression.test(summary.text)) {
        errors.push(`${prefix} summary ${summary.value} contains ${banned.label}`);
      }
    }
  }
  if (analysis.visibleWords > routeConfig.maxVisibleWords) {
    errors.push(`${prefix} default-visible copy is ${analysis.visibleWords} words; maximum ${routeConfig.maxVisibleWords}`);
  }
  if (analysis.visibleGrade > DEFAULT_VISIBLE_GRADE_LIMIT) {
    errors.push(`${prefix} default-visible copy is grade ${analysis.visibleGrade}; maximum ${DEFAULT_VISIBLE_GRADE_LIMIT}`);
  }
  for (const detail of analysis.details) {
    if (!detail.topic || !detail.summaryIsFirst || !detail.summaryText) {
      errors.push(`${prefix} every legal disclosure must start with a named native summary`);
      continue;
    }
    if (/\bopen(?:\s|=|$)/iu.test(detail.openingAttributes)) {
      errors.push(`${prefix} legal disclosure ${detail.topic} must be closed by default`);
    }
    if (/\b(?:autofocus|hidden|inert|tabindex)\b/iu.test(detail.openingAttributes)
      || /\b(?:autofocus|hidden|inert|role|tabindex)\b/iu.test(detail.summaryAttributes)) {
      errors.push(`${prefix} legal disclosure ${detail.topic} contains focus-changing attributes`);
    }
    if (/<(?:a|button|input|select|textarea)\b/iu.test(detail.summaryHtml)) {
      errors.push(`${prefix} legal disclosure ${detail.topic} nests an interactive control in summary`);
    }
    if (/<h2\b[^>]*\bid=/iu.test(detail.body)) {
      errors.push(`${prefix} legal disclosure ${detail.topic} hides a stable section heading`);
    }
  }
  if (/\bdata-legal-(?:toggle|target)\b/iu.test(analysis.main)) {
    errors.push(`${prefix} legal disclosures must not use scripted toggle or focus targets`);
  }
  return errors;
}

export async function inspectLegalCopy(root = DEFAULT_ROOT, options = {}) {
  const analyses = [];
  const errors = [];
  for (const routeConfig of LEGAL_COPY_ROUTES) {
    const source = await readFile(path.join(root, routeConfig.file), "utf8");
    const analysis = analyzeLegalCopySource(routeConfig.file, source, routeConfig);
    analyses.push(analysis);
    if (!options.reportOnly) errors.push(...validateLegalCopyAnalysis(analysis, routeConfig));
  }
  return { ok: errors.length === 0, errors, analyses };
}

function printReport(analyses, includeDigests = false) {
  process.stdout.write("route\tvisible words\tvisible grade\ttopics\n");
  for (const analysis of analyses) {
    process.stdout.write([
      analysis.route,
      analysis.visibleWords,
      analysis.visibleGrade.toFixed(1),
      analysis.topics.length,
    ].join("\t") + "\n");
    if (includeDigests) {
      process.stdout.write(`${analysis.file}\n${JSON.stringify(analysis.clauseDigests, null, 2)}\n`);
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const printDigests = args.has("--print-digests");
  const result = await inspectLegalCopy(DEFAULT_ROOT, { reportOnly: printDigests || args.has("--report") });
  printReport(result.analyses, printDigests);
  if (!result.ok) {
    process.stderr.write(`Legal-copy checks failed (${result.errors.length}):\n`);
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
  } else if (!printDigests && !args.has("--report")) {
    process.stdout.write("Legal-copy checks passed.\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
