import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import {
  CARE_COMMERCE_ELIGIBILITY_SCHEMA
} from "./care-commerce.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const OPERATIONS = new Set([
  "care_quote_create",
  "care_invoice_reserve",
  "care_reservation_cancel",
  "care_reservation_ambiguity_hold"
]);
const CONSTRAINT_CODES = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "42501", "55000"
]);

function validateAuthority(value) {
  invariant(
    value && typeof value.service === "function",
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Care commerce.",
    { status: 500 }
  );
  return value;
}

function context(input) {
  return {
    actorKind: input.audience,
    userId: input.actorId,
    organizationId: input.organizationId,
    readOnly: true,
    isolation: "serializable"
  };
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function unavailable() {
  return new HostedError(
    "CARE_COMMERCE_UNAVAILABLE",
    "The Care commercial scope is unavailable.",
    { status: 404 }
  );
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HostedError) throw error;
    if (error?.code === "42501") throw unavailable();
    throw error;
  }
}

function validInput(input) {
  invariant(
    input &&
      ["customer", "operator"].includes(input.audience) &&
      [
        input.actorId, input.organizationId, input.projectId,
        input.contractId, input.periodId
      ].every((value) => typeof value === "string" && UUID.test(value)),
    "CARE_COMMERCE_INVALID",
    "Care commercial eligibility scope is invalid.",
    { status: 400 }
  );
  return input;
}

function project(row, input) {
  invariant(
    row &&
      row.organization_id === input.organizationId &&
      row.project_id === input.projectId &&
      row.contract_id === input.contractId &&
      row.period_id === input.periodId &&
      UUID.test(row.customer_user_id) &&
      UUID.test(row.catalog_identity_id) &&
      ["SS-CARE-CORE-2026.1", "SS-CARE-CORE-2026.2"].includes(row.catalog_version) &&
      ["exact_held", "owner_redline_required"].includes(
        row.commercial_authority_state
      ) &&
      row.project_lifecycle === "active" &&
      row.customer_membership_state === "active" &&
      ["owner", "admin"].includes(row.customer_membership_role) &&
      row.contract_authority_state === "held" &&
      row.period_state === "open" &&
      Number.isSafeInteger(Number(row.period_revision)) &&
      Number(row.period_revision) >= 1 &&
      row.customer_effects_authorized === false &&
      row.payment_effects_authorized === false &&
      row.contract_provider_effects_authorized === false &&
      row.period_provider_effects_authorized === false &&
      SHA256.test(row.acceptance_digest) &&
      SHA256.test(row.scope_digest) &&
      SHA256.test(row.provider_scope_digest) &&
      (input.audience !== "customer" || row.customer_user_id === input.actorId),
    "CARE_COMMERCE_AUTHORITY_DRIFT",
    "Canonical Care commercial eligibility changed unexpectedly.",
    { status: 503 }
  );
  const selected = {
    schema: CARE_COMMERCE_ELIGIBILITY_SCHEMA,
    audience: input.audience,
    actorId: input.actorId,
    organizationId: row.organization_id,
    projectId: row.project_id,
    customerId: row.customer_user_id,
    projectLifecycle: row.project_lifecycle,
    catalogIdentityId: row.catalog_identity_id,
    catalogVersion: row.catalog_version,
    serviceKey: row.service_key,
    contractKind: row.contract_kind,
    commercialAuthorityState: row.commercial_authority_state,
    contractId: row.contract_id,
    acceptanceDigest: row.acceptance_digest,
    scopeDigest: row.scope_digest,
    providerScopeDigest: row.provider_scope_digest,
    contractAuthorityState: row.contract_authority_state,
    periodId: row.period_id,
    periodState: row.period_state,
    periodRevision: Number(row.period_revision),
    startsOn: isoDate(row.starts_on),
    endsOn: isoDate(row.ends_on),
    customerEffects: false,
    paymentEffects: false,
    providerEffects: false
  };
  return deepFreeze({ ...selected, eligibilityDigest: digest(selected) });
}

