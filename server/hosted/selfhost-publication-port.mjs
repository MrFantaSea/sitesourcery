import { createHash } from "node:crypto";

import {
  SelfHostError,
  normalizeHostname,
  safeId
} from "../selfhost/src/index.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { SPARK_COMPILER_SCHEMA } from "./spark-compiler-port.mjs";
import {
  verifyAlakazamFulfillmentDecision
} from "../commerce-v2/alakazam-fulfillment.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMPILER_REVISION = /^sha256:[a-f0-9]{64}$/u;
const PAID_STATES = new Set(["active", "grace"]);
const OWNERSHIP_STATE = "completed";
const CUSTOMER_ADDRESS_KINDS = new Set([
  "custom",
  "customer_byod",
  "customer_purchase"
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function object(value, field) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "PUBLICATION_PROOF_INVALID",
    `${field} proof is missing.`,
    { status: 409 }
  );
  return value;
}

function exactId(value, field) {
  try {
    return safeId(value, field);
  } catch {
    throw new HostedError(
      "PUBLICATION_PROOF_INVALID",
      `${field} proof is invalid.`,
      { status: 409 }
    );
  }
}

function exactDigest(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "PUBLICATION_PROOF_INVALID",
    `${field} proof is invalid.`,
    { status: 409 }
  );
  return value;
}

function futureDate(value, now, field) {
  const timestamp = Date.parse(value);
  invariant(
    Number.isFinite(timestamp) && timestamp > Date.parse(now),
    "PAID_ENTITLEMENT_REQUIRED",
    `${field} is not current.`,
    { status: 409 }
  );
}

function exactArtifact(value) {
  const artifact = object(value, "Artifact");
  invariant(
    artifact.compilerSchema === SPARK_COMPILER_SCHEMA &&
      typeof artifact.compilerRevision === "string" &&
      COMPILER_REVISION.test(artifact.compilerRevision),
    "PUBLICATION_PROOF_INVALID",
    "The canonical server compiler proof is missing.",
    { status: 409 }
  );
  invariant(
    Buffer.isBuffer(artifact.htmlBytes) ||
      artifact.htmlBytes instanceof Uint8Array,
    "PUBLICATION_PROOF_INVALID",
    "The server-generated artifact bytes are missing.",
    { status: 409 }
  );
  const htmlBytes = Buffer.from(
    artifact.htmlBytes.buffer,
    artifact.htmlBytes.byteOffset,
    artifact.htmlBytes.byteLength
  );
  invariant(
    htmlBytes.byteLength > 0,
    "PUBLICATION_PROOF_INVALID",
    "The server-generated artifact is empty.",
    { status: 409 }
  );
  const digest = exactDigest(artifact.sha256, "Artifact digest");
  invariant(
    sha256(htmlBytes) === digest,
    "PUBLICATION_ARTIFACT_MISMATCH",
    "The server-generated artifact failed checksum verification.",
    { status: 409 }
  );
  return {
    htmlBytes,
    digest,
    compilerSchema: artifact.compilerSchema,
    compilerRevision: artifact.compilerRevision
  };
}

