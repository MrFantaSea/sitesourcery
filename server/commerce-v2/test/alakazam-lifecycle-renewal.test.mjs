import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA
} from "../alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
  ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
  createAlakazamRenewalService,
  isAlakazamRenewalInvoiceEvent,
  projectAlakazamNextRenewal
} from "../alakazam-lifecycle-renewal.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "30000000-0000-4000-8000-000000000002";
const PROJECT_ID = "30000000-0000-4000-8000-000000000003";
const SUBSCRIPTION_ID = "30000000-0000-4000-8000-000000000004";
const SCHEDULE_ROW_ID = "30000000-0000-4000-8000-000000000005";
const EVENT_ROW_ID = "40000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000002";
const TIER_EVENT_ID = "40000000-0000-4000-8000-000000000003";
const SETTLEMENT_ID = "40000000-0000-4000-8000-000000000004";

const PRIOR_PERIOD_START = "2026-07-02T12:00:00.000Z";
const PERIOD_START = "2026-08-02T12:00:00.000Z";
const PERIOD_END = "2026-09-02T12:00:00.000Z";
const PAID_AT = "2026-08-02T12:00:04.000Z";
const VERIFIED_AT = "2026-08-02T12:00:09.000Z";
const OBSERVED_AT = "2026-08-02T12:00:11.000Z";
const INVOICE_ID = "in_alakazam_renewal_1";
const APPROVED_RELEASE = createAlakazamBillingRelease({
  approved: true,
  taxMode: "disabled_by_owner"
});

function localSubscription(overrides = {}) {
  return {
    schema: ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
    localSubscriptionId: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    revision: 4,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    status: "active",
    stripeCustomerId: "cus_alakazam_renewal_1",
    stripeSubscriptionId: "sub_alakazam_renewal_1",
    stripeSubscriptionItemId: "si_alakazam_renewal_1",
    stripePriceId: "price_alakazam_25",
    currentPeriodStartsAt: PRIOR_PERIOD_START,
    currentPeriodEndsAt: PERIOD_START,
    cancelAtPeriodEnd: false,
    providerObservedAt: PRIOR_PERIOD_START,
    providerFactsDigest: digest("prior provider facts"),
    taxMode: "disabled_by_owner",
    ...overrides
  };
}

function subscriptionFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: "sub_alakazam_renewal_1",
    stripeSubscriptionItemId: "si_alakazam_renewal_1",
    stripeCustomerId: "cus_alakazam_renewal_1",
    stripePriceId: "price_alakazam_25",
    stripeScheduleId: null,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    billingCycleAnchor: PRIOR_PERIOD_START,
    providerObservedAt: OBSERVED_AT,
    metadata: {},
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function invoiceFacts(overrides = {}, subscription) {
  const facts = {
    schema: ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: INVOICE_ID,
    stripeSubscriptionId: "sub_alakazam_renewal_1",
    stripeSubscriptionItemId: "si_alakazam_renewal_1",
    stripeCustomerId: "cus_alakazam_renewal_1",
    stripePriceId: "price_alakazam_25",
    stripePaymentIntentId: "pi_alakazam_renewal_1",
    tierId: "alakazam_25",
    status: "paid",
    billingReason: "subscription_cycle",
    collectionMethod: "charge_automatically",
    paidOutOfBand: false,
    listSubtotalMinor: 2500,
    netSubtotalMinor: 2500,
    taxMinor: 0,
    totalMinor: 2500,
    amountPaidMinor: 2500,
    amountRemainingMinor: 0,
    taxMode: "disabled_by_owner",
    currency: "USD",
    periodStartsAt: PERIOD_START,
    periodEndsAt: PERIOD_END,
    providerPaymentTime: PAID_AT,
    providerObservedAt: OBSERVED_AT,
    subscription: subscription ?? subscriptionFacts(),
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

function renewalEvent(overrides = {}) {
  return {
    id: "evt_alakazam_renewal_1",
    type: "invoice.paid",
    livemode: false,
    api_version: "2026-07-30.basil",
    created: Math.floor(Date.parse(PAID_AT) / 1000),
    data: {
      object: {
        id: INVOICE_ID,
        object: "invoice",
        subscription: "sub_alakazam_renewal_1"
      }
    },
    ...overrides
  };
}

function harness({
  resolved,
  invoice,
  settlement,
  release = APPROVED_RELEASE,
  readiness = {
    ready: true,
    provider: "stripe",
    alakazam: true,
    taxModes: { alakazam: "disabled_by_owner" },
    livemode: false
  },
  invoiceFails = false
} = {}) {
  const calls = {
    lookups: [],
    readbacks: [],
    settlements: [],
    ids: []
  };
  const service = createAlakazamRenewalService({
    repository: {
      async findRenewalSubscriptionByInvoice(input) {
        calls.lookups.push(input);
        return resolved;
      },
      async settleRenewalPayment(input) {
        calls.settlements.push(input);
        return settlement;
      }
    },
    provider: {
      async readiness() {
        return readiness;
      },
      async retrieveAlakazamRenewalInvoice(input) {
        calls.readbacks.push(input);
        if (invoiceFails) {
          throw new Error("stripe unavailable");
        }
        return invoice;
      }
    },
    clock: { now: () => VERIFIED_AT },
    ids: {
      next(label) {
        calls.ids.push(label);
        return {
          alakazam_renewal_event: EVENT_ROW_ID,
          alakazam_renewal_receipt: RECEIPT_ID,
          alakazam_renewal_tier_event: TIER_EVENT_ID,
          alakazam_renewal_settlement: SETTLEMENT_ID
        }[label];
      }
    },
    release
  });
  return { service, calls };
}

function settlementResult(overrides = {}) {
  return {
    status: "renewal_settled",
    provider: "stripe",
    settlementId: SETTLEMENT_ID,
    subscriptionId: SUBSCRIPTION_ID,
    projectId: PROJECT_ID,
    receiptId: RECEIPT_ID,
    stripeInvoiceId: INVOICE_ID,
    revision: 5,
    periodStartsAt: PERIOD_START,
    periodEndsAt: PERIOD_END,
    paidAmountMinor: 2500,
    currency: "USD",
    providerFactsDigest: subscriptionFacts().providerFactsDigest,
    projection: projectAlakazamNextRenewal({
      tierId: "alakazam_25",
      confirmedPeriodEndsAt: PERIOD_END
    }),
    next: "complete",
    ...overrides
  };
}

test(
  "Alakazam renewal stays held before any repository or provider work",
  async () => {
    const { service, calls } = harness({
      release: createAlakazamBillingRelease(),
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      }
    });
    assert.deepEqual(await service.readiness(), {
      ready: false,
      renewal: false,
      state: "held",
      code: "alakazam_billing_release_held"
    });
    await assert.rejects(
      () => service.ingestStripeEvent(renewalEvent()),
      { code: "alakazam_renewal_reconciliation_unavailable" }
    );
    assert.deepEqual(calls.lookups, []);
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.settlements, []);
  }
);

test(
  "only paid subscription invoice events are Alakazam renewal candidates",
  () => {
    assert.equal(
      isAlakazamRenewalInvoiceEvent(renewalEvent()),
      true
    );
    assert.equal(
      isAlakazamRenewalInvoiceEvent(
        renewalEvent({ type: "invoice.payment_succeeded" })
      ),
      true
    );
    assert.equal(
      isAlakazamRenewalInvoiceEvent(
        renewalEvent({ type: "invoice.payment_failed" })
      ),
      false
    );
    assert.equal(
      isAlakazamRenewalInvoiceEvent({
        type: "invoice.paid",
        data: {
          object: {
            id: INVOICE_ID,
            object: "invoice",
            subscription: null
          }
        }
      }),
      false
    );
    assert.equal(
      isAlakazamRenewalInvoiceEvent(
        renewalEvent({
          data: {
            object: {
              id: INVOICE_ID,
              object: "invoice",
              parent: {
                subscription_details: {
                  subscription: "sub_alakazam_renewal_1"
                }
              }
            }
          }
        })
      ),
      true
    );
  }
);

test(
  "an unowned invoice makes no Alakazam readback and no mutation",
  async () => {
    const { service, calls } = harness({
      resolved: { status: "not_alakazam" }
    });
    assert.deepEqual(
      await service.ingestStripeEvent(renewalEvent()),
      { status: "not_alakazam_renewal" }
    );
    assert.deepEqual(calls.lookups, [
      {
        stripeInvoiceId: INVOICE_ID,
        stripeSubscriptionId: "sub_alakazam_renewal_1"
      }
    ]);
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.settlements, []);
    assert.deepEqual(calls.ids, []);
  }
);

