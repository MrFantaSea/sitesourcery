import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALAKAZAM_POLICY_AUTHORITY,
  ALAKAZAM_POLICY_AUTHORITY_DIGEST,
  ALAKAZAM_POLICY_AUTHORITY_ID,
  ALAKAZAM_POLICY_HOLD_REASON
} from "../../commerce-v2/alakazam-policy-authority.mjs";
import {
  createPostgresAlakazamPolicyAuthorityRepository
} from "../alakazam-policy-authority-postgres.mjs";

const IDS = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  customerId: "10000000-0000-4000-8000-000000000003",
  subscriptionId: "10000000-0000-4000-8000-000000000004",
  transitionEventId: "10000000-0000-4000-8000-000000000005"
});

function row(overrides = {}) {
  return {
    organization_id: IDS.tenantId,
    project_id: IDS.projectId,
    customer_user_id: IDS.customerId,
    subscription_id: IDS.subscriptionId,
    source_subscription_revision: "8",
    source_subscription_status: "grace",
    transition_event_id: IDS.transitionEventId,
    cancellation_id: null,
    retention_window_id: null,
    retention_ends_at: null,
    reversal_event_id: null,
    lifecycle_state: "payment_grace",
    legacy_evidence_compatible: true,
    policy_id: ALAKAZAM_POLICY_AUTHORITY_ID,
    authority_digest: ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    state: "held",
    hold_reason: ALAKAZAM_POLICY_HOLD_REASON,
    commercial_effects: false,
    provider_effects: false,
    publication_effects: false,
    automatic_recovery_from_reversal_evidence: false,
    observed_at: new Date("2026-08-10T12:00:00.000Z"),
    ...overrides
  };
}

function fixture({ snapshotRow = row() } = {}) {
  const calls = [];
  const authority = {
    async service(context, work) {
      calls.push({ context: structuredClone(context), statements: [] });
      const call = calls.at(-1);
      return work({
        async query(statement) {
          const sql = String(statement).replace(/\s+/gu, " ").trim();
          call.statements.push(sql);
          if (sql.includes("hosted_alakazam_policy_authority_contract_v1")) {
            return {
              rowCount: 1,
              rows: [{
                contract_ready: true,
                policy_ready: true,
                rls_ready: true,
                grants_ready: true
              }]
            };
          }
          if (sql.includes("select policy_document, policy_digest")) {
            return {
              rowCount: 1,
              rows: [{
                policy_document: structuredClone(ALAKAZAM_POLICY_AUTHORITY),
                policy_digest: ALAKAZAM_POLICY_AUTHORITY_DIGEST
              }]
            };
          }
          if (sql.includes("alakazam_policy_subscription_authority_v1")) {
            return { rowCount: 1, rows: [structuredClone(snapshotRow)] };
          }
          throw new Error(`unexpected query: ${sql}`);
        }
      });
    }
  };
  return {
    calls,
    repository: createPostgresAlakazamPolicyAuthorityRepository({ authority })
  };
}

test("readiness proves the exact held policy, RLS, grants, and no effects", async () => {
  const { calls, repository } = fixture();
  assert.deepEqual(await repository.readiness(), {
    schema: "sitesourcery.alakazam-policy-readiness/v1",
    ready: true,
    verified: true,
    state: "held",
    policyId: ALAKAZAM_POLICY_AUTHORITY_ID,
    authorityDigest: ALAKAZAM_POLICY_AUTHORITY_DIGEST,
    commercialEffects: false,
    providerEffects: false,
    publicationEffects: false,
    automaticRecoveryFromReversalEvidence: false,
    code: null
  });
  assert.deepEqual(await repository.policy(), ALAKAZAM_POLICY_AUTHORITY);
  assert.ok(calls.every((call) => call.context.readOnly === true));
  assert.ok(calls.flatMap((call) => call.statements).every(
    (sql) => !/^(insert|update|delete)\b/iu.test(sql)
  ));
});

test("legacy projection reads are byte-stable and idempotent", async () => {
  const { calls, repository } = fixture();
  const input = {
    tenantId: IDS.tenantId,
    projectId: IDS.projectId,
    customerId: IDS.customerId,
    subscriptionId: IDS.subscriptionId
  };
  const first = await repository.read(input);
  const second = await repository.read(input);
  assert.deepEqual(second, first);
  assert.equal(first.lifecycleState, "payment_grace");
  assert.equal(first.providerEffects, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.context.readOnly === true));
});

test("incomplete legacy evidence and unavailable storage fail closed", async () => {
  const incomplete = fixture({
    snapshotRow: row({
      lifecycle_state: "held_evidence_incomplete",
      legacy_evidence_compatible: false
    })
  });
  await assert.rejects(
    incomplete.repository.read({
      tenantId: IDS.tenantId,
      projectId: IDS.projectId,
      customerId: IDS.customerId,
      subscriptionId: IDS.subscriptionId
    }),
    { code: "ALAKAZAM_POLICY_EVIDENCE_INCOMPLETE" }
  );

  const unavailable = createPostgresAlakazamPolicyAuthorityRepository({
    authority: {
      async service() {
        throw new Error("offline");
      }
    }
  });
  assert.equal((await unavailable.readiness()).ready, false);
  assert.equal(
    (await unavailable.readiness()).code,
    "ALAKAZAM_POLICY_DATABASE_UNAVAILABLE"
  );
});

test("production startup requires only read-only held policy readiness", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createPostgresAlakazamPolicyAuthorityRepository\(\{\s*authority\s*\}\)/u
  );
  assert.match(
    source,
    /await alakazamPolicyAuthorityRepository\.readiness\(\)/u
  );
  assert.match(
    source,
    /alakazamPolicyReadiness\.ready !== true/u
  );
  assert.doesNotMatch(
    source,
    /alakazamPolicyAuthorityRepository\.(?:write|apply|synchronize|activate|release)\(/u
  );
});
