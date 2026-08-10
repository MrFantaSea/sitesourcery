import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createAccountingPurposeJournal } from
  "../accounting-purpose-journal.mjs";
import { createPostgresAccountingPurposeJournalRepository } from
  "../accounting-purpose-journal-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_ACCOUNTING_TEST_URL;
const { Pool } = pg;

const digest = (character) => character.repeat(64);

async function insertSourceFixtures(pool, operatorId) {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const customerId = randomUUID();
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  const sourceIds = {
    download: randomUUID(),
    assessment: randomUUID(),
    customStart: randomUUID(),
    customChange: randomUUID(),
    customFinal: randomUUID(),
    alakazam: randomUUID(),
    domain: randomUUID()
  };
  const client = await pool.connect();
  try {
    await client.query("set session_replication_role = replica");

    const downloadEventId = "evt_accounting_download_001";
    const downloadVersionId = randomUUID();
    const downloadQuoteId = randomUUID();
    const downloadDisclosureDigest = digest("a");
    const downloadPurposeDigest = digest("b");
    await client.query(
      `insert into ss.commerce_v2_download_stripe_events (
         id, organization_id, project_id, preparation_command_id,
         checkout_session_id, event_type, livemode, payload_digest,
         provider_created_at, state, result, observed_at, completed_at
       ) values (
         $1, $2, $3, 'accounting-download-command-001',
         'cs_accounting_download_001', 'checkout.session.completed', false,
         $4, $5, 'processed', '{}'::jsonb, $5, $5
       )`,
      [downloadEventId, organizationId, projectId, digest("c"), occurredAt]
    );
    const downloadFacts = {
      schema: "sitesourcery.abracadabra-payment-receipt.v2",
      receiptId: sourceIds.download,
      provider: "stripe",
      eventId: downloadEventId,
      checkoutSessionId: "cs_accounting_download_001",
      paymentIntentId: "pi_accounting_download_001",
      stripeCustomerId: "cus_accounting_download_001",
      projectId,
      versionId: downloadVersionId,
      quoteId: downloadQuoteId,
      purposeDigest: downloadPurposeDigest,
      acceptedDisclosureDigest: downloadDisclosureDigest,
      payment: {
        status: "paid",
        provider: "stripe",
        receiptId: sourceIds.download,
        amountMinor: 500,
        taxMinor: 40,
        totalMinor: 540,
        taxMode: "automatic",
        currency: "USD",
        settledAt: occurredAt
      }
    };
    await client.query(
      `insert into ss.commerce_v2_download_payment_receipts (
         id, organization_id, project_id, version_id, quote_id,
         customer_user_id, preparation_command_id, stripe_event_id,
         provider, checkout_session_id, payment_intent_id,
         stripe_customer_id, payment_status, amount_minor, tax_minor,
         total_minor, tax_mode, currency, purpose_digest,
         accepted_disclosure_digest, settled_at, facts
       ) values (
         $1, $2, $3, $4, $5, $6, 'accounting-download-command-001', $7,
         'stripe', 'cs_accounting_download_001',
         'pi_accounting_download_001', 'cus_accounting_download_001',
         'paid', 500, 40, 540, 'automatic', 'USD', $8, $9, $10, $11
       )`,
      [
        sourceIds.download, organizationId, projectId, downloadVersionId,
        downloadQuoteId, customerId, downloadEventId,
        downloadPurposeDigest, downloadDisclosureDigest, occurredAt,
        downloadFacts
      ]
    );

    const commonReceipt = {
      organizationId,
      projectId,
      customerId,
      caseId: randomUUID(),
      purposeDigest: digest("d"),
      invoiceDigest: digest("e"),
      quoteDigest: digest("f"),
      disclosureDigest: digest("1"),
      providerFactsDigest: digest("2"),
      occurredAt
    };
    await client.query(
      `insert into ss.service_assessment_payment_receipts (
         id, organization_id, project_id, case_id, customer_user_id,
         invoice_id, checkout_attempt_id, stripe_event_id, provider,
         checkout_session_id, payment_intent_id, stripe_customer_id,
         payment_status, subtotal_minor, tax_minor, total_minor,
         tax_mode, currency, purpose_digest, invoice_digest,
         accepted_disclosure_digest, provider_facts,
         provider_facts_digest, provider_paid_at, settled_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'evt_accounting_assessment_001',
         'stripe', 'cs_accounting_assessment_001',
         'pi_accounting_assessment_001', 'cus_accounting_assessment_001',
         'paid', 20000, 1600, 21600, 'automatic', 'USD', $8, $9, $10,
         '{}'::jsonb, $11, $12, $12
       )`,
      [
        sourceIds.assessment, organizationId, projectId,
        commonReceipt.caseId, customerId, randomUUID(), randomUUID(),
        commonReceipt.purposeDigest, commonReceipt.invoiceDigest,
        commonReceipt.disclosureDigest, commonReceipt.providerFactsDigest,
        occurredAt
      ]
    );

    await client.query(
      `insert into ss.service_custom_build_payment_receipts (
         id, organization_id, project_id, case_id, customer_user_id,
         invoice_id, checkout_attempt_id, stripe_event_id,
         credit_application_id, provider, checkout_session_id,
         payment_intent_id, stripe_customer_id, payment_status,
         subtotal_minor, tax_minor, total_minor, tax_mode, currency,
         purpose_digest, invoice_digest, accepted_quote_digest,
         accepted_disclosure_digest, provider_facts,
         provider_facts_digest, provider_paid_at, settled_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'evt_accounting_custom_start_001',
         $8, 'stripe', 'cs_accounting_custom_start_001',
         'pi_accounting_custom_start_001', 'cus_accounting_custom_start_001',
         'paid', 30000, 2400, 32400, 'automatic', 'USD', $9, $10, $11,
         $12, '{}'::jsonb, $13, $14, $14
       )`,
      [
        sourceIds.customStart, organizationId, projectId,
        commonReceipt.caseId, customerId, randomUUID(), randomUUID(),
        randomUUID(), commonReceipt.purposeDigest,
        commonReceipt.invoiceDigest, commonReceipt.quoteDigest,
        commonReceipt.disclosureDigest, commonReceipt.providerFactsDigest,
        occurredAt
      ]
    );

    await client.query(
      `insert into ss.service_custom_build_change_payment_receipts (
         id, organization_id, project_id, case_id, customer_user_id,
         job_id, change_order_id, change_acceptance_id, invoice_id,
         checkout_attempt_id, receipt_source, stripe_event_id,
         reconciled_by_operator_user_id, provider, checkout_session_id,
         payment_intent_id, stripe_customer_id, payment_status,
         subtotal_minor, tax_minor, total_minor, tax_mode, currency,
         purpose_digest, invoice_digest, accepted_quote_digest,
         accepted_disclosure_digest, provider_facts,
         provider_facts_digest, provider_paid_at, settled_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         'provider_readback', null, $11, 'stripe',
         'cs_accounting_custom_change_001',
         'pi_accounting_custom_change_001', 'cus_accounting_custom_change_001',
         'paid', 4500, 360, 4860, 'automatic', 'USD', $12, $13, $14,
         $15, '{}'::jsonb, $16, $17, $17
       )`,
      [
        sourceIds.customChange, organizationId, projectId,
        commonReceipt.caseId, customerId, randomUUID(), randomUUID(),
        randomUUID(), randomUUID(), randomUUID(), operatorId,
        commonReceipt.purposeDigest, commonReceipt.invoiceDigest,
        commonReceipt.quoteDigest, commonReceipt.disclosureDigest,
        commonReceipt.providerFactsDigest, occurredAt
      ]
    );

    await client.query(
      `insert into ss.service_custom_build_final_payment_receipts (
         id, organization_id, project_id, case_id, customer_user_id,
         job_id, obligation_id, completion_package_id, invoice_id,
         checkout_attempt_id, receipt_source, stripe_event_id,
         reconciled_by_operator_user_id, provider, checkout_session_id,
         payment_intent_id, charge_id, stripe_customer_id, payment_status,
         charge_captured, amount_refunded_minor, disputed, subtotal_minor,
         tax_minor, total_minor, tax_mode, currency, purpose,
         purpose_digest, obligation_digest, completion_package_digest,
         invoice_digest, accepted_quote_digest, accepted_disclosure_digest,
         provider_facts, provider_facts_digest, provider_paid_at, settled_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         'stripe_event', 'evt_accounting_custom_final_001', null, 'stripe',
         'cs_accounting_custom_final_001', 'pi_accounting_custom_final_001',
         'ch_accounting_custom_final_001', 'cus_accounting_custom_final_001',
         'paid', true, 0, false, 12000, 960, 12960, 'automatic', 'USD',
         'custom_build_final', $11, $12, $13, $14, $15, $16,
         '{}'::jsonb, $17, $18, $18
       )`,
      [
        sourceIds.customFinal, organizationId, projectId,
        commonReceipt.caseId, customerId, randomUUID(), randomUUID(),
        randomUUID(), randomUUID(), randomUUID(),
        commonReceipt.purposeDigest, digest("3"), digest("4"),
        commonReceipt.invoiceDigest, commonReceipt.quoteDigest,
        commonReceipt.disclosureDigest, commonReceipt.providerFactsDigest,
        occurredAt
      ]
    );

    await client.query(
      `insert into ss.alakazam_payment_receipts (
         id, organization_id, project_id, customer_user_id,
         subscription_id, quote_id, stripe_event_row_id, receipt_kind,
         stripe_invoice_id, stripe_payment_intent_id, list_subtotal_minor,
         provider_discount_minor, net_subtotal_minor, tax_minor,
         total_minor, tax_mode, currency, settled_at, provider_facts,
         provider_facts_digest
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'start_payment', null,
         'pi_accounting_alakazam_001', 3500, 0, 3500, 280, 3780,
         'automatic', 'USD', $8, '{}'::jsonb, $9
       )`,
      [
        sourceIds.alakazam, organizationId, projectId, customerId,
        randomUUID(), randomUUID(), randomUUID(), occurredAt,
        commonReceipt.providerFactsDigest
      ]
    );

    const domainQuoteId = randomUUID();
    const domainFacts = {
      quoteId: domainQuoteId,
      currency: "USD",
      amountMinor: 1700
    };
    await client.query(
      `insert into ss.provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, source_event_ref, facts, facts_digest,
         occurred_at, recorded_at
       ) values (
         $1, $2, $3, 'stripe', 'domain_payment_captured',
         'pi_accounting_domain_001', 'evt_accounting_domain_001',
         $4, $5, $6, $6
       )`,
      [
        sourceIds.domain, organizationId, projectId, domainFacts,
        digest("5"), occurredAt
      ]
    );
    const authorizedAt = new Date(
      Date.parse(occurredAt) - 1000
    ).toISOString();
    const authorizationExpiresAt = new Date(
      Date.parse(occurredAt) + 3_600_000
    ).toISOString();
    await client.query(
      `insert into ss.domain_payment_allocations (
         id, organization_id, project_id, quote_id,
         stripe_provider_receipt_id, stripe_payment_reference,
         currency, amount_minor, state, recorded_at, authorized_at,
         authorization_expires_at, captured_at
       ) values (
         $1, $2, $3, $4, $5, 'pi_accounting_domain_001',
         'USD', 1700, 'captured', $6, $7, $8, $6
       )`,
      [
        randomUUID(), organizationId, projectId, domainQuoteId,
        sourceIds.domain, occurredAt, authorizedAt, authorizationExpiresAt
      ]
    );
  } finally {
    await client.query("set session_replication_role = origin");
    client.release();
  }
  return { organizationId, projectId, sourceIds };
}

