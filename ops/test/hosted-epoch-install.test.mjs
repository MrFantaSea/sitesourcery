import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  HOSTED_EPOCH_INSTALL_EFFECT_HOLDS,
  HOSTED_EPOCH_INSTALL_JSON_SCHEMA_ID,
  HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA,
  createHostedEpochInstallDryRunReceipt,
  hostedEpochInstallReceiptDigest,
  validateHostedEpochInstallDryRunReceipt
} from "../hosted-epoch-install-runtime.mjs";
import {
  composeHostedEpochInstallDryRun,
  hostedEpochInstallDryRunFromFile
} from "../hosted-epoch-install.mjs";
import {
  collectOriginRepositorySnapshot
} from "../origin-seal-repository.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  ORIGIN_UNION_BASE_COMMIT,
  createOriginReleaseInput,
  originInstalledReadbackDigest
} from "../origin-seal-runtime.mjs";
import {
  SHAPE_EPOCH_ID,
  releaseEpochBindingSha256
} from "../release-epoch.mjs";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const layout = Object.freeze({
  artifactRoot:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted",
  migrationRoot: "server/data-plane/supabase/migrations",
  legalConstantsPath:
    "ops/releases/joint-legal-v4-2026-08-09T214211Z/joint-legal-v4-release-constants.json"
});
const OBSERVED_AT = "2026-08-11T18:00:00.000Z";
const RUN_ID = "hosted-epoch-install-fixture";

function clone(value) {
  return structuredClone(value);
}

async function git(...arguments_) {
  const result = await execFile("git", arguments_, {
    cwd: projectRoot,
    encoding: "utf8"
  });
  return result.stdout.trim();
}

const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});
const sourceCommitSha = await git("rev-parse", "HEAD");
const sourceTreeSha = await git("rev-parse", "HEAD^{tree}");
const rollback = {
  predecessorCommitSha: ORIGIN_UNION_BASE_COMMIT,
  predecessorTreeSha: await git(
    "rev-parse",
    `${ORIGIN_UNION_BASE_COMMIT}^{tree}`
  ),
  predecessorArtifactManifestSha256: "e".repeat(64)
};

