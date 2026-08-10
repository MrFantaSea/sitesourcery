import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  SHAPE_EPOCH_ID,
  releaseEpochBindingSha256
} from "./release-epoch.mjs";

export const ORIGIN_RELEASE_INPUT_SCHEMA =
  "sitesourcery.origin-release-input/v1";
export const ORIGIN_SUCCESSOR_EPOCH_SCHEMA =
  "sitesourcery.release-epoch-successor-input/v1";
export const ORIGIN_SEAL_SCHEMA =
  "sitesourcery.dell-hq-origin-seal/v1";
export const ORIGIN_INSTALLED_READBACK_SCHEMA =
  "sitesourcery.dell-hq-origin-installed-readback/v1";
export const ORIGIN_READBACK_RECEIPT_SCHEMA =
  "sitesourcery.dell-hq-origin-readback-receipt/v1";
export const ORIGIN_INSTALL_PLAN_SCHEMA =
  "sitesourcery.dell-hq-origin-install-plan/v1";
export const ORIGIN_ROLLBACK_PLAN_SCHEMA =
  "sitesourcery.dell-hq-origin-rollback-plan/v1";

export const ORIGIN_HOST_ROLE = "dell_origin_hq_database";
export const ORIGIN_UNION_BASE_COMMIT =
  "5458d9641fd42c9a1b436c6af6bb6600b60bce74";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

export const ORIGIN_HELD_AUTHORITY = deepFreeze({
  state: "held",
  allowsCapabilities: false,
  allowsCustomerEffects: false,
  allowsProviderEffects: false,
  allowsDnsMutation: false,
  allowsDeployment: false,
  enabledCapabilities: []
});

export const ORIGIN_LOOPBACK_EXPECTATIONS = deepFreeze({
  hostedApi: "127.0.0.1:8788",
  tenantRuntime: "127.0.0.1:8080",
  originGateway: "127.0.0.1:8081",
  tunnelMetrics: "127.0.0.1:20241",
  publicTcpListeners: [],
  cloudflareIngressCatchAll: "http_status:404",
  tunnelTransport: "outbound_only"
});

const IDENTITY_FIELDS = Object.freeze([
  "sourceCommitSha",
  "sourceTreeSha",
  "artifactManifestSha256",
  "unitManifestSha256",
  "environmentSchemaManifestSha256",
  "migrationCount",
  "latestMigration",
  "migrationManifestSha256",
  "legalAuthorityDigest",
  "legalManifestSha256",
  "ingressManifestSha256"
]);

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
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
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be an exact lowercase SHA-256 digest.`);
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be an exact lowercase commit SHA.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

function relativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    !SAFE_RELATIVE_PATH.test(value) ||
    value.includes("//")
  ) {
    fail(`${label} must be a safe repository-relative path.`);
  }
  return value;
}

function exactHeldAuthority(value) {
  exactObject(
    value,
    [
      "state",
      "allowsCapabilities",
      "allowsCustomerEffects",
      "allowsProviderEffects",
      "allowsDnsMutation",
      "allowsDeployment",
      "enabledCapabilities"
    ],
    "Origin held authority"
  );
  if (canonicalJson(value) !== canonicalJson(ORIGIN_HELD_AUTHORITY)) {
    fail("Origin authority must remain exactly held.");
  }
  return value;
}

function validateFileEntry(value, label) {
  exactObject(value, ["path", "byteCount", "sha256"], label);
  relativePath(value.path, `${label} path`);
  nonnegativeInteger(value.byteCount, `${label} byte count`);
  digest(value.sha256, `${label} digest`);
  return value;
}

function validateManifest(value, label, { allowFiles = false } = {}) {
  const keys = allowFiles
    ? ["domain", "fileCount", "byteCount", "files", "sha256"]
    : ["domain", "fileCount", "byteCount", "sha256"];
  exactObject(value, keys, label);
  safeIdentifier(value.domain, `${label} domain`);
  positiveInteger(value.fileCount, `${label} file count`);
  nonnegativeInteger(value.byteCount, `${label} byte count`);
  digest(value.sha256, `${label} digest`);
  if (allowFiles) {
    if (!Array.isArray(value.files) || value.files.length !== value.fileCount) {
      fail(`${label} files are invalid.`);
    }
    let previous = null;
    for (const [index, entry] of value.files.entries()) {
      validateFileEntry(entry, `${label} file ${index}`);
      if (previous !== null && entry.path.localeCompare(previous) <= 0) {
        fail(`${label} files must be uniquely ordered.`);
      }
      previous = entry.path;
    }
    if (
      value.files.reduce((sum, entry) => sum + entry.byteCount, 0) !==
      value.byteCount
    ) {
      fail(`${label} total byte count is invalid.`);
    }
    if (value.sha256 !== originFileManifestSha256(value)) {
      fail(`${label} digest does not match its exact files.`);
    }
  }
  return value;
}

function requireManifestRoot(manifest, root, label) {
  const prefix = `${root}/`;
  if (
    !manifest.files.every((entry) => entry.path.startsWith(prefix))
  ) {
    fail(`${label} contains a file outside its exact root.`);
  }
}

export function originFileManifestSha256(value) {
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson({
        schema: "sitesourcery.origin-file-manifest/v1",
        domain: value.domain,
        files: value.files
      })}\n`,
      "utf8"
    )
  );
}

