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
import {
  createBrowserAuditArtifactPlan,
  prepareBrowserAuditArtifact,
} from "./browser-audit-artifact.mjs";
import {
  CANONICAL_ROUTES,
  LEGACY_REDIRECTS,
  SITE_ORIGIN,
} from "./check-routes.mjs";
import {
  reviewedLinuxCiSandboxArguments,
} from "../server/hosted/test/reviewed-browser-support.mjs";
import { getBrowserSafeAlakazamCatalog } from
  "../server/commerce-v2/alakazam.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ARTIFACT_PLAN = createBrowserAuditArtifactPlan({
  siteRoot: ROOT,
  environment: process.env,
  argv: process.argv.slice(2),
});
const ARTIFACT_ROOT = ARTIFACT_PLAN.hostedRoot;
const EXPECTED_BROWSER =
  "Google Chrome for Testing 149.0.7827.55";
const CDP_COMMAND_TIMEOUT_MS = 10000;
const BROWSER_CANDIDATES = Object.freeze([
  process.env.SITESOURCERY_CHROMIUM,
  "/private/tmp/sitesourcery-chrome-149.0.7827.55-mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  "/home/simtech/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell",
].filter(Boolean));
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: "phone-320", width: 320, height: 720, mobile: true }),
  Object.freeze({ label: "phone-360", width: 360, height: 800, mobile: true }),
  Object.freeze({ label: "phone-390", width: 390, height: 844, mobile: true }),
  Object.freeze({
    label: "reflow-720-at-200-percent",
    width: 360,
    height: 450,
    mobile: false,
    sourceWidth: 720,
    zoomPercent: 200,
  }),
  Object.freeze({ label: "tablet-768", width: 768, height: 1024, mobile: false }),
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
const PAID_ALAKAZAM_ACCEPTED_VERSION_ID =
  "31000000-0000-4000-8000-000000000001";
const PAID_ALAKAZAM_CURRENT_VERSION_ID =
  "31000000-0000-4000-8000-000000000002";
const PAID_ALAKAZAM_PRIOR_VERSION_ID =
  "31000000-0000-4000-8000-000000000003";
const PAID_ALAKAZAM_CURRENT_RELEASE_ID =
  "32000000-0000-4000-8000-000000000001";
const PAID_ALAKAZAM_PRIOR_RELEASE_ID =
  "32000000-0000-4000-8000-000000000002";
const PAID_ALAKAZAM_SNAPSHOT_DIGEST = "4".repeat(64);
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
const PAID_CHANGE_ACCEPTANCE_ID = "95000000-0000-4000-8000-000000000001";
const PAID_CHANGE_INVOICE_ID = "96000000-0000-4000-8000-000000000001";
const PAID_CHANGE_ATTEMPT_ID = "97000000-0000-4000-8000-000000000001";
const PAID_FINAL_PACKAGE_ID = "a1000000-0000-4000-8000-000000000001";
const PAID_FINAL_OBLIGATION_ID = "a2000000-0000-4000-8000-000000000002";
const PAID_FINAL_INVOICE_ID = "a3000000-0000-4000-8000-000000000003";
const PAID_FINAL_ATTEMPT_ID = "a4000000-0000-4000-8000-000000000004";
const PAID_FINAL_PAYMENT_RECEIPT_ID =
  "a5000000-0000-4000-8000-000000000005";
const PAID_FINAL_ZERO_CLEARANCE_ID =
  "a6000000-0000-4000-8000-000000000006";
const PAID_FINAL_DOCUMENT_ID = "a7000000-0000-4000-8000-000000000007";
const PAID_FINAL_HANDOFF_RECEIPT_ID =
  "a8000000-0000-4000-8000-000000000008";
const PAID_QUOTE_DIGEST = "a".repeat(64);
const PAID_DISCLOSURE_DIGEST = "b".repeat(64);
const PAID_INVOICE_DIGEST = "c".repeat(64);
const PAID_ACCEPTED_AT = "2026-08-06T15:00:00.000Z";
const PAID_CREDIT_CUTOFF = "2026-11-04T15:00:00.000Z";
const PAID_CHANGE_QUOTE_DIGEST = "d".repeat(64);
const PAID_CHANGE_DISCLOSURE_DIGEST = "e".repeat(64);
const PAID_CHANGE_INVOICE_DIGEST = "f".repeat(64);
const PAID_CHANGE_ACCEPTED_AT = "2026-08-06T16:30:00.000Z";
const PAID_CHANGE_SETTLED_AT = "2026-08-06T17:00:00.000Z";
// Keep the retained test checkout inside the same bounded validity window no
// matter when this current-state browser audit is run.
const PAID_CHANGE_CHECKOUT_EXPIRES_AT = new Date(
  Date.now() + 24 * 60 * 60 * 1000
).toISOString();
const PAID_CHANGE_CHECKOUT_URL =
  "https://checkout.stripe.com/c/pay/cs_test_sitesourcery_change_0001";
const PAID_FINAL_PACKAGE_DIGEST = "6".repeat(64);
const PAID_FINAL_OBLIGATION_DIGEST = "7".repeat(64);
const PAID_FINAL_INVOICE_DIGEST = "8".repeat(64);
const PAID_FINAL_COMPLETED_AT = "2026-11-01T04:45:00.000Z";
const PAID_FINAL_CLEARED_AT = "2026-11-01T05:00:00.000Z";
const PAID_FINAL_HANDED_OFF_AT = "2026-11-01T05:30:00.000Z";
const PAID_FINAL_WORKMANSHIP_ENDS_AT = "2026-12-01T05:30:00.000Z";
const PAID_PAYMENT_MODES = Object.freeze([
  "payment-checkout",
  "payment-paid",
  "payment-owner-uncertain",
  "payment-customer-held",
  "payment-customer-malformed",
  "payment-customer-uncertain",
]);
const PAID_FINAL_MODES = Object.freeze([
  "final-paid",
  "final-zero",
  "final-race",
]);
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
const PROJECT_LEGAL_PRIVACY_VERSION =
  "SS-HOSTED-PRIVACY-2026-08-09-V3";
const PROJECT_LEGAL_DOCUMENTS = Object.freeze([
  Object.freeze({
    kind: "privacy",
    version: PROJECT_LEGAL_PRIVACY_VERSION,
    contentDigest:
      "5713fd6776c6ba41dbbac1b4d1ac0d9f1b6857ba01128e5d74c4f3c5287a4967",
    contentUri:
      "https://sitesourcery.com/legal/privacy/versions/"
      + PROJECT_LEGAL_PRIVACY_VERSION + "/",
    effectiveAt: "2026-08-09T15:25:59.000Z",
  }),
  Object.freeze({
    kind: "product",
    version: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
    contentDigest:
      "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
    contentUri:
      "https://sitesourcery.com/legal/website-terms/#self-service",
    effectiveAt: "2026-08-09T15:25:59.000Z",
  }),
  Object.freeze({
    kind: "website",
    version: "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3",
    contentDigest:
      "b179ee8b6ed713b6b19b20daf320e84a9e89f2ac166504942919f8c4e280a602",
    contentUri:
      "https://sitesourcery.com/legal/website-terms/",
    effectiveAt: "2026-08-09T15:25:59.000Z",
  }),
]);
const PROJECT_LEGAL_AUTHORITY = Object.freeze({
  schema: "sitesourcery.project-legal-authority/v3",
  acceptanceStatement:
    "accepted_exact_project_terms_and_acknowledged_privacy",
  authorityDigest:
    "ae52bb144a3cb9bd09709cd58ce43878ec2a03d650a19ff197532ea51cd4d1cf",
  documents: PROJECT_LEGAL_DOCUMENTS,
});

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
    legal: {
      current: [
        {
          kind: "privacy",
          version: "SS-HOSTED-PRIVACY-2026-07-30-V2",
          contentDigest:
            "b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b",
          evidenceUri:
            "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/",
          acceptedAt: "2026-08-01T12:00:00.000Z",
        },
        {
          kind: "product",
          version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
          contentDigest:
            "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
          evidenceUri:
            "https://sitesourcery.com/legal/website-terms/#self-service",
          acceptedAt: "2026-08-01T12:00:00.000Z",
        },
        {
          kind: "website",
          version: "SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2",
          contentDigest:
            "bd710c536d2b2c1b8d056efecc8930f98147566ab16d5919382ed10518fe2196",
          evidenceUri:
            "https://sitesourcery.com/legal/website-terms/",
          acceptedAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      history: [],
    },
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
      grossMinor: 50000,
      creditMinor: 35000,
      paidSubtotalMinor: 15000,
      currency: "USD",
    },
    finalHandoff: {
      amountMinor: 50000,
      currency: "USD",
      state: "unpaid",
    },
  };
}

function paidCustomBuildQuote() {
  const contractId = "SS-CUSTOM-SERVICES-2026-08-19.2";
  const contractDigest =
    "0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d";
  const legalDocumentId = "00000000-0000-4000-8000-000000001410";
  return {
    schema: "sitesourcery.custom-services-custom-build-quote/v1",
    state: "accepted",
    projectId: PAID_PROJECT_ID,
    customerId: PAID_CUSTOMER_ID,
    credit: {
      creditId: PAID_CREDIT_ID,
      amountMinor: 35000,
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
      origin: "assessment_successor",
      creditSelection: "apply_assessment_credit",
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
          "Prices exclude tax. Tax calculation and collection remain disabled by the owner. Separately stated third-party provider charges are not included in the base price.",
          "Build work does not begin until the required first payment is verified.",
          "The 30-day workmanship correction covers reproducible defects in the accepted deliverables, not new content, features, changed decisions, third-party changes, or ongoing management.",
        ],
      },
      pricing: {
        serviceAmountMinor: 100000,
        creditAmountMinor: 35000,
        customerAmountMinor: 65000,
        currency: "USD",
        taxState: "disabled_by_owner",
        paymentSchedule: "half_before_work_half_before_handoff",
        startValueMinor: 50000,
        startCreditMinor: 35000,
        startDueMinor: 15000,
        finalDueMinor: 50000,
        installments: [
          {
            number: 1,
            kind: "start",
            grossValueMinor: 50000,
            creditAmountMinor: 35000,
            amountDueMinor: 15000,
            dueTrigger: "before_work",
          },
          {
            number: 2,
            kind: "final",
            grossValueMinor: 50000,
            creditAmountMinor: 0,
            amountDueMinor: 50000,
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
          amountMinor: 50000,
          currency: "USD",
        },
        {
          lineNumber: 2,
          componentKey: "assessment_build_credit",
          displayName: "Website assessment build credit",
          amountMinor: -35000,
          currency: "USD",
        },
      ],
      subtotal: { amountMinor: 15000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout",
      },
      credit: { amountMinor: 35000, state: "settled" },
      finalHandoff: { amountMinor: 50000, state: "due_before_handoff" },
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
    acceptedAt: ["accepted_payment_required", "effective"].includes(state)
      ? PAID_CHANGE_ACCEPTED_AT
      : null,
    declinedAt: null,
    void: null,
  };
  if (owner) value.createdByOperatorUserId = PAID_OPERATOR_ID;
  return value;
}

function paidChangeInvoice(state = "checkout_available") {
  const paid = state === "paid";
  const ready = state === "checkout_ready";
  return {
    schema: "sitesourcery.custom-build-change-invoice/v1",
    state,
    invoice: {
      invoiceId: PAID_CHANGE_INVOICE_ID,
      invoiceNumber: "SSCB-CHG-96000000000040008000000000000001",
      invoiceDigest: PAID_CHANGE_INVOICE_DIGEST,
      changeOrderId: PAID_CHANGE_ORDER_ID,
      changeAcceptanceId: PAID_CHANGE_ACCEPTANCE_ID,
      changeNumber: 1,
      acceptedQuoteDigest: PAID_CHANGE_QUOTE_DIGEST,
      acceptedDisclosureDigest: PAID_CHANGE_DISCLOSURE_DIGEST,
      issuedAt: PAID_CHANGE_ACCEPTED_AT,
      targetCompletionDate: "2026-09-22",
      lines: [{
        lineNumber: 1,
        componentKey: "custom_build_change_units",
        displayName: "Custom build change #1 — added-work units",
        quantity: 2,
        unitAmountMinor: 12500,
        amountMinor: 25000,
        currency: "USD",
      }],
      subtotal: { amountMinor: 25000, currency: "USD" },
      tax: paid
        ? { amountMinor: 2250, state: "settled" }
        : { amountMinor: null, state: "calculated_at_checkout" },
      total: paid
        ? { amountMinor: 27250, currency: "USD", state: "settled" }
        : { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready ? PAID_CHANGE_CHECKOUT_URL : null,
        checkoutExpiresAt: ready ? PAID_CHANGE_CHECKOUT_EXPIRES_AT : null,
        settledAt: paid ? PAID_CHANGE_SETTLED_AT : null,
      },
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state,
    },
  };
}

function unavailableChangeInvoice() {
  return {
    schema: "sitesourcery.custom-build-change-invoice/v1",
    state: "not_available",
    invoice: null,
    action: { available: false, reason: "invoice_not_available" },
  };
}

function paidChangeCheckout() {
  return {
    schema: "sitesourcery.custom-build-change-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId: PAID_CHANGE_INVOICE_ID,
      invoiceNumber: "SSCB-CHG-96000000000040008000000000000001",
      changeOrderId: PAID_CHANGE_ORDER_ID,
      url: PAID_CHANGE_CHECKOUT_URL,
      expiresAt: PAID_CHANGE_CHECKOUT_EXPIRES_AT,
      subtotal: { amountMinor: 25000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: { amountMinor: null, currency: "USD", state: "shown_at_checkout" },
      chargeOccurred: false,
    },
  };
}

function ownerChangePayments(mode, reconciled = false) {
  const uncertain = mode === "payment-owner-uncertain" && !reconciled;
  const ready = mode === "payment-owner-uncertain" && reconciled;
  return {
    schema: "sitesourcery.custom-build-change-payments-owner/v1",
    organizationId: PAID_ORGANIZATION_ID,
    jobId: PAID_JOB_ID,
    payments: uncertain || ready ? [{
      ...paidChangeInvoice(ready ? "checkout_ready" : "reconciliation_required"),
      owner: {
        attemptId: PAID_CHANGE_ATTEMPT_ID,
        attemptState: ready ? "ready" : "persistence_unknown",
        providerEffectCertainty: ready ? "confirmed" : "ambiguous",
        providerErrorCode: ready ? null : "checkout_persistence_unknown",
        providerRequestExpiresAt: PAID_CHANGE_CHECKOUT_EXPIRES_AT,
        eventId: null,
        eventState: null,
        reconciliationCode: null,
        receiptSource: null,
        canReconcileCreation: !ready,
        canReconcileSettlement: ready,
      },
    }] : [],
  };
}

