import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTwilioIsvProviderRegistryNotStaged,
  createTwilioIsvProviderRegistry,
  twilioIsvProviderRegistryFromEnvironment
} from "../responder-twilio-provider-registry.mjs";

const ids = Object.freeze({
  organization: "00000000-0000-4000-8000-000000000001",
  secondOrganization: "00000000-0000-4000-8000-000000000002"
});
const sid = (prefix, character) => `${prefix}${character.repeat(32)}`;

function entry(overrides = {}) {
  return {
    organizationId: ids.organization,
    accountSid: sid("AC", "1"),
    messagingApiKeySid: sid("SK", "2"),
    messagingApiKeySecret: "m".repeat(32),
    webhookAuthToken: "w".repeat(32),
    messagingServiceSid: sid("MG", "3"),
    customerProfileSid: sid("BU", "4"),
    brandRegistrationSid: sid("BN", "5"),
    campaignSid: sid("QE", "6"),
    registrationClass: "LOW_VOLUME_STANDARD",
    campaignUseCase: "CUSTOMER_CARE",
    voiceApiKeySid: sid("SK", "7"),
    voiceApiKeySecret: "v".repeat(32),
    voiceSandboxPushCredentialSid: sid("CR", "8"),
    voiceProductionPushCredentialSid: sid("CR", "9"),
    voiceAndroidSandboxPushCredentialSid: sid("CR", "a"),
    voiceAndroidProductionPushCredentialSid: sid("CR", "b"),
    ...overrides
  };
}

function document(entries = [entry()]) {
  return {
    schema: "sitesourcery.twilio-isv-provider-registry/v1",
    entries
  };
}

test("registry resolves isolated customer authority without JSON secret exposure", () => {
  const registry = createTwilioIsvProviderRegistry(document());
  assert.equal(registry.registryDigest, "30813259ade5dac5de9eaeaa166b474ac406cacfe01fa3dfab3dbbabd9ed63d4");
  const provider = registry.resolveOrganization(ids.organization);
  assert.equal(provider.accountSid, sid("AC", "1"));
  assert.equal(provider.messagingApiKeySecret, "m".repeat(32));
  assert.equal(provider.providerBrandType, "STANDARD");
  assert.equal(provider.topology.registrationClass, "LOW_VOLUME_STANDARD");
  assert.equal(JSON.stringify(provider).includes("m".repeat(32)), false);
  assert.equal(JSON.stringify(provider).includes(sid("AC", "1")), false);
  assert.equal(registry.resolveAccountSid(sid("AC", "1")), provider);
  assert.deepEqual(registry.readiness(), {
    ready: true,
    verified: true,
    kind: "twilio-isv-provider-registry",
    schema: "sitesourcery.twilio-isv-provider-registry/v1",
    providerEffects: false,
    pushSlots: { ios: { sandbox: true, production: true }, android: { sandbox: true, production: true } },
    hasConfiguredPushSlot: true,
    legacyRoutingCompatible: true,
    customerCount: 1,
    registryDigest: registry.registryDigest
  });
});

test("registry rejects shared customer resources and unsorted customers", () => {
  const second = entry({ organizationId: ids.secondOrganization });
  assert.throws(
    () => createTwilioIsvProviderRegistry(document([entry(), second])),
    /subaccount is assigned more than once/u
  );
  assert.throws(
    () => createTwilioIsvProviderRegistry(document([
      entry({
        organizationId: ids.secondOrganization,
        accountSid: sid("AC", "c"),
        messagingApiKeySid: sid("SK", "d"),
        messagingServiceSid: sid("MG", "e"),
        customerProfileSid: sid("BU", "f"),
        brandRegistrationSid: sid("BN", "a"),
        campaignSid: sid("QE", "b"),
        voiceApiKeySid: sid("SK", "c")
      }),
      entry()
    ])),
    /organization-sorted/u
  );
});

test("registry rejects global-purpose reuse and held secret staging", () => {
  assert.throws(
    () => createTwilioIsvProviderRegistry(document([
      entry({ voiceApiKeySid: sid("SK", "2") })
    ])),
    /purpose-separated/u
  );
  assert.equal(assertTwilioIsvProviderRegistryNotStaged({}), true);
  assert.throws(
    () => assertTwilioIsvProviderRegistryNotStaged({
      SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH: "/run/private.json"
    }),
    /cannot be staged while held/u
  );
});

