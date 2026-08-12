import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresSupportCaseRepository
} from "../support-cases-postgres.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";

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

test("customer and operator list, read, and write reject cross-organization scope", async () => {
  const contexts = [];
  const queries = [];
  const repository = createPostgresSupportCaseRepository({
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
  const customer = { actorId: USER, organizationId: ORG };
  const operator = { actorId: USER, operatorOrganizationId: ORG };
  for (const call of [
    () => repository.listCustomerCases(customer),
    () => repository.readCustomerCase({ ...customer, caseId: CASE }),
    () => repository.openAuthenticated(customer),
    () => repository.listOperatorCases(operator),
    () => repository.readOperatorCase({ ...operator, caseId: CASE }),
    () => repository.assign({ ...operator, caseId: CASE })
  ]) {
    await assert.rejects(call, {
      code: "SUPPORT_CASE_UNAVAILABLE",
      status: 404
    });
  }
  assert.equal(queries.length, 6);
  for (const query of queries) {
    assert.match(query.sql, /organization_memberships/u);
    assert.deepEqual(query.values, [USER, ORG]);
  }
  assert.equal(
    queries.filter(({ sql }) => /service_operator_has_capability/u.test(sql)).length,
    3
  );
  assert.deepEqual(contexts.map(({ actorKind, organizationId, readOnly }) => ({
    actorKind, organizationId, readOnly
  })), [
    { actorKind: "customer", organizationId: ORG, readOnly: true },
    { actorKind: "customer", organizationId: ORG, readOnly: true },
    { actorKind: "customer", organizationId: ORG, readOnly: false },
    { actorKind: "operator", organizationId: ORG, readOnly: true },
    { actorKind: "operator", organizationId: ORG, readOnly: true },
    { actorKind: "operator", organizationId: ORG, readOnly: false }
  ]);
});
