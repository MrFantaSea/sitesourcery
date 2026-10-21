import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createCanonicalPostgresAuthority } from '../repository-postgres.mjs';
import { createPostgresCustomServicesRequestRepository } from '../custom-services-request-postgres.mjs';
import { createPostgresCustomServicesOwner } from '../custom-services-owner-postgres.mjs';
import { createPostgresCustomServicesAssessmentQuoteRepository } from '../custom-services-assessment-quote-postgres.mjs';
import { createPostgresOperatorWorkQueueRepository } from '../operator-work-queue-postgres.mjs';
import { createOperatorWorkQueue } from '../operator-work-queue.mjs';
import { createMailLifecycle } from '../mail-lifecycle.mjs';
import { createPostgresMailLifecycleRepository } from '../mail-lifecycle-postgres.mjs';
import { createPrivateNotificationRecipientResolver, previewReviewedNotificationMail } from '../../../ops/notification-mail-private-renderer.mjs';
import { digest } from '../security.mjs';

const URL = process.env.SITESOURCERY_PG_COMMERCE_AUTO_MAIL_TEST_URL;

test('normal customer and operator transitions reserve atomically in PostgreSQL', { skip: !URL, timeout: 60_000 }, async t => {
  const pool = new pg.Pool({ connectionString: URL, max: 4 });
  const oldRecipient = process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
  try {
    assert.match((await pool.query('select current_database() as name')).rows[0].name, /^ss_commerce_mail_[a-z0-9_]+$/u);
    const authority = createCanonicalPostgresAuthority({ pool });
    const customerId = randomUUID(), operatorId = randomUUID(), organizationId = randomUUID(), billingId = randomUUID();
    const customerEmail = `customer-${customerId}@example.test`, operatorEmail = `operator-${operatorId}@example.test`;
    process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = operatorEmail;
    await pool.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [customerId, customerEmail, operatorId, operatorEmail]);
    await pool.query("insert into ss.hosted_account_profiles(user_id,display_name,state) values($1,'Customer fixture','active'),($2,'Operator fixture','active')", [customerId, operatorId]);
    await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Commerce fixture')", [organizationId, customerId]);
    await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [organizationId, customerId]);
    await pool.query("insert into ss.billing_policies(id,policy_key,grace_period,retention_period,effective_at) values($1,$2,interval '14 days',interval '90 days',clock_timestamp())", [billingId, `commerce-${billingId}`]);
    await pool.query("insert into ss.operator_profiles(user_id,display_label,authorized_by_user_id,authorized_at) values($1,'Commerce operator',$1,clock_timestamp())", [operatorId]);
    for (const capability of ['service_quote_author','service_payment_reconcile']) {
      await pool.query('insert into ss.operator_permissions(operator_user_id,capability,granted_by_user_id,granted_at) values($1,$2,$1,clock_timestamp())', [operatorId, capability]);
      await pool.query(`insert into ss.service_operator_authority_events(operator_user_id,capability,event_sequence,event_kind,recorded_by_kind,effective_at,expires_at,created_at)
        values($1,$2,1,'grant','deployment_control',clock_timestamp(),clock_timestamp()+interval '1 day',clock_timestamp())`, [operatorId, capability]);
    }
    const requests = createPostgresCustomServicesRequestRepository({ authority });
    async function assessment() {
      const projectId = randomUUID();
      await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Commerce fixture')", [projectId, organizationId, customerId, billingId]);
      const scope = { actorId: customerId, customerId, organizationId, projectId };
      await requests.saveDraft({ ...scope, commandId: randomUUID(), expectedDraftRevision: 0,
        siteDisplayName: 'Private commerce fixture', publicUrl: 'https://fixture.example.test/', businessName: 'Fixture',
        primaryGoal: 'Prove automatic quote mail without external delivery.', customerObservation: null, platformFamily: 'custom',
        approximatePublicSize: 'one_to_ten', complexityFlags: [], importantDate: null, customerOwnershipAffirmed: true });
      const draft = await requests.readCurrentRequest(scope);
      await requests.submitCurrentRequest({ ...scope, commandId: randomUUID(), draftRevision: draft.draftRevision });
      return { scope, caseId: draft.caseId, issue: { commandId: randomUUID(), organizationId,
        deliveryDate: new Date(Date.now()+7*86400000).toISOString().slice(0,10), reviewTargets: [{ kind: 'page', value: '/' }] } };
    }
    const owner = createPostgresCustomServicesOwner({ authority });
    const quotes = createPostgresCustomServicesAssessmentQuoteRepository({ authority });
    const resolver = createPrivateNotificationRecipientResolver({ authority, operatorRecipient: operatorEmail });
    async function assertReservation(kind, sourceId, to) {
      const selected = await pool.query(`select notification.*, mail.state as mail_state, mail.recipient_digest,
        mail.subject_reference_digest, mail.content_digest, mail.template_version, mail.message_type, mail.requested_at
        from ss.commerce_transition_notification_outbox notification join ss.hosted_mail_deliveries mail on mail.id=notification.mail_message_id
        where notification.notification_kind=$1 and notification.source_id=$2`, [kind, sourceId]);
      assert.equal(selected.rowCount, 1);
      const row = selected.rows[0];
      assert.equal(row.mail_state, 'pending'); assert.equal(row.state, 'held');
      assert.equal(row.provider_effects_authorized, false); assert.equal(row.delivery_claimed, false);
      assert.equal(row.recipient_digest, digest(to));
      const rendered = previewReviewedNotificationMail({ templateVersion: row.template_version, to,
        variables: { reference: row.source_id, revision: Number(row.source_revision), state: row.source_state } });
      assert.equal(row.content_digest, rendered.evidence.contentDigest);
      const resolved = await resolver.resolve({ messageId: row.mail_message_id, messageType: row.message_type,
        templateVersion: row.template_version, recipientDigest: row.recipient_digest, sourceKind: 'commerce',
        contentDigest: row.content_digest, subjectReferenceDigest: row.subject_reference_digest,
        sourceReservationId: row.id, sourceReservationDigest: row.reservation_digest, observedAt: new Date().toISOString() });
      assert.equal(resolved.to, to);
      assert.equal(await pool.query('select 1 from ss.hosted_mail_delivery_events where message_id=$1', [row.mail_message_id]).then(r=>r.rowCount), 0);
      return row;
    }
    const injected = { service(context, work) { return authority.service(context, client => work({ query(sql, values) {
      if (sql.includes('insert into ss.commerce_transition_notification_outbox')) throw new Error('injected reservation failure');
      return client.query(sql, values);
    } })); } };

    await t.test('owner quote and customer acceptance create one reviewed reservation each, including exact replay', async () => {
      const fixture = await assessment();
      const quote = await owner.issueAssessmentQuote({ userId: operatorId }, fixture.caseId, fixture.issue);
      assert.deepEqual(await owner.issueAssessmentQuote({ userId: operatorId }, fixture.caseId, fixture.issue), quote);
      const revision = (await pool.query('select * from ss.service_quote_revisions where quote_id=$1', [quote.quoteId])).rows[0];
      await assertReservation('assessment_quote_issued', revision.id, customerEmail);
      const acceptance = { ...fixture.scope, commandId: randomUUID(), quoteId: quote.quoteId, quoteRevision: quote.quoteRevision,
        acceptedQuoteDigest: revision.quote_digest, acceptedDisclosureDigest: revision.disclosure_digest,
        acceptanceStatement: 'accepted_exact_quote_and_delivery_date' };
      const accepted = await quotes.acceptCurrentQuote(acceptance);
      assert.deepEqual(await quotes.acceptCurrentQuote(acceptance), accepted);
      const invoice = (await pool.query('select id from ss.service_invoices where quote_id=$1', [quote.quoteId])).rows[0];
      await assertReservation('assessment_invoice_prepared', invoice.id, customerEmail);
    });

    await t.test('outbox failure rolls back quote, command, and pending mail, allowing safe exact retry', async () => {
      const fixture = await assessment();
      const broken = createPostgresCustomServicesOwner({ authority: injected });
      const before = await pool.query('select count(*)::int as n from ss.hosted_mail_deliveries');
      await assert.rejects(broken.issueAssessmentQuote({ userId: operatorId }, fixture.caseId, fixture.issue), /injected reservation failure/u);
      assert.equal((await pool.query('select count(*)::int as n from ss.service_quotes where case_id=$1', [fixture.caseId])).rows[0].n, 0);
      assert.equal((await pool.query('select count(*)::int as n from ss.idempotency_keys where idempotency_key=$1', [fixture.issue.commandId])).rows[0].n, 0);
      assert.deepEqual((await pool.query('select count(*)::int as n from ss.hosted_mail_deliveries')).rows, before.rows);
      const quote = await owner.issueAssessmentQuote({ userId: operatorId }, fixture.caseId, fixture.issue);
      const revision = (await pool.query('select id from ss.service_quote_revisions where quote_id=$1', [quote.quoteId])).rows[0];
      await assertReservation('assessment_quote_issued', revision.id, customerEmail);
    });

    await t.test('missing mandatory invoice source rolls back acceptance and trigger-created invoice', async () => {
      const fixture = await assessment();
      const quote = await owner.issueAssessmentQuote({ userId: operatorId }, fixture.caseId, fixture.issue);
      const revision = (await pool.query('select * from ss.service_quote_revisions where quote_id=$1', [quote.quoteId])).rows[0];
      const command = { ...fixture.scope, commandId: randomUUID(), quoteId: quote.quoteId, quoteRevision: quote.quoteRevision,
        acceptedQuoteDigest: revision.quote_digest, acceptedDisclosureDigest: revision.disclosure_digest,
        acceptanceStatement: 'accepted_exact_quote_and_delivery_date' };
      const missingSource = { service(context, work) { return authority.service(context, client => work({ query(sql, values) {
        if (sql.includes('commerce-auto:invoice-source')) return Promise.resolve({ rows: [], rowCount: 0 });
        return client.query(sql, values);
      } })); } };
      const broken = createPostgresCustomServicesAssessmentQuoteRepository({ authority: missingSource });
      const before = (await pool.query('select count(*)::int as n from ss.hosted_mail_deliveries')).rows;
      await assert.rejects(broken.acceptCurrentQuote(command), { code: 'COMMERCE_AUTO_MAIL_SOURCE_UNAVAILABLE' });
      assert.equal((await pool.query('select count(*)::int as n from ss.service_quote_acceptances where quote_id=$1', [quote.quoteId])).rows[0].n, 0);
      assert.equal((await pool.query('select count(*)::int as n from ss.service_invoices where quote_id=$1', [quote.quoteId])).rows[0].n, 0);
      assert.deepEqual((await pool.query('select count(*)::int as n from ss.hosted_mail_deliveries')).rows, before);
      await quotes.acceptCurrentQuote(command);
      const invoice = (await pool.query('select id from ss.service_invoices where quote_id=$1', [quote.quoteId])).rows[0];
      await assertReservation('assessment_invoice_prepared', invoice.id, customerEmail);
    });

    const queueFor = selected => createOperatorWorkQueue({ repository: createPostgresOperatorWorkQueueRepository({ authority: selected }),
      reversalRepair: { async reconcileEvidence() { assert.fail('No provider action'); } }, clock: { now: () => new Date().toISOString() } });
    const failure = () => ({ commandId: randomUUID(), providerEventIdDigest: digest(randomUUID()), invoiceIdDigest: digest(randomUUID()),
      payloadDigest: digest(randomUUID()), signatureVerificationDigest: digest(randomUUID()), reasonCode: 'unknown_review',
      providerCreatedAt: new Date(Date.now()-60000).toISOString() });
    await t.test('operator evidence and notice are atomic, exact recipient-bound, and replay-safe', async () => {
      const command = failure(), queue = queueFor(authority);
      const evidence = await queue.recordInvoiceFinalizationFailure(command);
      assert.deepEqual(await queue.recordInvoiceFinalizationFailure(command), evidence);
      await assertReservation('invoice_finalization_failed', evidence.id, operatorEmail);
      const failed = failure();
      await assert.rejects(queueFor(injected).recordInvoiceFinalizationFailure(failed), /injected reservation failure/u);
      assert.equal((await pool.query('select count(*)::int as n from ss.stripe_invoice_finalization_failures where command_id=$1', [failed.commandId])).rows[0].n, 0);
      delete process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
      const missing = failure();
      await assert.rejects(queue.recordInvoiceFinalizationFailure(missing), { code: 'COMMERCE_AUTO_MAIL_OPERATOR_CONFIGURATION_REQUIRED' });
      assert.equal((await pool.query('select count(*)::int as n from ss.stripe_invoice_finalization_failures where command_id=$1', [missing.commandId])).rows[0].n, 0);
      process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = operatorEmail;
    });

    await t.test('known recipient suppression preserves new business actions without reserving mail', async () => {
      const first = await assessment();
      const issued = await owner.issueAssessmentQuote({ userId: operatorId }, first.caseId, first.issue);
      const revision = (await pool.query('select id from ss.service_quote_revisions where quote_id=$1', [issued.quoteId])).rows[0];
      const notification = await assertReservation('assessment_quote_issued', revision.id, customerEmail);
      // Synthetic local delivery evidence only. No provider adapter or network.
      const mail = createMailLifecycle({ repository: createPostgresMailLifecycleRepository({ authority }),
        clock: { now: () => new Date().toISOString() } });
      const providerMessageIdDigest = digest(randomUUID());
      await mail.recordProviderAcceptance({ commandId: randomUUID(), messageId: notification.mail_message_id,
        provider: 'local_fixture', providerMessageIdDigest, evidenceDigest: digest(randomUUID()), acceptedAt: new Date().toISOString() });
      await mail.ingestProviderEvent({ provider: 'local_fixture', providerMessageIdDigest,
        providerEventIdDigest: digest(randomUUID()), evidenceDigest: digest(randomUUID()),
        signatureVerificationDigest: digest(randomUUID()), eventKind: 'suppressed', occurredAt: new Date().toISOString() });
      assert.equal((await pool.query('select count(*)::int as n from ss.hosted_mail_recipient_suppressions where recipient_digest=$1', [digest(customerEmail)])).rows[0].n, 1);
      const next = await assessment();
      const quote = await owner.issueAssessmentQuote({ userId: operatorId }, next.caseId, next.issue);
      const source = (await pool.query('select id from ss.service_quote_revisions where quote_id=$1', [quote.quoteId])).rows[0];
      assert.ok(source);
      assert.equal((await pool.query('select count(*)::int as n from ss.commerce_transition_notification_outbox where source_id=$1', [source.id])).rows[0].n, 0);
    });
  } finally {
    if (oldRecipient === undefined) delete process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT;
    else process.env.SITESOURCERY_NOTIFICATION_MAIL_OPERATOR_RECIPIENT = oldRecipient;
    await pool.end();
  }
});
