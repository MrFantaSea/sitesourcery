import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createPrivacyV3RenderPlan,
  normalizePrivacyV3FinalPage,
  renderPrivacyV3CandidatePage,
} from "./privacy-v3-render.mjs";

export const WEBSITE_TERMS_V3_VERSION_TOKEN =
  "__SITESOURCERY_WEBSITE_TERMS_V3_VERSION__";
export const WEBSITE_TERMS_V3_EFFECTIVE_LABEL_TOKEN =
  "__SITESOURCERY_WEBSITE_TERMS_V3_EFFECTIVE_LABEL__";
export const WEBSITE_TERMS_V3_REVIEW_VERSION =
  "SS-HOSTED-WEBSITE-TERMS-JOINT-REVIEW-DRAFT-V3";
export const WEBSITE_TERMS_V3_REVIEW_EFFECTIVE_LABEL =
  "Not effective — joint legal review only";

const TERMS_VERSION =
  /^SS-HOSTED-WEBSITE-TERMS-(\d{4}-\d{2}-\d{2})-V3$/u;
const MONTHS = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);
const TERMS_SOURCE_META =
  '  <meta name="sitesourcery-legal-v3-source-state" content="unsealed">';
const TERMS_SOURCE_ASIDE =
  '<aside class="quote-panel" data-legal-v3-source-state="unsealed"><p class="card-kicker">Not effective — joint legal release identity pending</p><h2>Website Terms V3 review source</h2><p>This copy is not published by an unsealed build. Its version, effective UTC time, exact bytes, and joint acceptance authority are set only after final review.</p></aside>';
const TERMS_REQUIRED_COPY = Object.freeze([
  "Before a guest saves a project, made versions are stored in that tab’s session storage",
  "A held, expired, declined, cancelled, or otherwise incomplete Checkout creates no Download entitlement or paid professional-service authority.",
  "The standard Website assessment costs $200 and is paid in full before assessment work begins.",
  "automatic-tax status and result",
  "Card and Card Plus are paid in full before work starts.",
  "The included 30-day workmanship correction window starts only when the immutable final handoff is recorded after financial clearance.",
  "The Responder is held from sale.",
  "A later Alakazam release requires its separately approved Privacy V4",
  "Site Sourcery preserves the version a customer accepted as transaction evidence.",
]);

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function replaceExactlyOnce(source, before, after, label) {
  if (occurrences(source, before) !== 1) {
    throw new Error(`joint legal V3 ${label} anchor changed`);
  }
  return source.replace(before, after);
}

function truthSlot(source, id, replacement) {
  const start = `<!-- sitesourcery:truth-slot:${id}:start -->`;
  const end = `<!-- sitesourcery:truth-slot:${id}:end -->`;
  if (occurrences(source, start) !== 1 || occurrences(source, end) !== 1) {
    throw new Error(`joint legal V3 truth slot changed: ${id}`);
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex) + end.length;
  return source.slice(0, startIndex) + replacement.trimEnd() + source.slice(endIndex);
}

function exactCanonicalUtc(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && new Date(Date.parse(value)).toISOString() === value;
}

