import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
  REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS
} from "../../../ops/notification-mail-private-renderer.mjs";
import { notificationMailEvidence } from
  "../notification-mail-dispatcher.mjs";
import { digest } from "../security.mjs";
import {
  createNotificationMailWorkerFactories
} from "../notification-mail-worker-composition.mjs";

const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_ID = "41000000-0000-4000-8000-000000000001";
const NOW = "2026-08-11T16:00:00.000Z";
const RENDERED = Object.freeze({
  to: "customer@example.test",
  subject: "Your support update",
  subjectReference: "support-case:private-reference-0001",
  text: "Your requested support update is available in your account.",
  html: null,
  templateVersion: "support-case-response.v1"
});

function authority() {
  return {
    kind: "canonical-postgres",
    async readiness() { return { ready: true }; }
  };
}

function loop() {
  return {
    intervalMs: 100,
    errorBackoffMs: 100,
    maximumBackoffMs: 800
  };
}

function enabledEnvironment(overrides = {}) {
  return {
    SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE: "approved_live",
    SITESOURCERY_NOTIFICATION_MAIL_RENDERER_MODULE:
      "/etc/sitesourcery/mail/private-renderer.mjs",
    SITESOURCERY_NOTIFICATION_MAIL_RENDERER_SHA256: "a".repeat(64),
    SITESOURCERY_NOTIFICATION_MAIL_PRIVATE_RENDERER_MODE: "reviewed",
    SITESOURCERY_NOTIFICATION_MAIL_TEMPLATE_REGISTRY_SHA256:
      REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT:
      "operator@example.test",
    SITESOURCERY_RESEND_API_KEY: "re_fixture_key_1234567890",
    SITESOURCERY_RESEND_DOMAIN_ID:
      "d91cd9bd-1176-453e-8fc1-35364d380206",
    ...overrides
  };
}

function ready(providerEffects = false) {
  return {
    providerEffects,
    async readiness() { return { ready: true, verified: true }; }
  };
}

test("held mail composition opens neither renderer nor provider", async () => {
  let renderers = 0;
  let providers = 0;
  const factories = createNotificationMailWorkerFactories({
    authority: authority(),
    purposes: ["notification-mail"],
    environment: {},
    async rendererLoader() { renderers += 1; },
    providerFactory() { providers += 1; }
  });
  const composition = await factories["notification-mail"]({ loop: loop() });
  assert.equal((await composition.readiness()).code, "NOTIFICATION_MAIL_WORKER_HELD");
  assert.equal(composition.worker.start(), false);
  assert.equal(renderers, 0);
  assert.equal(providers, 0);
});

test("approved composition dispatches one source through exact private/provider boundaries", async () => {
  const evidence = notificationMailEvidence(RENDERED);
  const calls = [];
  let listed = false;
  const source = {
    ...ready(),
    async listDispatchable({ limit }) {
      calls.push(["list", limit]);
      if (listed) return [];
      listed = true;
      return [MESSAGE_ID];
    },
    async claimForDispatch({ workerId, leaseMs }) {
      calls.push(["claim", workerId, leaseMs]);
      return {
        status: "claimed",
        messageId: MESSAGE_ID,
        messageType: "support_notification",
        recipientDigest: evidence.recipientDigest,
        subjectReferenceDigest: evidence.subjectReferenceDigest,
        contentDigest: evidence.contentDigest,
        templateVersion: RENDERED.templateVersion,
        state: "pending",
        expiresAt: "2026-08-11T16:30:00.000Z",
        sourceKind: "support",
        sourceReservationId: SOURCE_ID,
        sourceReservationDigest: "b".repeat(64),
        workerId,
        attemptNumber: 1,
        fenceToken: 1,
        claimedAt: NOW,
        leaseExpiresAt: "2026-08-11T16:02:00.000Z",
        providerIdempotencyKey:
          `sitesourcery-notification/${MESSAGE_ID}`,
        providerEffects: false
      };
    },
    async completeDispatch(input) {
      calls.push(["complete", input.fenceToken]);
      return {
        status: "closed",
        messageId: MESSAGE_ID,
        lifecycleState: "provider_accepted",
        fenceToken: input.fenceToken,
        providerEffects: false
      };
    }
  };
  const renderer = {
    kind: "private-notification-mail-renderer",
    mode: "private-resolvers",
    redactionPolicy: "no-log-no-arbitrary-content-v1",
    templateRegistrySha256:
      REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
    supportedTemplateVersions: REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
    ...ready(),
    async render() {
      calls.push(["render"]);
      return RENDERED;
    }
  };
  const provider = {
    kind: "notification-mail-provider",
    mode: "production",
    provider: "resend",
    ...ready(true),
    async sendNotification(input) {
      calls.push(["provider", input.idempotencyKey]);
      return {
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: "49f9f02a-93f5-4ddf-9e84-01df500701d4",
        idempotencyKey: input.idempotencyKey,
        payloadDigest: digest(input),
        acceptedAt: NOW
      };
    }
  };
  const repository = {
    ...ready(),
    async reserve() {},
    async recordProviderAcceptance() {
      calls.push(["accept"]);
      return { acceptanceState: "provider_accepted" };
    },
    async ingestProviderEvent() {},
    async expire() {},
    async listOwnerExceptions() {}
  };
  let rendererConfiguration = null;
  const factories = createNotificationMailWorkerFactories({
    authority: authority(),
    purposes: ["notification-mail"],
    environment: enabledEnvironment(),
    clock: { now: () => NOW },
    async rendererLoader(input) {
      rendererConfiguration = input;
      return renderer;
    },
    providerFactory() { return provider; },
    sourceFactory() { return source; },
    lifecycleRepositoryFactory() { return repository; }
  });
  const composition = await factories["notification-mail"]({ loop: loop() });
  assert.equal((await composition.readiness()).ready, true);
  assert.equal(composition.worker.start(), true);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (calls.some(([kind]) => kind === "complete")) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(await composition.worker.stop(), true);
  assert.deepEqual(calls.map(([kind]) => kind).slice(-6), [
    "list", "claim", "render", "provider", "accept", "complete"
  ]);
  assert.deepEqual(rendererConfiguration, {
    modulePath: "/etc/sitesourcery/mail/private-renderer.mjs",
    expectedSha256: "a".repeat(64),
    rendererConfiguration: {
      mode: "reviewed",
      operatorRecipient: "operator@example.test",
      templateRegistrySha256:
        REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256
    },
    authority: rendererConfiguration.authority
  });
  assert.equal(rendererConfiguration.authority.kind, "canonical-postgres");
  assert.equal(
    Object.values(rendererConfiguration).includes(
      enabledEnvironment().SITESOURCERY_RESEND_API_KEY
    ),
    false
  );
  assert.equal(composition.worker.snapshot().lastResult.accepted, 1);
});

