import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldResendMailEventHttpAdapter,
  createResendMailEventHttpAdapter,
  RESEND_MAIL_EVENT_PATH
} from "../resend-mail-events-http.mjs";

const RAW = Buffer.from('{"signed":"exact bytes"}', "utf8");

function webhook(receipt) {
  const calls = [];
  return {
    calls,
    mode: "verified-held-ingress",
    providerEffects: false,
    async readiness() { return { ready: true, verified: true }; },
    async ingest(input) {
      calls.push(input);
      return receipt;
    }
  };
}

function durableReceipt(overrides = {}) {
  return {
    schema: "sitesourcery.resend-mail-event-receipt/v1",
    httpStatus: 200,
    eventState: "applied",
    eventKind: "complained",
    currentState: "complained",
    providerEffects: false,
    ...overrides
  };
}

test("raw-body adapter returns 200 only after an explicit durable receipt", async () => {
  for (const eventState of ["applied", "pending", "conflict"]) {
    const ingress = webhook(durableReceipt({ eventState }));
    const adapter = createResendMailEventHttpAdapter({ webhook: ingress });
    const headers = { "svix-id": "mail_event_0001" };
    const response = await adapter.handle({
      method: "POST",
      pathname: RESEND_MAIL_EVENT_PATH,
      headers,
      rawBody: RAW
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.received, true);
    assert.equal(response.body.eventState, eventState);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(ingress.calls[0].rawBody, RAW);
    assert.equal(ingress.calls[0].headers, headers);
  }
});

test("adapter withholds HTTP success for invalid or nondurable ingress output", async () => {
  for (const receipt of [
    durableReceipt({ httpStatus: 202 }),
    durableReceipt({ eventState: "ignored" }),
    durableReceipt({ eventKind: "sent" }),
    { accepted: true }
  ]) {
    const adapter = createResendMailEventHttpAdapter({
      webhook: webhook(receipt)
    });
    await assert.rejects(
      adapter.handle({
        method: "POST",
        pathname: RESEND_MAIL_EVENT_PATH,
        headers: {},
        rawBody: RAW
      }),
      (error) => [
        "RESEND_WEBHOOK_HTTP_INVALID",
        "RESEND_WEBHOOK_HTTP_DURABILITY_REQUIRED"
      ].includes(error?.code)
    );
  }
});

test("route and raw-byte shape reject parsed/re-serialized bodies", async () => {
  const ingress = webhook(durableReceipt());
  const adapter = createResendMailEventHttpAdapter({ webhook: ingress });
  for (const input of [
    {
      method: "GET",
      pathname: RESEND_MAIL_EVENT_PATH,
      headers: {},
      rawBody: RAW
    },
    {
      method: "POST",
      pathname: "/api/v1/webhooks/resend/other",
      headers: {},
      rawBody: RAW
    },
    {
      method: "POST",
      pathname: RESEND_MAIL_EVENT_PATH,
      headers: {},
      rawBody: { signed: "parsed" }
    }
  ]) {
    await assert.rejects(
      adapter.handle(input),
      (error) => error?.code === "RESEND_WEBHOOK_HTTP_INVALID"
    );
  }
  assert.equal(ingress.calls.length, 0);
});

test("held HTTP adapter cannot acknowledge any event", async () => {
  const adapter = createHeldResendMailEventHttpAdapter();
  assert.equal(adapter.mode, "held");
  assert.equal((await adapter.readiness()).ready, false);
  await assert.rejects(
    adapter.handle({
      method: "POST",
      pathname: RESEND_MAIL_EVENT_PATH,
      headers: {},
      rawBody: RAW
    }),
    (error) => error?.code === "RESEND_WEBHOOK_HELD"
  );
});
