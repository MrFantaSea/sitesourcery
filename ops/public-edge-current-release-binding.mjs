import {
  validateInstalledFinalReleaseEpochV2Chain
} from "./final-release-epoch-v2.mjs";
import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  releaseIdentityFromEpoch,
  validateIndependentMonitorReport
} from "./independent-monitor-runtime.mjs";
import {
  ORIGIN_HELD_AUTHORITY
} from "./origin-seal-runtime.mjs";
import {
  SHAPE_EPOCH_BINDING
} from "./release-epoch.mjs";
import {
  validateRollbackPagesFallback,
  validateRollbackRuntimeTopology
} from "./rollback-rehearsal.mjs";

export const PUBLIC_EDGE_CURRENT_RELEASE_BINDING_SCHEMA =
  "sitesourcery.public-edge-current-release-binding/v1";

export const RETAINED_DNS_PREFLIGHT_RECEIPT_SHA256 =
  "548f136c60ac7b89e4277c566530ffa4741a319a8d71e662f9cb662b8da73f9f";

export const PUBLIC_EDGE_MONITOR_MAXIMUM_AGE_MS = 5 * 60 * 1000;

export const PUBLIC_EDGE_EXTERNAL_BLOCKERS = Object.freeze([
  "fresh_dns_propagation_readback",
  "cloudflare_zone_active",
  "cloudflare_delegation_converged_without_mixed_answers",
  "caa_readback_exact",
  "edge_certificate_current",
  "tunnel_connector_current",
  "public_origin_current_release",
  "owner_authorized_convergence"
]);

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export class PublicEdgeCurrentReleaseBindingFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicEdgeCurrentReleaseBindingFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PublicEdgeCurrentReleaseBindingFailure(code, message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exactExpected(value, expected, code, message) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(code, message);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      `${label} must be an exact lowercase commit SHA.`
    );
  }
  return value;
}

function instant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return selected;
}

function clock(now) {
  const selected = now();
  if (!(selected instanceof Date) || Number.isNaN(selected.valueOf())) {
    fail("PUBLIC_EDGE_BINDING_INVALID", "Public edge binding clock is invalid.");
  }
  return selected;
}

function immutableDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(value)}\n`, "utf8")
  );
}

function retainedDnsReceiptIdentity(value) {
  const receiptSha256 = immutableDigest(value);
  if (receiptSha256 !== RETAINED_DNS_PREFLIGHT_RECEIPT_SHA256) {
    fail(
      "PUBLIC_EDGE_DNS_EVIDENCE_MISMATCH",
      "DNS evidence must be the exact retained post-cutoff preflight receipt."
    );
  }
  const observedAt = instant(
    value.observedAt,
    "Retained DNS preflight observation"
  );
  return freeze({
    receiptSha256,
    observedAt: observedAt.toISOString(),
    currentDelegation: value.checks.currentDelegation,
    cloudflareDelegation: value.checks.cloudflareDelegation,
    mutationAuthorized: value.mutationAuthorized
  });
}

function releaseBinding(epoch, seal, readback, topology) {
  return {
    epochId: epoch.epochId,
    epochDigest: epoch.digest,
    bindingSha256: epoch.bindingSha256,
    sourceCommitSha: epoch.identity.sourceCommitSha,
    sourceTreeSha: epoch.identity.sourceTreeSha,
    artifactManifestSha256: epoch.identity.artifactManifestSha256,
    ingressManifestSha256: epoch.identity.ingressManifestSha256,
    originSealSha256: seal.sealSha256,
    installedReadbackDigest: readback.digest,
    installedReadbackReceiptSha256:
      epoch.evidence.originInstalledReadbackReceiptSha256,
    topologyDigest: topology.digest
  };
}

function validateReleaseBinding(value) {
  exactObject(
    value,
    [
      "epochId",
      "epochDigest",
      "bindingSha256",
      "sourceCommitSha",
      "sourceTreeSha",
      "artifactManifestSha256",
      "ingressManifestSha256",
      "originSealSha256",
      "installedReadbackDigest",
      "installedReadbackReceiptSha256",
      "topologyDigest"
    ],
    "Public edge current release"
  );
  safeIdentifier(value.epochId, "Public edge current epoch ID");
  commit(value.sourceCommitSha, "Public edge current source commit");
  commit(value.sourceTreeSha, "Public edge current source tree");
  for (const [field, selected] of Object.entries(value)) {
    if (field.endsWith("Digest") || field.endsWith("Sha256")) {
      digest(selected, `Public edge current release ${field}`);
    }
  }
  return value;
}

function payload(value) {
  return {
    schema: value.schema,
    state: value.state,
    publicEdgeReady: value.publicEdgeReady,
    externalConvergenceRequired: value.externalConvergenceRequired,
    release: value.release,
    hostedRollbackPredecessor: value.hostedRollbackPredecessor,
    pagesFallback: value.pagesFallback,
    evidence: value.evidence,
    externalBlockers: value.externalBlockers,
    authority: value.authority,
    boundAt: value.boundAt
  };
}

export function publicEdgeCurrentReleaseBindingDigest(value) {
  return immutableDigest(payload(value));
}

export function validateHeldPublicEdgeCurrentReleaseBinding(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "publicEdgeReady",
      "externalConvergenceRequired",
      "release",
      "hostedRollbackPredecessor",
      "pagesFallback",
      "evidence",
      "externalBlockers",
      "authority",
      "boundAt",
      "digest"
    ],
    "Public edge current-release binding"
  );
  if (
    value.schema !== PUBLIC_EDGE_CURRENT_RELEASE_BINDING_SCHEMA ||
    value.state !== "bound_held" ||
    value.publicEdgeReady !== false ||
    value.externalConvergenceRequired !== true
  ) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      "Public edge binding must remain held and must not claim convergence."
    );
  }
  validateReleaseBinding(value.release);
  exactObject(
    value.hostedRollbackPredecessor,
    [
      "commitSha",
      "treeSha",
      "artifactManifestSha256"
    ],
    "Hosted rollback predecessor"
  );
  commit(
    value.hostedRollbackPredecessor.commitSha,
    "Hosted rollback predecessor commit"
  );
  commit(
    value.hostedRollbackPredecessor.treeSha,
    "Hosted rollback predecessor tree"
  );
  digest(
    value.hostedRollbackPredecessor.artifactManifestSha256,
    "Hosted rollback predecessor artifact"
  );
  exactObject(
    value.pagesFallback,
    [
      "deploymentId",
      "commitSha",
      "artifactManifestSha256",
      "routeManifestSha256",
      "digest"
    ],
    "Pages predecessor fallback"
  );
  if (!DECIMAL.test(value.pagesFallback.deploymentId)) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      "Pages fallback deployment ID is invalid."
    );
  }
  commit(value.pagesFallback.commitSha, "Pages fallback commit");
  for (const field of [
    "artifactManifestSha256",
    "routeManifestSha256",
    "digest"
  ]) digest(value.pagesFallback[field], `Pages fallback ${field}`);
  if (
    value.pagesFallback.commitSha !==
      SHAPE_EPOCH_BINDING.source
        .requiredProductionPredecessorCommitSha
  ) {
    fail(
      "PUBLIC_EDGE_PAGES_MISMATCH",
      "Pages fallback is not the exact retained production predecessor."
    );
  }
  exactObject(
    value.evidence,
    [
      "retainedDnsPreflightReceiptSha256",
      "retainedDnsObservedAt",
      "independentMonitorTelemetrySha256",
      "independentMonitorObservedAt",
      "pagesFallbackDigest"
    ],
    "Public edge binding evidence"
  );
  for (const field of [
    "retainedDnsPreflightReceiptSha256",
    "independentMonitorTelemetrySha256",
    "pagesFallbackDigest"
  ]) digest(value.evidence[field], `Public edge evidence ${field}`);
  if (
    value.evidence.retainedDnsPreflightReceiptSha256 !==
      RETAINED_DNS_PREFLIGHT_RECEIPT_SHA256 ||
    value.evidence.pagesFallbackDigest !== value.pagesFallback.digest
  ) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      "Public edge evidence digest linkage is invalid."
    );
  }
  instant(
    value.evidence.retainedDnsObservedAt,
    "Retained DNS observation"
  );
  const monitorAt = instant(
    value.evidence.independentMonitorObservedAt,
    "Independent monitor observation"
  );
  exactExpected(
    value.externalBlockers,
    PUBLIC_EDGE_EXTERNAL_BLOCKERS,
    "PUBLIC_EDGE_BINDING_INVALID",
    "Public edge external blockers drifted."
  );
  exactExpected(
    value.authority,
    ORIGIN_HELD_AUTHORITY,
    "PUBLIC_EDGE_EFFECTS_NOT_HELD",
    "Public edge binding authority must remain wholly held."
  );
  const boundAt = instant(value.boundAt, "Public edge binding time");
  if (
    monitorAt > boundAt ||
    boundAt - monitorAt > PUBLIC_EDGE_MONITOR_MAXIMUM_AGE_MS
  ) {
    fail(
      "PUBLIC_EDGE_STALE_READBACK",
      "Independent current-release monitor evidence is stale or future-dated."
    );
  }
  digest(value.digest, "Public edge current-release binding");
  if (value.digest !== publicEdgeCurrentReleaseBindingDigest(value)) {
    fail(
      "PUBLIC_EDGE_BINDING_INVALID",
      "Public edge current-release binding digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

export function createHeldPublicEdgeCurrentReleaseBinding({
  successorEpoch,
  originSeal,
  installedReadback,
  successorTopology,
  retainedDnsPreflightReceipt,
  independentMonitorReport,
  pagesFallback,
  now = () => new Date()
}) {
  const epoch = validateInstalledFinalReleaseEpochV2Chain({
    epoch: successorEpoch,
    originSeal,
    installedReadback
  });
  const topology = validateRollbackRuntimeTopology(
    successorTopology,
    epoch
  );
  exactExpected(
    topology.listeners,
    installedReadback.listeners,
    "PUBLIC_EDGE_ORIGIN_MISMATCH",
    "Current origin listener topology drifted from installed readback."
  );
  exactExpected(
    topology.worker.contract,
    installedReadback.worker,
    "PUBLIC_EDGE_ORIGIN_MISMATCH",
    "Current origin worker topology drifted from installed readback."
  );
  const dns = retainedDnsReceiptIdentity(retainedDnsPreflightReceipt);
  const monitor = validateIndependentMonitorReport(
    independentMonitorReport
  );
  exactExpected(
    monitor.release,
    releaseIdentityFromEpoch(epoch),
    "PUBLIC_EDGE_ORIGIN_MISMATCH",
    "Independent monitor does not identify the exact current release."
  );
  if (
    monitor.ok !== true ||
    monitor.checks.some((check) => check.ok !== true)
  ) {
    fail(
      "PUBLIC_EDGE_ORIGIN_MISMATCH",
      "Independent current-release edge monitor is not wholly green."
    );
  }
  const pages = validateRollbackPagesFallback(pagesFallback);
  if (
    pages.commitSha !==
      SHAPE_EPOCH_BINDING.source
        .requiredProductionPredecessorCommitSha
  ) {
    fail(
      "PUBLIC_EDGE_PAGES_MISMATCH",
      "Pages fallback is not the exact retained production predecessor."
    );
  }
  const boundAt = clock(now);
  const monitorAt = instant(
    monitor.observedAt,
    "Independent monitor observation"
  );
  if (
    monitorAt > boundAt ||
    boundAt - monitorAt > PUBLIC_EDGE_MONITOR_MAXIMUM_AGE_MS
  ) {
    fail(
      "PUBLIC_EDGE_STALE_READBACK",
      "Independent current-release monitor evidence is stale or future-dated."
    );
  }
  const value = {
    schema: PUBLIC_EDGE_CURRENT_RELEASE_BINDING_SCHEMA,
    state: "bound_held",
    publicEdgeReady: false,
    externalConvergenceRequired: true,
    release: releaseBinding(
      epoch,
      originSeal,
      installedReadback,
      topology
    ),
    hostedRollbackPredecessor: {
      commitSha: epoch.rollback.predecessorCommitSha,
      treeSha: epoch.rollback.predecessorTreeSha,
      artifactManifestSha256:
        epoch.rollback.predecessorArtifactManifestSha256
    },
    pagesFallback: {
      deploymentId: pages.deploymentId,
      commitSha: pages.commitSha,
      artifactManifestSha256: pages.artifactManifestSha256,
      routeManifestSha256: pages.routeManifestSha256,
      digest: pages.digest
    },
    evidence: {
      retainedDnsPreflightReceiptSha256: dns.receiptSha256,
      retainedDnsObservedAt: dns.observedAt,
      independentMonitorTelemetrySha256: monitor.telemetrySha256,
      independentMonitorObservedAt: monitor.observedAt,
      pagesFallbackDigest: pages.digest
    },
    externalBlockers: [...PUBLIC_EDGE_EXTERNAL_BLOCKERS],
    authority: structuredClone(ORIGIN_HELD_AUTHORITY),
    boundAt: boundAt.toISOString()
  };
  return validateHeldPublicEdgeCurrentReleaseBinding({
    ...value,
    digest: publicEdgeCurrentReleaseBindingDigest(value)
  });
}
