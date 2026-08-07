import { HostedError, invariant } from "./errors.mjs";
import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { projectCustomServicesAccount } from "./custom-services-account.mjs";
import {
  projectCustomServicesAssessmentQuote
} from "./custom-services-assessment-quote.mjs";
import {
  createHeldCustomServicesCustomBuildChangeCompletion
} from "./custom-services-custom-build-change-completion-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildChangePayment
} from "./custom-services-custom-build-change-payment-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildFinalPayment
} from "./custom-services-custom-build-final-payment-postgres.mjs";
import {
  createHeldCustomServicesCustomBuildHandoff
} from "./custom-services-custom-build-handoff-postgres.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXACT_WORKMANSHIP_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
export const CUSTOM_BUILD_OWNER_HANDOFF_READINESS_SCHEMA =
  "sitesourcery.custom-build-handoff-owner-readiness/v1";

function exactOwnerHandoffObject(value, expected, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_configuration",
    `the ${field} projection is invalid`,
    { status: 500 }
  );
  return value;
}

function ownerHandoffUuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_configuration",
    `the ${field} projection is invalid`,
    { status: 500 }
  );
  return value;
}

function ownerHandoffDigest(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "invalid_configuration",
    `the ${field} projection is invalid`,
    { status: 500 }
  );
  return value;
}

function ownerHandoffIso(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "invalid_configuration",
    `the ${field} projection is invalid`,
    { status: 500 }
  );
  return value;
}

