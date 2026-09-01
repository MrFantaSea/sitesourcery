import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  FIN015_CANDIDATE_COMMIT,
  FIN015_CANDIDATE_TREE,
  FIN015_CI_FINAL_RECEIPT_DIGEST,
  FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
  FIN015_HELD_CONTROL_COMMIT,
  FIN015_HELD_CONTROL_TREE,
  FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
  FIN015_INSTALLED_COMMIT,
  FIN015_INSTALLED_EPOCH,
  FIN015_INSTALLED_TREE,
  FIN015_MIGRATIONS,
  FIN015_PREDECESSOR_MIGRATION_COUNT,
  FIN015_PREDECESSOR_SCHEMA_SHA256,
  FIN015_PREDECESSOR_TABLE_COUNT,
  FIN015_PRODUCTION_DATABASE,
  FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
  FIN015_SUCCESSOR_INPUT_DIGEST,
  FIN015_SUCCESSOR_INPUT_SHA256,
  FIN015_SUCCESSOR_MIGRATION_COUNT,
  FIN015_SUCCESSOR_SCHEMA_SHA256,
  FIN015_SUCCESSOR_TABLE_COUNT,
  FIN015_UPGRADE_RECEIPT_PATH
} from "./fin015-protected-production-upgrade.mjs";
import {
  FIN015_ACTIVE_EVIDENCE,
  FIN015_BUNDLE_SCHEMA,
  FIN015_EXPECTED_ENVIRONMENT_NAMES,
  FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
  FIN015_INSTALLED_WRAPPER_PATH,
  FIN015_NODE,
  FIN015_ORIGIN_SEAL_SHA256,
  FIN015_PRODUCTION_CONTROL_COMMIT,
  FIN015_PRODUCTION_CONTROL_TREE,
  FIN015_RELEASE_ROOT,
  FIN015_RETAINED_EVIDENCE
} from "./fin015-production-runtime.mjs";

export const FIN015_INSTALL_CUTOVER_CONTROL_SCHEMA =
  "sitesourcery.fin015-production-install-cutover-control/v1";
export const FIN015_INSTALL_CUTOVER_PLAN_SCHEMA =
  "sitesourcery.fin015-production-install-cutover-plan/v1";
export const FIN015_RUNTIME_CONTROL_COMMIT =
  "84c4c5a231949acdbe55e5d7ad6e1b751dd45a75";
export const FIN015_RUNTIME_CONTROL_TREE =
  "c215f062a8df287d52e20ffd34bdcb71fcd2f405";
export const FIN015_RUNTIME_BUNDLE_STAGING_PATH =
  `/home/simtech/sitesourcery-production/staging/fin015-${FIN015_CANDIDATE_COMMIT}-held`;
