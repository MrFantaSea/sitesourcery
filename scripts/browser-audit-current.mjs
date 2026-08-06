#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildHostedArtifact } from "./build-hosted.mjs";
import { getBrowserSafeAlakazamCatalog } from
  "../server/commerce-v2/alakazam.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT_ROOT = path.join(ROOT, "_hosted");
const EXPECTED_BROWSER =
  "Google Chrome for Testing 149.0.7827.55";
const BROWSER_CANDIDATES = Object.freeze([
  process.env.SITESOURCERY_CHROMIUM,
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell",
].filter(Boolean));
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: "phone-320", width: 320, height: 720, mobile: true }),
  Object.freeze({ label: "phone-390", width: 390, height: 844, mobile: true }),
  Object.freeze({ label: "desktop", width: 1440, height: 1000, mobile: false }),
]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
});
const PAID_FIXTURE_COOKIE = "ss_browser_audit_paid";
const PAID_CUSTOMER_ID = "10000000-0000-4000-8000-000000000001";
const PAID_ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const PAID_PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const PAID_QUOTE_ID = "40000000-0000-4000-8000-000000000001";
const PAID_INVOICE_ID = "50000000-0000-4000-8000-000000000001";
const PAID_JOB_ID = "60000000-0000-4000-8000-000000000001";
const PAID_CREDIT_ID = "70000000-0000-4000-8000-000000000001";
const PAID_REQUEST_ID = "90000000-0000-4000-8000-000000000001";
const PAID_CHANGE_ORDER_ID = "91000000-0000-4000-8000-000000000001";
const PAID_DESKTOP_EVIDENCE_ID = "92000000-0000-4000-8000-000000000001";
const PAID_PHONE_EVIDENCE_ID = "92000000-0000-4000-8000-000000000002";
const PAID_COMPLETION_ID = "93000000-0000-4000-8000-000000000001";
const PAID_OPERATOR_ID = "94000000-0000-4000-8000-000000000001";
const PAID_QUOTE_DIGEST = "a".repeat(64);
const PAID_DISCLOSURE_DIGEST = "b".repeat(64);
const PAID_INVOICE_DIGEST = "c".repeat(64);
const PAID_ACCEPTED_AT = "2026-08-06T15:00:00.000Z";
const PAID_CREDIT_CUTOFF = "2026-11-04T15:00:00.000Z";
const PAID_CHANGE_QUOTE_DIGEST = "d".repeat(64);
const PAID_CHANGE_DISCLOSURE_DIGEST = "e".repeat(64);
const PAID_DESKTOP_EVIDENCE_BYTES = await readFile(
  path.join(ROOT, "assets/work-demo-bright-spark.png"),
);
const PAID_PHONE_EVIDENCE_BYTES = await sharp(
  await readFile(path.join(ROOT, "assets/work-demo-bright-spark-720.webp")),
)
  .resize(390, 844, { fit: "cover", position: "centre" })
  .webp({ quality: 86 })
  .toBuffer();
const PAID_DESKTOP_EVIDENCE_DIGEST = createHash("sha256")
  .update(PAID_DESKTOP_EVIDENCE_BYTES)
  .digest("hex");
const PAID_PHONE_EVIDENCE_DIGEST = createHash("sha256")
  .update(PAID_PHONE_EVIDENCE_BYTES)
  .digest("hex");

function paidProject() {
  return {
    id: PAID_PROJECT_ID,
    projectId: PAID_PROJECT_ID,
    organizationId: PAID_ORGANIZATION_ID,
    name: "Avery Studio website",
    revision: 1,
    updatedAt: "2026-08-06T15:05:00.000Z",
    versions: [],
    visibility: "private",
  };
}

function paidJob() {
  return {
    jobId: PAID_JOB_ID,
    state: "open",
    openedAt: "2026-08-06T15:05:00.000Z",
    tierId: "site",
    scopeStatement:
      "Build the approved four-page Custom website from the accepted exact scope.",
    footprint: {
      craftedPages: 4,
      sections: 16,
      uniqueLayouts: 4,
      contentWords: 1800,
      suppliedMedia: 12,
    },
    targetCompletionDate: "2026-09-15",
    firstPayment: {
      grossMinor: 60000,
      creditMinor: 20000,
      paidSubtotalMinor: 40000,
      currency: "USD",
    },
    finalHandoff: {
      amountMinor: 60000,
      currency: "USD",
      state: "unpaid",
    },
  };
}

function paidCustomBuildQuote() {
  const contractId = "SS-CUSTOM-SERVICES-2026-08-05.1";
  const contractDigest =
    "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";
  const legalDocumentId = "00000000-0000-4000-8000-000000000342";
  return {
    schema: "sitesourcery.custom-services-custom-build-quote/v1",
    state: "accepted",
    projectId: PAID_PROJECT_ID,
    customerId: PAID_CUSTOMER_ID,
    credit: {
      creditId: PAID_CREDIT_ID,
      amountMinor: 20000,
      currency: "USD",
      state: "settled",
      acceptanceCutoff: PAID_CREDIT_CUTOFF,
    },
    quote: {
      acceptance: {
        schema: "sitesourcery.custom-build-quote-acceptance-receipt/v1",
        acceptedAt: PAID_ACCEPTED_AT,
        acceptedQuoteDigest: PAID_QUOTE_DIGEST,
        acceptedDisclosureDigest: PAID_DISCLOSURE_DIGEST,
        commercialContractId: contractId,
        commercialContractDigest: contractDigest,
        legalDocumentId,
      },
      quoteId: PAID_QUOTE_ID,
      quoteRevision: 1,
      quoteDigest: PAID_QUOTE_DIGEST,
      disclosureDigest: PAID_DISCLOSURE_DIGEST,
      state: "accepted",
      tier: {
        id: "site",
        label: "Site",
        scaleUnits: null,
        footprint: paidJob().footprint,
      },
      scopeStatement: paidJob().scopeStatement,
      terms: {
        schema: "sitesourcery.custom-build-quote-terms/v1",
        commercialContractId: contractId,
        commercialContractDigest: contractDigest,
        legalDocumentId,
        rules: [
          "This quote covers only the scope and footprint shown here. Added or changed work requires a separate written change order.",
          "The assessment credit is non-cash, same-project, one-use value applied only to this Custom base build's first required installment.",
          "The remaining first installment is due before build work begins; the final installment is due before final launch or handoff.",
          "Tax and any separately stated third-party provider charges are not included in the base price and are shown before payment.",
          "Build work does not begin until the required first payment is verified.",
          "The 30-day workmanship correction covers reproducible defects in the accepted deliverables, not new content, features, changed decisions, third-party changes, or ongoing management.",
        ],
      },
      pricing: {
        serviceAmountMinor: 120000,
        creditAmountMinor: 20000,
        customerAmountMinor: 100000,
        currency: "USD",
        taxState: "calculation_required",
        paymentSchedule: "half_before_work_half_before_handoff",
        startValueMinor: 60000,
        startCreditMinor: 20000,
        startDueMinor: 40000,
        finalDueMinor: 60000,
        installments: [
          {
            number: 1,
            kind: "start",
            grossValueMinor: 60000,
            creditAmountMinor: 20000,
            amountDueMinor: 40000,
            dueTrigger: "before_work",
          },
          {
            number: 2,
            kind: "final",
            grossValueMinor: 60000,
            creditAmountMinor: 0,
            amountDueMinor: 60000,
            dueTrigger: "before_handoff",
          },
        ],
      },
      workmanshipCorrectionDays: 30,
      targetCompletionDate: "2026-09-15",
      issuedAt: "2026-08-05T15:00:00.000Z",
      expiresAt: "2026-08-19T15:00:00.000Z",
      creditAcceptanceCutoff: PAID_CREDIT_CUTOFF,
    },
  };
}

