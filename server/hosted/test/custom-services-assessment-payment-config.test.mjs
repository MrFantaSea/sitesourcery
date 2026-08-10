import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedCustomServicesAssessmentPaymentReady,
  createConfiguredCustomServicesAssessmentPaymentRelease
} from "../custom-services-assessment-payment-config.mjs";
import {
  createPostgresCustomServicesAssessmentPayment
} from "../custom-services-assessment-payment-postgres.mjs";
import {
  PROFESSIONAL_LIFECYCLE_READY
} from "./professional-lifecycle-readiness-fixture.mjs";

const PAYMENT_SCOPE = Object.freeze({
  actorId: "20000000-0000-4000-8000-000000000001",
  commandId: "assessment-checkout-command-1",
  customerId: "20000000-0000-4000-8000-000000000001",
  invoiceDigest: "d".repeat(64),
  invoiceId: "60000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  projectId: "30000000-0000-4000-8000-000000000001"
});

test("assessment payment defaults held behind one exact release", () => {
  const held =
    createConfiguredCustomServicesAssessmentPaymentRelease({
      environment: {}
    });
  assert.deepEqual(held, {
    mode: "held",
    release: {
      approved: false,
      amountMinor: 20000,
      currency: "USD",
      taxMode: "disabled_by_owner"
    }
  });
  assert.throws(
    () =>
      createConfiguredCustomServicesAssessmentPaymentRelease({
        environment: {
          SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE:
            "true"
        }
      }),
    (error) =>
      error.code ===
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE_INVALID"
  );
});

test("approved assessment payment requires its exact purpose tax authority and settlement", () => {
  const approved =
    createConfiguredCustomServicesAssessmentPaymentRelease({
      environment: {
        SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE:
          "approved"
      }
    });
  for (const readiness of [
    {
      ready: false,
      taxModes: { serviceAssessment: "disabled_by_owner" }
    },
    { ready: true, taxModes: { serviceAssessment: "automatic" } },
    { ready: true }
  ]) {
    assert.throws(
      () =>
        assertApprovedCustomServicesAssessmentPaymentReady(
          approved,
          readiness
        ),
      (error) =>
        error.code ===
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_NOT_READY"
    );
  }
  assert.throws(
    () =>
      assertApprovedCustomServicesAssessmentPaymentReady(
        approved,
        {
          ready: true,
          taxModes: { serviceAssessment: "disabled_by_owner" }
        }
      ),
    (error) =>
      error.code ===
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_NOT_READY"
  );
  assert.deepEqual(
    assertApprovedCustomServicesAssessmentPaymentReady(
      approved,
      {
        ready: true,
        taxModes: { serviceAssessment: "disabled_by_owner" }
      },
      {
        schema:
          "sitesourcery.custom-services-assessment-settlement-readiness/v1",
        ready: true,
        webhookWakeup: true,
        stripeReadback: true,
        atomicSettlement: true
      },
      PROFESSIONAL_LIFECYCLE_READY
    ),
    {
      ready: true,
      taxModes: { serviceAssessment: "disabled_by_owner" }
    }
  );
  assert.throws(
    () =>
      assertApprovedCustomServicesAssessmentPaymentReady(
        approved,
        {
          ready: true,
          taxModes: { serviceAssessment: "disabled_by_owner" }
        },
        {
          schema:
            "sitesourcery.custom-services-assessment-settlement-readiness/v1",
          ready: true,
          webhookWakeup: true,
          stripeReadback: true,
          atomicSettlement: true
        },
        {
          ...PROFESSIONAL_LIFECYCLE_READY,
          notifications: "delivered"
        }
      ),
    (error) =>
      error.code ===
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_NOT_READY"
  );
  assert.doesNotThrow(() =>
    assertApprovedCustomServicesAssessmentPaymentReady(
      createConfiguredCustomServicesAssessmentPaymentRelease({
        environment: {}
      }),
      { ready: false, taxModes: {} }
    )
  );
});

test("held assessment release stops before PostgreSQL or Stripe", async () => {
  let databaseCalls = 0;
  let providerCalls = 0;
  const service =
    createPostgresCustomServicesAssessmentPayment({
      authority: {
        async service() {
          databaseCalls += 1;
          throw new Error("database must remain untouched");
        }
      },
      provider: {
        async createServiceAssessmentCheckout() {
          providerCalls += 1;
          throw new Error("provider must remain untouched");
        }
      },
      release:
        createConfiguredCustomServicesAssessmentPaymentRelease({
          environment: {}
        }).release
    });
  assert.deepEqual(await service.readiness(), {
    ready: false,
    checkout: false,
    state: "held"
  });
  await assert.rejects(
    service.createCheckout(PAYMENT_SCOPE),
    (error) =>
      error.code ===
        "CUSTOM_SERVICES_ASSESSMENT_PAYMENT_HELD"
  );
  assert.equal(databaseCalls, 0);
  assert.equal(providerCalls, 0);
});
