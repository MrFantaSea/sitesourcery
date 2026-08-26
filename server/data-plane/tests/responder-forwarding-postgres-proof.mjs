import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import twilio from "twilio";
import pg from "pg";

import {
  createFakeResponderProvider,
  createResponderCore
} from "../../hosted/responder-core.mjs";
import { createPostgresResponderCoreRepository } from
  "../../hosted/responder-core-postgres.mjs";
import { createPostgresResponderForwardingRepository } from
  "../../hosted/responder-forwarding-postgres.mjs";
import { createResponderInboundMaterialVault } from
  "../../hosted/responder-inbound-material-vault.mjs";
import { createPostgresResponderInboundFollowupRepository } from
  "../../hosted/responder-inbound-followup-worker-postgres.mjs";
import { createResponderLookupDigests } from
  "../../hosted/responder-lookup-digests.mjs";
import { createPostgresResponderNumberBindingsRepository } from
  "../../hosted/responder-number-bindings-postgres.mjs";
import {
  createPostgresResponderTwilioProviderTopologyRepository
} from "../../hosted/responder-twilio-provider-topology-postgres.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";
import { digest } from "../../hosted/security.mjs";
import { createPostgresTwilioResponderInboundRepository } from
  "../../hosted/twilio-responder-inbound-postgres.mjs";
import { createTwilioResponderInbound } from
  "../../hosted/twilio-responder-inbound.mjs";
import {
  createTwilioResponderInboundHttpAdapter,
  TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML,
  TWILIO_RESPONDER_INBOUND_VOICE_PATH
} from "../../hosted/twilio-responder-inbound-http.mjs";

const ACCOUNT_SID = `AC${"d".repeat(32)}`;
const OTHER_ACCOUNT_SID = `AC${"f".repeat(32)}`;
const AUTH_TOKEN = "e".repeat(32);
const MESSAGE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages";
const VOICE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice";
const DIAL_RESULT_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";
const BUSINESS_NUMBER = "+18562441301";
const MANAGED_DESTINATION = "+18562441302";
const FRONT_DOOR_DESTINATION = "+18562441303";
const OTHER_BUSINESS_NUMBER = "+18562441304";
const OTHER_MANAGED_DESTINATION = "+18562441305";
const CALLER = "+18565550201";
const { Pool } = pg;
const EXPECTED_ASSERTIONS = 17;
const EXPECTED_GATES = Object.freeze([
  "storage-contract-acl-readiness-held",
  "self-forwarding-loop-rejected-before-durable-command",
  "database-customer-creator-ownership-enforced",
  "concurrent-create-replay-and-semantic-deduplication",
  "organization-scoped-command-idempotency",
  "database-customer-observation-authority-denied",
  "customer-operator-tenant-and-command-authority",
  "preverification-arrival-recorded-without-core-effect",
  "five-evidence-ready-held-transition-and-exact-replay",
  "missing-source-evidence-recorded-without-core-or-followup",
  "verified-conditional-arrival-applies-one-missed-call-and-followup",
  "source-mismatch-held-and-managed-front-door-preserved",
  "post-verification-ambiguity-demotes-to-manual-review",
  "database-customer-retirement-authority-enforced",
  "append-only-history-and-customer-cancellation",
  "digest-only-durability-and-zero-provider-send-effects",
  "followup-stops-at-held-manual-review-boundary"
]);

function providerTopology(organizationId, accountSid, scope) {
  const selected = {
    organizationId,
    registrationClass: "LOW_VOLUME_STANDARD",
    providerBrandType: "STANDARD",
    campaignUseCase: "CUSTOMER_CARE",
    accountSidDigest: digest(accountSid)
  };
  for (const field of [
    "messagingServiceSidDigest",
    "customerProfileSidDigest",
    "brandRegistrationSidDigest",
    "campaignSidDigest",
    "messagingApiKeySidDigest",
    "messagingApiKeySecretDigest",
    "webhookAuthTokenDigest",
    "voiceApiKeySidDigest",
    "voiceApiKeySecretDigest",
    "voiceSandboxPushCredentialSidDigest",
    "voiceProductionPushCredentialSidDigest",
    "voiceAndroidSandboxPushCredentialSidDigest",
    "voiceAndroidProductionPushCredentialSidDigest"
  ]) selected[field] = digest(`${scope}:${field}`);
  return Object.freeze(selected);
}

async function expectCode(work, code) {
  await assert.rejects(async () => work(), (error) => error?.code === code);
}

function signedRequest(url, params) {
  const form = new URLSearchParams(params);
  return {
    rawBody: Buffer.from(form.toString(), "utf8"),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilio.getExpectedTwilioSignature(
        AUTH_TOKEN,
        url,
        params
      )
    }
  };
}

async function seed(pool) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    customer: randomUUID(),
    otherBilling: randomUUID(),
    otherCustomer: randomUUID(),
    otherOrganization: randomUUID(),
    otherProject: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
    [
      ids.customer, `forward-customer-${ids.customer}@example.test`,
      ids.operator, `forward-operator-${ids.operator}@example.test`,
      ids.authorizer, `forward-authorizer-${ids.authorizer}@example.test`,
      ids.otherCustomer,
      `forward-other-customer-${ids.otherCustomer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values
       ($1, $2, interval '14 days', interval '90 days', clock_timestamp()),
       ($3, $4, interval '14 days', interval '90 days', clock_timestamp())`,
    [ids.billing, `forwarding-${ids.billing}`,
      ids.otherBilling, `forwarding-${ids.otherBilling}`]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name) values
       ($1, $2, 'Responder Forwarding Proof'),
       ($3, $4, 'Responder Forwarding Other Tenant')`,
    [ids.organization, ids.customer,
      ids.otherOrganization, ids.otherCustomer]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values
       ($1, $2, 'owner', 'active', clock_timestamp()),
       ($1, $3, 'billing', 'active', clock_timestamp()),
       ($4, $3, 'owner', 'active', clock_timestamp())`,
    [ids.organization, ids.customer, ids.otherCustomer,
      ids.otherOrganization]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values
       ($1, $2, $3, $4, 'Forwarding Project'),
       ($5, $6, $7, $8, 'Forwarding Other Project')`,
    [ids.project, ids.organization, ids.customer, ids.billing,
      ids.otherProject, ids.otherOrganization, ids.otherCustomer,
      ids.otherBilling]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Forwarding Operator', 'active'),
            ($2, 'Forwarding Authorizer', 'active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Forwarding Operator', 'held', $2, clock_timestamp())`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_permissions (
       operator_user_id, capability, state, granted_by_user_id, granted_at
     ) values (
       $1, 'service_management_manage', 'held', $2, clock_timestamp()
     )`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.service_operator_authority_events (
       operator_user_id, capability, event_sequence, event_kind,
       predecessor_event_id, recorded_by_kind, effective_at, expires_at,
       created_at
     ) values (
       $1, 'service_management_manage', 1, 'grant', null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp()
     )`,
    [ids.operator]
  );
  return ids;
}

