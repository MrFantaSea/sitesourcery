import { createHash } from "node:crypto";

import { ExternalEffectError } from "../domain/errors.mjs";
import {
  CHECKOUT_COMMAND_SCHEMA,
  CHECKOUT_DISPATCH_SCHEMA,
  CHECKOUT_PURPOSE_SCHEMA,
  DOWNLOAD_PAYMENT_RELEASE_SCHEMA,
  ENTITLEMENT_SCHEMA
} from "./constants.mjs";
import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";
import { authorizeProjectEntitlement } from "./entitlement.mjs";

const DOWNLOAD_METADATA_SCHEMA =
  "sitesourcery_download_checkout_v2";
const CHECKOUT_ID = /^cs_[A-Za-z0-9_]+$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/u;
const CHARGE_ID = /^ch_[A-Za-z0-9_]+$/u;
const DISPUTE_ID = /^(?:dp|du)_[A-Za-z0-9_]+$/u;
const DOWNLOAD_REVERSAL_EVENT_TYPES = new Set([
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"
]);

export function createDownloadPaymentRelease({
  approved = false
} = {}) {
  invariant(
    typeof approved === "boolean",
    "invalid_configuration",
    "Download payment approval must be boolean",
    { status: 500 }
  );
  return deepFreeze({
    schema: DOWNLOAD_PAYMENT_RELEASE_SCHEMA,
    approved,
    offerId: "spark_download",
    entitlementKind: "spark_download",
    scope: "editor_project",
    amountMinor: 500,
    currency: "USD",
    billing: "one_time",
    provider: "stripe"
  });
}

function exactRelease(value) {
  const expected = createDownloadPaymentRelease({
    approved: value?.approved
  });
  invariant(
    value &&
      JSON.stringify(value) === JSON.stringify(expected),
    "invalid_configuration",
    "Download payment release does not match the reviewed $5 contract",
    { status: 500 }
  );
  return expected;
}

function validatePorts({ repository, provider, clock, ids }) {
  for (const [name, value, methods] of [
    [
      "repository",
      repository,
      [
        "abandonDispatch",
        "claimDispatch",
        "claimStripeEvent",
        "completeDispatch",
        "expireDispatch",
        "findDispatchByCheckout",
        "findPaymentReceiptByIntent",
        "findProjectEntitlement",
        "findStripeCustomer",
        "markDispatchUnknown",
        "resolveDownloadArtifact",
        "applyPaymentReversal",
        "settleStripeEvent"
      ]
    ],
    [
      "provider",
      provider,
      [
        "createDownloadCheckout",
        "readiness",
        "retrieveDownloadCheckoutLifecycle",
        "retrieveDownloadCheckout"
      ]
    ],
    ["clock", clock, ["now"]],
    ["ids", ids, ["next"]]
  ]) {
    invariant(
      value &&
        methods.every(
          (method) =>
            typeof value[method] === "function"
        ),
      "invalid_configuration",
      `${name} port is incomplete`,
      { status: 500 }
    );
  }
  return { repository, provider, clock, ids };
}

function exactPreparation(value) {
  const purpose = value?.purpose;
  invariant(
    value?.schema === CHECKOUT_COMMAND_SCHEMA &&
      value.state === "held" &&
      value.holdReason ===
        "provider_dispatch_not_authorized" &&
      value.dispatchAuthorized === false &&
      value.provider === null &&
      purpose?.schema === CHECKOUT_PURPOSE_SCHEMA &&
      purpose.tenantId &&
      purpose.customerId &&
      purpose.projectId === value.projectId &&
      purpose.versionId === value.versionId &&
      purpose.quoteId === value.quoteId &&
      purpose.offerId === "spark_download" &&
      purpose.entitlementKind === "spark_download" &&
      purpose.price?.amountMinor === 500 &&
      purpose.price?.currency === "USD" &&
      purpose.price?.billing === "one_time" &&
      purpose.price?.interval === null &&
      value.offerId === "spark_download" &&
      value.entitlementKind === "spark_download" &&
      value.purposeDigest === digest(purpose),
    "invalid_preparation",
    "Download payment requires the exact durable held preparation",
    { status: 500 }
  );
  for (const [field, selected] of [
    ["commandId", value.commandId],
    ["tenantId", purpose.tenantId],
    ["customerId", purpose.customerId],
    ["projectId", value.projectId],
    ["versionId", value.versionId],
    ["quoteId", value.quoteId]
  ]) {
    requiredText(selected, field);
  }
  requiredDigest(
    purpose.acceptedDisclosureDigest,
    "purpose.acceptedDisclosureDigest"
  );
  requiredDigest(
    purpose.quoteSnapshotDigest,
    "purpose.quoteSnapshotDigest"
  );
  requiredDigest(value.purposeDigest, "purposeDigest");
  requiredIso(value.preparedAt, "preparedAt");
  return value;
}

function checkoutUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invariant(
      false,
      "provider_response_invalid",
      "Stripe returned an invalid Download Checkout URL",
      { status: 502 }
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      !parsed.port &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash,
    "provider_response_invalid",
    "Stripe returned an unapproved Download Checkout URL",
    { status: 502 }
  );
  return parsed.toString();
}

function dispatchResult(preparation, checkout, dispatchedAt) {
  invariant(
    checkout &&
      CHECKOUT_ID.test(checkout.checkoutId) &&
      Date.parse(
        requiredIso(
          checkout.expiresAt,
          "checkout.expiresAt"
        )
      ) > Date.parse(dispatchedAt),
    "provider_response_invalid",
    "Stripe returned an invalid Download Checkout",
    { status: 502 }
  );
  const url = checkoutUrl(checkout.url);
  return deepFreeze({
    schema: CHECKOUT_DISPATCH_SCHEMA,
    commandId: preparation.commandId,
    quoteId: preparation.quoteId,
    projectId: preparation.projectId,
    versionId: preparation.versionId,
    offerId: "spark_download",
    entitlementKind: "spark_download",
    state: "ready",
    dispatchAuthorized: true,
    provider: "stripe",
    dispatchedAt,
    purposeDigest: preparation.purposeDigest,
    checkout: {
      id: checkout.checkoutId,
      url,
      expiresAt: checkout.expiresAt
    },
    checkoutUrl: url
  });
}

function validateDispatchReplay(preparation, result) {
  invariant(
    result?.schema === CHECKOUT_DISPATCH_SCHEMA &&
      result.commandId === preparation.commandId &&
      result.quoteId === preparation.quoteId &&
      result.projectId === preparation.projectId &&
      result.versionId === preparation.versionId &&
      result.offerId === "spark_download" &&
      result.entitlementKind === "spark_download" &&
      result.state === "ready" &&
      result.dispatchAuthorized === true &&
      result.provider === "stripe" &&
      result.purposeDigest ===
        preparation.purposeDigest &&
      result.checkout?.id &&
      result.checkout?.url === result.checkoutUrl,
    "repository_conflict",
    "The durable Download Checkout replay is invalid",
    { status: 500 }
  );
  checkoutUrl(result.checkoutUrl);
  requiredIso(result.dispatchedAt, "dispatchedAt");
  requiredIso(
    result.checkout.expiresAt,
    "checkout.expiresAt"
  );
  return deepFreeze(clone(result));
}

function exactExpiryReconciliation(value) {
  const preparation = exactPreparation(
    value?.preparation
  );
  const result = validateDispatchReplay(
    preparation,
    value?.result
  );
  invariant(
    value?.checkoutSessionId ===
      result.checkout.id,
    "repository_conflict",
    "The expired Download Checkout reconciliation is invalid",
    { status: 500 }
  );
  return Object.freeze({
    preparation,
    result,
    checkoutSessionId: result.checkout.id
  });
}

function exactCheckoutLifecycle(value, reconciliation) {
  invariant(
    value?.schema ===
        "sitesourcery.stripe-download-checkout-lifecycle/v2" &&
      value.provider === "stripe" &&
      value.checkoutSessionId ===
        reconciliation.checkoutSessionId &&
      [
        "open_unpaid",
        "expired_unpaid",
        "completion_pending"
      ].includes(value.state),
    "provider_response_invalid",
    "Stripe returned an invalid Download Checkout lifecycle",
    { status: 502 }
  );
  return value.state;
}

function paymentUnavailable(error) {
  if (
    error instanceof ExternalEffectError &&
    error.certainty === "ambiguous"
  ) {
    return {
      ambiguous: true,
      code:
        error.code ??
        "stripe_download_checkout_effect_unknown"
    };
  }
  return {
    ambiguous: false,
    code:
      error?.code ?? "stripe_download_checkout_unavailable"
  };
}

