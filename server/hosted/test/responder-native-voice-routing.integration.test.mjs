import { createTwilioIsvProviderRegistry } from "../responder-twilio-provider-registry.mjs";
import { createResponderNativeVoiceRouting } from "../responder-native-voice-routing.mjs";
import { createTwilioResponderNativeVoiceDialPlan, TWILIO_RESPONDER_HELD_VOICE_TWIML } from "../twilio-responder-voice-dial-plan.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import jwt from "jsonwebtoken";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";
import { createPostgresResponderNativeClientRepository } from "../responder-native-client-postgres.mjs";
import { createResponderNativeTokenAuthority } from "../responder-native-token-authority.mjs";
import { createTwilioResponderVoiceAccess } from "../twilio-responder-voice-access.mjs";
import { createPostgresResponderNativeVoiceRoutes } from "../responder-native-voice-routing-postgres.mjs";
import { createPostgresResponderNumberBindingsRepository } from "../responder-number-bindings-postgres.mjs";
import { createPostgresResponderTwilioProviderTopologyRepository } from "../responder-twilio-provider-topology-postgres.mjs";
import { digest } from "../security.mjs";
const DATABASE_URL = process.env.SITESOURCERY_PG_NATIVE_VOICE_ROUTING_TEST_URL;
const ACCOUNT_SID = `AC${randomUUID().replaceAll("-", "")}`;
function providerTopology(organizationId) {
  const selected = {
    organizationId,
    registrationClass: "LOW_VOLUME_STANDARD",
    providerBrandType: "STANDARD",
    campaignUseCase: "CUSTOMER_CARE",
    accountSidDigest: digest(ACCOUNT_SID),
    messagingServiceSidDigest: digest(`MG:${organizationId}`)
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
  ]) selected[field] = digest(`native-route:${organizationId}:${field}`);
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

