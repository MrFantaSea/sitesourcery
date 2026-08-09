import {
  createAlakazamRetainedPremiumService
} from "../commerce-v2/alakazam-retained-premium.mjs";
import {
  createHostedAlakazamRetainedPremium
} from "../commerce-v2/hosted-alakazam-retained-premium.mjs";
import {
  createPostgresAlakazamRetainedPremiumRepository
} from "./alakazam-retained-premium-postgres.mjs";

export function createAlakazamRetainedPremiumComposition({
  authority,
  resolveSession,
  clock,
  repository = null
} = {}) {
  const selectedRepository = repository ??
    createPostgresAlakazamRetainedPremiumRepository({ authority });
  const controls = createAlakazamRetainedPremiumService({
    repository: selectedRepository,
    clock
  });
  return createHostedAlakazamRetainedPremium({
    controls,
    resolveSession
  });
}
