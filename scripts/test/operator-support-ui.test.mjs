import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  hostedFileAllowlist,
  hostedOperatorAssets
} from "../build-hosted.mjs";
import { publicFileAllowlist } from "../build-pages.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const desk = require("../../operator/operator.js");

const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const BINDING = "60000000-0000-4000-8000-000000000001";

function numberBinding() {
  return {
    schema: "sitesourcery.responder-number-binding-receipt/v1",
    id: BINDING,
    organizationId: ORG,
    projectId: "50000000-0000-4000-8000-000000000001",
    provider: "twilio",
    numberLookupDigest: "6".repeat(64),
    lookupKeyVersion: "v2",
    phoneNumberSidDigest: "7".repeat(64),
    providerReadbackDigest: "8".repeat(64),
    accountSidDigest: "9".repeat(64),
    messagingServiceSidDigest: null,
    state: "active",
    provisionedAt: "2026-08-13T18:00:00.000Z",
    retiredAt: null,
    retiredReason: null,
    revision: 1,
    replayed: false,
    providerEffects: false
  };
}

function reconciliationCase() {
  return {
    schema: "sitesourcery.operator-provider-reconciliation-case/v1",
    id: CASE,
    provider: "twilio",
    caseKind: "ambiguous_message_create",
    caseDigest: "1".repeat(64),
    state: "open",
    organizationId: ORG,
    projectId: "50000000-0000-4000-8000-000000000001",
    evidenceDigest: "2".repeat(64),
    readbackState: "not_found",
    readbackEvidenceDigest: "3".repeat(64),
    matchedProviderMessageIdDigest: null,
    readbackMatchCount: 0,
    readbackAt: "2026-08-13T17:00:00.000Z",
    resolutionKind: null,
    resolutionEvidenceDigest: null,
    resolvedAt: null,
    openedAt: "2026-08-13T16:00:00.000Z",
    revision: 2,
    allowedResolutions: ["operator_confirmed_no_effect"],
    providerEffects: false,
    genericRepair: false
  };
}

function queue() {
  return {
    schema: "sitesourcery.operator-work-queue/v1",
    sourceAuthoritative: true,
    genericRepair: false,
    items: [{
      schema: "sitesourcery.operator-work-queue-item/v1",
      id: "40000000-0000-4000-8000-000000000001",
      source: {
        table: "ss.hosted_support_cases",
        id: CASE,
        revision: 3,
        digest: "a".repeat(64),
        state: "in_review"
      },
      organizationId: ORG,
      projectId: null,
      kind: "privacy_case",
      severity: "high",
      status: "open",
      deadlineAt: "2026-08-12T12:00:00.000Z",
      repair: null,
      openedAt: "2026-08-11T12:00:00.000Z",
      revision: 2,
      digest: "b".repeat(64),
      updatedAt: "2026-08-11T13:00:00.000Z"
    }]
  };
}

function operatorCase() {
  return {
    schema: "sitesourcery.support-case-operator-read/v1",
    id: CASE,
    requestKind: "deletion",
    scope: { kind: "account", organizationId: ORG, projectId: null },
    state: "in_review",
    identityState: "verified",
    assigned: true,
    deadline: { dueAt: "2026-08-12T12:00:00.000Z", status: "active" },
    decision: null,
    appeal: { available: false, dueAt: null, caseId: null, state: null },
    notifications: [],
    audit: [{
      sequence: 1,
      kind: "opened",
      actorKind: "customer",
      evidenceDigest: "c".repeat(64),
      occurredAt: "2026-08-11T12:00:00.000Z",
      eventDigest: "d".repeat(64)
    }],
    openedAt: "2026-08-11T12:00:00.000Z",
    closedAt: null,
    revision: 4,
    intakeChannel: "authenticated",
    requesterUserId: "10000000-0000-4000-8000-000000000001",
    requesterReferenceDigest: "e".repeat(64),
    parentCaseId: null,
    assignedOperatorId: "10000000-0000-4000-8000-000000000002",
    identityEvidenceDigest: "f".repeat(64),
    deadlineBasisDigest: "1".repeat(64),
    appealBasisDigest: null,
    closureReasonCode: null,
    evidence: [{
      kind: "identity_verification",
      sourceKind: "operator",
      digest: "f".repeat(64),
      recordedAt: "2026-08-11T12:30:00.000Z"
    }]
  };
}

