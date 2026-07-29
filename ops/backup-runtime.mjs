import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  readJsonObject,
  safeIdentifier,
  sha256Bytes,
  sha256File,
  verifyImmutableEvidence,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";

export const OFF_MACHINE_DESTINATION_SCHEMA =
  "sitesourcery.off-machine-destination/v1";
export const BACKUP_STARTED_SCHEMA =
  "sitesourcery.backup-attempt-started/v1";
export const BACKUP_SUCCEEDED_SCHEMA =
  "sitesourcery.backup-attempt-succeeded/v1";
export const BACKUP_FAILED_SCHEMA =
  "sitesourcery.backup-attempt-failed/v1";
export const QUIESCE_SCHEMA =
  "sitesourcery.backup-quiesce/v1";

const SHA256 = /^[a-f0-9]{64}$/u;
const AGE_RECIPIENT =
  /^(?:age1[023456789acdefghjklmnpqrstuvwxyz]{20,}|ssh-(?:rsa|ed25519) [A-Za-z0-9+/=]+(?: .*)?)$/u;

export class BackupFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupFailure(code, message);
}

function exactIso(value, field) {
  const date =
    value instanceof Date ? value : new Date(value);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString() !==
      (value instanceof Date
        ? date.toISOString()
        : value)
  ) {
    fail(
      "BACKUP_CONFIGURATION_INVALID",
      `${field} must be an exact ISO timestamp.`
    );
  }
  return date;
}

function safeNow(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    fail(
      "BACKUP_CLOCK_INVALID",
      "The backup clock did not return a valid Date."
    );
  }
  return value;
}

export function assertHeldOperationsState(state) {
  const expected = {
    stripeMode: "held",
    recoveryMailMode: "held",
    publication: "held",
    domainRuntime: "held",
    dns: "held"
  };
  for (const [field, value] of Object.entries(expected)) {
    if (state?.[field] !== value) {
      fail(
        "BACKUP_HOLD_REQUIRED",
        `Backup requires ${field} to remain held.`
      );
    }
  }
  return Object.freeze({ ...expected });
}

export function validateDestinationMarker(
  marker,
  sourceFailureDomainId
) {
  const source = safeIdentifier(
    sourceFailureDomainId,
    "Source failure-domain ID"
  );
  if (
    marker?.schema !==
      OFF_MACHINE_DESTINATION_SCHEMA ||
    marker.storageClass !== "off_machine" ||
    marker.immutableAttempts !== true
  ) {
    fail(
      "BACKUP_DESTINATION_NOT_OFF_MACHINE",
      "The destination does not carry the reviewed off-machine marker."
    );
  }
  const destination = safeIdentifier(
    marker.failureDomainId,
    "Destination failure-domain ID"
  );
  if (destination === source) {
    fail(
      "BACKUP_DESTINATION_NOT_OFF_MACHINE",
      "Backup source and destination must be different failure domains."
    );
  }
  return Object.freeze({
    schema: OFF_MACHINE_DESTINATION_SCHEMA,
    storageClass: "off_machine",
    immutableAttempts: true,
    failureDomainId: destination,
    sourceFailureDomainId: source,
    markerSha256: sha256Bytes(
      Buffer.from(`${canonicalJson(marker)}\n`)
    )
  });
}

export function validateAgeRecipient(value) {
  const recipient = String(value ?? "").trim();
  if (
    recipient.includes("\n") ||
    !AGE_RECIPIENT.test(recipient)
  ) {
    fail(
      "BACKUP_AGE_RECIPIENT_INVALID",
      "The age recipient input is missing or invalid."
    );
  }
  return Object.freeze({
    value: recipient,
    fingerprint: sha256Bytes(
      Buffer.from(recipient, "utf8")
    )
  });
}

