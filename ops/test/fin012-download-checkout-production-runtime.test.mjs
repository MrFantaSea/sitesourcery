import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE,
  FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
  FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE,
  FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_FILE_SHA256,
  FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_DIGEST,
  FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES,
  FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT,
  FIN012_DOWNLOAD_CHECKOUT_ORIGIN_SEAL_SHA256,
  FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
  FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE,
  FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT,
  FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_DIGEST,
  createFin012DownloadCheckoutHostedEnvironment,
  createFin012DownloadCheckoutProductionBundle,
  createFin012DownloadCheckoutUserUnitSet,
  createFin012DownloadCheckoutWrapper,
  prepareFin012DownloadCheckoutProductionBundle
} from "../fin012-download-checkout-production-runtime.mjs";
import { materializeHistoricalCandidate } from "./historical-candidate-fixture.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
let hostedArtifactPromise;
let candidateFixturePromise;

function ensureHostedArtifact() {
  candidateFixturePromise ??= materializeHistoricalCandidate({
    projectRoot,
    commitSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
    treeSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE,
    label: "fin012-download-checkout-candidate"
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

function predecessorEnvironment(overrides = new Map(), extras = []) {
  const values = new Map(
    FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES.map(
      (name, index) => [name, `fixture_${index + 1}`]
    )
  );
  for (const [name, value] of Object.entries({
    SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "'held'",
    SITESOURCERY_ALAKAZAM_MODE: "'held'",
    SITESOURCERY_CREDENTIAL_TOPOLOGY_JSON: "'{\"fixture\":true}'",
    SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE: "'held'",
    SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE: "'held'",
    SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "'held'",
    SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE: "'held'",
    SITESOURCERY_DEPLOYMENT_ENVIRONMENT: "'production'",
    SITESOURCERY_DOWNLOAD_PAYMENT_MODE: "'approved'",
    SITESOURCERY_IDENTITY_PEPPER_CONFIG: "'{\"fixture\":true}'",
    SITESOURCERY_POSTGRES_BUDGET_CONFIG: "'{\"fixture\":true}'",
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `${FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT.replace(
        FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
        FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT
      )}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `${FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT.replace(
        FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
        FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT
      )}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RESEND_WEBHOOK_MODE: "'held'",
    SITESOURCERY_SPARK_COMPILER_SHA256: "a".repeat(64),
    SITESOURCERY_STRIPE_LIVEMODE: "'true'",
    SITESOURCERY_STRIPE_MODE: "'approved_live'",
    SITESOURCERY_STRIPE_SECRET_KEY: "'sk_live_fixture_not_real'",
    SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "'held'",
    SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "'held'",
    SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "'held'",
    SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "'held'"
  })) values.set(name, value);
  for (const [name, value] of overrides) {
    if (value === null) values.delete(name);
    else values.set(name, value);
  }
  return [
    "# exact fixture inventory",
    ...[...values].map(([name, value]) => `${name}=${value}`),
    ...extras,
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
    return FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT;
  }
  if (selected === "rev-parse HEAD^{tree}") {
    return FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE;
  }
  if (
    selected ===
    `rev-parse ${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}^{tree}`
  ) return FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE;
  if (
    selected ===
    `rev-parse ${FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT}^{tree}`
  ) return FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE;
  if (selected.startsWith("rev-parse --git-path ")) {
    return "/private/tmp/sitesourcery-fin012-download-checkout-no-grafts";
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

test("FIN-012 Download Checkout preserves the exact Download-only approved-live environment", () => {
  const result = createFin012DownloadCheckoutHostedEnvironment({
    predecessorEnvironmentText: predecessorEnvironment(),
    evidence: evidence()
  });
  assert.equal(result.nameCount, 122);
  assert.match(result.text, /^SITESOURCERY_STRIPE_MODE='approved_live'$/mu);
  assert.match(result.text, /^SITESOURCERY_DOWNLOAD_PAYMENT_MODE='approved'$/mu);
  assert.match(
    result.text,
    /^SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE='held'$/mu
  );
  assert.match(
    result.text,
    new RegExp(`^SITESOURCERY_RELEASE_EPOCH_FILE=${FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE.epoch}$`, "mu")
  );
  assert.match(
    result.text,
    new RegExp(`${FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT}/server/hosted/resend-mail-transport\\.mjs`, "u")
  );
  assert.doesNotMatch(
    result.text,
    new RegExp(FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT, "u")
  );
  assert.match(result.text, /^SITESOURCERY_STRIPE_SECRET_KEY=/mu);
  assert.equal(
    result.providers.stripe,
    "approved_live_download_only_existing_authority"
  );
  assert.equal(result.providers.twilio, "held_no_secret_loaded");
  assert.equal(result.secretValuesDisclosed, false);
  assert.equal(result.secretDerivedDigestsRecorded, false);
});

test("FIN-012 Download Checkout rejects name, mode, and compiler drift", () => {
  for (const input of [
    predecessorEnvironment(new Map([
      ["SITESOURCERY_DOWNLOAD_PAYMENT_MODE", null]
    ])),
    predecessorEnvironment(new Map(), ["SITESOURCERY_UNREVIEWED_NAME=value"]),
    predecessorEnvironment(new Map([
      ["SITESOURCERY_ALAKAZAM_MODE", "'approved'"]
    ])),
    predecessorEnvironment(new Map([
      ["SITESOURCERY_SPARK_COMPILER_SHA256", "not-a-digest"]
    ]))
  ]) {
    assert.throws(
      () => createFin012DownloadCheckoutHostedEnvironment({
        predecessorEnvironmentText: input,
        evidence: evidence()
      }),
      /FIN-012 Download Checkout authority|Spark compiler digest/u
    );
  }
});

test("FIN-012 Download Checkout wrapper and units select only the repaired successor", () => {
  const combined = [
    createFin012DownloadCheckoutWrapper(),
    ...Object.values(createFin012DownloadCheckoutUserUnitSet({
      evidence: evidence()
    }))
  ].join("\n");
  assert.match(
    combined,
    new RegExp(FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT, "u")
  );
  assert.match(
    combined,
    new RegExp(FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT.replaceAll("/", "\\/"), "u")
  );
  assert.doesNotMatch(
    combined,
    new RegExp(FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT, "u")
  );
  assert.match(combined, /ConditionPathExists=.*RUNTIME_APPROVED/u);
  assert.match(combined, /ConditionPathExists=!\/run\/sitesourcery\/BACKUP_QUIESCE/u);
});

test("FIN-012 Download Checkout production-control files bind the exact graph and no widening", async () => {
  const controlRoot = path.join(
    projectRoot,
    "ops/releases/fin012-download-checkout-production-control"
  );
  const control = JSON.parse(
    await readFile(path.join(controlRoot, "production-control.json"), "utf8")
  );
  const receiptBytes = await readFile(
    path.join(controlRoot, "ci-held-final-receipt.json")
  );
  const document = await readFile(
    path.join(
      controlRoot,
      "FIN-012-DOWNLOAD-CHECKOUT-PRODUCTION-CONTROL.md"
    ),
    "utf8"
  );
  assert.equal(
    control.source.candidateCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT
  );
  assert.equal(
    control.source.heldControlCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT
  );
  assert.equal(
    control.source.predecessorCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT
  );
  assert.equal(control.runtime.predecessorEnvironmentAssignmentCount, 122);
  assert.equal(control.runtime.predecessorEnvironmentSha256Recorded, false);
  assert.equal(control.authority.existingDownloadAuthorityRetained, true);
  assert.equal(control.authority.newProviderMutationAuthorized, false);
  assert.equal(control.authority.newPaymentMutationAuthorized, false);
  assert.equal(control.database.databaseMutationAuthorized, false);
  assert.equal(
    createHash("sha256").update(receiptBytes).digest("hex"),
    FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_FILE_SHA256
  );
  assert.match(document, /exactly one unpaid `\$20`/u);
  assert.match(document, /without entering card\s+data/u);
  assert.match(document, /No secret value or secret-derived digest/u);
});

test("FIN-012 Download Checkout composes the exact code-only successor bundle", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const bundle = await createFin012DownloadCheckoutProductionBundle({
    controlRoot: projectRoot,
    candidateRoot,
    predecessorEnvironmentText: predecessorEnvironment(),
    observedAt: "2026-08-23T18:45:00.000Z",
    gitRunner: candidateGit
  });
  assert.equal(
    bundle.receipt.state,
    "prepared_existing_download_authority_no_install"
  );
  assert.equal(
    bundle.receipt.source.candidateCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT
  );
  assert.equal(
    bundle.receipt.source.heldControlCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT
  );
  assert.equal(
    bundle.receipt.proof.successorInputDigest,
    FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_DIGEST
  );
  assert.equal(
    bundle.receipt.proof.ciFinalReceiptDigest,
    FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_DIGEST
  );
  assert.equal(
    bundle.originSeal.sealSha256,
    FIN012_DOWNLOAD_CHECKOUT_ORIGIN_SEAL_SHA256
  );
  assert.equal(bundle.epoch.state, "verified_held");
  assert.equal(
    bundle.epoch.identity.sourceCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT
  );
  assert.equal(bundle.epoch.identity.migrationCount, 96);
  assert.equal(bundle.receipt.database.migrationRequired, false);
  assert.equal(
    bundle.receipt.authority.existingDownloadAuthorityRetained,
    true
  );
  assert.equal(bundle.receipt.authority.newProviderMutationAuthorized, false);
  assert.equal(bundle.receipt.authority.newPaymentMutationAuthorized, false);
});

test("FIN-012 Download Checkout writes one exclusive no-effect staging bundle", async () => {
  const candidateRoot = await ensureHostedArtifact();
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "ss-fin012-download-checkout-bundle-")
  );
  try {
    const environmentPath = path.join(temporary, "predecessor.env");
    const outputPath = path.join(temporary, "bundle");
    await writeFile(environmentPath, predecessorEnvironment(), {
      mode: 0o600
    });
    const summary = await prepareFin012DownloadCheckoutProductionBundle({
      controlRoot: projectRoot,
      candidateRoot,
      predecessorEnvironmentPath: environmentPath,
      outputPath,
      observedAt: "2026-08-23T18:45:00.000Z",
      gitRunner: candidateGit
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.filesWritten, 8);
    assert.equal(summary.retainedLiveAuthority, "download_only");
    assert.equal(summary.databaseEffects, false);
    assert.equal(summary.providerEffects, false);
    assert.equal(summary.paymentEffects, false);
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
      /sk_live_fixture_not_real/u
    );
    assert.doesNotMatch(JSON.stringify(summary), /sk_live_fixture_not_real/u);
    await assert.rejects(
      () => prepareFin012DownloadCheckoutProductionBundle({
        controlRoot: projectRoot,
        candidateRoot,
        predecessorEnvironmentPath: environmentPath,
        outputPath,
        observedAt: "2026-08-23T18:45:00.000Z",
        gitRunner: candidateGit
      }),
      /EEXIST/u
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