export function createPostgresCareCommerceEligibility({ authority } = {}) {
  const database = validateAuthority(authority);
  return Object.freeze({
    kind: "care-commerce-postgres-eligibility",
    mode: "read-only-held",
    providerEffects: false,
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_care_core_contract_v1()') is not null
                as contract_ready,
              count(*) = 4 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss'
              and c.relname = any($1::text[])
          `, [[
            "care_catalog_identities", "care_customer_contracts",
            "care_periods", "organization_memberships"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          mode: "read-only-held",
          code: ready ? null : "CARE_COMMERCE_NOT_READY",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          mode: "read-only-held",
          code: "CARE_COMMERCE_NOT_READY",
          providerEffects: false
        });
      }
    },
    resolve(inputValue) {
      const input = validInput(inputValue);
      return translated(() => database.service(
        context(input),
        async (client) => {
          if (input.audience === "operator") {
            for (const capability of [
              "service_invoice_manage", "service_management_manage"
            ]) {
              const allowed = await client.query(
                `/* care-commerce:operator-capability */
                 select ss.service_operator_has_capability(
                   $1, $2, clock_timestamp()
                 ) as allowed`,
                [input.actorId, capability]
              );
              invariant(
                allowed.rowCount === 1 &&
                  allowed.rows[0]?.allowed === true,
                "CARE_COMMERCE_UNAVAILABLE",
                "The Care commercial scope is unavailable.",
                { status: 404 }
              );
            }
          }
          const result = await client.query(
            `/* care-commerce:exact-held-eligibility */
             select contract.organization_id, contract.project_id,
                    contract.id as contract_id,
                    contract.customer_user_id,
                    contract.catalog_identity_id, contract.contract_kind,
                    contract.acceptance_digest, contract.scope_digest,
                    contract.provider_scope_digest,
                    contract.authority_state as contract_authority_state,
                    contract.customer_effects_authorized,
                    contract.payment_effects_authorized,
                    contract.provider_effects_authorized
                      as contract_provider_effects_authorized,
                    catalog.catalog_version, catalog.service_key,
                    catalog.commercial_authority_state,
                    period.id as period_id, period.state as period_state,
                    period.revision as period_revision,
                    period.starts_on, period.ends_on,
                    period.provider_effects_authorized
                      as period_provider_effects_authorized,
                    project.lifecycle as project_lifecycle,
                    membership.state as customer_membership_state,
                    membership.role as customer_membership_role
               from ss.care_customer_contracts contract
               join ss.care_catalog_identities catalog
                 on catalog.id = contract.catalog_identity_id
               join ss.care_periods period
                 on period.organization_id = contract.organization_id
                and period.project_id = contract.project_id
                and period.contract_id = contract.id
               join ss.projects project
                 on project.organization_id = contract.organization_id
                and project.id = contract.project_id
               join ss.organization_memberships membership
                 on membership.organization_id = contract.organization_id
                and membership.user_id = contract.customer_user_id
              where contract.organization_id = $1
                and contract.project_id = $2
                and contract.id = $3
                and period.id = $4
                and ($5::text = 'operator'
                  or contract.customer_user_id = $6)
              limit 2`,
            [
              input.organizationId, input.projectId, input.contractId,
              input.periodId, input.audience, input.actorId
            ]
          );
          invariant(
            result.rowCount === 1,
            "CARE_COMMERCE_UNAVAILABLE",
            "The Care commercial scope is unavailable.",
            { status: 404 }
          );
          return project(result.rows[0], input);
        }
      ));
    }
  });
}

function clone(value) {
  return structuredClone(value);
}

function repositoryError(error) {
  if (error instanceof HostedError) return error;
  if (CONSTRAINT_CODES.has(error?.code)) {
    return new HostedError(
      error.code === "23505"
        ? "CARE_COMMERCE_RESERVATION_OVERLAP"
        : "CARE_COMMERCE_REPOSITORY_CONFLICT",
      "The durable Care commerce repository rejected inconsistent held evidence.",
      {
        status: error.code === "23505" ? 409 : 500,
        details: {
          databaseCode: error.code,
          constraint: typeof error.constraint === "string"
            ? error.constraint
            : null,
          databaseReason: typeof error.message === "string"
            ? error.message
            : null
        }
      }
    );
  }
  if (["40001", "40P01", "55P03"].includes(error?.code)) {
    return new HostedError(
      "CARE_COMMERCE_RETRY_REQUIRED",
      "The durable Care commerce operation must be retried.",
      { status: 409 }
    );
  }
  return error;
}

async function repositoryTranslated(work) {
  try {
    return await work();
  } catch (error) {
    throw repositoryError(error);
  }
}

function exactCommand(value) {
  invariant(
    value &&
      [
        value.actorId, value.organizationId, value.projectId,
        value.customerId, value.contractId, value.periodId
      ].every((selected) => typeof selected === "string" && UUID.test(selected)) &&
      typeof value.commandId === "string" && SAFE_ID.test(value.commandId) &&
      OPERATIONS.has(value.operation) &&
      typeof value.fingerprint === "string" && SHA256.test(value.fingerprint),
    "CARE_COMMERCE_REPOSITORY_CONFLICT",
    "The Care commerce command identity is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    actorId: value.actorId,
    organizationId: value.organizationId,
    projectId: value.projectId,
    customerId: value.customerId,
    contractId: value.contractId,
    periodId: value.periodId,
    commandId: value.commandId,
    operation: value.operation,
    fingerprint: value.fingerprint
  });
}

function repositoryContext(actorId, organizationId, readOnly = false) {
  return {
    actorKind: "operator",
    userId: actorId,
    organizationId,
    readOnly,
    isolation: "serializable"
  };
}

async function lockCommand(client, command) {
  await client.query(
    `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`ss-care-commerce-command:${command.organizationId}:${command.commandId}`]
  );
  const result = await client.query(
    `select command.project_id, command.actor_user_id,
            command.action as operation,
            command.request_digest as fingerprint,
            command.resource_kind, command.resource_id,
            command.result_digest,
            coalesce(quote.quote_document, event.reservation_document)
              as result_document
       from ss.care_commands command
       left join ss.care_commerce_quotes quote
         on command.resource_kind = 'commerce_quote'
        and quote.organization_id = command.organization_id
        and quote.id = command.resource_id
       left join ss.care_commerce_reservation_events event
         on command.resource_kind = 'commerce_reservation'
        and event.organization_id = command.organization_id
        and event.command_id = command.command_id
        and event.reservation_id = command.resource_id
      where command.organization_id = $1 and command.command_id = $2`,
    [command.organizationId, command.commandId]
  );
  return result.rows[0] ?? null;
}

