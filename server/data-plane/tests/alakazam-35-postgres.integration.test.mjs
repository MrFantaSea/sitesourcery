import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_35_PHOTO_SCHEMA,
  createAlakazam35Service
} from "../../commerce-v2/alakazam-35.mjs";
import {
  resolveAlakazamTier
} from "../../commerce-v2/alakazam.mjs";
import {
  digest
} from "../../commerce-v2/canonical.mjs";
import {
  createAlakazam35Compiler
} from "../../hosted/alakazam-35-compiler.mjs";
import {
  createPostgresAlakazam35Repository
} from "../../hosted/alakazam-35-postgres.mjs";
import { createSparkCompilerPort } from "../../hosted/spark-compiler-port.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_35_TEST_URL ?? null;
const NOW = "2026-08-08T12:00:00.000Z";

function pngBase64() {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(1280, 16);
  bytes.writeUInt32BE(640, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes.toString("base64");
}

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
      [ids.userId, `f03-${ids.userId}@example.test`]
    );
    await client.query(
      `insert into ss.billing_policies (
         id, policy_key, grace_period, retention_period, effective_at
       ) values ($1, $2, interval '14 days', interval '90 days', $3)`,
      [ids.billingPolicyId, `f03-${ids.billingPolicyId}`, NOW]
    );
    await client.query(
      `insert into ss.organizations (id, created_by_user_id, name)
       values ($1, $2, 'F03 PostgreSQL Journey')`,
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
       ) values ($1, $2, $3, $4, 'F03 Project')`,
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
         'alakazam_35', 'active', 'USD', 3500, $11, $12,
         $11, $13, 3
       )`,
      [
        ids.subscriptionId,
        ids.organizationId,
        ids.projectId,
        ids.userId,
        randomUUID(),
        `sub_f03_${ids.subscriptionId.replaceAll("-", "")}`,
        `si_f03_${ids.subscriptionId.replaceAll("-", "")}`,
        "price_f03_alakazam_35",
        randomUUID(),
        randomUUID(),
        "2026-08-01T00:00:00.000Z",
        "2026-09-01T00:00:00.000Z",
        "a".repeat(64)
      ]
    );
    for (let versionNumber = 1; versionNumber <= 4; versionNumber += 1) {
      const artifact = await client.query(
        `insert into ss.artifacts (
           id, organization_id, project_id, html_bytes, created_at
         ) values ($1, $2, $3, $4, $5)
         returning id, artifact_digest`,
        [
          randomUUID(),
          ids.organizationId,
          ids.projectId,
          Buffer.from(
            `<html><body>F03 accepted version ${versionNumber}${".".repeat(80)}</body></html>`
          ),
          `2026-08-0${versionNumber}T12:00:00.000Z`
        ]
      );
      const versionId = randomUUID();
      await client.query(
        `insert into ss.site_versions (
           id, organization_id, project_id, version_number,
           fact_set_id, artifact_id, raw_facts, compiler_schema,
           compiler_revision, created_by_user_id, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, '{}'::jsonb,
           'abracadabra.spark/v1', 'sha256:${"b".repeat(64)}', $7, $8
         )`,
        [
          versionId,
          ids.organizationId,
          ids.projectId,
          versionNumber,
          randomUUID(),
          artifact.rows[0].id,
          ids.userId,
          `2026-08-0${versionNumber}T12:00:00.000Z`
        ]
      );
      await client.query(
        `insert into ss.version_state_projection (
           organization_id, project_id, version_id, state,
           last_event_id, updated_at
         ) values ($1, $2, $3, 'accepted_release', $4, $5)`,
        [
          ids.organizationId,
          ids.projectId,
          versionId,
          randomUUID(),
          `2026-08-0${versionNumber}T12:00:00.000Z`
        ]
      );
    }
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

