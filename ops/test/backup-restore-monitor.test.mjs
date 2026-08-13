import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALERT_APPROVAL_SCHEMA,
  OPERATIONS_REPORT_SCHEMA,
  alertApprovalDigest,
  createHeldAlertAdapter,
  createReviewedOutboundAlertAdapter
} from "../alert-adapter.mjs";
import {
  createPersistentOperationsAlertAdapter
} from "../alert-state.mjs";
import {
  BACKUP_SUCCEEDED_SCHEMA,
  OFF_MACHINE_DESTINATION_SCHEMA,
  QUIESCE_SCHEMA,
  applyBackupRetention,
  loadVerifiedBackupAttempt,
  planBackupRetention,
  runBackupAttempt
} from "../backup-runtime.mjs";
import {
  PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
  createProductionBackupPorts,
  createProductionRehearsalBackupPorts,
  productionRehearsalQuiescePath,
  createSafeCommandRunner
} from "../backup-ports.mjs";
import {
  retentionFromEnvironment
} from "../apply-backup-retention.mjs";
import {
  backupFromEnvironment
} from "../run-backup.mjs";
import {
  writeImmutableEvidence
} from "../immutable-evidence.mjs";
import {
  runOperationsMonitor
} from "../monitor-runtime.mjs";
import {
  createProductionMonitoringProbes
} from "../monitor-ports.mjs";
import {
  HELD_PROVIDER_EGRESS_STATE,
  OPERATIONS_STATE_APPROVAL_SCHEMA,
  operationsStateApprovalDigest,
  resolveOperationsStateEvidence
} from "../operations-state.mjs";
import {
  createProductionRestorePorts,
  restoreLibpqEnvironment
} from "../restore-ports.mjs";
import {
  verifyCleanRoomRestore
} from "../restore-runtime.mjs";

const NOW = new Date(
  "2026-07-29T12:05:00.000Z"
);
const HELDS = Object.freeze({
  stripeMode: "held",
  registrationMailMode: "held",
  recoveryMailMode: "held",
  publication: "held",
  domainRuntime: "held",
  dns: "held"
});
const LIVE_MAIL_OPERATIONS = Object.freeze({
  ...HELDS,
  registrationMailMode: "production",
  recoveryMailMode: "production"
});
const LIVE_EDGE_OPERATIONS = Object.freeze({
  ...HELDS,
  publication: "approved",
  dns: "approved_live"
});
function operationsApproval(
  expectedOperationsState =
    LIVE_MAIL_OPERATIONS
) {
  const approval = {
    schema: OPERATIONS_STATE_APPROVAL_SCHEMA,
    approvalId: "production-mail-ready-001",
    state: "approved",
    sourceFailureDomainId: "primary-01",
    consumers: ["backup", "monitor"],
    expectedOperationsState,
    approvedAt:
      "2026-07-29T00:00:00.000Z",
    expiresAt:
      "2026-07-30T00:00:00.000Z"
  };
  return Object.freeze({
    ...approval,
    digest:
      operationsStateApprovalDigest(
        approval
      )
  });
}
function outboundAlertApproval() {
  const approval = {
    schema: ALERT_APPROVAL_SCHEMA,
    adapterId: "owner-alert-port",
    state: "approved",
    reportSchema: OPERATIONS_REPORT_SCHEMA,
    destinationRef: "owner-primary",
    approvedAt:
      "2026-07-29T00:00:00.000Z",
    expiresAt:
      "2026-07-30T00:00:00.000Z"
  };
  return Object.freeze({
    ...approval,
    digest: alertApprovalDigest(approval)
  });
}
const HELD_MONITOR_CONTRACT = Object.freeze({
  operationsStateEvidence:
    resolveOperationsStateEvidence({
      actualOperationsState: HELDS,
      sourceFailureDomainId: "primary-01",
      consumer: "monitor",
      now: NOW
    }),
  providerEgress: "held"
});
const DESTINATION_MARKER = Object.freeze({
  schema: OFF_MACHINE_DESTINATION_SCHEMA,
  storageClass: "off_machine",
  failureDomainId: "backup-vault-02",
  immutableAttempts: true
});
const DATABASE_MANIFEST = Object.freeze({
  schema:
    "sitesourcery.postgresql-invariants/v1",
  runtimeContractV13: true,
  runtimeContractV14: true,
  runtimeContractV15: true,
  shadowSchemaAbsent: true,
  domainHeld: true,
  serviceRoleBypassRls: true,
  authenticatedRoleNoBypassRls: true,
  serviceRoleSchemaUsage: true,
  tableCount: "71",
  rowCounts: {
    organizations: "2",
    projects: "3",
    auditEvents: "11",
    exportRequests: "1",
    outbox: "4"
  }
});
const APP_MANIFEST = Object.freeze({
  schema:
    "sitesourcery.app-state-inventory/v1",
  treeSha256: "a".repeat(64),
  entries: [
    {
      root: "tenant_runtime",
      path: ".",
      type: "directory",
      mode: "0700"
    },
    {
      root: "tenant_runtime",
      path: "control/current.json",
      type: "file",
      mode: "0600",
      bytes: 18,
      sha256: "b".repeat(64)
    }
  ]
});

function quiesce({
  fenceDigest = "c".repeat(64),
  snapshotId = "snapshot-001",
  runtimeUnit =
    "sitesourcery-hosted.service",
  observedAt =
    "2026-07-29T12:00:00.000Z",
  expiresAt =
    "2026-07-29T12:20:00.000Z"
} = {}) {
  return {
    schema: QUIESCE_SCHEMA,
    runtimeUnit,
    runtimeState: "inactive",
    writerFence: "engaged",
    databaseWriterCount: 0,
    filesystemSnapshotStable: true,
    sourceFailureDomainId: "primary-01",
    snapshotId,
    fenceDigest,
    observedAt,
    expiresAt
  };
}

async function setup(t) {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      "sitesourcery-ops-test-"
    )
  );
  const destinationRoot = path.join(
    root,
    "off-machine"
  );
  const stagingRoot = path.join(root, "staging");
  const evidenceRoot = path.join(root, "evidence");
  await Promise.all([
    mkdir(destinationRoot),
    mkdir(stagingRoot),
    mkdir(evidenceRoot)
  ]);
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await import("node:fs/promises").then(
      ({ rm }) =>
        rm(root, {
          recursive: true,
          force: true
        })
    );
  });
  return {
    root,
    destinationRoot,
    stagingRoot,
    evidenceRoot
  };
}

function fakeBackupPorts({
  afterFenceDigest = "c".repeat(64),
  failDatabase = null,
  runtimeUnit =
    "sitesourcery-hosted.service",
  quiesceForPhase = null,
  calls = []
} = {}) {
  return {
    async assertQuiesced({ phase }) {
      calls.push(["quiesce", phase]);
      if (quiesceForPhase) {
        return quiesceForPhase(phase);
      }
      return quiesce({
        fenceDigest:
          phase === "after"
            ? afterFenceDigest
            : "c".repeat(64),
        runtimeUnit
      });
    },
    async inspectAppState({ phase }) {
      calls.push(["inventory", phase]);
      return APP_MANIFEST;
    },
    async createDatabaseDump({ outputPath }) {
      calls.push(["database", outputPath]);
      if (failDatabase) {
        throw new Error(failDatabase);
      }
      await writeFile(
        outputPath,
        "POSTGRESQL-CUSTOM-DUMP"
      );
      return {
        kind: "postgresql",
        path: outputPath,
        manifest: DATABASE_MANIFEST
      };
    },
    async createAppArchive({ outputPath }) {
      calls.push(["app", outputPath]);
      await writeFile(
        outputPath,
        "APP-STATE-TAR"
      );
      return {
        kind: "app_state",
        path: outputPath,
        manifest: APP_MANIFEST
      };
    },
    async encrypt({
      inputPath,
      outputPath,
      ageRecipient
    }) {
      calls.push([
        "encrypt",
        path.basename(inputPath),
        ageRecipient
      ]);
      const plaintext = await readFile(inputPath);
      await writeFile(
        outputPath,
        Buffer.concat([
          Buffer.from("age-encrypted:"),
          plaintext
        ])
      );
    }
  };
}

