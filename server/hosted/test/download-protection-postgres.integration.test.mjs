import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { digest } from
  "../../commerce-v2/canonical.mjs";
import { createPostgresDownloadProtectionRepository } from
  "../download-protection-postgres.mjs";
import { createCanonicalPostgresAuthority } from
  "../repository-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_DOWNLOAD_PROTECTION_TEST_URL ??
  process.env.SITESOURCERY_PG_MIGRATION_TEST_URL ??
  null;

test(
  "PostgreSQL holds on a real dispute, exports immutable evidence, and reopens only after exact owner review",
  { skip: !DATABASE_URL },
  async (t) => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    t.after(async () => pool.end());

    const ownerId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const versionId = randomUUID();
    const quoteId = randomUUID();
    const receiptId = randomUUID();
    const entitlementId = randomUUID();
    const dossierId = randomUUID();
    const eventId = `evt_fin012_${randomUUID().replaceAll("-", "")}`;
    const eventType = "charge.dispute.created";
    const paymentIntentId =
      `pi_fin012_${randomUUID().replaceAll("-", "")}`;
    const evidenceDigest = digest({ eventId, eventType });
    const acceptedDisclosureDigest = digest("accepted-disclosure");
    const purposeDigest = digest("purpose");
    const settledAt = "2026-08-22T16:10:00.000Z";
    const heldAt = "2026-08-22T16:11:00.000Z";
    const reviewedAt = "2026-08-22T16:12:00.000Z";
    const dossier = {
      schema:
        "sitesourcery.download-private-dispute-dossier/v1",
      createdAt: heldAt,
      trigger: {
        eventId,
        eventType,
        payloadDigest: evidenceDigest
      },
      scope: {
        tenantId: organizationId,
        projectId,
        receiptId,
        entitlementId
      },
      quote: {
        price: { amountMinor: 2000, currency: "USD" }
      },
      purchaseAcceptance: {
        acceptance: {
          statement:
            "accepted_exact_download_quote_delivery_final_sale_and_credit_terms"
        }
      },
      payment: {
        paymentIntentId,
        amountMinor: 2000,
        chargeId: "ch_fin012_proof"
      },
      entitlement: {
        state: "suspended",
        stateReason: "payment_dispute_open",
        activatedAt: settledAt
      },
      accessEvents: [{
        state: "response_issued",
        responseIssuedAt: settledAt
      }]
    };
    const dossierDigest = digest(dossier);
    const receiptFacts = {
      schema:
        "sitesourcery.abracadabra-payment-receipt.v2",
      receiptId,
      provider: "stripe",
      eventId: "evt_fin012_settlement",
      checkoutSessionId: "cs_fin012_proof",
      paymentIntentId,
      stripeCustomerId: "cus_fin012_proof",
      projectId,
      versionId,
      quoteId,
      purposeDigest,
      acceptedDisclosureDigest,
      payment: {
        status: "paid",
        provider: "stripe",
        receiptId,
        amountMinor: 2000,
        taxMinor: 0,
        totalMinor: 2000,
        taxMode: "disabled_by_owner",
        currency: "USD",
        settledAt
      }
    };

    await pool.query(
      "insert into auth.users (id, email) values ($1, $2)",
      [ownerId, `fin012-${ownerId}@example.test`]
    );
    await pool.query(
      `insert into ss.hosted_account_profiles (
         user_id, display_name, state
       ) values ($1, 'FIN-012 owner', 'active')`,
      [ownerId]
    );
    await pool.query(
      `insert into ss.organizations (
         id, created_by_user_id, name, state
       ) values ($1, $2, 'FIN-012 proof', 'active')`,
      [organizationId, ownerId]
    );
    await pool.query(
      `insert into ss.organization_memberships (
         organization_id, user_id, role, state, accepted_at
       ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
      [organizationId, ownerId]
    );
    await pool.query(
      `insert into ss.operator_profiles (
         user_id, display_label, state,
         authorized_by_user_id, authorized_at
       ) values ($1, 'FIN-012 owner', 'held', $1, clock_timestamp())`,
      [ownerId]
    );
    await pool.query(
      `insert into ss.operator_permissions (
         operator_user_id, capability, state,
         granted_by_user_id, granted_at
       ) values (
         $1, 'service_job_manage', 'held',
         $1, clock_timestamp()
       )`,
      [ownerId]
    );
    await pool.query(
      `insert into ss.service_operator_authority_events (
         operator_user_id, capability, event_sequence,
         event_kind, predecessor_event_id,
         recorded_by_kind, effective_at, expires_at,
         created_at
       ) values (
         $1, 'service_job_manage', 1, 'grant', null,
         'deployment_control', clock_timestamp(),
         clock_timestamp() + interval '1 day',
         clock_timestamp()
       )`,
      [ownerId]
    );

    const fixture = await pool.connect();
    try {
      await fixture.query(
        "set session_replication_role = replica"
      );
      for (const table of [
        "commerce_v2_download_gate_review_decisions",
        "commerce_v2_download_dispute_dossiers",
        "commerce_v2_download_fraud_warning_events",
        "commerce_v2_download_access_events",
        "commerce_v2_download_checkout_attempts",
        "commerce_v2_download_gate_transitions"
      ]) {
        assert.match(table, /^[a-z0-9_]+$/u);
        await fixture.query(`delete from ss.${table}`);
      }
      await fixture.query(
        `update ss.commerce_v2_download_checkout_gate
            set state = 'open',
                reason = 'integration_fixture_open',
                signal_type = null,
                signal_id = null,
                evidence_digest = null,
                state_changed_at = $1,
                revision = 1
          where singleton = true`,
        [settledAt]
      );
      await fixture.query(
        `insert into ss.commerce_v2_download_payment_receipts (
           id, organization_id, project_id, version_id, quote_id,
           customer_user_id, preparation_command_id, stripe_event_id,
           provider, checkout_session_id, payment_intent_id,
           stripe_customer_id, payment_status, amount_minor, tax_minor,
           total_minor, tax_mode, currency, purpose_digest,
           accepted_disclosure_digest, settled_at, facts
         ) values (
           $1, $2, $3, $4, $5, $6, 'fin012-proof-command',
           'evt_fin012_settlement', 'stripe', 'cs_fin012_proof', $7,
           'cus_fin012_proof', 'paid', 2000, 0, 2000,
           'disabled_by_owner', 'USD', $8, $9, $10, $11::jsonb
         )`,
        [
          receiptId,
          organizationId,
          projectId,
          versionId,
          quoteId,
          ownerId,
          paymentIntentId,
          purposeDigest,
          acceptedDisclosureDigest,
          settledAt,
          JSON.stringify(receiptFacts)
        ]
      );
      await fixture.query(
        `insert into ss.commerce_v2_project_entitlements (
           id, organization_id, project_id, customer_user_id,
           kind, scope, state, source_receipt_id,
           accepted_disclosure_digest, activated_at,
           state_changed_at, state_reason
         ) values (
           $1, $2, $3, $4, 'spark_download', 'editor_project',
           'suspended', $5, $6, $7, $8, 'payment_dispute_open'
         )`,
        [
          entitlementId,
          organizationId,
          projectId,
          ownerId,
          receiptId,
          acceptedDisclosureDigest,
          settledAt,
          heldAt
        ]
      );
      await fixture.query(
        `insert into ss.commerce_v2_download_dispute_dossiers (
           id, organization_id, project_id, receipt_id,
           entitlement_id, trigger_event_id, trigger_type,
           dossier, dossier_digest, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           $8::jsonb, $9, $10
         )`,
        [
          dossierId,
          organizationId,
          projectId,
          receiptId,
          entitlementId,
          eventId,
          eventType,
          JSON.stringify(dossier),
          dossierDigest,
          heldAt
        ]
      );
    } finally {
      await fixture.query(
        "set session_replication_role = origin"
      );
      fixture.release();
    }

    await pool.query(
      `insert into ss.commerce_v2_download_gate_transitions (
         prior_state, resulting_state, reason,
         signal_type, signal_id, evidence_digest,
         changed_by_user_id, changed_at
       ) values (
         'open', 'held', 'stripe_download_dispute_created',
         $1, $2, $3, null, $4
       )`,
      [eventType, eventId, evidenceDigest, heldAt]
    );
    await pool.query(
      `update ss.commerce_v2_download_checkout_gate
          set state = 'held',
              reason = 'stripe_download_dispute_created',
              signal_type = $1,
              signal_id = $2,
              evidence_digest = $3,
              state_changed_at = $4,
              revision = revision + 1
        where singleton = true`,
      [eventType, eventId, evidenceDigest, heldAt]
    );

    const authority = createCanonicalPostgresAuthority({ pool });
    const repository =
      createPostgresDownloadProtectionRepository({
        authority,
        clock: () => new Date(reviewedAt)
      });
    assert.deepEqual(await repository.readiness(), {
      ready: true,
      verified: true,
      kind: "download-protection-postgres",
      privateEvidence: true,
      providerEffects: false,
      paymentEffects: false
    });
    const exported = await repository.exportDossier({
      operatorId: ownerId,
      operatorOrganizationId: organizationId,
      dossierId
    });
    assert.equal(exported.dossierDigest, dossierDigest);
    assert.deepEqual(exported.dossier, dossier);
    const reopened = await repository.reopenGate({
      operatorId: ownerId,
      operatorOrganizationId: organizationId,
      dossierId,
      reviewedDossierDigest: dossierDigest,
      reason: "owner reviewed exact dispute evidence"
    });
    assert.equal(reopened.status, "reopened");
    assert.equal(reopened.gate.state, "open");
    assert.equal(reopened.gate.revision, 3);

    const durable = await pool.query(
      `select
         (select count(*)::integer
            from ss.commerce_v2_download_gate_review_decisions
           where dossier_id = $1
             and decision_digest = $2) as decisions,
         (select count(*)::integer
            from ss.commerce_v2_download_gate_transitions
           where resulting_state = 'open'
             and evidence_digest = $2) as reopen_transitions,
         (select state
            from ss.commerce_v2_download_checkout_gate
           where singleton = true) as gate_state`,
      [dossierId, reopened.decisionDigest]
    );
    assert.deepEqual(durable.rows[0], {
      decisions: 1,
      reopen_transitions: 1,
      gate_state: "open"
    });

    await assert.rejects(
      pool.query(
        `update ss.commerce_v2_download_checkout_gate
            set state = 'held', revision = revision + 1
          where singleton = true`
      ),
      (error) => error.code === "55000"
    );
    await assert.rejects(
      pool.query(
        `update ss.commerce_v2_download_dispute_dossiers
            set dossier = '{}'::jsonb
          where id = $1`,
        [dossierId]
      ),
      (error) => error.code === "55000"
    );
  }
);