function publicationProof(input, now) {
  const proof = object(input, "Publication");
  const organizationId = exactId(proof.organizationId, "Organization ID");
  const projectId = exactId(proof.projectId, "Project ID");
  const releaseId = exactId(proof.releaseId, "Release ID");
  const project = object(proof.project, "Project");
  const releaseRequest = object(proof.releaseRequest, "Release request");
  const version = object(proof.version, "Version");
  const screening = object(proof.screening, "Pre-publication screening");
  const entitlement = object(
    proof.entitlement ?? proof.subscription,
    "Paid entitlement"
  );
  const entitlementKind = entitlement.kind ?? "subscription";
  const address = object(proof.address, "Address");
  const artifact = exactArtifact(proof.artifact);

  invariant(
    exactId(project.id, "Project ID") === projectId &&
      exactId(project.organizationId, "Organization ID") === organizationId &&
      project.lifecycle === "active",
    "ACTIVE_PROJECT_REQUIRED",
    "Publication requires the exact active project.",
    { status: 409 }
  );
  invariant(
    project.safetyState === "clear",
    "PROJECT_SAFETY_CLEARANCE_REQUIRED",
    "Publication is blocked while the project has a safety hold.",
    { status: 409 }
  );

  const versionId = exactId(version.id, "Version ID");
  const addressId = exactId(address.id, "Address ID");
  const screeningId = exactId(screening.id, "Screening ID");
  invariant(
    exactId(releaseRequest.id, "Release request ID") &&
      exactId(releaseRequest.organizationId, "Organization ID") ===
        organizationId &&
      exactId(releaseRequest.projectId, "Project ID") === projectId &&
      exactId(releaseRequest.versionId, "Version ID") === versionId &&
      exactId(releaseRequest.addressId, "Address ID") === addressId &&
      exactId(
        releaseRequest.prepublicationScreeningId,
        "Screening ID"
      ) === screeningId,
    "RELEASE_REQUEST_BINDING_INVALID",
    "The release request is not bound to this exact publication proof.",
    { status: 409 }
  );

  invariant(
    version.state === "accepted_release",
    "ACCEPTED_VERSION_REQUIRED",
    "Publication requires the exact accepted release version.",
    { status: 409 }
  );
  const versionDigest = exactDigest(
    version.artifactDigest,
    "Accepted version artifact digest"
  );
  invariant(
    version.compilerSchema === SPARK_COMPILER_SCHEMA &&
      typeof version.compilerRevision === "string" &&
      COMPILER_REVISION.test(version.compilerRevision),
    "PUBLICATION_COMPILER_MISMATCH",
    "The accepted version was not produced by the exact server compiler.",
    { status: 409 }
  );
  invariant(
    screening.stage === "pre_publication" &&
      screening.passed === true &&
      exactId(screening.versionId, "Version ID") === versionId &&
      exactDigest(screening.artifactDigest, "Screening artifact digest") ===
        artifact.digest,
    "PREPUBLICATION_SCREENING_REQUIRED",
    "Publication requires a passed screening of the exact accepted artifact.",
    { status: 409 }
  );
  if (entitlementKind !== "alakazam") {
    invariant(
      versionDigest === artifact.digest &&
        version.compilerRevision === artifact.compilerRevision,
      "PUBLICATION_ARTIFACT_MISMATCH",
      "The accepted version and server artifact do not match.",
      { status: 409 }
    );
  }
  invariant(
    (
      (
        entitlementKind === "subscription" ||
        entitlementKind === "alakazam"
      ) &&
      PAID_STATES.has(entitlement.status)
    ) ||
      (
        entitlementKind === "ownership" &&
        entitlement.status === OWNERSHIP_STATE
      ),
    "PAID_ENTITLEMENT_REQUIRED",
    "An active paid entitlement is required before publication.",
    { status: 409 }
  );
  invariant(
    exactId(
      entitlement.projectId,
      "Entitlement project ID"
    ) === projectId &&
      exactId(
        entitlement.organizationId,
        "Entitlement organization ID"
      ) === organizationId,
    "PAID_ENTITLEMENT_REQUIRED",
    "The paid entitlement is not bound to this project.",
    { status: 409 }
  );
  if (
    (
      entitlementKind === "subscription" ||
      entitlementKind === "alakazam"
    ) &&
    entitlement.status === "grace"
  ) {
    futureDate(
      entitlement.graceEndsAt,
      now,
      "The payment grace period"
    );
  }
  if (entitlementKind === "ownership") {
    invariant(
      Number.isFinite(
        Date.parse(entitlement.completedAt)
      ),
      "PAID_ENTITLEMENT_REQUIRED",
      "The ownership entitlement completion proof is invalid.",
      { status: 409 }
    );
  }

  if (entitlementKind === "alakazam") {
    let decision;
    try {
      decision = verifyAlakazamFulfillmentDecision(
        entitlement.decision
      );
    } catch {
      invariant(
        false,
        "PUBLICATION_PROOF_INVALID",
        "The exact Alakazam fulfillment decision is invalid.",
        { status: 409 }
      );
    }
    invariant(
      exactId(
        entitlement.subscriptionId,
        "Alakazam subscription ID"
      ) === decision.subscriptionId &&
        Number.isSafeInteger(
          entitlement.subscriptionRevision
        ) &&
        entitlement.subscriptionRevision ===
          decision.subscriptionRevision &&
        decision.tenantId === organizationId &&
        decision.projectId === projectId &&
        decision.capability ===
          "publish_accepted_project_version" &&
        decision.sourceVersion.versionId === versionId &&
        decision.sourceVersion.artifactDigest === versionDigest &&
        decision.sourceVersion.compilerSchema ===
          version.compilerSchema &&
        decision.sourceVersion.compilerRevision ===
          version.compilerRevision &&
        decision.publicationArtifact.screeningId ===
          screeningId &&
        decision.publicationArtifact.artifactDigest ===
          artifact.digest &&
        decision.publicationArtifact.compilerSchema ===
          artifact.compilerSchema &&
        decision.publicationArtifact.compilerRevision ===
          artifact.compilerRevision &&
        decision.publicationArtifact.policyDigest ===
          decision.policyDigest &&
        decision.address.addressId === addressId &&
        decision.address.hostname ===
          normalizeHostname(address.hostname),
      "PUBLICATION_PROOF_INVALID",
      "The Alakazam decision does not bind this exact publication.",
      { status: 409 }
    );
  }

  const hostname = normalizeHostname(address.hostname);
  invariant(
    hostname &&
      address.state === "configured" &&
      address.verified === true &&
      exactId(address.projectId, "Address project ID") === projectId &&
      exactId(address.organizationId, "Address organization ID") ===
        organizationId,
    "VERIFIED_ADDRESS_REQUIRED",
    "A configured, verified address is required before publication.",
    { status: 409 }
  );
  let source;
  if (address.kind === "licensed") {
    source = "platform";
  } else {
    invariant(
      CUSTOMER_ADDRESS_KINDS.has(address.kind),
      "VERIFIED_ADDRESS_REQUIRED",
      "The verified address kind is invalid.",
      { status: 409 }
    );
    source = "custom";
  }

  return {
    organizationId,
    projectId,
    releaseId,
    releaseRequestId: releaseRequest.id,
    versionId,
    addressId,
    hostname,
    source,
    artifact
  };
}