function successorEpochPayload(epoch) {
  return {
    schema: epoch.schema,
    epochId: epoch.epochId,
    supersedes: epoch.supersedes,
    basis: epoch.basis,
    layout: epoch.layout,
    source: epoch.source,
    artifact: epoch.artifact,
    units: epoch.units,
    environmentSchema: epoch.environmentSchema,
    migration: epoch.migration,
    legal: epoch.legal,
    ingress: epoch.ingress,
    rollback: epoch.rollback,
    authority: epoch.authority
  };
}

function releaseInputPayload(value) {
  return {
    schema: value.schema,
    releaseId: value.releaseId,
    epoch: value.epoch
  };
}

export function successorEpochBindingSha256(epoch) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(successorEpochPayload(epoch))}\n`, "utf8")
  );
}

export function originReleaseInputDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(releaseInputPayload(value))}\n`, "utf8")
  );
}

export function createOriginReleaseInput({ releaseId, epoch }) {
  const selectedEpoch = {
    ...structuredClone(epoch),
    bindingSha256: successorEpochBindingSha256(epoch)
  };
  const value = {
    schema: ORIGIN_RELEASE_INPUT_SCHEMA,
    releaseId,
    epoch: selectedEpoch
  };
  return validateOriginReleaseInput({
    ...value,
    digest: originReleaseInputDigest(value)
  });
}

