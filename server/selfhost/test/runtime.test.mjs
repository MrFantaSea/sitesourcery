import assert from "node:assert/strict";
import {
  chmod,
  symlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SelfHostRuntime } from "../src/index.mjs";
import {
  controlRequest,
  files,
  installAndActivate,
  tenantRequest,
  testRuntime
} from "./helpers.mjs";

test("installs immutable multi-file release and serves exact host/path with integrity headers", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const index = await runtime.fetch(tenantRequest("customer.example"));
  assert.equal(index.status, 200);
  assert.match(await index.text(), /one/u);
  assert.equal(index.headers.get("x-content-type-options"), "nosniff");
  assert.match(index.headers.get("cache-control"), /must-revalidate/u);
  assert.match(index.headers.get("etag"), /^"[a-f0-9]{64}"$/u);

  const asset = await runtime.fetch(
    tenantRequest("customer.example", "/assets/app.js")
  );
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(await asset.text(), /release="one"/u);
});

test("HEAD and ETag revalidation preserve immutable metadata without a body", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const first = await runtime.fetch(tenantRequest("customer.example"));
  const etag = first.headers.get("etag");
  const head = await runtime.fetch(
    tenantRequest("customer.example", "/", { method: "HEAD" })
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("content-length"), first.headers.get("content-length"));
  const cached = await runtime.fetch(
    tenantRequest("customer.example", "/", {
      headers: { "if-none-match": etag }
    })
  );
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");
});

test("unknown, held, dark, mismatched, and unregistered hosts fail closed", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const unknown = await runtime.fetch(tenantRequest("unknown.example"));
  assert.equal(unknown.status, 404);

  let binding = runtime.control.lookup("customer.example");
  await runtime.setHostnameGate({
    hostname: binding.hostname,
    expectedRevision: binding.revision,
    status: "dark"
  });
  const dark = await runtime.fetch(tenantRequest("customer.example"));
  assert.equal(dark.status, 404);

  const mismatched = await runtime.fetch(
    new Request("https://customer.example/", {
      headers: { host: "evil.example" }
    })
  );
  assert.equal(mismatched.status, 404);
});

test("PUBLICATION_HOLD blocks serving, readiness, and TLS authorization but not liveness", async () => {
  const { runtime } = await testRuntime({ held: true });
  await installAndActivate(runtime);
  const content = await runtime.fetch(tenantRequest("customer.example"));
  assert.equal(content.status, 503);
  const health = await runtime.fetch(
    controlRequest("/_sitesourcery/health")
  );
  assert.equal(health.status, 200);
  assert.equal((await health.json()).publicationHeld, true);
  const ready = await runtime.fetch(controlRequest("/_sitesourcery/ready"));
  assert.equal(ready.status, 503);
  const ask = await runtime.fetch(
    controlRequest("/_sitesourcery/tls/allow?domain=customer.example")
  );
  assert.equal(ask.status, 403);
});

test("control endpoints are unreachable through a tenant Host", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const response = await runtime.fetch(
    tenantRequest("customer.example", "/_sitesourcery/ready")
  );
  assert.equal(response.status, 404);
});

test("TLS ask allows only an exact active approved custom hostname with a verified release", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  await runtime.installRelease({
    projectId: "platform-project",
    releaseId: "platform-release",
    files: files("platform")
  });
  await runtime.reserveHostname({
    hostname: "alpha.sitesourcery.me",
    projectId: "platform-project",
    source: "platform",
    tlsState: "approved"
  });
  let platform = runtime.control.lookup("alpha.sitesourcery.me");
  await runtime.activate({
    hostname: platform.hostname,
    releaseId: "platform-release",
    expectedRevision: platform.revision
  });
  platform = runtime.control.lookup(platform.hostname);
  await runtime.setHostnameGate({
    hostname: platform.hostname,
    expectedRevision: platform.revision,
    status: "active"
  });

  const allowed = await runtime.fetch(
    controlRequest("/_sitesourcery/tls/allow?domain=CUSTOMER.EXAMPLE")
  );
  assert.equal(allowed.status, 200);
  for (const query of [
    "domain=unknown.example",
    "domain=alpha.sitesourcery.me",
    "domain=customer.example&domain=evil.example",
    "domain=customer.example&extra=1"
  ]) {
    const denied = await runtime.fetch(
      controlRequest(`/_sitesourcery/tls/allow?${query}`)
    );
    assert.equal(denied.status, 403, query);
  }
});

test("atomic activation and rollback switch whole releases, never individual files", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  await runtime.installRelease({
    projectId: "project-one",
    releaseId: "release-two",
    files: files("two")
  });
  let binding = runtime.control.lookup("customer.example");
  await runtime.activate({
    hostname: binding.hostname,
    releaseId: "release-two",
    expectedRevision: binding.revision
  });
  let response = await runtime.fetch(tenantRequest("customer.example"));
  assert.match(await response.text(), /two/u);
  binding = runtime.control.lookup("customer.example");
  await runtime.rollback({
    hostname: binding.hostname,
    expectedRevision: binding.revision
  });
  response = await runtime.fetch(tenantRequest("customer.example"));
  assert.match(await response.text(), /one/u);
});

