import { createHash } from "node:crypto";

export const CREDENTIAL_TOPOLOGY_SCHEMA =
  "sitesourcery.credential-topology/v1";
export const CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA =
  "sitesourcery.credential-topology-verification/v1";
export const CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/credential-topology-v1.json";

const MODE = "held";
const SHA256 = /^[a-f0-9]{64}$/u;
const STRIPE_ACCOUNT = /^acct_[A-Za-z0-9_]{1,250}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,200}$/u;
const STRIPE_RUNTIME_READBACK_MAXIMUM_AGE_MS =
  15 * 60 * 1000;
const STRIPE_ACTIVATION_RECEIPT_MAXIMUM_LIFETIME_MS =
  366 * 24 * 60 * 60 * 1000;
const STRIPE_PROVISIONER_MAXIMUM_LIFETIME_MS =
  24 * 60 * 60 * 1000;
const STRIPE_STANDARD_MAXIMUM_OVERLAP_MS =
  60 * 60 * 1000;
const STRIPE_REVOCATION_CONFIRMATION_MAXIMUM_MS =
  15 * 60 * 1000;
const STRIPE_PURPOSES = Object.freeze([
  "alakazam",
  "customBuildChange",
  "customBuildFinal",
  "customBuildStart",
  "download",
  "serviceAssessment"
]);
const STRIPE_COMMON_OPERATIONS = Object.freeze([
  "prices.retrieve",
  "webhookEndpoints.retrieve"
]);
const STRIPE_CHECKOUT_OPERATIONS = Object.freeze([
  "checkout.sessions.create",
  "checkout.sessions.retrieve"
]);
const STRIPE_REVERSAL_OPERATIONS = Object.freeze([
  "charges.retrieve",
  "disputes.list",
  "refunds.list"
]);
const STRIPE_OPERATIONS_BY_PURPOSE = deepFreeze({
  alakazam: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS,
    ...STRIPE_REVERSAL_OPERATIONS,
    "billingPortal.configurations.retrieve",
    "billingPortal.sessions.create",
    "coupons.retrieve",
    "customers.create",
    "customers.retrieve",
    "invoices.retrieve",
    "products.retrieve",
    "subscriptionSchedules.create",
    "subscriptionSchedules.retrieve",
    "subscriptionSchedules.update",
    "subscriptions.retrieve",
    "subscriptions.update"
  ]),
  customBuildChange: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS,
    ...STRIPE_REVERSAL_OPERATIONS
  ]),
  customBuildFinal: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS,
    ...STRIPE_REVERSAL_OPERATIONS
  ]),
  customBuildStart: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS,
    ...STRIPE_REVERSAL_OPERATIONS
  ]),
  download: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS
  ]),
  serviceAssessment: sortedUnique([
    ...STRIPE_COMMON_OPERATIONS,
    ...STRIPE_CHECKOUT_OPERATIONS,
    ...STRIPE_REVERSAL_OPERATIONS
  ])
});
const STRIPE_OPERATION_SCOPE = Object.freeze({
  "billingPortal.configurations.retrieve":
    "billing_portal_configurations:read",
  "billingPortal.sessions.create":
    "billing_portal_sessions:write",
  "charges.retrieve": "charges:read",
  "checkout.sessions.create": "checkout_sessions:write",
  "checkout.sessions.retrieve": "checkout_sessions:write",
  "coupons.retrieve": "coupons:read",
  "customers.create": "customers:write",
  "customers.retrieve": "customers:write",
  "disputes.list": "disputes:read",
  "invoices.retrieve": "invoices:read",
  "prices.retrieve": "prices:read",
  "products.retrieve": "products:read",
  "refunds.list": "refunds:read",
  "subscriptionSchedules.create":
    "subscription_schedules:write",
  "subscriptionSchedules.retrieve":
    "subscription_schedules:write",
  "subscriptionSchedules.update":
    "subscription_schedules:write",
  "subscriptions.retrieve": "subscriptions:write",
  "subscriptions.update": "subscriptions:write",
  "webhookEndpoints.retrieve": "webhook_endpoints:read"
});
const STRIPE_SCOPES_BY_PURPOSE = deepFreeze(
  Object.fromEntries(
    STRIPE_PURPOSES.map((purpose) => [
      purpose,
      sortedUnique(
        STRIPE_OPERATIONS_BY_PURPOSE[purpose].map(
          (operation) => STRIPE_OPERATION_SCOPE[operation]
        )
      )
    ])
  )
);
const STRIPE_ALL_RUNTIME_OPERATIONS = sortedUnique(
  Object.values(STRIPE_OPERATIONS_BY_PURPOSE).flat()
);
const STRIPE_ALL_RUNTIME_SCOPES = sortedUnique(
  STRIPE_ALL_RUNTIME_OPERATIONS.map(
    (operation) => STRIPE_OPERATION_SCOPE[operation]
  )
);
const STRIPE_PROVISIONER_OPERATIONS = sortedUnique([
  "billingPortal.configurations.create",
  "billingPortal.configurations.retrieve",
  "coupons.create",
  "coupons.retrieve",
  "prices.create",
  "prices.retrieve",
  "products.create",
  "products.retrieve",
  "tax.registrations.create",
  "tax.registrations.list",
  "tax.settings.retrieve",
  "tax.settings.update",
  "webhookEndpoints.create",
  "webhookEndpoints.retrieve",
  "webhookEndpoints.update"
]);
const STRIPE_PROVISIONER_SCOPES = sortedUnique([
  "billing_portal_configurations:write",
  "coupons:write",
  "prices:write",
  "products:write",
  "tax_registrations:write",
  "tax_settings:write",
  "webhook_endpoints:write"
]);
const ITEM_FIELDS = Object.freeze([
  "evidenceDigest",
  "kind",
  "lastProvenAt",
  "materialPresent",
  "name",
  "purpose",
  "providerBinding",
  "rotationState",
  "scopes",
  "storageBoundary"
]);

export const STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE =
  STRIPE_OPERATIONS_BY_PURPOSE;
export const STRIPE_RUNTIME_API_SCOPES_BY_PURPOSE =
  STRIPE_SCOPES_BY_PURPOSE;
