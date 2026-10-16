import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync
} from "node:fs";
import path from "node:path";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const TWILIO_ISV_PROVIDER_REGISTRY_PATH_ENVIRONMENT =
  "SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH";

const REGISTRY_SCHEMA = "sitesourcery.twilio-isv-provider-registry/v1";
const SLOT_REGISTRY_SCHEMA = "sitesourcery.twilio-isv-provider-registry/v2";
export const TWILIO_PUSH_SLOTS = Object.freeze({
  "ios.sandbox": "voiceSandboxPushCredentialSid",
  "ios.production": "voiceProductionPushCredentialSid",
  "android.sandbox": "voiceAndroidSandboxPushCredentialSid",
  "android.production": "voiceAndroidProductionPushCredentialSid"
});
const PUSH_FIELDS = Object.freeze(Object.values(TWILIO_PUSH_SLOTS));

// A disabled slot is explicit absence, never a synthetic credential digest.
export function twilioPushSlotMap(predicate) {
  return deepFreeze(Object.fromEntries(["ios", "android"].map((platform) => [
    platform, Object.fromEntries(["sandbox", "production"].map((environment) => [
      environment, predicate(`${platform}.${environment}`) === true
    ]))
  ])));
}

export function normalizeTwilioPushSlots(value) {
  const slots = value.enabledPushSlots;
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 4 ||
      slots.some((slot) => typeof slot !== "string" || !Object.hasOwn(TWILIO_PUSH_SLOTS, slot)) ||
      new Set(slots).size !== slots.length ||
      canonicalJson(slots) !== canonicalJson([...slots].sort())) {
    throw configuration("Enabled Voice push slots must be a sorted, nonempty exact slot list.");
  }
  const normalized = {};
  for (const [slot, field] of Object.entries(TWILIO_PUSH_SLOTS)) {
    if (slots.includes(slot)) normalized[field] = sid(value[field], SID.pushCredential, `The ${field}`);
    else {
      if (value[field] !== null && value[field] !== undefined) {
        throw configuration("A disabled Voice push slot cannot contain a credential.");
      }
      normalized[field] = null;
    }
  }
  const configured = Object.values(normalized).filter((value) => value !== null);
  if (new Set(configured).size !== configured.length) {
    throw configuration("Voice Push Credentials must be platform-separated.");
  }
  return { ...normalized, enabledPushSlots: [...slots] };
}
const MAXIMUM_REGISTRY_BYTES = 256 * 1024;
const ALLOWED_REGISTRY_MODES = new Set([0o400, 0o440, 0o600, 0o640]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SID = Object.freeze({
  account: /^AC[0-9a-fA-F]{32}$/u,
  apiKey: /^SK[0-9a-fA-F]{32}$/u,
  messagingService: /^MG[0-9a-fA-F]{32}$/u,
  customerProfile: /^BU[0-9a-fA-F]{32}$/u,
  brand: /^BN[0-9a-fA-F]{32}$/u,
  campaign: /^QE[0-9a-fA-F]{32}$/u,
  pushCredential: /^CR[0-9a-fA-F]{32}$/u
});
const REGISTRATION_CLASSES = new Set([
  "STANDARD", "LOW_VOLUME_STANDARD", "SOLE_PROPRIETOR"
]);
const CAMPAIGN_USE_CASES = new Set(["CUSTOMER_CARE"]);
const ENTRY_FIELDS = Object.freeze([
  "organizationId",
  "accountSid",
  "messagingApiKeySid",
  "messagingApiKeySecret",
  "webhookAuthToken",
  "messagingServiceSid",
  "customerProfileSid",
  "brandRegistrationSid",
  "campaignSid",
  "registrationClass",
  "campaignUseCase",
  "voiceApiKeySid",
  "voiceApiKeySecret",
  "voiceSandboxPushCredentialSid",
  "voiceProductionPushCredentialSid",
  "voiceAndroidSandboxPushCredentialSid",
  "voiceAndroidProductionPushCredentialSid"
]);

function configuration(message) {
  return new HostedError(
    "TWILIO_ISV_PROVIDER_REGISTRY_CONFIGURATION_REQUIRED",
    message,
    { status: 500, details: { providerEffects: false } }
  );
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function secret(value, field) {
  if (
    typeof value !== "string" || value.length < 24 || value.length > 512 ||
    /[^\x21-\x7e]/u.test(value)
  ) throw configuration(`${field} is invalid.`);
  return value;
}

function sid(value, pattern, field) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw configuration(`${field} is invalid.`);
  }
  return value;
}