test(
  "a confirmed renewal advances the period and projects the next one",
  async () => {
    const { service, calls } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      },
      invoice: invoiceFacts(),
      settlement: settlementResult()
    });
    const result = await service.ingestStripeEvent(
      renewalEvent()
    );
    assert.equal(result.status, "renewal_settled");
    assert.equal(result.periodStartsAt, PERIOD_START);
    assert.equal(result.periodEndsAt, PERIOD_END);
    assert.equal(result.revision, 5);
    assert.deepEqual(result.projection, {
      schema: ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
      nextRenewalAt: PERIOD_END,
      tierId: "alakazam_25",
      amountMinor: 2500,
      currency: "USD",
      basis: "provider_confirmed_period",
      certainty: "provider_confirmed_boundary"
    });
    assert.equal(calls.settlements.length, 1);
    const written = calls.settlements[0];
    assert.equal(written.eventRowId, EVENT_ROW_ID);
    assert.equal(written.receiptId, RECEIPT_ID);
    assert.equal(written.tierEventId, TIER_EVENT_ID);
    assert.equal(written.settlementId, SETTLEMENT_ID);
    assert.equal(
      written.event.stripeInvoiceId,
      INVOICE_ID
    );
    assert.equal(written.invoice.netSubtotalMinor, 2500);
    assert.deepEqual(calls.ids, [
      "alakazam_renewal_event",
      "alakazam_renewal_receipt",
      "alakazam_renewal_tier_event",
      "alakazam_renewal_settlement"
    ]);
  }
);

test(
  "the paid-invoice alias converges on the same settled renewal",
  async () => {
    const { service, calls } = harness({
      resolved: {
        status: "settled",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription({ revision: 5 }),
        pendingDowngrade: null,
        settlement: settlementResult()
      }
    });
    const result = await service.ingestStripeEvent(
      renewalEvent({
        id: "evt_alakazam_renewal_alias",
        type: "invoice.payment_succeeded"
      })
    );
    assert.equal(result.settlementId, SETTLEMENT_ID);
    assert.equal(result.receiptId, RECEIPT_ID);
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.settlements, []);
    assert.deepEqual(calls.ids, []);
  }
);

test(
  "an accepted downgrade at the boundary owns the next-period projection",
  async () => {
    const { service } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription({
          tierId: "alakazam_50",
          amountMinor: 5000,
          stripePriceId: "price_alakazam_50"
        }),
        pendingDowngrade: {
          scheduleId: SCHEDULE_ROW_ID,
          targetTierId: "alakazam_25",
          effectiveAt: PERIOD_END
        }
      },
      invoice: invoiceFacts(
        {
          tierId: "alakazam_50",
          stripePriceId: "price_alakazam_50",
          listSubtotalMinor: 5000,
          netSubtotalMinor: 5000,
          totalMinor: 5000,
          amountPaidMinor: 5000
        },
        subscriptionFacts({
          tierId: "alakazam_50",
          amountMinor: 5000,
          stripePriceId: "price_alakazam_50",
          stripeScheduleId: "sub_sched_alakazam_renewal_1"
        })
      ),
      settlement: settlementResult({
        paidAmountMinor: 5000,
        providerFactsDigest: subscriptionFacts({
          tierId: "alakazam_50",
          amountMinor: 5000,
          stripePriceId: "price_alakazam_50",
          stripeScheduleId: "sub_sched_alakazam_renewal_1"
        }).providerFactsDigest,
        projection: projectAlakazamNextRenewal({
          tierId: "alakazam_50",
          confirmedPeriodEndsAt: PERIOD_END,
          pendingDowngrade: {
            scheduleId: SCHEDULE_ROW_ID,
            targetTierId: "alakazam_25",
            effectiveAt: PERIOD_END
          }
        })
      })
    });
    const result = await service.ingestStripeEvent(
      renewalEvent()
    );
    assert.deepEqual(result.projection, {
      schema: ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
      nextRenewalAt: PERIOD_END,
      tierId: "alakazam_25",
      amountMinor: 2500,
      currency: "USD",
      basis: "scheduled_downgrade",
      certainty: "provider_confirmed_boundary"
    });
  }
);