export const STRIPE_RESTRICTED_KEY_CONTRACT = deepFreeze({
  effectsAllowed: false,
  allRuntimeOperations: STRIPE_ALL_RUNTIME_OPERATIONS,
  allRuntimeScopes: STRIPE_ALL_RUNTIME_SCOPES,
  runtimeOperationsByPurpose:
    STRIPE_OPERATIONS_BY_PURPOSE,
  runtimeScopesByPurpose: STRIPE_SCOPES_BY_PURPOSE,
  provisionerOperations: STRIPE_PROVISIONER_OPERATIONS,
  provisionerScopes: STRIPE_PROVISIONER_SCOPES,
  domainsHeld: true,
  forbiddenKeyClasses: [
    "standard",
    "full_access",
    "shared"
  ],
  maximumProvisionerLifetimeMs:
    STRIPE_PROVISIONER_MAXIMUM_LIFETIME_MS,
  maximumRuntimeReadbackAgeMs:
    STRIPE_RUNTIME_READBACK_MAXIMUM_AGE_MS,
  maximumStandardOverlapMs:
    STRIPE_STANDARD_MAXIMUM_OVERLAP_MS
});
const TOP_LEVEL_FIELDS = Object.freeze([
  "items",
  "mode",
  "schema"
]);
const STRIPE_ACTIVATION_RECEIPT_FIELDS = Object.freeze([
  "accountId",
  "activatedAt",
  "enabledPurposes",
  "environment",
  "livemode",
  "receiptDigest",
  "runtimeFingerprint",
  "runtimeOperationCount",
  "runtimeOperationDigest",
  "runtimeScopeCount",
  "runtimeScopeDigest",
  "runtimeVersion",
  "schema",
  "scopeEvidenceDigest",
  "scopeProvenAt",
  "state",
  "topologyDigest",
  "validUntil"
]);
export const STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_SCHEMA =
  "sitesourcery.stripe-credential-activation-receipt/v1";

const DEFINITIONS = Object.freeze([
  definition({
    name: "backup.age.ciphertext.primary",
    kind: "encrypted_backup_material",
    purpose: "backup_recovery_source",
    scopes: ["age:ciphertext"],
    storageBoundary: "zen-off-machine-ciphertext-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "backup.age.identity.recovery",
    kind: "backup_decryption_identity",
    purpose: "backup_restore_decryption",
    scopes: ["age:decrypt"],
    storageBoundary: "independent-off-zen-recovery-custody",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "cloudflare.tunnel.production.connector",
    kind: "provider_tunnel_credential",
    purpose: "cloudflare_tunnel_origin_authentication",
    scopes: ["tunnel:connect"],
    storageBoundary: "dell-cloudflare-tunnel-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "control.backup.identity-ciphertext.separation",
    kind: "separation_control",
    purpose: "backup_identity_ciphertext_separation",
    scopes: [
      "backup.age.ciphertext.primary",
      "backup.age.identity.recovery"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.identity.pepper.rotation",
    kind: "rotation_control",
    purpose: "identity_pepper_overlap_or_revocation",
    scopes: [
      "identity.pepper.production.current",
      "identity.pepper.production.prior"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.operator.recovery.dual-control",
    kind: "separation_control",
    purpose: "operator_recovery_dual_control",
    scopes: [
      "operator.recovery.approver",
      "operator.recovery.requester"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.resend.environment-separation",
    kind: "separation_control",
    purpose: "resend_production_staging_separation",
    scopes: [
      "resend.sender.production.restricted",
      "resend.sender.staging.restricted"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.responder.material.rotation",
    kind: "rotation_control",
    purpose: "responder_material_overlap_or_revocation",
    scopes: [
      "responder.material.production.current",
      "responder.material.production.prior"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.stripe.webhook.rotation",
    kind: "rotation_control",
    purpose: "stripe_webhook_overlap_or_revocation",
    scopes: [
      "stripe.webhook.production.current",
      "stripe.webhook.production.prior"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "control.twilio.customer-isolation",
    kind: "separation_control",
    purpose: "twilio_customer_subaccount_isolation",
    scopes: [
      "twilio.responder.production.api.restricted",
      "twilio.responder.production.webhook.signature"
    ],
    storageBoundary: "immutable-nonsecret-ops-evidence-ledger",
    allowedStates: ["proven", "unproven"],
    completeStates: ["proven"]
  }),
  definition({
    name: "identity.pepper.production.current",
    kind: "identity_pepper",
    purpose: "identity_current_derivation",
    scopes: ["identity:derive-current"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "identity.pepper.production.prior",
    kind: "identity_pepper",
    purpose: "identity_prior_verification",
    scopes: ["identity:verify-prior"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["overlap", "revoked", "unproven"],
    completeStates: ["overlap", "revoked"]
  }),
  definition({
    name: "operator.recovery.approver",
    kind: "operator_recovery_authority",
    purpose: "credential_recovery_approval",
    scopes: ["recovery:approve"],
    storageBoundary: "operator-recovery-approver-custody",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "operator.recovery.requester",
    kind: "operator_recovery_authority",
    purpose: "credential_recovery_request",
    scopes: ["recovery:request"],
    storageBoundary: "operator-recovery-requester-custody",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "registrant.contact.production.encryption",
    kind: "symmetric_encryption_key",
    purpose: "registrant_contact_encryption",
    scopes: ["registrant:decrypt", "registrant:encrypt"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "resend.sender.historical-shared-full-access",
    kind: "provider_api_shared_status",
    purpose: "shared_full_access_credential_status_only",
    scopes: ["status:revocation-only"],
    storageBoundary: "provider-control-plane-status-only",
    allowedStates: [
      "shared_pending_revocation",
      "shared_revoked",
      "unproven"
    ],
    completeStates: ["shared_revoked"]
  }),
  definition({
    name: "resend.sender.production.restricted",
    kind: "provider_api_environment_bound",
    purpose: "resend_production_delivery",
    scopes: ["domains:read", "emails:send"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "resend.sender.staging.restricted",
    kind: "provider_api_environment_bound",
    purpose: "resend_staging_delivery",
    scopes: ["domains:read", "emails:send"],
    storageBoundary: "staging-mail-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "responder.material.production.current",
    kind: "symmetric_encryption_key",
    purpose: "responder_material_current_encryption",
    scopes: ["responder-material:decrypt", "responder-material:encrypt"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "responder.material.production.prior",
    kind: "symmetric_encryption_key",
    purpose: "responder_material_prior_decryption",
    scopes: ["responder-material:decrypt-prior"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["overlap", "revoked", "unproven"],
    completeStates: ["overlap", "revoked"]
  }),
  definition({
    name: "stripe.provisioner.production.restricted",
    kind: "provider_api_restricted",
    purpose: "stripe_ephemeral_provisioning_status",
    scopes: [
      ...STRIPE_RESTRICTED_KEY_CONTRACT
        .provisionerScopes
    ],
    storageBoundary: "operator-ephemeral-provider-session",
    allowedStates: ["ephemeral_revoked", "unproven"],
    completeStates: ["ephemeral_revoked"]
  }),
  definition({
    name: "stripe.runtime.production.restricted",
    kind: "provider_api_restricted",
    purpose: "stripe_runtime_production",
    scopes: [
      ...STRIPE_RESTRICTED_KEY_CONTRACT.allRuntimeScopes
    ],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "stripe.standard.production.compromised",
    kind: "provider_api_standard_status",
    purpose: "compromised_credential_status_only",
    scopes: ["status:revocation-only"],
    storageBoundary: "provider-control-plane-status-only",
    allowedStates: [
      "compromised_pending_revocation",
      "compromised_revoked",
      "unproven"
    ],
    completeStates: ["compromised_revoked"]
  }),
  definition({
    name: "stripe.webhook.production.current",
    kind: "provider_webhook_signing",
    purpose: "stripe_webhook_current_verification",
    scopes: ["webhooks:verify"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "stripe.webhook.production.prior",
    kind: "provider_webhook_signing",
    purpose: "stripe_webhook_prior_overlap",
    scopes: ["webhooks:verify-prior"],
    storageBoundary: "dell-hosted-production-secret-store",
    allowedStates: ["overlap", "revoked", "unproven"],
    completeStates: ["overlap", "revoked"]
  }),
  definition({
    name: "twilio.responder.production.api.restricted",
    kind: "provider_customer_registry",
    purpose: "twilio_customer_runtime_authority",
    scopes: [
      "twilio-customer-subaccount:read",
      "twilio-customer-compliance:read",
      "twilio-customer-messages:send",
      "twilio-customer-voice-token:sign",
      "twilio-customer-push-credential:reference"
    ],
    storageBoundary: "dell-root-readable-customer-provider-registry",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  }),
  definition({
    name: "twilio.responder.production.webhook.signature",
    kind: "provider_webhook_signing",
    purpose: "twilio_responder_webhook_verification",
    scopes: ["twilio-webhooks:verify"],
    storageBoundary: "dell-root-readable-customer-provider-registry",
    allowedStates: ["active", "unproven"],
    completeStates: ["active"]
  })
]);

const DEFINITION_BY_NAME = new Map(
  DEFINITIONS.map((entry) => [entry.name, entry])
);

function definition(value) {
  return deepFreeze({
    ...value,
    scopes: [...value.scopes].sort(),
    allowedStates: [...value.allowedStates].sort(),
    completeStates: [...value.completeStates].sort()
  });
}

function sortedUnique(values) {
  return Object.freeze([...new Set(values)].sort());
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function topologyError(code, message) {
  const error = new Error(message);
  error.name = "CredentialTopologyError";
  error.code = code;
  return error;
}

function fail(code, message) {
  throw topologyError(code, message);
}

function exactObject(value, fields, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...fields].sort())
  ) {
    fail(code, "Credential topology has an invalid exact-object shape.");
  }
  return value;
}

function exactArray(value, expected, code) {
  if (
    !Array.isArray(value) ||
    JSON.stringify(value) !== JSON.stringify(expected)
  ) {
    fail(code, "Credential topology has an invalid exact-array binding.");
  }
  return Object.freeze([...value]);
}

function evidenceDigest(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "CREDENTIAL_TOPOLOGY_EVIDENCE_INVALID",
      "Credential topology evidence must be a lowercase SHA-256 digest."
    );
  }
  return value;
}

function instant(value) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_EVIDENCE_INVALID",
      "Credential topology last-proven time must be an exact UTC instant."
    );
  }
  return value;
}

function requiredInstant(value) {
  const selected = instant(value);
  if (selected === null) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
      "Stripe credential binding requires an exact UTC instant."
    );
  }
  return selected;
}

function requiredDigest(value) {
  const selected = evidenceDigest(value);
  if (selected === null) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
      "Stripe credential binding requires a non-secret SHA-256 digest."
    );
  }
  return selected;
}

function requiredToken(value) {
  if (typeof value !== "string" || !SAFE_TOKEN.test(value)) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
      "Stripe credential binding requires a safe non-secret token."
    );
  }
  return value;
}

