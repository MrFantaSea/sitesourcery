import {
  ALAKAZAM_CATALOG_VERSION,
  authorizeAlakazamCapability,
  resolveAlakazamTier
} from "./alakazam.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_EFFECTIVE_POLICY_SCHEMA =
  "sitesourcery.alakazam-effective-policy/v1";
export const ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA =
  "sitesourcery.alakazam-fulfillment-authority/v1";
export const ALAKAZAM_FULFILLMENT_DECISION_SCHEMA =
  "sitesourcery.alakazam-fulfillment-decision/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+sitesourcery\.me$/u;

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function nullableIso(value, field) {
  return value === null
    ? null
    : requiredIso(value, field);
}

function exactSubscription(value) {
  exactKeys(
    value,
    [
      "cancelAtPeriodEnd",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "customerId",
      "graceEndsAt",
      "projectId",
      "revision",
      "scheduledEffectiveAt",
      "scheduledTierId",
      "status",
      "subscriptionId",
      "tenantId",
      "tierId"
    ],
    "subscription"
  );
  invariant(
    typeof value.cancelAtPeriodEnd === "boolean",
    "invalid_input",
    "subscription.cancelAtPeriodEnd is invalid"
  );
  const scheduledTierId =
    value.scheduledTierId === null
      ? null
      : requiredText(
          value.scheduledTierId,
          "subscription.scheduledTierId",
          100
        );
  const scheduledEffectiveAt = nullableIso(
    value.scheduledEffectiveAt,
    "subscription.scheduledEffectiveAt"
  );
  invariant(
    (scheduledTierId === null) ===
      (scheduledEffectiveAt === null),
    "invalid_input",
    "the scheduled Alakazam tier is incomplete"
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "subscription.tenantId"),
    customerId: exactUuid(
      value.customerId,
      "subscription.customerId"
    ),
    projectId: exactUuid(
      value.projectId,
      "subscription.projectId"
    ),
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscription.subscriptionId"
    ),
    tierId: requiredText(
      value.tierId,
      "subscription.tierId",
      100
    ),
    status: requiredText(
      value.status,
      "subscription.status",
      50
    ),
    revision: positiveInteger(
      value.revision,
      "subscription.revision"
    ),
    currentPeriodStartsAt: requiredIso(
      value.currentPeriodStartsAt,
      "subscription.currentPeriodStartsAt"
    ),
    currentPeriodEndsAt: requiredIso(
      value.currentPeriodEndsAt,
      "subscription.currentPeriodEndsAt"
    ),
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    graceEndsAt: nullableIso(
      value.graceEndsAt,
      "subscription.graceEndsAt"
    ),
    scheduledTierId,
    scheduledEffectiveAt
  });
}

function exactAuthority(value) {
  exactKeys(
    value,
    [
      "authorizedAt",
      "customerId",
      "policy",
      "policyDigest",
      "projectId",
      "schema",
      "subscriptionId",
      "subscriptionRevision",
      "tenantId"
    ],
    "authority"
  );
  exactKeys(
    value.policy,
    [
      "capabilities",
      "catalogVersion",
      "limits",
      "schema",
      "tierId"
    ],
    "authority.policy"
  );
  invariant(
    value.schema ===
      ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA &&
      value.policy.schema ===
        ALAKAZAM_EFFECTIVE_POLICY_SCHEMA &&
      value.policy.catalogVersion ===
        ALAKAZAM_CATALOG_VERSION &&
      Array.isArray(value.policy.capabilities) &&
      value.policy.capabilities.every(
        (capability) =>
          typeof capability === "string" &&
          capability.length > 0
      ) &&
      value.policy.limits &&
      typeof value.policy.limits === "object" &&
      !Array.isArray(value.policy.limits) &&
      requiredDigest(
        value.policyDigest,
        "authority.policyDigest"
      ) === digest(value.policy),
    "alakazam_fulfillment_authority_invalid",
    "the Alakazam fulfillment authority changed",
    { status: 409 }
  );
  const tier = resolveAlakazamTier(value.policy.tierId);
  invariant(
    digest({
      schema: ALAKAZAM_EFFECTIVE_POLICY_SCHEMA,
      catalogVersion: ALAKAZAM_CATALOG_VERSION,
      tierId: tier.tierId,
      capabilities: tier.capabilities,
      limits: tier.limits
    }) === value.policyDigest,
    "alakazam_fulfillment_authority_invalid",
    "the Alakazam effective policy is not canonical",
    { status: 409 }
  );
  return Object.freeze({
    schema: value.schema,
    tenantId: exactUuid(value.tenantId, "authority.tenantId"),
    customerId: exactUuid(
      value.customerId,
      "authority.customerId"
    ),
    projectId: exactUuid(value.projectId, "authority.projectId"),
    subscriptionId: exactUuid(
      value.subscriptionId,
      "authority.subscriptionId"
    ),
    subscriptionRevision: positiveInteger(
      value.subscriptionRevision,
      "authority.subscriptionRevision"
    ),
    policy: clone(value.policy),
    policyDigest: value.policyDigest,
    authorizedAt: requiredIso(
      value.authorizedAt,
      "authority.authorizedAt"
    )
  });
}

