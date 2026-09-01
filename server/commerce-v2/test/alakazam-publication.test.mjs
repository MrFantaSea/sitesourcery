import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_PUBLICATION_HOLD_REASON,
  ALAKAZAM_PUBLICATION_SCHEMA,
  createAlakazamPublicationCommand,
  createAlakazamPublicationService,
  createHeldHostedAlakazamPublication,
  createHostedAlakazamPublication,
  projectAlakazamPublication
} from "../index.mjs";

const TENANT_ID =
  "10000000-0000-4000-8000-000000000001";
const CUSTOMER_ID =
  "20000000-0000-4000-8000-000000000001";
const PROJECT_ID =
  "30000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID =
  "40000000-0000-4000-8000-000000000001";
const CURRENT_RELEASE_ID =
  "50000000-0000-4000-8000-000000000001";
const PRIOR_RELEASE_ID =
  "50000000-0000-4000-8000-000000000002";
const CURRENT_VERSION_ID =
  "60000000-0000-4000-8000-000000000001";
const PRIOR_VERSION_ID =
  "60000000-0000-4000-8000-000000000002";
const NEXT_VERSION_ID =
  "60000000-0000-4000-8000-000000000003";
const COMMAND_ID =
  "70000000-0000-4000-8000-000000000001";
const NOW = "2026-08-08T14:00:00.000Z";

function scope(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    customerId: CUSTOMER_ID,
    actorId: CUSTOMER_ID,
    projectId: PROJECT_ID,
    ...overrides
  };
}

function stored(overrides = {}) {
  const value = {
    projectId: PROJECT_ID,
    subscription: {
      subscriptionId: SUBSCRIPTION_ID,
      revision: 4,
      tierId: "alakazam_35",
      status: "active"
    },
    site: {
      hostname: "cedar-workshop.sitesourcery.me",
      state: "live",
      acceptedVersionId: CURRENT_VERSION_ID,
      acceptedArtifactDigest: "a".repeat(64),
      currentReleaseId: CURRENT_RELEASE_ID,
      currentVersionId: CURRENT_VERSION_ID,
      updatedAt: "2026-08-08T13:30:00.000Z"
    },
    history: [
      {
        releaseId: CURRENT_RELEASE_ID,
        versionId: CURRENT_VERSION_ID,
        artifactDigest: "a".repeat(64),
        releasedAt: "2026-08-08T13:30:00.000Z",
        isCurrent: true
      },
      {
        releaseId: PRIOR_RELEASE_ID,
        versionId: PRIOR_VERSION_ID,
        artifactDigest: "b".repeat(64),
        releasedAt: "2026-08-01T13:30:00.000Z",
        isCurrent: false
      }
    ],
    lastCommand: null
  };
  return {
    ...value,
    ...overrides,
    subscription: {
      ...value.subscription,
      ...(overrides.subscription ?? {})
    },
    site: {
      ...value.site,
      ...(overrides.site ?? {})
    }
  };
}

function heldCommand(snapshot, overrides = {}) {
  return {
    commandId: COMMAND_ID,
    action: "rollback",
    state: "held",
    holdReason: ALAKAZAM_PUBLICATION_HOLD_REASON,
    snapshotDigest: snapshot.snapshotDigest,
    commandDigest: "d".repeat(64),
    targetReleaseId: PRIOR_RELEASE_ID,
    targetVersionId: PRIOR_VERSION_ID,
    requestedAt: NOW,
    ...overrides
  };
}

test("a live Alakazam publication snapshot exposes released exact customer controls", () => {
  const snapshot = projectAlakazamPublication(stored());
  assert.equal(snapshot.schema, ALAKAZAM_PUBLICATION_SCHEMA);
  assert.equal(snapshot.state, "released");
  assert.equal(snapshot.holdReason, null);
  assert.deepEqual(snapshot.actions, {
    publish: false,
    rollback: true,
    unpublish: true,
    rollbackTargetReleaseId: PRIOR_RELEASE_ID
  });
  assert.equal(snapshot.site.currentReleaseId, CURRENT_RELEASE_ID);
  assert.equal(snapshot.site.currentVersionId, CURRENT_VERSION_ID);
  assert.equal(snapshot.history.length, 2);
  assert.match(snapshot.snapshotDigest, /^[a-f0-9]{64}$/u);
});

