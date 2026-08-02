#!/usr/bin/env node

import {
  mkdir,
  realpath,
  readFile,
  stat
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PRODUCTION_BACKUP_RUNTIME_UNIT,
  runBackupAttempt
} from "./backup-runtime.mjs";
import {
  PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
  createProductionBackupPorts,
  createProductionRehearsalBackupPorts
} from "./backup-ports.mjs";
import {
  parseJsonObject
} from "./immutable-evidence.mjs";
import {
  assertOperationsProviderEgressHeld,
  operationsStateFromEnvironment,
  readOperationsStateApprovalFile
} from "./operations-state.mjs";

function required(environment, field) {
  const value = environment[field];
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function absolute(environment, field) {
  const value = required(environment, field);
  if (!path.isAbsolute(value)) {
    throw new Error(`${field} must be absolute.`);
  }
  return path.resolve(value);
}

async function assertDirectory(directory, field) {
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) {
    throw new Error(`${field} must be a directory.`);
  }
}

function pathsOverlap(left, right) {
  return (
    left === right ||
    left.startsWith(`${right}${path.sep}`) ||
    right.startsWith(`${left}${path.sep}`)
  );
}

async function backupFromEnvironmentWithBoundary(
  environment,
  {
    createPorts,
    quiesceRuntimeUnit
  }
) {
  const destinationRoot = absolute(
    environment,
    "SITESOURCERY_BACKUP_DESTINATION_ROOT"
  );
  const stagingRoot = absolute(
    environment,
    "SITESOURCERY_BACKUP_STAGING_ROOT"
  );
  const ageRecipientFile = absolute(
    environment,
    "SITESOURCERY_BACKUP_AGE_RECIPIENT_FILE"
  );
  const sourceFailureDomainId = required(
    environment,
    "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
  );
  const quiescePath = absolute(
    environment,
    "SITESOURCERY_BACKUP_QUIESCE_PATH"
  );
  const dataRoot = absolute(
    environment,
    "SITESOURCERY_DATA_ROOT"
  );
  const sourceRoots = [
    {
      label: "private_exports",
      path: absolute(
        environment,
        "SITESOURCERY_EXPORT_ROOT"
      )
    },
    {
      label: "tenant_runtime",
      path: path.join(
        dataRoot,
        "tenant-runtime"
      )
    },
    {
      label: "release",
      path: absolute(
        environment,
        "SITESOURCERY_RELEASE_ROOT"
      )
    },
    {
      label: "configuration",
      path: absolute(
        environment,
        "SITESOURCERY_CONFIGURATION_ROOT"
      )
    }
  ];

  await Promise.all([
    assertDirectory(
      destinationRoot,
      "Backup destination"
    ),
    mkdir(stagingRoot, {
      recursive: true,
      mode: 0o700
    }),
    ...sourceRoots.map((source) =>
      assertDirectory(
        source.path,
        `Backup source ${source.label}`
      )
    )
  ]);
  const [
    resolvedDestination,
    resolvedStaging,
    ...resolvedSources
  ] = await Promise.all([
    realpath(destinationRoot),
    realpath(stagingRoot),
    ...sourceRoots.map((source) =>
      realpath(source.path)
    )
  ]);
  const storageRoots = [
    {
      label: "destination",
      path: resolvedDestination
    },
    {
      label: "staging",
      path: resolvedStaging
    },
    ...sourceRoots.map((source, index) => ({
      label: `source ${source.label}`,
      path: resolvedSources[index]
    }))
  ];
  for (
    let leftIndex = 0;
    leftIndex < storageRoots.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < storageRoots.length;
      rightIndex += 1
    ) {
      if (
        pathsOverlap(
          storageRoots[leftIndex].path,
          storageRoots[rightIndex].path
        )
      ) {
        throw new Error(
          `Backup ${storageRoots[leftIndex].label} and ${storageRoots[rightIndex].label} roots must be mutually disjoint.`
        );
      }
    }
  }

  const markerBytes = await readFile(
    path.join(
      resolvedDestination,
      ".sitesourcery-off-machine.json"
    ),
    "utf8"
  );
  const destinationMarker = parseJsonObject(
    markerBytes,
    "Off-machine destination marker"
  );
  const ageRecipient = await readFile(
    ageRecipientFile,
    "utf8"
  );
  const operationsStateApproval =
    await readOperationsStateApprovalFile(
      environment
        .SITESOURCERY_OPERATIONS_STATE_APPROVAL_FILE
    );
  const ports = createPorts({
    sourceRoots: sourceRoots.map(
      (source, index) => ({
        label: source.label,
        path: resolvedSources[index]
      })
    ),
    quiescePath,
    sourceFailureDomainId,
    databaseUrl: required(
      environment,
      "SITESOURCERY_DATABASE_URL"
    ),
    ageRecipientFile,
    environment
  });
  return runBackupAttempt({
    destinationRoot: resolvedDestination,
    destinationMarker,
    sourceFailureDomainId,
    stagingRoot: resolvedStaging,
    ageRecipient,
    sourceOperationsState:
      operationsStateFromEnvironment(
        environment
      ),
    operationsStateApproval,
    providerEgress:
      assertOperationsProviderEgressHeld(
        environment
          .SITESOURCERY_OPERATIONS_PROVIDER_EGRESS
      ),
    quiesceRuntimeUnit,
    ports
  });
}

export function backupFromEnvironment(
  environment = process.env
) {
  return backupFromEnvironmentWithBoundary(
    environment,
    {
      createPorts: createProductionBackupPorts,
      quiesceRuntimeUnit:
        PRODUCTION_BACKUP_RUNTIME_UNIT
    }
  );
}

export function backupProductionRehearsalFromEnvironment(
  environment = process.env
) {
  return backupFromEnvironmentWithBoundary(
    environment,
    {
      createPorts:
        createProductionRehearsalBackupPorts,
      quiesceRuntimeUnit:
        PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT
    }
  );
}

async function main() {
  const result = await backupFromEnvironment();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      attemptId: result.attemptId,
      completedAt: result.completedAt,
      manifestSha256: result.manifestSha256,
      artifactCount: result.artifactCount
    })}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        code:
          typeof error?.code === "string"
            ? error.code
            : "BACKUP_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
