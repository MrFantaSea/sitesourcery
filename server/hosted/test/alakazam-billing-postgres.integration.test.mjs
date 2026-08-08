import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createPostgresAlakazamBillingRepository
} from "../alakazam-billing-postgres.mjs";
import {
  projectAlakazamInvoice
} from "../alakazam-billing-invoice.mjs";
import {
  projectAlakazamBillingStates
} from "../alakazam-billing-states.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env
    .SITESOURCERY_PG_ALAKAZAM_BILLING_TEST_URL ??
  process.env.SITESOURCERY_PG_ALAKAZAM_TEST_URL ??
  null;
const CATALOG_VERSION = "alakazam.2026-08-02.v1";
const TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertRow(client, table, row) {
  assert.match(table, /^[a-z0-9_]+$/u);
  const entries = Object.entries(row);
  for (const [column] of entries) {
    assert.match(column, /^[a-z_]+$/u);
  }
  const columns = entries
    .map(([column]) => column)
    .join(", ");
  const parameters = entries
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  await client.query(
    `insert into ss.${table} (${columns}) values (${parameters})`,
    entries.map(([, value]) => value)
  );
}

async function seedAuthority(client, suffix) {
  const authority = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID(),
    stripeCustomerRowId: randomUUID(),
    stripeCustomerId: `cus_l3_${suffix}`
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [
      authority.userId,
      `l3-${authority.userId}@example.test`
    ]
  );
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `l3-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-01-01T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: `L3 billing ${suffix}`
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: "2026-08-08T11:00:00.000Z"
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: `L3 project ${suffix}`
  });
  await insertRow(client, "stripe_customers", {
    id: authority.stripeCustomerRowId,
    organization_id: authority.organizationId,
    stripe_customer_id: authority.stripeCustomerId
  });
  return authority;
}

async function seedStartQuote(client, authority, tierId, amountMinor) {
  const id = randomUUID();
  await insertRow(client, "alakazam_change_quotes", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    catalog_version: CATALOG_VERSION,
    terms_version: TERMS_VERSION,
    change_kind: "start",
    current_subscription_id: null,
    current_subscription_revision: null,
    current_tier_id: null,
    current_amount_minor: null,
    current_period_ends_at: null,
    target_tier_id: tierId,
    target_amount_minor: amountMinor,
    applied_value_kind: "none",
    applied_value_minor: 0,
    download_entitlement_id: null,
    due_now_subtotal_minor: amountMinor,
    next_renewal_amount_minor: amountMinor,
    currency: "USD",
    effective_rule:
      "after_payment_and_provider_confirmation",
    effective_at: null,
    no_mid_period_refund: false,
    provider_proration_enabled: false,
    premium_configuration_policy: "preserved_when_inactive",
    tax_state: "disabled_by_owner",
    disclosure: { test: true, targetTierId: tierId },
    disclosure_digest: digest(`disclosure:${id}`),
    quote_digest: digest(`quote:${id}`),
    state: "quoted",
    provider_effects_authorized: true,
    issued_at: "2026-08-08T11:05:00.000Z",
    expires_at: "2026-08-08T11:35:00.000Z",
    created_by_user_id: authority.userId
  });
  return id;
}

async function seedSubscription(
  client,
  authority,
  quoteId,
  {
    tierId,
    amountMinor,
    status,
    suffix,
    activationReceiptId,
    ...rest
  }
) {
  const id = randomUUID();
  await insertRow(client, "alakazam_subscriptions", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    stripe_customer_row_id: authority.stripeCustomerRowId,
    stripe_subscription_id: `sub_l3_${suffix}`,
    stripe_subscription_item_id: `si_l3_${suffix}`,
    stripe_price_id: `price_l3_${suffix}`,
    initial_quote_id: quoteId,
    activation_receipt_id: activationReceiptId,
    tier_id: tierId,
    status,
    currency: "USD",
    amount_minor: amountMinor,
    current_period_starts_at: "2026-08-08T11:10:00.000Z",
    current_period_ends_at: "2026-09-08T11:10:00.000Z",
    provider_observed_at: "2026-08-08T11:10:00.000Z",
    provider_facts_digest: digest(`subscription:${id}`),
    ...rest
  });
  return id;
}

async function seedEvent(
  client,
  authority,
  subscriptionId,
  { suffix, state, attemptCount, occurredAt, processedAt = null, failureCode = null }
) {
  const id = randomUUID();
  // ss.alakazam_stripe_events only accepts a delivery in its received state;
  // every later state is reached by the same guarded transitions the runtime
  // uses, so this seed exercises the real replay path.
  await insertRow(client, "alakazam_stripe_events", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    subscription_id: subscriptionId,
    stripe_event_id: `evt_l3_${suffix}`,
    event_type: "invoice.paid",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    provider_object_id: `in_l3_${suffix}`,
    payload_digest: digest(`payload:${suffix}`),
    facts: { test: true, suffix },
    signature_verified_at: occurredAt,
    occurred_at: occurredAt
  });
  // Entering 'processing' must raise attempt_count by exactly one, so a
  // replayed delivery is walked through the same failed/processing cycle the
  // runtime performs rather than written straight to its final count.
  for (
    let attempt = 1;
    attempt <= (state === "received" ? 0 : attemptCount);
    attempt += 1
  ) {
    await client.query(
      `update ss.alakazam_stripe_events
          set state = 'processing',
              attempt_count = $2,
              failure_code = null
        where id = $1`,
      [id, attempt]
    );
    if (attempt < attemptCount) {
      await client.query(
        `update ss.alakazam_stripe_events
            set state = 'failed',
                failure_code = 'alakazam_delivery_retried'
          where id = $1`,
        [id]
      );
    }
  }
  if (state === "processed" || state === "ignored") {
    await client.query(
      `update ss.alakazam_stripe_events
          set state = $3, processed_at = $2
        where id = $1`,
      [id, processedAt, state]
    );
  }
  if (state === "failed") {
    await client.query(
      `update ss.alakazam_stripe_events
          set state = 'failed', failure_code = $2
        where id = $1`,
      [id, failureCode]
    );
  }
  return id;
}

async function seedReceipt(
  client,
  authority,
  {
    id,
    subscriptionId,
    quoteId,
    eventRowId,
    kind,
    listSubtotalMinor,
    discountMinor,
    taxMinor,
    settledAt,
    stripeInvoiceId,
    suffix
  }
) {
  const netSubtotalMinor = listSubtotalMinor - discountMinor;
  await insertRow(client, "alakazam_payment_receipts", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    subscription_id: subscriptionId,
    quote_id: quoteId,
    stripe_event_row_id: eventRowId,
    receipt_kind: kind,
    stripe_invoice_id: stripeInvoiceId,
    stripe_payment_intent_id: `pi_l3_${suffix}`,
    list_subtotal_minor: listSubtotalMinor,
    provider_discount_minor: discountMinor,
    net_subtotal_minor: netSubtotalMinor,
    tax_minor: taxMinor,
    total_minor: netSubtotalMinor + taxMinor,
    tax_mode: taxMinor === 0
      ? "disabled_by_owner"
      : "automatic",
    currency: "USD",
    settled_at: settledAt,
    provider_facts: { test: true, suffix },
    provider_facts_digest: digest(`receipt:${id}`)
  });
  return id;
}

function repositoryFor(client, authority) {
  return createPostgresAlakazamBillingRepository({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, {
          userId: authority.userId,
          organizationId: authority.organizationId,
          readOnly: true
        });
        return work(client);
      }
    }
  });
}

function scopeFor(authority) {
  return {
    tenantId: authority.organizationId,
    customerId: authority.userId,
    actorId: authority.userId,
    projectId: authority.projectId
  };
}


async function flush(client) {
  await client.query("set constraints all immediate");
  await client.query("set constraints all deferred");
}

/**
 * Seeds the exact rows these two reads touch, in the order ss.* accepts them.
 * The start quote is validated while no subscription exists, walked to the
 * provider-reconciliation state the runtime uses, and only then bound to a
 * subscription; the renewal receipt is bound to a verified, processed provider
 * event. Writing the full activation chain is already proven by
 * server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs.
 */
async function seedBilling(
  client,
  authority,
  { tierId, amountMinor, suffix, reconciling = false }
) {
  const quoteId = await seedStartQuote(
    client,
    authority,
    tierId,
    amountMinor
  );
  await flush(client);
  if (reconciling) {
    for (const state of [
      "checkout_dispatching",
      "reconciliation_required"
    ]) {
      await client.query(
        `update ss.alakazam_change_quotes
            set state = $2
          where id = $1`,
        [quoteId, state]
      );
      await flush(client);
    }
  }
  const subscriptionId = await seedSubscription(
    client,
    authority,
    quoteId,
    {
      tierId,
      amountMinor,
      status: "pending",
      suffix,
      activationReceiptId: null,
      current_period_starts_at: null,
      current_period_ends_at: null
    }
  );
  const eventId = await seedEvent(
    client,
    authority,
    subscriptionId,
    {
      suffix: `${suffix}_paid`,
      state: "processed",
      attemptCount: 1,
      occurredAt: "2026-08-08T11:12:00.000Z",
      processedAt: "2026-08-08T11:12:05.000Z"
    }
  );
  const receiptId = randomUUID();
  await seedReceipt(client, authority, {
    id: receiptId,
    subscriptionId,
    quoteId: null,
    eventRowId: eventId,
    kind: "renewal_payment",
    listSubtotalMinor: amountMinor,
    discountMinor: 0,
    taxMinor: 0,
    settledAt: "2026-08-08T11:12:05.000Z",
    stripeInvoiceId: `in_l3_${suffix}_paid`,
    suffix: `${suffix}_paid`
  });
  await flush(client);
  return { quoteId, subscriptionId, eventId, receiptId };
}

test(
  "A-03 reads only the signed-in customer's own Alakazam invoice from migration-backed PostgreSQL",
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

      const owner = await seedAuthority(client, "owner");
      const stranger = await seedAuthority(
        client,
        "stranger"
      );
      const seeded = await seedBilling(client, owner, {
        tierId: "alakazam_50",
        amountMinor: 5000,
        suffix: "owner"
      });

      const repository = repositoryFor(client, owner);
      const scope = scopeFor(owner);
      const stored = await repository.readCustomerInvoice({
        ...scope,
        receiptId: seeded.receiptId
      });
      assert.equal(stored.receiptId, seeded.receiptId);
      assert.equal(stored.kind, "renewal_payment");
      assert.equal(stored.tierId, null);
      assert.equal(stored.subtotalMinor, 5000);
      assert.equal(stored.netSubtotalMinor, 5000);
      assert.equal(stored.totalMinor, 5000);
      assert.equal(stored.taxMode, "disabled_by_owner");
      assert.equal(stored.providerInvoiceRecorded, true);

      const invoice = projectAlakazamInvoice(
        stored,
        scope,
        seeded.receiptId
      );
      assert.equal(invoice.state, "settled");
      assert.equal(invoice.tier.tierId, "alakazam_50");
      assert.equal(invoice.totals.totalMinor, 5000);
      assert.match(
        invoice.invoiceNumber,
        /^SSAK-[0-9A-F]{32}$/u
      );
      const serialized = JSON.stringify(invoice);
      assert.equal(serialized.includes("in_l3"), false);
      assert.equal(serialized.includes("pi_l3"), false);
      assert.equal(serialized.includes("sub_l3"), false);

      // A receipt that is not this customer's simply does not resolve.
      assert.equal(
        await repository.readCustomerInvoice({
          ...scope,
          receiptId: randomUUID()
        }),
        null
      );
      const strangerRepository = repositoryFor(
        client,
        stranger
      );
      assert.equal(
        await strangerRepository.readCustomerInvoice({
          ...scopeFor(stranger),
          receiptId: seeded.receiptId
        }),
        null
      );
      await assert.rejects(
        () =>
          strangerRepository.readCustomerInvoice({
            ...scopeFor(stranger),
            projectId: owner.projectId,
            receiptId: seeded.receiptId
          }),
        (error) => error.code === "project_unavailable"
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "E-09 reads true replay and reconciliation state, per customer, from migration-backed PostgreSQL",
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

      const owner = await seedAuthority(client, "states");
      const stranger = await seedAuthority(
        client,
        "states_other"
      );
      const seeded = await seedBilling(client, owner, {
        tierId: "alakazam_25",
        amountMinor: 2500,
        suffix: "states"
      });

      const repository = repositoryFor(client, owner);
      const scope = scopeFor(owner);
      const settled = projectAlakazamBillingStates(
        await repository.readCustomerBillingStates(scope),
        scope
      );
      assert.equal(settled.payment.state, "pending");
      assert.equal(settled.payment.retry.active, false);
      assert.equal(settled.replay.state, "settled");
      assert.equal(settled.replay.outstanding, 0);
      assert.equal(settled.replay.maximumAttempts, 1);
      assert.equal(
        settled.replay.duplicateSuppressed,
        true
      );
      assert.equal(settled.reconciliation.state, "none");
      assert.equal(settled.revision, 1);

      // A replayed delivery that is still being processed is outstanding, and
      // its attempt count is shown rather than hidden.
      await seedEvent(
        client,
        owner,
        seeded.subscriptionId,
        {
          suffix: "states_replay",
          state: "processing",
          attemptCount: 4,
          occurredAt: "2026-08-08T11:20:00.000Z"
        }
      );
      await flush(client);
      const verifying = projectAlakazamBillingStates(
        await repository.readCustomerBillingStates(scope),
        scope
      );
      assert.equal(verifying.replay.state, "verifying");
      assert.equal(verifying.replay.outstanding, 1);
      assert.equal(verifying.replay.maximumAttempts, 4);
      assert.equal(
        verifying.display.attentionRequired,
        false
      );
      assert.equal(
        Date.parse(verifying.observedAt) >=
          Date.parse(settled.observedAt),
        true
      );

      // A failed delivery reaches the customer's account state.
      await seedEvent(
        client,
        owner,
        seeded.subscriptionId,
        {
          suffix: "states_failed",
          state: "failed",
          attemptCount: 6,
          occurredAt: "2026-08-08T11:25:00.000Z",
          failureCode: "alakazam_settlement_unverified"
        }
      );
      await flush(client);
      const attention = projectAlakazamBillingStates(
        await repository.readCustomerBillingStates(scope),
        scope
      );
      assert.equal(
        attention.replay.state,
        "attention_required"
      );
      assert.equal(attention.replay.failed, 1);
      assert.equal(attention.replay.outstanding, 2);
      assert.equal(
        attention.display.attentionRequired,
        true
      );
      assert.equal(attention.display.settled, false);

      // A second customer's own project carries a real provider
      // reconciliation, and none of the first customer's events.
      const reconciling = await seedBilling(
        client,
        stranger,
        {
          tierId: "alakazam_35",
          amountMinor: 3500,
          suffix: "states_other",
          reconciling: true
        }
      );
      assert.equal(
        typeof reconciling.quoteId,
        "string"
      );
      const strangerScope = scopeFor(stranger);
      const strangerStates = projectAlakazamBillingStates(
        await repositoryFor(
          client,
          stranger
        ).readCustomerBillingStates(strangerScope),
        strangerScope
      );
      assert.equal(
        strangerStates.reconciliation.state,
        "required"
      );
      assert.equal(
        strangerStates.reconciliation.kind,
        "tier_change"
      );
      assert.equal(strangerStates.replay.failed, 0);
      assert.equal(strangerStates.replay.outstanding, 0);
      assert.equal(
        strangerStates.display.attentionRequired,
        true
      );

      // The first customer's reconciliation state is untouched by the second.
      const unchanged = projectAlakazamBillingStates(
        await repository.readCustomerBillingStates(scope),
        scope
      );
      assert.equal(unchanged.reconciliation.state, "none");
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "E-09 drives the retry state from the subscription status, not from stray failure columns",
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
      const authority = await seedAuthority(
        client,
        "retry"
      );
      const seeded = await seedBilling(client, authority, {
        tierId: "alakazam_35",
        amountMinor: 3500,
        suffix: "retry"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set first_failed_at =
                  '2026-08-08T11:30:00.000Z',
                grace_ends_at =
                  '2026-08-22T11:30:00.000Z',
                provider_observed_at =
                  '2026-08-08T11:30:00.000Z'
          where id = $1`,
        [seeded.subscriptionId]
      );
      const scope = scopeFor(authority);
      const stored = await repositoryFor(
        client,
        authority
      ).readCustomerBillingStates(scope);
      assert.equal(
        stored.subscription.firstFailedAt,
        "2026-08-08T11:30:00.000Z"
      );
      assert.equal(
        stored.subscription.graceEndsAt,
        "2026-08-22T11:30:00.000Z"
      );
      const states = projectAlakazamBillingStates(
        stored,
        scope
      );
      assert.equal(states.payment.state, "pending");
      assert.equal(states.payment.retry.active, false);
      assert.equal(
        states.payment.retry.startedAt,
        "2026-08-08T11:30:00.000Z"
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);
