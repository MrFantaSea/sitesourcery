#!/usr/bin/env node

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalJson } from "./immutable-evidence.mjs";

export const FIN010_RUNTIME_SCHEMA =
  "sitesourcery.fin010-production-runtime/v1";
export const FIN010_CANDIDATE_COMMIT =
  "e8862278eb66e87d3536b4e084dc9647c996d993";
export const FIN010_CANDIDATE_TREE =
  "ac53f6a59feb9ab7b6e05cb8e03d9c8bcc810eb2";
export const FIN010_CONTROL_COMMIT =
  "b05fcfb624f49265190c66b8d8941e33c42e35bb";
// The data epoch was protected-upgraded from the earlier accepted runtime.
// Keep that historical receipt identity separate from the final runtime
// candidate so a runtime-only correction cannot rewrite completed DB proof.
export const FIN010_DATA_CANDIDATE_COMMIT =
  "26b07202d91000b9a7ae0de36471c7979f9482a1";
export const FIN010_DATA_CANDIDATE_TREE =
  "00f648e39931a3e62445bc6c1d441087c69a8136";
export const FIN010_PREDECESSOR_COMMIT =
  "84aca6b757a806b428ae0cce8115c12dcc6486cd";
export const FIN010_PRODUCTION_ROOT =
  "/home/simtech/sitesourcery-production";
export const FIN010_RELEASE_ROOT =
  `${FIN010_PRODUCTION_ROOT}/releases/${FIN010_CANDIDATE_COMMIT}`;
export const FIN010_NODE =
  `${FIN010_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN010_HOSTED_ENVIRONMENT_PATH =
  `${FIN010_PRODUCTION_ROOT}/run/hosted.env.${FIN010_CANDIDATE_COMMIT}`;
export const FIN010_WORKER_ENVIRONMENT_PATH =
  `${FIN010_PRODUCTION_ROOT}/run/workers.env.${FIN010_CANDIDATE_COMMIT}`;
export const FIN010_WRAPPER_PATH =
  `${FIN010_PRODUCTION_ROOT}/run/api-and-tenant.${FIN010_CANDIDATE_COMMIT}.sh`;
export const FIN010_INSTALLED_HOSTED_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN010_CANDIDATE_COMMIT}`;
export const FIN010_INSTALLED_WORKER_ENVIRONMENT_PATH =
  `/etc/sitesourcery/workers.env.${FIN010_CANDIDATE_COMMIT}`;