test("operator assets remain hosted-only and expose an effect-held responsive desk", async () => {
  assert.deepEqual(hostedOperatorAssets, [
    "operator/index.html",
    "operator/operator.css",
    "operator/operator.js"
  ]);
  for (const file of hostedOperatorAssets) {
    assert.equal(hostedFileAllowlist.includes(file), true);
    assert.equal(publicFileAllowlist.includes(file), false);
  }
  const [html, css, javascript] = await Promise.all(
    hostedOperatorAssets.map((file) => readFile(path.join(ROOT, file), "utf8"))
  );
  assert.match(html, /id="main"[^>]*tabindex="-1"/u);
  assert.match(html, /does not send customer mail or execute deletion or export requests/u);
  assert.match(html, /Assessment and Custom tools/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /grid-template-columns: 1fr/u);
  assert.match(css, /min-height: 2\.75rem/u);
  assert.doesNotMatch(javascript, /\.innerHTML\b/u);
  assert.doesNotMatch(javascript, /notification-reservation|\/exports|\/deletion/u);
  assert.match(javascript, /\/operator\/work-queue/u);
  assert.match(javascript, /\/operator\/support-cases/u);
  assert.match(javascript, /\/operator\/provider-reconciliation\/cases\//u);
  assert.match(javascript, /\/operator\/care\/organizations\//u);
  assert.match(javascript, /\/operator\/responder\/organizations\//u);
  assert.match(javascript, /\/number-bindings/u);
  assert.match(html, /id="operator-number-bindings"/u);
  assert.match(html, /Raw number and SID values are sent once/u);
  assert.match(html, /cannot retry a provider request, fabricate an effect/u);
  assert.match(html, /Record resolution only/u);
  assert.match(html, /id="operator-care-surface"/u);
  assert.match(html, /id="operator-responder-surface"/u);
  assert.match(html, /abracadabra-care-surfaces\.js/u);
  assert.match(html, /abracadabra-responder-surfaces\.js/u);
  assert.match(javascript, /Retained manual review; no generic repair/u);
  assert.match(javascript, /control\.value = ""/u);
  assert.doesNotMatch(
    javascript,
    /messageBody|providerEffects\s*=\s*true|localStorage|sessionStorage/u
  );
});

test("operator UI validators bind canonical queue and digest-only case projections", () => {
  assert.equal(desk.validateQueue(queue()).items[0].organizationId, ORG);
  assert.equal(desk.validateOperatorCase(operatorCase()).id, CASE);
  assert.equal(
    desk.validateCaseList({
      schema: "sitesourcery.support-case-operator-list/v1",
      cases: [operatorCase()]
    }).cases[0].revision,
    4
  );
  assert.throws(
    () => desk.validateQueue({ ...queue(), sourceAuthoritative: false }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateOperatorCase({ ...operatorCase(), rawMessage: "customer body" }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateOperatorCase({
      ...operatorCase(),
      audit: [{ ...operatorCase().audit[0], eventDigest: "not-a-digest" }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.equal(
    desk.validateReconciliationCase(reconciliationCase())
      .allowedResolutions[0],
    "operator_confirmed_no_effect"
  );
  assert.throws(
    () => desk.validateReconciliationCase({
      ...reconciliationCase(),
      allowedResolutions: ["retry_provider"]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateReconciliationCase({
      ...reconciliationCase(),
      rawPhoneNumber: "+15555550100"
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.equal(desk.validateResolutionReceipt({
    schema: "sitesourcery.operator-provider-reconciliation-resolution/v1",
    commandId: "operator-resolution:0001",
    requestDigest: "4".repeat(64),
    case: {
      id: CASE,
      caseKind: "ambiguous_message_create",
      caseDigest: "1".repeat(64),
      state: "resolved",
      revision: 3,
      resolutionKind: "operator_confirmed_no_effect",
      resolutionEvidenceDigest: "5".repeat(64),
      resolvedAt: "2026-08-13T18:00:00.000Z"
    },
    replayed: false,
    providerEffects: false,
    genericRepair: false
  }).case.revision, 3);
  assert.equal(desk.validateNumberBindingList({
    schema: "sitesourcery.responder-number-binding-list/v1",
    organizationId: ORG,
    providerEffects: false,
    bindings: [numberBinding()]
  }).bindings[0].id, BINDING);
  assert.throws(
    () => desk.validateNumberBinding({
      ...numberBinding(), rawPhoneNumber: "+15555550100"
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateNumberBinding({
      ...numberBinding(), state: "active", retiredReason: "number_released"
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
});
