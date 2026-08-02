import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_DOWNLOAD_CREDIT_MINOR,
  ALAKAZAM_TIER_IDS,
  authorizeAlakazamCapability,
  getBrowserSafeAlakazamCatalog,
  getPrivateAlakazamCatalog,
  quoteAlakazamChange,
  resolveAlakazamTier
} from "../index.mjs";

const ISSUED_AT = "2026-08-02T12:00:00.000Z";
const EXPIRES_AT = "2026-08-02T12:30:00.000Z";
const PERIOD_END = "2026-08-20T12:00:00.000Z";

function quote(overrides = {}) {
  return quoteAlakazamChange({
    quoteId: "quote_alakazam_1",
    tenantId: "tenant_1",
    customerId: "customer_1",
    projectId: "project_1",
    targetTierId: "alakazam_25",
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides
  });
}

function subscription(tierId, overrides = {}) {
  return {
    subscriptionId: "subscription_alakazam_1",
    projectId: "project_1",
    tierId,
    status: "active",
    revision: 4,
    currentPeriodEndsAt: PERIOD_END,
    cancelAtPeriodEnd: false,
    pendingChange: null,
    ...overrides
  };
}

test("Alakazam catalog contains exactly the owner-approved 25, 35, and 50 tiers", () => {
  const catalog = getPrivateAlakazamCatalog();
  assert.deepEqual(ALAKAZAM_TIER_IDS, [
    "alakazam_25",
    "alakazam_35",
    "alakazam_50"
  ]);
  assert.deepEqual(
    catalog.tiers.map((tier) => tier.price.amountMinor),
    [2500, 3500, 5000]
  );
  assert.equal(catalog.state, "held");
  assert.equal(catalog.providerEffectsAuthorized, false);
  assert.doesNotMatch(JSON.stringify(catalog), /alakazam_(?:15|30)/u);
});

test("browser catalog publishes benefits and prices but no provider authority", () => {
  const catalog = getBrowserSafeAlakazamCatalog();
  const serialized = JSON.stringify(catalog);
  assert.equal(catalog.tiers.length, 3);
  assert.doesNotMatch(serialized, /price_[A-Za-z0-9]/u);
  assert.doesNotMatch(serialized, /coupon_[A-Za-z0-9]/u);
  assert.doesNotMatch(serialized, /sk_(?:live|test)_/u);
});

test("tier capabilities inherit upward without inventing care quantities", () => {
  const base = resolveAlakazamTier("alakazam_25");
  const expanded = resolveAlakazamTier("alakazam_35");
  const rich = resolveAlakazamTier("alakazam_50");
  assert.equal(base.capabilities.includes("photo_header"), false);
  assert.equal(expanded.capabilities.includes("photo_header"), true);
  assert.equal(expanded.limits.versionHistory, 3);
  assert.equal(rich.capabilities.includes("cash_app_link"), true);
  assert.equal(rich.capabilities.includes("venmo_link"), true);
  assert.equal(rich.capabilities.includes("site_menu"), true);
  assert.equal(base.limits.careClass, "none");
  assert.equal(expanded.limits.careClass, "modest");
  assert.equal(rich.limits.careClass, "more");
  assert.equal(Object.hasOwn(expanded.limits, "minutes"), false);
  assert.equal(Object.hasOwn(expanded.limits, "editCount"), false);
  assert.equal(Object.hasOwn(expanded.limits, "responseHours"), false);
});

test("a first subscription without a Download purchase charges the full selected tier", () => {
  for (const [targetTierId, amountMinor] of [
    ["alakazam_25", 2500],
    ["alakazam_35", 3500],
    ["alakazam_50", 5000]
  ]) {
    const result = quote({ targetTierId });
    assert.equal(result.changeKind, "start");
    assert.equal(result.dueNow.subtotalMinor, amountMinor);
    assert.equal(result.appliedValue.amountMinor, 0);
    assert.equal(result.nextRenewal.amountMinor, amountMinor);
  }
});

