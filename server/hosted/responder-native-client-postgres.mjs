import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/u;
const APP_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/u;
const PLATFORMS = new Set(["ios", "android"]);
const ENVIRONMENTS = new Set(["sandbox", "production"]);
const PURPOSES = new Set(["notification", "voip"]);
const TERMINAL_REVOCATION_REASONS = new Set([
  "customer_request", "device_lost", "token_compromise"
]);
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "55000"
]);
const RETRY_CODES = new Set(["40001", "40P01", "55P03"]);

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && COMMAND_ID.test(value),
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "Command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "RESPONDER_NATIVE_CLIENT_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function customerContext(actor, readOnly = false) {
  invariant(
    actor?.kind === "customer" &&
      typeof actor.organizationId === "string" &&
      typeof actor.userId === "string",
    "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
    "Responder native-client authority is unavailable.",
    { status: 404 }
  );
  return {
    actorKind: "customer",
    userId: actor.userId,
    organizationId: actor.organizationId,
    ...(readOnly ? { readOnly: true } : { isolation: "serializable" })
  };
}

function translatedError(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") {
    return new HostedError(
      "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
      "Responder native-client state is unavailable.",
      { status: 404 }
    );
  }
  if (RETRY_CODES.has(error?.code)) {
    return new HostedError(
      "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED",
      "Responder native-client state changed; retry safely.",
      { status: 409 }
    );
  }
  if (DATABASE_CONFLICTS.has(error?.code)) {
    return new HostedError(
      "RESPONDER_NATIVE_CLIENT_CONFLICT",
      "Responder native-client evidence conflicts with durable state.",
      { status: 409 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translatedError(error);
  }
}

function envelope(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value) &&
      VERSION.test(value.keyVersion ?? "") &&
      SHA256.test(value.tokenLookupDigest ?? "") &&
      SHA256.test(value.tokenOwnershipDigest ?? "") &&
      SHA256.test(value.tokenReceiptDigest ?? "") &&
      Buffer.isBuffer(value.nonce) && value.nonce.length === 12 &&
      Buffer.isBuffer(value.authenticationTag) &&
      value.authenticationTag.length === 16 &&
      Buffer.isBuffer(value.ciphertext) &&
      value.ciphertext.length >= 16 && value.ciphertext.length <= 8192,
    "RESPONDER_NATIVE_CLIENT_INVALID",
    "The sealed native push token is invalid.",
    { status: 400 }
  );
  return value;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function voiceSessionAuthority(row) {
  return Object.freeze({
    sessionId: row.id,
    commandId: row.command_id,
    requestDigest: row.request_digest,
    organizationId: row.organization_id,
    projectId: row.project_id,
    userId: row.customer_user_id,
    installationId: row.installation_id,
    installationRevision: Number(row.installation_revision),
    clientPlatform: row.client_platform,
    transport: row.transport,
    appEnvironment: row.app_environment
  });
}

function voiceSessionMetadata(row) {
  return Object.freeze({
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    identityDigest: row.identity_digest,
    endpointDigest: row.endpoint_digest,
    credentialDigest: row.credential_digest,
    jtiDigest: row.jti_digest,
    tokenDigest: row.token_digest
  });
}

function voiceSessionEnvelope(row) {
  return Object.freeze({
    keyVersion: row.key_version,
    nonce: row.nonce,
    authenticationTag: row.authentication_tag,
    ciphertext: row.ciphertext
  });
}

function voiceSessionProjection(
  row,
  accessToken,
  { replayed = false, semanticReplay = false } = {}
) {
  return deepFreeze({
    schema: "sitesourcery.responder-native-voice-session/v1",
    sessionId: row.id,
    commandId: row.command_id,
    requestDigest: row.request_digest,
    replayed,
    semanticReplay,
    installationId: row.installation_id,
    installationRevision: Number(row.installation_revision),
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    appEnvironment: row.app_environment,
    provider: "twilio",
    clientPlatform: row.client_platform,
    transport: row.transport,
    identityDigest: row.identity_digest,
    credentialDigest: row.credential_digest,
    accessToken,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    incomingAllowed: true,
    outgoingAllowed: false,
    providerAuthorizationEffects: true,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false
  });
}

function projection(row, tokenRows = [], voipSessionState = "held") {
  const state = row.current_state;
  return deepFreeze({
    schema: "sitesourcery.responder-native-installation/v1",
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerUserId: row.customer_user_id,
    platform: row.platform,
    bundleId: row.bundle_id,
    appEnvironment: row.app_environment,
    appVersion: row.app_version,
    buildNumber: row.build_number,
    installationKeyDigest: row.installation_key_digest,
    state,
    revision: Number(row.current_revision),
    createdAt: iso(row.created_at),
    suspendedAt: state === "suspended" && row.transition_at
      ? iso(row.transition_at)
      : null,
    suspendedReason: state === "suspended"
      ? row.transition_reason ?? null
      : null,
    revokedAt: state === "revoked" && row.transition_at
      ? iso(row.transition_at)
      : null,
    revokedReason: state === "revoked"
      ? row.transition_reason ?? null
      : null,
    pushRegistrations: tokenRows.map((token) => deepFreeze({
      purpose: token.push_purpose,
      tokenReferenceDigest: token.token_lookup_digest,
      keyVersion: token.key_version,
      registeredAt: iso(token.created_at),
      revision: Number(token.resulting_revision),
      active: state === "active"
    })),
    voipSessionState,
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false
  });
}

async function loadInstallation(
  client,
  actor,
  organizationId,
  projectId,
  id,
  voipSessionState = "held"
) {
  const result = await client.query(
    `select installation.*,
            current_command.resulting_revision as current_revision,
            current_command.resulting_state as current_state,
            state_transition.created_at as transition_at,
            state_transition.reason as transition_reason
       from ss.responder_native_installations installation
       join lateral (
         select command.command_id, command.resulting_revision,
                command.resulting_state
           from ss.responder_native_commands command
          where command.organization_id = installation.organization_id
            and command.installation_id = installation.id
          order by command.resulting_revision desc
          limit 1
       ) current_command on true
       left join ss.responder_native_state_transitions state_transition
         on state_transition.organization_id = installation.organization_id
        and state_transition.command_id = current_command.command_id
      where installation.organization_id = $1
        and installation.project_id = $2
        and installation.id = $3
        and installation.customer_user_id = $4`,
    [organizationId, projectId, id, actor.userId]
  );
  invariant(
    result.rowCount === 1,
    "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
    "Responder native-client state is unavailable.",
    { status: 404 }
  );
  const tokens = await client.query(
    `select registration.push_purpose, registration.token_lookup_digest,
            registration.key_version, registration.created_at,
            command.resulting_revision
       from (
         select distinct on (native_command.push_purpose)
                native_command.organization_id,
                native_command.push_purpose,
                native_command.operation,
                native_command.token_registration_id,
                native_command.resulting_revision
           from ss.responder_native_commands native_command
          where native_command.organization_id = $1
            and native_command.installation_id = $2
            and native_command.push_purpose is not null
          order by native_command.push_purpose,
                   native_command.resulting_revision desc
       ) command
       join ss.responder_native_push_token_registrations registration
         on command.operation = 'register_token'
        and registration.organization_id = command.organization_id
        and registration.id = command.token_registration_id
      order by registration.push_purpose`,
    [organizationId, id]
  );
  return projection(result.rows[0], tokens.rows, voipSessionState);
}

