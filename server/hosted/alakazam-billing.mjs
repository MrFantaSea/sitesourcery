import { HostedError, invariant } from "./errors.mjs";
import {
  CommerceV2Error
} from "../commerce-v2/canonical.mjs";
import {
  projectAlakazamInvoice
} from "./alakazam-billing-invoice.mjs";
import {
  projectAlakazamCancellationPreview
} from "./alakazam-billing-cancellation.mjs";
import {
  projectAlakazamBillingStates
} from "./alakazam-billing-states.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVOICE_ROUTE =
  /^\/api\/v1\/projects\/([^/]+)\/alakazam\/invoices\/([^/]+)$/u;
const CANCELLATION_PREVIEW_ROUTE =
  /^\/api\/v1\/projects\/([^/]+)\/alakazam\/cancellation-preview$/u;
const BILLING_STATES_ROUTE =
  /^\/api\/v1\/projects\/([^/]+)\/alakazam\/billing-states$/u;

export const ALAKAZAM_BILLING_SURFACES = Object.freeze([
  "invoice",
  "cancellationPreview",
  "billingStates"
]);

const HELD_SURFACES = Object.freeze({
  invoice: Object.freeze({
    code: "ALAKAZAM_INVOICE_HELD",
    message:
      "Alakazam invoices are held in this runtime."
  }),
  cancellationPreview: Object.freeze({
    code: "ALAKAZAM_CANCELLATION_PREVIEW_HELD",
    message:
      "Alakazam cancellation preview is held in this runtime."
  }),
  billingStates: Object.freeze({
    code: "ALAKAZAM_BILLING_STATES_HELD",
    message:
      "Alakazam billing states are held in this runtime."
  })
});

function requireActor(actor) {
  if (
    !actor ||
    typeof actor.userId !== "string" ||
    !UUID.test(actor.userId)
  ) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before viewing Alakazam billing.",
      { status: 401 }
    );
  }
  return actor;
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

function requireReceiptId(value) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_ALAKAZAM_RECEIPT_ID",
    "The selected Alakazam receipt is invalid.",
    { status: 400 }
  );
  return value;
}

function translate(error) {
  if (error instanceof HostedError) return error;
  if (error instanceof CommerceV2Error) {
    return new HostedError(
      `ALAKAZAM_${error.code.toUpperCase()}`,
      error.message,
      { status: error.status }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

function exactScope(value, actor, projectId) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(
          [
            "actorId",
            "customerId",
            "projectId",
            "tenantId"
          ].sort()
        ) &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId &&
      value.projectId === projectId &&
      typeof value.tenantId === "string" &&
      UUID.test(value.tenantId),
    "project_unavailable",
    "the customer billing project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: value.tenantId,
    customerId: actor.userId,
    actorId: actor.userId,
    projectId
  });
}

/**
 * The default hosted runtime keeps every Alakazam customer surface held, in
 * the same way server/hosted/PUBLICATION_HOLD describes: the routes exist and
 * are authenticated, and they refuse with an explicit held code rather than
 * reaching any repository or provider.
 */
export function createHeldHostedAlakazamBillingSurfaces() {
  function held(surface) {
    return async (actor) => {
      requireActor(actor);
      throw new HostedError(
        HELD_SURFACES[surface].code,
        HELD_SURFACES[surface].message,
        { status: 503 }
      );
    };
  }
  return Object.freeze({
    getInvoice: held("invoice"),
    getCancellationPreview: held("cancellationPreview"),
    getBillingStates: held("billingStates")
  });
}

export function createHostedAlakazamBillingSurfaces({
  repository,
  account,
  resolveSession
} = {}) {
  invariant(
    repository &&
      typeof repository.readCustomerInvoice ===
        "function" &&
      typeof repository.readCustomerBillingStates ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "The Alakazam billing repository is required.",
    { status: 500 }
  );
  invariant(
    account && typeof account.read === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "The Alakazam account service is required.",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "The Alakazam project scope resolver is required.",
    { status: 500 }
  );

  async function scopeFor(actorInput, projectIdInput) {
    const actor = requireActor(actorInput);
    const projectId = requireProjectId(projectIdInput);
    return exactScope(
      await resolveSession({ actor, projectId }),
      actor,
      projectId
    );
  }

  return Object.freeze({
    async getInvoice(
      actorInput,
      projectIdInput,
      receiptIdInput
    ) {
      return translated(async () => {
        const receiptId = requireReceiptId(receiptIdInput);
        const scope = await scopeFor(
          actorInput,
          projectIdInput
        );
        return projectAlakazamInvoice(
          await repository.readCustomerInvoice({
            ...scope,
            receiptId
          }),
          scope,
          receiptId
        );
      });
    },

    async getCancellationPreview(
      actorInput,
      projectIdInput
    ) {
      return translated(async () => {
        const scope = await scopeFor(
          actorInput,
          projectIdInput
        );
        return projectAlakazamCancellationPreview(
          await account.read(scope),
          scope
        );
      });
    },

    async getBillingStates(actorInput, projectIdInput) {
      return translated(async () => {
        const scope = await scopeFor(
          actorInput,
          projectIdInput
        );
        return projectAlakazamBillingStates(
          await repository.readCustomerBillingStates(
            scope
          ),
          scope
        );
      });
    }
  });
}

/**
 * Route matching lives here so the composition root needs one branch, not
 * three. `match` mirrors the composition root's own decodeURIComponent
 * behaviour for path segments.
 */
export function matchAlakazamBillingSurfaceRoute(
  method,
  pathname
) {
  if (method !== "GET") return null;
  const segments = (pattern) => {
    const result = pattern.exec(pathname);
    return result
      ? result.slice(1).map((value) =>
          decodeURIComponent(value)
        )
      : null;
  };
  let matched = segments(INVOICE_ROUTE);
  if (matched) {
    return Object.freeze({
      surface: "invoice",
      projectId: matched[0],
      receiptId: matched[1]
    });
  }
  matched = segments(CANCELLATION_PREVIEW_ROUTE);
  if (matched) {
    return Object.freeze({
      surface: "cancellationPreview",
      projectId: matched[0],
      receiptId: null
    });
  }
  matched = segments(BILLING_STATES_ROUTE);
  if (matched) {
    return Object.freeze({
      surface: "billingStates",
      projectId: matched[0],
      receiptId: null
    });
  }
  return null;
}

export async function readAlakazamBillingSurface(
  boundary,
  actor,
  route,
  url
) {
  invariant(
    boundary &&
      typeof boundary.getInvoice === "function" &&
      typeof boundary.getCancellationPreview ===
        "function" &&
      typeof boundary.getBillingStates === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing surfaces boundary is invalid.",
    { status: 500 }
  );
  invariant(
    route &&
      ALAKAZAM_BILLING_SURFACES.includes(route.surface),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing surface route is invalid.",
    { status: 500 }
  );
  invariant(
    !url || [...url.searchParams.keys()].length === 0,
    "INVALID_ALAKAZAM_BILLING_QUERY",
    "The Alakazam billing request accepts no query values.",
    { status: 400 }
  );
  invariant(
    actor !== null && actor !== undefined,
    "AUTHENTICATION_REQUIRED",
    "Sign in before viewing Alakazam billing.",
    { status: 401 }
  );
  if (route.surface === "invoice") {
    return boundary.getInvoice(
      actor,
      route.projectId,
      route.receiptId
    );
  }
  if (route.surface === "cancellationPreview") {
    return boundary.getCancellationPreview(
      actor,
      route.projectId
    );
  }
  return boundary.getBillingStates(
    actor,
    route.projectId
  );
}
