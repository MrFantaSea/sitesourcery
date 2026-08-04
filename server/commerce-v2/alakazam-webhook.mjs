import {
  ALAKAZAM_PROVIDER_METADATA_SCHEMA
} from "./alakazam.mjs";
import {
  isAlakazamStartActivationEvent
} from "./alakazam-activation.mjs";
import {
  isAlakazamDowngradeActivationEvent
} from "./alakazam-downgrade-activation.mjs";
import {
  isAlakazamCheckoutPaymentEvent
} from "./alakazam-payment.mjs";
import {
  isAlakazamUpgradeActivationEvent
} from "./alakazam-upgrade.mjs";
import {
  deepFreeze,
  invariant
} from "./canonical.mjs";

const ALAKAZAM_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated"
]);

function exactService(value, name, method = "ingestStripeEvent") {
  invariant(
    value &&
      typeof value[method] === "function",
    "invalid_configuration",
    `${name} service is incomplete`,
    { status: 500 }
  );
  return value;
}

function exactCheckoutChangeKind(event) {
  const changeKind =
    event?.data?.object?.metadata?.change_kind;
  invariant(
    changeKind === "start" || changeKind === "upgrade",
    "stripe_event_invalid",
    "The verified Alakazam Checkout event has an invalid change kind",
    { status: 400 }
  );
  return changeKind;
}

export function isPotentialAlakazamStripeEvent(event) {
  return (
    ALAKAZAM_EVENT_TYPES.has(event?.type) &&
    event?.data?.object?.metadata?.schema ===
      ALAKAZAM_PROVIDER_METADATA_SCHEMA
  );
}

export function createAlakazamStripeEventRouter({
  payment,
  startActivation,
  upgradeActivation,
  upgradeApplication,
  downgradeActivation
} = {}) {
  const services = Object.freeze({
    payment: exactService(
      payment,
      "Alakazam payment"
    ),
    startActivation: exactService(
      startActivation,
      "Alakazam start activation"
    ),
    upgradeActivation: exactService(
      upgradeActivation,
      "Alakazam upgrade activation"
    ),
    upgradeApplication: exactService(
      upgradeApplication,
      "Alakazam upgrade application",
      "applyPaidUpgrade"
    ),
    downgradeActivation: exactService(
      downgradeActivation,
      "Alakazam downgrade activation"
    )
  });

  return Object.freeze({
    async ingestStripeEvent(event) {
      if (!isPotentialAlakazamStripeEvent(event)) {
        return deepFreeze({ status: "not_alakazam" });
      }
      if (isAlakazamCheckoutPaymentEvent(event)) {
        const changeKind = exactCheckoutChangeKind(event);
        const settlement =
          await services.payment.ingestStripeEvent(event);
        if (changeKind === "upgrade") {
          return services.upgradeApplication
            .applyPaidUpgrade(settlement);
        }
        return settlement;
      }
      if (isAlakazamStartActivationEvent(event)) {
        return services.startActivation
          .ingestStripeEvent(event);
      }
      if (isAlakazamUpgradeActivationEvent(event)) {
        return services.upgradeActivation
          .ingestStripeEvent(event);
      }
      if (
        isAlakazamDowngradeActivationEvent(event)
      ) {
        return services.downgradeActivation
          .ingestStripeEvent(event);
      }
      invariant(
        false,
        "stripe_event_invalid",
        "The verified Alakazam Stripe event has an invalid change kind",
        { status: 400 }
      );
    }
  });
}
