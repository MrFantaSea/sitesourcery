import {
  ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA,
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

export const ALAKAZAM_UPGRADE_APPLICATION_SCHEMA =
  "sitesourcery.alakazam-upgrade-application/v1";

const UPGRADE_APPLICATION_LEASE_MS = 2 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ITEM_ID = /^si_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const PROVIDER_RECONCILIATIONS = new Set([
  "confirmed",
  "confirmed_after_ambiguous_submit",
  "confirmed_before_submit",
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
    "Alakazam upgrade release does not match the reviewed billing contract",
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
        "claimUpgradeApplication",
        "confirmUpgradeProvider",
        "findUpgradeApplication",
        "markUpgradeReconciliationRequired"
      ]
    ],
    [
      "provider",
      provider,
      [
        "applyAlakazamUpgrade",
        "readiness",
        "retrieveAlakazamSubscription"
      ]
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

function exactSettlement(value) {
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
    "invalid_input",
    "the paid Alakazam upgrade handoff is invalid"
  );
  const selected = {
    status: value.status,
    provider: value.provider,
    changeKind: value.changeKind,
    dispatchId: exactUuid(value.dispatchId, "dispatchId"),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscriptionId"
    ),
    receiptId: exactUuid(value.receiptId, "receiptId"),
    paymentProviderFactsDigest: requiredDigest(
      value.paymentProviderFactsDigest,
      "paymentProviderFactsDigest"
    ),
    next: value.next
  };
  invariant(
    selected.status === "payment_settled" &&
      selected.provider === "stripe" &&
      selected.changeKind === "upgrade" &&
      selected.next === "provider_change",
    "invalid_input",
    "the paid Alakazam upgrade handoff is invalid"
  );
  return deepFreeze(selected);
}

function exactReservation(value, settlement) {
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
    "the durable Alakazam upgrade purpose is invalid"
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
      "the durable Alakazam upgrade purpose is invalid",
      { status: 500 }
    );
  }
  const current = expected.purpose.currentSubscription;
  invariant(
    value.schema === ALAKAZAM_CHECKOUT_DISPATCH_SCHEMA &&
      expected.mode === "upgrade_difference" &&
      expected.purpose.changeKind === "upgrade" &&
      expected.purpose.downloadCredit === null &&
      current &&
      digest(value) === digest(expected) &&
      expected.dispatchId === settlement.dispatchId &&
      expected.projectId === settlement.projectId &&
      expected.quoteId === settlement.quoteId &&
      current.localSubscriptionId ===
        settlement.subscriptionId,
    "repository_conflict",
    "the durable paid Alakazam upgrade changed",
    { status: 500 }
  );
  return expected;
}

function exactApplication(value, settlement, reservation) {
  exactKeys(
    value,
    [
      "applicationId",
      "claimedAt",
      "idempotencyKey",
      "leaseExpiresAt",
      "paymentProviderFactsDigest",
      "receiptId",
      "schema",
      "subscriptionId"
    ],
    "repository_conflict",
    "the durable Alakazam upgrade application is invalid"
  );
  const applicationId = exactUuid(
    value.applicationId,
    "applicationId"
  );
  const claimedAt = requiredIso(
    value.claimedAt,
    "application.claimedAt"
  );
  const leaseExpiresAt = requiredIso(
    value.leaseExpiresAt,
    "application.leaseExpiresAt"
  );
  invariant(
    value.schema === ALAKAZAM_UPGRADE_APPLICATION_SCHEMA &&
      value.idempotencyKey ===
        `alakazam:upgrade:apply:${applicationId}` &&
      Date.parse(leaseExpiresAt) ===
        Date.parse(claimedAt) + UPGRADE_APPLICATION_LEASE_MS &&
      value.subscriptionId === settlement.subscriptionId &&
      value.subscriptionId ===
        reservation.purpose.currentSubscription
          .localSubscriptionId &&
      value.receiptId === settlement.receiptId &&
      value.paymentProviderFactsDigest ===
        settlement.paymentProviderFactsDigest,
    "repository_conflict",
    "the durable Alakazam upgrade application changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactProviderMetadata(reservation, application) {
  return {
    ...createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    }),
    payment_receipt_id: application.receiptId,
    payment_facts_digest:
      application.paymentProviderFactsDigest
  };
}

