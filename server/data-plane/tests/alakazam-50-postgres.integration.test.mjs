import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createAlakazam50Service
} from "../../commerce-v2/alakazam-50.mjs";
import {
  resolveAlakazamTier
} from "../../commerce-v2/alakazam.mjs";
import { digest } from "../../commerce-v2/canonical.mjs";
import {
  createAlakazam50Compiler
} from "../../hosted/alakazam-50-compiler.mjs";
import {
  createPostgresAlakazam50Repository
} from "../../hosted/alakazam-50-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_50_TEST_URL ?? null;
const NOW = "2026-08-09T12:00:00.000Z";

async function seed(pool) {
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
      [ids.userId, `f04-${ids.userId}@example.test`]
    );
    await client.query(
      `insert into ss.billing_policies (
         id, policy_key, grace_period, retention_period, effective_at
       ) values ($1, $2, interval '14 days', interval '90 days', $3)`,
      [ids.billingPolicyId, `f04-${ids.billingPolicyId}`, NOW]
    );
    await client.query(
      `insert into ss.organizations (id, created_by_user_id, name)
       values ($1, $2, 'F04 PostgreSQL Journey')`,
      [ids.organizationId, ids.userId]
    );
    await client.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', $3)`,
      [ids.organizationId, ids.userId, NOW]
    );
    await client.query(
      `insert into ss.projects (
         id, organization_id, created_by_user_id,
         billing_policy_id, name
       ) values ($1, $2, $3, $4, 'F04 Project')`,
      [ids.projectId, ids.organizationId, ids.userId, ids.billingPolicyId]
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
        `sub_f04_${ids.subscriptionId.replaceAll("-", "")}`,
        `si_f04_${ids.subscriptionId.replaceAll("-", "")}`,
        "price_f04_alakazam_50_test",
        randomUUID(),
        randomUUID(),
        "2026-08-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
        "a".repeat(64)
      ]
    );
    await client.query("commit");
    return ids;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
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

function baseCompiler(policyDigest) {
  const html = [
    "<!doctype html><html><head><style>body{color:black}</style></head><body>",
    '<nav aria-label="Page"><a href="#about">About</a><a href="#contact">Contact</a></nav>',
    '<section class="section about" id="about"><div class="wrap">About</div></section>',
    '<section class="section contact" id="contact"><div class="wrap"><div class="actions">Contact</div></div></section>',
    "</body></html>"
  ].join("");
  const htmlBytes = Buffer.from(html);
  return {
    compileAlakazam() {
      return {
        schema: "abracadabra.spark/v1",
        fulfillmentSchema: "abracadabra.alakazam-35/v1",
        compilerRevision: `sha256:${"b".repeat(64)}`,
        policyDigest,
        artifactDigest: createHash("sha256").update(htmlBytes).digest("hex"),
        artifactSetDigest: "c".repeat(64),
        effectiveFacts: { theme: "clear" },
        html,
        htmlBytes,
        assets: []
      };
    }
  };
}

test(
  "F04 PostgreSQL journey stores exact held $50 authority and compiles premium output",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
    try {
      const ids = await seed(pool);
      const repository = createPostgresAlakazam50Repository({
        authority: authority(pool)
      });
      const service = createAlakazam50Service({
        repository,
        clock: { now: () => NOW }
      });
      const scope = {
        tenantId: ids.organizationId,
        projectId: ids.projectId,
        customerId: ids.userId,
        actorId: ids.userId
      };
      assert.deepEqual(await service.readiness(), {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held",
        runtimeContract: "canonical-alakazam-50-held-v1"
      });

      const configurationCommandId = randomUUID();
      let snapshot = await service.configure(scope, {
        commandId: configurationCommandId,
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
      assert.equal(snapshot.configuration.configurationRevision, 1);
      assert.equal(snapshot.configuration.subscriptionRevision, 7);
      assert.equal(snapshot.configuration.fontChoiceId, "studio");
      assert.equal(snapshot.providerEffects, false);

      const binding = await repository.readCompilationBinding({
        ...scope,
        expectedSubscriptionRevision: 7
      });
      assert.equal(
        binding.configuration.configurationDigest,
        snapshot.configuration.configurationDigest
      );
      assert.equal(binding.configuration.projectId, ids.projectId);
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          binding.configuration,
          "expectedSubscriptionRevision"
        ),
        false
      );

      const tier = resolveAlakazamTier("alakazam_50");
      const policy = {
        schema: "sitesourcery.alakazam-effective-policy/v1",
        catalogVersion: "alakazam.2026-08-02.v1",
        tierId: tier.tierId,
        capabilities: tier.capabilities,
        limits: tier.limits
      };
      const policyDigest = digest(policy);
      const compiler = createAlakazam50Compiler({
        baseCompiler: baseCompiler(policyDigest)
      });
      const compiled = compiler.compile({
        authority: {
          subscriptionId: ids.subscriptionId,
          subscriptionRevision: 7,
          policy,
          policyDigest
        },
        configuredFacts: { theme: "clear" },
        configuration: binding.configuration
      });
      assert.match(compiled.html, /Cash App \$cedar\.shop/u);
      assert.match(compiled.html, /Venmo @cedar_shop/u);
      assert.match(compiled.html, /Avenir Next/u);
      assert.match(compiled.html, /--radius:0/u);
      assert.match(compiled.html, /Pay Cedar/u);

      const careCommandId = randomUUID();
      snapshot = await service.requestCare(scope, {
        commandId: careCommandId,
        message: "Please review the premium menu before the next accepted version."
      });
      assert.equal(snapshot.care.requestCount, 1);
      assert.equal(snapshot.care.lastRequestedAt, NOW);

      const replay = await service.configure(scope, {
        commandId: configurationCommandId,
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
      assert.equal(replay.configuration.configurationRevision, 1);

      const counts = await pool.query(
        `select
           (select count(*) from ss.alakazam_50_configurations
             where organization_id = $1 and project_id = $2) as configurations,
           (select count(*) from ss.alakazam_50_care_requests
             where organization_id = $1 and project_id = $2) as care_requests`,
        [ids.organizationId, ids.projectId]
      );
      assert.deepEqual(counts.rows[0], {
        configurations: "1",
        care_requests: "1"
      });

      await assert.rejects(
        pool.query(
          `update ss.alakazam_50_configurations
              set border_choice_id = 'ornate'
            where organization_id = $1 and id = $2`,
          [ids.organizationId, configurationCommandId]
        ),
        /immutable/u
      );

      const rogue = await pool.connect();
      try {
        await rogue.query("begin");
        await rogue.query("set constraints all deferred");
        await rogue.query(
          `insert into ss.alakazam_50_care_requests (
             id, organization_id, project_id, customer_user_id,
             subscription_id, subscription_revision, care_class,
             request_message, request_digest, requested_at
           ) values ($1, $2, $3, $4, $5, 999, 'more',
             'Rogue stale authority', $6, $7)`,
          [
            randomUUID(),
            ids.organizationId,
            ids.projectId,
            ids.userId,
            ids.subscriptionId,
            "f".repeat(64),
            NOW
          ]
        );
        await assert.rejects(
          rogue.query("set constraints all immediate"),
          /exact active subscription authority/u
        );
        await rogue.query("rollback");
      } finally {
        rogue.release();
      }

      const denied = await pool.connect();
      try {
        await denied.query("set role authenticated");
        await assert.rejects(
          denied.query("select * from ss.alakazam_50_configurations"),
          /permission denied/u
        );
        await denied.query("reset role");
      } finally {
        denied.release();
      }
    } finally {
      await pool.end();
    }
  }
);
