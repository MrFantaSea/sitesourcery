import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
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
import {
  createDevelopmentRegistrationMailSink
} from "../registration-mail-port.mjs";
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(
    (resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    }
  );
  return { promise, resolve, reject };
}

function createContractPaymentProvider() {
  const calls = {
    checkout: [],
    portal: [],
    cancellation: [],
    webhook: []
  };
  let checkoutSequence = 0;
  let portalSequence = 0;
  let cancellationFailure = null;
  return {
    calls,
    failNextCancellation(error) {
      cancellationFailure = error;
    },
    port: Object.freeze({
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          mode: "contract_test",
          livemode: false
        };
      },
      async createCheckout(input) {
        calls.checkout.push(structuredClone(input));
        checkoutSequence += 1;
        return {
          checkoutId:
            `cs_test_hosted_${checkoutSequence}`,
          url:
            `https://checkout.stripe.com/c/pay/cs_test_hosted_${checkoutSequence}`,
          expiresAt:
            "2026-07-28T20:30:00.000Z"
        };
      },
      async createBillingPortal(input) {
        calls.portal.push(structuredClone(input));
        portalSequence += 1;
        return {
          portalSessionId:
            `bps_test_hosted_${portalSequence}`,
          url:
            `https://billing.stripe.com/p/session/bps_test_hosted_${portalSequence}`
        };
      },
      async scheduleCancellation(input) {
        calls.cancellation.push(
          structuredClone(input)
        );
        if (cancellationFailure) {
          const failure = cancellationFailure;
          cancellationFailure = null;
          throw failure;
        }
        return {
          subscriptionId:
            input.stripeSubscriptionId,
          providerStatus: "active",
          cancelAtPeriodEnd: true,
          effectiveAt:
            "2026-08-28T20:00:00.000Z"
        };
      },
      async verifyWebhook({
        rawBody,
        signature
      }) {
        calls.webhook.push({
          rawBody: Buffer.from(rawBody),
          signature
        });
        assert.equal(
          signature,
          "contract-signature-valid"
        );
        return JSON.parse(
          Buffer.from(rawBody).toString("utf8")
        );
      }
    })
  };
}

function stripeEvent(id, type, object) {
  return {
    id,
    type,
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.parse(NOW) / 1000),
    data: { object }
  };
}

function rawEvent(event) {
  return Buffer.from(JSON.stringify(event), "utf8");
}

