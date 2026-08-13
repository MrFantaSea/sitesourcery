import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PURPOSE = "responder-inbound-followup";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKER =
  /^responder-inbound-followup-[A-Za-z0-9.-]{8,160}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

export const RESPONDER_MISSED_CALL_FOLLOWUP_BODY =
  "Sorry we missed your call. How can we help? Reply STOP to opt out.";

function instant(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "RESPONDER_INBOUND_FOLLOWUP_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function claim(row) {
  invariant(
    UUID.test(row.id ?? "") && UUID.test(row.inbound_event_id ?? "") &&
      UUID.test(row.core_provider_event_id ?? "") &&
      UUID.test(row.interaction_id ?? "") &&
      UUID.test(row.delivery_operation_id ?? "") &&
      WORKER.test(row.leased_by ?? ""),
    "RESPONDER_INBOUND_FOLLOWUP_REPOSITORY_INVALID",
    "The Responder inbound follow-up claim is invalid.",
    { status: 500 }
  );
  const eligible = UUID.test(row.contact_authority_id ?? "") &&
    row.contact_state === "active" && row.interaction_state === "open" &&
    row.material_state === "active";
  return Object.freeze({
    schema: "sitesourcery.responder-inbound-followup-claim/v1",
    jobId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    inboundEventId: row.inbound_event_id,
    coreProviderEventId: row.core_provider_event_id,
    interactionId: row.interaction_id,
    contactAuthorityId: row.contact_authority_id ?? null,
    deliveryOperationId: row.delivery_operation_id,
    commandId: row.command_id,
    messageKind: row.message_kind,
    routeDigest: row.authority_route_digest ?? null,
    eligibility: eligible ? "eligible" :
      row.contact_authority_id === null
        ? "consent_required"
        : row.material_state !== "active"
          ? "inbound_material_unavailable"
          : "authority_not_active",
    inboundAuthority: row.material_state === "active"
      ? Object.freeze({
          inboundEventId: row.inbound_event_id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          channel: row.channel,
          fromRouteDigest: row.from_route_digest,
          payloadDigest: row.payload_digest
        })
      : null,
    inboundEnvelope: row.material_state === "active"
      ? Object.freeze({
          keyVersion: row.key_version,
          nonce: row.nonce,
          authenticationTag: row.authentication_tag,
          ciphertext: row.ciphertext
        })
      : null,
    attemptCount: Number(row.attempt_count),
    fence: Number(row.lease_fence),
    leaseExpiresAt: instant(
      row.lease_expires_at,
      "Responder inbound follow-up lease expiration"
    )
  });
}

