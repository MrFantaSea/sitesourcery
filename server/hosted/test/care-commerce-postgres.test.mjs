import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresCareCommerceEligibility,
  createPostgresCareCommerceRepository
} from
  "../care-commerce-postgres.mjs";

const IDS = Object.freeze({
  operator: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001"
});

function row(overrides = {}) {
  return {
    organization_id: IDS.organization,
    project_id: IDS.project,
    contract_id: IDS.contract,
    customer_user_id: IDS.customer,
    catalog_identity_id: "00000000-0000-4000-8000-000000001212",
    contract_kind: "outside_management",
    acceptance_digest: "1".repeat(64),
    scope_digest: "2".repeat(64),
    provider_scope_digest: "3".repeat(64),
    contract_authority_state: "held",
    customer_effects_authorized: false,
    payment_effects_authorized: false,
    contract_provider_effects_authorized: false,
    catalog_version: "SS-CARE-CORE-2026.2",
    service_key: "outside_management",
    commercial_authority_state: "exact_held",
    period_id: IDS.period,
    period_state: "open",
    period_revision: 2,
    starts_on: "2026-08-01",
    ends_on: "2026-09-01",
    period_provider_effects_authorized: false,
    project_lifecycle: "active",
    customer_membership_state: "active",
    customer_membership_role: "owner",
    ...overrides
  };
}

function harness({ selectedRow = row(), capability = true, absent = false } = {}) {
  const contexts = [];
  const queries = [];
  const authority = {
    async service(context, work) {
      contexts.push(context);
      return work({
        async query(text, values = []) {
          queries.push({ text, values });
          if (text.includes("to_regprocedure")) {
            return {
              rowCount: 1,
              rows: [{
                contract_ready: true,
                tables_ready: true,
                rls_ready: true
              }]
            };
          }
          if (text.includes("care-commerce:operator-capability")) {
            return { rowCount: 1, rows: [{ allowed: capability }] };
          }
          if (text.includes("care-commerce:exact-held-eligibility")) {
            return absent
              ? { rowCount: 0, rows: [] }
              : { rowCount: 1, rows: [selectedRow] };
          }
          throw new Error(`Unexpected query ${text}`);
        }
      });
    }
  };
  return {
    contexts,
    queries,
    eligibility: createPostgresCareCommerceEligibility({ authority })
  };
}

function input(audience = "operator") {
  return {
    audience,
    actorId: audience === "customer" ? IDS.customer : IDS.operator,
    organizationId: IDS.organization,
    projectId: IDS.project,
    contractId: IDS.contract,
    periodId: IDS.period
  };
}

test("readiness proves retained Care authority without commercial mutation", async () => {
  const selected = harness();
  assert.deepEqual(await selected.eligibility.readiness(), {
    ready: true,
    verified: true,
    mode: "read-only-held",
    code: null,
    providerEffects: false
  });
  assert.deepEqual(selected.contexts[0], {
    actorKind: "system",
    readOnly: true
  });
  assert.deepEqual(selected.queries[0].values[0], [
    "care_catalog_identities",
    "care_customer_contracts",
    "care_periods",
    "organization_memberships"
  ]);
});

