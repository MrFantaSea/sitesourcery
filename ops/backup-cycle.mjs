import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  QUIESCE_SCHEMA
} from "./backup-runtime.mjs";
import {
  PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
  createSafeCommandRunner,
  productionRehearsalQuiescePath
} from "./backup-ports.mjs";
import {
  canonicalJson,
  parseJsonObject,
  safeIdentifier
} from "./immutable-evidence.mjs";

export const BACKUP_CYCLE_SCHEMA =
  "sitesourcery.production-backup-cycle/v1";
export const PRODUCTION_REHEARSAL_FAILURE_DOMAIN =
  "dell-sitesourcery-production-01";
export const PRODUCTION_REHEARSAL_STAGING_ROOT =
  "/home/simtech/sitesourcery-production/backup-staging";
export const BACKUP_CYCLE_MAX_FENCE_MS =
  25 * 60 * 1000;

const MAX_REVIEWED_FENCE_MS = 30 * 60 * 1000;
const STATE_NAME = "BACKUP_CYCLE_STATE.json";
const EXACT_STATE_FIELDS = Object.freeze([
  "createdAt",
  "expiresAt",
  "runtimeUnit",
  "runtimeWasActive",
  "schema",
  "snapshotId",
  "sourceFailureDomainId"
]);
const EXACT_FENCE_FIELDS = Object.freeze([
  "expiresAt",
  "runtimeUnit",
  "schema",
  "snapshotId",
  "sourceFailureDomainId",
  "writerFence"
]);

export class BackupCycleFailure extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "BackupCycleFailure";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new BackupCycleFailure(
    code,
    message,
    options
  );
}

function exactIso(value, field) {
  const parsed = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString() !== value
  ) {
    fail(
      "BACKUP_CYCLE_STATE_INVALID",
      `${field} must be an exact ISO timestamp.`
    );
  }
  return parsed;
}

function exactFields(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value)
      .sort((left, right) =>
        left.localeCompare(right)
      )
      .join("\n") === expected.join("\n")
  );
}

function validUid(uid) {
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0
  ) {
    fail(
      "BACKUP_CYCLE_USER_INVALID",
      "The production-rehearsal backup cycle requires a non-root Unix user."
    );
  }
  return uid;
}

function safeNow(now) {
  const value = now();
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.valueOf())
  ) {
    fail(
      "BACKUP_CYCLE_CLOCK_INVALID",
      "The backup-cycle clock did not return a valid Date."
    );
  }
  return value;
}

