import {
  CommerceV2Error,
  invariant
} from "../commerce-v2/canonical.mjs";
import {
  authorizeAlakazamCapability
} from "../commerce-v2/alakazam.mjs";
import {
  ALAKAZAM_PUBLICATION_HOLD_REASON,
  createAlakazamPublicationCommand
} from "../commerce-v2/alakazam-publication.mjs";
import {
  PUBLICATION_CONTROL_CAPABILITY,
  createHeldPublicationControlCommand
} from "../commerce-v2/publication-control-authority.mjs";
import {
  createPostgresAlakazamPublicationRepository
} from "./alakazam-publication-postgres.mjs";

const RUNTIME_CONTRACT =
  "canonical-publication-control-held-v1";
const RUNTIME_CONTRACT_V2 =
  "canonical-publication-control-v2-released-leased";
const RELEASED_POLICY_ID =
  "SS-ALAKAZAM-POLICY-2026-08-31-V2";
const RELEASED_POLICY_DIGEST =
  "145892e43ab6f4a03ebbed84fd148633f9a4de9727ce4294a0eb9b08f329c320";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
    "canonical PostgreSQL authority is required for publication controls",
    { status: 500 }
  );
  return value;
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_RETRY_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "publication_retry_required",
      "the publication authority changed concurrently; refresh before retrying",
      { status: 409 }
    );
  }
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable publication-control repository rejected inconsistent evidence",
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

function nonnegativeInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= 0,
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function storedCommand(row) {
  if (!row) return null;
  const executionState = {
    queued: "queued",
    failed: "queued",
    running: "processing",
    succeeded: "applied",
    reconciliation_required: "reconciliation_required"
  }[row.execution_state] ?? "held";
  return Object.freeze({
    commandId: row.id,
    action: row.action,
    state: executionState,
    holdReason: executionState === "held"
      ? ALAKAZAM_PUBLICATION_HOLD_REASON
      : null,
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

function basicHistory(row) {
  return Object.freeze({
    releaseId: row.authorized_release_id,
    versionId: row.accepted_version_id,
    artifactDigest: row.screening_artifact_digest,
    releasedAt: databaseIso(
      row.released_at,
      "publication.history.releasedAt"
    ),
    isCurrent: row.is_current === true
  });
}

function exactEvidence(row, requestedAt) {
  const subscriptionRevision = positiveInteger(
    row.subscription_revision,
    "publication.subscription.revision"
  );
  const targetSubscriptionRevision = positiveInteger(
    row.target_subscription_revision,
    "publication.targetOperation.subscriptionRevision"
  );
  const capability = authorizeAlakazamCapability(
    {
      subscriptionId: row.subscription_id,
      projectId: row.project_id,
      tierId: row.tier_id,
      status: row.subscription_status,
      revision: subscriptionRevision,
      currentPeriodStartsAt: databaseIso(
        row.current_period_starts_at,
        "publication.subscription.currentPeriodStartsAt"
      ),
      currentPeriodEndsAt: databaseIso(
        row.current_period_ends_at,
        "publication.subscription.currentPeriodEndsAt"
      ),
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
      graceEndsAt: row.grace_ends_at === null
        ? null
        : databaseIso(
            row.grace_ends_at,
            "publication.subscription.graceEndsAt"
          ),
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    {
      capability: PUBLICATION_CONTROL_CAPABILITY,
      now: requestedAt
    }
  );
  return Object.freeze({
    authorityKind: "alakazam",
    entitlement: Object.freeze({
      kind: "alakazam_subscription",
      subscriptionId: row.subscription_id,
      revision: subscriptionRevision,
      tierId: row.tier_id,
      status: row.subscription_status,
      currentPeriodEndsAt: databaseIso(
        row.current_period_ends_at,
        "publication.subscription.currentPeriodEndsAt"
      ),
      graceEndsAt: row.grace_ends_at === null
        ? null
        : databaseIso(
            row.grace_ends_at,
            "publication.subscription.graceEndsAt"
          )
    }),
    capabilityGrant: Object.freeze({
      schema: capability.schema,
      subscriptionId: capability.subscriptionId,
      projectId: capability.projectId,
      tierId: capability.tierId,
      capability: capability.capability,
      authorizedAt: capability.authorizedAt
    }),
    acceptance: Object.freeze({
      eventId: row.acceptance_event_id,
      versionId: row.accepted_version_id,
      artifactId: row.accepted_artifact_id,
      artifactDigest: row.accepted_artifact_digest,
      state: "accepted_release",
      acceptedAt: databaseIso(
        row.accepted_at,
        "publication.acceptance.acceptedAt"
      )
    }),
    screening: Object.freeze({
      id: row.screening_id,
      versionId: row.accepted_version_id,
      stage: "pre_publication",
      method: row.screening_method,
      passed: true,
      artifactDigest: row.screening_artifact_digest,
      checkerRevision: row.screening_checker_revision,
      checkedAt: databaseIso(
        row.screening_checked_at,
        "publication.screening.checkedAt"
      )
    }),
    address: Object.freeze({
      id: row.licensed_address_id,
      kind: "licensed",
      ownership: "licensed",
      state: "configured",
      hostname: row.licensed_hostname
    }),
    authorityOperation: Object.freeze({
      id: row.authority_operation_id,
      intentId: row.authority_intent_id,
      subscriptionId: row.subscription_id,
      subscriptionRevision,
      operationKind: row.authority_operation_kind,
      capability: row.authority_capability,
      effectiveTierId: row.authority_tier_id,
      policyDigest: row.authority_policy_digest,
      state: "published",
      servingRevision: nonnegativeInteger(
        row.authority_serving_revision,
        "publication.authorityOperation.servingRevision"
      ),
      resultReleaseId: row.authority_release_id,
      decisionDigest: row.authority_decision_digest
    }),
    targetOperation: Object.freeze({
      id: row.target_operation_id,
      intentId: row.target_intent_id,
      subscriptionId: row.target_subscription_id,
      subscriptionRevision: targetSubscriptionRevision,
      operationKind: row.target_operation_kind,
      capability: row.target_capability,
      effectiveTierId: row.target_tier_id,
      policyDigest: row.target_policy_digest,
      state: "published",
      servingRevision: nonnegativeInteger(
        row.target_serving_revision,
        "publication.targetOperation.servingRevision"
      ),
      resultReleaseId: row.authorized_release_id,
      decisionDigest: row.target_decision_digest
    }),
    projection: Object.freeze({
      state: row.projection_state,
      currentReleaseId: row.current_release_id,
      currentVersionId: row.current_version_id
    })
  });
}

const EVIDENCE_COLUMNS = `
  subscription.id as subscription_id,
  subscription.project_id,
  subscription.revision as subscription_revision,
  subscription.tier_id,
  subscription.status as subscription_status,
  subscription.current_period_starts_at,
  subscription.current_period_ends_at,
  subscription.cancel_at_period_end,
  subscription.grace_ends_at,
  projection.operation_id as authority_operation_id,
  projection.state as projection_state,
  projection.hostname,
  projection.current_release_id,
  projection.updated_at,
  current_release.version_id as current_version_id,
  authority_operation.intent_id as authority_intent_id,
  authority_operation.operation_kind as authority_operation_kind,
  authority_operation.capability as authority_capability,
  authority_operation.effective_tier_id as authority_tier_id,
  authority_operation.policy_digest as authority_policy_digest,
  authority_operation.serving_revision as authority_serving_revision,
  authority_operation.result_release_id as authority_release_id,
  authority_operation.decision_digest as authority_decision_digest,
  target_operation.id as target_operation_id,
  target_operation.intent_id as target_intent_id,
  target_operation.subscription_id as target_subscription_id,
  target_operation.subscription_revision as target_subscription_revision,
  target_operation.operation_kind as target_operation_kind,
  target_operation.capability as target_capability,
  target_operation.effective_tier_id as target_tier_id,
  target_operation.policy_digest as target_policy_digest,
  target_operation.serving_revision as target_serving_revision,
  target_operation.decision_digest as target_decision_digest,
  target_release.id as authorized_release_id,
  target_release.released_at,
  target_release.id = projection.current_release_id as is_current,
  target_intent.version_id as accepted_version_id,
  source_version.artifact_id as accepted_artifact_id,
  source_artifact.artifact_digest as accepted_artifact_digest,
  acceptance.id as acceptance_event_id,
  acceptance.occurred_at as accepted_at,
  screening.id as screening_id,
  screening.method as screening_method,
  screening.artifact_digest as screening_artifact_digest,
  screening.checker_revision as screening_checker_revision,
  screening.checked_at as screening_checked_at,
  address.id as licensed_address_id,
  address.serving_hostname as licensed_hostname`;

const EVIDENCE_JOINS = `
  join ss.alakazam_fulfillment_operations target_operation
    on target_operation.organization_id = subscription.organization_id
   and target_operation.project_id = subscription.project_id
   and target_operation.customer_user_id = subscription.customer_user_id
   and target_operation.state = 'published'
   and target_operation.capability =
       'publish_accepted_project_version'
  join ss.alakazam_fulfillment_intents target_intent
    on target_intent.organization_id = target_operation.organization_id
   and target_intent.project_id = target_operation.project_id
   and target_intent.id = target_operation.intent_id
  join ss.site_versions source_version
    on source_version.organization_id = target_intent.organization_id
   and source_version.project_id = target_intent.project_id
   and source_version.id = target_intent.version_id
  join ss.artifacts source_artifact
    on source_artifact.organization_id = source_version.organization_id
   and source_artifact.project_id = source_version.project_id
   and source_artifact.id = source_version.artifact_id
   and source_artifact.artifact_digest = target_intent.artifact_digest
  join ss.version_state_projection accepted_state
    on accepted_state.organization_id = source_version.organization_id
   and accepted_state.project_id = source_version.project_id
   and accepted_state.version_id = source_version.id
   and accepted_state.state = 'accepted_release'
  join ss.version_state_events acceptance
    on acceptance.organization_id = accepted_state.organization_id
   and acceptance.project_id = accepted_state.project_id
   and acceptance.version_id = accepted_state.version_id
   and acceptance.id = accepted_state.last_event_id
   and acceptance.state = 'accepted_release'
  join ss.release_screenings screening
    on screening.organization_id = target_operation.organization_id
   and screening.project_id = target_operation.project_id
   and screening.id = target_operation.screening_id
   and screening.version_id = source_version.id
   and screening.stage = 'pre_publication'
   and screening.passed
   and screening.artifact_digest =
       target_operation.effective_artifact_digest
  join ss.project_addresses address
    on address.organization_id = target_intent.organization_id
   and address.project_id = target_intent.project_id
   and address.id = target_intent.address_id
   and address.kind = 'licensed'
   and address.ownership = 'licensed'
   and address.state = 'configured'
   and address.serving_hostname = target_intent.hostname
  join ss.project_address_projection address_projection
    on address_projection.organization_id = address.organization_id
   and address_projection.project_id = address.project_id
   and address_projection.current_address_id = address.id
  join ss.releases target_release
    on target_release.organization_id = target_operation.organization_id
   and target_release.project_id = target_operation.project_id
   and target_release.id = target_operation.result_release_id
   and target_release.version_id = source_version.id
   and target_release.artifact_id = target_operation.effective_artifact_id
   and target_release.artifact_digest =
       target_operation.effective_artifact_digest
   and target_release.hostname = address.serving_hostname`;

async function selectPublication(client, input, { lock = false } = {}) {
  const current = await client.query(
    `select ${EVIDENCE_COLUMNS}
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
       join ss.alakazam_fulfillment_projection projection
         on projection.organization_id = project.organization_id
        and projection.project_id = project.id
        and projection.state in ('live', 'dark', 'failed')
       join ss.alakazam_fulfillment_operations authority_operation
         on authority_operation.organization_id = projection.organization_id
        and authority_operation.project_id = projection.project_id
        and authority_operation.id = projection.operation_id
        and authority_operation.subscription_id = subscription.id
        and authority_operation.subscription_revision = subscription.revision
        and authority_operation.customer_user_id = subscription.customer_user_id
        and authority_operation.effective_tier_id = subscription.tier_id
        and authority_operation.capability =
            'publish_accepted_project_version'
        and authority_operation.state = 'published'
       ${EVIDENCE_JOINS}
       left join ss.releases current_release
         on current_release.organization_id = projection.organization_id
        and current_release.project_id = projection.project_id
        and current_release.id = projection.current_release_id
      where project.organization_id = $1
        and project.id = $2
        and project.lifecycle = 'active'
        and target_operation.id = authority_operation.id
      ${lock ? "for update of project, subscription, projection" : ""}`,
    [input.tenantId, input.projectId, input.customerId]
  );
  invariant(
    current.rowCount === 1,
    "project_unavailable",
    "the customer publication project lacks exact fulfilled authority",
    { status: 404 }
  );
  const row = current.rows[0];
  const history = await client.query(
    `select ${EVIDENCE_COLUMNS}
       from ss.alakazam_subscriptions subscription
       join ss.alakazam_fulfillment_projection projection
         on projection.organization_id = subscription.organization_id
        and projection.project_id = subscription.project_id
       join ss.alakazam_fulfillment_operations authority_operation
         on authority_operation.organization_id = projection.organization_id
        and authority_operation.project_id = projection.project_id
        and authority_operation.id = projection.operation_id
        and authority_operation.subscription_id = subscription.id
        and authority_operation.subscription_revision = subscription.revision
        and authority_operation.customer_user_id = subscription.customer_user_id
        and authority_operation.effective_tier_id = subscription.tier_id
        and authority_operation.capability =
            'publish_accepted_project_version'
        and authority_operation.state = 'published'
       ${EVIDENCE_JOINS}
       left join ss.releases current_release
         on current_release.organization_id = projection.organization_id
        and current_release.project_id = projection.project_id
        and current_release.id = projection.current_release_id
      where subscription.organization_id = $1
        and subscription.project_id = $2
        and subscription.customer_user_id = $3
        and subscription.id = $4
        and subscription.revision = $5
      order by
        (target_release.id = projection.current_release_id) desc,
        target_release.released_at desc,
        target_release.id desc
      limit 3`,
    [
      input.tenantId,
      input.projectId,
      input.customerId,
      row.subscription_id,
      row.subscription_revision
    ]
  );
  const genericCommand = await client.query(
    `select command.*,
            release.state as release_state,
            job.state as execution_state
       from ss.publication_control_commands command
       left join ss.publication_control_releases release
         on release.organization_id = command.organization_id
        and release.command_id = command.id
       left join ss.publication_control_worker_jobs job
         on job.organization_id = command.organization_id
        and job.command_id = command.id
      where command.organization_id = $1
        and command.project_id = $2
        and command.customer_user_id = $3
      order by command.requested_at desc, command.id desc
      limit 1`,
    [input.tenantId, input.projectId, input.customerId]
  );
  let commandRow = genericCommand.rows[0] ?? null;
  if (commandRow === null) {
    const legacyCommand = await client.query(
      `select *
         from ss.alakazam_customer_publication_commands
        where organization_id = $1
          and project_id = $2
          and customer_user_id = $3
        order by requested_at desc, id desc
        limit 1`,
      [input.tenantId, input.projectId, input.customerId]
    );
    commandRow = legacyCommand.rows[0] ?? null;
  }
  return Object.freeze({
    row,
    historyRows: history.rows,
    publication: Object.freeze({
      projectId: input.projectId,
      subscription: Object.freeze({
        subscriptionId: row.subscription_id,
        revision: positiveInteger(
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
        acceptedArtifactDigest: row.accepted_artifact_digest,
        currentReleaseId: row.current_release_id,
        currentVersionId: row.current_version_id,
        updatedAt: databaseIso(
          row.updated_at,
          "publication.site.updatedAt"
        )
      }),
      history: Object.freeze(history.rows.map(basicHistory)),
      lastCommand: storedCommand(commandRow)
    })
  });
}

export function createPostgresPublicationControlRepository({
  authority,
  legacyRepositoryFactory = createPostgresAlakazamPublicationRepository
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    typeof legacyRepositoryFactory === "function",
    "invalid_configuration",
    "legacy publication evidence verifier is required",
    { status: 500 }
  );
  const legacy = legacyRepositoryFactory({ authority: database });
  invariant(
    legacy && typeof legacy.readiness === "function",
    "invalid_configuration",
    "legacy publication evidence readiness is required",
    { status: 500 }
  );
  return Object.freeze({
    async readiness() {
      await legacy.readiness();
      return translated(() => database.service(
        { readOnly: true },
        async (client) => {
          const proof = await client.query(
            `select
               ss.hosted_publication_control_contract() = $1
                 as exact_runtime_marker,
               ss.hosted_publication_control_contract_v2() = $2
                 as exact_runtime_marker_v2,
               exists (
                 select 1
                   from ss.alakazam_policy_releases policy
                  where policy.policy_id = $3
                    and policy.policy_digest = $4
                    and policy.state = 'released'
                    and policy.commercial_effects
                    and policy.provider_effects
                    and policy.publication_effects
                    and not policy.automatic_recovery_from_reversal_evidence
               ) as exact_released_policy,
               has_table_privilege(
                 'service_role',
                 'ss.publication_control_releases',
                 'SELECT,INSERT'
               )
               and not has_table_privilege(
                 'service_role',
                 'ss.publication_control_releases',
                 'UPDATE,DELETE'
               )
               and has_table_privilege(
                 'service_role',
                 'ss.publication_control_worker_jobs',
                 'SELECT,INSERT,UPDATE'
               )
               and not has_table_privilege(
                 'service_role',
                 'ss.publication_control_worker_jobs',
                 'DELETE'
               )
               and has_table_privilege(
                 'service_role',
                 'ss.publication_control_execution_receipts',
                 'SELECT,INSERT'
               )
               and not has_table_privilege(
                 'service_role',
                 'ss.publication_control_execution_receipts',
                 'UPDATE,DELETE'
               ) as exact_v2_security,
               (
                 select relation.relkind = 'r'
                   and relation.relpersistence = 'p'
                   and relation.relrowsecurity
                   and relation.relforcerowsecurity
                   and has_table_privilege(
                     'service_role', relation.oid, 'SELECT'
                   )
                   and has_table_privilege(
                     'service_role', relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'INSERT'
                   )
                   and not exists (
                     select 1 from pg_policy policy
                      where policy.polrelid = relation.oid
                   )
                   from pg_class relation
                  where relation.oid =
                    'ss.publication_control_commands'::regclass
               ) as exact_table_security,
               (
                 select count(*) = 2
                   and bool_and(not trigger_record.tgisinternal)
                   and bool_or(
                     trigger_record.tgname =
                       'publication_control_commands_validate'
                     and trigger_record.tgconstraint <> 0
                     and trigger_record.tgdeferrable
                     and trigger_record.tginitdeferred
                   )
                   and bool_or(
                     trigger_record.tgname =
                       'publication_control_commands_immutable'
                     and trigger_record.tgconstraint = 0
                   )
                   from pg_trigger trigger_record
                  where trigger_record.tgrelid =
                    'ss.publication_control_commands'::regclass
                    and not trigger_record.tgisinternal
               ) as exact_triggers,
               not exists (
                 select 1
                   from pg_constraint constraint_record
                  where constraint_record.conrelid =
                    'ss.publication_control_commands'::regclass
                    and (
                      not constraint_record.convalidated
                      or (
                        constraint_record.contype = 'f'
                        and constraint_record.confdeltype = 'c'
                      )
                    )
               ) as exact_constraints,
               not has_function_privilege(
                 'authenticated',
                 'ss.validate_publication_control_command()',
                 'EXECUTE'
               )
               and not has_function_privilege(
                 'anon',
                 'ss.hosted_publication_control_contract()',
                 'EXECUTE'
               ) as exact_function_security`,
            [
              RUNTIME_CONTRACT,
              RUNTIME_CONTRACT_V2,
              RELEASED_POLICY_ID,
              RELEASED_POLICY_DIGEST
            ]
          );
          invariant(
            proof.rowCount === 1 &&
              Object.values(proof.rows[0]).every(
                (value) => value === true
              ),
            "publication_held",
            "generic publication-control authority is not ready",
            { status: 503 }
          );
          return Object.freeze({
            ready: true,
            authorization: true,
            providerEffects: true,
            state: "released",
            holdReason: null,
            runtimeContract: RUNTIME_CONTRACT_V2
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
              `ss-publication-control-command:${
                input.tenantId
              }:${input.commandId}`
            ]
          );
          const replay = await client.query(
            `select command.*,
                    release.state as release_state,
                    job.state as execution_state
               from ss.publication_control_commands command
               left join ss.publication_control_releases release
                 on release.organization_id = command.organization_id
                and release.command_id = command.id
               left join ss.publication_control_worker_jobs job
                 on job.organization_id = command.organization_id
                and job.command_id = command.id
              where command.organization_id = $1
                and command.id = $2
               for update of command`,
            [input.tenantId, input.commandId]
          );
          if (replay.rowCount === 1) {
            const command = storedCommand(replay.rows[0]);
            invariant(
              replay.rows[0].project_id === input.projectId &&
                replay.rows[0].customer_user_id === input.customerId &&
                command.action === input.action &&
                command.snapshotDigest === input.snapshotDigest &&
                command.targetReleaseId === input.targetReleaseId,
              "publication_command_conflict",
              "that publication command identity was already used",
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
          invariant(
            replay.rowCount === 0,
            "repository_conflict",
            "the publication command identity conflicts",
            { status: 500 }
          );
          const selected = await selectPublication(
            client,
            input,
            { lock: true }
          );
          const openExecution = await client.query(
            `select exists (
               select 1
                 from ss.publication_control_worker_jobs job
                where job.organization_id = $1
                  and job.project_id = $2
                  and job.state in ('queued', 'running', 'failed')
             ) as present`,
            [input.tenantId, input.projectId]
          );
          invariant(
            openExecution.rowCount === 1 &&
              openExecution.rows[0].present === false,
            "publication_command_pending",
            "a publication change is already being processed; refresh before trying again",
            { status: 409 }
          );
          const validatedCommand =
            createAlakazamPublicationCommand({
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
          const targetRow = validatedCommand.action === "rollback"
            ? selected.historyRows.find(
                (row) =>
                  row.authorized_release_id ===
                    validatedCommand.targetReleaseId &&
                  row.is_current !== true
              )
            : selected.row;
          invariant(
            targetRow,
            "publication_authority_changed",
            "the exact fulfilled publication target changed; refresh before trying again",
            { status: 409 }
          );
          const authorityRow = Object.freeze({
            ...targetRow,
            authority_operation_id:
              selected.row.authority_operation_id,
            authority_intent_id:
              selected.row.authority_intent_id,
            authority_operation_kind:
              selected.row.authority_operation_kind,
            authority_capability:
              selected.row.authority_capability,
            authority_tier_id:
              selected.row.authority_tier_id,
            authority_policy_digest:
              selected.row.authority_policy_digest,
            authority_serving_revision:
              selected.row.authority_serving_revision,
            authority_release_id:
              selected.row.authority_release_id,
            authority_decision_digest:
              selected.row.authority_decision_digest,
            projection_state: selected.row.projection_state,
            current_release_id: selected.row.current_release_id,
            current_version_id: selected.row.current_version_id
          });
          const command = createHeldPublicationControlCommand({
            scope: {
              tenantId: input.tenantId,
              customerId: input.customerId,
              actorId: input.actorId,
              projectId: input.projectId
            },
            commandId: validatedCommand.commandId,
            action: validatedCommand.action,
            snapshotDigest: validatedCommand.snapshotDigest,
            targetReleaseId: validatedCommand.targetReleaseId,
            authority: exactEvidence(
              authorityRow,
              input.requestedAt
            ),
            requestedAt: input.requestedAt
          });
          const targetVersionId = input.action === "unpublish"
            ? null
            : command.authority.acceptance.versionId;
          const inserted = await client.query(
            `insert into ss.publication_control_commands (
               id, organization_id, project_id,
               customer_user_id, authority_kind, action,
               entitlement_kind, entitlement_id,
               entitlement_revision, entitlement_tier_id,
               entitlement_status, entitlement_period_ends_at,
               entitlement_grace_ends_at,
               capability_schema, capability,
               capability_authorized_at,
               acceptance_event_id, accepted_version_id,
               accepted_artifact_id, accepted_artifact_digest,
               accepted_at, screening_id, screening_method,
               screening_artifact_digest,
               screening_checker_revision,
               screening_checked_at, licensed_address_id,
               licensed_hostname, authority_operation_id,
               authority_serving_revision,
               authority_decision_digest, target_intent_id,
               target_operation_id, target_operation_kind,
               target_operation_subscription_revision,
               target_operation_tier_id, target_policy_digest,
               target_serving_revision, target_decision_digest,
               projection_state, current_release_id,
               current_version_id, authorized_release_id,
               target_release_id, target_version_id,
               snapshot_digest, authority_digest,
               command_digest, state, hold_reason, requested_at
             ) values (
               $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20,
               $21, $22, $23, $24, $25, $26, $27,
               $28, $29, $30, $31, $32, $33, $34,
               $35, $36, $37, $38, $39, $40, $41,
               $42, $43, $44, $45, $46, $47, $48,
               'held', $49, $50
             ) returning *`,
            [
              command.commandId,
              command.tenantId,
              command.projectId,
              command.customerId,
              command.authority.authorityKind,
              command.action,
              command.authority.entitlement.kind,
              command.authority.entitlement.subscriptionId,
              command.authority.entitlement.revision,
              command.authority.entitlement.tierId,
              command.authority.entitlement.status,
              command.authority.entitlement.currentPeriodEndsAt,
              command.authority.entitlement.graceEndsAt,
              command.authority.capabilityGrant.schema,
              command.authority.capabilityGrant.capability,
              command.authority.capabilityGrant.authorizedAt,
              command.authority.acceptance.eventId,
              command.authority.acceptance.versionId,
              command.authority.acceptance.artifactId,
              command.authority.acceptance.artifactDigest,
              command.authority.acceptance.acceptedAt,
              command.authority.screening.id,
              command.authority.screening.method,
              command.authority.screening.artifactDigest,
              command.authority.screening.checkerRevision,
              command.authority.screening.checkedAt,
              command.authority.address.id,
              command.authority.address.hostname,
              command.authority.authorityOperation.id,
              command.authority.authorityOperation.servingRevision,
              command.authority.authorityOperation.decisionDigest,
              command.authority.targetOperation.intentId,
              command.authority.targetOperation.id,
              command.authority.targetOperation.operationKind,
              command.authority.targetOperation.subscriptionRevision,
              command.authority.targetOperation.effectiveTierId,
              command.authority.targetOperation.policyDigest,
              command.authority.targetOperation.servingRevision,
              command.authority.targetOperation.decisionDigest,
              command.authority.projection.state,
              command.authority.projection.currentReleaseId,
              command.authority.projection.currentVersionId,
              command.authority.targetOperation.resultReleaseId,
              command.targetReleaseId,
              targetVersionId,
              command.snapshotDigest,
              command.authorityDigest,
              command.commandDigest,
              command.holdReason,
              command.requestedAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "repository_conflict",
            "the publication-control command was not recorded",
            { status: 500 }
          );
          await client.query(
            `insert into ss.publication_control_releases (
               command_id, organization_id, project_id,
               customer_user_id, command_digest,
               policy_id, policy_digest, state,
               released_at, release_basis
             ) values (
               $1, $2, $3, $4, $5,
               $6, $7, 'released', $8,
               'owner_approved_2026_08_31'
             )`,
            [
              command.commandId,
              command.tenantId,
              command.projectId,
              command.customerId,
              command.commandDigest,
              RELEASED_POLICY_ID,
              RELEASED_POLICY_DIGEST,
              command.requestedAt
            ]
          );
          await client.query(
            `insert into ss.publication_control_worker_jobs (
               command_id, organization_id, project_id,
               state, run_at, queued_at, updated_at
             ) values (
               $1, $2, $3, 'queued', $4, $4, $4
             )`,
            [
              command.commandId,
              command.tenantId,
              command.projectId,
              command.requestedAt
            ]
          );
          const stored = storedCommand({
            ...inserted.rows[0],
            release_state: "released",
            execution_state: "queued"
          });
          return Object.freeze({
            publication: Object.freeze({
              ...selected.publication,
              lastCommand: stored
            }),
            command: stored
          });
        }
      ));
    }
  });
}