function exactEvent(value) {
  invariant(
    value &&
      EVENT_ID.test(value.id) &&
      typeof value.type === "string" &&
      typeof value.livemode === "boolean" &&
      Number.isSafeInteger(value.created) &&
      value.created > 0 &&
      value.data?.object &&
      typeof value.data.object === "object",
    "stripe_event_invalid",
    "The verified Stripe event is invalid",
    { status: 400 }
  );
  return value;
}

export function isDownloadStripeEvent(event) {
  return (
    event?.data?.object?.metadata?.schema ===
    DOWNLOAD_METADATA_SCHEMA
  );
}

function providerId(value) {
  return typeof value === "string"
    ? value
    : value?.id;
}

export function isPotentialDownloadReversalEvent(
  event
) {
  return (
    DOWNLOAD_REVERSAL_EVENT_TYPES.has(
      event?.type
    ) &&
    PAYMENT_INTENT_ID.test(
      String(
        providerId(
          event?.data?.object?.payment_intent
        ) ?? ""
      )
    )
  );
}

function exactReversalDecision(event, receipt) {
  const object = event.data.object;
  const paymentIntentId = requiredText(
    providerId(object.payment_intent),
    "event.data.object.payment_intent"
  );
  invariant(
    PAYMENT_INTENT_ID.test(paymentIntentId) &&
      receipt?.paymentIntentId === paymentIntentId &&
      receipt.currency === "USD" &&
      Number.isSafeInteger(receipt.totalMinor) &&
      receipt.totalMinor >= 500,
    "stripe_reversal_binding_invalid",
    "The Stripe reversal does not match one Download payment",
    { status: 400 }
  );
  let providerObjectId;
  let amountMinor;
  let providerStatus;
  let targetState;
  let reason;
  if (event.type === "charge.refunded") {
    providerObjectId = requiredText(
      object.id,
      "event.data.object.id"
    );
    amountMinor = object.amount_refunded;
    providerStatus = object.refunded
      ? "fully_refunded"
      : "partially_refunded";
    invariant(
      CHARGE_ID.test(providerObjectId) &&
        object.livemode === event.livemode &&
        object.currency === "usd" &&
        Number.isSafeInteger(object.amount) &&
        object.amount === receipt.totalMinor &&
        Number.isSafeInteger(amountMinor) &&
        amountMinor > 0 &&
        amountMinor <= object.amount &&
        object.refunded ===
          (amountMinor === object.amount),
      "stripe_reversal_binding_invalid",
      "The Stripe refund facts are invalid",
      { status: 400 }
    );
    targetState = object.refunded
      ? "revoked"
      : "suspended";
    reason = object.refunded
      ? "payment_fully_refunded"
      : "payment_partially_refunded";
  } else {
    providerObjectId = requiredText(
      object.id,
      "event.data.object.id"
    );
    amountMinor = object.amount;
    providerStatus = requiredText(
      object.status,
      "event.data.object.status"
    );
    invariant(
      DISPUTE_ID.test(providerObjectId) &&
        object.livemode === event.livemode &&
        object.currency === "usd" &&
        Number.isSafeInteger(amountMinor) &&
        amountMinor > 0 &&
        amountMinor <= 99_999_999 &&
        /^[a-z_]{2,80}$/u.test(providerStatus),
      "stripe_reversal_binding_invalid",
      "The Stripe dispute facts are invalid",
      { status: 400 }
    );
    targetState =
      providerStatus === "lost"
        ? "revoked"
        : "suspended";
    reason =
      providerStatus === "lost"
        ? "payment_dispute_lost"
        : [
              "won",
              "prevented",
              "warning_closed"
            ].includes(providerStatus)
          ? "payment_dispute_review_required"
          : "payment_dispute_open";
  }
  return Object.freeze({
    paymentIntentId,
    providerObjectId,
    amountMinor,
    providerStatus,
    targetState,
    reason
  });
}

function exactEventMetadata(value, dispatch) {
  const purpose = dispatch.purpose;
  const expected = {
    schema: DOWNLOAD_METADATA_SCHEMA,
    tenant_id: purpose.tenantId,
    customer_id: purpose.customerId,
    project_id: purpose.projectId,
    version_id: purpose.versionId,
    quote_id: purpose.quoteId,
    offer_id: "spark_download",
    entitlement_kind: "spark_download",
    accepted_disclosure_digest:
      purpose.acceptedDisclosureDigest,
    quote_snapshot_digest:
      purpose.quoteSnapshotDigest,
    purpose_digest: dispatch.purposeDigest
  };
  invariant(
    value &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(Object.keys(expected).sort()) &&
      Object.entries(expected).every(
        ([key, expectedValue]) =>
          value[key] === expectedValue
      ),
    "stripe_event_binding_invalid",
    "The verified Stripe event does not match the durable Download Checkout",
    { status: 400 }
  );
}