test("registry rejects cross-customer cross-purpose authority reuse", () => {
  const second = entry({
    organizationId: ids.secondOrganization,
    accountSid: sid("AC", "c"),
    messagingApiKeySid: sid("SK", "d"),
    messagingApiKeySecret: "x".repeat(32),
    webhookAuthToken: "y".repeat(32),
    messagingServiceSid: sid("MG", "e"),
    customerProfileSid: sid("BU", "f"),
    brandRegistrationSid: sid("BN", "c"),
    campaignSid: sid("QE", "d"),
    voiceApiKeySid: sid("SK", "e"),
    voiceApiKeySecret: "z".repeat(32),
    voiceSandboxPushCredentialSid: sid("CR", "c"),
    voiceProductionPushCredentialSid: sid("CR", "d"),
    voiceAndroidSandboxPushCredentialSid: sid("CR", "e"),
    voiceAndroidProductionPushCredentialSid: sid("CR", "f")
  });
  for (const [overrides, pattern] of [
    [{ voiceApiKeySid: sid("SK", "2") }, /API key is shared/u],
    [{ voiceApiKeySecret: "m".repeat(32) }, /secret is shared/u],
    [{ voiceProductionPushCredentialSid: sid("CR", "8") },
      /Push Credential is shared/u]
  ]) {
    assert.throws(
      () => createTwilioIsvProviderRegistry(document([
        entry(), { ...second, ...overrides }
      ])),
      pattern
    );
  }
});

test("environment loader requires an absolute stable non-world-readable file", () => {
  const bytes = Buffer.from(JSON.stringify(document()), "utf8");
  const environment = {
    SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH: "/run/ss/twilio.json"
  };
  const registry = twilioIsvProviderRegistryFromEnvironment(environment, {
    open: () => 42,
    fstat: () => ({
      isFile: () => true,
      size: bytes.length,
      mode: 0o100440,
      uid: 0,
      nlink: 1
    }),
    readFile: (descriptor) => {
      assert.equal(descriptor, 42);
      return bytes;
    },
    close: (descriptor) => assert.equal(descriptor, 42)
  });
  assert.equal(registry.customerCount, 1);
  assert.throws(
    () => twilioIsvProviderRegistryFromEnvironment(environment, {
      open: () => 43,
      fstat: () => ({
        isFile: () => true,
        size: bytes.length,
        mode: 0o100444,
        uid: 0,
        nlink: 1
      }),
      readFile: () => bytes,
      close: () => {}
    }),
    /unavailable/u
  );
});

test("environment loader rejects non-root ownership and hard links", () => {
  const bytes = Buffer.from(JSON.stringify(document()), "utf8");
  const environment = {
    SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH: "/run/ss/twilio.json"
  };
  for (const metadata of [
    { uid: 501, nlink: 1 },
    { uid: 0, nlink: 2 }
  ]) {
    assert.throws(
      () => twilioIsvProviderRegistryFromEnvironment(environment, {
        open: () => 44,
        fstat: () => ({
          isFile: () => true,
          size: bytes.length,
          mode: 0o100440,
          ...metadata
        }),
        readFile: () => bytes,
        close: () => {}
      }),
      /unavailable/u
    );
  }
});

function slotDocument(entries) {
  return { schema: "sitesourcery.twilio-isv-provider-registry/v2", entries };
}
function androidOnly(overrides = {}) {
  const selected = entry({ enabledPushSlots: ["android.sandbox"], ...overrides });
  delete selected.voiceSandboxPushCredentialSid;
  delete selected.voiceProductionPushCredentialSid;
  delete selected.voiceAndroidProductionPushCredentialSid;
  return selected;
}

test("v2 permits only explicitly configured slots and never weakens v1", () => {
  const selected = androidOnly();
  const registry = createTwilioIsvProviderRegistry(slotDocument([selected]));
  const provider = registry.resolveOrganization(ids.organization);
  assert.equal(provider.voiceSandboxPushCredentialSid, null);
  assert.equal(provider.topology.voiceSandboxPushCredentialSidDigest, null);
  assert.equal(provider.topology.voiceAndroidProductionPushCredentialSidDigest, null);
  assert.deepEqual(provider.topology.enabledPushSlots, ["android.sandbox"]);
  assert.deepEqual(registry.readiness().pushSlots, {
    ios: { sandbox: false, production: false }, android: { sandbox: true, production: false }
  });
  assert.equal(registry.readiness().legacyRoutingCompatible, false);
  assert.throws(() => createTwilioIsvProviderRegistry(document([selected])));
  for (const delta of [
    { enabledPushSlots: [] }, { enabledPushSlots: ["android.unknown"] },
    { enabledPushSlots: ["android.sandbox", "android.sandbox"] },
    { enabledPushSlots: ["ios.sandbox", "android.sandbox"] },
    { voiceAndroidSandboxPushCredentialSid: null },
    { voiceAndroidSandboxPushCredentialSid: "not-a-credential" },
    { voiceSandboxPushCredentialSid: sid("CR", "8") },
    { enabledPushSlots: ["android.production", "android.sandbox"], voiceAndroidProductionPushCredentialSid: sid("CR", "a") }
  ]) assert.throws(() => createTwilioIsvProviderRegistry(slotDocument([{ ...selected, ...delta }])));
});

