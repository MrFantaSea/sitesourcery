import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createPostgresSupportCaseRepository } from "../support-cases-postgres.mjs";
import { createSupportCaseService } from "../support-cases.mjs";
import { createMailLifecycle } from "../mail-lifecycle.mjs";
import { createPostgresMailLifecycleRepository } from "../mail-lifecycle-postgres.mjs";
import { createNotificationMailPrivateRenderer, previewReviewedNotificationMail,
  REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 } from "../../../ops/notification-mail-private-renderer.mjs";

const URL = process.env.SITESOURCERY_PG_SUPPORT_NOTIFICATION_TEST_URL;
const SHA = "a".repeat(64);
test("approved case actions prepare atomic, private, idempotent mail on PostgreSQL", { skip: !URL, timeout: 60_000 }, async t => {
  const url = new globalThis.URL(URL);
  assert.match(url.pathname, /^\/ss_support_mail_[a-z0-9_]+$/u);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const pool = new pg.Pool({ connectionString: URL, max: 5 });
  try {
    const authority = createCanonicalPostgresAuthority({ pool });
    const mailLifecycle = createMailLifecycle({ repository: createPostgresMailLifecycleRepository({ authority }),
      clock: { now: () => new Date().toISOString() } });
    const service = automaticNotifications => createSupportCaseService({
      repository: createPostgresSupportCaseRepository({ authority, automaticNotifications }), mailLifecycle,
      clock: { now: () => new Date().toISOString() } });
    const automatic = service(undefined), manual = service(false);
    const policy = (await pool.query("select id from ss.billing_policies order by id limit 1")).rows[0].id;
    async function actor() {
      const userId = randomUUID(), organizationId = randomUUID();
      await pool.query("insert into auth.users(id,email) values($1,$2)", [userId, `case-${userId}@example.test`]);
      await pool.query("insert into ss.hosted_account_profiles(user_id,display_name) values($1,'Case mail fixture')", [userId]);
      await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Case mail fixture')", [organizationId, userId]);
      await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [organizationId, userId]);
      return { userId, organizationId };
    }
    const customer = await actor(), operator = await actor(), foreign = await actor();
    const projectId = randomUUID();
    await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Case mail fixture')",
      [projectId, customer.organizationId, customer.userId, policy]);
    await pool.query("insert into ss.operator_profiles(user_id,display_label,state,authorized_by_user_id,authorized_at) values($1,'Fixture owner','held',$1,clock_timestamp())", [operator.userId]);
    await pool.query("insert into ss.operator_permissions(operator_user_id,capability,state,granted_by_user_id,granted_at) values($1,'service_case_manage','held',$1,clock_timestamp())", [operator.userId]);
    await pool.query(`insert into ss.service_operator_authority_events(operator_user_id,capability,event_sequence,event_kind,recorded_by_kind,effective_at,expires_at,created_at)
      values($1,'service_case_manage',1,'grant','deployment_control',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day',clock_timestamp())`, [operator.userId]);
    function opening(overrides = {}) { return { actorId: customer.userId, commandId: randomUUID(),
      evidenceDigests: [SHA], organizationId: customer.organizationId, parentCaseId: null, projectId,
      requestKind: "support", requesterReferenceDigest: SHA, requesterUserId: customer.userId,
      scopeKind: "project", ...overrides }; }
    function command(row, extra = {}) { return { actorId: operator.userId, operatorOrganizationId: operator.organizationId,
      caseId: row.id, commandId: randomUUID(), expectedRevision: row.revision, ...extra }; }
    async function prepare(row, verify = false) {
      row = await automatic.assign(command(row, { assignedOperatorId: operator.userId }));
      row = await automatic.setDeadline(command(row, { basisDigest: SHA, responseDueAt: new Date(Date.now() + 86400000).toISOString() }));
      if (verify) row = await automatic.updateIdentity(command(row, { identityState: "verified", evidenceDigest: SHA }));
      return automatic.startReview(command(row));
    }
    const count = async () => (await pool.query("select count(*)::int as n from ss.hosted_mail_deliveries")).rows[0].n;
    let responseCase;
    await t.test("opening, response and closure reserve once; internal steps and exact retries do not add mail", async () => {
      const input = opening();
      let row = await automatic.openAuthenticated(input);
      assert.deepEqual(row.notifications.map(n => n.kind), ["acknowledgment"]);
      const afterOpen = await count();
      assert.deepEqual(await automatic.openAuthenticated(input), row);
      assert.equal(await count(), afterOpen);
      row = await prepare(row);
      row = await automatic.addEvidence(command(row, { evidenceKind: "response", evidenceDigest: "b".repeat(64) }));
      assert.equal(await count(), afterOpen);
      const respond = command(row, { responseDigest: SHA });
      row = await automatic.respond(respond);
      assert.deepEqual(await automatic.respond(respond), row);
      assert.equal(await count(), afterOpen + 1);
      assert.deepEqual(row.notifications.map(n => n.kind), ["acknowledgment", "response"]);
      responseCase = row.id;
      row = await automatic.close(command(row, { closureReasonCode: "completed", closureEvidenceDigest: SHA }));
      assert.equal(await count(), afterOpen + 2);
      assert.deepEqual(row.notifications.map(n => n.kind), ["acknowledgment", "response", "closure"]);
      assert.equal(row.audit.filter(e => e.kind === "notification_reserved").length, 3);
      assert.doesNotMatch(JSON.stringify(row), /@example\.test|reviewed response|<p>/u);
    });
    await t.test("denial and appeal use their reviewed templates without notifying the parent twice", async () => {
      let row = await prepare(await automatic.openAuthenticated(opening()), true);
      row = await automatic.deny(command(row, { denialReasonCode: "request_not_supported", denialExplanationDigest: SHA,
        appealAvailable: true, appealDueAt: new Date(Date.now() + 86400000).toISOString(), appealBasisDigest: SHA }));
      assert.deepEqual(row.notifications.map(n => n.kind), ["acknowledgment", "denial"]);
      const before = await count();
      const appeal = await automatic.openAuthenticated(opening({ requestKind: "appeal", parentCaseId: row.id }));
      assert.deepEqual(appeal.notifications.map(n => n.kind), ["appeal_acknowledgment"]);
      assert.equal(await count(), before + 1);
    });
    await t.test("explicitly disabled preparation, account/manual cases and invalid tenant scope stay effect-free", async () => {
      const before = await count();
      assert.deepEqual((await manual.openAuthenticated(opening())).notifications, []);
      assert.deepEqual((await automatic.openAuthenticated(opening({ projectId: null, scopeKind: "account" }))).notifications, []);
      assert.deepEqual((await automatic.recordManual({ actorId: operator.userId, commandId: randomUUID(), evidenceDigests: [SHA],
        intakeChannel: "manual", organizationId: null, operatorOrganizationId: operator.organizationId, parentCaseId: null,
        projectId: null, requestKind: "support", requesterReferenceDigest: SHA, requesterUserId: null, scopeKind: "general" })).notifications, []);
      await assert.rejects(automatic.openAuthenticated(opening({ actorId: foreign.userId, requesterUserId: foreign.userId })), { code: "SUPPORT_CASE_UNAVAILABLE" });
      assert.equal(await count(), before);
    });
    await t.test("a linked explicit reservation is preserved and exact manual reservation replay remains compatible", async () => {
      await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [customer.organizationId, operator.userId]);
      let row = await manual.openAuthenticated(opening());
      const preview = previewReviewedNotificationMail({ templateVersion: "support-case-acknowledgment.v1",
        to: `case-${customer.userId}@example.test`, variables: { reference: row.id } });
      const input = command(row, { operatorOrganizationId: customer.organizationId, customerUserId: customer.userId,
        projectId, mailCommandId: randomUUID(), notificationKind: "acknowledgment", templateVersion: preview.templateVersion,
        expiresAt: new Date(Date.now() + 86400000).toISOString(), ...preview.evidence });
      row = await manual.reserveNotification(input);
      assert.deepEqual(await manual.reserveNotification(input), row);
      const before = await count();
      row = await prepare(row);
      assert.equal(await count(), before);
      row = await automatic.respond(command(row, { responseDigest: SHA }));
      assert.equal(await count(), before + 1);
      assert.equal(row.notifications.filter(n => n.kind === "acknowledgment").length, 1);
    });
    await t.test("reservation failure rolls back the case, mail, audit and command together", async () => {
      await pool.query(`create function ss.support_mail_fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'fixture reservation failure'; end $$;
        create trigger support_mail_fixture_fail before insert on ss.hosted_support_case_mail_reservations for each row execute function ss.support_mail_fixture_fail()`);
      const input = opening(), before = await count();
      try {
        await assert.rejects(automatic.openAuthenticated(input), /fixture reservation failure/u);
        assert.equal(await count(), before);
        assert.equal((await pool.query("select count(*)::int as n from ss.hosted_support_cases where opening_command_id=$1", [input.commandId])).rows[0].n, 0);
        assert.equal((await pool.query("select count(*)::int as n from ss.hosted_support_case_commands where command_id=$1", [input.commandId])).rows[0].n, 0);
      } finally {
        await pool.query("drop trigger support_mail_fixture_fail on ss.hosted_support_case_mail_reservations; drop function ss.support_mail_fixture_fail()");
      }
    });
    await t.test("the existing private renderer consumes the actual pending reservation without sending", async () => {
      const row = (await pool.query(`select m.*, r.id as reservation_id, r.reservation_digest from ss.hosted_mail_deliveries m
        join ss.hosted_support_case_mail_reservations r on r.mail_message_id=m.id where r.case_id=$1 and r.notification_kind='response'`, [responseCase])).rows[0];
      const renderer = createNotificationMailPrivateRenderer({ authority, configuration: { mode: "reviewed",
        operatorRecipient: "operator@example.test", templateRegistrySha256: REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 } });
      const rendered = await renderer.render({ messageId: row.id, messageType: row.message_type,
        sourceKind: "support", sourceReservationId: row.reservation_id, sourceReservationDigest: row.reservation_digest,
        observedAt: new Date().toISOString(), recipientDigest: row.recipient_digest, subjectReferenceDigest: row.subject_reference_digest,
        contentDigest: row.content_digest, templateVersion: row.template_version });
      assert.equal(rendered.to, `case-${customer.userId}@example.test`);
      assert.equal(rendered.templateVersion, "support-case-response.v1");
      assert.equal(row.state, "pending"); assert.equal(row.provider, null); assert.equal(renderer.providerEffects, false);
    });
  } finally { await pool.end(); }
});
