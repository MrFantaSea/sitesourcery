import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const PROVIDER = /^[a-z][a-z0-9_-]{2,63}$/u;
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function exactObject(value, fields, label) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    `${label} is invalid.`,
    { status: 500 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function safeId(value, field) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function safeErrorCode(value) {
  invariant(
    typeof value === "string" && SAFE_ERROR_CODE.test(value),
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    "Responder fulfillment failure code is invalid.",
    { status: 500 }
  );
  return value;
}

function iso(value, field) {
  const selected = value instanceof Date
    ? value.toISOString()
    : String(value ?? "");
  invariant(
    Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function attempt(value) {
  invariant(
    Number.isSafeInteger(value) && value >= 1 && value <= 5,
    "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
    "Responder fulfillment attempt is invalid.",
    { status: 500 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_FULFILLMENT_REPOSITORY_UNAVAILABLE",
      "Responder fulfillment state is unavailable.",
      { status: 503 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
      "Responder fulfillment state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_FULFILLMENT_REPOSITORY_CONFLICT",
      "The Responder fulfillment repository rejected inconsistent evidence.",
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

// A durable STOP revokes dispatch authority for claimed operations by
// cancelling them mid-lease with this exact failure code. The transitions
// below distinguish that revocation from ordinary lease loss.
function suppressionCancelled(row) {
  return row?.state === "cancelled" &&
    row.failure_code === "RESPONDER_DELIVERY_OPTED_OUT";
}

function assertClaimOwner(row, input) {
  invariant(
    row &&
      row.state === "claimed" &&
      row.lease_owner === input.workerId &&
      Number(row.attempt_count) === input.attemptCount,
    "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
    "Responder fulfillment lease ownership changed.",
    { status: 409 }
  );
  return row;
}

function claim(row, workerId) {
  return deepFreeze({
    status: "claimed",
    operationId: row.id,
    commandId: row.command_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    interactionId: row.interaction_id,
    contactAuthorityId: row.contact_authority_id,
    routeDigest: row.route_digest,
    contentDigest: row.content_digest,
    messageKind: row.message_kind,
    idempotencyKey: row.idempotency_key,
    attemptCount: Number(row.attempt_count),
    workerId
  });
}

export function createPostgresResponderFulfillmentRepository({
  authority
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof authority.readiness === "function",
    "RESPONDER_FULFILLMENT_REPOSITORY_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Responder fulfillment.",
    { status: 500 }
  );

  return Object.freeze({
    kind: "responder-fulfillment-postgres",
    providerEffects: false,

    async readiness() {
      try {
        const result = await authority.service(
          { readOnly: true },
          (client) => client.query(
            `select
               to_regprocedure(
                 'ss.hosted_responder_fulfillment_queue_contract_v1()'
               ) is not null
               and ss.hosted_responder_fulfillment_queue_contract_v1() =
                 'canonical-responder-fulfillment-queue-v1-held-default'
               and to_regprocedure(
                 'ss.hosted_responder_private_material_contract_v1()'
               ) is not null
               and ss.hosted_responder_private_material_contract_v1() =
                 'canonical-responder-private-material-v1-operation-bound-aes-gcm'
               and to_regprocedure(
                 'ss.hosted_responder_twilio_delivery_events_contract_v1()'
               ) is not null
               and ss.hosted_responder_twilio_delivery_events_contract_v1() =
                 'canonical-responder-twilio-delivery-events-v1-digest-only-race-safe'
                 as contract_ready,
               count(*) filter (
                 where relation.relname in (
                   'responder_delivery_operations',
                   'responder_delivery_operation_events',
                   'responder_private_delivery_materials',
                   'responder_delivery_provider_events',
                   'responder_delivery_provider_statuses'
                 )
                   and relation.relrowsecurity
                   and relation.relforcerowsecurity
               ) = 5 as tables_ready,
               exists (
                 select 1 from information_schema.columns
                  where table_schema = 'ss'
                    and table_name = 'responder_runtime_controls'
                    and column_name = 'release_evidence_digest'
               ) as release_ready
             from pg_class relation
             join pg_namespace namespace
               on namespace.oid = relation.relnamespace
            where namespace.nspname = 'ss'`
          )
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.release_ready === true;
        return deepFreeze({
          schema: "sitesourcery.responder-fulfillment-postgres-readiness/v1",
          ready,
          verified: ready,
          kind: "responder-fulfillment-postgres",
          state: ready ? "held-capable" : "not-ready",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          schema: "sitesourcery.responder-fulfillment-postgres-readiness/v1",
          ready: false,
          verified: false,
          kind: "responder-fulfillment-postgres",
          state: "not-ready",
          providerEffects: false
        });
      }
    },

    claimNextDelivery(input) {
      exactObject(
        input,
        ["workerId", "claimedAt", "leaseExpiresAt"],
        "Responder delivery claim"
      );
      const workerId = safeId(input.workerId, "Worker ID");
      const claimedAt = iso(input.claimedAt, "Claim time");
      const leaseExpiresAt = iso(
        input.leaseExpiresAt,
        "Lease expiration"
      );
      invariant(
        Date.parse(leaseExpiresAt) >= Date.parse(claimedAt) + 30_000 &&
          Date.parse(leaseExpiresAt) <= Date.parse(claimedAt) + 600_000,
        "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
        "Responder fulfillment lease duration is invalid.",
        { status: 500 }
      );
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const selected = await client.query(
            `select operation.*
               from ss.responder_delivery_operations operation
               join ss.responder_runtime_controls control
                 on control.organization_id = operation.organization_id
               join ss.responder_contact_authorities authority
                 on authority.id = operation.contact_authority_id
                and authority.organization_id = operation.organization_id
               join ss.responder_interactions interaction
                 on interaction.id = operation.interaction_id
                and interaction.organization_id = operation.organization_id
               join ss.responder_private_delivery_materials material
                 on material.operation_id = operation.id
                and material.organization_id = operation.organization_id
                and material.project_id = operation.project_id
                and material.interaction_id = operation.interaction_id
                and material.contact_authority_id =
                  operation.contact_authority_id
                and material.message_kind = operation.message_kind
                and material.route_digest = operation.route_digest
                and material.content_digest = operation.content_digest
              where operation.state in ('queued', 'retry_wait')
                and operation.provider_effects_authorized
                and operation.available_at <= $1
                and operation.attempt_count < operation.maximum_attempts
                and control.state = 'approved_live'
                and not control.global_kill_engaged
                and authority.state = 'active'
                and interaction.state = 'open'
                and material.state = 'active'
                and material.envelope_digest =
                  ss.responder_private_material_envelope_digest(
                    material.operation_id, material.organization_id,
                    material.project_id, material.interaction_id,
                    material.contact_authority_id, material.message_kind,
                    material.route_digest, material.content_digest,
                    material.key_version, material.nonce,
                    material.authentication_tag, material.ciphertext
                  )
              order by operation.available_at, operation.created_at,
                       operation.id
              for update of operation skip locked
              for share of authority skip locked
              limit 1`,
            [claimedAt]
          );
          if (selected.rowCount === 0) {
            return deepFreeze({ status: "idle" });
          }
          const row = selected.rows[0];
          const updated = await client.query(
            `update ss.responder_delivery_operations
                set state = 'claimed', attempt_count = attempt_count + 1,
                    available_at = null, lease_owner = $2,
                    lease_started_at = $3, lease_expires_at = $4,
                    last_worker_id = $2, failure_code = null,
                    updated_at = $3
              where id = $1 and state = $5
              returning *`,
            [row.id, workerId, claimedAt, leaseExpiresAt, row.state]
          );
          invariant(
            updated.rowCount === 1,
            "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
            "Responder fulfillment claim changed concurrently.",
            { status: 409 }
          );
          return claim(updated.rows[0], workerId);
        }
      ));
    },

    recordDeliveryAccepted(input) {
      exactObject(input, [
        "operationId", "workerId", "attemptCount", "provider",
        "providerMessageIdDigest", "providerReceiptDigest", "acceptedAt"
      ], "Responder provider acceptance");
      const selected = {
        operationId: uuid(input.operationId, "Operation ID"),
        workerId: safeId(input.workerId, "Worker ID"),
        attemptCount: attempt(input.attemptCount),
        providerMessageIdDigest: sha256(
          input.providerMessageIdDigest,
          "Provider message ID digest"
        ),
        providerReceiptDigest: sha256(
          input.providerReceiptDigest,
          "Provider receipt digest"
        ),
        acceptedAt: iso(input.acceptedAt, "Provider acceptance time")
      };
      invariant(
        typeof input.provider === "string" && PROVIDER.test(input.provider),
        "RESPONDER_FULFILLMENT_REPOSITORY_INVALID",
        "Responder fulfillment provider is invalid.",
        { status: 500 }
      );
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const locked = await client.query(
            `select * from ss.responder_delivery_operations
              where id = $1 for update`,
            [selected.operationId]
          );
          const row = locked.rows[0];
          if (row?.state === "accepted") {
            invariant(
              Number(row.attempt_count) === selected.attemptCount &&
                row.last_worker_id === selected.workerId &&
                row.provider === input.provider &&
                row.provider_message_id_digest ===
                  selected.providerMessageIdDigest &&
                row.provider_receipt_digest ===
                  selected.providerReceiptDigest &&
                iso(row.provider_accepted_at, "Stored acceptance time") ===
                  selected.acceptedAt,
              "RESPONDER_FULFILLMENT_REPOSITORY_CONFLICT",
              "Responder provider acceptance evidence conflicts.",
              { status: 409 }
            );
            return deepFreeze({ status: "replay" });
          }
          invariant(
            !suppressionCancelled(row),
            "RESPONDER_DELIVERY_SUPPRESSION_CONFLICT",
            "The provider effect completed after a durable STOP cancelled " +
              "this operation; the receipt requires operator reconciliation.",
            { status: 409 }
          );
          assertClaimOwner(row, selected);
          const updated = await client.query(
            `update ss.responder_delivery_operations
                set state = 'accepted', lease_owner = null,
                    lease_started_at = null, lease_expires_at = null,
                    provider = $2, provider_receipt_digest = $3,
                    provider_message_id_digest = $4,
                    provider_accepted_at = $5,
                    provider_mapping_recorded_at = $5,
                    updated_at = $5
              where id = $1 and state = 'claimed'
              returning id`,
            [
              selected.operationId,
              input.provider,
              selected.providerReceiptDigest,
              selected.providerMessageIdDigest,
              selected.acceptedAt
            ]
          );
          invariant(
            updated.rowCount === 1,
            "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
            "Responder provider acceptance changed concurrently.",
            { status: 409 }
          );
          return deepFreeze({ status: "accepted" });
        }
      ));
    },

    recordDeliveryRetry(input) {
      exactObject(input, [
        "operationId", "workerId", "attemptCount", "failureCode", "failedAt"
      ], "Responder delivery retry");
      const selected = {
        operationId: uuid(input.operationId, "Operation ID"),
        workerId: safeId(input.workerId, "Worker ID"),
        attemptCount: attempt(input.attemptCount),
        failureCode: safeErrorCode(input.failureCode),
        failedAt: iso(input.failedAt, "Failure time")
      };
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const locked = await client.query(
            `select * from ss.responder_delivery_operations
              where id = $1 for update`,
            [selected.operationId]
          );
          if (suppressionCancelled(locked.rows[0])) {
            return deepFreeze({ status: "already_cancelled" });
          }
          const row = assertClaimOwner(locked.rows[0], selected);
          if (Number(row.attempt_count) >= Number(row.maximum_attempts)) {
            const reviewed = await client.query(
              `update ss.responder_delivery_operations
                  set state = 'dead_letter',
                      provider_effects_authorized = false,
                      available_at = null, lease_owner = null,
                      lease_started_at = null, lease_expires_at = null,
                      failure_code = $2, manual_review_at = $3,
                      updated_at = $3
                where id = $1 and state = 'claimed'
                returning id`,
              [selected.operationId, selected.failureCode, selected.failedAt]
            );
            invariant(
              reviewed.rowCount === 1,
              "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
              "Responder dead-letter transition changed concurrently.",
              { status: 409 }
            );
            return deepFreeze({ status: "manual_review" });
          }
          const delayMs = Math.min(
            300_000,
            5_000 * 2 ** Math.min(selected.attemptCount - 1, 10)
          );
          const availableAt = new Date(
            Date.parse(selected.failedAt) + delayMs
          ).toISOString();
          const retried = await client.query(
            `update ss.responder_delivery_operations
                set state = 'retry_wait', available_at = $2,
                    lease_owner = null, lease_started_at = null,
                    lease_expires_at = null, failure_code = $3,
                    updated_at = $4
              where id = $1 and state = 'claimed'
              returning id`,
            [
              selected.operationId,
              availableAt,
              selected.failureCode,
              selected.failedAt
            ]
          );
          invariant(
            retried.rowCount === 1,
            "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
            "Responder retry transition changed concurrently.",
            { status: 409 }
          );
          return deepFreeze({ status: "retry_scheduled" });
        }
      ));
    },

    recordDeliveryManualReview(input) {
      exactObject(input, [
        "operationId", "workerId", "attemptCount", "failureCode", "failedAt"
      ], "Responder delivery manual review");
      const selected = {
        operationId: uuid(input.operationId, "Operation ID"),
        workerId: safeId(input.workerId, "Worker ID"),
        attemptCount: attempt(input.attemptCount),
        failureCode: safeErrorCode(input.failureCode),
        failedAt: iso(input.failedAt, "Failure time")
      };
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const locked = await client.query(
            `select * from ss.responder_delivery_operations
              where id = $1 for update`,
            [selected.operationId]
          );
          if (suppressionCancelled(locked.rows[0])) {
            return deepFreeze({ status: "already_cancelled" });
          }
          assertClaimOwner(locked.rows[0], selected);
          const reviewed = await client.query(
            `update ss.responder_delivery_operations
                set state = 'manual_review',
                    provider_effects_authorized = false,
                    available_at = null, lease_owner = null,
                    lease_started_at = null, lease_expires_at = null,
                    failure_code = $2, manual_review_at = $3,
                    updated_at = $3
              where id = $1 and state = 'claimed'
              returning id`,
            [selected.operationId, selected.failureCode, selected.failedAt]
          );
          invariant(
            reviewed.rowCount === 1,
            "RESPONDER_FULFILLMENT_RETRY_REQUIRED",
            "Responder manual-review transition changed concurrently.",
            { status: 409 }
          );
          return deepFreeze({ status: "manual_review" });
        }
      ));
    }
  });
}
