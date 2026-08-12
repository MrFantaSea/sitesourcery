import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FINAL_RELEASE_EPOCH_V2_SCHEMA,
  finalReleaseEpochV2Digest,
  validateFinalReleaseEpochV2
} from "../final-release-epoch-v2.mjs";
import {
  createIndependentProbeResult,
  releaseIdentityFromEpoch,
  runIndependentMonitor
} from "../independent-monitor-runtime.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  compareOriginInstalledReadback,
  createOriginInstalledReadback,
  createOriginReleaseInput,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "../origin-seal-runtime.mjs";
import {
  PUBLIC_EDGE_EXTERNAL_BLOCKERS,
  PUBLIC_EDGE_MONITOR_MAXIMUM_AGE_MS,
  PublicEdgeCurrentReleaseBindingFailure,
  RETAINED_DNS_PREFLIGHT_RECEIPT_SHA256,
  createHeldPublicEdgeCurrentReleaseBinding,
  publicEdgeCurrentReleaseBindingDigest,
  validateHeldPublicEdgeCurrentReleaseBinding
} from "../public-edge-current-release-binding.mjs";
import {
  SHAPE_EPOCH_BINDING
} from "../release-epoch.mjs";
import {
  createRollbackPagesFallback,
  createRollbackRuntimeTopology
} from "../rollback-rehearsal.mjs";
import {
  collectOriginRepositorySnapshot
} from "../origin-seal-repository.mjs";

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
const NOW = "2026-08-11T23:00:00.000Z";
const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});
const retainedDnsPreflightReceipt = JSON.parse(
  await readFile(
    path.join(
      projectRoot,
      "ops/releases/dns-cutover-preflight-2026-08-10T234906Z.json"
    ),
    "utf8"
  )
);

function clone(value) {
  return structuredClone(value);
}

function digest(character) {
  return character.repeat(64);
}

function successorInput() {
  return {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "public-edge-current-fixture",
    supersedes: {
      epochId: "shape-epoch-20260810",
      bindingSha256:
        "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6"
    },
    basis: {
      unionBaseCommitSha:
        "5458d9641fd42c9a1b436c6af6bb6600b60bce74"
    },
    layout: clone(layout),
    source: {
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40)
    },
    artifact: { manifestSha256: snapshot.artifact.sha256 },
    units: { manifestSha256: snapshot.units.sha256 },
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
    ingress: { manifestSha256: snapshot.ingress.sha256 },
    rollback: {
      predecessorCommitSha: "c".repeat(40),
      predecessorTreeSha: "d".repeat(40),
      predecessorArtifactManifestSha256: digest("e")
    },
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
}

