import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA,
  CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
  projectCustomServicesAssessmentQuote
} from "../custom-services-assessment-quote.mjs";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const CASE_ID =
  "40000000-0000-4000-8000-000000000001";
const INTAKE_ID =
  "50000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "60000000-0000-4000-8000-000000000001";
const REVISION_ID =
  "70000000-0000-4000-8000-000000000001";
const OFFERING_ID =
  "80000000-0000-4000-8000-000000000001";
const OTHER_ID =
  "90000000-0000-4000-8000-000000000001";
const LATER_INTAKE_ID =
  "a0000000-0000-4000-8000-000000000001";
const POLICY_ID =
  "00000000-0000-4000-8000-000000000341";
const LEGAL_DOCUMENT_ID =
  "00000000-0000-4000-8000-000000000342";

const INTAKE_DIGEST = "a".repeat(64);
const SCOPE_DIGEST = "b".repeat(64);
const QUOTE_DIGEST = "c".repeat(64);
const DISCLOSURE_DIGEST = "d".repeat(64);
const LATER_INTAKE_DIGEST = "e".repeat(64);
const COMMERCIAL_DIGEST =
  "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";

const QUOTE_CREATED_AT = "2026-08-08T09:00:00.000Z";
const ISSUED_AT = "2026-08-09T12:00:00.000Z";
const QUOTE_UPDATED_AT = "2026-08-09T12:00:01.000Z";
const ACCEPTED_AT = "2026-08-10T11:00:00.000Z";
const OBSERVED_AT = "2026-08-10T12:00:00.000Z";
const EXPIRES_AT = "2026-08-30T12:00:00.000Z";
const DELIVERY_DATE = "2026-09-15";

function scope(overrides = {}) {
  return {
    actorId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function currentProfile(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    revision: 3,
    verifiedCurrent: true,
    ...overrides
  };
}

function currentIntake(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    intakeId: INTAKE_ID,
    revision: 2,
    factsDigest: INTAKE_DIGEST,
    state: "submitted",
    verifiedLatest: true,
    ...overrides
  };
}

function quoteRevision(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    quoteRevision: 4,
    offeringId: OFFERING_ID,
    intakeId: INTAKE_ID,
    projectProfileRevision: 3,
    intakeRevision: 2,
    intakeFactsDigest: INTAKE_DIGEST,
    reviewTargets: ["page:/about", "type:product_page"],
    policyId: POLICY_ID,
    scopeBoundaryDigest: SCOPE_DIGEST,
    policyScopeBoundaryDigest: SCOPE_DIGEST,
    serviceAmountMinor: 20000,
    providerDirectAmountMinor: 0,
    creditAmountMinor: 0,
    subtotalMinor: 20000,
    currency: "USD",
    taxState: "calculation_required",
    paymentSchedule: "full_before_work",
    maximumWebsites: 1,
    maximumRepresentativePagesOrTypes: 5,
    maximumFindings: 10,
    desktopReviewIncluded: true,
    phoneReviewIncluded: true,
    expandedAssessmentState: "separately_quoted",
    commercialContractId: "SS-CUSTOM-SERVICES-2026-08-05.1",
    commercialContractDigest: COMMERCIAL_DIGEST,
    legalDocumentId: LEGAL_DOCUMENT_ID,
    deliveryDate: DELIVERY_DATE,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    quoteDigest: QUOTE_DIGEST,
    disclosureDigest: DISCLOSURE_DIGEST,
    recomputedQuoteDigest: QUOTE_DIGEST,
    recomputedDisclosureDigest: DISCLOSURE_DIGEST,
    createdAt: ISSUED_AT,
    ...overrides
  };
}

function acceptance(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    quoteId: QUOTE_ID,
    revisionId: REVISION_ID,
    quoteRevision: 4,
    acceptedByCustomerId: CUSTOMER_ID,
    source: "account",
    acceptanceStatement: "accepted_exact_quote_and_delivery_date",
    acceptedQuoteDigest: QUOTE_DIGEST,
    acceptedDisclosureDigest: DISCLOSURE_DIGEST,
    legalDocumentId: LEGAL_DOCUMENT_ID,
    acceptedAt: ACCEPTED_AT,
    ...overrides
  };
}

