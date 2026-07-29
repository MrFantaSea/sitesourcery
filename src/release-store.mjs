import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { canonicalJson, jsonEnvelope, sha256, verifyEnvelope } from "./canonical.mjs";
import { fail, invariant } from "./errors.mjs";
import {
  assertNoSymlinkPath,
  ensureDirectory,
  exists,
  makeTreeReadOnly,
  readBoundedJson,
  readRegularFileNoFollow,
  syncDirectory,
  writeExclusiveFile
} from "./filesystem.mjs";
import {
  bytes as coerceBytes,
  contentType,
  nonNegativeInteger,
  relativeFilePath,
  safeId
} from "./validation.mjs";

const MANIFEST_SCHEMA = "sitesourcery.immutable-release/v1";
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;

export class ReleaseStore {
  constructor({
    root,
    clock = () => new Date().toISOString(),
    maximumFileBytes = 10 * 1024 * 1024,
    maximumReleaseBytes = 100 * 1024 * 1024,
    maximumFiles = 2_000
  }) {
    this.root = root;
    this.clock = clock;
    this.maximumFileBytes = nonNegativeInteger(maximumFileBytes, "maximumFileBytes");
    this.maximumReleaseBytes = nonNegativeInteger(
      maximumReleaseBytes,
      "maximumReleaseBytes"
    );
    this.maximumFiles = nonNegativeInteger(maximumFiles, "maximumFiles");
  }

  static async open(options) {
    const root = await ensureDirectory(path.resolve(options.root), 0o750);
    return new ReleaseStore({ ...options, root });
  }

  releaseDirectory(projectId, releaseId) {
    return path.join(this.root, safeId(projectId, "projectId"), safeId(releaseId, "releaseId"));
  }

  async install({ projectId, releaseId, files }) {
    safeId(projectId, "projectId");
    safeId(releaseId, "releaseId");
    invariant(
      Array.isArray(files) && files.length > 0 && files.length <= this.maximumFiles,
      "INVALID_RELEASE",
      "release file count is invalid"
    );
    const normalized = [];
    const seen = new Set();
    let totalBytes = 0;
    for (const supplied of files) {
      invariant(
        supplied && typeof supplied === "object" && !Array.isArray(supplied),
        "INVALID_RELEASE",
        "release file is invalid"
      );
      const filePath = relativeFilePath(supplied.path);
      invariant(!seen.has(filePath), "DUPLICATE_RELEASE_PATH", "release path is duplicated");
      seen.add(filePath);
      const fileBytes = coerceBytes(supplied.bytes);
      invariant(
        fileBytes.byteLength <= this.maximumFileBytes,
        "FILE_TOO_LARGE",
        "release file exceeds its limit"
      );
      totalBytes += fileBytes.byteLength;
      invariant(
        totalBytes <= this.maximumReleaseBytes,
        "RELEASE_TOO_LARGE",
        "release exceeds its total size limit"
      );
      normalized.push({
        path: filePath,
        bytes: fileBytes,
        byteLength: fileBytes.byteLength,
        sha256: sha256(fileBytes),
        contentType: contentType(supplied.contentType)
      });
    }
    invariant(seen.has("index.html"), "INDEX_REQUIRED", "release requires index.html");
    normalized.sort((left, right) => left.path.localeCompare(right.path));

    const projectRoot = await ensureDirectory(path.join(this.root, projectId), 0o750);
    await assertNoSymlinkPath(this.root, projectRoot, { finalType: "directory" });
    const finalDirectory = path.join(projectRoot, releaseId);
    if (await exists(finalDirectory)) {
      const existing = await this.getManifest(projectId, releaseId);
      invariant(
        sameFileSet(existing.files, normalized),
        "RELEASE_CONFLICT",
        "release ID already exists with different immutable content"
      );
      return existing;
    }

    const temporary = path.join(
      projectRoot,
      `.stage-${releaseId}-${process.pid}-${randomBytes(8).toString("hex")}`
    );
    await mkdir(temporary, { mode: 0o750 });
    try {
      for (const file of normalized) {
        const target = path.join(temporary, ...file.path.split("/"));
        await mkdir(path.dirname(target), { recursive: true, mode: 0o750 });
        await writeExclusiveFile(target, file.bytes, { mode: 0o440 });
      }
      const payload = {
        projectId,
        releaseId,
        createdAt: this.clock(),
        totalBytes,
        files: normalized.map(({ bytes: ignored, ...metadata }) => metadata)
      };
      const envelope = jsonEnvelope(MANIFEST_SCHEMA, payload);
      await writeExclusiveFile(
        path.join(temporary, "release-manifest.json"),
        Buffer.from(`${canonicalJson(envelope)}\n`, "utf8"),
        { mode: 0o440 }
      );
      await makeTreeReadOnly(temporary);
      try {
        await rename(temporary, finalDirectory);
      } catch (error) {
        if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
          const existing = await this.getManifest(projectId, releaseId);
          invariant(
            sameFileSet(existing.files, normalized),
            "RELEASE_CONFLICT",
            "concurrent release install conflicts"
          );
          return existing;
        }
        throw error;
      }
      await syncDirectory(projectRoot);
      return { ...payload, manifestDigest: envelope.checksum };
    } catch (error) {
      // A stage directory is never addressable by hostname and is left for
      // explicit recovery inspection if it became read-only before failure.
      throw error;
    }
  }

  async getManifest(projectId, releaseId) {
    const directory = this.releaseDirectory(projectId, releaseId);
    await assertNoSymlinkPath(this.root, directory, { finalType: "directory" });
    const manifestPath = path.join(directory, "release-manifest.json");
    const envelope = await readBoundedJson(this.root, manifestPath, MAX_MANIFEST_BYTES);
    invariant(
      verifyEnvelope(envelope, MANIFEST_SCHEMA),
      "MANIFEST_CORRUPT",
      "release manifest checksum is invalid"
    );
    const payload = validateManifest(envelope.payload, projectId, releaseId);
    return { ...payload, manifestDigest: envelope.checksum };
  }

  async read(projectId, releaseId, filePath) {
    const normalizedPath = relativeFilePath(filePath);
    invariant(
      normalizedPath !== "release-manifest.json",
      "FILE_NOT_FOUND",
      "internal manifest is not a tenant asset"
    );
    const manifest = await this.getManifest(projectId, releaseId);
    const metadata = manifest.files.find((candidate) => candidate.path === normalizedPath);
    if (!metadata) return null;
    const directory = this.releaseDirectory(projectId, releaseId);
    const target = path.join(directory, ...normalizedPath.split("/"));
    const fileBytes = await readRegularFileNoFollow(
      directory,
      target,
      this.maximumFileBytes
    );
    invariant(
      fileBytes.byteLength === metadata.byteLength && sha256(fileBytes) === metadata.sha256,
      "ARTIFACT_CORRUPT",
      "release artifact integrity check failed"
    );
    return {
      bytes: fileBytes,
      contentType: metadata.contentType,
      sha256: metadata.sha256,
      byteLength: metadata.byteLength,
      manifestDigest: manifest.manifestDigest
    };
  }
}

