import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CI_RELEASE_BROWSER_VERSION,
  CI_RELEASE_BROWSER_WIDTHS,
  ciReleaseDatabaseName,
  ciReleaseDatabaseNameSha256,
  createCiReleaseFinalReceipt,
  createCiReleaseStepReceipt,
  createCiReleaseSuccessorInput
} from "../ci-release-proof-runtime.mjs";
import {
  FINAL_RELEASE_EPOCH_V2_JSON_SCHEMA_ID,
  FINAL_RELEASE_EPOCH_V2_SCHEMA,
  createHeldFinalReleaseEpochV2,
  finalReleaseEpochV2Digest,
  readFinalReleaseEpochV2File,
  readInstalledFinalReleaseEpochV2,
  releaseIdentityFromFinalEpochV2,
  validateInstalledFinalReleaseEpochV2Chain,
  validateFinalReleaseEpochV2
} from "../final-release-epoch-v2.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  createOriginInstalledReadback,
  createOriginReleaseInput,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "../origin-seal-runtime.mjs";
import {
  collectOriginRepositorySnapshot
} from "../origin-seal-repository.mjs";
import {
  releaseEvidenceFromEpoch,
  releaseIdentityFromEpoch
} from "../independent-monitor-runtime.mjs";
import {
  independentMonitorConfiguration
} from "../independent-monitor.mjs";
import {
  sha256Bytes
} from "../immutable-evidence.mjs";

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
const SOURCE_COMMIT = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);
const PREDECESSOR_COMMIT = "c".repeat(40);
const PREDECESSOR_TREE = "d".repeat(40);
const PREDECESSOR_ARTIFACT = "e".repeat(64);
const OBSERVED_AT = "2026-08-10T23:00:00.000Z";
const LEGAL_PAGES_COUNT = 7;
const LEGAL_PAGES_MANIFEST = "f".repeat(64);

const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});

function clone(value) {
  return structuredClone(value);
}

function epochFromSnapshot({
  sourceCommitSha = SOURCE_COMMIT,
  sourceTreeSha = SOURCE_TREE
} = {}) {
  return {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "final-epoch-v2-fixture",
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
      commitSha: sourceCommitSha,
      treeSha: sourceTreeSha
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
      predecessorCommitSha: PREDECESSOR_COMMIT,
      predecessorTreeSha: PREDECESSOR_TREE,
      predecessorArtifactManifestSha256: PREDECESSOR_ARTIFACT
    },
    authority: clone(ORIGIN_HELD_AUTHORITY)
  };
}

function originInput(options = {}) {
  return createOriginReleaseInput({
    releaseId: "final-epoch-v2-fixture",
    epoch: epochFromSnapshot(options)
  });
}

function migrationInventory(input) {
  return {
    count: snapshot.migration.count,
    latest: snapshot.migration.latest,
    files: snapshot.migration.files.map((entry) => ({
      name: entry.path.split("/").at(-1),
      byteCount: entry.byteCount,
      sha256: entry.sha256
    })),
    manifestSha256: input.epoch.migration.manifestSha256
  };
}

function successorInput({
  origin = originInput(),
  legalManifestSha256 = LEGAL_PAGES_MANIFEST
} = {}) {
  return createCiReleaseSuccessorInput({
    originReleaseInput: origin,
    migrationInventory: migrationInventory(origin),
    legalV4Pages: {
      fileCount: LEGAL_PAGES_COUNT,
      manifestSha256: legalManifestSha256
    }
  });
}

function context(input) {
  return {
    candidateSha:
      input.originReleaseInput.epoch.source.commitSha,
    workflowSha: "1".repeat(40),
    successorInputDigest: input.digest,
    runId: "482731",
    runAttempt: "1"
  };
}

function receipts(input) {
  const selectedContext = context(input);
  const common = {
    context: selectedContext,
    observedAt: OBSERVED_AT
  };
  const databaseNameSha256 = ciReleaseDatabaseNameSha256(
    ciReleaseDatabaseName(selectedContext)
  );
  return [
    createCiReleaseStepReceipt({
      ...common,
      step: "browser",
      details: {
        routeCount: 3,
        viewCount: 9,
        widths: [...CI_RELEASE_BROWSER_WIDTHS],
        browserVersion: CI_RELEASE_BROWSER_VERSION,
        artifactManifestSha256:
          input.legalV4Pages.manifestSha256
      }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "cleanup",
      details: { databaseNameSha256, databaseAbsent: true }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "full-npm",
      details: { command: "npm test" }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "legal-v4",
      details: {
        fileCount: input.legalV4Pages.fileCount,
        manifestSha256: input.legalV4Pages.manifestSha256
      }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "ops",
      details: { command: "npm run check:ops" }
    }),
    createCiReleaseStepReceipt({
      ...common,
      step: "postgres",
      details: {
        databaseNameSha256,
        postgresMajor: 16,
        migrationCount: input.migrationInventory.count,
        migrationManifestSha256:
          input.migrationInventory.manifestSha256
      }
    })
  ];
}

