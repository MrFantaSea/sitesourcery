import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_MAIL_CAPABILITY,
  CARE_OPERATOR_CAPABILITY,
  createCareMailReservationInterface,
  createCareSurfacesService
} from "../care-surfaces.mjs";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  organization: "20000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  customer: "40000000-0000-4000-8000-000000000001",
  contract: "50000000-0000-4000-8000-000000000001",
  period: "60000000-0000-4000-8000-000000000001",
  ticket: "70000000-0000-4000-8000-000000000001",
  support: "80000000-0000-4000-8000-000000000001",
  finding: "90000000-0000-4000-8000-000000000001",
  entry: "a0000000-0000-4000-8000-000000000001",
  message: "b0000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-11T16:00:00.000Z";
const actor = Object.freeze({
  userId: IDS.actor,
  organizationId: IDS.organization
});
const DIGEST = Object.freeze({
  provider: "1".repeat(64),
  basis: "2".repeat(64),
  work: "3".repeat(64),
  recipient: "4".repeat(64),
  subject: "5".repeat(64),
  content: "6".repeat(64)
});

function repository() {
  const calls = [];
  const dashboard = {
    schema: "sitesourcery.care-surface-dashboard/v1",
    audience: "customer",
    organizationId: IDS.organization,
    observedAt: NOW,
    held: {
      commercialRelease: true,
      customerEffects: true,
      mailDelivery: true,
      paymentEffects: true,
      providerEffects: true
    },
    contracts: []
  };
  const selected = {
    calls,
    async readiness() {
      return { ready: true, verified: true };
    },
    async readCustomerDashboard(input) {
      calls.push(["customer", input]);
      return dashboard;
    },
    async readOperatorDashboard(input) {
      calls.push(["operator", input]);
      return { ...dashboard, audience: "operator" };
    },
    async assertOperatorCapabilities(input) {
      calls.push(["capabilities", input]);
      return true;
    },
    async resolveAssessmentFindingId(input) {
      calls.push(["finding", input]);
      return IDS.finding;
    },
    async resolveTicketMailScope(input) {
      calls.push(["mail-scope", input]);
      return { projectId: IDS.project, customerUserId: IDS.customer };
    }
  };
  for (const method of [
    "openPeriod", "closePeriod", "openTicket", "transitionTicket",
    "allocateCapacity"
  ]) {
    selected[method] = async (input) => {
      calls.push([method, input]);
      return { method, input };
    };
  }
  return selected;
}

function lifecycle() {
  const calls = [];
  return {
    calls,
    providerEffects: false,
    async readiness() {
      return { ready: true, verified: true };
    },
    async reserve(input) {
      calls.push(input);
      return {
        schema: "sitesourcery.hosted-mail-delivery-receipt/v1",
        messageId: IDS.message,
        messageType: "support_notification",
        organizationId: input.organizationId,
        projectId: input.projectId,
        customerUserId: input.customerUserId,
        state: "pending",
        provider: null,
        revision: 1,
        requestedAt: NOW,
        expiresAt: input.expiresAt
      };
    }
  };
}

function fixture() {
  const care = repository();
  const mailLifecycle = lifecycle();
  const mailReservations = createCareMailReservationInterface({
    lifecycle: mailLifecycle,
    clock: { now: () => NOW }
  });
  return {
    care,
    mailLifecycle,
    service: createCareSurfacesService({
      repository: care,
      mailReservations,
      clock: { now: () => NOW }
    })
  };
}

function command(body, commandId = "care.command.0001") {
  return { body, commandId, organizationId: IDS.organization };
}

test("customer projections are exact-org reads and customer mutations remain held", async () => {
  const { care, service } = fixture();
  assert.equal((await service.readCustomer(actor)).audience, "customer");
  assert.deepEqual(care.calls[0], [
    "customer",
    { actorId: IDS.actor, organizationId: IDS.organization }
  ]);
  await assert.rejects(
    service.requestCustomerTicket(actor),
    (error) => error.code === "CARE_CUSTOMER_EFFECTS_HELD" &&
      error.status === 503 &&
      error.details.customerEffects === false &&
      error.details.paymentEffects === false &&
      error.details.providerEffects === false
  );
  assert.equal(
    care.calls.filter(([name]) => name === "customer").length,
    2
  );
});

test("operator projections require the existing management capability for the target org", async () => {
  const { care, service } = fixture();
  const result = await service.readOperator(actor, IDS.organization);
  assert.equal(result.audience, "operator");
  assert.deepEqual(care.calls, [
    [
      "capabilities",
      {
        actorId: IDS.actor,
        organizationId: IDS.organization,
        capabilities: [CARE_OPERATOR_CAPABILITY]
      }
    ],
    [
      "operator",
      { actorId: IDS.actor, organizationId: IDS.organization }
    ]
  ]);
  care.assertOperatorCapabilities = async (input) => {
    care.calls.push(["capabilities", input]);
    if (input.organizationId !== IDS.organization) {
      throw Object.assign(new Error("unavailable"), {
        code: "CARE_SURFACE_UNAVAILABLE",
        status: 404
      });
    }
    return true;
  };
  await assert.rejects(
    service.readOperator(actor, "20000000-0000-4000-8000-000000000099"),
    (error) => error.code === "CARE_SURFACE_UNAVAILABLE" && error.status === 404
  );
  assert.equal(
    care.calls.some(([name, input]) =>
      name === "operator" &&
      input.organizationId === "20000000-0000-4000-8000-000000000099"
    ),
    false
  );
});

