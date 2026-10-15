import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createPostgresDomainProviderRouteComposition, createPostgresDomainProviderRouteRepository } from "../domain-provider-route-postgres.mjs";
import { createHeldDomainPriceChargeBoundary } from "../domain-price-charge-boundary.mjs";
import { createPostgresDomainLifecycleRepository } from "../domain-lifecycle-postgres.mjs";
import { createPostgresDomainLifecycleWorkerRepository } from "../domain-lifecycle-worker-postgres.mjs";
import { createHeldDomainProviderLifecycle, DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA } from "../../domain/provider-lifecycle.mjs";
import { createSpaceshipDomainLifecycleExecutor } from "../spaceship-domain-lifecycle-executor.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_DOMAIN_READBACK_TEST_URL;
const workerId = `domain-lifecycle-${randomUUID()}`;

async function seed(pool, authority, pending = null) {
  const customer = randomUUID(), organization = randomUUID(), project = randomUUID(), billing = randomUUID();
  const domain = `readback-${randomUUID()}.example`;
  const observedAt = new Date(Date.now() - 1000).toISOString();
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const expiry = new Date(Date.now() + 365 * 86400000).toISOString();
  await pool.query("insert into auth.users(id,email) values($1,$2)", [customer, `${customer}@example.test`]);
  await pool.query("insert into ss.billing_policies(id,policy_key,grace_period,retention_period,effective_at) values($1,$2,interval '14 days',interval '90 days',clock_timestamp())", [billing, `readback-${billing}`]);
  await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Domain Readback Fixture')", [organization,customer]);
  await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state,accepted_at) values($1,$2,'owner','active',clock_timestamp())", [organization,customer]);
  await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Domain Readback Fixture')", [project,organization,customer,billing]);
  const operationId = randomUUID(), quoteId = randomUUID();
  const registrar = {
    async previewRegistration() { return { status: "confirmation_required", domain, years: 1, price: { amountMinor: 1400, currency: "USD" },
      priceClass: "standard", quoteId, observedAt, expiresAt, noCharge: true }; },
    async confirmRegistration(input) { return { operationId, price: input.expectedPrice }; },
    async getOperation() { return { status: "success" }; },
    async getDomain() { return { name: domain, lifecycleStatus: "registered", contacts: { registrant: "fixture-contact" } }; },
    async readRegistrationCharge() { return { status: "final", ambiguous: false, providerCode: "spaceship", domain, operationId,
      quoteId, quoteExpiresAt: expiresAt, price: { amountMinor: 1400, currency: "USD" }, chargeReference: randomUUID(),
      observedAt: new Date().toISOString(), evidenceExpiresAt: expiresAt }; }
  };
  const providers = { primary: { code: "spaceship", registrarOfRecord: "Spaceship", configured: true, healthy: true, registrar },
    secondary: { code: "secondary", registrarOfRecord: "Held registrar", configured: false, healthy: false },
    preference: ["spaceship", "secondary"] };
  const routeRepository = createPostgresDomainProviderRouteRepository({ authority });
  const routes = createPostgresDomainProviderRouteComposition({ repository: routeRepository, registrarProviders: providers });
  const scope = { organizationId: organization, projectId: project, customerId: customer, actorId: customer };
  const charge = createHeldDomainPriceChargeBoundary({ repository: routeRepository, registrarProviders: providers,
    async resolveProjectScope() { return scope; } });
  const quote = await charge.quoteExactRegistration({ actor: { userId: customer }, projectId: project,
    selectionKey: `readback-${randomUUID()}`, domain, years: 1 });
  const attemptKey = `readback-${randomUUID()}`;
  await routes.submitRegistration({ organizationId: organization, projectId: project, routeId: quote.routeRef, attemptKey,
    input: { domain, years: 1, contacts: { registrant: "fixture-contact" } } });
  await charge.prepareFinalCharge({ actor: { userId: customer }, projectId: project, routeId: quote.routeRef,
    attemptKey, expectedRegistrantContactId: "fixture-contact" });
  const { pin } = await routeRepository.readPin({ organizationId: organization, projectId: project, domain });
  const core = createHeldDomainProviderLifecycle({ repository: createPostgresDomainLifecycleRepository({ authority }),
    providerReadPort: { async previewRenewal() { return {
      schema: "sitesourcery.domain-provider-renewal-quote/v1", status: "confirmation_required", noCharge: true,
      providerCode: "spaceship", domain, currentExpirationDate: expiry, years: 1,
      priceClass: "standard", price: { amountMinor: 1400, currency: "USD" },
      quoteId: randomUUID(), observedAt, expiresAt
    }; }, async readLifecycle() {
      return { schema: DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA, providerCode: "spaceship", domain, authoritative: true,
        lifecycleStatus: "active", expirationDate: expiry, autoRenew: false, transferStatus: "none", transferEligible: true,
        transferLocked: true, observedAt, providerReference: "fixture-existing-registration" };
    } }
  });
  await core.refreshAuthoritative({ scope, pin, commandId: `seed-${randomUUID()}` });
  if (pending) {
    const attemptId = randomUUID(), consentDigest = "a".repeat(64);
    if (pending === "renewal") {
      const quoted = await core.quoteRenewal({ scope, pin, commandId: `quote-${randomUUID()}`, years: 1 });
      await core.reserveRenewal({ scope, pin, commandId: `reserve-${randomUUID()}`, attemptId, consentDigest,
        quoteFingerprint: quoted.customer.renewal.quote.quoteFingerprint });
    } else await core.reserveTransfer({ scope, pin, commandId: `reserve-${randomUUID()}`, attemptId, consentDigest });
    await core[pending === "renewal" ? "recordRenewalOutcome" : "recordTransferOutcome"]({
      scope, pin, commandId: `outcome-${randomUUID()}`, outcome: {
        schema: "sitesourcery.domain-provider-lifecycle-outcome/v1", kind: pending, providerCode: "spaceship", domain,
        attemptId, effect: "uncertain", operationId: randomUUID(), observedAt: new Date().toISOString(), reason: "fixture-ambiguous"
      }
    });
  }
  const state = (await pool.query("select id,state_document from ss.domain_provider_lifecycle_states where organization_id=$1", [organization])).rows[0];
  const job = (await pool.query(`update ss.domain_lifecycle_worker_jobs set state='running',attempt_count=attempt_count+1,
    lease_fence=lease_fence+1,leased_by=$2,leased_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '2 minutes'
    where lifecycle_state_id=$1 returning *`, [state.id,workerId])).rows[0];
  const claim = { schema: "sitesourcery.domain-lifecycle-worker-claim/v1", jobId:job.id, organizationId:organization,
    projectId:project, lifecycleStateId:state.id, action:job.action, lifecycle:state.state_document,
    attemptCount:job.attempt_count, fence:Number(job.lease_fence), leaseExpiresAt:job.lease_expires_at.toISOString() };
  const readback = { name:domain,lifecycleStatus:"registered",expirationDate:expiry,autoRenew:false,eppStatuses:["clientTransferProhibited"],suspensions:[] };
  return { claim, readback, core, scope, pin };
}

