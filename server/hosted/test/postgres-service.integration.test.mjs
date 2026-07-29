import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import pg from "pg";

import { createFakeApprovedCatalog } from "../../commerce/adapters/fake.mjs";
import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import { createAesGcmContactVault } from "../production-ports.mjs";
import {
  createDevelopmentRecoveryMailSink,
  createProductionRecoveryMailPort
} from "../recovery-mail-port.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";
import { createSparkCompilerPort } from "../spark-compiler-port.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_SERVICE_TEST_URL ?? null;
const NOW = "2026-07-28T20:00:00.000Z";
const MIGRATIONS = new URL(
  "../../data-plane/supabase/migrations/",
  import.meta.url
);

async function migrateEmptyDatabase(pool) {
  const existing = await pool.query(
    "select to_regnamespace('ss') is not null as migrated"
  );
  if (existing.rows[0].migrated) return;
  const names = (await readdir(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    await pool.query(await readFile(new URL(name, MIGRATIONS), "utf8"));
  }
}

async function seedCommercialAuthority(pool, catalog) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const kind of ["product", "privacy", "website"]) {
      await client.query(
        `insert into ss.legal_documents (
           id, kind, version, content_digest, content_uri, effective_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          kind,
          `${kind}.2026-test`,
          "a".repeat(64),
          `https://sitesourcery.test/legal/${kind}`,
          "2026-01-01T00:00:00.000Z"
        ]
      );
    }
    await client.query(
      `insert into ss.billing_policies (
         id, policy_key, grace_period, retention_period, effective_at
       ) values (
         $1, 'hosted.2026-test', interval '14 days',
         interval '90 days', '2026-01-01T00:00:00.000Z'
       )`,
      [randomUUID()]
    );
    for (const offer of catalog.offers) {
      const planId = randomUUID();
      await client.query(
        `insert into ss.catalog_plans (
           id, plan_key, catalog_version, display_name, active_from
         ) values ($1, $2, $3, $4, $5)`,
        [
          planId,
          offer.offerId,
          catalog.catalogVersion,
          offer.offerId,
          "2026-01-01T00:00:00.000Z"
        ]
      );
      const priceLines = [];
      for (const [component, cadence] of [
        ["oneTime", "one_time"],
        ["recurring", offer.amounts.recurring?.interval]
      ]) {
        if (!offer.amounts[component]) continue;
        const priceId = randomUUID();
        await client.query(
          `insert into ss.catalog_prices (
             id, plan_id, currency, unit_amount_minor, cadence,
             approved_at, active_from
           ) values ($1, $2, $3, $4, $5, $6, $6)`,
          [
            priceId,
            planId,
            offer.amounts[component].currency,
            offer.amounts[component].amountMinor,
            cadence,
            "2026-01-01T00:00:00.000Z"
          ]
        );
        priceLines.push({
          component:
            component === "oneTime" ? "one_time" : "recurring",
          priceId,
          stripePriceRef: offer.stripePriceRefs[component]
        });
      }
      const policyId = randomUUID();
      await client.query(
        `insert into ss.catalog_offer_policies (
           id, offer_key, catalog_version, plan_id, price_id,
           product_id, tenure_id, terms_version,
           eligible_address_modes, disclosure_snapshot, active_from
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9::text[], $10::jsonb, $11
         )`,
        [
          policyId,
          offer.offerId,
          catalog.catalogVersion,
          planId,
          priceLines[0].priceId,
          offer.productId,
          offer.tenureId,
          catalog.termsVersion,
          offer.eligibleAddressModes,
          JSON.stringify({ offer }),
          "2026-01-01T00:00:00.000Z"
        ]
      );
      for (const line of priceLines) {
        await client.query(
          `insert into ss.catalog_offer_price_lines (
             id, offer_policy_id, component, catalog_price_id,
             stripe_price_ref
           ) values ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            policyId,
            line.component,
            line.priceId,
            line.stripePriceRef
          ]
        );
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function seedPaidSubscription(
  authority,
  organizationId,
  projectId,
  offerId
) {
  await authority.service({}, async (client) => {
    const price = await client.query(
      `select
         price.id,
         price.currency,
         price.unit_amount_minor,
         line.stripe_price_ref,
         project.billing_policy_id
       from ss.catalog_offer_policies policy
       join ss.catalog_offer_price_lines line
         on line.offer_policy_id = policy.id
        and line.component = 'recurring'
       join ss.catalog_prices price
         on price.id = line.catalog_price_id
       join ss.projects project on project.id = $2
      where policy.offer_key = $1`,
      [offerId, projectId]
    );
    const customerId = randomUUID();
    await client.query(
      `insert into ss.stripe_customers (
         id, organization_id, stripe_customer_id
       ) values ($1, $2, $3)`,
      [customerId, organizationId, `cus_test_${randomUUID()}`]
    );
    await client.query(
      `insert into ss.stripe_subscriptions (
         id, organization_id, project_id, stripe_customer_row_id,
         stripe_subscription_id, stripe_price_id, catalog_price_id,
         billing_policy_id, status, currency, amount_minor,
         current_period_ends_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         'active', $9, $10, $11
       )`,
      [
        randomUUID(),
        organizationId,
        projectId,
        customerId,
        `sub_test_${randomUUID()}`,
        price.rows[0].stripe_price_ref,
        price.rows[0].id,
        price.rows[0].billing_policy_id,
        price.rows[0].currency,
        Number(price.rows[0].unit_amount_minor),
        "2026-08-28T20:00:00.000Z"
      ]
    );
  });
}

function createFinalizationCommitFaultAuthority(authority) {
  let armed = false;
  let failureCount = 0;
  return {
    kind: "canonical-postgres",
    readiness() {
      return authority.readiness();
    },
    service(options, work) {
      return authority.service(options, async (client) => {
        let completedRelease = false;
        const interceptedClient = {
          async query(statement, values) {
            const sql =
              typeof statement === "string"
                ? statement
                : statement?.text ?? "";
            const result = await client.query(
              statement,
              values
            );
            if (sql.includes("ss.complete_release")) {
              completedRelease = true;
            }
            return result;
          }
        };
        const result = await work(interceptedClient);
        if (armed && completedRelease) {
          armed = false;
          failureCount += 1;
          const error = new Error(
            "Injected publication finalization commit failure."
          );
          error.code = "40001";
          throw error;
        }
        return result;
      });
    },
    failNextFinalizationCommit() {
      armed = true;
    },
    failureCount() {
      return failureCount;
    }
  };
}

test(
  "canonical PostgreSQL service completes the owned customer path",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    await migrateEmptyDatabase(pool);
    const authority = createCanonicalPostgresAuthority({ pool });
    assert.equal((await authority.assertReady()).ready, true);
    const catalog = createFakeApprovedCatalog();
    await seedCommercialAuthority(pool, catalog);
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sitesourcery-pg-service-")
    );
    const clock = { now: () => NOW };
    const identity = createPostgresIdentityBridge({
      pool,
      authority,
      pepper: randomBytes(32),
      pepperVersion: "test-v1",
      clock: () => new Date(NOW),
      rateLimit: {
        attempts: 2,
        windowMs: 15 * 60 * 1000,
        blockMs: 15 * 60 * 1000
      }
    });
    const compiler = await createSparkCompilerPort();
    const tenantRuntime = await SelfHostRuntime.open({
      root: path.join(root, "tenant"),
      publicationHeld: false,
      platformBaseDomain: "sites.sitesourcery.me",
      clock: () => NOW
    });
    const exportStore = await createPrivateExportObjectStore({
      root: path.join(root, "exports")
    });
    const recoverySink = createDevelopmentRecoveryMailSink({
      recoveryBaseUrl:
        "https://staging.sitesourcery.test/abracadabra/app/",
      clock
    });
    const serviceAuthority =
      createFinalizationCommitFaultAuthority(authority);
    const serviceOptions = {
      authority: serviceAuthority,
      identity,
      compiler,
      catalogPort: {
        async current() {
          return structuredClone(catalog);
        }
      },
      publicationPort: createSelfHostPublicationPort({
        runtime: tenantRuntime,
        clock
      }),
      exportStore,
      contactVault: createAesGcmContactVault({
        key: randomBytes(32),
        keyVersion: "test-v1"
      }),
      clock
    };
    const service = createCanonicalPostgresService({
      ...serviceOptions,
      recoveryMailPort: recoverySink
    });

    const registered = await service.register({
      name: "Test Owner",
      organizationName: "Test Organization",
      email: `owner-${randomUUID()}@example.test`,
      password: "correct horse battery staple"
    });
    const actor = await service.authenticate(
      registered.sessionToken
    );
    const recoveryResponse = await service.requestRecovery({
      email: registered.user.email,
      commandId: "recovery-request-001"
    });
    assert.deepEqual(recoveryResponse, {
      accepted: true,
      delivery: "manual_operator",
      emailSent: false
    });
    assert.doesNotMatch(
      JSON.stringify(recoveryResponse),
      /recovery=/iu
    );
    const recoveryMessages = recoverySink.readForTest(
      registered.user.email
    );
    assert.equal(recoveryMessages.length, 1);
    const recoveryUrl = new URL(
      recoveryMessages[0].recoveryUrl
    );
    assert.match(
      recoveryUrl.hash,
      /^#recovery=.{32,}$/u
    );
    assert.equal(
      recoveryMessages[0].expiresAt,
      "2026-07-28T20:30:00.000Z"
    );
    assert.deepEqual(
      await service.requestRecovery({
        email: registered.user.email,
        commandId: "recovery-request-001"
      }),
      recoveryResponse
    );
    assert.equal(
      recoverySink.readForTest(registered.user.email).length,
      1
    );
    const productionSends = [];
    const verifiedRecoveryService =
      createCanonicalPostgresService({
        ...serviceOptions,
        recoveryMailPort: createProductionRecoveryMailPort({
          clock,
          transport: {
            async readiness() {
              return {
                ready: true,
                verified: true,
                provider: "integration-mail"
              };
            },
            async sendRecovery(input) {
              productionSends.push(input);
              return {
                accepted: true,
                provider: "integration-mail",
                providerMessageId: "message_integration_1",
                idempotencyKey: input.idempotencyKey,
                payloadDigest: input.payloadDigest,
                acceptedAt: NOW
              };
            }
          }
        })
      });
    const emailRecovery =
      await verifiedRecoveryService.requestRecovery({
        email: registered.user.email,
        commandId: "recovery-request-002"
      });
    assert.deepEqual(emailRecovery, {
      accepted: true,
      delivery: "email",
      emailSent: true
    });
    assert.doesNotMatch(
      JSON.stringify(emailRecovery),
      /owner-|recovery=/iu
    );
    assert.equal(productionSends.length, 1);
    assert.match(
      productionSends[0].recoveryUrl,
      /^https:\/\/sitesourcery\.com\/abracadabra\/app\/#recovery=/u
    );
    assert.deepEqual(
      await verifiedRecoveryService.requestRecovery({
        email: registered.user.email,
        commandId: "recovery-request-002"
      }),
      emailRecovery
    );
    assert.equal(productionSends.length, 1);
    for (const commandId of [
      "unknown-recovery-001",
      "unknown-recovery-002"
    ]) {
      assert.deepEqual(
        await service.requestRecovery({
          email: "unknown-owner@example.test",
          commandId
        }),
        {
          accepted: true,
          delivery: "manual_operator",
          emailSent: false
        }
      );
    }
    await assert.rejects(
      service.requestRecovery({
        email: "unknown-owner@example.test",
        commandId: "unknown-recovery-003"
      }),
      (error) =>
        error?.code === "RECOVERY_RATE_LIMITED" &&
        error?.status === 429
    );
    const organizationId = registered.organization.id;
    const created = await service.createProject(
      actor,
      organizationId,
      {
        name: "Cedar Workshop",
        acceptedTerms: true,
        visibility: "public",
        address: { kind: "licensed", label: "cedar-workshop" },
        commandId: "project-create-0001"
      }
    );
    const projectId = created.project.id;
    const rawFacts = {
      schema: "abracadabra.spark/v1",
      theme: "warm",
      businessName: "Cedar Workshop",
      summary: "Careful repairs and custom woodwork.",
      about: "Local craft, clear estimates, and dependable work.",
      offerings: ["Furniture repair", "Custom shelving"],
      location: "Richmond, Virginia",
      hours: "Monday through Friday, 9–5",
      phone: "(804) 555-0100",
      email: "hello@cedar.example",
      website: "",
      primaryAction: "phone"
    };
    await service.saveDraft(actor, projectId, {
      rawFacts,
      expectedRevision: 1,
      commandId: "draft-save-000001"
    });
    const compiled = compiler.compile(rawFacts);
    const version = await service.createVersion(actor, projectId, {
      rawFacts,
      previewDigest: compiled.artifactDigest,
      reviewAttested: true,
      commandId: "version-create-001"
    });
    await service.markVersionReady(
      actor,
      projectId,
      version.version.id,
      { commandId: "version-ready-0001" }
    );
    await service.acceptVersion(
      actor,
      projectId,
      version.version.id,
      { commandId: "version-accept-001" }
    );
    await service.createSupportTicket(actor, projectId, {
      subject: "Launch question",
      message: "Please confirm the launch address.",
      commandId: "support-ticket-001"
    });
    const rent = catalog.offers.find(
      (offer) => offer.tenureId === "rent"
    );
    const quote = await service.createCommerceQuote(
      actor,
      projectId,
      {
        offerId: rent.offerId,
        commandId: "commerce-quote-001"
      }
    );
    assert.equal(quote.quote.offerId, rent.offerId);
    assert.equal(quote.quote.totals.recurring.length, 1);

    const requestedExport = await service.requestExport(
      actor,
      projectId,
      { commandId: "export-request-001" }
    );
    const readyExport = await service.processExport(
      requestedExport.export.exportId
    );
    assert.equal(readyExport.export.status, "ready");
    const exportWithGrant = await service.getExport(
      actor,
      projectId,
      requestedExport.export.exportId
    );
    const downloaded = await service.downloadExport(
      actor,
      projectId,
      requestedExport.export.exportId,
      exportWithGrant.export.download.token
    );
    assert.equal(downloaded.contentType, "application/zip");
    assert.ok(downloaded.bytes.byteLength > compiled.htmlBytes.byteLength);
    await assert.rejects(
      service.downloadExport(
        actor,
        projectId,
        requestedExport.export.exportId,
        exportWithGrant.export.download.token
      ),
      (error) => error?.code === "DOWNLOAD_AUTHORIZATION_INVALID"
    );

    await seedPaidSubscription(
      authority,
      organizationId,
      projectId,
      rent.offerId
    );
    serviceAuthority.failNextFinalizationCommit();
    await assert.rejects(
      service.requestRelease(
        actor,
        projectId,
        {
          versionId: version.version.id,
          commandId: "release-request-001"
        }
      ),
      (error) => error?.code === "WRITE_CONFLICT"
    );
    assert.equal(serviceAuthority.failureCount(), 1);
    assert.equal(
      (
        await tenantRuntime.fetch(
          new Request(
            "https://cedar-workshop.sites.sitesourcery.me/",
            {
              headers: {
                host: "cedar-workshop.sites.sitesourcery.me"
              }
            }
          )
        )
      ).status,
      404
    );
    const released = await service.requestRelease(
      actor,
      projectId,
      {
        versionId: version.version.id,
        commandId: "release-request-001"
      }
    );
    assert.equal(released.project.serving.state, "live");
    const tenantResponse = await tenantRuntime.fetch(
      new Request("https://cedar-workshop.sites.sitesourcery.me/", {
        headers: {
          host: "cedar-workshop.sites.sitesourcery.me"
        }
      })
    );
    assert.equal(tenantResponse.status, 200);
    assert.deepEqual(
      Buffer.from(await tenantResponse.arrayBuffer()),
      compiled.htmlBytes
    );
    await service.unpublish(actor, projectId, {
      commandId: "release-unpublish-01"
    });
    assert.equal(
      (
        await tenantRuntime.fetch(
          new Request(
            "https://cedar-workshop.sites.sitesourcery.me/",
            {
              headers: {
                host: "cedar-workshop.sites.sitesourcery.me"
              }
            }
          )
        )
      ).status,
      404
    );
    const deleted = await service.deleteProject(actor, projectId, {
      commandId: "project-delete-0001"
    });
    assert.equal(deleted.state, "completed");
    assert.equal(deleted.deleted, true);
    await authority.close();
  }
);
