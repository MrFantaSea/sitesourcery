import {
  CommerceV2Error,
  invariant
} from "../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_PUBLICATION_HOLD_REASON,
  createAlakazamPublicationCommand
} from "../commerce-v2/alakazam-publication.mjs";

const RUNTIME_CONTRACT =
  "canonical-alakazam-customer-publication-held-v1";
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
const DATABASE_RETRY_CODES = new Set([
  "40001",
  "40P01"
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EXPECTED_CONSTRAINTS = Object.freeze([
  ["alakazam_customer_publication_commands_pkey", "p"],
  ["alakazam_customer_publication_commands_validate", "t"],
  ["alakazam_publication_action_check", "c"],
  ["alakazam_publication_action_target_check", "c"],
  ["alakazam_publication_command_digest_uniq", "u"],
  ["alakazam_publication_command_scope_uniq", "u"],
  ["alakazam_publication_current_release_check", "c"],
  ["alakazam_publication_current_release_fk", "f"],
  ["alakazam_publication_customer_user_fk", "f"],
  ["alakazam_publication_hold_reason_check", "c"],
  ["alakazam_publication_membership_fk", "f"],
  ["alakazam_publication_operation_fk", "f"],
  ["alakazam_publication_project_fk", "f"],
  ["alakazam_publication_projection_check", "c"],
  ["alakazam_publication_revision_check", "c"],
  ["alakazam_publication_state_check", "c"],
  ["alakazam_publication_subscription_fk", "f"],
  ["alakazam_publication_target_release_fk", "f"],
  ["alakazam_publication_target_version_fk", "f"]
]);
const EXPECTED_FOREIGN_KEYS = Object.freeze([
  [
    "alakazam_publication_current_release_fk",
    ["organization_id", "current_release_id"],
    "ss",
    "releases",
    ["organization_id", "id"]
  ],
  [
    "alakazam_publication_customer_user_fk",
    ["customer_user_id"],
    "auth",
    "users",
    ["id"]
  ],
  [
    "alakazam_publication_membership_fk",
    ["organization_id", "customer_user_id"],
    "ss",
    "organization_memberships",
    ["organization_id", "user_id"]
  ],
  [
    "alakazam_publication_operation_fk",
    ["organization_id", "authority_operation_id"],
    "ss",
    "alakazam_fulfillment_operations",
    ["organization_id", "id"]
  ],
  [
    "alakazam_publication_project_fk",
    ["organization_id", "project_id"],
    "ss",
    "projects",
    ["organization_id", "id"]
  ],
  [
    "alakazam_publication_subscription_fk",
    ["organization_id", "subscription_id"],
    "ss",
    "alakazam_subscriptions",
    ["organization_id", "id"]
  ],
  [
    "alakazam_publication_target_release_fk",
    ["organization_id", "target_release_id"],
    "ss",
    "releases",
    ["organization_id", "id"]
  ],
  [
    "alakazam_publication_target_version_fk",
    ["organization_id", "target_version_id"],
    "ss",
    "site_versions",
    ["organization_id", "id"]
  ]
]);
const EXPECTED_KEY_CONSTRAINTS = Object.freeze([
  ["alakazam_customer_publication_commands_pkey", ["id"]],
  ["alakazam_publication_command_digest_uniq", ["command_digest"]],
  [
    "alakazam_publication_command_scope_uniq",
    ["organization_id", "id"]
  ]
]);
const EXPECTED_CHECK_CONSTRAINTS = Object.freeze([
  [
    "alakazam_publication_action_check",
    "CHECK ((action = ANY (ARRAY['publish'::text, " +
      "'rollback'::text, 'unpublish'::text])))"
  ],
  [
    "alakazam_publication_action_target_check",
    "CHECK ((((action = 'publish'::text) " +
      "AND (target_release_id IS NULL) " +
      "AND (target_version_id IS NOT NULL) " +
      "AND (target_artifact_digest IS NOT NULL)) " +
      "OR ((action = 'rollback'::text) " +
      "AND (projection_state = 'live'::text) " +
      "AND (current_release_id IS NOT NULL) " +
      "AND (target_release_id IS NOT NULL) " +
      "AND (target_release_id <> current_release_id) " +
      "AND (target_version_id IS NOT NULL) " +
      "AND (target_artifact_digest IS NOT NULL)) " +
      "OR ((action = 'unpublish'::text) " +
      "AND (projection_state = 'live'::text) " +
      "AND (current_release_id IS NOT NULL) " +
      "AND (target_release_id IS NULL) " +
      "AND (target_version_id IS NULL) " +
      "AND (target_artifact_digest IS NULL))))"
  ],
  [
    "alakazam_publication_current_release_check",
    "CHECK ((((projection_state = 'live'::text) " +
      "AND (current_release_id IS NOT NULL)) " +
      "OR (projection_state = ANY " +
      "(ARRAY['dark'::text, 'failed'::text]))))"
  ],
  [
    "alakazam_publication_hold_reason_check",
    "CHECK ((hold_reason = 'commercial_cutover_not_authorized'::text))"
  ],
  [
    "alakazam_publication_projection_check",
    "CHECK ((projection_state = ANY " +
      "(ARRAY['live'::text, 'dark'::text, " +
      "'failed'::text])))"
  ],
  [
    "alakazam_publication_revision_check",
    "CHECK ((subscription_revision > 0))"
  ],
  [
    "alakazam_publication_state_check",
    "CHECK ((state = 'held'::text))"
  ]
]);

function exactCatalog(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function exactCheckConstraints(rows) {
  return exactCatalog(
    rows
      .filter((row) => row.type === "c")
      .map((row) => [row.name, row.definition]),
    EXPECTED_CHECK_CONSTRAINTS
  );
}

function readinessInvariant(condition, facet) {
  invariant(
    condition,
    "publication_held",
    `Alakazam publication ${facet} is not ready`,
    { status: 503 }
  );
}

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required for Alakazam publication",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_RETRY_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "publication_retry_required",
      "the Alakazam publication authority changed concurrently; refresh before retrying",
      { status: 409 }
    );
  }
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam publication repository rejected inconsistent evidence",
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
    new Date(selected).toISOString() === selected,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function databaseInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected > 0,
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

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function readInput(value) {
  exactInput(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "publicationRead"
  );
  const actorId = uuid(value.actorId, "actorId");
  const customerId = uuid(value.customerId, "customerId");
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer publication project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: uuid(value.tenantId, "tenantId"),
    customerId,
    actorId,
    projectId: uuid(value.projectId, "projectId")
  });
}

