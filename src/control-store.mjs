import path from "node:path";
import { readdir } from "node:fs/promises";
import { canonicalJson, jsonEnvelope, verifyEnvelope } from "./canonical.mjs";
import { fail, invariant } from "./errors.mjs";
import {
  atomicWriteFile,
  ensureDirectory,
  exists,
  readBoundedJson,
  writeExclusiveFile
} from "./filesystem.mjs";
import { normalizeHostname } from "./hostname.mjs";
import { nonNegativeInteger, safeId } from "./validation.mjs";

export const CONTROL_SCHEMA = "sitesourcery.selfhost-control/v1";

export class ControlStore {
  #tail = Promise.resolve();

  constructor({ root, currentPath, revisionsPath, clock, state, error = null }) {
    this.root = root;
    this.currentPath = currentPath;
    this.revisionsPath = revisionsPath;
    this.clock = clock;
    this.state = state;
    this.error = error;
  }

  static async open({ root, clock = () => new Date().toISOString() }) {
    const canonicalRoot = await ensureDirectory(path.resolve(root), 0o750);
    const revisionsPath = await ensureDirectory(
      path.join(canonicalRoot, "revisions"),
      0o750
    );
    const currentPath = path.join(canonicalRoot, "current.json");
    if (!(await exists(currentPath))) {
      const payload = initialState(clock());
      const envelope = jsonEnvelope(CONTROL_SCHEMA, payload);
      await persistEnvelope(currentPath, revisionsPath, envelope);
    }
    try {
      const envelope = await readBoundedJson(canonicalRoot, currentPath);
      invariant(
        verifyEnvelope(envelope, CONTROL_SCHEMA),
        "CONTROL_CORRUPT",
        "control state checksum is invalid"
      );
      const state = validateState(envelope.payload);
      return new ControlStore({
        root: canonicalRoot,
        currentPath,
        revisionsPath,
        clock,
        state
      });
    } catch (error) {
      return new ControlStore({
        root: canonicalRoot,
        currentPath,
        revisionsPath,
        clock,
        state: null,
        error
      });
    }
  }

  isReady() {
    return this.state !== null && this.error === null;
  }

  readiness() {
    return this.isReady()
      ? { ready: true, revision: this.state.revision }
      : {
          ready: false,
          revision: null,
          code: this.error?.code ?? "CONTROL_UNAVAILABLE"
        };
  }

  snapshot() {
    invariant(this.isReady(), "CONTROL_UNAVAILABLE", "control store is not ready");
    return structuredClone(this.state);
  }

  lookup(hostname) {
    invariant(this.isReady(), "CONTROL_UNAVAILABLE", "control store is not ready");
    const normalized = normalizeHostname(hostname);
    if (!normalized) return null;
    const binding = this.state.hostnames[normalized];
    return binding ? structuredClone(binding) : null;
  }

  release(projectId, releaseId) {
    invariant(this.isReady(), "CONTROL_UNAVAILABLE", "control store is not ready");
    const release = this.state.releases[releaseKey(projectId, releaseId)];
    return release ? structuredClone(release) : null;
  }