function paidCustomBuildInvoice() {
  return {
    schema: "sitesourcery.custom-build-start-invoice/v1",
    state: "paid",
    invoice: {
      invoiceId: PAID_INVOICE_ID,
      invoiceNumber: "SSCB-50000000000040008000000000000001",
      invoiceDigest: PAID_INVOICE_DIGEST,
      quoteId: PAID_QUOTE_ID,
      tierId: "site",
      acceptedQuoteDigest: PAID_QUOTE_DIGEST,
      acceptedDisclosureDigest: PAID_DISCLOSURE_DIGEST,
      issuedAt: PAID_ACCEPTED_AT,
      paymentDeadline: "2026-08-13T15:00:00.000Z",
      lines: [
        {
          lineNumber: 1,
          componentKey: "custom_build_start",
          displayName: "Site first installment",
          amountMinor: 60000,
          currency: "USD",
        },
        {
          lineNumber: 2,
          componentKey: "assessment_build_credit",
          displayName: "Website assessment build credit",
          amountMinor: -20000,
          currency: "USD",
        },
      ],
      subtotal: { amountMinor: 40000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout",
      },
      credit: { amountMinor: 20000, state: "settled" },
      finalHandoff: { amountMinor: 60000, state: "due_before_handoff" },
      payment: {
        chargeOccurred: true,
        checkoutUrl: null,
        checkoutExpiresAt: null,
      },
    },
    action: { available: false, reason: "paid" },
    job: paidJob(),
  };
}

function ownerPaidCustomBuildJobs() {
  return {
    schema: "sitesourcery.custom-services-owner-custom-build-jobs/v1",
    hasMore: false,
    nextCursor: null,
    jobs: [{
      organizationId: PAID_ORGANIZATION_ID,
      organizationName: "Avery Studio",
      projectId: PAID_PROJECT_ID,
      projectName: "Avery Studio website",
      caseId: "80000000-0000-4000-8000-000000000001",
      customer: {
        customerId: PAID_CUSTOMER_ID,
        name: "Avery Morgan",
        email: "avery@example.test",
      },
      job: paidJob(),
    }],
  };
}

function paidCustomBuildProgress() {
  return {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "active",
    jobId: PAID_JOB_ID,
    targetCompletionDate: "2026-09-15",
    targetDateUnderReview: false,
    status: {
      kind: "action_needed",
      label: "Action needed from you",
    },
    progress: {
      revision: 2,
      stage: "building",
      stageLabel: "Building",
      summary:
        "The approved structure is ready and the content pass is underway.",
      nextStep: "Complete the supplied page content.",
      updatedAt: "2026-08-06T15:00:00.000Z",
      milestones: [
        { key: "structure", label: "Plan and structure", state: "done" },
        { key: "content", label: "Pages and content", state: "in_progress" },
        {
          key: "responsive",
          label: "Phone and accessibility",
          state: "pending",
        },
        { key: "quality", label: "Final checks", state: "pending" },
      ],
    },
    activeRequest: {
      requestId: PAID_REQUEST_ID,
      revision: 1,
      kind: "customer_decision",
      title: "Choose the approved contact wording",
      message:
        "Please choose which approved contact wording should appear on the site.",
      safeInstructions:
        "Reply with the wording choice and any customer-safe context.",
      targetDateImpact: "none",
      responseRequired: true,
      state: "open",
      response: null,
      access: null,
      createdAt: "2026-08-06T15:05:00.000Z",
      updatedAt: "2026-08-06T15:05:00.000Z",
    },
  };
}

function paidChangeOrder(state = "issued", owner = false) {
  const value = {
    changeOrderId: PAID_CHANGE_ORDER_ID,
    changeNumber: 1,
    state,
    addedScope:
      "Add the approved events page and matching navigation link.",
    pricing: {
      unitCount: 2,
      unitAmountMinor: 12500,
      subtotalMinor: 25000,
      currency: "USD",
      taxState: "automatic_tax_pending",
      paymentRequirement: "due_before_changed_work",
    },
    targetCompletionDate: "2026-09-22",
    quoteDigest: PAID_CHANGE_QUOTE_DIGEST,
    disclosureDigest: PAID_CHANGE_DISCLOSURE_DIGEST,
    issuedAt: "2026-08-06T16:00:00.000Z",
    expiresAt: "2026-08-13T16:00:00.000Z",
    expiredAt: null,
    acceptedAt: state === "effective"
      ? "2026-08-07T16:00:00.000Z"
      : null,
    declinedAt: null,
    void: null,
  };
  if (owner) value.createdByOperatorUserId = PAID_OPERATOR_ID;
  return value;
}