export async function verifyResponderForwardingPostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const ids = await seed(pool);
  let selectedNow = new Date().toISOString();
  const tick = () => {
    selectedNow = new Date(Date.parse(selectedNow) + 25).toISOString();
    return selectedNow;
  };
  const authority = createCanonicalPostgresAuthority({ pool });
  const lookupDigests = createResponderLookupDigests({
    pepper: Buffer.alloc(32, 11),
    pepperVersion: "pgtest-v1"
  });
  const inboundVault = createResponderInboundMaterialVault({
    currentKeyVersion: "forward-inbound-pg-v1",
    currentKey: Buffer.alloc(32, 31).toString("base64url"),
    fromRouteDigestCandidates: (address) =>
      lookupDigests.callerRouteCandidates(address)
        .map((entry) => entry.digest)
  });
  const inboundRepository =
    createPostgresTwilioResponderInboundRepository({
      authority,
      verifierKeyVersions: [...lookupDigests.verifierVersions]
    });
  const selectedProviderTopology = providerTopology(
    ids.organization,
    ACCOUNT_SID,
    "forward-primary"
  );
  const otherProviderTopology = providerTopology(
    ids.otherOrganization,
    OTHER_ACCOUNT_SID,
    "forward-other"
  );
  const providerRegistry = Object.freeze({
    kind: "twilio-isv-provider-registry",
    providerEffects: false,
    async readiness() { return { ready: true, verified: true }; },
    resolveAccountSid(accountSid) {
      assert.equal(accountSid, ACCOUNT_SID);
      return Object.freeze({
        webhookAuthToken: AUTH_TOKEN,
        topology: selectedProviderTopology
      });
    }
  });
  const providerTopologyRepository =
    createPostgresResponderTwilioProviderTopologyRepository({
      authority
    });
  const inbound = createTwilioResponderInbound({
    providerRegistry,
    providerTopologyRepository,
    inboundMessageUrl: MESSAGE_URL,
    voiceUrl: VOICE_URL,
    dialResultUrl: DIAL_RESULT_URL,
    repository: inboundRepository,
    vault: inboundVault,
    lookupDigests,
    clock: { now: () => selectedNow }
  });
  let forbiddenDialCalls = 0;
  const inboundHttp = createTwilioResponderInboundHttpAdapter({
    inbound,
    voiceDialPlan: {
      kind: "twilio-responder-voice-dial-plan",
      mode: "verified-private-forward",
      providerEffects: true,
      async readiness() {
        return { ready: true, verified: true, providerEffects: true };
      },
      async twiml() {
        forbiddenDialCalls += 1;
        throw new Error("conditional destination must never Dial back");
      }
    }
  });
  const bindings = createPostgresResponderNumberBindingsRepository({
    authority,
    verifierKeyVersions: [...lookupDigests.verifierVersions]
  });
  const forwarding = createPostgresResponderForwardingRepository({
    authority,
    verifierKeyVersions: [...lookupDigests.verifierVersions]
  });
  const core = createResponderCore({
    repository: createPostgresResponderCoreRepository({ authority }),
    provider: createFakeResponderProvider(),
    clock: { now: () => selectedNow }
  });
  const customer = {
    kind: "customer",
    userId: ids.customer,
    organizationId: ids.organization
  };
  const operator = {
    kind: "operator",
    userId: ids.operator,
    organizationId: ids.organization
  };
  const otherCustomer = {
    kind: "customer",
    userId: ids.otherCustomer,
    organizationId: ids.otherOrganization
  };
  const otherOperator = {
    kind: "operator",
    userId: ids.operator,
    organizationId: ids.otherOrganization
  };
  for (const [actor, topology, scope] of [
    [operator, selectedProviderTopology, "primary"],
    [otherOperator, otherProviderTopology, "other"]
  ]) {
    await providerTopologyRepository.attestTopology(actor, {
      commandId: `forward.pg.topology.${scope}.0001`,
      requestDigest: digest(`forward.pg.topology.${scope}.request`),
      ...topology,
      providerReadbackDigest: digest(
        `forward.pg.topology.${scope}.readback`
      ),
      topologyEvidenceDigest: digest(
        `forward.pg.topology.${scope}.evidence`
      ),
      recordedAt: tick()
    });
  }

  async function directCreate(actor, input) {
    return authority.service({
      actorKind: actor.kind,
      userId: actor.userId,
      organizationId: actor.organizationId,
      isolation: "serializable"
    }, async (client) => {
      const payload = await client.query(
        `select ss.responder_forwarding_onboarding_payload_digest_v1(
           $1, $2, $3, $4, $5, $6, $7
         ) as digest`,
        [input.organizationId, input.projectId, input.customerUserId,
          input.numberBindingId, input.businessLineLookupDigest,
          input.businessLineKeyVersion, input.consentEvidenceDigest]
      );
      const request = await client.query(
        `select ss.responder_forwarding_command_request_digest_v1(
           $1, $2, $3, $4, $5, 'create', 0, 'setup_pending', $6
         ) as digest`,
        [actor.kind, actor.userId, input.organizationId, input.projectId,
          input.onboardingId, payload.rows[0].digest]
      );
      await client.query(
        `insert into ss.responder_forwarding_commands (
           command_id, request_digest, organization_id, project_id,
           onboarding_id, actor_kind, actor_user_id, command_kind,
           expected_revision, resulting_state, payload_digest, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, 'create', 0,
           'setup_pending', $8, $9
         )`,
        [input.commandId, request.rows[0].digest, input.organizationId,
          input.projectId, input.onboardingId, actor.kind, actor.userId,
          payload.rows[0].digest, input.recordedAt]
      );
      return client.query(
        `insert into ss.responder_forwarding_onboardings (
           id, create_command_id, organization_id, project_id,
           customer_user_id, number_binding_id, transport_adapter,
           launch_mode, instruction_contract,
           business_line_lookup_digest, business_line_key_version,
           consent_evidence_digest, state, created_by_kind,
           created_by_user_id, created_at, revision, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, 'twilio',
           'conditional_no_answer_forwarding',
           'provider-assisted-conditional-no-answer-v1',
           $7, $8, $9, 'setup_pending', $10, $11, $12, 1, $12
         )`,
        [input.onboardingId, input.commandId, input.organizationId,
          input.projectId, input.customerUserId, input.numberBindingId,
          input.businessLineLookupDigest, input.businessLineKeyVersion,
          input.consentEvidenceDigest, actor.kind, actor.userId,
          input.recordedAt]
      );
    });
  }

  const privileges = await pool.query(`
    select
      has_table_privilege(
        'service_role','ss.responder_forwarding_commands','select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_forwarding_commands','update,delete'
      ) as commands_minimal,
      has_table_privilege(
        'service_role','ss.responder_forwarding_onboardings',
        'select,insert,update'
      ) and not has_table_privilege(
        'service_role','ss.responder_forwarding_onboardings','delete'
      ) as onboardings_minimal,
      has_table_privilege(
        'service_role','ss.responder_forwarding_observations','select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_forwarding_observations','update,delete'
      ) as observations_minimal,
      not has_table_privilege(
        'authenticated','ss.responder_forwarding_onboardings',
        'select,insert,update,delete'
      ) as authenticated_denied
  `);
  for (const [name, value] of Object.entries(privileges.rows[0])) {
    assert.equal(value, true, `Forwarding privilege failed: ${name}`);
  }
  assert.deepEqual(await forwarding.readiness(), {
    ready: true,
    verified: true,
    kind: "responder-forwarding-postgres",
    mode: "held-local",
    contractDigest:
      "7eba06cb2246b9f30b75206f3468ae19e903162a050b56baf2b4dfbb2274c36b",
    retainedCarrier: true,
    launchMode: "conditional_no_answer_forwarding",
    initialAdapter: "twilio",
    automaticCarrierCommands: false,
    remoteWriteEffects: false,
    providerEffects: false,
    messageSendEffects: false,
    code: null
  });
  passed("storage-contract-acl-readiness-held");

  async function provision(number, suffix, commandId, {
    actor = operator,
    organizationId = ids.organization,
    projectId = ids.project,
    voiceIngressRole = "conditional_forward_destination"
  } = {}) {
    return bindings.provisionBinding(actor, {
      commandId,
      requestDigest: digest(`${commandId}-request`),
      organizationId,
      projectId,
      voiceIngressRole,
      numberLookupDigest:
        lookupDigests.numberLookupDigest(number).digest,
      numberLookupCandidateDigests: lookupDigests
        .numberLookupCandidates(number).map((entry) => entry.digest),
      lookupKeyVersion: lookupDigests.writerVersion,
      phoneNumberSidDigest: digest(`PN${suffix.repeat(32)}`),
      accountSidDigest: organizationId === ids.organization
        ? selectedProviderTopology.accountSidDigest
        : otherProviderTopology.accountSidDigest,
      messagingServiceSidDigest: null,
      providerReadbackDigest: digest(`${commandId}-readback`),
      provisionEvidenceDigest: digest(`${commandId}-evidence`),
      recordedAt: tick()
    });
  }
  const binding = await provision(
    MANAGED_DESTINATION, "4", "forward.pg.binding.0001"
  );
  await provision(
    FRONT_DOOR_DESTINATION, "5", "forward.pg.binding.0002", {
      voiceIngressRole: "managed_front_door"
    }
  );
  const otherBinding = await provision(
    OTHER_MANAGED_DESTINATION, "6", "forward.pg.binding.other.0001",
    {
      actor: otherOperator,
      organizationId: ids.otherOrganization,
      projectId: ids.otherProject
    }
  );

  const managedIdentity =
    lookupDigests.numberLookupDigest(MANAGED_DESTINATION);
  const loopOnboardingId = randomUUID();
  await expectCode(
    () => forwarding.create(customer, {
      commandId: "forward.pg.self-loop.0001",
      onboardingId: loopOnboardingId,
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      numberBindingId: binding.id,
      businessLineLookupDigest: managedIdentity.digest,
      businessLineLookupCandidateDigests: lookupDigests
        .numberLookupCandidates(MANAGED_DESTINATION)
        .map((entry) => entry.digest),
      businessLineKeyVersion: managedIdentity.keyVersion,
      consentEvidenceDigest: digest("forward.pg.self-loop.consent"),
      recordedAt: tick()
    }),
    "RESPONDER_FORWARDING_INVALID"
  );
  const directLoopId = randomUUID();
  await expectCode(
    () => directCreate(customer, {
      commandId: "forward.pg.self-loop.db.0001",
      onboardingId: directLoopId,
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      numberBindingId: binding.id,
      businessLineLookupDigest: managedIdentity.digest,
      businessLineKeyVersion: managedIdentity.keyVersion,
      consentEvidenceDigest: digest("forward.pg.self-loop.db.consent"),
      recordedAt: tick()
    }),
    "23514"
  );
  const loopCounts = await pool.query(
    `select
       (select count(*)::integer from ss.responder_forwarding_commands
         where command_id in (
           'forward.pg.self-loop.0001',
           'forward.pg.self-loop.db.0001'
         )) as commands,
       (select count(*)::integer from ss.responder_forwarding_onboardings
         where id = any($1::uuid[])) as onboardings`,
    [[loopOnboardingId, directLoopId]]
  );
  assert.deepEqual(loopCounts.rows[0], { commands: 0, onboardings: 0 });
  passed("self-forwarding-loop-rejected-before-durable-command");

  const businessIdentity =
    lookupDigests.numberLookupDigest(BUSINESS_NUMBER);
  const wrongCreatorId = randomUUID();
  await expectCode(
    () => directCreate(customer, {
      commandId: "forward.pg.db.creator.0001",
      onboardingId: wrongCreatorId,
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.otherCustomer,
      numberBindingId: binding.id,
      businessLineLookupDigest: businessIdentity.digest,
      businessLineKeyVersion: businessIdentity.keyVersion,
      consentEvidenceDigest: digest("forward.pg.db.creator.consent"),
      recordedAt: tick()
    }),
    "23514"
  );
  const wrongCreatorCounts = await pool.query(
    `select
       (select count(*)::integer from ss.responder_forwarding_commands
         where organization_id = $1 and command_id = $2) as commands,
       (select count(*)::integer from ss.responder_forwarding_onboardings
         where organization_id = $1 and id = $3) as onboardings`,
    [ids.organization, "forward.pg.db.creator.0001", wrongCreatorId]
  );
  assert.deepEqual(
    wrongCreatorCounts.rows[0],
    { commands: 0, onboardings: 0 }
  );
  passed("database-customer-creator-ownership-enforced");

  tick();
  const preOnboardingSid = `CA${"d".repeat(32)}`;
  const preOnboardingRequest = signedRequest(VOICE_URL, {
    CallSid: preOnboardingSid,
    AccountSid: ACCOUNT_SID,
    From: CALLER,
    To: MANAGED_DESTINATION,
    ForwardedFrom: BUSINESS_NUMBER,
    CallStatus: "ringing",
    Direction: "inbound"
  });
  const preOnboardingArrival = await inbound.ingestVoiceCall(
    preOnboardingRequest
  );
  assert.equal(preOnboardingArrival.eventState, "recorded");
  assert.equal(
    preOnboardingArrival.stateReason,
    "forwarding_onboarding_unavailable"
  );
  assert.equal(preOnboardingArrival.forwardingOnboardingId, null);
  assert.equal(
    preOnboardingArrival.voiceArrivalPolicy,
    "conditional_no_answer_forwarding"
  );
  assert.equal(preOnboardingArrival.coreApplied, false);
  const preOnboardingEffects = await pool.query(
    `select inbound.id,
            (inbound.core_provider_event_id is null) as no_core,
            count(job.id)::integer as followup_jobs
       from ss.responder_twilio_inbound_events inbound
       left join ss.responder_inbound_followup_jobs job
         on job.inbound_event_id = inbound.id
      where inbound.provider_event_id_digest = $1
      group by inbound.id, inbound.core_provider_event_id`,
    [digest(preOnboardingSid)]
  );
  assert.deepEqual(preOnboardingEffects.rows[0], {
    id: preOnboardingEffects.rows[0].id,
    no_core: true,
    followup_jobs: 0
  });
  const preOnboardingHttp = await inboundHttp.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    ...preOnboardingRequest
  });
  assert.equal(
    preOnboardingHttp.body,
    TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML
  );
  assert.equal(forbiddenDialCalls, 0);

  const createInput = {
    commandId: "forward.pg.onboard.0001",
    onboardingId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    customerUserId: ids.customer,
    numberBindingId: binding.id,
    businessLineLookupDigest: businessIdentity.digest,
    businessLineLookupCandidateDigests: lookupDigests
      .numberLookupCandidates(BUSINESS_NUMBER).map((entry) => entry.digest),
    businessLineKeyVersion: businessIdentity.keyVersion,
    consentEvidenceDigest: digest("forward.pg.customer-consent.0001"),
    recordedAt: tick()
  };
  const concurrencyPool = new Pool({
    connectionString: pool.options.connectionString,
    max: 2
  });
  let created;
  try {
    const concurrentForwarding = createPostgresResponderForwardingRepository({
      authority: createCanonicalPostgresAuthority({ pool: concurrencyPool }),
      verifierKeyVersions: [...lookupDigests.verifierVersions]
    });
    const concurrent = await Promise.allSettled([
      concurrentForwarding.create(customer, createInput),
      concurrentForwarding.create(customer, createInput)
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length >= 1,
      true
    );
    for (const result of concurrent) {
      if (result.status === "rejected") {
        assert.equal(
          result.reason?.code,
          "RESPONDER_FORWARDING_RETRY_REQUIRED"
        );
      }
    }
    created = await concurrentForwarding.create(customer, createInput);
  } finally {
    await concurrencyPool.end();
  }
  assert.equal(created.onboarding.state, "setup_pending");
  assert.equal(created.replayed, true);
  const semanticReplay = await forwarding.create(customer, {
    ...createInput,
    commandId: "forward.pg.onboard.semantic.0002",
    onboardingId: randomUUID()
  });
  assert.equal(semanticReplay.onboardingId, created.onboardingId);
  assert.equal(semanticReplay.semanticReplay, true);
  const creationCounts = await pool.query(
    `select
       (select count(*)::integer from ss.responder_forwarding_commands
         where onboarding_id = $1) as commands,
       (select count(*)::integer from ss.responder_forwarding_onboardings
         where id = $1) as onboardings`,
    [created.onboardingId]
  );
  assert.deepEqual(creationCounts.rows[0], { commands: 1, onboardings: 1 });
  passed("concurrent-create-replay-and-semantic-deduplication");

  const otherBusinessIdentity =
    lookupDigests.numberLookupDigest(OTHER_BUSINESS_NUMBER);
  const otherCreated = await forwarding.create(otherCustomer, {
    ...createInput,
    commandId: createInput.commandId,
    onboardingId: randomUUID(),
    organizationId: ids.otherOrganization,
    projectId: ids.otherProject,
    customerUserId: ids.otherCustomer,
    numberBindingId: otherBinding.id,
    businessLineLookupDigest: otherBusinessIdentity.digest,
    businessLineLookupCandidateDigests: lookupDigests
      .numberLookupCandidates(OTHER_BUSINESS_NUMBER)
      .map((entry) => entry.digest),
    businessLineKeyVersion: otherBusinessIdentity.keyVersion,
    consentEvidenceDigest: digest("forward.pg.other.customer-consent.0001"),
    recordedAt: tick()
  });
  assert.equal(otherCreated.onboarding.state, "setup_pending");
  assert.notEqual(otherCreated.onboardingId, created.onboardingId);
  const sharedCommandRows = await pool.query(
    `select organization_id
       from ss.responder_forwarding_commands
      where command_id = $1
      order by organization_id`,
    [createInput.commandId]
  );
  assert.deepEqual(
    sharedCommandRows.rows.map((row) => row.organization_id).sort(),
    [ids.organization, ids.otherOrganization].sort()
  );
  const primaryListAfterOtherCreate = await forwarding.list(customer, {
    organizationId: ids.organization,
    projectId: ids.project
  });
  assert.deepEqual(
    primaryListAfterOtherCreate.onboardings.map((row) => row.id),
    [created.onboardingId]
  );
  passed("organization-scoped-command-idempotency");

  const deniedObservationEvidence =
    digest("forward.pg.db.customer-observation.evidence");
  await expectCode(
    () => authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, async (client) => {
      const observedAt = tick();
      const observation = await client.query(
        `select ss.responder_forwarding_observation_digest_v1(
           $1, 'carrier_setup_attested', null, $2, $3
         ) as digest`,
        [created.onboardingId, deniedObservationEvidence, observedAt]
      );
      const request = await client.query(
        `select ss.responder_forwarding_command_request_digest_v1(
           'customer', $1, $2, $3, $4, 'record_observation', 1,
           'setup_pending', $5
         ) as digest`,
        [ids.customer, ids.organization, ids.project,
          created.onboardingId, observation.rows[0].digest]
      );
      await client.query(
        `insert into ss.responder_forwarding_commands (
           command_id, request_digest, organization_id, project_id,
           onboarding_id, actor_kind, actor_user_id, command_kind,
           expected_revision, resulting_state, payload_digest, created_at
         ) values (
           'forward.pg.db.customer-observation.0001', $1, $2, $3, $4,
           'customer', $5, 'record_observation', 1, 'setup_pending', $6, $7
         )`,
        [request.rows[0].digest, ids.organization, ids.project,
          created.onboardingId, ids.customer, observation.rows[0].digest,
          observedAt]
      );
    }),
    "42501"
  );
  const deniedObservationCounts = await pool.query(
    `select
       (select count(*)::integer from ss.responder_forwarding_commands
         where organization_id = $1 and onboarding_id = $2) as commands,
       (select count(*)::integer from ss.responder_forwarding_observations
         where organization_id = $1 and onboarding_id = $2) as observations,
       (select revision::integer from ss.responder_forwarding_onboardings
         where organization_id = $1 and id = $2) as revision`,
    [ids.organization, created.onboardingId]
  );
  assert.deepEqual(deniedObservationCounts.rows[0], {
    commands: 1,
    observations: 0,
    revision: 1
  });
  passed("database-customer-observation-authority-denied");

  await expectCode(
    () => forwarding.list(customer, {
      organizationId: randomUUID(),
      projectId: ids.project
    }),
    "RESPONDER_FORWARDING_UNAVAILABLE"
  );
  await expectCode(
    () => forwarding.recordObservation(customer, {}),
    "RESPONDER_FORWARDING_UNAVAILABLE"
  );
  await expectCode(
    () => forwarding.create(customer, {
      ...createInput,
      commandId: createInput.commandId,
      consentEvidenceDigest: digest("changed-consent")
    }),
    "RESPONDER_FORWARDING_IDEMPOTENCY_CONFLICT"
  );
  passed("customer-operator-tenant-and-command-authority");

  tick();
  const setupArrivalSid = `CA${"6".repeat(32)}`;
  const setupArrival = await inbound.ingestVoiceCall(signedRequest(
    VOICE_URL,
    {
      CallSid: setupArrivalSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      ForwardedFrom: BUSINESS_NUMBER,
      CallStatus: "ringing",
      Direction: "inbound"
    }
  ));
  assert.equal(setupArrival.eventState, "recorded");
  assert.equal(setupArrival.stateReason, "forwarding_not_ready");
  assert.equal(
    setupArrival.voiceArrivalPolicy,
    "conditional_no_answer_forwarding"
  );
  assert.equal(setupArrival.forwardingOnboardingId, created.onboardingId);
  assert.equal(setupArrival.coreApplied, false);
  const setupArrivalRow = await pool.query(
    `select id from ss.responder_twilio_inbound_events
      where provider_event_id_digest = $1`,
    [digest(setupArrivalSid)]
  );
  assert.equal(setupArrivalRow.rowCount, 1);
  assert.equal(preOnboardingEffects.rows[0].followup_jobs, 0);
  passed("preverification-arrival-recorded-without-core-effect");

  tick();
  await core.recordConsent(customer, {
    commandId: "forward.pg.reply-consent.0001",
    organizationId: ids.organization,
    projectId: ids.project,
    customerUserId: ids.customer,
    routeDigest: digest({ routeKind: "sms", address: CALLER }),
    consentBasis: "inbound_call",
    consentEvidenceDigest: digest("forward.pg.reply-consent.evidence"),
    consentedAt: selectedNow
  });
  tick();
  const replySid = `SM${"7".repeat(32)}`;
  const reply = await inbound.ingestInboundMessage(signedRequest(
    MESSAGE_URL,
    {
      MessageSid: replySid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      Body: "Please call me back"
    }
  ));
  assert.equal(reply.eventState, "applied");
  assert.equal(reply.classifiedIntent, "message");
  tick();
  const stopSid = `SM${"8".repeat(32)}`;
  const stop = await inbound.ingestInboundMessage(signedRequest(
    MESSAGE_URL,
    {
      MessageSid: stopSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      Body: "STOP",
      OptOutType: "STOP"
    }
  ));
  assert.equal(stop.eventState, "applied");
  assert.equal(stop.classifiedIntent, "stop");
  const linkedInbound = await pool.query(
    `select provider_event_id_digest, id
       from ss.responder_twilio_inbound_events
      where provider_event_id_digest = any($1::text[])`,
    [[digest(replySid), digest(stopSid)]]
  );
  const inboundIds = new Map(linkedInbound.rows.map(
    (row) => [row.provider_event_id_digest, row.id]
  ));

  const observations = [
    ["carrier_setup_attested", null],
    ["unanswered_forwarding_reached", setupArrivalRow.rows[0].id],
    ["answered_call_not_forwarded", null],
    ["reply_path_confirmed", inboundIds.get(digest(replySid))],
    ["stop_path_confirmed", inboundIds.get(digest(stopSid))]
  ];
  let revision = 1;
  let finalReceipt;
  const coreBeforeAnsweredEvidence = await pool.query(
    `select count(*)::integer as count from ss.responder_provider_events
      where organization_id = $1 and project_id = $2`,
    [ids.organization, ids.project]
  );
  for (const [index, [observationKind, inboundEventId]] of
    observations.entries()) {
    tick();
    const input = {
      commandId: `forward.pg.observation.000${index + 1}`,
      organizationId: ids.organization,
      projectId: ids.project,
      onboardingId: created.onboardingId,
      expectedRevision: revision,
      observationKind,
      inboundEventId,
      evidenceDigest: digest(`forward.pg.${observationKind}.evidence`),
      observedAt: selectedNow,
      recordedAt: selectedNow
    };
    finalReceipt = await forwarding.recordObservation(operator, input);
    assert.deepEqual(
      await forwarding.recordObservation(operator, input),
      { ...finalReceipt, replayed: true }
    );
    revision += 1;
  }
  assert.equal(finalReceipt.resultingState, "ready_held");
  assert.equal(finalReceipt.resultingRevision, 6);
  const coreAfterAnsweredEvidence = await pool.query(
    `select count(*)::integer as count from ss.responder_provider_events
      where organization_id = $1 and project_id = $2`,
    [ids.organization, ids.project]
  );
  assert.equal(
    coreAfterAnsweredEvidence.rows[0].count,
    coreBeforeAnsweredEvidence.rows[0].count,
    "manual answered-call proof cannot create a provider/core event"
  );
  passed("five-evidence-ready-held-transition-and-exact-replay");

  tick();
  const missingSourceSid = `CA${"c".repeat(32)}`;
  const missingSource = await inbound.ingestVoiceCall(signedRequest(
    VOICE_URL,
    {
      CallSid: missingSourceSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      CallStatus: "ringing",
      Direction: "inbound"
    }
  ));
  assert.equal(missingSource.eventState, "recorded");
  assert.equal(missingSource.stateReason, "forwarding_source_mismatch");
  assert.equal(missingSource.coreApplied, false);
  assert.equal(
    missingSource.voiceArrivalPolicy,
    "conditional_no_answer_forwarding"
  );
  const missingSourceEffects = await pool.query(
    `select inbound.id,
            (inbound.core_provider_event_id is null) as no_core,
            count(job.id)::integer as followup_jobs
       from ss.responder_twilio_inbound_events inbound
       left join ss.responder_inbound_followup_jobs job
         on job.inbound_event_id = inbound.id
      where inbound.provider_event_id_digest = $1
      group by inbound.id, inbound.core_provider_event_id`,
    [digest(missingSourceSid)]
  );
  assert.equal(missingSourceEffects.rowCount, 1);
  assert.equal(missingSourceEffects.rows[0].no_core, true);
  assert.equal(missingSourceEffects.rows[0].followup_jobs, 0);
  passed("missing-source-evidence-recorded-without-core-or-followup");

  tick();
  const conditionalSid = `CA${"9".repeat(32)}`;
  const conditional = await inbound.ingestVoiceCall(signedRequest(
    VOICE_URL,
    {
      CallSid: conditionalSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      ForwardedFrom: BUSINESS_NUMBER,
      CallStatus: "ringing",
      Direction: "inbound"
    }
  ));
  assert.equal(conditional.eventState, "applied");
  assert.equal(conditional.coreApplied, true);
  assert.equal(conditional.stateReason, null);
  assert.equal(
    conditional.voiceArrivalPolicy,
    "conditional_no_answer_forwarding"
  );
  const conditionalEvidence = await pool.query(
    `select inbound.id, inbound.core_provider_event_id,
            core.event_kind, count(job.id)::integer as followup_jobs
       from ss.responder_twilio_inbound_events inbound
       join ss.responder_provider_events core
         on core.id = inbound.core_provider_event_id
       left join ss.responder_inbound_followup_jobs job
         on job.inbound_event_id = inbound.id
      where inbound.provider_event_id_digest = $1
      group by inbound.id, inbound.core_provider_event_id, core.event_kind`,
    [digest(conditionalSid)]
  );
  assert.deepEqual(
    conditionalEvidence.rows[0],
    {
      id: conditionalEvidence.rows[0].id,
      core_provider_event_id:
        conditionalEvidence.rows[0].core_provider_event_id,
      event_kind: "missed_call",
      followup_jobs: 1
    }
  );
  const exactCoreCount = await pool.query(
    `select count(*)::integer as count
       from ss.responder_provider_events
      where provider = 'twilio' and provider_event_id_digest = $1`,
    [digest(conditionalSid)]
  );
  assert.equal(exactCoreCount.rows[0].count, 1);
  passed("verified-conditional-arrival-applies-one-missed-call-and-followup");

  tick();
  const mismatchSid = `CA${"a".repeat(32)}`;
  const mismatch = await inbound.ingestVoiceCall(signedRequest(
    VOICE_URL,
    {
      CallSid: mismatchSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: MANAGED_DESTINATION,
      ForwardedFrom: "+18562441999",
      CallStatus: "ringing",
      Direction: "inbound"
    }
  ));
  assert.equal(mismatch.eventState, "recorded");
  assert.equal(mismatch.stateReason, "forwarding_source_mismatch");
  assert.equal(mismatch.coreApplied, false);
  tick();
  const frontDoorSid = `CA${"b".repeat(32)}`;
  const frontDoor = await inbound.ingestVoiceCall(signedRequest(
    VOICE_URL,
    {
      CallSid: frontDoorSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: FRONT_DOOR_DESTINATION,
      CallStatus: "ringing",
      Direction: "inbound"
    }
  ));
  assert.equal(frontDoor.eventState, "recorded");
  assert.equal(frontDoor.stateReason, "call_arrival");
  assert.equal(frontDoor.voiceArrivalPolicy, "managed_front_door");
  assert.equal(frontDoor.forwardingOnboardingId, null);
  assert.equal(frontDoor.coreApplied, false);
  passed("source-mismatch-held-and-managed-front-door-preserved");

  const mismatchRows = await pool.query(
    `select provider_event_id_digest, id
       from ss.responder_twilio_inbound_events
      where provider_event_id_digest = any($1::text[])`,
    [[digest(mismatchSid), digest(frontDoorSid)]]
  );
  const mismatchIds = new Map(mismatchRows.rows.map(
    (row) => [row.provider_event_id_digest, row.id]
  ));
  tick();
  await expectCode(
    () => forwarding.recordObservation(operator, {
      commandId: "forward.pg.ambiguity.wrong-binding.0001",
      organizationId: ids.organization,
      projectId: ids.project,
      onboardingId: created.onboardingId,
      expectedRevision: 6,
      observationKind: "routing_ambiguous",
      inboundEventId: mismatchIds.get(digest(frontDoorSid)),
      evidenceDigest: digest("forward.pg.ambiguity.wrong-binding"),
      observedAt: selectedNow,
      recordedAt: selectedNow
    }),
    "RESPONDER_FORWARDING_CONFLICT"
  );
  tick();
  const ambiguity = await forwarding.recordObservation(operator, {
    commandId: "forward.pg.ambiguity.0001",
    organizationId: ids.organization,
    projectId: ids.project,
    onboardingId: created.onboardingId,
    expectedRevision: 6,
    observationKind: "routing_ambiguous",
    inboundEventId: mismatchIds.get(digest(mismatchSid)),
    evidenceDigest: digest("forward.pg.ambiguity.evidence"),
    observedAt: selectedNow,
    recordedAt: selectedNow
  });
  assert.equal(ambiguity.resultingState, "manual_review");
  assert.equal(ambiguity.resultingRevision, 7);
  passed("post-verification-ambiguity-demotes-to-manual-review");

  const deniedRetirementEvidence =
    digest("forward.pg.db.customer-retirement.evidence");
  await expectCode(
    () => authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, async (client) => {
      const retiredAt = tick();
      const payload = await client.query(
        `select ss.responder_forwarding_retirement_payload_digest_v1(
           $1, 'operator_correction', $2
         ) as digest`,
        [created.onboardingId, deniedRetirementEvidence]
      );
      const request = await client.query(
        `select ss.responder_forwarding_command_request_digest_v1(
           'customer', $1, $2, $3, $4, 'retire', 7,
           'retired', $5
         ) as digest`,
        [ids.customer, ids.organization, ids.project,
          created.onboardingId, payload.rows[0].digest]
      );
      await client.query(
        `insert into ss.responder_forwarding_commands (
           command_id, request_digest, organization_id, project_id,
           onboarding_id, actor_kind, actor_user_id, command_kind,
           expected_revision, resulting_state, payload_digest, created_at
         ) values (
           'forward.pg.db.customer-retirement.0001', $1, $2, $3, $4,
           'customer', $5, 'retire', 7, 'retired', $6, $7
         )`,
        [request.rows[0].digest, ids.organization, ids.project,
          created.onboardingId, ids.customer, payload.rows[0].digest,
          retiredAt]
      );
      await client.query(
        `update ss.responder_forwarding_onboardings
            set state = 'retired', retired_reason = 'operator_correction',
                retire_evidence_digest = $2, retired_by_kind = 'customer',
                retired_by_user_id = $3, retired_at = $4,
                revision = 8, updated_at = $4
          where organization_id = $1 and id = $5`,
        [ids.organization, deniedRetirementEvidence, ids.customer,
          retiredAt, created.onboardingId]
      );
    }),
    "23514"
  );
  const deniedRetirementState = await pool.query(
    `select onboarding.state, onboarding.revision::integer,
            (select count(*)::integer
               from ss.responder_forwarding_commands command
              where command.organization_id = onboarding.organization_id
                and command.onboarding_id = onboarding.id) as commands,
            (select count(*)::integer
               from ss.responder_forwarding_observations observation
              where observation.organization_id = onboarding.organization_id
                and observation.onboarding_id = onboarding.id) as observations
       from ss.responder_forwarding_onboardings onboarding
      where onboarding.organization_id = $1 and onboarding.id = $2`,
    [ids.organization, created.onboardingId]
  );
  assert.deepEqual(deniedRetirementState.rows[0], {
    state: "manual_review",
    revision: 7,
    commands: 7,
    observations: 6
  });
  passed("database-customer-retirement-authority-enforced");

  await assert.rejects(
    authority.service({
      actorKind: "operator",
      userId: ids.operator,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_forwarding_onboardings
          set state = 'retired', revision = revision + 1,
              updated_at = clock_timestamp()
        where id = $1`,
      [created.onboardingId]
    )),
    "direct history rewrite must be rejected"
  );
  const list = await forwarding.list(customer, {
    organizationId: ids.organization,
    projectId: ids.project
  });
  assert.equal(list.onboardings.length, 1);
  assert.equal(list.observations.length, 6);
  assert.equal(list.onboardings[0].state, "manual_review");
  tick();
  const retired = await forwarding.retire(customer, {
    commandId: "forward.pg.retire.0001",
    organizationId: ids.organization,
    projectId: ids.project,
    onboardingId: created.onboardingId,
    expectedRevision: 7,
    reason: "customer_cancelled",
    evidenceDigest: digest("forward.pg.retire.evidence"),
    recordedAt: selectedNow
  });
  assert.equal(retired.resultingState, "retired");
  assert.equal(retired.resultingRevision, 8);
  assert.deepEqual(await forwarding.retire(customer, {
    commandId: "forward.pg.retire.0001",
    organizationId: ids.organization,
    projectId: ids.project,
    onboardingId: created.onboardingId,
    expectedRevision: 7,
    reason: "customer_cancelled",
    evidenceDigest: digest("forward.pg.retire.evidence"),
    recordedAt: selectedNow
  }), { ...retired, replayed: true });

  tick();
  const postRetirementSid = `CA${"e".repeat(32)}`;
  const postRetirementRequest = signedRequest(VOICE_URL, {
    CallSid: postRetirementSid,
    AccountSid: ACCOUNT_SID,
    From: CALLER,
    To: MANAGED_DESTINATION,
    ForwardedFrom: BUSINESS_NUMBER,
    CallStatus: "ringing",
    Direction: "inbound"
  });
  const postRetirementArrival = await inbound.ingestVoiceCall(
    postRetirementRequest
  );
  assert.equal(postRetirementArrival.eventState, "recorded");
  assert.equal(
    postRetirementArrival.stateReason,
    "forwarding_onboarding_unavailable"
  );
  assert.equal(postRetirementArrival.forwardingOnboardingId, null);
  assert.equal(
    postRetirementArrival.voiceArrivalPolicy,
    "conditional_no_answer_forwarding"
  );
  assert.equal(postRetirementArrival.coreApplied, false);
  const postRetirementEffects = await pool.query(
    `select (inbound.core_provider_event_id is null) as no_core,
            count(job.id)::integer as followup_jobs
       from ss.responder_twilio_inbound_events inbound
       left join ss.responder_inbound_followup_jobs job
         on job.inbound_event_id = inbound.id
      where inbound.provider_event_id_digest = $1
      group by inbound.id, inbound.core_provider_event_id`,
    [digest(postRetirementSid)]
  );
  assert.deepEqual(postRetirementEffects.rows[0], {
    no_core: true,
    followup_jobs: 0
  });
  const postRetirementHttp = await inboundHttp.handle({
    method: "POST",
    pathname: TWILIO_RESPONDER_INBOUND_VOICE_PATH,
    ...postRetirementRequest
  });
  assert.equal(
    postRetirementHttp.body,
    TWILIO_RESPONDER_CONDITIONAL_FORWARD_TWIML
  );
  assert.equal(forbiddenDialCalls, 0);
  passed("append-only-history-and-customer-cancellation");

  const durableRows = await pool.query(`
    select coalesce(string_agg(row_text, ''), '') as durable_text
      from (
        select to_jsonb(command.*)::text as row_text
          from ss.responder_forwarding_commands command
        union all
        select to_jsonb(onboarding.*)::text
          from ss.responder_forwarding_onboardings onboarding
        union all
        select to_jsonb(observation.*)::text
          from ss.responder_forwarding_observations observation
        union all
        select to_jsonb(inbound.*)::text
          from ss.responder_twilio_inbound_events inbound
         where inbound.organization_id = $1
      ) durable
  `, [ids.organization]);
  for (const forbidden of [
    BUSINESS_NUMBER, MANAGED_DESTINATION, FRONT_DOOR_DESTINATION,
    CALLER, ACCOUNT_SID
  ]) {
    assert.equal(durableRows.rows[0].durable_text.includes(forbidden), false);
  }
  const effects = await pool.query(`
    select
      (select bool_and(not automatic_carrier_commands
          and not remote_write_effects and not provider_effects
          and not message_send_effects)
         from ss.responder_forwarding_onboardings
        where organization_id = $1) as onboarding_held,
      (select bool_and(not automatic_carrier_commands
          and not remote_write_effects and not provider_effects
          and not message_send_effects)
         from ss.responder_forwarding_commands
        where organization_id = $1) as commands_held,
      (select bool_and(not automatic_carrier_commands
          and not remote_write_effects and not provider_effects
          and not message_send_effects)
         from ss.responder_forwarding_observations
        where organization_id = $1) as observations_held,
      (select count(*)::integer from ss.responder_delivery_operations operation
       where operation.organization_id = $1
         and operation.attempt_count > 0) as delivery_attempts
  `, [ids.organization]);
  assert.deepEqual(effects.rows[0], {
    onboarding_held: true,
    commands_held: true,
    observations_held: true,
    delivery_attempts: 0
  });
  passed("digest-only-durability-and-zero-provider-send-effects");

  tick();
  const followupRepository =
    createPostgresResponderInboundFollowupRepository({ authority });
  const workerId = "responder-inbound-followup-forwarding-proof-0001";
  const claimedFollowup = await followupRepository.claimNext({
    workerId,
    observedAt: selectedNow,
    leaseSeconds: 120
  });
  assert.equal(
    claimedFollowup.inboundEventId,
    conditionalEvidence.rows[0].id
  );
  assert.equal(claimedFollowup.eligibility, "consent_required");
  tick();
  assert.deepEqual(await followupRepository.completeClaim({
    jobId: claimedFollowup.jobId,
    fence: claimedFollowup.fence,
    workerId,
    observedAt: selectedNow,
    result: {
      receiptKind: "manual_review",
      failureCode: "RESPONDER_TEST_PROVIDER_EFFECT_HELD"
    }
  }), {
    status: "manual_review",
    jobId: claimedFollowup.jobId
  });
  passed("followup-stops-at-held-manual-review-boundary");

  const counts = await pool.query(`
    select
      (select count(*)::integer from ss.responder_forwarding_onboardings
        where organization_id = $1) as onboardings,
      (select count(*)::integer from ss.responder_forwarding_observations
        where organization_id = $1) as observations,
      (select count(*)::integer from ss.responder_forwarding_commands
        where organization_id = $1) as commands,
      (select count(*)::integer from ss.responder_inbound_followup_jobs
        where organization_id = $1) as followup_jobs
  `, [ids.organization]);
  assert.deepEqual(counts.rows[0], {
    onboardings: 1,
    observations: 6,
    commands: 8,
    followup_jobs: 1
  });
  assert.deepEqual(gates, EXPECTED_GATES);
  assert.equal(gates.length, EXPECTED_ASSERTIONS);
  return Object.freeze({
    assertions: gates.length,
    expectedAssertions: EXPECTED_ASSERTIONS,
    automaticCarrierCommands: false,
    remoteWrites: false,
    providerEffects: false,
    messageSendEffects: false,
    ...counts.rows[0]
  });
}
