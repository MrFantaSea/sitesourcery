import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MESSAGE_KINDS = new Set([
  "missed_call_ack",
  "human_handoff_ack"
]);
const RESOLUTION_FIELDS = Object.freeze([
  "schema", "operationId", "organizationId", "projectId", "interactionId",
  "contactAuthorityId", "messageKind", "routeDigest", "contentDigest"
]);
const STORE_FIELDS = Object.freeze([
  ...RESOLUTION_FIELDS.filter((field) => field !== "schema"),
  "to", "body", "recordedAt"
]);

function exactObject(value, fields, label) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    `${label} is invalid.`,
    { status: 500 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function selectedAuthority(value, fields, label) {
  exactObject(value, fields, label);
  invariant(
    UUID.test(value.operationId) &&
      UUID.test(value.organizationId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.interactionId) &&
      UUID.test(value.contactAuthorityId) &&
      MESSAGE_KINDS.has(value.messageKind) &&
      SHA256.test(value.routeDigest) &&
      SHA256.test(value.contentDigest),
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    `${label} authority is invalid.`,
    { status: 500 }
  );
  return value;
}

function resolution(value) {
  const selected = selectedAuthority(
    value,
    RESOLUTION_FIELDS,
    "Responder private material resolution"
  );
  invariant(
    selected.schema ===
      "sitesourcery.responder-private-sms-resolution/v1",
    "RESPONDER_PRIVATE_MATERIAL_INVALID",
    "Responder private material resolution schema is invalid.",
    { status: 500 }
  );
  const authority = { ...selected };
  delete authority.schema;
  return authority;
}

function storeRequest(value) {
  const selected = selectedAuthority(
    value,
    STORE_FIELDS,
    "Responder private material store"
  );
  return {
    authority: Object.fromEntries(
      RESOLUTION_FIELDS
        .filter((field) => field !== "schema")
        .map((field) => [field, selected[field]])
    ),
    material: { to: selected.to, body: selected.body },
    recordedAt: instant(selected.recordedAt, "Private material record time")
  };
}

function configuration(authority, vault) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      vault?.kind === "responder-private-material-vault" &&
      vault.providerEffects === false &&
      typeof vault.readiness === "function" &&
      typeof vault.sealSmsMaterial === "function" &&
      typeof vault.openSmsMaterial === "function",
    "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED",
    "Responder private material requires canonical storage and its vault.",
    { status: 500 }
  );
}

function unavailable(error) {
  if (
    error instanceof HostedError &&
    [
      "RESPONDER_PRIVATE_MATERIAL_INVALID",
      "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED"
    ].includes(error.code)
  ) return error;
  return new HostedError(
    "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
    "Responder private delivery material is unavailable.",
    { status: 503 }
  );
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw unavailable(error);
  }
}

function values(authority) {
  return [
    authority.operationId,
    authority.organizationId,
    authority.projectId,
    authority.interactionId,
    authority.contactAuthorityId,
    authority.messageKind,
    authority.routeDigest,
    authority.contentDigest
  ];
}

