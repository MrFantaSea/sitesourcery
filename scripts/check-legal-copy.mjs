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
} from "./check-site-vnext.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const SELLER_IDENTITY = "Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.";
const SUMMARY_WORD_LIMIT = 26;
const SUMMARY_GRADE_LIMIT = 8;
const DEFAULT_VISIBLE_GRADE_LIMIT = 8.5;

const LEGAL_CLAUSE_DIGESTS = Object.freeze({
  "legal/index.html": Object.freeze({
    "current-product": "b77fba2c1bd31df3efcb97e85fa4993548ebb1b812361fd02321dbb65d9defd6",
  }),
  "legal/privacy/index.html": Object.freeze({
    "operator": "e0a537583e3a66472ca277c99da549e1c338a9754882443a4186c51803dc109b",
    "public-pages": "36482a5904c55255726e1a2795b5095a55baa0bea9fe05d8629b32998de8f6be",
    "accounts": "29631227dcfc1d3b3a89e6421ad99af227bfb57ed305d4dc746cb67dfe009774",
    "projects": "5ee10badba58a8124d91b4defb286e91659dabf47cf3469ab0cf38ac3686e374",
    "published-sites": "833c6835cfeaf32688cd820206fd37ea1721529be6904ce4f22fcc57d9cd5fed",
    "hive-planner": "5509f3597490feb4de839cbd1318507998a2152da541da857e9b67fab16d1090",
    "network-records": "d7220c775fa5ba74608cfac9eeae55844208cc34bc7bfdb3797e2892b8de1229",
    "domains": "b3ec255517993a86e9fbf92744d39c8daf3ff9bd75a28d9ac6bbd46f9883678e",
    "billing": "c1434680407853b5d2caa8b93b0a8677de146a892bb2d69481141adc56bbaf07",
    "retention": "54a42061982a2e108df8fb24f6679ce92dc83a6497cd3488e5b056bc9cf0844a",
    "safety-support": "40975568cf405eb14d50a60cf1dd55ef957ff1d9173f0b2816ef4131af4726d6",
    "communications": "82317ea5a50f039a4dac1c929399c24fbbc3286bb038d27a7af3f4d937d5a2c8",
    "choices": "ac5587e4e44cec7ef0ad565b789f1f8b971402ec18c536bcc3b9b3e8698d4992",
    "security": "93b0e568b658a17d7c6823d5ad86b6020149681d7a5c23e8926c74b7b8e458e9",
    "changes": "3928c1a1acd04eeafe20d1e6382020a8bc3e58e8cf886aa95c55c8182877f199",
    "contact": "7c6c0e369333eadd80692fa57c9975475a829dffa91c421d46e3cda282c16a1a",
  }),
  "legal/website-terms/index.html": Object.freeze({
    "acceptance": "3e0cb616a7a18641d019a136fa243792cce0638cdf2f371f18a324586d9615b9",
    "self-service": "a85a60c61544cd631e478d774d2dd42f01d9a2c8a56c880456d92d0294995339",
    "address-modes": "636aefdf3a71810de55b38cdceb0eb2bc42266c514ca2956b3a7f6e5ef90c489",
    "customer-domains": "0aad314fc03ebeadc885d693d53a31dcb5150fce48c18f91993a2d20b32a088c",
    "billing-cancellation": "e60fba9404f17db8ca7aff1c001e92b68d765ee92590dda327dd42f95f94ab83",
    "publication": "bd06e078fd336989d3f5faf9d70b3d4cb877bd19605f092563d034c3e82f5e90",
    "customer-content": "0c6361644e5d6c0540b3286332e33f60ed18eaee6653b63d08ef44b3c351f218",
    "prohibited-uses": "5826a9ec8f03fb7842dd816bfc62cb2ff90b334d51a7e5e00d1fbaf3ae00e41e",
    "safety-holds": "51bc2295d80b5ea94e4f087cfeb4d2e2cd6fa8b0df34cb52e1cd42d39ad320d6",
    "custom-work": "c0dade91da88af7b873af72d4c9e6518b017f97ff4f57dbc43ea2a9594903b49",
    "assessment": "57c6bc7809dc7be0ef82eda3451e5617e42795c91a74e1c537fac04a0642e590",
    "hive-planner": "989d1641728ebd09d7e91bd3d9936b00d83d25a4d5331e9d7de40ef8206b69f2",
    "care": "fe996c75a6aef7cd599e83e2bd86d09e1d36406c7939286055e741c6ea93fc8f",
    "site-ownership": "a263b5a395522792b4723aa43b89abb61be551d823f00070ed6a77e9da47cfec",
    "warranty": "7eb26ae860e0d8d59e57cb4136f1bb3c4aadbb955fd5df7ab3cf001e4fe9e7d7",
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
  if (!analysis.source.includes(SELLER_IDENTITY)) {
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
