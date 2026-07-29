import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPrivateExportObjectStore } from "../export-object-store.mjs";

async function storeRoot() {
  return mkdtemp(path.join(os.tmpdir(), "sitesourcery-export-store-"));
}

const identity = Object.freeze({
  organizationId: "org_00000001",
  projectId: "project_00000001",
  exportId: "export_00000001"
});

test("private export store atomically persists and verifies exact tenant bytes", async () => {
  const root = await storeRoot();
  const store = await createPrivateExportObjectStore({ root });
  const bytes = Buffer.from("PK\u0003\u0004exact project export", "utf8");
  const saved = await store.put({ ...identity, bytes });
  assert.equal(saved.replay, false);
  assert.equal(saved.key, "exports/org_00000001/project_00000001/export_00000001.zip");
  const replay = await store.put({ ...identity, bytes });
  assert.equal(replay.replay, true);
  const loaded = await store.get({
    key: saved.key,
    expectedSha256: saved.sha256,
    expectedByteLength: saved.byteLength
  });
  assert.deepEqual(loaded.bytes, bytes);
  const rootMode = (await lstat(root)).mode & 0o777;
  const fileMode =
    (
      await lstat(
        path.join(root, ...saved.key.split("/"))
      )
    ).mode & 0o777;
  assert.equal(rootMode, 0o700);
  assert.equal(fileMode, 0o600);
});

test("object keys are immutable and restart-safe", async () => {
  const root = await storeRoot();
  let store = await createPrivateExportObjectStore({ root });
  const first = await store.put({
    ...identity,
    bytes: Buffer.from("first immutable export")
  });
  await assert.rejects(
    store.put({
      ...identity,
      bytes: Buffer.from("different immutable export")
    }),
    (error) => error?.code === "OBJECT_KEY_CONFLICT"
  );
  store = await createPrivateExportObjectStore({ root });
  const loaded = await store.get({
    key: first.key,
    expectedSha256: first.sha256,
    expectedByteLength: first.byteLength
  });
  assert.equal(loaded.bytes.toString("utf8"), "first immutable export");
});

test("tampering and symlink substitution fail closed", async () => {
  const root = await storeRoot();
  const store = await createPrivateExportObjectStore({ root });
  const saved = await store.put({
    ...identity,
    bytes: Buffer.from("trusted export bytes")
  });
  const target = path.join(root, ...saved.key.split("/"));
  await writeFile(target, "tampered bytes");
  await assert.rejects(
    store.get({
      key: saved.key,
      expectedSha256: saved.sha256,
      expectedByteLength: saved.byteLength
    }),
    (error) => error?.code === "OBJECT_INTEGRITY_MISMATCH"
  );

  const secondRoot = await storeRoot();
  const second = await createPrivateExportObjectStore({ root: secondRoot });
  const outside = path.join(secondRoot, "outside.zip");
  await writeFile(outside, "outside");
  const targetDirectory = path.join(
    secondRoot,
    "exports",
    identity.organizationId,
    identity.projectId
  );
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  await chmod(targetDirectory, 0o700);
  await symlink(
    outside,
    path.join(targetDirectory, `${identity.exportId}.zip`)
  );
  await assert.rejects(
    second.get({
      key: second.key(identity),
      expectedSha256: "0".repeat(64),
      expectedByteLength: 7
    }),
    (error) => error?.code === "OBJECT_PATH_UNSAFE"
  );
});

test("backup manifest and cleanup enumerate only exact private objects", async () => {
  const root = await storeRoot();
  const store = await createPrivateExportObjectStore({ root });
  const saved = await store.put({
    ...identity,
    bytes: Buffer.from("backup exact bytes")
  });
  const manifest = await store.backupManifest();
  assert.equal(manifest.schema, "sitesourcery.private-export-backup/v1");
  assert.equal(manifest.rootMode, "0700");
  assert.deepEqual(manifest.entries, [
    {
      key: saved.key,
      sha256: saved.sha256,
      byteLength: saved.byteLength,
      requiredMode: "0600"
    }
  ]);
  assert.match(manifest.manifestSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(await store.delete({ key: saved.key }), {
    deleted: true,
    key: saved.key
  });
  assert.deepEqual(await store.delete({ key: saved.key }), {
    deleted: false,
    key: saved.key
  });
  assert.deepEqual((await store.backupManifest()).entries, []);
});
