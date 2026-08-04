import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamCheckoutDispatch,
  createAlakazamProviderMetadata
} from "../alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  ALAKAZAM_UPGRADE_APPLICATION_SCHEMA,
  createAlakazamUpgradeService
} from "../alakazam-upgrade.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const QUOTE_ID = "10000000-0000-4000-8000-000000000004";
const DISPATCH_ID = "10000000-0000-4000-8000-000000000005";
const SUBSCRIPTION_ID =
  "10000000-0000-4000-8000-000000000006";
const RECEIPT_ID = "10000000-0000-4000-8000-000000000007";
const APPLICATION_ID =
  "20000000-0000-4000-8000-000000000001";
const CLAIMED_AT = "2026-08-04T12:10:00.000Z";
const LEASE_EXPIRES_AT = "2026-08-04T12:12:00.000Z";
const CONFIRMED_AT = "2026-08-04T12:11:00.000Z";
const PERIOD_START = "2026-08-04T12:04:00.000Z";
const PERIOD_END = "2026-09-04T12:04:00.000Z";
const PAYMENT_DIGEST = digest("paid upgrade evidence");

function reservation() {
  return createAlakazamCheckoutDispatch({
    dispatchId: DISPATCH_ID,
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    stripeCustomerId: "cus_alakazam_upgrade_1",
    acceptedDisclosureDigest: digest("accepted disclosure"),
    quoteDigest: digest("upgrade quote"),
    changeKind: "upgrade",
    currentSubscription: {
      localSubscriptionId: SUBSCRIPTION_ID,
      revision: 2,
      tierId: "alakazam_25",
      amountMinor: 2500,
      stripeSubscriptionId: "sub_alakazam_upgrade_1",
      stripeSubscriptionItemId: "si_alakazam_upgrade_1",
      stripePriceId: "price_alakazam_25",
      currentPeriodStartsAt: PERIOD_START,
      currentPeriodEndsAt: PERIOD_END,
      providerFactsDigest: digest("active 25 provider facts")
    },
    targetTierId: "alakazam_35",
    dueNowSubtotalMinor: 1000,
    taxMode: "disabled_by_owner",
    downloadCredit: null,
    claimedAt: "2026-08-04T12:05:00.000Z"
  });
}

function settlement() {
  return {
    status: "payment_settled",
    provider: "stripe",
    changeKind: "upgrade",
    dispatchId: DISPATCH_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    receiptId: RECEIPT_ID,
    paymentProviderFactsDigest: PAYMENT_DIGEST,
    next: "provider_change"
  };
}

function application() {
  return {
    schema: ALAKAZAM_UPGRADE_APPLICATION_SCHEMA,
    applicationId: APPLICATION_ID,
    subscriptionId: SUBSCRIPTION_ID,
    receiptId: RECEIPT_ID,
    paymentProviderFactsDigest: PAYMENT_DIGEST,
    idempotencyKey:
      `alakazam:upgrade:apply:${APPLICATION_ID}`,
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT
  };
}

function subscriptionFacts(
  selected,
  overrides = {}
) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: "sub_alakazam_upgrade_1",
    stripeSubscriptionItemId: "si_alakazam_upgrade_1",
    stripeCustomerId: selected.stripeCustomerId,
    stripePriceId: "price_alakazam_35",
    stripeScheduleId: null,
    tierId: "alakazam_35",
    amountMinor: 3500,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    billingCycleAnchor: PERIOD_START,
    providerObservedAt: CONFIRMED_AT,
    metadata: {
      ...createAlakazamProviderMetadata({
        purpose: selected.purpose,
        purposeDigest: selected.purposeDigest
      }),
      payment_receipt_id: RECEIPT_ID,
      payment_facts_digest: PAYMENT_DIGEST
    },
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function confirmation(selected, facts, reconciliation) {
  return {
    status: "provider_confirmed",
    provider: "stripe",
    changeKind: "upgrade",
    applicationId: APPLICATION_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    subscriptionId: SUBSCRIPTION_ID,
    receiptId: RECEIPT_ID,
    priorTierId: "alakazam_25",
    targetTierId: "alakazam_35",
    currentRevision: 2,
    currentPeriodStartsAt: PERIOD_START,
    currentPeriodEndsAt: PERIOD_END,
    paymentProviderFactsDigest: PAYMENT_DIGEST,
    subscriptionProviderFactsDigest:
      facts.providerFactsDigest,
    reconciliation,
    next: "subscription_event_confirmation"
  };
}