  async registerRelease({ projectId, releaseId, manifestDigest, totalBytes, fileCount }) {
    return this.#mutate((next) => {
      safeId(projectId, "projectId");
      safeId(releaseId, "releaseId");
      invariant(
        typeof manifestDigest === "string" && /^[a-f0-9]{64}$/u.test(manifestDigest),
        "INVALID_MANIFEST_DIGEST",
        "manifest digest is invalid"
      );
      nonNegativeInteger(totalBytes, "totalBytes");
      nonNegativeInteger(fileCount, "fileCount");
      const key = releaseKey(projectId, releaseId);
      const existing = next.releases[key];
      if (existing) {
        invariant(
          existing.manifestDigest === manifestDigest &&
            existing.totalBytes === totalBytes &&
            existing.fileCount === fileCount,
          "RELEASE_CONFLICT",
          "release metadata conflicts with an existing immutable release"
        );
        return;
      }
      next.releases[key] = {
        projectId,
        releaseId,
        manifestDigest,
        totalBytes,
        fileCount,
        registeredAt: this.clock()
      };
    });
  }

  async reserveHostname({
    hostname,
    projectId,
    source,
    tlsState = "pending",
    expectedAbsent = true
  }) {
    const normalized = normalizeHostname(hostname);
    invariant(normalized, "INVALID_HOSTNAME", "hostname is invalid");
    safeId(projectId, "projectId");
    invariant(["custom", "platform"].includes(source), "INVALID_SOURCE", "source is invalid");
    invariant(
      ["pending", "approved", "disabled"].includes(tlsState),
      "INVALID_TLS_STATE",
      "TLS state is invalid"
    );
    return this.#mutate((next) => {
      const current = next.hostnames[normalized];
      if (current) {
        invariant(
          !expectedAbsent &&
            current.projectId === projectId &&
            current.source === source,
          "HOSTNAME_CONFLICT",
          "hostname is already reserved"
        );
        return;
      }
      next.hostnames[normalized] = {
        hostname: normalized,
        projectId,
        source,
        status: "held",
        tlsState,
        currentReleaseId: null,
        previousReleaseId: null,
        revision: 1,
        createdAt: this.clock(),
        updatedAt: this.clock()
      };
    });
  }

  async setHostnameGate({ hostname, expectedRevision, status, tlsState }) {
    const normalized = normalizeHostname(hostname);
    invariant(normalized, "INVALID_HOSTNAME", "hostname is invalid");
    return this.#mutate((next) => {
      const binding = requireBinding(next, normalized, expectedRevision);
      if (status !== undefined) {
        invariant(["active", "dark", "held"].includes(status), "INVALID_STATUS", "status is invalid");
        binding.status = status;
      }
      if (tlsState !== undefined) {
        invariant(
          ["pending", "approved", "disabled"].includes(tlsState),
          "INVALID_TLS_STATE",
          "TLS state is invalid"
        );
        binding.tlsState = tlsState;
      }
      binding.revision += 1;
      binding.updatedAt = this.clock();
    });
  }

  async activate({ hostname, releaseId, expectedRevision }) {
    const normalized = normalizeHostname(hostname);
    invariant(normalized, "INVALID_HOSTNAME", "hostname is invalid");
    safeId(releaseId, "releaseId");
    return this.#mutate((next) => {
      const binding = requireBinding(next, normalized, expectedRevision);
      const release = next.releases[releaseKey(binding.projectId, releaseId)];
      invariant(release, "RELEASE_NOT_FOUND", "release is not registered for this project");
      if (binding.currentReleaseId === releaseId) return;
      binding.previousReleaseId = binding.currentReleaseId;
      binding.currentReleaseId = releaseId;
      binding.revision += 1;
      binding.updatedAt = this.clock();
    });
  }

  async rollback({ hostname, expectedRevision, targetReleaseId = null }) {
    const normalized = normalizeHostname(hostname);
    invariant(normalized, "INVALID_HOSTNAME", "hostname is invalid");
    return this.#mutate((next) => {
      const binding = requireBinding(next, normalized, expectedRevision);
      const target = targetReleaseId ?? binding.previousReleaseId;
      safeId(target, "targetReleaseId");
      invariant(
        target !== binding.currentReleaseId,
        "ROLLBACK_NOOP",
        "rollback target is already active"
      );
      invariant(
        next.releases[releaseKey(binding.projectId, target)],
        "RELEASE_NOT_FOUND",
        "rollback release is not registered for this project"
      );
      const formerCurrent = binding.currentReleaseId;
      binding.currentReleaseId = target;
      binding.previousReleaseId = formerCurrent;
      binding.revision += 1;
      binding.updatedAt = this.clock();
    });
  }

  async recoveryReport() {
    const revisions = (await readdir(this.revisionsPath))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const committedPrefix = this.isReady()
      ? `${String(this.state.revision).padStart(20, "0")}-`
      : null;
    return {
      ready: this.isReady(),
      currentRevision: this.state?.revision ?? null,
      historyFiles: revisions.length,
      currentRevisionSnapshotPresent: committedPrefix
        ? revisions.some((name) => name.startsWith(committedPrefix))
        : false,
      errorCode: this.error?.code ?? null
    };
  }

  async #mutate(mutator) {
    const job = this.#tail.then(async () => {
      invariant(this.isReady(), "CONTROL_UNAVAILABLE", "control store is not ready");
      const next = structuredClone(this.state);
      await mutator(next);
      next.revision += 1;
      next.updatedAt = this.clock();
      validateState(next);
      const envelope = jsonEnvelope(CONTROL_SCHEMA, next);
      await persistEnvelope(this.currentPath, this.revisionsPath, envelope);
      this.state = next;
      return structuredClone(next);
    });
    this.#tail = job.catch(() => {});
    return job;
  }
}

