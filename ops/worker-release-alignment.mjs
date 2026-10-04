#!/usr/bin/env node
// Prepare only: no service control, database connection, or provider effect.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIN010_CANDIDATE_COMMIT, FIN010_PRODUCTION_ROOT,
  createFin010UserUnitSet, parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";
import {
  WORKER_PURPOSES, createWorkerConfiguration
} from "../server/hosted/worker-config.mjs";
import {
  postgresBudgetConfigurationFromEnvironment
} from "../server/hosted/postgres-budget-config.mjs";

export const WORKER_ALIGNMENT_RELEASE =
  "1126f5bf4993887e4a41571e9671e2fa20e1f136";
export const WORKER_ALIGNMENT_ENVIRONMENT =
  `/etc/sitesourcery/workers.env.${WORKER_ALIGNMENT_RELEASE}.alignment-v1`;
export const WORKER_ALIGNMENT_APPROVAL = "/etc/sitesourcery/WORKERS_APPROVED";
export const WORKER_SHARED_NAMES = Object.freeze([
  "SITESOURCERY_POSTGRES_BUDGET_CONFIG", "SITESOURCERY_DATABASE_URL",
  "SITESOURCERY_DATABASE_SSL", "SITESOURCERY_PUBLICATION_COMMAND_SOCKET",
  "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
  "SITESOURCERY_PUBLICATION_COMMAND_MAX_BODY_BYTES",
  "SITESOURCERY_PUBLICATION_COMMAND_DEADLINE_MS", "SITESOURCERY_DATA_ROOT",
  "SITESOURCERY_EXPORT_ROOT", "SITESOURCERY_LICENSED_BASE_DOMAIN",
  "SITESOURCERY_SPARK_COMPILER_SHA256"
]);
const HELD_MODES = Object.freeze([
  "SITESOURCERY_EXPORT_WORKER_MODE", "SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE",
  "SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MODE", "SITESOURCERY_TWILIO_READBACK_MODE",
  "SITESOURCERY_RESPONDER_RETENTION_WORKER_MODE", "SITESOURCERY_PROJECT_LIFECYCLE_WORKER_MODE",
  "SITESOURCERY_DOMAIN_LIFECYCLE_WORKER_MODE", "SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE",
  "SITESOURCERY_CARE_LIFECYCLE_WORKER_MODE", "SITESOURCERY_NOTIFICATION_MAIL_PRIVATE_RENDERER_MODE",
  "SITESOURCERY_STRIPE_MODE", "SITESOURCERY_ALAKAZAM_MODE",
  "SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE", "SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE"
]);
const BOUNDED_OPTIONS = Object.freeze([
  "SITESOURCERY_PROVIDER_RECONCILIATION_MAXIMUM_READBACKS_PER_CYCLE",
  "SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DISCOVERIES_PER_CYCLE",
  "SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DESTRUCTIONS_PER_CYCLE",
  "SITESOURCERY_RESPONDER_RETENTION_LEASE_SECONDS",
  ...["PROJECT", "DOMAIN", "CARE"].flatMap((purpose) => [
    `SITESOURCERY_${purpose}_LIFECYCLE_WORKER_BATCH_LIMIT`,
    `SITESOURCERY_${purpose}_LIFECYCLE_WORKER_LEASE_SECONDS`
  ])
]);
function requireValue(ok, code) {
  if (!ok) { const error = new Error(code); error.code = code; throw error; }
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function prepareWorkerAlignment({ hostedText, previousWorkerText, previousUnitText }) {
  const old = parseFin010EnvironmentFile(previousWorkerText);
  const hosted = parseFin010EnvironmentFile(hostedText);
  const expected = [...WORKER_SHARED_NAMES, ...HELD_MODES, ...BOUNDED_OPTIONS,
    "SITESOURCERY_WORKER_CONFIG"].sort();
  requireValue(same([...old.keys()].sort(), expected), "WORKER_PREDECESSOR_ENVIRONMENT_DRIFT");
  for (const name of expected) readFin010EnvironmentValue(old, name);
  for (const name of HELD_MODES) {
    requireValue(readFin010EnvironmentValue(old, name) === "held", "WORKER_PREDECESSOR_NOT_HELD");
  }
  const previous = JSON.parse(readFin010EnvironmentValue(old, "SITESOURCERY_WORKER_CONFIG"));
  requireValue(previous.activation === "held" &&
    previous.approvalPath === `${FIN010_PRODUCTION_ROOT}/run/WORKERS_APPROVED` &&
    same(previous.purposes, WORKER_PURPOSES.filter((p) => p !== "alakazam-publication")),
  "WORKER_PREDECESSOR_CONFIGURATION_DRIFT");
  // Validate every other field with the real parser after correcting only the
  // known path mismatch. Do not weaken the runtime parser to accept old paths.
  createWorkerConfiguration({ configurationJson: JSON.stringify({
    ...previous, approvalPath: WORKER_ALIGNMENT_APPROVAL
  }) });
  const configuration = createWorkerConfiguration({ configurationJson: JSON.stringify({
    ...previous, approvalPath: WORKER_ALIGNMENT_APPROVAL, purposes: [...WORKER_PURPOSES]
  }) }).configuration;
  const output = new Map(old);
  output.set("SITESOURCERY_WORKER_CONFIG", `'${JSON.stringify(configuration)}'`);
  for (const name of WORKER_SHARED_NAMES) {
    // Copy only the reviewed shared inputs from the CURRENT API. In particular,
    // do not reuse an obsolete publication token or copy API identity/provider keys.
    readFin010EnvironmentValue(hosted, name);
    output.set(name, hosted.get(name));
  }
  output.set("SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER_MODE", "held");
  output.set("SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER_BATCH_LIMIT", "10");
  output.set("SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER_LEASE_SECONDS", "120");
  const decoded = Object.fromEntries([...output.keys()].map((name) =>
    [name, readFin010EnvironmentValue(output, name)]));
  const budget = postgresBudgetConfigurationFromEnvironment(decoded);
  const predecessorUnit = createFin010UserUnitSet()["sitesourcery-production-worker.service"];
  requireValue(previousUnitText === predecessorUnit, "WORKER_PREDECESSOR_UNIT_DRIFT");
  const unitText = predecessorUnit
    .replace("FIN-010 exact production workers", "current-release production workers")
    .replaceAll(FIN010_CANDIDATE_COMMIT, WORKER_ALIGNMENT_RELEASE)
    .replace(`EnvironmentFile=/etc/sitesourcery/workers.env.${WORKER_ALIGNMENT_RELEASE}`,
      `EnvironmentFile=${WORKER_ALIGNMENT_ENVIRONMENT}`)
    .replace(`ConditionPathExists=${FIN010_PRODUCTION_ROOT}/run/WORKERS_APPROVED`,
      `ConditionPathExists=${WORKER_ALIGNMENT_APPROVAL}\nConditionPathExists=!/etc/sitesourcery/WORKERS_HOLD`);
  return {
    environmentText: [
      "# Current-release worker alignment; all purposes held.",
      "# Private root:service-group0640. Never print, commit, or hash this file.",
      ...[...output.keys()].sort().map((name) => `${name}=${output.get(name)}`), ""
    ].join("\n"),
    unitText,
    summary: {
      schema: "sitesourcery.worker-release-alignment/v1",
      releaseCommit: WORKER_ALIGNMENT_RELEASE,
      predecessorCommit: FIN010_CANDIDATE_COMMIT,
      environmentPath: WORKER_ALIGNMENT_ENVIRONMENT,
      configuration,
      environmentNames: [...output.keys()].sort(),
      copiedApiNames: WORKER_SHARED_NAMES,
      pool: budget.readiness.pool,
      purposeStates: WORKER_PURPOSES.map((purpose) => ({
        purpose, configured: true, activation: "held", liveDeliveryVerified: false
      })),
      workerStartAuthorized: false, providerEffectsAuthorized: false,
      databaseMutationAuthorized: false, publicReleaseChanged: false
    }
  };
}

async function main() {
  const [command, outputRoot, ...extra] = process.argv.slice(2);
  requireValue(command === "prepare" && path.isAbsolute(outputRoot ?? "") &&
    extra.length === 0, "WORKER_ALIGNMENT_ARGUMENTS_INVALID");
  const [hostedText, previousWorkerText, previousUnitText] = await Promise.all([
    readFile(`/etc/sitesourcery/hosted.env.${WORKER_ALIGNMENT_RELEASE}`, "utf8"),
    readFile(`/etc/sitesourcery/workers.env.${FIN010_CANDIDATE_COMMIT}`, "utf8"),
    readFile("/home/simtech/.config/systemd/user/sitesourcery-production-worker.service", "utf8")
  ]);
  const result = prepareWorkerAlignment({ hostedText, previousWorkerText, previousUnitText });
  // Exclusive directory and files: inspect partial work rather than overwrite/retry.
  await mkdir(outputRoot, { mode: 0o700 });
  for (const [name, content] of Object.entries({
    "workers.env": result.environmentText,
    "sitesourcery-production-worker.service": result.unitText,
    "summary.json": `${JSON.stringify(result.summary, null, 2)}\n`
  })) await writeFile(path.join(outputRoot, name), content, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ event: "worker-alignment.failed",
      code: error?.code ?? "WORKER_ALIGNMENT_FAILED" })}\n`);
    process.exitCode = 1;
  });
}
