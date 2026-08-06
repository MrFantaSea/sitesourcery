import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createClient } = require(
  "../../abracadabra/app/abracadabra-api.js"
);
const {
  verifiedCustomBuildProgress,
  verifiedCustomerCustomBuildCheckout,
  verifiedCustomerCustomBuildInvoice
} = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
);

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const QUOTE_ID = "50000000-0000-4000-8000-000000000001";
const INVOICE_ID = "60000000-0000-4000-8000-000000000001";
const JOB_ID = "80000000-0000-4000-8000-000000000001";
const INVOICE_NUMBER = "SSCB-60000000000040008000000000000001";
const ISSUED_AT = "2026-08-05T14:00:00.000Z";
const PAYMENT_DEADLINE = "2026-08-12T14:00:00.000Z";
const CHECKOUT_EXPIRES_AT = "2026-08-06T14:00:00.000Z";
const INVOICE_DIGEST = "c".repeat(64);
const QUOTE_DIGEST = "a".repeat(64);
const DISCLOSURE_DIGEST = "b".repeat(64);

const expectation = Object.freeze({
  acceptedDisclosureDigest: DISCLOSURE_DIGEST,
  acceptedQuoteDigest: QUOTE_DIGEST,
  creditMinor: 20000,
  finalHandoffMinor: 60000,
  grossStartMinor: 60000,
  issuedAt: ISSUED_AT,
  quoteId: QUOTE_ID,
  subtotalMinor: 40000,
  tierId: "site"
});

function projection(state = "checkout_available") {
  if (state === "not_available") {
    return {
      schema: "sitesourcery.custom-build-start-invoice/v1",
      state,
      invoice: null,
      action: { available: false, reason: "invoice_not_available" },
      job: null
    };
  }
  const paid = state === "paid";
  const ready = state === "checkout_ready";
  return {
    schema: "sitesourcery.custom-build-start-invoice/v1",
    state,
    invoice: {
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      invoiceDigest: INVOICE_DIGEST,
      quoteId: QUOTE_ID,
      tierId: "site",
      acceptedQuoteDigest: QUOTE_DIGEST,
      acceptedDisclosureDigest: DISCLOSURE_DIGEST,
      issuedAt: ISSUED_AT,
      paymentDeadline: PAYMENT_DEADLINE,
      lines: [
        {
          lineNumber: 1,
          componentKey: "custom_build_start",
          displayName: "Site first installment",
          amountMinor: 60000,
          currency: "USD"
        },
        {
          lineNumber: 2,
          componentKey: "assessment_build_credit",
          displayName: "Website assessment build credit",
          amountMinor: -20000,
          currency: "USD"
        }
      ],
      subtotal: { amountMinor: 40000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout"
      },
      credit: {
        amountMinor: 20000,
        state: paid
          ? "settled"
          : state === "reconciliation_required"
            ? "reconciliation_required"
            : "reserved"
      },
      finalHandoff: {
        amountMinor: 60000,
        state: "due_before_handoff"
      },
      payment: {
        chargeOccurred: paid,
        checkoutUrl: ready
          ? "https://checkout.stripe.com/c/pay/custom_build_test"
          : null,
        checkoutExpiresAt: ready ? CHECKOUT_EXPIRES_AT : null
      }
    },
    action: {
      available: state === "checkout_available",
      reason: state === "checkout_available" ? null : state
    },
    job: paid
      ? {
          jobId: JOB_ID,
          state: "open",
          openedAt: "2026-08-05T14:05:00.000Z",
          tierId: "site",
          scopeStatement:
            "Build the approved four-page Custom website from the accepted exact scope.",
          footprint: {
            craftedPages: 4,
            sections: 16,
            uniqueLayouts: 4,
            contentWords: 1800,
            suppliedMedia: 12
          },
          targetCompletionDate: "2026-09-15",
          firstPayment: {
            grossMinor: 60000,
            creditMinor: 20000,
            paidSubtotalMinor: 40000,
            currency: "USD"
          },
          finalHandoff: {
            amountMinor: 60000,
            currency: "USD",
            state: "unpaid"
          }
        }
      : null
  };
}

