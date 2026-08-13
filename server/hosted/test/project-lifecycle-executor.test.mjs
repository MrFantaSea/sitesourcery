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
        return { deleted: true };
      }
    },
    publicationPort: {
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
    payload: { objectKey: "exports/org/project/export/attempt-1-fence-1.zip" }
  })).receiptKind, "blob_deleted");
  assert.deepEqual(selected.calls.map(([kind]) => kind), ["unpublish", "delete"]);
});

test("publication removal needs an exact dark readback before completion", async () => {
  const executor = createProjectLifecycleExecutor({
    objectStore: { async delete() { return { deleted: true }; } },
    publicationPort: { async unpublish() { return { published: true }; } }
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

test("finalization remains a repository-owned database transition", async () => {
  const selected = fixture();
  const result = await selected.executor.execute({ jobType: "finalize_deletion" });
  assert.equal(result.receiptKind, "project_deleted");
  assert.deepEqual(selected.calls, []);
});
