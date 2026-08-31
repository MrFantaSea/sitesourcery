#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

export const CUSTOMER_COPY_ROUTES = Object.freeze([
  Object.freeze({ route: "/", file: "index.html", maxVisibleWords: 520, maxVisibleHeadings: 15, heroLinks: [1, 1] }),
  Object.freeze({ route: "/websites/", file: "websites/index.html", maxVisibleWords: 500, maxVisibleHeadings: 12, heroLinks: [1, 1] }),
  Object.freeze({ route: "/websites/made-for-you/", file: "websites/made-for-you/index.html", maxVisibleWords: 500, maxVisibleHeadings: 12, heroLinks: [1, 2] }),
  Object.freeze({ route: "/custom/", file: "custom/index.html", maxVisibleWords: 500, maxVisibleHeadings: 10, heroLinks: [1, 1] }),
  Object.freeze({ route: "/custom/scope/", file: "custom/scope/index.html", maxVisibleWords: 450, maxVisibleHeadings: 9, heroLinks: [1, 1] }),
  Object.freeze({ route: "/custom/process/", file: "custom/process/index.html", maxVisibleWords: 500, maxVisibleHeadings: 13, heroLinks: [1, 1] }),
  Object.freeze({ route: "/abracadabra/", file: "abracadabra/index.html", maxVisibleWords: 330, maxVisibleHeadings: 8, heroLinks: [1, 1] }),
  Object.freeze({ route: "/abracadabra/how/", file: "abracadabra/how/index.html", maxVisibleWords: 520, maxVisibleHeadings: 18, heroLinks: [1, 2] }),
  Object.freeze({ route: "/abracadabra/app/", file: "abracadabra/app/index.html", minVisibleWords: 40, maxVisibleWords: 950, maxVisibleHeadings: 18, heroLinks: [0, 1], requiresAudience: false, requiresOfferStatus: false }),
  Object.freeze({ route: "/hive/", file: "hive/index.html", maxVisibleWords: 650, maxVisibleHeadings: 18, heroLinks: [1, 1] }),
  Object.freeze({ route: "/solutions/", file: "solutions/index.html", maxVisibleWords: 520, maxVisibleHeadings: 15, heroLinks: [1, 1] }),
  Object.freeze({ route: "/domains/", file: "domains/index.html", maxVisibleWords: 650, maxVisibleHeadings: 16, heroLinks: [1, 2] }),
  Object.freeze({ route: "/work/", file: "work/index.html", maxVisibleWords: 390, maxVisibleHeadings: 10, heroLinks: [4, 4], requiresAudience: false, requiresOfferStatus: false }),
  Object.freeze({ route: "/about/", file: "about/index.html", maxVisibleWords: 410, maxVisibleHeadings: 8, heroLinks: [1, 1], requiresOfferStatus: false }),
  Object.freeze({ route: "/faq/", file: "faq/index.html", maxVisibleWords: 300, maxVisibleHeadings: 6, heroLinks: [1, 1] }),
  Object.freeze({ route: "/contact/", file: "contact/index.html", maxVisibleWords: 350, maxVisibleHeadings: 7, heroLinks: [1, 1] }),
  Object.freeze({ route: "/start/", file: "start/index.html", maxVisibleWords: 350, maxVisibleHeadings: 7, heroLinks: [1, 12] }),
  Object.freeze({ route: "/legal/", file: "legal/index.html", maxVisibleWords: 280, maxVisibleHeadings: 8, heroLinks: [0, 0], requiresAudience: false, requiresOfferStatus: false }),
  Object.freeze({ route: "/legal/privacy/", file: "legal/privacy/index.html", maxVisibleWords: 650, maxVisibleHeadings: 22, maxParagraphWords: 150, heroLinks: [0, 0], requiresAudience: false, requiresOfferStatus: false, legal: true }),
  Object.freeze({ route: "/legal/website-terms/", file: "legal/website-terms/index.html", maxVisibleWords: 750, maxVisibleHeadings: 24, maxParagraphWords: 150, heroLinks: [0, 0], requiresAudience: false, requiresOfferStatus: false, legal: true }),
  Object.freeze({ route: "/alakazam/", file: "alakazam/index.html", maxVisibleWords: 350, maxVisibleHeadings: 10, heroLinks: [1, 1] }),
  Object.freeze({ route: "/care/", file: "care/index.html", maxVisibleWords: 450, maxVisibleHeadings: 14, heroLinks: [1, 1] }),
  Object.freeze({ route: "/responder/", file: "responder/index.html", maxVisibleWords: 650, maxVisibleHeadings: 18, heroLinks: [1, 1] }),
  Object.freeze({ route: "/services/", file: "services/index.html", maxVisibleWords: 450, maxVisibleHeadings: 12, heroLinks: [1, 1] }),
]);

