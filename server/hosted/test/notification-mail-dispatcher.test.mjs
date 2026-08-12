import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldNotificationMailDispatcher,
  createNotificationMailDispatcher,
  notificationMailEvidence
} from "../notification-mail-dispatcher.mjs";
import { digest } from "../security.mjs";

const NOW = "2026-08-11T16:00:00.000Z";
const EXPIRES = "2026-08-11T16:30:00.000Z";
const CLOCK = { now: () => NOW };
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const SOURCE_ID = "41000000-0000-4000-8000-000000000001";
const WORKER_ID = "mail-worker-00000001";
const PROVIDER_ID = "49f9f02a-93f5-4ddf-9e84-01df500701d4";
const RENDERED = Object.freeze({
  to: "customer@example.test",
  subject: "Your Site Sourcery update",
  subjectReference: "case:40000000-0000-4000-8000-000000000009",
  text: "A durable update is ready in your account.",
  html: null,
  templateVersion: "support-update.v1"
});

function fixture({
  messageType = "support_notification",
  state = "pending",
  expiresAt = EXPIRES,
  rendered = RENDERED,
  providerReady = true,
  providerReceipt = null,
  providerError = null,
  clock = CLOCK
} = {}) {
  const evidence = notificationMailEvidence(RENDERED);
  const calls = [];
  const ready = (providerEffects, code = null) => ({
    providerEffects,
    async readiness() {
      return { ready: code === null, verified: code === null, code };
    }
  });
  const source = {
    ...ready(false),
    async claimForDispatch(input) {
      calls.push(["claim", input]);
      if (state !== "pending") {
        return {
          status: "already_recorded",
          messageId: MESSAGE_ID,
          lifecycleState: state,
          providerEffects: false
        };
      }
      if (Date.parse(expiresAt) <= Date.parse(NOW) + input.leaseMs) {
        return {
          status: "expired",
          messageId: MESSAGE_ID,
          lifecycleState: "pending",
          providerEffects: false
        };
      }
      return {
        status: "claimed",
        messageId: MESSAGE_ID,
        messageType,
        recipientDigest: evidence.recipientDigest,
        subjectReferenceDigest: evidence.subjectReferenceDigest,
        contentDigest: evidence.contentDigest,
        templateVersion: RENDERED.templateVersion,
        state,
        expiresAt,
        sourceKind: messageType === "support_notification"
          ? "support"
          : "commerce",
        sourceReservationId: SOURCE_ID,
        sourceReservationDigest: "b".repeat(64),
        workerId: input.workerId,
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
      calls.push(["complete", input]);
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
    ...ready(false),
    async render(input) {
      calls.push(["render", input]);
      return rendered;
    }
  };
  const providerPort = {
    ...ready(true, providerReady ? null : "FAKE_PROVIDER_HELD"),
    async sendNotification(input) {
      calls.push(["provider", input]);
      if (providerError) throw providerError;
      return providerReceipt ?? {
        state: "provider_accepted",
        provider: "resend",
        providerMessageId: PROVIDER_ID,
        idempotencyKey: input.idempotencyKey,
        payloadDigest: digest(input),
        acceptedAt: NOW
      };
    }
  };
  const lifecycle = {
    ...ready(false),
    async recordProviderAcceptance(input) {
      calls.push(["accept", input]);
      return { acceptanceState: "provider_accepted" };
    }
  };
  return {
    calls,
    dispatcher: createNotificationMailDispatcher({
      source,
      renderer,
      providerPort,
      lifecycle,
      clock
    })
  };
}

test("held dispatcher is the default no-effect boundary", async () => {
  const dispatcher = createHeldNotificationMailDispatcher();
  assert.equal(dispatcher.providerEffects, false);
  assert.equal((await dispatcher.readiness()).ready, false);
  await assert.rejects(
    dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
    (error) => error?.code === "NOTIFICATION_MAIL_DISPATCH_HELD" &&
      error?.details?.providerEffects === false
  );
});

test("support and commerce reservations share one evidence-bound dispatcher", async () => {
  for (const messageType of [
    "support_notification",
    "commerce_customer_notification",
    "commerce_operator_notification"
  ]) {
    const { dispatcher, calls } = fixture({ messageType });
    assert.equal((await dispatcher.readiness()).ready, true);
    const receipt = await dispatcher.dispatch({
      messageId: MESSAGE_ID,
      workerId: WORKER_ID
    });
    assert.equal(receipt.dispatchState, "provider_accepted");
    assert.equal(receipt.lifecycleState, "provider_accepted");
    assert.equal(receipt.provider, "resend");
    assert.equal(receipt.providerEffects, true);
    assert.match(receipt.providerMessageIdDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(calls.map(([kind]) => kind), [
      "claim", "render", "provider", "accept", "complete"
    ]);
    const sent = calls[2][1];
    assert.equal(sent.messageType, messageType);
    assert.equal(
      sent.idempotencyKey,
      `sitesourcery-notification/${MESSAGE_ID}`
    );
    const accepted = calls[3][1];
    assert.equal(accepted.messageId, MESSAGE_ID);
    assert.equal(accepted.provider, "resend");
    assert.equal(accepted.providerMessageIdDigest, digest(PROVIDER_ID));
    assert.equal("providerMessageId" in accepted, false);
    assert.equal(JSON.stringify(receipt).includes(PROVIDER_ID), false);
    assert.equal(JSON.stringify(receipt).includes(RENDERED.to), false);
    assert.equal(JSON.stringify(receipt).includes(RENDERED.text), false);
  }
});

test("terminal reservations never render or call a provider", async () => {
  for (const state of [
    "provider_accepted",
    "delivered",
    "bounced",
    "complained",
    "suppressed",
    "expired"
  ]) {
    const { dispatcher, calls } = fixture({ state });
    const receipt = await dispatcher.dispatch({
      messageId: MESSAGE_ID,
      workerId: WORKER_ID
    });
    assert.equal(receipt.dispatchState, "already_recorded");
    assert.equal(receipt.lifecycleState, state);
    assert.equal(receipt.providerEffects, false);
    assert.deepEqual(calls.map(([kind]) => kind), ["claim"]);
  }
});

test("recipient, subject-reference, content, and template drift stop before provider effect", async () => {
  const mutations = [
    { ...RENDERED, to: "other@example.test" },
    { ...RENDERED, subjectReference: "case:other-reference" },
    { ...RENDERED, text: "Changed private content." },
    { ...RENDERED, templateVersion: "support-update.v2" }
  ];
  for (const rendered of mutations) {
    const { dispatcher, calls } = fixture({ rendered });
    await assert.rejects(
      dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
      (error) => error?.code === "NOTIFICATION_MAIL_EVIDENCE_CONFLICT" &&
        error?.details?.providerEffects === false
    );
    assert.deepEqual(calls.map(([kind]) => kind), ["claim", "render"]);
  }
});

test("expired, wrong-purpose, and unavailable boundaries fail closed", async () => {
  {
    const { dispatcher, calls } = fixture({ expiresAt: NOW });
    const receipt = await dispatcher.dispatch({
      messageId: MESSAGE_ID,
      workerId: WORKER_ID
    });
    assert.equal(receipt.dispatchState, "expired");
    assert.deepEqual(calls.map(([kind]) => kind), ["claim"]);
  }
  {
    const { dispatcher, calls } = fixture({ messageType: "account_recovery" });
    await assert.rejects(
      dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
      (error) => error?.code === "NOTIFICATION_MAIL_INVALID"
    );
    assert.deepEqual(calls.map(([kind]) => kind), ["claim"]);
  }
  {
    const { dispatcher, calls } = fixture({ providerReady: false });
    await assert.rejects(
      dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
      (error) => error?.code === "NOTIFICATION_MAIL_DISPATCH_NOT_READY" &&
        error?.details?.providerEffects === false
    );
    assert.deepEqual(calls, []);
  }
});

test("malformed provider acceptance cannot be promoted to durable acceptance", async () => {
  const { dispatcher, calls } = fixture({
    providerReceipt: {
      state: "delivered",
      provider: "resend",
      providerMessageId: PROVIDER_ID,
      idempotencyKey: `sitesourcery-notification/${MESSAGE_ID}`,
      payloadDigest: "a".repeat(64),
      acceptedAt: NOW
    }
  });
  await assert.rejects(
    dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
    (error) => error?.code === "NOTIFICATION_MAIL_PROVIDER_INVALID"
  );
  assert.deepEqual(calls.map(([kind]) => kind), [
    "claim", "render", "provider"
  ]);
});

test("provider payload evidence must bind the exact rendered dispatch", async () => {
  const { dispatcher, calls } = fixture({
    providerReceipt: {
      state: "provider_accepted",
      provider: "resend",
      providerMessageId: PROVIDER_ID,
      idempotencyKey: `sitesourcery-notification/${MESSAGE_ID}`,
      payloadDigest: "a".repeat(64),
      acceptedAt: NOW
    }
  });
  await assert.rejects(
    dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
    (error) => error?.code === "NOTIFICATION_MAIL_PROVIDER_INVALID"
  );
  assert.deepEqual(calls.map(([kind]) => kind), [
    "claim", "render", "provider"
  ]);
});

test("provider errors are sanitized and retain the stable retry instruction", async () => {
  const unsafe = new Error(
    `provider leaked ${RENDERED.to} and ${RENDERED.text}`
  );
  const { dispatcher, calls } = fixture({ providerError: unsafe });
  await assert.rejects(
    dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
    (error) =>
      error?.code === "NOTIFICATION_MAIL_PROVIDER_UNAVAILABLE" &&
      error?.details?.providerEffects === "unknown" &&
      error?.details?.retryWithSameIdempotencyKey === true &&
      !error?.message.includes(RENDERED.to) &&
      !error?.message.includes(RENDERED.text) &&
      !JSON.stringify(error).includes(RENDERED.to) &&
      !JSON.stringify(error).includes(RENDERED.text)
  );
  assert.equal(
    calls.find(([kind]) => kind === "provider")[1].idempotencyKey,
    `sitesourcery-notification/${MESSAGE_ID}`
  );
  assert.equal(calls.some(([kind]) => kind === "accept"), false);
});

test("an expired fence stops after rendering and before provider access", async () => {
  const times = [NOW, "2026-08-11T16:02:00.000Z"];
  const { dispatcher, calls } = fixture({
    clock: { now: () => times.shift() ?? times.at(-1) }
  });
  await assert.rejects(
    dispatcher.dispatch({ messageId: MESSAGE_ID, workerId: WORKER_ID }),
    (error) => error?.code === "NOTIFICATION_MAIL_LEASE_EXPIRED" &&
      error?.details?.providerEffects === false
  );
  assert.deepEqual(calls.map(([kind]) => kind), ["claim", "render"]);
});

test("constructor rejects boundaries with mismatched effect authority", () => {
  assert.throws(
    () => createNotificationMailDispatcher({
      source: {
        providerEffects: true,
        readiness() {},
        claimForDispatch() {},
        completeDispatch() {}
      },
      renderer: {},
      providerPort: {},
      lifecycle: {},
      clock: CLOCK
    }),
    (error) => error?.code === "NOTIFICATION_MAIL_CONFIGURATION_REQUIRED"
  );
});
