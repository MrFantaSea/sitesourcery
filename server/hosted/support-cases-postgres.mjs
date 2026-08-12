import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const CONSTRAINT_CODES = new Set(["23503", "23505", "23514", "55000"]);

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "SUPPORT_CASE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for support cases.",
    { status: 500 }
  );
  return authority;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "SUPPORT_CASE_UNAVAILABLE",
      "The support case is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "SUPPORT_CASE_RETRY_REQUIRED",
      "Support case state changed concurrently; retry safely.",
      { status: 409 }
    );
  }
  if (CONSTRAINT_CODES.has(error?.code)) {
    return new HostedError(
      "SUPPORT_CASE_REPOSITORY_CONFLICT",
      "The durable support case repository rejected inconsistent evidence.",
      { status: 409 }
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

function iso(value) {
  return value === null || value === undefined
    ? null
    : value instanceof Date ? value.toISOString() : String(value);
}

function actorContext(input, actorKind, readOnly = false) {
  return {
    actorKind,
    userId: input.actorId,
    organizationId: actorKind === "customer"
      ? input.organizationId
      : input.operatorOrganizationId,
    isolation: "serializable",
    readOnly
  };
}

function deadlineStatus(row, observedAt) {
  if (!row.response_due_at) return "unassigned";
  if (["responded", "denied", "closed"].includes(row.state)) {
    const decisionAt = row.responded_at ?? row.denied_at ?? row.closed_at;
    return Date.parse(iso(decisionAt)) <= Date.parse(iso(row.response_due_at))
      ? "met"
      : "overdue";
  }
  return Date.parse(observedAt) > Date.parse(iso(row.response_due_at))
    ? "overdue"
    : "active";
}

async function related(client, caseId) {
  const [events, evidence, notifications, appeal] = await Promise.all([
    client.query(
      `select event_kind, actor_kind, evidence_digest, occurred_at,
              recorded_at, event_digest, event_sequence
         from ss.hosted_support_case_events
        where case_id = $1
        order by event_sequence`,
      [caseId]
    ),
    client.query(
      `select evidence_kind, source_kind, evidence_digest, recorded_at
         from ss.hosted_support_case_evidence
        where case_id = $1
        order by recorded_at, id`,
      [caseId]
    ),
    client.query(
      `select notification_kind, reservation_digest, reserved_at
         from ss.hosted_support_case_mail_reservations
        where case_id = $1
        order by reserved_at, id`,
      [caseId]
    ),
    client.query(
      `select id, state
         from ss.hosted_support_cases
        where parent_case_id = $1 and request_kind = 'appeal'
        order by opened_at, id
        limit 1`,
      [caseId]
    )
  ]);
  return { events: events.rows, evidence: evidence.rows, notifications: notifications.rows,
    appeal: appeal.rows[0] ?? null };
}

function customerProjection(row, details, observedAt) {
  const decision = row.response_digest
    ? { kind: "response", digest: row.response_digest, recordedAt: iso(row.responded_at) }
    : row.denial_explanation_digest
      ? {
          kind: "denial",
          reasonCode: row.denial_reason_code,
          explanationDigest: row.denial_explanation_digest,
          recordedAt: iso(row.denied_at)
        }
      : null;
  return deepFreeze({
    schema: "sitesourcery.support-case-customer-read/v1",
    id: row.id,
    requestKind: row.request_kind,
    scope: {
      kind: row.scope_kind,
      organizationId: row.organization_id,
      projectId: row.project_id
    },
    state: row.state,
    identityState: row.identity_state,
    assigned: row.assigned_operator_user_id !== null,
    deadline: {
      dueAt: iso(row.response_due_at),
      status: deadlineStatus(row, observedAt)
    },
    decision,
    appeal: {
      available: row.appeal_available,
      dueAt: iso(row.appeal_due_at),
      caseId: details.appeal?.id ?? null,
      state: details.appeal?.state ?? null
    },
    notifications: details.notifications.map((item) => ({
      kind: item.notification_kind,
      state: "reserved",
      reservedAt: iso(item.reserved_at)
    })),
    audit: details.events.map((event) => ({
      sequence: Number(event.event_sequence),
      kind: event.event_kind,
      actorKind: event.actor_kind,
      evidenceDigest: event.evidence_digest,
      occurredAt: iso(event.occurred_at),
      eventDigest: event.event_digest
    })),
    openedAt: iso(row.opened_at),
    closedAt: iso(row.closed_at),
    revision: Number(row.revision)
  });
}

function operatorProjection(row, details, observedAt) {
  return deepFreeze({
    schema: "sitesourcery.support-case-operator-read/v1",
    ...customerProjection(row, details, observedAt),
    schema: "sitesourcery.support-case-operator-read/v1",
    intakeChannel: row.intake_channel,
    requesterUserId: row.requester_user_id,
    requesterReferenceDigest: row.requester_reference_digest,
    parentCaseId: row.parent_case_id,
    assignedOperatorId: row.assigned_operator_user_id,
    identityEvidenceDigest: row.identity_evidence_digest,
    deadlineBasisDigest: row.deadline_basis_digest,
    appealBasisDigest: row.appeal_basis_digest,
    closureReasonCode: row.closure_reason_code,
    evidence: details.evidence.map((item) => ({
      kind: item.evidence_kind,
      sourceKind: item.source_kind,
      digest: item.evidence_digest,
      recordedAt: iso(item.recorded_at)
    }))
  });
}

async function lockCase(client, caseId) {
  const result = await client.query(
    `select * from ss.hosted_support_cases where id = $1 for update`,
    [caseId]
  );
  invariant(
    result.rowCount === 1,
    "SUPPORT_CASE_UNAVAILABLE",
    "The support case is unavailable.",
    { status: 404 }
  );
  return result.rows[0];
}

async function priorCommand(client, input, action) {
  const result = await client.query(
    `select case_id, action, request_digest
       from ss.hosted_support_case_commands
      where command_id = $1`,
    [input.commandId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  invariant(
    row.action === action &&
      row.request_digest === input.requestDigest &&
      (!input.caseId || row.case_id === input.caseId),
    "SUPPORT_CASE_IDEMPOTENCY_CONFLICT",
    "That support case command was reused for different evidence.",
    { status: 409 }
  );
  return row.case_id;
}

async function insertEvidence(client, { caseId, kind, source, evidenceDigest, recordedAt }) {
  await client.query(
    `insert into ss.hosted_support_case_evidence (
       id, case_id, evidence_kind, source_kind, evidence_digest,
       recorded_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $6)
     on conflict (case_id, evidence_digest) do nothing`,
    [systemRandomUUID(), caseId, kind, source, evidenceDigest, recordedAt]
  );
}

async function recordCommand(client, {
  input, caseId, action, actorKind, eventKind, evidenceDigest
}) {
  const actorUserId = actorKind === "system" ? null : input.actorId;
  const resultDigest = digest({
    schema: "sitesourcery.support-case-command-result/v1",
    action,
    caseId,
    requestDigest: input.requestDigest
  });
  await client.query(
    `insert into ss.hosted_support_case_events (
       id, case_id, event_sequence, predecessor_event_id, event_kind,
       actor_kind, actor_user_id, evidence_digest, occurred_at,
       recorded_at, event_digest, created_at
     ) values ($1, $2, 1, null, $3, $4, $5, $6, $7, $7, $6, $7)`,
    [
      systemRandomUUID(), caseId, eventKind, actorKind, actorUserId,
      evidenceDigest, input.recordedAt
    ]
  );
  await client.query(
    `insert into ss.hosted_support_case_commands (
       id, command_id, case_id, action, actor_kind, actor_user_id,
       request_digest, result_digest, recorded_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [
      systemRandomUUID(), input.commandId, caseId, action, actorKind,
      actorUserId, input.requestDigest, resultDigest, input.recordedAt
    ]
  );
}

async function loadOperator(client, caseId, observedAt) {
  const row = await lockCase(client, caseId);
  return operatorProjection(row, await related(client, caseId), observedAt);
}

async function loadForActor(client, caseId, observedAt, actorKind) {
  const row = await lockCase(client, caseId);
  const details = await related(client, caseId);
  return actorKind === "customer"
    ? customerProjection(row, details, observedAt)
    : operatorProjection(row, details, observedAt);
}

function requireRevision(row, input) {
  invariant(
    Number(row.revision) === input.expectedRevision,
    "SUPPORT_CASE_REVISION_CONFLICT",
    "The support case changed; refresh before retrying.",
    { status: 409 }
  );
}

async function requireActorScope(client, input, actorKind) {
  const result = actorKind === "operator"
    ? await client.query(
        `select
           ss.service_operator_has_capability(
             $1, 'service_case_manage', clock_timestamp()
           )
           and exists (
             select 1
               from ss.organizations organization
               join ss.organization_memberships membership
                 on membership.organization_id = organization.id
                and membership.user_id = $1
              where organization.id = $2
                and organization.state = 'active'
                and membership.state = 'active'
           ) as allowed`,
        [input.actorId, input.operatorOrganizationId]
      )
    : await client.query(
        `select exists (
           select 1
             from ss.organizations organization
             join ss.organization_memberships membership
               on membership.organization_id = organization.id
              and membership.user_id = $1
            where organization.id = $2
              and organization.state = 'active'
              and membership.state = 'active'
         ) as allowed`,
        [input.actorId, input.organizationId]
      );
  invariant(
    result.rows[0]?.allowed === true,
    "SUPPORT_CASE_UNAVAILABLE",
    actorKind === "operator"
      ? "The support case queue is unavailable."
      : "The support case scope is unavailable.",
    { status: 404 }
  );
}

export function createPostgresSupportCaseRepository({ authority } = {}) {
  const database = validateAuthority(authority);

  async function open(input, actorKind) {
    const action = input.requestKind === "appeal" ? "appeal_open" : "open";
    return translated(() => database.service(
      actorContext(input, actorKind),
      async (client) => {
        await requireActorScope(client, input, actorKind);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        const replayCaseId = await priorCommand(client, input, action);
        if (replayCaseId) {
          return loadForActor(client, replayCaseId, input.recordedAt, actorKind);
        }
        const caseId = systemRandomUUID();
        const identityState = input.intakeChannel === "authenticated"
          ? "session_authenticated" : "unverified";
        await client.query(
          `insert into ss.hosted_support_cases (
             id, opening_command_id, opening_request_digest, intake_channel,
             request_kind, scope_kind, organization_id, project_id,
             requester_user_id, requester_reference_digest, parent_case_id,
             identity_state, state, appeal_available, opened_at, revision,
             created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, 'open', false, $13, 1, $13, $13)`,
          [
            caseId, input.commandId, input.requestDigest, input.intakeChannel,
            input.requestKind, input.scopeKind, input.organizationId,
            input.projectId, input.requesterUserId,
            input.requesterReferenceDigest, input.parentCaseId,
            identityState, input.recordedAt
          ]
        );
        for (const evidenceDigest of input.evidenceDigests) {
          await insertEvidence(client, {
            caseId,
            kind: input.requestKind === "appeal" ? "appeal" : "request_scope",
            source: actorKind === "customer" ? "requester" : "operator",
            evidenceDigest,
            recordedAt: input.recordedAt
          });
        }
        await recordCommand(client, {
          input, caseId, action, actorKind,
          eventKind: input.requestKind === "appeal" ? "appeal_opened" : "opened",
          evidenceDigest: input.requestDigest
        });
        if (input.requestKind === "appeal") {
          await client.query(
            `update ss.hosted_support_cases
                set state = 'appeal_pending', updated_at = $2
              where id = $1`,
            [input.parentCaseId, input.recordedAt]
          );
          await client.query(
            `insert into ss.hosted_support_case_events (
               id, case_id, event_sequence, predecessor_event_id, event_kind,
               actor_kind, actor_user_id, evidence_digest, occurred_at,
               recorded_at, event_digest, created_at
             ) values ($1, $2, 1, null, 'appeal_received', $3, $4, $5,
               $6, $6, $5, $6)`,
            [
              systemRandomUUID(), input.parentCaseId, actorKind,
              actorKind === "system" ? null : input.actorId,
              input.requestDigest, input.recordedAt
            ]
          );
        }
        return loadForActor(client, caseId, input.recordedAt, actorKind);
      }
    ));
  }

  async function mutate(input, { action, eventKind, update, evidence = [] }) {
    return translated(() => database.service(
      actorContext(input, "operator"),
      async (client) => {
        await requireActorScope(client, input, "operator");
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        const replayCaseId = await priorCommand(client, input, action);
        if (replayCaseId) return loadOperator(client, replayCaseId, input.recordedAt);
        const row = await lockCase(client, input.caseId);
        requireRevision(row, input);
        await update(client, row);
        for (const item of evidence) {
          await insertEvidence(client, {
            caseId: input.caseId,
            kind: item.kind,
            source: "operator",
            evidenceDigest: item.digest,
            recordedAt: input.recordedAt
          });
        }
        await recordCommand(client, {
          input,
          caseId: input.caseId,
          action,
          actorKind: "operator",
          eventKind,
          evidenceDigest: input.requestDigest
        });
        return loadOperator(client, input.caseId, input.recordedAt);
      }
    ));
  }

  async function readOne(input, actorKind) {
    return translated(() => database.service(
      actorContext(input, actorKind, true),
      async (client) => {
        await requireActorScope(client, input, actorKind);
        const selected = await client.query(
          `select * from ss.hosted_support_cases
            where id = $1
              ${actorKind === "customer"
                ? "and requester_user_id = $2 and organization_id = $3"
                : ""}`,
          actorKind === "customer"
            ? [input.caseId, input.actorId, input.organizationId]
            : [input.caseId]
        );
        invariant(selected.rowCount === 1,
          "SUPPORT_CASE_UNAVAILABLE", "The support case is unavailable.", { status: 404 });
        const row = selected.rows[0];
        const details = await related(client, row.id);
        const observedAt = new Date().toISOString();
        return actorKind === "customer"
          ? customerProjection(row, details, observedAt)
          : operatorProjection(row, details, observedAt);
      }
    ));
  }

  async function list(input, actorKind) {
    return translated(() => database.service(
      actorContext(input, actorKind, true),
      async (client) => {
        await requireActorScope(client, input, actorKind);
        const selected = await client.query(
          `select * from ss.hosted_support_cases
            ${actorKind === "customer"
              ? "where requester_user_id = $1 and organization_id = $2"
              : "where state <> 'closed'"}
            order by response_due_at nulls first, opened_at, id
            limit 100`,
          actorKind === "customer" ? [input.actorId, input.organizationId] : []
        );
        const observedAt = new Date().toISOString();
        const cases = [];
        for (const row of selected.rows) {
          const details = await related(client, row.id);
          cases.push(actorKind === "customer"
            ? customerProjection(row, details, observedAt)
            : operatorProjection(row, details, observedAt));
        }
        return deepFreeze({
          schema: actorKind === "customer"
            ? "sitesourcery.support-case-customer-list/v1"
            : "sitesourcery.support-case-operator-list/v1",
          cases
        });
      }
    ));
  }

  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_support_case_contract_v1()') is not null
                and ss.hosted_support_case_contract_v1() =
                  'canonical-support-case-v1-auditable-held-lifecycle'
                as contract_ready,
              count(*) = 5 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "hosted_support_cases", "hosted_support_case_commands",
            "hosted_support_case_evidence", "hosted_support_case_events",
            "hosted_support_case_mail_reservations"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.tables_ready === true &&
          row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "support-case-postgres",
          code: ready ? null : "SUPPORT_CASE_NOT_MIGRATED",
          providerEffects: false,
          deletionExecution: false,
          exportExecution: false
        });
      } catch {
        return deepFreeze({
          ready: false, verified: false, kind: "support-case-postgres",
          code: "SUPPORT_CASE_DATABASE_UNAVAILABLE", providerEffects: false,
          deletionExecution: false, exportExecution: false
        });
      }
    },
    openAuthenticated: (input) => open(input, "customer"),
    recordManual: (input) => open(input, "operator"),
    assign(input) {
      return mutate(input, {
        action: "assign", eventKind: "assigned",
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set state = 'assigned', assigned_operator_user_id = $2,
                  assigned_at = $3, updated_at = $3
            where id = $1`,
          [input.caseId, input.assignedOperatorId, input.recordedAt]
        )
      });
    },
    updateIdentity(input) {
      return mutate(input, {
        action: "identity_update", eventKind: "identity_updated",
        evidence: [{ kind: "identity_verification", digest: input.evidenceDigest }],
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set identity_state = $2, identity_evidence_digest = $3,
                  identity_updated_at = $4, updated_at = $4
            where id = $1`,
          [input.caseId, input.identityState, input.evidenceDigest, input.recordedAt]
        )
      });
    },
    setDeadline(input) {
      return mutate(input, {
        action: "deadline_set", eventKind: "deadline_set",
        evidence: [{ kind: "deadline_basis", digest: input.basisDigest }],
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set response_due_at = $2, deadline_basis_digest = $3,
                  updated_at = $4
            where id = $1`,
          [input.caseId, input.responseDueAt, input.basisDigest, input.recordedAt]
        )
      });
    },
    startReview(input) {
      return mutate(input, {
        action: "review_start", eventKind: "review_started",
        update: (client) => client.query(
          `update ss.hosted_support_cases set state = 'in_review', updated_at = $2
            where id = $1`,
          [input.caseId, input.recordedAt]
        )
      });
    },
    respond(input) {
      return mutate(input, {
        action: "respond", eventKind: "response_recorded",
        evidence: [{ kind: "response", digest: input.responseDigest }],
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set state = 'responded', response_digest = $2,
                  responded_at = $3, updated_at = $3
            where id = $1`,
          [input.caseId, input.responseDigest, input.recordedAt]
        )
      });
    },
    deny(input) {
      const evidence = [{ kind: "denial", digest: input.denialExplanationDigest }];
      if (input.appealBasisDigest) {
        evidence.push({ kind: "deadline_basis", digest: input.appealBasisDigest });
      }
      return mutate(input, {
        action: "deny", eventKind: "denied", evidence,
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set state = 'denied', denial_reason_code = $2,
                  denial_explanation_digest = $3, denied_at = $4,
                  appeal_available = $5, appeal_due_at = $6,
                  appeal_basis_digest = $7, updated_at = $4
            where id = $1`,
          [
            input.caseId, input.denialReasonCode,
            input.denialExplanationDigest, input.recordedAt,
            input.appealAvailable, input.appealDueAt, input.appealBasisDigest
          ]
        )
      });
    },
    close(input) {
      return mutate(input, {
        action: "close", eventKind: "closed",
        evidence: [{ kind: "closure", digest: input.closureEvidenceDigest }],
        update: (client) => client.query(
          `update ss.hosted_support_cases
              set state = 'closed', closure_reason_code = $2,
                  closed_at = $3, updated_at = $3
            where id = $1`,
          [input.caseId, input.closureReasonCode, input.recordedAt]
        )
      });
    },
    addEvidence(input) {
      return mutate(input, {
        action: "evidence_add", eventKind: "evidence_added",
        evidence: [{ kind: input.evidenceKind, digest: input.evidenceDigest }],
        update: (client) => client.query(
          `update ss.hosted_support_cases set updated_at = $2 where id = $1`,
          [input.caseId, input.recordedAt]
        )
      });
    },
    linkMailReservation(input) {
      return mutate(input, {
        action: "notification_reserve", eventKind: "notification_reserved",
        update: async (client) => {
          await client.query(
            `insert into ss.hosted_support_case_mail_reservations (
             id, case_id, notification_kind, mail_message_id,
             reservation_digest, reserved_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, $6)`,
            [
              systemRandomUUID(), input.caseId, input.notificationKind,
              input.mailMessageId,
              digest({
                schema: "sitesourcery.support-case-mail-reservation/v1",
                caseId: input.caseId,
                mailMessageId: input.mailMessageId,
                notificationKind: input.notificationKind
              }),
              input.recordedAt
            ]
          );
          await client.query(
            `update ss.hosted_support_cases set updated_at = $2 where id = $1`,
            [input.caseId, input.recordedAt]
          );
        }
      });
    },
    readCustomerCase: (input) => readOne(input, "customer"),
    listCustomerCases: (input) => list(input, "customer"),
    readOperatorCase: (input) => readOne(input, "operator"),
    listOperatorCases: (input) => list(input, "operator")
  });
}
