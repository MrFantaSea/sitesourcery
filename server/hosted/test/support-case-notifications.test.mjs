import assert from "node:assert/strict";
import test from "node:test";
import { reserveSupportCaseNotification } from "../support-case-notifications.mjs";
import { createPostgresSupportCaseRepository } from "../support-cases-postgres.mjs";
import { previewReviewedNotificationMail } from "../../../ops/notification-mail-private-renderer.mjs";

const CASE = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const ORG = "30000000-0000-4000-8000-000000000001";
const PROJECT = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-10-20T23:00:00.000Z";
function fixture(options = {}) {
  const queries = [];
  const row = { id: CASE, state: "open", request_kind: "support", intake_channel: "authenticated",
    scope_kind: "project", requester_user_id: USER, organization_id: ORG, project_id: PROJECT, ...options.row };
  const client = { async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql.startsWith("select * from ss.hosted_support_cases")) return { rows: [row] };
    if (sql.startsWith("select mail_message_id")) return { rows: options.prior ? [{ mail_message_id: options.prior }] : [] };
    if (sql.includes("current_setting")) return { rows: [{ kind: "customer" }] };
    if (sql.startsWith("select u.email")) return { rows: options.ineligible ? [] : [{ email: "fixture@example.test" }] };
    if (sql.startsWith("select 1 from ss.hosted_mail_recipient_suppressions")) return { rows: options.suppressed ? [{}] : [] };
    if (options.failReservation && sql.startsWith("insert into ss.hosted_support_case_mail_reservations")) throw new Error("reservation failure");
    return { rows: [] };
  } };
  return { client, queries };
}

test("all five case transitions reserve the existing reviewed template and digest-only audit", async () => {
  for (const [action, kind, state] of [["open", "acknowledgment", "open"],
    ["appeal_open", "appeal_acknowledgment", "open"], ["respond", "response", "responded"],
    ["deny", "denial", "denied"], ["close", "closure", "closed"]]) {
    const f = fixture({ row: { state, request_kind: action === "appeal_open" ? "appeal" : "support" } });
    const result = await reserveSupportCaseNotification(f.client, { caseId: CASE, action, recordedAt: NOW });
    assert.equal(result.kind, kind); assert.equal(result.alreadyReserved, false);
    const inserts = f.queries.filter(q => q.sql.startsWith("insert"));
    assert.equal(inserts.length, 3);
    const mail = inserts[0].values;
    const version = `support-case-${kind.replaceAll("_", "-")}.v1`;
    const preview = previewReviewedNotificationMail({ templateVersion: version,
      to: "fixture@example.test", variables: { reference: CASE } });
    assert.deepEqual(mail.slice(3, 11), ["support_notification", ORG, PROJECT, USER,
      preview.evidence.recipientDigest, preview.evidence.subjectReferenceDigest, preview.evidence.contentDigest, version]);
    assert.equal(mail[11], NOW); assert.equal(mail[12], "2026-11-19T23:00:00.000Z");
    assert.doesNotMatch(JSON.stringify(inserts), /fixture@example|reviewed response|<p>/u);
    assert.deepEqual(f.queries.at(-2).values, ["customer"]);
    assert.match(inserts[2].sql, /'notification_reserved',ss.current_service_actor_kind\(\)/u);
    assert.match(inserts[2].sql, /ss.current_service_actor_user_id\(\)/u);
  }
});

test("internal actions, non-project or manual cases and prior reservations never enqueue", async () => {
  for (const action of ["assign", "review_start", "evidence_add", "notification_reserve"]) {
    const f = fixture();
    assert.equal(await reserveSupportCaseNotification(f.client, { caseId: CASE, action, recordedAt: NOW }), null);
    assert.equal(f.queries.length, 0);
  }
  for (const row of [{ scope_kind: "account" }, { scope_kind: "general" }, { intake_channel: "manual" }, { requester_user_id: null }]) {
    const f = fixture({ row });
    assert.equal(await reserveSupportCaseNotification(f.client, { caseId: CASE, action: "open", recordedAt: NOW }), null);
    assert.equal(f.queries.length, 1);
  }
  const f = fixture({ prior: PROJECT });
  assert.deepEqual(await reserveSupportCaseNotification(f.client, { caseId: CASE, action: "open", recordedAt: NOW }),
    { messageId: PROJECT, kind: "acknowledgment", alreadyReserved: true });
  assert.equal(f.queries.length, 2);
});

test("removed or suppressed recipients skip mail and restore transaction actor", async () => {
  for (const options of [{ ineligible: true }, { suppressed: true }]) {
    const f = fixture(options);
    assert.equal(await reserveSupportCaseNotification(f.client, { caseId: CASE, action: "open", recordedAt: NOW }), null);
    assert.equal(f.queries.filter(q => q.sql.startsWith("insert")).length, 0);
    assert.deepEqual(f.queries.at(-1).values, ["customer"]);
  }
});

test("inconsistent event and storage errors escape for transaction rollback", async () => {
  const wrong = fixture({ row: { state: "assigned" } });
  await assert.rejects(reserveSupportCaseNotification(wrong.client, { caseId: CASE, action: "respond", recordedAt: NOW }),
    { code: "SUPPORT_CASE_MAIL_STATE_INVALID" });
  const failure = fixture({ failReservation: true });
  await assert.rejects(reserveSupportCaseNotification(failure.client, { caseId: CASE, action: "open", recordedAt: NOW }), /reservation failure/u);
  assert.equal(failure.queries.some(q => q.sql.startsWith("insert into ss.hosted_support_case_events")), false);
});

test("automatic preparation configuration rejects non-boolean values", () => {
  assert.throws(() => createPostgresSupportCaseRepository({ authority: { service() {} }, automaticNotifications: "true" }),
    { code: "SUPPORT_CASE_CONFIGURATION_REQUIRED" });
});
