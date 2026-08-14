import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";
import {
  RESPONDER_FORWARDING_CONTRACT_DIGEST,
  responderForwardingInstructionPlan
} from "./responder-forwarding-contract.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const ACTOR_KINDS = new Set(["customer", "operator"]);
const STATES = new Set([
  "setup_pending", "ready_held", "manual_review", "retired"
]);
const OBSERVATION_KINDS = new Set([
  "carrier_setup_attested",
  "unanswered_forwarding_reached",
  "answered_call_not_forwarded",
  "reply_path_confirmed",
  "stop_path_confirmed",
  "routing_ambiguous"
]);
const REQUIRED_OBSERVATIONS = new Set([
  "carrier_setup_attested",
  "unanswered_forwarding_reached",
  "answered_call_not_forwarded",
  "reply_path_confirmed",
  "stop_path_confirmed"
]);
const EVENT_OBSERVATIONS = new Set([
  "unanswered_forwarding_reached",
  "reply_path_confirmed",
  "stop_path_confirmed"
]);
const RETIRED_REASONS = new Set([
  "customer_cancelled", "binding_replaced", "operator_correction",
  "carrier_route_removed"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function uuid(value, field, { nullable = false } = {}) {
  invariant(
    (nullable && value === null) ||
      (typeof value === "string" && UUID.test(value)),
    "RESPONDER_FORWARDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_FORWARDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_FORWARDING_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && COMMAND_ID.test(value),
    "RESPONDER_FORWARDING_INVALID",
    "The forwarding command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function actorContext(actor, { readOnly = false } = {}) {
  invariant(
    actor && ACTOR_KINDS.has(actor.kind) && UUID.test(actor.userId ?? "") &&
      UUID.test(actor.organizationId ?? ""),
    "RESPONDER_FORWARDING_UNAVAILABLE",
    "Responder forwarding authority is unavailable.",
    { status: 404 }
  );
  return {
    actorKind: actor.kind,
    userId: actor.userId,
    organizationId: actor.organizationId,
    isolation: "serializable",
    ...(readOnly ? { readOnly: true } : {})
  };
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_FORWARDING_UNAVAILABLE",
      "Responder forwarding authority is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_FORWARDING_RETRY_REQUIRED",
      "Responder forwarding state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_FORWARDING_CONFLICT",
      "Responder forwarding evidence conflicts.",
      { status: 409 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translatedError(error);
  }
}

function asIso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function onboardingProjection(row) {
  invariant(
    row && UUID.test(row.id) && STATES.has(row.state),
    "RESPONDER_FORWARDING_CONFLICT",
    "Responder forwarding evidence conflicts.",
    { status: 409 }
  );
  return deepFreeze({
    schema: "sitesourcery.responder-forwarding-onboarding/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    numberBindingId: row.number_binding_id,
    transportAdapter: row.transport_adapter,
    launchMode: row.launch_mode,
    instructionContract: row.instruction_contract,
    businessLineConfigured: true,
    businessLineKeyVersion: row.business_line_key_version,
    state: row.state,
    revision: Number(row.revision),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    retiredReason: row.retired_reason ?? null,
    retiredAt: row.retired_at === null || row.retired_at === undefined
      ? null
      : asIso(row.retired_at),
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false
  });
}

function observationProjection(row) {
  return deepFreeze({
    id: row.id,
    onboardingId: row.onboarding_id,
    observationKind: row.observation_kind,
    inboundEventId: row.inbound_event_id ?? null,
    evidenceDigest: row.evidence_digest,
    observationDigest: row.observation_digest,
    observedAt: asIso(row.observed_at),
    recordedAt: asIso(row.created_at)
  });
}

function transitionReceipt(command, onboarding, {
  replayed = false,
  semanticReplay = false
} = {}) {
  return deepFreeze({
    schema: "sitesourcery.responder-forwarding-command-receipt/v1",
    commandId: command.command_id,
    onboardingId: command.onboarding_id,
    commandKind: command.command_kind,
    requestDigest: command.request_digest,
    resultingState: command.resulting_state,
    resultingRevision: Number(command.expected_revision) + 1,
    onboarding: onboardingProjection(onboarding),
    replayed,
    semanticReplay,
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false
  });
}

function onboardingPayload(selected) {
  return digest({
    schema: "sitesourcery.responder-forwarding-onboarding-payload/v1",
    businessLineKeyVersion: selected.businessLineKeyVersion,
    businessLineLookupDigest: selected.businessLineLookupDigest,
    consentEvidenceDigest: selected.consentEvidenceDigest,
    customerUserId: selected.customerUserId,
    instructionContract: "provider-assisted-conditional-no-answer-v1",
    launchMode: "conditional_no_answer_forwarding",
    numberBindingId: selected.numberBindingId,
    organizationId: selected.organizationId,
    projectId: selected.projectId,
    transportAdapter: "twilio"
  });
}

function observationPayload(selected) {
  return digest({
    schema: "sitesourcery.responder-forwarding-observation/v1",
    evidenceDigest: selected.evidenceDigest,
    inboundEventId: selected.inboundEventId,
    observationKind: selected.observationKind,
    observedAt: selected.observedAt,
    onboardingId: selected.onboardingId
  });
}

function retirementPayload(selected) {
  return digest({
    schema: "sitesourcery.responder-forwarding-retirement/v1",
    evidenceDigest: selected.evidenceDigest,
    onboardingId: selected.onboardingId,
    reason: selected.reason
  });
}

function requestDigest(actor, selected, commandKind, expectedRevision,
  resultingState, payloadDigest) {
  return digest({
    schema: "sitesourcery.responder-forwarding-command/v1",
    actorKind: actor.kind,
    actorUserId: actor.userId,
    commandKind,
    expectedRevision,
    onboardingId: selected.onboardingId,
    organizationId: selected.organizationId,
    payloadDigest,
    projectId: selected.projectId,
    resultingState
  });
}

export function createPostgresResponderForwardingRepository({
  authority,
  verifierKeyVersions,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function" &&
      Array.isArray(verifierKeyVersions) &&
      verifierKeyVersions.length >= 1 && verifierKeyVersions.length <= 8 &&
      verifierKeyVersions.every((value) =>
        typeof value === "string" && KEY_VERSION.test(value)),
    "RESPONDER_FORWARDING_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL forwarding authority is required.",
    { status: 500 }
  );

  async function requireScope(client, actor, organizationId, projectId) {
    const scope = actor.kind === "operator"
      ? await client.query(
          `select 1 from ss.projects project
            where project.organization_id = $1 and project.id = $2
              and ss.service_operator_has_capability(
                $3, 'service_management_manage', clock_timestamp()
              )`,
          [organizationId, projectId, actor.userId]
        )
      : await client.query(
          `select 1 from ss.projects project
             join ss.organization_memberships membership
               on membership.organization_id = project.organization_id
              and membership.user_id = $3 and membership.state = 'active'
            where project.organization_id = $1 and project.id = $2`,
          [organizationId, projectId, actor.userId]
        );
    invariant(
      scope.rowCount === 1,
      "RESPONDER_FORWARDING_UNAVAILABLE",
      "Responder forwarding authority is unavailable.",
      { status: 404 }
    );
  }

  async function priorCommand(client, selectedOrganizationId,
    selectedCommandId, selectedRequestDigest) {
    const prior = await client.query(
      `select * from ss.responder_forwarding_commands
        where organization_id = $1
          and (command_id = $2 or request_digest = $3)
        order by command_id`,
      [selectedOrganizationId, selectedCommandId, selectedRequestDigest]
    );
    invariant(
      prior.rowCount <= 1,
      "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT",
      "The forwarding command collides with different durable evidence.",
      { status: 409 }
    );
    if (prior.rowCount === 0) return null;
    const row = prior.rows[0];
    invariant(
      row.request_digest === selectedRequestDigest &&
        (row.command_id === selectedCommandId ||
          row.request_digest === selectedRequestDigest),
      "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT",
      "The forwarding command was reused for different facts.",
      { status: 409 }
    );
    return {
      command: row,
      replayed: row.command_id === selectedCommandId,
      semanticReplay: row.command_id !== selectedCommandId
    };
  }

  async function receiptForPrior(client, prior) {
    const onboarding = await client.query(
      `select * from ss.responder_forwarding_onboardings
        where id = $1 and organization_id = $2`,
      [prior.command.onboarding_id, prior.command.organization_id]
    );
    invariant(
      onboarding.rowCount === 1,
      "RESPONDER_FORWARDING_CONFLICT",
      "Responder forwarding evidence conflicts.",
      { status: 409 }
    );
    return transitionReceipt(prior.command, onboarding.rows[0], prior);
  }

  return Object.freeze({
    kind: "responder-forwarding-postgres",
    mode: "held-local",
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false,
    instructionPlan: responderForwardingInstructionPlan,

    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_forwarding_contract_v1()'
              ) is not null
              and ss.hosted_responder_forwarding_contract_v1() =
                'canonical-responder-forwarding-v1-carrier-preserving-held-no-loop'
                as contract_ready,
              (select count(*) = 3
                 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname = any($1::text[])
              ) as tables_ready,
              not exists (
                select 1 from ss.responder_forwarding_onboardings onboarding
                 where onboarding.state <> 'retired'
                   and onboarding.business_line_key_version <>
                     all($2::text[])
              ) as key_coverage_ready,
              not exists (
                select 1 from ss.responder_forwarding_onboardings onboarding
                join ss.responder_provider_number_bindings binding
                  on binding.id = onboarding.number_binding_id
                 and binding.organization_id = onboarding.organization_id
                 where onboarding.state <> 'retired'
                   and (binding.state <> 'active'
                     or binding.voice_ingress_role <>
                       'conditional_forward_destination')
              ) as bindings_ready
          `, [[
            "responder_forwarding_commands",
            "responder_forwarding_onboardings",
            "responder_forwarding_observations"
          ], verifierKeyVersions])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.key_coverage_ready === true &&
          row.bindings_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-forwarding-postgres",
          mode: "held-local",
          contractDigest: RESPONDER_FORWARDING_CONTRACT_DIGEST,
          retainedCarrier: true,
          launchMode: "conditional_no_answer_forwarding",
          initialAdapter: "twilio",
          automaticCarrierCommands: false,
          remoteWriteEffects: false,
          providerEffects: false,
          messageSendEffects: false,
          code: ready ? null :
            "RESPONDER_FORWARDING_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-forwarding-postgres",
          mode: "held-local",
          contractDigest: RESPONDER_FORWARDING_CONTRACT_DIGEST,
          retainedCarrier: true,
          launchMode: "conditional_no_answer_forwarding",
          initialAdapter: "twilio",
          automaticCarrierCommands: false,
          remoteWriteEffects: false,
          providerEffects: false,
          messageSendEffects: false,
          code: "RESPONDER_FORWARDING_STORAGE_NOT_READY"
        });
      }
    },

    list(actor, { organizationId, projectId }) {
      const selectedOrganizationId = uuid(
        organizationId, "Organization ID"
      );
      const selectedProjectId = uuid(projectId, "Project ID");
      return translated(() => authority.service(
        actorContext(actor, { readOnly: true }),
        async (client) => {
          await requireScope(
            client, actor, selectedOrganizationId, selectedProjectId
          );
          const rows = await client.query(
            `select * from ss.responder_forwarding_onboardings
              where organization_id = $1 and project_id = $2
                and ($3::text = 'operator' or customer_user_id = $4)
              order by created_at desc, id desc limit 100`,
            [selectedOrganizationId, selectedProjectId,
              actor.kind, actor.userId]
          );
          const ids = rows.rows.map((row) => row.id);
          const observations = ids.length === 0
            ? { rows: [] }
            : await client.query(
                `select * from ss.responder_forwarding_observations
                  where onboarding_id = any($1::uuid[])
                  order by created_at, id`,
                [ids]
              );
          return deepFreeze({
            schema: "sitesourcery.responder-forwarding-list/v1",
            organizationId: selectedOrganizationId,
            projectId: selectedProjectId,
            instructionPlan: responderForwardingInstructionPlan(),
            onboardings: rows.rows.map(onboardingProjection),
            observations: observations.rows.map(observationProjection),
            automaticCarrierCommands: false,
            remoteWriteEffects: false,
            providerEffects: false,
            messageSendEffects: false
          });
        }
      ));
    },

    create(actor, input = {}) {
      const selected = {
        commandId: commandId(input.commandId),
        onboardingId: uuid(input.onboardingId, "Onboarding ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        customerUserId: uuid(input.customerUserId, "Customer user ID"),
        numberBindingId: uuid(input.numberBindingId, "Number binding ID"),
        businessLineLookupDigest: sha256(
          input.businessLineLookupDigest, "Business line lookup digest"
        ),
        businessLineLookupCandidateDigests:
          input.businessLineLookupCandidateDigests,
        businessLineKeyVersion: input.businessLineKeyVersion,
        consentEvidenceDigest: sha256(
          input.consentEvidenceDigest, "Consent evidence digest"
        ),
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        KEY_VERSION.test(selected.businessLineKeyVersion ?? "") &&
          Array.isArray(selected.businessLineLookupCandidateDigests) &&
          selected.businessLineLookupCandidateDigests.length >= 1 &&
          selected.businessLineLookupCandidateDigests.length <= 8 &&
          selected.businessLineLookupCandidateDigests[0] ===
            selected.businessLineLookupDigest &&
          selected.businessLineLookupCandidateDigests.every((value) =>
            typeof value === "string" && SHA256.test(value)) &&
          (actor.kind === "operator" ||
            selected.customerUserId === actor.userId),
        "RESPONDER_FORWARDING_INVALID",
        "The forwarding onboarding identity is invalid.",
        { status: 400 }
      );
      let payloadDigest = onboardingPayload(selected);
      let selectedRequestDigest = requestDigest(
        actor, selected, "create", 0, "setup_pending", payloadDigest
      );
      return translated(() => authority.service(
        actorContext(actor),
        async (client) => {
          await requireScope(
            client, actor, selected.organizationId, selected.projectId
          );
          const priorCreate = await client.query(
            `select onboarding.*, command.*
               from ss.responder_forwarding_commands command
              join ss.responder_forwarding_onboardings onboarding
                 on onboarding.id = command.onboarding_id
                and onboarding.organization_id = command.organization_id
              where command.organization_id = $1
                and command.command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          if (priorCreate.rowCount === 1) {
            const row = priorCreate.rows[0];
            invariant(
              row.command_kind === "create" &&
                row.actor_kind === actor.kind &&
                row.actor_user_id === actor.userId &&
                row.organization_id === selected.organizationId &&
                row.project_id === selected.projectId &&
                row.customer_user_id === selected.customerUserId &&
                row.number_binding_id === selected.numberBindingId &&
                selected.businessLineLookupCandidateDigests.includes(
                  row.business_line_lookup_digest
                ) &&
                row.consent_evidence_digest ===
                  selected.consentEvidenceDigest,
              "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT",
              "The forwarding command was reused for different facts.",
              { status: 409 }
            );
            return transitionReceipt(row, row, { replayed: true });
          }
          const canonical = await client.query(
            `select
               ss.responder_forwarding_onboarding_payload_digest_v1(
                 $1, $2, $3, $4, $5, $6, $7
               ) as payload_digest`,
            [selected.organizationId, selected.projectId,
              selected.customerUserId, selected.numberBindingId,
              selected.businessLineLookupDigest,
              selected.businessLineKeyVersion,
              selected.consentEvidenceDigest]
          );
          payloadDigest = canonical.rows[0].payload_digest;
          const canonicalRequest = await client.query(
            `select ss.responder_forwarding_command_request_digest_v1(
               $1, $2, $3, $4, $5, 'create', 0,
               'setup_pending', $6
             ) as request_digest`,
            [actor.kind, actor.userId, selected.organizationId,
              selected.projectId, selected.onboardingId, payloadDigest]
          );
          selectedRequestDigest = canonicalRequest.rows[0].request_digest;
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [
              `responder-forwarding-command:${selected.organizationId}:` +
              selected.commandId
            ]
          );
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-forwarding-request:${selectedRequestDigest}`]
          );
          const prior = await priorCommand(
            client, selected.organizationId, selected.commandId,
            selectedRequestDigest
          );
          if (prior) return receiptForPrior(client, prior);
          const binding = await client.query(
            `select number_lookup_digest
               from ss.responder_provider_number_bindings
              where id = $1 and organization_id = $2 and project_id = $3
                and provider = 'twilio' and state = 'active'
                and voice_ingress_role =
                  'conditional_forward_destination'`,
            [selected.numberBindingId, selected.organizationId,
              selected.projectId]
          );
          invariant(
            binding.rowCount === 1,
            "RESPONDER_FORWARDING_UNAVAILABLE",
            "The managed forwarding destination is unavailable.",
            { status: 404 }
          );
          invariant(
            !selected.businessLineLookupCandidateDigests.includes(
              binding.rows[0].number_lookup_digest
            ),
            "RESPONDER_FORWARDING_INVALID",
            "The retained business line cannot forward to itself.",
            { status: 400 }
          );
          const duplicate = await client.query(
            `select onboarding.*, command.*
               from ss.responder_forwarding_onboardings onboarding
               join ss.responder_forwarding_commands command
                 on command.organization_id = onboarding.organization_id
                and command.command_id = onboarding.create_command_id
              where state <> 'retired' and (
                number_binding_id = $1
                or business_line_lookup_digest = any($2::text[])
              ) limit 1`,
            [selected.numberBindingId,
              selected.businessLineLookupCandidateDigests]
          );
          if (duplicate.rowCount === 1) {
            const row = duplicate.rows[0];
            invariant(
              row.organization_id === selected.organizationId &&
                row.project_id === selected.projectId &&
                row.customer_user_id === selected.customerUserId &&
                row.number_binding_id === selected.numberBindingId &&
                selected.businessLineLookupCandidateDigests.includes(
                  row.business_line_lookup_digest
                ) &&
                row.consent_evidence_digest ===
                  selected.consentEvidenceDigest,
              "RESPONDER_FORWARDING_CONFLICT",
              "An active forwarding onboarding already owns this route.",
              { status: 409 }
            );
            return transitionReceipt(row, row, {
              replayed: false,
              semanticReplay: true
            });
          }
          const command = await client.query(
            `insert into ss.responder_forwarding_commands (
               command_id, request_digest, organization_id, project_id,
               onboarding_id, actor_kind, actor_user_id, command_kind,
               expected_revision, resulting_state, payload_digest, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, 'create', 0,
               'setup_pending', $8, $9
             ) returning *`,
            [selected.commandId, selectedRequestDigest,
              selected.organizationId, selected.projectId,
              selected.onboardingId, actor.kind, actor.userId,
              payloadDigest, selected.recordedAt]
          );
          const onboarding = await client.query(
            `insert into ss.responder_forwarding_onboardings (
               id, create_command_id, organization_id, project_id,
               customer_user_id, number_binding_id, transport_adapter,
               launch_mode, instruction_contract,
               business_line_lookup_digest, business_line_key_version,
               consent_evidence_digest, state, created_by_kind,
               created_by_user_id, created_at, revision, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'twilio',
               'conditional_no_answer_forwarding',
               'provider-assisted-conditional-no-answer-v1',
               $7, $8, $9, 'setup_pending', $10, $11, $12, 1, $12
             ) returning *`,
            [selected.onboardingId, selected.commandId,
              selected.organizationId, selected.projectId,
              selected.customerUserId, selected.numberBindingId,
              selected.businessLineLookupDigest,
              selected.businessLineKeyVersion,
              selected.consentEvidenceDigest, actor.kind, actor.userId,
              selected.recordedAt]
          );
          return transitionReceipt(command.rows[0], onboarding.rows[0]);
        }
      ));
    },

    recordObservation(actor, input = {}) {
      invariant(
        actor?.kind === "operator",
        "RESPONDER_FORWARDING_UNAVAILABLE",
        "Only an authorized operator may verify forwarding evidence.",
        { status: 404 }
      );
      const selected = {
        commandId: commandId(input.commandId),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        onboardingId: uuid(input.onboardingId, "Onboarding ID"),
        expectedRevision: input.expectedRevision,
        observationKind: input.observationKind,
        inboundEventId: uuid(
          input.inboundEventId, "Inbound event ID", { nullable: true }
        ),
        evidenceDigest: sha256(
          input.evidenceDigest, "Observation evidence digest"
        ),
        observedAt: instant(input.observedAt, "Observation time"),
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        Number.isSafeInteger(selected.expectedRevision) &&
          selected.expectedRevision > 0 &&
          OBSERVATION_KINDS.has(selected.observationKind) &&
          (EVENT_OBSERVATIONS.has(selected.observationKind) ===
            (selected.inboundEventId !== null) ||
            selected.observationKind === "routing_ambiguous"),
        "RESPONDER_FORWARDING_INVALID",
        "The forwarding observation is invalid.",
        { status: 400 }
      );
      let payloadDigest = observationPayload(selected);
      return translated(() => authority.service(
        actorContext(actor),
        async (client) => {
          await requireScope(
            client, actor, selected.organizationId, selected.projectId
          );
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-forwarding:${selected.onboardingId}`]
          );
          const canonical = await client.query(
            `select
               ss.responder_forwarding_observation_digest_v1(
                 $1, $2, $3, $4, $5
               ) as payload_digest`,
            [selected.onboardingId, selected.observationKind,
              selected.inboundEventId, selected.evidenceDigest,
              selected.observedAt]
          );
          payloadDigest = canonical.rows[0].payload_digest;
          const priorByIdentity = await client.query(
            `select * from ss.responder_forwarding_commands
              where organization_id = $1 and (
                command_id = $2 or (
                  onboarding_id = $3
                  and command_kind = 'record_observation'
                  and expected_revision = $4 and actor_kind = 'operator'
                  and actor_user_id = $5 and payload_digest = $6
                )
              ) order by command_id`,
            [selected.organizationId, selected.commandId,
              selected.onboardingId, selected.expectedRevision,
              actor.userId, payloadDigest]
          );
          invariant(
            priorByIdentity.rowCount <= 1,
            "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT",
            "The forwarding observation collides with durable evidence.",
            { status: 409 }
          );
          if (priorByIdentity.rowCount === 1) {
            const priorRow = priorByIdentity.rows[0];
            invariant(
              priorRow.onboarding_id === selected.onboardingId &&
                Number(priorRow.expected_revision) ===
                  selected.expectedRevision &&
                priorRow.command_kind === "record_observation" &&
                priorRow.actor_kind === "operator" &&
                priorRow.actor_user_id === actor.userId &&
                priorRow.payload_digest === payloadDigest,
              "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT",
              "The forwarding command was reused for different facts.",
              { status: 409 }
            );
            return receiptForPrior(client, {
              command: priorRow,
              replayed: priorRow.command_id === selected.commandId,
              semanticReplay: priorRow.command_id !== selected.commandId
            });
          }
          const onboarding = await client.query(
            `select * from ss.responder_forwarding_onboardings
              where id = $1 and organization_id = $2 and project_id = $3
              for update`,
            [selected.onboardingId, selected.organizationId,
              selected.projectId]
          );
          invariant(
            onboarding.rowCount === 1 &&
              (
                onboarding.rows[0].state === "setup_pending" ||
                (
                  onboarding.rows[0].state === "ready_held" &&
                  selected.observationKind === "routing_ambiguous"
                )
              ) &&
              Number(onboarding.rows[0].revision) ===
                selected.expectedRevision,
            "RESPONDER_FORWARDING_RETRY_REQUIRED",
            "Responder forwarding state changed; retry safely.",
            { status: 409 }
          );
          const existingKinds = await client.query(
            `select observation_kind
               from ss.responder_forwarding_observations
              where onboarding_id = $1`,
            [selected.onboardingId]
          );
          const kinds = new Set(existingKinds.rows.map(
            (row) => row.observation_kind
          ));
          kinds.add(selected.observationKind);
          const resultingState = kinds.has("routing_ambiguous")
            ? "manual_review"
            : [...REQUIRED_OBSERVATIONS].every((kind) => kinds.has(kind))
              ? "ready_held"
              : "setup_pending";
          const canonicalRequest = await client.query(
            `select ss.responder_forwarding_command_request_digest_v1(
               'operator', $1, $2, $3, $4, 'record_observation',
               $5, $6, $7
             ) as request_digest`,
            [actor.userId, selected.organizationId, selected.projectId,
              selected.onboardingId, selected.expectedRevision,
              resultingState, payloadDigest]
          );
          const selectedRequestDigest =
            canonicalRequest.rows[0].request_digest;
          const prior = await priorCommand(
            client, selected.organizationId, selected.commandId,
            selectedRequestDigest
          );
          if (prior) return receiptForPrior(client, prior);
          const command = await client.query(
            `insert into ss.responder_forwarding_commands (
               command_id, request_digest, organization_id, project_id,
               onboarding_id, actor_kind, actor_user_id, command_kind,
               expected_revision, resulting_state, payload_digest, created_at
             ) values (
               $1, $2, $3, $4, $5, 'operator', $6,
               'record_observation', $7, $8, $9, $10
             ) returning *`,
            [selected.commandId, selectedRequestDigest,
              selected.organizationId, selected.projectId,
              selected.onboardingId, actor.userId,
              selected.expectedRevision, resultingState, payloadDigest,
              selected.recordedAt]
          );
          await client.query(
            `insert into ss.responder_forwarding_observations (
               id, command_id, organization_id, project_id, onboarding_id,
               observation_kind, inbound_event_id, evidence_digest,
               observation_digest, observed_at, recorded_by_kind,
               recorded_by_user_id, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               'operator', $11, $12
             )`,
            [randomUUID(), selected.commandId, selected.organizationId,
              selected.projectId, selected.onboardingId,
              selected.observationKind, selected.inboundEventId,
              selected.evidenceDigest, payloadDigest, selected.observedAt,
              actor.userId, selected.recordedAt]
          );
          const changed = await client.query(
            `update ss.responder_forwarding_onboardings
                set state = $4, revision = revision + 1, updated_at = $5
              where id = $1 and organization_id = $2 and project_id = $3
                and revision = $6 and state = $7
              returning *`,
            [selected.onboardingId, selected.organizationId,
              selected.projectId, resultingState, selected.recordedAt,
              selected.expectedRevision, onboarding.rows[0].state]
          );
          invariant(
            changed.rowCount === 1,
            "RESPONDER_FORWARDING_RETRY_REQUIRED",
            "Responder forwarding state changed; retry safely.",
            { status: 409 }
          );
          return transitionReceipt(command.rows[0], changed.rows[0]);
        }
      ));
    },

    retire(actor, input = {}) {
      const selected = {
        commandId: commandId(input.commandId),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        onboardingId: uuid(input.onboardingId, "Onboarding ID"),
        expectedRevision: input.expectedRevision,
        reason: input.reason,
        evidenceDigest: sha256(
          input.evidenceDigest, "Retirement evidence digest"
        ),
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        Number.isSafeInteger(selected.expectedRevision) &&
          selected.expectedRevision > 0 &&
          RETIRED_REASONS.has(selected.reason),
        "RESPONDER_FORWARDING_INVALID",
        "The forwarding retirement is invalid.",
        { status: 400 }
      );
      let payloadDigest = retirementPayload(selected);
      let selectedRequestDigest = requestDigest(
        actor, selected, "retire", selected.expectedRevision,
        "retired", payloadDigest
      );
      return translated(() => authority.service(
        actorContext(actor),
        async (client) => {
          await requireScope(
            client, actor, selected.organizationId, selected.projectId
          );
          const canonical = await client.query(
            `select
               ss.responder_forwarding_retirement_payload_digest_v1(
                 $1, $2, $3
               ) as payload_digest`,
            [selected.onboardingId, selected.reason,
              selected.evidenceDigest]
          );
          payloadDigest = canonical.rows[0].payload_digest;
          const canonicalRequest = await client.query(
            `select ss.responder_forwarding_command_request_digest_v1(
               $1, $2, $3, $4, $5, 'retire', $6, 'retired', $7
             ) as request_digest`,
            [actor.kind, actor.userId, selected.organizationId,
              selected.projectId, selected.onboardingId,
              selected.expectedRevision, payloadDigest]
          );
          selectedRequestDigest = canonicalRequest.rows[0].request_digest;
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-forwarding:${selected.onboardingId}`]
          );
          const onboarding = await client.query(
            `select * from ss.responder_forwarding_onboardings
              where id = $1 and organization_id = $2 and project_id = $3
              for update`,
            [selected.onboardingId, selected.organizationId,
              selected.projectId]
          );
          invariant(
            onboarding.rowCount === 1,
            "RESPONDER_FORWARDING_UNAVAILABLE",
            "Responder forwarding onboarding is unavailable.",
            { status: 404 }
          );
          if (actor.kind === "customer") {
            invariant(
              onboarding.rows[0].customer_user_id === actor.userId,
              "RESPONDER_FORWARDING_UNAVAILABLE",
              "Responder forwarding onboarding is unavailable.",
              { status: 404 }
            );
          }
          const prior = await priorCommand(
            client, selected.organizationId, selected.commandId,
            selectedRequestDigest
          );
          if (prior) return receiptForPrior(client, prior);
          invariant(
            onboarding.rows[0].state !== "retired" &&
              Number(onboarding.rows[0].revision) ===
                selected.expectedRevision,
            "RESPONDER_FORWARDING_RETRY_REQUIRED",
            "Responder forwarding state changed; retry safely.",
            { status: 409 }
          );
          const command = await client.query(
            `insert into ss.responder_forwarding_commands (
               command_id, request_digest, organization_id, project_id,
               onboarding_id, actor_kind, actor_user_id, command_kind,
               expected_revision, resulting_state, payload_digest, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, 'retire', $8,
               'retired', $9, $10
             ) returning *`,
            [selected.commandId, selectedRequestDigest,
              selected.organizationId, selected.projectId,
              selected.onboardingId, actor.kind, actor.userId,
              selected.expectedRevision, payloadDigest, selected.recordedAt]
          );
          const changed = await client.query(
            `update ss.responder_forwarding_onboardings
                set state = 'retired', retired_reason = $4,
                    retire_evidence_digest = $5, retired_by_kind = $6,
                    retired_by_user_id = $7, retired_at = $8,
                    revision = revision + 1, updated_at = $8
              where id = $1 and organization_id = $2 and project_id = $3
                and revision = $9 and state <> 'retired'
              returning *`,
            [selected.onboardingId, selected.organizationId,
              selected.projectId, selected.reason, selected.evidenceDigest,
              actor.kind, actor.userId, selected.recordedAt,
              selected.expectedRevision]
          );
          invariant(
            changed.rowCount === 1,
            "RESPONDER_FORWARDING_RETRY_REQUIRED",
            "Responder forwarding state changed; retry safely.",
            { status: 409 }
          );
          return transitionReceipt(command.rows[0], changed.rows[0]);
        }
      ));
    }
  });
}