test("native incoming routes use durable current authority, independently of five-minute token expiry", { skip: !DATABASE_URL }, async t => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_native_voice_routing_(?:[0-9]+|ci_[0-9]+_[0-9]+)$/u, "owned disposable database only");
    const ids = await seed(pool), authority = createCanonicalPostgresAuthority({ pool });
    const customer = { kind: "customer", organizationId: ids.organization, userId: ids.customer };
    const operator = { kind: "operator", organizationId: ids.organization, userId: ids.operator };
    const topology = providerTopology(ids.organization);
    const topologyRepository = createPostgresResponderTwilioProviderTopologyRepository({ authority });
    const nonce = randomUUID();
    const topologyReceipt = await topologyRepository.attestTopology(operator, { commandId: `route-topology-${nonce}`, requestDigest: digest(nonce),
      ...topology, providerReadbackDigest: digest("synthetic-readback"), topologyEvidenceDigest: digest("synthetic-evidence"), recordedAt: new Date().toISOString() });
    const provider = { accountSid: ACCOUNT_SID, voiceApiKeySid: `SK${"2".repeat(32)}`, voiceApiKeySecret: "3".repeat(40),
      voiceSandboxPushCredentialSid: `CR${"4".repeat(32)}`, voiceProductionPushCredentialSid: `CR${"5".repeat(32)}`,
      voiceAndroidSandboxPushCredentialSid: `CR${"6".repeat(32)}`, voiceAndroidProductionPushCredentialSid: `CR${"7".repeat(32)}`, topology };
    const providerRegistry = { kind: "twilio-isv-provider-registry", providerEffects: false,
      async readiness() { return { ready: true, verified: true }; }, resolveOrganization(id) { assert.equal(id, ids.organization); return provider; } };
    const tokenAuthority = createResponderNativeTokenAuthority({ pepper: Buffer.alloc(32, 29), pepperVersion: "native-route-v1" });
    const voiceAccess = createTwilioResponderVoiceAccess({ pepper: Buffer.alloc(32, 29), pepperVersion: "native-route-v1",
      environment: { SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified" }, providerRegistry, providerTopologyRepository: topologyRepository,
      tokenFactory({ accountSid, apiKeySid, apiKeySecret, identity, endpointId, pushCredentialSid, ttlSeconds }) {
        const iat = Math.floor(Date.now()/1000)-298;
        return jwt.sign({ iat, jti: randomUUID(), grants: { identity, voice: { incoming: { allow: true },
          push_credential_sid: pushCredentialSid, endpoint_id: endpointId } } }, apiKeySecret,
          { algorithm: "HS256", issuer: apiKeySid, subject: accountSid, expiresIn: ttlSeconds, header: { cty: "twilio-fpa;v=1", typ: "JWT" } });
      } });
    const native = createPostgresResponderNativeClientRepository({ authority, verifierKeyVersions: tokenAuthority.verifierVersions, voiceAccess });
    const routes = createPostgresResponderNativeVoiceRoutes({ authority, nativeClientRepository: native, voiceAccess });
    const bindings = createPostgresResponderNumberBindingsRepository({ authority, verifierKeyVersions: ["native-route-v1"] });
    const binding = await bindings.provisionBinding(operator, { commandId: `route-binding-${nonce}`, requestDigest: digest(`binding-${nonce}`),
      organizationId: ids.organization, projectId: ids.project, numberLookupDigest: digest(nonce), numberLookupCandidateDigests: [digest(nonce)],
      lookupKeyVersion: "native-route-v1", phoneNumberSidDigest: digest(`PN${nonce}`), accountSidDigest: topology.accountSidDigest,
      messagingServiceSidDigest: null, providerReadbackDigest: digest("synthetic-readback"), provisionEvidenceDigest: digest("synthetic-evidence"), recordedAt: new Date().toISOString() });
    const lookup = () => routes.resolveIdentities({ numberBindingId: binding.id });
    const installations = [];
    async function register(platform, index) {
      const created = await native.createInstallation(customer, { commandId: `route-create-${index}-${nonce}`, installationId: randomUUID(),
        organizationId: ids.organization, projectId: ids.project, platform, bundleId: "com.sitesourcery.responder", appEnvironment: "sandbox",
        appVersion: "1.0.0", buildNumber: "1", installationKeyDigest: digest(`install-${index}-${nonce}`), recordedAt: new Date().toISOString() });
      const scope = { id: created.installation.id, organizationId: ids.organization, projectId: ids.project, userId: ids.customer,
        platform, bundleId: "com.sitesourcery.responder", environment: "sandbox" };
      const value = { id: scope.id, revision: 1, scope, platform };
      installations.push(value);
      await rotate(value, platform === "ios" ? digest(randomUUID()) : `fcm:route_${nonce}_${index}_1234567890`);
      return value;
    }
    async function rotate(value, token) {
      const candidates = tokenAuthority.tokenLookupCandidates(value.scope, "voip", token);
      const registration = await native.registerToken(customer, { commandId: `route-token-${randomUUID()}`, registrationId: randomUUID(),
        organizationId: ids.organization, projectId: ids.project, installationId: value.id, expectedRevision: value.revision,
        pushPurpose: "voip", tokenLookupCandidateDigests: candidates.map(x => x.digest), tokenOwnershipCandidateDigests: candidates.map(x => x.ownershipDigest),
        envelope: await tokenAuthority.sealToken(value.scope, "voip", token), recordedAt: new Date().toISOString() });
      value.revision = registration.installation.revision;
    }
    async function issue(value) {
      const issued = await native.issueVoipSession(customer, { commandId: `route-session-${randomUUID()}`, sessionId: randomUUID(),
        organizationId: ids.organization, projectId: ids.project, installationId: value.id, expectedRevision: value.revision });
      value.identity = `ssr_${issued.identityDigest.slice(0,48)}`;
      return issued;
    }
    const ios = await register("ios", 1), android = await register("android", 2);
    await issue(ios); await issue(android);
    await t.test("held controls deny otherwise valid devices", async () => {
      assert.deepEqual(await lookup(), []);
      await authority.service({ actorKind: "system", organizationId: ids.organization }, client => client.query(
        "insert into ss.responder_runtime_controls(organization_id,created_at,updated_at) values($1,clock_timestamp(),clock_timestamp())", [ids.organization]));
      assert.deepEqual(await lookup(), []);
      await authority.service({ actorKind: "operator", userId: ids.operator, organizationId: ids.organization }, client => client.query(
        `update ss.responder_runtime_controls set state='approved_live',global_kill_engaged=false,revision=revision+1,
          release_evidence_digest=$2,released_at=clock_timestamp(),released_by_operator_user_id=$3,updated_at=clock_timestamp() where organization_id=$1`,
        [ids.organization,digest("synthetic-release"),ids.operator]));
      assert.deepEqual(new Set(await lookup()), new Set([ios.identity, android.identity]));
    });
    await t.test("SDK registration remains routable after JWT expiry", async () => {
      await new Promise(resolve => setTimeout(resolve, 2200));
      assert.equal((await pool.query("select bool_and(expires_at < clock_timestamp()) as expired from ss.responder_native_voice_sessions where organization_id=$1",[ids.organization])).rows[0].expired,true);
      assert.deepEqual(new Set(await lookup()), new Set([ios.identity, android.identity]));
    });
    await t.test("membership suspension and project cancellation remove routes", async () => {
      await pool.query("update ss.organization_memberships set state='suspended' where organization_id=$1 and user_id=$2",[ids.organization,ids.customer]);
      assert.deepEqual(await lookup(), []);
      await pool.query("update ss.organization_memberships set state='active' where organization_id=$1 and user_id=$2",[ids.organization,ids.customer]);
      await pool.query("update ss.projects set lifecycle='cancelled' where id=$1",[ids.project]);
      assert.deepEqual(await lookup(), []);
      await pool.query("update ss.projects set lifecycle='active' where id=$1",[ids.project]);
    });
    await t.test("rotation removes old per-install identity without disabling the other device", async () => {
      const old = ios.identity;
      await rotate(ios, digest(randomUUID()));
      assert.deepEqual(await lookup(), [android.identity]);
      await issue(ios);
      assert.notEqual(ios.identity, old);
      assert.deepEqual(new Set(await lookup()), new Set([ios.identity,android.identity]));
    });
    await t.test("suspension, resume revision and terminal revocation fence old sessions", async () => {
      const transition = async (method, reason) => {
        const result = await native[method](customer, { commandId: `route-transition-${randomUUID()}`, transitionId: randomUUID(),
          organizationId: ids.organization,projectId: ids.project,installationId: ios.id,expectedRevision: ios.revision,
          reason,evidenceDigest:digest(randomUUID()),recordedAt:new Date().toISOString() });
        ios.revision=result.installation.revision;
      };
      await transition("suspendInstallation", "logout");
      assert.deepEqual(await lookup(), [android.identity]);
      await transition("resumeInstallation", "login");
      assert.deepEqual(await lookup(), [android.identity]);
      await issue(ios);
      assert.equal((await lookup()).length, 2);
      await transition("revokeInstallation", "device_lost");
      assert.deepEqual(await lookup(), [android.identity]);
    });
    await t.test("authority revoked during provider validation is re-read before Dial", async () => {
      let changed = false;
      const racing = createPostgresResponderNativeVoiceRoutes({ authority,nativeClientRepository:native,
        voiceAccess:{ async resolveRoutingIdentity(...args) {
          const identity=await voiceAccess.resolveRoutingIdentity(...args);
          if (!changed) { changed=true; await native.suspendInstallation(customer, { commandId:`route-race-${randomUUID()}`,transitionId:randomUUID(),
            organizationId:ids.organization,projectId:ids.project,installationId:android.id,expectedRevision:android.revision,
            reason:"logout",evidenceDigest:digest("race"),recordedAt:new Date().toISOString() }); }
          return identity;
        } } });
      assert.deepEqual(await racing.resolveIdentities({numberBindingId:binding.id}),[]);
    });
    await t.test("unknown bindings are empty and provider topology revocation is enforced", async () => {
      assert.deepEqual(await routes.resolveIdentities({numberBindingId:randomUUID()}),[]);
      const resumed=await native.resumeInstallation(customer,{commandId:`route-resume-${randomUUID()}`,transitionId:randomUUID(),
        organizationId:ids.organization,projectId:ids.project,installationId:android.id,expectedRevision:android.revision+1,
        reason:"login",evidenceDigest:digest("resume"),recordedAt:new Date().toISOString()});
      android.revision=resumed.installation.revision;
      await issue(android);
      assert.deepEqual(await lookup(),[android.identity]);
      await authority.service({actorKind:"operator",userId:ids.operator,organizationId:ids.organization},client=>client.query(
        "update ss.responder_runtime_controls set global_kill_engaged=true,revision=revision+1,updated_at=clock_timestamp() where organization_id=$1",[ids.organization]));
      assert.deepEqual(await lookup(),[]);
      await authority.service({actorKind:"operator",userId:ids.operator,organizationId:ids.organization},client=>client.query(
        "update ss.responder_runtime_controls set global_kill_engaged=false,revision=revision+1,updated_at=clock_timestamp() where organization_id=$1",[ids.organization]));
      assert.deepEqual(await lookup(),[android.identity]);
      const other = await seed(pool);
      const otherOperator = {kind:"operator",organizationId:other.organization,userId:other.operator};
      const otherTopology = {...providerTopology(other.organization),accountSidDigest:digest(randomUUID())};
      await topologyRepository.attestTopology(otherOperator,{...otherTopology,commandId:`route-other-topology-${randomUUID()}`,
        requestDigest:digest(randomUUID()),providerReadbackDigest:digest("synthetic-other"),topologyEvidenceDigest:digest("synthetic-other"),recordedAt:new Date().toISOString()});
      const number = digest(randomUUID());
      const otherBinding = await bindings.provisionBinding(otherOperator,{commandId:`route-other-binding-${randomUUID()}`,requestDigest:digest(randomUUID()),
        organizationId:other.organization,projectId:other.project,numberLookupDigest:number,numberLookupCandidateDigests:[number],
        lookupKeyVersion:"native-route-v1",phoneNumberSidDigest:digest(randomUUID()),accountSidDigest:otherTopology.accountSidDigest,
        messagingServiceSidDigest:null,providerReadbackDigest:digest("synthetic-other"),provisionEvidenceDigest:digest("synthetic-other"),recordedAt:new Date().toISOString()});
      assert.deepEqual(await routes.resolveIdentities({numberBindingId:otherBinding.id}),[]);
      assert.deepEqual(await lookup(),[android.identity]);
      await bindings.retireBinding(operator,{commandId:`route-retire-${randomUUID()}`,requestDigest:digest(randomUUID()),organizationId:ids.organization,
        bindingId:binding.id,retiredReason:"operator_correction",retireEvidenceDigest:digest("retire"),recordedAt:new Date().toISOString()});
      assert.deepEqual(await lookup(),[]);
      await topologyRepository.retireTopology(operator,{organizationId:ids.organization,topologyId:topologyReceipt.id,
        reason:"operator_correction",retireEvidenceDigest:digest("topology-retire"),recordedAt:new Date().toISOString()});
      assert.deepEqual(await lookup(),[]);
    });
  } finally { await pool.end(); }
});

