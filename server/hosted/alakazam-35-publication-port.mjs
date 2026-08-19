import { createHash } from "node:crypto";

import { invariant } from "../commerce-v2/canonical.mjs";
import {
  createSelfHostPublicationPort
} from "./selfhost-publication-port.mjs";

const HEADER_ASSET =
  /<img src="\/(assets\/alakazam-header-([a-f0-9]{64})\.(png|jpg))"/gu;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactHeaderReference(proof) {
  const htmlBytes = proof?.artifact?.htmlBytes;
  invariant(
    Buffer.isBuffer(htmlBytes) || htmlBytes instanceof Uint8Array,
    "PUBLICATION_PROOF_INVALID",
    "The Alakazam HTML artifact bytes are unavailable.",
    { status: 409 }
  );
  const matches = [...Buffer.from(htmlBytes).toString("utf8").matchAll(
    HEADER_ASSET
  )];
  invariant(
    matches.length <= 1,
    "PUBLICATION_PROOF_INVALID",
    "The Alakazam HTML contains multiple header asset authorities.",
    { status: 409 }
  );
  if (matches.length === 0) return null;
  return Object.freeze({
    assetPath: matches[0][1],
    assetDigest: matches[0][2],
    mediaType: matches[0][3] === "png"
      ? "image/png"
      : "image/jpeg"
  });
}

export function createAlakazam35PublicationPort({
  runtime,
  assetRepository,
  clock,
  createBasePort = createSelfHostPublicationPort
} = {}) {
  invariant(
    runtime &&
      typeof runtime.installRelease === "function" &&
      typeof runtime.readiness === "function" &&
      runtime.control &&
      runtime.releases &&
      assetRepository &&
      typeof assetRepository.readPublicationAsset === "function" &&
      typeof createBasePort === "function",
    "PUBLICATION_CONFIGURATION_ERROR",
    "The Alakazam multi-file publication boundary is incomplete.",
    { status: 500 }
  );
  const pending = new Map();
  const proxyRuntime = {
    control: runtime.control,
    releases: {
      async getManifest(...args) {
        const manifest = await runtime.releases.getManifest(...args);
        return {
          ...manifest,
          files: manifest.files.filter(
            (file) => file.path === "index.html"
          )
        };
      }
    },
    async installRelease(input) {
      const key = `${input.projectId}:${input.releaseId}`;
      const asset = pending.get(key) ?? null;
      invariant(
        Array.isArray(input.files) &&
          input.files.length === 1 &&
          input.files[0].path === "index.html",
        "PUBLICATION_PROOF_INVALID",
        "The Alakazam HTML release boundary changed.",
        { status: 409 }
      );
      return runtime.installRelease({
        ...input,
        files: asset === null
          ? input.files
          : [
              ...input.files,
              {
                path: asset.assetPath,
                bytes: asset.bytes,
                contentType: asset.mediaType
              }
            ]
      });
    }
  };
  if (typeof runtime.readiness === "function") {
    proxyRuntime.readiness = runtime.readiness.bind(runtime);
  }
  for (const method of [
    "activate",
    "publicationHeld",
    "reserveHostname",
    "rollback",
    "setHostnameGate"
  ]) {
    if (typeof runtime[method] === "function") {
      proxyRuntime[method] = runtime[method].bind(runtime);
    }
  }
  const base = createBasePort({ runtime: proxyRuntime, clock });

  async function withAsset(proof, operation) {
    const reference = exactHeaderReference(proof);
    const key = `${proof.projectId}:${proof.releaseId}`;
    let asset = null;
    if (reference !== null) {
      asset = await assetRepository.readPublicationAsset({
        organizationId: proof.organizationId,
        projectId: proof.projectId,
        assetDigest: reference.assetDigest,
        assetPath: reference.assetPath
      });
      invariant(
        asset &&
          asset.assetDigest === reference.assetDigest &&
          asset.assetPath === reference.assetPath &&
          asset.mediaType === reference.mediaType &&
          Buffer.isBuffer(asset.bytes) &&
          sha256(asset.bytes) === reference.assetDigest,
        "PUBLICATION_ARTIFACT_MISMATCH",
        "The immutable Alakazam header asset failed exact verification.",
        { status: 409 }
      );
    }
    invariant(
      !pending.has(key),
      "PUBLICATION_CONFLICT",
      "The Alakazam release is already being installed.",
      { status: 409 }
    );
    pending.set(key, asset);
    try {
      return await operation();
    } finally {
      pending.delete(key);
    }
  }

  return Object.freeze({
    kind: "private-in-process-selfhost-alakazam-multi-file",
    readiness: () => base.readiness(),
    request: (proof) => withAsset(proof, () => base.request(proof)),
    rollback: (proof) => withAsset(proof, () => base.rollback(proof)),
    unpublish: (proof) => base.unpublish(proof)
  });
}
