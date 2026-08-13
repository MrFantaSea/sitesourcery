import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createFakeResponderProvider,
  createResponderCore
} from "../responder-core.mjs";
import { createPostgresResponderCoreRepository } from
  "../responder-core-postgres.mjs";
import { createPostgresResponderFulfillmentRepository } from
  "../responder-fulfillment-postgres.mjs";
import { createPostgresResponderPrivateMaterialResolver } from
  "../responder-private-material-postgres.mjs";
import { createResponderPrivateMaterialVault } from
  "../responder-private-material-vault.mjs";
import { createPostgresProviderReconciliationRepository } from
  "../provider-reconciliation-postgres.mjs";
import { createProviderReconciliationWorker } from
  "../provider-reconciliation-worker.mjs";
import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { digest } from "../security.mjs";

const DATABASE_URL =
  process.env.SITESOURCERY_PG_PROVIDER_RECONCILIATION_TEST_URL;
const { Pool } = pg;
const CONTACT_ROUTE = digest({ routeKind: "sms", address: "+18565550100" });
const DELIVERY_BODY =
  "Sorry we missed you - this is Site Sourcery. Reply STOP to opt out.";
const DELIVERY_CONTENT = digest({ contentKind: "sms", body: DELIVERY_BODY });
const WORKER_ID = "provider-reconciliation-journey00001";

