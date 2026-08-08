import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA
} from "../../commerce-v2/alakazam.mjs";
import {
  ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
  projectAlakazamNextRenewal
} from "../../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  createAlakazamLifecyclePolicy
} from "../../commerce-v2/alakazam-lifecycle-policy.mjs";
import {
  ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
  decideAlakazamLifecycleTransition
} from "../../commerce-v2/alakazam-lifecycle-state.mjs";
import {
  ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
  previewAlakazamCancellation,
  projectAlakazamExportGrant
} from "../../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  ALAKAZAM_REVERSAL_FACTS_SCHEMA,
  decideAlakazamReversalConsequence
} from "../../commerce-v2/alakazam-lifecycle-reversal.mjs";
import {
  digest as canonicalDigest
} from "../../commerce-v2/canonical.mjs";
import {
  createPostgresAlakazamLifecycleRepository
} from "../../hosted/alakazam-lifecycle-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_LIFECYCLE_TEST_URL ?? null;
const CATALOG_VERSION = "alakazam.2026-08-02.v1";
const TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";

const START_PERIOD_START = "2026-07-02T12:00:00.000Z";
const START_PERIOD_END = "2026-08-02T12:00:00.000Z";
const RENEWED_PERIOD_END = "2026-09-02T12:00:00.000Z";
const RENEWAL_PAID_AT = "2026-08-02T12:00:04.000Z";
const RENEWAL_VERIFIED_AT = "2026-08-02T12:00:09.000Z";
const RENEWAL_OBSERVED_AT = "2026-08-02T12:00:11.000Z";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertRow(client, table, row) {
  assert.match(table, /^[a-z0-9_]+$/u);
  const entries = Object.entries(row);
  for (const [column] of entries) {
    assert.match(column, /^[a-z_]+$/u);
  }
  const columns = entries.map(([column]) => column).join(", ");
  const parameters = entries
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  await client.query(
    `insert into ss.${table} (${columns}) values (${parameters})`,
    entries.map(([, value]) => value)
  );
}

async function flushConstraints(client) {
  await client.query("set constraints all immediate");
  await client.query("set constraints all deferred");
}

async function expectRejected(client, action, pattern) {
  await client.query("savepoint expected_rejection");
  await assert.rejects(async () => {
    await action();
    await client.query("set constraints all immediate");
  }, pattern);
  await client.query("rollback to savepoint expected_rejection");
  await client.query("set constraints all deferred");
}