test("an accepted version newer than the live release enables only its exact publish target", () => {
  const snapshot = projectAlakazamPublication(
    stored({
      site: {
        acceptedVersionId: NEXT_VERSION_ID,
        acceptedArtifactDigest: "c".repeat(64)
      }
    })
  );
  assert.equal(snapshot.actions.publish, true);
  assert.equal(snapshot.actions.rollback, true);
  assert.equal(snapshot.actions.unpublish, true);
});

test("a dark projection can request republish but never claims a live release", () => {
  const snapshot = projectAlakazamPublication(
    stored({
      site: {
        state: "dark",
        currentReleaseId: null,
        currentVersionId: null
      },
      history: [
        {
          releaseId: CURRENT_RELEASE_ID,
          versionId: CURRENT_VERSION_ID,
          artifactDigest: "a".repeat(64),
          releasedAt: "2026-08-08T13:30:00.000Z",
          isCurrent: false
        }
      ]
    })
  );
  assert.deepEqual(snapshot.actions, {
    publish: true,
    rollback: false,
    unpublish: false,
    rollbackTargetReleaseId: null
  });
});

test("changed authority hides a historical command without discarding its durable evidence", () => {
  const previous = projectAlakazamPublication(stored());
  const changed = projectAlakazamPublication(stored({
    site: {
      acceptedVersionId: NEXT_VERSION_ID,
      acceptedArtifactDigest: "c".repeat(64)
    },
    lastCommand: heldCommand(previous)
  }));
  assert.equal(changed.command, null);
  assert.notEqual(changed.snapshotDigest, previous.snapshotDigest);
  assert.equal(changed.actions.publish, true);
});

for (const state of [
  "queued",
  "processing",
  "applied",
  "reconciliation_required"
]) {
  test(`released publication snapshots preserve exact ${state} execution state`, () => {
    const initial = projectAlakazamPublication(stored());
    const snapshot = projectAlakazamPublication(stored({
      lastCommand: heldCommand(initial, {
        state,
        holdReason: null
      })
    }));
    assert.equal(snapshot.state, "released");
    assert.equal(snapshot.command.state, state);
    assert.equal(snapshot.command.holdReason, null);
  });
}

test("a second publication command is refused while exact execution is open", async () => {
  const initial = projectAlakazamPublication(stored());
  const queued = heldCommand(initial, {
    state: "queued",
    holdReason: null
  });
  const publication = createAlakazamPublicationService({
    repository: {
      async readiness() {
        return { ready: true };
      },
      async readCustomerPublication() {
        return { ...stored(), lastCommand: queued };
      },
      async recordCustomerPublicationCommand(input) {
        const current = { ...stored(), lastCommand: queued };
        createAlakazamPublicationCommand({
          scope: {
            tenantId: input.tenantId,
            customerId: input.customerId,
            actorId: input.actorId,
            projectId: input.projectId
          },
          publication: current,
          request: {
            commandId: input.commandId,
            action: input.action,
            snapshotDigest: input.snapshotDigest,
            targetReleaseId: input.targetReleaseId
          },
          requestedAt: input.requestedAt
        });
      }
    },
    clock: { now: () => new Date(NOW) }
  });
  await assert.rejects(
    publication.request(scope(), {
      commandId:
        "70000000-0000-4000-8000-000000000002",
      action: "unpublish",
      snapshotDigest: initial.snapshotDigest,
      targetReleaseId: null
    }),
    (error) =>
      error.code === "publication_command_pending" &&
      error.status === 409
  );
});

