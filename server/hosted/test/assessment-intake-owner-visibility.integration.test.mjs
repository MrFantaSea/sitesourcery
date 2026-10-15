import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createPostgresCommerceV2Adapter } from "../commerce-v2-postgres.mjs";
import { createHostedCustomServicesAccount } from "../custom-services-account-hosted.mjs";
import { createPostgresCustomServicesRequestRepository } from "../custom-services-request-postgres.mjs";
import { createPostgresCustomServicesOwner } from "../custom-services-owner-postgres.mjs";
import { createHostedApi } from "../http.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_ASSESSMENT_INTAKE_TEST_URL;
const CURRENT_POLICY = "00000000-0000-4000-8000-000000001411";
const LEGACY_POLICY = "00000000-0000-4000-8000-000000000341";
const ORIGIN = "https://app.sitesourcery.test";
const QUEUE = "/api/v1/operator/custom-services/assessment-requests";

test("real customer intake reaches the owner without changing legacy policy authority", {
  skip: !DATABASE_URL, timeout: 60_000
}, async t => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_assessment_intake_(?:test|ci_[0-9]+_[0-9]+)$/u);
    const authority = createCanonicalPostgresAuthority({ pool });
    const requests = createPostgresCustomServicesRequestRepository({ authority });
    const owner = createPostgresCustomServicesOwner({ authority });
    const unavailable = async () => { throw new Error("Unexpected non-intake effect"); };
    const account = createHostedCustomServicesAccount({
      resolveSession: createPostgresCommerceV2Adapter({ authority }).resolveSession,
      requestRepository: requests,
      repository: { readFoundationSnapshot: unavailable },
      quoteRepository: { readCurrentQuote: unavailable, acceptCurrentQuote: unavailable },
      invoiceRepository: { readCurrentInvoice: unavailable },
      payment: { createCheckout: unavailable },
      assessmentWork: { readCustomerReport: unavailable, readCustomerEvidence: unavailable },
      customBuild: { readCurrentQuote: unavailable, acceptCurrentQuote: unavailable },
      customBuildPayment: { readCurrentInvoice: unavailable, createCheckout: unavailable },
      customBuildProgress: { readCustomerProgress: unavailable, respondToRequest: unavailable }
    });
    const sessions = new Map();
    const api = createHostedApi({ authenticate: async token => sessions.get(token) ?? null }, {
      customServicesAccount: account, customServicesOwner: owner
    });
    const billing = randomUUID();
    await pool.query(`insert into ss.billing_policies(id,policy_key,grace_period,retention_period,effective_at)
      values($1,$2,interval '14 days',interval '90 days',clock_timestamp())`, [billing, `assessment-${billing}`]);
    async function actor() {
      const userId = randomUUID(), organizationId = randomUUID(), token = randomUUID();
      await pool.query("insert into auth.users(id,email) values($1,$2)", [userId, `intake-${userId}@example.test`]);
      await pool.query("insert into ss.hosted_account_profiles(user_id,display_name) values($1,'Intake fixture')", [userId]);
      await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Intake fixture')", [organizationId, userId]);
      await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [organizationId, userId]);
      sessions.set(token, { userId });
      return { userId, organizationId, token };
    }
    async function project(who) {
      const id = randomUUID();
      await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Intake fixture')", [id, who.organizationId, who.userId, billing]);
      return id;
    }
    const customer = await actor(), operator = await actor(), foreign = await actor();
    await pool.query("insert into ss.operator_profiles(user_id,display_label,authorized_by_user_id,authorized_at) values($1,'Intake owner',$1,clock_timestamp())", [operator.userId]);
    await pool.query("insert into ss.operator_permissions(operator_user_id,capability,granted_by_user_id,granted_at) values($1,'service_quote_author',$1,clock_timestamp())", [operator.userId]);
    await pool.query(`insert into ss.service_operator_authority_events(operator_user_id,capability,event_sequence,event_kind,recorded_by_kind,effective_at,expires_at,created_at)
      values($1,'service_quote_author',1,'grant','deployment_control',clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())`, [operator.userId]);

    async function http(who, path, { method = "GET", body, key = randomUUID() } = {}) {
      const headers = { Cookie: `ss_session=${who.token}; ss_csrf=${"c".repeat(32)}` };
      if (method !== "GET") Object.assign(headers, { Origin: ORIGIN, "Content-Type": "application/json", "X-CSRF-Token": "c".repeat(32), "Idempotency-Key": key });
      const response = await api.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    }
    async function command(who, path, method, body, key = randomUUID(), expectedStatus = 200) {
      const options = { method, body, key }, result = await http(who, path, options);
      assert.equal(result.status, expectedStatus, JSON.stringify(result));
      assert.deepEqual(await http(who, path, options), result, "exact command replay");
      return result.body;
    }
    const facts = { siteDisplayName: "Internal intake fixture", publicUrl: "https://fixture.example.test/", businessName: "Fixture",
      primaryGoal: "Exercise canonical intake visibility without a purchase.", customerObservation: null, platformFamily: "custom",
      approximatePublicSize: "one_to_ten", complexityFlags: [], importantDate: null, customerOwnershipAffirmed: true, expectedDraftRevision: 0 };
    const queueItem = async caseId => {
      const result = await http(operator, QUEUE); assert.equal(result.status, 200, JSON.stringify(result));
      const rows = result.body.requests.filter(row => row.caseId === caseId); assert.equal(rows.length, 1);
      return rows[0];
    };

    await t.test("current submission, owner queue and withdrawal share current policy and exact idempotency", async () => {
      const projectId = await project(customer), path = `/api/v1/projects/${projectId}/custom-services/assessment-request`;
      const draft = await command(customer, path, "PUT", { ...facts, customerOwnershipAffirmed: false });
      assert.equal(draft.actions.submit.available, false);
      const saved = await command(customer, path, "PUT", { ...facts, expectedDraftRevision: draft.draftRevision });
      const submitted = await command(customer, path + "/submission", "POST", { draftRevision: saved.draftRevision });
      assert.equal(submitted.state, "submitted");
      const item = await queueItem(submitted.caseId);
      assert.equal(item.projectId, projectId); assert.equal(item.customer.customerId, customer.userId);
      assert.equal(item.assessmentPolicyId, CURRENT_POLICY); assert.deepEqual(item.quoteAvailability, { available: true, reason: null });
      assert.equal(item.currentQuote, null); assert.equal(item.request.primaryGoal, facts.primaryGoal);
      assert.equal((await pool.query("select policy_id from ss.service_case_offerings where case_id=$1", [submitted.caseId])).rows[0].policy_id, CURRENT_POLICY);
      assert.equal((await http(foreign, path)).status, 404);
      assert.equal((await http(customer, QUEUE)).status, 403);
      // Local fixture quote only: no acceptance, invoice, checkout or provider.
      const quote = await command(operator, `${QUEUE}/${submitted.caseId}/quote`, "POST", {
        organizationId: customer.organizationId,
        deliveryDate: new Date(Date.now()+7*86400_000).toISOString().slice(0,10),
        reviewTargets: [{ kind: "page", value: "/" }]
      }, randomUUID(), 201);
      assert.deepEqual(quote.price, { amountMinor: 35000, currency: "USD" });
      assert.equal((await pool.query("select policy_id from ss.service_quote_revisions where quote_id=$1", [quote.quoteId])).rows[0].policy_id, CURRENT_POLICY);
      assert.equal((await pool.query("select count(*)::int as n from ss.service_quote_acceptances where quote_id=$1", [quote.quoteId])).rows[0].n, 0);
      const withdrawn = await command(customer, path + "/withdrawal", "POST", {});
      assert.equal(withdrawn.caseId, submitted.caseId); assert.equal(withdrawn.state, "withdrawn");
      assert.deepEqual((await http(customer, path)).body, withdrawn);
      assert.equal((await http(operator, QUEUE)).body.requests.some(row => row.caseId === submitted.caseId), false);
      assert.equal((await pool.query("select count(*)::int as n from ss.service_cases where project_id=$1", [projectId])).rows[0].n, 1);
      assert.equal((await pool.query("select count(*)::int as n from ss.service_intakes where case_id=$1", [submitted.caseId])).rows[0].n, 1);
    });

    await t.test("historical legacy intake stays visible and withdrawable, but cannot silently receive current terms", async () => {
      const projectId = await project(customer), path = `/api/v1/projects/${projectId}/custom-services/assessment-request`;
      const draft = await command(customer, path, "PUT", facts);
      // Seed a genuinely legacy submission using the original canonical insert
      // sequence and active DB constraints. Never replace a current policy row.
      await authority.service({ actorKind: "customer", userId: customer.userId, organizationId: customer.organizationId }, async client => {
        await client.query("update ss.service_cases set state='submitted' where id=$1", [draft.caseId]);
        await client.query(`insert into ss.service_case_offerings(organization_id,project_id,case_id,customer_user_id,requested_by_user_id,policy_id)
          values($1,$2,$3,$4,$4,$5)`, [customer.organizationId, projectId, draft.caseId, customer.userId, LEGACY_POLICY]);
        await client.query(`insert into ss.service_intakes(organization_id,project_id,case_id,customer_user_id,created_by_user_id,source,
          site_display_name,public_scheme,public_hostname,business_name,primary_goal,customer_observation,platform_family,approximate_public_size,complexity_flags,important_date,customer_ownership_affirmed)
          select organization_id,project_id,case_id,customer_user_id,customer_user_id,'account',site_display_name,public_scheme,public_hostname,business_name,primary_goal,customer_observation,platform_family,approximate_public_size,complexity_flags,important_date,customer_ownership_affirmed
          from ss.service_intake_drafts where case_id=$1`, [draft.caseId]);
        await client.query("set constraints all immediate");
      });
      const submitted = (await http(customer, path)).body; assert.equal(submitted.state, "submitted");
      const before = (await pool.query("select row_to_json(o) as row from ss.service_case_offerings o where case_id=$1", [draft.caseId])).rows[0].row;
      const item = await queueItem(draft.caseId);
      assert.equal(item.assessmentPolicyId, LEGACY_POLICY);
      assert.deepEqual(item.quoteAvailability, { available: false, reason: "legacy_assessment_request_requires_resubmission" });
      const quote = await http(operator, `${QUEUE}/${draft.caseId}/quote`, { method: "POST", body: { organizationId: customer.organizationId,
        deliveryDate: new Date(Date.now()+7*86400_000).toISOString().slice(0,10), reviewTargets: [{ kind: "page", value: "/" }] } });
      assert.equal(quote.status, 409, JSON.stringify(quote)); assert.equal(quote.body.error.code, "legacy_assessment_request_requires_resubmission");
      assert.deepEqual((await pool.query("select row_to_json(o) as row from ss.service_case_offerings o where case_id=$1", [draft.caseId])).rows[0].row, before);
      assert.equal((await pool.query("select count(*)::int as n from ss.service_quotes where case_id=$1", [draft.caseId])).rows[0].n, 0);
      const withdrawn = await command(customer, path + "/withdrawal", "POST", {});
      assert.equal(withdrawn.state, "withdrawn"); assert.equal(withdrawn.caseId, draft.caseId); assert.deepEqual(withdrawn.facts, submitted.facts);
      assert.deepEqual((await http(customer, path)).body, withdrawn);
      assert.equal((await http(operator, QUEUE)).body.requests.some(row => row.caseId === draft.caseId), false);
      const after = (await pool.query("select policy_id,state from ss.service_case_offerings where case_id=$1", [draft.caseId])).rows[0];
      assert.deepEqual(after, { policy_id: LEGACY_POLICY, state: "removed" });
    });
  } finally { await pool.end(); }
});