function safeTopology(entry) {
  const providerBrandType = entry.registrationClass === "SOLE_PROPRIETOR"
    ? "SOLE_PROPRIETOR"
    : "STANDARD";
  return deepFreeze({
    schema: entry.enabledPushSlots
      ? "sitesourcery.twilio-isv-provider-topology/v2"
      : "sitesourcery.twilio-isv-provider-topology/v1",
    ...(entry.enabledPushSlots ? { enabledPushSlots: entry.enabledPushSlots } : {}),
    provider: "twilio",
    organizationId: entry.organizationId,
    registrationClass: entry.registrationClass,
    providerBrandType,
    campaignUseCase: entry.campaignUseCase,
    accountSidDigest: digest(entry.accountSid),
    messagingServiceSidDigest: digest(entry.messagingServiceSid),
    customerProfileSidDigest: digest(entry.customerProfileSid),
    brandRegistrationSidDigest: digest(entry.brandRegistrationSid),
    campaignSidDigest: digest(entry.campaignSid),
    messagingApiKeySidDigest: digest(entry.messagingApiKeySid),
    messagingApiKeySecretDigest: digest(entry.messagingApiKeySecret),
    webhookAuthTokenDigest: digest(entry.webhookAuthToken),
    voiceApiKeySidDigest: digest(entry.voiceApiKeySid),
    voiceApiKeySecretDigest: digest(entry.voiceApiKeySecret),
    voiceSandboxPushCredentialSidDigest:
      entry.voiceSandboxPushCredentialSid === null ? null : digest(entry.voiceSandboxPushCredentialSid),
    voiceProductionPushCredentialSidDigest:
      entry.voiceProductionPushCredentialSid === null ? null : digest(entry.voiceProductionPushCredentialSid),
    voiceAndroidSandboxPushCredentialSidDigest:
      entry.voiceAndroidSandboxPushCredentialSid === null ? null : digest(entry.voiceAndroidSandboxPushCredentialSid),
    voiceAndroidProductionPushCredentialSidDigest:
      entry.voiceAndroidProductionPushCredentialSid === null ? null : digest(entry.voiceAndroidProductionPushCredentialSid)
  });
}

function providerRecord(entry) {
  const topology = safeTopology(entry);
  const record = {
    schema: "sitesourcery.twilio-isv-provider-authority/v1",
    provider: "twilio",
    organizationId: entry.organizationId,
    topology
  };
  Object.defineProperties(record, {
    accountSid: { value: entry.accountSid },
    messagingApiKeySid: { value: entry.messagingApiKeySid },
    messagingApiKeySecret: { value: entry.messagingApiKeySecret },
    webhookAuthToken: { value: entry.webhookAuthToken },
    messagingServiceSid: { value: entry.messagingServiceSid },
    customerProfileSid: { value: entry.customerProfileSid },
    brandRegistrationSid: { value: entry.brandRegistrationSid },
    campaignSid: { value: entry.campaignSid },
    providerBrandType: { value: topology.providerBrandType },
    campaignUseCase: { value: entry.campaignUseCase },
    voiceApiKeySid: { value: entry.voiceApiKeySid },
    voiceApiKeySecret: { value: entry.voiceApiKeySecret },
    voiceSandboxPushCredentialSid: {
      value: entry.voiceSandboxPushCredentialSid
    },
    voiceProductionPushCredentialSid: {
      value: entry.voiceProductionPushCredentialSid
    },
    voiceAndroidSandboxPushCredentialSid: {
      value: entry.voiceAndroidSandboxPushCredentialSid
    },
    voiceAndroidProductionPushCredentialSid: {
      value: entry.voiceAndroidProductionPushCredentialSid
    }
  });
  return Object.freeze(record);
}