async function seed(pool) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    customer: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values ($1,$2),($3,$4),($5,$6)`,
    [
      ids.customer, `rec-customer-${ids.customer}@example.test`,
      ids.operator, `rec-operator-${ids.operator}@example.test`,
      ids.authorizer, `rec-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values ($1,$2, interval '14 days', interval '90 days', clock_timestamp())`,
    [ids.billing, `rec-${ids.billing}`]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name)
     values ($1,$2,'Reconciliation Test')`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1,$2,'owner','active', clock_timestamp()),
              ($1,$3,'owner','active', clock_timestamp())`,
    [ids.organization, ids.customer, ids.operator]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1,$2,$3,$4,'Reconciliation Project')`,
    [ids.project, ids.organization, ids.customer, ids.billing]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1,'Rec Operator','active'),($2,'Rec Authorizer','active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1,'Rec Operator','held',$2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values ($1,'service_management_manage','held',$2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at, expires_at,
       created_at
     ) values ($1,'service_management_manage',1,'grant',null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp())`,
    [ids.operator]
  );
  return ids;
}

test("provider reconciliation detects, self-heals, escalates, and projects on real PostgreSQL", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const run = randomUUID().slice(0, 8);
  const cmd = (name) => `rec-${run}-${name}`;
  try {
    const ids = await seed(pool);
    let selectedNow = new Date("2026-08-12T18:00:00.000Z").toISOString();
    const tick = () => {
      selectedNow = new Date(Date.parse(selectedNow) + 25).toISOString();
      return selectedNow;
    };
    const authority = createCanonicalPostgresAuthority({ pool });
    const core = createResponderCore({
      repository: createPostgresResponderCoreRepository({ authority }),
      provider: createFakeResponderProvider(),
      clock: { now: () => selectedNow }
    });
    const fulfillment = createPostgresResponderFulfillmentRepository({
      authority
    });
    const resolver = createPostgresResponderPrivateMaterialResolver({
      authority,
      vault: createResponderPrivateMaterialVault({
        currentKeyVersion: "rec-pg-2026-08",
        currentKey: Buffer.alloc(32, 7)
      })
    });
    const reconciliation = createPostgresProviderReconciliationRepository({
      authority,
      staleAfterMs: 60_000,
      abandonedLeaseGraceMs: 0
    });
    const operatorQueue = createPostgresOperatorWorkQueueRepository({
      authority
    });
    const customer = {
      kind: "customer", userId: ids.customer,
      organizationId: ids.organization
    };
    const operator = {
      kind: "operator", userId: ids.operator,
      organizationId: ids.organization
    };

    assert.equal((await reconciliation.readiness()).ready, true);

    // Release the organization through the guarded operator path.
    tick();
    await core.recordConsent(customer, {
      commandId: cmd("consent-release-seed"),
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      routeDigest: digest({ routeKind: "sms", address: "+18565550199" }),
      consentBasis: "inbound_call",
      consentEvidenceDigest: digest("release-seed-" + run),
      consentedAt: selectedNow
    });
    tick();
    await authority.service({
      actorKind: "operator", userId: ids.operator,
      organizationId: ids.organization, isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_runtime_controls
          set state='approved_live', global_kill_engaged=false,
              release_evidence_digest=$2, released_at=$3,
              released_by_operator_user_id=$4,
              revision=revision+1, updated_at=$3
        where organization_id=$1`,
      [ids.organization, "4".repeat(64), selectedNow, ids.operator]
    ));

    async function queuedOperation(round, to) {
      const routeDigest = digest({ routeKind: "sms", address: to });
      tick();
      const consent = await core.recordConsent(customer, {
        commandId: cmd(`consent-${round}`),
        organizationId: ids.organization, projectId: ids.project,
        customerUserId: ids.customer, routeDigest,
        consentBasis: "inbound_call",
        consentEvidenceDigest: digest("consent-" + run + "-" + round),
        consentedAt: selectedNow
      });
      tick();
      const missed = await core.ingestProviderEvent({
        commandId: cmd(`missed-${round}`),
        organizationId: ids.organization, projectId: ids.project,
        providerEventIdDigest: digest("missed-" + run + "-" + round),
        routeDigest, eventKind: "missed_call",
        payloadDigest: digest("missed-payload-" + run + "-" + round),
        occurredAt: selectedNow
      });
      tick();
      await core.reserveHeldMessage(customer, {
        commandId: cmd(`ack-${round}`),
        organizationId: ids.organization, projectId: ids.project,
        interactionId: missed.interactionId, contactAuthorityId: consent.id,
        messageKind: "missed_call_ack", contentDigest: DELIVERY_CONTENT
      });
      const operation = await pool.query(
        `select * from ss.responder_delivery_operations where command_id=$1`,
        [cmd(`ack-${round}`)]
      );
      tick();
      await resolver.storeSmsMaterial({
        operationId: operation.rows[0].id,
        organizationId: ids.organization, projectId: ids.project,
        interactionId: operation.rows[0].interaction_id,
        contactAuthorityId: operation.rows[0].contact_authority_id,
        messageKind: "missed_call_ack", routeDigest,
        contentDigest: DELIVERY_CONTENT, to,
        body: DELIVERY_BODY, recordedAt: selectedNow
      });
      return operation.rows[0];
    }

    // (1) Suppression conflict: claim, cancel the contact out-of-band, then
    // record acceptance — the fulfillment repository durably opens a case.
    const suppressed = await queuedOperation("s", "+18565550100");
    tick();
    const claimS = await fulfillment.claimNextDelivery({
      workerId: "responder-fulfillment-sworker0001",
      claimedAt: selectedNow,
      leaseExpiresAt: new Date(Date.parse(selectedNow) + 120_000).toISOString()
    });
    assert.equal(claimS.status, "claimed");
    // A durable STOP swept the claimed operation to cancelled (the exact
    // transition migration 125 permits for a claimed op) with the opt-out
    // failure code, mirroring the FIN-004Q suppression sweep.
    tick();
    await authority.service({
      actorKind: "system", isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_delivery_operations
          set state='cancelled', provider_effects_authorized=false,
              available_at=null, lease_owner=null, lease_started_at=null,
              lease_expires_at=null,
              failure_code='RESPONDER_DELIVERY_OPTED_OUT', updated_at=$2
        where id=$1`,
      [suppressed.id, selectedNow]
    ));
    tick();
    const conflict = await fulfillment.recordDeliveryAccepted({
      operationId: suppressed.id,
      workerId: "responder-fulfillment-sworker0001",
      attemptCount: 1, provider: "twilio",
      providerMessageIdDigest: digest("suppressed-sid-" + run),
      providerReceiptDigest: digest("suppressed-receipt-" + run),
      acceptedAt: selectedNow
    });
    assert.equal(conflict.status, "suppression_conflict");
    const conflictCase = await pool.query(
      `select case_kind, state, subject_operation_id, organization_id
         from ss.provider_reconciliation_cases
        where case_kind='suppression_conflict'
          and subject_operation_id=$1`,
      [suppressed.id]
    );
    assert.equal(conflictCase.rowCount, 1);
    assert.equal(conflictCase.rows[0].state, "open");
    assert.equal(conflictCase.rows[0].organization_id, ids.organization);
    // Recording acceptance again folds into the one open case (digest-unique).
    await fulfillment.recordDeliveryAccepted({
      operationId: suppressed.id,
      workerId: "responder-fulfillment-sworker0001",
      attemptCount: 1, provider: "twilio",
      providerMessageIdDigest: digest("suppressed-sid-" + run),
      providerReceiptDigest: digest("suppressed-receipt-" + run),
      acceptedAt: selectedNow
    });
    const foldedCase = await pool.query(
      `select count(*)::integer as count
         from ss.provider_reconciliation_cases
        where case_kind='suppression_conflict' and subject_operation_id=$1`,
      [suppressed.id]
    );
    assert.equal(foldedCase.rows[0].count, 1);

    // (2) Abandoned claim: claim then never accept; detection with a future
    // observation opens a case and escalation moves it to manual review
    // while preserving the dead worker's lease-owner identity.
    const abandoned = await queuedOperation("a", "+18565550101");
    tick();
    const claimA = await fulfillment.claimNextDelivery({
      workerId: "responder-fulfillment-aworker0001",
      claimedAt: selectedNow,
      leaseExpiresAt: new Date(Date.parse(selectedNow) + 30_000).toISOString()
    });
    assert.equal(claimA.status, "claimed");

    // (3) Ambiguous Message create: the provider response was uncertain, so
    // the operation is terminally held for shape-based readback and is never
    // blindly retried.
    const ambiguous = await queuedOperation("m", "+18565550102");
    tick();
    const claimM = await fulfillment.claimNextDelivery({
      workerId: "responder-fulfillment-mworker0001",
      claimedAt: selectedNow,
      leaseExpiresAt: new Date(Date.parse(selectedNow) + 120_000).toISOString()
    });
    assert.equal(claimM.status, "claimed");
    tick();
    assert.equal((await fulfillment.recordDeliveryManualReview({
      operationId: ambiguous.id,
      workerId: "responder-fulfillment-mworker0001",
      attemptCount: 1,
      failureCode: "TWILIO_RESPONDER_DELIVERY_UNCERTAIN",
      failedAt: selectedNow
    })).status, "manual_review");

    // (4) Unbound inbound event awaiting late provisioning (system insert).
    const unboundId = randomUUID();
    await authority.service({
      actorKind: "system", isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.responder_twilio_inbound_events (
         id, provider, channel, event_kind, provider_event_digest,
         provider_event_id_digest, account_sid_digest,
         to_number_lookup_digest, to_number_key_version,
         signature_verification_digest, payload_digest, state, state_reason,
         received_at, created_at
       ) values (
         $1,'twilio','sms','message_received',$2,$3,$4,$5,'pgtest-v1',$6,$2,
         'unbound','no_binding',$7,$7
       )`,
      [
        unboundId, digest("unbound-" + run), digest("unbound-sid-" + run),
        digest("unbound-account-" + run), digest("unbound-number-" + run),
        digest("unbound-signature-" + run),
        new Date("2026-08-12T17:00:00.000Z").toISOString()
      ]
    ));

    // (5) Unmatched provider event: a pending delivery-status callback whose
    // message SID digest maps to no accepted operation.
    await authority.service({
      actorKind: "system", isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.responder_delivery_provider_events (
         id, provider, provider_event_digest, provider_message_id_digest,
         account_sid_digest, message_status, error_code_digest,
         signature_verification_digest, payload_digest, received_at,
         event_state, created_at
       ) values (
         $1,'twilio',
         ss.responder_delivery_provider_event_digest($2,$3,'delivered',null,$4,$5),
         $2,$3,'delivered',null,$4,$5,$6,'pending',$6
       )`,
      [
        randomUUID(),
        digest("orphan-sid-" + run),
        digest("orphan-account-" + run),
        digest("orphan-signature-" + run),
        digest("orphan-payload-" + run),
        new Date("2026-08-12T16:00:00.000Z").toISOString()
      ]
    ));

    const observedFuture = new Date(
      Date.parse(selectedNow) + 10 * 60 * 1000
    ).toISOString();
    const detection = await reconciliation.runDetection({
      workerId: WORKER_ID,
      observedAt: observedFuture
    });
    // At least this run's abandoned claim, unbound event, and orphan event
    // are opened (the shared migration database may retain prior cases).
    assert.ok(detection.counters.abandonedClaim >= 1);
    assert.ok(detection.counters.ambiguousMessageCreate >= 1);
    assert.ok(detection.counters.unboundInboundEvent >= 1);
    assert.ok(detection.counters.unmatchedProviderEvent >= 1);
    assert.ok(detection.openedCases >= 4);
    const openedForThisRun = await pool.query(
      `select case_kind from ss.provider_reconciliation_cases
        where (case_kind='abandoned_claim' and subject_operation_id=$1)
           or (case_kind='unbound_inbound_event' and subject_inbound_event_id=$2)
           or (case_kind='unmatched_provider_event'
               and subject_provider_message_id_digest=$3)
           or (case_kind='ambiguous_message_create'
               and subject_operation_id=$4)`,
      [
        abandoned.id, unboundId, digest("orphan-sid-" + run),
        ambiguous.id
      ]
    );
    assert.equal(
      openedForThisRun.rowCount,
      4,
      "every case kind opened exactly one case for this run's subjects"
    );

    // Detection is idempotent by case digest — a second pass opens none of
    // this run's subjects again.
    const second = await reconciliation.runDetection({
      workerId: WORKER_ID,
      observedAt: observedFuture
    });
    const reopenedForThisRun = await pool.query(
      `select count(*)::integer as count
         from ss.provider_reconciliation_cases
        where subject_operation_id in ($1,$4) or subject_inbound_event_id=$2
           or subject_provider_message_id_digest=$3`,
      [
        abandoned.id, unboundId, digest("orphan-sid-" + run),
        ambiguous.id
      ]
    );
    assert.equal(reopenedForThisRun.rows[0].count, 4);
    assert.ok(second.openedCases >= 0);

    const abandonedCase = await pool.query(
      `select id from ss.provider_reconciliation_cases
        where case_kind='abandoned_claim' and subject_operation_id=$1`,
      [abandoned.id]
    );
    assert.equal(abandonedCase.rowCount, 1);
    const escalation = await reconciliation.escalateAbandonedClaim({
      caseId: abandonedCase.rows[0].id,
      escalatedAt: observedFuture
    });
    assert.equal(escalation.status, "escalated");
    const escalated = await pool.query(
      `select state, last_worker_id, manual_review_at, failure_code,
              lease_owner
         from ss.responder_delivery_operations where id=$1`,
      [abandoned.id]
    );
    assert.deepEqual(
      {
        state: escalated.rows[0].state,
        last_worker_id: escalated.rows[0].last_worker_id,
        failure_code: escalated.rows[0].failure_code,
        lease_owner: escalated.rows[0].lease_owner
      },
      {
        state: "manual_review",
        last_worker_id: "responder-fulfillment-aworker0001",
        failure_code: "RESPONDER_DELIVERY_ABANDONED_CLAIM",
        lease_owner: null
      }
    );
    assert.equal(
      (await reconciliation.escalateAbandonedClaim({
        caseId: abandonedCase.rows[0].id, escalatedAt: observedFuture
      })).status,
      "already_escalated"
    );

    // (5) Operator queue projection: after refresh the open reconciliation
    // cases appear as provider_reconciliation_case items with no repair.
    // The operator-queue refresh SQL guards observedAt against real wall
    // clock (+/-5min), so it takes an actual timestamp, not the fake clock.
    const refreshed = await operatorQueue.refresh({
      actorId: ids.operator,
      operatorOrganizationId: ids.organization,
      observedAt: new Date().toISOString()
    });
    const items = refreshed.items.filter(
      (item) => item.kind === "provider_reconciliation_case"
    );
    assert.ok(items.length >= 4);
    for (const item of items) {
      assert.equal(item.repair, null);
      assert.equal(item.status, "open");
      assert.equal(item.source.table, "ss.provider_reconciliation_cases");
    }
    const critical = items.find((item) => item.severity === "critical");
    assert.ok(critical, "the suppression conflict projects as critical");

    // (6) The whole loop performs real worker-to-readback-to-repository
    // composition against a fake read-only provider. Every result is digest
    // only and no provider create/retry path exists.
    const fakeReadback = {
      kind: "twilio-responder-readback",
      mode: "verified-read-only",
      providerEffects: false,
      readOnly: true,
      async readiness() { return { ready: true, verified: true }; },
      async findMessages({ targets }) {
        const target = targets[0];
        const targetDigest = digest({
          schema: "sitesourcery.twilio-readback-target/v1",
          ...target
        });
        const providerMessageIdDigest = target.kind ===
          "provider_message_id"
          ? target.providerMessageIdDigest
          : digest({ targetDigest, provider: "fake-twilio" });
        return {
          results: [{
            targetDigest,
            state: target.kind === "provider_message_id"
              ? "matched"
              : "single_candidate",
            matchCount: 1,
            providerMessageIdDigest,
            status: "delivered",
            errorCodeDigest: null,
            readbackEvidenceDigest: digest({
              targetDigest,
              providerMessageIdDigest,
              state: target.kind === "provider_message_id"
                ? "matched"
                : "single_candidate"
            })
          }]
        };
      }
    };
    const worker = createProviderReconciliationWorker({
      repository: reconciliation,
      readback: fakeReadback,
      clock: { now: () => observedFuture },
      enabled: true,
      workerId: WORKER_ID,
      log: () => {}
    });
    const swept = await worker.runOnce();
    assert.equal(swept.status, "swept");
    assert.equal(swept.openedCases, 0, "steady state opens nothing new");
    assert.equal(swept.readbackReady, true);
    assert.ok(swept.readbacksRecorded >= 4);
    const ambiguousReadback = await pool.query(
      `select readback_state, readback_match_count,
              readback_matched_provider_message_id_digest
         from ss.provider_reconciliation_cases
        where case_kind='ambiguous_message_create'
          and subject_operation_id=$1`,
      [ambiguous.id]
    );
    assert.deepEqual(
      {
        state: ambiguousReadback.rows[0].readback_state,
        count: ambiguousReadback.rows[0].readback_match_count,
        matched: ambiguousReadback.rows[0]
          .readback_matched_provider_message_id_digest !== null
      },
      { state: "single_candidate", count: 1, matched: true }
    );

    // No durable operational row leaked a raw number or body anywhere.
    const scan = await pool.query(
      `select to_jsonb(reconciliation.*)::text as row
         from ss.provider_reconciliation_cases reconciliation`
    );
    for (const { row } of scan.rows) {
      assert.equal(row.includes("+18565550100"), false);
      assert.equal(row.includes(DELIVERY_BODY), false);
    }
  } finally {
    await pool.end();
  }
});
