import { createHash } from "node:crypto";

import {
  ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA,
  ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA
} from "../commerce-v2/alakazam-invoice-finalization.mjs";
import {
  CommerceV2Error,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const DATABASE_CONFLICTS = new Set([
  "22001", "22P02", "23502", "23503", "23505", "23514", "42501", "55000"
]);

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONFLICTS.has(error?.code)) return new CommerceV2Error(
    "repository_conflict",
    "the durable Alakazam finalization repository rejected inconsistent evidence",
    { status: 500 }
  );
  return error;
}

async function translated(work) {
  try { return await work(); } catch (error) { throw databaseError(error); }
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(UUID.test(selected), "invalid_input", `${field} is invalid`);
  return selected;
}

function iso(value, field) {
  return requiredIso(value instanceof Date ? value.toISOString() : String(value ?? ""), field);
}

function integer(value, field) {
  const selected = Number(value);
  invariant(Number.isSafeInteger(selected) && selected > 0, "repository_conflict",
    `${field} is invalid`, { status: 500 });
  return selected;
}

function lookup(value) {
  const stripeEventId = requiredText(value?.stripeEventId, "stripeEventId", 255);
  const stripeInvoiceId = requiredText(value?.stripeInvoiceId, "stripeInvoiceId", 255);
  const stripeSubscriptionId = requiredText(value?.stripeSubscriptionId, "stripeSubscriptionId", 255);
  invariant(EVENT_ID.test(stripeEventId) && INVOICE_ID.test(stripeInvoiceId) &&
    SUBSCRIPTION_ID.test(stripeSubscriptionId), "invalid_input",
  "the Alakazam finalization lookup is invalid");
  return Object.freeze({ stripeEventId, stripeInvoiceId, stripeSubscriptionId });
}

function subscription(row) {
  return deepFreeze({
    schema: ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA,
    tenantId: exactUuid(row.organization_id, "subscription.tenantId"),
    customerId: exactUuid(row.customer_user_id, "subscription.customerId"),
    projectId: exactUuid(row.project_id, "subscription.projectId"),
    localSubscriptionId: exactUuid(row.id, "subscription.localSubscriptionId"),
    revision: integer(row.revision, "subscription.revision"),
    tierId: requiredText(row.tier_id, "subscription.tierId", 100),
    status: requiredText(row.status, "subscription.status", 50),
    stripeCustomerId: requiredText(row.stripe_customer_id, "subscription.stripeCustomerId", 255),
    stripeSubscriptionId: requiredText(row.stripe_subscription_id,
      "subscription.stripeSubscriptionId", 255)
  });
}

function customer(state) {
  const failed = state === "failed";
  return deepFreeze({
    schema: ALAKAZAM_FINALIZATION_CUSTOMER_SCHEMA,
    state,
    attentionRequired: failed,
    renewalHeld: failed,
    fulfillmentHeld: failed,
    messageCode: failed
      ? "alakazam_invoice_preparation_attention"
      : "alakazam_invoice_preparation_current"
  });
}

function result(row, eventType) {
  const state = requiredText(row.state, "finalization.state", 20);
  invariant(["failed", "recovered"].includes(state), "repository_conflict",
    "the durable Alakazam finalization state is invalid", { status: 500 });
  const failed = state === "failed";
  return deepFreeze({
    status: "finalization_recorded",
    provider: "stripe",
    incidentId: exactUuid(row.id, "finalization.incidentId"),
    subscriptionId: exactUuid(row.subscription_id, "finalization.subscriptionId"),
    projectId: exactUuid(row.project_id, "finalization.projectId"),
    state,
    renewalHeld: failed,
    fulfillmentHeld: failed,
    revision: integer(row.revision, "finalization.revision"),
    customer: customer(state),
    operator: deepFreeze({
      state,
      attentionRequired: failed,
      severity: failed ? "high" : "resolved",
      invoiceIdDigest: requiredDigest(row.invoice_id_digest,
        "finalization.invoiceIdDigest"),
      evidenceDigest: requiredDigest(row.evidence_digest,
        "finalization.evidenceDigest")
    }),
    next: ["invoice.paid", "invoice.payment_succeeded"].includes(eventType)
      ? "continue" : "complete"
  });
}