function commandInput(value) {
  exactInput(
    value,
    [
      "action",
      "actorId",
      "commandId",
      "customerId",
      "projectId",
      "requestedAt",
      "snapshotDigest",
      "targetReleaseId",
      "tenantId"
    ],
    "publicationCommand"
  );
  return Object.freeze({
    ...readInput({
      tenantId: value.tenantId,
      customerId: value.customerId,
      actorId: value.actorId,
      projectId: value.projectId
    }),
    commandId: uuid(value.commandId, "commandId"),
    action: value.action,
    snapshotDigest: value.snapshotDigest,
    targetReleaseId: value.targetReleaseId,
    requestedAt: value.requestedAt
  });
}

function storedCommand(row) {
  if (!row) return null;
  return Object.freeze({
    commandId: row.id,
    action: row.action,
    state: row.state,
    holdReason: row.hold_reason,
    snapshotDigest: row.snapshot_digest,
    commandDigest: row.command_digest,
    targetReleaseId: row.target_release_id,
    targetVersionId: row.target_version_id,
    requestedAt: databaseIso(
      row.requested_at,
      "publication.command.requestedAt"
    )
  });
}

async function selectPublication(client, input, { lock = false } = {}) {
  const authority = await client.query(
    `select
       subscription.id as subscription_id,
       subscription.revision as subscription_revision,
       subscription.tier_id,
       subscription.status as subscription_status,
       projection.operation_id,
       projection.state as projection_state,
       projection.hostname,
       projection.current_release_id,
       projection.updated_at,
       accepted.version_id as accepted_version_id,
       accepted.artifact_digest as accepted_artifact_digest,
       current_release.version_id as current_version_id
     from ss.projects project
     join ss.organizations organization
       on organization.id = project.organization_id
      and organization.state = 'active'
     join ss.organization_memberships membership
       on membership.organization_id = project.organization_id
      and membership.user_id = $3
      and membership.state = 'active'
      and membership.role in ('owner', 'admin', 'editor')
     join ss.alakazam_subscriptions subscription
       on subscription.organization_id = project.organization_id
      and subscription.project_id = project.id
      and subscription.customer_user_id = $3
      and subscription.status = 'active'
     join ss.alakazam_fulfillment_projection projection
       on projection.organization_id = project.organization_id
      and projection.project_id = project.id
      and projection.state in ('live', 'dark', 'failed')
     join ss.alakazam_fulfillment_operations operation
       on operation.organization_id = projection.organization_id
      and operation.project_id = projection.project_id
      and operation.id = projection.operation_id
      and operation.subscription_id = subscription.id
      and operation.subscription_revision = subscription.revision
      and operation.customer_user_id = subscription.customer_user_id
     join lateral (
       select
         version.id as version_id,
         artifact.artifact_digest
       from ss.site_versions version
       join ss.version_state_projection version_state
         on version_state.organization_id = version.organization_id
        and version_state.project_id = version.project_id
        and version_state.version_id = version.id
        and version_state.state = 'accepted_release'
       join ss.artifacts artifact
         on artifact.organization_id = version.organization_id
        and artifact.project_id = version.project_id
        and artifact.id = version.artifact_id
       where version.organization_id = project.organization_id
         and version.project_id = project.id
       order by version.created_at desc, version.id desc
       limit 1
     ) accepted on true
     left join ss.releases current_release
       on current_release.organization_id = projection.organization_id
      and current_release.project_id = projection.project_id
      and current_release.id = projection.current_release_id
    where project.organization_id = $1
      and project.id = $2
      and project.lifecycle = 'active'
    ${lock ? "for update of project, subscription, projection" : ""}`,
    [input.tenantId, input.projectId, input.customerId]
  );
  invariant(
    authority.rowCount === 1,
    "project_unavailable",
    "the customer publication project is unavailable",
    { status: 404 }
  );
  const row = authority.rows[0];
  invariant(
    row.projection_state !== "live" ||
      row.current_version_id !== null,
    "repository_conflict",
    "the current Alakazam release evidence is unavailable",
    { status: 500 }
  );

  const history = await client.query(
    `select
       release.id as release_id,
       release.version_id,
       release.artifact_digest,
       release.released_at,
       release.id = $4 as is_current
     from ss.alakazam_fulfillment_operations operation
     join ss.releases release
       on release.organization_id = operation.organization_id
      and release.project_id = operation.project_id
      and release.id = operation.result_release_id
    where operation.organization_id = $1
      and operation.project_id = $2
      and operation.customer_user_id = $3
      and operation.state = 'published'
    order by
      (release.id = $4) desc,
      release.released_at desc,
      release.id desc
    limit 3`,
    [
      input.tenantId,
      input.projectId,
      input.customerId,
      row.current_release_id
    ]
  );
  const commands = await client.query(
    `select *
       from ss.alakazam_customer_publication_commands
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3
      order by requested_at desc, id desc
      limit 1`,
    [input.tenantId, input.projectId, input.customerId]
  );
  return Object.freeze({
    authority: Object.freeze({
      operationId: row.operation_id,
      projectionState: row.projection_state
    }),
    publication: Object.freeze({
      projectId: input.projectId,
      subscription: Object.freeze({
        subscriptionId: row.subscription_id,
        revision: databaseInteger(
          row.subscription_revision,
          "publication.subscription.revision"
        ),
        tierId: row.tier_id,
        status: row.subscription_status
      }),
      site: Object.freeze({
        hostname: row.hostname,
        state: row.projection_state,
        acceptedVersionId: row.accepted_version_id,
        acceptedArtifactDigest:
          row.accepted_artifact_digest,
        currentReleaseId: row.current_release_id,
        currentVersionId: row.current_version_id,
        updatedAt: databaseIso(
          row.updated_at,
          "publication.site.updatedAt"
        )
      }),
      history: Object.freeze(
        history.rows.map((entry) => Object.freeze({
          releaseId: entry.release_id,
          versionId: entry.version_id,
          artifactDigest: entry.artifact_digest,
          releasedAt: databaseIso(
            entry.released_at,
            "publication.history.releasedAt"
          ),
          isCurrent: entry.is_current === true
        }))
      ),
      lastCommand: storedCommand(commands.rows[0] ?? null)
    })
  });
}

