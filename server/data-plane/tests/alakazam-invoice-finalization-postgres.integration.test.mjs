import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA
} from "../../commerce-v2/alakazam.mjs";
import { createAlakazamBillingRelease } from "../../commerce-v2/alakazam-billing.mjs";
import {
  ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA,
  createAlakazamInvoiceFinalizationService
} from "../../commerce-v2/alakazam-invoice-finalization.mjs";
import { digest } from "../../commerce-v2/canonical.mjs";
import {
  createPostgresAlakazamInvoiceFinalizationRepository
} from "../../hosted/alakazam-invoice-finalization-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../../hosted/repository-postgres.mjs";

const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_FINALIZATION_TEST_URL ?? null;
const { Pool } = pg;

function event({ id, type = "invoice.finalization_failed", invoiceId, subscriptionId }) {
  return {
    id,
    type,
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000) - 1,
    data: {
      object: {
        object: "invoice",
        id: invoiceId,
        parent: {
          subscription_details: { subscription: subscriptionId }
        }
      }
    }
  };
}

function readback(seed, overrides = {}) {
  const facts = {
    schema: ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA,
    provider: "stripe",
    stripeInvoiceId: seed.invoiceId,
    stripeSubscriptionId: seed.stripeSubscriptionId,
    stripeCustomerId: seed.stripeCustomerId,
    tierId: "alakazam_25",
    status: "draft",
    finalizationState: "failed",
    reasonCode: "automatic_tax",
    billingReason: "subscription_cycle",
    collectionMethod: "charge_automatically",
    amountDueMinor: 2500,
    currency: "USD",
    providerObservedAt: new Date().toISOString(),
    subscription: {
      schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
      stripeSubscriptionId: seed.stripeSubscriptionId,
      stripeCustomerId: seed.stripeCustomerId
    },
    ...overrides
  };
  return { ...facts, providerFactsDigest: digest(facts) };
}