export function validateOriginReleaseInput(value) {
  exactObject(
    value,
    ["schema", "releaseId", "epoch", "digest"],
    "Origin release input"
  );
  if (value.schema !== ORIGIN_RELEASE_INPUT_SCHEMA) {
    fail("Origin release input schema is invalid.");
  }
  safeIdentifier(value.releaseId, "Origin release ID");
  const epoch = exactObject(
    value.epoch,
    [
      "schema",
      "epochId",
      "supersedes",
      "basis",
      "layout",
      "source",
      "artifact",
      "units",
      "environmentSchema",
      "migration",
      "legal",
      "ingress",
      "rollback",
      "authority",
      "bindingSha256"
    ],
    "Origin successor epoch"
  );
  if (epoch.schema !== ORIGIN_SUCCESSOR_EPOCH_SCHEMA) {
    fail("Origin successor epoch schema is invalid.");
  }
  safeIdentifier(epoch.epochId, "Origin successor epoch ID");
  if (epoch.epochId === SHAPE_EPOCH_ID) {
    fail("Origin successor epoch must use a new identity.");
  }
  exactObject(
    epoch.supersedes,
    ["epochId", "bindingSha256"],
    "Origin predecessor epoch"
  );
  if (
    epoch.supersedes.epochId !== SHAPE_EPOCH_ID ||
    epoch.supersedes.bindingSha256 !== releaseEpochBindingSha256()
  ) {
    fail("Origin release input does not supersede the reviewed release epoch.");
  }
  exactObject(epoch.basis, ["unionBaseCommitSha"], "Origin release basis");
  if (epoch.basis.unionBaseCommitSha !== ORIGIN_UNION_BASE_COMMIT) {
    fail("Origin release input does not use the exact reviewed union base.");
  }
  exactObject(
    epoch.layout,
    ["artifactRoot", "migrationRoot", "legalConstantsPath"],
    "Origin release layout"
  );
  relativePath(epoch.layout.artifactRoot, "Origin artifact root");
  relativePath(epoch.layout.migrationRoot, "Origin migration root");
  relativePath(epoch.layout.legalConstantsPath, "Origin legal constants path");

  exactObject(epoch.source, ["commitSha", "treeSha"], "Origin source");
  commit(epoch.source.commitSha, "Origin source commit");
  commit(epoch.source.treeSha, "Origin source tree");

  exactObject(epoch.artifact, ["manifestSha256"], "Origin artifact");
  digest(epoch.artifact.manifestSha256, "Origin artifact manifest");
  exactObject(epoch.units, ["manifestSha256"], "Origin units");
  digest(epoch.units.manifestSha256, "Origin unit manifest");
  exactObject(
    epoch.environmentSchema,
    ["manifestSha256"],
    "Origin environment schema"
  );
  digest(
    epoch.environmentSchema.manifestSha256,
    "Origin environment-schema manifest"
  );

  exactObject(
    epoch.migration,
    ["count", "latest", "manifestSha256"],
    "Origin migrations"
  );
  positiveInteger(epoch.migration.count, "Origin migration count");
  if (typeof epoch.migration.latest !== "string" || !MIGRATION.test(epoch.migration.latest)) {
    fail("Origin latest migration is invalid.");
  }
  digest(epoch.migration.manifestSha256, "Origin migration manifest");

  exactObject(
    epoch.legal,
    [
      "authorityDigest",
      "privacyVersion",
      "privacySha256",
      "privacyByteCount",
      "websiteTermsVersion",
      "websiteTermsSha256",
      "websiteTermsByteCount",
      "manifestSha256"
    ],
    "Origin legal authority"
  );
  digest(epoch.legal.authorityDigest, "Origin legal authority digest");
  safeIdentifier(epoch.legal.privacyVersion.toLowerCase(), "Origin privacy version");
  digest(epoch.legal.privacySha256, "Origin privacy digest");
  positiveInteger(epoch.legal.privacyByteCount, "Origin privacy byte count");
  safeIdentifier(
    epoch.legal.websiteTermsVersion.toLowerCase(),
    "Origin website terms version"
  );
  digest(epoch.legal.websiteTermsSha256, "Origin website terms digest");
  positiveInteger(
    epoch.legal.websiteTermsByteCount,
    "Origin website terms byte count"
  );
  digest(epoch.legal.manifestSha256, "Origin legal manifest");

  exactObject(epoch.ingress, ["manifestSha256"], "Origin ingress");
  digest(epoch.ingress.manifestSha256, "Origin ingress manifest");

  exactObject(
    epoch.rollback,
    [
      "predecessorCommitSha",
      "predecessorTreeSha",
      "predecessorArtifactManifestSha256"
    ],
    "Origin rollback"
  );
  commit(epoch.rollback.predecessorCommitSha, "Origin rollback predecessor");
  commit(epoch.rollback.predecessorTreeSha, "Origin rollback tree");
  digest(
    epoch.rollback.predecessorArtifactManifestSha256,
    "Origin rollback artifact manifest"
  );
  if (epoch.rollback.predecessorCommitSha === epoch.source.commitSha) {
    fail("Origin rollback predecessor must differ from the candidate.");
  }
  exactHeldAuthority(epoch.authority);
  if (epoch.bindingSha256 !== successorEpochBindingSha256(epoch)) {
    fail("Origin successor epoch binding digest is invalid.");
  }
  if (value.digest !== originReleaseInputDigest(value)) {
    fail("Origin release input digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

function sealPayload(value) {
  return {
    schema: value.schema,
    releaseId: value.releaseId,
    hostRole: value.hostRole,
    unionBaseCommitSha: value.unionBaseCommitSha,
    successorEpochId: value.successorEpochId,
    successorEpochBindingSha256: value.successorEpochBindingSha256,
    releaseInputDigest: value.releaseInputDigest,
    layout: value.layout,
    source: value.source,
    artifact: value.artifact,
    units: value.units,
    environmentSchema: value.environmentSchema,
    migration: value.migration,
    legal: value.legal,
    ingress: value.ingress,
    rollback: value.rollback,
    authority: value.authority
  };
}

export function originSealSha256(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(sealPayload(value))}\n`, "utf8")
  );
}

function exactDigestMatch(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} drifted from the verified successor release input.`);
  }
}

