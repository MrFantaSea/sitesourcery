import { randomUUID as systemRandomUUID } from "node:crypto";

import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  RESPONDER_COMMERCE_CATALOG_DIGEST,
  RESPONDER_COMMERCE_CATALOG_ID,
  RESPONDER_COMMERCE_CATALOG_VERSION,
  RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST
} from "./responder-commerce-catalog.mjs";
import { digest } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const OPERATIONS = new Set([
  "responder_quote_create",
  "responder_billing_reserve",
  "responder_reservation_cancel",
  "responder_reservation_ambiguity_hold"
]);
const CONSTRAINT_CODES = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "42501", "55000"
]);

function clone(value) {
  return structuredClone(value);
}

function authority(value) {
  invariant(
    value && typeof value.service === "function",
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required for Responder commerce.",
    { status: 500 }
  );
  return value;
}

function context(actorId, organizationId, audience = "operator", readOnly = false) {
  return {
    actorKind: audience,
    userId: actorId,
    organizationId,
    readOnly,
    isolation: "serializable"
  };
}

function unavailable() {
  return new HostedError(
    "RESPONDER_COMMERCE_UNAVAILABLE",
    "The Responder billing scope is unavailable.",
    { status: 404 }
  );
}

function translate(error) {
  if (error instanceof HostedError) return error;
  if (error?.code === "42501") return unavailable();
  if (CONSTRAINT_CODES.has(error?.code)) {
    return new HostedError(
      error.code === "23505"
        ? "RESPONDER_COMMERCE_RESERVATION_OVERLAP"
        : "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
      "Durable Responder commerce rejected inconsistent held evidence.",
      {
        status: error.code === "23505" ? 409 : 500,
        details: {
          databaseCode: error.code,
          constraint: typeof error.constraint === "string"
            ? error.constraint
            : null
        }
      }
    );
  }
  if (["40001", "40P01", "55P03"].includes(error?.code)) {
    return new HostedError(
      "RESPONDER_COMMERCE_RETRY_REQUIRED",
      "The durable Responder commerce operation must be retried.",
      { status: 409 }
    );
  }
  return error;
}

