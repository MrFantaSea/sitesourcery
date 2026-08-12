import assert from "node:assert/strict";
import test from "node:test";

import {
  createAlakazamAccountService
} from "../../commerce-v2/alakazam-account.mjs";
import {
  ALAKAZAM_CANCELLATION_POLICY,
  ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA,
  projectAlakazamCancellationPreview
} from "../alakazam-billing-cancellation.mjs";
import {
  createHeldHostedAlakazamBillingSurfaces,
  createHostedAlakazamBillingSurfaces,
  matchAlakazamBillingSurfaceRoute
} from "../alakazam-billing.mjs";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "20000000-0000-4000-8000-000000000001";
const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const VERSION_ID = "31000000-0000-4000-8000-000000000001";
const ADDRESS_ID = "32000000-0000-4000-8000-000000000001";
const ADDRESS_LABEL = "l3-billing-preview";

function scope() {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID
  };
}

function liveSite() {
  return {
    acceptedVersionId: VERSION_ID,
    addressId: ADDRESS_ID,
    addressLabel: ADDRESS_LABEL,
    artifactDigest: "b".repeat(64),
    configuredLook: "clear",
    fulfillmentState: "live",
    fulfillmentSubscriptionRevision: 2,
    fulfillmentTierId: "alakazam_50",
    hostname: `${ADDRESS_LABEL}.sitesourcery.me`,
    updatedAt: "2026-08-08T11:15:00.000Z"
  };
}

function bareSite() {
  return {
    acceptedVersionId: null,
    addressId: null,
    addressLabel: null,
    artifactDigest: null,
    configuredLook: null,
    fulfillmentState: null,
    fulfillmentSubscriptionRevision: null,
    fulfillmentTierId: null,
    hostname: null,
    updatedAt: null
  };
}

function subscription(overrides = {}) {
  return {
    amountMinor: 5000,
    cancelAtPeriodEnd: false,
    currency: "USD",
    currentPeriodEndsAt: "2026-09-08T11:10:00.000Z",
    currentPeriodStartsAt: "2026-08-08T11:10:00.000Z",
    firstFailedAt: null,
    graceEndsAt: null,
    revision: 2,
    status: "active",
    tierId: "alakazam_50",
    ...overrides
  };
}

async function accountSnapshot(stored) {
  const service = createAlakazamAccountService({
    repository: {
      async readCustomerAccount() {
        return {
          projectId: PROJECT_ID,
          downloadCreditAvailable: false,
          receipts: [],
          site: bareSite(),
          subscription: null,
          pendingChange: null,
          invoiceFinalization: null,
          ...stored
        };
      }
    }
  });
  return service.read(scope());
}

test("E-08 previews exactly what cancelling would do to a live subscription", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription()
    }),
    scope()
  );
  assert.equal(
    preview.schema,
    ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA
  );
  assert.equal(preview.projectId, PROJECT_ID);
  assert.equal(preview.state, "available");
  assert.equal(preview.accountState, "active");
  assert.deepEqual(preview.subscription, {
    tierId: "alakazam_50",
    name: "Alakazam 50",
    status: "active",
    amountMinor: 5000,
    currency: "USD",
    currentPeriodEndsAt: "2026-09-08T11:10:00.000Z"
  });
  assert.equal(
    preview.effect.endsAt,
    "2026-09-08T11:10:00.000Z"
  );
  assert.equal(
    preview.effect.keepsAccessUntil,
    "2026-09-08T11:10:00.000Z"
  );
  assert.equal(preview.effect.alreadyScheduled, false);
  assert.equal(preview.effect.savedSetupKept, true);
  assert.equal(preview.effect.receiptsKept, true);
  assert.deepEqual(preview.effect.website, {
    state: "live",
    hostname: `${ADDRESS_LABEL}.sitesourcery.me`,
    url: `https://${ADDRESS_LABEL}.sitesourcery.me/`,
    publishedUntil: "2026-09-08T11:10:00.000Z",
    afterEnd: "not_published"
  });
  assert.deepEqual(preview.effect.renewalStopped, {
    tierId: "alakazam_50",
    amountMinor: 5000,
    currency: "USD",
    dueAt: "2026-09-08T11:10:00.000Z",
    chargedIfCancelled: false,
    currentTierId: "alakazam_50"
  });
  assert.equal(Object.isFrozen(preview), true);
});

test("the preview states no refund or proration amount while the cancellation policy is unreleased", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription()
    }),
    scope()
  );
  assert.deepEqual(preview.effect.refund, {
    state: "owner_review_required",
    cashRefundMinor: null,
    providerProration: null
  });
  assert.deepEqual(preview.policy, {
    cancellationPolicy: ALAKAZAM_CANCELLATION_POLICY,
    released: false,
    releaseBlocker: "cancellation_policy"
  });
  assert.equal(
    ALAKAZAM_CANCELLATION_POLICY,
    "owner_review_required_before_release"
  );
});

test("no confirmation and no Billing Portal session can be offered from the preview", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription()
    }),
    scope()
  );
  assert.deepEqual(preview.actions.confirmCancellation, {
    available: false,
    reason: "cancellation_policy_owner_review_required"
  });
  assert.deepEqual(preview.actions.billingPortal, {
    available: false,
    state: "held",
    reason: "alakazam_billing_held"
  });
  assert.equal(
    preview.actions.reason,
    "cancellation_preview_only"
  );
  assert.equal(
    JSON.stringify(preview).includes("stripe"),
    false
  );
  assert.equal(
    JSON.stringify(preview).includes("https://billing"),
    false
  );
});

