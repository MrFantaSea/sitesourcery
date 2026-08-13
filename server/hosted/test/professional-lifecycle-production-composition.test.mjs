import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA,
  createProfessionalLifecycleProductionComposition,
  isExactProfessionalLifecycleReadiness
} from "../professional-lifecycle-production-composition.mjs";

const NOW = "2026-08-10T20:00:00.000Z";

function authority({ notificationsReady = true } = {}) {
  const contexts = [];
  return Object.freeze({
    contexts,
    port: Object.freeze({
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(text) {
            if (text.includes("hosted_runtime_contract_v108")) {
              return { rows: [{
                contract_ready: true,
                direct_normalization_ready: true,
                tables_ready: true,
                rls_ready: true,
                grants_ready: true
              }] };
            }
            if (text.includes("hosted_commerce_notification_contract_v1")) {
              return { rows: [{
                contract_ready: notificationsReady,
                sources_ready: true,
                rls_ready: true,
                mail_types_ready: true
              }] };
            }
            if (text.includes("hosted_operator_work_queue_contract_v1")) {
              return { rows: [{
                contract_ready: true,
                resolution_contract_ready: true,
                tables_ready: true,
                rls_ready: true
              }] };
            }
            if (text.includes("hosted_accounting_purpose_journal_contract_v1")) {
              return { rows: [{
                contract_ready: true,
                rls_ready: true,
                direct_mutation_denied: true
              }] };
            }
            throw new Error("unexpected readiness query");
          }
        });
      }
    })
  });
}

function compose(options = {}) {
  const database = authority(options);
  const composition =
    createProfessionalLifecycleProductionComposition({
      authority: database.port,
      provider: {
        async retrieveProfessionalReversal() {
          throw new Error("not reached");
        }
      },
      engagementBootstrap: {
        async readiness() {
          return { state: "ready", providerEffects: false };
        }
      },
      mailLifecycle: {
        async readiness() {
          return {
            ready: true,
            verified: true,
            kind: "durable-mail-lifecycle-postgres",
            providerEffects: false
          };
        }
      },
      clock: { now: () => NOW },
      ids: {
        next() {
          return "00000000-0000-4000-8000-000000000001";
        }
      }
    });
  return { composition, database };
}

test("production composition binds all six held lifecycle boundaries", async () => {
  const { composition, database } = compose();
  assert.deepEqual(
    [
      composition.kind,
      composition.mode,
      composition.notificationDelivery,
      composition.providerEffects,
      composition.automaticRestoration,
      composition.genericRepair,
      composition.authoritativeAccounting
    ],
    [
      "professional-lifecycle-production",
      "held",
      "reserved_only",
      false,
      false,
      false,
      false
    ]
  );
  assert.equal(
    typeof composition.engagementBootstrap.issueInvitation,
    "undefined"
  );
  assert.equal(
    typeof composition.professionalReversal.recordEvidence,
    "function"
  );
  assert.equal(
    typeof composition.professionalReversal.ingestStripeEvent,
    "function"
  );
  assert.equal(
    typeof composition.commerceNotifications.reserve,
    "function"
  );
  assert.equal(typeof composition.mailLifecycle.readiness, "function");
  assert.equal(
    typeof composition.operatorQueue.dispatchProfessionalReversalRepair,
    "function"
  );
  assert.equal("markPaid" in composition.operatorQueue, false);
  assert.equal("complete" in composition.operatorQueue, false);
  assert.equal("delete" in composition.operatorQueue, false);
  assert.equal(
    typeof composition.accountingJournal.synchronize,
    "function"
  );

  const readiness = await composition.readiness();
  assert.equal(readiness.schema, PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA);
  assert.equal(isExactProfessionalLifecycleReadiness(readiness), true);
  assert.deepEqual(readiness, {
    schema: PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA,
    ready: true,
    mode: "held",
    engagement: "ready",
    professionalReversal: "ready_monotonic_direct_held",
    notifications: "mail_reserved_held",
    mail: "reservation_ready",
    operatorQueue: "bounded_reversal_repair_only",
    accounting: "projection_only",
    sourceAuthoritative: true,
    providerEffects: false,
    automaticRestoration: false,
    genericRepair: false,
    authoritativeAccounting: false,
    code: "READY"
  });
  assert.equal(database.contexts.length, 4);
  assert.equal(
    database.contexts.every((context) =>
      context.actorKind === "system" && context.readOnly === true
    ),
    true
  );
});

test("one missing source contract fails closed with fixed PII-free readiness", async () => {
  const { composition } = compose({ notificationsReady: false });
  const readiness = await composition.readiness();
  assert.deepEqual(readiness, {
    schema: PROFESSIONAL_LIFECYCLE_READINESS_SCHEMA,
    ready: false,
    mode: "held",
    engagement: "ready",
    professionalReversal: "ready_monotonic_direct_held",
    notifications: "not_ready",
    mail: "reservation_ready",
    operatorQueue: "bounded_reversal_repair_only",
    accounting: "projection_only",
    sourceAuthoritative: true,
    providerEffects: false,
    automaticRestoration: false,
    genericRepair: false,
    authoritativeAccounting: false,
    code: "COMMERCE_NOTIFICATIONS_NOT_READY"
  });
  assert.equal(isExactProfessionalLifecycleReadiness(readiness), false);
  assert.equal(
    isExactProfessionalLifecycleReadiness({
      ...readiness,
      ready: true,
      notifications: "mail_reserved_held",
      code: "READY",
      provider: "stripe"
    }),
    false
  );
});

test("production root gates every professional payment and adds no delivery or provider hook", async () => {
  const [root, composition] = await Promise.all([
    readFile(new URL("../bin/server.mjs", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../professional-lifecycle-production-composition.mjs",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  assert.match(root, /createProfessionalLifecycleProductionComposition/u);
  assert.match(
    root,
    /createProfessionalLifecycleProductionComposition\(\{[\s\S]*?provider:\s*stripeComposition[.]adapter/u
  );
  assert.match(
    root,
    /professionalReversal:\s*professionalLifecycle[.]professionalReversal/u
  );
  for (const assertion of [
    "assertApprovedCustomServicesAssessmentPaymentReady",
    "assertApprovedCustomBuildPaymentReady",
    "assertApprovedCustomBuildChangePaymentReady",
    "assertApprovedCustomBuildFinalPaymentReady"
  ]) {
    assert.match(
      root,
      new RegExp(
        `${assertion}\\([\\s\\S]*?professionalLifecycleReadiness\\s*\\)`,
        "u"
      )
    );
  }
  assert.doesNotMatch(
    composition,
    /resend|verifyWebhook|createCheckout|refunds[.]create|markPaid/iu
  );
  assert.match(composition, /notificationDelivery: "reserved_only"/u);
  assert.match(composition, /automaticRestoration: false/u);
  assert.match(composition, /authoritativeAccounting: false/u);
});