function providerRequestId(input, operation) {
  return `selfhost:${operation}:${input.releaseRequestId}`;
}

function engineError(error, operation) {
  if (!(error instanceof SelfHostError)) return error;
  const conflict = [
    "HOSTNAME_CONFLICT",
    "RELEASE_CONFLICT",
    "REVISION_CONFLICT"
  ].includes(error.code);
  return new HostedError(
    conflict ? "PUBLICATION_CONFLICT" : "PUBLICATION_ENGINE_UNAVAILABLE",
    conflict
      ? "Publication state changed concurrently. Retry from current project state."
      : "The private publication engine could not complete the operation.",
    {
      status: conflict ? 409 : 503,
      details: { engineCode: error.code, operation }
    }
  );
}

async function callEngine(operation, action) {
  try {
    return await action();
  } catch (error) {
    throw engineError(error, operation);
  }
}

export function createSelfHostPublicationPort({
  runtime,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  invariant(
    runtime &&
      typeof runtime.installRelease === "function" &&
      typeof runtime.reserveHostname === "function" &&
      typeof runtime.activate === "function" &&
      typeof runtime.rollback === "function" &&
      typeof runtime.setHostnameGate === "function" &&
      runtime.control &&
      runtime.releases,
    "PUBLICATION_CONFIGURATION_ERROR",
    "The private self-host publication runtime is required.",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "PUBLICATION_CONFIGURATION_ERROR",
    "The publication clock is invalid.",
    { status: 500 }
  );

  async function held() {
    try {
      return Boolean(await runtime.publicationHeld());
    } catch {
      return true;
    }
  }

  async function ensureRelease(proof) {
    const registered = runtime.control.release(
      proof.projectId,
      proof.releaseId
    );
    if (!registered) {
      return runtime.installRelease({
        projectId: proof.projectId,
        releaseId: proof.releaseId,
        files: [
          {
            path: "index.html",
            bytes: proof.artifact.htmlBytes,
            contentType: "text/html; charset=utf-8"
          }
        ]
      });
    }
    const manifest = await runtime.releases.getManifest(
      proof.projectId,
      proof.releaseId
    );
    const index = manifest.files.find((file) => file.path === "index.html");
    invariant(
      manifest.manifestDigest === registered.manifestDigest &&
        manifest.files.length === 1 &&
        index?.sha256 === proof.artifact.digest &&
        index.byteLength === proof.artifact.htmlBytes.byteLength,
      "PUBLICATION_RELEASE_CONFLICT",
      "The immutable release ID is already bound to different content.",
      { status: 409 }
    );
    return manifest;
  }

  function exactBinding(proof) {
    const binding = runtime.control.lookup(proof.hostname);
    invariant(
      !binding ||
        (binding.projectId === proof.projectId &&
          binding.source === proof.source),
      "PUBLICATION_HOSTNAME_CONFLICT",
      "The verified hostname is already bound to another project.",
      { status: 409 }
    );
    return binding;
  }

  async function reserve(proof) {
    let binding = exactBinding(proof);
    if (!binding) {
      await runtime.reserveHostname({
        hostname: proof.hostname,
        projectId: proof.projectId,
        source: proof.source,
        tlsState: "approved"
      });
      binding = exactBinding(proof);
    }
    return binding;
  }

  async function darkOtherHostnames(proof) {
    const snapshot = runtime.control.snapshot();
    const others = Object.values(snapshot.hostnames)
      .filter(
        (binding) =>
          binding.projectId === proof.projectId &&
          binding.hostname !== proof.hostname &&
          binding.status === "active"
      )
      .sort((left, right) => left.hostname.localeCompare(right.hostname));
    for (const binding of others) {
      await runtime.setHostnameGate({
        hostname: binding.hostname,
        expectedRevision: binding.revision,
        status: "dark"
      });
    }
  }

  async function publish(input) {
    const proof = publicationProof(input, clock.now());
    const requestId = providerRequestId(proof, "publish");
    if (await held()) {
      return {
        providerRequestId: requestId,
        status: "held",
        published: false,
        releaseId: proof.releaseId
      };
    }
    return callEngine("publish", async () => {
      const manifest = await ensureRelease(proof);
      let binding = await reserve(proof);
      if (await held()) {
        return {
          providerRequestId: requestId,
          status: "held",
          published: false,
          releaseId: proof.releaseId,
          staged: true,
          manifestDigest: manifest.manifestDigest
        };
      }
      if (
        binding.currentReleaseId === proof.releaseId &&
        binding.status === "active" &&
        binding.tlsState === "approved"
      ) {
        return {
          providerRequestId: requestId,
          status: "released",
          published: true,
          replay: true,
          releaseId: proof.releaseId,
          manifestDigest: manifest.manifestDigest,
          bindingRevision: binding.revision
        };
      }

      await darkOtherHostnames(proof);
      if (binding.status !== "held" || binding.tlsState !== "approved") {
        await runtime.setHostnameGate({
          hostname: proof.hostname,
          expectedRevision: binding.revision,
          status: "held",
          tlsState: "approved"
        });
        binding = exactBinding(proof);
      }
      if (binding.currentReleaseId !== proof.releaseId) {
        await runtime.activate({
          hostname: proof.hostname,
          releaseId: proof.releaseId,
          expectedRevision: binding.revision
        });
        binding = exactBinding(proof);
      }
      if (await held()) {
        return {
          providerRequestId: requestId,
          status: "held",
          published: false,
          releaseId: proof.releaseId,
          staged: true,
          manifestDigest: manifest.manifestDigest
        };
      }
      await runtime.setHostnameGate({
        hostname: proof.hostname,
        expectedRevision: binding.revision,
        status: "active",
        tlsState: "approved"
      });
      binding = exactBinding(proof);
      return {
        providerRequestId: requestId,
        status: "released",
        published: true,
        replay: false,
        releaseId: proof.releaseId,
        manifestDigest: manifest.manifestDigest,
        bindingRevision: binding.revision
      };
    });
  }

  async function rollback(input) {
    const proof = publicationProof(input, clock.now());
    const requestId = providerRequestId(proof, "rollback");
    if (await held()) {
      return {
        providerRequestId: requestId,
        status: "held",
        published: false,
        releaseId: proof.releaseId
      };
    }
    return callEngine("rollback", async () => {
      const manifest = await ensureRelease(proof);
      let binding = exactBinding(proof);
      invariant(
        binding,
        "PUBLICATION_NOT_FOUND",
        "The serving hostname has not been published.",
        { status: 404 }
      );
      if (
        binding.currentReleaseId === proof.releaseId &&
        binding.status === "active" &&
        binding.tlsState === "approved"
      ) {
        return {
          providerRequestId: requestId,
          status: "released",
          published: true,
          replay: true,
          releaseId: proof.releaseId,
          manifestDigest: manifest.manifestDigest,
          bindingRevision: binding.revision
        };
      }
      if (await held()) {
        return {
          providerRequestId: requestId,
          status: "held",
          published: false,
          releaseId: proof.releaseId,
          staged: true,
          manifestDigest: manifest.manifestDigest
        };
      }
      if (binding.currentReleaseId !== proof.releaseId) {
        await runtime.rollback({
          hostname: proof.hostname,
          expectedRevision: binding.revision,
          targetReleaseId: proof.releaseId
        });
        binding = exactBinding(proof);
      }
      if (binding.status !== "active" || binding.tlsState !== "approved") {
        await runtime.setHostnameGate({
          hostname: proof.hostname,
          expectedRevision: binding.revision,
          status: "active",
          tlsState: "approved"
        });
        binding = exactBinding(proof);
      }
      return {
        providerRequestId: requestId,
        status: "released",
        published: true,
        replay: false,
        releaseId: proof.releaseId,
        manifestDigest: manifest.manifestDigest,
        bindingRevision: binding.revision
      };
    });
  }

  async function unpublish(input) {
    const projectId = exactId(input?.projectId, "Project ID");
    const hostname = normalizeHostname(input?.hostname);
    invariant(
      hostname,
      "PUBLICATION_PROOF_INVALID",
      "The exact serving hostname is required.",
      { status: 409 }
    );
    return callEngine("unpublish", async () => {
      let binding = runtime.control.lookup(hostname);
      invariant(
        !binding || binding.projectId === projectId,
        "PUBLICATION_HOSTNAME_CONFLICT",
        "The hostname is bound to another project.",
        { status: 409 }
      );
      if (!binding || binding.status === "dark") {
        return {
          providerRequestId: `selfhost:unpublish:${projectId}:${hostname}`,
          status: "unpublished",
          published: false,
          replay: true
        };
      }
      await runtime.setHostnameGate({
        hostname,
        expectedRevision: binding.revision,
        status: "dark"
      });
      binding = runtime.control.lookup(hostname);
      return {
        providerRequestId: `selfhost:unpublish:${projectId}:${hostname}`,
        status: "unpublished",
        published: false,
        replay: false,
        bindingRevision: binding.revision
      };
    });
  }

  return Object.freeze({
    kind: "private-in-process-selfhost",
    async readiness() {
      return {
        ready: true,
        kind: "private-in-process-selfhost",
        held: await held()
      };
    },
    request: publish,
    rollback,
    unpublish
  });
}
