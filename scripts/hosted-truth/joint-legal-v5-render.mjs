import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BUILD_ADDONS,
  BUILD_TIERS,
  CARE_PLANS,
  CATALOG_DIGEST,
  CATALOG_VERSION,
  CREATIVITY_LEVELS,
  PROFESSIONAL_SERVICES,
  SCALE_RULE,
} from "../../commercial/catalog.mjs";
import {
  RESPONDER_COMMERCE_CATALOG_DIGEST,
  getHeldResponderCommerceCatalog,
} from "../../server/hosted/responder-commerce-catalog.mjs";

export const JOINT_LEGAL_V5_OWNER_APPROVAL =
  "owner-approved-exact-joint-legal-v5-release-values";
export const PRIVACY_V5_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-JOINT-REVIEW-DRAFT-V5";
export const WEBSITE_TERMS_V5_REVIEW_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-JOINT-REVIEW-DRAFT-V5";
export const PRIVACY_V5_VERSION_TOKEN =
  "__SITESOURCERY_PRIVACY_V5_VERSION__";
export const WEBSITE_TERMS_V5_VERSION_TOKEN =
  "__SITESOURCERY_WEBSITE_TERMS_V5_VERSION__";
export const JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN =
  "__SITESOURCERY_JOINT_LEGAL_V5_EFFECTIVE_LABEL__";
export const JOINT_LEGAL_V5_EFFECTIVE_AT_TOKEN =
  "__SITESOURCERY_JOINT_LEGAL_V5_EFFECTIVE_AT__";

const REVIEW_LABEL = "Not effective — joint legal V5 review only";
const V4_ROOT =
  "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted/legal";
const SOURCES = Object.freeze({
  center: `${V4_ROOT}/index.html`,
  privacy: `${V4_ROOT}/privacy/index.html`,
  websiteTerms: `${V4_ROOT}/website-terms/index.html`,
});
const SOURCE_IDENTITIES = Object.freeze({
  [SOURCES.center]: Object.freeze({
    sha256: "e9e3026d5e97b764b523f46e01ee5ce9b86e471cf427254f83e97f61457ab4d2",
    byteCount: 4_980,
  }),
  [SOURCES.privacy]: Object.freeze({
    sha256: "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99",
    byteCount: 31_451,
  }),
  [SOURCES.websiteTerms]: Object.freeze({
    sha256: "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
    byteCount: 26_215,
  }),
});
const PRIVACY_VERSION = /^SS-HOSTED-PRIVACY-(\d{4}-\d{2}-\d{2})-V5$/u;
const TERMS_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(\d{4}-\d{2}-\d{2})-V5$/u;
const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);
const CURRENT_NAV = `<nav class="site-nav" id="primary-menu" data-primary-nav data-menu aria-label="Primary">
        <a href="/abracadabra/">Abracadabra</a>
        <a href="/alakazam/">Alakazam</a>
        <a href="/custom/">Sorcery</a>
        <a href="/care/">Care</a>
        <a href="/responder/">The Responder</a>
        <a href="/work/">Spell book</a>
        <a href="/about/">About</a>
      </nav>`;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readFrozenSource(root, file) {
  const bytes = readFileSync(path.join(root, file));
  const expected = SOURCE_IDENTITIES[file];
  if (
    bytes.byteLength !== expected.byteCount
    || digest(bytes) !== expected.sha256
  ) throw new Error(`joint legal V5 frozen V4 source changed: ${file}`);
  return bytes.toString("utf8");
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V5 ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function replacePatternOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`joint legal V5 ${label} anchor changed`);
  }
  return source.replace(pattern, after);
}

function replaceSection(source, id, section, label = id) {
  return replacePatternOnce(
    source,
    new RegExp(`\\s*<h2 id="${id}">[\\s\\S]*?</details>`, "u"),
    `\n${section.trimEnd()}`,
    `${label} section`,
  );
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
  ) throw new Error("joint legal V5 version contains an invalid date");
  return `Effective ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

function createPlan(options, { kind, pattern, reviewVersion, versionToken }) {
  if (options?.mode === "review") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error(`joint legal V5 ${kind} review accepts no release constants`);
    }
    return Object.freeze({
      mode: "review",
      version: null,
      effectiveAt: null,
      displayVersion: reviewVersion,
      effectiveLabel: REVIEW_LABEL,
    });
  }
  if (options?.mode === "content-template") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error(`joint legal V5 ${kind} template accepts no release constants`);
    }
    return Object.freeze({
      mode: "content-template",
      version: null,
      effectiveAt: JOINT_LEGAL_V5_EFFECTIVE_AT_TOKEN,
      displayVersion: versionToken,
      effectiveLabel: JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN,
    });
  }
  const match = String(options?.version ?? "").match(pattern);
  if (
    options?.mode !== "final"
    || options.ownerApproval !== JOINT_LEGAL_V5_OWNER_APPROVAL
    || !match
    || !canonicalUtc(options.effectiveAt)
    || options.effectiveAt.slice(0, 10) !== match[1]
    || JSON.stringify(Object.keys(options).sort())
      !== JSON.stringify(["effectiveAt", "mode", "ownerApproval", "version"])
  ) {
    throw new Error(
      `joint legal V5 ${kind} finalization requires exact owner-approved release values`,
    );
  }
  return Object.freeze({
    mode: "final",
    version: options.version,
    effectiveAt: options.effectiveAt,
    displayVersion: options.version,
    effectiveLabel: effectiveLabel(match[1]),
  });
}

export function createPrivacyV5RenderPlan(options = {}) {
  return createPlan(options, {
    kind: "privacy",
    pattern: PRIVACY_VERSION,
    reviewVersion: PRIVACY_V5_REVIEW_VERSION,
    versionToken: PRIVACY_V5_VERSION_TOKEN,
  });
}

export function createWebsiteTermsV5RenderPlan(options = {}) {
  return createPlan(options, {
    kind: "website-terms",
    pattern: TERMS_VERSION,
    reviewVersion: WEBSITE_TERMS_V5_REVIEW_VERSION,
    versionToken: WEBSITE_TERMS_V5_VERSION_TOKEN,
  });
}

function dollars(cents) {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error("joint legal V5 catalog contains an invalid amount");
  }
  const amount = cents / 100;
  return Number.isInteger(amount) ? `$${amount.toLocaleString("en-US")}` :
    `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function commercialTruth() {
  if (
    CATALOG_VERSION !== "SS-COMMERCIAL-2026.6"
    || CATALOG_DIGEST !== "3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0"
    || BUILD_TIERS.length !== 6
    || CARE_PLANS.length !== 5
    || PROFESSIONAL_SERVICES.length !== 1
    || PROFESSIONAL_SERVICES[0].priceCents !== 35_000
    || PROFESSIONAL_SERVICES[0].buildCredit.maximumCents !== 35_000
  ) throw new Error("joint legal V5 commercial authority changed");
  const responder = getHeldResponderCommerceCatalog();
  if (
    responder.catalogDigest !== RESPONDER_COMMERCE_CATALOG_DIGEST
    || responder.state !== "held"
    || responder.prices.setup.amountMinor !== 30_000
    || responder.prices.recurring.amountMinor !== 25_000
  ) throw new Error("joint legal V5 Responder authority changed");
  const tiers = BUILD_TIERS
    .map(({ label, priceCents }) => `${label} ${dollars(priceCents)}`)
    .join(", ");
  const care = CARE_PLANS
    .map(({ label, monthlyCents }) => `${label} ${dollars(monthlyCents)} per month`)
    .join(", ");
  const fixedAddons = Object.values(BUILD_ADDONS)
    .filter(({ priceCents }) => Number.isInteger(priceCents))
    .map(({ label, priceCents }) => `${label} ${dollars(priceCents)}`)
    .join(", ");
  const creativity = CREATIVITY_LEVELS
    .map(({ label, premiumBasisPoints, minimumPremiumCents }) =>
      premiumBasisPoints === 0 ? `${label} has no premium` :
        `${label} adds ${premiumBasisPoints / 100}% with a ${dollars(minimumPremiumCents)} minimum`)
    .join("; ");
  return Object.freeze({ responder, tiers, care, fixedAddons, creativity });
}

