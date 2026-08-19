import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  createCareCapacityAllocation,
  createCarePeriodClose,
  createCarePeriodOpen,
  createCareTicketOpen,
  createCareTicketTransition
} from "./care-core.mjs";
import { canonicalJson } from "./security.mjs";

export const CARE_SURFACE_DASHBOARD_SCHEMA =
  "sitesourcery.care-surface-dashboard/v1";
export const CARE_MAIL_RESERVATION_SCHEMA =
  "sitesourcery.care-mail-reservation/v1";
export const CARE_OPERATOR_CAPABILITY = "service_management_manage";
export const CARE_MAIL_CAPABILITY = "service_case_manage";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const CARE_MAIL_TEMPLATES = new Set([
  "care-ticket-acknowledgment.v1",
  "care-ticket-resolved.v1",
  "care-ticket-update.v1"
]);
const CARE_MAIL_NOTIFICATION_KINDS = Object.freeze({
  "care-ticket-acknowledgment.v1": "care_ticket_acknowledgment",
  "care-ticket-resolved.v1": "care_ticket_resolved",
  "care-ticket-update.v1": "care_ticket_update"
});
const MAXIMUM_MAIL_RESERVATION_MS = 7 * 24 * 60 * 60 * 1000;

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "CARE_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "CARE_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "CARE_SURFACE_INVALID",
    `${field} must be an opaque lowercase SHA-256 digest.`,
    { status: 400 }
  );
  return value;
}

function safeId(value, field) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "CARE_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "CARE_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function now(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "The Care surface clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function actor(value) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "AUTHENTICATION_REQUIRED",
    "Sign in to continue.",
    { status: 401 }
  );
  return deepFreeze({
    userId: uuid(value.userId, "Authenticated user ID"),
    organizationId: uuid(
      value.organizationId,
      "Authenticated organization ID"
    )
  });
}

function operatorActor(value, organizationId) {
  const selected = actor(value);
  return deepFreeze({
    actorId: selected.userId,
    actorKind: "operator",
    organizationId: uuid(organizationId, "Care organization ID")
  });
}

function commandContext(value, field) {
  exactObject(value, ["body", "commandId", "organizationId"], field);
  invariant(
    value.body !== null &&
      typeof value.body === "object" &&
      !Array.isArray(value.body) &&
      Object.getPrototypeOf(value.body) === Object.prototype,
    "CARE_SURFACE_INVALID",
    `${field} body is invalid.`,
    { status: 400 }
  );
  return {
    body: value.body,
    commandId: safeId(value.commandId, "Care idempotency key"),
    organizationId: uuid(value.organizationId, "Care organization ID")
  };
}

function validateRepository(repository) {
  const methods = [
    "allocateCapacity",
    "assertOperatorCapabilities",
    "closePeriod",
    "openPeriod",
    "openTicket",
    "readCustomerDashboard",
    "readOperatorDashboard",
    "readiness",
    "resolveAssessmentFindingId",
    "resolveTicketMailScope",
    "transitionTicket"
  ];
  invariant(
    repository && methods.every((method) =>
      typeof repository[method] === "function"
    ),
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "The canonical Care surface repository is required.",
    { status: 500 }
  );
  return repository;
}

function validateMailReservations(mailReservations) {
  invariant(
    mailReservations &&
      typeof mailReservations.readiness === "function" &&
      typeof mailReservations.reserve === "function" &&
      mailReservations.providerEffects === false &&
      mailReservations.deliveryEffects === false,
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "The held Care mail reservation interface is required.",
    { status: 500 }
  );
  return mailReservations;
}

function heldCustomerEffect() {
  return new HostedError(
    "CARE_CUSTOMER_EFFECTS_HELD",
    "New customer Care requests remain held until commercial release.",
    {
      status: 503,
      details: {
        customerEffects: false,
        mailEffects: false,
        paymentEffects: false,
        providerEffects: false
      }
    }
  );
}

