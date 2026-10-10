import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import { createPostgresSupportCaseRepository } from "../support-cases-postgres.mjs";
import { createSupportCaseService } from "../support-cases.mjs";
import { createPostgresOperatorWorkQueueRepository } from "../operator-work-queue-postgres.mjs";
import { createHostedApi } from "../http.mjs";

const URL = process.env.SITESOURCERY_PG_SUPPORT_TEST_URL;
const ORIGIN = "https://app.sitesourcery.test";

test("ordinary support reaches HQ and returns real persisted replies with exact isolation", {skip:!URL,timeout:60_000}, async t => {
  assert.match(new globalThis.URL(URL).pathname,/^\/ss_support_[a-z0-9_]+$/u);
  const pool=new pg.Pool({connectionString:URL,max:5});
  try {
    const authority=createCanonicalPostgresAuthority({pool});
    const sessions=new Map();
    const noEffect=async()=>{throw new Error("Unexpected external/identity fixture call");};
    const identity=Object.fromEntries(["register","completeRegistration","registrationReadiness","signIn","signOut","issueRecoveryForDelivery","completeRecovery","requireRecentReauthentication"].map(name=>[name,noEffect]));
    identity.authenticate=async token=>sessions.get(token)??null;
    const service=createCanonicalPostgresService({authority,identity,compiler:{revision:"fixture",compile:noEffect},catalogPort:{current:noEffect},
      publicationPort:{request:noEffect,rollback:noEffect,unpublish:noEffect},exportStore:{key:noEffect,put:noEffect,get:noEffect,delete:noEffect},
      recoveryMailPort:{readiness:noEffect,deliver:noEffect}});
    const repository=createPostgresSupportCaseRepository({authority});
    const supportCases=createSupportCaseService({repository,mailLifecycle:{kind:"durable-mail-lifecycle",providerEffects:false,reserve:noEffect},clock:{now:()=>new Date().toISOString()}});
    assert.equal((await supportCases.readiness()).ready,true);
    const queue=createPostgresOperatorWorkQueueRepository({authority});
    const api=createHostedApi(service,{supportCases,operatorWorkQueue:{providerEffects:false,alertEffects:false,genericRepair:false,
      list:input=>queue.list(input),refresh:input=>queue.refresh(input),dispatchProfessionalReversalRepair:noEffect}});
    const policy=(await pool.query("select id from ss.billing_policies order by id limit 1")).rows[0].id;
    async function actor(organizationId=null) {
      const userId=randomUUID(),org=organizationId??randomUUID(),token=randomUUID();
      await pool.query("insert into auth.users(id,email) values($1,$2)",[userId,`support-${userId}@example.test`]);
      await pool.query("insert into ss.hosted_account_profiles(user_id,display_name) values($1,'Support fixture')",[userId]);
      if(!organizationId) await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Support fixture')",[org,userId]);
      await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')",[org,userId]);
      sessions.set(token,{userId});return {userId,organizationId:org,token};
    }
    async function project(who) {
      const id=randomUUID();await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Support fixture')",[id,who.organizationId,who.userId,policy]);return id;
    }
    async function request(who,path,{body,command=randomUUID(),origin=ORIGIN,csrf=true}={}) {
      const headers={Cookie:`ss_session=${who.token}; ss_csrf=${"c".repeat(32)}`};
      if(body!==undefined)Object.assign(headers,{Origin:origin,"Content-Type":"application/json","Idempotency-Key":command,...(csrf?{"X-CSRF-Token":"c".repeat(32)}:{})});
      const response=await api.fetch(new Request(ORIGIN+path,{method:body===undefined?"GET":"POST",headers,body:body===undefined?undefined:JSON.stringify(body)}));
      return {status:response.status,body:await response.json()};
    }
    const customer=await actor(),foreign=await actor(),peer=await actor(customer.organizationId),operator=await actor();
    const projectId=await project(customer),otherProjectId=await project(customer);
    await pool.query("insert into ss.operator_profiles(user_id,display_label,state,authorized_by_user_id,authorized_at) values($1,'Fixture owner','held',$1,clock_timestamp())",[operator.userId]);
    for(const capability of ["service_case_manage","service_management_manage"]){
      await pool.query("insert into ss.operator_permissions(operator_user_id,capability,state,granted_by_user_id,granted_at) values($1,$2,'held',$1,clock_timestamp())",[operator.userId,capability]);
      await pool.query(`insert into ss.service_operator_authority_events(operator_user_id,capability,event_sequence,event_kind,recorded_by_kind,effective_at,expires_at,created_at)
        values($1,$2,1,'grant','deployment_control',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day',clock_timestamp())`,[operator.userId,capability]);
    }
    const createPath=`/api/v1/projects/${projectId}/support-tickets`;
    let ticketId;
    const customerScope={organizationId:customer.organizationId,projectId};
    const query=new URLSearchParams(customerScope).toString();
    const operatorScope={operatorOrganizationId:operator.organizationId};

    await t.test("existing customer create API is idempotent and appears immediately in the actual owner queue",async()=>{
      const body={subject:"A real fixture question",message:"My first message <script>never execute</script>"};
      const command=randomUUID();
      const first=await request(customer,createPath,{body,command});assert.equal(first.status,202,JSON.stringify(first));
      ticketId=first.body.supportTicket.id;
      assert.deepEqual(await request(customer,createPath,{body,command}),first);
      const list=await request(customer,`/api/v1/support-tickets?${query}`);assert.equal(list.status,200,JSON.stringify(list));
      assert.equal(list.body.tickets[0].id,ticketId);
      const ownerQueue=await request(operator,`/api/v1/operator/work-queue?operatorOrganizationId=${operator.organizationId}`);
      assert.equal(ownerQueue.status,200,JSON.stringify(ownerQueue));
      const item=ownerQueue.body.items.find(row=>row.kind==="support_ticket"&&row.source.id===ticketId);assert.ok(item);
      assert.equal(item.source.table,"ss.support_tickets");
      assert.doesNotMatch(JSON.stringify(item),/My first message|fixture question/);
      const read=await request(operator,`/api/v1/operator/support-tickets/${ticketId}?operatorOrganizationId=${operator.organizationId}`);
      assert.equal(read.status,200,JSON.stringify(read));assert.equal(read.body.messages[0].body,body.message);
    });
    await t.test("owner reply reaches customer; duplicate and changed retries cannot append extra messages",async()=>{
      const path=`/api/v1/operator/support-tickets/${ticketId}/messages`,command=randomUUID();
      const body={...operatorScope,message:"Here is the owner reply.",resolve:true};
      const reply=await request(operator,path,{body,command});assert.equal(reply.status,200,JSON.stringify(reply));
      assert.deepEqual(await request(operator,path,{body,command}),reply);
      assert.equal((await request(operator,path,{body:{...body,message:"Changed"},command})).status,409);
      const read=await request(customer,`/api/v1/support-tickets/${ticketId}?${query}`);
      assert.equal(read.body.ticket.state,"resolved");assert.equal(read.body.messages.at(-1).body,body.message);
      assert.equal(read.body.messages.at(-1).authorKind,"support");
      const customerReply=await request(customer,`/api/v1/support-tickets/${ticketId}/messages`,{body:{...customerScope,message:"One more question."}});
      assert.equal(customerReply.status,200,JSON.stringify(customerReply));assert.equal(customerReply.body.ticket.state,"waiting_support");
      assert.equal((await queue.list({actorId:operator.userId,...operatorScope})).items.some(item=>item.source.id===ticketId),true);
      assert.equal((await pool.query("select count(*)::int as count from ss.support_messages where ticket_id=$1",[ticketId])).rows[0].count,3);
    });
    await t.test("foreign tenants, same-organization peers, forged scope, unprivileged owners and CSRF fail closed",async()=>{
      for(const who of [foreign,peer]) {
        assert.equal((await request(who,`/api/v1/support-tickets/${ticketId}?${query}`)).status,404);
        assert.equal((await request(who,`/api/v1/support-tickets/${ticketId}/messages`,{body:{...customerScope,message:"forbidden"}})).status,404);
      }
      assert.equal((await request(customer,`/api/v1/support-tickets/${ticketId}?organizationId=${customer.organizationId}&projectId=${otherProjectId}`)).status,404);
      assert.equal((await request(customer,`/api/v1/operator/support-tickets/${ticketId}?operatorOrganizationId=${customer.organizationId}`)).status,404);
      assert.equal((await request(operator,`/api/v1/operator/support-tickets/${ticketId}/messages`,{body:{...operatorScope,message:"CSRF denied",resolve:false},csrf:false})).status,403);
      assert.equal((await request(operator,`/api/v1/operator/support-tickets/${ticketId}/messages`,{body:{...operatorScope,message:"forged author",resolve:false,authorId:customer.userId}})).status,400);
    });
    await t.test("concurrent cross-ticket key reuse returns safe retry/conflict and persists exactly once",async()=>{
      const other=(await request(customer,createPath,{body:{subject:"Second question",message:"Another conversation"}})).body.supportTicket.id;
      const command=randomUUID();
      const inputs=[ticketId,other].map(id=>({actorId:operator.userId,...operatorScope,ticketId:id,message:"Concurrent owner reply",resolve:false,commandId:command}));
      const outcomes=await Promise.allSettled(inputs.map(input=>repository.replyOperatorTicket(input)));
      assert.equal(outcomes.filter(row=>row.status==="fulfilled").length,1);
      const failed=outcomes.findIndex(row=>row.status==="rejected");
      assert.ok(["SUPPORT_TICKET_RETRY_REQUIRED","SUPPORT_TICKET_IDEMPOTENCY_CONFLICT"].includes(outcomes[failed].reason.code));
      await assert.rejects(repository.replyOperatorTicket(inputs[failed]),{code:"SUPPORT_TICKET_IDEMPOTENCY_CONFLICT"});
      assert.equal((await pool.query("select count(*)::int as count from ss.support_messages where author_user_id=$1 and command_id=$2",[operator.userId,command])).rows[0].count,1);
    });
    await t.test("history pagination is scoped, deterministic and preserves legacy messages",async()=>{
      await pool.query(`insert into ss.support_messages(organization_id,project_id,ticket_id,author_kind,author_user_id,body,created_at)
        select $1,$2,$3,'customer',$4,'Retained message '||i,clock_timestamp()-interval '1 day'+i*interval '1 second' from generate_series(1,55)i`,[customer.organizationId,projectId,ticketId,customer.userId]);
      const first=await repository.readCustomerTicket({actorId:customer.userId,...customerScope,ticketId,beforeId:null});
      assert.equal(first.messages.length,50);assert.ok(first.nextBeforeId);
      const older=await repository.readCustomerTicket({actorId:customer.userId,...customerScope,ticketId,beforeId:first.nextBeforeId});
      assert.equal(older.nextBeforeId,null);
      assert.equal(new Set([...first.messages,...older.messages].map(message=>message.id)).size,first.messages.length+older.messages.length);
      await assert.rejects(repository.readCustomerTicket({actorId:customer.userId,...customerScope,ticketId,beforeId:randomUUID()}),{code:"SUPPORT_TICKET_UNAVAILABLE"});
    });
    await t.test("deleting projects and revoked owner capability cannot disclose or append messages",async()=>{
      const activeTicket=(await request(customer,`/api/v1/projects/${otherProjectId}/support-tickets`,{body:{subject:"Active authority check",message:"Keep this separate"}})).body.supportTicket.id;
      await pool.query("select ss.begin_terminal_project_purge($1,'support-fixture-v1',$2)",[projectId,customer.userId]);
      assert.equal((await pool.query("select count(*)::int as count from ss.support_messages where project_id=$1",[projectId])).rows[0].count,0);
      await assert.rejects(repository.readCustomerTicket({actorId:customer.userId,...customerScope,ticketId,beforeId:null}),{code:"SUPPORT_TICKET_UNAVAILABLE"});
      await assert.rejects(repository.replyOperatorTicket({actorId:operator.userId,...operatorScope,ticketId,commandId:randomUUID(),message:"late reply",resolve:false}),{code:"SUPPORT_TICKET_UNAVAILABLE"});
      await pool.query(`insert into ss.service_operator_authority_events(operator_user_id,capability,event_sequence,event_kind,recorded_by_kind,effective_at,created_at)
        values($1,'service_case_manage',2,'revoke','deployment_control',clock_timestamp(),clock_timestamp())`,[operator.userId]);
      await assert.rejects(repository.readOperatorTicket({actorId:operator.userId,...operatorScope,ticketId:activeTicket,beforeId:null}),{code:"SUPPORT_TICKET_UNAVAILABLE"});
    });
  } finally {await pool.end();}
});