export function createOriginSeal({ releaseInput, observed }) {
  const input = validateOriginReleaseInput(releaseInput);
  exactObject(
    observed,
    [
      "source",
      "artifact",
      "units",
      "environmentSchema",
      "migration",
      "legal",
      "ingress"
    ],
    "Observed origin identity"
  );
  exactObject(observed.source, ["commitSha", "treeSha"], "Observed source");
  commit(observed.source.commitSha, "Observed source commit");
  commit(observed.source.treeSha, "Observed source tree");
  for (const [field, label] of [
    ["commitSha", "Origin source commit"],
    ["treeSha", "Origin source tree"]
  ]) {
    exactDigestMatch(observed.source[field], input.epoch.source[field], label);
  }
  for (const [field, label] of [
    ["artifact", "Origin artifact manifest"],
    ["units", "Origin unit manifest"],
    ["environmentSchema", "Origin environment-schema manifest"],
    ["ingress", "Origin ingress manifest"]
  ]) {
    validateManifest(observed[field], label, { allowFiles: true });
    exactDigestMatch(
      observed[field].sha256,
      input.epoch[field].manifestSha256,
      label
    );
  }
  requireManifestRoot(
    observed.artifact,
    input.epoch.layout.artifactRoot,
    "Origin artifact manifest"
  );
  exactObject(
    observed.migration,
    ["domain", "root", "count", "latest", "fileCount", "byteCount", "files", "sha256"],
    "Observed migrations"
  );
  relativePath(observed.migration.root, "Observed migration root");
  validateManifest(
    {
      domain: observed.migration.domain,
      fileCount: observed.migration.fileCount,
      byteCount: observed.migration.byteCount,
      files: observed.migration.files,
      sha256: observed.migration.sha256
    },
    "Observed migration manifest",
    { allowFiles: true }
  );
  if (
    observed.migration.root !== input.epoch.layout.migrationRoot ||
    observed.migration.count !== observed.migration.fileCount ||
    observed.migration.count !== input.epoch.migration.count ||
    observed.migration.latest !== input.epoch.migration.latest ||
    observed.migration.sha256 !== input.epoch.migration.manifestSha256
  ) {
    fail("Origin migration authority drifted from the verified successor release input.");
  }
  exactObject(
    observed.legal,
    [
      "domain",
      "constantsPath",
      "authorityDigest",
      "privacyVersion",
      "privacySha256",
      "privacyByteCount",
      "websiteTermsVersion",
      "websiteTermsSha256",
      "websiteTermsByteCount",
      "fileCount",
      "byteCount",
      "files",
      "sha256"
    ],
    "Observed legal authority"
  );
  relativePath(observed.legal.constantsPath, "Observed legal constants path");
  if (observed.legal.constantsPath !== input.epoch.layout.legalConstantsPath) {
    fail("Origin legal constants path drifted from the successor release input.");
  }
  validateManifest(
    {
      domain: observed.legal.domain,
      fileCount: observed.legal.fileCount,
      byteCount: observed.legal.byteCount,
      files: observed.legal.files,
      sha256: observed.legal.sha256
    },
    "Observed legal manifest",
    { allowFiles: true }
  );
  for (const field of [
    "authorityDigest",
    "privacyVersion",
    "privacySha256",
    "privacyByteCount",
    "websiteTermsVersion",
    "websiteTermsSha256",
    "websiteTermsByteCount"
  ]) {
    exactDigestMatch(observed.legal[field], input.epoch.legal[field], `Origin legal ${field}`);
  }
  exactDigestMatch(
    observed.legal.sha256,
    input.epoch.legal.manifestSha256,
    "Origin legal manifest"
  );
  const payload = {
    schema: ORIGIN_SEAL_SCHEMA,
    releaseId: input.releaseId,
    hostRole: ORIGIN_HOST_ROLE,
    unionBaseCommitSha: ORIGIN_UNION_BASE_COMMIT,
    successorEpochId: input.epoch.epochId,
    successorEpochBindingSha256: input.epoch.bindingSha256,
    releaseInputDigest: input.digest,
    layout: structuredClone(input.epoch.layout),
    source: structuredClone(observed.source),
    artifact: structuredClone(observed.artifact),
    units: structuredClone(observed.units),
    environmentSchema: structuredClone(observed.environmentSchema),
    migration: structuredClone(observed.migration),
    legal: structuredClone(observed.legal),
    ingress: {
      ...structuredClone(observed.ingress),
      expectations: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS)
    },
    rollback: structuredClone(input.epoch.rollback),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return validateOriginSeal({
    ...payload,
    sealSha256: originSealSha256(payload)
  });
}

