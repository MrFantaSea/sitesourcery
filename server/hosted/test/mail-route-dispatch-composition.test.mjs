import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldMailRouteDispatchComposition,
  createMailRouteDispatchComposition
} from "../mail-route-dispatch-composition.mjs";

function part({ kind, mode, providerEffects, method, ready = true }) {
  return Object.freeze({
    kind,
    mode,
    providerEffects,
    async readiness() {
      return {
        ready,
        verified: ready,
        code: ready ? null : "FAKE_NOT_READY"
      };
    },
    async [method]() { return null; }
  });
}

test("mail route/dispatch production composition is held by default", async () => {
  const composition = createHeldMailRouteDispatchComposition();
  assert.equal(composition.mode, "held");
  assert.equal(composition.providerEffects, false);
  assert.equal(composition.eventHttp.mode, "held");
  assert.equal(composition.dispatcher.mode, "held");
  assert.equal(composition.privateRenderer.mode, "held");
  assert.deepEqual(await composition.readiness(), {
    ready: false,
    verified: false,
    kind: "mail-route-dispatch-composition",
    mode: "held",
    providerEffects: false,
    code: "MAIL_ROUTE_DISPATCH_HELD"
  });
});

test("explicit composition requires every reviewed boundary and aggregates readiness", async () => {
  const eventHttp = part({
    kind: "resend-mail-event-http-adapter",
    mode: "raw-body",
    providerEffects: false,
    method: "handle"
  });
  const dispatcher = part({
    kind: "notification-mail-dispatcher",
    mode: "provider-bound-held-wiring",
    providerEffects: true,
    method: "dispatch"
  });
  const privateRenderer = part({
    kind: "private-notification-mail-renderer",
    mode: "private-resolvers",
    providerEffects: false,
    method: "render"
  });
  const composition = createMailRouteDispatchComposition({
    enabled: true,
    eventHttp,
    dispatcher,
    privateRenderer
  });
  assert.equal(composition.providerEffects, true);
  assert.equal((await composition.readiness()).ready, true);

  const notReady = createMailRouteDispatchComposition({
    enabled: true,
    eventHttp,
    dispatcher,
    privateRenderer: part({
      kind: "private-notification-mail-renderer",
      mode: "private-resolvers",
      providerEffects: false,
      method: "render",
      ready: false
    })
  });
  assert.deepEqual(await notReady.readiness(), {
    ready: false,
    verified: false,
    kind: "mail-route-dispatch-composition",
    mode: "explicit",
    providerEffects: true,
    code: "FAKE_NOT_READY"
  });
});

test("held or authority-mismatched parts cannot masquerade as enabled composition", () => {
  assert.throws(
    () => createMailRouteDispatchComposition({ enabled: true }),
    (error) => error?.code === "MAIL_ROUTE_DISPATCH_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createMailRouteDispatchComposition({
      enabled: false,
      dispatcher: part({
        kind: "notification-mail-dispatcher",
        mode: "provider-bound-held-wiring",
        providerEffects: true,
        method: "dispatch"
      })
    }),
    (error) => error?.code === "MAIL_ROUTE_DISPATCH_CONFIGURATION_REQUIRED"
  );
});
