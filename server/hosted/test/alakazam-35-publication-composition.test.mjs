import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import {
  files,
  installAndActivate,
  tenantRequest
} from "../../selfhost/test/helpers.mjs";
import {
  createAlakazam35PublicationPort
} from "../alakazam-35-publication-port.mjs";

const NOW = "2026-10-14T01:00:00.000Z";
const identity = {
  organizationId: "organization-one",
  projectId: "project-one",
  deletionRequestId: "deletion-one"
};

async function harness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-alakazam-composition-"));
  t.after(async () => {
    async function writable(directory) {
      await chmod(directory, 0o700);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          await writable(path.join(directory, entry.name));
        }
      }
    }
    await writable(root);
    await rm(root, { recursive: true });
  });
  let held = true;
  const runtime = await SelfHostRuntime.open({
    root,
    publicationHeld: () => held,
    clock: () => NOW
  });
  function compose(selectedRuntime) {
    return createAlakazam35PublicationPort({
      runtime: selectedRuntime,
      assetRepository: {
        async readPublicationAsset() {
          assert.fail("Readiness and erasure must not request publication assets.");
        }
      },
      clock: { now: () => NOW }
    });
  }
  return { root, runtime, port: compose(runtime), compose, hold(value) { held = value; } };
}

test("Alakazam composes the real publication runtime while publication is held", async (t) => {
  const { port } = await harness(t);
  assert.deepEqual(await port.readiness(), {
    ready: true,
    kind: "private-in-process-selfhost",
    held: true,
    storageReady: true,
    storageCode: null
  });
  assert.equal(typeof port.purgeProject, "function");
});

test("Alakazam forwards terminal erasure during a hold and preserves it across reopen", async (t) => {
  const context = await harness(t);
  context.hold(false);
  await installAndActivate(context.runtime);
  assert.equal((await context.runtime.fetch(tenantRequest("customer.example"))).status, 200);
  context.hold(true);

  const expected = {
    schema: "sitesourcery.publication-erasure/v1",
    ...identity,
    erased: true,
    published: false,
    terminal: true
  };
  assert.deepEqual(await context.port.purgeProject(identity), expected);
  await assert.rejects(lstat(path.join(context.runtime.releases.root, identity.projectId)), {
    code: "ENOENT"
  });
  assert.equal(context.runtime.control.lookup("customer.example"), null);

  const reopened = await SelfHostRuntime.open({ root: context.root, publicationHeld: false });
  assert.equal((await reopened.fetch(tenantRequest("customer.example"))).status, 404);
  const revision = reopened.control.snapshot().revision;
  const port = context.compose(reopened);
  assert.deepEqual(await port.purgeProject(identity), expected);
  assert.equal(reopened.control.snapshot().revision, revision);
  await assert.rejects(reopened.installRelease({
    projectId: identity.projectId,
    releaseId: "release-after-erasure",
    files: files("must remain erased")
  }), { code: "PROJECT_DELETED" });
  await assert.rejects(port.purgeProject({ ...identity, deletionRequestId: "another-deletion" }), {
    code: "PUBLICATION_ENGINE_UNAVAILABLE",
    details: { engineCode: "PROJECT_DELETION_CONFLICT", operation: "purgeProject" }
  });
});