export const BANNED_CUSTOMER_COPY = Object.freeze([
  Object.freeze({ label: "control-plane jargon", expression: /\bcontrol plane\b/iu }),
  Object.freeze({ label: "data-plane jargon", expression: /\bdata plane\b/iu }),
  Object.freeze({ label: "release-gate jargon", expression: /\brelease gate\b/iu }),
  Object.freeze({ label: "public-truth jargon", expression: /\bpublic[ -]truth\b/iu }),
  Object.freeze({ label: "fail-closed jargon", expression: /\bfail(?:s|ed|ing)?[ -]closed\b/iu }),
  Object.freeze({ label: "storage implementation jargon", expression: /\bnon-(?:transactional|durable|authoritative)\b/iu }),
  Object.freeze({ label: "provider-side jargon", expression: /\bprovider-side\b/iu }),
  Object.freeze({ label: "release-candidate jargon", expression: /\brelease candidate\b/iu }),
  Object.freeze({ label: "scope-receipt jargon", expression: /\bscope receipt\b/iu }),
  Object.freeze({ label: "commercial-terms jargon", expression: /\bcommercial terms\b/iu }),
  Object.freeze({ label: "route-inventory jargon", expression: /\broute inventory\b/iu }),
  Object.freeze({ label: "internal held-state label", expression: /\bheld\b/iu }),
  Object.freeze({ label: "inquiry-only label", expression: /\binquiry[ -]only\b/iu }),
  Object.freeze({ label: "release-state jargon", expression: /\brelease state\b/iu }),
  Object.freeze({ label: "effect-state jargon", expression: /\beffect state\b/iu }),
  Object.freeze({ label: "provider-effects jargon", expression: /\bprovider effects?\b/iu }),
  Object.freeze({ label: "customer-proof jargon", expression: /\bcustomer proof(?: journey)?\b/iu }),
  Object.freeze({ label: "commercial-authority jargon", expression: /\bcommercial authority\b/iu }),
  Object.freeze({ label: "bounded jargon", expression: /\bbounded\b/iu }),
  Object.freeze({ label: "non-cash jargon", expression: /\bnon-cash\b/iu }),
  Object.freeze({ label: "exact-scope jargon", expression: /\bexact scope\b/iu }),
]);

const BLOCK_END = /<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|section|summary|ul)>/giu;
const WORD = /(?:[$]?\d+(?:[,.]\d+)*|[A-Za-z]+(?:[’'][A-Za-z]+)?)/gu;
const HEADING_WORD_LIMIT = 12;
const PARAGRAPH_WORD_LIMIT = 70;
const MIN_VISIBLE_WORDS = 70;
const MAX_VISIBLE_GRADE = 9.5;

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&hellip;/giu, "…")
    .replace(/&mdash;/giu, "—")
    .replace(/&ndash;/giu, "–")
    .replace(/&middot;/giu, "·")
    .replace(/&rarr;/giu, "→")
    .replace(/&larr;/giu, "←")
    .replace(/&nearr;/giu, "↗");
}

export function mainHtml(source) {
  return source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/iu)?.[1] ?? "";
}