export const FIN010_INSTALLED_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN010_CANDIDATE_COMMIT}.sh`;
export const FIN010_CADDY_CONFIG_PATH =
  "/home/simtech/.config/sitesourcery-cloudflare/Caddyfile";
export const FIN010_RUNTIME_DIRECTORY = "/run/sitesourcery";
export const FIN010_PUBLICATION_SOCKET =
  `${FIN010_RUNTIME_DIRECTORY}/publication-command-v1.sock`;
export const FIN010_BACKUP_QUIESCE_PATH =
  `${FIN010_RUNTIME_DIRECTORY}/BACKUP_QUIESCE`;
export const FIN010_LEGACY_REDIRECTS = Object.freeze({
  "/about.html": "/about/",
  "/alacazam/index.html": "/alakazam/",
  "/automation.html": "/hive/",
  "/contact.html": "/contact/",
  "/faq.html": "/faq/",
  "/how-it-works.html": "/custom/process/",
  "/pricing.html": "/custom/scope/",
  "/privacy.html": "/legal/privacy/",
  "/terms.html": "/legal/website-terms/",
  "/thanks.html": "/contact/",
  "/the-difference.html": "/about/#the-difference",
  "/the-meter.html": "/custom/process/#scope",
  "/the-moat.html": "/about/#the-difference",
  "/the-responder.html": "/responder/"
});

export const FIN010_EVIDENCE = Object.freeze({
  epoch: Object.freeze({
    path: "/etc/sitesourcery/final-release-epoch-v2.json",
    sha256:
      "802915b31a81fbf0ff436def90eeaa05e49f7952b2221ee3ea30d1a5129b52c6"
  }),
  originSeal: Object.freeze({
    path: "/etc/sitesourcery/origin-seal.json",
    sha256:
      "155acdafc854b1966bc42fe2e9633bd85abb55665e5e38eb68800d23114edace"
  }),
  installedReadback: Object.freeze({
    path: "/etc/sitesourcery/origin-installed-readback.json",
    sha256:
      "f09f30fe5539d9709e6db862e2e5270203f3159da323908c8b1ef8468ccd18a6"
  })
});

const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
// systemd EnvironmentFile accepts any unquoted value without whitespace,
// quotes, or backslashes. Production database URLs may legitimately contain
// URL-safe punctuation such as "=" or "#", so do not narrow this parser to
// the subset used by the fixtures.
const SAFE_VALUE = /^[^\s'"\\]+$/u;
const PRODUCTION_ACCOUNT_URL =
  "https://sitesourcery.com/abracadabra/app/";

const CANDIDATE_DEFAULT_NAMES = Object.freeze([
  "SITESOURCERY_HOSTED_HOST",
  "SITESOURCERY_HOSTED_PORT",
  "SITESOURCERY_PUBLICATION_COMMAND_MAX_BODY_BYTES",
  "SITESOURCERY_PUBLICATION_COMMAND_DEADLINE_MS",
  "SITESOURCERY_MAX_JSON_BODY_BYTES",
  "SITESOURCERY_MAX_WEBHOOK_BODY_BYTES",
  "SITESOURCERY_MAX_CONCURRENT_REQUESTS",
  "SITESOURCERY_REQUEST_DEADLINE_MS",
  "SITESOURCERY_IDENTITY_SUBJECT_ATTEMPTS",
  "SITESOURCERY_IDENTITY_SUBJECT_WINDOW_MS",
  "SITESOURCERY_IDENTITY_SUBJECT_BLOCK_MS",
  "SITESOURCERY_IDENTITY_IP_ATTEMPTS",
  "SITESOURCERY_IDENTITY_IP_WINDOW_MS",
  "SITESOURCERY_IDENTITY_IP_BLOCK_MS",
  "SITESOURCERY_IDENTITY_GLOBAL_ATTEMPTS",
  "SITESOURCERY_IDENTITY_GLOBAL_WINDOW_MS",
  "SITESOURCERY_IDENTITY_GLOBAL_BLOCK_MS",
  "SITESOURCERY_PROJECT_WRITE_ATTEMPTS",
  "SITESOURCERY_PROJECT_WRITE_WINDOW_MS",
  "SITESOURCERY_COMPILE_ATTEMPTS",
  "SITESOURCERY_COMPILE_WINDOW_MS",
  "SITESOURCERY_POSTGRES_BUDGET_CONFIG",
  "SITESOURCERY_RESEND_WEBHOOK_MODE",
  "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE",
  "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE",
  "SITESOURCERY_TWILIO_VOICE_DIAL_MODE",
  "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE",
  "SITESOURCERY_STRIPE_MODE"
]);

const PREDECESSOR_REQUIRED_NAMES = Object.freeze([
  "SITESOURCERY_DATABASE_URL",
  "SITESOURCERY_DATABASE_SSL",
  "SITESOURCERY_IDENTITY_PEPPER",
  "SITESOURCERY_IDENTITY_PEPPER_VERSION",
  "SITESOURCERY_CONTACT_VAULT_KEY",
  "SITESOURCERY_CONTACT_VAULT_KEY_VERSION",
  "SITESOURCERY_LICENSED_BASE_DOMAIN",
  "SITESOURCERY_SPARK_COMPILER_SHA256",
  "SITESOURCERY_REGISTRATION_MAIL_MODE",
  "SITESOURCERY_REGISTRATION_BASE_URL",
  "SITESOURCERY_RECOVERY_MAIL_MODE",
  "SITESOURCERY_RECOVERY_BASE_URL",
  "SITESOURCERY_RESEND_API_KEY",
  "SITESOURCERY_RESEND_DOMAIN_ID"
]);

const HOSTED_SECRET_NAMES = Object.freeze([
  "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
  "SITESOURCERY_DATABASE_URL",
  "SITESOURCERY_IDENTITY_PEPPER",
  "SITESOURCERY_ENGAGEMENT_TOKEN_SECRET",
  "SITESOURCERY_CONTACT_VAULT_KEY",
  "SITESOURCERY_RESEND_API_KEY"
]);

export class Fin010RuntimeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin010RuntimeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin010RuntimeFailure(code, message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function raw(map, name, label) {
  const value = map.get(name);
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "FIN010_ENVIRONMENT_INCOMPLETE",
      `${label} is missing required environment name ${name}.`
    );
  }
  return value;
}

function decodeEnvironmentValue(value, name) {
  if (SAFE_VALUE.test(value)) return value;
  if (
    value.length >= 2 &&
    value.startsWith("'") &&
    value.endsWith("'") &&
    !value.slice(1, -1).includes("'")
  ) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string" && !/[\r\n\0]/u.test(parsed)) {
        return parsed;
      }
    } catch {
      // Use the common fail-closed path below.
    }
  }
  fail(
    "FIN010_ENVIRONMENT_VALUE_INVALID",
    `${name} uses an unsupported EnvironmentFile value form.`
  );
}

export function readFin010EnvironmentValue(map, name, label = "EnvironmentFile") {
  return decodeEnvironmentValue(raw(map, name, label), name);
}

function exactDecoded(map, name, expected, label) {
  const value = decodeEnvironmentValue(raw(map, name, label), name);
  if (value !== expected) {
    fail(
      "FIN010_ENVIRONMENT_AUTHORITY_INVALID",
      `${name} does not match the exact FIN-010 production authority.`
    );
  }
  return value;
}

function quoted(value) {
  if (typeof value !== "string" || /[\r\n\0]/u.test(value)) {
    fail(
      "FIN010_ENVIRONMENT_VALUE_INVALID",
      "A generated environment value is invalid."
    );
  }
  return JSON.stringify(value);
}

function legalNames(candidate) {
  return [...candidate.keys()].filter((name) =>
    /^SITESOURCERY_HOSTED_(?:PRIVACY|WEBSITE_TERMS)_V[345]_/u.test(name) ||
    /^SITESOURCERY_HOSTED_LEGAL_V[345]_AUTHORITY_SHA256$/u.test(name)
  ).sort();
}

export function parseFin010EnvironmentFile(text, label = "EnvironmentFile") {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) {
    fail(
      "FIN010_ENVIRONMENT_INVALID",
      `${label} is missing or exceeds the one-MiB bound.`
    );
  }
  const values = new Map();
  for (const [index, original] of text.split(/\r?\n/u).entries()) {
    const line = original.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      fail(
        "FIN010_ENVIRONMENT_INVALID",
        `${label} line ${index + 1} is not an assignment.`
      );
    }
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!ENVIRONMENT_NAME.test(name) || values.has(name) || value.length === 0) {
      fail(
        "FIN010_ENVIRONMENT_INVALID",
        `${label} line ${index + 1} is invalid or duplicated.`
      );
    }
    values.set(name, value);
  }
  return values;
}

function environmentText(assignments, heading) {
  const names = [...assignments.keys()].sort();
  return [
    `# ${heading}`,
    "# Root/user-owned mode 0600. Never print, commit, or hash this file.",
    ...names.map((name) => `${name}=${assignments.get(name)}`),
    ""
  ].join("\n");
}