function sameCommand(row, command) {
  return commandDrift(row, command).length === 0;
}

function commandDrift(row, command) {
  if (!row) return ["missing"];
  return [
    ["project", row.project_id, command.projectId],
    ["actor", row.actor_user_id, command.actorId],
    ["operation", row.operation, command.operation],
    ["fingerprint", row.fingerprint, command.fingerprint],
    ["organization", row.result_document?.organizationId, command.organizationId],
    ["resultProject", row.result_document?.projectId, command.projectId],
    ["customer", row.result_document?.customerId, command.customerId],
    ["contract", row.result_document?.contractId, command.contractId],
    ["period", row.result_document?.periodId, command.periodId],
    ["resultActor", row.result_document?.actorId, command.actorId],
    ["resultDigest", row.result_digest,
      row.resource_kind === "commerce_quote"
        ? row.result_document?.quoteDigest
        : row.result_document?.reservationDigest]
  ].filter(([, actual, expected]) => actual !== expected)
    .map(([field]) => field);
}

async function recordCommand(
  client,
  command,
  { resourceKind, resourceId, resultDigest, recordedAt },
  uuid
) {
  await client.query(
    `insert into ss.care_commands (
       id, organization_id, project_id, command_id, action,
       resource_kind, resource_id, actor_kind, actor_user_id,
       request_digest, result_digest, recorded_at, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7,
       'operator', $8, $9, $10, $11, $11
     )`,
    [
      uuid(), command.organizationId, command.projectId, command.commandId,
      command.operation, resourceKind, resourceId, command.actorId,
      command.fingerprint, resultDigest, recordedAt
    ]
  );
}

function requireFreshCommand(previous, command) {
  if (!previous) return;
  if (!sameCommand(previous, command)) {
    throw new HostedError(
      "CARE_COMMERCE_IDEMPOTENCY_CONFLICT",
      "The Care commerce command ID was already used differently.",
      { status: 409 }
    );
  }
  throw new HostedError(
    "CARE_COMMERCE_RETRY_REQUIRED",
    "The same Care commerce command completed concurrently; retry for authoritative readback.",
    { status: 409 }
  );
}