function ownerChangeReconciliation() {
  return {
    schema:
      "sitesourcery.custom-build-change-payment-reconciliation-command/v1",
    status: "checkout_ready",
    organizationId: PAID_ORGANIZATION_ID,
    jobId: PAID_JOB_ID,
    attemptId: PAID_CHANGE_ATTEMPT_ID,
    invoiceId: PAID_CHANGE_INVOICE_ID,
    changeOrderId: PAID_CHANGE_ORDER_ID,
    action: "creation_reconciled",
    next: "customer_checkout",
    reason: null,
    checkout: paidChangeCheckout(),
    settlement: null,
  };
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
  const completionMode = mode === "completion"
    || (PAID_FINAL_MODES.includes(mode) && mode !== "final-race");
  const readyForDelivery = mode === "final-zero";
  const paymentMode = PAID_PAYMENT_MODES.includes(mode);
  const paidMode = mode === "payment-paid";
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
    state: readyForDelivery
      ? "ready_for_delivery"
      : "ready_for_final_payment",
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
  const changeOrders = completionMode || paidMode
    ? [paidChangeOrder("effective", owner)]
    : paymentMode
      ? [paidChangeOrder("accepted_payment_required", owner)]
      : [paidChangeOrder("issued", owner)];
  if (!owner) {
    return {
      schema: "sitesourcery.custom-build-change-completion/v1",
      state: completionMode
        ? readyForDelivery
          ? "ready_for_delivery"
          : "ready_for_final_payment"
        : paidMode
          ? "building"
          : paymentMode
            ? "change_order_payment_required"
        : "change_order_review",
      changeOrders: completionMode || paidMode
        ? { active: null, history: changeOrders }
        : { active: changeOrders[0], history: [] },
      completion,
    };
  }
  return {
    schema: "sitesourcery.custom-build-change-completion/v1",
    state: completionMode
      ? readyForDelivery
        ? "ready_for_delivery"
        : "ready_for_final_payment"
      : paidMode
        ? "building"
        : paymentMode
          ? "change_order_payment_required"
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

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ).join(",")}}`;
}

function paidFinalCompletionRequired() {
  return {
    schema: "sitesourcery.custom-build-final-handoff/v1",
    state: "completion_required",
    projectId: PAID_PROJECT_ID,
    jobId: null,
    completion: null,
    obligation: null,
    invoice: null,
    payment: null,
    handoff: {
      state: "unavailable",
      documentId: null,
      workmanshipStartsAt: null,
      workmanshipEndsAt: null,
    },
    action: {
      checkoutAvailable: false,
      handoffAvailable: false,
      reason: "completion_required",
    },
  };
}

function paidHandoffDocument(mode) {
  const zeroBalance = mode === "final-zero";
  const payload = {
    schema: "sitesourcery.custom-build-handoff-document/v1",
    state: "handed_off",
    projectId: PAID_PROJECT_ID,
    jobId: PAID_JOB_ID,
    completion: {
      packageId: PAID_FINAL_PACKAGE_ID,
      packageDigest: PAID_FINAL_PACKAGE_DIGEST,
    },
    finalObligation: {
      obligationId: PAID_FINAL_OBLIGATION_ID,
      obligationDigest: PAID_FINAL_OBLIGATION_DIGEST,
    },
    financialClearance: {
      kind: zeroBalance
        ? "zero_balance_clearance"
        : "provider_confirmed_final_payment",
      referenceId: zeroBalance
        ? PAID_FINAL_ZERO_CLEARANCE_ID
        : PAID_FINAL_PAYMENT_RECEIPT_ID,
      clearedAt: PAID_FINAL_CLEARED_AT,
    },
    customerSummary:
      "Your accepted website build is delivered with the items listed below.",
    deliveryManifest: [{
      label: "Website files",
      description: "Final accepted website deliverables",
    }, {
      label: "Handoff notes",
      description: "Scope, delivery, and workmanship details",
    }],
    handoff: {
      receiptId: PAID_FINAL_HANDOFF_RECEIPT_ID,
      documentId: PAID_FINAL_DOCUMENT_ID,
      handedOffAt: PAID_FINAL_HANDED_OFF_AT,
      workmanship: {
        coverage: "[start,end)",
        termDays: 30,
        startsAt: PAID_FINAL_HANDED_OFF_AT,
        endsAt: PAID_FINAL_WORKMANSHIP_ENDS_AT,
      },
    },
  };
  const bytes = Buffer.from(canonicalJson(payload), "utf8");
  return {
    schema: "sitesourcery.custom-build-handoff-document/v1",
    documentId: PAID_FINAL_DOCUMENT_ID,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "application/json",
    byteCount: bytes.byteLength,
    payload,
  };
}

function paidFinalState(mode, handedOff = false) {
  const zeroBalance = mode === "final-zero";
  const amountMinor = zeroBalance ? 0 : 60000;
  const taxMinor = zeroBalance ? null : 5400;
  const state = handedOff
    ? "handed_off"
    : zeroBalance
      ? "cleared_no_balance_handoff_pending"
      : "paid_handoff_pending";
  return {
    schema: "sitesourcery.custom-build-final-handoff/v1",
    state,
    projectId: PAID_PROJECT_ID,
    jobId: PAID_JOB_ID,
    completion: {
      packageId: PAID_FINAL_PACKAGE_ID,
      packageDigest: PAID_FINAL_PACKAGE_DIGEST,
      completedAt: PAID_FINAL_COMPLETED_AT,
    },
    obligation: {
      obligationId: PAID_FINAL_OBLIGATION_ID,
      obligationDigest: PAID_FINAL_OBLIGATION_DIGEST,
      amount: { amountMinor, currency: "USD" },
      installmentNumber: zeroBalance ? null : 2,
      workmanshipCorrectionDays: 30,
      boundAt: "2026-11-01T04:46:00.000Z",
    },
    invoice: zeroBalance ? null : {
      invoiceId: PAID_FINAL_INVOICE_ID,
      invoiceNumber:
        `SSCB-FINAL-${PAID_FINAL_INVOICE_ID.replaceAll("-", "").toUpperCase()}`,
      invoiceDigest: PAID_FINAL_INVOICE_DIGEST,
      purpose: "custom_build_final",
      issuedAt: "2026-11-01T04:47:00.000Z",
      lines: [{
        lineNumber: 1,
        componentKey: "custom_build_final_installment",
        displayName: "Custom website build final installment",
        quantity: 1,
        unitAmountMinor: amountMinor,
        amountMinor,
        creditMinor: 0,
        currency: "USD",
      }],
      subtotal: { amountMinor, currency: "USD" },
      credit: { amountMinor: 0, currency: "USD" },
      tax: { amountMinor: taxMinor, state: "settled" },
      total: {
        amountMinor: amountMinor + taxMinor,
        currency: "USD",
        state: "settled",
      },
    },
    payment: zeroBalance ? {
      state: "cleared_no_balance",
      chargeOccurred: false,
      zeroBalanceClearance: {
        clearanceId: PAID_FINAL_ZERO_CLEARANCE_ID,
        clearanceDigest: "9".repeat(64),
        clearedAt: PAID_FINAL_CLEARED_AT,
      },
    } : {
      state: "paid",
      chargeOccurred: true,
      checkoutUrl: null,
      checkoutExpiresAt: null,
      settledAt: PAID_FINAL_CLEARED_AT,
    },
    handoff: handedOff ? {
      state: "handed_off",
      documentId: PAID_FINAL_DOCUMENT_ID,
      contentDigest: paidHandoffDocument(mode).contentDigest,
      handedOffAt: PAID_FINAL_HANDED_OFF_AT,
      workmanshipStartsAt: PAID_FINAL_HANDED_OFF_AT,
      workmanshipEndsAt: PAID_FINAL_WORKMANSHIP_ENDS_AT,
    } : {
      state: "pending",
      documentId: null,
      workmanshipStartsAt: null,
      workmanshipEndsAt: null,
    },
    action: {
      checkoutAvailable: false,
      handoffAvailable: false,
      reason: state,
    },
  };
}

function ownerFinalPayments(mode, handedOff = false) {
  return {
    schema: "sitesourcery.custom-build-final-payments-owner/v1",
    organizationId: PAID_ORGANIZATION_ID,
    jobId: PAID_JOB_ID,
    finalPayment: paidFinalState(mode, handedOff),
    owner: {
      attemptId: mode === "final-zero" ? null : PAID_FINAL_ATTEMPT_ID,
      attemptState: mode === "final-zero" ? null : "paid",
      canReconcileCreation: false,
      canReconcileSettlement: false,
      eventId: null,
      eventState: null,
      providerEffectCertainty: mode === "final-zero" ? null : "confirmed",
      providerErrorCode: null,
      providerRequestExpiresAt: null,
      receiptSource: mode === "final-zero" ? null : "provider_readback",
      reconciliationCode: null,
    },
  };
}

function ownerFinalCompletionRequired() {
  return {
    schema: "sitesourcery.custom-build-final-payments-owner/v1",
    organizationId: PAID_ORGANIZATION_ID,
    jobId: PAID_JOB_ID,
    finalPayment: paidFinalCompletionRequired(),
    owner: {
      attemptId: null,
      attemptState: null,
      canReconcileCreation: false,
      canReconcileSettlement: false,
      eventId: null,
      eventState: null,
      providerEffectCertainty: null,
      providerErrorCode: null,
      providerRequestExpiresAt: null,
      receiptSource: null,
      reconciliationCode: null,
    },
  };
}

function ownerHandoffReadiness(mode, handedOff = false) {
  return {
    schema: "sitesourcery.custom-build-handoff-owner-readiness/v1",
    state: handedOff ? "handed_off" : "handoff_available",
    organizationId: PAID_ORGANIZATION_ID,
    projectId: PAID_PROJECT_ID,
    jobId: PAID_JOB_ID,
    completion: {
      packageId: PAID_FINAL_PACKAGE_ID,
      packageDigest: PAID_FINAL_PACKAGE_DIGEST,
      completedAt: PAID_FINAL_COMPLETED_AT,
    },
    finalObligation: {
      obligationId: PAID_FINAL_OBLIGATION_ID,
      obligationDigest: PAID_FINAL_OBLIGATION_DIGEST,
    },
    financialClearance: { clearedAt: PAID_FINAL_CLEARED_AT },
    handoff: handedOff ? {
      documentId: PAID_FINAL_DOCUMENT_ID,
      contentDigest: paidHandoffDocument(mode).contentDigest,
      handedOffAt: PAID_FINAL_HANDED_OFF_AT,
      workmanship: {
        coverage: "[start,end)",
        termDays: 30,
        startsAt: PAID_FINAL_HANDED_OFF_AT,
        endsAt: PAID_FINAL_WORKMANSHIP_ENDS_AT,
      },
    } : null,
    action: {
      handoffAvailable: !handedOff,
      reason: handedOff ? "handed_off" : "financial_clearance_confirmed",
    },
  };
}

function paidHandoffCommand(mode) {
  return {
    schema: "sitesourcery.custom-build-handoff-command/v1",
    state: "handed_off",
    organizationId: PAID_ORGANIZATION_ID,
    projectId: PAID_PROJECT_ID,
    jobId: PAID_JOB_ID,
    receiptId: PAID_FINAL_HANDOFF_RECEIPT_ID,
    documentId: PAID_FINAL_DOCUMENT_ID,
    documentDigest: paidHandoffDocument(mode).contentDigest,
    completionPackageDigest: PAID_FINAL_PACKAGE_DIGEST,
    finalObligationDigest: PAID_FINAL_OBLIGATION_DIGEST,
    financialClearance: {
      kind: mode === "final-zero"
        ? "zero_balance_clearance"
        : "provider_confirmed_final_payment",
      referenceId: mode === "final-zero"
        ? PAID_FINAL_ZERO_CLEARANCE_ID
        : PAID_FINAL_PAYMENT_RECEIPT_ID,
      clearedAt: PAID_FINAL_CLEARED_AT,
    },
    handedOffAt: PAID_FINAL_HANDED_OFF_AT,
    workmanship: {
      coverage: "[start,end)",
      termDays: 30,
      startsAt: PAID_FINAL_HANDED_OFF_AT,
      endsAt: PAID_FINAL_WORKMANSHIP_ENDS_AT,
    },
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

function activeAlakazamAccount() {
  const selectedTier = getBrowserSafeAlakazamCatalog().tiers[1];
  return {
    schema: "sitesourcery.alakazam-account/v2",
    projectId: PAID_PROJECT_ID,
    state: "active",
    catalog: getBrowserSafeAlakazamCatalog(),
    downloadCredit: {
      available: false,
      amountMinor: 0,
      currency: "USD",
    },
    subscription: {
      tier: selectedTier,
      status: "active",
      paymentState: "paid",
      price: selectedTier.price,
      revision: 4,
      currentPeriod: {
        startsAt: "2026-08-01T12:00:00.000Z",
        endsAt: "2026-09-01T12:00:00.000Z",
      },
      cancelAtPeriodEnd: false,
      firstFailedAt: null,
      graceEndsAt: null,
    },
    pendingChange: null,
    nextRenewal: {
      tierId: selectedTier.tierId,
      amountMinor: selectedTier.price.amountMinor,
      currency: "USD",
      dueAt: "2026-09-01T12:00:00.000Z",
      state: "scheduled",
    },
    site: {
      acceptedVersionId: PAID_ALAKAZAM_ACCEPTED_VERSION_ID,
      addressLabel: "avery-studio",
      hostname: "avery-studio.sitesourcery.me",
      look: { lookId: "look_crystal", label: "Crystal" },
      setupDigest: "5".repeat(64),
      state: "live",
      updatedAt: "2026-08-08T13:30:00.000Z",
      url: "https://avery-studio.sitesourcery.me/",
    },
    receipts: [],
    actions: {
      configureSite: false,
      start: false,
      changeTier: true,
      manageBilling: false,
      cancel: false,
      reason: "only_tier_change_composed",
    },
  };
}

function heldAlakazam35Snapshot() {
  return {
    schema: "sitesourcery.alakazam-35-snapshot/v1",
    state: "held",
    providerEffects: false,
    holdReason: "commercial_cutover_not_authorized",
    projectId: PAID_PROJECT_ID,
    subscription: {
      subscriptionId: "40000000-0000-4000-8000-000000000001",
      tierId: "alakazam_35",
      status: "active",
      revision: 4,
    },
    controls: {
      photoHeader: {
        enabled: true,
        mediaTypes: ["image/jpeg", "image/png"],
        maxBytes: 2_000_000,
        photo: null,
      },
      fonts: [
        { fontChoiceId: "standard", label: "Standard" },
        { fontChoiceId: "alt", label: "Alternate" },
      ],
      sections: ["about", "offerings", "practical", "contact"],
      versionHistoryLimit: 3,
      careClass: "modest",
    },
    configuration: null,
    history: [],
    care: {
      state: "held",
      requestCount: 0,
      lastRequestedAt: null,
    },
  };
}

function heldRetainedPremiumSnapshot() {
  return {
    schema: "sitesourcery.alakazam-retained-premium-snapshot/v1",
    policyId: "SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1",
    state: "held",
    providerEffects: false,
    holdReason: "commercial_cutover_not_authorized",
    projectId: PAID_PROJECT_ID,
    lifecycle: {
      state: "active",
      retentionEndsAt: null,
      privateRead: true,
      customerExport: true,
      edit: true,
      publish: true,
      care: true,
    },
    subscription: {
      tierId: "alakazam_35",
      status: "active",
      revision: 4,
      cancelAtPeriodEnd: false,
    },
    premium: {
      configured: false,
      configurationRevision: null,
      configurationDigest: null,
      effectiveOutput: "masked",
      values: null,
    },
    restoration: {
      required: false,
      available: false,
      sourceConfigurationRevision: null,
      sourceConfigurationDigest: null,
    },
    actions: {
      edit: false,
      restore: false,
      export: true,
      publish: true,
      care: true,
    },
  };
}

function heldAlakazamPublication(command = null) {
  return {
    schema: "sitesourcery.alakazam-publication/v1",
    projectId: PAID_PROJECT_ID,
    state: "held",
    holdReason: "commercial_cutover_not_authorized",
    subscription: {
      subscriptionId:
        "33000000-0000-4000-8000-000000000001",
      revision: 4,
      tierId: "alakazam_35",
      status: "active",
    },
    site: {
      hostname: "avery-studio.sitesourcery.me",
      state: "live",
      acceptedVersionId: PAID_ALAKAZAM_ACCEPTED_VERSION_ID,
      acceptedArtifactDigest: "6".repeat(64),
      currentReleaseId: PAID_ALAKAZAM_CURRENT_RELEASE_ID,
      currentVersionId: PAID_ALAKAZAM_CURRENT_VERSION_ID,
      updatedAt: "2026-08-08T13:30:00.000Z",
    },
    history: [{
      releaseId: PAID_ALAKAZAM_CURRENT_RELEASE_ID,
      versionId: PAID_ALAKAZAM_CURRENT_VERSION_ID,
      artifactDigest: "7".repeat(64),
      releasedAt: "2026-08-08T13:30:00.000Z",
      isCurrent: true,
    }, {
      releaseId: PAID_ALAKAZAM_PRIOR_RELEASE_ID,
      versionId: PAID_ALAKAZAM_PRIOR_VERSION_ID,
      artifactDigest: "8".repeat(64),
      releasedAt: "2026-08-01T13:30:00.000Z",
      isCurrent: false,
    }],
    actions: {
      publish: true,
      rollback: true,
      unpublish: true,
      rollbackTargetReleaseId: PAID_ALAKAZAM_PRIOR_RELEASE_ID,
    },
    snapshotDigest: PAID_ALAKAZAM_SNAPSHOT_DIGEST,
    command,
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

async function requestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > 32 * 1024) throw new Error("Browser-audit request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  const paidFixtures = new Map();
  let paidFixtureSequence = 0;
  let staticFailureMode = "";
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/")) {
      const paidCookie = String(request.headers.cookie || "")
        .split(";")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${PAID_FIXTURE_COOKIE}=`));
      const paidFixtureToken = paidCookie
        ? decodeURIComponent(paidCookie.split("=", 2)[1] || "")
        : "";
      const paidState = paidFixtures.get(paidFixtureToken) || null;
      const paidMode = paidState?.mode || "";
      const paidFixture = Boolean(paidState);
      let body = null;
      try {
        if (!["GET", "HEAD"].includes(request.method || "GET")) {
          body = await requestJson(request);
        }
      } catch {
        json(response, 400, {
          error: { code: "BAD_JSON", message: "Invalid browser-audit JSON." },
        });
        return;
      }
      const apiRequest = {
        method: request.method || "GET",
        pathname: url.pathname,
        search: url.search,
        paidFixture,
        paidFixtureToken,
        paidMode,
        body,
        idempotencyKey: String(request.headers["idempotency-key"] || ""),
        expectedWrite: false,
        fixtureStatus: null,
      };
      apiRequests.push(apiRequest);
      if (
        request.method === "GET"
        && url.pathname ===
          "/api/v1/legal/project-authority"
      ) {
        json(response, 200, PROJECT_LEGAL_AUTHORITY);
        return;
      }
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
          alakazamQuote: false,
          alakazamCheckout: false,
          alakazamDowngrade: false,
          alakazam35: false,
          alakazam50: false,
          alakazamRetainedPremium: false,
          alakazamPublication:
            paidMode === "publication",
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
        if (url.pathname === "/api/v1/care") {
          json(response, 200, {
            schema: "sitesourcery.care-surface-dashboard/v1",
            audience: "customer",
            organizationId: PAID_ORGANIZATION_ID,
            observedAt: "2026-08-13T12:00:00.000Z",
            held: {
              commercialRelease: true,
              customerEffects: true,
              mailDelivery: true,
              paymentEffects: true,
              providerEffects: true,
            },
            contracts: [],
          });
          return;
        }
        if (url.pathname === "/api/v1/responder") {
          json(response, 200, {
            schema: "sitesourcery.responder-surface-dashboard/v1",
            audience: "customer",
            organizationId: PAID_ORGANIZATION_ID,
            observedAt: "2026-08-13T12:00:00.000Z",
            mode: "held",
            globalKillEngaged: true,
            sellable: false,
            billingEffects: false,
            providerEffects: false,
            contacts: [],
            interactions: [],
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
          json(
            response,
            200,
            paidMode === "publication"
              ? activeAlakazamAccount()
              : availableAlakazamAccount()
          );
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/alakazam/publication`
        ) {
          json(response, 200, heldAlakazamPublication());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/alakazam/35`
        ) {
          json(response, 200, heldAlakazam35Snapshot());
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/alakazam/premium`
        ) {
          json(response, 200, heldRetainedPremiumSnapshot());
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
          paidState.paidJobReads += 1;
          if (paidState.paidJobReads === 1) {
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
          paidState.ownerChangeCompletionReads += 1;
          json(
            response,
            200,
            paidState.ownerChangeCompletionReads === 1
              || PAID_PAYMENT_MODES.includes(paidMode)
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
            `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/change-payments`
        ) {
          paidState.ownerChangePaymentReads += 1;
          json(
            response,
            200,
            ownerChangePayments(
              paidMode,
              paidState.ownerChangePaymentReconciled,
            ),
          );
          return;
        }
        if (
          url.pathname ===
            `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-payments`
        ) {
          paidState.ownerFinalPaymentReads += 1;
          if (["final-paid", "final-zero"].includes(paidMode)) {
            apiRequest.fixtureStatus = 403;
            json(response, 403, {
              error: {
                code: "FORBIDDEN",
                message:
                  "This exact operator has handoff authority without payment-reconciliation authority.",
              },
            });
          } else if (paidMode === "final-race") {
            await delay(1500);
            apiRequest.fixtureStatus = 200;
            json(response, 200, ownerFinalPayments(paidMode, true));
          } else {
            apiRequest.fixtureStatus = 200;
            json(response, 200, ownerFinalCompletionRequired());
          }
          return;
        }
        if (
          url.pathname ===
            `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-handoff`
        ) {
          paidState.ownerFinalHandoffReads += 1;
          if (paidMode === "final-race") {
            await delay(1500);
            apiRequest.fixtureStatus = 200;
            json(response, 200, ownerHandoffReadiness(paidMode, true));
          } else if (PAID_FINAL_MODES.includes(paidMode)) {
            apiRequest.fixtureStatus = 200;
            json(
              response,
              200,
              ownerHandoffReadiness(paidMode, paidState.finalHandoffCreated),
            );
          } else {
            apiRequest.fixtureStatus = 503;
            json(response, 503, {
              error: {
                code: "CUSTOM_BUILD_HANDOFF_HELD",
                message: "Completion is required before handoff readiness exists.",
              },
            });
          }
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
          paidState.customerChangeCompletionReads += 1;
          if (paidMode === "final-race") await delay(500);
          json(
            response,
            200,
            paidState.customerChangeCompletionReads === 1
              || PAID_PAYMENT_MODES.includes(paidMode)
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
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-invoice`
        ) {
          paidState.customerChangeInvoiceReads += 1;
          if (paidMode === "payment-customer-held") {
            json(response, 503, {
              error: {
                code: "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
                message: "Added-work payment is held in this runtime.",
              },
            });
          } else if (
            paidMode === "payment-customer-malformed"
            && paidState.customerChangeInvoiceReads > 1
          ) {
            json(response, 200, {
              ...paidChangeInvoice("checkout_available"),
              invoice: {
                ...paidChangeInvoice("checkout_available").invoice,
                lines: null,
              },
            });
          } else if (paidMode === "payment-paid") {
            json(response, 200, paidChangeInvoice("paid"));
          } else if (paidMode === "payment-owner-uncertain") {
            json(response, 200, paidChangeInvoice("reconciliation_required"));
          } else if (PAID_PAYMENT_MODES.includes(paidMode)) {
            json(response, 200, paidChangeInvoice("checkout_available"));
          } else {
            json(response, 200, unavailableChangeInvoice());
          }
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-final-handoff`
        ) {
          paidState.customerFinalReads += 1;
          if (
            paidState.customerFinalFailureArmed
            && ["final-paid", "final-zero"].includes(paidMode)
          ) {
            await delay(200);
            apiRequest.fixtureStatus = 503;
            json(response, 503, {
              error: {
                code: "CUSTOM_BUILD_HANDOFF_HELD",
                message:
                  "Final delivery state is temporarily unavailable after the retained receipt was loaded.",
              },
            });
          } else if (paidMode === "final-race") {
            await delay(1500);
            apiRequest.fixtureStatus = 200;
            json(response, 200, paidFinalState(paidMode, true));
          } else if (PAID_FINAL_MODES.includes(paidMode)) {
            apiRequest.fixtureStatus = 200;
            json(
              response,
              200,
              paidFinalState(paidMode, paidState.finalHandoffCreated),
            );
          } else {
            apiRequest.fixtureStatus = 200;
            json(response, 200, paidFinalCompletionRequired());
          }
          return;
        }
        if (
          url.pathname ===
            `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-handoff-documents/${PAID_FINAL_DOCUMENT_ID}`
        ) {
          paidState.customerHandoffDocumentReads += 1;
          if (
            PAID_FINAL_MODES.includes(paidMode)
            && (paidState.finalHandoffCreated || paidMode === "final-race")
            && paidState.customerHandoffDocumentReads === 1
          ) {
            apiRequest.fixtureStatus = 200;
            json(response, 200, paidHandoffDocument(paidMode));
          } else if (
            PAID_FINAL_MODES.includes(paidMode)
            && (paidState.finalHandoffCreated || paidMode === "final-race")
          ) {
            paidState.customerFinalFailureArmed = true;
            apiRequest.fixtureStatus = 503;
            await delay(200);
            json(response, 503, {
              error: {
                code: "CUSTOM_BUILD_HANDOFF_DOCUMENT_HELD",
                message:
                  "The retained handoff document is temporarily unavailable.",
              },
            });
          } else {
            apiRequest.fixtureStatus = 404;
            json(response, 404, {
              error: {
                code: "CUSTOM_BUILD_HANDOFF_DOCUMENT_NOT_FOUND",
                message: "No immutable handoff document exists yet.",
              },
            });
          }
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
      if (
        paidFixture
        && paidMode === "publication"
        && request.method === "POST"
        && url.pathname ===
          `/api/v1/projects/${PAID_PROJECT_ID}/alakazam/publication-commands`
      ) {
        apiRequest.expectedWrite = true;
        const action = body?.action;
        const targetReleaseId = action === "rollback"
          ? PAID_ALAKAZAM_PRIOR_RELEASE_ID
          : null;
        const targetVersionId = action === "rollback"
          ? PAID_ALAKAZAM_PRIOR_VERSION_ID
          : action === "publish"
            ? PAID_ALAKAZAM_ACCEPTED_VERSION_ID
            : null;
        json(response, 202, heldAlakazamPublication({
          commandId: apiRequest.idempotencyKey,
          action,
          state: "held",
          holdReason: "commercial_cutover_not_authorized",
          snapshotDigest: PAID_ALAKAZAM_SNAPSHOT_DIGEST,
          commandDigest: createHash("sha256")
            .update(`publication:${apiRequest.idempotencyKey}`)
            .digest("hex"),
          targetReleaseId,
          targetVersionId,
          requestedAt: "2026-08-08T14:00:00.000Z",
        }));
        return;
      }
      if (
        paidFixture
        && request.method === "POST"
        && url.pathname ===
          `/api/v1/organizations/${PAID_ORGANIZATION_ID}/projects`
      ) {
        apiRequest.expectedWrite = true;
        json(response, 409, {
          error: {
            code: "LEGAL_AUTHORITY_CHANGED",
            message:
              "The reviewed legal authority changed. Refresh and try again.",
          },
        });
        return;
      }
      if (
        paidFixture
        && request.method === "POST"
        && url.pathname ===
          `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-invoices/${PAID_CHANGE_INVOICE_ID}/checkout-command`
      ) {
        apiRequest.expectedWrite = true;
        if (paidMode === "payment-customer-uncertain") {
          json(response, 409, {
            error: {
              code: "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED",
              message: "The payment-page result requires owner reconciliation.",
            },
          });
        } else {
          json(response, 200, paidChangeCheckout());
        }
        return;
      }
      if (
        paidFixture
        && request.method === "POST"
        && url.pathname ===
          `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/change-payments/${PAID_CHANGE_ATTEMPT_ID}/checkout-reconciliation`
      ) {
        apiRequest.expectedWrite = true;
        paidState.ownerChangePaymentReconciled = true;
        json(response, 200, ownerChangeReconciliation());
        return;
      }
      if (
        paidFixture
        && request.method === "POST"
        && url.pathname ===
          `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/handoff`
      ) {
        apiRequest.expectedWrite = true;
        if (!["final-paid", "final-zero"].includes(paidMode)) {
          json(response, 409, {
            error: {
              code: "CUSTOM_BUILD_HANDOFF_NOT_READY",
              message: "This fixture is not ready for an owner handoff command.",
            },
          });
          return;
        }
        paidState.finalHandoffCreated = true;
        json(response, 200, paidHandoffCommand(paidMode));
        return;
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
    const extension = path.extname(file).toLowerCase();
    const deliberatelyUnavailable =
      (staticFailureMode === "styles" && extension === ".css")
      || (
        staticFailureMode === "images"
        && [".ico", ".png", ".svg", ".webp"].includes(extension)
      );
    if (deliberatelyUnavailable) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end("Deliberately unavailable during bounded browser proof");
      return;
    }
    try {
      let bytes = await readFile(file);
      const staticPaidCookie = String(request.headers.cookie || "")
        .split(";")
        .map((entry) => entry.trim())
        .find((entry) =>
          entry.startsWith(`${PAID_FIXTURE_COOKIE}=`)
        );
      const staticFixtureToken = staticPaidCookie
        ? decodeURIComponent(
            staticPaidCookie.split("=", 2)[1] || ""
          )
        : "";
      const staticPaidMode =
        paidFixtures.get(staticFixtureToken)?.mode || "";
      if (
        staticPaidMode === "publication"
        && url.pathname ===
          "/abracadabra/app/abracadabra-customer-control-dom.js"
      ) {
        const source = bytes.toString("utf8");
        const held =
          'var ALAKAZAM_PUBLIC_OFFER_STATE = "held";';
        if (source.split(held).length !== 2) {
          throw new Error(
            "Publication browser fixture could not locate the exact held gate."
          );
        }
        bytes = Buffer.from(
          source.replace(
            held,
            'var ALAKAZAM_PUBLIC_OFFER_STATE = "released";'
          ),
          "utf8"
        );
      }
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
  const fixtureReadCount = (token, field) =>
    paidFixtures.get(token)?.[field] ?? 0;
  return Object.freeze({
    apiRequests,
    missingFiles,
    origin: `http://127.0.0.1:${port}`,
    beginPaidFixture(mode, viewport, journey) {
      if (![
        "issued",
        "completion",
        "publication",
        ...PAID_PAYMENT_MODES,
        ...PAID_FINAL_MODES,
      ].includes(mode)) {
        throw new Error(`Unknown paid browser fixture mode: ${mode}`);
      }
      const runNonce = `${Date.now().toString(36)}-${++paidFixtureSequence}`;
      const token = [
        mode,
        viewport.label,
        `${viewport.width}x${viewport.height}`,
        journey,
        runNonce,
      ].join(".");
      paidFixtures.set(token, {
        mode,
        journey,
        viewport: viewport.label,
        paidJobReads: 0,
        customerChangeCompletionReads: 0,
        ownerChangeCompletionReads: 0,
        customerChangeInvoiceReads: 0,
        ownerChangePaymentReads: 0,
        ownerChangePaymentReconciled: false,
        customerFinalReads: 0,
        ownerFinalPaymentReads: 0,
        ownerFinalHandoffReads: 0,
        customerHandoffDocumentReads: 0,
        finalHandoffCreated: false,
        customerFinalFailureArmed: false,
      });
      return token;
    },
    paidJobReadCount(token) {
      return fixtureReadCount(token, "paidJobReads");
    },
    customerChangeCompletionReadCount(token) {
      return fixtureReadCount(token, "customerChangeCompletionReads");
    },
    ownerChangeCompletionReadCount(token) {
      return fixtureReadCount(token, "ownerChangeCompletionReads");
    },
    customerChangeInvoiceReadCount(token) {
      return fixtureReadCount(token, "customerChangeInvoiceReads");
    },
    ownerChangePaymentReadCount(token) {
      return fixtureReadCount(token, "ownerChangePaymentReads");
    },
    customerFinalReadCount(token) {
      return fixtureReadCount(token, "customerFinalReads");
    },
    ownerFinalPaymentReadCount(token) {
      return fixtureReadCount(token, "ownerFinalPaymentReads");
    },
    ownerFinalHandoffReadCount(token) {
      return fixtureReadCount(token, "ownerFinalHandoffReads");
    },
    customerHandoffDocumentReadCount(token) {
      return fixtureReadCount(token, "customerHandoffDocumentReads");
    },
    setStaticFailureMode(mode) {
      if (!["", "images", "styles"].includes(mode)) {
        throw new Error(`Unknown static failure mode: ${mode}`);
      }
      staticFailureMode = mode;
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
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(
          `${method}: timed out after ${CDP_COMMAND_TIMEOUT_MS}ms`,
        ));
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        method,
        reject(error) {
          clearTimeout(timeout);
          reject(error);
        },
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
      });
    });
    try {
      this.socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.reject(error);
    }
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