test("operator period, transition, and capacity commands reuse exact held core constructors", async () => {
  const { care, service } = fixture();
  await service.openPeriod(actor, command({
    carriedFromPeriodId: null,
    carriedUnits: 0,
    contractId: IDS.contract,
    endsOn: "2026-09-11",
    includedUnits: 4,
    periodId: IDS.period,
    projectId: IDS.project,
    providerPeriodKey: "care-period-2026-08",
    providerScopeDigest: DIGEST.provider,
    startsOn: "2026-08-11"
  }));
  await service.closePeriod(actor, IDS.period, command({
    expectedRevision: 1,
    projectId: IDS.project
  }, "care.command.0002"));
  await service.transitionTicket(actor, IDS.ticket, command({
    expectedRevision: 1,
    projectId: IDS.project,
    transition: "start"
  }, "care.command.0003"));
  await service.allocateCapacity(actor, IDS.period, command({
    capacitySource: "included",
    entryId: IDS.entry,
    projectId: IDS.project,
    ticketId: IDS.ticket,
    units: 1
  }, "care.command.0004"));
  assert.deepEqual(
    care.calls.filter(([name]) => name === "capabilities")
      .map(([, input]) => input.capabilities),
    Array.from({ length: 4 }, () => [CARE_OPERATOR_CAPABILITY])
  );
  for (const [, input] of care.calls.filter(([name]) => [
    "openPeriod", "closePeriod", "transitionTicket", "allocateCapacity"
  ].includes(name))) {
    assert.equal(input.actorKind, "operator");
    assert.equal(input.actorId, IDS.actor);
    assert.equal(input.organizationId, IDS.organization);
    assert.equal(input.recordedAt, NOW);
    assert.equal(input.providerEffects, false);
  }
});

test("assessment findings cross the surface as one digest and resolve internally", async () => {
  const { care, service } = fixture();
  await service.openTicket(actor, command({
    basisDigest: DIGEST.basis,
    basisKind: "assessment_finding",
    contractId: IDS.contract,
    periodId: IDS.period,
    projectId: IDS.project,
    supportTicketId: IDS.support,
    ticketId: IDS.ticket,
    workScopeDigest: DIGEST.work
  }));
  assert.deepEqual(care.calls[1], [
    "finding",
    {
      actorId: IDS.actor,
      organizationId: IDS.organization,
      projectId: IDS.project,
      findingDigest: DIGEST.basis
    }
  ]);
  const stored = care.calls[2][1];
  assert.equal(stored.basisReferenceId, IDS.finding);
  assert.equal(stored.basisDigest, DIGEST.basis);
  await assert.rejects(
    service.openTicket(actor, command({
      basisDigest: DIGEST.basis,
      basisKind: "assessment_finding",
      basisReferenceId: IDS.finding,
      contractId: IDS.contract,
      periodId: IDS.period,
      projectId: IDS.project,
      supportTicketId: IDS.support,
      ticketId: IDS.ticket,
      workScopeDigest: DIGEST.work
    }, "care.command.0005")),
    (error) => error.code === "CARE_SURFACE_INVALID"
  );
});

test("Care mail reserves digest-only durable state and never accepts or sends content", async () => {
  const { care, mailLifecycle, service } = fixture();
  const result = await service.reserveTicketMail(
    actor,
    IDS.ticket,
    command({
      contentDigest: DIGEST.content,
      expiresAt: "2026-08-11T17:00:00.000Z",
      recipientDigest: DIGEST.recipient,
      subjectReferenceDigest: DIGEST.subject,
      templateVersion: "care-ticket-update.v1"
    })
  );
  assert.deepEqual(care.calls[0][1].capabilities, [
    CARE_MAIL_CAPABILITY,
    CARE_OPERATOR_CAPABILITY
  ]);
  assert.equal(result.state, "reserved");
  assert.equal(result.deliveryEffects, false);
  assert.equal(result.providerEffects, false);
  assert.equal(mailLifecycle.calls.length, 1);
  const reserved = mailLifecycle.calls[0];
  assert.equal(reserved.messageType, "support_notification");
  assert.equal(reserved.organizationId, IDS.organization);
  assert.equal(reserved.projectId, IDS.project);
  assert.equal(reserved.customerUserId, IDS.customer);
  assert.match(reserved.commandId, /^care[.]mail[.][0-9a-f]{64}$/u);
  assert.equal("recipient" in reserved, false);
  assert.equal("subject" in reserved, false);
  assert.equal("body" in reserved, false);
  assert.equal("send" in reserved, false);
});

test("Care mail rejects arbitrary templates, raw content, and unbounded reservations", async () => {
  const { service } = fixture();
  const base = {
    contentDigest: DIGEST.content,
    expiresAt: "2026-08-11T17:00:00.000Z",
    recipientDigest: DIGEST.recipient,
    subjectReferenceDigest: DIGEST.subject,
    templateVersion: "care-ticket-update.v1"
  };
  for (const body of [
    { ...base, templateVersion: "arbitrary-message.v1" },
    { ...base, expiresAt: "2026-08-19T16:00:00.000Z" },
    { ...base, body: "raw customer content" }
  ]) {
    await assert.rejects(
      service.reserveTicketMail(actor, IDS.ticket, command(body)),
      (error) => error.code === "CARE_SURFACE_INVALID"
    );
  }
});

test("surface readiness reports reservation readiness without implying delivery", async () => {
  const { service } = fixture();
  assert.deepEqual(await service.readiness(), {
    ready: true,
    verified: true,
    schema: "sitesourcery.care-surface-readiness/v1",
    mode: "held-local",
    core: { ready: true, verified: true },
    mailReservation: {
      ready: true,
      verified: true,
      deliveryEffects: false,
      providerEffects: false
    },
    customerEffects: false,
    paymentEffects: false,
    providerEffects: false
  });
});