async function guarded(work) {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

function validScope(input) {
  invariant(
    input &&
      ["customer", "operator"].includes(input.audience) &&
      [input.actorId, input.organizationId, input.projectId]
        .every((value) => typeof value === "string" && UUID.test(value)) &&
      (input.audience === "customer" ||
        (typeof input.customerId === "string" && UUID.test(input.customerId))),
    "RESPONDER_COMMERCE_INVALID",
    "Responder commerce eligibility scope is invalid.",
    { status: 400 }
  );
  return input;
}

function exactCommand(value) {
  invariant(
    value &&
      [
        value.actorId,
        value.organizationId,
        value.projectId,
        value.customerId
      ].every((selected) => typeof selected === "string" && UUID.test(selected)) &&
      typeof value.commandId === "string" && SAFE_ID.test(value.commandId) &&
      OPERATIONS.has(value.operation) &&
      typeof value.fingerprint === "string" && SHA256.test(value.fingerprint),
    "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
    "Responder commerce command identity is invalid.",
    { status: 500 }
  );
  return Object.freeze({
    actorId: value.actorId,
    organizationId: value.organizationId,
    projectId: value.projectId,
    customerId: value.customerId,
    commandId: value.commandId,
    operation: value.operation,
    fingerprint: value.fingerprint
  });
}

function exactQuote(command, value) {
  invariant(
    value?.schema === "sitesourcery.responder-commerce-quote/v1" &&
      value.organizationId === command.organizationId &&
      value.projectId === command.projectId &&
      value.customerId === command.customerId &&
      value.actorId === command.actorId &&
      UUID.test(value.quoteId) &&
      value.catalogId === RESPONDER_COMMERCE_CATALOG_ID &&
      value.catalogVersion === RESPONDER_COMMERCE_CATALOG_VERSION &&
      value.sourceAuthorityDigest === RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST &&
      value.catalogDigest === RESPONDER_COMMERCE_CATALOG_DIGEST &&
      value.state === "held" &&
      value.payable === false &&
      value.dispatchAuthorized === false &&
      value.customerAcceptanceAuthorized === false &&
      value.billing?.setupAmountMinor === 30_000 &&
      value.billing?.monthlyAmountMinor === 25_000 &&
      value.billing?.initialSubtotalMinor === 55_000 &&
      value.billing?.currency === "USD" &&
      value.billing?.recurringCadence === "month" &&
      value.tax?.state === "disabled_by_owner" &&
      value.tax?.amountMinor === 0 &&
      value.tax?.initialTotalMinor === 55_000 &&
      value.customerEffects === false &&
      value.mailDeliveryEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false &&
      [
        value.eligibilityDigest,
        value.disclosureDigest,
        value.quoteDigest
      ].every((selected) => SHA256.test(selected)),
    "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
    "Responder quote is not exact held evidence.",
    { status: 500 }
  );
  return clone(value);
}

function exactReservation(command, value) {
  invariant(
    value?.schema ===
      "sitesourcery.responder-commerce-billing-reservation/v1" &&
      value.organizationId === command.organizationId &&
      value.projectId === command.projectId &&
      value.customerId === command.customerId &&
      value.actorId === command.actorId &&
      UUID.test(value.reservationId) &&
      UUID.test(value.quoteId) &&
      SHA256.test(value.quoteDigest) &&
      SHA256.test(value.eligibilityDigest) &&
      SHA256.test(value.reservationDigest) &&
      value.reservationKind === "responder_setup_and_monthly" &&
      value.intendedProvider === "stripe" &&
      value.providerRequest === null &&
      Array.isArray(value.paymentPurposes) &&
      value.paymentPurposes.length === 2 &&
      value.paymentPurposes[0]?.purpose === "responder_setup" &&
      value.paymentPurposes[0]?.amountMinor === 30_000 &&
      value.paymentPurposes[0]?.cadence === "one_time" &&
      value.paymentPurposes[1]?.purpose === "responder_monthly" &&
      value.paymentPurposes[1]?.amountMinor === 25_000 &&
      value.paymentPurposes[1]?.cadence === "month" &&
      value.paymentPurposes[1]?.intervalCount === 1 &&
      value.dispatchAuthorized === false &&
      value.customerAcceptanceAuthorized === false &&
      value.initialSubtotalMinor === 55_000 &&
      value.taxState === "disabled_by_owner" &&
      value.taxMinor === 0 &&
      value.initialTotalMinor === 55_000 &&
      value.currency === "USD" &&
      (
        value.cancellationEvidenceDigest === null ||
        SHA256.test(value.cancellationEvidenceDigest)
      ) &&
      (
        value.ambiguityEvidenceDigest === null ||
        SHA256.test(value.ambiguityEvidenceDigest)
      ) &&
      value.customerEffects === false &&
      value.mailDeliveryEffects === false &&
      value.paymentEffects === false &&
      value.providerEffects === false,
    "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
    "Responder reservation is not exact held evidence.",
    { status: 500 }
  );
  return clone(value);
}

function commandDrift(row, command) {
  if (!row) return ["missing"];
  return [
    ["project", row.project_id, command.projectId],
    ["customer", row.customer_user_id, command.customerId],
    ["actor", row.actor_user_id, command.actorId],
    ["operation", row.operation, command.operation],
    ["fingerprint", row.fingerprint, command.fingerprint],
    ["organization", row.result_document?.organizationId, command.organizationId],
    ["resultProject", row.result_document?.projectId, command.projectId],
    ["resultCustomer", row.result_document?.customerId, command.customerId],
    ["resultActor", row.result_document?.actorId, command.actorId],
    [
      "resultDigest",
      row.result_digest,
      row.resource_kind === "quote"
        ? row.result_document?.quoteDigest
        : row.result_document?.reservationDigest
    ]
  ].filter(([, actual, expected]) => actual !== expected)
    .map(([field]) => field);
}

async function lockCommand(client, command) {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`ss-responder-commerce:${command.organizationId}:${command.commandId}`]
  );
  const result = await client.query(
    `select command.project_id, command.customer_user_id,
            command.actor_user_id, command.operation,
            command.request_digest as fingerprint,
            command.resource_kind, command.resource_id,
            command.result_digest,
            coalesce(quote.quote_document, event.reservation_document)
              as result_document
       from ss.responder_commerce_commands command
       left join ss.responder_commerce_quotes quote
         on command.resource_kind = 'quote'
        and quote.organization_id = command.organization_id
        and quote.id = command.resource_id
       left join ss.responder_commerce_reservation_events event
         on command.resource_kind = 'billing_reservation'
        and event.organization_id = command.organization_id
        and event.command_id = command.command_id
        and event.reservation_id = command.resource_id
      where command.organization_id = $1 and command.command_id = $2`,
    [command.organizationId, command.commandId]
  );
  return result.rows[0] ?? null;
}

