import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createCanonicalPostgresService } from "../postgres-service.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createExportWorkerHealthReader, createExportWorkerHealthRecorder } from "../export-worker-health.mjs";
import { createExportWorker } from "../export-worker.mjs";
import { createHostedApi } from "../http.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_EXPORT_ADMISSION_TEST_URL;
const ORIGIN = "https://app.sitesourcery.test";

test("exports admit only with fresh worker cycles while replay, isolation and downloads survive a hold", {skip: !DATABASE_URL, timeout: 60_000}, async t => {
  assert.match(new URL(DATABASE_URL).pathname, /^\/ss_export_admission_(?:[0-9]{8}|ci_[0-9]+_[0-9]+)$/u);
  const pool = new pg.Pool({connectionString: DATABASE_URL, max: 5});
  const scratch = await mkdtemp(path.join(os.tmpdir(), "ss-export-admission-"));
  let worker;
  try {
    let now = Date.now();
    const clock = {now: () => new Date(now).toISOString()};
    const filePath = path.join(scratch, "export-health.json");
    const health = createExportWorkerHealthReader({filePath, now: () => now});
    const recorder = createExportWorkerHealthRecorder({filePath, now: () => now});
    const authority = createCanonicalPostgresAuthority({pool});
    const sessions = new Map();
    const noEffect = async () => {throw new Error("Unexpected external fixture call");};
    const identity = Object.fromEntries(["register", "completeRegistration", "registrationReadiness", "signIn", "signOut", "issueRecoveryForDelivery", "completeRecovery", "requireRecentReauthentication"].map(name => [name, noEffect]));
    identity.authenticate = async token => sessions.get(token) ?? null;
    const exportStore = await createPrivateExportObjectStore({root: path.join(scratch, "objects")});
    const service = createCanonicalPostgresService({authority, identity, clock,
      compiler: {revision: "fixture", compile: noEffect}, catalogPort: {current: noEffect},
      publicationPort: {request: noEffect, rollback: noEffect, unpublish: noEffect},
      exportStore, exportWorkerHealth: health, recoveryMailPort: {readiness: noEffect, deliver: noEffect}});
    const api = createHostedApi(service);
    const policy = (await pool.query("select id from ss.billing_policies order by id limit 1")).rows[0].id;
    async function fixtureActor() {
      const userId = randomUUID(), organizationId = randomUUID(), token = randomUUID(), projectId = randomUUID();
      await pool.query("insert into auth.users(id,email) values($1,$2)", [userId, `export-${userId}@example.test`]);
      await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Export fixture')", [organizationId,userId]);
      await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [organizationId,userId]);
      await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Export fixture')", [projectId,organizationId,userId,policy]);
      sessions.set(token,{userId});
      return {userId,organizationId,projectId,token};
    }
    async function request(who, url, {body, command = randomUUID(), csrf = true} = {}) {
      const headers = {Cookie: `ss_session=${who.token}; ss_csrf=${"c".repeat(32)}`};
      if(body !== undefined) Object.assign(headers,{Origin: ORIGIN,"Content-Type":"application/json","Idempotency-Key":command,...(csrf?{"X-CSRF-Token":"c".repeat(32)}:{})});
      return api.fetch(new Request(ORIGIN + url,{method: body === undefined ? "GET" : "POST",headers,body: body === undefined ? undefined : JSON.stringify(body)}));
    }
    async function cycle() {
      let completed;
      const completion = new Promise(resolve => {completed = resolve;});
      worker = createExportWorker({service,enabled:true,workerId:`hosted-export-${randomUUID()}`,
        log: entry => recorder.record(entry), wait: (_ms,signal) => {completed(); return new Promise(resolve => {if(signal.aborted)resolve();else signal.addEventListener("abort",resolve,{once:true});});}});
      worker.start(); await completion; await recorder.flush();
      assert.equal((await health.readiness()).ready,true);
    }
    async function stop() {await worker?.stop(); await recorder.flush(); worker = null;}
    const customer = await fixtureActor(), foreign = await fixtureActor();
    const endpoint = `/api/v1/projects/${customer.projectId}/exports`;
    let command, queued, exportId;
    await t.test("missing worker refuses new jobs and preserves tenant/CSRF checks",async()=>{
      let response = await request(customer,endpoint,{body:{}});
      assert.equal(response.status,503);assert.equal((await response.json()).error.code,"EXPORT_WORKER_UNAVAILABLE");
      assert.equal((await request(foreign,endpoint,{body:{}})).status,404);
      assert.equal((await request(customer,endpoint,{body:{},csrf:false})).status,403);
      assert.equal((await pool.query("select count(*)::int as n from ss.export_requests where project_id=$1",[customer.projectId])).rows[0].n,0);
      const project = await service.getProject({userId:customer.userId},customer.projectId);
      assert.equal(project.project.exportAvailability.ready,false);
    });
    await t.test("a real successful empty worker cycle opens admission and queues exactly once",async()=>{
      await cycle(); command = randomUUID();
      const response = await request(customer,endpoint,{body:{},command});
      assert.equal(response.status,202); queued = await response.json(); exportId = queued.export.exportId;
      assert.equal(queued.export.availability.ready,true);
      assert.deepEqual(await (await request(customer,endpoint,{body:{},command})).json(),queued);
      assert.equal((await pool.query("select count(*)::int as n from ss.export_requests where project_id=$1",[customer.projectId])).rows[0].n,1);
    });
    await t.test("stale/stopped health refuses new work but preserves an accepted replay and delayed status",async()=>{
      now += 121_000;
      assert.equal((await request(customer,endpoint,{body:{}})).status,503);
      await stop();
      assert.deepEqual(await (await request(customer,endpoint,{body:{},command})).json(),queued);
      now += 180_001;
      const current = await (await request(customer,`${endpoint}/${exportId}`)).json();
      assert.equal(current.export.status,"queued");assert.equal(current.export.availability.ready,false);assert.equal(current.export.delayed,true);
      assert.equal((await request(foreign,`${endpoint}/${exportId}`)).status,404);
      assert.equal((await pool.query("select count(*)::int as n from ss.export_requests where project_id=$1",[customer.projectId])).rows[0].n,1);
    });
    await t.test("real worker builds a ZIP; held-worker download stays exact and one-time",async()=>{
      await cycle(); await stop();
      const response = await request(customer,`${endpoint}/${exportId}`);
      assert.equal(response.status,200);const current = (await response.json()).export;
      assert.equal(current.status,"ready");assert.equal(current.availability.ready,false);
      const url = `${endpoint}/${exportId}/download?token=${encodeURIComponent(current.download.token)}`;
      assert.equal((await request(foreign,url)).status,404);
      const download = await request(customer,url);assert.equal(download.status,200);
      const bytes = Buffer.from(await download.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),"PK");
      const facts = (await pool.query("select manifest_digest,byte_count from ss.export_requests where id=$1",[exportId])).rows[0];
      assert.equal(createHash("sha256").update(bytes).digest("hex"),facts.manifest_digest);
      assert.equal(bytes.length,Number(facts.byte_count));assert.equal((await request(customer,url)).status,403);
    });
    await t.test("expired retry requires fresh health and its confirmed replay survives a later hold",async()=>{
      now = Date.parse((await pool.query("select expires_at from ss.export_requests where id=$1",[exportId])).rows[0].expires_at) + 1;
      assert.equal((await (await request(customer,`${endpoint}/${exportId}`)).json()).export.status,"expired");
      const retryPath = `${endpoint}/${exportId}/retry`;
      assert.equal((await request(customer,retryPath,{body:{}})).status,503);
      await cycle();const retryCommand = randomUUID();
      const response = await request(customer,retryPath,{body:{},command:retryCommand});assert.equal(response.status,202);
      const retried = await response.json();assert.equal(retried.export.status,"queued");
      await stop();assert.deepEqual(await (await request(customer,retryPath,{body:{},command:retryCommand})).json(),retried);
      assert.equal((await pool.query("select count(*)::int as n from ss.export_requests where project_id=$1",[customer.projectId])).rows[0].n,1);
    });
  } finally {await worker?.stop(); await pool.end(); await rm(scratch,{recursive:true,force:true});}
});
