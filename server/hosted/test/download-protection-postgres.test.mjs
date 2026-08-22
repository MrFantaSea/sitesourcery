import assert from "node:assert/strict";
import test from "node:test";

import { digest } from
  "../../commerce-v2/canonical.mjs";
import { createPostgresDownloadProtectionRepository } from
  "../download-protection-postgres.mjs";

const OPERATOR =
  "10000000-0000-4000-8000-000000000001";
const ORGANIZATION =
  "20000000-0000-4000-8000-000000000001";
const PROJECT =
  "30000000-0000-4000-8000-000000000001";
const RECEIPT =
  "40000000-0000-4000-8000-000000000001";
const ENTITLEMENT =
  "50000000-0000-4000-8000-000000000001";
const DOSSIER_ID =
  "60000000-0000-4000-8000-000000000001";
const DECISION_ID =
  "70000000-0000-4000-8000-000000000001";
const NOW = "2026-08-22T16:05:00.000Z";
const EVENT_ID = "evt_download_dispute_1";
const EVENT_TYPE = "charge.dispute.created";

const DOSSIER = Object.freeze({
  schema:
    "sitesourcery.download-private-dispute-dossier/v1",
  createdAt: "2026-08-22T16:00:00.000Z",
  trigger: {
    eventId: EVENT_ID,
    eventType: EVENT_TYPE,
    payloadDigest: "a".repeat(64)
  },
  scope: {
    tenantId: ORGANIZATION,
    projectId: PROJECT,
    receiptId: RECEIPT,
    entitlementId: ENTITLEMENT
  },
  quote: { price: { amountMinor: 2000 } },
  purchaseAcceptance: {
    acceptance: { statement: "accepted" }
  },
  payment: { chargeId: "ch_download_1" },
  entitlement: { state: "suspended" },
  accessEvents: [{ state: "response_issued" }]
});
const DOSSIER_DIGEST = digest(DOSSIER);

function dossierRow() {
  return {
    id: DOSSIER_ID,
    organization_id: ORGANIZATION,
    project_id: PROJECT,
    receipt_id: RECEIPT,
    entitlement_id: ENTITLEMENT,
    trigger_event_id: EVENT_ID,
    trigger_type: EVENT_TYPE,
    dossier: structuredClone(DOSSIER),
    dossier_digest: DOSSIER_DIGEST,
    created_at: "2026-08-22T16:00:00.000Z"
  };
}

function heldGate() {
  return {
    singleton: true,
    state: "held",
    reason: "stripe_download_dispute_created",
    signal_type: EVENT_TYPE,
    signal_id: EVENT_ID,
    evidence_digest: "a".repeat(64),
    state_changed_at: "2026-08-22T16:00:00.000Z",
    revision: "2"
  };
}

function scope() {
  return {
    operatorId: OPERATOR,
    operatorOrganizationId: ORGANIZATION
  };
}

test("Download protection repository fails closed without canonical authority", () => {
  assert.throws(
    () => createPostgresDownloadProtectionRepository(),
    { code: "invalid_configuration" }
  );
});

test("readiness proves the exact forced-RLS private evidence contract without effects", async () => {
  const contexts = [];
  const repository = createPostgresDownloadProtectionRepository({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            assert.match(
              sql,
              /download_protection_contract_v1/u
            );
            assert.equal(values[1].length, 7);
            assert.equal(values[2], 7);
            return {
              rows: [{
                contract_ready: true,
                tables_ready: true,
                rls_ready: true
              }],
              rowCount: 1
            };
          }
        });
      }
    }
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "download-protection-postgres",
    privateEvidence: true,
    providerEffects: false,
    paymentEffects: false
  });
  assert.deepEqual(contexts, [{
    actorKind: "system",
    readOnly: true
  }]);
});

