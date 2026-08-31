import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const views = require(
  "../../abracadabra/app/abracadabra-billing-views.js"
);

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID =
  "30000000-0000-4000-8000-000000000002";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";

function invoice(overrides = {}) {
  return {
    schema: "sitesourcery.alakazam-invoice/v1",
    projectId: PROJECT_ID,
    receiptId: RECEIPT_ID,
    invoiceNumber: "SSAK-40000000000040008000000000000001",
    state: "settled",
    kind: "start_payment",
    tier: { tierId: "alakazam_25", name: "Alakazam 25" },
    issuedAt: "2026-08-08T12:00:00.000Z",
    settledAt: "2026-08-08T12:00:00.000Z",
    currency: "USD",
    lines: [
      {
        lineNumber: 1,
        description: "Alakazam first month",
        quantity: 1,
        unitAmountMinor: 2500,
        amountMinor: 2500
      }
    ],
    credits: [
      {
        kind: "download_purchase",
        description: "Download purchase credit",
        amountMinor: 500
      }
    ],
    totals: {
      subtotalMinor: 2500,
      discountMinor: 500,
      netSubtotalMinor: 2000,
      taxMinor: 0,
      taxState: "disabled_by_owner",
      totalMinor: 2000,
      currency: "USD"
    },
    settlement: {
      state: "settled",
      settledAt: "2026-08-08T12:00:00.000Z",
      providerInvoiceRecorded: true,
      settlementDigest: "a".repeat(64)
    },
    catalog: {
      catalogVersion: "alakazam.2026-08-02.v1",
      termsVersion:
        "alakazam-owner-contract.2026-08-02.v1"
    },
    ...overrides
  };
}

function preview(overrides = {}) {
  return {
    schema:
      "sitesourcery.alakazam-cancellation-preview/v1",
    projectId: PROJECT_ID,
    eligible: true,
    ineligibleReason: null,
    tierId: "alakazam_50",
    amountMinor: 5000,
    currency: "USD",
    effectiveAt: "2026-09-08T11:10:00.000Z",
    servesUntil: "2026-09-08T11:10:00.000Z",
    cancellationFeeMinor: 0,
    furtherChargesAfterEffective: false,
    refundTreatment:
      "no_partial_period_refund_or_proration",
    refundExceptions: [
      "required_by_law",
      "duplicate_or_unauthorized_charge",
      "proven_service_failure"
    ],
    undoAvailable: false,
    undoTreatment: "resubscribe_separately",
    export: {
      schema: "sitesourcery.alakazam-export-grant/v1",
      state: "available",
      availableFrom: "2026-08-10T11:10:00.000Z",
      paidThroughAt: "2026-09-08T11:10:00.000Z",
      retentionState: "granted",
      policyVersion: "alakazam-lifecycle.2026-08-10.v1",
      retentionEndsAt: "2026-10-08T11:10:00.000Z",
      exportWindowEndsAt: "2026-10-08T11:10:00.000Z"
    },
    disclosure: {
      schema:
        "sitesourcery.alakazam-cancellation-disclosure/v1",
      cancellationPolicy:
        "cancel_anytime_period_end_no_fee_no_partial_refund_30_day_export",
      cancellationPolicyVersion:
        "alakazam-cancellation.2026-08-31.v1",
      projectId: PROJECT_ID,
      tierId: "alakazam_50",
      amountMinor: 5000,
      currency: "USD",
      effectiveAt: "2026-09-08T11:10:00.000Z",
      servesUntil: "2026-09-08T11:10:00.000Z",
      cancellationFeeMinor: 0,
      furtherChargesAfterEffective: false,
      refundTreatment:
        "no_partial_period_refund_or_proration",
      refundExceptions: [
        "required_by_law",
        "duplicate_or_unauthorized_charge",
        "proven_service_failure"
      ],
      undoAvailable: false,
      undoTreatment: "resubscribe_separately",
      retainedExitHours: 720,
      exportWindowHours: 720
    },
    disclosureDigest: "d".repeat(64),
    actions: {
      requestCancellation: true,
      reason: null
    },
    ...overrides
  };
}

function states(overrides = {}) {
  return {
    schema: "sitesourcery.alakazam-billing-states/v1",
    projectId: PROJECT_ID,
    observedAt: "2026-08-08T12:00:00.000Z",
    revision: 2,
    providerObservedAt: "2026-08-08T11:12:05.000Z",
    payment: {
      state: "current",
      subscriptionStatus: "active",
      retry: {
        active: false,
        startedAt: null,
        graceEndsAt: null
      }
    },
    replay: {
      state: "settled",
      outstanding: 0,
      failed: 0,
      processedThrough: "2026-08-08T11:12:05.000Z",
      lastEventAt: "2026-08-08T11:12:00.000Z",
      duplicateSuppressed: true,
      maximumAttempts: 1
    },
    reconciliation: {
      state: "none",
      kind: null,
      since: null
    },
    display: { attentionRequired: false, settled: true },
    ...overrides
  };
}

