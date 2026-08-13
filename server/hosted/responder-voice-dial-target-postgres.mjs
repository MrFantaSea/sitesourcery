import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    "Voice target command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_VOICE_DIAL_TARGET_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function actor(value) {
  invariant(
    value?.kind === "operator" && UUID.test(value.userId ?? "") &&
      UUID.test(value.organizationId ?? ""),
    "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
    "Responder Voice target authority is unavailable.",
    { status: 404 }
  );
  return value;
}

function translated(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
      "Responder Voice target authority is unavailable.",
      { status: 404 }
    );
  }
  if (["40001", "40P01", "55P03"].includes(error?.code)) {
    return new HostedError(
      "RESPONDER_VOICE_DIAL_TARGET_RETRY_REQUIRED",
      "Responder Voice target state changed; retry safely.",
      { status: 409 }
    );
  }
  if (["23503", "23505", "23514", "55000"].includes(error?.code)) {
    return new HostedError(
      "RESPONDER_VOICE_DIAL_TARGET_CONFLICT",
      "Responder Voice target evidence conflicts.",
      { status: 409 }
    );
  }
  return error;
}

export function createPostgresResponderVoiceDialTargets({
  authority,
  vault,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      vault?.kind === "responder-voice-dial-target-vault" &&
      vault.providerEffects === false &&
      typeof vault.readiness === "function" &&
      typeof vault.sealTarget === "function" &&
      typeof vault.openTarget === "function" &&
      typeof randomUUID === "function",
    "RESPONDER_VOICE_DIAL_TARGET_CONFIGURATION_REQUIRED",
    "Responder Voice targets require canonical storage and a private vault.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-voice-dial-targets-postgres",
    providerEffects: false,
    async readiness() {
      try {
        const [storage, vaultStatus] = await Promise.all([
          authority.service(
            { actorKind: "system", readOnly: true },
            (client) => client.query(`
              select
                to_regprocedure(
                  'ss.responder_voice_followup_closure_contract_v1()'
                ) is not null
                and ss.responder_voice_followup_closure_contract_v1() =
                  'canonical-fin-004t-responder-voice-target-followup-v1-held'
                  as contract_ready,
                not exists (
                  select 1
                    from ss.responder_provider_number_bindings binding
                   where binding.state = 'active'
                     and not exists (
                       select 1
                         from ss.responder_voice_dial_targets target
                        where target.number_binding_id = binding.id
                          and target.organization_id = binding.organization_id
                          and target.project_id = binding.project_id
                          and target.state = 'active'
                     )
                ) as coverage_ready
            `)
          ),
          vault.readiness()
        ]);
        const row = storage.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.coverage_ready === true &&
          vaultStatus?.ready === true && vaultStatus?.verified === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-voice-dial-targets-postgres",
          providerEffects: false,
          coverageReady: row.coverage_ready === true,
          code: ready ? null : "RESPONDER_VOICE_DIAL_TARGET_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-voice-dial-targets-postgres",
          providerEffects: false,
          coverageReady: false,
          code: "RESPONDER_VOICE_DIAL_TARGET_NOT_READY"
        });
      }
    },

    async resolveTarget({ numberBindingId } = {}) {
      const selectedBindingId = uuid(numberBindingId, "Number binding ID");
      try {
        const selected = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(
            `select target.*
               from ss.responder_voice_dial_targets target
               join ss.responder_provider_number_bindings binding
                 on binding.id = target.number_binding_id
                and binding.organization_id = target.organization_id
                and binding.project_id = target.project_id
              where target.number_binding_id = $1
                and target.state = 'active'
                and binding.state = 'active'`,
            [selectedBindingId]
          )
        );
        invariant(
          selected.rowCount === 1,
          "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
          "Responder Voice target is unavailable.",
          { status: 503 }
        );
        const row = selected.rows[0];
        return vault.openTarget({
          id: row.id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          numberBindingId: row.number_binding_id
        }, {
          keyVersion: row.key_version,
          nonce: row.nonce,
          authenticationTag: row.authentication_tag,
          ciphertext: row.ciphertext
        });
      } catch (error) {
        throw translated(error);
      }
    },

    async provisionTarget(selectedActor, input = {}) {
      const selectedActorValue = actor(selectedActor);
      const selected = {
        id: randomUUID(),
        commandId: commandId(input.commandId),
        requestDigest: sha256(input.requestDigest, "Request digest"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        numberBindingId: uuid(input.numberBindingId, "Number binding ID"),
        target: input.target,
        provisionEvidenceDigest: sha256(
          input.provisionEvidenceDigest,
          "Provision evidence digest"
        ),
        recordedAt: instant(input.recordedAt, "Record time")
      };
      invariant(
        selectedActorValue.organizationId === selected.organizationId,
        "RESPONDER_VOICE_DIAL_TARGET_UNAVAILABLE",
        "Responder Voice target authority is unavailable.",
        { status: 404 }
      );
      const envelope = await vault.sealTarget({
        id: selected.id,
        organizationId: selected.organizationId,
        projectId: selected.projectId,
        numberBindingId: selected.numberBindingId
      }, selected.target);
      try {
        const result = await authority.service({
          actorKind: "operator",
          userId: selectedActorValue.userId,
          organizationId: selected.organizationId,
          isolation: "serializable"
        }, async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-voice-target:${selected.commandId}`]
          );
          const prior = await client.query(
            `select * from ss.responder_voice_dial_targets
              where command_id = $1`,
            [selected.commandId]
          );
          if (prior.rowCount === 1) {
            invariant(
              prior.rows[0].request_digest === selected.requestDigest,
              "RESPONDER_VOICE_DIAL_TARGET_CONFLICT",
              "Responder Voice target command was reused.",
              { status: 409 }
            );
            return { row: prior.rows[0], replayed: true };
          }
          const inserted = await client.query(
            `insert into ss.responder_voice_dial_targets (
               id, command_id, request_digest, organization_id, project_id,
               number_binding_id, key_version, nonce, authentication_tag,
               ciphertext, envelope_digest, state,
               provision_evidence_digest, provisioned_by_user_id,
               provisioned_at, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               ss.responder_voice_dial_target_envelope_digest(
                 $1, $4, $5, $6, $7, $8, $9, $10
               ), 'active', $11, $12, $13, $13, $13
             ) returning *`,
            [
              selected.id, selected.commandId, selected.requestDigest,
              selected.organizationId, selected.projectId,
              selected.numberBindingId, envelope.keyVersion, envelope.nonce,
              envelope.authenticationTag, envelope.ciphertext,
              selected.provisionEvidenceDigest, selectedActorValue.userId,
              selected.recordedAt
            ]
          );
          return { row: inserted.rows[0], replayed: false };
        });
        return deepFreeze({
          schema: "sitesourcery.responder-voice-dial-target-receipt/v1",
          id: result.row.id,
          organizationId: result.row.organization_id,
          projectId: result.row.project_id,
          numberBindingId: result.row.number_binding_id,
          state: result.row.state,
          replayed: result.replayed,
          providerEffects: false
        });
      } catch (error) {
        throw translated(error);
      }
    }
  });
}