test("private dossier export requires an active owner operator and preserves its digest", async () => {
  const contexts = [];
  const repository = createPostgresDownloadProtectionRepository({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            if (sql.includes("service_operator_has_capability")) {
              assert.deepEqual(values, [
                OPERATOR,
                ORGANIZATION
              ]);
              return {
                rows: [{ authorized: true }],
                rowCount: 1
              };
            }
            assert.match(sql, /download_dispute_dossiers/u);
            assert.deepEqual(values, [
              ORGANIZATION,
              DOSSIER_ID
            ]);
            return {
              rows: [dossierRow()],
              rowCount: 1
            };
          }
        });
      }
    }
  });
  const exported = await repository.exportDossier({
    ...scope(),
    dossierId: DOSSIER_ID
  });
  assert.equal(exported.private, true);
  assert.equal(exported.immutable, true);
  assert.equal(exported.dossierId, DOSSIER_ID);
  assert.equal(exported.dossierDigest, DOSSIER_DIGEST);
  assert.deepEqual(exported.dossier, DOSSIER);
  assert.deepEqual(contexts, [{
    actorKind: "operator",
    userId: OPERATOR,
    organizationId: ORGANIZATION,
    readOnly: true
  }]);
});

test("only the current matching held signal can reopen after an exact owner dossier review", async () => {
  const calls = [];
  const repository = createPostgresDownloadProtectionRepository({
    clock: () => new Date(NOW),
    ids: { next: () => DECISION_ID },
    authority: {
      async service(context, work) {
        assert.deepEqual(context, {
          actorKind: "operator",
          userId: OPERATOR,
          organizationId: ORGANIZATION,
          isolation: "serializable"
        });
        return work({
          async query(sql, values) {
            calls.push({ sql, values });
            if (sql.includes("service_operator_has_capability")) {
              return {
                rows: [{ authorized: true }],
                rowCount: 1
              };
            }
            if (
              sql.includes("download_dispute_dossiers")
            ) {
              return {
                rows: [dossierRow()],
                rowCount: 1
              };
            }
            if (
              sql.includes("download_checkout_gate") &&
              sql.includes("for update")
            ) {
              return {
                rows: [heldGate()],
                rowCount: 1
              };
            }
            if (
              sql.includes("update ss.commerce_v2_download_checkout_gate")
            ) {
              return {
                rows: [{
                  ...heldGate(),
                  state: "open",
                  reason: "owner reviewed exact dispute evidence",
                  signal_type: null,
                  signal_id: null,
                  evidence_digest: values[1],
                  state_changed_at: NOW,
                  revision: "3"
                }],
                rowCount: 1
              };
            }
            return { rows: [], rowCount: 1 };
          }
        });
      }
    }
  });
  const result = await repository.reopenGate({
    ...scope(),
    dossierId: DOSSIER_ID,
    reviewedDossierDigest: DOSSIER_DIGEST,
    reason: "owner reviewed exact dispute evidence"
  });
  assert.equal(result.status, "reopened");
  assert.equal(result.gate.state, "open");
  assert.equal(result.gate.revision, 3);
  assert.equal(result.decision.decisionId, DECISION_ID);
  assert.equal(
    result.decision.reviewedDossierDigest,
    DOSSIER_DIGEST
  );
  assert.equal(
    digest(result.decision),
    result.decisionDigest
  );
  assert.equal(
    calls.filter(({ sql }) =>
      sql.includes("gate_review_decisions")
    ).length,
    1
  );
  assert.equal(
    calls.filter(({ sql }) =>
      sql.includes("gate_transitions")
    ).length,
    1
  );
});

test("owner review fails closed on a stale dossier digest before the gate can move", async () => {
  let gateTouched = false;
  const repository = createPostgresDownloadProtectionRepository({
    clock: () => new Date(NOW),
    ids: { next: () => DECISION_ID },
    authority: {
      async service(_context, work) {
        return work({
          async query(sql) {
            if (sql.includes("service_operator_has_capability")) {
              return {
                rows: [{ authorized: true }],
                rowCount: 1
              };
            }
            if (sql.includes("download_dispute_dossiers")) {
              return {
                rows: [dossierRow()],
                rowCount: 1
              };
            }
            gateTouched = true;
            return { rows: [heldGate()], rowCount: 1 };
          }
        });
      }
    }
  });
  await assert.rejects(
    repository.reopenGate({
      ...scope(),
      dossierId: DOSSIER_ID,
      reviewedDossierDigest: "f".repeat(64),
      reason: "owner reviewed exact dispute evidence"
    }),
    { code: "download_protection_review_stale" }
  );
  assert.equal(gateTouched, false);
});