function initialState(now) {
  return {
    revision: 1,
    createdAt: now,
    updatedAt: now,
    hostnames: {},
    releases: {}
  };
}

async function persistEnvelope(currentPath, revisionsPath, envelope) {
  const bytes = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
  const revision = envelope.payload.revision;
  const historyName = `${String(revision).padStart(20, "0")}-${envelope.checksum}.json`;
  const historyPath = path.join(revisionsPath, historyName);
  if (!(await exists(historyPath))) {
    await writeExclusiveFile(historyPath, bytes, { mode: 0o440 });
  }
  await atomicWriteFile(currentPath, bytes, { mode: 0o640 });
}

function releaseKey(projectId, releaseId) {
  return `${safeId(projectId, "projectId")}:${safeId(releaseId, "releaseId")}`;
}

function requireBinding(state, hostname, expectedRevision) {
  const binding = state.hostnames[hostname];
  invariant(binding, "HOSTNAME_NOT_FOUND", "hostname is not reserved");
  invariant(
    binding.revision === expectedRevision,
    "REVISION_CONFLICT",
    "hostname mapping changed before this operation"
  );
  return binding;
}

function validateState(value) {
  invariant(value && typeof value === "object", "CONTROL_CORRUPT", "control state is invalid");
  nonNegativeInteger(value.revision, "state.revision");
  invariant(value.revision >= 1, "CONTROL_CORRUPT", "state revision is invalid");
  invariant(
    typeof value.createdAt === "string" &&
      typeof value.updatedAt === "string" &&
      !Number.isNaN(Date.parse(value.createdAt)) &&
      !Number.isNaN(Date.parse(value.updatedAt)),
    "CONTROL_CORRUPT",
    "state timestamps are invalid"
  );
  invariant(
    value.hostnames &&
      typeof value.hostnames === "object" &&
      !Array.isArray(value.hostnames) &&
      value.releases &&
      typeof value.releases === "object" &&
      !Array.isArray(value.releases),
    "CONTROL_CORRUPT",
    "state maps are invalid"
  );
  for (const [hostname, binding] of Object.entries(value.hostnames)) {
    invariant(normalizeHostname(hostname) === hostname, "CONTROL_CORRUPT", "hostname key invalid");
    invariant(binding.hostname === hostname, "CONTROL_CORRUPT", "binding identity invalid");
    safeId(binding.projectId, "binding.projectId");
    invariant(["custom", "platform"].includes(binding.source), "CONTROL_CORRUPT", "source invalid");
    invariant(["active", "dark", "held"].includes(binding.status), "CONTROL_CORRUPT", "status invalid");
    invariant(
      ["pending", "approved", "disabled"].includes(binding.tlsState),
      "CONTROL_CORRUPT",
      "TLS state invalid"
    );
    nonNegativeInteger(binding.revision, "binding.revision");
    invariant(binding.revision >= 1, "CONTROL_CORRUPT", "binding revision invalid");
    if (binding.currentReleaseId !== null) safeId(binding.currentReleaseId, "currentReleaseId");
    if (binding.previousReleaseId !== null) safeId(binding.previousReleaseId, "previousReleaseId");
  }
  for (const [key, release] of Object.entries(value.releases)) {
    safeId(release.projectId, "release.projectId");
    safeId(release.releaseId, "release.releaseId");
    invariant(key === `${release.projectId}:${release.releaseId}`, "CONTROL_CORRUPT", "release key invalid");
    invariant(
      typeof release.manifestDigest === "string" &&
        /^[a-f0-9]{64}$/u.test(release.manifestDigest),
      "CONTROL_CORRUPT",
      "release digest invalid"
    );
    nonNegativeInteger(release.totalBytes, "release.totalBytes");
    nonNegativeInteger(release.fileCount, "release.fileCount");
  }
  return value;
}