export function createAlakazamFulfillmentAuthority({
  tenantId,
  customerId,
  projectId,
  subscription,
  expectedSubscriptionRevision,
  now
}) {
  const selected = exactSubscription(subscription);
  const scope = {
    tenantId: exactUuid(tenantId, "tenantId"),
    customerId: exactUuid(customerId, "customerId"),
    projectId: exactUuid(projectId, "projectId")
  };
  const expectedRevision = positiveInteger(
    expectedSubscriptionRevision,
    "expectedSubscriptionRevision"
  );
  const authorizedAt = requiredIso(now, "now");
  invariant(
    selected.tenantId === scope.tenantId &&
      selected.customerId === scope.customerId &&
      selected.projectId === scope.projectId,
    "alakazam_fulfillment_scope_changed",
    "the Alakazam subscription is not bound to this customer project",
    { status: 409 }
  );
  invariant(
    selected.revision === expectedRevision,
    "alakazam_fulfillment_revision_changed",
    "the Alakazam subscription changed; refresh before retrying",
    { status: 409 }
  );
  const entitlement = authorizeAlakazamCapability(
    selected,
    {
      capability: "host_at_sitesourcery_me",
      now: authorizedAt
    }
  );
  const tier = resolveAlakazamTier(entitlement.tierId);
  const policy = {
    schema: ALAKAZAM_EFFECTIVE_POLICY_SCHEMA,
    catalogVersion: ALAKAZAM_CATALOG_VERSION,
    tierId: tier.tierId,
    capabilities: clone(tier.capabilities),
    limits: clone(tier.limits)
  };
  return deepFreeze({
    schema: ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA,
    ...scope,
    subscriptionId: selected.subscriptionId,
    subscriptionRevision: selected.revision,
    policy,
    policyDigest: digest(policy),
    authorizedAt
  });
}