function ciFinalReceipt(input) {
  return createCiReleaseFinalReceipt({
    successorInput: input,
    context: context(input),
    receipts: receipts(input)
  });
}

function seal(origin = originInput()) {
  return createOriginSeal({
    releaseInput: origin,
    observed: {
      source: clone(origin.epoch.source),
      ...clone(snapshot)
    }
  });
}

function readback(selectedSeal, identity = null) {
  return createOriginInstalledReadback({
    seal: selectedSeal,
    observedAt: OBSERVED_AT,
    identity:
      identity ?? expectedOriginInstalledIdentity(selectedSeal),
    worker: expectedOriginInstalledWorker(selectedSeal),
    listeners: clone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: clone(ORIGIN_HELD_AUTHORITY)
  });
}

function chain() {
  const origin = originInput();
  const input = successorInput({ origin });
  const selectedSeal = seal(origin);
  const selectedReadback = readback(selectedSeal);
  return {
    origin,
    input,
    selectedSeal,
    selectedReadback,
    ciReceipt: ciFinalReceipt(input)
  };
}

function finalEpoch(selected = chain()) {
  return createHeldFinalReleaseEpochV2({
    successorInput: selected.input,
    ciFinalReceipt: selected.ciReceipt,
    originSeal: selected.selectedSeal,
    installedReadback: selected.selectedReadback
  });
}

test("constructs one exact final v2 receipt from existing held authorities", () => {
  const selected = chain();
  const epoch = finalEpoch(selected);
  assert.equal(epoch.schema, FINAL_RELEASE_EPOCH_V2_SCHEMA);
  assert.equal(epoch.state, "verified_held");
  assert.equal(epoch.bindingSha256, selected.input.digest);
  assert.deepEqual(
    epoch.identity,
    expectedOriginInstalledIdentity(selected.selectedSeal)
  );
  assert.deepEqual(
    epoch.legalV4Pages,
    selected.input.legalV4Pages
  );
  assert.deepEqual(epoch.privacyArtifact, {
    version: selected.selectedSeal.legal.privacyVersion,
    sha256: selected.selectedSeal.legal.privacySha256,
    byteCount: selected.selectedSeal.legal.privacyByteCount
  });
  assert.deepEqual(epoch.authority, ORIGIN_HELD_AUTHORITY);
  assert.equal(Object.isFrozen(epoch), true);
  assert.equal(Object.isFrozen(epoch.identity), true);
  assert.deepEqual(validateFinalReleaseEpochV2(epoch), epoch);

  const hosted = releaseIdentityFromFinalEpochV2(epoch);
  assert.deepEqual(hosted, {
    schema: "sitesourcery.hosted-release-identity/v2",
    state: "verified_held",
    epochId: epoch.epochId,
    bindingSha256: epoch.bindingSha256,
    candidateCommitSha: SOURCE_COMMIT,
    candidateTreeSha: SOURCE_TREE,
    migrationCount: snapshot.migration.count,
    latestMigration: snapshot.migration.latest
  });
  assert.deepEqual(releaseIdentityFromEpoch(epoch), {
    schema: "sitesourcery.independent-release-identity/v1",
    epochId: epoch.epochId,
    bindingSha256: epoch.bindingSha256,
    publicArtifactCommitSha: SOURCE_COMMIT
  });
  assert.deepEqual(releaseEvidenceFromEpoch(epoch).privacyArtifact, {
    version: selected.selectedSeal.legal.privacyVersion,
    sha256: selected.selectedSeal.legal.privacySha256,
    byteCount: selected.selectedSeal.legal.privacyByteCount
  });
  const monitor = independentMonitorConfiguration({
    SITESOURCERY_INDEPENDENT_APEX_URL:
      "https://sitesourcery.example/",
    SITESOURCERY_INDEPENDENT_CONTENT_URL:
      `https://sitesourcery.example/legal/privacy/versions/${epoch.privacyArtifact.version}/`,
    SITESOURCERY_INDEPENDENT_TUNNEL_URL:
      "https://sitesourcery.example/api/v1/health",
    SITESOURCERY_INDEPENDENT_TLS_HOSTNAME:
      "sitesourcery.example"
  }, epoch);
  assert.deepEqual(monitor.privacyArtifact, epoch.privacyArtifact);
});