function resolved(status, selected, facts) {
  return {
    status,
    provider: "stripe",
    reservation: selected,
    application: application(),
    ...(["provider_confirmed", "applied"].includes(status)
      ? {
          confirmation: {
            ...confirmation(
              selected,
              facts,
              "confirmed"
            ),
            ...(status === "applied"
              ? { status: "applied", next: "complete" }
              : {})
          }
        }
      : {})
  };
}

function fixture({
  releaseApproved = true,
  existingStatus = null,
  claimedStatus = "claimed",
  applyError = null,
  readFacts = undefined,
  applyFacts = undefined,
  confirmError = null
} = {}) {
  const selected = reservation();
  const facts = applyFacts ?? subscriptionFacts(selected);
  const readback = readFacts ?? subscriptionFacts(selected);
  const result = confirmation(selected, facts, "confirmed");
  const calls = {
    readiness: 0,
    finds: [],
    claims: [],
    applies: [],
    reads: [],
    confirms: [],
    marks: [],
    ids: []
  };
  let clockCalls = 0;
  const service = createAlakazamUpgradeService({
    repository: {
      async findUpgradeApplication(input) {
        calls.finds.push(structuredClone(input));
        return existingStatus === null
          ? null
          : structuredClone(
              resolved(existingStatus, selected, facts)
            );
      },
      async claimUpgradeApplication(input) {
        calls.claims.push(structuredClone(input));
        return structuredClone(
          resolved(claimedStatus, selected, facts)
        );
      },
      async confirmUpgradeProvider(input) {
        calls.confirms.push(structuredClone(input));
        if (confirmError) throw confirmError;
        return structuredClone({
          ...result,
          reconciliation: input.reconciliation,
          subscriptionProviderFactsDigest:
            input.subscription.providerFactsDigest
        });
      },
      async markUpgradeReconciliationRequired(input) {
        calls.marks.push(structuredClone(input));
        return { status: "reconciliation_required" };
      }
    },
    provider: {
      async readiness() {
        calls.readiness += 1;
        return {
          ready: true,
          provider: "stripe",
          alakazam: true,
          taxMode: "disabled_by_owner",
          livemode: false
        };
      },
      async applyAlakazamUpgrade(input) {
        calls.applies.push(structuredClone(input));
        if (applyError) throw applyError;
        return {
          ...structuredClone(facts),
          reconciliation: "confirmed"
        };
      },
      async retrieveAlakazamSubscription(input) {
        calls.reads.push(structuredClone(input));
        return structuredClone(readback);
      }
    },
    clock: {
      now() {
        clockCalls += 1;
        return clockCalls === 1
          ? CLAIMED_AT
          : CONFIRMED_AT;
      }
    },
    ids: {
      next(label) {
        calls.ids.push(label);
        return APPLICATION_ID;
      }
    },
    release: createAlakazamBillingRelease({
      approved: releaseApproved,
      taxMode: releaseApproved
        ? "disabled_by_owner"
        : null
    })
  });
  return {
    calls,
    facts,
    result,
    selected,
    service,
    settlement: settlement()
  };
}

test("Alakazam paid upgrade remains held before repository or provider work", async () => {
  const { calls, service, settlement: input } = fixture({
    releaseApproved: false
  });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    upgrade: false,
    state: "held",
    code: "alakazam_billing_release_held"
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code === "alakazam_upgrade_unavailable" &&
      error.status === 503
  );
  assert.deepEqual(calls, {
    readiness: 0,
    finds: [],
    claims: [],
    applies: [],
    reads: [],
    confirms: [],
    marks: [],
    ids: []
  });
});

test("a paid Alakazam upgrade claims once, swaps once, and stores exact provider confirmation", async () => {
  const {
    calls,
    facts,
    result,
    selected,
    service,
    settlement: input
  } = fixture();
  assert.deepEqual(
    await service.applyPaidUpgrade(input),
    result
  );
  assert.deepEqual(calls.ids, [
    "alakazam_upgrade_application"
  ]);
  assert.equal(calls.claims.length, 1);
  assert.equal(calls.applies.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.applies[0], {
    idempotencyKey:
      `alakazam:upgrade:apply:${APPLICATION_ID}`,
    purpose: selected.purpose,
    purposeDigest: selected.purposeDigest,
    paymentEvidence: {
      receiptId: RECEIPT_ID,
      providerFactsDigest: PAYMENT_DIGEST
    }
  });
  assert.equal(calls.confirms.length, 1);
  assert.equal(
    calls.confirms[0].subscription.providerFactsDigest,
    facts.providerFactsDigest
  );
  assert.deepEqual(calls.marks, []);
});