function requireFresh(previous, command) {
  if (!previous) return;
  if (commandDrift(previous, command).length > 0) {
    throw new HostedError(
      "RESPONDER_COMMERCE_IDEMPOTENCY_CONFLICT",
      "The Responder commerce command ID was already used differently.",
      { status: 409 }
    );
  }
  throw new HostedError(
    "RESPONDER_COMMERCE_RETRY_REQUIRED",
    "The same Responder commerce command completed concurrently; retry for readback.",
    { status: 409 }
  );
}

async function recordCommand(
  client,
  command,
  { resourceKind, resourceId, resultDigest, recordedAt },
  uuid
) {
  await client.query(
    `insert into ss.responder_commerce_commands (
       id, organization_id, project_id, customer_user_id, command_id,
       operation, resource_kind, resource_id, actor_user_id,
       request_digest, result_digest, recorded_at, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [
      uuid(), command.organizationId, command.projectId, command.customerId,
      command.commandId, command.operation, resourceKind, resourceId,
      command.actorId, command.fingerprint, resultDigest, recordedAt
    ]
  );
}

function reservationValues(command, value) {
  return [
    value.reservationId,
    command.organizationId,
    command.projectId,
    command.customerId,
    value.quoteId,
    command.actorId,
    command.commandId,
    value.quoteDigest,
    value.eligibilityDigest,
    value.state,
    value.revision,
    value.providerEffectCertainty,
    value.holdReason,
    value.cancellationEvidenceDigest,
    value.ambiguityEvidenceDigest,
    value.reservedAt,
    value.updatedAt,
    value.reservationDigest,
    JSON.stringify(value)
  ];
}

export function createPostgresResponderCommerceRepository({
  authority: value,
  uuid = systemRandomUUID
} = {}) {
  const database = authority(value);
  invariant(
    typeof uuid === "function",
    "RESPONDER_COMMERCE_CONFIGURATION_REQUIRED",
    "A Responder commerce UUID source is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: "responder-commerce-postgres",
    mode: "postgres-held",
    durable: true,
    providerEffects: false,
    async readiness() {
      try {
        const result = await database.service(
          { actorKind: "system", readOnly: true },
          (client) => client.query(
            `select
               to_regprocedure('ss.hosted_responder_commerce_contract_v1()')
                 is not null as contract_ready,
               count(*) = 5 as tables_ready,
               bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready,
               exists (
                 select 1 from ss.responder_commerce_catalog catalog
                  where catalog.id = $2
                    and catalog.catalog_version = $3
                    and catalog.source_authority_digest = $4
                    and catalog.catalog_digest = $5
                    and catalog.setup_amount_minor = 30000
                    and catalog.monthly_amount_minor = 25000
                    and catalog.initial_subtotal_minor = 55000
                    and catalog.tax_state = 'disabled_by_owner'
                    and not catalog.sellable
                    and not catalog.provider_effects_authorized
               ) as catalog_ready
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'ss' and c.relname = any($1::text[])`,
            [[
              "responder_commerce_catalog",
              "responder_commerce_commands",
              "responder_commerce_quotes",
              "responder_commerce_reservations",
              "responder_commerce_reservation_events"
            ], RESPONDER_COMMERCE_CATALOG_ID,
              RESPONDER_COMMERCE_CATALOG_VERSION,
              RESPONDER_COMMERCE_SOURCE_AUTHORITY_DIGEST,
              RESPONDER_COMMERCE_CATALOG_DIGEST]
          )
        );
        const row = result.rows[0] ?? {};
        const ready = row.contract_ready === true &&
          row.tables_ready === true && row.rls_ready === true &&
          row.catalog_ready === true;
        return deepFreeze({
          ready,
          verified: ready,
          mode: "postgres-held",
          durable: true,
          catalogAuthorityVerified: row.catalog_ready === true,
          code: ready ? null : "RESPONDER_COMMERCE_NOT_READY",
          providerEffects: false
        });
      } catch {
        return deepFreeze({
          ready: false,
          verified: false,
          mode: "postgres-held",
          durable: true,
          catalogAuthorityVerified: false,
          code: "RESPONDER_COMMERCE_NOT_READY",
          providerEffects: false
        });
      }
    },
    async resolveScope(inputValue) {
      const input = validScope(inputValue);
      return guarded(() => database.service(
        context(input.actorId, input.organizationId, input.audience, true),
        async (client) => {
          if (input.audience === "operator") {
            for (const capability of [
              "service_management_manage",
              "service_invoice_manage"
            ]) {
              const allowed = await client.query(
                `select ss.service_operator_has_capability(
                   $1, $2, clock_timestamp()
                 ) as allowed`,
                [input.actorId, capability]
              );
              if (allowed.rows[0]?.allowed !== true) throw unavailable();
            }
          }
          const customerId = input.audience === "customer"
            ? input.actorId
            : input.customerId;
          const result = await client.query(
            `select project.organization_id, project.id as project_id,
                    project.lifecycle as project_lifecycle,
                    membership.user_id as customer_user_id,
                    membership.state as customer_membership_state,
                    membership.role as customer_membership_role
               from ss.projects project
               join ss.organization_memberships membership
                 on membership.organization_id = project.organization_id
                and membership.user_id = $3
              where project.organization_id = $1 and project.id = $2
                and project.lifecycle = 'active'
                and membership.state = 'active'
                and membership.role in ('owner','admin','billing')
              limit 2`,
            [input.organizationId, input.projectId, customerId]
          );
          if (result.rowCount !== 1) throw unavailable();
          const row = result.rows[0];
          const selected = {
            schema: "sitesourcery.responder-commerce-eligibility/v1",
            audience: input.audience,
            actorId: input.actorId,
            organizationId: row.organization_id,
            projectId: row.project_id,
            customerId: row.customer_user_id,
            projectLifecycle: row.project_lifecycle,
            customerMembershipState: row.customer_membership_state,
            customerMembershipRole: row.customer_membership_role,
            customerEffects: false,
            paymentEffects: false,
            providerEffects: false
          };
          return deepFreeze({
            ...selected,
            eligibilityDigest: digest(selected)
          });
        }
      ));
    },
    async claimCommand(input) {
      const selected = exactCommand(input);
      return guarded(() => database.service(
        context(selected.actorId, selected.organizationId),
        async (client) => {
          const previous = await lockCommand(client, selected);
          if (!previous) return { status: "claimed" };
          const drift = commandDrift(previous, selected);
          if (drift.length > 0) return { status: "conflict", drift };
          invariant(
            previous.result_document,
            "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
            "The completed Responder command has no canonical result.",
            { status: 500 }
          );
          return { status: "replay", result: clone(previous.result_document) };
        }
      ));
    },
    async commitQuoteCommand(input, quoteValue) {
      const selected = exactCommand(input);
      const quote = exactQuote(selected, quoteValue);
      return guarded(() => database.service(
        context(selected.actorId, selected.organizationId),
        async (client) => {
          const previous = await lockCommand(client, selected);
          requireFresh(previous, selected);
          await recordCommand(client, selected, {
            resourceKind: "quote",
            resourceId: quote.quoteId,
            resultDigest: quote.quoteDigest,
            recordedAt: quote.issuedAt
          }, uuid);
          await client.query(
            `insert into ss.responder_commerce_quotes (
               id, organization_id, project_id, customer_user_id,
               catalog_id, actor_user_id, command_id, catalog_version,
               source_authority_digest, catalog_digest, eligibility_digest,
               state, setup_amount_minor, monthly_amount_minor,
               initial_subtotal_minor, currency, recurring_cadence,
               tax_state, tax_minor, initial_total_minor, payable,
               dispatch_authorized, customer_acceptance_authorized,
               customer_effects_authorized, mail_delivery_effects_authorized,
               payment_effects_authorized, provider_effects_authorized,
               issued_at, expires_at, disclosure_digest, quote_digest,
               quote_document
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'held',
               30000,25000,55000,'USD','month','disabled_by_owner',0,55000,
               false,false,false,false,false,false,false,$12,$13,$14,$15,$16::jsonb
             )`,
            [
              quote.quoteId, selected.organizationId, selected.projectId,
              selected.customerId, quote.catalogId, selected.actorId,
              selected.commandId, quote.catalogVersion,
              quote.sourceAuthorityDigest, quote.catalogDigest,
              quote.eligibilityDigest, quote.issuedAt, quote.expiresAt,
              quote.disclosureDigest, quote.quoteDigest, JSON.stringify(quote)
            ]
          );
        }
      ));
    },
    async findQuote(input) {
      invariant(
        input && [
          input.actorId,
          input.organizationId,
          input.projectId,
          input.customerId,
          input.quoteId
        ].every((selected) => typeof selected === "string" && UUID.test(selected)) &&
          ["customer", "operator"].includes(input.audience),
        "RESPONDER_COMMERCE_INVALID",
        "Responder quote lookup is invalid.",
        { status: 400 }
      );
      return guarded(() => database.service(
        context(input.actorId, input.organizationId, input.audience, true),
        async (client) => {
          const result = await client.query(
            `select quote_document from ss.responder_commerce_quotes
              where organization_id=$1 and project_id=$2
                and customer_user_id=$3 and id=$4 limit 2`,
            [input.organizationId, input.projectId, input.customerId, input.quoteId]
          );
          return result.rowCount === 1 ? clone(result.rows[0].quote_document) : null;
        }
      ));
    },
    async commitReservationCommand(input, reservationValue) {
      const selected = exactCommand(input);
      const reservation = exactReservation(selected, reservationValue);
      return guarded(() => database.service(
        context(selected.actorId, selected.organizationId),
        async (client) => {
          const previous = await lockCommand(client, selected);
          requireFresh(previous, selected);
          await recordCommand(client, selected, {
            resourceKind: "billing_reservation",
            resourceId: reservation.reservationId,
            resultDigest: reservation.reservationDigest,
            recordedAt: reservation.updatedAt
          }, uuid);
          await client.query(
            `insert into ss.responder_commerce_reservations (
               id,organization_id,project_id,customer_user_id,quote_id,
               actor_user_id,opening_command_id,latest_command_id,quote_digest,
               eligibility_digest,state,revision,reservation_kind,
               intended_provider,provider_request,provider_effect_certainty,
               hold_reason,dispatch_authorized,customer_acceptance_authorized,
               setup_amount_minor,monthly_amount_minor,initial_subtotal_minor,
               tax_state,tax_minor,initial_total_minor,currency,
               cancellation_evidence_digest,ambiguity_evidence_digest,
               customer_effects_authorized,mail_delivery_effects_authorized,
               payment_effects_authorized,provider_effects_authorized,
               reserved_at,updated_at,reservation_digest,reservation_document
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,
               'responder_setup_and_monthly','stripe',null,$12,$13,false,false,
               30000,25000,55000,'disabled_by_owner',0,55000,'USD',$14,$15,
               false,false,false,false,$16,$17,$18,$19::jsonb
             )`,
            reservationValues(selected, reservation)
          );
          await client.query(
            `insert into ss.responder_commerce_reservation_events (
               organization_id,project_id,reservation_id,quote_id,command_id,
               actor_user_id,state,revision,reservation_digest,
               reservation_document,provider_effects_authorized,recorded_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,false,$11)`,
            [
              selected.organizationId, selected.projectId,
              reservation.reservationId, reservation.quoteId,
              selected.commandId, selected.actorId, reservation.state,
              reservation.revision, reservation.reservationDigest,
              JSON.stringify(reservation), reservation.updatedAt
            ]
          );
        }
      ));
    },
    async findReservation(input) {
      invariant(
        input && [
          input.actorId,
          input.organizationId,
          input.projectId,
          input.customerId,
          input.reservationId
        ].every((selected) => typeof selected === "string" && UUID.test(selected)) &&
          ["customer", "operator"].includes(input.audience),
        "RESPONDER_COMMERCE_INVALID",
        "Responder reservation lookup is invalid.",
        { status: 400 }
      );
      return guarded(() => database.service(
        context(input.actorId, input.organizationId, input.audience, true),
        async (client) => {
          const result = await client.query(
            `select reservation_document
               from ss.responder_commerce_reservations
              where organization_id=$1 and project_id=$2
                and customer_user_id=$3 and id=$4 limit 2`,
            [
              input.organizationId, input.projectId,
              input.customerId, input.reservationId
            ]
          );
          return result.rowCount === 1
            ? clone(result.rows[0].reservation_document)
            : null;
        }
      ));
    },
    async commitReservationTransition(input, priorValue, nextValue) {
      const selected = exactCommand(input);
      const prior = exactReservation(
        { ...selected, actorId: priorValue?.actorId },
        priorValue
      );
      const next = exactReservation(selected, nextValue);
      invariant(
        prior.reservationId === next.reservationId &&
          next.revision === prior.revision + 1,
        "RESPONDER_COMMERCE_REPOSITORY_CONFLICT",
        "Responder reservation revision changed.",
        { status: 500 }
      );
      return guarded(() => database.service(
        context(selected.actorId, selected.organizationId),
        async (client) => {
          const previous = await lockCommand(client, selected);
          requireFresh(previous, selected);
          await recordCommand(client, selected, {
            resourceKind: "billing_reservation",
            resourceId: next.reservationId,
            resultDigest: next.reservationDigest,
            recordedAt: next.updatedAt
          }, uuid);
          const updated = await client.query(
            `update ss.responder_commerce_reservations set
               actor_user_id=$4,latest_command_id=$5,state=$6,revision=$7,
               provider_effect_certainty=$8,hold_reason=$9,
               cancellation_evidence_digest=$10,ambiguity_evidence_digest=$11,
               updated_at=$12,reservation_digest=$13,
               reservation_document=$14::jsonb
             where organization_id=$1 and project_id=$2 and id=$3
               and revision=$15 and reservation_digest=$16 returning id`,
            [
              selected.organizationId, selected.projectId, next.reservationId,
              selected.actorId, selected.commandId, next.state, next.revision,
              next.providerEffectCertainty, next.holdReason,
              next.cancellationEvidenceDigest, next.ambiguityEvidenceDigest,
              next.updatedAt, next.reservationDigest, JSON.stringify(next),
              prior.revision, prior.reservationDigest
            ]
          );
          invariant(
            updated.rowCount === 1,
            "RESPONDER_COMMERCE_RESERVATION_CONFLICT",
            "Responder reservation changed before transition.",
            { status: 409 }
          );
          await client.query(
            `insert into ss.responder_commerce_reservation_events (
               organization_id,project_id,reservation_id,quote_id,command_id,
               actor_user_id,state,revision,reservation_digest,
               reservation_document,provider_effects_authorized,recorded_at
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,false,$11)`,
            [
              selected.organizationId, selected.projectId, next.reservationId,
              next.quoteId, selected.commandId, selected.actorId, next.state,
              next.revision, next.reservationDigest, JSON.stringify(next),
              next.updatedAt
            ]
          );
        }
      ));
    }
  });
}