function stripeScopesForPurposes(purposes) {
  return sortedUnique(
    purposes.flatMap(
      (purpose) => STRIPE_SCOPES_BY_PURPOSE[purpose]
    )
  );
}

function normalizeStripeProviderBinding(
  value,
  expected,
  rotationState
) {
  const isStripeCredential = [
    "stripe.provisioner.production.restricted",
    "stripe.runtime.production.restricted",
    "stripe.standard.production.compromised"
  ].includes(expected.name);
  if (!isStripeCredential) {
    if (value !== null) {
      fail(
        "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
        "Only reviewed Stripe credential records accept provider binding."
      );
    }
    return null;
  }
  const complete = expected.completeStates.includes(
    rotationState
  );
  if (!complete) {
    if (value !== null) {
      fail(
        "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
        "Unproven Stripe credential records cannot claim provider binding."
      );
    }
    return null;
  }
  if (expected.name === "stripe.runtime.production.restricted") {
    exactObject(
      value,
      [
        "accountId",
        "activatedAt",
        "enabledPurposes",
        "environment",
        "keyClass",
        "keyFingerprint",
        "keyVersion",
        "livemode",
        "provider"
      ],
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID"
    );
    const purposes = exactArray(
      value.enabledPurposes,
      sortedUnique(value.enabledPurposes ?? []),
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID"
    );
    if (
      value.provider !== "stripe" ||
      value.environment !== "production" ||
      value.livemode !== true ||
      value.keyClass !== "restricted" ||
      !STRIPE_ACCOUNT.test(value.accountId) ||
      purposes.length === 0 ||
      !purposes.every((purpose) =>
        STRIPE_PURPOSES.includes(purpose)
      )
    ) {
      fail(
        "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
        "Stripe runtime binding does not match the production restricted-key contract."
      );
    }
    return deepFreeze({
      provider: "stripe",
      environment: "production",
      livemode: true,
      accountId: value.accountId,
      keyClass: "restricted",
      keyVersion: requiredToken(value.keyVersion),
      keyFingerprint: requiredDigest(value.keyFingerprint),
      activatedAt: requiredInstant(value.activatedAt),
      enabledPurposes: purposes
    });
  }
  if (
    expected.name ===
    "stripe.provisioner.production.restricted"
  ) {
    exactObject(
      value,
      [
        "accountId",
        "activatedAt",
        "environment",
        "keyClass",
        "keyFingerprint",
        "keyVersion",
        "livemode",
        "provider",
        "revokedAt",
        "scopeEvidenceDigest",
        "scopeProvenAt"
      ],
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID"
    );
    if (
      value.provider !== "stripe" ||
      value.environment !== "production" ||
      value.livemode !== true ||
      value.keyClass !== "restricted" ||
      !STRIPE_ACCOUNT.test(value.accountId)
    ) {
      fail(
        "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
        "Stripe provisioner binding does not match the production restricted-key contract."
      );
    }
    return deepFreeze({
      provider: "stripe",
      environment: "production",
      livemode: true,
      accountId: value.accountId,
      keyClass: "restricted",
      keyVersion: requiredToken(value.keyVersion),
      keyFingerprint: requiredDigest(value.keyFingerprint),
      activatedAt: requiredInstant(value.activatedAt),
      revokedAt: requiredInstant(value.revokedAt),
      scopeProvenAt: requiredInstant(value.scopeProvenAt),
      scopeEvidenceDigest: requiredDigest(
        value.scopeEvidenceDigest
      )
    });
  }
  exactObject(
    value,
    [
      "accountId",
      "environment",
      "keyClass",
      "keyFingerprint",
      "keyVersion",
      "livemode",
      "provider",
      "revokedAt"
    ],
    "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID"
  );
  if (
    value.provider !== "stripe" ||
    value.environment !== "production" ||
    value.livemode !== true ||
    value.keyClass !== "standard_status_only" ||
    !STRIPE_ACCOUNT.test(value.accountId)
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
      "Compromised Stripe Standard-key binding is status-only."
    );
  }
  return deepFreeze({
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId: value.accountId,
    keyClass: "standard_status_only",
    keyVersion: requiredToken(value.keyVersion),
    keyFingerprint: requiredDigest(value.keyFingerprint),
    revokedAt: requiredInstant(value.revokedAt)
  });
}