function validateSourceEnvironment(predecessor, candidate) {
  for (const name of PREDECESSOR_REQUIRED_NAMES) {
    raw(predecessor, name, "Predecessor production environment");
  }
  for (const name of CANDIDATE_DEFAULT_NAMES) {
    raw(candidate, name, "Candidate environment example");
  }
  exactDecoded(candidate, "SITESOURCERY_HOSTED_HOST", "127.0.0.1", "Candidate environment example");
  exactDecoded(candidate, "SITESOURCERY_HOSTED_PORT", "8788", "Candidate environment example");
  for (const name of [
    "SITESOURCERY_RESEND_WEBHOOK_MODE",
    "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE",
    "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE",
    "SITESOURCERY_TWILIO_VOICE_DIAL_MODE",
    "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE",
    "SITESOURCERY_STRIPE_MODE"
  ]) exactDecoded(candidate, name, "held", "Candidate environment example");
  exactDecoded(predecessor, "SITESOURCERY_REGISTRATION_MAIL_MODE", "production", "Predecessor production environment");
  exactDecoded(predecessor, "SITESOURCERY_RECOVERY_MAIL_MODE", "production", "Predecessor production environment");
  exactDecoded(predecessor, "SITESOURCERY_REGISTRATION_BASE_URL", PRODUCTION_ACCOUNT_URL, "Predecessor production environment");
  exactDecoded(predecessor, "SITESOURCERY_RECOVERY_BASE_URL", PRODUCTION_ACCOUNT_URL, "Predecessor production environment");
  exactDecoded(predecessor, "SITESOURCERY_LICENSED_BASE_DOMAIN", "sitesourcery.me", "Predecessor production environment");
  const version = decodeEnvironmentValue(
    raw(predecessor, "SITESOURCERY_IDENTITY_PEPPER_VERSION", "Predecessor production environment"),
    "SITESOURCERY_IDENTITY_PEPPER_VERSION"
  );
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/u.test(version)) {
    fail(
      "FIN010_IDENTITY_VERSION_INVALID",
      "The predecessor identity-pepper version is invalid."
    );
  }
  const compiler = decodeEnvironmentValue(
    raw(predecessor, "SITESOURCERY_SPARK_COMPILER_SHA256", "Predecessor production environment"),
    "SITESOURCERY_SPARK_COMPILER_SHA256"
  );
  if (!SHA256.test(compiler)) {
    fail(
      "FIN010_COMPILER_AUTHORITY_INVALID",
      "The reviewed Spark compiler digest is invalid."
    );
  }
  if (legalNames(candidate).length !== 39) {
    fail(
      "FIN010_LEGAL_AUTHORITY_INCOMPLETE",
      "Candidate environment must contain the exact 39 Legal V3/V4/V5 assignments."
    );
  }
  return version;
}

