import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  resolveAlakazamTier
} from "../commerce-v2/alakazam.mjs";
import {
  ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
  ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
  projectAlakazamNextRenewal
} from "../commerce-v2/alakazam-lifecycle-renewal.mjs";
import {
  CommerceV2Error,
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;

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

function databaseError(error) {
  if (error instanceof CommerceV2Error) return error;
  if (DATABASE_CONSTRAINT_CODES.has(error?.code)) {
    return new CommerceV2Error(
      "repository_conflict",
      "the durable Alakazam lifecycle repository rejected inconsistent evidence",
      { status: 500 }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw databaseError(error);
  }
}

function validateAuthority(authority) {
  invariant(
    authority && typeof authority.service === "function",
    "invalid_configuration",
    "canonical PostgreSQL authority is required",
    { status: 500 }
  );
  return authority;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactSha(value, field) {
  const selected = requiredText(value, field, 64);
  invariant(
    /^[a-f0-9]{64}$/u.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function exactDatabaseIso(value, field) {
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    field
  );
}

function exactDatabaseInteger(value, field) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return selected;
}

function exactRenewalLookup(value) {
  const stripeInvoiceId = requiredText(
    value?.stripeInvoiceId,
    "stripeInvoiceId",
    255
  );
  const stripeSubscriptionId = requiredText(
    value?.stripeSubscriptionId,
    "stripeSubscriptionId",
    255
  );
  invariant(
    INVOICE_ID.test(stripeInvoiceId) &&
      SUBSCRIPTION_ID.test(stripeSubscriptionId),
    "invalid_input",
    "the Alakazam renewal lookup is invalid"
  );
  return Object.freeze({
    stripeInvoiceId,
    stripeSubscriptionId
  });
}

function exactRenewalSettlementInput(value) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
    "invalid_input",
    "the Alakazam renewal settlement input is invalid"
  );
  const subscription = value.subscription;
  invariant(
    subscription?.schema ===
      ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
    "invalid_input",
    "the Alakazam renewal subscription is invalid"
  );
  const invoice = value.invoice;
  invariant(
    invoice?.schema === ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA &&
      invoice.subscription?.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    "invalid_input",
    "the Alakazam renewal invoice evidence is invalid"
  );
  const projection = value.projection;
  invariant(
    projection?.schema ===
      ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
    "invalid_input",
    "the Alakazam renewal projection is invalid"
  );
  const event = value.event;
  invariant(
    event &&
      EVENT_ID.test(event.stripeEventId ?? "") &&
      [
        "invoice.paid",
        "invoice.payment_succeeded"
      ].includes(event.eventType) &&
      typeof event.livemode === "boolean" &&
      event.stripeInvoiceId === invoice.stripeInvoiceId &&
      requiredDigest(
        event.payloadDigest,
        "event.payloadDigest"
      ) &&
      requiredIso(
        event.signatureVerifiedAt,
        "event.signatureVerifiedAt"
      ) &&
      requiredIso(event.occurredAt, "event.occurredAt"),
    "invalid_input",
    "the Alakazam renewal event is invalid"
  );
  // The projection is recomputed here so a caller cannot hand the
  // repository a projection the committed facts do not support.
  const expected = projectAlakazamNextRenewal({
    tierId: subscription.tierId,
    confirmedPeriodEndsAt: invoice.periodEndsAt,
    pendingDowngrade: value.pendingDowngrade ?? null
  });
  invariant(
    digest(projection) === digest(expected),
    "repository_conflict",
    "the Alakazam renewal projection does not follow its committed facts",
    { status: 500 }
  );
  return Object.freeze({
    subscription: deepFreeze(clone(subscription)),
    pendingDowngrade: value.pendingDowngrade
      ? deepFreeze(clone(value.pendingDowngrade))
      : null,
    invoice: deepFreeze(clone(invoice)),
    projection: deepFreeze(clone(expected)),
    event: deepFreeze(clone(event)),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    tierEventId: exactUuid(value.tierEventId, "tierEventId"),
    settlementId: exactUuid(
      value.settlementId,
      "settlementId"
    )
  });
}

function renewalEventFacts({ event, subscription, invoice }) {
  return {
    schema: "sitesourcery.alakazam-renewal-event/v1",
    stripeEventId: event.stripeEventId,
    eventType: event.eventType,
    stripeInvoiceId: invoice.stripeInvoiceId,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    billingReason: invoice.billingReason,
    collectionMethod: invoice.collectionMethod,
    paidOutOfBand: invoice.paidOutOfBand,
    invoiceProviderFactsDigest: invoice.providerFactsDigest,
    subscriptionProviderFactsDigest:
      invoice.subscription.providerFactsDigest,
    occurredAt: event.occurredAt,
    signatureVerifiedAt: event.signatureVerifiedAt
  };
}

function renewalTierFacts({ subscription, invoice, projection }) {
  return {
    schema: "sitesourcery.alakazam-renewal-tier-event/v1",
    tierId: subscription.tierId,
    amountMinor: subscription.amountMinor,
    currency: "USD",
    priorPeriodStartsAt: subscription.currentPeriodStartsAt,
    priorPeriodEndsAt: subscription.currentPeriodEndsAt,
    periodStartsAt: invoice.periodStartsAt,
    periodEndsAt: invoice.periodEndsAt,
    stripeInvoiceId: invoice.stripeInvoiceId,
    projectedNextRenewalAt: projection.nextRenewalAt,
    projectedNextTierId: projection.tierId,
    projectedNextAmountMinor: projection.amountMinor,
    projectionBasis: projection.basis
  };
}

function renewalSettlementFacts({ invoice, projection }) {
  return {
    schema: "sitesourcery.alakazam-renewal-settlement/v1",
    invoice: clone(invoice),
    projection: clone(projection)
  };
}

function renewalSubscriptionRow(row) {
  const tier = resolveAlakazamTier(row.tier_id);
  return deepFreeze({
    schema: ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA,
    localSubscriptionId: exactUuid(row.id, "subscription.id"),
    tenantId: exactUuid(
      row.organization_id,
      "subscription.organizationId"
    ),
    customerId: exactUuid(
      row.customer_user_id,
      "subscription.customerUserId"
    ),
    projectId: exactUuid(
      row.project_id,
      "subscription.projectId"
    ),
    revision: exactDatabaseInteger(
      row.revision,
      "subscription.revision"
    ),
    tierId: tier.tierId,
    amountMinor: exactDatabaseInteger(
      row.amount_minor,
      "subscription.amountMinor"
    ),
    currency: requiredText(row.currency, "subscription.currency"),
    status: requiredText(row.status, "subscription.status"),
    stripeCustomerId: requiredText(
      row.stripe_customer_id,
      "subscription.stripeCustomerId",
      255
    ),
    stripeSubscriptionId: requiredText(
      row.stripe_subscription_id,
      "subscription.stripeSubscriptionId",
      255
    ),
    stripeSubscriptionItemId: requiredText(
      row.stripe_subscription_item_id,
      "subscription.stripeSubscriptionItemId",
      255
    ),
    stripePriceId: requiredText(
      row.stripe_price_id,
      "subscription.stripePriceId",
      255
    ),
    currentPeriodStartsAt: exactDatabaseIso(
      row.current_period_starts_at,
      "subscription.currentPeriodStartsAt"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "subscription.currentPeriodEndsAt"
    ),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    providerObservedAt: exactDatabaseIso(
      row.provider_observed_at,
      "subscription.providerObservedAt"
    ),
    providerFactsDigest: exactSha(
      row.provider_facts_digest,
      "subscription.providerFactsDigest"
    ),
    taxMode: requiredText(row.tax_mode, "subscription.taxMode", 40)
  });
}

function renewalSettlementResult(row, projection) {
  return deepFreeze({
    status: "renewal_settled",
    provider: "stripe",
    settlementId: exactUuid(row.id, "settlement.id"),
    subscriptionId: exactUuid(
      row.subscription_id,
      "settlement.subscriptionId"
    ),
    projectId: exactUuid(
      row.project_id,
      "settlement.projectId"
    ),
    receiptId: exactUuid(
      row.payment_receipt_id,
      "settlement.paymentReceiptId"
    ),
    stripeInvoiceId: requiredText(
      row.stripe_invoice_id,
      "settlement.stripeInvoiceId",
      255
    ),
    revision: exactDatabaseInteger(
      row.result_subscription_revision,
      "settlement.resultSubscriptionRevision"
    ),
    periodStartsAt: exactDatabaseIso(
      row.period_starts_at,
      "settlement.periodStartsAt"
    ),
    periodEndsAt: exactDatabaseIso(
      row.period_ends_at,
      "settlement.periodEndsAt"
    ),
    paidAmountMinor: exactDatabaseInteger(
      row.paid_amount_minor,
      "settlement.paidAmountMinor"
    ),
    currency: requiredText(
      row.currency,
      "settlement.currency"
    ),
    providerFactsDigest: exactSha(
      row.provider_facts_digest,
      "settlement.providerFactsDigest"
    ),
    projection: clone(projection),
    next: "complete"
  });
}

const SUBSCRIPTION_COLUMNS = `
  subscription.id,
  subscription.organization_id,
  subscription.project_id,
  subscription.customer_user_id,
  subscription.revision,
  subscription.tier_id,
  subscription.amount_minor,
  subscription.currency,
  subscription.status,
  subscription.stripe_subscription_id,
  subscription.stripe_subscription_item_id,
  subscription.stripe_price_id,
  subscription.current_period_starts_at,
  subscription.current_period_ends_at,
  subscription.cancel_at_period_end,
  subscription.provider_observed_at,
  subscription.provider_facts_digest,
  customer.stripe_customer_id`;

export function createPostgresAlakazamLifecycleRepository({
  authority,
  taxMode = "disabled_by_owner"
} = {}) {
  const database = validateAuthority(authority);
  const reviewedTaxMode = requiredText(taxMode, "taxMode", 40);
  invariant(
    ["automatic", "disabled_by_owner"].includes(
      reviewedTaxMode
    ),
    "invalid_configuration",
    "the Alakazam lifecycle tax mode is not reviewed",
    { status: 500 }
  );

  async function selectRenewalSubscription(client, lookup) {
    return client.query(
      `select ${SUBSCRIPTION_COLUMNS}
         from ss.alakazam_subscriptions subscription
         join ss.stripe_customers customer
           on customer.organization_id =
              subscription.organization_id
          and customer.id =
              subscription.stripe_customer_row_id
        where subscription.stripe_subscription_id = $1
        for update of subscription`,
      [lookup.stripeSubscriptionId]
    );
  }

  async function selectRenewalSettlement(client, lookup) {
    return client.query(
      `select settlement.*
         from ss.alakazam_renewal_settlements settlement
        where settlement.stripe_invoice_id = $1`,
      [lookup.stripeInvoiceId]
    );
  }

  async function selectPendingDowngrade(
    client,
    organizationId,
    subscriptionId,
    effectiveAt
  ) {
    const result = await client.query(
      `select schedule.id, schedule.target_tier_id,
              schedule.effective_at
         from ss.alakazam_downgrade_schedules schedule
        where schedule.organization_id = $1
          and schedule.subscription_id = $2
          and schedule.state in ('dispatching', 'scheduled')
          and schedule.effective_at = $3`,
      [organizationId, subscriptionId, effectiveAt]
    );
    if (result.rowCount === 0) return null;
    invariant(
      result.rowCount === 1,
      "repository_conflict",
      "the Alakazam subscription has more than one open downgrade",
      { status: 500 }
    );
    const row = result.rows[0];
    return deepFreeze({
      scheduleId: exactUuid(row.id, "downgrade.id"),
      targetTierId: resolveAlakazamTier(row.target_tier_id)
        .tierId,
      effectiveAt: exactDatabaseIso(
        row.effective_at,
        "downgrade.effectiveAt"
      )
    });
  }

  return Object.freeze({
    async findRenewalSubscriptionByInvoice(value) {
      const lookup = exactRenewalLookup(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectRenewalSubscription(
            client,
            lookup
          );
          // Ownership is disproven without touching any Alakazam
          // state. The caller returns the event to its canonical
          // route unchanged.
          if (selected.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const subscription = renewalSubscriptionRow({
            ...selected.rows[0],
            tax_mode: reviewedTaxMode
          });
          const settled = await selectRenewalSettlement(
            client,
            lookup
          );
          if (settled.rowCount === 1) {
            const row = settled.rows[0];
            invariant(
              row.subscription_id ===
                subscription.localSubscriptionId,
              "repository_conflict",
              "the settled Alakazam invoice belongs to another subscription",
              { status: 500 }
            );
            return deepFreeze({
              status: "settled",
              provider: "stripe",
              stripeInvoiceId: lookup.stripeInvoiceId,
              subscription,
              pendingDowngrade:
                await selectPendingDowngrade(
                  client,
                  subscription.tenantId,
                  subscription.localSubscriptionId,
                  exactDatabaseIso(
                    row.projected_next_renewal_at,
                    "settlement.projectedNextRenewalAt"
                  )
                ),
              settlement: renewalSettlementResult(
                row,
                projectAlakazamNextRenewal({
                  tierId: resolveAlakazamTier(
                    row.projected_next_tier_id
                  ).tierId,
                  confirmedPeriodEndsAt: exactDatabaseIso(
                    row.projected_next_renewal_at,
                    "settlement.projectedNextRenewalAt"
                  ),
                  pendingDowngrade:
                    row.projection_basis ===
                    "scheduled_downgrade"
                      ? {
                          scheduleId: subscription
                            .localSubscriptionId,
                          targetTierId: resolveAlakazamTier(
                            row.projected_next_tier_id
                          ).tierId,
                          effectiveAt: exactDatabaseIso(
                            row.projected_next_renewal_at,
                            "settlement.projectedNextRenewalAt"
                          )
                        }
                      : null
                })
              )
            });
          }
          return deepFreeze({
            status: "current",
            provider: "stripe",
            stripeInvoiceId: lookup.stripeInvoiceId,
            subscription,
            pendingDowngrade: await selectPendingDowngrade(
              client,
              subscription.tenantId,
              subscription.localSubscriptionId,
              subscription.currentPeriodEndsAt
            )
          });
        })
      );
    },

    async settleRenewalPayment(value) {
      const input = exactRenewalSettlementInput(value);
      const subscription = input.subscription;
      const invoice = input.invoice;
      return translated(() =>
        database.service({}, async (client) => {
          const settled = await selectRenewalSettlement(
            client,
            {
              stripeInvoiceId: invoice.stripeInvoiceId
            }
          );
          // Both paid-invoice aliases converge here. A second
          // delivery replays the committed settlement instead of
          // creating a second receipt.
          if (settled.rowCount === 1) {
            return renewalSettlementResult(
              settled.rows[0],
              input.projection
            );
          }

          const current = await selectRenewalSubscription(
            client,
            {
              stripeSubscriptionId:
                subscription.stripeSubscriptionId
            }
          );
          invariant(
            current.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal subscription disappeared",
            { status: 500 }
          );
          const stored = renewalSubscriptionRow({
            ...current.rows[0],
            tax_mode: reviewedTaxMode
          });
          invariant(
            stored.localSubscriptionId ===
                subscription.localSubscriptionId &&
              stored.revision === subscription.revision &&
              stored.tierId === subscription.tierId &&
              stored.status === "active" &&
              stored.cancelAtPeriodEnd === false &&
              stored.currentPeriodEndsAt ===
                subscription.currentPeriodEndsAt &&
              stored.currentPeriodStartsAt ===
                subscription.currentPeriodStartsAt,
            "alakazam_renewal_reconciliation_required",
            "The Alakazam subscription changed before its renewal committed.",
            { status: 409 }
          );

          const existingEvent = await client.query(
            `select id
               from ss.alakazam_stripe_events
              where stripe_event_id = $1
              for update`,
            [input.event.stripeEventId]
          );
          invariant(
            existingEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam renewal event was already used for different evidence",
            { status: 409 }
          );

          const facts = renewalEventFacts({
            event: input.event,
            subscription,
            invoice
          });
          const insertedEvent = await client.query(
            `insert into ss.alakazam_stripe_events (
               id, organization_id, project_id,
               quote_id, subscription_id,
               stripe_event_id, event_type,
               livemode, api_version,
               provider_object_id, payload_digest,
               facts, state, attempt_count,
               signature_verified_at, occurred_at
             ) values (
               $1, $2, $3, null, $4,
               $5, $6, $7, $8, $9, $10,
               $11::jsonb, 'received', 0, $12, $13
             )
             returning id`,
            [
              input.eventRowId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.event.stripeEventId,
              input.event.eventType,
              input.event.livemode,
              input.event.apiVersion,
              invoice.stripeInvoiceId,
              input.event.payloadDigest,
              JSON.stringify(facts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            insertedEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal event was not recorded",
            { status: 500 }
          );
          const claimed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1
                and id = $2
                and state = 'received'
              returning id`,
            [subscription.tenantId, input.eventRowId]
          );
          invariant(
            claimed.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal event was not claimed",
            { status: 500 }
          );
          const processed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed',
                    processed_at = $3
              where organization_id = $1
                and id = $2
                and state = 'processing'
              returning id`,
            [
              subscription.tenantId,
              input.eventRowId,
              input.event.signatureVerifiedAt
            ]
          );
          invariant(
            processed.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal event was not completed",
            { status: 500 }
          );

          const receipt = await client.query(
            `insert into ss.alakazam_payment_receipts (
               id, organization_id, project_id,
               customer_user_id, subscription_id,
               quote_id, stripe_event_row_id,
               receipt_kind, stripe_invoice_id,
               stripe_payment_intent_id,
               list_subtotal_minor, provider_discount_minor,
               net_subtotal_minor, tax_minor, total_minor,
               tax_mode, currency, settled_at,
               provider_facts, provider_facts_digest
             ) values (
               $1, $2, $3, $4, $5, null, $6,
               'renewal_payment', $7, $8,
               $9, 0, $10, $11, $12,
               $13, 'USD', $14, $15::jsonb, $16
             )
             returning id`,
            [
              input.receiptId,
              subscription.tenantId,
              subscription.projectId,
              subscription.customerId,
              subscription.localSubscriptionId,
              input.eventRowId,
              invoice.stripeInvoiceId,
              invoice.stripePaymentIntentId,
              invoice.listSubtotalMinor,
              invoice.netSubtotalMinor,
              invoice.taxMinor,
              invoice.totalMinor,
              invoice.taxMode,
              invoice.providerPaymentTime,
              JSON.stringify(clone(invoice)),
              invoice.providerFactsDigest
            ]
          );
          invariant(
            receipt.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal receipt was not recorded",
            { status: 500 }
          );

          const resultRevision = subscription.revision + 1;
          const tierFacts = renewalTierFacts({
            subscription,
            invoice,
            projection: input.projection
          });
          const tierEvent = await client.query(
            `insert into ss.alakazam_tier_change_events (
               id, organization_id, project_id,
               subscription_id, quote_id,
               stripe_event_row_id, payment_receipt_id,
               downgrade_schedule_id,
               download_reversal_event_id,
               result_subscription_revision,
               event_kind, prior_tier_id, result_tier_id,
               occurred_at, facts, facts_digest
             ) values (
               $1, $2, $3, $4, null, $5, $6,
               null, null, $7,
               'renewal_paid', $8, $8, $9,
               $10::jsonb, $11
             )
             returning id`,
            [
              input.tierEventId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.eventRowId,
              input.receiptId,
              resultRevision,
              subscription.tierId,
              input.event.occurredAt,
              JSON.stringify(tierFacts),
              digest(tierFacts)
            ]
          );
          invariant(
            tierEvent.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal event evidence was not recorded",
            { status: 500 }
          );

          const renewed = await client.query(
            `update ss.alakazam_subscriptions
                set current_period_starts_at = $3,
                    current_period_ends_at = $4,
                    provider_observed_at = $5,
                    provider_facts_digest = $6
              where organization_id = $1
                and id = $2
                and status = 'active'
                and revision = $7
                and cancel_at_period_end = false
                and current_period_starts_at = $8
                and current_period_ends_at = $9
              returning revision, current_period_starts_at,
                        current_period_ends_at,
                        provider_facts_digest`,
            [
              subscription.tenantId,
              subscription.localSubscriptionId,
              invoice.periodStartsAt,
              invoice.periodEndsAt,
              invoice.subscription.providerObservedAt,
              invoice.subscription.providerFactsDigest,
              subscription.revision,
              subscription.currentPeriodStartsAt,
              subscription.currentPeriodEndsAt
            ]
          );
          invariant(
            renewed.rowCount === 1 &&
              exactDatabaseInteger(
                renewed.rows[0].revision,
                "renewal.revision"
              ) === resultRevision,
            "repository_conflict",
            "the Alakazam subscription period was not advanced",
            { status: 500 }
          );

          const settlementFacts = renewalSettlementFacts({
            invoice,
            projection: input.projection
          });
          const settlement = await client.query(
            `insert into ss.alakazam_renewal_settlements (
               id, organization_id, project_id,
               subscription_id, payment_receipt_id,
               stripe_event_row_id, tier_change_event_id,
               stripe_invoice_id, stripe_payment_intent_id,
               billing_reason, collection_method,
               paid_amount_minor, currency,
               prior_period_starts_at, prior_period_ends_at,
               period_starts_at, period_ends_at,
               result_subscription_revision,
               projected_next_renewal_at,
               projected_next_tier_id,
               projected_next_amount_minor,
               projection_basis, projection_certainty,
               provider_facts, provider_facts_digest,
               provider_observed_at, settled_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, 'USD', $13, $14, $15, $16,
               $17, $18, $19, $20, $21, $22,
               $23::jsonb, $24, $25, $26
             )
             returning *`,
            [
              input.settlementId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.receiptId,
              input.eventRowId,
              input.tierEventId,
              invoice.stripeInvoiceId,
              invoice.stripePaymentIntentId,
              invoice.billingReason,
              invoice.collectionMethod,
              invoice.netSubtotalMinor,
              subscription.currentPeriodStartsAt,
              subscription.currentPeriodEndsAt,
              invoice.periodStartsAt,
              invoice.periodEndsAt,
              resultRevision,
              input.projection.nextRenewalAt,
              input.projection.tierId,
              input.projection.amountMinor,
              input.projection.basis,
              input.projection.certainty,
              JSON.stringify(settlementFacts),
              invoice.subscription.providerFactsDigest,
              invoice.subscription.providerObservedAt,
              invoice.providerPaymentTime
            ]
          );
          invariant(
            settlement.rowCount === 1,
            "repository_conflict",
            "the Alakazam renewal settlement was not recorded",
            { status: 500 }
          );
          return renewalSettlementResult(
            settlement.rows[0],
            input.projection
          );
        })
      );
    }
  });
}