function paidCompletionEvidence(id, viewport, owner = false) {
  const desktop = viewport === "desktop";
  const bytes = desktop
    ? PAID_DESKTOP_EVIDENCE_BYTES
    : PAID_PHONE_EVIDENCE_BYTES;
  const value = {
    evidenceId: id,
    viewport,
    accessibleDescription:
      `${viewport} proof of the completed approved homepage and contact action.`,
    mediaType: desktop ? "image/png" : "image/webp",
    byteCount: bytes.byteLength,
    contentDigest: desktop
      ? PAID_DESKTOP_EVIDENCE_DIGEST
      : PAID_PHONE_EVIDENCE_DIGEST,
    imageWidth: desktop ? 1440 : 390,
    imageHeight: desktop ? 1000 : 844,
    capturedAt: "2026-08-08T15:00:00.000Z",
  };
  if (owner) {
    value.progressRevision = 3;
    value.effectiveScopeDigest = "3".repeat(64);
    value.createdByOperatorUserId = PAID_OPERATOR_ID;
  }
  return value;
}

function paidChangeCompletion(mode, owner = false) {
  const completionMode = mode === "completion";
  const evidence = [
    paidCompletionEvidence(
      PAID_DESKTOP_EVIDENCE_ID,
      "desktop",
      owner,
    ),
    paidCompletionEvidence(
      PAID_PHONE_EVIDENCE_ID,
      "phone",
      owner,
    ),
  ];
  const completion = completionMode ? {
    state: "ready_for_final_payment",
    customerSummary:
      "The approved scope is complete and every documented customer-visible check passed.",
    checks: {
      scope: true,
      desktop: true,
      phone: true,
      links: true,
      contactActions: true,
      accessibilityBasics: true,
    },
    preparedAt: "2026-08-08T16:00:00.000Z",
    ...(owner ? {
      completionId: PAID_COMPLETION_ID,
      progressRevision: 3,
      evidenceIds: [
        PAID_DESKTOP_EVIDENCE_ID,
        PAID_PHONE_EVIDENCE_ID,
      ],
      baseScopeDigest: "2".repeat(64),
      effectiveChangeOrderDigests: [PAID_CHANGE_QUOTE_DIGEST],
      effectiveScopeDigest: "3".repeat(64),
      packageDigest: "4".repeat(64),
      createdByOperatorUserId: PAID_OPERATOR_ID,
    } : { evidence }),
  } : null;
  const changeOrders = completionMode
    ? [paidChangeOrder("effective", owner)]
    : [paidChangeOrder("issued", owner)];
  if (!owner) {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state: completionMode
        ? "ready_for_final_payment"
        : "change_order_review",
      changeOrders: completionMode
        ? { active: null, history: changeOrders }
        : { active: changeOrders[0], history: [] },
      completion,
    };
  }
  return {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state: completionMode
      ? "ready_for_final_payment"
      : "change_order_review",
    job: {
      jobId: PAID_JOB_ID,
      organizationId: PAID_ORGANIZATION_ID,
      projectId: PAID_PROJECT_ID,
      caseId: "80000000-0000-4000-8000-000000000001",
      customerId: PAID_CUSTOMER_ID,
      state: "open",
      targetCompletionDate: "2026-09-15",
      finalDueMinor: 60000,
      currency: "USD",
      openedAt: "2026-08-06T15:05:00.000Z",
    },
    proofBinding: {
      progressRevision: 3,
      effectiveScopeDigest: "3".repeat(64),
    },
    changeOrders,
    evidence: completionMode ? evidence : [],
    completion,
  };
}

function availableAlakazamAccount() {
  return {
    schema: "sitesourcery.alakazam-account/v2",
    projectId: PAID_PROJECT_ID,
    state: "available",
    catalog: getBrowserSafeAlakazamCatalog(),
    downloadCredit: {
      available: true,
      amountMinor: 500,
      currency: "USD",
    },
    subscription: null,
    pendingChange: null,
    nextRenewal: null,
    site: {
      acceptedVersionId: null,
      addressLabel: null,
      hostname: null,
      look: null,
      setupDigest: null,
      state: "setup_required",
      updatedAt: null,
      url: null,
    },
    receipts: [],
    actions: {
      configureSite: true,
      start: false,
      changeTier: false,
      manageBilling: false,
      cancel: false,
      reason: "site_setup_required",
    },
  };
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function browserPath() {
  const failures = [];
  for (const candidate of BROWSER_CANDIDATES) {
    try {
      await access(candidate);
      const result = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const observed = String(result.stdout ?? "").trim();
      if (result.status === 0 && observed === EXPECTED_BROWSER) {
        return candidate;
      }
      failures.push(`${candidate}: ${observed || "no version"}`);
    } catch {
      failures.push(`${candidate}: unavailable`);
    }
  }
  throw new Error(
    `No exact reviewed browser was found. Expected ${EXPECTED_BROWSER}. `
      + failures.join("; "),
  );
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function json(response, status, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": "current-browser-audit",
  });
  response.end(bytes);
}

function privateEvidence(response, evidenceId) {
  const desktop = evidenceId === PAID_DESKTOP_EVIDENCE_ID;
  const bytes = desktop
    ? PAID_DESKTOP_EVIDENCE_BYTES
    : PAID_PHONE_EVIDENCE_BYTES;
  const digest = desktop
    ? PAID_DESKTOP_EVIDENCE_DIGEST
    : PAID_PHONE_EVIDENCE_DIGEST;
  response.writeHead(200, {
    "Cache-Control": "private, no-store",
    "Content-Length": bytes.byteLength,
    "Content-Type": desktop ? "image/png" : "image/webp",
    Digest: `sha-256=${Buffer.from(digest, "hex").toString("base64")}`,
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": "current-browser-audit",
  });
  response.end(bytes);
}

function safeArtifactPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.endsWith("/")
    ? `${decoded.replace(/^\/+/, "")}index.html`
    : decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const normalized = path.posix.normalize(relative);
  if (
    normalized !== relative
    || normalized === ".."
    || normalized.startsWith("../")
  ) return null;
  const resolved = path.resolve(ARTIFACT_ROOT, normalized);
  const rootPrefix = `${path.resolve(ARTIFACT_ROOT)}${path.sep}`;
  return resolved.startsWith(rootPrefix) ? resolved : null;
}

