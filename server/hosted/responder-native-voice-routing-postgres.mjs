import { invariant } from "./errors.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SELECT_ROUTES = `
  select session.*, binding.account_sid_digest, topology.id as topology_id, topology.revision as topology_revision
    from ss.responder_provider_number_bindings binding
    join ss.responder_twilio_provider_topologies topology on topology.organization_id = binding.organization_id
      and topology.state = 'active' and topology.account_sid_digest = binding.account_sid_digest
    join ss.organizations organization on organization.id = binding.organization_id
      and organization.state = 'active'
    join ss.projects project on project.id = binding.project_id
      and project.organization_id = binding.organization_id and project.lifecycle = 'active'
    join ss.responder_runtime_controls control on control.organization_id = binding.organization_id
      and control.state = 'approved_live' and not control.global_kill_engaged
    join ss.responder_native_installations installation
      on installation.organization_id = binding.organization_id and installation.project_id = binding.project_id
    join ss.organization_memberships membership on membership.organization_id = installation.organization_id
      and membership.user_id = installation.customer_user_id and membership.state = 'active'
    join lateral (
      select resulting_revision, resulting_state from ss.responder_native_commands command
       where command.organization_id = installation.organization_id and command.installation_id = installation.id
       order by resulting_revision desc limit 1
    ) current_command on current_command.resulting_state = 'active'
    join lateral (
      select operation, token_registration_id from ss.responder_native_commands command
       where command.organization_id = installation.organization_id and command.installation_id = installation.id
         and command.push_purpose = 'voip' order by resulting_revision desc limit 1
    ) token_command on token_command.operation = 'register_token'
    join ss.responder_native_push_token_registrations registration
      on registration.id = token_command.token_registration_id
      and registration.installation_id = installation.id and registration.organization_id = installation.organization_id
      and registration.token_ownership_kind = 'physical_v1'
      and not exists (select 1 from ss.responder_native_push_token_retirements retirement
        where retirement.registration_id = registration.id)
    join lateral (
      select voice.* from ss.responder_native_voice_sessions voice
       where voice.organization_id = installation.organization_id and voice.project_id = installation.project_id
         and voice.installation_id = installation.id and voice.customer_user_id = installation.customer_user_id
         and voice.installation_revision = current_command.resulting_revision
         and voice.voip_registration_reference_digest = registration.token_lookup_digest
         and voice.client_platform = installation.platform and voice.app_environment = installation.app_environment
       order by voice.created_at desc, voice.id desc limit 1
    ) session on true
   where binding.id = $1 and binding.state = 'active' and binding.provider = 'twilio'
     and not exists (
       select 1 from ss.responder_commerce_reservations reservation
        where reservation.organization_id = binding.organization_id and reservation.project_id = binding.project_id
          and reservation.state in ('cancelled', 'ambiguity_review_required')
     )
   order by installation.id limit 10`;

const iso = value => value instanceof Date ? value.toISOString() : String(value);
function provenance(row) {
  return {
    authority: { sessionId: row.id, commandId: row.command_id, requestDigest: row.request_digest,
      organizationId: row.organization_id, projectId: row.project_id, userId: row.customer_user_id,
      installationId: row.installation_id, installationRevision: Number(row.installation_revision),
      clientPlatform: row.client_platform, transport: row.transport, appEnvironment: row.app_environment },
    metadata: { issuedAt: iso(row.issued_at), expiresAt: iso(row.expires_at), identityDigest: row.identity_digest,
      endpointDigest: row.endpoint_digest, credentialDigest: row.credential_digest,
      jtiDigest: row.jti_digest, tokenDigest: row.token_digest },
    envelope: { keyVersion: row.key_version, nonce: row.nonce, authenticationTag: row.authentication_tag, ciphertext: row.ciphertext }
  };
}

export function createPostgresResponderNativeVoiceRoutes({ authority, nativeClientRepository, voiceAccess } = {}) {
  invariant(authority?.kind === "canonical-postgres" && typeof authority.service === "function" &&
    typeof nativeClientRepository?.readiness === "function" && typeof voiceAccess?.resolveRoutingIdentity === "function",
  "RESPONDER_NATIVE_VOICE_ROUTING_CONFIGURATION_REQUIRED", "Native Voice routing requires canonical authority.", { status: 500 });
  return Object.freeze({
    kind: "responder-native-voice-routes-postgres", providerEffects: false,
    async readiness() {
      const status = await nativeClientRepository.readiness();
      return { ready: status.ready === true && status.verified === true, verified: status.ready === true && status.verified === true };
    },
    async resolveIdentities({ numberBindingId }) {
      invariant(UUID.test(numberBindingId ?? ""), "RESPONDER_NATIVE_VOICE_ROUTE_UNAVAILABLE", "Native Voice route is unavailable.", { status: 503 });
      const read = () => authority.service({ actorKind: "system", readOnly: true },
        client => client.query(SELECT_ROUTES, [numberBindingId]));
      const selected = await read();
      const fence = row => `${row.id}:${row.topology_id}:${row.topology_revision}:${row.account_sid_digest}`;
      const identities = [];
      for (const row of selected.rows) {
        const value = provenance(row);
        try {
          const identity = await voiceAccess.resolveRoutingIdentity(value.authority, value.metadata, value.envelope, row.account_sid_digest);
          identities.push({ fence: fence(row), identity });
        } catch {
          // Old credentials/identity keys are not evidence of current authority.
        }
      }
      // The canonical authority defaults to SERIALIZABLE. A separate transaction
      // is necessary: a second SELECT in the original snapshot cannot see a
      // suspension or topology retirement committed during provider validation.
      const current = await read();
      const authorized = new Set(current.rows.map(fence));
      return identities.filter(value => authorized.has(value.fence)).map(value => value.identity);
    }
  });
}
