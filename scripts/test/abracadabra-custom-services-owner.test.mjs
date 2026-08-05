import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  ownerAssessmentCoverageComplete,
  ownerAssessmentEvidenceUrl,
  ownerReviewTargets,
  prepareAssessmentEvidenceFile,
  safeCheckoutDestination,
  verifiedAssessmentCheckout,
  verifiedAssessmentInvoice,
  verifiedCustomerAssessmentReport,
  verifiedOwnerAssessmentDelivery,
  verifiedOwnerAssessmentEvidence,
  verifiedOwnerAssessmentFinding,
  verifiedOwnerAssessmentJobs,
  verifiedOwnerAssessmentQueue
} = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);
const { createClient } = require(
  "../../abracadabra/app/abracadabra-api.js"
);

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "40000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "50000000-0000-4000-8000-000000000001";
const INVOICE_ID =
  "60000000-0000-4000-8000-000000000001";
const RECEIPT_ID =
  "70000000-0000-4000-8000-000000000001";
const JOB_ID =
  "80000000-0000-4000-8000-000000000001";
const DESKTOP_EVIDENCE_ID =
  "90000000-0000-4000-8000-000000000001";
const PHONE_EVIDENCE_ID =
  "a0000000-0000-4000-8000-000000000001";
const FINDING_ID =
  "b0000000-0000-4000-8000-000000000001";
const REPORT_ID =
  "c0000000-0000-4000-8000-000000000001";
const CREDIT_ID =
  "d0000000-0000-4000-8000-000000000001";
const DELIVERED_AT = "2026-08-05T14:00:00.000Z";
const ACCEPTANCE_CUTOFF = new Date(
  Date.parse(DELIVERED_AT) + 90 * 24 * 60 * 60 * 1000
).toISOString();
const CREDIT_TIERS = [
  "card",
  "card-plus",
  "site",
  "site-plus",
  "signature",
  "flagship",
  "scale"
];

function queue(overrides = {}) {
  return {
    schema:
      "sitesourcery.custom-services-owner-assessment-queue/v1",
    requests: [
      {
        caseId: CASE_ID,
        organizationId: ORGANIZATION_ID,
        organizationName: "Customer Studio",
        projectId: PROJECT_ID,
        projectName: "Customer Website",
        submittedAt: "2026-08-05T12:00:00.000Z",
        customer: {
          customerId: CUSTOMER_ID,
          name: "Customer Owner",
          email: "customer@example.test"
        },
        website: {
          displayName: "Customer Website",
          publicUrl: "https://customer.example.test/",
          businessName: "Customer Studio",
          platformFamily: "unknown",
          approximatePublicSize: "one_to_ten",
          complexityFlags: ["forms"],
          importantDate: null
        },
        request: {
          primaryGoal: "Make the services easier to understand.",
          customerObservation: "The phone layout feels crowded.",
          intakeRevision: 1
        },
        currentQuote: {
          quoteId: QUOTE_ID,
          quoteRevision: 1,
          deliveryDate: "2026-08-20",
          expiresAt: "2026-08-19T12:00:00.000Z",
          issuedAt: "2026-08-05T12:00:00.000Z",
          reviewTargets: [
            { kind: "page", value: "/" },
            { kind: "page_type", value: "product" }
          ]
        },
        ...overrides
      }
    ]
  };
}

test("owner quote queue accepts only exact authenticated request-shaped data", () => {
  const valid = queue();
  assert.equal(verifiedOwnerAssessmentQueue(valid), valid);
  assert.equal(
    verifiedOwnerAssessmentQueue(
      queue({
        website: {
          ...valid.requests[0].website,
          publicUrl: "javascript:alert(1)"
        }
      })
    ),
    null
  );
  assert.equal(
    verifiedOwnerAssessmentQueue(
      queue({ caseId: "not-a-case" })
    ),
    null
  );
  assert.equal(
    verifiedOwnerAssessmentQueue({
      ...valid,
      requests: Array.from(
        { length: 101 },
        () => valid.requests[0]
      )
    }),
    null
  );
});