async function migrateEmptyDatabase(
  pool,
  { beforeMigration = null } = {}
) {
  const existing = await pool.query(
    "select to_regnamespace('ss') is not null as migrated"
  );
  if (existing.rows[0].migrated) return;
  const names = (await readdir(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    if (beforeMigration) {
      await beforeMigration(name, pool);
    }
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
  async (t) => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const legacyExport = Object.freeze({
      userId: "10000000-0000-4000-8000-000000000001",
      organizationId:
        "10000000-0000-4000-8000-000000000002",
      billingPolicyId:
        "10000000-0000-4000-8000-000000000003",
      projectId:
        "10000000-0000-4000-8000-000000000004",
      exportId:
        "10000000-0000-4000-8000-000000000005"
    });
    await migrateEmptyDatabase(pool, {
      async beforeMigration(name, migrationPool) {
        if (
          name !==
          "202607280015_export_worker_fencing.sql"
        ) {
          return;
        }
        const migrationClient =
          await migrationPool.connect();
        try {
          await migrationClient.query("begin");
          await migrationClient.query(
            `insert into auth.users (
               id, email
             ) values ($1, $2)`,
            [
              legacyExport.userId,
              "legacy-export-proof@example.test"
            ]
          );
          await migrationClient.query(
            `insert into ss.billing_policies (
               id,
               policy_key,
               grace_period,
               retention_period,
               effective_at
             ) values (
               $1,
               'legacy-export-proof',
               interval '14 days',
               interval '90 days',
               $2
             )`,
            [legacyExport.billingPolicyId, NOW]
          );
          await migrationClient.query(
            `insert into ss.organizations (
               id, created_by_user_id, name
             ) values ($1, $2, 'Legacy Export Proof')`,
            [
              legacyExport.organizationId,
              legacyExport.userId
            ]
          );
          await migrationClient.query(
            `insert into ss.organization_memberships (
               organization_id,
               user_id,
               role,
               state,
               accepted_at
             ) values ($1, $2, 'owner', 'active', $3)`,
            [
              legacyExport.organizationId,
              legacyExport.userId,
              NOW
            ]
          );
          await migrationClient.query(
            `insert into ss.projects (
               id,
               organization_id,
               created_by_user_id,
               billing_policy_id,
               name
             ) values ($1, $2, $3, $4, $5)`,
            [
              legacyExport.projectId,
              legacyExport.organizationId,
              legacyExport.userId,
              legacyExport.billingPolicyId,
              "Legacy Export Project"
            ]
          );
          await migrationClient.query(
            `insert into ss.export_requests (
               id,
               organization_id,
               project_id,
               requested_by_user_id,
               state,
               requested_at
             ) values ($1, $2, $3, $4, 'building', $5)`,
            [
              legacyExport.exportId,
              legacyExport.organizationId,
              legacyExport.projectId,
              legacyExport.userId,
              NOW
            ]
          );
          await migrationClient.query("commit");
        } catch (error) {
          await migrationClient.query("rollback");
          throw error;
        } finally {
          migrationClient.release();
        }
      }
    });
    const authority = createCanonicalPostgresAuthority({ pool });
    assert.equal((await authority.assertReady()).ready, true);
    const recoveredLegacy = (
      await pool.query(
        `select *
           from ss.export_requests
          where id = $1`,
        [legacyExport.exportId]
      )
    ).rows[0];
    assert.equal(recoveredLegacy.state, "failed");
    assert.equal(recoveredLegacy.attempt_number, "1");
    assert.equal(recoveredLegacy.fence_token, "1");
    assert.equal(recoveredLegacy.worker_id, null);
    assert.equal(recoveredLegacy.object_key, null);
    assert.equal(
      recoveredLegacy.failure_code,
      "EXPORT_LEGACY_BUILD_ORPHANED"
    );
    assert.deepEqual(recoveredLegacy.failure_facts, {
      phase: "migration",
      certainty: "ambiguous",
      objectKey:
        `exports/${legacyExport.organizationId}/` +
        `${legacyExport.projectId}/${legacyExport.exportId}.zip`,
      recovery: "manual_retry_required"
    });
    const catalog = createFakeApprovedCatalog();
    await seedCommercialAuthority(pool, catalog);
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sitesourcery-pg-service-")
    );
    const clock = { now: () => NOW };
    const registrationSink =
      createDevelopmentRegistrationMailSink({
        registrationBaseUrl:
          "https://staging.sitesourcery.test/abracadabra/app/",
        clock
      });
    const identity = createPostgresIdentityBridge({
      pool,
      authority,
      pepper: randomBytes(32),
      pepperVersion: "test-v1",
      clock: () => new Date(NOW),
      registrationMailPort: registrationSink,
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
    const payment = createContractPaymentProvider();
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
      paymentProvider: payment.port,
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

    const ownerEmail =
      `owner-${randomUUID()}@example.test`;
    const ownerRegistration = await service.register({
      name: "Test Owner",
      organizationName: "Test Organization",
      email: ownerEmail,
      password: "correct horse battery staple",
      commandId: "registration-owner-001"
    });
    assert.equal(ownerRegistration.emailSent, true);
    assert.deepEqual(
      (
        await pool.query(
          `select
             (select count(*)::integer
                from auth.users
               where lower(email) = $1) as users,
             (select count(*)::integer
                from ss.organizations organization
                join auth.users users
                  on users.id =
                     organization.created_by_user_id
               where lower(users.email) = $1)
               as organizations,
             (select count(*)::integer
                from ss.hosted_sessions session
                join auth.users users
                  on users.id = session.user_id
               where lower(users.email) = $1)
               as sessions`,
          [ownerEmail]
        )
      ).rows[0],
      {
        users: 0,
        organizations: 0,
        sessions: 0
      }
    );
    const ownerToken = decodeURIComponent(
      new URL(
        registrationSink.readForTest(ownerEmail)[0]
          .verificationUrl
      ).hash.slice("#verify-registration=".length)
    );
    const registered =
      await service.completeRegistration({
        token: ownerToken,
        commandId:
          "registration-activation-owner-001"
      });
    assert.equal(registered.replayed, false);
    assert.equal(
      (
        await service.completeRegistration({
          token: ownerToken,
          commandId:
            "registration-activation-owner-001"
        })
      ).replayed,
      true
    );
    await assert.rejects(
      service.completeRegistration({
        token: ownerToken,
        commandId:
          "registration-activation-owner-foreign"
      }),
      (error) =>
        error?.code ===
        "REGISTRATION_ALREADY_COMPLETED"
    );
    const actor = await service.authenticate(
      registered.sessionToken
    );
    const otherEmail =
      `other-owner-${randomUUID()}@example.test`;
    await service.register({
      name: "Other Owner",
      organizationName: "Other Organization",
      email: otherEmail,
      password:
        "another correct horse battery staple",
      commandId: "registration-other-owner-001"
    });
    const otherToken = decodeURIComponent(
      new URL(
        registrationSink.readForTest(otherEmail)[0]
          .verificationUrl
      ).hash.slice("#verify-registration=".length)
    );
    const otherRegistered =
      await service.completeRegistration({
        token: otherToken,
        commandId:
          "registration-activation-other-owner-001"
      });
    const otherActor = await service.authenticate(
      otherRegistered.sessionToken
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
    await assert.rejects(
      service.getCommerceQuote(
        otherActor,
        projectId,
        quote.quote.quoteId
      ),
      (error) =>
        error?.code === "NOT_FOUND" &&
        error?.status === 404
    );
    await assert.rejects(
      service.createCheckout(
        otherActor,
        projectId,
        {
          quoteId: quote.quote.quoteId,
          acceptedDisclosureDigest:
            quote.quote.disclosureDigest,
          commandId:
            "cross-tenant-checkout-0001"
        }
      ),
      (error) =>
        error?.code === "NOT_FOUND" &&
        error?.status === 404
    );
    assert.equal(payment.calls.checkout.length, 0);

    const checkout = await service.createCheckout(
      actor,
      projectId,
      {
        quoteId: quote.quote.quoteId,
        acceptedDisclosureDigest:
          quote.quote.disclosureDigest,
        commandId: "checkout-create-0001"
      }
    );
    assert.equal(
      checkout.url,
      "https://checkout.stripe.com/c/pay/cs_test_hosted_1"
    );
    assert.equal(payment.calls.checkout.length, 1);
    assert.deepEqual(
      await service.createCheckout(actor, projectId, {
        quoteId: quote.quote.quoteId,
        acceptedDisclosureDigest:
          quote.quote.disclosureDigest,
        commandId: "checkout-create-0001"
      }),
      checkout
    );
    assert.equal(payment.calls.checkout.length, 1);
    const checkoutPurpose =
      payment.calls.checkout[0].purpose;
    const checkoutMetadata = {
      schema: "sitesourcery_checkout_v1",
      tenant_id: checkoutPurpose.tenantId,
      customer_id: checkoutPurpose.customerId,
      project_id: checkoutPurpose.projectId,
      quote_id: checkoutPurpose.quoteId,
      quote_version: String(
        checkoutPurpose.quoteVersion
      ),
      catalog_version:
        checkoutPurpose.catalogVersion,
      offer_id: checkoutPurpose.offerId,
      disclosure_digest:
        checkoutPurpose.disclosureDigest,
      purpose_digest:
        payment.calls.checkout[0]
          .purposeDigest
    };
    const stripeCustomerId =
      "cus_test_hosted_customer_1";
    const stripeSubscriptionId =
      "sub_test_hosted_subscription_1";
    const checkoutPaid = stripeEvent(
      "evt_test_checkout_paid_1",
      "checkout.session.completed",
      {
        id: "cs_test_hosted_1",
        client_reference_id:
          quote.quote.quoteId,
        metadata: checkoutMetadata,
        payment_status: "paid",
        amount_total:
          rent.amounts.recurring.amountMinor,
        currency: "usd",
        customer: stripeCustomerId,
        subscription: stripeSubscriptionId,
        payment_intent: null,
        invoice: "in_test_initial_invoice_1"
      }
    );
    const settledCheckout =
      await service.ingestStripeWebhook({
        rawBody: rawEvent(checkoutPaid),
        signature: "contract-signature-valid"
      });
    assert.equal(
      settledCheckout.status,
      "processed"
    );
    assert.equal(
      (
        await service.ingestStripeWebhook({
          rawBody: rawEvent(checkoutPaid),
          signature: "contract-signature-valid"
        })
      ).duplicate,
      true
    );
    const subscriptionCreated = stripeEvent(
      "evt_test_subscription_created_1",
      "customer.subscription.created",
      {
        id: stripeSubscriptionId,
        customer: stripeCustomerId,
        status: "active",
        current_period_end: Math.floor(
          Date.parse(
            "2026-08-28T20:00:00.000Z"
          ) / 1000
        ),
        metadata: checkoutMetadata,
        items: {
          data: [
            {
              price: {
                id:
                  rent.stripePriceRefs.recurring,
                unit_amount:
                  rent.amounts.recurring
                    .amountMinor,
                currency: "usd"
              }
            }
          ]
        }
      }
    );
    await service.ingestStripeWebhook({
      rawBody: rawEvent(subscriptionCreated),
      signature: "contract-signature-valid"
    });
    assert.equal(
      (
        await service.getSubscription(
          actor,
          projectId
        )
      ).subscription.status,
      "active"
    );
    const failedInvoice = stripeEvent(
      "evt_test_invoice_failed_1",
      "invoice.payment_failed",
      {
        id: "in_test_failed_invoice_1",
        subscription: stripeSubscriptionId,
        customer: stripeCustomerId,
        amount_due:
          rent.amounts.recurring.amountMinor,
        amount_paid: 0,
        currency: "usd",
        lines: {
          data: [
            {
              period: {
                end: Math.floor(
                  Date.parse(
                    "2026-08-28T20:00:00.000Z"
                  ) / 1000
                )
              }
            }
          ]
        }
      }
    );
    await service.ingestStripeWebhook({
      rawBody: rawEvent(failedInvoice),
      signature: "contract-signature-valid"
    });
    assert.equal(
      (
        await service.getSubscription(
          actor,
          projectId
        )
      ).subscription.status,
      "grace"
    );
    const paidInvoice = stripeEvent(
      "evt_test_invoice_paid_1",
      "invoice.paid",
      {
        id: "in_test_paid_invoice_1",
        subscription: stripeSubscriptionId,
        customer: stripeCustomerId,
        amount_due:
          rent.amounts.recurring.amountMinor,
        amount_paid:
          rent.amounts.recurring.amountMinor,
        currency: "usd",
        lines: failedInvoice.data.object.lines
      }
    );
    await service.ingestStripeWebhook({
      rawBody: rawEvent(paidInvoice),
      signature: "contract-signature-valid"
    });
    assert.equal(
      (
        await service.getSubscription(
          actor,
          projectId
        )
      ).subscription.status,
      "active"
    );
    const portal =
      await service.createBillingPortal(
        actor,
        projectId,
        {
          commandId: "billing-portal-0001"
        }
      );
    assert.equal(
      portal.url,
      "https://billing.stripe.com/p/session/bps_test_hosted_1"
    );
    assert.equal(payment.calls.portal.length, 1);

    const ownedProject =
      await service.createProject(
        actor,
        organizationId,
        {
          name: "Owned Workshop",
          acceptedTerms: true,
          visibility: "public",
          address: {
            kind: "custom",
            path: "connect",
            hostname: "owned-workshop.example"
          },
          commandId: "project-create-owned-0001"
        }
      );
    const ownedProjectId =
      ownedProject.project.id;
    const own = catalog.offers.find(
      (offer) => offer.tenureId === "own"
    );
    const ownQuote =
      await service.createCommerceQuote(
        actor,
        ownedProjectId,
        {
          offerId: own.offerId,
          commandId: "commerce-quote-own-001"
        }
      );
    const ownCheckout =
      await service.createCheckout(
        actor,
        ownedProjectId,
        {
          quoteId: ownQuote.quote.quoteId,
          acceptedDisclosureDigest:
            ownQuote.quote.disclosureDigest,
          commandId: "checkout-own-0001"
        }
      );
    assert.equal(
      ownCheckout.url,
      "https://checkout.stripe.com/c/pay/cs_test_hosted_2"
    );
    const ownPurpose =
      payment.calls.checkout[1].purpose;
    const ownMetadata = {
      schema: "sitesourcery_checkout_v1",
      tenant_id: ownPurpose.tenantId,
      customer_id: ownPurpose.customerId,
      project_id: ownPurpose.projectId,
      quote_id: ownPurpose.quoteId,
      quote_version: String(ownPurpose.quoteVersion),
      catalog_version: ownPurpose.catalogVersion,
      offer_id: ownPurpose.offerId,
      disclosure_digest:
        ownPurpose.disclosureDigest,
      purpose_digest:
        payment.calls.checkout[1].purposeDigest
    };
    await service.ingestStripeWebhook({
      rawBody: rawEvent(
        stripeEvent(
          "evt_test_checkout_owned_paid_1",
          "checkout.session.completed",
          {
            id: "cs_test_hosted_2",
            client_reference_id:
              ownQuote.quote.quoteId,
            metadata: ownMetadata,
            payment_status: "paid",
            amount_total:
              own.amounts.oneTime.amountMinor,
            currency: "usd",
            customer: stripeCustomerId,
            subscription: null,
            payment_intent:
              "pi_test_owned_payment_1",
            invoice: null
          }
        )
      ),
      signature: "contract-signature-valid"
    });
    assert.equal(
      (
        await service.getSubscription(
          actor,
          ownedProjectId
        )
      ).subscription.status,
      "paid"
    );
    assert.equal(
      (
        await authority.service(
          {},
          async (client) =>
            (
              await client.query(
                "select ss.has_current_serving_entitlement($1) as eligible",
                [ownedProjectId]
              )
            ).rows[0].eligible
        )
      ),
      true
    );
    await service.ingestStripeWebhook({
      rawBody: rawEvent(
        stripeEvent(
          "evt_test_owned_refund_1",
          "refund.created",
          {
            id: "re_test_owned_refund_1",
            payment_intent:
              "pi_test_owned_payment_1",
            amount: 1,
            currency: "usd",
            status: "succeeded"
          }
        )
      ),
      signature: "contract-signature-valid"
    });
    assert.equal(
      (
        await service.getSubscription(
          actor,
          ownedProjectId
        )
      ).subscription.status,
      "inactive"
    );
    assert.equal(
      await authority.service(
        {},
        async (client) =>
          (
            await client.query(
              "select ss.has_current_serving_entitlement($1) as eligible",
              [ownedProjectId]
            )
          ).rows[0].eligible
      ),
      false
    );

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
    const exactDownloadFacts = (
      await pool.query(
        `select
           manifest_digest,
           byte_count,
           object_key,
           attempt_number,
           fence_token,
           object_attempt_number,
           object_fence_token
         from ss.export_requests
        where id = $1`,
        [requestedExport.export.exportId]
      )
    ).rows[0];
    assert.equal(
      createHash("sha256")
        .update(downloaded.bytes)
        .digest("hex"),
      exactDownloadFacts.manifest_digest
    );
    assert.equal(
      downloaded.bytes.byteLength,
      Number(exactDownloadFacts.byte_count)
    );
    assert.match(
      exactDownloadFacts.object_key,
      /\/attempt-1-fence-1\.zip$/u
    );
    assert.equal(exactDownloadFacts.attempt_number, "1");
    assert.equal(exactDownloadFacts.fence_token, "1");
    assert.equal(
      exactDownloadFacts.object_attempt_number,
      "1"
    );
    assert.equal(exactDownloadFacts.object_fence_token, "1");
    await assert.rejects(
      service.getExport(
        otherActor,
        projectId,
        requestedExport.export.exportId
      ),
      (error) => error?.code === "NOT_FOUND"
    );
    await assert.rejects(
      service.downloadExport(
        actor,
        projectId,
        requestedExport.export.exportId,
        exportWithGrant.export.download.token
      ),
      (error) => error?.code === "DOWNLOAD_AUTHORIZATION_INVALID"
    );

    const exportService = ({
      store = exportStore,
      selectedClock = clock
    } = {}) =>
      createCanonicalPostgresService({
        ...serviceOptions,
        exportStore: store,
        clock: selectedClock,
        exportLeaseMs: 1_000,
        recoveryMailPort: recoverySink
      });

    await t.test(
      "stale lease recovers a crash before write and fences the late worker",
      async () => {
        const requested = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-crash-before-001" }
        );
        const exportId = requested.export.exportId;
        let selectedNow = NOW;
        const selectedClock = {
          now: () => selectedNow
        };
        const putStarted = deferred();
        const allowLatePut = deferred();
        const blockedStore = Object.freeze({
          ...exportStore,
          async put(input) {
            putStarted.resolve(input);
            await allowLatePut.promise;
            return exportStore.put(input);
          }
        });
        const oldWorker = exportService({
          store: blockedStore,
          selectedClock
        });
        const recoveryWorker = exportService({
          selectedClock
        });
        const lateResult = oldWorker.processExport(
          exportId,
          { workerId: "export-worker-before-old" }
        );
        const oldInput = await putStarted.promise;
        const prepared = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(prepared.state, "building");
        assert.equal(prepared.fence_token, "1");
        assert.equal(
          prepared.object_key,
          exportStore.key(oldInput)
        );
        await assert.rejects(
          exportStore.get({
            key: prepared.object_key,
            expectedSha256: prepared.manifest_digest,
            expectedByteLength: Number(
              prepared.byte_count
            )
          }),
          (error) => error?.code === "ENOENT"
        );
        await assert.rejects(
          recoveryWorker.processExport(exportId, {
            workerId: "export-worker-active-probe"
          }),
          (error) =>
            error?.code ===
            "EXPORT_CLAIM_UNAVAILABLE"
        );

        selectedNow = "2026-07-28T20:00:02.000Z";
        const recovered =
          await recoveryWorker.processExport(exportId, {
            workerId: "export-worker-before-new"
          });
        assert.equal(recovered.export.status, "ready");
        allowLatePut.resolve();
        await assert.rejects(
          lateResult,
          (error) => error?.code === "EXPORT_FENCE_LOST"
        );
        const final = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(final.state, "ready");
        assert.equal(final.fence_token, "2");
        assert.equal(final.object_fence_token, "2");
        assert.match(
          final.object_key,
          /\/attempt-1-fence-2\.zip$/u
        );
        assert.notEqual(
          final.object_key,
          exportStore.key(oldInput)
        );
      }
    );

    await t.test(
      "restart reconciles a crash after immutable object write",
      async () => {
        const requested = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-crash-after-001" }
        );
        const exportId = requested.export.exportId;
        let selectedNow = NOW;
        const selectedClock = {
          now: () => selectedNow
        };
        const objectWritten = deferred();
        const allowLateReturn = deferred();
        const blockedStore = Object.freeze({
          ...exportStore,
          async put(input) {
            const saved = await exportStore.put(input);
            objectWritten.resolve({ input, saved });
            await allowLateReturn.promise;
            return saved;
          }
        });
        const oldWorker = exportService({
          store: blockedStore,
          selectedClock
        });
        const recoveryWorker = exportService({
          selectedClock
        });
        const lateResult = oldWorker.processExport(
          exportId,
          { workerId: "export-worker-after-old" }
        );
        const written = await objectWritten.promise;
        const prepared = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(prepared.state, "building");
        assert.equal(prepared.object_key, written.saved.key);

        selectedNow = "2026-07-28T20:00:02.000Z";
        const recovered =
          await recoveryWorker.processExport(exportId, {
            workerId: "export-worker-after-new"
          });
        assert.equal(recovered.export.status, "ready");
        const final = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(final.fence_token, "2");
        assert.equal(final.object_fence_token, "1");
        assert.equal(final.object_key, written.saved.key);
        allowLateReturn.resolve();
        await assert.rejects(
          lateResult,
          (error) => error?.code === "EXPORT_FENCE_LOST"
        );
      }
    );

    await t.test(
      "lost object-write response reconciles the exact immutable key",
      async () => {
        const requested = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-put-uncertain-001" }
        );
        const exportId = requested.export.exportId;
        let written = null;
        const uncertainStore = Object.freeze({
          ...exportStore,
          async put(input) {
            written = await exportStore.put(input);
            const error = new Error(
              "The object write response was lost."
            );
            error.code = "OBJECT_WRITE_RESPONSE_LOST";
            throw error;
          }
        });
        const uncertainWorker = exportService({
          store: uncertainStore
        });
        const result = await uncertainWorker.processExport(
          exportId,
          { workerId: "export-worker-put-uncertain" }
        );
        assert.equal(result.export.status, "ready");
        const final = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(final.state, "ready");
        assert.equal(final.object_key, written.key);
        assert.equal(final.manifest_digest, written.sha256);
        assert.equal(
          Number(final.byte_count),
          written.byteLength
        );
      }
    );

    await t.test(
      "concurrent workers claim separate queued exports with bounded batches",
      async () => {
        const first = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-concurrent-001" }
        );
        const second = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-concurrent-002" }
        );
        const exportIds = [
          first.export.exportId,
          second.export.exportId
        ];
        const bothStarted = deferred();
        const allowWrites = deferred();
        const keys = [];
        const blockedStore = Object.freeze({
          ...exportStore,
          async put(input) {
            keys.push(exportStore.key(input));
            if (keys.length === 2) bothStarted.resolve();
            await allowWrites.promise;
            return exportStore.put(input);
          }
        });
        const firstWorker = exportService({
          store: blockedStore
        });
        const secondWorker = exportService({
          store: blockedStore
        });
        const firstBatch =
          firstWorker.processQueuedExports({
            workerId: "export-worker-concurrent-a",
            limit: 1
          });
        const secondBatch =
          secondWorker.processQueuedExports({
            workerId: "export-worker-concurrent-b",
            limit: 1
          });
        await bothStarted.promise;
        const claimed = await pool.query(
          `select id, state, worker_id
             from ss.export_requests
            where id = any($1::uuid[])
            order by id`,
          [exportIds]
        );
        assert.equal(claimed.rowCount, 2);
        assert.deepEqual(
          new Set(
            claimed.rows.map((row) => row.worker_id)
          ),
          new Set([
            "export-worker-concurrent-a",
            "export-worker-concurrent-b"
          ])
        );
        assert.ok(
          claimed.rows.every(
            (row) => row.state === "building"
          )
        );
        allowWrites.resolve();
        const batches = await Promise.all([
          firstBatch,
          secondBatch
        ]);
        assert.deepEqual(
          batches.flat().map((entry) => entry.export.status),
          ["ready", "ready"]
        );
        assert.equal(new Set(keys).size, 2);
      }
    );

    await t.test(
      "graceful abort releases prepared claim before object write",
      async () => {
        const requested = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-graceful-abort-001" }
        );
        const exportId = requested.export.exportId;
        const shutdown = new AbortController();
        let puts = 0;
        const abortingStore = Object.freeze({
          ...exportStore,
          key(input) {
            const key = exportStore.key(input);
            shutdown.abort();
            return key;
          },
          async put(input) {
            puts += 1;
            return exportStore.put(input);
          }
        });
        const abortingWorker = exportService({
          store: abortingStore
        });
        const result = await abortingWorker.processExport(
          exportId,
          {
            workerId: "export-worker-graceful-abort",
            signal: shutdown.signal
          }
        );
        assert.equal(result.aborted, true);
        assert.equal(result.export.status, "queued");
        assert.equal(puts, 0);
        const released = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(released.state, "queued");
        assert.equal(released.worker_id, null);
        assert.equal(released.object_key, null);
        assert.equal(released.fence_token, "1");
        assert.equal(
          (
            await service.processExport(exportId, {
              workerId: "export-worker-after-abort"
            })
          ).export.status,
          "ready"
        );
      }
    );

    await t.test(
      "immutable-key conflict fails closed until explicit new attempt",
      async () => {
        const requested = await service.requestExport(
          actor,
          projectId,
          { commandId: "export-conflict-001" }
        );
        const exportId = requested.export.exportId;
        const conflicting = await exportStore.put({
          organizationId,
          projectId,
          exportId,
          attempt: 1,
          fence: 1,
          bytes: Buffer.from(
            "different bytes already own this immutable key",
            "utf8"
          )
        });
        await assert.rejects(
          service.processExport(exportId, {
            workerId: "export-worker-conflict"
          }),
          (error) =>
            error?.code ===
            "EXPORT_OBJECT_KEY_CONFLICT"
        );
        const failed = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(failed.state, "failed");
        assert.equal(
          failed.failure_code,
          "EXPORT_OBJECT_KEY_CONFLICT"
        );
        assert.equal(
          failed.failure_facts.certainty,
          "ambiguous"
        );
        assert.equal(
          failed.failure_facts.objectKey,
          conflicting.key
        );
        await assert.rejects(
          service.processExport(exportId, {
            workerId: "export-worker-no-auto-retry"
          }),
          (error) =>
            error?.code === "EXPORT_RETRY_REQUIRED"
        );
        const retried = await service.retryExport(
          actor,
          projectId,
          exportId,
          { commandId: "export-conflict-retry-001" }
        );
        assert.equal(retried.export.status, "queued");
        const ready = await service.processExport(
          exportId,
          { workerId: "export-worker-retry" }
        );
        assert.equal(ready.export.status, "ready");
        const final = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [exportId]
          )
        ).rows[0];
        assert.equal(final.attempt_number, "2");
        assert.equal(final.fence_token, "2");
        assert.equal(final.object_attempt_number, "2");
        assert.equal(final.object_fence_token, "2");
        assert.match(
          final.object_key,
          /\/attempt-2-fence-2\.zip$/u
        );
      }
    );

    await t.test(
      "expired retention fails without any object write",
      async () => {
        const retentionProject =
          await service.createProject(
            actor,
            organizationId,
            {
              name: "Retention Proof",
              acceptedTerms: true,
              visibility: "public",
              address: {
                kind: "licensed",
                label: "retention-proof"
              },
              commandId:
                "project-retention-proof-001"
            }
        );
        const retentionProjectId =
          retentionProject.project.id;
        const requested = await service.requestExport(
          actor,
          retentionProjectId,
          { commandId: "export-retention-001" }
        );
        await pool.query(
          `insert into ss.stripe_subscriptions (
             id,
             organization_id,
             project_id,
             stripe_customer_row_id,
             stripe_subscription_id,
             stripe_price_id,
             catalog_price_id,
             billing_policy_id,
             status,
             currency,
             amount_minor,
             first_failed_at,
             grace_ends_at,
             suspended_at,
             retention_ends_at,
             cancelled_at,
             current_period_ends_at,
             created_at,
             updated_at,
             revision
           )
           select
             $1,
             organization_id,
             $2,
             stripe_customer_row_id,
             $3,
             stripe_price_id,
             catalog_price_id,
             billing_policy_id,
             'cancelled',
             currency,
             amount_minor,
             null,
             null,
             null,
             $4,
             $5,
             current_period_ends_at,
             $5,
             $5,
             1
           from ss.stripe_subscriptions
          where project_id = $6`,
          [
            randomUUID(),
            retentionProjectId,
            `sub_test_retention_${randomUUID()}`,
            "2026-07-28T19:59:00.000Z",
            "2026-07-20T20:00:00.000Z",
            projectId
          ]
        );
        let puts = 0;
        const noWriteStore = Object.freeze({
          ...exportStore,
          async put(input) {
            puts += 1;
            return exportStore.put(input);
          }
        });
        const retentionWorker = exportService({
          store: noWriteStore
        });
        await assert.rejects(
          retentionWorker.processExport(
            requested.export.exportId,
            { workerId: "export-worker-retention" }
          ),
          (error) =>
            error?.code ===
            "EXPORT_RETENTION_EXPIRED"
        );
        assert.equal(puts, 0);
        const failed = (
          await pool.query(
            `select *
               from ss.export_requests
              where id = $1`,
            [requested.export.exportId]
          )
        ).rows[0];
        assert.equal(failed.state, "failed");
        assert.equal(
          failed.failure_code,
          "EXPORT_RETENTION_EXPIRED"
        );
        assert.equal(
          failed.failure_facts.certainty,
          "not_written"
        );
      }
    );

    const cancellationPreview =
      await service.getCancellationPreview(
        actor,
        projectId
      );
    const cancelled =
      await service.cancelSubscription(
        actor,
        projectId,
        {
          previewId:
            cancellationPreview.preview.previewId,
          acceptedDisclosureDigest:
            cancellationPreview.preview
              .disclosureDigest,
          commandId:
            "subscription-cancel-0001"
        }
      );
    assert.equal(
      cancelled.cancellation.providerStatus,
      "scheduled"
    );
    assert.equal(
      cancelled.subscription.cancelAt,
      "2026-08-28T20:00:00.000Z"
    );
    assert.equal(
      payment.calls.cancellation.length,
      1
    );
    const reconciliationPreview =
      await service.getCancellationPreview(
        actor,
        projectId
      );
    const ambiguousCancellation = new Error(
      "Provider response was not received."
    );
    ambiguousCancellation.code =
      "stripe_cancellation_effect_unknown";
    ambiguousCancellation.certainty =
      "ambiguous";
    payment.failNextCancellation(
      ambiguousCancellation
    );
    const reconciliation =
      await service.cancelSubscription(
        actor,
        projectId,
        {
          previewId:
            reconciliationPreview.preview
              .previewId,
          acceptedDisclosureDigest:
            reconciliationPreview.preview
              .disclosureDigest,
          commandId:
            "subscription-cancel-reconciliation-0001"
        }
      );
    assert.equal(
      reconciliation.cancellation.providerStatus,
      "reconciliation_required"
    );
    assert.equal(
      payment.calls.cancellation.length,
      2
    );
    const reconciliationPoll =
      await service.processPaymentOutbox({
        limit: 10,
        workerId:
          "test-reconciliation-poll"
      });
    assert.equal(
      reconciliationPoll.processed,
      0
    );
    assert.equal(
      payment.calls.cancellation.length,
      2
    );
    const heldCancellation = await pool.query(
      `select
         available_at::text as available_at,
         last_error
       from ss.transactional_outbox
       where event_type =
               'subscription.cancellation_requested'
         and payload ->> 'previewId' = $1`,
      [
        reconciliationPreview.preview
          .previewId
      ]
    );
    assert.deepEqual(
      heldCancellation.rows[0],
      {
        available_at: "infinity",
        last_error:
          "ambiguous:stripe_cancellation_effect_unknown"
      }
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
    const ownedDeleted =
      await service.deleteProject(
        actor,
        ownedProjectId,
        {
          commandId:
            "project-delete-owned-0001"
        }
      );
    assert.equal(ownedDeleted.deleted, true);
    await authority.close();
  }
);
