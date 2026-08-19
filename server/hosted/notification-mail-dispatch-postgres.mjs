import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_WORKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const CONSTRAINT_CODES = new Set(["23503", "23505", "23514", "55000"]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "NOTIFICATION_DISPATCH_CLAIM_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function selectedClock(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "NOTIFICATION_DISPATCH_CLAIM_CONFIGURATION_REQUIRED",
    "The notification dispatch claim clock is invalid.",
    { status: 500 }
  );
  return value;
}

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "NOTIFICATION_DISPATCH_CLAIM_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for notification claims.",
    { status: 500 }
  );
  return authority;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "NOTIFICATION_DISPATCH_CLAIM_RETRY_REQUIRED",
      "Notification dispatch claim changed concurrently; retry safely.",
      { status: 409 }
    );
  }
  if (CONSTRAINT_CODES.has(error?.code)) {
    return new HostedError(
      "NOTIFICATION_DISPATCH_CLAIM_CONFLICT",
      "The durable notification dispatch claim rejected inconsistent evidence.",
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

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function source(row) {
  const support = row.support_reservation_id === null
    ? null
    : {
        kind: "support",
        id: row.support_reservation_id,
        digest: row.support_reservation_digest
      };
  const commerce = row.commerce_reservation_id === null
    ? null
    : {
        kind: "commerce",
        id: row.commerce_reservation_id,
        digest: row.commerce_reservation_digest
      };
  const purpose = row.purpose_reservation_id === null
    ? null
    : {
        kind: "purpose",
        id: row.purpose_reservation_id,
        digest: row.purpose_reservation_digest
      };
  invariant(
    [support, commerce, purpose].filter((value) => value !== null).length === 1,
    "NOTIFICATION_DISPATCH_SOURCE_UNAVAILABLE",
    "The exact notification reservation is unavailable.",
    { status: 409 }
  );
  return support ?? commerce ?? purpose;
}

function reservation(row) {
  return {
    messageId: row.id,
    messageType: row.message_type,
    recipientDigest: row.recipient_digest,
    subjectReferenceDigest: row.subject_reference_digest,
    contentDigest: row.content_digest,
    templateVersion: row.template_version,
    state: row.state,
    expiresAt: iso(row.expires_at)
  };
}

function claimIdentity(row, selectedSource) {
  return {
    commandId: `notify-claim:${row.id}`
  };
}

function claimReceipt(row, selectedSource, claim) {
  return deepFreeze({
    status: "claimed",
    ...reservation(row),
    sourceKind: selectedSource.kind,
    sourceReservationId: selectedSource.id,
    sourceReservationDigest: selectedSource.digest,
    workerId: claim.worker_id,
    attemptNumber: Number(claim.attempt_number),
    fenceToken: Number(claim.fence_token),
    claimedAt: iso(claim.lease_started_at),
    leaseExpiresAt: iso(claim.lease_expires_at),
    providerIdempotencyKey: `sitesourcery-notification/${row.id}`,
    providerEffects: false
  });
}

const RESERVATION_SQL = `
  select mail.*,
         support.id as support_reservation_id,
         support.reservation_digest as support_reservation_digest,
         commerce.id as commerce_reservation_id,
         commerce.reservation_digest as commerce_reservation_digest,
         purpose.id as purpose_reservation_id,
         purpose.reservation_digest as purpose_reservation_digest
    from ss.hosted_mail_deliveries mail
    left join ss.hosted_support_case_mail_reservations support
      on support.mail_message_id = mail.id
    left join ss.commerce_transition_notification_outbox commerce
      on commerce.mail_message_id = mail.id
    left join ss.mail_purpose_notification_outbox purpose
      on purpose.mail_message_id = mail.id
   where mail.id = $1
   for update of mail`;

export function createPostgresNotificationMailDispatchSource({
  authority,
  clock = { now: () => new Date().toISOString() }
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    kind: "notification-mail-dispatch-source-postgres",
    providerEffects: false,

    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_mail_dispatch_contract_v2()')
                is not null
                and ss.hosted_mail_dispatch_contract_v2() =
                  'canonical-mail-dispatch-v2-support-commerce-purpose-leased-held'
                as contract_ready,
              to_regclass('ss.hosted_mail_dispatch_claims') is not null
                as table_ready,
              relation.relrowsecurity and relation.relforcerowsecurity
                as rls_ready,
              exists (
                select 1
                  from pg_constraint constraint_row
                 where constraint_row.conrelid = relation.oid
                   and constraint_row.conname =
                     'hosted_mail_dispatch_claims_source_kind_check_v140'
                   and constraint_row.convalidated
                   and pg_get_constraintdef(constraint_row.oid) like
                     '%purpose%'
              ) as source_constraint_ready,
              exists (
                select 1
                  from pg_trigger trigger_record
                 where trigger_record.tgrelid = relation.oid
                   and trigger_record.tgname =
                     'hosted_mail_dispatch_claims_guard'
                   and trigger_record.tgfoid =
                     'ss.guard_hosted_mail_dispatch_claim()'::regprocedure
                   and trigger_record.tgenabled = 'O'
                   and not trigger_record.tgisinternal
              ) as guard_ready,
              has_table_privilege(
                'service_role', relation.oid, 'SELECT'
              ) and has_table_privilege(
                'service_role', relation.oid, 'INSERT'
              ) and has_table_privilege(
                'service_role', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'service_role', relation.oid, 'TRIGGER'
              ) and coalesce((
                select role_record.rolbypassrls
                  from pg_roles role_record
                 where role_record.rolname = 'service_role'
              ), false)
              and not has_table_privilege(
                'anon', relation.oid, 'SELECT'
              ) and not has_table_privilege(
                'anon', relation.oid, 'INSERT'
              ) and not has_table_privilege(
                'anon', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'anon', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'anon', relation.oid, 'TRIGGER'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'SELECT'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'INSERT'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'UPDATE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'DELETE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'TRUNCATE'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'REFERENCES'
              ) and not has_table_privilege(
                'authenticated', relation.oid, 'TRIGGER'
              ) and not exists (
                select 1
                  from aclexplode(coalesce(
                    relation.relacl,
                    acldefault('r', relation.relowner)
                  )) relation_acl
                 where relation_acl.grantee <> relation.relowner
                   and relation_acl.grantee <> coalesce((
                     select role_record.oid
                       from pg_roles role_record
                      where role_record.rolname = 'service_role'
                   ), 0::oid)
                   and relation_acl.privilege_type = any(array[
                     'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                     'REFERENCES', 'TRIGGER'
                   ])
              ) as acl_ready
            from pg_class relation
            where relation.oid = 'ss.hosted_mail_dispatch_claims'::regclass
          `)
        );
        const row = result.rows[0];
        const ready = row?.contract_ready === true &&
          row?.table_ready === true && row?.rls_ready === true &&
          row?.source_constraint_ready === true && row?.guard_ready === true &&
          row?.acl_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "notification-mail-dispatch-source-postgres",
          code: ready ? null : "NOTIFICATION_DISPATCH_CLAIM_NOT_READY",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "notification-mail-dispatch-source-postgres",
          code: "NOTIFICATION_DISPATCH_CLAIM_NOT_READY",
          providerEffects: false
        });
      }
    },

    async listDispatchable(input = {}) {
      exactObject(input, ["limit"], "Dispatch candidate query");
      invariant(
        Number.isSafeInteger(input.limit) &&
          input.limit >= 1 && input.limit <= 25,
        "NOTIFICATION_DISPATCH_CLAIM_INVALID",
        "Dispatch candidate limit is invalid.",
        { status: 400 }
      );
      const observedAt = selectedClock(clock);
      return translated(async () => {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(
            `select mail.id
               from ss.hosted_mail_deliveries mail
              where mail.state = 'pending'
                and mail.expires_at > $1::timestamptz + interval '5 minutes'
                and (
                  exists (
                    select 1
                      from ss.hosted_support_case_mail_reservations support
                     where support.mail_message_id = mail.id
                  )
                  or exists (
                    select 1
                      from ss.commerce_transition_notification_outbox commerce
                     where commerce.mail_message_id = mail.id
                       and commerce.state = 'held'
                       and not commerce.provider_effects_authorized
                       and not commerce.delivery_claimed
                  )
                  or exists (
                    select 1
                      from ss.mail_purpose_notification_outbox purpose
                     where purpose.mail_message_id = mail.id
                       and purpose.state = 'held'
                       and not purpose.provider_effects_authorized
                       and not purpose.delivery_claimed
                  )
                )
                and not exists (
                  select 1
                    from ss.hosted_mail_dispatch_claims claim
                   where claim.message_id = mail.id
                     and (
                       claim.state = 'closed'
                       or claim.lease_expires_at > $1::timestamptz
                     )
                )
              order by mail.requested_at, mail.id
              limit $2`,
            [observedAt, input.limit]
          )
        );
        invariant(
          Array.isArray(result?.rows) &&
            result.rows.length <= input.limit &&
            result.rows.every((row) => UUID.test(row?.id)) &&
            new Set(result.rows.map((row) => row.id)).size ===
              result.rows.length,
          "NOTIFICATION_DISPATCH_SOURCE_UNAVAILABLE",
          "The dispatch candidate query returned invalid identity.",
          { status: 503 }
        );
        return deepFreeze(result.rows.map((row) => row.id));
      });
    },

    async claimForDispatch(input) {
      exactObject(input, ["leaseMs", "messageId", "workerId"], "Dispatch claim");
      invariant(
        UUID.test(input.messageId) &&
          SAFE_WORKER.test(input.workerId) &&
          Number.isSafeInteger(input.leaseMs) &&
          input.leaseMs >= 30_000 &&
          input.leaseMs <= 300_000,
        "NOTIFICATION_DISPATCH_CLAIM_INVALID",
        "Dispatch claim identity or lease is invalid.",
        { status: 400 }
      );
      const claimedAt = selectedClock(clock);
      const leaseExpiresAt = new Date(
        Date.parse(claimedAt) + input.leaseMs
      ).toISOString();
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`mail-dispatch:${input.messageId}`]
          );
          const selected = await client.query(RESERVATION_SQL, [input.messageId]);
          invariant(
            selected.rowCount === 1,
            "NOTIFICATION_DISPATCH_SOURCE_UNAVAILABLE",
            "The mail reservation is unavailable.",
            { status: 404 }
          );
          const mail = selected.rows[0];
          const currentClaim = await client.query(
            `select * from ss.hosted_mail_dispatch_claims
              where message_id = $1 for update`,
            [input.messageId]
          );
          const existing = currentClaim.rows[0] ?? null;

          if (mail.state !== "pending") {
            if (existing && existing.state === "claimed") {
              await client.query(
                `update ss.hosted_mail_dispatch_claims
                    set state = 'closed', worker_id = null,
                        lease_started_at = null, lease_expires_at = null,
                        lifecycle_state = $2,
                        closure_evidence_digest = coalesce($3, $4),
                        closed_at = $5
                  where message_id = $1`,
                [
                  input.messageId,
                  mail.state,
                  mail.acceptance_evidence_digest,
                  mail.expiration_request_digest,
                  claimedAt
                ]
              );
            }
            return deepFreeze({
              status: "already_recorded",
              messageId: input.messageId,
              lifecycleState: mail.state,
              providerEffects: false
            });
          }
          if (Date.parse(mail.expires_at) <= Date.parse(leaseExpiresAt)) {
            return deepFreeze({
              status: "expired",
              messageId: input.messageId,
              lifecycleState: "pending",
              providerEffects: false
            });
          }
          const selectedSource = source(mail);
          const identity = claimIdentity(mail, selectedSource);

          if (existing) {
            invariant(
              existing.state === "claimed" &&
              existing.source_kind === selectedSource.kind &&
                existing.source_reservation_id === selectedSource.id &&
                existing.source_reservation_digest === selectedSource.digest &&
                existing.claim_command_id === identity.commandId,
              "NOTIFICATION_DISPATCH_CLAIM_CONFLICT",
              "The durable dispatch claim identity changed.",
              { status: 409 }
            );
            if (Date.parse(existing.lease_expires_at) > Date.parse(claimedAt)) {
              if (existing.worker_id === input.workerId) {
                return claimReceipt(mail, selectedSource, existing);
              }
              return deepFreeze({
                status: "busy",
                messageId: input.messageId,
                busyUntil: iso(existing.lease_expires_at),
                providerEffects: false
              });
            }
            const reclaimed = await client.query(
              `update ss.hosted_mail_dispatch_claims
                  set worker_id = $2,
                      attempt_number = attempt_number + 1,
                      fence_token = fence_token + 1,
                      lease_started_at = $3, lease_expires_at = $4
                where message_id = $1
                returning *`,
              [input.messageId, input.workerId, claimedAt, leaseExpiresAt]
            );
            return claimReceipt(mail, selectedSource, reclaimed.rows[0]);
          }

          const inserted = await client.query(
            `insert into ss.hosted_mail_dispatch_claims (
               message_id, source_kind, source_reservation_id,
               source_reservation_digest, claim_command_id,
               claim_request_digest, state, worker_id,
               attempt_number, fence_token, lease_started_at,
               lease_expires_at, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5,
               ss.hosted_mail_dispatch_claim_digest($1, $2, $3, $4),
               'claimed', $6, 1, 1, $7, $8, $7, $7
             ) returning *`,
            [
              input.messageId,
              selectedSource.kind,
              selectedSource.id,
              selectedSource.digest,
              identity.commandId,
              input.workerId,
              claimedAt,
              leaseExpiresAt
            ]
          );
          return claimReceipt(mail, selectedSource, inserted.rows[0]);
        }
      ));
    },

    async completeDispatch(input) {
      exactObject(
        input,
        ["closureEvidenceDigest", "fenceToken", "messageId", "workerId"],
        "Dispatch completion"
      );
      invariant(
        UUID.test(input.messageId) &&
          SAFE_WORKER.test(input.workerId) &&
          Number.isSafeInteger(input.fenceToken) &&
          input.fenceToken >= 1 &&
          /^[0-9a-f]{64}$/u.test(input.closureEvidenceDigest),
        "NOTIFICATION_DISPATCH_CLAIM_INVALID",
        "Dispatch completion evidence is invalid.",
        { status: 400 }
      );
      const completedAt = selectedClock(clock);
      return translated(() => database.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`mail-dispatch:${input.messageId}`]
          );
          const selected = await client.query(
            `select claim.*, mail.state as mail_state,
                    mail.acceptance_evidence_digest,
                    mail.expiration_request_digest
               from ss.hosted_mail_dispatch_claims claim
               join ss.hosted_mail_deliveries mail
                 on mail.id = claim.message_id
              where claim.message_id = $1
              for update of claim, mail`,
            [input.messageId]
          );
          invariant(
            selected.rowCount === 1,
            "NOTIFICATION_DISPATCH_CLAIM_UNAVAILABLE",
            "The durable dispatch claim is unavailable.",
            { status: 409 }
          );
          const row = selected.rows[0];
          const authoritativeEvidence = row.acceptance_evidence_digest ??
            row.expiration_request_digest;
          if (row.state === "closed") {
            invariant(
              Number(row.fence_token) === input.fenceToken &&
                row.closure_evidence_digest === input.closureEvidenceDigest,
              "NOTIFICATION_DISPATCH_CLAIM_CONFLICT",
              "The dispatch completion evidence changed.",
              { status: 409 }
            );
            return deepFreeze({
              status: "closed",
              messageId: input.messageId,
              lifecycleState: row.lifecycle_state,
              fenceToken: Number(row.fence_token),
              providerEffects: false
            });
          }
          invariant(
            row.worker_id === input.workerId &&
              Number(row.fence_token) === input.fenceToken &&
              row.mail_state !== "pending" &&
              authoritativeEvidence === input.closureEvidenceDigest,
            "NOTIFICATION_DISPATCH_CLAIM_CONFLICT",
            "Dispatch completion lost its lease or MAIL-01 evidence.",
            { status: 409 }
          );
          const closed = await client.query(
            `update ss.hosted_mail_dispatch_claims
                set state = 'closed', worker_id = null,
                    lease_started_at = null, lease_expires_at = null,
                    lifecycle_state = $2,
                    closure_evidence_digest = $3, closed_at = $4
              where message_id = $1
              returning *`,
            [
              input.messageId,
              row.mail_state,
              input.closureEvidenceDigest,
              completedAt
            ]
          );
          return deepFreeze({
            status: "closed",
            messageId: input.messageId,
            lifecycleState: closed.rows[0].lifecycle_state,
            fenceToken: Number(closed.rows[0].fence_token),
            providerEffects: false
          });
        }
      ));
    }
  });
}
