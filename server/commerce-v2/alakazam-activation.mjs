import { createHash } from "node:crypto";

import {
  ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
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
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ITEM_ID = /^si_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const START_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated"
]);

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
    "Alakazam activation release does not match the reviewed billing contract",
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
        "activateStartSubscription",
        "enqueueStartFulfillment",
        "findStartActivationBySubscription"
      ]
    ],
    [
      "provider",
      provider,
      ["readiness", "retrieveAlakazamSubscription"]
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

export function isAlakazamStartActivationEvent(event) {
  return (
    START_EVENT_TYPES.has(event?.type) &&
    event?.data?.object?.metadata?.schema ===
      ALAKAZAM_PROVIDER_METADATA_SCHEMA &&
    event.data.object.metadata.change_kind === "start"
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      START_EVENT_TYPES.has(value.type) &&
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
    "The verified Alakazam Subscription event is invalid",
    { status: 400 }
  );
  const stripeSubscriptionId = requiredText(
    value.data.object.id,
    "event.data.object.id",
    255
  );
  invariant(
    SUBSCRIPTION_ID.test(stripeSubscriptionId),
    "stripe_event_invalid",
    "The verified Alakazam event has no Subscription",
    { status: 400 }
  );
  return deepFreeze({
    stripeEventId: value.id,
    eventType: value.type,
    livemode: value.livemode,
    apiVersion: value.api_version,
    stripeSubscriptionId,
    metadata: clone(value.data.object.metadata),
    payloadDigest: createHash("sha256")
      .update(JSON.stringify(value), "utf8")
      .digest("hex"),
    signatureVerifiedAt: verifiedAt,
    occurredAt: new Date(value.created * 1000).toISOString()
  });
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
    "the durable Alakazam start purpose is invalid"
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
      "the durable Alakazam start purpose is invalid",
      { status: 500 }
    );
  }
  invariant(
    value.schema === ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      value.mode === "subscription_start" &&
      value.purpose.changeKind === "start" &&
      digest(value) === digest(expected),
    "repository_conflict",
    "the durable Alakazam start purpose changed",
    { status: 500 }
  );
  return expected;
}