function installedFixture() {
  const input = createOriginReleaseInput({
    releaseId: "public-edge-current-fixture",
    epoch: successorInput()
  });
  const seal = createOriginSeal({
    releaseInput: input,
    observed: {
      source: clone(input.epoch.source),
      ...clone(snapshot)
    }
  });
  const readback = createOriginInstalledReadback({
    seal,
    observedAt: NOW,
    identity: expectedOriginInstalledIdentity(seal),
    worker: expectedOriginInstalledWorker(seal),
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  });
  const readbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  const value = {
    schema: FINAL_RELEASE_EPOCH_V2_SCHEMA,
    epochId: input.epoch.epochId,
    state: "verified_held",
    bindingSha256: digest("1"),
    evidence: {
      originReleaseInputDigest: input.digest,
      originSuccessorBindingSha256: input.epoch.bindingSha256,
      ciFinalReceiptDigest: digest("2"),
      originSealSha256: seal.sealSha256,
      originInstalledReadbackDigest: readback.digest,
      originInstalledReadbackReceiptSha256:
        readbackReceipt.receiptSha256
    },
    identity: expectedOriginInstalledIdentity(seal),
    legalV4Pages: {
      fileCount: 7,
      manifestSha256: digest("3")
    },
    privacyArtifact: {
      version: seal.legal.privacyVersion,
      sha256: seal.legal.privacySha256,
      byteCount: seal.legal.privacyByteCount
    },
    rollback: clone(seal.rollback),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
  const epoch = validateFinalReleaseEpochV2({
    ...value,
    digest: finalReleaseEpochV2Digest(value)
  });
  const topology = createRollbackRuntimeTopology({
    epoch,
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    workerContract: expectedOriginInstalledWorker(seal)
  });
  return { epoch, seal, readback, topology };
}

function healthyProbes() {
  return Object.fromEntries(
    ["apex", "content", "tls", "tunnel"].map((name) => [
      name,
      async () => createIndependentProbeResult(name, {
        ok: true,
        evidence: { verified: true, contract: name }
      })
    ])
  );
}

async function monitorFor(epoch, observedAt = NOW) {
  return runIndependentMonitor({
    probes: healthyProbes(),
    releaseIdentity: releaseIdentityFromEpoch(epoch),
    now: () => new Date(observedAt)
  });
}

function pagesFallback(commitSha =
  SHAPE_EPOCH_BINDING.source.requiredProductionPredecessorCommitSha) {
  return createRollbackPagesFallback({
    deploymentId: "1109469264",
    commitSha,
    artifactManifestSha256: digest("4"),
    routeManifestSha256: digest("5"),
    evidenceSha256: digest("6")
  });
}

async function fixtureArgs(overrides = {}) {
  const installed = installedFixture();
  return {
    successorEpoch: installed.epoch,
    originSeal: installed.seal,
    installedReadback: installed.readback,
    successorTopology: installed.topology,
    retainedDnsPreflightReceipt,
    independentMonitorReport: await monitorFor(installed.epoch),
    pagesFallback: pagesFallback(),
    now: () => new Date(NOW),
    ...overrides
  };
}

test("reuses the exact retained DNS preflight bytes without redefining its contract", async () => {
  const bytes = await readFile(
    path.join(
      projectRoot,
      "ops/releases/dns-cutover-preflight-2026-08-10T234906Z.json"
    )
  );
  assert.equal(
    createHash("sha256")
      .update(bytes)
      .digest("hex"),
    RETAINED_DNS_PREFLIGHT_RECEIPT_SHA256
  );
});

test("binds exact current epoch origin monitor and Pages predecessor while remaining held", async () => {
  const binding = createHeldPublicEdgeCurrentReleaseBinding(
    await fixtureArgs()
  );
  assert.equal(binding.state, "bound_held");
  assert.equal(binding.publicEdgeReady, false);
  assert.equal(binding.externalConvergenceRequired, true);
  assert.deepEqual(binding.externalBlockers, PUBLIC_EDGE_EXTERNAL_BLOCKERS);
  assert.equal(
    binding.pagesFallback.commitSha,
    SHAPE_EPOCH_BINDING.source
      .requiredProductionPredecessorCommitSha
  );
  assert.equal(binding.authority.allowsDnsMutation, false);
  assert.equal(binding.authority.allowsProviderEffects, false);
  assert.equal(binding.authority.allowsDeployment, false);
  assert.equal(Object.isFrozen(binding), true);
  assert.deepEqual(
    validateHeldPublicEdgeCurrentReleaseBinding(binding),
    binding
  );
});

test("rejects a monitor report for a different origin release", async () => {
  const args = await fixtureArgs();
  const wrongIdentity = {
    ...releaseIdentityFromEpoch(args.successorEpoch),
    publicArtifactCommitSha: "f".repeat(40)
  };
  args.independentMonitorReport = await runIndependentMonitor({
    probes: healthyProbes(),
    releaseIdentity: wrongIdentity,
    now: () => new Date(NOW)
  });
  assert.throws(
    () => createHeldPublicEdgeCurrentReleaseBinding(args),
    (error) =>
      error instanceof PublicEdgeCurrentReleaseBindingFailure &&
      error.code === "PUBLIC_EDGE_ORIGIN_MISMATCH"
  );
});

test("rejects stale current-release monitor evidence", async () => {
  const args = await fixtureArgs();
  args.independentMonitorReport = await monitorFor(
    args.successorEpoch,
    new Date(
      Date.parse(NOW) - PUBLIC_EDGE_MONITOR_MAXIMUM_AGE_MS - 1
    ).toISOString()
  );
  assert.throws(
    () => createHeldPublicEdgeCurrentReleaseBinding(args),
    (error) =>
      error instanceof PublicEdgeCurrentReleaseBindingFailure &&
      error.code === "PUBLIC_EDGE_STALE_READBACK"
  );
});

test("rejects a rogue Pages fallback or changed retained DNS evidence", async () => {
  const pagesArgs = await fixtureArgs({
    pagesFallback: pagesFallback("f".repeat(40))
  });
  assert.throws(
    () => createHeldPublicEdgeCurrentReleaseBinding(pagesArgs),
    (error) =>
      error instanceof PublicEdgeCurrentReleaseBindingFailure &&
      error.code === "PUBLIC_EDGE_PAGES_MISMATCH"
  );
  const dnsArgs = await fixtureArgs();
  dnsArgs.retainedDnsPreflightReceipt = clone(
    retainedDnsPreflightReceipt
  );
  dnsArgs.retainedDnsPreflightReceipt.mutationAuthorized = true;
  assert.throws(
    () => createHeldPublicEdgeCurrentReleaseBinding(dnsArgs),
    (error) =>
      error instanceof PublicEdgeCurrentReleaseBindingFailure &&
      error.code === "PUBLIC_EDGE_DNS_EVIDENCE_MISMATCH"
  );
});

test("binding mutations cannot claim readiness or lift held authority", async () => {
  const binding = createHeldPublicEdgeCurrentReleaseBinding(
    await fixtureArgs()
  );
  for (const mutate of [
    (value) => { value.publicEdgeReady = true; },
    (value) => { value.authority.allowsDnsMutation = true; },
    (value) => { value.externalBlockers.pop(); }
  ]) {
    const changed = clone(binding);
    mutate(changed);
    changed.digest = publicEdgeCurrentReleaseBindingDigest(changed);
    assert.throws(
      () => validateHeldPublicEdgeCurrentReleaseBinding(changed),
      (error) =>
        error instanceof PublicEdgeCurrentReleaseBindingFailure
    );
  }
});

test("binding source adds no DNS TLS tunnel Pages or process adapter", async () => {
  const source = await readFile(
    path.join(
      projectRoot,
      "ops/public-edge-current-release-binding.mjs"
    ),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /node:(?:child_process|dns|fs|http|https|net|tls)|\bfetch\s*\(|\bspawn\s*\(|\bexec(?:File)?\s*\(/u
  );
  assert.doesNotMatch(
    source,
    /\b(?:dig|curl|ssh|systemctl|cloudflared|createdb|dropdb|psql)\b/u
  );
});
