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