function exactActivationResult(value, expected = {}) {
  exactKeys(
    value,
    [
      "changeKind",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "projectId",
      "provider",
      "quoteId",
      "receiptId",
      "revision",
      "status",
      "subscriptionId",
      "subscriptionProviderFactsDigest",
      "tierId"
    ],
    "repository_conflict",
    "the durable Alakazam start activation is invalid"
  );
  requiredIso(
    value.currentPeriodStartsAt,
    "activation.currentPeriodStartsAt"
  );
  requiredIso(
    value.currentPeriodEndsAt,
    "activation.currentPeriodEndsAt"
  );
  requiredDigest(
    value.subscriptionProviderFactsDigest,
    "activation.subscriptionProviderFactsDigest"
  );
  invariant(
    value.status === "active" &&
      value.provider === "stripe" &&
      value.changeKind === "start" &&
      UUID.test(value.projectId) &&
      UUID.test(value.quoteId) &&
      UUID.test(value.receiptId) &&
      UUID.test(value.subscriptionId) &&
      Number.isSafeInteger(value.revision) &&
      value.revision >= 2 &&
      typeof value.tierId === "string" &&
      Date.parse(value.currentPeriodEndsAt) >
        Date.parse(value.currentPeriodStartsAt) &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam start activation changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactPending(value, reservation, stripeSubscriptionId) {
  exactKeys(
    value,
    [
      "amountMinor",
      "paymentProviderFactsDigest",
      "providerFactsDigest",
      "providerObservedAt",
      "receiptId",
      "revision",
      "stripePriceId",
      "stripeSubscriptionId",
      "stripeSubscriptionItemId",
      "subscriptionId",
      "tierId"
    ],
    "repository_conflict",
    "the pending Alakazam start is invalid"
  );
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
  requiredIso(
    value.providerObservedAt,
    "pending.providerObservedAt"
  );
  requiredDigest(
    value.providerFactsDigest,
    "pending.providerFactsDigest"
  );
  requiredDigest(
    value.paymentProviderFactsDigest,
    "pending.paymentProviderFactsDigest"
  );
  invariant(
    UUID.test(value.subscriptionId) &&
      UUID.test(value.receiptId) &&
      value.revision === 1 &&
      value.stripeSubscriptionId === stripeSubscriptionId &&
      SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      PRICE_ID.test(value.stripePriceId) &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify the pending Alakazam start",
    { status: 400 }
  );
  return deepFreeze(clone(value));
}

function exactResolved(value, stripeSubscriptionId) {
  exactKeys(
    value,
    value?.status === "active"
      ? [
          "activation",
          "provider",
          "reservation",
          "status",
          "stripeSubscriptionId"
        ]
      : [
          "pending",
          "provider",
          "reservation",
          "status"
        ],
    "repository_conflict",
    "the Alakazam start activation binding is invalid"
  );
  const reservation = exactReservation(value.reservation);
  invariant(
    ["pending", "active"].includes(value.status) &&
      value.provider === "stripe",
    "stripe_event_binding_invalid",
    "The Stripe event has no durable Alakazam start",
    { status: 400 }
  );
  if (value.status === "active") {
    invariant(
      value.stripeSubscriptionId === stripeSubscriptionId &&
        SUBSCRIPTION_ID.test(value.stripeSubscriptionId),
      "stripe_event_binding_invalid",
      "The Stripe event does not identify the active Alakazam start",
      { status: 400 }
    );
    return Object.freeze({
      status: "active",
      reservation,
      activation: exactActivationResult(value.activation, {
        projectId: reservation.projectId,
        quoteId: reservation.quoteId
      })
    });
  }
  return Object.freeze({
    status: "pending",
    reservation,
    pending: exactPending(
      value.pending,
      reservation,
      stripeSubscriptionId
    )
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
    "The verified Stripe event does not match the durable Alakazam start",
    { status: 400 }
  );
  return expected;
}

function exactSubscription(value, resolved) {
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
    "stripe_alakazam_activation_mismatch",
    "Stripe returned invalid Alakazam activation evidence"
  );
  const reservation = resolved.reservation;
  const pending = resolved.pending;
  const target = resolveAlakazamTier(
    reservation.purpose.targetTierId
  );
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
  const observedAt = requiredIso(
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
      value.stripeSubscriptionId ===
        pending.stripeSubscriptionId &&
      value.stripeSubscriptionItemId ===
        pending.stripeSubscriptionItemId &&
      value.stripeCustomerId ===
        reservation.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.stripePriceId === pending.stripePriceId &&
      value.stripeScheduleId === null &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      value.cancelAtPeriodEnd === false &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      Date.parse(observedAt) >
        Date.parse(pending.providerObservedAt) &&
      sameExactObject(
        value.metadata,
        createAlakazamProviderMetadata({
          purpose: reservation.purpose,
          purposeDigest: reservation.purposeDigest
        })
      ) &&
      digest(facts) === value.providerFactsDigest,
    "stripe_alakazam_activation_mismatch",
    "Stripe returned changed Alakazam activation evidence",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamStartActivationService({
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

  async function enqueueFulfillment(resolved, activation) {
    await ports.repository.enqueueStartFulfillment({
      tenantId: resolved.reservation.tenantId,
      customerId: resolved.reservation.customerId,
      projectId: activation.projectId,
      quoteId: activation.quoteId,
      subscriptionId: activation.subscriptionId,
      subscriptionRevision: activation.revision,
      tierId: activation.tierId,
      operationId: nextUuid(
        ports.ids,
        "alakazam_fulfillment_operation"
      ),
      enqueuedAt: exactClock(ports.clock)
    });
    return activation;
  }

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        activation: false,
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
        activation: false,
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
        activation: false,
        state: "unavailable",
        code:
          status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      activation: true,
      state: "subscription_readback_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamStartActivationEvent(input)) {
        return deepFreeze({
          status: "not_alakazam_start_activation"
        });
      }
      const status = await readiness();
      invariant(
        status.ready === true &&
          status.activation === true,
        "alakazam_activation_reconciliation_unavailable",
        "Alakazam activation confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam Subscription event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolved(
        await ports.repository
          .findStartActivationBySubscription({
            stripeSubscriptionId:
              event.stripeSubscriptionId
          }),
        event.stripeSubscriptionId
      );
      exactMetadata(event.metadata, resolved.reservation);
      if (resolved.status === "active") {
        return enqueueFulfillment(
          resolved,
          resolved.activation
        );
      }
      let subscription;
      try {
        subscription = exactSubscription(
          await ports.provider
            .retrieveAlakazamSubscription({
              stripeCustomerId:
                resolved.reservation.stripeCustomerId,
              stripeSubscriptionId:
                event.stripeSubscriptionId
            }),
          resolved
        );
      } catch {
        invariant(
          false,
          "alakazam_activation_reconciliation_unavailable",
          "Alakazam activation confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const result =
        await ports.repository.activateStartSubscription({
          reservation: clone(resolved.reservation),
          subscriptionId:
            resolved.pending.subscriptionId,
          receiptId: resolved.pending.receiptId,
          event,
          subscription,
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_subscription_event"
          ),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_tier_event"
          )
        });
      const activation = exactActivationResult(result, {
        projectId: resolved.reservation.projectId,
        quoteId: resolved.reservation.quoteId,
        receiptId: resolved.pending.receiptId,
        subscriptionId:
          resolved.pending.subscriptionId,
        tierId: resolved.reservation.purpose.targetTierId,
        subscriptionProviderFactsDigest:
          subscription.providerFactsDigest
      });
      return enqueueFulfillment(resolved, activation);
    }
  });
}