async function navigateWithoutPageScript(cdp, url) {
  const navigation = await cdp.send("Page.navigate", { url });
  if (navigation.errorText) {
    throw new Error(
      `No-script navigation failed for ${url}: ${navigation.errorText}`,
    );
  }
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const history = await cdp.send("Page.getNavigationHistory");
      const current = history.entries?.[history.currentIndex];
      if (current?.url === url) {
        await delay(150);
        return current;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for no-script navigation to ${url}`
      + (lastError ? `; last CDP error: ${lastError.message}` : ""),
  );
}

async function inspectNoScript(cdp) {
  const [{ nodes = [] }, history, metrics] = await Promise.all([
    cdp.send("Accessibility.getFullAXTree"),
    cdp.send("Page.getNavigationHistory"),
    cdp.send("Page.getLayoutMetrics"),
  ]);
  const current = history.entries?.[history.currentIndex] ?? {};
  const active = nodes.filter((node) => !node.ignored);
  const role = (node) => String(node.role?.value ?? "").toLowerCase();
  const headingLevel = (node) => node.properties?.find(
    (property) => property.name === "level",
  )?.value?.value;
  return {
    url: current.url ?? "",
    title: current.title ?? "",
    mainCount: active.filter((node) => role(node) === "main").length,
    h1: active
      .filter((node) => role(node) === "heading" && headingLevel(node) === 1)
      .map((node) => String(node.name?.value ?? "").trim()),
    viewportWidth: Math.round(metrics.layoutViewport?.clientWidth ?? 0),
    contentWidth: Math.round(metrics.contentSize?.width ?? 0),
  };
}

async function isolatePaidJourney(cdp) {
  try {
    await cdp.send("Page.stopLoading");
  } catch (error) {
    if (
      error.message !== "Page.stopLoading: Not attached to an active page"
    ) throw error;
  }
  await cdp.send("Page.navigate", { url: "about:blank" });
  await waitFor(
    cdp,
    `document.readyState === "complete" && location.href === "about:blank"`,
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
  await waitFor(
    cdp,
    `["ready", "held"].includes(
      globalThis.SiteSourceryAbracadabraHostedSession
        ?.getState().projectLegalAuthorityStatus
    )`,
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
      const isolatedOverflow = [];
      if (scrollWidth > innerWidth) {
        const measuredWidth = () => Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        );
        const selector = (element) => element.id
          ? "#" + element.id
          : element.tagName.toLowerCase()
            + (element.classList.length
              ? "." + [...element.classList].slice(0, 2).join(".")
              : "");
        const isolate = (parent, depth = 0) => {
          if (depth > 4 || isolatedOverflow.length >= 20) return;
          for (const child of parent.children) {
            const previous = child.style.getPropertyValue("display");
            const priority = child.style.getPropertyPriority("display");
            child.style.setProperty("display", "none", "important");
            const without = measuredWidth();
            if (previous) child.style.setProperty("display", previous, priority);
            else child.style.removeProperty("display");
            if (without < scrollWidth) {
              isolatedOverflow.push({ selector: selector(child), without });
              isolate(child, depth + 1);
            }
          }
        };
        isolate(document.body);
      }
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
      const textOverflow = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && textOverflow.length < 12) {
        const node = walker.currentNode;
        if (!clean(node.nodeValue) || !visible(node.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        if (rects.some((rect) => rect.left < -1 || rect.right > innerWidth + 1)) {
          textOverflow.push({
            parent: node.parentElement.id
              ? "#" + node.parentElement.id
              : node.parentElement.tagName.toLowerCase()
                + (node.parentElement.classList.length
                  ? "." + [...node.parentElement.classList].slice(0, 2).join(".")
                  : ""),
            text: clean(node.nodeValue).slice(0, 100),
            rects: rects.map((rect) => ({
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
            })),
          });
        }
      }
      const accountFields = [...document.querySelectorAll(
        '#control-room input:not([type="hidden"]), #control-room button'
      )].filter(visible).map((element) => ({
        label: element.getAttribute("name") || clean(element.textContent) || element.type,
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
      return {
        hash: location.hash,
        href: location.href,
        path: location.pathname,
        search: location.search,
        title: document.title,
        lang: document.documentElement.lang,
        canonical: document.querySelector('link[rel="canonical"]')?.href || "",
        main: Boolean(document.querySelector("main")),
        mainTextLength: clean(document.querySelector("main")?.innerText).length,
        h1: [...document.querySelectorAll("h1")].map((node) => clean(node.textContent)),
        viewportWidth: innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        scrollWidth,
        overflow,
        isolatedOverflow,
        textOverflow,
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
          projectLegal: {
            status: globalThis.SiteSourceryAbracadabraHostedSession
              ?.getState().projectLegalAuthorityStatus || "",
            checked: document.querySelector(
              '[name="acceptedProjectTerms"]'
            )?.checked === true,
            disabled: document.querySelector(
              '[name="acceptedProjectTerms"]'
            )?.disabled === true,
            saveDisabled: document.querySelector(
              "[data-create-project]"
            )?.disabled === true,
            notice: clean(document.querySelector(
              "[data-project-legal-authority]"
            )?.textContent),
            links: [...document.querySelectorAll(
              '[name="acceptedProjectTerms"] + span a'
            )].map((link) => ({
              href: link.href,
              text: clean(link.textContent),
            })),
            storageBoundary: clean(document.querySelector(
              "[data-project-storage-boundary]"
            )?.textContent),
            storageBoundaryVisible: visible(document.querySelector(
              "[data-project-storage-boundary]"
            )),
          },
        } : null,
      };
    })()`,
  );
}

