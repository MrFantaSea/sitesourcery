import {
  createAlakazamPublicationService
} from "../commerce-v2/alakazam-publication.mjs";
import {
  createHostedAlakazamPublication
} from "../commerce-v2/hosted-alakazam-publication.mjs";
import {
  createPostgresPublicationControlRepository
} from "./publication-control-postgres.mjs";

export function createPublicationControlComposition({
  authority,
  resolveSession,
  clock
} = {}) {
  const repository = createPostgresPublicationControlRepository({
    authority
  });
  const publication = createAlakazamPublicationService({
    repository,
    clock
  });
  return createHostedAlakazamPublication({
    publication,
    resolveSession
  });
}
