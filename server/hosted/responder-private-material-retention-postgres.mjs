import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const WORKER_ID = /^responder-retention-[A-Za-z0-9.-]{8,160}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SCOPES = new Set([
  "project", "delivery_material", "inbound_material"
]);
const HOLD_KINDS = new Set(["legal", "retention"]);
const MATERIAL_KINDS = new Set([
  "delivery_material", "inbound_material"
]);
const DESTROY_REASONS = new Set([
  "accepted_retention", "opt_out", "cancellation", "account_deletion",
  "manual_reconciliation_closed"
]);
const CONTRACT =
  "canonical-responder-private-material-retention-v1-held-leased-zeroing";
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function exactObject(value, fields, label) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...fields].sort()),
    "RESPONDER_RETENTION_INVALID",
    `${label} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_RETENTION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_RETENTION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function iso(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "RESPONDER_RETENTION_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function worker(value) {
  invariant(
    typeof value === "string" && WORKER_ID.test(value),
    "RESPONDER_RETENTION_INVALID",
    "Responder retention worker identity is invalid.",
    { status: 400 }
  );
  return value;
}

function integer(value, field, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "RESPONDER_RETENTION_INVALID",
    `${field} is outside its bounded range.`,
    { status: 400 }
  );
  return value;
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_RETENTION_RETRY_REQUIRED",
      "Responder private-material retention changed; retry safely.",
      { status: 409 }
    );
  }
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_RETENTION_UNAVAILABLE",
      "Responder private-material retention is unavailable.",
      { status: 503 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_RETENTION_CONFLICT",
      "Responder private-material retention evidence conflicts.",
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

function holdInput(value) {
  const selected = exactObject(value, [
    "holdId", "organizationId", "projectId", "scopeKind", "subjectId",
    "holdKind", "evidenceDigest", "holdUntil", "operatorUserId", "placedAt"
  ], "Responder private-material hold");
  invariant(
    SCOPES.has(selected.scopeKind) && HOLD_KINDS.has(selected.holdKind) &&
      ((selected.holdKind === "legal" && selected.holdUntil === null) ||
        (selected.holdKind === "retention" && selected.holdUntil !== null)),
    "RESPONDER_RETENTION_INVALID",
    "Responder private-material hold scope is invalid.",
    { status: 400 }
  );
  const placedAt = iso(selected.placedAt, "Hold placement time");
  const holdUntil = iso(selected.holdUntil, "Hold expiration", {
    nullable: true
  });
  invariant(
    holdUntil === null || Date.parse(holdUntil) > Date.parse(placedAt),
    "RESPONDER_RETENTION_INVALID",
    "Responder retention hold must end after placement.",
    { status: 400 }
  );
  return Object.freeze({
    holdId: uuid(selected.holdId, "Hold ID"),
    organizationId: uuid(selected.organizationId, "Hold organization ID"),
    projectId: uuid(selected.projectId, "Hold project ID"),
    scopeKind: selected.scopeKind,
    subjectId: uuid(selected.subjectId, "Hold subject ID"),
    holdKind: selected.holdKind,
    evidenceDigest: sha256(selected.evidenceDigest, "Hold evidence digest"),
    holdUntil,
    operatorUserId: uuid(selected.operatorUserId, "Hold operator user ID"),
    placedAt
  });
}

function releaseInput(value) {
  const selected = exactObject(value, [
    "holdId", "organizationId", "operatorUserId", "releaseEvidenceDigest",
    "releasedAt"
  ], "Responder private-material hold release");
  return Object.freeze({
    holdId: uuid(selected.holdId, "Hold ID"),
    organizationId: uuid(selected.organizationId, "Hold organization ID"),
    operatorUserId: uuid(selected.operatorUserId, "Hold operator user ID"),
    releaseEvidenceDigest: sha256(
      selected.releaseEvidenceDigest,
      "Hold release evidence digest"
    ),
    releasedAt: iso(selected.releasedAt, "Hold release time")
  });
}

function holdReceipt(row, replayed) {
  return deepFreeze({
    schema: "sitesourcery.responder-private-material-hold-receipt/v1",
    holdId: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    scopeKind: row.scope_kind,
    subjectId: row.subject_id,
    holdKind: row.hold_kind,
    evidenceDigest: row.evidence_digest,
    state: row.state,
    holdUntil: row.hold_until === null || row.hold_until === undefined
      ? null
      : iso(row.hold_until, "Stored hold expiration"),
    releaseEvidenceDigest: row.release_evidence_digest ?? null,
    replayed,
    providerEffects: false
  });
}

function claimReceipt(row) {
  invariant(
    MATERIAL_KINDS.has(row.material_kind) &&
      DESTROY_REASONS.has(row.discovered_reason) &&
      WORKER_ID.test(row.lease_owner) && SHA256.test(row.source_envelope_digest),
    "RESPONDER_RETENTION_REPOSITORY_INVALID",
    "Responder retention claim is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: "sitesourcery.responder-private-material-cleanup-claim/v1",
    jobId: row.id,
    materialKind: row.material_kind,
    subjectId: row.subject_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sourceEnvelopeDigest: row.source_envelope_digest,
    discoveredReason: row.discovered_reason,
    attemptCount: Number(row.attempt_count),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at, "Cleanup lease expiration"),
    providerEffects: false
  });
}

function destructionReceipt(row, replayed) {
  invariant(
    MATERIAL_KINDS.has(row.material_kind) &&
      DESTROY_REASONS.has(row.destroy_reason) &&
      SHA256.test(row.source_envelope_digest) && SHA256.test(row.receipt_digest),
    "RESPONDER_RETENTION_REPOSITORY_INVALID",
    "Responder destruction receipt is invalid.",
    { status: 500 }
  );
  return deepFreeze({
    schema: "sitesourcery.responder-private-material-destruction/v1",
    cleanupJobId: row.cleanup_job_id,
    materialKind: row.material_kind,
    subjectId: row.subject_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    sourceEnvelopeDigest: row.source_envelope_digest,
    destroyReason: row.destroy_reason,
    primaryCiphertextZeroed: row.primary_ciphertext_zeroed === true,
    backupRetentionUntil: iso(
      row.backup_retention_until,
      "Backup retention horizon"
    ),
    receiptDigest: row.receipt_digest,
    destroyedAt: iso(row.destroyed_at, "Destruction time"),
    replayed,
    providerEffects: false
  });
}

function activeHoldSql(alias) {
  return `exists (
    select 1 from ss.responder_private_material_holds hold
     where hold.organization_id = ${alias}.organization_id
       and hold.project_id = ${alias}.project_id
       and hold.state = 'active'
       and (hold.hold_kind = 'legal' or hold.hold_until > $1::timestamptz)
       and (
         (hold.scope_kind = 'project'
           and hold.subject_id = ${alias}.project_id)
         or (hold.scope_kind = ${alias}.material_kind
           and hold.subject_id = ${alias}.subject_id)
       )
  )`;
}

export function createPostgresResponderPrivateMaterialRetentionRepository({
  authority,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function" &&
      typeof randomUUID === "function",
    "RESPONDER_RETENTION_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Responder retention.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const result = await authority.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(`
          select
            to_regprocedure(
              'ss.hosted_responder_private_material_retention_contract_v1()'
            ) is not null
            and ss.hosted_responder_private_material_retention_contract_v1()
              = $1 as contract_ready,
            (select count(*) = 5 and bool_and(relation.relrowsecurity)
                 and bool_and(relation.relforcerowsecurity)
               from pg_class relation
               join pg_namespace namespace on namespace.oid = relation.relnamespace
              where namespace.nspname = 'ss'
                and relation.relname = any($2::text[])) as tables_ready
        `, [CONTRACT, [
          "responder_private_delivery_materials",
          "responder_inbound_private_materials",
          "responder_private_material_holds",
          "responder_private_material_cleanup_jobs",
          "responder_private_material_destruction_receipts"
        ]])
      );
      const row = result.rows[0] ?? {};
      const ready = row.contract_ready === true && row.tables_ready === true;
      return deepFreeze({
        ready,
        verified: ready,
        kind: "responder-private-material-retention-postgres",
        providerEffects: false,
        decryptsMaterial: false,
        code: ready ? null : "RESPONDER_RETENTION_STORAGE_NOT_READY"
      });
    } catch {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "responder-private-material-retention-postgres",
        providerEffects: false,
        decryptsMaterial: false,
        code: "RESPONDER_RETENTION_STORAGE_NOT_READY"
      });
    }
  }

  async function placeHold(input) {
    const selected = holdInput(input);
    return translated(() => authority.service({
      actorKind: "operator",
      userId: selected.operatorUserId,
      organizationId: selected.organizationId,
      isolation: "serializable"
    }, async (client) => {
      const inserted = await client.query(
        `insert into ss.responder_private_material_holds (
           id, organization_id, project_id, scope_kind, subject_id,
           hold_kind, evidence_digest, state, hold_until,
           placed_by_operator_user_id, placed_at, revision, created_at,
           updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, 1, $10, $10
         ) on conflict (id) do nothing`,
        [
          selected.holdId, selected.organizationId, selected.projectId,
          selected.scopeKind, selected.subjectId, selected.holdKind,
          selected.evidenceDigest, selected.holdUntil,
          selected.operatorUserId, selected.placedAt
        ]
      );
      const retained = await client.query(
        `select * from ss.responder_private_material_holds where id = $1`,
        [selected.holdId]
      );
      const row = retained.rows[0] ?? {};
      invariant(
        retained.rowCount === 1 && row.organization_id === selected.organizationId &&
          row.project_id === selected.projectId &&
          row.scope_kind === selected.scopeKind &&
          row.subject_id === selected.subjectId &&
          row.hold_kind === selected.holdKind &&
          row.evidence_digest === selected.evidenceDigest &&
          row.placed_by_operator_user_id === selected.operatorUserId &&
          iso(row.placed_at, "Stored hold placement") === selected.placedAt &&
          (row.hold_until === null
            ? selected.holdUntil === null
            : iso(row.hold_until, "Stored hold expiration") ===
              selected.holdUntil),
        "RESPONDER_RETENTION_CONFLICT",
        "Responder private-material hold identity conflicts.",
        { status: 409 }
      );
      return holdReceipt(row, inserted.rowCount === 0);
    }));
  }

  async function releaseHold(input) {
    const selected = releaseInput(input);
    return translated(() => authority.service({
      actorKind: "operator",
      userId: selected.operatorUserId,
      organizationId: selected.organizationId,
      isolation: "serializable"
    }, async (client) => {
      const retained = await client.query(
        `select * from ss.responder_private_material_holds
          where id = $1 and organization_id = $2 for update`,
        [selected.holdId, selected.organizationId]
      );
      invariant(
        retained.rowCount === 1,
        "RESPONDER_RETENTION_NOT_FOUND",
        "Responder private-material hold was not found.",
        { status: 404 }
      );
      let row = retained.rows[0];
      if (row.state === "released") {
        invariant(
          row.released_by_operator_user_id === selected.operatorUserId &&
            row.release_evidence_digest === selected.releaseEvidenceDigest &&
            iso(row.released_at, "Stored hold release") === selected.releasedAt,
          "RESPONDER_RETENTION_CONFLICT",
          "Responder private-material hold release conflicts.",
          { status: 409 }
        );
        return holdReceipt(row, true);
      }
      const updated = await client.query(
        `update ss.responder_private_material_holds
            set state = 'released', released_by_operator_user_id = $2,
                release_evidence_digest = $3, released_at = $4,
                revision = revision + 1, updated_at = $4
          where id = $1 and state = 'active' returning *`,
        [
          selected.holdId, selected.operatorUserId,
          selected.releaseEvidenceDigest, selected.releasedAt
        ]
      );
      invariant(
        updated.rowCount === 1,
        "RESPONDER_RETENTION_RETRY_REQUIRED",
        "Responder private-material hold changed; retry safely.",
        { status: 409 }
      );
      row = updated.rows[0];
      return holdReceipt(row, false);
    }));
  }

  async function discoverEligible(input) {
    const selected = exactObject(input, ["workerId", "observedAt", "limit"],
      "Responder retention discovery");
    worker(selected.workerId);
    const observedAt = iso(selected.observedAt, "Discovery time");
    const limit = integer(selected.limit, "Discovery limit", 1, 500);
    const discoveryIds = Array.from({ length: limit }, () => randomUUID());
    discoveryIds.forEach((value) => uuid(value, "Cleanup discovery ID"));
    return translated(() => authority.service({
      actorKind: "system", isolation: "serializable"
    }, async (client) => {
      const result = await client.query(`
        with candidate as (
          select 'delivery_material'::text as material_kind,
                 material.operation_id as subject_id,
                 material.organization_id, material.project_id,
                 material.envelope_digest as source_envelope_digest,
                 ss.responder_private_material_destroy_reason(
                   'delivery_material', material.operation_id, $1
                 ) as discovered_reason
            from ss.responder_private_delivery_materials material
           where material.state = 'active'
          union all
          select 'inbound_material'::text as material_kind,
                 material.inbound_event_id as subject_id,
                 material.organization_id, material.project_id,
                 material.envelope_digest as source_envelope_digest,
                 ss.responder_private_material_destroy_reason(
                   'inbound_material', material.inbound_event_id, $1
                 ) as discovered_reason
            from ss.responder_inbound_private_materials material
           where material.state = 'active'
        ), eligible as (
          select candidate.*,
                 row_number() over (
                   order by candidate.material_kind, candidate.subject_id
                 )::integer as ordinal
            from candidate
           where candidate.discovered_reason is not null
             and not ${activeHoldSql("candidate")}
           order by candidate.material_kind, candidate.subject_id
           limit $2
        )
        insert into ss.responder_private_material_cleanup_jobs (
          id, material_kind, subject_id, organization_id, project_id,
          source_envelope_digest, discovered_reason, state, attempt_count,
          failure_count, available_at, revision, discovered_at, created_at,
          updated_at
        )
        select ($3::uuid[])[ordinal], material_kind, subject_id,
               organization_id, project_id, source_envelope_digest,
               discovered_reason, 'pending', 0, 0, $1, 1, $1, $1, $1
          from eligible
        on conflict (material_kind, subject_id) do nothing
        returning id
      `, [observedAt, limit, discoveryIds]);
      return deepFreeze({
        schema: "sitesourcery.responder-private-material-discovery/v1",
        discovered: result.rowCount,
        observedAt,
        providerEffects: false
      });
    }));
  }

  async function claimNext(input) {
    const selected = exactObject(input, [
      "workerId", "observedAt", "leaseSeconds"
    ], "Responder retention claim");
    const workerId = worker(selected.workerId);
    const observedAt = iso(selected.observedAt, "Claim time");
    const leaseSeconds = integer(
      selected.leaseSeconds,
      "Cleanup lease seconds",
      30,
      600
    );
    return translated(() => authority.service({
      actorKind: "system", isolation: "serializable"
    }, async (client) => {
      await client.query(`
        update ss.responder_private_material_cleanup_jobs
           set state = case when failure_count = 99
                 then 'manual_review' else 'pending' end,
               failure_count = failure_count + 1,
               available_at = $1,
               lease_owner = null, lease_started_at = null,
               lease_expires_at = null,
               last_failure_code = 'RESPONDER_RETENTION_LEASE_EXPIRED',
               manual_review_at = case when failure_count = 99
                 then $1::timestamptz else null::timestamptz end,
               revision = revision + 1, updated_at = $1
         where state = 'claimed' and lease_expires_at <= $1
           and failure_count < 100
      `, [observedAt]);
      const result = await client.query(`
        with selected as (
          select job.id
            from ss.responder_private_material_cleanup_jobs job
           where job.state = 'pending' and job.available_at <= $1
             and job.attempt_count < 100
             and job.failure_count < 100
             and ss.responder_private_material_destroy_reason(
               job.material_kind, job.subject_id, $1
             ) is not null
             and not ${activeHoldSql("job")}
           order by job.available_at, job.discovered_at, job.id
           for update skip locked
           limit 1
        )
        update ss.responder_private_material_cleanup_jobs job
           set state = 'claimed', attempt_count = job.attempt_count + 1,
               lease_owner = $2, lease_started_at = $1,
               lease_expires_at = $1 + make_interval(secs => $3),
               revision = job.revision + 1, updated_at = $1
          from selected
         where job.id = selected.id
        returning job.*
      `, [observedAt, workerId, leaseSeconds]);
      return result.rowCount === 0 ? null : claimReceipt(result.rows[0]);
    }));
  }

  async function destroyClaim(input) {
    const selected = exactObject(input, ["jobId", "workerId", "observedAt"],
      "Responder retention destruction");
    const jobId = uuid(selected.jobId, "Cleanup job ID");
    const workerId = worker(selected.workerId);
    const observedAt = iso(selected.observedAt, "Destruction time");

    const located = await translated(() => authority.service(
      { actorKind: "system", readOnly: true },
      (client) => client.query(
        `select job.*,
                job.id as selected_job_id, job.state as selected_job_state
           from ss.responder_private_material_cleanup_jobs job
          where job.id = $1`,
        [jobId]
      )
    ));
    invariant(
      located.rowCount === 1,
      "RESPONDER_RETENTION_NOT_FOUND",
      "Responder private-material cleanup job was not found.",
      { status: 404 }
    );
    const locatedRow = located.rows[0];
    if (locatedRow.selected_job_state === "succeeded") {
      const retainedReceipt = await translated(() => authority.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(
          `select * from ss.responder_private_material_destruction_receipts
            where cleanup_job_id = $1`,
          [jobId]
        )
      ));
      invariant(
        retainedReceipt.rowCount === 1,
        "RESPONDER_RETENTION_REPOSITORY_INVALID",
        "Responder destruction receipt is missing.",
        { status: 500 }
      );
      return destructionReceipt(retainedReceipt.rows[0], true);
    }
    const organizationId = uuid(
      locatedRow.organization_id,
      "Cleanup organization ID"
    );

    return translated(() => authority.service({
      actorKind: "system", organizationId, isolation: "serializable"
    }, async (client) => {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`sitesourcery.responder-private-material.project:${organizationId}:${locatedRow.project_id}`]
      );
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`sitesourcery.responder-private-material.subject:${organizationId}:${locatedRow.material_kind}:${locatedRow.subject_id}`]
      );
      const retained = await client.query(
        `select *, lease_expires_at > clock_timestamp() as lease_current
           from ss.responder_private_material_cleanup_jobs
          where id = $1 for update`,
        [jobId]
      );
      const job = retained.rows[0] ?? {};
      if (job.state === "succeeded") {
        const receipt = await client.query(
          `select * from ss.responder_private_material_destruction_receipts
            where cleanup_job_id = $1`,
          [jobId]
        );
        invariant(receipt.rowCount === 1,
          "RESPONDER_RETENTION_REPOSITORY_INVALID",
          "Responder destruction receipt is missing.", { status: 500 });
        return destructionReceipt(receipt.rows[0], true);
      }
      invariant(
        job.state === "claimed" && job.lease_owner === workerId &&
          job.lease_current === true &&
          iso(job.lease_expires_at, "Stored cleanup lease expiration") >
            observedAt,
        "RESPONDER_RETENTION_LEASE_LOST",
        "Responder private-material cleanup lease is unavailable.",
        { status: 409 }
      );
      const held = await client.query(`
        select 1 from ss.responder_private_material_holds hold
         where hold.organization_id = $1 and hold.project_id = $2
           and hold.state = 'active'
           and (hold.hold_kind = 'legal' or hold.hold_until > $5)
           and ((hold.scope_kind = 'project' and hold.subject_id = $2)
             or (hold.scope_kind = $3 and hold.subject_id = $4))
         limit 1
      `, [
        organizationId, job.project_id, job.material_kind, job.subject_id,
        observedAt
      ]);
      invariant(
        held.rowCount === 0,
        "RESPONDER_RETENTION_HELD",
        "Responder private-material destruction is held.",
        { status: 423 }
      );
      const reasonResult = await client.query(
        `select ss.responder_private_material_destroy_reason($1, $2, $3)
          as destroy_reason`,
        [job.material_kind, job.subject_id, observedAt]
      );
      const destroyReason = reasonResult.rows[0]?.destroy_reason ?? null;
      invariant(
        DESTROY_REASONS.has(destroyReason),
        "RESPONDER_RETENTION_NOT_ELIGIBLE",
        "Responder private material is not eligible for destruction.",
        { status: 409 }
      );

      const materialTable = job.material_kind === "delivery_material"
        ? "ss.responder_private_delivery_materials"
        : "ss.responder_inbound_private_materials";
      const subjectColumn = job.material_kind === "delivery_material"
        ? "operation_id"
        : "inbound_event_id";
      const material = await client.query(
        `select state, envelope_digest from ${materialTable}
          where ${subjectColumn} = $1 and organization_id = $2 for update`,
        [job.subject_id, organizationId]
      );
      invariant(
        material.rowCount === 1 && material.rows[0].state === "active" &&
          material.rows[0].envelope_digest === job.source_envelope_digest,
        "RESPONDER_RETENTION_CONFLICT",
        "Responder private-material envelope identity changed.",
        { status: 409 }
      );
      const zeroed = job.material_kind === "delivery_material"
        ? await client.query(`
            update ss.responder_private_delivery_materials
               set nonce = null, authentication_tag = null, ciphertext = null,
                   state = 'destroyed', destroy_reason = $3,
                   destroyed_at = $4, updated_at = greatest(updated_at, $4)
             where operation_id = $1 and organization_id = $2
               and state = 'active' and envelope_digest = $5
            returning operation_id`, [
              job.subject_id, organizationId, destroyReason, observedAt,
              job.source_envelope_digest
            ])
        : await client.query(`
            update ss.responder_inbound_private_materials
               set key_version = null, nonce = null,
                   authentication_tag = null, ciphertext = null,
                   envelope_digest = null, state = 'destroyed',
                   destroy_reason = $3, destroyed_at = $4,
                   updated_at = greatest(updated_at, $4)
             where inbound_event_id = $1 and organization_id = $2
               and state = 'active' and envelope_digest = $5
            returning inbound_event_id`, [
              job.subject_id, organizationId, destroyReason, observedAt,
              job.source_envelope_digest
            ]);
      invariant(
        zeroed.rowCount === 1,
        "RESPONDER_RETENTION_RETRY_REQUIRED",
        "Responder private material changed; retry safely.",
        { status: 409 }
      );

      const receiptId = randomUUID();
      const workerIdDigest = digest(workerId);
      const inserted = await client.query(`
        insert into ss.responder_private_material_destruction_receipts (
          id, cleanup_job_id, material_kind, subject_id, organization_id,
          project_id, source_envelope_digest, destroy_reason,
          worker_id_digest, primary_ciphertext_zeroed,
          backup_retention_until, receipt_digest, destroyed_at, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, true,
          $10::timestamptz + interval '30 days',
          ss.responder_private_material_destruction_receipt_digest(
            $2, $3, $4, $5, $6, $7, $8, $9, $10
          ), $10, $10
        ) returning *
      `, [
        receiptId, job.id, job.material_kind, job.subject_id,
        organizationId, job.project_id, job.source_envelope_digest,
        destroyReason, workerIdDigest, observedAt
      ]);
      invariant(
        inserted.rowCount === 1,
        "RESPONDER_RETENTION_REPOSITORY_INVALID",
        "Responder destruction receipt was not recorded.",
        { status: 500 }
      );
      const receipt = inserted.rows[0];
      const completed = await client.query(`
        update ss.responder_private_material_cleanup_jobs
           set state = 'succeeded', lease_owner = null,
               lease_started_at = null, lease_expires_at = null,
               final_destroy_reason = $2, receipt_digest = $3,
               destroyed_at = $4, revision = revision + 1, updated_at = $4
         where id = $1 and state = 'claimed' and lease_owner = $5
        returning id
      `, [job.id, destroyReason, receipt.receipt_digest, observedAt, workerId]);
      invariant(
        completed.rowCount === 1,
        "RESPONDER_RETENTION_RETRY_REQUIRED",
        "Responder cleanup lease changed; retry safely.",
        { status: 409 }
      );
      return destructionReceipt(receipt, false);
    }));
  }

  async function releaseClaim(input) {
    const selected = exactObject(input, [
      "jobId", "workerId", "failureCode", "observedAt", "retryAt"
    ], "Responder retention claim release");
    const jobId = uuid(selected.jobId, "Cleanup job ID");
    const workerId = worker(selected.workerId);
    invariant(
      typeof selected.failureCode === "string" &&
        SAFE_CODE.test(selected.failureCode),
      "RESPONDER_RETENTION_INVALID",
      "Cleanup failure code is invalid.",
      { status: 400 }
    );
    const observedAt = iso(selected.observedAt, "Cleanup failure time");
    const retryAt = iso(selected.retryAt, "Cleanup retry time");
    invariant(
      Date.parse(retryAt) >= Date.parse(observedAt),
      "RESPONDER_RETENTION_INVALID",
      "Cleanup retry cannot precede failure.",
      { status: 400 }
    );
    return translated(() => authority.service({
      actorKind: "system", isolation: "serializable"
    }, async (client) => {
      const result = await client.query(`
        update ss.responder_private_material_cleanup_jobs
           set state = case when failure_count = 99
                 then 'manual_review' else 'pending' end,
               failure_count = failure_count + 1,
               available_at = $4, lease_owner = null,
               lease_started_at = null, lease_expires_at = null,
               last_failure_code = $3, revision = revision + 1,
               manual_review_at = case when failure_count = 99
                 then $2::timestamptz else null::timestamptz end,
               updated_at = $2
         where id = $1 and state = 'claimed' and lease_owner = $5
           and failure_count < 100
        returning id, state
      `, [jobId, observedAt, selected.failureCode, retryAt, workerId]);
      if (result.rowCount === 1) {
        return deepFreeze({
          status: result.rows[0].state === "manual_review"
            ? "manual_review"
            : "released",
          jobId,
          providerEffects: false
        });
      }
      const retained = await client.query(
        `select state from ss.responder_private_material_cleanup_jobs
          where id = $1`,
        [jobId]
      );
      invariant(
        retained.rowCount === 1 && retained.rows[0].state === "succeeded",
        "RESPONDER_RETENTION_LEASE_LOST",
        "Responder cleanup lease is unavailable.",
        { status: 409 }
      );
      return deepFreeze({ status: "completed", jobId, providerEffects: false });
    }));
  }

  return Object.freeze({
    kind: "responder-private-material-retention-postgres",
    providerEffects: false,
    decryptsMaterial: false,
    readiness,
    placeHold,
    releaseHold,
    discoverEligible,
    claimNext,
    destroyClaim,
    releaseClaim
  });
}
