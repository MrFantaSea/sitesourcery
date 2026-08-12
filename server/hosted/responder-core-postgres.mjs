import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function databaseAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "RESPONDER_CORE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Responder state.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_CORE_UNAVAILABLE",
      "Responder state is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_CORE_RETRY_REQUIRED",
      "Responder state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_CORE_REPOSITORY_CONFLICT",
      "The durable Responder repository rejected inconsistent evidence.",
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

function serviceActor(selected, readOnly = false) {
  return {
    actorKind: selected.kind,
    userId: selected.userId,
    organizationId: selected.organizationId,
    isolation: "serializable",
    readOnly
  };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function contact(row, replayed = false) {
  return deepFreeze({
    schema: "sitesourcery.responder-contact-authority-receipt/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    routeKind: row.route_kind,
    routeDigest: row.route_digest,
    purpose: row.purpose,
    consentBasis: row.consent_basis,
    state: row.state,
    consentedAt: iso(row.consented_at),
    optedOutAt: row.opted_out_at ? iso(row.opted_out_at) : null,
    revision: Number(row.revision),
    replayed
  });
}

function interaction(row) {
  return deepFreeze({
    schema: "sitesourcery.responder-interaction-read/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    contactAuthorityId: row.contact_authority_id,
    routeDigest: row.route_digest,
    sourceKind: row.source_kind,
    state: row.state,
    handoffReason: row.handoff_reason,
    openedAt: iso(row.opened_at),
    lastEventAt: iso(row.last_event_at),
    revision: Number(row.revision)
  });
}

function providerEvent(row, replayed = false) {
  return deepFreeze({
    schema: "sitesourcery.responder-provider-event-receipt/v1",
    id: row.id,
    interactionId: row.interaction_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    eventKind: row.event_kind,
    messageIntent: row.message_intent,
    state: row.state,
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    replayed,
    providerEffects: false
  });
}

function heldCommand(row, replayed = false) {
  return deepFreeze({
    schema: "sitesourcery.responder-held-message-receipt/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    interactionId: row.interaction_id,
    contactAuthorityId: row.contact_authority_id,
    messageKind: row.message_kind,
    state: row.state,
    heldReason: row.held_reason,
    createdAt: iso(row.created_at),
    replayed,
    providerEffects: false,
    deliveryClaimed: false
  });
}

async function requireOperator(client, userId) {
  const selected = await client.query(
    `select ss.service_operator_has_capability(
       $1, 'service_management_manage', clock_timestamp()
     ) as allowed`,
    [userId]
  );
  invariant(
    selected.rows[0]?.allowed === true,
    "RESPONDER_CORE_UNAVAILABLE",
    "Responder operator state is unavailable.",
    { status: 404 }
  );
}

async function priorByCommand(client, table, commandId) {
  const selected = await client.query(
    `select * from ss.${table} where command_id = $1`,
    [commandId]
  );
  invariant(
    selected.rowCount <= 1,
    "RESPONDER_CORE_REPOSITORY_CONFLICT",
    "Responder idempotency state is inconsistent.",
    { status: 409 }
  );
  return selected.rows[0] ?? null;
}

export function createPostgresResponderCoreRepository({ authority } = {}) {
  const database = databaseAuthority(authority);

  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_responder_core_contract_v1()')
                is not null
                and ss.hosted_responder_core_contract_v1() =
                  'canonical-responder-core-v1-provider-neutral-held'
                as contract_ready,
              count(*) = 6 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "responder_contact_authorities",
            "responder_runtime_controls",
            "responder_interactions",
            "responder_provider_events",
            "responder_message_commands",
            "responder_control_commands"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-core-postgres",
          mode: "held",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-core-postgres",
          mode: "held",
          providerEffects: false
        });
      }
    },

    recordConsent(selectedActor, input) {
      return translated(() => database.service(
        serviceActor(selectedActor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await priorByCommand(
            client,
            "responder_contact_authorities",
            input.commandId
          );
          if (prior) {
            invariant(
              prior.request_digest === input.requestDigest,
              "RESPONDER_CORE_IDEMPOTENCY_CONFLICT",
              "Responder consent command was reused for different facts.",
              { status: 409 }
            );
            return contact(prior, true);
          }
          await client.query(
            `insert into ss.responder_runtime_controls (
               organization_id, global_kill_engaged, state,
               revision, created_at, updated_at
             ) values ($1, true, 'held', 1, $2, $2)
             on conflict (organization_id) do nothing`,
            [input.organizationId, input.recordedAt]
          );
          const inserted = await client.query(
            `insert into ss.responder_contact_authorities (
               id, command_id, request_digest, organization_id, project_id,
               customer_user_id, route_kind, route_digest, purpose,
               consent_basis, consent_evidence_digest, consented_at,
               recorded_at, state, revision, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, 'active', 1, $13, $13
             ) returning *`,
            [
              systemRandomUUID(), input.commandId, input.requestDigest,
              input.organizationId, input.projectId, input.customerUserId,
              input.routeKind, input.routeDigest, input.purpose,
              input.consentBasis, input.consentEvidenceDigest,
              input.consentedAt, input.recordedAt
            ]
          );
          return contact(inserted.rows[0]);
        }
      ));
    },

    ingestProviderEvent(input) {
      return translated(() => database.service(
        {
          actorKind: "system",
          organizationId: input.organizationId,
          isolation: "serializable"
        },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`${input.provider}:${input.providerEventIdDigest}`]
          );
          const prior = await client.query(
            `select * from ss.responder_provider_events
              where command_id = $1
                 or (provider = $2 and provider_event_id_digest = $3)`,
            [input.commandId, input.provider, input.providerEventIdDigest]
          );
          if (prior.rowCount > 0) {
            invariant(
              prior.rowCount === 1 &&
                prior.rows[0].command_id === input.commandId &&
                prior.rows[0].request_digest === input.requestDigest,
              "RESPONDER_CORE_IDEMPOTENCY_CONFLICT",
              "Responder provider evidence was reused for different facts.",
              { status: 409 }
            );
            return providerEvent(prior.rows[0], true);
          }
          await client.query(
            `insert into ss.responder_runtime_controls (
               organization_id, global_kill_engaged, state,
               revision, created_at, updated_at
             ) values ($1, true, 'held', 1, $2, $2)
             on conflict (organization_id) do nothing`,
            [input.organizationId, input.recordedAt]
          );
          const authority = await client.query(
            `select * from ss.responder_contact_authorities
              where organization_id = $1 and project_id = $2
                and route_digest = $3 and state = 'active'
              order by consented_at desc, id desc limit 1 for update`,
            [input.organizationId, input.projectId, input.routeDigest]
          );
          const contactAuthority = authority.rows[0] ?? null;
          if (input.messageIntent === "stop" && contactAuthority) {
            await client.query(
              `update ss.responder_contact_authorities
                  set state = 'opted_out', opted_out_at = $2,
                      opt_out_evidence_digest = $3,
                      revision = revision + 1, updated_at = $4
                where id = $1`,
              [
                contactAuthority.id,
                input.occurredAt,
                input.evidenceDigest,
                input.recordedAt
              ]
            );
          }
          const interactionState = input.messageIntent === "stop"
            ? "opted_out"
            : contactAuthority === null || input.messageIntent !== "not_applicable"
              ? "handoff_required"
              : "open";
          const handoffReason = interactionState === "handoff_required"
            ? contactAuthority === null ? "missing_authority" :
              input.messageIntent === "handoff" ? "customer_request" :
                "uncertain_intent"
            : null;
          const interactionId = systemRandomUUID();
          await client.query(
            `insert into ss.responder_interactions (
               id, organization_id, project_id, contact_authority_id,
               route_digest, source_kind, state, handoff_reason,
               opened_at, last_event_at, revision, created_at, updated_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, 1, $10, $10)`,
            [
              interactionId, input.organizationId, input.projectId,
              contactAuthority?.id ?? null, input.routeDigest, input.eventKind,
              interactionState, handoffReason, input.occurredAt,
              input.recordedAt
            ]
          );
          const inserted = await client.query(
            `insert into ss.responder_provider_events (
               id, command_id, request_digest, organization_id, project_id,
               interaction_id, provider, provider_event_id_digest,
               route_digest, event_kind, message_intent, payload_digest,
               signature_verification_digest, evidence_digest,
               state, occurred_at, recorded_at, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, 'applied', $15, $16, $16
             ) returning *`,
            [
              systemRandomUUID(), input.commandId, input.requestDigest,
              input.organizationId, input.projectId, interactionId,
              input.provider, input.providerEventIdDigest, input.routeDigest,
              input.eventKind, input.messageIntent, input.payloadDigest,
              input.signatureVerificationDigest, input.evidenceDigest,
              input.occurredAt, input.recordedAt
            ]
          );
          return providerEvent(inserted.rows[0]);
        }
      ));
    },

    reserveHeldMessage(selectedActor, input) {
      return translated(() => database.service(
        serviceActor(selectedActor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await priorByCommand(
            client,
            "responder_message_commands",
            input.commandId
          );
          if (prior) {
            invariant(
              prior.request_digest === input.requestDigest,
              "RESPONDER_CORE_IDEMPOTENCY_CONFLICT",
              "Responder message command was reused for different facts.",
              { status: 409 }
            );
            return heldCommand(prior, true);
          }
          const selected = await client.query(
            `select interaction.*, authority.state as authority_state,
                    control.global_kill_engaged
               from ss.responder_interactions interaction
               join ss.responder_contact_authorities authority
                 on authority.id = $2
                and authority.id = interaction.contact_authority_id
                and authority.organization_id = interaction.organization_id
                and authority.project_id = interaction.project_id
               join ss.responder_runtime_controls control
                 on control.organization_id = interaction.organization_id
              where interaction.id = $1
                and interaction.organization_id = $3
                and interaction.project_id = $4
              for update of interaction, authority`,
            [
              input.interactionId, input.contactAuthorityId,
              input.organizationId, input.projectId
            ]
          );
          invariant(
            selected.rowCount === 1,
            "RESPONDER_CORE_UNAVAILABLE",
            "Responder interaction is unavailable.",
            { status: 404 }
          );
          const row = selected.rows[0];
          const heldReason = row.authority_state !== "active"
            ? "opted_out"
            : row.state === "handoff_required" || row.state === "opted_out"
              ? "human_handoff"
              : row.global_kill_engaged
                ? "global_kill"
                : "production_hold";
          const inserted = await client.query(
            `insert into ss.responder_message_commands (
               id, command_id, request_digest, organization_id, project_id,
               interaction_id, contact_authority_id, message_kind,
               content_digest, state, held_reason, provider_effects_authorized,
               delivery_claimed, requested_at, created_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               'held', $10, false, false, $11, $11
             ) returning *`,
            [
              systemRandomUUID(), input.commandId, input.requestDigest,
              input.organizationId, input.projectId, input.interactionId,
              input.contactAuthorityId, input.messageKind,
              input.contentDigest, heldReason, input.recordedAt
            ]
          );
          return heldCommand(inserted.rows[0]);
        }
      ));
    },

    requestHandoff(selectedActor, input) {
      return translated(() => database.service(
        serviceActor(selectedActor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await priorByCommand(
            client,
            "responder_control_commands",
            input.commandId
          );
          if (prior) {
            invariant(
              prior.request_digest === input.requestDigest,
              "RESPONDER_CORE_IDEMPOTENCY_CONFLICT",
              "Responder handoff command was reused for different facts.",
              { status: 409 }
            );
            const replay = await client.query(
              "select * from ss.responder_interactions where id = $1",
              [prior.interaction_id]
            );
            return interaction(replay.rows[0]);
          }
          const changed = await client.query(
            `update ss.responder_interactions
                set state = 'handoff_required', handoff_reason = $5,
                    revision = revision + 1, updated_at = $6
              where id = $1 and organization_id = $2 and project_id = $3
                and revision = $4 and state = 'open'
              returning *`,
            [
              input.interactionId, input.organizationId, input.projectId,
              input.expectedRevision, input.reason, input.recordedAt
            ]
          );
          invariant(
            changed.rowCount === 1,
            "RESPONDER_CORE_RETRY_REQUIRED",
            "Responder interaction changed; refresh and retry safely.",
            { status: 409 }
          );
          await client.query(
            `insert into ss.responder_control_commands (
               id, command_id, request_digest, command_kind,
               organization_id, project_id, interaction_id,
               actor_kind, actor_user_id, evidence_digest,
               recorded_at, created_at
             ) values ($1, $2, $3, 'human_handoff', $4, $5, $6,
               $7, $8, $9, $10, $10)`,
            [
              systemRandomUUID(), input.commandId, input.requestDigest,
              input.organizationId, input.projectId, input.interactionId,
              selectedActor.kind, selectedActor.userId,
              input.evidenceDigest, input.recordedAt
            ]
          );
          return interaction(changed.rows[0]);
        }
      ));
    },

    engageGlobalKill(selectedActor, input) {
      return translated(() => database.service(
        serviceActor(selectedActor),
        async (client) => {
          await requireOperator(client, selectedActor.userId);
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.commandId]
          );
          const prior = await priorByCommand(
            client,
            "responder_control_commands",
            input.commandId
          );
          if (prior) {
            invariant(
              prior.request_digest === input.requestDigest,
              "RESPONDER_CORE_IDEMPOTENCY_CONFLICT",
              "Responder kill command was reused for different facts.",
              { status: 409 }
            );
          } else {
            await client.query(
              `insert into ss.responder_runtime_controls (
                 organization_id, global_kill_engaged, state,
                 revision, created_at, updated_at
               ) values ($1, true, 'held', 1, $2, $2)
               on conflict (organization_id) do nothing`,
              [input.organizationId, input.recordedAt]
            );
            await client.query(
              `insert into ss.responder_control_commands (
                 id, command_id, request_digest, command_kind,
                 organization_id, project_id, interaction_id,
                 actor_kind, actor_user_id, evidence_digest,
                 recorded_at, created_at
               ) values ($1, $2, $3, 'global_kill', $4, null, null,
                 'operator', $5, $6, $7, $7)`,
              [
                systemRandomUUID(), input.commandId, input.requestDigest,
                input.organizationId, selectedActor.userId,
                input.evidenceDigest, input.recordedAt
              ]
            );
          }
          const selected = await client.query(
            `select organization_id, global_kill_engaged, state, revision,
                    updated_at
               from ss.responder_runtime_controls where organization_id = $1`,
            [input.organizationId]
          );
          return deepFreeze({
            schema: "sitesourcery.responder-runtime-control-read/v1",
            organizationId: selected.rows[0].organization_id,
            state: selected.rows[0].state,
            globalKillEngaged: selected.rows[0].global_kill_engaged,
            revision: Number(selected.rows[0].revision),
            updatedAt: iso(selected.rows[0].updated_at),
            providerEffects: false,
            replayed: prior !== null
          });
        }
      ));
    },

    accountProjection(selectedActor) {
      return translated(() => database.service(
        serviceActor(selectedActor, true),
        async (client) => {
          const membership = await client.query(
            `select 1 from ss.organization_memberships
              where organization_id = $1 and user_id = $2 and state = 'active'`,
            [selectedActor.organizationId, selectedActor.userId]
          );
          invariant(
            membership.rowCount === 1,
            "RESPONDER_CORE_UNAVAILABLE",
            "Responder account state is unavailable.",
            { status: 404 }
          );
          const rows = await client.query(
            `select * from ss.responder_interactions
              where organization_id = $1
              order by last_event_at desc, id desc limit 100`,
            [selectedActor.organizationId]
          );
          return deepFreeze({
            schema: "sitesourcery.responder-account-projection/v1",
            organizationId: selectedActor.organizationId,
            providerEffects: false,
            interactions: rows.rows.map(interaction)
          });
        }
      ));
    },

    operatorProjection(selectedActor) {
      return translated(() => database.service(
        serviceActor(selectedActor, true),
        async (client) => {
          await requireOperator(client, selectedActor.userId);
          const rows = await client.query(
            `select * from ss.responder_interactions
              where state in ('handoff_required', 'opted_out')
              order by last_event_at, id limit 200`
          );
          return deepFreeze({
            schema: "sitesourcery.responder-operator-projection/v1",
            providerEffects: false,
            interactions: rows.rows.map(interaction)
          });
        }
      ));
    }
  });
}
