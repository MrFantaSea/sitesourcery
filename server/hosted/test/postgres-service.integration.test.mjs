import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { buildHostedArtifact } from "../../../scripts/build-hosted.mjs";
import { createFakeApprovedCatalog } from "../../commerce/adapters/fake.mjs";
import {
  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
  createCommerceV2Boundary,
  createCommerceV2Service,
  createAlakazamAccountService,
  createAlakazamBillingRelease,
  createAlakazamBillingService,
  createAlakazamSiteSetupDigest,
  createDownloadPaymentRelease,
  createDownloadPaymentService,
  createHostedAlakazamAccount,
  createHostedDownloadCommerce,
  digest as commerceDigest
} from "../../commerce-v2/index.mjs";
import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import {
  createPostgresCommerceV2Adapter
} from "../commerce-v2-postgres.mjs";
import {
  createPostgresAlakazamRepository
} from "../alakazam-postgres.mjs";
import {
  createPostgresDownloadPaymentRepository
} from "../download-payment-postgres.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createHostedApi } from "../http.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import { createNodeHandler } from "../node-handler.mjs";
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
import { createStripeWebhookRouter } from "../stripe-webhook-router.mjs";
import { openReviewedBrowser } from "./reviewed-browser-support.mjs";

const { Pool } = pg;
const require = createRequire(import.meta.url);
const AbracadabraAPI = require(
  "../../../abracadabra/app/abracadabra-api.js"
);
const DATABASE_URL =
  process.env.SITESOURCERY_PG_SERVICE_TEST_URL ?? null;
const NOW = "2026-07-28T20:00:00.000Z";
const MIGRATIONS = new URL(
  "../../data-plane/supabase/migrations/",
  import.meta.url
);
const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const HOSTED_ARTIFACT_ROOT = path.join(
  REPOSITORY_ROOT,
  "_hosted"
);
const HOSTED_CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8"
});

