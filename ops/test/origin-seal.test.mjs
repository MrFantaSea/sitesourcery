import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyOriginEnvironmentName,
  collectOriginRepositorySnapshot,
  collectOriginWorkerRuntime,
  verifyOriginReleaseRepository
} from "../origin-seal-repository.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_HOST_ROLE,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
  ORIGIN_WORKER_PATHS,
  ORIGIN_WORKER_PURPOSES,
  compareOriginInstalledReadback,
  createOriginInstallPlan,
  createOriginInstalledReadback,
  createOriginReleaseInput,
  createOriginRollbackPlan,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker,
  validateOriginReleaseInput,
  validateOriginSeal
} from "../origin-seal-runtime.mjs";

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
const OBSERVED_AT = "2026-08-10T18:00:00.000Z";

const snapshot = await collectOriginRepositorySnapshot({
  projectRoot,
  layout
});

function epochFromSnapshot(overrides = {}) {
  const epoch = {
    schema: ORIGIN_SUCCESSOR_EPOCH_SCHEMA,
    epochId: "shape-epoch-successor-fixture",
    supersedes: {
      epochId: "shape-epoch-20260810",
      bindingSha256:
        "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6"
    },
    basis: {
      unionBaseCommitSha:
        "5458d9641fd42c9a1b436c6af6bb6600b60bce74"
    },
    layout: structuredClone(layout),
    source: {
      commitSha: SOURCE_COMMIT,
      treeSha: SOURCE_TREE
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
    rollback: {
      predecessorCommitSha: PREDECESSOR_COMMIT,
      predecessorTreeSha: PREDECESSOR_TREE,
      predecessorArtifactManifestSha256: PREDECESSOR_ARTIFACT
    },
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return Object.assign(epoch, overrides);
}

function releaseInput(epoch = epochFromSnapshot()) {
  return createOriginReleaseInput({
    releaseId: "ops-origin-fixture",
    epoch
  });
}

function observed() {
  return {
    source: {
      commitSha: SOURCE_COMMIT,
      treeSha: SOURCE_TREE
    },
    ...structuredClone(snapshot)
  };
}

function seal() {
  return createOriginSeal({
    releaseInput: releaseInput(),
    observed: observed()
  });
}

test("successor input derives migration authority and every origin hash from exact evidence", async () => {
  const oldEpoch = JSON.parse(
    await readFile(
      path.join(
        projectRoot,
        "ops/releases/shape-epoch-2026-08-10/release-epoch.json"
      ),
      "utf8"
    )
  );
  assert.notEqual(
    oldEpoch.binding.database.migrationCount,
    snapshot.migration.count
  );
  assert.equal(snapshot.migration.count, snapshot.migration.fileCount);
  assert.equal(
    snapshot.migration.latest,
    snapshot.migration.files.at(-1).path.split("/").at(-1)
  );
  const input = releaseInput();
  assert.deepEqual(validateOriginReleaseInput(input), input);
  assert.equal(input.epoch.migration.count, snapshot.migration.count);
  assert.equal(input.epoch.artifact.manifestSha256, snapshot.artifact.sha256);
  assert.equal(input.epoch.units.manifestSha256, snapshot.units.sha256);
  assert.equal(
    input.epoch.environmentSchema.manifestSha256,
    snapshot.environmentSchema.sha256
  );
  assert.equal(
    input.epoch.environmentSchema.classificationSha256,
    snapshot.environmentSchema.classificationSha256
  );
  assert.equal(input.epoch.worker.manifestSha256, snapshot.worker.sha256);
  assert.equal(
    input.epoch.worker.contractSha256,
    snapshot.worker.contractSha256
  );
  assert.equal(input.epoch.legal.manifestSha256, snapshot.legal.sha256);
  assert.equal(input.epoch.ingress.manifestSha256, snapshot.ingress.sha256);
});

test("worker evidence binds entrypoints unit environment held purposes and split pool", () => {
  assert.deepEqual(
    snapshot.worker.files.map(({ path: selectedPath }) => selectedPath),
    Object.values(ORIGIN_WORKER_PATHS).sort((left, right) =>
      left.localeCompare(right)
    )
  );
  assert.equal(
    snapshot.units.files.some(({ path: selectedPath }) =>
      selectedPath === ORIGIN_WORKER_PATHS.unit
    ),
    true
  );
  assert.equal(
    snapshot.environmentSchema.files.some(({ path: selectedPath }) =>
      selectedPath === ORIGIN_WORKER_PATHS.environmentSchema
    ),
    true
  );
  assert.equal(snapshot.worker.contract.activation, "held");
  assert.deepEqual(
    snapshot.worker.contract.selectedPurposes,
    ORIGIN_WORKER_PURPOSES
  );
  assert.deepEqual(snapshot.worker.contract.postgresPool, {
    totalConnections: 10,
    apiConnections: 8,
    workerReservedConnections: 2,
    connectionIncrease: "none"
  });
  assert.equal(snapshot.worker.contract.apiWorkerLoopCount, 0);
  assert.equal(
    snapshot.worker.contract.apiWorkerMode,
    "external_process_required"
  );
  assert.equal(snapshot.worker.contract.workerOwnsPublicListener, false);
  assert.equal(snapshot.worker.contract.allowsProviderEffects, false);
});

test("environment inventory projects names and classifications without values", () => {
  assert.equal(
    classifyOriginEnvironmentName("SITESOURCERY_ENGAGEMENT_TOKEN_SECRET"),
    "secret"
  );
  assert.equal(
    classifyOriginEnvironmentName("SITESOURCERY_HOSTED_PORT"),
    "non-secret-configuration"
  );
  assert.equal(
    snapshot.environmentSchema.variables.some(
      ({ name, classification }) =>
        name === "SITESOURCERY_DATABASE_URL" && classification === "secret"
    ),
    true
  );
  for (const variable of snapshot.environmentSchema.variables) {
    assert.deepEqual(Object.keys(variable).sort(), [
      "classification",
      "name",
      "source"
    ]);
  }
  assert.doesNotMatch(
    JSON.stringify(snapshot.environmentSchema.variables),
    /replace-with|postgresql:|base64-secret/u
  );
});

test("worker evidence fails closed on API loop or held-config drift", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-origin-worker-contract-")
  );
  try {
    for (const relativePath of Object.values(ORIGIN_WORKER_PATHS)) {
      const target = path.join(fixture, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(projectRoot, relativePath), target);
    }
    const selected = await collectOriginWorkerRuntime(fixture);
    assert.equal(selected.contract.activation, "held");

    const apiPath = path.join(fixture, ORIGIN_WORKER_PATHS.apiEntrypoint);
    const apiSource = await readFile(apiPath, "utf8");
    await writeFile(
      apiPath,
      `${apiSource}\n// createWorkerSupervisor would violate API isolation.\n`,
      "utf8"
    );
    await assert.rejects(
      collectOriginWorkerRuntime(fixture),
      /zero in-process worker loops/u
    );

    await writeFile(apiPath, apiSource, "utf8");
    const environmentPath = path.join(
      fixture,
      ORIGIN_WORKER_PATHS.environmentSchema
    );
    const environment = await readFile(environmentPath, "utf8");
    await writeFile(
      environmentPath,
      environment.replace('"activation":"held"', '"activation":"owner-approved"'),
      "utf8"
    );
    await assert.rejects(
      collectOriginWorkerRuntime(fixture),
      /must remain exactly held/u
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("missing or stale successor migration authority fails closed", () => {
  const missing = epochFromSnapshot();
  delete missing.migration.count;
  assert.throws(
    () => releaseInput(missing),
    /Origin migrations must contain only its exact fields/u
  );

  const stale = epochFromSnapshot();
  stale.migration.count -= 1;
  const staleInput = releaseInput(stale);
  assert.throws(
    () => createOriginSeal({ releaseInput: staleInput, observed: observed() }),
    /migration authority drifted/u
  );
});

test("seal rejects source artifact unit environment legal and ingress drift independently", () => {
  const mutations = [
    (epoch) => { epoch.source.treeSha = "1".repeat(40); },
    (epoch) => { epoch.artifact.manifestSha256 = "2".repeat(64); },
    (epoch) => { epoch.units.manifestSha256 = "3".repeat(64); },
    (epoch) => {
      epoch.environmentSchema.manifestSha256 = "4".repeat(64);
    },
    (epoch) => {
      epoch.environmentSchema.classificationSha256 = "7".repeat(64);
    },
    (epoch) => { epoch.worker.manifestSha256 = "8".repeat(64); },
    (epoch) => { epoch.worker.contractSha256 = "9".repeat(64); },
    (epoch) => { epoch.legal.manifestSha256 = "5".repeat(64); },
    (epoch) => { epoch.ingress.manifestSha256 = "6".repeat(64); }
  ];
  for (const mutate of mutations) {
    const epoch = epochFromSnapshot();
    mutate(epoch);
    assert.throws(
      () => createOriginSeal({
        releaseInput: releaseInput(epoch),
        observed: observed()
      }),
      /drifted/u
    );
  }
});

test("repository verification requires clean exact Git and rollback ancestry", async () => {
  const input = releaseInput();
  const gitRunner = async (arguments_) => {
    const joined = arguments_.join(" ");
    if (joined === "rev-parse HEAD") return SOURCE_COMMIT;
    if (joined === `rev-parse ${SOURCE_COMMIT}^{tree}`) return SOURCE_TREE;
    if (joined === `rev-parse ${PREDECESSOR_COMMIT}^{tree}`) {
      return PREDECESSOR_TREE;
    }
    if (joined === "status --porcelain=v1 --untracked-files=no") return "";
    return "";
  };
  const selected = await verifyOriginReleaseRepository({
    projectRoot,
    releaseInput: input,
    gitRunner
  });
  assert.equal(selected.source.commitSha, SOURCE_COMMIT);
  assert.equal(selected.rollback.predecessorCommitSha, PREDECESSOR_COMMIT);

  await assert.rejects(
    verifyOriginReleaseRepository({
      projectRoot,
      releaseInput: input,
      gitRunner: async (arguments_) => {
        if (arguments_.join(" ") === "status --porcelain=v1 --untracked-files=no") {
          return " M tracked-file";
        }
        return gitRunner(arguments_);
      }
    }),
    /dirty or drifted/u
  );
});

test("origin seal is deterministic, exact-host-role, held, and loopback-only", () => {
  const first = seal();
  const second = seal();
  assert.deepEqual(first, second);
  assert.deepEqual(validateOriginSeal(first), first);
  assert.equal(first.hostRole, ORIGIN_HOST_ROLE);
  assert.equal(
    first.unionBaseCommitSha,
    "5458d9641fd42c9a1b436c6af6bb6600b60bce74"
  );
  assert.deepEqual(first.authority, ORIGIN_HELD_AUTHORITY);
  assert.deepEqual(first.layout, layout);
  assert.deepEqual(first.ingress.expectations, ORIGIN_LOOPBACK_EXPECTATIONS);
  assert.deepEqual(first.worker, snapshot.worker);
  assert.equal(first.migration.count, snapshot.migration.count);
  assert.equal(first.rollback.predecessorCommitSha, PREDECESSOR_COMMIT);
});

test("installed readback compares every identity field without granting authority", () => {
  const selectedSeal = seal();
  const readback = createOriginInstalledReadback({
    seal: selectedSeal,
    observedAt: OBSERVED_AT,
    identity: expectedOriginInstalledIdentity(selectedSeal),
    worker: expectedOriginInstalledWorker(selectedSeal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  });
  const verified = compareOriginInstalledReadback({
    seal: selectedSeal,
    readback
  });
  assert.equal(verified.state, "verified");
  assert.deepEqual(verified.mismatches, []);

  const wrongIdentity = {
    ...expectedOriginInstalledIdentity(selectedSeal),
    artifactManifestSha256: "7".repeat(64)
  };
  const mismatch = compareOriginInstalledReadback({
    seal: selectedSeal,
    readback: createOriginInstalledReadback({
      seal: selectedSeal,
      observedAt: OBSERVED_AT,
      identity: wrongIdentity,
      worker: expectedOriginInstalledWorker(selectedSeal),
      listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
      authority: structuredClone(ORIGIN_HELD_AUTHORITY)
    })
  });
  assert.equal(mismatch.state, "mismatch");
  assert.deepEqual(mismatch.mismatches, [
    "IDENTITY_ARTIFACT_MANIFEST_SHA256_MISMATCH"
  ]);
});

test("installed readback rejects public listeners or any capability lift", () => {
  const selectedSeal = seal();
  const base = {
    seal: selectedSeal,
    observedAt: OBSERVED_AT,
    identity: expectedOriginInstalledIdentity(selectedSeal),
    worker: expectedOriginInstalledWorker(selectedSeal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  base.listeners.publicTcpListeners = ["0.0.0.0:443"];
  assert.throws(
    () => createOriginInstalledReadback(base),
    /not exactly loopback-only/u
  );
  base.listeners = structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS);
  base.authority.allowsProviderEffects = true;
  assert.throws(
    () => createOriginInstalledReadback(base),
    /must remain exactly held/u
  );
});

test("installed worker readback rejects effects and reports bounded contract drift", () => {
  const selectedSeal = seal();
  const common = {
    seal: selectedSeal,
    observedAt: OBSERVED_AT,
    identity: expectedOriginInstalledIdentity(selectedSeal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  for (const mutate of [
    (worker) => { worker.activation = "owner-approved"; },
    (worker) => { worker.apiWorkerLoopCount = 1; },
    (worker) => { worker.workerOwnsPublicListener = true; },
    (worker) => { worker.allowsProviderEffects = true; },
    (worker) => { worker.postgresPool.workerReservedConnections = 3; }
  ]) {
    const worker = structuredClone(expectedOriginInstalledWorker(selectedSeal));
    mutate(worker);
    assert.throws(
      () => createOriginInstalledReadback({ ...common, worker }),
      /held, external, and effect-free|allocation is invalid/u
    );
  }

  const worker = structuredClone(expectedOriginInstalledWorker(selectedSeal));
  worker.selectedPurposes = worker.selectedPurposes.slice(0, -1);
  const mismatch = compareOriginInstalledReadback({
    seal: selectedSeal,
    readback: createOriginInstalledReadback({ ...common, worker })
  });
  assert.equal(mismatch.state, "mismatch");
  assert.deepEqual(mismatch.mismatches, ["WORKER_CONTRACT_MISMATCH"]);
});

test("held install and rollback plans contain exact commands but no activation", () => {
  const selectedSeal = seal();
  const install = createOriginInstallPlan(selectedSeal);
  assert.equal(install.state, "held");
  assert.equal(install.sealSha256, selectedSeal.sealSha256);
  assert.equal(
    install.commands.some(({ argv }) =>
      argv.includes("start") || argv.includes("restart") || argv.includes("enable")
    ),
    false
  );
  assert.deepEqual(install.intentionallyExcludedCommands, [
    "service_start",
    "service_restart",
    "service_enable",
    "database_migration",
    "dns_change",
    "provider_call",
    "deployment"
  ]);
  const installIds = install.commands.map(({ id }) => id);
  assert.ok(
    installIds.indexOf("verify-worker-approval-held") <
      installIds.indexOf("install-worker-unit")
  );
  assert.ok(
    installIds.indexOf("verify-private-worker-environment") <
      installIds.indexOf("install-worker-unit")
  );
  assert.ok(
    installIds.indexOf("verify-private-tenant-environment") <
      installIds.indexOf("install-tenant-unit")
  );
  assert.ok(
    installIds.indexOf("install-hosted-unit") <
      installIds.indexOf("install-tenant-unit") &&
      installIds.indexOf("install-tenant-unit") <
        installIds.indexOf("install-worker-unit") &&
      installIds.indexOf("install-worker-unit") <
        installIds.indexOf("install-origin-unit") &&
      installIds.indexOf("install-origin-unit") <
        installIds.indexOf("install-tunnel-unit")
  );

  const rollback = createOriginRollbackPlan(selectedSeal);
  assert.equal(rollback.state, "held");
  assert.deepEqual(rollback.predecessor, selectedSeal.rollback);
  assert.match(rollback.predecessorRoot, new RegExp(PREDECESSOR_COMMIT, "u"));
  assert.equal(
    rollback.commands.some(({ argv }) => argv.includes("start")),
    false
  );
  const rollbackIds = rollback.commands.map(({ id }) => id);
  assert.ok(
    rollbackIds.indexOf("remove-worker-approval") <
      rollbackIds.indexOf("stop-worker-runtime")
  );
  assert.ok(
    rollbackIds.indexOf("stop-tunnel") <
      rollbackIds.indexOf("stop-origin-gateway") &&
      rollbackIds.indexOf("stop-origin-gateway") <
        rollbackIds.indexOf("stop-worker-runtime") &&
      rollbackIds.indexOf("stop-worker-runtime") <
        rollbackIds.indexOf("stop-tenant-runtime") &&
      rollbackIds.indexOf("stop-tenant-runtime") <
        rollbackIds.indexOf("stop-hosted-runtime") &&
      rollbackIds.indexOf("stop-hosted-runtime") <
        rollbackIds.indexOf("select-predecessor")
  );
  assert.deepEqual(rollback.postcondition, ORIGIN_HELD_AUTHORITY);
});

test("tool sources and schema contain no hard-coded current migration count or live effects", async () => {
  const sources = await Promise.all([
    "origin-seal-runtime.mjs",
    "origin-seal-repository.mjs",
    "origin-seal.mjs",
    "origin-install-plan.mjs",
    "origin-installed-readback.mjs",
    "origin-rollback-plan.mjs"
  ].map((name) => readFile(path.join(projectRoot, "ops", name), "utf8")));
  const schema = JSON.parse(
    await readFile(
      path.join(projectRoot, "ops/origin-release-input.schema.json"),
      "utf8"
    )
  );
  assert.equal(
    Object.hasOwn(schema.$defs.migration.properties.count, "const"),
    false
  );
  assert.equal(schema.$defs.migration.properties.count.minimum, 1);
  assert.deepEqual(schema.$defs.workerReference.required, [
    "manifestSha256",
    "contractSha256"
  ]);
  assert.deepEqual(schema.$defs.environmentReference.required, [
    "manifestSha256",
    "classificationSha256"
  ]);
  assert.equal(
    schema.$defs.epoch.required.includes("worker"),
    true
  );
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /ssh\b|scp\b|fetch\(|https\.request|stripe|resend|cloudflare\.com\/client/u);
  assert.doesNotMatch(combined, /migrationCount\s*[:=]\s*[0-9]+/u);
});

test("operator runbook preserves held execution and the secret/live-host boundary", async () => {
  const runbook = await readFile(
    path.join(
      projectRoot,
      "ops/SITESOURCERY-OPS-ORIGIN-01A-DELL-HQ-SEAL-2026-08-10.md"
    ),
    "utf8"
  );
  for (const tool of [
    "origin-seal.mjs",
    "origin-install-plan.mjs",
    "origin-installed-readback.mjs",
    "origin-rollback-plan.mjs"
  ]) {
    assert.match(runbook, new RegExp(tool.replaceAll(".", "\\."), "u"));
  }
  assert.match(runbook, /does not copy, update, or hard-code either migration count/u);
  assert.match(
    runbook,
    /Runtime secrets and\s+credential values are outside the seal/u
  );
  assert.match(runbook, /Do not execute any plan command during ordinary review/u);
  assert.match(runbook, /It deliberately contains no start command/u);
  assert.doesNotMatch(
    runbook,
    /(?:sk_(?:live|test)_|whsec_|CLOUDFLARE_API_TOKEN=|TUNNEL_TOKEN=)[A-Za-z0-9._-]+/u
  );
});
