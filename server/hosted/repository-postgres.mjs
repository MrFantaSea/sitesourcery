import pg from "pg";

import { HostedError, invariant } from "./errors.mjs";

const { Pool } = pg;

const TRANSACTION_ROLES = Object.freeze({
  authenticated: "authenticated",
  service: "service_role"
});
const ISOLATION_LEVELS = Object.freeze({
  "read-committed": "READ COMMITTED",
  "repeatable-read": "REPEATABLE READ",
  serializable: "SERIALIZABLE"
});

const READINESS_QUERY = `
  select
    current_database() as database_name,
    to_regnamespace('ss_hosted') is null as shadow_schema_absent,
    to_regclass('auth.users') is not null as users_ready,
    to_regclass('ss.hosted_account_profiles') is not null as identity_ready,
    to_regclass('ss.hosted_password_credentials') is not null as passwords_ready,
    to_regclass('ss.hosted_sessions') is not null as sessions_ready,
    to_regclass('ss.hosted_auth_rate_limits') is not null as auth_limits_ready,
    to_regclass('ss.hosted_registration_requests') is not null
      as registration_ready,
    (
      select count(*) = 4
        from information_schema.columns
       where table_schema = 'ss'
         and table_name = 'hosted_registration_requests'
         and column_name in (
           'token_digest',
           'state',
           'activation_command_id',
           'delivery_receipt_digest'
         )
    ) as registration_contract_ready,
    to_regclass('ss.organizations') is not null as organizations_ready,
    to_regclass('ss.organization_memberships') is not null as memberships_ready,
    to_regclass('ss.projects') is not null as projects_ready,
    to_regclass('ss.project_drafts') is not null as drafts_ready,
    to_regclass('ss.site_versions') is not null as versions_ready,
    to_regclass('ss.project_addresses') is not null as addresses_ready,
    to_regclass('ss.commerce_quotes') is not null as commerce_ready,
    to_regclass('ss.catalog_offer_price_lines') is not null as offer_prices_ready,
    to_regclass('ss.commerce_quote_price_lines') is not null as quote_prices_ready,
    to_regclass('ss.checkout_intent_price_lines') is not null as checkout_prices_ready,
    (
      to_regprocedure('ss.hosted_runtime_contract_v13()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v14()') is not null
      and to_regprocedure('ss.hosted_runtime_contract_v15()') is not null
    )
      as runtime_contract_ready,
    to_regprocedure('ss.hosted_runtime_contract_v18()') is not null
      as verified_registration_contract_ready,
    to_regclass('ss.commerce_v2_commands') is not null
      as commerce_v2_commands_ready,
    to_regclass('ss.commerce_v2_download_quotes') is not null
      as commerce_v2_quotes_ready,
    to_regclass('ss.commerce_v2_checkout_preparations') is not null
      as commerce_v2_preparations_ready,
    to_regprocedure('ss.hosted_runtime_contract_v19()') is not null
      as commerce_v2_contract_ready,
    to_regclass('ss.release_requests') is not null as releases_ready,
    to_regclass('ss.export_requests') is not null as exports_ready,
    to_regclass('ss.export_download_authorizations') is not null as export_grants_ready,
    to_regclass('ss.audit_events') is not null as audit_ready,
    to_regclass('ss.idempotency_keys') is not null as idempotency_ready
`;

function requiredString(value, code, message) {
  invariant(
    typeof value === "string" && value.length > 0,
    code,
    message,
    { status: 500 }
  );
  return value;
}

function transactionRole(value) {
  const role = TRANSACTION_ROLES[value];
  invariant(
    role,
    "DATABASE_TRANSACTION_INVALID",
    "PostgreSQL transaction role is invalid.",
    { status: 500 }
  );
  return role;
}

function isolationLevel(value) {
  const isolation = ISOLATION_LEVELS[value];
  invariant(
    isolation,
    "DATABASE_TRANSACTION_INVALID",
    "PostgreSQL isolation level is invalid.",
    { status: 500 }
  );
  return isolation;
}

async function rollback(client) {
  try {
    await client.query("rollback");
  } catch {
    // The original transaction failure remains authoritative.
  }
}

