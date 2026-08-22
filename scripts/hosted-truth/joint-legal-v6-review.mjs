import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createPagesJointLegalV5Plan } from "./pages-legal-v5.mjs";

export const JOINT_LEGAL_V6_REVIEW_SCHEMA =
  "sitesourcery.joint-legal-v6-review/v1";
export const PRIVACY_V6_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-JOINT-REVIEW-DRAFT-V6";
export const WEBSITE_TERMS_V6_REVIEW_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-JOINT-REVIEW-DRAFT-V6";

const REVIEW_LABEL = "Not effective — joint legal V6 review only";
const REVIEW_META =
  '  <meta name="robots" content="noindex,nofollow,noarchive">\n'
  + '  <meta name="sitesourcery-release-state" content="review-only-nondeployable">\n';
const V5_PRIVACY_VERSION = "SS-HOSTED-PRIVACY-2026-08-20-V5";
const V5_TERMS_VERSION = "SS-HOSTED-WEBSITE-TERMS-2026-08-20-V5";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V6 ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function replacePatternOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`joint legal V6 ${label} anchor changed`);
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

function currentV5Source(root, role) {
  const plan = createPagesJointLegalV5Plan({ root });
  const artifact = plan.v5.artifacts.find((candidate) => candidate.role === role);
  if (!artifact) throw new Error(`joint legal V6 source role is missing: ${role}`);
  return readFileSync(artifact.source, "utf8");
}

function replaceDownloadPrice(source) {
  return source.replace(/\$5(?!\d)/gu, "$20");
}

function normalizeDisplayedPhone(source) {
  return source.replaceAll("(856) 244-1220", "(856)&nbsp;244&#8209;1220");
}

function reviewMetadata(source, label) {
  if (source.includes("noindex,nofollow,noarchive")) {
    throw new Error(`joint legal V6 ${label} source already contains review metadata`);
  }
  return replaceExactlyOnce(
    source,
    "</head>",
    `${REVIEW_META}</head>`,
    `${label} review metadata`,
  );
}

const PRIVACY_NETWORK = `      <h2 id="network-records">Server, network, and service-provider records</h2>
      <p class="legal-topic-summary" data-legal-summary="network-records">Cloudflare handles DNS and edge delivery. Dell-hosted services, PostgreSQL, backups, Stripe, Resend, and Proton handle only the work assigned to them; held providers receive no production instruction.</p>
      <details class="legal-topic" data-legal-topic="network-records"><summary>Read full provider details</summary><div class="legal-topic-body" data-legal-clause="network-records">
      <p>Cloudflare is the planned successor’s authoritative DNS provider and HTTPS reverse-proxy and security edge. A visitor’s HTTPS connection terminates at Cloudflare before an encrypted, outbound-only Cloudflare Tunnel forwards a request to the Dell origin. Cloudflare can process the visitor IP address; requested hostname, path, and query; request headers and similar browser or device data; cookies and session data carried in a request; response data needed to proxy the exchange; and delivery, security, error, and timing records. Tunnel encryption protects edge-to-origin transport; it does not prevent Cloudflare from handling request and response content at its edge.</p>
      <p>The selected configuration does not use Cloudflare advertising, Web Analytics, Workers, email routing, or Turnstile. The Domains preflight separately uses Cloudflare’s public DNS resolver only after the user presses its check control. Cloudflare’s resolver commitments are distinct from Site Sourcery’s own retention schedule.</p>
      <p>Dell hosting, PostgreSQL, encrypted off-machine backups, and file delivery process account, project, evidence, transaction, access, request, security, and timestamp records needed for released services. Stripe handles secure card entry and can receive the verified account email, checkout contact and billing-address fields, service purpose, amount, currency, requested card authentication, and Site Sourcery reference metadata. Stripe can return Customer, Checkout, PaymentIntent, Charge, card-authentication, billing-identity, risk, refund, early-fraud-warning, dispute, and event evidence. Requesting 3D Secure does not mean the issuer will require or successfully complete it. Resend handles transactional account and recovery email with Site Sourcery open and click tracking disabled. Direct email uses Proton Mail.</p>
      <p>Spaceship registrar mutations and Twilio telephony or messaging remain held. While held, those providers receive no customer registration, DNS, call, or message instruction from this release. No iPhone or Android Responder client is publicly released.</p>
      </div></details>`;