function selectedEntry(value, slotAware = false) {
  const normalized = slotAware && value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
    ? { ...value, ...normalizeTwilioPushSlots(value) }
    : value;
  if (!exactKeys(normalized, slotAware ? [...ENTRY_FIELDS, "enabledPushSlots"] : ENTRY_FIELDS)) {
    throw configuration("A Twilio ISV provider entry has an invalid shape.");
  }
  value = normalized;
  if (!UUID.test(value.organizationId ?? "")) {
    throw configuration("A Twilio ISV organization ID is invalid.");
  }
  sid(value.accountSid, SID.account, "The Twilio subaccount SID");
  sid(value.messagingApiKeySid, SID.apiKey, "The Messaging API key SID");
  secret(value.messagingApiKeySecret, "The Messaging API key secret");
  secret(value.webhookAuthToken, "The webhook Auth Token");
  sid(
    value.messagingServiceSid,
    SID.messagingService,
    "The Messaging Service SID"
  );
  sid(
    value.customerProfileSid,
    SID.customerProfile,
    "The Secondary Customer Profile SID"
  );
  sid(value.brandRegistrationSid, SID.brand, "The Brand registration SID");
  sid(value.campaignSid, SID.campaign, "The Campaign SID");
  if (!REGISTRATION_CLASSES.has(value.registrationClass)) {
    throw configuration("The Twilio registration class is invalid.");
  }
  if (!CAMPAIGN_USE_CASES.has(value.campaignUseCase)) {
    throw configuration("The Twilio Campaign use case is invalid.");
  }
  sid(value.voiceApiKeySid, SID.apiKey, "The Voice API key SID");
  secret(value.voiceApiKeySecret, "The Voice API key secret");
  for (const field of [
    "voiceSandboxPushCredentialSid",
    "voiceProductionPushCredentialSid",
    "voiceAndroidSandboxPushCredentialSid",
    "voiceAndroidProductionPushCredentialSid"
  ]) if (!slotAware || value[field] !== null) sid(value[field], SID.pushCredential, `The ${field}`);
  if (value.messagingApiKeySid === value.voiceApiKeySid) {
    throw configuration("Messaging and Voice API keys must be purpose-separated.");
  }
  if (value.messagingApiKeySecret === value.voiceApiKeySecret) {
    throw configuration("Messaging and Voice API secrets must be purpose-separated.");
  }
  if (new Set([
    value.voiceSandboxPushCredentialSid,
    value.voiceProductionPushCredentialSid,
    value.voiceAndroidSandboxPushCredentialSid,
    value.voiceAndroidProductionPushCredentialSid
  ].filter((value) => value !== null)).size !== (slotAware ? value.enabledPushSlots.length : 4)) {
    throw configuration("Voice Push Credentials must be platform-separated.");
  }
  return value;
}

function assertUnique(entries, field, message) {
  const resources = entries.map((entry) => entry[field]).filter((value) => value !== null);
  if (new Set(resources).size !== resources.length) {
    throw configuration(message);
  }
}

function assertResourceFamilyUnique(entries, fields, message) {
  const resources = entries.flatMap((entry) =>
    fields.map((field) => entry[field])
  ).filter((value) => value !== null);
  if (new Set(resources).size !== resources.length) {
    throw configuration(message);
  }
}

export function createTwilioIsvProviderRegistry(document) {
  if (!exactKeys(document, ["schema", "entries"]) ||
      ![REGISTRY_SCHEMA, SLOT_REGISTRY_SCHEMA].includes(document.schema) ||
      !Array.isArray(document.entries) || document.entries.length < 1 ||
      document.entries.length > 1_000) {
    throw configuration("The Twilio ISV provider registry is invalid.");
  }
  const entries = document.entries.map((entry) => selectedEntry(entry, document.schema === SLOT_REGISTRY_SCHEMA));
  if (canonicalJson(entries.map((entry) => entry.organizationId)) !==
      canonicalJson(entries.map((entry) => entry.organizationId).sort())) {
    throw configuration("Twilio ISV provider entries must be organization-sorted.");
  }
  for (const [field, message] of [
    ["organizationId", "A customer organization appears more than once."],
    ["accountSid", "A Twilio subaccount is assigned more than once."],
    ["messagingServiceSid", "A Messaging Service is assigned more than once."],
    ["customerProfileSid", "A Secondary Customer Profile is assigned more than once."],
    ["brandRegistrationSid", "A Brand is assigned more than once."],
    ["campaignSid", "A Campaign is assigned more than once."],
    ["messagingApiKeySid", "A Messaging API key is assigned more than once."],
    ["messagingApiKeySecret", "A Messaging API secret is assigned more than once."],
    ["webhookAuthToken", "A webhook Auth Token is assigned more than once."],
    ["voiceApiKeySid", "A Voice API key is assigned more than once."],
    ["voiceApiKeySecret", "A Voice API secret is assigned more than once."],
    ["voiceSandboxPushCredentialSid", "An iOS sandbox Push Credential is assigned more than once."],
    ["voiceProductionPushCredentialSid", "An iOS production Push Credential is assigned more than once."],
    ["voiceAndroidSandboxPushCredentialSid", "An Android sandbox Push Credential is assigned more than once."],
    ["voiceAndroidProductionPushCredentialSid", "An Android production Push Credential is assigned more than once."]
  ]) assertUnique(entries, field, message);
  assertResourceFamilyUnique(
    entries,
    ["messagingApiKeySid", "voiceApiKeySid"],
    "A Twilio API key is shared across customers or purposes."
  );
  assertResourceFamilyUnique(
    entries,
    ["messagingApiKeySecret", "webhookAuthToken", "voiceApiKeySecret"],
    "A Twilio secret is shared across customers or purposes."
  );
  assertResourceFamilyUnique(
    entries,
    [
      "voiceSandboxPushCredentialSid",
      "voiceProductionPushCredentialSid",
      "voiceAndroidSandboxPushCredentialSid",
      "voiceAndroidProductionPushCredentialSid"
    ],
    "A Voice Push Credential is shared across customers or platforms."
  );
  const records = entries.map(providerRecord);
  const byOrganization = new Map(records.map((entry) => [
    entry.organizationId, entry
  ]));
  const byAccount = new Map(records.map((entry) => [entry.accountSid, entry]));
  const registryDigest = digest({
    schema: document.schema,
    entries: records.map((entry) => entry.topology)
  });

  return Object.freeze({
    kind: "twilio-isv-provider-registry",
    schema: document.schema,
    providerEffects: false,
    customerCount: records.length,
    registryDigest,
    organizationIds: deepFreeze(records.map((entry) => entry.organizationId)),
    resolveOrganization(organizationId) {
      if (typeof organizationId !== "string" || !UUID.test(organizationId)) {
        throw configuration("The Twilio provider organization is invalid.");
      }
      const selected = byOrganization.get(organizationId);
      if (!selected) {
        throw new HostedError(
          "TWILIO_ISV_CUSTOMER_PROVIDER_NOT_CONFIGURED",
          "The customer Twilio provider authority is not configured.",
          { status: 503, details: { providerEffects: false } }
        );
      }
      return selected;
    },
    resolveAccountSid(accountSid) {
      if (typeof accountSid !== "string" || !SID.account.test(accountSid)) {
        throw configuration("The callback Twilio account is invalid.");
      }
      const selected = byAccount.get(accountSid);
      if (!selected) {
        throw new HostedError(
          "TWILIO_ISV_CALLBACK_ACCOUNT_NOT_CONFIGURED",
          "The callback Twilio account is not configured.",
          { status: 400, details: { providerEffects: false } }
        );
      }
      return selected;
    },
    readiness() {
      return deepFreeze({
        ready: true,
        verified: true,
        kind: "twilio-isv-provider-registry",
        schema: document.schema,
        providerEffects: false,
        // Global feature support is a union, never tenant authorization.
        pushSlots: twilioPushSlotMap((slot) => records.some((entry) =>
          entry[TWILIO_PUSH_SLOTS[slot]] !== null)),
        hasConfiguredPushSlot: true,
        legacyRoutingCompatible: records.every((entry) => PUSH_FIELDS.every((field) => entry[field] !== null)),
        customerCount: records.length,
        registryDigest
      });
    }
  });
}