function exactTargetSubscription(
  value,
  reservation,
  application,
  selectedReconciliation = null
) {
  const withReconciliation = clone(value);
  const reconciliation =
    selectedReconciliation ?? withReconciliation.reconciliation;
  delete withReconciliation.reconciliation;
  exactKeys(
    withReconciliation,
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
    "stripe_alakazam_upgrade_mismatch",
    "Stripe returned invalid Alakazam upgrade evidence"
  );
  const purpose = reservation.purpose;
  const current = purpose.currentSubscription;
  const target = resolveAlakazamTier(purpose.targetTierId);
  const startsAt = requiredIso(
    withReconciliation.currentPeriodStartsAt,
    "subscription.currentPeriodStartsAt"
  );
  const endsAt = requiredIso(
    withReconciliation.currentPeriodEndsAt,
    "subscription.currentPeriodEndsAt"
  );
  requiredIso(
    withReconciliation.billingCycleAnchor,
    "subscription.billingCycleAnchor"
  );
  const observedAt = requiredIso(
    withReconciliation.providerObservedAt,
    "subscription.providerObservedAt"
  );
  requiredDigest(
    withReconciliation.providerFactsDigest,
    "subscription.providerFactsDigest"
  );
  const facts = clone(withReconciliation);
  delete facts.providerFactsDigest;
  invariant(
    PROVIDER_RECONCILIATIONS.has(reconciliation) &&
      withReconciliation.schema ===
        ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA &&
      withReconciliation.stripeSubscriptionId ===
        current.stripeSubscriptionId &&
      SUBSCRIPTION_ID.test(
        withReconciliation.stripeSubscriptionId
      ) &&
      withReconciliation.stripeSubscriptionItemId ===
        current.stripeSubscriptionItemId &&
      SUBSCRIPTION_ITEM_ID.test(
        withReconciliation.stripeSubscriptionItemId
      ) &&
      withReconciliation.stripeCustomerId ===
        reservation.stripeCustomerId &&
      CUSTOMER_ID.test(withReconciliation.stripeCustomerId) &&
      PRICE_ID.test(withReconciliation.stripePriceId) &&
      withReconciliation.stripePriceId !==
        current.stripePriceId &&
      withReconciliation.stripeScheduleId === null &&
      withReconciliation.tierId === target.tierId &&
      withReconciliation.amountMinor ===
        target.price.amountMinor &&
      withReconciliation.currency === "USD" &&
      withReconciliation.providerStatus === "active" &&
      withReconciliation.cancelAtPeriodEnd === false &&
      startsAt === current.currentPeriodStartsAt &&
      endsAt === current.currentPeriodEndsAt &&
      Date.parse(endsAt) > Date.parse(startsAt) &&
      Date.parse(observedAt) >=
        Date.parse(application.claimedAt) &&
      sameExactObject(
        withReconciliation.metadata,
        exactProviderMetadata(reservation, application)
      ) &&
      digest(facts) ===
        withReconciliation.providerFactsDigest,
    "stripe_alakazam_upgrade_mismatch",
    "Stripe did not confirm the exact paid Alakazam upgrade",
    { status: 502 }
  );
  return deepFreeze({
    subscription: withReconciliation,
    reconciliation
  });
}

