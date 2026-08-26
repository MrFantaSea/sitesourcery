import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import twilio from "twilio";

import pg from "pg";

import {
  createFakeResponderProvider,
  createResponderCore
} from "../responder-core.mjs";
import { createPostgresResponderCoreRepository } from
  "../responder-core-postgres.mjs";
import { createPostgresResponderFulfillmentRepository } from
  "../responder-fulfillment-postgres.mjs";
import {
  createPostgresResponderInboundFollowupRepository,
  createResponderInboundFollowupExecutor,
  RESPONDER_MISSED_CALL_FOLLOWUP_BODY
} from "../responder-inbound-followup-worker-postgres.mjs";
import { createLeasedLifecycleWorker } from
  "../leased-lifecycle-worker.mjs";
import { createPostgresResponderPrivateMaterialResolver } from
  "../responder-private-material-postgres.mjs";
import { createResponderPrivateMaterialVault } from
  "../responder-private-material-vault.mjs";
import { createResponderLookupDigests } from
  "../responder-lookup-digests.mjs";
import { createResponderInboundMaterialVault } from
  "../responder-inbound-material-vault.mjs";
import { createPostgresTwilioResponderInboundRepository } from
  "../twilio-responder-inbound-postgres.mjs";
import { createTwilioResponderInbound } from
  "../twilio-responder-inbound.mjs";
import { createPostgresResponderNumberBindingsRepository } from
  "../responder-number-bindings-postgres.mjs";
import {
  createPostgresResponderTwilioProviderTopologyRepository
} from "../responder-twilio-provider-topology-postgres.mjs";
import {
  createPostgresResponderVoiceDialTargets
} from "../responder-voice-dial-target-postgres.mjs";
import {
  createResponderVoiceDialTargetVault
} from "../responder-voice-dial-target-vault.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { digest } from "../security.mjs";

const DATABASE_URL = process.env.SITESOURCERY_PG_RESPONDER_INBOUND_TEST_URL;
const { Pool } = pg;

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const AUTH_TOKEN = "b".repeat(32);
const MESSAGE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages";
const VOICE_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice";
const DIAL_RESULT_URL =
  "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result";
const BUSINESS_NUMBER = "+18562441220";
const OTHER_NUMBER = "+18562441299";
const SERVICE_NUMBER = "+18562441288";
const CALLER = "+18565550100";
const FOLLOWUP_CALLER = "+18565550101";
const DELIVERY_BODY =
  "Sorry we missed you - this is Site Sourcery. Reply STOP to opt out.";

function providerTopology(organizationId) {
  const selected = {
    organizationId,
    registrationClass: "LOW_VOLUME_STANDARD",
    providerBrandType: "STANDARD",
    campaignUseCase: "CUSTOMER_CARE",
    accountSidDigest: digest(ACCOUNT_SID),
    messagingServiceSidDigest: digest(`MG${"1".repeat(32)}`)
  };
  for (const field of [
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
  ]) selected[field] = digest(`inbound-integration:${field}`);
  return Object.freeze(selected);
}

async function seed(pool) {
  const ids = {
    authorizer: randomUUID(),
    billing: randomUUID(),
    customer: randomUUID(),
    operator: randomUUID(),
    organization: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4), ($5, $6)`,
    [
      ids.customer, `inbound-customer-${ids.customer}@example.test`,
      ids.operator, `inbound-operator-${ids.operator}@example.test`,
      ids.authorizer, `inbound-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values
       ($1, $2, interval '14 days', interval '90 days', clock_timestamp())`,
    [ids.billing, `inbound-${ids.billing}`]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name)
     values ($1, $2, 'Inbound Test One')`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1, $2, 'owner', 'active', clock_timestamp())`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1, $2, $3, $4, 'Inbound Project One')`,
    [ids.project, ids.organization, ids.customer, ids.billing]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Inbound Operator', 'active'),
            ($2, 'Inbound Authorizer', 'active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Inbound Operator', 'held', $2, clock_timestamp())`,
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
       predecessor_event_id, recorded_by_kind, effective_at,
       expires_at, created_at
     ) values (
       $1, 'service_management_manage', 1, 'grant', null,
       'deployment_control', clock_timestamp(),
       clock_timestamp() + interval '1 day', clock_timestamp()
     )`,
    [ids.operator]
  );
  return ids;
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