export function assertTwilioIsvProviderRegistryNotStaged(
  environment = process.env
) {
  invariant(
    environment?.[TWILIO_ISV_PROVIDER_REGISTRY_PATH_ENVIRONMENT] === undefined ||
      environment[TWILIO_ISV_PROVIDER_REGISTRY_PATH_ENVIRONMENT] === "",
    "TWILIO_ISV_PROVIDER_REGISTRY_CONFIGURATION_REQUIRED",
    "The Twilio customer provider registry cannot be staged while held.",
    { status: 500, details: { providerEffects: false } }
  );
  return true;
}

export function twilioIsvProviderRegistryFromEnvironment(
  environment = process.env,
  {
    open = openSync,
    fstat = fstatSync,
    readFile = readFileSync,
    close = closeSync
  } = {}
) {
  const selectedPath =
    environment?.[TWILIO_ISV_PROVIDER_REGISTRY_PATH_ENVIRONMENT];
  if (typeof selectedPath !== "string" || selectedPath.length < 1 ||
      selectedPath.length > 4_096 || /[\r\n]/u.test(selectedPath) ||
      !path.isAbsolute(selectedPath) || path.normalize(selectedPath) !== selectedPath) {
    throw configuration(
      `${TWILIO_ISV_PROVIDER_REGISTRY_PATH_ENVIRONMENT} is invalid.`
    );
  }
  let descriptor = null;
  let metadata;
  let bytes;
  try {
    descriptor = open(
      selectedPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    metadata = fstat(descriptor);
    if (!metadata.isFile() || metadata.size < 1 ||
        metadata.size > MAXIMUM_REGISTRY_BYTES || metadata.uid !== 0 ||
        metadata.nlink !== 1 ||
        !ALLOWED_REGISTRY_MODES.has(metadata.mode & 0o777)) {
      throw new Error("unsafe registry metadata");
    }
    bytes = readFile(descriptor);
  } catch {
    throw configuration("The Twilio customer provider registry is unavailable.");
  } finally {
    if (descriptor !== null) {
      try { close(descriptor); } catch { /* fail below on missing bytes */ }
    }
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== metadata.size ||
      bytes.length > MAXIMUM_REGISTRY_BYTES) {
    throw configuration("The Twilio customer provider registry is unstable.");
  }
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw configuration("The Twilio customer provider registry is not JSON.");
  }
  return createTwilioIsvProviderRegistry(document);
}
