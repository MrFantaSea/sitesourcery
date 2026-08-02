import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  QUIESCE_SCHEMA,
  PRODUCTION_BACKUP_RUNTIME_UNIT,
  BackupFailure
} from "./backup-runtime.mjs";
import {
  canonicalJson,
  parseJsonObject,
  safeIdentifier,
  sha256Bytes,
  sha256File
} from "./immutable-evidence.mjs";

const MAX_COMMAND_OUTPUT = 64 * 1024;
export const PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT =
  "sitesourcery-production.service";

function commandFailure(label, code) {
  return new BackupFailure(
    "BACKUP_COMMAND_FAILED",
    `${label} failed with exit code ${code}.`
  );
}

export function createSafeCommandRunner({
  spawnImpl = spawn
} = {}) {
  return Object.freeze({
    run(
      command,
      args,
      {
        env = {},
        allowedExitCodes = [0],
        captureStdout = false,
        secretValues = [],
        label = "Backup command"
      } = {}
    ) {
      if (
        typeof command !== "string" ||
        !Array.isArray(args) ||
        args.some(
          (argument) => typeof argument !== "string"
        )
      ) {
        throw new BackupFailure(
          "BACKUP_COMMAND_INVALID",
          "Backup command configuration is invalid."
        );
      }
      const secrets = secretValues.filter(
        (value) =>
          typeof value === "string" &&
          value.length > 0
      );
      if (
        args.some((argument) =>
          secrets.some((secret) =>
            argument.includes(secret)
          )
        )
      ) {
        throw new BackupFailure(
          "BACKUP_SECRET_IN_ARGV",
          "A backup command attempted to put a secret in argv."
        );
      }
      return new Promise((resolve, reject) => {
        const child = spawnImpl(command, args, {
          env,
          stdio: [
            "ignore",
            captureStdout ? "pipe" : "ignore",
            "ignore"
          ]
        });
        let stdout = Buffer.alloc(0);
        child.stdout?.on("data", (chunk) => {
          if (
            stdout.length + chunk.length >
            MAX_COMMAND_OUTPUT
          ) {
            child.kill("SIGKILL");
            reject(
              new BackupFailure(
                "BACKUP_COMMAND_OUTPUT_EXCEEDED",
                `${label} produced too much output.`
              )
            );
            return;
          }
          stdout = Buffer.concat([
            stdout,
            Buffer.from(chunk)
          ]);
        });
        child.once("error", () => {
          reject(
            new BackupFailure(
              "BACKUP_COMMAND_UNAVAILABLE",
              `${label} could not start.`
            )
          );
        });
        child.once("close", (code) => {
          if (!allowedExitCodes.includes(code)) {
            reject(commandFailure(label, code));
            return;
          }
          resolve(
            Object.freeze({
              code,
              stdout: stdout.toString("utf8")
            })
          );
        });
      });
    }
  });
}

function modeString(mode) {
  return (mode & 0o7777)
    .toString(8)
    .padStart(4, "0");
}

async function walkRoot(
  absoluteRoot,
  label,
  relative = ""
) {
  const selected = path.join(
    absoluteRoot,
    relative
  );
  const metadata = await lstat(selected);
  if (metadata.isSymbolicLink()) {
    throw new BackupFailure(
      "BACKUP_APP_STATE_SYMLINK",
      "App-state snapshots refuse symbolic links."
    );
  }
  if (metadata.isDirectory()) {
    const children = (
      await readdir(selected)
    ).sort((left, right) =>
      left.localeCompare(right)
    );
    const entries = [
      {
        root: label,
        path: relative || ".",
        type: "directory",
        mode: modeString(metadata.mode)
      }
    ];
    for (const child of children) {
      if (
        child === "." ||
        child === ".." ||
        /[\u0000-\u001f\u007f]/u.test(child)
      ) {
        throw new BackupFailure(
          "BACKUP_APP_STATE_PATH_INVALID",
          "App-state paths cannot contain control characters."
        );
      }
      entries.push(
        ...(await walkRoot(
          absoluteRoot,
          label,
          path.join(relative, child)
        ))
      );
    }
    return entries;
  }
  if (!metadata.isFile()) {
    throw new BackupFailure(
      "BACKUP_APP_STATE_SPECIAL_FILE",
      "App-state snapshots refuse special files."
    );
  }
  return [
    {
      root: label,
      path: relative || ".",
      type: "file",
      mode: modeString(metadata.mode),
      bytes: metadata.size,
      sha256: await sha256File(selected)
    }
  ];
}

