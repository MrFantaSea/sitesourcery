import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  FIN010_CANDIDATE_COMMIT,
  FIN010_CANDIDATE_TREE,
  FIN010_DATA_CANDIDATE_COMMIT,
  FIN010_DATA_CANDIDATE_TREE,
  FIN010_BACKUP_QUIESCE_PATH,
  FIN010_CADDY_CONFIG_PATH,
  FIN010_EVIDENCE,
  FIN010_HOSTED_ENVIRONMENT_PATH,
  FIN010_INSTALLED_HOSTED_ENVIRONMENT_PATH,
  FIN010_INSTALLED_WORKER_ENVIRONMENT_PATH,
  FIN010_INSTALLED_WRAPPER_PATH,
  FIN010_PREDECESSOR_COMMIT,
  FIN010_PRODUCTION_ROOT,
  FIN010_PUBLICATION_SOCKET,
  FIN010_RELEASE_ROOT,
  FIN010_RUNTIME_DIRECTORY,
  Fin010RuntimeFailure,
  createFin010Caddyfile,
  createFin010ProductionEnvironments,
  createFin010TmpfilesConfiguration,
  createFin010UserUnitSet,
  createFin010Wrapper,
  parseFin010EnvironmentFile,
  prepareFin010ProductionFiles
} from "../fin010-production-runtime.mjs";
import { createPublicationCommandConfiguration } from
  "../../server/hosted/publication-command-transport.mjs";

const candidateEnvironmentUrl = new URL(
  "../hosted.env.example",
  import.meta.url
);

function predecessorEnvironment() {
  return [
    "SITESOURCERY_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:55439/sitesourcery_production",
    "SITESOURCERY_DATABASE_SSL=disable",
    `SITESOURCERY_IDENTITY_PEPPER=${Buffer.alloc(32, 1).toString("base64")}`,
    "SITESOURCERY_IDENTITY_PEPPER_VERSION=production-v1",
    `SITESOURCERY_CONTACT_VAULT_KEY=${Buffer.alloc(32, 2).toString("base64")}`,
    "SITESOURCERY_CONTACT_VAULT_KEY_VERSION=production-v1",
    "SITESOURCERY_LICENSED_BASE_DOMAIN=sitesourcery.me",
    `SITESOURCERY_SPARK_COMPILER_SHA256=${"a".repeat(64)}`,
    "SITESOURCERY_REGISTRATION_MAIL_MODE=production",
    "SITESOURCERY_REGISTRATION_BASE_URL=https://sitesourcery.com/abracadabra/app/",
    "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE=/old/release/resend-mail-transport.mjs",
    "SITESOURCERY_RECOVERY_MAIL_MODE=production",
    "SITESOURCERY_RECOVERY_BASE_URL=https://sitesourcery.com/abracadabra/app/",
    "SITESOURCERY_RECOVERY_TRANSPORT_MODULE=/old/release/resend-mail-transport.mjs",
    "SITESOURCERY_RESEND_API_KEY=re_fixture_secret",
    "SITESOURCERY_RESEND_DOMAIN_ID=fixture-domain-id",
    "SITESOURCERY_STRIPE_MODE=held",
    "SITESOURCERY_STRIPE_SECRET_KEY=sk_live_must_not_cross_the_hold",
    ""
  ].join("\n");
}

async function candidateEnvironment() {
  return readFile(candidateEnvironmentUrl, "utf8");
}

function deterministicRandomBytes() {
  let selected = 7;
  return (length) => {
    const value = Buffer.alloc(length, selected);
    selected += 1;
    return value;
  };
}