export function validateOriginSeal(value) {
  exactObject(
    value,
    [
      "schema",
      "releaseId",
      "hostRole",
      "unionBaseCommitSha",
      "successorEpochId",
      "successorEpochBindingSha256",
      "releaseInputDigest",
      "layout",
      "source",
      "artifact",
      "units",
      "environmentSchema",
      "migration",
      "legal",
      "ingress",
      "rollback",
      "authority",
      "sealSha256"
    ],
    "Origin seal"
  );
  if (value.schema !== ORIGIN_SEAL_SCHEMA || value.hostRole !== ORIGIN_HOST_ROLE) {
    fail("Origin seal identity is invalid.");
  }
  if (value.unionBaseCommitSha !== ORIGIN_UNION_BASE_COMMIT) {
    fail("Origin seal union base is invalid.");
  }
  safeIdentifier(value.releaseId, "Origin seal release ID");
  safeIdentifier(value.successorEpochId, "Origin seal epoch ID");
  for (const [entry, label] of [
    [value.successorEpochBindingSha256, "Origin seal epoch binding"],
    [value.releaseInputDigest, "Origin seal release input"],
    [value.sealSha256, "Origin seal"]
  ]) digest(entry, label);
  exactObject(
    value.layout,
    ["artifactRoot", "migrationRoot", "legalConstantsPath"],
    "Origin seal layout"
  );
  relativePath(value.layout.artifactRoot, "Origin seal artifact root");
  relativePath(value.layout.migrationRoot, "Origin seal migration root");
  relativePath(
    value.layout.legalConstantsPath,
    "Origin seal legal constants path"
  );
  exactObject(value.source, ["commitSha", "treeSha"], "Origin seal source");
  commit(value.source.commitSha, "Origin seal source commit");
  commit(value.source.treeSha, "Origin seal source tree");
  for (const [field, label] of [
    ["artifact", "Origin seal artifact"],
    ["units", "Origin seal units"],
    ["environmentSchema", "Origin seal environment schema"]
  ]) {
    validateManifest(value[field], label, { allowFiles: true });
  }
  requireManifestRoot(
    value.artifact,
    value.layout.artifactRoot,
    "Origin seal artifact manifest"
  );
  exactObject(
    value.migration,
    ["domain", "root", "count", "latest", "fileCount", "byteCount", "files", "sha256"],
    "Origin seal migrations"
  );
  relativePath(value.migration.root, "Origin seal migration root");
  validateManifest(
    {
      domain: value.migration.domain,
      fileCount: value.migration.fileCount,
      byteCount: value.migration.byteCount,
      files: value.migration.files,
      sha256: value.migration.sha256
    },
    "Origin seal migration manifest",
    { allowFiles: true }
  );
  if (
    value.migration.root !== value.layout.migrationRoot ||
    value.migration.count !== value.migration.fileCount ||
    value.migration.latest !== value.migration.files.at(-1)?.path.split("/").at(-1)
  ) {
    fail("Origin seal migration count or latest file is invalid.");
  }
  exactObject(
    value.legal,
    [
      "domain",
      "constantsPath",
      "authorityDigest",
      "privacyVersion",
      "privacySha256",
      "privacyByteCount",
      "websiteTermsVersion",
      "websiteTermsSha256",
      "websiteTermsByteCount",
      "fileCount",
      "byteCount",
      "files",
      "sha256"
    ],
    "Origin seal legal authority"
  );
  if (
    typeof value.legal.privacyVersion !== "string" ||
    typeof value.legal.websiteTermsVersion !== "string"
  ) {
    fail("Origin seal legal versions are invalid.");
  }
  safeIdentifier(
    value.legal.privacyVersion.toLowerCase(),
    "Origin seal privacy version"
  );
  safeIdentifier(
    value.legal.websiteTermsVersion.toLowerCase(),
    "Origin seal website terms version"
  );
  relativePath(value.legal.constantsPath, "Origin seal legal constants path");
  if (value.legal.constantsPath !== value.layout.legalConstantsPath) {
    fail("Origin seal legal constants path is invalid.");
  }
  for (const [entry, label] of [
    [value.legal.authorityDigest, "Origin seal legal authority"],
    [value.legal.privacySha256, "Origin seal privacy"],
    [value.legal.websiteTermsSha256, "Origin seal website terms"]
  ]) digest(entry, label);
  positiveInteger(value.legal.privacyByteCount, "Origin seal privacy byte count");
  positiveInteger(
    value.legal.websiteTermsByteCount,
    "Origin seal website terms byte count"
  );
  validateManifest(
    {
      domain: value.legal.domain,
      fileCount: value.legal.fileCount,
      byteCount: value.legal.byteCount,
      files: value.legal.files,
      sha256: value.legal.sha256
    },
    "Origin seal legal manifest",
    { allowFiles: true }
  );
  exactObject(
    value.ingress,
    ["domain", "fileCount", "byteCount", "files", "sha256", "expectations"],
    "Origin seal ingress"
  );
  validateManifest(
    {
      domain: value.ingress.domain,
      fileCount: value.ingress.fileCount,
      byteCount: value.ingress.byteCount,
      files: value.ingress.files,
      sha256: value.ingress.sha256
    },
    "Origin seal ingress manifest",
    { allowFiles: true }
  );
  exactObject(
    value.rollback,
    ["predecessorCommitSha", "predecessorTreeSha", "predecessorArtifactManifestSha256"],
    "Origin seal rollback"
  );
  commit(value.rollback.predecessorCommitSha, "Origin seal rollback predecessor");
  commit(value.rollback.predecessorTreeSha, "Origin seal rollback tree");
  digest(
    value.rollback.predecessorArtifactManifestSha256,
    "Origin seal rollback artifact"
  );
  exactHeldAuthority(value.authority);
  if (canonicalJson(value.ingress?.expectations) !== canonicalJson(ORIGIN_LOOPBACK_EXPECTATIONS)) {
    fail("Origin seal loopback expectations are invalid.");
  }
  if (value.sealSha256 !== originSealSha256(value)) {
    fail("Origin seal digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

export function expectedOriginInstalledIdentity(seal) {
  const selected = validateOriginSeal(seal);
  return deepFreeze({
    sourceCommitSha: selected.source.commitSha,
    sourceTreeSha: selected.source.treeSha,
    artifactManifestSha256: selected.artifact.sha256,
    unitManifestSha256: selected.units.sha256,
    environmentSchemaManifestSha256: selected.environmentSchema.sha256,
    migrationCount: selected.migration.count,
    latestMigration: selected.migration.latest,
    migrationManifestSha256: selected.migration.sha256,
    legalAuthorityDigest: selected.legal.authorityDigest,
    legalManifestSha256: selected.legal.sha256,
    ingressManifestSha256: selected.ingress.sha256
  });
}

function readbackPayload(value) {
  return {
    schema: value.schema,
    sealSha256: value.sealSha256,
    hostRole: value.hostRole,
    observedAt: value.observedAt,
    identity: value.identity,
    listeners: value.listeners,
    authority: value.authority
  };
}

export function originInstalledReadbackDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(readbackPayload(value))}\n`, "utf8")
  );
}

export function createOriginInstalledReadback({ seal, observedAt, identity, listeners, authority }) {
  const selectedSeal = validateOriginSeal(seal);
  const value = {
    schema: ORIGIN_INSTALLED_READBACK_SCHEMA,
    sealSha256: selectedSeal.sealSha256,
    hostRole: ORIGIN_HOST_ROLE,
    observedAt,
    identity,
    listeners,
    authority
  };
  return validateOriginInstalledReadback({
    ...value,
    digest: originInstalledReadbackDigest(value)
  });
}

export function validateOriginInstalledReadback(value) {
  exactObject(
    value,
    ["schema", "sealSha256", "hostRole", "observedAt", "identity", "listeners", "authority", "digest"],
    "Origin installed readback"
  );
  if (
    value.schema !== ORIGIN_INSTALLED_READBACK_SCHEMA ||
    value.hostRole !== ORIGIN_HOST_ROLE
  ) {
    fail("Origin installed readback identity is invalid.");
  }
  digest(value.sealSha256, "Origin installed readback seal");
  exactInstant(value.observedAt, "Origin installed readback observation");
  exactObject(value.identity, IDENTITY_FIELDS, "Origin installed identity");
  for (const field of IDENTITY_FIELDS) {
    if (field === "migrationCount") positiveInteger(value.identity[field], "Installed migration count");
    else if (field === "latestMigration") {
      if (typeof value.identity[field] !== "string" || !MIGRATION.test(value.identity[field])) {
        fail("Installed latest migration is invalid.");
      }
    } else if (field.endsWith("CommitSha") || field.endsWith("TreeSha")) {
      commit(value.identity[field], `Installed ${field}`);
    } else {
      digest(value.identity[field], `Installed ${field}`);
    }
  }
  if (canonicalJson(value.listeners) !== canonicalJson(ORIGIN_LOOPBACK_EXPECTATIONS)) {
    fail("Origin installed listener readback is not exactly loopback-only.");
  }
  exactHeldAuthority(value.authority);
  if (value.digest !== originInstalledReadbackDigest(value)) {
    fail("Origin installed readback digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    sealSha256: value.sealSha256,
    readbackDigest: value.readbackDigest,
    observedAt: value.observedAt,
    state: value.state,
    mismatches: value.mismatches
  };
}

export function compareOriginInstalledReadback({ seal, readback }) {
  const selectedSeal = validateOriginSeal(seal);
  const selectedReadback = validateOriginInstalledReadback(readback);
  const expected = expectedOriginInstalledIdentity(selectedSeal);
  const mismatches = [];
  for (const field of IDENTITY_FIELDS) {
    if (selectedReadback.identity[field] !== expected[field]) {
      mismatches.push(`IDENTITY_${field.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_MISMATCH`);
    }
  }
  if (selectedReadback.sealSha256 !== selectedSeal.sealSha256) {
    mismatches.push("SEAL_IDENTITY_MISMATCH");
  }
  mismatches.sort((left, right) => left.localeCompare(right));
  const payload = {
    schema: ORIGIN_READBACK_RECEIPT_SCHEMA,
    sealSha256: selectedSeal.sealSha256,
    readbackDigest: selectedReadback.digest,
    observedAt: selectedReadback.observedAt,
    state: mismatches.length === 0 ? "verified" : "mismatch",
    mismatches
  };
  return deepFreeze({
    ...payload,
    receiptSha256: sha256Bytes(
      Buffer.from(`${canonicalJson(receiptPayload(payload))}\n`, "utf8")
    )
  });
}

function command(id, argv) {
  safeIdentifier(id, "Origin plan command ID");
  if (
    !Array.isArray(argv) ||
    argv.length < 1 ||
    argv.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    fail("Origin plan command argv is invalid.");
  }
  return { id, argv };
}

function planDigest(value, excludedField) {
  const payload = { ...value };
  delete payload[excludedField];
  return sha256Bytes(
    Buffer.from(`${canonicalJson(payload)}\n`, "utf8")
  );
}

export function createOriginInstallPlan(seal) {
  const selected = validateOriginSeal(seal);
  const releaseRoot = `/opt/sitesourcery/releases/${selected.releaseId}`;
  const commands = [
    command("verify-release-directory", ["test", "-d", releaseRoot]),
    command("verify-runtime-hold", ["test", "!", "-e", "/etc/sitesourcery/RUNTIME_APPROVED"]),
    command("verify-publication-hold", ["test", "-e", "/etc/sitesourcery/PUBLICATION_HOLD"]),
    command("verify-tunnel-hold", ["test", "!", "-e", "/home/simtech/sitesourcery-production/run/CLOUDFLARE_TUNNEL_APPROVED"]),
    command("verify-private-environment", ["test", "-r", "/etc/sitesourcery/hosted.env"]),
    command("install-hosted-unit", ["install", "-o", "root", "-g", "root", "-m", "0644", `${releaseRoot}/ops/sitesourcery-hosted.service.held`, "/etc/systemd/system/sitesourcery-hosted.service"]),
    command("install-origin-unit", ["install", "-o", "simtech", "-g", "simtech", "-m", "0644", `${releaseRoot}/ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service`, "/home/simtech/.config/systemd/user/sitesourcery-origin.service"]),
    command("install-tunnel-unit", ["install", "-o", "simtech", "-g", "simtech", "-m", "0644", `${releaseRoot}/ops/production-rehearsal/sitesourcery-cloudflared.user.service`, "/home/simtech/.config/systemd/user/sitesourcery-cloudflared.service"]),
    command("select-release", ["ln", "-sfn", releaseRoot, "/opt/sitesourcery/current"]),
    command("reload-system-manager", ["systemctl", "daemon-reload"]),
    command("reload-user-manager", ["systemctl", "--user", "daemon-reload"])
  ];
  const payload = {
    schema: ORIGIN_INSTALL_PLAN_SCHEMA,
    state: "held",
    hostRole: ORIGIN_HOST_ROLE,
    releaseId: selected.releaseId,
    sealSha256: selected.sealSha256,
    releaseRoot,
    requiredGates: [
      "owner_install_approval",
      "successor_release_epoch_verified",
      "private_environment_values_installed_out_of_band",
      "installed_readback_verified"
    ],
    commands,
    intentionallyExcludedCommands: [
      "service_start",
      "service_restart",
      "service_enable",
      "database_migration",
      "dns_change",
      "provider_call",
      "deployment"
    ]
  };
  return deepFreeze({ ...payload, planSha256: planDigest(payload, "planSha256") });
}

export function createOriginRollbackPlan(seal) {
  const selected = validateOriginSeal(seal);
  const predecessorRoot =
    `/opt/sitesourcery/releases/${selected.rollback.predecessorCommitSha}`;
  const commands = [
    command("remove-tunnel-approval", ["rm", "-f", "--", "/home/simtech/sitesourcery-production/run/CLOUDFLARE_TUNNEL_APPROVED"]),
    command("stop-tunnel", ["systemctl", "--user", "stop", "sitesourcery-cloudflared.service"]),
    command("stop-origin-gateway", ["systemctl", "--user", "stop", "sitesourcery-origin.service"]),
    command("stop-hosted-runtime", ["systemctl", "stop", "sitesourcery-hosted.service"]),
    command("verify-predecessor-directory", ["test", "-d", predecessorRoot]),
    command("select-predecessor", ["ln", "-sfn", predecessorRoot, "/opt/sitesourcery/current"]),
    command("reload-system-manager", ["systemctl", "daemon-reload"]),
    command("reload-user-manager", ["systemctl", "--user", "daemon-reload"]),
    command("confirm-runtime-held", ["test", "!", "-e", "/etc/sitesourcery/RUNTIME_APPROVED"]),
    command("confirm-publication-held", ["test", "-e", "/etc/sitesourcery/PUBLICATION_HOLD"])
  ];
  const payload = {
    schema: ORIGIN_ROLLBACK_PLAN_SCHEMA,
    state: "held",
    hostRole: ORIGIN_HOST_ROLE,
    sealSha256: selected.sealSha256,
    predecessor: structuredClone(selected.rollback),
    predecessorRoot,
    commands,
    postcondition: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return deepFreeze({ ...payload, planSha256: planDigest(payload, "planSha256") });
}
