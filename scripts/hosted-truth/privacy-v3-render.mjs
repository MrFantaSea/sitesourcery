import {
  assertLegalArtifactRelativePath,
  assertPrivacyV3Unsealed,
  HOSTED_PRIVACY_V3_CANDIDATE,
} from "./legal-artifacts.mjs";

export const PRIVACY_V3_REVIEW_VERSION =
  "SS-HOSTED-PRIVACY-CLAUSE-LAYOUT-REVIEW-DRAFT-V3";
export const PRIVACY_V3_REVIEW_EFFECTIVE_LABEL =
  "Not effective — clause and layout review only";
export const PRIVACY_V3_CONTENT_TEMPLATE_VERSION =
  "SS-HOSTED-PRIVACY-CONTENT-TEMPLATE-V3";
export const PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN =
  "__SITESOURCERY_PRIVACY_V3_VERSION__";
export const PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN =
  "__SITESOURCERY_PRIVACY_V3_EFFECTIVE_LABEL__";
export const PRIVACY_V3_OWNER_APPROVAL =
  "owner-approved-exact-privacy-v3-release-values";
export const PRIVACY_V3_AUTHORITY_SCHEMA =
  "sitesourcery.project-legal-authority/v3";
export const PRIVACY_V3_ACCEPTANCE_STATEMENT =
  "accepted_exact_project_terms_and_acknowledged_privacy";

const FINAL_VERSION =
  /^SS-HOSTED-PRIVACY-(\d{4}-\d{2}-\d{2})-V3$/u;
const BODY_TAG = '<body class="vnext-page legal-page privacy-page">';
const SOURCE_META_LINE = `  ${HOSTED_PRIVACY_V3_CANDIDATE.sourceStateMeta}`;
const SOURCE_ASIDE = [
  '<aside class="quote-panel" data-privacy-v3-source-state="unsealed">',
  '<p class="card-kicker">Draft for review</p>',
  "<h2>New privacy notice</h2>",
  "<p>This draft is not effective or published yet. It must receive a version and effective date before release.</p>",
  "</aside>",
].join("");
const FINAL_SUMMARY =
  "This notice covers the public site, free guest preview, accounts, the $20 Download, domains, Care, and The Responder. It explains what Site Sourcery handles, why it is needed, and the choices available to customers.";
const REQUIRED_SUBSTANTIVE_COPY = Object.freeze([
  "Pressing Make my preview does not by itself include those business facts in a Site Sourcery project API request.",
  "Choosing to retain it as an editor project requires the signed-in account path and accepted project documents.",
  "Download does not put the file online or include hosting.",
  "When you press the Domains page’s check button, the browser cleans the typed candidate and sends its .com, .net, and .org names in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at cloudflare-dns.com.",
  "Cloudflare processes the query and connection data under its",
  "Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API.",
]);
const MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function exactCanonicalUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function effectiveLabel(date) {
  const [year, rawMonth, rawDay] = date.split("-");
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (!MONTHS[month - 1] || day < 1 || day > 31) {
    throw new Error("privacy V3 version contains an invalid calendar date");
  }
  const canonical = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(canonical.valueOf())
    || canonical.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("privacy V3 version contains an invalid calendar date");
  }
  return `Effective ${MONTHS[month - 1]} ${day}, ${year}`;
}

export function createPrivacyV3RenderPlan(options = {}) {
  assertPrivacyV3Unsealed();
  if (options?.mode === "review") {
    if (
      Object.keys(options).some((key) => key !== "mode")
    ) {
      throw new Error("privacy V3 review render accepts no release constants");
    }
    return Object.freeze({
      mode: "review",
      state: "unsealed",
      sealable: false,
      version: null,
      effectiveAt: null,
      effectiveLabel: PRIVACY_V3_REVIEW_EFFECTIVE_LABEL,
      displayVersion: PRIVACY_V3_REVIEW_VERSION,
      versionedFile:
        `legal/privacy/versions/${PRIVACY_V3_REVIEW_VERSION}/index.html`,
    });
  }
  if (options?.mode === "content-template") {
    if (
      Object.keys(options).some((key) => key !== "mode")
    ) {
      throw new Error("privacy V3 content-template render accepts no release constants");
    }
    return Object.freeze({
      mode: "content-template",
      state: "content-template-unreleased",
      sealable: false,
      deployable: false,
      version: null,
      effectiveAt: null,
      effectiveLabel: PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN,
      displayVersion: PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN,
      versionedFile:
        `legal/privacy/versions/${PRIVACY_V3_CONTENT_TEMPLATE_VERSION}/index.html`,
    });
  }
  if (options?.mode !== "final") {
    throw new Error("privacy V3 render mode must be review, content-template, or final");
  }
  const match = String(options.version ?? "").match(FINAL_VERSION);
  if (
    options.ownerApproval !== PRIVACY_V3_OWNER_APPROVAL
    || !match
    || !exactCanonicalUtc(options.effectiveAt)
    || options.effectiveAt.slice(0, 10) !== match[1]
    || JSON.stringify(Object.keys(options).sort()) !==
      JSON.stringify(["effectiveAt", "mode", "ownerApproval", "version"])
  ) {
    throw new Error(
      "privacy V3 finalization requires owner-approved exact matching version and canonical UTC values",
    );
  }
  const versionedFile = `legal/privacy/versions/${options.version}/index.html`;
  assertLegalArtifactRelativePath(versionedFile);
  return Object.freeze({
    mode: "final",
    state: "owner-approved-finalization",
    sealable: true,
    version: options.version,
    effectiveAt: options.effectiveAt,
    effectiveLabel: effectiveLabel(match[1]),
    displayVersion: options.version,
    versionedFile,
  });
}

