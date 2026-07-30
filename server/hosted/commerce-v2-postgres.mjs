import { randomUUID as systemRandomUUID } from "node:crypto";

import {
  CATALOG_VERSION,
  CHECKOUT_COMMAND_SCHEMA,
  QUOTE_SNAPSHOT_SCHEMA,
  TERMS_VERSION
} from "../commerce-v2/constants.mjs";
import {
  CommerceV2Error,
  clone,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ROLES = Object.freeze([
  "owner",
  "admin",
  "editor"
]);
const OPERATIONS = new Set([
  "create_v2_quote",
  "prepare_v2_checkout"
]);
const DATABASE_CONSTRAINT_CODES = new Set([
  "22001",
  "22P02",
  "23502",
  "23503",
  "23505",
  "23514",
  "42501",
  "55000"
]);

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactOperation(value) {
  const selected = requiredText(
    value,
    "command.operation",
    40
  );
  invariant(
    OPERATIONS.has(selected),
    "invalid_input",
    "command.operation is invalid"
  );
  return selected;
}

function exactCommand(command) {
  return Object.freeze({
    tenantId: exactUuid(
      command?.tenantId,
      "command.tenantId"
    ),
    commandId: requiredText(
      command?.commandId,
      "command.commandId"
    ),
    operation: exactOperation(command?.operation),
    fingerprint: requiredDigest(
      command?.fingerprint,
      "command.fingerprint"
    ),
    projectId: exactUuid(
      command?.projectId,
      "command.projectId"
    ),
    customerId: exactUuid(
      command?.customerId,
      "command.customerId"
    ),
    actorId: exactUuid(
      command?.actorId,
      "command.actorId"
    )
  });
}

function exactClock(clock) {
  const value =
    typeof clock === "function"
      ? clock()
      : clock?.now?.();
  const selected =
    value instanceof Date
      ? value.toISOString()
      : String(value ?? "");
  return requiredIso(selected, "clock.now");
}

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable commerce repository rejected an inconsistent record",
      { status: 500 }
    );
  }
  return error;
}