function exactQuote(command, quote) {
  invariant(
    quote?.schema === "sitesourcery.care-commerce-quote/v1" &&
      quote.organizationId === command.organizationId &&
      quote.projectId === command.projectId &&
      quote.customerId === command.customerId &&
      quote.contractId === command.contractId &&
      quote.periodId === command.periodId &&
      quote.actorId === command.actorId &&
      UUID.test(quote.quoteId) && UUID.test(quote.catalogIdentityId) &&
      quote.catalogVersion === "SS-CARE-COMMERCE-2026.2" &&
      quote.careCoreCatalogVersion === "SS-CARE-CORE-2026.2" &&
      quote.priceVersion === "SS-COMMERCIAL-2026.6" &&
      quote.commercialContractDigest ===
        "0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d" &&
      quote.state === "held" && quote.payable === false &&
      quote.dispatchAuthorized === false && quote.customerEffects === false &&
      quote.paymentEffects === false && quote.providerEffects === false &&
      quote.tax?.state === "held" && quote.tax.taxMode === null &&
      quote.tax.taxMinor === null && quote.tax.totalMinor === null &&
      Number.isSafeInteger(quote.line?.quantity) && quote.line.quantity > 0 &&
      Number.isSafeInteger(quote.line?.unitAmountMinor) && quote.line.unitAmountMinor > 0 &&
      quote.line.subtotalMinor === quote.line.quantity * quote.line.unitAmountMinor &&
      quote.line.currency === "USD" &&
      [quote.catalogDigest, quote.eligibilityDigest, quote.disclosureDigest,
        quote.quoteDigest].every((selected) => SHA256.test(selected)),
    "CARE_COMMERCE_REPOSITORY_CONFLICT",
    "The Care quote is not exact held evidence.",
    { status: 500 }
  );
  return clone(quote);
}

function exactReservation(command, value) {
  invariant(
    value?.schema === "sitesourcery.care-commerce-invoice-reservation/v1" &&
      value.organizationId === command.organizationId &&
      value.projectId === command.projectId && value.customerId === command.customerId &&
      value.contractId === command.contractId && value.periodId === command.periodId &&
      value.actorId === command.actorId && UUID.test(value.reservationId) &&
      UUID.test(value.quoteId) && SHA256.test(value.reservationDigest) &&
      value.reservationKind === "professional_invoice" &&
      value.intendedProvider === "stripe" && value.providerRequest === null &&
      value.dispatchAuthorized === false && value.taxMode === null &&
      value.taxMinor === null && value.totalMinor === null &&
      value.customerEffects === false && value.paymentEffects === false &&
      value.providerEffects === false,
    "CARE_COMMERCE_REPOSITORY_CONFLICT",
    "The Care reservation is not exact held evidence.",
    { status: 500 }
  );
  return clone(value);
}

function reservationValues(command, value) {
  return [
    value.reservationId, command.organizationId, command.projectId,
    command.customerId, command.contractId, command.periodId, value.quoteId,
    command.actorId, value.serviceKey, value.quoteDigest, value.eligibilityDigest,
    value.taxEvidenceDigest, value.state, value.revision,
    value.providerEffectCertainty, value.holdReason, value.subtotalMinor,
    value.currency, value.cancellationEvidenceDigest,
    value.ambiguityEvidenceDigest, value.reservedAt, value.updatedAt,
    value.reservationDigest, JSON.stringify(value), command.commandId
  ];
}

