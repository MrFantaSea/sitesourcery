import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
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

function projection(row, tokenRows = []) {
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
    voipSessionState: "held",
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false
  });
}

async function loadInstallation(client, actor, organizationId, projectId, id) {
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
    `select distinct on (registration.push_purpose)
            registration.push_purpose, registration.token_lookup_digest,
            registration.key_version, registration.created_at,
            command.resulting_revision
       from ss.responder_native_push_token_registrations registration
       join ss.responder_native_commands command
         on command.organization_id = registration.organization_id
        and command.command_id = registration.command_id
      where registration.organization_id = $1
        and registration.installation_id = $2
      order by registration.push_purpose,
               command.resulting_revision desc, registration.id desc`,
    [organizationId, id]
  );
  return projection(result.rows[0], tokens.rows);
}

async function commandReceipt(
  client,
  actor,
  row,
  { replayed = false, semanticReplay = false } = {}
) {
  return deepFreeze({
    schema: "sitesourcery.responder-native-command-receipt/v1",
    commandId: row.command_id,
    requestDigest: row.request_digest,
    operation: row.operation,
    replayed,
    semanticReplay,
    installation: await loadInstallation(
      client,
      actor,
      row.organization_id,
      row.project_id,
      row.installation_id
    ),
    providerEffects: false,
    pushDeliveryEffects: false,
    voiceCallEffects: false,
    carrierCommandEffects: false,
    messageSendEffects: false
  });
}

async function priorReceipt(client, actor, selected) {
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
    return commandReceipt(client, actor, prior.rows[0], { replayed: true });
  }
  const semantic = await client.query(
    `select * from ss.responder_native_commands where request_digest = $1`,
    [selected.requestDigest]
  );
  return semantic.rowCount === 1
    ? commandReceipt(client, actor, semantic.rows[0], {
        replayed: true,
        semanticReplay: true
      })
    : null;
}