export function validateQuiesceEvidence(
  evidence,
  {
    now,
    sourceFailureDomainId,
    expectedFenceDigest = null
  }
) {
  if (
    evidence?.schema !== QUIESCE_SCHEMA ||
    evidence.runtimeUnit !==
      "sitesourcery-hosted.service" ||
    evidence.runtimeState !== "inactive" ||
    evidence.writerFence !== "engaged" ||
    evidence.databaseWriterCount !== 0 ||
    evidence.filesystemSnapshotStable !== true
  ) {
    fail(
      "BACKUP_NOT_QUIESCED",
      "The database and app-state writers are not verifiably quiesced."
    );
  }
  if (
    evidence.sourceFailureDomainId !==
    sourceFailureDomainId
  ) {
    fail(
      "BACKUP_NOT_QUIESCED",
      "The quiesce evidence belongs to another failure domain."
    );
  }
  if (
    !SHA256.test(evidence.fenceDigest ?? "") ||
    (expectedFenceDigest &&
      evidence.fenceDigest !== expectedFenceDigest)
  ) {
    fail(
      "BACKUP_NOT_QUIESCED",
      "The writer-fence evidence changed during capture."
    );
  }
  const observedAt = exactIso(
    evidence.observedAt,
    "Quiesce observation"
  );
  const expiresAt = exactIso(
    evidence.expiresAt,
    "Quiesce expiry"
  );
  if (
    observedAt > now ||
    expiresAt <= now ||
    expiresAt.valueOf() - observedAt.valueOf() >
      30 * 60 * 1000
  ) {
    fail(
      "BACKUP_NOT_QUIESCED",
      "The quiesce evidence is stale or unreasonably long-lived."
    );
  }
  return Object.freeze({
    schema: QUIESCE_SCHEMA,
    runtimeUnit: evidence.runtimeUnit,
    runtimeState: evidence.runtimeState,
    writerFence: evidence.writerFence,
    databaseWriterCount: 0,
    filesystemSnapshotStable: true,
    sourceFailureDomainId:
      evidence.sourceFailureDomainId,
    snapshotId: safeIdentifier(
      evidence.snapshotId,
      "Snapshot ID"
    ),
    fenceDigest: evidence.fenceDigest,
    observedAt: evidence.observedAt,
    expiresAt: evidence.expiresAt
  });
}

function exactArtifact(value, kind) {
  if (
    value?.kind !== kind ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path)
  ) {
    fail(
      "BACKUP_CAPTURE_INVALID",
      `${kind} capture did not return an absolute artifact path.`
    );
  }
  if (
    kind === "postgresql" &&
    (!value.manifest ||
      value.manifest.schema !==
        "sitesourcery.postgresql-invariants/v1" ||
      value.manifest.runtimeContractV13 !== true ||
      value.manifest.runtimeContractV14 !== true ||
      value.manifest.runtimeContractV15 !== true ||
      value.manifest.shadowSchemaAbsent !== true ||
      value.manifest.domainHeld !== true ||
      value.manifest.serviceRoleBypassRls !== true ||
      value.manifest
        .authenticatedRoleNoBypassRls !== true ||
      value.manifest.serviceRoleSchemaUsage !== true)
  ) {
    fail(
      "BACKUP_CAPTURE_INVALID",
      "PostgreSQL capture did not prove migrations, invariants, and held domain state."
    );
  }
  if (
    kind === "app_state" &&
    (!value.manifest ||
      !SHA256.test(
        value.manifest.treeSha256 ?? ""
      ))
  ) {
    fail(
      "BACKUP_CAPTURE_INVALID",
      "App-state capture did not return a checksummed manifest."
    );
  }
  return value;
}

function safeFailureCode(error) {
  return error instanceof BackupFailure
    ? error.code
    : "BACKUP_ATTEMPT_FAILED";
}

async function writeEvidenceWithDigest(
  attemptRoot,
  name,
  value
) {
  const manifestPath = path.join(
    attemptRoot,
    `${name}.json`
  );
  const written = await writeImmutableEvidence(
    manifestPath,
    value
  );
  await writeImmutableEvidence(
    path.join(attemptRoot, `${name}.digest.json`),
    {
      schema:
        "sitesourcery.immutable-evidence-digest/v1",
      file: `${name}.json`,
      sha256: written.sha256,
      bytes: written.bytes
    }
  );
  return written;
}

