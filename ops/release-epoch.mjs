import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const RELEASE_EPOCH_SCHEMA =
  "sitesourcery.release-epoch/v1";
export const RELEASE_EPOCH_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/release-epoch-v1.json";
export const SHAPE_EPOCH_ID = "shape-epoch-20260810";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION_FILE = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const BLOCKERS = Object.freeze([
  "installed_identity",
  "backup_proof",
  "monitor_proof",
  "rollback_proof"
]);

const PROVIDER_PURPOSE_FIELDS = Object.freeze({
  cloudflare: Object.freeze([
    "dnsAuthority",
    "edgePublication",
    "tunnelRouting"
  ]),
  github: Object.freeze([
    "pagesPublication"
  ]),
  resend: Object.freeze([
    "operationsAlerts",
    "recoveryMail",
    "registrationMail"
  ]),
  spaceship: Object.freeze([
    "dnsDelegation",
    "registrarMutation"
  ]),
  stripe: Object.freeze([
    "alakazamBilling",
    "alakazamLifecycle",
    "automaticTaxCollection",
    "customBuildChangePayment",
    "customBuildFinalPayment",
    "customBuildInitialPayment",
    "downloadPayment",
    "providerAccess",
    "websiteAssessmentPayment",
    "webhookConfiguration"
  ])
});

export const RELEASE_EPOCH_PROVIDER_PURPOSE_FIELDS =
  PROVIDER_PURPOSE_FIELDS;

export const SHAPE_EPOCH_BINDING = deepFreeze({
  source: {
    coreReleaseCommitSha:
      "84aca6b757a806b428ae0cce8115c12dcc6486cd",
    githubMainCommitSha:
      "614e971458ef5d14b9179c0fe17edcf3ce2acc09",
    legalPreparationCommitSha:
      "c246068edbee7755f2972252c43a77e8fc9c9625",
    legalCandidateCommitSha:
      "69ad11c682dda9d6f792492d322b662dcbc98b4b",
    requiredProductionPredecessorCommitSha:
      "eff8195640db58390d03eefbe863248220994e37"
  },
  artifact: {
    publicArtifactCommitSha:
      "69ad11c682dda9d6f792492d322b662dcbc98b4b",
    contentSealSha256:
      "53f6d6cbbf26f2df59849fbeb8afaab8ca5377ad67a66d6aa506cb01a64706d3",
    privacySha256:
      "2f9edca746f9bffc1dc4b6745613ae42c04813a3ac94cd2e8432e964cfa36e99",
    privacyByteCount: 31451,
    websiteTermsSha256:
      "4c937f54ae5805a15a9ae835d0266973fb8e8117065dbfce2030ff3f189ff642",
    websiteTermsByteCount: 26215,
    legalCenterSha256:
      "e9e3026d5e97b764b523f46e01ee5ce9b86e471cf427254f83e97f61457ab4d2",
    legalCenterByteCount: 4980
  },
  legal: {
    authoritySchema:
      "sitesourcery.project-legal-authority/v4",
    acceptanceSchema:
      "sitesourcery.project-legal-acceptance/v4",
    authorityDigest:
      "ba2871701541ca78e29a9fef313a3e335e7fed571590eb319667c763a7cd3968",
    effectiveAt: "2026-08-09T21:42:11.000Z",
    privacyVersion:
      "SS-HOSTED-PRIVACY-2026-08-09-V4",
    websiteTermsVersion:
      "SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4"
  },
  database: {
    migrationCount: 58,
    latestMigration:
      "202608090105_hosted_joint_legal_v4_authority.sql"
  }
});

export class ReleaseEpochFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseEpochFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseEpochFailure(code, message);
}

function deepFreeze(value) {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail(
      "RELEASE_EPOCH_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "RELEASE_EPOCH_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commitSha(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(
      "RELEASE_EPOCH_INVALID",
      `${label} must be an exact lowercase Git commit SHA.`
    );
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(
      "RELEASE_EPOCH_INVALID",
      `${label} must be a positive safe integer.`
    );
  }
  return value;
}

function exactIso(value, label) {
  const instant = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(instant.valueOf()) ||
    instant.toISOString() !== value
  ) {
    fail(
      "RELEASE_EPOCH_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return value;
}

function exactExpected(value, expected, label) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      "RELEASE_EPOCH_BINDING_MISMATCH",
      `${label} does not match the exact reviewed release epoch.`
    );
  }
  return value;
}

