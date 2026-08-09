import {
  ALAKAZAM_CARE_LIFECYCLE_POLICY_ID
} from "../commerce-v2/alakazam-care-lifecycle-policy.mjs";
import {
  ALAKAZAM_50_HOLD_REASON,
  createAlakazam50Configuration
} from "../commerce-v2/alakazam-50.mjs";
import {
  ALAKAZAM_RETAINED_PREMIUM_HOLD_REASON,
  createAlakazamRetainedPremiumExport,
  createAlakazamRetainedPremiumRestoration,
  createAlakazamRetainedPremiumSnapshot
} from "../commerce-v2/alakazam-retained-premium.mjs";
import {
  CommerceV2Error,
  invariant,
  requiredDigest,
  requiredIso
} from "../commerce-v2/canonical.mjs";

const RUNTIME_CONTRACT =
  "canonical-alakazam-retained-premium-held-v1";
const EXPECTED_TABLES = Object.freeze([
  "alakazam_50_premium_restorations",
  "alakazam_premium_purge_receipts",
  "alakazam_premium_retention_windows"
]);
const EXPECTED_TRIGGERS = Object.freeze([
  [
    "alakazam_50_premium_restorations",
    "alakazam_50_premium_restorations_immutable",
    "reject_alakazam_retained_premium_evidence_mutation"
  ],
  [
    "alakazam_50_premium_restorations",
    "alakazam_50_premium_restorations_validate",
    "validate_alakazam_50_premium_restoration"
  ],
  [
    "alakazam_premium_purge_receipts",
    "alakazam_premium_purge_receipts_immutable",
    "reject_alakazam_retained_premium_evidence_mutation"
  ],
  [
    "alakazam_premium_retention_windows",
    "alakazam_premium_retention_windows_guard_update",
    "guard_alakazam_premium_retention_window"
  ],
  [
    "alakazam_premium_retention_windows",
    "alakazam_premium_retention_windows_immutable",
    "reject_alakazam_retained_premium_evidence_mutation"
  ],
  [
    "alakazam_premium_retention_windows",
    "alakazam_premium_retention_windows_validate",
    "validate_alakazam_premium_retention_window"
  ]
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
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
    "canonical PostgreSQL authority is required for retained Alakazam premium state",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_RETRY_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "configuration_changed",
      "the retained Alakazam premium state changed concurrently",
      { status: 409 }
    );
  }
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the retained Alakazam premium repository rejected inconsistent evidence",
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

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function positiveInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected > 0,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
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

function optionalDatabaseIso(value, field) {
  return value === null || value === undefined
    ? null
    : databaseIso(value, field);
}

