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
const PROJECT = "50000000-0000-4000-8000-000000000001";
const SNAPSHOT = "70000000-0000-4000-8000-000000000001";
const CROSSWALK = "80000000-0000-4000-8000-000000000001";
const OBSERVATION = "90000000-0000-4000-8000-000000000001";

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

function adjacentContracts() {
  const keys = [
    "private_messenger", "command_deck", "phone_bridge",
    "client_profile_hub", "marketing_desk", "dell_commercial_engine"
  ];
  return {
    schema: "sitesourcery.adjacent-contracts/v1",
    systems: keys.map((systemKey) => ({
      systemKey,
      authorityOwner: `${systemKey}_authority`,
      readEventDirection: "adjacent_to_hosted_manual_evidence",
      writeEffectDirection: "none_held",
      authenticationBoundary: `${systemKey}_private_authentication`,
      identityScopePolicy: "tenant_crosswalk_and_global_snapshot",
      semanticIdempotencyPolicy:
        "same_semantic_evidence_replays_prior_receipt_new_digest_conflicts",
      conflictOwner: systemKey,
      retryPolicy: "no_automatic_retry_operator_refresh_required",
      reconciliationPolicy: "append_only_operator_resolution_or_supersession",
      auditPolicy: "append_only_operator_source_and_provenance_digests",
      failureBehavior: "fail_closed_to_manual_review",
      heldBehavior: "automatic_commands_remote_writes_and_provider_effects_false",
      adapterMode: "manual_read_only",
      automaticCommands: false,
      remoteWrites: false,
      providerEffects: false,
      contractRevision: 1
    })),
    mode: "manual-read-only",
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  };
}

function adjacentTrace() {
  return {
    schema: "sitesourcery.adjacent-trace/v1",
    organizationId: ORG,
    projectId: null,
    systemKey: null,
    crosswalks: [{
      id: CROSSWALK,
      organizationId: ORG,
      projectId: PROJECT,
      systemKey: "client_profile_hub",
      sourceSnapshotId: SNAPSHOT,
      localEntityKind: "project",
      localEntityId: PROJECT,
      remoteEntityKind: "project",
      safeRemoteReference: "SS-2026-001",
      remoteReferenceDigest: "1".repeat(64),
      sourceRevisionDigest: "2".repeat(64),
      provenanceDigest: "3".repeat(64),
      state: "manual_review",
      supersedesCrosswalkId: null,
      revision: 1,
      requestDigest: "4".repeat(64),
      recordedAt: "2026-08-14T13:00:00.000Z",
      updatedAt: "2026-08-14T13:00:00.000Z"
    }],
    observations: [{
      id: OBSERVATION,
      crosswalkId: CROSSWALK,
      sourceSnapshotId: SNAPSHOT,
      organizationId: ORG,
      projectId: PROJECT,
      systemKey: "client_profile_hub",
      observationKind: "identity_readback",
      observationState: "matched",
      payloadDigest: "5".repeat(64),
      provenanceDigest: "6".repeat(64),
      sourceObservedAt: "2026-08-14T13:00:00.000Z",
      recordedAt: "2026-08-14T13:01:00.000Z"
    }],
    sourceSnapshots: [{
      id: SNAPSHOT,
      systemKey: "client_profile_hub",
      remoteEntityKind: "service",
      remoteReferenceDigest: "7".repeat(64),
      observationKind: "availability",
      observationState: "available",
      payloadDigest: "8".repeat(64),
      provenanceDigest: "9".repeat(64),
      sourceObservedAt: "2026-08-14T13:00:00.000Z",
      recordedAt: "2026-08-14T13:01:00.000Z"
    }],
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  };
}