function identityAside(kind, plan) {
  const title = kind === "privacy" ? "Notice" : "Terms";
  if (plan.mode === "review") {
    return `<aside class="quote-panel" data-joint-legal-v5-review-state="unsealed"><p class="card-kicker">${plan.effectiveLabel}</p><h2>${title} ${plan.displayVersion}</h2><p>This exact candidate is for owner and legal review. It is noindex, nondeployable, unpublished, and creates no customer, payment, provider, publication, or acceptance effect.</p></aside>`;
  }
  const coverage = kind === "privacy"
    ? "This notice covers the public site, account and saved-project paths, Download, Website assessment, accepted Custom work, and the providers and retention periods stated below. Held services remain inactive until separately released."
    : "These terms cover the public site, Abracadabra, Download, the Website assessment, and accepted Custom work. Every held product remains unavailable until separately released.";
  return `<aside class="quote-panel"><p class="card-kicker">${plan.effectiveLabel}</p><h2>${title} ${plan.displayVersion}</h2><p>${coverage}</p></aside>`;
}

function applyCommon(source, plan, kind) {
  source = replacePatternOnce(
    source,
    /<nav class="site-nav" id="primary-menu"[\s\S]*?<\/nav>/u,
    CURRENT_NAV,
    `${kind} navigation`,
  );
  source = replacePatternOnce(
    source,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    identityAside(kind, plan),
    `${kind} identity`,
  );
  source = replaceExactlyOnce(
    source,
    `<body class="vnext-page legal-page ${kind === "privacy" ? "privacy" : "terms"}-page">`,
    `<body class="vnext-page legal-page ${kind === "privacy" ? "privacy" : "terms"}-page" data-joint-legal-v5-state="${plan.mode === "review" ? "review-unsealed" : plan.mode}">`,
    `${kind} body state`,
  );
  if (plan.mode === "review") {
    source = replaceExactlyOnce(
      source,
      "</head>",
      '  <meta name="robots" content="noindex,nofollow,noarchive">\n  <meta name="sitesourcery-release-state" content="review-only-nondeployable">\n</head>',
      `${kind} review metadata`,
    );
  }
  return source;
}

const PRIVACY_OPERATOR = `      <h2 id="operator">Who operates this site and what is released</h2>
      <p class="legal-topic-summary" data-legal-summary="operator">Desiderata Labs LLC is the legal seller. SITESOURCERY is its filed New Jersey alternate name; Site Sourcery is the public brand.</p>
      <details class="legal-topic" data-legal-topic="operator"><summary>Read the operator and release boundary</summary><div class="legal-topic-body" data-legal-clause="operator">
      <p>Desiderata Labs LLC operates this website from New Jersey under the filed alternate name SITESOURCERY and public brand Site Sourcery. The contact routes are (856) 244-1220 and sitesourcery@proton.me. No street address is stated in this notice.</p>
      <p>This notice describes the public pages, device-local guest preview, signed-in account and saved-project paths, one-time $5 HTML Download, $350 Website assessment, and accepted Custom work. The successor catalog is ${CATALOG_VERSION}, digest ${CATALOG_DIGEST}. Catalog descriptions and implemented code do not themselves release a product. Alakazam subscriptions and publication, Care activation, registrar and DNS mutations, The Responder, native mobile clients, and every unreleased payment, mail, telephony, messaging, provider, or publication effect remain held until the applicable legal, provider, credential, proof, and owner gates are separately satisfied.</p>
      </div></details>`;

function privacyNetwork(truth) {
  return `      <h2 id="network-records">Server, network, and service-provider records</h2>
      <p class="legal-topic-summary" data-legal-summary="network-records">Cloudflare handles DNS and edge delivery. Dell-hosted services, PostgreSQL, backups, Stripe, Resend, and Proton handle only the work assigned to them; held providers receive no production instruction.</p>
      <details class="legal-topic" data-legal-topic="network-records"><summary>Read full provider details</summary><div class="legal-topic-body" data-legal-clause="network-records">
      <p>Cloudflare is the planned successor’s authoritative DNS provider and HTTPS reverse-proxy and security edge. A visitor’s HTTPS connection terminates at Cloudflare before an encrypted, outbound-only Cloudflare Tunnel forwards a request to the Dell origin. Cloudflare can process the visitor IP address; requested hostname, path, and query; request headers and similar browser or device data; cookies and session data carried in a request; response data needed to proxy the exchange; and delivery, security, error, and timing records. Tunnel encryption protects edge-to-origin transport; it does not prevent Cloudflare from handling request and response content at its edge.</p>
      <p>The selected configuration does not use Cloudflare advertising, Web Analytics, Workers, email routing, or Turnstile. The Domains preflight separately uses Cloudflare’s public DNS resolver only after the user presses its check control. Cloudflare’s resolver notice describes limited resolver logs, truncated source addresses, deletion of public-resolver logs within 25 hours, limited APNIC research access, and possible indefinite aggregate data. Those resolver commitments belong to Cloudflare and are distinct from Site Sourcery’s own retention schedule.</p>
      <p>Dell hosting, PostgreSQL, encrypted off-machine backups, and file delivery process account, project, assessment, Custom-work, evidence, transaction, access-reference, request, security, and timestamp records needed for released services. Stripe handles secure card entry and can receive checkout contact and address fields, service purpose, amount, currency, tax inputs and results, and Site Sourcery reference metadata; it returns customer, Checkout, PaymentIntent, Charge, tax, payment, refund, dispute, and event evidence. Resend handles destination addresses, transactional account or recovery message content, delivery identifiers, status, and technical records with Site Sourcery open and click tracking disabled. Direct email uses Proton Mail.</p>
      <p>Spaceship registrar mutations and Twilio telephony or messaging remain held. While held, those providers receive no customer registration, DNS, call, or message instruction from this release. The Responder’s held private authority is ${truth.responder.catalogVersion}, digest ${truth.responder.catalogDigest}; its existence is not provider activation. No iPhone or Android Responder client is publicly released, so no app-store or native-client processing is authorized by this notice.</p>
      </div></details>`;
}