export function createPostgresPool(options = {}) {
  const connectionString =
    options.connectionString ?? process.env.SITESOURCERY_DATABASE_URL;
  requiredString(
    connectionString,
    "DATABASE_CONFIGURATION_REQUIRED",
    "SITESOURCERY_DATABASE_URL is required."
  );
  return new Pool({
    connectionString,
    application_name: "sitesourcery-hosted",
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    allowExitOnIdle: options.allowExitOnIdle ?? false,
    ssl: options.ssl
  });
}

export function createCanonicalPostgresAuthority({ pool } = {}) {
  invariant(
    pool &&
      typeof pool.connect === "function" &&
      typeof pool.query === "function",
    "DATABASE_CONFIGURATION_REQUIRED",
    "PostgreSQL pool is required.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const result = await pool.query(READINESS_QUERY);
      const row = result.rows[0];
      if (!row?.shadow_schema_absent) {
        return {
          ready: false,
          kind: "canonical-postgres",
          code: "SHADOW_SCHEMA_PRESENT",
          database: row?.database_name ?? null
        };
      }
      const missing = Object.entries(row)
        .filter(
          ([key, value]) =>
            key.endsWith("_ready") && value !== true
        )
        .map(([key]) => key.replace(/_ready$/u, ""))
        .sort();
      if (missing.length > 0) {
        return {
          ready: false,
          kind: "canonical-postgres",
          code: "DATABASE_NOT_MIGRATED",
          database: row.database_name,
          missing
        };
      }
      return {
        ready: true,
        kind: "canonical-postgres",
        database: row.database_name,
        authoritySchema: "ss"
      };
    } catch {
      return {
        ready: false,
        kind: "canonical-postgres",
        code: "DATABASE_UNAVAILABLE",
        database: null
      };
    }
  }

  async function assertReady() {
    const status = await readiness();
    invariant(
      status.ready,
      status.code,
      status.code === "SHADOW_SCHEMA_PRESENT"
        ? "The unsupported ss_hosted shadow schema must be removed before startup."
        : "Canonical PostgreSQL migrations 000 through 015 plus identity migrations 017 and 018 and commerce migration 019 are required.",
      { status: 503, details: status }
    );
    return status;
  }

  async function transaction(
    {
      role = "authenticated",
      userId = null,
      organizationId = null,
      isolation = "serializable",
      readOnly = false
    },
    work
  ) {
    const selectedRole = transactionRole(role);
    const selectedIsolation = isolationLevel(isolation);
    invariant(
      typeof work === "function",
      "DATABASE_TRANSACTION_INVALID",
      "PostgreSQL transaction work is required.",
      { status: 500 }
    );
    if (selectedRole === "authenticated") {
      requiredString(
        userId,
        "DATABASE_PRINCIPAL_REQUIRED",
        "An authenticated PostgreSQL user principal is required."
      );
      requiredString(
        organizationId,
        "DATABASE_TENANT_REQUIRED",
        "An authenticated PostgreSQL organization scope is required."
      );
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `set transaction isolation level ${selectedIsolation}${
          readOnly ? " read only" : ""
        }`
      );
      await client.query(`set local role ${selectedRole}`);
      await client.query(
        "select set_config('request.jwt.claim.sub', $1, true)",
        [userId ?? ""]
      );
      await client.query(
        "select set_config('request.jwt.claims', $1, true)",
        [
          JSON.stringify({
            ...(userId ? { sub: userId } : {}),
            ...(organizationId
              ? { organization_id: organizationId }
              : {})
          })
        ]
      );
      await client.query(
        "select set_config('app.organization_id', $1, true)",
        [organizationId ?? ""]
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    kind: "canonical-postgres",
    pool,
    readiness,
    assertReady,

    tenant({ userId, organizationId, isolation, readOnly = false }, work) {
      return transaction(
        {
          role: "authenticated",
          userId,
          organizationId,
          isolation,
          readOnly
        },
        work
      );
    },

    service(
      { userId = null, organizationId = null, isolation, readOnly = false } = {},
      work
    ) {
      return transaction(
        {
          role: "service",
          userId,
          organizationId,
          isolation,
          readOnly
        },
        work
      );
    },

    async close() {
      await pool.end();
    }
  });
}

// Kept as an explicit failure for stale imports. The aggregate JSON repository
// was a prototype and is not a production persistence option.
export function createPostgresHostedRepository() {
  throw new HostedError(
    "AGGREGATE_POSTGRES_REMOVED",
    "Use createCanonicalPostgresAuthority; production data belongs in normalized ss tables.",
    { status: 500 }
  );
}