export function createAlakazamFulfillmentDecision({
  operationId,
  authority,
  capability,
  sourceVersion,
  publicationArtifact,
  address,
  servingRevision,
  now
}) {
  const selectedAuthority = exactAuthority(authority);
  const selectedCapability = requiredText(
    capability,
    "capability",
    100
  );
  invariant(
    selectedAuthority.policy.capabilities.includes(
      selectedCapability
    ),
    "alakazam_capability_unavailable",
    "the active Alakazam tier does not include that capability",
    { status: 404 }
  );
  exactKeys(
    sourceVersion,
    [
      "artifactDigest",
      "compilerRevision",
      "compilerSchema",
      "state",
      "versionId"
    ],
    "sourceVersion"
  );
  const sourceArtifactDigest = requiredDigest(
    sourceVersion.artifactDigest,
    "sourceVersion.artifactDigest"
  );
  invariant(
    sourceVersion.state === "accepted_release",
    "alakazam_fulfillment_version_unavailable",
    "the exact accepted source version is unavailable",
    { status: 409 }
  );
  exactKeys(
    publicationArtifact,
    [
      "artifactDigest",
      "compilerRevision",
      "compilerSchema",
      "policyDigest",
      "screeningArtifactDigest",
      "screeningId",
      "screeningPassed",
      "screeningStage"
    ],
    "publicationArtifact"
  );
  const publicationArtifactDigest = requiredDigest(
    publicationArtifact.artifactDigest,
    "publicationArtifact.artifactDigest"
  );
  invariant(
    requiredDigest(
      publicationArtifact.policyDigest,
      "publicationArtifact.policyDigest"
    ) === selectedAuthority.policyDigest &&
      publicationArtifact.screeningStage ===
        "pre_publication" &&
      publicationArtifact.screeningPassed === true &&
      requiredDigest(
        publicationArtifact.screeningArtifactDigest,
        "publicationArtifact.screeningArtifactDigest"
      ) === publicationArtifactDigest,
    "alakazam_fulfillment_version_unavailable",
    "the policy-derived publication artifact has not passed exact screening",
    { status: 409 }
  );
  exactKeys(
    address,
    ["addressId", "hostname", "kind", "projectId", "state", "tenantId"],
    "address"
  );
  const hostname = requiredText(
    address.hostname,
    "address.hostname",
    253
  ).toLowerCase();
  invariant(
    address.kind === "licensed" &&
      address.state === "configured" &&
      exactUuid(address.tenantId, "address.tenantId") ===
        selectedAuthority.tenantId &&
      exactUuid(address.projectId, "address.projectId") ===
        selectedAuthority.projectId &&
      HOSTNAME.test(hostname),
    "alakazam_fulfillment_address_unavailable",
    "the configured Site Sourcery address is unavailable",
    { status: 409 }
  );
  const decidedAt = requiredIso(now, "now");
  invariant(
    Date.parse(decidedAt) >=
      Date.parse(selectedAuthority.authorizedAt),
    "invalid_input",
    "the fulfillment decision predates its authority"
  );
  const decision = {
    schema: ALAKAZAM_FULFILLMENT_DECISION_SCHEMA,
    operationId: exactUuid(operationId, "operationId"),
    tenantId: selectedAuthority.tenantId,
    customerId: selectedAuthority.customerId,
    projectId: selectedAuthority.projectId,
    subscriptionId: selectedAuthority.subscriptionId,
    subscriptionRevision:
      selectedAuthority.subscriptionRevision,
    authorizedAt: selectedAuthority.authorizedAt,
    capability: selectedCapability,
    policy: clone(selectedAuthority.policy),
    policyDigest: selectedAuthority.policyDigest,
    sourceVersion: {
      versionId: exactUuid(
        sourceVersion.versionId,
        "sourceVersion.versionId"
      ),
      state: "accepted_release",
      artifactDigest: sourceArtifactDigest,
      compilerSchema: requiredText(
        sourceVersion.compilerSchema,
        "sourceVersion.compilerSchema",
        100
      ),
      compilerRevision: requiredText(
        sourceVersion.compilerRevision,
        "sourceVersion.compilerRevision",
        200
      )
    },
    publicationArtifact: {
      artifactDigest: publicationArtifactDigest,
      compilerSchema: requiredText(
        publicationArtifact.compilerSchema,
        "publicationArtifact.compilerSchema",
        100
      ),
      compilerRevision: requiredText(
        publicationArtifact.compilerRevision,
        "publicationArtifact.compilerRevision",
        200
      ),
      policyDigest: selectedAuthority.policyDigest,
      screeningId: exactUuid(
        publicationArtifact.screeningId,
        "publicationArtifact.screeningId"
      )
    },
    address: {
      addressId: exactUuid(address.addressId, "address.addressId"),
      kind: "licensed",
      state: "configured",
      hostname
    },
    servingRevision: nonnegativeInteger(
      servingRevision,
      "servingRevision"
    ),
    decidedAt
  };
  return verifyAlakazamFulfillmentDecision({
    ...decision,
    decisionDigest: digest(decision)
  });
}

