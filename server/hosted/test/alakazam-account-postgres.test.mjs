import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresAlakazamRepository
} from "../alakazam-postgres.mjs";

const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID =
  "40000000-0000-4000-8000-000000000001";
const RECEIPT_ID =
  "50000000-0000-4000-8000-000000000001";
const VERSION_ID =
  "60000000-0000-4000-8000-000000000001";
const ADDRESS_ID =
  "70000000-0000-4000-8000-000000000001";
const ARTIFACT_DIGEST = "a".repeat(64);
const SITE_UPDATED_AT = "2026-08-02T12:04:00.000Z";
const PERIOD_START = "2026-08-02T12:00:00.000Z";
const PERIOD_END = "2026-09-02T12:00:00.000Z";

function result(rows = []) {
  return {
    rows: structuredClone(rows),
    rowCount: rows.length
  };
}

function input(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function subscription(overrides = {}) {
  return {
    id: SUBSCRIPTION_ID,
    tier_id: "alakazam_35",
    status: "active",
    currency: "USD",
    amount_minor: "3500",
    current_period_starts_at: PERIOD_START,
    current_period_ends_at: PERIOD_END,
    cancel_at_period_end: false,
    first_failed_at: null,
    grace_ends_at: null,
    revision: "3",
    updated_at: SITE_UPDATED_AT,
    ...overrides
  };
}

function fulfillment(overrides = {}) {
  return {
    fulfillment_state: "live",
    effective_tier_id: "alakazam_35",
    subscription_revision: "3",
    projection_hostname:
      "cedar-workshop.sitesourcery.me",
    updated_at: SITE_UPDATED_AT,
    customer_user_id: CUSTOMER_ID,
    version_id: VERSION_ID,
    artifact_digest: ARTIFACT_DIGEST,
    address_id: ADDRESS_ID,
    intent_hostname:
      "cedar-workshop.sitesourcery.me",
    configured_look: "clear",
    stored_artifact_digest: ARTIFACT_DIGEST,
    version_state: "accepted_release",
    address_kind: "licensed",
    address_ownership: "licensed",
    address_label: "cedar-workshop",
    serving_hostname:
      "cedar-workshop.sitesourcery.me",
    address_state: "configured",
    current_address_id: ADDRESS_ID,
    ...overrides
  };
}

function setup(overrides = {}) {
  return {
    version_id: VERSION_ID,
    artifact_digest: ARTIFACT_DIGEST,
    configured_look: "clear",
    address_id: ADDRESS_ID,
    address_label: "cedar-workshop",
    serving_hostname:
      "cedar-workshop.sitesourcery.me",
    updated_at: SITE_UPDATED_AT,
    ...overrides
  };
}

function harness({
  projectAvailable = true,
  billingOwnerAvailable = true,
  downloadCreditAvailable = false,
  selectedSubscription = subscription(),
  selectedFulfillment = undefined,
  selectedSetup = setup(),
  openChanges = [
    {
      change_kind: "downgrade",
      target_tier_id: "alakazam_25",
      effective_at: PERIOD_END,
      state: "scheduled"
    }
  ],
  receipts = [
    {
      id: RECEIPT_ID,
      receipt_kind: "upgrade_difference",
      stripe_invoice_id: "in_alakazam_account_1",
      list_subtotal_minor: "1000",
      provider_discount_minor: "0",
      tax_minor: "0",
      total_minor: "1000",
      settled_at: "2026-08-02T12:03:00.000Z"
    }
  ]
} = {}) {
  const fulfillmentRow =
    selectedFulfillment === undefined
      ? selectedSubscription
        ? fulfillment({
            effective_tier_id:
              selectedSubscription.tier_id,
            subscription_revision:
              selectedSubscription.revision
          })
        : null
      : selectedFulfillment;
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
        normalized.includes(
          "as download_credit_available"
        )
      ) {
        assert.deepEqual(values, [
          TENANT_ID,
          PROJECT_ID,
          CUSTOMER_ID,
          ["owner", "admin", "editor"]
        ]);
        return projectAvailable
          ? result([
              {
                id: PROJECT_ID,
                download_credit_available:
                  downloadCreditAvailable,
                billing_owner_available:
                  billingOwnerAvailable
              }
            ])
          : result();
      }
      if (
        normalized.includes(
          "from ss.alakazam_subscriptions subscription"
        )
      ) {
        return selectedSubscription
          ? result([selectedSubscription])
          : result();
      }
      if (
        normalized.includes(
          "from ss.alakazam_change_quotes quote"
        ) && normalized.includes("coalesce")
      ) {
        return result(openChanges);
      }
      if (
        normalized.includes(
          "from ss.alakazam_payment_receipts receipt"
        )
      ) {
        return result(receipts);
      }
      if (
        normalized.includes(
          "from ss.alakazam_fulfillment_projection projection"
        )
      ) {
        return fulfillmentRow
          ? result([fulfillmentRow])
          : result();
      }
      if (normalized.includes("left join lateral")) {
        return result([selectedSetup]);
      }
      assert.fail(`Unexpected SQL: ${normalized}`);
    }
  };
  return {
    calls,
    serviceCalls,
    repository: createPostgresAlakazamRepository({
      authority: {
        async service(context, work) {
          serviceCalls.push(structuredClone(context));
          return work(client);
        }
      }
    })
  };
}