async function startServer() {
  const apiRequests = [];
  const missingFiles = [];
  let paidJobReads = 0;
  let customerChangeCompletionReads = 0;
  let ownerChangeCompletionReads = 0;
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/")) {
      const paidCookie = String(request.headers.cookie || "")
        .split(";")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${PAID_FIXTURE_COOKIE}=`));
      const paidMode = paidCookie
        ? decodeURIComponent(paidCookie.split("=", 2)[1] || "")
        : "";
      const paidFixture = ["issued", "completion"].includes(paidMode);
      apiRequests.push({
        method: request.method || "GET",
        pathname: url.pathname,
        paidFixture,
        paidMode,
      });
      if (request.method === "GET" && url.pathname === "/api/v1/me") {
        json(response, 200, paidFixture ? {
          user: {
            id: PAID_CUSTOMER_ID,
            name: "Avery Morgan",
            email: "avery@example.test",
          },
          csrfToken: "browser-audit-paid-csrf-token-0001",
        } : { user: null });
        return;
      }
      if (
        request.method === "GET"
        && url.pathname === "/api/v1/capabilities"
      ) {
        json(response, 200, {
          accountRegistration: false,
          accountRecoveryEmail: false,
          downloadQuote: false,
          downloadPayment: false,
          domainPurchase: false,
          publishing: false,
        });
        return;
      }
      if (paidFixture && request.method === "GET") {
        if (url.pathname === "/api/v1/organizations") {
          json(response, 200, {
            organizations: [{
              id: PAID_ORGANIZATION_ID,
              name: "Avery Studio",
            }],
          });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/organizations/${PAID_ORGANIZATION_ID}/projects`
        ) {
          json(response, 200, { projects: [paidProject()] });
          return;
        }
        if (url.pathname === `/api/v1/projects/${PAID_PROJECT_ID}`) {
          json(response, 200, { project: paidProject() });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/assessment-request`
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-assessment-request/v1",
            state: "not_started",
            actions: {},
          });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/assessment-quote`
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-assessment-quote/v1",
            state: "not_available",
            quote: null,
            actions: {
              acceptQuote: {
                available: false,
                reason: "quote_not_available",
                message: "There is no assessment quote to accept yet.",
                acceptanceStatement: null,
              },
            },
          });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/assessment-invoice`
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-assessment-invoice/v2",
            state: "not_available",
            invoice: null,
            job: null,
            actions: {
              checkout: {
                available: false,
                reason: "accepted_quote_required",
                message: "Accept the current assessment quote before an invoice exists.",
              },
            },
          });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/assessment-report`
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-assessment-report/v1",
            state: "not_available",
            job: null,
            report: null,
            credit: null,
          });
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/alakazam`
        ) {
          json(response, 200, availableAlakazamAccount());
          return;
        }
        if (
          url.pathname ===
            "/api/v1/operator/custom-services/assessment-requests"
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-owner-assessment-queue/v1",
            requests: [],
          });
          return;
        }
        if (
          url.pathname ===
            "/api/v1/operator/custom-services/assessment-jobs"
        ) {
          json(response, 200, {
            schema: "sitesourcery.custom-services-owner-assessment-jobs/v1",
            jobs: [],
          });
          return;
        }
        if (
          url.pathname ===
            "/api/v1/operator/custom-services/custom-build-opportunities"
        ) {
          json(response, 200, {
            schema:
              "sitesourcery.custom-services-owner-custom-build-opportunities/v1",
            opportunities: [],
          });
          return;
        }
        if (
          url.pathname ===
            "/api/v1/operator/custom-services/custom-build-jobs"
        ) {
          paidJobReads += 1;
          if (paidJobReads === 1) {
            json(response, 200, ownerPaidCustomBuildJobs());
          } else {
            json(response, 200, {
              schema:
                "sitesourcery.custom-services-owner-custom-build-jobs/v1",
              hasMore: false,
              nextCursor: null,
              jobs: null,
            });
          }
          return;
        }
        if (
          url.pathname ===
            `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/progress`
        ) {
          json(response, 200, paidCustomBuildProgress());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/change-completion`
        ) {
          ownerChangeCompletionReads += 1;
          json(
            response,
            200,
            ownerChangeCompletionReads === 1
              ? paidChangeCompletion(paidMode, true)
              : {
                  ...paidChangeCompletion(paidMode, true),
                  evidence: null,
                },
          );
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-quote`
        ) {
          json(response, 200, paidCustomBuildQuote());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-invoice`
        ) {
          json(response, 200, paidCustomBuildInvoice());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-progress`
        ) {
          json(response, 200, paidCustomBuildProgress());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-completion`
        ) {
          customerChangeCompletionReads += 1;
          json(
            response,
            200,
            customerChangeCompletionReads === 1
              ? paidChangeCompletion(paidMode, false)
              : {
                  ...paidChangeCompletion(paidMode, false),
                  changeOrders: null,
                },
          );
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-completion-evidence/${PAID_DESKTOP_EVIDENCE_ID}`
          || url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-completion-evidence/${PAID_PHONE_EVIDENCE_ID}`
        ) {
          privateEvidence(
            response,
            url.pathname.endsWith(PAID_DESKTOP_EVIDENCE_ID)
              ? PAID_DESKTOP_EVIDENCE_ID
              : PAID_PHONE_EVIDENCE_ID,
          );
          return;
        }
      }
      json(response, 404, {
        error: {
          code: "NOT_FOUND",
          message: "The browser audit does not simulate this API route.",
        },
      });
      return;
    }

    const file = safeArtifactPath(url.pathname);
    if (!file) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }
    try {
      const bytes = await readFile(file);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": bytes.byteLength,
        "Content-Type":
          CONTENT_TYPES[path.extname(file).toLowerCase()]
          ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(bytes);
    } catch {
      missingFiles.push(url.pathname);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  return Object.freeze({
    apiRequests,
    missingFiles,
    origin: `http://127.0.0.1:${port}`,
    paidJobReadCount() {
      return paidJobReads;
    },
    customerChangeCompletionReadCount() {
      return customerChangeCompletionReads;
    },
    ownerChangeCompletionReadCount() {
      return ownerChangeCompletionReads;
    },
    resetPaidFixture() {
      paidJobReads = 0;
      customerChangeCompletionReads = 0;
      ownerChangeCompletionReads = 0;
    },
    close: () =>
      new Promise((resolve) => server.close(resolve)),
  });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(
            new Error(`${request.method}: ${message.error.message}`),
          );
        } else {
          request.resolve(message.result);
        }
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { method, reject, resolve });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