function randomSecret(randomBytes, encoding) {
  const value = randomBytes(32);
  if (!Buffer.isBuffer(value) || value.byteLength !== 32) {
    fail(
      "FIN010_RANDOM_SOURCE_INVALID",
      "The FIN-010 random source must return exactly 32 bytes."
    );
  }
  return value.toString(encoding);
}

export function createFin010ProductionEnvironments({
  predecessorEnvironmentText,
  candidateEnvironmentText,
  randomBytes = nodeRandomBytes
}) {
  if (typeof randomBytes !== "function") {
    fail("FIN010_RANDOM_SOURCE_INVALID", "A random source is required.");
  }
  const predecessor = parseFin010EnvironmentFile(
    predecessorEnvironmentText,
    "Predecessor production environment"
  );
  const candidate = parseFin010EnvironmentFile(
    candidateEnvironmentText,
    "Candidate environment example"
  );
  const identityVersion = validateSourceEnvironment(predecessor, candidate);
  const publicationToken = randomSecret(randomBytes, "base64url");
  const engagementToken = randomSecret(randomBytes, "base64");
  const hosted = new Map();
  for (const name of CANDIDATE_DEFAULT_NAMES) {
    hosted.set(name, raw(candidate, name, "Candidate environment example"));
  }
  for (const name of legalNames(candidate)) {
    hosted.set(name, raw(candidate, name, "Candidate environment example"));
  }
  hosted.set("SITESOURCERY_PUBLICATION_COMMAND_SOCKET", FIN010_PUBLICATION_SOCKET);
  hosted.set("SITESOURCERY_PUBLICATION_COMMAND_TOKEN", publicationToken);
  hosted.set("SITESOURCERY_RELEASE_EPOCH_FILE", FIN010_EVIDENCE.epoch.path);
  hosted.set("SITESOURCERY_RELEASE_EPOCH_SHA256", FIN010_EVIDENCE.epoch.sha256);
  hosted.set("SITESOURCERY_ORIGIN_SEAL_FILE", FIN010_EVIDENCE.originSeal.path);
  hosted.set("SITESOURCERY_ORIGIN_SEAL_FILE_SHA256", FIN010_EVIDENCE.originSeal.sha256);
  hosted.set("SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE", FIN010_EVIDENCE.installedReadback.path);
  hosted.set("SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256", FIN010_EVIDENCE.installedReadback.sha256);
  hosted.set("SITESOURCERY_DATA_ROOT", `${FIN010_PRODUCTION_ROOT}/state`);
  hosted.set("SITESOURCERY_EXPORT_ROOT", `${FIN010_PRODUCTION_ROOT}/state/private-exports`);
  hosted.set("SITESOURCERY_PUBLICATION_APPROVAL_PATH", `${FIN010_PRODUCTION_ROOT}/run/PUBLICATION_APPROVED`);
  for (const name of [
    "SITESOURCERY_DATABASE_URL",
    "SITESOURCERY_DATABASE_SSL",
    "SITESOURCERY_IDENTITY_PEPPER",
    "SITESOURCERY_CONTACT_VAULT_KEY",
    "SITESOURCERY_CONTACT_VAULT_KEY_VERSION",
    "SITESOURCERY_LICENSED_BASE_DOMAIN",
    "SITESOURCERY_SPARK_COMPILER_SHA256",
    "SITESOURCERY_REGISTRATION_MAIL_MODE",
    "SITESOURCERY_REGISTRATION_BASE_URL",
    "SITESOURCERY_RECOVERY_MAIL_MODE",
    "SITESOURCERY_RECOVERY_BASE_URL",
    "SITESOURCERY_RESEND_API_KEY",
    "SITESOURCERY_RESEND_DOMAIN_ID"
  ]) hosted.set(name, raw(predecessor, name, "Predecessor production environment"));
  hosted.set(
    "SITESOURCERY_IDENTITY_PEPPER_CONFIG",
    quoted(canonicalJson({
      schema: "sitesourcery.identity-pepper-config/v1",
      current: {
        version: identityVersion,
        secretEnvironment: "SITESOURCERY_IDENTITY_PEPPER"
      },
      prior: []
    }))
  );
  hosted.set("SITESOURCERY_ENGAGEMENT_TOKEN_SECRET", engagementToken);
  hosted.set(
    "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE",
    `${FIN010_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  );
  hosted.set(
    "SITESOURCERY_RECOVERY_TRANSPORT_MODULE",
    `${FIN010_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  );

  for (const forbidden of [
    "SITESOURCERY_STRIPE_SECRET_KEY",
    "SITESOURCERY_RESEND_WEBHOOK_SIGNING_SECRET",
    "SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN",
    "SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL",
    "SITESOURCERY_OFFER_CATALOG_PATH"
  ]) {
    if (hosted.has(forbidden)) {
      fail(
        "FIN010_HELD_PROVIDER_SECRET_PRESENT",
        `${forbidden} is forbidden while its provider purpose is held.`
      );
    }
  }

  const worker = new Map();
  const workerConfig = {
    schema: "sitesourcery.worker-process-config/v1",
    activation: "held",
    purposes: [
      "export",
      "cancellation",
      "notification-mail",
      "alakazam-fulfillment",
      "alakazam-retained-lifecycle",
      "responder-fulfillment",
      "provider-reconciliation",
      "responder-retention",
      "project-lifecycle",
      "domain-lifecycle",
      "care-lifecycle"
    ],
    approvalPath: `${FIN010_PRODUCTION_ROOT}/run/WORKERS_APPROVED`,
    shutdownDeadlineMs: 20000,
    loop: {
      intervalMs: 5000,
      errorBackoffMs: 5000,
      maximumBackoffMs: 60000
    }
  };
  worker.set("SITESOURCERY_WORKER_CONFIG", quoted(canonicalJson(workerConfig)));
  for (const name of [
    "SITESOURCERY_POSTGRES_BUDGET_CONFIG",
    "SITESOURCERY_DATABASE_URL",
    "SITESOURCERY_DATABASE_SSL",
    "SITESOURCERY_PUBLICATION_COMMAND_SOCKET",
    "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
    "SITESOURCERY_PUBLICATION_COMMAND_MAX_BODY_BYTES",
    "SITESOURCERY_PUBLICATION_COMMAND_DEADLINE_MS",
    "SITESOURCERY_DATA_ROOT",
    "SITESOURCERY_EXPORT_ROOT",
    "SITESOURCERY_LICENSED_BASE_DOMAIN",
    "SITESOURCERY_SPARK_COMPILER_SHA256"
  ]) worker.set(name, raw(hosted, name, "Generated hosted environment"));
  for (const [name, value] of Object.entries({
    SITESOURCERY_EXPORT_WORKER_MODE: "held",
    SITESOURCERY_NOTIFICATION_MAIL_WORKER_MODE: "held",
    SITESOURCERY_PROVIDER_RECONCILIATION_WORKER_MODE: "held",
    SITESOURCERY_TWILIO_READBACK_MODE: "held",
    SITESOURCERY_RESPONDER_RETENTION_WORKER_MODE: "held",
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_MODE: "held",
    SITESOURCERY_DOMAIN_LIFECYCLE_WORKER_MODE: "held",
    SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE: "held",
    SITESOURCERY_CARE_LIFECYCLE_WORKER_MODE: "held",
    SITESOURCERY_NOTIFICATION_MAIL_PRIVATE_RENDERER_MODE: "held",
    SITESOURCERY_STRIPE_MODE: "held",
    SITESOURCERY_ALAKAZAM_MODE: "held",
    SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "held",
    SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE: "held"
  })) worker.set(name, value);
  for (const [name, value] of Object.entries({
    SITESOURCERY_PROVIDER_RECONCILIATION_MAXIMUM_READBACKS_PER_CYCLE: "8",
    SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DISCOVERIES_PER_CYCLE: "100",
    SITESOURCERY_RESPONDER_RETENTION_MAXIMUM_DESTRUCTIONS_PER_CYCLE: "16",
    SITESOURCERY_RESPONDER_RETENTION_LEASE_SECONDS: "120",
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_BATCH_LIMIT: "10",
    SITESOURCERY_PROJECT_LIFECYCLE_WORKER_LEASE_SECONDS: "120",
    SITESOURCERY_DOMAIN_LIFECYCLE_WORKER_BATCH_LIMIT: "10",
    SITESOURCERY_DOMAIN_LIFECYCLE_WORKER_LEASE_SECONDS: "120",
    SITESOURCERY_CARE_LIFECYCLE_WORKER_BATCH_LIMIT: "10",
    SITESOURCERY_CARE_LIFECYCLE_WORKER_LEASE_SECONDS: "120"
  })) worker.set(name, value);

  return freeze({
    schema: FIN010_RUNTIME_SCHEMA,
    hostedText: environmentText(
      hosted,
      "FIN-010 production-held hosted environment"
    ),
    workerText: environmentText(
      worker,
      "FIN-010 production-held worker environment"
    ),
    summary: {
      candidateCommitSha: FIN010_CANDIDATE_COMMIT,
      candidateTreeSha: FIN010_CANDIDATE_TREE,
      predecessorCommitSha: FIN010_PREDECESSOR_COMMIT,
      hostedEnvironmentPath: FIN010_HOSTED_ENVIRONMENT_PATH,
      workerEnvironmentPath: FIN010_WORKER_ENVIRONMENT_PATH,
      hostedNameCount: hosted.size,
      workerNameCount: worker.size,
      secretNames: HOSTED_SECRET_NAMES,
      copiedSecretNames: [
        "SITESOURCERY_DATABASE_URL",
        "SITESOURCERY_IDENTITY_PEPPER",
        "SITESOURCERY_CONTACT_VAULT_KEY",
        "SITESOURCERY_RESEND_API_KEY"
      ],
      generatedSecretNames: [
        "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
        "SITESOURCERY_ENGAGEMENT_TOKEN_SECRET"
      ],
      providers: {
        registrationMail: "production_existing_approved",
        recoveryMail: "production_existing_approved",
        resendWebhook: "held",
        stripe: "held_no_secret_staged",
        twilio: "held_no_secret_staged",
        domains: "held",
        publication: "held",
        worker: "installed_disabled_held"
      },
      secretValuesDisclosed: false,
      secretDerivedDigestsRecorded: false
    }
  });
}

async function writeExclusive(filePath, text, mode) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await open(filePath, "wx", mode);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, mode);
}

