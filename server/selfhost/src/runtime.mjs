import path from "node:path";
import { canonicalJson, jsonEnvelope } from "./canonical.mjs";
import { ControlStore, CONTROL_SCHEMA } from "./control-store.mjs";
import { SelfHostError, invariant } from "./errors.mjs";
import {
  DEFAULT_PLATFORM_BASE_DOMAIN,
  normalizeHostname,
  isPlatformHostname,
  requestHostname
} from "./hostname.mjs";
import { ReleaseStore } from "./release-store.mjs";
import { requestFilePath } from "./validation.mjs";

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy":
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https:",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

export class SelfHostRuntime {
  constructor({
    root,
    control,
    releases,
    publicationHeld,
    controlHost,
    platformBaseDomain,
    reservedPlatformLabels
  }) {
    this.root = root;
    this.control = control;
    this.releases = releases;
    this.publicationHeld = publicationHeld;
    this.controlHost = controlHost;
    this.platformBaseDomain = platformBaseDomain;
    this.reservedPlatformLabels = reservedPlatformLabels;
  }

  static async open({
    root,
    publicationHeld = true,
    controlHost = "127.0.0.1",
    platformBaseDomain = DEFAULT_PLATFORM_BASE_DOMAIN,
    reservedPlatformLabels = ["app", "api", "www", "admin"],
    clock = () => new Date().toISOString(),
    maximumFileBytes,
    maximumReleaseBytes,
    maximumFiles
  }) {
    const absoluteRoot = path.resolve(root);
    const releases = await ReleaseStore.open({
      root: path.join(absoluteRoot, "releases"),
      clock,
      maximumFileBytes,
      maximumReleaseBytes,
      maximumFiles
    });
    const control = await ControlStore.open({
      root: path.join(absoluteRoot, "control"),
      clock
    });
    const normalizedPlatform = normalizeHostname(platformBaseDomain);
    invariant(normalizedPlatform, "INVALID_CONFIG", "platform base domain is invalid");
    invariant(
      typeof controlHost === "string" && controlHost.length >= 3,
      "INVALID_CONFIG",
      "control host is invalid"
    );
    return new SelfHostRuntime({
      root: absoluteRoot,
      control,
      releases,
      publicationHeld:
        typeof publicationHeld === "function" ? publicationHeld : () => Boolean(publicationHeld),
      controlHost,
      platformBaseDomain: normalizedPlatform,
      reservedPlatformLabels
    });
  }

  async installRelease(input) {
    const manifest = await this.releases.install(input);
    await this.control.registerRelease({
      projectId: manifest.projectId,
      releaseId: manifest.releaseId,
      manifestDigest: manifest.manifestDigest,
      totalBytes: manifest.totalBytes,
      fileCount: manifest.files.length
    });
    return manifest;
  }

  async reserveHostname(input) {
    const hostname = normalizeHostname(input.hostname);
    invariant(hostname, "INVALID_HOSTNAME", "hostname is invalid");
    if (input.source === "platform") {
      invariant(
        isPlatformHostname(
          hostname,
          this.platformBaseDomain,
          this.reservedPlatformLabels
        ),
        "PLATFORM_HOSTNAME_INVALID",
        "platform hostname is not one allowed label below the platform base"
      );
    } else if (input.source === "custom") {
      invariant(
        !hostname.endsWith(`.${this.platformBaseDomain}`) &&
          hostname !== this.platformBaseDomain,
        "CUSTOM_HOSTNAME_INVALID",
        "platform namespace cannot be attached as a custom domain"
      );
    }
    return this.control.reserveHostname({ ...input, hostname });
  }

  async setHostnameGate(input) {
    return this.control.setHostnameGate(input);
  }

  async activate(input) {
    const binding = this.control.lookup(input.hostname);
    invariant(binding, "HOSTNAME_NOT_FOUND", "hostname is not reserved");
    const registered = this.control.release(binding.projectId, input.releaseId);
    invariant(registered, "RELEASE_NOT_FOUND", "release is not registered");
    const manifest = await this.releases.getManifest(binding.projectId, input.releaseId);
    invariant(
      manifest.manifestDigest === registered.manifestDigest,
      "RELEASE_INTEGRITY_MISMATCH",
      "control and immutable release manifests disagree"
    );
    return this.control.activate(input);
  }