export async function runBackupAttempt({
  destinationRoot,
  destinationMarker,
  sourceFailureDomainId,
  stagingRoot,
  ageRecipient,
  heldState,
  ports,
  now = () => new Date(),
  attemptIdFactory = randomUUID
}) {
  if (
    typeof destinationRoot !== "string" ||
    !path.isAbsolute(destinationRoot) ||
    typeof stagingRoot !== "string" ||
    !path.isAbsolute(stagingRoot) ||
    path.resolve(destinationRoot) ===
      path.resolve(stagingRoot)
  ) {
    fail(
      "BACKUP_CONFIGURATION_INVALID",
      "Backup destination and local staging roots must be distinct absolute paths."
    );
  }
  const holds = assertHeldOperationsState(heldState);
  const destination = validateDestinationMarker(
    destinationMarker,
    sourceFailureDomainId
  );
  const recipient = validateAgeRecipient(ageRecipient);
  for (const capability of [
    "assertQuiesced",
    "inspectAppState",
    "createDatabaseDump",
    "createAppArchive",
    "encrypt"
  ]) {
    if (typeof ports?.[capability] !== "function") {
      fail(
        "BACKUP_CONFIGURATION_INVALID",
        `Backup port ${capability} is required.`
      );
    }
  }

  const started = safeNow(now);
  const generatedAttemptId = safeIdentifier(
    String(attemptIdFactory()),
    "Backup attempt ID"
  );
  const attemptId = `${started
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "")}-${generatedAttemptId}`;
  const attemptsRoot = path.join(
    destinationRoot,
    "attempts"
  );
  await mkdir(attemptsRoot, {
    recursive: true,
    mode: 0o700
  });
  const attemptRoot = path.join(
    attemptsRoot,
    attemptId
  );
  await mkdir(attemptRoot, {
    recursive: false,
    mode: 0o700
  });
  const workspace = await mkdtemp(
    path.join(
      stagingRoot,
      "sitesourcery-backup-"
    )
  );

  await writeEvidenceWithDigest(
    attemptRoot,
    "attempt.started",
    {
      schema: BACKUP_STARTED_SCHEMA,
      attemptId,
      startedAt: started.toISOString(),
      sourceFailureDomainId:
        destination.sourceFailureDomainId,
      destinationFailureDomainId:
        destination.failureDomainId,
      destinationMarkerSha256:
        destination.markerSha256,
      ageRecipientFingerprint:
        recipient.fingerprint,
      holds
    }
  );

  try {
    const before = validateQuiesceEvidence(
      await ports.assertQuiesced({
        attemptId,
        phase: "before"
      }),
      {
        now: started,
        sourceFailureDomainId:
          destination.sourceFailureDomainId
      }
    );
    const beforeAppState =
      await ports.inspectAppState({
        attemptId,
        phase: "before"
      });
    if (
      !SHA256.test(
        beforeAppState?.treeSha256 ?? ""
      )
    ) {
      fail(
        "BACKUP_CAPTURE_INVALID",
        "The pre-capture app-state inventory is invalid."
      );
    }

    const database = exactArtifact(
      await ports.createDatabaseDump({
        attemptId,
        outputPath: path.join(
          workspace,
          "postgresql.dump"
        )
      }),
      "postgresql"
    );
    const appState = exactArtifact(
      await ports.createAppArchive({
        attemptId,
        outputPath: path.join(
          workspace,
          "app-state.tar"
        ),
        expectedTreeSha256:
          beforeAppState.treeSha256
      }),
      "app_state"
    );

    const finishedCaptureAt = safeNow(now);
    const after = validateQuiesceEvidence(
      await ports.assertQuiesced({
        attemptId,
        phase: "after"
      }),
      {
        now: finishedCaptureAt,
        sourceFailureDomainId:
          destination.sourceFailureDomainId,
        expectedFenceDigest: before.fenceDigest
      }
    );
    const afterAppState =
      await ports.inspectAppState({
        attemptId,
        phase: "after"
      });
    if (
      after.snapshotId !== before.snapshotId ||
      afterAppState?.treeSha256 !==
        beforeAppState.treeSha256 ||
      appState.manifest.treeSha256 !==
        beforeAppState.treeSha256
    ) {
      fail(
        "BACKUP_SNAPSHOT_CHANGED",
        "The quiesced app-state snapshot changed during capture."
      );
    }

    const plaintextArtifacts = [];
    for (const artifact of [database, appState]) {
      const file = await lstat(artifact.path);
      if (!file.isFile() || file.size <= 0) {
        fail(
          "BACKUP_CAPTURE_INVALID",
          `${artifact.kind} capture is empty or not a regular file.`
        );
      }
      plaintextArtifacts.push({
        kind: artifact.kind,
        path: artifact.path,
        bytes: file.size,
        sha256: await sha256File(artifact.path),
        ...(artifact.kind === "app_state"
          ? { appStateManifest: artifact.manifest }
          : {
              databaseManifest:
                artifact.manifest
            })
      });
    }

    const encryptedArtifacts = [];
    for (const artifact of plaintextArtifacts) {
      const finalName = `${artifact.kind}.age`;
      const partialPath = path.join(
        attemptRoot,
        `.${finalName}.partial`
      );
      const finalPath = path.join(
        attemptRoot,
        finalName
      );
      await ports.encrypt({
        attemptId,
        inputPath: artifact.path,
        outputPath: partialPath,
        ageRecipient: recipient.value
      });
      const encrypted = await lstat(partialPath);
      if (!encrypted.isFile() || encrypted.size <= 0) {
        fail(
          "BACKUP_ENCRYPTION_FAILED",
          `${artifact.kind} encryption did not produce a file.`
        );
      }
      await link(partialPath, finalPath);
      await chmod(finalPath, 0o400);
      await unlink(partialPath);
      encryptedArtifacts.push({
        kind: artifact.kind,
        file: finalName,
        encryptedBytes: encrypted.size,
        encryptedSha256:
          await sha256File(finalPath),
        plaintextBytes: artifact.bytes,
        plaintextSha256: artifact.sha256,
        ...(artifact.appStateManifest
          ? {
              appStateManifest:
                artifact.appStateManifest
            }
          : {
              databaseManifest:
                artifact.databaseManifest
            })
      });
    }

    const completedAt = safeNow(now);
    const manifest = {
      schema: BACKUP_SUCCEEDED_SCHEMA,
      attemptId,
      startedAt: started.toISOString(),
      completedAt: completedAt.toISOString(),
      sourceFailureDomainId:
        destination.sourceFailureDomainId,
      destinationFailureDomainId:
        destination.failureDomainId,
      destinationMarkerSha256:
        destination.markerSha256,
      ageRecipientFingerprint:
        recipient.fingerprint,
      consistency: {
        schema: QUIESCE_SCHEMA,
        snapshotId: before.snapshotId,
        fenceDigest: before.fenceDigest,
        runtimeState: "inactive",
        databaseWriterCount: 0,
        filesystemTreeSha256:
          beforeAppState.treeSha256,
        verifiedBeforeAndAfter: true
      },
      holds,
      artifacts: encryptedArtifacts
    };
    const evidence = await writeEvidenceWithDigest(
      attemptRoot,
      "attempt.succeeded",
      manifest
    );
    return Object.freeze({
      ok: true,
      attemptId,
      attemptRoot,
      completedAt: manifest.completedAt,
      manifestSha256: evidence.sha256,
      artifactCount: manifest.artifacts.length
    });
  } catch (error) {
    const failedAt = safeNow(now);
    await writeEvidenceWithDigest(
      attemptRoot,
      "attempt.failed",
      {
        schema: BACKUP_FAILED_SCHEMA,
        attemptId,
        startedAt: started.toISOString(),
        failedAt: failedAt.toISOString(),
        code: safeFailureCode(error),
        sourceFailureDomainId:
          destination.sourceFailureDomainId,
        destinationFailureDomainId:
          destination.failureDomainId,
        holds
      }
    ).catch(() => {});
    throw error;
  } finally {
    await rm(workspace, {
      recursive: true,
      force: true
    });
  }
}

