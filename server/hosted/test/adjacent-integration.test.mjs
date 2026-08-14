import assert from "node:assert/strict";
import test from "node:test";

import {
  ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST,
  ADJACENT_INTEGRATION_SYSTEM_KEYS,
  createAdjacentIntegrationService,
  createHeldAdjacentIntegration
} from "../adjacent-integration.mjs";

const IDS = Object.freeze({
  operator: "00000000-0000-4000-8000-000000000001",
  organization: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000003",
  snapshot: "00000000-0000-4000-8000-000000000004",
  crosswalk: "00000000-0000-4000-8000-000000000005",
  engagement: "00000000-0000-4000-8000-000000000006",
  resolution: "00000000-0000-4000-8000-000000000007"
});
const NOW = "2026-08-14T13:00:00.000Z";
const SHA = "a".repeat(64);
const SOURCE = `git:${"b".repeat(40)}`;

function fixture() {
  const calls = [];
  const generated = [
    IDS.snapshot, IDS.crosswalk, IDS.engagement, IDS.resolution
  ];
  const repository = {};
  for (const method of [
    "readiness", "listContracts", "listTrace", "recordGlobalSnapshot",
    "recordCrosswalk", "recordObservation", "resolveCrosswalk"
  ]) {
    repository[method] = async (input) => {
      calls.push({ method, input });
      return { method, input };
    };
  }
  return {
    calls,
    service: createAdjacentIntegrationService({
      repository,
      clock: { now: () => NOW },
      ids: { next: () => generated.shift() }
    })
  };
}

test("adjacent integration freezes all six systems and every remote effect", () => {
  const { service } = fixture();
  assert.deepEqual(ADJACENT_INTEGRATION_SYSTEM_KEYS, [
    "private_messenger", "command_deck", "phone_bridge",
    "client_profile_hub", "marketing_desk", "dell_commercial_engine"
  ]);
  assert.equal(
    ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST,
    "3253dafa276acd700900c9f6b72c8b7e2bde9f7f2ce1e40318591859b4d7a6ec"
  );
  assert.equal(service.mode, "manual-read-only");
  assert.equal(service.remoteWrites, false);
  assert.equal(service.providerEffects, false);
  assert.equal(service.automaticCommands, false);
});

test("global snapshots are digest-only and exact-kind bound", async () => {
  const { service, calls } = fixture();
  await service.recordGlobalSnapshot({
    actorId: IDS.operator,
    commandId: "adjacent.snapshot.1",
    observationKind: "status_snapshot",
    observationState: "available",
    operatorOrganizationId: IDS.organization,
    remoteEntityKind: "service",
    remoteReference: `sha256:${SHA}`,
    sourceObservedAt: NOW,
    sourcePayloadDigest: SHA,
    sourceRevision: SOURCE,
    systemKey: "command_deck"
  });
  assert.equal(calls[0].input.id, IDS.snapshot);
  assert.match(calls[0].input.semanticLock, /^adjacent:snapshot:[0-9a-f]{64}$/u);
  await service.recordGlobalSnapshot({
    actorId: IDS.operator,
    commandId: "adjacent.snapshot.messenger.1",
    observationKind: "availability",
    observationState: "available",
    operatorOrganizationId: IDS.organization,
    remoteEntityKind: "relay_service",
    remoteReference: `sha256:${SHA}`,
    sourceObservedAt: NOW,
    sourcePayloadDigest: SHA,
    sourceRevision: SOURCE,
    systemKey: "private_messenger"
  });
  assert.equal(calls[1].input.remoteEntityKind, "relay_service");
  assert.throws(
    () => service.recordGlobalSnapshot({
      actorId: IDS.operator,
      commandId: "adjacent.snapshot.2",
      observationKind: "status_snapshot",
      observationState: "available",
      operatorOrganizationId: IDS.organization,
      remoteEntityKind: "service",
      remoteReference: "raw-phone-or-service-reference",
      sourceObservedAt: NOW,
      sourcePayloadDigest: SHA,
      sourceRevision: SOURCE,
      systemKey: "command_deck"
    }),
    { code: "ADJACENT_INTEGRATION_INVALID", status: 400 }
  );
});

