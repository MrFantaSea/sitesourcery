import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_BILLING_STATES_SCHEMA,
  alakazamBillingStatesAreNewer,
  projectAlakazamBillingStates
} from "../alakazam-billing-states.mjs";
import {
  createHeldHostedAlakazamBillingSurfaces,
  createHostedAlakazamBillingSurfaces,
  matchAlakazamBillingSurfaceRoute
} from "../alakazam-billing.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";

function scope() {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID
  };
}

function stored({
  subscription = {},
  events = {},
  reconciliation = { kind: null, since: null },
  observedAt = "2026-08-08T12:00:00.000Z"
} = {}) {
  return {
    projectId: PROJECT_ID,
    observedAt,
    subscription: subscription === null
      ? null
      : {
          status: "active",
          revision: 2,
          firstFailedAt: null,
          graceEndsAt: null,
          providerObservedAt: "2026-08-08T11:12:05.000Z",
          updatedAt: "2026-08-08T11:12:05.000Z",
          ...subscription
        },
    events: {
      total: 1,
      outstanding: 0,
      failed: 0,
      maximumAttemptCount: 1,
      lastOccurredAt: "2026-08-08T11:12:00.000Z",
      lastProcessedAt: "2026-08-08T11:12:05.000Z",
      ...events
    },
    reconciliation
  };
}

test("E-09 projects a settled account as current, replayed-through, and reconciled", () => {
  const states = projectAlakazamBillingStates(
    stored(),
    scope()
  );
  assert.equal(
    states.schema,
    ALAKAZAM_BILLING_STATES_SCHEMA
  );
  assert.equal(states.projectId, PROJECT_ID);
  assert.equal(states.observedAt, "2026-08-08T12:00:00.000Z");
  assert.equal(states.revision, 2);
  assert.equal(
    states.providerObservedAt,
    "2026-08-08T11:12:05.000Z"
  );
  assert.deepEqual(states.payment, {
    state: "current",
    subscriptionStatus: "active",
    retry: {
      active: false,
      startedAt: null,
      graceEndsAt: null
    }
  });
  assert.equal(states.replay.state, "settled");
  assert.equal(states.replay.duplicateSuppressed, true);
  assert.equal(states.reconciliation.state, "none");
  assert.deepEqual(states.display, {
    attentionRequired: false,
    settled: true
  });
  assert.equal(Object.isFrozen(states), true);
});

test("a payment retry is surfaced with the grace boundary the customer actually has", () => {
  const states = projectAlakazamBillingStates(
    stored({
      subscription: {
        status: "grace",
        revision: 3,
        firstFailedAt: "2026-08-08T11:30:00.000Z",
        graceEndsAt: "2026-08-22T11:30:00.000Z"
      }
    }),
    scope()
  );
  assert.equal(states.payment.state, "retrying");
  assert.deepEqual(states.payment.retry, {
    active: true,
    startedAt: "2026-08-08T11:30:00.000Z",
    graceEndsAt: "2026-08-22T11:30:00.000Z"
  });
  assert.equal(states.display.attentionRequired, true);
  assert.equal(states.display.settled, false);
});

test("every durable subscription status maps to exactly one customer payment state", () => {
  const expected = {
    pending: "pending",
    active: "current",
    grace: "retrying",
    suspended: "suspended",
    cancelled: "ended",
    ended: "ended"
  };
  for (const [status, state] of Object.entries(expected)) {
    const states = projectAlakazamBillingStates(
      stored({ subscription: { status } }),
      scope()
    );
    assert.equal(states.payment.state, state, status);
  }
  const none = projectAlakazamBillingStates(
    stored({
      subscription: null,
      events: {
        total: 0,
        outstanding: 0,
        failed: 0,
        maximumAttemptCount: 0,
        lastOccurredAt: null,
        lastProcessedAt: null
      }
    }),
    scope()
  );
  assert.equal(none.payment.state, "none");
  assert.equal(none.revision, 0);
  assert.equal(none.providerObservedAt, null);
});

test("an outstanding webhook replay reads as verifying, and a failed one as attention required", () => {
  const verifying = projectAlakazamBillingStates(
    stored({
      events: {
        total: 2,
        outstanding: 1,
        failed: 0,
        maximumAttemptCount: 4
      }
    }),
    scope()
  );
  assert.equal(verifying.replay.state, "verifying");
  assert.equal(verifying.replay.outstanding, 1);
  assert.equal(verifying.replay.maximumAttempts, 4);
  assert.equal(
    verifying.display.attentionRequired,
    false
  );
  assert.equal(verifying.display.settled, false);

  const failing = projectAlakazamBillingStates(
    stored({
      events: {
        total: 3,
        outstanding: 2,
        failed: 1,
        maximumAttemptCount: 6
      }
    }),
    scope()
  );
  assert.equal(
    failing.replay.state,
    "attention_required"
  );
  assert.equal(failing.replay.failed, 1);
  assert.equal(failing.display.attentionRequired, true);
});

test("a required provider reconciliation is surfaced with its kind and since", () => {
  for (const kind of [
    "tier_change",
    "downgrade_schedule"
  ]) {
    const states = projectAlakazamBillingStates(
      stored({
        reconciliation: {
          kind,
          since: "2026-08-08T11:41:00.000Z"
        }
      }),
      scope()
    );
    assert.equal(states.reconciliation.state, "required");
    assert.equal(states.reconciliation.kind, kind);
    assert.equal(
      states.reconciliation.since,
      "2026-08-08T11:41:00.000Z"
    );
    assert.equal(states.display.attentionRequired, true);
    assert.equal(states.display.settled, false);
  }
});

