import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createCanonicalPostgresAuthority } from '../repository-postgres.mjs';
import { createPostgresCareCoreRepository } from '../care-core-postgres.mjs';
import { digest } from '../security.mjs';
import { createCareTicketOpen } from '../care-core.mjs';
import { reserveAutomaticPurposeEvent } from '../purpose-event-notifications.mjs';
import { verifyCareCorePostgres } from '../../data-plane/tests/care-core-postgres-proof.mjs';
import { verifyCareCommercePostgres } from '../../data-plane/tests/care-commerce-postgres-proof.mjs';
import { verifyResponderCommercePostgres } from '../../data-plane/tests/responder-commerce-postgres-proof.mjs';
import { verifyResponderForwardingPostgres } from '../../data-plane/tests/responder-forwarding-postgres-proof.mjs';
import { createMailLifecycle } from '../mail-lifecycle.mjs';
import { createPostgresMailLifecycleRepository } from '../mail-lifecycle-postgres.mjs';
import { createPostgresDomainProviderRouteComposition, createPostgresDomainProviderRouteRepository } from '../domain-provider-route-postgres.mjs';
import { createHeldDomainPriceChargeBoundary } from '../domain-price-charge-boundary.mjs';
import { createPostgresDomainLifecycleRepository } from '../domain-lifecycle-postgres.mjs';
import { createHeldDomainProviderLifecycle, DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA } from '../../domain/provider-lifecycle.mjs';
import { createNotificationMailPrivateRenderer, REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 } from '../../../ops/notification-mail-private-renderer.mjs';

const DATABASE_URL = process.env.SITESOURCERY_PG_PURPOSE_NOTIFICATION_TEST_URL;
const SHA = 'a'.repeat(64);
async function seedCustomer(pool) {
  const customer = randomUUID(), organization = randomUUID(), project = randomUUID();
  await pool.query('insert into auth.users(id,email) values($1,$2)', [customer, `purpose-${customer}@example.test`]);
  await pool.query("insert into ss.hosted_account_profiles(user_id,display_name) values($1,'Purpose mail fixture')", [customer]);
  await pool.query("insert into ss.organizations(id,created_by_user_id,name) values($1,$2,'Purpose mail fixture')", [organization, customer]);
  await pool.query("insert into ss.organization_memberships(organization_id,user_id,role,state) values($1,$2,'owner','active')", [organization, customer]);
  const billing = (await pool.query('select id from ss.billing_policies order by id limit 1')).rows[0].id;
  await pool.query("insert into ss.projects(id,organization_id,created_by_user_id,billing_policy_id,name) values($1,$2,$3,$4,'Purpose mail fixture')", [project, organization, customer, billing]);
  await createCanonicalPostgresAuthority({ pool }).service({ actorKind: 'customer', userId: customer, organizationId: organization }, client => client.query(`insert into ss.service_project_profiles(organization_id,project_id,customer_user_id,origin,takeover_required,takeover_state,supportability_state)
    values($1,$2,$3,'external',true,'review_required','not_reviewed')`, [organization, project, customer]));
  return { customer, organization, project };
}

