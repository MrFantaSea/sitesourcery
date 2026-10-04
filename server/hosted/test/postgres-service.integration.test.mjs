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
import {
  createPostgresEngagementBootstrapRepository
} from "../engagement-bootstrap-postgres.mjs";
import {
  createHostedEngagementBootstrap
} from "../engagement-bootstrap.mjs";
import {
  createHostedCustomServicesAccount
} from "../custom-services-account-hosted.mjs";
import {
  createPostgresCustomServicesAccountRepository
} from "../custom-services-account-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentQuoteRepository
} from "../custom-services-assessment-quote-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentPayment
} from "../custom-services-assessment-payment-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentSettlement
} from "../custom-services-assessment-settlement-postgres.mjs";
import {
  createHeldCustomServicesAssessmentWork
} from "../custom-services-assessment-work-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuild
} from "../custom-services-custom-build-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildPayment
} from "../custom-services-custom-build-payment-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildProgress
} from "../custom-services-custom-build-progress-postgres.mjs";
import {
  createPostgresCustomServicesInvoiceRepository
} from "../custom-services-invoice-postgres.mjs";
import {
  createPostgresCustomServicesRequestRepository
} from "../custom-services-request-postgres.mjs";
import {
  createPostgresCustomServicesOwner
} from "../custom-services-owner-postgres.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import {
  createPostgresProjectLifecycleRepository,
  createProjectLifecycleExecutor
} from "../project-lifecycle-postgres.mjs";
import { createHostedApi } from "../http.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import {
  createDurableRecoveryMailPort,
  createDurableRegistrationMailPort
} from "../mail-delivery-bridge.mjs";
import { createMailLifecycle } from "../mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "../mail-lifecycle-postgres.mjs";
import { createNodeHandler } from "../node-handler.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import {
  createProjectLegalAuthorityV7
} from "../project-legal-authority.mjs";
import { createAesGcmContactVault } from "../production-ports.mjs";
import {
  createDevelopmentRecoveryMailSink,
  createProductionRecoveryMailPort
} from "../recovery-mail-port.mjs";
import {
  createDevelopmentRegistrationMailSink,
  createProductionRegistrationMailPort
} from "../registration-mail-port.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import {
  createAdjacentIntegrationService
} from "../adjacent-integration.mjs";
import {
  createPostgresAdjacentIntegrationRepository
} from "../adjacent-integration-postgres.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";
import { createSparkCompilerPort } from "../spark-compiler-port.mjs";
import { createStripeWebhookRouter } from "../stripe-webhook-router.mjs";
import { createSupportCaseService } from "../support-cases.mjs";
import { createPostgresSupportCaseRepository } from "../support-cases-postgres.mjs";
import { openReviewedBrowser } from "./reviewed-browser-support.mjs";

const { Pool } = pg;
const require = createRequire(import.meta.url);
const AbracadabraAPI = require(
  "../../../abracadabra/app/abracadabra-api.js"
);
const DATABASE_URL =
  process.env.SITESOURCERY_PG_SERVICE_TEST_URL ?? null;
const CORE_REVENUE_E2E_ONLY =
  process.env.SITESOURCERY_CORE_REVENUE_E2E_ONLY === "1";
const DELETION_UPGRADE_PROOF = process.env.SITESOURCERY_DELETION_UPGRADE_PROOF === "1";
const RETAINED_PURGE_MIGRATION = "202609210150_download_retained_project_purge.sql";

// Capture one fixture epoch per process. Identity and authority SQL intentionally
// use the database wall clock, so a historical fixed date expires valid sessions.
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
const fromNow = (milliseconds) =>
  new Date(Date.parse(NOW) + milliseconds).toISOString();
const downloadRequestEvidence = Object.freeze({
  requestId: "core-download-local-request",
  clientAddress: "127.0.0.1",
  userAgentDigest: createHash("sha256").update("local-contract-client").digest("hex")
});
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