function sameFileSet(existing, candidate) {
  return (
    existing.length === candidate.length &&
    existing.every((file, index) => {
      const other = candidate[index];
      return (
        file.path === other.path &&
        file.byteLength === other.byteLength &&
        file.sha256 === other.sha256 &&
        file.contentType === other.contentType
      );
    })
  );
}

function validateManifest(payload, expectedProjectId, expectedReleaseId) {
  invariant(payload && typeof payload === "object", "MANIFEST_CORRUPT", "manifest is invalid");
  invariant(
    payload.projectId === expectedProjectId && payload.releaseId === expectedReleaseId,
    "MANIFEST_CORRUPT",
    "manifest identity is invalid"
  );
  invariant(
    typeof payload.createdAt === "string" && !Number.isNaN(Date.parse(payload.createdAt)),
    "MANIFEST_CORRUPT",
    "manifest date is invalid"
  );
  nonNegativeInteger(payload.totalBytes, "manifest.totalBytes");
  invariant(Array.isArray(payload.files) && payload.files.length > 0, "MANIFEST_CORRUPT", "files missing");
  let computedTotal = 0;
  const seen = new Set();
  const files = payload.files.map((file) => {
    const filePath = relativeFilePath(file.path);
    invariant(!seen.has(filePath), "MANIFEST_CORRUPT", "duplicate manifest file");
    seen.add(filePath);
    const byteLength = nonNegativeInteger(file.byteLength, "manifest.byteLength");
    invariant(
      typeof file.sha256 === "string" && /^[a-f0-9]{64}$/u.test(file.sha256),
      "MANIFEST_CORRUPT",
      "manifest digest is invalid"
    );
    computedTotal += byteLength;
    return {
      path: filePath,
      byteLength,
      sha256: file.sha256,
      contentType: contentType(file.contentType)
    };
  });
  invariant(computedTotal === payload.totalBytes, "MANIFEST_CORRUPT", "manifest size is invalid");
  return {
    projectId: expectedProjectId,
    releaseId: expectedReleaseId,
    createdAt: payload.createdAt,
    totalBytes: payload.totalBytes,
    files
  };
}

export { MANIFEST_SCHEMA };
