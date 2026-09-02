import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalJson, sha256Bytes } from "../immutable-evidence.mjs";
import { parseFin010EnvironmentFile } from "../fin010-production-runtime.mjs";
import { FIN015_EXPECTED_ENVIRONMENT_NAMES } from "../fin015-production-runtime.mjs";
import {
  FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
  FIN015_SUCCESSOR_SCHEMA_SHA256,
  FIN015_SUCCESSOR_TABLE_COUNT
} from "../fin015-protected-production-upgrade.mjs";
import {
  FIN016_ACTIVE_EVIDENCE,
  FIN016_BUNDLE_SCHEMA,
  FIN016_CANDIDATE_COMMIT,
  FIN016_CANDIDATE_TREE,
  FIN016_CI_RECEIPT_DIGEST,
  FIN016_CONTROL_SCHEMA,
  FIN016_CUTOVER_PHASES,
  FIN016_ENVIRONMENT_PATH,
  FIN016_HELD_CONTROL_COMMIT,
  FIN016_HELD_CONTROL_TREE,
  FIN016_INSTALLED_ARTIFACT_MANIFEST_SHA256,
  FIN016_INSTALLED_COMMIT,
  FIN016_INSTALLED_EPOCH,
  FIN016_INSTALLED_TREE,
  FIN016_LATEST_MIGRATION,
  FIN016_MIGRATION_COUNT,
  FIN016_ORIGIN_SEAL_SHA256,
  FIN016_PREDECESSOR_ENVIRONMENT_PATH,
  FIN016_RELEASE_ROOT,
  FIN016_STAGED_FILE_POLICY,
  FIN016_STAGING_PATH,
  FIN016_SUCCESSOR_INPUT_DIGEST,
  FIN016_WRAPPER_PATH,
  Fin016CopyReleaseFailure,
  createFin016CutoverPlan,
  createFin016HostedEnvironment,
  createFin016ProductionBundle,
  createFin016UserUnitSet,
  createFin016Wrapper,
  fin016BundleReceiptFileSha256,
  prepareFin016ProductionBundle,
  validateFin016BundleReceipt,
  validateFin016CutoverControl
} from "../fin016-copy-release.mjs";
import { materializeHistoricalCandidate } from "./historical-candidate-fixture.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const NOW = Date.parse("2026-09-01T17:05:00.000Z");
const PRODUCTION_CONTROL_COMMIT = "d".repeat(40);
const PRODUCTION_CONTROL_TREE = "e".repeat(40);
let candidateFixturePromise;
let hostedArtifactPromise;
let bundlePromise;

function ensureHostedArtifact() {
  candidateFixturePromise ??= materializeHistoricalCandidate({
    projectRoot,
    commitSha: FIN016_CANDIDATE_COMMIT,
    treeSha: FIN016_CANDIDATE_TREE,
    label: "fin016-copy-release-candidate"
  });
  hostedArtifactPromise ??= candidateFixturePromise.then(async (fixture) => {
    const moduleUrl = pathToFileURL(
      path.join(fixture.candidateRoot, "scripts/build-hosted.mjs")
    );
    const { buildHostedArtifact } = await import(moduleUrl.href);
    await buildHostedArtifact({
      root: fixture.candidateRoot,
      output: path.join(fixture.candidateRoot, "_hosted")
    });
    return fixture.candidateRoot;
  });
  return hostedArtifactPromise;
}

after(async () => {
  if (candidateFixturePromise) await (await candidateFixturePromise).cleanup();
});

