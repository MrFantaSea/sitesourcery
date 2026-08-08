import { createHash } from "node:crypto";

import {
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  resolveAlakazamTier
} from "./alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "./alakazam-billing.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ITEM_ID = /^si_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const SCHEDULE_ID = /^sub_sched_[A-Za-z0-9_]+$/u;
const SCHEDULE_UUID = UUID;
const TAX_MODES = new Set(["automatic", "disabled_by_owner"]);

export const ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA =
  "sitesourcery.stripe-alakazam-renewal-invoice/v1";
export const ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA =
  "sitesourcery.alakazam-renewal-subscription/v1";
export const ALAKAZAM_RENEWAL_PROJECTION_SCHEMA =
  "sitesourcery.alakazam-renewal-projection/v1";

// Stripe presents one paid subscription cycle through more than one
// event alias. Both aliases are accepted as a wake signal and both
// must converge on exactly one invoice operation.
export const ALAKAZAM_RENEWAL_EVENT_TYPES = Object.freeze([
  "invoice.paid",
  "invoice.payment_succeeded"
]);

const RENEWAL_EVENT_TYPES = new Set(
  ALAKAZAM_RENEWAL_EVENT_TYPES
);

function exactKeys(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message
  );
  return value;
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

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value && JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam renewal release does not match the reviewed billing contract",
    { status: 500 }
  );
  return expected;
}