function exactDispatchForEvent(value, checkoutSessionId) {
  invariant(
    value &&
      value.checkoutSessionId === checkoutSessionId &&
      value.provider === "stripe" &&
      ["ready", "settled"].includes(value.state) &&
      value.purpose?.schema ===
        CHECKOUT_PURPOSE_SCHEMA &&
      value.purposeDigest === digest(value.purpose),
    "stripe_event_binding_invalid",
    "The Stripe event does not identify one durable Download Checkout",
    { status: 400 }
  );
  return value;
}

function exactPaymentFacts(value, dispatch) {
  invariant(
    value?.schema ===
        "sitesourcery.stripe-download-payment-facts/v2" &&
      value.provider === "stripe" &&
      value.checkoutSessionId ===
        dispatch.checkoutSessionId &&
      /^pi_[A-Za-z0-9_]+$/u.test(
        value.paymentIntentId
      ) &&
      /^cus_[A-Za-z0-9_]+$/u.test(value.customerId) &&
      value.paymentStatus === "paid" &&
      value.amountMinor === 500 &&
      Number.isSafeInteger(value.taxMinor) &&
      value.taxMinor >= 0 &&
      Number.isSafeInteger(value.totalMinor) &&
      value.totalMinor === 500 + value.taxMinor &&
      [
        "automatic",
        "disabled_by_owner"
      ].includes(value.taxMode) &&
      (
        value.taxMode === "automatic" ||
        value.taxMinor === 0
      ) &&
      value.currency === "USD" &&
      value.purposeDigest === dispatch.purposeDigest,
    "stripe_payment_invalid",
    "Stripe did not prove the exact $5 Download payment",
    { status: 502 }
  );
  return value;
}

