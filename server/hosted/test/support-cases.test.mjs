import assert from "node:assert/strict";
import test from "node:test";

import {
  createHeldSupportCaseService,
  createSupportCaseService
} from "../support-cases.mjs";

const IDS = Object.freeze({
  actor: "10000000-0000-4000-8000-000000000001",
  operator: "20000000-0000-4000-8000-000000000001",
  organization: "30000000-0000-4000-8000-000000000001",
  project: "40000000-0000-4000-8000-000000000001",
  case: "50000000-0000-4000-8000-000000000001",
  message: "60000000-0000-4000-8000-000000000001"
});
const NOW = "2026-08-10T16:00:00.000Z";
const SHA = (value) => value.repeat(64);

function repository() {
  const calls = [];
  const methods = [
    "openAuthenticated", "recordManual", "assign", "updateIdentity",
    "setDeadline", "startReview", "respond", "deny", "close",
    "addEvidence", "readCustomerCase", "listCustomerCases",
    "readOperatorCase", "listOperatorCases", "linkMailReservation"
  ];
  const selected = {
    calls,
    async readiness() { return { ready: true }; }
  };
  for (const name of methods) {
    selected[name] = async (input) => {
      calls.push([name, input]);
      return { method: name, input };
    };
  }
  return selected;
}

function authenticatedOpening(requestKind = "support") {
  return {
    actorId: IDS.actor,
    commandId: `support.open.${requestKind}.0001`,
    evidenceDigests: [SHA("1")],
    organizationId: IDS.organization,
    parentCaseId: requestKind === "appeal" ? IDS.case : null,
    projectId: IDS.project,
    requestKind,
    requesterReferenceDigest: SHA("2"),
    requesterUserId: IDS.actor,
    scopeKind: "project"
  };
}

test("held support case boundary exposes no execution or provider capability", async () => {
  const service = createHeldSupportCaseService();
  assert.equal(service.providerEffects, false);
  assert.deepEqual(await service.readiness(), {
    ready: false,
    verified: false,
    kind: "support-case-lifecycle",
    mode: "held",
    code: "SUPPORT_CASES_HELD",
    providerEffects: false,
    deletionExecution: false,
    exportExecution: false
  });
  await assert.rejects(
    service.openAuthenticated({}),
    (error) => error.code === "SUPPORT_CASES_HELD" &&
      error.details.deletionExecution === false &&
      error.details.exportExecution === false
  );
});

test("authenticated intake accepts every bounded request kind without body or execution fields", async () => {
  const store = repository();
  const service = createSupportCaseService({
    repository: store,
    mailLifecycle: { kind: "durable-mail-lifecycle", providerEffects: false, async reserve() {} },
    clock: { now: () => NOW }
  });
  for (const kind of ["support", "access", "correction", "export", "deletion", "appeal"]) {
    await service.openAuthenticated(authenticatedOpening(kind));
  }
  assert.equal(store.calls.length, 6);
  for (const [, input] of store.calls) {
    assert.equal(input.intakeChannel, "authenticated");
    assert.equal(input.recordedAt, NOW);
    assert.match(input.requestDigest, /^[0-9a-f]{64}$/u);
    for (const forbidden of ["body", "email", "phone", "token", "export", "deleteAccount"]) {
      assert.equal(Object.hasOwn(input, forbidden), false);
    }
  }
});

test("phone, email, and manual intake retain only opaque requester/evidence digests", async () => {
  const store = repository();
  const service = createSupportCaseService({
    repository: store,
    mailLifecycle: { kind: "durable-mail-lifecycle", providerEffects: false, async reserve() {} },
    clock: { now: () => NOW }
  });
  for (const intakeChannel of ["phone", "email", "manual"]) {
    await service.recordManual({
      actorId: IDS.operator,
      commandId: `support.manual.${intakeChannel}.0001`,
      evidenceDigests: [SHA("3")],
      intakeChannel,
      organizationId: null,
      operatorOrganizationId: IDS.organization,
      parentCaseId: null,
      projectId: null,
      requestKind: "access",
      requesterReferenceDigest: SHA("4"),
      requesterUserId: null,
      scopeKind: "general"
    });
  }
  assert.deepEqual(store.calls.map(([, input]) => input.intakeChannel), [
    "phone", "email", "manual"
  ]);
  assert.equal(JSON.stringify(store.calls).includes("@"), false);
});

