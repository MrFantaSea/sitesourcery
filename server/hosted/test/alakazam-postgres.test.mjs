import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresAlakazamRepository
} from "../alakazam-postgres.mjs";

const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const OTHER_CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000002";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const QUOTE_ID =
  "40000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID =
  "50000000-0000-4000-8000-000000000001";
const ENTITLEMENT_ID =
  "60000000-0000-4000-8000-000000000001";
const SCHEDULE_ID =
  "70000000-0000-4000-8000-000000000001";
const ISSUED_AT = "2026-08-02T12:00:00.000Z";
const EXPIRES_AT = "2026-08-02T12:30:00.000Z";
const PERIOD_START = "2026-08-02T11:00:00.000Z";
const PERIOD_END = "2026-09-02T11:00:00.000Z";

function result(rows = []) {
  return {
    rows: structuredClone(rows),
    rowCount: rows.length
  };
}

function quoteInput(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    quoteId: QUOTE_ID,
    targetTierId: "alakazam_25",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    taxMode: "disabled_by_owner",
    ...overrides
  };
}

function subscription(overrides = {}) {
  return {
    id: SUBSCRIPTION_ID,
    organization_id: TENANT_ID,
    project_id: PROJECT_ID,
    customer_user_id: CUSTOMER_ID,
    tier_id: "alakazam_25",
    amount_minor: "2500",
    status: "active",
    revision: "2",
    current_period_starts_at: PERIOD_START,
    current_period_ends_at: PERIOD_END,
    cancel_at_period_end: false,
    ...overrides
  };
}

function harness({
  currentSubscription = null,
  pendingSchedule = null,
  entitlementId = null,
  projectAvailable = true
} = {}) {
  const state = {
    quote: null,
    insertCount: 0
  };
  const calls = [];
  const serviceCalls = [];
  const client = {
    async query(text, values = []) {
      const normalized = text.replace(/\s+/gu, " ").trim();
      calls.push({
        text: normalized,
        values: structuredClone(values)
      });

      if (
        normalized.includes("select project.id") &&
        normalized.includes("for update of project")
      ) {
        assert.deepEqual(values[3], [
          "owner",
          "admin",
          "editor"
        ]);
        return projectAvailable &&
          values[0] === TENANT_ID &&
          values[1] === CUSTOMER_ID &&
          values[2] === PROJECT_ID
          ? result([{ id: PROJECT_ID }])
          : result();
      }

      if (
        normalized.includes(
          "from ss.alakazam_change_quotes"
        ) &&
        normalized.includes("and id = $2")
      ) {
        return state.quote ? result([state.quote]) : result();
      }

      if (
        normalized.includes(
          "from ss.alakazam_subscriptions"
        )
      ) {
        return currentSubscription
          ? result([currentSubscription])
          : result();
      }

      if (
        normalized.includes(
          "from ss.alakazam_downgrade_schedules"
        )
      ) {
        return pendingSchedule
          ? result([pendingSchedule])
          : result();
      }

      if (
        normalized.includes(
          "from ss.commerce_v2_project_entitlements"
        )
      ) {
        return entitlementId
          ? result([{ id: entitlementId }])
          : result();
      }

      if (
        normalized.includes(
          "insert into ss.alakazam_change_quotes"
        )
      ) {
        state.insertCount += 1;
        state.quote = {
          id: values[0],
          organization_id: values[1],
          project_id: values[2],
          customer_user_id: values[3],
          catalog_version: values[4],
          terms_version: values[5],
          change_kind: values[6],
          current_subscription_id: values[7],
          current_subscription_revision: values[8],
          current_tier_id: values[9],
          current_amount_minor: values[10],
          current_period_ends_at: values[11],
          target_tier_id: values[12],
          target_amount_minor: values[13],
          applied_value_kind: values[14],
          applied_value_minor: values[15],
          download_entitlement_id: values[16],
          due_now_subtotal_minor: values[17],
          next_renewal_amount_minor: values[13],
          currency: "USD",
          effective_rule: values[18],
          effective_at: values[19],
          no_mid_period_refund: values[20],
          provider_proration_enabled: false,
          premium_configuration_policy:
            "preserved_when_inactive",
          tax_state: values[21],
          disclosure: JSON.parse(values[22]),
          disclosure_digest: values[23],
          quote_digest: values[24],
          state: "quoted",
          provider_effects_authorized: true,
          issued_at: values[25],
          expires_at: values[26],
          created_by_user_id: values[3]
        };
        return result([state.quote]);
      }

      assert.fail(`Unexpected SQL: ${normalized}`);
    }
  };
  const authority = {
    async service(context, work) {
      serviceCalls.push(structuredClone(context));
      return work(client);
    }
  };
  return {
    repository: createPostgresAlakazamRepository({
      authority
    }),
    calls,
    serviceCalls,
    state
  };
}