const PRIVACY_DOMAINS = `      <h2 id="domains">Domains and outside providers</h2>
      <p class="legal-topic-summary" data-legal-summary="domains">The public preflight sends cleaned .com, .net, and .org candidates to Cloudflare DNS. It is not registrar availability, a quote, a reservation, or an order.</p>
      <details class="legal-topic" data-legal-topic="domains"><summary>Read full domain details</summary><div class="legal-topic-body" data-legal-clause="domains">
      <p>After the user presses Check, the browser sends the cleaned .com, .net, and .org candidates in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at cloudflare-dns.com. Cloudflare handles query and connection data under its <a href="https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/">Public DNS Resolver privacy notice</a>, and a recursive resolver can contact authoritative DNS servers to answer.</p>
      <p>The preflight does not call Spaceship or another registrar commerce API and does not prove availability, show a final price, reserve a name, create a quote, or place an order. Any later registration, connection, renewal, transfer, or DNS work requires a separately released written scope, customer approval, provider terms, verified provider readback, and the minimum provider data required for that work.</p>
      </div></details>`;

const PRIVACY_BILLING = `      <h2 id="billing">Billing, tax, and non-cash credit information</h2>
      <p class="legal-topic-summary" data-legal-summary="billing">Stripe handles positive card payments. A fully credited $350 Card start is a non-cash settlement and creates no Stripe charge or payment receipt.</p>
      <details class="legal-topic" data-legal-topic="billing"><summary>Read full billing details</summary><div class="legal-topic-body" data-legal-clause="billing">
      <p>For an authorized positive payment, secure card entry belongs to Stripe. Site Sourcery can receive and store account, project, accepted-version, quote, disclosure, command, and request identifiers; Stripe customer, Checkout, event, PaymentIntent, and Charge identifiers; subtotal, credit, tax, total, currency, and tax mode; settlement, entitlement, refund, dispute, or reversal facts; provider-readback evidence; and related timestamps. Site Sourcery stores evidence needed to verify a payment but does not ask for or store the full card number or card security code.</p>
      <p>Prices are shown before applicable tax. The current internal tax state is <code>disabled_by_owner</code>: Site Sourcery does not calculate or collect tax through the held payment path. That state is not a representation that no tax is legally due. Tax activation requires separate purpose-specific professional review, configuration proof, customer disclosure, and owner release.</p>
      <p>A delivered $350 assessment can create one non-transferable, non-cash $350 credit for one eligible accepted build for the same organization and project within 90 days. If that exact credit fully covers a $350 Card start, Site Sourcery records credit-only zero-balance clearance and creates no Checkout, PaymentIntent, Charge, or payment receipt. A partial credit reduces the authorized amount; only the positive remainder may enter Stripe Checkout. Credit reservation, settlement, release, and reversal facts remain part of the assessment and Custom records.</p>
      <p>A completed one-time $5 payment activates Download for that retained editor project. The assessment and Custom paths record a provider payment only after the accepted invoice purpose, amount, tax state, customer, Checkout, PaymentIntent, Charge, and provider status are read back and verified. Refund availability and service consequences follow the accepted terms, project agreement, provider evidence, and applicable law; this notice makes no blanket refund promise.</p>
      </div></details>`;

const PRIVACY_PROFESSIONAL = `      <h2 id="professional-services">Website assessment and Custom-service records</h2>
      <p class="legal-topic-summary" data-legal-summary="professional-services">An authenticated professional-service path can retain the inquiry, accepted scope, tax and settlement facts, work evidence, and delivery record needed for that service.</p>
      <details class="legal-topic" data-legal-topic="professional-services"><summary>Read full professional-service details</summary><div class="legal-topic-body" data-legal-clause="professional-services">
      <p>An assessment request can include the organization and account, one existing public website, primary goal, requested timing, up to five representative public pages or page types, customer context, state, and messages. Its accepted quote and work record can include exact scope and exclusions, delivery date, desktop and phone review, up to ten important findings, screenshots and private evidence, severity and practical-importance classifications, recommendations, acceptance and disclosure digests, price, tax state, provider-payment or credit facts, report state, and timestamps.</p>
      <p>The resulting one-use $350 build credit can include the same-organization and same-project identity, 90-day eligibility deadline, reservation, application, settlement, release, reversal, and no-double-credit evidence. A fully credited Card start is stored as credit-only settlement, not as a zero-dollar card charge.</p>
      <p>An accepted Custom path can include the selected Card-through-Scale offer, catalog and contract digests, customer and project, written scope and exclusions, responsibilities, dependencies, credential-free access references, provider-cost treatment, quote revisions, acceptance, installments, invoices, settlement kind, Stripe evidence when money moves, assessment-credit application, job and progress state, customer requests, change orders, completion evidence, final-payment or zero-balance clearance, handoff documents and digests, ownership boundary, and the handoff-derived 30-day workmanship period. The browser does not set authoritative money, tax, settlement, completion, handoff, or ownership facts.</p>
      </div></details>`;