export async function loadVerifiedBackupAttempt(
  attemptRoot
) {
  const startedEvidence =
    await loadVerifiedAttemptEvidence({
      attemptRoot,
      name: "attempt.started",
      expectedSchema: BACKUP_STARTED_SCHEMA
    });
  const verified =
    await loadVerifiedAttemptEvidence({
      attemptRoot,
      name: "attempt.succeeded",
      expectedSchema: BACKUP_SUCCEEDED_SCHEMA
    });
  const started = startedEvidence.value;
  const manifest = verified.value;
  const attemptId = path.basename(
    path.resolve(attemptRoot)
  );
  if (
    started.attemptId !== attemptId ||
    manifest.attemptId !== attemptId ||
    manifest.startedAt !== started.startedAt ||
    manifest.sourceFailureDomainId !==
      started.sourceFailureDomainId ||
    manifest.destinationFailureDomainId !==
      started.destinationFailureDomainId ||
    manifest.destinationMarkerSha256 !==
      started.destinationMarkerSha256 ||
    manifest.ageRecipientFingerprint !==
      started.ageRecipientFingerprint ||
    canonicalJson(manifest.holds) !==
      canonicalJson(started.holds) ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 2
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup success evidence does not match its immutable start evidence."
    );
  }
  const startedAt = exactIso(
    manifest.startedAt,
    "Backup start"
  );
  const completedAt = exactIso(
    manifest.completedAt,
    "Backup completion"
  );
  if (
    completedAt < startedAt ||
    !SHA256.test(
      manifest.destinationMarkerSha256 ?? ""
    ) ||
    !SHA256.test(
      manifest.ageRecipientFingerprint ?? ""
    )
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup success evidence has invalid timing or fingerprints."
    );
  }
  assertHeldOperationsState(manifest.holds);
  const expectedFiles = new Set([
    "attempt.started.json",
    "attempt.started.digest.json",
    "attempt.succeeded.json",
    "attempt.succeeded.digest.json",
    ...manifest.artifacts.map(
      (artifact) => artifact.file
    )
  ]);
  await assertExactAttemptLedger(
    attemptRoot,
    expectedFiles,
    "Successful"
  );
  const kinds = new Set(
    manifest.artifacts.map(
      (artifact) => artifact.kind
    )
  );
  if (
    kinds.size !== 2 ||
    !kinds.has("postgresql") ||
    !kinds.has("app_state")
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup manifest must contain exactly one database and one app-state artifact."
    );
  }
  for (const artifact of manifest.artifacts) {
    if (
      !["postgresql", "app_state"].includes(
        artifact.kind
      ) ||
      !Number.isSafeInteger(
        artifact.encryptedBytes
      ) ||
      artifact.encryptedBytes <= 0 ||
      !Number.isSafeInteger(
        artifact.plaintextBytes
      ) ||
      artifact.plaintextBytes <= 0 ||
      !SHA256.test(
        artifact.encryptedSha256 ?? ""
      ) ||
      !SHA256.test(
        artifact.plaintextSha256 ?? ""
      ) ||
      path.basename(artifact.file ?? "") !==
        artifact.file
    ) {
      fail(
        "BACKUP_MANIFEST_INVALID",
        "Backup artifact evidence is invalid."
      );
    }
    const artifactPath = path.join(
      attemptRoot,
      artifact.file
    );
    const metadata = await lstat(
      artifactPath
    ).catch(() => null);
    const actual = metadata?.isFile()
      ? await sha256File(artifactPath).catch(
          () => null
        )
      : null;
    if (
      actual !== artifact.encryptedSha256 ||
      metadata?.size !== artifact.encryptedBytes ||
      (metadata.mode & 0o222) !== 0
    ) {
      fail(
        "BACKUP_ARTIFACT_TAMPERED",
        "Encrypted backup artifact integrity verification failed."
      );
    }
  }
  return Object.freeze({
    attemptRoot,
    manifest,
    manifestSha256: verified.sha256
  });
}