  async rollback(input) {
    const binding = this.control.lookup(input.hostname);
    invariant(binding, "HOSTNAME_NOT_FOUND", "hostname is not reserved");
    const targetReleaseId = input.targetReleaseId ?? binding.previousReleaseId;
    const registered = this.control.release(binding.projectId, targetReleaseId);
    invariant(registered, "RELEASE_NOT_FOUND", "rollback release is not registered");
    const manifest = await this.releases.getManifest(binding.projectId, targetReleaseId);
    invariant(
      manifest.manifestDigest === registered.manifestDigest,
      "RELEASE_INTEGRITY_MISMATCH",
      "rollback manifest does not match control state"
    );
    return this.control.rollback(input);
  }

  async readiness() {
    const held = await this.#held();
    const control = this.control.readiness();
    if (held || !control.ready) {
      return {
        ready: false,
        publicationHeld: held,
        control,
        checkedBindings: 0
      };
    }
    let checkedBindings = 0;
    try {
      const state = this.control.snapshot();
      for (const binding of Object.values(state.hostnames)) {
        if (binding.status !== "active" || binding.currentReleaseId === null) continue;
        const release = state.releases[`${binding.projectId}:${binding.currentReleaseId}`];
        invariant(release, "RELEASE_NOT_FOUND", "active binding release is missing");
        const manifest = await this.releases.getManifest(
          binding.projectId,
          binding.currentReleaseId
        );
        invariant(
          manifest.manifestDigest === release.manifestDigest,
          "RELEASE_INTEGRITY_MISMATCH",
          "active release manifest is inconsistent"
        );
        checkedBindings += 1;
      }
      return {
        ready: true,
        publicationHeld: false,
        control,
        checkedBindings
      };
    } catch (error) {
      return {
        ready: false,
        publicationHeld: false,
        control,
        checkedBindings,
        code: error.code ?? "READINESS_FAILED"
      };
    }
  }

  async createBackupManifest() {
    invariant(this.control.isReady(), "CONTROL_UNAVAILABLE", "control store is not ready");
    const state = this.control.snapshot();
    const releases = [];
    for (const registered of Object.values(state.releases)) {
      const manifest = await this.releases.getManifest(
        registered.projectId,
        registered.releaseId
      );
      invariant(
        manifest.manifestDigest === registered.manifestDigest,
        "RELEASE_INTEGRITY_MISMATCH",
        "backup refused because release metadata disagrees"
      );
      releases.push({
        projectId: registered.projectId,
        releaseId: registered.releaseId,
        manifestDigest: registered.manifestDigest,
        totalBytes: manifest.totalBytes,
        files: manifest.files.map((file) => ({
          path: file.path,
          byteLength: file.byteLength,
          sha256: file.sha256
        })),
        requiredRelativePaths: [
          `releases/${registered.projectId}/${registered.releaseId}/release-manifest.json`,
          ...manifest.files.map(
            (file) => `releases/${registered.projectId}/${registered.releaseId}/${file.path}`
          )
        ]
      });
    }
    releases.sort((left, right) =>
      `${left.projectId}:${left.releaseId}`.localeCompare(
        `${right.projectId}:${right.releaseId}`
      )
    );
    const payload = {
      createdAt: new Date().toISOString(),
      controlSchema: CONTROL_SCHEMA,
      controlRevision: state.revision,
      controlState: jsonEnvelope(CONTROL_SCHEMA, state),
      publicationHeld: await this.#held(),
      releases
    };
    return jsonEnvelope("sitesourcery.selfhost-backup-manifest/v1", payload);
  }

