import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createPostgresResponderNativeClientRepository } from
  "../../hosted/responder-native-client-postgres.mjs";
import { createResponderNativeTokenAuthority } from
  "../../hosted/responder-native-token-authority.mjs";
import { createCanonicalPostgresAuthority } from
  "../../hosted/repository-postgres.mjs";
import { digest } from "../../hosted/security.mjs";

const EXPECTED_GATES = Object.freeze([
  "storage-contract-acl-readiness-held",
  "storage-acl-drift-fails-readiness",
  "create-command-replay-and-semantic-deduplication",
  "organization-scoped-command-independence",
  "sealed-notification-registration-and-replay",
  "cross-tenant-token-reassignment-denied",
  "ios-voip-registration-remains-provider-held",
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
       ($5,$6,$7,$8,'Native Client Other Project')`,
    [
      ids.project, ids.organization, ids.customer, ids.billing,
      ids.otherProject, ids.otherOrganization, ids.otherCustomer,
      ids.otherBilling
    ]
  );
  return ids;
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
  const repository = createPostgresResponderNativeClientRepository({
    authority,
    verifierKeyVersions: [...tokenAuthority.verifierVersions]
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
      (select count(*) = 4 and bool_and(c.relrowsecurity)
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
    "responder_native_state_transitions"
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
  passed("storage-acl-drift-fails-readiness");

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
    envelope: firstNotificationEnvelope,
    recordedAt: tick()
  };
  const notification = await repository.registerToken(
    customer, notificationInput
  );
  assert.equal(notification.installation.revision, 2);
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
    envelope: voipEnvelope,
    recordedAt: tick()
  });
  assert.equal(voip.installation.revision, 3);
  await expectCode(
    () => repository.requireHeldVoipSession(customer, {
      organizationId: ids.organization,
      projectId: ids.project,
      installationId: created.installation.id,
      expectedRevision: 3
    }),
    "RESPONDER_NATIVE_VOIP_HELD"
  );
  passed("ios-voip-registration-remains-provider-held");

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
           $1,$2,$3,$4,'register_token',3,4,'notification',$5
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
           3,4,'active','notification',$7,$8
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
    expectedRevision: 3,
    reason: "logout",
    evidenceDigest: digest("native.pg.logout.0001"),
    recordedAt: tick()
  };
  const suspended = await repository.suspendInstallation(
    customer, suspendInput
  );
  assert.equal(suspended.installation.state, "suspended");
  assert.equal(suspended.installation.revision, 4);
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
      expectedRevision: 4,
      tokenLookupCandidateDigests: tokenAuthority
        .tokenLookupCandidates(tokenScope, "notification", staleToken)
        .map((entry) => entry.digest),
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
    expectedRevision: 4,
    reason: "login",
    evidenceDigest: digest("native.pg.login.0001"),
    recordedAt: tick()
  });
  assert.equal(resumed.installation.state, "active");
  assert.equal(resumed.installation.revision, 5);
  assert.equal(
    resumed.installation.pushRegistrations.every(
      (entry) => entry.active === true
    ),
    true
  );
  assert.equal(
    resumed.installation.pushRegistrations.find(
      (entry) => entry.purpose === "notification"
    )?.tokenReferenceDigest,
    notificationCandidates[0].digest
  );
  await expectCode(
    () => repository.requireHeldVoipSession(customer, {
      organizationId: ids.organization,
      projectId: ids.project,
      installationId: created.installation.id,
      expectedRevision: 5
    }),
    "RESPONDER_NATIVE_VOIP_HELD"
  );
  const terminal = await repository.revokeInstallation(customer, {
    commandId: "native.pg.revoke.0001",
    transitionId: randomUUID(),
    organizationId: ids.organization,
    projectId: ids.project,
    installationId: created.installation.id,
    expectedRevision: 5,
    reason: "device_lost",
    evidenceDigest: digest("native.pg.device-lost.0001"),
    recordedAt: tick()
  });
  assert.equal(terminal.installation.state, "revoked");
  assert.equal(terminal.installation.revision, 6);
  assert.equal(terminal.installation.revokedReason, "device_lost");
  await expectCode(
    () => repository.resumeInstallation(customer, {
      commandId: "native.pg.resume-after-terminal.0001",
      transitionId: randomUUID(),
      organizationId: ids.organization,
      projectId: ids.project,
      installationId: created.installation.id,
      expectedRevision: 6,
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
       (select bool_and(not provider_effects)
          and bool_and(not push_delivery_effects)
          and bool_and(not voice_call_effects)
          and bool_and(not carrier_command_effects)
          and bool_and(not message_send_effects)
          from ss.responder_native_commands where organization_id = $1)
          as zero_effects,
       (select bool_and(position($2::bytea in ciphertext) = 0)
          from ss.responder_native_push_token_registrations
         where organization_id = $1) as raw_tokens_absent`,
    [ids.organization, Buffer.from(notificationToken, "utf8")]
  );
  assert.deepEqual(final.rows[0], {
    commands: 6,
    installations: 1,
    tokens: 2,
    state_transitions: 3,
    zero_effects: true,
    raw_tokens_absent: true
  });
  const tokenRow = await pool.query(
    `select key_version, token_lookup_digest, nonce,
            authentication_tag, ciphertext
       from ss.responder_native_push_token_registrations
      where organization_id = $1 and push_purpose = 'notification'`,
    [ids.organization]
  );
  assert.equal(await tokenAuthority.openToken(
    tokenScope,
    "notification",
    {
      keyVersion: tokenRow.rows[0].key_version,
      tokenLookupDigest: tokenRow.rows[0].token_lookup_digest,
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
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false
  });
}