test("owner review target entry is phone-friendly and canonical", () => {
  assert.deepEqual(
    ownerReviewTargets("/\n/about\ntype:product"),
    [
      { kind: "page", value: "/" },
      { kind: "page", value: "/about" },
      { kind: "page_type", value: "product" }
    ]
  );
  assert.throws(
    () => ownerReviewTargets("/\n/"),
    /listed once/iu
  );
  assert.throws(
    () => ownerReviewTargets("about"),
    /page path/iu
  );
  assert.throws(
    () => ownerReviewTargets(""),
    /between one and five/iu
  );
});

test("owner quote desk stays private and exposes only the bounded quote controls", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-customer-control-dom.js",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../abracadabra/app/abracadabra-app.css",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  for (const copy of [
    "Private Site Sourcery tools",
    "Owner assessment quote desk",
    "Issue $200 quote",
    "Promised delivery date",
    "Pages or page types (one per line)"
  ]) {
    assert.ok(source.includes(copy), copy);
  }
  assert.match(
    source,
    /\[401, 403, 503\]\.includes\(error\.status\)[\s\S]*?"unavailable"/u
  );
  assert.match(
    css,
    /\.customer-owner-quote-form\{grid-template-columns:1fr\}/u
  );
});

function assessmentInvoiceProjection(checkoutAvailable = false) {
  return {
    schema: "sitesourcery.custom-services-assessment-invoice/v2",
    state: checkoutAvailable
      ? "checkout_available"
      : "tax_calculation_pending",
    invoice: {
      invoiceId: "60000000-0000-4000-8000-000000000001",
      invoiceNumber: "SSA-60000000000040008000000000000001",
      purpose: "assessment",
      quote: {
        quoteId: QUOTE_ID,
        quoteRevision: 1,
        acceptedAt: "2026-08-05T11:59:00.000Z",
        acceptedQuoteDigest: "b".repeat(64),
        acceptedDisclosureDigest: "c".repeat(64)
      },
      line: {
        name: "Website assessment",
        quantity: 1,
        unit: "assessment",
        unitAmount: {
          amountMinor: 20000,
          currency: "USD",
          formatted: "$200.00"
        }
      },
      subtotal: {
        amountMinor: 20000,
        currency: "USD",
        formatted: "$200.00"
      },
      tax: {
        state: "calculation_required",
        amountMinor: null,
        message: "Tax is still being calculated, if applicable."
      },
      total: {
        state: "pending_tax",
        amountMinor: null,
        currency: "USD",
        formatted: null
      },
      payment: {
        state: checkoutAvailable ? "checkout_available" : "held",
        checkoutAvailable,
        chargeOccurred: false,
        receiptId: null,
        paidAt: null,
        settledAt: null,
        message: checkoutAvailable
          ? "Secure checkout is available. No charge occurred."
          : "No payment has been requested and no charge occurred."
      },
      invoiceDigest: "a".repeat(64),
      issuedAt: "2026-08-05T12:00:00.000Z",
      createdAt: "2026-08-05T12:00:01.000Z"
    },
    job: null,
    actions: {
      checkout: {
        available: checkoutAvailable,
        reason: checkoutAvailable
          ? null
          : "checkout_not_available",
        message: checkoutAvailable
          ? "Tax and the exact total are shown by Stripe before payment."
          : "Secure payment is not available yet."
      }
    }
  };
}

