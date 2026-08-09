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
  createAlakazamCancellationService,
  createAlakazamDowngradeService,
  createAlakazamDowngradeActivationService,
  createAlakazamAccountService,
  createAlakazamPaymentIncidentService,
  createAlakazamPaymentRecoveryService,
  createAlakazamPaymentService,
  createAlakazamRenewalService,
  createAlakazamReversalService,
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
  createAlakazam35Composition
} from "../alakazam-35-composition.mjs";
import {
  createAlakazam35Compiler
} from "../alakazam-35-compiler.mjs";
import {
  createAlakazam35FulfillmentRepository,
  createAlakazam35TierCompiler
} from "../alakazam-35-fulfillment.mjs";
import {
  createPostgresAlakazam35Repository
} from "../alakazam-35-postgres.mjs";
import {
  createAlakazam35PublicationPort
} from "../alakazam-35-publication-port.mjs";
import {
  createAlakazam50Compiler
} from "../alakazam-50-compiler.mjs";
import {
  createAlakazam50Composition
} from "../alakazam-50-composition.mjs";
import {
  createAlakazam50FulfillmentRepository,
  createAlakazam50TierCompiler
} from "../alakazam-50-fulfillment.mjs";
import {
  createPostgresAlakazam50Repository
} from "../alakazam-50-postgres.mjs";
import {
  createHostedAlakazamBillingSurfaces
} from "../alakazam-billing.mjs";
import {
  createPostgresAlakazamBillingRepository
} from "../alakazam-billing-postgres.mjs";
import {
  createConfiguredAlakazamLifecyclePolicy
} from "../alakazam-lifecycle-policy-config.mjs";
import {
  createPostgresAlakazamLifecycleRepository
} from "../alakazam-lifecycle-postgres.mjs";
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
  createPostgresCustomServicesAssessmentPayment
} from "../custom-services-assessment-payment-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentSettlement
} from "../custom-services-assessment-settlement-postgres.mjs";
import {
  createPostgresCustomServicesAssessmentWork
} from "../custom-services-assessment-work-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuild
} from "../custom-services-custom-build-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildWork
} from "../custom-services-custom-build-work-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildProgress
} from "../custom-services-custom-build-progress-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildChangeCompletion
} from "../custom-services-custom-build-change-completion-postgres.mjs";
import {
  assertApprovedCustomBuildChangePaymentReady,
  createConfiguredCustomBuildChangePaymentRelease
} from "../custom-services-custom-build-change-payment-config.mjs";
import {
  createPostgresCustomServicesCustomBuildChangePayment
} from "../custom-services-custom-build-change-payment-postgres.mjs";
import {
  assertApprovedCustomBuildFinalPaymentReady,
  createConfiguredCustomBuildFinalPaymentRelease
} from "../custom-services-custom-build-final-payment-config.mjs";
import {
  createPostgresCustomServicesCustomBuildFinalPayment
} from "../custom-services-custom-build-final-payment-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildHandoff
} from "../custom-services-custom-build-handoff-postgres.mjs";
import {
  createPostgresCustomServicesCustomBuildPayment
} from "../custom-services-custom-build-payment-postgres.mjs";
import {
  assertApprovedCustomBuildPaymentReady,
  createConfiguredCustomBuildPaymentRelease
} from "../custom-services-custom-build-payment-config.mjs";
import {
  assertApprovedCustomServicesAssessmentPaymentReady,
  createConfiguredCustomServicesAssessmentPaymentRelease
} from "../custom-services-assessment-payment-config.mjs";
import {
  createPostgresCustomServicesInvoiceRepository
} from "../custom-services-invoice-postgres.mjs";
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
import {
  createAlakazamPublicationComposition
} from "../alakazam-publication-composition.mjs";
import { createHostedApi } from "../http.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import { createNodeHandler as createApiNodeHandler } from "../node-handler.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import {
  createProjectLegalAuthorityFromEnvironment
} from "../project-legal-authority.mjs";
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
  const customServicesAssessmentPaymentComposition =
    createConfiguredCustomServicesAssessmentPaymentRelease();
  const customBuildPaymentComposition =
    createConfiguredCustomBuildPaymentRelease();
  const customBuildChangePaymentComposition =
    createConfiguredCustomBuildChangePaymentRelease();
  const customBuildFinalPaymentComposition =
    createConfiguredCustomBuildFinalPaymentRelease();
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
  const alakazam35Repository =
    createPostgresAlakazam35Repository({ authority });
  const alakazam35 = createAlakazam35Composition({
    repository: alakazam35Repository,
    resolveSession: commerceV2.resolveSession,
    clock: commerceV2.clock
  });
  const alakazamFulfillmentRepository =
    createAlakazam35FulfillmentRepository({
      baseRepository: alakazamRepository,
      tierRepository: alakazam35Repository
    });
  const alakazam50Repository =
    createPostgresAlakazam50Repository({ authority });
  const alakazam50 = createAlakazam50Composition({
    repository: alakazam50Repository,
    resolveSession: commerceV2.resolveSession,
    clock: commerceV2.clock
  });
  const alakazam50FulfillmentRepository =
    createAlakazam50FulfillmentRepository({
      baseRepository: alakazamFulfillmentRepository,
      tierRepository: alakazam50Repository
    });
  const alakazamAccountService =
    createAlakazamAccountService({
      repository: alakazamRepository
    });
  const alakazamAccount =
    createHostedAlakazamAccount({
      account: alakazamAccountService,
      resolveSession: commerceV2.resolveSession
    });
  const alakazamPublication =
    createAlakazamPublicationComposition({
      authority,
      resolveSession: commerceV2.resolveSession,
      clock: commerceV2.clock
    });
  const alakazamBillingSurfaces =
    createHostedAlakazamBillingSurfaces({
      repository:
        createPostgresAlakazamBillingRepository({
          authority
        }),
      account: alakazamAccountService,
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
  const customServicesInvoiceRepository =
    createPostgresCustomServicesInvoiceRepository({
      authority,
      release:
        customServicesAssessmentPaymentComposition.release
    });
  const customServicesAssessmentSettlement =
    createPostgresCustomServicesAssessmentSettlement({
      authority,
      provider: stripeComposition.adapter,
      clock: commerceV2.clock,
      ids: commerceV2.ids
    });
  const customServicesAssessmentPayment =
    createPostgresCustomServicesAssessmentPayment({
      authority,
      provider: stripeComposition.adapter,
      release:
        customServicesAssessmentPaymentComposition.release,
      reconciliation:
        customServicesAssessmentSettlement
    });
  const customServicesRequestRepository =
    createPostgresCustomServicesRequestRepository({ authority });
  const customServicesOwner =
    createPostgresCustomServicesOwner({ authority });
  const customServicesAssessmentWork =
    createPostgresCustomServicesAssessmentWork({
      authority,
      clock: commerceV2.clock,
      randomUUID: () => commerceV2.ids.next("assessment_work")
    });
  const customServicesCustomBuild =
    createPostgresCustomServicesCustomBuild({
      authority,
      randomUUID: () => commerceV2.ids.next("custom_build")
    });
  const customServicesCustomBuildWork =
    createPostgresCustomServicesCustomBuildWork({ authority });
  const customServicesCustomBuildProgress =
    createPostgresCustomServicesCustomBuildProgress({ authority });
  const customServicesCustomBuildChangeCompletion =
    createPostgresCustomServicesCustomBuildChangeCompletion({
      authority,
      clock: commerceV2.clock,
      randomUUID: () => commerceV2.ids.next("custom_build_change_completion")
    });
  const customBuildChangePayment =
    createPostgresCustomServicesCustomBuildChangePayment({
      authority,
      provider: stripeComposition.adapter,
      release: customBuildChangePaymentComposition.release,
      clock: commerceV2.clock,
      ids: commerceV2.ids
    });
  const customBuildFinalPayment =
    createPostgresCustomServicesCustomBuildFinalPayment({
      authority,
      provider: stripeComposition.adapter,
      release: customBuildFinalPaymentComposition.release,
      clock: commerceV2.clock,
      ids: commerceV2.ids
    });
  const customBuildHandoff =
    createPostgresCustomServicesCustomBuildHandoff({
      authority,
      ids: commerceV2.ids
    });
  const customBuildPayment =
    createPostgresCustomServicesCustomBuildPayment({
      authority,
      provider: stripeComposition.adapter,
      release: customBuildPaymentComposition.release,
      clock: commerceV2.clock,
      ids: commerceV2.ids
    });
  const customServicesAccount =
    createHostedCustomServicesAccount({
      assessmentWork: customServicesAssessmentWork,
      customBuild: customServicesCustomBuild,
      customBuildChangeCompletion:
        customServicesCustomBuildChangeCompletion,
      customBuildChangePayment,
      customBuildFinalPayment,
      customBuildHandoff,
      customBuildPayment,
      customBuildProgress: customServicesCustomBuildProgress,
      invoiceRepository: customServicesInvoiceRepository,
      payment: customServicesAssessmentPayment,
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
  const alakazamLifecyclePolicy =
    createConfiguredAlakazamLifecyclePolicy();
  const alakazamLifecyclePorts = {
    repository:
      createPostgresAlakazamLifecycleRepository({
        authority,
        taxMode:
          alakazamComposition.release.taxMode ??
          "disabled_by_owner"
      }),
    provider: stripeComposition.adapter,
    clock: commerceV2.clock,
    ids: commerceV2.ids,
    release: alakazamComposition.release,
    policy: alakazamLifecyclePolicy.policy
  };
  const alakazamLifecycle = Object.freeze({
    renewal:
      createAlakazamRenewalService(
        alakazamLifecyclePorts
      ),
    incident:
      createAlakazamPaymentIncidentService(
        alakazamLifecyclePorts
      ),
    recovery:
      createAlakazamPaymentRecoveryService(
        alakazamLifecyclePorts
      ),
    cancellation:
      createAlakazamCancellationService(
        alakazamLifecyclePorts
      ),
    reversal:
      createAlakazamReversalService(
        alakazamLifecyclePorts
      )
  });
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
  const alakazam35Compiler = createAlakazam35Compiler({
    baseCompiler: compiler
  });
  const alakazamTierCompiler = createAlakazam35TierCompiler({
    baseCompiler: compiler,
    alakazam35Compiler
  });
  const alakazam50Compiler = createAlakazam50Compiler({
    baseCompiler: alakazamTierCompiler
  });
  const alakazam50TierCompiler = createAlakazam50TierCompiler({
    baseCompiler: alakazamTierCompiler,
    alakazam50Compiler
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
  const publicationPort = createAlakazam35PublicationPort({
    runtime: tenantRuntime,
    assetRepository: alakazam35Repository,
    clock: commerceV2.clock
  });
  alakazamFulfillmentWorker =
    createAlakazamFulfillmentWorker({
      repository: alakazam50FulfillmentRepository,
      compiler: alakazam50TierCompiler,
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
  const projectLegalAuthorityConfig =
    createProjectLegalAuthorityFromEnvironment();
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
    projectLegalAuthority: projectLegalAuthorityConfig.authority,
    projectLegalAuthorityDiagnostic: projectLegalAuthorityConfig.diagnostic,
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
  assertApprovedCustomServicesAssessmentPaymentReady(
    customServicesAssessmentPaymentComposition,
    readiness.payments,
    await customServicesAssessmentSettlement.readiness()
  );
  assertApprovedCustomBuildPaymentReady(
    customBuildPaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildPayment.readiness()
  );
  assertApprovedCustomBuildChangePaymentReady(
    customBuildChangePaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildChangePayment.readiness()
  );
  assertApprovedCustomBuildFinalPaymentReady(
    customBuildFinalPaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildFinalPayment.readiness()
  );
  await customServicesCustomBuildWork.readiness();
  await customServicesCustomBuildProgress.readiness();
  await customServicesCustomBuildChangeCompletion.readiness();
  await customBuildHandoff.readiness();
  await alakazamPublication.readiness();
  await alakazam35.readiness();
  await alakazam50.readiness();
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
        alakazam35,
        alakazam50,
        alakazamPublication,
        alakazamBilling,
        alakazamBillingSurfaces,
        customServicesAccount,
        customServicesAssessmentWork,
        customServicesCustomBuild,
        customServicesCustomBuildChangeCompletion,
        customServicesCustomBuildChangePayment:
          customBuildChangePayment,
        customServicesCustomBuildFinalPayment:
          customBuildFinalPayment,
        customServicesCustomBuildHandoff:
          customBuildHandoff,
        customServicesCustomBuildProgress,
        customServicesCustomBuildWork,
        customServicesOwner,
        stripeWebhook: createStripeWebhookRouter({
          provider: stripeComposition.adapter,
          canonicalService: service,
          downloadCommerce,
          assessmentCommerce:
            customServicesAssessmentSettlement,
          customBuildCommerce: customBuildPayment,
          alakazamCommerce,
          alakazamLifecycle,
          customBuildChangeCommerce:
            customBuildChangePayment,
          customBuildFinalCommerce:
            customBuildFinalPayment
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