function quote(overrides = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    customerId: CUSTOMER_ID,
    caseId: CASE_ID,
    offeringId: OFFERING_ID,
    quoteId: QUOTE_ID,
    purpose: "assessment",
    currentRevision: 4,
    revision: quoteRevision(),
    acceptance: null,
    createdAt: QUOTE_CREATED_AT,
    updatedAt: QUOTE_UPDATED_AT,
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    schema: CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
    observedAt: OBSERVED_AT,
    currentProfile: currentProfile(),
    currentIntake: currentIntake(),
    quote: quote(),
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    scope: scope(),
    snapshot: snapshot(),
    ...overrides
  };
}

function withRevision(overrides) {
  return input({
    snapshot: snapshot({
      quote: quote({ revision: quoteRevision(overrides) })
    })
  });
}

function acceptedInput(overrides = {}) {
  return input({
    snapshot: snapshot({
      quote: quote({ acceptance: acceptance() }),
      ...overrides
    })
  });
}

function assertError(action, code, status) {
  assert.throws(
    action,
    (error) => error?.code === code && error?.status === status
  );
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeeplyFrozen(child);
  }
}

function allKeys(value, selected = []) {
  if (value === null || typeof value !== "object") return selected;
  for (const [key, child] of Object.entries(value)) {
    selected.push(key);
    allKeys(child, selected);
  }
  return selected;
}

test("exports exact input snapshot and customer output schemas", () => {
  assert.equal(
    CUSTOM_SERVICES_ASSESSMENT_QUOTE_SNAPSHOT_SCHEMA,
    "sitesourcery.custom-services-assessment-quote-snapshot/v1"
  );
  assert.equal(
    CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA,
    "sitesourcery.custom-services-assessment-quote/v1"
  );
});

test("not_available exposes no invented quote or acceptance action", () => {
  const projection = projectCustomServicesAssessmentQuote(
    input({
      snapshot: snapshot({
        currentProfile: null,
        currentIntake: null,
        quote: null
      })
    })
  );

  assert.deepEqual(projection, {
    schema: CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA,
    state: "not_available",
    quote: null,
    actions: {
      acceptQuote: {
        available: false,
        reason: "quote_not_available",
        message: "There is no assessment quote to accept yet.",
        acceptanceStatement: null
      }
    }
  });
  assertDeeplyFrozen(projection);
});

test("review_required exposes only the bounded $200 customer contract", () => {
  const projection = projectCustomServicesAssessmentQuote(input());

  assert.deepEqual(projection, {
    schema: CUSTOM_SERVICES_ASSESSMENT_QUOTE_SCHEMA,
    state: "review_required",
    quote: {
      quoteId: QUOTE_ID,
      revision: 4,
      quoteDigest: QUOTE_DIGEST,
      disclosureDigest: DISCLOSURE_DIGEST,
      servicePrice: {
        amountMinor: 20000,
        currency: "USD",
        formatted: "$200.00"
      },
      tax: {
        state: "calculation_required",
        message:
          "Tax, if applicable, will be calculated on a later separate invoice. This quote is not a payable total."
      },
      payment: {
        schedule: "full_before_work",
        invoice: "later_separate_invoice",
        message:
          "After acceptance, Site Sourcery will issue a separate invoice. That invoice must be paid in full before work begins."
      },
      scope: {
        service: "Website assessment",
        maximumWebsites: 1,
        reviewTargets: [
          { kind: "page", value: "/about" },
          { kind: "page_type", value: "product_page" }
        ],
        includedViewports: ["desktop", "phone"],
        maximumFindings: 10,
        expandedAssessment: {
          state: "separately_quoted",
          message: "A larger assessment requires a separate quote."
        }
      },
      dates: {
        issuedAt: ISSUED_AT,
        expiresAt: EXPIRES_AT,
        deliveryDate: DELIVERY_DATE
      },
      acceptedAt: null
    },
    actions: {
      acceptQuote: {
        available: true,
        reason: null,
        message: "Accept this exact quote and its delivery date.",
        acceptanceStatement: "accepted_exact_quote_and_delivery_date"
      }
    }
  });
  assertDeeplyFrozen(projection);
});

test("expired uses the observation boundary and cannot be accepted", () => {
  const projection = projectCustomServicesAssessmentQuote(
    withRevision({ expiresAt: OBSERVED_AT })
  );

  assert.equal(projection.state, "expired");
  assert.deepEqual(projection.actions.acceptQuote, {
    available: false,
    reason: "quote_expired",
    message: "This assessment quote has expired. Ask for a current quote.",
    acceptanceStatement: null
  });
});