async function seedSubscription(pool, suffix) {
  const seed = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    policyId: randomUUID(),
    projectId: randomUUID(),
    customerRowId: randomUUID(),
    subscriptionId: randomUUID(),
    initialQuoteId: randomUUID(),
    activationReceiptId: randomUUID(),
    stripeCustomerId: `cus_finalization_${suffix}`,
    stripeSubscriptionId: `sub_finalization_${suffix}`,
    invoiceId: `in_finalization_${suffix}`
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [seed.userId, `finalization-${suffix}-${seed.userId}@example.test`]
    );
    await client.query(
      `insert into ss.billing_policies
         (id, policy_key, grace_period, retention_period, effective_at)
       values ($1, $2, interval '14 days', interval '90 days', $3)`,
      [seed.policyId, `finalization-${suffix}-${seed.policyId}`,
        "2026-01-01T00:00:00.000Z"]
    );
    await client.query(
      "insert into ss.organizations (id, created_by_user_id, name) values ($1,$2,$3)",
      [seed.organizationId, seed.userId, `Finalization ${suffix}`]
    );
    await client.query(
      `insert into ss.organization_memberships
         (organization_id, user_id, role, state, accepted_at)
       values ($1,$2,'owner','active',$3)`,
      [seed.organizationId, seed.userId, "2026-01-01T00:00:00.000Z"]
    );
    await client.query(
      `insert into ss.projects
         (id, organization_id, created_by_user_id, billing_policy_id, name)
       values ($1,$2,$3,$4,$5)`,
      [seed.projectId, seed.organizationId, seed.userId, seed.policyId,
        `Finalization project ${suffix}`]
    );
    await client.query(
      `insert into ss.stripe_customers
         (id, organization_id, stripe_customer_id)
       values ($1,$2,$3)`,
      [seed.customerRowId, seed.organizationId, seed.stripeCustomerId]
    );
    await client.query(
      `insert into ss.alakazam_subscriptions (
         id, organization_id, project_id, customer_user_id,
         stripe_customer_row_id, stripe_subscription_id,
         stripe_subscription_item_id, stripe_price_id, initial_quote_id,
         activation_receipt_id, tier_id, status, currency, amount_minor,
         current_period_starts_at, current_period_ends_at,
         provider_observed_at, provider_facts_digest
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         'alakazam_25','active','USD',2500,$11,$12,$13,$14
       )`, [
        seed.subscriptionId, seed.organizationId, seed.projectId, seed.userId,
        seed.customerRowId, seed.stripeSubscriptionId,
        `si_finalization_${suffix}`, `price_finalization_${suffix}`,
        seed.initialQuoteId, seed.activationReceiptId,
        "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z",
        "2026-08-01T00:00:01.000Z", "a".repeat(64)
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return seed;
}

function ids() {
  return { next: () => randomUUID() };
}

function service(repository, provider) {
  return createAlakazamInvoiceFinalizationService({
    repository,
    provider,
    clock: { now: () => new Date().toISOString() },
    ids: ids(),
    release: createAlakazamBillingRelease({
      approved: true,
      taxMode: "disabled_by_owner"
    })
  });
}

test("fresh PostgreSQL holds, replays, recovers, isolates tenants, and cleans up finalization state", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  try {
    const first = await seedSubscription(pool, "one");
    const second = await seedSubscription(pool, "two");
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresAlakazamInvoiceFinalizationRepository({ authority });
    assert.equal((await repository.readiness()).ready, true);

    let currentReadback = readback(first);
    let providerReads = 0;
    const runtime = service(repository, {
      async readiness() {
        return {
          ready: true, provider: "stripe", alakazam: true, livemode: false,
          taxModes: { alakazam: "disabled_by_owner" }
        };
      },
      async retrieveAlakazamFinalizationInvoice(input) {
        providerReads += 1;
        assert.deepEqual(input, {
          stripeInvoiceId: first.invoiceId,
          stripeSubscriptionId: first.stripeSubscriptionId,
          stripeCustomerId: first.stripeCustomerId
        });
        return structuredClone(currentReadback);
      }
    });
    const failedEvent = event({
      id: "evt_finalization_failure_one",
      invoiceId: first.invoiceId,
      subscriptionId: first.stripeSubscriptionId
    });
    const failed = await runtime.ingestStripeEvent(failedEvent);
    assert.equal(failed.state, "failed");
    assert.equal(failed.renewalHeld, true);
    assert.equal(failed.fulfillmentHeld, true);
    const replay = await runtime.ingestStripeEvent(failedEvent);
    assert.deepEqual(replay, failed);
    assert.equal(providerReads, 1);

    const stored = await pool.query(
      `select state, renewal_held, fulfillment_held,
              provider_effects_authorized, revision
         from ss.alakazam_invoice_finalization_projection
        where subscription_id = $1`, [first.subscriptionId]
    );
    assert.deepEqual(stored.rows[0], {
      state: "failed",
      renewal_held: true,
      fulfillment_held: true,
      provider_effects_authorized: false,
      revision: "1"
    });

    await assert.rejects(
      pool.query(
        `insert into ss.alakazam_renewal_settlements
           (organization_id, project_id, subscription_id)
         values ($1,$2,$3)`,
        [first.organizationId, first.projectId, first.subscriptionId]
      ),
      (error) => error.code === "23514" &&
        /finalization hold prevents/u.test(error.message)
    );

    const fulfillmentId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local session_replication_role = replica");
      await client.query(
        `insert into ss.alakazam_fulfillment_operations (
           id, organization_id, project_id, customer_user_id, intent_id,
           subscription_id, subscription_revision, operation_kind, capability,
           effective_tier_id, policy_schema, policy_digest, state, queued_at
         ) values (
           $1,$2,$3,$4,$5,$6,1,'start_activation',
           'publish_accepted_project_version','alakazam_25',
           'sitesourcery.alakazam-effective-policy/v1',$7,'queued',$8
         )`, [
          fulfillmentId, first.organizationId, first.projectId, first.userId,
          randomUUID(), first.subscriptionId, "b".repeat(64), new Date().toISOString()
        ]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await assert.rejects(
      pool.query(
        `update ss.alakazam_fulfillment_operations
            set state = 'processing'
          where id = $1`, [fulfillmentId]
      ),
      (error) => error.code === "23514" &&
        /finalization hold prevents/u.test(error.message)
    );

    // A different organization's subscription cannot be rebound through the
    // first Invoice/Customer readback.
    const wrong = service(repository, {
      async readiness() {
        return {
          ready: true, provider: "stripe", alakazam: true, livemode: false,
          taxModes: { alakazam: "disabled_by_owner" }
        };
      },
      async retrieveAlakazamFinalizationInvoice() {
        return structuredClone(readback(first));
      }
    });
    await assert.rejects(
      wrong.ingestStripeEvent(event({
        id: "evt_finalization_cross_org",
        invoiceId: second.invoiceId,
        subscriptionId: second.stripeSubscriptionId
      })),
      (error) => error.code === "stripe_alakazam_finalization_mismatch"
    );

    currentReadback = readback(first, {
      status: "paid", finalizationState: "recovered", reasonCode: null,
      providerObservedAt: new Date(Date.now() + 1000).toISOString()
    });
    const paidEvent = event({
      id: "evt_finalization_paid_one", type: "invoice.paid",
      invoiceId: first.invoiceId, subscriptionId: first.stripeSubscriptionId
    });
    const recovered = await runtime.ingestStripeEvent(paidEvent);
    assert.equal(recovered.state, "recovered");
    assert.equal(recovered.next, "continue");
    assert.equal(recovered.renewalHeld, false);

    // Late failure delivery consults current provider state and cannot reopen.
    const late = await runtime.ingestStripeEvent(event({
      id: "evt_finalization_late_failure", type: "invoice.finalization_failed",
      invoiceId: first.invoiceId, subscriptionId: first.stripeSubscriptionId
    }));
    assert.equal(late.state, "recovered");
    assert.equal(late.fulfillmentHeld, false);

    const historicalReplay = await runtime.ingestStripeEvent(failedEvent);
    assert.deepEqual(historicalReplay, failed);
    assert.equal(providerReads, 3);

    const finalProjection = await pool.query(
      `select state, renewal_held, fulfillment_held, revision,
              (select count(*) from ss.alakazam_invoice_finalization_observations
                where subscription_id = $1) as observation_count
         from ss.alakazam_invoice_finalization_projection
        where subscription_id = $1`, [first.subscriptionId]
    );
    assert.deepEqual(finalProjection.rows[0], {
      state: "recovered",
      renewal_held: false,
      fulfillment_held: false,
      revision: "3",
      observation_count: "3"
    });

    const contract = await pool.query(`select
      ss.hosted_alakazam_finalization_contract_v1() =
        'canonical-alakazam-finalization-v1-provider-readback-held' as contract_ready,
      (select bool_and(relrowsecurity and relforcerowsecurity)
         from pg_class where oid = any(array[
           'ss.alakazam_invoice_finalization_observations'::regclass,
           'ss.alakazam_invoice_finalization_projection'::regclass
         ])) as forced_rls,
      not has_table_privilege('authenticated',
        'ss.alakazam_invoice_finalization_projection','SELECT') as customer_direct_denied,
      not has_table_privilege('service_role',
        'ss.alakazam_invoice_finalization_observations','UPDATE,DELETE') as evidence_mutation_denied`);
    for (const [name, value] of Object.entries(contract.rows[0])) {
      assert.equal(value, true, `finalization PostgreSQL contract failed: ${name}`);
    }

    await assert.rejects(
      pool.query("delete from ss.alakazam_subscriptions where id = $1", [first.subscriptionId]),
      (error) => error.code === "42501"
    );
    const purgeClient = await pool.connect();
    try {
      await purgeClient.query("begin");
      await purgeClient.query("set local session_replication_role = replica");
      await purgeClient.query(
        `insert into ss.deletion_requests (
           id, organization_id, project_id, requested_by_user_id,
           policy_version, state, sealed_at, removal_counts
         ) values ($1,$2,$3,$4,'test-terminal-purge','purging',$5,'{}'::jsonb)`,
        [randomUUID(), first.organizationId, first.projectId, first.userId,
          new Date().toISOString()]
      );
      await purgeClient.query("set local session_replication_role = origin");
      await purgeClient.query(
        "select set_config('app.terminal_purge_project_id', $1, true)",
        [first.projectId]
      );
      await purgeClient.query(
        "delete from ss.alakazam_subscriptions where id = $1",
        [first.subscriptionId]
      );
      await purgeClient.query("commit");
    } catch (error) {
      await purgeClient.query("rollback");
      throw error;
    } finally {
      purgeClient.release();
    }
    const cleanup = await pool.query(`select
      not exists (select 1 from ss.alakazam_invoice_finalization_observations
        where subscription_id = $1) as observations_removed,
      not exists (select 1 from ss.alakazam_invoice_finalization_projection
        where subscription_id = $1) as projection_removed,
      not exists (select 1 from ss.alakazam_fulfillment_operations
        where subscription_id = $1) as fulfillment_removed`, [first.subscriptionId]);
    assert.deepEqual(cleanup.rows[0], {
      observations_removed: true,
      projection_removed: true,
      fulfillment_removed: true
    });
  } finally {
    await pool.end();
  }
});
