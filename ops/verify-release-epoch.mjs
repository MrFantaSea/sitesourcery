import { execFile } from "node:child_process";
import {
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  fileURLToPath,
  pathToFileURL
} from "node:url";

import {
  canonicalJson,
  readJsonObject,
  sha256File
} from "./immutable-evidence.mjs";
import {
  RELEASE_EPOCH_JSON_SCHEMA_ID,
  RELEASE_EPOCH_PROVIDER_PURPOSE_FIELDS,
  RELEASE_EPOCH_SCHEMA,
  SHAPE_EPOCH_BINDING,
  SHAPE_EPOCH_ID,
  validateReleaseEpoch
} from "./release-epoch.mjs";

const executeFile = promisify(execFile);
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const DEFAULT_EPOCH_PATH = path.join(
  PROJECT_ROOT,
  "ops/releases/shape-epoch-2026-08-10/release-epoch.json"
);
const SCHEMA_PATH = path.join(
  PROJECT_ROOT,
  "ops/release-epoch.schema.json"
);
const LEGAL_RELEASE_ROOT = path.join(
  PROJECT_ROOT,
  "ops/releases/joint-legal-v4-2026-08-09T214211Z"
);
const LEGAL_CONSTANTS_PATH = path.join(
  LEGAL_RELEASE_ROOT,
  "joint-legal-v4-release-constants.json"
);
const MIGRATION_ROOT = path.join(
  PROJECT_ROOT,
  "server/data-plane/supabase/migrations"
);

const PURPOSE_SOURCE_REQUIREMENTS = Object.freeze([
  [
    "cloudflare.dnsAuthority",
    "ops/operations-state.mjs",
    "SITESOURCERY_EXPECT_DNS"
  ],
  [
    "cloudflare.edgePublication",
    "ops/operations-state.mjs",
    "SITESOURCERY_EXPECT_PUBLICATION"
  ],
  [
    "cloudflare.tunnelRouting",
    "ops/operations-state.mjs",
    "publication: new Set([\"held\", \"approved\"])"
  ],
  [
    "github.pagesPublication",
    "data/release-control.json",
    "allowsPublicTruthReconciliationDeployment"
  ],
  [
    "resend.operationsAlerts",
    "ops/monitor-held.mjs",
    "SITESOURCERY_ALERT_MODE"
  ],
  [
    "resend.recoveryMail",
    "server/hosted/production-ports.mjs",
    "SITESOURCERY_RECOVERY_MAIL_MODE"
  ],
  [
    "resend.registrationMail",
    "server/hosted/production-ports.mjs",
    "SITESOURCERY_REGISTRATION_MAIL_MODE"
  ],
  [
    "spaceship.dnsDelegation",
    "ops/operations-state.mjs",
    "SITESOURCERY_EXPECT_DNS"
  ],
  [
    "spaceship.registrarMutation",
    "ops/operations-state.mjs",
    "SITESOURCERY_EXPECT_DOMAIN_RUNTIME"
  ],
  [
    "stripe.alakazamBilling",
    "server/hosted/alakazam-release-config.mjs",
    "SITESOURCERY_ALAKAZAM_MODE"
  ],
  [
    "stripe.alakazamLifecycle",
    "server/hosted/alakazam-lifecycle-policy-config.mjs",
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE"
  ],
  [
    "stripe.automaticTaxCollection",
    "server/hosted/stripe-production-config.mjs",
    "SITESOURCERY_STRIPE_TAX_MODE"
  ],
  [
    "stripe.customBuildChangePayment",
    "server/hosted/custom-services-custom-build-change-payment-config.mjs",
    "SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE"
  ],
  [
    "stripe.customBuildFinalPayment",
    "server/hosted/custom-services-custom-build-final-payment-config.mjs",
    "SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE"
  ],
  [
    "stripe.customBuildInitialPayment",
    "server/hosted/custom-services-custom-build-payment-config.mjs",
    "SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE"
  ],
  [
    "stripe.downloadPayment",
    "server/hosted/download-payment-config.mjs",
    "SITESOURCERY_DOWNLOAD_PAYMENT_MODE"
  ],
  [
    "stripe.providerAccess",
    "server/hosted/stripe-production-config.mjs",
    "SITESOURCERY_STRIPE_MODE"
  ],
  [
    "stripe.websiteAssessmentPayment",
    "server/hosted/custom-services-assessment-payment-config.mjs",
    "SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE"
  ],
  [
    "stripe.webhookConfiguration",
    "server/hosted/stripe-production-config.mjs",
    "webhook_endpoints:read"
  ]
]);

export class ReleaseEpochVerificationFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseEpochVerificationFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseEpochVerificationFailure(code, message);
}