test("Hub and marketing crosswalks enforce exact kind pairs", async () => {
  const { service, calls } = fixture();
  await service.recordCrosswalk({
    actorId: IDS.operator,
    commandId: "adjacent.crosswalk.1",
    localEntityId: IDS.organization,
    localEntityKind: "organization",
    operatorOrganizationId: IDS.organization,
    projectId: null,
    referencePolicy: "hub_client_id",
    remoteEntityKind: "client",
    remoteReference: "SSC-2026-001",
    sourceEvidenceDigest: SHA,
    sourceRevision: SOURCE,
    sourceSnapshotId: IDS.snapshot,
    state: "manual_review",
    supersedesCrosswalkId: null,
    systemKey: "client_profile_hub"
  });
  assert.equal(calls[0].input.remoteReference, "SSC-2026-001");
  assert.throws(
    () => service.recordCrosswalk({
      actorId: IDS.operator,
      commandId: "adjacent.crosswalk.2",
      localEntityId: IDS.project,
      localEntityKind: "project",
      operatorOrganizationId: IDS.organization,
      projectId: IDS.project,
      referencePolicy: "hub_client_id",
      remoteEntityKind: "client",
      remoteReference: "SSC-2026-002",
      sourceEvidenceDigest: SHA,
      sourceRevision: SOURCE,
      sourceSnapshotId: IDS.snapshot,
      state: "manual_review",
      supersedesCrosswalkId: null,
      systemKey: "client_profile_hub"
    }),
    { code: "ADJACENT_INTEGRATION_INVALID", status: 400 }
  );
});

test("tenant observations and resolution transitions remain exact and held", async () => {
  const { service, calls } = fixture();
  await service.recordObservation({
    actorId: IDS.operator,
    commandId: "adjacent.observation.1",
    crosswalkId: IDS.crosswalk,
    observationKind: "promotion_receipt",
    observationState: "matched",
    operatorOrganizationId: IDS.organization,
    projectId: IDS.project,
    sourceObservedAt: NOW,
    sourcePayloadDigest: SHA,
    sourceRevision: SOURCE,
    sourceSnapshotId: IDS.snapshot,
    systemKey: "marketing_desk"
  });
  await service.resolveCrosswalk({
    actorId: IDS.operator,
    commandId: "adjacent.resolution.1",
    crosswalkId: IDS.crosswalk,
    expectedCrosswalkRequestDigest: SHA,
    expectedCrosswalkRevision: 1,
    operatorOrganizationId: IDS.organization,
    priorState: "manual_review",
    resolutionEvidenceDigest: SHA,
    resolutionKind: "operator_confirm_link",
    resultingState: "linked",
    systemKey: "marketing_desk"
  });
  assert.deepEqual(calls.map(({ method }) => method), [
    "recordObservation", "resolveCrosswalk"
  ]);
  assert.throws(
    () => service.resolveCrosswalk({
      actorId: IDS.operator,
      commandId: "adjacent.resolution.2",
      crosswalkId: IDS.crosswalk,
      expectedCrosswalkRequestDigest: SHA,
      expectedCrosswalkRevision: 2,
      operatorOrganizationId: IDS.organization,
      priorState: "linked",
      resolutionEvidenceDigest: SHA,
      resolutionKind: "operator_confirm_link",
      resultingState: "linked",
      systemKey: "marketing_desk"
    }),
    { code: "ADJACENT_INTEGRATION_INVALID", status: 400 }
  );
});

test("held adjacent integration never claims a partial connection", async () => {
  const held = createHeldAdjacentIntegration();
  assert.equal((await held.readiness()).ready, false);
  assert.throws(
    () => held.listContracts({}),
    { code: "ADJACENT_INTEGRATION_HELD", status: 503 }
  );
});
