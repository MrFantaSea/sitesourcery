import {
  createAlakazamFulfillmentAuthority,
  createAlakazamFulfillmentDecision
} from "../commerce-v2/alakazam-fulfillment.mjs";
import { invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const PURPOSE = "alakazam-publication";
const CONTRACT = "canonical-publication-control-v2-released-leased";
const POLICY_ID = "SS-ALAKAZAM-POLICY-2026-08-31-V2";
const POLICY_DIGEST =
  "145892e43ab6f4a03ebbed84fd148633f9a4de9727ce4294a0eb9b08f329c320";
const WORKER = /^alakazam-publication-[A-Za-z0-9.-]{8,160}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;

function iso(value, field) {
  const selected = value instanceof Date ? value.toISOString() : value;
  invariant(
    typeof selected === "string" && Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "PUBLICATION_CONTROL_WORKER_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function integer(value, field, minimum = 0) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) && selected >= minimum,
    "PUBLICATION_CONTROL_WORKER_REPOSITORY_INVALID",
    `${field} is invalid.`,
    { status: 500 }
  );
  return selected;
}

function exactWorker(value) {
  invariant(
    typeof value === "string" && WORKER.test(value),
    "PUBLICATION_CONTROL_WORKER_INVALID",
    "The publication-control worker identity is invalid.",
    { status: 400 }
  );
  return value;
}

function exactClaimRow(row, claimedAt) {
  invariant(
    row && UUID.test(row.command_id) && UUID.test(row.organization_id) &&
      UUID.test(row.project_id) && UUID.test(row.customer_user_id) &&
      ["publish", "rollback", "unpublish"].includes(row.action) &&
      row.release_state === "released" && row.policy_id === POLICY_ID &&
      row.policy_digest === POLICY_DIGEST &&
      row.command_state === "held" && row.project_lifecycle === "active" &&
      row.safety_state === "clear" &&
      row.version_state === "accepted_release" &&
      row.address_kind === "licensed" && row.address_state === "configured" &&
      row.address_hostname === row.licensed_hostname &&
      row.subscription_status &&
      ["active", "grace"].includes(row.subscription_status) &&
      Date.parse(iso(row.current_period_ends_at, "paid period end")) >
        Date.parse(claimedAt) &&
      (
        row.subscription_status !== "grace" ||
        Date.parse(iso(row.grace_ends_at, "grace end")) >
          Date.parse(claimedAt)
      ) &&
      row.source_artifact_digest === row.accepted_artifact_digest &&
      row.effective_artifact_digest === row.screening_artifact_digest &&
      row.effective_artifact_digest === row.stored_effective_digest &&
      Buffer.isBuffer(row.html_bytes),
    "PUBLICATION_CONTROL_EVIDENCE_CHANGED",
    "The exact publication authority changed before execution.",
    { status: 409 }
  );

  const targetRevision = integer(
    row.target_operation_subscription_revision,
    "target subscription revision",
    1
  );
  const authority = createAlakazamFulfillmentAuthority({
    tenantId: row.organization_id,
    customerId: row.customer_user_id,
    projectId: row.project_id,
    subscription: {
      tenantId: row.organization_id,
      customerId: row.customer_user_id,
      projectId: row.project_id,
      subscriptionId: row.entitlement_id,
      tierId: row.target_operation_tier_id,
      status: row.subscription_status,
      revision: targetRevision,
      currentPeriodStartsAt: iso(
        row.current_period_starts_at,
        "paid period start"
      ),
      currentPeriodEndsAt: iso(
        row.current_period_ends_at,
        "paid period end"
      ),
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
      graceEndsAt: row.grace_ends_at === null
        ? null
        : iso(row.grace_ends_at, "grace end"),
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: targetRevision,
    now: iso(row.released_at, "publication release time")
  });
  invariant(
    authority.policyDigest === row.target_policy_digest,
    "PUBLICATION_CONTROL_EVIDENCE_CHANGED",
    "The target publication policy changed before execution.",
    { status: 409 }
  );
  const sourceVersion = Object.freeze({
    versionId: row.accepted_version_id,
    state: "accepted_release",
    artifactDigest: row.source_artifact_digest,
    compilerSchema: row.source_compiler_schema,
    compilerRevision: row.source_compiler_revision
  });
  const address = Object.freeze({
    tenantId: row.organization_id,
    projectId: row.project_id,
    addressId: row.licensed_address_id,
    kind: "licensed",
    state: "configured",
    hostname: row.licensed_hostname
  });
  const decision = createAlakazamFulfillmentDecision({
    operationId: row.target_operation_id,
    authority,
    capability: "publish_accepted_project_version",
    sourceVersion,
    publicationArtifact: {
      artifactDigest: row.effective_artifact_digest,
      compilerSchema: "abracadabra.spark/v1",
      compilerRevision: row.screening_checker_revision,
      policyDigest: authority.policyDigest,
      screeningId: row.screening_id,
      screeningStage: "pre_publication",
      screeningPassed: true,
      screeningArtifactDigest: row.screening_artifact_digest
    },
    address,
    servingRevision: integer(
      row.target_serving_revision,
      "target serving revision"
    ),
    now: iso(row.released_at, "publication decision time")
  });
  const releaseId = row.action === "unpublish"
    ? null
    : row.authorized_release_id;
  const proof = row.action === "unpublish"
    ? null
    : Object.freeze({
        organizationId: row.organization_id,
        projectId: row.project_id,
        releaseId,
        project: Object.freeze({
          id: row.project_id,
          organizationId: row.organization_id,
          lifecycle: "active",
          safetyState: "clear"
        }),
        releaseRequest: Object.freeze({
          id: row.release_request_id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          versionId: row.accepted_version_id,
          addressId: row.licensed_address_id,
          prepublicationScreeningId: row.screening_id
        }),
        version: sourceVersion,
        screening: Object.freeze({
          id: row.screening_id,
          versionId: row.accepted_version_id,
          stage: "pre_publication",
          passed: true,
          artifactDigest: row.screening_artifact_digest
        }),
        entitlement: Object.freeze({
          kind: "alakazam",
          organizationId: row.organization_id,
          projectId: row.project_id,
          subscriptionId: row.entitlement_id,
          subscriptionRevision: targetRevision,
          status: row.subscription_status,
          graceEndsAt: row.grace_ends_at === null
            ? null
            : iso(row.grace_ends_at, "grace end"),
          decision
        }),
        address: Object.freeze({
          id: row.licensed_address_id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          kind: "licensed",
          state: "configured",
          verified: true,
          hostname: row.licensed_hostname
        }),
        artifact: Object.freeze({
          htmlBytes: Buffer.from(row.html_bytes),
          sha256: row.effective_artifact_digest,
          compilerSchema: "abracadabra.spark/v1",
          compilerRevision: row.screening_checker_revision
        })
      });
  return Object.freeze({
    schema: "sitesourcery.publication-control-worker-claim/v2",
    jobId: row.command_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    action: row.action,
    hostname: row.licensed_hostname,
    attemptCount: integer(row.attempt_count, "attempt count", 1),
    fence: integer(row.lease_fence, "lease fence", 1),
    leaseExpiresAt: iso(row.lease_expires_at, "lease expiration"),
    releaseId,
    proof
  });
}

function resultReceipt(value) {
  invariant(
    value && typeof value === "object" &&
      ["publication_applied", "reconciliation_required"]
        .includes(value.receiptKind) &&
      value.result && typeof value.result === "object" &&
      !Array.isArray(value.result),
    "PUBLICATION_CONTROL_RESULT_INVALID",
    "The publication-control result is invalid.",
    { status: 409 }
  );
  return value;
}

export function createPostgresPublicationControlWorkerRepository({
  authority
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "PUBLICATION_CONTROL_WORKER_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );

  async function readiness() {
    try {
      const proof = await authority.service(
        { actorKind: "system", readOnly: true },
        (client) => client.query(`
          select
            ss.hosted_publication_control_contract_v2() = $1
              as contract_ready,
            exists (
              select 1 from ss.alakazam_policy_releases
               where policy_id = $2 and policy_digest = $3
                 and state = 'released' and provider_effects
                 and publication_effects
            ) as policy_ready,
            to_regclass('ss.publication_control_worker_jobs') is not null
              as jobs_ready,
            to_regclass('ss.publication_control_execution_receipts') is not null
              as receipts_ready
        `, [CONTRACT, POLICY_ID, POLICY_DIGEST])
      );
      const row = proof.rows[0] ?? {};
      const ready = Object.values(row).every((value) => value === true);
      return Object.freeze({
        ready,
        verified: ready,
        kind: `${PURPOSE}-postgres`,
        providerEffects: ready,
        code: ready ? null : "PUBLICATION_CONTROL_STORAGE_NOT_READY"
      });
    } catch {
      return Object.freeze({
        ready: false,
        verified: false,
        kind: `${PURPOSE}-postgres`,
        providerEffects: false,
        code: "PUBLICATION_CONTROL_STORAGE_NOT_READY"
      });
    }
  }

  async function claimNext({ workerId, observedAt, leaseSeconds } = {}) {
    const worker = exactWorker(workerId);
    const at = iso(observedAt, "publication claim time");
    invariant(
      Number.isSafeInteger(leaseSeconds) &&
        leaseSeconds >= 30 && leaseSeconds <= 300,
      "PUBLICATION_CONTROL_WORKER_INVALID",
      "The publication-control lease is invalid.",
      { status: 400 }
    );
    return authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        await client.query(`
          update ss.publication_control_worker_jobs
             set state = 'reconciliation_required',
                 failure_code = 'PUBLICATION_CONTROL_LEASE_EXPIRED',
                 manual_review_at = $1,
                 leased_by = null, leased_at = null,
                 lease_expires_at = null, updated_at = $1
           where state = 'running' and lease_expires_at <= $1
        `, [at]);
        const claimed = await client.query(`
          with selected as (
            select command_id
              from ss.publication_control_worker_jobs
             where state in ('queued', 'failed')
               and run_at <= $1 and attempt_count < max_attempts
             order by run_at, command_id
             for update skip locked
             limit 1
          )
          update ss.publication_control_worker_jobs job
             set state = 'running',
                 attempt_count = job.attempt_count + 1,
                 lease_fence = job.lease_fence + 1,
                 leased_by = $2, leased_at = $1,
                 lease_expires_at = $1 + make_interval(secs => $3),
                 failure_code = null, manual_review_at = null,
                 updated_at = $1
            from selected
           where job.command_id = selected.command_id
          returning job.command_id
        `, [at, worker, leaseSeconds]);
        if (claimed.rowCount === 0) return null;
        const selected = await client.query(`
          select
            job.*,
            release.state as release_state,
            release.policy_id,
            release.policy_digest,
            release.released_at,
            command.state as command_state,
            command.action,
            command.customer_user_id,
            command.entitlement_id,
            command.accepted_version_id,
            command.accepted_artifact_id,
            command.accepted_artifact_digest,
            command.screening_id,
            command.screening_artifact_digest,
            command.screening_checker_revision,
            command.licensed_address_id,
            command.licensed_hostname,
            command.target_operation_id,
            command.target_operation_subscription_revision,
            command.target_operation_tier_id,
            command.target_policy_digest,
            command.target_serving_revision,
            command.authorized_release_id,
            command.projection_state,
            command.current_release_id,
            command.current_version_id,
            project.lifecycle as project_lifecycle,
            safety.state as safety_state,
            subscription.status as subscription_status,
            subscription.current_period_starts_at,
            subscription.current_period_ends_at,
            subscription.cancel_at_period_end,
            subscription.grace_ends_at,
            version.compiler_schema as source_compiler_schema,
            version.compiler_revision as source_compiler_revision,
            version_state.state as version_state,
            source_artifact.artifact_digest as source_artifact_digest,
            effective_artifact.artifact_digest as stored_effective_digest,
            effective_artifact.html_bytes,
            target_operation.effective_artifact_digest,
            target_operation.release_request_id,
            address.kind as address_kind,
            address.state as address_state,
            address.serving_hostname as address_hostname
          from ss.publication_control_worker_jobs job
          join ss.publication_control_releases release
            on release.organization_id = job.organization_id
           and release.command_id = job.command_id
          join ss.publication_control_commands command
            on command.organization_id = release.organization_id
           and command.id = release.command_id
          join ss.projects project
            on project.organization_id = command.organization_id
           and project.id = command.project_id
          join ss.project_safety_projection safety
            on safety.organization_id = project.organization_id
           and safety.project_id = project.id
          join ss.alakazam_subscriptions subscription
            on subscription.organization_id = command.organization_id
           and subscription.project_id = command.project_id
           and subscription.id = command.entitlement_id
           and subscription.customer_user_id = command.customer_user_id
           and subscription.revision = command.entitlement_revision
          join ss.alakazam_fulfillment_operations target_operation
            on target_operation.organization_id = command.organization_id
           and target_operation.project_id = command.project_id
           and target_operation.id = command.target_operation_id
           and target_operation.state = 'published'
          join ss.site_versions version
            on version.organization_id = command.organization_id
           and version.project_id = command.project_id
           and version.id = command.accepted_version_id
           and version.artifact_id = command.accepted_artifact_id
          join ss.version_state_projection version_state
            on version_state.organization_id = version.organization_id
           and version_state.project_id = version.project_id
           and version_state.version_id = version.id
          join ss.artifacts source_artifact
            on source_artifact.organization_id = version.organization_id
           and source_artifact.id = version.artifact_id
          join ss.artifacts effective_artifact
            on effective_artifact.organization_id = target_operation.organization_id
           and effective_artifact.id = target_operation.effective_artifact_id
          join ss.project_addresses address
            on address.organization_id = command.organization_id
           and address.project_id = command.project_id
           and address.id = command.licensed_address_id
          join ss.project_address_projection address_projection
            on address_projection.organization_id = address.organization_id
           and address_projection.project_id = address.project_id
           and address_projection.current_address_id = address.id
         where job.command_id = $1 and job.state = 'running'
           and job.leased_by = $2 and job.lease_expires_at > $3
        `, [claimed.rows[0].command_id, worker, at]);
        invariant(
          selected.rowCount === 1,
          "PUBLICATION_CONTROL_EVIDENCE_CHANGED",
          "The exact publication job became unavailable.",
          { status: 409 }
        );
        return exactClaimRow(selected.rows[0], at);
      }
    );
  }

  async function recordReceipt(client, row, receiptKind, result, at) {
    const resultFacts = {
      schema: "sitesourcery.publication-control-execution-receipt/v2",
      commandId: row.command_id,
      action: row.action,
      leaseFence: integer(row.lease_fence, "lease fence", 1),
      receiptKind,
      result,
      recordedAt: at
    };
    const resultDigest = digest(resultFacts);
    await client.query(`
      insert into ss.publication_control_execution_receipts (
        organization_id, project_id, command_id, lease_fence,
        receipt_kind, provider_request_id, provider_result,
        result_digest, recorded_at
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      on conflict (command_id) do nothing
    `, [
      row.organization_id,
      row.project_id,
      row.command_id,
      row.lease_fence,
      receiptKind,
      result.providerRequestId ?? null,
      JSON.stringify(result),
      resultDigest,
      at
    ]);
    const stored = await client.query(`
      select result_digest
        from ss.publication_control_execution_receipts
       where command_id = $1
    `, [row.command_id]);
    invariant(
      stored.rowCount === 1 && stored.rows[0].result_digest === resultDigest,
      "PUBLICATION_CONTROL_RECEIPT_CONFLICT",
      "The durable publication receipt changed.",
      { status: 500 }
    );
    return resultDigest;
  }

  async function completeClaim({
    jobId, fence, workerId, observedAt, result: suppliedResult
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0,
      "PUBLICATION_CONTROL_WORKER_INVALID",
      "The publication-control completion identity is invalid.",
      { status: 400 }
    );
    const worker = exactWorker(workerId);
    const at = iso(observedAt, "publication completion time");
    const completed = resultReceipt(suppliedResult);
    return authority.service(
      { actorKind: "system", isolation: "serializable" },
      async (client) => {
        const locked = await client.query(`
          select job.*, command.action, command.projection_state,
                 command.current_release_id, command.current_version_id,
                 command.target_operation_id,
                 command.target_operation_tier_id,
                 command.target_operation_subscription_revision,
                 command.authorized_release_id,
                 command.licensed_hostname
            from ss.publication_control_worker_jobs job
            join ss.publication_control_commands command
              on command.organization_id = job.organization_id
             and command.id = job.command_id
           where job.command_id = $1 and job.state = 'running'
             and job.leased_by = $2 and job.lease_fence = $3
             and job.lease_expires_at > $4
           for update of job
        `, [jobId, worker, fence, at]);
        invariant(
          locked.rowCount === 1,
          "PUBLICATION_CONTROL_WORKER_LEASE_LOST",
          "The publication-control lease is no longer current.",
          { status: 409 }
        );
        const row = locked.rows[0];
        invariant(
          completed.result.action === row.action,
          "PUBLICATION_CONTROL_RESULT_INVALID",
          "The publication result action changed.",
          { status: 409 }
        );
        if (completed.receiptKind === "reconciliation_required") {
          const resultDigest = await recordReceipt(
            client, row, completed.receiptKind, completed.result, at
          );
          await client.query(`
            update ss.publication_control_worker_jobs
               set state = 'reconciliation_required',
                   failure_code = $2, provider_result_digest = $3,
                   manual_review_at = $4,
                   leased_by = null, leased_at = null,
                   lease_expires_at = null, updated_at = $4
             where command_id = $1
          `, [
            row.command_id,
            completed.result.failureCode ??
              "PUBLICATION_CONTROL_EFFECT_AMBIGUOUS",
            resultDigest,
            at
          ]);
          return Object.freeze({
            status: "manual_review",
            jobId: row.command_id,
            resultDigest
          });
        }
        invariant(
          typeof completed.result.providerRequestId === "string" &&
            completed.result.providerRequestId.length > 0 &&
            (
              row.action === "unpublish"
                ? completed.result.status === "unpublished" &&
                  completed.result.published === false &&
                  completed.result.releaseId === null
                : completed.result.status === "released" &&
                  completed.result.published === true &&
                  completed.result.releaseId === row.authorized_release_id
            ),
          "PUBLICATION_CONTROL_RESULT_INVALID",
          "The publication effect does not match its exact command.",
          { status: 409 }
        );
        const projection = await client.query(`
          select state, current_release_id
            from ss.alakazam_fulfillment_projection
           where organization_id = $1 and project_id = $2
           for update
        `, [row.organization_id, row.project_id]);
        const serving = await client.query(`
          select state, current_release_id
            from ss.project_serving_projection
           where organization_id = $1 and project_id = $2
           for update
        `, [row.organization_id, row.project_id]);
        const projectionExact = projection.rowCount === 1 &&
          projection.rows[0].state === row.projection_state &&
          projection.rows[0].current_release_id === row.current_release_id &&
          serving.rowCount === 1 &&
          serving.rows[0].current_release_id === row.current_release_id;
        if (!projectionExact) {
          const reconciliation = Object.freeze({
            ...completed.result,
            failureCode: "PUBLICATION_CONTROL_PROJECTION_CHANGED"
          });
          const resultDigest = await recordReceipt(
            client, row, "reconciliation_required", reconciliation, at
          );
          await client.query(`
            update ss.publication_control_worker_jobs
               set state = 'reconciliation_required',
                   failure_code = 'PUBLICATION_CONTROL_PROJECTION_CHANGED',
                   provider_request_id = $2,
                   provider_result_digest = $3,
                   manual_review_at = $4,
                   leased_by = null, leased_at = null,
                   lease_expires_at = null, updated_at = $4
             where command_id = $1
          `, [row.command_id, completed.result.providerRequestId, resultDigest, at]);
          return Object.freeze({
            status: "manual_review",
            jobId: row.command_id,
            resultDigest
          });
        }
        const providerFacts = {
          schema: "sitesourcery.publication-control-provider-receipt/v2",
          commandId: row.command_id,
          action: row.action,
          result: completed.result
        };
        const providerDigest = digest(providerFacts);
        const providerExternalRef =
          `${completed.result.providerRequestId}:command:${row.command_id}`;
        const providerReceipt = await client.query(`
          insert into ss.provider_receipts (
            organization_id, project_id, provider_code, receipt_kind,
            external_object_ref, facts, facts_digest, occurred_at
          ) values (
            $1, $2, 'sitesourcery-selfhost',
            'publication_control_applied', $3, $4::jsonb, $5, $6
          )
          on conflict (provider_code, receipt_kind, external_object_ref)
          do nothing
          returning id
        `, [
          row.organization_id,
          row.project_id,
          providerExternalRef,
          JSON.stringify(providerFacts),
          providerDigest,
          at
        ]);
        let providerReceiptId = providerReceipt.rows[0]?.id;
        if (!providerReceiptId) {
          const replay = await client.query(`
            select id, facts_digest from ss.provider_receipts
             where provider_code = 'sitesourcery-selfhost'
               and receipt_kind = 'publication_control_applied'
               and external_object_ref = $1
          `, [providerExternalRef]);
          invariant(
            replay.rowCount === 1 &&
              replay.rows[0].facts_digest === providerDigest,
            "PUBLICATION_CONTROL_RECEIPT_CONFLICT",
            "The provider publication receipt changed.",
            { status: 500 }
          );
          providerReceiptId = replay.rows[0].id;
        }
        const nextReleaseId = row.action === "unpublish"
          ? row.current_release_id
          : row.authorized_release_id;
        const nextState = row.action === "unpublish" ? "dark" : "live";
        const updatedProjection = await client.query(`
          update ss.alakazam_fulfillment_projection
             set operation_id = case when $5 = 'unpublish'
                   then operation_id else $6 end,
                 state = $3, current_release_id = $4,
                 effective_tier_id = case when $5 = 'unpublish'
                   then effective_tier_id else $7 end,
                 subscription_revision = case when $5 = 'unpublish'
                   then subscription_revision else $8 end,
                 last_failure_code = null, updated_at = $9
           where organization_id = $1 and project_id = $2
             and state = $10
             and current_release_id is not distinct from $11
          returning project_id
        `, [
          row.organization_id, row.project_id, nextState, nextReleaseId,
          row.action, row.target_operation_id,
          row.target_operation_tier_id,
          row.target_operation_subscription_revision,
          at, row.projection_state, row.current_release_id
        ]);
        invariant(
          updatedProjection.rowCount === 1,
          "PUBLICATION_CONTROL_PROJECTION_CHANGED",
          "The publication projection changed before commit.",
          { status: 409 }
        );
        const updatedServing = await client.query(`
          update ss.project_serving_projection
             set state = $3,
                 previous_release_id = case when $4 is distinct from current_release_id
                   then current_release_id else previous_release_id end,
                 current_release_id = $4,
                 resume_state = case when $3 = 'live' then 'live' else resume_state end,
                 updated_at = $5
           where organization_id = $1 and project_id = $2
             and current_release_id is not distinct from $6
          returning project_id
        `, [
          row.organization_id, row.project_id, nextState,
          nextReleaseId, at, row.current_release_id
        ]);
        invariant(
          updatedServing.rowCount === 1,
          "PUBLICATION_CONTROL_PROJECTION_CHANGED",
          "The serving projection changed before commit.",
          { status: 409 }
        );
        await client.query(`
          insert into ss.serving_events (
            organization_id, project_id, release_id,
            event_kind, source_receipt_id, occurred_at
          ) values ($1, $2, $3, $4, $5, $6)
        `, [
          row.organization_id,
          row.project_id,
          nextReleaseId,
          row.action === "unpublish" ? "unpublished" : "published",
          providerReceiptId,
          at
        ]);
        const resultDigest = await recordReceipt(
          client, row, "publication_applied", completed.result, at
        );
        await client.query(`
          update ss.publication_control_worker_jobs
             set state = 'succeeded', failure_code = null,
                 provider_request_id = $2,
                 provider_result_digest = $3, completed_at = $4,
                 manual_review_at = null,
                 leased_by = null, leased_at = null,
                 lease_expires_at = null, updated_at = $4
           where command_id = $1
        `, [row.command_id, completed.result.providerRequestId, resultDigest, at]);
        return Object.freeze({
          status: "completed",
          jobId: row.command_id,
          resultDigest
        });
      }
    );
  }

  async function releaseClaim({
    jobId, fence, workerId, failureCode, observedAt, retryAt
  } = {}) {
    invariant(
      UUID.test(jobId ?? "") && Number.isSafeInteger(fence) && fence > 0 &&
        CODE.test(failureCode ?? ""),
      "PUBLICATION_CONTROL_WORKER_INVALID",
      "The publication-control release is invalid.",
      { status: 400 }
    );
    const worker = exactWorker(workerId);
    const at = iso(observedAt, "publication failure time");
    const retry = iso(retryAt, "publication retry time");
    const released = await authority.service(
      { actorKind: "system", isolation: "serializable" },
      (client) => client.query(`
        update ss.publication_control_worker_jobs
           set state = case when attempt_count >= max_attempts
                 then 'reconciliation_required' else 'failed' end,
               run_at = $5, failure_code = $4,
               manual_review_at = case when attempt_count >= max_attempts
                 then $6::timestamptz else null end,
               leased_by = null, leased_at = null,
               lease_expires_at = null, updated_at = $6
         where command_id = $1 and state = 'running'
           and leased_by = $2 and lease_fence = $3
           and lease_expires_at > $6
        returning state
      `, [jobId, worker, fence, failureCode, retry, at])
    );
    invariant(
      released.rowCount === 1,
      "PUBLICATION_CONTROL_WORKER_LEASE_LOST",
      "The publication-control lease is no longer current.",
      { status: 409 }
    );
    return Object.freeze({
      status: released.rows[0].state === "reconciliation_required"
        ? "manual_review"
        : "released",
      jobId
    });
  }

  return Object.freeze({
    kind: `${PURPOSE}-postgres`,
    readiness,
    claimNext,
    completeClaim,
    releaseClaim
  });
}