function checkout() {
  return {
    schema: "sitesourcery.custom-build-start-checkout/v1",
    state: "ready",
    checkout: {
      invoiceId: INVOICE_ID,
      invoiceNumber: INVOICE_NUMBER,
      url: "https://checkout.stripe.com/c/pay/custom_build_test",
      expiresAt: CHECKOUT_EXPIRES_AT,
      subtotal: { amountMinor: 40000, currency: "USD" },
      tax: { amountMinor: null, state: "calculated_at_checkout" },
      total: {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout"
      },
      chargeOccurred: false
    }
  };
}

function progressProjection(activeRequest = null) {
  const progress = {
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
        state: "pending"
      },
      { key: "quality", label: "Final checks", state: "pending" }
    ]
  };
  let status = { kind: "building", label: "Building" };
  if (activeRequest?.kind === "outside_dependency") {
    status = {
      kind: "waiting_on_dependency",
      label: "Waiting on an outside dependency"
    };
  } else if (activeRequest?.state === "answered") {
    status = {
      kind: "reviewing_response",
      label: "Site Sourcery is reviewing your response"
    };
  } else if (activeRequest) {
    status = {
      kind: "action_needed",
      label: "Action needed from you"
    };
  }
  return {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "active",
    jobId: JOB_ID,
    targetCompletionDate: "2026-09-15",
    targetDateUnderReview:
      activeRequest?.targetDateImpact === "under_review",
    status,
    progress,
    activeRequest
  };
}

function workRequest(overrides = {}) {
  return {
    requestId: "90000000-0000-4000-8000-000000000001",
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
    ...overrides
  };
}

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

test("Custom build first-payment invoice accepts every frozen customer state", () => {
  for (const state of [
    "not_available",
    "checkout_available",
    "checkout_ready",
    "payment_held",
    "payment_window_expired",
    "reconciliation_required",
    "paid"
  ]) {
    const candidate = projection(state);
    assert.equal(
      verifiedCustomerCustomBuildInvoice(candidate, expectation),
      candidate,
      state
    );
  }
});

test("Custom build invoice rejects amount, credit, deadline, and provider-ID tampering", () => {
  const valid = projection();
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        lines: [
          { ...valid.invoice.lines[0], amountMinor: 65000 },
          valid.invoice.lines[1]
        ],
        subtotal: { amountMinor: 45000, currency: "USD" }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        credit: { amountMinor: 1, state: "reserved" }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...valid,
      invoice: {
        ...valid.invoice,
        paymentDeadline: "2026-08-13T14:00:00.000Z"
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("checkout_ready"),
      invoice: {
        ...projection("checkout_ready").invoice,
        payment: {
          ...projection("checkout_ready").invoice.payment,
          checkoutSessionId: "cs_test_must_stay_server_side"
        }
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("paid"),
      job: {
        ...projection("paid").job,
        paymentIntentId: "pi_test_must_stay_server_side"
      }
    }, expectation),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildInvoice({
      ...projection("paid"),
      job: {
        ...projection("paid").job,
        firstPayment: {
          ...projection("paid").job.firstPayment,
          paidSubtotalMinor: 1
        }
      }
    }, expectation),
    null
  );
});

test("Custom build Checkout exposes only the retained Stripe URL and exact invoice facts", () => {
  const invoice = projection().invoice;
  const valid = checkout();
  assert.equal(
    verifiedCustomerCustomBuildCheckout(
      valid,
      invoice,
      ISSUED_AT
    ),
    valid
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        checkoutSessionId: "cs_test_must_stay_server_side"
      }
    }, invoice, ISSUED_AT),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        subtotal: { amountMinor: 1, currency: "USD" }
      }
    }, invoice, ISSUED_AT),
    null
  );
  assert.equal(
    verifiedCustomerCustomBuildCheckout({
      ...valid,
      checkout: {
        ...valid.checkout,
        url: "https://checkout.stripe.com.evil.test/c/pay/fake"
      }
    }, invoice, ISSUED_AT),
    null
  );
});

