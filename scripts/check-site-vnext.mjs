#!/usr/bin/env node

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildPagesArtifact,
  excludedTopLevel,
  publicFileAllowlist,
} from "./build-pages.mjs";
import {
  BRAND_IDENTITY_DISCLOSURE,
  CANONICAL_MAILBOX,
  CANONICAL_PHONE,
  CANONICAL_ROUTE_FILES,
  CANONICAL_ROUTES,
  FUNCTIONAL_APP_ROUTE_FILES,
  LEGACY_REDIRECTS,
  LEGAL_SELLER,
  SITE_ORIGIN,
  validateRouteContract,
} from "./check-routes.mjs";

export const HOME_DOORS = Object.freeze(["custom", "abracadabra", "hive"]);
export const HIVE_CELLS = Object.freeze([
  "missed-call",
  "booking",
  "review-request",
  "after-hours",
  "follow-up",
  "getting-paid",
]);
export const SOLUTION_ANCHORS = Object.freeze([
  "assessment",
  "foundations",
  "care",
  "domains",
  "email",
  "commerce",
  "interfaces",
  "studio",
  "network",
]);
export const START_PATHS = Object.freeze(["website", "system", "service"]);
export const ARTIFACT_SIZE_BUDGETS = Object.freeze({
  total: 4 * 1024 * 1024,
  html: 48 * 1024,
  css: 96 * 1024,
  javascript: 96 * 1024,
  image: 640 * 1024,
});
export const START_DECISION_COPY = Object.freeze([
  "website-new",
  "website-replace",
  "website-self-service",
  "replace-redirects",
  "replace-migration",
  "replace-cutover",
  "replace-uncertain",
  "No old links or content need to move, and no host or domain switch is needed",
  "I will type in the facts myself",
  "Make and download one real web page from facts you type into this browser",
  "It does not put the page online, replace an old site, move content, change a domain, connect outside tools, or include human revisions",
  "detailTrail",
  "showPreviousDetail",
  "focusAndReveal",
  "data-start-reveal",
  "start-chooser-page",
  "window.scrollTo",
]);
export const ABOUT_TRUST_FACTS = Object.freeze(["base", "established", "operator", "seller"]);
export const ABOUT_PROOFS = Object.freeze(["work", "scope", "abracadabra", "hive"]);
export const CUSTOM_TIERS = Object.freeze([
  "card",
  "card-plus",
  "site",
  "site-plus",
  "signature",
  "flagship",
  "scale",
]);
export const CUSTOM_CREATIVITY = Object.freeze(["essential", "distinctive", "atelier"]);
export const CUSTOM_CREATIVE_PROOFS = Object.freeze(["essential", "distinctive", "atelier"]);
export const CUSTOM_COMPONENTS = Object.freeze([
  "basic_form",
  "standard_tool",
  "hosted_provider",
  "static_collection",
  "copy_expansion",
  "additional_connection",
  "extra_revision_round",
  "priority_production_window",
]);
export const CUSTOM_PROCESS_PHASES = Object.freeze([
  "intake",
  "scope",
  "direction",
  "production",
  "release",
  "closeout",
]);
export const CUSTOM_QUOTE_FIELDS = Object.freeze([
  "outcome",
  "footprint",
  "direction",
  "systems",
  "transition",
  "responsibilities",
  "schedule",
  "commercial",
  "handoff",
]);
export const PRIVACY_SECTION_IDS = Object.freeze([
  "operator",
  "public-pages",
  "accounts",
  "projects",
  "published-sites",
  "hive-planner",
  "network-records",
  "domains",
  "billing",
  "retention",
  "safety-support",
  "communications",
  "choices",
  "security",
  "changes",
  "contact",
]);
export const TERMS_SECTION_IDS = Object.freeze([
  "acceptance",
  "self-service",
  "address-modes",
  "customer-domains",
  "billing-cancellation",
  "publication",
  "customer-content",
  "prohibited-uses",
  "safety-holds",
  "custom-work",
  "assessment",
  "hive-planner",
  "care",
  "site-ownership",
  "warranty",
  "limits",
  "changes-contact",
]);
export const FAQ_ANCHORS = Object.freeze([
  "paths",
  "abracadabra-now",
  "address-choices",
  "private-sites",
  "missed-payment",
  "custom-scope",
  "custom-payment",
  "custom-timing",
  "ownership",
  "assessment",
  "care",
  "hive-planner",
  "getting-started",
]);
export const HOME_HIVE_COPY = Object.freeze([
  "Six plans you can inspect",
  "The planner does not turn anything on. A separate project is required to build a working system.",
]);
export const HOME_ABRACADABRA_COPY = Object.freeze([
  "Works in this browser",
  "Makes and downloads a real web page.",
  "It does not put the site online or take payment.",
]);
export const ABRACADABRA_STATE_BADGE = Object.freeze([
  "Local working rehearsal",
  "Makes and downloads real HTML",
  "does not host, charge, email, or change DNS",
]);
export const ABRACADABRA_PRODUCT_COPY = Object.freeze({
  "/abracadabra/": Object.freeze([
    "One-page website builder",
    "Build your website. See it before you pay.",
    "No account to start",
    "Your details stay yours",
    "Your domain stays yours",
    "Finish one step and the next one opens",
    "Keep the site your way.",
    "Rent",
    "Own",
    "Own + managed",
    "exact price and what is included appear before payment",
    "Build my page",
  ]),
  "/abracadabra/how/": Object.freeze([
    "From business details to a live page.",
    "Build first.",
    "Your account opens one next step at a time.",
    "You see the price and terms before payment.",
    "Pick Rent, Own, or Own + managed.",
    "A domain purchase is also reviewed before it is submitted.",
    "Open only the answer you need.",
  ]),
  "/abracadabra/app/": Object.freeze([
    "Build first. Choose a plan when you want to keep it.",
    "Your work stays under your control",
    "Finish one short step to open the next.",
    "Use a Site Sourcery address",
    "Use your own domain",
    "The price is shown before payment.",
    "See the exact price, renewal terms, and what is included.",
    "Project versions",
    "Export or leave",
    "No account is required to build and test the first version.",
    "Save and continue",
  ]),
});
export const PUBLIC_TRUTH_COPY = Object.freeze({
  "/faq/": Object.freeze([
    "Abracadabra works only in this browser",
    "it makes a real page you can download",
    "it does not put the page online or take payment",
    "Abracadabra currently works only in this browser.",
    "It does not create an online account, publish a site, take payment, send email, or change a domain.",
  ]),
  "/legal/": Object.freeze([
    "filed alternate name SITESOURCERY",
    "brand presentation of the filed alternate name SITESOURCERY",
    "current device-local Abracadabra rehearsal",
    "separately released hosted service",
  ]),
  "/legal/privacy/": Object.freeze([
    "Desiderata Labs LLC operates this website under the filed alternate name",
    "Site Sourcery is the brand presentation of SITESOURCERY",
    "publication, rollback, suspension, and access control are device-local rehearsal states",
    "creates no public Internet address",
    "does not perform that handling",
    "may darken only the local viewer",
    "does not contact a reviewer or support person, suspend a provider site",
    "Local rehearsal history is not provider or reviewer history",
  ]),
  "/legal/website-terms/": Object.freeze([
    "browsing them does not record affirmative acceptance",
    "That local acceptance does not accept provider hosting",
    "Publish accepted version",
    "changes only local project state",
    "does not place the website on the public Internet",
    "Desiderata Labs LLC does not receive or store it through the current on-device maker",
    "separately accepts a hosted service",
    "can darken only its local viewer",
    "does not contact a reviewer, suspend a provider site",
    "A local rehearsal event is not evidence that any hosted review or enforcement occurred",
  ]),
  "/about/": Object.freeze([
    "brand presentation of the filed alternate name",
    "SITESOURCERY",
    "Desiderata Labs LLC",
  ]),
});
export const BUSINESS_EMAIL_COPY = Object.freeze({
  "/solutions/": Object.freeze([
    "role addresses",
    "domain authentication",
    "controlled routing",
    "recoverable access",
    "clean migration and exit plan",
    "Custody and exit documentation",
  ]),
  "/contact/": Object.freeze([
    'data-business-email="public-intake"',
    "This is Site Sourcery’s current public email address.",
    "copy the address above",
  ]),
});
const RETIRED_PUBLIC_TRUTH_COPY = Object.freeze([
  "Using the ordinary public pages accepts these terms for that use.",
  "A public release can be opened by anyone who knows its address.",
  "The customer grants Desiderata Labs LLC the limited permission needed to store, compile, publish, protect, and export",
  "Site Sourcery is an alternate name of Desiderata Labs LLC.",
  "Desiderata Labs LLC d/b/a Site Sourcery",
]);

