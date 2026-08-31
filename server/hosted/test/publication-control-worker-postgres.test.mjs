import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createAlakazamFulfillmentAuthority
} from "../../commerce-v2/alakazam-fulfillment.mjs";
import {
  createPostgresPublicationControlWorkerRepository
} from "../publication-control-worker-postgres.mjs";

const IDS = Object.freeze({
  command: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  customer: "44444444-4444-4444-8444-444444444444",
  subscription: "55555555-5555-4555-8555-555555555555",
  version: "66666666-6666-4666-8666-666666666666",
  artifact: "77777777-7777-4777-8777-777777777777",
  effectiveArtifact: "88888888-8888-4888-8888-888888888888",
  screening: "99999999-9999-4999-8999-999999999999",
  address: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  operation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  release: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  request: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  receipt: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
});
const NOW = "2026-08-31T23:30:00.000Z";
const END = "2026-09-30T23:30:00.000Z";
const START = "2026-08-30T23:30:00.000Z";
const COMPILER = `sha256:${"1".repeat(64)}`;
const POLICY_ID = "SS-ALAKAZAM-POLICY-2026-08-31-V2";
const POLICY_DIGEST =
  "145892e43ab6f4a03ebbed84fd148633f9a4de9727ce4294a0eb9b08f329c320";

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function policyDigest() {
  return createAlakazamFulfillmentAuthority({
    tenantId: IDS.organization,
    customerId: IDS.customer,
    projectId: IDS.project,
    subscription: {
      tenantId: IDS.organization,
      customerId: IDS.customer,
      projectId: IDS.project,
      subscriptionId: IDS.subscription,
      tierId: "alakazam_25",
      status: "active",
      revision: 2,
      currentPeriodStartsAt: START,
      currentPeriodEndsAt: END,
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: 2,
    now: NOW
  }).policyDigest;
}

function claimRow(action = "publish") {
  const html = Buffer.from(
    "<!doctype html><html><body>published site</body></html>",
    "utf8"
  );
  return {
    command_id: IDS.command,
    organization_id: IDS.organization,
    project_id: IDS.project,
    customer_user_id: IDS.customer,
    action,
    release_state: "released",
    policy_id: POLICY_ID,
    policy_digest: POLICY_DIGEST,
    released_at: NOW,
    command_state: "held",
    project_lifecycle: "active",
    safety_state: "clear",
    subscription_status: "active",
    current_period_starts_at: START,
    current_period_ends_at: END,
    cancel_at_period_end: false,
    grace_ends_at: null,
    accepted_version_id: IDS.version,
    accepted_artifact_id: IDS.artifact,
    accepted_artifact_digest: sha("accepted"),
    source_artifact_digest: sha("accepted"),
    source_compiler_schema: "abracadabra.spark/v1",
    source_compiler_revision: COMPILER,
    version_state: "accepted_release",
    screening_id: IDS.screening,
    screening_artifact_digest: sha(html),
    screening_checker_revision: COMPILER,
    effective_artifact_digest: sha(html),
    stored_effective_digest: sha(html),
    html_bytes: html,
    licensed_address_id: IDS.address,
    licensed_hostname: "example.sitesourcery.me",
    address_kind: "licensed",
    address_state: "configured",
    address_hostname: "example.sitesourcery.me",
    entitlement_id: IDS.subscription,
    target_operation_id: IDS.operation,
    target_operation_subscription_revision: 2,
    target_operation_tier_id: "alakazam_25",
    target_policy_digest: policyDigest(),
    target_serving_revision: 0,
    authorized_release_id: IDS.release,
    release_request_id: IDS.request,
    projection_state: action === "publish" ? "dark" : "live",
    current_release_id: action === "publish" ? null : IDS.release,
    current_version_id: action === "publish" ? null : IDS.version,
    attempt_count: 1,
    lease_fence: 1,
    lease_expires_at: "2026-08-31T23:32:00.000Z"
  };
}

function authority(query) {
  return {
    kind: "canonical-postgres",
    async service(_options, work) {
      return work({ query });
    }
  };
}

test("publication execution storage readiness requires exact released V2", async () => {
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql, values) => {
      assert.match(sql, /hosted_publication_control_contract_v2/u);
      assert.deepEqual(values, [
        "canonical-publication-control-v2-released-leased",
        POLICY_ID,
        POLICY_DIGEST
      ]);
      return {
        rows: [{
          contract_ready: true,
          policy_ready: true,
          jobs_ready: true,
          receipts_ready: true
        }]
      };
    })
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "alakazam-publication-postgres",
    providerEffects: true,
    code: null
  });
});

test("publication job claim expires ambiguous leases and builds an exact proof", async () => {
  const statements = [];
  const row = claimRow("publish");
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql) => {
      statements.push(sql);
      if (sql.includes("set state = 'reconciliation_required'")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("with selected as")) {
        return { rowCount: 1, rows: [{ command_id: IDS.command }] };
      }
      if (sql.includes("select\n            job.*")) {
        return { rowCount: 1, rows: [row] };
      }
      throw new Error("unexpected query");
    })
  });
  const claimed = await repository.claimNext({
    workerId: "alakazam-publication-worker-one",
    observedAt: NOW,
    leaseSeconds: 120
  });
  assert.equal(claimed.action, "publish");
  assert.equal(claimed.releaseId, IDS.release);
  assert.equal(claimed.proof.releaseRequest.id, IDS.request);
  assert.equal(claimed.proof.entitlement.decision.policyDigest, policyDigest());
  assert.deepEqual(claimed.proof.artifact.htmlBytes, row.html_bytes);
  assert.equal(statements.length, 3);
});