test("Custom build payment API mirrors assessment routes and sends only the digest", async () => {
  const calls = [];
  const client = createClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(
        200,
        url === "/api/v1/csrf"
          ? { csrfToken: "csrf_custom_build" }
          : { ok: true }
      );
    },
    idempotencyFactory: () => {
      assert.fail("Custom build Checkout must preserve its command ID");
    }
  });

  await client.getCustomServicesCustomBuildInvoice(PROJECT_ID);
  await client.createCustomServicesCustomBuildCheckout(
    PROJECT_ID,
    INVOICE_ID,
    { invoiceDigest: INVOICE_DIGEST },
    { idempotencyKey: "custom-build-checkout-command" }
  );

  assert.equal(
    calls[0].url,
    `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-invoice`
  );
  assert.equal(calls[1].url, "/api/v1/csrf");
  assert.equal(
    calls[2].url,
    `/api/v1/projects/${PROJECT_ID}/custom-services/custom-build-invoices/${INVOICE_ID}/checkout-command`
  );
  assert.equal(calls[2].options.method, "POST");
  assert.equal(
    calls[2].options.headers["Idempotency-Key"],
    "custom-build-checkout-command"
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    invoiceDigest: INVOICE_DIGEST
  });

  for (const claimed of [
    { commandId: "browser-command" },
    { amountMinor: 40000 },
    { taxMinor: 1 },
    { creditMinor: 20000 },
    { tierId: "site" },
    { jobState: "open" }
  ]) {
    assert.throws(
      () => client.createCustomServicesCustomBuildCheckout(
        PROJECT_ID,
        INVOICE_ID,
        { invoiceDigest: INVOICE_DIGEST, ...claimed },
        { idempotencyKey: "custom-build-checkout-command" }
      ),
      /unsupported fields/iu
    );
  }
});

test("Custom build customer panel keeps all payment states plain and phone-friendly", async () => {
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
    "Gross first installment",
    "Assessment credit",
    "Net subtotal",
    "Calculated securely at Checkout",
    "Payment deadline",
    "Final handoff amount",
    "Continue to secure payment",
    "Open retained secure payment page",
    "Secure payment is not open yet",
    "The seven-day payment window ended",
    "Please do not try another payment",
    "Your Custom website project is open",
    "First payment verified; the $200 assessment credit was applied",
    "USD before Checkout tax",
    "First payment subtotal",
    "Scope",
    "Bound footprint"
  ]) assert.ok(source.includes(copy), copy);
  assert.match(
    source,
    /selected\.state === "checkout_available"[\s\S]*?"Continue to secure payment"/u
  );
  assert.ok(source.includes("data-custom-build-invoice"));
  assert.match(
    css,
    /\.customer-owner-custom-build-card>dl,\.customer-custom-build-owner-review>dl\{grid-template-columns:1fr\}/u
  );
  assert.match(
    css,
    /\.customer-owner-assessment-job-summary\{[^}]*min-height:44px/u
  );
});

test("Custom-build progress verifies calm stages, milestones, and each bounded request state", () => {
  const active = progressProjection();
  assert.equal(verifiedCustomBuildProgress(active), active);

  const actionNeeded = progressProjection(workRequest());
  assert.equal(
    verifiedCustomBuildProgress(actionNeeded),
    actionNeeded
  );

  const answeredRequest = workRequest({
    revision: 2,
    state: "answered",
    response: {
      kind: "provided",
      note: "Use the shorter approved contact wording.",
      answeredAt: "2026-08-06T15:10:00.000Z"
    },
    updatedAt: "2026-08-06T15:10:00.000Z"
  });
  const reviewing = progressProjection(answeredRequest);
  assert.equal(verifiedCustomBuildProgress(reviewing), reviewing);

  const waitingRequest = workRequest({
    kind: "outside_dependency",
    title: "Waiting for the provider maintenance window",
    message:
      "The provider maintenance window must end before final checks continue.",
    safeInstructions:
      "No customer response is needed while Site Sourcery monitors the provider.",
    targetDateImpact: "under_review",
    responseRequired: false
  });
  const waiting = progressProjection(waitingRequest);
  assert.equal(verifiedCustomBuildProgress(waiting), waiting);

  const delegatedRequest = workRequest({
    kind: "delegated_access",
    title: "Share a delegated editor role",
    message:
      "Please use the provider sharing screen to add the requested editor role.",
    safeInstructions:
      "Use delegated sharing only and reply after the invitation is sent.",
    targetDateImpact: "under_review",
    access: {
      providerLabel: "Example CMS",
      accountLabel: "Marketing website",
      delegatedRole: "Site editor",
      expiresAt: "2026-08-20T17:00:00.000Z"
    }
  });
  const delegated = progressProjection(delegatedRequest);
  assert.equal(verifiedCustomBuildProgress(delegated), delegated);

  const notAvailable = {
    schema: "sitesourcery.custom-build-progress/v1",
    state: "not_available",
    jobId: null,
    targetCompletionDate: null,
    targetDateUnderReview: false,
    status: null,
    progress: null,
    activeRequest: null
  };
  assert.equal(verifiedCustomBuildProgress(notAvailable), notAvailable);
});

