import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { invariant } from "./errors.mjs";

export async function ensureDirectory(directory, mode = 0o750) {
  invariant(path.isAbsolute(directory), "INVALID_ROOT", "data root must be absolute");
  await mkdir(directory, { recursive: true, mode });
  const info = await lstat(directory);
  invariant(info.isDirectory() && !info.isSymbolicLink(), "UNSAFE_ROOT", "directory is unsafe");
  return realpath(directory);
}

export async function openExistingDirectory(directory) {
  invariant(
    path.isAbsolute(directory) && path.normalize(directory) === directory,
    "INVALID_ROOT",
    "existing data root must be an absolute normalized path"
  );
  const info = await lstat(directory);
  invariant(
    info.isDirectory() && !info.isSymbolicLink(),
    "UNSAFE_ROOT",
    "existing directory is unsafe"
  );
  const resolved = await realpath(directory);
  invariant(
    resolved === directory,
    "UNSAFE_ROOT",
    "existing directory resolves to a different path"
  );
  return resolved;
}

export async function assertNoSymlinkPath(root, target, { finalType = "file" } = {}) {
  const canonicalRoot = await realpath(root);
  const relative = path.relative(canonicalRoot, target);
  invariant(
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative),
    "PATH_ESCAPE",
    "path escapes its configured root"
  );
  let cursor = canonicalRoot;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const info = await lstat(cursor);
    invariant(!info.isSymbolicLink(), "SYMLINK_FORBIDDEN", "symbolic links are forbidden");
    const isFinal = index === parts.length - 1;
    if (!isFinal) {
      invariant(info.isDirectory(), "PATH_TYPE_INVALID", "path parent is not a directory");
    } else if (finalType === "file") {
      invariant(info.isFile(), "PATH_TYPE_INVALID", "path is not a regular file");
    } else if (finalType === "directory") {
      invariant(info.isDirectory(), "PATH_TYPE_INVALID", "path is not a directory");
    }
  }
  const resolved = await realpath(target);
  invariant(
    resolved.startsWith(`${canonicalRoot}${path.sep}`),
    "PATH_ESCAPE",
    "resolved path escapes its configured root"
  );
  return resolved;
}

export async function readRegularFileNoFollow(root, target, maximumBytes) {
  await assertNoSymlinkPath(root, target, { finalType: "file" });
  const flags = FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0);
  const handle = await open(target, flags);
  try {
    const info = await handle.stat();
    invariant(info.isFile(), "PATH_TYPE_INVALID", "path is not a regular file");
    invariant(info.size <= maximumBytes, "FILE_TOO_LARGE", "file exceeds its size limit");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function atomicWriteFile(target, bytes, { mode = 0o640 } = {}) {
  const directory = path.dirname(target);
  await ensureDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporary,
      FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY,
      mode
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeExclusiveFile(target, bytes, { mode = 0o440 } = {}) {
  const directory = path.dirname(target);
  await ensureDirectory(directory);
  const handle = await open(
    target,
    FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL | FS_CONSTANTS.O_WRONLY,
    mode
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
}

export async function syncDirectory(directory) {
  const handle = await open(directory, FS_CONSTANTS.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function readBoundedJson(root, target, maximumBytes = 5 * 1024 * 1024) {
  const bytes = await readRegularFileNoFollow(root, target, maximumBytes);
  return JSON.parse(bytes.toString("utf8"));
}

export async function makeTreeReadOnly(root) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    invariant(!entry.isSymbolicLink(), "SYMLINK_FORBIDDEN", "release contains a symlink");
    if (entry.isDirectory()) {
      await makeTreeReadOnly(target);
      await chmod(target, 0o550);
    } else {
      invariant(entry.isFile(), "PATH_TYPE_INVALID", "release contains a non-file");
      await chmod(target, 0o440);
    }
  }
  await chmod(root, 0o550);
}