async function eventually(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createContractPaymentProvider() {
  const calls = {
    assessmentCheckout: [],
    assessmentReadback: [],
    assessmentLifecycle: [],
    checkout: [],
    downloadCheckout: [],
    downloadReadback: [],
    downloadLifecycle: [],
    portal: [],
    cancellation: [],
    webhook: []
  };
  let checkoutSequence = 0;
  let assessmentCheckoutSequence = 0;
  let downloadCheckoutSequence = 0;
  let portalSequence = 0;
  let cancellationFailure = null;
  let nextDownloadCheckoutExpiresAt =
    "2099-07-28T20:30:00.000Z";
  const downloadCheckouts = new Map();
  const assessmentCheckouts = new Map();
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
          taxModes: {
            download: "disabled_by_owner"
          }
        };
      },
      async readinessForPurpose(purpose) {
        assert.equal(purpose, "download");
        return {
          ready: true,
          provider: "stripe",
          mode: "contract_test",
          livemode: false,
          purpose,
          taxModes: {
            download: "disabled_by_owner"
          }
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
            fromNow(30 * 60 * 1000)
        };
      },
      async createServiceAssessmentCheckout(input) {
        calls.assessmentCheckout.push(
          structuredClone(input)
        );
        assessmentCheckoutSequence += 1;
        const checkoutId =
          `cs_test_assessment_${assessmentCheckoutSequence}`;
        assessmentCheckouts.set(
          checkoutId,
          {
            request: structuredClone(input),
            lifecycle: "open"
          }
        );
        return {
          checkoutId,
          url:
            `https://checkout.stripe.com/c/pay/${checkoutId}`,
          expiresAt:
            "2099-07-28T20:30:00.000Z"
        };
      },
      async retrieveServiceAssessmentPayment(input) {
        calls.assessmentReadback.push(
          structuredClone(input)
        );
        const created = assessmentCheckouts.get(
          input.checkoutSessionId
        );
        assert.ok(created);
        assert.equal(
          input.purposeDigest,
          commerceDigest(created.request.purpose)
        );
        assert.deepEqual(
          input.purpose,
          created.request.purpose
        );
        const facts = {
          schema:
            "sitesourcery.stripe-service-assessment-payment-facts/v1",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId:
            `pi_test_assessment_${assessmentCheckoutSequence}`,
          customerId:
            `cus_test_assessment_${assessmentCheckoutSequence}`,
          paymentStatus: "paid",
          subtotalMinor: 35000,
          taxMinor: 0,
          totalMinor: 35000,
          taxMode: "disabled_by_owner",
          currency: "USD",
          purposeDigest: input.purposeDigest,
          providerPaymentTime: NOW
        };
        facts.providerFactsDigest =
          commerceDigest(facts);
        return facts;
      },
      async retrieveServiceAssessmentCheckoutLifecycle(input) {
        calls.assessmentLifecycle.push(
          structuredClone(input)
        );
        const created = assessmentCheckouts.get(
          input.checkoutSessionId
        );
        assert.ok(created);
        return {
          schema:
            "sitesourcery.stripe-service-assessment-checkout-lifecycle/v1",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          purposeDigest: input.purposeDigest,
          state: created.lifecycle
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
        const billingIdentity = {
          email: input.checkoutIdentity.email,
          name: "Synthetic customer",
          address: {
            city: "Mickleton", country: "US", line1: "1 Test Street",
            line2: null, postalCode: "08056", state: "NJ"
          }
        };
        return {
          verifiedEmailDigest: input.checkoutIdentity.emailDigest,
          accountCreatedAt: input.checkoutIdentity.accountCreatedAt,
          accountActivatedAt: input.checkoutIdentity.activatedAt,
          possessionEvidenceDigest: input.checkoutIdentity.possessionEvidenceDigest,
          billingIdentity,
          billingIdentityDigest: commerceDigest(billingIdentity),
          threeDS: { requested: "any", supported: true, result: "authenticated" },
          chargeId: `ch_test_download_${checkoutNumber}`,
          riskLevel: "normal",
          riskScore: 10,
          schema:
            "sitesourcery.stripe-download-payment-facts/v2",
          provider: "stripe",
          checkoutSessionId: input.checkoutSessionId,
          paymentIntentId:
            `pi_test_download_${checkoutNumber}`,
          customerId:
            `cus_test_hosted_customer_${checkoutNumber}`,
          paymentStatus: "paid",
          amountMinor: 2000,
          taxMinor: 0,
          totalMinor: 2000,
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
            fromNow(31 * 24 * 60 * 60 * 1000)
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
    if (DELETION_UPGRADE_PROOF && name === RETAINED_PURGE_MIGRATION) continue;
    if (beforeMigration) {
      await beforeMigration(name, pool);
    }
    await pool.query(await readFile(new URL(name, MIGRATIONS), "utf8"));
  }
}

async function assertExactTablePrivilegeAllowlist(
  pool,
  {
    label,
    tableNames,
    serviceInsert,
    serviceUpdate
  }
) {
  const names = [...tableNames].sort();
  const result = await pool.query(
    `select expected.table_name,
            relation.relrowsecurity as row_security,
            relation.relforcerowsecurity as force_row_security,
            has_table_privilege(
              'service_role', relation.oid, 'SELECT'
            ) as service_select,
            has_table_privilege(
              'service_role', relation.oid, 'INSERT'
            ) as service_insert,
            has_table_privilege(
              'service_role', relation.oid, 'UPDATE'
            ) as service_update,
            has_table_privilege(
              'service_role', relation.oid, 'DELETE'
            ) as service_delete,
            has_table_privilege(
              'service_role', relation.oid, 'TRUNCATE'
            ) as service_truncate,
            has_table_privilege(
              'authenticated', relation.oid, 'SELECT'
            ) as authenticated_select,
            has_table_privilege(
              'authenticated', relation.oid, 'INSERT'
            ) as authenticated_insert,
            has_table_privilege(
              'authenticated', relation.oid, 'UPDATE'
            ) as authenticated_update,
            has_table_privilege(
              'authenticated', relation.oid, 'DELETE'
            ) as authenticated_delete,
            has_table_privilege(
              'anon', relation.oid, 'SELECT'
            ) as anon_select,
            has_table_privilege(
              'anon', relation.oid, 'INSERT'
            ) as anon_insert,
            has_table_privilege(
              'anon', relation.oid, 'UPDATE'
            ) as anon_update,
            has_table_privilege(
              'anon', relation.oid, 'DELETE'
            ) as anon_delete
       from unnest($1::text[]) expected(table_name)
       join pg_namespace namespace
         on namespace.nspname = 'ss'
       join pg_class relation
         on relation.relnamespace = namespace.oid
        and relation.relname = expected.table_name
        and relation.relkind = 'r'
      order by expected.table_name`,
    [names]
  );
  assert.equal(
    result.rowCount,
    names.length,
    `${label} must retain every canonical table`
  );
  assert.deepEqual(
    result.rows.map(({ table_name: tableName }) => tableName),
    names,
    `${label} table order must remain canonical`
  );
  const granted = (field) =>
    result.rows
      .filter((row) => row[field] === true)
      .map(({ table_name: tableName }) => tableName);
  assert.deepEqual(
    granted("service_select"),
    names,
    `${label} service SELECT allowlist changed`
  );
  assert.deepEqual(
    granted("service_insert"),
    [...serviceInsert].sort(),
    `${label} service INSERT allowlist changed`
  );
  assert.deepEqual(
    granted("service_update"),
    [...serviceUpdate].sort(),
    `${label} service UPDATE allowlist changed`
  );
  for (const field of [
    "service_delete",
    "service_truncate",
    "authenticated_select",
    "authenticated_insert",
    "authenticated_update",
    "authenticated_delete",
    "anon_select",
    "anon_insert",
    "anon_update",
    "anon_delete"
  ]) {
    assert.deepEqual(
      granted(field),
      [],
      `${label} unexpectedly grants ${field}`
    );
  }
  assert.equal(
    result.rows.every(
      ({ row_security: rowSecurity }) => rowSecurity === true
    ),
    true,
    `${label} must keep row-level security enabled`
  );
  assert.equal(
    result.rows.every(
      ({ force_row_security: forceRowSecurity }) =>
        forceRowSecurity === true
    ),
    true,
    `${label} must keep row-level security forced`
  );
}

function acceptanceForDisposableProjectAuthority(authority) {
  return Object.freeze({
    schema: authority.schema.replace(
      "sitesourcery.project-legal-authority/",
      "sitesourcery.project-legal-acceptance/"
    ),
    acceptanceStatement: authority.acceptanceStatement,
    authorityDigest: authority.authorityDigest,
    documents: Object.freeze(
      authority.documents.map((document) =>
        Object.freeze({ ...document })
      )
    )
  });
}

function releasedProjectLegalV7Authority() {
  return createProjectLegalAuthorityV7({
    privacyV7: {
      version: "SS-HOSTED-PRIVACY-2026-08-31-V7",
      contentDigest:
        "084788116b8d59f2e75faedd7cfad5ea14f007782c2a84679287f0d064753b99",
      contentUri:
        "https://sitesourcery.com/legal/privacy/versions/" +
        "SS-HOSTED-PRIVACY-2026-08-31-V7/",
      effectiveAt: "2026-09-01T04:00:00.000Z",
      byteCount: 24139,
      artifactUri:
        "https://sitesourcery.com/legal/privacy/versions/" +
        "SS-HOSTED-PRIVACY-2026-08-31-V7/"
    },
    websiteTermsV7: {
      version: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
      contentDigest:
        "f09386d70465ccd1f491c69efefe20f8c89ca9c46d03a7ac9f58990317adfd19",
      contentUri:
        "https://sitesourcery.com/legal/website-terms/versions/" +
        "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/",
      effectiveAt: "2026-09-01T04:00:00.000Z",
      byteCount: 27358,
      artifactUri:
        "https://sitesourcery.com/legal/website-terms/versions/" +
        "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/"
    },
    authorityDigest:
      "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
  });
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
        fromNow(31 * 24 * 60 * 60 * 1000)
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
    projectLegalAuthorityMatches(expected) {
      return authority.projectLegalAuthorityMatches(expected);
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
    const databaseWasPreMigrated = (
      await pool.query(
        "select to_regnamespace('ss') is not null as migrated"
      )
    ).rows[0].migrated;
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
    await assertExactTablePrivilegeAllowlist(pool, {
      label: "custom-services foundation",
      tableNames: [
        "service_catalog_policies",
        "service_catalog_coverage",
        "service_project_profiles",
        "operator_profiles",
        "operator_permissions",
        "service_cases",
        "service_case_offerings",
        "service_intakes",
        "service_documents",
        "service_access_requests"
      ],
      serviceInsert: [
        "service_project_profiles",
        "service_cases",
        "service_case_offerings",
        "service_intakes",
        "service_documents",
        "service_access_requests"
      ],
      serviceUpdate: [
        "service_project_profiles",
        "service_cases",
        "service_case_offerings"
      ]
    });
    await assertExactTablePrivilegeAllowlist(pool, {
      label: "custom-build quote credit",
      tableNames: [
        "service_custom_build_quotes",
        "service_custom_build_quote_revisions",
        "service_custom_build_quote_base_lines",
        "service_custom_build_quote_installments",
        "service_custom_build_quote_commands",
        "service_custom_build_quote_acceptances",
        "service_credit_applications",
        "service_custom_build_quote_voids"
      ],
      serviceInsert: [
        "service_custom_build_quotes",
        "service_custom_build_quote_revisions",
        "service_custom_build_quote_commands",
        "service_custom_build_quote_acceptances",
        "service_custom_build_quote_voids"
      ],
      serviceUpdate: ["service_credit_applications"]
    });
    assert.deepEqual(
      (
        await pool.query(
          `select
             not has_function_privilege(
               'service_role',
               'ss.materialize_service_custom_build_quote()',
               'EXECUTE'
             ) as quote_fenced,
             not has_function_privilege(
               'service_role',
               'ss.materialize_service_custom_build_acceptance()',
               'EXECUTE'
             ) as acceptance_fenced,
             not has_function_privilege(
               'service_role',
               'ss.materialize_service_custom_build_quote_void()',
               'EXECUTE'
             ) as void_fenced`
        )
      ).rows[0],
      {
        quote_fenced: true,
        acceptance_fenced: true,
        void_fenced: true
      }
    );
    const currentAuthority = createCanonicalPostgresAuthority({ pool });
    let awaitingRetentionUpgrade = DELETION_UPGRADE_PROOF;
    // Build the pre-150 population under its prior runtime readiness contract.
    // The new runtime is checked separately and must reject that exact schema.
    // No database query, service transaction, or financial result is mocked.
    const authority = DELETION_UPGRADE_PROOF ? {
      ...currentAuthority,
      async readiness() {
        const result = await currentAuthority.readiness();
        if (!awaitingRetentionUpgrade) return result;
        assert.equal(result.code, "DATABASE_NOT_MIGRATED");
        assert.deepEqual(result.missing, ["commerce_v2_retained_purge_contract"]);
        const { code, ...priorContract } = result;
        return { ...priorContract, ready: true, missing: [] };
      }
    } : currentAuthority;
    if (DELETION_UPGRADE_PROOF) {
      assert.equal(databaseWasPreMigrated, false, "upgrade proof requires its own empty database");
      assert.deepEqual((await currentAuthority.readiness()).missing, ["commerce_v2_retained_purge_contract"]);
    } else {
      assert.equal((await authority.assertReady()).ready, true);
    }
    const recoveredLegacy = await pool.query(
      `select *
         from ss.export_requests
        where id = $1`,
      [legacyExport.exportId]
    );
    if (databaseWasPreMigrated) {
      assert.equal(
        recoveredLegacy.rowCount,
        0,
        "the verifier-prepared database must not synthesize the legacy export fixture"
      );
    } else {
      assert.equal(recoveredLegacy.rowCount, 1);
      assert.equal(recoveredLegacy.rows[0].state, "failed");
      assert.equal(
        recoveredLegacy.rows[0].attempt_number,
        "1"
      );
      assert.equal(
        recoveredLegacy.rows[0].fence_token,
        "1"
      );
      assert.equal(recoveredLegacy.rows[0].worker_id, null);
      assert.equal(recoveredLegacy.rows[0].object_key, null);
      assert.equal(
        recoveredLegacy.rows[0].failure_code,
        "EXPORT_LEGACY_BUILD_ORPHANED"
      );
      assert.deepEqual(recoveredLegacy.rows[0].failure_facts, {
        phase: "migration",
        certainty: "ambiguous",
        objectKey:
          `exports/${legacyExport.organizationId}/` +
          `${legacyExport.projectId}/${legacyExport.exportId}.zip`,
        recovery: "manual_retry_required"
      });
    }
    const catalog = createFakeApprovedCatalog();
    await seedCommercialAuthority(pool, catalog);
    const root = await mkdtemp(
      path.join(os.tmpdir(), "sitesourcery-pg-service-")
    );
    const clock = { now: () => NOW };
    const mailLifecycle = createMailLifecycle({
      repository: createPostgresMailLifecycleRepository({
        authority
      }),
      clock
    });
    const productionRecoveryPort = (transport) =>
      createDurableRecoveryMailPort({
        lifecycle: mailLifecycle,
        providerPort: createProductionRecoveryMailPort({
          clock,
          transport
        }),
        clock
      });
    const registrationSink =
      createDevelopmentRegistrationMailSink({
        registrationBaseUrl:
          "https://staging.sitesourcery.test/abracadabra/app/",
        clock
      });
    const identityPepper = randomBytes(32);
    const identity = createPostgresIdentityBridge({
      pool,
      authority,
      pepper: identityPepper,
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
    const projectLegalAuthorityConfig = Object.freeze({
      authority: releasedProjectLegalV7Authority(),
      diagnostic: null
    });
    let engagementClockNow = NOW;
    const engagementBootstrap =
      projectLegalAuthorityConfig.authority
        ? createHostedEngagementBootstrap({
            repository:
              createPostgresEngagementBootstrapRepository({
                authority,
                legalAuthority:
                  projectLegalAuthorityConfig.authority,
                pepper: identityPepper,
                pepperVersion: "test-v1",
                clock: () => new Date(engagementClockNow)
              }),
            legalAuthority:
              projectLegalAuthorityConfig.authority,
            tokenSecret: randomBytes(32),
            clock: () => new Date(engagementClockNow)
          })
        : null;
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
      projectLegalAuthority:
        projectLegalAuthorityConfig.authority,
      projectLegalAuthorityDiagnostic:
        projectLegalAuthorityConfig.diagnostic,
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
    const assessmentPaymentRelease = Object.freeze({
      approved: true,
      amountMinor: 35000,
      currency: "USD",
      taxMode: "disabled_by_owner"
    });
    const assessmentSettlement =
      createPostgresCustomServicesAssessmentSettlement({
        authority,
        provider: payment.port,
        clock: commerceV2.clock,
        ids: commerceV2.ids
      });
    const assessmentPayment =
      createPostgresCustomServicesAssessmentPayment({
        authority,
        provider: payment.port,
        release: assessmentPaymentRelease,
        reconciliation: assessmentSettlement
      });
    const customServicesCustomBuild =
      createPostgresCustomServicesCustomBuild({ authority });
    const customBuildProviderCalls = [];
    const customServicesCustomBuildPayment =
      createPostgresCustomServicesCustomBuildPayment({
        authority,
        provider: {
          async createCustomBuildStartCheckout(...args) {
            customBuildProviderCalls.push(["create", args]);
            throw new Error("held Custom provider must not be reached");
          },
          async retrieveCustomBuildStartPayment(...args) {
            customBuildProviderCalls.push(["payment-readback", args]);
            throw new Error("held Custom provider must not be reached");
          },
          async retrieveCustomBuildStartCheckoutLifecycle(...args) {
            customBuildProviderCalls.push(["lifecycle-readback", args]);
            throw new Error("held Custom provider must not be reached");
          }
        },
        release: {
          approved: false,
          currency: "USD",
          paymentWindowDays: 7,
          taxMode: "disabled_by_owner"
        },
        clock: commerceV2.clock,
        ids: commerceV2.ids
      });
    const customServicesAccount =
      createHostedCustomServicesAccount({
        assessmentWork:
          createHeldCustomServicesAssessmentWork(),
        customBuild: customServicesCustomBuild,
        customBuildPayment: customServicesCustomBuildPayment,
        customBuildProgress:
          createHeldCustomServicesCustomBuildProgress(),
        invoiceRepository:
          createPostgresCustomServicesInvoiceRepository({
            authority,
            release: assessmentPaymentRelease
          }),
        payment: assessmentPayment,
        quoteRepository:
          createPostgresCustomServicesAssessmentQuoteRepository({
            authority
          }),
        requestRepository:
          createPostgresCustomServicesRequestRepository({
            authority
          }),
        repository:
          createPostgresCustomServicesAccountRepository({
            authority
          }),
        resolveSession: commerceV2.resolveSession
      });
    const customServicesOwner =
      createPostgresCustomServicesOwner({ authority });
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
        ingestStripeEvent:
          assessmentSettlement.ingestStripeEvent.bind(
            assessmentSettlement
          )
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
      professionalReversal: {
        async ingestStripeEvent() {
          return { status: "not_professional_reversal" };
        }
      },
      alakazamCommerce: {
        async ingestStripeEvent() {
          return { status: "not_alakazam" };
        }
      },
      alakazamLifecycle: {
        finalization: {
          async ingestStripeEvent() {
            return { status: "not_alakazam_finalization" };
          }
        },
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
    const productionRegistrationSends = [];
    const productionRegistrationPort =
      createDurableRegistrationMailPort({
        lifecycle: mailLifecycle,
        providerPort: createProductionRegistrationMailPort({
          clock,
          transport: {
            async readiness() {
              return {
                ready: true,
                verified: true,
                provider: "integration-mail"
              };
            },
            async sendRegistration(input) {
              productionRegistrationSends.push(input);
              return {
                accepted: true,
                provider: "integration-mail",
                providerMessageId:
                  "registration_message_integration_1",
                idempotencyKey: input.idempotencyKey,
                payloadDigest: input.payloadDigest,
                acceptedAt: NOW
              };
            }
          }
        }),
        clock
      });
    const productionRegistrationIdentity =
      createPostgresIdentityBridge({
        pool,
        authority,
        pepper: randomBytes(32),
        pepperVersion: "production-test-v1",
        clock: () => new Date(NOW),
        registrationMailPort: productionRegistrationPort
      });
    const productionRegistrationService =
      createCanonicalPostgresService({
        ...serviceOptions,
        identity: productionRegistrationIdentity,
        recoveryMailPort: recoverySink
      });
    const productionRegistrationEmail =
      `production-owner-${randomUUID()}@example.test`;
    await productionRegistrationService.register({
      name: "Production Test Owner",
      organizationName: "Production Test Organization",
      email: productionRegistrationEmail,
      password: "production correct horse battery staple",
      commandId: "registration-production-owner-001"
    });
    assert.equal(productionRegistrationSends.length, 1);
    const acceptedRegistration = (
      await pool.query(
        `select
           request.state,
           request.mail_delivery_id,
           request.delivered_at,
           request.possession_proven_at,
           mail.state as mail_state,
           (select count(*)::integer
              from auth.users
             where lower(email) = $1) as account_count,
           (select count(*)::integer
              from ss.hosted_sessions session
              join auth.users account
                on account.id = session.user_id
             where lower(account.email) = $1) as session_count
         from ss.hosted_registration_requests request
         join ss.hosted_mail_deliveries mail
           on mail.id = request.mail_delivery_id
        where request.command_id = $2`,
        [
          productionRegistrationEmail,
          "registration-production-owner-001"
        ]
      )
    ).rows[0];
    assert.equal(acceptedRegistration.state, "provider_accepted");
    assert.equal(acceptedRegistration.mail_state, "provider_accepted");
    assert.equal(acceptedRegistration.delivered_at, null);
    assert.equal(acceptedRegistration.possession_proven_at, null);
    assert.equal(acceptedRegistration.account_count, 0);
    assert.equal(acceptedRegistration.session_count, 0);
    await assert.rejects(
      productionRegistrationService.completeRegistration({
        token: "m".repeat(43),
        commandId: "registration-production-wrong-001"
      }),
      (error) => error?.code === "REGISTRATION_TOKEN_INVALID"
    );
    const productionRegistrationToken = decodeURIComponent(
      new URL(
        productionRegistrationSends[0].verificationUrl
      ).hash.slice("#verify-registration=".length)
    );
    await productionRegistrationService.completeRegistration({
      token: productionRegistrationToken,
      commandId: "registration-production-activate-001"
    });
    const activatedRegistration = (
      await pool.query(
        `select
           state, delivered_at,
           possession_evidence_digest,
           possession_proven_at
         from ss.hosted_registration_requests
        where command_id = $1`,
        ["registration-production-owner-001"]
      )
    ).rows[0];
    assert.equal(activatedRegistration.state, "activated");
    assert.ok(activatedRegistration.possession_evidence_digest);
    assert.deepEqual(
      activatedRegistration.delivered_at,
      activatedRegistration.possession_proven_at
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
      fromNow(30 * 60 * 1000)
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
        recoveryMailPort: productionRecoveryPort({
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
    const acceptedRecovery = (
      await pool.query(
        `select
           state, delivery_mode, delivery_provider,
           provider_receipt_id, failure_code,
           mail_delivery_id, possession_proven_at
         from ss.hosted_recovery_delivery_requests
        where command_id = $1`,
        ["recovery-request-002"]
      )
    ).rows[0];
    assert.equal(acceptedRecovery.state, "provider_accepted");
    assert.equal(
      acceptedRecovery.delivery_mode,
      "production"
    );
    assert.equal(
      acceptedRecovery.delivery_provider,
      "integration-mail"
    );
    assert.ok(acceptedRecovery.provider_receipt_id);
    assert.ok(acceptedRecovery.mail_delivery_id);
    assert.equal(acceptedRecovery.possession_proven_at, null);
    assert.equal(acceptedRecovery.failure_code, null);
    const productionRecoveryToken = decodeURIComponent(
      new URL(productionSends[0].recoveryUrl).hash.slice(
        "#recovery=".length
      )
    );
    assert.deepEqual(
      await verifiedRecoveryService.completeRecovery({
        token: productionRecoveryToken,
        password: "rotated correct horse battery staple"
      }),
      { completed: true }
    );
    const completedRecovery = (
      await pool.query(
        `select
           request.state,
           request.delivered_at,
           request.possession_evidence_digest,
           request.possession_proven_at,
           mail.state as mail_state
         from ss.hosted_recovery_delivery_requests request
         join ss.hosted_mail_deliveries mail
           on mail.id = request.mail_delivery_id
        where request.command_id = $1`,
        ["recovery-request-002"]
      )
    ).rows[0];
    assert.equal(completedRecovery.state, "delivered");
    assert.equal(completedRecovery.mail_state, "provider_accepted");
    assert.ok(completedRecovery.possession_evidence_digest);
    assert.deepEqual(
      completedRecovery.delivered_at,
      completedRecovery.possession_proven_at
    );
    await assert.rejects(
      verifiedRecoveryService.completeRecovery({
        token: productionRecoveryToken,
        password: "another correct horse battery staple"
      }),
      (error) => error?.code === "RECOVERY_TOKEN_INVALID"
    );

    const restartedProductionSends = [];
    const restartedRecoveryService =
      createCanonicalPostgresService({
        ...serviceOptions,
        recoveryMailPort: productionRecoveryPort({
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
        recoveryMailPort: productionRecoveryPort({
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
        recoveryMailPort: productionRecoveryPort({
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
    assert.deepEqual(
      await service.requestRecovery({
        email: "unknown-owner@example.test",
        commandId: "unknown-recovery-001"
      }),
      {
        accepted: true,
        delivery: "manual_operator",
        emailSent: false
      }
    );
    assert.equal(
      recoverySink.readForTest(
        "unknown-owner@example.test"
      ).length,
      0
    );
    assert.equal(
      (
        await pool.query(
          `select state
             from ss.hosted_recovery_delivery_requests
            where command_id = $1`,
          ["unknown-recovery-001"]
        )
      ).rows[0].state,
      "recipient_unresolved"
    );
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
    const projectLegalAcceptance =
      acceptanceForDisposableProjectAuthority(
        await service.getProjectLegalAuthority()
      );
    const created = await service.createProject(
      actor,
      organizationId,
      {
        name: "Cedar Workshop",
        legalAcceptance: projectLegalAcceptance,
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
      { skip: CORE_REVENUE_E2E_ONLY },
      async () => {
        const first = await service.createProject(
          actor,
          organizationId,
          {
            name: "Idempotency Project A",
            legalAcceptance: projectLegalAcceptance,
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
            legalAcceptance: projectLegalAcceptance,
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
      { skip: CORE_REVENUE_E2E_ONLY },
      async () => {
        const fenceActor = otherActor;
        const fenceOrganizationId =
          otherRegistered.organization.id;
        const fenceProject = await service.createProject(
          fenceActor,
          fenceOrganizationId,
          {
            name: "Alakazam Setup Fence",
            legalAcceptance: projectLegalAcceptance,
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
                taxModes: {
                  alakazam: "disabled_by_owner"
                }
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
                  fromNow(30 * 60 * 1000)
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
      amountMinor: 2000,
      currency: "USD",
      billing: "one_time",
      interval: null
    });
    const downloadCheckoutInput = {
      ...downloadRequestEvidence,
      purchaseTermsAccepted: true,
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
      schema: "sitesourcery_download_checkout_v3",
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
        amountMinor: 2000,
        taxMinor: 0,
        totalMinor: 2000,
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
      version.version.id,
        downloadRequestEvidence
    );
    assert.deepEqual(paidDownload.bytes, compiled.htmlBytes);
    assert.equal(paidDownload.sha256, compiled.artifactDigest);
    assert.deepEqual(
      (
        await downloadCommerce.download(
          actor,
          projectId,
          version.version.id,
        downloadRequestEvidence
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
        amount: 2000,
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
        version.version.id,
        downloadRequestEvidence
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
        amount: 2000,
        amount_refunded: 2000,
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
    const expiryProject = await service.createProject(
      actor,
      organizationId,
      {
        name: "Checkout Expiry Proof",
        legalAcceptance: projectLegalAcceptance,
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
      fromNow(112 * 60 * 60 * 1000);
    payment.setNextDownloadCheckoutExpiry(
      fromNow((112 * 60 + 30) * 60 * 1000)
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
      ...downloadRequestEvidence,
      purchaseTermsAccepted: true,
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
      fromNow(113 * 60 * 60 * 1000);
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
          ...downloadRequestEvidence,
          purchaseTermsAccepted: true,
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
            fromNow(31 * 24 * 60 * 60 * 1000)
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
                    fromNow(31 * 24 * 60 * 60 * 1000)
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
          legalAcceptance: projectLegalAcceptance,
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
      { skip: CORE_REVENUE_E2E_ONLY },
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

        selectedNow = fromNow(2_000);
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
      { skip: CORE_REVENUE_E2E_ONLY },
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

        selectedNow = fromNow(2_000);
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
      { skip: CORE_REVENUE_E2E_ONLY },
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
      { skip: CORE_REVENUE_E2E_ONLY },
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
      { skip: CORE_REVENUE_E2E_ONLY },
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
      { skip: CORE_REVENUE_E2E_ONLY },
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
      { skip: CORE_REVENUE_E2E_ONLY },
      async () => {
        const retentionProject =
          await service.createProject(
            actor,
            organizationId,
            {
              name: "Retention Proof",
              legalAcceptance: projectLegalAcceptance,
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
            fromNow(-60_000),
            fromNow(-8 * 24 * 60 * 60 * 1000),
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
      fromNow(31 * 24 * 60 * 60 * 1000)
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
    await t.test(
      "browser API crosses CSRF, secure cookies, HTTP, and PostgreSQL for one account",
      { skip: CORE_REVENUE_E2E_ONLY },
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
      "CORE-REVENUE-E2E-01 crosses activation, $20 Download, delivery, owner support, and reversal",
      async () => {
        assert.ok(
          engagementBootstrap,
          "released joint Legal V7 is required for the revenue journey"
        );
        await pool.query(
          `insert into ss.operator_profiles (
             user_id, display_label, state,
             authorized_by_user_id, authorized_at
           ) values ($1, $2, 'held', $1, clock_timestamp())`,
          [otherActor.userId, "Revenue inquiry operator"]
        );
        await pool.query(
          `insert into ss.operator_permissions (
             operator_user_id, capability, state,
             granted_by_user_id, granted_at
           ) values (
             $1, 'service_case_manage', 'held',
             $1, clock_timestamp()
           )`,
          [otherActor.userId]
        );
        const inquiryGrantExpiresAt = new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString();
        const inquiryGrant = await pool.query(
          `insert into ss.service_operator_authority_events (
             operator_user_id, capability, event_sequence,
             event_kind, predecessor_event_id,
             recorded_by_kind, effective_at, expires_at,
             created_at
           ) values (
             $1, 'service_case_manage', 99, 'grant', null,
             'deployment_control',
             '2001-01-01T00:00:00.000Z', $2,
             '2001-01-01T00:00:00.000Z'
           ) returning event_sequence, event_kind, event_digest`,
          [otherActor.userId, inquiryGrantExpiresAt]
        );
        assert.deepEqual(
          {
            eventSequence: Number(
              inquiryGrant.rows[0].event_sequence
            ),
            eventKind: inquiryGrant.rows[0].event_kind
          },
          { eventSequence: 1, eventKind: "grant" }
        );
        assert.match(
          inquiryGrant.rows[0].event_digest,
          /^[a-f0-9]{64}$/u
        );
        engagementClockNow = new Date(
          Date.now() + 1000
        ).toISOString();
        const supportCases = createSupportCaseService({
          repository: createPostgresSupportCaseRepository({ authority }),
          mailLifecycle,
          clock: commerceV2.clock
        });
        assert.equal((await supportCases.readiness()).ready, true);
        const api = createHostedApi(service, {
          downloadCommerce,
          alakazamAccount,
          customServicesAccount,
          customServicesOwner,
          engagementBootstrap,
          stripeWebhook,
          supportCases
        });
        const browserServer =
          await startHostedBrowserServer(api);
        let reviewedBrowser = null;
        const email =
          `j02-browser-${randomUUID()}@example.test`;
        const password =
          "J-02 browser correct horse battery staple";
        const projectName = "J-02 Assessment Customer";
        const providerCallBaseline = Object.fromEntries(
          Object.entries(payment.calls).map(
            ([name, calls]) => [name, calls.length]
          )
        );

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
          const browserHttpFailures = [];
          cdp.on("Network.responseReceived", ({ response }) => {
            if (response.status >= 400) browserHttpFailures.push({
              pathname: new URL(response.url).pathname, status: response.status
            });
          });

          await navigate(
            `${browserServer.origin}/custom/#what-it-costs`
          );
          const publicInquiry = await evaluate(
            `(() => ({
              priceShown: document.body.textContent.includes(
                "Assessment — $350."
              ),
              inquiryHref: document.querySelector(
                'a[href="/contact/"]'
              )?.getAttribute("href") ?? null,
              forms: document.querySelectorAll("form").length
            }))()`
          );
          assert.deepEqual(publicInquiry, {
            priceShown: true,
            inquiryHref: "/contact/",
            forms: 0
          });

          await navigate(`${browserServer.origin}/contact/`);
          const directInquiry = await evaluate(
            `(() => ({
              email: document.querySelector(
                'a[href="mailto:sitesourcery@proton.me"]'
              )?.getAttribute("href") ?? null,
              phone: document.querySelector(
                'a[href="tel:+18562441220"]'
              )?.getAttribute("href") ?? null,
              forms: document.querySelectorAll("form").length
            }))()`
          );
          assert.deepEqual(directInquiry, {
            email: "mailto:sitesourcery@proton.me",
            phone: "tel:+18562441220",
            forms: 0
          });

          // FIN-012 requires registration email-possession evidence before payment.
          // Activate through the real HTTP path; only mailbox delivery is local/fake.
          await navigate(`${browserServer.origin}/abracadabra/app/`);
          await waitFor("Boolean(globalThis.SiteSourceryAbracadabraAPI)");
          const pendingRegistration = await evaluate(`(async () => {
            let sequence = 0;
            globalThis.__coreRegistrationClient = globalThis
              .SiteSourceryAbracadabraAPI.createClient({ baseUrl: "/api/v1",
                idempotencyFactory: () => "core-registration-" + (++sequence) });
            return globalThis.__coreRegistrationClient.register({
              name: "J-02 Browser Customer",
              organizationName: "J-02 Browser Customer Organization",
              email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)}
            });
          })()`, true);
          assert.equal(pendingRegistration.verificationRequired, true);
          const registrationMessage = registrationSink.readForTest(email)[0];
          assert.ok(registrationMessage);
          const registrationToken = decodeURIComponent(
            new URL(registrationMessage.verificationUrl).hash.slice("#verify-registration=".length)
          );
          const verifiedCustomer = await evaluate(`globalThis.__coreRegistrationClient
            .completeRegistration({ token: ${JSON.stringify(registrationToken)} })`, true);
          assert.equal(verifiedCustomer.user.email, email);
          const operatorCsrf = "i".repeat(32);
          const invitationResponse = await fetch(
            new Request(
              `${browserServer.origin}` +
                "/api/v1/operator/engagement-invitations",
              {
                method: "POST",
                headers: {
                  Cookie:
                    `ss_session=${otherRegistered.sessionToken}; ` +
                    `ss_csrf=${operatorCsrf}`,
                  Origin: browserServer.origin,
                  "X-CSRF-Token": operatorCsrf,
                  "Idempotency-Key":
                    "core-revenue-inquiry-invitation-1",
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  customerEmail: email,
                  customerName: "J-02 Browser Customer",
                  organizationId: verifiedCustomer.organization.id,
                  organizationName: null,
                  projectName,
                  provenance: "direct_custom_inquiry",
                  site: { kind: "new_site" },
                  sourceAssessmentReportId: null
                })
              }
            )
          );
          const invitation = await invitationResponse.json();
          assert.equal(
            invitationResponse.status,
            201,
            JSON.stringify(invitation)
          );
          assert.equal(
            invitation.schema,
            "sitesourcery.customer-engagement-invitation/v1"
          );
          assert.equal(invitation.replayed, false);
          assert.equal(invitation.provenance, "direct_custom_inquiry");
          assert.match(invitation.claimToken, /^[A-Za-z0-9_-]{43}$/u);
          assert.deepEqual(
            (
              await pool.query(
                `select
                   (select count(*)::integer
                      from auth.users where lower(email) = $1) as users,
                   (select count(*)::integer
                      from ss.projects where id = $2) as projects,
                   (select count(*)::integer
                      from ss.customer_engagements
                     where invitation_id = $3) as engagements`,
                [
                  email,
                  invitation.project.id,
                  invitation.invitationId
                ]
              )
            ).rows[0],
            { users: 1, projects: 0, engagements: 0 }
          );

          const appUrl =
            `${browserServer.origin}/abracadabra/app/`;
          await navigate(appUrl);
          await waitFor(
            `document.documentElement.getAttribute(` +
              `"data-abracadabra-control-ready") === "hosted" && ` +
              `Boolean(globalThis.SiteSourceryAbracadabraAPI)`
          );
          const claimResponse = await evaluate(
            `(async () => {
              let sequence = 0;
              const client = globalThis
                .SiteSourceryAbracadabraAPI.createClient({
                  baseUrl: "/api/v1",
                  idempotencyFactory: () =>
                    "j02-browser-command-" + (++sequence)
                });
              globalThis.__siteSourceryJ02Client = client;
              const authorityResponse = await fetch(
                "/api/v1/legal/project-authority",
                { credentials: "same-origin" }
              );
              const authority = await authorityResponse.json();
              const legalAcceptance = globalThis
                .SiteSourceryAbracadabraAPI
                .projectLegalAcceptanceFromAuthority(authority);
              const csrfResponse = await fetch("/api/v1/csrf", {
                credentials: "same-origin"
              });
              const csrf = await csrfResponse.json();
              const response = await fetch(
                "/api/v1/auth/engagement-claim",
                {
                  method: "POST",
                  credentials: "same-origin",
                  headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key":
                      "core-revenue-inquiry-claim-1",
                    "X-CSRF-Token": csrf.csrfToken
                  },
                  body: JSON.stringify({
                    legalAcceptance,
                    password: ${JSON.stringify(password)},
                    token: ${JSON.stringify(invitation.claimToken)}
                  })
                }
              );
              return {
                status: response.status,
                body: await response.json()
              };
            })()`,
            true
          );
          assert.equal(claimResponse.status, 201);
          const activated = claimResponse.body;
          assert.equal(activated.user.email, email);
          assert.equal(activated.user.id, verifiedCustomer.user.id);
          assert.equal(
            activated.organization.name,
            "J-02 Browser Customer Organization"
          );
          assert.equal(
            Object.hasOwn(activated, "sessionToken"),
            false
          );
          const sessionCookie =
            (await cdp.send("Network.getAllCookies"))
              .cookies.find(
                (cookie) => cookie.name === "ss_session"
              );
          assert.ok(sessionCookie);
          assert.equal(sessionCookie.httpOnly, true);
          assert.equal(sessionCookie.secure, true);
          assert.equal(sessionCookie.sameSite, "Strict");
          assert.equal(activated.project.name, projectName);
          assert.equal(
            activated.project.id,
            invitation.project.id
          );
          assert.equal(
            activated.provenance,
            "direct_custom_inquiry"
          );
          const projectId = activated.project.id;

          {
            commerceV2ClockNow = new Date(
              Date.now() + 2000
            ).toISOString();
            const coreRevenueRawFacts = {
              schema: "abracadabra.spark/v1",
              theme: "warm",
              businessName: "Revenue Journey Workshop",
              summary:
                "A complete local first-dollar customer journey.",
              about:
                "The deterministic browser proof owns no provider authority.",
              offerings: ["Local proof", "Durable download"],
              location: "Richmond, Virginia",
              hours: "Monday through Friday, 9–5",
              phone: "(804) 555-0100",
              email: "revenue-journey@example.test",
              website: "",
              primaryAction: "phone"
            };
            const coreRevenuePreviewDigest =
              compiler.compile(coreRevenueRawFacts).artifactDigest;
            const browserCommerce = await evaluate(
              `(async () => {
                const client = globalThis.__siteSourceryJ02Client;
                let step = "draft";
                const rawFacts = ${JSON.stringify(coreRevenueRawFacts)};
                try {
                  const draft = await client.saveDraft({
                    projectId: ${JSON.stringify(projectId)},
                    revision: 1,
                    rawFacts
                  });
                  step = "version";
                  const version = await client.createVersion({
                    projectId: ${JSON.stringify(projectId)},
                    rawFacts,
                    previewDigest:
                      ${JSON.stringify(coreRevenuePreviewDigest)},
                    reviewAttested: true
                  });
                  step = "ready";
                  await client.markVersionReady(
                    ${JSON.stringify(projectId)},
                    version.version.id
                  );
                  step = "accept";
                  await client.acceptVersion(
                    ${JSON.stringify(projectId)},
                    version.version.id
                  );
                  step = "quote";
                  const quote = await client.createDownloadQuote(
                    ${JSON.stringify(projectId)},
                    { versionId: version.version.id }
                  );
                  step = "checkout";
                  const checkout = await client.prepareDownloadCheckout(
                    ${JSON.stringify(projectId)},
                    quote.quoteId,
                    {
                      purchaseTermsAccepted: true,
                      acceptedDisclosureDigest:
                        quote.disclosureDigest
                    }
                  );
                  return { draft, version, quote, checkout };
                } catch (error) {
                  return {
                    browserError: {
                      step,
                      name: error?.name,
                      code: error?.code,
                      message: error?.message,
                      status: error?.status,
                      requestId: error?.requestId
                    }
                  };
                }
              })()`,
              true
            );
            assert.equal(
              browserCommerce.browserError,
              undefined,
              JSON.stringify(browserCommerce)
            );
            assert.equal(browserCommerce.draft.revision, 2);
            assert.equal(
              browserCommerce.version.version.state,
              "draft"
            );
            assert.equal(browserCommerce.quote.offerId, "spark_download");
            assert.deepEqual(browserCommerce.quote.price, {
              amountMinor: 2000,
              currency: "USD",
              billing: "one_time",
              interval: null
            });
            assert.equal(browserCommerce.checkout.state, "ready");
            assert.match(
              browserCommerce.checkout.checkoutUrl,
              /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_download_/u
            );
            assert.equal(
              payment.calls.downloadCheckout.length,
              providerCallBaseline.downloadCheckout + 1
            );
            const providerRequest =
              payment.calls.downloadCheckout.at(-1);
            assert.equal(
              providerRequest.purpose.customerId,
              activated.user.id
            );
            assert.equal(
              providerRequest.purpose.projectId,
              projectId
            );
            assert.equal(
              providerRequest.purpose.versionId,
              browserCommerce.version.version.id
            );
            const checkoutId =
              browserCommerce.checkout.checkout.id;
            const checkoutNumber = checkoutId.replace(
              "cs_test_download_",
              ""
            );
            const metadata = {
              schema: "sitesourcery_download_checkout_v3",
              tenant_id: providerRequest.purpose.tenantId,
              customer_id: providerRequest.purpose.customerId,
              project_id: providerRequest.purpose.projectId,
              version_id: providerRequest.purpose.versionId,
              quote_id: providerRequest.purpose.quoteId,
              offer_id: providerRequest.purpose.offerId,
              entitlement_kind:
                providerRequest.purpose.entitlementKind,
              accepted_disclosure_digest:
                providerRequest.purpose.acceptedDisclosureDigest,
              quote_snapshot_digest:
                providerRequest.purpose.quoteSnapshotDigest,
              purpose_digest: providerRequest.purposeDigest
            };
            const paidEvent = stripeEvent(
              `evt_test_core_revenue_paid_${checkoutNumber}`,
              "checkout.session.completed",
              { id: checkoutId, metadata }
            );
            paidEvent.created = Math.floor(
              Date.parse(commerceV2ClockNow) / 1000
            );
            const settled =
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(paidEvent),
                signature: "contract-signature-valid"
              });
            assert.equal(settled.status, "processed");
            assert.deepEqual(
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(paidEvent),
                signature: "contract-signature-valid"
              }),
              settled
            );
            assert.equal(
              payment.calls.downloadReadback.length,
              providerCallBaseline.downloadReadback + 1
            );

            const paidReadback = await evaluate(
              `(async () => {
                const client = globalThis.__siteSourceryJ02Client;
                const project = await client.getProject(
                  ${JSON.stringify(projectId)}
                );
                const entitlement = project.project.entitlements[0];
                const response = await fetch(
                  entitlement.downloadUrl,
                  { credentials: "same-origin" }
                );
                return {
                  project,
                  download: {
                    status: response.status,
                    contentType: response.headers.get("content-type"),
                    disposition:
                      response.headers.get("content-disposition"),
                    html: await response.text()
                  }
                };
              })()`,
              true
            );
            assert.equal(
              paidReadback.project.project.entitlements.length,
              1
            );
            assert.equal(
              paidReadback.project.project.entitlements[0].payment
                .totalMinor,
              2000
            );
            assert.equal(paidReadback.download.status, 200);
            assert.equal(
              paidReadback.download.contentType,
              "text/html; charset=utf-8"
            );
            assert.match(
              paidReadback.download.disposition,
              /^attachment; filename="sitesourcery-/u
            );
            assert.match(
              paidReadback.download.html,
              /Revenue Journey Workshop/u
            );

            const durablePaid = await pool.query(
              `select
                 (select count(*)::integer
                    from ss.customer_engagements engagement
                   where engagement.organization_id = $1
                     and engagement.project_id = $2
                     and engagement.customer_user_id = $3
                     and engagement.provenance =
                       'direct_custom_inquiry') as engagements,
                 (select count(*)::integer
                    from ss.service_custom_build_direct_opportunities
                   where organization_id = $1
                     and project_id = $2
                     and customer_user_id = $3
                     and state = 'available') as operator_opportunities,
                 (select count(*)::integer
                    from ss.commerce_v2_download_dispatches
                   where organization_id = $1
                     and project_id = $2
                     and customer_user_id = $3
                     and state = 'settled') as dispatches,
                 (select count(*)::integer
                    from ss.commerce_v2_download_payment_receipts
                   where organization_id = $1
                     and project_id = $2
                     and customer_user_id = $3
                     and payment_status = 'paid'
                     and total_minor = 2000) as receipts,
                 (select count(*)::integer
                    from ss.commerce_v2_project_entitlements
                   where organization_id = $1
                     and project_id = $2
                     and customer_user_id = $3
                     and state = 'active') as entitlements`,
              [
                activated.organization.id,
                projectId,
                activated.user.id
              ]
            );
            assert.deepEqual(durablePaid.rows[0], {
              engagements: 1,
              operator_opportunities: 1,
              dispatches: 1,
              receipts: 1,
              entitlements: 1
            });

            // Support timestamps must not use the payment fixture's future clock:
            // its database trigger stamps mutations with the real wall clock.
            commerceV2ClockNow = new Date().toISOString();
            // Continue the same paid customer/project through durable owner support.
            // Correspondence remains digest-only; no mail provider is called.
            const customerSupport = (pathname, body = null, commandId = null) =>
              evaluate(`(async () => {
                const body = ${JSON.stringify(body)};
                const headers = {};
                if (body) {
                  const csrf = await (await fetch("/api/v1/csrf")).json();
                  headers["X-CSRF-Token"] = csrf.csrfToken;
                  headers["Content-Type"] = "application/json";
                  headers["Idempotency-Key"] = ${JSON.stringify(commandId)};
                }
                const response = await fetch(${JSON.stringify(pathname)}, {
                  method: body ? "POST" : "GET", credentials: "same-origin",
                  headers, ...(body ? { body: JSON.stringify(body) } : {})
                });
                return { status: response.status, body: await response.json() };
              })()`, true);
            const requestAs = async (token, pathname, body = null, commandId = null) => {
              const headers = {
                Cookie: `ss_session=${token}; ss_csrf=${operatorCsrf}`
              };
              if (body) Object.assign(headers, {
                Origin: browserServer.origin, "X-CSRF-Token": operatorCsrf,
                "Content-Type": "application/json", "Idempotency-Key": commandId
              });
              const response = await fetch(browserServer.origin + pathname, {
                method: body ? "POST" : "GET", headers,
                ...(body ? { body: JSON.stringify(body) } : {})
              });
              return { status: response.status, body: await response.json() };
            };
            const opening = {
              evidenceDigests: [commerceDigest("Synthetic download support request")],
              organizationId: activated.organization.id, parentCaseId: null,
              projectId, requestKind: "support", scopeKind: "project",
              requesterReferenceDigest: commerceDigest(activated.user.id)
            };
            const opened = await customerSupport(
              "/api/v1/support-cases", opening, "core-support-open-1"
            );
            assert.equal(opened.status, 201, JSON.stringify(opened.body));
            assert.equal(opened.body.state, "open");
            assert.equal(opened.body.scope.projectId, projectId);
            assert.deepEqual(await customerSupport(
              "/api/v1/support-cases", opening, "core-support-open-1"
            ), opened);
            const caseId = opened.body.id;
            const operatorPath = `/api/v1/operator/support-cases/${caseId}`;
            const operatorOrganizationId = otherRegistered.organization.id;
            const queue = await requestAs(otherRegistered.sessionToken,
              `/api/v1/operator/support-cases?operatorOrganizationId=${operatorOrganizationId}`);
            assert.equal(queue.status, 200, JSON.stringify(queue.body));
            assert.equal(queue.body.cases.find((item) => item.id === caseId)
              .requesterUserId, activated.user.id);
            const deniedOperator = await requestAs(sessionCookie.value,
              `/api/v1/operator/support-cases?operatorOrganizationId=${activated.organization.id}`);
            assert.equal(deniedOperator.status, 404);
            assert.equal(deniedOperator.body.error.code, "SUPPORT_CASE_UNAVAILABLE");
            const foreignRead = await requestAs(otherRegistered.sessionToken,
              `/api/v1/support-cases/${caseId}?organizationId=${otherRegistered.organization.id}`);
            assert.equal(foreignRead.status, 404);
            assert.equal(foreignRead.body.error.code, "SUPPORT_CASE_UNAVAILABLE");
            let supportRevision = opened.body.revision;
            const ownerStep = async (suffix, fields) => {
              const result = await requestAs(otherRegistered.sessionToken,
                `${operatorPath}/${suffix}`,
                { operatorOrganizationId, expectedRevision: supportRevision, ...fields },
                `core-support-${suffix}-1`);
              assert.equal(result.status, 200, JSON.stringify(result.body));
              assert.equal(result.body.revision, supportRevision + 1);
              supportRevision = result.body.revision;
              return result;
            };
            await ownerStep("assignment", { assignedOperatorId: otherActor.userId });
            await ownerStep("deadline", {
              basisDigest: commerceDigest("Synthetic support response deadline"),
              responseDueAt: fromNow(24 * 60 * 60 * 1000)
            });
            await ownerStep("review", {});
            const responseDigest = commerceDigest("Synthetic owner response recorded");
            const responseRevision = supportRevision;
            const responded = await ownerStep("response", { responseDigest });
            assert.equal(responded.body.state, "responded");
            assert.deepEqual(await requestAs(otherRegistered.sessionToken,
              `${operatorPath}/response`, {
                operatorOrganizationId, expectedRevision: responseRevision, responseDigest
              }, "core-support-response-1"), responded);
            const customerCase = await customerSupport(
              `/api/v1/support-cases/${caseId}?organizationId=${activated.organization.id}`);
            assert.equal(customerCase.status, 200);
            assert.equal(customerCase.body.state, "responded");
            assert.equal(customerCase.body.decision.digest, responseDigest);
            assert.equal(customerCase.body.deadline.status, "met");
            assert.deepEqual(customerCase.body.audit.map((event) => event.kind),
              ["opened", "assigned", "deadline_set", "review_started", "response_recorded"]);
            assert.equal(Object.hasOwn(customerCase.body, "requesterReferenceDigest"), false);
            const closed = await ownerStep("closure", {
              closureReasonCode: "completed",
              closureEvidenceDigest: commerceDigest("Synthetic support resolved")
            });
            assert.equal(closed.body.state, "closed");
            // A fresh page must recover the paid project and closed case from
            // durable state and the existing secure session, without another charge.
            await navigate(appUrl);
            await waitFor("Boolean(globalThis.SiteSourceryAbracadabraAPI)");
            const reloaded = await evaluate(`(async () => {
              globalThis.__siteSourceryJ02Client = globalThis
                .SiteSourceryAbracadabraAPI.createClient({ baseUrl: "/api/v1" });
              const project = await globalThis.__siteSourceryJ02Client.getProject(
                ${JSON.stringify(projectId)});
              const file = await fetch(project.project.entitlements[0].downloadUrl);
              return { project, status: file.status, html: await file.text() };
            })()`, true);
            assert.equal(reloaded.status, 200);
            assert.equal(reloaded.html, paidReadback.download.html);
            assert.equal(reloaded.project.project.entitlements[0].payment.receiptId,
              paidReadback.project.project.entitlements[0].payment.receiptId);
            const reloadedCase = await customerSupport(
              `/api/v1/support-cases/${caseId}?organizationId=${activated.organization.id}`);
            assert.equal(reloadedCase.status, 200);
            assert.equal(reloadedCase.body.state, "closed");
            assert.equal(reloadedCase.body.decision.digest, responseDigest);
            assert.equal(payment.calls.downloadCheckout.length,
              providerCallBaseline.downloadCheckout + 1);

            const caseRows = await pool.query(`select
              (select count(*)::integer from ss.hosted_support_cases where id = $1) as cases,
              (select count(*)::integer from ss.hosted_support_case_commands where case_id = $1) as commands,
              (select count(*)::integer from ss.hosted_support_case_events where case_id = $1) as events`, [caseId]);
            assert.deepEqual(caseRows.rows[0], { cases: 1, commands: 6, events: 6 });
            t.diagnostic("C2: same customer/project $20 paid receipt, HTML delivery, owner support open/replay/assignment/deadline/response/replay/closure and foreign-customer denials passed; providers fake.");

            const paymentIntentId =
              `pi_test_download_${checkoutNumber}`;
            const partialRefund = stripeEvent(
              `evt_test_core_revenue_partial_${checkoutNumber}`,
              "charge.refunded",
              {
                id: `ch_test_core_revenue_${checkoutNumber}`,
                livemode: false,
                payment_intent: paymentIntentId,
                currency: "usd",
                amount: 2000,
                amount_refunded: 100,
                refunded: false
              }
            );
            partialRefund.created = paidEvent.created + 1;
            const suspended =
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(partialRefund),
                signature: "contract-signature-valid"
              });
            assert.equal(suspended.entitlementState, "suspended");
            const suspendedReadback = await evaluate(
              `(async () => {
                const project = await globalThis
                  .__siteSourceryJ02Client.getProject(
                    ${JSON.stringify(projectId)}
                  );
                return {
                  visibleEntitlements:
                    project.project.entitlements.length
                };
              })()`,
              true
            );
            assert.deepEqual(suspendedReadback, {
              visibleEntitlements: 0
            });

            const fullRefund = stripeEvent(
              `evt_test_core_revenue_full_${checkoutNumber}`,
              "charge.refunded",
              {
                id: `ch_test_core_revenue_${checkoutNumber}`,
                livemode: false,
                payment_intent: paymentIntentId,
                currency: "usd",
                amount: 2000,
                amount_refunded: 2000,
                refunded: true
              }
            );
            fullRefund.created = paidEvent.created + 2;
            const revoked =
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(fullRefund),
                signature: "contract-signature-valid"
              });
            assert.equal(revoked.entitlementState, "revoked");
            assert.deepEqual(
              await stripeWebhook.ingestStripeWebhook({
                rawBody: rawEvent(fullRefund),
                signature: "contract-signature-valid"
              }),
              revoked
            );
            assert.deepEqual(
              (
                await pool.query(
                  `select entitlement.state, entitlement.state_reason,
                          receipt.payment_status,
                          dispatch.state as dispatch_state
                     from ss.commerce_v2_project_entitlements entitlement
                     join ss.commerce_v2_download_payment_receipts receipt
                       on receipt.organization_id =
                          entitlement.organization_id
                      and receipt.id = entitlement.source_receipt_id
                     join ss.commerce_v2_download_dispatches dispatch
                       on dispatch.organization_id = receipt.organization_id
                      and dispatch.preparation_command_id =
                          receipt.preparation_command_id
                    where entitlement.organization_id = $1
                      and entitlement.project_id = $2`,
                  [activated.organization.id, projectId]
                )
              ).rows,
              [{
                state: "revoked",
                state_reason: "payment_fully_refunded",
                payment_status: "paid",
                dispatch_state: "settled"
              }]
            );
            assert.equal(
              await downloadPaymentRepository.resolveDownloadArtifact({
                tenantId: activated.organization.id,
                customerId: activated.user.id,
                projectId,
                versionId: browserCommerce.version.version.id
              }),
              null
            );

            for (const name of [
              "assessmentCheckout",
              "assessmentReadback",
              "assessmentLifecycle",
              "checkout",
              "portal",
              "cancellation"
            ]) {
              assert.equal(
                payment.calls[name].length,
                providerCallBaseline[name],
                `${name} must remain outside the core Download path`
              );
            }
            assert.equal(
              payment.calls.downloadLifecycle.length,
              providerCallBaseline.downloadLifecycle
            );
            assert.ok(
              browserServer.apiRequests.some(
                ({ method, pathname }) =>
                  method === "POST" &&
                  pathname ===
                    "/api/v1/operator/engagement-invitations"
              )
            );
            assert.ok(
              browserServer.apiRequests.some(
                ({ method, pathname }) =>
                  method === "POST" &&
                  pathname === "/api/v1/auth/engagement-claim"
              )
            );
            assert.ok(
              browserServer.apiRequests.some(
                ({ method, pathname }) =>
                  method === "GET" &&
                  pathname.endsWith("/download")
              )
            );
            const externalBrowserRequests = await evaluate(
              `performance.getEntriesByType("resource")` +
                `.map((entry) => entry.name)` +
                `.filter((name) => {` +
                `  const url = new URL(name, location.href);` +
                `  return (url.protocol === "http:" || ` +
                `url.protocol === "https:") && ` +
                `url.origin !== location.origin;` +
                `})`
            );
            assert.deepEqual(externalBrowserRequests, []);
            assert.deepEqual(browserServer.missingFiles, []);
            await evaluate(
              `new Promise((resolve) => setTimeout(resolve, 100))`,
              true
            );
            // The narrow composition intentionally leaves these adjacent products
            // held/unmounted. Account reload probes them; no other failed request
            // or JavaScript error is accepted as part of this proof.
            assert.deepEqual([...new Set(browserHttpFailures.map(
              ({ status, pathname }) => `${status} ${pathname}`
            ))].sort(), [
              "403 /api/v1/operator/custom-services/assessment-requests",
              "404 /api/v1/care",
              "404 /api/v1/responder",
              "503 /api/v1/operator/custom-services/assessment-jobs",
              "503 /api/v1/operator/custom-services/custom-build-jobs",
              "503 /api/v1/operator/custom-services/custom-build-opportunities"
            ]);
            const expectedHttpMessages = new Set([
              "Failed to load resource: the server responded with a status of 403 (Forbidden)",
              "Failed to load resource: the server responded with a status of 404 (Not Found)",
              "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
            ]);
            assert.deepEqual([...new Set(browserErrors)].filter(
              (message) => !expectedHttpMessages.has(message)
            ), []);
          }

        } finally {
          if (reviewedBrowser) {
            await reviewedBrowser.close();
          }
          await browserServer.close();
        }
      }
    );
    await t.test(
      "FIN-006-COMPOSED-TRACE-01 binds 15 exact all-held account, Custom, and adjacent gates",
      async () => {
        const EXPECTED_GATES = Object.freeze([
          "activated-registration-possession",
          "active-profile-identity",
          "owner-membership",
          "engagement-project-opportunity-identity",
          "customer-operator-route-denial",
          "foreign-tenant-denial",
          "direct-quote-created",
          "exact-scope-price-digests",
          "customer-read-acceptance-replay",
          "durable-acceptance-invoice-readback",
          "payment-held-projection",
          "checkout-rejected-before-provider",
          "zero-provider-payment-effects",
          "zero-fulfillment-publication-effects",
          "hub-dell-same-project-held-readback"
        ]);
        const gates = [];
        const passed = (gate) => gates.push(gate);
        const origin = "https://app.sitesourcery.test";
        const csrf = "f".repeat(32);
        const requestAs = async (sessionToken, {
          body,
          commandId,
          method = "GET",
          pathname
        }) => {
          const headers = {};
          if (sessionToken) {
            headers.Cookie = `ss_session=${sessionToken}`;
          }
          if (method !== "GET") {
            headers.Cookie =
              `${headers.Cookie ? `${headers.Cookie}; ` : ""}` +
              `ss_csrf=${csrf}`;
            headers.Origin = origin;
            headers["X-CSRF-Token"] = csrf;
            headers["Idempotency-Key"] = commandId;
            headers["Content-Type"] = "application/json";
          }
          const response = await createTraceApi.fetch(new Request(
            `${origin}${pathname}`,
            {
              method,
              headers,
              body: body === undefined ? undefined : JSON.stringify(body)
            }
          ));
          let selectedBody = null;
          if (response.headers.get("content-type")?.includes("application/json")) {
            selectedBody = await response.json();
          }
          return { response, body: selectedBody };
        };

        await pool.query(
          `insert into ss.operator_permissions (
             operator_user_id, capability, state,
             granted_by_user_id, granted_at
           ) values
             ($1, 'service_quote_author', 'held', $1, clock_timestamp()),
             ($1, 'service_management_manage', 'held', $1, clock_timestamp())`,
          [otherActor.userId]
        );
        await pool.query(
          `insert into ss.service_operator_authority_events (
             operator_user_id, capability, event_sequence,
             event_kind, predecessor_event_id, recorded_by_kind,
             effective_at, expires_at, created_at
           ) values
             ($1, 'service_quote_author', 99, 'grant', null,
              'deployment_control', clock_timestamp(),
              clock_timestamp() + interval '1 day', clock_timestamp()),
             ($1, 'service_management_manage', 99, 'grant', null,
              'deployment_control', clock_timestamp(),
              clock_timestamp() + interval '1 day', clock_timestamp())`,
          [otherActor.userId]
        );
        engagementClockNow = new Date(Date.now() + 5_000).toISOString();
        const adjacentIntegration = createAdjacentIntegrationService({
          repository: createPostgresAdjacentIntegrationRepository({
            authority
          }),
          clock: { now: () => new Date().toISOString() },
          ids: { next: () => randomUUID() }
        });
        const createTraceApi = createHostedApi(service, {
          customServicesAccount,
          customServicesCustomBuild,
          engagementBootstrap
        });

        const registration = (await pool.query(
          `select state, activated_user_id, activated_organization_id,
                  possession_evidence_digest, possession_proven_at
             from ss.hosted_registration_requests
            where command_id = 'registration-owner-001'`
        )).rows[0];
        assert.equal(registration.state, "activated");
        assert.equal(registration.activated_user_id, registered.user.id);
        assert.equal(
          registration.activated_organization_id,
          registered.organization.id
        );
        assert.match(registration.possession_evidence_digest, /^[a-f0-9]{64}$/u);
        assert.ok(registration.possession_proven_at);
        passed("activated-registration-possession");

        const identityState = (await pool.query(
          `select users.id as user_id, profile.state
             from auth.users users
             join ss.hosted_account_profiles profile
               on profile.user_id = users.id
            where users.id = $1`,
          [registered.user.id]
        )).rows[0];
        assert.deepEqual(identityState, {
          user_id: registered.user.id,
          state: "active"
        });
        passed("active-profile-identity");

        const ownerMembership = (await pool.query(
          `select role, state
             from ss.organization_memberships
            where organization_id = $1 and user_id = $2`,
          [registered.organization.id, registered.user.id]
        )).rows[0];
        assert.deepEqual(ownerMembership, { role: "owner", state: "active" });
        passed("owner-membership");

        const invitationResult = await requestAs(
          otherRegistered.sessionToken,
          {
            method: "POST",
            pathname: "/api/v1/operator/engagement-invitations",
            commandId: "fin006-composed-invitation-001",
            body: {
              customerEmail: ownerEmail,
              customerName: "Test Owner",
              organizationId: registered.organization.id,
              organizationName: null,
              projectName: "FIN-006 Held Custom Trace",
              provenance: "direct_custom_inquiry",
              site: { kind: "new_site" },
              sourceAssessmentReportId: null
            }
          }
        );
        assert.equal(
          invitationResult.response.status,
          201,
          JSON.stringify(invitationResult.body)
        );
        const claimResult = await requestAs(null, {
          method: "POST",
          pathname: "/api/v1/auth/engagement-claim",
          commandId: "fin006-composed-claim-001",
          body: {
            legalAcceptance: projectLegalAcceptance,
            password: "rotated correct horse battery staple",
            token: invitationResult.body.claimToken
          }
        });
        assert.equal(
          claimResult.response.status,
          201,
          JSON.stringify(claimResult.body)
        );
        const claim = claimResult.body;
        const claimSessionCookie =
          claimResult.response.headers.get("set-cookie");
        assert.match(
          claimSessionCookie,
          /^ss_session=[A-Za-z0-9_-]{43};/u
        );
        const claimSessionToken =
          claimSessionCookie.slice("ss_session=".length).split(";", 1)[0];
        assert.equal(claim.user.id, registered.user.id);
        assert.equal(claim.organization.id, registered.organization.id);
        assert.equal(claim.project.id, invitationResult.body.project.id);
        const opportunity = (await pool.query(
          `select opportunity.id, opportunity.engagement_id,
                  opportunity.organization_id, opportunity.project_id,
                  opportunity.customer_user_id, opportunity.state,
                  engagement.provenance
             from ss.service_custom_build_direct_opportunities opportunity
             join ss.customer_engagements engagement
               on engagement.id = opportunity.engagement_id
              and engagement.organization_id = opportunity.organization_id
              and engagement.project_id = opportunity.project_id
            where opportunity.engagement_id = $1`,
          [claim.engagementId]
        )).rows[0];
        assert.deepEqual(
          {
            engagementId: opportunity.engagement_id,
            organizationId: opportunity.organization_id,
            projectId: opportunity.project_id,
            customerUserId: opportunity.customer_user_id,
            state: opportunity.state,
            provenance: opportunity.provenance
          },
          {
            engagementId: claim.engagementId,
            organizationId: claim.organization.id,
            projectId: claim.project.id,
            customerUserId: claim.user.id,
            state: "available",
            provenance: "direct_custom_inquiry"
          }
        );
        passed("engagement-project-opportunity-identity");

        const quoteBody = {
          contentWords: 1600,
          craftedPages: 4,
          creditSelection: "no_credit",
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          organizationId: claim.organization.id,
          scopeStatement:
            "Build the four-page FIN-006 direct Custom site without releasing any external effect.",
          sections: 14,
          suppliedMedia: 10,
          targetCompletionDate: new Date(Date.now() + 45 * 86400000)
            .toISOString().slice(0, 10),
          tierId: "site",
          uniqueLayouts: 4
        };
        const customerOperatorDenial = await requestAs(
          claimSessionToken,
          {
            method: "POST",
            pathname:
              `/api/v1/operator/custom-services/custom-build-opportunities/` +
              `${claim.project.id}/quote`,
            commandId: "fin006-customer-operator-denial-001",
            body: quoteBody
          }
        );
        assert.equal(customerOperatorDenial.response.status, 403);
        assert.equal(
          customerOperatorDenial.body.error.code,
          "OPERATOR_ACCESS_REQUIRED"
        );
        passed("customer-operator-route-denial");

        const foreignRead = await requestAs(otherRegistered.sessionToken, {
          pathname:
            `/api/v1/projects/${claim.project.id}` +
            "/custom-services/custom-build-quote"
        });
        assert.equal(foreignRead.response.status, 404);
        passed("foreign-tenant-denial");

        const quoteResult = await requestAs(otherRegistered.sessionToken, {
          method: "POST",
          pathname:
            `/api/v1/operator/custom-services/custom-build-opportunities/` +
            `${claim.project.id}/quote`,
          commandId: "fin006-composed-quote-001",
          body: quoteBody
        });
        assert.equal(
          quoteResult.response.status,
          201,
          JSON.stringify(quoteResult.body)
        );
        const issuedQuote = quoteResult.body.quote;
        const scopeEvidenceDigest = commerceDigest({
          schema: "sitesourcery.fin006-composed-scope-evidence/v1",
          scopeStatement: issuedQuote.scopeStatement,
          targetCompletionDate: issuedQuote.targetCompletionDate,
          tier: issuedQuote.tier
        });
        assert.equal(quoteResult.body.origin, "direct");
        assert.equal(issuedQuote.origin, "direct");
        passed("direct-quote-created");
        assert.equal(issuedQuote.pricing.serviceAmountMinor, 100000);
        assert.equal(issuedQuote.pricing.creditAmountMinor, 0);
        assert.equal(issuedQuote.pricing.startDueMinor, 50000);
        assert.equal(issuedQuote.creditSelection, "no_credit");
        assert.match(issuedQuote.quoteDigest, /^[a-f0-9]{64}$/u);
        assert.match(issuedQuote.disclosureDigest, /^[a-f0-9]{64}$/u);
        assert.match(scopeEvidenceDigest, /^[a-f0-9]{64}$/u);
        passed("exact-scope-price-digests");

        const quotePath =
          `/api/v1/projects/${claim.project.id}` +
          "/custom-services/custom-build-quote";
        const customerQuote = await requestAs(claimSessionToken, {
          pathname: quotePath
        });
        assert.equal(customerQuote.response.status, 200);
        assert.equal(customerQuote.body.quote.quoteId, issuedQuote.quoteId);
        const acceptanceBody = {
          acceptanceStatement: "accepted_exact_custom_build_quote",
          acceptedDisclosureDigest: issuedQuote.disclosureDigest,
          acceptedQuoteDigest: issuedQuote.quoteDigest,
          quoteId: issuedQuote.quoteId,
          quoteRevision: issuedQuote.quoteRevision
        };
        const accepted = await requestAs(claimSessionToken, {
          method: "POST",
          pathname: `${quotePath}/acceptance`,
          commandId: "fin006-composed-accept-001",
          body: acceptanceBody
        });
        const acceptedReplay = await requestAs(claimSessionToken, {
          method: "POST",
          pathname: `${quotePath}/acceptance`,
          commandId: "fin006-composed-accept-001",
          body: acceptanceBody
        });
        assert.equal(accepted.response.status, 200);
        assert.equal(acceptedReplay.response.status, 200);
        assert.equal(accepted.body.state, "accepted");
        assert.deepEqual(acceptedReplay.body, accepted.body);
        assert.equal(
          accepted.body.quote.acceptance.acceptedQuoteDigest,
          issuedQuote.quoteDigest
        );
        passed("customer-read-acceptance-replay");

        const invoiceResult = await requestAs(claimSessionToken, {
          pathname:
            `/api/v1/projects/${claim.project.id}` +
            "/custom-services/custom-build-invoice"
        });
        assert.equal(invoiceResult.response.status, 200);
        const durableIdentity = (await pool.query(
          `select quote.id as quote_id,
                  quote.direct_opportunity_id,
                  acceptance.id as acceptance_id,
                  invoice.id as invoice_id,
                  invoice.invoice_digest,
                  invoice.state as invoice_state
             from ss.service_custom_build_quotes quote
             join ss.service_custom_build_quote_acceptances acceptance
               on acceptance.organization_id = quote.organization_id
              and acceptance.quote_id = quote.id
             join ss.service_custom_build_invoices invoice
               on invoice.organization_id = acceptance.organization_id
              and invoice.quote_acceptance_id = acceptance.id
            where quote.organization_id = $1
              and quote.project_id = $2
              and quote.customer_user_id = $3
              and quote.id = $4
              and quote.direct_opportunity_id = $5`,
          [
            claim.organization.id,
            claim.project.id,
            claim.user.id,
            issuedQuote.quoteId,
            opportunity.id
          ]
        )).rows[0];
        assert.match(
          durableIdentity.acceptance_id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        );
        assert.equal(
          durableIdentity.invoice_id,
          invoiceResult.body.invoice.invoiceId
        );
        assert.equal(
          durableIdentity.invoice_digest,
          invoiceResult.body.invoice.invoiceDigest
        );
        passed("durable-acceptance-invoice-readback");

        assert.equal(invoiceResult.body.state, "payment_held");
        assert.deepEqual(invoiceResult.body.action, {
          available: false,
          reason: "payment_held"
        });
        passed("payment-held-projection");
        const checkout = await requestAs(claimSessionToken, {
          method: "POST",
          pathname:
            `/api/v1/projects/${claim.project.id}` +
            "/custom-services/custom-build-invoices/" +
            `${invoiceResult.body.invoice.invoiceId}/checkout-command`,
          commandId: "fin006-composed-checkout-held-001",
          body: { invoiceDigest: invoiceResult.body.invoice.invoiceDigest }
        });
        assert.equal(checkout.response.status, 503);
        assert.equal(
          checkout.body.error.code,
          "CUSTOM_BUILD_PAYMENT_HELD"
        );
        assert.equal(customBuildProviderCalls.length, 0);
        passed("checkout-rejected-before-provider");

        const zeroEffects = (await pool.query(
          `select
             (select count(*)::integer
                from ss.service_custom_build_checkout_attempts
               where organization_id = $1 and project_id = $2) as attempts,
             (select count(*)::integer
                from ss.service_custom_build_stripe_events
               where organization_id = $1 and project_id = $2) as events,
             (select count(*)::integer
                from ss.service_custom_build_payment_receipts
               where organization_id = $1 and project_id = $2) as receipts,
             (select count(*)::integer
                from ss.service_custom_build_jobs
               where organization_id = $1 and project_id = $2) as jobs,
             (select count(*)::integer
                from ss.service_custom_build_work_requests
               where organization_id = $1 and project_id = $2) as work_requests,
             (select count(*)::integer
                from ss.publication_control_commands
               where organization_id = $1 and project_id = $2) as publication_commands`,
          [claim.organization.id, claim.project.id]
        )).rows[0];
        assert.deepEqual(
          {
            attempts: zeroEffects.attempts,
            events: zeroEffects.events,
            receipts: zeroEffects.receipts
          },
          { attempts: 0, events: 0, receipts: 0 }
        );
        assert.equal(customBuildProviderCalls.length, 0);
        passed("zero-provider-payment-effects");
        assert.deepEqual(
          {
            jobs: zeroEffects.jobs,
            work_requests: zeroEffects.work_requests,
            publication_commands: zeroEffects.publication_commands
          },
          { jobs: 0, work_requests: 0, publication_commands: 0 }
        );
        passed("zero-fulfillment-publication-effects");

        await pool.query(
          `insert into ss.organization_memberships (
             organization_id, user_id, role, state, accepted_at
           ) values ($1, $2, 'viewer', 'active', clock_timestamp())`,
          [claim.organization.id, otherActor.userId]
        );
        const adjacentScope = {
          actorId: otherActor.userId,
          operatorOrganizationId: claim.organization.id
        };
        const observedAt = new Date().toISOString();
        const hubRevision = `sha256:${"6".repeat(64)}`;
        const dellRevision = `sha256:${"7".repeat(64)}`;
        const hubSnapshot = await adjacentIntegration.recordGlobalSnapshot({
          ...adjacentScope,
          commandId: "fin006-composed-hub-snapshot-001",
          systemKey: "client_profile_hub",
          remoteEntityKind: "service",
          remoteReference: `sha256:${"8".repeat(64)}`,
          observationKind: "registry_revision",
          observationState: "available",
          sourceRevision: hubRevision,
          sourcePayloadDigest: "6".repeat(64),
          sourceObservedAt: observedAt
        });
        const dellSnapshot = await adjacentIntegration.recordGlobalSnapshot({
          ...adjacentScope,
          commandId: "fin006-composed-dell-snapshot-001",
          systemKey: "dell_commercial_engine",
          remoteEntityKind: "catalog",
          remoteReference: `sha256:${"9".repeat(64)}`,
          observationKind: "catalog_readback",
          observationState: "available",
          sourceRevision: dellRevision,
          sourcePayloadDigest: "7".repeat(64),
          sourceObservedAt: observedAt
        });
        const recordCrosswalk = (input) =>
          adjacentIntegration.recordCrosswalk({
            ...adjacentScope,
            projectId: claim.project.id,
            localEntityKind: "project",
            localEntityId: claim.project.id,
            referencePolicy: input.referencePolicy,
            remoteEntityKind: input.remoteEntityKind,
            remoteReference: input.remoteReference,
            sourceEvidenceDigest: input.sourcePayloadDigest,
            sourceRevision: input.sourceRevision,
            sourceSnapshotId: input.sourceSnapshotId,
            state: "manual_review",
            supersedesCrosswalkId: null,
            systemKey: input.systemKey,
            commandId: input.commandId
          });
        const hubCrosswalk = await recordCrosswalk({
          commandId: "fin006-composed-hub-project-001",
          systemKey: "client_profile_hub",
          sourceSnapshotId: hubSnapshot.id,
          sourceRevision: hubRevision,
          sourcePayloadDigest: "6".repeat(64),
          remoteEntityKind: "project",
          referencePolicy: "hub_project_id",
          remoteReference: "SS-2026-6001"
        });
        const dellScope = await recordCrosswalk({
          commandId: "fin006-composed-dell-scope-001",
          systemKey: "dell_commercial_engine",
          sourceSnapshotId: dellSnapshot.id,
          sourceRevision: dellRevision,
          sourcePayloadDigest: "7".repeat(64),
          remoteEntityKind: "scope",
          referencePolicy: "digest_only",
          remoteReference: `sha256:${scopeEvidenceDigest}`
        });
        const dellQuote = await recordCrosswalk({
          commandId: "fin006-composed-dell-quote-001",
          systemKey: "dell_commercial_engine",
          sourceSnapshotId: dellSnapshot.id,
          sourceRevision: dellRevision,
          sourcePayloadDigest: "7".repeat(64),
          remoteEntityKind: "quote",
          referencePolicy: "digest_only",
          remoteReference: `sha256:${issuedQuote.quoteDigest}`
        });
        const adjacentTrace = await adjacentIntegration.listTrace({
          ...adjacentScope,
          projectId: claim.project.id,
          systemKey: null,
          crosswalkId: null
        });
        assert.equal(
          [hubCrosswalk.id, dellScope.id, dellQuote.id].every((id) =>
            adjacentTrace.crosswalks.some((entry) =>
              entry.id === id && entry.projectId === claim.project.id
            )
          ),
          true
        );
        assert.equal(adjacentTrace.remoteWrites, false);
        assert.equal(adjacentTrace.providerEffects, false);
        assert.equal(adjacentTrace.automaticCommands, false);
        passed("hub-dell-same-project-held-readback");

        assert.deepEqual(gates, EXPECTED_GATES);
        assert.equal(gates.length, 15);
      }
    );
    await t.test(
      "shipped hosted page creates, activates, saves, and signs back into one real PostgreSQL account",
      {
        skip: CORE_REVENUE_E2E_ONLY ||
          projectLegalAuthorityConfig.authority?.documents[0]
            ?.contentUri.includes("privacy-v3-proof.invalid")
      },
      async () => {
        const api = createHostedApi(service, {
          downloadCommerce,
          alakazamAccount,
          customServicesAccount,
          customServicesOwner,
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
              `document.querySelector(` +
                `"[name=acceptedProjectTerms]")?.disabled === false ` +
                `&& globalThis.SiteSourceryAbracadabraHostedSession` +
                `.getState().projectLegalAuthorityStatus === "ready"`,
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

          const alakazamPanelPresent = await evaluate(
            `Boolean(document.querySelector("[data-alakazam-account]"))`
          );
          const alakazamOfferState = await evaluate(
            `globalThis.SiteSourceryAbracadabraCustomerControl` +
              `.alakazamPublicOfferState`
          );
          assert.match(alakazamOfferState, /^(?:held|released)$/u);
          if (alakazamOfferState === "held") {
            assert.equal(
              alakazamPanelPresent,
              false,
              "held Alakazam must not enter the customer DOM"
            );
          } else {
            assert.equal(alakazamPanelPresent, true);
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
          }

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
            schema: "sitesourcery_download_checkout_v3",
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
          await cdp.send("Page.navigate", {
            url: `${appUrl}?checkout=${encodeURIComponent(
              browserCheckoutId
            )}&download_project=${encodeURIComponent(
              savedState.project.id
            )}`
          });
          await waitFor(
            `document.readyState === "complete" && ` +
              `location.pathname === "/abracadabra/app/" && ` +
              `location.search === "" && ` +
              `document.documentElement.getAttribute(` +
              `"data-abracadabra-control-ready") === "hosted"`,
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
            2000
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
          const unexpectedBrowserErrors = [
            ...new Set(browserErrors)
          ].filter((message) =>
            !/^Failed to load resource: the server responded with a status of (?:401|403|503) \(/u
              .test(message)
          );
          assert.deepEqual(unexpectedBrowserErrors, []);
        } finally {
          if (reviewedBrowser) {
            await reviewedBrowser.close();
          }
          await browserServer.close();
        }
      }
    );
    // This dispute deliberately holds all new Download Checkouts. Run it after
    // purchase journeys; keep the old event time to cover delayed delivery.
    const gateBeforeDispute = (await pool.query(
      "select state, revision, state_changed_at from ss.commerce_v2_download_checkout_gate"
    )).rows[0];
    assert.equal(gateBeforeDispute.state, "open");
    const postRevocationDispute = stripeEvent(
      "evt_test_download_dispute_after_revoked_1",
      "charge.dispute.created",
      {
        id: "dp_test_download_after_revoked_1",
        livemode: false,
        payment_intent: "pi_test_download_1",
        currency: "usd",
        amount: 2000,
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

    const gateAfterDispute = (await pool.query(`select state, revision::integer as revision,
      state_changed_at >= $1::timestamptz as monotonic
      from ss.commerce_v2_download_checkout_gate`,
      [gateBeforeDispute.state_changed_at])).rows[0];
    assert.deepEqual(gateAfterDispute, {
      state: "held", revision: Number(gateBeforeDispute.revision) + 1, monotonic: true
    });
    assert.ok(Date.parse(NOW) < new Date(gateBeforeDispute.state_changed_at).getTime());
    assert.deepEqual(await stripeWebhook.ingestStripeWebhook({
      rawBody: rawEvent(postRevocationDispute), signature: "contract-signature-valid"
    }), { status: "processed", projectId,
      entitlementId: paidProject.project.entitlements[0].id,
      entitlementState: "revoked", reason: "payment_fully_refunded" });
    assert.equal((await pool.query(
      "select count(*)::integer as count from ss.commerce_v2_download_gate_transitions"
    )).rows[0].count, 1);
    const heldProject = await service.createProject(actor, organizationId, {
      name: "New purchase after dispute", legalAcceptance: projectLegalAcceptance,
      visibility: "public", address: { kind: "licensed", label: "post-dispute-proof" },
      commandId: "project-create-after-dispute"
    });
    const heldProjectId = heldProject.project.id;
    await service.saveDraft(actor, heldProjectId, {
      rawFacts, expectedRevision: 1, commandId: "draft-after-dispute"
    });
    const heldVersion = await service.createVersion(actor, heldProjectId, {
      rawFacts, previewDigest: compiled.artifactDigest, reviewAttested: true,
      commandId: "version-after-dispute"
    });
    await service.markVersionReady(actor, heldProjectId, heldVersion.version.id,
      { commandId: "ready-after-dispute" });
    await service.acceptVersion(actor, heldProjectId, heldVersion.version.id,
      { commandId: "accept-after-dispute" });
    const heldQuote = await downloadCommerce.createQuote(actor, heldProjectId, {
      versionId: heldVersion.version.id, commandId: "download-quote-after-dispute"
    });
    const effectsBeforeHeldAttempt = payment.calls.downloadCheckout.length;
    await assert.rejects(downloadCommerce.prepareCheckout(actor, heldProjectId, heldQuote.quoteId, {
      ...downloadRequestEvidence, purchaseTermsAccepted: true,
      acceptedDisclosureDigest: heldQuote.disclosureDigest,
      commandId: "download-checkout-after-dispute"
    }), { code: "COMMERCE_V2_DOWNLOAD_CHECKOUT_HELD", status: 503 });
    assert.equal(payment.calls.downloadCheckout.length, effectsBeforeHeldAttempt);
    const recordedDispute = (await pool.query(`select provider_created_at
      from ss.commerce_v2_download_reversal_events where id = $1`,
      [postRevocationDispute.id])).rows[0];
    assert.equal(recordedDispute.provider_created_at.toISOString(), NOW);
    t.diagnostic("C2: delayed dispute held Checkout once without restoring refunded entitlement; original provider event time retained.");
    await t.test(
      "paid-project deletion removes content and retains payment evidence",
      async () => {
        const evidenceTables = [
          "commerce_v2_commands", "commerce_v2_download_quotes",
          "commerce_v2_checkout_preparations", "commerce_v2_download_dispatches",
          "commerce_v2_download_stripe_events", "commerce_v2_download_payment_receipts",
          "commerce_v2_project_entitlements", "commerce_v2_download_reversal_events",
          "commerce_v2_download_checkout_attempts", "commerce_v2_download_access_events",
          "commerce_v2_download_fraud_warning_events", "commerce_v2_download_dispute_dossiers"
        ];
        async function evidenceFor(id) {
          const result = {};
          for (const table of evidenceTables) {
            result[table] = (await pool.query(`select count(*)::integer as count,
              coalesce(jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text), '[]')::text as rows
              from ss.${table} row where organization_id = $1 and project_id = $2`,
              [organizationId, id])).rows[0];
          }
          return result;
        }
        const paidEvidence = await evidenceFor(projectId);
        const heldEvidence = await evidenceFor(heldProjectId);
        assert.ok(paidEvidence.commerce_v2_download_payment_receipts.count > 0);
        assert.ok(paidEvidence.commerce_v2_download_access_events.count > 0);
        assert.ok(paidEvidence.commerce_v2_download_dispute_dossiers.count > 0);
        assert.equal(heldEvidence.commerce_v2_download_payment_receipts.count, 0);
        assert.equal(heldEvidence.commerce_v2_download_checkout_attempts.count, 1);
        if (DELETION_UPGRADE_PROOF) {
          await pool.query(await readFile(new URL(RETAINED_PURGE_MIGRATION, MIGRATIONS), "utf8"));
          awaitingRetentionUpgrade = false;
          assert.deepEqual(await evidenceFor(projectId), paidEvidence);
          assert.deepEqual(await evidenceFor(heldProjectId), heldEvidence);
          t.diagnostic("C2 deletion: migration 150 upgraded populated 102-file schema without changing financial/risk rows.");
        }
        assert.equal((await authority.assertReady()).ready, true);
        assert.deepEqual((await pool.query(`select
          count(*)::integer as count from pg_trigger
          where tgfoid = 'ss.require_download_live_version()'::regprocedure
            and not tgisinternal`)).rows[0], { count: 3 });
        // A setting alone is not a seal; ordinary deletion and key rewriting
        // must retain the same referential protection as the former FKs.
        for (const forgedSetting of [false, true]) {
          await assert.rejects(authority.service({ actorKind: "system" }, async client => {
            if (forgedSetting) await client.query(
              "select set_config('app.terminal_purge_project_id', $1, true)", [projectId]);
            await client.query("delete from ss.site_versions where id = $1", [version.version.id]);
          }), { code: "23503", message: "referenced Download version requires sealed terminal deletion" });
        }
        await assert.rejects(authority.service({ actorKind: "system" }, client => client.query(
          "update ss.site_versions set id = $2 where id = $1",
          [version.version.id, randomUUID()]
        )), { code: "23503" });
        await assert.rejects(service.deleteProject(otherActor, projectId, {
          commandId: "delete-wrong-tenant-0001"
        }), { code: "FORBIDDEN", status: 403 });
        const pendingEvidence = await evidenceFor(expiryProjectId);
        await assert.rejects(service.deleteProject(actor, expiryProjectId, {
          commandId: "delete-unresolved-payment-0001"
        }), { code: "PROJECT_PAYMENT_RECONCILIATION_REQUIRED", status: 409 });
        assert.deepEqual(await evidenceFor(expiryProjectId), pendingEvidence);
        assert.equal((await pool.query("select lifecycle from ss.projects where id = $1",
          [expiryProjectId])).rows[0].lifecycle, "active");
        assert.equal((await pool.query("select count(*)::integer as count from ss.deletion_requests where project_id = $1",
          [expiryProjectId])).rows[0].count, 0);

        // The unpaid custom-domain project exercises ordinary quote/content
        // purge as well as the two retained-evidence cases.
        await service.saveDraft(actor, ownedProjectId, {
          rawFacts, expectedRevision: 1, commandId: "delete-unpaid-draft"
        });
        const unpaidVersion = await service.createVersion(actor, ownedProjectId, {
          rawFacts, previewDigest: compiled.artifactDigest, reviewAttested: true,
          commandId: "delete-unpaid-version"
        });
        await service.markVersionReady(actor, ownedProjectId, unpaidVersion.version.id,
          { commandId: "delete-unpaid-ready" });
        await service.acceptVersion(actor, ownedProjectId, unpaidVersion.version.id,
          { commandId: "delete-unpaid-accept" });
        await downloadCommerce.createQuote(actor, ownedProjectId, {
          versionId: unpaidVersion.version.id, commandId: "delete-unpaid-quote"
        });
        const selectedProjects = [projectId, heldProjectId, ownedProjectId];
        const providerCallSnapshot = () => Object.fromEntries(Object.entries(payment.calls)
          .map(([kind, calls]) => [kind, { count: calls.length, digest: createHash("sha256").update(JSON.stringify(calls)).digest("hex") }]));
        const providerCallsBefore = providerCallSnapshot();
        for (const id of selectedProjects) {
          const input = { commandId: `delete-retained-${id}` };
          const deleted = await service.deleteProject(actor, id, input);
          assert.equal(deleted.state, "purging");
          assert.equal(deleted.deleted, false);
          assert.deepEqual(await service.deleteProject(actor, id, input), deleted);
          const row = (await pool.query(`select project.lifecycle, project.name,
            serving.state as serving, request.removal_counts
            from ss.projects project join ss.project_serving_projection serving on serving.project_id = project.id
            join ss.deletion_requests request on request.project_id = project.id
            where project.id = $1`, [id])).rows[0];
          assert.equal(row.lifecycle, "deleting");
          assert.equal(row.name, null);
          assert.equal(row.serving, "dark");
          assert.ok(row.removal_counts.versions > 0);
          if (id !== ownedProjectId) {
            assert.equal(row.removal_counts.commerceV2DownloadQuotes, 0);
            assert.ok(row.removal_counts.retainedDownloadEvidence.commerceV2DownloadCheckoutAttempts > 0);
          } else {
            assert.equal(row.removal_counts.commerceV2DownloadQuotes, 1);
            assert.equal(row.removal_counts.retainedDownloadEvidence, undefined);
            const unpaidEvidence = await evidenceFor(id);
            assert.ok(Object.values(unpaidEvidence).every(row => row.count === 0));
          }
          for (const table of ["site_versions", "artifacts", "fact_sets", "project_drafts",
            "support_messages", "support_tickets", "export_requests"]) {
            assert.equal((await pool.query(`select count(*)::integer as count from ss.${table}
              where project_id = $1`, [id])).rows[0].count, 0, `${table} content erased`);
          }
        }
        assert.deepEqual(await evidenceFor(projectId), paidEvidence);
        assert.deepEqual(await evidenceFor(heldProjectId), heldEvidence);
        await assert.rejects(authority.service({ actorKind: "system" }, client => client.query(
          "delete from ss.commerce_v2_download_checkout_attempts where project_id = $1", [projectId]
        )), { code: "55000" });
        await assert.rejects(downloadCommerce.download(actor, projectId, version.version.id,
          { ...downloadRequestEvidence, requestId: "deleted-download-denied" }),
          error => error.status === 404 || error.status === 409);
        await assert.rejects(downloadCommerce.createQuote(actor, projectId, {
          versionId: version.version.id, commandId: "deleted-quote-denied"
        }), error => error.status === 404 || error.status === 409);

        const lifecycle = createPostgresProjectLifecycleRepository({ authority });
        const executor = createProjectLifecycleExecutor({
          objectStore: exportStore, publicationPort: serviceOptions.publicationPort
        });
        const jobs = (await pool.query(`select job_type, payload from ss.lifecycle_jobs
          where project_id = any($1::uuid[])`, [selectedProjects])).rows;
        assert.ok(jobs.some(job => job.job_type === "delete_blob"));
        assert.ok(jobs.some(job => job.job_type === "unpublish_project"));
        const existingExports = (await exportStore.backupManifest()).entries;
        assert.ok(existingExports.some(object => jobs.some(job =>
          job.job_type === "delete_blob" && job.payload.objectKey === object.key)),
          "at least one queued export object exists before deletion");
        const workerId = "project-lifecycle-deletion-proof";
        const observedAt = fromNow(5 * 60 * 1000);
        let completed = 0;
        for (; completed < 50; completed += 1) {
          const selected = await lifecycle.claimNext({ workerId, observedAt, leaseSeconds: 300 });
          if (!selected) break;
          assert.ok(selectedProjects.includes(selected.projectId), "only approved local deletion jobs");
          const result = await executor.execute(selected);
          const completion = { jobId: selected.jobId, fence: selected.fence, workerId, observedAt, result };
          assert.equal((await lifecycle.completeClaim(completion)).status, "succeeded");
          await assert.rejects(lifecycle.completeClaim(completion), {
            code: "PROJECT_LIFECYCLE_LEASE_LOST", status: 409
          });
        }
        assert.equal(completed, jobs.length);
        for (const job of jobs.filter(job => job.job_type === "delete_blob")) {
          assert.equal((await exportStore.delete({ key: job.payload.objectKey })).deleted, false,
            "worker already removed the real local export object");
        }
        for (const job of jobs.filter(job => job.job_type === "unpublish_project")) {
          const binding = tenantRuntime.control.lookup(job.payload.hostname);
          assert.ok(!binding || binding.status === "dark", "publication is dark after the worker");
        }
        for (const id of selectedProjects) {
          const final = (await pool.query(`select project.lifecycle, project.name,
            request.state, tombstone.removal_counts
            from ss.projects project join ss.deletion_requests request on request.project_id = project.id
            join ss.project_deletion_tombstones tombstone on tombstone.project_id = project.id
            where project.id = $1`, [id])).rows[0];
          assert.equal(final.lifecycle, "deleted");
          assert.equal(final.name, null);
          assert.equal(final.state, "completed");
          assert.equal(final.removal_counts.retainedDownloadEvidence?.commerceV2DownloadPaymentReceipts ?? 0,
            id === projectId ? paidEvidence.commerce_v2_download_payment_receipts.count : 0);
          assert.deepEqual(await service.deleteProject(actor, id, { commandId: `delete-final-${id}` }),
            { deleted: true, projectId: id, state: "completed" });
        }
        assert.deepEqual(await evidenceFor(projectId), paidEvidence);
        assert.deepEqual(await evidenceFor(heldProjectId), heldEvidence);
        assert.deepEqual(providerCallSnapshot(), providerCallsBefore, "deletion creates no provider effects");
        const retainedReversalResult = { status: "processed", projectId,
          entitlementId: paidProject.project.entitlements[0].id,
          entitlementState: "revoked", reason: "payment_fully_refunded" };
        assert.deepEqual(await stripeWebhook.ingestStripeWebhook({
          rawBody: rawEvent(postRevocationDispute), signature: "contract-signature-valid"
        }), retainedReversalResult);
        assert.deepEqual(await evidenceFor(projectId), paidEvidence);
        const lateDispute = stripeEvent("evt_test_download_dispute_after_deletion_1",
          "charge.dispute.closed", { ...postRevocationDispute.data.object, status: "won" });
        assert.deepEqual(await stripeWebhook.ingestStripeWebhook({
          rawBody: rawEvent(lateDispute), signature: "contract-signature-valid"
        }), retainedReversalResult);
        const afterLateDispute = await evidenceFor(projectId);
        for (const table of evidenceTables) {
          if (["commerce_v2_download_reversal_events", "commerce_v2_download_dispute_dossiers"].includes(table)) {
            assert.equal(afterLateDispute[table].count, paidEvidence[table].count + 1);
          } else {
            assert.deepEqual(afterLateDispute[table], paidEvidence[table]);
          }
        }
        await assert.rejects(downloadCommerce.download(actor, projectId, version.version.id,
          { ...downloadRequestEvidence, requestId: "deleted-after-late-dispute" }),
          error => error.status === 404 || error.status === 409);
        const { webhook: beforeWebhook, ...beforeEffects } = providerCallsBefore;
        const { webhook: afterWebhook, ...afterEffects } = providerCallSnapshot();
        assert.deepEqual(afterEffects, beforeEffects);
        assert.equal(afterWebhook.count, beforeWebhook.count + 2,
          "only the two explicitly supplied local webhook envelopes were verified");
        t.diagnostic(`C2 deletion: paid, risk-held, and unpaid projects completed; ${completed} real local lifecycle jobs; financial evidence unchanged; pending payment and cross-tenant deletion denied.`);
      }
    );
    await authority.close();
  }
);
