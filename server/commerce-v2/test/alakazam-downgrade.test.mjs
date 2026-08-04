import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  createAlakazamDowngradeApplication
} from "../alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../alakazam-billing.mjs";
import {
  createAlakazamDowngradeService
} from "../alakazam-downgrade.mjs";
import { digest } from "../canonical.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID = "10000000-0000-4000-8000-000000000003";
const QUOTE_ID = "10000000-0000-4000-8000-000000000004";
const SUBSCRIPTION_ID =
  "10000000-0000-4000-8000-000000000005";
const APPLICATION_ID =
  "20000000-0000-4000-8000-000000000001";
const TIER_EVENT_ID =
  "20000000-0000-4000-8000-000000000002";
const CLAIMED_AT = "2026-08-04T15:30:00.000Z";
const CONFIRMED_AT = "2026-08-04T15:31:00.000Z";
const PERIOD_START = "2026-08-02T12:03:00.000Z";
const PERIOD_END = "2026-09-02T12:03:00.000Z";
const STRIPE_SCHEDULE_ID = "sub_sched_alakazam_50_25";

function command() {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    acceptedDisclosureDigest: digest("accepted downgrade disclosure"),
    quoteDigest: digest("downgrade quote")
  };
}

function application() {
  const input = command();
  return createAlakazamDowngradeApplication({
    scheduleId: APPLICATION_ID,
    ...input,
    stripeCustomerId: "cus_alakazam_downgrade_1",
    currentSubscription: {
      localSubscriptionId: SUBSCRIPTION_ID,
      revision: 4,
      tierId: "alakazam_50",
      amountMinor: 5000,
      stripeSubscriptionId: "sub_alakazam_downgrade_1",
      stripeSubscriptionItemId: "si_alakazam_downgrade_1",
      stripePriceId: "price_alakazam_50",
      currentPeriodStartsAt: PERIOD_START,
      currentPeriodEndsAt: PERIOD_END,
      providerFactsDigest: digest("active 50 provider facts")
    },
    targetTierId: "alakazam_25",
    taxMode: "disabled_by_owner",
    claimedAt: CLAIMED_AT
  });
}

function scheduleFacts(selected = application(), overrides = {}) {
  const facts = {
    schema: ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
    stripeScheduleId: STRIPE_SCHEDULE_ID,
    stripeSubscriptionId:
      selected.purpose.currentSubscription.stripeSubscriptionId,
    stripeCustomerId: selected.stripeCustomerId,
    currentTierId: selected.purpose.currentSubscription.tierId,
    targetTierId: selected.purpose.targetTierId,
    currentPriceId:
      selected.purpose.currentSubscription.stripePriceId,
    targetPriceId: "price_alakazam_25",
    effectiveAt: selected.effectiveAt,
    endBehavior: "release",
    providerProration: false,
    providerObservedAt: CONFIRMED_AT,
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: digest(facts)
  };
}

function confirmation(
  selected = application(),
  facts = scheduleFacts(selected),
  reconciliation = "confirmed"
) {
  return {
    status: "scheduled",
    provider: "stripe",
    scheduleId: selected.scheduleId,
    stripeScheduleId: facts.stripeScheduleId,
    projectId: selected.projectId,
    quoteId: selected.quoteId,
    subscriptionId: selected.subscriptionId,
    priorTierId:
      selected.purpose.currentSubscription.tierId,
    targetTierId: selected.purpose.targetTierId,
    currentRevision:
      selected.purpose.currentSubscription.revision,
    effectiveAt: selected.effectiveAt,
    providerFactsDigest: facts.providerFactsDigest,
    reconciliation,
    next: "boundary_confirmation"
  };
}

function resolved(
  status,
  {
    selected = application(),
    facts = scheduleFacts(selected),
    stripeScheduleId = status === "scheduled"
      ? facts.stripeScheduleId
      : null,
    reconciliation = "confirmed"
  } = {}
) {
  return {
    status,
    provider: "stripe",
    application: selected,
    stripeScheduleId,
    ...(status === "scheduled"
      ? {
          confirmation: confirmation(
            selected,
            facts,
            reconciliation
          )
        }
      : {})
  };
}

function fixture({
  releaseApproved = true,
  existing = null,
  claimed = resolved("claimed"),
  providerFacts = scheduleFacts(),
  providerError = null,
  readFacts = scheduleFacts(),
  readError = null,
  confirmError = null,
  marked = undefined
} = {}) {
  const calls = {
    readiness: 0,
    finds: [],
    claims: [],
    schedules: [],
    reads: [],
    confirms: [],
    marks: [],
    ids: []
  };
  let clockCalls = 0;
  const service = createAlakazamDowngradeService({
    repository: {
      async findDowngradeApplication(input) {
        calls.finds.push(structuredClone(input));
        return existing === null
          ? null
          : structuredClone(existing);
      },
      async claimDowngradeApplication(input) {
        calls.claims.push(structuredClone(input));
        return structuredClone(claimed);
      },
      async confirmDowngradeSchedule(input) {
        calls.confirms.push(structuredClone(input));
        if (confirmError) throw confirmError;
        return confirmation(
          input.application,
          input.schedule,
          input.reconciliation
        );
      },
      async markDowngradeReconciliationRequired(input) {
        calls.marks.push(structuredClone(input));
        if (marked !== undefined) {
          return structuredClone(marked);
        }
        return resolved("reconciliation_required", {
          selected: input.application,
          stripeScheduleId: input.stripeScheduleId
        });
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
      async scheduleAlakazamDowngrade(input) {
        calls.schedules.push(structuredClone(input));
        if (providerError) throw providerError;
        return structuredClone(providerFacts);
      },
      async retrieveAlakazamSchedule(input) {
        calls.reads.push(structuredClone(input));
        if (readError) throw readError;
        return structuredClone(readFacts);
      }
    },
    clock: {
      now() {
        clockCalls += 1;
        return clockCalls === 1 ? CLAIMED_AT : CONFIRMED_AT;
      }
    },
    ids: {
      next(label) {
        calls.ids.push(label);
        return {
          alakazam_downgrade_application: APPLICATION_ID,
          alakazam_downgrade_tier_event: TIER_EVENT_ID
        }[label];
      }
    },
    release: createAlakazamBillingRelease({
      approved: releaseApproved,
      taxMode: releaseApproved
        ? "disabled_by_owner"
        : null
    })
  });
  return { calls, service };
}

test("Alakazam downgrade remains held before repository or provider work", async () => {
  const { calls, service } = fixture({ releaseApproved: false });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    downgrade: false,
    state: "held",
    code: "alakazam_billing_release_held"
  });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code === "alakazam_downgrade_unavailable" &&
      error.status === 503
  );
  assert.equal(calls.readiness, 0);
  assert.deepEqual(calls.finds, []);
  assert.deepEqual(calls.schedules, []);
  assert.deepEqual(calls.ids, []);
});

