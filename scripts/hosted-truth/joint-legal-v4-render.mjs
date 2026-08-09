import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assertJointLegalV4Held } from "./joint-legal-v4-artifacts.mjs";

export const JOINT_LEGAL_V4_OWNER_APPROVAL =
  "owner-approved-exact-joint-legal-v4-release-values";
export const PRIVACY_V4_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-JOINT-REVIEW-DRAFT-V4";
export const WEBSITE_TERMS_V4_REVIEW_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-JOINT-REVIEW-DRAFT-V4";
export const PRIVACY_V4_VERSION_TOKEN =
  "__SITESOURCERY_PRIVACY_V4_VERSION__";
export const WEBSITE_TERMS_V4_VERSION_TOKEN =
  "__SITESOURCERY_WEBSITE_TERMS_V4_VERSION__";
export const JOINT_LEGAL_V4_EFFECTIVE_LABEL_TOKEN =
  "__SITESOURCERY_JOINT_LEGAL_V4_EFFECTIVE_LABEL__";

const REVIEW_LABEL = "Not effective — joint legal V4 review only";
const PRIVACY_SOURCE =
  "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/privacy/index.html";
const TERMS_SOURCE =
  "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/website-terms/index.html";
const CENTER_SOURCE =
  "ops/releases/joint-legal-v3-2026-08-09T152559Z/hosted/legal/index.html";
const SOURCE_IDENTITIES = Object.freeze({
  [PRIVACY_SOURCE]: Object.freeze({
    sha256: "5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967",
    byteCount: 29_610,
  }),
  [TERMS_SOURCE]: Object.freeze({
    sha256: "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
    byteCount: 26_171,
  }),
  [CENTER_SOURCE]: Object.freeze({
    sha256: "1f8babe61f13ce74085b23027a7e30bcfb8191bf36d2e0de4166c441acf145c8",
    byteCount: 4_980,
  }),
});
const PRIVACY_VERSION =
  /^SS-HOSTED-PRIVACY-(\d{4}-\d{2}-\d{2})-V4$/u;
const TERMS_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(\d{4}-\d{2}-\d{2})-V4$/u;
const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

const V3_PRIVACY_ASIDE =
  '<aside class="quote-panel"><p class="card-kicker">Effective August 9, 2026</p><h2>Notice SS-HOSTED-PRIVACY-2026-08-09-V3</h2><p>This notice covers the public site, guest preview, account, saved project, $5 Download, $200 Website assessment, and accepted Custom build. Alakazam, Care, domain purchase, publication, and Responder remain held.</p></aside>';
const V3_TERMS_ASIDE =
  '<aside class="quote-panel"><p class="card-kicker">Effective August 9, 2026</p><h2>Terms SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3</h2><p>These terms cover the free guest maker, signed-in saved projects, the $5 HTML Download, the $200 Website assessment, and accepted Custom builds. Alakazam, Care, domain purchase, publication, and The Responder remain held.</p></aside>';
const V3_ALAKAZAM_PRIVACY_REFERENCE =
  "A later Alakazam release requires its separately approved Privacy V4, service, billing, publication, support, and lifecycle terms before acceptance or payment.";
const V4_ALAKAZAM_PRIVACY_REFERENCE =
  "A later Alakazam release requires a separately approved later privacy notice and service, billing, publication, support, and lifecycle terms before acceptance or payment.";
const V3_CENTER_ASIDE =
  '<aside class="quote-panel"><p class="card-kicker">Effective August 9, 2026</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Current documents: SS-HOSTED-PRIVACY-2026-08-09-V3 and SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3. Both use the same effective UTC time, 2026-08-09T15:25:59.000Z.</p></aside>';

const OLD_PUBLIC_SUMMARY =
  "Most public controls stay on the page. The Domains preflight sends candidate names to Cloudflare DNS only for a lookup.";
const NEW_PUBLIC_SUMMARY =
  "Cloudflare delivers and protects website requests at its HTTPS edge. The Domains preflight also makes a separate Cloudflare public-DNS lookup after you ask.";
const OLD_PUBLIC_BODY =
  "The public pages in this release are built without an inquiry form, visitor upload, advertising tracker, or page-level analytics. They do not collect browsing activity over time across unrelated websites, so Site Sourcery does not change this handling in response to a browser Do Not Track signal. This release includes no code for other parties to use these pages for cross-site advertising tracking. Website and security providers may still process ordinary request records. The Start chooser uses selected buttons only to show a recommendation on the current page and does not send that selection. The Domains public-DNS preflight is the stated exception: pressing its check button sends the candidate names to Cloudflare as described in the Domains section. Telephone and email links hand control to the communication application chosen on the device.";
