import {
  ALAKAZAM_DOWNGRADE_APPLICATION_SCHEMA,
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  createAlakazamDowngradeApplication,
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
const CUSTOMER_ID = /^cus_[A-Za-z0-9_]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const SCHEDULE_ID = /^sub_sched_[A-Za-z0-9_]+$/u;
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

function exactRelease(value) {
  const expected = createAlakazamBillingRelease({
    approved: value?.approved,
    taxMode: value?.taxMode ?? null
  });
  invariant(
    value && JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Alakazam downgrade release does not match the reviewed billing contract",
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
        "claimDowngradeApplication",
        "confirmDowngradeSchedule",
        "findDowngradeApplication",
        "markDowngradeReconciliationRequired"
      ]
    ],
    [
      "provider",
      provider,
      [
        "readiness",
        "retrieveAlakazamSchedule",
        "scheduleAlakazamDowngrade"
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

function exactCommand(value) {
  exactKeys(
    value,
    [
      "acceptedDisclosureDigest",
      "customerId",
      "projectId",
      "quoteDigest",
      "quoteId",
      "tenantId"
    ],
    "invalid_input",
    "the Alakazam downgrade command is invalid"
  );
  return deepFreeze({
    tenantId: exactUuid(value.tenantId, "tenantId"),
    customerId: exactUuid(value.customerId, "customerId"),
    projectId: exactUuid(value.projectId, "projectId"),
    quoteId: exactUuid(value.quoteId, "quoteId"),
    acceptedDisclosureDigest: requiredDigest(
      value.acceptedDisclosureDigest,
      "acceptedDisclosureDigest"
    ),
    quoteDigest: requiredDigest(
      value.quoteDigest,
      "quoteDigest"
    )
  });
}

function exactApplication(value, command) {
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
      value.tenantId === command.tenantId &&
      value.customerId === command.customerId &&
      value.projectId === command.projectId &&
      value.quoteId === command.quoteId &&
      value.purpose.acceptedDisclosureDigest ===
        command.acceptedDisclosureDigest &&
      value.purpose.quoteDigest === command.quoteDigest &&
      digest(value) === digest(expected),
    "repository_conflict",
    "the durable Alakazam downgrade application changed",
    { status: 500 }
  );
  return expected;
}

function exactProviderFacts(value, application) {
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
    "stripe_alakazam_downgrade_mismatch",
    "Stripe returned invalid Alakazam downgrade Schedule evidence"
  );
  const purpose = application.purpose;
  const current = purpose.currentSubscription;
  const target = resolveAlakazamTier(purpose.targetTierId);
  const facts = clone(value);
  delete facts.providerFactsDigest;
  const observedAt = requiredIso(
    value.providerObservedAt,
    "schedule.providerObservedAt"
  );
  invariant(
    value.schema === ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA &&
      SCHEDULE_ID.test(value.stripeScheduleId) &&
      value.stripeSubscriptionId ===
        current.stripeSubscriptionId &&
      SUBSCRIPTION_ID.test(value.stripeSubscriptionId) &&
      value.stripeCustomerId ===
        application.stripeCustomerId &&
      CUSTOMER_ID.test(value.stripeCustomerId) &&
      value.currentTierId === current.tierId &&
      value.targetTierId === target.tierId &&
      value.currentPriceId === current.stripePriceId &&
      PRICE_ID.test(value.currentPriceId) &&
      PRICE_ID.test(value.targetPriceId) &&
      value.targetPriceId !== value.currentPriceId &&
      value.effectiveAt === application.effectiveAt &&
      value.endBehavior === "release" &&
      value.providerProration === false &&
      Date.parse(observedAt) >=
        Date.parse(application.claimedAt) &&
      requiredDigest(
        value.providerFactsDigest,
        "schedule.providerFactsDigest"
      ) === digest(facts),
    "stripe_alakazam_downgrade_mismatch",
    "Stripe did not confirm the exact renewal-boundary Alakazam downgrade",
    { status: 502 }
  );
  return deepFreeze(clone(value));
}

function exactConfirmation(
  value,
  application,
  expected = {}
) {
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
      value.projectId === application.projectId &&
      value.quoteId === application.quoteId &&
      value.subscriptionId === application.subscriptionId &&
      value.priorTierId === current.tierId &&
      value.targetTierId ===
        application.purpose.targetTierId &&
      value.currentRevision === current.revision &&
      value.effectiveAt === application.effectiveAt &&
      SCHEDULE_ID.test(value.stripeScheduleId) &&
      requiredDigest(
        value.providerFactsDigest,
        "providerFactsDigest"
      ) &&
      RECONCILIATIONS.has(value.reconciliation) &&
      value.next === "boundary_confirmation" &&
      Object.entries(expected).every(
        ([field, selected]) => value[field] === selected
      ),
    "repository_conflict",
    "the durable Alakazam downgrade confirmation changed",
    { status: 500 }
  );
  return deepFreeze(clone(value));
}