export function createCareMailReservationInterface({
  notifications,
  clock
} = {}) {
  invariant(
    notifications &&
      typeof notifications.readiness === "function" &&
      typeof notifications.reserveOperator === "function" &&
      notifications.providerEffects === false &&
      notifications.deliveryClaimed === false,
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "A durable provider-held mail lifecycle is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "care-mail-reservation",
    mode: "reservation-only",
    deliveryEffects: false,
    providerEffects: false,
    readiness: () => notifications.readiness(),
    async reserve(input) {
      exactObject(
        input,
        [
          "actorId", "commandId", "contentDigest", "customerUserId", "expiresAt",
          "organizationId", "projectId", "recipientDigest",
          "source", "subjectReferenceDigest", "templateVersion", "ticketId"
        ],
        "Care mail reservation"
      );
      const ticketId = uuid(input.ticketId, "Care ticket ID");
      const requestedAt = now(clock);
      const expiresAt = instant(input.expiresAt, "Care mail expiry");
      invariant(
        typeof input.templateVersion === "string" &&
          CARE_MAIL_TEMPLATES.has(input.templateVersion) &&
          Date.parse(expiresAt) > Date.parse(requestedAt) &&
          Date.parse(expiresAt) - Date.parse(requestedAt) <=
            MAXIMUM_MAIL_RESERVATION_MS,
        "CARE_SURFACE_INVALID",
        "Care mail template or expiry is invalid.",
        { status: 400 }
      );
      const reservation = await notifications.reserveOperator({
        actorId: uuid(input.actorId, "Care operator ID"),
        commandId: safeId(input.commandId, "Care mail idempotency key"),
        operatorOrganizationId: uuid(
          input.organizationId,
          "Care organization ID"
        ),
        purposeKind: "care",
        notificationKind:
          CARE_MAIL_NOTIFICATION_KINDS[input.templateVersion],
        source: input.source,
        recipientDigest: sha256(input.recipientDigest, "Recipient digest"),
        subjectReferenceDigest: sha256(
          input.subjectReferenceDigest,
          "Subject reference digest"
        ),
        contentDigest: sha256(input.contentDigest, "Content digest"),
        templateVersion: input.templateVersion,
        expiresAt
      });
      invariant(
        reservation &&
          reservation.schema ===
            "sitesourcery.mail-purpose-notification-read/v1" &&
          reservation.referenceId === ticketId &&
          reservation.organizationId === input.organizationId &&
          reservation.projectId === input.projectId &&
          reservation.sourceCustomerUserId === input.customerUserId &&
          UUID.test(reservation.mail?.messageId) &&
          reservation.reservation?.state === "held" &&
          reservation.providerEffectsAuthorized === false &&
          reservation.deliveryClaimed === false,
        "CARE_MAIL_RESERVATION_CONFLICT",
        "The durable Care mail reservation returned inconsistent evidence.",
        { status: 500 }
      );
      return deepFreeze({
        schema: CARE_MAIL_RESERVATION_SCHEMA,
        ticketId,
        messageId: reservation.mail.messageId,
        state: "reserved",
        requestedAt: instant(
          reservation.reservation.reservedAt,
          "Care mail reservation time"
        ),
        expiresAt: instant(
          reservation.reservation.expiresAt,
          "Care mail expiry"
        ),
        deliveryEffects: false,
        providerEffects: false
      });
    }
  });
}