// Uses inert registrar ports; no network/provider effects are reachable.
async function seedDomain(pool, authority) {
  const { customer, organization, project } = await seedCustomer(pool);
  const domain = `purpose-${randomUUID()}.example`;
  const observedAt = new Date(Date.now() - 1000).toISOString(), expiresAt = new Date(Date.now() + 300000).toISOString();
  const expiry = new Date(Date.now() + 365 * 86400000).toISOString();
  const operationId = randomUUID(), quoteId = randomUUID();
  const registrar = {
    async previewRegistration() { return { status: 'confirmation_required', domain, years: 1, price: { amountMinor: 1400, currency: 'USD' },
      priceClass: 'standard', quoteId, observedAt, expiresAt, noCharge: true }; },
    async confirmRegistration(input) { return { operationId, price: input.expectedPrice }; },
    async getOperation() { return { status: 'success' }; },
    async getDomain() { return { name: domain, lifecycleStatus: 'registered', contacts: { registrant: 'fixture-contact' } }; },
    async readRegistrationCharge() { return { status: 'final', ambiguous: false, providerCode: 'spaceship', domain, operationId,
      quoteId, quoteExpiresAt: expiresAt, price: { amountMinor: 1400, currency: 'USD' }, chargeReference: randomUUID(),
      observedAt: new Date().toISOString(), evidenceExpiresAt: expiresAt }; }
  };
  const providers = { primary: { code: 'spaceship', registrarOfRecord: 'Spaceship', configured: true, healthy: true, registrar },
    secondary: { code: 'secondary', registrarOfRecord: 'Held registrar', configured: false, healthy: false }, preference: ['spaceship', 'secondary'] };
  const routeRepository = createPostgresDomainProviderRouteRepository({ authority });
  const routes = createPostgresDomainProviderRouteComposition({ repository: routeRepository, registrarProviders: providers });
  const scope = { organizationId: organization, projectId: project, customerId: customer, actorId: customer };
  const charge = createHeldDomainPriceChargeBoundary({ repository: routeRepository, registrarProviders: providers, async resolveProjectScope() { return scope; } });
  const quote = await charge.quoteExactRegistration({ actor: { userId: customer }, projectId: project, selectionKey: randomUUID(), domain, years: 1 });
  const attemptKey = randomUUID();
  await routes.submitRegistration({ organizationId: organization, projectId: project, routeId: quote.routeRef, attemptKey,
    input: { domain, years: 1, contacts: { registrant: 'fixture-contact' } } });
  await charge.prepareFinalCharge({ actor: { userId: customer }, projectId: project, routeId: quote.routeRef, attemptKey, expectedRegistrantContactId: 'fixture-contact' });
  const { pin } = await routeRepository.readPin({ organizationId: organization, projectId: project, domain });
  let state = 'active', lifecycleObservedAt = observedAt;
  const core = createHeldDomainProviderLifecycle({ repository: createPostgresDomainLifecycleRepository({ authority }), providerReadPort: {
    async previewRenewal() { throw Error('unused fixture renewal'); },
    async readLifecycle() { return { schema: DOMAIN_PROVIDER_LIFECYCLE_READBACK_SCHEMA, providerCode: 'spaceship', domain, authoritative: true,
      lifecycleStatus: state, expirationDate: expiry, autoRenew: false, transferStatus: 'none', transferEligible: true,
      transferLocked: true, observedAt: lifecycleObservedAt, providerReference: 'fixture-existing-registration' }; }
  } });
  return { core, scope, pin, setState(value) { state = value; lifecycleObservedAt = new Date(Date.parse(lifecycleObservedAt) + 10).toISOString(); } };
}