export function createDownloadPaymentService({
  repository,
  provider,
  release = createDownloadPaymentRelease(),
  clock,
  ids
} = {}) {
  const ports = validatePorts({
    repository,
    provider,
    clock,
    ids
  });
  const authority = exactRelease(release);

  async function providerReadiness() {
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
      status.provider !== "stripe"
    ) {
      return deepFreeze({
        ready: false,
        payment: false,
        state: "unavailable",
        code:
          status?.code ??
          status?.reason ??
          "stripe_not_ready"
      });
    }
    if (
      ![
        "automatic",
        "disabled_by_owner"
      ].includes(status.taxMode)
    ) {
      return deepFreeze({
        ready: false,
        payment: false,
        state: "held",
        code: "download_tax_contract_unconfigured"
      });
    }
    return deepFreeze({
      ready: true,
      payment: true,
      state: "ready",
      provider: "stripe",
      taxMode: status.taxMode
    });
  }

  async function readiness() {
    if (!authority.approved) {
      return deepFreeze({
        ready: false,
        payment: false,
        state: "held",
        code: "download_payment_release_held"
      });
    }
    return providerReadiness();
  }

  async function requireReady() {
    const status = await readiness();
    invariant(
      status.ready === true,
      "payment_unavailable",
      "Secure Download payment is not open. Nothing was charged.",
      { status: 503 }
    );
  }

  return Object.freeze({
    readiness,

    async dispatch(input) {
      await requireReady();
      const preparation = exactPreparation(input);
      const entitlement =
        await ports.repository.findProjectEntitlement({
          tenantId: preparation.purpose.tenantId,
          customerId: preparation.purpose.customerId,
          projectId: preparation.projectId
        });
      invariant(
        !entitlement,
        "download_already_unlocked",
        "Download is already unlocked for this project.",
        { status: 409 }
      );
      let claim =
        await ports.repository.claimDispatch(
          preparation
        );
      if (claim?.status === "reconcile_expiry") {
        const reconciliation =
          exactExpiryReconciliation(
            claim.reconciliation
          );
        let lifecycle;
        try {
          lifecycle = exactCheckoutLifecycle(
            await ports.provider
              .retrieveDownloadCheckoutLifecycle({
                checkoutSessionId:
                  reconciliation.checkoutSessionId,
                purpose:
                  reconciliation.preparation.purpose,
                purposeDigest:
                  reconciliation.preparation
                    .purposeDigest
              }),
            reconciliation
          );
        } catch {
          invariant(
            false,
            "payment_reconciliation_required",
            "The earlier payment page could not be proven expired, so another charge will not be started.",
            { status: 503 }
          );
        }
        if (lifecycle === "open_unpaid") {
          if (
            reconciliation.preparation.commandId ===
            preparation.commandId
          ) {
            return reconciliation.result;
          }
          invariant(
            false,
            "payment_in_progress",
            "An earlier secure payment page is still open for this project. Another charge will not be started.",
            { status: 409 }
          );
        }
        invariant(
          lifecycle === "expired_unpaid",
          "payment_reconciliation_required",
          "The earlier payment page may have completed. Another charge will not be started while Stripe confirmation is pending.",
          { status: 503 }
        );
        try {
          await ports.repository.expireDispatch(
            reconciliation
          );
        } catch {
          invariant(
            false,
            "payment_reconciliation_required",
            "The expired payment page could not be closed durably, so another charge will not be started.",
            { status: 503 }
          );
        }
        if (
          reconciliation.preparation.commandId ===
          preparation.commandId
        ) {
          invariant(
            false,
            "checkout_expired",
            "Request and review a new $5 quote before continuing.",
            { status: 409 }
          );
        }
        claim = await ports.repository.claimDispatch(
          preparation
        );
      }
      if (claim?.status === "replay") {
        return validateDispatchReplay(
          preparation,
          claim.result
        );
      }
      invariant(
        claim?.status !== "pending",
        "payment_in_progress",
        "Secure Download payment is still being prepared.",
        { status: 409 }
      );
      invariant(
        claim?.status !== "effect_unknown",
        "payment_reconciliation_required",
        "The payment page needs operator reconciliation before it can be retried. Nothing should be paid twice.",
        { status: 503 }
      );
      invariant(
        claim?.status !== "expired",
        "checkout_expired",
        "Request and review a new $5 quote before continuing.",
        { status: 409 }
      );
      invariant(
        claim?.status !== "entitled",
        "download_already_unlocked",
        "Download is already unlocked for this project.",
        { status: 409 }
      );
      invariant(
        claim?.status === "claimed",
        "repository_conflict",
        "The Download payment reservation is invalid",
        { status: 500 }
      );
      let providerEffectReturned = false;
      try {
        const stripeCustomerId =
          await ports.repository.findStripeCustomer({
            tenantId:
              preparation.purpose.tenantId,
            customerId:
              preparation.purpose.customerId
          });
        const checkout =
          await ports.provider.createDownloadCheckout({
            idempotencyKey:
              preparation.commandId,
            purpose: preparation.purpose,
            purposeDigest:
              preparation.purposeDigest,
            ...(stripeCustomerId
              ? { stripeCustomerId }
              : {})
          });
        providerEffectReturned = true;
        const result = dispatchResult(
          preparation,
          checkout,
          requiredIso(
            ports.clock.now(),
            "clock.now"
          )
        );
        await ports.repository.completeDispatch(
          preparation,
          result
        );
        return result;
      } catch (error) {
        const failure = paymentUnavailable(error);
        if (
          providerEffectReturned ||
          failure.ambiguous
        ) {
          await ports.repository.markDispatchUnknown(
            preparation,
            providerEffectReturned &&
              !failure.ambiguous
              ? "download_checkout_persistence_unknown"
              : failure.code
          );
          invariant(
            false,
            "payment_reconciliation_required",
            "The payment page could not be confirmed and will not be retried automatically. Nothing should be paid twice.",
            { status: 503 }
          );
        }
        await ports.repository.abandonDispatch(
          preparation
        );
        invariant(
          false,
          "payment_unavailable",
          "Secure Download payment is temporarily unavailable. Nothing was charged.",
          { status: 503 }
        );
      }
    },

    async ingestStripeEvent(input) {
      const event = exactEvent(input);
      if (isPotentialDownloadReversalEvent(event)) {
        const paymentIntentId = providerId(
          event.data.object.payment_intent
        );
        const receipt =
          await ports.repository
            .findPaymentReceiptByIntent({
              paymentIntentId
            });
        if (!receipt) {
          return deepFreeze({
            status: "not_download"
          });
        }
        const decision = exactReversalDecision(
          event,
          receipt
        );
        return deepFreeze(
          clone(
            await ports.repository
              .applyPaymentReversal({
                event: {
                  eventId: event.id,
                  eventType: event.type,
                  livemode: event.livemode,
                  providerCreatedAt: new Date(
                    event.created * 1000
                  ).toISOString(),
                  payloadDigest: createHash("sha256")
                    .update(
                      JSON.stringify(event),
                      "utf8"
                    )
                    .digest("hex")
                },
                receipt,
                decision
              })
          )
        );
      }
      if (!isDownloadStripeEvent(event)) {
        return deepFreeze({ status: "not_download" });
      }
      if (event.type !== "checkout.session.completed") {
        return deepFreeze({ status: "ignored" });
      }
      const providerStatus = await providerReadiness();
      invariant(
        providerStatus.ready === true,
        "payment_reconciliation_unavailable",
        "Stripe payment confirmation is temporarily unavailable.",
        { status: 503 }
      );
      const checkoutSessionId =
        requiredText(
          event.data.object.id,
          "event.data.object.id"
        );
      invariant(
        CHECKOUT_ID.test(checkoutSessionId),
        "stripe_event_invalid",
        "The verified Stripe event has no Checkout Session",
        { status: 400 }
      );
      const dispatch = exactDispatchForEvent(
        await ports.repository.findDispatchByCheckout({
          checkoutSessionId
        }),
        checkoutSessionId
      );
      exactEventMetadata(
        event.data.object.metadata,
        dispatch
      );
      const eventRecord = {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        providerCreatedAt: new Date(
          event.created * 1000
        ).toISOString(),
        payloadDigest: createHash("sha256")
          .update(JSON.stringify(event), "utf8")
          .digest("hex"),
        checkoutSessionId,
        tenantId: dispatch.purpose.tenantId,
        projectId: dispatch.purpose.projectId
      };
      const claim =
        await ports.repository.claimStripeEvent(
          eventRecord
        );
      if (claim?.status === "replay") {
        return deepFreeze(clone(claim.result));
      }
      invariant(
        ["claimed", "pending"].includes(
          claim?.status
        ),
        "stripe_event_conflict",
        "The Stripe event conflicts with durable payment evidence",
        { status: 409 }
      );
      let payment;
      try {
        payment = exactPaymentFacts(
          await ports.provider.retrieveDownloadCheckout({
            checkoutSessionId,
            purpose: dispatch.purpose,
            purposeDigest: dispatch.purposeDigest
          }),
          dispatch
        );
      } catch {
        invariant(
          false,
          "payment_reconciliation_unavailable",
          "Stripe payment confirmation is temporarily unavailable.",
          { status: 503 }
        );
      }
      const result =
        await ports.repository.settleStripeEvent({
          dispatch,
          event: eventRecord,
          payment,
          receiptId: requiredText(
            ports.ids.next("download_receipt"),
            "receiptId"
          ),
          entitlementId: requiredText(
            ports.ids.next("download_entitlement"),
            "entitlementId"
          ),
          settledAt: eventRecord.providerCreatedAt
        });
      return deepFreeze(clone(result));
    },

    async download(input) {
      const tenantId = requiredText(
        input?.tenantId,
        "tenantId"
      );
      const customerId = requiredText(
        input?.customerId,
        "customerId"
      );
      const projectId = requiredText(
        input?.projectId,
        "projectId"
      );
      const versionId = requiredText(
        input?.versionId,
        "versionId"
      );
      const resolved =
        await ports.repository.resolveDownloadArtifact({
          tenantId,
          customerId,
          projectId,
          versionId
        });
      invariant(
        resolved &&
          resolved.versionProjectId === projectId &&
          Buffer.isBuffer(resolved.htmlBytes) &&
          /^[a-f0-9]{64}$/u.test(
            resolved.artifactDigest
          ),
        "entitlement_unavailable",
        "The project Download is unavailable",
        { status: 404 }
      );
      authorizeProjectEntitlement(
        resolved.entitlement,
        {
          tenantId,
          customerId,
          projectId,
          versionId,
          versionProjectId:
            resolved.versionProjectId,
          action:
            "download_accepted_project_version"
        }
      );
      const observedDigest = createHash("sha256")
        .update(resolved.htmlBytes)
        .digest("hex");
      invariant(
        observedDigest === resolved.artifactDigest,
        "artifact_integrity_failure",
        "The accepted Download artifact failed integrity verification",
        { status: 500 }
      );
      return Object.freeze({
        bytes: Buffer.from(resolved.htmlBytes),
        filename:
          `sitesourcery-${projectId}-${versionId}.html`,
        sha256: observedDigest
      });
    }
  });
}
