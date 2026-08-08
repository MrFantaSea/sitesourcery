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
  ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
  ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
  ALAKAZAM_LIFECYCLE_DECISION_SCHEMA
} from "../commerce-v2/alakazam-lifecycle-state.mjs";
import {
  ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
  ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
  ALAKAZAM_EXPORT_GRANT_SCHEMA
} from "../commerce-v2/alakazam-lifecycle-cancellation.mjs";
import {
  ALAKAZAM_REVERSAL_DECISION_SCHEMA,
  ALAKAZAM_REVERSAL_FACTS_SCHEMA,
  ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA
} from "../commerce-v2/alakazam-lifecycle-reversal.mjs";
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

function exactIncidentLookup(value) {
  const lookup = exactRenewalLookup(value);
  const stripeEventId = requiredText(
    value?.stripeEventId,
    "stripeEventId",
    255
  );
  invariant(
    EVENT_ID.test(stripeEventId),
    "invalid_input",
    "the Alakazam incident lookup is invalid"
  );
  return Object.freeze({ ...lookup, stripeEventId });
}

function exactIncidentInput(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid_input",
    "the Alakazam incident input is invalid"
  );
  const subscription = value.subscription;
  invariant(
    subscription?.schema ===
      ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
    "invalid_input",
    "the Alakazam incident subscription is invalid"
  );
  const invoice = value.invoice;
  invariant(
    invoice?.schema ===
      ALAKAZAM_INCIDENT_INVOICE_FACTS_SCHEMA,
    "invalid_input",
    "the Alakazam incident invoice evidence is invalid"
  );
  const decision = value.decision;
  invariant(
    decision?.schema === ALAKAZAM_LIFECYCLE_DECISION_SCHEMA &&
      decision.from === subscription.status,
    "invalid_input",
    "the Alakazam incident decision is invalid"
  );
  // An unruled policy may never arrive here carrying a consequence.
  invariant(
    decision.policyVersion !== null ||
      (decision.to === decision.from &&
        decision.tierEventKind === null &&
        decision.graceEndsAt === null &&
        decision.serviceState === "unchanged"),
    "repository_conflict",
    "an unruled Alakazam policy cannot commit a lifecycle consequence",
    { status: 500 }
  );
  const event = value.event;
  invariant(
    event &&
      EVENT_ID.test(event.stripeEventId ?? "") &&
      [
        "invoice.payment_failed",
        "invoice.payment_action_required"
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
    "the Alakazam incident event is invalid"
  );
  const tierEventId =
    decision.tierEventKind === null
      ? null
      : exactUuid(value.tierEventId, "tierEventId");
  invariant(
    decision.tierEventKind !== null ||
      value.tierEventId === null ||
      value.tierEventId === undefined,
    "invalid_input",
    "an Alakazam incident without a consequence cannot reserve tier evidence"
  );
  return Object.freeze({
    subscription: deepFreeze(clone(subscription)),
    invoice: deepFreeze(clone(invoice)),
    decision: deepFreeze(clone(decision)),
    event: deepFreeze(clone(event)),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    incidentId: exactUuid(value.incidentId, "incidentId"),
    tierEventId
  });
}

function exactRecoveryInput(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid_input",
    "the Alakazam recovery input is invalid"
  );
  const subscription = value.subscription;
  invariant(
    subscription?.schema ===
      ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
    "invalid_input",
    "the Alakazam recovery subscription is invalid"
  );
  const invoice = value.invoice;
  invariant(
    invoice?.schema === ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA &&
      invoice.subscription?.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    "invalid_input",
    "the Alakazam recovery invoice evidence is invalid"
  );
  const decision = value.decision;
  invariant(
    decision?.schema === ALAKAZAM_LIFECYCLE_DECISION_SCHEMA &&
      decision.from === subscription.status &&
      decision.to === "active" &&
      decision.tierEventKind === "payment_recovered" &&
      decision.policyVersion !== null,
    "repository_conflict",
    "an Alakazam restoration needs a ruled recovery decision",
    { status: 500 }
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
    "the Alakazam recovery event is invalid"
  );
  return Object.freeze({
    subscription: deepFreeze(clone(subscription)),
    invoice: deepFreeze(clone(invoice)),
    decision: deepFreeze(clone(decision)),
    event: deepFreeze(clone(event)),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    tierEventId: exactUuid(value.tierEventId, "tierEventId")
  });
}



function reversalResultRow(row) {
  const decision = row.provider_facts?.decision;
  invariant(
    decision?.schema === ALAKAZAM_REVERSAL_DECISION_SCHEMA,
    "repository_conflict",
    "the durable Alakazam reversal lost its decision evidence",
    { status: 500 }
  );
  return deepFreeze({
    status: "reversal_recorded",
    provider: "stripe",
    reversalId: exactUuid(row.id, "reversal.id"),
    subscriptionId: exactUuid(
      row.subscription_id,
      "reversal.subscriptionId"
    ),
    projectId: exactUuid(
      row.project_id,
      "reversal.projectId"
    ),
    stripeChargeId: requiredText(
      row.stripe_charge_id,
      "reversal.stripeChargeId",
      255
    ),
    severity: exactDatabaseInteger(
      row.severity,
      "reversal.severity"
    ),
    subscriptionStatus: requiredText(
      row.resulting_status,
      "reversal.resultingStatus",
      40
    ),
    consequenceApplied: row.consequence_applied === true,
    ownerReviewRequired: row.owner_review_required === true,
    decision: deepFreeze(clone(decision)),
    next: "owner_reconciliation"
  });
}

function exactReversalInput(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid_input",
    "the Alakazam reversal input is invalid"
  );
  const subscription = value.subscription;
  invariant(
    subscription?.schema ===
      ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA,
    "invalid_input",
    "the Alakazam reversal subscription is invalid"
  );
  const reversal = value.reversal;
  invariant(
    reversal?.schema === ALAKAZAM_REVERSAL_FACTS_SCHEMA,
    "invalid_input",
    "the Alakazam reversal evidence is invalid"
  );
  const decision = value.decision;
  invariant(
    decision?.schema === ALAKAZAM_REVERSAL_DECISION_SCHEMA &&
      decision.from === subscription.status &&
      decision.outcome === reversal.outcome &&
      decision.customerRefundOffered === false,
    "invalid_input",
    "the Alakazam reversal decision is invalid"
  );
  invariant(
    decision.policyVersion !== null ||
      (decision.to === decision.from &&
        decision.tierEventKind === null &&
        decision.consequence === "owner_review"),
    "repository_conflict",
    "an unruled Alakazam reversal policy cannot commit a consequence",
    { status: 500 }
  );
  const event = value.event;
  invariant(
    event &&
      EVENT_ID.test(event.stripeEventId ?? "") &&
      typeof event.livemode === "boolean" &&
      event.stripeChargeId === reversal.stripeChargeId &&
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
    "the Alakazam reversal event is invalid"
  );
  return Object.freeze({
    subscription: deepFreeze(clone(subscription)),
    reversal: deepFreeze(clone(reversal)),
    decision: deepFreeze(clone(decision)),
    event: deepFreeze(clone(event)),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    reversalId: exactUuid(value.reversalId, "reversalId"),
    tierEventId:
      decision.tierEventKind === null
        ? null
        : exactUuid(value.tierEventId, "tierEventId")
  });
}