export function createPostgresResponderInboundFollowupRepository({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function",
    "RESPONDER_INBOUND_FOLLOWUP_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for inbound follow-up.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const result = await authority.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(`
          select
            ss.responder_voice_followup_closure_contract_v1() =
              'canonical-fin-004t-responder-voice-target-followup-v1-held'
              as contract_ready,
            to_regclass('ss.responder_inbound_followup_jobs') is not null
              as jobs_ready
        `)
      );
      const row = result.rows[0] ?? {};
      const ready = row.contract_ready === true && row.jobs_ready === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        code: ready ? null : "RESPONDER_INBOUND_FOLLOWUP_STORAGE_NOT_READY"
      });
    } catch {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        code: "RESPONDER_INBOUND_FOLLOWUP_STORAGE_NOT_READY"
      });
    }
  }

  async function claimNext({ workerId, observedAt, leaseSeconds } = {}) {
    invariant(
      WORKER.test(workerId ?? "") &&
        Number.isSafeInteger(leaseSeconds) &&
        leaseSeconds >= 30 && leaseSeconds <= 300,
      "RESPONDER_INBOUND_FOLLOWUP_INVALID",
      "Responder inbound follow-up claim is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Responder inbound follow-up claim time");
    const result = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(`
          update ss.responder_inbound_followup_jobs
             set state = case when attempt_count >= maximum_attempts
                   then 'dead_letter' else 'retry_wait' end,
                 run_at = $1,
                 failure_code = 'RESPONDER_INBOUND_FOLLOWUP_LEASE_EXPIRED',
                 manual_review_at = case
                   when attempt_count >= maximum_attempts then $1::timestamptz
                   else null::timestamptz end,
                 leased_by = null, leased_at = null, lease_expires_at = null,
                 updated_at = $1
           where state = 'running' and lease_expires_at <= $1
        `, [at]);
        return client.query(`
          with selected as (
            select id
              from ss.responder_inbound_followup_jobs
             where state in ('scheduled', 'retry_wait') and run_at <= $1
               and attempt_count < maximum_attempts
             order by run_at, id
             for update skip locked
             limit 1
          ), claimed as (
            update ss.responder_inbound_followup_jobs job
               set state = 'running', attempt_count = job.attempt_count + 1,
                   lease_fence = job.lease_fence + 1,
                   leased_by = $2, leased_at = $1,
                   lease_expires_at = $1 + make_interval(secs => $3),
                   failure_code = null, manual_review_at = null,
                   updated_at = $1
              from selected
             where job.id = selected.id
            returning job.*
          )
          select claimed.*,
                 interaction.state as interaction_state,
                 contact.state as contact_state,
                 contact.route_digest as authority_route_digest,
                 material.state as material_state,
                 material.channel, material.from_route_digest,
                 material.payload_digest, material.key_version,
                 material.nonce, material.authentication_tag,
                 material.ciphertext
            from claimed
            join ss.responder_interactions interaction
              on interaction.id = claimed.interaction_id
             and interaction.organization_id = claimed.organization_id
            left join ss.responder_contact_authorities contact
              on contact.id = claimed.contact_authority_id
             and contact.organization_id = claimed.organization_id
            left join ss.responder_inbound_private_materials material
              on material.inbound_event_id = claimed.inbound_event_id
             and material.organization_id = claimed.organization_id
        `, [at, workerId, leaseSeconds]);
      }
    );
    return result.rowCount === 0 ? null : claim(result.rows[0]);
  }

  async function completeClaim({
    jobId, fence, workerId, observedAt, result
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") &&
        ["followup_materialized", "manual_review"].includes(
          result?.receiptKind
        ),
      "RESPONDER_INBOUND_FOLLOWUP_INVALID",
      "Responder inbound follow-up completion is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Responder inbound follow-up completion time");
    const jobAuthority = await authority.service(
      { actorKind: "system", readOnly: true },
      (client) => client.query(
        `select organization_id
           from ss.responder_inbound_followup_jobs
          where id = $1`,
        [jobId]
      )
    );
    invariant(
      jobAuthority.rowCount === 1 &&
        UUID.test(jobAuthority.rows[0].organization_id ?? ""),
      "RESPONDER_INBOUND_FOLLOWUP_LEASE_LOST",
      "Responder inbound follow-up authority is unavailable.",
      { status: 409 }
    );
    return authority.service(
      {
        actorKind: "system",
        organizationId: jobAuthority.rows[0].organization_id,
        isolation: "serializable"
      },
      async (client) => {
        const selected = await client.query(`
          select job.*, interaction.state as interaction_state,
                 contact.state as contact_state,
                 contact.route_digest as route_digest,
                 control.state as control_state,
                 control.global_kill_engaged
            from ss.responder_inbound_followup_jobs job
            join ss.responder_interactions interaction
              on interaction.id = job.interaction_id
             and interaction.organization_id = job.organization_id
            left join ss.responder_contact_authorities contact
              on contact.id = job.contact_authority_id
             and contact.organization_id = job.organization_id
            join ss.responder_runtime_controls control
              on control.organization_id = job.organization_id
           where job.id = $1 and job.state = 'running'
             and job.leased_by = $2 and job.lease_fence = $3
             and job.lease_expires_at > $4
           for update of job, interaction, control
        `, [jobId, workerId, fence, at]);
        invariant(
          selected.rowCount === 1,
          "RESPONDER_INBOUND_FOLLOWUP_LEASE_LOST",
          "Responder inbound follow-up lease is no longer current.",
          { status: 409 }
        );
        const row = selected.rows[0];
        if (row.contact_authority_id !== null) {
          const lockedContact = await client.query(
            `select state, route_digest
               from ss.responder_contact_authorities
              where id = $1 and organization_id = $2
              for update`,
            [row.contact_authority_id, row.organization_id]
          );
          row.contact_state = lockedContact.rows[0]?.state ?? null;
          row.route_digest = lockedContact.rows[0]?.route_digest ?? null;
        }
        const eligible = row.contact_authority_id !== null &&
          row.contact_state === "active" && row.interaction_state === "open";
        if (result.receiptKind === "manual_review" || !eligible) {
          const failureCode = result.failureCode ??
            "RESPONDER_INBOUND_FOLLOWUP_AUTHORITY_REQUIRED";
          invariant(
            CODE.test(failureCode),
            "RESPONDER_INBOUND_FOLLOWUP_INVALID",
            "Responder inbound follow-up failure is invalid.",
            { status: 400 }
          );
          await client.query(`
            update ss.responder_inbound_followup_jobs
               set state = 'manual_review', failure_code = $2,
                   manual_review_at = $3, leased_by = null, leased_at = null,
                   lease_expires_at = null, updated_at = $3
             where id = $1
          `, [jobId, failureCode, at]);
          return deepFreeze({ status: "manual_review", jobId });
        }

        invariant(
          result.contentDigest?.match?.(/^[0-9a-f]{64}$/u) &&
            result.routeDigest === row.route_digest &&
            result.envelope &&
            typeof result.envelope.keyVersion === "string" &&
            Buffer.isBuffer(result.envelope.nonce) &&
            Buffer.isBuffer(result.envelope.authenticationTag) &&
            Buffer.isBuffer(result.envelope.ciphertext),
          "RESPONDER_INBOUND_FOLLOWUP_INVALID",
          "Responder inbound follow-up material is invalid.",
          { status: 500 }
        );
        const commandRequestDigest = digest({
          schema: "sitesourcery.responder-held-message-command/v1",
          commandId: row.command_id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          interactionId: row.interaction_id,
          contactAuthorityId: row.contact_authority_id,
          messageKind: row.message_kind,
          contentDigest: result.contentDigest
        });
        const operationState = row.control_state === "approved_live" &&
          row.global_kill_engaged === false ? "queued" : "held";
        await client.query(`
          insert into ss.responder_message_commands (
            id, command_id, request_digest, organization_id, project_id,
            interaction_id, contact_authority_id, message_kind,
            content_digest, state, held_reason, provider_effects_authorized,
            delivery_claimed, requested_at, created_at
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            'held', $10, false, false, $11, $11
          )
        `, [
          randomUUID(), row.command_id, commandRequestDigest,
          row.organization_id,
          row.project_id, row.interaction_id, row.contact_authority_id,
          row.message_kind, result.contentDigest,
          row.global_kill_engaged ? "global_kill" : "production_hold", at
        ]);
        const idempotencyKey = `responder-delivery:${commandRequestDigest}`;
        await client.query(`
          insert into ss.responder_delivery_operations (
            id, command_id, request_digest, organization_id, project_id,
            interaction_id, contact_authority_id, message_kind,
            route_digest, content_digest, idempotency_key, state,
            provider_effects_authorized, attempt_count, maximum_attempts,
            available_at, created_at, updated_at
          ) values (
            $1, $2,
            ss.responder_delivery_operation_digest(
              $2, $3, $4, $5, $6, $7, $8, $9, $10
            ),
            $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, 0, 5, $13, $14, $14
          )
        `, [
          row.delivery_operation_id, row.command_id, row.organization_id,
          row.project_id, row.interaction_id, row.contact_authority_id,
          row.message_kind, row.route_digest, result.contentDigest,
          idempotencyKey, operationState, operationState === "queued",
          operationState === "queued" ? at : null, at
        ]);
        await client.query(`
          insert into ss.responder_private_delivery_materials (
            operation_id, organization_id, project_id, interaction_id,
            contact_authority_id, message_kind, route_digest, content_digest,
            key_version, nonce, authentication_tag, ciphertext,
            envelope_digest, state, created_at, updated_at
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            ss.responder_private_material_envelope_digest(
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            ), 'active', $13, $13
          )
        `, [
          row.delivery_operation_id, row.organization_id, row.project_id,
          row.interaction_id, row.contact_authority_id, row.message_kind,
          row.route_digest, result.contentDigest,
          result.envelope.keyVersion, result.envelope.nonce,
          result.envelope.authenticationTag, result.envelope.ciphertext, at
        ]);
        const resultDigest = digest({
          schema: "sitesourcery.responder-inbound-followup-result/v1",
          jobId, fence, operationId: row.delivery_operation_id,
          contentDigest: result.contentDigest, recordedAt: at
        });
        await client.query(`
          update ss.responder_inbound_followup_jobs
             set state = 'succeeded', result_digest = $2, completed_at = $3,
                 failure_code = null, leased_by = null, leased_at = null,
                 lease_expires_at = null, updated_at = $3
           where id = $1
        `, [jobId, resultDigest, at]);
        return deepFreeze({ status: "completed", jobId, resultDigest });
      }
    );
  }

  async function releaseClaim({
    jobId, fence, workerId, failureCode, observedAt, retryAt
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        WORKER.test(workerId ?? "") && CODE.test(failureCode ?? ""),
      "RESPONDER_INBOUND_FOLLOWUP_INVALID",
      "Responder inbound follow-up release is invalid.",
      { status: 400 }
    );
    const at = instant(observedAt, "Responder inbound follow-up failure time");
    const retry = instant(retryAt, "Responder inbound follow-up retry time");
    const updated = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.responder_inbound_followup_jobs
           set state = case when attempt_count >= maximum_attempts
                 then 'dead_letter' else 'retry_wait' end,
               run_at = $5, failure_code = $4,
               manual_review_at = case when attempt_count >= maximum_attempts
                 then $6::timestamptz else null::timestamptz end,
               leased_by = null, leased_at = null, lease_expires_at = null,
               updated_at = $6
         where id = $1 and state = 'running' and leased_by = $2
           and lease_fence = $3 and lease_expires_at > $6
        returning state
      `, [jobId, workerId, fence, failureCode, retry, at])
    );
    invariant(
      updated.rowCount === 1,
      "RESPONDER_INBOUND_FOLLOWUP_LEASE_LOST",
      "Responder inbound follow-up lease is no longer current.",
      { status: 409 }
    );
    return deepFreeze({
      status: updated.rows[0].state === "dead_letter"
        ? "manual_review"
        : "released",
      jobId
    });
  }

  return Object.freeze({
    kind: `${PURPOSE}-postgres`,
    readiness,
    claimNext,
    completeClaim,
    releaseClaim
  });
}

