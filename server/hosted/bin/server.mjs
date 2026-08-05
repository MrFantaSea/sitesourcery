#!/usr/bin/env node
import "../assert-runtime.mjs";

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNodeHandler as createTenantNodeHandler,
  DEFAULT_PLATFORM_BASE_DOMAIN,
  SelfHostRuntime
} from "../../selfhost/src/index.mjs";
import {
  createAlakazamBillingService,
  createAlakazamDowngradeService,
  createAlakazamDowngradeActivationService,
  createAlakazamAccountService,
  createAlakazamPaymentService,
  createAlakazamStartActivationService,
  createAlakazamStripeEventRouter,
  createAlakazamUpgradeService,
  createHostedAlakazamAccount,
  createHostedAlakazamBilling,
  createCommerceV2Boundary,
  createCommerceV2Service,
  createDownloadPaymentService,
  createHostedDownloadCommerce
} from "../../commerce-v2/index.mjs";
import {
  assertApprovedAlakazamReady,
  createConfiguredAlakazamRelease
} from "../alakazam-release-config.mjs";
import {
  createPostgresAlakazamRepository
} from "../alakazam-postgres.mjs";
import {
  createAlakazamFulfillmentWorker
} from "../alakazam-fulfillment-worker.mjs";
import {
  cancellationWorkerOptionsFromEnvironment,
  createCancellationWorker
} from "../cancellation-worker.mjs";
import {
  createPostgresCommerceV2Adapter
} from "../commerce-v2-postgres.mjs";
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
  createPostgresCustomServicesRequestRepository
} from "../custom-services-request-postgres.mjs";
import {
  createPostgresCustomServicesOwner
} from "../custom-services-owner-postgres.mjs";
import {
  assertApprovedDownloadPaymentReady,
  createConfiguredDownloadPaymentRelease
} from "../download-payment-config.mjs";
import {
  createPostgresDownloadPaymentRepository
} from "../download-payment-postgres.mjs";
import { createHeldDomainRuntime } from "../domain-postgres-runtime.mjs";
import {
  createExportWorker,
  exportWorkerOptionsFromEnvironment
} from "../export-worker.mjs";
import { createHostedApi } from "../http.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import { createNodeHandler as createApiNodeHandler } from "../node-handler.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import {
  createAesGcmContactVault,
  createConfiguredRegistrationMailPort,
  createConfiguredRecoveryMailPort,
  createJsonCatalogPort
} from "../production-ports.mjs";
import {
  createCanonicalPostgresAuthority,
  createPostgresPool
} from "../repository-postgres.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";
import { createSparkCompilerPort } from "../spark-compiler-port.mjs";
import {
  assertApprovedStripeReady,
  createConfiguredStripeProvider,
  redactStripeReadiness
} from "../stripe-production-config.mjs";
import {
  createStripeWebhookRouter
} from "../stripe-webhook-router.mjs";

const moduleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const repositoryRoot = path.resolve(moduleRoot, "../..");
const host = process.env.SITESOURCERY_HOSTED_HOST ?? "127.0.0.1";
const apiPort = Number(
  process.env.SITESOURCERY_HOSTED_PORT ?? "8788"
);
const tenantPort = Number(
  process.env.SITESOURCERY_TENANT_PORT ?? "8080"
);
const dataRoot = path.resolve(
  process.env.SITESOURCERY_DATA_ROOT ??
    "/var/lib/sitesourcery"
);
const licensedBaseDomain =
  process.env.SITESOURCERY_LICENSED_BASE_DOMAIN ??
  DEFAULT_PLATFORM_BASE_DOMAIN;
const approvalPath =
  process.env.SITESOURCERY_PUBLICATION_APPROVAL_PATH ??
  "/etc/sitesourcery/PUBLICATION_APPROVED";
const holdPaths = [
  path.join(moduleRoot, "PUBLICATION_HOLD"),
  path.join(
    repositoryRoot,
    "server",
    "selfhost",
    "PUBLICATION_HOLD"
  ),
  "/etc/sitesourcery/PUBLICATION_HOLD"
];

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function secret(name, minimumBytes = 32) {
  const value = Buffer.from(
    requiredEnvironment(name),
    "base64"
  );
  if (value.byteLength < minimumBytes) {
    throw new Error(
      `${name} must decode to at least ${minimumBytes} bytes.`
    );
  }
  return value;
}