async function successfulBackup(
  t,
  {
    operationsState = HELDS,
    approval = null,
    attemptId = "attempt-001",
    quiesceRuntimeUnit =
      "sitesourcery-hosted.service"
  } = {}
) {
  const paths = await setup(t);
  const result = await runBackupAttempt({
    ...paths,
    destinationMarker: DESTINATION_MARKER,
    sourceFailureDomainId: "primary-01",
    ageRecipient:
      "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    sourceOperationsState: operationsState,
    operationsStateApproval: approval,
    providerEgress: "held",
    quiesceRuntimeUnit,
    ports: fakeBackupPorts({
      runtimeUnit: quiesceRuntimeUnit
    }),
    now: () => new Date(NOW),
    attemptIdFactory: () => attemptId
  });
  return { ...paths, result };
}

test("backup writes only age ciphertext and immutable checksummed evidence to another failure domain", async (t) => {
  const { result } = await successfulBackup(t);
  const verified = await loadVerifiedBackupAttempt(
    result.attemptRoot
  );
  assert.equal(
    verified.manifest.schema,
    BACKUP_SUCCEEDED_SCHEMA
  );
  assert.equal(
    verified.manifest
      .destinationFailureDomainId,
    "backup-vault-02"
  );
  assert.equal(
    verified.manifest.consistency
      .verifiedBeforeAndAfter,
    true
  );
  assert.equal(
    verified.manifest.artifacts.length,
    2
  );
  for (const artifact of verified.manifest
    .artifacts) {
    const artifactPath = path.join(
      result.attemptRoot,
      artifact.file
    );
    const bytes = await readFile(artifactPath);
    assert.match(
      bytes.toString("utf8"),
      /^age-encrypted:/u
    );
    assert.equal(
      (await stat(artifactPath)).mode & 0o777,
      0o400
    );
  }
  assert.deepEqual(
    (await readdir(result.attemptRoot))
      .filter((name) =>
        /\.(?:dump|tar|partial)$/u.test(name)
      ),
    []
  );
  await assert.rejects(
    writeImmutableEvidence(
      path.join(
        result.attemptRoot,
        "attempt.succeeded.json"
      ),
      { replaced: true }
    ),
    /EEXIST/u
  );
});

test("backup records the exact reviewed user-service runtime used by the production rehearsal", async (t) => {
  const { result } = await successfulBackup(t, {
    attemptId: "user-service-attempt-001",
    quiesceRuntimeUnit:
      PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
  });
  const verified = await loadVerifiedBackupAttempt(
    result.attemptRoot
  );
  assert.equal(
    verified.manifest.consistency.runtimeUnit,
    PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
  );
});

test("real-time quiesce observations may follow the attempt start clock", async (t) => {
  const paths = await setup(t);
  const clock = [
    "2026-07-29T12:05:00.000Z",
    "2026-07-29T12:05:00.020Z",
    "2026-07-29T12:05:00.040Z",
    "2026-07-29T12:05:00.050Z"
  ];
  let clockIndex = 0;
  const result = await runBackupAttempt({
    ...paths,
    destinationMarker: DESTINATION_MARKER,
    sourceFailureDomainId: "primary-01",
    ageRecipient:
      "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    sourceOperationsState: HELDS,
    providerEgress: "held",
    ports: fakeBackupPorts({
      quiesceForPhase(phase) {
        return quiesce({
          observedAt:
            phase === "before"
              ? "2026-07-29T12:05:00.010Z"
              : "2026-07-29T12:05:00.030Z",
          expiresAt:
            "2026-07-29T12:20:00.000Z"
        });
      }
    }),
    now: () =>
      new Date(
        clock[
          Math.min(
            clockIndex++,
            clock.length - 1
          )
        ]
      ),
    attemptIdFactory: () =>
      "advancing-clock-attempt-001"
  });
  assert.equal(result.ok, true);
});

test("reviewed live mail state is captured while backup and clean-room provider egress stay held", async (t) => {
  const {
    result,
    stagingRoot,
    evidenceRoot
  } = await successfulBackup(t, {
    operationsState: LIVE_MAIL_OPERATIONS,
    approval: operationsApproval(),
    attemptId: "live-mail-attempt-001"
  });
  const verified =
    await loadVerifiedBackupAttempt(
      result.attemptRoot
    );
  assert.equal(
    verified.manifest.sourceOperations.mode,
    "reviewed"
  );
  assert.deepEqual(
    verified.manifest.sourceOperations
      .operationsState,
    LIVE_MAIL_OPERATIONS
  );
  assert.equal(
    verified.manifest.sourceOperations.approval
      .digest,
    operationsApproval().digest
  );
  assert.equal(
    verified.manifest.providerEgress,
    "held"
  );

  const restored = await verifyCleanRoomRestore({
    attemptRoot: result.attemptRoot,
    stagingRoot,
    evidenceRoot,
    providerEgressState:
      HELD_PROVIDER_EGRESS_STATE,
    restoreTarget: {
      databaseName:
        "sitesourcery_restore_live_mail_001",
      networkExposure: "none"
    },
    ports: {
      async decrypt({ inputPath, outputPath }) {
        const encrypted =
          await readFile(inputPath);
        await writeFile(
          outputPath,
          encrypted.subarray(
            Buffer.byteLength(
              "age-encrypted:"
            )
          )
        );
      },
      async restoreFreshDatabase({ expected }) {
        return {
          freshDatabase: true,
          databaseName:
            "sitesourcery_restore_live_mail_001",
          ...expected
        };
      },
      async restoreFreshAppState({ expected }) {
        return {
          freshRoot: true,
          treeSha256: expected.treeSha256
        };
      }
    },
    now: () => new Date(NOW),
    restoreIdFactory: () =>
      "restore-live-mail-001"
  });
  assert.deepEqual(
    restored.report.sourceOperations
      .operationsState,
    LIVE_MAIL_OPERATIONS
  );
  assert.deepEqual(
    restored.report.restoreExecution
      .providerEgress,
    HELD_PROVIDER_EGRESS_STATE
  );
  assert.equal(
    restored.report.restoreExecution
      .networkExposure,
    "none"
  );
});