function paidAssessmentInvoiceProjection() {
  const pending = assessmentInvoiceProjection();
  return {
    ...pending,
    state: "paid_job_open",
    invoice: {
      ...pending.invoice,
      tax: {
        state: "calculated",
        amountMinor: 1450,
        message: "Tax confirmed at $14.50."
      },
      total: {
        state: "final",
        amountMinor: 21450,
        currency: "USD",
        formatted: "$214.50"
      },
      payment: {
        state: "paid",
        checkoutAvailable: false,
        chargeOccurred: true,
        receiptId: "70000000-0000-4000-8000-000000000001",
        paidAt: "2026-08-05T12:05:00.000Z",
        settledAt: "2026-08-05T12:05:01.000Z",
        message: "Payment is confirmed and the assessment job is open."
      }
    },
    job: {
      jobId: "80000000-0000-4000-8000-000000000001",
      state: "open",
      openedAt: "2026-08-05T12:05:01.000Z",
      deliveryDate: "2026-08-20"
    },
    actions: {
      checkout: {
        available: false,
        reason: "already_paid",
        message: "Payment is complete and assessment work is queued."
      }
    }
  };
}

function assessmentCheckoutResponse(invoice) {
  return {
    schema:
      "sitesourcery.custom-services-assessment-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      url: "https://checkout.stripe.com/c/pay/assessment_test",
      expiresAt: "2026-08-05T18:00:00.000Z",
      subtotal: {
        amountMinor: 20000,
        currency: "USD",
        formatted: "$200.00"
      },
      tax: {
        state: "calculated_at_checkout",
        amountMinor: null
      },
      total: {
        state: "shown_at_checkout",
        amountMinor: null,
        currency: "USD"
      },
      chargeOccurred: false
    }
  };
}

test("customer assessment invoice accepts held and checkout-available no-charge truth", () => {
  const held = assessmentInvoiceProjection();
  const available = assessmentInvoiceProjection(true);
  const paid = paidAssessmentInvoiceProjection();
  assert.equal(verifiedAssessmentInvoice(held), held);
  assert.equal(verifiedAssessmentInvoice(available), available);
  assert.equal(verifiedAssessmentInvoice(paid), paid);
  assert.equal(
    verifiedAssessmentInvoice({
      ...paid,
      invoice: {
        ...paid.invoice,
        total: { ...paid.invoice.total, amountMinor: 21449 }
      }
    }),
    null
  );
  assert.equal(
    verifiedAssessmentInvoice({
      ...available,
      invoice: {
        ...available.invoice,
        payment: {
          ...available.invoice.payment,
          chargeOccurred: true
        }
      }
    }),
    null
  );
  assert.equal(
    verifiedAssessmentInvoice({
      ...available,
      actions: {
        checkout: {
          ...available.actions.checkout,
          available: false
        }
      }
    }),
    null
  );
});

test("assessment checkout accepts only the exact live invoice and Stripe destination", () => {
  const invoice = assessmentInvoiceProjection(true).invoice;
  const checkout = assessmentCheckoutResponse(invoice);
  assert.deepEqual(
    verifiedAssessmentCheckout(
      checkout,
      invoice,
      "2026-08-05T17:00:00.000Z"
    ),
    checkout
  );
  assert.equal(
    safeCheckoutDestination(checkout),
    checkout.checkout.url
  );
  assert.equal(
    verifiedAssessmentCheckout(
      { ...checkout, unexpected: true },
      invoice,
      "2026-08-05T17:00:00.000Z"
    ),
    null
  );
  assert.equal(
    verifiedAssessmentCheckout(
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          checkoutSessionId: "cs_test_must_stay_server_side"
        }
      },
      invoice,
      "2026-08-05T17:00:00.000Z"
    ),
    null
  );
  assert.equal(
    verifiedAssessmentCheckout(
      {
        ...checkout,
        checkout: {
          ...checkout.checkout,
          url: "https://checkout.stripe.com.evil.test/c/pay/fake"
        }
      },
      invoice,
      "2026-08-05T17:00:00.000Z"
    ),
    null
  );
  assert.equal(
    verifiedAssessmentCheckout(
      checkout,
      { ...invoice, invoiceId: CASE_ID },
      "2026-08-05T17:00:00.000Z"
    ),
    null
  );
});