async function inspectAccessibilityAndLinks(cdp) {
  const [dom, { nodes = [] }] = await Promise.all([
    evaluate(
      cdp,
      `(() => {
        const ids = [...document.querySelectorAll("[id]")]
          .map((element) => element.id)
          .filter(Boolean);
        const duplicateIds = [...new Set(
          ids.filter((id, index) => ids.indexOf(id) !== index)
        )];
        const internalLinks = [...document.querySelectorAll("a[href]")]
          .map((link) => link.href)
          .filter((href) => href.startsWith(location.origin + "/"));
        return {
          duplicateIds,
          imagesMissingAlt: [...document.images]
            .filter((image) => !image.hasAttribute("alt"))
            .map((image) => image.getAttribute("src") || "")
            .slice(0, 12),
          internalLinks,
          mainCount: document.querySelectorAll("main").length,
          mainTargetCount: document.querySelectorAll("main#main").length,
          skipLinkCount: document.querySelectorAll('a[href="#main"]').length,
        };
      })()`,
    ),
    cdp.send("Accessibility.getFullAXTree"),
  ]);
  const interactiveRoles = new Set([
    "button",
    "checkbox",
    "combobox",
    "link",
    "menuitem",
    "radio",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "textbox",
  ]);
  const unnamedInteractive = nodes
    .filter((node) =>
      !node.ignored
      && interactiveRoles.has(String(node.role?.value ?? "").toLowerCase())
      && !String(node.name?.value ?? "").trim()
    )
    .map((node) => String(node.role?.value ?? "unknown"))
    .slice(0, 12);
  return { ...dom, unnamedInteractive };
}

async function inspectReducedMotion(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const milliseconds = (value) => String(value || "")
        .split(",")
        .map((part) => part.trim())
        .map((part) => part.endsWith("ms")
          ? Number.parseFloat(part)
          : Number.parseFloat(part) * 1000)
        .filter(Number.isFinite);
      const offenders = [...document.body.querySelectorAll("*")]
        .map((element) => {
          const style = getComputedStyle(element);
          return {
            animation: style.animationName,
            animationMs: Math.max(0, ...milliseconds(style.animationDuration)),
            selector: element.id
              ? "#" + element.id
              : element.tagName.toLowerCase(),
            transitionMs: Math.max(0, ...milliseconds(style.transitionDuration)),
          };
        })
        .filter((entry) =>
          (entry.animation !== "none" && entry.animationMs > 1)
          || entry.transitionMs > 1
        )
        .slice(0, 12);
      return {
        preferred: matchMedia("(prefers-reduced-motion: reduce)").matches,
        scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        offenders,
      };
    })()`,
  );
}

function snapshotFailures(
  snapshot,
  route,
  viewport,
  { checkHostedApp = true } = {},
) {
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
  if (snapshot.scrollWidth > snapshot.viewportWidth) {
    failures.push(
      `${label}: horizontal overflow ${snapshot.scrollWidth}px > ${snapshot.viewportWidth}px `
      + JSON.stringify({
        elements: snapshot.overflow,
        isolated: snapshot.isolatedOverflow,
        text: snapshot.textOverflow,
      }),
    );
  }
  if (snapshot.brokenImages.length) {
    failures.push(`${label}: broken images ${JSON.stringify(snapshot.brokenImages)}`);
  }
  const expectedCanonical = new URL(route, `${SITE_ORIGIN}/`).href;
  if (snapshot.canonical !== expectedCanonical) {
    failures.push(`${label}: canonical is ${JSON.stringify(snapshot.canonical)}`);
  }
  if (snapshot.app && checkHostedApp) {
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
    const legal = snapshot.app.projectLegal;
    if (
      legal.status !== "ready"
      || legal.checked
      || legal.disabled
      || !legal.saveDisabled
      || !legal.storageBoundaryVisible
      || !legal.storageBoundary.includes(
        "Guest work stays only in this tab"
      )
      || !legal.storageBoundary.includes(
        "Saving sends the project facts and reviewed HTML to the account service"
      )
      || !legal.storageBoundary.includes(
        "Download requires a retained signed-in project"
      )
      || !legal.notice.includes("Guest work stays only in this tab")
      || !legal.notice.includes(
        "Saving sends the project facts and reviewed HTML to the account service"
      )
      || !legal.notice.includes(
        "Download requires a retained signed-in project"
      )
      || legal.links.length !== 3
      || !legal.links.some((link) =>
        link.href === PROJECT_LEGAL_AUTHORITY.documents[0].contentUri
        && link.text.includes(PROJECT_LEGAL_PRIVACY_VERSION))
      || !legal.links.some((link) =>
        link.href === PROJECT_LEGAL_AUTHORITY.documents[1].contentUri
        && link.text.includes(PROJECT_LEGAL_AUTHORITY.documents[1].version))
      || !legal.links.some((link) =>
        link.href === PROJECT_LEGAL_AUTHORITY.documents[2].contentUri
        && link.text.includes(PROJECT_LEGAL_AUTHORITY.documents[2].version))
    ) {
      failures.push(
        `${label}: exact project legal authority did not render fail-closed: `
          + JSON.stringify(legal),
      );
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

async function projectLegalJourney(cdp, server, viewport) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    "payment-paid",
    viewport,
    "project-legal-v3",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) {
    throw new Error("Project-legal browser fixture cookie was rejected.");
  }
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  await waitFor(
    cdp,
    `globalThis.SiteSourceryAbracadabraHostedSession
      ?.getState().phase === "ready"
      && document.querySelector("[data-project-list] button")`,
  );
  await evaluate(
    cdp,
    `(() => {
      const field = document.querySelector('[name="projectName"]');
      field.value = "Browser legal project";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      dispatchEvent(new CustomEvent("abracadabra:versionmade", {
        detail: {
          raw: { businessName: "Browser legal project" },
          result: {
            artifactDigest: ${JSON.stringify("3".repeat(64))},
            html: "<!doctype html><title>Browser legal project</title>"
          }
        }
      }));
      return true;
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector('[data-customer-stage="project"]')
      ?.hidden === false
      && document.querySelector('[name="acceptedProjectTerms"]')
      ?.disabled === false`,
  );
  const authorityReadsBeforeClick = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "GET"
      && entry.pathname === "/api/v1/legal/project-authority",
  ).length;
  const checkboxKeyboardFocused = await activateByKeyboard(
    cdp,
    '[name="acceptedProjectTerms"]',
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-create-project]")?.disabled === false`,
  );
  const authorityReadsAfterCapture = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "GET"
      && entry.pathname === "/api/v1/legal/project-authority",
  ).length;
  const createPath =
    `/api/v1/organizations/${PAID_ORGANIZATION_ID}/projects`;
  const priorCreates = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST"
      && entry.pathname === createPath,
  ).length;
  const saveKeyboardFocused = await activateByKeyboard(
    cdp,
    "[data-create-project]",
  );
  const request = await waitForApiRequest(
    server,
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST"
      && entry.pathname === createPath,
    priorCreates,
  );
  await waitFor(
    cdp,
    `(() => {
      const notice = document.querySelector(
        "[data-project-legal-authority]"
      );
      const checkbox = document.querySelector(
        '[name="acceptedProjectTerms"]'
      );
      return globalThis.SiteSourceryAbracadabraHostedSession
        ?.getState().projectLegalAuthorityStatus === "ready"
        && checkbox?.checked === false
        && document.querySelector("[data-create-project]")?.disabled === true
        && document.activeElement === notice
        && notice?.textContent.includes("reviewed documents changed");
    })()`,
  );
  const afterStale = await evaluate(
    cdp,
    `(() => {
      const notice = document.querySelector(
        "[data-project-legal-authority]"
      );
      const checkbox = document.querySelector(
        '[name="acceptedProjectTerms"]'
      );
      return {
        checked: checkbox.checked,
        noticeFocused: document.activeElement === notice,
        noticeText: notice.textContent.replace(/\\s+/g, " ").trim(),
        saveDisabled: document.querySelector(
          "[data-create-project]"
        ).disabled,
      };
    })()`,
  );
  const recaptureKeyboardFocused = await activateByKeyboard(
    cdp,
    '[name="acceptedProjectTerms"]',
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-create-project]")?.disabled === false`,
  );
  const projectKeyboardFocused = await activateByKeyboard(
    cdp,
    "[data-project-list] button",
  );
  await waitFor(
    cdp,
    `globalThis.SiteSourceryAbracadabraHostedSession
      ?.getState().project?.id === ${JSON.stringify(PAID_PROJECT_ID)}
      && document.querySelector("[data-project-legal-evidence]")
      ?.hidden === false`,
  );
  const retained = await evaluate(
    cdp,
    `(() => {
      const evidence = document.querySelector(
        "[data-project-legal-evidence]"
      );
      const privacy = [...evidence.querySelectorAll("a")].find(
        (link) => link.textContent.includes("Accepted privacy V2")
      );
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        text: evidence.textContent.replace(/\\s+/g, " ").trim(),
        privacyHref: privacy?.href || "",
        privacyText: privacy?.textContent.trim() || "",
      };
    })()`,
  );
  const authorityReadsAfterStale = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "GET"
      && entry.pathname === "/api/v1/legal/project-authority",
  ).length;
  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return {
    afterStale,
    authorityReadsAfterCapture,
    authorityReadsAfterStale,
    authorityReadsBeforeClick,
    checkboxKeyboardFocused,
    projectKeyboardFocused,
    recaptureKeyboardFocused,
    request,
    retained,
    saveKeyboardFocused,
  };
}

async function paidCustomBuildJourney(cdp, server, viewport, mode) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    mode,
    viewport,
    "paid-custom-build",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) throw new Error("Paid browser fixture cookie was rejected.");
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  const expectedCompletionAuthority = mode === "completion"
    ? "terminal"
    : "open";
  const expectedOwnerProgress = mode === "completion"
    ? "Verified completion is immutable"
    : "Action needed from you";
  try {
    await waitFor(
      cdp,
      `document.querySelector("[data-owner-custom-build-work]")?.hidden === false
        && document.querySelectorAll("[data-paid-custom-build-job]").length === 1
        && document.querySelector("[data-owner-job-progress]")
          ?.getAttribute("data-owner-progress-completion-authority") === ${JSON.stringify(
            expectedCompletionAuthority,
          )}
        && document.querySelector("[data-owner-job-progress]")?.textContent
          .includes(${JSON.stringify(expectedOwnerProgress)})
        && document.querySelector("[data-owner-job-change-completion]")
          ?.getAttribute("data-owner-change-completion-authority") === ${JSON.stringify(
            expectedCompletionAuthority,
          )}
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
        ownerStatus: document.querySelector(
          "[data-owner-custom-build-work] .customer-owner-custom-build-status"
        )?.textContent.trim(),
        ownerJobCount: document.querySelectorAll(
          "[data-paid-custom-build-job]"
        ).length,
        ownerProgressText: document.querySelector("[data-owner-job-progress]")
          ?.textContent.replace(/\\s+/g, " ").trim().slice(0, 500),
        ownerChangeText: document.querySelector(
          "[data-owner-job-change-completion]"
        )?.textContent.replace(/\\s+/g, " ").trim().slice(0, 1000),
        ownerChangeAuthority: document.querySelector(
          "[data-owner-job-change-completion]"
        )?.getAttribute("data-owner-change-completion-authority"),
        ownerFinalText: document.querySelector(
          "[data-owner-custom-build-final]"
        )?.textContent.replace(/\\s+/g, " ").trim().slice(0, 500),
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
        && document.querySelector("[data-customer-custom-build-progress]")
          ?.getAttribute("data-customer-progress-completion-authority") === ${JSON.stringify(
            expectedCompletionAuthority,
          )}
        && document.querySelector("[data-custom-build-active-request]")?.textContent
          .includes("Choose the approved contact wording")
        && document.querySelector("[data-customer-custom-build-change-completion]")
          ?.getAttribute("data-customer-change-completion-authority") === ${JSON.stringify(
            expectedCompletionAuthority,
          )}
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
        ownerProgressAuthority: ownerProgress.getAttribute(
          "data-owner-progress-completion-authority"
        ),
        ownerChangeAuthority: ownerChange.getAttribute(
          "data-owner-change-completion-authority"
        ),
        customerProgressAuthority: customerProgress.getAttribute(
          "data-customer-progress-completion-authority"
        ),
        customerChangeAuthority: customerChange.getAttribute(
          "data-customer-change-completion-authority"
        ),
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
      server.customerChangeCompletionReadCount(fixtureToken) < 2
      || server.ownerChangeCompletionReadCount(fixtureToken) < 2
    )
    && Date.now() < changeRefreshDeadline
  ) {
    await delay(25);
  }
  if (
    server.customerChangeCompletionReadCount(fixtureToken) < 2
    || server.ownerChangeCompletionReadCount(fixtureToken) < 2
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
    server.paidJobReadCount(fixtureToken) < 2
    && Date.now() < refreshDeadline
  ) {
    await delay(25);
  }
  if (server.paidJobReadCount(fixtureToken) < 2) {
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

async function activateByKeyboard(cdp, selector) {
  const focused = await evaluate(
    cdp,
    `(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control || control.disabled) return false;
      control.focus();
      return document.activeElement === control;
    })()`,
  );
  if (!focused) return false;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    text: " ",
    unmodifiedText: " ",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    nativeVirtualKeyCode: 32,
  });
  return true;
}

async function waitForApiRequest(server, predicate, priorCount, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = server.apiRequests.filter(predicate);
    if (matches.length > priorCount) return matches.at(-1);
    await delay(25);
  }
  return null;
}

async function alakazamPublicationJourney(cdp, server, viewport) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    "publication",
    viewport,
    "alakazam-publication",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) {
    throw new Error("Alakazam publication fixture cookie was rejected.");
  }
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  await waitFor(
    cdp,
    `document.querySelector("[data-project-list] button")`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-project-list] button").click()`,
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-alakazam-publication]")?.hidden === false
      && document.querySelectorAll(
        "[data-alakazam-publication-action]:not(:disabled)"
      ).length === 3`,
  );
  const initial = await evaluate(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-alakazam-publication]");
      const visible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && rect.width > 0
          && rect.height > 0;
      };
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        text: panel.textContent.replace(/\\s+/g, " ").trim(),
        historyCount: panel.querySelectorAll(
          ".customer-alakazam-publication-list li"
        ).length,
        controls: [...panel.querySelectorAll(
          "[data-alakazam-publication-action]"
        )].filter(visible).map((element) => ({
          action: element.getAttribute("data-alakazam-publication-action"),
          disabled: element.disabled,
          height: Math.round(element.getBoundingClientRect().height * 10) / 10,
        })),
      };
    })()`,
  );
  const path =
    `/api/v1/projects/${PAID_PROJECT_ID}/alakazam/publication-commands`;
  const actions = [];
  for (const action of ["publish", "rollback", "unpublish"]) {
    const prior = server.apiRequests.filter(
      (entry) => entry.paidFixtureToken === fixtureToken
        && entry.method === "POST"
        && entry.pathname === path,
    ).length;
    const keyboardFocused = await activateByKeyboard(
      cdp,
      `[data-alakazam-publication-action="${action}"]`,
    );
    const request = keyboardFocused
      ? await waitForApiRequest(
          server,
          (entry) => entry.paidFixtureToken === fixtureToken
            && entry.method === "POST"
            && entry.pathname === path,
          prior,
        )
      : null;
    if (request) {
      await waitFor(
        cdp,
        `document.querySelector("[data-alakazam-publication-status]")
          ?.textContent.includes("Authorization recorded. Publication remains held.")
          && document.querySelector("[data-alakazam-publication]")
            ?.contains(document.activeElement)`,
      );
    }
    actions.push({
      action,
      keyboardFocused,
      request,
      retained: await evaluate(
        cdp,
        `(() => {
          const panel = document.querySelector("[data-alakazam-publication]");
          return {
            text: panel.textContent.replace(/\\s+/g, " ").trim(),
            statusFocused: panel.contains(document.activeElement),
            enabledActions: [...panel.querySelectorAll(
              "[data-alakazam-publication-action]"
            )].filter((element) => !element.disabled).length,
          };
        })()`,
      ),
    });
  }
  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return { actions, initial };
}