export function releaseEpochBindingSha256(
  binding = SHAPE_EPOCH_BINDING
) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(binding)}\n`, "utf8")
  );
}

function validateSource(value) {
  exactKeys(
    value,
    [
      "coreReleaseCommitSha",
      "githubMainCommitSha",
      "legalPreparationCommitSha",
      "legalCandidateCommitSha",
      "requiredProductionPredecessorCommitSha"
    ],
    "Release epoch source"
  );
  for (const [field, entry] of Object.entries(value)) {
    commitSha(entry, `Release epoch source ${field}`);
  }
  return exactExpected(
    value,
    SHAPE_EPOCH_BINDING.source,
    "Release epoch source"
  );
}

function validateArtifact(value) {
  exactKeys(
    value,
    [
      "publicArtifactCommitSha",
      "contentSealSha256",
      "privacySha256",
      "privacyByteCount",
      "websiteTermsSha256",
      "websiteTermsByteCount",
      "legalCenterSha256",
      "legalCenterByteCount"
    ],
    "Release epoch artifact"
  );
  commitSha(
    value.publicArtifactCommitSha,
    "Release epoch artifact publicArtifactCommitSha"
  );
  for (const field of [
    "contentSealSha256",
    "privacySha256",
    "websiteTermsSha256",
    "legalCenterSha256"
  ]) {
    digest(value[field], `Release epoch artifact ${field}`);
  }
  for (const field of [
    "privacyByteCount",
    "websiteTermsByteCount",
    "legalCenterByteCount"
  ]) {
    positiveInteger(
      value[field],
      `Release epoch artifact ${field}`
    );
  }
  return exactExpected(
    value,
    SHAPE_EPOCH_BINDING.artifact,
    "Release epoch artifact"
  );
}

function validateLegal(value) {
  exactKeys(
    value,
    [
      "authoritySchema",
      "acceptanceSchema",
      "authorityDigest",
      "effectiveAt",
      "privacyVersion",
      "websiteTermsVersion"
    ],
    "Release epoch legal authority"
  );
  digest(
    value.authorityDigest,
    "Release epoch legal authority digest"
  );
  exactIso(
    value.effectiveAt,
    "Release epoch legal effective time"
  );
  return exactExpected(
    value,
    SHAPE_EPOCH_BINDING.legal,
    "Release epoch legal authority"
  );
}

function validateDatabase(value) {
  exactKeys(
    value,
    ["migrationCount", "latestMigration"],
    "Release epoch database"
  );
  positiveInteger(
    value.migrationCount,
    "Release epoch migration count"
  );
  if (
    typeof value.latestMigration !== "string" ||
    !MIGRATION_FILE.test(value.latestMigration)
  ) {
    fail(
      "RELEASE_EPOCH_INVALID",
      "Release epoch latest migration is invalid."
    );
  }
  return exactExpected(
    value,
    SHAPE_EPOCH_BINDING.database,
    "Release epoch database"
  );
}

function validateBinding(value) {
  exactKeys(
    value,
    ["source", "artifact", "legal", "database", "sha256"],
    "Release epoch binding"
  );
  const binding = {
    source: validateSource(value.source),
    artifact: validateArtifact(value.artifact),
    legal: validateLegal(value.legal),
    database: validateDatabase(value.database)
  };
  const expectedSha256 = releaseEpochBindingSha256(binding);
  if (digest(value.sha256, "Release epoch binding digest") !== expectedSha256) {
    fail(
      "RELEASE_EPOCH_BINDING_MISMATCH",
      "Release epoch binding digest does not match its exact tuple."
    );
  }
  return deepFreeze({
    ...binding,
    sha256: value.sha256
  });
}

function validateBoundProof(value, bindingSha256, label) {
  exactKeys(
    value,
    ["state", "bindingSha256", "receiptSha256", "observedAt"],
    label
  );
  if (
    !["not_proven", "verified"].includes(value.state) ||
    value.bindingSha256 !== bindingSha256
  ) {
    fail(
      "RELEASE_EPOCH_PROOF_INVALID",
      `${label} state or release binding is invalid.`
    );
  }
  if (value.state === "not_proven") {
    if (
      value.receiptSha256 !== null ||
      value.observedAt !== null
    ) {
      fail(
        "RELEASE_EPOCH_PROOF_INVALID",
        `${label} must not claim unverified evidence.`
      );
    }
  } else {
    digest(value.receiptSha256, `${label} receipt`);
    exactIso(value.observedAt, `${label} observation`);
  }
  return deepFreeze({ ...value });
}

function validateInstalledIdentity(
  value,
  bindingSha256
) {
  exactKeys(
    value,
    [
      "state",
      "hostRole",
      "expectedReleaseCommitSha",
      "expectedMigrationCount",
      "observedReleaseCommitSha",
      "observedMigrationCount",
      "bindingSha256",
      "receiptSha256",
      "observedAt"
    ],
    "Installed identity"
  );
  if (
    !["not_proven", "verified"].includes(value.state) ||
    value.hostRole !== "dell_origin_hq_database" ||
    value.expectedReleaseCommitSha !==
      SHAPE_EPOCH_BINDING.source.coreReleaseCommitSha ||
    value.expectedMigrationCount !==
      SHAPE_EPOCH_BINDING.database.migrationCount ||
    value.bindingSha256 !== bindingSha256
  ) {
    fail(
      "RELEASE_EPOCH_IDENTITY_INVALID",
      "Installed identity is not bound to the exact expected release."
    );
  }
  if (value.state === "not_proven") {
    if (
      value.observedReleaseCommitSha !== null ||
      value.observedMigrationCount !== null ||
      value.receiptSha256 !== null ||
      value.observedAt !== null
    ) {
      fail(
        "RELEASE_EPOCH_IDENTITY_INVALID",
        "Unproven installed identity must not carry observed values."
      );
    }
  } else if (
    value.observedReleaseCommitSha !==
      value.expectedReleaseCommitSha ||
    value.observedMigrationCount !==
      value.expectedMigrationCount
  ) {
    fail(
      "RELEASE_EPOCH_IDENTITY_INVALID",
      "Observed installed identity differs from the expected release."
    );
  } else {
    digest(
      value.receiptSha256,
      "Installed identity receipt"
    );
    exactIso(
      value.observedAt,
      "Installed identity observation"
    );
  }
  return deepFreeze({ ...value });
}

function validatePublicMode(value) {
  exactKeys(
    value,
    [
      "state",
      "allowsDeployment",
      "allowsDnsMutation",
      "allowsOriginTraffic",
      "allowsProviderEffects"
    ],
    "Public mode"
  );
  if (
    value.state !== "held" ||
    value.allowsDeployment !== false ||
    value.allowsDnsMutation !== false ||
    value.allowsOriginTraffic !== false ||
    value.allowsProviderEffects !== false
  ) {
    fail(
      "RELEASE_EPOCH_PUBLIC_MODE_INVALID",
      "Shape epoch public mode must remain exactly held."
    );
  }
  return deepFreeze({ ...value });
}

function validateProviderPurposes(value) {
  exactKeys(
    value,
    Object.keys(PROVIDER_PURPOSE_FIELDS),
    "Provider purposes"
  );
  const selected = {};
  for (const [provider, fields] of Object.entries(
    PROVIDER_PURPOSE_FIELDS
  )) {
    exactKeys(
      value[provider],
      fields,
      `Provider purposes ${provider}`
    );
    selected[provider] = {};
    for (const field of fields) {
      if (value[provider][field] !== "held") {
        fail(
          "RELEASE_EPOCH_PROVIDER_PURPOSE_INVALID",
          `Provider purpose ${provider}.${field} must remain held.`
        );
      }
      selected[provider][field] = "held";
    }
    deepFreeze(selected[provider]);
  }
  return deepFreeze(selected);
}

function validateLiveness(value, bindingSha256) {
  exactKeys(
    value,
    ["state", "bindingSha256", "proofSha256", "observedAt"],
    "Release liveness"
  );
  if (
    !["not_observed", "observed"].includes(value.state) ||
    value.bindingSha256 !== bindingSha256
  ) {
    fail(
      "RELEASE_EPOCH_LIVENESS_INVALID",
      "Release liveness state or binding is invalid."
    );
  }
  if (value.state === "not_observed") {
    if (
      value.proofSha256 !== null ||
      value.observedAt !== null
    ) {
      fail(
        "RELEASE_EPOCH_LIVENESS_INVALID",
        "Unobserved liveness must not carry proof."
      );
    }
  } else {
    digest(value.proofSha256, "Release liveness proof");
    exactIso(value.observedAt, "Release liveness observation");
  }
  return deepFreeze({ ...value });
}

function expectedDependencyReadiness(
  installedIdentity,
  proofs,
  bindingSha256
) {
  const blockers = [];
  if (installedIdentity.state !== "verified") {
    blockers.push("installed_identity");
  }
  for (const proof of ["backup", "monitor", "rollback"]) {
    if (proofs[proof].state !== "verified") {
      blockers.push(`${proof}_proof`);
    }
  }
  return deepFreeze({
    state: blockers.length === 0 ? "ready" : "blocked",
    bindingSha256,
    blockers
  });
}

function validateAssurance(
  value,
  {
    installedIdentity,
    proofs,
    bindingSha256
  }
) {
  exactKeys(
    value,
    [
      "liveness",
      "dependencyReadiness",
      "customerCapability"
    ],
    "Release assurance"
  );
  const liveness = validateLiveness(
    value.liveness,
    bindingSha256
  );
  exactKeys(
    value.dependencyReadiness,
    ["state", "bindingSha256", "blockers"],
    "Dependency readiness"
  );
  const expectedReadiness = expectedDependencyReadiness(
    installedIdentity,
    proofs,
    bindingSha256
  );
  exactExpected(
    value.dependencyReadiness,
    expectedReadiness,
    "Dependency readiness"
  );
  if (
    !Array.isArray(value.dependencyReadiness.blockers) ||
    value.dependencyReadiness.blockers.some(
      (blocker) => !BLOCKERS.includes(blocker)
    )
  ) {
    fail(
      "RELEASE_EPOCH_READINESS_INVALID",
      "Dependency readiness blockers are invalid."
    );
  }
  exactKeys(
    value.customerCapability,
    [
      "state",
      "bindingSha256",
      "allowsCustomerEffects",
      "enabledCapabilities"
    ],
    "Customer capability"
  );
  if (
    value.customerCapability.state !== "held" ||
    value.customerCapability.bindingSha256 !== bindingSha256 ||
    value.customerCapability.allowsCustomerEffects !== false ||
    !Array.isArray(
      value.customerCapability.enabledCapabilities
    ) ||
    value.customerCapability.enabledCapabilities.length !== 0
  ) {
    fail(
      "RELEASE_EPOCH_CAPABILITY_INVALID",
      "Customer capability must remain held with no enabled effects."
    );
  }
  return deepFreeze({
    liveness,
    dependencyReadiness: expectedReadiness,
    customerCapability: {
      state: "held",
      bindingSha256,
      allowsCustomerEffects: false,
      enabledCapabilities: []
    }
  });
}

function notProvenProof(bindingSha256) {
  return {
    state: "not_proven",
    bindingSha256,
    receiptSha256: null,
    observedAt: null
  };
}

function boundProof(bindingSha256, evidence) {
  if (evidence === null || evidence === undefined) {
    return notProvenProof(bindingSha256);
  }
  exactKeys(
    evidence,
    ["receiptSha256", "observedAt"],
    "Release epoch proof input"
  );
  return {
    state: "verified",
    bindingSha256,
    receiptSha256: evidence.receiptSha256,
    observedAt: evidence.observedAt
  };
}

function installedIdentity(bindingSha256, evidence) {
  const base = {
    hostRole: "dell_origin_hq_database",
    expectedReleaseCommitSha:
      SHAPE_EPOCH_BINDING.source.coreReleaseCommitSha,
    expectedMigrationCount:
      SHAPE_EPOCH_BINDING.database.migrationCount,
    bindingSha256
  };
  if (evidence === null || evidence === undefined) {
    return {
      state: "not_proven",
      ...base,
      observedReleaseCommitSha: null,
      observedMigrationCount: null,
      receiptSha256: null,
      observedAt: null
    };
  }
  exactKeys(
    evidence,
    [
      "releaseCommitSha",
      "migrationCount",
      "receiptSha256",
      "observedAt"
    ],
    "Installed identity input"
  );
  return {
    state: "verified",
    ...base,
    observedReleaseCommitSha: evidence.releaseCommitSha,
    observedMigrationCount: evidence.migrationCount,
    receiptSha256: evidence.receiptSha256,
    observedAt: evidence.observedAt
  };
}

function heldProviderPurposes() {
  return Object.fromEntries(
    Object.entries(PROVIDER_PURPOSE_FIELDS).map(
      ([provider, fields]) => [
        provider,
        Object.fromEntries(
          fields.map((field) => [field, "held"])
        )
      ]
    )
  );
}

export function createHeldReleaseEpoch({
  installedIdentityEvidence = null,
  backupProof = null,
  monitorProof = null,
  rollbackProof = null,
  livenessProof = null
} = {}) {
  const bindingSha256 = releaseEpochBindingSha256();
  const identity = installedIdentity(
    bindingSha256,
    installedIdentityEvidence
  );
  const proofs = {
    backup: boundProof(bindingSha256, backupProof),
    monitor: boundProof(bindingSha256, monitorProof),
    rollback: {
      ...boundProof(bindingSha256, rollbackProof),
      targetPublicCommitSha:
        SHAPE_EPOCH_BINDING.source
          .requiredProductionPredecessorCommitSha
    }
  };
  const liveness = livenessProof === null
    ? {
        state: "not_observed",
        bindingSha256,
        proofSha256: null,
        observedAt: null
      }
    : (() => {
        exactKeys(
          livenessProof,
          ["proofSha256", "observedAt"],
          "Release liveness proof input"
        );
        return {
          state: "observed",
          bindingSha256,
          proofSha256: livenessProof.proofSha256,
          observedAt: livenessProof.observedAt
        };
      })();
  const epoch = {
    schema: RELEASE_EPOCH_SCHEMA,
    epochId: SHAPE_EPOCH_ID,
    binding: {
      ...SHAPE_EPOCH_BINDING,
      sha256: bindingSha256
    },
    installedIdentity: identity,
    publicMode: {
      state: "held",
      allowsDeployment: false,
      allowsDnsMutation: false,
      allowsOriginTraffic: false,
      allowsProviderEffects: false
    },
    providerPurposes: heldProviderPurposes(),
    proofs,
    assurance: {
      liveness,
      dependencyReadiness:
        expectedDependencyReadiness(
          identity,
          proofs,
          bindingSha256
        ),
      customerCapability: {
        state: "held",
        bindingSha256,
        allowsCustomerEffects: false,
        enabledCapabilities: []
      }
    }
  };
  return validateReleaseEpoch(epoch);
}

export function validateReleaseEpoch(value) {
  exactKeys(
    value,
    [
      "schema",
      "epochId",
      "binding",
      "installedIdentity",
      "publicMode",
      "providerPurposes",
      "proofs",
      "assurance"
    ],
    "Release epoch"
  );
  if (
    value.schema !== RELEASE_EPOCH_SCHEMA ||
    value.epochId !== SHAPE_EPOCH_ID
  ) {
    fail(
      "RELEASE_EPOCH_INVALID",
      "Release epoch schema or identity is invalid."
    );
  }
  const binding = validateBinding(value.binding);
  const installed = validateInstalledIdentity(
    value.installedIdentity,
    binding.sha256
  );
  const publicMode = validatePublicMode(value.publicMode);
  const providerPurposes = validateProviderPurposes(
    value.providerPurposes
  );
  exactKeys(
    value.proofs,
    ["backup", "monitor", "rollback"],
    "Release epoch proofs"
  );
  const proofs = {
    backup: validateBoundProof(
      value.proofs.backup,
      binding.sha256,
      "Backup proof"
    ),
    monitor: validateBoundProof(
      value.proofs.monitor,
      binding.sha256,
      "Monitor proof"
    )
  };
  exactKeys(
    value.proofs.rollback,
    [
      "state",
      "bindingSha256",
      "receiptSha256",
      "observedAt",
      "targetPublicCommitSha"
    ],
    "Rollback proof"
  );
  if (
    value.proofs.rollback.targetPublicCommitSha !==
      binding.source.requiredProductionPredecessorCommitSha
  ) {
    fail(
      "RELEASE_EPOCH_PROOF_INVALID",
      "Rollback proof target does not match the required public predecessor."
    );
  }
  proofs.rollback = deepFreeze({
    ...validateBoundProof(
      {
        state: value.proofs.rollback.state,
        bindingSha256:
          value.proofs.rollback.bindingSha256,
        receiptSha256:
          value.proofs.rollback.receiptSha256,
        observedAt: value.proofs.rollback.observedAt
      },
      binding.sha256,
      "Rollback proof"
    ),
    targetPublicCommitSha:
      value.proofs.rollback.targetPublicCommitSha
  });
  deepFreeze(proofs);
  const assurance = validateAssurance(
    value.assurance,
    {
      installedIdentity: installed,
      proofs,
      bindingSha256: binding.sha256
    }
  );
  return deepFreeze({
    schema: RELEASE_EPOCH_SCHEMA,
    epochId: SHAPE_EPOCH_ID,
    binding,
    installedIdentity: installed,
    publicMode,
    providerPurposes,
    proofs,
    assurance
  });
}
