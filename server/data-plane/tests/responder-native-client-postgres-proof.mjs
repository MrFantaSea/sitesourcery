import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

import { createPostgresResponderNativeClientRepository } from
  "../../hosted/responder-native-client-postgres.mjs";
import { createResponderNativeTokenAuthority } from
  "../../hosted/responder-native-token-authority.mjs";
import { createTwilioResponderVoiceAccess } from
  "../../hosted/twilio-responder-voice-access.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";
import { canonicalJson, digest } from "../../hosted/security.mjs";

const EXPECTED_GATES = Object.freeze([
  "storage-contract-acl-readiness-held",
  "storage-acl-drift-fails-readiness",
  "legacy-token-reobserved-as-receipt-bound",
  "create-command-replay-and-semantic-deduplication",
  "organization-scoped-command-independence",
  "sealed-notification-registration-and-replay",
  "cross-tenant-token-reassignment-denied",
  "ios-voip-registration-remains-provider-held",
  "voice-replay-requires-active-membership",
  "sealed-voice-session-replay-expiry-and-renewal",
  "expired-voice-sessions-release-retired-keys",
  "android-dual-purpose-fcm-ownership",
  "android-voice-session-platform-transport",
  "cross-tenant-cross-purpose-ownership-denied",
  "legacy-cross-purpose-reassignment-denied",
  "direct-sql-platform-transport-mismatch-denied",
  "same-current-token-launch-readback",
  "same-customer-token-shares-across-projects",
  "token-rotation-and-explicit-retirement",
  "revision-fencing-rejects-stale-write",
  "deferred-evidence-and-append-only-guards",
  "logout-suspension-resume-and-terminal-revocation",
  "digest-only-projection-and-zero-external-effects"
]);

async function expectCode(work, code) {
  await assert.rejects(async () => work(), (error) => error?.code === code);
}

async function seed(pool) {
  const ids = {
    billing: randomUUID(),
    customer: randomUUID(),
    organization: randomUUID(),
    project: randomUUID(),
    secondProject: randomUUID(),
    otherBilling: randomUUID(),
    otherCustomer: randomUUID(),
    otherOrganization: randomUUID(),
    otherProject: randomUUID()
  };
  await pool.query(
    `insert into auth.users (id, email) values
       ($1,$2),($3,$4)`,
    [
      ids.customer, `native-${ids.customer}@example.test`,
      ids.otherCustomer, `native-${ids.otherCustomer}@example.test`
    ]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values
       ($1,$2,interval '14 days',interval '90 days',clock_timestamp()),
       ($3,$4,interval '14 days',interval '90 days',clock_timestamp())`,
    [
      ids.billing, `native-${ids.billing}`,
      ids.otherBilling, `native-${ids.otherBilling}`
    ]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name) values
       ($1,$2,'Native Client Proof'),
       ($3,$4,'Native Client Other Tenant')`,
    [
      ids.organization, ids.customer,
      ids.otherOrganization, ids.otherCustomer
    ]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values
       ($1,$2,'owner','active',clock_timestamp()),
       ($3,$4,'owner','active',clock_timestamp())`,
    [
      ids.organization, ids.customer,
      ids.otherOrganization, ids.otherCustomer
    ]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values
       ($1,$2,$3,$4,'Native Client Project'),
       ($5,$2,$3,$4,'Native Client Second Project'),
       ($6,$7,$8,$9,'Native Client Other Project')`,
    [
      ids.project, ids.organization, ids.customer, ids.billing,
      ids.secondProject, ids.otherProject, ids.otherOrganization,
      ids.otherCustomer, ids.otherBilling
    ]
  );
  return ids;
}

const E1_UPGRADE_FIXTURE = Object.freeze({
  billing: "61000000-0000-4000-8000-000000000001",
  customer: "61000000-0000-4000-8000-000000000002",
  organization: "61000000-0000-4000-8000-000000000003",
  project: "61000000-0000-4000-8000-000000000004",
  installation: "61000000-0000-4000-8000-000000000005",
  firstRegistration: "61000000-0000-4000-8000-000000000006",
  secondRegistration: "61000000-0000-4000-8000-000000000007"
});
const LEGACY_ANDROID_TOKEN = "fcm:legacy_upgrade_token_1234567890";
const LEGACY_TOKEN_PEPPER = Buffer.alloc(32, 19);
const LEGACY_TOKEN_VERSION = "native-pg-v1";
const LEGACY_LOOKUP_PURPOSE =
  "sitesourcery.responder-native-push-token-lookup/v1";
const LEGACY_ENCRYPTION_PURPOSE =
  "sitesourcery.responder-native-push-token-encryption/v1";

function legacyPurposeKey(purpose) {
  return createHmac("sha256", LEGACY_TOKEN_PEPPER)
    .update(purpose, "utf8").digest();
}

function legacyTokenEnvelope(authority, purpose, token) {
  const tokenLookupDigest = createHmac(
    "sha256", legacyPurposeKey(LEGACY_LOOKUP_PURPOSE)
  ).update(canonicalJson({
    schema: LEGACY_LOOKUP_PURPOSE,
    platform: authority.platform,
    bundleId: authority.bundleId,
    environment: authority.environment,
    purpose,
    token
  }), "utf8").digest("hex");
  const nonce = Buffer.alloc(12, 31);
  const cipher = createCipheriv(
    "aes-256-gcm", legacyPurposeKey(LEGACY_ENCRYPTION_PURPOSE), nonce
  );
  cipher.setAAD(Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token-aad/v1",
    ...authority,
    purpose,
    keyVersion: LEGACY_TOKEN_VERSION,
    tokenLookupDigest
  }), "utf8"));
  const cleartext = Buffer.from(canonicalJson({
    schema: "sitesourcery.responder-native-push-token/v1",
    token
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(cleartext), cipher.final()]);
  cleartext.fill(0);
  return {
    tokenLookupDigest,
    nonce,
    authenticationTag: cipher.getAuthTag(),
    ciphertext
  };
}