// This projection is intentionally not a final-payment projection. Its exact
// public shape is: schema/state, organization/project/job identity,
// completion and final-obligation identity, a redacted clearance timestamp,
// retained customer document/workmanship identity, and the handoff action.
// It never carries Checkout, invoice, attempt, event, reconciliation,
// provider-reference, payment-receipt, or raw-provider fields.
export function projectCustomBuildOwnerHandoffReadiness(value) {
  const source = exactOwnerHandoffObject(value, [
    "action",
    "completion",
    "finalObligation",
    "financialClearance",
    "handoff",
    "jobId",
    "organizationId",
    "projectId",
    "schema",
    "state"
  ], "owner Custom-build handoff");
  invariant(
    source.schema === "sitesourcery.custom-build-handoff-state/v1" &&
      [
        "checkout_available",
        "payment_reconciliation_required",
        "paid_handoff_pending",
        "cleared_no_balance_handoff_pending",
        "handed_off"
      ].includes(source.state),
    "invalid_configuration",
    "the owner Custom-build handoff schema is invalid",
    { status: 500 }
  );
  const completion = exactOwnerHandoffObject(source.completion, [
    "completedAt",
    "packageDigest",
    "packageId"
  ], "owner Custom-build completion");
  const obligation = exactOwnerHandoffObject(source.finalObligation, [
    "obligationDigest",
    "obligationId"
  ], "owner Custom-build final obligation");
  const action = exactOwnerHandoffObject(source.action, [
    "handoffAvailable",
    "reason"
  ], "owner Custom-build handoff action");
  invariant(
    typeof action.handoffAvailable === "boolean" &&
      (action.reason === null || typeof action.reason === "string"),
    "invalid_configuration",
    "the owner Custom-build handoff action is invalid",
    { status: 500 }
  );

  const projectedCompletion = {
    packageId: ownerHandoffUuid(completion.packageId, "completion ID"),
    packageDigest: ownerHandoffDigest(
      completion.packageDigest,
      "completion digest"
    ),
    completedAt: ownerHandoffIso(
      completion.completedAt,
      "completion time"
    )
  };
  const projectedObligation = {
    obligationId: ownerHandoffUuid(
      obligation.obligationId,
      "final-obligation ID"
    ),
    obligationDigest: ownerHandoffDigest(
      obligation.obligationDigest,
      "final-obligation digest"
    )
  };
  const projectedClearance = source.financialClearance === null
    ? null
    : (() => {
        const clearance = exactOwnerHandoffObject(
          source.financialClearance,
          ["clearedAt", "kind", "referenceId"],
          "owner Custom-build financial clearance"
        );
        invariant(
          [
            "provider_confirmed_final_payment",
            "zero_balance_clearance"
          ].includes(clearance.kind),
          "invalid_configuration",
          "the owner Custom-build financial clearance is invalid",
          { status: 500 }
        );
        ownerHandoffUuid(clearance.referenceId, "financial-clearance ID");
        return {
          clearedAt: ownerHandoffIso(
            clearance.clearedAt,
            "financial-clearance time"
          )
        };
      })();
  const projectedHandoff = source.handoff === null
    ? null
    : (() => {
        const handoff = exactOwnerHandoffObject(source.handoff, [
          "contentDigest",
          "documentId",
          "handedOffAt",
          "receiptId",
          "workmanship"
        ], "owner Custom-build retained handoff");
        const workmanship = exactOwnerHandoffObject(
          handoff.workmanship,
          ["coverage", "endsAt", "startsAt", "termDays"],
          "owner Custom-build workmanship"
        );
        const handedOffAt = ownerHandoffIso(
          handoff.handedOffAt,
          "handoff time"
        );
        const startsAt = ownerHandoffIso(
          workmanship.startsAt,
          "workmanship start"
        );
        const endsAt = ownerHandoffIso(
          workmanship.endsAt,
          "workmanship end"
        );
        invariant(
          workmanship.coverage === "[start,end)" &&
            workmanship.termDays === 30 &&
            startsAt === handedOffAt &&
            Date.parse(endsAt) - Date.parse(startsAt) ===
              EXACT_WORKMANSHIP_MILLISECONDS,
          "invalid_configuration",
          "the owner Custom-build workmanship projection is invalid",
          { status: 500 }
        );
        ownerHandoffUuid(handoff.receiptId, "handoff receipt ID");
        return {
          documentId: ownerHandoffUuid(
            handoff.documentId,
            "handoff document ID"
          ),
          contentDigest: ownerHandoffDigest(
            handoff.contentDigest,
            "handoff document digest"
          ),
          handedOffAt,
          workmanship: {
            coverage: "[start,end)",
            termDays: 30,
            startsAt,
            endsAt
          }
        };
      })();

  invariant(
    (projectedHandoff !== null
      ? source.state === "handed_off" &&
        projectedClearance !== null &&
        action.handoffAvailable === false
      : projectedClearance !== null
        ? [
            "paid_handoff_pending",
            "cleared_no_balance_handoff_pending"
          ].includes(source.state)
        : [
            "checkout_available",
            "payment_reconciliation_required"
          ].includes(source.state) && !action.handoffAvailable),
    "invalid_configuration",
    "the owner Custom-build handoff readiness is contradictory",
    { status: 500 }
  );
  const handoffAvailable =
    projectedHandoff === null &&
    projectedClearance !== null &&
    action.handoffAvailable;
  return deepFreeze({
    schema: CUSTOM_BUILD_OWNER_HANDOFF_READINESS_SCHEMA,
    state: projectedHandoff !== null
      ? "handed_off"
      : handoffAvailable
        ? "handoff_available"
        : "handoff_not_ready",
    organizationId: ownerHandoffUuid(
      source.organizationId,
      "handoff organization ID"
    ),
    projectId: ownerHandoffUuid(source.projectId, "handoff project ID"),
    jobId: ownerHandoffUuid(source.jobId, "handoff job ID"),
    completion: projectedCompletion,
    finalObligation: projectedObligation,
    financialClearance: projectedClearance,
    handoff: projectedHandoff,
    action: {
      handoffAvailable,
      reason: projectedHandoff !== null
        ? "handed_off"
        : handoffAvailable
          ? "financial_clearance_confirmed"
          : projectedClearance === null
            ? "financial_clearance_required"
            : "handoff_boundary_not_ready"
    }
  });
}