function exact(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      "RELEASE_EPOCH_REPOSITORY_MISMATCH",
      `${label} does not match the release epoch.`
    );
  }
  return actual;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail(
      "RELEASE_EPOCH_SCHEMA_INVALID",
      `${label} must contain its exact reviewed keys.`
    );
  }
}

async function git(projectRoot, ...arguments_) {
  try {
    const result = await executeFile(
      "git",
      arguments_,
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      }
    );
    return result.stdout.trim();
  } catch {
    fail(
      "RELEASE_EPOCH_GIT_MISMATCH",
      "Required release-epoch Git history is unavailable or invalid."
    );
  }
}

async function assertAncestor(
  projectRoot,
  ancestor,
  descendant
) {
  try {
    await executeFile(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd: projectRoot }
    );
  } catch {
    fail(
      "RELEASE_EPOCH_GIT_MISMATCH",
      "Required release-epoch Git ancestry is invalid."
    );
  }
}

function validateSchema(schema, epoch) {
  exactKeys(
    schema,
    [
      "$schema",
      "$id",
      "title",
      "type",
      "additionalProperties",
      "required",
      "properties",
      "$defs"
    ],
    "Release epoch JSON Schema"
  );
  if (
    schema.$schema !==
      "https://json-schema.org/draft/2020-12/schema" ||
    schema.$id !== RELEASE_EPOCH_JSON_SCHEMA_ID ||
    schema.type !== "object" ||
    schema.additionalProperties !== false
  ) {
    fail(
      "RELEASE_EPOCH_SCHEMA_INVALID",
      "Release epoch JSON Schema identity or root fence is invalid."
    );
  }
  const rootFields = [
    "schema",
    "epochId",
    "binding",
    "installedIdentity",
    "publicMode",
    "providerPurposes",
    "proofs",
    "assurance"
  ];
  exact(schema.required, rootFields, "Release epoch required fields");
  exactKeys(
    schema.properties,
    rootFields,
    "Release epoch schema properties"
  );
  exact(
    schema.properties.schema.const,
    RELEASE_EPOCH_SCHEMA,
    "Release epoch schema constant"
  );
  exact(
    schema.properties.epochId.const,
    SHAPE_EPOCH_ID,
    "Release epoch identity constant"
  );
  exact(
    schema.properties.binding.const,
    epoch.binding,
    "Release epoch binding schema"
  );
  exact(
    schema.properties.publicMode.const,
    epoch.publicMode,
    "Release epoch public-mode schema"
  );
  exact(
    schema.properties.providerPurposes.const,
    epoch.providerPurposes,
    "Release epoch provider-purpose schema"
  );
  exact(
    schema.properties.assurance.properties
      .customerCapability.const,
    epoch.assurance.customerCapability,
    "Release epoch capability schema"
  );
  return schema;
}

async function verifyGitTuple(projectRoot, binding) {
  const source = binding.source;
  for (const commit of Object.values(source)) {
    await git(projectRoot, "cat-file", "-e", `${commit}^{commit}`);
  }
  const preparationParents = (
    await git(
      projectRoot,
      "show",
      "-s",
      "--format=%P",
      source.legalPreparationCommitSha
    )
  ).split(" ");
  exact(
    preparationParents,
    [source.coreReleaseCommitSha],
    "Legal preparation parent"
  );
  const candidateParents = (
    await git(
      projectRoot,
      "show",
      "-s",
      "--format=%P",
      source.legalCandidateCommitSha
    )
  ).split(" ");
  exact(
    candidateParents,
    [
      source.legalPreparationCommitSha,
      source.githubMainCommitSha
    ],
    "Legal candidate parents"
  );
  exact(
    await git(
      projectRoot,
      "rev-parse",
      `${source.legalPreparationCommitSha}^{tree}`
    ),
    await git(
      projectRoot,
      "rev-parse",
      `${source.legalCandidateCommitSha}^{tree}`
    ),
    "Legal candidate tree"
  );
  await assertAncestor(
    projectRoot,
    source.legalCandidateCommitSha,
    "HEAD"
  );
  exact(
    binding.artifact.publicArtifactCommitSha,
    source.legalCandidateCommitSha,
    "Public artifact commit"
  );
}

function document(constants, kind) {
  const matches = constants.documents.filter(
    (entry) => entry.kind === kind
  );
  if (matches.length !== 1) {
    fail(
      "RELEASE_EPOCH_LEGAL_MISMATCH",
      `Joint Legal V4 ${kind} document is not unique.`
    );
  }
  return matches[0];
}