const PRIVACY_RETENTION = `      <h2 id="retention">Retention and deletion</h2>
      <p class="legal-topic-summary" data-legal-summary="retention">Active service data remains while needed. Standard periods range from 90 days to seven years by record type, subject to deletion, legal holds, disputes, and required duties.</p>
      <details class="legal-topic" data-legal-topic="retention"><summary>Read the exact retention schedule</summary><div class="legal-topic-body" data-legal-clause="retention">
      <p>Guest versions can remain in the tab’s session storage through a refresh or payment return; closing the tab or clearing that storage ordinarily removes them, subject to browser controls. Active account, customer, and project data remains while the service or contract requires it. A cancelled hosted project receives a 14-day service grace period followed by a standard 90-day customer-content retention period before eligible customer-authored content is deleted. Customers should export and keep files they need.</p>
      <p>Operational logs are normally retained for 90 days; security and audit evidence for one year; prospect records for 12 months after last activity; and support records for two years. Contract, invoice, payment, credit, refund, dispute, and tax evidence is normally retained for seven years. Minimal do-not-contact suppression data remains while needed to enforce the request. A longer period can apply when reasonably necessary for an active service, accounting or tax duty, payment dispute, fraud or security investigation, legal claim, litigation hold, court order, or other law.</p>
      <p>Daily encrypted off-machine backups use a 30-day deletion horizon and retain at least seven verified successful backups as an operational target. Deleting active data does not instantly erase an existing backup; an older copy can remain until that backup ages out. If a backup is restored, the deletion record still applies. Verified deletion removes eligible customer-authored content while preserving only the minimized authority, audit, security, financial, suppression, detached-domain, and deletion evidence still required for the purposes above.</p>
      </div></details>`;

function privacyContact() {
  return `      <h2 id="contact">Contact</h2>
      <p class="legal-topic-summary" data-legal-summary="contact">For privacy help, <a href="tel:+18562441220">(856)&nbsp;244&#8209;1220</a> or <a href="mailto:sitesourcery@proton.me">sitesourcery@proton.me</a>.</p>
      <details class="legal-topic" data-legal-topic="contact"><summary>Show privacy contact details</summary><div class="legal-topic-body" data-legal-clause="contact">
      <p>These public phone and email routes are the current way to make a privacy request or, where applicable, an appeal. Describe the account or project and the request without sending passwords, payment-card data, or unnecessary sensitive information. Site Sourcery may verify identity or authority before acting. Desiderata Labs LLC operates from New Jersey, United States; this notice does not invent or publish a street address.</p>
      </div></details>`;
}

export function renderPrivacyV5({ root = process.cwd(), plan } = {}) {
  const truth = commercialTruth();
  let source = readFrozenSource(root, SOURCES.privacy);
  source = applyCommon(source, plan, "privacy");
  source = replaceExactlyOnce(
    source,
    '<meta name="description" content="How Site Sourcery handles public pages, the free guest preview, accounts, saved projects, $5 Download, domain preflight, and held services.">',
    '<meta name="description" content="How Desiderata Labs LLC handles Site Sourcery public pages, accounts, saved projects, Download, Website assessments, Custom work, providers, held products, and retention.">',
    "privacy description",
  );
  source = replaceSection(source, "operator", PRIVACY_OPERATOR);
  source = replaceSection(source, "network-records", privacyNetwork(truth));
  source = replaceSection(source, "domains", PRIVACY_DOMAINS);
  source = replaceSection(source, "billing", PRIVACY_BILLING);
  source = replaceSection(source, "professional-services", PRIVACY_PROFESSIONAL);
  source = replaceSection(source, "retention", PRIVACY_RETENTION);
  source = replaceSection(source, "contact", privacyContact());
  assertRenderedPrivacyV5(source, plan);
  return source;
}

const TERMS_ACCEPTANCE = `        <h2 id="acceptance">Acceptance, authority, and release state</h2>
        <p class="legal-topic-summary" data-legal-summary="acceptance">Browsing and guest previewing do not accept terms. A catalog entry, inquiry, or payment alone does not release a service or authorize work.</p>
        <details class="legal-topic" data-legal-topic="acceptance"><summary>Read full acceptance terms</summary><div class="legal-topic-body" data-legal-clause="acceptance">
          <p>These terms apply only after publication with an exact version and effective time and only to the services expressly released at that time. Released paid services are offered for business and commercial use, not personal, family, or household use. Browsing, making a guest preview, reading a catalog entry, or sending an inquiry does not create an account, save a project, accept terms, authorize payment, publish a site, or start work. A person accepting for an organization represents that they are old enough to contract and authorized to act for it.</p>
          <p>A saved project, $5 Download, Website assessment, or Custom build requires the exact signed-in acceptance, quote, scope, responsibilities, payment or credit schedule, and applicable agreement shown before the action. Payment alone does not authorize work, publication, domain action, or another service. Alakazam, Care, domain and DNS mutations, The Responder, native clients, and every unreleased payment, email, telephony, messaging, provider, and publication effect remain held until separately released. Implemented code and private quote preparation do not make a held product available.</p>
        </div></details>`;

const TERMS_DOMAINS = `        <h2 id="customer-domains">Domain work remains separate and held</h2>
        <p class="legal-topic-summary" data-legal-summary="customer-domains">The Cloudflare DNS preflight is not registrar availability or an order. Spaceship registration and every DNS mutation remain held.</p>
        <details class="legal-topic" data-legal-topic="customer-domains"><summary>Read domain terms</summary><div class="legal-topic-body" data-legal-clause="customer-domains">
          <p>Site Sourcery does not claim ownership of a customer-owned domain. Domain search, registration, renewal, transfer, DNS, and connection are separate from Download, assessment, and Custom build work. The public preflight checks Cloudflare DNS signals only; it does not prove availability, show a final registrar price, reserve a name, create a quote, or place an order.</p>
          <p>Spaceship is the selected held registrar integration, but no provider mutation is authorized. Any later domain work requires a separately released written scope identifying the customer decision, registrant and account control, provider terms, exact current provider cost and customer price, renewal and transfer responsibilities, authorized changes, verified provider readback, and failure handling.</p>
        </div></details>`;