test("PostgreSQL account read projects one customer subscription, pending change, and bounded receipts", async () => {
  const context = harness();
  assert.deepEqual(
    await context.repository.readCustomerAccount(input()),
    {
      projectId: PROJECT_ID,
      downloadCreditAvailable: false,
      invoiceFinalization: null,
      subscription: {
        tierId: "alakazam_35",
        status: "active",
        amountMinor: 3500,
        currency: "USD",
        currentPeriodStartsAt: PERIOD_START,
        currentPeriodEndsAt: PERIOD_END,
        cancelAtPeriodEnd: false,
        firstFailedAt: null,
        graceEndsAt: null,
        revision: 3
      },
      pendingChange: {
        changeKind: "downgrade",
        targetTierId: "alakazam_25",
        effectiveAt: PERIOD_END,
        state: "scheduled"
      },
      site: {
        acceptedVersionId: VERSION_ID,
        artifactDigest: ARTIFACT_DIGEST,
        configuredLook: "clear",
        addressId: ADDRESS_ID,
        addressLabel: "cedar-workshop",
        hostname: "cedar-workshop.sitesourcery.me",
        fulfillmentState: "live",
        fulfillmentTierId: "alakazam_35",
        fulfillmentSubscriptionRevision: 3,
        updatedAt: SITE_UPDATED_AT
      },
      receipts: [
        {
          receiptId: RECEIPT_ID,
          kind: "upgrade_difference",
          subtotalMinor: 1000,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: 1000,
          settledAt: "2026-08-02T12:03:00.000Z",
          invoiceAvailable: true
        }
      ]
    }
  );
  assert.deepEqual(context.serviceCalls, [
    {
      userId: CUSTOMER_ID,
      organizationId: TENANT_ID,
      readOnly: true
    }
  ]);
  assert.equal(
    context.calls.some((call) =>
      call.text.includes("limit 50")
    ),
    true
  );
});

test("PostgreSQL account read exposes an unused Download credit without inventing a subscription", async () => {
  const context = harness({
    selectedSubscription: null,
    downloadCreditAvailable: true,
    openChanges: [],
    receipts: []
  });
  assert.deepEqual(
    await context.repository.readCustomerAccount(input()),
    {
      projectId: PROJECT_ID,
      downloadCreditAvailable: true,
      invoiceFinalization: null,
      subscription: null,
      pendingChange: null,
      site: {
        acceptedVersionId: VERSION_ID,
        artifactDigest: ARTIFACT_DIGEST,
        configuredLook: "clear",
        addressId: ADDRESS_ID,
        addressLabel: "cedar-workshop",
        hostname: "cedar-workshop.sitesourcery.me",
        fulfillmentState: null,
        fulfillmentTierId: null,
        fulfillmentSubscriptionRevision: null,
        updatedAt: SITE_UPDATED_AT
      },
      receipts: []
    }
  );
  assert.equal(
    context.calls.some((call) =>
      call.text.includes(
        "from ss.alakazam_change_quotes quote"
      )
    ),
    false
  );
});

