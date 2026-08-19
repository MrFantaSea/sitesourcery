import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, lstat, mkdtemp, rm } from "node:fs/promises";
import { request as rawHttpRequest } from "node:http";
import path from "node:path";
import test from "node:test";

import {
  createPublicationCommandClient,
  createPublicationCommandConfiguration,
  createPublicationCommandServer,
  decodePublicationCommand,
  decodePublicationResult,
  encodePublicationCommand,
  encodePublicationResult
} from "../publication-command-transport.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function proof(label = "one") {
  const htmlBytes = Buffer.from(`<h1>${label}</h1>`, "utf8");
  return {
    organizationId: "organization-one",
    projectId: "project-one",
    releaseId: "release-one",
    artifact: {
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: `sha256:${"a".repeat(64)}`,
      sha256: digest(htmlBytes),
      htmlBytes
    }
  };
}

async function fixture(portOverrides = {}) {
  const root = await mkdtemp(
    "/private/tmp/ss-pub-"
  );
  const configuration = createPublicationCommandConfiguration({
    allowedSocketRoot: root,
    socketPath: path.join(root, "publication.sock"),
    token: Buffer.alloc(32, 7).toString("base64url"),
    maximumBodyBytes: 1024 * 1024,
    deadlineMs: 2_000
  });
  const calls = [];
  const publicationPort = {
    async readiness() {
      return { ready: true, held: true, kind: "test-publication" };
    },
    async request(input) {
      calls.push(["request", input]);
      return { status: "released", published: true };
    },
    async rollback(input) {
      calls.push(["rollback", input]);
      return { status: "released", published: true };
    },
    async unpublish(input) {
      calls.push(["unpublish", input]);
      return { status: "unpublished", published: false };
    },
    ...portOverrides
  };
  const server = createPublicationCommandServer({
    publicationPort,
    configuration
  });
  await server.start();
  return {
    root,
    calls,
    configuration,
    server,
    client: createPublicationCommandClient({ configuration }),
    async close() {
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("publication command codec preserves exact bytes and rejects altered framing", () => {
  const original = proof();
  const decoded = decodePublicationCommand(
    encodePublicationCommand("request", original)
  );
  assert.equal(decoded.operation, "request");
  assert.deepEqual(decoded.input, original);
  assert.deepEqual(
    decodePublicationResult(
      encodePublicationResult("rollback", { status: "released" }),
      "rollback"
    ),
    { status: "released" }
  );

  const altered = JSON.parse(
    encodePublicationCommand("request", original).toString("utf8")
  );
  altered.input.artifact.htmlByteLength += 1;
  assert.throws(
    () => decodePublicationCommand(Buffer.from(JSON.stringify(altered))),
    (error) => error.code === "PUBLICATION_COMMAND_INVALID"
  );
  altered.input.artifact.htmlByteLength -= 1;
  altered.input.artifact.htmlBase64 += "=";
  assert.throws(
    () => decodePublicationCommand(Buffer.from(JSON.stringify(altered))),
    (error) => error.code === "PUBLICATION_COMMAND_INVALID"
  );
  assert.throws(
    () => decodePublicationResult(
      Buffer.from('{"ok":true,"operation":"request"}'),
      "request"
    ),
    (error) => error.code === "PUBLICATION_COMMAND_AMBIGUOUS" &&
      error.details.effectCertainty === "unknown"
  );
});

test("private Unix server is mode 0600 and dispatches each exact operation once", async () => {
  const selected = await fixture();
  try {
    const socket = await lstat(selected.configuration.socketPath);
    assert.equal(socket.isSocket(), true);
    assert.equal(socket.mode & 0o777, 0o600);
    assert.deepEqual(await selected.client.readiness(), {
      ready: true,
      held: true,
      kind: "private-unix-publication-command-client"
    });
    assert.deepEqual(await selected.client.request(proof()), {
      status: "released",
      published: true
    });
    assert.deepEqual(await selected.client.rollback(proof("two")), {
      status: "released",
      published: true
    });
    assert.deepEqual(await selected.client.unpublish({
      projectId: "project-one",
      hostname: "customer.example"
    }), {
      status: "unpublished",
      published: false
    });
    assert.deepEqual(selected.calls.map(([operation]) => operation), [
      "request", "rollback", "unpublish"
    ]);
    assert.equal(Buffer.isBuffer(selected.calls[0][1].artifact.htmlBytes), true);
    assert.deepEqual(selected.server.snapshot(), {
      schema: "sitesourcery.internal-publication-server-state/v1",
      state: "listening",
      socketPath: selected.configuration.socketPath,
      activeCommands: 0,
      credentials: "redacted"
    });
  } finally {
    const socketPath = selected.configuration.socketPath;
    await selected.close();
    await assert.rejects(access(socketPath), (error) => error.code === "ENOENT");
  }
});

test("wrong authority causes zero port calls and no credential disclosure", async () => {
  const selected = await fixture();
  try {
    const badConfiguration = createPublicationCommandConfiguration({
      allowedSocketRoot: selected.root,
      socketPath: selected.configuration.socketPath,
      token: Buffer.alloc(32, 8).toString("base64url"),
      maximumBodyBytes: 1024 * 1024,
      deadlineMs: 2_000
    });
    const badClient = createPublicationCommandClient({
      configuration: badConfiguration
    });
    await assert.rejects(
      badClient.request(proof()),
      (error) => error.code === "PUBLICATION_COMMAND_UNAUTHORIZED" &&
        error.details.effectCertainty === "none" &&
        !JSON.stringify(error).includes(badConfiguration.token)
    );
    assert.deepEqual(selected.calls, []);
  } finally {
    await selected.close();
  }
});

test("held posture never masks unavailable publication storage", async () => {
  const selected = await fixture({
    async readiness() {
      return { ready: false, held: true, code: "CONTROL_UNAVAILABLE" };
    }
  });
  try {
    assert.deepEqual(await selected.client.readiness(), {
      ready: false,
      held: true,
      kind: "private-unix-publication-command-client"
    });
    assert.deepEqual(selected.calls, []);
  } finally {
    await selected.close();
  }
});

test("one in-flight command fences a second command and stop drains it", async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const selected = await fixture({
    async request(input) {
      selected.calls.push(["request", input]);
      entered();
      await blocked;
      return { status: "released", published: true };
    }
  });
  try {
    const first = selected.client.request(proof());
    await started;
    await assert.rejects(
      selected.client.unpublish({
        projectId: "project-one",
        hostname: "customer.example"
      }),
      (error) => error.code === "PUBLICATION_COMMAND_BUSY" &&
        error.details.effectCertainty === "none"
    );
    assert.equal(selected.calls.length, 1);
    const stopping = selected.server.stop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(selected.server.snapshot().state, "stopping");
    release();
    assert.deepEqual(await first, { status: "released", published: true });
    await stopping;
    assert.equal(selected.server.snapshot().state, "stopped");
  } finally {
    release?.();
    await selected.server.stop().catch(() => {});
    await rm(selected.root, { recursive: true, force: true });
  }
});

test("admission is reserved before a staggered request body can finish", async () => {
  const selected = await fixture();
  try {
    const bytes = encodePublicationCommand("request", proof());
    let responseStatus = null;
    let firstRequest;
    const firstFinished = new Promise((resolve, reject) => {
      const request = rawHttpRequest({
        socketPath: selected.configuration.socketPath,
        method: "POST",
        path: "/v1/publication-commands",
        headers: {
          host: "sitesourcery-internal",
          authorization: `Bearer ${selected.configuration.token}`,
          connection: "close",
          "content-type": "application/json",
          "content-length": bytes.byteLength
        },
        agent: false
      }, (response) => {
        responseStatus = response.statusCode;
        response.resume();
        response.on("end", resolve);
      });
      request.once("error", reject);
      request.write(bytes.subarray(0, 10));
      firstRequest = request;
    });
    while (selected.server.snapshot().activeCommands !== 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      selected.client.unpublish({
        projectId: "project-one",
        hostname: "customer.example"
      }),
      (error) => error.code === "PUBLICATION_COMMAND_BUSY" &&
        error.details.effectCertainty === "none"
    );
    assert.deepEqual(selected.calls, []);
    firstRequest.end(bytes.subarray(10));
    await firstFinished;
    assert.equal(responseStatus, 200);
    assert.deepEqual(selected.calls.map(([operation]) => operation), [
      "request"
    ]);
  } finally {
    await selected.close();
  }
});
