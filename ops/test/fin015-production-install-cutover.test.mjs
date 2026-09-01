import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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
  FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
  FIN015_SUCCESSOR_INPUT_DIGEST,
  FIN015_SUCCESSOR_INPUT_SHA256,
  FIN015_SUCCESSOR_MIGRATION_COUNT,
  FIN015_SUCCESSOR_SCHEMA_SHA256,
  FIN015_SUCCESSOR_TABLE_COUNT,
  FIN015_UPGRADE_RECEIPT_PATH
} from "../fin015-protected-production-upgrade.mjs";
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
} from "../fin015-production-runtime.mjs";
import {
  FIN015_INSTALL_CUTOVER_CONTROL_SCHEMA,
  FIN015_INSTALL_CUTOVER_PHASES,
  FIN015_PREDECESSOR_ENVIRONMENT_PATH,
  FIN015_RUNTIME_BUNDLE_STAGING_PATH,
  FIN015_RUNTIME_CONTROL_COMMIT,
  FIN015_RUNTIME_CONTROL_TREE,
  FIN015_STAGED_FILE_POLICY,
  Fin015InstallCutoverFailure,
  createFin015InstallCutoverPlan,
  fin015BundleReceiptDigest,
  fin015BundleReceiptFileSha256,
  fin015InstallCutoverPlanDigest,
  validateFin015BundleReceipt,
  validateFin015InstallCutoverControl
} from "../fin015-production-install-cutover.mjs";

const NOW = Date.parse("2026-09-01T12:05:00.000Z");

function bundleReceipt() {
  const receipt = {
    schema: FIN015_BUNDLE_SCHEMA,
    state: "prepared_held_no_install",
    observedAt: "2026-09-01T11:45:00.000Z",
    source: {
      installedCommitSha: FIN015_INSTALLED_COMMIT,
      installedTreeSha: FIN015_INSTALLED_TREE,
      candidateCommitSha: FIN015_CANDIDATE_COMMIT,
      candidateTreeSha: FIN015_CANDIDATE_TREE,
      heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN015_HELD_CONTROL_TREE,
      productionControlCommitSha: FIN015_PRODUCTION_CONTROL_COMMIT,
      productionControlTreeSha: FIN015_PRODUCTION_CONTROL_TREE
    },
    proof: {
      successorInputFileSha256: FIN015_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN015_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptFileSha256: FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
      ciFinalReceiptDigest: FIN015_CI_FINAL_RECEIPT_DIGEST,
      ciRunId: 33462367254,
      ciRunAttempt: 1,
      originSealSha256: FIN015_ORIGIN_SEAL_SHA256
    },
    evidence: Object.fromEntries(
      ["epoch", "originSeal", "installedReadback"].map((name, index) => [
        name,
        {
          byteCount: 1000 + index,
          sha256: String(index + 1).repeat(64),
          retainedPath: FIN015_RETAINED_EVIDENCE[name],
          activePath: FIN015_ACTIVE_EVIDENCE[name]
        }
      ])
    ),
    runtime: {
      releaseRoot: FIN015_RELEASE_ROOT,
      node: FIN015_NODE,
      environmentPath: FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN015_INSTALLED_WRAPPER_PATH,
      environmentNameCount: FIN015_EXPECTED_ENVIRONMENT_NAMES.length,
      legal: {
        privacyVersion: "SS-HOSTED-PRIVACY-2026-08-31-V7",
        websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
        authorityDigest:
          "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
      },
      providers: {
        registrationMail: "production_existing_approved",
        recoveryMail: "production_existing_approved",
        resendWebhook: "held",
        stripe: "approved_live_download_only_existing_authority",
        twilio: "held_no_registry_or_secret_loaded",
        domains: "held",
        alakazam: "held",
        publication: "held",
        workers: "retained_disabled_held"
      }
    },
    authority: {
      bundlePreparationAuthorized: true,
      releaseInstallationAuthorized: false,
      databaseMigrationAuthorized: false,
      serviceSwitchAuthorized: false,
      publicRuntimeCutoverAuthorized: false,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
      dnsEffectsAuthorized: false,
      retirementAuthorized: false
    }
  };
  return { ...receipt, digest: fin015BundleReceiptDigest(receipt) };
}

