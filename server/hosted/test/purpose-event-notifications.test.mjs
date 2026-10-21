import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveAutomaticPurposeEvent } from '../purpose-event-notifications.mjs';
import { MAIL_PURPOSE_NOTIFICATION_AUTHORITIES as AUTHORITIES } from '../mail-purpose-notifications.mjs';

const UUID = '10000000-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);
const automatic = Object.entries(AUTHORITIES).filter(([kind]) => !kind.startsWith('care_catalog_') && kind !== 'engagement_followup_ready');
function harness(kind, options = {}) {
  const authority = AUTHORITIES[kind];
  const source = { source_table: authority.table, source_id: UUID, source_revision: 1,
    source_digest: SHA, source_state: authority.states[0], purpose_kind: authority.purposeKind,
    notification_kind: kind, template_version: authority.templateVersion, reference_id: UUID,
    organization_id: UUID, project_id: UUID, source_customer_user_id: UUID,
    source_occurred_at: new Date(), reservation_requested_at: new Date() };
  const queries = [];
  let actor = options.actor ?? 'operator';
  const db = { async query(sql, values = []) {
    queries.push({ sql, values });
    const result = rows => ({ rows, rowCount: rows.length });
    if (sql.startsWith('select source.*')) return result(options.absent ? [] : [{ ...source, ...options.source }]);
    if (sql.includes('select id from ss.mail_purpose_notification_outbox')) return result(options.prior ? [{ id: UUID }] : []);
    if (sql.includes('select u.email from auth.users')) return result(options.ineligible ? [] : [{ email: 'purpose@example.test' }]);
    if (sql.includes('from ss.hosted_mail_recipient_suppressions')) return result(options.suppressed ? [{ recipient_digest: SHA }] : []);
    if (sql.includes('current_setting')) return result([{ kind: actor }]);
    if (sql.includes('set_config')) { actor = values[0] ?? 'system'; return result([{}]); }
    if (sql.includes('insert into ss.hosted_mail_deliveries')) {
      assert.equal(actor, 'system');
      return result([]);
    }
    if (sql.includes('insert into ss.mail_purpose_notification_outbox')) {
      assert.equal(actor, 'system');
      if (options.failure) throw options.failure;
      return result([{ id: UUID }]);
    }
    if (sql.includes('from ss.mail_purpose_notification_outbox notification')) return result([{
      ...source, id: UUID, state: 'held', mail_state: 'pending', revision: 1
    }]);
    throw Error('Unexpected query: ' + sql);
  } };
  return { db, source, queries, actor: () => actor, call: () => reserveAutomaticPurposeEvent(db,
    { table: authority.table, id: UUID, organizationId: UUID }) };
}

test('all 13 ordinary-purpose templates reserve canonical pending mail and restore the caller', async t => {
  assert.equal(automatic.length, 13);
  for (const [kind, authority] of automatic) await t.test(kind, async () => {
    const h = harness(kind);
    assert.equal((await h.call()).replayed, false);
    assert.equal(h.actor(), 'operator');
    const mail = h.queries.find(q => q.sql.includes('insert into ss.hosted_mail_deliveries'));
    const outbox = h.queries.find(q => q.sql.includes('insert into ss.mail_purpose_notification_outbox'));
    assert.equal(mail.values[10], authority.templateVersion);
    assert.equal(outbox.values[4], kind);
    assert.match(mail.sql, /'pending'/u);
    assert.match(outbox.sql, /'held', false, false/u);
    assert.doesNotMatch(JSON.stringify([mail.values, outbox.values]), /purpose@example.test|<p>/u);
  });
});
test('ineligible recipients and exact source retries do not enqueue duplicate mail', async () => {
  for (const options of [{ ineligible: true }, { suppressed: true }, { prior: true }]) {
    const h = harness('care_ticket_update', options);
    await h.call();
    assert.equal(h.queries.some(q => q.sql.includes('insert into')), false);
    assert.equal(h.actor(), 'operator');
  }
});
test('storage failure propagates while restoring actor authority', async () => {
  const failure = new Error('forced outbox failure');
  for (const actor of ['customer', 'operator', 'system']) {
    const h = harness('custom_progress_updated', { failure, actor });
    await assert.rejects(h.call, error => error === failure);
    assert.equal(h.actor(), actor);
  }
});
test('missing or mismatched exact sources fail; catalog and engagement remain outside this helper', async () => {
  for (const options of [{ absent: true }, { source: { template_version: 'wrong.v1' } }]) {
    await assert.rejects(harness('care_ticket_update', options).call, /notification (source|authority)/u);
  }
  for (const table of ['ss.customer_engagements', 'ss.care_catalog_notification_events']) {
    await assert.rejects(() => reserveAutomaticPurposeEvent({ query() { assert.fail('must not query'); } },
      { table, id: UUID, organizationId: UUID }), /does not authorize/u);
  }
});