test("seven authoritative receipt relations project once and export without invented facts", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const operatorId = randomUUID();
    const authorizerId = randomUUID();
    const operatorOrganizationId = randomUUID();
    await pool.query(
      `insert into auth.users (id, email) values ($1, $2), ($3, $4)`,
      [
        operatorId, `accounting-operator-${operatorId}@example.test`,
        authorizerId, `accounting-authorizer-${authorizerId}@example.test`
      ]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (user_id, display_name, state)
       values ($1, 'Accounting Operator', 'active'),
              ($2, 'Accounting Authorizer', 'active')`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id, authorized_at
       ) values ($1, 'Accounting Operator', 'held', $2, clock_timestamp())`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state,
         granted_by_user_id, granted_at
       ) values (
         $1, 'service_management_manage', 'held', $2, clock_timestamp()
       )`,
      [operatorId, authorizerId]
    );
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at,
         expires_at, created_at
       ) values (
         $1, 'service_management_manage', 1, 'grant', null,
         'deployment_control', clock_timestamp(),
         clock_timestamp() + interval '1 day', clock_timestamp()
       )`,
      [operatorId]
    );

    const fixture = await insertSourceFixtures(pool, operatorId);
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository = createPostgresAccountingPurposeJournalRepository({
      authority
    });
    const service = createAccountingPurposeJournal({ repository });
    assert.equal((await service.readiness()).ready, true);

    const first = await service.synchronize();
    assert.ok(first.sourceCount >= 7);
    assert.equal(first.insertedCount, first.sourceCount);
    assert.equal(first.journalCount, first.sourceCount);
    const replay = await service.synchronize();
    assert.equal(replay.insertedCount, 0);
    assert.equal(replay.journalCount, first.journalCount);

    const scope = {
      actorId: operatorId,
      operatorOrganizationId,
      cursor: null,
      limit: 200
    };
    const journal = await service.list(scope);
    const fixtureReceiptIds = new Set(Object.values(fixture.sourceIds));
    const entries = journal.entries.filter((entry) =>
      fixtureReceiptIds.has(entry.source.receiptId)
    );
    assert.equal(entries.length, 7);
    assert.deepEqual(new Set(entries.map((entry) => entry.purpose)), new Set([
      "download_purchase",
      "assessment_payment",
      "custom_start_payment",
      "custom_change_payment",
      "custom_final_payment",
      "alakazam_start_payment",
      "domain_payment"
    ]));
    for (const entry of entries) {
      assert.deepEqual(entry.money.fee, {
        state: "not_present_in_source",
        minor: null
      });
      assert.deepEqual(entry.money.payoutAging, {
        state: "not_present_in_source",
        availableAt: null
      });
      assert.match(entry.idempotencyDigest, /^[0-9a-f]{64}$/u);
      assert.match(entry.entryDigest, /^[0-9a-f]{64}$/u);
      assert.equal(JSON.stringify(entry).includes("pi_accounting"), false);
    }
    const domain = entries.find((entry) => entry.purpose === "domain_payment");
    assert.deepEqual(domain.money.tax, {
      state: "not_present_in_source",
      minor: null,
      mode: null
    });
    assert.equal(entries.filter((entry) =>
      entry.money.tax.state === "evidenced"
    ).length, 6);

    const exported = await service.export({
      actorId: operatorId,
      operatorOrganizationId,
      asOf: new Date(Date.now() + 60_000).toISOString()
    });
    assert.ok(exported.rowCount >= 7);
    assert.match(exported.exportDigest, /^[0-9a-f]{64}$/u);
    assert.equal(exported.sourceAuthoritative, false);
    assert.equal(exported.authoritativeAccounting, false);
    assert.equal(exported.providerEffects, false);

    let mutationError = null;
    try {
      await authority.service(
        { actorKind: "system", isolation: "serializable" },
        (client) => client.query(
          `update ss.accounting_purpose_journal
              set purpose = purpose
            where source_receipt_id = $1`,
          [fixture.sourceIds.download]
        )
      );
    } catch (error) {
      mutationError = error;
    }
    assert.equal(mutationError?.code, "42501");

    const contract = await pool.query(`
      select
        (
          select relrowsecurity and relforcerowsecurity
            from pg_class
           where oid = 'ss.accounting_purpose_journal'::regclass
        ) as forced_rls,
        not has_table_privilege(
          'authenticated', 'ss.accounting_purpose_journal', 'SELECT'
        ) as customer_denied,
        not has_table_privilege(
          'service_role', 'ss.accounting_purpose_journal',
          'INSERT,UPDATE,DELETE'
        ) as direct_mutation_denied,
        not exists (
          select 1
            from information_schema.columns
           where table_schema = 'ss'
             and table_name = 'accounting_purpose_journal'
             and column_name like 'provider_%_id'
        ) as provider_identifiers_absent
    `);
    for (const [name, ready] of Object.entries(contract.rows[0])) {
      assert.equal(ready, true, `ACCOUNTING-01 PostgreSQL proof failed: ${name}`);
    }
  } finally {
    await pool.end();
  }
});
