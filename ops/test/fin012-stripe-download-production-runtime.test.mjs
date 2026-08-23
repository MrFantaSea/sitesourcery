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

import {
  FIN012_STRIPE_DOWNLOAD_ACTIVE_EVIDENCE,
  FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
  FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE,
  FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_DIGEST,
  FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT,
  FIN012_STRIPE_DOWNLOAD_ORIGIN_SEAL_SHA256,
  FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
  FIN012_STRIPE_DOWNLOAD_PREDECESSOR_TREE,
  FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT,
  FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_DIGEST,
  createFin012StripeDownloadHostedEnvironment,
  createFin012StripeDownloadProductionBundle,
  createFin012StripeDownloadUserUnitSet,
  createFin012StripeDownloadWrapper,
  prepareFin012StripeDownloadProductionBundle
} from "../fin012-stripe-download-production-runtime.mjs";
import {
  materializeHistoricalCandidate
} from "./historical-candidate-fixture.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
let hostedArtifactPromise;
let candidateFixturePromise;

function ensureHostedArtifact() {
  candidateFixturePromise ??= materializeHistoricalCandidate({
    projectRoot,
    commitSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
    treeSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE,
    label: "fin012-stripe-download-candidate"
  });
  hostedArtifactPromise ??= candidateFixturePromise.then(async (fixture) => {
    const moduleUrl = pathToFileURL(path.join(
      fixture.candidateRoot,
      "scripts/build-hosted.mjs"
    ));
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
  if (candidateFixturePromise) {
    await (await candidateFixturePromise).cleanup();
  }
});

function predecessorEnvironment(extra = []) {
  return [
    "SITESOURCERY_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:55439/sitesourcery_production",
    "SITESOURCERY_DATABASE_SSL=disable",
    `SITESOURCERY_IDENTITY_PEPPER=${Buffer.alloc(32, 1).toString("base64")}`,
    `SITESOURCERY_IDENTITY_PEPPER_CONFIG=${JSON.stringify(JSON.stringify({schema:"sitesourcery.identity-pepper-config/v1",current:{version:"production-v1",secretEnvironment:"SITESOURCERY_IDENTITY_PEPPER"},prior:[]}))}`,
    `SITESOURCERY_CONTACT_VAULT_KEY=${Buffer.alloc(32, 2).toString("base64")}`,
    "SITESOURCERY_RESEND_API_KEY=re_existing_approved",
    "SITESOURCERY_RESEND_WEBHOOK_MODE=held",
    "SITESOURCERY_STRIPE_MODE=held",
    "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE=held",
    "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE=held",
    "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE=held",
    "SITESOURCERY_TWILIO_VOICE_DIAL_MODE=held",
    "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE=/old/release/resend-mail-transport.mjs",
    "SITESOURCERY_RECOVERY_TRANSPORT_MODULE=/old/release/resend-mail-transport.mjs",
    "SITESOURCERY_RELEASE_EPOCH_FILE=/etc/sitesourcery/final-release-epoch-v2.json",
    `SITESOURCERY_RELEASE_EPOCH_SHA256=${"1".repeat(64)}`,
    "SITESOURCERY_ORIGIN_SEAL_FILE=/etc/sitesourcery/origin-seal.json",
    `SITESOURCERY_ORIGIN_SEAL_FILE_SHA256=${"2".repeat(64)}`,
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE=/etc/sitesourcery/origin-installed-readback.json",
    `SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256=${"3".repeat(64)}`,
    ...extra,
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
  if (selected === "rev-parse HEAD") {
    return FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT;
  }
  if (selected === "rev-parse HEAD^{tree}") {
    return FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE;
  }
  if (
    selected ===
    `rev-parse ${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}^{tree}`
  ) return FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE;
  if (
    selected ===
    `rev-parse ${FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT}^{tree}`
  ) return FIN012_STRIPE_DOWNLOAD_PREDECESSOR_TREE;
  if (selected.startsWith("rev-parse --git-path ")) {
    return "/private/tmp/sitesourcery-fin012-stripe-download-no-grafts";
  }
  if (
    selected.startsWith("status ") ||
    selected.startsWith("for-each-ref ") ||
    selected.startsWith("ls-files ") ||
    selected.startsWith("cat-file ") ||
    selected.startsWith("merge-base ")
  ) return "";
  throw new Error(`Unexpected Git fixture call: ${selected}`);
}

test("FIN-012 Stripe Download successor rebinding preserves every held provider boundary", () => {
  const result = createFin012StripeDownloadHostedEnvironment({
    predecessorEnvironmentText: predecessorEnvironment(),
    evidence: evidence()
  });
  assert.match(result.text, /^SITESOURCERY_STRIPE_MODE=held$/mu);
  assert.match(
    result.text,
    new RegExp(`^SITESOURCERY_RELEASE_EPOCH_FILE=${FIN012_STRIPE_DOWNLOAD_ACTIVE_EVIDENCE.epoch}$`, "mu")
  );
  assert.match(
    result.text,
    new RegExp(`${FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT}/server/hosted/resend-mail-transport\\.mjs`, "u")
  );
  assert.doesNotMatch(result.text, new RegExp(FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT, "u"));
  assert.doesNotMatch(result.text, /SITESOURCERY_STRIPE_SECRET_KEY/u);
  assert.equal(result.providers.stripe, "held_no_secret_loaded");
  assert.equal(result.secretValuesDisclosed, false);
});

test("FIN-012 Stripe Download successor refuses provider secrets and lifted modes", () => {
  for (const line of [
    "SITESOURCERY_STRIPE_SECRET_KEY=sk_live_forbidden",
    "SITESOURCERY_TWILIO_ACCOUNT_SID=AC_forbidden"
  ]) {
    assert.throws(
      () => createFin012StripeDownloadHostedEnvironment({
        predecessorEnvironmentText: predecessorEnvironment([line]),
        evidence: evidence()
      }),
      /cannot enter the production environment/u
    );
  }
  assert.throws(
    () => createFin012StripeDownloadHostedEnvironment({
      predecessorEnvironmentText: predecessorEnvironment().replace(
        "SITESOURCERY_STRIPE_MODE=held",
        "SITESOURCERY_STRIPE_MODE=approved_live"
      ),
      evidence: evidence()
    }),
    /exact FIN-012 authority/u
  );
});

test("FIN-012 Stripe Download wrapper and units select only the exact successor", () => {
  const combined = [
    createFin012StripeDownloadWrapper(),
    ...Object.values(createFin012StripeDownloadUserUnitSet({ evidence: evidence() }))
  ].join("\n");
  assert.match(combined, new RegExp(FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT, "u"));
  assert.match(combined, new RegExp(FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(combined, new RegExp(FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT, "u"));
  assert.match(combined, /ConditionPathExists=.*RUNTIME_APPROVED/u);
  assert.match(combined, /ConditionPathExists=!\/run\/sitesourcery\/BACKUP_QUIESCE/u);
});

test("FIN-012 Stripe Download composes the exact held code-only successor bundle", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const bundle = await createFin012StripeDownloadProductionBundle({
    controlRoot: projectRoot,
    candidateRoot,
    predecessorEnvironmentText: predecessorEnvironment(),
    observedAt: "2026-08-23T00:30:00.000Z",
    gitRunner: candidateGit
  });
  assert.equal(bundle.receipt.state, "prepared_held_no_install");
  assert.equal(
    bundle.receipt.source.candidateCommitSha,
    FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT
  );
  assert.equal(
    bundle.receipt.source.heldControlCommitSha,
    FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT
  );
  assert.equal(
    bundle.receipt.proof.successorInputDigest,
    FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_DIGEST
  );
  assert.equal(
    bundle.receipt.proof.ciFinalReceiptDigest,
    FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_DIGEST
  );
  assert.equal(bundle.originSeal.sealSha256, FIN012_STRIPE_DOWNLOAD_ORIGIN_SEAL_SHA256);
  assert.equal(bundle.epoch.state, "verified_held");
  assert.equal(bundle.epoch.identity.sourceCommitSha, FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT);
  assert.equal(bundle.epoch.identity.migrationCount, 96);
  assert.equal(bundle.receipt.database.migrationRequired, false);
  assert.deepEqual(Object.values(bundle.receipt.authority), [
    false, false, false, false, false, false, false
  ]);
});

test("FIN-012 Stripe Download writes one exclusive no-effect staging bundle", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "ss-fin012-stripe-download-bundle-")
  );
  try {
    const environmentPath = path.join(temporary, "predecessor.env");
    const outputPath = path.join(temporary, "bundle");
    await writeFile(environmentPath, predecessorEnvironment(), { mode: 0o600 });
    const summary = await prepareFin012StripeDownloadProductionBundle({
      controlRoot: projectRoot,
      candidateRoot,
      predecessorEnvironmentPath: environmentPath,
      outputPath,
      observedAt: "2026-08-23T00:30:00.000Z",
      gitRunner: candidateGit
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.filesWritten, 8);
    assert.equal(summary.databaseEffects, false);
    assert.equal(summary.providerEffects, false);
    assert.equal(summary.paymentEffects, false);
    assert.equal((await readdir(outputPath)).length, 8);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(outputPath, "hosted.env"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(outputPath, "bundle-receipt.json"))).mode & 0o777, 0o400);
    assert.match(await readFile(path.join(outputPath, "hosted.env"), "utf8"), /re_existing_approved/u);
    assert.doesNotMatch(JSON.stringify(summary), /re_existing_approved/u);
    await assert.rejects(
      () => prepareFin012StripeDownloadProductionBundle({
        controlRoot: projectRoot,
        candidateRoot,
        predecessorEnvironmentPath: environmentPath,
        outputPath,
        observedAt: "2026-08-23T00:30:00.000Z",
        gitRunner: candidateGit
      }),
      /EEXIST/u
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
