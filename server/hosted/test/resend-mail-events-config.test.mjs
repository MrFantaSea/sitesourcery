import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEND_WEBHOOK_MODE_ENVIRONMENT,
  RESEND_WEBHOOK_SECRET_ENVIRONMENT,
  createConfiguredResendMailEventHttp
} from "../resend-mail-events-config.mjs";

const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;

function lifecycle() {
  return {
    providerEffects: false,
    async readiness() { return { ready: true, verified: true }; },
    async ingestProviderEvent() {
      throw new Error("not reached");
    }
  };
}

test("Resend event HTTP composition is held by default without secret access", async () => {
  const configured = createConfiguredResendMailEventHttp({
    environment: {}
  });
  assert.equal(configured.mode, "held");
  assert.equal(configured.providerEffects, false);
  assert.equal((await configured.readiness()).ready, false);
});

test("verified event ingress requires the exact mode, secret, and lifecycle", async () => {
  const configured = createConfiguredResendMailEventHttp({
    environment: {
      [RESEND_WEBHOOK_MODE_ENVIRONMENT]: "verified",
      [RESEND_WEBHOOK_SECRET_ENVIRONMENT]: SECRET
    },
    lifecycle: lifecycle()
  });
  assert.equal(configured.mode, "raw-body");
  assert.deepEqual(await configured.readiness(), {
    ready: true,
    verified: true,
    kind: "resend-mail-event-webhook",
    mode: "verified-held-ingress",
    providerEffects: false,
    code: null
  });
  for (const environment of [
    { [RESEND_WEBHOOK_MODE_ENVIRONMENT]: "enabled" },
    { [RESEND_WEBHOOK_MODE_ENVIRONMENT]: "verified" },
    { [RESEND_WEBHOOK_SECRET_ENVIRONMENT]: SECRET }
  ]) {
    assert.throws(
      () => createConfiguredResendMailEventHttp({
        environment,
        lifecycle: lifecycle()
      }),
      (error) => error?.code === "RESEND_WEBHOOK_CONFIGURATION_REQUIRED"
    );
  }
});