test("customer assessment invoice offers secure checkout with pre-payment tax truth", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  for (const copy of [
    "Pay secure $200 assessment invoice",
    "Stripe will show tax, if applicable, and the exact total before you confirm payment.",
    "Work begins only after Site Sourcery verifies payment."
  ]) {
    assert.ok(source.includes(copy), copy);
  }
  assert.ok(
    source.includes("createCustomServicesAssessmentCheckout")
  );
  assert.equal(
    source.includes(
      "Secure payment will open only after the exact tax and total are recorded."
    ),
    false
  );
});

function ownerAssessmentJobs(overrides = {}) {
  const target = { kind: "page", value: "/" };
  const evidence = [
    {
      evidenceId: DESKTOP_EVIDENCE_ID,
      jobId: JOB_ID,
      reviewTarget: target,
      viewport: "desktop",
      accessibleDescription:
        "Desktop homepage with the main navigation and hero visible.",
      mediaType: "image/webp",
      byteCount: 120000,
      capturedAt: "2026-08-05T12:30:00.000Z"
    },
    {
      evidenceId: PHONE_EVIDENCE_ID,
      jobId: JOB_ID,
      reviewTarget: target,
      viewport: "phone",
      accessibleDescription:
        "Phone homepage showing the crowded navigation above the hero.",
      mediaType: "image/jpeg",
      byteCount: 110000,
      capturedAt: "2026-08-05T12:31:00.000Z"
    }
  ];
  const finding = {
    findingId: FINDING_ID,
    jobId: JOB_ID,
    priority: 1,
    included: true,
    severity: "moderate",
    category: "responsive_design",
    primaryTarget: target,
    viewports: ["desktop", "phone"],
    summary: "The primary navigation becomes crowded on smaller screens.",
    recommendation:
      "Use one compact menu control on phone while keeping the desktop links visible.",
    evidenceIds: [DESKTOP_EVIDENCE_ID, PHONE_EVIDENCE_ID],
    revision: 1,
    findingDigest: "e".repeat(64),
    updatedAt: "2026-08-05T13:00:00.000Z"
  };
  const job = {
    jobId: JOB_ID,
    organizationId: ORGANIZATION_ID,
    organizationName: "Customer Studio",
    projectId: PROJECT_ID,
    projectName: "Customer Website",
    caseId: CASE_ID,
    customer: {
      customerId: CUSTOMER_ID,
      name: "Customer Owner",
      email: "customer@example.test"
    },
    state: "open",
    openedAt: "2026-08-05T12:10:00.000Z",
    deliveryDate: "2026-08-20",
    workDigest: "d".repeat(64),
    scope: {
      reviewTargets: [target],
      maximumWebsites: 1,
      maximumRepresentativePagesOrTypes: 5,
      maximumFindings: 10,
      requiredViewports: ["desktop", "phone"]
    },
    evidence,
    findings: [finding],
    delivery: null,
    ...overrides
  };
  return {
    schema: "sitesourcery.custom-services-owner-assessment-jobs/v1",
    jobs: [job]
  };
}

function assessmentCredit() {
  return {
    creditId: CREDIT_ID,
    amountMinor: 20000,
    currency: "USD",
    applicationScope: "custom_base_build",
    eligibleTierIds: CREDIT_TIERS,
    maximumApplications: 1,
    nonCash: true,
    deliveredAt: DELIVERED_AT,
    acceptanceCutoff: ACCEPTANCE_CUTOFF,
    state: "available",
    creditDigest: "f".repeat(64)
  };
}

function ownerDelivery() {
  return {
    schema: "sitesourcery.custom-services-owner-assessment-delivery/v1",
    state: "delivered",
    jobId: JOB_ID,
    reportId: REPORT_ID,
    deliveredAt: DELIVERED_AT,
    overallSummary:
      "The review found one responsive navigation issue with a direct repair path.",
    findingCount: 1,
    credit: assessmentCredit()
  };
}