export const FIN015_PREDECESSOR_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN015_INSTALLED_COMMIT}`;

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_WINDOW_MS = 30 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const BUNDLE_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const LATEST_PREDECESSOR_MIGRATION =
  "202608240145_stripe_checkout_fragment_authority.sql";

export const FIN015_STAGED_FILE_POLICY = Object.freeze([
  Object.freeze({
    name: "final-release-epoch-v2.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "origin-seal.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "origin-installed-readback.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "hosted.env",
    mode: "0600",
    digestPolicy: "byte_compare_only_secret_no_digest"
  }),
  Object.freeze({
    name: "api-and-tenant.sh",
    mode: "0500",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "sitesourcery-production.service",
    mode: "0400",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "sitesourcery-production-static.service",
    mode: "0400",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "bundle-receipt.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  })
]);

export const FIN015_INSTALL_CUTOVER_PHASES = Object.freeze([
  Object.freeze({
    name: "preflight",
    steps: Object.freeze([
      "verify_protected_git_and_bundle_authority",
      "verify_installed_live_ready_database_and_service_truth",
      "verify_fresh_paired_encrypted_zen_backup",
      "verify_existing_download_and_mail_authority_with_all_new_effects_held"
    ])
  }),
  Object.freeze({
    name: "stage",
    steps: Object.freeze([
      "install_candidate_release_into_new_immutable_root",
      "install_candidate_specific_environment_wrapper_units_and_retained_evidence",
      "byte_compare_secret_environment_without_recording_a_digest",
      "verify_every_nonsecret_staged_byte_and_keep_active_selection_unchanged"
    ])
  }),
  Object.freeze({
    name: "quiesce",
    steps: Object.freeze([
      "acquire_single_production_operation_lock",
      "set_backup_quiesce_fences_and_pause_monitor_and_backup_timer",
      "stop_tunnel_origin_static_and_runtime_in_reviewed_order",
      "prove_zero_database_writers_and_recheck_backup_authority"
    ])
  }),
  Object.freeze({
    name: "database",
    steps: Object.freeze([
      "apply_only_exact_migrations_146_through_149_under_advisory_lock",
      "prove_299_table_successor_and_preserve_all_predecessor_rows",
      "write_immutable_upgrade_receipt_before_any_runtime_start"
    ])
  }),
  Object.freeze({
    name: "select_candidate",
    steps: Object.freeze([
      "atomically_install_active_evidence_and_reviewed_user_units",
      "reload_user_service_manager_without_enabling_worker",
      "start_candidate_runtime_and_static_then_origin_and_tunnel",
      "keep_twilio_domains_alakazam_publication_workers_and_new_payments_held"
    ])
  }),
  Object.freeze({
    name: "prove_and_resume",
    steps: Object.freeze([
      "prove_local_origin_public_live_ready_and_exact_candidate_identity",
      "prove_102_migrations_legal_v7_matrix_v2_and_external_effects_false",
      "prove_exact_public_routes_redirects_assets_and_browser_authority",
      "clear_quiesce_fences_resume_monitor_and_backup_timer_and_run_one_monitor_cycle",
      "retain_predecessor_release_environment_units_evidence_and_paired_restore"
    ])
  })
]);

export class Fin015InstallCutoverFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin015InstallCutoverFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin015InstallCutoverFailure(code, message);
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
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    fail(
      "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) {
    fail(
      "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
      `${label} does not match the exact FIN-015 install/cutover authority.`
    );
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
      `${label} must be a lowercase SHA-256 digest.`
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
      "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
      `${label} must be an exact ISO instant.`
    );
  }
  return selected.valueOf();
}

function exactMap(actual, expected, label) {
  exact(canonicalJson(actual), canonicalJson(expected), label);
}

function bundleReceiptPayload(receipt) {
  return {
    schema: receipt.schema,
    state: receipt.state,
    observedAt: receipt.observedAt,
    source: receipt.source,
    proof: receipt.proof,
    evidence: receipt.evidence,
    runtime: receipt.runtime,
    authority: receipt.authority
  };
}

export function fin015BundleReceiptDigest(receipt) {
  return sha256Bytes(`${canonicalJson(bundleReceiptPayload(receipt))}\n`);
}

export function fin015BundleReceiptFileSha256(receipt) {
  return sha256Bytes(`${canonicalJson(receipt)}\n`);
}

export function validateFin015BundleReceipt(receipt) {
  exactObject(receipt, [
    "schema",
    "state",
    "observedAt",
    "source",
    "proof",
    "evidence",
    "runtime",
    "authority",
    "digest"
  ], "FIN-015 bundle receipt");
  exact(receipt.schema, FIN015_BUNDLE_SCHEMA, "Bundle schema");
  exact(receipt.state, "prepared_held_no_install", "Bundle state");
  instant(receipt.observedAt, "Bundle observedAt");

  exactObject(receipt.source, [
    "installedCommitSha",
    "installedTreeSha",
    "candidateCommitSha",
    "candidateTreeSha",
    "heldControlCommitSha",
    "heldControlTreeSha",
    "productionControlCommitSha",
    "productionControlTreeSha"
  ], "Bundle source");
  for (const [field, expected] of Object.entries({
    installedCommitSha: FIN015_INSTALLED_COMMIT,
    installedTreeSha: FIN015_INSTALLED_TREE,
    candidateCommitSha: FIN015_CANDIDATE_COMMIT,
    candidateTreeSha: FIN015_CANDIDATE_TREE,
    heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
    heldControlTreeSha: FIN015_HELD_CONTROL_TREE,
    productionControlCommitSha: FIN015_PRODUCTION_CONTROL_COMMIT,
    productionControlTreeSha: FIN015_PRODUCTION_CONTROL_TREE
  })) exact(receipt.source[field], expected, `Bundle source ${field}`);

  exactObject(receipt.proof, [
    "successorInputFileSha256",
    "successorInputDigest",
    "ciFinalReceiptFileSha256",
    "ciFinalReceiptDigest",
    "ciRunId",
    "ciRunAttempt",
    "originSealSha256"
  ], "Bundle proof");
  for (const [field, expected] of Object.entries({
    successorInputFileSha256: FIN015_SUCCESSOR_INPUT_SHA256,
    successorInputDigest: FIN015_SUCCESSOR_INPUT_DIGEST,
    ciFinalReceiptFileSha256: FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
    ciFinalReceiptDigest: FIN015_CI_FINAL_RECEIPT_DIGEST,
    ciRunId: "33462367254",
    ciRunAttempt: "1",
    originSealSha256: FIN015_ORIGIN_SEAL_SHA256
  })) exact(receipt.proof[field], expected, `Bundle proof ${field}`);

  exactObject(
    receipt.evidence,
    ["epoch", "originSeal", "installedReadback"],
    "Bundle evidence"
  );
  for (const name of ["epoch", "originSeal", "installedReadback"]) {
    const entry = exactObject(receipt.evidence[name], [
      "byteCount",
      "sha256",
      "retainedPath",
      "activePath"
    ], `Bundle evidence ${name}`);
    if (!Number.isSafeInteger(entry.byteCount) || entry.byteCount < 2) {
      fail(
        "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
        `Bundle evidence ${name} byte count is invalid.`
      );
    }
    digest(entry.sha256, `Bundle evidence ${name}`);
    exact(entry.retainedPath, FIN015_RETAINED_EVIDENCE[name], `${name} retained path`);
    exact(entry.activePath, FIN015_ACTIVE_EVIDENCE[name], `${name} active path`);
  }

  exactObject(receipt.runtime, [
    "releaseRoot",
    "node",
    "environmentPath",
    "wrapperPath",
    "environmentNameCount",
    "legal",
    "providers"
  ], "Bundle runtime");
  for (const [field, expected] of Object.entries({
    releaseRoot: FIN015_RELEASE_ROOT,
    node: FIN015_NODE,
    environmentPath: FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
    wrapperPath: FIN015_INSTALLED_WRAPPER_PATH,
    environmentNameCount: FIN015_EXPECTED_ENVIRONMENT_NAMES.length
  })) exact(receipt.runtime[field], expected, `Bundle runtime ${field}`);
  exactMap(receipt.runtime.legal, {
    privacyVersion: "SS-HOSTED-PRIVACY-2026-08-31-V7",
    websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
    authorityDigest:
      "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
  }, "Bundle Legal V7 authority");
  exactMap(receipt.runtime.providers, {
    registrationMail: "production_existing_approved",
    recoveryMail: "production_existing_approved",
    resendWebhook: "held",
    stripe: "approved_live_download_only_existing_authority",
    twilio: "held_no_registry_or_secret_loaded",
    domains: "held",
    alakazam: "held",
    publication: "held",
    workers: "retained_disabled_held"
  }, "Bundle provider boundary");
  exactMap(receipt.authority, {
    bundlePreparationAuthorized: true,
    releaseInstallationAuthorized: false,
    databaseMigrationAuthorized: false,
    serviceSwitchAuthorized: false,
    publicRuntimeCutoverAuthorized: false,
    providerEffectsAuthorized: false,
    paymentEffectsAuthorized: false,
    dnsEffectsAuthorized: false,
    retirementAuthorized: false
  }, "Bundle held authority");
  exact(receipt.digest, fin015BundleReceiptDigest(receipt), "Bundle receipt digest");
  return freeze(structuredClone(receipt));
}

function validateStagedFiles(files, receipt) {
  if (!Array.isArray(files) || files.length !== FIN015_STAGED_FILE_POLICY.length) {
    fail(
      "FIN015_INSTALL_CUTOVER_CONTROL_INVALID",
      "The staged bundle must contain exactly eight reviewed files."
    );
  }
  const evidenceDigests = new Map([
    ["final-release-epoch-v2.json", receipt.evidence.epoch.sha256],
    ["origin-seal.json", receipt.evidence.originSeal.sha256],
    [
      "origin-installed-readback.json",
      receipt.evidence.installedReadback.sha256
    ],
    ["bundle-receipt.json", fin015BundleReceiptFileSha256(receipt)]
  ]);
  for (let index = 0; index < FIN015_STAGED_FILE_POLICY.length; index += 1) {
    const expected = FIN015_STAGED_FILE_POLICY[index];
    const entry = exactObject(files[index], [
      "name",
      "mode",
      "digestPolicy",
      "sha256"
    ], `Staged file ${index + 1}`);
    exactMap(
      {
        name: entry.name,
        mode: entry.mode,
        digestPolicy: entry.digestPolicy
      },
      expected,
      `Staged file ${index + 1} policy`
    );
    if (entry.digestPolicy === "byte_compare_only_secret_no_digest") {
      exact(entry.sha256, null, "Secret environment digest absence");
    } else {
      digest(entry.sha256, `Staged file ${entry.name}`);
    }
    if (evidenceDigests.has(entry.name)) {
      exact(
        entry.sha256,
        evidenceDigests.get(entry.name),
        `Staged evidence ${entry.name}`
      );
    }
  }
}

export function validateFin015InstallCutoverControl(
  control,
  { now = Date.now(), bundleReceipt } = {}
) {
  const bundle = validateFin015BundleReceipt(bundleReceipt);
  exactObject(control, [
    "schema",
    "state",
    "createdAt",
    "expiresAt",
    "source",
    "owner",
    "predecessor",
    "backup",
    "bundle",
    "successor",
    "authority"
  ], "FIN-015 install/cutover control");
  exact(control.schema, FIN015_INSTALL_CUTOVER_CONTROL_SCHEMA, "Control schema");
  exact(
    control.state,
    "authorized_exact_fin015_install_cutover",
    "Control state"
  );
  const createdAt = instant(control.createdAt, "Control createdAt");
  const expiresAt = instant(control.expiresAt, "Control expiresAt");
  if (
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > CONTROL_WINDOW_MS
  ) {
    fail(
      "FIN015_INSTALL_CUTOVER_CONTROL_EXPIRED",
      "The install/cutover control is expired or outside its 30-minute window."
    );
  }
  const bundleObservedAt = instant(bundle.observedAt, "Bundle observedAt");
  if (
    bundleObservedAt > createdAt ||
    createdAt - bundleObservedAt > BUNDLE_MAXIMUM_AGE_MS
  ) {
    fail(
      "FIN015_INSTALL_CUTOVER_BUNDLE_STALE",
      "The prepared runtime bundle is not a fresh pre-control bundle."
    );
  }

  exactObject(control.source, [
    "installedCommitSha",
    "installedTreeSha",
    "installedEpoch",
    "candidateCommitSha",
    "candidateTreeSha",
    "heldControlCommitSha",
    "heldControlTreeSha",
    "upgradeControlCommitSha",
    "upgradeControlTreeSha",
    "runtimeControlCommitSha",
    "runtimeControlTreeSha",
    "originSealSha256"
  ], "Control source");
  for (const [field, expected] of Object.entries({
    installedCommitSha: FIN015_INSTALLED_COMMIT,
    installedTreeSha: FIN015_INSTALLED_TREE,
    installedEpoch: FIN015_INSTALLED_EPOCH,
    candidateCommitSha: FIN015_CANDIDATE_COMMIT,
    candidateTreeSha: FIN015_CANDIDATE_TREE,
    heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
    heldControlTreeSha: FIN015_HELD_CONTROL_TREE,
    upgradeControlCommitSha: FIN015_PRODUCTION_CONTROL_COMMIT,
    upgradeControlTreeSha: FIN015_PRODUCTION_CONTROL_TREE,
    runtimeControlCommitSha: FIN015_RUNTIME_CONTROL_COMMIT,
    runtimeControlTreeSha: FIN015_RUNTIME_CONTROL_TREE,
    originSealSha256: FIN015_ORIGIN_SEAL_SHA256
  })) exact(control.source[field], expected, `Control source ${field}`);

  exactMap(control.owner, {
    instruction: "owner_exact_fin015_install_and_cutover",
    reviewedPublicChange: true,
    reviewedDatabaseMigration: true,
    reviewedExistingProviderReadiness: true
  }, "Owner action-time instruction");

  exactObject(control.predecessor, [
    "publicLive",
    "publicReady",
    "commitSha",
    "treeSha",
    "epoch",
    "migrationCount",
    "latestMigration",
    "tableCount",
    "schemaSha256",
    "matrixSchema",
    "capabilityCount",
    "processCount",
    "externalEffects",
    "services",
    "timers",
    "installedArtifactManifestSha256",
    "rollbackArtifactManifestSha256",
    "environmentPath",
    "rollbackRetained"
  ], "Control predecessor");
  for (const [field, expected] of Object.entries({
    publicLive: true,
    publicReady: true,
    commitSha: FIN015_INSTALLED_COMMIT,
    treeSha: FIN015_INSTALLED_TREE,
    epoch: FIN015_INSTALLED_EPOCH,
    migrationCount: FIN015_PREDECESSOR_MIGRATION_COUNT,
    latestMigration: LATEST_PREDECESSOR_MIGRATION,
    tableCount: FIN015_PREDECESSOR_TABLE_COUNT,
    schemaSha256: FIN015_PREDECESSOR_SCHEMA_SHA256,
    matrixSchema: "sitesourcery.capability-process-matrix/v2",
    capabilityCount: 20,
    processCount: 6,
    externalEffects: false,
    installedArtifactManifestSha256:
      FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
    rollbackArtifactManifestSha256:
      FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
    environmentPath: FIN015_PREDECESSOR_ENVIRONMENT_PATH,
    rollbackRetained: true
  })) exact(control.predecessor[field], expected, `Predecessor ${field}`);
  exactMap(control.predecessor.services, {
    runtime: "active",
    static: "active",
    origin: "active",
    tunnel: "active",
    databaseTunnel: "active",
    worker: "disabled"
  }, "Predecessor services");
  exactMap(control.predecessor.timers, {
    monitor: "active",
    backup: "active"
  }, "Predecessor timers");

  exactObject(control.backup, [
    "state",
    "completedAt",
    "manifestSha256",
    "databaseCiphertextSha256",
    "appStateCiphertextSha256",
    "destinationFailureDomainId",
    "plaintextRetained",
    "cleanRecoveryVerified",
    "rollbackPairReady",
    "dellZenHashesMatch",
    "providerEgressHeld"
  ], "Control backup");
  exact(control.backup.state, "success", "Backup state");
  const completedAt = instant(control.backup.completedAt, "Backup completedAt");
  if (completedAt > createdAt || createdAt - completedAt > BACKUP_MAXIMUM_AGE_MS) {
    fail(
      "FIN015_INSTALL_CUTOVER_BACKUP_STALE",
      "The paired encrypted Zen backup is not a fresh pre-control success."
    );
  }
  for (const field of [
    "manifestSha256",
    "databaseCiphertextSha256",
    "appStateCiphertextSha256"
  ]) digest(control.backup[field], `Backup ${field}`);
  exact(
    control.backup.destinationFailureDomainId,
    "zen-sitesourcery-backup-01",
    "Backup destination"
  );
  exact(control.backup.plaintextRetained, false, "Backup plaintext retention");
  for (const field of [
    "cleanRecoveryVerified",
    "rollbackPairReady",
    "dellZenHashesMatch",
    "providerEgressHeld"
  ]) exact(control.backup[field], true, `Backup ${field}`);

  exactObject(control.bundle, [
    "receiptDigest",
    "receiptFileSha256",
    "stagingPath",
    "fileCount",
    "files",
    "secretValuesDisclosed",
    "secretDerivedDigestsRecorded",
    "activeSelectionChanged"
  ], "Control bundle");
  exact(control.bundle.receiptDigest, bundle.digest, "Bundle receipt digest");
  exact(
    control.bundle.receiptFileSha256,
    fin015BundleReceiptFileSha256(bundle),
    "Bundle receipt file digest"
  );
  exact(control.bundle.stagingPath, FIN015_RUNTIME_BUNDLE_STAGING_PATH, "Bundle staging path");
  exact(control.bundle.fileCount, FIN015_STAGED_FILE_POLICY.length, "Bundle file count");
  validateStagedFiles(control.bundle.files, bundle);
  exact(control.bundle.secretValuesDisclosed, false, "Bundle secret disclosure");
  exact(
    control.bundle.secretDerivedDigestsRecorded,
    false,
    "Bundle secret-derived digests"
  );
  exact(control.bundle.activeSelectionChanged, false, "Bundle active selection");

  exactObject(control.successor, [
    "databaseName",
    "migrationCount",
    "migrationDelta",
    "tableCount",
    "schemaSha256",
    "releaseRoot",
    "environmentPath",
    "wrapperPath",
    "upgradeReceiptPath",
    "legalVersion",
    "workerEnabled"
  ], "Control successor");
  for (const [field, expected] of Object.entries({
    databaseName: FIN015_PRODUCTION_DATABASE,
    migrationCount: FIN015_SUCCESSOR_MIGRATION_COUNT,
    tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
    schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
    releaseRoot: FIN015_RELEASE_ROOT,
    environmentPath: FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
    wrapperPath: FIN015_INSTALLED_WRAPPER_PATH,
    upgradeReceiptPath: FIN015_UPGRADE_RECEIPT_PATH,
    legalVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
    workerEnabled: false
  })) exact(control.successor[field], expected, `Successor ${field}`);
  exactMap(control.successor.migrationDelta, FIN015_MIGRATIONS, "Successor migration delta");

  exactMap(control.authority, {
    stageInstallAuthorized: true,
    databaseUpgradeAuthorized: true,
    serviceSwitchAuthorized: true,
    publicRuntimeCutoverAuthorized: true,
    existingProviderReadinessAuthorized: true,
    providerMutationAuthorized: false,
    paymentOrCheckoutAuthorized: false,
    customerMutationAuthorized: false,
    dnsMutationAuthorized: false,
    legalAcceptanceAuthorized: false,
    publicationEffectAuthorized: false,
    workerActivationAuthorized: false,
    retirementAuthorized: false
  }, "Control authority");
  return freeze({
    control: structuredClone(control),
    bundleReceipt: structuredClone(bundle)
  });
}

function planPayload(plan) {
  return {
    schema: plan.schema,
    state: plan.state,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    source: plan.source,
    controlDigest: plan.controlDigest,
    bundleReceiptDigest: plan.bundleReceiptDigest,
    phases: plan.phases,
    rollback: plan.rollback,
    authority: plan.authority,
    implementation: plan.implementation
  };
}

export function fin015InstallCutoverPlanDigest(plan) {
  return sha256Bytes(`${canonicalJson(planPayload(plan))}\n`);
}

export function createFin015InstallCutoverPlan({
  control,
  bundleReceipt,
  now = Date.now()
}) {
  const validated = validateFin015InstallCutoverControl(control, {
    now,
    bundleReceipt
  });
  const payload = {
    schema: FIN015_INSTALL_CUTOVER_PLAN_SCHEMA,
    state: "authorized_exact_plan_no_effect_adapter",
    createdAt: validated.control.createdAt,
    expiresAt: validated.control.expiresAt,
    source: structuredClone(validated.control.source),
    controlDigest: sha256Bytes(`${canonicalJson(validated.control)}\n`),
    bundleReceiptDigest: validated.bundleReceipt.digest,
    phases: structuredClone(FIN015_INSTALL_CUTOVER_PHASES),
    rollback: {
      beforeFirstMigration:
        "restore_retained_active_evidence_units_and_predecessor_services_without_database_restore",
      afterFirstMigration:
        "never_restart_predecessor_until_paired_database_and_app_restore_is_verified",
      successorRepair:
        "prefer_exact_successor_repair_while_database_is_102_migrations",
      predecessorRetained: true,
      pairedEncryptedRestoreRequired: true,
      retirementAuthorized: false
    },
    authority: structuredClone(validated.control.authority),
    implementation: {
      effectAdapterPresent: false,
      commandsExecuted: false,
      filesystemEffects: false,
      databaseEffects: false,
      serviceEffects: false,
      publicEffects: false,
      providerEffects: false,
      secretValuesDisclosed: false,
      secretDerivedDigestsRecorded: false
    }
  };
  return freeze({
    ...payload,
    digest: fin015InstallCutoverPlanDigest(payload)
  });
}
