import { createHash } from "node:crypto";

import {
  ALAKAZAM_CATALOG_VERSION,
  ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_TERMS_VERSION,
  createAlakazamCheckoutDispatch,
  createAlakazamProviderMetadata,
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
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ITEM_ID = /^si_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const INVOICE_ID = /^in_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const PAYMENT_EVENT_TYPE = "checkout.session.completed";

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

function sameExactObject(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(
      ([key, selected]) => value[key] === selected
    )
  );
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

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value && JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam payment release does not match the reviewed billing contract",
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
        "findCheckoutDispatchBySession",
        "settleCheckoutPayment"
      ]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamPayment"]
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

function exactClock(clock) {
  const value = clock.now();
  return requiredIso(
    value instanceof Date
      ? value.toISOString()
      : String(value ?? ""),
    "clock.now"
  );
}

export function isAlakazamCheckoutPaymentEvent(event) {
  return (
    event?.type === PAYMENT_EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      ALAKAZAM_PROVIDER_METADATA_SCHEMA
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      value.type === PAYMENT_EVENT_TYPE &&
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
    "The verified Alakazam Stripe event is invalid",
    { status: 400 }
  );
  const checkoutSessionId = requiredText(
    value.data.object.id,
    "event.data.object.id",
    255
  );
  invariant(
    CHECKOUT_ID.test(checkoutSessionId),
    "stripe_event_invalid",
    "The verified Alakazam event has no Checkout Session",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    checkoutSessionId,
    metadata: clone(value.data.object.metadata),
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
}

function exactCheckoutUrl(value) {
  const selected = requiredText(value, "checkout.url", 4096);
  let parsed;
  try {
    parsed = new URL(selected);
  } catch {
    invariant(
      false,
      "repository_conflict",
      "the durable Alakazam Checkout destination is invalid",
      { status: 500 }
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "repository_conflict",
    "the durable Alakazam Checkout destination is invalid",
    { status: 500 }
  );
  return parsed.toString();
}

function exactReservation(value) {
  exactKeys(
    value,
    [
      "claimedAt",
      "currency",
      "customerId",
      "dispatchId",
      "expectedCreditMinor",
      "expectedSubtotalMinor",
      "idempotencyKey",
      "leaseExpiresAt",
      "mode",
      "projectId",
      "provider",
      "purpose",
      "purposeDigest",
      "quoteId",
      "schema",
      "state",
      "stripeCustomerId",
      "tenantId"
    ],
    "repository_conflict",
    "the durable Alakazam Checkout reservation is invalid"
  );
  let expected;
  try {
    expected = createAlakazamCheckoutDispatch({
      dispatchId: value.dispatchId,
      tenantId: value.tenantId,
      customerId: value.customerId,
      projectId: value.projectId,
      quoteId: value.quoteId,
      stripeCustomerId: value.stripeCustomerId,
      acceptedDisclosureDigest:
        value.purpose.acceptedDisclosureDigest,
      quoteDigest: value.purpose.quoteDigest,
      changeKind: value.purpose.changeKind,
      currentSubscription:
        value.purpose.currentSubscription,
      targetTierId: value.purpose.targetTierId,
      dueNowSubtotalMinor:
        value.purpose.dueNowSubtotalMinor,
      taxMode: value.purpose.taxMode,
      downloadCredit: value.purpose.downloadCredit,
      claimedAt: value.claimedAt
    });
  } catch {
    invariant(
      false,
      "repository_conflict",
      "the durable Alakazam Checkout purpose is invalid",
      { status: 500 }
    );
  }
  invariant(
    value.schema === ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      digest(value) === digest(expected),
    "repository_conflict",
    "the durable Alakazam Checkout reservation changed",
    { status: 500 }
  );
  return expected;
}

function exactSettlementResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "changeKind",
      "dispatchId",
      "next",
      "paymentProviderFactsDigest",
      "projectId",
      "provider",
      "quoteId",
      "receiptId",
      "status",
      "subscriptionId"
    ],
    "repository_conflict",
    "the durable Alakazam payment result is invalid"
  );
  requiredDigest(
    value.paymentProviderFactsDigest,
    "paymentProviderFactsDigest"
  );
  invariant(
    value.status === "payment_settled" &&
      value.provider === "stripe" &&
      ["start", "upgrade"].includes(value.changeKind) &&
      UUID.test(value.dispatchId) &&
      UUID.test(value.projectId) &&
      UUID.test(value.quoteId) &&
      UUID.test(value.receiptId) &&
      UUID.test(value.subscriptionId) &&
      value.next ===
        (value.changeKind === "start"
          ? "subscription_confirmation"
          : "provider_change") &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam payment result changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolvedDispatch(value, checkoutSessionId) {
  exactKeys(
    value,
    value?.status === "settled"
      ? [
          "checkout",
          "provider",
          "reservation",
          "settlement",
          "status"
        ]
      : ["checkout", "provider", "reservation", "status"],
    "repository_conflict",
    "the Alakazam Checkout payment binding is invalid"
  );
  const reservation = exactReservation(value.reservation);
  exactKeys(
    value.checkout,
    ["checkoutId", "expiresAt", "url"],
    "repository_conflict",
    "the durable Alakazam Checkout evidence is invalid"
  );
  invariant(
    ["ready", "settled"].includes(value.status) &&
      value.provider === "stripe" &&
      CHECKOUT_ID.test(value.checkout.checkoutId) &&
      value.checkout.checkoutId === checkoutSessionId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Alakazam Checkout",
    { status: 400 }
  );
  const checkout = deepFreeze({
    checkoutId: value.checkout.checkoutId,
    url: exactCheckoutUrl(value.checkout.url),
    expiresAt: requiredIso(
      value.checkout.expiresAt,
      "checkout.expiresAt"
    )
  });
  return Object.freeze({
    status: value.status,
    reservation,
    checkout,
    settlement:
      value.status === "settled"
        ? exactSettlementResult(value.settlement, {
            dispatchId: reservation.dispatchId,
            projectId: reservation.projectId,
            quoteId: reservation.quoteId,
            changeKind: reservation.purpose.changeKind
          })
        : null
  });
}

function exactMetadata(value, reservation) {
  const expected = createAlakazamProviderMetadata({
    purpose: reservation.purpose,
    purposeDigest: reservation.purposeDigest
  });
  invariant(
    sameExactObject(value, expected),
    "stripe_event_binding_invalid",
    "The verified Stripe event does not match the durable Alakazam Checkout",
    { status: 400 }
  );
  return expected;
}

function exactSubscriptionFacts(value, reservation) {
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
    "stripe_alakazam_payment_mismatch",
    "Stripe returned invalid Alakazam Subscription evidence"
  );
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
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
  requiredDigest(
    value.providerFactsDigest,
    "subscription.providerFactsDigest"
  );
  invariant(
    value.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      PRICE_ID.test(value.stripePriceId) &&
      value.stripeScheduleId === null &&
      value.stripeCustomerId ===
        reservation.stripeCustomerId &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      value.cancelAtPeriodEnd === false &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      sameExactObject(
        value.metadata,
        createAlakazamProviderMetadata({
          purpose: reservation.purpose,
          purposeDigest: reservation.purposeDigest
        })
      ) &&
      digest(facts) === value.providerFactsDigest,
    "stripe_alakazam_payment_mismatch",
    "Stripe returned changed Alakazam Subscription evidence",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function exactPaymentFacts(value, resolved) {
  exactKeys(
    value,
    [
      "changeKind",
      "checkoutSessionId",
      "currency",
      "listSubtotalMinor",
      "netSubtotalMinor",
      "paymentStatus",
      "provider",
      "providerDiscountMinor",
      "providerFactsDigest",
      "providerPaymentTime",
      "purposeDigest",
      "schema",
      "stripeCustomerId",
      "stripeInvoiceId",
      "stripePaymentIntentId",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "subscription",
      "targetTierId",
      "taxMinor",
      "taxMode",
      "totalMinor"
    ],
    "stripe_alakazam_payment_mismatch",
    "Stripe returned invalid Alakazam payment evidence"
  );
  const reservation = resolved.reservation;
  const purpose = reservation.purpose;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  requiredDigest(
    value.providerFactsDigest,
    "payment.providerFactsDigest"
  );
  const paymentTime = requiredIso(
    value.providerPaymentTime,
    "payment.providerPaymentTime"
  );
  invariant(
    value.schema === ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA &&
      value.provider === "stripe" &&
      value.changeKind === purpose.changeKind &&
      value.checkoutSessionId === resolved.checkout.checkoutId &&
      value.stripeCustomerId === reservation.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      PRICE_ID.test(value.stripePriceId) &&
      PAYMENT_INTENT_ID.test(value.stripePaymentIntentId) &&
      value.targetTierId === purpose.targetTierId &&
      value.listSubtotalMinor ===
        (purpose.changeKind === "start"
          ? purpose.targetAmountMinor
          : purpose.dueNowSubtotalMinor) &&
      value.providerDiscountMinor ===
        (purpose.downloadCredit?.amountMinor ?? 0) &&
      value.netSubtotalMinor ===
        purpose.dueNowSubtotalMinor &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      value.totalMinor ===
        value.netSubtotalMinor + value.taxMinor &&
      value.taxMode === purpose.taxMode &&
      (value.taxMode === "automatic" || value.taxMinor === 0) &&
      value.currency === "USD" &&
      value.paymentStatus === "paid" &&
      value.purposeDigest === reservation.purposeDigest &&
      digest(facts) === value.providerFactsDigest,
    "stripe_alakazam_payment_mismatch",
    "Stripe returned changed Alakazam payment evidence",
    { status: 502 }
  );
  if (purpose.changeKind === "start") {
    invariant(
      INVOICE_ID.test(value.stripeInvoiceId),
      "stripe_alakazam_payment_mismatch",
      "Stripe start payment lacks its paid Invoice",
      { status: 502 }
    );
    const subscription = exactSubscriptionFacts(
      value.subscription,
      reservation
    );
    invariant(
      value.stripeSubscriptionId ===
          subscription.stripeSubscriptionId &&
        value.stripeSubscriptionItemId ===
          subscription.stripeSubscriptionItemId &&
        value.stripePriceId === subscription.stripePriceId,
      "stripe_alakazam_payment_mismatch",
      "Stripe start payment and Subscription evidence disagree",
      { status: 502 }
    );
  } else {
    const current = purpose.currentSubscription;
    invariant(
      value.stripeInvoiceId === null &&
        value.subscription === null &&
        value.stripeSubscriptionId ===
          current.stripeSubscriptionId &&
        value.stripeSubscriptionItemId ===
          current.stripeSubscriptionItemId,
      "stripe_alakazam_payment_mismatch",
      "Stripe upgrade payment changed the current Subscription evidence",
      { status: 502 }
    );
  }
  return deepFreeze({
    ...clone(value),
    providerPaymentTime: paymentTime
  });
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamPaymentService({
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
        payment: false,
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
        payment: false,
        state: "unavailable",
        code: error?.code ?? "stripe_not_ready"
      });
    }
    if (
      status?.ready !== true ||
      status.provider !== "stripe" ||
      status.alakazam !== true ||
      status.taxModes?.alakazam !== authority.taxMode ||
      typeof status.livemode !== "boolean"
    ) {
      return deepFreeze({
        ready: false,
        payment: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      payment: true,
      state: "payment_readback_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamCheckoutPaymentEvent(input)) {
        return deepFreeze({ status: "not_alakazam_payment" });
      }
      const status = await readiness();
      invariant(
        status.ready === true && status.payment === true,
        "alakazam_payment_reconciliation_unavailable",
        "Alakazam payment confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam Stripe event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolvedDispatch(
        await ports.repository
          .findCheckoutDispatchBySession({
            checkoutSessionId: event.checkoutSessionId
          }),
        event.checkoutSessionId
      );
      exactMetadata(event.metadata, resolved.reservation);
      if (resolved.status === "settled") {
        return resolved.settlement;
      }
      let payment;
      try {
        payment = exactPaymentFacts(
          await ports.provider.retrieveAlakazamPayment({
            checkoutSessionId: event.checkoutSessionId,
            purpose: clone(resolved.reservation.purpose),
            purposeDigest:
              resolved.reservation.purposeDigest
          }),
          resolved
        );
      } catch {
        invariant(
          false,
          "alakazam_payment_reconciliation_unavailable",
          "Alakazam payment confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const changeKind =
        resolved.reservation.purpose.changeKind;
      const result =
        await ports.repository.settleCheckoutPayment({
          reservation: clone(resolved.reservation),
          checkout: clone(resolved.checkout),
          event,
          payment,
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_payment_event"
          ),
          receiptId: nextUuid(
            ports.ids,
            "alakazam_payment_receipt"
          ),
          subscriptionId:
            changeKind === "start"
              ? nextUuid(
                  ports.ids,
                  "alakazam_subscription"
                )
              : exactUuid(
                  resolved.reservation.purpose
                    .currentSubscription.localSubscriptionId,
                  "currentSubscription.localSubscriptionId"
                ),
          creditApplicationId:
            resolved.reservation.purpose.downloadCredit
              ? nextUuid(
                  ports.ids,
                  "alakazam_credit_application"
                )
              : null,
          tierEventId:
            changeKind === "upgrade"
              ? nextUuid(
                  ports.ids,
                  "alakazam_tier_event"
                )
              : null
        });
      return exactSettlementResult(result, {
        dispatchId: resolved.reservation.dispatchId,
        projectId: resolved.reservation.projectId,
        quoteId: resolved.reservation.quoteId,
        changeKind,
        paymentProviderFactsDigest:
          payment.providerFactsDigest
      });
    }
  });
}
