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
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHostedArtifact
} from "../../scripts/build-hosted.mjs";

import {
  FIN012_ACTIVE_EVIDENCE,
  FIN012_CANDIDATE_COMMIT,
  FIN012_CANDIDATE_TREE,
  FIN012_CI_FINAL_RECEIPT_DIGEST,
  FIN012_HELD_CONTROL_COMMIT,
  FIN012_ORIGIN_SEAL_SHA256,
  FIN012_PREDECESSOR_COMMIT,
  FIN012_PREDECESSOR_TREE,
  FIN012_RELEASE_ROOT,
  FIN012_SUCCESSOR_INPUT_DIGEST,
  Fin012RuntimeFailure,
  createFin012HostedEnvironment,
  createFin012ProductionBundle,
  createFin012UserUnitSet,
  createFin012Wrapper,
  prepareFin012ProductionBundle
} from "../fin012-production-runtime.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
let hostedArtifactPromise;

function ensureHostedArtifact() {
  hostedArtifactPromise ??= buildHostedArtifact({
    root: projectRoot,
    output: path.join(projectRoot, "_hosted")
  });
  return hostedArtifactPromise;
}

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
  if (selected === "rev-parse HEAD") return FIN012_CANDIDATE_COMMIT;
  if (selected === "rev-parse HEAD^{tree}") return FIN012_CANDIDATE_TREE;
  if (selected === `rev-parse ${FIN012_CANDIDATE_COMMIT}^{tree}`) {
    return FIN012_CANDIDATE_TREE;
  }
  if (selected === `rev-parse ${FIN012_PREDECESSOR_COMMIT}^{tree}`) {
    return FIN012_PREDECESSOR_TREE;
  }
  if (selected.startsWith("rev-parse --git-path ")) {
    return "/private/tmp/sitesourcery-fin012-no-grafts";
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

test("FIN-012 keeps every unapproved provider purpose held while rebinding only release evidence", () => {
  const result = createFin012HostedEnvironment({
    predecessorEnvironmentText: predecessorEnvironment(),
    evidence: evidence()
  });
  assert.match(result.text, /^SITESOURCERY_STRIPE_MODE=held$/mu);
  assert.match(result.text, /^SITESOURCERY_TWILIO_VOICE_DIAL_MODE=held$/mu);
  assert.match(
    result.text,
    new RegExp(`^SITESOURCERY_RELEASE_EPOCH_FILE=${FIN012_ACTIVE_EVIDENCE.epoch}$`, "mu")
  );
  assert.match(
    result.text,
    new RegExp(`^SITESOURCERY_REGISTRATION_TRANSPORT_MODULE=${FIN012_RELEASE_ROOT}/server/hosted/resend-mail-transport\\.mjs$`, "mu")
  );
  assert.doesNotMatch(result.text, /SITESOURCERY_STRIPE_SECRET_KEY/u);
  assert.equal(result.providers.registrationMail, "production_existing_approved");
  assert.equal(result.providers.stripe, "held_no_secret_loaded");
  assert.equal(result.secretValuesDisclosed, false);
});

test("FIN-012 refuses provider secrets or a lifted mode in the inherited environment", () => {
  for (const line of [
    "SITESOURCERY_STRIPE_SECRET_KEY=sk_live_forbidden",
    "SITESOURCERY_TWILIO_ACCOUNT_SID=AC_forbidden"
  ]) {
    assert.throws(
      () => createFin012HostedEnvironment({
        predecessorEnvironmentText: predecessorEnvironment([line]),
        evidence: evidence()
      }),
      (error) =>
        error instanceof Fin012RuntimeFailure &&
        error.code === "FIN012_HELD_PROVIDER_SECRET_PRESENT"
    );
  }
  assert.throws(
    () => createFin012HostedEnvironment({
      predecessorEnvironmentText: predecessorEnvironment().replace(
        "SITESOURCERY_STRIPE_MODE=held",
        "SITESOURCERY_STRIPE_MODE=live"
      ),
      evidence: evidence()
    }),
    /exact FIN-012 authority/u
  );
});

test("FIN-012 units select only the exact candidate and exact root-owned evidence chain", () => {
  const units = createFin012UserUnitSet({ evidence: evidence() });
  const runtime = units["sitesourcery-production.service"];
  const staticUnit = units["sitesourcery-production-static.service"];
  for (const token of [
    FIN012_RELEASE_ROOT,
    FIN012_ACTIVE_EVIDENCE.epoch,
    `--epoch-sha256 ${"4".repeat(64)}`,
    `--origin-seal-sha256 ${"5".repeat(64)}`,
    `--installed-readback-sha256 ${"6".repeat(64)}`,
    "SITESOURCERY_STRIPE_MODE"
  ]) {
    if (token === "SITESOURCERY_STRIPE_MODE") assert.doesNotMatch(runtime, new RegExp(token, "u"));
    else assert.match(`${runtime}\n${staticUnit}`, new RegExp(token.replaceAll("/", "\\/"), "u"));
  }
  assert.match(runtime, /ConditionPathExists=.*RUNTIME_APPROVED/u);
  assert.match(runtime, /ConditionPathExists=!\/run\/sitesourcery\/BACKUP_QUIESCE/u);
  assert.doesNotMatch(`${runtime}\n${staticUnit}`, new RegExp(FIN012_PREDECESSOR_COMMIT, "u"));
  assert.match(createFin012Wrapper(), new RegExp(FIN012_CANDIDATE_COMMIT, "u"));
});

test("FIN-012 composes one exact held production bundle from the protected candidate and CI receipt", async () => {
  await ensureHostedArtifact();
  const bundle = await createFin012ProductionBundle({
    controlRoot: projectRoot,
    candidateRoot: projectRoot,
    predecessorEnvironmentText: predecessorEnvironment(),
    observedAt: "2026-08-22T20:00:00.000Z",
    gitRunner: candidateGit
  });
  assert.equal(bundle.receipt.state, "prepared_held_no_install");
  assert.equal(bundle.receipt.source.candidateCommitSha, FIN012_CANDIDATE_COMMIT);
  assert.equal(bundle.receipt.source.heldControlCommitSha, FIN012_HELD_CONTROL_COMMIT);
  assert.equal(bundle.receipt.proof.successorInputDigest, FIN012_SUCCESSOR_INPUT_DIGEST);
  assert.equal(bundle.receipt.proof.ciFinalReceiptDigest, FIN012_CI_FINAL_RECEIPT_DIGEST);
  assert.equal(bundle.originSeal.sealSha256, FIN012_ORIGIN_SEAL_SHA256);
  assert.equal(bundle.epoch.state, "verified_held");
  assert.equal(bundle.epoch.identity.sourceCommitSha, FIN012_CANDIDATE_COMMIT);
  assert.equal(bundle.epoch.identity.migrationCount, 96);
  assert.deepEqual(Object.values(bundle.receipt.authority), [
    false, false, false, false, false, false, false
  ]);
  for (const entry of Object.values(bundle.evidence)) {
    assert.equal(Buffer.byteLength(entry.text), entry.byteCount);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
});

test("FIN-012 writes one exclusive least-privilege staging bundle without secret-derived output", async () => {
  await ensureHostedArtifact();
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ss-fin012-bundle-"));
  try {
    const environmentPath = path.join(temporary, "predecessor.env");
    const outputPath = path.join(temporary, "bundle");
    await writeFile(environmentPath, predecessorEnvironment(), { mode: 0o600 });
    const summary = await prepareFin012ProductionBundle({
      controlRoot: projectRoot,
      candidateRoot: projectRoot,
      predecessorEnvironmentPath: environmentPath,
      outputPath,
      observedAt: "2026-08-22T20:00:00.000Z",
      gitRunner: candidateGit
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.filesWritten, 8);
    assert.equal(summary.secretValuesDisclosed, false);
    assert.equal(summary.secretDerivedDigestsRecorded, false);
    assert.equal((await readdir(outputPath)).length, 8);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(outputPath, "hosted.env"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(outputPath, "bundle-receipt.json"))).mode & 0o777, 0o400);
    assert.match(await readFile(path.join(outputPath, "hosted.env"), "utf8"), /re_existing_approved/u);
    assert.doesNotMatch(JSON.stringify(summary), /re_existing_approved/u);
    await assert.rejects(
      () => prepareFin012ProductionBundle({
        controlRoot: projectRoot,
        candidateRoot: projectRoot,
        predecessorEnvironmentPath: environmentPath,
        outputPath,
        observedAt: "2026-08-22T20:00:00.000Z",
        gitRunner: candidateGit
      }),
      /EEXIST/u
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