export async function prepareFin010ProductionFiles({
  predecessorEnvironmentPath,
  candidateEnvironmentPath,
  hostedEnvironmentPath = FIN010_HOSTED_ENVIRONMENT_PATH,
  workerEnvironmentPath = FIN010_WORKER_ENVIRONMENT_PATH,
  randomBytes = nodeRandomBytes
}) {
  const prepared = createFin010ProductionEnvironments({
    predecessorEnvironmentText: await readFile(
      predecessorEnvironmentPath,
      "utf8"
    ),
    candidateEnvironmentText: await readFile(
      candidateEnvironmentPath,
      "utf8"
    ),
    randomBytes
  });
  await writeExclusive(hostedEnvironmentPath, prepared.hostedText, 0o600);
  try {
    await writeExclusive(workerEnvironmentPath, prepared.workerText, 0o600);
  } catch (error) {
    fail(
      "FIN010_ENVIRONMENT_WRITE_PARTIAL",
      `Worker environment creation failed after hosted environment creation: ${error?.code ?? "unknown"}.`
    );
  }
  return freeze({
    ...prepared.summary,
    hostedEnvironmentPath,
    workerEnvironmentPath
  });
}

export function createFin010Wrapper() {
  return `#!/bin/bash
set -euo pipefail

root=${FIN010_PRODUCTION_ROOT}
release=${FIN010_RELEASE_ROOT}
node=${FIN010_NODE}
api_pid=
tenant_pid=

stop_children() {
  if test -n "\${api_pid:-}"; then kill -TERM "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then kill -TERM "$tenant_pid" 2>/dev/null || true; fi
  if test -n "\${api_pid:-}"; then wait "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then wait "$tenant_pid" 2>/dev/null || true; fi
}
trap stop_children EXIT INT TERM

test -d "${FIN010_RUNTIME_DIRECTORY}"
test ! -L "${FIN010_RUNTIME_DIRECTORY}"
test "$(stat -c '%U:%G:%a' "${FIN010_RUNTIME_DIRECTORY}")" = "root:simtech:770"
"$node" "$release/server/hosted/bin/server.mjs" &
api_pid=$!
for _attempt in $(seq 1 300); do
  if test -d "$root/state/tenant-runtime/releases"; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then wait "$api_pid"; exit $?; fi
  sleep 0.1
done
test -d "$root/state/tenant-runtime/releases"
env \\
  SITESOURCERY_DATA_ROOT="$root/state/tenant-runtime" \\
  SITESOURCERY_TENANT_HOST=127.0.0.1 \\
  SITESOURCERY_TENANT_PORT=8080 \\
  SITESOURCERY_CONTROL_HOST=127.0.0.1 \\
  "$node" "$release/server/selfhost/bin/server.mjs" &
tenant_pid=$!

wait -n "$api_pid" "$tenant_pid"
status=$?
exit "$status"
`;
}