export async function inspectSourceRoots(
  sourceRoots
) {
  if (
    !Array.isArray(sourceRoots) ||
    sourceRoots.length === 0
  ) {
    throw new BackupFailure(
      "BACKUP_SOURCE_ROOTS_REQUIRED",
      "At least one app-state source root is required."
    );
  }
  const labels = new Set();
  const normalized = [];
  for (const source of sourceRoots) {
    const label = safeIdentifier(
      source?.label,
      "App-state root label"
    );
    if (labels.has(label)) {
      throw new BackupFailure(
        "BACKUP_SOURCE_ROOT_DUPLICATE",
        "App-state root labels must be unique."
      );
    }
    labels.add(label);
    if (
      typeof source?.path !== "string" ||
      !path.isAbsolute(source.path)
    ) {
      throw new BackupFailure(
        "BACKUP_SOURCE_ROOT_INVALID",
        "App-state roots must be absolute paths."
      );
    }
    const resolved = await realpath(source.path);
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new BackupFailure(
        "BACKUP_SOURCE_ROOT_INVALID",
        "Every app-state root must be a directory."
      );
    }
    normalized.push({
      label,
      path: resolved
    });
  }
  normalized.sort((left, right) =>
    left.label.localeCompare(right.label)
  );
  const entries = [];
  for (const source of normalized) {
    entries.push(
      ...(await walkRoot(
        source.path,
        source.label
      ))
    );
  }
  const payload = {
    schema:
      "sitesourcery.app-state-inventory/v1",
    entries
  };
  return Object.freeze({
    ...payload,
    treeSha256: sha256Bytes(
      Buffer.from(`${canonicalJson(payload)}\n`)
    ),
    sourceRoots: normalized
  });
}

function pgEnvironment(environment, databaseUrl) {
  const selected = {
    PATH: environment.PATH,
    LANG: environment.LANG ?? "C",
    LC_ALL: "C",
    PGDATABASE: databaseUrl,
    PGCONNECT_TIMEOUT: "10"
  };
  for (const field of [
    "LD_LIBRARY_PATH",
    "PGPASSFILE",
    "PGPASSWORD",
    "PGSSLMODE",
    "PGSSLROOTCERT",
    "PGSSLCERT",
    "PGSSLKEY"
  ]) {
    if (environment[field]) {
      selected[field] = environment[field];
    }
  }
  return selected;
}

function systemctlEnvironment(
  environment,
  runtimeDirectory
) {
  const selected = {
    PATH: environment.PATH,
    LANG: "C",
    LC_ALL: "C"
  };
  if (runtimeDirectory) {
    selected.XDG_RUNTIME_DIR = runtimeDirectory;
    selected.DBUS_SESSION_BUS_ADDRESS =
      `unix:path=${runtimeDirectory}/bus`;
  }
  return selected;
}