async function pageSocket(port, state) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (state.exited) {
      throw new Error(
        `Reviewed browser exited before CDP opened: ${state.stderr}`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/json/list`,
      );
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) =>
            target.type === "page"
            && target.webSocketDebuggerUrl,
        );
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Browser is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out opening reviewed browser: ${state.stderr}`);
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "Browser evaluation failed.",
    );
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, `Boolean(${expression})`)) return;
    } catch (error) {
      // Navigation can briefly destroy the execution context.
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${expression}`
      + (lastError ? `; last evaluation error: ${lastError.message}` : ""),
  );
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: viewport.mobile,
    maxTouchPoints: viewport.mobile ? 5 : 1,
  });
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(
    cdp,
    `document.readyState === "complete" && location.href === ${JSON.stringify(url)}`,
  );
  await evaluate(
    cdp,
    `(async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const step = Math.max(500, innerHeight - 80);
      for (let y = 0; y < height; y += step) {
        scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    })()`,
    true,
  );
}

async function openHostedAccount(cdp) {
  const hasButton = await evaluate(
    cdp,
    `Boolean(document.querySelector("[data-open-account]"))`,
  );
  if (!hasButton) return;
  await waitFor(
    cdp,
    `document.documentElement.getAttribute("data-abracadabra-control-ready") === "hosted"`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-open-account]").click()`,
  );
  await waitFor(cdp, `document.getElementById("control-room").hidden === false`);
}