test("owner assessment jobs accept only exact paid scope, evidence, findings, and delivery truth", () => {
  const open = ownerAssessmentJobs();
  assert.equal(verifiedOwnerAssessmentJobs(open), open);
  assert.equal(ownerAssessmentCoverageComplete(open.jobs[0]), true);
  assert.equal(
    ownerAssessmentEvidenceUrl(JOB_ID, DESKTOP_EVIDENCE_ID),
    `/api/v1/operator/custom-services/assessment-jobs/${JOB_ID}/evidence/${DESKTOP_EVIDENCE_ID}`
  );

  const evidenceReceipt = {
    schema: "sitesourcery.custom-services-owner-assessment-evidence/v1",
    evidence: open.jobs[0].evidence[0]
  };
  const findingReceipt = {
    schema: "sitesourcery.custom-services-owner-assessment-finding/v1",
    finding: open.jobs[0].findings[0]
  };
  assert.equal(
    verifiedOwnerAssessmentEvidence(evidenceReceipt, JOB_ID),
    evidenceReceipt
  );
  assert.equal(
    verifiedOwnerAssessmentFinding(findingReceipt, JOB_ID, 1),
    findingReceipt
  );
  assert.equal(
    verifiedOwnerAssessmentDelivery(ownerDelivery(), JOB_ID).reportId,
    REPORT_ID
  );

  const incomplete = ownerAssessmentJobs({
    evidence: [open.jobs[0].evidence[0]],
    findings: []
  });
  assert.equal(verifiedOwnerAssessmentJobs(incomplete), incomplete);
  assert.equal(ownerAssessmentCoverageComplete(incomplete.jobs[0]), false);

  assert.equal(
    verifiedOwnerAssessmentJobs(ownerAssessmentJobs({
      evidence: [
        {
          ...open.jobs[0].evidence[0],
          providerId: "must_stay_server_side"
        },
        open.jobs[0].evidence[1]
      ]
    })),
    null
  );
  assert.equal(
    verifiedOwnerAssessmentJobs(ownerAssessmentJobs({
      findings: [{
        ...open.jobs[0].findings[0],
        evidenceIds: [DESKTOP_EVIDENCE_ID]
      }]
    })),
    null
  );
});