const PRIVACY_BILLING = `      <h2 id="billing">Billing, tax, credit, and payment-protection information</h2>
      <p class="legal-topic-summary" data-legal-summary="billing">Stripe handles positive card payments. Download records bind the verified account, exact $20 quote and terms acceptance, billing identity, settlement, and file-access evidence.</p>
      <details class="legal-topic" data-legal-topic="billing"><summary>Read full billing details</summary><div class="legal-topic-body" data-legal-clause="billing">
      <p>For an authorized positive payment, secure card entry belongs to Stripe. For Download, Site Sourcery can receive and store the verified account and organization; project and accepted-version identifiers; exact quote, catalog, terms, disclosure, and acceptance versions and digests; acceptance statement, time, request identifier, client IP address, and user-agent digest; Stripe Customer, Checkout, event, PaymentIntent, and Charge identifiers; customer name, verified email, billing address and its digest; requested and returned card-authentication facts; card-network and risk facts; subtotal, credit, tax, total, currency, and tax mode; settlement, entitlement, refund, early-fraud-warning, dispute, or reversal facts; provider readback; Checkout-attempt outcome; Download-access request, time, artifact digest, byte count, client IP address, and user-agent digest; and related timestamps. Site Sourcery does not ask for or store the full card number or card security code.</p>
      <p>A completed one-time $20 payment activates Download for that retained editor project. The full $20 also creates one non-transferable, one-use, non-cash credit for the same account and project’s first separately released Alakazam invoice. The credit is not cash, a refund, a stored-value balance, or permission to use Alakazam while it remains held. It cannot be transferred, redeemed, duplicated, stacked, or used for another account or project. A refund, reversal, or lost dispute involving the Download payment can make the credit unavailable or reverse it if already applied, subject to applicable law and the separately accepted Alakazam invoice terms.</p>
      <p>An early fraud warning, open dispute, partial refund, or another exact payment-risk signal can suspend future Download access and temporarily hold new Download Checkouts while Site Sourcery reviews the signal. A private dispute dossier can combine the exact account, acceptance, quote, billing, payment, risk, entitlement, and access records above. Dossier export and a decision to reopen the Checkout gate are restricted to an authorized organization owner and bound to the exact reviewed dossier digest.</p>
      <p>The current internal tax state is <code>disabled_by_owner</code>: Site Sourcery does not calculate or collect tax through the held payment path. That state is not a representation that no tax is legally due. Refund availability and service consequences follow the accepted terms, provider evidence, and applicable law; this notice makes no blanket refund or dispute-outcome promise.</p>
      </div></details>`;

const PRIVACY_RETENTION = `      <h2 id="retention">Retention and deletion</h2>
      <p class="legal-topic-summary" data-legal-summary="retention">Active service data remains while needed. Standard periods range from 90 days to seven years by record type, subject to deletion, legal holds, disputes, and required duties.</p>
      <details class="legal-topic" data-legal-topic="retention"><summary>Read the exact retention schedule</summary><div class="legal-topic-body" data-legal-clause="retention">
      <p>Guest versions can remain in the tab’s session storage through a refresh or payment return; closing the tab or clearing that storage ordinarily removes them, subject to browser controls. Active account, customer, and project data remains while the service or contract requires it. A cancelled hosted project receives a 14-day service grace period followed by a standard 90-day customer-content retention period before eligible customer-authored content is deleted. Customers should export and keep files they need.</p>
      <p>Operational logs are normally retained for 90 days; security and general audit evidence for one year; prospect records for 12 months after last activity; and support records for two years. Contract, acceptance, invoice, payment, credit, refund, early-fraud-warning, dispute, tax, private-dossier, gate-review, and Download-access evidence is normally retained for seven years. Minimal do-not-contact suppression data remains while needed to enforce the request. A longer period can apply when reasonably necessary for an active service, accounting or tax duty, payment dispute, fraud or security investigation, legal claim, litigation hold, court order, or other law.</p>
      <p>Daily encrypted off-machine backups use a 30-day deletion horizon and retain at least seven verified successful backups as an operational target. Deleting active data does not instantly erase an existing backup; an older copy can remain until that backup ages out. If a backup is restored, the deletion record still applies. Verified deletion removes eligible customer-authored content while preserving only the minimized authority, audit, security, financial, suppression, detached-domain, and deletion evidence still required for the purposes above.</p>
      </div></details>`;