const TERMS_BILLING = `        <h2 id="billing-cancellation">Payment, tax, final sales, and disputes</h2>
        <p class="legal-topic-summary" data-legal-summary="billing-cancellation">Except where applicable law expressly requires otherwise, all sales are final and Site Sourcery offers no voluntary refunds.</p>
        <details class="legal-topic" data-legal-topic="billing-cancellation"><summary>Read payment and reversal terms</summary><div class="legal-topic-body" data-legal-clause="billing-cancellation">
          <p>Secure card entry for an authorized positive amount is handled by Stripe. Site Sourcery verifies the exact quote, project or service purpose, customer, subtotal, credit, currency, tax state and result, Checkout, PaymentIntent, Charge, and provider status before recording a provider payment. Site Sourcery does not ask for the full card number or card security code. A held, expired, declined, cancelled, mismatched, or otherwise incomplete Checkout creates no entitlement or paid-service authority.</p>
          <p>All catalog and quote prices are USD and shown before applicable tax. The current internal tax state is <code>disabled_by_owner</code>, so the held payment path calculates and collects no tax. That state is not tax advice or a promise that no tax is legally due. No taxable purpose can open until its tax treatment, configuration, customer display, and owner release are separately approved and proved.</p>
          <p>Except where applicable law expressly requires otherwise or a separately accepted written agreement expressly says otherwise, all sales are final and all payments are non-refundable. Site Sourcery offers no refund, return, cancellation, cash redemption, or replacement credit for change of mind, nonuse, customer delay, customer-supplied error, subjective dissatisfaction with work that matches the accepted scope, or a third-party or provider change. Any legally required remedy is limited by the liability terms below to the fullest extent the law permits.</p>
          <p>A completed one-time $5 payment unlocks Download for that retained editor project and does not renew. The Download sale becomes final when the accepted HTML file is made available through the authenticated Download route. A provider reversal, chargeback, or payment dispute can revoke or suspend future access. Site Sourcery cannot retrieve a file already saved to the customer’s device or independent host.</p>
          <p>A delivered $350 Website assessment can supply one non-transferable, one-use, non-cash $350 credit for one eligible accepted build for the same organization and project within 90 days. If that credit fully covers a $350 Card start, the accepted invoice has a $350 gross start, $350 credit, and $0 customer subtotal. It is credit-only zero-balance clearance: no Checkout, PaymentIntent, Charge, or payment receipt is created. A partial credit reduces the amount due; only a positive remainder can enter Stripe.</p>
        </div></details>`;

const TERMS_ASSESSMENT = `        <h2 id="assessment">Website assessment</h2>
        <p class="legal-topic-summary" data-legal-summary="assessment">The $350 assessment delivers written findings and screenshot evidence for one existing public site. Its exact scope and turnaround are stated before sale.</p>
        <details class="legal-topic" data-legal-topic="assessment"><summary>Read full Website-assessment terms</summary><div class="legal-topic-body" data-legal-clause="assessment">
          <p>The standard Website assessment costs $350 and is paid in full before assessment work begins. Its accepted quote covers one customer organization, one existing public website, one primary goal, up to five representative public pages or page types, desktop and phone review, and up to ten important findings with screenshot evidence, severity, practical importance, and a recommended order of work. The exact selected pages or types and turnaround are stated before sale. Larger or denser review is separately quoted before expanded inspection begins.</p>
          <p>The assessment diagnoses the existing public site. It does not include repairs, an exhaustive crawl, authenticated admin or source-code review, malware cleanup, account recovery, penetration testing, legal advice, or accessibility certification. Remediation requires a separate accepted scope.</p>
          <p>The assessment payment is final and non-refundable once assessment work begins. Delivery of the written findings completes the purchased assessment even if the customer does not use the findings, pursue remediation, or accept a later build.</p>
          <p>After delivery, the full non-cash $350 is a one-use credit toward one eligible accepted Site Sourcery base build for the same organization and project if that build is accepted within 90 days. The credit is not transferable, cannot be used twice, and does not pay tax, provider costs, ongoing service, or unrelated work. Its use against Card can result in the $0 credit-only settlement described above.</p>
        </div></details>`;

function termsCustom(truth) {
  return `        <h2 id="custom-work">Custom catalog, quote, work, completion, and handoff</h2>
        <p class="legal-topic-summary" data-legal-summary="custom-work">The exact written quote controls. Base tiers run from $350 Card through $3,600 Flagship; Scale adds bounded capacity from the Flagship base.</p>
        <details class="legal-topic" data-legal-topic="custom-work"><summary>Read full Custom project terms</summary><div class="legal-topic-body" data-legal-clause="custom-work">
          <p>The selected commercial authority is ${CATALOG_VERSION}, digest <code>${CATALOG_DIGEST}</code>. Its base prices are ${truth.tiers}. Scale starts with the $3,600 Flagship base and adds ${dollars(SCALE_RULE.unitPriceCents)} for each normalized capacity unit, automatically priced only through ${SCALE_RULE.maximumCraftedPages} delivered crafted pages and the matching capacity; larger or denser work requires a component-specific custom exception. Higher price does not promise every lower-tier feature or a maximum page count regardless of content density.</p>
          <p>Fixed catalog add-ons are ${truth.fixedAddons}. Extra revision rounds and priority windows use tier-specific prices shown in the exact quote. Creativity treatment is: ${truth.creativity}. Architecture, migration, provider costs, third-party fees, excess scope, and every variable-price item must be stated in the accepted quote; nothing is silently added or charged.</p>
          <p>Custom work begins only after the customer and Site Sourcery accept an exact written quote, scope, exclusions, responsibilities, dependencies, payment schedule, completion evidence, and separate agreement. Provider fees are separate unless expressly included. Added or changed work requires a written change order, customer acceptance, and its required settlement before added work begins.</p>
          <p>Card and Card Plus require full payment or exact credit clearance before work starts. Site through Scale require 50% before work; the final 50% becomes payable only after Site Sourcery records completion evidence and before final handoff. Completion does not authorize an automatic charge. Final handoff requires the completed scope plus provider-confirmed final payment or the accepted quote’s exact zero-balance clearance. Ownership of agreed client deliverables transfers only after final payment or that exact clearance, subject to third-party material, licenses, and retained Site Sourcery tools identified in the agreement.</p>
          <p>Each Custom payment is final and non-refundable once the work, reserved production capacity, or accepted milestone tied to that payment begins. Customer delay, missing material, changed decisions, abandonment, nonuse, or refusal of work matching the accepted scope does not create a refund, erase an earned installment, or delay amounts already due. Work outside the accepted scope requires a separately accepted change order.</p>
          <p>The included 30-day workmanship correction window starts only when immutable final handoff is recorded after financial clearance. It covers reproducible defects in accepted deliverables, not new content, new features, changed decisions, third-party changes, another operator’s damage, provider incidents, or work outside the accepted scope. Ongoing Care requires a separate released and accepted written scope.</p>
        </div></details>`;
}