test("inconsistent counts, an unbound event set, or a half-set reconciliation are refused", () => {
  assert.throws(
    () =>
      projectAlakazamBillingStates(
        stored({
          events: { total: 1, outstanding: 2, failed: 0 }
        }),
        scope()
      ),
    /provider event counts changed/u
  );
  assert.throws(
    () =>
      projectAlakazamBillingStates(
        stored({ subscription: null }),
        scope()
      ),
    /provider events are unbound/u
  );
  assert.throws(
    () =>
      projectAlakazamBillingStates(
        stored({
          reconciliation: {
            kind: "tier_change",
            since: null
          }
        }),
        scope()
      ),
    /reconciliation binding changed/u
  );
  assert.throws(
    () =>
      projectAlakazamBillingStates(
        stored({
          subscription: {
            firstFailedAt: null,
            graceEndsAt: "2026-08-22T11:30:00.000Z"
          }
        }),
        scope()
      ),
    /grace period changed/u
  );
  assert.throws(
    () =>
      projectAlakazamBillingStates(
        stored(),
        { ...scope(), projectId: "30000000-0000-4000-8000-000000000002" }
      ),
    /billing state binding changed/u
  );
});

test("the anti-stale rule refuses to move the account view backwards on a replay", () => {
  const current = projectAlakazamBillingStates(
    stored({
      subscription: { revision: 3 },
      observedAt: "2026-08-08T12:00:00.000Z"
    }),
    scope()
  );
  const replayedOlder = projectAlakazamBillingStates(
    stored({
      subscription: { revision: 2 },
      observedAt: "2026-08-08T12:00:30.000Z"
    }),
    scope()
  );
  const sameRevisionLater = projectAlakazamBillingStates(
    stored({
      subscription: { revision: 3 },
      observedAt: "2026-08-08T12:00:30.000Z"
    }),
    scope()
  );
  const sameRevisionEarlier =
    projectAlakazamBillingStates(
      stored({
        subscription: { revision: 3 },
        observedAt: "2026-08-08T11:59:30.000Z"
      }),
      scope()
    );
  const newerRevision = projectAlakazamBillingStates(
    stored({
      subscription: { revision: 4 },
      observedAt: "2026-08-08T11:59:00.000Z"
    }),
    scope()
  );
  assert.equal(
    alakazamBillingStatesAreNewer(replayedOlder, current),
    false
  );
  assert.equal(
    alakazamBillingStatesAreNewer(
      sameRevisionEarlier,
      current
    ),
    false
  );
  assert.equal(
    alakazamBillingStatesAreNewer(current, current),
    false
  );
  assert.equal(
    alakazamBillingStatesAreNewer(
      sameRevisionLater,
      current
    ),
    true
  );
  assert.equal(
    alakazamBillingStatesAreNewer(
      newerRevision,
      current
    ),
    true
  );
  assert.equal(
    alakazamBillingStatesAreNewer(current, null),
    true
  );
  assert.equal(
    alakazamBillingStatesAreNewer(null, current),
    false
  );
});

test("the billing states route is matched only as a GET on the exact path", () => {
  assert.deepEqual(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam/billing-states`
    ),
    {
      surface: "billingStates",
      projectId: PROJECT_ID,
      receiptId: null
    }
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "PUT",
      `/api/v1/projects/${PROJECT_ID}/alakazam/billing-states`
    ),
    null
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam`
    ),
    null
  );
});

test("the default hosted runtime keeps the billing states surface held", async () => {
  const held = createHeldHostedAlakazamBillingSurfaces();
  await assert.rejects(
    () =>
      held.getBillingStates(
        { userId: CUSTOMER_ID },
        PROJECT_ID
      ),
    (error) =>
      error.code === "ALAKAZAM_BILLING_STATES_HELD" &&
      error.status === 503
  );
});

test("the composed billing states read is bound to the signed-in customer only", async () => {
  const calls = [];
  const surfaces = createHostedAlakazamBillingSurfaces({
    repository: {
      async readCustomerInvoice() {
        throw new Error("unused");
      },
      async readCustomerBillingStates(input) {
        calls.push(input);
        return stored();
      }
    },
    account: {
      async read() {
        throw new Error("unused");
      }
    },
    async resolveSession({ actor, projectId }) {
      return {
        tenantId: TENANT_ID,
        customerId: actor.userId,
        actorId: actor.userId,
        projectId
      };
    }
  });
  const states = await surfaces.getBillingStates(
    { userId: CUSTOMER_ID },
    PROJECT_ID
  );
  assert.equal(states.payment.state, "current");
  assert.deepEqual(calls, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      actorId: CUSTOMER_ID,
      projectId: PROJECT_ID
    }
  ]);
});

test("the billing states surface never carries a provider identifier", () => {
  const serialized = JSON.stringify(
    projectAlakazamBillingStates(
      stored({
        events: {
          total: 3,
          outstanding: 2,
          failed: 1,
          maximumAttemptCount: 6
        },
        reconciliation: {
          kind: "downgrade_schedule",
          since: "2026-08-08T11:41:00.000Z"
        }
      }),
      scope()
    )
  );
  for (const prefix of [
    "cus_",
    "sub_",
    "in_",
    "pi_",
    "evt_",
    "price_",
    "cs_"
  ]) {
    assert.equal(
      serialized.includes(prefix),
      false,
      `billing states exposed ${prefix}`
    );
  }
});
