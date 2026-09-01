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
  FIN015_ACTIVE_EVIDENCE,
  FIN015_CANDIDATE_COMMIT,
  FIN015_CANDIDATE_TREE,
  FIN015_CI_FINAL_RECEIPT_DIGEST,
  FIN015_HELD_CONTROL_COMMIT,
  FIN015_INSTALLED_COMMIT,
  FIN015_INSTALLED_TREE,
  FIN015_ORIGIN_SEAL_SHA256,
  FIN015_PREDECESSOR_ENVIRONMENT_NAMES,
  FIN015_PRODUCTION_CONTROL_COMMIT,
  FIN015_PRODUCTION_CONTROL_TREE,
  FIN015_RELEASE_ROOT,
  FIN015_SUCCESSOR_INPUT_DIGEST,
  Fin015RuntimeFailure,
  createFin015HostedEnvironment,
  createFin015ProductionBundle,
  createFin015UserUnitSet,
  createFin015Wrapper,
  prepareFin015ProductionBundle
} from "../fin015-production-runtime.mjs";
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
    commitSha: FIN015_CANDIDATE_COMMIT,
    treeSha: FIN015_CANDIDATE_TREE,
    label: "fin015-runtime-candidate"
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
  if (candidateFixturePromise) {
    await (await candidateFixturePromise).cleanup();
  }
});