function exactResolved(value, command) {
  exactKeys(
    value,
    [
      "application",
      "provider",
      "status",
      "stripeScheduleId"
    ].concat(value?.status === "scheduled" ? ["confirmation"] : []),
    "repository_conflict",
    "the Alakazam downgrade application binding is invalid"
  );
  invariant(
    [
      "claimed",
      "in_progress",
      "reconciliation_required",
      "scheduled"
    ].includes(value.status) &&
      value.provider === "stripe" &&
      (
        value.stripeScheduleId === null ||
        SCHEDULE_ID.test(value.stripeScheduleId)
      ),
    "repository_conflict",
    "the Alakazam downgrade application state is invalid",
    { status: 500 }
  );
  const application = exactApplication(
    value.application,
    command
  );
  invariant(
    value.status === "scheduled"
      ? value.stripeScheduleId !== null
      : value.status === "reconciliation_required" ||
        value.stripeScheduleId === null,
    "repository_conflict",
    "the Alakazam downgrade Schedule identity is invalid",
    { status: 500 }
  );
  return Object.freeze({
    status: value.status,
    application,
    stripeScheduleId: value.stripeScheduleId,
    confirmation:
      value.status === "scheduled"
        ? exactConfirmation(
            value.confirmation,
            application,
            {
              stripeScheduleId: value.stripeScheduleId
            }
          )
        : null
  });
}

function nextUuid(ids, label) {
  return exactUuid(ids.next(label), label);
}

function safeProviderError(error) {
  const code =
    typeof error?.code === "string" &&
    /^[a-z0-9_]{1,200}$/u.test(error.code)
      ? error.code
      : "stripe_alakazam_schedule_effect_unknown";
  const stripeScheduleId =
    typeof error?.details?.stripeScheduleId === "string" &&
    SCHEDULE_ID.test(error.details.stripeScheduleId)
      ? error.details.stripeScheduleId
      : null;
  return Object.freeze({ code, stripeScheduleId });
}