function hasForbiddenFullAccessScope(value) {
  return (
    Array.isArray(value?.scopes) &&
    value.scopes.some(
      (scope) =>
        typeof scope === "string" &&
        /(?:^|:)full[-_]?access(?:$|:)/iu.test(scope)
    )
  );
}

function normalizeItem(value, expected) {
  if (hasForbiddenFullAccessScope(value)) {
    fail(
      "CREDENTIAL_TOPOLOGY_FULL_ACCESS_FORBIDDEN",
      "Full-access credentials are forbidden by the held topology."
    );
  }
  exactObject(
    value,
    ITEM_FIELDS,
    "CREDENTIAL_TOPOLOGY_ITEM_INVALID"
  );
  for (const field of [
    "kind",
    "name",
    "purpose",
    "storageBoundary"
  ]) {
    if (value[field] !== expected[field]) {
      fail(
        "CREDENTIAL_TOPOLOGY_BINDING_MISMATCH",
        "Credential topology identity does not match the reviewed inventory."
      );
    }
  }
  if (!expected.allowedStates.includes(value.rotationState)) {
    fail(
      "CREDENTIAL_TOPOLOGY_ROTATION_STATE_INVALID",
      "Credential topology rotation state is invalid for the reviewed item."
    );
  }
  if (typeof value.materialPresent !== "boolean") {
    fail(
      "CREDENTIAL_TOPOLOGY_PRESENCE_INVALID",
      "Credential topology material presence must be boolean."
    );
  }
  const selectedDigest = evidenceDigest(value.evidenceDigest);
  const selectedInstant = instant(value.lastProvenAt);
  if ((selectedDigest === null) !== (selectedInstant === null)) {
    fail(
      "CREDENTIAL_TOPOLOGY_EVIDENCE_INVALID",
      "Credential topology evidence digest and last-proven time must be supplied together."
    );
  }

  const state = value.rotationState;
  if (state === "unproven") {
    if (
      selectedDigest !== null ||
      selectedInstant !== null ||
      value.materialPresent
    ) {
      fail(
        "CREDENTIAL_TOPOLOGY_UNPROVEN_STATE_INVALID",
        "Unproven topology items cannot claim evidence or material presence."
      );
    }
  } else if (
    state === "compromised_pending_revocation" ||
    state === "shared_pending_revocation"
  ) {
    if (value.materialPresent) {
      fail(
        "CREDENTIAL_TOPOLOGY_PENDING_REVOCATION_STATUS_INVALID",
        "Pending-revocation credential status cannot claim usable material presence."
      );
    }
  } else {
    if (selectedDigest === null || selectedInstant === null) {
      fail(
        "CREDENTIAL_TOPOLOGY_EVIDENCE_REQUIRED",
        "Proven rotation states require timestamped digest evidence."
      );
    }
    const expectsMaterial = ["active", "overlap"].includes(state);
    if (value.materialPresent !== expectsMaterial) {
      fail(
        "CREDENTIAL_TOPOLOGY_PRESENCE_MISMATCH",
        "Material presence does not match the reviewed rotation state."
      );
    }
  }
  const providerBinding = normalizeStripeProviderBinding(
    value.providerBinding,
    expected,
    state
  );
  const expectedScopes =
    expected.name ===
      "stripe.runtime.production.restricted" &&
    providerBinding !== null
      ? stripeScopesForPurposes(
          providerBinding.enabledPurposes
        )
      : expected.scopes;
  const scopes = exactArray(
    value.scopes,
    expectedScopes,
    "CREDENTIAL_TOPOLOGY_SCOPE_MISMATCH"
  );

  return deepFreeze({
    evidenceDigest: selectedDigest,
    kind: value.kind,
    lastProvenAt: selectedInstant,
    materialPresent: value.materialPresent,
    name: value.name,
    purpose: value.purpose,
    providerBinding,
    rotationState: state,
    scopes,
    storageBoundary: value.storageBoundary
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(value[key])}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256")
    .update(canonicalize(value), "utf8")
    .digest("hex");
}

function itemByName(topology, name) {
  return topology.items.find((item) => item.name === name);
}

function incompleteBlockers(topology) {
  return topology.items
    .filter((item) => {
      const expected = DEFINITION_BY_NAME.get(item.name);
      return !expected.completeStates.includes(item.rotationState);
    })
    .map((item) => `evidence_incomplete:${item.name}`);
}

function crossBoundaryBlockers(topology) {
  const blockers = [];
  const backupCiphertext = itemByName(
    topology,
    "backup.age.ciphertext.primary"
  );
  const backupIdentity = itemByName(
    topology,
    "backup.age.identity.recovery"
  );
  if (
    backupCiphertext.storageBoundary ===
    backupIdentity.storageBoundary
  ) {
    blockers.push(
      "backup_identity_ciphertext_co_located"
    );
  }

  const resendProduction = itemByName(
    topology,
    "resend.sender.production.restricted"
  );
  const resendStaging = itemByName(
    topology,
    "resend.sender.staging.restricted"
  );
  if (
    resendProduction.storageBoundary ===
    resendStaging.storageBoundary
  ) {
    blockers.push("resend_environment_boundary_shared");
  }

  const recoveryApprover = itemByName(
    topology,
    "operator.recovery.approver"
  );
  const recoveryRequester = itemByName(
    topology,
    "operator.recovery.requester"
  );
  if (
    recoveryApprover.storageBoundary ===
    recoveryRequester.storageBoundary
  ) {
    blockers.push("operator_recovery_single_custody");
  }
  return blockers;
}

function rotationBlockers(topology) {
  const blockers = [];
  const stripePrior = itemByName(
    topology,
    "stripe.webhook.production.prior"
  );
  const stripeControl = itemByName(
    topology,
    "control.stripe.webhook.rotation"
  );
  if (
    !["overlap", "revoked"].includes(
      stripePrior.rotationState
    ) ||
    stripeControl.rotationState !== "proven"
  ) {
    blockers.push(
      "stripe_webhook_overlap_or_revocation_not_proven"
    );
  }

  const identityPrior = itemByName(
    topology,
    "identity.pepper.production.prior"
  );
  const identityControl = itemByName(
    topology,
    "control.identity.pepper.rotation"
  );
  if (
    !["overlap", "revoked"].includes(
      identityPrior.rotationState
    ) ||
    identityControl.rotationState !== "proven"
  ) {
    blockers.push(
      "identity_pepper_overlap_or_revocation_not_proven"
    );
  }

  const responderMaterialPrior = itemByName(
    topology,
    "responder.material.production.prior"
  );
  const responderMaterialControl = itemByName(
    topology,
    "control.responder.material.rotation"
  );
  if (
    !["overlap", "revoked"].includes(
      responderMaterialPrior.rotationState
    ) || responderMaterialControl.rotationState !== "proven"
  ) {
    blockers.push(
      "responder_material_overlap_or_revocation_not_proven"
    );
  }

  const provisioner = itemByName(
    topology,
    "stripe.provisioner.production.restricted"
  );
  if (provisioner.rotationState !== "ephemeral_revoked") {
    blockers.push("stripe_provisioner_revocation_not_proven");
  }

  const compromised = itemByName(
    topology,
    "stripe.standard.production.compromised"
  );
  if (compromised.rotationState !== "compromised_revoked") {
    blockers.push(
      "stripe_standard_compromised_revocation_not_proven"
    );
  }

  const resendShared = itemByName(
    topology,
    "resend.sender.historical-shared-full-access"
  );
  if (resendShared.rotationState !== "shared_revoked") {
    blockers.push(
      "resend_shared_full_access_revocation_not_proven"
    );
  }
  const twilioIsolation = itemByName(
    topology,
    "control.twilio.customer-isolation"
  );
  if (twilioIsolation.rotationState !== "proven") {
    blockers.push("twilio_customer_subaccount_isolation_not_proven");
  }
  return blockers;
}

function separationControlBlockers(topology) {
  const requirements = [
    [
      "control.backup.identity-ciphertext.separation",
      "backup_identity_ciphertext_separation_not_proven"
    ],
    [
      "control.operator.recovery.dual-control",
      "operator_recovery_dual_control_not_proven"
    ],
    [
      "control.resend.environment-separation",
      "resend_environment_separation_not_proven"
    ]
  ];
  return requirements
    .filter(
      ([name]) =>
        itemByName(topology, name).rotationState !== "proven"
    )
    .map(([, blocker]) => blocker);
}

function independentEvidenceBlockers(topology) {
  const requirements = [
    {
      names: [
        "backup.age.ciphertext.primary",
        "backup.age.identity.recovery",
        "control.backup.identity-ciphertext.separation"
      ],
      blocker: "backup_independent_evidence_not_proven"
    },
    {
      names: [
        "control.identity.pepper.rotation",
        "identity.pepper.production.current",
        "identity.pepper.production.prior"
      ],
      blocker: "identity_pepper_independent_evidence_not_proven"
    },
    {
      names: [
        "control.operator.recovery.dual-control",
        "operator.recovery.approver",
        "operator.recovery.requester"
      ],
      blocker: "operator_recovery_independent_evidence_not_proven"
    },
    {
      names: [
        "control.resend.environment-separation",
        "resend.sender.production.restricted",
        "resend.sender.staging.restricted"
      ],
      blocker: "resend_independent_evidence_not_proven"
    },
    {
      names: [
        "control.responder.material.rotation",
        "responder.material.production.current",
        "responder.material.production.prior"
      ],
      blocker: "responder_material_independent_evidence_not_proven"
    },
    {
      names: [
        "control.stripe.webhook.rotation",
        "stripe.webhook.production.current",
        "stripe.webhook.production.prior"
      ],
      blocker: "stripe_webhook_independent_evidence_not_proven"
    },
    {
      names: [
        "control.twilio.customer-isolation",
        "twilio.responder.production.api.restricted",
        "twilio.responder.production.webhook.signature"
      ],
      blocker: "twilio_customer_isolation_independent_evidence_not_proven"
    }
  ];
  return requirements.flatMap(({ names, blocker }) => {
    const digests = names
      .map((name) => itemByName(topology, name).evidenceDigest)
      .filter((value) => value !== null);
    return digests.length === names.length &&
      new Set(digests).size !== digests.length
      ? [blocker]
      : [];
  });
}

export function createHeldCredentialTopologyTemplate() {
  return deepFreeze({
    schema: CREDENTIAL_TOPOLOGY_SCHEMA,
    mode: MODE,
    items: DEFINITIONS.map((entry) => ({
      evidenceDigest: null,
      kind: entry.kind,
      lastProvenAt: null,
      materialPresent: false,
      name: entry.name,
      purpose: entry.purpose,
      providerBinding: null,
      rotationState:
        entry.name ===
        "stripe.standard.production.compromised"
          ? "compromised_pending_revocation"
          : "unproven",
      scopes: [...entry.scopes],
      storageBoundary: entry.storageBoundary
    }))
  });
}

export function normalizeCredentialTopology(value) {
  exactObject(
    value,
    TOP_LEVEL_FIELDS,
    "CREDENTIAL_TOPOLOGY_INVALID"
  );
  if (
    value.schema !== CREDENTIAL_TOPOLOGY_SCHEMA ||
    value.mode !== MODE ||
    !Array.isArray(value.items) ||
    value.items.length !== DEFINITIONS.length
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_INVALID",
      "Credential topology must match the exact held v1 inventory."
    );
  }
  const items = value.items.map((item, index) =>
    normalizeItem(item, DEFINITIONS[index])
  );
  return deepFreeze({
    schema: CREDENTIAL_TOPOLOGY_SCHEMA,
    mode: MODE,
    items
  });
}