test(
  "F03 PostgreSQL journey stores immutable held fulfillment and projects only three accepted versions",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
    try {
      const ids = await seed(pool);
      const repository = createPostgresAlakazam35Repository({
        authority: authority(pool)
      });
      const service = createAlakazam35Service({
        repository,
        clock: { now: () => NOW }
      });
      const scope = {
        tenantId: ids.organizationId,
        projectId: ids.projectId,
        customerId: ids.userId,
        actorId: ids.userId
      };

      const readiness = await service.readiness();
      assert.deepEqual(readiness, {
        ready: true,
        authorization: true,
        providerEffects: false,
        state: "held",
        runtimeContract: "canonical-alakazam-35-held-v1"
      });

      const photoCommandId = randomUUID();
      let snapshot = await service.uploadPhoto(scope, {
        commandId: photoCommandId,
        mediaType: "image/png",
        mediaBase64: pngBase64()
      });
      assert.equal(snapshot.controls.photoHeader.photo.assetId, photoCommandId);
      assert.equal(snapshot.controls.photoHeader.photo.width, 1280);
      assert.equal(snapshot.history.length, 3);
      assert.deepEqual(snapshot.history.map((entry) => entry.versionNumber), [4, 3, 2]);
      assert.equal(snapshot.history[0].isCurrent, true);

      const configurationCommandId = randomUUID();
      snapshot = await service.configure(scope, {
        commandId: configurationCommandId,
        expectedCurrentRevision: 0,
        fontChoiceId: "alt",
        photoAssetId: photoCommandId,
        sections: {
          about: true,
          offerings: false,
          practical: true,
          contact: false
        }
      });
      assert.equal(snapshot.configuration.configurationRevision, 1);
      assert.equal(snapshot.configuration.fontChoiceId, "alt");
      assert.equal(snapshot.configuration.photo.assetId, photoCommandId);
      assert.equal(snapshot.configuration.sections.offerings, false);

      const careCommandId = randomUUID();
      snapshot = await service.requestCare(scope, {
        commandId: careCommandId,
        message: "Please review the seasonal hours before the next accepted version."
      });
      assert.equal(snapshot.care.requestCount, 1);
      assert.equal(snapshot.care.lastRequestedAt, NOW);
      assert.equal(snapshot.providerEffects, false);

      const storedMedia = await pool.query(
        `select media_bytes from ss.alakazam_35_photo_assets
          where organization_id = $1 and id = $2`,
        [ids.organizationId, photoCommandId]
      );
      const tier = resolveAlakazamTier("alakazam_35");
      const policy = {
        schema: "sitesourcery.alakazam-effective-policy/v1",
        catalogVersion: "alakazam.2026-08-02.v1",
        tierId: tier.tierId,
        capabilities: tier.capabilities,
        limits: tier.limits
      };
      const compiler = createAlakazam35Compiler({
        baseCompiler: await createSparkCompilerPort()
      });
      const compiled = compiler.compile({
        authority: { policy, policyDigest: digest(policy) },
        configuredFacts: {
          theme: "clear",
          businessName: "F03 PostgreSQL Journey",
          summary: "A real held Alakazam $35 artifact.",
          about: "This remains visible.",
          offerings: ["This must be toggled away"],
          location: "Camden, New Jersey",
          hours: "Weekdays",
          phone: "856-555-0123",
          email: "hello@example.test",
          website: "",
          primaryAction: "phone"
        },
        configuration: snapshot.configuration,
        mediaAsset: {
          schema: ALAKAZAM_35_PHOTO_SCHEMA,
          ...snapshot.configuration.photo,
          mediaBytes: Buffer.from(storedMedia.rows[0].media_bytes),
          state: "held",
          holdReason: "commercial_cutover_not_authorized"
        }
      });
      assert.equal(compiled.assets.length, 1);
      assert.match(compiled.html, /class="alakazam-photo"/u);
      assert.doesNotMatch(compiled.html, /id="offerings"/u);
      assert.doesNotMatch(compiled.html, /id="contact"/u);
      assert.match(compiled.html, /font-family:Georgia/u);

      const replay = await service.configure(scope, {
        commandId: configurationCommandId,
        expectedCurrentRevision: 0,
        fontChoiceId: "alt",
        photoAssetId: photoCommandId,
        sections: {
          about: true,
          offerings: false,
          practical: true,
          contact: false
        }
      });
      assert.equal(replay.configuration.configurationRevision, 1);

      const counts = await pool.query(
        `select
           (select count(*) from ss.site_versions
             where organization_id = $1 and project_id = $2) as internal_versions,
           (select count(*) from ss.alakazam_35_photo_assets
             where organization_id = $1 and project_id = $2) as photos,
           (select count(*) from ss.alakazam_35_configurations
             where organization_id = $1 and project_id = $2) as configurations,
           (select count(*) from ss.alakazam_35_care_requests
             where organization_id = $1 and project_id = $2) as care_requests`,
        [ids.organizationId, ids.projectId]
      );
      assert.deepEqual(counts.rows[0], {
        internal_versions: "4",
        photos: "1",
        configurations: "1",
        care_requests: "1"
      });

      await assert.rejects(
        pool.query(
          `update ss.alakazam_35_configurations
              set font_choice_id = 'standard'
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
          `insert into ss.alakazam_35_care_requests (
             id, organization_id, project_id, customer_user_id,
             subscription_id, subscription_revision, care_class,
             request_message, request_digest, requested_at
           ) values ($1, $2, $3, $4, $5, 999, 'modest',
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
          denied.query("select * from ss.alakazam_35_configurations"),
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