test("FIN-010 derives the exact candidate production-held environment without crossing held provider secrets", async () => {
  assert.notEqual(FIN010_CANDIDATE_COMMIT, FIN010_DATA_CANDIDATE_COMMIT);
  assert.notEqual(FIN010_CANDIDATE_TREE, FIN010_DATA_CANDIDATE_TREE);
  const result = createFin010ProductionEnvironments({
    predecessorEnvironmentText: predecessorEnvironment(),
    candidateEnvironmentText: await candidateEnvironment(),
    randomBytes: deterministicRandomBytes()
  });
  const hosted = parseFin010EnvironmentFile(result.hostedText, "Generated hosted environment");
  const worker = parseFin010EnvironmentFile(result.workerText, "Generated worker environment");

  assert.equal(result.summary.candidateCommitSha, FIN010_CANDIDATE_COMMIT);
  assert.equal(result.summary.candidateTreeSha, FIN010_CANDIDATE_TREE);
  assert.equal(result.summary.predecessorCommitSha, FIN010_PREDECESSOR_COMMIT);
  assert.equal(
    FIN010_EVIDENCE.epoch.path,
    "/etc/sitesourcery/final-release-epoch-v2.json"
  );
  assert.equal(
    FIN010_EVIDENCE.originSeal.path,
    "/etc/sitesourcery/origin-seal.json"
  );
  assert.equal(
    FIN010_EVIDENCE.installedReadback.path,
    "/etc/sitesourcery/origin-installed-readback.json"
  );
  assert.equal(result.summary.secretValuesDisclosed, false);
  assert.equal(result.summary.secretDerivedDigestsRecorded, false);
  assert.equal(hosted.get("SITESOURCERY_HOSTED_HOST"), "127.0.0.1");
  assert.equal(hosted.get("SITESOURCERY_HOSTED_PORT"), "8788");
  assert.equal(hosted.get("SITESOURCERY_PUBLICATION_COMMAND_SOCKET"), FIN010_PUBLICATION_SOCKET);
  assert.equal(hosted.get("SITESOURCERY_RELEASE_EPOCH_FILE"), FIN010_EVIDENCE.epoch.path);
  assert.equal(hosted.get("SITESOURCERY_RELEASE_EPOCH_SHA256"), FIN010_EVIDENCE.epoch.sha256);
  assert.equal(hosted.get("SITESOURCERY_ORIGIN_SEAL_FILE_SHA256"), FIN010_EVIDENCE.originSeal.sha256);
  assert.equal(hosted.get("SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"), FIN010_EVIDENCE.installedReadback.sha256);
  assert.equal(hosted.get("SITESOURCERY_DATA_ROOT"), `${FIN010_PRODUCTION_ROOT}/state`);
  assert.equal(hosted.get("SITESOURCERY_STRIPE_MODE"), "held");
  assert.equal(hosted.get("SITESOURCERY_RESEND_WEBHOOK_MODE"), "held");
  assert.equal(hosted.get("SITESOURCERY_TWILIO_INBOUND_EVENT_MODE"), "held");
  assert.equal(hosted.has("SITESOURCERY_STRIPE_SECRET_KEY"), false);
  assert.equal(hosted.has("SITESOURCERY_OFFER_CATALOG_PATH"), false);
  assert.equal(
    hosted.get("SITESOURCERY_REGISTRATION_TRANSPORT_MODULE"),
    `${FIN010_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  );
  assert.equal(
    hosted.get("SITESOURCERY_RECOVERY_TRANSPORT_MODULE"),
    `${FIN010_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  );
  assert.equal(
    hosted.get("SITESOURCERY_HOSTED_PRIVACY_V5_VERSION"),
    "SS-HOSTED-PRIVACY-2026-08-20-V5"
  );
  assert.match(
    hosted.get("SITESOURCERY_IDENTITY_PEPPER_CONFIG"),
    /production-v1/u
  );
  assert.notEqual(
    hosted.get("SITESOURCERY_PUBLICATION_COMMAND_TOKEN"),
    hosted.get("SITESOURCERY_ENGAGEMENT_TOKEN_SECRET")
  );
  assert.equal(worker.get("SITESOURCERY_STRIPE_MODE"), "held");
  assert.equal(worker.get("SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE"), "held");
  assert.equal(worker.get("SITESOURCERY_WORKER_CONFIG").includes('\\"activation\\":\\"held\\"'), true);
  assert.equal(result.hostedText.includes("sk_live_must_not_cross_the_hold"), false);
  assert.equal(result.workerText.includes("sk_live_must_not_cross_the_hold"), false);
});

test("FIN-010 rejects drift in production mail and licensing authority", async () => {
  const candidate = await candidateEnvironment();
  for (const changed of [
    predecessorEnvironment().replace(
      "SITESOURCERY_REGISTRATION_MAIL_MODE=production",
      "SITESOURCERY_REGISTRATION_MAIL_MODE=held"
    ),
    predecessorEnvironment().replace(
      "SITESOURCERY_LICENSED_BASE_DOMAIN=sitesourcery.me",
      "SITESOURCERY_LICENSED_BASE_DOMAIN=example.invalid"
    )
  ]) {
    assert.throws(
      () => createFin010ProductionEnvironments({
        predecessorEnvironmentText: changed,
        candidateEnvironmentText: candidate,
        randomBytes: deterministicRandomBytes()
      }),
      (error) =>
        error instanceof Fin010RuntimeFailure &&
        error.code === "FIN010_ENVIRONMENT_AUTHORITY_INVALID"
    );
  }
});

test("FIN-010 EnvironmentFile parsing rejects duplicates and malformed assignments", () => {
  for (const value of [
    "A=one\nA=two\n",
    "A=\n",
    "not-an-assignment\n"
  ]) {
    assert.throws(
      () => parseFin010EnvironmentFile(value),
      (error) => error instanceof Fin010RuntimeFailure
    );
  }
});

test("FIN-010 writes new secret-bearing environments exclusively at mode 0600", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-fin010-env-"));
  const predecessor = path.join(root, "predecessor.env");
  const candidate = path.join(root, "candidate.env");
  const hosted = path.join(root, "generated", "hosted.env");
  const worker = path.join(root, "generated", "workers.env");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(predecessor, predecessorEnvironment(), { mode: 0o600 });
  await writeFile(candidate, await candidateEnvironment(), { mode: 0o600 });
  const summary = await prepareFin010ProductionFiles({
    predecessorEnvironmentPath: predecessor,
    candidateEnvironmentPath: candidate,
    hostedEnvironmentPath: hosted,
    workerEnvironmentPath: worker,
    randomBytes: deterministicRandomBytes()
  });
  assert.equal(summary.hostedEnvironmentPath, hosted);
  assert.equal(summary.workerEnvironmentPath, worker);
  assert.equal((await stat(hosted)).mode & 0o777, 0o600);
  assert.equal((await stat(worker)).mode & 0o777, 0o600);
  await assert.rejects(
    () => prepareFin010ProductionFiles({
      predecessorEnvironmentPath: predecessor,
      candidateEnvironmentPath: candidate,
      hostedEnvironmentPath: hosted,
      workerEnvironmentPath: worker,
      randomBytes: deterministicRandomBytes()
    }),
    (error) => error?.code === "EEXIST"
  );
});