export function createFin010TmpfilesConfiguration() {
  return `d ${FIN010_RUNTIME_DIRECTORY} 0770 root simtech -\n`;
}

export function createFin010Caddyfile() {
  const legacyRedirects = Object.entries(FIN010_LEGACY_REDIRECTS)
    .map(([source, target]) =>
      `  redir ${source} https://sitesourcery.com${target} 308`)
    .join("\n");
  return `# FIN-010 loopback origin. Public authority remains a separate DNS gate.
{
  admin off
  auto_https off
  persist_config off

  servers {
    timeouts {
      read_body 10s
      read_header 10s
      write 30s
      idle 2m
    }
    max_header_size 32KB
    trusted_proxies static 127.0.0.1/32 ::1/128
    trusted_proxies_strict
    client_ip_headers CF-Connecting-IP X-Forwarded-For
  }
}

:8081 {
  bind 127.0.0.1
  encode zstd gzip

  @www host www.sitesourcery.com
  handle @www {
    header -Server
    redir https://sitesourcery.com{uri} 308
  }

  @wrong_host not host sitesourcery.com www.sitesourcery.com
  handle @wrong_host {
    header -Server
    respond 421
  }

${legacyRedirects}

  @sitesourcery_internal path /_sitesourcery /_sitesourcery/*
  handle @sitesourcery_internal {
    header -Server
    respond 404
  }

  @hosted_api path /api /api/*
  handle @hosted_api {
    header {
      Cache-Control "no-store"
      -Server
    }
    reverse_proxy 127.0.0.1:8788 {
      header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
      header_up X-Real-IP {http.request.header.CF-Connecting-IP}
      header_up X-Forwarded-Proto https
      health_uri /api/v1/health
      health_interval 15s
      health_timeout 3s
    }
  }

  handle {
    header {
      Cache-Control "no-store, no-transform"
      -Server
      Referrer-Policy "strict-origin-when-cross-origin"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "SAMEORIGIN"
      Permissions-Policy "camera=(), geolocation=(), microphone=()"
      Strict-Transport-Security "max-age=31536000"
    }
    reverse_proxy 127.0.0.1:8899 {
      health_uri /
      health_interval 15s
      health_timeout 3s
    }
  }
}
`;
}

