import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";

const NOW = "2026-07-28T20:00:00.000Z";
const COMPILER_REVISION = `sha256:${"a".repeat(64)}`;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function harness(initiallyHeld = false) {
  let publicationHeld = initiallyHeld;
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sitesourcery-publication-port-")
  );
  const runtime = await SelfHostRuntime.open({
    root,
    publicationHeld: () => publicationHeld,
    platformBaseDomain: "sites.sitesourcery.me",
    clock: () => NOW
  });
  const port = createSelfHostPublicationPort({
    runtime,
    clock: { now: () => NOW }
  });
  return {
    root,
    runtime,
    port,
    hold(value) {
      publicationHeld = value;
    }
  };
}

function proof({
  releaseId = "release-one",
  releaseRequestId = "request-one",
  versionId = "version-one",
  screeningId = "screening-one",
  html = "<!doctype html><html><body>release one</body></html>",
  hostname = "customer.example",
  addressKind = "customer_byod"
} = {}) {
  const htmlBytes = Buffer.from(html, "utf8");
  const artifactDigest = digest(htmlBytes);
  return {
    organizationId: "organization-one",
    projectId: "project-one",
    releaseId,
    project: {
      id: "project-one",
      organizationId: "organization-one",
      lifecycle: "active",
      safetyState: "clear"
    },
    releaseRequest: {
      id: releaseRequestId,
      organizationId: "organization-one",
      projectId: "project-one",
      versionId,
      addressId: "address-one",
      prepublicationScreeningId: screeningId
    },
    version: {
      id: versionId,
      state: "accepted_release",
      artifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    },
    screening: {
      id: screeningId,
      versionId,
      stage: "pre_publication",
      passed: true,
      artifactDigest
    },
    subscription: {
      organizationId: "organization-one",
      projectId: "project-one",
      status: "active"
    },
    address: {
      id: "address-one",
      organizationId: "organization-one",
      projectId: "project-one",
      kind: addressKind,
      state: "configured",
      verified: true,
      hostname
    },
    artifact: {
      htmlBytes,
      sha256: artifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    }
  };
}

function tenantRequest(hostname) {
  return new Request(`https://${hostname}/`, {
    headers: { host: hostname }
  });
}

test("publication hold performs no mutation and lifting it cannot publish a queued row", async () => {
  const context = await harness(true);
  const before = context.runtime.control.snapshot();
  const result = await context.port.request(proof());
  assert.equal(result.status, "held");
  assert.equal(result.published, false);
  assert.deepEqual(context.runtime.control.snapshot(), before);
  assert.deepEqual(
    await context.runtime.createBackupManifest().then((manifest) =>
      manifest.payload.releases
    ),
    []
  );

  context.hold(false);
  const response = await context.runtime.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 404);
});

test("a release-request database row alone has no publication authority", async () => {
  const context = await harness();
  const before = context.runtime.control.snapshot();
  await assert.rejects(
    context.port.request({
      releaseRequest: {
        id: "request-one",
        organizationId: "organization-one",
        projectId: "project-one",
        versionId: "version-one",
        addressId: "address-one",
        prepublicationScreeningId: "screening-one"
      }
    }),
    (error) => error?.code === "PUBLICATION_PROOF_INVALID"
  );
  assert.deepEqual(context.runtime.control.snapshot(), before);
});

test("paid, verified, accepted, screened, safe, exact proof gates fail closed", async () => {
  const mutations = [
    (value) => {
      value.subscription.status = "suspended";
    },
    (value) => {
      value.address.verified = false;
    },
    (value) => {
      value.version.state = "ready";
    },
    (value) => {
      value.screening.passed = false;
    },
    (value) => {
      value.project.safetyState = "held";
    },
    (value) => {
      value.artifact.htmlBytes = Buffer.from("different bytes");
    },
    (value) => {
      value.releaseRequest.addressId = "other-address";
    }
  ];
  for (const mutate of mutations) {
    const context = await harness();
    const input = proof();
    mutate(input);
    await assert.rejects(context.port.request(input));
    const state = context.runtime.control.snapshot();
    assert.deepEqual(state.hostnames, {});
    assert.deepEqual(state.releases, {});
  }
});

test("private port publishes exact server bytes and exact replay is state-idempotent", async () => {
  const context = await harness();
  const input = proof();
  const released = await context.port.request(input);
  assert.equal(released.status, "released");
  assert.equal(released.published, true);
  assert.equal(released.replay, false);
  const response = await context.runtime.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    input.artifact.htmlBytes
  );
  assert.deepEqual(context.runtime.control.lookup("customer.example"), {
    hostname: "customer.example",
    projectId: "project-one",
    source: "custom",
    status: "active",
    tlsState: "approved",
    currentReleaseId: "release-one",
    previousReleaseId: null,
    revision: 3,
    createdAt: NOW,
    updatedAt: NOW
  });

  const beforeReplay = context.runtime.control.snapshot();
  const replay = await context.port.request(input);
  assert.equal(replay.replay, true);
  assert.deepEqual(context.runtime.control.snapshot(), beforeReplay);
});

test("publication updates whole releases and rollback restores exact accepted bytes", async () => {
  const context = await harness();
  const first = proof();
  const second = proof({
    releaseId: "release-two",
    releaseRequestId: "request-two",
    versionId: "version-two",
    screeningId: "screening-two",
    html: "<!doctype html><html><body>release two</body></html>"
  });
  await context.port.request(first);
  await context.port.request(second);
  let response = await context.runtime.fetch(tenantRequest("customer.example"));
  assert.match(await response.text(), /release two/u);

  const rolledBack = await context.port.rollback(first);
  assert.equal(rolledBack.status, "released");
  assert.equal(rolledBack.releaseId, "release-one");
  response = await context.runtime.fetch(tenantRequest("customer.example"));
  assert.match(await response.text(), /release one/u);
});

test("unpublish remains available during an emergency hold and stays dark afterward", async () => {
  const context = await harness();
  await context.port.request(proof());
  context.hold(true);
  const result = await context.port.unpublish({
    projectId: "project-one",
    hostname: "customer.example"
  });
  assert.equal(result.status, "unpublished");
  context.hold(false);
  const response = await context.runtime.fetch(tenantRequest("customer.example"));
  assert.equal(response.status, 404);
  assert.equal(context.runtime.control.lookup("customer.example").status, "dark");
});

test("licensed addresses map only to the reserved platform namespace", async () => {
  const context = await harness();
  const released = await context.port.request(
    proof({
      hostname: "cedar.sites.sitesourcery.me",
      addressKind: "licensed"
    })
  );
  assert.equal(released.published, true);
  assert.equal(
    context.runtime.control.lookup("cedar.sites.sitesourcery.me").source,
    "platform"
  );
});

test("publication adapter is in-process and does not expose a network control surface", async () => {
  const source = await readFile(
    new URL("../selfhost-publication-port.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /createServer|\.listen\(|node-handler|http\.mjs/u);
  const context = await harness();
  assert.equal(context.port.kind, "private-in-process-selfhost");
  assert.deepEqual(Object.keys(context.port).sort(), [
    "kind",
    "readiness",
    "request",
    "rollback",
    "unpublish"
  ]);
});
