import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_KINDS = new Set([
  "abandoned_claim", "stale_delivery_status", "unmatched_provider_event",
  "suppression_conflict", "unbound_inbound_event", "ambiguous_number_binding",
  "ambiguous_message_create"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const READBACK_STATES = new Set([
  "matched", "single_candidate", "not_found", "multiple_matches"
]);
const AMBIGUOUS_CREATE_FAILURES = Object.freeze([
  "TWILIO_RESPONDER_DELIVERY_UNCERTAIN",
  "TWILIO_RESPONDER_DELIVERY_REJECTED",
  "TWILIO_RESPONDER_RECEIPT_INVALID",
  "TWILIO_RESPONDER_RESPONSE_INVALID"
]);
const CONTRACT =
  "canonical-provider-reconciliation-v1-readback-evidence-bound";

function sha256(value, field, { nullable = false } = {}) {
  invariant(
    (nullable && value === null) ||
      (typeof value === "string" && SHA256.test(value)),
    "PROVIDER_RECONCILIATION_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "PROVIDER_RECONCILIATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function iso(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "PROVIDER_RECONCILIATION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "PROVIDER_RECONCILIATION_UNAVAILABLE",
      "Provider reconciliation state is unavailable.",
      { status: 503 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "PROVIDER_RECONCILIATION_RETRY_REQUIRED",
      "Provider reconciliation state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "PROVIDER_RECONCILIATION_CONFLICT",
      "Provider reconciliation evidence conflicts.",
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

function caseReceipt(row, { replayed = false } = {}) {
  return deepFreeze({
    schema: "sitesourcery.provider-reconciliation-case-receipt/v1",
    id: row.id,
    provider: row.provider,
    caseKind: row.case_kind,
    caseDigest: row.case_digest,
    state: row.state,
    readbackState: row.readback_state,
    readbackMatchedProviderMessageIdDigest:
      row.readback_matched_provider_message_id_digest ?? null,
    readbackMatchCount: row.readback_match_count === null ||
      row.readback_match_count === undefined
      ? null
      : Number(row.readback_match_count),
    resolutionKind: row.resolution_kind ?? null,
    replayed,
    providerEffects: false
  });
}

function readbackCandidate(row) {
  const providerMessageIdDigest = sha256(
    row.subject_provider_message_id_digest ?? null,
    "Readback provider message ID digest",
    { nullable: true }
  );
  const shapeTarget = row.case_kind === "abandoned_claim" ||
    row.case_kind === "ambiguous_message_create";
  const routeDigest = sha256(
    row.route_digest ?? null,
    "Readback route digest",
    { nullable: !shapeTarget }
  );
  const contentDigest = sha256(
    row.content_digest ?? null,
    "Readback content digest",
    { nullable: !shapeTarget }
  );
  invariant(
    (providerMessageIdDigest !== null && !shapeTarget) ||
      (providerMessageIdDigest === null && shapeTarget &&
        routeDigest !== null && contentDigest !== null),
    "PROVIDER_RECONCILIATION_REPOSITORY_INVALID",
    "The reconciliation readback target is invalid.",
    { status: 500 }
  );
  const target = providerMessageIdDigest === null
    ? deepFreeze({
        kind: "responder_message_shape",
        routeDigest,
        contentDigest
      })
    : deepFreeze({
        kind: "provider_message_id",
        providerMessageIdDigest
      });
  return deepFreeze({
    caseId: uuid(row.id, "Readback case ID"),
    caseKind: row.case_kind,
    target,
    targetDigest: digest({
      schema: "sitesourcery.twilio-readback-target/v1",
      ...target
    }),
    attemptAt: iso(row.attempt_at, "Readback attempt time"),
    openedAt: iso(row.opened_at, "Readback case open time")
  });
}

export function createPostgresProviderReconciliationRepository({
  authority,
  randomUUID = systemRandomUUID,
  staleAfterMs = 30 * 60 * 1000,
  abandonedLeaseGraceMs = 60 * 1000
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function" &&
      Number.isSafeInteger(staleAfterMs) &&
      staleAfterMs >= 60_000 && staleAfterMs <= 24 * 60 * 60 * 1000 &&
      Number.isSafeInteger(abandonedLeaseGraceMs) &&
      abandonedLeaseGraceMs >= 0 && abandonedLeaseGraceMs <= 60 * 60 * 1000,
    "PROVIDER_RECONCILIATION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for provider reconciliation.",
    { status: 500 }
  );

  async function openCase(client, {
    caseKind, subject, worker, evidence, binding
  }) {
    invariant(
      CASE_KINDS.has(caseKind),
      "PROVIDER_RECONCILIATION_REPOSITORY_INVALID",
      "The reconciliation case kind is invalid.",
      { status: 500 }
    );
    const inserted = await client.query(
      `insert into ss.provider_reconciliation_cases (
       id, provider, case_kind, case_digest, subject_operation_id,
         subject_inbound_event_id, subject_provider_message_id_digest,
         subject_phone_number_sid_digest, subject_operation_attempt,
         subject_lease_owner_digest, organization_id, project_id,
         evidence_digest, detected_by_worker_id, readback_state, state,
         revision, opened_at, created_at, updated_at
       ) values (
         $1, 'twilio', $2,
         ss.provider_reconciliation_case_digest('twilio', $2, $3),
         $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'none', 'open', 1,
         $14, $14, $14
       )
       on conflict (case_digest) do nothing
       returning *`,
      [
        randomUUID(), caseKind, subject,
        binding.operationId ?? null, binding.inboundEventId ?? null,
        binding.providerMessageIdDigest ?? null,
        binding.phoneNumberSidDigest ?? null,
        binding.operationAttempt ?? null,
        binding.leaseOwnerDigest ?? null,
        binding.organizationId ?? null, binding.projectId ?? null,
        evidence, worker, binding.openedAt
      ]
    );
    return inserted.rowCount === 1;
  }

  return Object.freeze({
    kind: "provider-reconciliation-postgres",
    providerEffects: false,
    staleAfterMs,
    abandonedLeaseGraceMs,

    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_provider_reconciliation_contract_v1()'
              ) is not null
              and ss.hosted_provider_reconciliation_contract_v1() = $1
                as contract_ready,
              (select count(*) = 2
                 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname = any($2::text[])
              ) as tables_ready
          `, [CONTRACT, [
            "provider_reconciliation_cases",
            "responder_inbound_resolutions"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.tables_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "provider-reconciliation-postgres",
          providerEffects: false,
          code: ready ? null : "PROVIDER_RECONCILIATION_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "provider-reconciliation-postgres",
          providerEffects: false,
          code: "PROVIDER_RECONCILIATION_STORAGE_NOT_READY"
        });
      }
    },

    // Detection is one read-only pass that opens durable, digest-idempotent
    // cases. It performs the one provably-safe self-heal — re-running the
    // proved, idempotent delivery-event reconciler for accepted operations
    // whose pending events never applied — and never retries a provider
    // create or fabricates an effect.
    runDetection({ workerId, observedAt } = {}) {
      const selectedWorker = workerId;
      const selectedObservedAt = iso(observedAt, "Observation time");
      invariant(
        typeof selectedWorker === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(selectedWorker),
        "PROVIDER_RECONCILIATION_INVALID",
        "The reconciliation worker ID is invalid.",
        { status: 400 }
      );
      const staleBefore = new Date(
        Date.parse(selectedObservedAt) - staleAfterMs
      ).toISOString();
      const abandonedBefore = new Date(
        Date.parse(selectedObservedAt) - abandonedLeaseGraceMs
      ).toISOString();
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const counters = {
            abandonedClaim: 0,
            ambiguousMessageCreate: 0,
            staleDeliveryStatus: 0,
            unmatchedProviderEvent: 0,
            unboundInboundEvent: 0,
            selfHealedProjections: 0
          };

          const abandoned = await client.query(
            `select operation.id, operation.organization_id,
                    operation.project_id, operation.last_worker_id,
                    operation.lease_owner, operation.lease_expires_at,
                    operation.attempt_count
               from ss.responder_delivery_operations operation
              where operation.state = 'claimed'
                and operation.lease_expires_at < $1
              order by operation.lease_expires_at, operation.id
              limit 200`,
            [abandonedBefore]
          );
          for (const row of abandoned.rows) {
            const leaseOwnerDigest = digest(String(row.lease_owner));
            const attemptCount = Number(row.attempt_count);
            const opened = await openCase(client, {
              caseKind: "abandoned_claim",
              subject: `${row.id}:${attemptCount}:${leaseOwnerDigest}`,
              worker: selectedWorker,
              evidence: digest({
                schema: "sitesourcery.reconciliation-abandoned-claim/v1",
                operationId: String(row.id),
                leaseExpiresAt: row.lease_expires_at instanceof Date
                  ? row.lease_expires_at.toISOString()
                  : String(row.lease_expires_at),
                attemptCount,
                leaseOwnerDigest
              }),
              binding: {
                operationId: row.id,
                operationAttempt: attemptCount,
                leaseOwnerDigest,
                organizationId: row.organization_id,
                projectId: row.project_id,
                openedAt: selectedObservedAt
              }
            });
            if (opened) counters.abandonedClaim += 1;
          }

          const stale = await client.query(
            `select projection.operation_id, projection.organization_id,
                    projection.provider_message_id_digest,
                    projection.current_status, projection.accepted_at,
                    operation.project_id
               from ss.responder_delivery_provider_statuses projection
               join ss.responder_delivery_operations operation
                 on operation.id = projection.operation_id
              where not projection.terminal
                and projection.accepted_at < $1
              order by projection.accepted_at, projection.operation_id
              limit 200`,
            [staleBefore]
          );
          for (const row of stale.rows) {
            await client.query(
              `select ss.reconcile_responder_delivery_provider_events($1)`,
              [row.provider_message_id_digest]
            );
            const recheck = await client.query(
              `select terminal from ss.responder_delivery_provider_statuses
                where operation_id = $1`,
              [row.operation_id]
            );
            if (recheck.rows[0]?.terminal === true) {
              counters.selfHealedProjections += 1;
              continue;
            }
            const opened = await openCase(client, {
              caseKind: "stale_delivery_status",
              subject: String(row.operation_id),
              worker: selectedWorker,
              evidence: digest({
                schema: "sitesourcery.reconciliation-stale-status/v1",
                operationId: String(row.operation_id),
                currentStatus: row.current_status,
                providerMessageIdDigest: row.provider_message_id_digest
              }),
              binding: {
                operationId: row.operation_id,
                providerMessageIdDigest: row.provider_message_id_digest,
                organizationId: row.organization_id,
                projectId: row.project_id,
                openedAt: selectedObservedAt
              }
            });
            if (opened) counters.staleDeliveryStatus += 1;
          }

          // A provider create whose response was lost or malformed is never
          // retried. The terminal manual-review operation becomes a bounded
          // message-shape readback target, using only its already-authorized
          // route/content digests outside the private material boundary.
          const ambiguousCreates = await client.query(
            `select operation.id, operation.organization_id,
                    operation.project_id, operation.attempt_count,
                    operation.failure_code
               from ss.responder_delivery_operations operation
              where operation.state = 'manual_review'
                and operation.provider_message_id_digest is null
                and operation.failure_code = any($1::text[])
              order by operation.manual_review_at, operation.id
              limit 200`,
            [AMBIGUOUS_CREATE_FAILURES]
          );
          for (const row of ambiguousCreates.rows) {
            const attemptCount = Number(row.attempt_count);
            const opened = await openCase(client, {
              caseKind: "ambiguous_message_create",
              subject: String(row.id),
              worker: selectedWorker,
              evidence: digest({
                schema: "sitesourcery.reconciliation-ambiguous-create/v1",
                operationId: String(row.id),
                attemptCount,
                failureCode: String(row.failure_code)
              }),
              binding: {
                operationId: row.id,
                operationAttempt: attemptCount,
                organizationId: row.organization_id,
                projectId: row.project_id,
                openedAt: selectedObservedAt
              }
            });
            if (opened) counters.ambiguousMessageCreate += 1;
          }

          const unmatched = await client.query(
            `select event.provider_message_id_digest
               from ss.responder_delivery_provider_events event
              where event.event_state = 'pending'
                and event.received_at < $1
                and not exists (
                  select 1 from ss.responder_delivery_operations operation
                   where operation.provider = 'twilio'
                     and operation.provider_message_id_digest =
                       event.provider_message_id_digest
                )
              group by event.provider_message_id_digest
              order by event.provider_message_id_digest
              limit 200`,
            [staleBefore]
          );
          for (const row of unmatched.rows) {
            const opened = await openCase(client, {
              caseKind: "unmatched_provider_event",
              subject: row.provider_message_id_digest,
              worker: selectedWorker,
              evidence: digest({
                schema: "sitesourcery.reconciliation-unmatched-event/v1",
                providerMessageIdDigest: row.provider_message_id_digest
              }),
              binding: {
                providerMessageIdDigest: row.provider_message_id_digest,
                openedAt: selectedObservedAt
              }
            });
            if (opened) counters.unmatchedProviderEvent += 1;
          }

          const unbound = await client.query(
            `select inbound.id
               from ss.responder_twilio_inbound_events inbound
              where inbound.state = 'unbound'
                and inbound.received_at < $1
                and not exists (
                  select 1 from ss.responder_inbound_resolutions resolution
                   where resolution.inbound_event_id = inbound.id
                )
              order by inbound.received_at, inbound.id
              limit 200`,
            [staleBefore]
          );
          for (const row of unbound.rows) {
            const opened = await openCase(client, {
              caseKind: "unbound_inbound_event",
              subject: String(row.id),
              worker: selectedWorker,
              evidence: digest({
                schema: "sitesourcery.reconciliation-unbound-inbound/v1",
                inboundEventId: String(row.id)
              }),
              binding: {
                inboundEventId: row.id,
                openedAt: selectedObservedAt
              }
            });
            if (opened) counters.unboundInboundEvent += 1;
          }

          // The same-resource cross-keyring duplicate the FIN-004Q review
          // flagged is prevented at write time by the active
          // phone-number-resource unique index, so no active GROUP BY over
          // phone_number_sid_digest can ever surface it. The residual
          // different-resource/same-dialable-number case is not derivable
          // from stored keyed digests without the raw number; the inbound
          // resolver fails that closed as an explicit ambiguity conflict and
          // readiness coverage flags an uncovered key version. The
          // `ambiguous_number_binding` case kind remains available for the
          // inbound-resolver-recorded path in a later cohort.

          return deepFreeze({
            schema: "sitesourcery.provider-reconciliation-detection/v1",
            observedAt: selectedObservedAt,
            providerEffects: false,
            openedCases: counters.abandonedClaim +
              counters.ambiguousMessageCreate +
              counters.staleDeliveryStatus +
              counters.unmatchedProviderEvent +
              counters.unboundInboundEvent,
            counters: deepFreeze(counters)
          });
        }
      ));
    },

    // The abandoned dead worker's claim is moved to manual review while
    // preserving its lease-owner identity, which is exactly what the proved
    // migration-125 guard permits. No provider effect and no retry occur.
    escalateAbandonedClaim({ caseId, escalatedAt } = {}) {
      const selectedCaseId = uuid(caseId, "Case ID");
      const selectedAt = iso(escalatedAt, "Escalation time");
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const selected = await client.query(
            `select reconciliation.id, reconciliation.state,
                    reconciliation.subject_operation_id,
                    reconciliation.subject_operation_attempt,
                    reconciliation.subject_lease_owner_digest,
                    operation.state as operation_state,
                    operation.lease_owner, operation.last_worker_id,
                    operation.attempt_count, operation.lease_expires_at
               from ss.provider_reconciliation_cases reconciliation
               join ss.responder_delivery_operations operation
                 on operation.id = reconciliation.subject_operation_id
              where reconciliation.id = $1
                and reconciliation.case_kind = 'abandoned_claim'
              for update of reconciliation`,
            [selectedCaseId]
          );
          invariant(
            selected.rowCount === 1,
            "PROVIDER_RECONCILIATION_UNAVAILABLE",
            "The reconciliation case is unavailable.",
            { status: 404 }
          );
          const row = selected.rows[0];
          if (row.operation_state === "manual_review") {
            return deepFreeze({ status: "already_escalated" });
          }
          invariant(
            row.operation_state === "claimed" && row.lease_owner !== null &&
              Number(row.attempt_count) ===
                Number(row.subject_operation_attempt) &&
              digest(String(row.lease_owner)) ===
                row.subject_lease_owner_digest &&
              Date.parse(iso(row.lease_expires_at, "Stored lease expiration")) <
                Date.parse(selectedAt) - abandonedLeaseGraceMs,
            "PROVIDER_RECONCILIATION_RETRY_REQUIRED",
            "The abandoned claim changed; refresh and retry safely.",
            { status: 409 }
          );
          const moved = await client.query(
            `update ss.responder_delivery_operations
                set state = 'manual_review',
                    provider_effects_authorized = false,
                    available_at = null, lease_owner = null,
                    lease_started_at = null, lease_expires_at = null,
                    last_worker_id = $2,
                    failure_code = 'RESPONDER_DELIVERY_ABANDONED_CLAIM',
                    manual_review_at = $3, updated_at = $3
              where id = $1 and state = 'claimed' and lease_owner = $2
                and attempt_count = $4 and lease_expires_at < $5
              returning id`,
            [
              row.subject_operation_id, row.lease_owner, selectedAt,
              Number(row.subject_operation_attempt),
              new Date(
                Date.parse(selectedAt) - abandonedLeaseGraceMs
              ).toISOString()
            ]
          );
          invariant(
            moved.rowCount === 1,
            "PROVIDER_RECONCILIATION_RETRY_REQUIRED",
            "The abandoned claim changed; refresh and retry safely.",
            { status: 409 }
          );
          return deepFreeze({ status: "escalated" });
        }
      ));
    },

    recordReadback({ caseId, readbackState, readbackEvidenceDigest,
      matchedProviderMessageIdDigest = null, matchCount,
      observedAt } = {}) {
      const selectedCaseId = uuid(caseId, "Case ID");
      const selectedAt = iso(observedAt, "Readback time");
      invariant(
        READBACK_STATES.has(readbackState),
        "PROVIDER_RECONCILIATION_INVALID",
        "The readback state is invalid.",
        { status: 400 }
      );
      const evidence = sha256(
        readbackEvidenceDigest, "Readback evidence digest"
      );
      const matchedDigest = sha256(
        matchedProviderMessageIdDigest,
        "Matched provider message ID digest",
        { nullable: true }
      );
      invariant(
        Number.isSafeInteger(matchCount) && matchCount >= 0 &&
          matchCount <= 500 && (
            (["matched", "single_candidate"].includes(readbackState) &&
              matchCount === 1 &&
              matchedDigest !== null) ||
            (readbackState === "not_found" && matchCount === 0 &&
              matchedDigest === null) ||
            (readbackState === "multiple_matches" && matchCount >= 2 &&
              matchedDigest === null)
          ),
        "PROVIDER_RECONCILIATION_INVALID",
        "The readback match evidence is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const locked = await client.query(
            `select * from ss.provider_reconciliation_cases
              where id = $1 for update`,
            [selectedCaseId]
          );
          invariant(
            locked.rowCount === 1,
            "PROVIDER_RECONCILIATION_UNAVAILABLE",
            "The reconciliation case is unavailable.",
            { status: 404 }
          );
          const existing = locked.rows[0];
          if (existing.readback_state !== "none" || existing.state !== "open") {
            invariant(
              existing.readback_state === readbackState &&
                existing.readback_evidence_digest === evidence &&
                (existing.readback_matched_provider_message_id_digest ??
                  null) === matchedDigest &&
                Number(existing.readback_match_count) === matchCount,
              "PROVIDER_RECONCILIATION_CONFLICT",
              "The reconciliation case carries different readback evidence.",
              { status: 409 }
            );
            return caseReceipt(existing, { replayed: true });
          }
          const changed = await client.query(
            `update ss.provider_reconciliation_cases
                set readback_state = $2, readback_evidence_digest = $3,
                    readback_matched_provider_message_id_digest = $4,
                    readback_match_count = $5, readback_at = $6,
                    revision = revision + 1, updated_at = $6
              where id = $1 and state = 'open' and readback_state = 'none'
              returning *`,
            [
              selectedCaseId, readbackState, evidence, matchedDigest,
              matchCount, selectedAt
            ]
          );
          invariant(
            changed.rowCount === 1,
            "PROVIDER_RECONCILIATION_RETRY_REQUIRED",
            "The reconciliation case already carries readback evidence.",
            { status: 409 }
          );
          return caseReceipt(changed.rows[0]);
        }
      ));
    },

    resolveBySelfHeal({ caseId, resolutionEvidenceDigest, resolvedAt } = {}) {
      const selectedCaseId = uuid(caseId, "Case ID");
      const selectedAt = iso(resolvedAt, "Resolution time");
      const evidence = sha256(
        resolutionEvidenceDigest, "Resolution evidence digest"
      );
      return translated(() => authority.service(
        { actorKind: "system", isolation: "serializable" },
        async (client) => {
          const changed = await client.query(
            `update ss.provider_reconciliation_cases
                set state = 'resolved', resolution_kind = 'self_healed',
                    resolution_evidence_digest = $2, resolved_at = $3,
                    revision = revision + 1, updated_at = $3
              where id = $1 and state = 'open'
              returning *`,
            [selectedCaseId, evidence, selectedAt]
          );
          invariant(
            changed.rowCount === 1,
            "PROVIDER_RECONCILIATION_RETRY_REQUIRED",
            "The reconciliation case is no longer open.",
            { status: 409 }
          );
          return caseReceipt(changed.rows[0]);
        }
      ));
    },

    listReadbackCandidates({ limit = 8 } = {}) {
      invariant(
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 64,
        "PROVIDER_RECONCILIATION_INVALID",
        "The reconciliation readback candidate bound is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        { actorKind: "system", readOnly: true },
        async (client) => {
          const rows = await client.query(
            `select reconciliation.id, reconciliation.case_kind,
                    reconciliation.subject_provider_message_id_digest,
                    reconciliation.opened_at,
                    operation.route_digest, operation.content_digest,
                    coalesce(operation.provider_accepted_at,
                             attempt.occurred_at, operation.created_at,
                             reconciliation.opened_at) as attempt_at
               from ss.provider_reconciliation_cases reconciliation
               left join ss.responder_delivery_operations operation
                 on operation.id = reconciliation.subject_operation_id
               left join lateral (
                 select event.occurred_at
                   from ss.responder_delivery_operation_events event
                  where event.operation_id =
                          reconciliation.subject_operation_id
                    and event.state = 'claimed'
                    and event.attempt_count =
                          reconciliation.subject_operation_attempt
                  order by event.occurred_at desc, event.id desc
                  limit 1
               ) attempt on true
              where reconciliation.state = 'open'
                and reconciliation.readback_state = 'none'
                and (
                  reconciliation.subject_provider_message_id_digest
                    is not null
                  or reconciliation.case_kind in (
                    'abandoned_claim', 'ambiguous_message_create'
                  )
                )
              order by reconciliation.opened_at, reconciliation.id
              limit $1`,
            [limit]
          );
          return deepFreeze({
            schema:
              "sitesourcery.provider-reconciliation-readback-list/v1",
            providerEffects: false,
            candidates: rows.rows.map(readbackCandidate)
          });
        }
      ));
    },

    listOpenCases({ limit = 200 } = {}) {
      invariant(
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 500,
        "PROVIDER_RECONCILIATION_INVALID",
        "The reconciliation list bound is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        { actorKind: "system", readOnly: true },
        async (client) => {
          const rows = await client.query(
            `select * from ss.provider_reconciliation_cases
              where state = 'open'
              order by opened_at, id
              limit $1`,
            [limit]
          );
          return deepFreeze({
            schema: "sitesourcery.provider-reconciliation-open-list/v1",
            providerEffects: false,
            cases: rows.rows.map((row) => caseReceipt(row))
          });
        }
      ));
    }
  });
}
