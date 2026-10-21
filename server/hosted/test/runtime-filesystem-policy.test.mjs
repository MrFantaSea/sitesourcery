import assert from "node:assert/strict";
import test from "node:test";
import { exportStoreAccessFromEnvironment, workerHealthAccessFromEnvironment,
  runtimeIdFromEnvironment } from "../runtime-filesystem-policy.mjs";

test("runtime sharing requires complete canonical non-root identity bindings", () => {
  for (const value of ["", "0", "-1", " 123", "123 ", "01", "1e3", "1.0", "2147483648", "nobody"]) {
    assert.throws(() => runtimeIdFromEnvironment({ ID: value }, "ID"), TypeError);
  }
  assert.equal(runtimeIdFromEnvironment({}, "ID"), null);
  assert.throws(() => workerHealthAccessFromEnvironment({ SITESOURCERY_EXPORT_WORKER_UID: "123" }), TypeError);
  assert.throws(() => workerHealthAccessFromEnvironment({ SITESOURCERY_EXPORT_HEALTH_GROUP_ID: "124" }), TypeError);
  assert.deepEqual(workerHealthAccessFromEnvironment({ SITESOURCERY_EXPORT_WORKER_UID: "123",
    SITESOURCERY_EXPORT_HEALTH_GROUP_ID: "124" }), { filePath: undefined, ownerUid: 123, sharedGroupId: 124 });
  for (const value of [undefined, "", "0", "123,123", "123, 124", "123,124,125"]) {
    assert.throws(() => exportStoreAccessFromEnvironment({ SITESOURCERY_EXPORT_GROUP_ID: "126",
      SITESOURCERY_EXPORT_WRITER_UIDS: value }), TypeError);
  }
  assert.deepEqual(exportStoreAccessFromEnvironment({ SITESOURCERY_EXPORT_GROUP_ID: "126",
    SITESOURCERY_EXPORT_WRITER_UIDS: "123,124" }), { sharedGroupId: 126, writerUids: [123, 124] });
});