export function createPostgresCareCommerceRepository({
  authority,
  uuid = systemRandomUUID
} = {}) {
  const database = validateAuthority(authority);
  invariant(
    typeof uuid === "function",
    "CARE_COMMERCE_CONFIGURATION_REQUIRED",
    "A Care commerce UUID source is required.",
    { status: 500 }
  );
  return Object.freeze({
    mode: "postgres-held",
    durable: true,
    providerEffects: false,
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(`
            select
              to_regprocedure('ss.hosted_care_commerce_persistence_contract_v1()') is not null as contract_ready,
              count(*) = 3 as tables_ready,
              bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss' and c.relname = any($1::text[])
          `, [[
            "care_commerce_quotes", "care_commerce_reservations",
            "care_commerce_reservation_events"
          ]])
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true && row.tables_ready === true &&
          row.rls_ready === true;
        return deepFreeze({
          ready, verified: ready, mode: "postgres-held", durable: true,
          code: ready ? null : "CARE_COMMERCE_NOT_READY", providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false, verified: false, mode: "postgres-held", durable: true,
          code: "CARE_COMMERCE_NOT_READY", providerEffects: false
        });
      }
    },
    async claimCommand(input) {
      const command = exactCommand(input);
      return repositoryTranslated(() => database.service(
        repositoryContext(command.actorId, command.organizationId),
        async (client) => {
          const previous = await lockCommand(client, command);
          if (!previous) return { status: "claimed" };
          if (!sameCommand(previous, command)) {
            return { status: "conflict", drift: commandDrift(previous, command) };
          }
          invariant(previous.result_document, "CARE_COMMERCE_REPOSITORY_CONFLICT",
            "The completed Care command has no canonical result.", { status: 500 });
          return { status: "replay", result: clone(previous.result_document) };
        }
      ));
    },
    async abandonCommand(input) {
      exactCommand(input);
    },
    async commitQuoteCommand(input, quoteValue) {
      const command = exactCommand(input);
      const quote = exactQuote(command, quoteValue);
      return repositoryTranslated(() => database.service(
        repositoryContext(command.actorId, command.organizationId),
        async (client) => {
          const previous = await lockCommand(client, command);
          requireFreshCommand(previous, command);
          await recordCommand(client, command, {
            resourceKind: "commerce_quote",
            resourceId: quote.quoteId,
            resultDigest: quote.quoteDigest,
            recordedAt: quote.issuedAt
          }, uuid);
          await client.query(
            `insert into ss.care_commerce_quotes (
               id, organization_id, project_id, customer_user_id, contract_id,
               period_id, catalog_identity_id, actor_user_id, command_id,
               catalog_version, care_core_catalog_version, price_version,
               commercial_contract_digest, catalog_digest, eligibility_digest,
               service_key, state, component_key, quantity, unit_amount_minor,
               subtotal_minor, currency, tax_state, tax_mode, tax_minor, total_minor,
               payable, dispatch_authorized, customer_effects_authorized,
               payment_effects_authorized, provider_effects_authorized, issued_at,
               expires_at, disclosure_digest, quote_digest, quote_document
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               'held',$17,$18,$19,$20,'USD','held',null,null,null,false,false,
               false,false,false,$21,$22,$23,$24,$25::jsonb
             )`,
            [
              quote.quoteId, command.organizationId, command.projectId,
              command.customerId, command.contractId, command.periodId,
              quote.catalogIdentityId, command.actorId, command.commandId,
              quote.catalogVersion, quote.careCoreCatalogVersion, quote.priceVersion,
              quote.commercialContractDigest, quote.catalogDigest,
              quote.eligibilityDigest, quote.serviceKey, quote.line.componentKey,
              quote.line.quantity, quote.line.unitAmountMinor, quote.line.subtotalMinor,
              quote.issuedAt, quote.expiresAt, quote.disclosureDigest,
              quote.quoteDigest, JSON.stringify(quote)
            ]
          );
        }
      ));
    },
    async findQuote(input) {
      invariant(input && [input.actorId, input.organizationId, input.projectId,
        input.contractId, input.periodId, input.quoteId]
        .every((value) => typeof value === "string" && UUID.test(value)),
      "CARE_COMMERCE_INVALID", "Care quote lookup is invalid.", { status: 400 });
      return repositoryTranslated(() => database.service(
        repositoryContext(input.actorId, input.organizationId, true),
        async (client) => {
          const result = await client.query(
            `select quote_document from ss.care_commerce_quotes
              where organization_id=$1 and project_id=$2 and contract_id=$3
                and period_id=$4 and id=$5 limit 2`,
            [input.organizationId, input.projectId, input.contractId, input.periodId, input.quoteId]
          );
          return result.rowCount === 1 ? clone(result.rows[0].quote_document) : null;
        }
      ));
    },
    async commitReservationCommand(input, reservationValue) {
      const command = exactCommand(input);
      const value = exactReservation(command, reservationValue);
      return repositoryTranslated(() => database.service(
        repositoryContext(command.actorId, command.organizationId),
        async (client) => {
          const previous = await lockCommand(client, command);
          requireFreshCommand(previous, command);
          const values = reservationValues(command, value);
          await recordCommand(client, command, {
            resourceKind: "commerce_reservation",
            resourceId: value.reservationId,
            resultDigest: value.reservationDigest,
            recordedAt: value.updatedAt
          }, uuid);
          await client.query(
            `insert into ss.care_commerce_reservations (
               id,organization_id,project_id,customer_user_id,contract_id,period_id,
               quote_id,actor_user_id,service_key,quote_digest,eligibility_digest,
               tax_evidence_digest,state,revision,reservation_kind,intended_provider,
               provider_request,provider_effect_certainty,hold_reason,dispatch_authorized,
               subtotal_minor,tax_mode,tax_minor,total_minor,currency,
               cancellation_evidence_digest,ambiguity_evidence_digest,
               customer_effects_authorized,payment_effects_authorized,
               provider_effects_authorized,reserved_at,updated_at,reservation_digest,
               reservation_document,opening_command_id,latest_command_id
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               'professional_invoice','stripe',null,$15,$16,false,$17,null,null,null,
               $18,$19,$20,false,false,false,$21,$22,$23,$24::jsonb,$25,$25)`,
            values
          );
          await client.query(
            `insert into ss.care_commerce_reservation_events (
               organization_id,project_id,reservation_id,quote_id,command_id,
               actor_user_id,state,revision,reservation_digest,reservation_document,
               provider_effects_authorized,recorded_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,false,$11)`,
            [command.organizationId, command.projectId, value.reservationId,
              value.quoteId, command.commandId, command.actorId, value.state,
              value.revision, value.reservationDigest, JSON.stringify(value), value.updatedAt]
          );
        }
      ));
    },
    async findReservation(input) {
      invariant(input && [input.actorId, input.organizationId, input.projectId,
        input.contractId, input.periodId, input.reservationId]
        .every((value) => typeof value === "string" && UUID.test(value)),
      "CARE_COMMERCE_INVALID", "Care reservation lookup is invalid.", { status: 400 });
      return repositoryTranslated(() => database.service(
        repositoryContext(input.actorId, input.organizationId, true),
        async (client) => {
          const result = await client.query(
            `select reservation_document from ss.care_commerce_reservations
              where organization_id=$1 and project_id=$2 and contract_id=$3
                and period_id=$4 and id=$5 limit 2`,
            [input.organizationId, input.projectId, input.contractId,
              input.periodId, input.reservationId]
          );
          return result.rowCount === 1 ? clone(result.rows[0].reservation_document) : null;
        }
      ));
    },
    async commitReservationTransition(input, priorValue, nextValue) {
      const command = exactCommand(input);
      const prior = exactReservation({ ...command, actorId: priorValue?.actorId }, priorValue);
      const next = exactReservation(command, nextValue);
      invariant(prior.reservationId === next.reservationId &&
        next.revision === prior.revision + 1,
      "CARE_COMMERCE_REPOSITORY_CONFLICT", "The Care reservation revision changed.", { status: 500 });
      return repositoryTranslated(() => database.service(
        repositoryContext(command.actorId, command.organizationId),
        async (client) => {
          const previous = await lockCommand(client, command);
          requireFreshCommand(previous, command);
          await recordCommand(client, command, {
            resourceKind: "commerce_reservation",
            resourceId: next.reservationId,
            resultDigest: next.reservationDigest,
            recordedAt: next.updatedAt
          }, uuid);
          const updated = await client.query(
            `update ss.care_commerce_reservations set
               actor_user_id=$4, latest_command_id=$5, state=$6, revision=$7,
               provider_effect_certainty=$8, hold_reason=$9,
               cancellation_evidence_digest=$10, ambiguity_evidence_digest=$11,
               updated_at=$12, reservation_digest=$13,
               reservation_document=$14::jsonb
             where organization_id=$1 and project_id=$2 and id=$3
               and revision=$15 and reservation_digest=$16
             returning id`,
            [
              command.organizationId, command.projectId, next.reservationId,
              command.actorId, command.commandId, next.state, next.revision,
              next.providerEffectCertainty, next.holdReason,
              next.cancellationEvidenceDigest, next.ambiguityEvidenceDigest,
              next.updatedAt, next.reservationDigest, JSON.stringify(next),
              prior.revision, prior.reservationDigest
            ]
          );
          invariant(updated.rowCount === 1, "CARE_COMMERCE_REPOSITORY_CONFLICT",
            "The Care reservation changed before transition.", { status: 409 });
          await client.query(
            `insert into ss.care_commerce_reservation_events (
               organization_id,project_id,reservation_id,quote_id,command_id,
               actor_user_id,state,revision,reservation_digest,reservation_document,
               provider_effects_authorized,recorded_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,false,$11)`,
            [command.organizationId, command.projectId, next.reservationId,
              next.quoteId, command.commandId, command.actorId, next.state,
              next.revision, next.reservationDigest, JSON.stringify(next), next.updatedAt]
          );
        }
      ));
    }
  });
}
