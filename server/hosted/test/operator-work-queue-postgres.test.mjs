import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";

test("operator queue PostgreSQL repository fails closed without canonical authority", () => {
  assert.throws(() => createPostgresOperatorWorkQueueRepository(), {
    code: "OPERATOR_QUEUE_CONFIGURATION_REQUIRED"
  });
});

test("readiness proves every queue source table is forced-RLS and effect-free", async () => {
  const calls = [];
  const repository = createPostgresOperatorWorkQueueRepository({
    authority: {
      async service(context, work) {
        calls.push(context);
        return work({
          async query(sql, parameters) {
            assert.match(sql, /hosted_operator_work_queue_contract_v1/iu);
            assert.deepEqual(parameters, [[
              "operator_work_queue_items",
              "stripe_invoice_finalization_failures",
              "alakazam_invoice_finalization_observations",
              "alakazam_invoice_finalization_projection",
              "provider_reconciliation_resolution_commands",
              "adjacent_integration_crosswalks"
            ]]);
            return {
              rows: [{
                contract_ready: true,
                resolution_contract_ready: true,
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
    kind: "operator-work-queue-postgres",
    code: null,
    sourceAuthoritative: true,
    providerEffects: false,
    alertEffects: false,
    genericRepair: false
  });
  assert.deepEqual(calls, [{ actorKind: "system", readOnly: true }]);
});

test("list, refresh, and repair reject an operator organization outside active membership", async () => {
  const contexts = [];
  const queries = [];
  const repository = createPostgresOperatorWorkQueueRepository({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query(sql, values) {
            queries.push({ sql, values });
            return { rows: [{ allowed: false }], rowCount: 1 };
          }
        });
      }
    }
  });
  const scope = { actorId: USER, operatorOrganizationId: ORG };
  for (const call of [
    () => repository.list(scope),
    () => repository.refresh({ ...scope, observedAt: "2026-08-11T12:00:00.000Z" }),
    () => repository.prepareProfessionalReversalRepair({
      ...scope,
      queueItemId: ITEM,
      expectedQueueRevision: 1
    })
  ]) {
    await assert.rejects(call, {
      code: "OPERATOR_QUEUE_UNAVAILABLE",
      status: 404
    });
  }
  assert.deepEqual(contexts, [
    { actorKind: "operator", userId: USER, organizationId: ORG,
      isolation: "serializable", readOnly: true },
    { actorKind: "operator", userId: USER, organizationId: ORG,
      isolation: "serializable", readOnly: false },
    { actorKind: "operator", userId: USER, organizationId: ORG,
      isolation: "serializable", readOnly: true }
  ]);
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.match(query.sql, /service_operator_has_capability/u);
    assert.match(query.sql, /organization_memberships/u);
    assert.deepEqual(query.values, [USER, ORG]);
  }
});