export function createAlakazamDowngradeService({
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
        downgrade: false,
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
        downgrade: false,
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
        downgrade: false,
        state: "unavailable",
        code: status?.code ?? "stripe_alakazam_not_ready"
      });
    }
    return deepFreeze({
      ready: true,
      downgrade: true,
      state: "downgrade_schedule_ready",
      provider: "stripe",
      livemode: status.livemode,
      taxMode: authority.taxMode
    });
  }

  async function markReconciliation(
    resolved,
    { code, stripeScheduleId }
  ) {
    try {
      return await ports.repository
        .markDowngradeReconciliationRequired({
          application: clone(resolved.application),
          errorCode: code,
          stripeScheduleId,
          markedAt: exactClock(ports.clock)
        });
    } catch {
      return null;
    }
  }

  async function persistConfirmation(
    resolved,
    schedule,
    reconciliation
  ) {
    try {
      const result =
        await ports.repository.confirmDowngradeSchedule({
          application: clone(resolved.application),
          schedule: clone(schedule),
          reconciliation,
          confirmedAt: exactClock(ports.clock),
          tierEventId: nextUuid(
            ports.ids,
            "alakazam_downgrade_tier_event"
          )
        });
      return exactConfirmation(
        result,
        resolved.application,
        {
          stripeScheduleId: schedule.stripeScheduleId,
          providerFactsDigest:
            schedule.providerFactsDigest,
          reconciliation
        }
      );
    } catch {
      const marked = await markReconciliation(resolved, {
        code: "downgrade_confirmation_persistence_failed",
        stripeScheduleId: schedule.stripeScheduleId
      });
      if (marked) {
        const recovered = exactResolved(
          marked,
          exactCommand({
            tenantId: resolved.application.tenantId,
            customerId: resolved.application.customerId,
            projectId: resolved.application.projectId,
            quoteId: resolved.application.quoteId,
            acceptedDisclosureDigest:
              resolved.application.purpose
                .acceptedDisclosureDigest,
            quoteDigest:
              resolved.application.purpose.quoteDigest
          })
        );
        if (recovered.status === "scheduled") {
          return recovered.confirmation;
        }
      }
      invariant(
        false,
        "alakazam_downgrade_reconciliation_required",
        "The Alakazam downgrade Schedule needs reconciliation before it can be confirmed.",
        { status: 409 }
      );
    }
  }

  return Object.freeze({
    readiness,

    async scheduleDowngrade(input) {
      const status = await readiness();
      invariant(
        status.ready === true && status.downgrade === true,
        "alakazam_downgrade_unavailable",
        "Alakazam downgrade scheduling is temporarily unavailable.",
        { status: 503 }
      );
      const command = exactCommand(input);
      const observedAt = exactClock(ports.clock);
      let raw = await ports.repository
        .findDowngradeApplication({
          command: clone(command),
          observedAt
        });
      if (raw === null) {
        raw = await ports.repository
          .claimDowngradeApplication({
            command: clone(command),
            scheduleId: nextUuid(
              ports.ids,
              "alakazam_downgrade_application"
            ),
            claimedAt: observedAt
          });
      }
      const resolved = exactResolved(raw, command);
      if (resolved.status === "scheduled") {
        return resolved.confirmation;
      }
      invariant(
        resolved.status !== "in_progress",
        "alakazam_downgrade_in_progress",
        "The Alakazam downgrade is already being scheduled.",
        { status: 409 }
      );

      if (resolved.status === "reconciliation_required") {
        invariant(
          resolved.stripeScheduleId !== null,
          "alakazam_downgrade_reconciliation_required",
          "The Alakazam downgrade Schedule needs owner reconciliation before it can continue.",
          { status: 409 }
        );
        let schedule;
        try {
          schedule = exactProviderFacts(
            await ports.provider.retrieveAlakazamSchedule({
              purpose: clone(resolved.application.purpose),
              purposeDigest:
                resolved.application.purposeDigest,
              stripeScheduleId:
                resolved.stripeScheduleId
            }),
            resolved.application
          );
        } catch {
          invariant(
            false,
            "alakazam_downgrade_reconciliation_required",
            "The Alakazam downgrade Schedule needs owner reconciliation before it can continue.",
            { status: 409 }
          );
        }
        return persistConfirmation(
          resolved,
          schedule,
          "readback_after_ambiguity"
        );
      }

      let schedule;
      try {
        schedule = exactProviderFacts(
          await ports.provider.scheduleAlakazamDowngrade({
            idempotencyKey:
              resolved.application.idempotencyKey,
            purpose: clone(resolved.application.purpose),
            purposeDigest:
              resolved.application.purposeDigest,
            stripeScheduleId: null
          }),
          resolved.application
        );
      } catch (error) {
        await markReconciliation(
          resolved,
          safeProviderError(error)
        );
        invariant(
          false,
          "alakazam_downgrade_reconciliation_required",
          "The Alakazam downgrade Schedule needs reconciliation before it can be confirmed.",
          { status: 409 }
        );
      }
      return persistConfirmation(
        resolved,
        schedule,
        "confirmed"
      );
    }
  });
}
