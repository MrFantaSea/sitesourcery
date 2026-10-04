import { createCiReleaseSuccessorInputFromRepository, CI_RELEASE_GENERATION_LAYOUT } from "../ci-release-proof-repository.mjs";
import { runCiReleaseProofCli } from "../ci-release-proof.mjs";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { originDeploymentProfile } from "../origin-deployment-profiles.mjs";
import { collectOriginRepositorySnapshot, collectOriginWorkerRuntime } from "../origin-seal-repository.mjs";
import { validateCiReleaseSuccessorInput } from "../ci-release-proof-runtime.mjs";
import { canonicalJson } from "../immutable-evidence.mjs";
import {
  createOriginReleaseInput, createOriginSeal, validateOriginReleaseInput, validateOriginSeal,
  createOriginInstalledReadback, validateOriginInstalledReadback, compareOriginInstalledReadback,
  expectedOriginInstalledIdentity, expectedOriginInstalledWorker, ORIGIN_HELD_AUTHORITY,
  originSealSha256, originInstalledReadbackDigest, createOriginInstallPlan, createOriginRollbackPlan,
  originWorkerContractSha256
} from "../origin-seal-runtime.mjs";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const deploymentProfile = "hq-local-v1";
const profile = originDeploymentProfile(deploymentProfile);
const layout = {
  artifactRoot: "ops/releases/joint-legal-v4-2026-08-09T214211Z/hosted",
  migrationRoot: "server/data-plane/supabase/migrations",
  legalConstantsPath: "ops/releases/joint-legal-v4-2026-08-09T214211Z/joint-legal-v4-release-constants.json"
};
const historicalRoot = path.join(projectRoot, "ops/releases/ci-successor-inputs");
const historical = JSON.parse(await readFile(path.join(historicalRoot, "1126f5bf4993887e4a41571e9671e2fa20e1f136.json"), "utf8"));
const snapshot = await collectOriginRepositorySnapshot({ projectRoot, layout, deploymentProfile });
const clone = structuredClone;
function inputFromSnapshot(selected = snapshot, id = deploymentProfile) {
  const epoch = clone(historical.originReleaseInput.epoch);
  delete epoch.bindingSha256;
  if (id !== undefined) epoch.deploymentProfile = id;
  epoch.layout = layout;
  epoch.source = { commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
  for (const field of ["artifact", "units", "environmentSchema", "worker", "migration", "legal", "ingress"]) {
    epoch[field].manifestSha256 = selected[field].sha256;
  }
  epoch.environmentSchema.classificationSha256 = selected.environmentSchema.classificationSha256;
  epoch.worker.contractSha256 = selected.worker.contractSha256;
  for (const field of ["count", "latest"]) epoch.migration[field] = selected.migration[field];
  for (const field of Object.keys(epoch.legal)) if (field !== "manifestSha256") epoch.legal[field] = selected.legal[field];
  return createOriginReleaseInput({ releaseId: "hq-unit-test-fixture", epoch });
}
const input = inputFromSnapshot();
const seal = createOriginSeal({ releaseInput: input, observed: { source: input.epoch.source, ...snapshot } });
function readback() {
  return createOriginInstalledReadback({ seal, observedAt: "2026-10-04T02:00:00.000Z", identity: expectedOriginInstalledIdentity(seal), worker: expectedOriginInstalledWorker(seal), listeners: profile.listeners, authority: ORIGIN_HELD_AUTHORITY });
}

test("all retained CI successor inputs retain their nested and outer digests", async () => {
  const files = (await readdir(historicalRoot)).filter(name => name.endsWith(".json"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const value = JSON.parse(await readFile(path.join(historicalRoot, name), "utf8"));
    assert.equal(canonicalJson(validateCiReleaseSuccessorInput(value)), canonicalJson(value), name);
    assert.equal(Object.hasOwn(value.originReleaseInput.epoch, "deploymentProfile"), false);
  }
});

test("HQ binds actual templates, manifest paths, worker placement and loopback expectations", () => {
  assert.equal(seal.hostRole, "hq_origin_local_database");
  assert.equal(seal.deploymentProfile, deploymentProfile);
  assert.deepEqual(seal.units.files.map(file => file.path).sort(), [...profile.unitPaths].sort());
  assert.equal(seal.worker.contract.deploymentProfile, deploymentProfile);
  assert.equal(compareOriginInstalledReadback({ seal, readback: readback() }).state, "verified");
  assert.throws(() => createOriginInstallPlan(seal), /legacy Dell plans are unsupported/u);
  assert.throws(() => createOriginRollbackPlan(seal), /legacy Dell plans are unsupported/u);
});

test("profile changes or removal cannot reuse an existing input digest", () => {
  const old = clone(historical.originReleaseInput);
  old.epoch.deploymentProfile = deploymentProfile;
  assert.throws(() => validateOriginReleaseInput(old), /digest|binding/u);
  const missing = clone(input); delete missing.epoch.deploymentProfile;
  assert.throws(() => validateOriginReleaseInput(missing), /digest|binding/u);
  for (const invalid of [null, "dell", "hq-local-v2", undefined]) {
    const value = clone(input); value.epoch.deploymentProfile = invalid;
    assert.throws(() => validateOriginReleaseInput(value), /profile/u);
  }
});

test("rehashing cannot bless mixed Dell and HQ roles, listeners or worker templates", () => {
  for (const mutate of [
    value => { value.hostRole = "dell_origin_hq_database"; },
    value => { value.ingress.expectations.hostedApi = "127.0.0.1:8788"; },
    value => { value.worker.contract.hostedUnit.path = "ops/sitesourcery-hosted.service.held"; value.worker.contractSha256 = originWorkerContractSha256(value.worker.contract); },
    value => { delete value.deploymentProfile; }
  ]) {
    const value = clone(seal); mutate(value); value.sealSha256 = originSealSha256(value);
    assert.throws(() => validateOriginSeal(value), /identity|expectations|path|profile/u);
  }
  for (const mutate of [
    value => { value.hostRole = "dell_origin_hq_database"; },
    value => { value.listeners.hostedApi = "127.0.0.1:8788"; },
    value => { value.listeners.hostedApi = "0.0.0.0:18988"; },
    value => { value.worker.hostedUnit.path = "ops/sitesourcery-hosted.service.held"; },
    value => { delete value.deploymentProfile; }
  ]) {
    const value = clone(readback()); mutate(value); value.digest = originInstalledReadbackDigest(value);
    assert.throws(() => validateOriginInstalledReadback(value), /identity|loopback|path|profile/u);
  }
});

async function withFixture(files, action) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "ss-hq-profile-"));
  try {
    for (const name of new Set(files)) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(projectRoot, name), target);
    }
    await action(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("HQ repository validation rejects old port, public binds and additional upstreams", async () => {
  const files = [profile.caddyPath, profile.tunnelPath, profile.gatewayUnit, profile.tunnelUnit, profile.workerPaths.hostedEnvironmentSchema, profile.workerPaths.tenantEnvironmentSchema, "data/release-control.json", "data/abracadabra-commercial-control.json"];
  await withFixture(files, async root => {
    const caddyPath = path.join(root, profile.caddyPath);
    const original = await readFile(caddyPath, "utf8");
    for (const [before, after] of [
      ["127.0.0.1:18988", "127.0.0.1:8788"],
      ["bind 127.0.0.1", "bind 0.0.0.0"],
      ["reverse_proxy 127.0.0.1:18988 {", "reverse_proxy 127.0.0.1:18988 192.0.2.1:1234 {"],
      [profile.currentRoot, "/opt/sitesourcery/current"]
    ]) {
      await writeFile(caddyPath, original.replaceAll(before, after));
      await assert.rejects(collectOriginRepositorySnapshot({ projectRoot: root, layout, deploymentProfile }), /Caddy ingress|gateway placement/u);
    }
  });
});

test("HQ worker collection rejects wrong data paths and missing protected mount dependency", async () => {
  await withFixture(Object.values(profile.workerPaths), async root => {
    const unitPath = path.join(root, profile.workerPaths.hostedUnit);
    const original = await readFile(unitPath, "utf8");
    for (const changed of [original.replaceAll(profile.dataRoot, "/var/lib/sitesourcery"), original.replace("RequiresMountsFor=/srv/sitesourcery-storage", "")]) {
      await writeFile(unitPath, changed);
      await assert.rejects(collectOriginWorkerRuntime(root, deploymentProfile), /process authority|placement/u);
    }
  });
});

test("JSON schema accepts the optional HQ version only at epoch scope", async () => {
  const schema = JSON.parse(await readFile(path.join(projectRoot, "ops/origin-release-input.schema.json"), "utf8"));
  assert.deepEqual(schema.$defs.epoch.properties.deploymentProfile, { const: deploymentProfile });
  assert.equal(schema.$defs.epoch.required.includes("deploymentProfile"), false);
  assert.equal(schema.$defs.manifestReference.properties.deploymentProfile, undefined);
});


test("CI generation and origin reverification both use the bound HQ profile", async () => {
  const legalPath = CI_RELEASE_GENERATION_LAYOUT.legalConstantsPath;
  const legal = JSON.parse(await readFile(path.join(projectRoot, legalPath), "utf8"));
  const files = [...profile.unitPaths, ...profile.environmentPaths, ...profile.ingressPaths,
    ...Object.values(profile.workerPaths), ...snapshot.migration.files.map(file => file.path),
    "data/release-control.json", "data/abracadabra-commercial-control.json", legalPath,
    ...legal.artifacts.map(file => path.posix.join(path.posix.dirname(legalPath), file.file))];
  await withFixture(files, async root => {
    // Deliberately synthetic artifacts and Git adapter are unit-test fixtures only.
    for (const folder of ["_site", "_hosted", "rollback"]) {
      await mkdir(path.join(root, folder));
      await writeFile(path.join(root, folder, "index.html"), "HQ generation fixture\n");
    }
    const commit = "a".repeat(40), tree = "b".repeat(40);
    const previous = "c".repeat(40), previousTree = "d".repeat(40);
    const gitRunner = async args => {
      const command = args.join(" ");
      const values = new Map([
        ["rev-parse HEAD", commit], ["rev-parse HEAD^{tree}", tree],
        [`rev-parse ${commit}^{tree}`, tree], [`rev-parse ${previous}^{tree}`, previousTree],
        ["rev-parse --show-toplevel", root],
        ["rev-parse --git-path info/grafts", path.join(root, ".git/info/grafts")]
      ]);
      if (values.has(command)) return values.get(command);
      if (["status", "ls-tree", "ls-files", "for-each-ref", "cat-file", "merge-base"].includes(args[0])) return "";
      throw new Error(`Unexpected test Git command: ${command}`);
    };
    const generated = await createCiReleaseSuccessorInputFromRepository({
      projectRoot: root, deploymentProfile, epochId: "hq-generation-test", gitRunner,
      rollback: { predecessorCommitSha: previous, predecessorTreeSha: previousTree, artifactRoot: path.join(root, "rollback") }
    });
    const value = validateCiReleaseSuccessorInput(generated.successorInput);
    assert.equal(value.originReleaseInput.epoch.deploymentProfile, deploymentProfile);
    assert.equal(value.originReleaseInput.epoch.worker.contractSha256, snapshot.worker.contractSha256);
    assert.equal(value.originReleaseInput.epoch.migration.count, snapshot.migration.count);
  });
});

test("CLI accepts deployment profile only on generation and retains strict required flags", async () => {
  const args = ["generate", "--root", "/sitesourcery-nonexistent-unit-test-path", "--epoch-id", "hq-test", "--rollback-commit", "a".repeat(40), "--rollback-tree", "b".repeat(40), "--rollback-artifact-root", "/nonexistent"];
  await assert.rejects(runCiReleaseProofCli({ arguments_: [...args, "--deployment-profile", deploymentProfile], environment: {} }), error => error.code === "ENOENT");
  await assert.rejects(runCiReleaseProofCli({ arguments_: args.slice(0, -2).concat(["--deployment-profile", deploymentProfile]), environment: {} }), /missing or unexpected flags/u);
  await assert.rejects(runCiReleaseProofCli({ arguments_: ["provenance", "--root", projectRoot, "--deployment-profile", deploymentProfile], environment: {} }), /missing or unexpected flags/u);
});
