import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST,
  createAdjacentIntegrationService
} from "../../hosted/adjacent-integration.mjs";
import {
  createPostgresAdjacentIntegrationRepository
} from "../../hosted/adjacent-integration-postgres.mjs";
import {
  createPostgresOperatorWorkQueueRepository
} from "../../hosted/operator-work-queue-postgres.mjs";
import {
  createCanonicalPostgresAuthority
} from "../../hosted/repository-postgres.mjs";

async function expectCode(work, code) {
  let selected;
  try {
    await work();
  } catch (error) {
    selected = error;
  }
  assert.ok(selected, `expected ${code}`);
  assert.equal(selected.code, code);
}

function opaque(character) {
  return character.repeat(64);
}

export async function verifyAdjacentIntegrationPostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const direct = (await pool.query(`
    select opportunity.id as opportunity_id,
           engagement.id as engagement_id,
           engagement.organization_id, engagement.project_id
      from ss.service_custom_build_direct_opportunities opportunity
      join ss.customer_engagements engagement
        on engagement.id = opportunity.engagement_id
       and engagement.organization_id = opportunity.organization_id
       and engagement.project_id = opportunity.project_id
     where engagement.provenance = 'direct_custom_inquiry'
     order by engagement.created_at, engagement.id
     limit 1
  `)).rows[0];
  assert.ok(direct, "adjacent proof requires one direct Engagement");

  const operatorId = randomUUID();
  const authorizerId = randomUUID();
  const otherUserId = randomUUID();
  const otherOrganizationId = randomUUID();
  const otherProjectId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4), ($5, $6)`,
    [
      operatorId, `adjacent-operator-${operatorId}@example.test`,
      authorizerId, `adjacent-authorizer-${authorizerId}@example.test`,
      otherUserId, `adjacent-other-${otherUserId}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Adjacent Operator', 'active')`,
    [operatorId]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Adjacent Operator', 'held', $2, clock_timestamp())`,
    [operatorId, authorizerId]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values (
       $1, 'service_management_manage', 'held', $2, clock_timestamp()
     )`,
    [operatorId, authorizerId]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at,
       expires_at, created_at
     ) values (
       $1, 'service_management_manage', 1, 'grant', null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp()
     )`,
    [operatorId]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
    [direct.organization_id, operatorId]
  );
  await pool.query(
    `insert into ss.organizations (
       id, created_by_user_id, name, state
     ) values ($1, $2, 'Adjacent isolation organization', 'active')`,
    [otherOrganizationId, otherUserId]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values
       ($1, $2, 'owner', 'active', clock_timestamp()),
       ($1, $3, 'viewer', 'active', clock_timestamp())`,
    [otherOrganizationId, otherUserId, operatorId]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values (
       $1, $2, $3, '00000000-0000-4000-8000-000000000014',
       'Adjacent isolation project'
     )`,
    [otherProjectId, otherOrganizationId, otherUserId]
  );

  const authority = createCanonicalPostgresAuthority({ pool });
  const repository = createPostgresAdjacentIntegrationRepository({ authority });
  const selectedNow = new Date().toISOString();
  const service = createAdjacentIntegrationService({
    repository,
    clock: { now: () => selectedNow },
    ids: { next: () => randomUUID() }
  });
  const operatorScope = {
    actorId: operatorId,
    operatorOrganizationId: direct.organization_id
  };

  const readiness = await service.readiness();
  assert.equal(readiness.ready, true, JSON.stringify(readiness));
  assert.equal(readiness.systems.length, 6);
  assert.match(readiness.contractDigest, /^[0-9a-f]{64}$/u);
  assert.equal(
    readiness.contractDigest,
    ADJACENT_INTEGRATION_SYSTEM_CONTRACTS_DIGEST
  );
  assert.equal(readiness.remoteWrites, false);
  assert.equal(readiness.providerEffects, false);
  assert.equal(readiness.automaticCommands, false);
  passed("exact-six-system-readiness");

  const contracts = await service.listContracts(operatorScope);
  assert.equal(contracts.systems.length, 6);
  assert.equal(contracts.systems.every((contract) =>
    contract.writeEffectDirection === "none_held" &&
    contract.automaticCommands === false &&
    contract.remoteWrites === false && contract.providerEffects === false
  ), true);
  passed("operator-contract-projection");

  const snapshotSpecs = [
    ["private_messenger", "relay_service", "availability", "a", "1"],
    ["command_deck", "service", "status_snapshot", "b", "2"],
    ["phone_bridge", "identity_route", "proxy_transport_status", "c", "3"],
    ["client_profile_hub", "service", "registry_revision", "d", "4"],
    ["marketing_desk", "prospect", "prospect_revision", "e", "5"],
    ["dell_commercial_engine", "catalog", "catalog_readback", "f", "6"]
  ];
  const snapshots = new Map();
  for (const [systemKey, remoteEntityKind, observationKind,
    payloadCharacter, referenceCharacter] of snapshotSpecs) {
    const input = {
      ...operatorScope,
      commandId: `adjacent.pg.snapshot.${systemKey}.0001`,
      systemKey,
      remoteEntityKind,
      remoteReference: `sha256:${opaque(referenceCharacter)}`,
      observationKind,
      observationState: "available",
      sourceRevision: `sha256:${opaque(payloadCharacter)}`,
      sourcePayloadDigest: opaque(payloadCharacter),
      sourceObservedAt: selectedNow
    };
    const receipt = await service.recordGlobalSnapshot(input);
    assert.equal(receipt.replay, false);
    assert.equal(receipt.organizationId, direct.organization_id);
    assert.equal(receipt.remoteWrites, false);
    snapshots.set(systemKey, { input, receipt });
  }
  assert.equal(snapshots.size, 6);
  const messengerSnapshot = snapshots.get("private_messenger");
  const exactReplay = await service.recordGlobalSnapshot(
    messengerSnapshot.input
  );
  assert.equal(exactReplay.id, messengerSnapshot.receipt.id);
  assert.equal(exactReplay.replay, true);
  const semanticReplay = await service.recordGlobalSnapshot({
    ...messengerSnapshot.input,
    commandId: "adjacent.pg.snapshot.messenger.semantic.0002"
  });
  assert.equal(semanticReplay.id, messengerSnapshot.receipt.id);
  assert.equal(semanticReplay.commandId, messengerSnapshot.input.commandId);
  assert.equal(semanticReplay.replay, true);
  const otherOrganizationSnapshot = await service.recordGlobalSnapshot({
    ...messengerSnapshot.input,
    commandId: "adjacent.pg.snapshot.messenger.other-org.0003",
    operatorOrganizationId: otherOrganizationId
  });
  assert.notEqual(otherOrganizationSnapshot.id, messengerSnapshot.receipt.id);
  assert.equal(otherOrganizationSnapshot.organizationId, otherOrganizationId);
  assert.equal(otherOrganizationSnapshot.replay, false);
  await expectCode(
    () => service.recordGlobalSnapshot({
      ...messengerSnapshot.input,
      sourcePayloadDigest: opaque("9")
    }),
    "ADJACENT_INTEGRATION_IDEMPOTENCY_CONFLICT"
  );
  passed("six-global-snapshots-replay-and-conflict");

  const crosswalk = async ({
    commandId, systemKey, projectId, localEntityKind, localEntityId,
    remoteEntityKind, referencePolicy, remoteReference
  }) => {
    const source = snapshots.get(systemKey);
    return service.recordCrosswalk({
      ...operatorScope,
      commandId,
      projectId,
      systemKey,
      sourceSnapshotId: source.receipt.id,
      localEntityKind,
      localEntityId,
      remoteEntityKind,
      referencePolicy,
      remoteReference,
      sourceRevision: source.input.sourceRevision,
      sourceEvidenceDigest: source.input.sourcePayloadDigest,
      supersedesCrosswalkId: null,
      state: "manual_review"
    });
  };
  const messenger = await crosswalk({
    commandId: "adjacent.pg.crosswalk.messenger.0001",
    systemKey: "private_messenger",
    projectId: null,
    localEntityKind: "organization",
    localEntityId: direct.organization_id,
    remoteEntityKind: "encrypted_session_digest",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("7")}`
  });
  const hubClient = await crosswalk({
    commandId: "adjacent.pg.crosswalk.hub.client.0001",
    systemKey: "client_profile_hub",
    projectId: null,
    localEntityKind: "organization",
    localEntityId: direct.organization_id,
    remoteEntityKind: "client",
    referencePolicy: "hub_client_id",
    remoteReference: "SSC-2026-1001"
  });
  const hubProject = await crosswalk({
    commandId: "adjacent.pg.crosswalk.hub.project.0001",
    systemKey: "client_profile_hub",
    projectId: direct.project_id,
    localEntityKind: "project",
    localEntityId: direct.project_id,
    remoteEntityKind: "project",
    referencePolicy: "hub_project_id",
    remoteReference: "SS-2026-1001"
  });
  const marketingEngagement = await crosswalk({
    commandId: "adjacent.pg.crosswalk.marketing.engagement.0001",
    systemKey: "marketing_desk",
    projectId: direct.project_id,
    localEntityKind: "engagement",
    localEntityId: direct.engagement_id,
    remoteEntityKind: "qualified_promotion",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("8")}`
  });
  const marketingOpportunity = await crosswalk({
    commandId: "adjacent.pg.crosswalk.marketing.opportunity.0001",
    systemKey: "marketing_desk",
    projectId: direct.project_id,
    localEntityKind: "direct_opportunity",
    localEntityId: direct.opportunity_id,
    remoteEntityKind: "qualified_promotion",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("8")}`
  });
  const dell = await crosswalk({
    commandId: "adjacent.pg.crosswalk.dell.scope.0001",
    systemKey: "dell_commercial_engine",
    projectId: direct.project_id,
    localEntityKind: "project",
    localEntityId: direct.project_id,
    remoteEntityKind: "scope",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("0")}`
  });
  const dellQuote = await crosswalk({
    commandId: "adjacent.pg.crosswalk.dell.quote.0001",
    systemKey: "dell_commercial_engine",
    projectId: direct.project_id,
    localEntityKind: "project",
    localEntityId: direct.project_id,
    remoteEntityKind: "quote",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("1")}`
  });
  const dellWork = await crosswalk({
    commandId: "adjacent.pg.crosswalk.dell.work.0001",
    systemKey: "dell_commercial_engine",
    projectId: direct.project_id,
    localEntityKind: "project",
    localEntityId: direct.project_id,
    remoteEntityKind: "work_receipt",
    referencePolicy: "digest_only",
    remoteReference: `sha256:${opaque("2")}`
  });
  assert.equal([
    messenger, hubClient, hubProject, marketingEngagement,
    marketingOpportunity, dell, dellQuote, dellWork
  ].every((entry) => entry.state === "manual_review"), true);
  passed("exact-tenant-kind-pair-crosswalks");

  await expectCode(
    () => crosswalk({
      commandId: "adjacent.pg.crosswalk.invalid.pair.0001",
      systemKey: "client_profile_hub",
      projectId: null,
      localEntityKind: "organization",
      localEntityId: direct.organization_id,
      remoteEntityKind: "project",
      referencePolicy: "hub_project_id",
      remoteReference: "SS-2026-9999"
    }),
    "ADJACENT_INTEGRATION_INVALID"
  );
  await expectCode(
    () => crosswalk({
      commandId: "adjacent.pg.crosswalk.invalid.raw.0001",
      systemKey: "private_messenger",
      projectId: null,
      localEntityKind: "organization",
      localEntityId: direct.organization_id,
      remoteEntityKind: "encrypted_session_digest",
      referencePolicy: "digest_only",
      remoteReference: "private-room-name"
    }),
    "ADJACENT_INTEGRATION_INVALID"
  );
  await expectCode(
    () => crosswalk({
      commandId: "adjacent.pg.crosswalk.invalid.tenant.0001",
      systemKey: "client_profile_hub",
      projectId: otherProjectId,
      localEntityKind: "project",
      localEntityId: otherProjectId,
      remoteEntityKind: "project",
      referencePolicy: "hub_project_id",
      remoteReference: "SS-2026-9998"
    }),
    "ADJACENT_INTEGRATION_UNAVAILABLE"
  );
  passed("invalid-pair-raw-reference-and-cross-tenant-denied");

  const observations = [];
  for (const selected of [
    {
      commandId: "adjacent.pg.observation.messenger.0001",
      crosswalk: messenger,
      systemKey: "private_messenger",
      projectId: null,
      observationKind: "encrypted_session_summary",
      observationState: "available"
    },
    {
      commandId: "adjacent.pg.observation.hub.0001",
      crosswalk: hubProject,
      systemKey: "client_profile_hub",
      projectId: direct.project_id,
      observationKind: "identity_readback",
      observationState: "matched"
    },
    {
      commandId: "adjacent.pg.observation.marketing.0001",
      crosswalk: marketingEngagement,
      systemKey: "marketing_desk",
      projectId: direct.project_id,
      observationKind: "promotion_receipt",
      observationState: "matched"
    },
    {
      commandId: "adjacent.pg.observation.dell.0001",
      crosswalk: dell,
      systemKey: "dell_commercial_engine",
      projectId: direct.project_id,
      observationKind: "scope_readback",
      observationState: "matched"
    }
  ]) {
    const source = snapshots.get(selected.systemKey);
    observations.push(await service.recordObservation({
      ...operatorScope,
      commandId: selected.commandId,
      crosswalkId: selected.crosswalk.id,
      sourceSnapshotId: source.receipt.id,
      projectId: selected.projectId,
      systemKey: selected.systemKey,
      observationKind: selected.observationKind,
      observationState: selected.observationState,
      sourceRevision: source.input.sourceRevision,
      sourcePayloadDigest: source.input.sourcePayloadDigest,
      sourceObservedAt: selectedNow
    }));
  }
  assert.equal(observations.length, 4);
  assert.equal(observations.every((entry) => entry.providerEffects === false), true);
  passed("tenant-observations-digest-only");

  const queue = createPostgresOperatorWorkQueueRepository({ authority });
  const beforeResolution = await queue.list(operatorScope);
  assert.equal(beforeResolution.items.some((item) =>
    item.source.id === hubProject.id &&
    item.kind === "adjacent_identity_review"
  ), true);
  const resolutionInput = {
    ...operatorScope,
    commandId: "adjacent.pg.resolution.hub.project.0001",
    crosswalkId: hubProject.id,
    systemKey: "client_profile_hub",
    expectedCrosswalkRequestDigest: hubProject.requestDigest,
    expectedCrosswalkRevision: 1,
    priorState: "manual_review",
    resolutionKind: "operator_confirm_link",
    resultingState: "linked",
    resolutionEvidenceDigest: opaque("a")
  };
  const resolution = await service.resolveCrosswalk(resolutionInput);
  assert.equal(resolution.crosswalkState, "linked");
  assert.equal(resolution.crosswalkRevision, 2);
  const resolutionReplay = await service.resolveCrosswalk(resolutionInput);
  assert.equal(resolutionReplay.id, resolution.id);
  assert.equal(resolutionReplay.replay, true);
  const hubSource = snapshots.get("client_profile_hub");
  const creationReplayAfterResolution = await service.recordCrosswalk({
    ...operatorScope,
    commandId: "adjacent.pg.crosswalk.hub.project.0001",
    projectId: direct.project_id,
    systemKey: "client_profile_hub",
    sourceSnapshotId: hubSource.receipt.id,
    localEntityKind: "project",
    localEntityId: direct.project_id,
    remoteEntityKind: "project",
    referencePolicy: "hub_project_id",
    remoteReference: "SS-2026-1001",
    sourceRevision: hubSource.input.sourceRevision,
    sourceEvidenceDigest: hubSource.input.sourcePayloadDigest,
    supersedesCrosswalkId: null,
    state: "manual_review"
  });
  assert.equal(creationReplayAfterResolution.id, hubProject.id);
  assert.equal(creationReplayAfterResolution.state, "manual_review");
  assert.equal(creationReplayAfterResolution.revision, 1);
  assert.equal(creationReplayAfterResolution.replay, true);
  await expectCode(
    () => service.recordCrosswalk({
      ...operatorScope,
      commandId: "adjacent.pg.crosswalk.hub.project.0001",
      projectId: direct.project_id,
      systemKey: "client_profile_hub",
      sourceSnapshotId: hubSource.receipt.id,
      localEntityKind: "project",
      localEntityId: direct.project_id,
      remoteEntityKind: "project",
      referencePolicy: "hub_project_id",
      remoteReference: "SS-2026-1001",
      sourceRevision: hubSource.input.sourceRevision,
      sourceEvidenceDigest: hubSource.input.sourcePayloadDigest,
      supersedesCrosswalkId: null,
      state: "conflict"
    }),
    "ADJACENT_INTEGRATION_IDEMPOTENCY_CONFLICT"
  );

  const confirm = (selected, systemKey, suffix, evidenceCharacter) =>
    service.resolveCrosswalk({
      ...operatorScope,
      commandId: `adjacent.pg.resolution.${suffix}.0001`,
      crosswalkId: selected.id,
      systemKey,
      expectedCrosswalkRequestDigest: selected.requestDigest,
      expectedCrosswalkRevision: 1,
      priorState: "manual_review",
      resolutionKind: "operator_confirm_link",
      resultingState: "linked",
      resolutionEvidenceDigest: opaque(evidenceCharacter)
    });
  const compatibleLinks = [];
  for (const [selected, systemKey, suffix, evidenceCharacter] of [
    [marketingEngagement, "marketing_desk", "marketing-engagement", "3"],
    [marketingOpportunity, "marketing_desk", "marketing-opportunity", "4"],
    [dell, "dell_commercial_engine", "dell-scope", "5"],
    [dellQuote, "dell_commercial_engine", "dell-quote", "6"],
    [dellWork, "dell_commercial_engine", "dell-work", "7"]
  ]) {
    compatibleLinks.push(await confirm(
      selected, systemKey, suffix, evidenceCharacter
    ));
  }
  assert.equal(compatibleLinks.every((entry) =>
    entry.crosswalkState === "linked"
  ), true);
  const afterResolution = await queue.list(operatorScope);
  assert.equal(afterResolution.items.some((item) =>
    item.source.id === hubProject.id
  ), false);
  await expectCode(
    () => service.resolveCrosswalk({
      ...resolutionInput,
      commandId: "adjacent.pg.resolution.hub.project.stale.0002",
      resolutionEvidenceDigest: opaque("b")
    }),
    "ADJACENT_INTEGRATION_RETRY_REQUIRED"
  );
  passed("queue-enter-resolve-clear-and-stale-revision");

  const trace = await service.listTrace({
    ...operatorScope,
    projectId: direct.project_id,
    systemKey: "client_profile_hub"
  });
  const linked = trace.crosswalks.find((entry) => entry.id === hubProject.id);
  assert.equal(linked.state, "linked");
  assert.equal(linked.safeRemoteReference, "SS-2026-1001");
  assert.equal(trace.crosswalks.some((entry) => entry.id === hubClient.id), true);
  assert.equal(trace.observations.some((entry) =>
    entry.crosswalkId === hubProject.id
  ), true);
  assert.equal(trace.sourceSnapshots.length, 1);
  assert.equal(Object.hasOwn(trace.sourceSnapshots[0], "remoteReference"), false);
  const exactTrace = await service.listTrace({
    ...operatorScope,
    crosswalkId: hubProject.id,
    projectId: null,
    systemKey: null
  });
  assert.deepEqual(
    exactTrace.crosswalks.map((entry) => entry.id),
    [hubProject.id]
  );
  assert.deepEqual(
    exactTrace.sourceSnapshots.map((entry) => entry.id),
    [hubSource.receipt.id]
  );
  for (let index = 0; index < 101; index += 1) {
    const marker = index.toString(16).padStart(64, "0");
    await service.recordGlobalSnapshot({
      ...operatorScope,
      commandId:
        `adjacent.pg.snapshot.hub.newer.${String(index).padStart(3, "0")}`,
      systemKey: "client_profile_hub",
      remoteEntityKind: "service",
      remoteReference: `sha256:${marker}`,
      observationKind: "registry_revision",
      observationState: "available",
      sourceRevision: `sha256:${marker}`,
      sourcePayloadDigest: marker,
      sourceObservedAt: selectedNow
    });
  }
  const exactTraceAfterSnapshotOverflow = await service.listTrace({
    ...operatorScope,
    crosswalkId: hubProject.id,
    projectId: null,
    systemKey: null
  });
  assert.deepEqual(
    exactTraceAfterSnapshotOverflow.sourceSnapshots.map((entry) => entry.id),
    [hubSource.receipt.id]
  );
  await expectCode(
    () => service.listTrace({
      ...operatorScope,
      projectId: otherProjectId,
      systemKey: "client_profile_hub"
    }),
    "ADJACENT_INTEGRATION_UNAVAILABLE"
  );
  passed("digest-only-operator-trace-and-tenant-isolation");

  const privileges = (await pool.query(`
    select
      not has_table_privilege(
        'authenticated', 'ss.adjacent_integration_crosswalks',
        'SELECT,INSERT,UPDATE,DELETE'
      ) as authenticated_crosswalk_denied,
      not has_table_privilege(
        'authenticated', 'ss.adjacent_integration_global_snapshots',
        'SELECT,INSERT,UPDATE,DELETE'
      ) as authenticated_snapshot_denied,
      not has_table_privilege(
        'service_role', 'ss.adjacent_integration_crosswalks',
        'INSERT,UPDATE,DELETE'
      ) as service_crosswalk_transition_denied,
      not has_table_privilege(
        'service_role', 'ss.adjacent_integration_global_snapshots',
        'INSERT,UPDATE,DELETE'
      ) as service_snapshot_mutation_denied
  `)).rows[0];
  assert.equal(Object.values(privileges).every(Boolean), true);
  await assert.rejects(
    authority.tenant(
      {
        userId: operatorId,
        organizationId: direct.organization_id,
        readOnly: true
      },
      (client) => client.query(
        "select id from ss.adjacent_integration_crosswalks limit 1"
      )
    ),
    (error) => error?.code === "42501"
  );
  await assert.rejects(
    authority.service(
      { actorKind: "system", userId: operatorId, organizationId: null },
      (client) => client.query(
        `update ss.adjacent_integration_crosswalks
            set state = 'superseded' where id = $1`,
        [messenger.id]
      )
    ),
    (error) => error?.code === "42501" || error?.code === "55000"
  );
  await assert.rejects(
    pool.query(
      `update ss.adjacent_integration_system_contracts
          set contract_revision = 1 where system_key = 'command_deck'`
    ),
    (error) => error?.code === "55000"
  );
  passed("acl-rls-immutable-catalog-and-transition-denials");

  const counts = (await pool.query(`
    select
      (select count(*)::integer
         from ss.adjacent_integration_global_snapshots) as snapshots,
      (select count(*)::integer
         from ss.adjacent_integration_crosswalks) as crosswalks,
      (select count(*)::integer
         from ss.adjacent_integration_observations) as observations,
      (select count(*)::integer
         from ss.adjacent_integration_crosswalk_resolutions) as resolutions
  `)).rows[0];
  assert.deepEqual(counts, {
    snapshots: 108,
    crosswalks: 8,
    observations: 4,
    resolutions: 6
  });
  passed("exact-evidence-ledger-counts");

  return Object.freeze({
    assertions: gates.length,
    contracts: contracts.systems.length,
    snapshots: counts.snapshots,
    crosswalks: counts.crosswalks,
    observations: counts.observations,
    resolutions: counts.resolutions,
    contractDigest: readiness.contractDigest
  });
}
