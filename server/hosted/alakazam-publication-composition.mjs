import {
  createAlakazamPublicationService
} from "../commerce-v2/alakazam-publication.mjs";
import {
  createHostedAlakazamPublication
} from "../commerce-v2/hosted-alakazam-publication.mjs";
import {
  createPostgresAlakazamPublicationRepository
} from "./alakazam-publication-postgres.mjs";

export function createAlakazamPublicationComposition({
  authority,
  resolveSession,
  clock
} = {}) {
  const repository =
    createPostgresAlakazamPublicationRepository({
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