export function createFin010UserUnitSet() {
  const verify = `${FIN010_NODE} ${FIN010_RELEASE_ROOT}/ops/verify-final-release-epoch-v2.mjs --epoch ${FIN010_EVIDENCE.epoch.path} --epoch-sha256 ${FIN010_EVIDENCE.epoch.sha256} --origin-seal ${FIN010_EVIDENCE.originSeal.path} --origin-seal-sha256 ${FIN010_EVIDENCE.originSeal.sha256} --installed-readback ${FIN010_EVIDENCE.installedReadback.path} --installed-readback-sha256 ${FIN010_EVIDENCE.installedReadback.sha256}`;
  const runtime = `[Unit]
Description=Site Sourcery FIN-010 exact production-held API and tenant runtime
After=network-online.target sitesourcery-production-db-tunnel.service
Wants=network-online.target
Requires=sitesourcery-production-db-tunnel.service
ConditionPathExists=${FIN010_PRODUCTION_ROOT}/run/RUNTIME_APPROVED
ConditionPathExists=!${FIN010_BACKUP_QUIESCE_PATH}
ConditionPathExists=!%t/sitesourcery-production/BACKUP_QUIESCE

[Service]
Type=simple
WorkingDirectory=${FIN010_RELEASE_ROOT}
Environment=NODE_ENV=production
EnvironmentFile=${FIN010_INSTALLED_HOSTED_ENVIRONMENT_PATH}
ExecStartPre=${FIN010_NODE} ${FIN010_RELEASE_ROOT}/server/hosted/assert-runtime.mjs
# The user-manager mount namespace maps host UID 0 to the overflow UID. Run
# only this immutable read-only verifier outside that namespace so it can
# enforce the root-owned evidence policy.
ExecStartPre=+${verify}
# The server repeats that ownership check. Its code, Node binary, environment,
# and wrapper are installed root-owned and non-writable by the service user;
# run it in the host ownership view while retaining the non-filesystem guards.
ExecStart=+${FIN010_INSTALLED_WRAPPER_PATH}
Restart=on-failure
RestartSec=3
SuccessExitStatus=143
TimeoutStartSec=45
TimeoutStopSec=30
KillSignal=SIGTERM
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadOnlyPaths=${FIN010_RELEASE_ROOT} ${FIN010_NODE.replace(/\/bin\/node$/u, "")} /etc/sitesourcery
ReadWritePaths=${FIN010_PRODUCTION_ROOT}/state ${FIN010_PRODUCTION_ROOT}/run ${FIN010_RUNTIME_DIRECTORY}
LimitNOFILE=8192
TasksMax=256

[Install]
WantedBy=default.target
`;
  const staticUnit = `[Unit]
Description=Site Sourcery FIN-010 exact immutable production artifact
After=network-online.target sitesourcery-production.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${FIN010_RELEASE_ROOT}/_hosted
ExecStart=/usr/bin/python3 -m http.server 8899 --bind 127.0.0.1 --directory ${FIN010_RELEASE_ROOT}/_hosted
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadOnlyPaths=${FIN010_RELEASE_ROOT}/_hosted

[Install]
WantedBy=default.target
`;
  const worker = `[Unit]
Description=Site Sourcery FIN-010 exact production workers (held and disabled)
After=network-online.target sitesourcery-production.service
Wants=network-online.target
Requires=sitesourcery-production.service
ConditionPathExists=${FIN010_PRODUCTION_ROOT}/run/WORKERS_APPROVED
ConditionPathExists=!${FIN010_PRODUCTION_ROOT}/run/WORKERS_HOLD
ConditionPathExists=!${FIN010_BACKUP_QUIESCE_PATH}
ConditionPathExists=!%t/sitesourcery-production/BACKUP_QUIESCE

[Service]
Type=simple
WorkingDirectory=${FIN010_RELEASE_ROOT}
Environment=NODE_ENV=production
EnvironmentFile=${FIN010_INSTALLED_WORKER_ENVIRONMENT_PATH}
ExecStartPre=${FIN010_NODE} ${FIN010_RELEASE_ROOT}/server/hosted/assert-runtime.mjs
ExecStart=${FIN010_NODE} ${FIN010_RELEASE_ROOT}/server/hosted/bin/worker.mjs
Restart=on-failure
RestartSec=3
TimeoutStartSec=30
TimeoutStopSec=25
KillSignal=SIGTERM
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadOnlyPaths=${FIN010_RELEASE_ROOT} ${FIN010_NODE.replace(/\/bin\/node$/u, "")} /etc/sitesourcery ${FIN010_PRODUCTION_ROOT}/state/tenant-runtime
ReadWritePaths=${FIN010_PRODUCTION_ROOT}/state/private-exports ${FIN010_PRODUCTION_ROOT}/run ${FIN010_RUNTIME_DIRECTORY}
LimitNOFILE=4096
TasksMax=64

[Install]
WantedBy=default.target
`;
  return freeze({
    "sitesourcery-production.service": runtime,
    "sitesourcery-production-static.service": staticUnit,
    "sitesourcery-production-worker.service": worker
  });
}

