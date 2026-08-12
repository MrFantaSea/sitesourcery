#!/usr/bin/env node
import "../assert-runtime.mjs";

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readInstalledFinalReleaseEpochV2,
  releaseIdentityFromFinalEpochV2
} from "../../../ops/final-release-epoch-v2.mjs";
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
  createAlakazamInvoiceFinalizationService,
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
  createPostgresAlakazamInvoiceFinalizationRepository
} from "../alakazam-invoice-finalization-postgres.mjs";
import {
  createAlakazam35Composition
} from "../alakazam-35-composition.mjs";
import {
  createPostgresAlakazam35Repository
} from "../alakazam-35-postgres.mjs";
import {
  createAlakazam35PublicationPort
} from "../alakazam-35-publication-port.mjs";
import {
  createAlakazam50Composition
} from "../alakazam-50-composition.mjs";
import {
  createPostgresAlakazam50Repository
} from "../alakazam-50-postgres.mjs";
import {
  createAlakazamRetainedPremiumComposition
} from "../alakazam-retained-premium-composition.mjs";
import {
  createPostgresAlakazamRetainedPremiumRepository
} from "../alakazam-retained-premium-postgres.mjs";
import {
  createPostgresAlakazamPolicyAuthorityRepository
} from "../alakazam-policy-authority-postgres.mjs";
import {
  createAlakazamRetainedPremiumLifecycle
} from "../alakazam-retained-premium-lifecycle.mjs";
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
  assertProductionEngagementReady,
  createProductionEngagementBootstrap
} from "../engagement-production-composition.mjs";
import {
  createProfessionalLifecycleProductionComposition
} from "../professional-lifecycle-production-composition.mjs";
import {
  createPostgresSupportCaseRepository
} from "../support-cases-postgres.mjs";
import { createSupportCaseService } from "../support-cases.mjs";
import {
  createPostgresCareCoreRepository
} from "../care-core-postgres.mjs";
import {
  createPostgresCareSurfaceRepository
} from "../care-surfaces-postgres.mjs";
import {
  createCareMailReservationInterface,
  createCareSurfacesService
} from "../care-surfaces.mjs";
import {
  createFakeResponderProvider,
  createResponderCore
} from "../responder-core.mjs";
import {
  createPostgresResponderCoreRepository
} from "../responder-core-postgres.mjs";
import {
  createPostgresResponderSurfaceRepository
} from "../responder-surfaces-postgres.mjs";
import {
  createResponderSurfacesService
} from "../responder-surfaces.mjs";
import {
  createConfiguredTwilioResponderEventsHttp
} from "../twilio-responder-events-config.mjs";
import {
  createPostgresTwilioResponderEventsRepository
} from "../twilio-responder-events-postgres.mjs";
import {
  createConfiguredTwilioResponderInboundHttp
} from "../twilio-responder-inbound-config.mjs";
import {
  createResponderLookupDigests
} from "../responder-lookup-digests.mjs";
import {
  createPostgresResponderNumberBindingsRepository
} from "../responder-number-bindings-postgres.mjs";
import {
  createPublicationControlComposition
} from "../publication-control-composition.mjs";
import { createHostedApi } from "../http.mjs";
import { ingressPolicyFromEnvironment } from "../ingress-policy.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import {
  identityPepperConfigurationFromEnvironment
} from "../identity-pepper-config.mjs";
import { createPostgresIdentityBridge } from "../identity-postgres.mjs";
import {
  createDurableRecoveryMailPort,
  createDurableRegistrationMailPort
} from "../mail-delivery-bridge.mjs";
import { createMailLifecycle } from "../mail-lifecycle.mjs";
import {
  createPostgresMailLifecycleRepository
} from "../mail-lifecycle-postgres.mjs";
import {
  createConfiguredResendMailEventHttp
} from "../resend-mail-events-config.mjs";
import { createNodeHandler as createApiNodeHandler } from "../node-handler.mjs";
import {
  postgresBudgetConfigurationFromEnvironment
} from "../postgres-budget-config.mjs";
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

const postgresBudgetConfiguration =
  postgresBudgetConfigurationFromEnvironment(process.env);