test("real PostgreSQL Domain readback persists only while the exact lease remains current", { skip: !DATABASE_URL }, async t => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_domain_readback_(?:[0-9]+|ci_[0-9]+_[0-9]+)$/u, "dedicated disposable database only");
    const authority = createCanonicalPostgresAuthority({ pool });
    const stateOf = async claim => (await pool.query("select state_digest,revision,state_document from ss.domain_provider_lifecycle_states where id=$1", [claim.lifecycleStateId])).rows[0];
    const reader = getDomain => ({ readOnly:true,providerEffects:false,getDomain });
    for (const [providerStatus, canonicalStatus] of [["registered","active"],["grace1","grace"],["grace2","grace"],["redemption","redemption"]]) {
      await t.test(`documented ${providerStatus} readback updates canonical ${canonicalStatus} evidence`, async () => {
        const fixture = await seed(pool,authority); const before = await stateOf(fixture.claim);
        const executor = createSpaceshipDomainLifecycleExecutor({ authority, reader:reader(async () => ({...fixture.readback,lifecycleStatus:providerStatus})) });
        const result = await executor.execute(fixture.claim);
        assert.equal(result.receiptKind,"lifecycle_refreshed");
        const after = await stateOf(fixture.claim);
        assert.equal(Number(after.revision),Number(before.revision)+1);
        assert.equal(after.state_document.authoritative.lifecycleStatus,canonicalStatus);
        assert.equal(after.state_document.authoritative.transferEligible,false);
        const completion = await createPostgresDomainLifecycleWorkerRepository({ authority }).completeClaim({
          jobId:fixture.claim.jobId,fence:fixture.claim.fence,workerId,observedAt:new Date().toISOString(),result });
        assert.equal(completion.status,"completed");
      });
    }
    await t.test("an already expired lease makes zero registrar reads and writes", async () => {
      const fixture = await seed(pool,authority); let calls=0;
      await pool.query("update ss.domain_lifecycle_worker_jobs set leased_at=clock_timestamp()-interval '1 minute',lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [fixture.claim.jobId]);
      const before=await stateOf(fixture.claim);
      const executor=createSpaceshipDomainLifecycleExecutor({authority,reader:reader(async()=>{calls++;return fixture.readback;})});
      await assert.rejects(executor.execute(fixture.claim), error=>error.code==="DOMAIN_LIFECYCLE_WORKER_LEASE_LOST");
      assert.equal(calls,0); assert.deepEqual(await stateOf(fixture.claim),before);
    });
    await t.test("a replaced fence while the provider is read cannot persist stale evidence", async () => {
      const fixture=await seed(pool,authority); const before=await stateOf(fixture.claim);
      const executor=createSpaceshipDomainLifecycleExecutor({authority,reader:reader(async()=>{
        await pool.query("update ss.domain_lifecycle_worker_jobs set lease_fence=lease_fence+1 where id=$1",[fixture.claim.jobId]); return fixture.readback;
      })});
      await assert.rejects(executor.execute(fixture.claim), error=>error.code==="DOMAIN_LIFECYCLE_WORKER_LEASE_LOST");
      assert.deepEqual(await stateOf(fixture.claim),before);
    });
    await t.test("expiry during the provider read is checked again in the write transaction", async () => {
      const fixture=await seed(pool,authority); const before=await stateOf(fixture.claim);
      const executor=createSpaceshipDomainLifecycleExecutor({authority,reader:reader(async()=>{
        await pool.query("update ss.domain_lifecycle_worker_jobs set leased_at=clock_timestamp()-interval '1 minute',lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[fixture.claim.jobId]); return fixture.readback;
      })});
      await assert.rejects(executor.execute(fixture.claim), error=>error.code==="DOMAIN_LIFECYCLE_WORKER_LEASE_LOST");
      assert.deepEqual(await stateOf(fixture.claim),before);
    });
    await t.test("lease loss at the end of persistence rolls back both state and command receipt", async () => {
      const fixture = await seed(pool,authority), before = await stateOf(fixture.claim);
      const commands = async () => Number((await pool.query("select count(*) as count from ss.domain_provider_lifecycle_commands where lifecycle_state_id=$1",[fixture.claim.lifecycleStateId])).rows[0].count);
      const priorCommands = await commands(); let injected = false;
      const expiringAuthority = { kind: "canonical-postgres", service(options, callback) {
        return authority.service(options, client => callback({ async query(sql, parameters) {
          const result = await client.query(sql,parameters);
          if (sql.includes("insert into ss.domain_provider_lifecycle_commands")) {
            injected = true;
            await client.query("update ss.domain_lifecycle_worker_jobs set leased_at=clock_timestamp()-interval '1 minute',lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[fixture.claim.jobId]);
          }
          return result;
        } }));
      } };
      const executor = createSpaceshipDomainLifecycleExecutor({ authority: expiringAuthority, reader: reader(async () => fixture.readback) });
      await assert.rejects(executor.execute(fixture.claim), { code: "DOMAIN_LIFECYCLE_WORKER_LEASE_LOST" });
      assert.equal(injected,true); assert.deepEqual(await stateOf(fixture.claim),before); assert.equal(await commands(),priorCommands);
    });
    await t.test("provider 404 leaves the authoritative state intact for manual review", async () => {
      const fixture=await seed(pool,authority); const before=await stateOf(fixture.claim);
      const executor=createSpaceshipDomainLifecycleExecutor({authority,reader:reader(async()=>{throw Object.assign(new Error("private-body"),{code:"spaceship_http_404"});})});
      const result=await executor.execute(fixture.claim); assert.equal(result.receiptKind,"manual_review");
      assert.deepEqual(await stateOf(fixture.claim),before); assert.doesNotMatch(JSON.stringify(result),/private-body/u);
    });
    for (const pending of ["renewal", "transfer"]) {
      await t.test(`GET Domain cannot complete an uncertain ${pending} operation`, async () => {
        const fixture = await seed(pool,authority,pending); const before = await stateOf(fixture.claim);
        const observed = { ...fixture.readback,
          expirationDate: new Date(Date.parse(fixture.readback.expirationDate) + 365 * 86400000).toISOString(),
          eppStatuses: pending === "transfer" ? ["pendingTransfer"] : [] };
        const executor = createSpaceshipDomainLifecycleExecutor({ authority, reader: reader(async () => observed) });
        const result = await executor.execute(fixture.claim), after = await stateOf(fixture.claim);
        assert.equal(result.receiptKind,"manual_review");
        assert.equal(after.state_document[pending].status,"uncertain");
        assert.deepEqual(after.state_document[pending].attempt,before.state_document[pending].attempt);
        assert.equal(after.state_document.authoritative.renewalOperationDigest,null);
        assert.equal(after.state_document.authoritative.transferOperationDigest,null);
        const completion = await createPostgresDomainLifecycleWorkerRepository({ authority }).completeClaim({
          jobId:fixture.claim.jobId,fence:fixture.claim.fence,workerId,observedAt:new Date().toISOString(),result });
        assert.equal(completion.status,"manual_review");
        assert.equal((await pool.query("select state from ss.domain_lifecycle_worker_jobs where id=$1",[fixture.claim.jobId])).rows[0].state,"manual_review");
      });
    }
  } finally { await pool.end(); }
});
