import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  createPostgresResponderTwilioProviderTopologyRepository
} from "../responder-twilio-provider-topology-postgres.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const DATABASE_URL =
  process.env.SITESOURCERY_PG_TWILIO_ISV_TOPOLOGY_TEST_URL;
const { Pool } = pg;

async function seed(pool) {
  const ids = {
    owner: randomUUID(),
    operator: randomUUID(),
    authorizer: randomUUID(),
    organization: randomUUID(),
    secondOrganization: randomUUID(),
    billingPolicy: randomUUID(),
    project: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values
       ($1, $2), ($3, $4), ($5, $6)`,
    [
      ids.owner, `twilio-owner-${ids.owner}@example.test`,
      ids.operator, `twilio-operator-${ids.operator}@example.test`,
      ids.authorizer, `twilio-authorizer-${ids.authorizer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name) values
       ($1, $2, 'Twilio ISV Topology Test'),
       ($3, $2, 'Second Twilio ISV Topology Test')`,
    [ids.organization, ids.owner, ids.secondOrganization]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values ($1, $2, interval '1 day', interval '30 days', clock_timestamp())`,
    [ids.billingPolicy, `twilio-isv-${ids.billingPolicy}`]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1, $2, $3, $4, 'Twilio ISV Project')`,
    [ids.project, ids.organization, ids.owner, ids.billingPolicy]
  );
  await pool.query(
    `insert into ss.hosted_account_profiles (user_id, display_name, state)
     values ($1, 'Twilio Operator', 'active'),
            ($2, 'Twilio Authorizer', 'active')`,
    [ids.operator, ids.authorizer]
  );
  await pool.query(
    `insert into ss.operator_profiles (
       user_id, display_label, state, authorized_by_user_id, authorized_at
     ) values ($1, 'Twilio Operator', 'held', $2, clock_timestamp())`,
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function topology(organizationId, namespace = "primary") {
  const selected = {
    organizationId,
    registrationClass: "LOW_VOLUME_STANDARD",
    providerBrandType: "STANDARD",
    campaignUseCase: "CUSTOMER_CARE"
  };
  for (const field of [
    "accountSidDigest",
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
  ]) selected[field] = sha256(`${namespace}:${field}`);
  return selected;
}

test("customer topology attests, resolves, replays, and retires on real PostgreSQL", {
  skip: !DATABASE_URL
}, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const ids = await seed(pool);
    const authority = createCanonicalPostgresAuthority({ pool });
    const repository =
      createPostgresResponderTwilioProviderTopologyRepository({
        authority
      });
    assert.equal((await repository.readiness()).ready, true);
    const actor = {
      kind: "operator",
      userId: ids.operator,
      organizationId: ids.organization
    };
    const selectedTopology = topology(ids.organization);
    const input = {
      commandId: "twilio-isv-topology-integration-0001",
      requestDigest: "c".repeat(64),
      ...selectedTopology,
      providerReadbackDigest: "d".repeat(64),
      topologyEvidenceDigest: "e".repeat(64),
      recordedAt: new Date().toISOString()
    };
    const attested = await repository.attestTopology(actor, input);
    assert.equal(attested.state, "active");
    assert.equal(attested.organizationId, ids.organization);
    assert.equal(attested.providerEffects, false);
    assert.equal(
      (await repository.attestTopology(actor, input)).replayed,
      true
    );
    assert.equal(
      (await repository.requireActiveTopology(selectedTopology)).id,
      attested.id
    );
    assert.equal(
      (await repository.listTopologies(actor, ids.organization))
        .topologies.length,
      1
    );
    const secondTopology = topology(ids.secondOrganization, "second");
    secondTopology.voiceApiKeySidDigest =
      selectedTopology.messagingApiKeySidDigest;
    await assert.rejects(
      repository.attestTopology({
        ...actor,
        organizationId: ids.secondOrganization
      }, {
        commandId: "twilio-isv-topology-integration-0002",
        requestDigest: "a".repeat(64),
        ...secondTopology,
        providerReadbackDigest: "b".repeat(64),
        topologyEvidenceDigest: "9".repeat(64),
        recordedAt: new Date().toISOString()
      }),
      { code: "RESPONDER_TWILIO_TOPOLOGY_CONFLICT" }
    );
    const bindingId = randomUUID();
    const bindingAt = new Date(Date.parse(input.recordedAt) + 500).toISOString();
    await authority.service({
      actorKind: "operator",
      userId: ids.operator,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.responder_provider_number_bindings (
         id, command_id, request_digest, organization_id, project_id,
         provider, number_lookup_digest, lookup_key_version,
         phone_number_sid_digest, account_sid_digest,
         messaging_service_sid_digest, provider_readback_digest, state,
         provisioned_by_user_id, provision_evidence_digest,
         provisioned_at, revision, created_at, updated_at
       ) values (
         $1, 'twilio-isv-binding-integration-0001', $2, $3, $4,
         'twilio', $5, 'v1', $6, $7, $8, $9, 'active', $10, $11,
         $12, 1, $12, $12
       )`,
      [
        bindingId, "1".repeat(64), ids.organization, ids.project,
        "2".repeat(64), "3".repeat(64),
        selectedTopology.accountSidDigest,
        selectedTopology.messagingServiceSidDigest,
        "4".repeat(64), ids.operator, "5".repeat(64), bindingAt
      ]
    ));
    await assert.rejects(
      repository.retireTopology(actor, {
        organizationId: ids.organization,
        topologyId: attested.id,
        reason: "operator_correction",
        retireEvidenceDigest: "f".repeat(64),
        recordedAt: new Date(Date.parse(input.recordedAt) + 1_000).toISOString()
      }),
      { code: "RESPONDER_TWILIO_TOPOLOGY_CONFLICT" }
    );
    const bindingRetiredAt =
      new Date(Date.parse(input.recordedAt) + 1_500).toISOString();
    await authority.service({
      actorKind: "operator",
      userId: ids.operator,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_provider_number_bindings
          set state = 'retired', retired_at = $2, retired_by_user_id = $3,
              retire_evidence_digest = $4, retired_reason = 'operator_correction',
              revision = revision + 1, updated_at = $2
        where id = $1`,
      [bindingId, bindingRetiredAt, ids.operator, "6".repeat(64)]
    ));
    const retired = await repository.retireTopology(actor, {
      organizationId: ids.organization,
      topologyId: attested.id,
      reason: "operator_correction",
      retireEvidenceDigest: "f".repeat(64),
      recordedAt: new Date(Date.parse(input.recordedAt) + 2_000).toISOString()
    });
    assert.equal(retired.state, "retired");
    await assert.rejects(
      repository.requireActiveTopology(selectedTopology),
      { code: "RESPONDER_TWILIO_TOPOLOGY_NOT_ACTIVE" }
    );
  } finally {
    await pool.end();
  }
});