async function loadVerifiedAttemptEvidence({
  attemptRoot,
  name,
  expectedSchema
}) {
  const file = `${name}.json`;
  const digest = await readJsonObject(
    path.join(
      attemptRoot,
      `${name}.digest.json`
    ),
    "Backup evidence digest"
  ).catch(() => {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup evidence digest is missing or invalid."
    );
  });
  if (
    digest.schema !==
      "sitesourcery.immutable-evidence-digest/v1" ||
    digest.file !== file ||
    !SHA256.test(digest.sha256 ?? "") ||
    !Number.isSafeInteger(digest.bytes) ||
    digest.bytes <= 0
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup evidence digest is invalid."
    );
  }
  const verified = await verifyImmutableEvidence(
    path.join(attemptRoot, file),
    digest.sha256
  ).catch(() => {
    fail(
      "BACKUP_MANIFEST_TAMPERED",
      "Backup evidence integrity verification failed."
    );
  });
  if (
    verified.bytes !== digest.bytes ||
    verified.value.schema !== expectedSchema
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup evidence schema or byte count is invalid."
    );
  }
  for (const evidencePath of [
    path.join(attemptRoot, file),
    path.join(
      attemptRoot,
      `${name}.digest.json`
    )
  ]) {
    const metadata = await lstat(
      evidencePath
    ).catch(() => null);
    if (
      !metadata?.isFile() ||
      (metadata.mode & 0o222) !== 0
    ) {
      fail(
        "BACKUP_MANIFEST_TAMPERED",
        "Backup evidence is not an immutable regular file."
      );
    }
  }
  return verified;
}

