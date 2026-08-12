import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import {
  createHeldNotificationMailDispatcher
} from "./notification-mail-dispatcher.mjs";
import {
  createHeldPrivateNotificationMailRenderer
} from "./notification-mail-private-resolver.mjs";
import {
  createHeldResendMailEventHttpAdapter
} from "./resend-mail-events-http.mjs";

function component(value, {
  kind,
  providerEffects,
  method
}) {
  invariant(
    value?.kind === kind &&
      value.providerEffects === providerEffects &&
      typeof value.readiness === "function" &&
      typeof value[method] === "function",
    "MAIL_ROUTE_DISPATCH_CONFIGURATION_REQUIRED",
    `The ${kind} component is invalid.`,
    { status: 500 }
  );
  return value;
}

export function createMailRouteDispatchComposition({
  enabled = false,
  eventHttp = createHeldResendMailEventHttpAdapter(),
  dispatcher = createHeldNotificationMailDispatcher(),
  privateRenderer = createHeldPrivateNotificationMailRenderer()
} = {}) {
  invariant(
    typeof enabled === "boolean",
    "MAIL_ROUTE_DISPATCH_CONFIGURATION_REQUIRED",
    "Mail route/dispatch enablement is invalid.",
    { status: 500 }
  );
  const selectedEventHttp = component(eventHttp, {
    kind: "resend-mail-event-http-adapter",
    providerEffects: false,
    method: "handle"
  });
  const selectedDispatcher = component(dispatcher, {
    kind: "notification-mail-dispatcher",
    providerEffects: enabled,
    method: "dispatch"
  });
  const selectedRenderer = component(privateRenderer, {
    kind: "private-notification-mail-renderer",
    providerEffects: false,
    method: "render"
  });
  invariant(
    !enabled ||
      (selectedEventHttp.mode === "raw-body" &&
        selectedDispatcher.mode === "provider-bound-held-wiring" &&
        selectedRenderer.mode === "private-resolvers"),
    "MAIL_ROUTE_DISPATCH_CONFIGURATION_REQUIRED",
    "Enabled mail composition requires every explicit verified boundary.",
    { status: 500 }
  );

  async function readiness() {
    if (!enabled) {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "mail-route-dispatch-composition",
        mode: "held",
        providerEffects: false,
        code: "MAIL_ROUTE_DISPATCH_HELD"
      });
    }
    const statuses = await Promise.all([
      selectedEventHttp.readiness(),
      selectedDispatcher.readiness(),
      selectedRenderer.readiness()
    ]);
    const ready = statuses.every(
      (status) => status?.ready === true && status?.verified === true
    );
    return deepFreeze({
      ready,
      verified: ready,
      kind: "mail-route-dispatch-composition",
      mode: "explicit",
      providerEffects: true,
      code: ready
        ? null
        : statuses.find(
            (status) => status?.ready !== true || status?.verified !== true
          )?.code ?? "MAIL_ROUTE_DISPATCH_NOT_READY"
    });
  }

  return Object.freeze({
    kind: "mail-route-dispatch-composition",
    mode: enabled ? "explicit" : "held",
    providerEffects: enabled,
    eventHttp: selectedEventHttp,
    dispatcher: selectedDispatcher,
    privateRenderer: selectedRenderer,
    readiness
  });
}

export function createHeldMailRouteDispatchComposition() {
  return createMailRouteDispatchComposition();
}