test("newer verified profile or intake facts require a revised quote", () => {
  const newerProfile = projectCustomServicesAssessmentQuote(
    input({
      snapshot: snapshot({
        currentProfile: currentProfile({ revision: 4 })
      })
    })
  );
  const newerIntake = projectCustomServicesAssessmentQuote(
    input({
      snapshot: snapshot({
        currentIntake: currentIntake({
          intakeId: LATER_INTAKE_ID,
          revision: 3,
          factsDigest: LATER_INTAKE_DIGEST
        })
      })
    })
  );

  for (const projection of [newerProfile, newerIntake]) {
    assert.equal(projection.state, "changes_required");
    assert.deepEqual(projection.actions.acceptQuote, {
      available: false,
      reason: "customer_facts_changed",
      message:
        "Your current website details changed. Ask for a revised quote.",
      acceptanceStatement: null
    });
  }
});

test("accepted binds the current quote revision and both exact digests", () => {
  const projection = projectCustomServicesAssessmentQuote(
    acceptedInput({
      currentProfile: currentProfile({ revision: 4 }),
      currentIntake: currentIntake({
        intakeId: LATER_INTAKE_ID,
        revision: 3,
        factsDigest: LATER_INTAKE_DIGEST
      })
    })
  );

  assert.equal(projection.state, "accepted");
  assert.equal(projection.quote.acceptedAt, ACCEPTED_AT);
  assert.deepEqual(projection.actions.acceptQuote, {
    available: false,
    reason: "quote_already_accepted",
    message: "This exact assessment quote is already accepted.",
    acceptanceStatement: null
  });
  assertDeeplyFrozen(projection);
});

test("input, scope, snapshot, and every repository row reject extra keys", () => {
  const extraInput = input();
  extraInput.providerAuthority = true;
  const extraScope = scope();
  extraScope.tenantId = ORGANIZATION_ID;
  const extraSnapshot = snapshot();
  extraSnapshot.credentials = null;
  const extraProfile = currentProfile();
  extraProfile.profileId = PROJECT_ID;
  const extraIntake = currentIntake();
  extraIntake.operatorId = OTHER_ID;
  const extraQuote = quote();
  extraQuote.invoiceId = OTHER_ID;
  const extraRevision = quoteRevision();
  extraRevision.paymentId = OTHER_ID;
  const extraAcceptance = acceptance();
  extraAcceptance.requestId = OTHER_ID;

  assertError(
    () => projectCustomServicesAssessmentQuote(extraInput),
    "invalid_input",
    400
  );
  assertError(
    () => projectCustomServicesAssessmentQuote(input({ scope: extraScope })),
    "invalid_input",
    400
  );
  for (const selected of [
    input({ snapshot: extraSnapshot }),
    input({ snapshot: snapshot({ currentProfile: extraProfile }) }),
    input({ snapshot: snapshot({ currentIntake: extraIntake }) }),
    input({ snapshot: snapshot({ quote: extraQuote }) }),
    input({
      snapshot: snapshot({
        quote: quote({ revision: extraRevision })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ acceptance: extraAcceptance })
      })
    })
  ]) {
    assertError(
      () => projectCustomServicesAssessmentQuote(selected),
      "repository_conflict",
      500
    );
  }
});

test("malformed scope and repository contracts fail closed", () => {
  assertError(
    () =>
      projectCustomServicesAssessmentQuote(
        input({ scope: scope({ projectId: "not-a-uuid" }) })
      ),
    "invalid_input",
    400
  );

  const malformed = [
    input({
      snapshot: snapshot({
        schema: "sitesourcery.custom-services-assessment-quote-snapshot/v0"
      })
    }),
    input({ snapshot: snapshot({ observedAt: "2026-08-10" }) }),
    input({
      snapshot: snapshot({
        currentProfile: currentProfile({ revision: 0 })
      })
    }),
    input({
      snapshot: snapshot({
        currentIntake: currentIntake({ state: "draft" })
      })
    }),
    input({ snapshot: snapshot({ quote: quote({ purpose: "rescue" }) }) }),
    input({
      snapshot: snapshot({ quote: quote({ currentRevision: 0 }) })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ revision: quoteRevision({ quoteRevision: 5 }) })
      })
    })
  ];
  for (const selected of malformed) {
    assertError(
      () => projectCustomServicesAssessmentQuote(selected),
      "repository_conflict",
      500
    );
  }
});