function customerAssessmentReport() {
  const evidenceUrl = (evidenceId) =>
    `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-evidence/${evidenceId}`;
  return {
    schema: "sitesourcery.custom-services-assessment-report/v1",
    state: "delivered",
    job: {
      jobId: JOB_ID,
      state: "delivered",
      openedAt: "2026-08-05T12:10:00.000Z",
      deliveryDate: "2026-08-20",
      scope: {
        reviewTargets: [{ kind: "page", value: "/" }],
        requiredViewports: ["desktop", "phone"],
        maximumFindings: 10
      }
    },
    report: {
      schema: "sitesourcery.assessment-report/v1",
      reportId: REPORT_ID,
      jobId: JOB_ID,
      project: {
        organizationId: ORGANIZATION_ID,
        organizationName: "Customer Studio",
        projectId: PROJECT_ID,
        projectName: "Customer Website"
      },
      deliveredAt: DELIVERED_AT,
      scope: {
        maximumWebsites: 1,
        reviewTargets: [{ kind: "page", value: "/" }],
        requiredViewports: ["desktop", "phone"],
        maximumFindings: 10,
        expandedAssessmentState: "separately_quoted"
      },
      overallSummary:
        "The review found one responsive navigation issue with a direct repair path.",
      coverage: [
        {
          evidenceId: DESKTOP_EVIDENCE_ID,
          reviewTarget: { kind: "page", value: "/" },
          viewport: "desktop",
          accessibleDescription:
            "Desktop homepage with the main navigation and hero visible.",
          capturedAt: "2026-08-05T12:30:00.000Z",
          url: evidenceUrl(DESKTOP_EVIDENCE_ID)
        },
        {
          evidenceId: PHONE_EVIDENCE_ID,
          reviewTarget: { kind: "page", value: "/" },
          viewport: "phone",
          accessibleDescription:
            "Phone homepage showing the crowded navigation above the hero.",
          capturedAt: "2026-08-05T12:31:00.000Z",
          url: evidenceUrl(PHONE_EVIDENCE_ID)
        }
      ],
      findings: [
        {
          findingId: FINDING_ID,
          revision: 1,
          findingDigest: "e".repeat(64),
          priority: 1,
          severity: "moderate",
          category: "responsive_design",
          primaryTarget: { kind: "page", value: "/" },
          viewports: ["desktop", "phone"],
          summary:
            "The primary navigation becomes crowded on smaller screens.",
          recommendation:
            "Use one compact menu control on phone while keeping the desktop links visible.",
          evidence: [
            {
              evidenceId: DESKTOP_EVIDENCE_ID,
              viewport: "desktop",
              accessibleDescription:
                "Desktop homepage with the main navigation and hero visible.",
              url: evidenceUrl(DESKTOP_EVIDENCE_ID)
            },
            {
              evidenceId: PHONE_EVIDENCE_ID,
              viewport: "phone",
              accessibleDescription:
                "Phone homepage showing the crowded navigation above the hero.",
              url: evidenceUrl(PHONE_EVIDENCE_ID)
            }
          ]
        }
      ],
      buildCredit: {
        amountMinor: 20000,
        currency: "USD",
        applicationScope: "custom_base_build",
        eligibleTierIds: CREDIT_TIERS,
        maximumApplications: 1,
        nonCash: true,
        sameOrganizationAndProjectOnly: true,
        deliveredAt: DELIVERED_AT,
        acceptanceCutoff: ACCEPTANCE_CUTOFF
      }
    },
    credit: assessmentCredit()
  };
}