function assertCandidatePage(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("privacy V3 candidate page must be non-empty UTF-8 text");
  }
  for (const anchor of [SOURCE_META_LINE, BODY_TAG, SOURCE_ASIDE]) {
    if (occurrences(source, anchor) !== 1) {
      throw new Error("privacy V3 candidate page no longer has exact render anchors");
    }
  }
  for (const phrase of REQUIRED_SUBSTANTIVE_COPY) {
    if (!source.includes(phrase)) {
      throw new Error(`privacy V3 candidate is missing approved copy: ${phrase}`);
    }
  }
  if (
    source.includes("sitesourcery:truth-slot:")
    || source.includes("SS-HOSTED-PRIVACY-2026-07-30-V2")
    || /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u.test(source)
  ) {
    throw new Error("privacy V3 candidate page contains mixed or prematurely sealed truth");
  }
}

export function renderPrivacyV3CandidatePage(source, plan) {
  assertCandidatePage(source);
  let rendered = source;
  if (plan?.mode === "review") {
    const reviewAside = [
      '<aside class="quote-panel" data-privacy-v3-review-state="unsealed">',
      `<p class="card-kicker">${PRIVACY_V3_REVIEW_EFFECTIVE_LABEL}</p>`,
      `<h2>Notice ${PRIVACY_V3_REVIEW_VERSION}</h2>`,
      "<p>This is a real hosted clause-and-layout render, but it is not a final artifact and must not be used to seal release constants. The final version date, effective UTC time, full-page digest, byte count, and authority digest remain unset.</p>",
      "</aside>",
    ].join("");
    rendered = rendered
      .replace(
        SOURCE_META_LINE,
        `${SOURCE_META_LINE}\n  <meta name="robots" content="noindex,nofollow">`,
      )
      .replace(
        BODY_TAG,
        '<body class="vnext-page legal-page privacy-page" data-privacy-v3-review-state="unsealed">',
      )
      .replace(SOURCE_ASIDE, reviewAside);
  } else if (
    plan?.mode === "content-template"
    || plan?.mode === "final"
  ) {
    const finalAside = [
      '<aside class="quote-panel">',
      `<p class="card-kicker">${plan.effectiveLabel}</p>`,
      `<h2>Notice ${plan.displayVersion}</h2>`,
      `<p>${FINAL_SUMMARY}</p>`,
      "</aside>",
    ].join("");
    rendered = rendered
      .replace(`${SOURCE_META_LINE}\n`, "")
      .replace(SOURCE_ASIDE, finalAside);
  } else {
    throw new Error("privacy V3 render plan is invalid");
  }
  assertRenderedPrivacyV3Page(rendered, plan);
  return rendered;
}

export function assertRenderedPrivacyV3Page(source, plan) {
  for (const phrase of REQUIRED_SUBSTANTIVE_COPY) {
    if (!source.includes(phrase)) {
      throw new Error(`rendered privacy V3 is missing approved copy: ${phrase}`);
    }
  }
  if (
    source.includes("sitesourcery:truth-slot:")
    || source.includes("Privacy V3 clause-review source")
    || source.includes("Not effective — release identity pending")
    || source.includes("Draft for review")
    || source.includes("This draft is not effective or published yet.")
    || source.includes(HOSTED_PRIVACY_V3_CANDIDATE.sourceStateAttribute)
  ) {
    throw new Error("rendered privacy V3 retains source-only truth");
  }
  if (plan.mode === "review") {
    if (
      !source.includes(PRIVACY_V3_REVIEW_EFFECTIVE_LABEL)
      || !source.includes(PRIVACY_V3_REVIEW_VERSION)
      || !source.includes('<meta name="robots" content="noindex,nofollow">')
      || occurrences(source, 'data-privacy-v3-review-state="unsealed"') !== 2
      || /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u.test(source)
    ) {
      throw new Error("privacy V3 review render is not visibly and technically unsealed");
    }
  } else if (plan.mode === "content-template") {
    if (
      occurrences(source, PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN) !== 1
      || occurrences(
        source,
        PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN,
      ) !== 1
      || source.includes(PRIVACY_V3_REVIEW_VERSION)
      || source.includes("noindex,nofollow")
      || source.includes("data-privacy-v3-review-state")
      || /SS-HOSTED-PRIVACY-\d{4}-\d{2}-\d{2}-V3/u.test(source)
    ) {
      throw new Error("privacy V3 content template contains release or review identity");
    }
  } else if (
    plan.mode !== "final"
    || occurrences(source, plan.version) !== 1
    || occurrences(source, plan.effectiveLabel) !== 1
    || source.includes(PRIVACY_V3_REVIEW_VERSION)
    || source.includes(PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN)
    || source.includes(PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN)
    || source.includes("noindex,nofollow")
    || source.includes("data-privacy-v3-review-state")
  ) {
    throw new Error("privacy V3 final render does not match its exact release plan");
  }
  return true;
}

export function normalizePrivacyV3FinalPage(source, plan) {
  if (plan?.mode !== "final") {
    throw new Error("privacy V3 normalization requires an exact final render plan");
  }
  assertRenderedPrivacyV3Page(source, plan);
  const normalized = source
    .replace(
      plan.effectiveLabel,
      PRIVACY_V3_CONTENT_TEMPLATE_EFFECTIVE_LABEL_TOKEN,
    )
    .replace(plan.version, PRIVACY_V3_CONTENT_TEMPLATE_VERSION_TOKEN);
  assertRenderedPrivacyV3Page(
    normalized,
    createPrivacyV3RenderPlan({ mode: "content-template" }),
  );
  return normalized;
}