const NEW_PUBLIC_BODY =
  "The public pages in this release are built without an inquiry form, visitor upload, advertising tracker, or page-level analytics. They do not collect browsing activity over time across unrelated websites, so Site Sourcery does not change this handling in response to a browser Do Not Track signal. This release includes no code for other parties to use these pages for cross-site advertising tracking. Every website request passes through Cloudflare as the authoritative-DNS, HTTPS reverse-proxy, and security edge described in the network section. The Start chooser uses selected buttons only to show a recommendation on the current page and does not send that selection as an application choice. The Domains public-DNS preflight is a separate action: pressing its check button sends candidate names to Cloudflare as described in the Domains section. Telephone and email links hand control to the communication application chosen on the device.";
const OLD_NETWORK_SUMMARY =
  "Providers help run the site. They may handle payments, email, files, DNS checks, security, and support.";
const NEW_NETWORK_SUMMARY =
  "Cloudflare handles DNS and website delivery at the edge; other providers handle the database, backups, payments, transactional email, files, and direct email.";
const OLD_NETWORK_BODY =
  "Site Sourcery’s configured hosting, PostgreSQL database, backup, and file-delivery services process the account, project, assessment, Custom-work, evidence, transaction, access-reference, request, security, and timestamp records needed to run and protect the authenticated service. Stripe receives checkout contact and address fields, the service or project purpose, amount, currency, automatic-tax inputs and results, and Site Sourcery reference metadata, and returns customer, Checkout, PaymentIntent, Charge, tax, payment, refund, dispute, and event evidence. Resend processes the destination address, account or recovery message content, delivery identifiers and state, and related technical records for transactional account email; Site Sourcery requires Resend open and click tracking to remain disabled. Direct email to sitesourcery@proton.me is processed by Proton Mail. The Domains action sends only the cleaned .com, .net, and .org candidates plus ordinary network data to Cloudflare’s public DNS resolver as described below. A provider receives only the categories needed for the feature used, subject to its terms, contract, privacy notice, and configured retention and security controls.";
const NEW_NETWORK_BODY = [
  "Cloudflare is Site Sourcery’s authoritative DNS provider and its HTTPS reverse-proxy and security edge. A visitor’s HTTPS connection terminates at Cloudflare before Cloudflare forwards the request through an encrypted, outbound-only Cloudflare Tunnel connection to the Dell origin. Cloudflare can therefore process the visitor IP address; requested hostname, path, and query; request headers and similar browser or device data; cookies and session data carried in a request; response data needed to proxy the exchange; and request, response, security, error, and timing logs generated for delivery and protection. Tunnel encryption protects the Cloudflare-edge-to-origin transport; it does not prevent Cloudflare from handling request and response contents at its edge.",
  "The launch configuration uses Cloudflare for authoritative DNS, TLS termination, reverse-proxy delivery, security handling, the outbound origin tunnel, and the separate user-triggered public-DNS lookup described below. It does not use Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile, or another optional Cloudflare product. Authenticated account, payment, and evidence responses set no-store or private no-store application directives. Site Sourcery does not promise that every static asset or Cloudflare security record is uncached or kept for a fixed period; the exact Cloudflare cache, logging, security, and retention settings are deployment controls that must be recorded and reviewed before this notice is finalized.",
  "Site Sourcery’s Dell hosting, PostgreSQL database, backup, and file-delivery services process the account, project, assessment, Custom-work, evidence, transaction, access-reference, request, security, and timestamp records needed to run and protect the authenticated service. Stripe receives checkout contact and address fields, the service or project purpose, amount, currency, automatic-tax inputs and results, and Site Sourcery reference metadata, and returns customer, Checkout, PaymentIntent, Charge, tax, payment, refund, dispute, and event evidence. Resend processes the destination address, account or recovery message content, delivery identifiers and state, and related technical records for transactional account email; Site Sourcery requires Resend open and click tracking to remain disabled. Direct email to sitesourcery@proton.me is processed by Proton Mail. A provider receives only the categories needed for the feature used, subject to its terms, contract, privacy notice, and configured retention and security controls.",
].map((paragraph) => `<p>${paragraph}</p>`).join("\n      ");
const OLD_SECURITY_SUMMARY =
  "Guest preview needs no sign-in. Account passwords are stored as protected verifiers, but no browser, storage, payment, backup, or network method is perfectly safe.";