async function assertExactAttemptLedger(
  attemptRoot,
  expectedFiles,
  label
) {
  const actualFiles = await readdir(attemptRoot);
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some(
      (file) => !expectedFiles.has(file)
    )
  ) {
    fail(
      "BACKUP_ATTEMPT_LEDGER_INVALID",
      `${label} backup attempt contains unknown or missing files.`
    );
  }
}

async function loadVerifiedFailedBackupAttempt(
  attemptRoot
) {
  const startedEvidence =
    await loadVerifiedAttemptEvidence({
      attemptRoot,
      name: "attempt.started",
      expectedSchema: BACKUP_STARTED_SCHEMA
    });
  const failedEvidence =
    await loadVerifiedAttemptEvidence({
      attemptRoot,
      name: "attempt.failed",
      expectedSchema: BACKUP_FAILED_SCHEMA
    });
  const started = startedEvidence.value;
  const failed = failedEvidence.value;
  const attemptId = path.basename(
    path.resolve(attemptRoot)
  );
  if (
    started.attemptId !== attemptId ||
    failed.attemptId !== attemptId ||
    failed.startedAt !== started.startedAt ||
    failed.sourceFailureDomainId !==
      started.sourceFailureDomainId ||
    failed.destinationFailureDomainId !==
      started.destinationFailureDomainId ||
    canonicalJson(failed.holds) !==
      canonicalJson(started.holds) ||
    typeof failed.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,63}$/u.test(failed.code)
  ) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup failure evidence does not match its immutable start evidence."
    );
  }
  const startedAt = exactIso(
    failed.startedAt,
    "Backup start"
  );
  const failedAt = exactIso(
    failed.failedAt,
    "Backup failure"
  );
  if (failedAt < startedAt) {
    fail(
      "BACKUP_MANIFEST_INVALID",
      "Backup failure timing is invalid."
    );
  }
  assertHeldOperationsState(failed.holds);
  await assertExactAttemptLedger(
    attemptRoot,
    new Set([
      "attempt.started.json",
      "attempt.started.digest.json",
      "attempt.failed.json",
      "attempt.failed.digest.json"
    ]),
    "Failed"
  );
  return Object.freeze({
    attemptRoot,
    manifest: failed,
    manifestSha256: failedEvidence.sha256
  });
}

