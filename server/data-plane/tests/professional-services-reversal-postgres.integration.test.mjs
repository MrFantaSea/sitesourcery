import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import {
  createProfessionalServicesReversalService
} from "../../commerce-v2/professional-services-reversal.mjs";
import { digest } from "../../commerce-v2/canonical.mjs";
import {
  createPostgresProfessionalServicesReversalRepository
} from "../../hosted/professional-services-reversal-postgres.mjs";
import {
  createCanonicalPostgresAuthority
} from "../../hosted/repository-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_PRO_REVERSALS_TEST_URL ?? null;

assert.ok(
  DATABASE_URL,
  "SITESOURCERY_PG_PRO_REVERSALS_TEST_URL is required"
);

const ORGANIZATION_ID = "10800000-0000-4000-8000-000000000001";
const PROJECT_ID = "10800000-0000-4000-8000-000000000002";
const CUSTOMER_ID = "10800000-0000-4000-8000-000000000003";
const OPERATOR_ID = "10800000-0000-4000-8000-000000000004";
const AUTHORIZER_ID = "10800000-0000-4000-8000-000000000005";
const POLICY_ID = "10800000-0000-4000-8000-000000000006";
const RECEIPT_ID = "10800000-0000-4000-8000-000000000007";
const CASE_ID = "10800000-0000-4000-8000-000000000008";
const INVOICE_ID = "10800000-0000-4000-8000-000000000009";
const ATTEMPT_ID = "10800000-0000-4000-8000-000000000010";
const NOW = "2026-08-10T16:00:00.000Z";
const DIRECT_FIXTURE = Object.freeze({
  projectId: "11700000-0000-4000-8000-000000000001",
  quoteId: "11700000-0000-4000-8000-000000000002",
  invoiceId: "11700000-0000-4000-8000-000000000003",
  initialReceiptId: "11700000-0000-4000-8000-000000000004",
  jobId: "11700000-0000-4000-8000-000000000005",
  changeReceiptId: "11700000-0000-4000-8000-000000000006",
  finalReceiptId: "11700000-0000-4000-8000-000000000007"
});
const CREDITED_FIXTURE = Object.freeze({
  projectId: "11700000-0000-4000-8000-000000000011",
  quoteId: "11700000-0000-4000-8000-000000000012",
  applicationId: "11700000-0000-4000-8000-000000000013",
  invoiceId: "11700000-0000-4000-8000-000000000014",
  initialReceiptId: "11700000-0000-4000-8000-000000000015",
  jobId: "11700000-0000-4000-8000-000000000016",
  changeReceiptId: "11700000-0000-4000-8000-000000000017",
  finalReceiptId: "11700000-0000-4000-8000-000000000018"
});

function ids() {
  let sequence = 100;
  return {
    next() {
      sequence += 1;
      return `10800000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    }
  };
}

function directIds() {
  let sequence = 100;
  return {
    next() {
      sequence += 1;
      return `11700000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    }
  };
}

function facts({
  paymentIntentId = "pi_pro_reversal_pg_1",
  amountReversedMinor,
  marker
}) {
  return {
    schema: "sitesourcery.stripe-professional-reversal-facts/v1",
    paymentIntentId,
    amountChargedMinor: 21400,
    amountReversedMinor,
    currency: "USD",
    marker
  };
}

function evidence({
  providerEventId,
  providerEventType,
  providerObjectId,
  evidenceCertainty = "verified",
  outcome,
  amountReversedMinor,
  marker
}) {
  const providerFacts = facts({ amountReversedMinor, marker });
  return {
    organizationId: ORGANIZATION_ID,
    providerEventId,
    providerEventType,
    paymentIntentId: "pi_pro_reversal_pg_1",
    providerObjectId,
    evidenceCertainty,
    outcome,
    amountChargedMinor: 21400,
    amountReversedMinor,
    currency: "USD",
    providerFacts,
    providerFactsDigest: digest(providerFacts),
    providerObservedAt: NOW
  };
}