test("concurrent compare-and-set activations serialize and one stale writer fails", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  await runtime.installRelease({
    projectId: "project-one",
    releaseId: "release-two",
    files: files("two")
  });
  await runtime.installRelease({
    projectId: "project-one",
    releaseId: "release-three",
    files: files("three")
  });
  const binding = runtime.control.lookup("customer.example");
  const results = await Promise.allSettled([
    runtime.activate({
      hostname: binding.hostname,
      releaseId: "release-two",
      expectedRevision: binding.revision
    }),
    runtime.activate({
      hostname: binding.hostname,
      releaseId: "release-three",
      expectedRevision: binding.revision
    })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failure = results.find((result) => result.status === "rejected");
  assert.equal(failure.reason.code, "REVISION_CONFLICT");
});

test("restart recovers the committed mapping and ignores an orphan future history snapshot", async () => {
  const { runtime, root } = await testRuntime();
  const expected = await installAndActivate(runtime);
  const orphan = path.join(
    root,
    "control",
    "revisions",
    "99999999999999999999-orphan.json"
  );
  await writeFile(orphan, '{"not":"committed"}\n', { mode: 0o440 });
  const restarted = await SelfHostRuntime.open({
    root,
    publicationHeld: false,
    platformBaseDomain: "sitesourcery.me"
  });
  assert.deepEqual(restarted.control.lookup("customer.example"), expected);
  const response = await restarted.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /one/u);
});

test("corrupt current control state reopens unready and serves nothing", async () => {
  const { runtime, root } = await testRuntime();
  await installAndActivate(runtime);
  await writeFile(path.join(root, "control", "current.json"), '{"tampered":true}\n');
  const restarted = await SelfHostRuntime.open({
    root,
    publicationHeld: false
  });
  assert.equal(restarted.control.isReady(), false);
  const ready = await restarted.fetch(controlRequest("/_sitesourcery/ready"));
  assert.equal(ready.status, 503);
  const response = await restarted.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 503);
});

test("artifact tampering returns generic unavailable and never serves changed bytes", async () => {
  const { runtime, root } = await testRuntime();
  await installAndActivate(runtime);
  const target = path.join(
    root,
    "releases",
    "project-one",
    "release-one",
    "index.html"
  );
  await chmod(target, 0o640);
  await writeFile(target, "tampered");
  const response = await runtime.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "Temporarily unavailable");
});

test("symlink substitution is rejected before external bytes are read", async () => {
  const { runtime, root } = await testRuntime();
  await installAndActivate(runtime);
  const releaseDirectory = path.join(
    root,
    "releases",
    "project-one",
    "release-one"
  );
  const target = path.join(releaseDirectory, "index.html");
  const outside = path.join(root, "outside-secret");
  await writeFile(outside, "outside-secret");
  await chmod(releaseDirectory, 0o750);
  const { rm } = await import("node:fs/promises");
  await rm(target);
  await symlink(outside, target);
  const response = await runtime.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /outside-secret/u);
});

test("release install rejects traversal, duplicates, missing index, and conflicting immutable IDs", async () => {
  const { runtime } = await testRuntime();
  for (const badPath of ["../secret", "/absolute", "assets//app.js", "assets\\app.js"]) {
    await assert.rejects(
      runtime.installRelease({
        projectId: "project-bad",
        releaseId: `release-${Math.random().toString(16).slice(2)}`,
        files: [
          {
            path: badPath,
            bytes: Buffer.from("bad"),
            contentType: "text/plain"
          },
          {
            path: "index.html",
            bytes: Buffer.from("index"),
            contentType: "text/html"
          }
        ]
      }),
      (error) => error.code === "INVALID_FILE_PATH"
    );
  }
  await assert.rejects(
    runtime.installRelease({
      projectId: "project-bad",
      releaseId: "release-duplicate",
      files: [
        { path: "index.html", bytes: Buffer.from("a"), contentType: "text/html" },
        { path: "index.html", bytes: Buffer.from("b"), contentType: "text/html" }
      ]
    }),
    (error) => error.code === "DUPLICATE_RELEASE_PATH"
  );
  await assert.rejects(
    runtime.installRelease({
      projectId: "project-bad",
      releaseId: "release-no-index",
      files: [
        { path: "asset.js", bytes: Buffer.from("a"), contentType: "text/javascript" }
      ]
    }),
    (error) => error.code === "INDEX_REQUIRED"
  );
  await runtime.installRelease({
    projectId: "project-bad",
    releaseId: "release-fixed",
    files: files("original")
  });
  await assert.rejects(
    runtime.installRelease({
      projectId: "project-bad",
      releaseId: "release-fixed",
      files: files("different")
    }),
    (error) => error.code === "RELEASE_CONFLICT"
  );
});

test("backup manifest enumerates checksummed control and every required release path", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const backup = await runtime.createBackupManifest();
  assert.equal(backup.schema, "sitesourcery.selfhost-backup-manifest/v1");
  assert.match(backup.checksum, /^[a-f0-9]{64}$/u);
  assert.equal(backup.payload.controlRevision, runtime.control.snapshot().revision);
  assert.equal(backup.payload.releases.length, 1);
  assert.ok(
    backup.payload.releases[0].requiredRelativePaths.includes(
      "releases/project-one/release-one/index.html"
    )
  );
});

test("readiness verifies all active manifest mappings", async () => {
  const { runtime } = await testRuntime();
  await installAndActivate(runtime);
  const readiness = await runtime.readiness();
  assert.deepEqual(
    { ready: readiness.ready, checkedBindings: readiness.checkedBindings },
    { ready: true, checkedBindings: 1 }
  );
});