test("an authorized quote binds the reviewed tax mode without adding provider authority", () => {
  const automatic = quote({
    providerEffectsAuthorized: true,
    taxMode: "automatic"
  });
  assert.equal(automatic.state, "quoted");
  assert.equal(automatic.providerEffectsAuthorized, true);
  assert.equal(automatic.dueNow.taxState, "automatic");
  assert.equal(automatic.dueNow.taxMinor, null);
  assert.equal(automatic.dueNow.totalMinor, null);

  const taxDisabled = quote({
    providerEffectsAuthorized: true,
    taxMode: "disabled_by_owner"
  });
  assert.equal(
    taxDisabled.dueNow.taxState,
    "disabled_by_owner"
  );
  assert.equal(taxDisabled.dueNow.taxMinor, 0);
  assert.equal(taxDisabled.dueNow.totalMinor, 2500);
  assert.doesNotMatch(
    JSON.stringify(taxDisabled),
    /(?:price|coupon|sub|cus)_[A-Za-z0-9_]+/u
  );

  assert.throws(
    () =>
      quote({
        providerEffectsAuthorized: false,
        taxMode: "automatic"
      }),
    (error) => error.code === "invalid_input"
  );
});

test("the project Download purchase applies exactly once to the first subscription invoice", () => {
  for (const [targetTierId, amountMinor] of [
    ["alakazam_25", 2000],
    ["alakazam_35", 3000],
    ["alakazam_50", 4500]
  ]) {
    const result = quote({
      targetTierId,
      downloadCredit: {
        entitlementId: "download_entitlement_1",
        state: "active",
        available: true,
        amountMinor: ALAKAZAM_DOWNLOAD_CREDIT_MINOR
      }
    });
    assert.equal(result.dueNow.subtotalMinor, amountMinor);
    assert.equal(result.appliedValue.kind, "download_purchase");
    assert.equal(result.appliedValue.amountMinor, 500);
    assert.equal(
      result.nextRenewal.amountMinor,
      resolveAlakazamTier(targetTierId).price.amountMinor
    );
  }
});

test("paid upgrades charge only the fixed tier difference and renew at the full target tier", () => {
  for (const [fromTierId, targetTierId, dueMinor] of [
    ["alakazam_25", "alakazam_35", 1000],
    ["alakazam_35", "alakazam_50", 1500],
    ["alakazam_25", "alakazam_50", 2500]
  ]) {
    const result = quote({
      targetTierId,
      currentSubscription: subscription(fromTierId)
    });
    assert.equal(result.changeKind, "upgrade");
    assert.equal(result.dueNow.subtotalMinor, dueMinor);
    assert.equal(result.appliedValue.kind, "current_paid_tier");
    assert.equal(
      result.nextRenewal.amountMinor,
      resolveAlakazamTier(targetTierId).price.amountMinor
    );
    assert.equal(
      result.effectiveAt,
      "after_payment_and_provider_confirmation"
    );
  }
});

test("downgrades charge and refund nothing now, keep current access, and switch at renewal", () => {
  const result = quote({
    targetTierId: "alakazam_25",
    currentSubscription: subscription("alakazam_50")
  });
  assert.equal(result.changeKind, "downgrade");
  assert.equal(result.dueNow.subtotalMinor, 0);
  assert.equal(result.effectiveAt, PERIOD_END);
  assert.equal(result.noMidPeriodRefundOrProration, true);
  assert.equal(result.disclosure.downgrade.cashRefundMinor, 0);
  assert.equal(result.disclosure.downgrade.providerProration, false);
  assert.equal(result.nextRenewal.amountMinor, 2500);
  assert.equal(result.premiumConfiguration, "preserved_when_inactive");
});