export function createHostedCustomServicesCustomBuildHandoffOwner({
  customBuildHandoff = null
} = {}) {
  const boundary =
    customBuildHandoff ?? createHeldCustomServicesCustomBuildHandoff();
  invariant(
    typeof boundary.readOwner === "function" &&
      typeof boundary.createHandoff === "function",
    "invalid_configuration",
    "the owner Custom-build handoff boundary is required",
    { status: 500 }
  );
  return Object.freeze({
    async readOwnerState(actor, jobId, organizationId) {
      return projectCustomBuildOwnerHandoffReadiness(
        await boundary.readOwner(actor, jobId, organizationId)
      );
    },
    async createHandoff(actor, jobId, input) {
      return boundary.createHandoff(actor, jobId, input);
    }
  });
}

function projectCustomBuildFinalHandoff(finalPayment, handoff) {
  invariant(
    finalPayment &&
      finalPayment.schema === "sitesourcery.custom-build-final-handoff/v1" &&
      handoff &&
      handoff.schema === "sitesourcery.custom-build-handoff-state/v1" &&
      handoff.projectId === finalPayment.projectId,
    "invalid_configuration",
    "the Custom-build final-payment and handoff projections disagree",
    { status: 500 }
  );
  if (finalPayment.state === "completion_required") {
    invariant(
      handoff.state === "completion_required" &&
        finalPayment.jobId === null &&
        handoff.jobId === null,
      "invalid_configuration",
      "the Custom-build completion boundary disagrees with handoff storage",
      { status: 500 }
    );
    return finalPayment;
  }
  invariant(
    UUID.test(String(finalPayment.jobId ?? "")) &&
      handoff.jobId === finalPayment.jobId &&
      UUID.test(String(finalPayment.completion?.packageId ?? "")) &&
      SHA256.test(String(finalPayment.completion?.packageDigest ?? "")) &&
      handoff.completion?.packageId === finalPayment.completion.packageId &&
      handoff.completion?.packageDigest ===
        finalPayment.completion.packageDigest &&
      UUID.test(String(finalPayment.obligation?.obligationId ?? "")) &&
      SHA256.test(String(finalPayment.obligation?.obligationDigest ?? "")) &&
      handoff.finalObligation?.obligationId ===
        finalPayment.obligation.obligationId &&
      handoff.finalObligation?.obligationDigest ===
        finalPayment.obligation.obligationDigest,
    "invalid_configuration",
    "the retained Custom-build completion or final obligation changed",
    { status: 500 }
  );
  if (handoff.state !== "handed_off") return finalPayment;

  const startsAt = handoff.handoff?.workmanship?.startsAt;
  const endsAt = handoff.handoff?.workmanship?.endsAt;
  const handedOffAt = handoff.handoff?.handedOffAt;
  invariant(
    [
      "paid_handoff_pending",
      "cleared_no_balance_handoff_pending"
    ].includes(finalPayment.state) &&
      UUID.test(String(handoff.handoff?.documentId ?? "")) &&
      SHA256.test(String(handoff.handoff?.contentDigest ?? "")) &&
      Number.isFinite(Date.parse(handedOffAt)) &&
      startsAt === handedOffAt &&
      Number.isFinite(Date.parse(endsAt)) &&
      Date.parse(endsAt) - Date.parse(startsAt) ===
        EXACT_WORKMANSHIP_MILLISECONDS &&
      handoff.handoff.workmanship.coverage === "[start,end)" &&
      handoff.handoff.workmanship.termDays === 30,
    "invalid_configuration",
    "the retained Custom-build handoff or workmanship window is invalid",
    { status: 500 }
  );
  return deepFreeze({
    ...structuredClone(finalPayment),
    state: "handed_off",
    handoff: {
      state: "handed_off",
      documentId: handoff.handoff.documentId,
      contentDigest: handoff.handoff.contentDigest,
      handedOffAt,
      workmanshipStartsAt: startsAt,
      workmanshipEndsAt: endsAt
    },
    action: {
      checkoutAvailable: false,
      handoffAvailable: false,
      reason: "handed_off"
    }
  });
}

function requireActor(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before viewing custom services.",
      { status: 401 }
    );
  }
  return value;
}

function requireProjectId(value) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_PROJECT_ID",
    "The selected project is invalid.",
    { status: 400 }
  );
  return value;
}