function artifact(constants, role) {
  const matches = constants.artifacts.filter(
    (entry) => entry.role === role
  );
  if (matches.length !== 1) {
    fail(
      "RELEASE_EPOCH_ARTIFACT_MISMATCH",
      `Joint Legal V4 ${role} artifact is not unique.`
    );
  }
  return matches[0];
}

async function verifyArtifactFile(
  releaseRoot,
  entry,
  expectedDigest,
  expectedBytes
) {
  const artifactPath = path.join(releaseRoot, entry.file);
  const metadata = await stat(artifactPath);
  exact(entry.sha256, expectedDigest, `${entry.role} declared digest`);
  exact(entry.byteCount, expectedBytes, `${entry.role} declared bytes`);
  exact(
    await sha256File(artifactPath),
    expectedDigest,
    `${entry.role} file digest`
  );
  exact(metadata.size, expectedBytes, `${entry.role} file bytes`);
}

async function verifyLegalTuple(projectRoot, binding) {
  const constants = await readJsonObject(
    path.join(
      projectRoot,
      path.relative(PROJECT_ROOT, LEGAL_CONSTANTS_PATH)
    ),
    "Joint Legal V4 constants"
  );
  const releaseRoot = path.join(
    projectRoot,
    path.relative(PROJECT_ROOT, LEGAL_RELEASE_ROOT)
  );
  const privacy = document(constants, "privacy");
  const product = document(constants, "product");
  const website = document(constants, "website");
  exact(
    {
      authoritySchema: constants.authoritySchema,
      acceptanceSchema: constants.acceptanceSchema,
      authorityDigest: constants.authorityDigest,
      effectiveAt: constants.effectiveAt,
      privacyVersion: privacy.version,
      websiteTermsVersion: website.version
    },
    binding.legal,
    "Joint Legal V4 authority"
  );
  exact(product.version, website.version, "Joint Legal V4 terms version");
  exact(
    product.contentDigest,
    website.contentDigest,
    "Joint Legal V4 terms digest"
  );
  exact(
    constants.contentSeal.contentSealSha256,
    binding.artifact.contentSealSha256,
    "Joint Legal V4 content seal"
  );
  await verifyArtifactFile(
    releaseRoot,
    artifact(constants, "privacy-current"),
    binding.artifact.privacySha256,
    binding.artifact.privacyByteCount
  );
  await verifyArtifactFile(
    releaseRoot,
    artifact(constants, "privacy-versioned"),
    binding.artifact.privacySha256,
    binding.artifact.privacyByteCount
  );
  await verifyArtifactFile(
    releaseRoot,
    artifact(constants, "website-terms-current"),
    binding.artifact.websiteTermsSha256,
    binding.artifact.websiteTermsByteCount
  );
  await verifyArtifactFile(
    releaseRoot,
    artifact(constants, "website-terms-versioned"),
    binding.artifact.websiteTermsSha256,
    binding.artifact.websiteTermsByteCount
  );
  await verifyArtifactFile(
    releaseRoot,
    artifact(constants, "legal-center-current"),
    binding.artifact.legalCenterSha256,
    binding.artifact.legalCenterByteCount
  );
  if (
    constants.published !== false ||
    constants.integrationRequired !== true
  ) {
    fail(
      "RELEASE_EPOCH_LEGAL_MISMATCH",
      "Joint Legal V4 publication state must remain held."
    );
  }
}

async function verifyMigrations(projectRoot, binding) {
  const migrationRoot = path.join(
    projectRoot,
    path.relative(PROJECT_ROOT, MIGRATION_ROOT)
  );
  const migrations = (await readdir(migrationRoot))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  exact(
    migrations.length,
    binding.database.migrationCount,
    "PostgreSQL migration count"
  );
  exact(
    migrations.at(-1),
    binding.database.latestMigration,
    "Latest PostgreSQL migration"
  );
}

async function verifyHeldControls(projectRoot, epoch) {
  const releaseControl = await readJsonObject(
    path.join(projectRoot, "data/release-control.json"),
    "Release control"
  );
  if (
    releaseControl.state !== "hold" ||
    releaseControl.allowsDeployment !== false ||
    releaseControl.allowsCommercialDeployment !== false ||
    releaseControl.allowsContainmentDeployment !== false ||
    releaseControl
      .allowsPublicTruthReconciliationDeployment !== false ||
    releaseControl.publicTruthReconciliation?.state !== "hold" ||
    releaseControl.publicTruthReconciliation
      ?.approvedCandidateSha !== null ||
    releaseControl.publicTruthReconciliation
      ?.authorityReceiptSha256 !== null
  ) {
    fail(
      "RELEASE_EPOCH_CONTROL_NOT_HELD",
      "Repository release control is not exactly held."
    );
  }
  exact(
    releaseControl.publicTruthReconciliation
      .requiredProductionPredecessor,
    epoch.binding.source
      .requiredProductionPredecessorCommitSha,
    "Public rollback predecessor"
  );
  const commercialControl = await readJsonObject(
    path.join(
      projectRoot,
      "data/abracadabra-commercial-control.json"
    ),
    "Commercial control"
  );
  if (
    commercialControl.state !== "hold" ||
    commercialControl.checkout?.enabled !== false ||
    commercialControl.domainCheckout?.enabled !== false ||
    commercialControl.costPolicy
      ?.automaticProviderUpgradesAllowed !== false ||
    commercialControl.costPolicy
      ?.automaticUsageOveragesAllowed !== false ||
    commercialControl.costPolicy
      ?.providerPurchasesAuthorized !== false
  ) {
    fail(
      "RELEASE_EPOCH_CONTROL_NOT_HELD",
      "Repository commercial control is not exactly held."
    );
  }
}

