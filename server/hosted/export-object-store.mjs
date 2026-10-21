import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink
} from "node:fs/promises";
import path from "node:path";

import { invariant } from "./errors.mjs";

const MAXIMUM_EXPORT_BYTES = 20 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeId(value, field) {
  const selected = String(value ?? "");
  invariant(
    SAFE_ID.test(selected) && selected !== "." && selected !== "..",
    "OBJECT_KEY_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function positiveSequence(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected > 0,
    "OBJECT_KEY_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function exportKey({
  organizationId,
  projectId,
  exportId,
  attempt,
  fence
}) {
  const selectedAttempt = positiveSequence(
    attempt,
    "Export attempt"
  );
  const selectedFence = positiveSequence(
    fence,
    "Export fence"
  );
  return [
    "exports",
    safeId(organizationId, "Organization ID"),
    safeId(projectId, "Project ID"),
    safeId(exportId, "Export ID"),
    `attempt-${selectedAttempt}-fence-${selectedFence}.zip`
  ].join("/");
}

function validateKey(value) {
  const selected = String(value ?? "");
  const parts = selected.split("/");
  const legacy =
    parts.length === 4 &&
    parts[0] === "exports" &&
    SAFE_ID.test(parts[1]) &&
    SAFE_ID.test(parts[2]) &&
    parts[3].endsWith(".zip") &&
    SAFE_ID.test(parts[3].slice(0, -4));
  const fenced =
    parts.length === 5 &&
    parts[0] === "exports" &&
    SAFE_ID.test(parts[1]) &&
    SAFE_ID.test(parts[2]) &&
    SAFE_ID.test(parts[3]) &&
    /^attempt-[1-9][0-9]{0,15}-fence-[1-9][0-9]{0,15}\.zip$/u
      .test(parts[4]);
  invariant(
    legacy || fenced,
    "OBJECT_KEY_INVALID",
    "Export object key is invalid.",
    { status: 400 }
  );
  return selected;
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sharedMetadataSafe(info, access, directory) {
  return access === null || (info.gid === access.groupId &&
    access.writerUids.includes(info.uid) &&
    (info.mode & 0o7777) === (directory ? 0o2770 : 0o640));
}

async function ensurePrivateDirectory(root, target, access = null) {
  const relative = path.relative(root, target);
  invariant(
    relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative)),
    "OBJECT_PATH_ESCAPE",
    "Export path escapes its configured root.",
    { status: 500 }
  );
  const parts = relative ? relative.split(path.sep) : [];
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let created = false;
    try {
      await mkdir(cursor, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let info = await lstat(cursor);
    invariant(
      info.isDirectory() && !info.isSymbolicLink(),
      "OBJECT_PATH_UNSAFE",
      "Export directory is unsafe.",
      { status: 500 }
    );
    if (access === null) {
      await chmod(cursor, 0o700);
    } else {
      if (created) {
        invariant(info.uid === process.getuid() && info.gid === access.groupId,
          "OBJECT_PATH_UNSAFE", "Export directory identity is invalid.", { status: 500 });
        await chmod(cursor, 0o2770);
        info = await lstat(cursor);
      }
      invariant(sharedMetadataSafe(info, access, true), "OBJECT_PATH_UNSAFE",
        "Export directory permissions are invalid.", { status: 500 });
    }
  }
}