test("backup fails closed on local destinations, unapproved state, provider egress, and a changing writer fence", async (t) => {
  const paths = await setup(t);
  const base = {
    ...paths,
    sourceFailureDomainId: "primary-01",
    ageRecipient:
      "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    sourceOperationsState: HELDS,
    providerEgress: "held",
    now: () => new Date(NOW),
    attemptIdFactory: () => "attempt-002"
  };
  await assert.rejects(
    runBackupAttempt({
      ...base,
      destinationMarker: {
        ...DESTINATION_MARKER,
        failureDomainId: "primary-01"
      },
      ports: fakeBackupPorts()
    }),
    (error) =>
      error.code ===
      "BACKUP_DESTINATION_NOT_OFF_MACHINE"
  );
  await assert.rejects(
    runBackupAttempt({
      ...base,
      destinationMarker: DESTINATION_MARKER,
      sourceOperationsState: {
        ...HELDS,
        stripeMode: "approved_live"
      },
      ports: fakeBackupPorts()
    }),
    (error) =>
      error.code ===
      "OPERATIONS_STATE_APPROVAL_REQUIRED"
  );
  await assert.rejects(
    runBackupAttempt({
      ...base,
      destinationMarker: DESTINATION_MARKER,
      operationsStateApproval:
        operationsApproval(),
      ports: fakeBackupPorts()
    }),
    (error) =>
      error.code === "OPERATIONS_STATE_DRIFT"
  );
  await assert.rejects(
    runBackupAttempt({
      ...base,
      destinationMarker: DESTINATION_MARKER,
      providerEgress: "approved_live",
      ports: fakeBackupPorts()
    }),
    (error) =>
      error.code ===
      "OPERATIONS_PROVIDER_EGRESS_NOT_HELD"
  );
  await assert.rejects(
    runBackupAttempt({
      ...base,
      destinationMarker: DESTINATION_MARKER,
      attemptIdFactory: () => "attempt-003",
      ports: fakeBackupPorts({
        afterFenceDigest: "d".repeat(64)
      })
    }),
    (error) =>
      error.code === "BACKUP_NOT_QUIESCED"
  );
});

test("operations-state approval rejects tampering, extra authority, and expiry", () => {
  const valid = operationsApproval();
  for (const approval of [
    {
      ...valid,
      digest: "0".repeat(64)
    },
    {
      ...valid,
      unreviewedAuthority: true
    }
  ]) {
    assert.throws(
      () =>
        resolveOperationsStateEvidence({
          actualOperationsState:
            LIVE_MAIL_OPERATIONS,
          approval,
          sourceFailureDomainId:
            "primary-01",
          consumer: "backup",
          now: NOW
        }),
      (error) =>
        error.code ===
          "OPERATIONS_STATE_APPROVAL_INVALID" ||
        error.code ===
          "OPERATIONS_STATE_INVALID"
    );
  }
  const expiredPayload = {
    ...valid,
    approvedAt:
      "2026-07-27T00:00:00.000Z",
    expiresAt:
      "2026-07-28T00:00:00.000Z"
  };
  const expired = {
    ...expiredPayload,
    digest:
      operationsStateApprovalDigest(
        expiredPayload
      )
  };
  assert.throws(
    () =>
      resolveOperationsStateEvidence({
        actualOperationsState:
          LIVE_MAIL_OPERATIONS,
        approval: expired,
        sourceFailureDomainId: "primary-01",
        consumer: "backup",
        now: NOW
      }),
    (error) =>
      error.code ===
      "OPERATIONS_STATE_APPROVAL_EXPIRED"
  );
});

test("failed backup records only a safe code and removes local plaintext", async (t) => {
  const paths = await setup(t);
  await assert.rejects(
    runBackupAttempt({
      ...paths,
      destinationMarker: DESTINATION_MARKER,
      sourceFailureDomainId: "primary-01",
      ageRecipient:
        "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      sourceOperationsState: HELDS,
      providerEgress: "held",
      ports: fakeBackupPorts({
        failDatabase:
          "postgresql://secret-user:secret-password@db/private"
      }),
      now: () => new Date(NOW),
      attemptIdFactory: () => "attempt-004"
    })
  );
  const attempts = await readdir(
    path.join(paths.destinationRoot, "attempts")
  );
  assert.equal(attempts.length, 1);
  const failed = await readFile(
    path.join(
      paths.destinationRoot,
      "attempts",
      attempts[0],
      "attempt.failed.json"
    ),
    "utf8"
  );
  assert.match(
    failed,
    /"code":"BACKUP_ATTEMPT_FAILED"/u
  );
  assert.doesNotMatch(
    failed,
    /secret-user|secret-password|postgresql:/u
  );
  assert.deepEqual(
    await readdir(paths.stagingRoot),
    []
  );
  assert.deepEqual(
    await applyBackupRetention({
      destinationRoot: paths.destinationRoot,
      destinationMarker: DESTINATION_MARKER,
      sourceFailureDomainId: "primary-01",
      now: NOW,
      maxAgeMs:
        30 * 24 * 60 * 60 * 1000,
      minimumSuccessful: 2,
      apply: false
    }),
    {
      keep: [],
      remove: [],
      applied: false
    }
  );
  const failedPath = path.join(
    paths.destinationRoot,
    "attempts",
    attempts[0],
    "attempt.failed.json"
  );
  await chmod(failedPath, 0o600);
  await writeFile(failedPath, `${failed} `);
  await assert.rejects(
    applyBackupRetention({
      destinationRoot: paths.destinationRoot,
      destinationMarker: DESTINATION_MARKER,
      sourceFailureDomainId: "primary-01",
      now: NOW,
      maxAgeMs:
        30 * 24 * 60 * 60 * 1000,
      minimumSuccessful: 2,
      apply: false
    }),
    (error) =>
      error.code ===
      "BACKUP_RETENTION_UNVERIFIED"
  );
});

test("tampered ciphertext is rejected before restore or retention decisions", async (t) => {
  const { result, stagingRoot, evidenceRoot } =
    await successfulBackup(t);
  await chmod(
    path.join(
      result.attemptRoot,
      "postgresql.age"
    ),
    0o600
  );
  await writeFile(
    path.join(
      result.attemptRoot,
      "postgresql.age"
    ),
    "tampered"
  );
  await assert.rejects(
    loadVerifiedBackupAttempt(result.attemptRoot),
    (error) =>
      error.code ===
      "BACKUP_ARTIFACT_TAMPERED"
  );
  let decryptCalls = 0;
  await assert.rejects(
    verifyCleanRoomRestore({
      attemptRoot: result.attemptRoot,
      stagingRoot,
      evidenceRoot,
      providerEgressState:
        HELD_PROVIDER_EGRESS_STATE,
      restoreTarget: {
        networkExposure: "none"
      },
      ports: {
        async decrypt() {
          decryptCalls += 1;
        },
        async restoreFreshDatabase() {},
        async restoreFreshAppState() {}
      }
    }),
    (error) =>
      error.code ===
      "BACKUP_ARTIFACT_TAMPERED"
  );
  assert.equal(decryptCalls, 0);
});

test("tampered start evidence is rejected before a successful attempt is trusted", async (t) => {
  const { result } = await successfulBackup(t);
  const startedPath = path.join(
    result.attemptRoot,
    "attempt.started.json"
  );
  const started = await readFile(
    startedPath,
    "utf8"
  );
  await chmod(startedPath, 0o600);
  await writeFile(startedPath, `${started} `);
  await assert.rejects(
    loadVerifiedBackupAttempt(result.attemptRoot),
    (error) =>
      error.code ===
      "BACKUP_MANIFEST_TAMPERED"
  );
});