export function verifyCredentialTopology(
  value,
  { now = new Date() } = {}
) {
  const topology = normalizeCredentialTopology(value);
  const evaluatedAt =
    now instanceof Date && Number.isFinite(now.valueOf())
      ? now.toISOString()
      : fail(
          "CREDENTIAL_TOPOLOGY_CLOCK_INVALID",
          "Credential topology verifier requires a valid clock."
        );
  const blockers = [
    ...incompleteBlockers(topology),
    ...crossBoundaryBlockers(topology),
    ...rotationBlockers(topology),
    ...separationControlBlockers(topology),
    ...independentEvidenceBlockers(topology),
    ...topology.items
      .filter(
        (item) =>
          item.lastProvenAt !== null &&
          item.lastProvenAt > evaluatedAt
      )
      .map((item) => `evidence_in_future:${item.name}`)
  ].sort();
  return deepFreeze({
    schema: CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA,
    mode: MODE,
    effectsAllowed: false,
    topologyEvidenceComplete: blockers.length === 0,
    evaluatedAt,
    itemCount: topology.items.length,
    topologyDigest: digest(topology),
    blockers: [...new Set(blockers)]
  });
}

function verifyStripeCredentialReadinessInternal(
  value,
  {
    now,
    purpose = null,
    environment = "production",
    livemode = true,
    runtimeFingerprint,
    requireFreshScopeEvidence
  } = {}
) {
  if (typeof requireFreshScopeEvidence !== "boolean") {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_FRESHNESS_INVALID",
      "Stripe credential readiness requires an exact scope-evidence freshness policy."
    );
  }
  const topology = normalizeCredentialTopology(value);
  const nowMs =
    typeof now === "string" &&
    Number.isFinite(Date.parse(now)) &&
    new Date(now).toISOString() === now
      ? Date.parse(now)
      : fail(
          "CREDENTIAL_TOPOLOGY_CLOCK_INVALID",
          "Stripe credential readiness requires an exact UTC clock."
        );
  if (environment !== "production" || livemode !== true) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_MODE_MISMATCH",
      "Authoritative Stripe credential topology is production-live only."
    );
  }
  const runtime = itemByName(
    topology,
    "stripe.runtime.production.restricted"
  );
  const provisioner = itemByName(
    topology,
    "stripe.provisioner.production.restricted"
  );
  const standard = itemByName(
    topology,
    "stripe.standard.production.compromised"
  );
  if (
    runtime.rotationState !== "active" ||
    runtime.materialPresent !== true ||
    runtime.providerBinding === null ||
    provisioner.rotationState !== "ephemeral_revoked" ||
    provisioner.materialPresent !== false ||
    provisioner.providerBinding === null ||
    standard.rotationState !== "compromised_revoked" ||
    standard.materialPresent !== false ||
    standard.providerBinding === null
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_NOT_READY",
      "Stripe runtime, provisioner revocation, and Standard-key revocation evidence are required."
    );
  }
  const runtimeBinding = runtime.providerBinding;
  const provisionerBinding = provisioner.providerBinding;
  const standardBinding = standard.providerBinding;
  if (
    runtimeBinding.accountId !==
      provisionerBinding.accountId ||
    runtimeBinding.accountId !== standardBinding.accountId ||
    runtimeBinding.environment !== environment ||
    runtimeBinding.livemode !== livemode ||
    typeof runtimeFingerprint !== "string" ||
    !SHA256.test(runtimeFingerprint) ||
    runtimeBinding.keyFingerprint !== runtimeFingerprint
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_MISMATCH",
      "Stripe credential account, mode, or runtime fingerprint does not match."
    );
  }
  if (
    new Set([
      runtimeBinding.keyFingerprint,
      provisionerBinding.keyFingerprint,
      standardBinding.keyFingerprint
    ]).size !== 3 ||
    runtime.storageBoundary ===
      provisioner.storageBoundary ||
    new Set([
      runtime.evidenceDigest,
      provisioner.evidenceDigest,
      provisionerBinding.scopeEvidenceDigest,
      standard.evidenceDigest
    ]).size !== 4
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_SHARED",
      "Stripe credential identity, custody, or evidence cannot be shared."
    );
  }
  if (
    purpose !== null &&
    (!STRIPE_PURPOSES.includes(purpose) ||
      !runtimeBinding.enabledPurposes.includes(purpose))
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_PURPOSE_HELD",
      "Stripe payment purpose is not enabled by credential topology."
    );
  }
  const instants = {
    provisionerActivated: Date.parse(
      provisionerBinding.activatedAt
    ),
    runtimeActivated: Date.parse(runtimeBinding.activatedAt),
    standardRevoked: Date.parse(standardBinding.revokedAt),
    provisionerRevoked: Date.parse(
      provisionerBinding.revokedAt
    ),
    provisionerScopeProven: Date.parse(
      provisionerBinding.scopeProvenAt
    ),
    provisionerRevocationProven: Date.parse(
      provisioner.lastProvenAt
    ),
    standardRevocationProven: Date.parse(
      standard.lastProvenAt
    ),
    runtimeScopeProven: Date.parse(runtime.lastProvenAt)
  };
  if (
    !(
      instants.provisionerActivated <
        instants.runtimeActivated &&
      instants.runtimeActivated <= instants.standardRevoked &&
      instants.standardRevoked <=
        instants.provisionerRevoked &&
      instants.provisionerScopeProven >=
        instants.provisionerActivated &&
      instants.provisionerScopeProven <=
        instants.provisionerRevoked &&
      instants.provisionerRevocationProven >=
        instants.provisionerRevoked &&
      instants.standardRevocationProven >=
        instants.standardRevoked &&
      instants.runtimeScopeProven >=
        instants.provisionerRevoked &&
      instants.provisionerRevoked -
        instants.provisionerActivated <=
        STRIPE_PROVISIONER_MAXIMUM_LIFETIME_MS &&
      instants.standardRevoked -
        instants.runtimeActivated <=
        STRIPE_STANDARD_MAXIMUM_OVERLAP_MS &&
      instants.provisionerRevocationProven -
        instants.provisionerRevoked <=
        STRIPE_REVOCATION_CONFIRMATION_MAXIMUM_MS &&
      instants.standardRevocationProven -
        instants.standardRevoked <=
        STRIPE_REVOCATION_CONFIRMATION_MAXIMUM_MS
    )
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_CHRONOLOGY_INVALID",
      "Stripe credential activation and revocation chronology is invalid."
    );
  }
  if (
    instants.runtimeActivated > nowMs ||
    instants.provisionerRevocationProven > nowMs ||
    instants.standardRevocationProven > nowMs ||
    instants.runtimeScopeProven > nowMs ||
    (requireFreshScopeEvidence &&
      nowMs - instants.runtimeScopeProven >
        STRIPE_RUNTIME_READBACK_MAXIMUM_AGE_MS)
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_SCOPE_STALE",
      "Stripe runtime scope evidence is stale or future-dated."
    );
  }
  const operations = sortedUnique(
    runtimeBinding.enabledPurposes.flatMap(
      (selectedPurpose) =>
        STRIPE_OPERATIONS_BY_PURPOSE[selectedPurpose]
    )
  );
  return deepFreeze({
    schema: CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA,
    mode: MODE,
    selection: "stripe",
    ready: true,
    effectsAllowed: false,
    topologyDigest: digest(topology),
    accountId: runtimeBinding.accountId,
    environment: runtimeBinding.environment,
    livemode: runtimeBinding.livemode,
    enabledPurposes: runtimeBinding.enabledPurposes,
    runtimeVersion: runtimeBinding.keyVersion,
    runtimeFingerprint: runtimeBinding.keyFingerprint,
    runtimeScopeCount: runtime.scopes.length,
    runtimeScopeDigest: digest(runtime.scopes),
    runtimeOperationCount: operations.length,
    runtimeOperationDigest: digest(operations),
    provisionerRevoked: true,
    compromisedStandardRevoked: true,
    domainsHeld: true
  });
}

