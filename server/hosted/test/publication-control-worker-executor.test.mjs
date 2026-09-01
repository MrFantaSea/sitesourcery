import assert from "node:assert/strict";
import test from "node:test";

import { HostedError } from "../errors.mjs";
import {
  createPublicationControlWorkerExecutor
} from "../publication-control-worker-executor.mjs";

const IDS = Object.freeze({
  commandId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  releaseId: "33333333-3333-4333-8333-333333333333"
});
const MANIFEST = "a".repeat(64);

function claim(action) {
  return {
    jobId: IDS.commandId,
    projectId: IDS.projectId,
    action,
    hostname: "example.sitesourcery.me",
    fence: 1,
    attemptCount: 1,
    releaseId: action === "unpublish" ? null : IDS.releaseId,
    proof: action === "unpublish" ? null : { exact: true }
  };
}

function port(overrides = {}) {
  const released = (operation) => ({
    providerRequestId: `selfhost:${operation}:request-one`,
    status: "released",
    published: true,
    replay: false,
    releaseId: IDS.releaseId,
    manifestDigest: MANIFEST,
    bindingRevision: 4
  });
  return {
    async readiness() {
      return { ready: true, held: false };
    },
    async request() {
      return released("publish");
    },
    async rollback() {
      return released("rollback");
    },
    async unpublish() {
      return {
        providerRequestId:
          `selfhost:unpublish:${IDS.projectId}:example.sitesourcery.me`,
        status: "unpublished",
        published: false,
        replay: false,
        bindingRevision: 5
      };
    },
    ...overrides
  };
}

test("publication executor requires a released private port", async () => {
  const executor = createPublicationControlWorkerExecutor({
    publicationPort: port({
      async readiness() {
        return { ready: true, held: true };
      }
    })
  });
  assert.deepEqual(await executor.readiness(), {
    ready: false,
    verified: false,
    providerEffects: false,
    code: "PUBLICATION_CONTROL_PORT_NOT_RELEASED"
  });
});

for (const action of ["publish", "rollback", "unpublish"]) {
  test(`publication executor confirms exact ${action} effects`, async () => {
    const executor = createPublicationControlWorkerExecutor({
      publicationPort: port()
    });
    const completed = await executor.execute(claim(action));
    assert.equal(completed.receiptKind, "publication_applied");
    assert.equal(completed.result.action, action);
    assert.equal(
      completed.result.published,
      action === "unpublish" ? false : true
    );
    assert.equal(
      completed.result.releaseId,
      action === "unpublish" ? null : IDS.releaseId
    );
  });
}

test("publication executor stops ambiguous transport effects for reconciliation", async () => {
  const executor = createPublicationControlWorkerExecutor({
    publicationPort: port({
      async request() {
        throw new HostedError(
          "PUBLICATION_COMMAND_AMBIGUOUS",
          "ambiguous",
          {
            status: 503,
            details: { effectCertainty: "unknown" }
          }
        );
      }
    })
  });
  const completed = await executor.execute(claim("publish"));
  assert.equal(completed.receiptKind, "reconciliation_required");
  assert.equal(completed.result.status, "unknown");
  assert.equal(
    completed.result.failureCode,
    "PUBLICATION_COMMAND_AMBIGUOUS"
  );
});

test("publication executor retries only effects known not to have started", async () => {
  const error = new HostedError(
    "PUBLICATION_COMMAND_UNAVAILABLE",
    "not connected",
    { status: 503, details: { effectCertainty: "none" } }
  );
  const executor = createPublicationControlWorkerExecutor({
    publicationPort: port({
      async rollback() {
        throw error;
      }
    })
  });
  await assert.rejects(
    executor.execute(claim("rollback")),
    (caught) => caught === error
  );
});