function exactScope(value, actor, projectId) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(
          ["actorId", "customerId", "projectId", "tenantId"].sort()
        ) &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId &&
      value.projectId === projectId &&
      typeof value.tenantId === "string" &&
      UUID.test(value.tenantId),
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId: actor.userId,
    customerId: actor.userId,
    organizationId: value.tenantId,
    projectId
  });
}

function exactQuoteAcceptance(value) {
  const expected = [
    "acceptanceStatement",
    "acceptedDisclosureDigest",
    "acceptedQuoteDigest",
    "commandId",
    "quoteId",
    "quoteRevision"
  ];
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.sort()),
    "invalid_input",
    "The assessment quote acceptance is invalid.",
    { status: 400 }
  );
  return value;
}

function exactCustomBuildAcceptance(value) {
  const expected = [
    "acceptanceStatement",
    "acceptedDisclosureDigest",
    "acceptedQuoteDigest",
    "commandId",
    "quoteId",
    "quoteRevision"
  ];
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.sort()),
    "invalid_input",
    "The Custom build quote acceptance is invalid.",
    { status: 400 }
  );
  return value;
}

function exactCheckoutCommand(value) {
  const expected = ["commandId", "invoiceDigest"];
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.sort()),
    "invalid_input",
    "The custom-services invoice checkout request is invalid.",
    { status: 400 }
  );
  return value;
}

async function projectScope(resolveSession, actorInput, projectIdInput) {
  const actor = requireActor(actorInput);
  const projectId = requireProjectId(projectIdInput);
  const scope = exactScope(
    await resolveSession({ actor, projectId }),
    actor,
    projectId
  );
  return { actor, projectId, scope };
}