test("retention keeps a verified floor and never accepts unverified deletion candidates", () => {
  const records = Array.from(
    { length: 6 },
    (_, index) => ({
      verified: true,
      attemptId: `attempt-${index}`,
      completedAt: new Date(
        NOW.valueOf() - index * 10 * 24 * 60 * 60 * 1000
      ).toISOString()
    })
  );
  assert.deepEqual(
    planBackupRetention(records, {
      now: NOW,
      maxAgeMs: 25 * 24 * 60 * 60 * 1000,
      minimumSuccessful: 3
    }),
    {
      keep: [
        "attempt-0",
        "attempt-1",
        "attempt-2"
      ],
      remove: [
        "attempt-3",
        "attempt-4",
        "attempt-5"
      ],
      applied: false
    }
  );
  assert.throws(
    () =>
      planBackupRetention(
        [
          {
            verified: false,
            attemptId: "attempt-unsafe",
            completedAt: NOW.toISOString()
          }
        ],
        {
          now: NOW,
          maxAgeMs:
            30 * 24 * 60 * 60 * 1000
        }
      ),
    (error) =>
      error.code ===
      "BACKUP_RETENTION_UNVERIFIED"
  );
});

test("retention deletes only re-verified successful attempts after an explicit apply switch", async (t) => {
  const paths = await setup(t);
  for (const index of [0, 1, 2, 3]) {
    await runBackupAttempt({
      ...paths,
      destinationMarker: DESTINATION_MARKER,
      sourceFailureDomainId: "primary-01",
      ageRecipient:
        "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      sourceOperationsState: HELDS,
      providerEgress: "held",
      ports: fakeBackupPorts(),
      now: () => new Date(NOW),
      attemptIdFactory: () =>
        `retention-attempt-${index}`
    });
  }
  const result = await applyBackupRetention({
    destinationRoot: paths.destinationRoot,
    destinationMarker: DESTINATION_MARKER,
    sourceFailureDomainId: "primary-01",
    now: new Date(
      "2026-09-10T12:05:00.000Z"
    ),
    maxAgeMs: 25 * 24 * 60 * 60 * 1000,
    minimumSuccessful: 2,
    apply: true
  });
  assert.equal(result.applied, true);
  assert.equal(result.remove.length, 2);
  assert.equal(
    (
      await readdir(
        path.join(
          paths.destinationRoot,
          "attempts"
        )
      )
    ).length,
    2
  );
});

test("retention CLI rejects a relative destination before reading or deleting anything", async () => {
  await assert.rejects(
    retentionFromEnvironment({
      SITESOURCERY_BACKUP_DESTINATION_ROOT:
        "relative/backup-vault",
      SITESOURCERY_SOURCE_FAILURE_DOMAIN:
        "primary-01",
      SITESOURCERY_BACKUP_RETENTION_MAX_AGE_MS:
        String(30 * 24 * 60 * 60 * 1000),
      SITESOURCERY_BACKUP_RETENTION_MINIMUM_SUCCESSFUL:
        "3",
      SITESOURCERY_BACKUP_RETENTION_APPLY:
        "false"
    }),
    /must be absolute/u
  );
});

test("backup CLI rejects overlapping source, staging, and destination roots before capture", async (t) => {
  const paths = await setup(t);
  const dataRoot = path.join(
    paths.root,
    "data"
  );
  const exportRoot = path.join(
    paths.stagingRoot,
    "private-exports"
  );
  const releaseRoot = path.join(
    paths.root,
    "release"
  );
  const configurationRoot = path.join(
    paths.root,
    "configuration"
  );
  await Promise.all([
    mkdir(path.join(dataRoot, "tenant-runtime"), {
      recursive: true
    }),
    mkdir(exportRoot),
    mkdir(releaseRoot),
    mkdir(configurationRoot)
  ]);
  await assert.rejects(
    backupFromEnvironment({
      SITESOURCERY_BACKUP_DESTINATION_ROOT:
        paths.destinationRoot,
      SITESOURCERY_BACKUP_STAGING_ROOT:
        paths.stagingRoot,
      SITESOURCERY_BACKUP_AGE_RECIPIENT_FILE:
        path.join(paths.root, "recipient.txt"),
      SITESOURCERY_SOURCE_FAILURE_DOMAIN:
        "primary-01",
      SITESOURCERY_BACKUP_QUIESCE_PATH:
        "/run/sitesourcery/BACKUP_QUIESCE",
      SITESOURCERY_DATA_ROOT: dataRoot,
      SITESOURCERY_EXPORT_ROOT: exportRoot,
      SITESOURCERY_RELEASE_ROOT: releaseRoot,
      SITESOURCERY_CONFIGURATION_ROOT:
        configurationRoot
    }),
    /mutually disjoint/u
  );
});

test("clean-room restore verifies plaintext, fresh targets, v13 through v15, row counts, app bytes, and held egress", async (t) => {
  const {
    result,
    stagingRoot,
    evidenceRoot
  } = await successfulBackup(t);
  const restored = await verifyCleanRoomRestore({
    attemptRoot: result.attemptRoot,
    stagingRoot,
    evidenceRoot,
    providerEgressState:
      HELD_PROVIDER_EGRESS_STATE,
    restoreTarget: {
      databaseName:
        "sitesourcery_restore_attempt_001",
      networkExposure: "none"
    },
    ports: {
      async decrypt({
        inputPath,
        outputPath
      }) {
        const encrypted =
          await readFile(inputPath);
        await writeFile(
          outputPath,
          encrypted.subarray(
            Buffer.byteLength(
              "age-encrypted:"
            )
          )
        );
      },
      async restoreFreshDatabase({
        expected
      }) {
        return {
          freshDatabase: true,
          databaseName:
            "sitesourcery_restore_attempt_001",
          ...expected
        };
      },
      async restoreFreshAppState({
        expected
      }) {
        return {
          freshRoot: true,
          treeSha256: expected.treeSha256
        };
      }
    },
    now: () => new Date(NOW),
    restoreIdFactory: () => "restore-001"
  });
  assert.equal(restored.report.cleanRoom, true);
  assert.equal(
    restored.report.database.runtimeContractV13,
    true
  );
  assert.equal(
    restored.report.database.runtimeContractV14,
    true
  );
  assert.equal(
    restored.report.database.runtimeContractV15,
    true
  );
  assert.equal(
    restored.report.database.domainHeld,
    true
  );
  assert.deepEqual(
    restored.report.database.rowCounts,
    DATABASE_MANIFEST.rowCounts
  );
  assert.equal(
    restored.report.appState.treeSha256,
    APP_MANIFEST.treeSha256
  );
  assert.match(
    await readFile(
      path.join(
        restored.restoreRoot,
        "restore.verified.json"
      ),
      "utf8"
    ),
    /"schema":"sitesourcery\.clean-room-restore\/v2"/u
  );
});

test("clean-room restore fails if the target is not fresh or an invariant drifts", async (t) => {
  const {
    result,
    stagingRoot,
    evidenceRoot
  } = await successfulBackup(t);
  await assert.rejects(
    verifyCleanRoomRestore({
      attemptRoot: result.attemptRoot,
      stagingRoot,
      evidenceRoot,
      providerEgressState:
        HELD_PROVIDER_EGRESS_STATE,
      restoreTarget: {
        networkExposure: "none"
      },
      ports: {
        async decrypt({
          inputPath,
          outputPath
        }) {
          const encrypted =
            await readFile(inputPath);
          await writeFile(
            outputPath,
            encrypted.subarray(
              Buffer.byteLength(
                "age-encrypted:"
              )
            )
          );
        },
        async restoreFreshDatabase({
          expected
        }) {
          return {
            freshDatabase: false,
            ...expected
          };
        },
        async restoreFreshAppState() {
          throw new Error("must not run");
        }
      },
      now: () => new Date(NOW),
      restoreIdFactory: () => "restore-002"
    }),
    (error) =>
      error.code ===
      "RESTORE_DATABASE_INVARIANT_FAILED"
  );
});