function stagedFiles(receipt) {
  const evidence = new Map([
    ["final-release-epoch-v2.json", receipt.evidence.epoch.sha256],
    ["origin-seal.json", receipt.evidence.originSeal.sha256],
    [
      "origin-installed-readback.json",
      receipt.evidence.installedReadback.sha256
    ],
    ["bundle-receipt.json", fin015BundleReceiptFileSha256(receipt)]
  ]);
  return FIN015_STAGED_FILE_POLICY.map((policy, index) => ({
    ...policy,
    sha256:
      policy.digestPolicy === "byte_compare_only_secret_no_digest"
        ? null
        : evidence.get(policy.name) ?? (index + 1).toString(16).repeat(64)
  }));
}

function control(receipt = bundleReceipt()) {
  return {
    schema: FIN015_INSTALL_CUTOVER_CONTROL_SCHEMA,
    state: "authorized_exact_fin015_install_cutover",
    createdAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-09-01T12:30:00.000Z",
    source: {
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
    },
    owner: {
      instruction: "owner_exact_fin015_install_and_cutover",
      reviewedPublicChange: true,
      reviewedDatabaseMigration: true,
      reviewedExistingProviderReadiness: true
    },
    predecessor: {
      publicLive: true,
      publicReady: true,
      commitSha: FIN015_INSTALLED_COMMIT,
      treeSha: FIN015_INSTALLED_TREE,
      epoch: FIN015_INSTALLED_EPOCH,
      migrationCount: FIN015_PREDECESSOR_MIGRATION_COUNT,
      latestMigration:
        "202608240145_stripe_checkout_fragment_authority.sql",
      tableCount: FIN015_PREDECESSOR_TABLE_COUNT,
      schemaSha256: FIN015_PREDECESSOR_SCHEMA_SHA256,
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
        FIN015_INSTALLED_ARTIFACT_MANIFEST_SHA256,
      rollbackArtifactManifestSha256:
        FIN015_ROLLBACK_ARTIFACT_MANIFEST_SHA256,
      environmentPath: FIN015_PREDECESSOR_ENVIRONMENT_PATH,
      rollbackRetained: true
    },
    backup: {
      state: "success",
      completedAt: "2026-09-01T11:30:00.000Z",
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
      receiptDigest: receipt.digest,
      receiptFileSha256: fin015BundleReceiptFileSha256(receipt),
      stagingPath: FIN015_RUNTIME_BUNDLE_STAGING_PATH,
      fileCount: FIN015_STAGED_FILE_POLICY.length,
      files: stagedFiles(receipt),
      secretValuesDisclosed: false,
      secretDerivedDigestsRecorded: false,
      activeSelectionChanged: false
    },
    successor: {
      databaseName: "sitesourcery_production",
      migrationCount: FIN015_SUCCESSOR_MIGRATION_COUNT,
      migrationDelta: structuredClone(FIN015_MIGRATIONS),
      tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
      schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
      releaseRoot: FIN015_RELEASE_ROOT,
      environmentPath: FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN015_INSTALLED_WRAPPER_PATH,
      upgradeReceiptPath: FIN015_UPGRADE_RECEIPT_PATH,
      legalVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
      workerEnabled: false
    },
    authority: {
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
    }
  };
}

function clone(value) {
  return structuredClone(value);
}

test("FIN-015 validates the exact held bundle and action-time install/cutover control", () => {
  const receipt = bundleReceipt();
  assert.equal(validateFin015BundleReceipt(receipt).digest, receipt.digest);
  const result = validateFin015InstallCutoverControl(control(receipt), {
    now: NOW,
    bundleReceipt: receipt
  });
  assert.equal(result.control.source.runtimeControlCommitSha, FIN015_RUNTIME_CONTROL_COMMIT);
  assert.equal(result.bundleReceipt.runtime.environmentNameCount, 136);
  assert.equal(result.control.bundle.files[3].name, "hosted.env");
  assert.equal(result.control.bundle.files[3].sha256, null);
});

test("FIN-015 rejects bundle tamper and any provider or payment widening", () => {
  for (const mutate of [
    (receipt) => {
      receipt.runtime.providers.twilio = "staging";
    },
    (receipt) => {
      receipt.authority.providerEffectsAuthorized = true;
    },
    (receipt) => {
      receipt.runtime.environmentNameCount = 137;
    }
  ]) {
    const receipt = clone(bundleReceipt());
    mutate(receipt);
    receipt.digest = fin015BundleReceiptDigest(receipt);
    assert.throws(
      () => validateFin015BundleReceipt(receipt),
      (error) => error instanceof Fin015InstallCutoverFailure
    );
  }
  const receipt = bundleReceipt();
  const selected = control(receipt);
  selected.authority.paymentOrCheckoutAuthorized = true;
  assert.throws(
    () => validateFin015InstallCutoverControl(selected, {
      now: NOW,
      bundleReceipt: receipt
    }),
    /exact FIN-015 install\/cutover authority/u
  );
});