export async function seedResponderNativeE1UpgradeHistory(pool) {
  const ids = E1_UPGRADE_FIXTURE;
  await pool.query(
    `insert into auth.users (id, email) values ($1,$2)`,
    [ids.customer, "native-e1-upgrade@example.test"]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period, effective_at
     ) values (
       $1,'native-e1-upgrade',interval '14 days',interval '90 days',
       '2026-08-16T10:00:00.000Z'
     )`,
    [ids.billing]
  );
  await pool.query(
    `insert into ss.organizations (id, created_by_user_id, name)
     values ($1,$2,'Native E1 Upgrade Proof')`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1,$2,'owner','active','2026-08-16T10:00:00.000Z')`,
    [ids.organization, ids.customer]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id, billing_policy_id, name
     ) values ($1,$2,$3,$4,'Native E1 Upgrade Project')`,
    [ids.project, ids.organization, ids.customer, ids.billing]
  );

  const authority = createCanonicalPostgresAuthority({ pool });
  await authority.service({
    actorKind: "customer",
    userId: ids.customer,
    organizationId: ids.organization,
    isolation: "serializable"
  }, async (client) => {
    const installationPayload = await client.query(
      `select ss.responder_native_installation_payload_digest_v1(
         $1,$2,$3,'android','com.sitesourcery.responder','sandbox','1.0.0','1',$4
       ) as digest`,
      [
        ids.organization, ids.project, ids.customer,
        digest("native-e1-upgrade-installation")
      ]
    );
    const createRequest = await client.query(
      `select ss.responder_native_command_request_digest_v1(
         $1,$2,$3,$4,'create_installation',0,1,null,$5
       ) as digest`,
      [
        ids.customer, ids.organization, ids.project, ids.installation,
        installationPayload.rows[0].digest
      ]
    );
    await client.query(
      `insert into ss.responder_native_commands (
         organization_id, command_id, request_digest, project_id,
         installation_id, actor_user_id, operation, expected_revision,
         resulting_revision, resulting_state, push_purpose, payload_digest,
         created_at
       ) values (
         $1,'native.e1.upgrade.create.0001',$2,$3,$4,$5,
         'create_installation',0,1,'active',null,$6,$7
       )`,
      [
        ids.organization, createRequest.rows[0].digest, ids.project,
        ids.installation, ids.customer, installationPayload.rows[0].digest,
        "2026-08-16T10:01:00.000Z"
      ]
    );
    await client.query(
      `insert into ss.responder_native_installations (
         id, organization_id, project_id, customer_user_id,
         create_command_id, platform, bundle_id, app_environment,
         app_version, build_number, installation_key_digest, created_at
       ) values (
         $1,$2,$3,$4,'native.e1.upgrade.create.0001','android',
         'com.sitesourcery.responder','sandbox','1.0.0','1',$5,$6
       )`,
      [
        ids.installation, ids.organization, ids.project, ids.customer,
        digest("native-e1-upgrade-installation"),
        "2026-08-16T10:01:00.000Z"
      ]
    );

    const register = async ({
      commandId: selectedCommandId,
      registrationId,
      expectedRevision,
      tokenLookupDigest,
      fill,
      sealed = null,
      createdAt
    }) => {
      const nonce = sealed?.nonce ?? Buffer.alloc(12, fill);
      const authenticationTag = sealed?.authenticationTag ?? Buffer.alloc(16, fill + 1);
      const ciphertext = sealed?.ciphertext ?? Buffer.alloc(64, fill + 2);
      const digests = await client.query(
        `select
           ss.responder_native_token_envelope_digest_v1(
             $1,$2,$3,$4,$5
           ) as envelope_digest,
           ss.responder_native_token_payload_digest_v1(
             'notification',$1
           ) as payload_digest`,
        [
          tokenLookupDigest, LEGACY_TOKEN_VERSION,
          nonce, authenticationTag, ciphertext
        ]
      );
      const request = await client.query(
        `select ss.responder_native_command_request_digest_v1(
           $1,$2,$3,$4,'register_token',$5,$6,'notification',$7
         ) as digest`,
        [
          ids.customer, ids.organization, ids.project, ids.installation,
          expectedRevision, expectedRevision + 1,
          digests.rows[0].payload_digest
        ]
      );
      await client.query(
        `insert into ss.responder_native_commands (
           organization_id, command_id, request_digest, project_id,
           installation_id, token_registration_id, actor_user_id, operation,
           expected_revision, resulting_revision, resulting_state,
           push_purpose, payload_digest, created_at
         ) values (
           $1,$2,$3,$4,$5,$6,$7,'register_token',$8,$9,'active',
           'notification',$10,$11
         )`,
        [
          ids.organization, selectedCommandId, request.rows[0].digest,
          ids.project, ids.installation, registrationId, ids.customer,
          expectedRevision, expectedRevision + 1,
          digests.rows[0].payload_digest, createdAt
        ]
      );
      await client.query(
        `insert into ss.responder_native_push_token_registrations (
           id, organization_id, project_id, installation_id, command_id,
           push_purpose, token_lookup_digest, key_version, nonce,
           authentication_tag, ciphertext, envelope_digest, created_at
         ) values (
           $1,$2,$3,$4,$5,'notification',$6,$7,$8,$9,$10,$11,$12
         )`,
        [
          registrationId, ids.organization, ids.project, ids.installation,
          selectedCommandId, tokenLookupDigest, LEGACY_TOKEN_VERSION,
          nonce, authenticationTag, ciphertext,
          digests.rows[0].envelope_digest, createdAt
        ]
      );
    };

    const legacyAuthority = {
      id: ids.installation,
      organizationId: ids.organization,
      projectId: ids.project,
      userId: ids.customer,
      platform: "android",
      bundleId: "com.sitesourcery.responder",
      environment: "sandbox"
    };
    const sealedLegacy = legacyTokenEnvelope(
      legacyAuthority, "notification", LEGACY_ANDROID_TOKEN
    );
    await register({
      commandId: "native.e1.upgrade.token.0001",
      registrationId: ids.firstRegistration,
      expectedRevision: 1,
      tokenLookupDigest: digest("native-e1-upgrade-token-one"),
      fill: 11,
      createdAt: "2026-08-16T10:02:00.000Z"
    });
    await register({
      commandId: "native.e1.upgrade.token.0002",
      registrationId: ids.secondRegistration,
      expectedRevision: 2,
      tokenLookupDigest: sealedLegacy.tokenLookupDigest,
      fill: 21,
      sealed: sealedLegacy,
      createdAt: "2026-08-16T10:03:00.000Z"
    });
  });
  return ids;
}

export async function verifyResponderNativeE2UpgradeHistory(pool, ids) {
  assert.deepEqual(ids, E1_UPGRADE_FIXTURE);
  const result = await pool.query(
    `select
       (select count(*)::integer
          from ss.responder_native_push_token_registrations registration
         where registration.organization_id = $1
           and registration.installation_id = $2) as registrations,
       (select count(*)::integer
          from ss.responder_native_push_token_retirements retirement
         where retirement.organization_id = $1
           and retirement.installation_id = $2) as retirements,
       (select count(*)::integer
          from ss.responder_native_push_token_registrations registration
          left join ss.responder_native_push_token_retirements retirement
            on retirement.organization_id = registration.organization_id
           and retirement.registration_id = registration.id
         where registration.organization_id = $1
           and registration.installation_id = $2
           and retirement.id is null) as active_registrations,
       exists (
         select 1
           from ss.responder_native_push_token_retirements retirement
           join ss.responder_native_commands command
             on command.organization_id = retirement.organization_id
            and command.command_id = retirement.command_id
          where retirement.organization_id = $1
            and retirement.installation_id = $2
            and retirement.registration_id = $3
            and retirement.replacement_registration_id = $4
            and retirement.reason = 'token_replaced'
            and command.token_registration_id = $4
            and command.token_retirement_id = retirement.id
       ) as exact_chain`,
    [
      ids.organization, ids.installation,
      ids.firstRegistration, ids.secondRegistration
    ]
  );
  assert.deepEqual(result.rows[0], {
    registrations: 2,
    retirements: 1,
    active_registrations: 1,
    exact_chain: true
  });
  return Object.freeze({
    assertions: 1,
    expectedAssertions: 1,
    registrations: 2,
    retirements: 1,
    activeRegistrations: 1
  });
}

export async function verifyResponderNativeE3UpgradeHistory(
  pool,
  ids,
  { activeVoiceDrainRejected = false } = {}
) {
  assert.deepEqual(ids, E1_UPGRADE_FIXTURE);
  assert.equal(activeVoiceDrainRejected, true);
  const result = await pool.query(
    `select
       count(*)::integer as registrations,
       bool_and(token_ownership_digest = token_lookup_digest) as conservative,
       bool_and(token_ownership_kind = 'legacy_purpose_bound') as legacy,
       ss.hosted_responder_android_voice_contract_v1() =
         'canonical-responder-android-voice-v1-fcm-dual-purpose-receipt-bound-held'
         as contract_ready
       from ss.responder_native_push_token_registrations
      where organization_id = $1 and installation_id = $2`,
    [ids.organization, ids.installation]
  );
  assert.deepEqual(result.rows[0], {
    registrations: 2,
    conservative: true,
    legacy: true,
    contract_ready: true
  });
  const encrypted = await pool.query(
    `select key_version, token_lookup_digest, token_ownership_digest,
            token_receipt_digest, nonce, authentication_tag, ciphertext
       from ss.responder_native_push_token_registrations
      where organization_id = $1 and id = $2`,
    [ids.organization, ids.secondRegistration]
  );
  assert.equal(encrypted.rowCount, 1);
  const tokenAuthority = createResponderNativeTokenAuthority({
    pepper: LEGACY_TOKEN_PEPPER,
    pepperVersion: LEGACY_TOKEN_VERSION,
    randomBytes: () => Buffer.alloc(12, 1)
  });
  assert.equal(await tokenAuthority.openToken({
    id: ids.installation,
    organizationId: ids.organization,
    projectId: ids.project,
    userId: ids.customer,
    platform: "android",
    bundleId: "com.sitesourcery.responder",
    environment: "sandbox"
  }, "notification", {
    keyVersion: encrypted.rows[0].key_version,
    tokenLookupDigest: encrypted.rows[0].token_lookup_digest,
    tokenOwnershipDigest: encrypted.rows[0].token_ownership_digest,
    tokenReceiptDigest: encrypted.rows[0].token_receipt_digest,
    nonce: encrypted.rows[0].nonce,
    authenticationTag: encrypted.rows[0].authentication_tag,
    ciphertext: encrypted.rows[0].ciphertext
  }), LEGACY_ANDROID_TOKEN);
  return Object.freeze({
    assertions: 3,
    expectedAssertions: 3,
    registrations: 2,
    conservativeLegacyOwnership: true,
    legacyCiphertextReadable: true,
    activeVoiceDrainRejected: true
  });
}

export async function verifyResponderNativeClientPostgres(pool) {
  const gates = [];
  const passed = (name) => gates.push(name);
  const ids = await seed(pool);
  const authority = createCanonicalPostgresAuthority({ pool });
  let nonce = 0;
  const tokenAuthority = createResponderNativeTokenAuthority({
    pepper: Buffer.alloc(32, 19),
    pepperVersion: "native-pg-v1",
    randomBytes: () => Buffer.alloc(12, ++nonce)
  });
  const heldVoiceAccess = createTwilioResponderVoiceAccess({
    pepper: Buffer.alloc(32, 19),
    pepperVersion: "native-pg-v1",
    environment: {}
  });
  let voiceNonce = 0;
  let voiceToken = 0;
  const verifiedVoiceAccess = createTwilioResponderVoiceAccess({
    pepper: Buffer.alloc(32, 19),
    pepperVersion: "native-pg-v1",
    environment: {
      SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified",
      SITESOURCERY_TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`,
      SITESOURCERY_TWILIO_VOICE_API_KEY_SID: `SK${"2".repeat(32)}`,
      SITESOURCERY_TWILIO_VOICE_API_KEY_SECRET:
        "voice-pg-proof-secret-".padEnd(40, "3"),
      SITESOURCERY_TWILIO_VOICE_SANDBOX_PUSH_CREDENTIAL_SID:
        `CR${"4".repeat(32)}`,
      SITESOURCERY_TWILIO_VOICE_PRODUCTION_PUSH_CREDENTIAL_SID:
        `CR${"5".repeat(32)}`,
      SITESOURCERY_TWILIO_VOICE_ANDROID_SANDBOX_PUSH_CREDENTIAL_SID:
        `CR${"6".repeat(32)}`,
      SITESOURCERY_TWILIO_VOICE_ANDROID_PRODUCTION_PUSH_CREDENTIAL_SID:
        `CR${"7".repeat(32)}`
    },
    randomBytes() {
      const selected = Buffer.alloc(12);
      selected.writeUInt32BE(++voiceNonce, 8);
      return selected;
    },
    tokenFactory({
      accountSid, apiKeySid, apiKeySecret, identity, endpointId,
      pushCredentialSid, ttlSeconds
    }) {
      const issuedAt = Math.floor(Date.now() / 1000) - 297;
      return jwt.sign({
        iat: issuedAt,
        jti: `${apiKeySid}-${issuedAt}-${++voiceToken}`,
        grants: {
          identity,
          voice: {
            incoming: { allow: true },
            push_credential_sid: pushCredentialSid,
            endpoint_id: endpointId
          }
        }
      }, apiKeySecret, {
        algorithm: "HS256",
        issuer: apiKeySid,
        subject: accountSid,
        expiresIn: ttlSeconds,
        header: { cty: "twilio-fpa;v=1", typ: "JWT" }
      });
    }
  });
  const repository = createPostgresResponderNativeClientRepository({
    authority,
    verifierKeyVersions: [...tokenAuthority.verifierVersions],
    voiceAccess: heldVoiceAccess
  });
  const verifiedRepository = createPostgresResponderNativeClientRepository({
    authority,
    verifierKeyVersions: [...tokenAuthority.verifierVersions],
    voiceAccess: verifiedVoiceAccess
  });
  const customer = {
    kind: "customer",
    userId: ids.customer,
    organizationId: ids.organization
  };
  const otherCustomer = {
    kind: "customer",
    userId: ids.otherCustomer,
    organizationId: ids.otherOrganization
  };
  let selectedNow = new Date().toISOString();
  const tick = () => {
    selectedNow = new Date(Date.parse(selectedNow) + 25).toISOString();
    return selectedNow;
  };

  const privileges = await pool.query(`
    select
      (select count(*) = 6 and bool_and(c.relrowsecurity)
         and bool_and(c.relforcerowsecurity)
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ss' and c.relname = any($1::text[])
      ) as forced_rls,
      has_table_privilege(
        'service_role','ss.responder_native_commands','select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_native_commands','update,delete'
      ) as command_acl,
      has_table_privilege(
        'service_role','ss.responder_native_push_token_registrations',
        'select,insert'
      ) and not has_table_privilege(
        'service_role','ss.responder_native_push_token_registrations',
        'update,delete'
      ) as token_acl,
      not has_table_privilege(
        'authenticated','ss.responder_native_installations',
        'select,insert,update,delete,truncate,references,trigger'
      ) as authenticated_denied
  `, [[
    "responder_native_commands",
    "responder_native_installations",
    "responder_native_push_token_registrations",
    "responder_native_state_transitions",
    "responder_native_push_token_retirements",
    "responder_native_voice_sessions"
  ]]);
  assert.deepEqual(privileges.rows[0], {
    forced_rls: true,
    command_acl: true,
    token_acl: true,
    authenticated_denied: true
  });
  assert.deepEqual(await repository.readiness(), {
    ready: true,
    verified: true,
    kind: "responder-native-client-postgres",
    mode: "held-local",
    voipSessionState: "held",
    providerAuthorizationEffects: false,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false,
    code: null
  });
  passed("storage-contract-acl-readiness-held");

  await pool.query(
    "grant truncate on ss.responder_native_commands to authenticated"
  );
  try {
    assert.deepEqual(await repository.readiness(), {
      ready: false,
      verified: false,
      kind: "responder-native-client-postgres",
      mode: "held-local",
      voipSessionState: "held",
      providerAuthorizationEffects: false,
      providerEffects: false,
      pushDeliveryEffects: false,
      voiceCallEffects: false,
      carrierCommandEffects: false,
      messageSendEffects: false,
      code: "RESPONDER_NATIVE_CLIENT_STORAGE_NOT_READY"
    });
  } finally {
    await pool.query(
      "revoke truncate on ss.responder_native_commands from authenticated"
    );
  }
  assert.equal((await repository.readiness()).ready, true);
  await pool.query(
    `revoke execute on function ss.responder_native_token_payload_digest_v2(
       text, ss.sha256_hex, ss.sha256_hex, ss.sha256_hex
     ) from service_role`
  );
  try {
    assert.equal((await repository.readiness()).ready, false);
  } finally {
    await pool.query(
      `grant execute on function ss.responder_native_token_payload_digest_v2(
         text, ss.sha256_hex, ss.sha256_hex, ss.sha256_hex
      ) to service_role`
    );
  }
  await pool.query(
    `revoke execute on function
       ss.responder_native_voice_session_request_digest_v2(
         uuid, uuid, uuid, uuid, bigint, text, text, text, ss.sha256_hex
       ) from service_role`
  );
  try {
    assert.equal((await repository.readiness()).ready, false);
  } finally {
    await pool.query(
      `grant execute on function
         ss.responder_native_voice_session_request_digest_v2(
           uuid, uuid, uuid, uuid, bigint, text, text, text, ss.sha256_hex
         ) to service_role`
    );
  }
  await pool.query(
    `alter table ss.responder_native_push_token_registrations
       disable trigger responder_native_push_tokens_guard`
  );
  try {
    assert.equal((await repository.readiness()).ready, false);
  } finally {
    await pool.query(
      `alter table ss.responder_native_push_token_registrations
         enable trigger responder_native_push_tokens_guard`
    );
  }
  await pool.query(
    `alter table ss.responder_native_voice_sessions
       disable trigger responder_native_voice_sessions_guard`
  );
  try {
    assert.equal((await repository.readiness()).ready, false);
  } finally {
    await pool.query(
      `alter table ss.responder_native_voice_sessions
         enable trigger responder_native_voice_sessions_guard`
    );
  }
  await pool.query(
    `alter table ss.responder_native_voice_sessions
       drop constraint responder_native_voice_platform_transport_check,
       add constraint responder_native_voice_platform_transport_check check (
         (client_platform = 'ios' and transport = 'twilio_voice_ios')
         or (client_platform = 'android'
           and transport = 'twilio_voice_android')
       ) not valid`
  );
  try {
    assert.equal((await repository.readiness()).ready, false);
  } finally {
    await pool.query(
      `alter table ss.responder_native_voice_sessions validate constraint
         responder_native_voice_platform_transport_check`
    );
  }
  assert.equal((await repository.readiness()).ready, true);
  passed("storage-acl-drift-fails-readiness");

  const legacyCustomer = {
    kind: "customer",
    userId: E1_UPGRADE_FIXTURE.customer,
    organizationId: E1_UPGRADE_FIXTURE.organization
  };
  const legacyScope = {
    id: E1_UPGRADE_FIXTURE.installation,
    organizationId: E1_UPGRADE_FIXTURE.organization,
    projectId: E1_UPGRADE_FIXTURE.project,
    userId: E1_UPGRADE_FIXTURE.customer,
    platform: "android",
    bundleId: "com.sitesourcery.responder",
    environment: "sandbox"
  };
  const legacySelectedCandidates = tokenAuthority.tokenLookupCandidates(
    legacyScope, "notification", LEGACY_ANDROID_TOKEN
  );
  const legacyAllCandidates = ["notification", "voip"].flatMap(
    (purpose) => tokenAuthority.tokenLookupCandidates(
      legacyScope, purpose, LEGACY_ANDROID_TOKEN
    ).map((entry) => entry.digest)
  );
  const legacySealed = await tokenAuthority.sealToken(
    legacyScope, "notification", LEGACY_ANDROID_TOKEN
  );
  const legacyReobserved = await repository.registerToken(legacyCustomer, {
    commandId: "native.pg.legacy.reobserve.0001",
    registrationId: randomUUID(),
    organizationId: E1_UPGRADE_FIXTURE.organization,
    projectId: E1_UPGRADE_FIXTURE.project,
    installationId: E1_UPGRADE_FIXTURE.installation,
    expectedRevision: 3,
    pushPurpose: "notification",
    tokenLookupCandidateDigests:
      legacySelectedCandidates.map((entry) => entry.digest),
    tokenCollisionCandidateDigests: [...new Set(legacyAllCandidates)],
    tokenOwnershipCandidateDigests:
      legacySelectedCandidates.map((entry) => entry.ownershipDigest),
    envelope: legacySealed,
    recordedAt: tick()
  });
  assert.equal(legacyReobserved.installation.revision, 4);
  assert.equal(
    legacyReobserved.tokenReceiptDigest,
    legacySealed.tokenReceiptDigest
  );
  assert.deepEqual((await pool.query(
    `select
       count(*) filter (
         where registration.token_ownership_kind = 'legacy_purpose_bound'
           and retirement.id is null
       )::integer as active_legacy,
       count(*) filter (
         where registration.token_ownership_kind = 'physical_v1'
           and retirement.id is null
       )::integer as active_physical
       from ss.responder_native_push_token_registrations registration
       left join ss.responder_native_push_token_retirements retirement
         on retirement.organization_id = registration.organization_id
        and retirement.registration_id = registration.id
      where registration.organization_id = $1
        and registration.installation_id = $2`,
    [E1_UPGRADE_FIXTURE.organization, E1_UPGRADE_FIXTURE.installation]
  )).rows[0], { active_legacy: 0, active_physical: 1 });
  passed("legacy-token-reobserved-as-receipt-bound");

  const createInput = {
    commandId: "native.pg.create.0001",
    installationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    platform: "ios",
    bundleId: "com.sitesourcery.responder",
    appEnvironment: "sandbox",
    appVersion: "1.0.0",
    buildNumber: "1",
    installationKeyDigest: digest("native.pg.installation-key.0001"),
    recordedAt: tick()
  };
  const created = await repository.createInstallation(customer, createInput);
  assert.equal(created.installation.state, "active");
  assert.equal(created.installation.revision, 1);
  const replay = await repository.createInstallation(customer, {
    ...createInput,
    installationId: randomUUID(),
    recordedAt: tick()
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.installation.id, created.installation.id);
  const semantic = await repository.createInstallation(customer, {
    ...createInput,
    commandId: "native.pg.create.semantic.0002",
    installationId: randomUUID(),
    recordedAt: tick()
  });
  assert.equal(semantic.semanticReplay, true);
  assert.equal(semantic.installation.id, created.installation.id);
  const createCounts = await pool.query(
    `select
       (select count(*)::integer from ss.responder_native_installations
         where organization_id = $1) as installations,
       (select count(*)::integer from ss.responder_native_commands
         where organization_id = $1) as commands`,
    [ids.organization]
  );
  assert.deepEqual(createCounts.rows[0], { installations: 1, commands: 1 });
  passed("create-command-replay-and-semantic-deduplication");

  const otherCreated = await repository.createInstallation(otherCustomer, {
    ...createInput,
    installationId: randomUUID(),
    organizationId: ids.otherOrganization,
    projectId: ids.otherProject,
    recordedAt: tick()
  });
  assert.equal(otherCreated.commandId, createInput.commandId);
  assert.notEqual(otherCreated.installation.id, created.installation.id);
  await expectCode(
    () => repository.getInstallation(otherCustomer, {
      organizationId: ids.otherOrganization,
      projectId: ids.otherProject,
      installationId: created.installation.id
    }),
    "RESPONDER_NATIVE_CLIENT_UNAVAILABLE"
  );
  passed("organization-scoped-command-independence");

  const tokenScope = {
    id: created.installation.id,
    organizationId: ids.organization,
    projectId: ids.project,
    userId: ids.customer,
    platform: "ios",
    bundleId: created.installation.bundleId,
    environment: created.installation.appEnvironment
  };
  const notificationToken = "ab".repeat(32);
  const notificationCandidates = tokenAuthority.tokenLookupCandidates(
    tokenScope, "notification", notificationToken
  );
  const firstNotificationEnvelope = await tokenAuthority.sealToken(
    tokenScope, "notification", notificationToken
  );
  const notificationInput = {
    commandId: "native.pg.notification.0001",
    registrationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 1,
    pushPurpose: "notification",
    tokenLookupCandidateDigests:
      notificationCandidates.map((entry) => entry.digest),
    tokenOwnershipCandidateDigests:
      notificationCandidates.map((entry) => entry.ownershipDigest),
    envelope: firstNotificationEnvelope,
    recordedAt: tick()
  };
  const notification = await repository.registerToken(
    customer, notificationInput
  );
  assert.equal(notification.installation.revision, 2);
  assert.equal(
    notification.tokenReceiptDigest,
    firstNotificationEnvelope.tokenReceiptDigest
  );
  assert.equal(notification.installation.pushRegistrations.length, 1);
  const retryEnvelope = await tokenAuthority.sealToken(
    tokenScope, "notification", notificationToken
  );
  assert.notDeepEqual(retryEnvelope.nonce, firstNotificationEnvelope.nonce);
  const notificationReplay = await repository.registerToken(customer, {
    ...notificationInput,
    registrationId: randomUUID(),
    envelope: retryEnvelope,
    recordedAt: tick()
  });
  assert.equal(notificationReplay.replayed, true);
  assert.equal(
    notificationReplay.tokenReceiptDigest,
    firstNotificationEnvelope.tokenReceiptDigest
  );
  assert.equal(notificationReplay.installation.revision, 2);
  assert.equal(notificationReplay.installation.pushRegistrations.length, 1);
  assert.doesNotMatch(
    JSON.stringify(notificationReplay),
    new RegExp(notificationToken, "u")
  );
  passed("sealed-notification-registration-and-replay");

  const otherScope = {
    id: otherCreated.installation.id,
    organizationId: ids.otherOrganization,
    projectId: ids.otherProject,
    userId: ids.otherCustomer,
    platform: "ios",
    bundleId: otherCreated.installation.bundleId,
    environment: otherCreated.installation.appEnvironment
  };
  await expectCode(
    async () => repository.registerToken(otherCustomer, {
      ...notificationInput,
      commandId: "native.pg.notification.other.0001",
      registrationId: randomUUID(),
      organizationId: ids.otherOrganization,
      projectId: ids.otherProject,
      installationId: otherCreated.installation.id,
      tokenLookupCandidateDigests: tokenAuthority
        .tokenLookupCandidates(
          otherScope, "notification", notificationToken
        ).map((entry) => entry.digest),
      tokenOwnershipCandidateDigests: tokenAuthority
        .tokenLookupCandidates(
          otherScope, "notification", notificationToken
        ).map((entry) => entry.ownershipDigest),
      envelope: await tokenAuthority.sealToken(
        otherScope, "notification", notificationToken
      ),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_CONFLICT"
  );
  passed("cross-tenant-token-reassignment-denied");

  const voipToken = "cd".repeat(32);
  const voipEnvelope = await tokenAuthority.sealToken(
    tokenScope, "voip", voipToken
  );
  const voip = await repository.registerToken(customer, {
    commandId: "native.pg.voip.0001",
    registrationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 2,
    pushPurpose: "voip",
    tokenLookupCandidateDigests: tokenAuthority
      .tokenLookupCandidates(tokenScope, "voip", voipToken)
      .map((entry) => entry.digest),
    tokenOwnershipCandidateDigests: tokenAuthority
      .tokenLookupCandidates(tokenScope, "voip", voipToken)
      .map((entry) => entry.ownershipDigest),
    envelope: voipEnvelope,
    recordedAt: tick()
  });
  assert.equal(voip.installation.revision, 3);
  const heldVoiceInput = {
    commandId: "native.pg.voice.held.0001",
    sessionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 3
  };
  await expectCode(
    () => repository.issueVoipSession(customer, heldVoiceInput),
    "RESPONDER_NATIVE_VOIP_HELD"
  );
  assert.deepEqual((await pool.query(
    `select count(*)::integer as count
       from ss.responder_native_voice_sessions`
  )).rows[0].count, 0);
  passed("ios-voip-registration-remains-provider-held");

  const voiceInput = {
    ...heldVoiceInput,
    commandId: "native.pg.voice.verified.0001",
    sessionId: randomUUID()
  };
  const issuedVoice = await verifiedRepository.issueVoipSession(
    customer, voiceInput
  );
  assert.equal(
    issuedVoice.schema,
    "sitesourcery.responder-native-voice-session/v1"
  );
  assert.equal(issuedVoice.replayed, false);
  assert.equal(issuedVoice.semanticReplay, false);
  assert.equal(issuedVoice.incomingAllowed, true);
  assert.equal(issuedVoice.outgoingAllowed, false);
  assert.equal(issuedVoice.providerAuthorizationEffects, true);
  assert.equal(issuedVoice.providerEffects, false);
  await pool.query(
    `update ss.organization_memberships set state = 'suspended'
      where organization_id = $1 and user_id = $2`,
    [ids.organization, ids.customer]
  );
  await expectCode(
    () => verifiedRepository.issueVoipSession(customer, {
      ...voiceInput,
      sessionId: randomUUID()
    }),
    "RESPONDER_NATIVE_CLIENT_UNAVAILABLE"
  );
  await pool.query(
    `update ss.organization_memberships set state = 'active'
      where organization_id = $1 and user_id = $2`,
    [ids.organization, ids.customer]
  );
  await expectCode(
    () => verifiedRepository.issueVoipSession({
      ...customer,
      organizationId: ids.otherOrganization
    }, {
      ...voiceInput,
      sessionId: randomUUID()
    }),
    "RESPONDER_NATIVE_CLIENT_INVALID"
  );
  passed("voice-replay-requires-active-membership");
  const voiceReplay = await verifiedRepository.issueVoipSession(customer, {
    ...voiceInput,
    sessionId: randomUUID()
  });
  assert.equal(voiceReplay.replayed, true);
  assert.equal(voiceReplay.semanticReplay, false);
  assert.equal(voiceReplay.sessionId, issuedVoice.sessionId);
  assert.equal(voiceReplay.accessToken, issuedVoice.accessToken);
  const voiceSemantic = await verifiedRepository.issueVoipSession(customer, {
    ...voiceInput,
    commandId: "native.pg.voice.semantic.0002",
    sessionId: randomUUID()
  });
  assert.equal(voiceSemantic.replayed, true);
  assert.equal(voiceSemantic.semanticReplay, true);
  assert.equal(voiceSemantic.sessionId, issuedVoice.sessionId);
  assert.equal(voiceSemantic.accessToken, issuedVoice.accessToken);
  const sealedVoice = await pool.query(
    `select count(*)::integer as count,
            bool_and(position($2::bytea in ciphertext) = 0) as plaintext_absent
       from ss.responder_native_voice_sessions
      where organization_id = $1`,
    [ids.organization, Buffer.from(issuedVoice.accessToken, "utf8")]
  );
  assert.deepEqual(sealedVoice.rows[0], {
    count: 1,
    plaintext_absent: true
  });
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  await expectCode(
    () => verifiedRepository.issueVoipSession(customer, {
      ...voiceInput,
      sessionId: randomUUID()
    }),
    "RESPONDER_NATIVE_VOIP_SESSION_EXPIRED"
  );
  const renewedVoice = await verifiedRepository.issueVoipSession(customer, {
    ...voiceInput,
    commandId: "native.pg.voice.renewed.0003",
    sessionId: randomUUID()
  });
  assert.notEqual(renewedVoice.sessionId, issuedVoice.sessionId);
  assert.notEqual(renewedVoice.accessToken, issuedVoice.accessToken);
  assert.deepEqual((await pool.query(
    `select count(*)::integer as count
       from ss.responder_native_voice_sessions
      where organization_id = $1`,
    [ids.organization]
  )).rows[0], { count: 2 });
  passed("sealed-voice-session-replay-expiry-and-renewal");

  const rotatedVoiceRepository = createPostgresResponderNativeClientRepository({
    authority,
    verifierKeyVersions: [...tokenAuthority.verifierVersions],
    voiceAccess: createTwilioResponderVoiceAccess({
      pepper: Buffer.alloc(32, 20),
      pepperVersion: "native-pg-v2",
      environment: {}
    })
  });
  const activeOldKey = await rotatedVoiceRepository.readiness();
  assert.equal(activeOldKey.ready, false);
  await new Promise((resolve) => setTimeout(resolve, 3_500));
  const expiredOldKey = await rotatedVoiceRepository.readiness();
  assert.equal(expiredOldKey.ready, true);
  passed("expired-voice-sessions-release-retired-keys");

  const androidCreateInput = {
    ...createInput,
    commandId: "native.pg.android.create.0001",
    installationId: randomUUID(),
    platform: "android",
    installationKeyDigest: digest("native.pg.android.installation-key.0001"),
    recordedAt: tick()
  };
  const androidCreated = await repository.createInstallation(
    customer, androidCreateInput
  );
  const androidScope = {
    id: androidCreated.installation.id,
    organizationId: ids.organization,
    projectId: ids.project,
    userId: ids.customer,
    platform: "android",
    bundleId: androidCreated.installation.bundleId,
    environment: androidCreated.installation.appEnvironment
  };
  const fcmToken = "fcm:sitesourcery-proof-token-1234567890";
  const androidNotificationCandidates = tokenAuthority.tokenLookupCandidates(
    androidScope, "notification", fcmToken
  );
  const androidVoipCandidates = tokenAuthority.tokenLookupCandidates(
    androidScope, "voip", fcmToken
  );
  assert.notEqual(
    androidNotificationCandidates[0].digest,
    androidVoipCandidates[0].digest
  );
  assert.equal(
    androidNotificationCandidates[0].ownershipDigest,
    androidVoipCandidates[0].ownershipDigest
  );
  const androidNotification = await repository.registerToken(customer, {
    commandId: "native.pg.android.notification.0001",
    registrationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: androidCreated.installation.id,
    expectedRevision: 1,
    pushPurpose: "notification",
    tokenLookupCandidateDigests:
      androidNotificationCandidates.map((entry) => entry.digest),
    tokenOwnershipCandidateDigests:
      androidNotificationCandidates.map((entry) => entry.ownershipDigest),
    envelope: await tokenAuthority.sealToken(
      androidScope, "notification", fcmToken
    ),
    recordedAt: tick()
  });
  const androidVoip = await repository.registerToken(customer, {
    commandId: "native.pg.android.voip.0001",
    registrationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: androidCreated.installation.id,
    expectedRevision: androidNotification.installation.revision,
    pushPurpose: "voip",
    tokenLookupCandidateDigests:
      androidVoipCandidates.map((entry) => entry.digest),
    tokenOwnershipCandidateDigests:
      androidVoipCandidates.map((entry) => entry.ownershipDigest),
    envelope: await tokenAuthority.sealToken(
      androidScope, "voip", fcmToken
    ),
    recordedAt: tick()
  });
  assert.equal(androidVoip.installation.revision, 3);
  assert.deepEqual((await pool.query(
    `select count(*)::integer as count,
            count(distinct token_lookup_digest)::integer as lookup_digests,
            count(distinct token_ownership_digest)::integer as owner_digests,
            bool_and(token_ownership_kind = 'physical_v1') as physical
       from ss.responder_native_push_token_registrations
      where organization_id = $1 and installation_id = $2`,
    [ids.organization, androidCreated.installation.id]
  )).rows[0], {
    count: 2,
    lookup_digests: 2,
    owner_digests: 1,
    physical: true
  });
  passed("android-dual-purpose-fcm-ownership");

  const androidVoiceInput = {
    commandId: "native.pg.android.voice.verified.0001",
    sessionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: androidCreated.installation.id,
    expectedRevision: 3
  };
  await expectCode(
    () => repository.issueVoipSession(customer, {
      ...androidVoiceInput,
      commandId: "native.pg.android.voice.held.0001",
      sessionId: randomUUID()
    }),
    "RESPONDER_NATIVE_VOIP_HELD"
  );
  const androidVoice = await verifiedRepository.issueVoipSession(
    customer, androidVoiceInput
  );
  assert.equal(androidVoice.clientPlatform, "android");
  assert.equal(androidVoice.transport, "twilio_voice_android");
  assert.equal(androidVoice.incomingAllowed, true);
  assert.equal(androidVoice.outgoingAllowed, false);
  assert.deepEqual((await pool.query(
    `select client_platform, transport,
            provider_authorization_effects,
            not provider_effects and not push_delivery_effects
              and not voice_call_effects and not carrier_command_effects
              and not message_send_effects as zero_external_effects
       from ss.responder_native_voice_sessions where id = $1`,
    [androidVoice.sessionId]
  )).rows[0], {
    client_platform: "android",
    transport: "twilio_voice_android",
    provider_authorization_effects: true,
    zero_external_effects: true
  });
  passed("android-voice-session-platform-transport");

  const otherAndroid = await repository.createInstallation(otherCustomer, {
    ...androidCreateInput,
    installationId: randomUUID(),
    organizationId: ids.otherOrganization,
    projectId: ids.otherProject,
    recordedAt: tick()
  });
  const otherAndroidScope = {
    ...androidScope,
    id: otherAndroid.installation.id,
    organizationId: ids.otherOrganization,
    projectId: ids.otherProject,
    userId: ids.otherCustomer
  };
  const otherAndroidVoipCandidates = tokenAuthority.tokenLookupCandidates(
    otherAndroidScope, "voip", fcmToken
  );
  await expectCode(
    async () => repository.registerToken(otherCustomer, {
      commandId: "native.pg.android.voip.other.0001",
      registrationId: randomUUID(),
      organizationId: ids.otherOrganization,
      projectId: ids.otherProject,
      installationId: otherAndroid.installation.id,
      expectedRevision: 1,
      pushPurpose: "voip",
      tokenLookupCandidateDigests:
        otherAndroidVoipCandidates.map((entry) => entry.digest),
      tokenOwnershipCandidateDigests:
        otherAndroidVoipCandidates.map((entry) => entry.ownershipDigest),
      envelope: await tokenAuthority.sealToken(
        otherAndroidScope, "voip", fcmToken
      ),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_CONFLICT"
  );
  passed("cross-tenant-cross-purpose-ownership-denied");

  const legacyVoipCandidates = tokenAuthority.tokenLookupCandidates(
    otherAndroidScope, "voip", LEGACY_ANDROID_TOKEN
  );
  const legacyCollisionCandidates = ["notification", "voip"].flatMap(
    (purpose) => tokenAuthority.tokenLookupCandidates(
      otherAndroidScope, purpose, LEGACY_ANDROID_TOKEN
    ).map((entry) => entry.digest)
  );
  await expectCode(
    async () => repository.registerToken(otherCustomer, {
      commandId: "native.pg.android.voip.legacy.other.0001",
      registrationId: randomUUID(),
      organizationId: ids.otherOrganization,
      projectId: ids.otherProject,
      installationId: otherAndroid.installation.id,
      expectedRevision: 1,
      pushPurpose: "voip",
      tokenLookupCandidateDigests:
        legacyVoipCandidates.map((entry) => entry.digest),
      tokenCollisionCandidateDigests: [...new Set(legacyCollisionCandidates)],
      tokenOwnershipCandidateDigests:
        legacyVoipCandidates.map((entry) => entry.ownershipDigest),
      envelope: await tokenAuthority.sealToken(
        otherAndroidScope, "voip", LEGACY_ANDROID_TOKEN
      ),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_CONFLICT"
  );
  passed("legacy-cross-purpose-reassignment-denied");

  const voiceCountBeforeMismatch = Number((await pool.query(
    "select count(*) from ss.responder_native_voice_sessions"
  )).rows[0].count);
  await assert.rejects(
    authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `insert into ss.responder_native_voice_sessions (
         id, organization_id, project_id, installation_id, customer_user_id,
         command_id, request_digest, installation_revision, app_environment,
         voip_registration_reference_digest, identity_digest, endpoint_digest,
         credential_digest, jti_digest, token_digest, key_version, nonce,
         authentication_tag, ciphertext, envelope_digest, issued_at,
         expires_at, incoming_allowed, outgoing_allowed,
         provider_authorization_effects, provider_effects,
         push_delivery_effects, voice_call_effects, carrier_command_effects,
         message_send_effects, created_at, client_platform, transport
       )
       select gen_random_uuid(), organization_id, project_id, installation_id,
              customer_user_id, 'native.pg.android.voice.mismatch.0001',
              request_digest, installation_revision, app_environment,
              voip_registration_reference_digest, identity_digest,
              endpoint_digest, credential_digest, jti_digest, token_digest,
              key_version, nonce, authentication_tag, ciphertext,
              envelope_digest, issued_at, expires_at, incoming_allowed,
              outgoing_allowed, provider_authorization_effects,
              provider_effects, push_delivery_effects, voice_call_effects,
              carrier_command_effects, message_send_effects, created_at,
              'ios', 'twilio_voice_android'
         from ss.responder_native_voice_sessions where id = $1`,
      [androidVoice.sessionId]
    )),
    (error) => error?.code === "23514"
  );
  assert.equal(Number((await pool.query(
    "select count(*) from ss.responder_native_voice_sessions"
  )).rows[0].count), voiceCountBeforeMismatch);
  passed("direct-sql-platform-transport-mismatch-denied");

  const launchReadback = await repository.registerToken(customer, {
    ...notificationInput,
    commandId: "native.pg.notification.launch.0001",
    registrationId: randomUUID(),
    expectedRevision: 3,
    tokenLookupCandidateDigests: tokenAuthority
      .tokenLookupCandidates(tokenScope, "notification", notificationToken)
      .map((entry) => entry.digest),
    tokenOwnershipCandidateDigests: tokenAuthority
      .tokenLookupCandidates(tokenScope, "notification", notificationToken)
      .map((entry) => entry.ownershipDigest),
    envelope: await tokenAuthority.sealToken(
      tokenScope, "notification", notificationToken
    ),
    recordedAt: tick()
  });
  assert.equal(launchReadback.replayed, true);
  assert.equal(launchReadback.semanticReplay, true);
  assert.equal(launchReadback.commandId, notification.commandId);
  assert.equal(launchReadback.installation.revision, 3);
  assert.equal(launchReadback.installation.pushRegistrations.length, 2);
  passed("same-current-token-launch-readback");

  const secondInstallation = await repository.createInstallation(customer, {
    commandId: "native.pg.create.second-project.0001",
    installationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.secondProject,
    platform: "ios",
    bundleId: "com.sitesourcery.responder",
    appEnvironment: "sandbox",
    appVersion: "1.0.0",
    buildNumber: "1",
    installationKeyDigest: digest("native.pg.installation-key.0002"),
    recordedAt: tick()
  });
  const secondTokenScope = {
    ...tokenScope,
    id: secondInstallation.installation.id,
    projectId: ids.secondProject
  };
  const secondProjectCandidates = tokenAuthority.tokenLookupCandidates(
    secondTokenScope, "notification", notificationToken
  );
  assert.equal(
    secondProjectCandidates[0].digest,
    notificationCandidates[0].digest
  );
  const sharedToken = await repository.registerToken(customer, {
    commandId: "native.pg.notification.second-project.0001",
    registrationId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.secondProject,
    installationId: secondInstallation.installation.id,
    expectedRevision: 1,
    pushPurpose: "notification",
    tokenLookupCandidateDigests:
      secondProjectCandidates.map((entry) => entry.digest),
    tokenOwnershipCandidateDigests:
      secondProjectCandidates.map((entry) => entry.ownershipDigest),
    envelope: await tokenAuthority.sealToken(
      secondTokenScope, "notification", notificationToken
    ),
    recordedAt: tick()
  });
  assert.equal(sharedToken.installation.revision, 2);
  assert.equal((await pool.query(
    `select count(*)::integer as count,
            count(distinct installation.customer_user_id)::integer as users
       from ss.responder_native_push_token_registrations registration
       join ss.responder_native_installations installation
         on installation.organization_id = registration.organization_id
        and installation.id = registration.installation_id
      where registration.token_lookup_digest = $1`,
    [notificationCandidates[0].digest]
  )).rows[0].count, 2);
  passed("same-customer-token-shares-across-projects");

  const rotatedToken = "12".repeat(32);
  const rotatedCandidates = tokenAuthority.tokenLookupCandidates(
    tokenScope, "notification", rotatedToken
  );
  const rotated = await repository.registerToken(customer, {
    ...notificationInput,
    commandId: "native.pg.notification.rotate.0001",
    registrationId: randomUUID(),
    expectedRevision: 3,
    tokenLookupCandidateDigests:
      rotatedCandidates.map((entry) => entry.digest),
    tokenOwnershipCandidateDigests:
      rotatedCandidates.map((entry) => entry.ownershipDigest),
    envelope: await tokenAuthority.sealToken(
      tokenScope, "notification", rotatedToken
    ),
    recordedAt: tick()
  });
  assert.equal(rotated.installation.revision, 4);
  assert.equal(
    rotated.installation.pushRegistrations.find(
      (entry) => entry.purpose === "notification"
    )?.tokenReferenceDigest,
    rotatedCandidates[0].digest
  );
  const retirementInput = {
    commandId: "native.pg.notification.retire.0001",
    retirementId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 4,
    pushPurpose: "notification",
    reason: "customer_request",
    evidenceDigest: digest("native.pg.notification.retire.evidence.0001"),
    recordedAt: tick()
  };
  const retired = await repository.retireToken(customer, retirementInput);
  assert.equal(retired.installation.revision, 5);
  assert.equal(
    retired.installation.pushRegistrations.some(
      (entry) => entry.purpose === "notification"
    ),
    false
  );
  assert.equal(
    retired.installation.pushRegistrations.some(
      (entry) => entry.purpose === "voip"
    ),
    true
  );
  const retirementReplay = await repository.retireToken(customer, {
    ...retirementInput,
    retirementId: randomUUID(),
    recordedAt: tick()
  });
  assert.equal(retirementReplay.replayed, true);
  const retirementRows = await pool.query(
    `select reason, count(*)::integer as count
       from ss.responder_native_push_token_retirements
      where organization_id = $1 and installation_id = $2
      group by reason order by reason`,
    [ids.organization, created.installation.id]
  );
  assert.deepEqual(retirementRows.rows, [
    { reason: "customer_request", count: 1 },
    { reason: "token_replaced", count: 1 }
  ]);
  passed("token-rotation-and-explicit-retirement");

  const staleToken = "ef".repeat(32);
  await expectCode(
    async () => repository.registerToken(customer, {
      ...notificationInput,
      commandId: "native.pg.stale.0001",
      registrationId: randomUUID(),
      expectedRevision: 1,
      tokenLookupCandidateDigests: tokenAuthority
        .tokenLookupCandidates(tokenScope, "notification", staleToken)
        .map((entry) => entry.digest),
      tokenOwnershipCandidateDigests: tokenAuthority
        .tokenLookupCandidates(tokenScope, "notification", staleToken)
        .map((entry) => entry.ownershipDigest),
      envelope: await tokenAuthority.sealToken(
        tokenScope, "notification", staleToken
      ),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED"
  );
  passed("revision-fencing-rejects-stale-write");

  await expectCode(
    () => authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, (client) => client.query(
      `update ss.responder_native_installations set app_version = '2.0.0'
        where organization_id = $1 and id = $2`,
      [ids.organization, created.installation.id]
    )),
    "42501"
  );
  await expectCode(
    () => authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, async (client) => {
      const payload = await client.query(
        `select ss.responder_native_token_payload_digest_v1(
           'notification',$1
         ) as digest`,
        [digest("native.pg.revision-jump-token")]
      );
      const request = await client.query(
        `select ss.responder_native_command_request_digest_v1(
           $1,$2,$3,$4,'register_token',5,7,'notification',$5
         ) as digest`,
        [
          ids.customer, ids.organization, ids.project,
          created.installation.id, payload.rows[0].digest
        ]
      );
      await client.query(
        `insert into ss.responder_native_commands (
           organization_id, command_id, request_digest, project_id,
           installation_id, token_registration_id, actor_user_id, operation,
           expected_revision, resulting_revision, resulting_state,
           push_purpose, payload_digest, created_at
         ) values (
           $1,'native.pg.revision-jump.0001',$2,$3,$4,$5,$6,
           'register_token',5,7,'active','notification',$7,$8
         )`,
        [
          ids.organization, request.rows[0].digest, ids.project,
          created.installation.id, randomUUID(), ids.customer,
          payload.rows[0].digest, tick()
        ]
      );
    }),
    "23514"
  );
  const orphanId = randomUUID();
  await expectCode(
    () => authority.service({
      actorKind: "customer",
      userId: ids.customer,
      organizationId: ids.organization,
      isolation: "serializable"
    }, async (client) => {
      const payload = await client.query(
        `select ss.responder_native_token_payload_digest_v1(
           'notification',$1
         ) as digest`,
        [digest("native.pg.orphan-token")]
      );
      const request = await client.query(
        `select ss.responder_native_command_request_digest_v1(
           $1,$2,$3,$4,'register_token',5,6,'notification',$5
         ) as digest`,
        [
          ids.customer, ids.organization, ids.project,
          created.installation.id, payload.rows[0].digest
        ]
      );
      await client.query(
        `insert into ss.responder_native_commands (
           organization_id, command_id, request_digest, project_id,
           installation_id, token_registration_id, actor_user_id, operation,
           expected_revision, resulting_revision, resulting_state,
           push_purpose, payload_digest, created_at
         ) values (
           $1,'native.pg.orphan.0001',$2,$3,$4,$5,$6,'register_token',
           5,6,'active','notification',$7,$8
         )`,
        [
          ids.organization, request.rows[0].digest, ids.project,
          created.installation.id, orphanId, ids.customer,
          payload.rows[0].digest, tick()
        ]
      );
    }),
    "23503"
  );
  const orphanCount = await pool.query(
    `select count(*)::integer as count
       from ss.responder_native_commands
      where organization_id = $1 and command_id = 'native.pg.orphan.0001'`,
    [ids.organization]
  );
  assert.equal(orphanCount.rows[0].count, 0);
  passed("deferred-evidence-and-append-only-guards");

  const suspendInput = {
    commandId: "native.pg.suspend.0001",
    transitionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 5,
    reason: "logout",
    evidenceDigest: digest("native.pg.logout.0001"),
    recordedAt: tick()
  };
  const suspended = await repository.suspendInstallation(
    customer, suspendInput
  );
  assert.equal(suspended.installation.state, "suspended");
  assert.equal(suspended.installation.revision, 6);
  assert.equal(suspended.installation.suspendedReason, "logout");
  assert.equal(
    suspended.installation.pushRegistrations.every(
      (entry) => entry.active === false
    ),
    true
  );
  const suspendReplay = await repository.suspendInstallation(customer, {
    ...suspendInput,
    transitionId: randomUUID(),
    recordedAt: tick()
  });
  assert.equal(suspendReplay.replayed, true);
  await expectCode(
    async () => repository.registerToken(customer, {
      ...notificationInput,
      commandId: "native.pg.while-suspended.0001",
      registrationId: randomUUID(),
      expectedRevision: 6,
      tokenLookupCandidateDigests: tokenAuthority
        .tokenLookupCandidates(tokenScope, "notification", staleToken)
        .map((entry) => entry.digest),
      tokenOwnershipCandidateDigests: tokenAuthority
        .tokenLookupCandidates(tokenScope, "notification", staleToken)
        .map((entry) => entry.ownershipDigest),
      envelope: await tokenAuthority.sealToken(
        tokenScope, "notification", staleToken
      ),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED"
  );
  const resumed = await repository.resumeInstallation(customer, {
    commandId: "native.pg.resume.0001",
    transitionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 6,
    reason: "login",
    evidenceDigest: digest("native.pg.login.0001"),
    recordedAt: tick()
  });
  assert.equal(resumed.installation.state, "active");
  assert.equal(resumed.installation.revision, 7);
  assert.equal(
    resumed.installation.pushRegistrations.every(
      (entry) => entry.active === true
    ),
    true
  );
  assert.equal(
    resumed.installation.pushRegistrations.some(
      (entry) => entry.purpose === "notification"
    ),
    false
  );
  await expectCode(
    () => repository.issueVoipSession(customer, {
      commandId: "native.pg.voice.held.after-resume.0002",
      sessionId: randomUUID(),
      organizationId: ids.organization,
      projectId: ids.project,
      installationId: created.installation.id,
      expectedRevision: 7
    }),
    "RESPONDER_NATIVE_VOIP_HELD"
  );
  await expectCode(
    () => verifiedRepository.issueVoipSession(customer, {
      ...voiceInput,
      sessionId: randomUUID(),
      expectedRevision: 7
    }),
    "RESPONDER_NATIVE_CLIENT_IDEMPOTENCY_CONFLICT"
  );
  const terminal = await repository.revokeInstallation(customer, {
    commandId: "native.pg.revoke.0001",
    transitionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 7,
    reason: "device_lost",
    evidenceDigest: digest("native.pg.device-lost.0001"),
    recordedAt: tick()
  });
  assert.equal(terminal.installation.state, "revoked");
  assert.equal(terminal.installation.revision, 8);
  assert.equal(terminal.installation.revokedReason, "device_lost");
  await expectCode(
    () => repository.resumeInstallation(customer, {
      commandId: "native.pg.resume-after-terminal.0001",
      transitionId: randomUUID(),
      organizationId: ids.organization,
      projectId: ids.project,
      installationId: created.installation.id,
      expectedRevision: 8,
      reason: "login",
      evidenceDigest: digest("native.pg.login.terminal.0001"),
      recordedAt: tick()
    }),
    "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED"
  );
  passed("logout-suspension-resume-and-terminal-revocation");

  const final = await pool.query(
    `select
       (select count(*)::integer from ss.responder_native_commands
         where organization_id = $1) as commands,
       (select count(*)::integer from ss.responder_native_installations
         where organization_id = $1) as installations,
       (select count(*)::integer
          from ss.responder_native_push_token_registrations
         where organization_id = $1) as tokens,
       (select count(*)::integer
          from ss.responder_native_state_transitions
         where organization_id = $1) as state_transitions,
       (select count(*)::integer
          from ss.responder_native_push_token_retirements
         where organization_id = $1) as token_retirements,
       (select count(*)::integer
          from ss.responder_native_voice_sessions
         where organization_id = $1) as voice_sessions,
       (select bool_and(not provider_effects)
          and bool_and(not push_delivery_effects)
          and bool_and(not voice_call_effects)
          and bool_and(not carrier_command_effects)
          and bool_and(not message_send_effects)
          from ss.responder_native_commands where organization_id = $1)
          as zero_effects,
       (select bool_and(position($2::bytea in ciphertext) = 0)
          from ss.responder_native_push_token_registrations
         where organization_id = $1) as raw_tokens_absent,
       (select bool_and(position($3::bytea in ciphertext) = 0)
          from ss.responder_native_push_token_registrations
         where organization_id = $1) as raw_fcm_absent,
       (select bool_and(not provider_effects)
          and bool_and(not push_delivery_effects)
          and bool_and(not voice_call_effects)
          and bool_and(not carrier_command_effects)
          and bool_and(not message_send_effects)
          from ss.responder_native_push_token_retirements
         where organization_id = $1) as retirement_zero_effects,
       (select bool_and(provider_authorization_effects)
          and bool_and(not provider_effects)
          and bool_and(not push_delivery_effects)
          and bool_and(not voice_call_effects)
          and bool_and(not carrier_command_effects)
          and bool_and(not message_send_effects)
          from ss.responder_native_voice_sessions
         where organization_id = $1) as voice_authorization_only`,
    [
      ids.organization,
      Buffer.from(notificationToken, "utf8"),
      Buffer.from(fcmToken, "utf8")
    ]
  );
  assert.deepEqual(final.rows[0], {
    commands: 13,
    installations: 3,
    tokens: 6,
    state_transitions: 3,
    token_retirements: 2,
    voice_sessions: 3,
    zero_effects: true,
    raw_tokens_absent: true,
    raw_fcm_absent: true,
    retirement_zero_effects: true,
    voice_authorization_only: true
  });
  const tokenRow = await pool.query(
    `select key_version, token_lookup_digest, token_ownership_digest,
            token_receipt_digest, nonce, authentication_tag, ciphertext
       from ss.responder_native_push_token_registrations
      where organization_id = $1 and command_id = $2`,
    [ids.organization, notificationInput.commandId]
  );
  assert.equal(await tokenAuthority.openToken(
    tokenScope,
    "notification",
    {
      keyVersion: tokenRow.rows[0].key_version,
      tokenLookupDigest: tokenRow.rows[0].token_lookup_digest,
      tokenOwnershipDigest: tokenRow.rows[0].token_ownership_digest,
      tokenReceiptDigest: tokenRow.rows[0].token_receipt_digest,
      nonce: tokenRow.rows[0].nonce,
      authenticationTag: tokenRow.rows[0].authentication_tag,
      ciphertext: tokenRow.rows[0].ciphertext
    }
  ), notificationToken);
  const listed = await repository.listInstallations(customer, {
    organizationId: ids.organization,
    projectId: ids.project
  });
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(notificationToken, "u"));
  passed("digest-only-projection-and-zero-external-effects");
  assert.deepEqual(gates, EXPECTED_GATES);

  return Object.freeze({
    assertions: gates.length,
    expectedAssertions: EXPECTED_GATES.length,
    commands: final.rows[0].commands,
    installations: final.rows[0].installations,
    tokens: final.rows[0].tokens,
    stateTransitions: final.rows[0].state_transitions,
    tokenRetirements: final.rows[0].token_retirements,
    voiceSessions: final.rows[0].voice_sessions,
    providerAuthorizationEffects: true,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false
  });
}