export function verifyStripeCredentialReadiness(
  value,
  options = {}
) {
  return verifyStripeCredentialReadinessInternal(value, {
    ...options,
    requireFreshScopeEvidence: true
  });
}

function exactUtc(value, code, message) {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
    ? value
    : fail(code, message);
}

function activationReceiptWithoutDigest(value) {
  const selected = { ...value };
  delete selected.receiptDigest;
  return selected;
}

function exactStripeCredentialActivationReceipt(value) {
  exactObject(
    value,
    STRIPE_ACTIVATION_RECEIPT_FIELDS,
    "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID"
  );
  if (
    value.schema !==
      STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_SCHEMA ||
    value.state !== "activated" ||
    value.environment !== "production" ||
    value.livemode !== true ||
    !STRIPE_ACCOUNT.test(value.accountId) ||
    !SAFE_TOKEN.test(value.runtimeVersion) ||
    !SHA256.test(value.runtimeFingerprint) ||
    !SHA256.test(value.topologyDigest) ||
    !SHA256.test(value.runtimeScopeDigest) ||
    !SHA256.test(value.runtimeOperationDigest) ||
    !SHA256.test(value.scopeEvidenceDigest) ||
    !SHA256.test(value.receiptDigest) ||
    !Number.isSafeInteger(value.runtimeScopeCount) ||
    value.runtimeScopeCount <= 0 ||
    !Number.isSafeInteger(value.runtimeOperationCount) ||
    value.runtimeOperationCount <= 0 ||
    !Array.isArray(value.enabledPurposes) ||
    value.enabledPurposes.length === 0 ||
    value.enabledPurposes.some(
      (purpose) => !STRIPE_PURPOSES.includes(purpose)
    ) ||
    JSON.stringify(value.enabledPurposes) !==
      JSON.stringify(sortedUnique(value.enabledPurposes))
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
      "Stripe credential activation receipt is invalid."
    );
  }
  const scopeProvenAt = exactUtc(
    value.scopeProvenAt,
    "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
    "Stripe credential activation scope proof time is invalid."
  );
  const activatedAt = exactUtc(
    value.activatedAt,
    "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
    "Stripe credential activation time is invalid."
  );
  const validUntil = exactUtc(
    value.validUntil,
    "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
    "Stripe credential activation expiry is invalid."
  );
  const scopeProvenMs = Date.parse(scopeProvenAt);
  const activatedMs = Date.parse(activatedAt);
  const validUntilMs = Date.parse(validUntil);
  if (
    scopeProvenMs > activatedMs ||
    activatedMs - scopeProvenMs >
      STRIPE_RUNTIME_READBACK_MAXIMUM_AGE_MS ||
    validUntilMs <= activatedMs ||
    validUntilMs - activatedMs >
      STRIPE_ACTIVATION_RECEIPT_MAXIMUM_LIFETIME_MS ||
    value.receiptDigest !==
      digest(activationReceiptWithoutDigest(value))
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
      "Stripe credential activation receipt chronology or digest is invalid."
    );
  }
  return deepFreeze({ ...value });
}