test("clean-room restore rejects provider or network exposure before decrypting", async (t) => {
  const {
    result,
    stagingRoot,
    evidenceRoot
  } = await successfulBackup(t);
  let decryptCalls = 0;
  const ports = {
    async decrypt() {
      decryptCalls += 1;
    },
    async restoreFreshDatabase() {},
    async restoreFreshAppState() {}
  };
  await assert.rejects(
    verifyCleanRoomRestore({
      attemptRoot: result.attemptRoot,
      stagingRoot,
      evidenceRoot,
      providerEgressState: {
        ...HELD_PROVIDER_EGRESS_STATE,
        recoveryEmail: "production"
      },
      restoreTarget: {
        networkExposure: "none"
      },
      ports
    }),
    (error) =>
      error.code ===
      "RESTORE_PROVIDER_EGRESS_NOT_HELD"
  );
  await assert.rejects(
    verifyCleanRoomRestore({
      attemptRoot: result.attemptRoot,
      stagingRoot,
      evidenceRoot,
      providerEgressState:
        HELD_PROVIDER_EGRESS_STATE,
      restoreTarget: {
        networkExposure: "loopback"
      },
      ports
    }),
    (error) =>
      error.code ===
      "RESTORE_NETWORK_EXPOSURE_FORBIDDEN"
  );
  assert.equal(decryptCalls, 0);
});