test(
  "an invoice raised outside the recurring cycle never settles a renewal",
  async () => {
    for (const override of [
      { billingReason: "subscription_update" },
      { collectionMethod: "send_invoice" },
      { paidOutOfBand: true }
    ]) {
      const { service, calls } = harness({
        resolved: {
          status: "current",
          provider: "stripe",
          stripeInvoiceId: INVOICE_ID,
          subscription: localSubscription(),
          pendingDowngrade: null
        },
        invoice: invoiceFacts(override)
      });
      await assert.rejects(
        () => service.ingestStripeEvent(renewalEvent()),
        { code: "alakazam_renewal_reconciliation_required" }
      );
      assert.deepEqual(calls.settlements, []);
    }
  }
);

test(
  "a discontinuous or repriced invoice grants no durable renewal",
  async () => {
    const gapped = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      },
      invoice: invoiceFacts({
        periodStartsAt: "2026-08-03T12:00:00.000Z"
      })
    });
    await assert.rejects(
      () => gapped.service.ingestStripeEvent(renewalEvent()),
      { code: "alakazam_renewal_reconciliation_required" }
    );
    assert.deepEqual(gapped.calls.settlements, []);

    const repriced = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      },
      invoice: invoiceFacts({
        netSubtotalMinor: 100,
        totalMinor: 100,
        amountPaidMinor: 100
      })
    });
    await assert.rejects(
      () => repriced.service.ingestStripeEvent(renewalEvent()),
      { code: "stripe_alakazam_renewal_mismatch" }
    );
    assert.deepEqual(repriced.calls.settlements, []);
  }
);

test(
  "a subscription already scheduled to end does not renew automatically",
  async () => {
    const { service, calls } = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription({
          cancelAtPeriodEnd: true
        }),
        pendingDowngrade: null
      },
      invoice: invoiceFacts()
    });
    await assert.rejects(
      () => service.ingestStripeEvent(renewalEvent()),
      { code: "alakazam_renewal_reconciliation_required" }
    );
    assert.deepEqual(calls.readbacks, []);
    assert.deepEqual(calls.settlements, []);
  }
);

test(
  "a failed provider readback or wrong mode writes nothing",
  async () => {
    const unavailable = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      },
      invoiceFails: true
    });
    await assert.rejects(
      () =>
        unavailable.service.ingestStripeEvent(renewalEvent()),
      { code: "alakazam_renewal_reconciliation_unavailable" }
    );
    assert.deepEqual(unavailable.calls.settlements, []);

    const wrongMode = harness({
      resolved: {
        status: "current",
        provider: "stripe",
        stripeInvoiceId: INVOICE_ID,
        subscription: localSubscription(),
        pendingDowngrade: null
      },
      invoice: invoiceFacts()
    });
    await assert.rejects(
      () =>
        wrongMode.service.ingestStripeEvent(
          renewalEvent({ livemode: true })
        ),
      { code: "stripe_event_invalid" }
    );
    assert.deepEqual(wrongMode.calls.lookups, []);
    assert.deepEqual(wrongMode.calls.settlements, []);
  }
);

test(
  "the next-renewal projection never invents a date or a price",
  () => {
    assert.throws(
      () =>
        projectAlakazamNextRenewal({
          tierId: "alakazam_25",
          confirmedPeriodEndsAt: null
        }),
      { code: "invalid_input" }
    );
    const projected = projectAlakazamNextRenewal({
      tierId: "alakazam_35",
      confirmedPeriodEndsAt: PERIOD_END,
      pendingDowngrade: {
        scheduleId: SCHEDULE_ROW_ID,
        targetTierId: "alakazam_25",
        effectiveAt: "2026-10-02T12:00:00.000Z"
      }
    });
    // A downgrade that does not land on this exact boundary must not
    // change the projected renewal.
    assert.equal(projected.tierId, "alakazam_35");
    assert.equal(projected.amountMinor, 3500);
    assert.equal(projected.basis, "provider_confirmed_period");
    assert.equal(projected.nextRenewalAt, PERIOD_END);
  }
);
