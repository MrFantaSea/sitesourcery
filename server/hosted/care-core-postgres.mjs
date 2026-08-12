import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);
const CONFLICT_CODES = new Set(["23503", "23505", "23514", "55000"]);

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "CARE_CORE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Care.",
    { status: 500 }
  );
  return authority;
}

function databaseError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "CARE_CORE_UNAVAILABLE",
      "The Care resource is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "CARE_CORE_RETRY_REQUIRED",
      "Care state changed concurrently; retry the same command safely.",
      { status: 409 }
    );
  }
  if (CONFLICT_CODES.has(error?.code)) {
    return new HostedError(
      "CARE_CORE_CONFLICT",
      "The held Care authority rejected inconsistent or overlapping evidence.",
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

function context(input, readOnly = false) {
  return {
    actorKind: input.actorKind,
    userId: input.actorId,
    organizationId: input.organizationId,
    isolation: "serializable",
    readOnly
  };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function date(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function commandResult(input, resourceKind, resourceId) {
  return digest({
    schema: "sitesourcery.care-command-result/v1",
    action: input.action,
    requestDigest: input.requestDigest,
    resourceId,
    resourceKind
  });
}

async function priorCommand(client, input, resourceKind, resourceId) {
  const selected = await client.query(
    `select action, resource_kind, resource_id, request_digest
       from ss.care_commands
      where command_id = $1`,
    [input.commandId]
  );
  if (selected.rowCount === 0) return false;
  const row = selected.rows[0];
  invariant(
    row.action === input.action &&
      row.resource_kind === resourceKind &&
      row.resource_id === resourceId &&
      row.request_digest === input.requestDigest,
    "CARE_CORE_IDEMPOTENCY_CONFLICT",
    "That Care command was reused for different evidence.",
    { status: 409 }
  );
  return true;
}

async function recordCommand(client, input, resourceKind, resourceId, uuid) {
  await client.query(
    `insert into ss.care_commands (
       id, organization_id, project_id, command_id, action,
       resource_kind, resource_id, actor_kind, actor_user_id,
       request_digest, result_digest, recorded_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      uuid(), input.organizationId, input.projectId, input.commandId,
      input.action, resourceKind, resourceId, input.actorKind,
      input.actorId, input.requestDigest,
      commandResult(input, resourceKind, resourceId), input.recordedAt
    ]
  );
}

async function contractProjection(client, contractId, organizationId) {
  const selected = await client.query(
    `select contract.id, contract.organization_id, contract.project_id,
            contract.customer_user_id, contract.contract_kind,
            catalog.catalog_version, catalog.service_key,
            catalog.site_origin, catalog.billing_cadence,
            catalog.capacity_unit_kind, catalog.commercial_authority_state,
            contract.acceptance_reference_id, contract.acceptance_digest,
            contract.scope_digest, contract.provider_scope_digest,
            contract.authority_state, contract.customer_effects_authorized,
            contract.payment_effects_authorized,
            contract.provider_effects_authorized, contract.recorded_at
       from ss.care_customer_contracts contract
       join ss.care_catalog_identities catalog
         on catalog.id = contract.catalog_identity_id
      where contract.id = $1 and contract.organization_id = $2`,
    [contractId, organizationId]
  );
  invariant(
    selected.rowCount === 1,
    "CARE_CORE_UNAVAILABLE",
    "The Care contract is unavailable.",
    { status: 404 }
  );
  const row = selected.rows[0];
  return deepFreeze({
    schema: "sitesourcery.care-customer-contract-read/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    contractKind: row.contract_kind,
    catalog: {
      version: row.catalog_version,
      serviceKey: row.service_key,
      siteOrigin: row.site_origin,
      billingCadence: row.billing_cadence,
      capacityUnitKind: row.capacity_unit_kind,
      commercialAuthorityState: row.commercial_authority_state
    },
    acceptanceReferenceId: row.acceptance_reference_id,
    acceptanceDigest: row.acceptance_digest,
    scopeDigest: row.scope_digest,
    providerScopeDigest: row.provider_scope_digest,
    authorityState: row.authority_state,
    effects: {
      customer: row.customer_effects_authorized,
      payment: row.payment_effects_authorized,
      provider: row.provider_effects_authorized
    },
    recordedAt: iso(row.recorded_at)
  });
}

async function periodProjection(client, periodId, organizationId) {
  const selected = await client.query(
    `select period.*,
            coalesce(sum(entry.units) filter (
              where entry.capacity_source = 'carried'
            ), 0)::integer as used_carried_units,
            coalesce(sum(entry.units) filter (
              where entry.capacity_source = 'included'
            ), 0)::integer as used_included_units
       from ss.care_periods period
       left join ss.care_capacity_entries entry on entry.period_id = period.id
      where period.id = $1 and period.organization_id = $2
      group by period.id`,
    [periodId, organizationId]
  );
  invariant(
    selected.rowCount === 1,
    "CARE_CORE_UNAVAILABLE",
    "The Care period is unavailable.",
    { status: 404 }
  );
  const row = selected.rows[0];
  const carried = Number(row.carried_units);
  const included = Number(row.included_units);
  const usedCarried = Number(row.used_carried_units);
  const usedIncluded = Number(row.used_included_units);
  return deepFreeze({
    schema: "sitesourcery.care-period-read/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    contractId: row.contract_id,
    providerScopeDigest: row.provider_scope_digest,
    providerPeriodKey: row.provider_period_key,
    startsOn: date(row.starts_on),
    endsOn: date(row.ends_on),
    capacity: {
      carried,
      included,
      usedCarried,
      usedIncluded,
      remaining: carried + included - usedCarried - usedIncluded
    },
    carriedFromPeriodId: row.carried_from_period_id,
    state: row.state,
    authorityState: row.authority_state,
    providerEffects: row.provider_effects_authorized,
    revision: Number(row.revision),
    openedAt: iso(row.opened_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at)
  });
}

async function ticketProjection(client, ticketId, organizationId) {
  const selected = await client.query(
    `select ticket.*,
            coalesce(sum(entry.units), 0)::integer as allocated_units
       from ss.care_tickets ticket
       left join ss.care_capacity_entries entry on entry.ticket_id = ticket.id
      where ticket.id = $1 and ticket.organization_id = $2
      group by ticket.id`,
    [ticketId, organizationId]
  );
  invariant(
    selected.rowCount === 1,
    "CARE_CORE_UNAVAILABLE",
    "The Care ticket is unavailable.",
    { status: 404 }
  );
  const row = selected.rows[0];
  return deepFreeze({
    schema: "sitesourcery.care-ticket-read/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    contractId: row.contract_id,
    periodId: row.period_id,
    supportTicketId: row.support_ticket_id,
    basisKind: row.basis_kind,
    basisReferenceId: row.basis_reference_id,
    basisDigest: row.basis_digest,
    workScopeDigest: row.work_scope_digest,
    state: row.state,
    revision: Number(row.revision),
    allocatedUnits: Number(row.allocated_units),
    effects: {
      mail: row.mail_effects_authorized,
      provider: row.provider_effects_authorized
    },
    openedAt: iso(row.opened_at),
    resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
    closedAt: row.closed_at === null ? null : iso(row.closed_at)
  });
}

export function createPostgresCareCoreRepository({
  authority,
  uuid = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_care_core_contract_v1()') is not null
                and ss.hosted_care_core_contract_v1() =
                  'canonical-care-core-v1-held-catalog-contract-period-capacity-ticket'
                as contract_ready,
              count(*) = 7 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "care_catalog_identities", "care_commands",
            "care_customer_contracts", "care_periods",
            "care_period_scope_claims", "care_tickets",
            "care_capacity_entries"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "care-core-postgres",
          mode: "held",
          code: ready ? null : "CARE_CORE_NOT_MIGRATED",
          customerEffects: false,
          mailEffects: false,
          paymentEffects: false,
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "care-core-postgres",
          mode: "held",
          code: "CARE_CORE_NOT_MIGRATED",
          customerEffects: false,
          mailEffects: false,
          paymentEffects: false,
          providerEffects: false
        });
      }
    },

    registerContract(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "contract", input.contractId)) {
          return contractProjection(client, input.contractId, input.organizationId);
        }
        await recordCommand(client, input, "contract", input.contractId, uuid);
        await client.query(
          `insert into ss.care_customer_contracts (
             id, organization_id, project_id, customer_user_id,
             catalog_identity_id, contract_kind, acceptance_reference_id,
             acceptance_digest, scope_digest, provider_scope_digest,
             authority_state, customer_effects_authorized,
             payment_effects_authorized, provider_effects_authorized,
             opening_command_id, recorded_at, created_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             'held', false, false, false, $11, $12, $12
           )`,
          [
            input.contractId, input.organizationId, input.projectId,
            input.customerId, input.catalogIdentityId, input.contractKind,
            input.acceptanceReferenceId, input.acceptanceDigest,
            input.scopeDigest, input.providerScopeDigest, input.commandId,
            input.recordedAt
          ]
        );
        return contractProjection(client, input.contractId, input.organizationId);
      }));
    },

    openPeriod(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "period", input.periodId)) {
          return periodProjection(client, input.periodId, input.organizationId);
        }
        await recordCommand(client, input, "period", input.periodId, uuid);
        await client.query(
          `insert into ss.care_periods (
             id, organization_id, project_id, contract_id,
             provider_scope_digest, provider_period_key, starts_on, ends_on,
             included_units, carried_units, carried_from_period_id,
             state, authority_state, provider_effects_authorized, revision,
             opening_command_id, latest_command_id, opened_at, closed_at,
             created_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             'open', 'held', false, 1, $12, $12, $13, null, $13, $13
           )`,
          [
            input.periodId, input.organizationId, input.projectId,
            input.contractId, input.providerScopeDigest,
            input.providerPeriodKey, input.startsOn, input.endsOn,
            input.includedUnits, input.carriedUnits,
            input.carriedFromPeriodId, input.commandId, input.recordedAt
          ]
        );
        return periodProjection(client, input.periodId, input.organizationId);
      }));
    },

    closePeriod(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "period", input.periodId)) {
          return periodProjection(client, input.periodId, input.organizationId);
        }
        const current = await client.query(
          "select revision from ss.care_periods where id = $1 for update",
          [input.periodId]
        );
        invariant(
          current.rowCount === 1 &&
            Number(current.rows[0].revision) === input.expectedRevision,
          "CARE_CORE_REVISION_CONFLICT",
          "The Care period changed; refresh before retrying.",
          { status: 409 }
        );
        await recordCommand(client, input, "period", input.periodId, uuid);
        await client.query(
          `update ss.care_periods
              set state = 'closed', revision = revision + 1,
                  latest_command_id = $2, closed_at = $3, updated_at = $3
            where id = $1`,
          [input.periodId, input.commandId, input.recordedAt]
        );
        return periodProjection(client, input.periodId, input.organizationId);
      }));
    },

    claimScope(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "scope_claim", input.claimId)) {
          return deepFreeze({ id: input.claimId, replayed: true });
        }
        await recordCommand(client, input, "scope_claim", input.claimId, uuid);
        await client.query(
          `insert into ss.care_period_scope_claims (
             id, organization_id, project_id, period_id, coverage_key,
             scope_identity_digest, claim_mode, included_by_claim_id,
             command_id, recorded_at, created_at,
             period_starts_on, period_ends_on
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12)`,
          [
            input.claimId, input.organizationId, input.projectId,
            input.periodId, input.coverageKey, input.scopeIdentityDigest,
            input.claimMode, input.includedByClaimId, input.commandId,
            input.recordedAt, input.periodStartsOn, input.periodEndsOn
          ]
        );
        return deepFreeze({ id: input.claimId, replayed: false });
      }));
    },

    openTicket(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "ticket", input.ticketId)) {
          return ticketProjection(client, input.ticketId, input.organizationId);
        }
        await recordCommand(client, input, "ticket", input.ticketId, uuid);
        await client.query(
          `insert into ss.care_tickets (
             id, organization_id, project_id, contract_id, period_id,
             support_ticket_id, basis_kind, basis_reference_id, basis_digest,
             work_scope_digest, state, revision, opening_command_id,
             latest_command_id, provider_effects_authorized,
             mail_effects_authorized, opened_at, resolved_at, closed_at,
             created_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             'open', 1, $11, $11, false, false, $12, null, null, $12, $12
           )`,
          [
            input.ticketId, input.organizationId, input.projectId,
            input.contractId, input.periodId, input.supportTicketId,
            input.basisKind, input.basisReferenceId, input.basisDigest,
            input.workScopeDigest, input.commandId, input.recordedAt
          ]
        );
        return ticketProjection(client, input.ticketId, input.organizationId);
      }));
    },

    transitionTicket(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "ticket", input.ticketId)) {
          return ticketProjection(client, input.ticketId, input.organizationId);
        }
        const current = await client.query(
          "select revision from ss.care_tickets where id = $1 for update",
          [input.ticketId]
        );
        invariant(
          current.rowCount === 1 &&
            Number(current.rows[0].revision) === input.expectedRevision,
          "CARE_CORE_REVISION_CONFLICT",
          "The Care ticket changed; refresh before retrying.",
          { status: 409 }
        );
        await recordCommand(client, input, "ticket", input.ticketId, uuid);
        await client.query(
          `update ss.care_tickets
              set state = $2, revision = revision + 1,
                  latest_command_id = $3,
                  resolved_at = case
                    when $2 = 'resolved' then $4
                    when $2 = 'in_progress' then null
                    when $2 = 'closed' then coalesce(resolved_at, $4)
                    else resolved_at
                  end,
                  closed_at = case when $2 = 'closed' then $4 else null end,
                  updated_at = $4
            where id = $1`,
          [input.ticketId, input.targetState, input.commandId, input.recordedAt]
        );
        return ticketProjection(client, input.ticketId, input.organizationId);
      }));
    },

    allocateCapacity(input) {
      return translated(() => database.service(context(input), async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [input.commandId]
        );
        if (await priorCommand(client, input, "capacity", input.entryId)) {
          return periodProjection(client, input.periodId, input.organizationId);
        }
        await recordCommand(client, input, "capacity", input.entryId, uuid);
        await client.query(
          `insert into ss.care_capacity_entries (
             id, organization_id, project_id, period_id, ticket_id,
             capacity_source, units, command_id,
             payment_effects_authorized, provider_effects_authorized,
             recorded_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, false, false, $9, $9)`,
          [
            input.entryId, input.organizationId, input.projectId,
            input.periodId, input.ticketId, input.capacitySource,
            input.units, input.commandId, input.recordedAt
          ]
        );
        return periodProjection(client, input.periodId, input.organizationId);
      }));
    },

    readContract(input) {
      return translated(() => database.service(
        context(input, true),
        (client) => contractProjection(
          client,
          input.contractId,
          input.organizationId
        )
      ));
    },

    readPeriod(input) {
      return translated(() => database.service(
        context(input, true),
        (client) => periodProjection(client, input.periodId, input.organizationId)
      ));
    },

    readTicket(input) {
      return translated(() => database.service(
        context(input, true),
        (client) => ticketProjection(client, input.ticketId, input.organizationId)
      ));
    }
  });
}