test("operator eligibility requires invoice and management capabilities", async () => {
  const selected = harness();
  const result = await selected.eligibility.resolve(input());
  assert.equal(result.customerId, IDS.customer);
  assert.equal(result.serviceKey, "outside_management");
  assert.equal(result.periodRevision, 2);
  assert.equal(result.customerEffects, false);
  assert.equal(result.paymentEffects, false);
  assert.equal(result.providerEffects, false);
  assert.match(result.eligibilityDigest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(selected.contexts[0], {
    actorKind: "operator",
    userId: IDS.operator,
    organizationId: IDS.organization,
    readOnly: true,
    isolation: "serializable"
  });
  const capabilities = selected.queries.filter(({ text }) =>
    text.includes("care-commerce:operator-capability")
  );
  assert.deepEqual(capabilities.map(({ values }) => values), [
    [IDS.operator, "service_invoice_manage"],
    [IDS.operator, "service_management_manage"]
  ]);
  const eligibility = selected.queries.find(({ text }) =>
    text.includes("care-commerce:exact-held-eligibility")
  );
  assert.deepEqual(eligibility.values, [
    IDS.organization,
    IDS.project,
    IDS.contract,
    IDS.period,
    "operator",
    IDS.operator
  ]);
});

test("customer eligibility is exact-customer scoped and needs no operator capability", async () => {
  const selected = harness();
  const result = await selected.eligibility.resolve(input("customer"));
  assert.equal(result.actorId, IDS.customer);
  assert.equal(result.customerId, IDS.customer);
  assert.equal(selected.queries.some(({ text }) =>
    text.includes("care-commerce:operator-capability")
  ), false);
  const eligibility = selected.queries.find(({ text }) =>
    text.includes("care-commerce:exact-held-eligibility")
  );
  assert.equal(eligibility.values[4], "customer");
  assert.equal(eligibility.values[5], IDS.customer);
});

test("capability denial, cross-scope absence, and effect drift fail closed", async () => {
  await assert.rejects(
    harness({ capability: false }).eligibility.resolve(input()),
    (error) => error.code === "CARE_COMMERCE_UNAVAILABLE" &&
      error.status === 404
  );
  await assert.rejects(
    harness({ absent: true }).eligibility.resolve(input("customer")),
    (error) => error.code === "CARE_COMMERCE_UNAVAILABLE" &&
      error.status === 404
  );
  await assert.rejects(
    harness({
      selectedRow: row({ payment_effects_authorized: true })
    }).eligibility.resolve(input()),
    (error) => error.code === "CARE_COMMERCE_AUTHORITY_DRIFT" &&
      error.status === 503
  );
  await assert.rejects(
    harness({
      selectedRow: row({ customer_user_id: IDS.operator })
    }).eligibility.resolve(input("customer")),
    (error) => error.code === "CARE_COMMERCE_AUTHORITY_DRIFT"
  );
});

function repositoryHarness() {
  const contexts = [];
  const commands = [];
  const authority = {
    async service(selectedContext, work) {
      contexts.push(selectedContext);
      return work({
        async query(text, values = []) {
          if (text.includes("hosted_care_commerce_persistence_contract_v1")) {
            return { rowCount: 1, rows: [{
              contract_ready: true, tables_ready: true, rls_ready: true
            }] };
          }
          if (text.includes("pg_advisory_xact_lock")) {
            return { rowCount: 1, rows: [{}] };
          }
          if (text.includes("from ss.care_commands command")) {
            const selected = commands.find((command) =>
              command.organization_id === values[0] &&
              command.command_id === values[1]);
            return { rowCount: selected ? 1 : 0, rows: selected ? [selected] : [] };
          }
          throw new Error(`Unexpected repository query ${text}`);
        }
      });
    }
  };
  return {
    contexts,
    commands,
    repository: createPostgresCareCommerceRepository({ authority })
  };
}

function command(overrides = {}) {
  return {
    actorId: IDS.operator,
    organizationId: IDS.organization,
    projectId: IDS.project,
    customerId: IDS.customer,
    contractId: IDS.contract,
    periodId: IDS.period,
    commandId: "care.commerce.quote.pg.0001",
    operation: "care_quote_create",
    fingerprint: "a".repeat(64),
    ...overrides
  };
}

test("durable repository readiness proves three additive forced-RLS held relations", async () => {
  const selected = repositoryHarness();
  assert.deepEqual(await selected.repository.readiness(), {
    ready: true,
    verified: true,
    mode: "postgres-held",
    durable: true,
    code: null,
    providerEffects: false
  });
  assert.deepEqual(selected.contexts[0], {
    actorKind: "system",
    readOnly: true
  });
});

test("new claims leave no parallel command row and failed work needs no abandonment mutation", async () => {
  const selected = repositoryHarness();
  const exact = command();
  assert.deepEqual(await selected.repository.claimCommand(exact), {
    status: "claimed"
  });
  assert.deepEqual(await selected.repository.claimCommand(exact), {
    status: "claimed"
  });
  await selected.repository.abandonCommand(exact);
  assert.equal(selected.commands.length, 0);
  assert.equal(selected.contexts.every((value) =>
    value.actorKind === "operator" &&
    value.userId === IDS.operator &&
    value.organizationId === IDS.organization &&
    value.isolation === "serializable"
  ), true);
});

test("completed durable command replays only its exact held document", async () => {
  const selected = repositoryHarness();
  const exact = command();
  const result = {
    schema: "sitesourcery.care-commerce-quote/v1",
    organizationId: exact.organizationId,
    projectId: exact.projectId,
    customerId: exact.customerId,
    contractId: exact.contractId,
    periodId: exact.periodId,
    actorId: exact.actorId,
    quoteDigest: "c".repeat(64),
    providerEffects: false
  };
  selected.commands.push({
    organization_id: exact.organizationId,
    command_id: exact.commandId,
    project_id: exact.projectId,
    actor_user_id: exact.actorId,
    operation: exact.operation,
    fingerprint: exact.fingerprint,
    resource_kind: "commerce_quote",
    result_digest: result.quoteDigest,
    result_document: result
  });
  assert.deepEqual(await selected.repository.claimCommand(exact), {
    status: "replay",
    result
  });
  assert.deepEqual(await selected.repository.claimCommand({
    ...exact,
    fingerprint: "b".repeat(64)
  }), { status: "conflict", drift: ["fingerprint"] });
});