export function stripClosedDetails(source) {
  let result = source;
  let previous = "";
  const closedDetails = /<details\b(?![^>]*\bopen(?:\s|=|>))[^>]*>[\s\S]*?<summary\b[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/giu;
  while (result !== previous) {
    previous = result;
    result = result.replace(closedDetails, "<summary>$1</summary>");
  }
  return result;
}

export function stripHiddenContent(source) {
  let result = source;
  let previous = "";
  const hiddenElement = /<([a-z][a-z0-9-]*)\b(?=[^>]*\b(?:hidden|inert)(?:\s|=|>))[^>]*>[\s\S]*?<\/\1>/giu;
  while (result !== previous) {
    previous = result;
    result = result.replace(hiddenElement, " ");
  }
  return result;
}

export function htmlToText(source) {
  return decodeEntities(
    source
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/giu, " ")
      .replace(BLOCK_END, ". ")
      .replace(/<br\s*\/?>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .replace(/\s+([.,!?;:])/gu, "$1")
    .trim();
}

export function words(value) {
  return value.match(WORD) ?? [];
}

function syllablesInWord(value) {
  const normalized = value.toLocaleLowerCase("en-US").replace(/[^a-z]/gu, "");
  if (!normalized) return 0;
  if (normalized.length <= 3) return 1;
  const withoutSilentEnding = normalized
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, "")
    .replace(/^y/u, "");
  return Math.max(1, withoutSilentEnding.match(/[aeiouy]{1,2}/gu)?.length ?? 1);
}

export function readingGrade(value) {
  const foundWords = words(value).filter((word) => /[A-Za-z]/u.test(word));
  if (foundWords.length === 0) return 0;
  const sentences = Math.max(
    1,
    value.split(/[.!?]+(?:\s|$)/u).filter((sentence) => words(sentence).length > 0).length,
  );
  const syllables = foundWords.reduce((total, word) => total + syllablesInWord(word), 0);
  const grade = (0.39 * (foundWords.length / sentences))
    + (11.8 * (syllables / foundWords.length))
    - 15.59;
  return Math.max(0, Number(grade.toFixed(1)));
}

function elements(source, name) {
  const expression = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "giu");
  return [...source.matchAll(expression)].map((match) => htmlToText(match[1]));
}

export function analyzeCustomerCopySource(file, source, routeConfig) {
  const main = mainHtml(source);
  const visible = stripHiddenContent(stripClosedDetails(main));
  const fullText = htmlToText(main);
  const visibleText = htmlToText(visible);
  const visibleHeadings = ["h1", "h2", "h3"].flatMap((name) => elements(visible, name));
  const allHeadings = ["h1", "h2", "h3"].flatMap((name) => elements(main, name));
  const firstSection = main.match(/<section\b[^>]*>[\s\S]*?<\/section>/iu)?.[0] ?? "";
  const heroCopy = firstSection.match(/<div\b[^>]*class="[^"]*hero-copy[^"]*"[^>]*>[\s\S]*?<\/div>/iu)?.[0]
    ?? firstSection;
  const heroText = htmlToText(firstSection);
  const heroLinks = firstSection.match(/<a\b/giu)?.length ?? 0;
  const paragraphs = elements(main, "p");
  const h1s = elements(main, "h1");
  return {
    route: routeConfig.route,
    file,
    fullWords: words(fullText).length,
    visibleWords: words(visibleText).length,
    visibleGrade: readingGrade(visibleText),
    visibleHeadings: visibleHeadings.length,
    allHeadings,
    h1s,
    heroText,
    heroLinks,
    paragraphs,
    fullText,
  };
}