function predecessorEnvironment(extra = []) {
  const values = new Map(
    FIN015_PREDECESSOR_ENVIRONMENT_NAMES.map((name) => [name, "fixture"])
  );
  for (const [name, value] of Object.entries({
    SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "held",
    SITESOURCERY_ALAKAZAM_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "held",
    SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE: "held",
    SITESOURCERY_DATABASE_URL:
      "postgresql://fixture:fixture@127.0.0.1:55439/sitesourcery_production",
    SITESOURCERY_DATABASE_SSL: "disable",
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT: "production",
    SITESOURCERY_DOWNLOAD_PAYMENT_MODE: "approved",
    SITESOURCERY_IDENTITY_PEPPER:
      Buffer.alloc(32, 1).toString("base64"),
    SITESOURCERY_IDENTITY_PEPPER_CONFIG: JSON.stringify(
      JSON.stringify({
        schema: "sitesourcery.identity-pepper-config/v1",
        current: {
          version: "production-v1",
          secretEnvironment: "SITESOURCERY_IDENTITY_PEPPER"
        },
        prior: []
      })
    ),
    SITESOURCERY_ENGAGEMENT_TOKEN_SECRET:
      Buffer.alloc(32, 3).toString("base64"),
    SITESOURCERY_CONTACT_VAULT_KEY:
      Buffer.alloc(32, 2).toString("base64"),
    SITESOURCERY_RESEND_API_KEY: "re_existing_approved",
    SITESOURCERY_RESEND_WEBHOOK_MODE: "held",
    SITESOURCERY_SPARK_COMPILER_SHA256: "a".repeat(64),
    SITESOURCERY_STRIPE_LIVEMODE: "true",
    SITESOURCERY_STRIPE_MODE: "approved_live",
    SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "held",
    SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "held",
    SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "held",
    SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "held",
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      "/old/release/resend-mail-transport.mjs",
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      "/old/release/resend-mail-transport.mjs",
    SITESOURCERY_RELEASE_EPOCH_FILE:
      "/etc/sitesourcery/final-release-epoch-v2.json",
    SITESOURCERY_RELEASE_EPOCH_SHA256: "1".repeat(64),
    SITESOURCERY_ORIGIN_SEAL_FILE:
      "/etc/sitesourcery/origin-seal.json",
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: "2".repeat(64),
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      "/etc/sitesourcery/origin-installed-readback.json",
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
  if (selected === "rev-parse HEAD") return FIN015_CANDIDATE_COMMIT;
  if (selected === "rev-parse HEAD^{tree}") return FIN015_CANDIDATE_TREE;
  if (selected === `rev-parse ${FIN015_CANDIDATE_COMMIT}^{tree}`) {
    return FIN015_CANDIDATE_TREE;
  }
  if (selected === `rev-parse ${FIN015_INSTALLED_COMMIT}^{tree}`) {
    return FIN015_INSTALLED_TREE;
  }
  if (selected.startsWith("rev-parse --git-path ")) {
    return "/private/tmp/sitesourcery-fin015-runtime-no-grafts";
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
  throw new Error(`Unexpected Git fixture call: ${selected}`);
}

test("FIN-015 preserves only approved Download payment authority while adding exact Legal V7 and release evidence", () => {
  const result = createFin015HostedEnvironment({
    predecessorEnvironmentText: predecessorEnvironment(),
    evidence: evidence()
  });
  assert.equal(result.nameCount, 136);
  for (const line of [
    "SITESOURCERY_STRIPE_MODE=approved_live",
    "SITESOURCERY_STRIPE_LIVEMODE=true",
    "SITESOURCERY_DOWNLOAD_PAYMENT_MODE=approved",
    "SITESOURCERY_TWILIO_VOICE_DIAL_MODE=held",
    "SITESOURCERY_ALAKAZAM_MODE=held",
    "SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE=held",
    "SITESOURCERY_HOSTED_PRIVACY_V7_VERSION=SS-HOSTED-PRIVACY-2026-08-31-V7",
    "SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_VERSION=SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
    "SITESOURCERY_HOSTED_LEGAL_V7_AUTHORITY_SHA256=b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
  ]) {
    assert.match(result.text, new RegExp(`^${line}$`, "mu"));
  }
  assert.match(
    result.text,
    new RegExp(
      `^SITESOURCERY_RELEASE_EPOCH_FILE=${FIN015_ACTIVE_EVIDENCE.epoch}$`,
      "mu"
    )
  );
  assert.match(
    result.text,
    new RegExp(
      `^SITESOURCERY_REGISTRATION_TRANSPORT_MODULE=${FIN015_RELEASE_ROOT}/server/hosted/resend-mail-transport\\.mjs$`,
      "mu"
    )
  );
  assert.match(result.text, /^SITESOURCERY_STRIPE_SECRET_KEY=fixture$/mu);
  assert.match(
    result.text,
    /^SITESOURCERY_STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_JSON=fixture$/mu
  );
  assert.doesNotMatch(
    result.text,
    /SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH/u
  );
  assert.equal(
    result.legal.privacyVersion,
    "SS-HOSTED-PRIVACY-2026-08-31-V7"
  );
  assert.equal(result.providers.registrationMail, "production_existing_approved");
  assert.equal(
    result.providers.stripe,
    "approved_live_download_only_existing_authority"
  );
  assert.equal(result.providers.twilio, "held_no_registry_or_secret_loaded");
  assert.equal(result.secretValuesDisclosed, false);
});

test("FIN-015 preserves exact Download authority but refuses Twilio staging, lifted modes, and half-staged Alakazam policy", () => {
  for (const line of [
    "SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH=/etc/forbidden.json",
    "SITESOURCERY_ALAKAZAM_TAX_MODE=automatic"
  ]) {
    assert.throws(
      () =>
        createFin015HostedEnvironment({
          predecessorEnvironmentText: predecessorEnvironment([line]),
          evidence: evidence()
        }),
      (error) =>
        error instanceof Fin015RuntimeFailure
    );
  }
  assert.throws(
    () =>
      createFin015HostedEnvironment({
        predecessorEnvironmentText: predecessorEnvironment().replace(
          "SITESOURCERY_STRIPE_MODE=approved_live",
          "SITESOURCERY_STRIPE_MODE=held"
        ),
        evidence: evidence()
      }),
    /exact FIN-015 runtime authority/u
  );
});

test("FIN-015 units and wrapper select only the candidate and immutable evidence chain", () => {
  const units = createFin015UserUnitSet({ evidence: evidence() });
  const runtime = units["sitesourcery-production.service"];
  const staticUnit = units["sitesourcery-production-static.service"];
  for (const token of [
    FIN015_RELEASE_ROOT,
    FIN015_ACTIVE_EVIDENCE.epoch,
    `--epoch-sha256 ${"4".repeat(64)}`,
    `--origin-seal-sha256 ${"5".repeat(64)}`,
    `--installed-readback-sha256 ${"6".repeat(64)}`
  ]) {
    assert.match(
      `${runtime}\n${staticUnit}`,
      new RegExp(token.replaceAll("/", "\\/"), "u")
    );
  }
  assert.match(runtime, /ConditionPathExists=.*RUNTIME_APPROVED/u);
  assert.match(
    runtime,
    /ConditionPathExists=!\/run\/sitesourcery\/BACKUP_QUIESCE/u
  );
  assert.doesNotMatch(
    `${runtime}\n${staticUnit}`,
    new RegExp(FIN015_INSTALLED_COMMIT, "u")
  );
  assert.match(
    createFin015Wrapper(),
    new RegExp(FIN015_CANDIDATE_COMMIT, "u")
  );
});

test("FIN-015 composes one exact production-held no-install bundle", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const bundle = await createFin015ProductionBundle({
    controlRoot: projectRoot,
    candidateRoot,
    predecessorEnvironmentText: predecessorEnvironment(),
    observedAt: "2026-09-01T12:00:00.000Z",
    gitRunner: candidateGit
  });
  assert.equal(bundle.receipt.state, "prepared_held_no_install");
  assert.equal(
    bundle.receipt.source.candidateCommitSha,
    FIN015_CANDIDATE_COMMIT
  );
  assert.equal(
    bundle.receipt.source.heldControlCommitSha,
    FIN015_HELD_CONTROL_COMMIT
  );
  assert.equal(
    bundle.receipt.source.productionControlCommitSha,
    FIN015_PRODUCTION_CONTROL_COMMIT
  );
  assert.equal(
    bundle.receipt.source.productionControlTreeSha,
    FIN015_PRODUCTION_CONTROL_TREE
  );
  assert.equal(
    bundle.receipt.proof.successorInputDigest,
    FIN015_SUCCESSOR_INPUT_DIGEST
  );
  assert.equal(
    bundle.receipt.proof.ciFinalReceiptDigest,
    FIN015_CI_FINAL_RECEIPT_DIGEST
  );
  assert.equal(bundle.originSeal.sealSha256, FIN015_ORIGIN_SEAL_SHA256);
  assert.equal(bundle.epoch.state, "verified_held");
  assert.equal(
    bundle.epoch.identity.sourceCommitSha,
    FIN015_CANDIDATE_COMMIT
  );
  assert.equal(bundle.epoch.identity.migrationCount, 102);
  assert.equal(bundle.receipt.authority.bundlePreparationAuthorized, true);
  assert.deepEqual(
    Object.values(bundle.receipt.authority).slice(1),
    [false, false, false, false, false, false, false, false]
  );
  for (const entry of Object.values(bundle.evidence)) {
    assert.equal(Buffer.byteLength(entry.text), entry.byteCount);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  }
});

test("FIN-015 writes one exclusive least-privilege staging bundle without secret-derived output", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "ss-fin015-runtime-bundle-")
  );
  try {
    const environmentPath = path.join(temporary, "predecessor.env");
    const outputPath = path.join(temporary, "bundle");
    await writeFile(environmentPath, predecessorEnvironment(), {
      mode: 0o600
    });
    const summary = await prepareFin015ProductionBundle({
      controlRoot: projectRoot,
      candidateRoot,
      predecessorEnvironmentPath: environmentPath,
      outputPath,
      observedAt: "2026-09-01T12:00:00.000Z",
      gitRunner: candidateGit
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.filesWritten, 8);
    assert.equal(summary.secretValuesDisclosed, false);
    assert.equal(summary.secretDerivedDigestsRecorded, false);
    assert.equal(summary.databaseEffects, false);
    assert.equal(summary.installEffects, false);
    assert.equal((await readdir(outputPath)).length, 8);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(path.join(outputPath, "hosted.env"))).mode & 0o777,
      0o600
    );
    assert.equal(
      (await stat(path.join(outputPath, "bundle-receipt.json"))).mode & 0o777,
      0o400
    );
    assert.match(
      await readFile(path.join(outputPath, "hosted.env"), "utf8"),
      /re_existing_approved/u
    );
    assert.doesNotMatch(JSON.stringify(summary), /re_existing_approved/u);
    await assert.rejects(
      () =>
        prepareFin015ProductionBundle({
          controlRoot: projectRoot,
          candidateRoot,
          predecessorEnvironmentPath: environmentPath,
          outputPath,
          observedAt: "2026-09-01T12:00:00.000Z",
          gitRunner: candidateGit
        }),
      /EEXIST/u
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