export function createPostgresResponderPrivateMaterialResolver({
  authority,
  vault
} = {}) {
  configuration(authority, vault);

  async function readiness() {
    try {
      const [storage, vaultStatus] = await Promise.all([
        authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_private_material_contract_v1()'
              ) is not null
                and ss.hosted_responder_private_material_contract_v1() =
                  'canonical-responder-private-material-v1-operation-bound-aes-gcm'
                as contract_ready,
              c.relrowsecurity and c.relforcerowsecurity as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = 'responder_private_delivery_materials'
          `)
        ),
        vault.readiness()
      ]);
      const row = storage.rows[0] ?? {};
      const ready = storage.rowCount === 1 &&
        row.contract_ready === true &&
        row.rls_ready === true &&
        vaultStatus?.ready === true &&
        vaultStatus?.verified === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "responder-private-delivery-material-resolver",
        providerEffects: false,
        code: ready ? null : "RESPONDER_PRIVATE_MATERIAL_NOT_READY"
      });
    } catch {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "responder-private-delivery-material-resolver",
        providerEffects: false,
        code: "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE"
      });
    }
  }

  async function storeSmsMaterial(input) {
    const selected = storeRequest(input);
    return translated(() => authority.service(
      {
        actorKind: "system",
        organizationId: selected.authority.organizationId,
        isolation: "serializable"
      },
      async (client) => {
        const operation = await client.query(
          `select operation.*, authority.state as authority_state,
                  interaction.state as interaction_state
             from ss.responder_delivery_operations operation
             join ss.responder_contact_authorities authority
               on authority.id = operation.contact_authority_id
              and authority.organization_id = operation.organization_id
             join ss.responder_interactions interaction
               on interaction.id = operation.interaction_id
              and interaction.organization_id = operation.organization_id
            where operation.id = $1 and operation.organization_id = $2
            for update of operation`,
          [selected.authority.operationId, selected.authority.organizationId]
        );
        const row = operation.rows[0];
        invariant(
          operation.rowCount === 1 &&
            row.project_id === selected.authority.projectId &&
            row.interaction_id === selected.authority.interactionId &&
            row.contact_authority_id === selected.authority.contactAuthorityId &&
            row.message_kind === selected.authority.messageKind &&
            row.route_digest === selected.authority.routeDigest &&
            row.content_digest === selected.authority.contentDigest &&
            ["held", "queued"].includes(row.state) &&
            Number(row.attempt_count) === 0 &&
            row.authority_state === "active" &&
            row.interaction_state === "open",
          "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
          "Responder private delivery operation is unavailable.",
          { status: 503 }
        );
        const prior = await client.query(
          `select operation_id, state, route_digest, content_digest
             from ss.responder_private_delivery_materials
            where operation_id = $1`,
          [selected.authority.operationId]
        );
        if (prior.rowCount === 1) {
          invariant(
            prior.rows[0].state === "active" &&
              prior.rows[0].route_digest === selected.authority.routeDigest &&
              prior.rows[0].content_digest === selected.authority.contentDigest,
            "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
            "Responder private delivery material is unavailable.",
            { status: 503 }
          );
          return deepFreeze({
            schema: "sitesourcery.responder-private-material-receipt/v1",
            operationId: selected.authority.operationId,
            routeDigest: selected.authority.routeDigest,
            contentDigest: selected.authority.contentDigest,
            state: "active",
            replayed: true,
            providerEffects: false
          });
        }
        invariant(
          prior.rowCount === 0,
          "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
          "Responder private delivery material is unavailable.",
          { status: 503 }
        );
        const envelope = await vault.sealSmsMaterial(
          selected.authority,
          selected.material
        );
        const inserted = await client.query(
          `insert into ss.responder_private_delivery_materials (
             operation_id, organization_id, project_id, interaction_id,
             contact_authority_id, message_kind, route_digest, content_digest,
             key_version, nonce, authentication_tag, ciphertext,
             envelope_digest, state, destroy_reason,
             created_at, destroyed_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             ss.responder_private_material_envelope_digest(
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
             ),
             'active', null, $13, null, $13
           ) returning operation_id`,
          [
            ...values(selected.authority),
            envelope.keyVersion,
            envelope.nonce,
            envelope.authenticationTag,
            envelope.ciphertext,
            selected.recordedAt
          ]
        );
        invariant(
          inserted.rowCount === 1 &&
            inserted.rows[0].operation_id === selected.authority.operationId,
          "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
          "Responder private delivery material was not stored.",
          { status: 503 }
        );
        return deepFreeze({
          schema: "sitesourcery.responder-private-material-receipt/v1",
          operationId: selected.authority.operationId,
          routeDigest: selected.authority.routeDigest,
          contentDigest: selected.authority.contentDigest,
          state: "active",
          replayed: false,
          providerEffects: false
        });
      }
    ));
  }

  async function resolveSmsMaterial(input) {
    const selected = resolution(input);
    return translated(() => authority.service(
      {
        actorKind: "system",
        organizationId: selected.organizationId,
        readOnly: true
      },
      async (client) => {
        const result = await client.query(
          `select material.key_version, material.nonce,
                  material.authentication_tag, material.ciphertext,
                  material.envelope_digest =
                    ss.responder_private_material_envelope_digest(
                      material.operation_id, material.organization_id,
                      material.project_id, material.interaction_id,
                      material.contact_authority_id, material.message_kind,
                      material.route_digest, material.content_digest,
                      material.key_version, material.nonce,
                      material.authentication_tag, material.ciphertext
                    ) as envelope_verified
             from ss.responder_private_delivery_materials material
             join ss.responder_delivery_operations operation
               on operation.id = material.operation_id
              and operation.organization_id = material.organization_id
             join ss.responder_runtime_controls control
               on control.organization_id = material.organization_id
             join ss.responder_contact_authorities contact
               on contact.id = material.contact_authority_id
              and contact.organization_id = material.organization_id
             join ss.responder_interactions interaction
               on interaction.id = material.interaction_id
              and interaction.organization_id = material.organization_id
            where material.operation_id = $1
              and material.organization_id = $2
              and material.project_id = $3
              and material.interaction_id = $4
              and material.contact_authority_id = $5
              and material.message_kind = $6
              and material.route_digest = $7
              and material.content_digest = $8
              and material.state = 'active'
              and operation.state = 'claimed'
              and operation.provider_effects_authorized
              and control.state = 'approved_live'
              and not control.global_kill_engaged
              and contact.state = 'active'
              and interaction.state = 'open'`,
          values(selected)
        );
        invariant(
          result.rowCount === 1 &&
            result.rows[0].envelope_verified === true,
          "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
          "Responder private delivery material is unavailable.",
          { status: 503 }
        );
        const opened = await vault.openSmsMaterial(selected, {
          keyVersion: result.rows[0].key_version,
          nonce: result.rows[0].nonce,
          authenticationTag: result.rows[0].authentication_tag,
          ciphertext: result.rows[0].ciphertext
        });
        return deepFreeze({
          schema: "sitesourcery.responder-private-sms-material/v1",
          routeDigest: selected.routeDigest,
          contentDigest: selected.contentDigest,
          to: opened.to,
          body: opened.body
        });
      }
    ));
  }

  return Object.freeze({
    kind: "responder-private-delivery-material-resolver",
    providerEffects: false,
    readiness,
    storeSmsMaterial,
    resolveSmsMaterial
  });
}
