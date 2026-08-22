import { X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  readFile,
  readdir,
  statfs
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import pg from "pg";

import {
  loadVerifiedBackupAttempt,
  validateDestinationMarker
} from "./backup-runtime.mjs";
import {
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  probeRuntime
} from "./probe-runtime.mjs";

const { Pool } = pg;
const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_REMOTE_HOST =
  /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/u;
const SAFE_REMOTE_ROOT =
  /^\/[A-Za-z0-9._/-]+$/u;
const SAFE_ATTEMPT_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/u;
const BACKUP_ARTIFACT_FILES = new Set([
  "app_state.age",
  "postgresql.age"
]);

function remoteHashError(code, message) {
  const error = new Error(message);
  error.name = "RemoteBackupArtifactHashError";
  error.code = code;
  return error;
}

export function createRemoteBackupArtifactSha256({
  localRoot,
  remoteRoot,
  remoteHost,
  identityFile,
  knownHostsFile,
  timeoutMs = 30_000,
  execFileImpl = execFileAsync
}) {
  const normalizedRemoteRoot =
    typeof remoteRoot === "string"
      ? path.posix.normalize(remoteRoot)
      : null;
  if (
    typeof localRoot !== "string" ||
    !path.isAbsolute(localRoot) ||
    typeof identityFile !== "string" ||
    !path.isAbsolute(identityFile) ||
    typeof knownHostsFile !== "string" ||
    !path.isAbsolute(knownHostsFile) ||
    typeof remoteHost !== "string" ||
    !SAFE_REMOTE_HOST.test(remoteHost) ||
    normalizedRemoteRoot !== remoteRoot ||
    !SAFE_REMOTE_ROOT.test(remoteRoot) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 120_000 ||
    typeof execFileImpl !== "function"
  ) {
    throw remoteHashError(
      "BACKUP_REMOTE_HASH_CONFIGURATION_INVALID",
      "Remote backup hashing configuration is invalid."
    );
  }
  const normalizedLocalRoot = path.resolve(localRoot);

  return async function remoteBackupArtifactSha256(
    artifactPath
  ) {
    if (
      typeof artifactPath !== "string" ||
      !path.isAbsolute(artifactPath)
    ) {
      throw remoteHashError(
        "BACKUP_REMOTE_HASH_PATH_INVALID",
        "Remote backup hashing requires an absolute artifact path."
      );
    }
    const relative = path.relative(
      normalizedLocalRoot,
      path.resolve(artifactPath)
    );
    const components = relative.split(path.sep);
    if (
      components.length !== 3 ||
      components[0] !== "attempts" ||
      !SAFE_ATTEMPT_ID.test(components[1]) ||
      !BACKUP_ARTIFACT_FILES.has(components[2])
    ) {
      throw remoteHashError(
        "BACKUP_REMOTE_HASH_PATH_INVALID",
        "Remote backup hashing refused an artifact outside the exact attempt layout."
      );
    }
    const remotePath = path.posix.join(
      remoteRoot,
      ...components
    );
    let output;
    try {
      const result = await execFileImpl(
        "/usr/bin/ssh",
        [
          "-o", "BatchMode=yes",
          "-o", "ConnectTimeout=15",
          "-o", "IdentitiesOnly=yes",
          "-o", "StrictHostKeyChecking=yes",
          "-o", `UserKnownHostsFile=${knownHostsFile}`,
          "-i", identityFile,
          remoteHost,
          "/usr/bin/sha256sum",
          "--",
          remotePath
        ],
        {
          encoding: "utf8",
          env: {
            LANG: "C",
            LC_ALL: "C",
            PATH: "/usr/bin:/bin"
          },
          killSignal: "SIGKILL",
          maxBuffer: 1_024,
          timeout: timeoutMs
        }
      );
      output = result.stdout;
    } catch {
      throw remoteHashError(
        "BACKUP_REMOTE_HASH_UNAVAILABLE",
        "The remote backup artifact hash could not be read."
      );
    }
    const match =
      typeof output === "string"
        ? /^([a-f0-9]{64})  ([^\n]+)\n?$/u.exec(
            output
          )
        : null;
    if (
      !match ||
      !SHA256.test(match[1]) ||
      match[2] !== remotePath
    ) {
      throw remoteHashError(
        "BACKUP_REMOTE_HASH_RESPONSE_INVALID",
        "The remote backup artifact hash response was invalid."
      );
    }
    return match[1];
  };
}

function number(value, field) {
  const selected = Number(value);
  if (
    !Number.isSafeInteger(selected) ||
    selected < 0
  ) {
    throw new Error(
      `Database ${field} count is invalid.`
    );
  }
  return selected;
}

async function present(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createProductionMonitoringProbes({
  databaseUrl,
  dataRoot,
  backupDestinationRoot,
  sourceFailureDomainId,
  certificateFile,
  certificateHostname,
  expectedOperationsState,
  backupArtifactSha256,
  apiPort = 8788,
  tenantPort = 8080,
  timeoutMs = 3000,
  fetchImpl = globalThis.fetch
}) {
  const edgeIsExactlyHeld =
    expectedOperationsState?.publication ===
      "held" &&
    expectedOperationsState?.dns === "held";
  if (
    !edgeIsExactlyHeld &&
    (typeof certificateFile !== "string" ||
      !path.isAbsolute(certificateFile) ||
      typeof certificateHostname !== "string" ||
      certificateHostname.length < 1 ||
      /\s/u.test(certificateHostname))
  ) {
    throw new Error(
      "Live-edge certificate monitoring configuration is required."
    );
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name:
      "sitesourcery-held-monitor",
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true
  });

  const probes = Object.freeze({
    runtime() {
      return probeRuntime({
        fetchImpl,
        apiPort,
        tenantPort,
        expectedOperationsState,
        timeoutMs
      });
    },

    async database() {
      const result = await pool.query(`
        select
          to_regprocedure(
            'ss.hosted_runtime_contract_v13()'
          ) is not null as runtime_contract_v13,
          to_regprocedure(
            'ss.hosted_runtime_contract_v14()'
          ) is not null as runtime_contract_v14,
          to_regprocedure(
            'ss.hosted_runtime_contract_v15()'
          ) is not null as runtime_contract_v15,
          to_regnamespace('ss_hosted') is null
            as shadow_schema_absent,
          coalesce((
            select
              not purchasing_enabled
              and not live_mode
            from ss.domain_procurement_control
            where singleton
          ), false) as domain_held
      `);
      const row = result.rows[0];
      return Object.freeze({
        ready:
          row.runtime_contract_v13 === true &&
          row.runtime_contract_v14 === true &&
          row.runtime_contract_v15 === true &&
          row.shadow_schema_absent === true,
        runtimeContractV13:
          row.runtime_contract_v13 === true,
        runtimeContractV14:
          row.runtime_contract_v14 === true,
        runtimeContractV15:
          row.runtime_contract_v15 === true,
        shadowSchemaAbsent:
          row.shadow_schema_absent === true,
        domainHeld: row.domain_held === true
      });
    },

    async backup() {
      const marker = await readJsonObject(
        path.join(
          backupDestinationRoot,
          ".sitesourcery-off-machine.json"
        ),
        "Off-machine destination marker"
      );
      const destination =
        validateDestinationMarker(
          marker,
          sourceFailureDomainId
        );
      const attemptsRoot = path.join(
        backupDestinationRoot,
        "attempts"
      );
      const entries = await readdir(attemptsRoot, {
        withFileTypes: true
      });
      const successful = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (
          !(await present(
            path.join(
              attemptsRoot,
              entry.name,
              "attempt.succeeded.json"
            )
          ))
        ) {
          continue;
        }
        successful.push(entry.name);
      }
      successful.sort(
        (left, right) =>
          right.localeCompare(left)
      );
      const latestAttemptId = successful[0];
      if (!latestAttemptId) {
        throw new Error(
          "No successful backup is available."
        );
      }
      const latest =
        await loadVerifiedBackupAttempt(
          path.join(
            attemptsRoot,
            latestAttemptId
          ),
          backupArtifactSha256 === undefined
            ? undefined
            : {
                artifactSha256:
                  backupArtifactSha256
              }
        );
      if (
        latest.manifest
          .destinationMarkerSha256 !==
        destination.markerSha256
      ) {
        throw new Error(
          "Backup destination marker drifted."
        );
      }
      return Object.freeze({
        verified: true,
        attemptId: latest.manifest.attemptId,
        completedAt:
          latest.manifest.completedAt,
        manifestSha256:
          latest.manifestSha256
      });
    },

    async disk() {
      const filesystem = await statfs(dataRoot, {
        bigint: true
      });
      const freeBytes =
        filesystem.bavail * filesystem.bsize;
      const totalBytes =
        filesystem.blocks * filesystem.bsize;
      if (
        freeBytes >
          BigInt(Number.MAX_SAFE_INTEGER) ||
        totalBytes >
          BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        throw new Error(
          "Filesystem capacity exceeds safe monitor precision."
        );
      }
      return Object.freeze({
        freeBytes: Number(freeBytes),
        totalBytes: Number(totalBytes)
      });
    },

    async certificate() {
      if (edgeIsExactlyHeld) {
        return Object.freeze({ held: true });
      }
      const certificate = new X509Certificate(
        await readFile(certificateFile)
      );
      const notAfter = new Date(certificate.validTo);
      return Object.freeze({
        valid:
          Boolean(
            certificate.checkHost(
              certificateHostname
            )
          ) &&
          !Number.isNaN(notAfter.valueOf()),
        notAfter: notAfter.toISOString()
      });
    },

    async backlog() {
      const result = await pool.query(`
        select
          count(*) filter (
            where outbox.event_type =
              'subscription.cancellation_requested'
              and outbox.published_at is null
              and outbox.available_at <= clock_timestamp()
          )::text as cancellation_ready,
          count(*) filter (
            where outbox.event_type =
              'subscription.cancellation_requested'
              and outbox.published_at is null
              and (
                outbox.available_at = 'infinity'
                or outbox.last_error like 'ambiguous:%'
              )
          )::text as cancellation_ambiguous,
          min(outbox.created_at) filter (
            where outbox.event_type =
              'subscription.cancellation_requested'
              and outbox.published_at is null
              and outbox.available_at <= clock_timestamp()
          ) as oldest_cancellation_ready_at,
          (
            select count(*)::text
            from ss.export_requests
            where state = 'queued'
          ) as export_queued,
          (
            select count(*)::text
            from ss.export_requests
            where state = 'building'
          ) as export_building,
          (
            select count(*)::text
            from ss.export_requests
            where state = 'building'
              and lease_expires_at <=
                clock_timestamp()
          ) as export_lease_expired,
          (
            select count(*)::text
            from ss.export_requests
            where state = 'failed'
              and failure_facts ->> 'certainty'
                = 'ambiguous'
          ) as export_manual_review,
          (
            select min(requested_at)
            from ss.export_requests
            where state = 'queued'
          ) as oldest_export_queued_at,
          (
            select min(lease_expires_at)
            from ss.export_requests
            where state = 'building'
              and lease_expires_at <=
                clock_timestamp()
          ) as oldest_export_lease_expired_at,
          (
            select count(*)::text
            from ss.provider_reconciliation_cases
            where state = 'open'
          ) as reconciliation_open,
          (
            select count(*)::text
            from ss.provider_reconciliation_cases
            where state = 'open'
              and case_kind = 'suppression_conflict'
          ) as reconciliation_suppression_conflict,
          (
            select min(opened_at)
            from ss.provider_reconciliation_cases
            where state = 'open'
          ) as oldest_reconciliation_open_at
        from ss.transactional_outbox outbox
      `);
      const row = result.rows[0];
      return Object.freeze({
        cancellationReady: number(
          row.cancellation_ready,
          "cancellation ready"
        ),
        cancellationAmbiguous: number(
          row.cancellation_ambiguous,
          "cancellation ambiguous"
        ),
        oldestCancellationReadyAt:
          row.oldest_cancellation_ready_at
            ? new Date(
                row.oldest_cancellation_ready_at
              ).toISOString()
            : null,
        exportQueued: number(
          row.export_queued,
          "export queued"
        ),
        exportBuilding: number(
          row.export_building,
          "export building"
        ),
        exportLeaseExpired: number(
          row.export_lease_expired,
          "export lease expired"
        ),
        exportManualReview: number(
          row.export_manual_review,
          "export manual review"
        ),
        oldestExportQueuedAt:
          row.oldest_export_queued_at
            ? new Date(
                row.oldest_export_queued_at
              ).toISOString()
            : null,
        oldestExportLeaseExpiredAt:
          row.oldest_export_lease_expired_at
            ? new Date(
                row.oldest_export_lease_expired_at
              ).toISOString()
            : null,
        reconciliationOpenCases: number(
          row.reconciliation_open,
          "reconciliation open cases"
        ),
        reconciliationSuppressionConflicts: number(
          row.reconciliation_suppression_conflict,
          "reconciliation suppression conflicts"
        ),
        oldestReconciliationOpenAt:
          row.oldest_reconciliation_open_at
            ? new Date(
                row.oldest_reconciliation_open_at
              ).toISOString()
            : null
      });
    }
  });

  return Object.freeze({
    probes,
    async close() {
      await pool.end();
    }
  });
}