test("safe command boundary rejects secrets in argv and production backup keeps the database URL out of every argument", async () => {
  const runner = createSafeCommandRunner();
  assert.throws(
    () =>
      runner.run(
        "example",
        ["--url=secret-value"],
        {
          secretValues: ["secret-value"]
        }
      ),
    (error) =>
      error.code === "BACKUP_SECRET_IN_ARGV"
  );

  const calls = [];
  const databaseUrl =
    "postgresql://secret-user:secret-password@db.internal/sitesourcery";
  const ports = createProductionBackupPorts({
    sourceRoots: [
      {
        label: "state",
        path: "/var/lib/sitesourcery"
      }
    ],
    quiescePath:
      "/run/sitesourcery/BACKUP_QUIESCE",
    sourceFailureDomainId: "primary-01",
    databaseUrl,
    ageRecipientFile:
      "/etc/sitesourcery/backup.age-recipients",
    environment: {
      PATH: "/usr/bin",
      LD_LIBRARY_PATH: "/private/postgresql/lib",
      PGPASSWORD: "another-secret"
    },
    commandRunner: {
      async run(command, args, options) {
        calls.push({
          command,
          args,
          options
        });
        if (
          options.label ===
          "PostgreSQL invariant probe"
        ) {
          return {
            code: 0,
            stdout: JSON.stringify(
              DATABASE_MANIFEST
            )
          };
        }
        return { code: 0, stdout: "" };
      }
    }
  });
  await ports.createDatabaseDump({
    outputPath: "/secure/staging/postgresql.dump"
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(
      call.args.some(
        (argument) =>
          argument.includes(databaseUrl) ||
          argument.includes("secret-password") ||
          argument.includes("another-secret")
      ),
      false
    );
  }
  assert.equal(
    calls[0].options.env.PGDATABASE,
    "sitesourcery"
  );
  assert.equal(
    calls[0].options.env.PGHOST,
    "db.internal"
  );
  assert.equal(
    calls[0].options.env.PGUSER,
    "secret-user"
  );
  assert.equal(
    calls[0].options.env.PGPASSWORD,
    "secret-password"
  );
  assert.equal(
    calls[0].options.env.LD_LIBRARY_PATH,
    "/private/postgresql/lib"
  );
});

test("clean-room restore forwards the private PostgreSQL client library path without putting credentials in argv", () => {
  const selected = restoreLibpqEnvironment(
    {
      PATH: "/private/postgresql/bin:/usr/bin",
      LD_LIBRARY_PATH: "/private/postgresql/lib"
    },
    new URL(
      "postgresql://restore-user:restore-secret@localhost/sitesourcery_restore_001?host=%2Frun%2Fuser%2F1000%2Fpostgresql&port=55443"
    )
  );
  assert.deepEqual(selected, {
    PATH: "/private/postgresql/bin:/usr/bin",
    LANG: "C",
    LC_ALL: "C",
    PGDATABASE: "sitesourcery_restore_001",
    PGCONNECT_TIMEOUT: "10",
    PGHOST: "/run/user/1000/postgresql",
    PGPORT: "55443",
    PGUSER: "restore-user",
    PGPASSWORD: "restore-secret",
    LD_LIBRARY_PATH: "/private/postgresql/lib"
  });
});

test("clean-room app restore preserves the exact archived permission inventory", async (t) => {
  const { root } = await setup(t);
  const appRestoreRoot = path.join(
    root,
    "restored-app-state"
  );
  const calls = [];
  const ports = createProductionRestorePorts({
    ageIdentityFile: "/private/age-identity",
    adminDatabaseUrl:
      "postgresql://restore@localhost/postgres",
    targetDatabaseName:
      "sitesourcery_restore_modes_001",
    appRestoreRoot,
    environment: { PATH: "/usr/bin" },
    commandRunner: {
      async run(command, args, options) {
        calls.push({ command, args, options });
        await mkdir(
          path.join(appRestoreRoot, "state"),
          { mode: 0o750 }
        );
        await writeFile(
          path.join(
            appRestoreRoot,
            "state",
            "private.txt"
          ),
          "restored\n",
          { mode: 0o640 }
        );
        return { code: 0, stdout: "" };
      }
    }
  });
  const restored = await ports.restoreFreshAppState({
    archivePath: "/private/app-state.tar",
    expected: {
      schema:
        "sitesourcery.app-state-inventory/v1",
      entries: [
        {
          root: "state",
          path: ".",
          type: "directory",
          mode: "0750"
        },
        {
          root: "state",
          path: "private.txt",
          type: "file",
          mode: "0640",
          bytes: 9
        }
      ]
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "tar");
  assert.equal(
    calls[0].args.includes("--same-permissions"),
    true
  );
  assert.equal(
    calls[0].args.includes("--no-same-owner"),
    true
  );
  assert.equal(
    restored.entries.find(
      (entry) => entry.path === "private.txt"
    )?.mode,
    "0640"
  );
});

test("production and production-rehearsal backup ports pin distinct exact systemd boundaries", () => {
  const common = {
    sourceRoots: [
      {
        label: "state",
        path: "/var/lib/sitesourcery"
      }
    ],
    sourceFailureDomainId: "primary-01",
    databaseUrl:
      "postgresql://database.invalid/sitesourcery",
    ageRecipientFile:
      "/etc/sitesourcery/backup.age-recipients",
    environment: { PATH: "/usr/bin" },
    commandRunner: { async run() {} }
  };
  const production = createProductionBackupPorts({
    ...common,
    quiescePath:
      "/run/sitesourcery/BACKUP_QUIESCE"
  });
  assert.deepEqual(production.boundary, {
    runtimeUnit: "sitesourcery-hosted.service",
    systemctlScope: "system",
    quiescePath:
      "/run/sitesourcery/BACKUP_QUIESCE",
    requiredMarkerUid: 0
  });

  const uid = process.getuid();
  const rehearsalPath =
    productionRehearsalQuiescePath(uid);
  const rehearsal =
    createProductionRehearsalBackupPorts({
      ...common,
      quiescePath: rehearsalPath
    });
  assert.deepEqual(rehearsal.boundary, {
    runtimeUnit:
      PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
    systemctlScope: "user",
    quiescePath: rehearsalPath,
    requiredMarkerUid: uid
  });
  assert.throws(
    () =>
      createProductionRehearsalBackupPorts({
        ...common,
        quiescePath:
          "/run/sitesourcery/BACKUP_QUIESCE"
      }),
    (error) =>
      error.code ===
      "BACKUP_QUIESCE_PATH_INVALID"
  );
  assert.throws(
    () => productionRehearsalQuiescePath(0),
    (error) =>
      error.code ===
      "BACKUP_REHEARSAL_USER_INVALID"
  );
});

test("production backup monitoring fully verifies only the newest timestamp-bound successful attempt", async (t) => {
  const older = await successfulBackup(t, {
    attemptId: "older-attempt-001"
  });
  const newerResult = await runBackupAttempt({
    destinationRoot: older.destinationRoot,
    stagingRoot: older.stagingRoot,
    destinationMarker: DESTINATION_MARKER,
    sourceFailureDomainId: "primary-01",
    ageRecipient:
      "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    sourceOperationsState: HELDS,
    providerEgress: "held",
    ports: fakeBackupPorts(),
    now: () =>
      new Date("2026-07-29T12:10:00.000Z"),
    attemptIdFactory: () =>
      "newer-attempt-001"
  });
  await writeFile(
    path.join(
      older.destinationRoot,
      ".sitesourcery-off-machine.json"
    ),
    `${JSON.stringify(DESTINATION_MARKER)}\n`,
    { mode: 0o600 }
  );
  const olderArtifact = path.join(
    older.result.attemptRoot,
    "postgresql.age"
  );
  await chmod(olderArtifact, 0o600);
  await writeFile(olderArtifact, "older-corruption");
  await chmod(olderArtifact, 0o400);

  const production =
    createProductionMonitoringProbes({
      databaseUrl:
        "postgresql://monitor:private@127.0.0.1:1/sitesourcery",
      dataRoot: older.root,
      backupDestinationRoot:
        older.destinationRoot,
      sourceFailureDomainId: "primary-01",
      certificateFile: null,
      certificateHostname: null,
      expectedOperationsState: HELDS
    });
  try {
    const latest =
      await production.probes.backup();
    assert.equal(
      latest.attemptId,
      newerResult.attemptId
    );
    const newerArtifact = path.join(
      newerResult.attemptRoot,
      "postgresql.age"
    );
    await chmod(newerArtifact, 0o600);
    await writeFile(
      newerArtifact,
      "newer-corruption"
    );
    await chmod(newerArtifact, 0o400);
    await assert.rejects(
      production.probes.backup(),
      (error) =>
        error.code ===
        "BACKUP_ARTIFACT_TAMPERED"
    );
  } finally {
    await production.close();
  }
});

function healthyProbes(
  operationsState = HELDS
) {
  return {
    async runtime() {
      return {
        ok: true,
        publicationHeld:
          operationsState.publication ===
          "held",
        operationsState
      };
    },
    async database() {
      return {
        ready: true,
        runtimeContractV13: true,
        runtimeContractV14: true,
        runtimeContractV15: true,
        shadowSchemaAbsent: true,
        domainHeld:
          operationsState.domainRuntime ===
          "held"
      };
    },
    async backup() {
      return {
        verified: true,
        completedAt:
          "2026-07-29T11:00:00.000Z"
      };
    },
    async disk() {
      return {
        freeBytes: 80 * 1024 ** 3,
        totalBytes: 100 * 1024 ** 3
      };
    },
    async certificate() {
      if (
        operationsState.publication ===
          "held" &&
        operationsState.dns === "held"
      ) {
        return { held: true };
      }
      return {
        valid: true,
        notAfter:
          "2026-10-29T12:05:00.000Z"
      };
    },
    async backlog() {
      return {
        cancellationReady: 0,
        cancellationAmbiguous: 0,
        oldestCancellationReadyAt: null,
        exportQueued: 0,
        exportBuilding: 0,
        exportLeaseExpired: 0,
        exportManualReview: 0,
        oldestExportQueuedAt: null,
        oldestExportLeaseExpiredAt: null,
        reconciliationOpenCases: 0,
        reconciliationSuppressionConflicts: 0,
        oldestReconciliationOpenAt: null
      };
    }
  };
}

test("held monitor covers every required signal and performs no outbound alert effect", async () => {
  const result = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes: healthyProbes(),
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.equal(result.report.ok, true);
  assert.deepEqual(
    result.report.checks.map(
      (check) => check.name
    ),
    [
      "backlog",
      "backup",
      "certificate",
      "database",
      "disk",
      "runtime"
    ]
  );
  assert.deepEqual(result.report.alerts, []);
  assert.deepEqual(result.delivery, {
    attempted: false,
    delivered: false,
    mode: "none"
  });
});

test("certificate monitoring stays explicitly held until the reviewed public edge requires a real certificate", async () => {
  const heldProduction =
    createProductionMonitoringProbes({
      databaseUrl:
        "postgresql://monitor:private@127.0.0.1:1/sitesourcery",
      dataRoot: os.tmpdir(),
      backupDestinationRoot: os.tmpdir(),
      sourceFailureDomainId: "primary-01",
      certificateFile: null,
      certificateHostname: null,
      expectedOperationsState: HELDS
    });
  try {
    assert.deepEqual(
      await heldProduction.probes.certificate(),
      { held: true }
    );
  } finally {
    await heldProduction.close();
  }
  assert.throws(
    () =>
      createProductionMonitoringProbes({
        databaseUrl:
          "postgresql://monitor:private@127.0.0.1:1/sitesourcery",
        dataRoot: os.tmpdir(),
        backupDestinationRoot: os.tmpdir(),
        sourceFailureDomainId: "primary-01",
        certificateFile: null,
        certificateHostname: null,
        expectedOperationsState:
          LIVE_EDGE_OPERATIONS
      }),
    /certificate monitoring configuration is required/u
  );

  const heldDrift = healthyProbes();
  heldDrift.certificate = async () => ({
    valid: true,
    notAfter: "2026-10-29T12:05:00.000Z"
  });
  const heldResult = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes: heldDrift,
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.deepEqual(
    heldResult.report.alerts.map(
      ({ code }) => code
    ),
    ["CERTIFICATE_HOLD_STATE_DRIFT"]
  );

  const operationsStateEvidence =
    resolveOperationsStateEvidence({
      actualOperationsState:
        LIVE_EDGE_OPERATIONS,
      approval: operationsApproval(
        LIVE_EDGE_OPERATIONS
      ),
      sourceFailureDomainId: "primary-01",
      consumer: "monitor",
      now: NOW
    });
  const liveProbes = healthyProbes(
    LIVE_EDGE_OPERATIONS
  );
  liveProbes.certificate = async () => ({
    valid: true,
    notAfter: "2026-08-01T00:00:00.000Z"
  });
  const liveResult = await runOperationsMonitor({
    probes: liveProbes,
    operationsStateEvidence,
    providerEgress: "held",
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.deepEqual(
    liveResult.report.alerts.map(
      ({ code }) => code
    ),
    ["CERTIFICATE_EXPIRING_OR_INVALID"]
  );
});

test("monitor accepts an exact reviewed live-mail state while alert egress remains held", async () => {
  const operationsStateEvidence =
    resolveOperationsStateEvidence({
      actualOperationsState:
        LIVE_MAIL_OPERATIONS,
      approval: operationsApproval(),
      sourceFailureDomainId: "primary-01",
      consumer: "monitor",
      now: NOW
    });
  const result = await runOperationsMonitor({
    probes: healthyProbes(
      LIVE_MAIL_OPERATIONS
    ),
    operationsStateEvidence,
    providerEgress: "held",
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.equal(result.report.ok, true);
  assert.equal(
    result.report.sourceOperations.mode,
    "reviewed"
  );
  assert.equal(
    result.report.providerEgress,
    "held"
  );

  const drifted = healthyProbes(HELDS);
  const drift = await runOperationsMonitor({
    probes: drifted,
    operationsStateEvidence,
    providerEgress: "held",
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.deepEqual(
    drift.report.alerts.map(
      (item) => item.code
    ),
    ["RUNTIME_READINESS_OR_STATE_DRIFT"]
  );
});

test("monitor emits bounded operator alerts for DB, backup age, disk, certificate, cancellation, and export drift while delivery stays held", async () => {
  const probes = healthyProbes();
  probes.database = async () => ({
    ready: false,
    runtimeContractV13: true,
    runtimeContractV14: false,
    runtimeContractV15: false,
    shadowSchemaAbsent: true,
    domainHeld: false
  });
  probes.backup = async () => ({
    verified: true,
    completedAt:
      "2026-07-20T00:00:00.000Z"
  });
  probes.disk = async () => ({
    freeBytes: 100,
    totalBytes: 1000
  });
  probes.certificate = async () => ({
    valid: true,
    notAfter:
      "2026-08-01T00:00:00.000Z"
  });
  probes.backlog = async () => ({
    cancellationReady: 11,
    cancellationAmbiguous: 1,
    oldestCancellationReadyAt:
      "2026-07-29T11:00:00.000Z",
    exportQueued: 11,
    exportBuilding: 1,
    exportLeaseExpired: 1,
    exportManualReview: 1,
    oldestExportQueuedAt:
      "2026-07-29T10:00:00.000Z",
    oldestExportLeaseExpiredAt:
      "2026-07-29T11:00:00.000Z",
    reconciliationOpenCases: 4,
    reconciliationSuppressionConflicts: 1,
    oldestReconciliationOpenAt:
      "2026-07-28T11:00:00.000Z"
  });
  const result = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: createHeldAlertAdapter(),
    now: () => new Date(NOW)
  });
  assert.equal(result.report.ok, false);
  assert.deepEqual(
    result.report.alerts.map(
      (item) => item.code
    ),
    [
      "BACKUP_STALE_OR_INVALID",
      "CANCELLATION_BACKLOG_HIGH",
      "CANCELLATION_RECONCILIATION_REQUIRED",
      "CERTIFICATE_HOLD_STATE_DRIFT",
      "DATABASE_READINESS_OR_DOMAIN_STATE_DRIFT",
      "DISK_CAPACITY_LOW",
      "EXPORT_LEASE_BACKLOG_HIGH",
      "EXPORT_QUEUE_BACKLOG_HIGH",
      "EXPORT_RECONCILIATION_REQUIRED",
      "PROVIDER_RECONCILIATION_BACKLOG_HIGH",
      "PROVIDER_RECONCILIATION_SUPPRESSION_CONFLICT"
    ]
  );
  assert.equal(result.delivery.mode, "held");
  assert.equal(result.delivery.delivered, false);
});

test("reviewed outbound adapter requires exact expiring approval and only invokes an injected interface", async () => {
  const approval = outboundAlertApproval();
  const deliveries = [];
  const adapter =
    createReviewedOutboundAlertAdapter({
      approval,
      async deliver(envelope) {
        deliveries.push(envelope);
      },
      now: () => new Date(NOW)
    });
  const probes = healthyProbes();
  probes.runtime = async () => {
    throw new Error("loopback unavailable");
  };
  const result = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: adapter,
    now: () => new Date(NOW)
  });
  assert.equal(result.delivery.delivered, true);
  assert.equal(deliveries.length, 1);
  assert.equal(
    deliveries[0].approvalDigest,
    approval.digest
  );
  assert.equal(
    deliveries[0].report.alerts[0].code,
    "RUNTIME_PROBE_UNAVAILABLE"
  );
  assert.throws(
    () =>
      createReviewedOutboundAlertAdapter({
        approval: {
          ...approval,
          digest: "0".repeat(64)
        },
        deliver() {}
      }),
    /approval is invalid/u
  );
});

test("persistent alerts deliver one incident, suppress duplicates, remind after the reviewed interval, and deliver one recovery", async (t) => {
  const { root } = await setup(t);
  const stateFile = path.join(
    root,
    "alert-state",
    "current.json"
  );
  let current = new Date(NOW);
  const deliveries = [];
  const reviewed =
    createReviewedOutboundAlertAdapter({
      approval: outboundAlertApproval(),
      async deliver(envelope) {
        deliveries.push(envelope);
        return {
          provider: "test-provider",
          providerMessageId:
            `message-${deliveries.length}`
        };
      },
      now: () => new Date(current)
    });
  const persistent =
    createPersistentOperationsAlertAdapter({
      adapter: reviewed,
      stateFile,
      repeatIntervalMs: 6 * 60 * 60 * 1000,
      now: () => new Date(current)
    });
  const probes = healthyProbes();
  probes.runtime = async () => {
    throw new Error("loopback unavailable");
  };

  const first = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(first.delivery.delivered, true);
  assert.equal(first.delivery.transition, "incident");
  assert.equal(deliveries.length, 1);
  assert.equal(
    (await stat(stateFile)).mode & 0o777,
    0o600
  );

  current = new Date(
    "2026-07-29T12:06:00.000Z"
  );
  const duplicate = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.deepEqual(
    {
      attempted: duplicate.delivery.attempted,
      delivered: duplicate.delivery.delivered,
      required: duplicate.delivery.required,
      mode: duplicate.delivery.mode,
      code: duplicate.delivery.code
    },
    {
      attempted: false,
      delivered: false,
      required: false,
      mode: "suppressed",
      code: "DUPLICATE_ALERT_SUPPRESSED"
    }
  );
  assert.equal(deliveries.length, 1);

  probes.disk = async () => ({
    freeBytes: 100,
    totalBytes: 1000
  });
  current = new Date(
    "2026-07-29T12:07:00.000Z"
  );
  const changed = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(changed.delivery.delivered, true);
  assert.equal(changed.delivery.transition, "changed");
  assert.equal(deliveries.length, 2);

  current = new Date(
    "2026-07-29T18:07:00.000Z"
  );
  const reminder = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(reminder.delivery.delivered, true);
  assert.equal(reminder.delivery.transition, "reminder");
  assert.equal(deliveries.length, 3);

  const restored = healthyProbes();
  probes.runtime = restored.runtime;
  probes.disk = restored.disk;
  current = new Date(
    "2026-07-29T18:08:00.000Z"
  );
  const recovery = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(recovery.report.ok, true);
  assert.equal(recovery.delivery.delivered, true);
  assert.equal(recovery.delivery.transition, "recovery");
  assert.deepEqual(
    deliveries.map(
      ({ transition }) => transition.kind
    ),
    [
      "incident",
      "changed",
      "reminder",
      "recovery"
    ]
  );

  current = new Date(
    "2026-07-29T18:09:00.000Z"
  );
  const healthy = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(healthy.delivery.mode, "none");
  assert.equal(deliveries.length, 4);
});

test("a failed provider response leaves one pending transition and retries it with the same idempotent identity", async (t) => {
  const { root } = await setup(t);
  const stateFile = path.join(
    root,
    "retry-state",
    "current.json"
  );
  let current = new Date(NOW);
  let fail = true;
  const transitionIds = [];
  const reviewed =
    createReviewedOutboundAlertAdapter({
      approval: outboundAlertApproval(),
      async deliver(envelope) {
        transitionIds.push(
          envelope.transition.transitionId
        );
        if (fail) {
          throw new Error(
            "ambiguous provider response"
          );
        }
        return {
          provider: "test-provider",
          providerMessageId: "message-replayed"
        };
      },
      now: () => new Date(current)
    });
  const persistent =
    createPersistentOperationsAlertAdapter({
      adapter: reviewed,
      stateFile,
      repeatIntervalMs: 6 * 60 * 60 * 1000,
      now: () => new Date(current)
    });
  const probes = healthyProbes();
  probes.runtime = async () => {
    throw new Error("loopback unavailable");
  };
  await assert.rejects(
    runOperationsMonitor({
      ...HELD_MONITOR_CONTRACT,
      probes,
      alertAdapter: persistent,
      now: () => new Date(current)
    }),
    /ambiguous provider response/u
  );
  fail = false;
  current = new Date(
    "2026-07-29T12:06:00.000Z"
  );
  const retried = await runOperationsMonitor({
    ...HELD_MONITOR_CONTRACT,
    probes,
    alertAdapter: persistent,
    now: () => new Date(current)
  });
  assert.equal(retried.delivery.delivered, true);
  assert.equal(retried.delivery.transition, "incident");
  assert.equal(transitionIds.length, 2);
  assert.equal(transitionIds[0], transitionIds[1]);
});

test("operations candidates keep independent approvals and provider egress holds without a publication-hold dependency", async () => {
  const opsRoot = new URL("../", import.meta.url);
  const names = [
    "sitesourcery-hosted.service.held",
    "sitesourcery-backup.service.held",
    "sitesourcery-backup.timer.held",
    "sitesourcery-monitor.service.held",
    "sitesourcery-monitor.timer.held",
    "sitesourcery-restore-verify.service.held",
    "sitesourcery-caddy.service.held"
  ];
  const files = await Promise.all(
    names.map((name) =>
      readFile(new URL(name, opsRoot), "utf8")
    )
  );
  for (const index of [0, 5, 6]) {
    assert.match(
      files[index],
      /^# PUBLICATION_HOLD/u,
      names[index]
    );
  }
  for (const index of [1, 2, 3, 4]) {
    assert.match(
      files[index],
      /^# ACTIVATION_HOLD/u,
      names[index]
    );
    assert.doesNotMatch(
      files[index],
      /ConditionPathExists=.*PUBLICATION_HOLD/u,
      names[index]
    );
  }
  assert.match(
    files[0],
    /ConditionPathExists=!\/run\/sitesourcery\/BACKUP_QUIESCE/u
  );
  assert.match(
    files[1],
    /ConditionPathExists=\/run\/sitesourcery\/BACKUP_QUIESCE/u
  );
  assert.match(
    files[1],
    /ops\/run-backup\.mjs/u
  );
  assert.doesNotMatch(
    files[1],
    /systemctl (?:start|stop|restart|enable)/u
  );
  assert.match(
    files[3],
    /ops\/independent-monitor\.mjs/u
  );
  assert.doesNotMatch(
    files[3],
    /Requires=.*sitesourcery|After=.*sitesourcery|backup-mount|BACKUP_QUIESCE|SITESOURCERY_DATABASE_URL|\/mnt\/sitesourcery-backups/u
  );
  assert.match(
    files[5],
    /ops\/verify-restore\.mjs/u
  );
  assert.match(
    files[5],
    /RestrictAddressFamilies=AF_UNIX$/mu
  );
  assert.match(
    files[6],
    /^ExecStart=\/opt\/sitesourcery\/caddy-2\.11\.4\/caddy run .*Caddyfile\.candidate\.held --adapter caddyfile$/mu
  );
  assert.doesNotMatch(
    files[6],
    /\/etc\/caddy\/Caddyfile/u
  );

  const [hosted, backup, monitor, restore] =
    await Promise.all([
      readFile(
        new URL("hosted.env.example", opsRoot),
        "utf8"
      ),
      readFile(
        new URL("backup.env.example", opsRoot),
        "utf8"
      ),
      readFile(
        new URL("monitor.env.example", opsRoot),
        "utf8"
      ),
      readFile(
        new URL("restore.env.example", opsRoot),
        "utf8"
      )
    ]);
  for (const environment of [
    hosted,
    backup,
    monitor,
    restore
  ]) {
    const credentialScanSource = environment
      .replace(
        /^SITESOURCERY_HOSTED_PRIVACY_V3_(?:URI|ARTIFACT_URI)=https:\/\/sitesourcery\.com\/legal\/privacy\/versions\/SS-HOSTED-PRIVACY-2026-08-09-V3\/$/gmu,
        ""
      )
      .replace(
        /^SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_(?:URI|ARTIFACT_URI)=https:\/\/sitesourcery\.com\/legal\/website-terms\/versions\/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V3\/$/gmu,
        ""
      )
      .replace(
        /^SITESOURCERY_HOSTED_PRIVACY_V4_(?:URI|ARTIFACT_URI)=https:\/\/sitesourcery\.com\/legal\/privacy\/versions\/SS-HOSTED-PRIVACY-2026-08-09-V4\/$/gmu,
        ""
      )
      .replace(
        /^SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_(?:URI|ARTIFACT_URI)=https:\/\/sitesourcery\.com\/legal\/website-terms\/versions\/SS-HOSTED-WEBSITE-TERMS-2026-08-09-V4\/$/gmu,
        ""
      );
    assert.match(
      environment,
      /^SITESOURCERY_STRIPE_MODE=held$/mu
    );
    assert.match(
      environment,
      /^SITESOURCERY_REGISTRATION_MAIL_MODE=held$/mu
    );
    assert.doesNotMatch(
      environment,
      /SITESOURCERY_PAYMENT_MODE/u
    );
    assert.doesNotMatch(
      credentialScanSource,
      /sk_(?:live|test)_|whsec_|https?:\/\//u
    );
  }
  assert.match(
    monitor,
    /^SITESOURCERY_ALERT_MODE=held$/mu
  );
  assert.match(
    monitor,
    /^SITESOURCERY_MONITOR_TIMEOUT_MS=10000$/mu
  );
  for (const environment of [backup, monitor]) {
    assert.match(
      environment,
      /^SITESOURCERY_OPERATIONS_PROVIDER_EGRESS=held$/mu
    );
  }
  assert.match(
    restore,
    /^SITESOURCERY_ALERT_MODE=held$/mu
  );
  assert.doesNotMatch(
    monitor,
    /WEBHOOK|TOKEN|DESTINATION_URL/u
  );
});
