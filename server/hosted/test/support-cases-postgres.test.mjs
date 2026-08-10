import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresSupportCaseRepository
} from "../support-cases-postgres.mjs";

test("repository readiness requires its feature marker, five forced-RLS tables, and stays effect-free", async () => {
  const repository = createPostgresSupportCaseRepository({
    authority: {
      async service(context, work) {
        assert.deepEqual(context, { actorKind: "system", readOnly: true });
        return work({
          async query(sql, values) {
            assert.match(sql, /hosted_support_case_contract_v1/u);
            assert.equal(values[0].length, 5);
            return { rows: [{ contract_ready: true, tables_ready: true, rls_ready: true }] };
          }
        });
      }
    }
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "support-case-postgres",
    code: null,
    providerEffects: false,
    deletionExecution: false,
    exportExecution: false
  });
});

test("repository fails closed without canonical authority", () => {
  assert.throws(
    () => createPostgresSupportCaseRepository(),
    (error) => error.code === "SUPPORT_CASE_CONFIGURATION_REQUIRED"
  );
});