function adjacentQueue() {
  const value = queue();
  value.items[0] = {
    ...value.items[0],
    id: CROSSWALK,
    source: {
      table: "ss.adjacent_integration_crosswalks",
      id: CROSSWALK,
      revision: 1,
      digest: "4".repeat(64),
      state: "manual_review"
    },
    organizationId: ORG,
    projectId: PROJECT,
    kind: "adjacent_identity_review",
    severity: "normal",
    repair: { kind: "adjacent_crosswalk_resolution" },
    revision: 1
  };
  return value;
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
  assert.match(html, /id="operator-adjacent-contracts"/u);
  assert.match(html, /id="operator-adjacent-trace"/u);
  assert.match(html, /Record local resolution only/u);
  assert.match(html, /does not update the adjacent source/u);
  assert.match(html, /abracadabra-care-surfaces\.js/u);
  assert.match(html, /abracadabra-responder-surfaces\.js/u);
  assert.match(javascript, /Retained manual review; no generic repair/u);
  assert.match(javascript, /\/operator\/adjacent-integrations\/contracts/u);
  assert.match(javascript, /\/operator\/adjacent-integrations\/trace/u);
  assert.match(javascript, /\/operator\/adjacent-integrations\/crosswalks/u);
  assert.match(javascript, /\/operator\/adjacent-integrations\/resolutions/u);
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

test("operator UI accepts only exact held adjacent contracts, trace, and queue repair", () => {
  assert.equal(desk.validateAdjacentContracts(adjacentContracts()).systems.length, 6);
  assert.equal(
    desk.validateAdjacentTrace(adjacentTrace()).crosswalks[0].safeRemoteReference,
    "SS-2026-001"
  );
  assert.equal(
    desk.validateQueue(adjacentQueue()).items[0].repair.kind,
    "adjacent_crosswalk_resolution"
  );
  assert.throws(
    () => desk.validateAdjacentContracts({
      ...adjacentContracts(),
      systems: adjacentContracts().systems.slice(0, 5)
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateAdjacentContracts({
      ...adjacentContracts(), remoteWrites: true
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateAdjacentTrace({
      ...adjacentTrace(),
      crosswalks: [{
        ...adjacentTrace().crosswalks[0],
        systemKey: "private_messenger",
        safeRemoteReference: "SS-2026-001"
      }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateAdjacentTrace({
      ...adjacentTrace(),
      crosswalks: [{
        ...adjacentTrace().crosswalks[0],
        organizationId: "20000000-0000-4000-8000-000000000099"
      }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateAdjacentTrace({
      ...adjacentTrace(), rawRemoteReference: "+15555550100"
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateQueue({
      ...adjacentQueue(),
      items: [{
        ...adjacentQueue().items[0],
        kind: "privacy_case"
      }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.throws(
    () => desk.validateQueue({
      ...adjacentQueue(),
      items: [{ ...adjacentQueue().items[0], repair: null }]
    }),
    (error) => error.code === "OPERATOR_RESPONSE_INVALID"
  );
  assert.equal(desk.validateAdjacentCrosswalkReceipt({
    schema: "sitesourcery.adjacent-crosswalk-receipt/v1",
    id: CROSSWALK,
    commandId: "adjacent.browser.crosswalk.1",
    requestDigest: "a".repeat(64),
    semanticEvidenceDigest: "b".repeat(64),
    systemKey: "client_profile_hub",
    organizationId: ORG,
    projectId: PROJECT,
    state: "manual_review",
    revision: 1,
    recordedAt: "2026-08-14T13:02:00.000Z",
    replay: false,
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false
  }).state, "manual_review");
  assert.equal(desk.validateAdjacentResolutionReceipt({
    schema: "sitesourcery.adjacent-resolution-receipt/v1",
    id: "a0000000-0000-4000-8000-000000000001",
    commandId: "adjacent.browser.resolution.1",
    requestDigest: "c".repeat(64),
    semanticEvidenceDigest: "d".repeat(64),
    systemKey: "client_profile_hub",
    organizationId: ORG,
    projectId: null,
    state: "linked",
    revision: null,
    recordedAt: "2026-08-14T13:03:00.000Z",
    replay: false,
    remoteWrites: false,
    providerEffects: false,
    automaticCommands: false,
    crosswalkState: "linked",
    crosswalkRevision: 2,
    crosswalkUpdatedAt: "2026-08-14T13:03:00.000Z"
  }).crosswalkRevision, 2);
});