async function translatedDatabase(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function validateAuthority(authority) {
  invariant(
    authority &&
      typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

async function lockedCommand(client, command) {
  const result = await client.query(
    `select operation, fingerprint, state,
            project_id, customer_user_id, actor_user_id
       from ss.commerce_v2_commands
      where organization_id = $1
        and command_id = $2
      for update`,
    [command.tenantId, command.commandId]
  );
  const row = result.rows[0];
  invariant(
    result.rowCount === 1 &&
      row?.operation === command.operation &&
      row?.fingerprint === command.fingerprint &&
      row?.project_id === command.projectId &&
      row?.customer_user_id === command.customerId &&
      row?.actor_user_id === command.actorId &&
      row?.state === "pending",
    "repository_conflict",
    "the command claim changed before completion",
    { status: 500 }
  );
}

function exactQuote(command, quote) {
  invariant(
    quote?.schema === QUOTE_SNAPSHOT_SCHEMA &&
      quote.tenantId === command.tenantId &&
      quote.customerId === command.customerId &&
      quote.actorId === command.actorId &&
      quote.project?.projectId === command.projectId &&
      quote.catalogVersion === CATALOG_VERSION &&
      quote.termsVersion === TERMS_VERSION &&
      quote.offerId === "spark_download" &&
      quote.entitlementKind === "spark_download" &&
      quote.state === "held" &&
      quote.dispatchAuthorized === false &&
      quote.price?.amountMinor === 500 &&
      quote.price?.currency === "USD" &&
      quote.price?.billing === "one_time" &&
      quote.price?.interval === null &&
      quote.version?.state === "accepted" &&
      quote.disclosure?.catalogVersion ===
        CATALOG_VERSION &&
      quote.disclosure?.termsVersion ===
        TERMS_VERSION &&
      quote.disclosure?.project
        ?.versionContentDigest ===
        quote.version?.contentDigest,
    "repository_conflict",
    "the Download quote is not a held server snapshot",
    { status: 500 }
  );
  return Object.freeze({
    quoteId: exactUuid(quote.quoteId, "quote.quoteId"),
    tenantId: command.tenantId,
    customerId: exactUuid(
      quote.customerId,
      "quote.customerId"
    ),
    actorId: exactUuid(quote.actorId, "quote.actorId"),
    projectId: exactUuid(
      quote.project?.projectId,
      "quote.project.projectId"
    ),
    versionId: exactUuid(
      quote.version?.versionId,
      "quote.version.versionId"
    ),
    catalogVersion: CATALOG_VERSION,
    termsVersion: TERMS_VERSION,
    versionContentDigest: requiredDigest(
      quote.version?.contentDigest,
      "quote.version.contentDigest"
    ),
    issuedAt: requiredIso(
      quote.issuedAt,
      "quote.issuedAt"
    ),
    expiresAt: requiredIso(
      quote.expiresAt,
      "quote.expiresAt"
    ),
    disclosureDigest: requiredDigest(
      quote.disclosureDigest,
      "quote.disclosureDigest"
    ),
    snapshotDigest: requiredDigest(
      quote.snapshotDigest,
      "quote.snapshotDigest"
    ),
    snapshot: JSON.stringify(quote)
  });
}

function exactPreparation(command, preparation) {
  const purpose = preparation?.purpose;
  invariant(
    preparation?.schema === CHECKOUT_COMMAND_SCHEMA &&
      preparation.commandId === command.commandId &&
      preparation.offerId === "spark_download" &&
      preparation.entitlementKind ===
        "spark_download" &&
      preparation.state === "held" &&
      preparation.holdReason ===
        "provider_dispatch_not_authorized" &&
      preparation.dispatchAuthorized === false &&
      preparation.provider === null &&
      purpose?.tenantId === command.tenantId &&
      purpose?.customerId === command.customerId &&
      purpose?.projectId === command.projectId &&
      preparation.projectId === command.projectId &&
      command.customerId === command.actorId &&
      purpose?.offerId === "spark_download" &&
      purpose?.entitlementKind ===
        "spark_download" &&
      purpose?.price?.amountMinor === 500 &&
      purpose?.price?.currency === "USD" &&
      purpose?.price?.billing === "one_time" &&
      purpose?.price?.interval === null,
    "repository_conflict",
    "the checkout preparation is not held and provider-free",
    { status: 500 }
  );
  return Object.freeze({
    commandId: command.commandId,
    tenantId: command.tenantId,
    customerId: exactUuid(
      purpose.customerId,
      "preparation.purpose.customerId"
    ),
    actorId: command.actorId,
    projectId: exactUuid(
      preparation.projectId,
      "preparation.projectId"
    ),
    versionId: exactUuid(
      preparation.versionId,
      "preparation.versionId"
    ),
    quoteId: exactUuid(
      preparation.quoteId,
      "preparation.quoteId"
    ),
    preparedAt: requiredIso(
      preparation.preparedAt,
      "preparation.preparedAt"
    ),
    purposeDigest: requiredDigest(
      preparation.purposeDigest,
      "preparation.purposeDigest"
    ),
    acceptedDisclosureDigest: requiredDigest(
      purpose.acceptedDisclosureDigest,
      "preparation.purpose.acceptedDisclosureDigest"
    ),
    quoteSnapshotDigest: requiredDigest(
      purpose.quoteSnapshotDigest,
      "preparation.purpose.quoteSnapshotDigest"
    ),
    snapshot: JSON.stringify(preparation)
  });
}

export function createPostgresCommerceV2Repository({
  authority
} = {}) {
  const database = validateAuthority(authority);

  return Object.freeze({
    async claimCommand(input) {
      const command = exactCommand(input);
      return translatedDatabase(() =>
        database.service(
          {
            userId: command.actorId,
            organizationId: command.tenantId
          },
          async (client) => {
            const inserted = await client.query(
              `insert into ss.commerce_v2_commands (
                 organization_id, command_id,
                 operation, fingerprint, project_id,
                 customer_user_id, actor_user_id, state
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 'pending'
               )
               on conflict (organization_id, command_id)
               do nothing
               returning command_id`,
              [
                command.tenantId,
                command.commandId,
                command.operation,
                command.fingerprint,
                command.projectId,
                command.customerId,
                command.actorId
              ]
            );
            if (inserted.rowCount === 1) {
              return { status: "claimed" };
            }
            const existing = await client.query(
              `select operation, fingerprint, state, result,
                      project_id, customer_user_id,
                      actor_user_id
                 from ss.commerce_v2_commands
                where organization_id = $1
                  and command_id = $2`,
              [command.tenantId, command.commandId]
            );
            const row = existing.rows[0];
            invariant(
              existing.rowCount === 1,
              "repository_conflict",
              "the durable command disappeared during its claim",
              { status: 500 }
            );
            if (
              row.operation !== command.operation ||
              row.fingerprint !== command.fingerprint ||
              row.project_id !== command.projectId ||
              row.customer_user_id !==
                command.customerId ||
              row.actor_user_id !== command.actorId
            ) {
              return { status: "conflict" };
            }
            if (row.state === "complete") {
              invariant(
                row.result &&
                  typeof row.result === "object",
                "repository_conflict",
                "the completed command has no durable result",
                { status: 500 }
              );
              return {
                status: "replay",
                result: clone(row.result)
              };
            }
            invariant(
              row.state === "pending",
              "repository_conflict",
              "the durable command has an invalid state",
              { status: 500 }
            );
            return { status: "pending" };
          }
        )
      );
    },

    async commitQuoteCommand(input, quote) {
      const command = exactCommand(input);
      const stored = exactQuote(command, quote);
      invariant(
        stored.customerId === stored.actorId &&
          stored.customerId === command.customerId &&
          stored.actorId === command.actorId &&
          stored.projectId === command.projectId,
        "repository_conflict",
        "the Download customer and authenticated actor must match",
        { status: 500 }
      );
      return translatedDatabase(() =>
        database.service(
          {
            userId: stored.actorId,
            organizationId: command.tenantId
          },
          async (client) => {
            await lockedCommand(client, command);
            await client.query(
              `insert into ss.commerce_v2_download_quotes (
                 id, organization_id, command_id,
                 customer_user_id, actor_user_id,
                 project_id, version_id,
                 offer_id, entitlement_kind,
                 amount_minor, currency, billing,
                 state, dispatch_authorized,
                 issued_at, expires_at,
                 catalog_version, terms_version,
                 version_content_digest,
                 disclosure_digest, snapshot_digest,
                 snapshot
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 'spark_download', 'spark_download',
                 500, 'USD', 'one_time',
                 'held', false, $8, $9, $10, $11,
                 $12, $13, $14, $15::jsonb
               )`,
              [
                stored.quoteId,
                stored.tenantId,
                command.commandId,
                stored.customerId,
                stored.actorId,
                stored.projectId,
                stored.versionId,
                stored.issuedAt,
                stored.expiresAt,
                stored.catalogVersion,
                stored.termsVersion,
                stored.versionContentDigest,
                stored.disclosureDigest,
                stored.snapshotDigest,
                stored.snapshot
              ]
            );
            const completed = await client.query(
              `update ss.commerce_v2_commands
                  set state = 'complete',
                      result = $3::jsonb,
                      completed_at = clock_timestamp()
                where organization_id = $1
                  and command_id = $2
                  and operation = $4
                  and fingerprint = $5
                  and project_id = $6
                  and customer_user_id = $7
                  and actor_user_id = $8
                  and state = 'pending'
                returning command_id`,
              [
                command.tenantId,
                command.commandId,
                stored.snapshot,
                command.operation,
                command.fingerprint,
                command.projectId,
                command.customerId,
                command.actorId
              ]
            );
            invariant(
              completed.rowCount === 1,
              "repository_conflict",
              "the quote command did not complete durably",
              { status: 500 }
            );
          }
        )
      );
    },

    async commitCheckoutCommand(input, preparation) {
      const command = exactCommand(input);
      const stored = exactPreparation(
        command,
        preparation
      );
      invariant(
        stored.customerId === command.customerId &&
          stored.projectId === command.projectId,
        "repository_conflict",
        "the checkout preparation scope changed",
        { status: 500 }
      );
      return translatedDatabase(() =>
        database.service(
          {
            userId: stored.customerId,
            organizationId: command.tenantId
          },
          async (client) => {
            await lockedCommand(client, command);
            await client.query(
              `insert into ss.commerce_v2_checkout_preparations (
                 organization_id, command_id, quote_id,
                 customer_user_id, actor_user_id,
                 project_id, version_id,
                 offer_id, entitlement_kind,
                 state, hold_reason, dispatch_authorized,
                 prepared_at, purpose_digest,
                 accepted_disclosure_digest,
                 quote_snapshot_digest, preparation
               ) values (
                 $1, $2, $3, $4, $5, $6, $7,
                 'spark_download', 'spark_download',
                 'held', 'provider_dispatch_not_authorized',
                 false, $8, $9, $10, $11,
                 $12::jsonb
               )`,
              [
                stored.tenantId,
                stored.commandId,
                stored.quoteId,
                stored.customerId,
                stored.actorId,
                stored.projectId,
                stored.versionId,
                stored.preparedAt,
                stored.purposeDigest,
                stored.acceptedDisclosureDigest,
                stored.quoteSnapshotDigest,
                stored.snapshot
              ]
            );
            const completed = await client.query(
              `update ss.commerce_v2_commands
                  set state = 'complete',
                      result = $3::jsonb,
                      completed_at = clock_timestamp()
                where organization_id = $1
                  and command_id = $2
                  and operation = $4
                  and fingerprint = $5
                  and project_id = $6
                  and customer_user_id = $7
                  and actor_user_id = $8
                  and state = 'pending'
                returning command_id`,
              [
                command.tenantId,
                command.commandId,
                stored.snapshot,
                command.operation,
                command.fingerprint,
                command.projectId,
                command.customerId,
                command.actorId
              ]
            );
            invariant(
              completed.rowCount === 1,
              "repository_conflict",
              "the checkout command did not complete durably",
              { status: 500 }
            );
          }
        )
      );
    },

    async abandonCommand(input) {
      const command = exactCommand(input);
      return translatedDatabase(() =>
        database.service(
          {
            userId: command.actorId,
            organizationId: command.tenantId
          },
          async (client) => {
            await client.query(
              `delete from ss.commerce_v2_commands
                where organization_id = $1
                  and command_id = $2
                  and operation = $3
                  and fingerprint = $4
                  and project_id = $5
                  and customer_user_id = $6
                  and actor_user_id = $7
                  and state = 'pending'`,
              [
                command.tenantId,
                command.commandId,
                command.operation,
                command.fingerprint,
                command.projectId,
                command.customerId,
                command.actorId
              ]
            );
          }
        )
      );
    },

    async findQuote(input) {
      if (
        !UUID.test(String(input?.tenantId ?? "")) ||
        !UUID.test(String(input?.customerId ?? "")) ||
        !UUID.test(String(input?.projectId ?? "")) ||
        !UUID.test(String(input?.quoteId ?? ""))
      ) {
        return null;
      }
      const tenantId = input.tenantId;
      const customerId = input.customerId;
      const projectId = input.projectId;
      const quoteId = input.quoteId;
      return translatedDatabase(() =>
        database.service(
          {
            userId: customerId,
            organizationId: tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select snapshot
                 from ss.commerce_v2_download_quotes
                where organization_id = $1
                  and customer_user_id = $2
                  and actor_user_id = $2
                  and project_id = $3
                  and id = $4`,
              [
                tenantId,
                customerId,
                projectId,
                quoteId
              ]
            );
            return result.rowCount === 1
              ? clone(result.rows[0].snapshot)
              : null;
          }
        )
      );
    }
  });
}

export function createPostgresCommerceV2Adapter({
  authority,
  clock = () => new Date(),
  randomUUID = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    typeof randomUUID === "function",
    "invalid_configuration",
    "commerce v2 UUID generator is required",
    { status: 500 }
  );
  const repository =
    createPostgresCommerceV2Repository({
      authority: database
    });

  async function resolveSession({
    actor,
    projectId
  }) {
    if (
      !UUID.test(String(actor?.userId ?? "")) ||
      !UUID.test(String(projectId ?? ""))
    ) {
      return null;
    }
    return translatedDatabase(() =>
      database.service(
        {
          userId: actor.userId,
          readOnly: true
        },
        async (client) => {
          const result = await client.query(
            `select project.organization_id
               from ss.projects project
               join ss.organizations organization
                 on organization.id =
                    project.organization_id
                and organization.state = 'active'
               join ss.organization_memberships membership
                 on membership.organization_id =
                    project.organization_id
                and membership.user_id = $2
                and membership.state = 'active'
                and membership.role = any($3::text[])
              where project.id = $1
                and project.lifecycle = 'active'`,
            [projectId, actor.userId, PROJECT_ROLES]
          );
          if (result.rowCount !== 1) return null;
          return Object.freeze({
            tenantId:
              result.rows[0].organization_id,
            customerId: actor.userId,
            actorId: actor.userId,
            projectId
          });
        }
      )
    );
  }

  const projects = Object.freeze({
    async resolveEditorProject({
      tenantId,
      customerId,
      projectId
    }) {
      if (
        !UUID.test(String(tenantId ?? "")) ||
        !UUID.test(String(customerId ?? "")) ||
        !UUID.test(String(projectId ?? ""))
      ) {
        return null;
      }
      return translatedDatabase(() =>
        database.service(
          {
            userId: customerId,
            organizationId: tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select project.id
                 from ss.projects project
                 join ss.organizations organization
                   on organization.id =
                      project.organization_id
                  and organization.state = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      project.organization_id
                  and membership.user_id = $2
                  and membership.state = 'active'
                  and membership.role =
                      any($4::text[])
                where project.organization_id = $1
                  and project.id = $3
                  and project.lifecycle = 'active'`,
              [
                tenantId,
                customerId,
                projectId,
                PROJECT_ROLES
              ]
            );
            if (result.rowCount !== 1) return null;
            return Object.freeze({
              tenantId,
              customerId,
              projectId,
              kind: "editor_project",
              purchaseEligible: true
            });
          }
        )
      );
    }
  });

  const versions = Object.freeze({
    async resolveAcceptedVersion({
      tenantId,
      customerId,
      projectId,
      versionId
    }) {
      if (
        !UUID.test(String(tenantId ?? "")) ||
        !UUID.test(String(customerId ?? "")) ||
        !UUID.test(String(projectId ?? "")) ||
        !UUID.test(String(versionId ?? ""))
      ) {
        return null;
      }
      return translatedDatabase(() =>
        database.service(
          {
            userId: customerId,
            organizationId: tenantId,
            readOnly: true
          },
          async (client) => {
            const result = await client.query(
              `select fact.content_digest
                 from ss.site_versions version
                 join ss.projects project
                   on project.organization_id =
                      version.organization_id
                  and project.id = version.project_id
                  and project.lifecycle = 'active'
                 join ss.organizations organization
                   on organization.id =
                      version.organization_id
                  and organization.state = 'active'
                 join ss.organization_memberships membership
                   on membership.organization_id =
                      version.organization_id
                  and membership.user_id = $2
                  and membership.state = 'active'
                  and membership.role =
                      any($5::text[])
                 join ss.version_state_projection state
                   on state.organization_id =
                      version.organization_id
                  and state.project_id =
                      version.project_id
                  and state.version_id = version.id
                  and state.state = 'accepted_release'
                 join ss.fact_sets fact
                   on fact.organization_id =
                      version.organization_id
                  and fact.project_id =
                      version.project_id
                  and fact.id = version.fact_set_id
                where version.organization_id = $1
                  and version.project_id = $3
                  and version.id = $4`,
              [
                tenantId,
                customerId,
                projectId,
                versionId,
                PROJECT_ROLES
              ]
            );
            if (result.rowCount !== 1) return null;
            return Object.freeze({
              projectId,
              versionId,
              state: "accepted",
              contentDigest: requiredDigest(
                result.rows[0].content_digest,
                "version.contentDigest"
              )
            });
          }
        )
      );
    }
  });

  return Object.freeze({
    kind:
      "canonical-postgres-commerce-v2-download",
    repository,
    projects,
    versions,
    resolveSession,
    clock: Object.freeze({
      now() {
        return exactClock(clock);
      }
    }),
    ids: Object.freeze({
      next() {
        return exactUuid(
          randomUUID(),
          "generated commerce v2 ID"
        );
      }
    })
  });
}