function cancellationSubscriptionRow(row, hasOpenDowngrade) {
  const tier = resolveAlakazamTier(row.tier_id);
  return deepFreeze({
    schema: ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
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
    currency: requiredText(
      row.currency,
      "subscription.currency"
    ),
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
    currentPeriodStartsAt: exactDatabaseIso(
      row.current_period_starts_at,
      "subscription.currentPeriodStartsAt"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "subscription.currentPeriodEndsAt"
    ),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    hasOpenDowngrade: hasOpenDowngrade === true
  });
}

function exportGrantRow(row) {
  return deepFreeze({
    schema: ALAKAZAM_EXPORT_GRANT_SCHEMA,
    state: requiredText(row.state, "grant.state", 40),
    availableFrom: exactDatabaseIso(
      row.available_from,
      "grant.availableFrom"
    ),
    paidThroughAt: exactDatabaseIso(
      row.paid_through_at,
      "grant.paidThroughAt"
    ),
    retentionState: requiredText(
      row.retention_state,
      "grant.retentionState",
      60
    ),
    policyVersion:
      row.policy_version === null
        ? null
        : requiredText(
            row.policy_version,
            "grant.policyVersion",
            120
          ),
    retentionEndsAt:
      row.retention_ends_at === null
        ? null
        : exactDatabaseIso(
            row.retention_ends_at,
            "grant.retentionEndsAt"
          ),
    exportWindowEndsAt:
      row.export_window_ends_at === null
        ? null
        : exactDatabaseIso(
            row.export_window_ends_at,
            "grant.exportWindowEndsAt"
          )
  });
}

function scheduledCancellationResult(row, grant) {
  return deepFreeze({
    status: "cancellation_scheduled",
    provider: "stripe",
    state: "scheduled",
    cancellationId: exactUuid(row.id, "cancellation.id"),
    subscriptionId: exactUuid(
      row.subscription_id,
      "cancellation.subscriptionId"
    ),
    projectId: exactUuid(
      row.project_id,
      "cancellation.projectId"
    ),
    effectiveAt: exactDatabaseIso(
      row.effective_at,
      "cancellation.effectiveAt"
    ),
    revision: exactDatabaseInteger(
      row.subscription_revision_at_request,
      "cancellation.revision"
    ) + 1,
    export: grant,
    next: "boundary_confirmation"
  });
}

function exactCancellationConfirmationInput(value) {
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid_input",
    "the Alakazam cancellation confirmation input is invalid"
  );
  invariant(
    value.subscription?.schema ===
      ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
    "invalid_input",
    "the Alakazam cancellation subscription is invalid"
  );
  invariant(
    value.cancellation?.schema ===
      ALAKAZAM_CANCELLATION_FACTS_SCHEMA,
    "invalid_input",
    "the Alakazam cancellation provider evidence is invalid"
  );
  const grant = value.grant;
  invariant(
    grant?.schema === ALAKAZAM_EXPORT_GRANT_SCHEMA &&
      grant.state === "available" &&
      grant.paidThroughAt ===
        value.subscription.currentPeriodEndsAt,
    "invalid_input",
    "the Alakazam export grant is invalid"
  );
  invariant(
    grant.retentionState === "granted"
      ? grant.policyVersion !== null &&
          grant.retentionEndsAt !== null &&
          grant.exportWindowEndsAt !== null
      : grant.policyVersion === null &&
          grant.retentionEndsAt === null &&
          grant.exportWindowEndsAt === null,
    "repository_conflict",
    "an unruled Alakazam retention policy cannot promise a window",
    { status: 500 }
  );
  const event = value.event;
  invariant(
    event &&
      EVENT_ID.test(event.stripeEventId ?? "") &&
      event.eventType === "customer.subscription.updated" &&
      typeof event.livemode === "boolean" &&
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
    "the Alakazam cancellation event is invalid"
  );
  return Object.freeze({
    subscription: deepFreeze(clone(value.subscription)),
    request: deepFreeze(clone(value.request)),
    cancellation: deepFreeze(clone(value.cancellation)),
    grant: deepFreeze(clone(grant)),
    event: deepFreeze(clone(event)),
    eventRowId: exactUuid(value.eventRowId, "eventRowId"),
    tierEventId: exactUuid(value.tierEventId, "tierEventId"),
    exportGrantId: exactUuid(
      value.exportGrantId,
      "exportGrantId"
    )
  });
}

function incidentSubscriptionRow(row) {
  const tier = resolveAlakazamTier(row.tier_id);
  return deepFreeze({
    schema: ALAKAZAM_INCIDENT_SUBSCRIPTION_SCHEMA,
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
    currency: requiredText(
      row.currency,
      "subscription.currency"
    ),
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
    currentPeriodStartsAt: exactDatabaseIso(
      row.current_period_starts_at,
      "subscription.currentPeriodStartsAt"
    ),
    currentPeriodEndsAt: exactDatabaseIso(
      row.current_period_ends_at,
      "subscription.currentPeriodEndsAt"
    ),
    firstFailedAt:
      row.first_failed_at === null
        ? null
        : exactDatabaseIso(
            row.first_failed_at,
            "subscription.firstFailedAt"
          ),
    graceEndsAt:
      row.grace_ends_at === null
        ? null
        : exactDatabaseIso(
            row.grace_ends_at,
            "subscription.graceEndsAt"
          )
  });
}

