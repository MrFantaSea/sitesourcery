import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  CARE_MAIL_CAPABILITY,
  CARE_OPERATOR_CAPABILITY,
  CARE_SURFACE_DASHBOARD_SCHEMA
} from "./care-surfaces.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CAPABILITIES = new Set([
  CARE_MAIL_CAPABILITY,
  CARE_OPERATOR_CAPABILITY
]);

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Care surfaces.",
    { status: 500 }
  );
  return authority;
}

function validateCore(core) {
  const methods = [
    "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
    "readiness", "transitionTicket"
  ];
  invariant(
    core && methods.every((method) => typeof core[method] === "function"),
    "CARE_SURFACE_CONFIGURATION_REQUIRED",
    "The canonical Care core repository is required for Care surfaces.",
    { status: 500 }
  );
  return core;
}

function unavailable(message) {
  return new HostedError("CARE_SURFACE_UNAVAILABLE", message, { status: 404 });
}

function translated(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return unavailable("The Care resource is unavailable.");
  }
  return error;
}

async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    throw translated(error);
  }
}

function context(input, actorKind, readOnly = true) {
  return {
    actorKind,
    userId: input.actorId,
    organizationId: input.organizationId,
    readOnly,
    isolation: "serializable"
  };
}

function validScope(input) {
  invariant(
    input && UUID.test(input.actorId) && UUID.test(input.organizationId),
    "CARE_SURFACE_INVALID",
    "The Care actor scope is invalid.",
    { status: 400 }
  );
  return input;
}

function capabilities(value) {
  invariant(
    Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 2 &&
      value.every((entry) => CAPABILITIES.has(entry)) &&
      new Set(value).size === value.length &&
      JSON.stringify([...value].sort()) === JSON.stringify(value),
    "CARE_SURFACE_INVALID",
    "The Care capability request is invalid.",
    { status: 400 }
  );
  return value;
}