function flattenedProviderPurposes() {
  return Object.entries(
    RELEASE_EPOCH_PROVIDER_PURPOSE_FIELDS
  ).flatMap(([provider, fields]) =>
    fields.map((field) => `${provider}.${field}`)
  );
}

async function verifyProviderPurposeCoverage(projectRoot) {
  exact(
    PURPOSE_SOURCE_REQUIREMENTS.map(([purpose]) => purpose).sort(),
    flattenedProviderPurposes().sort(),
    "Provider-purpose source coverage"
  );
  const sources = new Map();
  for (const [, relativePath] of PURPOSE_SOURCE_REQUIREMENTS) {
    if (!sources.has(relativePath)) {
      sources.set(
        relativePath,
        await readFile(
          path.join(projectRoot, relativePath),
          "utf8"
        )
      );
    }
  }
  for (const [purpose, relativePath, token] of
    PURPOSE_SOURCE_REQUIREMENTS) {
    if (!sources.get(relativePath).includes(token)) {
      fail(
        "RELEASE_EPOCH_PROVIDER_PURPOSE_MISSING",
        `Provider purpose ${purpose} lost its source contract.`
      );
    }
  }
}

export async function verifyReleaseEpochRepository({
  projectRoot = PROJECT_ROOT,
  epochPath = DEFAULT_EPOCH_PATH
} = {}) {
  const [epochSource, schema] = await Promise.all([
    readJsonObject(epochPath, "Release epoch"),
    readJsonObject(
      path.join(
        projectRoot,
        path.relative(PROJECT_ROOT, SCHEMA_PATH)
      ),
      "Release epoch JSON Schema"
    )
  ]);
  const epoch = validateReleaseEpoch(epochSource);
  exact(
    {
      source: epoch.binding.source,
      artifact: epoch.binding.artifact,
      legal: epoch.binding.legal,
      database: epoch.binding.database
    },
    SHAPE_EPOCH_BINDING,
    "Release epoch exact binding"
  );
  validateSchema(schema, epoch);
  await verifyGitTuple(projectRoot, epoch.binding);
  await verifyLegalTuple(projectRoot, epoch.binding);
  await verifyMigrations(projectRoot, epoch.binding);
  await verifyHeldControls(projectRoot, epoch);
  await verifyProviderPurposeCoverage(projectRoot);
  return Object.freeze({
    valid: true,
    epochId: epoch.epochId,
    bindingSha256: epoch.binding.sha256,
    migrationCount: epoch.binding.database.migrationCount,
    providerPurposeCount:
      flattenedProviderPurposes().length,
    installedIdentity:
      epoch.installedIdentity.state,
    liveness: epoch.assurance.liveness.state,
    dependencyReadiness:
      epoch.assurance.dependencyReadiness.state,
    dependencyBlockerCount:
      epoch.assurance.dependencyReadiness.blockers.length,
    customerCapability:
      epoch.assurance.customerCapability.state,
    publicMode: epoch.publicMode.state,
    providerEffectsAllowed: false
  });
}

function argumentsFrom(argv) {
  if (argv.length === 0) {
    return { epochPath: DEFAULT_EPOCH_PATH };
  }
  if (
    argv.length !== 2 ||
    argv[0] !== "--epoch" ||
    !path.isAbsolute(argv[1])
  ) {
    fail(
      "RELEASE_EPOCH_ARGUMENT_INVALID",
      "Usage: verify-release-epoch.mjs [--epoch /absolute/path]."
    );
  }
  return { epochPath: argv[1] };
}

async function main() {
  const result = await verifyReleaseEpochRepository(
    argumentsFrom(process.argv.slice(2))
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        valid: false,
        code:
          error instanceof ReleaseEpochVerificationFailure
            ? error.code
            : "RELEASE_EPOCH_VERIFICATION_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