export function createCareSurfacesService({
  repository,
  mailReservations,
  clock
} = {}) {
  const care = validateRepository(repository);
  const mail = validateMailReservations(mailReservations);

  async function operator(value, authenticated, capabilities) {
    const context = commandContext(value, "Care operator command");
    const selectedActor = operatorActor(
      authenticated,
      context.organizationId
    );
    await care.assertOperatorCapabilities({
      actorId: selectedActor.actorId,
      organizationId: selectedActor.organizationId,
      capabilities
    });
    return { ...context, actor: selectedActor, recordedAt: now(clock) };
  }

  return Object.freeze({
    kind: "care-surfaces",
    mode: "held-local",
    customerEffects: false,
    mailDeliveryEffects: false,
    paymentEffects: false,
    providerEffects: false,
    async readiness() {
      const [core, mailState] = await Promise.all([
        care.readiness(),
        mail.readiness()
      ]);
      return deepFreeze({
        ready: core?.ready === true && mailState?.ready === true,
        verified: core?.verified === true && mailState?.verified === true,
        schema: "sitesourcery.care-surface-readiness/v1",
        mode: "held-local",
        core: {
          ready: core?.ready === true,
          verified: core?.verified === true
        },
        mailReservation: {
          ready: mailState?.ready === true,
          verified: mailState?.verified === true,
          deliveryEffects: false,
          providerEffects: false
        },
        customerEffects: false,
        paymentEffects: false,
        providerEffects: false
      });
    },
    readCustomer(authenticated) {
      const selected = actor(authenticated);
      return care.readCustomerDashboard({
        actorId: selected.userId,
        organizationId: selected.organizationId
      });
    },
    async requestCustomerTicket(authenticated) {
      const selected = actor(authenticated);
      await care.readCustomerDashboard({
        actorId: selected.userId,
        organizationId: selected.organizationId
      });
      throw heldCustomerEffect();
    },
    async readOperator(authenticated, organizationId) {
      const selected = operatorActor(authenticated, organizationId);
      await care.assertOperatorCapabilities({
        actorId: selected.actorId,
        organizationId: selected.organizationId,
        capabilities: [CARE_OPERATOR_CAPABILITY]
      });
      return care.readOperatorDashboard({
        actorId: selected.actorId,
        organizationId: selected.organizationId
      });
    },
    async openPeriod(authenticated, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        [
          "carriedFromPeriodId", "carriedUnits", "contractId", "endsOn",
          "includedUnits", "periodId", "projectId", "providerPeriodKey",
          "providerScopeDigest", "startsOn"
        ],
        "Care period opening"
      );
      return care.openPeriod(createCarePeriodOpen({
        actor: selected.actor,
        commandId: selected.commandId,
        recordedAt: selected.recordedAt,
        ...selected.body
      }));
    },
    async closePeriod(authenticated, periodId, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        ["expectedRevision", "projectId"],
        "Care period closure"
      );
      return care.closePeriod(createCarePeriodClose({
        actor: selected.actor,
        commandId: selected.commandId,
        recordedAt: selected.recordedAt,
        periodId: uuid(periodId, "Care period ID"),
        ...selected.body
      }));
    },
    async openTicket(authenticated, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        [
          "basisDigest", "basisKind", "contractId", "periodId", "projectId",
          "supportTicketId", "ticketId", "workScopeDigest"
        ],
        "Care ticket opening"
      );
      const basisDigest = sha256(
        selected.body.basisDigest,
        "Care ticket basis digest"
      );
      const basisReferenceId = selected.body.basisKind === "assessment_finding"
        ? await care.resolveAssessmentFindingId({
            actorId: selected.actor.actorId,
            organizationId: selected.actor.organizationId,
            projectId: uuid(selected.body.projectId, "Care project ID"),
            findingDigest: basisDigest
          })
        : null;
      return care.openTicket(createCareTicketOpen({
        actor: selected.actor,
        commandId: selected.commandId,
        recordedAt: selected.recordedAt,
        ...selected.body,
        basisDigest,
        basisReferenceId
      }));
    },
    async transitionTicket(authenticated, ticketId, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        ["expectedRevision", "projectId", "transition"],
        "Care ticket transition"
      );
      return care.transitionTicket(createCareTicketTransition({
        actor: selected.actor,
        commandId: selected.commandId,
        recordedAt: selected.recordedAt,
        ticketId: uuid(ticketId, "Care ticket ID"),
        ...selected.body
      }));
    },
    async allocateCapacity(authenticated, periodId, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        ["capacitySource", "entryId", "projectId", "ticketId", "units"],
        "Care capacity allocation"
      );
      return care.allocateCapacity(createCareCapacityAllocation({
        actor: selected.actor,
        commandId: selected.commandId,
        recordedAt: selected.recordedAt,
        periodId: uuid(periodId, "Care period ID"),
        ...selected.body
      }));
    },
    async reserveTicketMail(authenticated, ticketId, value) {
      const selected = await operator(
        value,
        authenticated,
        [CARE_MAIL_CAPABILITY, CARE_OPERATOR_CAPABILITY]
      );
      exactObject(
        selected.body,
        [
          "contentDigest", "expiresAt", "recipientDigest",
          "subjectReferenceDigest", "templateVersion"
        ],
        "Care mail reservation"
      );
      const selectedTicketId = uuid(ticketId, "Care ticket ID");
      const scope = await care.resolveTicketMailScope({
        actorId: selected.actor.actorId,
        organizationId: selected.actor.organizationId,
        ticketId: selectedTicketId,
        notificationKind:
          CARE_MAIL_NOTIFICATION_KINDS[selected.body.templateVersion]
      });
      return mail.reserve({
        actorId: selected.actor.actorId,
        commandId: selected.commandId,
        ticketId: selectedTicketId,
        organizationId: selected.actor.organizationId,
        projectId: scope.projectId,
        customerUserId: scope.customerUserId,
        source: scope.source,
        ...selected.body
      });
    }
  });
}