test("A-03 the invoice view accepts only the exact document, bound to this project and receipt", () => {
  assert.notEqual(
    views.verifiedAlakazamInvoice(
      invoice(),
      PROJECT_ID,
      RECEIPT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamInvoice(
      invoice(),
      OTHER_PROJECT_ID,
      RECEIPT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamInvoice(
      invoice(),
      PROJECT_ID,
      "40000000-0000-4000-8000-000000000002"
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamInvoice(
      invoice({ schema: "sitesourcery.other/v1" }),
      PROJECT_ID,
      RECEIPT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamInvoice(
      invoice({ invoiceNumber: "SSA-0001" }),
      PROJECT_ID,
      RECEIPT_ID
    ),
    null
  );
});

test("an invoice whose totals do not reconcile is never shown", () => {
  for (const totals of [
    { totalMinor: 2100 },
    { netSubtotalMinor: 2500 },
    { discountMinor: 0 },
    { taxState: "guessed" }
  ]) {
    assert.equal(
      views.verifiedAlakazamInvoice(
        invoice({
          totals: { ...invoice().totals, ...totals }
        }),
        PROJECT_ID,
        RECEIPT_ID
      ),
      null,
      JSON.stringify(totals)
    );
  }
});

test("the invoice presentation reads as plain money with a stable reference", () => {
  const shown = views.alakazamInvoicePresentation(
    invoice(),
    PROJECT_ID,
    RECEIPT_ID
  );
  assert.equal(shown.heading, "Alakazam payment receipt");
  assert.equal(
    shown.summary,
    "Paid on August 8, 2026 for Alakazam 25."
  );
  assert.equal(
    shown.reference,
    "SSAK-40000000000040008000000000000001"
  );
  assert.deepEqual(shown.rows, [
    {
      label: "Alakazam first month",
      value: "$25.00",
      kind: "line"
    },
    {
      label: "Download purchase credit",
      value: "-$5.00",
      kind: "credit"
    },
    {
      label: "Sales tax (not charged)",
      value: "$0.00",
      kind: "tax"
    }
  ]);
  assert.equal(shown.totalLabel, "Total paid");
  assert.equal(shown.totalValue, "$20.00");
});

test("E-08 the cancellation preview view accepts only the exact preview", () => {
  assert.notEqual(
    views.verifiedAlakazamCancellationPreview(
      preview(),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamCancellationPreview(
      preview(),
      OTHER_PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamCancellationPreview(
      preview({
        disclosure: {
          ...preview().disclosure,
          cancellationPolicy: "no_refund"
        }
      }),
      PROJECT_ID
    ),
    null
  );
});

test("a cancellation preview rejects action and disclosure drift", () => {
  assert.equal(
    views.verifiedAlakazamCancellationPreview(
      preview({
        actions: {
          requestCancellation: true,
          reason: "alakazam_cancellation_effect_held"
        }
      }),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamCancellationPreview(
      preview({
        disclosure: {
          ...preview().disclosure,
          cancellationFeeMinor: 500
        }
      }),
      PROJECT_ID
    ),
    null
  );
});

test("a preview that changes the refund treatment is refused", () => {
  assert.equal(
    views.verifiedAlakazamCancellationPreview(
      preview({
        refundTreatment: "refund_promised"
      }),
      PROJECT_ID
    ),
    null
  );
});

test("the cancellation preview reads as plain consequences and offers exact confirmation", () => {
  const shown =
    views.alakazamCancellationPreviewPresentation(
      preview(),
      PROJECT_ID
    );
  assert.equal(shown.heading, "Review cancellation");
  assert.equal(shown.confirmAvailable, true);
  assert.equal(
    shown.acceptedDisclosureDigest,
    "d".repeat(64)
  );
  assert.deepEqual(shown.facts, [
    {
      label: "Your plan keeps working until",
      value: "September 8, 2026"
    },
    {
      label: "Your next renewal",
      value: "Will not be charged after you confirm."
    },
    {
      label: "Cancellation fee",
      value: "$0.00"
    },
    {
      label: "Current paid period",
      value: "No partial refund or proration. We still review refunds required by law, duplicate or unauthorized charges, and proven service failures."
    },
    {
      label: "Saved work and export",
      value: "Available until October 8, 2026."
    }
  ]);
  assert.match(shown.policyNote, /Cancel anytime/u);
  assert.match(shown.policyNote, /30 days/u);
});

test("an already scheduled cancellation says so and stops offering a renewal", () => {
  const shown =
    views.alakazamCancellationPreviewPresentation(
      preview({
        eligible: false,
        ineligibleReason: "already_scheduled_to_end",
        actions: {
          requestCancellation: false,
          reason: "already_scheduled_to_end"
        }
      }),
      PROJECT_ID
    );
  assert.equal(
    shown.heading,
    "Your Alakazam plan is already set to end."
  );
  assert.equal(
    shown.confirmAvailable,
    false
  );
});

test("an account with nothing to cancel says so plainly", () => {
  const shown =
    views.alakazamCancellationPreviewPresentation(
      preview({
        eligible: false,
        ineligibleReason: "no_current_subscription",
        tierId: null,
        amountMinor: 0,
        effectiveAt: null,
        servesUntil: null,
        export: null,
        disclosure: null,
        disclosureDigest: null,
        actions: {
          requestCancellation: false,
          reason: "no_current_subscription"
        }
      }),
      PROJECT_ID
    );
  assert.equal(
    shown.heading,
    "There is no Alakazam plan to cancel."
  );
  assert.deepEqual(shown.facts, []);
  assert.equal(shown.confirmAvailable, false);
});

test("E-09 the billing states view accepts only a self-consistent state", () => {
  assert.notEqual(
    views.verifiedAlakazamBillingStates(
      states(),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamBillingStates(
      states({
        display: { attentionRequired: false, settled: false }
      }),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamBillingStates(
      states({
        payment: {
          state: "retrying",
          subscriptionStatus: "grace",
          retry: {
            active: false,
            startedAt: null,
            graceEndsAt: null
          }
        }
      }),
      PROJECT_ID
    ),
    null
  );
  assert.equal(
    views.verifiedAlakazamBillingStates(
      states({
        replay: {
          ...states().replay,
          duplicateSuppressed: false
        }
      }),
      PROJECT_ID
    ),
    null
  );
});

test("a retry, a replay and a reconciliation each reach the account view in plain words", () => {
  const retrying = views.alakazamBillingStatesPresentation(
    states({
      revision: 3,
      payment: {
        state: "retrying",
        subscriptionStatus: "grace",
        retry: {
          active: true,
          startedAt: "2026-08-08T11:30:00.000Z",
          graceEndsAt: "2026-08-22T11:30:00.000Z"
        }
      },
      display: { attentionRequired: true, settled: false }
    }),
    PROJECT_ID
  );
  assert.equal(retrying.attentionRequired, true);
  assert.equal(
    retrying.notices[0].title,
    "A payment did not go through."
  );
  assert.match(
    retrying.notices[0].detail,
    /keep trying until August 22, 2026/u
  );

  const verifying =
    views.alakazamBillingStatesPresentation(
      states({
        replay: {
          ...states().replay,
          state: "verifying",
          outstanding: 1,
          maximumAttempts: 4
        },
        display: {
          attentionRequired: false,
          settled: false
        }
      }),
      PROJECT_ID
    );
  assert.equal(verifying.notices.length, 2);
  assert.equal(
    verifying.notices[1].title,
    "A payment update is still being confirmed."
  );

  const reconciling =
    views.alakazamBillingStatesPresentation(
      states({
        reconciliation: {
          state: "required",
          kind: "downgrade_schedule",
          since: "2026-08-08T11:41:00.000Z"
        },
        display: {
          attentionRequired: true,
          settled: false
        }
      }),
      PROJECT_ID
    );
  assert.match(
    reconciling.notices[1].title,
    /checking a scheduled plan change/u
  );
});

test("a webhook replay cannot move the account view backwards", () => {
  const current = states({
    revision: 3,
    observedAt: "2026-08-08T12:00:00.000Z"
  });
  const staleReplay = states({
    revision: 2,
    observedAt: "2026-08-08T12:00:30.000Z"
  });
  const fresher = states({
    revision: 3,
    observedAt: "2026-08-08T12:00:30.000Z"
  });
  assert.equal(
    views.alakazamBillingStatesAreNewer(
      staleReplay,
      current
    ),
    false
  );
  assert.equal(
    views.mergeAlakazamBillingStates(
      current,
      staleReplay
    ),
    current
  );
  assert.equal(
    views.mergeAlakazamBillingStates(current, fresher),
    fresher
  );
  assert.equal(
    views.mergeAlakazamBillingStates(null, current),
    current
  );
});

test("no billing view ever shows a provider identifier or internal jargon", () => {
  const shown = JSON.stringify([
    views.alakazamInvoicePresentation(
      invoice(),
      PROJECT_ID,
      RECEIPT_ID
    ),
    views.alakazamCancellationPreviewPresentation(
      preview(),
      PROJECT_ID
    ),
    views.alakazamBillingStatesPresentation(
      states({
        reconciliation: {
          state: "required",
          kind: "tier_change",
          since: "2026-08-08T11:41:00.000Z"
        },
        display: {
          attentionRequired: true,
          settled: false
        }
      }),
      PROJECT_ID
    )
  ]);
  for (const forbidden of [
    "cus_",
    "sub_",
    "in_",
    "pi_",
    "evt_",
    "price_",
    "cs_",
    "Stripe",
    "webhook",
    "idempot",
    "reconciliation_required",
    "provider_effects"
  ]) {
    assert.equal(
      shown.includes(forbidden),
      false,
      `billing views leaked ${forbidden}`
    );
  }
});
