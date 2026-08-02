import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERT_DELIVERY_PROOF_CODE,
  ALERT_DELIVERY_PROOF_SCHEMA,
  runAlertDeliveryProof
} from "../prove-alert-delivery.mjs";

const NOW = new Date(
  "2026-08-02T14:00:00.000Z"
);
const ENVIRONMENT = Object.freeze({
  SITESOURCERY_ALERT_PROOF_MODE: "approved",
  SITESOURCERY_ALERT_MODE: "reviewed_resend",
  SITESOURCERY_ALERT_STATE_FILE:
    "/private/state/monitor/current.json",
  SITESOURCERY_ALERT_PROOF_STATE_FILE:
    "/private/state/proof/current.json",
  SITESOURCERY_STRIPE_MODE: "held",
  SITESOURCERY_REGISTRATION_MAIL_MODE: "held",
  SITESOURCERY_RECOVERY_MAIL_MODE: "held",
  SITESOURCERY_EXPECT_PUBLICATION: "held",
  SITESOURCERY_EXPECT_DOMAIN_RUNTIME: "held",
  SITESOURCERY_EXPECT_DNS: "held",
  SITESOURCERY_OPERATIONS_PROVIDER_EGRESS:
    "held",
  SITESOURCERY_SOURCE_FAILURE_DOMAIN:
    "primary-01"
});

function fakeFactory(captured) {
  return async (environment) => {
    captured.environment = environment;
    return {
      async reconcile(report) {
        captured.report = report;
        const incident = report.alerts.length > 0;
        return {
          attempted: true,
          delivered: true,
          transition: incident
            ? "incident"
            : "recovery",
          transitionId: "a".repeat(64),
          provider: "test-provider",
          providerMessageId: "message-001"
        };
      }
    };
  };
}

test("delivery proof emits one clearly labeled incident through isolated state", async () => {
  const captured = {};
  const result = await runAlertDeliveryProof({
    action: "incident",
    environment: ENVIRONMENT,
    now: () => new Date(NOW),
    createAlertAdapter: fakeFactory(captured)
  });
  assert.equal(
    captured.environment
      .SITESOURCERY_ALERT_STATE_FILE,
    ENVIRONMENT
      .SITESOURCERY_ALERT_PROOF_STATE_FILE
  );
  assert.equal(
    captured.report.sourceOperations.mode,
    "default_held"
  );
  assert.equal(captured.report.ok, false);
  assert.deepEqual(captured.report.alerts, [
    {
      code: ALERT_DELIVERY_PROOF_CODE,
      severity: "warning",
      summary:
        "TEST ONLY - Site Sourcery alert delivery proof. Production remained healthy."
    }
  ]);
  assert.deepEqual(result, {
    schema: ALERT_DELIVERY_PROOF_SCHEMA,
    testOnly: true,
    action: "incident",
    observedAt: NOW.toISOString(),
    delivery: {
      attempted: true,
      delivered: true,
      transition: "incident",
      transitionId: "a".repeat(64),
      provider: "test-provider",
      providerMessageId: "message-001"
    }
  });
});

test("delivery proof emits recovery with no alert content", async () => {
  const captured = {};
  const result = await runAlertDeliveryProof({
    action: "recovery",
    environment: ENVIRONMENT,
    now: () => new Date(NOW),
    createAlertAdapter: fakeFactory(captured)
  });
  assert.equal(captured.report.ok, true);
  assert.deepEqual(captured.report.alerts, []);
  assert.deepEqual(captured.report.checks, [
    {
      name: "alert_delivery_proof",
      ok: true,
      code: null
    }
  ]);
  assert.equal(result.action, "recovery");
  assert.equal(
    result.delivery.transition,
    "recovery"
  );
});

test("delivery proof fails closed without approval or state isolation", async () => {
  await assert.rejects(
    runAlertDeliveryProof({
      action: "incident",
      environment: {
        ...ENVIRONMENT,
        SITESOURCERY_ALERT_PROOF_MODE: "held"
      },
      createAlertAdapter: fakeFactory({})
    }),
    /not explicitly approved/u
  );
  await assert.rejects(
    runAlertDeliveryProof({
      action: "incident",
      environment: {
        ...ENVIRONMENT,
        SITESOURCERY_ALERT_PROOF_STATE_FILE:
          ENVIRONMENT.SITESOURCERY_ALERT_STATE_FILE
      },
      createAlertAdapter: fakeFactory({})
    }),
    /must be isolated/u
  );
  await assert.rejects(
    runAlertDeliveryProof({
      action: "cycle",
      environment: ENVIRONMENT,
      createAlertAdapter: fakeFactory({})
    }),
    /must be incident or recovery/u
  );
});