function predecessorEnvironment(extra = []) {
  const values = new Map(
    FIN015_EXPECTED_ENVIRONMENT_NAMES.map((name) => [name, "fixture"])
  );
  for (const [name, value] of Object.entries({
    SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "held",
    SITESOURCERY_ALAKAZAM_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE: "held",
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT: "production",
    SITESOURCERY_DOWNLOAD_PAYMENT_MODE: "approved",
    SITESOURCERY_RESEND_WEBHOOK_MODE: "held",
    SITESOURCERY_STRIPE_LIVEMODE: "true",
    SITESOURCERY_STRIPE_MODE: "approved_live",
    SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "held",
    SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "held",
    SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "held",
    SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "held",
    SITESOURCERY_HOSTED_PRIVACY_V7_VERSION:
      "SS-HOSTED-PRIVACY-2026-08-31-V7",
    SITESOURCERY_HOSTED_PRIVACY_V7_SHA256:
      "084788116b8d59f2e75faedd7cfad5ea14f007782c2a84679287f0d064753b99",
    SITESOURCERY_HOSTED_PRIVACY_V7_URI:
      "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-31-V7/",
    SITESOURCERY_HOSTED_PRIVACY_V7_EFFECTIVE_AT:
      "2026-09-01T04:00:00.000Z",
    SITESOURCERY_HOSTED_PRIVACY_V7_BYTE_COUNT: "24139",
    SITESOURCERY_HOSTED_PRIVACY_V7_ARTIFACT_URI:
      "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-31-V7/",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_VERSION:
      "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_SHA256:
      "f09386d70465ccd1f491c69efefe20f8c89ca9c46d03a7ac9f58990317adfd19",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_EFFECTIVE_AT:
      "2026-09-01T04:00:00.000Z",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_BYTE_COUNT: "27358",
    SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_ARTIFACT_URI:
      "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/",
    SITESOURCERY_HOSTED_LEGAL_V7_AUTHORITY_SHA256:
      "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b",
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `/old/releases/${FIN016_INSTALLED_COMMIT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `/old/releases/${FIN016_INSTALLED_COMMIT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RELEASE_EPOCH_FILE: FIN016_ACTIVE_EVIDENCE.epoch,
    SITESOURCERY_RELEASE_EPOCH_SHA256: "1".repeat(64),
    SITESOURCERY_ORIGIN_SEAL_FILE: FIN016_ACTIVE_EVIDENCE.originSeal,
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: "2".repeat(64),
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      FIN016_ACTIVE_EVIDENCE.installedReadback,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256: "3".repeat(64)
  })) {
    values.set(name, value);
  }
  for (const line of extra) {
    const separator = line.indexOf("=");
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return [
    ...[...values.keys()].sort().map((name) => `${name}=${values.get(name)}`),
    ""
  ].join("\n");
}

function evidence() {
  return {
    epoch: { sha256: "4".repeat(64) },
    originSeal: { sha256: "5".repeat(64) },
    installedReadback: { sha256: "6".repeat(64) }
  };
}

function candidateGit(arguments_) {
  const selected = arguments_.join(" ");
  if (selected === "rev-parse HEAD") return FIN016_CANDIDATE_COMMIT;
  if (selected === "rev-parse HEAD^{tree}") return FIN016_CANDIDATE_TREE;
  if (selected === `rev-parse ${FIN016_CANDIDATE_COMMIT}^{tree}`) {
    return FIN016_CANDIDATE_TREE;
  }
  if (selected === `rev-parse ${FIN016_INSTALLED_COMMIT}^{tree}`) {
    return FIN016_INSTALLED_TREE;
  }
  if (selected.startsWith("rev-parse --git-path ")) {
    return "/private/tmp/sitesourcery-fin016-no-grafts";
  }
  if (
    selected.startsWith("status ") ||
    selected.startsWith("for-each-ref ") ||
    selected.startsWith("ls-files ") ||
    selected.startsWith("cat-file ") ||
    selected.startsWith("merge-base ")
  ) {
    return "";
  }
  throw new Error(`Unexpected candidate Git fixture call: ${selected}`);
}

function controlGit(arguments_) {
  const selected = arguments_.join(" ");
  if (selected === "rev-parse HEAD") return PRODUCTION_CONTROL_COMMIT;
  if (selected === "rev-parse HEAD^{tree}") return PRODUCTION_CONTROL_TREE;
  if (selected.startsWith("status ") || selected.startsWith("merge-base ")) {
    return "";
  }
  throw new Error(`Unexpected control Git fixture call: ${selected}`);
}

function getBundle() {
  bundlePromise ??= ensureHostedArtifact().then((candidateRoot) =>
    createFin016ProductionBundle({
      controlRoot: projectRoot,
      candidateRoot,
      predecessorEnvironmentText: predecessorEnvironment(),
      observedAt: "2026-09-01T16:45:00.000Z",
      productionControlCommitSha: PRODUCTION_CONTROL_COMMIT,
      productionControlTreeSha: PRODUCTION_CONTROL_TREE,
      candidateGitRunner: candidateGit,
      controlGitRunner: controlGit
    })
  );
  return bundlePromise;
}

test("FIN-016 preserves the exact 136-name production environment and changes only release bindings", () => {
  const before = parseFin010EnvironmentFile(
    predecessorEnvironment(),
    "predecessor fixture"
  );
  const result = createFin016HostedEnvironment({
    predecessorEnvironmentText: predecessorEnvironment(),
    evidence: evidence()
  });
  const afterValues = parseFin010EnvironmentFile(result.text, "successor fixture");
  assert.equal(result.nameCount, 136);
  assert.deepEqual([...afterValues.keys()].sort(), FIN015_EXPECTED_ENVIRONMENT_NAMES);
  const changed = [...afterValues.keys()].filter(
    (name) => before.get(name) !== afterValues.get(name)
  );
  assert.deepEqual(changed.sort(), [
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256",
    "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
    "SITESOURCERY_RECOVERY_TRANSPORT_MODULE",
    "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE",
    "SITESOURCERY_RELEASE_EPOCH_SHA256"
  ]);
  assert.equal(afterValues.get("SITESOURCERY_STRIPE_SECRET_KEY"), "fixture");
  assert.equal(afterValues.get("SITESOURCERY_TWILIO_VOICE_DIAL_MODE"), "held");
  assert.equal(
    afterValues.get("SITESOURCERY_REGISTRATION_TRANSPORT_MODULE"),
    `${FIN016_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  );
  assert.equal(result.secretDerivedDigestsRecorded, false);
});

test("FIN-016 rejects mode widening, Twilio secret staging, and Legal V7 drift", () => {
  for (const line of [
    "SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH=/etc/forbidden.json",
    "SITESOURCERY_ALAKAZAM_MODE=approved",
    "SITESOURCERY_HOSTED_PRIVACY_V7_BYTE_COUNT=1"
  ]) {
    assert.throws(
      () =>
        createFin016HostedEnvironment({
          predecessorEnvironmentText: predecessorEnvironment([line]),
          evidence: evidence()
        }),
      (error) => error instanceof Fin016CopyReleaseFailure
    );
  }
});

test("FIN-016 wrapper and units select only the plain-language candidate", () => {
  const units = createFin016UserUnitSet({ evidence: evidence() });
  const text = `${units["sitesourcery-production.service"]}\n${
    units["sitesourcery-production-static.service"]
  }`;
  assert.match(text, new RegExp(FIN016_CANDIDATE_COMMIT, "u"));
  assert.doesNotMatch(text, new RegExp(FIN016_INSTALLED_COMMIT, "u"));
  assert.match(text, /FIN-016 exact copy-only/u);
  assert.match(createFin016Wrapper(), new RegExp(FIN016_CANDIDATE_COMMIT, "u"));
});

test("FIN-016 composes one exact held copy-only bundle from the protected proof", async () => {
  const bundle = await getBundle();
  assert.equal(bundle.receipt.schema, FIN016_BUNDLE_SCHEMA);
  assert.equal(bundle.receipt.source.candidateCommitSha, FIN016_CANDIDATE_COMMIT);
  assert.equal(bundle.receipt.source.productionControlCommitSha, PRODUCTION_CONTROL_COMMIT);
  assert.equal(bundle.receipt.proof.successorInputDigest, FIN016_SUCCESSOR_INPUT_DIGEST);
  assert.equal(bundle.receipt.proof.ciFinalReceiptDigest, FIN016_CI_RECEIPT_DIGEST);
  assert.equal(bundle.receipt.proof.originSealSha256, FIN016_ORIGIN_SEAL_SHA256);
  assert.deepEqual(bundle.receipt.proof.migrationDelta, []);
  assert.equal(bundle.epoch.identity.migrationCount, 102);
  assert.equal(bundle.receipt.authority.bundlePreparationAuthorized, true);
  assert.equal(bundle.receipt.authority.releaseInstallationAuthorized, false);
  assert.equal(bundle.receipt.authority.databaseMutationAuthorized, false);
  assert.equal(validateFin016BundleReceipt(bundle.receipt).digest, bundle.receipt.digest);
});

test("FIN-016 writes exactly eight least-privilege staging files without secret-derived output", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ss-fin016-bundle-"));
  try {
    const environmentPath = path.join(temporary, "predecessor.env");
    const outputPath = path.join(temporary, "bundle");
    await writeFile(environmentPath, predecessorEnvironment(), { mode: 0o600 });
    const summary = await prepareFin016ProductionBundle({
      controlRoot: projectRoot,
      candidateRoot,
      predecessorEnvironmentPath: environmentPath,
      outputPath,
      observedAt: "2026-09-01T16:45:00.000Z",
      productionControlCommitSha: PRODUCTION_CONTROL_COMMIT,
      productionControlTreeSha: PRODUCTION_CONTROL_TREE,
      candidateGitRunner: candidateGit,
      controlGitRunner: controlGit
    });
    assert.equal(summary.filesWritten, 8);
    assert.equal(summary.databaseEffects, false);
    assert.equal(summary.installEffects, false);
    assert.equal(summary.providerEffects, false);
    assert.equal((await readdir(outputPath)).length, 8);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(outputPath, "hosted.env"))).mode & 0o777, 0o600);
    assert.doesNotMatch(canonicalJson(summary), /fixture/u);
    assert.match(await readFile(path.join(outputPath, "hosted.env"), "utf8"), /fixture/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function stagedFiles(bundle) {
  const fileBytes = new Map([
    ["final-release-epoch-v2.json", bundle.evidence.epoch.text],
    ["origin-seal.json", bundle.evidence.originSeal.text],
    ["origin-installed-readback.json", bundle.evidence.installedReadback.text],
    ["api-and-tenant.sh", bundle.wrapper],
    [
      "sitesourcery-production.service",
      bundle.units["sitesourcery-production.service"]
    ],
    [
      "sitesourcery-production-static.service",
      bundle.units["sitesourcery-production-static.service"]
    ],
    ["bundle-receipt.json", `${canonicalJson(bundle.receipt)}\n`]
  ]);
  return FIN016_STAGED_FILE_POLICY.map((policy) => ({
    ...policy,
    sha256:
      policy.digestPolicy === "byte_compare_only_secret_no_digest"
        ? null
        : sha256Bytes(fileBytes.get(policy.name))
  }));
}

function actionControl(bundle) {
  return {
    schema: FIN016_CONTROL_SCHEMA,
    state: "authorized_exact_fin016_copy_release",
    createdAt: "2026-09-01T17:00:00.000Z",
    expiresAt: "2026-09-01T17:30:00.000Z",
    source: {
      installedCommitSha: FIN016_INSTALLED_COMMIT,
      installedTreeSha: FIN016_INSTALLED_TREE,
      installedEpoch: FIN016_INSTALLED_EPOCH,
      candidateCommitSha: FIN016_CANDIDATE_COMMIT,
      candidateTreeSha: FIN016_CANDIDATE_TREE,
      heldControlCommitSha: FIN016_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN016_HELD_CONTROL_TREE,
      productionControlCommitSha: PRODUCTION_CONTROL_COMMIT,
      productionControlTreeSha: PRODUCTION_CONTROL_TREE,
      originSealSha256: FIN016_ORIGIN_SEAL_SHA256
    },
    owner: {
      instruction: "owner_approved_all_safe_fin016_copy_release",
      reviewedPlainLanguageChange: true,
      reviewedNoDatabaseChange: true,
      reviewedRollbackRetention: true
    },
    predecessor: {
      publicLive: true,
      publicReady: true,
      commitSha: FIN016_INSTALLED_COMMIT,
      treeSha: FIN016_INSTALLED_TREE,
      epoch: FIN016_INSTALLED_EPOCH,
      migrationCount: FIN016_MIGRATION_COUNT,
      latestMigration: FIN016_LATEST_MIGRATION,
      migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
      tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
      schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
      matrixSchema: "sitesourcery.capability-process-matrix/v2",
      capabilityCount: 20,
      processCount: 6,
      externalEffects: false,
      services: {
        runtime: "active",
        static: "active",
        origin: "active",
        tunnel: "active",
        databaseTunnel: "active",
        worker: "disabled"
      },
      timers: { monitor: "active", backup: "active" },
      installedArtifactManifestSha256:
        FIN016_INSTALLED_ARTIFACT_MANIFEST_SHA256,
      environmentPath: FIN016_PREDECESSOR_ENVIRONMENT_PATH,
      rollbackRetained: true
    },
    backup: {
      state: "success",
      completedAt: "2026-09-01T16:30:00.000Z",
      manifestSha256: "a".repeat(64),
      databaseCiphertextSha256: "b".repeat(64),
      appStateCiphertextSha256: "c".repeat(64),
      destinationFailureDomainId: "zen-sitesourcery-backup-01",
      plaintextRetained: false,
      cleanRecoveryVerified: true,
      rollbackPairReady: true,
      dellZenHashesMatch: true,
      providerEgressHeld: true
    },
    bundle: {
      receiptDigest: bundle.receipt.digest,
      receiptFileSha256: fin016BundleReceiptFileSha256(bundle.receipt),
      stagingPath: FIN016_STAGING_PATH,
      fileCount: 8,
      files: stagedFiles(bundle),
      secretValuesDisclosed: false,
      secretDerivedDigestsRecorded: false,
      activeSelectionChanged: false
    },
    successor: {
      databaseName: "sitesourcery_production",
      migrationCount: FIN016_MIGRATION_COUNT,
      latestMigration: FIN016_LATEST_MIGRATION,
      migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
      migrationDelta: [],
      tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
      schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
      releaseRoot: FIN016_RELEASE_ROOT,
      environmentPath: FIN016_ENVIRONMENT_PATH,
      wrapperPath: FIN016_WRAPPER_PATH,
      legalVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
      workerEnabled: false
    },
    authority: {
      stageInstallAuthorized: true,
      serviceSwitchAuthorized: true,
      publicRuntimeCutoverAuthorized: true,
      databaseMutationAuthorized: false,
      providerMutationAuthorized: false,
      paymentOrCheckoutAuthorized: false,
      customerMutationAuthorized: false,
      dnsMutationAuthorized: false,
      legalAcceptanceAuthorized: false,
      publicationEffectAuthorized: false,
      workerActivationAuthorized: false,
      retirementAuthorized: false
    }
  };
}

test("FIN-016 creates a copy-only cutover plan with exact rollback and no database phase", async () => {
  const bundle = await getBundle();
  const control = actionControl(bundle);
  const validated = validateFin016CutoverControl(control, {
    now: NOW,
    bundleReceipt: bundle.receipt
  });
  assert.equal(validated.control.authority.publicRuntimeCutoverAuthorized, true);
  const plan = createFin016CutoverPlan({
    control,
    bundleReceipt: bundle.receipt,
    now: NOW
  });
  assert.deepEqual(plan.phases, FIN016_CUTOVER_PHASES);
  assert.equal(plan.rollback.databaseRestoreRequired, false);
  assert.equal(plan.rollback.predecessorRetained, true);
  assert.equal(plan.implementation.effectAdapterPresent, false);
  const text = canonicalJson(plan);
  assert.doesNotMatch(text, /apply.*migration|psql|providerMutationAuthorized":true/iu);
});

test("FIN-016 refuses database/provider widening, migration drift, stale proof, and secret-derived staging digests", async () => {
  const bundle = await getBundle();
  const variants = [
    (control) => {
      control.authority.databaseMutationAuthorized = true;
    },
    (control) => {
      control.authority.providerMutationAuthorized = true;
    },
    (control) => {
      control.successor.migrationDelta = [{ name: "forbidden.sql" }];
    },
    (control) => {
      control.bundle.files.find((entry) => entry.name === "hosted.env").sha256 =
        "f".repeat(64);
    },
    (control) => {
      control.backup.completedAt = "2026-09-01T15:00:00.000Z";
    }
  ];
  for (const mutate of variants) {
    const control = structuredClone(actionControl(bundle));
    mutate(control);
    assert.throws(
      () =>
        validateFin016CutoverControl(control, {
          now: NOW,
          bundleReceipt: bundle.receipt
        }),
      (error) => error instanceof Fin016CopyReleaseFailure
    );
  }
});