if (host !== "127.0.0.1") {
  throw new Error(
    "Hosted and tenant services must bind to loopback behind the reviewed reverse proxy."
  );
}
for (const [name, value] of [
  ["SITESOURCERY_HOSTED_PORT", apiPort],
  ["SITESOURCERY_TENANT_PORT", tenantPort]
]) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1024 ||
    value > 65535
  ) {
    throw new Error(`${name} must be an unprivileged TCP port.`);
  }
}
if (apiPort === tenantPort) {
  throw new Error(
    "Hosted API and tenant serving ports must be different."
  );
}

const pool = createPostgresPool({
  ssl:
    process.env.SITESOURCERY_DATABASE_SSL === "require"
      ? { rejectUnauthorized: true }
      : undefined
});
const authority = createCanonicalPostgresAuthority({ pool });
let apiServer = null;
let tenantServer = null;
let cancellationWorker = null;
let exportWorker = null;
let alakazamFulfillmentWorker = null;
let shutdownPromise = null;
const shutdownController = new AbortController();

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function shutdown() {
  if (!shutdownPromise) {
    shutdownController.abort();
    shutdownPromise = (async () => {
      await Promise.all([
        closeServer(apiServer),
        closeServer(tenantServer),
        cancellationWorker
          ? cancellationWorker.stop()
          : Promise.resolve(),
        exportWorker
          ? exportWorker.stop()
          : Promise.resolve(),
        alakazamFulfillmentWorker
          ? alakazamFulfillmentWorker.stop()
          : Promise.resolve()
      ]);
      cancellationWorker = null;
      exportWorker = null;
      alakazamFulfillmentWorker = null;
      await authority.close();
    })();
  }
  return shutdownPromise;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      server.off("listening", onListening);
      reject(error);
    }
    function onListening() {
      server.off("error", onError);
      resolve();
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function start() {
  await authority.assertReady();
  const commerceV2 =
    createPostgresCommerceV2Adapter({
      authority
    });
  const stripeComposition =
    createConfiguredStripeProvider();
  const downloadPaymentComposition =
    createConfiguredDownloadPaymentRelease();
  const alakazamComposition =
    createConfiguredAlakazamRelease();
  const downloadPayment =
    createDownloadPaymentService({
      repository:
        createPostgresDownloadPaymentRepository({
          authority
        }),
      provider: stripeComposition.adapter,
      release: downloadPaymentComposition.release,
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
  const customServicesAccountRepository =
    createPostgresCustomServicesAccountRepository({
      authority
    });
  const customServicesAssessmentQuoteRepository =
    createPostgresCustomServicesAssessmentQuoteRepository({
      authority
    });
  const customServicesRequestRepository =
    createPostgresCustomServicesRequestRepository({ authority });
  const customServicesOwner =
    createPostgresCustomServicesOwner({ authority });
  const customServicesAccount =
    createHostedCustomServicesAccount({
      quoteRepository: customServicesAssessmentQuoteRepository,
      requestRepository: customServicesRequestRepository,
      repository: customServicesAccountRepository,
      resolveSession: commerceV2.resolveSession
    });
  const alakazamServicePorts = {
    repository: alakazamRepository,
    provider: stripeComposition.adapter,
    clock: commerceV2.clock,
    ids: commerceV2.ids,
    release: alakazamComposition.release
  };
  const alakazamBilling =
    createHostedAlakazamBilling({
      billing: createAlakazamBillingService(
        alakazamServicePorts
      ),
      downgrade: createAlakazamDowngradeService(
        alakazamServicePorts
      ),
      resolveSession: commerceV2.resolveSession
    });
  const alakazamUpgrade =
    createAlakazamUpgradeService(
      alakazamServicePorts
    );
  const alakazamCommerce =
    createAlakazamStripeEventRouter({
      payment: createAlakazamPaymentService(
        alakazamServicePorts
      ),
      startActivation:
        createAlakazamStartActivationService(
          alakazamServicePorts
        ),
      upgradeActivation: alakazamUpgrade,
      upgradeApplication: alakazamUpgrade,
      downgradeActivation:
        createAlakazamDowngradeActivationService(
          alakazamServicePorts
        )
    });
  const domainRuntime =
    createHeldDomainRuntime();

  const identityPepper = secret(
    "SITESOURCERY_IDENTITY_PEPPER"
  );
  const registrationMailPort =
    await createConfiguredRegistrationMailPort();
  const identity = createPostgresIdentityBridge({
    pool,
    authority,
    pepper: identityPepper,
    registrationMailPort,
    pepperVersion:
      process.env.SITESOURCERY_IDENTITY_PEPPER_VERSION ??
      "v1"
  });
  const contactVault = createAesGcmContactVault({
    key: secret(
      "SITESOURCERY_CONTACT_VAULT_KEY",
      32
    ),
    keyVersion:
      process.env
        .SITESOURCERY_CONTACT_VAULT_KEY_VERSION ?? "v1"
  });
  const compiler = await createSparkCompilerPort({
    expectedSourceDigest: requiredEnvironment(
      "SITESOURCERY_SPARK_COMPILER_SHA256"
    )
  });
  const exportStore = await createPrivateExportObjectStore({
    root: path.resolve(
      process.env.SITESOURCERY_EXPORT_ROOT ??
        path.join(dataRoot, "private-exports")
    )
  });
  const publicationHeld = () =>
    !existsSync(approvalPath) ||
    holdPaths.some((target) => existsSync(target));
  const tenantRuntime = await SelfHostRuntime.open({
    root: path.join(dataRoot, "tenant-runtime"),
    publicationHeld,
    controlHost: host,
    platformBaseDomain: licensedBaseDomain
  });
  const publicationPort = createSelfHostPublicationPort({
    runtime: tenantRuntime
  });
  alakazamFulfillmentWorker =
    createAlakazamFulfillmentWorker({
      repository: alakazamRepository,
      compiler,
      publicationPort,
      clock: commerceV2.clock,
      ids: commerceV2.ids,
      enabled:
        alakazamComposition.mode === "approved" &&
        publicationHeld() === false,
      log(entry) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
      }
    });
  const recoveryMailPort =
    await createConfiguredRecoveryMailPort();
  const service = createCanonicalPostgresService({
    authority,
    identity,
    compiler,
    catalogPort: createJsonCatalogPort(
      process.env.SITESOURCERY_OFFER_CATALOG_PATH
    ),
    publicationPort,
    exportStore,
    recoveryMailPort,
    contactVault,
    paymentProvider: stripeComposition.adapter,
    domainRuntime,
    licensedBaseDomain
  });

  const readiness = await service.readiness();
  assertApprovedStripeReady(
    stripeComposition,
    readiness.payments
  );
  assertApprovedDownloadPaymentReady(
    downloadPaymentComposition,
    await downloadPayment.readiness()
  );
  assertApprovedAlakazamReady(
    alakazamComposition,
    readiness.payments
  );
  if (!readiness.ready) {
    throw new Error(
      "Hosted runtime is not ready; inspect the private readiness endpoint for exact held dependencies."
    );
  }
  const paymentReadiness = redactStripeReadiness(
    readiness.payments,
    stripeComposition
  );
  exportWorker = createExportWorker({
    service,
    ...exportWorkerOptionsFromEnvironment(),
    log(entry) {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
  });

  apiServer = createServer(
    createApiNodeHandler(
      createHostedApi(service, {
        downloadCommerce,
        alakazamAccount,
        alakazamBilling,
        customServicesAccount,
        customServicesOwner,
        stripeWebhook: createStripeWebhookRouter({
          provider: stripeComposition.adapter,
          canonicalService: service,
          downloadCommerce,
          alakazamCommerce
        })
      })
    )
  );
  tenantServer = createServer(
    createTenantNodeHandler(tenantRuntime)
  );
  for (const server of [apiServer, tenantServer]) {
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
  }

  await listen(apiServer, apiPort);
  await listen(tenantServer, tenantPort);

  exportWorker.start({
    signal: shutdownController.signal
  });
  alakazamFulfillmentWorker.start({
    signal: shutdownController.signal
  });

  if (stripeComposition.mode === "approved_live") {
    cancellationWorker = createCancellationWorker({
      service,
      ...cancellationWorkerOptionsFromEnvironment(),
      log(entry) {
        process.stdout.write(
          `${JSON.stringify(entry)}\n`
        );
      }
    });
    cancellationWorker.start();
  }

  process.stdout.write(
    `${JSON.stringify({
      event: "sitesourcery.hosted.started",
      host,
      apiPort,
      tenantPort,
      publicationHeld: readiness.publication.held,
      recoveryMode: readiness.recovery.mode,
      recoveryProvider:
        readiness.recovery.provider ?? null,
      database: readiness.persistence.database,
      compilerRevision: readiness.compiler.revision,
      catalogVersion: readiness.catalog.catalogVersion,
      payments: paymentReadiness,
      alakazamMode: alakazamComposition.mode,
      cancellationWorker:
        cancellationWorker?.snapshot().state ??
        "held_not_started",
      exportWorker:
        exportWorker?.snapshot().state ??
        "held_not_started",
      alakazamFulfillmentWorker:
        alakazamFulfillmentWorker?.snapshot().state ??
        "held_not_started"
    })}\n`
  );
}

try {
  await start();
} catch (error) {
  try {
    await shutdown();
  } catch {
    // Preserve the startup error as the authoritative failure.
  }
  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
