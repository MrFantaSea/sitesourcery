import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldCustomServicesOwner,
  createPostgresCustomServicesOwner
} from "../custom-services-owner-postgres.mjs";

const OPERATOR_ID =
  "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID =
  "20000000-0000-4000-8000-000000000001";
const CASE_ID =
  "30000000-0000-4000-8000-000000000001";

function input(overrides = {}) {
  return {
    commandId: "owner-command-1",
    deliveryDate: "2026-08-20",
    organizationId: ORGANIZATION_ID,
    reviewTargets: [{ kind: "page", value: "/" }],
    ...overrides
  };
}

test("owner quote repository rejects browser price and invalid scope before PostgreSQL", async () => {
  let calls = 0;
  const owner = createPostgresCustomServicesOwner({
    authority: {
      async service() {
        calls += 1;
        throw new Error("unexpected database call");
      }
    }
  });

  await assert.rejects(
    () => owner.issueAssessmentQuote(
      { userId: OPERATOR_ID },
      CASE_ID,
      { ...input(), amountMinor: 1 }
    ),
    (error) => error.code === "invalid_input" && error.status === 400
  );
  await assert.rejects(
    () => owner.issueAssessmentQuote(
      { userId: OPERATOR_ID },
      CASE_ID,
      input({ deliveryDate: "tomorrow" })
    ),
    (error) => error.code === "invalid_input"
  );
  await assert.rejects(
    () => owner.issueAssessmentQuote(
      { userId: OPERATOR_ID },
      CASE_ID,
      input({
        reviewTargets: [
          { kind: "page", value: "/../private" }
        ]
      })
    ),
    (error) => error.code === "invalid_input"
  );
  await assert.rejects(
    () => owner.issueAssessmentQuote(
      null,
      CASE_ID,
      input()
    ),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED"
      && error.status === 401
  );
  assert.equal(calls, 0);
});

test("owner queue requires the database-controlled operator grant", async () => {
  const contexts = [];
  const owner = createPostgresCustomServicesOwner({
    authority: {
      async service(context, work) {
        contexts.push(context);
        return work({
          async query() {
            return {
              rows: [{ authorized: false }],
              rowCount: 1
            };
          }
        });
      }
    }
  });
  await assert.rejects(
    () => owner.listAssessmentRequests({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "OPERATOR_ACCESS_REQUIRED"
      && error.status === 403
  );
  assert.deepEqual(contexts, [
    { userId: OPERATOR_ID, readOnly: true }
  ]);
});

test("held owner boundary stays authenticated but unusable", async () => {
  const held = createHeldCustomServicesOwner();
  await assert.rejects(
    () => held.listAssessmentRequests({ userId: OPERATOR_ID }),
    (error) =>
      error.code === "CUSTOM_SERVICES_OWNER_HELD"
      && error.status === 503
  );
});