function epoch(overrides = {}) {
  const value = {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "shape-epoch-hosted-install-fixture",
    supersedes: {
      epochId: SHAPE_EPOCH_ID,
      bindingSha256: releaseEpochBindingSha256()
    },
    basis: {
      unionBaseCommitSha: ORIGIN_UNION_BASE_COMMIT
    },
    layout: clone(layout),
    source: {
      commitSha: sourceCommitSha,
      treeSha: sourceTreeSha
    },
    artifact: {
      manifestSha256: snapshot.artifact.sha256
    },
    units: {
      manifestSha256: snapshot.units.sha256
    },
    environmentSchema: {
      manifestSha256: snapshot.environmentSchema.sha256,
      classificationSha256:
        snapshot.environmentSchema.classificationSha256
    },
    worker: {
      manifestSha256: snapshot.worker.sha256,
      contractSha256: snapshot.worker.contractSha256
    },
    migration: {
      count: snapshot.migration.count,
      latest: snapshot.migration.latest,
      manifestSha256: snapshot.migration.sha256
    },
    legal: {
      authorityDigest: snapshot.legal.authorityDigest,
      privacyVersion: snapshot.legal.privacyVersion,
      privacySha256: snapshot.legal.privacySha256,
      privacyByteCount: snapshot.legal.privacyByteCount,
      websiteTermsVersion: snapshot.legal.websiteTermsVersion,
      websiteTermsSha256: snapshot.legal.websiteTermsSha256,
      websiteTermsByteCount: snapshot.legal.websiteTermsByteCount,
      manifestSha256: snapshot.legal.sha256
    },
    ingress: {
      manifestSha256: snapshot.ingress.sha256
    },
    rollback: clone(rollback),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
  return Object.assign(value, overrides);
}

function input(selectedEpoch = epoch()) {
  return createOriginReleaseInput({
    releaseId: "hosted-epoch-install-fixture",
    epoch: selectedEpoch
  });
}

async function composed(selectedInput = input()) {
  return composeHostedEpochInstallDryRun({
    projectRoot,
    releaseInput: selectedInput,
    runId: RUN_ID,
    observedAt: OBSERVED_AT
  });
}

test("composes the real repository verifier and held origin contracts into one dry-run receipt", async () => {
  const selected = await composed();
  const receipt = selected.receipt;
  assert.equal(receipt.schema, HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA);
  assert.equal(receipt.state, "accepted_held");
  assert.equal(receipt.classification, "local_dry_run_only");
  assert.deepEqual(receipt.identity, {
    sourceCommitSha,
    sourceTreeSha,
    artifactManifestSha256: snapshot.artifact.sha256,
    unitManifestSha256: snapshot.units.sha256,
    environmentSchemaManifestSha256: snapshot.environmentSchema.sha256,
    environmentClassificationSha256:
      snapshot.environmentSchema.classificationSha256,
    workerManifestSha256: snapshot.worker.sha256,
    workerContractSha256: snapshot.worker.contractSha256,
    migrationCount: snapshot.migration.count,
    latestMigration: snapshot.migration.latest,
    migrationManifestSha256: snapshot.migration.sha256,
    legalAuthorityDigest: snapshot.legal.authorityDigest,
    legalManifestSha256: snapshot.legal.sha256,
    ingressManifestSha256: snapshot.ingress.sha256
  });
  assert.deepEqual(receipt.rollback, rollback);
  assert.equal(
    receipt.evidence.originSealSha256,
    selected.originSeal.sealSha256
  );
  assert.equal(
    receipt.evidence.installPlanSha256,
    selected.installPlan.planSha256
  );
  assert.equal(
    receipt.evidence.projectedInstalledReadbackDigest,
    selected.projectedInstalledReadback.digest
  );
  assert.equal(selected.readbackReceipt.state, "verified");
  assert.equal(
    receipt.evidence.rollbackPlanSha256,
    selected.rollbackPlan.planSha256
  );
  assert.deepEqual(receipt.authority, ORIGIN_HELD_AUTHORITY);
  assert.deepEqual(receipt.effects, HOSTED_EPOCH_INSTALL_EFFECT_HOLDS);
  assert.deepEqual(receipt.result, {
    dryRunAccepted: true,
    commandsExecuted: false,
    installed: false,
    installationAuthorized: false,
    productionReady: false
  });
  assert.deepEqual(
    validateHostedEpochInstallDryRunReceipt(receipt),
    receipt
  );
  assert.equal(Object.isFrozen(receipt), true);
});

test("fails closed on source, artifact, migration, and rollback authority drift", async () => {
  const sourceDrift = epoch({
    source: {
      commitSha: sourceCommitSha,
      treeSha: "0".repeat(40)
    }
  });
  await assert.rejects(composed(input(sourceDrift)), /Git identity/u);

  const artifactDrift = epoch({
    artifact: { manifestSha256: "1".repeat(64) }
  });
  await assert.rejects(
    composed(input(artifactDrift)),
    /artifact manifest drifted/u
  );

  const migrationDrift = epoch({
    migration: {
      count: snapshot.migration.count + 1,
      latest: snapshot.migration.latest,
      manifestSha256: snapshot.migration.sha256
    }
  });
  await assert.rejects(
    composed(input(migrationDrift)),
    /migration authority drifted/u
  );

  const rollbackDrift = epoch({
    rollback: {
      ...clone(rollback),
      predecessorTreeSha: "2".repeat(40)
    }
  });
  await assert.rejects(composed(input(rollbackDrift)), /Git identity/u);
});

test("rejects plan, projected-readback, receipt, and effect tampering", async () => {
  const selectedInput = input();
  const selected = await composed(selectedInput);
  const arguments_ = {
    runId: RUN_ID,
    observedAt: OBSERVED_AT,
    releaseInput: selectedInput,
    originSeal: selected.originSeal,
    installPlan: selected.installPlan,
    projectedInstalledReadback: selected.projectedInstalledReadback,
    readbackReceipt: selected.readbackReceipt,
    rollbackPlan: selected.rollbackPlan
  };

  const installPlan = clone(selected.installPlan);
  installPlan.commands[0].argv[1] = "/tmp/not-the-release";
  assert.throws(
    () => createHostedEpochInstallDryRunReceipt({
      ...arguments_,
      installPlan
    }),
    /install plan drifted/u
  );

  const projectedInstalledReadback = clone(
    selected.projectedInstalledReadback
  );
  projectedInstalledReadback.identity.artifactManifestSha256 =
    "3".repeat(64);
  projectedInstalledReadback.digest = originInstalledReadbackDigest(
    projectedInstalledReadback
  );
  assert.throws(
    () => createHostedEpochInstallDryRunReceipt({
      ...arguments_,
      projectedInstalledReadback
    }),
    /installed readback drifted/u
  );

  const rollbackPlan = clone(selected.rollbackPlan);
  rollbackPlan.predecessor.predecessorArtifactManifestSha256 =
    "4".repeat(64);
  assert.throws(
    () => createHostedEpochInstallDryRunReceipt({
      ...arguments_,
      rollbackPlan
    }),
    /rollback plan drifted/u
  );

  for (const mutate of [
    (receipt) => { receipt.effects.payment = "enabled"; },
    (receipt) => { receipt.result.installed = true; },
    (receipt) => { receipt.verification.installedReadback = "observed"; },
    (receipt) => { receipt.unreviewed = true; }
  ]) {
    const receipt = clone(selected.receipt);
    mutate(receipt);
    receipt.digest = hostedEpochInstallReceiptDigest(receipt);
    assert.throws(
      () => validateHostedEpochInstallDryRunReceipt(receipt),
      /Hosted epoch install/u
    );
  }
});

test("writes one immutable receipt and keeps schema and runbook fail closed", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-hosted-epoch-install-")
  );
  try {
    const inputPath = path.join(fixture, "origin-release-input.json");
    const outputPath = path.join(fixture, "dry-run-receipt.json");
    await writeFile(inputPath, `${JSON.stringify(input())}\n`, "utf8");
    const selected = await hostedEpochInstallDryRunFromFile({
      inputPath,
      outputPath,
      runId: RUN_ID,
      observedAt: OBSERVED_AT,
      projectRoot
    });
    assert.equal(selected.written.path, outputPath);
    assert.deepEqual(
      JSON.parse(await readFile(outputPath, "utf8")),
      selected.receipt
    );
    await assert.rejects(
      hostedEpochInstallDryRunFromFile({
        inputPath,
        outputPath,
        runId: RUN_ID,
        observedAt: OBSERVED_AT,
        projectRoot
      }),
      /EEXIST/u
    );

    const schema = JSON.parse(
      await readFile(
        new URL(
          "../hosted-epoch-install-dry-run-receipt.schema.json",
          import.meta.url
        ),
        "utf8"
      )
    );
    assert.equal(schema.$id, HOSTED_EPOCH_INSTALL_JSON_SCHEMA_ID);
    assert.equal(schema.additionalProperties, false);
    assert.equal(
      schema.properties.schema.const,
      HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA
    );
    assert.equal(schema.properties.result.const.installed, false);
    assert.equal(
      schema.properties.verification.const.installedReadback,
      "expected_projection_verified_not_observed"
    );
    assert.equal(schema.properties.effects.const.dns, "held");

    const runbook = await readFile(
      new URL(
        "../SITESOURCERY-HOSTED-EPOCH-INSTALL-HELD.md",
        import.meta.url
      ),
      "utf8"
    );
    for (const required of [
      "local dry run only",
      "does not install",
      "does not execute",
      "actual installed readback",
      "Final Release Epoch V2",
      "customer, payment, mail, provider, publication, DNS, and deployment effects remain held"
    ]) {
      assert.match(runbook, new RegExp(required, "u"));
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
