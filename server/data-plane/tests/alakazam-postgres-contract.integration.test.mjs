import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createPostgresAlakazamRepository
} from "../../hosted/alakazam-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_TEST_URL ?? null;
const CATALOG_VERSION = "alakazam.2026-08-02.v1";
const TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertRow(client, table, row) {
  assert.match(table, /^[a-z_]+$/u);
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
    stripeCustomerRowId: randomUUID()
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [
      authority.userId,
      `alakazam-${authority.userId}@example.test`
    ]
  );
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `alakazam-test-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-01-01T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: "Alakazam Contract Test"
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: "2026-08-02T11:55:00.000Z"
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: "Alakazam Project"
  });
  await insertRow(client, "stripe_customers", {
    id: authority.stripeCustomerRowId,
    organization_id: authority.organizationId,
    stripe_customer_id: "cus_alakazam_contract"
  });
  return authority;
}

test(
  "Alakazam quote repository commits and replays one exact migration-backed transaction",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await client.query("set constraints all deferred");
      const seeded = await seedAuthority(client);
      const repository =
        createPostgresAlakazamRepository({
          authority: {
            async service(context, work) {
              assert.deepEqual(context, {
                userId: seeded.userId,
                organizationId: seeded.organizationId
              });
              return work(client);
            }
          }
        });
      const quoteId = randomUUID();
      const input = {
        tenantId: seeded.organizationId,
        customerId: seeded.userId,
        projectId: seeded.projectId,
        quoteId,
        targetTierId: "alakazam_35",
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z",
        taxMode: "disabled_by_owner"
      };
      const quote = await repository.createQuote(input);
      assert.equal(quote.changeKind, "start");
      assert.equal(quote.state, "quoted");
      assert.equal(quote.providerEffectsAuthorized, true);
      assert.equal(quote.dueNow.subtotalMinor, 3500);
      assert.equal(quote.dueNow.taxMinor, 0);
      assert.equal(quote.dueNow.totalMinor, 3500);

      const replay = await repository.createQuote({
        ...input,
        issuedAt: "2026-08-02T12:01:00.000Z",
        expiresAt: "2026-08-02T12:31:00.000Z"
      });
      assert.deepEqual(replay, quote);
      await flushConstraints(client);
      const stored = await client.query(
        `select state, provider_effects_authorized,
                target_tier_id, target_amount_minor,
                due_now_subtotal_minor, tax_state,
                disclosure_digest, quote_digest
           from ss.alakazam_change_quotes
          where organization_id = $1 and id = $2`,
        [seeded.organizationId, quoteId]
      );
      assert.equal(stored.rowCount, 1);
      assert.deepEqual(
        {
          state: stored.rows[0].state,
          authorized:
            stored.rows[0].provider_effects_authorized,
          targetTierId: stored.rows[0].target_tier_id,
          targetAmountMinor: Number(
            stored.rows[0].target_amount_minor
          ),
          dueNowSubtotalMinor: Number(
            stored.rows[0].due_now_subtotal_minor
          ),
          taxState: stored.rows[0].tax_state,
          disclosureDigest:
            stored.rows[0].disclosure_digest,
          quoteDigest: stored.rows[0].quote_digest
        },
        {
          state: "quoted",
          authorized: true,
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          dueNowSubtotalMinor: 3500,
          taxState: "disabled_by_owner",
          disclosureDigest: quote.disclosureDigest,
          quoteDigest: quote.quoteDigest
        }
      );
    } finally {
      if (transactionOpen) {
        await client.query("rollback");
      }
      client.release();
      await pool.end();
    }
  }
);

async function insertQuote(client, authority, input) {
  const id = input.id ?? randomUUID();
  await insertRow(client, "alakazam_change_quotes", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    catalog_version: CATALOG_VERSION,
    terms_version: TERMS_VERSION,
    change_kind: input.changeKind,
    current_subscription_id: input.currentSubscriptionId ?? null,
    current_subscription_revision:
      input.currentSubscriptionRevision ?? null,
    current_tier_id: input.currentTierId ?? null,
    current_amount_minor: input.currentAmountMinor ?? null,
    current_period_ends_at: input.currentPeriodEndsAt ?? null,
    target_tier_id: input.targetTierId,
    target_amount_minor: input.targetAmountMinor,
    applied_value_kind: input.appliedValueKind,
    applied_value_minor: input.appliedValueMinor,
    download_entitlement_id: input.downloadEntitlementId ?? null,
    due_now_subtotal_minor: input.dueNowSubtotalMinor,
    next_renewal_amount_minor: input.targetAmountMinor,
    currency: "USD",
    effective_rule: input.effectiveRule,
    effective_at: input.effectiveAt ?? null,
    no_mid_period_refund: input.noMidPeriodRefund,
    provider_proration_enabled: false,
    premium_configuration_policy: "preserved_when_inactive",
    tax_state: "disabled_by_owner",
    disclosure: {
      test: true,
      changeKind: input.changeKind,
      targetTierId: input.targetTierId
    },
    disclosure_digest: digest(`disclosure:${id}`),
    quote_digest: digest(`quote:${id}`),
    state: "quoted",
    provider_effects_authorized: true,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    created_by_user_id: authority.userId
  });
  return id;
}

async function openCheckout(
  client,
  authority,
  { quoteId, mode, subtotalMinor, creditMinor, suffix }
) {
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'checkout_dispatching'
      where id = $1`,
    [quoteId]
  );
  const dispatchId = randomUUID();
  await insertRow(client, "alakazam_checkout_dispatches", {
    id: dispatchId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    quote_id: quoteId,
    mode,
    provider: "stripe",
    stripe_customer_id: "cus_alakazam_contract",
    provider_idempotency_key: `alakazam-${suffix}-checkout`,
    purpose_digest: digest(`purpose:${suffix}`),
    purpose: { test: true, suffix },
    expected_subtotal_minor: subtotalMinor,
    expected_credit_minor: creditMinor,
    currency: "USD",
    state: "reserved",
    provider_effect_certainty: "not_submitted"
  });
  await client.query(
    `update ss.alakazam_checkout_dispatches
        set state = 'ready',
            stripe_checkout_session_id = $2,
            provider_checkout_url = $3,
            provider_expires_at = $4,
            dispatched_at = $5,
            provider_effect_certainty = 'confirmed'
      where id = $1`,
    [
      dispatchId,
      `cs_${suffix}`,
      `https://checkout.stripe.test/${suffix}`,
      "2026-08-02T13:00:00.000Z",
      "2026-08-02T12:01:00.000Z"
    ]
  );
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'checkout_ready'
      where id = $1`,
    [quoteId]
  );
  return dispatchId;
}

async function settleCheckout(client, quoteId, dispatchId, settledAt) {
  await client.query(
    `update ss.alakazam_checkout_dispatches
        set state = 'settled', settled_at = $2
      where id = $1`,
    [dispatchId, settledAt]
  );
  await client.query(
    `update ss.alakazam_change_quotes
        set state = 'payment_settled'
      where id = $1`,
    [quoteId]
  );
}

async function insertStripeEvent(client, authority, input) {
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
    api_version: "2026-06-24.dahlia",
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
    [id, input.processedAt]
  );
  return id;
}

async function insertReceipt(client, authority, input) {
  const id = randomUUID();
  await insertRow(client, "alakazam_payment_receipts", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    subscription_id: input.subscriptionId,
    quote_id: input.quoteId ?? null,
    stripe_event_row_id: input.stripeEventRowId,
    receipt_kind: input.receiptKind,
    stripe_invoice_id: input.stripeInvoiceId ?? null,
    stripe_payment_intent_id: input.stripePaymentIntentId,
    list_subtotal_minor: input.listSubtotalMinor,
    provider_discount_minor: input.providerDiscountMinor ?? 0,
    net_subtotal_minor: input.netSubtotalMinor,
    tax_minor: 0,
    total_minor: input.netSubtotalMinor,
    tax_mode: "disabled_by_owner",
    currency: "USD",
    settled_at: input.settledAt,
    provider_facts: { test: true, receiptKind: input.receiptKind },
    provider_facts_digest: digest(`receipt:${id}`)
  });
  return id;
}

async function insertTierEvent(client, authority, input) {
  const id = randomUUID();
  await insertRow(client, "alakazam_tier_change_events", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    subscription_id: input.subscriptionId,
    quote_id: input.quoteId ?? null,
    stripe_event_row_id: input.stripeEventRowId ?? null,
    payment_receipt_id: input.paymentReceiptId ?? null,
    downgrade_schedule_id: input.downgradeScheduleId ?? null,
    download_reversal_event_id: null,
    result_subscription_revision:
      input.resultSubscriptionRevision ?? null,
    event_kind: input.eventKind,
    prior_tier_id: input.priorTierId ?? null,
    result_tier_id: input.resultTierId,
    occurred_at: input.occurredAt,
    facts: { test: true, eventKind: input.eventKind },
    facts_digest: digest(`tier-event:${id}`)
  });
  return id;
}

test(
  "Alakazam PostgreSQL contract proves start, fixed upgrade, and boundary downgrade",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const subscriptionId = randomUUID();

      await expectRejected(
        client,
        () => insertQuote(client, authority, {
          changeKind: "start",
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          appliedValueKind: "none",
          appliedValueMinor: 0,
          dueNowSubtotalMinor: 1500,
          effectiveRule: "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:00:00.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }),
        /alakazam_change_quotes|check constraint/iu
      );

      const startQuoteId = await insertQuote(client, authority, {
        changeKind: "start",
        targetTierId: "alakazam_25",
        targetAmountMinor: 2500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 2500,
        effectiveRule: "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      const startDispatchId = await openCheckout(
        client,
        authority,
        {
          quoteId: startQuoteId,
          mode: "subscription_start",
          subtotalMinor: 2500,
          creditMinor: 0,
          suffix: "alakazam_start"
        }
      );
      await insertRow(client, "alakazam_subscriptions", {
        id: subscriptionId,
        organization_id: authority.organizationId,
        project_id: authority.projectId,
        customer_user_id: authority.userId,
        stripe_customer_row_id: authority.stripeCustomerRowId,
        stripe_subscription_id: "sub_alakazam_contract",
        stripe_subscription_item_id: "si_alakazam_contract",
        stripe_price_id: "price_alakazam_25",
        initial_quote_id: startQuoteId,
        tier_id: "alakazam_25",
        status: "pending",
        currency: "USD",
        amount_minor: 2500,
        provider_observed_at: "2026-08-02T12:01:00.000Z",
        provider_facts_digest: digest("subscription:pending")
      });
      await flushConstraints(client);

      const startPaymentEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: startQuoteId,
          subscriptionId,
          suffix: "alakazam_start_payment",
          eventType: "invoice.payment_succeeded",
          providerObjectId: "in_alakazam_start",
          occurredAt: "2026-08-02T12:02:00.000Z",
          processedAt: "2026-08-02T12:02:05.000Z"
        }
      );
      await settleCheckout(
        client,
        startQuoteId,
        startDispatchId,
        "2026-08-02T12:02:05.000Z"
      );
      const startReceiptId = await insertReceipt(
        client,
        authority,
        {
          subscriptionId,
          quoteId: startQuoteId,
          stripeEventRowId: startPaymentEventId,
          receiptKind: "start_payment",
          stripeInvoiceId: "in_alakazam_start",
          stripePaymentIntentId: "pi_alakazam_start",
          listSubtotalMinor: 2500,
          netSubtotalMinor: 2500,
          settledAt: "2026-08-02T12:02:00.000Z"
        }
      );
      await flushConstraints(client);

      const startProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: startQuoteId,
          subscriptionId,
          suffix: "alakazam_start_provider",
          eventType: "customer.subscription.created",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-08-02T12:03:00.000Z",
          processedAt: "2026-08-02T12:03:05.000Z"
        }
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: startQuoteId,
        stripeEventRowId: startProviderEventId,
        paymentReceiptId: startReceiptId,
        resultSubscriptionRevision: 2,
        eventKind: "start_applied",
        resultTierId: "alakazam_25",
        occurredAt: "2026-08-02T12:03:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set activation_receipt_id = $2,
                status = 'active',
                current_period_starts_at = $3,
                current_period_ends_at = $4,
                provider_observed_at = $5,
                provider_facts_digest = $6
          where id = $1`,
        [
          subscriptionId,
          startReceiptId,
          "2026-08-02T12:03:00.000Z",
          "2026-09-02T12:03:00.000Z",
          "2026-08-02T12:04:00.000Z",
          digest("subscription:active-25")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [startQuoteId]
      );
      await flushConstraints(client);

      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_subscriptions
              set tier_id = 'alakazam_35',
                  amount_minor = 3500,
                  stripe_price_id = 'price_alakazam_35',
                  provider_observed_at = $2,
                  provider_facts_digest = $3
            where id = $1`,
          [
            subscriptionId,
            "2026-08-02T12:05:00.000Z",
            digest("subscription:unproved-upgrade")
          ]
        ),
        /lacks exact revision evidence/iu
      );

      const upgradeQuoteId = await insertQuote(client, authority, {
        changeKind: "upgrade",
        currentSubscriptionId: subscriptionId,
        currentSubscriptionRevision: 2,
        currentTierId: "alakazam_25",
        currentAmountMinor: 2500,
        currentPeriodEndsAt: "2026-09-02T12:03:00.000Z",
        targetTierId: "alakazam_35",
        targetAmountMinor: 3500,
        appliedValueKind: "current_paid_tier",
        appliedValueMinor: 2500,
        dueNowSubtotalMinor: 1000,
        effectiveRule: "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:10:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      const upgradeDispatchId = await openCheckout(
        client,
        authority,
        {
          quoteId: upgradeQuoteId,
          mode: "upgrade_difference",
          subtotalMinor: 1000,
          creditMinor: 0,
          suffix: "alakazam_upgrade_25_35"
        }
      );
      const upgradePaymentEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: upgradeQuoteId,
          subscriptionId,
          suffix: "alakazam_upgrade_payment",
          eventType: "checkout.session.completed",
          providerObjectId: "pi_alakazam_upgrade",
          occurredAt: "2026-08-02T12:12:00.000Z",
          processedAt: "2026-08-02T12:12:05.000Z"
        }
      );
      await settleCheckout(
        client,
        upgradeQuoteId,
        upgradeDispatchId,
        "2026-08-02T12:12:05.000Z"
      );
      const upgradeReceiptId = await insertReceipt(
        client,
        authority,
        {
          subscriptionId,
          quoteId: upgradeQuoteId,
          stripeEventRowId: upgradePaymentEventId,
          receiptKind: "upgrade_difference",
          stripePaymentIntentId: "pi_alakazam_upgrade",
          listSubtotalMinor: 1000,
          netSubtotalMinor: 1000,
          settledAt: "2026-08-02T12:12:00.000Z"
        }
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: upgradeQuoteId,
        stripeEventRowId: upgradePaymentEventId,
        paymentReceiptId: upgradeReceiptId,
        eventKind: "upgrade_payment_settled",
        priorTierId: "alakazam_25",
        resultTierId: "alakazam_35",
        occurredAt: "2026-08-02T12:12:00.000Z"
      });
      await flushConstraints(client);

      await client.query(
        `update ss.alakazam_change_quotes
            set state = 'provider_change_pending'
          where id = $1`,
        [upgradeQuoteId]
      );
      const upgradeProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: upgradeQuoteId,
          subscriptionId,
          suffix: "alakazam_upgrade_provider",
          eventType: "customer.subscription.updated",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-08-02T12:13:00.000Z",
          processedAt: "2026-08-02T12:13:05.000Z"
        }
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: upgradeQuoteId,
        stripeEventRowId: upgradeProviderEventId,
        paymentReceiptId: upgradeReceiptId,
        resultSubscriptionRevision: 3,
        eventKind: "upgrade_applied",
        priorTierId: "alakazam_25",
        resultTierId: "alakazam_35",
        occurredAt: "2026-08-02T12:13:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set tier_id = 'alakazam_35',
                amount_minor = 3500,
                stripe_price_id = 'price_alakazam_35',
                provider_observed_at = $2,
                provider_facts_digest = $3
          where id = $1`,
        [
          subscriptionId,
          "2026-08-02T12:14:00.000Z",
          digest("subscription:active-35")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [upgradeQuoteId]
      );
      await flushConstraints(client);

      const downgradeQuoteId = await insertQuote(client, authority, {
        changeKind: "downgrade",
        currentSubscriptionId: subscriptionId,
        currentSubscriptionRevision: 3,
        currentTierId: "alakazam_35",
        currentAmountMinor: 3500,
        currentPeriodEndsAt: "2026-09-02T12:03:00.000Z",
        targetTierId: "alakazam_25",
        targetAmountMinor: 2500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 0,
        effectiveRule: "current_period_end",
        effectiveAt: "2026-09-02T12:03:00.000Z",
        noMidPeriodRefund: true,
        issuedAt: "2026-08-02T12:20:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      await client.query(
        `update ss.alakazam_change_quotes
            set state = 'schedule_dispatching'
          where id = $1`,
        [downgradeQuoteId]
      );
      const downgradeScheduleId = randomUUID();
      await insertRow(client, "alakazam_downgrade_schedules", {
        id: downgradeScheduleId,
        organization_id: authority.organizationId,
        project_id: authority.projectId,
        subscription_id: subscriptionId,
        quote_id: downgradeQuoteId,
        current_tier_id: "alakazam_35",
        target_tier_id: "alakazam_25",
        current_stripe_price_id: "price_alakazam_35",
        target_stripe_price_id: "price_alakazam_25",
        effective_at: "2026-09-02T12:03:00.000Z",
        provider_idempotency_key: "alakazam-downgrade-35-25",
        purpose_digest: digest("downgrade:35:25"),
        state: "dispatching"
      });
      await client.query(
        `update ss.alakazam_downgrade_schedules
            set state = 'scheduled',
                stripe_schedule_id = 'sub_sched_alakazam_35_25',
                provider_facts = '{"test":true}'::jsonb,
                provider_facts_digest = $2,
                scheduled_at = $3
          where id = $1`,
        [
          downgradeScheduleId,
          digest("schedule:35:25"),
          "2026-08-02T12:21:00.000Z"
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'scheduled' where id = $1",
        [downgradeQuoteId]
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: downgradeQuoteId,
        downgradeScheduleId,
        eventKind: "downgrade_scheduled",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_25",
        occurredAt: "2026-08-02T12:21:00.000Z"
      });
      await flushConstraints(client);

      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_subscriptions
              set tier_id = 'alakazam_25',
                  amount_minor = 2500,
                  stripe_price_id = 'price_alakazam_25',
                  provider_observed_at = $2,
                  provider_facts_digest = $3
            where id = $1`,
          [
            subscriptionId,
            "2026-08-02T12:22:00.000Z",
            digest("subscription:early-downgrade")
          ]
        ),
        /renewal boundary/iu
      );

      const downgradeProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: downgradeQuoteId,
          subscriptionId,
          suffix: "alakazam_downgrade_provider",
          eventType: "customer.subscription.updated",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-09-02T12:03:00.000Z",
          processedAt: "2026-09-02T12:03:05.000Z"
        }
      );
      await client.query(
        `update ss.alakazam_downgrade_schedules
            set state = 'applied', applied_at = $2
          where id = $1`,
        [downgradeScheduleId, "2026-09-02T12:03:00.000Z"]
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: downgradeQuoteId,
        stripeEventRowId: downgradeProviderEventId,
        downgradeScheduleId,
        resultSubscriptionRevision: 4,
        eventKind: "downgrade_applied",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_25",
        occurredAt: "2026-09-02T12:03:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set tier_id = 'alakazam_25',
                amount_minor = 2500,
                stripe_price_id = 'price_alakazam_25',
                current_period_starts_at = $2,
                current_period_ends_at = $3,
                provider_observed_at = $4,
                provider_facts_digest = $5
          where id = $1`,
        [
          subscriptionId,
          "2026-09-02T12:03:00.000Z",
          "2026-10-02T12:03:00.000Z",
          "2026-09-02T12:04:00.000Z",
          digest("subscription:renewed-25")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [downgradeQuoteId]
      );
      await flushConstraints(client);

      const proof = await client.query(
        `select
           subscription.tier_id,
           subscription.amount_minor,
           subscription.revision,
           upgrade.due_now_subtotal_minor as upgrade_due,
           downgrade.due_now_subtotal_minor as downgrade_due,
           downgrade.no_mid_period_refund,
           downgrade.provider_proration_enabled,
           schedule.effective_at,
           schedule.applied_at
         from ss.alakazam_subscriptions subscription
         join ss.alakazam_change_quotes upgrade on upgrade.id = $2
         join ss.alakazam_change_quotes downgrade on downgrade.id = $3
         join ss.alakazam_downgrade_schedules schedule
           on schedule.id = $4
        where subscription.id = $1`,
        [
          subscriptionId,
          upgradeQuoteId,
          downgradeQuoteId,
          downgradeScheduleId
        ]
      );
      assert.deepEqual(
        {
          tier: proof.rows[0].tier_id,
          amount: Number(proof.rows[0].amount_minor),
          revision: Number(proof.rows[0].revision),
          upgradeDue: Number(proof.rows[0].upgrade_due),
          downgradeDue: Number(proof.rows[0].downgrade_due),
          noMidPeriodRefund:
            proof.rows[0].no_mid_period_refund,
          providerProration:
            proof.rows[0].provider_proration_enabled,
          effectiveAt:
            proof.rows[0].effective_at.toISOString(),
          appliedAt: proof.rows[0].applied_at.toISOString()
        },
        {
          tier: "alakazam_25",
          amount: 2500,
          revision: 4,
          upgradeDue: 1000,
          downgradeDue: 0,
          noMidPeriodRefund: true,
          providerProration: false,
          effectiveAt: "2026-09-02T12:03:00.000Z",
          appliedAt: "2026-09-02T12:03:00.000Z"
        }
      );

      const grants = await client.query(`
        select
          has_table_privilege(
            'authenticated',
            'ss.alakazam_subscriptions',
            'select'
          ) as authenticated_select,
          has_table_privilege(
            'anon',
            'ss.alakazam_change_quotes',
            'insert'
          ) as anon_insert
      `);
      assert.deepEqual(grants.rows[0], {
        authenticated_select: false,
        anon_insert: false
      });
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
      await pool.end();
    }
  }
);