function argumentsObject(argv) {
  if (argv[0] !== "prepare" || argv.length !== 7) {
    fail(
      "FIN010_ARGUMENTS_INVALID",
      "Usage: fin010-production-runtime.mjs prepare --predecessor ABS --candidate-example ABS --hosted-output ABS"
    );
  }
  const selected = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    selected[argv[index]] = argv[index + 1];
  }
  for (const name of ["--predecessor", "--candidate-example", "--hosted-output"]) {
    if (!path.isAbsolute(selected[name] ?? "")) {
      fail("FIN010_ARGUMENTS_INVALID", `${name} must be absolute.`);
    }
  }
  return selected;
}

async function main(argv = process.argv.slice(2)) {
  const selected = argumentsObject(argv);
  const hostedOutput = path.resolve(selected["--hosted-output"]);
  if (hostedOutput !== FIN010_HOSTED_ENVIRONMENT_PATH) {
    fail(
      "FIN010_OUTPUT_PATH_INVALID",
      "The production hosted environment path is not the exact FIN-010 path."
    );
  }
  const summary = await prepareFin010ProductionFiles({
    predecessorEnvironmentPath: path.resolve(selected["--predecessor"]),
    candidateEnvironmentPath: path.resolve(selected["--candidate-example"]),
    hostedEnvironmentPath: hostedOutput,
    workerEnvironmentPath: FIN010_WORKER_ENVIRONMENT_PATH
  });
  process.stdout.write(`${canonicalJson({
    schema: FIN010_RUNTIME_SCHEMA,
    ok: true,
    ...summary
  })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      schema: FIN010_RUNTIME_SCHEMA,
      ok: false,
      code: error?.code ?? "FIN010_PRODUCTION_RUNTIME_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