const NEW_SECURITY_SUMMARY =
  "HTTPS terminates at Cloudflare and the outbound tunnel encrypts edge-to-origin delivery. Account passwords are protected verifiers, but no method is perfectly safe.";
const OLD_SECURITY_BODY =
  "The guest maker validates and escapes supplied facts before building HTML and creates no account unless the customer chooses the signed-in save path. The account service stores a protected password verifier rather than the readable password and uses session controls, account and project boundaries, request controls, audit and security records, and restricted database roles. No browser, storage, payment, backup, or network method is perfectly secure. Do not put passwords, full payment-card data, health information, regulated records, or sensitive customer data in page content or an initial inquiry.";
const NEW_SECURITY_BODY =
  "The guest maker validates and escapes supplied facts before building HTML and creates no account unless the customer chooses the signed-in save path. The account service stores a protected password verifier rather than the readable password and uses session controls, account and project boundaries, request controls, audit and security records, and restricted database roles. The visitor HTTPS connection terminates at Cloudflare, and Cloudflare Tunnel encrypts delivery from Cloudflare’s edge to the Dell origin over outbound connections. No browser, edge, tunnel, origin, storage, payment, backup, or network method is perfectly secure. Do not put passwords, full payment-card data, health information, regulated records, or sensitive customer data in page content or an initial inquiry.";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readSealedSource(root, file) {
  const bytes = readFileSync(path.join(root, file));
  const expected = SOURCE_IDENTITIES[file];
  if (
    bytes.byteLength !== expected.byteCount
    || digest(bytes) !== expected.sha256
  ) {
    throw new Error(`joint legal V3 source artifact changed: ${file}`);
  }
  return bytes.toString("utf8");
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V4 ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function canonicalUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(Date.parse(value)).toISOString() === value;
}