const HOME_DOOR_HREFS = Object.freeze({
  custom: "/custom/",
  abracadabra: "/abracadabra/",
  hive: "/hive/",
});
const REQUIRED_RELEASE_FLAGS = Object.freeze([
  "allowsDeployment",
  "allowsCommercialDeployment",
  "allowsContainmentDeployment",
  "allowsPublicTruthReconciliationDeployment",
]);
const EXCLUDED_ARTIFACT_TOP_LEVEL = Object.freeze([
  ".git",
  ".github",
  ".gitignore",
  ".htmlvalidate.json",
  ".nvmrc",
  "_site",
  "data",
  "flyer.html",
  "node_modules",
  "package-lock.json",
  "package.json",
  "print-collateral",
  "QUALITY.md",
  "scripts",
]);
const PUBLIC_ALLOWLIST_COUNT = 67;
const SOURCE_ONLY_LEGACY_REDIRECT = "thanks.html";
const EXPECTED_ARTIFACT_ROUTE_ERROR =
  "thanks.html: missing legacy redirect to /contact/";
const PROHIBITED_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".xml"]);
const CSS_VALUE_ATTRIBUTES = new Set([
  "clip-path",
  "fill",
  "filter",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "stroke",
  "style",
]);
const PRICE = /(?:[$£€¥]\s*\d|\b(?:USD|EUR|GBP|CAD|AUD)\s*\d|\bUS\$\s*\d|\b\d+(?:\.\d+)?\s*(?:\/\s*(?:mo|month|yr|year)\b|per\s+(?:month|year)\b))/iu;
const PRICE_ATTRIBUTE = /(?:\bdata-(?:price|monthly|minimum|premium|rate|amount|cost|fee)[a-z-]*\s*=|"(?:price|lowPrice|highPrice|priceCurrency)"\s*:)/iu;
const APPROVED_PUBLIC_PRICE_CLAIMS = Object.freeze({
  "faq/index.html": Object.freeze(["$350 website assessment"]),
  "legal/website-terms/index.html": Object.freeze(["$350 website assessment"]),
  "solutions/index.html": Object.freeze(["$350 website assessment"]),
});
const OFFER = /(?:"@type"\s*:\s*(?:\[[^\]]*?"Offer"|"Offer")|schema\.org\/Offer\b|\bitemtype\s*=\s*["'][^"']*\/Offer\b|\bitemprop\s*=\s*["'](?:price|priceCurrency)["'])/iu;
const PAYMENT_ENDPOINT = /(?:buy\.stripe\.com|checkout\.stripe\.com|js\.stripe\.com|api\.stripe\.com|paypal\.com|paypalobjects\.com|braintreegateway\.com|checkout\.com|squareup\.com|square\.link|payment_intent|createCheckoutSession|apple-pay|google-pay)/iu;
const NETWORK_SINK = /\b(?:fetch\s*\(|XMLHttpRequest\b|sendBeacon\s*\(|WebSocket\s*\(|EventSource\s*\(|RTCPeerConnection\b|importScripts\s*\(|new\s+(?:Shared)?Worker\s*\()/u;
const EXTERNAL_MODULE = /\bimport\s*(?:(?:[^"'`;]*?\sfrom\s*)?["']https?:\/\/|\(\s*["']https?:\/\/)/u;
const SUBMISSION_SINK = /\b(?:requestSubmit|submit)\s*\(|\bFormData\s*\(/u;
const STORAGE_SINK = /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|caches\s*\.|CacheStorage|document\s*\.\s*cookie)\b/u;
const DYNAMIC_RESOURCE_SINK = /document\s*\.\s*createElement\s*\(\s*["'](?:script|iframe)["']/u;
const FILE_ACCESS = /(?:<input\b[^>]*\btype\s*=\s*["']?file\b|\bFileReader\b|\bshowOpenFilePicker\s*\()/iu;
const PROHIBITED_COPY = Object.freeze([
  Object.freeze({ label: "excluded DAARX name", expression: /\bdaarx\b/iu }),
  Object.freeze({ label: "excluded Pride Pot name", expression: /\bpride[\s_-]*pot\b/iu }),
  Object.freeze({ label: "retired Hive Heart Home name", expression: /\bhive[\s_-]*heart[\s_-]*home\b/iu }),
  Object.freeze({ label: "coming-soon language", expression: /\bcoming[\s-]+soon\b/iu }),
  Object.freeze({ label: "future-state language", expression: /\bfuture\b/iu }),
  Object.freeze({ label: "pre-launch language", expression: /\bpre[\s-]*launch\b/iu }),
  Object.freeze({ label: "waitlist language", expression: /\bwait[\s-]*list\b/iu }),
  Object.freeze({ label: "unavailable language", expression: /\bunavailable\b/iu }),
]);
const STORAGE_ALLOWED_FILES = new Set([
  "abracadabra/app/abracadabra-control.js",
  "abracadabra/platform/abracadabra-platform.js",
  "abracadabra/site/viewer.js",
]);
const RETIRED_ABRACADABRA_PRODUCT_COPY = Object.freeze([
  "The whole path",
  "exact four-step Abracadabra flow",
  "refreshing or closing clears them",
  "Your draft and in-session versions stay in this tab",
  "already-made versions remain available in the current tab",
  "I want to make a private page",
  "complete browser-based Spark maker",
  "Open Spark",
  "non-transactional",
  "authoritative hosted persistence",
  "Local candidate boundary",
  "Rehearse plan activation",
  "Simulate missed payment",
  "Multi-tab writing is unsupported",
]);
const RETIRED_HOME_HIVE_COPY = Object.freeze([
  "Ready-made and commissioned systems",
  "Start with After-Hours for missed calls",
]);

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function report(errors, file, message) {
  errors.push(`${file}: ${message}`);
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => lexical(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = posix(path.relative(root, absolute));
    if (entry.isSymbolicLink()) {
      files.push({ relative, kind: "symlink" });
    } else if (entry.isDirectory()) {
      files.push(...await walkFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push({ relative, kind: "file" });
    } else {
      files.push({ relative, kind: "other" });
    }
  }
  return files;
}

function parseAttributes(raw) {
  const attributes = new Map();
  const expression = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of raw.matchAll(expression)) {
    const name = match[1].toLowerCase();
    if (attributes.has(name)) throw new Error(`duplicate HTML attribute ${name}`);
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function openingTags(source) {
  const found = [];
  for (const match of source.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/giu)) {
    found.push({
      name: match[1].toLowerCase(),
      attributes: parseAttributes(match[2]),
      raw: match[0],
    });
  }
  return found;
}

function markedElements(file, source, attribute, errors) {
  try {
    return openingTags(source)
      .filter(({ attributes }) => attributes.has(attribute))
      .map(({ name, attributes }) => ({
        name,
        value: attributes.get(attribute),
        href: attributes.get("href"),
        id: attributes.get("id"),
      }));
  } catch (error) {
    report(errors, file, error.message);
    return [];
  }
}

function checkExactValues(file, label, actual, expected, errors) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    report(errors, file, `${label} must exactly equal ${expected.join(", ")} in order; received ${actual.join(", ")}`);
  }
  if (new Set(actual).size !== actual.length) report(errors, file, `${label} values must be unique`);
}

function checkHomeDoors(source, errors) {
  const file = "index.html";
  const doors = markedElements(file, source, "data-home-door", errors);
  checkExactValues(file, "home doors", doors.map(({ value }) => value), HOME_DOORS, errors);
  for (const door of doors) {
    const expectedHref = HOME_DOOR_HREFS[door.value];
    if (door.name !== "a" || door.href !== expectedHref) {
      report(errors, file, `home door ${door.value} must be an anchor to ${expectedHref ?? "no route"}`);
    }
  }
  const lowerSource = source.toLocaleLowerCase("en-US");
  for (const phrase of HOME_HIVE_COPY) {
    if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `missing Hive planning-versus-commission copy ${JSON.stringify(phrase)}`);
    }
  }
  for (const phrase of HOME_ABRACADABRA_COPY) {
    if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `missing plain-language Abracadabra state copy ${JSON.stringify(phrase)}`);
    }
  }
  for (const phrase of RETIRED_HOME_HIVE_COPY) {
    if (lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
      report(errors, file, `contains retired Hive product model ${JSON.stringify(phrase)}`);
    }
  }
}

function checkHiveCells(source, errors) {
  const file = "hive/index.html";
  const cells = markedElements(file, source, "data-hive-cell", errors);
  checkExactValues(file, "Hive planner cells", cells.map(({ value }) => value), HIVE_CELLS, errors);
}

function checkSolutionAnchors(source, errors) {
  const file = "solutions/index.html";
  const anchors = markedElements(file, source, "data-solution-anchor", errors);
  checkExactValues(file, "solution anchors", anchors.map(({ value }) => value), SOLUTION_ANCHORS, errors);
  for (const anchor of anchors) {
    if (anchor.id !== anchor.value) {
      report(errors, file, `solution anchor ${anchor.value} must carry matching id="${anchor.value}"`);
    }
  }
}

function checkStartPaths(source, errors) {
  const file = "start/index.html";
  const paths = markedElements(file, source, "data-start-path", errors);
  checkExactValues(file, "Start chooser paths", paths.map(({ value }) => value), START_PATHS, errors);
  for (const pathChoice of paths) {
    if (pathChoice.name !== "button" || pathChoice.href != null) {
      report(
        errors,
        file,
        `Start chooser path ${pathChoice.value} must be a button without navigation fallback`,
      );
    }
  }
  for (const marker of [
    '<h2 data-start-question tabindex="-1">',
    'data-start-result role="status" aria-live="polite" tabindex="-1"',
  ]) {
    if (!source.includes(marker)) {
      report(errors, file, `missing Start focus or live-region semantics ${JSON.stringify(marker)}`);
    }
  }
}

function checkStartDecisionLogic(source, errors) {
  const file = "vnext.js";
  for (const phrase of START_DECISION_COPY) {
    if (!source.includes(phrase)) {
      report(errors, file, `missing fail-closed Start decision marker ${JSON.stringify(phrase)}`);
    }
  }
  for (const forbidden of [
    'key: "abracadabra",\n            label: "Let me make it"',
    "Make a new one or replace the one I have.",
    "There is no existing site, URL inventory, or content that must survive.",
    "focusWithoutScroll",
  ]) {
    if (source.includes(forbidden)) {
      report(errors, file, `contains retired Start migration logic ${JSON.stringify(forbidden)}`);
    }
  }
}

function checkStartMotionContract(source, errors) {
  const file = "vnext.css";
  for (const marker of [
    "html.start-chooser-page",
    "overflow-anchor: none",
    ".js .start-chooser.reveal",
    "transition: none",
  ]) {
    if (!source.includes(marker)) {
      report(errors, file, `missing layout-stable Start chooser marker ${JSON.stringify(marker)}`);
    }
  }
}

function checkAbracadabraShowcaseCopy(source, errors) {
  const file = "abracadabra/abracadabra-showcase.js";
  const failureCopy = "The generated example did not open. Reload this page to try again.";
  if (source.split(failureCopy).length - 1 !== 2) {
    report(errors, file, "generated-example failure status must remain exact in both runtime paths");
  }
  if (!source.includes(" generated example ready.")) {
    report(errors, file, "missing exact generated-example success status");
  }
  if (source.toLocaleLowerCase("en-US").includes("live example")) {
    report(errors, file, "contains retired live-example runtime status");
  }
}

function checkPublicTruthCoherence(routeSources, errors) {
  for (const [route, phrases] of Object.entries(PUBLIC_TRUTH_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    for (const phrase of phrases) {
      if (!entry.source.includes(phrase)) {
        report(errors, entry.file, `missing filed-name or local-versus-hosted truth ${JSON.stringify(phrase)}`);
      }
    }
  }
  for (const { file, source } of routeSources.values()) {
    for (const phrase of RETIRED_PUBLIC_TRUTH_COPY) {
      if (source.includes(phrase)) {
        report(errors, file, `contains retired public-truth statement ${JSON.stringify(phrase)}`);
      }
    }
  }
}

function checkBusinessEmailCoherence(routeSources, errors) {
  for (const [route, phrases] of Object.entries(BUSINESS_EMAIL_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    for (const phrase of phrases) {
      if (!entry.source.includes(phrase)) {
        report(errors, entry.file, `missing business-email custody copy ${JSON.stringify(phrase)}`);
      }
    }
  }
  for (const { file, source } of routeSources.values()) {
    if (/personal mailbox as (?:its|your|the) public identity/iu.test(source)) {
      report(errors, file, "contains judgmental personal-mailbox copy");
    }
  }
}

function checkCustomCatalogSurface(source, errors) {
  const file = "custom/scope/index.html";
  const tiers = markedElements(file, source, "data-custom-tier", errors);
  checkExactValues(file, "Custom footprint tiers", tiers.map(({ value }) => value), CUSTOM_TIERS, errors);
  const creativity = markedElements(file, source, "data-creative-level", errors);
  checkExactValues(
    file,
    "Custom creative levels",
    creativity.map(({ value }) => value),
    CUSTOM_CREATIVITY,
    errors,
  );
  const creativeProofs = markedElements(file, source, "data-creative-proof", errors);
  checkExactValues(
    file,
    "Custom creative proof variants",
    creativeProofs.map(({ value }) => value),
    CUSTOM_CREATIVE_PROOFS,
    errors,
  );
  const components = markedElements(file, source, "data-custom-component", errors);
  checkExactValues(
    file,
    "Custom component shelf",
    components.map(({ value }) => value),
    CUSTOM_COMPONENTS,
    errors,
  );
  const scaleMarker = 'data-custom-tier="scale" data-pages="30" data-scale-base="flagship" data-scale-min-units="1" data-scale-max-units="15" data-scale-unit-pages="1" data-scale-unit-sections="4" data-scale-unit-layouts="1" data-scale-unit-words="500" data-scale-unit-media="4"';
  if (!source.includes(scaleMarker)) {
    report(errors, file, "Scale must expose the exact non-price Flagship-plus-capacity-unit rule");
  }
}

function checkCustomProcess(source, errors) {
  const file = "custom/process/index.html";
  const phases = markedElements(file, source, "data-process-phase", errors);
  checkExactValues(
    file,
    "Custom process phases",
    phases.map(({ value }) => value),
    CUSTOM_PROCESS_PHASES,
    errors,
  );
  const quoteFields = markedElements(file, source, "data-receipt-field", errors);
  checkExactValues(
    file,
    "Custom quote anatomy fields",
    quoteFields.map(({ value }) => value),
    CUSTOM_QUOTE_FIELDS,
    errors,
  );
  if (!source.includes('data-process-mechanics="review-change-schedule"')) {
    report(errors, file, "Custom process must retain explicit review, change, and schedule mechanics");
  }
}

function checkCssTypeFloor(file, source, errors) {
  const customProperties = new Map();
  for (const match of source.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;{}]+)/giu)) {
    customProperties.set(match[1], match[2].trim());
  }

  function resolveValue(raw, visited = new Set()) {
    const value = raw.trim().replace(/\s*!important\s*$/iu, "");
    const variable = /^var\(\s*(--[a-z0-9_-]+)(?:\s*,[\s\S]*)?\)$/iu.exec(value);
    if (!variable) return value;
    if (visited.has(variable[1]) || !customProperties.has(variable[1])) return null;
    visited.add(variable[1]);
    return resolveValue(customProperties.get(variable[1]), visited);
  }

  function firstFunctionArgument(value, name) {
    const prefix = `${name}(`;
    if (!value.toLocaleLowerCase("en-US").startsWith(prefix)) return null;
    let depth = 0;
    for (let index = prefix.length; index < value.length; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") depth -= 1;
      else if (value[index] === "," && depth === 0) {
        return value.slice(prefix.length, index).trim();
      }
    }
    return null;
  }

  function pixels(value) {
    const resolved = resolveValue(value);
    if (!resolved) return null;
    const clampMinimum = firstFunctionArgument(resolved, "clamp");
    if (clampMinimum) return pixels(clampMinimum);
    const match = /^(-?[0-9]*\.?[0-9]+)\s*(px|rem|em|%)$/iu.exec(resolved);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    if (match[2].toLowerCase() === "px") return amount;
    if (match[2] === "%") return amount * 0.16;
    return amount * 16;
  }

  for (const declaration of source.matchAll(/\b(font-size|font)\s*:\s*([^;{}]+)/giu)) {
    const property = declaration[1].toLowerCase();
    const rawValue = declaration[2].trim();
    let candidate = rawValue;
    if (property === "font") {
      const functionValue = /(clamp\([^;{}]+\)|var\([^;{}]+\))/iu.exec(rawValue);
      const literalValue = /(-?[0-9]*\.?[0-9]+\s*(?:px|rem|em|%))/iu.exec(rawValue);
      candidate = functionValue?.[1] ?? literalValue?.[1] ?? "";
    }
    if (!candidate) continue;
    const computedPixels = pixels(candidate);
    if (computedPixels !== null && computedPixels < 12) {
      report(errors, file, `public text size ${JSON.stringify(candidate)} is below the 12px floor`);
    } else if (
      computedPixels === null
      && /^(?:var|calc|min|max)\(/iu.test(candidate)
    ) {
      report(errors, file, `public text size ${JSON.stringify(candidate)} cannot prove the 12px floor`);
    }
  }
}

function checkAboutTrust(source, errors) {
  const file = "about/index.html";
  const facts = markedElements(file, source, "data-about-trust", errors);
  checkExactValues(
    file,
    "About verified trust facts",
    facts.map(({ value }) => value),
    ABOUT_TRUST_FACTS,
    errors,
  );
  const proofs = markedElements(file, source, "data-about-proof", errors);
  checkExactValues(
    file,
    "About inspectable proof routes",
    proofs.map(({ value }) => value),
    ABOUT_PROOFS,
    errors,
  );
  const expectedHrefs = new Map([
    ["work", "/work/"],
    ["scope", "/custom/scope/"],
    ["abracadabra", "/abracadabra/app/"],
    ["hive", "/hive/"],
  ]);
  for (const proof of proofs) {
    if (proof.name !== "a" || proof.href !== expectedHrefs.get(proof.value)) {
      report(errors, file, `About proof ${proof.value} must link to ${expectedHrefs.get(proof.value)}`);
    }
  }
}

function checkWorkExternalProof(source, errors) {
  const file = "work/index.html";
  if (
    !source.includes('data-external-proof="scone-sourcery" data-proof-state="verified-founder-owned"')
  ) {
    report(errors, file, "featured Scone Sourcery proof must remain labeled as verified founder-owned work");
  }
  for (const phrase of [
    "Explore the live venture",
    "separate founder-owned venture, not a client engagement",
    "current interface and current business state",
  ]) {
    if (!source.includes(phrase)) {
      report(errors, file, `featured founder-owned proof is missing ${JSON.stringify(phrase)}`);
    }
  }
  let proofLinks = [];
  try {
    proofLinks = openingTags(source)
      .filter(({ attributes }) => attributes.has("data-external-proof-link"));
  } catch (error) {
    report(errors, file, error.message);
  }
  if (proofLinks.length !== 1) {
    report(errors, file, "featured founder-owned proof must contain exactly one marked external link");
    return;
  }
  const [proofLink] = proofLinks;
  if (
    proofLink.name !== "a"
    || proofLink.attributes.get("data-external-proof-link") !== "scone-sourcery"
    || proofLink.attributes.get("href") !== "https://sconesourcery.com/"
    || proofLink.attributes.get("rel") !== "external"
  ) {
    report(errors, file, "featured founder-owned proof link must be the exact Scone Sourcery external anchor");
  }
}

function checkInformationWayfinding(routeSources, errors) {
  for (const [route, expected] of [
    ["/legal/privacy/", PRIVACY_SECTION_IDS],
    ["/legal/website-terms/", TERMS_SECTION_IDS],
  ]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    let sections = [];
    try {
      sections = openingTags(entry.source)
        .filter(({ name, attributes }) => name === "h2" && attributes.has("id"))
        .map(({ attributes }) => attributes.get("id"));
    } catch (error) {
      report(errors, entry.file, error.message);
    }
    checkExactValues(entry.file, "stable legal section ids", sections, expected, errors);
  }

  const faq = routeSources.get("/faq/");
  if (!faq) return;
  const anchors = markedElements(faq.file, faq.source, "data-faq-anchor", errors);
  checkExactValues(faq.file, "stable FAQ anchors", anchors.map(({ value }) => value), FAQ_ANCHORS, errors);
  for (const anchor of anchors) {
    if (anchor.name !== "details" || anchor.id !== anchor.value) {
      report(errors, faq.file, `FAQ anchor ${anchor.value} must be a details element with matching id`);
    }
  }
}

function checkAbracadabraProductCoherence(routeSources, errors) {
  for (const [route, requiredPhrases] of Object.entries(ABRACADABRA_PRODUCT_COPY)) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const lowerSource = entry.source.toLocaleLowerCase("en-US");
    for (const phrase of requiredPhrases) {
      if (!lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
        report(errors, entry.file, `missing Abracadabra product-coherence copy ${JSON.stringify(phrase)}`);
      }
    }
    for (const phrase of RETIRED_ABRACADABRA_PRODUCT_COPY) {
      if (lowerSource.includes(phrase.toLocaleLowerCase("en-US"))) {
        report(errors, entry.file, `contains retired Abracadabra product model ${JSON.stringify(phrase)}`);
      }
    }
  }

  const landing = routeSources.get("/abracadabra/");
  if (landing) {
    const firstAction = landing.source.indexOf('href="/abracadabra/app/#workroom"');
    const hero = firstAction >= 0 ? landing.source.slice(0, firstAction) : "";
    for (const phrase of [
      "One-page website builder",
      "Build your website. See it before you pay.",
      "When it feels right, choose how you want to keep it.",
    ]) {
      if (!hero.includes(phrase)) {
        report(errors, landing.file, `missing above-fold Abracadabra product truth ${JSON.stringify(phrase)}`);
      }
    }
    const firstContentSection = landing.source.indexOf('<section class="section abracadabra-looks">');
    const heroAndProof = firstContentSection >= 0
      ? landing.source.slice(0, firstContentSection)
      : "";
    if (!heroAndProof.includes("No account to start") || !heroAndProof.includes("Your domain stays yours")) {
      report(errors, landing.file, "missing above-fold account or domain ownership truth");
    }
    if (landing.source.toLocaleLowerCase("en-US").includes("live example")) {
      report(errors, landing.file, "contains retired live-example wording for a generated srcdoc demonstration");
    }
    const pathCardCopy = "Build it yourself, approve the result, then choose a plan.";
    if (landing.source.split(pathCardCopy).length - 1 !== 1) {
      report(errors, landing.file, "Abracadabra path-card proof paragraph must appear exactly once");
    }
  }

  for (const route of ["/abracadabra/", "/abracadabra/how/"]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const journeys = markedElements(entry.file, entry.source, "data-abracadabra-journey", errors);
    checkExactValues(
      entry.file,
      "Abracadabra account-to-exit journey markers",
      journeys.map(({ value }) => value),
      ["account-to-exit"],
      errors,
    );
  }
  for (const route of ["/abracadabra/", "/abracadabra/how/"]) {
    const entry = routeSources.get(route);
    if (!entry) continue;
    const stateModels = markedElements(entry.file, entry.source, "data-abracadabra-state-model", errors);
    checkExactValues(
      entry.file,
      "Abracadabra session-versus-saved state markers",
      stateModels.map(({ value }) => value),
      ["session-vs-saved"],
      errors,
    );
  }
}

function checkContactTruth(file, source, errors) {
  for (const marker of [
    CANONICAL_PHONE.display,
    CANONICAL_PHONE.tel,
    CANONICAL_MAILBOX,
    LEGAL_SELLER,
    BRAND_IDENTITY_DISCLOSURE,
  ]) {
    if (!source.includes(marker)) report(errors, file, `missing exact global marker ${JSON.stringify(marker)}`);
  }

  const emails = source.match(/\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}\b/giu) ?? [];
  for (const email of emails) {
    if (email !== CANONICAL_MAILBOX) {
      report(errors, file, `alternate public email is forbidden: ${email}`);
    }
  }
  const displayedPhones = source.match(/\(?\d{3}\)?[ .-]+\d{3}[ .-]+\d{4}\b/gu) ?? [];
  for (const phone of displayedPhones) {
    if (phone !== CANONICAL_PHONE.display) {
      report(errors, file, `alternate phone display is forbidden: ${phone}`);
    }
  }
  const compactPhones = source.match(/\b\d{10,11}\b/gu) ?? [];
  for (const phone of compactPhones) {
    if (phone !== "18562441220") report(errors, file, `alternate compact phone is forbidden: ${phone}`);
  }
}

function checkInteractions(file, route, source, errors) {
  if (/\bcontenteditable\s*=/iu.test(source)) report(errors, file, "contenteditable regions are forbidden");
  if (/<(?:button|input)\b[^>]*\btype\s*=\s*["']?(?:submit|image)\b/iu.test(source)) {
    report(errors, file, "submit controls are forbidden");
  }
  if (/\bformaction\s*=/iu.test(source)) report(errors, file, "formaction controls are forbidden");
  const controls = source.match(/<(?:input|select|textarea)\b/giu) ?? [];
  if (!["/abracadabra/app/", "/abracadabra/site/"].includes(route) && controls.length !== 0) {
    report(errors, file, "input, select, and textarea controls are allowed only on reviewed Abracadabra app routes");
  }
}

function checkPublicSource(file, source, { route = null } = {}, errors) {
  if (/<form\b/iu.test(source)) report(errors, file, "form elements are forbidden");
  for (const { label, expression } of PROHIBITED_COPY) {
    const match = source.match(expression);
    if (match) report(errors, file, `contains ${label}: ${JSON.stringify(match[0])}`);
  }
  const priceSource = (APPROVED_PUBLIC_PRICE_CLAIMS[file] || []).reduce(function (value, claim) {
    const occurrences = value.split(claim).length - 1;
    if (occurrences > 1) {
      report(errors, file, `approved public price claim may appear at most once: ${JSON.stringify(claim)}`);
    }
    return occurrences === 1 ? value.replace(claim, "") : value;
  }, source);
  const price = priceSource.match(PRICE);
  if (price) report(errors, file, `contains public price: ${JSON.stringify(price[0])}`);
  const priceAttribute = source.match(PRICE_ATTRIBUTE);
  if (priceAttribute) report(errors, file, `contains public price-bearing attribute: ${JSON.stringify(priceAttribute[0])}`);
  const offer = source.match(OFFER);
  if (offer) report(errors, file, `contains active Offer data: ${JSON.stringify(offer[0])}`);
  const payment = source.match(PAYMENT_ENDPOINT);
  if (payment) report(errors, file, `contains payment endpoint: ${JSON.stringify(payment[0])}`);
  const network = source.match(NETWORK_SINK);
  if (network) report(errors, file, `contains network sink: ${JSON.stringify(network[0])}`);
  const externalModule = source.match(EXTERNAL_MODULE);
  if (externalModule) report(errors, file, `contains external module sink: ${JSON.stringify(externalModule[0])}`);
  const submission = source.match(SUBMISSION_SINK);
  if (submission) report(errors, file, `contains submission sink: ${JSON.stringify(submission[0])}`);
  const storage = source.match(STORAGE_SINK);
  if (storage && !STORAGE_ALLOWED_FILES.has(file)) {
    report(errors, file, `contains client storage sink: ${JSON.stringify(storage[0])}`);
  }
  const dynamicResource = source.match(DYNAMIC_RESOURCE_SINK);
  if (dynamicResource) report(errors, file, `contains dynamic resource sink: ${JSON.stringify(dynamicResource[0])}`);
  const fileAccess = source.match(FILE_ACCESS);
  if (fileAccess) report(errors, file, `contains file/upload access: ${JSON.stringify(fileAccess[0])}`);
  if (path.extname(file).toLowerCase() === ".html") checkInteractions(file, route, source, errors);
}

function checkCssReferences(file, source, publicFiles, errors) {
  if (/@import\b/iu.test(source)) report(errors, file, "CSS @import is forbidden");
  for (const match of source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/giu)) {
    const reference = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!reference || reference.startsWith("#") || reference.startsWith("data:")) continue;
    if (reference.startsWith("//")) {
      report(errors, file, `external CSS resource is forbidden: ${reference}`);
      continue;
    }
    let pathname = reference.split(/[?#]/u)[0];
    if (/^https?:/iu.test(reference)) {
      let url;
      try {
        url = new URL(reference);
      } catch {
        report(errors, file, `invalid CSS resource: ${reference}`);
        continue;
      }
      if (url.origin !== SITE_ORIGIN) {
        report(errors, file, `external CSS resource is forbidden: ${reference}`);
        continue;
      }
      pathname = url.pathname;
    }
    if (reference.includes("?")) report(errors, file, `CSS resource queries are forbidden: ${reference}`);
    const target = pathname.startsWith("/")
      ? path.posix.normalize(pathname.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname));
    if (target.startsWith("../") || !publicFiles.has(target)) {
      report(errors, file, `missing or escaped CSS resource: ${reference}`);
    }
  }
}

function checkEmbeddedStyles(file, source, publicFiles, errors) {
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    checkCssReferences(file, match[1], publicFiles, errors);
    checkCssTypeFloor(file, match[1], errors);
  }
  let elements;
  try {
    elements = openingTags(source);
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  for (const { attributes } of elements) {
    for (const [name, value] of attributes) {
      if (name === "style") checkCssTypeFloor(file, `.inline { ${value} }`, errors);
      if (name === "font-size") checkCssTypeFloor(file, `.svg-text { font-size: ${value}; }`, errors);
      if (CSS_VALUE_ATTRIBUTES.has(name) && value.includes("url(")) {
        checkCssReferences(file, value, publicFiles, errors);
      }
    }
  }
}

function checkSvgReferences(file, source, publicFiles, errors) {
  let elements;
  try {
    elements = openingTags(source);
  } catch (error) {
    report(errors, file, error.message);
    return;
  }
  const ids = new Set(elements.map(({ attributes }) => attributes.get("id")).filter(Boolean));
  for (const { attributes } of elements) {
    for (const attribute of ["href", "src", "xlink:href"]) {
      if (!attributes.has(attribute)) continue;
      const reference = attributes.get(attribute);
      if (!reference) {
        report(errors, file, `${attribute} must not be empty`);
        continue;
      }
      if (reference.startsWith("#")) {
        if (!ids.has(reference.slice(1))) report(errors, file, `missing SVG fragment ${reference}`);
        continue;
      }
      if (reference.startsWith("data:")) continue;
      let target;
      try {
        target = new URL(reference, new URL(`/${file}`, `${SITE_ORIGIN}/`));
      } catch {
        report(errors, file, `invalid SVG ${attribute}: ${reference}`);
        continue;
      }
      if (target.origin !== SITE_ORIGIN) {
        report(errors, file, `external SVG ${attribute} is forbidden: ${reference}`);
        continue;
      }
      if (target.search) report(errors, file, `SVG ${attribute} queries are forbidden: ${reference}`);
      if (CANONICAL_ROUTES.includes(target.pathname)) continue;
      let targetFile;
      try {
        targetFile = decodeURIComponent(target.pathname).replace(/^\//u, "");
      } catch {
        report(errors, file, `invalid SVG ${attribute}: ${reference}`);
        continue;
      }
      if (!publicFiles.has(targetFile)) report(errors, file, `missing SVG resource: ${reference}`);
    }
  }
}

function skipWhitespace(text, cursor) {
  while (cursor.index < text.length && /\s/u.test(text[cursor.index])) cursor.index += 1;
}

function parseStringToken(text, cursor) {
  const start = cursor.index;
  cursor.index += 1;
  let escaped = false;
  while (cursor.index < text.length) {
    const character = text[cursor.index];
    cursor.index += 1;
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      return JSON.parse(text.slice(start, cursor.index));
    }
  }
  throw new Error("JSON string is unterminated");
}

function scanJsonValue(text, cursor, depth = 0) {
  if (depth > 32) throw new Error("JSON is too deeply nested");
  skipWhitespace(text, cursor);
  const character = text[cursor.index];
  if (character === "{") {
    cursor.index += 1;
    const keys = new Set();
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== '"') throw new Error("JSON object key syntax is invalid");
      const key = parseStringToken(text, cursor);
      if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
      if (PROHIBITED_JSON_KEYS.has(key)) throw new Error(`prohibited JSON key: ${key}`);
      keys.add(key);
      skipWhitespace(text, cursor);
      if (text[cursor.index] !== ":") throw new Error("JSON object is missing a colon");
      cursor.index += 1;
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "}") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON object separator is invalid");
      cursor.index += 1;
    }
    throw new Error("JSON object is unterminated");
  }
  if (character === "[") {
    cursor.index += 1;
    skipWhitespace(text, cursor);
    if (text[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    while (cursor.index < text.length) {
      scanJsonValue(text, cursor, depth + 1);
      skipWhitespace(text, cursor);
      if (text[cursor.index] === "]") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON array separator is invalid");
      cursor.index += 1;
    }
    throw new Error("JSON array is unterminated");
  }
  if (character === '"') {
    parseStringToken(text, cursor);
    return;
  }
  const start = cursor.index;
  while (cursor.index < text.length && !/[\s,\]}]/u.test(text[cursor.index])) cursor.index += 1;
  if (cursor.index === start) throw new Error("JSON value syntax is invalid");
  JSON.parse(text.slice(start, cursor.index));
}

function parseStrictJson(text) {
  if (Buffer.byteLength(text) > 128 * 1024) throw new Error("JSON exceeds 128 KiB");
  const cursor = { index: 0 };
  scanJsonValue(text, cursor);
  skipWhitespace(text, cursor);
  if (cursor.index !== text.length) throw new Error("JSON has trailing content");
  return JSON.parse(text);
}

function checkFalseAllows(value, trail, errors) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextTrail = `${trail}.${key}`;
    if (key.startsWith("allows") && child !== false) {
      report(errors, "data/release-control.json", `${nextTrail} must be false`);
    }
    checkFalseAllows(child, nextTrail, errors);
  }
}

async function checkReleaseControl(root, errors) {
  const file = "data/release-control.json";
  let control;
  try {
    control = parseStrictJson(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    report(errors, file, `must be strict JSON: ${error.message}`);
    return;
  }
  if (!control || typeof control !== "object" || Array.isArray(control)) {
    report(errors, file, "root must be an object");
    return;
  }
  if (control.state !== "hold") report(errors, file, "state must be hold");
  for (const flag of REQUIRED_RELEASE_FLAGS) {
    if (!Object.hasOwn(control, flag) || control[flag] !== false) {
      report(errors, file, `${flag} must exist and be false`);
    }
  }
  checkFalseAllows(control, "$", errors);
  const publicTruth = control.publicTruthReconciliation;
  if (!publicTruth || typeof publicTruth !== "object" || Array.isArray(publicTruth)) {
    report(errors, file, "publicTruthReconciliation must be an object");
    return;
  }
  if (publicTruth.state !== "hold") report(errors, file, "publicTruthReconciliation.state must be hold");
  if (publicTruth.approvedCandidateSha !== null) {
    report(errors, file, "publicTruthReconciliation.approvedCandidateSha must be null");
  }
  if (publicTruth.authorityReceiptSha256 !== null) {
    report(errors, file, "publicTruthReconciliation.authorityReceiptSha256 must be null");
  }
}

async function check404(root, publicFiles, errors) {
  const file = "404.html";
  if (!publicFiles.has(file)) {
    report(errors, file, "missing public 404 page");
    return;
  }
  const source = await readFile(path.join(root, file), "utf8");
  const h1Count = (source.match(/<h1\b[^>]*>/giu) ?? []).length;
  if (h1Count !== 1) report(errors, file, `must contain exactly one h1; found ${h1Count}`);
  let hasNoindex = false;
  try {
    hasNoindex = openingTags(source).some(({ name, attributes }) =>
      name === "meta"
      && (attributes.get("name") ?? "").toLowerCase() === "robots"
      && (attributes.get("content") ?? "").toLowerCase().split(/[\s,]+/u).includes("noindex")
    );
  } catch (error) {
    report(errors, file, error.message);
  }
  if (!hasNoindex) report(errors, file, "must carry a robots noindex directive");
}

function checkPublicAllowlist(errors) {
  if (publicFileAllowlist.length !== PUBLIC_ALLOWLIST_COUNT) {
    report(
      errors,
      "scripts/build-pages.mjs",
      `public file allowlist must contain exactly ${PUBLIC_ALLOWLIST_COUNT} entries; found ${publicFileAllowlist.length}`,
    );
  }
  const sorted = [...publicFileAllowlist].sort(lexical);
  if (JSON.stringify(publicFileAllowlist) !== JSON.stringify(sorted)) {
    report(errors, "scripts/build-pages.mjs", "public file allowlist must remain bytewise sorted");
  }
  if (new Set(publicFileAllowlist).size !== publicFileAllowlist.length) {
    report(errors, "scripts/build-pages.mjs", "public file allowlist must not contain duplicates");
  }
  const excluded = new Set(EXCLUDED_ARTIFACT_TOP_LEVEL);
  for (const file of publicFileAllowlist) {
    if (
      typeof file !== "string"
      || file === ""
      || file.startsWith("/")
      || file.includes("\\")
      || path.posix.normalize(file) !== file
      || file.split("/").includes("..")
    ) {
      report(errors, "scripts/build-pages.mjs", `invalid public allowlist path ${JSON.stringify(file)}`);
      continue;
    }
    if (excluded.has(file.split("/")[0])) {
      report(errors, "scripts/build-pages.mjs", `public allowlist crosses excluded boundary: ${file}`);
    }
  }

  const expectedHtml = [
    "404.html",
    ...Object.values(CANONICAL_ROUTE_FILES),
    ...Object.values(FUNCTIONAL_APP_ROUTE_FILES),
    ...Object.keys(LEGACY_REDIRECTS).filter((file) => file !== SOURCE_ONLY_LEGACY_REDIRECT),
  ].sort(lexical);
  const actualHtml = publicFileAllowlist.filter((file) => file.endsWith(".html"));
  if (JSON.stringify(actualHtml) !== JSON.stringify(expectedHtml)) {
    report(
      errors,
      "scripts/build-pages.mjs",
      "public HTML allowlist must exactly contain canonical routes, 404, and artifact legacy redirects",
    );
  }
  if (publicFileAllowlist.includes(SOURCE_ONLY_LEGACY_REDIRECT)) {
    report(errors, "scripts/build-pages.mjs", `${SOURCE_ONLY_LEGACY_REDIRECT} must remain source-only`);
  }
  return new Set(publicFileAllowlist);
}

async function compareArtifact(root, routeResult, errors) {
  if (JSON.stringify(excludedTopLevel) !== JSON.stringify(EXCLUDED_ARTIFACT_TOP_LEVEL)) {
    report(errors, "scripts/build-pages.mjs", "artifact exclusion list does not match the locked vNext contract");
    return;
  }
  let temporary;
  try {
    temporary = await mkdtemp(path.join(tmpdir(), "sitesourcery-vnext-"));
    const output = path.join(temporary, "artifact");
    buildPagesArtifact({ root, output });
    const topLevel = new Set((await readdir(output)).sort(lexical));
    for (const excluded of EXCLUDED_ARTIFACT_TOP_LEVEL) {
      if (topLevel.has(excluded)) report(errors, "_site", `built artifact includes excluded top-level entry ${excluded}`);
    }
    const artifactEntries = await walkFiles(output);
    for (const entry of artifactEntries) {
      if (entry.kind !== "file") report(errors, `_site/${entry.relative}`, `unsupported artifact entry: ${entry.kind}`);
    }
    const artifactFiles = artifactEntries
      .filter(({ kind }) => kind === "file")
      .map(({ relative }) => relative)
      .sort(lexical);
    const expectedFiles = [...publicFileAllowlist];
    if (JSON.stringify(artifactFiles) !== JSON.stringify(expectedFiles)) {
      report(errors, "_site", "built artifact file ledger differs from the exact public allowlist");
    }
    let artifactTotalBytes = 0;
    for (const file of expectedFiles.filter((entry) => artifactFiles.includes(entry))) {
      const [sourceBytes, artifactBytes] = await Promise.all([
        readFile(path.join(root, file)),
        readFile(path.join(output, file)),
      ]);
      if (!sourceBytes.equals(artifactBytes)) report(errors, `_site/${file}`, "built bytes differ from source");
      artifactTotalBytes += artifactBytes.length;
      const extension = path.extname(file).toLowerCase();
      const category = extension === ".html"
        ? "html"
        : extension === ".css"
          ? "css"
          : extension === ".js"
            ? "javascript"
            : [".ico", ".png", ".svg", ".webp"].includes(extension)
              ? "image"
              : null;
      if (category && artifactBytes.length > ARTIFACT_SIZE_BUDGETS[category]) {
        report(
          errors,
          `_site/${file}`,
          `${category} performance budget is ${ARTIFACT_SIZE_BUDGETS[category]} bytes; `
          + `received ${artifactBytes.length}`,
        );
      }
    }
    if (artifactTotalBytes > ARTIFACT_SIZE_BUDGETS.total) {
      report(
        errors,
        "_site",
        `total performance budget is ${ARTIFACT_SIZE_BUDGETS.total} bytes; `
        + `received ${artifactTotalBytes}`,
      );
    }
    const artifactRoutes = await validateRouteContract(output);
    if (routeResult.ok) {
      const routeErrors = new Set(artifactRoutes.errors);
      if (!routeErrors.delete(EXPECTED_ARTIFACT_ROUTE_ERROR)) {
        report(errors, "_site", "artifact route validation did not preserve the expected source-only thanks omission");
      }
      for (const error of routeErrors) report(errors, "_site", error);
    }
    if (artifactRoutes.counts.canonicalRoutes !== CANONICAL_ROUTES.length) {
      report(errors, "_site", "artifact must contain every canonical route");
    }
    if (artifactRoutes.counts.legacyRedirects !== Object.keys(LEGACY_REDIRECTS).length - 1) {
      report(errors, "_site", "artifact must contain every allowlisted legacy redirect and omit only thanks.html");
    }
    for (const [route, file] of Object.entries(CANONICAL_ROUTE_FILES)) {
      if (!artifactFiles.includes(file) || !routeResult.sources.has(route)) {
        report(errors, "_site", `canonical route ${route} was not validated through exact source bytes`);
      }
    }
  } catch (error) {
    report(errors, "_site", `artifact validation failed: ${error.message}`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

export async function validateSiteVnext(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const errors = [];
  const routeResult = await validateRouteContract(absoluteRoot);
  errors.push(...routeResult.errors);

  const sourceFiles = checkPublicAllowlist(errors);
  const sourceEntries = new Map(
    routeResult.files.map(({ relative, kind }) => [relative, kind]),
  );
  const availableSourceFiles = new Set();
  for (const file of sourceFiles) {
    if (sourceEntries.get(file) === "file") {
      availableSourceFiles.add(file);
    } else {
      report(errors, file, "allowlisted public source must exist as a regular file");
    }
  }

  for (const [route, { file, source }] of routeResult.sources) {
    if (!sourceFiles.has(file)) continue;
    checkContactTruth(file, source, errors);
    checkPublicSource(file, source, { route }, errors);
    checkEmbeddedStyles(file, source, sourceFiles, errors);
  }

  const home = routeResult.sources.get("/")?.source;
  if (home) checkHomeDoors(home, errors);
  const hive = routeResult.sources.get("/hive/")?.source;
  if (hive) checkHiveCells(hive, errors);
  const solutions = routeResult.sources.get("/solutions/")?.source;
  if (solutions) checkSolutionAnchors(solutions, errors);
  const start = routeResult.sources.get("/start/")?.source;
  if (start) checkStartPaths(start, errors);
  if (availableSourceFiles.has("vnext.js")) {
    checkStartDecisionLogic(await readFile(path.join(absoluteRoot, "vnext.js"), "utf8"), errors);
  }
  const customScope = routeResult.sources.get("/custom/scope/")?.source;
  if (customScope) checkCustomCatalogSurface(customScope, errors);
  const customProcess = routeResult.sources.get("/custom/process/")?.source;
  if (customProcess) checkCustomProcess(customProcess, errors);
  const about = routeResult.sources.get("/about/")?.source;
  if (about) checkAboutTrust(about, errors);
  const work = routeResult.sources.get("/work/")?.source;
  if (work) checkWorkExternalProof(work, errors);
  checkInformationWayfinding(routeResult.sources, errors);
  checkAbracadabraProductCoherence(routeResult.sources, errors);
  checkPublicTruthCoherence(routeResult.sources, errors);
  checkBusinessEmailCoherence(routeResult.sources, errors);

  for (const file of [...sourceFiles].sort(lexical)) {
    if (!availableSourceFiles.has(file)) continue;
    const extension = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if ([...routeResult.sources.values()].some((entry) => entry.file === file)) continue;
    const source = await readFile(path.join(absoluteRoot, file), "utf8");
    const functionalRoute = Object.entries(FUNCTIONAL_APP_ROUTE_FILES)
      .find(([, routeFile]) => routeFile === file)?.[0] ?? null;
    checkPublicSource(file, source, { route: functionalRoute }, errors);
    if (extension === ".css") {
      checkCssReferences(file, source, sourceFiles, errors);
      checkCssTypeFloor(file, source, errors);
      if (file === "vnext.css") checkStartMotionContract(source, errors);
    }
    if (file === "abracadabra/abracadabra-showcase.js") {
      checkAbracadabraShowcaseCopy(source, errors);
    }
    if (extension === ".html" || extension === ".svg") {
      checkEmbeddedStyles(file, source, sourceFiles, errors);
    }
    if (extension === ".svg") checkSvgReferences(file, source, sourceFiles, errors);
  }
  for (const file of sourceFiles) {
    for (const { label, expression } of PROHIBITED_COPY) {
      const match = file.match(expression);
      if (match) report(errors, file, `public path contains ${label}: ${JSON.stringify(match[0])}`);
    }
  }

  await check404(absoluteRoot, availableSourceFiles, errors);
  await checkReleaseControl(absoluteRoot, errors);
  await compareArtifact(absoluteRoot, routeResult, errors);

  const uniqueErrors = [...new Set(errors)].sort(lexical);
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    counts: {
      canonicalRoutes: routeResult.counts.canonicalRoutes,
      legacyRedirects: routeResult.counts.legacyRedirects,
      homeDoors: home ? markedElements("index.html", home, "data-home-door", []).length : 0,
      hiveCells: hive ? markedElements("hive/index.html", hive, "data-hive-cell", []).length : 0,
      solutionAnchors: solutions ? markedElements("solutions/index.html", solutions, "data-solution-anchor", []).length : 0,
      artifactFiles: publicFileAllowlist.length,
    },
  };
}

export async function runSiteVnextCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    console.log("Usage: node scripts/check-site-vnext.mjs [site-root]");
    return 0;
  }
  if (argv.length > 1) {
    console.error("check-site-vnext: expected zero or one site-root argument");
    return 2;
  }
  try {
    const result = await validateSiteVnext(argv[0] ?? process.cwd());
    if (!result.ok) {
      console.error(`SiteSourcery vNext checks failed (${result.errors.length}):`);
      for (const error of result.errors) console.error(`- ${error}`);
      return 1;
    }
    console.log(
      `SiteSourcery vNext checks passed: ${result.counts.canonicalRoutes} canonical routes, `
      + `${result.counts.legacyRedirects} legacy redirects, ${result.counts.homeDoors} home doors, `
      + `${result.counts.hiveCells} Hive cells, ${result.counts.solutionAnchors} solution anchors; `
      + "reviewed local-storage/no-network boundaries, release holds, and built-artifact boundary verified.",
    );
    return 0;
  } catch (error) {
    console.error(`check-site-vnext: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSiteVnextCli();
}
