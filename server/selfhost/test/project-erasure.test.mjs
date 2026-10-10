import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SelfHostRuntime } from "../src/index.mjs";
import { files, installAndActivate, tenantRequest, testRuntime } from "./helpers.mjs";

const identity = { organizationId: "org-one", projectId: "project-one", deletionRequestId: "deletion-one" };

async function fixture(t) {
  const selected = await testRuntime();
  t.after(async () => {
    async function writable(directory) {
      await chmod(directory, 0o700);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) await writable(path.join(directory, entry.name));
      }
    }
    await writable(selected.root);
    await rm(selected.root, { recursive: true });
  });
  return selected;
}

test("terminal erasure removes every release/stage, preserves neighbors and hard-link targets, and survives reopen", async (t) => {
  const { runtime, root } = await fixture(t);
  await installAndActivate(runtime);
  await runtime.installRelease({ projectId: identity.projectId, releaseId: "release-two", files: files("two") });
  await installAndActivate(runtime, { projectId: "project-other", hostname: "other.example", label: "neighbor" });
  const stage = path.join(runtime.releases.root, identity.projectId, ".stage-abandoned");
  await mkdir(stage);
  await writeFile(path.join(stage, "unfinished.html"), "partial");
  const outside = path.join(root, "neighbor.txt");
  await writeFile(outside, "preserve", { mode: 0o600 });
  await link(outside, path.join(stage, "hardlink.txt"));
  const serving = await SelfHostRuntime.openServing({ root, publicationHeld: false });
  assert.equal((await serving.fetch(tenantRequest("customer.example"))).status, 200);
  assert.equal((await runtime.purgeProject(identity)).erased, true);
  await assert.rejects(lstat(path.join(runtime.releases.root, identity.projectId)), { code: "ENOENT" });
  assert.equal((await serving.fetch(tenantRequest("customer.example"))).status, 404);
  assert.equal((await serving.fetch(tenantRequest("other.example"))).status, 200);
  assert.equal(await readFile(outside, "utf8"), "preserve");
  assert.equal((await lstat(outside)).mode & 0o777, 0o600);
  const reopened = await SelfHostRuntime.open({ root, publicationHeld: false });
  const revision = reopened.control.snapshot().revision;
  assert.equal((await reopened.purgeProject(identity)).removedFiles, 0);
  assert.equal(reopened.control.snapshot().revision, revision, "replay must not rewrite the terminal seal");
  await assert.rejects(reopened.installRelease({ projectId: identity.projectId, releaseId: "release-three", files: files("stale") }), { code: "PROJECT_DELETED" });
  await assert.rejects(reopened.reserveHostname({ projectId: identity.projectId, hostname: "new.example", source: "custom" }), { code: "PROJECT_DELETED" });
  await assert.rejects(reopened.purgeProject({ ...identity, organizationId: "other-org" }), { code: "PROJECT_DELETION_CONFLICT" });
  await assert.rejects(reopened.purgeProject({ ...identity, deletionRequestId: "other-request" }), { code: "PROJECT_DELETION_CONFLICT" });
  await assert.rejects(serving.purgeProject(identity), { code: "READ_ONLY_RUNTIME" });
});

test("unsafe or interrupted erasure keeps the terminal fence and can resume after reopen", async (t) => {
  const { runtime, root } = await fixture(t);
  await installAndActivate(runtime);
  const outside = path.join(root, "outside");
  await mkdir(outside); await writeFile(path.join(outside, "keep"), "outside");
  const unsafe = path.join(runtime.releases.root, identity.projectId, "unsafe");
  await symlink(outside, unsafe);
  await assert.rejects(runtime.purgeProject(identity), { code: "SYMLINK_FORBIDDEN" });
  assert.equal(await readFile(path.join(outside, "keep"), "utf8"), "outside");
  assert.equal(runtime.control.lookup("customer.example"), null);
  await assert.rejects(runtime.installRelease({ projectId: identity.projectId, releaseId: "late", files: files("late") }), { code: "PROJECT_DELETED" });
  await unlink(unsafe);
  const reopened = await SelfHostRuntime.open({ root });
  assert.equal((await reopened.purgeProject(identity)).erased, true);
  await assert.rejects(lstat(path.join(runtime.releases.root, identity.projectId)), { code: "ENOENT" });
});

for (const first of ["install", "purge"]) {
  test(`${first} first: installation cannot leave content behind terminal erasure`, async (t) => {
    const { runtime } = await fixture(t);
    const reached = Promise.withResolvers(); const released = Promise.withResolvers();
    const method = first === "install" ? "install" : "eraseProject";
    const original = runtime.releases[method].bind(runtime.releases);
    runtime.releases[method] = async (...args) => { reached.resolve(); await released.promise; return original(...args); };
    const install = () => runtime.installRelease({ projectId: identity.projectId, releaseId: "racing", files: files("racing") });
    const firstJob = first === "install" ? install() : runtime.purgeProject(identity);
    await reached.promise;
    const secondJob = first === "install" ? runtime.purgeProject(identity) : install();
    const checked = first === "install" ? secondJob : assert.rejects(secondJob, { code: "PROJECT_DELETED" });
    released.resolve();
    await firstJob; await checked;
    await assert.rejects(lstat(path.join(runtime.releases.root, identity.projectId)), { code: "ENOENT" });
  });
}

test("control persistence failure makes the writer unavailable until disk readback", async (t) => {
  const { runtime } = await fixture(t);
  await installAndActivate(runtime);
  runtime.control.currentPath = runtime.control.revisionsPath; // rename to a directory fails
  await assert.rejects(runtime.purgeProject(identity));
  assert.equal(runtime.control.isReady(), false);
  await assert.rejects(runtime.installRelease({ projectId: identity.projectId, releaseId: "unsafe-retry", files: files("retry") }), { code: "CONTROL_UNAVAILABLE" });
});
