import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAlakazamPublication
} from "../../commerce-v2/alakazam-publication.mjs";
import {
  createPostgresPublicationControlRepository
} from "../publication-control-postgres.mjs";

const IDS = Object.freeze({
  tenant: "11111111-1111-4111-8111-111111111111",
  customer: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  subscription: "44444444-4444-4444-8444-444444444444",
  operation: "55555555-5555-4555-8555-555555555555",
  intent: "66666666-6666-4666-8666-666666666666",
  release: "77777777-7777-4777-8777-777777777777",
  version: "88888888-8888-4888-8888-888888888888",
  artifact: "99999999-9999-4999-8999-999999999999",
  acceptance: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  screening: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  address: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  command: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
});
const NOW = "2026-08-31T23:40:00.000Z";
const DIGEST = "a".repeat(64);
const POLICY = "b".repeat(64);
const DECISION = "c".repeat(64);
const COMMAND_DIGEST = "d".repeat(64);

function evidenceRow(overrides = {}) {
  return {
    subscription_id: IDS.subscription,
    project_id: IDS.project,
    subscription_revision: 2,
    tier_id: "alakazam_25",
    subscription_status: "active",
    current_period_starts_at: "2026-08-30T23:00:00.000Z",
    current_period_ends_at: "2026-09-30T23:00:00.000Z",
    cancel_at_period_end: false,
    grace_ends_at: null,
    authority_operation_id: IDS.operation,
    projection_state: "dark",
    hostname: "sample.sitesourcery.me",
    current_release_id: null,
    updated_at: "2026-08-31T23:30:00.000Z",
    current_version_id: null,
    authority_intent_id: IDS.intent,
    authority_operation_kind: "start_activation",
    authority_capability: "publish_accepted_project_version",
    authority_tier_id: "alakazam_25",
    authority_policy_digest: POLICY,
    authority_serving_revision: 0,
    authority_release_id: IDS.release,
    authority_decision_digest: DECISION,
    target_operation_id: IDS.operation,
    target_intent_id: IDS.intent,
    target_subscription_id: IDS.subscription,
    target_subscription_revision: 2,
    target_operation_kind: "start_activation",
    target_capability: "publish_accepted_project_version",
    target_tier_id: "alakazam_25",
    target_policy_digest: POLICY,
    target_serving_revision: 0,
    target_decision_digest: DECISION,
    authorized_release_id: IDS.release,
    released_at: "2026-08-31T23:30:00.000Z",
    is_current: false,
    accepted_version_id: IDS.version,
    accepted_artifact_id: IDS.artifact,
    accepted_artifact_digest: DIGEST,
    acceptance_event_id: IDS.acceptance,
    accepted_at: "2026-08-31T23:20:00.000Z",
    screening_id: IDS.screening,
    screening_method: "alakazam_effective_policy",
    screening_artifact_digest: DIGEST,
    screening_checker_revision: `sha256:${"e".repeat(64)}`,
    screening_checked_at: "2026-08-31T23:25:00.000Z",
    licensed_address_id: IDS.address,
    licensed_hostname: "sample.sitesourcery.me",
    ...overrides
  };
}