  async fetch(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return notFound(request.method === "HEAD");
    }
    if (isControlUrl(url, request, this.controlHost)) {
      if (request.method === "GET" && url.pathname === "/_sitesourcery/health") {
        return json(
          {
            ok: true,
            service: "sitesourcery-selfhost-foundation",
            publicationHeld: await this.#held()
          },
          200
        );
      }
      if (request.method === "GET" && url.pathname === "/_sitesourcery/ready") {
        const status = await this.readiness();
        return json(status, status.ready ? 200 : 503);
      }
      if (request.method === "GET" && url.pathname === "/_sitesourcery/tls/allow") {
        return this.#tlsAsk(url);
      }
      return notFound(request.method === "HEAD");
    }
    if (url.pathname.startsWith("/_sitesourcery/")) {
      return notFound(request.method === "HEAD");
    }
    return this.#serve(request, url);
  }

  async #tlsAsk(url) {
    if (await this.#held()) return empty(403);
    const candidates = url.searchParams.getAll("domain");
    if (candidates.length !== 1 || [...url.searchParams.keys()].some((key) => key !== "domain")) {
      return empty(403);
    }
    const hostname = normalizeHostname(candidates[0]);
    if (!hostname) return empty(403);
    try {
      const binding = this.control.lookup(hostname);
      if (
        !binding ||
        binding.hostname !== hostname ||
        binding.source !== "custom" ||
        binding.status !== "active" ||
        binding.tlsState !== "approved" ||
        !binding.currentReleaseId
      ) {
        return empty(403);
      }
      const registered = this.control.release(binding.projectId, binding.currentReleaseId);
      if (!registered) return empty(403);
      const manifest = await this.releases.getManifest(
        binding.projectId,
        binding.currentReleaseId
      );
      return empty(manifest.manifestDigest === registered.manifestDigest ? 200 : 403);
    } catch {
      return empty(403);
    }
  }

  async #serve(request, url) {
    const head = request.method === "HEAD";
    if (request.method !== "GET" && !head) return notFound(head);
    if (await this.#held()) return unavailable(head);
    const hostname = requestHostname(request);
    if (!hostname) return notFound(head);
    const filePath = requestFilePath(url.pathname);
    if (!filePath) return notFound(head);
    try {
      const first = this.control.lookup(hostname);
      if (!serveableBinding(first)) return notFound(head);
      const release = this.control.release(first.projectId, first.currentReleaseId);
      if (!release) return unavailable(head);
      const artifact = await this.releases.read(
        first.projectId,
        first.currentReleaseId,
        filePath
      );
      if (!artifact) return notFound(head);
      if (artifact.manifestDigest !== release.manifestDigest) return unavailable(head);
      const second = this.control.lookup(hostname);
      if (!sameBinding(first, second) || !serveableBinding(second)) return notFound(head);
      return content(request, artifact);
    } catch (error) {
      if (error instanceof SelfHostError) return unavailable(head);
      return unavailable(head);
    }
  }

  async #held() {
    try {
      return Boolean(await this.publicationHeld());
    } catch {
      return true;
    }
  }
}

function serveableBinding(binding) {
  return (
    binding &&
    binding.status === "active" &&
    typeof binding.currentReleaseId === "string"
  );
}

function sameBinding(left, right) {
  return (
    left &&
    right &&
    left.hostname === right.hostname &&
    left.projectId === right.projectId &&
    left.currentReleaseId === right.currentReleaseId &&
    left.status === right.status &&
    left.revision === right.revision
  );
}

function isControlUrl(url, request, controlHost) {
  const requestHost = request.headers.get("host") ?? url.host;
  return url.hostname === controlHost && stripPort(requestHost) === controlHost;
}

function stripPort(authority) {
  try {
    return new URL(`http://${authority}`).hostname;
  } catch {
    return "";
  }
}

function baseHeaders(cacheControl = "private, no-store") {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("cache-control", cacheControl);
  return headers;
}

function json(value, status) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const headers = baseHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("content-length", String(bytes.byteLength));
  return new Response(bytes, { status, headers });
}

function empty(status) {
  return new Response(null, { status, headers: baseHeaders() });
}

function notFound(head) {
  return new Response(head ? null : "Not Found", {
    status: 404,
    headers: baseHeaders()
  });
}

function unavailable(head) {
  const headers = baseHeaders();
  headers.set("retry-after", "30");
  return new Response(head ? null : "Temporarily unavailable", {
    status: 503,
    headers
  });
}

function content(request, artifact) {
  const etag = `"${artifact.sha256}"`;
  const headers = baseHeaders("public, max-age=0, must-revalidate");
  headers.set("content-type", artifact.contentType);
  headers.set("content-length", String(artifact.byteLength));
  headers.set("etag", etag);
  const ifNoneMatch = request.headers.get("if-none-match");
  if (
    ifNoneMatch &&
    ifNoneMatch
      .split(",")
      .map((value) => value.trim())
      .some((value) => value === "*" || value === etag || value === `W/${etag}`)
  ) {
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(artifact.bytes, { status: 200, headers });
}
