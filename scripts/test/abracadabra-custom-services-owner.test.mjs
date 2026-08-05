import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  ownerReviewTargets,
  safeCheckoutDestination,
  verifiedAssessmentCheckout,
  verifiedAssessmentInvoice,
  verifiedOwnerAssessmentQueue
} = require(
  "../../abracadabra/app/abracadabra-customer-control-dom.js"
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
    schema: "sitesourcery.custom-services-assessment-invoice/v1",
    state: checkoutAvailable
      ? "checkout_available"
      : "tax_calculation_pending",
    invoice: {
      invoiceId: "60000000-0000-4000-8000-000000000001",
      invoiceNumber: "SSA-60000000000040008000000000000001",
      purpose: "assessment",
      quote: {},
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
        message: checkoutAvailable
          ? "Secure checkout is available. No charge occurred."
          : "No payment has been requested and no charge occurred."
      },
      invoiceDigest: "a".repeat(64),
      issuedAt: "2026-08-05T12:00:00.000Z",
      createdAt: "2026-08-05T12:00:01.000Z"
    },
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
  assert.equal(verifiedAssessmentInvoice(held), held);
  assert.equal(verifiedAssessmentInvoice(available), available);
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
