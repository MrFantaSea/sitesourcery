import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  ownerReviewTargets,
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
