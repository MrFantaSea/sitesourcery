import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { DEFAULT_INGRESS_POLICY } from "../ingress-policy.mjs";
import { createNodeHandler } from "../node-handler.mjs";

function policy(node = {}) {
  return {
    ...DEFAULT_INGRESS_POLICY,
    node: { ...DEFAULT_INGRESS_POLICY.node, ...node }
  };
}

function incoming({ headers = {}, body = "", remoteAddress = "127.0.0.1" } = {}) {
  const stream = Readable.from([body]);
  stream.headers = { host: "app.test", ...headers };
  stream.method = body ? "POST" : "GET";
  stream.url = "/api/v1/health";
  stream.socket = { remoteAddress, encrypted: false };
  return stream;
}

function outgoing() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  stream.statusCode = 200;
  stream.headers = {};
  stream.setHeader = (name, value) => {
    stream.headers[String(name).toLowerCase()] = value;
  };
  stream.body = () => Buffer.concat(chunks).toString("utf8");
  return stream;
}

test("node ingress rejects declared oversized bodies before API buffering", async () => {
  let calls = 0;
  const handler = createNodeHandler({ async fetch() { calls += 1; } });
  const input = incoming({
    headers: { "content-length": String(DEFAULT_INGRESS_POLICY.body.jsonBytes + 1) },
    body: "x"
  });
  const output = outgoing();
  await handler(input, output);
  assert.equal(output.statusCode, 413);
  assert.equal(calls, 0);
});

test("node ingress bounds concurrency and accepts proxy identity only from loopback", async () => {
  let release;
  const contexts = [];
  const handler = createNodeHandler({
    fetch(_request, context) {
      contexts.push(context);
      return new Promise((resolve) => { release = resolve; });
    }
  }, policy({ maxConcurrentRequests: 1 }));
  const firstOutput = outgoing();
  const first = handler(incoming({ headers: { "x-real-ip": "203.0.113.8" } }), firstOutput);
  await new Promise((resolve) => setImmediate(resolve));
  const secondOutput = outgoing();
  await handler(incoming(), secondOutput);
  assert.equal(secondOutput.statusCode, 503);
  assert.deepEqual(contexts, [{ clientAddress: "203.0.113.8" }]);
  release(new Response("ok"));
  await first;
  assert.equal(firstOutput.statusCode, 200);

  let selected;
  const direct = createNodeHandler({
    async fetch(_request, context) {
      selected = context.clientAddress;
      return new Response(null);
    }
  });
  await direct(
    incoming({
      headers: { "x-real-ip": "203.0.113.9" },
      remoteAddress: "198.51.100.2"
    }),
    outgoing()
  );
  assert.equal(selected, "198.51.100.2");
});

test("node ingress aborts at the configured request deadline", async () => {
  let release;
  const handler = createNodeHandler({
    fetch() {
      return new Promise((resolve) => { release = resolve; });
    }
  }, policy({ requestDeadlineMs: 1000 }));
  const output = outgoing();
  await handler(incoming(), output);
  assert.equal(output.statusCode, 504);
  assert.match(output.body(), /REQUEST_DEADLINE_EXCEEDED/u);
  release(new Response(null));
});