test("Twilio inbound tenancy, STOP-versus-claim in both orders, replay, and private isolation hold on real PostgreSQL", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  try {
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
      currentKeyVersion: "inbound-pg-2026-08",
      currentKey: Buffer.alloc(32, 13).toString("base64url"),
      fromRouteDigestCandidates: (address) =>
        lookupDigests.callerRouteCandidates(address)
          .map((entry) => entry.digest)
    });
    const workerInboundVault = createResponderInboundMaterialVault({
      currentKeyVersion: "inbound-pg-2026-08",
      currentKey: Buffer.alloc(32, 13).toString("base64url"),
      fromRouteDigestCandidates: (_address, authenticatedDigest) =>
        [authenticatedDigest]
    });
    const inboundRepository =
      createPostgresTwilioResponderInboundRepository({
        authority,
        verifierKeyVersions: [...lookupDigests.verifierVersions]
      });
    const selectedProviderTopology = providerTopology(ids.organization);
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
      createPostgresResponderTwilioProviderTopologyRepository({ authority });
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
    const bindings = createPostgresResponderNumberBindingsRepository({
      authority,
      verifierKeyVersions: [...lookupDigests.verifierVersions]
    });
    const operator = {
      kind: "operator",
      organizationId: ids.organization,
      userId: ids.operator
    };
    const customer = {
      kind: "customer",
      userId: ids.customer,
      organizationId: ids.organization
    };
    await providerTopologyRepository.attestTopology(operator, {
      commandId: "pg-inbound-provider-topology-001",
      requestDigest: digest("pg-inbound-provider-topology-request-001"),
      ...selectedProviderTopology,
      providerReadbackDigest: digest(
        "pg-inbound-provider-topology-readback-001"
      ),
      topologyEvidenceDigest: digest(
        "pg-inbound-provider-topology-evidence-001"
      ),
      recordedAt: tick()
    });
    const core = createResponderCore({
      repository: createPostgresResponderCoreRepository({ authority }),
      provider: createFakeResponderProvider(),
      clock: { now: () => selectedNow }
    });
    const fulfillment = createPostgresResponderFulfillmentRepository({
      authority
    });
    const outboundVault = createResponderPrivateMaterialVault({
      currentKeyVersion: "outbound-pg-2026-08",
      currentKey: Buffer.alloc(32, 7)
    });
    const resolver = createPostgresResponderPrivateMaterialResolver({
      authority,
      vault: outboundVault
    });
    const voiceTargetVault = createResponderVoiceDialTargetVault({
      currentKeyVersion: "voice-pg-2026-08",
      currentKey: Buffer.alloc(32, 17)
    });
    const voiceTargets = createPostgresResponderVoiceDialTargets({
      authority,
      vault: voiceTargetVault
    });

    assert.equal((await inboundRepository.readiness()).ready, true);
    assert.equal((await bindings.readiness()).ready, true);

    // Provision the business number binding and prove single ownership.
    const provisioned = await bindings.provisionBinding(operator, {
      commandId: "pg-inbound-binding-001",
      requestDigest: "1".repeat(64),
      organizationId: ids.organization,
      projectId: ids.project,
      numberLookupDigest:
        lookupDigests.numberLookupDigest(BUSINESS_NUMBER).digest,
      numberLookupCandidateDigests: lookupDigests
        .numberLookupCandidates(BUSINESS_NUMBER)
        .map((entry) => entry.digest),
      lookupKeyVersion: lookupDigests.writerVersion,
      phoneNumberSidDigest: digest(`PN${"1".repeat(32)}`),
      accountSidDigest: digest(ACCOUNT_SID),
      messagingServiceSidDigest: null,
      providerReadbackDigest: "2".repeat(64),
      provisionEvidenceDigest: "3".repeat(64),
      recordedAt: tick()
    });
    assert.equal(provisioned.state, "active");
    const voiceTarget = await voiceTargets.provisionTarget(operator, {
      commandId: "pg-inbound-voice-target-001",
      requestDigest: digest("pg-inbound-voice-target-request-001"),
      organizationId: ids.organization,
      projectId: ids.project,
      numberBindingId: provisioned.id,
      target: "+18565550123",
      provisionEvidenceDigest: digest("pg-inbound-voice-target-evidence-001"),
      recordedAt: tick()
    });
    assert.equal(voiceTarget.state, "active");
    assert.equal(await voiceTargets.resolveTarget({
      numberBindingId: provisioned.id
    }), "+18565550123");
    const voiceTargetRows = await pool.query(
      "select to_jsonb(target.*)::text as row from ss.responder_voice_dial_targets target"
    );
    assert.equal(voiceTargetRows.rowCount, 1);
    assert.equal(voiceTargetRows.rows[0].row.includes("+18565550123"), false);
    await assert.rejects(
      bindings.provisionBinding(operator, {
        commandId: "pg-inbound-binding-duplicate-001",
        requestDigest: "4".repeat(64),
        organizationId: ids.organization,
        projectId: ids.project,
        numberLookupDigest:
          lookupDigests.numberLookupDigest(BUSINESS_NUMBER).digest,
        numberLookupCandidateDigests: lookupDigests
          .numberLookupCandidates(BUSINESS_NUMBER)
          .map((entry) => entry.digest),
        lookupKeyVersion: lookupDigests.writerVersion,
        phoneNumberSidDigest: digest(`PN${"2".repeat(32)}`),
        accountSidDigest: digest(ACCOUNT_SID),
        messagingServiceSidDigest: null,
        providerReadbackDigest: "5".repeat(64),
        provisionEvidenceDigest: "6".repeat(64),
        recordedAt: tick()
      }),
      (error) => error?.code === "RESPONDER_NUMBER_BINDING_CONFLICT",
      "a number can never be multiply mapped while active"
    );
    // A second binding expecting a Messaging Service for mismatch proof.
    await bindings.provisionBinding(operator, {
      commandId: "pg-inbound-binding-service-001",
      requestDigest: "7".repeat(64),
      organizationId: ids.organization,
      projectId: ids.project,
      numberLookupDigest:
        lookupDigests.numberLookupDigest(SERVICE_NUMBER).digest,
      numberLookupCandidateDigests: lookupDigests
        .numberLookupCandidates(SERVICE_NUMBER)
        .map((entry) => entry.digest),
      lookupKeyVersion: lookupDigests.writerVersion,
      phoneNumberSidDigest: digest(`PN${"3".repeat(32)}`),
      accountSidDigest: digest(ACCOUNT_SID),
      messagingServiceSidDigest: digest(`MG${"1".repeat(32)}`),
      providerReadbackDigest: "8".repeat(64),
      provisionEvidenceDigest: "9".repeat(64),
      recordedAt: tick()
    });

    // Unknown and mismatched numbers quarantine without tenant authority.
    tick();
    const unknown = await inbound.ingestInboundMessage(signedRequest(
      MESSAGE_URL,
      {
        MessageSid: `SM${"a".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: CALLER,
        To: OTHER_NUMBER,
        Body: "hello?"
      }
    ));
    assert.equal(unknown.eventState, "unbound");
    assert.equal(unknown.stateReason, "no_binding");
    tick();
    const mismatched = await inbound.ingestInboundMessage(signedRequest(
      MESSAGE_URL,
      {
        MessageSid: `SM${"b".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: CALLER,
        To: SERVICE_NUMBER,
        Body: "hello?"
      }
    ));
    assert.equal(mismatched.eventState, "unbound");
    assert.equal(mismatched.stateReason, "service_mismatch");
    const unboundRows = await pool.query(
      `select organization_id, project_id, state, state_reason
         from ss.responder_twilio_inbound_events
        where state = 'unbound'
          and provider_event_id_digest = any($1::text[])
        order by received_at`,
      [[
        digest(`SM${"a".repeat(32)}`),
        digest(`SM${"b".repeat(32)}`)
      ]]
    );
    assert.equal(unboundRows.rowCount, 2);
    for (const row of unboundRows.rows) {
      assert.equal(row.organization_id, null);
      assert.equal(row.project_id, null);
    }
    await assert.rejects(
      authority.service(
        { actorKind: "system", isolation: "serializable" },
        (client) => client.query(
          `insert into ss.responder_twilio_inbound_events (
             id, provider, channel, event_kind, provider_event_digest,
             provider_event_id_digest, account_sid_digest,
             to_number_lookup_digest, to_number_key_version,
             signature_verification_digest, payload_digest,
             state, state_reason, received_at, created_at
           ) values (
             $1, 'twilio', 'sms', 'message_received', $2, $3, $4, $5,
             'pgtest-v1', $6, $2, 'applied', null,
             clock_timestamp(), clock_timestamp()
           )`,
          [
            randomUUID(), digest(`forged-${randomUUID()}`),
            digest("forged-sid"), digest(ACCOUNT_SID),
            lookupDigests.numberLookupDigest(BUSINESS_NUMBER).digest,
            digest("forged-signature")
          ]
        )
      ),
      (error) => String(error?.code) === "23514" ||
        error?.code === "TWILIO_RESPONDER_INBOUND_REPOSITORY_CONFLICT",
      "tenantless rows are permitted only for the exact unbound states"
    );

    // Voice arrival is evidence only; the dial result decides missed.
    tick();
    const arrivalSid = `CA${"1".repeat(32)}`;
    const arrival = await inbound.ingestVoiceCall(signedRequest(VOICE_URL, {
      CallSid: arrivalSid,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: BUSINESS_NUMBER,
      CallStatus: "ringing",
      Direction: "inbound"
    }));
    assert.equal(arrival.eventState, "recorded");
    assert.equal(arrival.stateReason, "call_arrival");
    assert.equal(arrival.coreApplied, false);
    tick();
    const answered = await inbound.ingestDialResult(signedRequest(
      DIAL_RESULT_URL,
      {
        CallSid: `CA${"2".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: CALLER,
        To: BUSINESS_NUMBER,
        DialCallStatus: "completed"
      }
    ));
    assert.equal(answered.eventState, "recorded");
    assert.equal(answered.stateReason, "call_answered");
    assert.equal(answered.coreApplied, false);
    tick();
    const anonymousArrival = await inbound.ingestVoiceCall(
      signedRequest(VOICE_URL, {
        CallSid: `CA${"3".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: "anonymous",
        To: BUSINESS_NUMBER,
        CallStatus: "ringing"
      })
    );
    assert.equal(anonymousArrival.eventState, "recorded");
    assert.equal(anonymousArrival.stateReason, "call_arrival");
    tick();
    const anonymousMissed = await inbound.ingestDialResult(
      signedRequest(DIAL_RESULT_URL, {
        CallSid: `CA${"5".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: "anonymous",
        To: BUSINESS_NUMBER,
        DialCallStatus: "no-answer"
      })
    );
    assert.equal(anonymousMissed.eventState, "recorded");
    assert.equal(
      anonymousMissed.stateReason,
      "anonymous_caller",
      "a missed call with no usable route records evidence and nothing else"
    );
    assert.equal(anonymousMissed.coreApplied, false);
    const coreEventsSoFar = await pool.query(
      `select count(*)::integer as count
         from ss.responder_provider_events
        where provider = 'twilio'
          and provider_event_id_digest = any($1::text[])`,
      [[
        digest(arrivalSid),
        digest(`CA${"2".repeat(32)}`),
        digest(`CA${"3".repeat(32)}`),
        digest(`CA${"5".repeat(32)}`)
      ]]
    );
    assert.equal(
      coreEventsSoFar.rows[0].count,
      0,
      "no arrival, answered, or anonymous evidence became a core event"
    );

    // A missed dial result applies core evidence with sealed caller material.
    tick();
    const missedSid = `CA${"4".repeat(32)}`;
    const missed = await inbound.ingestDialResult(signedRequest(
      DIAL_RESULT_URL,
      {
        CallSid: missedSid,
        AccountSid: ACCOUNT_SID,
        From: CALLER,
        To: BUSINESS_NUMBER,
        DialCallStatus: "no-answer",
        ForwardedFrom: BUSINESS_NUMBER
      }
    ));
    assert.equal(missed.eventState, "applied");
    assert.equal(missed.coreApplied, true);
    const missedLedger = await pool.query(
      `select id, organization_id, project_id, from_route_digest,
              payload_digest, core_provider_event_id
         from ss.responder_twilio_inbound_events
        where provider_event_id_digest = $1 and state = 'applied'`,
      [digest(missedSid)]
    );
    assert.equal(missedLedger.rowCount, 1);
    const missedRow = missedLedger.rows[0];
    assert.equal(missedRow.organization_id, ids.organization);
    const missedCore = await pool.query(
      `select event.event_kind, event.message_intent, event.provider,
              interaction.state as interaction_state
         from ss.responder_provider_events event
         join ss.responder_interactions interaction
           on interaction.id = event.interaction_id
        where event.id = $1`,
      [missedRow.core_provider_event_id]
    );
    assert.deepEqual(missedCore.rows[0], {
      event_kind: "missed_call",
      message_intent: "not_applicable",
      provider: "twilio",
      interaction_state: "handoff_required"
    });
    const materialRow = await pool.query(
      `select key_version, nonce, authentication_tag, ciphertext,
              organization_id, project_id, channel, from_route_digest,
              payload_digest
         from ss.responder_inbound_private_materials
        where inbound_event_id = $1 and state = 'active'`,
      [missedRow.id]
    );
    assert.equal(materialRow.rowCount, 1);
    const sealedEnvelope = {
      keyVersion: materialRow.rows[0].key_version,
      nonce: materialRow.rows[0].nonce,
      authenticationTag: materialRow.rows[0].authentication_tag,
      ciphertext: materialRow.rows[0].ciphertext
    };
    const opened = await inboundVault.openInboundMaterial({
      inboundEventId: missedRow.id,
      organizationId: ids.organization,
      projectId: ids.project,
      channel: "voice",
      fromRouteDigest: missedRow.from_route_digest,
      payloadDigest: missedRow.payload_digest,
    }, sealedEnvelope);
    assert.deepEqual(opened, {
      from: CALLER,
      forwardedFrom: BUSINESS_NUMBER
    });
    await assert.rejects(
      inboundVault.openInboundMaterial({
        inboundEventId: missedRow.id,
        organizationId: randomUUID(),
        projectId: ids.project,
        channel: "voice",
        fromRouteDigest: missedRow.from_route_digest,
        payloadDigest: missedRow.payload_digest
      }, sealedEnvelope),
      (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
      "ciphertext is tenant-bound and cannot open under another organization"
    );
    const durableScan = await pool.query(
      `select to_jsonb(inbound.*)::text as row
         from ss.responder_twilio_inbound_events inbound`
    );
    for (const { row } of durableScan.rows) {
      assert.equal(row.includes(CALLER), false);
      assert.equal(row.includes(BUSINESS_NUMBER), false);
      assert.equal(row.includes(ACCOUNT_SID), false);
    }

    // Prepare a released, queued, materialized delivery for the race proofs.
    const contactRouteDigest = digest({ routeKind: "sms", address: CALLER });
    const deliveryContentDigest = digest({
      contentKind: "sms",
      body: DELIVERY_BODY
    });
    async function consentedQueuedOperation(round) {
      tick();
      const consent = await core.recordConsent(customer, {
        commandId: `pg-inbound-consent-${round}`,
        organizationId: ids.organization,
        projectId: ids.project,
        customerUserId: ids.customer,
        routeDigest: contactRouteDigest,
        consentBasis: "inbound_call",
        consentEvidenceDigest: digest(`consent-${round}`),
        consentedAt: selectedNow
      });
      tick();
      const missedEvent = await core.ingestProviderEvent({
        commandId: `pg-inbound-missed-${round}`,
        organizationId: ids.organization,
        projectId: ids.project,
        providerEventIdDigest: digest(`missed-${round}`),
        routeDigest: contactRouteDigest,
        eventKind: "missed_call",
        payloadDigest: digest(`missed-payload-${round}`),
        occurredAt: selectedNow
      });
      tick();
      await core.reserveHeldMessage(customer, {
        commandId: `pg-inbound-ack-${round}`,
        organizationId: ids.organization,
        projectId: ids.project,
        interactionId: missedEvent.interactionId,
        contactAuthorityId: consent.id,
        messageKind: "missed_call_ack",
        contentDigest: deliveryContentDigest
      });
      const operation = await pool.query(
        `select * from ss.responder_delivery_operations
          where command_id = $1`,
        [`pg-inbound-ack-${round}`]
      );
      assert.equal(operation.rows[0].state, "queued");
      tick();
      await resolver.storeSmsMaterial({
        operationId: operation.rows[0].id,
        organizationId: ids.organization,
        projectId: ids.project,
        interactionId: operation.rows[0].interaction_id,
        contactAuthorityId: operation.rows[0].contact_authority_id,
        messageKind: "missed_call_ack",
        routeDigest: contactRouteDigest,
        contentDigest: deliveryContentDigest,
        to: CALLER,
        body: DELIVERY_BODY,
        recordedAt: selectedNow
      });
      return { consent, operation: operation.rows[0] };
    }
    async function stopWebhook(round) {
      tick();
      return inbound.ingestInboundMessage(signedRequest(MESSAGE_URL, {
        MessageSid: `SM${String(round).repeat(32).slice(0, 32)}`,
        AccountSid: ACCOUNT_SID,
        From: CALLER,
        To: BUSINESS_NUMBER,
        Body: "STOP",
        OptOutType: "STOP"
      }));
    }
    function claimInput(round) {
      return {
        workerId: `responder-race-worker-${round}00000000`,
        claimedAt: selectedNow,
        leaseExpiresAt: new Date(
          Date.parse(selectedNow) + 120_000
        ).toISOString()
      };
    }

    // Release the organization once, through the guarded operator path.
    tick();
    await core.recordConsent(customer, {
      commandId: "pg-inbound-consent-release-seed",
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      routeDigest: digest({ routeKind: "sms", address: "+18565550199" }),
      consentBasis: "inbound_call",
      consentEvidenceDigest: digest("release-seed"),
      consentedAt: selectedNow
    });
    tick();
    await authority.service({
      actorKind: "operator",
      userId: ids.operator,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_runtime_controls
          set state = 'approved_live', global_kill_engaged = false,
              release_evidence_digest = $2, released_at = $3,
              released_by_operator_user_id = $4,
              revision = revision + 1, updated_at = $3
        where organization_id = $1`,
      [ids.organization, "4".repeat(64), selectedNow, ids.operator]
    ));

    // The same Responder worker purpose first materializes an inbound
    // missed-call follow-up under exact active consent. This proof stops at
    // the provider boundary after claiming it; no real message is sent.
    tick();
    await core.recordConsent(customer, {
      commandId: "pg-inbound-followup-consent-001",
      organizationId: ids.organization,
      projectId: ids.project,
      customerUserId: ids.customer,
      routeDigest: digest({
        routeKind: "sms",
        address: FOLLOWUP_CALLER
      }),
      consentBasis: "inbound_call",
      consentEvidenceDigest: digest("followup-consent-001"),
      consentedAt: selectedNow
    });
    tick();
    const followupMissed = await inbound.ingestDialResult(signedRequest(
      DIAL_RESULT_URL,
      {
        CallSid: `CA${"6".repeat(32)}`,
        AccountSid: ACCOUNT_SID,
        From: FOLLOWUP_CALLER,
        To: BUSINESS_NUMBER,
        DialCallStatus: "no-answer",
        ForwardedFrom: BUSINESS_NUMBER
      }
    ));
    assert.equal(followupMissed.eventState, "applied");
    const followupRepository =
      createPostgresResponderInboundFollowupRepository({ authority });
    const followupExecutor = createResponderInboundFollowupExecutor({
      inboundVault: workerInboundVault,
      deliveryVault: outboundVault
    });
    const followupWorker = createLeasedLifecycleWorker({
      purpose: "responder-inbound-followup",
      repository: followupRepository,
      executor: followupExecutor,
      clock: { now: () => selectedNow },
      enabled: true,
      workerId: "responder-inbound-followup-pg-proof-0001",
      intervalMs: 1_000,
      errorBackoffMs: 100,
      maximumBackoffMs: 1_000,
      batchLimit: 10,
      leaseSeconds: 120
    });
    const followupRun = await followupWorker.runOnce();
    assert.equal(followupRun.claimed, 2);
    assert.equal(followupRun.manualReview, 1);
    assert.equal(followupRun.completed, 1);
    const followupOperation = await pool.query(`
      select operation.*, material.state as material_state
        from ss.responder_inbound_followup_jobs job
        join ss.responder_delivery_operations operation
          on operation.id = job.delivery_operation_id
        join ss.responder_private_delivery_materials material
          on material.operation_id = operation.id
       where job.state = 'succeeded'
         and job.organization_id = $1
       order by job.completed_at desc
       limit 1
    `, [ids.organization]);
    assert.equal(followupOperation.rowCount, 1);
    assert.equal(followupOperation.rows[0].state, "queued");
    assert.equal(followupOperation.rows[0].material_state, "active");
    assert.equal(
      followupOperation.rows[0].content_digest,
      digest({
        contentKind: "sms",
        body: RESPONDER_MISSED_CALL_FOLLOWUP_BODY
      })
    );
    tick();
    const heldAtProviderBoundary = await fulfillment.claimNextDelivery({
      workerId: "responder-followup-proof-no-provider-0001",
      claimedAt: selectedNow,
      leaseExpiresAt: new Date(
        Date.parse(selectedNow) + 120_000
      ).toISOString()
    });
    assert.equal(
      heldAtProviderBoundary.operationId,
      followupOperation.rows[0].id
    );
    await fulfillment.recordDeliveryManualReview({
      operationId: heldAtProviderBoundary.operationId,
      workerId: heldAtProviderBoundary.workerId,
      attemptCount: heldAtProviderBoundary.attemptCount,
      failureCode: "RESPONDER_TEST_PROVIDER_EFFECT_HELD",
      failedAt: selectedNow
    });

    // Order 1: STOP commits first; no later claim can dispatch.
    const first = await consentedQueuedOperation(1);
    const firstStop = await stopWebhook(1);
    assert.equal(firstStop.eventState, "applied");
    assert.equal(firstStop.classifiedIntent, "stop");
    assert.ok(firstStop.suppression.cancelledOperations >= 1);
    const firstOperation = await pool.query(
      "select state, failure_code from ss.responder_delivery_operations where id = $1",
      [first.operation.id]
    );
    assert.deepEqual(firstOperation.rows[0], {
      state: "cancelled",
      failure_code: "RESPONDER_DELIVERY_OPTED_OUT"
    });
    tick();
    assert.deepEqual(
      await fulfillment.claimNextDelivery(claimInput(1)),
      { status: "idle" },
      "after a durable STOP the claim gate returns nothing"
    );
    const firstContact = await pool.query(
      "select state from ss.responder_contact_authorities where id = $1",
      [first.consent.id]
    );
    assert.equal(firstContact.rows[0].state, "opted_out");

    // Order 2: the claim wins first; STOP still revokes dispatch authority
    // before any provider call, and post-effect recording latches conflict.
    const second = await consentedQueuedOperation(2);
    tick();
    const claimed = await fulfillment.claimNextDelivery(claimInput(2));
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.operationId, second.operation.id);
    const secondStop = await stopWebhook(2);
    assert.equal(secondStop.eventState, "applied");
    assert.ok(
      secondStop.suppression.cancelledOperations >= 1,
      "a claimed, pre-effect operation is cancelled by durable STOP"
    );
    const secondOperation = await pool.query(
      `select state, failure_code, lease_owner, lease_expires_at
         from ss.responder_delivery_operations where id = $1`,
      [second.operation.id]
    );
    assert.deepEqual(secondOperation.rows[0], {
      state: "cancelled",
      failure_code: "RESPONDER_DELIVERY_OPTED_OUT",
      lease_owner: null,
      lease_expires_at: null
    });
    await assert.rejects(
      resolver.resolveSmsMaterial({
        schema: "sitesourcery.responder-private-sms-resolution/v1",
        operationId: second.operation.id,
        organizationId: ids.organization,
        projectId: ids.project,
        interactionId: second.operation.interaction_id,
        contactAuthorityId: second.operation.contact_authority_id,
        messageKind: "missed_call_ack",
        routeDigest: contactRouteDigest,
        contentDigest: deliveryContentDigest,
        leaseOwner: claimInput(2).workerId
      }),
      (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE",
      "the pre-dispatch revalidation refuses a suppressed operation"
    );
    tick();
    // An effect completing after suppression is durably recorded as an open
    // reconciliation case (FIN-004R) rather than thrown away; the worker is
    // told to reconcile through the returned status.
    const raceConflict = await fulfillment.recordDeliveryAccepted({
      operationId: second.operation.id,
      workerId: claimInput(2).workerId,
      attemptCount: 1,
      provider: "twilio",
      providerMessageIdDigest: digest("race-message-sid"),
      providerReceiptDigest: digest("race-receipt"),
      acceptedAt: selectedNow
    });
    assert.equal(raceConflict.status, "suppression_conflict");
    const raceCase = await pool.query(
      `select state from ss.provider_reconciliation_cases
        where case_kind = 'suppression_conflict'
          and subject_operation_id = $1`,
      [second.operation.id]
    );
    assert.equal(raceCase.rowCount, 1);
    assert.equal(raceCase.rows[0].state, "open");
    assert.deepEqual(
      await fulfillment.recordDeliveryManualReview({
        operationId: second.operation.id,
        workerId: claimInput(2).workerId,
        attemptCount: 1,
        failureCode: "RESPONDER_RACE_TEST",
        failedAt: selectedNow
      }),
      { status: "already_cancelled" }
    );

    // Concurrent race: whichever side wins the locks, no dispatch authority
    // survives once the STOP is durable.
    const third = await consentedQueuedOperation(3);
    tick();
    const [claimOutcome, stopOutcome] = await Promise.allSettled([
      fulfillment.claimNextDelivery(claimInput(3)),
      stopWebhook(3)
    ]);
    assert.equal(stopOutcome.status, "fulfilled");
    assert.equal(stopOutcome.value.eventState, "applied");
    if (
      claimOutcome.status === "fulfilled" &&
      claimOutcome.value.status === "claimed"
    ) {
      const survivor = await pool.query(
        "select state from ss.responder_delivery_operations where id = $1",
        [third.operation.id]
      );
      assert.equal(survivor.rows[0].state, "cancelled");
    } else if (claimOutcome.status === "fulfilled") {
      assert.equal(claimOutcome.value.status, "idle");
    } else {
      assert.equal(
        claimOutcome.reason?.code,
        "RESPONDER_FULFILLMENT_RETRY_REQUIRED"
      );
    }
    const finalThird = await pool.query(
      "select state from ss.responder_delivery_operations where id = $1",
      [third.operation.id]
    );
    assert.equal(finalThird.rows[0].state, "cancelled");

    // Replay and superseded-variant semantics on the exact STOP webhook.
    const replayParams = {
      MessageSid: `SM${"3".repeat(32)}`,
      AccountSid: ACCOUNT_SID,
      From: CALLER,
      To: BUSINESS_NUMBER,
      Body: "STOP",
      OptOutType: "STOP"
    };
    const replayed = await inbound.ingestInboundMessage(
      signedRequest(MESSAGE_URL, replayParams)
    );
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.eventState, "applied");
    tick();
    const variant = await inbound.ingestInboundMessage(
      signedRequest(MESSAGE_URL, {
        ...replayParams,
        Body: "STOP please"
      })
    );
    assert.equal(variant.eventState, "superseded");
    assert.equal(variant.stateReason, "duplicate_payload_variant");
    assert.equal(variant.coreApplied, false);
    const stopCoreEvents = await pool.query(
      `select count(*)::integer as count
         from ss.responder_provider_events
        where provider_event_id_digest = $1`,
      [digest(`SM${"3".repeat(32)}`)]
    );
    assert.equal(stopCoreEvents.rows[0].count, 1);
  } finally {
    await pool.end();
  }
});
