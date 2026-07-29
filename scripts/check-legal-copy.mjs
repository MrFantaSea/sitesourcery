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
    "operator": "fd9a76d382c2ac0cbdcf204e489774055f134bd8f2b6b4f4043b34412b5b82cc",
    "public-pages": "9909366b9ac5319535c08998ea7e5b5430ab859029621379e093ebbe06458228",
    "accounts": "3bac8386bb933c2b7c44b686787072922428e1d9427adb70308bc5612d6d5816",
    "projects": "7d55ae1dd5bb9d2b222a11460854d0aac32ecca1f21cfbaba376d5c2e5cbdd20",
    "published-sites": "73c1f68000ba7f123816c9a6e1bdf8b0544379ef1f56eb69a7be1ceb411cb42f",
    "hive-planner": "5509f3597490feb4de839cbd1318507998a2152da541da857e9b67fab16d1090",
    "network-records": "d7220c775fa5ba74608cfac9eeae55844208cc34bc7bfdb3797e2892b8de1229",
    "domains": "c461e36e83251e457840538e2aca0d36057dbc11f970afd22a05baf56707c65d",
    "billing": "c8f2a1c383726b7347f82dd0d8ebb644d62653d586c23affabd895dc58702be7",
    "retention": "7c7dba91f99e78a40f7a60a7fc5a1f5957a4f2b78f020bf95bf02205dd8067e3",
    "safety-support": "8519c4fbae1fc10d12d88bf7a48c03dc4c6febdd35068ba6e382afbd3cbc84d9",
    "communications": "0caeab8c706140334175ebf3f7a70efba9048dfbb2838146bcf9bbd16bca4440",
    "choices": "2a0ec3aadcdb85db0ab0b5bf38feb644de34824a3fc4717379b61494e7afa18c",
    "security": "c89369672c026ed516db7c39f9709dc8c587299d56ab1af6a1974319ec5a5700",
    "changes": "3928c1a1acd04eeafe20d1e6382020a8bc3e58e8cf886aa95c55c8182877f199",
    "contact": "7c2158dd83dacc7df5105497e41ec563315a4481d03bb7a07f72992d9e32dbf8",
  }),
  "legal/website-terms/index.html": Object.freeze({
    "acceptance": "19263c72f1b1891fd3f86626e4832766a14421f6bd8f57187b8e22eade32f9f2",
    "self-service": "fa369cf4311513317e71689ae26f681021087c19208d09314c11add0f6a1a0d9",
    "address-modes": "d0759f04c9266ed373998541e6a62ed401fc563db3817d62b8a8ae3c32f3fa87",
    "customer-domains": "57d140d96462e96febeb50f565e5533324cd281244d99c1660a6f09806eba501",
    "billing-cancellation": "0b43c4b677a225f6cc389bd0933cade249e8c116517319115d9302f22f1c8bc1",
    "publication": "0d6847ae79dceb9f73ebd6855e60b95ab0768e4d572b8359ae6ae701661a99ee",
    "customer-content": "e2e9924716d39721b9d0fb141d71792d2a91d30f7273fb5752ee17ab78292591",
    "prohibited-uses": "5826a9ec8f03fb7842dd816bfc62cb2ff90b334d51a7e5e00d1fbaf3ae00e41e",
    "safety-holds": "9a7cb2b3f3ee9fcc9fc97a43a7452b834874d8db5e4f0db1f993920b187eb3bd",
    "custom-work": "c0dade91da88af7b873af72d4c9e6518b017f97ff4f57dbc43ea2a9594903b49",
    "assessment": "028d386357a1dcb11f808c4c0f44e7ad35cfa34ef299b1b74b2ecbb96dd95fc9",
    "hive-planner": "989d1641728ebd09d7e91bd3d9936b00d83d25a4d5331e9d7de40ef8206b69f2",
    "care": "fe996c75a6aef7cd599e83e2bd86d09e1d36406c7939286055e741c6ea93fc8f",
    "site-ownership": "a263b5a395522792b4723aa43b89abb61be551d823f00070ed6a77e9da47cfec",
    "warranty": "f0b358aae96d5836b601ccb1fe572061052d39daa5156f0589253890ae156507",
    "limits": "0e505216c205278449e44aa3cd9cd844e25d183e1d9e45ab1366ef5c9c24e260",
    "changes-contact": "7df0113d9758595a69b7df903e6dcba4bce5d7a103f0b1bd89893dcb0e37ab09",
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