export function validateCustomerCopyAnalysis(analysis, routeConfig) {
  const errors = [];
  const prefix = `${analysis.file}:`;
  if (analysis.h1s.length !== 1) {
    errors.push(`${prefix} expected exactly one h1; received ${analysis.h1s.length}`);
  }
  const minimumVisibleWords = routeConfig.minVisibleWords ?? MIN_VISIBLE_WORDS;
  if (analysis.visibleWords < minimumVisibleWords) {
    errors.push(`${prefix} default-visible copy is too thin: ${analysis.visibleWords} words; minimum ${minimumVisibleWords}`);
  }
  if (analysis.visibleWords > routeConfig.maxVisibleWords) {
    errors.push(`${prefix} default-visible copy is too long: ${analysis.visibleWords} words; maximum ${routeConfig.maxVisibleWords}`);
  }
  if (analysis.visibleHeadings > routeConfig.maxVisibleHeadings) {
    errors.push(`${prefix} too many default-visible headings: ${analysis.visibleHeadings}; maximum ${routeConfig.maxVisibleHeadings}`);
  }
  if (analysis.visibleGrade > MAX_VISIBLE_GRADE) {
    errors.push(`${prefix} default-visible reading grade is ${analysis.visibleGrade}; maximum ${MAX_VISIBLE_GRADE}`);
  }
  const [minimumHeroLinks, maximumHeroLinks] = routeConfig.heroLinks ?? [1, 1];
  if (analysis.heroLinks < minimumHeroLinks || analysis.heroLinks > maximumHeroLinks) {
    errors.push(`${prefix} first section must offer ${minimumHeroLinks === maximumHeroLinks ? minimumHeroLinks : `${minimumHeroLinks}-${maximumHeroLinks}`} useful link${maximumHeroLinks === 1 ? "" : "s"}; received ${analysis.heroLinks}`);
  }
  if (routeConfig.requiresAudience !== false && !/\b(?:business|businesses|owner|owners)\b/iu.test(analysis.heroText)) {
    errors.push(`${prefix} first section must say who the page is for`);
  }
  if (routeConfig.requiresOfferStatus !== false && !/(?:[$]\d+|\bfree\b|\bstart(?:s|ing)?\b|\bprice\w*|\bquote\w*|\bcurrent\w*|\bworks?\b|\bpaid\b|\bmonthly\b|\bplan\w*)/iu.test(analysis.heroText)) {
    errors.push(`${prefix} first section must state current price, quote, or availability status`);
  }
  for (const heading of analysis.allHeadings) {
    const count = words(heading).length;
    if (count > HEADING_WORD_LIMIT) {
      errors.push(`${prefix} heading is ${count} words; maximum ${HEADING_WORD_LIMIT}: ${JSON.stringify(heading)}`);
    }
  }
  const paragraphWordLimit = routeConfig.maxParagraphWords ?? PARAGRAPH_WORD_LIMIT;
  for (const paragraph of analysis.paragraphs) {
    const count = words(paragraph).length;
    if (count > paragraphWordLimit) {
      errors.push(`${prefix} paragraph is ${count} words; maximum ${paragraphWordLimit}: ${JSON.stringify(paragraph)}`);
    }
  }
  for (const banned of BANNED_CUSTOMER_COPY) {
    const match = analysis.fullText.match(banned.expression);
    if (match) {
      errors.push(`${prefix} contains ${banned.label}: ${JSON.stringify(match[0])}`);
    }
  }
  return errors;
}

async function sourceFor(root, routeConfig, gitRef) {
  if (!gitRef) return readFile(path.join(root, routeConfig.file), "utf8");
  const { stdout } = await execFileAsync(
    "git",
    ["show", `${gitRef}:${routeConfig.file}`],
    { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout;
}

export async function inspectCustomerCopy(root = DEFAULT_ROOT, options = {}) {
  const analyses = [];
  const errors = [];
  for (const routeConfig of CUSTOMER_COPY_ROUTES) {
    const source = await sourceFor(root, routeConfig, options.gitRef);
    const analysis = analyzeCustomerCopySource(routeConfig.file, source, routeConfig);
    analyses.push(analysis);
    if (!options.reportOnly) errors.push(...validateCustomerCopyAnalysis(analysis, routeConfig));
  }
  return { ok: errors.length === 0, errors, analyses };
}

function printReport(analyses) {
  process.stdout.write("route\tfull words\tvisible words\tvisible grade\tvisible headings\n");
  for (const analysis of analyses) {
    process.stdout.write([
      analysis.route,
      analysis.fullWords,
      analysis.visibleWords,
      analysis.visibleGrade.toFixed(1),
      analysis.visibleHeadings,
    ].join("\t") + "\n");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes("--report");
  const rootIndex = args.indexOf("--root");
  const requestedRoot = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  if (rootIndex >= 0 && !requestedRoot) throw new Error("--root requires a directory");
  const root = requestedRoot ? path.resolve(requestedRoot) : DEFAULT_ROOT;
  const refIndex = args.indexOf("--git-ref");
  const gitRef = refIndex >= 0 ? args[refIndex + 1] : undefined;
  if (refIndex >= 0 && !gitRef) throw new Error("--git-ref requires a value");
  const result = await inspectCustomerCopy(root, { reportOnly, gitRef });
  printReport(result.analyses);
  if (!result.ok) {
    process.stderr.write(`Customer-copy checks failed (${result.errors.length}):\n`);
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
  } else if (!reportOnly) {
    process.stdout.write("Customer-copy checks passed.\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