function observationResult(row) {
  return result({
    id: row.projection_id,
    subscription_id: row.subscription_id,
    project_id: row.project_id,
    state: row.provider_state,
    revision: row.projection_revision,
    invoice_id_digest: createHash("sha256")
      .update(row.stripe_invoice_id, "utf8").digest("hex"),
    evidence_digest: row.provider_facts_digest
  }, row.event_type);
}

function exactInput(value) {
  invariant(value && typeof value === "object" && value.subscription && value.event && value.invoice,
    "invalid_input", "the Alakazam finalization input is invalid");
  const selected = {
    subscription: value.subscription,
    event: value.event,
    invoice: value.invoice,
    observationId: exactUuid(value.observationId, "observationId"),
    incidentId: exactUuid(value.incidentId, "incidentId")
  };
  invariant(
    selected.subscription.schema === ALAKAZAM_FINALIZATION_SUBSCRIPTION_SCHEMA &&
      selected.invoice.schema === ALAKAZAM_FINALIZATION_INVOICE_FACTS_SCHEMA &&
      EVENT_ID.test(selected.event.stripeEventId ?? "") &&
      INVOICE_ID.test(selected.event.stripeInvoiceId ?? "") &&
      SUBSCRIPTION_ID.test(selected.event.stripeSubscriptionId ?? "") &&
      selected.event.stripeInvoiceId === selected.invoice.stripeInvoiceId &&
      selected.event.stripeSubscriptionId === selected.subscription.stripeSubscriptionId &&
      selected.invoice.stripeSubscriptionId === selected.subscription.stripeSubscriptionId &&
      requiredDigest(selected.event.payloadDigest, "event.payloadDigest") &&
      requiredDigest(selected.invoice.providerFactsDigest, "invoice.providerFactsDigest") &&
      ["failed", "recovered"].includes(selected.invoice.finalizationState),
    "invalid_input", "the Alakazam finalization evidence is invalid"
  );
  selected.requestDigest = digest({
    subscriptionId: selected.subscription.localSubscriptionId,
    subscriptionRevision: selected.subscription.revision,
    event: selected.event,
    providerFactsDigest: selected.invoice.providerFactsDigest
  });
  return Object.freeze(selected);
}

async function selectSubscription(client, input, lock = false) {
  return client.query(
    `select subscription.*, customer.stripe_customer_id
       from ss.alakazam_subscriptions subscription
       join ss.stripe_customers customer
         on customer.organization_id = subscription.organization_id
        and customer.id = subscription.stripe_customer_row_id
      where subscription.stripe_subscription_id = $1
        and subscription.status <> 'ended'
      ${lock ? "for update of subscription" : ""}`,
    [input.stripeSubscriptionId]
  );
}

async function selectProjection(client, stripeInvoiceId, lock = false) {
  return client.query(
    `select * from ss.alakazam_invoice_finalization_projection
      where stripe_invoice_id = $1 ${lock ? "for update" : ""}`,
    [stripeInvoiceId]
  );
}

