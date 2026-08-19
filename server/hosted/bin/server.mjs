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
  createPublicationCommandServer,
  publicationCommandConfigurationFromEnvironment
} from "../publication-command-transport.mjs";
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
import {
  createPostgresHeldDomainRuntime
} from "../domain-postgres-runtime.mjs";
import {
  assertProductionEngagementReady,
  createProductionEngagementBootstrap
} from "../engagement-production-composition.mjs";
import {
  createProfessionalLifecycleProductionComposition,
  isExactProfessionalLifecycleReadiness
} from "../professional-lifecycle-production-composition.mjs";
import {
  createPostgresProviderReconciliationOperator
} from "../provider-reconciliation-operator-postgres.mjs";
import {
  ADJACENT_INTEGRATION_SYSTEM_KEYS,
  createAdjacentIntegrationService
} from "../adjacent-integration.mjs";
import {
  createPostgresAdjacentIntegrationRepository
} from "../adjacent-integration-postgres.mjs";
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
  createCareCommerceMailReservationInterface,
  createHeldCareCommerceService
} from "../care-commerce.mjs";
import {
  createPostgresCareCommerceEligibility,
  createPostgresCareCommerceRepository
} from "../care-commerce-postgres.mjs";
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
  createHeldResponderCommerceService
} from "../responder-commerce.mjs";
import {
  createPostgresResponderCommerceRepository
} from "../responder-commerce-postgres.mjs";
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
  createPostgresResponderForwardingRepository
} from "../responder-forwarding-postgres.mjs";
import {
  createPostgresResponderNativeClientRepository
} from "../responder-native-client-postgres.mjs";
import {
  createResponderNativeTokenAuthority
} from "../responder-native-token-authority.mjs";
import {
  createTwilioResponderVoiceAccess
} from "../twilio-responder-voice-access.mjs";
import {
  createPublicationControlComposition
} from "../publication-control-composition.mjs";
import { createHostedApi } from "../http.mjs";
import {
  createCapabilityProcessMatrix
} from "../capability-process-matrix.mjs";
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
  createMailPurposeNotifications
} from "../mail-purpose-notifications.mjs";
import {
  createPostgresMailPurposeNotificationRepository
} from "../mail-purpose-notifications-postgres.mjs";
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
    "The hosted API must bind to loopback behind the reviewed reverse proxy."
  );
}
if (apiPort !== 8788) {
  throw new Error(
    "SITESOURCERY_HOSTED_PORT must remain the reviewed 127.0.0.1:8788 boundary."
  );
}
for (const [name, value] of [
  ["SITESOURCERY_HOSTED_PORT", apiPort]
]) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1024 ||
    value > 65535
  ) {
    throw new Error(`${name} must be an unprivileged TCP port.`);
  }
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
let publicationCommandServer = null;
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
      await closeServer(apiServer);
      if (publicationCommandServer) {
        await publicationCommandServer.stop();
      }
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
  const mailLifecycleReadiness = await mailLifecycle.readiness();
  if (
    mailLifecycleReadiness.ready !== true ||
    mailLifecycleReadiness.verified !== true ||
    mailLifecycleReadiness.kind !==
      "durable-mail-lifecycle-postgres" ||
    mailLifecycleReadiness.providerEffects !== false
  ) {
    throw new Error(
      "Canonical durable mail lifecycle is not ready."
    );
  }
  const mailPurposeNotifications = createMailPurposeNotifications({
    repository: createPostgresMailPurposeNotificationRepository({ authority }),
    clock: commerceV2.clock
  });
  const mailPurposeReadiness = await mailPurposeNotifications.readiness();
  if (
    mailPurposeReadiness.ready !== true ||
    mailPurposeReadiness.verified !== true ||
    mailPurposeReadiness.fiveFamilyReservationReady !== true ||
    mailPurposeReadiness.purposeCount !== 5 ||
    mailPurposeReadiness.sourceCount !== 14 ||
    mailPurposeReadiness.providerEffects !== false ||
    mailPurposeReadiness.deliveryClaimed !== false
  ) {
    throw new Error(
      "Canonical five-family held mail-purpose authority is not ready."
    );
  }
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
  const domainRuntime = createPostgresHeldDomainRuntime({
    authority,
    contactVault,
    clock: commerceV2.clock
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
  publicationCommandServer = createPublicationCommandServer({
    publicationPort,
    configuration:
      publicationCommandConfigurationFromEnvironment(process.env),
    log(entry) {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
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
  if (!isExactProfessionalLifecycleReadiness(
    professionalLifecycleReadiness
  )) {
    throw new Error(
      "Canonical held professional lifecycle is not ready."
    );
  }
  const operatorProviderReconciliation =
    createPostgresProviderReconciliationOperator({
      authority,
      clock: commerceV2.clock,
      randomUUID: () => commerceV2.ids.next("operator_reconciliation")
    });
  const operatorProviderReconciliationReadiness =
    await operatorProviderReconciliation.readiness();
  if (
    operatorProviderReconciliationReadiness.ready !== true ||
    operatorProviderReconciliationReadiness.providerEffects !== false ||
    operatorProviderReconciliationReadiness.genericRepair !== false
  ) {
    throw new Error(
      "Canonical held operator reconciliation surfaces are not ready."
    );
  }
  const adjacentIntegration = createAdjacentIntegrationService({
    repository: createPostgresAdjacentIntegrationRepository({ authority }),
    clock: commerceV2.clock,
    ids: {
      next: () => commerceV2.ids.next("adjacent_integration")
    }
  });
  const adjacentIntegrationReadiness = await adjacentIntegration.readiness();
  if (
    adjacentIntegrationReadiness.ready !== true ||
    adjacentIntegrationReadiness.verified !== true ||
    JSON.stringify(adjacentIntegrationReadiness.systems) !==
      JSON.stringify(ADJACENT_INTEGRATION_SYSTEM_KEYS) ||
    adjacentIntegrationReadiness.mode !== "manual-read-only" ||
    adjacentIntegrationReadiness.remoteWrites !== false ||
    adjacentIntegrationReadiness.providerEffects !== false ||
    adjacentIntegrationReadiness.automaticCommands !== false
  ) {
    throw new Error(
      "Canonical six-system adjacent integration is not ready."
    );
  }
  const supportCases = createSupportCaseService({
    repository: createPostgresSupportCaseRepository({ authority }),
    mailLifecycle,
    clock: commerceV2.clock
  });
  const supportCaseReadiness = await supportCases.readiness();
  if (
    supportCaseReadiness.ready !== true ||
    supportCaseReadiness.verified !== true ||
    supportCaseReadiness.providerEffects !== false ||
    supportCaseReadiness.deletionExecution !== false ||
    supportCaseReadiness.exportExecution !== false
  ) {
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
      notifications: mailPurposeNotifications,
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
  const careCommerce = createHeldCareCommerceService({
    eligibility: createPostgresCareCommerceEligibility({ authority }),
    repository: createPostgresCareCommerceRepository({ authority }),
    ids: commerceV2.ids,
    clock: commerceV2.clock,
    mailReservations: createCareCommerceMailReservationInterface({
      notifications: mailPurposeNotifications,
      clock: commerceV2.clock
    })
  });
  const careCommerceReadiness = await careCommerce.readiness();
  if (
    careCommerceReadiness.ready !== true ||
    careCommerceReadiness.verified !== true ||
    careCommerceReadiness.durableCommercialState !== true ||
    careCommerceReadiness.mailReservationReady !== true ||
    careCommerceReadiness.commercialReady !== false ||
    careCommerceReadiness.taxPurposeReleased !== false ||
    careCommerceReadiness.commercialEffects !== false ||
    careCommerceReadiness.customerEffects !== false ||
    careCommerceReadiness.mailDeliveryEffects !== false ||
    careCommerceReadiness.paymentEffects !== false ||
    careCommerceReadiness.providerEffects !== false
  ) {
    throw new Error(
      "Canonical durable effect-held Care commerce is not ready."
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
  const responderCommerce = createHeldResponderCommerceService({
    repository: createPostgresResponderCommerceRepository({ authority }),
    ids: commerceV2.ids,
    clock: commerceV2.clock
  });
  const twilioResponderEvents =
    createConfiguredTwilioResponderEventsHttp({
      environment: process.env,
      repository: createPostgresTwilioResponderEventsRepository({
        authority
      }),
      clock: commerceV2.clock
    });
  const [
    responderCoreReadiness,
    responderReadiness,
    responderCommerceReadiness
  ] = await Promise.all([
    responderCore.readiness(),
    responderSurfaces.readiness(),
    responderCommerce.readiness()
  ]);
  if (
    responderCoreReadiness.ready !== true ||
    responderCoreReadiness.verified !== true ||
    responderCoreReadiness.globalKillEngagedByDefault !== true ||
    responderReadiness.ready !== true ||
    responderReadiness.verified !== true ||
    responderReadiness.providerEffects !== false ||
    responderReadiness.billingEffects !== false ||
    responderReadiness.sellable !== false ||
    responderCommerceReadiness.ready !== true ||
    responderCommerceReadiness.verified !== true ||
    responderCommerceReadiness.durableCommercialState !== true ||
    responderCommerceReadiness.catalogAuthorityVerified !== true ||
    responderCommerceReadiness.taxPurposeReleased !== false ||
    responderCommerceReadiness.sellable !== false ||
    responderCommerceReadiness.commercialEffects !== false ||
    responderCommerceReadiness.customerEffects !== false ||
    responderCommerceReadiness.mailDeliveryEffects !== false ||
    responderCommerceReadiness.paymentEffects !== false ||
    responderCommerceReadiness.providerEffects !== false
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
  const responderLookupDigests = identityPepperConfiguration.compose(
    createResponderLookupDigests
  );
  const responderForwarding = {
    repository: createPostgresResponderForwardingRepository({
      authority,
      verifierKeyVersions: [...responderLookupDigests.verifierVersions]
    }),
    lookupDigests: responderLookupDigests,
    clock: commerceV2.clock
  };
  const responderForwardingReadiness =
    await responderForwarding.repository.readiness();
  if (
    responderForwardingReadiness.ready !== true ||
    responderForwardingReadiness.verified !== true ||
    responderForwardingReadiness.retainedCarrier !== true ||
    responderForwardingReadiness.launchMode !==
      "conditional_no_answer_forwarding" ||
    responderForwardingReadiness.automaticCarrierCommands !== false ||
    responderForwardingReadiness.remoteWriteEffects !== false ||
    responderForwardingReadiness.providerEffects !== false ||
    responderForwardingReadiness.messageSendEffects !== false
  ) {
    throw new Error(
      "Canonical carrier-preserving Responder forwarding is not ready."
    );
  }
  const responderNativeTokenAuthority =
    identityPepperConfiguration.compose(createResponderNativeTokenAuthority);
  const responderNativeVoiceAccess = identityPepperConfiguration.compose(
    createTwilioResponderVoiceAccess,
    { environment: process.env }
  );
  const responderNativeClient = {
    repository: createPostgresResponderNativeClientRepository({
      authority,
      verifierKeyVersions: [
        ...responderNativeTokenAuthority.verifierVersions
      ],
      voiceAccess: responderNativeVoiceAccess
    }),
    tokenAuthority: responderNativeTokenAuthority,
    voiceAccess: responderNativeVoiceAccess,
    clock: commerceV2.clock
  };
  const [
    responderNativeClientReadiness,
    responderNativeTokenReadiness,
    responderNativeVoiceReadiness
  ] = await Promise.all([
    responderNativeClient.repository.readiness(),
    responderNativeTokenAuthority.readiness(),
    responderNativeVoiceAccess.readiness()
  ]);
  if (
    responderNativeClientReadiness.ready !== true ||
    responderNativeClientReadiness.verified !== true ||
    responderNativeClientReadiness.providerEffects !== false ||
    responderNativeClientReadiness.pushDeliveryEffects !== false ||
    responderNativeClientReadiness.voiceCallEffects !== false ||
    responderNativeClientReadiness.carrierCommandEffects !== false ||
    responderNativeClientReadiness.messageSendEffects !== false ||
    responderNativeTokenReadiness.ready !== true ||
    responderNativeTokenReadiness.verified !== true ||
    responderNativeTokenReadiness.providerEffects !== false ||
    responderNativeTokenReadiness.pushDeliveryEffects !== false ||
    responderNativeVoiceReadiness.ready !== true ||
    responderNativeVoiceReadiness.verified !== true ||
    responderNativeVoiceReadiness.mode !== responderNativeVoiceAccess.mode ||
    responderNativeVoiceReadiness.providerEffects !== false ||
    responderNativeVoiceReadiness.pushDeliveryEffects !== false ||
    responderNativeVoiceReadiness.voiceCallEffects !== false ||
    !Array.isArray(responderNativeVoiceReadiness.transports) ||
    !responderNativeVoiceReadiness.transports.includes("twilio_voice_ios") ||
    !responderNativeVoiceReadiness.transports.includes(
      "twilio_voice_android"
    ) ||
    responderNativeVoiceReadiness.providerAuthorizationEffects !==
      (responderNativeVoiceAccess.mode === "verified") ||
    responderNativeVoiceReadiness.routingReady !== false ||
    responderNativeVoiceReadiness.operationalCalls !== false
  ) {
    throw new Error(
      "Canonical held Responder native-client authority is not ready."
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
      twilioResponderInboundReadiness.ingressProviderEffects !== false ||
      typeof twilioResponderInboundReadiness.providerEffects !== "boolean"
    )
  ) {
    throw new Error(
      "Verified Twilio Responder inbound ingress was requested but is not ready."
    );
  }
  const responderNumberBindings = {
    repository: createPostgresResponderNumberBindingsRepository({
      authority,
      verifierKeyVersions: [...responderLookupDigests.verifierVersions]
    }),
    lookupDigests: responderLookupDigests,
    clock: commerceV2.clock
  };
  const responderNumberBindingReadiness =
    await responderNumberBindings.repository.readiness();
  if (
    responderNumberBindingReadiness.ready !== true ||
    responderNumberBindingReadiness.verified !== true ||
    responderNumberBindingReadiness.kind !==
      "responder-number-bindings-postgres" ||
    responderNumberBindingReadiness.providerEffects !== false
  ) {
    throw new Error(
      "Canonical held Responder number-binding authority is not ready."
    );
  }
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
  const domainRuntimeReadiness = readiness?.providers?.domains;
  if (
    domainRuntimeReadiness?.ready !== true ||
    domainRuntimeReadiness?.verified !== true ||
    domainRuntimeReadiness?.mounted !== true ||
    domainRuntimeReadiness?.mode !== "held" ||
    domainRuntimeReadiness?.purchaseReady !== false ||
    domainRuntimeReadiness?.registrar !== "held" ||
    domainRuntimeReadiness?.payments !== "held" ||
    domainRuntimeReadiness?.dns !== "held" ||
    domainRuntimeReadiness?.providerEffects !== false ||
    domainRuntimeReadiness?.remoteWrites !== false ||
    domainRuntimeReadiness?.automaticCommands !== false
  ) {
    throw new Error(
      "Canonical PostgreSQL-backed held Domain runtime is not ready."
    );
  }
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
  const [
    customBuildWorkReadiness,
    customBuildProgressReadiness,
    customBuildChangeCompletionReadiness,
    customBuildHandoffReadiness,
    alakazamPublicationReadiness,
    alakazam35Readiness,
    alakazam50Readiness,
    alakazamRetainedPremiumReadiness
  ] = await Promise.all([
    customServicesCustomBuildWork.readiness(),
    customServicesCustomBuildProgress.readiness(),
    customServicesCustomBuildChangeCompletion.readiness(),
    customBuildHandoff.readiness(),
    alakazamPublication.readiness(),
    alakazam35.readiness(),
    alakazam50.readiness(),
    alakazamRetainedPremium.readiness()
  ]);
  if (
    [
      customBuildWorkReadiness,
      customBuildProgressReadiness,
      customBuildChangeCompletionReadiness,
      customBuildHandoffReadiness
    ].some((entry) =>
      entry?.ready !== true || entry?.state !== "ready"
    ) ||
    [
      alakazamPublicationReadiness,
      alakazam35Readiness,
      alakazam50Readiness,
      alakazamRetainedPremiumReadiness
    ].some((entry) =>
      entry?.ready !== true ||
      entry?.authorization !== true ||
      entry?.providerEffects !== false ||
      entry?.state !== "held"
    )
  ) {
    throw new Error(
      "Canonical held Custom and Alakazam runtime boundaries are not ready."
    );
  }
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
  const heldRow = (ready, code = "local_dependency_not_ready") =>
    Object.freeze({
      engineeringState: ready ? "ready" : "not_ready",
      effectState: "held",
      code: ready ? "verified_all_held" : code
    });
  const candidateRow = (effectState = "held") => Object.freeze({
    engineeringState: "candidate",
    effectState,
    code: "candidate_not_installed"
  });
  const responderLocalReady =
    responderCoreReadiness.ready === true &&
    responderReadiness.ready === true &&
    responderCommerceReadiness.ready === true &&
    responderForwardingReadiness.ready === true &&
    responderNativeClientReadiness.ready === true &&
    responderNativeTokenReadiness.ready === true &&
    responderNativeVoiceReadiness.ready === true &&
    responderNumberBindingReadiness.ready === true;
  const customLocalReady = [
    customBuildWorkReadiness,
    customBuildProgressReadiness,
    customBuildChangeCompletionReadiness,
    customBuildHandoffReadiness
  ].every((entry) => entry?.ready === true);
  const alakazamLocalReady = [
    alakazamPublicationReadiness,
    alakazam35Readiness,
    alakazam50Readiness,
    alakazamRetainedPremiumReadiness
  ].every((entry) => entry?.ready === true);
  const adjacentLocalReady =
    adjacentIntegrationReadiness.ready === true &&
    adjacentIntegrationReadiness.verified === true &&
    adjacentIntegrationReadiness.systems?.length === 6;
  const transactionalMailLocalReady =
    mailLifecycleReadiness.ready === true &&
    mailLifecycleReadiness.verified === true &&
    mailPurposeReadiness.ready === true &&
    mailPurposeReadiness.verified === true &&
    mailPurposeReadiness.fiveFamilyReservationReady === true &&
    supportCaseReadiness.ready === true &&
    careReadiness.mailReservation?.deliveryEffects === false &&
    careCommerceReadiness.mailReservationReady === true;
  const capabilityProcessMatrix = createCapabilityProcessMatrix({
    processes: {
      public_static: candidateRow("static"),
      hosted_api: candidateRow(),
      tenant_runtime: candidateRow(),
      postgresql: candidateRow("internal"),
      worker: candidateRow(),
      monitoring_deadman: candidateRow()
    },
    async loadRows() {
      const publicationStorageReadiness = await publicationPort.readiness();
      const publicationCommandState = publicationCommandServer.snapshot();
      const publicationLocalReady =
        publicationStorageReadiness?.ready === true &&
        publicationCommandState.state === "listening" &&
        alakazamPublicationReadiness.ready === true;
      return {
        public_successor: candidateRow("static"),
        hosted_browser: candidateRow("static"),
        accounts_recovery: heldRow(
          readiness.registration?.ready === true &&
          readiness.registration?.verified === true &&
          readiness.recovery?.ready === true &&
          readiness.recovery?.verified === true &&
          mailLifecycleReadiness.ready === true
        ),
        organizations_tenancy: heldRow(readiness.ready === true),
        projects_downloads: heldRow(
          readiness.ready === true && publicationLocalReady
        ),
        publication: heldRow(publicationLocalReady),
        assessment_custom: heldRow(
          professionalLifecycleReadiness.ready === true && customLocalReady
        ),
        alakazam: heldRow(alakazamLocalReady),
        domains: heldRow(domainRuntimeReadiness.ready === true),
        care: heldRow(
          careReadiness.ready === true && careCommerceReadiness.ready === true
        ),
        responder: heldRow(responderLocalReady),
        operator_support: heldRow(
          supportCaseReadiness.ready === true &&
          operatorProviderReconciliationReadiness.ready === true
        ),
        transactional_mail: heldRow(transactionalMailLocalReady),
        provider_reconciliation: heldRow(
          operatorProviderReconciliationReadiness.ready === true
        ),
        backup_restore: candidateRow(),
        monitoring_deadman: candidateRow(),
        client_profile_hub: heldRow(adjacentLocalReady),
        dell_commercial_engine: heldRow(adjacentLocalReady),
        marketing_desk: heldRow(adjacentLocalReady),
        messenger_command_phone: heldRow(adjacentLocalReady)
      };
    }
  });
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
        careCommerce,
        responderSurfaces,
        responderCommerce,
        responderForwarding,
        responderNativeClient,
        operatorWorkQueue: professionalLifecycle.operatorQueue,
        operatorProviderReconciliation,
        adjacentIntegration,
        mailPurposeNotifications,
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
        ingressPolicy,
        capabilityProcessMatrix,
        strictCapabilityProcessMatrix: true
      }),
      ingressPolicy
    )
  );
  apiServer.requestTimeout =
    ingressPolicy.node.requestDeadlineMs;
  for (const server of [apiServer]) {
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 100;
  }

  await publicationCommandServer.start();
  await capabilityProcessMatrix.assertStartup(
    await capabilityProcessMatrix.snapshot()
  );
  await listen(apiServer, apiPort);

  process.stdout.write(
    `${JSON.stringify({
      event: "sitesourcery.hosted.started",
      host,
      apiPort,
      tenantProcess: "external_process_required",
      publicationCommand:
        publicationCommandServer.snapshot(),
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
            "held"
      },
      responderForwarding: {
        ready: responderForwardingReadiness.ready === true,
        mode: responderForwardingReadiness.mode,
        retainedCarrier: true,
        launchMode: responderForwardingReadiness.launchMode,
        initialAdapter: responderForwardingReadiness.initialAdapter,
        providerEffects: false
      },
      responderNativeClient: {
        ready: false,
        backendReady:
          responderNativeClientReadiness.ready === true &&
          responderNativeTokenReadiness.ready === true &&
          responderNativeVoiceReadiness.ready === true,
        clientsReady: false,
        mode: responderNativeClientReadiness.mode,
        acceptedRegistrationPlatforms: ["ios", "android"],
        initialClient: "ios",
        clientArtifacts: {
          ios: false,
          android: false
        },
        tokenStorage: "sealed",
        voipSessionState: responderNativeVoiceReadiness.mode,
        providerAuthorizationEffects:
          responderNativeVoiceReadiness.providerAuthorizationEffects,
        providerEffects: false,
        pushDeliveryEffects: false,
        voiceCallEffects: false
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