test("actor, tenant, project, customer, and hidden row substitutions are opaque", () => {
  const crossBound = [
    input({ scope: scope({ actorId: OTHER_ID }) }),
    input({
      snapshot: snapshot({
        currentProfile: currentProfile({ organizationId: OTHER_ID })
      })
    }),
    input({
      snapshot: snapshot({
        currentIntake: currentIntake({ projectId: OTHER_ID })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ customerId: OTHER_ID })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ caseId: OTHER_ID })
      })
    }),
    withRevision({ organizationId: OTHER_ID }),
    withRevision({ caseId: OTHER_ID }),
    withRevision({ offeringId: OTHER_ID }),
    withRevision({ quoteId: OTHER_ID }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({ acceptedByCustomerId: OTHER_ID })
        })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ acceptance: acceptance({ revisionId: OTHER_ID }) })
      })
    })
  ];

  for (const selected of crossBound) {
    assertError(
      () => projectCustomServicesAssessmentQuote(selected),
      "project_unavailable",
      404
    );
  }
});

test("money, tax, invoice timing, and bounded scope cannot drift", () => {
  const moneyDrifts = [
    { serviceAmountMinor: 19999 },
    { providerDirectAmountMinor: 1 },
    { creditAmountMinor: 500 },
    { subtotalMinor: 25000 },
    { currency: "EUR" },
    { taxState: "zero" },
    { taxState: "included" },
    { paymentSchedule: "deposit" }
  ];
  const scopeDrifts = [
    { maximumWebsites: 2 },
    { maximumRepresentativePagesOrTypes: 10 },
    { maximumFindings: 11 },
    { desktopReviewIncluded: false },
    { phoneReviewIncluded: false },
    { expandedAssessmentState: "included" }
  ];

  for (const drift of [...moneyDrifts, ...scopeDrifts]) {
    assertError(
      () => projectCustomServicesAssessmentQuote(withRevision(drift)),
      "repository_conflict",
      500
    );
  }
});

test("targets must be safe, unique, sorted, and canonical within the 1-5 bound", () => {
  const invalidTargets = [
    [],
    [
      "page:/1",
      "page:/2",
      "page:/3",
      "page:/4",
      "page:/5",
      "page:/6"
    ],
    ["page:/about", "page:/about"],
    ["type:product_page", "page:/about"],
    ["page:about"],
    ["type:a"],
    ["page:/../private"],
    ["page:/password-reset"],
    ["page:/sk_live_abcdefgh"],
    [" page:/about"],
    ["page:/about\n"]
  ];

  for (const reviewTargets of invalidTargets) {
    assertError(
      () =>
        projectCustomServicesAssessmentQuote(
          withRevision({ reviewTargets })
        ),
      "repository_conflict",
      500
    );
  }
});

test("quote, expiry, delivery, and acceptance chronology fail closed", () => {
  const invalidQuotes = [
    withRevision({
      issuedAt: "2026-08-11T12:00:00.000Z",
      createdAt: "2026-08-11T12:00:00.000Z"
    }),
    withRevision({ expiresAt: ISSUED_AT }),
    withRevision({ expiresAt: "2026-09-09T12:00:00.001Z" }),
    withRevision({ deliveryDate: "2026-08-09" }),
    withRevision({ deliveryDate: "2027-08-10" }),
    withRevision({ deliveryDate: "2026-02-30" }),
    withRevision({ createdAt: "2026-08-09T12:00:00.001Z" }),
    input({
      snapshot: snapshot({
        quote: quote({ createdAt: "2026-08-09T12:00:00.001Z" })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ updatedAt: "2026-08-09T11:59:59.999Z" })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({ updatedAt: "2026-08-10T12:00:00.001Z" })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({
            acceptedAt: "2026-08-09T12:00:00.999Z"
          })
        })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({ acceptedAt: EXPIRES_AT })
        })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({
            acceptedAt: "2026-08-10T12:00:00.001Z"
          })
        })
      })
    })
  ];

  for (const selected of invalidQuotes) {
    assertError(
      () => projectCustomServicesAssessmentQuote(selected),
      "repository_conflict",
      500
    );
  }
});

