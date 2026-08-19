import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";
import {
  createAlakazamFulfillmentAuthority,
  createAlakazamFulfillmentDecision
} from "../../commerce-v2/alakazam-fulfillment.mjs";

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
    platformBaseDomain: "sitesourcery.me",
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

function alakazamProof() {
  const ids = {
    organizationId:
      "10000000-0000-4000-8000-000000000001",
    customerId:
      "10000000-0000-4000-8000-000000000002",
    projectId:
      "10000000-0000-4000-8000-000000000003",
    subscriptionId:
      "10000000-0000-4000-8000-000000000004",
    operationId:
      "10000000-0000-4000-8000-000000000005",
    versionId:
      "10000000-0000-4000-8000-000000000006",
    screeningId:
      "10000000-0000-4000-8000-000000000007",
    addressId:
      "10000000-0000-4000-8000-000000000008",
    requestId:
      "10000000-0000-4000-8000-000000000009"
  };
  const htmlBytes = Buffer.from(
    "<!doctype html><html><body>Alakazam live</body></html>",
    "utf8"
  );
  const artifactDigest = digest(htmlBytes);
  const sourceArtifactDigest = digest("accepted Alakazam source");
  const authority = createAlakazamFulfillmentAuthority({
    tenantId: ids.organizationId,
    customerId: ids.customerId,
    projectId: ids.projectId,
    subscription: {
      tenantId: ids.organizationId,
      customerId: ids.customerId,
      projectId: ids.projectId,
      subscriptionId: ids.subscriptionId,
      tierId: "alakazam_25",
      status: "active",
      revision: 2,
      currentPeriodStartsAt:
        "2026-07-01T00:00:00.000Z",
      currentPeriodEndsAt:
        "2026-08-28T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: 2,
    now: NOW
  });
  const decision = createAlakazamFulfillmentDecision({
    operationId: ids.operationId,
    authority,
    capability: "publish_accepted_project_version",
    sourceVersion: {
      versionId: ids.versionId,
      state: "accepted_release",
      artifactDigest: sourceArtifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    },
    publicationArtifact: {
      artifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION,
      policyDigest: authority.policyDigest,
      screeningId: ids.screeningId,
      screeningStage: "pre_publication",
      screeningPassed: true,
      screeningArtifactDigest: artifactDigest
    },
    address: {
      tenantId: ids.organizationId,
      projectId: ids.projectId,
      addressId: ids.addressId,
      kind: "licensed",
      state: "configured",
      hostname: "alchemy.sitesourcery.me"
    },
    servingRevision: 0,
    now: NOW
  });
  return {
    organizationId: ids.organizationId,
    projectId: ids.projectId,
    releaseId: ids.operationId,
    project: {
      id: ids.projectId,
      organizationId: ids.organizationId,
      lifecycle: "active",
      safetyState: "clear"
    },
    releaseRequest: {
      id: ids.requestId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      versionId: ids.versionId,
      addressId: ids.addressId,
      prepublicationScreeningId: ids.screeningId
    },
    version: {
      id: ids.versionId,
      state: "accepted_release",
      artifactDigest: sourceArtifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    },
    screening: {
      id: ids.screeningId,
      versionId: ids.versionId,
      stage: "pre_publication",
      passed: true,
      artifactDigest
    },
    entitlement: {
      kind: "alakazam",
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      subscriptionId: ids.subscriptionId,
      subscriptionRevision: 2,
      status: "active",
      graceEndsAt: null,
      decision
    },
    address: {
      id: ids.addressId,
      organizationId: ids.organizationId,
      projectId: ids.projectId,
      kind: "licensed",
      state: "configured",
      verified: true,
      hostname: "alchemy.sitesourcery.me"
    },
    artifact: {
      htmlBytes,
      sha256: artifactDigest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: COMPILER_REVISION
    }
  };
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

test("completed ownership is publication-eligible but refunded, disputed, or revoked ownership is not", async () => {
  const owned = proof();
  delete owned.subscription;
  owned.entitlement = {
    kind: "ownership",
    organizationId: "organization-one",
    projectId: "project-one",
    status: "completed",
    completedAt: NOW
  };
  const ownedContext = await harness();
  const released = await ownedContext.port.request(owned);
  assert.equal(released.status, "released");
  assert.equal(released.published, true);

  const invalidEntitlements = [
    { status: "refunded", completedAt: NOW },
    { status: "disputed", completedAt: NOW },
    { status: "revoked", completedAt: NOW },
    { status: "completed", completedAt: "not-a-date" },
    {
      status: "completed",
      completedAt: NOW,
      organizationId: "organization-two"
    },
    {
      status: "completed",
      completedAt: NOW,
      projectId: "project-two"
    }
  ];
  for (const invalid of invalidEntitlements) {
    const context = await harness();
    const input = proof();
    delete input.subscription;
    input.entitlement = {
      kind: "ownership",
      organizationId: "organization-one",
      projectId: "project-one",
      ...invalid
    };
    await assert.rejects(
      context.port.request(input),
      (error) => error?.code === "PAID_ENTITLEMENT_REQUIRED"
    );
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

test("publication readiness separates storage health from the effect hold", async () => {
  const context = await harness(true);
  assert.deepEqual(await context.port.readiness(), {
    ready: true,
    kind: "private-in-process-selfhost",
    held: true,
    storageReady: true,
    storageCode: null
  });
  context.runtime.readiness = async () => ({
    ready: false,
    publicationHeld: true,
    code: "CONTROL_UNAVAILABLE"
  });
  assert.deepEqual(await context.port.readiness(), {
    ready: false,
    kind: "private-in-process-selfhost",
    held: true,
    storageReady: false,
    storageCode: "CONTROL_UNAVAILABLE"
  });
});

test("licensed addresses map only to the reserved platform namespace", async () => {
  const context = await harness();
  const released = await context.port.request(
    proof({
      hostname: "cedar.sitesourcery.me",
      addressKind: "licensed"
    })
  );
  assert.equal(released.published, true);
  assert.equal(
    context.runtime.control.lookup("cedar.sitesourcery.me").source,
    "platform"
  );
});

test("Alakazam publication consumes one exact revision and effective-artifact decision", async () => {
  const context = await harness();
  const input = alakazamProof();
  const released = await context.port.request(input);
  assert.equal(released.published, true);
  assert.equal(released.releaseId, input.releaseId);
  assert.match(
    await (await context.runtime.fetch(
      tenantRequest("alchemy.sitesourcery.me")
    )).text(),
    /Alakazam live/u
  );

  const changed = structuredClone(input);
  changed.entitlement.decision.policyDigest = "f".repeat(64);
  await assert.rejects(
    context.port.request(changed),
    (error) =>
      error.code === "PUBLICATION_PROOF_INVALID" &&
      error.status === 409
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