test('normal purpose actions atomically reserve private mail on PostgreSQL', { skip: !DATABASE_URL, timeout: 90_000 }, async t => {
  const url = new URL(DATABASE_URL);
  assert.match(url.pathname, /^\/ss_purpose_mail_[a-z0-9_]+$/u);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const authority = createCanonicalPostgresAuthority({ pool });
    const customer = await seedCustomer(pool);
    const count = async () => (await pool.query('select count(*)::int as n from ss.hosted_mail_deliveries')).rows[0].n;
    await t.test('ordinary Care and Responder commands cover ten templates with exact business retries', async () => {
      await verifyCareCorePostgres(pool);
      await verifyCareCommercePostgres(pool);
      await verifyResponderCommercePostgres(pool);
      await verifyResponderForwardingPostgres(pool);
      const kinds = (await pool.query('select distinct notification_kind from ss.mail_purpose_notification_outbox order by 1')).rows.map(r => r.notification_kind);
      assert.deepEqual(kinds, ['care_commerce_quote_held','care_commerce_reservation_cancelled','care_commerce_reservation_held',
        'care_ticket_acknowledgment','care_ticket_resolved','care_ticket_update','responder_commerce_quote_held',
        'responder_commerce_reservation_cancelled','responder_commerce_reservation_held','responder_forwarding_updated']);
      assert.equal((await pool.query("select count(*)::int as n from ss.hosted_mail_deliveries where state<>'pending' or provider is not null")).rows[0].n, 0);
    });
    await t.test('domain lifecycle changes notify, repeated observations and command retries do not', async () => {
      const domain = await seedDomain(pool, authority), before = await count();
      const input = { scope: domain.scope, pin: domain.pin, commandId: randomUUID() };
      await domain.core.refreshAuthoritative(input);
      assert.equal(await count(), before + 1);
      await domain.core.refreshAuthoritative(input);
      await domain.core.refreshAuthoritative({ ...input, commandId: randomUUID() });
      assert.equal(await count(), before + 1);
      domain.setState('grace');
      await domain.core.refreshAuthoritative({ ...input, commandId: randomUUID() });
      assert.equal(await count(), before + 2);
    });
    const core = createPostgresCareCoreRepository({ authority });
    async function ticket() {
      const scope = (await pool.query(`select contract.id as contract_id, period.id as period_id from ss.care_customer_contracts contract
        join ss.care_periods period on period.contract_id=contract.id where contract.organization_id=$1 and period.state='open' limit 1`, [customer.organization])).rows[0];
      const support = randomUUID();
      await pool.query("insert into ss.support_tickets(id,organization_id,project_id,opened_by_user_id,subject,state) values($1,$2,$3,$4,'Purpose fixture','open')",
        [support, customer.organization, customer.project, customer.customer]);
      return createCareTicketOpen({ actor: { actorId: null, actorKind: 'system', organizationId: customer.organization }, commandId: randomUUID(),
        recordedAt: new Date().toISOString(), ticketId: randomUUID(), projectId: customer.project,
        contractId: scope.contract_id, periodId: scope.period_id, supportTicketId: support, basisKind: 'customer_request',
        basisReferenceId: null, basisDigest: digest(randomUUID()), workScopeDigest: digest(randomUUID()) });
    }
    await t.test('a real reservation failure rolls back the normal business command and pending delivery', async () => {
      const input = await ticket(), before = await count();
      await pool.query(`create function ss.purpose_mail_fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'fixture purpose reservation failure'; end $$;
        create trigger purpose_mail_fixture_fail before insert on ss.mail_purpose_notification_outbox for each row execute function ss.purpose_mail_fixture_fail()`);
      try {
        await assert.rejects(core.openTicket(input), /fixture purpose reservation failure/u);
        assert.equal(await count(), before);
        assert.equal((await pool.query('select count(*)::int as n from ss.care_commands where command_id=$1', [input.commandId])).rows[0].n, 0);
        assert.equal((await pool.query('select count(*)::int as n from ss.care_tickets where id=$1', [input.ticketId])).rows[0].n, 0);
      } finally { await pool.query('drop trigger purpose_mail_fixture_fail on ss.mail_purpose_notification_outbox; drop function ss.purpose_mail_fixture_fail()'); }
      await core.openTicket(input);
      const after = await count();
      await core.openTicket(input);
      assert.equal(await count(), after);
    });
    await t.test('known suppressed recipients preserve normal business writes without new mail', async () => {
      const message = (await pool.query('select id from ss.hosted_mail_deliveries where customer_user_id=$1 order by created_at limit 1', [customer.customer])).rows[0];
      const lifecycle = createMailLifecycle({ repository: createPostgresMailLifecycleRepository({ authority }), clock: { now: () => new Date().toISOString() } });
      await lifecycle.recordProviderAcceptance({ commandId: randomUUID(), messageId: message.id, provider: 'resend', providerMessageIdDigest: SHA,
        evidenceDigest: SHA, acceptedAt: new Date().toISOString() });
      await lifecycle.ingestProviderEvent({ provider: 'resend', providerEventIdDigest: SHA, providerMessageIdDigest: SHA,
        eventKind: 'suppressed', signatureVerificationDigest: SHA, evidenceDigest: SHA, occurredAt: new Date().toISOString() });
      const before = await count(), input = await ticket();
      await core.openTicket(input);
      assert.equal(await count(), before);
      assert.equal((await pool.query('select count(*)::int as n from ss.care_tickets where id=$1', [input.ticketId])).rows[0].n, 1);
    });
    await t.test('exact source replay and the existing private dispatcher renderer remain compatible', async () => {
      const source = (await pool.query("select * from ss.mail_purpose_notification_outbox where notification_kind='responder_commerce_quote_held' limit 1")).rows[0];
      const before = await count();
      const replay = await authority.service({ actorKind: 'system', organizationId: source.organization_id }, client => reserveAutomaticPurposeEvent(client,
        { table: source.source_table, id: source.source_id, organizationId: source.organization_id }));
      assert.equal(replay.replayed, true); assert.equal(await count(), before);
      const mail = (await pool.query('select * from ss.hosted_mail_deliveries where id=$1', [source.mail_message_id])).rows[0];
      const renderer = createNotificationMailPrivateRenderer({ authority, configuration: { mode: 'reviewed', operatorRecipient: 'operator@example.test',
        templateRegistrySha256: REVIEWED_NOTIFICATION_TEMPLATE_REGISTRY_SHA256 } });
      const rendered = await renderer.render({ messageId: mail.id, messageType: mail.message_type, sourceKind: 'purpose', sourceReservationId: source.id,
        sourceReservationDigest: source.reservation_digest, observedAt: new Date().toISOString(), recipientDigest: mail.recipient_digest,
        subjectReferenceDigest: mail.subject_reference_digest, contentDigest: mail.content_digest, templateVersion: mail.template_version });
      assert.equal(rendered.templateVersion, 'responder-commerce-quote-held.v1');
      assert.equal(renderer.providerEffects, false);
    });
  } finally { await pool.end(); }
});