async function seedFixture(pool) {
  const client = await pool.connect();
  try {
    const retained = await client.query(
      `select 1
       from ss.service_assessment_payment_receipts
       where id = $1`,
      [RECEIPT_ID]
    );
    if (retained.rowCount === 1) return;
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into auth.users (id, email) values
       ($1, 'pro-reversal-customer@example.test'),
       ($2, 'pro-reversal-operator@example.test'),
       ($3, 'pro-reversal-authorizer@example.test')`,
      [CUSTOMER_ID, OPERATOR_ID, AUTHORIZER_ID]
    );
    await client.query(
      `insert into ss.hosted_account_profiles (
         user_id, display_name, state
       ) values ($1, 'Reversal Operator', 'active')`,
      [OPERATOR_ID]
    );
    await client.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state, authorized_by_user_id,
         authorized_at, created_at
       ) values ($1, 'Reversal Operator', 'held', $2, $3, $3)`,
      [OPERATOR_ID, AUTHORIZER_ID, "2026-08-10T15:00:00.000Z"]
    );
    await client.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state, granted_by_user_id,
         granted_at, created_at
       ) values (
         $1, 'service_payment_reconcile', 'held', $2, $3, $3
       )`,
      [OPERATOR_ID, AUTHORIZER_ID, "2026-08-10T15:00:00.000Z"]
    );
    await client.query(
      `insert into ss.service_operator_authority_events (
         id, operator_user_id, capability, event_sequence, event_kind,
         predecessor_event_id, recorded_by_kind, effective_at,
         expires_at, created_at
       ) values (
         '10800000-0000-4000-8000-000000000011',
         $1, 'service_payment_reconcile', 1, 'grant', null,
         'deployment_control', $2, $3, $2
       )`,
      [
        OPERATOR_ID,
        "2026-08-10T15:00:00.000Z",
        "2027-08-10T15:00:00.000Z"
      ]
    );
    await client.query(
      `insert into ss.organizations (
         id, created_by_user_id, name, state
       ) values ($1, $2, 'Professional Reversal Proof', 'active')`,
      [ORGANIZATION_ID, CUSTOMER_ID]
    );
    await client.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', $3)`,
      [ORGANIZATION_ID, CUSTOMER_ID, "2026-08-10T15:00:00.000Z"]
    );
    await client.query(
      `insert into ss.billing_policies (
         id, policy_key, grace_period, retention_period, effective_at
       ) values ($1, 'pro-reversal-proof', interval '7 days',
         interval '30 days', $2)`,
      [POLICY_ID, "2026-08-10T15:00:00.000Z"]
    );
    await client.query(
      `insert into ss.projects (
         id, organization_id, created_by_user_id, billing_policy_id,
         name, lifecycle, revision
       ) values ($1, $2, $3, $4, 'Reversal Proof', 'active', 1)`,
      [PROJECT_ID, ORGANIZATION_ID, CUSTOMER_ID, POLICY_ID]
    );
    await client.query(
      `insert into ss.service_assessment_payment_receipts (
         id, organization_id, project_id, case_id, customer_user_id,
         invoice_id, checkout_attempt_id, stripe_event_id, provider,
         checkout_session_id, payment_intent_id, stripe_customer_id,
         payment_status, subtotal_minor, tax_minor, total_minor,
         tax_mode, currency, purpose_digest, invoice_digest,
         accepted_disclosure_digest, provider_facts,
         provider_facts_digest, provider_paid_at, settled_at, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, 'evt_pro_paid_1', 'stripe',
         'cs_pro_reversal_pg_1', 'pi_pro_reversal_pg_1',
         'cus_pro_reversal_pg_1', 'paid', 20000, 1400, 21400,
         'automatic', 'USD', $8, $8, $8, '{}'::jsonb, $8,
         $9, $9, $9
       )`,
      [
        RECEIPT_ID,
        ORGANIZATION_ID,
        PROJECT_ID,
        CASE_ID,
        CUSTOMER_ID,
        INVOICE_ID,
        ATTEMPT_ID,
        "1".repeat(64),
        "2026-08-10T15:30:00.000Z"
      ]
    );
    await client.query("set local session_replication_role = origin");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function seedCustomBindingFixtures(pool) {
  const retained = await pool.query(
    `select 1 from ss.service_custom_build_payment_receipts where id = $1`,
    [DIRECT_FIXTURE.initialReceiptId]
  );
  if (retained.rowCount === 1) return;
  const client = await pool.connect();
  const digestValue = "2".repeat(64);
  const recordedAt = "2026-08-10T15:40:00.000Z";
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `insert into ss.projects (
         id, organization_id, created_by_user_id, billing_policy_id,
         name, lifecycle, revision
       ) values
       ($1, $2, $3, $4, 'Direct reversal fixture', 'active', 1),
       ($5, $2, $3, $4, 'Credited reversal fixture', 'active', 1)`,
      [
        DIRECT_FIXTURE.projectId,
        ORGANIZATION_ID,
        CUSTOMER_ID,
        POLICY_ID,
        CREDITED_FIXTURE.projectId
      ]
    );
    await client.query(
      `insert into ss.service_custom_build_quotes (
         id, organization_id, project_id, case_id, customer_user_id,
         source_job_id, source_report_id, state, current_revision,
         created_by_operator_user_id, created_at, updated_at,
         origin, direct_opportunity_id, credit_selection
       ) values
       ($1, $2, $3, $4, $5, null, null, 'accepted', 1, $6, $7, $7,
        'direct', $8, 'no_credit'),
       ($9, $2, $10, $4, $5, $11, $12, 'accepted', 1, $6, $7, $7,
        'assessment_successor', null, 'apply_assessment_credit')`,
      [
        DIRECT_FIXTURE.quoteId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        OPERATOR_ID,
        recordedAt,
        "11700000-0000-4000-8000-000000000008",
        CREDITED_FIXTURE.quoteId,
        CREDITED_FIXTURE.projectId,
        "11700000-0000-4000-8000-000000000019",
        "11700000-0000-4000-8000-000000000020"
      ]
    );
    await client.query(
      `insert into ss.service_credit_applications (
         id, organization_id, project_id, customer_user_id,
         credit_grant_id, credit_digest, quote_id, quote_acceptance_id,
         amount_minor, currency, state, reserved_at, settled_at,
         created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         20000, 'USD', 'settled', $9, $9, $9, $9
       )`,
      [
        CREDITED_FIXTURE.applicationId,
        ORGANIZATION_ID,
        CREDITED_FIXTURE.projectId,
        CUSTOMER_ID,
        "11700000-0000-4000-8000-000000000021",
        digestValue,
        CREDITED_FIXTURE.quoteId,
        "11700000-0000-4000-8000-000000000022",
        recordedAt
      ]
    );
    await client.query(
      `insert into ss.service_custom_build_invoices (
         id, organization_id, project_id, case_id, customer_user_id,
         purpose, quote_id, quote_revision, quote_revision_id,
         quote_acceptance_id, credit_application_id, policy_id,
         scope_boundary_digest, tier_id, accepted_quote_digest,
         accepted_disclosure_digest, gross_start_minor, credit_minor,
         subtotal_minor, final_due_minor, currency, tax_state, state,
         charge_occurred, issued_at, payment_deadline, created_at
       ) values
       ($1, $2, $3, $4, $5, 'custom_build_start', $6, 1, $7, $8,
        null, $9, $10, 'card', $10, $10, 40000, 0, 40000, 20000,
        'USD', 'calculation_required', 'tax_calculation_pending', false,
        $11, $11::timestamptz + interval '7 days', $11),
       ($12, $2, $13, $4, $5, 'custom_build_start', $14, 1, $15, $16,
        $17, $9, $10, 'card', $10, $10, 40000, 20000, 20000, 20000,
        'USD', 'calculation_required', 'tax_calculation_pending', false,
        $11, $11::timestamptz + interval '7 days', $11)`,
      [
        DIRECT_FIXTURE.invoiceId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        DIRECT_FIXTURE.quoteId,
        "11700000-0000-4000-8000-000000000023",
        "11700000-0000-4000-8000-000000000024",
        POLICY_ID,
        digestValue,
        recordedAt,
        CREDITED_FIXTURE.invoiceId,
        CREDITED_FIXTURE.projectId,
        CREDITED_FIXTURE.quoteId,
        "11700000-0000-4000-8000-000000000025",
        "11700000-0000-4000-8000-000000000022",
        CREDITED_FIXTURE.applicationId
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
         provider_facts_digest, provider_paid_at, settled_at, created_at
       ) values
       ($1, $2, $3, $4, $5, $6, $7, 'evt_direct_initial_117', null,
        'stripe', 'cs_direct_initial_117', 'pi_direct_initial_117',
        'cus_direct_initial_117', 'paid', 40000, 0, 40000, 'automatic',
        'USD', $8, $8, $8, $8, '{}'::jsonb, $8, $9, $9, $9),
       ($10, $2, $11, $4, $5, $12, $13, 'evt_credited_initial_117', $14,
        'stripe', 'cs_credited_initial_117', 'pi_credited_initial_117',
        'cus_credited_initial_117', 'paid', 20000, 0, 20000, 'automatic',
        'USD', $8, $8, $8, $8, '{}'::jsonb, $8, $9, $9, $9)`,
      [
        DIRECT_FIXTURE.initialReceiptId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        DIRECT_FIXTURE.invoiceId,
        "11700000-0000-4000-8000-000000000026",
        digestValue,
        recordedAt,
        CREDITED_FIXTURE.initialReceiptId,
        CREDITED_FIXTURE.projectId,
        CREDITED_FIXTURE.invoiceId,
        "11700000-0000-4000-8000-000000000027",
        CREDITED_FIXTURE.applicationId
      ]
    );
    await client.query(
      `insert into ss.service_custom_build_jobs (
         id, organization_id, project_id, case_id, customer_user_id,
         invoice_id, payment_receipt_id, quote_id, quote_revision,
         quote_revision_id, quote_acceptance_id, policy_id,
         scope_boundary_digest, tier_id, scope_statement, crafted_pages,
         sections, unique_layouts, content_words, supplied_media,
         target_completion_date, accepted_quote_digest,
         accepted_disclosure_digest, start_gross_minor,
         start_credit_minor, start_paid_subtotal_minor, final_due_minor,
         final_payment_state, currency, purpose, state, opened_at, created_at
       ) values
       ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12,
        'card', 'Direct no-credit reversal normalization proof.',
        1, 4, 1, 100, 0, '2026-09-01', $12, $12,
        40000, 0, 40000, 20000, 'unpaid', 'USD', 'custom_build',
        'open', $13, $13),
       ($14, $2, $15, $4, $5, $16, $17, $18, 1, $19, $20, $11, $12,
        'card', 'Credited Custom reversal compatibility proof.',
        1, 4, 1, 100, 0, '2026-09-01', $12, $12,
        40000, 20000, 20000, 20000, 'unpaid', 'USD', 'custom_build',
        'open', $13, $13)`,
      [
        DIRECT_FIXTURE.jobId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        DIRECT_FIXTURE.invoiceId,
        DIRECT_FIXTURE.initialReceiptId,
        DIRECT_FIXTURE.quoteId,
        "11700000-0000-4000-8000-000000000023",
        "11700000-0000-4000-8000-000000000024",
        POLICY_ID,
        digestValue,
        recordedAt,
        CREDITED_FIXTURE.jobId,
        CREDITED_FIXTURE.projectId,
        CREDITED_FIXTURE.invoiceId,
        CREDITED_FIXTURE.initialReceiptId,
        CREDITED_FIXTURE.quoteId,
        "11700000-0000-4000-8000-000000000025",
        "11700000-0000-4000-8000-000000000022"
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
         provider_facts_digest, provider_paid_at, settled_at, created_at
       ) values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        'provider_readback', null, $11, 'stripe', 'cs_direct_change_117',
        'pi_direct_change_117', 'cus_direct_change_117', 'paid',
        12500, 0, 12500, 'automatic', 'USD', $12, $12, $12, $12,
        '{}'::jsonb, $12, $13, $13, $13),
       ($14, $2, $15, $4, $5, $16, $17, $18, $19, $20,
        'provider_readback', null, $11, 'stripe', 'cs_credited_change_117',
        'pi_credited_change_117', 'cus_credited_change_117', 'paid',
        12500, 0, 12500, 'automatic', 'USD', $12, $12, $12, $12,
        '{}'::jsonb, $12, $13, $13, $13)`,
      [
        DIRECT_FIXTURE.changeReceiptId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        DIRECT_FIXTURE.jobId,
        "11700000-0000-4000-8000-000000000028",
        "11700000-0000-4000-8000-000000000029",
        "11700000-0000-4000-8000-000000000030",
        "11700000-0000-4000-8000-000000000031",
        OPERATOR_ID,
        digestValue,
        recordedAt,
        CREDITED_FIXTURE.changeReceiptId,
        CREDITED_FIXTURE.projectId,
        CREDITED_FIXTURE.jobId,
        "11700000-0000-4000-8000-000000000032",
        "11700000-0000-4000-8000-000000000033",
        "11700000-0000-4000-8000-000000000034",
        "11700000-0000-4000-8000-000000000035"
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
         provider_facts, provider_facts_digest, provider_paid_at,
         settled_at, created_at
       ) values
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        'provider_readback', null, $11, 'stripe', 'cs_direct_final_117',
        'pi_direct_final_117', 'ch_direct_final_117',
        'cus_direct_final_117', 'paid', true, 0, false, 20000, 0, 20000,
        'automatic', 'USD', 'custom_build_final', $12, $12, $12, $12,
        $12, $12, '{}'::jsonb, $12, $13, $13, $13),
       ($14, $2, $15, $4, $5, $16, $17, $18, $19, $20,
        'provider_readback', null, $11, 'stripe', 'cs_credited_final_117',
        'pi_credited_final_117', 'ch_credited_final_117',
        'cus_credited_final_117', 'paid', true, 0, false, 20000, 0, 20000,
        'automatic', 'USD', 'custom_build_final', $12, $12, $12, $12,
        $12, $12, '{}'::jsonb, $12, $13, $13, $13)`,
      [
        DIRECT_FIXTURE.finalReceiptId,
        ORGANIZATION_ID,
        DIRECT_FIXTURE.projectId,
        CASE_ID,
        CUSTOMER_ID,
        DIRECT_FIXTURE.jobId,
        "11700000-0000-4000-8000-000000000036",
        "11700000-0000-4000-8000-000000000037",
        "11700000-0000-4000-8000-000000000038",
        "11700000-0000-4000-8000-000000000039",
        OPERATOR_ID,
        digestValue,
        recordedAt,
        CREDITED_FIXTURE.finalReceiptId,
        CREDITED_FIXTURE.projectId,
        CREDITED_FIXTURE.jobId,
        "11700000-0000-4000-8000-000000000040",
        "11700000-0000-4000-8000-000000000041",
        "11700000-0000-4000-8000-000000000042",
        "11700000-0000-4000-8000-000000000043"
      ]
    );
    await client.query("set local session_replication_role = origin");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function customEvidence({
  paymentIntentId,
  amountChargedMinor,
  amountReversedMinor,
  providerEventId,
  providerEventType,
  providerObjectId,
  outcome,
  marker
}) {
  const providerFacts = {
    schema: "sitesourcery.stripe-professional-reversal-facts/v1",
    paymentIntentId,
    amountChargedMinor,
    amountReversedMinor,
    currency: "USD",
    marker
  };
  return {
    organizationId: ORGANIZATION_ID,
    providerEventId,
    providerEventType,
    paymentIntentId,
    providerObjectId,
    evidenceCertainty: "verified",
    outcome,
    amountChargedMinor,
    amountReversedMinor,
    currency: "USD",
    providerFacts,
    providerFactsDigest: digest(providerFacts),
    providerObservedAt: NOW
  };
}

function reconciliationFacts(amountReversedMinor) {
  return {
    schema: "sitesourcery.stripe-professional-reversal-readback/v1",
    paymentIntentId: "pi_pro_reversal_pg_1",
    providerObjectId: "ch_pro_reversal_ambiguous_1",
    amountChargedMinor: 21400,
    amountReversedMinor,
    currency: "USD",
    providerEffectAuthorized: false
  };
}

test("professional reversal PostgreSQL journey is monotonic, replay-safe, and operator-fenced", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  await seedFixture(pool);
  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresProfessionalServicesReversalRepository({
    authority
  });
  const clock = { now: () => NOW };
  const service = createProfessionalServicesReversalService({
    repository,
    clock,
    ids: ids()
  });
  try {
    const partialInput = evidence({
      providerEventId: "evt_pro_reversal_partial_1",
      providerEventType: "refund.updated",
      providerObjectId: "re_pro_reversal_partial_1",
      outcome: "refund_partial",
      amountReversedMinor: 500,
      marker: "partial"
    });
    const partial = await service.recordEvidence(partialInput);
    assert.equal(partial.status, "recorded");
    assert.equal(partial.lifecycleState, "held");
    assert.equal(partial.lifecycleRevision, 1);
    assert.equal(partial.creditConsequence, "block_unapplied_credit");

    const replay = await service.recordEvidence(partialInput);
    assert.equal(replay.status, "replay");
    assert.equal(replay.lifecycleRevision, 1);

    await assert.rejects(
      service.recordEvidence({
        ...partialInput,
        providerFacts: { ...partialInput.providerFacts, marker: "changed" },
        providerFactsDigest: digest({
          ...partialInput.providerFacts,
          marker: "changed"
        })
      }),
      (error) => error.code === "PROFESSIONAL_REVERSAL_REPOSITORY_CONFLICT"
    );

    const ambiguous = await service.recordEvidence(evidence({
      providerEventId: "evt_pro_reversal_ambiguous_1",
      providerEventType: "charge.refunded",
      providerObjectId: "ch_pro_reversal_ambiguous_1",
      evidenceCertainty: "ambiguous",
      outcome: null,
      amountReversedMinor: null,
      marker: "ambiguous"
    }));
    assert.equal(ambiguous.status, "reconciliation_required");
    assert.equal(ambiguous.lifecycleState, "held");
    assert.equal(ambiguous.lifecycleRevision, 2);
    assert.equal(ambiguous.reconciliationRequired, true);

    const confirmedFacts = reconciliationFacts(21400);
    const reconciled = await service.reconcileEvidence(
      { userId: OPERATOR_ID },
      {
        organizationId: ORGANIZATION_ID,
        evidenceId: ambiguous.evidenceId,
        commandId: "pro-reversal-pg-confirm-1",
        expectedLifecycleRevision: 2,
        resolution: "confirmed",
        confirmedOutcome: "refund_full",
        verifiedFacts: confirmedFacts,
        verifiedFactsDigest: digest(confirmedFacts),
        verifiedObservedAt: NOW
      }
    );
    assert.equal(reconciled.status, "reconciled");
    assert.equal(reconciled.lifecycleState, "terminated");
    assert.equal(reconciled.lifecycleRevision, 3);
    assert.equal(reconciled.reconciliationRequired, false);

    const recovered = await service.recordEvidence(evidence({
      providerEventId: "evt_pro_reversal_reinstated_1",
      providerEventType: "charge.dispute.funds_reinstated",
      providerObjectId: "dp_pro_reversal_reinstated_1",
      outcome: "dispute_funds_reinstated",
      amountReversedMinor: 0,
      marker: "funds-reinstated"
    }));
    assert.equal(recovered.lifecycleState, "terminated");
    assert.equal(recovered.severity, 70);
    assert.equal(recovered.lifecycleRevision, 4);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('app.service_actor_kind', 'system', true)"
      );
      await client.query(
        "select set_config('app.service_actor_organization_id', $1, true)",
        [ORGANIZATION_ID]
      );
      await assert.rejects(
        client.query(
          `update ss.service_professional_payment_lifecycles
           set state = 'active', severity = 0, revision = revision + 1
           where payment_receipt_id = $1`,
          [RECEIPT_ID]
        ),
        (error) => error.code === "23514"
      );
      await client.query("rollback");

      await client.query("begin");
      await client.query(
        "select set_config('app.service_actor_kind', 'system', true)"
      );
      await client.query(
        "select set_config('app.service_actor_organization_id', $1, true)",
        [ORGANIZATION_ID]
      );
      await assert.rejects(
        client.query(
          `update ss.service_professional_reversal_evidence
           set owner_review_required = false
           where id = $1`,
          [ambiguous.evidenceId]
        ),
        (error) => error.code === "55000"
      );
      await client.query("rollback");
    } finally {
      client.release();
    }

    const retained = await pool.query(
      `select
         lifecycle.state,
         lifecycle.severity,
         lifecycle.revision,
         lifecycle.access_consequence,
         lifecycle.credit_consequence,
         lifecycle.quote_consequence,
         count(distinct evidence.id)::integer as evidence_count,
         count(distinct reconciliation.id)::integer as reconciliation_count
       from ss.service_professional_payment_lifecycles lifecycle
       join ss.service_professional_reversal_evidence evidence
         on evidence.lifecycle_id = lifecycle.id
       left join ss.service_professional_reversal_reconciliations reconciliation
         on reconciliation.lifecycle_id = lifecycle.id
       where lifecycle.payment_purpose = 'assessment'
         and lifecycle.payment_receipt_id = $1
       group by lifecycle.id`,
      [RECEIPT_ID]
    );
    assert.deepEqual(retained.rows[0], {
      state: "terminated",
      severity: 70,
      revision: "4",
      access_consequence: "preserve_records_terminate_new_work",
      credit_consequence: "block_unapplied_credit",
      quote_consequence: "terminate_effective_quote_authority",
      evidence_count: 3,
      reconciliation_count: 1
    });
  } finally {
    await authority.close();
  }
});

test("direct no-credit Custom receipts normalize all payment kinds without synthetic credit", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  await seedFixture(pool);
  await seedCustomBindingFixtures(pool);
  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresProfessionalServicesReversalRepository({
    authority
  });
  const service = createProfessionalServicesReversalService({
    repository,
    clock: { now: () => NOW },
    ids: directIds()
  });
  try {
    const expectedBindings = [
      ["pi_direct_initial_117", "custom_build_initial", 40000,
        DIRECT_FIXTURE.initialReceiptId, "none"],
      ["pi_direct_change_117", "custom_build_change", 12500,
        DIRECT_FIXTURE.changeReceiptId, "none"],
      ["pi_direct_final_117", "custom_build_final", 20000,
        DIRECT_FIXTURE.finalReceiptId, "none"],
      ["pi_credited_initial_117", "custom_build_initial", 20000,
        CREDITED_FIXTURE.initialReceiptId, "settled"],
      ["pi_credited_change_117", "custom_build_change", 12500,
        CREDITED_FIXTURE.changeReceiptId, "settled"],
      ["pi_credited_final_117", "custom_build_final", 20000,
        CREDITED_FIXTURE.finalReceiptId, "settled"]
    ];
    for (const [paymentIntentId, paymentPurpose, totalMinor, receiptId,
      creditState] of expectedBindings) {
      const binding = await repository.findPaymentByIntent({
        organizationId: ORGANIZATION_ID,
        paymentIntentId
      });
      assert.equal(binding.paymentPurpose, paymentPurpose);
      assert.equal(binding.totalMinor, totalMinor);
      assert.equal(binding.receiptId, receiptId);
      assert.equal(binding.creditState, creditState);
      assert.equal(binding.quoteState, "accepted");
    }
    assert.equal(await repository.findPaymentByIntent({
      organizationId: "11700000-0000-4000-8000-000000000099",
      paymentIntentId: "pi_direct_initial_117"
    }), null);

    const creditCountBefore = await pool.query(
      `select count(*)::integer as count
         from ss.service_credit_applications
        where organization_id = $1`,
      [ORGANIZATION_ID]
    );

    const partialRefundInput = customEvidence({
      paymentIntentId: "pi_direct_initial_117",
      amountChargedMinor: 40000,
      amountReversedMinor: 500,
      providerEventId: "evt_direct_initial_refund_117",
      providerEventType: "refund.updated",
      providerObjectId: "re_direct_initial_refund_117",
      outcome: "refund_partial",
      marker: "direct-initial-refund"
    });
    const partialRefund = await service.recordEvidence(partialRefundInput);
    assert.equal(partialRefund.lifecycleState, "held");
    assert.equal(partialRefund.creditConsequence, "block_unapplied_credit");
    const replay = await service.recordEvidence(partialRefundInput);
    assert.equal(replay.status, "replay");
    assert.equal(replay.lifecycleRevision, 1);

    const dispute = await service.recordEvidence(customEvidence({
      paymentIntentId: "pi_direct_change_117",
      amountChargedMinor: 12500,
      amountReversedMinor: 12500,
      providerEventId: "evt_direct_change_dispute_117",
      providerEventType: "charge.dispute.funds_withdrawn",
      providerObjectId: "dp_direct_change_dispute_117",
      outcome: "dispute_funds_withdrawn",
      marker: "direct-change-dispute"
    }));
    assert.equal(dispute.lifecycleState, "held");
    assert.equal(dispute.severity, 60);
    const reinstated = await service.recordEvidence(customEvidence({
      paymentIntentId: "pi_direct_change_117",
      amountChargedMinor: 12500,
      amountReversedMinor: 0,
      providerEventId: "evt_direct_change_reinstated_117",
      providerEventType: "charge.dispute.funds_reinstated",
      providerObjectId: "dp_direct_change_reinstated_117",
      outcome: "dispute_funds_reinstated",
      marker: "direct-change-reinstated"
    }));
    assert.equal(reinstated.lifecycleState, "held");
    assert.equal(reinstated.severity, 60);

    const fullRefund = await service.recordEvidence(customEvidence({
      paymentIntentId: "pi_direct_final_117",
      amountChargedMinor: 20000,
      amountReversedMinor: 20000,
      providerEventId: "evt_direct_final_refund_117",
      providerEventType: "charge.refunded",
      providerObjectId: "ch_direct_final_refund_117",
      outcome: "refund_full",
      marker: "direct-final-refund"
    }));
    assert.equal(fullRefund.lifecycleState, "terminated");
    assert.equal(fullRefund.severity, 70);

    const retained = await pool.query(
      `select payment_purpose, state, severity, revision,
              credit_state_snapshot, quote_state_snapshot
         from ss.service_professional_payment_lifecycles
        where organization_id = $1
          and payment_receipt_id in ($2, $3, $4)
        order by payment_purpose`,
      [
        ORGANIZATION_ID,
        DIRECT_FIXTURE.initialReceiptId,
        DIRECT_FIXTURE.changeReceiptId,
        DIRECT_FIXTURE.finalReceiptId
      ]
    );
    assert.deepEqual(retained.rows, [
      {
        payment_purpose: "custom_build_change",
        state: "held",
        severity: 60,
        revision: "2",
        credit_state_snapshot: "none",
        quote_state_snapshot: "accepted"
      },
      {
        payment_purpose: "custom_build_final",
        state: "terminated",
        severity: 70,
        revision: "1",
        credit_state_snapshot: "none",
        quote_state_snapshot: "accepted"
      },
      {
        payment_purpose: "custom_build_initial",
        state: "held",
        severity: 50,
        revision: "1",
        credit_state_snapshot: "none",
        quote_state_snapshot: "accepted"
      }
    ]);
    const creditCountAfter = await pool.query(
      `select count(*)::integer as count
         from ss.service_credit_applications
        where organization_id = $1`,
      [ORGANIZATION_ID]
    );
    assert.deepEqual(creditCountAfter.rows, creditCountBefore.rows);
  } finally {
    await authority.close();
  }
});
