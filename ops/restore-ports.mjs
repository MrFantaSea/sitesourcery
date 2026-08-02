import {
  mkdir,
  readdir,
  stat
} from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import {
  BackupFailure
} from "./backup-runtime.mjs";
import {
  createSafeCommandRunner,
  inspectSourceRoots
} from "./backup-ports.mjs";

const { Pool } = pg;

function databaseName(value) {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9_]{7,62}$/u.test(value)
  ) {
    throw new BackupFailure(
      "RESTORE_DATABASE_NAME_INVALID",
      "Restore database name must be a safe dedicated identifier."
    );
  }
  return value;
}

function targetDatabaseUrl(
  adminDatabaseUrl,
  targetName
) {
  let selected;
  try {
    selected = new URL(adminDatabaseUrl);
  } catch {
    throw new BackupFailure(
      "RESTORE_DATABASE_CONFIGURATION_INVALID",
      "Restore administrator database URL is invalid."
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(
      selected.protocol
    )
  ) {
    throw new BackupFailure(
      "RESTORE_DATABASE_CONFIGURATION_INVALID",
      "Restore requires a PostgreSQL administrator URL."
    );
  }
  selected.pathname = `/${targetName}`;
  return selected;
}

export function restoreLibpqEnvironment(
  environment,
  url
) {
  const queryHost = url.searchParams.get("host");
  const selected = {
    PATH: environment.PATH,
    LANG: environment.LANG ?? "C",
    LC_ALL: "C",
    PGDATABASE: decodeURIComponent(
      url.pathname.slice(1)
    ),
    PGCONNECT_TIMEOUT: "10"
  };
  if (queryHost || url.hostname) {
    selected.PGHOST =
      queryHost ?? decodeURIComponent(url.hostname);
  }
  if (url.port) {
    selected.PGPORT = url.port;
  } else if (url.searchParams.get("port")) {
    selected.PGPORT =
      url.searchParams.get("port");
  }
  if (url.username) {
    selected.PGUSER = decodeURIComponent(
      url.username
    );
  }
  if (url.password) {
    selected.PGPASSWORD = decodeURIComponent(
      url.password
    );
  }
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) {
    selected.PGSSLMODE = sslMode;
  }
  for (const field of [
    "LD_LIBRARY_PATH",
    "PGPASSFILE",
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

async function databaseInvariants(pool) {
  const result = await pool.query(`
    select
      current_database() as database_name,
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
      ), false) as domain_held,
      coalesce((
        select rolbypassrls
        from pg_roles
        where rolname = 'service_role'
      ), false) as service_role_bypass_rls,
      coalesce((
        select not rolbypassrls
        from pg_roles
        where rolname = 'authenticated'
      ), false)
        as authenticated_role_no_bypass_rls,
      has_schema_privilege(
        'service_role',
        'ss',
        'USAGE'
      ) as service_role_schema_usage,
      (
        select count(*)::text
        from information_schema.tables
        where table_schema = 'ss'
      ) as table_count,
      (
        select count(*)::text
        from ss.organizations
      ) as organizations,
      (
        select count(*)::text
        from ss.projects
      ) as projects,
      (
        select count(*)::text
        from ss.audit_events
      ) as audit_events,
      (
        select count(*)::text
        from ss.export_requests
      ) as export_requests,
      (
        select count(*)::text
        from ss.transactional_outbox
      ) as outbox
  `);
  const row = result.rows[0];
  return Object.freeze({
    freshDatabase: true,
    databaseName: row.database_name,
    runtimeContractV13:
      row.runtime_contract_v13 === true,
    runtimeContractV14:
      row.runtime_contract_v14 === true,
    runtimeContractV15:
      row.runtime_contract_v15 === true,
    shadowSchemaAbsent:
      row.shadow_schema_absent === true,
    domainHeld: row.domain_held === true,
    serviceRoleBypassRls:
      row.service_role_bypass_rls === true,
    authenticatedRoleNoBypassRls:
      row.authenticated_role_no_bypass_rls ===
      true,
    serviceRoleSchemaUsage:
      row.service_role_schema_usage === true,
    tableCount: row.table_count,
    rowCounts: {
      organizations: row.organizations,
      projects: row.projects,
      auditEvents: row.audit_events,
      exportRequests: row.export_requests,
      outbox: row.outbox
    }
  });
}

function assertManifestPaths(expected) {
  if (
    expected?.schema !==
      "sitesourcery.app-state-inventory/v1" ||
    !Array.isArray(expected.entries) ||
    expected.entries.length === 0
  ) {
    throw new BackupFailure(
      "RESTORE_APP_MANIFEST_INVALID",
      "App-state restore manifest is invalid."
    );
  }
  for (const entry of expected.entries) {
    if (
      typeof entry.root !== "string" ||
      typeof entry.path !== "string" ||
      path.isAbsolute(entry.path) ||
      entry.path.split(path.sep).includes("..") ||
      /[\u0000-\u001f\u007f]/u.test(entry.path)
    ) {
      throw new BackupFailure(
        "RESTORE_APP_MANIFEST_INVALID",
        "App-state restore paths are unsafe."
      );
    }
  }
}

export function createProductionRestorePorts({
  ageIdentityFile,
  adminDatabaseUrl,
  targetDatabaseName,
  appRestoreRoot,
  environment = process.env,
  commandRunner = createSafeCommandRunner()
}) {
  const targetName = databaseName(
    targetDatabaseName
  );
  const targetUrl = targetDatabaseUrl(
    adminDatabaseUrl,
    targetName
  );
  const secrets = [
    adminDatabaseUrl,
    decodeURIComponent(targetUrl.password),
    environment.PGPASSWORD
  ];
  let databaseCreated = false;
  let appRootCreated = false;

  return Object.freeze({
    async decrypt({ inputPath, outputPath }) {
      await commandRunner.run(
        "age",
        [
          "--decrypt",
          "--identity",
          ageIdentityFile,
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
          label: "age decryption"
        }
      );
    },

    async restoreFreshDatabase({ dumpPath }) {
      if (databaseCreated) {
        throw new BackupFailure(
          "RESTORE_DATABASE_NOT_FRESH",
          "A restore may create its target database only once."
        );
      }
      const admin = new Pool({
        connectionString: adminDatabaseUrl,
        application_name:
          "sitesourcery-clean-room-restore",
        max: 1,
        connectionTimeoutMillis: 5000
      });
      try {
        const roles = await admin.query(`
          select count(*)::integer as role_count
          from pg_roles
          where rolname in (
            'anon',
            'authenticated',
            'service_role'
          )
        `);
        if (roles.rows[0]?.role_count !== 3) {
          throw new BackupFailure(
            "RESTORE_CLUSTER_ROLES_MISSING",
            "The clean-room cluster is missing canonical migration roles."
          );
        }
        const present = await admin.query(
          "select 1 from pg_database where datname = $1",
          [targetName]
        );
        if (present.rowCount !== 0) {
          throw new BackupFailure(
            "RESTORE_DATABASE_NOT_FRESH",
            "Restore target database already exists."
          );
        }
        await admin.query(
          `create database "${targetName}"`
        );
        databaseCreated = true;
      } finally {
        await admin.end();
      }
      await commandRunner.run(
        "pg_restore",
        [
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--dbname",
          targetName,
          dumpPath
        ],
        {
          env: restoreLibpqEnvironment(
            environment,
            targetUrl
          ),
          secretValues: secrets,
          label: "PostgreSQL clean-room restore"
        }
      );
      const restored = new Pool({
        connectionString: targetUrl.href,
        application_name:
          "sitesourcery-restore-verifier",
        max: 1,
        connectionTimeoutMillis: 5000
      });
      try {
        return await databaseInvariants(restored);
      } finally {
        await restored.end();
      }
    },

    async restoreFreshAppState({
      archivePath,
      expected
    }) {
      if (appRootCreated) {
        throw new BackupFailure(
          "RESTORE_APP_ROOT_NOT_FRESH",
          "A restore may create its app-state root only once."
        );
      }
      assertManifestPaths(expected);
      try {
        const existing = await stat(appRestoreRoot);
        if (
          !existing.isDirectory() ||
          (await readdir(appRestoreRoot))
            .length !== 0
        ) {
          throw new BackupFailure(
            "RESTORE_APP_ROOT_NOT_FRESH",
            "Restore app-state target must be absent or empty."
          );
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        await mkdir(appRestoreRoot, {
          recursive: false,
          mode: 0o700
        });
      }
      appRootCreated = true;
      await commandRunner.run(
        "tar",
        [
          "--extract",
          `--file=${archivePath}`,
          "--directory",
          appRestoreRoot,
          "--same-permissions",
          "--no-same-owner"
        ],
        {
          env: {
            PATH: environment.PATH,
            LANG: "C",
            LC_ALL: "C"
          },
          secretValues: secrets,
          label: "App-state clean-room restore"
        }
      );
      const roots = [
        ...new Set(
          expected.entries.map(
            (entry) => entry.root
          )
        )
      ]
        .sort((left, right) =>
          left.localeCompare(right)
        )
        .map((label) => ({
          label,
          path: path.join(
            appRestoreRoot,
            label
          )
        }));
      const restored = await inspectSourceRoots(
        roots
      );
      return Object.freeze({
        freshRoot: true,
        treeSha256: restored.treeSha256,
        entries: restored.entries
      });
    }
  });
}