test("Android-only topology routes through native Dial and cached sessions cannot outlive slot authority", { skip: !DATABASE_URL }, async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  try {
    assert.match((await pool.query("select current_database() as name")).rows[0].name,
      /^ss_native_voice_routing_(?:[0-9]+|ci_[0-9]+_[0-9]+)$/u);
    const ids = await seed(pool), authority = createCanonicalPostgresAuthority({ pool });
    const sid = prefix => `${prefix}${randomUUID().replaceAll("-", "")}`;
    const configuration = {
      organizationId: ids.organization, accountSid: sid("AC"), messagingApiKeySid: sid("SK"),
      messagingApiKeySecret: randomUUID(), webhookAuthToken: randomUUID(), messagingServiceSid: sid("MG"),
      customerProfileSid: sid("BU"), brandRegistrationSid: sid("BN"), campaignSid: sid("QE"),
      registrationClass: "LOW_VOLUME_STANDARD", campaignUseCase: "CUSTOMER_CARE",
      voiceApiKeySid: sid("SK"), voiceApiKeySecret: randomUUID(), enabledPushSlots: ["android.sandbox"],
      voiceAndroidSandboxPushCredentialSid: sid("CR")
    };
    let registry = createTwilioIsvProviderRegistry({ schema: "sitesourcery.twilio-isv-provider-registry/v2", entries: [configuration] });
    const providerRegistry = { kind: "twilio-isv-provider-registry", providerEffects: false,
      readiness: () => registry.readiness(), resolveOrganization: id => registry.resolveOrganization(id) };
    const operator = { kind: "operator", organizationId: ids.organization, userId: ids.operator };
    const customer = { kind: "customer", organizationId: ids.organization, userId: ids.customer };
    const topologyRepository = createPostgresResponderTwilioProviderTopologyRepository({ authority });
    const attest = () => topologyRepository.attestTopology(operator, {
      ...registry.resolveOrganization(ids.organization).topology, commandId: `slot-topology-${randomUUID()}`,
      requestDigest: digest(randomUUID()), providerReadbackDigest: digest("synthetic-slot-readback"),
      topologyEvidenceDigest: digest("synthetic-slot-evidence"), recordedAt: new Date().toISOString()
    });
    const topology = await attest();
    // Readiness also covers retained keys from the CI migration journey and the preceding routing fixture.
    const previousPeppers = { "native-pg-v1": Buffer.alloc(32, 19), "native-route-v1": Buffer.alloc(32, 29) };
    const tokenAuthority = createResponderNativeTokenAuthority({ pepper: Buffer.alloc(32, 27), pepperVersion: "slot-v1", previousPeppers });
    const voiceAccess = createTwilioResponderVoiceAccess({ pepper: Buffer.alloc(32, 27), pepperVersion: "slot-v1", previousPeppers,
      environment: { SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "verified" }, providerRegistry, providerTopologyRepository: topologyRepository });
    const native = createPostgresResponderNativeClientRepository({ authority, verifierKeyVersions: tokenAuthority.verifierVersions, voiceAccess });
    const created = await native.createInstallation(customer, { commandId: `slot-create-${randomUUID()}`, installationId: randomUUID(),
      organizationId: ids.organization, projectId: ids.project, platform: "android", bundleId: "com.sitesourcery.responder.debug",
      appEnvironment: "sandbox", appVersion: "1.0.0", buildNumber: "1", installationKeyDigest: digest(randomUUID()), recordedAt: new Date().toISOString() });
    const scope = { id: created.installation.id, organizationId: ids.organization, projectId: ids.project, userId: ids.customer,
      platform: "android", bundleId: "com.sitesourcery.responder.debug", environment: "sandbox" };
    const token = `fcm:synthetic_${randomUUID()}_1234567890`, candidates = tokenAuthority.tokenLookupCandidates(scope, "voip", token);
    const registered = await native.registerToken(customer, { commandId: `slot-token-${randomUUID()}`, registrationId: randomUUID(),
      organizationId: ids.organization, projectId: ids.project, installationId: scope.id, expectedRevision: created.installation.revision,
      pushPurpose: "voip", tokenLookupCandidateDigests: candidates.map(value => value.digest),
      tokenOwnershipCandidateDigests: candidates.map(value => value.ownershipDigest),
      envelope: await tokenAuthority.sealToken(scope, "voip", token), recordedAt: new Date().toISOString() });
    const issueInput = { commandId: `slot-session-${randomUUID()}`, sessionId: randomUUID(), organizationId: ids.organization,
      projectId: ids.project, installationId: scope.id, expectedRevision: registered.installation.revision };
    const issued = await native.issueVoipSession(customer, issueInput);
    assert.equal((await native.issueVoipSession(customer, issueInput)).replayed, true);
    const semanticInput = { ...issueInput, commandId: `slot-semantic-${randomUUID()}`, sessionId: randomUUID() };
    assert.equal((await native.issueVoipSession(customer, semanticInput)).semanticReplay, true);
    const bindings = createPostgresResponderNumberBindingsRepository({ authority, verifierKeyVersions: ["slot-v1"] });
    const number = digest(randomUUID());
    const binding = await bindings.provisionBinding(operator, { commandId: `slot-number-${randomUUID()}`, requestDigest: digest(randomUUID()),
      organizationId: ids.organization, projectId: ids.project, numberLookupDigest: number, numberLookupCandidateDigests: [number],
      lookupKeyVersion: "slot-v1", phoneNumberSidDigest: digest(randomUUID()), accountSidDigest: topology.accountSidDigest,
      messagingServiceSidDigest: null, providerReadbackDigest: digest("synthetic"), provisionEvidenceDigest: digest("synthetic"), recordedAt: new Date().toISOString() });
    await authority.service({ actorKind: "system", organizationId: ids.organization }, client => client.query(
      "insert into ss.responder_runtime_controls(organization_id,created_at,updated_at) values($1,clock_timestamp(),clock_timestamp())", [ids.organization]));
    await authority.service({ actorKind: "operator", userId: ids.operator, organizationId: ids.organization }, client => client.query(
      `update ss.responder_runtime_controls set state='approved_live',global_kill_engaged=false,revision=revision+1,
        release_evidence_digest=$2,released_at=clock_timestamp(),released_by_operator_user_id=$3,updated_at=clock_timestamp() where organization_id=$1`,
      [ids.organization,digest("synthetic-release"),ids.operator]));
    const routes = createPostgresResponderNativeVoiceRoutes({ authority, nativeClientRepository: native, voiceAccess });
    const routing = createResponderNativeVoiceRouting({ mode: "verified", routes, voiceAccess });
    assert.equal((await routing.readiness()).legacyRoutingReady, false);
    assert.equal((await routing.readiness()).anyRoutingReady, true);
    const plan = createTwilioResponderNativeVoiceDialPlan({ routing, dialResultUrl: "https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result" });
    const inbound = { channel: "voice", eventKind: "call_received", eventState: "recorded", numberBindingId: binding.id };
    assert.ok((await plan.twiml(inbound)).includes(`<Client>ssr_${issued.identityDigest.slice(0,48)}</Client>`));
    await bindings.retireBinding(operator, { commandId: `slot-retire-number-${randomUUID()}`, requestDigest: digest(randomUUID()),
      organizationId: ids.organization, bindingId: binding.id, retiredReason: "operator_correction",
      retireEvidenceDigest: digest("synthetic-retire"), recordedAt: new Date().toISOString() });
    await topologyRepository.retireTopology(operator, { organizationId: ids.organization, topologyId: topology.id,
      reason: "operator_correction", retireEvidenceDigest: digest("synthetic-retire"), recordedAt: new Date().toISOString() });
    await assert.rejects(native.issueVoipSession(customer, issueInput), { code: "RESPONDER_TWILIO_TOPOLOGY_NOT_ACTIVE" });
    await assert.rejects(native.issueVoipSession(customer, semanticInput), { code: "RESPONDER_TWILIO_TOPOLOGY_NOT_ACTIVE" });
    registry = createTwilioIsvProviderRegistry({ schema: "sitesourcery.twilio-isv-provider-registry/v2", entries: [{
      ...configuration, enabledPushSlots: ["ios.production"], voiceAndroidSandboxPushCredentialSid: null, voiceProductionPushCredentialSid: sid("CR")
    }] });
    await attest();
    await assert.rejects(native.issueVoipSession(customer, issueInput), { code: "RESPONDER_NATIVE_VOIP_HELD" });
    await assert.rejects(native.issueVoipSession(customer, semanticInput), { code: "RESPONDER_NATIVE_VOIP_HELD" });
    assert.equal(await plan.twiml(inbound), TWILIO_RESPONDER_HELD_VOICE_TWIML);
    // Customer cleanup is independent of the now-disabled routing slot.
    const retired = await native.revokeInstallation(customer, { commandId: `slot-device-retire-${randomUUID()}`, transitionId: randomUUID(),
      organizationId: ids.organization, projectId: ids.project, installationId: scope.id, expectedRevision: registered.installation.revision,
      reason: "device_lost", evidenceDigest: digest("synthetic"), recordedAt: new Date().toISOString() });
    assert.equal(retired.installation.state, "revoked");
  } finally { await pool.end(); }
});
