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

function ids() {
  let sequence = 100;
  return {
    next() {
      sequence += 1;
      return `10800000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
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