test("FIN-010 unit and wrapper bytes select only the exact candidate and keep workers held", () => {
  const wrapper = createFin010Wrapper();
  const caddy = createFin010Caddyfile();
  const tmpfiles = createFin010TmpfilesConfiguration();
  const units = createFin010UserUnitSet();
  assert.match(wrapper, new RegExp(FIN010_CANDIDATE_COMMIT, "u"));
  assert.equal(wrapper.includes(FIN010_PREDECESSOR_COMMIT), false);
  assert.match(wrapper, /wait -n "\$api_pid" "\$tenant_pid"/u);
  assert.match(wrapper, /root:simtech:770/u);
  assert.equal(wrapper.includes("/run/user/1000/sitesourcery-production"), false);
  assert.equal(
    tmpfiles,
    `d ${FIN010_RUNTIME_DIRECTORY} 0770 root simtech -\n`
  );
  assert.deepEqual(
    createPublicationCommandConfiguration({
      socketPath: FIN010_PUBLICATION_SOCKET,
      token: Buffer.alloc(32, 9).toString("base64url")
    }),
    {
      socketPath: FIN010_PUBLICATION_SOCKET,
      token: Buffer.alloc(32, 9).toString("base64url"),
      maximumBodyBytes: 16 * 1024 * 1024,
      deadlineMs: 15_000,
      allowedSocketRoot: FIN010_RUNTIME_DIRECTORY
    }
  );
  assert.deepEqual(Object.keys(units).sort(), [
    "sitesourcery-production-static.service",
    "sitesourcery-production-worker.service",
    "sitesourcery-production.service"
  ]);
  assert.match(units["sitesourcery-production.service"], new RegExp(FIN010_CANDIDATE_COMMIT, "u"));
  assert.match(units["sitesourcery-production.service"], /verify-final-release-epoch-v2\.mjs/u);
  assert.match(
    units["sitesourcery-production.service"],
    /^ExecStartPre=\+.*verify-final-release-epoch-v2\.mjs/mu
  );
  assert.match(
    units["sitesourcery-production.service"],
    new RegExp(`^EnvironmentFile=${FIN010_INSTALLED_HOSTED_ENVIRONMENT_PATH}$`, "mu")
  );
  assert.match(
    units["sitesourcery-production.service"],
    new RegExp(`^ExecStart=\\+${FIN010_INSTALLED_WRAPPER_PATH}$`, "mu")
  );
  assert.equal(units["sitesourcery-production.service"].includes("${SITESOURCERY_"), false);
  assert.match(
    units["sitesourcery-production.service"],
    new RegExp(`^ConditionPathExists=!${FIN010_BACKUP_QUIESCE_PATH}$`, "mu")
  );
  assert.match(
    units["sitesourcery-production.service"],
    /^ConditionPathExists=!%t\/sitesourcery-production\/BACKUP_QUIESCE$/mu
  );
  assert.match(
    units["sitesourcery-production.service"],
    /^SuccessExitStatus=143$/mu
  );
  assert.match(
    units["sitesourcery-production.service"],
    new RegExp(`^ReadWritePaths=.* ${FIN010_RUNTIME_DIRECTORY}$`, "mu")
  );
  for (const evidence of Object.values(FIN010_EVIDENCE)) {
    assert.match(units["sitesourcery-production.service"], new RegExp(evidence.path, "u"));
    assert.match(units["sitesourcery-production.service"], new RegExp(evidence.sha256, "u"));
  }
  assert.match(units["sitesourcery-production-worker.service"], /ConditionPathExists=.*WORKERS_APPROVED/u);
  assert.match(units["sitesourcery-production-worker.service"], /ConditionPathExists=!.*WORKERS_HOLD/u);
  assert.match(
    units["sitesourcery-production-worker.service"],
    new RegExp(`^ConditionPathExists=!${FIN010_BACKUP_QUIESCE_PATH}$`, "mu")
  );
  assert.match(
    units["sitesourcery-production-worker.service"],
    /^ConditionPathExists=!%t\/sitesourcery-production\/BACKUP_QUIESCE$/mu
  );
  assert.match(
    units["sitesourcery-production-worker.service"],
    new RegExp(`^ReadWritePaths=.* ${FIN010_RUNTIME_DIRECTORY}$`, "mu")
  );
  assert.match(
    units["sitesourcery-production-worker.service"],
    new RegExp(`^EnvironmentFile=${FIN010_INSTALLED_WORKER_ENVIRONMENT_PATH}$`, "mu")
  );
  assert.equal(
    Object.values(units).some((value) => value.includes(FIN010_PREDECESSOR_COMMIT)),
    false
  );
  assert.equal(FIN010_HOSTED_ENVIRONMENT_PATH.endsWith(FIN010_CANDIDATE_COMMIT), true);
  assert.equal(FIN010_CADDY_CONFIG_PATH.endsWith("/Caddyfile"), true);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8788/u);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8899/u);
  assert.equal(caddy.includes("/opt/sitesourcery/current"), false);
  assert.match(caddy, /not host sitesourcery\.com www\.sitesourcery\.com/u);
});

test("FIN-010 runbook freezes the paired rollback and two-stage Cloudflare cutover", async () => {
  const runbook = await readFile(new URL(
    "../FIN-010-PRODUCTION-CUTOVER-RUNBOOK.md",
    import.meta.url
  ), "utf8");
  const normalized = runbook.replace(/\s+/gu, " ");
  for (const value of [
    FIN010_CANDIDATE_COMMIT,
    FIN010_CANDIDATE_TREE,
    FIN010_RELEASE_ROOT,
    FIN010_PREDECESSOR_COMMIT,
    "jasmine.ns.cloudflare.com",
    "nash.ns.cloudflare.com",
    "211ffa61-e170-444d-a945-04fead19c972",
    "The predecessor must never run against the successor schema",
    "restore the four GitHub Pages A records in Cloudflare",
    "Do not automatically delete anything"
  ]) assert.equal(normalized.includes(value), true, value);
});
