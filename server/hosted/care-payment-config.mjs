import { digest } from "../domain/canonical.mjs";
import { ExternalEffectError, invariant } from "../domain/errors.mjs";

export const CARE_STRIPE_METADATA_SCHEMA = "sitesourcery_care_subscription_v1";
export const CARE_STRIPE_PLAN_AMOUNTS = Object.freeze({
  plan_host: 2500, plan_care_lite: 6900, plan_care: 11900,
  plan_care_plus: 19900, plan_partner: 34900
});
export const CARE_STRIPE_CAPABILITIES = Object.freeze([
  "charges:read", "checkout:create", "checkout:read", "disputes:read", "invoices:read", "refunds:read",
  "prices:read", "subscriptions:read", "subscriptions:update",
  "webhook_endpoints:read", "webhooks:verify"
]);
const BINDING_FIELDS = Object.freeze([
  "organizationId", "projectId", "customerId", "offerId", "acceptanceId",
  "agreementId", "planId", "amountMinor", "currency", "offerDigest",
  "acceptanceDigest", "legalAuthorityDigest", "taxMode"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
function check(condition, message, code = "stripe_care_mismatch") {
  invariant(condition, code, message, { status: 503 });
}
function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function reference(value, prefix) {
  const id = typeof value === "string" ? value : value?.id;
  check(typeof id === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_]+$`, "u").test(id), "Care provider identity is invalid.");
  return id;
}
function instant(value) {
  check(Number.isSafeInteger(value) && value > 0 && value < 100_000_000_000, "Care provider time is invalid.");
  return new Date(value * 1000).toISOString();
}
function bindingFor(value) {
  check(exact(value, BINDING_FIELDS) &&
    ["organizationId", "projectId", "customerId", "offerId", "acceptanceId", "agreementId"].every(k => UUID.test(value[k])) &&
    ["offerDigest", "acceptanceDigest", "legalAuthorityDigest"].every(k => SHA.test(value[k])) &&
    Object.hasOwn(CARE_STRIPE_PLAN_AMOUNTS, value.planId) &&
    value.amountMinor === CARE_STRIPE_PLAN_AMOUNTS[value.planId] &&
    value.currency === "USD" && value.taxMode === "disabled_by_owner",
  "Care requires the exact accepted fixed monthly plan binding.", "stripe_care_binding_invalid");
  return Object.freeze({ ...value });
}
export function careStripeMetadata(binding, attemptId) {
  const selected = bindingFor(binding);
  check(UUID.test(attemptId), "Care requires an exact checkout attempt.");
  return Object.freeze({ schema: CARE_STRIPE_METADATA_SCHEMA, purpose: "care",
    ...Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, String(v)])),
    bindingDigest: digest(selected), attemptId });
}
function metadataMatches(value, binding, attemptId = value?.attemptId) {
  const expected = careStripeMetadata(binding, attemptId);
  check(exact(value, Object.keys(expected)) && Object.entries(expected).every(([k, v]) => value[k] === v),
    "Care provider metadata does not match the accepted tenant, offer and agreement.");
}
export function isDirectCareStripeEvent(event) {
  const object = event?.data?.object;
  return [object?.metadata, object?.parent?.subscription_details?.metadata].some(
    metadata => metadata?.schema === CARE_STRIPE_METADATA_SCHEMA || metadata?.purpose === "care"
  );
}
export function isPotentialCareStripeEvent(event) {
  return isDirectCareStripeEvent(event) || /^(invoice\.|customer\.subscription\.|charge\.dispute\.|refund\.)/u.test(event?.type ?? "") || event?.type === "charge.refunded";
}
export function normalizeCareStripeConfiguration(value, expectations, livemode) {
  if (value === null || value === undefined) return null;
  const plans = Object.keys(CARE_STRIPE_PLAN_AMOUNTS);
  check(exact(value, ["planPriceIds"]) && exact(value.planPriceIds, plans),
    "Care requires the five exact approved monthly Prices.", "stripe_care_configuration_invalid");
  const ids = plans.map(plan => reference(value.planPriceIds[plan], "price"));
  check(new Set(ids).size === plans.length, "Care plan Prices must be distinct.", "stripe_care_configuration_invalid");
  for (const plan of plans) {
    const price = expectations.find(p => p.id === value.planPriceIds[plan]);
    check(price && price.currency === "usd" && price.unitAmount === CARE_STRIPE_PLAN_AMOUNTS[plan] &&
      price.livemode === livemode && price.taxBehavior === "exclusive" &&
      price.recurring?.interval === "month" && price.recurring.intervalCount === 1 &&
      /^prod_[A-Za-z0-9_]+$/u.test(price.productId),
    "Care Price does not match the approved fixed monthly plan.", "stripe_care_configuration_invalid");
  }
  return Object.freeze({ planPriceIds: Object.freeze({ ...value.planPriceIds }) });
}

// Uses the existing official/injected Stripe client, capability gate and credential
// lease. It neither creates catalog objects nor borrows Alakazam metadata.
export function createCareStripeOperations({ client, config, requireCapability,
  credentialTopologyReadiness, verifyPrices, verifyWebhookEndpoint, taxModeFor }) {
  async function ready() {
    check(config.care, "Care provider effects are held.", "stripe_care_held");
    for (const capability of CARE_STRIPE_CAPABILITIES) requireCapability(capability);
    credentialTopologyReadiness("care");
    check(taxModeFor(config, "care") === "disabled_by_owner", "Care tax authority is not the current owner policy.");
    check(typeof client.checkout.sessions.retrieve === "function" && typeof client.subscriptions.retrieve === "function" &&
      typeof client.invoices?.retrieve === "function" && typeof client.charges?.retrieve === "function" &&
      typeof client.refunds?.list === "function" && typeof client.disputes?.list === "function",
    "Care provider readback client is incomplete.");
    await verifyPrices();
    await verifyWebhookEndpoint();
  }
  async function read(operation) {
    try { return await operation(); } catch (error) {
      if (error?.code?.startsWith("stripe_care_")) throw error;
      throw new ExternalEffectError("stripe_care_read_unavailable", "Care provider readback is unavailable.", { certainty: "not_submitted" });
    }
  }
  async function write(operation, key) {
    try { return await operation({ idempotencyKey: key }); } catch {
      throw new ExternalEffectError("stripe_care_effect_unknown", "Care provider command requires reconciliation with its original idempotency key.",
        { certainty: "ambiguous", details: { idempotencyKey: key } });
    }
  }
  function priceFor(binding) { return config.care.planPriceIds[binding.planId]; }
  async function invoiceFacts(binding, subscription, invoiceId) {
    const invoice = await read(() => client.invoices.retrieve(reference(invoiceId, "in"), {
      expand: ["payments.data.payment.payment_intent", "amount_paid_off_stripe"]
    }));
    const customerId = reference(subscription.customer, "cus");
    check(invoice?.id === invoiceId && invoice.livemode === config.livemode && invoice.currency === "usd" &&
      reference(invoice.customer, "cus") === customerId && invoice.parent?.type === "subscription_details" &&
      reference(invoice.parent.subscription_details?.subscription, "sub") === subscription.id &&
      invoice.collection_method === "charge_automatically" && invoice.automatic_tax?.enabled === false &&
      ["subscription_create", "subscription_cycle"].includes(invoice.billing_reason) &&
      invoice.lines?.has_more === false && invoice.lines.data?.length === 1,
    "Care Invoice identity or collection policy changed.");
    metadataMatches(invoice.parent.subscription_details.metadata, binding, subscription.metadata.attemptId);
    const line = invoice.lines.data[0];
    check(line.livemode === config.livemode && line.currency === "usd" && line.quantity === 1 &&
      line.parent?.type === "subscription_item_details" && line.parent.subscription_item_details.proration === false &&
      reference(line.parent.subscription_item_details.subscription, "sub") === subscription.id &&
      reference(line.parent.subscription_item_details.subscription_item, "si") === subscription.items.data[0].id &&
      line.pricing?.type === "price_details" && reference(line.pricing.price_details.price, "price") === priceFor(binding) &&
      line.amount === binding.amountMinor && line.subtotal === binding.amountMinor &&
      invoice.subtotal === binding.amountMinor && invoice.total_excluding_tax === binding.amountMinor &&
      invoice.total === binding.amountMinor && invoice.amount_due === binding.amountMinor &&
      invoice.total_discount_amounts?.length === 0 && invoice.total_taxes?.length === 0 &&
      invoice.pre_payment_credit_notes_amount === 0 && invoice.post_payment_credit_notes_amount === 0 &&
      invoice.amount_paid_off_stripe === 0,
    "Care Invoice does not contain one exact undiscounted monthly period.");
    const periodStart = instant(line.period?.start), periodEnd = instant(line.period?.end);
    check(line.period.end - line.period.start >= 27 * 86400 && line.period.end - line.period.start <= 32 * 86400,
      "Care Invoice period is not monthly.");
    const paid = invoice.status === "paid";
    check(["draft", "open", "paid", "uncollectible", "void"].includes(invoice.status), "Care Invoice status is unknown.");
    if (!paid) return Object.freeze({ invoiceId, paymentIntentId: null, chargeId: null, periodStart, periodEnd,
      amountMinor: binding.amountMinor, currency: "USD", settledAt: null, paid: false, refunded: false, disputed: false });
    check(invoice.amount_paid === binding.amountMinor && invoice.amount_remaining === 0 &&
      invoice.payments?.has_more === false && invoice.payments.data?.length === 1,
    "Care Invoice does not have one exact payment.");
    const payment = invoice.payments.data[0], intent = payment.payment?.payment_intent;
    check(payment.status === "paid" && payment.livemode === config.livemode && payment.currency === "usd" &&
      payment.amount_paid === binding.amountMinor && payment.amount_requested === binding.amountMinor &&
      reference(payment.invoice, "in") === invoiceId && payment.payment?.type === "payment_intent" &&
      typeof intent === "object" && intent?.status === "succeeded" && intent.livemode === config.livemode &&
      intent.currency === "usd" && intent.amount === binding.amountMinor && intent.amount_received === binding.amountMinor &&
      reference(intent.customer, "cus") === customerId, "Care Invoice PaymentIntent is not settled.");
    const paymentIntentId = reference(intent, "pi"), chargeId = reference(intent.latest_charge, "ch");
    const charge = await read(() => client.charges.retrieve(chargeId));
    check(charge.id === chargeId && charge.livemode === config.livemode && charge.currency === "usd" &&
      charge.paid === true && charge.captured === true && charge.status === "succeeded" &&
      charge.amount === binding.amountMinor && charge.amount_captured === binding.amountMinor &&
      reference(charge.customer, "cus") === customerId && reference(charge.payment_intent, "pi") === paymentIntentId &&
      Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded >= 0 && charge.amount_refunded <= binding.amountMinor &&
      typeof charge.refunded === "boolean" && charge.refunded === (charge.amount_refunded === binding.amountMinor) &&
      typeof charge.disputed === "boolean", "Care Charge does not match the actual Invoice payment.");
    const refundPage = await read(() => client.refunds.list({ charge: chargeId, limit: 100 }));
    const disputePage = await read(() => client.disputes.list({ charge: chargeId, limit: 100 }));
    for (const page of [refundPage, disputePage]) {
      check(Array.isArray(page?.data) && page.has_more === false && page.data.length <= 100 &&
        new Set(page.data.map(item => item.id)).size === page.data.length,
      "Care reversal readback is incomplete.");
    }
    let refundedMinor = 0;
    for (const refund of refundPage.data) {
      reference(refund, "re");
      check(refund.currency === "usd" &&
        reference(refund.charge, "ch") === chargeId && reference(refund.payment_intent, "pi") === paymentIntentId &&
        Number.isSafeInteger(refund.amount) && refund.amount > 0 && refund.amount <= binding.amountMinor &&
        ["succeeded", "failed", "canceled"].includes(refund.status),
      "Care Refund is mismatched or remains unresolved.");
      if (refund.status === "succeeded") refundedMinor += refund.amount;
    }
    check(refundedMinor === charge.amount_refunded, "Care Charge and Refund totals disagree.");
    let disputed = false;
    for (const dispute of disputePage.data) {
      reference(dispute, "(?:dp|du)");
      check(dispute.livemode === config.livemode && dispute.currency === "usd" &&
        reference(dispute.charge, "ch") === chargeId && reference(dispute.payment_intent, "pi") === paymentIntentId &&
        Number.isSafeInteger(dispute.amount) && dispute.amount > 0 && dispute.amount <= binding.amountMinor &&
        ["needs_response", "under_review", "warning_needs_response", "warning_under_review", "lost", "won", "warning_closed", "prevented"].includes(dispute.status) &&
        Array.isArray(dispute.balance_transactions) && dispute.balance_transactions.length <= 2 &&
        dispute.balance_transactions.every(t => Number.isSafeInteger(t.amount) && t.amount !== 0),
      "Care Dispute binding or fund evidence changed.");
      const withdrawn = dispute.balance_transactions.some(t => t.amount < 0);
      const reinstated = dispute.balance_transactions.some(t => t.amount > 0);
      const resolved = ["won", "warning_closed", "prevented"].includes(dispute.status);
      disputed ||= !resolved || (withdrawn && !reinstated);
    }
    check(!charge.disputed || disputePage.data.length > 0, "Care Charge dispute has no provider readback.");
    return Object.freeze({ invoiceId, paymentIntentId, chargeId, periodStart, periodEnd, amountMinor: binding.amountMinor,
      currency: "USD", settledAt: instant(invoice.status_transitions?.paid_at), paid: true,
      refunded: refundedMinor > 0, disputed });
  }
  async function subscriptionFacts(binding, subscriptionId, invoiceId, expectedAttemptId) {
    const subscription = await read(() => client.subscriptions.retrieve(reference(subscriptionId, "sub"), { expand: ["items.data.price"] }));
    check(subscription?.id === subscriptionId && subscription.livemode === config.livemode &&
      ["active", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"].includes(subscription.status) &&
      subscription.collection_method === "charge_automatically" && subscription.automatic_tax?.enabled === false &&
      subscription.discounts?.length === 0 && subscription.default_tax_rates?.length === 0 &&
      subscription.pending_update === null && subscription.pause_collection === null && subscription.schedule === null &&
      subscription.trial_end === null && subscription.items?.has_more === false && subscription.items.data?.length === 1 &&
      typeof subscription.cancel_at_period_end === "boolean", "Care Subscription identity or terms changed.");
    metadataMatches(subscription.metadata, binding, expectedAttemptId ?? subscription.metadata?.attemptId);
    const item = subscription.items.data[0], price = item.price;
    check(reference(item, "si") && item.quantity === 1 && reference(price, "price") === priceFor(binding) &&
      price.currency === "usd" && price.unit_amount === binding.amountMinor && price.tax_behavior === "exclusive" &&
      price.livemode === config.livemode && price.recurring?.interval === "month" && price.recurring.interval_count === 1 &&
      price.recurring.usage_type === "licensed",
    "Care Subscription monthly price changed.");
    const currentPeriodStart = instant(item.current_period_start), currentPeriodEnd = instant(item.current_period_end);
    check(item.current_period_end > item.current_period_start, "Care Subscription period is invalid.");
    const selectedInvoice = invoiceId ?? (subscription.latest_invoice ? reference(subscription.latest_invoice, "in") : null);
    return Object.freeze({ subscriptionId, providerCustomerId: reference(subscription.customer, "cus"), status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end, canceledAt: subscription.status === "canceled" ? instant(subscription.canceled_at) : null,
      currentPeriodStart, currentPeriodEnd,
      invoice: selectedInvoice ? await invoiceFacts(binding, subscription, selectedInvoice) : null });
  }
  async function checkoutFacts(binding, attemptId, value, expectedId) {
    check(value?.id === expectedId && value.livemode === config.livemode && value.mode === "subscription" &&
      value.client_reference_id === binding.agreementId && value.currency === "usd" &&
      value.amount_subtotal === binding.amountMinor && value.amount_total === binding.amountMinor &&
      value.automatic_tax?.enabled === false && value.total_details?.amount_discount === 0 &&
      value.total_details?.amount_tax === 0 && value.total_details?.amount_shipping === 0,
    "Care Checkout identity or amount changed.");
    metadataMatches(value.metadata, binding, attemptId);
    const expiresAt = instant(value.expires_at);
    let state, checkoutUrl = null, subscription = null;
    if (value.status === "open" && value.payment_status === "unpaid") {
      state = "ready";
      let url; try { url = new URL(value.url); } catch { check(false, "Care Checkout URL is invalid."); }
      check(url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password && !url.port,
        "Care Checkout URL is outside the approved provider.");
      checkoutUrl = url.href;
    } else if (value.status === "expired" && value.payment_status === "unpaid") state = "expired";
    else {
      check(value.status === "complete" && ["paid", "unpaid"].includes(value.payment_status), "Care Checkout state is unknown.");
      subscription = await subscriptionFacts(binding, reference(value.subscription, "sub"), value.invoice ? reference(value.invoice, "in") : undefined, attemptId);
      check(reference(value.customer, "cus") === subscription.providerCustomerId, "Care Checkout customer changed.");
      state = value.payment_status === "paid" && subscription.invoice?.paid === true ? "paid" : "pending";
    }
    return Object.freeze({ state, checkoutSessionId: expectedId, checkoutUrl, expiresAt,
      providerCustomerId: value.customer ? reference(value.customer, "cus") : null,
      subscriptionId: subscription?.subscriptionId ?? null, invoice: subscription?.invoice ?? null });
  }
  return Object.freeze({
    verifyCareConfiguration: ready,
    async createCareCheckout({ binding, attemptId, commandId, expiresAt } = {}) {
      binding = bindingFor(binding);
      const metadata = careStripeMetadata(binding, attemptId);
      check(typeof commandId === "string" && COMMAND_ID.test(commandId), "Care command identity is invalid.");
      const expiry = Date.parse(expiresAt);
      check(typeof expiresAt === "string" && Number.isFinite(expiry) && new Date(expiry).toISOString() === expiresAt && expiry % 1000 === 0,
        "Care checkout requires its persisted exact expiry.");
      await ready();
      const key = `ss-care-checkout-${digest({ binding, attemptId, commandId })}`;
      const value = await write(options => client.checkout.sessions.create({
        mode: "subscription", client_reference_id: binding.agreementId,
        line_items: [{ price: priceFor(binding), quantity: 1 }],
        automatic_tax: { enabled: false }, allow_promotion_codes: false,
        payment_method_types: ["card"], metadata, subscription_data: { metadata },
        success_url: config.successUrl, cancel_url: config.cancelUrl,
        expires_at: expiry / 1000
      }, options), key);
      try {
        check(value?.expires_at === expiry / 1000, "Care Checkout expiry changed.");
        return await checkoutFacts(binding, attemptId, value, reference(value?.id, "cs"));
      }
      catch { throw new ExternalEffectError("stripe_care_effect_unknown", "Care Checkout response requires reconciliation.", { certainty: "ambiguous", details: { idempotencyKey: key } }); }
    },
    async readCareCheckout({ binding, attemptId, checkoutSessionId } = {}) {
      binding = bindingFor(binding); careStripeMetadata(binding, attemptId); reference(checkoutSessionId, "cs");
      await ready();
      const value = await read(() => client.checkout.sessions.retrieve(checkoutSessionId));
      return checkoutFacts(binding, attemptId, value, checkoutSessionId);
    },
    async readCareSubscription({ binding, subscriptionId, invoiceId } = {}) {
      binding = bindingFor(binding); await ready();
      return subscriptionFacts(binding, subscriptionId, invoiceId);
    },
    async cancelCareSubscriptionAtPeriodEnd({ binding, subscriptionId, commandId } = {}) {
      binding = bindingFor(binding); check(typeof commandId === "string" && COMMAND_ID.test(commandId), "Care command identity is invalid.");
      await ready();
      const before = await subscriptionFacts(binding, subscriptionId);
      if (before.cancelAtPeriodEnd || before.status === "canceled") return before;
      const key = `ss-care-cancel-${digest({ binding, subscriptionId, commandId })}`;
      await write(options => client.subscriptions.update(subscriptionId, { cancel_at_period_end: true, proration_behavior: "none" }, options), key);
      try {
        const after = await subscriptionFacts(binding, subscriptionId);
        check(after.cancelAtPeriodEnd && after.providerCustomerId === before.providerCustomerId &&
          after.currentPeriodEnd === before.currentPeriodEnd, "Care cancellation did not preserve the paid period.");
        return after;
      } catch { throw new ExternalEffectError("stripe_care_effect_unknown", "Care cancellation requires readback.", { certainty: "ambiguous", details: { idempotencyKey: key } }); }
    }
  });
}
