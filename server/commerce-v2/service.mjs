import {
  CATALOG_VERSION,
  CHECKOUT_COMMAND_SCHEMA,
  CHECKOUT_PURPOSE_SCHEMA,
  PURCHASE_ACCEPTANCE_SCHEMA,
  PURCHASE_ACCEPTANCE_STATEMENT,
  QUOTE_DISCLOSURE_SCHEMA,
  QUOTE_SNAPSHOT_SCHEMA,
  QUOTE_TTL_MS,
  TERMS_VERSION
} from "./constants.mjs";
import { resolveHeldOffer } from "./catalog.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

function validatePorts(ports) {
  for (const [name, methods] of Object.entries({
    projects: ["resolveEditorProject"],
    versions: ["resolveAcceptedVersion"],
    repository: [
      "claimCommand",
      "abandonCommand",
      "findQuote",
      "commitQuoteCommand",
      "commitCheckoutCommand"
    ],
    clock: ["now"],
    ids: ["next"]
  })) {
    invariant(
      ports?.[name] &&
        methods.every(
          (method) =>
            typeof ports[name][method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return ports;
}

function identity(input) {
  return {
    tenantId: requiredText(input?.tenantId, "tenantId"),
    customerId: requiredText(
      input?.customerId,
      "customerId"
    ),
    actorId: requiredText(input?.actorId, "actorId")
  };
}

function commandRecord({
  tenantId,
  customerId,
  actorId,
  projectId,
  commandId,
  operation,
  purpose
}) {
  return {
    tenantId,
    customerId,
    actorId,
    projectId,
    commandId: requiredText(commandId, "commandId"),
    operation,
    fingerprint: digest(purpose)
  };
}

async function runIdempotent(
  repository,
  command,
  commitMethod,
  work
) {
  const claim = await repository.claimCommand(command);
  invariant(
    claim?.status !== "conflict",
    "idempotency_conflict",
    "the command ID was already used for another purpose",
    { status: 409 }
  );
  invariant(
    claim?.status !== "pending",
    "command_in_progress",
    "the command outcome is still pending",
    { status: 409 }
  );
  if (claim?.status === "replay") {
    return deepFreeze(clone(claim.result));
  }
  invariant(
    claim?.status === "claimed",
    "repository_conflict",
    "the repository returned an invalid claim state",
    { status: 500 }
  );
  try {
    const result = await work();
    await repository[commitMethod](command, result);
    return deepFreeze(clone(result));
  } catch (error) {
    await repository.abandonCommand(command);
    throw error;
  }
}

function validateProject(
  project,
  { tenantId, customerId, projectId }
) {
  invariant(
    project &&
      project.tenantId === tenantId &&
      project.customerId === customerId &&
      project.projectId === projectId &&
      project.kind === "editor_project" &&
      project.purchaseEligible === true,
    "project_unavailable",
    "the editor project is unavailable",
    { status: 404 }
  );
  return {
    projectId,
    kind: "editor_project"
  };
}

function validateVersion(version, { projectId, versionId }) {
  invariant(
    version &&
      version.projectId === projectId &&
      version.versionId === versionId &&
      version.state === "accepted",
    "version_unavailable",
    "the accepted project version is unavailable",
    { status: 404 }
  );
  return {
    versionId,
    state: "accepted",
    contentDigest: requiredDigest(
      version.contentDigest,
      "version.contentDigest"
    )
  };
}

function quoteSnapshotWithoutDigest(quote) {
  const snapshot = clone(quote);
  delete snapshot.snapshotDigest;
  return snapshot;
}

export function digestQuoteSnapshot(quote) {
  invariant(
    quote?.schema === QUOTE_SNAPSHOT_SCHEMA,
    "invalid_quote",
    "the quote snapshot schema is invalid",
    { status: 500 }
  );
  return digest(quoteSnapshotWithoutDigest(quote));
}

function validateStoredQuote(
  quote,
  {
    tenantId,
    customerId,
    projectId,
    now,
    acceptedDisclosureDigest
  }
) {
  invariant(
    quote &&
      quote.schema === QUOTE_SNAPSHOT_SCHEMA &&
      quote.tenantId === tenantId &&
      quote.customerId === customerId &&
      quote.project.projectId === projectId,
    "quote_unavailable",
    "the quote is unavailable",
    { status: 404 }
  );
  invariant(
    quote.state === "held" &&
      quote.dispatchAuthorized === false,
    "quote_unavailable",
    "the quote is not a held v2 quote",
    { status: 409 }
  );
  requiredIso(quote.expiresAt, "quote.expiresAt");
  invariant(
    Date.parse(quote.expiresAt) > Date.parse(now),
    "quote_expired",
    "the quote has expired",
    { status: 409 }
  );
  requiredDigest(
    acceptedDisclosureDigest,
    "acceptedDisclosureDigest"
  );
  invariant(
    acceptedDisclosureDigest === quote.disclosureDigest,
    "disclosure_mismatch",
    "the accepted disclosure does not match the quote",
    { status: 409 }
  );
  invariant(
    digest(quote.disclosure) === quote.disclosureDigest &&
      digestQuoteSnapshot(quote) === quote.snapshotDigest,
    "quote_integrity_failure",
    "the stored quote snapshot failed its digest",
    { status: 500 }
  );
  return quote;
}

export function createCommerceV2Service(
  inputPorts,
  { quoteTtlMs = QUOTE_TTL_MS } = {}
) {
  const ports = validatePorts(inputPorts);
  invariant(
    Number.isSafeInteger(quoteTtlMs) && quoteTtlMs > 0,
    "invalid_configuration",
    "quote TTL is invalid",
    { status: 500 }
  );

  return Object.freeze({
    async createQuote(input) {
      const actor = identity(input);
      const projectId = requiredText(
        input?.projectId,
        "projectId"
      );
      const versionId = requiredText(
        input?.versionId,
        "versionId"
      );
      const offer = resolveHeldOffer(input?.offerId);
      const purpose = {
        operation: "create_v2_quote",
        ...actor,
        projectId,
        versionId,
        offerId: offer.offerId
      };
      const command = commandRecord({
        tenantId: actor.tenantId,
        customerId: actor.customerId,
        actorId: actor.actorId,
        projectId,
        commandId: input?.commandId,
        operation: "create_v2_quote",
        purpose
      });

      return runIdempotent(
        ports.repository,
        command,
        "commitQuoteCommand",
        async () => {
          const now = requiredIso(
            ports.clock.now(),
            "clock.now"
          );
          const project = validateProject(
            await ports.projects.resolveEditorProject({
              tenantId: actor.tenantId,
              customerId: actor.customerId,
              projectId
            }),
            {
              tenantId: actor.tenantId,
              customerId: actor.customerId,
              projectId
            }
          );
          const version = validateVersion(
            await ports.versions.resolveAcceptedVersion({
              tenantId: actor.tenantId,
              customerId: actor.customerId,
              projectId,
              versionId
            }),
            { projectId, versionId }
          );
          const expiresAt = new Date(
            Date.parse(now) + quoteTtlMs
          ).toISOString();
          const disclosure = deepFreeze({
            schema: QUOTE_DISCLOSURE_SCHEMA,
            catalogVersion: CATALOG_VERSION,
            termsVersion: TERMS_VERSION,
            offer: {
              offerId: offer.offerId,
              name: offer.name,
              summary: offer.summary,
              commercialStatus: offer.commercialStatus
            },
            project: {
              projectId: project.projectId,
              versionId: version.versionId,
              versionContentDigest: version.contentDigest
            },
            price: clone(offer.price),
            entitlement: clone(offer.entitlement),
            terms: clone(offer.disclosure),
            release: clone(offer.effects)
          });
          const disclosureDigest = digest(disclosure);
          const snapshot = {
            schema: QUOTE_SNAPSHOT_SCHEMA,
            quoteId: requiredText(
              ports.ids.next("commerce_v2_quote"),
              "quoteId"
            ),
            tenantId: actor.tenantId,
            customerId: actor.customerId,
            actorId: actor.actorId,
            catalogVersion: CATALOG_VERSION,
            termsVersion: TERMS_VERSION,
            state: "held",
            dispatchAuthorized: false,
            project,
            version,
            offerId: offer.offerId,
            entitlementKind: offer.entitlement.kind,
            price: clone(offer.price),
            issuedAt: now,
            expiresAt,
            disclosure,
            disclosureDigest
          };
          const quote = deepFreeze({
            ...snapshot,
            snapshotDigest: digest(snapshot)
          });
          return quote;
        }
      );
    },

    async prepareCheckout(input) {
      const actor = identity(input);
      const projectId = requiredText(
        input?.projectId,
        "projectId"
      );
      const quoteId = requiredText(
        input?.quoteId,
        "quoteId"
      );
      const acceptedDisclosureDigest = requiredDigest(
        input?.acceptedDisclosureDigest,
        "acceptedDisclosureDigest"
      );
      invariant(
        input?.purchaseTermsAccepted === true,
        "purchase_terms_not_accepted",
        "Accept the exact Download delivery, final-sale, and credit terms before continuing."
      );
      const acceptanceRequestId = requiredText(
        input?.requestId,
        "requestId"
      );
      const acceptanceClientAddress = requiredText(
        input?.clientAddress,
        "clientAddress",
        80
      );
      const acceptanceUserAgentDigest = requiredDigest(
        input?.userAgentDigest,
        "userAgentDigest"
      );
      const now = requiredIso(
        ports.clock.now(),
        "clock.now"
      );
      const quote = validateStoredQuote(
        await ports.repository.findQuote({
          tenantId: actor.tenantId,
          customerId: actor.customerId,
          projectId,
          quoteId
        }),
        {
          tenantId: actor.tenantId,
          customerId: actor.customerId,
          projectId,
          now,
          acceptedDisclosureDigest
        }
      );
      const purpose = deepFreeze({
        schema: CHECKOUT_PURPOSE_SCHEMA,
        tenantId: actor.tenantId,
        customerId: actor.customerId,
        projectId,
        versionId: quote.version.versionId,
        quoteId,
        quoteSnapshotDigest: quote.snapshotDigest,
        acceptedDisclosureDigest,
        offerId: quote.offerId,
        entitlementKind: quote.entitlementKind,
        purchaseTermsAccepted: true,
        price: clone(quote.price)
      });
      const purposeDigest = digest(purpose);
      const command = commandRecord({
        tenantId: actor.tenantId,
        customerId: actor.customerId,
        actorId: actor.actorId,
        projectId,
        commandId: input?.commandId,
        operation: "prepare_v2_checkout",
        purpose
      });

      return runIdempotent(
        ports.repository,
        command,
        "commitCheckoutCommand",
        async () => {
          const acceptance = deepFreeze({
            schema: PURCHASE_ACCEPTANCE_SCHEMA,
            statement: PURCHASE_ACCEPTANCE_STATEMENT,
            acceptedAt: now,
            requestId: acceptanceRequestId,
            clientAddress: acceptanceClientAddress,
            userAgentDigest: acceptanceUserAgentDigest,
            acceptedDisclosureDigest,
            termsVersion: quote.termsVersion
          });
          const preparation = deepFreeze({
            schema: CHECKOUT_COMMAND_SCHEMA,
            commandId: command.commandId,
            quoteId,
            projectId,
            versionId: quote.version.versionId,
            offerId: quote.offerId,
            entitlementKind: quote.entitlementKind,
            state: "held",
            holdReason: "provider_dispatch_not_authorized",
            dispatchAuthorized: false,
            provider: null,
            preparedAt: now,
            acceptance,
            purpose,
            purposeDigest
          });
          return preparation;
        }
      );
    }
  });
}