const TERMS_CUSTOMER_CONTENT = `        <h2 id="customer-content">Customer content, rights, responsibility, and claims</h2>
        <p class="legal-topic-summary" data-legal-summary="customer-content">The customer must have the rights and authority for everything supplied or directed and is responsible for resulting third-party claims.</p>
        <details class="legal-topic" data-legal-topic="customer-content"><summary>Read customer-content terms</summary><div class="legal-topic-body" data-legal-clause="customer-content">
          <p>The customer grants Desiderata Labs LLC and its service providers a nonexclusive permission to receive, store, back up, compile, screen, display, secure, review, and deliver customer material only as reasonably needed for the accepted account, project, assessment, Custom, payment, and delivery services. The customer represents that it has all rights, permissions, licenses, and authority needed for the names, marks, words, images, links, data, access, instructions, and other material it supplies or directs Site Sourcery to use. Do not provide passwords, full payment-card data, regulated health information, or unrelated sensitive information.</p>
          <p>To the fullest extent permitted by law, the customer will defend, indemnify, and hold harmless Desiderata Labs LLC, its personnel, contractors, and service providers from third-party claims, damages, judgments, penalties, costs, and reasonable attorneys’ fees arising from customer-supplied material, customer instructions, the customer’s lack of authority, unlawful use, infringement, or misuse of delivered work. This obligation does not apply to the extent a claim was caused by Desiderata Labs LLC’s fraud, willful misconduct, or material breach of the accepted agreement.</p>
        </div></details>`;

const TERMS_WARRANTY = `        <h2 id="warranty">Service warranty boundary</h2>
        <p class="legal-topic-summary" data-legal-summary="warranty">Except for an express accepted scope or correction window, services are provided as available without additional warranties.</p>
        <details class="legal-topic" data-legal-topic="warranty"><summary>Read warranty terms</summary><div class="legal-topic-body" data-legal-clause="warranty">
          <p>To the fullest extent permitted by law, and except for an express commitment in the accepted written scope or the stated 30-day workmanship correction window, the public pages, maker, account, saved-project, payment, assessment, Custom, and Download functions are provided “as is” and “as available.” Desiderata Labs LLC disclaims implied warranties of merchantability, fitness for a particular purpose, title, noninfringement, and uninterrupted or error-free operation. Network, browser, payment, customer-device, customer-supplied content, and independent provider systems can fail separately. Customers must inspect delivered work, verify suitability for their business and legal setting, and keep suitable copies.</p>
        </div></details>`;

const TERMS_LIMITS = `        <h2 id="limits">Liability limits and separate written agreements</h2>
        <p class="legal-topic-summary" data-legal-summary="limits">No indirect or lost-profit damages; total liability is capped at the amount paid for the specific affected purchase.</p>
        <details class="legal-topic" data-legal-topic="limits"><summary>Read limit terms</summary><div class="legal-topic-body" data-legal-clause="limits">
          <p>To the fullest extent permitted by law, Desiderata Labs LLC is not liable for indirect, incidental, special, exemplary, punitive, or consequential damages, or for lost profits, revenue, business, goodwill, data, opportunities, anticipated savings, business interruption, or substitute services, arising from or related to Site Sourcery, any purchase, or any delivered work, regardless of the legal theory and even if advised that harm was possible.</p>
          <p>To the fullest extent permitted by law, Desiderata Labs LLC’s total aggregate liability for all claims arising from or related to a specific affected purchase or service will not exceed the amount the customer actually paid directly to Desiderata Labs LLC for that specific affected purchase or service. These exclusions and caps apply together, survive termination, and apply even if a limited remedy fails of its essential purpose.</p>
          <p>An accepted project agreement can state different project-specific commitments, remedies, or limits and controls for that project. Nothing in these terms excludes liability or a right that applicable law does not permit the parties to exclude or limit, including liability for fraud or willful misconduct.</p>
        </div></details>`;

function termsResponder(truth) {
  return `        <h2 id="hive-planner">The Responder remains held</h2>
        <p class="legal-topic-summary" data-legal-summary="hive-planner">The Responder preserves the customer’s carrier in the planned design, but records no public order, payment, call, message, or activation.</p>
        <details class="legal-topic" data-legal-topic="hive-planner"><summary>Read held Responder terms</summary><div class="legal-topic-body" data-legal-clause="hive-planner">
          <p>The private held authority ${truth.responder.catalogVersion}, digest <code>${truth.responder.catalogDigest}</code>, contains a $300 one-time setup amount and a separate $250 monthly amount. Those values are planning authority only—not a public quote or offer—and the initial $550 subtotal is not submitted while held. The public page cannot connect a number, activate forwarding, create an order or invoice, take payment, send a message, contact Twilio, or operate a business process.</p>
          <p>The planned universal launch path uses carrier-supported conditional no-answer forwarding so a customer need not switch carriers; Twilio is the initial approved managed transport, not exclusive product authority. iPhone and Android clients remain unreleased. Customer acceptance, legal publication, tax review, Stripe configuration, A2P and consent proof, opt-out handling, carrier and provider release, monitored delivery, native-store approval where applicable, and owner activation remain separate gates.</p>
        </div></details>`;
}

function termsCare(truth) {
  const overflow = CARE_PLANS.find(({ id }) => id === "partner").overflow;
  return `        <h2 id="care">Care and Alakazam remain separate and held</h2>
        <p class="legal-topic-summary" data-legal-summary="care">Care and Alakazam catalog entries are planning values, not subscriptions available for acceptance, billing, hosting, or publication.</p>
        <details class="legal-topic" data-legal-topic="care"><summary>Read held Care and Alakazam terms</summary><div class="legal-topic-body" data-legal-clause="care">
          <p>The exact held Care ladder is ${truth.care}. The Partner plan’s held overflow is ${dollars(overflow.rateCentsPerStartedMinute)} per started minute, capped at ${dollars(overflow.maximumCents)} and ${overflow.maximumMinutes} minutes in a month. These prices exclude tax and provider costs and remain non-binding planning values: no Care plan can be accepted, invoiced, paid, or activated under these terms. Maintenance, monitoring, backups, content changes, incident response, and other ongoing duties are not inherited from a conversation, Download, assessment, or Custom build.</p>
          <p>Alakazam subscriptions, hosting activation, publication, Care, lifecycle, and tier capabilities remain held and unavailable. The existing private tier machinery includes $25, $35, and $50 monthly planning tiers, but no plan price is a public offer and these terms authorize no subscription payment. A later release must disclose and prove renewal, cancellation, nonpayment, downgrade, export, retention, deletion, refund, support, publication, provider, and customer-domain rules before acceptance or payment.</p>
        </div></details>`;
}