export function createStripeCredentialActivationReceipt(
  value,
  {
    now,
    validUntil,
    environment = "production",
    livemode = true,
    runtimeFingerprint
  } = {}
) {
  const topology = normalizeCredentialTopology(value);
  const activation = verifyStripeCredentialReadiness(
    topology,
    {
      now,
      environment,
      livemode,
      runtimeFingerprint
    }
  );
  const runtime = itemByName(
    topology,
    "stripe.runtime.production.restricted"
  );
  const receipt = {
    schema:
      STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_SCHEMA,
    state: "activated",
    accountId: activation.accountId,
    environment: activation.environment,
    livemode: activation.livemode,
    enabledPurposes: activation.enabledPurposes,
    runtimeVersion: activation.runtimeVersion,
    runtimeFingerprint: activation.runtimeFingerprint,
    topologyDigest: activation.topologyDigest,
    runtimeScopeCount: activation.runtimeScopeCount,
    runtimeScopeDigest: activation.runtimeScopeDigest,
    runtimeOperationCount:
      activation.runtimeOperationCount,
    runtimeOperationDigest:
      activation.runtimeOperationDigest,
    scopeEvidenceDigest: runtime.evidenceDigest,
    scopeProvenAt: runtime.lastProvenAt,
    activatedAt: exactUtc(
      now,
      "CREDENTIAL_TOPOLOGY_CLOCK_INVALID",
      "Stripe credential activation requires an exact UTC clock."
    ),
    validUntil: exactUtc(
      validUntil,
      "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_INVALID",
      "Stripe credential activation requires an exact UTC expiry."
    )
  };
  return exactStripeCredentialActivationReceipt({
    ...receipt,
    receiptDigest: digest(receipt)
  });
}

