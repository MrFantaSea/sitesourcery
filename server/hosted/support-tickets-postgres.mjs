import { randomUUID } from "node:crypto";
import { HostedError, invariant } from "./errors.mjs";

export const SUPPORT_TICKET_METHODS = Object.freeze([
  "listCustomerTickets", "readCustomerTicket", "replyCustomerTicket",
  "readOperatorTicket", "replyOperatorTicket"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const iso = value => value instanceof Date ? value.toISOString() : value;
const unavailable = () => new HostedError("SUPPORT_TICKET_UNAVAILABLE", "This conversation is unavailable.", { status: 404 });

function inputFor(value, operator, operation) {
  const keys = ["actorId", operator ? "operatorOrganizationId" : "organizationId"];
  if (!operator) keys.push("projectId");
  if (operation !== "list") keys.push("ticketId");
  if (operation === "reply") {
    keys.push("commandId", "message");
    if (operator) keys.push("resolve");
  } else keys.push("beforeId");
  invariant(value && Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort()),
  "SUPPORT_TICKET_INVALID", "Conversation request is invalid.", { status: 400 });
  for (const key of keys.filter(key => key.endsWith("Id") && key !== "commandId")) {
    invariant((key === "beforeId" && value[key] === null) || UUID.test(value[key] ?? ""),
      "SUPPORT_TICKET_INVALID", "Conversation identity is invalid.", { status: 400 });
  }
  if (operation === "reply") {
    invariant(typeof value.commandId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(value.commandId) &&
      typeof value.message === "string" && value.message.trim().length > 0 && value.message.length <= 4000 &&
      (!operator || typeof value.resolve === "boolean"),
    "SUPPORT_TICKET_INVALID", "Enter a message of at most 4,000 characters.", { status: 400 });
  }
  return value;
}

function summary(row) {
  return { id: row.id, organizationId: row.organization_id, projectId: row.project_id,
    subject: row.subject, state: row.state, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

// Ordinary correspondence stays in the existing purgeable ticket/message store.
// Privacy case audit records remain separate and contain no message bodies.
export function createSupportTicketRepository({ authority }) {
  async function scoped(input, operator, operation, work) {
    const selected = inputFor(input, operator, operation);
    try {
      return await authority.service({
        actorKind: operator ? "operator" : "customer", userId: selected.actorId,
        organizationId: operator ? selected.operatorOrganizationId : selected.organizationId,
        isolation: "serializable", readOnly: operation !== "reply"
      }, async client => {
        const allowed = await client.query(`select exists (
          select 1 from ss.organizations o join ss.organization_memberships m on m.organization_id=o.id
          where o.id=$2 and o.state='active' and m.user_id=$1 and m.state='active'
        ) ${operator ? "and ss.service_operator_has_capability($1, 'service_case_manage', clock_timestamp())" : ""} as allowed`,
        [selected.actorId, operator ? selected.operatorOrganizationId : selected.organizationId]);
        if (allowed.rows[0]?.allowed !== true) throw unavailable();
        return work(client, selected);
      });
    } catch (error) {
      if (["40001", "40P01", "55P03"].includes(error?.code) ||
        (error?.code === "23505" && error.constraint === "support_message_actor_command")) {
        throw new HostedError("SUPPORT_TICKET_RETRY_REQUIRED", "The conversation changed. Retry the same message safely.", { status: 409 });
      }
      throw error;
    }
  }

  async function ticket(client, input, operator, lock = false) {
    const result = await client.query(`select t.* from ss.support_tickets t
      join ss.projects p on p.organization_id=t.organization_id and p.id=t.project_id
      join ss.organizations o on o.id=t.organization_id
      where t.id=$1 and p.lifecycle='active' and o.state='active'
      ${operator ? "" : "and t.opened_by_user_id=$2 and t.organization_id=$3 and t.project_id=$4"}
      ${lock ? "for update of t for share of p, o" : ""}`,
    operator ? [input.ticketId] : [input.ticketId,input.actorId,input.organizationId,input.projectId]);
    if (result.rowCount !== 1) throw unavailable();
    return result.rows[0];
  }

  async function conversation(client, row, beforeId = null) {
    let before = null;
    if (beforeId) {
      before = (await client.query("select created_at,id from ss.support_messages where ticket_id=$1 and id=$2", [row.id,beforeId])).rows[0];
      if (!before) throw unavailable();
    }
    const result = await client.query(`select id,author_kind,body,created_at from ss.support_messages
      where organization_id=$1 and project_id=$2 and ticket_id=$3
      ${before ? "and (created_at,id)<($4,$5)" : ""}
      order by created_at desc,id desc limit 51`,
    [row.organization_id,row.project_id,row.id,...(before ? [before.created_at,before.id] : [])]);
    const page = result.rows.slice(0,50);
    return { schema:"sitesourcery.support-conversation/v1", ticket:summary(row),
      nextBeforeId:result.rows.length>50 ? page.at(-1).id : null,
      messages:page.reverse().map(message => ({id:message.id,authorKind:message.author_kind,
        body:message.body,createdAt:iso(message.created_at)})) };
  }

  function read(input, operator) {
    return scoped(input,operator,"read",async (client, selected) =>
      conversation(client,await ticket(client,selected,operator),selected.beforeId));
  }

  function reply(input, operator) {
    return scoped(input,operator,"reply",async (client, selected) => {
      // Actor/key locking precedes the ticket lock; retries across different
      // tickets cannot turn a reused key into a second message.
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [selected.actorId+":"+selected.commandId]);
      const row = await ticket(client,selected,operator,true);
      const previous = (await client.query(`select ticket_id,organization_id,project_id,author_kind,body,resolved_ticket
        from ss.support_messages where author_user_id=$1 and command_id=$2`,[selected.actorId,selected.commandId])).rows[0];
      const authorKind = operator ? "support" : "customer";
      const resolve = operator && selected.resolve;
      if (previous) {
        invariant(previous.ticket_id===row.id && previous.organization_id===row.organization_id &&
          previous.project_id===row.project_id && previous.author_kind===authorKind &&
          previous.body===selected.message && previous.resolved_ticket===resolve,
        "SUPPORT_TICKET_IDEMPOTENCY_CONFLICT", "That message key was already used for another request.", { status:409 });
        return conversation(client,row);
      }
      invariant(row.state!=="closed", "SUPPORT_TICKET_CLOSED", "This conversation is closed. Open a new support request.", { status:409 });
      await client.query(`insert into ss.support_messages
        (id,organization_id,project_id,ticket_id,author_kind,author_user_id,body,command_id,resolved_ticket)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(),row.organization_id,row.project_id,row.id,authorKind,selected.actorId,selected.message,selected.commandId,resolve]);
      const updated = (await client.query(`update ss.support_tickets set state=$2 where id=$1 returning *`,
        [row.id,resolve ? "resolved" : operator ? "waiting_customer" : "waiting_support"])).rows[0];
      return conversation(client,updated);
    });
  }

  return Object.freeze({
    listCustomerTickets(input) {
      return scoped(input,false,"list",async (client,selected) => {
        const project = await client.query(`select 1 from ss.projects
          where id=$1 and organization_id=$2 and lifecycle='active'`,[selected.projectId,selected.organizationId]);
        if (project.rowCount!==1) throw unavailable();
        let before=null;
        if(selected.beforeId) before=await ticket(client,{...selected,ticketId:selected.beforeId},false);
        const result=await client.query(`select * from ss.support_tickets
          where organization_id=$1 and project_id=$2 and opened_by_user_id=$3
          ${before ? "and (created_at,id)<($4,$5)" : ""}
          order by created_at desc,id desc limit 51`,
        [selected.organizationId,selected.projectId,selected.actorId,...(before ? [before.created_at,before.id] : [])]);
        const page=result.rows.slice(0,50);
        return {schema:"sitesourcery.support-ticket-list/v1",tickets:page.map(summary),
          nextBeforeId:result.rows.length>50 ? page.at(-1).id : null};
      });
    },
    readCustomerTicket: input => read(input,false),
    replyCustomerTicket: input => reply(input,false),
    readOperatorTicket: input => read(input,true),
    replyOperatorTicket: input => reply(input,true)
  });
}