const TERMS_CHANGES = `        <h2 id="changes-contact">Changes, governing setting, requests, and contact</h2>
        <p class="legal-topic-summary" data-legal-summary="changes-contact">New Jersey law governs and New Jersey courts are the agreed forum to the extent permitted by law.</p>
        <details class="legal-topic" data-legal-topic="changes-contact"><summary>Read change and contact terms</summary><div class="legal-topic-body" data-legal-clause="changes-contact">
          <p>These terms and each covered transaction are governed by New Jersey law, without regard to conflict-of-law rules. To the extent permitted by law, any court action must be brought exclusively in a New Jersey state court located in Gloucester County or in the United States District Court for the District of New Jersey, and each party consents to that jurisdiction and venue. A nonwaivable right to use another forum remains unaffected.</p>
          <p>A material change is issued under a new exact version and effective time and receives direct notice or fresh acceptance when required. Questions and legal notices can begin at (856) 244-1220 or sitesourcery@proton.me; Site Sourcery may verify identity and authority before acting on an account, contract, or privacy request.</p>
        </div></details>`;

export function renderWebsiteTermsV5({ root = process.cwd(), plan } = {}) {
  const truth = commercialTruth();
  let source = readFrozenSource(root, SOURCES.websiteTerms);
  source = applyCommon(source, plan, "website-terms");
  source = replaceExactlyOnce(
    source,
    '<meta name="description" content="Terms for Site Sourcery public pages, the free guest maker, saved projects, $5 Download, the $200 Website assessment, and accepted Custom builds.">',
    '<meta name="description" content="Terms for Site Sourcery public pages, Abracadabra, saved projects, $5 Download, the $350 Website assessment, Custom builds, and explicitly held products.">',
    "terms description",
  );
  source = replaceSection(source, "acceptance", TERMS_ACCEPTANCE);
  source = replaceSection(source, "customer-domains", TERMS_DOMAINS);
  source = replaceSection(source, "billing-cancellation", TERMS_BILLING);
  source = replaceSection(source, "customer-content", TERMS_CUSTOMER_CONTENT);
  source = replaceSection(source, "assessment", TERMS_ASSESSMENT);
  source = replaceSection(source, "custom-work", termsCustom(truth));
  source = replaceSection(source, "hive-planner", termsResponder(truth));
  source = replaceSection(source, "care", termsCare(truth));
  source = replaceSection(source, "warranty", TERMS_WARRANTY);
  source = replaceSection(source, "limits", TERMS_LIMITS);
  source = replaceSection(source, "changes-contact", TERMS_CHANGES);
  assertRenderedWebsiteTermsV5(source, plan);
  return source;
}

function centerHero(privacyPlan, termsPlan) {
  const review = privacyPlan.mode === "review";
  const aside = review
    ? `<aside class="quote-panel" data-joint-legal-v5-review-state="unsealed"><p class="card-kicker">${REVIEW_LABEL}</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Candidate documents: ${privacyPlan.displayVersion} and ${termsPlan.displayVersion}. They are noindex, unpublished, nondeployable, and have no effective UTC time.</p></aside>`
    : `<aside class="quote-panel"><p class="card-kicker">${privacyPlan.effectiveLabel}</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Current documents: ${privacyPlan.displayVersion} and ${termsPlan.displayVersion}. Both use the same effective UTC time, ${privacyPlan.effectiveAt}.</p></aside>`;
  return `<section class="hero"><div class="site-shell hero-grid"><div class="hero-copy"><p class="eyebrow">${review ? "Joint Legal V5 review candidate" : "Current Site Sourcery legal documents"}</p><h1>Privacy, terms, catalog, and release state in one place.</h1><p class="lede" data-legal-summary="hero">The $5 Download, $350 Website assessment, accepted Custom work, exact non-cash credit, tax posture, providers, retention, and every held product boundary are stated in the documents below.</p></div>${aside}</div></section>`;
}

function centerCards(privacyPlan, termsPlan) {
  return `<section class="section section-dark"><div class="site-shell card-grid">
      <article class="card"><p class="card-kicker">Privacy notice</p><h2>Information, providers, and exact retention</h2><p data-legal-summary="privacy">Public requests, accounts, saved projects, payment or credit evidence, professional-service records, Cloudflare, Stripe, Resend, Proton, held providers, security, deletion, and requests.</p><a class="button button-primary" href="/legal/privacy/">Read Privacy V5</a></article>
      <article class="card"><p class="card-kicker">Website and product terms</p><h2>Final sales, prices, work, and hard limits</h2><p data-legal-summary="terms">Catalog ${CATALOG_VERSION}, all-sales-final posture, $350 assessment, credit-only Card settlement, Custom payment boundaries, customer-supplied-content responsibility, and capped liability.</p><a class="button button-primary" href="/legal/website-terms/">Read Website Terms V5</a></article>
      <article class="card"><p class="card-kicker">Held means unavailable</p><h2>No silent product or provider release</h2><p data-legal-summary="held">Alakazam, Care, registrar and DNS mutations, publication, The Responder, native clients, and their payment, telephony, messaging, mail, and provider effects remain held until separately approved.</p><a class="button button-secondary" href="/services/">See product status</a></article>
      <article class="card"><p class="card-kicker">Direct contact</p><h2>Desiderata Labs LLC · Site Sourcery</h2><p data-legal-summary="contact">New Jersey, United States. Site Sourcery may verify identity or authority before acting on an account, contract, payment, or privacy request.</p><p><a href="tel:+18562441220">(856) 244-1220</a><br><a href="mailto:sitesourcery@proton.me">sitesourcery@proton.me</a></p></article>
    </div></section>`;
}

export function renderLegalCenterV5({ root = process.cwd(), privacyPlan, termsPlan } = {}) {
  commercialTruth();
  if (
    !privacyPlan
    || !termsPlan
    || privacyPlan.mode !== termsPlan.mode
    || (privacyPlan.mode === "final" && privacyPlan.effectiveAt !== termsPlan.effectiveAt)
  ) throw new Error("joint legal V5 center requires one matched legal plan");
  let source = readFrozenSource(root, SOURCES.center);
  source = replacePatternOnce(
    source,
    /<nav class="site-nav" id="primary-menu"[\s\S]*?<\/nav>/u,
    CURRENT_NAV,
    "center navigation",
  );
  source = replaceExactlyOnce(
    source,
    "<title>Privacy V4 and Website Terms V4 · Site Sourcery</title>",
    `<title>${privacyPlan.mode === "review" ? "Joint Legal V5 review" : "Privacy V5 and Website Terms V5"} · Site Sourcery</title>`,
    "center title",
  );
  source = replacePatternOnce(
    source,
    /<main id="main" tabindex="-1">[\s\S]*?<\/main>/u,
    `<main id="main" tabindex="-1">\n    ${centerHero(privacyPlan, termsPlan)}\n    ${centerCards(privacyPlan, termsPlan)}\n  </main>`,
    "center content",
  );
  source = replaceExactlyOnce(
    source,
    '<body class="vnext-page legal-page legal-center-page">',
    `<body class="vnext-page legal-page legal-center-page" data-joint-legal-v5-state="${privacyPlan.mode === "review" ? "review-unsealed" : privacyPlan.mode}">`,
    "center body state",
  );
  if (privacyPlan.mode === "review") {
    source = replaceExactlyOnce(
      source,
      "</head>",
      '  <meta name="robots" content="noindex,nofollow,noarchive">\n  <meta name="sitesourcery-release-state" content="review-only-nondeployable">\n</head>',
      "center review metadata",
    );
  }
  assertRenderedLegalCenterV5(source, privacyPlan, termsPlan);
  return source;
}