export function createPostgresAlakazamPublicationRepository({
  authority
} = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const marker = await client.query(
            `select
               ss.hosted_alakazam_publication_contract()
                 as runtime_contract`
          );
          const storage = await client.query(
            `select
               relation.relkind = 'r' as ordinary_table,
               relation.relpersistence = 'p' as permanent_table,
               relation.relrowsecurity as rls_enabled,
               relation.relforcerowsecurity as rls_forced,
               not exists (
                 select 1
                   from pg_catalog.pg_policy policy
                  where policy.polrelid = relation.oid
               ) as no_direct_policies
             from pg_catalog.pg_class relation
            where relation.oid =
              'ss.alakazam_customer_publication_commands'::regclass`
          );
          const tableGrants = await client.query(
            `select
               coalesce(grantee.rolname, 'PUBLIC') as role_name,
               privilege.privilege_type,
               privilege.is_grantable
             from pg_catalog.pg_class relation
             cross join lateral pg_catalog.aclexplode(
               coalesce(
                 relation.relacl,
                 pg_catalog.acldefault('r', relation.relowner)
               )
             ) privilege
             left join pg_catalog.pg_roles grantee
               on grantee.oid = privilege.grantee
            where relation.oid =
                'ss.alakazam_customer_publication_commands'::regclass
              and privilege.grantee <> relation.relowner
            order by role_name, privilege.privilege_type`
          );
          const columnGrants = await client.query(
            `select
               attribute.attname as column_name,
               coalesce(grantee.rolname, 'PUBLIC') as role_name,
               privilege.privilege_type,
               privilege.is_grantable
             from pg_catalog.pg_attribute attribute
             join pg_catalog.pg_class relation
               on relation.oid = attribute.attrelid
             cross join lateral pg_catalog.aclexplode(
               attribute.attacl
             ) privilege
             left join pg_catalog.pg_roles grantee
               on grantee.oid = privilege.grantee
            where relation.oid =
                'ss.alakazam_customer_publication_commands'::regclass
              and attribute.attnum > 0
              and not attribute.attisdropped
              and privilege.grantee <> relation.relowner
            order by
              attribute.attname,
              role_name,
              privilege.privilege_type`
          );
          const functionGrants = await client.query(
            `select
               procedure_record.proname as function_name,
               coalesce(grantee.rolname, 'PUBLIC') as role_name,
               privilege.privilege_type,
               privilege.is_grantable
             from pg_catalog.pg_proc procedure_record
             join pg_catalog.pg_namespace namespace
               on namespace.oid = procedure_record.pronamespace
             cross join lateral pg_catalog.aclexplode(
               coalesce(
                 procedure_record.proacl,
                 pg_catalog.acldefault(
                   'f',
                   procedure_record.proowner
                 )
               )
             ) privilege
             left join pg_catalog.pg_roles grantee
               on grantee.oid = privilege.grantee
            where namespace.nspname = 'ss'
              and procedure_record.proname in (
                'hosted_alakazam_publication_contract',
                'reject_alakazam_customer_publication_command_mutation',
                'validate_alakazam_customer_publication_command'
              )
              and privilege.grantee <>
                procedure_record.proowner
            order by function_name, role_name, privilege.privilege_type`
          );
          const constraints = await client.query(
            `select
               constraint_record.conname as name,
               constraint_record.contype as type,
               constraint_record.convalidated as validated,
               constraint_record.condeferrable as deferrable,
               constraint_record.confdeltype as delete_action,
               pg_catalog.pg_get_constraintdef(
                 constraint_record.oid
               ) as definition,
               array(
                 select key_attribute.attname
                   from unnest(constraint_record.conkey)
                     with ordinality key_record(attnum, position)
                   join pg_catalog.pg_attribute key_attribute
                     on key_attribute.attrelid =
                       constraint_record.conrelid
                    and key_attribute.attnum = key_record.attnum
                  order by key_record.position
               )::text[] as key_columns
             from pg_catalog.pg_constraint constraint_record
            where constraint_record.conrelid =
              'ss.alakazam_customer_publication_commands'::regclass
            order by constraint_record.conname`
          );
          const foreignKeys = await client.query(
            `select
               constraint_record.conname as name,
               array(
                 select source_attribute.attname
                   from unnest(constraint_record.conkey)
                     with ordinality source_key(attnum, position)
                   join pg_catalog.pg_attribute source_attribute
                     on source_attribute.attrelid =
                       constraint_record.conrelid
                    and source_attribute.attnum = source_key.attnum
                  order by source_key.position
               )::text[] as source_columns,
               target_namespace.nspname as target_schema,
               target_relation.relname as target_table,
               array(
                 select target_attribute.attname
                   from unnest(constraint_record.confkey)
                     with ordinality target_key(attnum, position)
                   join pg_catalog.pg_attribute target_attribute
                     on target_attribute.attrelid =
                       constraint_record.confrelid
                    and target_attribute.attnum = target_key.attnum
                  order by target_key.position
               )::text[] as target_columns
             from pg_catalog.pg_constraint constraint_record
             join pg_catalog.pg_class target_relation
               on target_relation.oid = constraint_record.confrelid
             join pg_catalog.pg_namespace target_namespace
               on target_namespace.oid = target_relation.relnamespace
            where constraint_record.conrelid =
                'ss.alakazam_customer_publication_commands'::regclass
              and constraint_record.contype = 'f'
            order by constraint_record.conname`
          );
          const triggers = await client.query(
            `select
               trigger_record.tgname as name,
               trigger_record.tgtype::integer as type,
               trigger_record.tgconstraint <> 0 as constraint_trigger,
               trigger_record.tgenabled as enabled,
               trigger_record.tgdeferrable as deferrable,
               trigger_record.tginitdeferred as initially_deferred,
               function_namespace.nspname as function_schema,
               function_record.proname as function_name
             from pg_catalog.pg_trigger trigger_record
             join pg_catalog.pg_proc function_record
               on function_record.oid = trigger_record.tgfoid
             join pg_catalog.pg_namespace function_namespace
               on function_namespace.oid = function_record.pronamespace
            where trigger_record.tgrelid =
                'ss.alakazam_customer_publication_commands'::regclass
              and not trigger_record.tgisinternal
            order by trigger_record.tgname`
          );
          const constraintShape = constraints.rows.map(
            (row) => [row.name, row.type]
          );
          const keyConstraintShape = constraints.rows
            .filter((row) => ["p", "u"].includes(row.type))
            .map((row) => [row.name, row.key_columns]);
          const foreignKeyShape = foreignKeys.rows.map(
            (row) => [
              row.name,
              row.source_columns,
              row.target_schema,
              row.target_table,
              row.target_columns
            ]
          );
          readinessInvariant(
            marker.rowCount === 1 &&
              marker.rows[0].runtime_contract ===
                RUNTIME_CONTRACT,
            "runtime marker"
          );
          readinessInvariant(
            storage.rowCount === 1 &&
              Object.values(storage.rows[0]).every(
                (value) => value === true
              ),
            "held table security"
          );
          readinessInvariant(
            exactCatalog(tableGrants.rows, [
                {
                  role_name: "service_role",
                  privilege_type: "INSERT",
                  is_grantable: false
                },
                {
                  role_name: "service_role",
                  privilege_type: "SELECT",
                  is_grantable: false
                }
              ]),
            "table privileges"
          );
          readinessInvariant(
            columnGrants.rowCount === 0,
            "column privileges"
          );
          readinessInvariant(
            exactCatalog(functionGrants.rows, [
                {
                  function_name:
                    "hosted_alakazam_publication_contract",
                  role_name: "service_role",
                  privilege_type: "EXECUTE",
                  is_grantable: false
                },
                {
                  function_name:
                    "reject_alakazam_customer_publication_command_mutation",
                  role_name: "service_role",
                  privilege_type: "EXECUTE",
                  is_grantable: false
                },
                {
                  function_name:
                    "validate_alakazam_customer_publication_command",
                  role_name: "service_role",
                  privilege_type: "EXECUTE",
                  is_grantable: false
                }
              ]),
            "function privileges"
          );
          readinessInvariant(
            exactCatalog(
                constraintShape,
                EXPECTED_CONSTRAINTS
              ) &&
              constraints.rows.every(
                (row) =>
                  row.validated === true &&
                  row.deferrable === (row.type === "t") &&
                  (row.type !== "f" ||
                    row.delete_action === "a")
              ) &&
              exactCatalog(
                keyConstraintShape,
                EXPECTED_KEY_CONSTRAINTS
              ) &&
              exactCheckConstraints(constraints.rows),
            "constraints"
          );
          readinessInvariant(
            exactCatalog(
                foreignKeyShape,
                EXPECTED_FOREIGN_KEYS
              ),
            "foreign keys"
          );
          readinessInvariant(
            exactCatalog(triggers.rows, [
                {
                  name:
                    "alakazam_customer_publication_commands_immutable",
                  type: 27,
                  constraint_trigger: false,
                  enabled: "O",
                  deferrable: false,
                  initially_deferred: false,
                  function_schema: "ss",
                  function_name:
                    "reject_alakazam_customer_publication_command_mutation"
                },
                {
                  name:
                    "alakazam_customer_publication_commands_validate",
                  type: 5,
                  constraint_trigger: true,
                  enabled: "O",
                  deferrable: true,
                  initially_deferred: true,
                  function_schema: "ss",
                  function_name:
                    "validate_alakazam_customer_publication_command"
                }
              ]),
            "triggers"
          );
          return Object.freeze({
            ready: true,
            authorization: true,
            providerEffects: false,
            state: "held",
            holdReason: ALAKAZAM_PUBLICATION_HOLD_REASON,
            runtimeContract: RUNTIME_CONTRACT
          });
        }
      ));
    },
    async readCustomerPublication(value) {
      const input = readInput(value);
      return translated(() => database.service(
        {
          userId: input.actorId,
          organizationId: input.tenantId,
          readOnly: true
        },
        async (client) =>
          (await selectPublication(client, input)).publication
      ));
    },
    async recordCustomerPublicationCommand(value) {
      const input = commandInput(value);
      return translated(() => database.service(
        {
          userId: input.actorId,
          organizationId: input.tenantId,
          isolation: "read-committed"
        },
        async (client) => {
          await client.query(
            `select pg_advisory_xact_lock(
               hashtextextended($1, 0)
             )`,
            [
              `ss-alakazam-publication-command:${
                input.tenantId
              }:${input.commandId}`
            ]
          );
          const replay = await client.query(
            `select *
               from ss.alakazam_customer_publication_commands
              where organization_id = $1
                and id = $2
              for update`,
            [input.tenantId, input.commandId]
          );
          invariant(
            replay.rowCount <= 1,
            "repository_conflict",
            "the Alakazam publication command identity conflicts",
            { status: 500 }
          );
          if (replay.rowCount === 1) {
            const command = storedCommand(replay.rows[0]);
            invariant(
              replay.rows[0].project_id === input.projectId &&
                replay.rows[0].customer_user_id ===
                  input.customerId &&
                command.action === input.action &&
                command.snapshotDigest ===
                  input.snapshotDigest &&
                command.targetReleaseId ===
                  input.targetReleaseId,
              "publication_command_conflict",
              "that Alakazam publication command identity was already used",
              { status: 409 }
            );
            const selected = await selectPublication(
              client,
              input,
              { lock: true }
            );
            return Object.freeze({
              publication: selected.publication,
              command
            });
          }

          const selected = await selectPublication(
            client,
            input,
            { lock: true }
          );
          const command = createAlakazamPublicationCommand({
            scope: {
              tenantId: input.tenantId,
              customerId: input.customerId,
              actorId: input.actorId,
              projectId: input.projectId
            },
            publication: selected.publication,
            request: {
              commandId: input.commandId,
              action: input.action,
              snapshotDigest: input.snapshotDigest,
              targetReleaseId: input.targetReleaseId
            },
            requestedAt: input.requestedAt
          });
          const target = command.action === "publish"
            ? {
                artifactDigest:
                  selected.publication.site
                    .acceptedArtifactDigest
              }
            : command.action === "rollback"
              ? selected.publication.history.find(
                  (entry) =>
                    entry.releaseId ===
                      command.targetReleaseId
                )
              : { artifactDigest: null };
          invariant(
            target,
            "publication_authority_changed",
            "the Alakazam publication target changed; refresh before trying again",
            { status: 409 }
          );
          const inserted = await client.query(
            `insert into ss.alakazam_customer_publication_commands (
               id, organization_id, project_id,
               customer_user_id, subscription_id,
               subscription_revision, authority_operation_id,
               action, projection_state, hostname,
               current_release_id, target_release_id,
               target_version_id, target_artifact_digest,
               snapshot_digest, command_digest,
               state, hold_reason, requested_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12, $13, $14,
               $15, $16, 'held', $17, $18
             )
             returning *`,
            [
              command.commandId,
              command.tenantId,
              command.projectId,
              command.customerId,
              command.subscriptionId,
              command.subscriptionRevision,
              selected.authority.operationId,
              command.action,
              selected.authority.projectionState,
              selected.publication.site.hostname,
              command.currentReleaseId,
              command.targetReleaseId,
              command.targetVersionId,
              target.artifactDigest,
              command.snapshotDigest,
              command.commandDigest,
              command.holdReason,
              command.requestedAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "repository_conflict",
            "the Alakazam publication command was not recorded",
            { status: 500 }
          );
          return Object.freeze({
            publication: Object.freeze({
              ...selected.publication,
              lastCommand: storedCommand(inserted.rows[0])
            }),
            command: storedCommand(inserted.rows[0])
          });
        }
      ));
    }
  });
}