test("same-tier, delinquent, cancelling, and already-changing subscriptions cannot open another change", () => {
  assert.throws(
    () =>
      quote({
        targetTierId: "alakazam_25",
        currentSubscription: subscription("alakazam_25")
      }),
    (error) => error.code === "alakazam_tier_unchanged"
  );
  for (const overrides of [
    { status: "grace" },
    { cancelAtPeriodEnd: true },
    { pendingChange: { targetTierId: "alakazam_35" } }
  ]) {
    assert.throws(
      () =>
        quote({
          targetTierId: "alakazam_35",
          currentSubscription: subscription(
            "alakazam_25",
            overrides
          )
        }),
      (error) =>
        [
          "alakazam_change_unavailable",
          "alakazam_cancellation_pending",
          "alakazam_change_pending"
        ].includes(error.code)
    );
  }
  assert.throws(
    () =>
      quote({
        issuedAt: PERIOD_END,
        expiresAt: "2026-08-20T12:30:00.000Z",
        targetTierId: "alakazam_35",
        currentSubscription: subscription("alakazam_25")
      }),
    (error) => error.code === "alakazam_change_unavailable"
  );
});

test("Download credit is project authority for entry only, never an active-tier browser discount", () => {
  assert.throws(
    () =>
      quote({
        targetTierId: "alakazam_35",
        currentSubscription: subscription("alakazam_25"),
        downloadCredit: {
          entitlementId: "download_entitlement_1",
          state: "active",
          available: true,
          amountMinor: 500
        }
      }),
    (error) => error.code === "alakazam_credit_not_applicable"
  );
  assert.throws(
    () =>
      quote({
        downloadCredit: {
          entitlementId: "download_entitlement_1",
          state: "revoked",
          available: true,
          amountMinor: 500
        }
      }),
    (error) => error.code === "alakazam_credit_unavailable"
  );
});

test("scheduled downgrade retains rich capability through the paid boundary and fails closed after it", () => {
  const current = subscription("alakazam_50", {
    scheduledTierId: "alakazam_25",
    scheduledEffectiveAt: PERIOD_END
  });
  const before = authorizeAlakazamCapability(current, {
    capability: "cash_app_link",
    now: "2026-08-20T11:59:59.999Z"
  });
  assert.equal(before.tierId, "alakazam_50");
  assert.throws(
    () =>
      authorizeAlakazamCapability(current, {
        capability: "cash_app_link",
        now: PERIOD_END
      }),
    (error) => error.code === "alakazam_capability_unavailable"
  );
  const after = authorizeAlakazamCapability(current, {
    capability: "host_at_sitesourcery_me",
    now: PERIOD_END
  });
  assert.equal(after.tierId, "alakazam_25");
});

test("period-end cancellation and expired payment grace stop entitlement authority", () => {
  assert.throws(
    () =>
      authorizeAlakazamCapability(
        subscription("alakazam_35", {
          cancelAtPeriodEnd: true
        }),
        {
          capability: "photo_header",
          now: PERIOD_END
        }
      ),
    (error) => error.code === "alakazam_entitlement_unavailable"
  );
  assert.throws(
    () =>
      authorizeAlakazamCapability(
        subscription("alakazam_35", {
          status: "grace",
          graceEndsAt: "2026-08-10T12:00:00.000Z"
        }),
        {
          capability: "photo_header",
          now: "2026-08-10T12:00:00.000Z"
        }
      ),
    (error) => error.code === "alakazam_entitlement_unavailable"
  );
  assert.throws(
    () =>
      authorizeAlakazamCapability(
        subscription("alakazam_35", {
          scheduledTierId: "alakazam_50",
          scheduledEffectiveAt: PERIOD_END
        }),
        {
          capability: "photo_header",
          now: "2026-08-10T12:00:00.000Z"
        }
      ),
    (error) => error.code === "alakazam_entitlement_unavailable"
  );
});

test("Alakazam change quote digests bind the exact target, credit, renewal, and effective rule", () => {
  const first = quote({
    targetTierId: "alakazam_35",
    currentSubscription: subscription("alakazam_25")
  });
  const replay = quote({
    targetTierId: "alakazam_35",
    currentSubscription: subscription("alakazam_25")
  });
  const changed = quote({
    targetTierId: "alakazam_50",
    currentSubscription: subscription("alakazam_25")
  });
  assert.equal(first.quoteDigest, replay.quoteDigest);
  assert.equal(first.disclosureDigest, replay.disclosureDigest);
  assert.notEqual(first.quoteDigest, changed.quoteDigest);
  assert.notEqual(
    first.disclosureDigest,
    changed.disclosureDigest
  );
});