export function createHeldHostedCustomServicesAccount() {
  return Object.freeze({
    async getSnapshot(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_ACCOUNT_HELD",
        "Custom-services account information is held in this runtime.",
        { status: 503 }
      );
    },
    async getAssessmentQuote(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_QUOTE_HELD",
        "Custom-services assessment quotes are held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildQuote(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_HELD",
        "Custom build quote tools are held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildInvoice(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_PAYMENT_HELD",
        "Custom build payment is held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildProgress(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_PROGRESS_HELD",
        "Custom-build progress is held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildChangeCompletion(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
        "Custom-build change and completion tools are held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildChangeInvoice(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
        "Custom-build change payment is held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildFinalHandoff(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_FINAL_PAYMENT_HELD",
        "Custom-build final payment and handoff are held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildHandoffDocument(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_HANDOFF_HELD",
        "Custom-build handoff documents are held in this runtime.",
        { status: 503 }
      );
    },
    async getCustomBuildCompletionEvidence(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
        "Custom-build change and completion tools are held in this runtime.",
        { status: 503 }
      );
    },
    async getAssessmentInvoice(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_INVOICE_HELD",
        "Custom-services assessment invoices are held in this runtime.",
        { status: 503 }
      );
    },
    async getAssessmentReport(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_ASSESSMENT_WORK_HELD",
        "Custom-services assessment reports are held in this runtime.",
        { status: 503 }
      );
    },
    async getAssessmentEvidence(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_ASSESSMENT_WORK_HELD",
        "Custom-services assessment evidence is held in this runtime.",
        { status: 503 }
      );
    },
    async createAssessmentCheckout(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_PAYMENT_HELD",
        "Custom-services assessment payment is held in this runtime.",
        { status: 503 }
      );
    },
    async createCustomBuildCheckout(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_PAYMENT_HELD",
        "Custom build payment is held in this runtime.",
        { status: 503 }
      );
    },
    async createCustomBuildChangeCheckout(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
        "Custom-build change payment is held in this runtime.",
        { status: 503 }
      );
    },
    async createCustomBuildFinalCheckout(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_FINAL_PAYMENT_HELD",
        "Custom-build final payment is held in this runtime.",
        { status: 503 }
      );
    },
    async getAssessmentRequest(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_REQUEST_HELD",
        "Custom-services assessment requests are held in this runtime.",
        { status: 503 }
      );
    },
    async saveAssessmentRequest(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_REQUEST_HELD",
        "Custom-services assessment requests are held in this runtime.",
        { status: 503 }
      );
    },
    async submitAssessmentRequest(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_REQUEST_HELD",
        "Custom-services assessment requests are held in this runtime.",
        { status: 503 }
      );
    },
    async withdrawAssessmentRequest(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_REQUEST_HELD",
        "Custom-services assessment requests are held in this runtime.",
        { status: 503 }
      );
    },
    async acceptAssessmentQuote(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_QUOTE_HELD",
        "Custom-services assessment quotes are held in this runtime.",
        { status: 503 }
      );
    },
    async acceptCustomBuildQuote(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_HELD",
        "Custom build quote tools are held in this runtime.",
        { status: 503 }
      );
    },
    async respondToCustomBuildRequest(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_PROGRESS_HELD",
        "Custom-build progress is held in this runtime.",
        { status: 503 }
      );
    },
    async acceptCustomBuildChangeOrder(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
        "Custom-build change and completion tools are held in this runtime.",
        { status: 503 }
      );
    },
    async declineCustomBuildChangeOrder(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_BUILD_CHANGE_COMPLETION_HELD",
        "Custom-build change and completion tools are held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createHostedCustomServicesAccount({
  assessmentWork,
  customBuild,
  customBuildChangeCompletion = null,
  customBuildChangePayment = null,
  customBuildFinalPayment = null,
  customBuildHandoff = null,
  customBuildPayment,
  customBuildProgress,
  invoiceRepository,
  payment,
  quoteRepository,
  requestRepository,
  repository,
  resolveSession
} = {}) {
  const customBuildChangeCompletionBoundary =
    customBuildChangeCompletion ??
    createHeldCustomServicesCustomBuildChangeCompletion();
  const customBuildChangePaymentBoundary =
    customBuildChangePayment ??
    createHeldCustomServicesCustomBuildChangePayment();
  const customBuildFinalPaymentBoundary =
    customBuildFinalPayment ??
    createHeldCustomServicesCustomBuildFinalPayment();
  const customBuildHandoffEnabled = customBuildHandoff !== null;
  const customBuildHandoffBoundary =
    customBuildHandoff ?? createHeldCustomServicesCustomBuildHandoff();
  invariant(
    assessmentWork &&
      typeof assessmentWork.readCustomerReport === "function" &&
      typeof assessmentWork.readCustomerEvidence === "function",
    "invalid_configuration",
    "the custom-services assessment work boundary is required",
    { status: 500 }
  );
  invariant(
    customBuild &&
      typeof customBuild.readCurrentQuote === "function" &&
      typeof customBuild.acceptCurrentQuote === "function",
    "invalid_configuration",
    "the Custom build quote boundary is required",
    { status: 500 }
  );
  invariant(
    customBuildPayment &&
      typeof customBuildPayment.readCurrentInvoice === "function" &&
      typeof customBuildPayment.createCheckout === "function",
    "invalid_configuration",
    "the Custom build payment boundary is required",
    { status: 500 }
  );
  invariant(
    customBuildProgress &&
      typeof customBuildProgress.readCustomerProgress === "function" &&
      typeof customBuildProgress.respondToRequest === "function",
    "invalid_configuration",
    "the Custom-build progress boundary is required",
    { status: 500 }
  );
  invariant(
    typeof customBuildChangeCompletionBoundary.readCustomer === "function" &&
      typeof customBuildChangeCompletionBoundary.readCustomerEvidence ===
        "function" &&
      typeof customBuildChangeCompletionBoundary.acceptChangeOrder ===
        "function" &&
      typeof customBuildChangeCompletionBoundary.declineChangeOrder ===
        "function",
    "invalid_configuration",
    "the Custom-build change and completion boundary is required",
    { status: 500 }
  );
  invariant(
    typeof customBuildChangePaymentBoundary.readCurrentInvoice ===
        "function" &&
      typeof customBuildChangePaymentBoundary.createCheckout === "function",
    "invalid_configuration",
    "the Custom-build change payment boundary is required",
    { status: 500 }
  );
  invariant(
    typeof customBuildFinalPaymentBoundary.readCurrentState === "function" &&
      typeof customBuildFinalPaymentBoundary.createCheckout === "function",
    "invalid_configuration",
    "the Custom-build final payment boundary is required",
    { status: 500 }
  );
  invariant(
    typeof customBuildHandoffBoundary.readCustomer === "function" &&
      typeof customBuildHandoffBoundary.readCustomerDocument === "function",
    "invalid_configuration",
    "the Custom-build handoff boundary is required",
    { status: 500 }
  );
  invariant(
    payment && typeof payment.createCheckout === "function",
    "invalid_configuration",
    "the custom-services assessment payment boundary is required",
    { status: 500 }
  );
  invariant(
    invoiceRepository &&
      typeof invoiceRepository.readCurrentInvoice === "function",
    "invalid_configuration",
    "the custom-services assessment invoice repository is required",
    { status: 500 }
  );
  invariant(
    repository &&
      typeof repository.readFoundationSnapshot === "function",
    "invalid_configuration",
    "the custom-services account repository is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the custom-services project scope resolver is required",
    { status: 500 }
  );
  invariant(
    quoteRepository &&
      typeof quoteRepository.readCurrentQuote === "function" &&
      typeof quoteRepository.acceptCurrentQuote === "function",
    "invalid_configuration",
    "the custom-services assessment quote repository is required",
    { status: 500 }
  );
  invariant(
    requestRepository &&
      typeof requestRepository.readCurrentRequest === "function" &&
      typeof requestRepository.saveDraft === "function" &&
      typeof requestRepository.submitCurrentRequest === "function" &&
      typeof requestRepository.withdrawCurrentRequest === "function",
    "invalid_configuration",
    "the custom-services assessment request repository is required",
    { status: 500 }
  );

  return Object.freeze({
    async getSnapshot(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      const snapshot = await repository.readFoundationSnapshot(scope);
      return projectCustomServicesAccount({ scope, snapshot });
    },

    async getAssessmentQuote(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      const snapshot = await quoteRepository.readCurrentQuote(scope);
      return projectCustomServicesAssessmentQuote({ scope, snapshot });
    },

    async getCustomBuildQuote(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuild.readCurrentQuote(scope);
    },

    async getCustomBuildInvoice(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildPayment.readCurrentInvoice(scope);
    },

    async getCustomBuildProgress(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildProgress.readCustomerProgress(scope);
    },

    async getCustomBuildChangeCompletion(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangeCompletionBoundary.readCustomer(scope);
    },

    async getCustomBuildChangeInvoice(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangePaymentBoundary.readCurrentInvoice(scope);
    },

    async getCustomBuildFinalHandoff(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      const finalPayment =
        await customBuildFinalPaymentBoundary.readCurrentState(scope);
      if (!customBuildHandoffEnabled) return finalPayment;
      const handoff = await customBuildHandoffBoundary.readCustomer(scope);
      return projectCustomBuildFinalHandoff(finalPayment, handoff);
    },

    async getCustomBuildHandoffDocument(
      actorInput,
      projectIdInput,
      documentIdInput
    ) {
      const documentId = requireProjectId(documentIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildHandoffBoundary.readCustomerDocument(
        scope,
        documentId
      );
    },

    async getCustomBuildCompletionEvidence(
      actorInput,
      projectIdInput,
      evidenceIdInput
    ) {
      const evidenceId = requireProjectId(evidenceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangeCompletionBoundary.readCustomerEvidence(
        scope,
        evidenceId
      );
    },

    async getAssessmentInvoice(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return invoiceRepository.readCurrentInvoice(scope);
    },

    async getAssessmentReport(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return assessmentWork.readCustomerReport(scope);
    },

    async getAssessmentEvidence(
      actorInput,
      projectIdInput,
      evidenceIdInput
    ) {
      const evidenceId = requireProjectId(evidenceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return assessmentWork.readCustomerEvidence(scope, evidenceId);
    },

    async createAssessmentCheckout(
      actorInput,
      projectIdInput,
      invoiceIdInput,
      value
    ) {
      const input = exactCheckoutCommand(value);
      const invoiceId = requireProjectId(invoiceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return payment.createCheckout({
        ...scope,
        commandId: input.commandId,
        invoiceDigest: input.invoiceDigest,
        invoiceId
      });
    },

    async createCustomBuildCheckout(
      actorInput,
      projectIdInput,
      invoiceIdInput,
      value
    ) {
      const input = exactCheckoutCommand(value);
      const invoiceId = requireProjectId(invoiceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildPayment.createCheckout({
        ...scope,
        commandId: input.commandId,
        invoiceDigest: input.invoiceDigest,
        invoiceId
      });
    },

    async createCustomBuildChangeCheckout(
      actorInput,
      projectIdInput,
      invoiceIdInput,
      value
    ) {
      const input = exactCheckoutCommand(value);
      const invoiceId = requireProjectId(invoiceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangePaymentBoundary.createCheckout({
        ...scope,
        commandId: input.commandId,
        invoiceDigest: input.invoiceDigest,
        invoiceId
      });
    },

    async createCustomBuildFinalCheckout(
      actorInput,
      projectIdInput,
      invoiceIdInput,
      value
    ) {
      const input = exactCheckoutCommand(value);
      const invoiceId = requireProjectId(invoiceIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildFinalPaymentBoundary.createCheckout({
        ...scope,
        commandId: input.commandId,
        invoiceDigest: input.invoiceDigest,
        invoiceId
      });
    },

    async getAssessmentRequest(actorInput, projectIdInput) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return requestRepository.readCurrentRequest(scope);
    },

    async saveAssessmentRequest(actorInput, projectIdInput, input) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      await requestRepository.saveDraft({ ...input, ...scope });
      return requestRepository.readCurrentRequest(scope);
    },

    async submitAssessmentRequest(actorInput, projectIdInput, input) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      await requestRepository.submitCurrentRequest({ ...input, ...scope });
      return requestRepository.readCurrentRequest(scope);
    },

    async withdrawAssessmentRequest(actorInput, projectIdInput, input) {
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      await requestRepository.withdrawCurrentRequest({ ...input, ...scope });
      return requestRepository.readCurrentRequest(scope);
    },

    async acceptAssessmentQuote(actorInput, projectIdInput, value) {
      const input = exactQuoteAcceptance(value);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      await quoteRepository.acceptCurrentQuote({
        ...scope,
        acceptanceStatement: input.acceptanceStatement,
        acceptedDisclosureDigest: input.acceptedDisclosureDigest,
        acceptedQuoteDigest: input.acceptedQuoteDigest,
        commandId: input.commandId,
        quoteId: input.quoteId,
        quoteRevision: input.quoteRevision
      });
      const snapshot = await quoteRepository.readCurrentQuote(scope);
      return projectCustomServicesAssessmentQuote({ scope, snapshot });
    },

    async acceptCustomBuildQuote(actorInput, projectIdInput, value) {
      const input = exactCustomBuildAcceptance(value);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuild.acceptCurrentQuote({
        ...scope,
        acceptanceStatement: input.acceptanceStatement,
        acceptedDisclosureDigest: input.acceptedDisclosureDigest,
        acceptedQuoteDigest: input.acceptedQuoteDigest,
        commandId: input.commandId,
        quoteId: input.quoteId,
        quoteRevision: input.quoteRevision
      });
    },

    async respondToCustomBuildRequest(
      actorInput,
      projectIdInput,
      requestIdInput,
      value
    ) {
      const requestId = requireProjectId(requestIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildProgress.respondToRequest(scope, requestId, value);
    },

    async acceptCustomBuildChangeOrder(
      actorInput,
      projectIdInput,
      changeOrderIdInput,
      value
    ) {
      const changeOrderId = requireProjectId(changeOrderIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangeCompletionBoundary.acceptChangeOrder(
        scope,
        changeOrderId,
        value
      );
    },

    async declineCustomBuildChangeOrder(
      actorInput,
      projectIdInput,
      changeOrderIdInput,
      value
    ) {
      const changeOrderId = requireProjectId(changeOrderIdInput);
      const { scope } = await projectScope(
        resolveSession,
        actorInput,
        projectIdInput
      );
      return customBuildChangeCompletionBoundary.declineChangeOrder(
        scope,
        changeOrderId,
        value
      );
    }
  });
}
