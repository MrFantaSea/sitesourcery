import assert from "node:assert/strict";
import test from "node:test";

import { createProjectLifecycleExecutor } from
  "../project-lifecycle-postgres.mjs";

function fixture() {
  const calls = [];
  const executor = createProjectLifecycleExecutor({
    objectStore: {
      async delete(input) {
        calls.push(["delete", input]);
        return { deleted: true, key: input.key };
      }
    },
    publicationPort: {
      async purgeProject(input) {
        calls.push(["purgeProject", input]);
        return { schema: "sitesourcery.publication-erasure/v1", ...input,
          erased: true, published: false, terminal: true };
      },
      async unpublish(input) {
        calls.push(["unpublish", input]);
        return { published: false };
      }
    }
  });
  return { executor, calls };
}

test("retention expiry stops at explicit deletion approval", async () => {
  const selected = fixture();
  const result = await selected.executor.execute({ jobType: "retention_expiry" });
  assert.equal(result.receiptKind, "approval_required");
  assert.deepEqual(selected.calls, []);
});

test("sealed purge jobs use only their exact publication and object ports", async () => {
  const selected = fixture();
  assert.equal((await selected.executor.execute({
    jobType: "unpublish_project",
    projectId: "project-1",
    payload: { hostname: "example.test" }
  })).receiptKind, "publication_removed");
  assert.equal((await selected.executor.execute({
    jobType: "delete_blob",
    organizationId: "org", projectId: "project",
    payload: { storageKind: "private_export", objectKey: "exports/org/project/export/attempt-1-fence-1.zip" }
  })).receiptKind, "blob_deleted");
  assert.deepEqual(selected.calls.map(([kind]) => kind), ["unpublish", "delete"]);
});

test("publication removal needs an exact dark readback before completion", async () => {
  const executor = createProjectLifecycleExecutor({
    objectStore: { async delete() { return { deleted: true }; } },
    publicationPort: { async unpublish() { return { published: true }; }, async purgeProject() {} }
  });
  await assert.rejects(
    executor.execute({
      jobType: "unpublish_project",
      projectId: "project-1",
      payload: { hostname: "example.test" }
    }),
    (error) => error?.code === "PROJECT_LIFECYCLE_EFFECT_UNCONFIRMED"
  );
});

test("finalization requires project-bound terminal erasure before the database transition", async () => {
  const selected = fixture();
  const identity = { organizationId: "10000000-0000-4000-8000-000000000001",
    projectId: "10000000-0000-4000-8000-000000000002",
    deletionRequestId: "10000000-0000-4000-8000-000000000003" };
  const result = await selected.executor.execute({ jobType: "finalize_deletion",
    ...identity, payload: { deletionRequestId: identity.deletionRequestId } });
  assert.equal(result.receiptKind, "project_deleted");
  assert.deepEqual(selected.calls, [["purgeProject", identity]]);
});

test("unknown replicas, absent provenance and foreign export keys never reach the filesystem", async () => {
  for (const payload of [
    { objectKey: "exports/org/project/file.zip" },
    { storageKind: "unsupported", objectKey: "exports/org/project/file.zip" },
    { storageKind: "private_export", objectKey: "exports/other/project/file.zip" }
  ]) {
    const selected = fixture();
    await assert.rejects(selected.executor.execute({ jobType: "delete_blob",
      organizationId: "org", projectId: "project", payload }),
    { code: "PROJECT_LIFECYCLE_STORAGE_UNSUPPORTED" });
    assert.deepEqual(selected.calls, []);
  }
});