function commandRow(executionState) {
  return {
    id: IDS.command,
    action: "publish",
    snapshot_digest: "f".repeat(64),
    command_digest: COMMAND_DIGEST,
    target_release_id: null,
    target_version_id: IDS.version,
    requested_at: NOW,
    release_state: executionState ? "released" : null,
    execution_state: executionState
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

test("publication repository readiness requires released V2 policy and storage", async () => {
  const repository = createPostgresPublicationControlRepository({
    legacyRepositoryFactory() {
      return { async readiness() { return { ready: true }; } };
    },
    authority: authority(async (sql, values) => {
      assert.match(sql, /hosted_publication_control_contract_v2/u);
      assert.equal(values[1], "canonical-publication-control-v2-released-leased");
      return {
        rowCount: 1,
        rows: [{
          exact_runtime_marker: true,
          exact_runtime_marker_v2: true,
          exact_released_policy: true,
          exact_v2_security: true,
          exact_table_security: true,
          exact_triggers: true,
          exact_constraints: true,
          exact_function_security: true
        }]
      };
    })
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    authorization: true,
    providerEffects: true,
    state: "released",
    holdReason: null,
    runtimeContract: "canonical-publication-control-v2-released-leased"
  });
});

for (const [storedState, exposedState] of [
  [null, "held"],
  ["queued", "queued"],
  ["failed", "queued"],
  ["running", "processing"],
  ["succeeded", "applied"],
  ["reconciliation_required", "reconciliation_required"]
]) {
  test(`publication repository projects ${storedState ?? "legacy"} as ${exposedState}`, async () => {
    let call = 0;
    const row = evidenceRow();
    const repository = createPostgresPublicationControlRepository({
      authority: authority(async () => {
        call += 1;
        if (call === 1) return { rowCount: 1, rows: [row] };
        if (call === 2) return { rowCount: 1, rows: [row] };
        if (call === 3) {
          return { rowCount: 1, rows: [commandRow(storedState)] };
        }
        throw new Error("unexpected query");
      })
    });
    const result = await repository.readCustomerPublication({
      tenantId: IDS.tenant,
      customerId: IDS.customer,
      actorId: IDS.customer,
      projectId: IDS.project
    });
    assert.equal(result.lastCommand.state, exposedState);
    assert.equal(
      result.lastCommand.holdReason,
      exposedState === "held"
        ? "commercial_cutover_not_authorized"
        : null
    );
  });
}

test("one new exact command atomically adds released authority and one queued worker job", async () => {
  const row = evidenceRow();
  const rawPublication = {
    projectId: IDS.project,
    subscription: {
      subscriptionId: IDS.subscription,
      revision: 2,
      tierId: "alakazam_25",
      status: "active"
    },
    site: {
      hostname: row.hostname,
      state: "dark",
      acceptedVersionId: IDS.version,
      acceptedArtifactDigest: DIGEST,
      currentReleaseId: null,
      currentVersionId: null,
      updatedAt: row.updated_at
    },
    history: [{
      releaseId: IDS.release,
      versionId: IDS.version,
      artifactDigest: DIGEST,
      releasedAt: row.released_at,
      isCurrent: false
    }],
    lastCommand: null
  };
  const snapshot = projectAlakazamPublication(rawPublication);
  const inserts = [];
  let selection = 0;
  const repository = createPostgresPublicationControlRepository({
    authority: authority(async (sql, values) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("for update of command")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from ss.projects project")) {
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes("from ss.alakazam_subscriptions subscription")) {
        return { rowCount: 1, rows: [row] };
      }
      if (sql.includes("from ss.publication_control_commands command") &&
          !sql.includes("insert into")) {
        selection += 1;
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from ss.alakazam_customer_publication_commands")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("from ss.publication_control_worker_jobs job") &&
          sql.includes("as present")) {
        return { rowCount: 1, rows: [{ present: false }] };
      }
      if (sql.includes("insert into ss.publication_control_commands")) {
        return {
          rowCount: 1,
          rows: [{
            ...commandRow("queued"),
            snapshot_digest: snapshot.snapshotDigest,
            command_digest: values[47]
          }]
        };
      }
      if (sql.includes("insert into ss.publication_control_releases")) {
        inserts.push(["release", values]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("insert into ss.publication_control_worker_jobs")) {
        inserts.push(["job", values]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query ${sql.slice(0, 80)}`);
    })
  });
  const result = await repository.recordCustomerPublicationCommand({
    tenantId: IDS.tenant,
    customerId: IDS.customer,
    actorId: IDS.customer,
    projectId: IDS.project,
    commandId: IDS.command,
    action: "publish",
    snapshotDigest: snapshot.snapshotDigest,
    targetReleaseId: null,
    requestedAt: NOW
  });
  assert.equal(result.command.state, "queued");
  assert.equal(result.command.holdReason, null);
  assert.deepEqual(inserts.map(([kind]) => kind), ["release", "job"]);
  assert.equal(inserts[0][1][5], "SS-ALAKAZAM-POLICY-2026-08-31-V2");
  assert.equal(inserts[1][1][3], NOW);
  assert.equal(selection, 1);
});