test("a downgrade claims once, schedules once, and stores exact provider evidence", async () => {
  const { calls, service } = fixture();
  const result = await service.scheduleDowngrade(command());
  assert.deepEqual(result, confirmation());
  assert.equal(calls.claims.length, 1);
  assert.equal(calls.schedules.length, 1);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.confirms.length, 1);
  assert.equal(calls.confirms[0].tierEventId, TIER_EVENT_ID);
  assert.deepEqual(calls.ids, [
    "alakazam_downgrade_application",
    "alakazam_downgrade_tier_event"
  ]);
});

test("a scheduled downgrade replay performs no provider work and allocates no ID", async () => {
  const { calls, service } = fixture({
    existing: resolved("scheduled")
  });
  assert.deepEqual(
    await service.scheduleDowngrade(command()),
    confirmation()
  );
  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.confirms.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("an active downgrade lease cannot submit a second Schedule", async () => {
  const { calls, service } = fixture({
    existing: resolved("in_progress")
  });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code === "alakazam_downgrade_in_progress" &&
      error.status === 409
  );
  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.reads.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("provider uncertainty is durably fenced and never retried read-write", async () => {
  const providerError = Object.assign(new Error("timeout"), {
    code: "stripe_timeout"
  });
  const { calls, service } = fixture({ providerError });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code ===
        "alakazam_downgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.schedules.length, 1);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.marks.length, 1);
  assert.equal(calls.marks[0].stripeScheduleId, null);
});

test("a known ambiguous Schedule recovers with one strictly read-only check", async () => {
  const { calls, service } = fixture({
    existing: resolved("reconciliation_required", {
      stripeScheduleId: STRIPE_SCHEDULE_ID
    })
  });
  const result = await service.scheduleDowngrade(command());
  assert.equal(result.status, "scheduled");
  assert.equal(result.reconciliation, "readback_after_ambiguity");
  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.confirms.length, 1);
  assert.deepEqual(calls.ids, [
    "alakazam_downgrade_tier_event"
  ]);
});

test("an ambiguous downgrade without a Schedule identity cannot contact Stripe", async () => {
  const { calls, service } = fixture({
    existing: resolved("reconciliation_required")
  });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code ===
        "alakazam_downgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.reads.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("changed Schedule readback cannot confirm or grant a lower tier", async () => {
  const changed = scheduleFacts(application(), {
    targetTierId: "alakazam_35",
    targetPriceId: "price_alakazam_35"
  });
  const { calls, service } = fixture({
    existing: resolved("reconciliation_required", {
      stripeScheduleId: STRIPE_SCHEDULE_ID
    }),
    readFacts: changed
  });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code ===
        "alakazam_downgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.schedules.length, 0);
  assert.equal(calls.reads.length, 1);
  assert.equal(calls.confirms.length, 0);
  assert.deepEqual(calls.ids, []);
});

test("an uncertain provider error preserves a known Schedule for read-only recovery", async () => {
  const providerError = Object.assign(new Error("update timeout"), {
    code: "stripe_schedule_update_unknown",
    details: { stripeScheduleId: STRIPE_SCHEDULE_ID }
  });
  const { calls, service } = fixture({ providerError });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code ===
        "alakazam_downgrade_reconciliation_required"
  );
  assert.equal(calls.marks.length, 1);
  assert.equal(
    calls.marks[0].stripeScheduleId,
    STRIPE_SCHEDULE_ID
  );
});

test("provider success with uncertain persistence is fenced for read-only recovery", async () => {
  const { calls, service } = fixture({
    confirmError: new Error("commit response lost")
  });
  await assert.rejects(
    service.scheduleDowngrade(command()),
    (error) =>
      error.code ===
        "alakazam_downgrade_reconciliation_required" &&
      error.status === 409
  );
  assert.equal(calls.schedules.length, 1);
  assert.equal(calls.confirms.length, 1);
  assert.equal(calls.marks.length, 1);
  assert.equal(
    calls.marks[0].stripeScheduleId,
    STRIPE_SCHEDULE_ID
  );
});

test("a concurrently committed confirmation wins over a lost repository response", async () => {
  const { calls, service } = fixture({
    confirmError: new Error("response lost"),
    marked: resolved("scheduled")
  });
  assert.deepEqual(
    await service.scheduleDowngrade(command()),
    confirmation()
  );
  assert.equal(calls.schedules.length, 1);
  assert.equal(calls.marks.length, 1);
});
