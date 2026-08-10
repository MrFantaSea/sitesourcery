import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresOperatorWorkQueueRepository } from
  "../operator-work-queue-postgres.mjs";

test("operator queue PostgreSQL repository fails closed without canonical authority", () => {
  assert.throws(() => createPostgresOperatorWorkQueueRepository(), {
    code: "OPERATOR_QUEUE_CONFIGURATION_REQUIRED"
  });
});

test("readiness proves the contract, both forced-RLS tables, and no effects", async () => {
  const calls = [];
  const repository = createPostgresOperatorWorkQueueRepository({
    authority: {
      async service(context, work) {
        calls.push(context);
        return work({
          async query(sql) {
            assert.match(sql, /hosted_operator_work_queue_contract_v1/iu);
            return {
              rows: [{ contract_ready: true, tables_ready: true, rls_ready: true }],
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
