import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_CARE_LIFECYCLE_POLICY_ID
} from "../../commerce-v2/alakazam-care-lifecycle-policy.mjs";
import {
  createAlakazam50Service
} from "../../commerce-v2/alakazam-50.mjs";
import {
  createAlakazamRetainedPremiumService
} from "../../commerce-v2/alakazam-retained-premium.mjs";
import {
  createPostgresAlakazam50Repository
} from "../../hosted/alakazam-50-postgres.mjs";
import {
  createPostgresAlakazamRetainedPremiumRepository
} from "../../hosted/alakazam-retained-premium-postgres.mjs";
import {
  createAlakazamRetainedPremiumLifecycle
} from "../../hosted/alakazam-retained-premium-lifecycle.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_RETAINED_PREMIUM_TEST_URL ?? null;
const DAY_MS = 24 * 60 * 60 * 1000;

function offsetIso(from, milliseconds) {
  return new Date(Date.parse(from) + milliseconds).toISOString();
}

function authority(pool) {
  return {
    async service(_context, work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set constraints all deferred");
        const result = await work(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function seedProject(pool, suffix) {
  const now = new Date().toISOString();
  const ids = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID(),
    subscriptionId: randomUUID()
  };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [ids.userId, `f06-${suffix}-${ids.userId}@example.test`]
    );
    await client.query(
      `insert into ss.billing_policies (
         id, policy_key, grace_period, retention_period, effective_at
       ) values ($1, $2, interval '14 days', interval '90 days', $3)`,
      [ids.billingPolicyId, `f06-${suffix}-${ids.billingPolicyId}`, now]
    );
    await client.query(
      `insert into ss.organizations (id, created_by_user_id, name)
       values ($1, $2, $3)`,
      [ids.organizationId, ids.userId, `F06 ${suffix}`]
    );
    await client.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', $3)`,
      [ids.organizationId, ids.userId, now]
    );
    await client.query(
      `insert into ss.projects (
         id, organization_id, created_by_user_id,
         billing_policy_id, name
       ) values ($1, $2, $3, $4, $5)`,
      [
        ids.projectId,
        ids.organizationId,
        ids.userId,
        ids.billingPolicyId,
        `F06 ${suffix} project`
      ]
    );
    await client.query(
      `insert into ss.alakazam_subscriptions (
         id, organization_id, project_id, customer_user_id,
         stripe_customer_row_id, stripe_subscription_id,
         stripe_subscription_item_id, stripe_price_id,
         initial_quote_id, activation_receipt_id, tier_id, status,
         currency, amount_minor, current_period_starts_at,
         current_period_ends_at, provider_observed_at,
         provider_facts_digest, revision
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         'alakazam_50', 'active', 'USD', 5000, $11, $12,
         $11, $13, 7
       )`,
      [
        ids.subscriptionId,
        ids.organizationId,
        ids.projectId,
        ids.userId,
        randomUUID(),
        `sub_f06_${suffix}_${ids.subscriptionId.replaceAll("-", "")}`,
        `si_f06_${suffix}_${ids.subscriptionId.replaceAll("-", "")}`,
        `price_f06_${suffix}_50`,
        randomUUID(),
        randomUUID(),
        offsetIso(now, -DAY_MS),
        offsetIso(now, 30 * DAY_MS),
        "a".repeat(64)
      ]
    );
    await client.query("commit");
    return { ...ids, seededAt: now };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function scope(ids) {
  return {
    tenantId: ids.organizationId,
    projectId: ids.projectId,
    customerId: ids.userId,
    actorId: ids.userId
  };
}

async function forceTierTransition(pool, ids, {
  revision,
  tierId,
  status = "active",
  eventKind,
  priorTierId,
  providerFactsDigest,
  providerObservedAt,
  firstFailedAt = null,
  graceEndsAt = null
}) {
  const eventId = randomUUID();
  const stripeEventRowId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `update ss.alakazam_subscriptions
          set tier_id = $2,
              status = $3,
              amount_minor = case $2
                when 'alakazam_25' then 2500
                when 'alakazam_35' then 3500
                else 5000
              end,
              stripe_price_id = $4,
              revision = $5,
              provider_facts_digest = $6,
              provider_observed_at = $7::timestamptz,
              first_failed_at = $8::timestamptz,
              grace_ends_at = $9::timestamptz,
              cancel_at_period_end = false,
              suspended_at = case
                when $3 = 'suspended' then $7::timestamptz
                else null
              end
        where id = $1`,
      [
        ids.subscriptionId,
        tierId,
        status,
        `price_f06_${tierId}`,
        revision,
        providerFactsDigest,
        providerObservedAt,
        firstFailedAt,
        graceEndsAt
      ]
    );
    if (eventKind !== null) {
      await client.query(
        `insert into ss.alakazam_stripe_events (
           id, organization_id, project_id, subscription_id,
           stripe_event_id, event_type, livemode, api_version,
           provider_object_id, payload_digest, facts, state,
           attempt_count, signature_verified_at, occurred_at,
           processed_at
         ) values (
           $1, $2, $3, $4, $5, $6, false, '2026-06-30.basil',
           $7, $8, $9::jsonb, 'processed', 1, $10, $10, $10
         )`,
        [
          stripeEventRowId,
          ids.organizationId,
          ids.projectId,
          ids.subscriptionId,
          `evt_f06_${stripeEventRowId.replaceAll("-", "")}`,
          eventKind === "suspended"
            ? "invoice.payment_failed"
            : "customer.subscription.updated",
          `sub_f06_${ids.subscriptionId.replaceAll("-", "")}`,
          providerFactsDigest,
          JSON.stringify({
            invoiceProviderFactsDigest: providerFactsDigest
          }),
          providerObservedAt
        ]
      );
      await client.query(
        `insert into ss.alakazam_tier_change_events (
           id, organization_id, project_id, subscription_id,
           quote_id, stripe_event_row_id, payment_receipt_id,
           result_subscription_revision, event_kind,
           prior_tier_id, result_tier_id, occurred_at,
           facts, facts_digest
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, '{}'::jsonb, $13
         )`,
        [
          eventId,
          ids.organizationId,
          ids.projectId,
          ids.subscriptionId,
          eventKind === "suspended" ? null : randomUUID(),
          stripeEventRowId,
          eventKind === "suspended" ? null : randomUUID(),
          revision,
          eventKind,
          priorTierId,
          tierId,
          providerObservedAt,
          eventKind === "downgrade_applied"
            ? "b".repeat(64)
            : eventKind === "upgrade_applied"
              ? "c".repeat(64)
              : "d".repeat(64)
        ]
      );
    }
    await client.query("commit");
    return eventId;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

test(
  "F06 PostgreSQL journey masks downgrade, restores exact re-upgrade, and purges only after retained exit",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
    try {
      const ids = await seedProject(pool, "journey");
      const database = authority(pool);
      const f50 = createAlakazam50Service({
        repository: createPostgresAlakazam50Repository({ authority: database }),
        clock: { now: () => ids.seededAt }
      });
      const retainedRepository =
        createPostgresAlakazamRetainedPremiumRepository({
          authority: database
        });
      let observedAt = ids.seededAt;
      const retained = createAlakazamRetainedPremiumService({
        repository: retainedRepository,
        clock: { now: () => observedAt }
      });
      const lifecycle = createAlakazamRetainedPremiumLifecycle({
        repository: retainedRepository,
        clock: { now: () => observedAt },
        workerId: "f06-postgres-lifecycle-proof"
      });
      const selectedScope = scope(ids);

      assert.deepEqual(await retained.readiness(), {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held",
        runtimeContract:
          "canonical-alakazam-retained-premium-held-v1"
      });
      const configured = await f50.configure(selectedScope, {
        commandId: randomUUID(),
        expectedCurrentRevision: 0,
        cashAppHandle: "cedar.shop",
        venmoHandle: "cedar_shop",
        fontChoiceId: "studio",
        borderChoiceId: "sharp",
        menu: [
          { target: "contact", label: "Pay Cedar" },
          { target: "about", label: "Our story" }
        ]
      });
      const sourceDigest = configured.configuration.configurationDigest;

      await forceTierTransition(pool, ids, {
        revision: 8,
        tierId: "alakazam_35",
        eventKind: "downgrade_applied",
        priorTierId: "alakazam_50",
        providerFactsDigest: "b".repeat(64),
        providerObservedAt: offsetIso(ids.seededAt, 60_000)
      });
      let snapshot = await retained.read(selectedScope);
      assert.equal(snapshot.premium.configured, true);
      assert.equal(snapshot.premium.values, null);
      assert.equal(snapshot.premium.effectiveOutput, "masked");
      assert.equal(snapshot.actions.edit, false);
      const exported = await retained.exportConfiguration(selectedScope);
      assert.equal(exported.configuration.cashAppHandle, "cedar.shop");
      assert.equal(JSON.stringify(exported).includes("subscriptionId"), false);

      await forceTierTransition(pool, ids, {
        revision: 9,
        tierId: "alakazam_50",
        eventKind: "upgrade_applied",
        priorTierId: "alakazam_35",
        providerFactsDigest: "c".repeat(64),
        providerObservedAt: offsetIso(ids.seededAt, 120_000)
      });
      observedAt = offsetIso(ids.seededAt, 180_000);
      snapshot = await retained.read(selectedScope);
      assert.equal(snapshot.restoration.required, true);
      assert.equal(snapshot.restoration.available, true);
      assert.equal(snapshot.actions.edit, false);
      const restoreCommandId = randomUUID();
      snapshot = await retained.restore(selectedScope, {
        commandId: restoreCommandId,
        expectedSourceConfigurationDigest: sourceDigest,
        expectedSubscriptionRevision: 9
      });
      assert.equal(snapshot.restoration.required, false);
      assert.equal(snapshot.actions.edit, true);
      assert.equal(snapshot.premium.values.cashAppHandle, "cedar.shop");

      const current = Date.now();
      const firstFailedAt = new Date(current - 38 * DAY_MS).toISOString();
      const graceEndsAt = new Date(current - 31 * DAY_MS).toISOString();
      await forceTierTransition(pool, ids, {
        revision: 10,
        tierId: "alakazam_50",
        status: "grace",
        eventKind: null,
        priorTierId: null,
        providerFactsDigest: "d".repeat(64),
        providerObservedAt: offsetIso(firstFailedAt, 60_000),
        firstFailedAt,
        graceEndsAt
      });
      observedAt = offsetIso(firstFailedAt, DAY_MS);
      snapshot = await retained.read(selectedScope);
      assert.equal(snapshot.lifecycle.state, "payment_grace");
      assert.equal(snapshot.actions.edit, false);
      assert.equal(snapshot.actions.publish, false);
      assert.equal(snapshot.actions.care, false);
      await assert.rejects(
        f50.configure(selectedScope, {
          commandId: randomUUID(),
          expectedCurrentRevision: 2,
          cashAppHandle: "changed",
          venmoHandle: "changed",
          fontChoiceId: "studio",
          borderChoiceId: "sharp",
          menu: [{ target: "contact", label: "Changed" }]
        }),
        { code: "alakazam_50_authority_required", status: 409 }
      );
      await assert.rejects(
        retainedRepository.purgeExpired({
          tenantId: ids.organizationId,
          projectId: ids.projectId,
          subscriptionId: ids.subscriptionId,
          receiptId: randomUUID(),
          observedAt: graceEndsAt
        }),
        { code: "repository_conflict", status: 500 }
      );
      const stillRetainedAtGraceExpiry = await pool.query(
        `select count(*)::int as configuration_count
           from ss.alakazam_50_configurations
          where project_id = $1`,
        [ids.projectId]
      );
      assert.equal(
        stillRetainedAtGraceExpiry.rows[0].configuration_count,
        2
      );

      await forceTierTransition(pool, ids, {
        revision: 11,
        tierId: "alakazam_50",
        status: "suspended",
        eventKind: "suspended",
        priorTierId: "alakazam_50",
        providerFactsDigest: "e".repeat(64),
        providerObservedAt: new Date(current - 30 * DAY_MS).toISOString(),
        firstFailedAt,
        graceEndsAt
      });
      const policyAppliedAt = new Date(current - 30 * DAY_MS).toISOString();
      observedAt = policyAppliedAt;
      const graceWorkerResult =
        await lifecycle.runGraceDeadlineOnce();
      assert.equal(
        graceWorkerResult.status,
        "retained_exit_applied"
      );
      assert.equal(
        graceWorkerResult.source,
        "payment_grace_expired"
      );
      assert.equal(
        graceWorkerResult.window.id,
        graceWorkerResult.windowId
      );
      assert.equal(
        graceWorkerResult.window.source_kind,
        "payment_grace_expired"
      );
      assert.equal(
        graceWorkerResult.window.policy_id,
        ALAKAZAM_CARE_LIFECYCLE_POLICY_ID
      );
      observedAt = offsetIso(graceEndsAt, DAY_MS);
      snapshot = await retained.read(selectedScope);
      assert.equal(snapshot.lifecycle.state, "retained_exit");
      assert.equal(snapshot.premium.values.cashAppHandle, "cedar.shop");
      assert.equal(snapshot.actions.edit, false);
      assert.equal(snapshot.actions.export, true);

      observedAt = new Date().toISOString();
      const retentionWorkerResult =
        await lifecycle.runRetentionExpiryOnce();
      assert.equal(
        retentionWorkerResult.status,
        "retained_exit_purged"
      );
      assert.equal(
        retentionWorkerResult.source,
        "retained_exit_expiry"
      );
      assert.equal(
        retentionWorkerResult.receipt.id,
        retentionWorkerResult.receiptId
      );
      assert.equal(
        retentionWorkerResult.receipt.reason,
        "retained_exit_expiry"
      );
      assert.equal(
        Number(retentionWorkerResult.receipt.configuration_count),
        2
      );
      assert.equal(
        Number(retentionWorkerResult.receipt.restoration_count),
        1
      );
      const absence = await pool.query(
        `select
           not exists (
             select 1 from ss.alakazam_50_configurations
              where project_id = $1
           ) as configurations_absent,
           not exists (
             select 1 from ss.alakazam_50_premium_restorations
              where project_id = $1
           ) as restorations_absent,
           exists (
             select 1 from ss.alakazam_premium_purge_receipts
              where project_id = $1
                and reason = 'retained_exit_expiry'
           ) as receipt_present`,
        [ids.projectId]
      );
      assert.deepEqual(absence.rows[0], {
        configurations_absent: true,
        restorations_absent: true,
        receipt_present: true
      });
      snapshot = await retained.read(selectedScope);
      assert.equal(snapshot.lifecycle.state, "purged");
      assert.equal(snapshot.premium.configured, false);
      assert.equal(snapshot.actions.restore, false);
    } finally {
      await pool.end();
    }
  }
);

test(
  "F06 cancellation hook waits for effective confirmation and export evidence",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
    try {
      const ids = await seedProject(pool, "cancellation");
      const database = authority(pool);
      const f50 = createAlakazam50Service({
        repository: createPostgresAlakazam50Repository({ authority: database }),
        clock: { now: () => ids.seededAt }
      });
      await f50.configure(scope(ids), {
        commandId: randomUUID(),
        expectedCurrentRevision: 0,
        cashAppHandle: "cancelled.shop",
        venmoHandle: "cancelled_shop",
        fontChoiceId: "studio",
        borderChoiceId: "sharp",
        menu: [{ target: "contact", label: "Export" }]
      });

      const cancellationId = randomUUID();
      const exportGrantId = randomUUID();
      const stripeEventRowId = randomUUID();
      const tierEventId = randomUUID();
      const now = new Date();
      const effectiveAt = new Date(now.getTime() - 60_000).toISOString();
      const requestedAt = new Date(now.getTime() - 120_000).toISOString();
      const observedAt = now.toISOString();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local session_replication_role = replica");
        await client.query(
          `insert into ss.alakazam_stripe_events (
             id, organization_id, project_id, subscription_id,
             stripe_event_id, event_type, livemode, api_version,
             provider_object_id, payload_digest, facts, state,
             attempt_count, signature_verified_at, occurred_at,
             processed_at
           ) values (
             $1, $2, $3, $4, $5,
             'customer.subscription.deleted', false,
             '2026-06-30.basil', $6, $7, '{}'::jsonb,
             'processed', 1, $8, $8, $8
           )`,
          [
            stripeEventRowId,
            ids.organizationId,
            ids.projectId,
            ids.subscriptionId,
            `evt_f06_cancel_${stripeEventRowId.replaceAll("-", "")}`,
            `sub_f06_cancel_${ids.subscriptionId.replaceAll("-", "")}`,
            "f".repeat(64),
            observedAt
          ]
        );
        await client.query(
          `insert into ss.alakazam_tier_change_events (
             id, organization_id, project_id, subscription_id,
             stripe_event_row_id, result_subscription_revision,
             event_kind, prior_tier_id, result_tier_id,
             occurred_at, facts, facts_digest
           ) values (
             $1, $2, $3, $4, $5, 8, 'ended',
             'alakazam_50', 'alakazam_50', $6, '{}'::jsonb, $7
           )`,
          [
            tierEventId,
            ids.organizationId,
            ids.projectId,
            ids.subscriptionId,
            stripeEventRowId,
            observedAt,
            "e".repeat(64)
          ]
        );
        await client.query(
          `update ss.alakazam_subscriptions
              set status = 'ended', revision = 8,
                  current_period_ends_at = $2,
                  cancel_at_period_end = true,
                  ended_at = $2,
                  provider_observed_at = $3,
                  provider_facts_digest = $4
            where id = $1`,
          [ids.subscriptionId, effectiveAt, observedAt, "f".repeat(64)]
        );
        await client.query(
          `insert into ss.alakazam_cancellations (
             id, organization_id, project_id, subscription_id,
             customer_user_id, requested_by_user_id,
             accepted_disclosure_digest, provider_idempotency_key,
             subscription_revision_at_request, effective_at, state,
             provider_effect_certainty, stripe_event_row_id,
             tier_change_event_id, provider_facts,
             provider_facts_digest, provider_observed_at,
             requested_at, scheduled_at, effective_confirmed_at
           ) values (
             $1, $2, $3, $4, $5, $5, $6, $7, 7, $8,
             'effective', 'confirmed', $9, $10, '{}'::jsonb,
             $11, $12, $13, $13, $12
           )`,
          [
            cancellationId,
            ids.organizationId,
            ids.projectId,
            ids.subscriptionId,
            ids.userId,
            "d".repeat(64),
            `f06-cancel-${cancellationId}`,
            effectiveAt,
            stripeEventRowId,
            tierEventId,
            "f".repeat(64),
            observedAt,
            requestedAt
          ]
        );
        await client.query(
          `insert into ss.alakazam_export_grants (
             id, organization_id, project_id, subscription_id,
             cancellation_id, state, available_from,
             paid_through_at, retention_state
           ) values (
             $1, $2, $3, $4, $5, 'available', $6, $7,
             'policy_decision_required'
           )`,
          [
            exportGrantId,
            ids.organizationId,
            ids.projectId,
            ids.subscriptionId,
            cancellationId,
            requestedAt,
            effectiveAt
          ]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      const retainedRepository =
        createPostgresAlakazamRetainedPremiumRepository({
          authority: database
        });
      const lifecycle = createAlakazamRetainedPremiumLifecycle({
        repository: retainedRepository,
        clock: { now: () => observedAt },
        workerId: "f06-postgres-cancellation-proof"
      });
      const result = await lifecycle.applyCancellationConfirmation({
        tenantId: ids.organizationId,
        projectId: ids.projectId,
        subscriptionId: ids.subscriptionId
      });
      assert.equal(result.source, "period_end_cancellation");
      assert.deepEqual(result.exportEvidence, {
        cancellationId,
        exportGrantId,
        paidThroughAt: effectiveAt,
        providerFactsDigest: "f".repeat(64),
        providerObservedAt: observedAt
      });
      const evidence = await pool.query(
        `select source_kind, source_event_id, export_grant_id,
                starts_at, ends_at, state
           from ss.alakazam_premium_retention_windows
          where id = $1`,
        [result.windowId]
      );
      assert.equal(evidence.rowCount, 1);
      assert.deepEqual(
        {
          ...evidence.rows[0],
          starts_at: evidence.rows[0].starts_at.toISOString(),
          ends_at: evidence.rows[0].ends_at.toISOString()
        },
        {
          source_kind: "period_end_cancellation",
          source_event_id: tierEventId,
          export_grant_id: exportGrantId,
          starts_at: effectiveAt,
          ends_at: offsetIso(effectiveAt, 30 * DAY_MS),
          state: "active"
        }
      );
    } finally {
      await pool.end();
    }
  }
);

test(
  "F06 terminal customer deletion purges premium configuration and cannot restore",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
    try {
      const ids = await seedProject(pool, "terminal");
      const database = authority(pool);
      const f50 = createAlakazam50Service({
        repository: createPostgresAlakazam50Repository({ authority: database }),
        clock: { now: () => ids.seededAt }
      });
      const retainedRepository =
        createPostgresAlakazamRetainedPremiumRepository({ authority: database });
      const retained = createAlakazamRetainedPremiumService({
        repository: retainedRepository,
        clock: { now: () => new Date().toISOString() }
      });
      const selectedScope = scope(ids);
      const configured = await f50.configure(selectedScope, {
        commandId: randomUUID(),
        expectedCurrentRevision: 0,
        cashAppHandle: "terminal.shop",
        venmoHandle: null,
        fontChoiceId: "editorial",
        borderChoiceId: "soft",
        menu: [{ target: "contact", label: "Contact" }]
      });
      await pool.query(
        "select ss.begin_terminal_project_purge($1, $2, $3)",
        [
          ids.projectId,
          ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
          ids.userId
        ]
      );
      const proof = await pool.query(
        `select
           (select lifecycle from ss.projects where id = $1) = 'deleting'
             as project_sealed,
           not exists (
             select 1 from ss.alakazam_50_configurations
              where project_id = $1
           ) as configuration_absent,
           exists (
             select 1 from ss.alakazam_premium_purge_receipts
              where project_id = $1
                and reason = 'terminal_customer_deletion'
           ) as terminal_receipt`,
        [ids.projectId]
      );
      assert.deepEqual(proof.rows[0], {
        project_sealed: true,
        configuration_absent: true,
        terminal_receipt: true
      });
      await assert.rejects(
        retained.restore(selectedScope, {
          commandId: randomUUID(),
          expectedSourceConfigurationDigest:
            configured.configuration.configurationDigest,
          expectedSubscriptionRevision: 7
        }),
        { code: "project_unavailable", status: 404 }
      );
    } finally {
      await pool.end();
    }
  }
);