function createBackupPorts({
  sourceRoots,
  quiescePath,
  sourceFailureDomainId,
  databaseUrl,
  ageRecipientFile,
  environment = process.env,
  commandRunner = createSafeCommandRunner(),
  now = () => new Date(),
  runtimeUnit,
  systemctlPrefix,
  systemctlRuntimeDirectory,
  requiredMarkerUid
}) {
  const selectedRuntimeUnit = safeIdentifier(
    runtimeUnit,
    "Backup runtime unit"
  );
  if (
    !Array.isArray(systemctlPrefix) ||
    systemctlPrefix.some(
      (entry) => typeof entry !== "string"
    ) ||
    !Number.isSafeInteger(requiredMarkerUid) ||
    requiredMarkerUid < 0
  ) {
    throw new BackupFailure(
      "BACKUP_CONFIGURATION_INVALID",
      "The backup runtime boundary is invalid."
    );
  }
  const secrets = [
    databaseUrl,
    environment.PGPASSWORD
  ];
  let pinnedFenceDigest = null;

  async function readDatabaseInvariants() {
    const result = await commandRunner.run(
      "psql",
      [
        "-X",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--command",
        [
          "select json_build_object(",
          "'schema', 'sitesourcery.postgresql-invariants/v1',",
          "'runtimeContractV13',",
          "to_regprocedure('ss.hosted_runtime_contract_v13()') is not null,",
          "'runtimeContractV14',",
          "to_regprocedure('ss.hosted_runtime_contract_v14()') is not null,",
          "'runtimeContractV15',",
          "to_regprocedure('ss.hosted_runtime_contract_v15()') is not null,",
          "'shadowSchemaAbsent',",
          "to_regnamespace('ss_hosted') is null,",
          "'domainHeld', coalesce((",
          "select not purchasing_enabled and not live_mode",
          "from ss.domain_procurement_control",
          "where singleton",
          "), false),",
          "'serviceRoleBypassRls', coalesce((",
          "select rolbypassrls",
          "from pg_roles",
          "where rolname = 'service_role'",
          "), false),",
          "'authenticatedRoleNoBypassRls', coalesce((",
          "select not rolbypassrls",
          "from pg_roles",
          "where rolname = 'authenticated'",
          "), false),",
          "'serviceRoleSchemaUsage',",
          "has_schema_privilege('service_role', 'ss', 'USAGE'),",
          "'tableCount', (",
          "select count(*)::text",
          "from information_schema.tables",
          "where table_schema = 'ss'",
          "),",
          "'rowCounts', json_build_object(",
          "'organizations', (select count(*)::text from ss.organizations),",
          "'projects', (select count(*)::text from ss.projects),",
          "'auditEvents', (select count(*)::text from ss.audit_events),",
          "'exportRequests', (select count(*)::text from ss.export_requests),",
          "'outbox', (select count(*)::text from ss.transactional_outbox)",
          ")",
          ")::text;"
        ].join(" ")
      ],
      {
        env: pgEnvironment(
          environment,
          databaseUrl
        ),
        captureStdout: true,
        secretValues: secrets,
        label: "PostgreSQL invariant probe"
      }
    );
    const manifest = parseJsonObject(
      result.stdout.trim(),
      "PostgreSQL invariant evidence"
    );
    if (
      manifest.schema !==
        "sitesourcery.postgresql-invariants/v1" ||
      manifest.runtimeContractV13 !== true ||
      manifest.runtimeContractV14 !== true ||
      manifest.runtimeContractV15 !== true ||
      manifest.shadowSchemaAbsent !== true ||
      manifest.domainHeld !== true ||
      manifest.serviceRoleBypassRls !== true ||
      manifest
        .authenticatedRoleNoBypassRls !== true ||
      manifest.serviceRoleSchemaUsage !== true
    ) {
      throw new BackupFailure(
        "BACKUP_DATABASE_INVARIANT_FAILED",
        "PostgreSQL migrations or held invariants are not ready."
      );
    }
    return manifest;
  }

  async function readQuiesceMarker() {
    const [bytes, metadata] = await Promise.all([
      readFile(quiescePath),
      lstat(quiescePath)
    ]);
    if (
      !metadata.isFile() ||
      metadata.uid !== requiredMarkerUid ||
      (metadata.mode & 0o022) !== 0
    ) {
      throw new BackupFailure(
        "BACKUP_NOT_QUIESCED",
        "The quiesce fence must be an owner-only regular file."
      );
    }
    const marker = parseJsonObject(
      bytes.toString("utf8"),
      "Backup quiesce fence"
    );
    if (
      marker.schema !== QUIESCE_SCHEMA ||
      marker.runtimeUnit !==
        selectedRuntimeUnit ||
      marker.sourceFailureDomainId !==
        sourceFailureDomainId ||
      marker.writerFence !== "engaged"
    ) {
      throw new BackupFailure(
        "BACKUP_NOT_QUIESCED",
        "The quiesce fence does not match this runtime."
      );
    }
    const digest = sha256Bytes(bytes);
    if (
      pinnedFenceDigest &&
      digest !== pinnedFenceDigest
    ) {
      throw new BackupFailure(
        "BACKUP_NOT_QUIESCED",
        "The quiesce fence changed during capture."
      );
    }
    pinnedFenceDigest = digest;
    return { marker, digest };
  }

  async function assertQuiesced() {
    const { marker, digest } =
      await readQuiesceMarker();
    const runtime = await commandRunner.run(
      "systemctl",
      [
        ...systemctlPrefix,
        "is-active",
        selectedRuntimeUnit
      ],
      {
        env: systemctlEnvironment(
          environment,
          systemctlRuntimeDirectory
        ),
        allowedExitCodes: [3],
        captureStdout: true,
        secretValues: secrets,
        label: "Runtime quiesce probe"
      }
    );
    if (runtime.stdout.trim() !== "inactive") {
      throw new BackupFailure(
        "BACKUP_NOT_QUIESCED",
        "The hosted writer is not inactive."
      );
    }
    const writers = await commandRunner.run(
      "psql",
      [
        "-X",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--command",
        [
          "select count(*)",
          "from pg_stat_activity",
          "where datname = current_database()",
          "and pid <> pg_backend_pid()",
          "and application_name = 'sitesourcery-hosted';"
        ].join(" ")
      ],
      {
        env: pgEnvironment(
          environment,
          databaseUrl
        ),
        captureStdout: true,
        secretValues: secrets,
        label: "Database writer probe"
      }
    );
    if (writers.stdout.trim() !== "0") {
      throw new BackupFailure(
        "BACKUP_NOT_QUIESCED",
        "Hosted database writers remain connected."
      );
    }
    return {
      schema: QUIESCE_SCHEMA,
      runtimeUnit: selectedRuntimeUnit,
      runtimeState: "inactive",
      writerFence: "engaged",
      databaseWriterCount: 0,
      filesystemSnapshotStable: true,
      sourceFailureDomainId,
      snapshotId: marker.snapshotId,
      fenceDigest: digest,
      observedAt: now().toISOString(),
      expiresAt: marker.expiresAt
    };
  }

  return Object.freeze({
    boundary: Object.freeze({
      runtimeUnit: selectedRuntimeUnit,
      systemctlScope:
        systemctlPrefix.length === 0
          ? "system"
          : "user",
      quiescePath,
      requiredMarkerUid
    }),
    assertQuiesced,

    inspectAppState() {
      return inspectSourceRoots(sourceRoots);
    },

    async createDatabaseDump({ outputPath }) {
      const manifest =
        await readDatabaseInvariants();
      await commandRunner.run(
        "pg_dump",
        [
          "--format=custom",
          "--compress=9",
          "--no-owner",
          `--file=${outputPath}`
        ],
        {
          env: pgEnvironment(
            environment,
            databaseUrl
          ),
          secretValues: secrets,
          label: "PostgreSQL backup"
        }
      );
      return {
        kind: "postgresql",
        path: outputPath,
        manifest
      };
    },

    async createAppArchive({
      outputPath,
      expectedTreeSha256
    }) {
      const copyRoot = path.join(
        path.dirname(outputPath),
        "app-state"
      );
      await mkdir(copyRoot, {
        recursive: false,
        mode: 0o700
      });
      const inspected = await inspectSourceRoots(
        sourceRoots
      );
      if (
        inspected.treeSha256 !==
        expectedTreeSha256
      ) {
        throw new BackupFailure(
          "BACKUP_SNAPSHOT_CHANGED",
          "App state changed before its local snapshot was copied."
        );
      }
      for (const source of inspected.sourceRoots) {
        await cp(
          source.path,
          path.join(copyRoot, source.label),
          {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            preserveTimestamps: true
          }
        );
      }
      const copied = await inspectSourceRoots(
        inspected.sourceRoots.map((source) => ({
          label: source.label,
          path: path.join(copyRoot, source.label)
        }))
      );
      if (
        copied.treeSha256 !==
        expectedTreeSha256
      ) {
        throw new BackupFailure(
          "BACKUP_SNAPSHOT_CHANGED",
          "The local app-state snapshot does not match its source."
        );
      }
      await commandRunner.run(
        "tar",
        [
          "--create",
          "--format=pax",
          `--file=${outputPath}`,
          "--directory",
          copyRoot,
          "."
        ],
        {
          env: {
            PATH: environment.PATH,
            LANG: "C",
            LC_ALL: "C"
          },
          secretValues: secrets,
          label: "App-state archive"
        }
      );
      return {
        kind: "app_state",
        path: outputPath,
        manifest: {
          schema: copied.schema,
          treeSha256: copied.treeSha256,
          entries: copied.entries
        }
      };
    },

    async encrypt({
      inputPath,
      outputPath,
      ageRecipient
    }) {
      const configuredRecipient = (
        await readFile(
          ageRecipientFile,
          "utf8"
        )
      ).trim();
      if (configuredRecipient !== ageRecipient) {
        throw new BackupFailure(
          "BACKUP_AGE_RECIPIENT_CHANGED",
          "The age recipient input changed during backup."
        );
      }
      const pinnedRecipientFile = path.join(
        path.dirname(inputPath),
        ".age-recipients.pinned"
      );
      try {
        await writeFile(
          pinnedRecipientFile,
          `${ageRecipient}\n`,
          {
            flag: "wx",
            mode: 0o400
          }
        );
      } catch (error) {
        if (
          error?.code !== "EEXIST" ||
          (await readFile(
            pinnedRecipientFile,
            "utf8"
          )) !== `${ageRecipient}\n`
        ) {
          throw new BackupFailure(
            "BACKUP_AGE_RECIPIENT_CHANGED",
            "The pinned age recipient is inconsistent."
          );
        }
      }
      await commandRunner.run(
        "age",
        [
          "--encrypt",
          "--recipients-file",
          pinnedRecipientFile,
          "--output",
          outputPath,
          inputPath
        ],
        {
          env: {
            PATH: environment.PATH,
            LANG: "C",
            LC_ALL: "C"
          },
          secretValues: secrets,
          label: "age encryption"
        }
      );
    }
  });
}