export function createResponderInboundFollowupExecutor({
  inboundVault,
  deliveryVault
} = {}) {
  invariant(
    inboundVault?.kind === "responder-inbound-material-vault" &&
      inboundVault.providerEffects === false &&
      typeof inboundVault.readiness === "function" &&
      typeof inboundVault.openInboundMaterial === "function" &&
      deliveryVault?.kind === "responder-private-material-vault" &&
      deliveryVault.providerEffects === false &&
      typeof deliveryVault.readiness === "function" &&
      typeof deliveryVault.sealSmsMaterial === "function",
    "RESPONDER_INBOUND_FOLLOWUP_CONFIGURATION_REQUIRED",
    "Responder inbound follow-up requires both private material vaults.",
    { status: 500 }
  );
  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: false,
    async readiness() {
      const [inbound, delivery] = await Promise.all([
        inboundVault.readiness(), deliveryVault.readiness()
      ]);
      const ready = inbound?.ready === true && inbound?.verified === true &&
        delivery?.ready === true && delivery?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: `${PURPOSE}-executor`,
        providerEffects: false
      });
    },
    async execute(selected) {
      if (selected.eligibility !== "eligible") {
        return Object.freeze({
          receiptKind: "manual_review",
          failureCode: selected.eligibility === "consent_required"
            ? "RESPONDER_INBOUND_FOLLOWUP_CONSENT_REQUIRED"
            : selected.eligibility === "inbound_material_unavailable"
              ? "RESPONDER_INBOUND_FOLLOWUP_MATERIAL_UNAVAILABLE"
              : "RESPONDER_INBOUND_FOLLOWUP_AUTHORITY_REQUIRED"
        });
      }
      const opened = await inboundVault.openInboundMaterial(
        selected.inboundAuthority,
        selected.inboundEnvelope
      );
      const routeDigest = digest({ routeKind: "sms", address: opened.from });
      invariant(
        routeDigest === selected.routeDigest,
        "RESPONDER_INBOUND_FOLLOWUP_AUTHORITY_CONFLICT",
        "Responder inbound caller does not match active consent.",
        { status: 409 }
      );
      const contentDigest = digest({
        contentKind: "sms",
        body: RESPONDER_MISSED_CALL_FOLLOWUP_BODY
      });
      const envelope = await deliveryVault.sealSmsMaterial({
        operationId: selected.deliveryOperationId,
        organizationId: selected.organizationId,
        projectId: selected.projectId,
        interactionId: selected.interactionId,
        contactAuthorityId: selected.contactAuthorityId,
        messageKind: selected.messageKind,
        routeDigest,
        contentDigest
      }, {
        to: opened.from,
        body: RESPONDER_MISSED_CALL_FOLLOWUP_BODY
      });
      return Object.freeze({
        receiptKind: "followup_materialized",
        routeDigest,
        contentDigest,
        envelope
      });
    }
  });
}