async function commandReceipt(
  client,
  actor,
  row,
  {
    replayed = false,
    semanticReplay = false,
    voipSessionState = "held"
  } = {}
) {
  let tokenReceiptDigest = null;
  if (row.operation === "register_token") {
    const tokenReceipt = await client.query(
      `select registration.token_ownership_kind,
              registration.token_receipt_digest
         from ss.responder_native_push_token_registrations registration
        where registration.organization_id = $1
          and registration.id = $2`,
      [row.organization_id, row.token_registration_id]
    );
    invariant(
      tokenReceipt.rowCount === 1 && (
        (
          tokenReceipt.rows[0].token_ownership_kind === "physical_v1" &&
          SHA256.test(tokenReceipt.rows[0].token_receipt_digest ?? "")
        ) || (
          tokenReceipt.rows[0].token_ownership_kind === "legacy_purpose_bound" &&
          tokenReceipt.rows[0].token_receipt_digest === null
        )
      ),
      "RESPONDER_NATIVE_CLIENT_CONFLICT",
      "The native push-token receipt is unavailable.",
      { status: 409 }
    );
    tokenReceiptDigest = tokenReceipt.rows[0].token_receipt_digest;
  }
  return deepFreeze({
    schema: "sitesourcery.responder-native-command-receipt/v1",
    commandId: row.command_id,
    requestDigest: row.request_digest,
    operation: row.operation,
    replayed,
    semanticReplay,
    tokenReceiptDigest,
    installation: await loadInstallation(
      client,
      actor,
      row.organization_id,
      row.project_id,
      row.installation_id,
      voipSessionState
    ),
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false
  });
}

async function priorReceipt(
  client,
  actor,
  selected,
  voipSessionState = "held"
) {
  const prior = await client.query(
    `select * from ss.responder_native_commands
      where organization_id = $1 and command_id = $2`,
    [selected.organizationId, selected.commandId]
  );
  if (prior.rowCount === 1) {
    invariant(
      prior.rows[0].request_digest === selected.requestDigest,
      "RESPONDER_NATIVE_CLIENT_IDEMPOTENCY_CONFLICT",
      "The native-client command was reused for different facts.",
      { status: 409 }
    );
    return commandReceipt(client, actor, prior.rows[0], {
      replayed: true,
      voipSessionState
    });
  }
  const semantic = await client.query(
    `select * from ss.responder_native_commands where request_digest = $1`,
    [selected.requestDigest]
  );
  return semantic.rowCount === 1
    ? commandReceipt(client, actor, semantic.rows[0], {
      replayed: true,
        semanticReplay: true,
        voipSessionState
      })
    : null;
}

