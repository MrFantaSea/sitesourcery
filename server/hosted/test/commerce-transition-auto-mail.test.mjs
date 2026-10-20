import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMERCE_NOTIFICATION_AUTHORITIES } from '../commerce-transition-notifications.mjs';
import { reserveCommerceTransitionMail, reserveCommerceInvoiceMail } from '../commerce-transition-auto-mail.mjs';
import { digest } from '../security.mjs';

const CUSTOMER = '10000000-0000-4000-8000-000000000001';
const SOURCE = '20000000-0000-4000-8000-000000000001';
const EMAIL = 'customer@example.test';
const OPERATOR = 'operator@example.test';
const instant = new Date('2026-10-20T12:34:56.789Z');

function harness(kind, options = {}) {
  const authority = COMMERCE_NOTIFICATION_AUTHORITIES[kind];
  const source = { notification_kind: kind, audience_kind: authority.audience,
    source_table: authority.table, source_id: kind.endsWith('_payment_reconciliation_required') ? 'e'.repeat(64) : SOURCE,
    source_revision: 2, source_digest: 'd'.repeat(64), source_state: authority.states[0],
    source_customer_user_id: CUSTOMER, organization_id: SOURCE, project_id: SOURCE, source_occurred_at: instant };
  const calls = []; let mail, reservation;
  const row = () => ({ id: reservation[0], audience_kind: reservation[3], notification_kind: reservation[4],
    source_table: reservation[5], source_id: reservation[6], source_revision: reservation[7], source_digest: reservation[8],
    source_state: reservation[9], source_occurred_at: instant, organization_id: SOURCE, project_id: SOURCE,
    source_customer_user_id: CUSTOMER, mail_message_id: reservation[10], reservation_digest: 'f'.repeat(64),
    state: 'held', reserved_at: reservation[12], expires_at: reservation[13], revision: 1, mail_state: 'pending' });
  const result = rows => ({ rows, rowCount: rows.length });
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (options.fail && sql.includes(options.fail)) throw new Error('injected storage failure');
    if (sql.includes('commerce-auto:source') || sql.includes('commerce-auto:invoice-source')) return result(options.noSource ? [] : [source]);
    if (sql.includes('commerce-auto:zero-invoice')) return result(options.validZero ? [{ id: SOURCE }] : []);
    if (sql.includes('commerce-auto:prior')) return result(options.replay ? [{ id: SOURCE }] : []);
    if (sql.includes('commerce-auto:customer') || sql.includes('commerce-auto:operator')) return result(options.noRecipient ? [] : [{ email: authority.audience === 'operator' ? OPERATOR : EMAIL }]);
    if (sql.includes('commerce-auto:suppression')) return result(options.suppressed ? [{ recipient_digest: digest(EMAIL) }] : []);
    if (sql.includes('current_setting')) return result([{ kind: 'customer' }]);
    if (sql.includes('set_config') || sql.includes('pg_advisory_xact_lock')) return result([]);
    if (sql.includes('select id, command_id, request_digest')) return result([]);
    if (sql.includes('select source.*')) return result([source]);
    if (sql.includes('insert into ss.hosted_mail_deliveries')) { mail = values; return result([]); }
    if (sql.includes('insert into ss.commerce_transition_notification_outbox')) { reservation = values; return result([{ id: values[0] }]); }
    if (sql.includes('from ss.commerce_transition_notification_outbox notification')) return result([row()]);
    assert.fail(`Unexpected query: ${sql}`);
  }};
  return { client, calls, source, get mail() { return mail; }, get reservation() { return reservation; } };
}