test("unpublish claims contain no artifact proof", async () => {
  const row = claimRow("unpublish");
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql) => {
      if (sql.includes("with selected as")) {
        return { rowCount: 1, rows: [{ command_id: IDS.command }] };
      }
      if (sql.includes("select\n            job.*")) {
        return { rowCount: 1, rows: [row] };
      }
      return { rowCount: 0, rows: [] };
    })
  });
  const claimed = await repository.claimNext({
    workerId: "alakazam-publication-worker-one",
    observedAt: NOW,
    leaseSeconds: 120
  });
  assert.equal(claimed.proof, null);
  assert.equal(claimed.releaseId, null);
});

test("ambiguous completion is durably stopped for manual reconciliation", async () => {
  let receiptDigest = null;
  const updates = [];
  const row = {
    ...claimRow("publish"),
    leased_by: "alakazam-publication-worker-one"
  };
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql, values) => {
      if (sql.includes("for update of job")) {
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes("insert into ss.publication_control_execution_receipts")) {
        receiptDigest = values[7];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select result_digest")) {
        return { rowCount: 1, rows: [{ result_digest: receiptDigest }] };
      }
      if (sql.includes("update ss.publication_control_worker_jobs")) {
        updates.push(values);
        return { rowCount: 1, rows: [] };
      }
      throw new Error("unexpected query");
    })
  });
  const completed = await repository.completeClaim({
    jobId: IDS.command,
    fence: 1,
    workerId: "alakazam-publication-worker-one",
    observedAt: "2026-08-31T23:31:00.000Z",
    result: {
      receiptKind: "reconciliation_required",
      result: {
        action: "publish",
        providerRequestId: null,
        status: "unknown",
        published: null,
        replay: false,
        releaseId: IDS.release,
        manifestDigest: null,
        bindingRevision: null,
        failureCode: "PUBLICATION_COMMAND_AMBIGUOUS"
      }
    }
  });
  assert.equal(completed.status, "manual_review");
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], "PUBLICATION_COMMAND_AMBIGUOUS");
});

test("confirmed publication atomically records receipts and advances both projections", async () => {
  let receiptDigest = null;
  const statements = [];
  const row = {
    ...claimRow("publish"),
    leased_by: "alakazam-publication-worker-one"
  };
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql, values) => {
      statements.push(sql);
      if (sql.includes("for update of job")) {
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes("from ss.alakazam_fulfillment_projection")) {
        return { rowCount: 1, rows: [{ state: "dark", current_release_id: null }] };
      }
      if (sql.includes("from ss.project_serving_projection")) {
        return { rowCount: 1, rows: [{ state: "dark", current_release_id: null }] };
      }
      if (sql.includes("insert into ss.provider_receipts")) {
        return { rowCount: 1, rows: [{ id: IDS.receipt }] };
      }
      if (sql.includes("update ss.alakazam_fulfillment_projection")) {
        assert.equal(values[2], "live");
        assert.equal(values[3], IDS.release);
        return { rowCount: 1, rows: [{ project_id: IDS.project }] };
      }
      if (sql.includes("update ss.project_serving_projection")) {
        assert.equal(values[2], "live");
        assert.equal(values[3], IDS.release);
        return { rowCount: 1, rows: [{ project_id: IDS.project }] };
      }
      if (sql.includes("insert into ss.serving_events")) {
        assert.equal(values[3], "published");
        assert.equal(values[4], IDS.receipt);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("insert into ss.publication_control_execution_receipts")) {
        receiptDigest = values[7];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("select result_digest")) {
        return { rowCount: 1, rows: [{ result_digest: receiptDigest }] };
      }
      if (sql.includes("update ss.publication_control_worker_jobs")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error("unexpected query");
    })
  });
  const completed = await repository.completeClaim({
    jobId: IDS.command,
    fence: 1,
    workerId: "alakazam-publication-worker-one",
    observedAt: "2026-08-31T23:31:00.000Z",
    result: {
      receiptKind: "publication_applied",
      result: {
        action: "publish",
        providerRequestId: `selfhost:publish:${IDS.request}`,
        status: "released",
        published: true,
        replay: false,
        releaseId: IDS.release,
        manifestDigest: "f".repeat(64),
        bindingRevision: 1
      }
    }
  });
  assert.equal(completed.status, "completed");
  assert.equal(
    statements.some((sql) => sql.includes("insert into ss.serving_events")),
    true
  );
});

test("known no-effect failures release the lease for bounded retry", async () => {
  const repository = createPostgresPublicationControlWorkerRepository({
    authority: authority(async (sql) => {
      assert.match(sql, /attempt_count >= max_attempts/u);
      return { rowCount: 1, rows: [{ state: "failed" }] };
    })
  });
  assert.deepEqual(await repository.releaseClaim({
    jobId: IDS.command,
    fence: 1,
    workerId: "alakazam-publication-worker-one",
    failureCode: "PUBLICATION_COMMAND_UNAVAILABLE",
    observedAt: "2026-08-31T23:31:00.000Z",
    retryAt: "2026-08-31T23:31:05.000Z"
  }), {
    status: "released",
    jobId: IDS.command
  });
});