async function readPrivateFile(root, target, maximumBytes, access = null) {
  const relative = path.relative(root, target);
  invariant(
    relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative),
    "OBJECT_PATH_ESCAPE",
    "Export path escapes its configured root.",
    { status: 500 }
  );
  let cursor = root;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const info = await lstat(cursor);
    invariant(
      !info.isSymbolicLink(),
      "OBJECT_PATH_UNSAFE",
      "Symbolic links are forbidden in the export store.",
      { status: 500 }
    );
    invariant(
      index === parts.length - 1 ? info.isFile() : info.isDirectory(),
      "OBJECT_PATH_UNSAFE",
      "Export path has an invalid file type.",
      { status: 500 }
    );
    invariant(sharedMetadataSafe(info, access, index !== parts.length - 1),
      "OBJECT_PATH_UNSAFE", "Export object permissions are invalid.", { status: 500 });
  }
  const flags =
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags);
  try {
    const info = await handle.stat();
    invariant(
      info.isFile() && info.size <= maximumBytes && sharedMetadataSafe(info, access, false),
      "OBJECT_TOO_LARGE",
      "Export object exceeds its size limit.",
      { status: 500 }
    );
    return handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function createPrivateExportObjectStore({
  root,
  maximumBytes = MAXIMUM_EXPORT_BYTES,
  sharedGroupId = null,
  writerUids = null
} = {}) {
  const id = value => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
  invariant((sharedGroupId === null && writerUids === null) ||
    (id(sharedGroupId) && Array.isArray(writerUids) && writerUids.length >= 1 &&
      writerUids.length <= 2 && writerUids.every(id) && new Set(writerUids).size === writerUids.length &&
      writerUids.includes(process.getuid?.())), "OBJECT_STORE_CONFIGURATION_ERROR",
    "Shared exports require an exact private group and active writer identities.", { status: 500 });
  const access = sharedGroupId === null ? null : { groupId: sharedGroupId, writerUids: [...writerUids] };
  invariant(
    typeof root === "string" &&
      path.isAbsolute(root) &&
      path.resolve(root) !== path.parse(path.resolve(root)).root,
    "OBJECT_STORE_CONFIGURATION_ERROR",
    "A private absolute export root is required.",
    { status: 500 }
  );
  invariant(
    Number.isSafeInteger(maximumBytes) &&
      maximumBytes > 0 &&
      maximumBytes <= MAXIMUM_EXPORT_BYTES,
    "OBJECT_STORE_CONFIGURATION_ERROR",
    "Export object size limit is invalid.",
    { status: 500 }
  );
  // Shared roots are provisioned by the operator with pinned identities. The
  // public process cannot turn an arbitrary existing directory into a store.
  if (access === null) await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  invariant(
    rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && sharedMetadataSafe(rootInfo, access, true),
    "OBJECT_STORE_CONFIGURATION_ERROR",
    "Export object root is unsafe.",
    { status: 500 }
  );
  if (access === null) await chmod(root, 0o700);
  const canonicalRoot = await realpath(root);
  await ensurePrivateDirectory(canonicalRoot, path.join(canonicalRoot, "exports"), access);

  function targetFor(key) {
    return path.join(canonicalRoot, ...validateKey(key).split("/"));
  }

  async function readByKey(key) {
    const selected = validateKey(key);
    const bytes = await readPrivateFile(
      canonicalRoot,
      targetFor(selected),
      maximumBytes,
      access
    );
    return {
      key: selected,
      bytes,
      sha256: digest(bytes),
      byteLength: bytes.byteLength
    };
  }

  return Object.freeze({
    kind: "private-filesystem",
    root: canonicalRoot,
    maximumBytes,

    key(input) {
      return exportKey(input);
    },

    async put(input) {
      const key = exportKey(input);
      const bytes = Buffer.from(input.bytes ?? []);
      invariant(
        bytes.byteLength > 0 && bytes.byteLength <= maximumBytes,
        "OBJECT_TOO_LARGE",
        "Export object exceeds its size limit.",
        { status: 500 }
      );
      const sha256 = digest(bytes);
      if (input.expectedSha256 !== undefined) {
        invariant(
          SHA256.test(input.expectedSha256) &&
            input.expectedSha256 === sha256,
          "OBJECT_DIGEST_MISMATCH",
          "Export object does not match its expected checksum.",
          { status: 500 }
        );
      }
      const target = targetFor(key);
      const directory = path.dirname(target);
      await ensurePrivateDirectory(canonicalRoot, directory, access);
      try {
        const existing = await readByKey(key);
        invariant(
          existing.sha256 === sha256 &&
            existing.byteLength === bytes.byteLength,
          "OBJECT_KEY_CONFLICT",
          "Export object key already contains different bytes.",
          { status: 409 }
        );
        return {
          key,
          sha256,
          byteLength: bytes.byteLength,
          replay: true
        };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }

      const temporary = path.join(
        directory,
        `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      );
      let handle;
      try {
        handle = await open(
          temporary,
          fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            fsConstants.O_WRONLY |
            (fsConstants.O_NOFOLLOW ?? 0),
          0o600
        );
        if (access !== null) {
          const metadata = await handle.stat();
          invariant(metadata.uid === process.getuid() && metadata.gid === access.groupId,
            "OBJECT_PATH_UNSAFE", "Export object identity is invalid.", { status: 500 });
        }
        await handle.writeFile(bytes);
        if (access !== null) await handle.chmod(0o640);
        await handle.sync();
        await handle.close();
        handle = null;
        try {
          await link(temporary, target);
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
          const existing = await readByKey(key);
          invariant(
            existing.sha256 === sha256 &&
              existing.byteLength === bytes.byteLength,
            "OBJECT_KEY_CONFLICT",
            "Concurrent export write conflicts with immutable bytes.",
            { status: 409 }
          );
        }
        if (access === null) await chmod(target, 0o600);
        await syncDirectory(directory);
      } finally {
        if (handle) await handle.close().catch(() => {});
        await unlink(temporary).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      }
      return {
        key,
        sha256,
        byteLength: bytes.byteLength,
        replay: false
      };
    },

    async get({ key, expectedSha256, expectedByteLength }) {
      const object = await readByKey(key);
      invariant(
        SHA256.test(expectedSha256) &&
          object.sha256 === expectedSha256 &&
          Number(expectedByteLength) === object.byteLength,
        "OBJECT_INTEGRITY_MISMATCH",
        "Export object failed checksum verification.",
        { status: 500 }
      );
      return object;
    },

    async delete({ key }) {
      const selected = validateKey(key);
      const target = targetFor(selected);
      try {
        await readPrivateFile(canonicalRoot, target, maximumBytes, access);
        await unlink(target);
      } catch (error) {
        if (error?.code === "ENOENT") {
          // Retry after an unlink/fsync failure must make absence durable too.
          // Walk only verified parents, syncing the nearest existing ancestor
          // if this object (or an entire project directory) is already absent.
          let directory = canonicalRoot;
          for (const part of selected.split("/").slice(0, -1)) {
            const next = path.join(directory, part);
            let info;
            try { info = await lstat(next); }
            catch (missing) {
              if (missing.code === "ENOENT") break;
              throw missing;
            }
            invariant(info.isDirectory() && !info.isSymbolicLink(),
              "OBJECT_PATH_UNSAFE", "Export deletion parent is unsafe.", { status: 500 });
            directory = next;
          }
          await syncDirectory(directory);
          return { deleted: false, key: selected };
        }
        throw error;
      }
      await syncDirectory(path.dirname(target));
      return { deleted: true, key: selected };
    },

    async backupManifest() {
      const base = path.join(canonicalRoot, "exports");
      const entries = [];

      async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          invariant(
            !entry.isSymbolicLink(),
            "OBJECT_PATH_UNSAFE",
            "Backup refused because the export store contains a symbolic link.",
            { status: 500 }
          );
          if (entry.isDirectory()) {
            await walk(target);
          } else {
            invariant(
              entry.isFile(),
              "OBJECT_PATH_UNSAFE",
              "Backup refused because the export store contains a special file.",
              { status: 500 }
            );
            const key = path.relative(canonicalRoot, target).split(path.sep).join("/");
            const object = await readByKey(key);
            entries.push({
              key,
              sha256: object.sha256,
              byteLength: object.byteLength,
              requiredMode: "0600"
            });
          }
        }
      }

      await walk(base);
      entries.sort((left, right) => left.key.localeCompare(right.key));
      const payload = {
        schema: "sitesourcery.private-export-backup/v1",
        rootMode: "0700",
        entries
      };
      return {
        ...payload,
        manifestSha256: digest(
          Buffer.from(JSON.stringify(payload), "utf8")
        )
      };
    }
  });
}