function incidentResultRow(row) {
  return deepFreeze({
    status: "incident_recorded",
    provider: "stripe",
    incidentId: exactUuid(row.id, "incident.id"),
    subscriptionId: exactUuid(
      row.subscription_id,
      "incident.subscriptionId"
    ),
    projectId: exactUuid(
      row.project_id,
      "incident.projectId"
    ),
    stripeInvoiceId: requiredText(
      row.stripe_invoice_id,
      "incident.stripeInvoiceId",
      255
    ),
    incidentKind: requiredText(
      row.incident_kind,
      "incident.incidentKind",
      60
    ),
    subscriptionStatus: requiredText(
      row.resulting_status,
      "incident.resultingStatus",
      40
    ),
    consequenceApplied: row.consequence_applied === true,
    decision: deepFreeze(clone(row.decision)),
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
  subscription.first_failed_at,
  subscription.grace_ends_at,
  subscription.suspended_at,
  subscription.cancelled_at,
  subscription.ended_at,
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

  async function hasOpenDowngrade(client, subscriptionId) {
    const result = await client.query(
      `select 1 from ss.alakazam_downgrade_schedules
        where subscription_id = $1
          and state in (
            'dispatching', 'scheduled', 'reconciliation_required'
          )
        limit 1`,
      [subscriptionId]
    );
    return result.rowCount > 0;
  }

  async function selectRecovery(client, stripeEventId) {
    const result = await client.query(
      `select event.result_subscription_revision,
              event.payment_receipt_id,
              event.facts,
              receipt.stripe_invoice_id,
              subscription.id as subscription_id,
              subscription.project_id,
              subscription.status,
              subscription.current_period_starts_at,
              subscription.current_period_ends_at
         from ss.alakazam_tier_change_events event
         join ss.alakazam_stripe_events source
           on source.organization_id = event.organization_id
          and source.id = event.stripe_event_row_id
         join ss.alakazam_payment_receipts receipt
           on receipt.organization_id = event.organization_id
          and receipt.id = event.payment_receipt_id
         join ss.alakazam_subscriptions subscription
           on subscription.organization_id =
              event.organization_id
          and subscription.id = event.subscription_id
        where source.stripe_event_id = $1
          and event.event_kind = 'payment_recovered'`,
      [stripeEventId]
    );
    if (result.rowCount === 0) return null;
    invariant(
      result.rowCount === 1,
      "repository_conflict",
      "one Alakazam recovery event produced more than one restoration",
      { status: 500 }
    );
    const row = result.rows[0];
    const decision = row.facts?.decision;
    invariant(
      decision?.schema === ALAKAZAM_LIFECYCLE_DECISION_SCHEMA,
      "repository_conflict",
      "the durable Alakazam restoration lost its decision evidence",
      { status: 500 }
    );
    return deepFreeze({
      status: "recovery_recorded",
      provider: "stripe",
      subscriptionId: exactUuid(
        row.subscription_id,
        "recovery.subscriptionId"
      ),
      projectId: exactUuid(
        row.project_id,
        "recovery.projectId"
      ),
      receiptId: exactUuid(
        row.payment_receipt_id,
        "recovery.receiptId"
      ),
      stripeInvoiceId: requiredText(
        row.stripe_invoice_id,
        "recovery.stripeInvoiceId",
        255
      ),
      revision: exactDatabaseInteger(
        row.result_subscription_revision,
        "recovery.revision"
      ),
      subscriptionStatus: requiredText(
        row.status,
        "recovery.status",
        40
      ),
      periodStartsAt: exactDatabaseIso(
        row.current_period_starts_at,
        "recovery.periodStartsAt"
      ),
      periodEndsAt: exactDatabaseIso(
        row.current_period_ends_at,
        "recovery.periodEndsAt"
      ),
      decision: deepFreeze(clone(decision)),
      next: "complete"
    });
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
    },

    async findIncidentSubscriptionByInvoice(value) {
      const lookup = exactIncidentLookup(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectRenewalSubscription(
            client,
            lookup
          );
          if (selected.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const subscription = incidentSubscriptionRow(
            selected.rows[0]
          );
          const recorded = await client.query(
            `select incident.*
               from ss.alakazam_payment_incidents incident
               join ss.alakazam_stripe_events event
                 on event.organization_id =
                    incident.organization_id
                and event.id = incident.stripe_event_row_id
              where event.stripe_event_id = $1`,
            [lookup.stripeEventId]
          );
          if (recorded.rowCount === 1) {
            return deepFreeze({
              status: "recorded",
              provider: "stripe",
              stripeInvoiceId: lookup.stripeInvoiceId,
              subscription,
              incident: incidentResultRow(recorded.rows[0])
            });
          }
          return deepFreeze({
            status: "current",
            provider: "stripe",
            stripeInvoiceId: lookup.stripeInvoiceId,
            subscription
          });
        })
      );
    },

    async recordPaymentIncident(value) {
      const input = exactIncidentInput(value);
      const subscription = input.subscription;
      const invoice = input.invoice;
      const decision = input.decision;
      return translated(() =>
        database.service({}, async (client) => {
          const existing = await client.query(
            `select incident.*
               from ss.alakazam_payment_incidents incident
               join ss.alakazam_stripe_events event
                 on event.organization_id =
                    incident.organization_id
                and event.id = incident.stripe_event_row_id
              where event.stripe_event_id = $1`,
            [input.event.stripeEventId]
          );
          if (existing.rowCount === 1) {
            return incidentResultRow(existing.rows[0]);
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
            "the Alakazam incident subscription disappeared",
            { status: 500 }
          );
          const stored = incidentSubscriptionRow(
            current.rows[0]
          );
          invariant(
            stored.localSubscriptionId ===
                subscription.localSubscriptionId &&
              stored.revision === subscription.revision &&
              stored.status === decision.from,
            "alakazam_incident_reconciliation_required",
            "The Alakazam subscription changed before its incident committed.",
            { status: 409 }
          );

          const claimedEvent = await client.query(
            `select id
               from ss.alakazam_stripe_events
              where stripe_event_id = $1
              for update`,
            [input.event.stripeEventId]
          );
          invariant(
            claimedEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam incident event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = {
            schema: "sitesourcery.alakazam-incident-event/v1",
            stripeEventId: input.event.stripeEventId,
            eventType: input.event.eventType,
            stripeInvoiceId: invoice.stripeInvoiceId,
            stripeSubscriptionId:
              subscription.stripeSubscriptionId,
            providerInvoiceStatus: invoice.status,
            providerAttemptCount: invoice.attemptCount,
            invoiceProviderFactsDigest:
              invoice.providerFactsDigest,
            occurredAt: input.event.occurredAt,
            signatureVerifiedAt:
              input.event.signatureVerifiedAt
          };
          await client.query(
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
             )`,
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
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1 and id = $2
                and state = 'received'`,
            [subscription.tenantId, input.eventRowId]
          );
          const processed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed', processed_at = $3
              where organization_id = $1 and id = $2
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
            "the Alakazam incident event was not completed",
            { status: 500 }
          );

          // With no owner ruling the story stops here: durable,
          // provider-confirmed evidence and nothing else.
          let resultingStatus = subscription.status;
          if (decision.tierEventKind !== null) {
            const resultRevision = subscription.revision + 1;
            const tierFacts = {
              schema:
                "sitesourcery.alakazam-incident-tier-event/v1",
              tierId: subscription.tierId,
              signal: decision.signal,
              from: decision.from,
              to: decision.to,
              policyVersion: decision.policyVersion,
              consequence: decision.consequence,
              graceEndsAt: decision.graceEndsAt,
              stripeInvoiceId: invoice.stripeInvoiceId
            };
            await client.query(
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
                 $1, $2, $3, $4, null, $5, null,
                 null, null, $6, $7, $8, $8, $9,
                 $10::jsonb, $11
               )`,
              [
                input.tierEventId,
                subscription.tenantId,
                subscription.projectId,
                subscription.localSubscriptionId,
                input.eventRowId,
                resultRevision,
                decision.tierEventKind,
                subscription.tierId,
                input.event.occurredAt,
                JSON.stringify(tierFacts),
                digest(tierFacts)
              ]
            );
            const moved = await client.query(
              `update ss.alakazam_subscriptions
                  set status = $3,
                      first_failed_at =
                        coalesce(first_failed_at, $4),
                      grace_ends_at = $5,
                      suspended_at = case
                        when $3 = 'suspended'
                        then coalesce(suspended_at, $6)
                        else suspended_at
                      end,
                      provider_observed_at = $7,
                      provider_facts_digest = $8
                where organization_id = $1
                  and id = $2
                  and status = $9
                  and revision = $10
                returning revision, status,
                          first_failed_at, grace_ends_at`,
              [
                subscription.tenantId,
                subscription.localSubscriptionId,
                decision.to,
                input.event.occurredAt,
                decision.graceEndsAt,
                input.event.occurredAt,
                invoice.providerObservedAt,
                invoice.providerFactsDigest,
                decision.from,
                subscription.revision
              ]
            );
            invariant(
              moved.rowCount === 1 &&
                moved.rows[0].status === decision.to &&
                exactDatabaseInteger(
                  moved.rows[0].revision,
                  "incident.revision"
                ) === resultRevision,
              "repository_conflict",
              "the Alakazam lifecycle consequence was not applied",
              { status: 500 }
            );
            resultingStatus = decision.to;
          }

          const incident = await client.query(
            `insert into ss.alakazam_payment_incidents (
               id, organization_id, project_id,
               subscription_id, stripe_event_row_id,
               tier_change_event_id, incident_kind,
               stripe_invoice_id, stripe_payment_intent_id,
               provider_invoice_status,
               provider_attempt_count,
               next_provider_attempt_at,
               amount_due_minor, currency,
               observed_status, resulting_status,
               policy_version, decided_consequence,
               service_state, customer_message_code,
               consequence_applied, grace_ends_at,
               decision, decision_digest,
               provider_facts, provider_facts_digest,
               provider_observed_at, occurred_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, 'USD', $14, $15,
               $16, $17, $18, $19, $20, $21,
               $22::jsonb, $23, $24::jsonb, $25, $26, $27
             )
             returning *`,
            [
              input.incidentId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.eventRowId,
              input.tierEventId,
              input.event.eventType ===
              "invoice.payment_failed"
                ? "payment_failed"
                : "action_required",
              invoice.stripeInvoiceId,
              invoice.stripePaymentIntentId,
              invoice.status,
              invoice.attemptCount,
              invoice.nextPaymentAttemptAt,
              invoice.amountDueMinor,
              subscription.status,
              resultingStatus,
              decision.policyVersion,
              decision.consequence,
              decision.serviceState,
              decision.customerMessageCode,
              decision.tierEventKind !== null,
              decision.graceEndsAt,
              JSON.stringify(clone(decision)),
              digest(decision),
              JSON.stringify(clone(invoice)),
              invoice.providerFactsDigest,
              invoice.providerObservedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            incident.rowCount === 1,
            "repository_conflict",
            "the Alakazam payment incident was not recorded",
            { status: 500 }
          );
          return incidentResultRow(incident.rows[0]);
        })
      );
    },

    async findRecoverySubscriptionByInvoice(value) {
      const lookup = exactIncidentLookup(value);
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectRenewalSubscription(
            client,
            lookup
          );
          if (selected.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const subscription = incidentSubscriptionRow(
            selected.rows[0]
          );
          const recorded = await selectRecovery(
            client,
            lookup.stripeEventId
          );
          if (recorded !== null) {
            return deepFreeze({
              status: "recorded",
              provider: "stripe",
              stripeInvoiceId: lookup.stripeInvoiceId,
              subscription,
              recovery: recorded
            });
          }
          return deepFreeze({
            status: "current",
            provider: "stripe",
            stripeInvoiceId: lookup.stripeInvoiceId,
            subscription
          });
        })
      );
    },

    async recordPaymentRecovery(value) {
      const input = exactRecoveryInput(value);
      const subscription = input.subscription;
      const invoice = input.invoice;
      const decision = input.decision;
      return translated(() =>
        database.service({}, async (client) => {
          const existing = await selectRecovery(
            client,
            input.event.stripeEventId
          );
          if (existing !== null) return existing;

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
            "the Alakazam recovery subscription disappeared",
            { status: 500 }
          );
          const stored = incidentSubscriptionRow(
            current.rows[0]
          );
          invariant(
            stored.localSubscriptionId ===
                subscription.localSubscriptionId &&
              stored.revision === subscription.revision &&
              stored.status === decision.from &&
              stored.currentPeriodEndsAt ===
                invoice.periodStartsAt,
            "alakazam_recovery_reconciliation_required",
            "The Alakazam subscription changed before its restoration committed.",
            { status: 409 }
          );

          const claimedEvent = await client.query(
            `select id from ss.alakazam_stripe_events
              where stripe_event_id = $1 for update`,
            [input.event.stripeEventId]
          );
          invariant(
            claimedEvent.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam recovery event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = {
            schema: "sitesourcery.alakazam-recovery-event/v1",
            stripeEventId: input.event.stripeEventId,
            eventType: input.event.eventType,
            stripeInvoiceId: invoice.stripeInvoiceId,
            stripeSubscriptionId:
              subscription.stripeSubscriptionId,
            invoiceProviderFactsDigest:
              invoice.providerFactsDigest,
            occurredAt: input.event.occurredAt,
            signatureVerifiedAt:
              input.event.signatureVerifiedAt
          };
          await client.query(
            `insert into ss.alakazam_stripe_events (
               id, organization_id, project_id,
               quote_id, subscription_id,
               stripe_event_id, event_type,
               livemode, api_version,
               provider_object_id, payload_digest,
               facts, state, attempt_count,
               signature_verified_at, occurred_at
             ) values (
               $1, $2, $3, null, $4, $5, $6, $7, $8,
               $9, $10, $11::jsonb, 'received', 0, $12, $13
             )`,
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
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1 and id = $2
                and state = 'received'`,
            [subscription.tenantId, input.eventRowId]
          );
          const processed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed', processed_at = $3
              where organization_id = $1 and id = $2
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
            "the Alakazam recovery event was not completed",
            { status: 500 }
          );

          await client.query(
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
               'renewal_payment', $7, $8, $9, 0, $10,
               $11, $12, $13, 'USD', $14, $15::jsonb, $16
             )`,
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

          const resultRevision = subscription.revision + 1;
          const tierFacts = {
            schema:
              "sitesourcery.alakazam-recovery-tier-event/v1",
            tierId: subscription.tierId,
            stripeInvoiceId: invoice.stripeInvoiceId,
            periodStartsAt: invoice.periodStartsAt,
            periodEndsAt: invoice.periodEndsAt,
            decision: clone(decision)
          };
          await client.query(
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
               $1, $2, $3, $4, null, $5, $6, null, null,
               $7, 'payment_recovered', $8, $8, $9,
               $10::jsonb, $11
             )`,
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

          const restored = await client.query(
            // Restoration closes the failure episode. first_failed_at
            // and suspended_at describe the CURRENT unresolved
            // episode, so a later failure starts its own grace window
            // instead of inheriting an expired one. The immutable tier
            // events and incident rows keep the history.
            `update ss.alakazam_subscriptions
                set status = 'active',
                    grace_ends_at = null,
                    first_failed_at = null,
                    suspended_at = null,
                    current_period_starts_at = $3,
                    current_period_ends_at = $4,
                    provider_observed_at = $5,
                    provider_facts_digest = $6
              where organization_id = $1
                and id = $2
                and status = $7
                and revision = $8
              returning revision, status,
                        current_period_starts_at,
                        current_period_ends_at`,
            [
              subscription.tenantId,
              subscription.localSubscriptionId,
              invoice.periodStartsAt,
              invoice.periodEndsAt,
              invoice.subscription.providerObservedAt,
              invoice.subscription.providerFactsDigest,
              decision.from,
              subscription.revision
            ]
          );
          invariant(
            restored.rowCount === 1 &&
              restored.rows[0].status === "active" &&
              exactDatabaseInteger(
                restored.rows[0].revision,
                "recovery.revision"
              ) === resultRevision,
            "repository_conflict",
            "the Alakazam subscription was not restored",
            { status: 500 }
          );

          return deepFreeze({
            status: "recovery_recorded",
            provider: "stripe",
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            receiptId: input.receiptId,
            stripeInvoiceId: invoice.stripeInvoiceId,
            revision: resultRevision,
            subscriptionStatus: "active",
            periodStartsAt: invoice.periodStartsAt,
            periodEndsAt: invoice.periodEndsAt,
            decision: clone(decision),
            next: "complete"
          });
        })
      );    },

    async readCancellationSubscription(value) {
      const tenantId = exactUuid(value?.tenantId, "tenantId");
      const customerId = exactUuid(
        value?.customerId,
        "customerId"
      );
      const projectId = exactUuid(
        value?.projectId,
        "projectId"
      );
      return translated(() =>
        database.service(
          {
            userId: customerId,
            organizationId: tenantId,
            readOnly: true
          },
          async (client) => {
            const selected = await client.query(
              `select ${SUBSCRIPTION_COLUMNS}
                 from ss.alakazam_subscriptions subscription
                 join ss.stripe_customers customer
                   on customer.organization_id =
                      subscription.organization_id
                  and customer.id =
                      subscription.stripe_customer_row_id
                where subscription.organization_id = $1
                  and subscription.project_id = $2
                  and subscription.customer_user_id = $3
                  and subscription.status <> 'ended'
                limit 1`,
              [tenantId, projectId, customerId]
            );
            if (selected.rowCount === 0) return null;
            const row = selected.rows[0];
            if (
              row.current_period_starts_at === null ||
              row.current_period_ends_at === null
            ) {
              return null;
            }
            return cancellationSubscriptionRow(
              row,
              await hasOpenDowngrade(client, row.id)
            );
          }
        )
      );
    },

    /**
     * Reserve one local cancellation request and its provider
     * idempotency key. This performs NO provider effect; the Stripe
     * mutation stays behind the held release.
     */
    async claimCancellationRequest(value) {
      const cancellationId = exactUuid(
        value?.cancellationId,
        "cancellationId"
      );
      const subscription = value?.subscription;
      invariant(
        subscription?.schema ===
          ALAKAZAM_CANCELLATION_SUBSCRIPTION_SCHEMA,
        "invalid_input",
        "the Alakazam cancellation subscription is invalid"
      );
      const acceptedDisclosureDigest = requiredDigest(
        value?.acceptedDisclosureDigest,
        "acceptedDisclosureDigest"
      );
      const requestedAt = requiredIso(
        value?.requestedAt,
        "requestedAt"
      );
      return translated(() =>
        database.service({}, async (client) => {
          const existing = await client.query(
            `select * from ss.alakazam_cancellations
              where subscription_id = $1
                and state in (
                  'dispatching', 'scheduled',
                  'reconciliation_required'
                )`,
            [subscription.localSubscriptionId]
          );
          if (existing.rowCount === 1) {
            return deepFreeze({
              status: "existing",
              cancellationId: exactUuid(
                existing.rows[0].id,
                "cancellation.id"
              ),
              state: requiredText(
                existing.rows[0].state,
                "cancellation.state",
                40
              )
            });
          }
          const inserted = await client.query(
            `insert into ss.alakazam_cancellations (
               id, organization_id, project_id,
               subscription_id, customer_user_id,
               requested_by_user_id,
               accepted_disclosure_digest,
               provider_idempotency_key,
               subscription_revision_at_request,
               effective_at, state,
               provider_effect_certainty, requested_at
             ) values (
               $1, $2, $3, $4, $5, $5, $6, $7, $8, $9,
               'dispatching', 'not_submitted', $10
             )
             returning id, state`,
            [
              cancellationId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              subscription.customerId,
              acceptedDisclosureDigest,
              `alakazam:cancel:${cancellationId}`,
              subscription.revision,
              subscription.currentPeriodEndsAt,
              requestedAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "repository_conflict",
            "the Alakazam cancellation request was not reserved",
            { status: 500 }
          );
          return deepFreeze({
            status: "reserved",
            cancellationId,
            state: "dispatching"
          });
        })
      );
    },

    async findCancellationBySubscription(value) {
      const stripeSubscriptionId = requiredText(
        value?.stripeSubscriptionId,
        "stripeSubscriptionId",
        255
      );
      invariant(
        SUBSCRIPTION_ID.test(stripeSubscriptionId),
        "invalid_input",
        "the Alakazam cancellation lookup is invalid"
      );
      return translated(() =>
        database.service({}, async (client) => {
          const selected = await selectRenewalSubscription(
            client,
            { stripeSubscriptionId }
          );
          if (selected.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const row = selected.rows[0];
          const subscription = cancellationSubscriptionRow(
            row,
            await hasOpenDowngrade(client, row.id)
          );
          const cancellation = await client.query(
            `select * from ss.alakazam_cancellations
              where subscription_id = $1
                and state in (
                  'dispatching', 'scheduled',
                  'reconciliation_required'
                )
              for update`,
            [subscription.localSubscriptionId]
          );
          // No local request means Site Sourcery never asked for this
          // stop. It is an unowned provider change for reconciliation,
          // not a cancellation this system may confirm.
          if (cancellation.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const record = cancellation.rows[0];
          if (record.state === "scheduled") {
            const grant = await client.query(
              `select * from ss.alakazam_export_grants
                where cancellation_id = $1`,
              [record.id]
            );
            invariant(
              grant.rowCount === 1,
              "repository_conflict",
              "a scheduled Alakazam cancellation lost its export grant",
              { status: 500 }
            );
            return deepFreeze({
              status: "scheduled",
              provider: "stripe",
              subscription,
              cancellation: scheduledCancellationResult(
                record,
                exportGrantRow(grant.rows[0])
              )
            });
          }
          invariant(
            record.state === "dispatching",
            "alakazam_cancellation_reconciliation_required",
            "The Alakazam cancellation needs owner reconciliation before it can be confirmed.",
            { status: 409 }
          );
          return deepFreeze({
            status: "requested",
            provider: "stripe",
            subscription,
            cancellation: deepFreeze({
              cancellationId: exactUuid(
                record.id,
                "cancellation.id"
              ),
              state: "dispatching",
              effectiveAt: exactDatabaseIso(
                record.effective_at,
                "cancellation.effectiveAt"
              ),
              subscriptionRevisionAtRequest:
                exactDatabaseInteger(
                  record.subscription_revision_at_request,
                  "cancellation.revision"
                )
            })
          });
        })
      );
    },

    async confirmCancellationSchedule(value) {
      const input = exactCancellationConfirmationInput(value);
      const subscription = input.subscription;
      return translated(() =>
        database.service({}, async (client) => {
          const record = await client.query(
            `select * from ss.alakazam_cancellations
              where id = $1 for update`,
            [input.request.cancellationId]
          );
          invariant(
            record.rowCount === 1,
            "repository_conflict",
            "the Alakazam cancellation request disappeared",
            { status: 500 }
          );
          if (record.rows[0].state === "scheduled") {
            const grant = await client.query(
              `select * from ss.alakazam_export_grants
                where cancellation_id = $1`,
              [input.request.cancellationId]
            );
            return scheduledCancellationResult(
              record.rows[0],
              exportGrantRow(grant.rows[0])
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
            current.rowCount === 1 &&
              current.rows[0].cancel_at_period_end === false &&
              exactDatabaseInteger(
                current.rows[0].revision,
                "cancellation.currentRevision"
              ) === subscription.revision &&
              exactDatabaseIso(
                current.rows[0].current_period_ends_at,
                "cancellation.currentPeriodEndsAt"
              ) === subscription.currentPeriodEndsAt,
            "alakazam_cancellation_reconciliation_required",
            "The Alakazam subscription changed before its cancellation committed.",
            { status: 409 }
          );

          const claimed = await client.query(
            `select id from ss.alakazam_stripe_events
              where stripe_event_id = $1 for update`,
            [input.event.stripeEventId]
          );
          invariant(
            claimed.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam cancellation event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = {
            schema:
              "sitesourcery.alakazam-cancellation-event/v1",
            stripeEventId: input.event.stripeEventId,
            stripeSubscriptionId:
              subscription.stripeSubscriptionId,
            cancelAt: input.cancellation.cancelAt,
            providerStatus:
              input.cancellation.providerStatus,
            providerFactsDigest:
              input.cancellation.providerFactsDigest,
            occurredAt: input.event.occurredAt
          };
          await client.query(
            `insert into ss.alakazam_stripe_events (
               id, organization_id, project_id,
               quote_id, subscription_id,
               stripe_event_id, event_type, livemode,
               api_version, provider_object_id,
               payload_digest, facts, state, attempt_count,
               signature_verified_at, occurred_at
             ) values (
               $1, $2, $3, null, $4, $5, $6, $7, $8, $9,
               $10, $11::jsonb, 'received', 0, $12, $13
             )`,
            [
              input.eventRowId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.event.stripeEventId,
              input.event.eventType,
              input.event.livemode,
              input.event.apiVersion,
              subscription.stripeSubscriptionId,
              input.event.payloadDigest,
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1 and id = $2
                and state = 'received'`,
            [subscription.tenantId, input.eventRowId]
          );
          const processed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed', processed_at = $3
              where organization_id = $1 and id = $2
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
            "the Alakazam cancellation event was not completed",
            { status: 500 }
          );

          const resultRevision = subscription.revision + 1;
          const tierFacts = {
            schema:
              "sitesourcery.alakazam-cancellation-tier-event/v1",
            tierId: subscription.tierId,
            effectiveAt: subscription.currentPeriodEndsAt,
            cancellationId: input.request.cancellationId,
            providerFactsDigest:
              input.cancellation.providerFactsDigest,
            export: clone(input.grant)
          };
          await client.query(
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
               $1, $2, $3, $4, null, $5, null, null, null,
               $6, 'cancellation_scheduled', $7, $7, $8,
               $9::jsonb, $10
             )`,
            [
              input.tierEventId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.eventRowId,
              resultRevision,
              subscription.tierId,
              input.event.occurredAt,
              JSON.stringify(tierFacts),
              digest(tierFacts)
            ]
          );

          const scheduled = await client.query(
            `update ss.alakazam_subscriptions
                set cancel_at_period_end = true,
                    provider_observed_at = $3,
                    provider_facts_digest = $4
              where organization_id = $1
                and id = $2
                and cancel_at_period_end = false
                and revision = $5
              returning revision, cancel_at_period_end`,
            [
              subscription.tenantId,
              subscription.localSubscriptionId,
              input.cancellation.providerObservedAt,
              input.cancellation.providerFactsDigest,
              subscription.revision
            ]
          );
          invariant(
            scheduled.rowCount === 1 &&
              scheduled.rows[0].cancel_at_period_end === true &&
              exactDatabaseInteger(
                scheduled.rows[0].revision,
                "cancellation.revision"
              ) === resultRevision,
            "repository_conflict",
            "the Alakazam subscription was not scheduled to end",
            { status: 500 }
          );

          const updated = await client.query(
            `update ss.alakazam_cancellations
                set state = 'scheduled',
                    stripe_event_row_id = $2,
                    tier_change_event_id = $3,
                    provider_facts = $4::jsonb,
                    provider_facts_digest = $5,
                    provider_observed_at = $6,
                    provider_effect_certainty = 'confirmed',
                    scheduled_at = $7
              where id = $1 and state = 'dispatching'
              returning *`,
            [
              input.request.cancellationId,
              input.eventRowId,
              input.tierEventId,
              JSON.stringify(clone(input.cancellation)),
              input.cancellation.providerFactsDigest,
              input.cancellation.providerObservedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            updated.rowCount === 1,
            "repository_conflict",
            "the Alakazam cancellation was not confirmed",
            { status: 500 }
          );

          // The customer keeps what they paid for. Anything beyond the
          // paid period is recorded as an open owner ruling.
          const grant = await client.query(
            `insert into ss.alakazam_export_grants (
               id, organization_id, project_id,
               subscription_id, cancellation_id, state,
               available_from, paid_through_at,
               retention_state, policy_version,
               retention_ends_at, export_window_ends_at
             ) values (
               $1, $2, $3, $4, $5, 'available', $6, $7,
               $8, $9, $10, $11
             )
             returning *`,
            [
              input.exportGrantId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.request.cancellationId,
              input.grant.availableFrom,
              input.grant.paidThroughAt,
              input.grant.retentionState,
              input.grant.policyVersion,
              input.grant.retentionEndsAt,
              input.grant.exportWindowEndsAt
            ]
          );
          invariant(
            grant.rowCount === 1,
            "repository_conflict",
            "the Alakazam export grant was not recorded",
            { status: 500 }
          );
          return scheduledCancellationResult(
            updated.rows[0],
            exportGrantRow(grant.rows[0])
          );
        })
      );    },

    async findReversalPaymentByCharge(value) {
      const stripeChargeId = requiredText(
        value?.stripeChargeId,
        "stripeChargeId",
        255
      );
      const stripeEventId = requiredText(
        value?.stripeEventId,
        "stripeEventId",
        255
      );
      const stripePaymentIntentId = requiredText(
        value?.stripePaymentIntentId,
        "stripePaymentIntentId",
        255
      );
      invariant(
        /^ch_[A-Za-z0-9_]+$/u.test(stripeChargeId) &&
          /^pi_[A-Za-z0-9_]+$/u.test(
            stripePaymentIntentId
          ) &&
          EVENT_ID.test(stripeEventId),
        "invalid_input",
        "the Alakazam reversal lookup is invalid"
      );
      return translated(() =>
        database.service({}, async (client) => {
          const recorded = await client.query(
            `select reversal.*
               from ss.alakazam_reversal_events reversal
               join ss.alakazam_stripe_events event
                 on event.organization_id =
                    reversal.organization_id
                and event.id = reversal.stripe_event_row_id
              where event.stripe_event_id = $1`,
            [stripeEventId]
          );

          // Ownership: the charge's PaymentIntent must already back a
          // committed Alakazam receipt. Nothing else makes an event
          // ours, and an unowned charge is left entirely alone.
          const owned = await client.query(
            `select receipt.id as payment_receipt_id,
                    receipt.stripe_payment_intent_id,
                    receipt.total_minor,
                    receipt.currency,
                    subscription.id as subscription_id,
                    subscription.organization_id,
                    subscription.project_id,
                    subscription.customer_user_id,
                    subscription.tier_id,
                    subscription.status,
                    subscription.revision,
                    application.id as credit_application_id
               from ss.alakazam_payment_receipts receipt
               join ss.alakazam_subscriptions subscription
                 on subscription.organization_id =
                    receipt.organization_id
                and subscription.id = receipt.subscription_id
               left join ss.alakazam_credit_applications
                    application
                 on application.organization_id =
                    receipt.organization_id
                and application.payment_receipt_id = receipt.id
              where receipt.stripe_payment_intent_id = $1
              order by receipt.created_at asc
              limit 1`,
            [stripePaymentIntentId]
          );
          if (owned.rowCount === 0) {
            return deepFreeze({ status: "not_alakazam" });
          }
          const row = owned.rows[0];
          const subscription = deepFreeze({
            schema: ALAKAZAM_REVERSAL_SUBSCRIPTION_SCHEMA,
            localSubscriptionId: exactUuid(
              row.subscription_id,
              "reversal.subscriptionId"
            ),
            tenantId: exactUuid(
              row.organization_id,
              "reversal.organizationId"
            ),
            customerId: exactUuid(
              row.customer_user_id,
              "reversal.customerUserId"
            ),
            projectId: exactUuid(
              row.project_id,
              "reversal.projectId"
            ),
            revision: exactDatabaseInteger(
              row.revision,
              "reversal.revision"
            ),
            tierId: resolveAlakazamTier(row.tier_id).tierId,
            status: requiredText(
              row.status,
              "reversal.status",
              40
            ),
            currency: requiredText(
              row.currency,
              "reversal.currency"
            ),
            paymentReceiptId: exactUuid(
              row.payment_receipt_id,
              "reversal.paymentReceiptId"
            ),
            receiptTotalMinor: exactDatabaseInteger(
              row.total_minor,
              "reversal.receiptTotalMinor"
            ),
            stripePaymentIntentId: requiredText(
              row.stripe_payment_intent_id,
              "reversal.stripePaymentIntentId",
              255
            ),
            creditApplicationId:
              row.credit_application_id === null
                ? null
                : exactUuid(
                    row.credit_application_id,
                    "reversal.creditApplicationId"
                  )
          });
          const highest = await client.query(
            `select coalesce(max(severity), 0) as severity
               from ss.alakazam_reversal_events
              where organization_id = $1
                and stripe_charge_id = $2`,
            [subscription.tenantId, stripeChargeId]
          );
          const currentSeverity = exactDatabaseInteger(
            highest.rows[0].severity,
            "reversal.currentSeverity"
          );
          if (recorded.rowCount === 1) {
            return deepFreeze({
              status: "recorded",
              provider: "stripe",
              stripeChargeId,
              subscription,
              currentSeverity,
              reversal: reversalResultRow(recorded.rows[0])
            });
          }
          return deepFreeze({
            status: "current",
            provider: "stripe",
            stripeChargeId,
            subscription,
            currentSeverity
          });
        })
      );
    },

    async recordReversal(value) {
      const input = exactReversalInput(value);
      const subscription = input.subscription;
      const reversal = input.reversal;
      const decision = input.decision;
      return translated(() =>
        database.service({}, async (client) => {
          const existing = await client.query(
            `select reversal.*
               from ss.alakazam_reversal_events reversal
               join ss.alakazam_stripe_events event
                 on event.organization_id =
                    reversal.organization_id
                and event.id = reversal.stripe_event_row_id
              where event.stripe_event_id = $1`,
            [input.event.stripeEventId]
          );
          if (existing.rowCount === 1) {
            return reversalResultRow(existing.rows[0]);
          }

          const current = await client.query(
            `select status, revision
               from ss.alakazam_subscriptions
              where organization_id = $1 and id = $2
              for update`,
            [
              subscription.tenantId,
              subscription.localSubscriptionId
            ]
          );
          invariant(
            current.rowCount === 1 &&
              current.rows[0].status === decision.from,
            "alakazam_reversal_reconciliation_required",
            "The Alakazam subscription changed before its reversal committed.",
            { status: 409 }
          );

          const claimed = await client.query(
            `select id from ss.alakazam_stripe_events
              where stripe_event_id = $1 for update`,
            [input.event.stripeEventId]
          );
          invariant(
            claimed.rowCount === 0,
            "stripe_event_conflict",
            "the Alakazam reversal event was already used for different evidence",
            { status: 409 }
          );

          const eventFacts = {
            schema: "sitesourcery.alakazam-reversal-event/v1",
            stripeEventId: input.event.stripeEventId,
            eventType: input.event.eventType,
            stripeChargeId: reversal.stripeChargeId,
            outcome: reversal.outcome,
            severity: decision.severity,
            providerFactsDigest:
              reversal.providerFactsDigest,
            occurredAt: input.event.occurredAt
          };
          await client.query(
            `insert into ss.alakazam_stripe_events (
               id, organization_id, project_id,
               quote_id, subscription_id,
               stripe_event_id, event_type, livemode,
               api_version, provider_object_id,
               payload_digest, facts, state, attempt_count,
               signature_verified_at, occurred_at
             ) values (
               $1, $2, $3, null, $4, $5, $6, $7, $8, $9,
               $10, $11::jsonb, 'received', 0, $12, $13
             )`,
            [
              input.eventRowId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              input.event.stripeEventId,
              input.event.eventType,
              input.event.livemode,
              input.event.apiVersion,
              reversal.stripeChargeId,
              input.event.payloadDigest,
              JSON.stringify(eventFacts),
              input.event.signatureVerifiedAt,
              input.event.occurredAt
            ]
          );
          await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processing',
                    attempt_count = attempt_count + 1
              where organization_id = $1 and id = $2
                and state = 'received'`,
            [subscription.tenantId, input.eventRowId]
          );
          const processed = await client.query(
            `update ss.alakazam_stripe_events
                set state = 'processed', processed_at = $3
              where organization_id = $1 and id = $2
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
            "the Alakazam reversal event was not completed",
            { status: 500 }
          );

          let resultingStatus = subscription.status;
          if (decision.tierEventKind !== null) {
            const resultRevision = subscription.revision + 1;
            const tierFacts = {
              schema:
                "sitesourcery.alakazam-reversal-tier-event/v1",
              tierId: subscription.tierId,
              outcome: reversal.outcome,
              severity: decision.severity,
              policyVersion: decision.policyVersion,
              stripeChargeId: reversal.stripeChargeId
            };
            await client.query(
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
                 $1, $2, $3, $4, null, $5, null, null, null,
                 $6, 'suspended', $7, $7, $8, $9::jsonb, $10
               )`,
              [
                input.tierEventId,
                subscription.tenantId,
                subscription.projectId,
                subscription.localSubscriptionId,
                input.eventRowId,
                resultRevision,
                subscription.tierId,
                input.event.occurredAt,
                JSON.stringify(tierFacts),
                digest(tierFacts)
              ]
            );
            const suspended = await client.query(
              `update ss.alakazam_subscriptions
                  set status = 'suspended',
                      suspended_at =
                        coalesce(suspended_at, $3),
                      provider_observed_at = $4,
                      provider_facts_digest = $5
                where organization_id = $1
                  and id = $2
                  and status = $6
                  and revision = $7
                returning revision, status`,
              [
                subscription.tenantId,
                subscription.localSubscriptionId,
                input.event.occurredAt,
                reversal.providerObservedAt,
                reversal.providerFactsDigest,
                decision.from,
                subscription.revision
              ]
            );
            invariant(
              suspended.rowCount === 1 &&
                suspended.rows[0].status === "suspended" &&
                exactDatabaseInteger(
                  suspended.rows[0].revision,
                  "reversal.revision"
                ) === resultRevision,
              "repository_conflict",
              "the Alakazam reversal consequence was not applied",
              { status: 500 }
            );
            resultingStatus = "suspended";
          }

          const inserted = await client.query(
            `insert into ss.alakazam_reversal_events (
               id, organization_id, project_id,
               subscription_id, payment_receipt_id,
               credit_application_id, stripe_event_row_id,
               reversal_kind, outcome, stripe_charge_id,
               stripe_payment_intent_id, stripe_refund_id,
               stripe_dispute_id, severity,
               amount_charged_minor, amount_reversed_minor,
               currency, observed_status, resulting_status,
               policy_version, decided_consequence,
               service_state, consequence_applied,
               owner_review_required, tier_change_event_id,
               provider_facts, provider_facts_digest,
               provider_observed_at, occurred_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, $16, 'USD', $17,
               $18, $19, $20, $21, $22, $23, $24,
               $25::jsonb, $26, $27, $28
             )
             returning *`,
            [
              input.reversalId,
              subscription.tenantId,
              subscription.projectId,
              subscription.localSubscriptionId,
              subscription.paymentReceiptId,
              subscription.creditApplicationId,
              input.eventRowId,
              reversal.reversalKind,
              reversal.outcome,
              reversal.stripeChargeId,
              reversal.stripePaymentIntentId,
              reversal.stripeRefundId,
              reversal.stripeDisputeId,
              decision.severity,
              reversal.amountChargedMinor,
              reversal.amountReversedMinor,
              subscription.status,
              resultingStatus,
              decision.policyVersion,
              decision.consequence,
              decision.serviceState,
              decision.tierEventKind !== null,
              decision.ownerReviewRequired,
              input.tierEventId,
              JSON.stringify({
                ...clone(reversal),
                decision: clone(decision)
              }),
              reversal.providerFactsDigest,
              reversal.providerObservedAt,
              input.event.occurredAt
            ]
          );
          invariant(
            inserted.rowCount === 1,
            "repository_conflict",
            "the Alakazam reversal was not recorded",
            { status: 500 }
          );
          return deepFreeze({
            status: "reversal_recorded",
            provider: "stripe",
            reversalId: input.reversalId,
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            stripeChargeId: reversal.stripeChargeId,
            severity: decision.severity,
            subscriptionStatus: resultingStatus,
            consequenceApplied:
              decision.tierEventKind !== null,
            ownerReviewRequired:
              decision.ownerReviewRequired,
            decision: clone(decision),
            next: "owner_reconciliation"
          });
        })
      );
    }
  });
}