async function inspect(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.hidden
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const scrollWidth = Math.max(
        document.body.scrollWidth,
        document.documentElement.scrollWidth
      );
      const overflow = [...document.body.querySelectorAll("*")]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: element.id
              ? "#" + element.id
              : element.tagName.toLowerCase() + (element.classList.length ? "." + [...element.classList].slice(0, 2).join(".") : ""),
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            text: clean(element.textContent).slice(0, 60),
          };
        })
        .filter((entry) => entry.left < -1 || entry.right > innerWidth + 1)
        .slice(0, 12);
      const accountFields = [...document.querySelectorAll(
        '#control-room input:not([type="hidden"]), #control-room button'
      )].filter(visible).map((element) => ({
        label: element.getAttribute("name") || clean(element.textContent) || element.type,
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
      return {
        path: location.pathname,
        title: document.title,
        lang: document.documentElement.lang,
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
        main: Boolean(document.querySelector("main")),
        mainTextLength: clean(document.querySelector("main")?.innerText).length,
        h1: [...document.querySelectorAll("h1")].map((node) => clean(node.textContent)),
        viewportWidth: innerWidth,
        scrollWidth,
        overflow,
        brokenImages: [...document.images]
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.getAttribute("src")),
        app: location.pathname === "/abracadabra/app/" ? {
          mode: document.querySelector('meta[name="sitesourcery-abracadabra-control-mode"]')?.content || "",
          controlReady: document.documentElement.getAttribute("data-abracadabra-control-ready"),
          controlVisible: document.getElementById("control-room")?.hidden === false,
          stages: [...document.querySelectorAll("[data-customer-stage]")].map((node) => node.getAttribute("data-customer-stage")),
          prototypeGlobal: typeof globalThis.SiteSourceryAccount !== "undefined",
          prototypeScripts: [...document.scripts]
            .map((script) => script.getAttribute("src") || "")
            .filter((src) => /abracadabra-(?:account|paid-download)\\.js$/.test(src)),
          directStripeLinks: document.querySelectorAll('a[href^="https://buy.stripe.com/"]').length,
          accountFields,
        } : null,
      };
    })()`,
  );
}

function snapshotFailures(snapshot, route, viewport) {
  const failures = [];
  const label = `${viewport.label} ${route}`;
  if (snapshot.path !== route) {
    failures.push(`${label}: landed on ${snapshot.path}`);
  }
  if (!snapshot.title) failures.push(`${label}: document title is empty`);
  if (snapshot.lang !== "en") failures.push(`${label}: html lang is not en`);
  if (!snapshot.main || snapshot.mainTextLength < 20) {
    failures.push(`${label}: main content is missing or empty`);
  }
  if (snapshot.h1.length !== 1 || !snapshot.h1[0]) {
    failures.push(`${label}: expected one nonempty h1, found ${snapshot.h1.length}`);
  }
  if (snapshot.scrollWidth !== snapshot.viewportWidth) {
    failures.push(
      `${label}: horizontal overflow ${snapshot.scrollWidth}px > ${snapshot.viewportWidth}px `
      + JSON.stringify(snapshot.overflow),
    );
  }
  if (snapshot.brokenImages.length) {
    failures.push(`${label}: broken images ${JSON.stringify(snapshot.brokenImages)}`);
  }
  if (!snapshot.canonical.startsWith("https://sitesourcery.com/")) {
    failures.push(`${label}: canonical is ${JSON.stringify(snapshot.canonical)}`);
  }
  if (snapshot.app) {
    if (snapshot.app.mode !== "hosted") {
      failures.push(`${label}: hosted control mode is ${JSON.stringify(snapshot.app.mode)}`);
    }
    if (
      snapshot.app.controlReady !== "hosted"
      || !snapshot.app.controlVisible
    ) {
      failures.push(`${label}: hosted account room did not become ready and visible`);
    }
    if (
      JSON.stringify(snapshot.app.stages)
      !== JSON.stringify(["account", "project", "quote", "download"])
    ) {
      failures.push(`${label}: customer stages are ${JSON.stringify(snapshot.app.stages)}`);
    }
    if (
      snapshot.app.prototypeGlobal
      || snapshot.app.prototypeScripts.length
      || snapshot.app.directStripeLinks
    ) {
      failures.push(`${label}: browser-only account or direct Stripe bridge leaked into hosted mode`);
    }
    const shortFields = snapshot.app.accountFields.filter(
      (field) => field.height < 44,
    );
    if (shortFields.length) {
      failures.push(`${label}: visible account controls below 44px ${JSON.stringify(shortFields)}`);
    }
  }
  return failures;
}

async function makerJourney(cdp, origin) {
  await cdp.send("Storage.clearDataForOrigin", {
    origin,
    storageTypes: "all",
  });
  await setViewport(cdp, VIEWPORTS[1]);
  await navigate(cdp, `${origin}/abracadabra/app/`);
  await waitFor(cdp, `document.getElementById("spark-maker")?.inert === false`);
  await evaluate(
    cdp,
    `(() => {
      const setValue = (name, value) => {
        const field = document.querySelector('[name="' + name + '"]');
        const prototype = field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : field instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      };
      document.querySelector('[data-next="facts"]').click();
      setValue("businessName", "Browser Audit Workshop");
      setValue("summary", "Repairs practical equipment for nearby small businesses.");
      setValue("about", "Owner-operated and available by appointment.");
      setValue("email", "owner@example.test");
      document.querySelector('[data-next="truth"]').click();
      return true;
    })()`,
  );
  await waitFor(cdp, `document.querySelector('[data-step="truth"]').hidden === false`);
  await evaluate(
    cdp,
    `(() => {
      const checkbox = document.getElementById("truth-confirmed");
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("make-preview").click();
      return true;
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector('[data-step="preview"]').hidden === false
      && document.getElementById("spark-preview").getAttribute("src")?.startsWith("blob:")`,
  );
  await evaluate(cdp, `document.querySelector("[data-save-direction]").click()`);
  await waitFor(cdp, `document.getElementById("control-room").hidden === false`);
  return evaluate(
    cdp,
    `(() => ({
      currentStep: document.getElementById("spark-maker").getAttribute("data-current-step"),
      previewSource: document.getElementById("spark-preview").getAttribute("src"),
      openEnabled: !document.getElementById("open-version").disabled,
      controlReady: document.documentElement.getAttribute("data-abracadabra-control-ready"),
      accountStageVisible: document.querySelector('[data-customer-stage="account"]').hidden === false,
      status: document.getElementById("platform-status").textContent.trim(),
    }))()`,
  );
}

async function paidCustomBuildJourney(cdp, server, viewport, mode) {
  server.resetPaidFixture();
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: mode,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) throw new Error("Paid browser fixture cookie was rejected.");
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  try {
    await waitFor(
      cdp,
      `document.querySelector("[data-owner-custom-build-work]")?.hidden === false
        && document.querySelectorAll("[data-paid-custom-build-job]").length === 1
        && document.querySelector("[data-owner-job-progress]")?.textContent
          .includes("Action needed from you")
        && document.querySelector("[data-owner-job-change-completion]")?.textContent
          .includes(${JSON.stringify(
            mode === "completion"
              ? "Completion prepared"
              : "awaiting review",
          )})`,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      cdp,
      `(() => ({
        ready: document.documentElement.getAttribute("data-abracadabra-control-ready"),
        roomHidden: document.getElementById("control-room")?.hidden,
        accountStatus: document.getElementById("platform-status")?.textContent.trim(),
        ownerHidden: document.querySelector("[data-owner-custom-build-work]")?.hidden,
        ownerStatus: document.querySelector(".customer-owner-custom-build-status")?.textContent.trim(),
        apiMethod: typeof globalThis.SiteSourceryAbracadabraAPI
          ?.createClient({ baseUrl: "/api/v1" }).listOwnerCustomBuildJobs,
        accountId: globalThis.SiteSourceryAbracadabraHostedSession
          ?.getState().account?.id,
      }))()`,
    );
    throw new Error(
      `${error.message}; DOM ${JSON.stringify(diagnostic)}; API `
        + JSON.stringify(server.apiRequests.slice(-20))
        + `; browser errors ${JSON.stringify(browserErrors.slice(-10))}`,
    );
  }
  await waitFor(
    cdp,
    `document.querySelector("[data-project-list] button")`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-project-list] button").click()`,
  );
  try {
    await waitFor(
      cdp,
      `document.querySelector("[data-custom-build-quote]")?.hidden === false
        && document.querySelector(".customer-custom-build-status")?.textContent
          .includes("Your Custom website project is open")
        && document.querySelector("[data-customer-custom-build-progress]")?.hidden === false
        && document.querySelector("[data-custom-build-active-request]")?.textContent
          .includes("Choose the approved contact wording")
        && document.querySelector("[data-customer-custom-build-change-completion]")?.textContent
          .includes(${JSON.stringify(
            mode === "completion"
              ? "Completion proof is prepared"
              : "ready for your review",
          )})`,
    );
  } catch (error) {
    const diagnostic = await evaluate(
      cdp,
      `(() => ({
        projectId: globalThis.SiteSourceryAbracadabraHostedSession
          ?.getState().project?.id,
        platformStatus: document.getElementById("platform-status")?.textContent.trim(),
        panelHidden: document.querySelector("[data-custom-build-quote]")?.hidden,
        panelText: document.querySelector("[data-custom-build-quote]")
          ?.textContent.replace(/\\s+/g, " ").trim().slice(0, 500),
      }))()`,
    );
    throw new Error(
      `${error.message}; DOM ${JSON.stringify(diagnostic)}; API `
        + JSON.stringify(server.apiRequests.slice(-24))
        + `; browser errors ${JSON.stringify(browserErrors.slice(-10))}`,
    );
  }
  await evaluate(
    cdp,
    `document.querySelector("[data-paid-custom-build-job] summary").click()`,
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-paid-custom-build-job]")?.open === true`,
  );
  const initial = await evaluate(
    cdp,
    `(() => {
      const visible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0;
      };
      const owner = document.querySelector("[data-owner-custom-build-work]");
      const customer = document.querySelector("[data-custom-build-quote]");
      const customerProgress = document.querySelector(
        "[data-customer-custom-build-progress]"
      );
      const ownerProgress = owner.querySelector("[data-owner-job-progress]");
      const customerChange = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const ownerChange = owner.querySelector(
        "[data-owner-job-change-completion]"
      );
      const summary = owner.querySelector("summary");
      const controls = [...owner.querySelectorAll("button, summary"),
        ...customer.querySelectorAll("button, summary"),
        ...customerProgress.querySelectorAll("button, summary"),
        ...customerChange.querySelectorAll("button, a, summary")]
        .filter(visible)
        .map((element) => ({
          text: element.textContent.trim().replace(/\\s+/g, " ").slice(0, 80),
          height: Math.round(element.getBoundingClientRect().height * 10) / 10,
        }));
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        ownerVisible: visible(owner),
        customerVisible: visible(customer),
        customerProgressVisible: visible(customerProgress),
        customerChangeVisible: visible(customerChange),
        ownerChangeVisible: visible(ownerChange),
        ownerText: owner.textContent.replace(/\\s+/g, " ").trim(),
        customerText: customer.textContent.replace(/\\s+/g, " ").trim(),
        ownerProgressText: ownerProgress.textContent
          .replace(/\\s+/g, " ").trim(),
        customerProgressText: customerProgress.textContent
          .replace(/\\s+/g, " ").trim(),
        customerChangeText: customerChange.textContent
          .replace(/\\s+/g, " ").trim(),
        ownerChangeText: ownerChange.textContent
          .replace(/\\s+/g, " ").trim(),
        customerProgressMilestones: [
          ...customerProgress.querySelectorAll(
            ".customer-custom-build-progress-milestone"
          )
        ].map((node) => node.textContent.replace(/\\s+/g, " ").trim()),
        credentialFields: [
          ...owner.querySelectorAll("input, textarea"),
          ...customerProgress.querySelectorAll("input, textarea"),
          ...customerChange.querySelectorAll("input, textarea")
        ].map((field) => field.name).filter((name) =>
          /password|passcode|token|api.?key|secret/iu.test(name)
        ),
        moneyOrRefundFields: [
          ...owner.querySelectorAll("input, textarea, select"),
          ...customerChange.querySelectorAll("input, textarea, select")
        ].map((field) => field.name).filter((name) =>
          /amount|price|tax|refund|credit/iu.test(name)
        ),
        customerIdentifierLeaks: [
          ${JSON.stringify(PAID_JOB_ID)},
          ${JSON.stringify(PAID_OPERATOR_ID)},
          ${JSON.stringify(PAID_COMPLETION_ID)}
        ].filter((identifier) => customerChange.textContent.includes(identifier)),
        evidenceDimensions: [...customerChange.querySelectorAll("figcaption")]
          .map((node) => node.textContent.replace(/\\s+/g, " ").trim()),
        customerLabels: [...customer.querySelectorAll("dt")]
          .map((node) => node.textContent.trim()),
        summaryHeight: Math.round(summary.getBoundingClientRect().height * 10) / 10,
        detailsOpen: summary.parentElement.open,
        controls,
      };
    })()`,
  );
  await evaluate(
    cdp,
    `(() => {
      document.querySelector("[data-customer-change-completion-refresh]").click();
      document.querySelector("[data-owner-change-completion-refresh]").click();
      return true;
    })()`,
  );
  const changeRefreshDeadline = Date.now() + 5000;
  while (
    (
      server.customerChangeCompletionReadCount() < 2
      || server.ownerChangeCompletionReadCount() < 2
    )
    && Date.now() < changeRefreshDeadline
  ) {
    await delay(25);
  }
  if (
    server.customerChangeCompletionReadCount() < 2
    || server.ownerChangeCompletionReadCount() < 2
  ) {
    throw new Error(
      "Change/completion refresh did not reach the browser-audit server.",
    );
  }
  await delay(250);
  const retainedChange = await evaluate(
    cdp,
    `(() => {
      const customer = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const owner = document.querySelector(
        "[data-owner-job-change-completion]"
      );
      return {
        customerText: customer.textContent.replace(/\\s+/g, " ").trim(),
        ownerText: owner.textContent.replace(/\\s+/g, " ").trim(),
        customerError: customer.querySelector(
          ".customer-owner-quote-form-error"
        )?.textContent.trim() || "",
        ownerError: owner.querySelector(
          ".customer-owner-quote-form-error"
        )?.textContent.trim() || "",
      };
    })()`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-owner-custom-build-work] button").click()`,
  );
  const refreshDeadline = Date.now() + 5000;
  while (
    server.paidJobReadCount() < 2
    && Date.now() < refreshDeadline
  ) {
    await delay(25);
  }
  if (server.paidJobReadCount() < 2) {
    throw new Error("Paid-job refresh did not reach the browser-audit server.");
  }
  await delay(250);
  const retained = await evaluate(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-owner-custom-build-work]");
      const status = panel.querySelector(".customer-owner-custom-build-status");
      return {
        hidden: panel.hidden,
        jobCount: panel.querySelectorAll("[data-paid-custom-build-job]").length,
        jobStillOpen: panel.querySelector("[data-paid-custom-build-job]")?.open === true,
        status: status.textContent.trim(),
        statusFocused: document.activeElement === status,
      };
    })()`,
  );
  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return { initial, retained, retainedChange };
}

await buildHostedArtifact({ root: ROOT });
const browser = await browserPath();
const server = await startServer();
const profile = await mkdtemp(
  path.join(os.tmpdir(), "sitesourcery-current-browser-"),
);
const port = await freePort();
const processState = { exited: false, stderr: "" };
const child = spawn(browser, [
  "--headless",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  processState.stderr += chunk;
});
child.once("exit", () => {
  processState.exited = true;
});

let cdp;
const failures = [];
const browserErrors = [];
try {
  cdp = new Cdp(await pageSocket(port, processState));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(
      exceptionDetails?.exception?.description
      || exceptionDetails?.text
      || "Unknown browser exception",
    );
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") {
      browserErrors.push(entry.text || "Unknown browser log error");
    }
  });
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable"),
    cdp.send("Network.enable"),
  ]);

  const sitemap = await readFile(
    path.join(ARTIFACT_ROOT, "sitemap.xml"),
    "utf8",
  );
  const routes = [
    ...new Set([
      ...[...sitemap.matchAll(/<loc>https:\/\/sitesourcery\.com([^<]*)<\/loc>/gu)]
        .map((match) => match[1]),
      "/abracadabra/app/",
    ]),
  ];

  for (const viewport of VIEWPORTS) {
    await setViewport(cdp, viewport);
    for (const route of routes) {
      if (route === "/abracadabra/app/") {
        await cdp.send("Storage.clearDataForOrigin", {
          origin: server.origin,
          storageTypes: "all",
        });
      }
      await navigate(cdp, new URL(route, server.origin).href);
      if (route === "/abracadabra/app/") await openHostedAccount(cdp);
      failures.push(
        ...snapshotFailures(
          await inspect(cdp),
          route,
          viewport,
        ),
      );
    }
  }

  await setViewport(cdp, VIEWPORTS[1]);
  await navigate(cdp, `${server.origin}/`);
  const menu = await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector("[data-menu-button]");
      button.click();
      const nav = document.querySelector("[data-menu]");
      const style = getComputedStyle(nav);
      const open = {
        expanded: button.getAttribute("aria-expanded"),
        visible: style.display !== "none" && style.visibility !== "hidden" && nav.getBoundingClientRect().height > 0,
      };
      button.click();
      return { ...open, closed: button.getAttribute("aria-expanded") };
    })()`,
  );
  if (
    menu.expanded !== "true"
    || !menu.visible
    || menu.closed !== "false"
  ) {
    failures.push(`phone menu did not open and close: ${JSON.stringify(menu)}`);
  }

  const journey = await makerJourney(cdp, server.origin);
  if (
    journey.currentStep !== "preview"
    || !String(journey.previewSource).startsWith("blob:")
    || !journey.openEnabled
    || journey.controlReady !== "hosted"
    || !journey.accountStageVisible
  ) {
    failures.push(`four-step maker journey failed: ${JSON.stringify(journey)}`);
  }

  for (const viewport of [VIEWPORTS[1], VIEWPORTS[2]]) {
    for (const mode of ["issued", "completion"]) {
    const paid = await paidCustomBuildJourney(cdp, server, viewport, mode);
    const shortControls = paid.initial.controls.filter(
      ({ height }) => height < 44,
    );
    const requiredCustomerLabels = [
      "Build",
      "Scope",
      "Bound footprint",
      "Target completion",
      "Opened",
    ];
    const requiredMilestones = [
      "Plan and structure",
      "Pages and content",
      "Phone and accessibility",
      "Final checks",
    ];
    if (
      !paid.initial.ownerVisible
      || !paid.initial.customerVisible
      || !paid.initial.customerProgressVisible
      || !paid.initial.customerChangeVisible
      || !paid.initial.ownerChangeVisible
      || !paid.initial.detailsOpen
      || paid.initial.summaryHeight < 44
      || shortControls.length
      || paid.initial.scrollWidth !== paid.initial.viewportWidth
      || !paid.initial.ownerText.includes(PAID_JOB_ID)
      || paid.initial.customerText.includes(PAID_JOB_ID)
      || !paid.initial.customerText.includes("USD before Checkout tax")
      || !paid.initial.ownerProgressText.includes(
        "Choose the approved contact wording"
      )
      || !paid.initial.customerProgressText.includes("Action needed from you")
      || !paid.initial.customerProgressText.includes(
        "Choose the approved contact wording"
      )
      || paid.initial.customerProgressText.includes(PAID_JOB_ID)
      || paid.initial.customerProgressText.includes(PAID_REQUEST_ID)
      || paid.initial.credentialFields.length
      || paid.initial.moneyOrRefundFields.length
      || paid.initial.customerIdentifierLeaks.length
      || (mode === "issued" && (
        !paid.initial.customerChangeText.includes("$250.00 USD")
        || !paid.initial.customerChangeText.includes(
          "Your original approved scope remains in place"
        )
        || !paid.initial.customerChangeText.includes(
          "does not begin until its payment is confirmed"
        )
        || !paid.initial.ownerChangeText.includes(
          "2 × $125"
        )
      ))
      || (mode === "completion" && (
        !paid.initial.customerChangeText.includes(
          "Completion proof is prepared"
        )
        || !paid.initial.customerChangeText.includes(
          "Accessibility basics · Passed"
        )
        || !paid.initial.customerChangeText.includes(
          "not payment, delivery, launch"
        )
        || !paid.initial.ownerChangeText.includes("Completion prepared")
        || !paid.initial.evidenceDimensions.some(
          (entry) => entry.includes("1440 × 1000 pixels")
        )
        || !paid.initial.evidenceDimensions.some(
          (entry) => entry.includes("390 × 844 pixels")
        )
      ))
      || requiredMilestones.some(
        (label) => !paid.initial.customerProgressMilestones.some(
          (entry) => entry.startsWith(label)
        )
      )
      || requiredCustomerLabels.some(
        (label) => !paid.initial.customerLabels.includes(label),
      )
    ) {
      failures.push(
        `${viewport.label} ${mode} paid Custom-build layout failed: ${JSON.stringify({
          ...paid.initial,
          ownerText: paid.initial.ownerText.slice(0, 240),
          customerText: paid.initial.customerText.slice(0, 240),
          ownerProgressText: paid.initial.ownerProgressText.slice(0, 240),
          customerProgressText:
            paid.initial.customerProgressText.slice(0, 240),
          shortControls,
        })}`,
      );
    }
    const retainedNeedle = mode === "completion"
      ? "Completion proof is prepared"
      : "Added-work subtotal";
    if (
      !paid.retainedChange.customerError
      || !paid.retainedChange.ownerError
      || !paid.retainedChange.customerText.includes(retainedNeedle)
      || !paid.retainedChange.ownerText.includes(
        mode === "completion" ? "Completion prepared" : "2 × $125"
      )
    ) {
      failures.push(
        `${viewport.label} ${mode} change/completion refresh retention failed: `
          + JSON.stringify(paid.retainedChange),
      );
    }
    if (
      paid.retained.hidden
      || paid.retained.jobCount !== 1
      || !paid.retained.status.toLowerCase().includes(
        "could not be verified"
      )
      || !paid.retained.statusFocused
    ) {
      failures.push(
        `${viewport.label} ${mode} paid Custom-build refresh retention failed: `
          + JSON.stringify(paid.retained),
      );
    }
    }
  }

  if (server.missingFiles.length) {
    failures.push(
      `artifact requested missing files: ${JSON.stringify([...new Set(server.missingFiles)])}`,
    );
  }
  const writes = server.apiRequests.filter(
    ({ method }) => method !== "GET" && method !== "HEAD",
  );
  if (writes.length) {
    failures.push(
      `guest browser audit made unexpected API writes: ${JSON.stringify(writes)}`,
    );
  }
  if (browserErrors.length) {
    failures.push(
      `browser errors: ${JSON.stringify([...new Set(browserErrors)])}`,
    );
  }

  if (failures.length) {
    throw new Error(
      `Current browser audit failed (${failures.length}):\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    `Current browser audit passed: ${routes.length} hosted routes × ${VIEWPORTS.length} viewports, `
      + "exact-width layout, four-stage account room, mobile menu, complete maker preview, and issued-change plus ready-completion customer/owner fixtures with malformed-refresh retention at 390×844 and 1440×1000.",
  );
} finally {
  if (cdp) cdp.close();
  await server.close();
  if (!processState.exited) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000),
  ]);
  if (!processState.exited) child.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
