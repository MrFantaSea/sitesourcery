import {
  createProfessionalServicesReversalService
} from "../commerce-v2/professional-services-reversal.mjs";
import {
  createAccountingPurposeJournal
} from "./accounting-purpose-journal.mjs";
import {
  createPostgresAccountingPurposeJournalRepository
} from "./accounting-purpose-journal-postgres.mjs";
import {
  createCommerceTransitionNotifications
} from "./commerce-transition-notifications.mjs";
import {
  createPostgresCommerceTransitionNotificationRepository
} from "./commerce-transition-notifications-postgres.mjs";
import { invariant } from "./errors.mjs";
import {
  createOperatorWorkQueue
} from "./operator-work-queue.mjs";
import {
  createPostgresOperatorWorkQueueRepository
} from "./operator-work-queue-postgres.mjs";
import {
  createPostgresProfessionalServicesReversalRepository
} from "./professional-services-reversal-postgres.mjs";

export const PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA =
  "sitesourcery.professional-lifecycle-production-readiness/v1";

const READINESS_KEYS = Object.freeze([
  "accounting",
  "authoritativeAccounting",
  "automaticRestoration",
  "code",
  "engagement",
  "genericRepair",
  "mail",
  "mode",
  "notifications",
  "operatorQueue",
  "professionalReversal",
  "providerEffects",
  "ready",
  "schema",
  "sourceAuthoritative"
]);

function exactObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isExactProfessionalLifecycleReadiness(value) {
  return exactObject(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...READINESS_KEYS].sort()) &&
    value.schema === PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA &&
    value.ready === true && value.mode === "held" &&
    value.engagement === "ready" &&
    value.professionalReversal ===
      "ready_monotonic_direct_held" &&
    value.notifications === "mail_reserved_held" &&
    value.mail === "reservation_ready" &&
    value.operatorQueue === "bounded_reversal_repair_only" &&
    value.accounting === "projection_only" &&
    value.sourceAuthoritative === true &&
    value.providerEffects === false &&
    value.automaticRestoration === false &&
    value.genericRepair === false &&
    value.authoritativeAccounting === false &&
    value.code === "READY";
}

function fixedReadiness({
  engagement,
  reversal,
  notifications,
  mail,
  operatorQueue,
  accounting
}) {
  const engagementReady =
    engagement?.state === "ready" &&
    engagement.providerEffects === false;
  const reversalReady =
    reversal?.ready === true && reversal.verified === true &&
    reversal.kind === "professional-services-reversal-postgres" &&
    reversal.sourceAuthoritative === true &&
    reversal.monotonic === true &&
    reversal.directNormalization === "held" &&
    reversal.providerEffects === false &&
    reversal.automaticRestoration === false;
  const notificationsReady =
    notifications?.ready === true &&
    notifications.verified === true &&
    notifications.kind ===
      "commerce-transition-notifications-postgres" &&
    notifications.sourceAuthoritative === true &&
    notifications.mailReserved === true &&
    notifications.providerEffects === false &&
    notifications.deliveryClaimed === false;
  const mailReady =
    mail?.ready === true && mail.verified === true &&
    mail.kind === "durable-mail-lifecycle-postgres" &&
    mail.providerEffects === false;
  const operatorQueueReady =
    operatorQueue?.ready === true &&
    operatorQueue.verified === true &&
    operatorQueue.kind === "operator-work-queue-postgres" &&
    operatorQueue.sourceAuthoritative === true &&
    operatorQueue.providerEffects === false &&
    operatorQueue.alertEffects === false &&
    operatorQueue.genericRepair === false;
  const accountingReady =
    accounting?.ready === true && accounting.verified === true &&
    accounting.kind === "accounting-purpose-journal-postgres" &&
    accounting.sourceAuthoritative === false &&
    accounting.authoritativeAccounting === false &&
    accounting.commercialEffects === false &&
    accounting.providerEffects === false;
  const ready = engagementReady && reversalReady &&
    notificationsReady && mailReady && operatorQueueReady &&
    accountingReady;
  const code = !engagementReady
    ? "ENGAGEMENT_NOT_READY"
    : !reversalReady
      ? "PROFESSIONAL_REVERSAL_NOT_READY"
      : !notificationsReady
        ? "COMMERCE_NOTIFICATIONS_NOT_READY"
        : !mailReady
          ? "MAIL_RESERVATION_NOT_READY"
          : !operatorQueueReady
            ? "OPERATOR_QUEUE_NOT_READY"
            : !accountingReady
              ? "ACCOUNTING_PROJECTION_NOT_READY"
              : "READY";
  return Object.freeze({
    schema: PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA,
    ready,
    mode: "held",
    engagement: engagementReady ? "ready" : "held",
    professionalReversal:
      reversalReady
        ? "ready_monotonic_direct_held"
        : "not_ready",
    notifications:
      notificationsReady ? "mail_reserved_held" : "not_ready",
    mail: mailReady ? "reservation_ready" : "not_ready",
    operatorQueue: operatorQueueReady
      ? "bounded_reversal_repair_only"
      : "not_ready",
    accounting: accountingReady ? "projection_only" : "not_ready",
    sourceAuthoritative: true,
    providerEffects: false,
    automaticRestoration: false,
    genericRepair: false,
    authoritativeAccounting: false,
    code
  });
}

export function createProfessionalLifecycleProductionComposition({
  authority,
  provider,
  engagementBootstrap,
  mailLifecycle,
  clock,
  ids
} = {}) {
  invariant(
    authority && typeof authority.service === "function" &&
      provider &&
      typeof provider.retrieveProfessionalReversal === "function" &&
      engagementBootstrap &&
      typeof engagementBootstrap.readiness === "function" &&
      mailLifecycle && typeof mailLifecycle.readiness === "function" &&
      clock && typeof clock.now === "function" &&
      ids && typeof ids.next === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Professional lifecycle production composition is incomplete.",
    { status: 500 }
  );
  const reversalRepository =
    createPostgresProfessionalServicesReversalRepository({ authority });
  const professionalReversal =
    createProfessionalServicesReversalService({
      repository: reversalRepository,
      provider,
      clock,
      ids
    });
  const commerceNotifications =
    createCommerceTransitionNotifications({
      repository:
        createPostgresCommerceTransitionNotificationRepository({
          authority
        }),
      clock
    });
  const operatorQueue = createOperatorWorkQueue({
    repository: createPostgresOperatorWorkQueueRepository({ authority }),
    reversalRepair: professionalReversal,
    clock
  });
  const accountingJournal = createAccountingPurposeJournal({
    repository:
      createPostgresAccountingPurposeJournalRepository({ authority })
  });

  return Object.freeze({
    kind: "professional-lifecycle-production",
    mode: "held",
    providerEffects: false,
    notificationDelivery: "reserved_only",
    automaticRestoration: false,
    genericRepair: false,
    authoritativeAccounting: false,
    engagementBootstrap,
    professionalReversal,
    commerceNotifications,
    mailLifecycle,
    operatorQueue,
    accountingJournal,
    async readiness() {
      const [
        engagement,
        reversal,
        notifications,
        mail,
        operatorQueueReadiness,
        accounting
      ] = await Promise.all([
        engagementBootstrap.readiness(),
        reversalRepository.readiness(),
        commerceNotifications.readiness(),
        mailLifecycle.readiness(),
        operatorQueue.readiness(),
        accountingJournal.readiness()
      ]);
      return fixedReadiness({
        engagement,
        reversal,
        notifications,
        mail,
        operatorQueue: operatorQueueReadiness,
        accounting
      });
    }
  });
}