export function createPostgresAlakazamInvoiceFinalizationRepository({ authority } = {}) {
  invariant(authority && typeof authority.service === "function", "invalid_configuration",
    "canonical PostgreSQL authority is required", { status: 500 });
  return Object.freeze({
    async readiness() {
      try {
        const selected = await authority.service({ actorKind: "system", readOnly: true },
          (client) => client.query(`select
            to_regprocedure('ss.hosted_alakazam_finalization_contract_v1()') is not null
              and ss.hosted_alakazam_finalization_contract_v1() =
                'canonical-alakazam-finalization-v1-provider-readback-held' as contract_ready,
            count(*) = 2 as tables_ready,
            bool_and(c.relrowsecurity and c.relforcerowsecurity) as rls_ready
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'ss' and c.relname = any($1::text[])`, [[
            "alakazam_invoice_finalization_observations",
            "alakazam_invoice_finalization_projection"
          ]])
        );
        const row = selected.rows[0] ?? {};
        const ready = row.contract_ready === true && row.tables_ready === true && row.rls_ready === true;
        return deepFreeze({ ready, verified: ready, kind: "alakazam-finalization-postgres",
          providerEffects: false, fulfillmentEffects: false, renewalEffects: false,
          code: ready ? null : "ALAKAZAM_FINALIZATION_NOT_MIGRATED" });
      } catch {
        return deepFreeze({ ready: false, verified: false,
          kind: "alakazam-finalization-postgres", providerEffects: false,
          fulfillmentEffects: false, renewalEffects: false,
          code: "ALAKAZAM_FINALIZATION_DATABASE_UNAVAILABLE" });
      }
    },

    findFinalizationSubscriptionByInvoice(value) {
      const input = lookup(value);
      return translated(() => authority.service({ actorKind: "system", readOnly: true }, async (client) => {
        const selected = await selectSubscription(client, input);
        if (selected.rowCount === 0) return deepFreeze({ status: "not_alakazam" });
        invariant(selected.rowCount === 1, "repository_conflict",
          "the Alakazam finalization subscription is ambiguous", { status: 500 });
        const bound = subscription(selected.rows[0]);
        const observed = await client.query(
          `select * from ss.alakazam_invoice_finalization_observations
            where stripe_event_id = $1`, [input.stripeEventId]
        );
        if (observed.rowCount === 0) return deepFreeze({ status: "current", subscription: bound });
        invariant(observed.rowCount === 1 &&
          observed.rows[0].stripe_invoice_id === input.stripeInvoiceId &&
          observed.rows[0].stripe_subscription_id === input.stripeSubscriptionId &&
          observed.rows[0].subscription_id === bound.localSubscriptionId,
        "stripe_event_conflict", "the finalization event was reused for different evidence", { status: 409 });
        const projection = await selectProjection(client, input.stripeInvoiceId);
        invariant(projection.rowCount === 1 &&
          projection.rows[0].id === observed.rows[0].projection_id &&
          integer(projection.rows[0].revision, "finalization.revision") >=
            integer(observed.rows[0].projection_revision,
              "observation.projectionRevision"), "repository_conflict",
          "the finalization observation lost its durable projection", { status: 500 });
        return deepFreeze({ status: "recorded", subscription: bound,
          result: observationResult(observed.rows[0]) });
      }));
    },

    recordInvoiceFinalization(value) {
      const input = exactInput(value);
      return translated(() => authority.service({ actorKind: "system", isolation: "serializable" },
        async (client) => {
          await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [input.event.stripeInvoiceId]);
          const current = await selectSubscription(client, {
            stripeSubscriptionId: input.subscription.stripeSubscriptionId
          }, true);
          invariant(current.rowCount === 1, "repository_conflict",
            "the Alakazam finalization subscription disappeared", { status: 500 });
          const stored = subscription(current.rows[0]);
          invariant(stored.tenantId === input.subscription.tenantId &&
            stored.projectId === input.subscription.projectId &&
            stored.customerId === input.subscription.customerId &&
            stored.localSubscriptionId === input.subscription.localSubscriptionId &&
            stored.revision === input.subscription.revision &&
            stored.stripeCustomerId === input.subscription.stripeCustomerId,
          "alakazam_finalization_reconciliation_required",
          "The Alakazam subscription changed before finalization evidence committed.", { status: 409 });

          const prior = await client.query(
            `select * from ss.alakazam_invoice_finalization_observations
              where stripe_event_id = $1`, [input.event.stripeEventId]
          );
          if (prior.rowCount === 1) {
            invariant(prior.rows[0].request_digest === input.requestDigest,
              "stripe_event_conflict", "the finalization event was reused for different evidence", { status: 409 });
            const existing = await selectProjection(client, input.event.stripeInvoiceId, true);
            invariant(existing.rowCount === 1 &&
              existing.rows[0].id === prior.rows[0].projection_id &&
              integer(existing.rows[0].revision, "finalization.revision") >=
                integer(prior.rows[0].projection_revision,
                  "observation.projectionRevision"), "repository_conflict",
              "the finalization observation lost its durable projection", { status: 500 });
            return observationResult(prior.rows[0]);
          }


          const existing = await selectProjection(
            client, input.event.stripeInvoiceId, true
          );
          invariant(existing.rowCount <= 1, "repository_conflict",
            "the finalization Invoice binding is ambiguous", { status: 500 });
          if (existing.rowCount === 1) {
            invariant(existing.rows[0].organization_id === stored.tenantId &&
              existing.rows[0].subscription_id === stored.localSubscriptionId,
            "repository_conflict", "the finalization Invoice binding changed", { status: 500 });
          }
          const projectionId = existing.rowCount === 0
            ? input.incidentId
            : exactUuid(existing.rows[0].id, "finalization.incidentId");
          const projectionRevision = existing.rowCount === 0
            ? 1
            : integer(existing.rows[0].revision, "finalization.revision") + 1;

          await client.query(
            `insert into ss.alakazam_invoice_finalization_observations (
               id, organization_id, project_id, subscription_id,
               projection_id, projection_revision,
               stripe_event_id, event_type, stripe_invoice_id,
               stripe_subscription_id, provider_state, provider_invoice_status,
               reason_code, payload_digest, request_digest, provider_facts,
               provider_facts_digest, livemode, api_version,
               signature_verified_at, provider_observed_at, occurred_at, recorded_at
             ) values (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,
               $17,$18,$19,$20,$21,$22,$23
             )`, [
              input.observationId, stored.tenantId, stored.projectId,
              stored.localSubscriptionId, projectionId, projectionRevision,
              input.event.stripeEventId,
              input.event.eventType, input.event.stripeInvoiceId,
              input.event.stripeSubscriptionId, input.invoice.finalizationState,
              input.invoice.status, input.invoice.reasonCode,
              input.event.payloadDigest, input.requestDigest,
              JSON.stringify(input.invoice), input.invoice.providerFactsDigest,
              input.event.livemode, input.event.apiVersion,
              input.event.signatureVerifiedAt, input.invoice.providerObservedAt,
              input.event.occurredAt, input.event.signatureVerifiedAt
            ]
          );
          const failed = input.invoice.finalizationState === "failed";
          const invoiceIdDigest = createHash("sha256")
            .update(input.event.stripeInvoiceId, "utf8").digest("hex");
          if (existing.rowCount === 0) {
            const inserted = await client.query(
              `insert into ss.alakazam_invoice_finalization_projection (
                 id, organization_id, project_id, subscription_id, stripe_invoice_id,
                 first_observation_id, latest_observation_id, state, reason_code,
                 renewal_held, fulfillment_held, provider_effects_authorized,
                 customer_message_code, invoice_id_digest, evidence_digest,
                 first_observed_at, recovered_at, provider_observed_at,
                 revision, created_at, updated_at
               ) values (
                 $1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$9,false,$10,$11,$12,
                 $13,$14,$15,1,$13,$13
               ) returning *`, [
                projectionId, stored.tenantId, stored.projectId,
                stored.localSubscriptionId, input.event.stripeInvoiceId,
                input.observationId, input.invoice.finalizationState,
                input.invoice.reasonCode, failed,
                failed ? "alakazam_invoice_preparation_attention" :
                  "alakazam_invoice_preparation_current",
                invoiceIdDigest, input.invoice.providerFactsDigest,
                input.event.signatureVerifiedAt,
                failed ? null : input.invoice.providerObservedAt,
                input.invoice.providerObservedAt
              ]
            );
            return result(inserted.rows[0], input.event.eventType);
          }
          const previousObservedAt = iso(existing.rows[0].provider_observed_at,
            "finalization.providerObservedAt");
          invariant(Date.parse(input.invoice.providerObservedAt) >= Date.parse(previousObservedAt),
            "alakazam_finalization_reconciliation_required",
            "Older finalization evidence cannot replace the current provider observation.", { status: 409 });
          const updated = await client.query(
            `update ss.alakazam_invoice_finalization_projection
                set latest_observation_id = $2, state = $3, reason_code = $4,
                    renewal_held = $5, fulfillment_held = $5,
                    customer_message_code = $6, evidence_digest = $7,
                    recovered_at = $8, provider_observed_at = $9,
                    revision = revision + 1, updated_at = $10
              where id = $1 returning *`, [
              existing.rows[0].id, input.observationId,
              input.invoice.finalizationState, input.invoice.reasonCode, failed,
              failed ? "alakazam_invoice_preparation_attention" :
                "alakazam_invoice_preparation_current",
              input.invoice.providerFactsDigest,
              failed ? null : input.invoice.providerObservedAt,
              input.invoice.providerObservedAt, input.event.signatureVerifiedAt
            ]
          );
          return result(updated.rows[0], input.event.eventType);
        }
      ));
    }
  });
}