const TERMS_BILLING = `        <h2 id="billing-cancellation">Payment, $20 Download, credit, final sales, and disputes</h2>
        <p class="legal-topic-summary" data-legal-summary="billing-cancellation">The $20 Download is a one-time final sale after the accepted file is made available, subject to rights and remedies that applicable law does not permit the parties to waive.</p>
        <details class="legal-topic" data-legal-topic="billing-cancellation"><summary>Read payment, delivery, credit, and reversal terms</summary><div class="legal-topic-body" data-legal-clause="billing-cancellation">
          <p>Before payment, the signed-in customer sees the exact $20 USD Download quote, editor project and accepted version, what file will be delivered, what is not included, the final-sale boundary, the full non-cash credit rules, and the controlling terms and privacy versions. The customer must affirmatively accept that exact disclosure. A held, expired, declined, cancelled, mismatched, rate-limited, risk-held, or otherwise incomplete Checkout creates no entitlement or paid-service authority.</p>
          <p>Secure card entry is handled by Stripe. Site Sourcery requires the Stripe billing email to match the verified account email, collects a billing address, and requests 3D Secure authentication. The card issuer controls whether authentication is required or succeeds. Authentication, billing match, or any other fraud signal is evidence, not a guarantee that a payment is authorized and not a waiver of any nonwaivable cardholder right.</p>
          <p>A completed one-time $20 payment unlocks Download for that retained editor project and does not renew. The sale becomes final, except where applicable law requires otherwise, when the exact accepted HTML file is made available through the authenticated Download route. The purchase covers that HTML file and repeat access to the retained project entitlement; it does not include a domain, hosting, publication, subscription, human revision, custom service, maintenance, or support. Site Sourcery cannot retrieve a file already saved to the customer’s device or independent host.</p>
          <p>The full $20 creates one non-transferable, one-use, non-cash credit toward the same account and project’s first separately released Alakazam invoice. The credit has no cash value, is not a refund or stored-value balance, cannot be transferred, duplicated, stacked, or used for another account or project, and does not release Alakazam. It can be applied only after Alakazam, its invoice, lifecycle, support, publication, tax, and payment terms are separately released and accepted. A refund, reversal, or lost dispute involving the Download payment can make the credit unavailable or reverse it if already applied, subject to applicable law and the accepted Alakazam invoice.</p>
          <p>Except where applicable law expressly requires otherwise or a separately accepted written agreement expressly says otherwise, all sales are final and Site Sourcery offers no voluntary refund, return, cancellation, cash redemption, or replacement credit for change of mind, nonuse, customer delay, customer-supplied error, or subjective dissatisfaction with a file that matches the accepted version and disclosed delivery. This clause does not limit a remedy for non-delivery, a materially nonconforming file, fraud, or another right that applicable law does not allow the parties to waive.</p>
          <p>A customer with a payment or delivery concern may contact Site Sourcery before starting a card dispute so the exact record can be reviewed, but doing so is not a waiver of any lawful dispute right. Stripe, the card network, and the issuing bank control the dispute process and outcome. Site Sourcery may submit the verified account, accepted terms and quote, billing and authentication facts, provider settlement, artifact identity, and Download-access records in response. No term, 3D Secure result, receipt, or evidence package guarantees that Site Sourcery will win a dispute.</p>
          <p>A refund, reversal, chargeback, open dispute, partial refund, or early fraud warning can revoke or suspend future Download access and can temporarily hold new Download Checkouts while an authorized owner reviews the exact private dossier. Reopening requires a recorded owner decision bound to the reviewed dossier digest. These service-side controls cannot retrieve an already delivered file.</p>
        </div></details>`;

function privacyAside() {
  return `<aside class="quote-panel" data-joint-legal-v6-review-state="unsealed"><p class="card-kicker">${REVIEW_LABEL}</p><h2>Notice ${PRIVACY_V6_REVIEW_VERSION}</h2><p>This exact candidate is for owner and legal review. It is noindex, nondeployable, unpublished, has no effective time, and creates no customer, payment, provider, publication, or acceptance effect.</p></aside>`;
}

