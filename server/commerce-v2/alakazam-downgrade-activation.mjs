import { createHash } from "node:crypto";

import {
  ALAKAZAM_DOWNGRADE_APPLICATION_SCHEMA,
  ALAKAZAM_PROVIDER_METADATA_SCHEMA,
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamDowngradeApplication,
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
const SCHEDULE_ID = /^sub_sched_[A-Za-z0-9_]+$/u;
const EVENT_TYPE = "customer.subscription.updated";
const RECONCILIATIONS = new Set([
  "confirmed",
  "readback_after_ambiguity"
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

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value && JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam downgrade activation release does not match the reviewed billing contract",
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
        "activateDowngradeSubscription",
        "enqueueTierFulfillment",
        "findDowngradeActivationBySubscription"
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
      value && methods.every(
        (method) => typeof value[method] === "function"
      ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return { repository, provider, clock, ids };
}

function exactApplication(value) {
  exactKeys(
    value,
    [
      "claimedAt",
      "customerId",
      "effectiveAt",
      "idempotencyKey",
      "leaseExpiresAt",
      "projectId",
      "provider",
      "purpose",
      "purposeDigest",
      "quoteId",
      "scheduleId",
      "schema",
      "state",
      "stripeCustomerId",
      "subscriptionId",
      "tenantId"
    ],
    "repository_conflict",
    "the durable Alakazam downgrade application is invalid"
  );
  let expected;
  try {
    expected = createAlakazamDowngradeApplication({
      scheduleId: value.scheduleId,
      tenantId: value.tenantId,
      customerId: value.customerId,
      projectId: value.projectId,
      quoteId: value.quoteId,
      stripeCustomerId: value.stripeCustomerId,
      acceptedDisclosureDigest:
        value.purpose.acceptedDisclosureDigest,
      quoteDigest: value.purpose.quoteDigest,
      currentSubscription:
        value.purpose.currentSubscription,
      targetTierId: value.purpose.targetTierId,
      taxMode: value.purpose.taxMode,
      claimedAt: value.claimedAt
    });
  } catch {
    invariant(
      false,
      "repository_conflict",
      "the durable Alakazam downgrade application is invalid",
      { status: 500 }
    );
  }
  invariant(
    value.schema === ALAKAZAM_DOWNGRADE_APPLICATION_SCHEMA &&
      value.state === "reserved" &&
      value.provider === "stripe" &&
      digest(value) === digest(expected),
    "repository_conflict",
    "the durable Alakazam downgrade application changed",
    { status: 500 }
  );
  return expected;
}

function exactSchedule(value, application) {
  exactKeys(
    value,
    [
      "currentPriceId",
      "currentTierId",
      "effectiveAt",
      "endBehavior",
      "providerFactsDigest",
      "providerObservedAt",
      "providerProration",
      "schema",
      "stripeCustomerId",
      "stripeScheduleId",
      "stripeSubscriptionId",
      "targetPriceId",
      "targetTierId"
    ],
    "repository_conflict",
    "the durable Alakazam Schedule evidence is invalid"
  );
  const current = application.purpose.currentSubscription;
  const facts = clone(value);
  delete facts.providerFactsDigest;
  invariant(
    value.schema === ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA &&
      SCHEDULE_ID.test(value.stripeScheduleId) &&
      value.stripeSubscriptionId ===
        current.stripeSubscriptionId &&
      value.stripeCustomerId === application.stripeCustomerId &&
      value.currentTierId === current.tierId &&
      value.targetTierId === application.purpose.targetTierId &&
      value.currentPriceId === current.stripePriceId &&
      PRICE_ID.test(value.targetPriceId) &&
      value.targetPriceId !== value.currentPriceId &&
      value.effectiveAt === application.effectiveAt &&
      value.endBehavior === "release" &&
      value.providerProration === false &&
      Date.parse(requiredIso(
        value.providerObservedAt,
        "schedule.providerObservedAt"
      )) >= Date.parse(application.claimedAt) &&
      requiredDigest(
        value.providerFactsDigest,
        "schedule.providerFactsDigest"
      ) === digest(facts),
    "repository_conflict",
    "the durable Alakazam Schedule evidence changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactConfirmation(value, application, schedule) {
  exactKeys(
    value,
    [
      "currentRevision",
      "effectiveAt",
      "next",
      "priorTierId",
      "projectId",
      "provider",
      "providerFactsDigest",
      "quoteId",
      "reconciliation",
      "scheduleId",
      "status",
      "stripeScheduleId",
      "subscriptionId",
      "targetTierId"
    ],
    "repository_conflict",
    "the durable Alakazam downgrade confirmation is invalid"
  );
  const current = application.purpose.currentSubscription;
  invariant(
    value.status === "scheduled" &&
      value.provider === "stripe" &&
      value.scheduleId === application.scheduleId &&
      value.stripeScheduleId === schedule.stripeScheduleId &&
      value.projectId === application.projectId &&
      value.quoteId === application.quoteId &&
      value.subscriptionId === application.subscriptionId &&
      value.priorTierId === current.tierId &&
      value.targetTierId === application.purpose.targetTierId &&
      value.currentRevision === current.revision &&
      value.effectiveAt === application.effectiveAt &&
      value.providerFactsDigest ===
        schedule.providerFactsDigest &&
      RECONCILIATIONS.has(value.reconciliation) &&
      value.next === "boundary_confirmation",
    "repository_conflict",
    "the durable Alakazam downgrade confirmation changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactActivationResult(
  value,
  application,
  schedule,
  expected = {}
) {
  exactKeys(
    value,
    [
      "changeKind",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "next",
      "priorTierId",
      "projectId",
      "provider",
      "quoteId",
      "revision",
      "scheduleId",
      "scheduleProviderFactsDigest",
      "status",
      "subscriptionId",
      "subscriptionProviderFactsDigest",
      "targetTierId"
    ],
    "repository_conflict",
    "the durable Alakazam downgrade activation is invalid"
  );
  const current = application.purpose.currentSubscription;
  const startsAt = requiredIso(
    value.currentPeriodStartsAt,
    "activation.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    value.currentPeriodEndsAt,
    "activation.currentPeriodEndsAt"
  );
  invariant(
    value.status === "active" &&
      value.provider === "stripe" &&
      value.changeKind === "downgrade" &&
      value.scheduleId === application.scheduleId &&
      value.projectId === application.projectId &&
      value.quoteId === application.quoteId &&
      value.subscriptionId === application.subscriptionId &&
      value.priorTierId === current.tierId &&
      value.targetTierId === application.purpose.targetTierId &&
      value.revision === current.revision + 1 &&
      startsAt === application.effectiveAt &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      value.scheduleProviderFactsDigest ===
        schedule.providerFactsDigest &&
      requiredDigest(
        value.subscriptionProviderFactsDigest,
        "subscriptionProviderFactsDigest"
      ) &&
      value.next === "complete" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam downgrade activation changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolved(value, stripeSubscriptionId) {
  exactKeys(
    value,
    [
      "application",
      "confirmation",
      "provider",
      "schedule",
      "status",
      "stripeSubscriptionId"
    ].concat(value?.status === "applied" ? ["activation"] : []),
    "repository_conflict",
    "the Alakazam downgrade activation binding is invalid"
  );
  const application = exactApplication(value.application);
  const schedule = exactSchedule(value.schedule, application);
  const confirmation = exactConfirmation(
    value.confirmation,
    application,
    schedule
  );
  invariant(
    ["scheduled", "applied"].includes(value.status) &&
      value.provider === "stripe" &&
      value.stripeSubscriptionId === stripeSubscriptionId &&
      value.stripeSubscriptionId ===
        application.purpose.currentSubscription
          .stripeSubscriptionId,
    "stripe_event_binding_invalid",
    "The Stripe event does not identify the scheduled Alakazam downgrade",
    { status: 400 }
  );
  return Object.freeze({
    status: value.status,
    application,
    schedule,
    confirmation,
    activation:
      value.status === "applied"
        ? exactActivationResult(
            value.activation,
            application,
            schedule
          )
        : null
  });
}

export function isAlakazamDowngradeActivationEvent(event) {
  return (
    event?.type === EVENT_TYPE &&
    event?.data?.object?.metadata?.schema ===
      ALAKAZAM_PROVIDER_METADATA_SCHEMA &&
    event.data.object.metadata.change_kind === "downgrade"
  );
}

function exactEvent(value, verifiedAt) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      value.type === EVENT_TYPE &&
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
    "The verified Alakazam downgrade event is invalid",
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
    "The verified Alakazam downgrade event has no Subscription",
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

function exactEventReference(event) {
  const metadata = event.metadata;
  invariant(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      UUID.test(metadata.local_subscription_id) &&
      UUID.test(metadata.quote_id),
    "stripe_event_binding_invalid",
    "The verified Alakazam downgrade event has invalid local references",
    { status: 400 }
  );
  return Object.freeze({
    stripeSubscriptionId: event.stripeSubscriptionId,
    subscriptionId: metadata.local_subscription_id,
    quoteId: metadata.quote_id
  });
}

function exactEventMetadata(value, application) {
  const expected = createAlakazamProviderMetadata({
    purpose: application.purpose,
    purposeDigest: application.purposeDigest
  });
  invariant(
    sameExactObject(value, expected),
    "stripe_event_binding_invalid",
    "The verified Stripe event does not match the scheduled Alakazam downgrade",
    { status: 400 }
  );
  return expected;
}

function exactTargetSubscription(
  value,
  resolved,
  event
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
    "stripe_alakazam_downgrade_activation_mismatch",
    "Stripe returned invalid Alakazam downgrade activation evidence"
  );
  const application = resolved.application;
  const current = application.purpose.currentSubscription;
  const target = resolveAlakazamTier(
    application.purpose.targetTierId
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
  const observedAt = requiredIso(
    value.providerObservedAt,
    "subscription.providerObservedAt"
  );
  const facts = clone(value);
  delete facts.providerFactsDigest;
  invariant(
    value.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      value.stripeSubscriptionId ===
        current.stripeSubscriptionId &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      value.stripeSubscriptionItemId ===
        current.stripeSubscriptionItemId &&
      SUBSCRIPTION_ITEM_ID.test(
        value.stripeSubscriptionItemId
      ) &&
      value.stripeCustomerId ===
        application.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.stripePriceId ===
        resolved.schedule.targetPriceId &&
      PRICE_ID.test(value.stripePriceId) &&
      value.stripeScheduleId ===
        resolved.schedule.stripeScheduleId &&
      value.tierId === target.tierId &&
      value.amountMinor === target.price.amountMinor &&
      value.currency === "USD" &&
      value.providerStatus === "active" &&
      value.cancelAtPeriodEnd === false &&
      startsAt === application.effectiveAt &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      Date.parse(event.occurredAt) >=
        Date.parse(application.effectiveAt) &&
      Date.parse(event.occurredAt) < Date.parse(endsAt) &&
      Date.parse(event.signatureVerifiedAt) >=
        Date.parse(event.occurredAt) &&
      Date.parse(observedAt) >=
        Date.parse(event.signatureVerifiedAt) &&
      sameExactObject(
        value.metadata,
        createAlakazamProviderMetadata({
          purpose: application.purpose,
          purposeDigest: application.purposeDigest
        })
      ) &&
      requiredDigest(
        value.providerFactsDigest,
        "subscription.providerFactsDigest"
      ) === digest(facts),
    "stripe_alakazam_downgrade_activation_mismatch",
    "Stripe did not confirm the exact renewal-boundary Alakazam downgrade",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

export function createAlakazamDowngradeActivationService({
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

  async function enqueueTierFulfillment(
    resolved,
    activation
  ) {
    await ports.repository.enqueueTierFulfillment({
      tenantId: resolved.application.tenantId,
      customerId: resolved.application.customerId,
      projectId: activation.projectId,
      subscriptionId: activation.subscriptionId,
      subscriptionRevision: activation.revision,
      priorTierId: activation.priorTierId,
      tierId: activation.targetTierId,
      operationId: nextUuid(
        ports.ids,
        "alakazam_tier_fulfillment_operation"
      ),
      enqueuedAt: exactClock(ports.clock)
    });
    return activation;
  }

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        downgradeActivation: false,
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
        downgradeActivation: false,
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
        downgradeActivation: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      downgradeActivation: true,
      state: "downgrade_activation_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  return Object.freeze({
    readiness,

    async ingestStripeEvent(input) {
      if (!isAlakazamDowngradeActivationEvent(input)) {
        return deepFreeze({
          status: "not_alakazam_downgrade_activation"
        });
      }
      const status = await readiness();
      invariant(
        status.ready === true &&
          status.downgradeActivation === true,
        "alakazam_downgrade_activation_reconciliation_unavailable",
        "Alakazam downgrade activation confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const event = exactEvent(
        input,
        exactClock(ports.clock)
      );
      invariant(
        event.livemode === status.livemode,
        "stripe_event_invalid",
        "The Alakazam downgrade event mode is invalid",
        { status: 400 }
      );
      const resolved = exactResolved(
        await ports.repository
          .findDowngradeActivationBySubscription(
            exactEventReference(event)
          ),
        event.stripeSubscriptionId
      );
      exactEventMetadata(event.metadata, resolved.application);
      if (resolved.status === "applied") {
        return enqueueTierFulfillment(
          resolved,
          resolved.activation
        );
      }

      let subscription;
      try {
        subscription = exactTargetSubscription(
          await ports.provider
            .retrieveAlakazamSubscription({
              stripeCustomerId:
                resolved.application.stripeCustomerId,
              stripeSubscriptionId:
                event.stripeSubscriptionId
            }),
          resolved,
          event
        );
      } catch {
        invariant(
          false,
          "alakazam_downgrade_activation_reconciliation_unavailable",
          "Alakazam downgrade activation confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const result =
        await ports.repository.activateDowngradeSubscription({
          application: clone(resolved.application),
          confirmation: clone(resolved.confirmation),
          schedule: clone(resolved.schedule),
          event,
          subscription: clone(subscription),
          eventRowId: nextUuid(
            ports.ids,
            "alakazam_downgrade_subscription_event"
          ),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_downgrade_activation_tier_event"
          )
        });
      const activation = exactActivationResult(
        result,
        resolved.application,
        resolved.schedule,
        {
          subscriptionProviderFactsDigest:
            subscription.providerFactsDigest
        }
      );
      return enqueueTierFulfillment(
        resolved,
        activation
      );
    }
  });
}