test("a provider-confirmed upgrade replay performs no provider work and allocates no ID", async () => {
  const { calls, result, service, settlement: input } =
    fixture({ existingStatus: "provider_confirmed" });
  assert.deepEqual(
    await service.applyPaidUpgrade(input),
    result
  );
  assert.equal(calls.finds.length, 1);
  assert.deepEqual(calls.ids, []);
  assert.deepEqual(calls.claims, []);
  assert.deepEqual(calls.applies, []);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.confirms, []);
});

test("an active upgrade lease cannot submit a second Price mutation", async () => {
  const { calls, service, settlement: input } = fixture({
    existingStatus: "in_progress"
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code === "alakazam_upgrade_in_progress" &&
      error.status === 409
  );
  assert.deepEqual(calls.ids, []);
  assert.deepEqual(calls.applies, []);
  assert.deepEqual(calls.reads, []);
  assert.deepEqual(calls.confirms, []);
});

test("provider uncertainty is durably fenced and never invokes a read-write retry", async () => {
  const { calls, service, settlement: input } = fixture({
    applyError: Object.assign(new Error("timeout"), {
      code: "stripe_alakazam_upgrade_effect_unknown"
    })
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code ===
        "alakazam_upgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.applies.length, 1);
  assert.deepEqual(calls.reads, []);
  assert.equal(calls.marks.length, 1);
  assert.equal(
    calls.marks[0].errorCode,
    "stripe_alakazam_upgrade_effect_unknown"
  );
  assert.deepEqual(calls.confirms, []);
});

test("an ambiguous application can recover by exact read-only target readback", async () => {
  const { calls, facts, service, settlement: input } =
    fixture({ existingStatus: "reconciliation_required" });
  const result = await service.applyPaidUpgrade(input);
  assert.equal(result.status, "provider_confirmed");
  assert.equal(
    result.reconciliation,
    "readback_after_ambiguity"
  );
  assert.equal(
    result.subscriptionProviderFactsDigest,
    facts.providerFactsDigest
  );
  assert.deepEqual(calls.ids, []);
  assert.deepEqual(calls.applies, []);
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.confirms.length, 1);
});

test("changed ambiguity readback leaves the old entitlement and submits no mutation", async () => {
  const selected = reservation();
  const changed = subscriptionFacts(selected, {
    providerStatus: "past_due"
  });
  const { calls, service, settlement: input } = fixture({
    existingStatus: "reconciliation_required",
    readFacts: changed
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code ===
        "alakazam_upgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.deepEqual(calls.applies, []);
  assert.equal(calls.reads.length, 1);
  assert.deepEqual(calls.confirms, []);
});

test("provider confirmation cannot cross the exact paid receipt", async () => {
  const selected = reservation();
  const changed = subscriptionFacts(selected, {
    metadata: {
      ...createAlakazamProviderMetadata({
        purpose: selected.purpose,
        purposeDigest: selected.purposeDigest
      }),
      payment_receipt_id:
        "20000000-0000-4000-8000-000000000099",
      payment_facts_digest: PAYMENT_DIGEST
    }
  });
  const { calls, service, settlement: input } = fixture({
    applyFacts: changed
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code ===
        "alakazam_upgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.applies.length, 1);
  assert.equal(calls.marks.length, 1);
  assert.deepEqual(calls.confirms, []);
});

test("provider success with uncertain persistence is fenced for read-only reconciliation", async () => {
  const { calls, service, settlement: input } = fixture({
    confirmError: new Error("database unavailable")
  });
  await assert.rejects(
    service.applyPaidUpgrade(input),
    (error) =>
      error.code ===
        "alakazam_upgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.applies.length, 1);
  assert.equal(calls.confirms.length, 1);
  assert.equal(calls.marks.length, 1);
  assert.equal(
    calls.marks[0].errorCode,
    "upgrade_confirmation_persistence_failed"
  );
});
