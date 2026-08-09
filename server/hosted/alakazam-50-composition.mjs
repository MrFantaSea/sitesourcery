import {
  createAlakazam50Service
} from "../commerce-v2/alakazam-50.mjs";
import {
  createHostedAlakazam50
} from "../commerce-v2/hosted-alakazam-50.mjs";
import {
  createPostgresAlakazam50Repository
} from "./alakazam-50-postgres.mjs";

export function createAlakazam50Composition({
  authority,
  resolveSession,
  clock,
  repository = null
} = {}) {
  const selectedRepository =
    repository ?? createPostgresAlakazam50Repository({ authority });
  const controls = createAlakazam50Service({
    repository: selectedRepository,
    clock
  });
  return createHostedAlakazam50({ controls, resolveSession });
}
