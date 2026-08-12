import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_MAIL_CAPABILITY,
  CARE_OPERATOR_CAPABILITY
} from "../care-surfaces.mjs";
import { createPostgresCareSurfaceRepository } from
  "../care-surfaces-postgres.mjs";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  ticket: "70000000-0000-4000-8000-000000000001",
  finding: "80000000-0000-4000-8000-000000000001"
});
const NOW = new Date("2026-08-11T16:00:00.000Z");
const BASIS = "1".repeat(64);
const WORK = "2".repeat(64);

function rows() {
  return {
    contracts: [{
      id: IDS.contract,
      organization_id: IDS.organization,
      project_id: IDS.project,
      customer_user_id: IDS.customer,
      contract_kind: "custom_care",
      authority_state: "held",
      customer_effects_authorized: false,
      payment_effects_authorized: false,
      provider_effects_authorized: false,
      service_key: "custom_care",
      catalog_version: "SS-CARE-CORE-2026.1",
      billing_cadence: "month",
      capacity_unit_kind: "care_request",
      commercial_authority_state: "owner_redline_required"
    }],
    periods: [{
      id: IDS.period,
      contract_id: IDS.contract,
      project_id: IDS.project,
      starts_on: "2026-08-11",
      ends_on: "2026-09-11",
      included_units: 4,
      carried_units: 1,
      state: "open",
      authority_state: "held",
      provider_effects_authorized: false,
      revision: 1,
      used_carried_units: 1,
      used_included_units: 1
    }],
    tickets: [{
      id: IDS.ticket,
      contract_id: IDS.contract,
      project_id: IDS.project,
      period_id: IDS.period,
      basis_kind: "assessment_finding",
      basis_digest: BASIS,
      work_scope_digest: WORK,
      state: "in_progress",
      revision: 2,
      provider_effects_authorized: false,
      mail_effects_authorized: false,
      opened_at: NOW,
      resolved_at: null,
      closed_at: null,
      allocated_units: 2
    }]
  };
}

function harness({ denied = [], mutateRows = () => {} } = {}) {
  const queries = [];
  const contexts = [];
  const delegated = [];
  const fixtureRows = rows();
  mutateRows(fixtureRows);
  const authority = {
    async service(context, work) {
      contexts.push(context);
      return work({
        async query(text, values = []) {
          queries.push({ text, values });
          if (text.includes("care-surfaces:operator-capability")) {
            return {
              rowCount: 1,
              rows: [{ allowed: !denied.includes(values[1]) }]
            };
          }
          if (text.includes("care-surfaces:contracts")) {
            return { rowCount: 1, rows: fixtureRows.contracts };
          }
          if (text.includes("care-surfaces:periods")) {
            return { rowCount: 1, rows: fixtureRows.periods };
          }
          if (text.includes("care-surfaces:tickets-digest-only")) {
            return { rowCount: 1, rows: fixtureRows.tickets };
          }
          if (text.includes("care-surfaces:observed-at")) {
            return { rowCount: 1, rows: [{ observed_at: NOW }] };
          }
          if (text.includes("care-surfaces:assessment-finding-digest")) {
            return { rowCount: 1, rows: [{ finding_id: IDS.finding }] };
          }
          if (text.includes("care-surfaces:mail-scope")) {
            return {
              rowCount: 1,
              rows: [{
                project_id: IDS.project,
                customer_user_id: IDS.customer
              }]
            };
          }
          throw new Error(`Unexpected query: ${text}`);
        }
      });
    }
  };
  const coreRepository = {
    async readiness() { return { ready: true, verified: true }; }
  };
  for (const method of [
    "allocateCapacity", "closePeriod", "openPeriod", "openTicket",
    "transitionTicket"
  ]) {
    coreRepository[method] = async (input) => {
      delegated.push([method, input]);
      return input;
    };
  }
  return {
    contexts,
    delegated,
    queries,
    repository: createPostgresCareSurfaceRepository({
      authority,
      coreRepository
    })
  };
}

const actor = Object.freeze({
  actorId: IDS.actor,
  organizationId: IDS.organization
});
const customerActor = Object.freeze({
  actorId: IDS.customer,
  organizationId: IDS.organization
});

test("customer dashboard is filtered by exact organization and customer identity", async () => {
  const fixture = harness();
  const dashboard = await fixture.repository.readCustomerDashboard(customerActor);
  assert.equal(dashboard.audience, "customer");
  assert.equal(dashboard.organizationId, IDS.organization);
  assert.equal(dashboard.contracts.length, 1);
  assert.equal("customerId" in dashboard.contracts[0], false);
  assert.deepEqual(fixture.contexts[0], {
    actorKind: "customer",
    userId: IDS.customer,
    organizationId: IDS.organization,
    readOnly: true,
    isolation: "serializable"
  });
  const contract = fixture.queries.find(({ text }) =>
    text.includes("care-surfaces:contracts")
  );
  assert.deepEqual(contract.values, [IDS.organization, IDS.customer]);
});

