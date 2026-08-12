import assert from "node:assert/strict";
import test from "node:test";

import {
  createCareCapacityAllocation,
  createCareContractRegistration,
  createCarePeriodClose,
  createCarePeriodOpen,
  createCareScopeClaim,
  createCareTicketOpen,
  createCareTicketTransition,
  createHeldCareCoreService
} from "../care-core.mjs";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  organization: "10000000-0000-4000-8000-000000000002",
  project: "10000000-0000-4000-8000-000000000003",
  customer: "10000000-0000-4000-8000-000000000004",
  catalog: "00000000-0000-4000-8000-000000001212",
  contract: "10000000-0000-4000-8000-000000000005",
  acceptance: "10000000-0000-4000-8000-000000000006",
  period: "10000000-0000-4000-8000-000000000007",
  priorPeriod: "10000000-0000-4000-8000-000000000008",
  supportTicket: "10000000-0000-4000-8000-000000000009",
  ticket: "10000000-0000-4000-8000-000000000010",
  claim: "10000000-0000-4000-8000-000000000011",
  capacity: "10000000-0000-4000-8000-000000000012"
});
const AT = "2026-08-11T18:00:00.000Z";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const ACTOR = Object.freeze({
  actorId: IDS.actor,
  actorKind: "operator",
  organizationId: IDS.organization
});

test("Care contract registration is exact, immutable-shaped, and effects-held", () => {
  const selected = createCareContractRegistration({
    actor: ACTOR,
    commandId: "care.contract.0001",
    recordedAt: AT,
    contractId: IDS.contract,
    projectId: IDS.project,
    customerId: IDS.customer,
    catalogIdentityId: IDS.catalog,
    contractKind: "outside_management",
    acceptanceReferenceId: IDS.acceptance,
    acceptanceDigest: DIGEST_A,
    scopeDigest: DIGEST_B,
    providerScopeDigest: DIGEST_C
  });
  assert.equal(selected.authorityState, "held");
  assert.equal(selected.customerEffects, false);
  assert.equal(selected.paymentEffects, false);
  assert.equal(selected.providerEffects, false);
  assert.match(selected.requestDigest, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(selected), true);
  assert.throws(
    () => createCareContractRegistration({
      ...selected,
      actor: ACTOR,
      customerEffects: true
    }),
    /Care command is invalid/u
  );
});

test("Care periods require one month and one-cycle rollover identity", () => {
  const input = {
    actor: ACTOR,
    commandId: "care.period.open.0001",
    recordedAt: AT,
    periodId: IDS.period,
    contractId: IDS.contract,
    projectId: IDS.project,
    providerScopeDigest: DIGEST_A,
    providerPeriodKey: "care.period.2026-08",
    startsOn: "2026-08-01",
    endsOn: "2026-09-01",
    includedUnits: 4,
    carriedUnits: 2,
    carriedFromPeriodId: IDS.priorPeriod
  };
  const selected = createCarePeriodOpen(input);
  assert.equal(selected.authorityState, "held");
  assert.equal(selected.carriedUnits, 2);
  assert.throws(
    () => createCarePeriodOpen({ ...input, endsOn: "2026-09-02" }),
    /exactly one calendar month/u
  );
  assert.equal(createCarePeriodOpen({
    ...input,
    commandId: "care.period.open.month-end",
    startsOn: "2027-01-31",
    endsOn: "2027-02-28"
  }).endsOn, "2027-02-28");
  assert.throws(
    () => createCarePeriodOpen({
      ...input,
      carriedUnits: 0,
      carriedFromPeriodId: IDS.priorPeriod
    }),
    /rollover authority is incomplete/u
  );
  const close = createCarePeriodClose({
    actor: ACTOR,
    commandId: "care.period.close.0001",
    recordedAt: AT,
    periodId: IDS.period,
    projectId: IDS.project,
    expectedRevision: 1
  });
  assert.equal(close.action, "period_close");
});

test("Care scope claims distinguish primary work from included overlap", () => {
  const primary = createCareScopeClaim({
    actor: ACTOR,
    commandId: "care.scope.primary.0001",
    recordedAt: AT,
    claimId: IDS.claim,
    periodId: IDS.period,
    projectId: IDS.project,
    periodStartsOn: "2026-08-01",
    periodEndsOn: "2026-09-01",
    coverageKey: "supportability_review",
    scopeIdentityDigest: DIGEST_A,
    claimMode: "primary",
    includedByClaimId: null
  });
  assert.equal(primary.claimMode, "primary");
  assert.equal(primary.paymentEffects, false);
  assert.throws(
    () => createCareScopeClaim({
      actor: ACTOR,
      commandId: "care.scope.included.0001",
      recordedAt: AT,
      claimId: IDS.claim,
      periodId: IDS.period,
      projectId: IDS.project,
      periodStartsOn: "2026-08-01",
      periodEndsOn: "2026-09-01",
      coverageKey: "supportability_review",
      scopeIdentityDigest: DIGEST_A,
      claimMode: "included",
      includedByClaimId: null
    }),
    /Included Care scope authority is incomplete/u
  );
});

test("Care tickets and capacity commands expose no provider or mail authority", () => {
  const ticket = createCareTicketOpen({
    actor: ACTOR,
    commandId: "care.ticket.open.0001",
    recordedAt: AT,
    ticketId: IDS.ticket,
    contractId: IDS.contract,
    periodId: IDS.period,
    projectId: IDS.project,
    supportTicketId: IDS.supportTicket,
    basisKind: "customer_request",
    basisReferenceId: null,
    basisDigest: DIGEST_A,
    workScopeDigest: DIGEST_B
  });
  assert.equal(ticket.state, "open");
  assert.equal(ticket.mailEffects, false);
  assert.equal(ticket.providerEffects, false);
  const transition = createCareTicketTransition({
    actor: ACTOR,
    commandId: "care.ticket.start.0001",
    recordedAt: AT,
    ticketId: IDS.ticket,
    projectId: IDS.project,
    expectedRevision: 1,
    transition: "start"
  });
  assert.equal(transition.action, "ticket_start");
  assert.equal(transition.targetState, "in_progress");
  assert.throws(
    () => createCareTicketTransition({
      actor: ACTOR,
      commandId: "care.ticket.invalid.0001",
      recordedAt: AT,
      ticketId: IDS.ticket,
      projectId: IDS.project,
      expectedRevision: 1,
      transition: "open"
    }),
    /transition is invalid/u
  );
  const capacity = createCareCapacityAllocation({
    actor: ACTOR,
    commandId: "care.capacity.0001",
    recordedAt: AT,
    entryId: IDS.capacity,
    periodId: IDS.period,
    ticketId: IDS.ticket,
    projectId: IDS.project,
    capacitySource: "included",
    units: 2
  });
  assert.equal(capacity.paymentEffects, false);
  assert.equal(capacity.providerEffects, false);
});

test("production Care service remains held even with a migrated repository", async () => {
  const service = createHeldCareCoreService({
    repository: {
      async readiness() {
        return { ready: true, verified: true, mode: "held" };
      }
    }
  });
  assert.deepEqual(await service.readiness(), {
    ready: true,
    verified: true,
    mode: "held"
  });
  assert.equal(service.providerEffects, false);
  await assert.rejects(
    service.registerContract({}),
    (error) => error.code === "CARE_CORE_HELD" &&
      error.details.providerEffects === false
  );
});