test("global slot support is the union of disjoint customer configurations, not tenant authority", () => {
  const first = androidOnly();
  const second = entry({ organizationId: ids.secondOrganization, accountSid: sid("AC", "c"),
    messagingApiKeySid: sid("SK", "d"), messagingApiKeySecret: "n".repeat(32), webhookAuthToken: "x".repeat(32),
    messagingServiceSid: sid("MG", "e"), customerProfileSid: sid("BU", "f"), brandRegistrationSid: sid("BN", "c"),
    campaignSid: sid("QE", "d"), voiceApiKeySid: sid("SK", "e"), voiceApiKeySecret: "y".repeat(32),
    enabledPushSlots: ["ios.production"], voiceSandboxPushCredentialSid: null,
    voiceProductionPushCredentialSid: sid("CR", "c"), voiceAndroidSandboxPushCredentialSid: null,
    voiceAndroidProductionPushCredentialSid: null });
  const registry = createTwilioIsvProviderRegistry(slotDocument([first, second]));
  assert.deepEqual(registry.readiness().pushSlots, {
    ios: { sandbox: false, production: true }, android: { sandbox: true, production: false }
  });
  assert.equal(registry.readiness().legacyRoutingCompatible, false);
  assert.equal(registry.resolveOrganization(ids.organization).voiceProductionPushCredentialSid, null);
  assert.equal(registry.resolveOrganization(ids.secondOrganization).voiceAndroidSandboxPushCredentialSid, null);
  assert.throws(() => createTwilioIsvProviderRegistry(slotDocument([
    first, { ...second, voiceProductionPushCredentialSid: first.voiceAndroidSandboxPushCredentialSid }
  ])), /shared across customers or platforms/u);
});


test("SMS-only v2 authority has explicit null Voice credentials and no native capability", () => {
  const sms = entry({ enabledPushSlots: [], voiceApiKeySid: null, voiceApiKeySecret: null,
    voiceSandboxPushCredentialSid: null, voiceProductionPushCredentialSid: null,
    voiceAndroidSandboxPushCredentialSid: null, voiceAndroidProductionPushCredentialSid: null });
  const registry = createTwilioIsvProviderRegistry(slotDocument([sms]));
  assert.equal(registry.readiness().ready, true);
  assert.equal(registry.readiness().hasConfiguredPushSlot, false);
  assert.equal(registry.readiness().legacyRoutingCompatible, false);
  assert.deepEqual(registry.readiness().pushSlots, {
    ios: { sandbox: false, production: false }, android: { sandbox: false, production: false }
  });
  const provider = registry.resolveOrganization(ids.organization);
  assert.equal(provider.voiceApiKeySid, null);
  assert.equal(provider.topology.voiceApiKeySidDigest, null);
  assert.equal(provider.topology.voiceApiKeySecretDigest, null);
  assert.deepEqual(provider.topology.enabledPushSlots, []);
  assert.throws(() => createTwilioIsvProviderRegistry(document([sms])));
  for (const delta of [
    { voiceApiKeySid: sid("SK", "7") }, { voiceApiKeySecret: "v".repeat(32) },
    { voiceApiKeySid: sid("SK", "7"), voiceApiKeySecret: "v".repeat(32) },
    { enabledPushSlots: ["android.sandbox"], voiceAndroidSandboxPushCredentialSid: sid("CR", "a") },
    { voiceApiKeySid: undefined }, { voiceSandboxPushCredentialSid: sid("CR", "a") },
    { messagingApiKeySid: null }, { messagingApiKeySecret: null }, { webhookAuthToken: null }
  ]) assert.throws(() => createTwilioIsvProviderRegistry(slotDocument([{ ...sms, ...delta }])));
  const other = entry({ organizationId: ids.secondOrganization, accountSid: sid("AC", "c"),
    messagingServiceSid: sid("MG", "c"), customerProfileSid: sid("BU", "c"),
    brandRegistrationSid: sid("BN", "c"), campaignSid: sid("QE", "c"),
    messagingApiKeySid: sid("SK", "c"), messagingApiKeySecret: "x".repeat(32),
    webhookAuthToken: "y".repeat(32), enabledPushSlots: ["android.production", "android.sandbox", "ios.production", "ios.sandbox"] });
  const mixed = createTwilioIsvProviderRegistry(slotDocument([sms, other]));
  assert.equal(mixed.readiness().hasConfiguredPushSlot, true);
  assert.deepEqual(mixed.resolveOrganization(ids.organization).topology.enabledPushSlots, []);
  assert.throws(() => createTwilioIsvProviderRegistry(slotDocument([sms,
    { ...other, messagingApiKeySid: sms.messagingApiKeySid }])));
});