test("PostgreSQL account read preserves partial setup and prepared fulfillment without inventing live authority", async () => {
  const partial = harness({
    selectedSubscription: null,
    selectedSetup: setup({
      address_id: null,
      address_label: null,
      serving_hostname: null
    }),
    openChanges: [],
    receipts: []
  });
  const partialAccount =
    await partial.repository.readCustomerAccount(input());
  assert.deepEqual(partialAccount.site, {
    acceptedVersionId: VERSION_ID,
    artifactDigest: ARTIFACT_DIGEST,
    configuredLook: "clear",
    addressId: null,
    addressLabel: null,
    hostname: null,
    fulfillmentState: null,
    fulfillmentTierId: null,
    fulfillmentSubscriptionRevision: null,
    updatedAt: SITE_UPDATED_AT
  });

  const prepared = harness({
    selectedSubscription: null,
    selectedFulfillment: fulfillment({
      fulfillment_state: "prepared",
      effective_tier_id: null,
      subscription_revision: null
    }),
    openChanges: [],
    receipts: []
  });
  const preparedAccount =
    await prepared.repository.readCustomerAccount(input());
  assert.equal(preparedAccount.site.fulfillmentState, "prepared");
  assert.equal(preparedAccount.site.fulfillmentTierId, null);
  assert.equal(
    preparedAccount.site.fulfillmentSubscriptionRevision,
    null
  );
  assert.equal(
    prepared.calls.some((call) =>
      call.text.includes("left join lateral")
    ),
    false
  );
});

test("PostgreSQL account read fails closed when frozen fulfillment evidence drifts", async () => {
  for (const selectedFulfillment of [
    fulfillment({ stored_artifact_digest: "b".repeat(64) }),
    fulfillment({
      customer_user_id:
        "20000000-0000-4000-8000-000000000002"
    }),
    fulfillment({
      projection_hostname: "other.sitesourcery.me"
    }),
    fulfillment({
      current_address_id:
        "70000000-0000-4000-8000-000000000002"
    }),
    fulfillment({ address_state: "released" })
  ]) {
    const context = harness({ selectedFulfillment });
    await assert.rejects(
      context.repository.readCustomerAccount(input()),
      (error) => error.code === "repository_conflict"
    );
  }
});

test("PostgreSQL account read turns a paid subscription with no fulfillment projection into attention state", async () => {
  const context = harness({
    selectedFulfillment: null,
    openChanges: [],
    receipts: []
  });
  const account =
    await context.repository.readCustomerAccount(input());
  assert.equal(account.site.fulfillmentState, "failed");
  assert.equal(
    account.site.fulfillmentTierId,
    "alakazam_35"
  );
  assert.equal(
    account.site.fulfillmentSubscriptionRevision,
    3
  );
  assert.equal(account.site.updatedAt, SITE_UPDATED_AT);
});

test("PostgreSQL account read exposes attention when activation outruns tier fulfillment enqueue", async () => {
  const context = harness({
    selectedFulfillment: fulfillment({
      effective_tier_id: "alakazam_25",
      subscription_revision: "2"
    }),
    openChanges: [],
    receipts: []
  });
  const account =
    await context.repository.readCustomerAccount(input());
  assert.equal(account.subscription.tierId, "alakazam_35");
  assert.equal(account.subscription.revision, 3);
  assert.equal(account.site.fulfillmentState, "failed");
  assert.equal(account.site.fulfillmentTierId, "alakazam_25");
  assert.equal(
    account.site.fulfillmentSubscriptionRevision,
    2
  );
});

test("PostgreSQL account read hides unavailable projects and rejects conflicting changes", async () => {
  const missing = harness({ projectAvailable: false });
  await assert.rejects(
    missing.repository.readCustomerAccount(input()),
    (error) =>
      error.code === "project_unavailable" &&
      error.status === 404
  );
  assert.equal(missing.calls.length, 1);

  const foreignBillingOwner = harness({
    billingOwnerAvailable: false
  });
  await assert.rejects(
    foreignBillingOwner.repository.readCustomerAccount(
      input()
    ),
    (error) =>
      error.code === "project_unavailable" &&
      error.status === 404
  );
  assert.equal(foreignBillingOwner.calls.length, 1);

  const conflicting = harness({
    openChanges: [
      {
        change_kind: "upgrade",
        target_tier_id: "alakazam_50",
        effective_at: null,
        state: "provider_change_pending"
      },
      {
        change_kind: "downgrade",
        target_tier_id: "alakazam_25",
        effective_at: PERIOD_END,
        state: "scheduled"
      }
    ]
  });
  await assert.rejects(
    conflicting.repository.readCustomerAccount(input()),
    (error) => error.code === "repository_conflict"
  );
});