test("operator lifecycle commands are revisioned, digest-only, and deadline-explicit", async () => {
  const store = repository();
  const service = createSupportCaseService({
    repository: store,
    mailLifecycle: { kind: "durable-mail-lifecycle", providerEffects: false, async reserve() {} },
    clock: { now: () => NOW }
  });
  const base = {
    actorId: IDS.operator,
    caseId: IDS.case,
    commandId: "support.identity.0001",
    expectedRevision: 2,
    operatorOrganizationId: IDS.organization
  };
  await service.updateIdentity({
    ...base,
    evidenceDigest: SHA("5"),
    identityState: "verified"
  });
  await service.setDeadline({
    ...base,
    commandId: "support.deadline.0001",
    basisDigest: SHA("6"),
    responseDueAt: "2026-08-20T16:00:00.000Z"
  });
  await service.deny({
    ...base,
    commandId: "support.deny.0001",
    appealAvailable: true,
    appealBasisDigest: SHA("7"),
    appealDueAt: "2026-09-01T16:00:00.000Z",
    denialExplanationDigest: SHA("8"),
    denialReasonCode: "legal_exception"
  });
  assert.deepEqual(store.calls.map(([method]) => method), [
    "updateIdentity", "setDeadline", "deny"
  ]);
  assert.equal(JSON.stringify(store.calls).includes("message"), false);
});

test("notification linkage accepts only a pending no-effect MAIL-01 reservation", async () => {
  const store = repository();
  const mailCalls = [];
  const service = createSupportCaseService({
    repository: store,
    mailLifecycle: {
      kind: "durable-mail-lifecycle",
      providerEffects: false,
      async reserve(input) {
        mailCalls.push(input);
        return { messageId: IDS.message, state: "pending" };
      }
    },
    clock: { now: () => NOW }
  });
  const receipt = await service.reserveNotification({
    actorId: IDS.operator,
    caseId: IDS.case,
    commandId: "support.notify.0001",
    expectedRevision: 4,
    operatorOrganizationId: IDS.organization,
    notificationKind: "response",
    mailCommandId: "support.mail.0001",
    projectId: IDS.project,
    customerUserId: IDS.actor,
    recipientDigest: SHA("9"),
    subjectReferenceDigest: SHA("a"),
    contentDigest: SHA("b"),
    templateVersion: "support_v1",
    expiresAt: "2026-08-10T17:00:00.000Z"
  });
  assert.equal(mailCalls[0].messageType, "support_notification");
  assert.equal(store.calls[0][0], "linkMailReservation");
  assert.equal(store.calls[0][1].mailMessageId, IDS.message);
  assert.equal(receipt.method, "linkMailReservation");

  const rejected = createSupportCaseService({
    repository: repository(),
    mailLifecycle: {
      kind: "durable-mail-lifecycle",
      providerEffects: false,
      async reserve() { return { messageId: IDS.message, state: "delivered" }; }
    },
    clock: { now: () => NOW }
  });
  await assert.rejects(
    rejected.reserveNotification({
      actorId: IDS.operator,
      caseId: IDS.case,
      commandId: "support.notify.0002",
      expectedRevision: 4,
      operatorOrganizationId: IDS.organization,
      notificationKind: "response",
      mailCommandId: "support.mail.0002",
      projectId: IDS.project,
      customerUserId: IDS.actor,
      recipientDigest: SHA("9"),
      subjectReferenceDigest: SHA("a"),
      contentDigest: SHA("b"),
      templateVersion: "support_v1",
      expiresAt: "2026-08-10T17:00:00.000Z"
    }),
    (error) => error.code === "SUPPORT_NOTIFICATION_NOT_PENDING"
  );
});

test("narratives and contact values are rejected as expanded inputs", () => {
  const service = createSupportCaseService({
    repository: repository(),
    mailLifecycle: { kind: "durable-mail-lifecycle", providerEffects: false, async reserve() {} },
    clock: { now: () => NOW }
  });
  assert.throws(
    () => service.openAuthenticated({
      ...authenticatedOpening(),
      message: "Please delete everything"
    }),
    (error) => error.code === "SUPPORT_CASE_INVALID"
  );
});
