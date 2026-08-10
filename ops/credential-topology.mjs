import { createHash } from "node:crypto";

export const CREDENTIAL_TOPOLOGY_SCHEMA =
  "sitesourcery.credential-topology/v1";
export const CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA =
  "sitesourcery.credential-topology-verification/v1";
export const CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/credential-topology-v1.json";

const MODE = "held";
const SHA256 = /^[a-f0-9]{64}$/u;
const ITEM_FIELDS = Object.freeze([
  "evidenceDigest",
  "kind",
  "lastProvenAt",
  "materialPresent",
  "name",
  "purpose",
  "rotationState",
  "scopes",
  "storageBoundary"
]);
const TOP_LEVEL_FIELDS = Object.freeze([
  "items",
  "mode",
  "schema"
]);

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
    name: "stripe.provisioner.production.restricted",
    kind: "provider_api_restricted",
    purpose: "stripe_ephemeral_provisioning_status",
    scopes: [
      "billing_portal_configurations:write",
      "coupons:write",
      "prices:write",
      "products:write",
      "tax_registrations:write",
      "tax_settings:write",
      "webhook_endpoints:write"
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
      "checkout:create",
      "checkout:read",
      "prices:read",
      "webhook_endpoints:read"
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
  const scopes = exactArray(
    value.scopes,
    expected.scopes,
    "CREDENTIAL_TOPOLOGY_SCOPE_MISMATCH"
  );
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

  return deepFreeze({
    evidenceDigest: selectedDigest,
    kind: value.kind,
    lastProvenAt: selectedInstant,
    materialPresent: value.materialPresent,
    name: value.name,
    purpose: value.purpose,
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
        "control.stripe.webhook.rotation",
        "stripe.webhook.production.current",
        "stripe.webhook.production.prior"
      ],
      blocker: "stripe_webhook_independent_evidence_not_proven"
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

export const CREDENTIAL_TOPOLOGY_CONTRACT = deepFreeze({
  schema: CREDENTIAL_TOPOLOGY_SCHEMA,
  jsonSchemaId: CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID,
  mode: MODE,
  effectsAllowed: false,
  itemCount: DEFINITIONS.length,
  names: DEFINITIONS.map((entry) => entry.name)
});