test("incomplete or traversing reviewed config fails before renderer or provider construction", async () => {
  for (const environment of [
    enabledEnvironment({
      SITESOURCERY_NOTIFICATION_MAIL_RENDERER_SHA256: "wrong"
    }),
    enabledEnvironment({
      SITESOURCERY_NOTIFICATION_MAIL_RENDERER_MODULE:
        "/etc/sitesourcery/mail/../../tmp/private-renderer.mjs"
    }),
    enabledEnvironment({ SITESOURCERY_RESEND_API_KEY: "not-reviewed" }),
    enabledEnvironment({
      SITESOURCERY_NOTIFICATION_MAIL_PRIVATE_RENDERER_MODE: "held"
    }),
    enabledEnvironment({
      SITESOURCERY_NOTIFICATION_MAIL_TEMPLATE_REGISTRY_SHA256: "b".repeat(64)
    }),
    enabledEnvironment({
      SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT: "Not Canonical"
    })
  ]) {
    let renderers = 0;
    let providers = 0;
    const factories = createNotificationMailWorkerFactories({
      authority: authority(),
      purposes: ["notification-mail"],
      environment,
      async rendererLoader() { renderers += 1; },
      providerFactory() { providers += 1; }
    });
    await assert.rejects(
      factories["notification-mail"]({ loop: loop() }),
      (error) =>
        error?.code === "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID"
    );
    assert.equal(renderers, 0);
    assert.equal(providers, 0);
  }
});

test("worker rejects renderer registry, version allowlist, and redaction drift before provider construction", async () => {
  for (const mutation of [
    { templateRegistrySha256: "b".repeat(64) },
    {
      supportedTemplateVersions: [
        ...REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
        "arbitrary-content.v1"
      ]
    },
    { supportedTemplateVersions: ["support-case-response.v1"] },
    { redactionPolicy: "logs-private-content" }
  ]) {
    let providers = 0;
    const renderer = {
      kind: "private-notification-mail-renderer",
      mode: "private-resolvers",
      providerEffects: false,
      redactionPolicy: "no-log-no-arbitrary-content-v1",
      templateRegistrySha256:
        REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256,
      supportedTemplateVersions:
        REVIEWED_NOTIFICATION_TEMPLATE_VERSIONS,
      ...ready(),
      async render() { return RENDERED; },
      ...mutation
    };
    const factories = createNotificationMailWorkerFactories({
      authority: authority(),
      purposes: ["notification-mail"],
      environment: enabledEnvironment(),
      async rendererLoader() { return renderer; },
      providerFactory() { providers += 1; }
    });
    await assert.rejects(
      factories["notification-mail"]({ loop: loop() }),
      (error) =>
        error?.code === "NOTIFICATION_MAIL_WORKER_CONFIGURATION_INVALID"
    );
    assert.equal(providers, 0);
  }
});
