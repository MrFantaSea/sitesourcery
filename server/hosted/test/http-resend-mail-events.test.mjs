import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { createHostedApi } from "../http.mjs";
import { createNodeHandler } from "../node-handler.mjs";
import { createConfiguredResendMailEventHttp } from
  "../resend-mail-events-config.mjs";
import {
  RESEND_MAIL_EVENT_MAXIMUM_BYTES,
  RESEND_MAIL_EVENT_PATH
} from "../resend-mail-events-http.mjs";

const ORIGIN = "https://app.sitesourcery.test";
const RAW = Buffer.from('{"signed":"unchanged"}', "utf8");
const NOW = "2026-08-11T16:00:00.000Z";
const KEY = Buffer.from("fixed-test-resend-webhook-key-01", "utf8");
const SECRET = `whsec_${KEY.toString("base64")}`;

function service() {
  return {
    async authenticate() {
      throw new Error("webhook reached authentication");
    }
  };
}

function ingress(calls, eventState = "applied") {
  return {
    kind: "resend-mail-event-http-adapter",
    mode: "raw-body",
    providerEffects: false,
    async readiness() { return { ready: true, verified: true }; },
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
          eventKind: "bounced",
          currentState: "bounced"
        }
      };
    }
  };
}

function request({
  method = "POST",
  body = RAW,
  contentType = "application/json",
  contentLength = body?.byteLength
} = {}) {
  return new Request(`${ORIGIN}${RESEND_MAIL_EVENT_PATH}`, {
    method,
    headers: {
      "content-type": contentType,
      ...(contentLength === null
        ? {}
        : { "content-length": String(contentLength) }),
      "svix-id": "mail_event_00000001",
      "svix-timestamp": "1786478400",
      "svix-signature": "v1,fixture"
    },
    ...(method === "GET" || method === "HEAD" ? {} : { body })
  });
}

test("hosted Resend route preserves bounded raw bytes and acknowledges durable duplicates", async () => {
  for (const eventState of ["applied", "pending", "conflict"]) {
    const calls = [];
    const api = createHostedApi(service(), {
      resendMailEvents: ingress(calls, eventState)
    });
    const response = await api.fetch(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).eventState, eventState);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls.length, 1);
    assert.equal(Buffer.isBuffer(calls[0].rawBody), true);
    assert.deepEqual(calls[0].rawBody, RAW);
    assert.equal(calls[0].headers.get("svix-id"), "mail_event_00000001");
  }
});

test("hosted route verifies the original signature and acknowledges only the durable lifecycle receipt", async () => {
  const messageId = "49f9f02a-93f5-4ddf-9e84-01df500701d4";
  const webhookId = "msg_event_00000001";
  const timestamp = String(Date.parse(NOW) / 1000);
  const rawBody = Buffer.from(JSON.stringify({
    type: "email.failed",
    created_at: NOW,
    data: { email_id: messageId }
  }));
  const signature = createHmac("sha256", KEY)
    .update(Buffer.from(`${webhookId}.${timestamp}.`, "utf8"))
    .update(rawBody)
    .digest("base64");
  const durableCalls = [];
  const lifecycle = {
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true, providerEffects: false };
    },
    async ingestProviderEvent(input) {
      durableCalls.push(input);
      return {
        eventState: durableCalls.length === 1 ? "applied" : "conflict",
        eventKind: input.eventKind,
        currentState: "bounced"
      };
    }
  };
  const adapter = createConfiguredResendMailEventHttp({
    environment: {
      SITESOURCERY_RESEND_WEBHOOK_MODE: "verified",
      SITESOURCERY_RESEND_WEBHOOK_SIGNING_SECRET: SECRET
    },
    lifecycle,
    clock: { now: () => NOW }
  });
  const api = createHostedApi(service(), { resendMailEvents: adapter });
  const signedRequest = () => new Request(
    `${ORIGIN}${RESEND_MAIL_EVENT_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(rawBody.byteLength),
        "svix-id": webhookId,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`
      },
      body: rawBody
    }
  );
  const accepted = await api.fetch(signedRequest());
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    received: true,
    eventState: "applied",
    eventKind: "bounced",
    currentState: "bounced"
  });
  const duplicate = await api.fetch(signedRequest());
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).eventState, "conflict");
  assert.equal(durableCalls.length, 2);
  assert.equal(durableCalls[0].eventKind, "bounced");
  assert.deepEqual(durableCalls[1], durableCalls[0]);
});