test("a cancellation already scheduled previews the same dates and stops offering a renewal", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription({
        cancelAtPeriodEnd: true
      }),
      pendingChange: {
        changeKind: "cancellation",
        targetTierId: null,
        effectiveAt: "2026-09-08T11:10:00.000Z",
        state: "cancellation_scheduled"
      }
    }),
    scope()
  );
  assert.equal(preview.state, "already_scheduled");
  assert.equal(preview.effect.alreadyScheduled, true);
  assert.equal(
    preview.effect.endsAt,
    "2026-09-08T11:10:00.000Z"
  );
  assert.equal(preview.effect.renewalStopped, null);
  assert.equal(
    preview.actions.reason,
    "cancellation_already_scheduled"
  );
});

test("a subscription in grace can still be previewed and shows its retry-era renewal", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription({
        status: "grace",
        firstFailedAt: "2026-08-20T11:10:00.000Z",
        graceEndsAt: "2026-09-03T11:10:00.000Z"
      })
    }),
    scope()
  );
  assert.equal(preview.state, "available");
  assert.equal(preview.accountState, "attention_required");
  assert.equal(preview.subscription.status, "grace");
  assert.equal(
    preview.effect.renewalStopped.chargedIfCancelled,
    false
  );
});

test("an account with no cancellable subscription previews nothing to cancel", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({}),
    scope()
  );
  assert.equal(preview.state, "not_applicable");
  assert.equal(preview.subscription, null);
  assert.equal(preview.effect, null);
  assert.equal(
    preview.actions.reason,
    "no_cancellable_subscription"
  );
  assert.equal(
    preview.actions.confirmCancellation.available,
    false
  );
  assert.equal(
    preview.actions.billingPortal.available,
    false
  );
});

test("an ended subscription is not cancellable again", async () => {
  const preview = projectAlakazamCancellationPreview(
    await accountSnapshot({
      site: liveSite(),
      subscription: subscription({ status: "ended" })
    }),
    scope()
  );
  assert.equal(preview.state, "not_applicable");
  assert.equal(preview.effect, null);
});

test("a snapshot for another project or another schema is refused", async () => {
  const snapshot = await accountSnapshot({
    site: liveSite(),
    subscription: subscription()
  });
  assert.throws(
    () =>
      projectAlakazamCancellationPreview(snapshot, {
        ...scope(),
        projectId: "30000000-0000-4000-8000-000000000002"
      }),
    /account snapshot is unavailable/u
  );
  assert.throws(
    () =>
      projectAlakazamCancellationPreview(
        { ...snapshot, schema: "sitesourcery.other/v1" },
        scope()
      ),
    /account snapshot is unavailable/u
  );
});

test("a Billing Portal state other than held cannot be previewed by this runtime", async () => {
  assert.throws(
    () =>
      projectAlakazamCancellationPreview(
        accountSnapshotSync(),
        scope(),
        { billingPortalState: "approved_live" }
      ),
    /Billing Portal state is unavailable/u
  );
  function accountSnapshotSync() {
    return {
      schema: "sitesourcery.alakazam-account/v2",
      projectId: PROJECT_ID,
      state: "available",
      site: { state: "setup_required" },
      subscription: null,
      nextRenewal: null
    };
  }
});

test("the cancellation preview route is matched only as a GET on the exact path", () => {
  assert.deepEqual(
    matchAlakazamBillingSurfaceRoute(
      "GET",
      `/api/v1/projects/${PROJECT_ID}/alakazam/cancellation-preview`
    ),
    {
      surface: "cancellationPreview",
      projectId: PROJECT_ID,
      receiptId: null
    }
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "POST",
      `/api/v1/projects/${PROJECT_ID}/alakazam/cancellation-preview`
    ),
    null
  );
  assert.equal(
    matchAlakazamBillingSurfaceRoute(
      "DELETE",
      `/api/v1/projects/${PROJECT_ID}/alakazam/cancellation-preview`
    ),
    null
  );
});

test("the default hosted runtime keeps the cancellation preview held", async () => {
  const held = createHeldHostedAlakazamBillingSurfaces();
  await assert.rejects(
    () =>
      held.getCancellationPreview(
        { userId: CUSTOMER_ID },
        PROJECT_ID
      ),
    (error) =>
      error.code ===
        "ALAKAZAM_CANCELLATION_PREVIEW_HELD" &&
      error.status === 503
  );
});

test("the composed preview reads the customer's own account and never writes", async () => {
  const reads = [];
  const surfaces = createHostedAlakazamBillingSurfaces({
    repository: {
      async readCustomerInvoice() {
        throw new Error("unused");
      },
      async readCustomerBillingStates() {
        throw new Error("unused");
      }
    },
    account: {
      async read(readScope) {
        reads.push(readScope);
        return accountSnapshot({
          site: liveSite(),
          subscription: subscription()
        });
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
  const preview = await surfaces.getCancellationPreview(
    { userId: CUSTOMER_ID },
    PROJECT_ID
  );
  assert.equal(preview.state, "available");
  assert.deepEqual(reads, [
    {
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      actorId: CUSTOMER_ID,
      projectId: PROJECT_ID
    }
  ]);
});