test("customer assessment report fails closed and exposes only delivered evidence and the exact same-project credit", () => {
  const delivered = customerAssessmentReport();
  assert.equal(
    verifiedCustomerAssessmentReport(delivered, PROJECT_ID),
    delivered
  );
  const daylightSavingCutoff = new Date(
    Date.parse(ACCEPTANCE_CUTOFF) + 60 * 60 * 1000
  ).toISOString();
  const daylightSavingDelivery = {
    ...delivered,
    report: {
      ...delivered.report,
      buildCredit: {
        ...delivered.report.buildCredit,
        acceptanceCutoff: daylightSavingCutoff
      }
    },
    credit: {
      ...delivered.credit,
      acceptanceCutoff: daylightSavingCutoff
    }
  };
  assert.equal(
    verifiedCustomerAssessmentReport(
      daylightSavingDelivery,
      PROJECT_ID
    ),
    daylightSavingDelivery
  );
  const inProgress = {
    schema: "sitesourcery.custom-services-assessment-report/v1",
    state: "in_progress",
    job: {
      ...delivered.job,
      state: "open"
    },
    report: null,
    credit: null
  };
  assert.equal(
    verifiedCustomerAssessmentReport(inProgress, PROJECT_ID),
    inProgress
  );
  assert.equal(
    verifiedCustomerAssessmentReport({
      ...inProgress,
      draftFindings: []
    }, PROJECT_ID),
    null
  );
  assert.equal(
    verifiedCustomerAssessmentReport({
      ...delivered,
      report: {
        ...delivered.report,
        stripePaymentIntentId: "pi_must_stay_server_side"
      }
    }, PROJECT_ID),
    null
  );
  assert.equal(
    verifiedCustomerAssessmentReport({
      ...delivered,
      report: {
        ...delivered.report,
        coverage: delivered.report.coverage.map((entry, index) =>
          index === 0
            ? { ...entry, url: "https://provider.example/evidence" }
            : entry
        )
      }
    }, PROJECT_ID),
    null
  );
  assert.equal(
    verifiedCustomerAssessmentReport({
      ...delivered,
      report: {
        ...delivered.report,
        buildCredit: {
          ...delivered.report.buildCredit,
          sameOrganizationAndProjectOnly: false
        }
      }
    }, PROJECT_ID),
    null
  );
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? "application/json"
          : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("H1H API methods preserve exact same-origin routes, bodies, and caller idempotency", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(
        200,
        url === "/api/v1/csrf"
          ? { csrfToken: "csrf_h1h" }
          : { ok: true }
      );
    },
    idempotencyFactory: () => {
      assert.fail("H1H writes must preserve caller command IDs");
    }
  });
  const bytesBase64 = Buffer.from([0xff, 0xd8, 0xff, 0x00])
    .toString("base64");
  await client.listOwnerAssessmentJobs();
  await client.getCustomServicesAssessmentReport(PROJECT_ID);
  await client.uploadOwnerAssessmentEvidence(
    JOB_ID,
    {
      organizationId: ORGANIZATION_ID,
      reviewTarget: { kind: "page", value: "/" },
      viewport: "desktop",
      accessibleDescription: "Desktop homepage screenshot evidence.",
      mediaType: "image/jpeg",
      bytesBase64
    },
    { idempotencyKey: "assessment-evidence-command" }
  );
  await client.putOwnerAssessmentFinding(
    JOB_ID,
    1,
    {
      organizationId: ORGANIZATION_ID,
      expectedRevision: 0,
      included: true,
      severity: "moderate",
      category: "usability",
      primaryTarget: { kind: "page", value: "/" },
      viewports: ["desktop"],
      summary: "The main action is difficult to find.",
      recommendation: "Move the main action beside the opening explanation.",
      evidenceIds: [DESKTOP_EVIDENCE_ID]
    },
    { idempotencyKey: "assessment-finding-command" }
  );
  await client.deliverOwnerAssessmentReport(
    JOB_ID,
    {
      expectedWorkDigest: "d".repeat(64),
      organizationId: ORGANIZATION_ID,
      overallSummary:
        "The bounded review is complete and ready for customer delivery."
    },
    { idempotencyKey: "assessment-delivery-command" }
  );

  assert.equal(
    calls[0].url,
    "/api/v1/operator/custom-services/assessment-jobs"
  );
  assert.equal(
    calls[1].url,
    `/api/v1/projects/${PROJECT_ID}/custom-services/assessment-report`
  );
  assert.equal(calls[2].url, "/api/v1/csrf");
  const writes = calls.slice(3);
  assert.deepEqual(
    writes.map(({ options }) => options.method),
    ["POST", "PUT", "POST"]
  );
  assert.deepEqual(
    writes.map(({ options }) => options.headers["Idempotency-Key"]),
    [
      "assessment-evidence-command",
      "assessment-finding-command",
      "assessment-delivery-command"
    ]
  );
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    organizationId: ORGANIZATION_ID,
    reviewTarget: { kind: "page", value: "/" },
    viewport: "desktop",
    accessibleDescription: "Desktop homepage screenshot evidence.",
    mediaType: "image/jpeg",
    bytesBase64
  });
  assert.equal(
    Object.hasOwn(JSON.parse(writes[2].options.body), "amountMinor"),
    false
  );
  assert.equal(
    JSON.parse(writes[2].options.body).expectedWorkDigest,
    "d".repeat(64)
  );
  assert.throws(
    () => client.uploadOwnerAssessmentEvidence(JOB_ID, {
      organizationId: ORGANIZATION_ID,
      reviewTarget: { kind: "page", value: "/" },
      viewport: "desktop",
      accessibleDescription: "Desktop homepage screenshot evidence.",
      mediaType: "image/jpeg",
      bytesBase64,
      providerId: "provider_claim"
    }),
    /unsupported fields/iu
  );
});