async function seedAuthority(client) {
  const authority = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID(),
    stripeCustomerRowId: randomUUID(),
    stripeCustomerId: "cus_alakazam_lifecycle"
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [
      authority.userId,
      `lifecycle-${authority.userId}@example.test`
    ]
  );
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `lifecycle-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-01-01T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: "Alakazam Lifecycle Test"
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: "2026-07-01T11:55:00.000Z"
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: "Alakazam Lifecycle Project"
  });
  await insertRow(client, "project_safety_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    state: "clear",
    updated_at: "2026-07-01T11:55:00.000Z"
  });
  await insertRow(client, "project_address_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    current_address_id: null,
    updated_at: "2026-07-01T11:55:00.000Z"
  });
  await insertRow(client, "project_serving_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    state: "unpublished",
    resume_state: "unpublished",
    updated_at: "2026-07-01T11:55:00.000Z"
  });
  await insertRow(client, "stripe_customers", {
    id: authority.stripeCustomerRowId,
    organization_id: authority.organizationId,
    stripe_customer_id: authority.stripeCustomerId
  });
  return authority;
}

/**
 * Bring one project to the exact state the lifecycle inherits: an
 * active $25 subscription with a paid start period, built only from
 * evidence the migration triggers already accept.
 */
async function seedActiveSubscription(client, authority) {
  const quoteId = randomUUID();
  const subscriptionId = randomUUID();
  const dispatchId = randomUUID();
  const receiptId = randomUUID();

  await insertRow(client, "alakazam_change_quotes", {
    id: quoteId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    catalog_version: CATALOG_VERSION,
    terms_version: TERMS_VERSION,
    change_kind: "start",
    target_tier_id: "alakazam_25",
    target_amount_minor: 2500,
    applied_value_kind: "none",
    applied_value_minor: 0,
    due_now_subtotal_minor: 2500,
    next_renewal_amount_minor: 2500,
    currency: "USD",
    effective_rule: "after_payment_and_provider_confirmation",
    no_mid_period_refund: false,
    provider_proration_enabled: false,
    premium_configuration_policy: "preserved_when_inactive",
    tax_state: "disabled_by_owner",
    disclosure: { test: true, changeKind: "start" },
    disclosure_digest: digest(`disclosure:${quoteId}`),
    quote_digest: digest(`quote:${quoteId}`),
    state: "quoted",
    provider_effects_authorized: true,
    issued_at: "2026-07-02T11:40:00.000Z",
    expires_at: "2026-07-02T12:00:00.000Z",
    created_by_user_id: authority.userId
  });
  // The start quote must be validated before a subscription exists,
  // exactly as the released start path does.
  await flushConstraints(client);

  await insertRow(client, "alakazam_subscriptions", {
    id: subscriptionId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    stripe_customer_row_id: authority.stripeCustomerRowId,
    stripe_subscription_id: "sub_alakazam_lifecycle",
    stripe_subscription_item_id: "si_alakazam_lifecycle",
    stripe_price_id: "price_alakazam_25",
    initial_quote_id: quoteId,
    tier_id: "alakazam_25",
    status: "pending",
    currency: "USD",
    amount_minor: 2500,
    provider_observed_at: "2026-07-02T11:50:00.000Z",
    provider_facts_digest: digest("pending facts")
  });

  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'checkout_dispatching' where id = $1`,
    [quoteId]
  );
  const dispatchCreatedAt = "2026-07-02T11:50:00.000Z";
  await insertRow(client, "alakazam_checkout_dispatches", {
    id: dispatchId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    quote_id: quoteId,
    mode: "subscription_start",
    provider: "stripe",
    stripe_customer_id: authority.stripeCustomerId,
    provider_idempotency_key:
      `alakazam:start:checkout:${dispatchId}`,
    purpose_digest: digest(`purpose:${dispatchId}`),
    purpose: {
      acceptedDisclosureDigest: digest(
        `disclosure:${quoteId}`
      ),
      catalogVersion: CATALOG_VERSION,
      changeKind: "start",
      currency: "USD",
      currentSubscription: null,
      customerId: authority.userId,
      downloadCredit: null,
      dueNowSubtotalMinor: 2500,
      nextRenewalAmountMinor: 2500,
      organizationId: authority.organizationId,
      projectId: authority.projectId,
      quoteDigest: digest(`quote:${quoteId}`),
      quoteId,
      schema: "sitesourcery.alakazam-stripe-purpose.v1",
      stripeCustomerId: authority.stripeCustomerId,
      taxMode: "disabled_by_owner",
      targetAmountMinor: 2500,
      targetTierId: "alakazam_25",
      termsVersion: TERMS_VERSION
    },
    expected_subtotal_minor: 2500,
    expected_credit_minor: 0,
    currency: "USD",
    state: "reserved",
    provider_effect_certainty: "not_submitted",
    created_at: dispatchCreatedAt,
    updated_at: dispatchCreatedAt,
    lease_expires_at: "2026-07-02T11:52:00.000Z"
  });
  await client.query(
    `update ss.alakazam_checkout_dispatches
        set state = 'ready',
            stripe_checkout_session_id = 'cs_alakazam_lifecycle',
            provider_checkout_url =
              'https://checkout.stripe.com/c/pay/alakazam_lifecycle',
            provider_expires_at = '2026-07-02T12:10:00.000Z',
            dispatched_at = '2026-07-02T11:52:00.000Z',
            provider_effect_certainty = 'confirmed'
      where id = $1`,
    [dispatchId]
  );
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'checkout_ready' where id = $1`,
    [quoteId]
  );
  await client.query(
    `update ss.alakazam_checkout_dispatches
        set state = 'settled', settled_at = $2 where id = $1`,
    [dispatchId, START_PERIOD_START]
  );
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'payment_settled' where id = $1`,
    [quoteId]
  );

  const paymentEventId = await insertProcessedEvent(
    client,
    authority,
    {
      subscriptionId,
      quoteId,
      suffix: "alakazam_lifecycle_payment",
      eventType: "checkout.session.completed",
      providerObjectId: "cs_alakazam_lifecycle",
      occurredAt: START_PERIOD_START
    }
  );
  await insertRow(client, "alakazam_payment_receipts", {
    id: receiptId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    subscription_id: subscriptionId,
    quote_id: quoteId,
    stripe_event_row_id: paymentEventId,
    receipt_kind: "start_payment",
    stripe_invoice_id: "in_alakazam_lifecycle_start",
    stripe_payment_intent_id: "pi_alakazam_lifecycle_start",
    list_subtotal_minor: 2500,
    provider_discount_minor: 0,
    net_subtotal_minor: 2500,
    tax_minor: 0,
    total_minor: 2500,
    tax_mode: "disabled_by_owner",
    currency: "USD",
    settled_at: START_PERIOD_START,
    provider_facts: { test: true, kind: "start_payment" },
    provider_facts_digest: digest("start payment facts")
  });

  const activationEventId = await insertProcessedEvent(
    client,
    authority,
    {
      subscriptionId,
      suffix: "alakazam_lifecycle_activation",
      eventType: "customer.subscription.created",
      providerObjectId: "sub_alakazam_lifecycle",
      occurredAt: START_PERIOD_START
    }
  );
  await insertRow(client, "alakazam_tier_change_events", {
    id: randomUUID(),
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    subscription_id: subscriptionId,
    quote_id: quoteId,
    stripe_event_row_id: activationEventId,
    payment_receipt_id: receiptId,
    result_subscription_revision: 2,
    event_kind: "start_applied",
    result_tier_id: "alakazam_25",
    occurred_at: START_PERIOD_START,
    facts: { test: true, eventKind: "start_applied" },
    facts_digest: digest("start applied facts")
  });
  await client.query(
    `update ss.alakazam_subscriptions
        set status = 'active',
            activation_receipt_id = $2,
            current_period_starts_at = $3,
            current_period_ends_at = $4,
            provider_observed_at = $5,
            provider_facts_digest = $6
      where id = $1`,
    [
      subscriptionId,
      receiptId,
      START_PERIOD_START,
      START_PERIOD_END,
      "2026-07-02T12:00:05.000Z",
      digest("active facts")
    ]
  );
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'applied' where id = $1`,
    [quoteId]
  );
  await flushConstraints(client);
  return { quoteId, subscriptionId, receiptId };
}

async function insertProcessedEvent(client, authority, input) {
  const id = randomUUID();
  await insertRow(client, "alakazam_stripe_events", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    quote_id: input.quoteId ?? null,
    subscription_id: input.subscriptionId,
    stripe_event_id: `evt_${input.suffix}`,
    event_type: input.eventType,
    livemode: false,
    api_version: "2026-07-30.basil",
    provider_object_id: input.providerObjectId,
    payload_digest: digest(`payload:${input.suffix}`),
    facts: { test: true, suffix: input.suffix },
    signature_verified_at: input.occurredAt,
    occurred_at: input.occurredAt
  });
  await client.query(
    `update ss.alakazam_stripe_events
        set state = 'processing', attempt_count = 1
      where id = $1`,
    [id]
  );
  await client.query(
    `update ss.alakazam_stripe_events
        set state = 'processed', processed_at = $2
      where id = $1`,
    [id, input.occurredAt]
  );
  return id;
}

function renewedSubscriptionFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    stripeSubscriptionItemId: "si_alakazam_lifecycle",
    stripeCustomerId: "cus_alakazam_lifecycle",
    stripePriceId: "price_alakazam_25",
    stripeScheduleId: null,
    tierId: "alakazam_25",
    amountMinor: 2500,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt: START_PERIOD_END,
    currentPeriodEndsAt: RENEWED_PERIOD_END,
    billingCycleAnchor: START_PERIOD_START,
    providerObservedAt: RENEWAL_OBSERVED_AT,
    metadata: {},
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function renewalInvoiceFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: "in_alakazam_lifecycle_renewal",
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    stripeSubscriptionItemId: "si_alakazam_lifecycle",
    stripeCustomerId: "cus_alakazam_lifecycle",
    stripePriceId: "price_alakazam_25",
    stripePaymentIntentId: "pi_alakazam_lifecycle_renewal",
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
    periodStartsAt: START_PERIOD_END,
    periodEndsAt: RENEWED_PERIOD_END,
    providerPaymentTime: RENEWAL_PAID_AT,
    providerObservedAt: RENEWAL_OBSERVED_AT,
    subscription: renewedSubscriptionFacts(),
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function renewalEvent(overrides = {}) {
  return {
    stripeEventId: "evt_alakazam_lifecycle_renewal",
    eventType: "invoice.paid",
    livemode: false,
    apiVersion: "2026-07-30.basil",
    stripeInvoiceId: "in_alakazam_lifecycle_renewal",
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    payloadDigest: digest("renewal payload"),
    signatureVerifiedAt: RENEWAL_VERIFIED_AT,
    occurredAt: RENEWAL_PAID_AT,
    ...overrides
  };
}

function lifecycleRepository(client) {
  return createPostgresAlakazamLifecycleRepository({
    authority: {
      async service(_context, work) {
        return work(client);
      }
    }
  });
}

async function countRows(client, table, subscriptionId) {
  const result = await client.query(
    `select count(*)::int as total from ss.${table}
      where subscription_id = $1`,
    [subscriptionId]
  );
  return result.rows[0].total;
}

test(
  "G-02: a paid Alakazam renewal advances one period, one receipt, and one projection",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);

      // Ownership is resolved from durable identifiers only.
      assert.deepEqual(
        await repository.findRenewalSubscriptionByInvoice({
          stripeInvoiceId: "in_someone_else",
          stripeSubscriptionId: "sub_not_alakazam"
        }),
        { status: "not_alakazam" }
      );

      const resolved =
        await repository.findRenewalSubscriptionByInvoice({
          stripeInvoiceId: "in_alakazam_lifecycle_renewal",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(resolved.status, "current");
      assert.equal(
        resolved.subscription.schema,
        ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA
      );
      assert.equal(
        resolved.subscription.localSubscriptionId,
        seeded.subscriptionId
      );
      assert.equal(resolved.subscription.revision, 2);
      assert.equal(
        resolved.subscription.currentPeriodEndsAt,
        START_PERIOD_END
      );
      assert.equal(resolved.pendingDowngrade, null);

      const invoice = renewalInvoiceFacts();
      const projection = projectAlakazamNextRenewal({
        tierId: "alakazam_25",
        confirmedPeriodEndsAt: RENEWED_PERIOD_END
      });
      const settled = await repository.settleRenewalPayment({
        subscription: resolved.subscription,
        pendingDowngrade: null,
        event: renewalEvent(),
        invoice,
        projection,
        eventRowId: randomUUID(),
        receiptId: randomUUID(),
        tierEventId: randomUUID(),
        settlementId: randomUUID()
      });
      await flushConstraints(client);

      assert.equal(settled.status, "renewal_settled");
      assert.equal(settled.revision, 3);
      assert.equal(settled.periodStartsAt, START_PERIOD_END);
      assert.equal(settled.periodEndsAt, RENEWED_PERIOD_END);
      assert.equal(settled.paidAmountMinor, 2500);
      assert.equal(
        settled.projection.nextRenewalAt,
        RENEWED_PERIOD_END
      );
      assert.equal(settled.projection.tierId, "alakazam_25");
      assert.equal(
        settled.projection.basis,
        "provider_confirmed_period"
      );
      assert.equal(
        settled.projection.certainty,
        "provider_confirmed_boundary"
      );

      const subscription = await client.query(
        `select revision, status, current_period_starts_at,
                current_period_ends_at, cancel_at_period_end
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(subscription.rows[0].revision, "3");
      assert.equal(subscription.rows[0].status, "active");
      assert.equal(
        subscription.rows[0].current_period_starts_at.toISOString(),
        START_PERIOD_END
      );
      assert.equal(
        subscription.rows[0].current_period_ends_at.toISOString(),
        RENEWED_PERIOD_END
      );
      assert.equal(
        subscription.rows[0].cancel_at_period_end,
        false
      );

      const receipts = await client.query(
        `select receipt_kind, net_subtotal_minor,
                stripe_invoice_id, quote_id
           from ss.alakazam_payment_receipts
          where subscription_id = $1
            and receipt_kind = 'renewal_payment'`,
        [seeded.subscriptionId]
      );
      assert.equal(receipts.rowCount, 1);
      assert.equal(receipts.rows[0].quote_id, null);
      assert.equal(
        receipts.rows[0].net_subtotal_minor,
        "2500"
      );
      assert.equal(
        await countRows(
          client,
          "alakazam_renewal_settlements",
          seeded.subscriptionId
        ),
        1
      );

      const tierEvents = await client.query(
        `select event_kind, result_subscription_revision
           from ss.alakazam_tier_change_events
          where subscription_id = $1
            and event_kind = 'renewal_paid'`,
        [seeded.subscriptionId]
      );
      assert.equal(tierEvents.rowCount, 1);
      assert.equal(
        tierEvents.rows[0].result_subscription_revision,
        "3"
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-02: the paid-invoice alias and a duplicate invoice cannot create a second renewal",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);
      const resolved =
        await repository.findRenewalSubscriptionByInvoice({
          stripeInvoiceId: "in_alakazam_lifecycle_renewal",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      const invoice = renewalInvoiceFacts();
      const projection = projectAlakazamNextRenewal({
        tierId: "alakazam_25",
        confirmedPeriodEndsAt: RENEWED_PERIOD_END
      });
      const first = await repository.settleRenewalPayment({
        subscription: resolved.subscription,
        pendingDowngrade: null,
        event: renewalEvent(),
        invoice,
        projection,
        eventRowId: randomUUID(),
        receiptId: randomUUID(),
        tierEventId: randomUUID(),
        settlementId: randomUUID()
      });
      await flushConstraints(client);

      // The invoice.payment_succeeded alias arrives with a different
      // event id and must converge on the same committed settlement.
      const alias = await repository.settleRenewalPayment({
        subscription: resolved.subscription,
        pendingDowngrade: null,
        event: renewalEvent({
          stripeEventId: "evt_alakazam_lifecycle_alias",
          eventType: "invoice.payment_succeeded"
        }),
        invoice,
        projection,
        eventRowId: randomUUID(),
        receiptId: randomUUID(),
        tierEventId: randomUUID(),
        settlementId: randomUUID()
      });
      await flushConstraints(client);
      assert.deepEqual(alias, first);

      const lookup =
        await repository.findRenewalSubscriptionByInvoice({
          stripeInvoiceId: "in_alakazam_lifecycle_renewal",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(lookup.status, "settled");
      assert.equal(
        lookup.settlement.settlementId,
        first.settlementId
      );

      assert.equal(
        await countRows(
          client,
          "alakazam_renewal_settlements",
          seeded.subscriptionId
        ),
        1
      );
      const receipts = await client.query(
        `select count(*)::int as total
           from ss.alakazam_payment_receipts
          where subscription_id = $1
            and receipt_kind = 'renewal_payment'`,
        [seeded.subscriptionId]
      );
      assert.equal(receipts.rows[0].total, 1);

      // The schema itself refuses a second receipt for one invoice,
      // even if a future caller bypasses the service.
      await expectRejected(
        client,
        () =>
          insertRow(client, "alakazam_payment_receipts", {
            id: randomUUID(),
            organization_id: authority.organizationId,
            project_id: authority.projectId,
            customer_user_id: authority.userId,
            subscription_id: seeded.subscriptionId,
            quote_id: null,
            stripe_event_row_id: randomUUID(),
            receipt_kind: "renewal_payment",
            stripe_invoice_id:
              "in_alakazam_lifecycle_renewal",
            stripe_payment_intent_id:
              "pi_alakazam_lifecycle_second",
            list_subtotal_minor: 2500,
            provider_discount_minor: 0,
            net_subtotal_minor: 2500,
            tax_minor: 0,
            total_minor: 2500,
            tax_mode: "disabled_by_owner",
            currency: "USD",
            settled_at: RENEWAL_PAID_AT,
            provider_facts: { duplicate: true },
            provider_facts_digest: digest("duplicate")
          }),
        /alakazam_one_receipt_per_invoice/u
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-02: a renewal projection that outruns its committed facts is refused",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      await seedActiveSubscription(client, authority);
      const repository = lifecycleRepository(client);
      const resolved =
        await repository.findRenewalSubscriptionByInvoice({
          stripeInvoiceId: "in_alakazam_lifecycle_renewal",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });

      await assert.rejects(
        () =>
          repository.settleRenewalPayment({
            subscription: resolved.subscription,
            pendingDowngrade: null,
            event: renewalEvent(),
            invoice: renewalInvoiceFacts(),
            projection: projectAlakazamNextRenewal({
              // A cheaper tier nobody accepted.
              tierId: "alakazam_50",
              confirmedPeriodEndsAt: RENEWED_PERIOD_END
            }),
            eventRowId: randomUUID(),
            receiptId: randomUUID(),
            tierEventId: randomUUID(),
            settlementId: randomUUID()
          }),
        { code: "repository_conflict" }
      );

      const settlements = await client.query(
        "select count(*)::int as total from ss.alakazam_renewal_settlements"
      );
      assert.equal(settlements.rows[0].total, 0);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

// ---------------------------------------------------------------
// G-03 — payment failure, past-due, grace, suspension, restoration
// ---------------------------------------------------------------

const INCIDENT_INVOICE_ID = "in_alakazam_lifecycle_renewal";
const FAILED_AT = "2026-08-02T12:00:20.000Z";
const FAILED_VERIFIED_AT = "2026-08-02T12:00:25.000Z";
const FAILED_OBSERVED_AT = "2026-08-02T12:00:30.000Z";

// A hypothetical ruling used only to exercise the machinery. The owner
// has not made this ruling; nothing ships it.
const EXAMPLE_POLICY = createAlakazamLifecyclePolicy({
  approved: true,
  policyVersion: "alakazam-lifecycle.2026-08-08.v1",
  graceHours: 72,
  suspendAfterGraceHours: 0,
  retentionHours: 720,
  exportWindowHours: 336,
  graceConsequence: "restrict_publication",
  suspensionConsequence: "suspend_service",
  refundConsequence: "owner_review",
  disputeConsequence: "suspend_service"
});

function incidentInvoiceFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: INCIDENT_INVOICE_ID,
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    stripeCustomerId: "cus_alakazam_lifecycle",
    stripePaymentIntentId: "pi_alakazam_lifecycle_renewal",
    tierId: "alakazam_25",
    status: "open",
    subscriptionStatus: "past_due",
    paymentIntentStatus: "requires_payment_method",
    attemptCount: 1,
    amountDueMinor: 2500,
    amountPaidMinor: 0,
    currency: "USD",
    nextPaymentAttemptAt: "2026-08-05T12:00:00.000Z",
    providerObservedAt: FAILED_OBSERVED_AT,
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function incidentEvent(overrides = {}) {
  return {
    stripeEventId: "evt_alakazam_lifecycle_failed",
    eventType: "invoice.payment_failed",
    livemode: false,
    apiVersion: "2026-07-30.basil",
    stripeInvoiceId: INCIDENT_INVOICE_ID,
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    payloadDigest: digest("failed payload"),
    signatureVerifiedAt: FAILED_VERIFIED_AT,
    occurredAt: FAILED_AT,
    ...overrides
  };
}

test(
  "G-03: an unruled policy records the failure and changes nothing",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);
      const resolved =
        await repository.findIncidentSubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_failed",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(resolved.status, "current");
      assert.equal(resolved.subscription.status, "active");
      assert.equal(resolved.subscription.firstFailedAt, null);

      const decision = decideAlakazamLifecycleTransition({
        policy: createAlakazamLifecyclePolicy(),
        from: "active",
        signal: "payment_failed",
        observedAt: FAILED_AT
      });
      const recorded = await repository.recordPaymentIncident({
        subscription: resolved.subscription,
        event: incidentEvent(),
        invoice: incidentInvoiceFacts(),
        decision,
        eventRowId: randomUUID(),
        incidentId: randomUUID(),
        tierEventId: null
      });
      await flushConstraints(client);

      assert.equal(recorded.status, "incident_recorded");
      assert.equal(recorded.consequenceApplied, false);
      assert.equal(recorded.subscriptionStatus, "active");

      const subscription = await client.query(
        `select revision, status, first_failed_at,
                grace_ends_at, suspended_at
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      // Nothing moved: same revision, still active, no deadline.
      assert.equal(subscription.rows[0].revision, "2");
      assert.equal(subscription.rows[0].status, "active");
      assert.equal(subscription.rows[0].first_failed_at, null);
      assert.equal(subscription.rows[0].grace_ends_at, null);
      assert.equal(subscription.rows[0].suspended_at, null);

      const incident = await client.query(
        `select policy_version, decided_consequence,
                service_state, consequence_applied,
                tier_change_event_id, customer_message_code
           from ss.alakazam_payment_incidents
          where subscription_id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(incident.rowCount, 1);
      assert.equal(incident.rows[0].policy_version, null);
      assert.equal(
        incident.rows[0].decided_consequence,
        "record_only"
      );
      assert.equal(incident.rows[0].service_state, "unchanged");
      assert.equal(incident.rows[0].consequence_applied, false);
      assert.equal(incident.rows[0].tier_change_event_id, null);
      assert.equal(
        incident.rows[0].customer_message_code,
        "alakazam_billing_attention"
      );

      // Replay of the same provider event adds nothing.
      const replay =
        await repository.findIncidentSubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_failed",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(replay.status, "recorded");
      assert.equal(
        replay.incident.incidentId,
        recorded.incidentId
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-03: the schema itself refuses a consequence without an owner ruling",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const eventRowId = await insertProcessedEvent(
        client,
        authority,
        {
          subscriptionId: seeded.subscriptionId,
          suffix: "alakazam_lifecycle_unruled",
          eventType: "invoice.payment_failed",
          providerObjectId: INCIDENT_INVOICE_ID,
          occurredAt: FAILED_AT
        }
      );
      await expectRejected(
        client,
        () =>
          insertRow(client, "alakazam_payment_incidents", {
            id: randomUUID(),
            organization_id: authority.organizationId,
            project_id: authority.projectId,
            subscription_id: seeded.subscriptionId,
            stripe_event_row_id: eventRowId,
            tier_change_event_id: null,
            incident_kind: "payment_failed",
            stripe_invoice_id: INCIDENT_INVOICE_ID,
            stripe_payment_intent_id:
              "pi_alakazam_lifecycle_renewal",
            provider_invoice_status: "open",
            provider_attempt_count: 1,
            amount_due_minor: 2500,
            currency: "USD",
            observed_status: "active",
            // An invented consequence with no dated ruling.
            resulting_status: "suspended",
            policy_version: null,
            decided_consequence: "suspend_service",
            service_state: "suspended",
            customer_message_code: "alakazam_service_paused",
            consequence_applied: true,
            grace_ends_at: null,
            decision: { invented: true },
            decision_digest: digest("invented"),
            provider_facts: { invented: true },
            provider_facts_digest: digest("invented facts"),
            provider_observed_at: FAILED_OBSERVED_AT,
            occurred_at: FAILED_AT
          }),
        /alakazam_payment_incidents_check/u
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-03: a ruled policy drives grace, suspension, and restoration",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);

      // 1. Failure moves the subscription into the ruled grace window.
      const active =
        await repository.findIncidentSubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_failed",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      const graceDecision =
        decideAlakazamLifecycleTransition({
          policy: EXAMPLE_POLICY,
          from: "active",
          signal: "payment_failed",
          observedAt: FAILED_AT
        });
      assert.equal(graceDecision.to, "grace");
      const graced = await repository.recordPaymentIncident({
        subscription: active.subscription,
        event: incidentEvent(),
        invoice: incidentInvoiceFacts(),
        decision: graceDecision,
        eventRowId: randomUUID(),
        incidentId: randomUUID(),
        tierEventId: randomUUID()
      });
      await flushConstraints(client);
      assert.equal(graced.consequenceApplied, true);
      assert.equal(graced.subscriptionStatus, "grace");

      let subscription = await client.query(
        `select revision, status, first_failed_at,
                grace_ends_at
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(subscription.rows[0].status, "grace");
      assert.equal(subscription.rows[0].revision, "3");
      assert.equal(
        subscription.rows[0].grace_ends_at.toISOString(),
        "2026-08-05T12:00:20.000Z"
      );

      // 2. The ruled boundary passes and the subscription suspends.
      const inGrace =
        await repository.findIncidentSubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_failed_2",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(inGrace.subscription.status, "grace");
      const suspendDecision =
        decideAlakazamLifecycleTransition({
          policy: EXAMPLE_POLICY,
          from: "grace",
          signal: "grace_expired",
          observedAt: "2026-08-05T12:00:21.000Z",
          firstFailedAt: inGrace.subscription.firstFailedAt,
          graceEndsAt: inGrace.subscription.graceEndsAt
        });
      assert.equal(suspendDecision.to, "suspended");
      const suspended = await repository.recordPaymentIncident({
        subscription: inGrace.subscription,
        event: incidentEvent({
          stripeEventId: "evt_alakazam_lifecycle_failed_2",
          occurredAt: "2026-08-05T12:00:21.000Z",
          signatureVerifiedAt: "2026-08-05T12:00:26.000Z"
        }),
        invoice: incidentInvoiceFacts({
          attemptCount: 2,
          nextPaymentAttemptAt: null,
          providerObservedAt: "2026-08-05T12:00:31.000Z"
        }),
        decision: suspendDecision,
        eventRowId: randomUUID(),
        incidentId: randomUUID(),
        tierEventId: randomUUID()
      });
      await flushConstraints(client);
      assert.equal(suspended.subscriptionStatus, "suspended");

      subscription = await client.query(
        `select revision, status, suspended_at
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(subscription.rows[0].status, "suspended");
      assert.equal(subscription.rows[0].revision, "4");
      assert.ok(subscription.rows[0].suspended_at !== null);

      // 3. The customer pays. Service is restored from provider proof.
      const beforeRecovery =
        await repository.findRecoverySubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_recovered",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(beforeRecovery.status, "current");
      assert.equal(
        beforeRecovery.subscription.status,
        "suspended"
      );
      const recoveryDecision =
        decideAlakazamLifecycleTransition({
          policy: EXAMPLE_POLICY,
          from: "suspended",
          signal: "payment_recovered",
          observedAt: "2026-08-06T09:00:00.000Z",
          firstFailedAt:
            beforeRecovery.subscription.firstFailedAt,
          graceEndsAt:
            beforeRecovery.subscription.graceEndsAt
        });
      const restored = await repository.recordPaymentRecovery({
        subscription: beforeRecovery.subscription,
        event: {
          stripeEventId: "evt_alakazam_lifecycle_recovered",
          eventType: "invoice.paid",
          livemode: false,
          apiVersion: "2026-07-30.basil",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle",
          payloadDigest: digest("recovered payload"),
          signatureVerifiedAt: "2026-08-06T09:00:05.000Z",
          occurredAt: "2026-08-06T09:00:00.000Z"
        },
        invoice: renewalInvoiceFacts({
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          providerPaymentTime: "2026-08-06T09:00:00.000Z",
          providerObservedAt: "2026-08-06T09:00:09.000Z",
          subscription: renewedSubscriptionFacts({
            providerObservedAt: "2026-08-06T09:00:09.000Z"
          })
        }),
        decision: recoveryDecision,
        eventRowId: randomUUID(),
        receiptId: randomUUID(),
        tierEventId: randomUUID()
      });
      await flushConstraints(client);

      assert.equal(restored.status, "recovery_recorded");
      assert.equal(restored.subscriptionStatus, "active");
      assert.equal(restored.revision, 5);
      assert.equal(restored.periodEndsAt, RENEWED_PERIOD_END);

      subscription = await client.query(
        `select revision, status, grace_ends_at,
                current_period_ends_at
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(subscription.rows[0].status, "active");
      assert.equal(subscription.rows[0].revision, "5");
      assert.equal(subscription.rows[0].grace_ends_at, null);
      assert.equal(
        subscription.rows[0].current_period_ends_at.toISOString(),
        RENEWED_PERIOD_END
      );

      const receipts = await client.query(
        `select count(*)::int as total
           from ss.alakazam_payment_receipts
          where subscription_id = $1
            and receipt_kind = 'renewal_payment'`,
        [seeded.subscriptionId]
      );
      assert.equal(receipts.rows[0].total, 1);

      const replayed =
        await repository.findRecoverySubscriptionByInvoice({
          stripeEventId: "evt_alakazam_lifecycle_recovered",
          stripeInvoiceId: INCIDENT_INVOICE_ID,
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(replayed.status, "recorded");
      assert.equal(replayed.recovery.revision, 5);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

// ---------------------------------------------------------------
// G-04 — period-end cancellation with retained export
// ---------------------------------------------------------------

const CANCEL_REQUESTED_AT = "2026-07-20T09:00:00.000Z";
const CANCEL_CONFIRMED_AT = "2026-07-20T09:00:10.000Z";
const CANCEL_OBSERVED_AT = "2026-07-20T09:00:18.000Z";

function cancellationProviderFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
    provider: "stripe",
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    stripeCustomerId: "cus_alakazam_lifecycle",
    tierId: "alakazam_25",
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: true,
    cancelAt: START_PERIOD_END,
    currentPeriodStartsAt: START_PERIOD_START,
    currentPeriodEndsAt: START_PERIOD_END,
    providerObservedAt: CANCEL_OBSERVED_AT,
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function cancellationEvent(overrides = {}) {
  return {
    stripeEventId: "evt_alakazam_lifecycle_cancel",
    eventType: "customer.subscription.updated",
    livemode: false,
    apiVersion: "2026-07-30.basil",
    stripeSubscriptionId: "sub_alakazam_lifecycle",
    payloadDigest: digest("cancel payload"),
    signatureVerifiedAt: CANCEL_CONFIRMED_AT,
    occurredAt: CANCEL_CONFIRMED_AT,
    ...overrides
  };
}

test(
  "G-04: a cancelling customer keeps service and export through the paid period",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);

      const subscription =
        await repository.readCancellationSubscription({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId
        });
      assert.equal(
        subscription.localSubscriptionId,
        seeded.subscriptionId
      );
      assert.equal(subscription.cancelAtPeriodEnd, false);
      assert.equal(subscription.hasOpenDowngrade, false);

      const preview = previewAlakazamCancellation({
        policy: createAlakazamLifecyclePolicy(),
        subscription,
        now: CANCEL_REQUESTED_AT
      });
      assert.equal(preview.eligible, true);
      assert.equal(preview.effectiveAt, START_PERIOD_END);
      assert.equal(
        preview.refundTreatment,
        "policy_decision_required"
      );

      const cancellationId = randomUUID();
      const claimed =
        await repository.claimCancellationRequest({
          cancellationId,
          subscription,
          acceptedDisclosureDigest: digest(
            "accepted cancellation disclosure"
          ),
          requestedAt: CANCEL_REQUESTED_AT
        });
      await flushConstraints(client);
      assert.equal(claimed.status, "reserved");
      assert.equal(claimed.state, "dispatching");

      // A second request reuses the open one; it never opens a second.
      const again =
        await repository.claimCancellationRequest({
          cancellationId: randomUUID(),
          subscription,
          acceptedDisclosureDigest: digest(
            "accepted cancellation disclosure"
          ),
          requestedAt: CANCEL_REQUESTED_AT
        });
      assert.equal(again.status, "existing");
      assert.equal(again.cancellationId, cancellationId);

      const resolved =
        await repository.findCancellationBySubscription({
          stripeEventId: "evt_alakazam_lifecycle_cancel",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(resolved.status, "requested");
      assert.equal(
        resolved.cancellation.cancellationId,
        cancellationId
      );

      const grant = projectAlakazamExportGrant({
        policy: createAlakazamLifecyclePolicy(),
        availableFrom: CANCEL_CONFIRMED_AT,
        paidThroughAt: START_PERIOD_END
      });
      const scheduled =
        await repository.confirmCancellationSchedule({
          subscription,
          request: resolved.cancellation,
          event: cancellationEvent(),
          cancellation: cancellationProviderFacts(),
          grant,
          eventRowId: randomUUID(),
          tierEventId: randomUUID(),
          exportGrantId: randomUUID()
        });
      await flushConstraints(client);

      assert.equal(scheduled.status, "cancellation_scheduled");
      assert.equal(scheduled.state, "scheduled");
      assert.equal(scheduled.effectiveAt, START_PERIOD_END);
      assert.equal(scheduled.revision, 3);
      assert.equal(scheduled.export.state, "available");
      assert.equal(
        scheduled.export.paidThroughAt,
        START_PERIOD_END
      );
      assert.equal(
        scheduled.export.retentionState,
        "policy_decision_required"
      );
      assert.equal(scheduled.export.retentionEndsAt, null);

      const row = await client.query(
        `select revision, status, cancel_at_period_end
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(row.rows[0].cancel_at_period_end, true);
      assert.equal(row.rows[0].status, "active");
      assert.equal(row.rows[0].revision, "3");

      const events = await client.query(
        `select count(*)::int as total
           from ss.alakazam_tier_change_events
          where subscription_id = $1
            and event_kind = 'cancellation_scheduled'`,
        [seeded.subscriptionId]
      );
      assert.equal(events.rows[0].total, 1);

      // Replay converges on the same committed cancellation.
      const replay =
        await repository.findCancellationBySubscription({
          stripeEventId: "evt_alakazam_lifecycle_cancel",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      assert.equal(replay.status, "scheduled");
      assert.deepEqual(
        replay.cancellation,
        scheduled
      );
      const grants = await client.query(
        `select count(*)::int as total
           from ss.alakazam_export_grants
          where subscription_id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(grants.rows[0].total, 1);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-04: the schema refuses an export window nobody ruled and refuses shrinking one",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);
      const subscription =
        await repository.readCancellationSubscription({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId
        });
      const cancellationId = randomUUID();
      await repository.claimCancellationRequest({
        cancellationId,
        subscription,
        acceptedDisclosureDigest: digest("accepted"),
        requestedAt: CANCEL_REQUESTED_AT
      });
      await flushConstraints(client);
      const resolved =
        await repository.findCancellationBySubscription({
          stripeEventId: "evt_alakazam_lifecycle_cancel",
          stripeSubscriptionId: "sub_alakazam_lifecycle"
        });
      await repository.confirmCancellationSchedule({
        subscription,
        request: resolved.cancellation,
        event: cancellationEvent(),
        cancellation: cancellationProviderFacts(),
        grant: projectAlakazamExportGrant({
          policy: EXAMPLE_POLICY,
          availableFrom: CANCEL_CONFIRMED_AT,
          paidThroughAt: START_PERIOD_END
        }),
        eventRowId: randomUUID(),
        tierEventId: randomUUID(),
        exportGrantId: randomUUID()
      });
      await flushConstraints(client);

      // A granted window is a promise; it can be extended, never cut.
      await expectRejected(
        client,
        () =>
          client.query(
            `update ss.alakazam_export_grants
                set export_window_ends_at =
                      '2026-08-03T12:00:00.000Z'
              where cancellation_id = $1`,
            [cancellationId]
          ),
        /granted Alakazam export window cannot be reduced/u
      );

      // An unruled grant may not carry dates.
      await expectRejected(
        client,
        () =>
          insertRow(client, "alakazam_export_grants", {
            id: randomUUID(),
            organization_id: authority.organizationId,
            project_id: authority.projectId,
            subscription_id: seeded.subscriptionId,
            cancellation_id: cancellationId,
            state: "available",
            available_from: CANCEL_CONFIRMED_AT,
            paid_through_at: START_PERIOD_END,
            retention_state: "policy_decision_required",
            policy_version: null,
            retention_ends_at: "2026-12-01T12:00:00.000Z",
            export_window_ends_at: "2026-11-01T12:00:00.000Z"
          }),
        /alakazam_export_grants_check/u
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

// ---------------------------------------------------------------
// G-05 — defensive refunds and disputes
// ---------------------------------------------------------------

const START_CHARGE_ID = "ch_alakazam_lifecycle_start";
const START_PAYMENT_INTENT_ID =
  "pi_alakazam_lifecycle_start";
const REVERSAL_AT = "2026-07-25T10:00:00.000Z";
const REVERSAL_OBSERVED_AT = "2026-07-25T10:00:09.000Z";

function reversalProviderFacts(overrides = {}) {
  const facts = {
    schema: ALAKAZAM_REVERSAL_FACTS_SCHEMA,
    provider: "stripe",
    reversalKind: "dispute",
    outcome: "dispute_open",
    stripeChargeId: START_CHARGE_ID,
    stripePaymentIntentId: START_PAYMENT_INTENT_ID,
    stripeRefundId: null,
    stripeDisputeId: "dp_alakazam_lifecycle_1",
    amountChargedMinor: 2500,
    amountReversedMinor: 0,
    currency: "USD",
    providerObservedAt: REVERSAL_OBSERVED_AT,
    ...overrides
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function reversalEventInput(overrides = {}) {
  return {
    stripeEventId: "evt_alakazam_lifecycle_dispute",
    eventType: "charge.dispute.created",
    livemode: false,
    apiVersion: "2026-07-30.basil",
    stripeChargeId: START_CHARGE_ID,
    stripePaymentIntentId: START_PAYMENT_INTENT_ID,
    payloadDigest: digest("dispute payload"),
    signatureVerifiedAt: "2026-07-25T10:00:05.000Z",
    occurredAt: REVERSAL_AT,
    ...overrides
  };
}

test(
  "G-05: an unruled policy records the reversal and touches no service",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);

      // An unrelated PaymentIntent is not ours.
      assert.deepEqual(
        await repository.findReversalPaymentByCharge({
          stripeEventId: "evt_alakazam_lifecycle_other",
          stripeChargeId: "ch_someone_else",
          stripePaymentIntentId: "pi_someone_else"
        }),
        { status: "not_alakazam" }
      );

      const resolved =
        await repository.findReversalPaymentByCharge({
          stripeEventId: "evt_alakazam_lifecycle_dispute",
          stripeChargeId: START_CHARGE_ID,
          stripePaymentIntentId: START_PAYMENT_INTENT_ID
        });
      assert.equal(resolved.status, "current");
      assert.equal(resolved.currentSeverity, 0);
      assert.equal(
        resolved.subscription.paymentReceiptId,
        seeded.receiptId
      );
      assert.equal(
        resolved.subscription.receiptTotalMinor,
        2500
      );

      const decision = decideAlakazamReversalConsequence({
        policy: createAlakazamLifecyclePolicy(),
        outcome: "dispute_open",
        subscriptionStatus: "active",
        currentSeverity: 0
      });
      const recorded = await repository.recordReversal({
        subscription: resolved.subscription,
        event: reversalEventInput(),
        reversal: reversalProviderFacts(),
        decision,
        eventRowId: randomUUID(),
        reversalId: randomUUID(),
        tierEventId: null
      });
      await flushConstraints(client);

      assert.equal(recorded.status, "reversal_recorded");
      assert.equal(recorded.consequenceApplied, false);
      assert.equal(recorded.ownerReviewRequired, true);
      assert.equal(recorded.subscriptionStatus, "active");

      const row = await client.query(
        `select revision, status from ss.alakazam_subscriptions
          where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(row.rows[0].status, "active");
      assert.equal(row.rows[0].revision, "2");

      const stored = await client.query(
        `select policy_version, decided_consequence,
                service_state, consequence_applied,
                owner_review_required, severity,
                payment_receipt_id, tier_change_event_id
           from ss.alakazam_reversal_events
          where subscription_id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0].policy_version, null);
      assert.equal(
        stored.rows[0].decided_consequence,
        "owner_review"
      );
      assert.equal(stored.rows[0].service_state, "unchanged");
      assert.equal(
        stored.rows[0].consequence_applied,
        false
      );
      assert.equal(
        stored.rows[0].owner_review_required,
        true
      );
      assert.equal(stored.rows[0].severity, 30);
      assert.equal(
        stored.rows[0].payment_receipt_id,
        seeded.receiptId
      );
      assert.equal(stored.rows[0].tier_change_event_id, null);

      const replay =
        await repository.findReversalPaymentByCharge({
          stripeEventId: "evt_alakazam_lifecycle_dispute",
          stripeChargeId: START_CHARGE_ID,
          stripePaymentIntentId: START_PAYMENT_INTENT_ID
        });
      assert.equal(replay.status, "recorded");
      assert.equal(replay.currentSeverity, 30);
      assert.equal(
        replay.reversal.reversalId,
        recorded.reversalId
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "G-05: a ruled policy suspends on loss and never restores on a win",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const seeded = await seedActiveSubscription(
        client,
        authority
      );
      const repository = lifecycleRepository(client);
      const suspendingPolicy = createAlakazamLifecyclePolicy({
        approved: true,
        policyVersion: "alakazam-lifecycle.2026-08-08.v1",
        graceHours: 72,
        suspendAfterGraceHours: 0,
        retentionHours: 720,
        exportWindowHours: 336,
        graceConsequence: "restrict_publication",
        suspensionConsequence: "suspend_service",
        refundConsequence: "suspend_service",
        disputeConsequence: "suspend_service"
      });

      const resolved =
        await repository.findReversalPaymentByCharge({
          stripeEventId: "evt_alakazam_lifecycle_lost",
          stripeChargeId: START_CHARGE_ID,
          stripePaymentIntentId: START_PAYMENT_INTENT_ID
        });
      const lostDecision =
        decideAlakazamReversalConsequence({
          policy: suspendingPolicy,
          outcome: "dispute_lost",
          subscriptionStatus: "active",
          currentSeverity: 0
        });
      assert.equal(lostDecision.to, "suspended");
      const lost = await repository.recordReversal({
        subscription: resolved.subscription,
        event: reversalEventInput({
          stripeEventId: "evt_alakazam_lifecycle_lost",
          eventType: "charge.dispute.closed"
        }),
        reversal: reversalProviderFacts({
          outcome: "dispute_lost",
          amountReversedMinor: 2500
        }),
        decision: lostDecision,
        eventRowId: randomUUID(),
        reversalId: randomUUID(),
        tierEventId: randomUUID()
      });
      await flushConstraints(client);
      assert.equal(lost.consequenceApplied, true);
      assert.equal(lost.subscriptionStatus, "suspended");
      assert.equal(lost.severity, 80);

      let row = await client.query(
        `select revision, status, suspended_at
           from ss.alakazam_subscriptions where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(row.rows[0].status, "suspended");
      assert.equal(row.rows[0].revision, "3");
      assert.ok(row.rows[0].suspended_at !== null);

      // Funds reinstated later. Severity holds; service does not
      // silently come back.
      const after =
        await repository.findReversalPaymentByCharge({
          stripeEventId: "evt_alakazam_lifecycle_reinstated",
          stripeChargeId: START_CHARGE_ID,
          stripePaymentIntentId: START_PAYMENT_INTENT_ID
        });
      assert.equal(after.currentSeverity, 80);
      const reinstatedDecision =
        decideAlakazamReversalConsequence({
          policy: suspendingPolicy,
          outcome: "dispute_funds_reinstated",
          subscriptionStatus: after.subscription.status,
          currentSeverity: after.currentSeverity
        });
      assert.equal(reinstatedDecision.tierEventKind, null);
      const reinstated = await repository.recordReversal({
        subscription: after.subscription,
        event: reversalEventInput({
          stripeEventId:
            "evt_alakazam_lifecycle_reinstated",
          eventType: "charge.dispute.funds_reinstated",
          occurredAt: "2026-07-28T10:00:00.000Z",
          signatureVerifiedAt: "2026-07-28T10:00:05.000Z"
        }),
        reversal: reversalProviderFacts({
          outcome: "dispute_funds_reinstated",
          amountReversedMinor: 0,
          providerObservedAt: "2026-07-28T10:00:09.000Z"
        }),
        decision: reinstatedDecision,
        eventRowId: randomUUID(),
        reversalId: randomUUID(),
        tierEventId: null
      });
      await flushConstraints(client);
      assert.equal(reinstated.severity, 80);
      assert.equal(
        reinstated.subscriptionStatus,
        "suspended"
      );
      assert.equal(reinstated.consequenceApplied, false);

      row = await client.query(
        `select revision, status from ss.alakazam_subscriptions
          where id = $1`,
        [seeded.subscriptionId]
      );
      assert.equal(row.rows[0].status, "suspended");
      assert.equal(row.rows[0].revision, "3");

      // The schema itself refuses a severity that goes backwards.
      const eventRowId = await insertProcessedEvent(
        client,
        authority,
        {
          subscriptionId: seeded.subscriptionId,
          suffix: "alakazam_lifecycle_downgrade_severity",
          eventType: "charge.dispute.updated",
          providerObjectId: START_CHARGE_ID,
          occurredAt: "2026-07-29T10:00:00.000Z"
        }
      );
      await expectRejected(
        client,
        () =>
          insertRow(client, "alakazam_reversal_events", {
            id: randomUUID(),
            organization_id: authority.organizationId,
            project_id: authority.projectId,
            subscription_id: seeded.subscriptionId,
            payment_receipt_id: seeded.receiptId,
            stripe_event_row_id: eventRowId,
            reversal_kind: "dispute",
            outcome: "dispute_won",
            stripe_charge_id: START_CHARGE_ID,
            stripe_payment_intent_id:
              START_PAYMENT_INTENT_ID,
            stripe_dispute_id: "dp_alakazam_lifecycle_1",
            severity: 20,
            amount_charged_minor: 2500,
            amount_reversed_minor: 0,
            currency: "USD",
            observed_status: "suspended",
            resulting_status: "suspended",
            policy_version: null,
            decided_consequence: "owner_review",
            service_state: "unchanged",
            consequence_applied: false,
            owner_review_required: true,
            provider_facts: { lowered: true },
            provider_facts_digest: digest("lowered"),
            provider_observed_at: "2026-07-29T10:00:09.000Z",
            occurred_at: "2026-07-29T10:00:00.000Z"
          }),
        /severity cannot decrease/u
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);