export function productionRehearsalQuiescePath(
  uid = process.getuid?.()
) {
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0
  ) {
    throw new BackupFailure(
      "BACKUP_REHEARSAL_USER_INVALID",
      "Production rehearsal backup requires a non-root Unix user."
    );
  }
  return `/run/user/${uid}/sitesourcery-production/BACKUP_QUIESCE`;
}

export function createProductionBackupPorts(
  options
) {
  if (
    options?.quiescePath !==
    "/run/sitesourcery/BACKUP_QUIESCE"
  ) {
    throw new BackupFailure(
      "BACKUP_QUIESCE_PATH_INVALID",
      "Production backup requires the reviewed systemd writer-fence path."
    );
  }
  return createBackupPorts({
    ...options,
    runtimeUnit: PRODUCTION_BACKUP_RUNTIME_UNIT,
    systemctlPrefix: [],
    systemctlRuntimeDirectory: null,
    requiredMarkerUid: 0
  });
}

export function createProductionRehearsalBackupPorts(
  options
) {
  const uid = process.getuid?.();
  const quiescePath =
    productionRehearsalQuiescePath(uid);
  if (options?.quiescePath !== quiescePath) {
    throw new BackupFailure(
      "BACKUP_QUIESCE_PATH_INVALID",
      "Production rehearsal backup requires its exact per-user writer-fence path."
    );
  }
  const runtimeDirectory = `/run/user/${uid}`;
  return createBackupPorts({
    ...options,
    runtimeUnit:
      PRODUCTION_REHEARSAL_BACKUP_RUNTIME_UNIT,
    systemctlPrefix: ["--user"],
    systemctlRuntimeDirectory: runtimeDirectory,
    requiredMarkerUid: uid
  });
}