test('all 21 approved commerce kinds reserve privately on the existing transaction', async t => {
  const previous = process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
  process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = OPERATOR;
  try {
    assert.equal(Object.keys(COMMERCE_NOTIFICATION_AUTHORITIES).length, 21);
    for (const [kind, authority] of Object.entries(COMMERCE_NOTIFICATION_AUTHORITIES)) {
      await t.test(kind, async () => {
        const h = harness(kind);
        const reserved = await reserveCommerceTransitionMail(h.client, kind, SOURCE);
        assert.equal(reserved.notificationKind, kind);
        assert.equal(reserved.mail.lifecycleState, 'pending');
        assert.equal(reserved.mail.deliveryConfirmed, false);
        assert.equal(reserved.providerEffectsAuthorized, false);
        assert.equal(h.mail[6], authority.audience === 'customer' ? CUSTOMER : null);
        assert.equal(h.mail[7], digest(authority.audience === 'customer' ? EMAIL : OPERATOR));
        assert.equal(h.mail[10], `commerce-${kind.replaceAll('_','-')}.v1`);
        assert.equal(h.mail[11], '2026-10-20T12:34:56.790Z', 'retain Date milliseconds and round source upward');
        assert.equal(JSON.stringify(h.mail).includes('@'), false, 'no private address or rendered body stored');
        assert.deepEqual(h.calls.at(-1).values, ['customer'], 'restore the authorized business actor');
        const lookup = h.calls[0];
        assert.deepEqual(lookup.values, [kind, authority.table, SOURCE]);
        assert.equal(lookup.sql.includes('service_json_digest'), kind.endsWith('_payment_reconciliation_required'));
      });
    }
  } finally {
    if (previous === undefined) delete process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
    else process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = previous;
  }
});

test('each generated invoice is selected by the exact newly accepted source', async () => {
  for (const [kind, column] of Object.entries({ assessment_invoice_prepared: 'quote_id',
    custom_initial_invoice_prepared: 'quote_id', custom_change_invoice_prepared: 'change_order_id',
    custom_final_invoice_prepared: 'completion_package_id' })) {
    const h = harness(kind);
    await reserveCommerceInvoiceMail(h.client, kind, SOURCE);
    assert.match(h.calls[0].sql, new RegExp(`invoice\\.${column}=\\$3`));
    assert.equal(h.calls[0].values[2], SOURCE);
  }
  for (const kind of ['custom_initial_invoice_prepared', 'custom_final_invoice_prepared']) {
    const zero = harness(kind, { noSource: true, validZero: true });
    assert.equal(await reserveCommerceInvoiceMail(zero.client, kind, SOURCE), null);
    assert.equal(zero.calls.length, 2);
  }
  for (const kind of ['assessment_invoice_prepared', 'custom_initial_invoice_prepared',
    'custom_change_invoice_prepared', 'custom_final_invoice_prepared']) {
    const missing = harness(kind, { noSource: true });
    await assert.rejects(reserveCommerceInvoiceMail(missing.client, kind, SOURCE), { code: 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE' });
  }
});

test('exact source replay, removed recipients and suppression create no second mail', async () => {
  for (const options of [{ replay: true }, { noRecipient: true }, { suppressed: true }]) {
    const h = harness('assessment_quote_issued', options);
    await reserveCommerceTransitionMail(h.client, 'assessment_quote_issued', SOURCE);
    assert.equal(h.mail, undefined);
  }
});

test('source, operator configuration, capability and storage failures remain failures', async () => {
  const missing = harness('assessment_quote_issued', { noSource: true });
  await assert.rejects(reserveCommerceTransitionMail(missing.client, 'assessment_quote_issued', SOURCE), { code: 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE' });
  const previous = process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
  try {
    delete process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
    const absent = harness('invoice_finalization_failed');
    await assert.rejects(reserveCommerceTransitionMail(absent.client, 'invoice_finalization_failed', SOURCE), { code: 'COMMERCE_AUTO_MAIL_OPERATOR_CONFIGURATION_REQUIRED' });
    process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = OPERATOR;
    const inactive = harness('invoice_finalization_failed', { noRecipient: true });
    await assert.rejects(reserveCommerceTransitionMail(inactive.client, 'invoice_finalization_failed', SOURCE), { code: 'COMMERCE_AUTO_MAIL_OPERATOR_UNAVAILABLE' });
  } finally {
    if (previous === undefined) delete process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
    else process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = previous;
  }
  for (const fail of ['commerce-auto:customer', 'commerce-auto:suppression', 'insert into ss.hosted_mail_deliveries', 'insert into ss.commerce_transition_notification_outbox']) {
    const h = harness('assessment_quote_issued', { fail });
    await assert.rejects(reserveCommerceTransitionMail(h.client, 'assessment_quote_issued', SOURCE), /injected storage failure/u);
  }
});