async function customBuildChangePaymentJourney(
  cdp,
  server,
  viewport,
  mode,
  checkoutNavigations,
) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    mode,
    viewport,
    "change-payment",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) throw new Error("Purpose-1 browser fixture cookie was rejected.");
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  await waitFor(
    cdp,
    `document.querySelector("[data-owner-custom-build-work]")?.hidden === false
      && document.querySelectorAll("[data-paid-custom-build-job]").length === 1
      && document.querySelector("[data-project-list] button")`,
  );
  await evaluate(
    cdp,
    `document.querySelector("[data-project-list] button").click()`,
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-customer-custom-build-change-completion]")
      ?.hidden === false
      && document.querySelector("[data-customer-custom-build-change-completion]")
        ?.textContent.includes(${JSON.stringify(
          mode === "payment-paid"
            ? "approved Custom build is in progress"
            : "accepted and waiting for confirmed payment",
        )})`,
  );
  await waitFor(
    cdp,
    mode === "payment-customer-held"
      ? `document.querySelector("[data-customer-custom-build-change-completion]")
          ?.textContent.toLowerCase().includes("held or unavailable")`
      : `document.querySelector("[data-customer-custom-build-change-payment]")
          ?.getAttribute("data-customer-custom-build-change-payment") === ${JSON.stringify(
            mode === "payment-paid"
              ? "paid"
              : mode === "payment-owner-uncertain"
                ? "reconciliation_required"
                : "checkout_available",
          )}`,
  );
  if (mode === "payment-owner-uncertain") {
    const ownerDeadline = Date.now() + 5000;
    while (
      server.ownerChangePaymentReadCount(fixtureToken) < 1
      && Date.now() < ownerDeadline
    ) await delay(25);
    await delay(100);
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
      const customerPanel = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const payment = document.querySelector(
        "[data-customer-custom-build-change-payment]"
      );
      const customerCheckout = document.querySelector(
        "[data-customer-custom-build-change-checkout]"
      );
      const ownerPayment = document.querySelector(
        "[data-owner-custom-build-change-payments]"
      );
      const ownerReconcile = document.querySelector(
        "[data-owner-custom-build-change-payment-reconcile]"
      );
      const controls = [
        ...customerPanel.querySelectorAll("button, a, summary"),
        ...(ownerPayment ? ownerPayment.querySelectorAll("button, a, summary") : [])
      ].filter(visible).map((element) => ({
        selector: element.hasAttribute("data-customer-custom-build-change-checkout")
          ? "customer-change-checkout"
          : element.hasAttribute("data-owner-custom-build-change-payment-reconcile")
            ? "owner-change-reconcile"
            : element.textContent.trim().replace(/\\s+/g, " ").slice(0, 80),
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
      const fields = [
        ...(payment ? payment.querySelectorAll("input, textarea, select") : []),
        ...(ownerPayment ? ownerPayment.querySelectorAll("input, textarea, select") : [])
      ];
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        customerText: customerPanel.textContent.replace(/\\s+/g, " ").trim(),
        customerStatusFocused: document.activeElement === customerPanel.querySelector(
          ".customer-custom-build-change-status"
        ),
        paymentState: payment?.getAttribute(
          "data-customer-custom-build-change-payment"
        ) || "",
        paymentVisible: visible(payment),
        checkoutVisible: visible(customerCheckout),
        checkoutCount: document.querySelectorAll(
          "[data-customer-custom-build-change-checkout]"
        ).length,
        retainedCheckoutCount: document.querySelectorAll(
          "[data-customer-custom-build-change-checkout-ready]"
        ).length,
        firstPaymentCount: document.querySelectorAll(
          "[data-custom-build-invoice]"
        ).length,
        completionControlCount: [...document.querySelectorAll(
          "[data-customer-custom-build-completion], [data-owner-completion-control]"
        )].filter((element) => visible(element) && Boolean(
          element.querySelector(
            "[data-owner-completion-form], [data-completion-evidence-control]"
          )
        )).length,
        ownerVisible: visible(ownerPayment),
        ownerText: ownerPayment
          ? ownerPayment.textContent.replace(/\\s+/g, " ").trim()
          : "",
        ownerReconcileVisible: visible(ownerReconcile),
        ownerReconcileKind: ownerReconcile?.getAttribute(
          "data-owner-custom-build-change-payment-reconcile-kind"
        ) || "",
        ownerReconcileCount: document.querySelectorAll(
          "[data-owner-custom-build-change-payment-reconcile]"
        ).length,
        moneyOrMarkPaidFields: fields.map((field) => field.name).filter(
          (name) => /amount|price|tax|refund|credit|mark.?paid/iu.test(name)
        ),
        controls,
      };
    })()`,
  );

  let action = null;
  if (mode === "payment-checkout" || mode === "payment-customer-uncertain") {
    const path =
      `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-invoices/`
      + `${PAID_CHANGE_INVOICE_ID}/checkout-command`;
    const prior = server.apiRequests.filter(
      (entry) => entry.paidFixtureToken === fixtureToken
        && entry.method === "POST"
        && entry.pathname === path,
    ).length;
    const navigationCount = checkoutNavigations.length;
    const keyboardFocused = await activateByKeyboard(
      cdp,
      "[data-customer-custom-build-change-checkout]",
    );
    const request = await waitForApiRequest(
      server,
      (entry) => entry.paidFixtureToken === fixtureToken
        && entry.method === "POST"
        && entry.pathname === path,
      prior,
    );
    if (mode === "payment-checkout") {
      const deadline = Date.now() + 5000;
      while (
        checkoutNavigations.length === navigationCount
        && Date.now() < deadline
      ) await delay(25);
    } else {
      await waitFor(
        cdp,
        `document.querySelector("[data-customer-custom-build-change-completion]")
          ?.textContent.includes("Do not try another payment")`,
      );
    }
    action = {
      keyboardFocused,
      request,
      navigation: checkoutNavigations.slice(navigationCount).at(-1) || "",
      retained: mode === "payment-customer-uncertain"
        ? await evaluate(
            cdp,
            `(() => {
              const panel = document.querySelector(
                "[data-customer-custom-build-change-completion]"
              );
              const status = panel.querySelector(
                ".customer-custom-build-change-status"
              );
              return {
                text: panel.textContent.replace(/\\s+/g, " ").trim(),
                paymentPresent: Boolean(panel.querySelector(
                  "[data-customer-custom-build-change-payment]"
                )),
                checkoutPresent: Boolean(panel.querySelector(
                  "[data-customer-custom-build-change-checkout]"
                )),
                statusFocused: document.activeElement === status,
              };
            })()`,
          )
        : null,
    };
  } else if (mode === "payment-customer-malformed") {
    const prior = server.customerChangeInvoiceReadCount(fixtureToken);
    const keyboardFocused = await activateByKeyboard(
      cdp,
      "[data-customer-change-completion-refresh]",
    );
    const deadline = Date.now() + 5000;
    while (
      server.customerChangeInvoiceReadCount(fixtureToken) === prior
      && Date.now() < deadline
    ) await delay(25);
    await delay(150);
    action = {
      keyboardFocused,
      retained: await evaluate(
        cdp,
        `(() => {
          const panel = document.querySelector(
            "[data-customer-custom-build-change-completion]"
          );
          const status = panel.querySelector(
            ".customer-custom-build-change-status"
          );
          return {
            text: panel.textContent.replace(/\\s+/g, " ").trim(),
            paymentPresent: Boolean(panel.querySelector(
              "[data-customer-custom-build-change-payment]"
            )),
            checkoutPresent: Boolean(panel.querySelector(
              "[data-customer-custom-build-change-checkout]"
            )),
            statusFocused: document.activeElement === status,
          };
        })()`,
      ),
    };
  } else if (mode === "payment-owner-uncertain") {
    const path =
      `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/`
      + `change-payments/${PAID_CHANGE_ATTEMPT_ID}/checkout-reconciliation`;
    const prior = server.apiRequests.filter(
      (entry) => entry.paidFixtureToken === fixtureToken
        && entry.method === "POST"
        && entry.pathname === path,
    ).length;
    const keyboardFocused = await activateByKeyboard(
      cdp,
      "[data-owner-custom-build-change-payment-reconcile]",
    );
    const request = keyboardFocused
      ? await waitForApiRequest(
          server,
          (entry) => entry.paidFixtureToken === fixtureToken
            && entry.method === "POST"
            && entry.pathname === path,
          prior,
        )
      : null;
    if (request) {
      await waitFor(
        cdp,
        `(() => {
          const panel = document.querySelector(
            "[data-owner-custom-build-change-payments]"
          );
          return panel?.textContent.includes(
            "reconciled and retained for the customer"
          ) && panel.contains(document.activeElement);
        })()`,
      );
    }
    action = {
      keyboardFocused,
      request,
      retained: await evaluate(
        cdp,
        `(() => {
          const panel = document.querySelector(
            "[data-owner-custom-build-change-payments]"
          );
          return {
            text: panel?.textContent.replace(/\\s+/g, " ").trim() || "",
            reconcilePresent: Boolean(panel?.querySelector(
              "[data-owner-custom-build-change-payment-reconcile]"
            )),
            reconcileKind: panel?.querySelector(
              "[data-owner-custom-build-change-payment-reconcile]"
            )?.getAttribute(
              "data-owner-custom-build-change-payment-reconcile-kind"
            ) || "",
            readyPresent: Boolean(panel?.querySelector(
              "[data-customer-custom-build-change-checkout-ready]"
            )),
            statusFocused: Boolean(panel?.contains(document.activeElement)),
          };
        })()`,
      ),
    };
  }

  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return { action, initial };
}