function validatePorts(repository, provider, clock, ids) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "findRenewalSubscriptionByInvoice",
        "settleRenewalPayment"
      ]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamRenewalInvoice"]
    ],
    ["clock", clock, ["now"]],
    ["ids", ids, ["next"]]
  ]) {
    invariant(
      value &&
        methods.every(
          (method) => typeof value[method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return { repository, provider, clock, ids };
}

function invoiceSubscriptionId(object) {
  // Stripe has presented the owning subscription both as a
  // top-level invoice field and inside the invoice parent. Neither
  // shape is trusted for money; both are only used to find the
  // durable local owner.
  const candidates = [
    object?.subscription,
    object?.subscription?.id,
    object?.parent?.subscription_details?.subscription,
    object?.parent?.subscription_details?.subscription?.id
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      SUBSCRIPTION_ID.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

export function isAlakazamRenewalInvoiceEvent(event) {
  const object = event?.data?.object;
  return (
    RENEWAL_EVENT_TYPES.has(event?.type) &&
    object &&
    typeof object === "object" &&
    !Array.isArray(object) &&
    object.object === "invoice" &&
    typeof object.id === "string" &&
    INVOICE_ID.test(object.id) &&
    invoiceSubscriptionId(object) !== null
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      RENEWAL_EVENT_TYPES.has(value.type) &&
      typeof value.livemode === "boolean" &&
      typeof value.api_version === "string" &&
      value.api_version.length >= 3 &&
      value.api_version.length <= 100 &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object" &&
      !Array.isArray(value.data.object),
    "stripe_event_invalid",
    "The verified Alakazam renewal event is invalid",
    { status: 400 }
  );
  const stripeInvoiceId = requiredText(
    value.data.object.id,
    "event.data.object.id",
    255
  );
  const stripeSubscriptionId = invoiceSubscriptionId(
    value.data.object
  );
  invariant(
    INVOICE_ID.test(stripeInvoiceId) &&
      stripeSubscriptionId !== null,
    "stripe_event_invalid",
    "The verified Alakazam renewal event has no invoiced Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeInvoiceId,
    stripeSubscriptionId,
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactLocalSubscription(value, event) {
  exactKeys(
    value,
    [
      "amountMinor",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "customerId",
      "localSubscriptionId",
      "projectId",
      "providerFactsDigest",
      "providerObservedAt",
      "revision",
      "schema",
      "status",
      "stripeCustomerId",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "taxMode",
      "tenantId",
      "tierId"
    ],
    "repository_conflict",
    "the durable Alakazam renewal subscription is invalid"
  );
  const tier = resolveAlakazamTier(value.tierId);
  const startsAt = requiredIso(
    value.currentPeriodStartsAt,
    "subscription.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    value.currentPeriodEndsAt,
    "subscription.currentPeriodEndsAt"
  );
  invariant(
    value.schema === ALAKAZAM_RENEWAL_SUBSCRIPTION_SCHEMA &&
      UUID.test(value.localSubscriptionId) &&
      UUID.test(value.tenantId) &&
      UUID.test(value.customerId) &&
      UUID.test(value.projectId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      value.amountMinor === tier.price.amountMinor &&
      value.currency === "USD" &&
      value.status === "active" &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      PRICE_ID.test(value.stripePriceId) &&
      TAX_MODES.has(value.taxMode) &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      requiredIso(
        value.providerObservedAt,
        "subscription.providerObservedAt"
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "subscription.providerFactsDigest"
      ) &&
      value.stripeSubscriptionId === event.stripeSubscriptionId,
    "repository_conflict",
    "the durable Alakazam renewal subscription changed",
    { status: 500 }
  );
  // A subscription already scheduled to stop does not renew. The
  // money question belongs to owner reconciliation, never to an
  // automatic new period.
  invariant(
    value.cancelAtPeriodEnd === false,
    "alakazam_renewal_reconciliation_required",
    "The invoiced Alakazam subscription is scheduled to end and cannot renew automatically.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

function exactPendingDowngrade(value, subscription) {
  if (value === null || value === undefined) return null;
  exactKeys(
    value,
    ["effectiveAt", "scheduleId", "targetTierId"],
    "repository_conflict",
    "the durable Alakazam pending downgrade is invalid"
  );
  const target = resolveAlakazamTier(value.targetTierId);
  const current = resolveAlakazamTier(subscription.tierId);
  invariant(
    SCHEDULE_UUID.test(value.scheduleId) &&
      target.rank < current.rank &&
      requiredIso(value.effectiveAt, "downgrade.effectiveAt"),
    "repository_conflict",
    "the durable Alakazam pending downgrade changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

/**
 * Project the next renewal from committed facts only.
 *
 * The next renewal moment is the provider-confirmed period end. It is
 * never a guessed calendar date. The projected tier is the confirmed
 * current tier unless an accepted downgrade is already scheduled to
 * land on exactly that boundary.
 */
export function projectAlakazamNextRenewal({
  tierId,
  confirmedPeriodEndsAt,
  pendingDowngrade = null
} = {}) {
  const nextRenewalAt = requiredIso(
    confirmedPeriodEndsAt,
    "confirmedPeriodEndsAt"
  );
  const current = resolveAlakazamTier(tierId);
  const scheduled =
    pendingDowngrade &&
    pendingDowngrade.effectiveAt === nextRenewalAt
      ? resolveAlakazamTier(pendingDowngrade.targetTierId)
      : null;
  const selected = scheduled ?? current;
  return deepFreeze({
    schema: ALAKAZAM_RENEWAL_PROJECTION_SCHEMA,
    nextRenewalAt,
    tierId: selected.tierId,
    amountMinor: selected.price.amountMinor,
    currency: "USD",
    basis: scheduled
      ? "scheduled_downgrade"
      : "provider_confirmed_period",
    certainty: "provider_confirmed_boundary"
  });
}

function exactSettlementResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "currency",
      "next",
      "paidAmountMinor",
      "periodEndsAt",
      "periodStartsAt",
      "projection",
      "projectId",
      "provider",
      "providerFactsDigest",
      "receiptId",
      "revision",
      "settlementId",
      "status",
      "stripeInvoiceId",
      "subscriptionId"
    ],
    "repository_conflict",
    "the durable Alakazam renewal result is invalid"
  );
  const startsAt = requiredIso(
    value.periodStartsAt,
    "renewal.periodStartsAt"
  );
  const endsAt = requiredIso(
    value.periodEndsAt,
    "renewal.periodEndsAt"
  );
  exactKeys(
    value.projection,
    [
      "amountMinor",
      "basis",
      "certainty",
      "currency",
      "nextRenewalAt",
      "schema",
      "tierId"
    ],
    "repository_conflict",
    "the durable Alakazam renewal projection is invalid"
  );
  invariant(
    value.status === "renewal_settled" &&
      value.provider === "stripe" &&
      UUID.test(value.settlementId) &&
      UUID.test(value.subscriptionId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.receiptId) &&
      INVOICE_ID.test(value.stripeInvoiceId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 1 &&
      Number.isSafeInteger(value.paidAmountMinor) &&
      value.paidAmountMinor > 0 &&
      value.currency === "USD" &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      value.projection.schema ===
        ALAKAZAM_RENEWAL_PROJECTION_SCHEMA &&
      value.projection.nextRenewalAt === endsAt &&
      value.projection.certainty ===
        "provider_confirmed_boundary" &&
      requiredDigest(
        value.providerFactsDigest,
        "renewal.providerFactsDigest"
      ) &&
      value.next === "complete" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam renewal result changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedRenewal(value, event) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
    "repository_conflict",
    "the Alakazam renewal binding is invalid",
    { status: 500 }
  );
  if (value.status === "not_alakazam") {
    exactKeys(
      value,
      ["status"],
      "repository_conflict",
      "the Alakazam renewal binding is invalid"
    );
    return Object.freeze({ status: "not_alakazam" });
  }
  exactKeys(
    value,
    [
      "pendingDowngrade",
      "provider",
      "status",
      "stripeInvoiceId",
      "subscription"
    ].concat(value?.status === "settled" ? ["settlement"] : []),
    "repository_conflict",
    "the Alakazam renewal binding is invalid"
  );
  const subscription = exactLocalSubscription(
    value.subscription,
    event
  );
  invariant(
    ["current", "settled"].includes(value.status) &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam renewal",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    subscription,
    pendingDowngrade: exactPendingDowngrade(
      value.pendingDowngrade,
      subscription
    ),
    settlement:
      value.status === "settled"
        ? exactSettlementResult(value.settlement, {
            subscriptionId: subscription.localSubscriptionId,
            projectId: subscription.projectId,
            stripeInvoiceId: event.stripeInvoiceId
          })
        : null
  });
}

function exactRenewedSubscriptionFacts(
  value,
  resolved,
  invoice
) {
  exactKeys(
    value,
    [
      "amountMinor",
      "billingCycleAnchor",
      "cancelAtPeriodEnd",
      "currency",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "metadata",
      "providerFactsDigest",
      "providerObservedAt",
      "providerStatus",
      "schema",
      "stripeCustomerId",
      "stripePriceId",
      "stripeScheduleId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "tierId"
    ],
    "stripe_alakazam_renewal_mismatch",
    "Stripe returned invalid Alakazam renewal Subscription evidence"
  );
  const local = resolved.subscription;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const startsAt = requiredIso(
    value.currentPeriodStartsAt,
    "subscription.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    value.currentPeriodEndsAt,
    "subscription.currentPeriodEndsAt"
  );
  requiredIso(
    value.billingCycleAnchor,
    "subscription.billingCycleAnchor"
  );
  requiredIso(
    value.providerObservedAt,
    "subscription.providerObservedAt"
  );
  invariant(
    value.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      value.stripeSubscriptionId ===
        local.stripeSubscriptionId &&
      value.stripeSubscriptionItemId ===
        local.stripeSubscriptionItemId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      value.stripePriceId === local.stripePriceId &&
      value.tierId === local.tierId &&
      value.amountMinor === local.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      // The renewed period continues the paid boundary exactly.
      startsAt === local.currentPeriodEndsAt &&
      startsAt === invoice.periodStartsAt &&
      endsAt === invoice.periodEndsAt &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      requiredDigest(
        value.providerFactsDigest,
        "subscription.providerFactsDigest"
      ) === digest(facts),
    "stripe_alakazam_renewal_mismatch",
    "Stripe did not confirm the exact renewed Alakazam period",
    { status: 502 }
  );
  // A provider cancellation observed at readback time is a separate
  // lifecycle fact. It is never folded into a renewal revision. A
  // Schedule may only be attached when an accepted downgrade is
  // already recorded locally.
  invariant(
    value.cancelAtPeriodEnd === false &&
      (resolved.pendingDowngrade === null
        ? value.stripeScheduleId === null
        : typeof value.stripeScheduleId === "string" &&
          SCHEDULE_ID.test(value.stripeScheduleId)),
    "alakazam_renewal_reconciliation_required",
    "The renewed Alakazam subscription carries an unreconciled provider change.",
    { status: 409 }
  );
  return deepFreeze(clone(value));
}

function exactInvoiceFacts(value, resolved, event) {
  exactKeys(
    value,
    [
      "amountPaidMinor",
      "amountRemainingMinor",
      "billingReason",
      "collectionMethod",
      "currency",
      "listSubtotalMinor",
      "netSubtotalMinor",
      "paidOutOfBand",
      "periodEndsAt",
      "periodStartsAt",
      "provider",
      "providerFactsDigest",
      "providerObservedAt",
      "providerPaymentTime",
      "schema",
      "status",
      "stripeCustomerId",
      "stripeInvoiceId",
      "stripePaymentIntentId",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "subscription",
      "taxMinor",
      "taxMode",
      "tierId",
      "totalMinor"
    ],
    "stripe_alakazam_renewal_mismatch",
    "Stripe returned invalid Alakazam renewal invoice evidence"
  );
  const local = resolved.subscription;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const periodStartsAt = requiredIso(
    value.periodStartsAt,
    "invoice.periodStartsAt"
  );
  const periodEndsAt = requiredIso(
    value.periodEndsAt,
    "invoice.periodEndsAt"
  );
  const paymentTime = requiredIso(
    value.providerPaymentTime,
    "invoice.providerPaymentTime"
  );
  requiredIso(
    value.providerObservedAt,
    "invoice.providerObservedAt"
  );
  invariant(
    value.schema ===
        ALAKAZAM_RENEWAL_INVOICE_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.stripeInvoiceId === event.stripeInvoiceId &&
      INVOICE_ID.test(value.stripeInvoiceId) &&
      value.stripeSubscriptionId ===
        local.stripeSubscriptionId &&
      value.stripeSubscriptionItemId ===
        local.stripeSubscriptionItemId &&
      value.stripeCustomerId === local.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.stripePriceId === local.stripePriceId &&
      PRICE_ID.test(value.stripePriceId) &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      value.tierId === local.tierId &&
      value.status === "paid" &&
      value.listSubtotalMinor === local.amountMinor &&
      value.netSubtotalMinor === local.amountMinor &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.totalMinor ===
        value.netSubtotalMinor + value.taxMinor &&
      value.amountPaidMinor === value.totalMinor &&
      value.amountRemainingMinor === 0 &&
      value.taxMode === local.taxMode &&
      (value.taxMode === "automatic" ||
        value.taxMinor === 0) &&
      value.currency === "USD" &&
      Date.parse(periodEndsAt) > Date.parse(periodStartsAt) &&
      Date.parse(paymentTime) <=
        Date.parse(event.signatureVerifiedAt) &&
      requiredDigest(
        value.providerFactsDigest,
        "invoice.providerFactsDigest"
      ) === digest(facts),
    "stripe_alakazam_renewal_mismatch",
    "Stripe returned changed Alakazam renewal invoice evidence",
    { status: 502 }
  );
  // An invoice that was manually marked paid, paid out of band, or
  // raised for any reason other than the recurring cycle is owner
  // review. It never becomes an automatic renewal receipt.
  invariant(
    value.billingReason === "subscription_cycle" &&
      value.collectionMethod === "charge_automatically" &&
      value.paidOutOfBand === false,
    "alakazam_renewal_reconciliation_required",
    "The paid Alakazam invoice is not an automatically collected renewal cycle.",
    { status: 409 }
  );
  // The renewal must continue the exact local paid boundary.
  invariant(
    periodStartsAt === local.currentPeriodEndsAt,
    "alakazam_renewal_reconciliation_required",
    "The paid Alakazam invoice does not continue the confirmed billing period.",
    { status: 409 }
  );
  const subscription = exactRenewedSubscriptionFacts(
    value.subscription,
    resolved,
    { periodStartsAt, periodEndsAt }
  );
  return deepFreeze({
    ...clone(value),
    subscription: clone(subscription)
  });
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamRenewalService({
  repository,
  provider,
  clock,
  ids,
  release = createAlakazamBillingRelease()
} = {}) {
  const ports = validatePorts(
    repository,
    provider,
    clock,
    ids
  );
  const authority = exactRelease(release);

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        renewal: false,
        state: "held",
        code: "alakazam_billing_release_held"
      });
    }
    let status;
    try {
      status = await ports.provider.readiness();
    } catch (error) {
      return deepFreeze({
        ready: false,
        renewal: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxMode !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        renewal: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      renewal: true,
      state: "renewal_readback_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamRenewalInvoiceEvent(input)) {
        return deepFreeze({ status: "not_alakazam_renewal" });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.renewal === true,
        "alakazam_renewal_reconciliation_unavailable",
        "Alakazam renewal confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam renewal event mode is invalid",
        { status: 400 }
      );
      // Ownership is resolved from durable local identifiers. Invoice
      // metadata is never sufficient, and an unowned invoice makes no
      // local mutation at all.
      const resolved = exactResolvedRenewal(
        await ports.repository
          .findRenewalSubscriptionByInvoice({
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId: event.stripeSubscriptionId
          }),
        event
      );
      if (resolved.status === "not_alakazam") {
        return deepFreeze({ status: "not_alakazam_renewal" });
      }
      if (resolved.status === "settled") {
        return resolved.settlement;
      }

      let invoice;
      try {
        invoice = await ports.provider
          .retrieveAlakazamRenewalInvoice({
            stripeInvoiceId: event.stripeInvoiceId,
            stripeSubscriptionId:
              resolved.subscription.stripeSubscriptionId,
            stripeCustomerId:
              resolved.subscription.stripeCustomerId
          });
      } catch {
        invariant(
          false,
          "alakazam_renewal_reconciliation_unavailable",
          "Alakazam renewal confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const facts = exactInvoiceFacts(
        invoice,
        resolved,
        event
      );
      const projection = projectAlakazamNextRenewal({
        tierId: resolved.subscription.tierId,
        confirmedPeriodEndsAt: facts.periodEndsAt,
        pendingDowngrade: resolved.pendingDowngrade
      });
      const result =
        await ports.repository.settleRenewalPayment({
          subscription: clone(resolved.subscription),
          pendingDowngrade: resolved.pendingDowngrade
            ? clone(resolved.pendingDowngrade)
            : null,
          event,
          invoice: clone(facts),
          projection: clone(projection),
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_renewal_event"
          ),
          receiptId: nextUuid(
            ports.ids,
            "alakazam_renewal_receipt"
          ),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_renewal_tier_event"
          ),
          settlementId: nextUuid(
            ports.ids,
            "alakazam_renewal_settlement"
          )
        });
      return exactSettlementResult(result, {
        subscriptionId:
          resolved.subscription.localSubscriptionId,
        projectId: resolved.subscription.projectId,
        stripeInvoiceId: event.stripeInvoiceId,
        periodStartsAt: facts.periodStartsAt,
        periodEndsAt: facts.periodEndsAt,
        paidAmountMinor: facts.netSubtotalMinor,
        providerFactsDigest:
          facts.subscription.providerFactsDigest
      });
    }
  });
}
