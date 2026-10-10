import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { SelfHostRuntime } from "../../selfhost/src/index.mjs";
import { files, installAndActivate, tenantRequest } from "../../selfhost/test/helpers.mjs";
import { createPrivateExportObjectStore } from "../export-object-store.mjs";
import { createLeasedLifecycleWorker } from "../leased-lifecycle-worker.mjs";
import { createPostgresProjectLifecycleRepository, createProjectLifecycleExecutor } from "../project-lifecycle-postgres.mjs";
import { createPublicationCommandClient, createPublicationCommandConfiguration, createPublicationCommandServer } from "../publication-command-transport.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createSelfHostPublicationPort } from "../selfhost-publication-port.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_ERASURE_TEST_URL;
const WORKER_ID = "project-lifecycle-erasure-fixture";
const now = () => new Date().toISOString();

test("PostgreSQL deletion requires actual single-writer publication erasure", { skip: !DATABASE_URL, timeout: 60_000 }, async (t) => {
  assert.match(new URL(DATABASE_URL).pathname, /^\/ss_erasure_[a-z0-9_]+$/u);
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  const createdProjects = [];
  // Unix sockets need a short path on macOS; all state below this owned root.
  const root = await mkdtemp(path.join(await realpath("/tmp"), "ss-erase-"));
  let server;
  try {
    assert.equal(Math.floor(Number((await pool.query("show server_version_num")).rows[0].server_version_num) / 10_000), 16);
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresProjectLifecycleRepository({ authority });
    assert.equal((await repository.readiness()).ready, true);
    const runtime = await SelfHostRuntime.open({ root: path.join(root, "publication"), publicationHeld: false });
    const port = createSelfHostPublicationPort({ runtime });
    const configuration = createPublicationCommandConfiguration({
      socketPath: path.join(root, "publication.sock"), allowedSocketRoot: root,
      token: Buffer.alloc(32, 9).toString("base64url")
    });
    server = createPublicationCommandServer({ publicationPort: port, configuration });
    await server.start();
    const client = createPublicationCommandClient({ configuration });
    const objects = await createPrivateExportObjectStore({ root: path.join(root, "exports") });
    const executor = createProjectLifecycleExecutor({ publicationPort: client, objectStore: objects });
    const policy = (await pool.query("select id from ss.billing_policies order by id limit 1")).rows[0].id;

    async function project() {
      const userId = randomUUID(), organizationId = randomUUID(), projectId = randomUUID();
      await pool.query("insert into auth.users (id,email) values ($1,$2)", [userId, `erasure-${userId}@example.test`]);
      await pool.query("insert into ss.organizations (id,created_by_user_id,name) values ($1,$2,'Erasure fixture')", [organizationId, userId]);
      await pool.query(`insert into ss.projects (id,organization_id,created_by_user_id,billing_policy_id,name)
        values ($1,$2,$3,$4,'Erasure fixture')`, [projectId, organizationId, userId, policy]);
      createdProjects.push(projectId);
      return { userId, organizationId, projectId };
    }
    async function seal(p) {
      const deletionRequestId = (await pool.query(
        "select ss.begin_terminal_project_purge($1,'ss07-fixture-v1',$2) as id", [p.projectId, p.userId]
      )).rows[0].id;
      await pool.query("update ss.lifecycle_jobs set run_at='2000-01-01' where project_id=$1", [p.projectId]);
      return { ...p, deletionRequestId };
    }
    async function finalizeJob(p) {
      return (await pool.query("select * from ss.lifecycle_jobs where project_id=$1 and job_type='finalize_deletion'", [p.projectId])).rows[0];
    }

    await t.test("database rejects missing, wrong-scope, stale-fence, wrong-request and expired receipts", async () => {
      const p = await seal(await project());
      const other = await project();
      const job = await finalizeJob(p);
      for (const variant of ["missing", "wrong-scope", "stale-fence", "wrong-request", "expired", "pending-unpublish"]) {
        const connection = await pool.connect();
        try {
          await connection.query("begin");
          await connection.query(`update ss.lifecycle_jobs set state='running', locked_by=$2,
            locked_at=clock_timestamp()-interval '2 minutes', lease_expires_at=clock_timestamp()+interval '1 minute', lease_fence=1
            where id=$1`, [job.id, WORKER_ID]);
          if (variant !== "missing") {
            await connection.query(`insert into ss.project_lifecycle_job_receipts
              (organization_id,project_id,lifecycle_job_id,lease_fence,receipt_kind,result_digest,recorded_at)
              values ($1,$2,$3,$4,'project_deleted',$5,clock_timestamp())`,
            [variant === "wrong-scope" ? other.organizationId : p.organizationId,
              variant === "wrong-scope" ? other.projectId : p.projectId, job.id,
              variant === "stale-fence" ? 2 : 1, "a".repeat(64)]);
          }
          if (variant === "wrong-request") await connection.query(
            "update ss.lifecycle_jobs set payload=jsonb_set(payload,'{deletionRequestId}',to_jsonb($2::text)) where id=$1", [job.id, randomUUID()]);
          if (variant === "expired") await connection.query(
            "update ss.lifecycle_jobs set lease_expires_at=clock_timestamp()-interval '1 minute' where id=$1", [job.id]);
          if (variant === "pending-unpublish") await connection.query(`insert into ss.lifecycle_jobs
            (organization_id,project_id,job_type,dedupe_key,run_at,payload)
            values ($1,$2,'unpublish_project',$3,clock_timestamp(),'{}')`, [p.organizationId,p.projectId,randomUUID()]);
          await assert.rejects(connection.query("select ss.finalize_terminal_project_purge($1)", [p.projectId]), { code: "55000" }, variant);
        } finally { await connection.query("rollback"); connection.release(); }
      }
      // This fixture deliberately remains pending; it must not precede the
      // independently exercised end-to-end worker project below.
      await pool.query("update ss.lifecycle_jobs set run_at='2100-01-01' where project_id=$1", [p.projectId]);
      assert.equal((await pool.query("select lifecycle from ss.projects where id=$1", [p.projectId])).rows[0].lifecycle, "deleting");
    });

    await t.test("the real worker erases published/staged copies and exports before completing, with durable replay", async () => {
      const p = await project(); const other = await project();
      await installAndActivate(runtime, { projectId: p.projectId, hostname: "delete.example" });
      await runtime.installRelease({ projectId: p.projectId, releaseId: "older-release", files: files("older") });
      await installAndActivate(runtime, { projectId: other.projectId, hostname: "keep.example", label: "neighbor" });
      const serving = await SelfHostRuntime.openServing({ root: runtime.root, publicationHeld: false });
      const stage = path.join(runtime.releases.root,p.projectId,".stage-orphan");
      await mkdir(stage); await writeFile(path.join(stage,"partial"),"unfinished");
      const exportId = randomUUID();
      const saved = await objects.put({ ...p, exportId, attempt: 1, fence: 1, bytes: Buffer.from("synthetic export") });
      await pool.query(`insert into ss.export_requests
        (id,organization_id,project_id,requested_by_user_id,state,object_key,manifest_digest,byte_count,
         object_attempt_number,object_fence_token,fence_token,completed_at,expires_at)
        values ($1,$2,$3,$4,'ready',$5,$6,$7,1,1,1,clock_timestamp(),clock_timestamp()+interval '1 day')`,
      [exportId,p.organizationId,p.projectId,p.userId,saved.key,saved.sha256,saved.byteLength]);
      const sealed = await seal(p);
      const jobs = (await pool.query("select * from ss.lifecycle_jobs where project_id=$1",[p.projectId])).rows;
      const blob = jobs.find(row=>row.job_type==='delete_blob');
      assert.equal(blob.payload.storageKind,"private_export");
      assert.deepEqual(blob.payload.storageOrigins,{artifactProviders:[],privateExport:true});
      await assert.rejects(pool.query("select ss.finalize_terminal_project_purge($1)",[p.projectId]),{code:"55000"});
      const worker = createLeasedLifecycleWorker({ purpose:"project-lifecycle",repository,executor,enabled:true,batchLimit:jobs.length });
      const result = await worker.runOnce();
      assert.equal(result.completed,jobs.length,JSON.stringify(result));
      assert.equal(result.released,0);
      const state = (await pool.query(`select p.lifecycle,r.state from ss.projects p join ss.deletion_requests r
        on r.project_id=p.id where p.id=$1`,[p.projectId])).rows[0];
      assert.deepEqual(state,{lifecycle:"deleted",state:"completed"});
      assert.equal((await serving.fetch(tenantRequest("delete.example"))).status,404);
      assert.equal((await serving.fetch(tenantRequest("keep.example"))).status,200);
      await assert.rejects(lstat(path.join(runtime.releases.root,p.projectId)),{code:"ENOENT"});
      assert.deepEqual(await objects.delete({key:saved.key}),{deleted:false,key:saved.key});
      assert.equal((await client.purgeProject({organizationId:p.organizationId,projectId:p.projectId,deletionRequestId:sealed.deletionRequestId})).erased,true);
      await assert.rejects(runtime.installRelease({projectId:p.projectId,releaseId:"late",files:files("late")}),{code:"PROJECT_DELETED"});
      assert.equal((await pool.query(`select count(*)::integer as count from ss.project_lifecycle_job_receipts
        where project_id=$1 and receipt_kind='project_deleted'`,[p.projectId])).rows[0].count,1);
    });

    await t.test("unconfirmed or interrupted erasure never completes and a new lease can retry", async () => {
      const p = await seal(await project());
      // A historical local publication may remain even though SQL is sealed.
      await installAndActivate(runtime,{projectId:p.projectId,hostname:"retry.example"});
      const unsafe = path.join(runtime.releases.root,p.projectId,"unsafe");
      await symlink(root,unsafe);
      const selected = await repository.claimNext({workerId:WORKER_ID,observedAt:now(),leaseSeconds:60});
      assert.equal(selected.projectId,p.projectId);
      const completion={jobId:selected.jobId,fence:selected.fence,workerId:WORKER_ID,observedAt:now()};
      await assert.rejects(repository.completeClaim({...completion,result:{receiptKind:"project_deleted",result:{erased:true}}}),
        {code:"PROJECT_LIFECYCLE_EFFECT_UNCONFIRMED"});
      await assert.rejects(executor.execute(selected),{code:"PUBLICATION_ENGINE_UNAVAILABLE"});
      assert.equal((await pool.query("select lifecycle from ss.projects where id=$1",[p.projectId])).rows[0].lifecycle,"deleting");
      await repository.releaseClaim({...completion,failureCode:"ERASURE_FIXTURE_INTERRUPTED",retryAt:now(),observedAt:now()});
      await unlink(unsafe);
      await pool.query("update ss.lifecycle_jobs set run_at='2000-01-01' where id=$1",[selected.jobId]);
      const retry=await repository.claimNext({workerId:WORKER_ID,observedAt:now(),leaseSeconds:60});
      assert.equal(retry.jobId,selected.jobId);assert.equal(retry.fence,selected.fence+1);
      const erased=await executor.execute(retry);
      await assert.rejects(repository.completeClaim({...completion,observedAt:now(),result:erased}),{code:"PROJECT_LIFECYCLE_LEASE_LOST"});
      assert.equal((await repository.completeClaim({...completion,fence:retry.fence,observedAt:now(),result:erased})).status,"succeeded");
    });

    await t.test("equal replica keys retain all providers and cannot suppress another project's deletion dependency", async () => {
      const first=await project(), second=await project();
      const key=`shared-${randomUUID()}`;
      for(const [p,providers] of [[first,["fixture-a","fixture-b"]],[second,["fixture-c"]]]) {
        const artifact=(await pool.query(`insert into ss.artifacts(organization_id,project_id,html_bytes)
          values($1,$2,$3) returning id`,[p.organizationId,p.projectId,Buffer.from("x".repeat(80))])).rows[0].id;
        for(const provider of providers) await pool.query(`insert into ss.artifact_replicas
          (organization_id,artifact_id,provider_code,object_key,replica_digest) values($1,$2,$3,$4,$5)`,
        [p.organizationId,artifact,provider,key,"b".repeat(64)]);
        await seal(p);
      }
      const rows=(await pool.query("select * from ss.lifecycle_jobs where project_id=any($1::uuid[]) and job_type='delete_blob'",[[first.projectId,second.projectId]])).rows;
      assert.equal(rows.length,2);assert.notEqual(rows[0].dedupe_key,rows[1].dedupe_key);
      for(const row of rows){
        assert.equal(row.payload.storageKind,"unsupported");
        assert.deepEqual(row.payload.storageOrigins.artifactProviders,row.project_id===first.projectId?["fixture-a","fixture-b"]:["fixture-c"]);
        await assert.rejects(executor.execute({jobType:"delete_blob",organizationId:row.organization_id,projectId:row.project_id,payload:row.payload}),
          {code:"PROJECT_LIFECYCLE_STORAGE_UNSUPPORTED"});
        await assert.rejects(pool.query("select ss.finalize_terminal_project_purge($1)",[row.project_id]),{code:"55000"});
      }
    });
  } finally {
    if(server)await server.stop();
    await pool.query("update ss.lifecycle_jobs set run_at='2100-01-01' where project_id=any($1::uuid[])", [createdProjects]);
    await pool.end();
    async function writable(directory){await chmod(directory,0o700);for(const e of await readdir(directory,{withFileTypes:true}))if(e.isDirectory()&&!e.isSymbolicLink())await writable(path.join(directory,e.name));}
    await writable(root);await rm(root,{recursive:true});
  }
});