function assertMode(source, plan, token, label) {
  if (plan.mode === "review") {
    if (
      !source.includes('data-joint-legal-v5-review-state="unsealed"')
      || !source.includes("noindex,nofollow,noarchive")
      || !source.includes("review-only-nondeployable")
      || /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V5/u.test(source)
    ) throw new Error(`joint legal V5 ${label} review is release-ambiguous`);
  } else if (plan.mode === "content-template") {
    if (
      occurrences(source, token) !== 1
      || occurrences(source, JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN) !== 1
      || source.includes("noindex,nofollow")
    ) throw new Error(`joint legal V5 ${label} template is release-ambiguous`);
  } else if (
    plan.mode !== "final"
    || occurrences(source, plan.version) !== 1
    || occurrences(source, plan.effectiveLabel) !== 1
    || source.includes("noindex,nofollow")
    || source.includes(token)
  ) throw new Error(`joint legal V5 ${label} final render does not match its plan`);
}

export function assertRenderedPrivacyV5(source, plan) {
  for (const phrase of [
    "Desiderata Labs LLC operates this website from New Jersey",
    CATALOG_VERSION,
    CATALOG_DIGEST,
    "$350 Website assessment",
    "no Checkout, PaymentIntent, Charge, or payment receipt",
    "Operational logs are normally retained for 90 days",
    "security and audit evidence for one year",
    "support records for two years",
    "normally retained for seven years",
    "Daily encrypted off-machine backups use a 30-day deletion horizon",
    "Spaceship registrar mutations and Twilio telephony or messaging remain held",
    "(856)&nbsp;244&#8209;1220",
    "sitesourcery@proton.me",
  ]) if (!source.includes(phrase)) {
    throw new Error(`Privacy V5 is missing required truth: ${phrase}`);
  }
  if (source.includes("$200 Website assessment") || source.includes("V4")) {
    throw new Error("Privacy V5 retained stale legal or catalog truth");
  }
  assertMode(source, plan, PRIVACY_V5_VERSION_TOKEN, "privacy");
  return true;
}

export function assertRenderedWebsiteTermsV5(source, plan) {
  const truth = commercialTruth();
  for (const phrase of [
    CATALOG_VERSION,
    CATALOG_DIGEST,
    truth.tiers,
    truth.care,
    "$300 one-time setup amount and a separate $250 monthly amount",
    "$350 gross start, $350 credit, and $0 customer subtotal",
    "no Checkout, PaymentIntent, Charge, or payment receipt",
    "Card and Card Plus require full payment or exact credit clearance",
    "Ownership of agreed client deliverables transfers only after final payment",
    "The included 30-day workmanship correction window starts only",
    "current internal tax state is <code>disabled_by_owner</code>",
    "all sales are final and all payments are non-refundable",
    "The assessment payment is final and non-refundable once assessment work begins",
    "Each Custom payment is final and non-refundable once the work",
    "the customer will defend, indemnify, and hold harmless Desiderata Labs LLC",
    "total aggregate liability for all claims arising from or related to a specific affected purchase",
    "governed by New Jersey law",
    "remain held until separately released",
  ]) if (!source.includes(phrase)) {
    throw new Error(`Website Terms V5 is missing required truth: ${phrase}`);
  }
  if (source.includes("$200 Website assessment") || source.includes("V4")) {
    throw new Error("Website Terms V5 retained stale legal or catalog truth");
  }
  assertMode(source, plan, WEBSITE_TERMS_V5_VERSION_TOKEN, "terms");
  return true;
}

export function assertRenderedLegalCenterV5(source, privacyPlan, termsPlan) {
  for (const phrase of [
    CATALOG_VERSION,
    "$350 Website assessment",
    "credit-only Card settlement",
    "Alakazam, Care, registrar and DNS mutations",
    "Desiderata Labs LLC · Site Sourcery",
    privacyPlan.displayVersion,
    termsPlan.displayVersion,
  ]) if (!source.includes(phrase)) {
    throw new Error(`Legal center V5 is missing required truth: ${phrase}`);
  }
  if (source.includes("$200 Website assessment") || source.includes("Privacy V4")) {
    throw new Error("Legal center V5 retained stale legal or catalog truth");
  }
  if (privacyPlan.mode === "review" && (
    !source.includes("noindex,nofollow,noarchive")
    || !source.includes('data-joint-legal-v5-review-state="unsealed"')
  )) throw new Error("Legal center V5 review is release-ambiguous");
  return true;
}

export function normalizePrivacyV5Final(source, plan) {
  assertRenderedPrivacyV5(source, plan);
  const normalized = source
    .replace('data-joint-legal-v5-state="final"',
      'data-joint-legal-v5-state="content-template"')
    .replace(plan.effectiveLabel, JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN)
    .replace(plan.version, PRIVACY_V5_VERSION_TOKEN);
  assertRenderedPrivacyV5(
    normalized,
    createPrivacyV5RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}

export function normalizeWebsiteTermsV5Final(source, plan) {
  assertRenderedWebsiteTermsV5(source, plan);
  const normalized = source
    .replace('data-joint-legal-v5-state="final"',
      'data-joint-legal-v5-state="content-template"')
    .replace(plan.effectiveLabel, JOINT_LEGAL_V5_EFFECTIVE_LABEL_TOKEN)
    .replace(plan.version, WEBSITE_TERMS_V5_VERSION_TOKEN);
  assertRenderedWebsiteTermsV5(
    normalized,
    createWebsiteTermsV5RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}

export const JOINT_LEGAL_V5_SOURCE_IDENTITIES = SOURCE_IDENTITIES;