function effectiveLabel(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("joint legal V4 version contains an invalid date");
  }
  return `Effective ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

function createPlan(options, { kind, pattern, reviewVersion, versionToken }) {
  assertJointLegalV4Held();
  if (options?.mode === "review") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error(`joint legal V4 ${kind} review accepts no release constants`);
    }
    return Object.freeze({
      mode: "review", version: null, effectiveAt: null,
      displayVersion: reviewVersion, effectiveLabel: REVIEW_LABEL,
      versionedFile: `legal/${kind}/versions/${reviewVersion}/index.html`,
    });
  }
  if (options?.mode === "content-template") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error(`joint legal V4 ${kind} template accepts no release constants`);
    }
    return Object.freeze({
      mode: "content-template", version: null, effectiveAt: null,
      displayVersion: versionToken,
      effectiveLabel: JOINT_LEGAL_V4_EFFECTIVE_LABEL_TOKEN,
      versionedFile: `legal/${kind}/versions/${versionToken}/index.html`,
    });
  }
  const match = String(options?.version ?? "").match(pattern);
  if (
    options?.mode !== "final"
    || options.ownerApproval !== JOINT_LEGAL_V4_OWNER_APPROVAL
    || !match
    || !canonicalUtc(options.effectiveAt)
    || options.effectiveAt.slice(0, 10) !== match[1]
    || JSON.stringify(Object.keys(options).sort()) !==
      JSON.stringify(["effectiveAt", "mode", "ownerApproval", "version"])
  ) {
    throw new Error(`joint legal V4 ${kind} finalization requires exact owner-approved release values`);
  }
  return Object.freeze({
    mode: "final", version: options.version,
    effectiveAt: options.effectiveAt, displayVersion: options.version,
    effectiveLabel: effectiveLabel(match[1]),
    versionedFile: `legal/${kind}/versions/${options.version}/index.html`,
  });
}

export function createPrivacyV4RenderPlan(options = {}) {
  return createPlan(options, {
    kind: "privacy", pattern: PRIVACY_VERSION,
    reviewVersion: PRIVACY_V4_REVIEW_VERSION,
    versionToken: PRIVACY_V4_VERSION_TOKEN,
  });
}

export function createWebsiteTermsV4RenderPlan(options = {}) {
  return createPlan(options, {
    kind: "website-terms", pattern: TERMS_VERSION,
    reviewVersion: WEBSITE_TERMS_V4_REVIEW_VERSION,
    versionToken: WEBSITE_TERMS_V4_VERSION_TOKEN,
  });
}

function reviewMetadata(source) {
  return replaceExactlyOnce(
    source,
    "</head>",
    '  <meta name="robots" content="noindex,nofollow">\n</head>',
    "review metadata",
  );
}

function validTelephoneMarkup(source, label) {
  const displayed = "(856) 244-1220";
  if (occurrences(source, displayed) < 1) {
    throw new Error(`joint legal V4 ${label} telephone anchor changed`);
  }
  let rendered = source.replaceAll(displayed, "(856)&nbsp;244&#8209;1220");
  if (label === "privacy") {
    rendered = replaceExactlyOnce(
      rendered,
      '<a href="tel:+18562441220">call me</a>',
      '<a href="tel:+18562441220">(856)&nbsp;244&#8209;1220</a>',
      "privacy contact telephone label",
    );
  }
  return rendered;
}

function privacyAside(plan) {
  if (plan.mode === "review") {
    return `<aside class="quote-panel" data-legal-v4-review-state="unsealed"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Notice ${plan.displayVersion}</h2><p>This exact hosted render is for joint legal V4 review only. It is not effective or deployable. Release identity and Cloudflare configuration approval remain open.</p></aside>`;
  }
  return `<aside class="quote-panel"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Notice ${plan.displayVersion}</h2><p>This notice covers the public site, guest preview, account, saved project, $5 Download, $200 Website assessment, and accepted Custom build, including Cloudflare edge delivery. Alakazam, Care, domain purchase, publication, and Responder remain held.</p></aside>`;
}

function termsAside(plan) {
  if (plan.mode === "review") {
    return `<aside class="quote-panel" data-legal-v4-review-state="unsealed"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Terms ${plan.displayVersion}</h2><p>This exact hosted render carries forward the substantive Website Terms V3 text for joint legal V4 review. It is not effective or deployable.</p></aside>`;
  }
  return `<aside class="quote-panel"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Terms ${plan.displayVersion}</h2><p>These terms cover the free guest maker, signed-in saved projects, the $5 HTML Download, the $200 Website assessment, and accepted Custom builds. Alakazam, Care, domain purchase, publication, and The Responder remain held.</p></aside>`;
}

export function renderPrivacyV4({ root = process.cwd(), plan } = {}) {
  let source = readSealedSource(root, PRIVACY_SOURCE);
  source = replaceExactlyOnce(source, V3_PRIVACY_ASIDE, privacyAside(plan), "privacy identity");
  source = replaceExactlyOnce(source, OLD_PUBLIC_SUMMARY, NEW_PUBLIC_SUMMARY, "public summary");
  source = replaceExactlyOnce(source, OLD_PUBLIC_BODY, NEW_PUBLIC_BODY, "public body");
  source = replaceExactlyOnce(source, OLD_NETWORK_SUMMARY, NEW_NETWORK_SUMMARY, "network summary");
  source = replaceExactlyOnce(
    source,
    `<p>${OLD_NETWORK_BODY}</p>`,
    NEW_NETWORK_BODY,
    "network provider disclosure",
  );
  source = replaceExactlyOnce(source, OLD_SECURITY_SUMMARY, NEW_SECURITY_SUMMARY, "security summary");
  source = replaceExactlyOnce(source, OLD_SECURITY_BODY, NEW_SECURITY_BODY, "security body");
  source = validTelephoneMarkup(source, "privacy");
  if (plan.mode === "review") source = reviewMetadata(source);
  assertRenderedPrivacyV4(source, plan);
  return source;
}

export function renderWebsiteTermsV4({ root = process.cwd(), plan } = {}) {
  let source = readSealedSource(root, TERMS_SOURCE);
  source = replaceExactlyOnce(source, V3_TERMS_ASIDE, termsAside(plan), "terms identity");
  source = replaceExactlyOnce(
    source,
    V3_ALAKAZAM_PRIVACY_REFERENCE,
    V4_ALAKAZAM_PRIVACY_REFERENCE,
    "held Alakazam future privacy identity",
  );
  source = validTelephoneMarkup(source, "terms");
  if (plan.mode === "review") source = reviewMetadata(source);
  assertRenderedWebsiteTermsV4(source, plan);
  return source;
}

function assertMode(source, plan, token, label) {
  if (plan.mode === "review") {
    if (
      !source.includes('data-legal-v4-review-state="unsealed"')
      || !source.includes("noindex,nofollow")
      || /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V4/u.test(source)
    ) throw new Error(`joint legal V4 ${label} review is release-ambiguous`);
  } else if (plan.mode === "content-template") {
    if (
      occurrences(source, token) !== 1
      || occurrences(source, JOINT_LEGAL_V4_EFFECTIVE_LABEL_TOKEN) !== 1
      || source.includes("noindex,nofollow")
    ) throw new Error(`joint legal V4 ${label} template is release-ambiguous`);
  } else if (
    plan.mode !== "final"
    || occurrences(source, plan.version) !== 1
    || occurrences(source, plan.effectiveLabel) !== 1
    || source.includes("noindex,nofollow")
    || source.includes(token)
  ) {
    throw new Error(`joint legal V4 ${label} final render does not match its plan`);
  }
}

export function assertRenderedPrivacyV4(source, plan) {
  for (const phrase of [
    "Cloudflare is Site Sourcery’s authoritative DNS provider",
    "HTTPS connection terminates at Cloudflare",
    "encrypted, outbound-only Cloudflare Tunnel",
    "cookies and session data carried in a request",
    "does not use Cloudflare advertising, Cloudflare Web Analytics, Workers, email routing, Turnstile",
    "does not promise that every static asset or Cloudflare security record is uncached",
    "Alakazam, Care plans, customer-domain purchase, Site Sourcery-managed publication, and Responder service remain held",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`Privacy V4 is missing required Cloudflare truth: ${phrase}`);
    }
  }
  if (
    source.includes(V3_PRIVACY_ASIDE)
    || source.includes("Cloudflare Tunnel makes the origin perfectly secure")
  ) throw new Error("Privacy V4 retained stale or overstated provider truth");
  assertMode(source, plan, PRIVACY_V4_VERSION_TOKEN, "privacy");
  return true;
}

export function assertRenderedWebsiteTermsV4(source, plan) {
  for (const phrase of [
    "The standard Website assessment costs $200",
    "Card and Card Plus are paid in full before work starts.",
    "The included 30-day workmanship correction window",
    "Alakazam subscriptions, hosting activation, publication, Care, lifecycle, and tier features remain held",
  ]) {
    if (!source.includes(phrase)) {
      throw new Error(`Website Terms V4 lost carried-forward text: ${phrase}`);
    }
  }
  if (source.includes(V3_TERMS_ASIDE)) {
    throw new Error("Website Terms V4 retained V3 release identity");
  }
  assertMode(source, plan, WEBSITE_TERMS_V4_VERSION_TOKEN, "terms");
  return true;
}

export function normalizePrivacyV4Final(source, plan) {
  assertRenderedPrivacyV4(source, plan);
  const normalized = source
    .replace(plan.effectiveLabel, JOINT_LEGAL_V4_EFFECTIVE_LABEL_TOKEN)
    .replace(plan.version, PRIVACY_V4_VERSION_TOKEN);
  assertRenderedPrivacyV4(
    normalized,
    createPrivacyV4RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}

export function normalizeWebsiteTermsV4Final(source, plan) {
  assertRenderedWebsiteTermsV4(source, plan);
  const normalized = source
    .replace(plan.effectiveLabel, JOINT_LEGAL_V4_EFFECTIVE_LABEL_TOKEN)
    .replace(plan.version, WEBSITE_TERMS_V4_VERSION_TOKEN);
  assertRenderedWebsiteTermsV4(
    normalized,
    createWebsiteTermsV4RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}

export function renderLegalCenterV4({ root = process.cwd(), privacyPlan, termsPlan } = {}) {
  if (
    privacyPlan?.mode !== "final"
    || termsPlan?.mode !== "final"
    || privacyPlan.effectiveAt !== termsPlan.effectiveAt
  ) throw new Error("joint legal V4 center requires one final effective UTC time");
  let source = readSealedSource(root, CENTER_SOURCE);
  source = replaceExactlyOnce(
    source,
    "<title>Privacy V3 and Website Terms V3 · Site Sourcery</title>",
    "<title>Privacy V4 and Website Terms V4 · Site Sourcery</title>",
    "legal center title",
  );
  source = replaceExactlyOnce(source, V3_CENTER_ASIDE,
    `<aside class="quote-panel"><p class="card-kicker">${privacyPlan.effectiveLabel}</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Current documents: ${privacyPlan.version} and ${termsPlan.version}. Both use the same effective UTC time, ${privacyPlan.effectiveAt}.</p></aside>`,
    "legal center identity");
  source = source
    .replace("Read Privacy V3", "Read Privacy V4")
    .replace("Read Website Terms V3", "Read Website Terms V4");
  if (
    source.includes("Privacy V3 and Website Terms V3")
    || !source.includes(privacyPlan.version)
    || !source.includes(termsPlan.version)
  ) throw new Error("joint legal V4 center retained stale identity");
  return source;
}