async function requireCapabilities(client, actorId, requested) {
  for (const capability of capabilities(requested)) {
    const selected = await client.query(
      `/* care-surfaces:operator-capability */
       select ss.service_operator_has_capability(
         $1, $2, clock_timestamp()
       ) as allowed`,
      [actorId, capability]
    );
    invariant(
      selected.rowCount === 1 && selected.rows[0]?.allowed === true,
      "CARE_SURFACE_UNAVAILABLE",
      "The Care resource is unavailable.",
      { status: 404 }
    );
  }
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function date(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

function booleanHold(value, field) {
  invariant(
    value === false,
    "CARE_SURFACE_AUTHORITY_DRIFT",
    `${field} unexpectedly became authorized.`,
    { status: 503 }
  );
  return false;
}

function dashboardProjection({
  audience,
  customerUserId,
  organizationId,
  observedAt,
  contractRows,
  periodRows,
  ticketRows
}) {
  const contractIdentity = new Map();
  for (const row of contractRows) {
    invariant(
      row.organization_id === organizationId &&
        UUID.test(row.id) && UUID.test(row.project_id) &&
        UUID.test(row.customer_user_id) &&
        (audience !== "customer" || row.customer_user_id === customerUserId) &&
        !contractIdentity.has(row.id),
      "CARE_SURFACE_AUTHORITY_DRIFT",
      "Care customer ownership evidence drifted.",
      { status: 503 }
    );
    contractIdentity.set(row.id, row);
  }
  const periodsByContract = new Map();
  for (const row of periodRows) {
    const contract = contractIdentity.get(row.contract_id);
    invariant(
      contract && row.project_id === contract.project_id &&
        UUID.test(row.id) &&
        [
          row.carried_units, row.included_units, row.used_carried_units,
          row.used_included_units, row.revision
        ].every((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0),
      "CARE_SURFACE_AUTHORITY_DRIFT",
      "Care period ownership or capacity evidence drifted.",
      { status: 503 }
    );
    booleanHold(row.provider_effects_authorized, "Care period provider effects");
    const carried = Number(row.carried_units);
    const included = Number(row.included_units);
    const usedCarried = Number(row.used_carried_units);
    const usedIncluded = Number(row.used_included_units);
    invariant(
      usedCarried <= carried && usedIncluded <= included &&
        Number(row.revision) >= 1,
      "CARE_SURFACE_AUTHORITY_DRIFT",
      "Care period capacity evidence drifted.",
      { status: 503 }
    );
    const item = deepFreeze({
      id: row.id,
      projectId: row.project_id,
      startsOn: date(row.starts_on),
      endsOn: date(row.ends_on),
      state: row.state,
      revision: Number(row.revision),
      authorityState: row.authority_state,
      capacity: {
        carried,
        included,
        usedCarried,
        usedIncluded,
        remaining: carried + included - usedCarried - usedIncluded
      },
      providerEffects: false
    });
    const existing = periodsByContract.get(row.contract_id) ?? [];
    existing.push(item);
    periodsByContract.set(row.contract_id, existing);
  }

  const ticketsByContract = new Map();
  for (const row of ticketRows) {
    const contract = contractIdentity.get(row.contract_id);
    invariant(
      contract && row.project_id === contract.project_id &&
        UUID.test(row.id) && UUID.test(row.period_id) &&
        Number.isSafeInteger(Number(row.revision)) && Number(row.revision) >= 1 &&
        Number.isSafeInteger(Number(row.allocated_units)) &&
        Number(row.allocated_units) >= 0,
      "CARE_SURFACE_AUTHORITY_DRIFT",
      "Care ticket ownership evidence drifted.",
      { status: 503 }
    );
    booleanHold(row.provider_effects_authorized, "Care ticket provider effects");
    booleanHold(row.mail_effects_authorized, "Care ticket mail effects");
    invariant(
      SHA256.test(row.basis_digest) && SHA256.test(row.work_scope_digest),
      "CARE_SURFACE_AUTHORITY_DRIFT",
      "Care ticket digest evidence is invalid.",
      { status: 503 }
    );
    const item = deepFreeze({
      id: row.id,
      projectId: row.project_id,
      periodId: row.period_id,
      basis: {
        kind: row.basis_kind,
        referenceDigest: row.basis_digest
      },
      workScopeDigest: row.work_scope_digest,
      state: row.state,
      revision: Number(row.revision),
      allocatedUnits: Number(row.allocated_units),
      effects: { mail: false, provider: false },
      openedAt: iso(row.opened_at),
      resolvedAt: row.resolved_at === null ? null : iso(row.resolved_at),
      closedAt: row.closed_at === null ? null : iso(row.closed_at)
    });
    const existing = ticketsByContract.get(row.contract_id) ?? [];
    existing.push(item);
    ticketsByContract.set(row.contract_id, existing);
  }

  const contracts = contractRows.map((row) => {
    booleanHold(row.customer_effects_authorized, "Care customer effects");
    booleanHold(row.payment_effects_authorized, "Care payment effects");
    booleanHold(row.provider_effects_authorized, "Care provider effects");
    const selected = {
      id: row.id,
      projectId: row.project_id,
      contractKind: row.contract_kind,
      catalog: {
        serviceKey: row.service_key,
        catalogVersion: row.catalog_version,
        billingCadence: row.billing_cadence,
        capacityUnitKind: row.capacity_unit_kind,
        commercialAuthorityState: row.commercial_authority_state
      },
      authorityState: row.authority_state,
      effects: { customer: false, payment: false, provider: false },
      periods: deepFreeze(periodsByContract.get(row.id) ?? []),
      tickets: deepFreeze(ticketsByContract.get(row.id) ?? [])
    };
    if (audience === "operator") selected.customerId = row.customer_user_id;
    return deepFreeze(selected);
  });
  return deepFreeze({
    schema: CARE_SURFACE_DASHBOARD_SCHEMA,
    audience,
    organizationId,
    observedAt: iso(observedAt),
    held: {
      commercialRelease: true,
      customerEffects: true,
      mailDelivery: true,
      paymentEffects: true,
      providerEffects: true
    },
    contracts
  });
}

async function readDashboard(client, input, audience) {
  const customer = audience === "customer";
  const contracts = await client.query(
    `/* care-surfaces:contracts */
     select contract.id, contract.organization_id, contract.project_id,
            contract.customer_user_id, contract.contract_kind,
            contract.authority_state, contract.customer_effects_authorized,
            contract.payment_effects_authorized,
            contract.provider_effects_authorized,
            catalog.service_key, catalog.catalog_version,
            catalog.billing_cadence, catalog.capacity_unit_kind,
            catalog.commercial_authority_state
       from ss.care_customer_contracts contract
       join ss.care_catalog_identities catalog
         on catalog.id = contract.catalog_identity_id
      where contract.organization_id = $1
        and ($2::uuid is null or contract.customer_user_id = $2)
      order by contract.recorded_at desc, contract.id
      limit 100`,
    [input.organizationId, customer ? input.actorId : null]
  );
  const ids = contracts.rows.map((row) => row.id);
  const periods = ids.length === 0
    ? { rows: [] }
    : await client.query(
      `/* care-surfaces:periods */
       select period.id, period.contract_id, period.project_id,
              period.starts_on, period.ends_on, period.included_units,
              period.carried_units, period.state, period.authority_state,
              period.provider_effects_authorized, period.revision,
              coalesce(sum(entry.units) filter (
                where entry.capacity_source = 'carried'
              ), 0)::integer as used_carried_units,
              coalesce(sum(entry.units) filter (
                where entry.capacity_source = 'included'
              ), 0)::integer as used_included_units
         from ss.care_periods period
         left join ss.care_capacity_entries entry on entry.period_id = period.id
        where period.organization_id = $1
          and period.contract_id = any($2::uuid[])
        group by period.id
        order by period.starts_on desc, period.id
        limit 240`,
      [input.organizationId, ids]
    );
  const tickets = ids.length === 0
    ? { rows: [] }
    : await client.query(
      `/* care-surfaces:tickets-digest-only */
       select ticket.id, ticket.contract_id, ticket.project_id,
              ticket.period_id, ticket.basis_kind, ticket.basis_digest,
              ticket.work_scope_digest, ticket.state, ticket.revision,
              ticket.provider_effects_authorized,
              ticket.mail_effects_authorized, ticket.opened_at,
              ticket.resolved_at, ticket.closed_at,
              coalesce(sum(entry.units), 0)::integer as allocated_units
         from ss.care_tickets ticket
         left join ss.care_capacity_entries entry on entry.ticket_id = ticket.id
        where ticket.organization_id = $1
          and ticket.contract_id = any($2::uuid[])
        group by ticket.id
        order by ticket.opened_at desc, ticket.id
        limit 500`,
      [input.organizationId, ids]
    );
  const observed = await client.query(
    "/* care-surfaces:observed-at */ select clock_timestamp() as observed_at"
  );
  return dashboardProjection({
    audience,
    customerUserId: customer ? input.actorId : null,
    organizationId: input.organizationId,
    observedAt: observed.rows[0].observed_at,
    contractRows: contracts.rows,
    periodRows: periods.rows,
    ticketRows: tickets.rows
  });
}

export function createPostgresCareSurfaceRepository({
  authority,
  coreRepository
} = {}) {
  const database = validateAuthority(authority);
  const core = validateCore(coreRepository);
  return Object.freeze({
    readiness: () => core.readiness(),
    async assertOperatorCapabilities(input) {
      validScope(input);
      capabilities(input.capabilities);
      return guarded(() => database.service(
        context(input, "operator"),
        async (client) => {
          await requireCapabilities(client, input.actorId, input.capabilities);
          return true;
        }
      ));
    },
    async readCustomerDashboard(input) {
      validScope(input);
      return guarded(() => database.service(
        context(input, "customer"),
        (client) => readDashboard(client, input, "customer")
      ));
    },
    async readOperatorDashboard(input) {
      validScope(input);
      return guarded(() => database.service(
        context(input, "operator"),
        async (client) => {
          await requireCapabilities(
            client,
            input.actorId,
            [CARE_OPERATOR_CAPABILITY]
          );
          return readDashboard(client, input, "operator");
        }
      ));
    },
    async resolveAssessmentFindingId(input) {
      validScope(input);
      invariant(
        UUID.test(input.projectId) && SHA256.test(input.findingDigest),
        "CARE_SURFACE_INVALID",
        "Assessment finding digest scope is invalid.",
        { status: 400 }
      );
      return guarded(() => database.service(
        context(input, "operator"),
        async (client) => {
          await requireCapabilities(
            client,
            input.actorId,
            [CARE_OPERATOR_CAPABILITY]
          );
          const selected = await client.query(
            `/* care-surfaces:assessment-finding-digest */
             select finding.finding_id
               from ss.service_assessment_report_findings finding
               join ss.service_assessment_reports report
                 on report.organization_id = finding.organization_id
                and report.job_id = finding.job_id
                and report.id = finding.report_id
               join ss.service_assessment_jobs job
                 on job.organization_id = report.organization_id
                and job.id = report.job_id
              where finding.organization_id = $1
                and job.project_id = $2
                and finding.finding_digest = $3
              limit 2`,
            [input.organizationId, input.projectId, input.findingDigest]
          );
          invariant(
            selected.rowCount === 1 && UUID.test(selected.rows[0].finding_id),
            "CARE_SURFACE_UNAVAILABLE",
            "The assessment finding is unavailable.",
            { status: 404 }
          );
          return selected.rows[0].finding_id;
        }
      ));
    },
    async resolveTicketMailScope(input) {
      validScope(input);
      invariant(
        UUID.test(input.ticketId),
        "CARE_SURFACE_INVALID",
        "Care ticket ID is invalid.",
        { status: 400 }
      );
      return guarded(() => database.service(
        context(input, "operator"),
        async (client) => {
          await requireCapabilities(client, input.actorId, [
            CARE_MAIL_CAPABILITY,
            CARE_OPERATOR_CAPABILITY
          ]);
          const selected = await client.query(
            `/* care-surfaces:mail-scope */
             select ticket.project_id, contract.customer_user_id
               from ss.care_tickets ticket
               join ss.care_customer_contracts contract
                 on contract.organization_id = ticket.organization_id
                and contract.id = ticket.contract_id
              where ticket.organization_id = $1 and ticket.id = $2`,
            [input.organizationId, input.ticketId]
          );
          invariant(
            selected.rowCount === 1 &&
              UUID.test(selected.rows[0].project_id) &&
              UUID.test(selected.rows[0].customer_user_id),
            "CARE_SURFACE_UNAVAILABLE",
            "The Care ticket is unavailable.",
            { status: 404 }
          );
          return deepFreeze({
            projectId: selected.rows[0].project_id,
            customerUserId: selected.rows[0].customer_user_id
          });
        }
      ));
    },
    openPeriod: (input) => core.openPeriod(input),
    closePeriod: (input) => core.closePeriod(input),
    openTicket: (input) => core.openTicket(input),
    transitionTicket: (input) => core.transitionTicket(input),
    allocateCapacity: (input) => core.allocateCapacity(input)
  });
}
