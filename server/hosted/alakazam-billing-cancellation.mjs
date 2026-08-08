import {
  deepFreeze,
  invariant,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";
import {
  ALAKAZAM_ACCOUNT_SCHEMA
} from "../commerce-v2/alakazam-account.mjs";
import {
  exactAlakazamBillingScope
} from "./alakazam-billing-invoice.mjs";

export const ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA =
  "sitesourcery.alakazam-cancellation-preview/v1";

/**
 * Every Alakazam tier carries `cancellation_policy` as a release blocker and
 * every issued disclosure records
 * `cancellationPolicy: "owner_review_required_before_release"`
 * (server/commerce-v2/alakazam.mjs). This surface therefore previews only the
 * consequences the durable record already proves — the dates, what stops, and
 * what is kept — and refuses to state refund or proration amounts or to offer
 * a confirmation, until the owner releases the policy.
 */
export const ALAKAZAM_CANCELLATION_POLICY =
  "owner_review_required_before_release";
const ALAKAZAM_CANCELLATION_POLICY_BLOCKER =
  "cancellation_policy";

const PREVIEW_STATES = new Set([
  "available",
  "already_scheduled",
  "not_applicable"
]);
const PREVIEW_REASONS = new Set([
  "cancellation_preview_only",
  "cancellation_already_scheduled",
  "no_cancellable_subscription"
]);

function record(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value)
  );
}

function exactAccountSnapshot(value, scope) {
  invariant(
    record(value) &&
      value.schema === ALAKAZAM_ACCOUNT_SCHEMA &&
      value.projectId === scope.projectId &&
      record(value.site),
    "repository_conflict",
    "the customer Alakazam account snapshot is unavailable",
    { status: 500 }
  );
  return value;
}

function previewSubscription(subscription) {
  return Object.freeze({
    tierId: requiredText(
      subscription.tier.tierId,
      "subscription.tier.tierId",
      100
    ),
    name: requiredText(
      subscription.tier.name,
      "subscription.tier.name",
      100
    ),
    status: subscription.status,
    amountMinor: subscription.price.amountMinor,
    currency: "USD",
    currentPeriodEndsAt: requiredIso(
      subscription.currentPeriod.endsAt,
      "subscription.currentPeriod.endsAt"
    )
  });
}

function previewWebsite(site, endsAt) {
  return Object.freeze({
    state: site.state,
    hostname: site.hostname,
    url: site.url,
    publishedUntil: site.state === "live" ? endsAt : null,
    // Publication authority is bound to the paid subscription tier and
    // revision (ss.alakazam_tier_fulfillment); no revision survives the end
    // of the subscription, so nothing keeps the address published after it.
    afterEnd: "not_published"
  });
}

function stoppedRenewal(account, subscription) {
  const renewal = account.nextRenewal;
  if (!record(renewal)) {
    return null;
  }
  return Object.freeze({
    tierId: renewal.tierId,
    amountMinor: renewal.amountMinor,
    currency: "USD",
    dueAt: requiredIso(
      renewal.dueAt,
      "nextRenewal.dueAt"
    ),
    chargedIfCancelled: false,
    currentTierId: subscription.tier.tierId
  });
}

/**
 * E-08. Projects the exact, customer-safe preview of what cancelling would do,
 * plus the Billing Portal entry state. Both are read-only: this surface never
 * schedules a cancellation and never opens a provider session.
 */
export function projectAlakazamCancellationPreview(
  accountInput,
  scopeInput,
  { billingPortalState = "held" } = {}
) {
  const scope = exactAlakazamBillingScope(
    scopeInput,
    "scope"
  );
  const account = exactAccountSnapshot(
    accountInput,
    scope
  );
  const subscription = account.subscription;
  const cancellable =
    record(subscription) &&
    record(subscription.currentPeriod) &&
    ["active", "grace", "suspended"].includes(
      subscription.status
    );
  const alreadyScheduled =
    cancellable && subscription.cancelAtPeriodEnd === true;
  const state = !cancellable
    ? "not_applicable"
    : alreadyScheduled
      ? "already_scheduled"
      : "available";
  const reason = !cancellable
    ? "no_cancellable_subscription"
    : alreadyScheduled
      ? "cancellation_already_scheduled"
      : "cancellation_preview_only";
  invariant(
    PREVIEW_STATES.has(state) &&
      PREVIEW_REASONS.has(reason),
    "repository_conflict",
    "the Alakazam cancellation preview state is invalid",
    { status: 500 }
  );
  invariant(
    billingPortalState === "held",
    "billing_portal_state_unavailable",
    "the Alakazam Billing Portal state is unavailable",
    { status: 500 }
  );
  const endsAt = cancellable
    ? requiredIso(
        subscription.currentPeriod.endsAt,
        "subscription.currentPeriod.endsAt"
      )
    : null;
  return deepFreeze({
    schema: ALAKAZAM_CANCELLATION_PREVIEW_SCHEMA,
    projectId: scope.projectId,
    state,
    accountState: account.state,
    subscription: cancellable
      ? previewSubscription(subscription)
      : null,
    effect: cancellable
      ? {
          endsAt,
          keepsAccessUntil: endsAt,
          alreadyScheduled,
          website: previewWebsite(account.site, endsAt),
          renewalStopped: stoppedRenewal(
            account,
            subscription
          ),
          savedSetupKept: true,
          receiptsKept: true,
          // The money consequence of cancelling is an owner decision that has
          // not been released, so no amount is stated here.
          refund: {
            state: "owner_review_required",
            cashRefundMinor: null,
            providerProration: null
          }
        }
      : null,
    policy: {
      cancellationPolicy: ALAKAZAM_CANCELLATION_POLICY,
      released: false,
      releaseBlocker:
        ALAKAZAM_CANCELLATION_POLICY_BLOCKER
    },
    actions: {
      confirmCancellation: {
        available: false,
        reason: "cancellation_policy_owner_review_required"
      },
      billingPortal: {
        available: false,
        state: billingPortalState,
        reason: "alakazam_billing_held"
      },
      reason
    }
  });
}