function termsAside() {
  return `<aside class="quote-panel" data-joint-legal-v6-review-state="unsealed"><p class="card-kicker">${REVIEW_LABEL}</p><h2>Terms ${WEBSITE_TERMS_V6_REVIEW_VERSION}</h2><p>This exact candidate is for owner and legal review. It is noindex, nondeployable, unpublished, has no effective time, and creates no customer, payment, provider, publication, or acceptance effect.</p></aside>`;
}

export function renderPrivacyV6Review({ root = process.cwd() } = {}) {
  let source = currentV5Source(root, "privacy-current");
  source = replaceDownloadPrice(source);
  source = replaceExactlyOnce(source, V5_PRIVACY_VERSION,
    PRIVACY_V6_REVIEW_VERSION, "privacy version");
  source = replaceExactlyOnce(source,
    'data-joint-legal-v5-state="final"',
    'data-joint-legal-v6-state="review-unsealed"', "privacy body state");
  source = replacePatternOnce(source,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    privacyAside(), "privacy identity");
  source = reviewMetadata(source, "privacy");
  source = replaceSection(source, "network-records", PRIVACY_NETWORK);
  source = replaceSection(source, "billing", PRIVACY_BILLING);
  source = replaceSection(source, "retention", PRIVACY_RETENTION);
  source = normalizeDisplayedPhone(source);
  assertPrivacyV6Review(source);
  return source;
}

export function renderWebsiteTermsV6Review({ root = process.cwd() } = {}) {
  let source = currentV5Source(root, "website-terms-current");
  source = replaceDownloadPrice(source);
  source = replaceExactlyOnce(source, V5_TERMS_VERSION,
    WEBSITE_TERMS_V6_REVIEW_VERSION, "terms version");
  source = replaceExactlyOnce(source,
    'data-joint-legal-v5-state="final"',
    'data-joint-legal-v6-state="review-unsealed"', "terms body state");
  source = replacePatternOnce(source,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    termsAside(), "terms identity");
  source = reviewMetadata(source, "terms");
  source = replaceSection(source, "billing-cancellation", TERMS_BILLING);
  source = normalizeDisplayedPhone(source);
  assertWebsiteTermsV6Review(source);
  return source;
}

export function renderLegalCenterV6Review({ root = process.cwd() } = {}) {
  let source = currentV5Source(root, "legal-center-current");
  source = replaceDownloadPrice(source);
  source = replaceExactlyOnce(source,
    "<title>Privacy V5 and Website Terms V5 · Site Sourcery</title>",
    "<title>Joint Legal V6 review · Site Sourcery</title>", "center title");
  source = replaceExactlyOnce(source,
    'data-joint-legal-v5-state="final"',
    'data-joint-legal-v6-state="review-unsealed"', "center body state");
  source = replacePatternOnce(source,
    /<aside class="quote-panel">[\s\S]*?<\/aside>/u,
    `<aside class="quote-panel" data-joint-legal-v6-review-state="unsealed"><p class="card-kicker">${REVIEW_LABEL}</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Candidate documents: ${PRIVACY_V6_REVIEW_VERSION} and ${WEBSITE_TERMS_V6_REVIEW_VERSION}. They are noindex, unpublished, nondeployable, and have no effective UTC time.</p></aside>`,
    "center identity");
  source = reviewMetadata(source, "center");
  source = source
    .replace("Current Site Sourcery legal documents", "Joint Legal V6 review candidate")
    .replace("Read Privacy V5", "Read Privacy V6 review")
    .replace("Read Website Terms V5", "Read Website Terms V6 review")
    .replace(
      "The $20 Download, $350 Website assessment, accepted Custom work, exact non-cash credit, tax posture, providers, retention, and every held product boundary are stated in the documents below.",
      "The $20 Download, full same-account and same-project Alakazam invoice credit, exact purchase and delivery evidence, payment-risk controls, $350 Website assessment, accepted Custom work, tax posture, providers, retention, and every held product boundary are stated in the documents below.",
    );
  source = normalizeDisplayedPhone(source);
  assertLegalCenterV6Review(source);
  return source;
}