test("rejects CI, origin, installed readback, and lifted-authority mismatches", () => {
  const selected = chain();
  const otherInput = successorInput({
    origin: selected.origin,
    legalManifestSha256: "9".repeat(64)
  });
  assert.throws(
    () => createHeldFinalReleaseEpochV2({
      successorInput: selected.input,
      ciFinalReceipt: ciFinalReceipt(otherInput),
      originSeal: selected.selectedSeal,
      installedReadback: selected.selectedReadback
    }),
    /CI final receipt drifted/u
  );

  const otherOrigin = originInput({
    sourceCommitSha: "8".repeat(40),
    sourceTreeSha: "7".repeat(40)
  });
  const otherSeal = seal(otherOrigin);
  assert.throws(
    () => createHeldFinalReleaseEpochV2({
      successorInput: selected.input,
      ciFinalReceipt: selected.ciReceipt,
      originSeal: otherSeal,
      installedReadback: readback(otherSeal)
    }),
    /Origin source commit drifted/u
  );

  const wrongIdentity = clone(
    expectedOriginInstalledIdentity(selected.selectedSeal)
  );
  wrongIdentity.workerManifestSha256 = "6".repeat(64);
  assert.throws(
    () => createHeldFinalReleaseEpochV2({
      successorInput: selected.input,
      ciFinalReceipt: selected.ciReceipt,
      originSeal: selected.selectedSeal,
      installedReadback: readback(
        selected.selectedSeal,
        wrongIdentity
      )
    }),
    /Installed origin identity/u
  );

  const lifted = clone(selected.input);
  lifted.authority.allowsProviderEffects = true;
  assert.throws(
    () => createHeldFinalReleaseEpochV2({
      successorInput: lifted,
      ciFinalReceipt: selected.ciReceipt,
      originSeal: selected.selectedSeal,
      installedReadback: selected.selectedReadback
    }),
    /authority must remain exactly held/u
  );
});

test("compact receipt fails closed on tamper, extra fields, and effect lift", () => {
  const epoch = finalEpoch();
  for (const mutate of [
    (value) => { value.bindingSha256 = "0".repeat(64); },
    (value) => { value.identity.migrationCount += 1; },
    (value) => { value.legalV4Pages.manifestSha256 = "1".repeat(64); },
    (value) => { value.rollback.predecessorCommitSha = value.identity.sourceCommitSha; },
    (value) => { value.authority.allowsCustomerEffects = true; },
    (value) => { value.unreviewed = true; }
  ]) {
    const tampered = clone(epoch);
    mutate(tampered);
    assert.throws(
      () => validateFinalReleaseEpochV2(tampered),
      /Final release|must contain only/u
    );
  }
  const lifted = clone(epoch);
  lifted.authority.allowsProviderEffects = true;
  lifted.digest = finalReleaseEpochV2Digest(lifted);
  assert.throws(
    () => validateFinalReleaseEpochV2(lifted),
    /must remain exactly held/u
  );
});

