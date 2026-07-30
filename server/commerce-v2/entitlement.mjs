import {
  ENTITLEMENT_SCHEMA,
  OFFER_DEFINITIONS
} from "./constants.mjs";
import {
  deepFreeze,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

function hiddenUnavailable() {
  invariant(
    false,
    "entitlement_unavailable",
    "the project entitlement is unavailable",
    { status: 404 }
  );
}

export function authorizeProjectEntitlement(
  entitlement,
  request
) {
  const tenantId = requiredText(
    request?.tenantId,
    "tenantId"
  );
  const customerId = requiredText(
    request?.customerId,
    "customerId"
  );
  const projectId = requiredText(
    request?.projectId,
    "projectId"
  );
  const versionId = requiredText(
    request?.versionId,
    "versionId"
  );
  const versionProjectId = requiredText(
    request?.versionProjectId,
    "versionProjectId"
  );
  const action = requiredText(
    request?.action,
    "action",
    100
  );
  if (
    !entitlement ||
    entitlement.schema !== ENTITLEMENT_SCHEMA ||
    entitlement.tenantId !== tenantId ||
    entitlement.customerId !== customerId ||
    entitlement.projectId !== projectId ||
    versionProjectId !== projectId
  ) {
    hiddenUnavailable();
  }
  const definition =
    OFFER_DEFINITIONS[entitlement.kind];
  if (
    !definition ||
    definition.entitlement.kind !== entitlement.kind ||
    entitlement.scope !== "editor_project" ||
    entitlement.state !== "active" ||
    !definition.entitlement.grants.includes(action)
  ) {
    hiddenUnavailable();
  }
  requiredText(
    entitlement.entitlementId,
    "entitlement.entitlementId"
  );
  requiredIso(
    entitlement.activatedAt,
    "entitlement.activatedAt"
  );
  requiredDigest(
    entitlement.acceptedDisclosureDigest,
    "entitlement.acceptedDisclosureDigest"
  );
  if (definition.entitlement.expires) {
    const now = requiredIso(request?.now, "now");
    const expiresAt = requiredIso(
      entitlement.expiresAt,
      "entitlement.expiresAt"
    );
    if (Date.parse(expiresAt) <= Date.parse(now)) {
      hiddenUnavailable();
    }
  } else {
    invariant(
      entitlement.expiresAt === null,
      "invalid_entitlement",
      "a non-expiring entitlement cannot have an expiry",
      { status: 500 }
    );
  }
  return deepFreeze({
    authorized: true,
    entitlementId: entitlement.entitlementId,
    entitlementKind: entitlement.kind,
    projectId,
    versionId,
    action,
    consumed: false
  });
}