function exactConfirmation(
  value,
  settlement,
  reservation,
  application
) {
  exactKeys(
    value,
    [
      "applicationId",
      "changeKind",
      "currentPeriodEndsAt",
      "currentPeriodStartsAt",
      "currentRevision",
      "next",
      "paymentProviderFactsDigest",
      "priorTierId",
      "projectId",
      "provider",
      "quoteId",
      "receiptId",
      "reconciliation",
      "status",
      "subscriptionId",
      "subscriptionProviderFactsDigest",
      "targetTierId"
    ],
    "repository_conflict",
    "the durable Alakazam upgrade confirmation is invalid"
  );
  const current = reservation.purpose.currentSubscription;
  requiredDigest(
    value.subscriptionProviderFactsDigest,
    "subscriptionProviderFactsDigest"
  );
  invariant(
    ["provider_confirmed", "applied"].includes(
      value.status
    ) &&
      value.provider === "stripe" &&
      value.changeKind === "upgrade" &&
      value.applicationId === application.applicationId &&
      value.projectId === settlement.projectId &&
      value.quoteId === settlement.quoteId &&
      value.subscriptionId === settlement.subscriptionId &&
      value.receiptId === settlement.receiptId &&
      value.paymentProviderFactsDigest ===
        settlement.paymentProviderFactsDigest &&
      value.priorTierId === current.tierId &&
      value.targetTierId ===
        reservation.purpose.targetTierId &&
      value.currentRevision === current.revision &&
      value.currentPeriodStartsAt ===
        current.currentPeriodStartsAt &&
      value.currentPeriodEndsAt ===
        current.currentPeriodEndsAt &&
      PROVIDER_RECONCILIATIONS.has(value.reconciliation) &&
      value.next ===
        (value.status === "provider_confirmed"
          ? "subscription_event_confirmation"
          : "complete"),
    "repository_conflict",
    "the durable Alakazam upgrade confirmation changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolved(value, settlement) {
  exactKeys(
    value,
    ["application", "provider", "reservation", "status"].concat(
      ["provider_confirmed", "applied"].includes(value?.status)
        ? ["confirmation"]
        : []
    ),
    "repository_conflict",
    "the Alakazam upgrade application binding is invalid"
  );
  invariant(
    [
      "applied",
      "claimed",
      "in_progress",
      "provider_confirmed",
      "reconciliation_required"
    ].includes(value.status) && value.provider === "stripe",
    "repository_conflict",
    "the Alakazam upgrade application state is invalid",
    { status: 500 }
  );
  const reservation = exactReservation(
    value.reservation,
    settlement
  );
  const application = exactApplication(
    value.application,
    settlement,
    reservation
  );
  return Object.freeze({
    status: value.status,
    reservation,
    application,
    confirmation:
      ["provider_confirmed", "applied"].includes(value.status)
        ? exactConfirmation(
            value.confirmation,
            settlement,
            reservation,
            application
          )
        : null
  });
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

function safeProviderErrorCode(error) {
  const selected =
    typeof error?.code === "string" &&
    /^[a-z0-9_]{1,200}$/u.test(error.code)
      ? error.code
      : "stripe_alakazam_upgrade_effect_unknown";
  return selected;
}

export function createAlakazamUpgradeService({
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
        upgrade: false,
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
        upgrade: false,
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
        upgrade: false,
        state: "unavailable",
        code:
          status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      upgrade: true,
      state: "upgrade_application_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  async function markReconciliation(
    resolved,
    errorCode
  ) {
    try {
      await ports.repository
        .markUpgradeReconciliationRequired({
          reservation: clone(resolved.reservation),
          application: clone(resolved.application),
          errorCode,
          markedAt: exactClock(ports.clock)
        });
    } catch {
      // Provider uncertainty remains the public-safe result even if the
      // separate durable ambiguity marker also needs operator repair.
    }
  }

  async function confirmProvider(
    resolved,
    selected
  ) {
    let result;
    try {
      result = await ports.repository.confirmUpgradeProvider({
        reservation: clone(resolved.reservation),
        application: clone(resolved.application),
        subscription: clone(selected.subscription),
        reconciliation: selected.reconciliation,
        confirmedAt: exactClock(ports.clock)
      });
    } catch {
      await markReconciliation(
        resolved,
        "upgrade_confirmation_persistence_failed"
      );
      invariant(
        false,
        "alakazam_upgrade_reconciliation_required",
        "The paid Alakazam upgrade needs reconciliation before the tier can change.",
        { status: 409 }
      );
    }
    return exactConfirmation(
      result,
      // The exact settlement identities are already bound into the
      // application and reservation at this point.
      {
        projectId: resolved.reservation.projectId,
        quoteId: resolved.reservation.quoteId,
        subscriptionId: resolved.application.subscriptionId,
        receiptId: resolved.application.receiptId,
        paymentProviderFactsDigest:
          resolved.application.paymentProviderFactsDigest
      },
      resolved.reservation,
      resolved.application
    );
  }

  return Object.freeze({
    readiness,

    async applyPaidUpgrade(input) {
      const status = await readiness();
      invariant(
        status.ready === true && status.upgrade === true,
        "alakazam_upgrade_unavailable",
        "Alakazam upgrade confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const settlement = exactSettlement(input);
      const observedAt = exactClock(ports.clock);
      let raw = await ports.repository
        .findUpgradeApplication({
          settlement: clone(settlement),
          observedAt
        });
      if (raw === null) {
        raw = await ports.repository.claimUpgradeApplication({
          settlement: clone(settlement),
          applicationId: nextUuid(
            ports.ids,
            "alakazam_upgrade_application"
          ),
          claimedAt: observedAt
        });
      }
      const resolved = exactResolved(raw, settlement);
      if (
        resolved.status === "provider_confirmed" ||
        resolved.status === "applied"
      ) {
        return resolved.confirmation;
      }
      invariant(
        resolved.status !== "in_progress",
        "alakazam_upgrade_in_progress",
        "The paid Alakazam upgrade is already being confirmed.",
        { status: 409 }
      );

      if (resolved.status === "reconciliation_required") {
        try {
          const selected = exactTargetSubscription(
            await ports.provider
              .retrieveAlakazamSubscription({
                stripeCustomerId:
                  resolved.reservation.stripeCustomerId,
                stripeSubscriptionId:
                  resolved.reservation.purpose
                    .currentSubscription
                    .stripeSubscriptionId
              }),
            resolved.reservation,
            resolved.application,
            "readback_after_ambiguity"
          );
          return confirmProvider(resolved, selected);
        } catch {
          invariant(
            false,
            "alakazam_upgrade_reconciliation_required",
            "The paid Alakazam upgrade needs reconciliation before the tier can change.",
            { status: 409 }
          );
        }
      }

      let selected;
      try {
        selected = exactTargetSubscription(
          await ports.provider.applyAlakazamUpgrade({
            idempotencyKey:
              resolved.application.idempotencyKey,
            purpose: clone(resolved.reservation.purpose),
            purposeDigest:
              resolved.reservation.purposeDigest,
            paymentEvidence: {
              receiptId: resolved.application.receiptId,
              providerFactsDigest:
                resolved.application
                  .paymentProviderFactsDigest
            }
          }),
          resolved.reservation,
          resolved.application
        );
      } catch (error) {
        await markReconciliation(
          resolved,
          safeProviderErrorCode(error)
        );
        invariant(
          false,
          "alakazam_upgrade_reconciliation_required",
          "The paid Alakazam upgrade needs reconciliation before the tier can change.",
          { status: 409 }
        );
      }
      return confirmProvider(resolved, selected);
    }
  });
}