export function verifyStripeCredentialActivationReceipt(
  value,
  receiptValue,
  {
    now,
    purpose = null,
    environment = "production",
    livemode = true,
    runtimeFingerprint
  } = {}
) {
  const topology = normalizeCredentialTopology(value);
  const receipt =
    exactStripeCredentialActivationReceipt(receiptValue);
  const checkedAt = exactUtc(
    now,
    "CREDENTIAL_TOPOLOGY_CLOCK_INVALID",
    "Stripe credential readiness requires an exact UTC clock."
  );
  if (
    Date.parse(receipt.activatedAt) > Date.parse(checkedAt) ||
    Date.parse(receipt.validUntil) <= Date.parse(checkedAt)
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_EXPIRED",
      "Stripe credential activation receipt is future-dated or expired."
    );
  }
  const readiness = verifyStripeCredentialReadinessInternal(
    topology,
    {
      now: checkedAt,
      purpose,
      environment,
      livemode,
      runtimeFingerprint,
      requireFreshScopeEvidence: false
    }
  );
  const runtime = itemByName(
    topology,
    "stripe.runtime.production.restricted"
  );
  if (
    receipt.accountId !== readiness.accountId ||
    receipt.environment !== readiness.environment ||
    receipt.livemode !== readiness.livemode ||
    JSON.stringify(receipt.enabledPurposes) !==
      JSON.stringify(readiness.enabledPurposes) ||
    receipt.runtimeVersion !== readiness.runtimeVersion ||
    receipt.runtimeFingerprint !==
      readiness.runtimeFingerprint ||
    receipt.topologyDigest !== readiness.topologyDigest ||
    receipt.runtimeScopeCount !==
      readiness.runtimeScopeCount ||
    receipt.runtimeScopeDigest !==
      readiness.runtimeScopeDigest ||
    receipt.runtimeOperationCount !==
      readiness.runtimeOperationCount ||
    receipt.runtimeOperationDigest !==
      readiness.runtimeOperationDigest ||
    receipt.scopeEvidenceDigest !==
      runtime.evidenceDigest ||
    receipt.scopeProvenAt !== runtime.lastProvenAt
  ) {
    fail(
      "CREDENTIAL_TOPOLOGY_STRIPE_ACTIVATION_RECEIPT_MISMATCH",
      "Stripe credential activation receipt no longer matches runtime topology."
    );
  }
  return readiness;
}

export function createStripeCredentialReadinessLease(
  value,
  {
    now,
    environment = "production",
    livemode = true,
    runtimeFingerprint,
    activationReceipt = null
  } = {}
) {
  const topology = normalizeCredentialTopology(value);
  const activation = activationReceipt === null
    ? verifyStripeCredentialReadinessInternal(topology, {
        now,
        environment,
        livemode,
        runtimeFingerprint,
        requireFreshScopeEvidence: true
      })
    : verifyStripeCredentialActivationReceipt(
        topology,
        activationReceipt,
        {
          now,
          environment,
          livemode,
          runtimeFingerprint
        }
      );
  const activationMs = Date.parse(now);
  return deepFreeze({
    schema:
      "sitesourcery.stripe-credential-readiness-lease/v1",
    activatedAt: now,
    activation,
    readiness({ now: checkedAt, purpose = null } = {}) {
      const checkedAtMs =
        typeof checkedAt === "string" &&
        Number.isFinite(Date.parse(checkedAt)) &&
        new Date(checkedAt).toISOString() === checkedAt
          ? Date.parse(checkedAt)
          : fail(
              "CREDENTIAL_TOPOLOGY_CLOCK_INVALID",
              "Stripe credential readiness requires an exact UTC clock."
            );
      if (checkedAtMs < activationMs) {
        fail(
          "CREDENTIAL_TOPOLOGY_STRIPE_CLOCK_ROLLBACK",
          "Stripe credential readiness cannot move behind its verified process activation."
        );
      }
      return activationReceipt === null
        ? verifyStripeCredentialReadinessInternal(
            topology,
            {
              now: checkedAt,
              purpose,
              environment,
              livemode,
              runtimeFingerprint,
              requireFreshScopeEvidence: false
            }
          )
        : verifyStripeCredentialActivationReceipt(
            topology,
            activationReceipt,
            {
              now: checkedAt,
              purpose,
              environment,
              livemode,
              runtimeFingerprint
            }
          );
    }
  });
}

export const CREDENTIAL_TOPOLOGY_CONTRACT = deepFreeze({
  schema: CREDENTIAL_TOPOLOGY_SCHEMA,
  jsonSchemaId: CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID,
  mode: MODE,
  effectsAllowed: false,
  itemCount: DEFINITIONS.length,
  names: DEFINITIONS.map((entry) => entry.name)
});