test("anchored fd loader rejects drift and remains safe across a leaf swap", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-final-epoch-v2-")
  );
  try {
    const selected = path.join(fixture, "epoch.json");
    const linked = path.join(fixture, "epoch-link.json");
    const preserved = path.join(fixture, "epoch-opened.json");
    const replacement = path.join(fixture, "epoch-replacement.json");
    const expectedEpoch = finalEpoch();
    const source = Buffer.from(`${JSON.stringify(expectedEpoch)}\n`, "utf8");
    const options = {
      expectedSha256: sha256Bytes(source),
      expectedOwnerUid: process.getuid(),
      expectedPath: selected,
      expectedParentPath: fixture
    };
    await writeFile(selected, source);
    assert.deepEqual(
      await readFinalReleaseEpochV2File(selected, options),
      expectedEpoch
    );
    await assert.rejects(
      readFinalReleaseEpochV2File("relative.json"),
      /absolute path/u
    );
    await assert.rejects(
      readFinalReleaseEpochV2File(path.join(fixture, "missing.json"), {
        ...options,
        expectedPath: path.join(fixture, "missing.json")
      }),
      /unavailable or unsafe/u
    );
    await symlink(selected, linked);
    await assert.rejects(
      readFinalReleaseEpochV2File(linked, {
        ...options,
        expectedPath: linked
      }),
      /unavailable or unsafe/u
    );
    await writeFile(replacement, `${JSON.stringify({ forged: true })}\n`);
    assert.deepEqual(
      await readFinalReleaseEpochV2File(selected, {
        ...options,
        afterOpen: async () => {
          await rename(selected, preserved);
          await symlink(replacement, selected);
        }
      }),
      expectedEpoch
    );
    await rm(selected);
    await rename(preserved, selected);
    await assert.rejects(
      readFinalReleaseEpochV2File(selected, {
        ...options,
        expectedSha256: "0".repeat(64)
      }),
      /unavailable or unsafe/u
    );
    await chmod(selected, 0o666);
    await assert.rejects(
      readFinalReleaseEpochV2File(selected, options),
      /unavailable or unsafe/u
    );
    await chmod(selected, 0o600);
    await writeFile(selected, "{not-json}\n", "utf8");
    await assert.rejects(
      readFinalReleaseEpochV2File(selected, {
        ...options,
        expectedSha256: sha256Bytes(Buffer.from("{not-json}\n"))
      }),
      /not an exact JSON object/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("external origin anchors reject a self-consistent forged v2 receipt", () => {
  const selected = chain();
  const epoch = finalEpoch(selected);
  assert.deepEqual(
    validateInstalledFinalReleaseEpochV2Chain({
      epoch,
      originSeal: selected.selectedSeal,
      installedReadback: selected.selectedReadback
    }),
    epoch
  );
  const forged = clone(epoch);
  forged.identity.sourceCommitSha = "9".repeat(40);
  forged.digest = finalReleaseEpochV2Digest(forged);
  assert.throws(
    () => validateInstalledFinalReleaseEpochV2Chain({
      epoch: forged,
      originSeal: selected.selectedSeal,
      installedReadback: selected.selectedReadback
    }),
    /external anchors/u
  );
  const mispaired = clone(epoch);
  mispaired.epochId = "mispaired-final-epoch";
  mispaired.digest = finalReleaseEpochV2Digest(mispaired);
  assert.throws(
    () => validateInstalledFinalReleaseEpochV2Chain({
      epoch: mispaired,
      originSeal: selected.selectedSeal,
      installedReadback: selected.selectedReadback
    }),
    /external anchors/u
  );
});

test("precheck and runtime share one exact installed path and raw digest contract", async () => {
  const [unit, environment, server] = await Promise.all([
    readFile(new URL("../sitesourcery-hosted.service.held", import.meta.url), "utf8"),
    readFile(new URL("../hosted.env.example", import.meta.url), "utf8"),
    readFile(
      new URL("../../server/hosted/bin/server.mjs", import.meta.url),
      "utf8"
    )
  ]);
  const fields = [
    "SITESOURCERY_RELEASE_EPOCH_FILE",
    "SITESOURCERY_RELEASE_EPOCH_SHA256",
    "SITESOURCERY_ORIGIN_SEAL_FILE",
    "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"
  ];
  for (const field of fields) {
    assert.match(environment, new RegExp(`^${field}=`, "mu"));
    assert.match(unit, new RegExp(`\\$\\{${field}\\}`, "u"));
    assert.match(server, new RegExp(`"${field}"`, "u"));
  }
  assert.doesNotMatch(unit, /--epoch \/etc\/sitesourcery/u);
  await assert.rejects(
    readInstalledFinalReleaseEpochV2({
      epochPath: "/etc/sitesourcery/not-the-epoch.json",
      expectedEpochFileSha256: "1".repeat(64),
      originSealPath: "/etc/sitesourcery/origin-seal.json",
      expectedOriginSealFileSha256: "2".repeat(64),
      installedReadbackPath:
        "/etc/sitesourcery/origin-installed-readback.json",
      expectedInstalledReadbackFileSha256: "3".repeat(64)
    }),
    /exact installed path/u
  );
});

test("v2 schema stays generic while every retained v1 authority byte remains immutable", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../final-release-epoch-v2.schema.json", import.meta.url),
      "utf8"
    )
  );
  assert.equal(schema.$id, FINAL_RELEASE_EPOCH_V2_JSON_SCHEMA_ID);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema.const, FINAL_RELEASE_EPOCH_V2_SCHEMA);
  assert.equal(schema.properties.authority.const.allowsDeployment, false);

  const retained = new Map([
    ["../release-epoch.mjs", "9953c525b231a791e17e59fb67fdeba87f3472f39be8d288c53daeee3b041e99"],
    ["../release-epoch.schema.json", "497eeb7c531b9b24d7533516e3e0e62e266dc217f552c5d42bc6761e8c545148"],
    ["../verify-release-epoch.mjs", "bf62a2f077c01178663afd7006a484fa2fff6217a9e810b8cf7bc2184022a8a3"],
    ["../releases/shape-epoch-2026-08-10/release-epoch.json", "5dc8c26f68a519bcefc25089c9f6db0c6c39173a40c2812f013ee9fd2203e7ef"]
  ]);
  for (const [relativePath, expected] of retained) {
    const bytes = await readFile(
      new URL(relativePath, import.meta.url)
    );
    assert.equal(sha256Bytes(bytes), expected, relativePath);
  }
});