test("PostgreSQL Alakazam start quote locks one project and applies one unused Download credit", async () => {
  const context = harness({ entitlementId: ENTITLEMENT_ID });
  const quote = await context.repository.createQuote(
    quoteInput()
  );
  assert.equal(quote.changeKind, "start");
  assert.equal(quote.appliedValue.kind, "download_purchase");
  assert.equal(quote.appliedValue.sourceId, ENTITLEMENT_ID);
  assert.equal(quote.dueNow.subtotalMinor, 2000);
  assert.equal(quote.nextRenewal.amountMinor, 2500);
  assert.equal(quote.dueNow.taxMinor, 0);
  assert.equal(quote.dueNow.totalMinor, 2000);
  assert.equal(context.state.insertCount, 1);
  assert.deepEqual(context.serviceCalls, [
    {
      userId: CUSTOMER_ID,
      organizationId: TENANT_ID
    }
  ]);
  assert.equal(
    context.calls.some(
      (call) =>
        call.text.includes("for update of project")
    ),
    true
  );
  assert.equal(
    context.calls.some(
      (call) =>
        call.text.includes("for update of entitlement")
    ),
    true
  );
});

test("PostgreSQL Alakazam quote ID replays its first durable snapshot without a second insert", async () => {
  const context = harness({ entitlementId: ENTITLEMENT_ID });
  const first = await context.repository.createQuote(
    quoteInput()
  );
  const replay = await context.repository.createQuote(
    quoteInput({
      issuedAt: "2026-08-02T12:01:00.000Z",
      expiresAt: "2026-08-02T12:31:00.000Z"
    })
  );
  assert.deepEqual(replay, first);
  assert.equal(context.state.insertCount, 1);
  await assert.rejects(
    context.repository.createQuote(
      quoteInput({ targetTierId: "alakazam_35" })
    ),
    (error) => error.code === "idempotency_conflict"
  );
  assert.equal(context.state.insertCount, 1);
});

test("PostgreSQL Alakazam upgrade binds the current paid revision and exact fixed difference", async () => {
  const context = harness({
    currentSubscription: subscription()
  });
  const quote = await context.repository.createQuote(
    quoteInput({ targetTierId: "alakazam_35" })
  );
  assert.equal(quote.changeKind, "upgrade");
  assert.deepEqual(quote.currentSubscriptionBinding, {
    subscriptionId: SUBSCRIPTION_ID,
    tierId: "alakazam_25",
    revision: 2,
    currentPeriodEndsAt: PERIOD_END
  });
  assert.equal(quote.appliedValue.amountMinor, 2500);
  assert.equal(quote.dueNow.subtotalMinor, 1000);
  assert.equal(context.state.quote.current_amount_minor, 2500);
  assert.equal(
    context.calls.some(
      (call) =>
        call.text.includes(
          "from ss.commerce_v2_project_entitlements"
        )
    ),
    false
  );
});

test("PostgreSQL Alakazam downgrade stores zero due now and the exact renewal boundary", async () => {
  const context = harness({
    currentSubscription: subscription({
      tier_id: "alakazam_35",
      amount_minor: "3500",
      revision: "4"
    })
  });
  const quote = await context.repository.createQuote(
    quoteInput({ targetTierId: "alakazam_25" })
  );
  assert.equal(quote.changeKind, "downgrade");
  assert.equal(quote.dueNow.subtotalMinor, 0);
  assert.equal(quote.effectiveAt, PERIOD_END);
  assert.equal(quote.noMidPeriodRefundOrProration, true);
  assert.equal(context.state.quote.current_amount_minor, 3500);
  assert.equal(
    context.state.quote.effective_rule,
    "current_period_end"
  );
  assert.equal(context.state.quote.effective_at, PERIOD_END);
});

test("PostgreSQL Alakazam quote refuses an existing schedule, stale billing owner, or unavailable project", async () => {
  const pending = harness({
    currentSubscription: subscription(),
    pendingSchedule: {
      id: SCHEDULE_ID,
      target_tier_id: "alakazam_25",
      effective_at: PERIOD_END,
      state: "scheduled"
    }
  });
  await assert.rejects(
    pending.repository.createQuote(
      quoteInput({ targetTierId: "alakazam_35" })
    ),
    (error) => error.code === "alakazam_change_pending"
  );
  assert.equal(pending.state.insertCount, 0);

  const otherOwner = harness({
    currentSubscription: subscription({
      customer_user_id: OTHER_CUSTOMER_ID
    })
  });
  await assert.rejects(
    otherOwner.repository.createQuote(
      quoteInput({ targetTierId: "alakazam_35" })
    ),
    (error) => error.code === "alakazam_change_unavailable"
  );
  assert.equal(otherOwner.state.insertCount, 0);

  const paymentState = harness({
    currentSubscription: subscription({ status: "grace" })
  });
  await assert.rejects(
    paymentState.repository.createQuote(
      quoteInput({ targetTierId: "alakazam_35" })
    ),
    (error) => error.code === "alakazam_change_unavailable"
  );
  assert.equal(paymentState.state.insertCount, 0);

  const missingProject = harness({
    projectAvailable: false
  });
  await assert.rejects(
    missingProject.repository.createQuote(quoteInput()),
    (error) => error.code === "project_unavailable"
  );
  assert.equal(missingProject.state.insertCount, 0);
});
