import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresProviderReconciliationOperator } from
  "../provider-reconciliation-operator-postgres.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const COMMAND_ROW_ID = "40000000-0000-4000-8000-000000000001";
const COMMAND = "operator-resolution:0001";
const EVIDENCE = "a".repeat(64);
const CASE_DIGEST = "b".repeat(64);
const AT = "2026-08-13T18:00:00.000Z";

function resolvedCase() {
  return {
    id: CASE,
    case_kind: "ambiguous_message_create",
    case_digest: CASE_DIGEST,
    state: "resolved",
    revision: "3",
    resolution_kind: "operator_confirmed_no_effect",
    resolution_evidence_digest: EVIDENCE,
    resolved_at: new Date(AT)
  };
}

test("operator reconciliation fails closed without PostgreSQL authority", () => {
  assert.throws(() => createPostgresProviderReconciliationOperator(), {
    code: "OPERATOR_RECONCILIATION_CONFIGURATION_REQUIRED"
  });
});

test("readiness proves the exact contract and forced-RLS command table", async () => {
  const contexts = [];
  const operator = createPostgresProviderReconciliationOperator({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            assert.match(sql, /operator_resolution_surfaces_contract_v1/u);
            assert.deepEqual(values, [
              "canonical-fin-004u-operator-resolution-v1-digest-only-held"
            ]);
            return { rows: [{ contract_ready: true, table_ready: true }] };
          }
        });
      }
    }
  });
  assert.deepEqual(await operator.readiness(), {
    ready: true,
    verified: true,
    kind: "provider-reconciliation-operator-postgres",
    code: null,
    providerEffects: false,
    genericRepair: false
  });
  assert.deepEqual(contexts, [{ actorKind: "system", readOnly: true }]);
});

test("case read uses exact operator scope and digest-only SQL projection", async () => {
  const contexts = [];
  const projected = {
    schema: "sitesourcery.operator-provider-reconciliation-case/v1",
    id: CASE,
    providerEffects: false,
    genericRepair: false
  };
  const operator = createPostgresProviderReconciliationOperator({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            assert.equal(
              sql,
              "select ss.operator_provider_reconciliation_case_v1($1) as case_data"
            );
            assert.deepEqual(values, [CASE]);
            return { rows: [{ case_data: projected }] };
          }
        });
      }
    }
  });
  assert.deepEqual(await operator.readCase({
    actorId: USER, operatorOrganizationId: ORG, caseId: CASE
  }), projected);
  assert.deepEqual(contexts, [{
    actorKind: "operator",
    userId: USER,
    organizationId: ORG,
    isolation: "serializable",
    readOnly: true
  }]);
});

test("resolution inserts immutable command before guarded case closure", async () => {
  const calls = [];
  let insertedCommand;
  const operator = createPostgresProviderReconciliationOperator({
    clock: () => new Date(AT),
    randomUUID: () => COMMAND_ROW_ID,
    authority: {
      async service(context, work) {
        assert.deepEqual(context, {
          actorKind: "system",
          userId: USER,
          isolation: "serializable"
        });
        return work({
          async query(sql, values) {
            calls.push(sql);
            if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
            if (sql.includes("from ss.provider_reconciliation_resolution_commands")) {
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes("insert into ss.provider_reconciliation_resolution_commands")) {
              insertedCommand = {
                id: values[0], command_id: values[1],
                request_digest: values[2], case_id: values[3],
                expected_case_revision: values[4],
                operator_organization_id: values[5], operator_user_id: values[6],
                resolution_kind: values[7], evidence_digest: values[8],
                resolved_at: new Date(values[9])
              };
              return { rows: [insertedCommand], rowCount: 1 };
            }
            if (sql.includes("update ss.provider_reconciliation_cases")) {
              assert.ok(insertedCommand, "command must precede case mutation");
              assert.deepEqual(values, [
                CASE, "operator_confirmed_no_effect", USER, EVIDENCE, AT, 2
              ]);
              return { rows: [resolvedCase()], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${sql}`);
          }
        });
      }
    }
  });
  const result = await operator.resolveCase({
    actorId: USER,
    operatorOrganizationId: ORG,
    caseId: CASE,
    commandId: COMMAND,
    expectedRevision: 2,
    resolutionKind: "operator_confirmed_no_effect",
    evidenceDigest: EVIDENCE
  });
  assert.equal(result.schema,
    "sitesourcery.operator-provider-reconciliation-resolution/v1");
  assert.equal(result.replayed, false);
  assert.equal(result.providerEffects, false);
  assert.equal(result.genericRepair, false);
  assert.equal(result.case.revision, 3);
  assert.ok(calls.findIndex((sql) => sql.includes("insert into")) <
    calls.findIndex((sql) => sql.includes("update ss.provider")));
});

test("invalid resolution inputs never open a database transaction", async () => {
  let calls = 0;
  const operator = createPostgresProviderReconciliationOperator({
    authority: { async service() { calls += 1; } }
  });
  const valid = {
    actorId: USER, operatorOrganizationId: ORG, caseId: CASE,
    commandId: COMMAND, expectedRevision: 2,
    resolutionKind: "operator_closed", evidenceDigest: EVIDENCE
  };
  for (const input of [
    { ...valid, caseId: "wrong" },
    { ...valid, commandId: "short" },
    { ...valid, expectedRevision: 0 },
    { ...valid, resolutionKind: "retry_provider" },
    { ...valid, evidenceDigest: "raw evidence" }
  ]) assert.throws(() => operator.resolveCase(input), { status: 400 });
  assert.equal(calls, 0);
});