function assertCommonReview(source, label) {
  if (
    !source.includes('name="robots" content="noindex,nofollow,noarchive"')
    || !source.includes('name="sitesourcery-release-state" content="review-only-nondeployable"')
    || !source.includes('data-joint-legal-v6-state="review-unsealed"')
    || !source.includes('data-joint-legal-v6-review-state="unsealed"')
    || source.includes('data-joint-legal-v5-state="final"')
    || source.includes(V5_PRIVACY_VERSION)
    || source.includes(V5_TERMS_VERSION)
    || /\$5(?!\d)/u.test(source)
    || /SS-HOSTED-(?:PRIVACY|WEBSITE-TERMS)-\d{4}-\d{2}-\d{2}-V6/u.test(source)
    || source.includes("2026-08-21T04:00:00.000Z")
    || source.includes("Effective August 21, 2026")
  ) throw new Error(`joint legal V6 ${label} review is release-ambiguous`);
}

export function assertPrivacyV6Review(source) {
  assertCommonReview(source, "privacy");
  for (const phrase of [
    PRIVACY_V6_REVIEW_VERSION,
    "exact $20 quote and terms acceptance",
    "requested and returned card-authentication facts",
    "early-fraud-warning, dispute, or reversal facts",
    "Download-access request, time, artifact digest, byte count",
    "same account and project’s first separately released Alakazam invoice",
    "private dispute dossier",
    "authorized organization owner",
    "normally retained for seven years",
    "does not ask for or store the full card number or card security code",
  ]) if (!source.includes(phrase)) {
    throw new Error(`Privacy V6 is missing required review truth: ${phrase}`);
  }
  return true;
}

export function assertWebsiteTermsV6Review(source) {
  assertCommonReview(source, "terms");
  for (const phrase of [
    WEBSITE_TERMS_V6_REVIEW_VERSION,
    "exact $20 USD Download quote",
    "requests 3D Secure authentication",
    "issuer controls whether authentication is required or succeeds",
    "one-time final sale after the accepted file is made available",
    "same account and project’s first separately released Alakazam invoice",
    "cannot be transferred, duplicated, stacked",
    "does not limit a remedy for non-delivery",
    "not a waiver of any lawful dispute right",
    "issuing bank control the dispute process and outcome",
    "No term, 3D Secure result, receipt, or evidence package guarantees",
    "recorded owner decision bound to the reviewed dossier digest",
    "Alakazam subscriptions, hosting activation, publication, Care, lifecycle, and tier capabilities remain held",
  ]) if (!source.includes(phrase)) {
    throw new Error(`Website Terms V6 is missing required review truth: ${phrase}`);
  }
  return true;
}

export function assertLegalCenterV6Review(source) {
  assertCommonReview(source, "center");
  for (const phrase of [
    PRIVACY_V6_REVIEW_VERSION,
    WEBSITE_TERMS_V6_REVIEW_VERSION,
    "Joint Legal V6 review candidate",
    "$20 Download",
    "same-account and same-project Alakazam invoice credit",
    "payment-risk controls",
    "Alakazam, Care, registrar and DNS mutations",
  ]) if (!source.includes(phrase)) {
    throw new Error(`Legal center V6 is missing required review truth: ${phrase}`);
  }
  return true;
}

export function createJointLegalV6ReviewBundle({ root = process.cwd() } = {}) {
  const artifacts = Object.freeze([
    Object.freeze({
      role: "legal-center-review",
      file: "legal/index.html",
      bytes: renderLegalCenterV6Review({ root }),
    }),
    Object.freeze({
      role: "privacy-review",
      file: "legal/privacy/index.html",
      bytes: renderPrivacyV6Review({ root }),
    }),
    Object.freeze({
      role: "website-terms-review",
      file: "legal/website-terms/index.html",
      bytes: renderWebsiteTermsV6Review({ root }),
    }),
  ].map((artifact) => Object.freeze({
    ...artifact,
    sha256: sha256(artifact.bytes),
    byteCount: Buffer.byteLength(artifact.bytes),
  })));
  return Object.freeze({
    schema: JOINT_LEGAL_V6_REVIEW_SCHEMA,
    state: "review-candidate-unapproved",
    published: false,
    deployable: false,
    privacyVersion: null,
    websiteTermsVersion: null,
    effectiveAt: null,
    artifacts,
  });
}