const pool = createPostgresPool({
  max:
    postgresBudgetConfiguration.policy.pool.apiConnections,
  connectionTimeoutMillis:
    postgresBudgetConfiguration.policy.timeouts.acquisitionMs,
  statementTimeoutMillis:
    postgresBudgetConfiguration.policy.timeouts.statementMs,
  lockTimeoutMillis:
    postgresBudgetConfiguration.policy.timeouts.lockMs,
  idleInTransactionTimeoutMillis:
    postgresBudgetConfiguration.policy.timeouts.idleInTransactionMs,
  queryTimeoutMillis:
    postgresBudgetConfiguration.policy.timeouts.statementMs,
  ssl:
    process.env.SITESOURCERY_DATABASE_SSL === "require"
      ? { rejectUnauthorized: true }
      : undefined
});
const authority = createCanonicalPostgresAuthority({
  pool,
  budgetPolicy: postgresBudgetConfiguration.policy
});
let apiServer = null;
let tenantServer = null;
let shutdownPromise = null;

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
    shutdownPromise = (async () => {
      await Promise.all([
        closeServer(apiServer),
        closeServer(tenantServer)
      ]);
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
  const releaseIdentity =
    releaseIdentityFromFinalEpochV2(
      await readInstalledFinalReleaseEpochV2({
        epochPath: requiredEnvironment(
          "SITESOURCERY_RELEASE_EPOCH_FILE"
        ),
        expectedEpochFileSha256: requiredEnvironment(
          "SITESOURCERY_RELEASE_EPOCH_SHA256"
        ),
        originSealPath: requiredEnvironment(
          "SITESOURCERY_ORIGIN_SEAL_FILE"
        ),
        expectedOriginSealFileSha256: requiredEnvironment(
          "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256"
        ),
        installedReadbackPath: requiredEnvironment(
          "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE"
        ),
        expectedInstalledReadbackFileSha256: requiredEnvironment(
          "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"
        )
      })
    );
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
  const alakazam50Repository =
    createPostgresAlakazam50Repository({ authority });
  const alakazam50 = createAlakazam50Composition({
    repository: alakazam50Repository,
    resolveSession: commerceV2.resolveSession,
    clock: commerceV2.clock
  });
  const alakazamRetainedPremiumRepository =
    createPostgresAlakazamRetainedPremiumRepository({
      authority
    });
  const alakazamPolicyAuthorityRepository =
    createPostgresAlakazamPolicyAuthorityRepository({
      authority
    });
  const alakazamRetainedPremium =
    createAlakazamRetainedPremiumComposition({
      authority,
      resolveSession: commerceV2.resolveSession,
      clock: commerceV2.clock,
      repository: alakazamRetainedPremiumRepository
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
    createPublicationControlComposition({
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
  const alakazamRetainedPremiumLifecycle =
    createAlakazamRetainedPremiumLifecycle({
      repository: alakazamRetainedPremiumRepository,
      clock: commerceV2.clock,
      enabled: false
    });
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
    finalization:
      createAlakazamInvoiceFinalizationService({
        ...alakazamLifecyclePorts,
        repository:
          createPostgresAlakazamInvoiceFinalizationRepository({
            authority
          })
      }),
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
    cancellationRetainedExit: Object.freeze({
      applyAfterConfirmedCancellation(input) {
        return alakazamRetainedPremiumLifecycle
          .applyCancellationConfirmation(input);
      }
    }),
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
  const ingressPolicy = ingressPolicyFromEnvironment(process.env);

  const identityPepperConfiguration =
    identityPepperConfigurationFromEnvironment(
      process.env
    );
  const mailLifecycle = createMailLifecycle({
    repository: createPostgresMailLifecycleRepository({
      authority
    }),
    clock: commerceV2.clock
  });
  const resendMailEvents = createConfiguredResendMailEventHttp({
    environment: process.env,
    lifecycle: mailLifecycle,
    clock: commerceV2.clock
  });
  const resendMailEventReadiness = await resendMailEvents.readiness();
  if (
    resendMailEvents.mode === "raw-body" &&
    (
      resendMailEventReadiness.ready !== true ||
      resendMailEventReadiness.verified !== true
    )
  ) {
    throw new Error(
      "Verified Resend webhook ingress was requested but is not ready."
    );
  }
  const configuredRegistrationMailPort =
    await createConfiguredRegistrationMailPort();
  const registrationMailPort =
    configuredRegistrationMailPort.mode === "production"
      ? createDurableRegistrationMailPort({
          lifecycle: mailLifecycle,
          providerPort: configuredRegistrationMailPort,
          registrationBaseUrl:
            process.env.SITESOURCERY_REGISTRATION_BASE_URL,
          clock: commerceV2.clock
        })
      : configuredRegistrationMailPort;
  const identity = identityPepperConfiguration.compose(
    createPostgresIdentityBridge,
    {
      pool,
      authority,
      registrationMailPort,
      rateLimit: ingressPolicy.identity.subject,
      registrationRecoveryRateLimit: {
        perIp: ingressPolicy.identity.perIp,
        global: ingressPolicy.identity.global
      }
    }
  );
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
  const publicationPort = createAlakazam35PublicationPort({
    runtime: tenantRuntime,
    assetRepository: alakazam35Repository,
    clock: commerceV2.clock
  });
  const configuredRecoveryMailPort =
    await createConfiguredRecoveryMailPort();
  const recoveryMailPort =
    configuredRecoveryMailPort.mode === "production"
      ? createDurableRecoveryMailPort({
          lifecycle: mailLifecycle,
          providerPort: configuredRecoveryMailPort,
          recoveryBaseUrl:
            process.env.SITESOURCERY_RECOVERY_BASE_URL,
          clock: commerceV2.clock
        })
      : configuredRecoveryMailPort;
  const projectLegalAuthorityConfig =
    createProjectLegalAuthorityFromEnvironment();
  const engagementBootstrap =
    createProductionEngagementBootstrap({
      authority,
      legalAuthority: projectLegalAuthorityConfig.authority,
      identityPepperConfiguration,
      tokenSecret: projectLegalAuthorityConfig.authority
        ? secret("SITESOURCERY_ENGAGEMENT_TOKEN_SECRET")
        : null
    });
  await assertProductionEngagementReady({
    legalAuthority: projectLegalAuthorityConfig.authority,
    engagementBootstrap
  });
  const professionalLifecycle =
    createProfessionalLifecycleProductionComposition({
      authority,
      provider: stripeComposition.adapter,
      engagementBootstrap,
      mailLifecycle,
      clock: commerceV2.clock,
      ids: commerceV2.ids
    });
  const professionalLifecycleReadiness =
    await professionalLifecycle.readiness();
  const supportCases = createSupportCaseService({
    repository: createPostgresSupportCaseRepository({ authority }),
    mailLifecycle,
    clock: commerceV2.clock
  });
  const supportCaseReadiness = await supportCases.readiness();
  if (supportCaseReadiness.ready !== true) {
    throw new Error(
      "Canonical auditable support and privacy case storage is not ready."
    );
  }
  const careCoreRepository = createPostgresCareCoreRepository({ authority });
  const careSurfaces = createCareSurfacesService({
    repository: createPostgresCareSurfaceRepository({
      authority,
      coreRepository: careCoreRepository
    }),
    mailReservations: createCareMailReservationInterface({
      lifecycle: mailLifecycle,
      clock: commerceV2.clock
    }),
    clock: commerceV2.clock
  });
  const careReadiness = await careSurfaces.readiness();
  if (
    careReadiness.ready !== true ||
    careReadiness.verified !== true ||
    careReadiness.customerEffects !== false ||
    careReadiness.mailReservation?.deliveryEffects !== false ||
    careReadiness.paymentEffects !== false ||
    careReadiness.providerEffects !== false
  ) {
    throw new Error(
      "Canonical effect-held Care surfaces are not ready."
    );
  }
  const responderCore = createResponderCore({
    repository: createPostgresResponderCoreRepository({ authority }),
    provider: createFakeResponderProvider(),
    clock: commerceV2.clock
  });
  const responderSurfaces = createResponderSurfacesService({
    core: responderCore,
    repository: createPostgresResponderSurfaceRepository({ authority })
  });
  const twilioResponderEvents =
    createConfiguredTwilioResponderEventsHttp({
      environment: process.env,
      repository: createPostgresTwilioResponderEventsRepository({
        authority
      }),
      clock: commerceV2.clock
    });
  const [responderCoreReadiness, responderReadiness] = await Promise.all([
    responderCore.readiness(),
    responderSurfaces.readiness()
  ]);
  if (
    responderCoreReadiness.ready !== true ||
    responderCoreReadiness.verified !== true ||
    responderCoreReadiness.globalKillEngagedByDefault !== true ||
    responderReadiness.ready !== true ||
    responderReadiness.verified !== true ||
    responderReadiness.providerEffects !== false ||
    responderReadiness.billingEffects !== false ||
    responderReadiness.sellable !== false
  ) {
    throw new Error(
      "Canonical effect-held Responder surfaces are not ready."
    );
  }
  const twilioResponderEventReadiness =
    await twilioResponderEvents.readiness();
  if (
    twilioResponderEvents.mode === "raw-form" &&
    (
      twilioResponderEventReadiness.ready !== true ||
      twilioResponderEventReadiness.verified !== true ||
      twilioResponderEventReadiness.providerEffects !== false
    )
  ) {
    throw new Error(
      "Verified Twilio Responder callback ingress was requested but is not ready."
    );
  }
  const twilioResponderInbound =
    createConfiguredTwilioResponderInboundHttp({
      environment: process.env,
      authority,
      clock: commerceV2.clock
    });
  const twilioResponderInboundReadiness =
    await twilioResponderInbound.readiness();
  if (
    twilioResponderInbound.mode === "raw-form" &&
    (
      twilioResponderInboundReadiness.ready !== true ||
      twilioResponderInboundReadiness.verified !== true ||
      twilioResponderInboundReadiness.providerEffects !== false
    )
  ) {
    throw new Error(
      "Verified Twilio Responder inbound ingress was requested but is not ready."
    );
  }
  const responderLookupDigests = identityPepperConfiguration.compose(
    createResponderLookupDigests
  );
  const responderNumberBindings = {
    repository: createPostgresResponderNumberBindingsRepository({
      authority,
      verifierKeyVersions: [...responderLookupDigests.verifierVersions]
    }),
    lookupDigests: responderLookupDigests,
    clock: commerceV2.clock
  };
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
    licensedBaseDomain,
    resourceLimits: ingressPolicy.writes
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
    await customServicesAssessmentSettlement.readiness(),
    professionalLifecycleReadiness
  );
  assertApprovedCustomBuildPaymentReady(
    customBuildPaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildPayment.readiness(),
    professionalLifecycleReadiness
  );
  assertApprovedCustomBuildChangePaymentReady(
    customBuildChangePaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildChangePayment.readiness(),
    professionalLifecycleReadiness
  );
  assertApprovedCustomBuildFinalPaymentReady(
    customBuildFinalPaymentComposition,
    readiness.payments,
    await customServicesCustomBuild.readiness(),
    await customBuildFinalPayment.readiness(),
    professionalLifecycleReadiness
  );
  await customServicesCustomBuildWork.readiness();
  await customServicesCustomBuildProgress.readiness();
  await customServicesCustomBuildChangeCompletion.readiness();
  await customBuildHandoff.readiness();
  await alakazamPublication.readiness();
  await alakazam35.readiness();
  await alakazam50.readiness();
  await alakazamRetainedPremium.readiness();
  const alakazamPolicyReadiness =
    await alakazamPolicyAuthorityRepository.readiness();
  if (alakazamPolicyReadiness.ready !== true) {
    throw new Error(
      "Canonical held Alakazam policy authority is not ready."
    );
  }
  assertApprovedAlakazamReady(
    alakazamComposition,
    readiness.payments,
    alakazamPolicyReadiness
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
  apiServer = createServer(
    createApiNodeHandler(
      createHostedApi(service, {
        downloadCommerce,
        alakazamAccount,
        alakazam35,
        alakazam50,
        alakazamRetainedPremium,
        alakazamPublication,
        alakazamBilling,
        alakazamBillingSurfaces,
        customServicesAccount,
        engagementBootstrap,
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
        careSurfaces,
        responderSurfaces,
        operatorWorkQueue: professionalLifecycle.operatorQueue,
        supportCases,
        resendMailEvents,
        twilioResponderEvents,
        twilioResponderInbound,
        responderNumberBindings,
        stripeWebhook: createStripeWebhookRouter({
          provider: stripeComposition.adapter,
          canonicalService: service,
          downloadCommerce,
          assessmentCommerce:
            customServicesAssessmentSettlement,
          customBuildCommerce: customBuildPayment,
          professionalReversal:
            professionalLifecycle.professionalReversal,
          alakazamCommerce,
          alakazamLifecycle,
          customBuildChangeCommerce:
            customBuildChangePayment,
          customBuildFinalCommerce:
            customBuildFinalPayment
        }),
        releaseIdentity,
        ingressPolicy
      }),
      ingressPolicy
    )
  );
  tenantServer = createServer(
    createTenantNodeHandler(tenantRuntime)
  );
  apiServer.requestTimeout =
    ingressPolicy.node.requestDeadlineMs;
  tenantServer.requestTimeout = 15_000;
  for (const server of [apiServer, tenantServer]) {
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
  }

  await listen(apiServer, apiPort);
  await listen(tenantServer, tenantPort);

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
      mailProviderEvents: {
        mode: resendMailEvents.mode,
        ready: resendMailEventReadiness.ready === true,
        code: resendMailEventReadiness.code ?? null
      },
      responderProviderEvents: {
        mode: twilioResponderEvents.mode,
        ready: twilioResponderEventReadiness.ready === true,
        code: twilioResponderEventReadiness.code ?? null
      },
      responderInboundEvents: {
        mode: twilioResponderInbound.mode,
        ready: twilioResponderInboundReadiness.ready === true,
        code: twilioResponderInboundReadiness.code ?? null,
        voiceDialPlan:
          twilioResponderInboundReadiness.voiceDialPlan ??
            "blocked-fin-004t"
      },
      database: readiness.persistence.database,
      postgresBudget: authority.budgetReadiness(),
      identityPepper:
        identityPepperConfiguration.readiness,
      compilerRevision: readiness.compiler.revision,
      catalogVersion: readiness.catalog.catalogVersion,
      payments: paymentReadiness,
      alakazamMode: alakazamComposition.mode,
      backgroundWorkers: "external_process_required"
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
