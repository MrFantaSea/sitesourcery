import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const SURFACE_SCHEMA = "sitesourcery.responder-surface-dashboard/v1";
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);

function authority(value) {
  invariant(
    value && typeof value.service === "function",
    "RESPONDER_SURFACE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Responder surfaces.",
    { status: 500 }
  );
  return value;
}

function translated(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_SURFACE_UNAVAILABLE",
      "Responder state is unavailable.",
      { status: 404 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_SURFACE_CONFLICT",
      "Responder evidence is inconsistent.",
      { status: 409 }
    );
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

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function contact(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    routeKind: row.route_kind,
    routeDigest: row.route_digest,
    purpose: row.purpose,
    consentBasis: row.consent_basis,
    state: row.state,
    consentedAt: iso(row.consented_at),
    optedOutAt: row.opted_out_at ? iso(row.opted_out_at) : null,
    revision: Number(row.revision)
  };
}

function event(row) {
  return {
    id: row.id,
    interactionId: row.interaction_id,
    eventKind: row.event_kind,
    messageIntent: row.message_intent,
    state: row.state,
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    providerEffects: false
  };
}

function command(row) {
  return {
    id: row.id,
    interactionId: row.interaction_id,
    contactAuthorityId: row.contact_authority_id,
    messageKind: row.message_kind,
    state: row.state,
    heldReason: row.held_reason,
    requestedAt: iso(row.requested_at),
    providerEffects: false,
    deliveryClaimed: false
  };
}

function interaction(row, events, commands) {
  return {
    id: row.id,
    projectId: row.project_id,
    contactAuthorityId: row.contact_authority_id,
    routeDigest: row.route_digest,
    sourceKind: row.source_kind,
    state: row.state,
    handoffReason: row.handoff_reason,
    openedAt: iso(row.opened_at),
    lastEventAt: iso(row.last_event_at),
    revision: Number(row.revision),
    events,
    heldCommands: commands
  };
}

async function requireCustomer(client, selected) {
  const membership = await client.query(
    `select 1 from ss.organization_memberships
      where organization_id = $1 and user_id = $2 and state = 'active'`,
    [selected.organizationId, selected.userId]
  );
  invariant(
    membership.rowCount === 1,
    "RESPONDER_SURFACE_UNAVAILABLE",
    "Responder account state is unavailable.",
    { status: 404 }
  );
}

async function requireOperator(client, selected) {
  const capability = await client.query(
    `select ss.service_operator_has_capability(
       $1, 'service_management_manage', clock_timestamp()
     ) as allowed`,
    [selected.userId]
  );
  invariant(
    capability.rows[0]?.allowed === true,
    "RESPONDER_SURFACE_UNAVAILABLE",
    "Responder operator state is unavailable.",
    { status: 404 }
  );
}

async function projection(client, selected) {
  if (selected.kind === "customer") {
    await requireCustomer(client, selected);
  } else {
    await requireOperator(client, selected);
  }
  const customerFilter = selected.kind === "customer"
    ? "and customer_user_id = $2"
    : "";
  const contacts = await client.query(
    `select * from ss.responder_contact_authorities
      where organization_id = $1 ${customerFilter}
      order by consented_at desc, id desc limit 100`,
    selected.kind === "customer"
      ? [selected.organizationId, selected.userId]
      : [selected.organizationId]
  );
  const interactions = await client.query(
    selected.kind === "customer"
      ? `select interaction.* from ss.responder_interactions interaction
           join ss.responder_contact_authorities authority
             on authority.id = interaction.contact_authority_id
            and authority.organization_id = interaction.organization_id
          where interaction.organization_id = $1
            and authority.customer_user_id = $2
          order by interaction.last_event_at desc, interaction.id desc
          limit 100`
      : `select * from ss.responder_interactions
          where organization_id = $1
          order by last_event_at desc, id desc limit 200`,
    selected.kind === "customer"
      ? [selected.organizationId, selected.userId]
      : [selected.organizationId]
  );
  const interactionIds = interactions.rows.map((row) => row.id);
  const events = interactionIds.length === 0
    ? { rows: [] }
    : await client.query(
        `select id, interaction_id, event_kind, message_intent, state,
                occurred_at, recorded_at
           from ss.responder_provider_events
          where organization_id = $1 and interaction_id = any($2::uuid[])
          order by occurred_at, id limit 500`,
        [selected.organizationId, interactionIds]
      );
  const commands = interactionIds.length === 0
    ? { rows: [] }
    : await client.query(
        `select id, interaction_id, contact_authority_id, message_kind,
                state, held_reason, requested_at
           from ss.responder_message_commands
          where organization_id = $1 and interaction_id = any($2::uuid[])
          order by requested_at, id limit 500`,
        [selected.organizationId, interactionIds]
      );
  const control = await client.query(
    `select control.global_kill_engaged, control.state, control.revision,
            control.updated_at, observation.observed_at
       from (select clock_timestamp() as observed_at) observation
       left join ss.responder_runtime_controls control
         on control.organization_id = $1`,
    [selected.organizationId]
  );
  const eventGroups = Map.groupBy(events.rows.map(event), (row) =>
    row.interactionId
  );
  const commandGroups = Map.groupBy(commands.rows.map(command), (row) =>
    row.interactionId
  );
  const runtime = control.rows[0] ?? null;
  return deepFreeze({
    schema: SURFACE_SCHEMA,
    audience: selected.kind,
    organizationId: selected.organizationId,
    observedAt: iso(runtime?.observed_at ?? new Date(0)),
    mode: "held",
    globalKillEngaged: runtime?.global_kill_engaged !== false,
    sellable: false,
    billingEffects: false,
    providerEffects: false,
    contacts: contacts.rows.map(contact),
    interactions: interactions.rows.map((row) => interaction(
      row,
      eventGroups.get(row.id) ?? [],
      commandGroups.get(row.id) ?? []
    ))
  });
}

export function createPostgresResponderSurfaceRepository({ authority: value } = {}) {
  const database = authority(value);
  return Object.freeze({
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_responder_core_contract_v1()')
                is not null
                and ss.hosted_responder_core_contract_v1() =
                  'canonical-responder-core-v1-provider-neutral-held'
                as contract_ready,
              count(*) = 6 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "responder_contact_authorities",
            "responder_runtime_controls",
            "responder_interactions",
            "responder_provider_events",
            "responder_message_commands",
            "responder_control_commands"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-surfaces-postgres",
          mode: "held",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-surfaces-postgres",
          mode: "held",
          providerEffects: false
        });
      }
    },
    readCustomer(selected) {
      return guarded(() => database.service(
        {
          actorKind: "customer",
          userId: selected.userId,
          organizationId: selected.organizationId,
          readOnly: true
        },
        (client) => projection(client, { ...selected, kind: "customer" })
      ));
    },
    readOperator(selected) {
      return guarded(() => database.service(
        {
          actorKind: "operator",
          userId: selected.userId,
          organizationId: selected.organizationId,
          readOnly: true
        },
        (client) => projection(client, { ...selected, kind: "operator" })
      ));
    }
  });
}