test("browser evidence preparation decodes, strips metadata, and bounds every screenshot", async () => {
  const browser = {
    btoa(value) {
      return Buffer.from(value, "binary").toString("base64");
    },
    async createImageBitmap(file) {
      return {
        width: file.size > 700 * 1024 ? 4000 : 800,
        height: file.size > 700 * 1024 ? 9000 : 600,
        close() {
          closed += 1;
        }
      };
    },
    document: {
      createElement(name) {
        assert.equal(name, "canvas");
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage(...args) {
                draw = args;
              }
            };
          },
          toBlob(callback, mediaType) {
            const bytes = this.width === 800 ? smallWebp : largeWebp;
            callback({
              type: mediaType,
              size: bytes.length,
              async arrayBuffer() {
                return bytes.buffer;
              }
            });
          }
        };
      }
    }
  };
  const jpeg = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10
  ]);
  const smallWebp = new Uint8Array(64);
  smallWebp.set([0x52, 0x49, 0x46, 0x46], 0);
  smallWebp.set([0x57, 0x45, 0x42, 0x50], 8);
  const largeWebp = new Uint8Array(600 * 1024);
  largeWebp.set([0x52, 0x49, 0x46, 0x46], 0);
  largeWebp.set([0x57, 0x45, 0x42, 0x50], 8);
  let closed = 0;
  let draw = null;
  const preparedSmall = await prepareAssessmentEvidenceFile({
    type: "image/jpeg",
    size: jpeg.length,
    async arrayBuffer() {
      return jpeg.buffer;
    }
  }, browser);
  assert.equal(preparedSmall.mediaType, "image/webp");
  assert.equal(preparedSmall.byteCount, smallWebp.length);
  assert.deepEqual(
    Buffer.from(preparedSmall.bytesBase64, "base64"),
    Buffer.from(smallWebp)
  );

  const largePng = new Uint8Array(700 * 1024 + 100);
  largePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const preparedLarge = await prepareAssessmentEvidenceFile({
    type: "image/png",
    size: largePng.length,
    async arrayBuffer() {
      return largePng.buffer;
    }
  }, browser);
  assert.equal(preparedLarge.mediaType, "image/webp");
  assert.equal(preparedLarge.byteCount, largeWebp.length);
  assert.ok(preparedLarge.byteCount <= 700 * 1024);
  assert.equal(closed, 2);
  assert.equal(draw[3], 2048);
  assert.equal(draw[4], 4608);
});

test("owner workbench is private, phone-friendly, evidence-bound, and delivery-gated", async () => {
  const source = await readFile(
    new URL(
      "../../abracadabra/app/abracadabra-customer-control-dom.js",
      import.meta.url
    ),
    "utf8"
  );
  for (const copy of [
    "Owner assessment workbench",
    "Prepare and upload screenshot",
    "Customer-safe findings (up to 10)",
    "Deliver immutable assessment report",
    "Draft findings stay private",
    "one-use, non-cash $200 credit"
  ]) assert.ok(source.includes(copy), copy);
  for (const boundary of [
    "listOwnerAssessmentJobs",
    "uploadOwnerAssessmentEvidence",
    "putOwnerAssessmentFinding",
    "deliverOwnerAssessmentReport",
    "getCustomServicesAssessmentReport",
    "ownerAssessmentCoverageComplete"
  ]) assert.ok(source.includes(boundary), boundary);
  assert.ok(source.includes("image/jpeg,image/png,image/webp"));
  assert.ok(source.includes("minmax(min(100%, 16rem), 1fr)"));
  assert.ok(source.includes("minmax(0, 1fr)"));
  assert.match(
    source,
    /\[401, 403, 503\]\.includes\(error\.status\)[\s\S]*?"unavailable"/u
  );
});