export function createPostgresResponderNativeClientRepository({
  authority,
  verifierKeyVersions,
  randomUUID = systemRandomUUID
} = {}) {
  invariant(
    typeof authority?.service === "function" &&
      typeof randomUUID === "function" &&
      Array.isArray(verifierKeyVersions) &&
      verifierKeyVersions.length >= 1 && verifierKeyVersions.length <= 4 &&
      verifierKeyVersions.every(
        (entry) => typeof entry === "string" && VERSION.test(entry)
      ),
    "RESPONDER_NATIVE_CLIENT_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL native-client authority is required.",
    { status: 500 }
  );

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
        const prior = await priorReceipt(client, actor, selected);
        if (prior) return prior;
        const installed = await loadInstallation(
          client,
          actor,
          selected.organizationId,
          selected.projectId,
          selected.installationId
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
        return commandReceipt(client, actor, row.rows[0]);
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
                as contract_ready,
              (select count(*) = 4
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
              ) as token_keys_covered
          `, [[
            "responder_native_commands",
            "responder_native_installations",
            "responder_native_push_token_registrations",
            "responder_native_state_transitions"
          ], verifierKeyVersions])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.token_keys_covered === true;
        return deepFreeze({
          ready,
          verified: ready,
          kind: "responder-native-client-postgres",
          mode: "held-local",
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
          const prior = await priorReceipt(client, actor, selected);
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
          return commandReceipt(client, actor, row.rows[0]);
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
          const digestRows = await client.query(
            `select
               ss.responder_native_token_envelope_digest_v1(
                 $1,$2,$3,$4,$5
               ) as envelope_digest,
               ss.responder_native_token_payload_digest_v1($6,$1)
                 as payload_digest`,
            [
              selected.envelope.tokenLookupDigest,
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
          const prior = await priorReceipt(client, actor, selected);
          if (prior) return prior;
          const installed = await loadInstallation(
            client,
            actor,
            selected.organizationId,
            selected.projectId,
            selected.installationId
          );
          invariant(
            installed.state === "active" &&
              installed.revision === selected.expectedRevision &&
              (selected.pushPurpose !== "voip" ||
                installed.platform === "ios"),
            "RESPONDER_NATIVE_CLIENT_RETRY_REQUIRED",
            "Responder native-client state changed; retry safely.",
            { status: 409 }
          );
          const collisions = await client.query(
            `select registration.installation_id,
                    registration.push_purpose, registration.key_version
               from ss.responder_native_push_token_registrations registration
              where registration.token_lookup_digest = any($1::text[])
              limit 1`,
            [selected.tokenLookupCandidateDigests]
          );
          if (collisions.rowCount === 1) {
            const collision = collisions.rows[0];
            invariant(
              collision.installation_id === selected.installationId &&
                collision.push_purpose === selected.pushPurpose &&
                collision.key_version !== selected.envelope.keyVersion,
              "RESPONDER_NATIVE_CLIENT_CONFLICT",
              "The native push token is already bound elsewhere.",
              { status: 409 }
            );
          }
          await client.query(
            `insert into ss.responder_native_commands (
               organization_id, command_id, request_digest, project_id,
               installation_id, token_registration_id, actor_user_id,
               operation,
               expected_revision, resulting_revision, resulting_state,
               push_purpose, payload_digest, created_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,'register_token',$8,$9,'active',$10,$11,$12
             )`,
            [
              selected.organizationId, selected.commandId,
              selected.requestDigest, selected.projectId,
              selected.installationId, selected.registrationId, actor.userId,
              selected.expectedRevision, selected.expectedRevision + 1,
              selected.pushPurpose, selected.payloadDigest,
              selected.recordedAt
            ]
          );
          await client.query(
            `insert into ss.responder_native_push_token_registrations (
               id, organization_id, project_id, installation_id, command_id,
               push_purpose, token_lookup_digest, key_version, nonce,
               authentication_tag, ciphertext, envelope_digest, created_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              selected.registrationId, selected.organizationId,
              selected.projectId, selected.installationId,
              selected.commandId, selected.pushPurpose,
              selected.envelope.tokenLookupDigest,
              selected.envelope.keyVersion, selected.envelope.nonce,
              selected.envelope.authenticationTag,
              selected.envelope.ciphertext, selected.envelopeDigest,
              selected.recordedAt
            ]
          );
          const row = await client.query(
            `select * from ss.responder_native_commands
              where organization_id = $1 and command_id = $2`,
            [selected.organizationId, selected.commandId]
          );
          return commandReceipt(client, actor, row.rows[0]);
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
              row.id
            ));
          }
          return deepFreeze({
            schema: "sitesourcery.responder-native-installation-list/v1",
            organizationId: selectedOrganizationId,
            projectId: selectedProjectId,
            installations,
            voipSessionState: "held",
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
          selectedInstallationId
        )
      ));
    },

    async requireHeldVoipSession(actor, input) {
      const selectedOrganizationId = uuid(
        input.organizationId, "Organization ID"
      );
      const selectedProjectId = uuid(input.projectId, "Project ID");
      const selectedInstallationId = uuid(
        input.installationId, "Installation ID"
      );
      invariant(
        Number.isSafeInteger(input.expectedRevision) &&
          input.expectedRevision > 0,
        "RESPONDER_NATIVE_CLIENT_INVALID",
        "The native VoIP session request is invalid.",
        { status: 400 }
      );
      await translated(() => authority.service(
        customerContext(actor, true),
        async (client) => {
          const installed = await loadInstallation(
            client,
            actor,
            selectedOrganizationId,
            selectedProjectId,
            selectedInstallationId
          );
          invariant(
            installed.state === "active" &&
              installed.revision === input.expectedRevision &&
              installed.platform === "ios" &&
              installed.pushRegistrations.some(
                (entry) => entry.purpose === "voip" && entry.active
              ),
            "RESPONDER_NATIVE_CLIENT_UNAVAILABLE",
            "Responder native VoIP registration is unavailable.",
            { status: 404 }
          );
        }
      ));
      throw new HostedError(
        "RESPONDER_NATIVE_VOIP_HELD",
        "Native VoIP access remains held pending explicit provider activation.",
        { status: 409 }
      );
    }
  });
}