test("Custom-build progress rejects status, milestone, credential, and access-verification claims", () => {
  const valid = progressProjection(workRequest());
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      status: { kind: "checking", label: "Checking the work" }
    }),
    null
  );
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      progress: {
        ...valid.progress,
        milestones: valid.progress.milestones.map((milestone, index) =>
          index === 0 ? { ...milestone, completion: 100 } : milestone
        )
      }
    }),
    null
  );
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      progress: {
        ...valid.progress,
        summary: "The API key is available in this unsafe update."
      }
    }),
    null
  );
  const delegated = progressProjection(workRequest({
    kind: "delegated_access",
    title: "Share a delegated editor role",
    message:
      "Please use the provider sharing screen to add the requested editor role.",
    safeInstructions:
      "Use delegated sharing only and reply after the invitation is sent.",
    access: {
      providerLabel: "Example CMS",
      accountLabel: "Marketing website",
      delegatedRole: "Site editor",
      expiresAt: "2026-08-20T17:00:00.000Z",
      verified: true
    }
  }));
  assert.equal(verifiedCustomBuildProgress(delegated), null);
  assert.equal(
    verifiedCustomBuildProgress({
      ...valid,
      targetDateUnderReview: true
    }),
    null
  );
});

test("Custom-build progress surfaces remain bounded, credential-safe, and responsive", async () => {
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
    "Preparing",
    "Building",
    "Checking the work",
    "Action needed from you",
    "Site Sourcery is reviewing your response",
    "Waiting on an outside dependency",
    "Safe response note — no credentials",
    "A response does not by itself confirm that provider access works.",
    "A customer response does not verify provider access.",
    "Post a progress update",
    "Open one customer request",
    "Resolved after review",
    "Withdrawn"
  ]) assert.ok(source.includes(copy), copy);
  for (const control of [
    "data-customer-custom-build-progress",
    "data-custom-build-response-form",
    "data-owner-progress-form",
    "data-owner-request-form",
    "data-owner-resolution-form"
  ]) assert.ok(source.includes(control), control);
  const progressUi = source.slice(
    source.indexOf("function customBuildMilestoneStateLabel"),
    source.indexOf("function customBuildLocalDateTime")
  );
  assert.doesNotMatch(progressUi, /percentage/iu);
  assert.doesNotMatch(
    progressUi,
    /assessmentField\([\s\S]{0,120}"(?:password|passcode|token|apiKey|verificationCode)"/iu
  );
  assert.match(
    source,
    /customBuildCommandId\([\s\S]*?"respond"[\s\S]*?request\.requestId/u
  );
  assert.match(
    source,
    /customBuildCommandId\([\s\S]*?operation[\s\S]*?subjectId/u
  );
  assert.match(
    css,
    /\.customer-custom-build-progress-response input,[^{]+\{min-height:44px\}/u
  );
  assert.match(
    css,
    /@media\(max-width:44rem\)[\s\S]*?\.customer-custom-build-progress-facts,[^{]+\{grid-template-columns:1fr\}/u
  );
});
