import {
  createHeldHostedEngagementBootstrap,
  createHostedEngagementBootstrap
} from "./engagement-bootstrap.mjs";
import {
  createPostgresEngagementBootstrapRepository
} from "./engagement-bootstrap-postgres.mjs";

function configurationError() {
  const error = new Error(
    "Production customer engagement composition is invalid."
  );
  error.name = "EngagementProductionConfigurationError";
  error.code = "ENGAGEMENT_PRODUCTION_CONFIGURATION_INVALID";
  return error;
}

export function createProductionEngagementBootstrap({
  authority,
  legalAuthority,
  identityPepperConfiguration,
  tokenSecret
} = {}) {
  if (legalAuthority === null || legalAuthority === undefined) {
    return createHeldHostedEngagementBootstrap();
  }
  if (
    !authority ||
    typeof authority.service !== "function" ||
    !identityPepperConfiguration ||
    typeof identityPepperConfiguration.compose !== "function" ||
    !Buffer.isBuffer(tokenSecret) ||
    tokenSecret.byteLength < 32
  ) {
    throw configurationError();
  }
  const repository = identityPepperConfiguration.compose(
    createPostgresEngagementBootstrapRepository,
    { authority, legalAuthority }
  );
  return createHostedEngagementBootstrap({
    repository,
    legalAuthority,
    tokenSecret
  });
}

export async function assertProductionEngagementReady({
  legalAuthority,
  engagementBootstrap
} = {}) {
  if (
    !engagementBootstrap ||
    typeof engagementBootstrap.readiness !== "function"
  ) {
    throw configurationError();
  }
  const readiness = await engagementBootstrap.readiness();
  if (
    legalAuthority !== null &&
    legalAuthority !== undefined &&
    !(
      readiness?.state === "ready" &&
      readiness.providerEffects === false
    )
  ) {
    throw configurationError();
  }
  return readiness;
}