test("operator dashboard requires the canonical management capability and target org", async () => {
  const fixture = harness();
  const dashboard = await fixture.repository.readOperatorDashboard(actor);
  assert.equal(dashboard.audience, "operator");
  assert.equal(dashboard.contracts[0].customerId, IDS.customer);
  assert.deepEqual(fixture.queries[0].values, [
    IDS.actor,
    CARE_OPERATOR_CAPABILITY
  ]);
  const contracts = fixture.queries.find(({ text }) =>
    text.includes("care-surfaces:contracts")
  );
  assert.deepEqual(contracts.values, [IDS.organization, null]);

  const denied = harness({ denied: [CARE_OPERATOR_CAPABILITY] });
  await assert.rejects(
    denied.repository.readOperatorDashboard(actor),
    (error) => error.code === "CARE_SURFACE_UNAVAILABLE" &&
      error.status === 404
  );
  assert.equal(
    denied.queries.some(({ text }) => text.includes("care-surfaces:contracts")),
    false
  );
});

test("dashboard projections expose assessment references only as digests", async () => {
  const fixture = harness();
  const dashboard = await fixture.repository.readOperatorDashboard(actor);
  const ticket = dashboard.contracts[0].tickets[0];
  assert.deepEqual(ticket.basis, {
    kind: "assessment_finding",
    referenceDigest: BASIS
  });
  assert.equal(JSON.stringify(dashboard).includes(IDS.finding), false);
  const ticketQuery = fixture.queries.find(({ text }) =>
    text.includes("care-surfaces:tickets-digest-only")
  );
  assert.equal(/basis_reference_id/u.test(ticketQuery.text), false);
  assert.equal(ticket.effects.mail, false);
  assert.equal(ticket.effects.provider, false);
});

test("dashboard projection fails closed on ownership, effect, or capacity drift", async () => {
  for (const mutateRows of [
    (value) => { value.contracts[0].customer_user_id = IDS.actor; },
    (value) => { value.periods[0].project_id = IDS.customer; },
    (value) => { value.tickets[0].provider_effects_authorized = true; },
    (value) => { value.periods[0].used_included_units = 5; }
  ]) {
    const fixture = harness({ mutateRows });
    await assert.rejects(
      fixture.repository.readCustomerDashboard(customerActor),
      (error) => error.code === "CARE_SURFACE_AUTHORITY_DRIFT" &&
        error.status === 503
    );
  }
});

test("assessment digest resolution is capability-gated, exact-org, and internal", async () => {
  const fixture = harness();
  const finding = await fixture.repository.resolveAssessmentFindingId({
    ...actor,
    projectId: IDS.project,
    findingDigest: BASIS
  });
  assert.equal(finding, IDS.finding);
  assert.deepEqual(fixture.queries[1].values, [
    IDS.organization,
    IDS.project,
    BASIS
  ]);
  assert.match(
    fixture.queries[1].text,
    /finding[.]finding_digest = \$3/u
  );
});

test("mail scope is fenced by both management and support capabilities", async () => {
  const fixture = harness();
  const scope = await fixture.repository.resolveTicketMailScope({
    ...actor,
    ticketId: IDS.ticket
  });
  assert.deepEqual(scope, {
    projectId: IDS.project,
    customerUserId: IDS.customer
  });
  assert.deepEqual(
    fixture.queries.slice(0, 2).map(({ values }) => values),
    [
      [IDS.actor, CARE_MAIL_CAPABILITY],
      [IDS.actor, CARE_OPERATOR_CAPABILITY]
    ]
  );
  assert.deepEqual(fixture.queries[2].values, [IDS.organization, IDS.ticket]);

  const denied = harness({ denied: [CARE_MAIL_CAPABILITY] });
  await assert.rejects(
    denied.repository.resolveTicketMailScope({ ...actor, ticketId: IDS.ticket }),
    (error) => error.code === "CARE_SURFACE_UNAVAILABLE"
  );
  assert.equal(denied.queries.length, 1);
});

test("command methods delegate unchanged to migration-121 core authority", async () => {
  const fixture = harness();
  const command = Object.freeze({ requestDigest: "3".repeat(64) });
  for (const method of [
    "openPeriod", "closePeriod", "openTicket", "transitionTicket",
    "allocateCapacity"
  ]) {
    assert.equal(await fixture.repository[method](command), command);
  }
  assert.deepEqual(
    fixture.delegated.map(([method, value]) => [method, value === command]),
    [
      ["openPeriod", true],
      ["closePeriod", true],
      ["openTicket", true],
      ["transitionTicket", true],
      ["allocateCapacity", true]
    ]
  );
});
