import {
  CommerceV2Error,
  invariant
} from "../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_35_HOLD_REASON,
  ALAKAZAM_35_PHOTO_SCHEMA,
  createAlakazam35CareRequest,
  createAlakazam35Configuration,
  createAlakazam35Snapshot
} from "../commerce-v2/alakazam-35.mjs";

const RUNTIME_CONTRACT = "canonical-alakazam-35-held-v1";
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
const EXPECTED_TABLES = Object.freeze([
  "alakazam_35_care_requests",
  "alakazam_35_configurations",
  "alakazam_35_photo_assets"
]);
const EXPECTED_TRIGGERS = Object.freeze([
  [
    "alakazam_35_care_requests",
    "alakazam_35_care_requests_immutable",
    "reject_alakazam_35_evidence_mutation"
  ],
  [
    "alakazam_35_care_requests",
    "alakazam_35_care_requests_validate",
    "validate_alakazam_35_care_request"
  ],
  [
    "alakazam_35_configurations",
    "alakazam_35_configurations_immutable",
    "reject_alakazam_35_evidence_mutation"
  ],
  [
    "alakazam_35_configurations",
    "alakazam_35_configurations_validate",
    "validate_alakazam_35_configuration"
  ],
  [
    "alakazam_35_photo_assets",
    "alakazam_35_photo_assets_immutable",
    "reject_alakazam_35_evidence_mutation"
  ],
  [
    "alakazam_35_photo_assets",
    "alakazam_35_photo_assets_validate",
    "validate_alakazam_35_photo_asset"
  ]
]);

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required for Alakazam $35",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_RETRY_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "configuration_changed",
      "the Alakazam configuration changed concurrently; refresh before retrying",
      { status: 409 }
    );
  }
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam $35 repository rejected inconsistent evidence",
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

function photoMetadata(row) {
  if (!row) return null;
  return Object.freeze({
    assetId: row.id,
    assetDigest: row.asset_digest,
    assetPath: row.asset_path,
    mediaType: row.media_type,
    byteCount: databaseInteger(row.byte_count, "photo.byteCount"),
    width: databaseInteger(row.width, "photo.width"),
    height: databaseInteger(row.height, "photo.height"),
    uploadedAt: databaseIso(row.uploaded_at, "photo.uploadedAt")
  });
}

async function selectAuthority(client, input, { lock = false } = {}) {
  const selected = await client.query(
    `select
       subscription.id as subscription_id,
       subscription.tier_id,
       subscription.status,
       subscription.revision
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
      and subscription.status in ('active', 'grace')
      and ss.alakazam_tier_rank(subscription.tier_id) >= 2
    where project.organization_id = $1
      and project.id = $2
      and project.lifecycle = 'active'
    ${lock ? "for update of project, subscription" : ""}`,
    [input.tenantId, input.projectId, input.customerId]
  );
  invariant(
    selected.rowCount === 1,
    "alakazam_35_unavailable",
    "the active Alakazam tier does not include the $35 controls",
    { status: 409 }
  );
  const row = selected.rows[0];
  return Object.freeze({
    subscriptionId: row.subscription_id,
    tierId: row.tier_id,
    status: row.status,
    revision: databaseInteger(row.revision, "subscription.revision")
  });
}

async function selectPhoto(client, input, assetId = null) {
  const selected = await client.query(
    `select *
       from ss.alakazam_35_photo_assets
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3
        and ($4::uuid is null or id = $4)
      order by uploaded_at desc, id desc
      limit 1`,
    [input.tenantId, input.projectId, input.customerId, assetId]
  );
  return selected.rowCount === 0 ? null : photoMetadata(selected.rows[0]);
}