export function planBackupRetention(
  records,
  {
    now = new Date(),
    maxAgeMs,
    minimumSuccessful = 7
  }
) {
  if (
    !(now instanceof Date) ||
    Number.isNaN(now.valueOf()) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 24 * 60 * 60 * 1000 ||
    !Number.isSafeInteger(minimumSuccessful) ||
    minimumSuccessful < 2
  ) {
    fail(
      "BACKUP_RETENTION_INVALID",
      "Backup retention policy is invalid."
    );
  }
  if (
    !Array.isArray(records) ||
    records.some(
      (record) =>
        record?.verified !== true ||
        typeof record.attemptId !== "string" ||
        typeof record.completedAt !== "string"
    )
  ) {
    fail(
      "BACKUP_RETENTION_UNVERIFIED",
      "Retention refuses unverified backup records."
    );
  }
  const ordered = records
    .map((record) => ({
      ...record,
      completedDate: exactIso(
        record.completedAt,
        "Backup completion"
      )
    }))
    .sort(
      (left, right) =>
        right.completedDate -
        left.completedDate
    );
  const remove = ordered
    .slice(minimumSuccessful)
    .filter(
      (record) =>
        now - record.completedDate > maxAgeMs
    )
    .map((record) => record.attemptId);
  return Object.freeze({
    keep: ordered
      .filter(
        (record) =>
          !remove.includes(record.attemptId)
      )
      .map((record) => record.attemptId),
    remove,
    applied: false
  });
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function applyBackupRetention({
  destinationRoot,
  destinationMarker,
  sourceFailureDomainId,
  now = new Date(),
  maxAgeMs,
  minimumSuccessful = 7,
  apply = false,
  removeAttempt = (attemptRoot) =>
    rm(attemptRoot, {
      recursive: true,
      force: false
    })
}) {
  if (
    typeof destinationRoot !== "string" ||
    !path.isAbsolute(destinationRoot)
  ) {
    fail(
      "BACKUP_RETENTION_INVALID",
      "Backup retention destination must be absolute."
    );
  }
  validateDestinationMarker(
    destinationMarker,
    sourceFailureDomainId
  );
  const attemptsRoot = path.join(
    destinationRoot,
    "attempts"
  );
  const entries = await readdir(attemptsRoot, {
    withFileTypes: true
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      fail(
        "BACKUP_RETENTION_UNVERIFIED",
        "Retention refuses unknown files in the attempt ledger."
      );
    }
    const attemptRoot = path.join(
      attemptsRoot,
      entry.name
    );
    const successPath = path.join(
      attemptRoot,
      "attempt.succeeded.json"
    );
    if (await fileExists(successPath)) {
      const verified =
        await loadVerifiedBackupAttempt(
          attemptRoot
        );
      if (
        verified.manifest.attemptId !==
        entry.name
      ) {
        fail(
          "BACKUP_RETENTION_UNVERIFIED",
          "Backup attempt directory and manifest identities differ."
        );
      }
      records.push({
        verified: true,
        attemptId: entry.name,
        completedAt:
          verified.manifest.completedAt,
        attemptRoot
      });
      continue;
    }
    if (
      !(await fileExists(
        path.join(
          attemptRoot,
          "attempt.failed.json"
        )
      ))
    ) {
      fail(
        "BACKUP_RETENTION_UNVERIFIED",
        "Retention refuses an incomplete backup attempt."
      );
    }
    await loadVerifiedFailedBackupAttempt(
      attemptRoot
    ).catch(() => {
      fail(
        "BACKUP_RETENTION_UNVERIFIED",
        "Retention refuses tampered or incomplete failure evidence."
      );
    });
  }
  const plan = planBackupRetention(records, {
    now,
    maxAgeMs,
    minimumSuccessful
  });
  if (!apply) {
    return plan;
  }
  for (const attemptId of plan.remove) {
    const record = records.find(
      (candidate) =>
        candidate.attemptId === attemptId
    );
    await loadVerifiedBackupAttempt(
      record.attemptRoot
    );
    await removeAttempt(
      record.attemptRoot,
      attemptId
    );
  }
  return Object.freeze({
    ...plan,
    applied: true
  });
}

export async function readAgeRecipientFile(filePath) {
  return validateAgeRecipient(
    await readFile(filePath, "utf8")
  );
}
