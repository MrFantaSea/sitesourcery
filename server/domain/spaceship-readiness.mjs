import { pathToFileURL } from "node:url";
import { SPACESHIP_MCP_PREVIEW_SOURCE } from "./adapters/spaceship.mjs";

export const SPACESHIP_REQUIRED_SCOPES = Object.freeze([
  "asyncoperations:read",
  "contacts:read",
  "contacts:write",
  "dnsrecords:read",
  "dnsrecords:write",
  "domains:billing",
  "domains:read",
  "domains:transfer",
  "domains:write"
]);

const CHECKS = Object.freeze([
  ["provider", (value) => value === "spaceship"],
  ["environment", (value) => value === "staging"],
  ["ownerApprovalId", present],
  ["publicationReleaseApprovalId", present],
  ["providerWrittenResaleConsentRef", present],
  ["credentialVaultRef", present],
  ["contactVaultRef", present],
  ["pricePreviewBridgeRef", present],
  [
    "pricePreviewSource",
    (value) => value === SPACESHIP_MCP_PREVIEW_SOURCE
  ],
  ["domainTermsVersion", present],
  ["privacyTermsVersion", present],
  ["registrantDisclosureVersion", present]
]);

export function assessSpaceshipStagingReadiness(input = {}) {
  const missing = [];
  for (const [name, predicate] of CHECKS) {
    if (!predicate(input[name])) missing.push(name);
  }
  const scopes = new Set(
    Array.isArray(input.scopes)
      ? input.scopes.filter((value) => typeof value === "string")
      : []
  );
  const missingScopes = SPACESHIP_REQUIRED_SCOPES.filter(
    (scope) => !scopes.has(scope)
  );
  if (missingScopes.length > 0) missing.push("scopes");

  return Object.freeze({
    ready: missing.length === 0,
    provider: input.provider === "spaceship" ? "spaceship" : "held",
    environment: input.environment ?? "unset",
    pricePreviewSourceReviewed:
      input.pricePreviewSource === SPACESHIP_MCP_PREVIEW_SOURCE,
    writtenSpaceshipResaleConsentRecorded: present(
      input.providerWrittenResaleConsentRef
    ),
    ownerReleaseApprovalRecorded:
      present(input.ownerApprovalId) &&
      present(input.publicationReleaseApprovalId),
    scopes: Object.freeze([...scopes].sort()),
    missingScopes: Object.freeze(missingScopes),
    missing: Object.freeze(missing),
    providerCalls: 0,
    billedMutations: 0,
    dnsMutations: 0,
    credentialsRead: false,
    note:
      "This readiness check is local and declarative. It never reads secret values or calls Spaceship."
  });
}

export function readinessInputFromEnvironment(environment = process.env) {
  return {
    provider: environment.SITESOURCERY_DOMAIN_PROVIDER,
    environment: environment.SITESOURCERY_DOMAIN_ENVIRONMENT,
    ownerApprovalId: environment.SITESOURCERY_SPACESHIP_OWNER_APPROVAL_ID,
    publicationReleaseApprovalId:
      environment.SITESOURCERY_PUBLICATION_RELEASE_APPROVAL_ID,
    providerWrittenResaleConsentRef:
      environment.SITESOURCERY_SPACESHIP_WRITTEN_RESALE_CONSENT_REF,
    credentialVaultRef:
      environment.SITESOURCERY_SPACESHIP_CREDENTIAL_VAULT_REF,
    contactVaultRef: environment.SITESOURCERY_SPACESHIP_CONTACT_VAULT_REF,
    pricePreviewBridgeRef:
      environment.SITESOURCERY_SPACESHIP_PRICE_PREVIEW_BRIDGE_REF,
    pricePreviewSource:
      environment.SITESOURCERY_SPACESHIP_PRICE_PREVIEW_SOURCE,
    domainTermsVersion:
      environment.SITESOURCERY_SPACESHIP_DOMAIN_TERMS_VERSION,
    privacyTermsVersion:
      environment.SITESOURCERY_SPACESHIP_PRIVACY_TERMS_VERSION,
    registrantDisclosureVersion:
      environment.SITESOURCERY_SPACESHIP_REGISTRANT_DISCLOSURE_VERSION,
    scopes: String(environment.SITESOURCERY_SPACESHIP_SCOPES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

function present(value) {
  return typeof value === "string" && value.trim().length >= 4;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const report = assessSpaceshipStagingReadiness(
    readinessInputFromEnvironment(process.env)
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ready ? 0 : 2;
}