test("the service records rollback authorization once and returns a queued command", async () => {
  const source = stored();
  const initial = projectAlakazamPublication(source);
  const calls = [];
  const repository = {
    async readiness() {
      return {
        ready: true,
        authorization: true,
        providerEffects: true,
        state: "released"
      };
    },
    async readCustomerPublication(input) {
      calls.push(["read", structuredClone(input)]);
      return structuredClone(source);
    },
    async recordCustomerPublicationCommand(input) {
      calls.push(["record", structuredClone(input)]);
      const command = {
        commandId: input.commandId,
        action: input.action,
        state: "queued",
        holdReason: null,
        snapshotDigest: input.snapshotDigest,
        commandDigest: "d".repeat(64),
        targetReleaseId: input.targetReleaseId,
        targetVersionId: PRIOR_VERSION_ID,
        requestedAt: input.requestedAt
      };
      return {
        publication: {
          ...structuredClone(source),
          lastCommand: command
        },
        command
      };
    }
  };
  const publication = createAlakazamPublicationService({
    repository,
    clock: { now: () => new Date(NOW) }
  });
  assert.equal(
    (await publication.readiness()).providerEffects,
    true
  );
  const result = await publication.request(scope(), {
    commandId: COMMAND_ID,
    action: "rollback",
    snapshotDigest: initial.snapshotDigest,
    targetReleaseId: PRIOR_RELEASE_ID
  });
  assert.equal(result.command.commandId, COMMAND_ID);
  assert.equal(result.command.state, "queued");
  assert.equal(result.command.targetVersionId, PRIOR_VERSION_ID);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    ...scope(),
    commandId: COMMAND_ID,
    action: "rollback",
    snapshotDigest: initial.snapshotDigest,
    targetReleaseId: PRIOR_RELEASE_ID,
    requestedAt: NOW
  });
});

test("the service rejects a stale idempotent replay against changed authority", async () => {
  const source = stored();
  const previous = projectAlakazamPublication(source);
  const command = heldCommand(previous);
  const changed = stored({
    site: {
      acceptedVersionId: NEXT_VERSION_ID,
      acceptedArtifactDigest: "c".repeat(64)
    },
    lastCommand: command
  });
  const publication = createAlakazamPublicationService({
    repository: {
      async readiness() {
        return { ready: true };
      },
      async readCustomerPublication() {
        return changed;
      },
      async recordCustomerPublicationCommand() {
        return {
          publication: changed,
          command
        };
      }
    },
    clock: { now: () => new Date(NOW) }
  });
  await assert.rejects(
    publication.request(scope(), {
      commandId: COMMAND_ID,
      action: "rollback",
      snapshotDigest: previous.snapshotDigest,
      targetReleaseId: PRIOR_RELEASE_ID
    }),
    (error) =>
      error.code === "publication_authority_changed" &&
      error.status === 409
  );
});

test("the hosted boundary binds canonical customer scope and translates stale authority", async () => {
  const calls = [];
  const boundary = createHostedAlakazamPublication({
    publication: {
      async readiness() {
        return { authorization: true };
      },
      async read(input) {
        calls.push(["read", structuredClone(input)]);
        return { ok: true };
      },
      async request(input, command) {
        calls.push([
          "request",
          structuredClone(input),
          structuredClone(command)
        ]);
        return { state: "queued" };
      }
    },
    async resolveSession({ actor, projectId }) {
      return {
        tenantId: TENANT_ID,
        customerId: actor.userId,
        actorId: actor.userId,
        projectId
      };
    }
  });
  assert.deepEqual(
    await boundary.getSnapshot(
      { userId: CUSTOMER_ID },
      PROJECT_ID
    ),
    { ok: true }
  );
  assert.deepEqual(
    await boundary.requestCommand(
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      { action: "unpublish" }
    ),
    { state: "queued" }
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], scope());
});

test("the default hosted boundary authenticates before returning an explicit held response", async () => {
  const held = createHeldHostedAlakazamPublication();
  assert.deepEqual(await held.readiness(), {
    ready: false,
    authorization: false,
    providerEffects: false,
    state: "held"
  });
  await assert.rejects(
    held.getSnapshot(null, PROJECT_ID),
    (error) =>
      error.code === "AUTHENTICATION_REQUIRED" &&
      error.status === 401
  );
  await assert.rejects(
    held.requestCommand(
      { userId: CUSTOMER_ID },
      PROJECT_ID,
      {}
    ),
    (error) =>
      error.code === "ALAKAZAM_PUBLICATION_HELD" &&
      error.status === 503
  );
});
