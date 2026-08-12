import assert from "node:assert/strict";
import test from "node:test";

import { notificationMailEvidence } from
  "../notification-mail-dispatcher.mjs";
import {
  createHeldNotificationRecipientResolver,
  createHeldNotificationTemplateRegistry,
  createHeldPrivateNotificationMailRenderer,
  createPrivateNotificationMailRenderer
} from "../notification-mail-private-resolver.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_ID = "41000000-0000-4000-8000-000000000001";
const RENDERED = Object.freeze({
  to: "customer@example.test",
  subject: "Your requested support update",
  subjectReference: "support-case:private-reference-0001",
  text: "The requested support update is available in your account.",
  html: null,
  templateVersion: "support-update.v1"
});

function readyPort(method, implementation) {
  return {
    providerEffects: false,
    async readiness() { return { ready: true, verified: true }; },
    async [method](input) { return implementation(input); }
  };
}

function renderInput(overrides = {}) {
  const evidence = notificationMailEvidence(RENDERED);
  return {
    messageId: MESSAGE_ID,
    messageType: "support_notification",
    recipientDigest: evidence.recipientDigest,
    subjectReferenceDigest: evidence.subjectReferenceDigest,
    contentDigest: evidence.contentDigest,
    templateVersion: RENDERED.templateVersion,
    sourceKind: "support",
    sourceReservationId: SOURCE_ID,
    sourceReservationDigest: "a".repeat(64),
    observedAt: NOW,
    ...overrides
  };
}

test("private recipient and template interfaces are independently held", async () => {
  for (const [boundary, method, code] of [
    [
      createHeldNotificationRecipientResolver(),
      "resolve",
      "NOTIFICATION_RECIPIENT_RESOLUTION_HELD"
    ],
    [
      createHeldNotificationTemplateRegistry(),
      "render",
      "NOTIFICATION_TEMPLATE_REGISTRY_HELD"
    ],
    [
      createHeldPrivateNotificationMailRenderer(),
      "render",
      "NOTIFICATION_PRIVATE_RENDERER_HELD"
    ]
  ]) {
    assert.equal(boundary.providerEffects, false);
    assert.equal((await boundary.readiness()).ready, false);
    await assert.rejects(
      boundary[method]({}),
      (error) => error?.code === code &&
        error?.details?.providerEffects === false
    );
  }
});

test("private renderer resolves exact recipient and template behind digest boundaries", async () => {
  const calls = [];
  const renderer = createPrivateNotificationMailRenderer({
    recipientResolver: readyPort("resolve", (input) => {
      calls.push(["recipient", input]);
      return {
        to: RENDERED.to,
        recipientDigest: input.recipientDigest
      };
    }),
    templateRegistry: readyPort("render", (input) => {
      calls.push(["template", input]);
      return {
        subject: RENDERED.subject,
        subjectReference: RENDERED.subjectReference,
        text: RENDERED.text,
        html: RENDERED.html,
        templateVersion: input.templateVersion
      };
    })
  });
  assert.equal((await renderer.readiness()).ready, true);
  assert.deepEqual(await renderer.render(renderInput()), RENDERED);
  assert.deepEqual(calls.map(([kind]) => kind).sort(), [
    "recipient", "template"
  ]);
  assert.equal("contentDigest" in calls[0][1], false);
  assert.equal("subjectReferenceDigest" in calls[0][1], false);
});

test("recipient, template, and rendered evidence drift fail before dispatch", async () => {
  for (const mutation of [
    { recipientDigest: "b".repeat(64) },
    { to: "other@example.test" },
    { text: "Changed private content." },
    { templateVersion: "support-update.v2" }
  ]) {
    const renderer = createPrivateNotificationMailRenderer({
      recipientResolver: readyPort("resolve", (input) => ({
        to: mutation.to ?? RENDERED.to,
        recipientDigest: mutation.recipientDigest ?? input.recipientDigest
      })),
      templateRegistry: readyPort("render", (input) => ({
        subject: RENDERED.subject,
        subjectReference: RENDERED.subjectReference,
        text: mutation.text ?? RENDERED.text,
        html: null,
        templateVersion: mutation.templateVersion ?? input.templateVersion
      }))
    });
    await assert.rejects(
      renderer.render(renderInput()),
      (error) => error?.code === "NOTIFICATION_PRIVATE_RESOLUTION_CONFLICT" &&
        error?.details?.providerEffects === false
    );
  }
});

test("private renderer refuses effectful or incomplete resolver authority", () => {
  assert.throws(
    () => createPrivateNotificationMailRenderer({
      recipientResolver: {
        providerEffects: true,
        readiness() {},
        resolve() {}
      },
      templateRegistry: createHeldNotificationTemplateRegistry()
    }),
    (error) =>
      error?.code === "NOTIFICATION_PRIVATE_RESOLUTION_CONFIGURATION_REQUIRED"
  );
});