async function selectConfiguration(client, input, subscription) {
  const selected = await client.query(
    `select configuration.*, photo.id as photo_id,
       photo.asset_digest as photo_asset_digest,
       photo.asset_path as photo_asset_path,
       photo.media_type as photo_media_type,
       photo.byte_count as photo_byte_count,
       photo.width as photo_width,
       photo.height as photo_height,
       photo.uploaded_at as photo_uploaded_at
     from ss.alakazam_35_configurations configuration
     left join ss.alakazam_35_photo_assets photo
       on photo.organization_id = configuration.organization_id
      and photo.id = configuration.photo_asset_id
    where configuration.organization_id = $1
      and configuration.project_id = $2
      and configuration.customer_user_id = $3
    order by configuration.configuration_revision desc
    limit 1`,
    [input.tenantId, input.projectId, input.customerId]
  );
  if (selected.rowCount === 0) return null;
  const row = selected.rows[0];
  const photo = row.photo_id === null
    ? null
    : photoMetadata({
        id: row.photo_id,
        asset_digest: row.photo_asset_digest,
        asset_path: row.photo_asset_path,
        media_type: row.photo_media_type,
        byte_count: row.photo_byte_count,
        width: row.photo_width,
        height: row.photo_height,
        uploaded_at: row.photo_uploaded_at
      });
  const configuration = createAlakazam35Configuration({
    scope: input,
    commandId: row.id,
    subscription: {
      ...subscription,
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
    fontChoiceId: row.font_choice_id,
    sections: row.section_visibility,
    photo,
    configuredAt: databaseIso(
      row.configured_at,
      "configuration.configuredAt"
    )
  });
  invariant(
    configuration.configurationDigest === row.configuration_digest,
    "repository_conflict",
    "the stored Alakazam configuration digest changed",
    { status: 500 }
  );
  return configuration;
}

async function readSnapshot(client, input) {
  const subscription = await selectAuthority(client, input);
  const [latestPhoto, configuration, history, care] = await Promise.all([
    selectPhoto(client, input),
    selectConfiguration(client, input, subscription),
    client.query(
      `select
         version.id as version_id,
         version.version_number,
         artifact.artifact_digest,
         version_state.updated_at as accepted_at,
         row_number() over (
           order by version.version_number desc, version.id desc
         ) = 1 as is_current
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
      where version.organization_id = $1
        and version.project_id = $2
      order by version.version_number desc, version.id desc
      limit 3`,
      [input.tenantId, input.projectId]
    ),
    client.query(
      `select count(*)::bigint as request_count,
         max(requested_at) as last_requested_at
       from ss.alakazam_35_care_requests
      where organization_id = $1
        and project_id = $2
        and customer_user_id = $3`,
      [input.tenantId, input.projectId, input.customerId]
    )
  ]);
  return createAlakazam35Snapshot({
    projectId: input.projectId,
    subscription,
    photo: latestPhoto,
    configuration,
    history: history.rows.map((row) => ({
      versionId: row.version_id,
      versionNumber: databaseInteger(
        row.version_number,
        "history.versionNumber"
      ),
      artifactDigest: row.artifact_digest,
      acceptedAt: databaseIso(row.accepted_at, "history.acceptedAt"),
      isCurrent: row.is_current === true
    })),
    care: {
      requestCount: databaseInteger(
        care.rows[0]?.request_count ?? 0,
        "care.requestCount",
        { allowZero: true }
      ),
      lastRequestedAt: care.rows[0]?.last_requested_at === null
        ? null
        : databaseIso(
            care.rows[0].last_requested_at,
            "care.lastRequestedAt"
          )
    }
  });
}

export function createPostgresAlakazam35Repository({ authority } = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    async readiness() {
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const marker = await client.query(
            `select ss.hosted_alakazam_35_contract() as runtime_contract`
          );
          const tables = await client.query(
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
          );
          const triggers = await client.query(
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
          );
          const grants = await client.query(
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
          );
          const tableShape = tables.rows.map((row) => row.table_name);
          const triggerShape = triggers.rows.map((row) => [
            row.table_name,
            row.trigger_name,
            row.function_name
          ]);
          const grantShape = grants.rows.map((row) => [
            row.table_name,
            row.grantee,
            row.privilege_type
          ]);
          const expectedGrants = EXPECTED_TABLES.flatMap((tableName) => [
            [tableName, "service_role", "INSERT"],
            [tableName, "service_role", "SELECT"]
          ]).sort();
          invariant(
            marker.rows[0]?.runtime_contract === RUNTIME_CONTRACT &&
              JSON.stringify(tableShape) === JSON.stringify(EXPECTED_TABLES) &&
              tables.rows.every((row) =>
                row.ordinary_table === true &&
                row.permanent_table === true &&
                row.rls_enabled === true &&
                row.rls_forced === true &&
                row.no_direct_policies === true
              ) &&
              JSON.stringify(triggerShape) ===
                JSON.stringify(EXPECTED_TRIGGERS) &&
              triggers.rows.every((row) => row.enabled === true) &&
              grants.rows.every((row) => row.is_grantable === false) &&
              JSON.stringify(grantShape) === JSON.stringify(expectedGrants),
            "alakazam_35_held",
            "Alakazam $35 durable authorization is not ready",
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
            subscription.revision ===
              input.expectedSubscriptionRevision,
            "configuration_changed",
            "the Alakazam subscription changed before compilation",
            { status: 409 }
          );
          const configuration = await selectConfiguration(
            client,
            input,
            subscription
          );
          invariant(
            configuration &&
              configuration.subscriptionRevision ===
                input.expectedSubscriptionRevision,
            "alakazam_35_configuration_required",
            "save the Alakazam $35 configuration before fulfillment",
            { status: 409 }
          );
          if (configuration.photo === null) {
            return Object.freeze({
              configuration,
              mediaAsset: null
            });
          }
          const selected = await client.query(
            `select media_bytes
               from ss.alakazam_35_photo_assets
              where organization_id = $1
                and project_id = $2
                and customer_user_id = $3
                and id = $4`,
            [
              input.tenantId,
              input.projectId,
              input.customerId,
              configuration.photo.assetId
            ]
          );
          invariant(
            selected.rowCount === 1,
            "repository_conflict",
            "the immutable Alakazam header photo bytes are unavailable",
            { status: 500 }
          );
          return Object.freeze({
            configuration,
            mediaAsset: Object.freeze({
              schema: ALAKAZAM_35_PHOTO_SCHEMA,
              ...configuration.photo,
              mediaBytes: Buffer.from(selected.rows[0].media_bytes),
              state: "held",
              holdReason: ALAKAZAM_35_HOLD_REASON
            })
          });
        }
      ));
    },
    async readPublicationAsset(value) {
      exactInput(
        value,
        ["assetDigest", "assetPath", "organizationId", "projectId"],
        "publicationAsset"
      );
      return translated(() => database.service(
        {
          organizationId: value.organizationId,
          readOnly: true
        },
        async (client) => {
          const selected = await client.query(
            `select *
               from ss.alakazam_35_photo_assets
              where organization_id = $1
                and project_id = $2
                and asset_digest = $3
                and asset_path = $4`,
            [
              value.organizationId,
              value.projectId,
              value.assetDigest,
              value.assetPath
            ]
          );
          invariant(
            selected.rowCount === 1,
            "alakazam_photo_unavailable",
            "the immutable Alakazam publication asset is unavailable",
            { status: 409 }
          );
          const row = selected.rows[0];
          return Object.freeze({
            ...photoMetadata(row),
            bytes: Buffer.from(row.media_bytes)
          });
        }
      ));
    },
    async storePhoto(value, photo) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input),
        async (client) => {
          await client.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`ss-alakazam-35-photo:${input.tenantId}:${photo.assetId}`]
          );
          const authority = await selectAuthority(client, input, { lock: true });
          const replay = await client.query(
            `select * from ss.alakazam_35_photo_assets
              where organization_id = $1 and id = $2 for update`,
            [input.tenantId, photo.assetId]
          );
          if (replay.rowCount === 1) {
            const stored = replay.rows[0];
            invariant(
              stored.project_id === input.projectId &&
                stored.customer_user_id === input.customerId &&
                stored.asset_digest === photo.assetDigest &&
                stored.asset_path === photo.assetPath,
              "idempotency_conflict",
              "the Alakazam photo command was already used differently",
              { status: 409 }
            );
            return photoMetadata(stored);
          }
          await client.query(
            `insert into ss.alakazam_35_photo_assets (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision, media_type,
               media_bytes, width, height, asset_path, state,
               hold_reason, uploaded_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, 'held', $12, $13
             )`,
            [
              photo.assetId,
              input.tenantId,
              input.projectId,
              input.customerId,
              authority.subscriptionId,
              authority.revision,
              photo.mediaType,
              photo.mediaBytes,
              photo.width,
              photo.height,
              photo.assetPath,
              ALAKAZAM_35_HOLD_REASON,
              photo.uploadedAt
            ]
          );
          return photo;
        }
      ));
    },
    async saveConfiguration(value, command) {
      const input = scopeInput(value);
      return translated(() => database.service(
        context(input),
        async (client) => {
          await client.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`ss-alakazam-35-config:${input.tenantId}:${command.commandId}`]
          );
          const authority = await selectAuthority(client, input, { lock: true });
          const photo = command.photoAssetId === null
            ? null
            : await selectPhoto(client, input, command.photoAssetId);
          invariant(
            command.photoAssetId === null || photo !== null,
            "alakazam_photo_unavailable",
            "the selected Alakazam header photo is unavailable",
            { status: 409 }
          );
          const configuration = createAlakazam35Configuration({
            scope: input,
            commandId: command.commandId,
            subscription: authority,
            expectedCurrentRevision: command.expectedCurrentRevision,
            fontChoiceId: command.fontChoiceId,
            sections: command.sections,
            photo,
            configuredAt: command.configuredAt
          });
          const replay = await client.query(
            `select configuration_digest
               from ss.alakazam_35_configurations
              where organization_id = $1 and id = $2 for update`,
            [input.tenantId, command.commandId]
          );
          if (replay.rowCount === 1) {
            invariant(
              replay.rows[0].configuration_digest ===
                configuration.configurationDigest,
              "idempotency_conflict",
              "the Alakazam configuration command was already used differently",
              { status: 409 }
            );
            return configuration;
          }
          await client.query(
            `insert into ss.alakazam_35_configurations (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision,
               configuration_revision, font_choice_id,
               section_visibility, photo_asset_id,
               configuration_digest, state, hold_reason, configured_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               $9::jsonb, $10, $11, 'held', $12, $13
             )`,
            [
              configuration.commandId,
              input.tenantId,
              input.projectId,
              input.customerId,
              configuration.subscriptionId,
              configuration.subscriptionRevision,
              configuration.configurationRevision,
              configuration.fontChoiceId,
              JSON.stringify(configuration.sections),
              configuration.photo?.assetId ?? null,
              configuration.configurationDigest,
              ALAKAZAM_35_HOLD_REASON,
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
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [`ss-alakazam-35-care:${input.tenantId}:${command.commandId}`]
          );
          const authority = await selectAuthority(client, input, { lock: true });
          const care = createAlakazam35CareRequest({
            scope: input,
            commandId: command.commandId,
            subscription: authority,
            message: command.message,
            requestedAt: command.requestedAt
          });
          const replay = await client.query(
            `select request_digest
               from ss.alakazam_35_care_requests
              where organization_id = $1 and id = $2 for update`,
            [input.tenantId, command.commandId]
          );
          if (replay.rowCount === 1) {
            invariant(
              replay.rows[0].request_digest === care.requestDigest,
              "idempotency_conflict",
              "the Alakazam care command was already used differently",
              { status: 409 }
            );
            return care;
          }
          await client.query(
            `insert into ss.alakazam_35_care_requests (
               id, organization_id, project_id, customer_user_id,
               subscription_id, subscription_revision, care_class,
               request_message, request_digest, state, hold_reason,
               requested_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'modest', $7,
               $8, 'held', $9, $10
             )`,
            [
              care.commandId,
              input.tenantId,
              input.projectId,
              input.customerId,
              care.subscriptionId,
              care.subscriptionRevision,
              care.message,
              care.requestDigest,
              ALAKAZAM_35_HOLD_REASON,
              care.requestedAt
            ]
          );
          return care;
        }
      ));
    }
  });
}
