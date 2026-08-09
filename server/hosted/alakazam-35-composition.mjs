import {
  createAlakazam35Service
} from "../commerce-v2/alakazam-35.mjs";
import {
  createHostedAlakazam35
} from "../commerce-v2/hosted-alakazam-35.mjs";
import {
  createPostgresAlakazam35Repository
} from "./alakazam-35-postgres.mjs";

export function createAlakazam35Composition({
  authority,
  resolveSession,
  clock,
  repository = null
} = {}) {
  const selectedRepository =
    repository ?? createPostgresAlakazam35Repository({ authority });
  const controls = createAlakazam35Service({
    repository: selectedRepository,
    clock
  });
  return createHostedAlakazam35({ controls, resolveSession });
}