async function pathExists(selectedPath) {
  try {
    await lstat(selectedPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertPrivateDirectory(
  selectedPath,
  uid,
  label,
  { create = false } = {}
) {
  if (create) {
    await mkdir(selectedPath, {
      recursive: true,
      mode: 0o700
    });
  }
  const metadata = await lstat(selectedPath);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o077) !== 0
  ) {
    fail(
      "BACKUP_CYCLE_PATH_INVALID",
      `${label} must be an owner-private directory.`
    );
  }
}

async function writePrivateJson(
  selectedPath,
  value,
  uid
) {
  const temporaryPath = path.join(
    path.dirname(selectedPath),
    `.${path.basename(selectedPath)}.${randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporaryPath,
      "wx",
      0o600
    );
    await handle.writeFile(
      `${canonicalJson(value)}\n`,
      "utf8"
    );
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, 0o600);
    const metadata = await lstat(temporaryPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== uid ||
      (metadata.mode & 0o777) !== 0o600
    ) {
      fail(
        "BACKUP_CYCLE_PATH_INVALID",
        "Backup-cycle private state could not be created safely."
      );
    }
    await link(temporaryPath, selectedPath);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(
      (error) => {
        if (error?.code !== "ENOENT") throw error;
      }
    );
  }
}

async function readPrivateJson(
  selectedPath,
  uid,
  label
) {
  const metadata = await lstat(selectedPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o777) !== 0o600
  ) {
    fail(
      "BACKUP_CYCLE_STATE_INVALID",
      `${label} must be an owner-only regular file.`
    );
  }
  try {
    return parseJsonObject(
      await readFile(selectedPath, "utf8"),
      label
    );
  } catch (error) {
    if (error instanceof BackupCycleFailure) {
      throw error;
    }
    fail(
      "BACKUP_CYCLE_STATE_INVALID",
      `${label} is invalid.`,
      { cause: error }
    );
  }
}

function validateState(
  state,
  {
    runtimeUnit,
    sourceFailureDomainId
  }
) {
  if (
    !exactFields(state, EXACT_STATE_FIELDS) ||
    state.schema !== BACKUP_CYCLE_SCHEMA ||
    state.runtimeUnit !== runtimeUnit ||
    state.runtimeWasActive !== true ||
    state.sourceFailureDomainId !==
      sourceFailureDomainId
  ) {
    fail(
      "BACKUP_CYCLE_STATE_INVALID",
      "Backup-cycle recovery state does not match the reviewed runtime."
    );
  }
  const createdAt = exactIso(
    state.createdAt,
    "Backup-cycle creation"
  );
  const expiresAt = exactIso(
    state.expiresAt,
    "Backup-cycle expiry"
  );
  if (
    expiresAt <= createdAt ||
    expiresAt.valueOf() - createdAt.valueOf() >
      MAX_REVIEWED_FENCE_MS
  ) {
    fail(
      "BACKUP_CYCLE_STATE_INVALID",
      "Backup-cycle recovery state has an invalid lifetime."
    );
  }
  safeIdentifier(
    state.snapshotId,
    "Backup-cycle snapshot ID"
  );
  return state;
}

function validateFence(fence, state) {
  if (
    !exactFields(fence, EXACT_FENCE_FIELDS) ||
    fence.schema !== QUIESCE_SCHEMA ||
    fence.runtimeUnit !== state.runtimeUnit ||
    fence.sourceFailureDomainId !==
      state.sourceFailureDomainId ||
    fence.writerFence !== "engaged" ||
    fence.snapshotId !== state.snapshotId ||
    fence.expiresAt !== state.expiresAt
  ) {
    fail(
      "BACKUP_CYCLE_FENCE_INVALID",
      "The backup-cycle fence does not match its recovery state."
    );
  }
}

function assertConfiguration({
  runtimeUnit,
  sourceFailureDomainId,
  fencePath,
  statePath,
  stagingRoot,
  maxFenceMs,
  lifecycle
}) {
  safeIdentifier(
    runtimeUnit,
    "Backup-cycle runtime unit"
  );
  safeIdentifier(
    sourceFailureDomainId,
    "Backup-cycle source failure domain"
  );
  for (const [label, selectedPath] of [
    ["fence", fencePath],
    ["state", statePath],
    ["staging", stagingRoot]
  ]) {
    if (
      typeof selectedPath !== "string" ||
      !path.isAbsolute(selectedPath)
    ) {
      fail(
        "BACKUP_CYCLE_CONFIGURATION_INVALID",
        `The backup-cycle ${label} path must be absolute.`
      );
    }
  }
  if (
    path.dirname(fencePath) !==
      path.dirname(statePath) ||
    fencePath === statePath ||
    stagingRoot === path.dirname(fencePath) ||
    stagingRoot.startsWith(
      `${path.dirname(fencePath)}${path.sep}`
    ) ||
    path.dirname(fencePath).startsWith(
      `${stagingRoot}${path.sep}`
    ) ||
    !Number.isSafeInteger(maxFenceMs) ||
    maxFenceMs <= 0 ||
    maxFenceMs > MAX_REVIEWED_FENCE_MS ||
    typeof lifecycle?.runtimeState !==
      "function" ||
    typeof lifecycle?.stopRuntime !==
      "function" ||
    typeof lifecycle?.startRuntime !==
      "function"
  ) {
    fail(
      "BACKUP_CYCLE_CONFIGURATION_INVALID",
      "Backup-cycle configuration is invalid."
    );
  }
}

async function cleanupPlaintextStaging(
  stagingRoot,
  uid
) {
  await assertPrivateDirectory(
    stagingRoot,
    uid,
    "Backup staging root"
  );
  let removed = 0;
  for (const name of await readdir(stagingRoot)) {
    if (!name.startsWith("sitesourcery-backup-")) {
      continue;
    }
    const selectedPath = path.join(
      stagingRoot,
      name
    );
    const metadata = await lstat(selectedPath);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== uid
    ) {
      fail(
        "BACKUP_CYCLE_STAGING_INVALID",
        "Backup-cycle plaintext staging contains an unsafe entry."
      );
    }
    await rm(selectedPath, {
      recursive: true,
      force: false
    });
    removed += 1;
  }
  return removed;
}

export function productionRehearsalBackupCyclePaths(
  uid = process.getuid?.()
) {
  const selectedUid = validUid(uid);
  const fencePath =
    productionRehearsalQuiescePath(
      selectedUid
    );
  return Object.freeze({
    fencePath,
    statePath: path.join(
      path.dirname(fencePath),
      STATE_NAME
    )
  });
}

export async function recoverBackupCycle({
  runtimeUnit,
  sourceFailureDomainId,
  fencePath,
  statePath,
  stagingRoot,
  lifecycle,
  uid = process.getuid?.()
}) {
  const selectedUid = validUid(uid);
  assertConfiguration({
    runtimeUnit,
    sourceFailureDomainId,
    fencePath,
    statePath,
    stagingRoot,
    maxFenceMs: BACKUP_CYCLE_MAX_FENCE_MS,
    lifecycle
  });
  const [stateExists, fenceExists] =
    await Promise.all([
      pathExists(statePath),
      pathExists(fencePath)
    ]);
  if (!stateExists) {
    if (fenceExists) {
      fail(
        "BACKUP_CYCLE_ORPHAN_FENCE",
        "A backup fence exists without reviewed recovery state."
      );
    }
    const plaintextStagingRemoved =
      await cleanupPlaintextStaging(
        stagingRoot,
        selectedUid
      );
    return Object.freeze({
      recovered: false,
      plaintextStagingRemoved
    });
  }
  const state = validateState(
    await readPrivateJson(
      statePath,
      selectedUid,
      "Backup-cycle recovery state"
    ),
    {
      runtimeUnit,
      sourceFailureDomainId
    }
  );
  if (fenceExists) {
    validateFence(
      await readPrivateJson(
        fencePath,
        selectedUid,
        "Backup-cycle fence"
      ),
      state
    );
  }
  const plaintextStagingRemoved =
    await cleanupPlaintextStaging(
      stagingRoot,
      selectedUid
    );
  if (fenceExists) {
    await unlink(fencePath);
  }
  await lifecycle.startRuntime();
  if (
    (await lifecycle.runtimeState()) !==
    "active"
  ) {
    fail(
      "BACKUP_CYCLE_RECOVERY_FAILED",
      "The production runtime did not recover after backup."
    );
  }
  await unlink(statePath);
  return Object.freeze({
    recovered: true,
    snapshotId: state.snapshotId,
    plaintextStagingRemoved
  });
}

export async function beginBackupCycle({
  runtimeUnit,
  sourceFailureDomainId,
  fencePath,
  statePath,
  stagingRoot,
  lifecycle,
  uid = process.getuid?.(),
  now = () => new Date(),
  snapshotIdFactory = randomUUID,
  maxFenceMs = BACKUP_CYCLE_MAX_FENCE_MS
}) {
  const selectedUid = validUid(uid);
  assertConfiguration({
    runtimeUnit,
    sourceFailureDomainId,
    fencePath,
    statePath,
    stagingRoot,
    maxFenceMs,
    lifecycle
  });
  await Promise.all([
    assertPrivateDirectory(
      path.dirname(fencePath),
      selectedUid,
      "Backup-cycle runtime directory",
      { create: true }
    ),
    assertPrivateDirectory(
      stagingRoot,
      selectedUid,
      "Backup staging root"
    )
  ]);
  if (
    (await pathExists(statePath)) ||
    (await pathExists(fencePath))
  ) {
    fail(
      "BACKUP_CYCLE_ALREADY_ACTIVE",
      "A backup cycle or writer fence already exists."
    );
  }
  if (
    (await lifecycle.runtimeState()) !==
    "active"
  ) {
    fail(
      "BACKUP_CYCLE_RUNTIME_NOT_ACTIVE",
      "The production runtime must be active before a backup cycle begins."
    );
  }
  const createdAt = safeNow(now);
  const expiresAt = new Date(
    createdAt.valueOf() + maxFenceMs
  );
  const snapshotId = safeIdentifier(
    String(snapshotIdFactory()),
    "Backup-cycle snapshot ID"
  );
  const state = Object.freeze({
    schema: BACKUP_CYCLE_SCHEMA,
    runtimeUnit,
    sourceFailureDomainId,
    runtimeWasActive: true,
    snapshotId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  });
  let stateCreated = false;
  try {
    await writePrivateJson(
      statePath,
      state,
      selectedUid
    );
    stateCreated = true;
    await writePrivateJson(
      fencePath,
      {
        schema: QUIESCE_SCHEMA,
        runtimeUnit,
        sourceFailureDomainId,
        writerFence: "engaged",
        snapshotId,
        expiresAt: state.expiresAt
      },
      selectedUid
    );
    await lifecycle.stopRuntime();
    if (
      (await lifecycle.runtimeState()) !==
      "inactive"
    ) {
      fail(
        "BACKUP_CYCLE_RUNTIME_NOT_QUIESCED",
        "The production runtime did not become inactive."
      );
    }
    return state;
  } catch (error) {
    if (stateCreated) {
      try {
        await recoverBackupCycle({
          runtimeUnit,
          sourceFailureDomainId,
          fencePath,
          statePath,
          stagingRoot,
          lifecycle,
          uid: selectedUid
        });
      } catch (recoveryError) {
        fail(
          "BACKUP_CYCLE_RECOVERY_FAILED",
          "Backup-cycle setup failed and the runtime could not be recovered.",
          {
            cause: new AggregateError([
              error,
              recoveryError
            ])
          }
        );
      }
    }
    throw error;
  }
}

export async function runBackupCycle({
  backup,
  ...configuration
}) {
  if (typeof backup !== "function") {
    fail(
      "BACKUP_CYCLE_CONFIGURATION_INVALID",
      "A backup function is required."
    );
  }
  const state = await beginBackupCycle(
    configuration
  );
  let result;
  let backupError;
  try {
    result = await backup();
  } catch (error) {
    backupError = error;
  }
  try {
    await recoverBackupCycle(configuration);
  } catch (recoveryError) {
    fail(
      "BACKUP_CYCLE_RECOVERY_FAILED",
      "The backup cycle could not restore the production runtime.",
      {
        cause: backupError
          ? new AggregateError([
              backupError,
              recoveryError
            ])
          : recoveryError
      }
    );
  }
  if (backupError) throw backupError;
  return Object.freeze({
    ok: true,
    snapshotId: state.snapshotId,
    backup: result
  });
}

export function createProductionRehearsalLifecycle({
  environment = process.env,
  uid = process.getuid?.(),
  commandRunner = createSafeCommandRunner()
} = {}) {
  const selectedUid = validUid(uid);
  const runtimeDirectory =
    `/run/user/${selectedUid}`;
  const commandEnvironment = {
    PATH: environment.PATH,
    LANG: "C",
    LC_ALL: "C",
    XDG_RUNTIME_DIR: runtimeDirectory,
    DBUS_SESSION_BUS_ADDRESS:
      `unix:path=${runtimeDirectory}/bus`
  };
  async function runtimeState() {
    const result = await commandRunner.run(
      "/usr/bin/systemctl",
      [
        "--user",
        "is-active",
        PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
      ],
      {
        env: commandEnvironment,
        allowedExitCodes: [0, 3],
        captureStdout: true,
        label: "Backup-cycle runtime probe"
      }
    );
    return result.stdout.trim();
  }
  return Object.freeze({
    runtimeState,
    async stopRuntime() {
      await commandRunner.run(
        "/usr/bin/systemctl",
        [
          "--user",
          "stop",
          PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
        ],
        {
          env: commandEnvironment,
          label: "Backup-cycle runtime stop"
        }
      );
    },
    async startRuntime() {
      await commandRunner.run(
        "/usr/bin/systemctl",
        [
          "--user",
          "start",
          PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
        ],
        {
          env: commandEnvironment,
          label: "Backup-cycle runtime start"
        }
      );
    }
  });
}

function required(environment, field) {
  const value = environment[field];
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    fail(
      "BACKUP_CYCLE_CONFIGURATION_INVALID",
      `${field} is required.`
    );
  }
  return value;
}

function productionConfiguration(
  environment,
  uid,
  lifecycle
) {
  const paths =
    productionRehearsalBackupCyclePaths(uid);
  if (
    required(
      environment,
      "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
    ) !== PRODUCTION_REHEARSAL_FAILURE_DOMAIN ||
    path.resolve(
      required(
        environment,
        "SITESOURCERY_BACKUP_STAGING_ROOT"
      )
    ) !== PRODUCTION_REHEARSAL_STAGING_ROOT ||
    path.resolve(
      required(
        environment,
        "SITESOURCERY_BACKUP_QUIESCE_PATH"
      )
    ) !== paths.fencePath
  ) {
    fail(
      "BACKUP_CYCLE_CONFIGURATION_INVALID",
      "The production-rehearsal backup-cycle boundary has drifted."
    );
  }
  return {
    runtimeUnit:
      PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
    sourceFailureDomainId:
      PRODUCTION_REHEARSAL_FAILURE_DOMAIN,
    fencePath: paths.fencePath,
    statePath: paths.statePath,
    stagingRoot:
      PRODUCTION_REHEARSAL_STAGING_ROOT,
    lifecycle,
    uid
  };
}

export function runProductionRehearsalBackupCycle({
  environment = process.env,
  uid = process.getuid?.(),
  lifecycle = createProductionRehearsalLifecycle({
    environment,
    uid
  }),
  backup
}) {
  return runBackupCycle({
    ...productionConfiguration(
      environment,
      validUid(uid),
      lifecycle
    ),
    backup
  });
}

export function recoverProductionRehearsalBackupCycle({
  environment = process.env,
  uid = process.getuid?.(),
  lifecycle = createProductionRehearsalLifecycle({
    environment,
    uid
  })
} = {}) {
  return recoverBackupCycle(
    productionConfiguration(
      environment,
      validUid(uid),
      lifecycle
    )
  );
}