function scopeInput(value) {
  return exactInput(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
}

function context(input, readOnly = false) {
  return {
    userId: input.actorId,
    organizationId: input.tenantId,
    ...(readOnly ? { readOnly: true } : { isolation: "serializable" })
  };
}

function configurationFromRow(input, row) {
  const configuration = createAlakazam50Configuration({
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
      revision: positiveInteger(
        row.subscription_revision,
        "configuration.subscriptionRevision"
      )
    },
    expectedCurrentRevision:
      positiveInteger(
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
  invariant(
    configuration.configurationDigest === row.configuration_digest,
    "repository_conflict",
    "the stored retained Alakazam premium configuration changed",
    { status: 500 }
  );
  return configuration;
}

async function selectAuthority(client, input, { lock = false } = {}) {
  const selected = await client.query(
    `select
       subscription.*,
       retention.id as retention_window_id,
       retention.source_kind as retention_source_kind,
       retention.starts_at as retention_starts_at,
       retention.ends_at as retention_ends_at,
       retention.state as retention_state
     from ss.projects project
     join ss.organizations organization
       on organization.id = project.organization_id
      and organization.state = 'active'
     join ss.organization_memberships membership
       on membership.organization_id = project.organization_id
      and membership.user_id = $3
      and membership.state = 'active'
      and membership.role in ('owner', 'admin', 'editor')
     join lateral (
       select candidate.*
         from ss.alakazam_subscriptions candidate
        where candidate.organization_id = project.organization_id
          and candidate.project_id = project.id
          and candidate.customer_user_id = $3
        order by
          (candidate.status <> 'ended') desc,
          candidate.revision desc,
          candidate.created_at desc,
          candidate.id desc
        limit 1
     ) subscription on true
     left join lateral (
       select retention_record.*
         from ss.alakazam_premium_retention_windows retention_record
        where retention_record.organization_id = subscription.organization_id
          and retention_record.project_id = subscription.project_id
          and retention_record.subscription_id = subscription.id
        order by retention_record.ends_at desc, retention_record.id desc
        limit 1
     ) retention on true
    where project.organization_id = $1
      and project.id = $2
      and project.lifecycle = 'active'
    ${lock ? "for update of project, subscription" : ""}`,
    [input.tenantId, input.projectId, input.customerId]
  );
  invariant(
    selected.rowCount === 1,
    "project_unavailable",
    "the retained Alakazam premium project is unavailable",
    { status: 404 }
  );
  return selected.rows[0];
}

function authorityFromRow(row, observedAt) {
  const at = Date.parse(requiredIso(observedAt, "observedAt"));
  const firstFailedAt = optionalDatabaseIso(
    row.first_failed_at,
    "authority.firstFailedAt"
  );
  const graceEndsAt = optionalDatabaseIso(
    row.grace_ends_at,
    "authority.graceEndsAt"
  );
  const retainedUntil = optionalDatabaseIso(
    row.retention_ends_at,
    "authority.retentionEndsAt"
  );
  let lifecycleState = "purged";
  let retentionEndsAt = null;
  if (row.status === "active") {
    lifecycleState = row.cancel_at_period_end
      ? "scheduled_to_cancel_active"
      : "active";
  } else if (
    row.status === "grace" &&
    firstFailedAt !== null &&
    graceEndsAt !== null &&
    Date.parse(graceEndsAt) === Date.parse(firstFailedAt) + 7 * DAY_MS &&
    at < Date.parse(graceEndsAt)
  ) {
    lifecycleState = "payment_grace";
    retentionEndsAt = graceEndsAt;
  } else if (
    ["suspended", "cancelled", "ended"].includes(row.status) &&
    row.retention_state === "active" &&
    row.retention_source_kind !== null &&
    row.retention_starts_at !== null &&
    retainedUntil !== null &&
    at >= Date.parse(row.retention_starts_at) &&
    at < Date.parse(retainedUntil)
  ) {
    lifecycleState = "retained_exit";
    retentionEndsAt = retainedUntil;
  }
  return Object.freeze({
    subscriptionId: row.id,
    revision: positiveInteger(row.revision, "authority.revision"),
    tierId: row.tier_id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    providerFactsDigest: requiredDigest(
      row.provider_facts_digest,
      "authority.providerFactsDigest"
    ),
    providerObservedAt: databaseIso(
      row.provider_observed_at,
      "authority.providerObservedAt"
    ),
    firstFailedAt,
    graceEndsAt,
    retentionEndsAt,
    lifecycleState
  });
}

async function selectLatestConfiguration(
  client,
  input,
  subscriptionId,
  { lock = false } = {}
) {
  const selected = await client.query(
    `select *
       from ss.alakazam_50_configurations
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3
        and subscription_id = $4
      order by configuration_revision desc, id desc
      limit 1${lock ? " for update" : ""}`,
    [input.tenantId, input.projectId, input.customerId, subscriptionId]
  );
  return selected.rowCount === 0
    ? null
    : configurationFromRow(input, selected.rows[0]);
}

async function selectRestorationEvidence(
  client,
  input,
  authority,
  configuration
) {
  if (
    configuration === null ||
    authority.lifecycleState === "purged" ||
    authority.tierId !== "alakazam_50" ||
    configuration.subscriptionId !== authority.subscriptionId ||
    configuration.subscriptionRevision === authority.revision
  ) {
    return Object.freeze({
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    });
  }
  const selected = await client.query(
    `select
       downgrade.id as downgrade_event_id,
       downgrade.event_kind as downgrade_event_kind,
       downgrade.prior_tier_id as downgrade_prior_tier_id,
       downgrade.result_tier_id as downgrade_result_tier_id,
       downgrade.result_subscription_revision
         as downgrade_result_subscription_revision,
       downgrade.facts_digest as downgrade_facts_digest,
       upgrade.id as upgrade_event_id,
       upgrade.event_kind as upgrade_event_kind,
       upgrade.prior_tier_id as upgrade_prior_tier_id,
       upgrade.result_tier_id as upgrade_result_tier_id,
       upgrade.result_subscription_revision
         as upgrade_result_subscription_revision,
       upgrade.facts_digest as upgrade_facts_digest
     from ss.alakazam_tier_change_events upgrade
     join lateral (
       select event.*
         from ss.alakazam_tier_change_events event
        where event.organization_id = upgrade.organization_id
          and event.project_id = upgrade.project_id
          and event.subscription_id = upgrade.subscription_id
          and event.event_kind = 'downgrade_applied'
          and event.prior_tier_id = 'alakazam_50'
          and event.result_tier_id in ('alakazam_25', 'alakazam_35')
          and event.result_subscription_revision > $4
          and event.result_subscription_revision <
              upgrade.result_subscription_revision
        order by event.result_subscription_revision desc, event.id desc
        limit 1
     ) downgrade on true
    where upgrade.organization_id = $1
      and upgrade.project_id = $2
      and upgrade.subscription_id = $3
      and upgrade.event_kind = 'upgrade_applied'
      and upgrade.prior_tier_id = downgrade.result_tier_id
      and upgrade.result_tier_id = 'alakazam_50'
      and upgrade.result_subscription_revision = $5
      and upgrade.stripe_event_row_id is not null
      and upgrade.quote_id is not null
      and upgrade.payment_receipt_id is not null
    order by upgrade.occurred_at desc, upgrade.id desc
    limit 2`,
    [
      input.tenantId,
      input.projectId,
      authority.subscriptionId,
      configuration.subscriptionRevision,
      authority.revision
    ]
  );
  if (selected.rowCount !== 1) {
    return Object.freeze({
      ready: false,
      downgradeEventId: null,
      upgradeEventId: null
    });
  }
  const row = selected.rows[0];
  return Object.freeze({
    ready: true,
    downgradeEventId: row.downgrade_event_id,
    upgradeEventId: row.upgrade_event_id,
    downgradeEvent: Object.freeze({
      eventId: row.downgrade_event_id,
      eventKind: row.downgrade_event_kind,
      priorTierId: row.downgrade_prior_tier_id,
      resultTierId: row.downgrade_result_tier_id,
      resultSubscriptionRevision: positiveInteger(
        row.downgrade_result_subscription_revision,
        "downgradeEvent.resultSubscriptionRevision"
      ),
      factsDigest: row.downgrade_facts_digest
    }),
    upgradeEvent: Object.freeze({
      eventId: row.upgrade_event_id,
      eventKind: row.upgrade_event_kind,
      priorTierId: row.upgrade_prior_tier_id,
      resultTierId: row.upgrade_result_tier_id,
      resultSubscriptionRevision: positiveInteger(
        row.upgrade_result_subscription_revision,
        "upgradeEvent.resultSubscriptionRevision"
      ),
      factsDigest: row.upgrade_facts_digest
    })
  });
}

async function readBundle(client, input, observedAt, { lock = false } = {}) {
  const row = await selectAuthority(client, input, { lock });
  const authority = authorityFromRow(row, observedAt);
  const configuration = await selectLatestConfiguration(
    client,
    input,
    authority.subscriptionId,
    { lock }
  );
  invariant(
    authority.lifecycleState !== "purged" || configuration === null,
    "alakazam_premium_purge_required",
    "retained Alakazam premium configuration reached its purge boundary",
    { status: 409 }
  );
  const evidence = await selectRestorationEvidence(
    client,
    input,
    authority,
    configuration
  );
  return Object.freeze({ authority, configuration, evidence });
}

function readinessRows(rows) {
  const expected = EXPECTED_TABLES.map((tableName) => [
    tableName,
    true,
    true,
    true,
    true,
    true
  ]);
  return JSON.stringify(rows.map((row) => [
    row.table_name,
    row.ordinary_table,
    row.permanent_table,
    row.rls_enabled,
    row.rls_forced,
    row.no_direct_policies
  ])) === JSON.stringify(expected);
}

export function createPostgresAlakazamRetainedPremiumRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const [marker, tables, triggers, grants] = await Promise.all([
            client.query(
              "select ss.hosted_alakazam_retained_premium_contract() as runtime_contract"
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
          const expectedGrants = [
            ["alakazam_50_premium_restorations", "service_role", "INSERT"],
            ["alakazam_50_premium_restorations", "service_role", "SELECT"],
            ["alakazam_premium_purge_receipts", "service_role", "SELECT"],
            ["alakazam_premium_retention_windows", "service_role", "SELECT"]
          ];
          invariant(
            marker.rows[0]?.runtime_contract === RUNTIME_CONTRACT &&
              readinessRows(tables.rows) &&
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
            "alakazam_retained_premium_held",
            "retained Alakazam premium authority is not ready",
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
    async read(value, observedAt) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input, true),
        async (client) => {
          const bundle = await readBundle(client, input, observedAt);
          return createAlakazamRetainedPremiumSnapshot({
            scope: input,
            authority: bundle.authority,
            configuration: bundle.configuration,
            restorationReadiness: {
              ready: bundle.evidence.ready,
              downgradeEventId: bundle.evidence.downgradeEventId,
              upgradeEventId: bundle.evidence.upgradeEventId
            }
          });
        }
      ));
    },
    async exportConfiguration(value, exportedAt) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input, true),
        async (client) => {
          const bundle = await readBundle(client, input, exportedAt);
          invariant(
            bundle.configuration !== null,
            "alakazam_premium_export_unavailable",
            "there is no retained Alakazam premium configuration to export",
            { status: 409 }
          );
          return createAlakazamRetainedPremiumExport({
            scope: input,
            authority: bundle.authority,
            configuration: bundle.configuration,
            exportedAt
          });
        }
      ));
    },
    async restore(value, command) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`ss-alakazam-premium-restore:${input.tenantId}:${command.commandId}`]
          );
          const replay = await client.query(
            `select restoration.*,
               restored.id,
               restored.subscription_id,
               restored.subscription_revision,
               restored.configuration_revision,
               restored.cash_app_handle,
               restored.venmo_handle,
               restored.font_choice_id,
               restored.border_choice_id,
               restored.menu,
               restored.configuration_digest,
               restored.configured_at
             from ss.alakazam_50_premium_restorations restoration
             join ss.alakazam_50_configurations restored
               on restored.organization_id = restoration.organization_id
              and restored.id = restoration.restored_configuration_id
            where restoration.organization_id = $1
              and restoration.id = $2
            for update of restoration, restored`,
            [input.tenantId, command.commandId]
          );
          if (replay.rowCount === 1) {
            invariant(
              replay.rows[0].project_id === input.projectId &&
                replay.rows[0].source_configuration_digest ===
                  command.expectedSourceConfigurationDigest &&
                positiveInteger(
                  replay.rows[0].subscription_revision,
                  "restoration.subscriptionRevision"
                ) === command.expectedSubscriptionRevision,
              "idempotency_conflict",
              "the retained Alakazam premium command was already used differently",
              { status: 409 }
            );
            return configurationFromRow(input, replay.rows[0]);
          }
          const bundle = await readBundle(client, input, command.restoredAt, {
            lock: true
          });
          invariant(
            ["active", "scheduled_to_cancel_active"].includes(
              bundle.authority.lifecycleState
            ) &&
              bundle.authority.tierId === "alakazam_50" &&
              bundle.authority.revision ===
                command.expectedSubscriptionRevision &&
              bundle.configuration !== null &&
              bundle.configuration.configurationDigest ===
                command.expectedSourceConfigurationDigest &&
              bundle.configuration.subscriptionRevision <
                bundle.authority.revision &&
              bundle.evidence.ready,
            "alakazam_premium_restoration_unavailable",
            "exact provider and tier-change evidence is required before restoration",
            { status: 409 }
          );
          const restored = createAlakazam50Configuration({
            scope: input,
            commandId: command.commandId,
            subscription: {
              subscriptionId: bundle.authority.subscriptionId,
              tierId: "alakazam_50",
              status: "active",
              revision: bundle.authority.revision
            },
            expectedCurrentRevision:
              bundle.configuration.configurationRevision,
            cashAppHandle: bundle.configuration.cashAppHandle,
            venmoHandle: bundle.configuration.venmoHandle,
            fontChoiceId: bundle.configuration.fontChoiceId,
            borderChoiceId: bundle.configuration.borderChoiceId,
            menu: bundle.configuration.menu,
            configuredAt: command.restoredAt
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
              restored.commandId,
              input.tenantId,
              input.projectId,
              input.customerId,
              restored.subscriptionId,
              restored.subscriptionRevision,
              restored.configurationRevision,
              restored.cashAppHandle,
              restored.venmoHandle,
              restored.fontChoiceId,
              restored.borderChoiceId,
              JSON.stringify(restored.menu),
              restored.configurationDigest,
              ALAKAZAM_50_HOLD_REASON,
              restored.configuredAt
            ]
          );
          const restoration = createAlakazamRetainedPremiumRestoration({
            scope: input,
            restorationId: command.commandId,
            authority: bundle.authority,
            sourceConfiguration: bundle.configuration,
            restoredConfiguration: restored,
            downgradeEvent: bundle.evidence.downgradeEvent,
            upgradeEvent: bundle.evidence.upgradeEvent,
            restoredAt: command.restoredAt
          });
          await client.query(
            `insert into ss.alakazam_50_premium_restorations (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision,
               source_configuration_id, source_configuration_revision,
               source_configuration_digest, restored_configuration_id,
               restored_configuration_revision, restored_configuration_digest,
               downgrade_event_id, downgrade_event_revision,
               downgrade_event_digest, upgrade_event_id,
               upgrade_event_revision, upgrade_event_digest,
               provider_facts_digest, provider_observed_at, policy_id,
               evidence_digest, state, hold_reason, restored_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20, $21, $22, 'held', $23, $24
             )`,
            [
              restoration.restorationId,
              input.tenantId,
              input.projectId,
              input.customerId,
              restoration.subscriptionId,
              restoration.subscriptionRevision,
              restoration.sourceConfigurationId,
              restoration.sourceConfigurationRevision,
              restoration.sourceConfigurationDigest,
              restoration.restoredConfigurationId,
              restoration.restoredConfigurationRevision,
              restoration.restoredConfigurationDigest,
              restoration.downgradeEventId,
              restoration.downgradeEventRevision,
              restoration.downgradeEventDigest,
              restoration.upgradeEventId,
              restoration.upgradeEventRevision,
              restoration.upgradeEventDigest,
              restoration.providerFactsDigest,
              restoration.providerObservedAt,
              ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
              restoration.evidenceDigest,
              ALAKAZAM_RETAINED_PREMIUM_HOLD_REASON,
              restoration.restoredAt
            ]
          );
          return restored;
        }
      ));
    },
    async findNextGraceRetainedExit(value) {
      exactInput(value, ["observedAt"], "graceRetainedExitLookup");
      const observedAt = requiredIso(
        value.observedAt,
        "graceRetainedExitLookup.observedAt"
      );
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select
               subscription.organization_id,
               subscription.project_id,
               subscription.id as subscription_id,
               subscription.status,
               subscription.revision,
               subscription.first_failed_at,
               subscription.grace_ends_at,
               subscription.provider_facts_digest,
               subscription.provider_observed_at,
               source_event.id as source_event_id,
               source_event.event_kind as source_event_kind,
               source_event.result_subscription_revision
                 as source_event_revision,
               source_event.stripe_event_row_id
                 as source_stripe_event_row_id
             from ss.alakazam_subscriptions subscription
             join lateral (
               select event.*
                 from ss.alakazam_tier_change_events event
                 join ss.alakazam_stripe_events stripe_event
                   on stripe_event.organization_id = event.organization_id
                  and stripe_event.id = event.stripe_event_row_id
                  and stripe_event.state = 'processed'
                  and stripe_event.event_type = 'invoice.payment_failed'
                  and stripe_event.facts ->>
                      'invoiceProviderFactsDigest' =
                      subscription.provider_facts_digest
                where event.organization_id = subscription.organization_id
                  and event.project_id = subscription.project_id
                  and event.subscription_id = subscription.id
                  and event.event_kind = 'suspended'
                  and event.result_subscription_revision =
                      subscription.revision
                order by event.occurred_at desc, event.id desc
                limit 1
             ) source_event on true
            where subscription.status = 'suspended'
              and subscription.first_failed_at is not null
              and subscription.grace_ends_at =
                  subscription.first_failed_at + interval '7 days'
              and subscription.grace_ends_at <= $1::timestamptz
              and subscription.provider_observed_at >=
                  subscription.grace_ends_at
              and exists (
                select 1
                  from ss.alakazam_50_configurations configuration
                 where configuration.organization_id =
                       subscription.organization_id
                   and configuration.project_id = subscription.project_id
                   and configuration.subscription_id = subscription.id
              )
              and not exists (
                select 1
                  from ss.alakazam_premium_retention_windows retention
                 where retention.organization_id =
                       subscription.organization_id
                   and retention.project_id = subscription.project_id
                   and retention.subscription_id = subscription.id
              )
            order by subscription.grace_ends_at, subscription.id
            limit 1`,
            [observedAt]
          );
          if (selected.rowCount === 0) return null;
          const row = selected.rows[0];
          return Object.freeze({
            kind: "payment_grace_expired",
            tenantId: row.organization_id,
            projectId: row.project_id,
            subscriptionId: row.subscription_id,
            status: row.status,
            revision: positiveInteger(row.revision, "graceCandidate.revision"),
            firstFailedAt: databaseIso(
              row.first_failed_at,
              "graceCandidate.firstFailedAt"
            ),
            graceEndsAt: databaseIso(
              row.grace_ends_at,
              "graceCandidate.graceEndsAt"
            ),
            providerFactsDigest: requiredDigest(
              row.provider_facts_digest,
              "graceCandidate.providerFactsDigest"
            ),
            providerObservedAt: databaseIso(
              row.provider_observed_at,
              "graceCandidate.providerObservedAt"
            ),
            sourceEventId: row.source_event_id,
            sourceEventKind: row.source_event_kind,
            sourceEventRevision: positiveInteger(
              row.source_event_revision,
              "graceCandidate.sourceEventRevision"
            ),
            sourceStripeEventRowId: row.source_stripe_event_row_id
          });
        }
      ));
    },
    async findNextRetentionExpiry(value) {
      exactInput(value, ["observedAt"], "retentionExpiryLookup");
      const observedAt = requiredIso(
        value.observedAt,
        "retentionExpiryLookup.observedAt"
      );
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select organization_id, project_id, subscription_id,
                    id as retention_window_id, state, ends_at
               from ss.alakazam_premium_retention_windows retention
              where retention.state = 'active'
                and retention.ends_at <= $1::timestamptz
              order by retention.ends_at, retention.id
              limit 1`,
            [observedAt]
          );
          if (selected.rowCount === 0) return null;
          const row = selected.rows[0];
          return Object.freeze({
            kind: "retained_exit_expiry",
            tenantId: row.organization_id,
            projectId: row.project_id,
            subscriptionId: row.subscription_id,
            retentionWindowId: row.retention_window_id,
            state: row.state,
            endsAt: databaseIso(
              row.ends_at,
              "retentionCandidate.endsAt"
            )
          });
        }
      ));
    },
    async findConfirmedCancellationRetainedExit(value) {
      exactInput(
        value,
        ["observedAt", "projectId", "subscriptionId", "tenantId"],
        "confirmedCancellationLookup"
      );
      const tenantId = uuid(
        value.tenantId,
        "confirmedCancellationLookup.tenantId"
      );
      const projectId = uuid(
        value.projectId,
        "confirmedCancellationLookup.projectId"
      );
      const subscriptionId = uuid(
        value.subscriptionId,
        "confirmedCancellationLookup.subscriptionId"
      );
      const observedAt = requiredIso(
        value.observedAt,
        "confirmedCancellationLookup.observedAt"
      );
      return translated(() => database.service(
        { organizationId: tenantId, readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select
               subscription.organization_id,
               subscription.project_id,
               subscription.id as subscription_id,
               subscription.status as subscription_status,
               subscription.revision as subscription_revision,
               subscription.provider_facts_digest,
               subscription.provider_observed_at,
               cancellation.id as cancellation_id,
               cancellation.state as cancellation_state,
               cancellation.provider_effect_certainty,
               cancellation.effective_confirmed_at,
               export_grant.id as export_grant_id,
               export_grant.state as export_state,
               export_grant.paid_through_at,
               source_event.id as source_event_id,
               source_event.event_kind as source_event_kind,
               source_event.result_subscription_revision
                 as source_event_revision,
               source_event.stripe_event_row_id
                 as source_stripe_event_row_id
             from ss.alakazam_subscriptions subscription
             join ss.alakazam_cancellations cancellation
               on cancellation.organization_id = subscription.organization_id
              and cancellation.project_id = subscription.project_id
              and cancellation.subscription_id = subscription.id
              and cancellation.state = 'effective'
              and cancellation.provider_effect_certainty = 'confirmed'
             join ss.alakazam_export_grants export_grant
               on export_grant.organization_id = cancellation.organization_id
              and export_grant.project_id = cancellation.project_id
              and export_grant.subscription_id = cancellation.subscription_id
              and export_grant.cancellation_id = cancellation.id
              and export_grant.state = 'available'
             join lateral (
               select event.*
                 from ss.alakazam_tier_change_events event
                 join ss.alakazam_stripe_events stripe_event
                   on stripe_event.organization_id = event.organization_id
                  and stripe_event.id = event.stripe_event_row_id
                  and stripe_event.state = 'processed'
                where event.organization_id = subscription.organization_id
                  and event.project_id = subscription.project_id
                  and event.subscription_id = subscription.id
                  and event.event_kind = subscription.status
                  and event.result_subscription_revision =
                      subscription.revision
                order by event.occurred_at desc, event.id desc
                limit 1
             ) source_event on true
            where subscription.organization_id = $1
              and subscription.project_id = $2
              and subscription.id = $3
              and subscription.status in ('cancelled', 'ended')
              and export_grant.paid_through_at <= $4::timestamptz
              and cancellation.effective_confirmed_at >=
                  export_grant.paid_through_at
              and exists (
                select 1
                  from ss.alakazam_50_configurations configuration
                 where configuration.organization_id =
                       subscription.organization_id
                   and configuration.project_id = subscription.project_id
                   and configuration.subscription_id = subscription.id
              )
              and not exists (
                select 1
                  from ss.alakazam_premium_retention_windows retention
                 where retention.organization_id =
                       subscription.organization_id
                   and retention.project_id = subscription.project_id
                   and retention.subscription_id = subscription.id
              )`,
            [tenantId, projectId, subscriptionId, observedAt]
          );
          if (selected.rowCount === 0) return null;
          invariant(
            selected.rowCount === 1,
            "repository_conflict",
            "the confirmed cancellation has ambiguous retained-exit authority",
            { status: 500 }
          );
          const row = selected.rows[0];
          return Object.freeze({
            kind: "period_end_cancellation",
            tenantId: row.organization_id,
            projectId: row.project_id,
            subscriptionId: row.subscription_id,
            subscriptionStatus: row.subscription_status,
            subscriptionRevision: positiveInteger(
              row.subscription_revision,
              "cancellationCandidate.subscriptionRevision"
            ),
            providerFactsDigest: requiredDigest(
              row.provider_facts_digest,
              "cancellationCandidate.providerFactsDigest"
            ),
            providerObservedAt: databaseIso(
              row.provider_observed_at,
              "cancellationCandidate.providerObservedAt"
            ),
            cancellationId: row.cancellation_id,
            cancellationState: row.cancellation_state,
            providerEffectCertainty: row.provider_effect_certainty,
            effectiveConfirmedAt: databaseIso(
              row.effective_confirmed_at,
              "cancellationCandidate.effectiveConfirmedAt"
            ),
            exportGrantId: row.export_grant_id,
            exportState: row.export_state,
            paidThroughAt: databaseIso(
              row.paid_through_at,
              "cancellationCandidate.paidThroughAt"
            ),
            sourceEventId: row.source_event_id,
            sourceEventKind: row.source_event_kind,
            sourceEventRevision: positiveInteger(
              row.source_event_revision,
              "cancellationCandidate.sourceEventRevision"
            ),
            sourceStripeEventRowId: row.source_stripe_event_row_id
          });
        }
      ));
    },
    async applyRetainedExitPolicy(value) {
      exactInput(
        value,
        ["observedAt", "projectId", "subscriptionId", "tenantId", "windowId"],
        "retainedExitPolicy"
      );
      return translated(() => database.service(
        {
          organizationId: uuid(value.tenantId, "retainedExitPolicy.tenantId"),
          isolation: "serializable"
        },
        async (client) => {
          const selected = await client.query(
            `select * from ss.apply_alakazam_premium_retained_exit_policy(
               $1, $2, $3, $4, $5
             )`,
            [
              value.tenantId,
              uuid(value.projectId, "retainedExitPolicy.projectId"),
              uuid(value.subscriptionId, "retainedExitPolicy.subscriptionId"),
              uuid(value.windowId, "retainedExitPolicy.windowId"),
              requiredIso(value.observedAt, "retainedExitPolicy.observedAt")
            ]
          );
          return Object.freeze(selected.rows[0]);
        }
      ));
    },
    async purgeExpired(value) {
      exactInput(
        value,
        ["observedAt", "projectId", "receiptId", "subscriptionId", "tenantId"],
        "premiumPurge"
      );
      return translated(() => database.service(
        {
          organizationId: uuid(value.tenantId, "premiumPurge.tenantId"),
          isolation: "serializable"
        },
        async (client) => {
          const selected = await client.query(
            `select * from ss.purge_expired_alakazam_premium(
               $1, $2, $3, $4, $5
             )`,
            [
              value.tenantId,
              uuid(value.projectId, "premiumPurge.projectId"),
              uuid(value.subscriptionId, "premiumPurge.subscriptionId"),
              uuid(value.receiptId, "premiumPurge.receiptId"),
              requiredIso(value.observedAt, "premiumPurge.observedAt")
            ]
          );
          return Object.freeze(selected.rows[0]);
        }
      ));
    }
  });
}