test("stale claimed-current profile and intake bindings are rejected", () => {
  const staleSnapshots = [
    snapshot({
      currentProfile: currentProfile({ verifiedCurrent: false })
    }),
    snapshot({
      currentIntake: currentIntake({ verifiedLatest: false })
    }),
    snapshot({ currentProfile: currentProfile({ revision: 2 }) }),
    snapshot({ currentIntake: currentIntake({ revision: 1 }) }),
    snapshot({
      currentIntake: currentIntake({ intakeId: LATER_INTAKE_ID })
    }),
    snapshot({
      currentIntake: currentIntake({ factsDigest: LATER_INTAKE_DIGEST })
    }),
    snapshot({
      currentIntake: currentIntake({
        revision: 3,
        factsDigest: LATER_INTAKE_DIGEST
      })
    }),
    snapshot({ currentProfile: null }),
    snapshot({ currentIntake: null })
  ];

  for (const selected of staleSnapshots) {
    assertError(
      () =>
        projectCustomServicesAssessmentQuote(
          input({ snapshot: selected })
        ),
      "repository_conflict",
      500
    );
  }
});

test("altered policy, intake, quote, disclosure, and acceptance digests are rejected", () => {
  const digestDrifts = [
    withRevision({ scopeBoundaryDigest: "f".repeat(64) }),
    withRevision({ policyScopeBoundaryDigest: "f".repeat(64) }),
    withRevision({ quoteDigest: "f".repeat(64) }),
    withRevision({ disclosureDigest: "f".repeat(64) }),
    withRevision({ quoteDigest: DISCLOSURE_DIGEST }),
    withRevision({ recomputedQuoteDigest: "f".repeat(64) }),
    withRevision({ recomputedDisclosureDigest: "f".repeat(64) }),
    withRevision({ intakeFactsDigest: "not-a-digest" }),
    withRevision({ commercialContractDigest: "f".repeat(64) }),
    withRevision({ commercialContractId: "SS-CUSTOM-SERVICES-CHANGED" }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({
            acceptedQuoteDigest: "f".repeat(64)
          })
        })
      })
    }),
    input({
      snapshot: snapshot({
        quote: quote({
          acceptance: acceptance({
            acceptedDisclosureDigest: "f".repeat(64)
          })
        })
      })
    })
  ];

  for (const selected of digestDrifts) {
    assertError(
      () => projectCustomServicesAssessmentQuote(selected),
      "repository_conflict",
      500
    );
  }
});

test("acceptance source, statement, revision, and legal binding are exact", () => {
  const alteredAcceptances = [
    acceptance({ source: "operator" }),
    acceptance({ acceptanceStatement: "accepted_price_only" }),
    acceptance({ quoteRevision: 3 }),
    acceptance({ legalDocumentId: OTHER_ID })
  ];

  for (const selected of alteredAcceptances) {
    assertError(
      () =>
        projectCustomServicesAssessmentQuote(
          input({
            snapshot: snapshot({
              quote: quote({ acceptance: selected })
            })
          })
        ),
      "repository_conflict",
      500
    );
  }
});

test("projection is pure, deeply frozen, customer-safe, and authority-free", () => {
  const source = acceptedInput();
  const sourceBefore = structuredClone(source);
  const projection = projectCustomServicesAssessmentQuote(source);
  const keys = allKeys(projection);

  assert.deepEqual(source, sourceBefore);
  for (const key of keys) {
    assert.doesNotMatch(
      key,
      /(?:organizationId|customerId|projectId|caseId|offeringId|intakeId|revisionId|profileRevision|policyId|legalDocumentId|commercialContract|scopeBoundary|operator|provider|credential|invoiceId|paymentId|jobId|reportId|creditId|refund)/iu
    );
  }

  const serialized = JSON.stringify(projection);
  for (const hiddenId of [
    ORGANIZATION_ID,
    CUSTOMER_ID,
    PROJECT_ID,
    CASE_ID,
    INTAKE_ID,
    REVISION_ID,
    OFFERING_ID,
    POLICY_ID,
    LEGAL_DOCUMENT_ID
  ]) {
    assert.equal(serialized.includes(hiddenId), false);
  }
  for (const hiddenDigest of [
    INTAKE_DIGEST,
    SCOPE_DIGEST,
    COMMERCIAL_DIGEST
  ]) {
    assert.equal(serialized.includes(hiddenDigest), false);
  }
  assert.equal(serialized.toLowerCase().includes("refund"), false);
  assert.equal(serialized.includes(QUOTE_ID), true);
  assert.equal(serialized.includes(QUOTE_DIGEST), true);
  assert.equal(serialized.includes(DISCLOSURE_DIGEST), true);
  assertDeeplyFrozen(projection);
  assert.throws(() => {
    projection.quote.scope.maximumFindings = 100;
  }, TypeError);
});