test("FIN-015 rejects stale controls, bundles, and paired backups", () => {
  const receipt = bundleReceipt();
  for (const [selectedNow, mutate] of [
    [Date.parse("2026-09-01T12:30:00.000Z"), () => {}],
    [NOW, (selected) => {
      selected.backup.completedAt = "2026-09-01T10:59:59.999Z";
    }]
  ]) {
    const selected = control(receipt);
    mutate(selected);
    assert.throws(
      () => validateFin015InstallCutoverControl(selected, {
        now: selectedNow,
        bundleReceipt: receipt
      }),
      (error) => error instanceof Fin015InstallCutoverFailure
    );
  }
  const staleReceipt = bundleReceipt();
  staleReceipt.observedAt = "2026-09-01T10:59:59.999Z";
  staleReceipt.digest = fin015BundleReceiptDigest(staleReceipt);
  const selected = control(staleReceipt);
  assert.throws(
    () => validateFin015InstallCutoverControl(selected, {
      now: NOW,
      bundleReceipt: staleReceipt
    }),
    /not a fresh pre-control bundle/u
  );
});

test("FIN-015 rejects predecessor, backup, file, and worker drift", () => {
  const receipt = bundleReceipt();
  for (const mutate of [
    (selected) => {
      selected.predecessor.migrationCount = 99;
    },
    (selected) => {
      selected.predecessor.services.worker = "active";
    },
    (selected) => {
      selected.backup.dellZenHashesMatch = false;
    },
    (selected) => {
      selected.bundle.files[3].sha256 = "d".repeat(64);
    },
    (selected) => {
      selected.successor.workerEnabled = true;
    }
  ]) {
    const selected = control(receipt);
    mutate(selected);
    assert.throws(
      () => validateFin015InstallCutoverControl(selected, {
        now: NOW,
        bundleReceipt: receipt
      }),
      (error) => error instanceof Fin015InstallCutoverFailure
    );
  }
});

test("FIN-015 emits one deterministic ordered plan with the post-migration restore fence", () => {
  const receipt = bundleReceipt();
  const plan = createFin015InstallCutoverPlan({
    control: control(receipt),
    bundleReceipt: receipt,
    now: NOW
  });
  assert.deepEqual(
    plan.phases.map((phase) => phase.name),
    FIN015_INSTALL_CUTOVER_PHASES.map((phase) => phase.name)
  );
  assert.equal(plan.state, "authorized_exact_plan_no_effect_adapter");
  assert.equal(plan.implementation.effectAdapterPresent, false);
  assert.equal(plan.implementation.commandsExecuted, false);
  assert.equal(plan.rollback.pairedEncryptedRestoreRequired, true);
  assert.match(plan.rollback.afterFirstMigration, /never_restart_predecessor/u);
  assert.equal(plan.digest, fin015InstallCutoverPlanDigest(plan));
});

test("FIN-015 control source has no effect-bearing adapter or secret digest path", async () => {
  const source = await readFile(
    new URL("../fin015-production-install-cutover.mjs", import.meta.url),
    "utf8"
  );
  for (const forbidden of [
    "node:fs",
    "node:child_process",
    "node:net",
    "node:http",
    "node:https",
    "systemctl",
    "ssh ",
    "pg.Pool",
    "fetch("
  ]) assert.doesNotMatch(source, new RegExp(forbidden.replace("(", "\\("), "u"));
  assert.match(source, /byte_compare_only_secret_no_digest/u);
  assert.match(source, /secretDerivedDigestsRecorded:\s*false/u);
});

test("FIN-015 runbook preserves the exact action-time and effect boundary", async () => {
  const runbook = await readFile(
    new URL(
      "../releases/fin015-production-install-cutover-control/FIN-015-PRODUCTION-INSTALL-CUTOVER-CONTROL.md",
      import.meta.url
    ),
    "utf8"
  );
  for (const phrase of [
    "no effect adapter",
    "valid for at most 30 minutes",
    "paired Dell-to-Zen encrypted backup",
    "never recorded",
    "may not restart",
    "owner's exact\\s+action-time install/cutover instruction",
    "retirement remain separately unauthorized"
  ]) assert.match(runbook, new RegExp(phrase, "u"));
});
