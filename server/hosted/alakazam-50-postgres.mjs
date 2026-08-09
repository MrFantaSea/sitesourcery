import {
  CommerceV2Error,
  invariant
} from "../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_50_HOLD_REASON,
  createAlakazam50CareRequest,
  createAlakazam50Configuration,
  createAlakazam50Snapshot
} from "../commerce-v2/alakazam-50.mjs";

const RUNTIME_CONTRACT = "canonical-alakazam-50-held-v1";
const EXPECTED_TABLES = Object.freeze([
  "alakazam_50_care_requests",
  "alakazam_50_configurations"
]);
const EXPECTED_TRIGGERS = Object.freeze([
  [
    "alakazam_50_care_requests",
    "alakazam_50_care_requests_immutable",
    "reject_alakazam_50_evidence_mutation"
  ],
  [
    "alakazam_50_care_requests",
    "alakazam_50_care_requests_validate",
    "validate_alakazam_50_care_request"
  ],
  [
    "alakazam_50_configurations",
    "alakazam_50_configurations_immutable",
    "reject_alakazam_50_evidence_mutation"
  ],
  [
    "alakazam_50_configurations",
    "alakazam_50_configurations_validate",
    "validate_alakazam_50_configuration"
  ]
]);
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "55000"
]);
const DATABASE_RETRY_CODES = new Set(["40001", "40P01"]);

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required for Alakazam $50",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_RETRY_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "configuration_changed",
      "the Alakazam $50 configuration changed concurrently",
      { status: 409 }
    );
  }
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam $50 repository rejected inconsistent evidence",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function databaseIso(value, field) {
  const selected = value instanceof Date
    ? value.toISOString()
    : String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(Date.parse(selected)).toISOString() === selected,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function databaseInteger(value, field, { allowZero = false } = {}) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      (allowZero ? selected >= 0 : selected > 0),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function exactInput(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function scopeInput(value) {
  return exactInput(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
}

function compilationInput(value) {
  exactInput(
    value,
    [
      "actorId",
      "customerId",
      "expectedSubscriptionRevision",
      "projectId",
      "tenantId"
    ],
    "compilation"
  );
  return {
    ...scopeInput({
      actorId: value.actorId,
      customerId: value.customerId,
      projectId: value.projectId,
      tenantId: value.tenantId
    }),
    expectedSubscriptionRevision: databaseInteger(
      value.expectedSubscriptionRevision,
      "compilation.expectedSubscriptionRevision"
    )
  };
}

function context(input, readOnly = false) {
  return {
    userId: input.actorId,
    organizationId: input.tenantId,
    ...(readOnly ? { readOnly: true } : { isolation: "read-committed" })
  };
}

function subscriptionFromRow(row) {
  return Object.freeze({
    subscriptionId: row.id,
    tierId: row.tier_id,
    status: row.status,
    revision: databaseInteger(row.revision, "subscription.revision")
  });
}

async function selectAuthority(client, input, { lock = false } = {}) {
  const selected = await client.query(
    `select subscription.*
       from ss.alakazam_subscriptions subscription
       join ss.organization_memberships membership
         on membership.organization_id = subscription.organization_id
        and membership.user_id = subscription.customer_user_id
        and membership.state = 'active'
        and membership.role in ('owner', 'admin', 'editor')
      where subscription.organization_id = $1
        and subscription.project_id = $2
        and subscription.customer_user_id = $3
        and subscription.status in ('active', 'grace')
        and subscription.tier_id = 'alakazam_50'
      order by subscription.revision desc, subscription.id desc
      limit 2${lock ? " for update of subscription" : ""}`,
    [input.tenantId, input.projectId, input.customerId]
  );
  invariant(
    selected.rowCount === 1,
    "alakazam_50_authority_required",
    "an exact current Alakazam $50 subscription is required",
    { status: 409 }
  );
  return subscriptionFromRow(selected.rows[0]);
}

function configurationFromRow(input, row) {
  return createAlakazam50Configuration({
    scope: {
      actorId: input.actorId,
      customerId: input.customerId,
      projectId: input.projectId,
      tenantId: input.tenantId
    },
    commandId: row.id,
    subscription: {
      subscriptionId: row.subscription_id,
      tierId: "alakazam_50",
      status: "active",
      revision: databaseInteger(
        row.subscription_revision,
        "configuration.subscriptionRevision"
      )
    },
    expectedCurrentRevision:
      databaseInteger(
        row.configuration_revision,
        "configuration.configurationRevision"
      ) - 1,
    cashAppHandle: row.cash_app_handle,
    venmoHandle: row.venmo_handle,
    fontChoiceId: row.font_choice_id,
    borderChoiceId: row.border_choice_id,
    menu: row.menu,
    configuredAt: databaseIso(
      row.configured_at,
      "configuration.configuredAt"
    )
  });
}

async function selectLatestConfiguration(client, input) {
  const selected = await client.query(
    `select *
       from ss.alakazam_50_configurations
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3
      order by configuration_revision desc, id desc
      limit 1`,
    [input.tenantId, input.projectId, input.customerId]
  );
  if (selected.rowCount === 0) return null;
  const configuration = configurationFromRow(input, selected.rows[0]);
  invariant(
    configuration.configurationDigest ===
      selected.rows[0].configuration_digest,
    "repository_conflict",
    "the stored Alakazam $50 configuration digest changed",
    { status: 500 }
  );
  return configuration;
}

async function readSnapshot(client, input) {
  const subscription = await selectAuthority(client, input);
  const [latestConfiguration, care] = await Promise.all([
    selectLatestConfiguration(client, input),
    client.query(
      `select count(*)::bigint as request_count, max(requested_at) as last_requested_at
         from ss.alakazam_50_care_requests
        where organization_id = $1
          and project_id = $2
          and customer_user_id = $3`,
      [input.tenantId, input.projectId, input.customerId]
    )
  ]);
  const configuration =
    latestConfiguration?.subscriptionId === subscription.subscriptionId &&
    latestConfiguration?.subscriptionRevision === subscription.revision
      ? latestConfiguration
      : null;
  return createAlakazam50Snapshot({
    scope: input,
    subscription,
    configuration,
    care: {
      requestCount: databaseInteger(
        care.rows[0].request_count,
        "care.requestCount",
        { allowZero: true }
      ),
      lastRequestedAt: care.rows[0].last_requested_at === null
        ? null
        : databaseIso(
            care.rows[0].last_requested_at,
            "care.lastRequestedAt"
          )
    }
  });
}

function sameMenu(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createPostgresAlakazam50Repository({ authority } = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const [marker, tables, triggers, grants] = await Promise.all([
            client.query(
              "select ss.hosted_alakazam_50_contract() as runtime_contract"
            ),
            client.query(
              `select relation.relname as table_name,
                 relation.relkind = 'r' as ordinary_table,
                 relation.relpersistence = 'p' as permanent_table,
                 relation.relrowsecurity as rls_enabled,
                 relation.relforcerowsecurity as rls_forced,
                 not exists (
                   select 1 from pg_catalog.pg_policy policy
                    where policy.polrelid = relation.oid
                 ) as no_direct_policies
               from pg_catalog.pg_class relation
               join pg_catalog.pg_namespace namespace
                 on namespace.oid = relation.relnamespace
              where namespace.nspname = 'ss'
                and relation.relname = any($1::text[])
              order by relation.relname`,
              [EXPECTED_TABLES]
            ),
            client.query(
              `select relation.relname as table_name,
                 trigger_record.tgname as trigger_name,
                 function_record.proname as function_name,
                 trigger_record.tgenabled = 'O' as enabled
               from pg_catalog.pg_trigger trigger_record
               join pg_catalog.pg_class relation
                 on relation.oid = trigger_record.tgrelid
               join pg_catalog.pg_namespace namespace
                 on namespace.oid = relation.relnamespace
               join pg_catalog.pg_proc function_record
                 on function_record.oid = trigger_record.tgfoid
              where namespace.nspname = 'ss'
                and relation.relname = any($1::text[])
                and not trigger_record.tgisinternal
              order by relation.relname, trigger_record.tgname`,
              [EXPECTED_TABLES]
            ),
            client.query(
              `select relation.relname as table_name,
                 coalesce(grantee.rolname, 'PUBLIC') as grantee,
                 privilege.privilege_type,
                 privilege.is_grantable
               from pg_catalog.pg_class relation
               join pg_catalog.pg_namespace namespace
                 on namespace.oid = relation.relnamespace
               cross join lateral pg_catalog.aclexplode(
                 coalesce(
                   relation.relacl,
                   pg_catalog.acldefault('r', relation.relowner)
                 )
               ) privilege
               left join pg_catalog.pg_roles grantee
                 on grantee.oid = privilege.grantee
              where namespace.nspname = 'ss'
                and relation.relname = any($1::text[])
                and privilege.grantee <> relation.relowner
              order by relation.relname, grantee, privilege.privilege_type`,
              [EXPECTED_TABLES]
            )
          ]);
          const expectedGrants = EXPECTED_TABLES.flatMap((tableName) => [
            [tableName, "service_role", "INSERT"],
            [tableName, "service_role", "SELECT"]
          ]).sort();
          invariant(
            marker.rows[0]?.runtime_contract === RUNTIME_CONTRACT &&
              JSON.stringify(tables.rows.map((row) => row.table_name)) ===
                JSON.stringify(EXPECTED_TABLES) &&
              tables.rows.every((row) =>
                row.ordinary_table === true &&
                row.permanent_table === true &&
                row.rls_enabled === true &&
                row.rls_forced === true &&
                row.no_direct_policies === true
              ) &&
              JSON.stringify(triggers.rows.map((row) => [
                row.table_name,
                row.trigger_name,
                row.function_name
              ])) === JSON.stringify(EXPECTED_TRIGGERS) &&
              triggers.rows.every((row) => row.enabled === true) &&
              JSON.stringify(grants.rows.map((row) => [
                row.table_name,
                row.grantee,
                row.privilege_type
              ])) === JSON.stringify(expectedGrants) &&
              grants.rows.every((row) => row.is_grantable === false),
            "alakazam_50_held",
            "Alakazam $50 durable authorization is not ready",
            { status: 503 }
          );
          return Object.freeze({
            ready: true,
            authorization: true,
            providerEffects: false,
            state: "held",
            runtimeContract: RUNTIME_CONTRACT
          });
        }
      ));
    },
    async read(value) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input, true),
        (client) => readSnapshot(client, input)
      ));
    },
    async readCompilationBinding(value) {
      const input = compilationInput(value);
      return translated(() => database.service(
        context(input, true),
        async (client) => {
          const subscription = await selectAuthority(client, input);
          invariant(
            subscription.revision === input.expectedSubscriptionRevision,
            "configuration_changed",
            "the Alakazam $50 subscription changed before compilation",
            { status: 409 }
          );
          const configuration = await selectLatestConfiguration(client, input);
          invariant(
            configuration &&
              configuration.subscriptionId === subscription.subscriptionId &&
              configuration.subscriptionRevision === subscription.revision,
            "alakazam_50_configuration_required",
            "save the Alakazam $50 configuration before fulfillment",
            { status: 409 }
          );
          return Object.freeze({ configuration });
        }
      ));
    },
    async saveConfiguration(value, command) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`ss-alakazam-50-config:${input.tenantId}:${command.commandId}`]
          );
          const subscription = await selectAuthority(client, input, {
            lock: true
          });
          const replay = await client.query(
            `select * from ss.alakazam_50_configurations
              where organization_id = $1 and id = $2 for update`,
            [input.tenantId, command.commandId]
          );
          if (replay.rowCount === 1) {
            const stored = configurationFromRow(input, replay.rows[0]);
            invariant(
              stored.projectId === input.projectId &&
                stored.cashAppHandle === command.cashAppHandle &&
                stored.venmoHandle === command.venmoHandle &&
                stored.fontChoiceId === command.fontChoiceId &&
                stored.borderChoiceId === command.borderChoiceId &&
                stored.configurationRevision ===
                  command.expectedCurrentRevision + 1 &&
                sameMenu(stored.menu, command.menu),
              "idempotency_conflict",
              "the Alakazam $50 command was already used differently",
              { status: 409 }
            );
            return stored;
          }
          const current = await client.query(
            `select coalesce(max(configuration_revision), 0)::bigint as revision
               from ss.alakazam_50_configurations
              where organization_id = $1 and project_id = $2`,
            [input.tenantId, input.projectId]
          );
          invariant(
            databaseInteger(
              current.rows[0].revision,
              "configuration.currentRevision",
              { allowZero: true }
            ) === command.expectedCurrentRevision,
            "configuration_changed",
            "the Alakazam $50 configuration changed; refresh before retrying",
            { status: 409 }
          );
          const configuration = createAlakazam50Configuration({
            scope: input,
            commandId: command.commandId,
            subscription,
            expectedCurrentRevision: command.expectedCurrentRevision,
            cashAppHandle: command.cashAppHandle,
            venmoHandle: command.venmoHandle,
            fontChoiceId: command.fontChoiceId,
            borderChoiceId: command.borderChoiceId,
            menu: command.menu,
            configuredAt: command.configuredAt
          });
          await client.query(
            `insert into ss.alakazam_50_configurations (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision,
               configuration_revision, cash_app_handle, venmo_handle,
               font_choice_id, border_choice_id, menu,
               configuration_digest, state, hold_reason, configured_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12::jsonb, $13, 'held', $14, $15
             )`,
            [
              configuration.commandId,
              input.tenantId,
              input.projectId,
              input.customerId,
              configuration.subscriptionId,
              configuration.subscriptionRevision,
              configuration.configurationRevision,
              configuration.cashAppHandle,
              configuration.venmoHandle,
              configuration.fontChoiceId,
              configuration.borderChoiceId,
              JSON.stringify(configuration.menu),
              configuration.configurationDigest,
              ALAKAZAM_50_HOLD_REASON,
              configuration.configuredAt
            ]
          );
          return configuration;
        }
      ));
    },
    async recordCare(value, command) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`ss-alakazam-50-care:${input.tenantId}:${command.commandId}`]
          );
          const subscription = await selectAuthority(client, input, {
            lock: true
          });
          const replay = await client.query(
            `select * from ss.alakazam_50_care_requests
              where organization_id = $1 and id = $2 for update`,
            [input.tenantId, command.commandId]
          );
          if (replay.rowCount === 1) {
            invariant(
              replay.rows[0].project_id === input.projectId &&
                replay.rows[0].request_message === command.message,
              "idempotency_conflict",
              "the Alakazam $50 care command was already used differently",
              { status: 409 }
            );
            return Object.freeze({
              commandId: replay.rows[0].id,
              requestDigest: replay.rows[0].request_digest
            });
          }
          const request = createAlakazam50CareRequest({
            scope: input,
            commandId: command.commandId,
            subscription,
            message: command.message,
            requestedAt: command.requestedAt
          });
          await client.query(
            `insert into ss.alakazam_50_care_requests (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision, care_class,
               request_message, request_digest, state, hold_reason,
               requested_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'more', $7, $8,
               'held', $9, $10
             )`,
            [
              request.commandId,
              input.tenantId,
              input.projectId,
              input.customerId,
              request.subscriptionId,
              request.subscriptionRevision,
              request.message,
              request.requestDigest,
              ALAKAZAM_50_HOLD_REASON,
              request.requestedAt
            ]
          );
          return request;
        }
      ));
    }
  });
}