export function verifyAlakazamFulfillmentDecision(value) {
  exactKeys(
    value,
    [
      "address",
      "authorizedAt",
      "capability",
      "customerId",
      "decidedAt",
      "decisionDigest",
      "operationId",
      "policy",
      "policyDigest",
      "publicationArtifact",
      "projectId",
      "schema",
      "servingRevision",
      "sourceVersion",
      "subscriptionId",
      "subscriptionRevision",
      "tenantId"
    ],
    "decision"
  );
  invariant(
    value.schema === ALAKAZAM_FULFILLMENT_DECISION_SCHEMA,
    "alakazam_fulfillment_decision_invalid",
    "the Alakazam fulfillment decision changed",
    { status: 409 }
  );
  const authority = exactAuthority({
    schema: ALAKAZAM_FULFILLMENT_AUTHORITY_SCHEMA,
    tenantId: value.tenantId,
    customerId: value.customerId,
    projectId: value.projectId,
    subscriptionId: value.subscriptionId,
    subscriptionRevision: value.subscriptionRevision,
    policy: value.policy,
    policyDigest: value.policyDigest,
    authorizedAt: value.authorizedAt
  });
  const capability = requiredText(
    value.capability,
    "decision.capability",
    100
  );
  invariant(
    authority.policy.capabilities.includes(capability),
    "alakazam_capability_unavailable",
    "the active Alakazam tier does not include that capability",
    { status: 404 }
  );
  exactKeys(
    value.sourceVersion,
    [
      "artifactDigest",
      "compilerRevision",
      "compilerSchema",
      "state",
      "versionId"
    ],
    "decision.sourceVersion"
  );
  invariant(
    value.sourceVersion.state === "accepted_release",
    "alakazam_fulfillment_version_unavailable",
    "the exact accepted source version is unavailable",
    { status: 409 }
  );
  const sourceVersion = {
    versionId: exactUuid(
      value.sourceVersion.versionId,
      "decision.sourceVersion.versionId"
    ),
    state: "accepted_release",
    artifactDigest: requiredDigest(
      value.sourceVersion.artifactDigest,
      "decision.sourceVersion.artifactDigest"
    ),
    compilerSchema: requiredText(
      value.sourceVersion.compilerSchema,
      "decision.sourceVersion.compilerSchema",
      100
    ),
    compilerRevision: requiredText(
      value.sourceVersion.compilerRevision,
      "decision.sourceVersion.compilerRevision",
      200
    )
  };
  exactKeys(
    value.publicationArtifact,
    [
      "artifactDigest",
      "compilerRevision",
      "compilerSchema",
      "policyDigest",
      "screeningId"
    ],
    "decision.publicationArtifact"
  );
  const publicationArtifact = {
    artifactDigest: requiredDigest(
      value.publicationArtifact.artifactDigest,
      "decision.publicationArtifact.artifactDigest"
    ),
    compilerSchema: requiredText(
      value.publicationArtifact.compilerSchema,
      "decision.publicationArtifact.compilerSchema",
      100
    ),
    compilerRevision: requiredText(
      value.publicationArtifact.compilerRevision,
      "decision.publicationArtifact.compilerRevision",
      200
    ),
    policyDigest: requiredDigest(
      value.publicationArtifact.policyDigest,
      "decision.publicationArtifact.policyDigest"
    ),
    screeningId: exactUuid(
      value.publicationArtifact.screeningId,
      "decision.publicationArtifact.screeningId"
    )
  };
  invariant(
    publicationArtifact.policyDigest === authority.policyDigest,
    "alakazam_fulfillment_decision_invalid",
    "the publication artifact policy changed",
    { status: 409 }
  );
  exactKeys(
    value.address,
    ["addressId", "hostname", "kind", "state"],
    "decision.address"
  );
  const hostname = requiredText(
    value.address.hostname,
    "decision.address.hostname",
    253
  ).toLowerCase();
  invariant(
    value.address.kind === "licensed" &&
      value.address.state === "configured" &&
      HOSTNAME.test(hostname),
    "alakazam_fulfillment_address_unavailable",
    "the configured Site Sourcery address is unavailable",
    { status: 409 }
  );
  const decidedAt = requiredIso(
    value.decidedAt,
    "decision.decidedAt"
  );
  invariant(
    Date.parse(decidedAt) >= Date.parse(authority.authorizedAt),
    "alakazam_fulfillment_decision_invalid",
    "the fulfillment decision predates its authority",
    { status: 409 }
  );
  const decision = {
    schema: ALAKAZAM_FULFILLMENT_DECISION_SCHEMA,
    operationId: exactUuid(
      value.operationId,
      "decision.operationId"
    ),
    tenantId: authority.tenantId,
    customerId: authority.customerId,
    projectId: authority.projectId,
    subscriptionId: authority.subscriptionId,
    subscriptionRevision: authority.subscriptionRevision,
    authorizedAt: authority.authorizedAt,
    capability,
    policy: clone(authority.policy),
    policyDigest: authority.policyDigest,
    sourceVersion,
    publicationArtifact,
    address: {
      addressId: exactUuid(
        value.address.addressId,
        "decision.address.addressId"
      ),
      kind: "licensed",
      state: "configured",
      hostname
    },
    servingRevision: nonnegativeInteger(
      value.servingRevision,
      "decision.servingRevision"
    ),
    decidedAt
  };
  invariant(
    requiredDigest(
      value.decisionDigest,
      "decision.decisionDigest"
    ) === digest(decision),
    "alakazam_fulfillment_decision_invalid",
    "the Alakazam fulfillment decision changed",
    { status: 409 }
  );
  return deepFreeze({
    ...decision,
    decisionDigest: value.decisionDigest
  });
}