function createSameOriginBrowserFetch(api, origin) {
  const cookies = new Map();
  const setCookieHeaders = [];

  return Object.freeze({
    cookie(name) {
      return cookies.get(name) ?? null;
    },
    setCookieHeaders,
    async fetch(resource, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("Origin", origin);
      if (cookies.size > 0) {
        headers.set(
          "Cookie",
          [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join("; ")
        );
      }
      const response = await api.fetch(
        new Request(new URL(resource, origin), {
          ...init,
          headers
        })
      );
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        setCookieHeaders.push(setCookie);
        const pair = setCookie.split(";", 1)[0];
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
      return response;
    }
  });
}

function hostedArtifactPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.endsWith("/")
    ? `${decoded.replace(/^\/+/, "")}index.html`
    : decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;
  const normalized = path.posix.normalize(relative);
  if (
    normalized !== relative ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  const resolved = path.resolve(
    HOSTED_ARTIFACT_ROOT,
    normalized
  );
  const prefix =
    `${path.resolve(HOSTED_ARTIFACT_ROOT)}${path.sep}`;
  return resolved.startsWith(prefix) ? resolved : null;
}

async function startHostedBrowserServer(api) {
  await buildHostedArtifact({ root: REPOSITORY_ROOT });
  const apiRequests = [];
  const missingFiles = [];
  const apiHandler = createNodeHandler(api);
  const server = createServer((request, response) => {
    let url;
    try {
      url = new URL(
        request.url ?? "/",
        "http://localhost"
      );
    } catch {
      response.writeHead(400, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Bad request");
      return;
    }
    if (
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/")
    ) {
      apiRequests.push({
        method: String(request.method ?? "GET")
          .toUpperCase(),
        pathname: url.pathname
      });
      void apiHandler(request, response);
      return;
    }

    void (async () => {
      const file = hostedArtifactPath(url.pathname);
      if (!file) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end("Bad request");
        return;
      }
      try {
        const bytes = await readFile(file);
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Length": bytes.byteLength,
          "Content-Type":
            HOSTED_CONTENT_TYPES[
              path.extname(file).toLowerCase()
            ] ?? "application/octet-stream",
          "Referrer-Policy":
            "strict-origin-when-cross-origin",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN"
        });
        if (request.method === "HEAD") {
          response.end();
        } else {
          response.end(bytes);
        }
      } catch {
        missingFiles.push(url.pathname);
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end("Not found");
      }
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8"
        });
      }
      response.end("Internal error");
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port =
    address && typeof address === "object"
      ? address.port
      : 0;
  return Object.freeze({
    apiRequests,
    missingFiles,
    origin: `http://localhost:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      })
  });
}

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
    downloadCheckout: [],
    downloadReadback: [],
    downloadLifecycle: [],
    portal: [],
    cancellation: [],
    webhook: []
  };
  let checkoutSequence = 0;
  let downloadCheckoutSequence = 0;
  let portalSequence = 0;
  let cancellationFailure = null;
  let nextDownloadCheckoutExpiresAt =
    "2099-07-28T20:30:00.000Z";
  const downloadCheckouts = new Map();
  return {
    calls,
    setNextDownloadCheckoutExpiry(expiresAt) {
      nextDownloadCheckoutExpiresAt = expiresAt;
    },
    markDownloadCheckoutExpired(checkoutId) {
      const checkout = downloadCheckouts.get(checkoutId);
      assert.ok(checkout);
      checkout.lifecycle = "expired_unpaid";
    },
    failNextCancellation(error) {
      cancellationFailure = error;
    },
    port: Object.freeze({
      async readiness() {
        return {
          ready: true,
          provider: "stripe",
          mode: "contract_test",
          livemode: false,
          taxMode: "disabled_by_owner"
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
      async createDownloadCheckout(input) {
        calls.downloadCheckout.push(
          structuredClone(input)
        );
        downloadCheckoutSequence += 1;
        const checkoutId =
          `cs_test_download_${downloadCheckoutSequence}`;
        const expiresAt = nextDownloadCheckoutExpiresAt;
        nextDownloadCheckoutExpiresAt =
          "2099-07-28T20:30:00.000Z";
        downloadCheckouts.set(
          checkoutId,
          {
            request: structuredClone(input),
            lifecycle: "open_unpaid"
          }
        );
        return {
          checkoutId,
          url:
            `https://checkout.stripe.com/c/pay/${checkoutId}`,
          expiresAt
        };
      },
      async retrieveDownloadCheckout(input) {
        calls.downloadReadback.push(
          structuredClone(input)
        );
        const created = downloadCheckouts.get(
          input.checkoutSessionId
        );
        assert.ok(created);
        assert.equal(
          input.purposeDigest,
          created.request.purposeDigest
        );
        assert.deepEqual(
          input.purpose,
          created.request.purpose
        );
        const checkoutNumber =
          input.checkoutSessionId.replace(
            "cs_test_download_",
            ""
          );
        return {
          schema:
            "sitesourcery.stripe-download-payment-facts/v2",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId:
            `pi_test_download_${checkoutNumber}`,
          customerId:
            `cus_test_hosted_customer_${checkoutNumber}`,
          paymentStatus: "paid",
          amountMinor: 500,
          taxMinor: 0,
          totalMinor: 500,
          taxMode: "disabled_by_owner",
          currency: "USD",
          purposeDigest: input.purposeDigest
        };
      },
      async retrieveDownloadCheckoutLifecycle(input) {
        calls.downloadLifecycle.push(
          structuredClone(input)
        );
        const created = downloadCheckouts.get(
          input.checkoutSessionId
        );
        assert.ok(created);
        assert.equal(
          input.purposeDigest,
          created.request.purposeDigest
        );
        assert.deepEqual(
          input.purpose,
          created.request.purpose
        );
        return {
          schema:
            "sitesourcery.stripe-download-checkout-lifecycle/v2",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          state: created.lifecycle
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
      platformBaseDomain: "sitesourcery.me",
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
    let commerceV2ClockNow = NOW;
    const commerceV2 =
      createPostgresCommerceV2Adapter({
        authority,
        clock: () => new Date(commerceV2ClockNow)
      });
    const downloadPaymentRepository =
      createPostgresDownloadPaymentRepository({
        authority,
        clock: () => new Date(commerceV2ClockNow)
      });
    const downloadPayment =
      createDownloadPaymentService({
        repository: downloadPaymentRepository,
        provider: payment.port,
        release: createDownloadPaymentRelease({
          approved: true
        }),
        clock: commerceV2.clock,
        ids: commerceV2.ids
      });
    const downloadCommerce =
      createHostedDownloadCommerce({
        boundary: createCommerceV2Boundary(
          createCommerceV2Service({
            projects: commerceV2.projects,
            versions: commerceV2.versions,
            repository: commerceV2.repository,
            clock: commerceV2.clock,
            ids: commerceV2.ids
          })
        ),
        resolveSession: commerceV2.resolveSession,
        payment: downloadPayment
      });
    const alakazamRepository =
      createPostgresAlakazamRepository({ authority });
    const alakazamAccount =
      createHostedAlakazamAccount({
        account: createAlakazamAccountService({
          repository: alakazamRepository
        }),
        resolveSession: commerceV2.resolveSession
      });
    const stripeWebhook = createStripeWebhookRouter({
      provider: payment.port,
      canonicalService: service,
      downloadCommerce,
      assessmentCommerce: {
        async ingestStripeEvent() {
          return { status: "not_assessment" };
        }
      },
      customBuildCommerce: {
        async ingestStripeEvent() {
          return { status: "not_custom_build" };
        }
      },
      customBuildChangeCommerce: {
        async ingestStripeEvent() {
          return { status: "not_custom_build_change" };
        }
      },
      customBuildFinalCommerce: {
        async ingestStripeEvent() {
          return { status: "not_custom_build_final" };
        }
      },
      alakazamCommerce: {
        async ingestStripeEvent() {
          return { status: "not_alakazam" };
        }
      },
      alakazamLifecycle: {
        renewal: {
          async ingestStripeEvent() {
            return { status: "not_alakazam_renewal" };
          }
        },
        incident: {
          async ingestStripeEvent() {
            return { status: "not_alakazam_incident" };
          }
        },
        recovery: {
          async ingestStripeEvent() {
            return { status: "not_alakazam_recovery" };
          }
        },
        cancellation: {
          async ingestStripeEvent() {
            return {
              status: "not_alakazam_cancellation"
            };
          }
        },
        reversal: {
          async ingestStripeEvent() {
            return { status: "not_alakazam_reversal" };
          }
        }
      }
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
    const deliveredRecovery = (
      await pool.query(
        `select
           state, delivery_mode, delivery_provider,
           provider_receipt_id, failure_code
         from ss.hosted_recovery_delivery_requests
        where command_id = $1`,
        ["recovery-request-002"]
      )
    ).rows[0];
    assert.equal(deliveredRecovery.state, "delivered");
    assert.equal(
      deliveredRecovery.delivery_mode,
      "production"
    );
    assert.equal(
      deliveredRecovery.delivery_provider,
      "integration-mail"
    );
    assert.ok(deliveredRecovery.provider_receipt_id);
    assert.equal(deliveredRecovery.failure_code, null);

    const restartedProductionSends = [];
    const restartedRecoveryService =
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
              restartedProductionSends.push(input);
              assert.fail(
                "a durable delivered recovery must not be sent again after restart"
              );
            }
          }
        })
      });
    assert.deepEqual(
      await restartedRecoveryService.requestRecovery({
        email: registered.user.email,
        commandId: "recovery-request-002"
      }),
      emailRecovery
    );
    assert.equal(restartedProductionSends.length, 0);

    let unavailableReadinessCalls = 0;
    const unavailableReplayService =
      createCanonicalPostgresService({
        ...serviceOptions,
        recoveryMailPort: {
          async readiness() {
            unavailableReadinessCalls += 1;
            return {
              ready: false,
              verified: false,
              mode: "held"
            };
          },
          async deliver() {
            assert.fail(
              "a durable replay must not consult an unavailable provider"
            );
          }
        }
      });
    assert.deepEqual(
      await unavailableReplayService.requestRecovery({
        email: registered.user.email,
        commandId: "recovery-request-002"
      }),
      emailRecovery
    );
    assert.equal(unavailableReadinessCalls, 0);

    const ambiguousSends = [];
    const ambiguousRecoveryService =
      createCanonicalPostgresService({
        ...serviceOptions,
        recoveryMailPort: createProductionRecoveryMailPort({
          clock,
          transport: {
            async readiness() {
              return {
                ready: true,
                verified: true,
                provider: "integration-mail-ambiguous"
              };
            },
            async sendRecovery(input) {
              ambiguousSends.push(input);
              const error = new Error(
                "The provider may have accepted the message."
              );
              error.code = "provider_response_lost";
              throw error;
            }
          }
        })
      });
    await assert.rejects(
      ambiguousRecoveryService.requestRecovery({
        email: otherRegistered.user.email,
        commandId:
          "recovery-request-ambiguous-001"
      }),
      (error) => error?.code === "provider_response_lost"
    );
    assert.equal(ambiguousSends.length, 1);
    assert.deepEqual(
      (
        await pool.query(
          `select state, provider_receipt_id, failure_code
             from ss.hosted_recovery_delivery_requests
            where command_id = $1`,
          ["recovery-request-ambiguous-001"]
        )
      ).rows[0],
      {
        state: "delivery_unknown",
        provider_receipt_id: null,
        failure_code:
          "RECOVERY_DELIVERY_EFFECT_UNKNOWN"
      }
    );

    const forbiddenRetrySends = [];
    const restartedAmbiguousService =
      createCanonicalPostgresService({
        ...serviceOptions,
        recoveryMailPort: createProductionRecoveryMailPort({
          clock,
          transport: {
            async readiness() {
              return {
                ready: true,
                verified: true,
                provider: "integration-mail-ambiguous"
              };
            },
            async sendRecovery(input) {
              forbiddenRetrySends.push(input);
              assert.fail(
                "an ambiguous recovery effect must never retry automatically"
              );
            }
          }
        })
      });
    await assert.rejects(
      restartedAmbiguousService.requestRecovery({
        email: otherRegistered.user.email,
        commandId:
          "recovery-request-ambiguous-001"
      }),
      (error) =>
        error?.code ===
        "RECOVERY_DELIVERY_RECONCILIATION_REQUIRED"
    );
    assert.equal(forbiddenRetrySends.length, 0);
    await assert.rejects(
      restartedAmbiguousService.requestRecovery({
        email: registered.user.email,
        commandId:
          "recovery-request-ambiguous-001"
      }),
      (error) =>
        error?.code === "RECOVERY_IDEMPOTENCY_CONFLICT"
    );
    assert.equal(forbiddenRetrySends.length, 0);
    await assert.rejects(
      pool.query(
        `update ss.hosted_recovery_delivery_requests
            set state = 'pending_delivery',
                failure_code = null
          where command_id = $1`,
        ["recovery-request-ambiguous-001"]
      ),
      (error) => error?.code === "23514"
    );
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
    const reopened = await service.getProject(
      actor,
      projectId
    );
    const reopenedVersion =
      reopened.project.versions.find(
        (candidate) =>
          candidate.id === version.version.id
      );
    assert.equal(
      reopened.project.serving.currentVersionId,
      version.version.id
    );
    assert.deepEqual(
      reopenedVersion.rawFacts,
      rawFacts
    );
    assert.equal(
      reopenedVersion.artifact.digest,
      compiled.artifactDigest
    );
    assert.equal(
      reopenedVersion.artifact.html,
      compiled.html
    );

    await t.test(
      "project idempotency cannot replay one address command across projects",
      async () => {
        const first = await service.createProject(
          actor,
          organizationId,
          {
            name: "Idempotency Project A",
            acceptedTerms: true,
            visibility: "public",
            address: {
              kind: "licensed",
              label: "idempotency-project-a"
            },
            commandId: "project-create-idempotency-a"
          }
        );
        const second = await service.createProject(
          actor,
          organizationId,
          {
            name: "Idempotency Project B",
            acceptedTerms: true,
            visibility: "public",
            address: {
              kind: "licensed",
              label: "idempotency-project-b"
            },
            commandId: "project-create-idempotency-b"
          }
        );
        const command = {
          kind: "licensed",
          label: "cross-project-idempotency-proof",
          commandId: "address-cross-project-proof"
        };
        const selected = await service.selectAddress(
          actor,
          first.project.id,
          command
        );
        assert.equal(
          selected.project.id,
          first.project.id
        );
        await assert.rejects(
          service.selectAddress(
            actor,
            second.project.id,
            command
          ),
          (error) =>
            error?.code === "IDEMPOTENCY_CONFLICT"
        );
        const unchanged = await service.getProject(
          actor,
          second.project.id
        );
        assert.equal(
          unchanged.project.address.label,
          "idempotency-project-b"
        );
      }
    );

    await t.test(
      "Alakazam Checkout wins one setup race and fences later site edits",
      async () => {
        const fenceActor = otherActor;
        const fenceOrganizationId =
          otherRegistered.organization.id;
        const fenceProject = await service.createProject(
          fenceActor,
          fenceOrganizationId,
          {
            name: "Alakazam Setup Fence",
            acceptedTerms: true,
            visibility: "public",
            address: {
              kind: "licensed",
              label: "alakazam-setup-fence"
            },
            commandId: "project-create-alakazam-fence"
          }
        );
        const fenceProjectId = fenceProject.project.id;
        const firstFacts = {
          ...rawFacts,
          businessName: "Alakazam Setup Fence",
          summary: "The accepted setup used for a payment race proof."
        };
        const firstCompiled = compiler.compile(firstFacts);
        const firstVersion = await service.createVersion(
          fenceActor,
          fenceProjectId,
          {
            rawFacts: firstFacts,
            previewDigest: firstCompiled.artifactDigest,
            reviewAttested: true,
            commandId: "version-create-alakazam-fence-1"
          }
        );
        await service.markVersionReady(
          fenceActor,
          fenceProjectId,
          firstVersion.version.id,
          { commandId: "version-ready-alakazam-fence-1" }
        );
        await service.acceptVersion(
          fenceActor,
          fenceProjectId,
          firstVersion.version.id,
          { commandId: "version-accept-alakazam-fence-1" }
        );

        const secondFacts = {
          ...firstFacts,
          summary: "A newer reviewed setup that must lose the payment race."
        };
        const secondCompiled = compiler.compile(secondFacts);
        const secondVersion = await service.createVersion(
          fenceActor,
          fenceProjectId,
          {
            rawFacts: secondFacts,
            previewDigest: secondCompiled.artifactDigest,
            reviewAttested: true,
            commandId: "version-create-alakazam-fence-2"
          }
        );
        await service.markVersionReady(
          fenceActor,
          fenceProjectId,
          secondVersion.version.id,
          { commandId: "version-ready-alakazam-fence-2" }
        );

        const acceptedProject = await service.getProject(
          fenceActor,
          fenceProjectId
        );
        const siteSetupDigest =
          createAlakazamSiteSetupDigest({
            tenantId: fenceOrganizationId,
            customerId: fenceActor.userId,
            projectId: fenceProjectId,
            acceptedVersionId: firstVersion.version.id,
            artifactDigest: firstCompiled.artifactDigest,
            configuredLook: firstFacts.theme,
            addressId: acceptedProject.project.address.id,
            addressLabel:
              acceptedProject.project.address.label,
            hostname:
              acceptedProject.project.address.hostname
          });
        let customerProviderCalls = 0;
        let checkoutProviderCalls = 0;
        let signalCustomerProvider;
        let releaseCustomerProvider;
        const customerProviderStarted = new Promise(
          (resolve) => {
            signalCustomerProvider = resolve;
          }
        );
        const customerProviderRelease = new Promise(
          (resolve) => {
            releaseCustomerProvider = resolve;
          }
        );
        const alakazamClock = { now: () => NOW };
        const alakazam = createAlakazamBillingService({
          repository: alakazamRepository,
          provider: {
            async readiness() {
              return {
                ready: true,
                provider: "stripe",
                alakazam: true,
                livemode: false,
                taxMode: "disabled_by_owner"
              };
            },
            async createAlakazamCustomer(input) {
              customerProviderCalls += 1;
              signalCustomerProvider();
              await customerProviderRelease;
              const facts = {
                schema:
                  ALAKAZAM_CUSTOMER_PROVIDER_FACTS_SCHEMA,
                stripeCustomerId:
                  "cus_alakazam_setup_fence",
                organizationId:
                  input.purpose.organizationId,
                customerId: input.purpose.customerId,
                projectId: input.purpose.projectId,
                quoteId: input.purpose.quoteId,
                provisionId: input.purpose.provisionId,
                providerCreatedAt: NOW,
                purposeDigest: input.purposeDigest
              };
              return {
                ...facts,
                providerFactsDigest:
                  commerceDigest(facts)
              };
            },
            async createAlakazamStartCheckout() {
              checkoutProviderCalls += 1;
              return {
                checkoutId:
                  "cs_alakazam_setup_fence",
                url:
                  "https://checkout.stripe.com/c/pay/alakazam_setup_fence",
                expiresAt:
                  "2026-07-28T20:30:00.000Z"
              };
            },
            async createAlakazamUpgradeCheckout() {
              assert.fail(
                "the setup race must not dispatch an upgrade"
              );
            }
          },
          clock: alakazamClock,
          release: createAlakazamBillingRelease({
            approved: true,
            taxMode: "disabled_by_owner"
          })
        });
        const quoteId = randomUUID();
        const quote = await alakazam.createQuote({
          tenantId: fenceOrganizationId,
          customerId: fenceActor.userId,
          projectId: fenceProjectId,
          quoteId,
          targetTierId: "alakazam_25"
        });
        const checkoutPromise = alakazam.createCheckout({
          tenantId: fenceOrganizationId,
          customerId: fenceActor.userId,
          projectId: fenceProjectId,
          quoteId,
          commandId: randomUUID(),
          acceptedDisclosureDigest:
            quote.disclosureDigest,
          siteSetupDigest
        });
        await customerProviderStarted;
        try {
          await assert.rejects(
            service.acceptVersion(
              fenceActor,
              fenceProjectId,
              secondVersion.version.id,
              {
                commandId:
                  "version-accept-alakazam-fence-2"
              }
            ),
            (error) =>
              error?.code ===
              "ALAKAZAM_SITE_CHANGE_UNAVAILABLE"
          );
          await assert.rejects(
            service.selectAddress(
              fenceActor,
              fenceProjectId,
              {
                kind: "licensed",
                label: "alakazam-fence-changed",
                commandId:
                  "address-change-alakazam-fence"
              }
            ),
            (error) =>
              error?.code ===
              "ALAKAZAM_SITE_CHANGE_UNAVAILABLE"
          );
        } finally {
          releaseCustomerProvider();
        }
        const checkout = await checkoutPromise;
        assert.equal(checkout.status, "ready");
        assert.equal(customerProviderCalls, 1);
        assert.equal(checkoutProviderCalls, 1);
        const fencedProject = await service.getProject(
          fenceActor,
          fenceProjectId
        );
        assert.equal(
          fencedProject.project.serving.currentVersionId,
          firstVersion.version.id
        );
        assert.equal(
          fencedProject.project.address.label,
          "alakazam-setup-fence"
        );
      }
    );

    const downloadQuote =
      await downloadCommerce.createQuote(
        actor,
        projectId,
        {
          versionId: version.version.id,
          commandId: "download-quote-0001"
        }
      );
    assert.equal(downloadQuote.offerId, "spark_download");
    assert.deepEqual(downloadQuote.price, {
      amountMinor: 500,
      currency: "USD",
      billing: "one_time",
      interval: null
    });
    const downloadCheckoutInput = {
      acceptedDisclosureDigest:
        downloadQuote.disclosureDigest,
      commandId: "download-checkout-0001"
    };
    const downloadCheckout =
      await downloadCommerce.prepareCheckout(
        actor,
        projectId,
        downloadQuote.quoteId,
        downloadCheckoutInput
      );
    assert.equal(downloadCheckout.state, "ready");
    assert.equal(
      downloadCheckout.checkoutUrl,
      "https://checkout.stripe.com/c/pay/cs_test_download_1"
    );
    assert.deepEqual(
      await downloadCommerce.prepareCheckout(
        actor,
        projectId,
        downloadQuote.quoteId,
        downloadCheckoutInput
      ),
      downloadCheckout
    );
    assert.equal(payment.calls.downloadCheckout.length, 1);
    assert.equal(
      Object.hasOwn(
        payment.calls.downloadCheckout[0],
        "stripeCustomerId"
      ),
      false
    );
    const downloadPurpose =
      payment.calls.downloadCheckout[0].purpose;
    const downloadMetadata = {
      schema: "sitesourcery_download_checkout_v2",
      tenant_id: downloadPurpose.tenantId,
      customer_id: downloadPurpose.customerId,
      project_id: downloadPurpose.projectId,
      version_id: downloadPurpose.versionId,
      quote_id: downloadPurpose.quoteId,
      offer_id: downloadPurpose.offerId,
      entitlement_kind:
        downloadPurpose.entitlementKind,
      accepted_disclosure_digest:
        downloadPurpose.acceptedDisclosureDigest,
      quote_snapshot_digest:
        downloadPurpose.quoteSnapshotDigest,
      purpose_digest:
        payment.calls.downloadCheckout[0]
          .purposeDigest
    };
    const downloadPaid = stripeEvent(
      "evt_test_download_paid_1",
      "checkout.session.completed",
      {
        id: "cs_test_download_1",
        metadata: downloadMetadata
      }
    );
    const settledDownload =
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(downloadPaid),
        signature: "contract-signature-valid"
      });
    assert.equal(settledDownload.status, "processed");
    assert.deepEqual(
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(downloadPaid),
        signature: "contract-signature-valid"
      }),
      settledDownload
    );
    assert.equal(payment.calls.downloadReadback.length, 1);
    assert.deepEqual(
      (
        await pool.query(
          `select stripe_customer_id
             from ss.stripe_customers
            where organization_id = $1`,
          [organizationId]
        )
      ).rows,
      [{ stripe_customer_id: "cus_test_hosted_customer_1" }]
    );
    const paidProject = await service.getProject(
      actor,
      projectId
    );
    assert.equal(
      paidProject.project.entitlements.length,
      1
    );
    assert.deepEqual(
      paidProject.project.entitlements[0].payment,
      {
        status: "paid",
        provider: "stripe",
        receiptId:
          paidProject.project.entitlements[0]
            .payment.receiptId,
        amountMinor: 500,
        taxMinor: 0,
        totalMinor: 500,
        taxMode: "disabled_by_owner",
        currency: "USD",
        settledAt: NOW
      }
    );
    const resolvedPaidDownload =
      await downloadPaymentRepository
        .resolveDownloadArtifact({
          tenantId: organizationId,
          customerId: registered.user.id,
          projectId,
          versionId: version.version.id
        });
    assert.deepEqual(
      resolvedPaidDownload.entitlement.payment,
      paidProject.project.entitlements[0].payment
    );
    const paidDownload = await downloadCommerce.download(
      actor,
      projectId,
      version.version.id
    );
    assert.deepEqual(paidDownload.bytes, compiled.htmlBytes);
    assert.equal(paidDownload.sha256, compiled.artifactDigest);
    assert.deepEqual(
      (
        await downloadCommerce.download(
          actor,
          projectId,
          version.version.id
        )
      ).bytes,
      compiled.htmlBytes
    );

    const partialReversal = stripeEvent(
      "evt_test_download_partial_1",
      "charge.refunded",
      {
        id: "ch_test_download_1",
        livemode: false,
        payment_intent: "pi_test_download_1",
        currency: "usd",
        amount: 500,
        amount_refunded: 100,
        refunded: false
      }
    );
    assert.deepEqual(
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(partialReversal),
        signature: "contract-signature-valid"
      }),
      {
        status: "processed",
        projectId,
        entitlementId:
          paidProject.project.entitlements[0].id,
        entitlementState: "suspended",
        reason: "payment_partially_refunded"
      }
    );
    await assert.rejects(
      downloadCommerce.download(
        actor,
        projectId,
        version.version.id
      ),
      (error) =>
        error?.code ===
          "COMMERCE_V2_ENTITLEMENT_UNAVAILABLE" &&
        error?.status === 404
    );
    const fullReversal = stripeEvent(
      "evt_test_download_full_1",
      "charge.refunded",
      {
        id: "ch_test_download_1",
        livemode: false,
        payment_intent: "pi_test_download_1",
        currency: "usd",
        amount: 500,
        amount_refunded: 500,
        refunded: true
      }
    );
    const revokedDownload =
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(fullReversal),
        signature: "contract-signature-valid"
      });
    assert.equal(
      revokedDownload.entitlementState,
      "revoked"
    );
    assert.deepEqual(
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(fullReversal),
        signature: "contract-signature-valid"
      }),
      revokedDownload
    );
    assert.deepEqual(
      (
        await pool.query(
          `select state, state_reason
             from ss.commerce_v2_project_entitlements
            where organization_id = $1
              and project_id = $2`,
          [organizationId, projectId]
        )
      ).rows,
      [
        {
          state: "revoked",
          state_reason: "payment_fully_refunded"
        }
      ]
    );
    assert.deepEqual(
      (
        await pool.query(
          `select event_type, resulting_state
             from ss.commerce_v2_download_reversal_events
            where organization_id = $1
              and project_id = $2
            order by id`,
          [organizationId, projectId]
        )
      ).rows,
      [
        {
          event_type: "charge.refunded",
          resulting_state: "revoked"
        },
        {
          event_type: "charge.refunded",
          resulting_state: "suspended"
        }
      ]
    );
    const postRevocationDispute = stripeEvent(
      "evt_test_download_dispute_after_revoked_1",
      "charge.dispute.created",
      {
        id: "dp_test_download_after_revoked_1",
        livemode: false,
        payment_intent: "pi_test_download_1",
        currency: "usd",
        amount: 500,
        status: "needs_response"
      }
    );
    assert.deepEqual(
      await stripeWebhook.ingestStripeWebhook({
        rawBody: rawEvent(postRevocationDispute),
        signature: "contract-signature-valid"
      }),
      {
        status: "processed",
        projectId,
        entitlementId:
          paidProject.project.entitlements[0].id,
        entitlementState: "revoked",
        reason: "payment_fully_refunded"
      }
    );
    assert.deepEqual(
      (
        await pool.query(
          `select prior_state, prior_reason,
                  resulting_state, reason,
                  result ->> 'reason' as result_reason
             from ss.commerce_v2_download_reversal_events
            where id = $1`,
          [postRevocationDispute.id]
        )
      ).rows,
      [
        {
          prior_state: "revoked",
          prior_reason: "payment_fully_refunded",
          resulting_state: "revoked",
          reason: "payment_dispute_open",
          result_reason: "payment_fully_refunded"
        }
      ]
    );
    assert.deepEqual(
      (
        await service.getProject(actor, projectId)
      ).project.entitlements,
      []
    );

    const expiryProject = await service.createProject(
      actor,
      organizationId,
      {
        name: "Checkout Expiry Proof",
        acceptedTerms: true,
        visibility: "public",
        address: {
          kind: "licensed",
          label: "checkout-expiry-proof"
        },
        commandId: "project-create-expiry-0001"
      }
    );
    const expiryProjectId = expiryProject.project.id;
    const expiryFacts = {
      ...rawFacts,
      businessName: "Checkout Expiry Proof"
    };
    await service.saveDraft(actor, expiryProjectId, {
      rawFacts: expiryFacts,
      expectedRevision: 1,
      commandId: "draft-save-expiry-0001"
    });
    const expiryCompiled = compiler.compile(expiryFacts);
    const expiryVersion = await service.createVersion(
      actor,
      expiryProjectId,
      {
        rawFacts: expiryFacts,
        previewDigest:
          expiryCompiled.artifactDigest,
        reviewAttested: true,
        commandId: "version-create-expiry-0001"
      }
    );
    await service.markVersionReady(
      actor,
      expiryProjectId,
      expiryVersion.version.id,
      { commandId: "version-ready-expiry-0001" }
    );
    await service.acceptVersion(
      actor,
      expiryProjectId,
      expiryVersion.version.id,
      { commandId: "version-accept-expiry-0001" }
    );
    commerceV2ClockNow =
      "2026-08-02T12:00:00.000Z";
    payment.setNextDownloadCheckoutExpiry(
      "2026-08-02T12:30:00.000Z"
    );
    const expiringQuote =
      await downloadCommerce.createQuote(
        actor,
        expiryProjectId,
        {
          versionId: expiryVersion.version.id,
          commandId: "download-quote-expiry-0001"
        }
      );
    const expiringCheckoutInput = {
      acceptedDisclosureDigest:
        expiringQuote.disclosureDigest,
      commandId: "download-checkout-expiry-0001"
    };
    const downloadEffectsBeforeExpiry =
      payment.calls.downloadCheckout.length;
    const expiringCheckout =
      await downloadCommerce.prepareCheckout(
        actor,
        expiryProjectId,
        expiringQuote.quoteId,
        expiringCheckoutInput
      );
    payment.markDownloadCheckoutExpired(
      expiringCheckout.checkout.id
    );
    commerceV2ClockNow =
      "2026-08-02T13:00:00.000Z";
    await assert.rejects(
      downloadCommerce.prepareCheckout(
        actor,
        expiryProjectId,
        expiringQuote.quoteId,
        expiringCheckoutInput
      ),
      (error) =>
        error?.code ===
          "COMMERCE_V2_QUOTE_EXPIRED" &&
        error?.status === 409
    );
    assert.equal(
      payment.calls.downloadCheckout.length,
      downloadEffectsBeforeExpiry + 1
    );
    assert.equal(
      payment.calls.downloadLifecycle.length,
      0
    );
    assert.deepEqual(
      (
        await pool.query(
          `select state
             from ss.commerce_v2_download_dispatches
            where organization_id = $1
              and project_id = $2`,
          [organizationId, expiryProjectId]
        )
      ).rows,
      [{ state: "ready" }]
    );
    const replacementQuote =
      await downloadCommerce.createQuote(
        actor,
        expiryProjectId,
        {
          versionId: expiryVersion.version.id,
          commandId:
            "download-quote-expiry-replacement-0001"
        }
      );
    const replacementCheckout =
      await downloadCommerce.prepareCheckout(
        actor,
        expiryProjectId,
        replacementQuote.quoteId,
        {
          acceptedDisclosureDigest:
            replacementQuote.disclosureDigest,
          commandId:
            "download-checkout-expiry-replacement-0001"
        }
      );
    assert.equal(replacementCheckout.state, "ready");
    assert.equal(
      payment.calls.downloadLifecycle.length,
      1
    );
    assert.equal(
      payment.calls.downloadCheckout.length,
      downloadEffectsBeforeExpiry + 2
    );
    assert.deepEqual(
      (
        await pool.query(
          `select state
             from ss.commerce_v2_download_dispatches
            where organization_id = $1
              and project_id = $2
            order by created_at`,
          [organizationId, expiryProjectId]
        )
      ).rows,
      [{ state: "expired" }, { state: "ready" }]
    );
    commerceV2ClockNow = NOW;

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
            "https://cedar-workshop.sitesourcery.me/",
            {
              headers: {
                host: "cedar-workshop.sitesourcery.me"
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
      new Request("https://cedar-workshop.sitesourcery.me/", {
        headers: {
          host: "cedar-workshop.sitesourcery.me"
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
            "https://cedar-workshop.sitesourcery.me/",
            {
              headers: {
                host: "cedar-workshop.sitesourcery.me"
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

    await t.test(
      "browser API crosses CSRF, secure cookies, HTTP, and PostgreSQL for one account",
      async () => {
        const origin = "https://staging.sitesourcery.test";
        const api = createHostedApi(service, {
          csrfTokens: () =>
            "csrf_browser_account_boundary_1234567890"
        });
        const browser = createSameOriginBrowserFetch(
          api,
          origin
        );
        let commandSequence = 0;
        const client = AbracadabraAPI.createClient({
          fetch: browser.fetch,
          idempotencyFactory: () =>
            `browser-account-command-${++commandSequence}`
        });
        const email =
          `browser-owner-${randomUUID()}@example.test`;
        const password =
          "browser account correct horse battery staple";

        const staged = await client.register({
          name: "Browser Test Owner",
          organizationName: "Browser Test Organization",
          email,
          password
        });
        assert.deepEqual(
          {
            accepted: staged.accepted,
            verificationRequired:
              staged.verificationRequired,
            delivery: staged.delivery,
            emailSent: staged.emailSent,
            replayed: staged.replayed
          },
          {
            accepted: true,
            verificationRequired: true,
            delivery: "email",
            emailSent: true,
            replayed: false
          }
        );
        assert.ok(browser.cookie("ss_csrf"));
        assert.equal(browser.cookie("ss_session"), null);
        const message =
          registrationSink.readForTest(email)[0];
        assert.ok(message);
        const token = decodeURIComponent(
          new URL(message.verificationUrl).hash.slice(
            "#verify-registration=".length
          )
        );

        const activated =
          await client.completeRegistration({ token });
        assert.equal(
          activated.user.email,
          email
        );
        assert.equal(
          activated.organization.name,
          "Browser Test Organization"
        );
        assert.equal(
          Object.hasOwn(activated, "sessionToken"),
          false
        );
        assert.equal(
          Object.hasOwn(activated, "session"),
          false
        );
        assert.ok(browser.cookie("ss_session"));
        const sessionCookie =
          browser.setCookieHeaders.find((header) =>
            header.startsWith("ss_session=") &&
            !header.startsWith("ss_session=;")
          );
        assert.match(
          sessionCookie,
          /; Path=\/api\/v1; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/u
        );

        const account = await client.me();
        assert.equal(account.user.email, email);
        assert.deepEqual(
          account.organizations.map(({ name, role, state }) => ({
            name,
            role,
            state
          })),
          [
            {
              name: "Browser Test Organization",
              role: "owner",
              state: "active"
            }
          ]
        );
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
                   where lower(users.email) = $1
                     and session.revoked_at is null)
                   as active_sessions`,
              [email]
            )
          ).rows[0],
          {
            users: 1,
            organizations: 1,
            active_sessions: 1
          }
        );

        await client.signOut();
        assert.equal(browser.cookie("ss_session"), null);
        assert.equal((await client.me()).user, null);
        const signedIn = await client.signIn({
          email,
          password
        });
        assert.equal(signedIn.user.email, email);
        assert.equal(
          Object.hasOwn(signedIn, "sessionToken"),
          false
        );
        assert.equal(
          Object.hasOwn(signedIn, "session"),
          false
        );
        assert.equal((await client.me()).user.email, email);
      }
    );
    await t.test(
      "shipped hosted page creates, activates, saves, and signs back into one real PostgreSQL account",
      async () => {
        const api = createHostedApi(service, {
          downloadCommerce,
          alakazamAccount,
          stripeWebhook
        });
        const browserServer =
          await startHostedBrowserServer(api);
        let reviewedBrowser = null;
        const email =
          `shipped-browser-${randomUUID()}@example.test`;
        const password =
          "shipped browser correct horse battery staple";
        const projectName =
          "Shipped Browser Workshop";
        const hostedLabel =
          `shipped-${randomUUID()}`;

        try {
          reviewedBrowser = await openReviewedBrowser({
            origin: browserServer.origin
          });
          const {
            browserErrors,
            cdp,
            evaluate,
            navigate,
            waitFor
          } = reviewedBrowser;
          const appUrl =
            `${browserServer.origin}/abracadabra/app/`;
          await navigate(appUrl);
          await waitFor(
            `document.documentElement.getAttribute(` +
              `"data-abracadabra-control-ready") === "hosted" ` +
              `&& document.getElementById("spark-maker")?.inert === false`
          );

          const capabilities = await evaluate(
            `(async () => {
              const response = await fetch("/api/v1/capabilities", {
                credentials: "same-origin"
              });
              return response.json();
            })()`,
            true
          );
          assert.equal(
            capabilities.accountRegistration,
            true
          );
          assert.equal(
            capabilities.accountRecoveryEmail,
            true
          );
          assert.equal(capabilities.downloadQuote, true);
          assert.equal(capabilities.downloadPayment, true);
          assert.equal(capabilities.domainPurchase, false);

          await evaluate(
            `(() => {
              const setValue = (name, value) => {
                const field = document.querySelector(
                  '[name="' + name + '"]'
                );
                const prototype =
                  field instanceof HTMLTextAreaElement
                    ? HTMLTextAreaElement.prototype
                    : field instanceof HTMLSelectElement
                      ? HTMLSelectElement.prototype
                      : HTMLInputElement.prototype;
                Object.getOwnPropertyDescriptor(
                  prototype,
                  "value"
                ).set.call(field, value);
                field.dispatchEvent(
                  new Event("input", { bubbles: true })
                );
                field.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              };
              document.querySelector('[data-next="facts"]').click();
              setValue(
                "businessName",
                "Shipped Browser Workshop"
              );
              setValue(
                "summary",
                "Repairs practical equipment for nearby small businesses."
              );
              setValue(
                "about",
                "Owner-operated and available by appointment."
              );
              setValue("email", "owner@example.test");
              document.querySelector('[data-next="truth"]').click();
              return true;
            })()`
          );
          await waitFor(
            `document.querySelector('[data-step="truth"]')` +
              `.hidden === false`
          );
          await evaluate(
            `(() => {
              const checkbox =
                document.getElementById("truth-confirmed");
              checkbox.checked = true;
              checkbox.dispatchEvent(
                new Event("change", { bubbles: true })
              );
              document.getElementById("make-preview").click();
              return true;
            })()`
          );
          await waitFor(
            `document.querySelector('[data-step="preview"]')` +
              `.hidden === false && ` +
              `document.getElementById("spark-preview")` +
              `.getAttribute("src")?.startsWith("blob:")`
          );
          await evaluate(
            `document.querySelector("[data-save-direction]").click()`
          );
          await waitFor(
            `document.getElementById("control-room").hidden === false ` +
              `&& document.querySelector("[data-create-account]")` +
              `.disabled === false`
          );

          await evaluate(
            `(() => {
              const values = ${JSON.stringify({
                accountName: "Shipped Browser Owner",
                organizationName:
                  "Shipped Browser Organization",
                accountEmail: email,
                accountPassword: password
              })};
              for (const [name, value] of Object.entries(values)) {
                const field = document.querySelector(
                  '[name="' + name + '"]'
                );
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
                ).set.call(field, value);
                field.dispatchEvent(
                  new Event("input", { bubbles: true })
                );
                field.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
              }
              document.querySelector("[data-create-account]").click();
              return true;
            })()`
          );
          await waitFor(
            `document.getElementById("auth-activate").hidden === false ` +
              `&& document.getElementById("platform-status")` +
              `.textContent.includes("activation link")`
          );
          const message =
            registrationSink.readForTest(email)[0];
          assert.ok(message);
          const token = decodeURIComponent(
            new URL(message.verificationUrl).hash.slice(
              "#verify-registration=".length
            )
          );

          await evaluate(
            `(() => {
              const field = document.querySelector(
                '[name="activationToken"]'
              );
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              ).set.call(field, ${JSON.stringify(token)});
              field.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              document.querySelector(
                "[data-complete-registration]"
              ).click();
              return true;
            })()`
          );
          await waitFor(
            `document.querySelector("[data-session-bar]").hidden === false ` +
              `&& document.querySelector(` +
              `"[data-customer-stage=project]").hidden === false ` +
              `&& globalThis.SiteSourceryAbracadabraHostedSession` +
              `.getState().account?.email === ${JSON.stringify(email)}`
          );

          const cookiesAfterActivation =
            (await cdp.send("Network.getAllCookies"))
              .cookies;
          const sessionCookie =
            cookiesAfterActivation.find(
              (cookie) => cookie.name === "ss_session"
            );
          assert.ok(sessionCookie);
          assert.equal(sessionCookie.httpOnly, true);
          assert.equal(sessionCookie.secure, true);
          assert.equal(sessionCookie.sameSite, "Strict");
          assert.equal(sessionCookie.path, "/api/v1");
          const browserStorage = await evaluate(
            `(() => ({
              cookie: document.cookie,
              local: Object.fromEntries(
                Object.keys(localStorage).map((key) => [
                  key,
                  localStorage.getItem(key)
                ])
              ),
              session: Object.fromEntries(
                Object.keys(sessionStorage).map((key) => [
                  key,
                  sessionStorage.getItem(key)
                ])
              )
            }))()`
          );
          assert.doesNotMatch(
            JSON.stringify(browserStorage),
            new RegExp(token.replace(
              /[.*+?^${}()|[\]\\]/gu,
              "\\$&"
            ), "u")
          );
          assert.doesNotMatch(
            Object.keys(browserStorage.local)
              .concat(Object.keys(browserStorage.session))
              .join("\n"),
            /auth|session|token/iu
          );

          try {
            await waitFor(
              `document.querySelector("[data-create-project]")` +
                `.disabled === false`,
              5000
            );
          } catch (error) {
            const diagnosis = await evaluate(
              `(() => ({
                status: document.getElementById("platform-status")
                  .textContent.trim(),
                projectCopy: document.querySelector(
                  "[data-project-availability]"
                ).textContent.trim(),
                state: globalThis
                  .SiteSourceryAbracadabraHostedSession
                  .getState()
              }))()`
            );
            throw new Error(
              `${error.message}; project readiness ` +
                JSON.stringify(diagnosis)
            );
          }
          await evaluate(
            `(() => {
              const field = document.querySelector(
                '[name="projectName"]'
              );
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              ).set.call(field, ${JSON.stringify(projectName)});
              field.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              const terms = document.querySelector(
                '[name="acceptedProjectTerms"]'
              );
              terms.checked = true;
              terms.dispatchEvent(
                new Event("change", { bubbles: true })
              );
              document.querySelector("[data-create-project]").click();
              return true;
            })()`
          );
          try {
            await waitFor(
              `globalThis.SiteSourceryAbracadabraHostedSession` +
                `.getState().project?.name === ` +
                `${JSON.stringify(projectName)} && ` +
                `Boolean(globalThis.SiteSourceryAbracadabraHostedSession` +
                `.getState().selectedVersionId) && ` +
                `document.querySelector("[data-customer-stage=quote]")` +
                `.hidden === false`,
              15000
            );
          } catch (error) {
            const diagnosis = await evaluate(
              `(() => ({
                status: document.getElementById("platform-status")
                  .textContent.trim(),
                projectCopy: document.querySelector(
                  "[data-project-availability]"
                ).textContent.trim(),
                projectButtonDisabled: document.querySelector(
                  "[data-create-project]"
                ).disabled,
                state: globalThis
                  .SiteSourceryAbracadabraHostedSession
                  .getState()
              }))()`
            );
            throw new Error(
              `${error.message}; browser diagnosis ` +
                `${JSON.stringify(diagnosis)}; API requests ` +
                `${JSON.stringify(browserServer.apiRequests)}`
            );
          }
          const savedState = await evaluate(
            `globalThis.SiteSourceryAbracadabraHostedSession.getState()`
          );
          assert.equal(savedState.project.name, projectName);
          assert.ok(savedState.selectedVersionId);
          assert.equal(
            savedState.operations.acceptVersion.status,
            "success"
          );

          assert.deepEqual(
            (
              await pool.query(
                `select
                   (select count(*)::integer
                      from auth.users users
                     where lower(users.email) = $1) as users,
                   (select count(*)::integer
                      from ss.organizations organization
                      join auth.users users
                        on users.id =
                           organization.created_by_user_id
                     where lower(users.email) = $1)
                     as organizations,
                   (select count(*)::integer
                      from ss.projects project
                      join auth.users users
                        on users.id =
                           project.created_by_user_id
                     where lower(users.email) = $1
                       and project.name = $2)
                     as projects,
                   (select count(*)::integer
                      from ss.site_versions version
                      join auth.users users
                        on users.id =
                           version.created_by_user_id
                     where lower(users.email) = $1)
                     as versions,
                   (select count(*)::integer
                      from ss.version_state_projection state
                      join ss.site_versions version
                        on version.id = state.version_id
                      join auth.users users
                        on users.id =
                           version.created_by_user_id
                     where lower(users.email) = $1
                       and state.state = 'accepted_release')
                     as accepted_versions,
                   (select count(*)::integer
                      from ss.hosted_sessions session
                      join auth.users users
                        on users.id = session.user_id
                     where lower(users.email) = $1
                       and session.revoked_at is null)
                     as active_sessions`,
                [email, projectName]
              )
            ).rows[0],
            {
              users: 1,
              organizations: 1,
              projects: 1,
              versions: 1,
              accepted_versions: 1,
              active_sessions: 1
            }
          );

          try {
            await waitFor(
              `document.querySelector("[data-alakazam-account]")` +
                `.hidden === false && ` +
                `document.querySelector("[data-alakazam-load-state]")` +
                `.textContent.includes("loaded") && ` +
                `Boolean(document.querySelector(` +
                `"[data-alakazam-site-form]"))`,
              10000
            );
          } catch (error) {
            const diagnosis = await evaluate(
              `(() => {
                const panel = document.querySelector(
                  "[data-alakazam-account]"
                );
                return {
                  panel: panel && {
                    hidden: panel.hidden,
                    state: panel.getAttribute(
                      "data-account-state"
                    ),
                    busy: panel.getAttribute("aria-busy")
                  },
                  status: document.querySelector(
                    "[data-alakazam-load-state]"
                  )?.textContent.trim(),
                  form: Boolean(document.querySelector(
                    "[data-alakazam-site-form]"
                  )),
                  body: document.querySelector(
                    "[data-alakazam-body]"
                  )?.textContent.trim(),
                  state: globalThis
                    .SiteSourceryAbracadabraHostedSession
                    .getState()
                };
              })()`
            );
            throw new Error(
              `${error.message}; Alakazam panel ` +
                `${JSON.stringify(diagnosis)}; API requests ` +
                `${JSON.stringify(browserServer.apiRequests)}; ` +
                `browser errors ${JSON.stringify(browserErrors)}`
            );
          }
          async function accountLayout() {
            return evaluate(
              `(() => {
                const panel = document.querySelector(
                  "[data-alakazam-account]"
                );
                const input = document.querySelector(
                  "[data-alakazam-address-label]"
                );
                const bounds = panel.getBoundingClientRect();
                return {
                  width: innerWidth,
                  documentFits:
                    document.documentElement.scrollWidth <=
                    innerWidth,
                  panelFits:
                    bounds.left >= 0 &&
                    bounds.right <= innerWidth + 1,
                  setupVisible:
                    Boolean(input) &&
                    input.getClientRects().length > 0,
                  setupLabelled:
                    input?.labels?.[0]?.textContent.trim() ===
                    "Platform address label"
                };
              })()`
            );
          }
          assert.deepEqual(await accountLayout(), {
            width: 390,
            documentFits: true,
            panelFits: true,
            setupVisible: true,
            setupLabelled: true
          });
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {
              width: 1440,
              height: 1000,
              deviceScaleFactor: 1,
              mobile: false,
              screenWidth: 1440,
              screenHeight: 1000
            }
          );
          await cdp.send(
            "Emulation.setTouchEmulationEnabled",
            { enabled: false, maxTouchPoints: 1 }
          );
          await evaluate(
            `new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(resolve)))`,
            true
          );
          assert.deepEqual(await accountLayout(), {
            width: 1440,
            documentFits: true,
            panelFits: true,
            setupVisible: true,
            setupLabelled: true
          });
          await cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {
              width: 390,
              height: 844,
              deviceScaleFactor: 1,
              mobile: true,
              screenWidth: 390,
              screenHeight: 844
            }
          );
          await cdp.send(
            "Emulation.setTouchEmulationEnabled",
            { enabled: true, maxTouchPoints: 5 }
          );
          await evaluate(
            `(() => {
              const input = document.querySelector(
                "[data-alakazam-address-label]"
              );
              Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value"
              ).set.call(input, ${JSON.stringify(hostedLabel)});
              input.dispatchEvent(
                new Event("input", { bubbles: true })
              );
              document.querySelector(
                "[data-alakazam-site-form]"
              ).requestSubmit();
              return true;
            })()`
          );
          await waitFor(
            `document.querySelector("[data-alakazam-load-state]")` +
              `.textContent.includes("loaded") && ` +
              `document.querySelector("[data-alakazam-body]")` +
              `.textContent.includes(` +
              `${JSON.stringify(`${hostedLabel}.sitesourcery.me`)}) && ` +
              `document.querySelector("[data-alakazam-account]")` +
              `.getAttribute("aria-busy") === "false"`,
            10000
          );
          const configuredAccount = await evaluate(
            `(async () => {
              const response = await fetch(
                "/api/v1/projects/" +
                  ${JSON.stringify(savedState.project.id)} +
                  "/alakazam",
                { credentials: "same-origin" }
              );
              return {
                status: response.status,
                body: await response.json()
              };
            })()`,
            true
          );
          assert.equal(configuredAccount.status, 200);
          assert.equal(
            configuredAccount.body.site.state,
            "ready_for_checkout"
          );
          assert.equal(
            configuredAccount.body.site.addressLabel,
            hostedLabel
          );
          assert.equal(
            configuredAccount.body.site.hostname,
            `${hostedLabel}.sitesourcery.me`
          );
          assert.match(
            configuredAccount.body.site.setupDigest,
            /^[a-f0-9]{64}$/u
          );
          assert.equal(
            configuredAccount.body.actions.start,
            true
          );
          const addressProof = await pool.query(
            `select address.label,
                    address.serving_hostname,
                    address.state
               from ss.project_address_projection projection
               join ss.project_addresses address
                 on address.organization_id =
                    projection.organization_id
                and address.project_id = projection.project_id
                and address.id = projection.current_address_id
              where projection.organization_id = $1
                and projection.project_id = $2`,
            [
              savedState.project.organizationId,
              savedState.project.id
            ]
          );
          assert.deepEqual(addressProof.rows, [
            {
              label: hostedLabel,
              serving_hostname:
                `${hostedLabel}.sitesourcery.me`,
              state: "configured"
            }
          ]);

          commerceV2ClockNow = new Date().toISOString();
          const browserCheckout = await evaluate(
            `(async () => {
              const control = globalThis
                .SiteSourceryAbracadabraHostedSession;
              try {
                await control.quoteDownload();
                return control.prepareDownloadCheckout();
              } catch (error) {
                return {
                  browserError: {
                    name: error?.name,
                    code: error?.code,
                    message: error?.message,
                    status: error?.status,
                    requestId: error?.requestId
                  },
                  state: control.getState()
                };
              }
            })()`,
            true
          );
          assert.equal(
            browserCheckout.browserError,
            undefined,
            JSON.stringify(browserCheckout)
          );
          assert.equal(browserCheckout.state, "ready");
          const browserCheckoutId =
            browserCheckout.checkout.id;
          const browserDownloadRequest =
            payment.calls.downloadCheckout.at(-1);
          assert.equal(
            browserDownloadRequest.purpose.projectId,
            savedState.project.id
          );
          const browserDownloadPurpose =
            browserDownloadRequest.purpose;
          const browserDownloadMetadata = {
            schema: "sitesourcery_download_checkout_v2",
            tenant_id:
              browserDownloadPurpose.tenantId,
            customer_id:
              browserDownloadPurpose.customerId,
            project_id:
              browserDownloadPurpose.projectId,
            version_id:
              browserDownloadPurpose.versionId,
            quote_id:
              browserDownloadPurpose.quoteId,
            offer_id:
              browserDownloadPurpose.offerId,
            entitlement_kind:
              browserDownloadPurpose.entitlementKind,
            accepted_disclosure_digest:
              browserDownloadPurpose
                .acceptedDisclosureDigest,
            quote_snapshot_digest:
              browserDownloadPurpose
                .quoteSnapshotDigest,
            purpose_digest:
              browserDownloadRequest.purposeDigest
          };
          await navigate(
            `${appUrl}?checkout=${encodeURIComponent(
              browserCheckoutId
            )}&download_project=${encodeURIComponent(
              savedState.project.id
            )}`
          );
          await waitFor(
            `document.documentElement.getAttribute(` +
              `"data-abracadabra-control-ready") === "hosted" ` +
              `&& document.getElementById("platform-status")` +
              `.textContent.includes("Checking Stripe")`,
            10000
          );
          assert.equal(
            await evaluate(`location.search`),
            ""
          );
          const browserDownloadPaid = stripeEvent(
            "evt_test_browser_download_paid_1",
            "checkout.session.completed",
            {
              id: browserCheckoutId,
              metadata: browserDownloadMetadata
            }
          );
          browserDownloadPaid.created = Math.floor(
            Date.parse(commerceV2ClockNow) / 1000
          );
          assert.equal(
            (
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(browserDownloadPaid),
                signature:
                  "contract-signature-valid"
              })
            ).status,
            "processed"
          );
          await waitFor(
            `document.querySelector(` +
              `"[data-customer-stage=download]").hidden === false ` +
              `&& document.querySelector("[data-download-html]")` +
              `.disabled === false ` +
              `&& document.getElementById("platform-status")` +
              `.textContent.includes("Download is ready")`,
            10000
          );
          const downloadReturnState = await evaluate(
            `globalThis.SiteSourceryAbracadabraHostedSession.getState()`
          );
          assert.equal(
            downloadReturnState.project.id,
            savedState.project.id
          );
          assert.equal(
            downloadReturnState.project.entitlements.length,
            1
          );
          assert.equal(
            downloadReturnState.project.entitlements[0]
              .payment.totalMinor,
            500
          );
          const downloadedHtml = await evaluate(
            `(async () => {
              const entitlement = globalThis
                .SiteSourceryAbracadabraHostedSession
                .getState().project.entitlements[0];
              const response = await fetch(
                entitlement.downloadUrl,
                { credentials: "same-origin" }
              );
              return {
                status: response.status,
                contentType:
                  response.headers.get("content-type"),
                disposition:
                  response.headers.get("content-disposition"),
                html: await response.text()
              };
            })()`,
            true
          );
          assert.equal(downloadedHtml.status, 200);
          assert.equal(
            downloadedHtml.contentType,
            "text/html; charset=utf-8"
          );
          assert.match(
            downloadedHtml.disposition,
            /^attachment; filename="sitesourcery-/u
          );
          assert.match(
            downloadedHtml.html,
            /Shipped Browser Workshop/u
          );

          await evaluate(
            `document.querySelector("[data-sign-out]").click()`
          );
          await waitFor(
            `document.querySelector("[data-session-bar]").hidden === true ` +
              `&& globalThis.SiteSourceryAbracadabraHostedSession` +
              `.getState().account === null`
          );
          assert.equal(
            (await cdp.send("Network.getAllCookies"))
              .cookies.some(
                (cookie) => cookie.name === "ss_session"
              ),
            false
          );

          await evaluate(
            `(() => {
              document.getElementById("auth-sign-in-tab").click();
              const values = ${JSON.stringify({
                signInEmail: email,
                signInPassword: password
              })};
              for (const [name, value] of Object.entries(values)) {
                const field = document.querySelector(
                  '[name="' + name + '"]'
                );
                Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
                ).set.call(field, value);
                field.dispatchEvent(
                  new Event("input", { bubbles: true })
                );
              }
              document.querySelector("[data-sign-in]").click();
              return true;
            })()`
          );
          await waitFor(
            `document.querySelector("[data-session-bar]").hidden === false ` +
              `&& globalThis.SiteSourceryAbracadabraHostedSession` +
              `.getState().account?.email === ${JSON.stringify(email)}`
          );
          assert.equal(
            (
              await pool.query(
                `select count(*)::integer as active_sessions
                   from ss.hosted_sessions session
                   join auth.users users
                     on users.id = session.user_id
                  where lower(users.email) = $1
                    and session.revoked_at is null`,
                [email]
              )
            ).rows[0].active_sessions,
            1
          );

          const forbiddenEffects =
            browserServer.apiRequests.filter(
              ({ pathname }) =>
                /billing|domain|webhooks|publish|rollback/iu
                  .test(pathname)
            );
          assert.deepEqual(forbiddenEffects, []);
          assert.ok(
            browserServer.apiRequests.some(
              ({ method, pathname }) =>
                method === "POST" &&
                pathname.endsWith("/download-quotes")
            )
          );
          assert.ok(
            browserServer.apiRequests.some(
              ({ method, pathname }) =>
                method === "POST" &&
                pathname.endsWith("/checkout-command")
            )
          );
          assert.ok(
            browserServer.apiRequests.some(
              ({ method, pathname }) =>
                method === "GET" &&
                pathname.endsWith("/download")
            )
          );
          assert.deepEqual(browserServer.missingFiles, []);
          await evaluate(
            `new Promise((resolve) => setTimeout(resolve, 100))`,
            true
          );
          assert.deepEqual(
            [...new Set(browserErrors)],
            []
          );
        } finally {
          if (reviewedBrowser) {
            await reviewedBrowser.close();
          }
          await browserServer.close();
        }
      }
    );
    await authority.close();
  }
);