async function customBuildFinalHandoffJourney(
  cdp,
  server,
  viewport,
  mode,
) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    mode,
    viewport,
    "final-handoff",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) throw new Error("Final-handoff fixture cookie was rejected.");
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  await waitFor(
    cdp,
    `document.querySelectorAll("[data-paid-custom-build-job]").length === 1
      && document.querySelector("[data-owner-custom-build-handoff-form]")
      && !document.querySelector("[data-owner-custom-build-final-payment]")`,
  );
  await evaluate(
    cdp,
    `(() => {
      const card = document.querySelector("[data-paid-custom-build-job]");
      if (!card.open) card.querySelector("summary").click();
      return card.open;
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-paid-custom-build-job]")?.open === true`,
  );
  const initialOwner = await evaluate(
    cdp,
    `(() => {
      const section = document.querySelector("[data-owner-custom-build-final]");
      const form = section.querySelector("[data-owner-custom-build-handoff-form]");
      const controls = [...section.querySelectorAll("button, input, textarea")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden"
            && rect.width > 0 && rect.height > 0;
        })
        .map((element) => ({
          name: element.name || element.textContent.trim().replace(/\\s+/g, " "),
          height: Math.round(element.getBoundingClientRect().height * 10) / 10,
        }));
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        formVisible: Boolean(form),
        paymentProjectionVisible: Boolean(section.querySelector(
          "[data-owner-custom-build-final-payment]"
        )),
        text: section.textContent.replace(/\\s+/g, " ").trim(),
        controls,
      };
    })()`,
  );
  const ownerPaymentRead = server.apiRequests.findLast((entry) =>
    entry.method === "GET"
      && entry.paidFixtureToken === fixtureToken
      && entry.pathname ===
        `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-payments`
  ) || null;
  const ownerReadinessRead = server.apiRequests.findLast((entry) =>
    entry.method === "GET"
      && entry.paidFixtureToken === fixtureToken
      && entry.pathname ===
        `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-handoff`
  ) || null;
  const handoffPath =
    `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/handoff`;
  const priorHandoffWrites = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST"
      && entry.pathname === handoffPath,
  ).length;
  const ownerKeyboardFocused = await activateByKeyboard(
    cdp,
    "[data-owner-custom-build-handoff-form] button[type=submit]",
  );
  const ownerRequest = ownerKeyboardFocused
    ? await waitForApiRequest(
        server,
        (entry) => entry.paidFixtureToken === fixtureToken
          && entry.method === "POST"
          && entry.pathname === handoffPath,
        priorHandoffWrites,
      )
    : null;
  await waitFor(
    cdp,
    `document.querySelector("[data-owner-custom-build-final]")?.textContent
      .includes("Immutable handoff created. The 30-day workmanship window now begins.")
      && document.querySelector("[data-owner-custom-build-final]")?.textContent
        .includes("Handoff is immutable")
      && !document.querySelector("[data-owner-custom-build-handoff-form]")`,
  );
  const ownerAfter = await evaluate(
    cdp,
    `(() => {
      const section = document.querySelector("[data-owner-custom-build-final]");
      return {
        text: section.textContent.replace(/\\s+/g, " ").trim(),
        handoffFormCount: section.querySelectorAll(
          "[data-owner-custom-build-handoff-form]"
        ).length,
        paymentProjectionCount: section.querySelectorAll(
          "[data-owner-custom-build-final-payment]"
        ).length,
      };
    })()`,
  );

  await waitFor(cdp, `document.querySelector("[data-project-list] button")`);
  await evaluate(
    cdp,
    `document.querySelector("[data-project-list] button").click()`,
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-customer-custom-build-handoff-receipt=ready]")
      && document.querySelector("[data-customer-progress-completion-authority=terminal]")
      && document.querySelector("[data-customer-change-completion-authority=terminal]")`,
  );
  const customer = await evaluate(
    cdp,
    `(() => {
      const visible = (element) => {
        if (!element || element.hidden) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden"
          && rect.width > 0 && rect.height > 0;
      };
      const finalPanel = document.querySelector(
        "[data-customer-custom-build-final]"
      );
      const progress = document.querySelector(
        "[data-customer-custom-build-progress]"
      );
      const change = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const owner = document.querySelector("[data-owner-custom-build-work]");
      const controls = [
        ...finalPanel.querySelectorAll("button, a, input, textarea"),
        ...progress.querySelectorAll("button, a, input, textarea"),
        ...change.querySelectorAll("button, a, input, textarea")
      ].filter(visible).map((element) => ({
        text: (element.name || element.textContent).trim().replace(/\\s+/g, " "),
        height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      }));
      const finalText = finalPanel.textContent.replace(/\\s+/g, " ").trim();
      const changeText = change.textContent.replace(/\\s+/g, " ").trim();
      const handoff = finalPanel.querySelector(
        "[data-customer-custom-build-handoff]"
      );
      const workmanshipFacts = Object.fromEntries(
        [...handoff.querySelectorAll(".customer-alakazam-fact")].map((row) => [
          row.querySelector("dt")?.textContent.trim() || "",
          row.querySelector("dd")?.textContent.trim() || ""
        ])
      );
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        finalText,
        changeText,
        progressAuthority: progress.getAttribute(
          "data-customer-progress-completion-authority"
        ),
        changeAuthority: change.getAttribute(
          "data-customer-change-completion-authority"
        ),
        responseFormCount: progress.querySelectorAll(
          "[data-custom-build-response-form]"
        ).length,
        customerChangeMutationCount: [...change.querySelectorAll("button, form")]
          .filter((element) => /Accept exact added work|Decline added work|Continue to secure payment/iu.test(
            element.textContent
          )).length,
        ownerProgressMutationCount: owner.querySelectorAll(
          "[data-owner-progress-form], [data-owner-request-form], [data-owner-resolution-form]"
        ).length,
        ownerChangeMutationCount: owner.querySelectorAll(
          "[data-owner-change-order-form], [data-owner-change-order-void], [data-owner-change-order-expire], [data-owner-completion-evidence-form], [data-owner-completion-form], [data-owner-custom-build-change-payment-reconcile]"
        ).length,
        receiptReady: finalPanel.querySelector(
          "[data-customer-custom-build-handoff-receipt]"
        )?.getAttribute("data-customer-custom-build-handoff-receipt") || "",
        deliveredItems: [...finalPanel.querySelectorAll(
          ".customer-custom-build-completion-checks li"
        )].map((entry) => entry.textContent.trim()),
        identifierLeaks: [
          ${JSON.stringify(PAID_JOB_ID)},
          ${JSON.stringify(PAID_FINAL_DOCUMENT_ID)},
          ${JSON.stringify(PAID_FINAL_HANDOFF_RECEIPT_ID)},
          "cs_test_",
          "pi_",
          "ch_",
          "cus_",
          "evt_"
        ].filter((needle) => finalText.includes(needle)),
        expectedHandoffAt: new Date(
          ${JSON.stringify(PAID_FINAL_HANDED_OFF_AT)}
        ).toLocaleString(),
        expectedWorkmanshipEndsAt: new Date(
          ${JSON.stringify(PAID_FINAL_WORKMANSHIP_ENDS_AT)}
        ).toLocaleString(),
        workmanshipFacts,
        workmanshipCoverageCopy: handoff.textContent.includes(
          "30-day [start,end) window starts at handoff"
        ),
        controls,
      };
    })()`,
  );

  const documentReadCount = server.customerHandoffDocumentReadCount(
    fixtureToken,
  );
  const documentKeyboardFocused = await activateByKeyboard(
    cdp,
    "[data-customer-custom-build-handoff-document]",
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-customer-custom-build-final]")
      ?.getAttribute("aria-busy") === "true"`,
  );
  const documentBusy = await evaluate(
    cdp,
    `document.querySelector("[data-customer-custom-build-final]")
      .textContent.replace(/\\s+/g, " ").trim()`,
  );
  const documentDeadline = Date.now() + 5000;
  while (
    server.customerHandoffDocumentReadCount(fixtureToken) <= documentReadCount
    && Date.now() < documentDeadline
  ) await delay(25);
  await waitFor(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-customer-custom-build-final]");
      return panel?.querySelector(
        "[data-customer-custom-build-handoff-receipt=ready]"
      ) && panel.querySelector(".customer-owner-quote-form-error")
        && panel.contains(document.activeElement);
    })()`,
  );
  const retained = await evaluate(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-customer-custom-build-final]");
      const status = panel.querySelector(".customer-custom-build-final-status");
      return {
        text: panel.textContent.replace(/\\s+/g, " ").trim(),
        receiptReady: panel.querySelector(
          "[data-customer-custom-build-handoff-receipt]"
        )?.getAttribute("data-customer-custom-build-handoff-receipt") || "",
        deliveredItemCount: panel.querySelectorAll(
          ".customer-custom-build-completion-checks li"
        ).length,
        error: panel.querySelector(".customer-owner-quote-form-error")
          ?.textContent.trim() || "",
        statusFocused: document.activeElement === status,
      };
    })()`,
  );
  const finalReadCount = server.customerFinalReadCount(fixtureToken);
  const finalRefreshKeyboardFocused = await activateByKeyboard(
    cdp,
    "[data-customer-custom-build-final-refresh]",
  );
  await waitFor(
    cdp,
    `document.querySelector("[data-customer-custom-build-final]")
      ?.getAttribute("aria-busy") === "true"`,
  );
  const finalBusy = await evaluate(
    cdp,
    `document.querySelector("[data-customer-custom-build-final]")
      .textContent.replace(/\\s+/g, " ").trim()`,
  );
  const finalReadDeadline = Date.now() + 5000;
  while (
    server.customerFinalReadCount(fixtureToken) <= finalReadCount
    && Date.now() < finalReadDeadline
  ) await delay(25);
  await waitFor(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-customer-custom-build-final]");
      return panel?.querySelector(
        "[data-customer-custom-build-handoff-receipt=ready]"
      ) && panel.querySelector(".customer-owner-quote-form-error")
        && panel.contains(document.activeElement);
    })()`,
  );
  const retainedFinal = await evaluate(
    cdp,
    `(() => {
      const panel = document.querySelector("[data-customer-custom-build-final]");
      const status = panel.querySelector(".customer-custom-build-final-status");
      return {
        text: panel.textContent.replace(/\\s+/g, " ").trim(),
        receiptReady: panel.querySelector(
          "[data-customer-custom-build-handoff-receipt]"
        )?.getAttribute("data-customer-custom-build-handoff-receipt") || "",
        deliveredItems: [...panel.querySelectorAll(
          ".customer-custom-build-completion-checks li"
        )].map((entry) => entry.textContent.trim()),
        error: panel.querySelector(".customer-owner-quote-form-error")
          ?.textContent.trim() || "",
        statusFocused: document.activeElement === status,
      };
    })()`,
  );
  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return {
    customer,
    documentBusy,
    documentKeyboardFocused,
    finalBusy,
    finalRefreshKeyboardFocused,
    initialOwner,
    ownerAfter,
    ownerKeyboardFocused,
    ownerPaymentRead,
    ownerReadinessRead,
    ownerRequest,
    retained,
    retainedFinal,
  };
}

async function customBuildFinalAuthorityRaceJourney(
  cdp,
  server,
  viewport,
) {
  await isolatePaidJourney(cdp);
  const fixtureToken = server.beginPaidFixture(
    "final-race",
    viewport,
    "final-authority-race",
  );
  await cdp.send("Storage.clearDataForOrigin", {
    origin: server.origin,
    storageTypes: "all",
  });
  const cookie = await cdp.send("Network.setCookie", {
    name: PAID_FIXTURE_COOKIE,
    value: fixtureToken,
    url: `${server.origin}/`,
    httpOnly: true,
    sameSite: "Strict",
  });
  if (!cookie.success) throw new Error("Final-authority race cookie was rejected.");
  await setViewport(cdp, viewport);
  await navigate(cdp, `${server.origin}/abracadabra/app/`);
  await openHostedAccount(cdp);
  await waitFor(cdp, `document.querySelector("[data-project-list] button")`);
  await evaluate(
    cdp,
    `document.querySelector("[data-project-list] button").click()`,
  );
  await waitFor(
    cdp,
    `document.querySelector(
      "[data-customer-progress-completion-authority=unknown]"
    ) && document.querySelector("[data-custom-build-active-request]")`,
  );
  const unknown = await evaluate(
    cdp,
    `(() => {
      const progress = document.querySelector(
        "[data-customer-custom-build-progress]"
      );
      const change = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      return {
        progressAuthority: progress.getAttribute(
          "data-customer-progress-completion-authority"
        ),
        responseForms: progress.querySelectorAll(
          "[data-custom-build-response-form]"
        ).length,
        changeAuthority: change.getAttribute(
          "data-customer-change-completion-authority"
        ),
        changeDecisionButtons: [...change.querySelectorAll("button")].filter(
          (button) => /Accept exact added work|Decline added work/iu.test(
            button.textContent
          )
        ).length,
      };
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector(
      "[data-customer-change-completion-authority=open]"
    ) && document.querySelector("[data-custom-build-response-form]")
      && [...document.querySelectorAll(
        "[data-customer-custom-build-change-completion] button"
      )].some((button) => button.textContent.includes("Accept exact added work"))`,
  );
  const open = await evaluate(
    cdp,
    `(() => {
      const progress = document.querySelector(
        "[data-customer-custom-build-progress]"
      );
      const change = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const buttons = [...change.querySelectorAll("button")];
      const accept = buttons.find((button) =>
        button.textContent.includes("Accept exact added work")
      );
      const acceptCheck = accept?.parentElement?.querySelector(
        'input[type="checkbox"]'
      );
      globalThis.__ssStaleFinalAuthorityControls = {
        accept,
        acceptCheck,
        responseForm: progress.querySelector("[data-custom-build-response-form]")
      };
      return {
        progressAuthority: progress.getAttribute(
          "data-customer-progress-completion-authority"
        ),
        changeAuthority: change.getAttribute(
          "data-customer-change-completion-authority"
        ),
        responseForms: progress.querySelectorAll(
          "[data-custom-build-response-form]"
        ).length,
        acceptButtons: accept ? 1 : 0,
      };
    })()`,
  );
  await waitFor(
    cdp,
    `document.querySelector(
      "[data-customer-progress-completion-authority=terminal]"
    ) && document.querySelector(
      "[data-customer-change-completion-authority=terminal]"
    ) && !document.querySelector("[data-custom-build-response-form]")
      && ![...document.querySelectorAll(
        "[data-customer-custom-build-change-completion] button"
      )].some((button) => /Accept exact added work|Decline added work/iu.test(
        button.textContent
      )) && document.querySelector(
        "[data-owner-progress-completion-authority=terminal]"
      ) && document.querySelector(
        "[data-owner-change-completion-authority=terminal]"
      )`,
  );
  const priorMutationWrites = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST",
  ).length;
  const priorUnexpectedMutationWrites = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST"
      && !entry.expectedWrite,
  ).length;
  const terminal = await evaluate(
    cdp,
    `(() => {
      const retained = globalThis.__ssStaleFinalAuthorityControls || {};
      if (retained.acceptCheck && retained.accept) {
        retained.acceptCheck.checked = true;
        retained.acceptCheck.dispatchEvent(new Event("change", { bubbles: true }));
        retained.accept.click();
      }
      if (retained.responseForm) {
        const note = retained.responseForm.querySelector('[name="responseNote"]');
        if (note) note.value = "This stale response must never be sent.";
        retained.responseForm.dispatchEvent(new Event("submit", {
          bubbles: true,
          cancelable: true
        }));
      }
      const progress = document.querySelector(
        "[data-customer-custom-build-progress]"
      );
      const change = document.querySelector(
        "[data-customer-custom-build-change-completion]"
      );
      const owner = document.querySelector("[data-owner-custom-build-work]");
      const ownerProgress = owner.querySelector("[data-owner-job-progress]");
      const ownerChange = owner.querySelector(
        "[data-owner-job-change-completion]"
      );
      return {
        viewportWidth: innerWidth,
        scrollWidth: Math.max(
          document.body.scrollWidth,
          document.documentElement.scrollWidth
        ),
        progressAuthority: progress.getAttribute(
          "data-customer-progress-completion-authority"
        ),
        changeAuthority: change.getAttribute(
          "data-customer-change-completion-authority"
        ),
        responseForms: progress.querySelectorAll(
          "[data-custom-build-response-form]"
        ).length,
        changeDecisionButtons: [...change.querySelectorAll("button")].filter(
          (button) => /Accept exact added work|Decline added work/iu.test(
            button.textContent
          )
        ).length,
        customerReadOnlyMarker: change.hasAttribute(
          "data-customer-change-completion-read-only"
        ),
        customerHistoryVisible: Boolean(change.querySelector(
          "[data-customer-change-order-read-only]"
        )),
        customerRefreshCount: document.querySelectorAll(
          "[data-customer-change-completion-refresh], [data-customer-custom-build-final-refresh]"
        ).length,
        progressHistoryVisible: Boolean(progress.querySelector(
          "[data-custom-build-request-read-only]"
        )),
        ownerProgressAuthority: ownerProgress.getAttribute(
          "data-owner-progress-completion-authority"
        ),
        ownerChangeAuthority: ownerChange.getAttribute(
          "data-owner-change-completion-authority"
        ),
        ownerReadOnlyMarkers: owner.querySelectorAll(
          "[data-owner-progress-read-only], [data-owner-change-completion-read-only]"
        ).length,
        ownerMutationForms: owner.querySelectorAll(
          "[data-owner-progress-form], [data-owner-request-form], [data-owner-resolution-form], [data-owner-change-order-form], [data-owner-change-order-void], [data-owner-change-order-expire], [data-owner-completion-evidence-form], [data-owner-completion-form], [data-owner-custom-build-change-payment-reconcile]"
        ).length,
        ownerHistoryVisible: Boolean(owner.querySelector(
          "[data-owner-active-request], [data-owner-change-order-read-only]"
        )),
        ownerRefreshCount: owner.querySelectorAll(
          "[data-owner-change-completion-refresh], [data-owner-custom-build-final-refresh]"
        ).length,
        changeReadOnlyCopy: change.textContent.includes(
          "Verified completion is immutable"
        ),
      };
    })()`,
  );
  await delay(150);
  const mutationWrites = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST",
  ).length - priorMutationWrites;
  const unexpectedMutationWrites = server.apiRequests.filter(
    (entry) => entry.paidFixtureToken === fixtureToken
      && entry.method === "POST"
      && !entry.expectedWrite,
  ).length - priorUnexpectedMutationWrites;
  await cdp.send("Network.deleteCookies", {
    name: PAID_FIXTURE_COOKIE,
    url: `${server.origin}/`,
  });
  return {
    mutationWrites,
    open,
    terminal,
    unexpectedMutationWrites,
    unknown,
  };
}

const preparedArtifact = await prepareBrowserAuditArtifact({
  plan: ARTIFACT_PLAN,
});
console.log(
  preparedArtifact.mode === "finalized"
    ? `Browser audit using verified finalized artifact at ${preparedArtifact.hostedRoot}`
    : `Browser audit using rebuilt held artifact at ${preparedArtifact.hostedRoot}`,
);
const browser = await browserPath();
const server = await startServer();
const processState = { exited: false, stderr: "" };
let profile = null;
let child = null;
let cdp;
let primaryFailure = null;
const failures = [];
const browserErrors = [];
const checkoutNavigations = [];
const documentNavigations = [];

function waitForChildExit(milliseconds) {
  if (!child || processState.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once("exit", onExit);
  });
}

async function stopBrowserProcess() {
  if (!child || processState.exited) return;
  const gracefulExit = waitForChildExit(2000);
  child.kill("SIGTERM");
  const exitedGracefully = await gracefulExit;
  if (!exitedGracefully && !processState.exited) {
    const forcedExit = waitForChildExit(2000);
    child.kill("SIGKILL");
    const exitedForcibly = await forcedExit;
    if (!exitedForcibly && !processState.exited) {
      const error = new Error(
        "Reviewed browser remained alive after SIGKILL."
      );
      error.code = "REVIEWED_BROWSER_EXIT_TIMEOUT";
      throw error;
    }
  }
}

try {
  profile = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-current-browser-"),
  );
  const port = await freePort();
  const browserArguments = [
    "--headless",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
  ];
  browserArguments.push(...reviewedLinuxCiSandboxArguments({
    origin: server.origin,
  }));
  browserArguments.push(
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  );
  child = spawn(browser, browserArguments, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    processState.stderr = (
      processState.stderr + chunk
    ).slice(-32768);
  });
  child.once("error", (error) => {
    processState.exited = true;
    processState.stderr = (
      processState.stderr
      + `\nBrowser process error: ${error?.code ?? "SPAWN_FAILED"}`
    ).slice(-32768);
  });
  child.once("exit", () => {
    processState.exited = true;
  });
  cdp = new Cdp(await pageSocket(port, processState));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push({
      text: exceptionDetails?.exception?.description
        || exceptionDetails?.text
        || "Unknown browser exception",
      url: "",
    });
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error") {
      browserErrors.push({
        text: entry.text || "Unknown browser log error",
        url: entry.url || "",
      });
    }
  });
  cdp.on("Network.requestWillBeSent", ({ request, type }) => {
    if (type === "Document") documentNavigations.push(request?.url ?? "");
    if (
      type === "Document"
      && String(request?.url || "").startsWith("https://checkout.stripe.com/")
    ) checkoutNavigations.push(request.url);
  });
  cdp.on("Fetch.requestPaused", ({ requestId, request, resourceType }) => {
    const checkout = resourceType === "Document"
      && String(request?.url || "").startsWith(
        "https://checkout.stripe.com/"
      );
    const command = checkout
      ? cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{
            name: "Content-Type",
            value: "text/html; charset=utf-8",
          }],
          body: Buffer.from("<!doctype html><title>Checkout handoff</title>")
            .toString("base64"),
        })
      : cdp.send("Fetch.continueRequest", { requestId });
    command.catch((error) => {
      browserErrors.push({
        text: `Checkout interception failed: ${error.message}`,
        url: String(request?.url || ""),
      });
    });
  });
  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable"),
    cdp.send("Network.enable"),
    cdp.send("Accessibility.enable"),
    cdp.send("Fetch.enable", {
      patterns: [{
        urlPattern: "https://checkout.stripe.com/*",
        resourceType: "Document",
        requestStage: "Request",
      }],
    }),
  ]);

  const sitemap = await readFile(
    path.join(ARTIFACT_ROOT, "sitemap.xml"),
    "utf8",
  );
  const sitemapRoutes = [...sitemap.matchAll(
    /<loc>https:\/\/sitesourcery\.com([^<]*)<\/loc>/gu,
  )].map((match) => match[1]);
  if (JSON.stringify(sitemapRoutes) !== JSON.stringify(CANONICAL_ROUTES)) {
    failures.push(
      "sitemap route order/content does not equal the frozen 24-route manifest: "
        + JSON.stringify(sitemapRoutes),
    );
  }
  const routes = [...CANONICAL_ROUTES];

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

  const publicProofViewport = VIEWPORTS.find(
    ({ label }) => label === "phone-390",
  );
  await setViewport(cdp, publicProofViewport);
  const observedCanonicalLinks = new Set();
  for (const route of routes) {
    if (route === "/abracadabra/app/") {
      await cdp.send("Storage.clearDataForOrigin", {
        origin: server.origin,
        storageTypes: "all",
      });
    }
    const queryUrl = new URL(route, server.origin);
    queryUrl.searchParams.set("fin007", "query-proof");
    await navigate(cdp, queryUrl.href);
    if (route === "/abracadabra/app/") await openHostedAccount(cdp);
    const querySnapshot = await inspect(cdp);
    failures.push(...snapshotFailures(
      querySnapshot,
      route,
      publicProofViewport,
    ).map((failure) => `query ${failure}`));
    if (
      querySnapshot.search !== "?fin007=query-proof"
      || querySnapshot.hash
    ) {
      failures.push(
        `query ${route}: query/fragment drifted: ${querySnapshot.href}`,
      );
    }

    const fragmentUrl = new URL(route, server.origin);
    fragmentUrl.hash = "main";
    await navigate(cdp, fragmentUrl.href);
    if (route === "/abracadabra/app/") await openHostedAccount(cdp);
    const fragmentSnapshot = await inspect(cdp);
    failures.push(...snapshotFailures(
      fragmentSnapshot,
      route,
      publicProofViewport,
    ).map((failure) => `fragment ${failure}`));
    if (
      fragmentSnapshot.hash !== "#main"
      || !await evaluate(cdp, `Boolean(document.getElementById("main"))`)
    ) {
      failures.push(
        `fragment ${route}: #main did not resolve: ${fragmentSnapshot.href}`,
      );
    }

    const accessibility = await inspectAccessibilityAndLinks(cdp);
    if (
      accessibility.duplicateIds.length
      || accessibility.imagesMissingAlt.length
      || accessibility.mainCount !== 1
      || accessibility.mainTargetCount !== 1
      || accessibility.skipLinkCount !== 1
      || accessibility.unnamedInteractive.length
    ) {
      failures.push(
        `accessibility ${route}: ${JSON.stringify(accessibility)}`,
      );
    }
    for (const href of accessibility.internalLinks) {
      const linked = new URL(href);
      if (CANONICAL_ROUTES.includes(linked.pathname)) {
        observedCanonicalLinks.add(linked.pathname);
      } else {
        failures.push(
          `link graph ${route}: noncanonical internal link ${href}`,
        );
      }
    }
  }
  const missingCanonicalLinks = CANONICAL_ROUTES.filter(
    (route) => !observedCanonicalLinks.has(route),
  );
  if (missingCanonicalLinks.length) {
    failures.push(
      "link graph has no browser-observed canonical link to "
        + JSON.stringify(missingCanonicalLinks),
    );
  }

  for (const [legacyFile, target] of Object.entries(LEGACY_REDIRECTS)) {
    const inputUrl = new URL(`/${legacyFile}`, server.origin).href;
    const expectedUrl = new URL(target, `${server.origin}/`).href;
    const expectedRequestUrl = new URL(expectedUrl);
    expectedRequestUrl.hash = "";
    const priorDocumentCount = documentNavigations.length;
    await cdp.send("Page.navigate", { url: inputUrl });
    await waitFor(
      cdp,
      `location.href === ${JSON.stringify(expectedUrl)}`,
    );
    await delay(250);
    const stableUrl = await evaluate(cdp, "location.href");
    const chain = documentNavigations.slice(priorDocumentCount);
    if (
      stableUrl !== expectedUrl
      || chain.length !== 2
      || chain[0] !== inputUrl
      || chain[1] !== expectedRequestUrl.href
    ) {
      failures.push(
        `redirect ${legacyFile}: unstable/wrong destination or loop: `
          + JSON.stringify({ chain, expectedUrl, stableUrl }),
      );
      continue;
    }
    const targetUrl = new URL(target, SITE_ORIGIN);
    const redirectSnapshot = await inspect(cdp);
    failures.push(...snapshotFailures(
      redirectSnapshot,
      targetUrl.pathname,
      publicProofViewport,
      { checkHostedApp: false },
    ).map((failure) => `redirect ${legacyFile} ${failure}`));
    if (
      targetUrl.hash
      && !await evaluate(
        cdp,
        `Boolean(document.getElementById(${JSON.stringify(
          targetUrl.hash.slice(1),
        )}))`,
      )
    ) {
      failures.push(
        `redirect ${legacyFile}: destination fragment ${targetUrl.hash} is missing`,
      );
    }
  }

  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  try {
    for (const route of routes) {
      const url = new URL(route, server.origin).href;
      await navigateWithoutPageScript(cdp, url);
      const noScript = await inspectNoScript(cdp);
      if (
        noScript.url !== url
        || noScript.mainCount !== 1
        || noScript.h1.length !== 1
        || !noScript.h1[0]
        || noScript.viewportWidth !== publicProofViewport.width
        || noScript.contentWidth > noScript.viewportWidth + 1
      ) {
        failures.push(
          `no-script ${route}: ${JSON.stringify(noScript)}`,
        );
      }
    }
  } finally {
    await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  }

  await cdp.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  try {
    for (const route of routes) {
      await navigate(cdp, new URL(route, server.origin).href);
      const reducedSnapshot = await inspect(cdp);
      failures.push(...snapshotFailures(
        reducedSnapshot,
        route,
        publicProofViewport,
        { checkHostedApp: false },
      ).map((failure) => `reduced-motion ${failure}`));
      const reducedMotion = await inspectReducedMotion(cdp);
      if (
        !reducedMotion.preferred
        || reducedMotion.scrollBehavior !== "auto"
        || reducedMotion.offenders.length
      ) {
        failures.push(
          `reduced-motion ${route}: ${JSON.stringify(reducedMotion)}`,
        );
      }
    }
  } finally {
    await cdp.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [],
    });
  }

  try {
    server.setStaticFailureMode("styles");
    await navigate(cdp, `${server.origin}/`);
    const withoutStyles = await inspect(cdp);
    if (
      !withoutStyles.main
      || withoutStyles.mainTextLength < 20
      || withoutStyles.h1.length !== 1
      || withoutStyles.canonical !== `${SITE_ORIGIN}/`
    ) {
      failures.push(
        `progressive styles failure: ${JSON.stringify(withoutStyles)}`,
      );
    }
    server.setStaticFailureMode("images");
    await navigate(cdp, `${server.origin}/work/`);
    const withoutImages = await inspect(cdp);
    if (
      !withoutImages.main
      || withoutImages.mainTextLength < 20
      || withoutImages.h1.length !== 1
      || withoutImages.canonical !== `${SITE_ORIGIN}/work/`
    ) {
      failures.push(
        `progressive image failure: ${JSON.stringify(withoutImages)}`,
      );
    }
  } finally {
    server.setStaticFailureMode("");
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

  for (const viewport of VIEWPORTS) {
    let publication;
    try {
      publication = await alakazamPublicationJourney(
        cdp,
        server,
        viewport,
      );
    } catch (error) {
      failures.push(
        `${viewport.label} Alakazam publication journey did not complete: `
          + error.message,
      );
      continue;
    }
    const shortControls = publication.initial.controls.filter(
      ({ height }) => height < 44,
    );
    const initialActions = publication.initial.controls
      .map(({ action }) => action)
      .sort();
    if (
      publication.initial.viewportWidth !== viewport.width
      || publication.initial.scrollWidth >
        publication.initial.viewportWidth
      || publication.initial.historyCount !== 2
      || shortControls.length
      || JSON.stringify(initialActions) !==
        JSON.stringify(["publish", "rollback", "unpublish"])
      || publication.initial.controls.some(({ disabled }) => disabled)
      || !publication.initial.text.includes(
        PAID_ALAKAZAM_ACCEPTED_VERSION_ID
      )
      || !publication.initial.text.includes(
        PAID_ALAKAZAM_CURRENT_VERSION_ID
      )
      || !publication.initial.text.includes(
        PAID_ALAKAZAM_PRIOR_VERSION_ID
      )
      || !publication.initial.text.includes(
        "Alakazam publication remains held"
      )
      || !publication.initial.text.includes(
        "no live provider effect, cancellation, or deletion occurs"
      )
    ) {
      failures.push(
        `${viewport.label} Alakazam publication layout/authority failed: `
          + JSON.stringify({ ...publication.initial, shortControls }),
      );
    }
    const commandIds = [];
    for (const result of publication.actions) {
      const request = result.request;
      const body = request?.body || {};
      const bodyKeys = Object.keys(body).sort();
      const expectedTarget = result.action === "rollback"
        ? PAID_ALAKAZAM_PRIOR_RELEASE_ID
        : null;
      commandIds.push(request?.idempotencyKey || "");
      if (
        !result.keyboardFocused
        || !request
        || JSON.stringify(bodyKeys) !== JSON.stringify([
          "action",
          "snapshotDigest",
          "targetReleaseId",
        ])
        || body.action !== result.action
        || body.snapshotDigest !== PAID_ALAKAZAM_SNAPSHOT_DIGEST
        || body.targetReleaseId !== expectedTarget
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(request.idempotencyKey || "")
        || !result.retained.statusFocused
        || result.retained.enabledActions !== 3
        || !result.retained.text.includes(
          "Authorization recorded. Publication remains held."
        )
        || !result.retained.text.includes(
          `${result.action[0].toUpperCase()}${result.action.slice(1)} authorization recorded`
        )
        || !result.retained.text.includes(
          "It remains held without a provider effect."
        )
      ) {
        failures.push(
          `${viewport.label} ${result.action} held publication command failed: `
            + JSON.stringify(result),
        );
      }
    }
    if (new Set(commandIds).size !== 3) {
      failures.push(
        `${viewport.label} publication idempotency keys were reused: `
          + JSON.stringify(commandIds),
      );
    }

    let legal;
    try {
      legal = await projectLegalJourney(
        cdp,
        server,
        viewport,
      );
    } catch (error) {
      failures.push(
        `${viewport.label} project-legal journey did not complete: `
          + error.message,
      );
      continue;
    }
    const acceptance = legal.request?.body
      ?.legalAcceptance;
    if (
      !legal.checkboxKeyboardFocused
      || !legal.saveKeyboardFocused
      || !legal.recaptureKeyboardFocused
      || !legal.projectKeyboardFocused
      || legal.authorityReadsBeforeClick !== 1
      || legal.authorityReadsAfterCapture !== 1
      || legal.authorityReadsAfterStale !== 2
      || legal.request?.expectedWrite !== true
      || JSON.stringify(
        Object.keys(legal.request?.body || {}).sort(),
      ) !== JSON.stringify(["legalAcceptance", "name"])
      || legal.request?.body?.name !==
        "Browser legal project"
      || acceptance?.schema !==
        "sitesourcery.project-legal-acceptance/v3"
      || acceptance?.acceptanceStatement !==
        PROJECT_LEGAL_AUTHORITY.acceptanceStatement
      || acceptance?.authorityDigest !==
        PROJECT_LEGAL_AUTHORITY.authorityDigest
      || JSON.stringify(acceptance?.documents) !==
        JSON.stringify(PROJECT_LEGAL_AUTHORITY.documents)
      || Object.hasOwn(
        legal.request?.body || {},
        "acceptedTerms",
      )
      || legal.afterStale.checked
      || !legal.afterStale.noticeFocused
      || !legal.afterStale.saveDisabled
      || !legal.afterStale.noticeText.includes(
        "select the unchecked box again"
      )
      || legal.retained.viewportWidth !== viewport.width
      || legal.retained.scrollWidth >
        legal.retained.viewportWidth
      || !legal.retained.privacyText.includes(
        "Accepted privacy V2"
      )
      || legal.retained.privacyText.includes("V3")
      || legal.retained.privacyHref !==
        "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/"
    ) {
      failures.push(
        `${viewport.label} project legal authority/capture/history failed: `
          + JSON.stringify(legal),
      );
    }
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
      || paid.initial.scrollWidth > paid.initial.viewportWidth
      || !paid.initial.ownerText.includes(PAID_JOB_ID)
      || paid.initial.customerText.includes(PAID_JOB_ID)
      || !paid.initial.customerText.includes("USD before Checkout tax")
      || !paid.initial.ownerProgressText.includes(
        "Choose the approved contact wording"
      )
      || !paid.initial.customerProgressText.includes(
        "Choose the approved contact wording"
      )
      || paid.initial.customerProgressText.includes(PAID_JOB_ID)
      || paid.initial.customerProgressText.includes(PAID_REQUEST_ID)
      || paid.initial.ownerProgressAuthority !== (
        mode === "completion" ? "terminal" : "open"
      )
      || paid.initial.ownerChangeAuthority !== (
        mode === "completion" ? "terminal" : "open"
      )
      || paid.initial.customerProgressAuthority !== (
        mode === "completion" ? "terminal" : "open"
      )
      || paid.initial.customerChangeAuthority !== (
        mode === "completion" ? "terminal" : "open"
      )
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
        !paid.initial.ownerProgressText.includes(
          "Verified completion is immutable"
        )
        || !paid.initial.customerProgressText.includes(
          "Completion is immutable"
        )
        || !paid.initial.customerChangeText.includes(
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
      || (mode === "issued" && (
        !paid.initial.ownerProgressText.includes("Action needed from you")
        || !paid.initial.customerProgressText.includes("Action needed from you")
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

  for (const viewport of VIEWPORTS) {
    for (const mode of PAID_PAYMENT_MODES) {
      let purposeOne;
      try {
        purposeOne = await customBuildChangePaymentJourney(
          cdp,
          server,
          viewport,
          mode,
          checkoutNavigations,
        );
      } catch (error) {
        failures.push(
          `${viewport.label} ${mode} Purpose-1 journey did not complete: `
            + error.message,
        );
        continue;
      }
      const { action, initial } = purposeOne;
      const shortControls = initial.controls.filter(
        ({ height }) => height < 44,
      );
      const expectsCustomerCheckout = [
        "payment-checkout",
        "payment-customer-malformed",
        "payment-customer-uncertain",
      ].includes(mode);
      if (
        initial.scrollWidth > initial.viewportWidth
        || shortControls.length
        || initial.moneyOrMarkPaidFields.length
        || initial.firstPaymentCount !== 1
        || initial.completionControlCount !== 0
        || initial.checkoutCount !== (expectsCustomerCheckout ? 1 : 0)
        || initial.retainedCheckoutCount !== 0
        || (mode === "payment-customer-held" && (
          initial.paymentVisible
          || initial.checkoutVisible
          || !initial.customerStatusFocused
          || !initial.customerText.toLowerCase().includes("held or unavailable")
          || !initial.customerText.includes("No charge occurred")
        ))
        || (mode !== "payment-customer-held" && (
          !initial.paymentVisible
          || !initial.customerText.includes("2 × $125.00")
          || !initial.customerText.includes("$250.00 USD")
        ))
        || (mode === "payment-paid" && (
          initial.paymentState !== "paid"
          || initial.checkoutVisible
          || !initial.customerText.includes(
            "Payment confirmed; added scope is effective"
          )
          || !initial.customerText.includes(
            "Stripe payment was verified against this exact invoice"
          )
        ))
        || (expectsCustomerCheckout && (
          initial.paymentState !== "checkout_available"
          || !initial.checkoutVisible
          || !initial.customerText.includes("No charge has occurred")
          || !initial.customerText.includes(
            "automatic tax and the exact total"
          )
        ))
        || (mode === "payment-owner-uncertain" && (
          initial.paymentState !== "reconciliation_required"
          || initial.checkoutVisible
          || !initial.customerText.includes("Do not try another payment")
          || !initial.ownerVisible
          || !initial.ownerReconcileVisible
          || initial.ownerReconcileKind !== "creation"
          || initial.ownerReconcileCount !== 1
          || !/uncertain|reconcil/iu.test(initial.ownerText)
        ))
        || (mode !== "payment-owner-uncertain"
          && initial.ownerReconcileCount !== 0)
      ) {
        failures.push(
          `${viewport.label} ${mode} Purpose-1 layout/state failed: `
            + JSON.stringify({ ...initial, shortControls }),
        );
      }

      if (mode === "payment-checkout") {
        const bodyKeys = Object.keys(action?.request?.body || {}).sort();
        if (
          !action?.keyboardFocused
          || JSON.stringify(bodyKeys) !==
            JSON.stringify(["commandId", "invoiceDigest"])
          || action.request.body.invoiceDigest !== PAID_CHANGE_INVOICE_DIGEST
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
            .test(action.request.body.commandId || "")
          || action.request.idempotencyKey !== action.request.body.commandId
          || action.navigation !== PAID_CHANGE_CHECKOUT_URL
        ) {
          failures.push(
            `${viewport.label} customer change Checkout command failed: `
              + JSON.stringify(action),
          );
        }
      }

      if (
        ["payment-customer-malformed", "payment-customer-uncertain"]
          .includes(mode)
      ) {
        if (
          !action?.keyboardFocused
          || !action.retained?.paymentPresent
          || action.retained.checkoutPresent
          || !action.retained.statusFocused
          || !action.retained.text.includes("$250.00 USD")
          || !/could not|invalid|uncertain|reconcil/iu.test(action.retained.text)
        ) {
          failures.push(
            `${viewport.label} ${mode} fail-closed retention failed: `
              + JSON.stringify(action),
          );
        }
        if (mode === "payment-customer-uncertain") {
          const bodyKeys = Object.keys(action?.request?.body || {}).sort();
          if (
            JSON.stringify(bodyKeys) !==
              JSON.stringify(["commandId", "invoiceDigest"])
            || action.request.body.invoiceDigest !== PAID_CHANGE_INVOICE_DIGEST
            || action.request.idempotencyKey !== action.request.body.commandId
            || action.navigation
          ) {
            failures.push(
              `${viewport.label} uncertain customer command authority failed: `
                + JSON.stringify(action),
            );
          }
        }
      }

      if (mode === "payment-owner-uncertain") {
        const bodyKeys = Object.keys(action?.request?.body || {}).sort();
        if (
          !action?.keyboardFocused
          || JSON.stringify(bodyKeys) !==
            JSON.stringify(["commandId", "organizationId"])
          || action.request.body.organizationId !== PAID_ORGANIZATION_ID
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
            .test(action.request.body.commandId || "")
          || action.request.idempotencyKey !== action.request.body.commandId
          || !action.retained?.reconcilePresent
          || action.retained?.reconcileKind !== "settlement"
          || !/ready|retained/iu.test(action.retained?.text || "")
          || !action.retained?.statusFocused
        ) {
          failures.push(
            `${viewport.label} owner uncertain-Checkout reconciliation failed: `
              + JSON.stringify(action),
          );
        }
      }
    }
  }

  for (const viewport of VIEWPORTS) {
    for (const mode of ["final-paid", "final-zero"]) {
      let purposeTwo;
      try {
        purposeTwo = await customBuildFinalHandoffJourney(
          cdp,
          server,
          viewport,
          mode,
        );
      } catch (error) {
        failures.push(
          `${viewport.label} ${mode} Purpose-2 handoff journey did not complete: `
            + error.message,
        );
        continue;
      }
      const {
        customer,
        documentBusy,
        documentKeyboardFocused,
        finalBusy,
        finalRefreshKeyboardFocused,
        initialOwner,
        ownerAfter,
        ownerKeyboardFocused,
        ownerPaymentRead,
        ownerReadinessRead,
        ownerRequest,
        retained,
        retainedFinal,
      } = purposeTwo;
      const expectedDocument = paidHandoffDocument(mode);
      const body = ownerRequest?.body || {};
      const bodyKeys = Object.keys(body).sort();
      const shortControls = [
        ...initialOwner.controls,
        ...customer.controls,
      ].filter(({ height }) => height < 44);
      if (
        !initialOwner.formVisible
        || initialOwner.viewportWidth !== viewport.width
        || initialOwner.scrollWidth > initialOwner.viewportWidth
        || initialOwner.paymentProjectionVisible
        || !initialOwner.text.includes(
          "Verified financial clearance is ready for immutable handoff"
        )
        || shortControls.length
        || ownerPaymentRead?.search !==
          `?organizationId=${encodeURIComponent(PAID_ORGANIZATION_ID)}`
        || ownerPaymentRead?.fixtureStatus !== 403
        || ownerReadinessRead?.search !==
          `?organizationId=${encodeURIComponent(PAID_ORGANIZATION_ID)}`
        || ownerReadinessRead?.fixtureStatus !== 200
        || !ownerKeyboardFocused
        || !ownerRequest
        || JSON.stringify(bodyKeys) !== JSON.stringify([
          "commandId",
          "customerSummary",
          "deliveryManifest",
          "expectedCompletionPackageDigest",
          "expectedFinalObligationDigest",
          "organizationId",
        ])
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
          .test(body.commandId || "")
        || ownerRequest.idempotencyKey !== body.commandId
        || body.organizationId !== PAID_ORGANIZATION_ID
        || body.expectedCompletionPackageDigest !== PAID_FINAL_PACKAGE_DIGEST
        || body.expectedFinalObligationDigest !== PAID_FINAL_OBLIGATION_DIGEST
        || body.customerSummary !== expectedDocument.payload.customerSummary
        || JSON.stringify(body.deliveryManifest) !==
          JSON.stringify(expectedDocument.payload.deliveryManifest)
        || ownerAfter.handoffFormCount !== 0
        || ownerAfter.paymentProjectionCount !== 0
        || !ownerAfter.text.includes(
          "Immutable handoff created. The 30-day workmanship window now begins."
        )
        || !ownerAfter.text.includes("Handoff is immutable")
      ) {
        failures.push(
          `${viewport.label} ${mode} owner handoff authority/input binding failed: `
            + JSON.stringify({
              body,
              initialOwner,
              ownerAfter,
              ownerKeyboardFocused,
              ownerPaymentRead,
              ownerReadinessRead,
              shortControls,
            }),
        );
      }
      const zeroWordingLeak = mode === "final-zero"
        && /stripe|provider|\bpayment\b/iu
          .test(customer.finalText);
      const zeroTransientWordingLeak = mode === "final-zero"
        && /stripe|provider|\bpayment\b/iu
          .test([
            documentBusy,
            finalBusy,
            retained.text,
            retainedFinal.text,
          ].join(" "));
      if (
        customer.viewportWidth !== viewport.width
        || customer.scrollWidth > customer.viewportWidth
        || customer.progressAuthority !== "terminal"
        || customer.changeAuthority !== "terminal"
        || customer.responseFormCount !== 0
        || customer.customerChangeMutationCount !== 0
        || customer.ownerProgressMutationCount !== 0
        || customer.ownerChangeMutationCount !== 0
        || customer.receiptReady !== "ready"
        || customer.deliveredItems.length !== 2
        || !customer.finalText.includes(
          expectedDocument.payload.customerSummary
        )
        || !customer.finalText.includes("Website files")
        || !customer.finalText.includes("Handoff notes")
        || customer.identifierLeaks.length
        || customer.workmanshipFacts["Handed off"] !==
          customer.expectedHandoffAt
        || customer.workmanshipFacts["Workmanship corrections begin"] !==
          customer.expectedHandoffAt
        || customer.workmanshipFacts["Workmanship corrections end"] !==
          customer.expectedWorkmanshipEndsAt
        || !customer.workmanshipCoverageCopy
        || zeroWordingLeak
        || zeroTransientWordingLeak
        || (mode === "final-zero" && (
          !customer.changeText.includes("Ready for delivery")
          || !customer.finalText.includes("Delivery and workmanship")
          || !customer.finalText.includes("$0.00 USD")
          || !customer.finalText.includes("zero-balance clearance")
        ))
        || (mode === "final-paid" && (
          !customer.changeText.includes("Final payment is required before delivery")
          || !customer.finalText.includes("$600.00 USD")
          || !customer.finalText.includes("Final payment, delivery, and workmanship")
          || !customer.finalText.includes(
            "verified provider-confirmed final-payment clearance"
          )
          || !customer.finalText.includes("SSCB-FINAL-")
        ))
      ) {
        failures.push(
          `${viewport.label} ${mode} customer immutable receipt/terminal layout failed: `
            + JSON.stringify({
              ...customer,
              controls: customer.controls,
              zeroTransientWordingLeak,
              zeroWordingLeak,
            }),
        );
      }
      if (
        !documentKeyboardFocused
        || retained.receiptReady !== "ready"
        || retained.deliveredItemCount !== 2
        || !retained.error
        || !retained.statusFocused
        || !retained.text.includes(expectedDocument.payload.customerSummary)
        || (mode === "final-paid"
          && !documentBusy.includes("final-payment"))
      ) {
        failures.push(
          `${viewport.label} ${mode} handoff-document error retention failed: `
            + JSON.stringify({ documentKeyboardFocused, retained }),
        );
      }
      if (
        !finalRefreshKeyboardFocused
        || retainedFinal.receiptReady !== "ready"
        || retainedFinal.deliveredItems.length !== 2
        || JSON.stringify(retainedFinal.deliveredItems) !== JSON.stringify([
          "Website files · Final accepted website deliverables",
          "Handoff notes · Scope, delivery, and workmanship details",
        ])
        || !retainedFinal.error
        || !retainedFinal.statusFocused
        || !retainedFinal.text.includes(
          expectedDocument.payload.customerSummary
        )
        || (mode === "final-paid"
          && !finalBusy.includes("final payment"))
        || zeroTransientWordingLeak
      ) {
        failures.push(
          `${viewport.label} ${mode} final-state error retained exact document failed: `
            + JSON.stringify({ finalRefreshKeyboardFocused, retainedFinal }),
        );
      }
    }

    let race;
    try {
      race = await customBuildFinalAuthorityRaceJourney(
        cdp,
        server,
        viewport,
      );
    } catch (error) {
      failures.push(
        `${viewport.label} final-authority delayed race did not complete: `
          + error.message,
      );
      continue;
    }
    if (
      race.unknown.progressAuthority !== "unknown"
      || race.unknown.changeAuthority !== "unknown"
      || race.unknown.responseForms !== 0
      || race.unknown.changeDecisionButtons !== 0
      || race.open.progressAuthority !== "open"
      || race.open.changeAuthority !== "open"
      || race.open.responseForms !== 1
      || race.open.acceptButtons !== 1
      || race.terminal.progressAuthority !== "terminal"
      || race.terminal.changeAuthority !== "terminal"
      || race.terminal.responseForms !== 0
      || race.terminal.changeDecisionButtons !== 0
      || !race.terminal.customerReadOnlyMarker
      || !race.terminal.customerHistoryVisible
      || race.terminal.customerRefreshCount < 2
      || !race.terminal.progressHistoryVisible
      || race.terminal.ownerProgressAuthority !== "terminal"
      || race.terminal.ownerChangeAuthority !== "terminal"
      || race.terminal.ownerReadOnlyMarkers < 2
      || race.terminal.ownerMutationForms !== 0
      || !race.terminal.ownerHistoryVisible
      || race.terminal.ownerRefreshCount < 2
      || !race.terminal.changeReadOnlyCopy
      || race.terminal.scrollWidth > race.terminal.viewportWidth
      || race.terminal.viewportWidth !== viewport.width
      || race.mutationWrites !== 0
      || race.unexpectedMutationWrites !== 0
    ) {
      failures.push(
        `${viewport.label} final-authority rerender/fail-closed race failed: `
          + JSON.stringify(race),
      );
    }
  }

  if (server.missingFiles.length) {
    failures.push(
      `artifact requested missing files: ${JSON.stringify([...new Set(server.missingFiles)])}`,
    );
  }
  const writes = server.apiRequests.filter(
    ({ expectedWrite, method }) =>
      method !== "GET" && method !== "HEAD" && !expectedWrite,
  );
  if (writes.length) {
    failures.push(
      `guest browser audit made unexpected API writes: ${JSON.stringify(writes)}`,
    );
  }
  const unexpectedBrowserErrors = browserErrors.filter(({ text, url }) => {
    const expectedHeldRead = text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && url.endsWith(
        `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-invoice`
      );
    const expectedUncertainCheckout = text ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
      && url.endsWith(
        `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-change-invoices/${PAID_CHANGE_INVOICE_ID}/checkout-command`
      );
    const expectedStaleProjectAuthority = text ===
        "Failed to load resource: the server responded with a status of 409 (Conflict)"
      && url.endsWith(
        `/api/v1/organizations/${PAID_ORGANIZATION_ID}/projects`
      );
    const expectedHandoffHeld = text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && url.includes(
        `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-handoff`
      );
    const expectedPaymentCapabilityDenial = text ===
        "Failed to load resource: the server responded with a status of 403 (Forbidden)"
      && url.includes(
        `/api/v1/operator/custom-services/custom-build-jobs/${PAID_JOB_ID}/final-payments`
      );
    const expectedDocumentHeld = text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && url.endsWith(
        `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-handoff-documents/${PAID_FINAL_DOCUMENT_ID}`
      );
    const expectedFinalReadHeld = text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && url.endsWith(
        `/api/v1/projects/${PAID_PROJECT_ID}/custom-services/custom-build-final-handoff`
      );
    const expectedProgressiveStaticFailure = text ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && /\.(?:css|ico|png|svg|webp)(?:$|\?)/u.test(url);
    const expectedProgressiveStyleMimeFailure =
      text.startsWith("Refused to apply style from '")
      && text.includes("/vnext.css'")
      && text.includes("MIME type ('text/plain')");
    return !expectedHeldRead
      && !expectedUncertainCheckout
      && !expectedStaleProjectAuthority
      && !expectedHandoffHeld
      && !expectedPaymentCapabilityDenial
      && !expectedDocumentHeld
      && !expectedFinalReadHeld
      && !expectedProgressiveStaticFailure
      && !expectedProgressiveStyleMimeFailure;
  });
  if (unexpectedBrowserErrors.length) {
    failures.push(
      `browser errors: ${JSON.stringify([...new Map(
        unexpectedBrowserErrors.map((entry) => [
          `${entry.text}\u0000${entry.url}`,
          entry,
        ]),
      ).values()])}`,
    );
  }

  if (failures.length) {
    throw new Error(
      `Current browser audit failed (${failures.length}):\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(
    `Current browser audit passed: ${routes.length} hosted routes × ${VIEWPORTS.length} required width modes, `
      + "exact-width layout, including a 720-pixel source at 200% reflow; four-stage account room; mobile menu; complete maker preview; held Alakazam publish/rollback/unpublish authorization; issued-change plus ready-completion fixtures; H1N Purpose-1 customer/owner change-payment journeys; Purpose-2 paid plus zero-balance immutable handoff with exact owner command/document identity; retained document and final-state errors; a delayed-authority zero-write race; keyboard activation; and 44px controls at the required 320, 360, 390, 720-at-200%-reflow, 768, and 1440 width modes.",
  );
} catch (error) {
  primaryFailure = error;
} finally {
  let cleanupFailure = null;
  try {
    try {
      if (cdp) cdp.close();
    } finally {
      try {
        await server.close();
      } finally {
        try {
          await stopBrowserProcess();
        } finally {
          if (profile) {
            await rm(profile, { recursive: true, force: true });
          }
        }
      }
    }
  } catch (error) {
    cleanupFailure = error;
  }
  if (primaryFailure && cleanupFailure) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      "Current browser audit and cleanup failed."
    );
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
}