function effectiveLabel(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Website Terms V3 version contains an invalid date");
  }
  return `Effective ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

export function createWebsiteTermsV3RenderPlan(options = {}) {
  if (options?.mode === "review") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error("Website Terms V3 review accepts no release constants");
    }
    return Object.freeze({
      mode: "review",
      version: null,
      effectiveAt: null,
      displayVersion: WEBSITE_TERMS_V3_REVIEW_VERSION,
      effectiveLabel: WEBSITE_TERMS_V3_REVIEW_EFFECTIVE_LABEL,
      versionedFile:
        `legal/website-terms/versions/${WEBSITE_TERMS_V3_REVIEW_VERSION}/index.html`,
    });
  }
  if (options?.mode === "content-template") {
    if (JSON.stringify(Object.keys(options)) !== JSON.stringify(["mode"])) {
      throw new Error("Website Terms V3 content template accepts no release constants");
    }
    return Object.freeze({
      mode: "content-template",
      version: null,
      effectiveAt: null,
      displayVersion: WEBSITE_TERMS_V3_VERSION_TOKEN,
      effectiveLabel: WEBSITE_TERMS_V3_EFFECTIVE_LABEL_TOKEN,
      versionedFile:
        "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-CONTENT-TEMPLATE-V3/index.html",
    });
  }
  const match = String(options?.version ?? "").match(TERMS_VERSION);
  if (
    options?.mode !== "final"
    || options.ownerApproval !== "owner-approved-exact-joint-legal-v3-release-values"
    || !match
    || !exactCanonicalUtc(options.effectiveAt)
    || options.effectiveAt.slice(0, 10) !== match[1]
    || JSON.stringify(Object.keys(options).sort()) !==
      JSON.stringify(["effectiveAt", "mode", "ownerApproval", "version"])
  ) {
    throw new Error(
      "Website Terms V3 finalization requires exact owner-approved matching version and canonical UTC values",
    );
  }
  return Object.freeze({
    mode: "final",
    version: options.version,
    effectiveAt: options.effectiveAt,
    displayVersion: options.version,
    effectiveLabel: effectiveLabel(match[1]),
    versionedFile: `legal/website-terms/versions/${options.version}/index.html`,
  });
}

export function renderWebsiteTermsV3({ root = process.cwd(), plan } = {}) {
  let source = readFileSync(path.join(root, "legal/website-terms/index.html"), "utf8");
  const head = readFileSync(
    path.join(root, "scripts/hosted-truth/candidates/legal-website-terms-v3-head.html"),
    "utf8",
  );
  const main = readFileSync(
    path.join(root, "scripts/hosted-truth/candidates/legal-website-terms-v3-main.html"),
    "utf8",
  );
  source = truthSlot(source, "legal-website-terms-head", head);
  source = truthSlot(source, "legal-website-terms-main", main);
  source = replaceExactlyOnce(
    source,
    "© 2026 Desiderata Labs LLC · DBA Site Sourcery",
    "© 2026 Desiderata Labs LLC · filed alternate name SITESOURCERY",
    "operator footer",
  );
  if (plan.mode === "review") {
    source = replaceExactlyOnce(
      source,
      TERMS_SOURCE_META,
      `${TERMS_SOURCE_META}\n  <meta name="robots" content="noindex,nofollow">`,
      "review metadata",
    );
    source = replaceExactlyOnce(
      source,
      TERMS_SOURCE_ASIDE,
      `<aside class="quote-panel" data-legal-v3-review-state="unsealed"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Terms ${plan.displayVersion}</h2><p>This exact hosted render is for joint legal review only. It is not effective or deployable.</p></aside>`,
      "review identity",
    );
  } else {
    source = replaceExactlyOnce(source, `${TERMS_SOURCE_META}\n`, "", "source metadata");
    source = replaceExactlyOnce(
      source,
      TERMS_SOURCE_ASIDE,
      `<aside class="quote-panel"><p class="card-kicker">${plan.effectiveLabel}</p><h2>Terms ${plan.displayVersion}</h2><p>These terms cover the free guest maker, signed-in saved projects, the $5 HTML Download, the $200 Website assessment, and accepted Custom builds. Alakazam, Care, domain purchase, publication, and The Responder remain held.</p></aside>`,
      "release identity",
    );
  }
  assertRenderedWebsiteTermsV3(source, plan);
  return source;
}

export function assertRenderedWebsiteTermsV3(source, plan) {
  for (const phrase of TERMS_REQUIRED_COPY) {
    if (!source.includes(phrase)) {
      throw new Error(`Website Terms V3 is missing reviewed copy: ${phrase}`);
    }
  }
  for (const stale of [
    "The free preview stays in the editor tab and is cleared by refreshing",
    "can use a short-lived delivery token",
    "Hive is a short phone or in-person conversation",
    "DBA Site Sourcery",
  ]) {
    if (source.includes(stale)) throw new Error(`Website Terms V3 retained stale copy: ${stale}`);
  }
  if (source.includes("sitesourcery:truth-slot:")) {
    throw new Error("Website Terms V3 retained source truth markers");
  }
  if (plan.mode === "review") {
    if (
      !source.includes('data-legal-v3-review-state="unsealed"')
      || !source.includes("noindex,nofollow")
      || /SS-HOSTED-WEBSITE-TERMS-\d{4}-\d{2}-\d{2}-V3/u.test(source)
    ) throw new Error("Website Terms V3 review is release-ambiguous");
  } else if (plan.mode === "content-template") {
    if (
      occurrences(source, WEBSITE_TERMS_V3_VERSION_TOKEN) !== 1
      || occurrences(source, WEBSITE_TERMS_V3_EFFECTIVE_LABEL_TOKEN) !== 1
      || source.includes("noindex,nofollow")
    ) throw new Error("Website Terms V3 template is release-ambiguous");
  } else if (
    plan.mode !== "final"
    || occurrences(source, plan.version) !== 1
    || occurrences(source, plan.effectiveLabel) !== 1
    || source.includes("noindex,nofollow")
    || source.includes(WEBSITE_TERMS_V3_VERSION_TOKEN)
  ) {
    throw new Error("Website Terms V3 final render does not match its plan");
  }
  return true;
}

export function normalizeWebsiteTermsV3Final(source, plan) {
  assertRenderedWebsiteTermsV3(source, plan);
  const normalized = source
    .replace(plan.effectiveLabel, WEBSITE_TERMS_V3_EFFECTIVE_LABEL_TOKEN)
    .replace(plan.version, WEBSITE_TERMS_V3_VERSION_TOKEN);
  assertRenderedWebsiteTermsV3(
    normalized,
    createWebsiteTermsV3RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}

const OLD_OPERATOR_SCOPE =
  "This notice separates ordinary public-page handling, the Start chooser, the held Responder page, the Domains public-DNS preflight, and the free device-local Abracadabra guest preview from the signed-in account, retained editor-project, and $5 Download handling described below. Alakazam subscription code exists as held product machinery, but Alakazam is not currently offered for sale or customer activation. Its checkout, billing, renewal, account-lifecycle, fulfillment, and publication capabilities remain disabled for customers.";
const NEW_OPERATOR_SCOPE =
  "This notice separates ordinary public-page handling, the Start chooser, the held Responder page, the Domains public-DNS preflight, and the free device-local Abracadabra guest preview from the signed-in account, retained editor project, $5 Download, $200 Website assessment, and accepted Custom-build handling described below. Alakazam, Care plans, customer-domain purchase, Site Sourcery-managed publication, and Responder service remain held and unavailable; their code or planning material does not authorize customer activation or provider effects.";
const OLD_BILLING_SUMMARY =
  "A signed-in project can use a one-time $5 Download checkout. Alakazam subscription billing remains held.";
const NEW_BILLING_SUMMARY =
  "Signed-in customers can use Stripe Checkout for the $5 Download, an accepted $200 Website assessment, and accepted Custom invoices. Subscription and held-product billing remains unavailable.";
const OLD_BILLING_BODY =
  "A completed one-time $5 payment activates Download for that retained editor project. Later accepted versions and repeat downloads from the same project do not require another Site Sourcery purchase while the project, accepted file, and Download entitlement remain active and available. A refund, dispute, reversal, deletion, or other lawful entitlement change can suspend or end Download. A different editor project has its own Download purchase. Refund availability is governed by the purchase terms and applicable law, not by this privacy notice. Alakazam subscription checkout, billing, renewal, upgrade, downgrade, cancellation, fulfillment, publication, and account-lifecycle handling remain held and are not active under this notice.";
const NEW_BILLING_BODY =
  "A completed one-time $5 payment activates Download for that retained editor project. Later accepted versions and repeat downloads from the same project do not require another Site Sourcery purchase while the project, accepted file, and Download entitlement remain active and available. A refund, dispute, reversal, deletion, or other lawful entitlement change can suspend or end Download. A different editor project has its own Download purchase. The Website assessment and Custom paths record payment only after the accepted invoice purpose, amount, tax, Checkout, PaymentIntent, Charge, customer, and provider state are read back and verified. Refund availability and professional-service consequences are governed by the accepted terms, project agreement, and applicable law, not by this privacy notice. Alakazam, Care, domain-purchase, publication, and Responder checkout or billing remain held.";
const OLD_NETWORK_BODY =
  "Site Sourcery uses service providers for website and network delivery, account and database operation, backups, transactional email, payment checkout and verification, file delivery, public DNS lookup, and direct email. Depending on the feature used, those providers can receive account or contact details, project or transaction identifiers, payment evidence, message content, requested domain names, IP address, request path, user-agent or similar device data, request status, security events, and timestamps needed for their assigned role. The Domains section identifies Cloudflare; checkout identifies Stripe; transactional account email uses the configured email provider; and direct email to sitesourcery@proton.me uses Proton Mail. Provider terms, contracts, privacy notices, and configured retention and security controls also apply.";
const NEW_NETWORK_BODY =
  "Site Sourcery’s configured hosting, PostgreSQL database, backup, and file-delivery services process the account, project, assessment, Custom-work, evidence, transaction, access-reference, request, security, and timestamp records needed to run and protect the authenticated service. Stripe receives checkout contact and address fields, the service or project purpose, amount, currency, automatic-tax inputs and results, and Site Sourcery reference metadata, and returns customer, Checkout, PaymentIntent, Charge, tax, payment, refund, dispute, and event evidence. Resend processes the destination address, account or recovery message content, delivery identifiers and state, and related technical records for transactional account email; Site Sourcery requires Resend open and click tracking to remain disabled. Direct email to sitesourcery@proton.me is processed by Proton Mail. The Domains action sends only the cleaned .com, .net, and .org candidates plus ordinary network data to Cloudflare’s public DNS resolver as described below. A provider receives only the categories needed for the feature used, subject to its terms, contract, privacy notice, and configured retention and security controls.";
const OLD_PRIVACY_FINAL_SUMMARY =
  "This notice covers the public site, guest preview, account, and Download. Free guest work stays in the current tab. A signed-in customer can retain an editor project and its $5 Download. Alakazam subscriptions remain held.";
const NEW_PRIVACY_FINAL_SUMMARY =
  "This notice covers the public site, guest preview, account, saved project, $5 Download, $200 Website assessment, and accepted Custom build. Alakazam, Care, domain purchase, publication, and Responder remain held.";
const CUSTOM_PRIVACY_SECTION = `
      <h2 id="professional-services">Website assessment and Custom-service records</h2>
      <p class="legal-topic-summary" data-legal-summary="professional-services">An authenticated assessment or Custom path retains the inquiry, accepted scope, payment evidence, work record, and delivery evidence needed for that service.</p>
      <details class="legal-topic" data-legal-topic="professional-services">
        <summary>Read full professional-service details</summary>
        <div class="legal-topic-body" data-legal-clause="professional-services">
      <p>An assessment request can include the organization and account, existing public website, primary goal, requested timing, representative targets or page types, customer context, request state, and related messages. Its quote, acceptance, invoice, and payment records can include immutable scope and price revisions, exclusions, delivery date, disclosure and request digests, acceptance facts, tax and total, Stripe identifiers and readback evidence, receipt state, and timestamps.</p>
      <p>Assessment work can include the public URLs and page types reviewed, desktop and phone viewport facts, screenshots of the customer’s public site, private evidence payloads, findings, severity and practical-importance classifications, recommendations, review and delivery digests, report state, and the resulting one-use $200 Custom credit with its same-organization, same-project, eligible-build, 90-day, reservation, application, release, or reversal facts. Customer reports expose only account-authorized projections; private evidence remains in the owner work boundary.</p>
      <p>An accepted Custom path can include the selected Card-through-Scale offer, customer and project, written scope and exclusions, responsibilities, dependencies, access requirements and credential-free access references, provider-cost treatment, quote revisions, acceptance, installments, invoices, Stripe evidence, assessment-credit application, job state, progress and customer-visible updates, customer requests, change orders, completion checks and desktop or phone evidence, final-payment or zero-balance clearance, handoff documents and digests, ownership boundary, and the handoff-derived 30-day workmanship period. The browser does not set authoritative money, tax, settlement, completion, handoff, or ownership facts.</p>
      <p>Site Sourcery uses these records to review the requested site, prepare and administer the accepted scope, verify payment, document decisions and changes, deliver the report or agreed work, provide customer and owner readback, resolve disputes, protect the service, and meet accounting or legal obligations. Transaction, acceptance, security, and delivery evidence may remain while reasonably needed for those purposes. No fixed universal deletion date is promised. A privacy request is reviewed against active work, customer access, tax and accounting duties, payment disputes, fraud and security needs, and legal holds; records are not silently reclassified as deleted while those duties still require them.</p>
        </div>
      </details>`;

export function reconcilePrivacyV3ForGoLive(source) {
  let next = replaceExactlyOnce(source, OLD_OPERATOR_SCOPE, NEW_OPERATOR_SCOPE, "privacy scope");
  next = replaceExactlyOnce(next, OLD_BILLING_SUMMARY, NEW_BILLING_SUMMARY, "billing summary");
  next = replaceExactlyOnce(next, OLD_BILLING_BODY, NEW_BILLING_BODY, "billing body");
  next = replaceExactlyOnce(next, OLD_NETWORK_BODY, NEW_NETWORK_BODY, "provider mapping");
  if (occurrences(next, OLD_PRIVACY_FINAL_SUMMARY) === 1) {
    next = next.replace(OLD_PRIVACY_FINAL_SUMMARY, NEW_PRIVACY_FINAL_SUMMARY);
  } else if (occurrences(next, OLD_PRIVACY_FINAL_SUMMARY) !== 0) {
    throw new Error("joint legal V3 privacy release summary anchor changed");
  }
  next = replaceExactlyOnce(
    next,
    '          <a href="#retention">Retention</a>',
    '          <a href="#professional-services">Assessment and Custom</a>\n          <a href="#retention">Retention</a>',
    "privacy navigation",
  );
  next = replaceExactlyOnce(
    next,
    '      <h2 id="retention">Retention and deletion</h2>',
    `${CUSTOM_PRIVACY_SECTION}\n      <h2 id="retention">Retention and deletion</h2>`,
    "professional-service insertion",
  );
  next = replaceExactlyOnce(
    next,
    "If you call or email, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
    "If you call, email, or use an authenticated assessment or Custom account path, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
    "communications scope",
  );
  return next;
}

export function renderPrivacyV3ForGoLive(source, options) {
  const plan = createPrivacyV3RenderPlan(options);
  return reconcilePrivacyV3ForGoLive(renderPrivacyV3CandidatePage(source, plan));
}

export function normalizePrivacyV3GoLiveFinal(source, plan) {
  return reconcilePrivacyV3ForGoLive(normalizePrivacyV3FinalPage(
    source
      .replace(NEW_OPERATOR_SCOPE, OLD_OPERATOR_SCOPE)
      .replace(NEW_BILLING_SUMMARY, OLD_BILLING_SUMMARY)
      .replace(NEW_BILLING_BODY, OLD_BILLING_BODY)
      .replace(NEW_NETWORK_BODY, OLD_NETWORK_BODY)
      .replace(NEW_PRIVACY_FINAL_SUMMARY, OLD_PRIVACY_FINAL_SUMMARY)
      .replace('          <a href="#professional-services">Assessment and Custom</a>\n', "")
      .replace(`${CUSTOM_PRIVACY_SECTION}\n`, "")
      .replace(
        "If you call, email, or use an authenticated assessment or Custom account path, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
        "If you call or email, Site Sourcery may retain the communication and reasonable business records needed to respond, scope work, document decisions, deliver accepted work, protect the service, and meet legal obligations.",
      ),
    plan,
  ));
}

export function renderLegalCenterV3({ root = process.cwd(), privacyPlan, termsPlan } = {}) {
  if (privacyPlan?.mode !== "final" || termsPlan?.mode !== "final") {
    throw new Error("joint legal V3 center requires final Privacy and Terms plans");
  }
  if (privacyPlan.effectiveAt !== termsPlan.effectiveAt) {
    throw new Error("joint legal V3 center requires one effective UTC time");
  }
  let source = readFileSync(path.join(root, "legal/index.html"), "utf8");
  const head = readFileSync(
    path.join(root, "scripts/hosted-truth/candidates/legal-center-v3-head.html"),
    "utf8",
  );
  const main = readFileSync(
    path.join(root, "scripts/hosted-truth/candidates/legal-center-v3-main.html"),
    "utf8",
  );
  source = truthSlot(source, "legal-center-head", head);
  source = truthSlot(source, "legal-center-main", main);
  source = replaceExactlyOnce(
    source,
    '<aside class="quote-panel" data-legal-v3-source-state="unsealed"><p class="card-kicker">Not effective — joint legal release identity pending</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>The exact Privacy V3 and Website Terms V3 versions and effective UTC time are assigned together only at publication.</p></aside>',
    `<aside class="quote-panel"><p class="card-kicker">${privacyPlan.effectiveLabel}</p><h2>Desiderata Labs LLC · filed alternate name SITESOURCERY</h2><p>Current documents: ${privacyPlan.version} and ${termsPlan.version}. Both use the same effective UTC time, ${privacyPlan.effectiveAt}.</p></aside>`,
    "legal center release identity",
  );
  source = replaceExactlyOnce(
    source,
    "© 2026 Desiderata Labs LLC · DBA Site Sourcery",
    "© 2026 Desiderata Labs LLC · filed alternate name SITESOURCERY",
    "legal center operator footer",
  );
  if (
    source.includes("sitesourcery:truth-slot:")
    || source.includes("data-legal-v3-source-state")
    || source.includes("joint legal release identity pending")
    || !source.includes(privacyPlan.version)
    || !source.includes(termsPlan.version)
  ) {
    throw new Error("joint legal V3 center retained unsealed or incomplete truth");
  }
  return source;
}
