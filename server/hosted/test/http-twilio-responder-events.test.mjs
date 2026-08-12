import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import {
  createTwilioResponderEventsHttpAdapter,
  TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES,
  TWILIO_RESPONDER_EVENT_PATH
} from "../twilio-responder-events-http.mjs";

const ORIGIN = "https://sitesourcery.com";
const RAW = Buffer.from(
  "AccountSid=AC11111111111111111111111111111111&" +
  "MessageSid=SM22222222222222222222222222222222&" +
  "MessageStatus=delivered"
);

function service() {
  return {
    async authenticate() {
      throw new Error("Twilio callback reached browser authentication");
    }
  };
}

function boundary(calls, eventState = "applied") {
  return {
    kind: "twilio-responder-events-http-adapter",
    mode: "raw-form",
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true, providerEffects: false };
    },
    async handle(input) {
      calls.push(input);
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8"
        },
        body: {
          received: true,
          eventState,
          messageStatus: "delivered",
          currentStatus: "delivered",
          attentionRequired: false
        }
      };
    }
  };
}

function request({
  method = "POST",
  body = RAW,
  contentType = "application/x-www-form-urlencoded",
  contentLength = body?.byteLength
} = {}) {
  return new Request(`${ORIGIN}${TWILIO_RESPONDER_EVENT_PATH}`, {
    method,
    headers: {
      "content-type": contentType,
      ...(contentLength === null
        ? {}
        : { "content-length": String(contentLength) }),
      "x-twilio-signature": "A".repeat(27) + "="
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body })
  });
}

test("hosted Twilio route preserves exact raw form bytes and accepts durable states", async () => {
  for (const eventState of ["pending", "applied", "stale", "conflict"]) {
    const calls = [];
    const api = createHostedApi(service(), {
      twilioResponderEvents: boundary(calls, eventState)
    });
    const response = await api.fetch(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).eventState, eventState);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.equal(Buffer.isBuffer(calls[0].rawBody), true);
    assert.deepEqual(calls[0].rawBody, RAW);
    assert.equal(
      calls[0].headers.get("x-twilio-signature"),
      "A".repeat(27) + "="
    );
  }
});

test("hosted Twilio route rejects method, media, and length before ingress", async () => {
  for (const [input, status, code] of [
    [{ method: "GET", body: null, contentLength: null }, 405,
      "METHOD_NOT_ALLOWED"],
    [{ contentType: "application/json" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ contentLength: RAW.byteLength + 1 }, 400, "INVALID_CONTENT_LENGTH"],
    [{ contentLength: TWILIO_RESPONDER_EVENT_MAXIMUM_BYTES + 1 }, 413,
      "REQUEST_TOO_LARGE"],
    [{ body: Buffer.alloc(0), contentLength: 0 }, 400,
      "TWILIO_RESPONDER_EVENT_BODY_REQUIRED"]
  ]) {
    const calls = [];
    const api = createHostedApi(service(), {
      twilioResponderEvents: boundary(calls)
    });
    const response = await api.fetch(request(input));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.length, 0);
  }
});

test("unconfigured Twilio route remains held and callback bytes are never logged", async () => {
  const response = await createHostedApi(service()).fetch(request());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "TWILIO_RESPONDER_EVENTS_HELD"
  );
  const [httpSource, serverSource, eventSource] = await Promise.all([
    readFile(new URL("../http.mjs", import.meta.url), "utf8"),
    readFile(new URL("../bin/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../twilio-responder-events.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(
    `${httpSource}\n${serverSource}\n${eventSource}`,
    /(?:console|stdout|stderr|log)\s*\([^)]*(?:rawBody|MessageSid|From|To|Body)/u
  );
});

test("hosted Twilio route rejects success without exact durable acknowledgement", async () => {
  const adapter = createTwilioResponderEventsHttpAdapter({
    events: {
      kind: "twilio-responder-events",
      mode: "verified-status-callback",
      providerEffects: false,
      async readiness() { return { ready: true, verified: true }; },
      async ingest() {
        return { received: true };
      }
    }
  });
  const api = createHostedApi(service(), {
    twilioResponderEvents: adapter
  });
  const response = await api.fetch(request());
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "TWILIO_RESPONDER_EVENT_HTTP_DURABILITY_REQUIRED"
  );
});