export function createPostgresResponderNativeClientRepository({
  authority,
  verifierKeyVersions,
  voiceAccess,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    typeof authority?.service === "function" &&
      typeof randomUUID === "function" &&
      Array.isArray(verifierKeyVersions) &&
      verifierKeyVersions.length >= 1 && verifierKeyVersions.length <= 4 &&
      verifierKeyVersions.every(
        (entry) => typeof entry === "string" && VERSION.test(entry)
      ) &&
      voiceAccess?.kind === "twilio-responder-voice-access" &&
      (voiceAccess.mode === "held" || voiceAccess.mode === "verified") &&
      voiceAccess.providerEffects === false &&
      voiceAccess.pushDeliveryEffects === false &&
      voiceAccess.voiceCallEffects === false &&
      Array.isArray(voiceAccess.transports) &&
      voiceAccess.transports.length === 2 &&
      voiceAccess.transports.includes("twilio_voice_ios") &&
      voiceAccess.transports.includes("twilio_voice_android") &&
      typeof voiceAccess.issueSession === "function" &&
      typeof voiceAccess.openSession === "function" &&
      Array.isArray(voiceAccess.verifierVersions) &&
      voiceAccess.verifierVersions.length >= 1,
    "RESPONDER_NATIVE_CLIENT_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL native-client authority is required.",
    { status: 500 }
  );
  const voipSessionState = voiceAccess.mode;

  function stateTransition(actor, input, {
    operation,
    resultingState,
    allowedPriorStates,
    allowedReasons
  }) {
    const selected = {
      commandId: input.commandId,
      transitionId: uuid(input.transitionId, "State transition ID"),
      organizationId: uuid(input.organizationId, "Organization ID"),
      projectId: uuid(input.projectId, "Project ID"),
      installationId: uuid(input.installationId, "Installation ID"),
      expectedRevision: input.expectedRevision,
      reason: input.reason,
      evidenceDigest: sha256(input.evidenceDigest, "Evidence digest"),
      recordedAt: instant(input.recordedAt, "Recorded time")
    };
    invariant(
      Number.isSafeInteger(selected.expectedRevision) &&
        selected.expectedRevision > 0 &&
        allowedReasons.has(selected.reason),
      "RESPONDER_NATIVE_CLIENT_INVALID",
      "The native installation state transition is invalid.",
      { status: 400 }
    );
    return translated(() => authority.service(
      customerContext(actor),
      async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`responder-native-installation:${selected.installationId}`]
        );
        const payload = await client.query(
          `select ss.responder_native_state_transition_payload_digest_v1(
             $1,$2,$3
           ) as payload_digest`,
          [operation, selected.reason, selected.evidenceDigest]
        );
        selected.payloadDigest = payload.rows[0].payload_digest;
        const request = await client.query(
          `select ss.responder_native_command_request_digest_v1(
             $1,$2,$3,$4,$5,$6,$7,null,$8
           ) as request_digest`,
          [
            actor.userId, selected.organizationId, selected.projectId,
            selected.installationId, operation, selected.expectedRevision,
            selected.expectedRevision + 1, selected.payloadDigest
          ]
        );
        selected.requestDigest = request.rows[0].request_digest;
        const prior = await priorReceipt(
          client, actor, selected, voipSessionState
        );
        if (prior) return prior;
        const installed = await loadInstallation(
          client,
          actor,
          selected.organizationId,
          selected.projectId,
          selected.installationId,
          voipSessionState
        );
        invariant(
          allowedPriorStates.has(installed.state) &&
            installed.revision === selected.expectedRevision,
          "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED",
          "Responder native-client state changed; retry safely.",
          { status: 409 }
        );
        await client.query(
          `insert into ss.responder_native_commands (
             organization_id, command_id, request_digest, project_id,
             installation_id, state_transition_id, actor_user_id, operation,
             expected_revision, resulting_revision, resulting_state,
             push_purpose, payload_digest, created_at
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,null,$12,$13
           )`,
          [
            selected.organizationId, selected.commandId,
            selected.requestDigest, selected.projectId,
            selected.installationId, selected.transitionId, actor.userId,
            operation, selected.expectedRevision,
            selected.expectedRevision + 1, resultingState,
            selected.payloadDigest, selected.recordedAt
          ]
        );
        await client.query(
          `insert into ss.responder_native_state_transitions (
             id, organization_id, project_id, installation_id, command_id,
             operation, prior_state, resulting_state, reason,
             evidence_digest, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            selected.transitionId, selected.organizationId,
            selected.projectId, selected.installationId,
            selected.commandId, operation, installed.state, resultingState,
            selected.reason, selected.evidenceDigest, selected.recordedAt
          ]
        );
        const row = await client.query(
          `select * from ss.responder_native_commands
            where organization_id = $1 and command_id = $2`,
          [selected.organizationId, selected.commandId]
        );
        return commandReceipt(client, actor, row.rows[0], {
          voipSessionState
        });
      }
    ));
  }

  return Object.freeze({
    kind: "responder-native-client-postgres",
    mode: "held-local",
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false,
    async readiness() {
      try {
        const result = await authority.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure(
                'ss.hosted_responder_native_client_contract_v1()'
              ) is not null
              and ss.hosted_responder_native_client_contract_v1() =
                'canonical-responder-native-client-v1-held-sealed-token-authority'
              and to_regprocedure(
                'ss.hosted_responder_native_voice_session_contract_v1()'
              ) is not null
              and ss.hosted_responder_native_voice_session_contract_v1() =
                'canonical-responder-native-voice-session-v1-sealed-replay-held'
              and to_regprocedure(
                'ss.hosted_responder_android_voice_contract_v1()'
              ) is not null
              and ss.hosted_responder_android_voice_contract_v1() =
                'canonical-responder-android-voice-v1-fcm-dual-purpose-receipt-bound-held'
                as contract_ready,
              (
                to_regprocedure(
                  'ss.responder_native_token_payload_digest_v2(text,ss.sha256_hex,ss.sha256_hex,ss.sha256_hex)'
                ) is not null
                and to_regprocedure(
                  'ss.responder_native_token_envelope_digest_v2(ss.sha256_hex,ss.sha256_hex,ss.sha256_hex,text,bytea,bytea,bytea)'
                ) is not null
                and has_function_privilege(
                  'service_role',
                  'ss.responder_native_token_payload_digest_v2(text,ss.sha256_hex,ss.sha256_hex,ss.sha256_hex)',
                  'EXECUTE'
                )
                and has_function_privilege(
                  'service_role',
                  'ss.responder_native_token_envelope_digest_v2(ss.sha256_hex,ss.sha256_hex,ss.sha256_hex,text,bytea,bytea,bytea)',
                  'EXECUTE'
                )
                and not exists (
                  select 1
                    from pg_proc procedure_record
                    join pg_namespace procedure_namespace
                      on procedure_namespace.oid = procedure_record.pronamespace
                    cross join lateral aclexplode(coalesce(
                      procedure_record.proacl,
                      acldefault('f', procedure_record.proowner)
                    )) procedure_acl
                   where procedure_namespace.nspname = 'ss'
                     and procedure_record.proname = any(array[
                       'responder_native_token_payload_digest_v2',
                       'responder_native_token_envelope_digest_v2'
                     ])
                     and procedure_acl.grantee = 0
                     and procedure_acl.privilege_type = 'EXECUTE'
                )
                and not has_function_privilege(
                  'anon',
                  'ss.responder_native_token_payload_digest_v2(text,ss.sha256_hex,ss.sha256_hex,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'anon',
                  'ss.responder_native_token_envelope_digest_v2(ss.sha256_hex,ss.sha256_hex,ss.sha256_hex,text,bytea,bytea,bytea)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'authenticated',
                  'ss.responder_native_token_payload_digest_v2(text,ss.sha256_hex,ss.sha256_hex,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'authenticated',
                  'ss.responder_native_token_envelope_digest_v2(ss.sha256_hex,ss.sha256_hex,ss.sha256_hex,text,bytea,bytea,bytea)',
                  'EXECUTE'
                )
              ) as receipt_functions_ready,
              (
                to_regprocedure(
                  'ss.responder_native_voice_session_request_digest_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,ss.sha256_hex)'
                ) is not null
                and to_regprocedure(
                  'ss.responder_native_voice_session_envelope_digest_v2(text,text,text,bytea,bytea,bytea,ss.sha256_hex)'
                ) is not null
                and has_function_privilege(
                  'service_role',
                  'ss.responder_native_voice_session_request_digest_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,ss.sha256_hex)',
                  'EXECUTE'
                )
                and has_function_privilege(
                  'service_role',
                  'ss.responder_native_voice_session_envelope_digest_v2(text,text,text,bytea,bytea,bytea,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not exists (
                  select 1
                    from pg_proc procedure_record
                    join pg_namespace procedure_namespace
                      on procedure_namespace.oid = procedure_record.pronamespace
                    cross join lateral aclexplode(coalesce(
                      procedure_record.proacl,
                      acldefault('f', procedure_record.proowner)
                    )) procedure_acl
                   where procedure_namespace.nspname = 'ss'
                     and procedure_record.proname = any(array[
                       'responder_native_voice_session_request_digest_v2',
                       'responder_native_voice_session_envelope_digest_v2'
                     ])
                     and procedure_acl.grantee = 0
                     and procedure_acl.privilege_type = 'EXECUTE'
                )
                and not has_function_privilege(
                  'anon',
                  'ss.responder_native_voice_session_request_digest_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'anon',
                  'ss.responder_native_voice_session_envelope_digest_v2(text,text,text,bytea,bytea,bytea,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'authenticated',
                  'ss.responder_native_voice_session_request_digest_v2(uuid,uuid,uuid,uuid,bigint,text,text,text,ss.sha256_hex)',
                  'EXECUTE'
                )
                and not has_function_privilege(
                  'authenticated',
                  'ss.responder_native_voice_session_envelope_digest_v2(text,text,text,bytea,bytea,bytea,ss.sha256_hex)',
                  'EXECUTE'
                )
              ) as voice_functions_ready,
              (
                exists (
                  select 1
                    from pg_constraint constraint_record
                   where constraint_record.conrelid =
                     'ss.responder_native_push_token_registrations'::regclass
                     and constraint_record.conname =
                       'responder_native_token_receipt_posture_check'
                     and constraint_record.convalidated
                )
                and exists (
                  select 1
                    from pg_trigger trigger_record
                   where trigger_record.tgrelid =
                     'ss.responder_native_push_token_registrations'::regclass
                     and trigger_record.tgname =
                       'responder_native_push_tokens_guard'
                     and not trigger_record.tgisinternal
                     and trigger_record.tgenabled = 'O'
                )
              ) as receipt_guard_ready,
              (
                exists (
                  select 1
                    from pg_constraint constraint_record
                   where constraint_record.conrelid =
                     'ss.responder_native_voice_sessions'::regclass
                     and constraint_record.conname =
                       'responder_native_voice_platform_transport_check'
                     and constraint_record.convalidated
                )
                and exists (
                  select 1
                    from pg_trigger trigger_record
                   where trigger_record.tgrelid =
                     'ss.responder_native_voice_sessions'::regclass
                     and trigger_record.tgname =
                       'responder_native_voice_sessions_guard'
                     and not trigger_record.tgisinternal
                     and trigger_record.tgenabled = 'O'
                )
              ) as voice_guard_ready,
              (select count(*) = 6
                 and bool_and(
                   relation.relrowsecurity
                   and relation.relforcerowsecurity
                   and has_table_privilege(
                     'service_role', relation.oid, 'SELECT'
                   )
                   and has_table_privilege(
                     'service_role', relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'service_role', relation.oid, 'TRIGGER'
                   )
                   and coalesce((
                     select role_record.rolbypassrls
                       from pg_roles role_record
                      where role_record.rolname = 'service_role'
                   ), false)
                   and not has_table_privilege(
                     'anon', relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'anon', relation.oid, 'TRIGGER'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'SELECT'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'INSERT'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'UPDATE'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'DELETE'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'TRUNCATE'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'REFERENCES'
                   )
                   and not has_table_privilege(
                     'authenticated', relation.oid, 'TRIGGER'
                   )
                   and not exists (
                     select 1
                       from aclexplode(coalesce(
                         relation.relacl,
                         acldefault('r', relation.relowner)
                       )) relation_acl
                      where relation_acl.grantee = 0
                        and relation_acl.privilege_type = any(array[
                          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                          'REFERENCES', 'TRIGGER'
                        ])
                   )
                   and not exists (
                     select 1
                       from aclexplode(coalesce(
                         relation.relacl,
                         acldefault('r', relation.relowner)
                       )) relation_acl
                      where relation_acl.grantee <> relation.relowner
                        and relation_acl.grantee <> coalesce((
                          select role_record.oid
                            from pg_roles role_record
                           where role_record.rolname = 'service_role'
                        ), 0::oid)
                        and relation_acl.privilege_type = any(array[
                          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                          'REFERENCES', 'TRIGGER'
                        ])
                   )
                 )
                from pg_class relation
                join pg_namespace namespace
                  on namespace.oid = relation.relnamespace
               where namespace.nspname = 'ss'
                 and relation.relname = any($1::text[])
              ) as tables_ready,
              not exists (
                select 1
                  from ss.responder_native_push_token_registrations token
                 where token.key_version <> all($2::text[])
              ) as token_keys_covered,
              not exists (
                select 1
                  from ss.responder_native_voice_sessions voice_session
                 where voice_session.expires_at > clock_timestamp()
                   and voice_session.key_version <> all($3::text[])
              ) as voice_keys_covered,
              not exists (
                select registration.token_ownership_digest
                  from ss.responder_native_push_token_registrations registration
                  join ss.responder_native_installations installation
                    on installation.organization_id = registration.organization_id
                   and installation.id = registration.installation_id
                 group by registration.token_ownership_digest
                having count(distinct installation.customer_user_id) > 1
                    or count(distinct installation.platform) > 1
                    or count(distinct installation.bundle_id) > 1
                    or count(distinct installation.app_environment) > 1
                    or (
                      count(distinct registration.push_purpose) > 1
                      and bool_or(installation.platform <> 'android')
                    )
              ) as token_ownership_ready,
              not exists (
                select 1
                  from ss.responder_native_push_token_registrations registration
                 where (
                   registration.token_ownership_kind = 'legacy_purpose_bound'
                   and registration.token_receipt_digest is not null
                 ) or (
                   registration.token_ownership_kind = 'physical_v1'
                   and registration.token_receipt_digest is null
                 )
              ) as token_receipts_ready,
              not exists (
                select registration.organization_id,
                       registration.installation_id,
                       registration.push_purpose
                  from ss.responder_native_push_token_registrations registration
                  left join ss.responder_native_push_token_retirements retirement
                    on retirement.organization_id = registration.organization_id
                   and retirement.registration_id = registration.id
                 where retirement.id is null
                 group by registration.organization_id,
                          registration.installation_id,
                          registration.push_purpose
                having count(*) > 1
              ) as active_tokens_ready
          `, [[
            "responder_native_commands",
            "responder_native_installations",
            "responder_native_push_token_registrations",
            "responder_native_state_transitions",
            "responder_native_push_token_retirements",
            "responder_native_voice_sessions"
          ], verifierKeyVersions, voiceAccess.verifierVersions])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.receipt_functions_ready === true &&
          row.voice_functions_ready === true &&
          row.receipt_guard_ready === true &&
          row.voice_guard_ready === true &&
          row.tables_ready === true && row.token_keys_covered === true &&
          row.voice_keys_covered === true &&
          row.token_ownership_ready === true &&
          row.token_receipts_ready === true &&
          row.active_tokens_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-native-client-postgres",
          mode: "held-local",
          voipSessionState,
          providerAuthorizationEffects:
            voiceAccess.providerAuthorizationEffects,
          providerEffects: false,
          pushDeliveryEffects: false,
          voiceCallEffects: false,
          carrierCommandEffects: false,
          messageSendEffects: false,
          code: ready ? null : "RESPONDER_NATIVE_CLIENT_STORAGE_NOT_READY"
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          kind: "responder-native-client-postgres",
          mode: "held-local",
          voipSessionState,
          providerAuthorizationEffects:
            voiceAccess.providerAuthorizationEffects,
          providerEffects: false,
          pushDeliveryEffects: false,
          voiceCallEffects: false,
          carrierCommandEffects: false,
          messageSendEffects: false,
          code: "RESPONDER_NATIVE_CLIENT_STORAGE_NOT_READY"
        });
      }
    },

    createInstallation(actor, input) {
      const selected = {
        commandId: input.commandId,
        installationId: uuid(input.installationId, "Installation ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        platform: input.platform,
        bundleId: input.bundleId,
        appEnvironment: input.appEnvironment,
        appVersion: input.appVersion,
        buildNumber: input.buildNumber,
        installationKeyDigest: sha256(
          input.installationKeyDigest, "Installation key digest"
        ),
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        PLATFORMS.has(selected.platform) &&
          typeof selected.bundleId === "string" &&
          BUNDLE_ID.test(selected.bundleId) &&
          ENVIRONMENTS.has(selected.appEnvironment) &&
          typeof selected.appVersion === "string" &&
          APP_VERSION.test(selected.appVersion) &&
          typeof selected.buildNumber === "string" &&
          APP_VERSION.test(selected.buildNumber),
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native installation is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        customerContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-native-installation:${selected.organizationId}:` +
              selected.installationKeyDigest]
          );
          const digests = await client.query(
            `select
               ss.responder_native_installation_payload_digest_v1(
                 $1,$2,$3,$4,$5,$6,$7,$8,$9
               ) as payload_digest`,
            [
              selected.organizationId, selected.projectId, actor.userId,
              selected.platform, selected.bundleId,
              selected.appEnvironment, selected.appVersion,
              selected.buildNumber, selected.installationKeyDigest
            ]
          );
          selected.payloadDigest = digests.rows[0].payload_digest;
          const request = await client.query(
            `select ss.responder_native_command_request_digest_v1(
               $1,$2,$3,$4,'create_installation',0,1,null,$5
             ) as request_digest`,
            [
              actor.userId, selected.organizationId, selected.projectId,
              selected.installationId, selected.payloadDigest
            ]
          );
          selected.requestDigest = request.rows[0].request_digest;
          const prior = await priorReceipt(
            client, actor, selected, voipSessionState
          );
          if (prior) return prior;
          await client.query(
            `insert into ss.responder_native_commands (
               organization_id, command_id, request_digest, project_id,
               installation_id, actor_user_id, operation,
               expected_revision, resulting_revision, resulting_state,
               push_purpose, payload_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,'create_installation',0,1,'active',
               null,$7,$8
             )`,
            [
              selected.organizationId, selected.commandId,
              selected.requestDigest, selected.projectId,
              selected.installationId, actor.userId,
              selected.payloadDigest, selected.recordedAt
            ]
          );
          await client.query(
            `insert into ss.responder_native_installations (
               id, organization_id, project_id, customer_user_id,
               create_command_id, platform, bundle_id, app_environment,
               app_version, build_number, installation_key_digest, created_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              selected.installationId, selected.organizationId,
              selected.projectId, actor.userId, selected.commandId,
              selected.platform, selected.bundleId,
              selected.appEnvironment, selected.appVersion,
              selected.buildNumber, selected.installationKeyDigest,
              selected.recordedAt
            ]
          );
          const row = await client.query(
            `select * from ss.responder_native_commands
              where organization_id = $1 and command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          return commandReceipt(client, actor, row.rows[0], {
            voipSessionState
          });
        }
      ));
    },

    registerToken(actor, input) {
      const selectedEnvelope = envelope(input.envelope);
      const selected = {
        commandId: input.commandId,
        registrationId: uuid(input.registrationId, "Registration ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        installationId: uuid(input.installationId, "Installation ID"),
        expectedRevision: input.expectedRevision,
        pushPurpose: input.pushPurpose,
        envelope: selectedEnvelope,
        tokenLookupCandidateDigests: input.tokenLookupCandidateDigests,
        tokenCollisionCandidateDigests:
          input.tokenCollisionCandidateDigests ?? input.tokenLookupCandidateDigests,
        tokenOwnershipCandidateDigests:
          input.tokenOwnershipCandidateDigests,
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        Number.isSafeInteger(selected.expectedRevision) &&
          selected.expectedRevision > 0 &&
          PURPOSES.has(selected.pushPurpose) &&
          Array.isArray(selected.tokenLookupCandidateDigests) &&
          selected.tokenLookupCandidateDigests.length >= 1 &&
          selected.tokenLookupCandidateDigests.length <= 4 &&
          selected.tokenLookupCandidateDigests[0] ===
            selected.envelope.tokenLookupDigest &&
          selected.tokenLookupCandidateDigests.every(
            (entry) => typeof entry === "string" && SHA256.test(entry)
          ) &&
          Array.isArray(selected.tokenCollisionCandidateDigests) &&
          selected.tokenCollisionCandidateDigests.length >=
            selected.tokenLookupCandidateDigests.length &&
          selected.tokenCollisionCandidateDigests.length <= 8 &&
          selected.tokenLookupCandidateDigests.every((entry) =>
            selected.tokenCollisionCandidateDigests.includes(entry)
          ) &&
          new Set(selected.tokenCollisionCandidateDigests).size ===
            selected.tokenCollisionCandidateDigests.length &&
          selected.tokenCollisionCandidateDigests.every(
            (entry) => typeof entry === "string" && SHA256.test(entry)
          ) &&
          Array.isArray(selected.tokenOwnershipCandidateDigests) &&
          selected.tokenOwnershipCandidateDigests.length ===
            selected.tokenLookupCandidateDigests.length &&
          selected.tokenOwnershipCandidateDigests[0] ===
            selected.envelope.tokenOwnershipDigest &&
          selected.tokenOwnershipCandidateDigests.every(
            (entry) => typeof entry === "string" && SHA256.test(entry)
          ),
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native push-token registration is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        customerContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-native-installation:${selected.installationId}`]
          );
          for (const ownershipDigest of
            selected.tokenOwnershipCandidateDigests) {
            await client.query(
              "select pg_advisory_xact_lock(hashtextextended($1, 0))",
              [`responder-native-token-ownership:${ownershipDigest}`]
            );
          }
          const digestRows = await client.query(
            `select
               ss.responder_native_token_envelope_digest_v2(
                 $1,$2,$3,$4,$5,$6,$7
               ) as envelope_digest,
               ss.responder_native_token_payload_digest_v2($8,$1,$2,$3)
                 as payload_digest`,
            [
              selected.envelope.tokenLookupDigest,
              selected.envelope.tokenOwnershipDigest,
              selected.envelope.tokenReceiptDigest,
              selected.envelope.keyVersion, selected.envelope.nonce,
              selected.envelope.authenticationTag,
              selected.envelope.ciphertext, selected.pushPurpose
            ]
          );
          selected.envelopeDigest = digestRows.rows[0].envelope_digest;
          selected.payloadDigest = digestRows.rows[0].payload_digest;
          const request = await client.query(
            `select ss.responder_native_command_request_digest_v1(
               $1,$2,$3,$4,'register_token',$5,$6,$7,$8
             ) as request_digest`,
            [
              actor.userId, selected.organizationId, selected.projectId,
              selected.installationId, selected.expectedRevision,
              selected.expectedRevision + 1, selected.pushPurpose,
              selected.payloadDigest
            ]
          );
          selected.requestDigest = request.rows[0].request_digest;
          const prior = await priorReceipt(
            client, actor, selected, voipSessionState
          );
          if (prior) return prior;
          const installed = await loadInstallation(
            client,
            actor,
            selected.organizationId,
            selected.projectId,
            selected.installationId,
            voipSessionState
          );
          invariant(
            installed.state === "active" &&
              installed.revision === selected.expectedRevision,
            "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED",
            "Responder native-client state changed; retry safely.",
            { status: 409 }
          );
          const collisions = await client.query(
            `select registration.organization_id,
                    registration.installation_id,
                    registration.push_purpose, registration.key_version,
                    registration.command_id,
                    registration.token_lookup_digest,
                    registration.token_ownership_digest,
                    registration.token_ownership_kind,
                    registration.token_receipt_digest,
                    installation.customer_user_id,
                    installation.platform, installation.bundle_id,
                    installation.app_environment,
                    retirement.id is null as unretired
               from ss.responder_native_push_token_registrations registration
               join ss.responder_native_installations installation
                 on installation.organization_id = registration.organization_id
                and installation.id = registration.installation_id
               left join ss.responder_native_push_token_retirements retirement
                 on retirement.organization_id = registration.organization_id
                and retirement.registration_id = registration.id
              where registration.token_lookup_digest = any($1::text[])
                 or registration.token_ownership_digest = any($2::text[])
              order by registration.created_at desc, registration.id desc`,
            [
              selected.tokenCollisionCandidateDigests,
              selected.tokenOwnershipCandidateDigests
            ]
          );
          for (const collision of collisions.rows) {
            invariant(
              collision.customer_user_id === actor.userId &&
                collision.platform === installed.platform &&
                collision.bundle_id === installed.bundleId &&
                collision.app_environment === installed.appEnvironment &&
                (
                  collision.push_purpose === selected.pushPurpose ||
                  (
                    installed.platform === "android" &&
                    selected.tokenOwnershipCandidateDigests.includes(
                      collision.token_ownership_digest
                    )
                  )
                ),
              "RESPONDER_NATIVE_CLIENT_CONFLICT",
              "The native push token is already bound elsewhere.",
              { status: 409 }
            );
          }
          const exactCurrent = collisions.rows.find((collision) =>
            collision.organization_id === selected.organizationId &&
              collision.installation_id === selected.installationId &&
              collision.push_purpose === selected.pushPurpose &&
              collision.token_ownership_kind === "physical_v1" &&
              collision.key_version === selected.envelope.keyVersion &&
              collision.token_lookup_digest ===
                selected.envelope.tokenLookupDigest &&
              collision.token_ownership_digest ===
                selected.envelope.tokenOwnershipDigest &&
              collision.token_receipt_digest ===
                selected.envelope.tokenReceiptDigest &&
              collision.unretired === true
          );
          if (exactCurrent) {
              const receipt = await client.query(
                `select * from ss.responder_native_commands
                  where organization_id = $1 and command_id = $2`,
                [exactCurrent.organization_id, exactCurrent.command_id]
              );
              invariant(
                receipt.rowCount === 1,
                "RESPONDER_NATIVE_CLIENT_CONFLICT",
                "The native push token receipt is unavailable.",
                { status: 409 }
              );
              return commandReceipt(client, actor, receipt.rows[0], {
                replayed: true,
                semanticReplay: true,
                voipSessionState
              });
          }
          const current = await client.query(
            `select registration.*
               from ss.responder_native_commands command
               join ss.responder_native_push_token_registrations registration
                 on registration.organization_id = command.organization_id
                and registration.id = command.token_registration_id
              where command.organization_id = $1
                and command.installation_id = $2
                and command.push_purpose = $3
                and command.operation = 'register_token'
                and not exists (
                  select 1
                    from ss.responder_native_push_token_retirements retirement
                   where retirement.organization_id = registration.organization_id
                     and retirement.registration_id = registration.id
                )
              order by command.resulting_revision desc
              limit 1`,
            [
              selected.organizationId, selected.installationId,
              selected.pushPurpose
            ]
          );
          const retirementId = current.rowCount === 1 ? randomUUID() : null;
          let retirementEvidenceDigest = null;
          if (current.rowCount === 1) {
            const evidence = await client.query(
              `select ss.service_json_digest(jsonb_build_object(
                 'newTokenReferenceDigest',$1::text,
                 'oldTokenReferenceDigest',$2::text,
                 'pushPurpose',$3::text,
                 'schema','sitesourcery.responder-native-token-rotation-evidence/v1'
               )) as evidence_digest`,
              [
                selected.envelope.tokenLookupDigest,
                current.rows[0].token_lookup_digest,
                selected.pushPurpose
              ]
            );
            retirementEvidenceDigest = evidence.rows[0].evidence_digest;
          }
          await client.query(
            `insert into ss.responder_native_commands (
               organization_id, command_id, request_digest, project_id,
               installation_id, token_registration_id, token_retirement_id,
               actor_user_id, operation,
               expected_revision, resulting_revision, resulting_state,
               push_purpose, payload_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,'register_token',$9,$10,'active',
               $11,$12,$13
             )`,
            [
              selected.organizationId, selected.commandId,
              selected.requestDigest, selected.projectId,
              selected.installationId, selected.registrationId,
              retirementId, actor.userId,
              selected.expectedRevision, selected.expectedRevision + 1,
              selected.pushPurpose, selected.payloadDigest,
              selected.recordedAt
            ]
          );
          await client.query(
            `insert into ss.responder_native_push_token_registrations (
               id, organization_id, project_id, installation_id, command_id,
               push_purpose, token_lookup_digest, token_ownership_digest,
               token_ownership_kind, token_receipt_digest, key_version, nonce,
               authentication_tag, ciphertext, envelope_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,'physical_v1',$9,$10,$11,$12,$13,$14,$15
             )`,
            [
              selected.registrationId, selected.organizationId,
              selected.projectId, selected.installationId,
              selected.commandId, selected.pushPurpose,
              selected.envelope.tokenLookupDigest,
              selected.envelope.tokenOwnershipDigest,
              selected.envelope.tokenReceiptDigest,
              selected.envelope.keyVersion, selected.envelope.nonce,
              selected.envelope.authenticationTag,
              selected.envelope.ciphertext, selected.envelopeDigest,
              selected.recordedAt
            ]
          );
          if (current.rowCount === 1) {
            await client.query(
              `insert into ss.responder_native_push_token_retirements (
                 id, organization_id, project_id, installation_id, command_id,
                 registration_id, replacement_registration_id, actor_user_id,
                 push_purpose, reason, expected_installation_revision,
                 evidence_digest, created_at
               ) values (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,'token_replaced',$10,$11,$12
               )`,
              [
                retirementId, selected.organizationId, selected.projectId,
                selected.installationId, selected.commandId,
                current.rows[0].id, selected.registrationId, actor.userId,
                selected.pushPurpose, selected.expectedRevision,
                retirementEvidenceDigest, selected.recordedAt
              ]
            );
          }
          const row = await client.query(
            `select * from ss.responder_native_commands
              where organization_id = $1 and command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          return commandReceipt(client, actor, row.rows[0], {
            voipSessionState
          });
        }
      ));
    },

    retireToken(actor, input) {
      const selected = {
        commandId: commandId(input.commandId),
        retirementId: uuid(input.retirementId, "Token retirement ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        installationId: uuid(input.installationId, "Installation ID"),
        expectedRevision: input.expectedRevision,
        pushPurpose: input.pushPurpose,
        reason: input.reason,
        evidenceDigest: sha256(input.evidenceDigest, "Evidence digest"),
        recordedAt: instant(input.recordedAt, "Recorded time")
      };
      invariant(
        Number.isSafeInteger(selected.expectedRevision) &&
          selected.expectedRevision > 0 &&
          PURPOSES.has(selected.pushPurpose) &&
          selected.reason === "customer_request",
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native push-token retirement is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        customerContext(actor),
        async (client) => {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-native-installation:${selected.installationId}`]
          );
          const prior = await client.query(
            `select command.*, retirement.reason,
                    retirement.evidence_digest,
                    retirement.push_purpose
               from ss.responder_native_commands command
               join ss.responder_native_push_token_retirements retirement
                 on retirement.organization_id = command.organization_id
                and retirement.command_id = command.command_id
              where command.organization_id = $1 and command.command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          if (prior.rowCount === 1) {
            const row = prior.rows[0];
            invariant(
              row.operation === "retire_token" &&
                row.project_id === selected.projectId &&
                row.installation_id === selected.installationId &&
                Number(row.expected_revision) === selected.expectedRevision &&
                row.push_purpose === selected.pushPurpose &&
                row.reason === selected.reason &&
                row.evidence_digest === selected.evidenceDigest,
              "RESPONDER_NATIVE_CLIENT_IDEMPOTENCY_CONFLICT",
              "The native-client command was reused for different facts.",
              { status: 409 }
            );
            return commandReceipt(client, actor, row, {
              replayed: true,
              voipSessionState
            });
          }
          const installed = await loadInstallation(
            client,
            actor,
            selected.organizationId,
            selected.projectId,
            selected.installationId,
            voipSessionState
          );
          invariant(
            installed.state === "active" &&
              installed.revision === selected.expectedRevision &&
              installed.pushRegistrations.some(
                (entry) => entry.purpose === selected.pushPurpose &&
                  entry.active
              ),
            "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
            "Responder native push-token registration is unavailable.",
            { status: 404 }
          );
          const current = await client.query(
            `select registration.*
               from ss.responder_native_commands command
               join ss.responder_native_push_token_registrations registration
                 on registration.organization_id = command.organization_id
                and registration.id = command.token_registration_id
              where command.organization_id = $1
                and command.installation_id = $2
                and command.push_purpose = $3
                and command.operation = 'register_token'
                and not exists (
                  select 1
                    from ss.responder_native_push_token_retirements retirement
                   where retirement.organization_id = registration.organization_id
                     and retirement.registration_id = registration.id
                )
              order by command.resulting_revision desc
              limit 1`,
            [
              selected.organizationId, selected.installationId,
              selected.pushPurpose
            ]
          );
          invariant(
            current.rowCount === 1,
            "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
            "Responder native push-token registration is unavailable.",
            { status: 404 }
          );
          const payload = await client.query(
            `select ss.responder_native_token_retirement_payload_digest_v1(
               $1,$2,$3,$4,$5,$6,$7,null,$8,$9
             ) as payload_digest`,
            [
              actor.userId, selected.organizationId, selected.projectId,
              selected.installationId, selected.expectedRevision,
              selected.pushPurpose, current.rows[0].id, selected.reason,
              selected.evidenceDigest
            ]
          );
          selected.payloadDigest = payload.rows[0].payload_digest;
          const request = await client.query(
            `select ss.responder_native_command_request_digest_v1(
               $1,$2,$3,$4,'retire_token',$5,$6,$7,$8
             ) as request_digest`,
            [
              actor.userId, selected.organizationId, selected.projectId,
              selected.installationId, selected.expectedRevision,
              selected.expectedRevision + 1, selected.pushPurpose,
              selected.payloadDigest
            ]
          );
          selected.requestDigest = request.rows[0].request_digest;
          await client.query(
            `insert into ss.responder_native_commands (
               organization_id, command_id, request_digest, project_id,
               installation_id, token_retirement_id, actor_user_id, operation,
               expected_revision, resulting_revision, resulting_state,
               push_purpose, payload_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,'retire_token',$8,$9,'active',$10,$11,$12
             )`,
            [
              selected.organizationId, selected.commandId,
              selected.requestDigest, selected.projectId,
              selected.installationId, selected.retirementId, actor.userId,
              selected.expectedRevision, selected.expectedRevision + 1,
              selected.pushPurpose, selected.payloadDigest,
              selected.recordedAt
            ]
          );
          await client.query(
            `insert into ss.responder_native_push_token_retirements (
               id, organization_id, project_id, installation_id, command_id,
               registration_id, replacement_registration_id, actor_user_id,
               push_purpose, reason, expected_installation_revision,
               evidence_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11,$12
             )`,
            [
              selected.retirementId, selected.organizationId,
              selected.projectId, selected.installationId,
              selected.commandId, current.rows[0].id, actor.userId,
              selected.pushPurpose, selected.reason,
              selected.expectedRevision, selected.evidenceDigest,
              selected.recordedAt
            ]
          );
          const row = await client.query(
            `select * from ss.responder_native_commands
              where organization_id = $1 and command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          return commandReceipt(client, actor, row.rows[0], {
            voipSessionState
          });
        }
      ));
    },

    suspendInstallation(actor, input) {
      return stateTransition(actor, input, {
        operation: "suspend",
        resultingState: "suspended",
        allowedPriorStates: new Set(["active"]),
        allowedReasons: new Set(["logout"])
      });
    },

    resumeInstallation(actor, input) {
      return stateTransition(actor, input, {
        operation: "resume",
        resultingState: "active",
        allowedPriorStates: new Set(["suspended"]),
        allowedReasons: new Set(["login"])
      });
    },

    revokeInstallation(actor, input) {
      return stateTransition(actor, input, {
        operation: "revoke",
        resultingState: "revoked",
        allowedPriorStates: new Set(["active", "suspended"]),
        allowedReasons: TERMINAL_REVOCATION_REASONS
      });
    },

    listInstallations(actor, { organizationId, projectId }) {
      const selectedOrganizationId = uuid(organizationId, "Organization ID");
      const selectedProjectId = uuid(projectId, "Project ID");
      return translated(() => authority.service(
        customerContext(actor, true),
        async (client) => {
          const ids = await client.query(
            `select id from ss.responder_native_installations
              where organization_id = $1 and project_id = $2
                and customer_user_id = $3
              order by created_at desc, id desc
              limit 50`,
            [selectedOrganizationId, selectedProjectId, actor.userId]
          );
          const installations = [];
          for (const row of ids.rows) {
            installations.push(await loadInstallation(
              client,
              actor,
              selectedOrganizationId,
              selectedProjectId,
              row.id,
              voipSessionState
            ));
          }
          return deepFreeze({
            schema: "sitesourcery.responder-native-installation-list/v1",
            organizationId: selectedOrganizationId,
            projectId: selectedProjectId,
            installations,
            voipSessionState,
            providerEffects: false,
            pushDeliveryEffects: false,
            voiceCallEffects: false,
            carrierCommandEffects: false,
            messageSendEffects: false
          });
        }
      ));
    },

    getInstallation(actor, { organizationId, projectId, installationId }) {
      const selectedOrganizationId = uuid(organizationId, "Organization ID");
      const selectedProjectId = uuid(projectId, "Project ID");
      const selectedInstallationId = uuid(
        installationId, "Installation ID"
      );
      return translated(() => authority.service(
        customerContext(actor, true),
        (client) => loadInstallation(
          client,
          actor,
          selectedOrganizationId,
          selectedProjectId,
          selectedInstallationId,
          voipSessionState
        )
      ));
    },

    issueVoipSession(actor, input) {
      const selected = {
        commandId: commandId(input.commandId),
        sessionId: uuid(input.sessionId, "Voice session ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        projectId: uuid(input.projectId, "Project ID"),
        installationId: uuid(input.installationId, "Installation ID"),
        expectedRevision: input.expectedRevision
      };
      invariant(
        Number.isSafeInteger(selected.expectedRevision) &&
          selected.expectedRevision > 0 &&
          selected.organizationId === actor?.organizationId,
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native VoIP session request is invalid.",
        { status: 400 }
      );
      return translated(() => authority.service(
        customerContext(actor),
        async (client) => {
          const membership = await client.query(
            `select exists (
               select 1 from ss.organization_memberships membership
                where membership.organization_id = $1
                  and membership.user_id = $2
                  and membership.state = 'active'
             ) as active`,
            [selected.organizationId, actor.userId]
          );
          invariant(
            membership.rows[0]?.active === true,
            "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
            "Responder native-client authority is unavailable.",
            { status: 404 }
          );
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`responder-native-installation:${selected.installationId}`]
          );
          const installed = await loadInstallation(
            client,
            actor,
            selected.organizationId,
            selected.projectId,
            selected.installationId,
            voipSessionState
          );
          const voipRegistration = installed.pushRegistrations.find(
            (entry) => entry.purpose === "voip" && entry.active
          );
          invariant(
            installed.state === "active" &&
              installed.revision === selected.expectedRevision &&
              voipRegistration,
            "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
            "Responder native VoIP registration is unavailable.",
            { status: 404 }
          );
          const clientPlatform = installed.platform;
          const transport = `twilio_voice_${clientPlatform}`;
          const request = await client.query(
            `select ss.responder_native_voice_session_request_digest_v2(
               $1,$2,$3,$4,$5,$6,$7,$8,$9
             ) as request_digest`,
            [
              actor.userId, selected.organizationId, selected.projectId,
              selected.installationId, selected.expectedRevision,
              clientPlatform, transport, installed.appEnvironment,
              voipRegistration.tokenReferenceDigest
            ]
          );
          selected.requestDigest = request.rows[0].request_digest;
          const authorityValue = Object.freeze({
            sessionId: selected.sessionId,
            commandId: selected.commandId,
            requestDigest: selected.requestDigest,
            organizationId: selected.organizationId,
            projectId: selected.projectId,
            userId: actor.userId,
            installationId: selected.installationId,
            installationRevision: selected.expectedRevision,
            clientPlatform,
            transport,
            appEnvironment: installed.appEnvironment
          });
          if (voiceAccess.mode === "held") {
            voiceAccess.issueSession(authorityValue);
            throw new HostedError(
              "RESPONDER_NATIVE_VOIP_HELD",
              "Native VoIP access remains held pending explicit provider activation.",
              { status: 409 }
            );
          }
          const prior = await client.query(
            `select voice_session.*,
                    voice_session.expires_at > clock_timestamp() as active
               from ss.responder_native_voice_sessions voice_session
              where voice_session.organization_id = $1
                and voice_session.command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          if (prior.rowCount === 1) {
            const row = prior.rows[0];
            invariant(
              row.request_digest === selected.requestDigest,
              "RESPONDER_NATIVE_CLIENT_IDEMPOTENCY_CONFLICT",
              "The native VoIP session command was reused for different facts.",
              { status: 409 }
            );
            invariant(
              row.active === true,
              "RESPONDER_NATIVE_VOIP_SESSION_EXPIRED",
              "The prior native VoIP session expired; use a new idempotency key.",
              { status: 409 }
            );
            const accessToken = voiceAccess.openSession(
              voiceSessionAuthority(row),
              voiceSessionMetadata(row),
              voiceSessionEnvelope(row)
            );
            return voiceSessionProjection(row, accessToken, {
              replayed: true
            });
          }
          const semantic = await client.query(
            `select voice_session.*
               from ss.responder_native_voice_sessions voice_session
              where voice_session.request_digest = $1
                and voice_session.expires_at > clock_timestamp()
              order by voice_session.issued_at desc, voice_session.id desc
              limit 1`,
            [selected.requestDigest]
          );
          if (semantic.rowCount === 1) {
            const row = semantic.rows[0];
            const accessToken = voiceAccess.openSession(
              voiceSessionAuthority(row),
              voiceSessionMetadata(row),
              voiceSessionEnvelope(row)
            );
            return voiceSessionProjection(row, accessToken, {
              replayed: true,
              semanticReplay: true
            });
          }
          const issued = voiceAccess.issueSession(authorityValue);
          const envelopeDigest = await client.query(
            `select ss.responder_native_voice_session_envelope_digest_v2(
               $1,$2,$3,$4,$5,$6,$7
             ) as envelope_digest`,
            [
              clientPlatform, transport,
              issued.envelope.keyVersion, issued.envelope.nonce,
              issued.envelope.authenticationTag, issued.envelope.ciphertext,
              issued.tokenDigest
            ]
          );
          await client.query(
            `insert into ss.responder_native_voice_sessions (
               id, organization_id, project_id, installation_id,
               customer_user_id, command_id, request_digest,
               installation_revision, client_platform, transport,
               app_environment,
               voip_registration_reference_digest, identity_digest,
               endpoint_digest, credential_digest, jti_digest, token_digest,
               key_version, nonce, authentication_tag, ciphertext,
               envelope_digest, issued_at, expires_at, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,$18,$19,$20,$21,$22,$23,$24,$23
             )`,
            [
              selected.sessionId, selected.organizationId,
              selected.projectId, selected.installationId, actor.userId,
              selected.commandId, selected.requestDigest,
              selected.expectedRevision, clientPlatform, transport,
              installed.appEnvironment,
              voipRegistration.tokenReferenceDigest,
              issued.identityDigest, issued.endpointDigest,
              issued.credentialDigest, issued.jtiDigest, issued.tokenDigest,
              issued.envelope.keyVersion, issued.envelope.nonce,
              issued.envelope.authenticationTag, issued.envelope.ciphertext,
              envelopeDigest.rows[0].envelope_digest, issued.issuedAt,
              issued.expiresAt
            ]
          );
          const created = await client.query(
            `select * from ss.responder_native_voice_sessions
              where organization_id = $1 and command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          invariant(
            created.rowCount === 1,
            "RESPONDER_NATIVE_CLIENT_CONFLICT",
            "Responder native VoIP session evidence is unavailable.",
            { status: 409 }
          );
          return voiceSessionProjection(
            created.rows[0], issued.accessToken
          );
        }
      ));
    },

    requireHeldVoipSession(actor, input) {
      return this.issueVoipSession(actor, input);
    }
  });
}