test("Node hosted ingress streams the unchanged raw bytes into the Resend route", async () => {
  const calls = [];
  const handler = createNodeHandler(createHostedApi(service(), {
    resendMailEvents: ingress(calls)
  }));
  const input = Readable.from([
    RAW.subarray(0, 7),
    RAW.subarray(7)
  ]);
  input.headers = {
    host: "app.sitesourcery.test",
    "content-type": "application/json",
    "content-length": String(RAW.byteLength),
    "svix-id": "mail_event_00000001",
    "svix-timestamp": "1786478400",
    "svix-signature": "v1,fixture"
  };
  input.method = "POST";
  input.url = RESEND_MAIL_EVENT_PATH;
  input.socket = { remoteAddress: "127.0.0.1", encrypted: true };
  const chunks = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  output.statusCode = 200;
  output.headers = {};
  output.setHeader = (name, value) => {
    output.headers[String(name).toLowerCase()] = value;
  };
  await handler(input, output);
  assert.equal(output.statusCode, 200);
  assert.equal(JSON.parse(Buffer.concat(chunks)).eventState, "applied");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].rawBody, RAW);
});

test("hosted Resend route rejects method, media, and declared/actual length before ingress", async () => {
  for (const [input, status, code] of [
    [{ method: "GET", body: null, contentLength: null }, 405, "METHOD_NOT_ALLOWED"],
    [{ contentType: "text/plain" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ contentLength: RAW.byteLength + 1 }, 400, "INVALID_CONTENT_LENGTH"],
    [{ contentLength: RESEND_MAIL_EVENT_MAXIMUM_BYTES + 1 }, 413, "REQUEST_TOO_LARGE"],
    [{ body: Buffer.alloc(0), contentLength: 0 }, 400, "RESEND_WEBHOOK_BODY_REQUIRED"]
  ]) {
    const calls = [];
    const api = createHostedApi(service(), {
      resendMailEvents: ingress(calls)
    });
    const response = await api.fetch(request(input));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.equal(calls.length, 0);
  }
});

test("unconfigured hosted Resend route stays held and source contains no body logging", async () => {
  const api = createHostedApi(service());
  const response = await api.fetch(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "RESEND_WEBHOOK_HELD");
  const [httpSource, serverSource] = await Promise.all([
    readFile(new URL("../http.mjs", import.meta.url), "utf8"),
    readFile(new URL("../bin/server.mjs", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(
    `${httpSource}\n${serverSource}`,
    /(?:console|stdout|stderr|log)\s*\([^)]*(?:rawBody|readRawResendWebhook)/u
  );
});

test("hosted route rejects a boundary that attempts success without an exact durable acknowledgement", async () => {
  for (const response of [
    { status: 202, body: { received: true } },
    {
      status: 200,
      body: {
        received: true,
        eventState: "unknown",
        eventKind: "bounced",
        currentState: "bounced"
      }
    }
  ]) {
    const api = createHostedApi(service(), {
      resendMailEvents: {
        kind: "resend-mail-event-http-adapter",
        mode: "raw-body",
        providerEffects: false,
        async readiness() { return { ready: true, verified: true }; },
        async handle() { return response; }
      }
    });
    const result = await api.fetch(request());
    assert.equal(result.status, 503);
    assert.equal(
      (await result.json()).error.code,
      "RESEND_WEBHOOK_HTTP_DURABILITY_REQUIRED"
    );
  }
});
