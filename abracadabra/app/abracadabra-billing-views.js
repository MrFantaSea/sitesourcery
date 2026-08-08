(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAlakazamBillingViews = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var INVOICE_SCHEMA = "sitesourcery.alakazam-invoice/v1";
  var CANCELLATION_PREVIEW_SCHEMA =
    "sitesourcery.alakazam-cancellation-preview/v1";
  var BILLING_STATES_SCHEMA =
    "sitesourcery.alakazam-billing-states/v1";
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var INVOICE_NUMBER = /^SSAK-[0-9A-F]{32}$/;
  var SHA256 = /^[a-f0-9]{64}$/;
  var RECEIPT_KINDS = [
    "start_payment",
    "upgrade_difference",
    "renewal_payment"
  ];
  var TAX_STATES = ["automatic", "disabled_by_owner"];
  var PREVIEW_STATES = [
    "available",
    "already_scheduled",
    "not_applicable"
  ];
  var PREVIEW_REASONS = [
    "cancellation_preview_only",
    "cancellation_already_scheduled",
    "no_cancellable_subscription"
  ];
  var PAYMENT_STATES = [
    "none",
    "pending",
    "current",
    "retrying",
    "suspended",
    "ended"
  ];
  var REPLAY_STATES = [
    "settled",
    "verifying",
    "attention_required"
  ];
  var RECONCILIATION_KINDS = [
    "tier_change",
    "downgrade_schedule"
  ];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return value == null
      ? value
      : JSON.parse(JSON.stringify(value));
  }

  function record(value) {
    return Boolean(
      value
      && typeof value === "object"
      && !Array.isArray(value)
    );
  }

  function exactKeys(value, expected) {
    if (!record(value)) return false;
    var actual = Object.keys(value).slice().sort();
    var wanted = expected.slice().sort();
    return JSON.stringify(actual) === JSON.stringify(wanted);
  }

  function safeMinor(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function safeIso(value) {
    if (typeof value !== "string") return false;
    var parsed = Date.parse(value);
    return Number.isFinite(parsed)
      && new Date(parsed).toISOString() === value;
  }

  function nullableIso(value) {
    return value === null || safeIso(value);
  }

  function usd(minor) {
    return "$" + (minor / 100).toFixed(2);
  }

  function day(value) {
    if (!safeIso(value)) return "";
    var parsed = new Date(value);
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC"
    });
  }

  function verifiedInvoiceLine(value) {
    return exactKeys(value, [
      "amountMinor",
      "description",
      "lineNumber",
      "quantity",
      "unitAmountMinor"
    ])
      && value.lineNumber === 1
      && value.quantity === 1
      && text(value.description).length > 0
      && safeMinor(value.unitAmountMinor)
      && safeMinor(value.amountMinor)
      && value.amountMinor === value.unitAmountMinor;
  }

  function verifiedInvoiceCredit(value) {
    return exactKeys(value, [
      "amountMinor",
      "description",
      "kind"
    ])
      && value.kind === "download_purchase"
      && text(value.description).length > 0
      && safeMinor(value.amountMinor)
      && value.amountMinor > 0;
  }

  function verifiedAlakazamInvoice(
    value,
    projectId,
    receiptId
  ) {
    if (
      !exactKeys(value, [
        "catalog",
        "credits",
        "currency",
        "invoiceNumber",
        "issuedAt",
        "kind",
        "lines",
        "projectId",
        "receiptId",
        "schema",
        "settledAt",
        "settlement",
        "state",
        "tier",
        "totals"
      ])
      || value.schema !== INVOICE_SCHEMA
      || text(value.projectId) !== text(projectId)
      || text(value.receiptId) !== text(receiptId)
      || !UUID.test(text(value.receiptId))
      || !INVOICE_NUMBER.test(text(value.invoiceNumber))
      || value.state !== "settled"
      || RECEIPT_KINDS.indexOf(value.kind) < 0
      || !exactKeys(value.tier, ["name", "tierId"])
      || text(value.tier.tierId).length === 0
      || text(value.tier.name).length === 0
      || !safeIso(value.issuedAt)
      || !safeIso(value.settledAt)
      || value.issuedAt !== value.settledAt
      || value.currency !== "USD"
      || !Array.isArray(value.lines)
      || value.lines.length !== 1
      || !value.lines.every(verifiedInvoiceLine)
      || !Array.isArray(value.credits)
      || value.credits.length > 1
      || !value.credits.every(verifiedInvoiceCredit)
      || !exactKeys(value.totals, [
        "currency",
        "discountMinor",
        "netSubtotalMinor",
        "subtotalMinor",
        "taxMinor",
        "taxState",
        "totalMinor"
      ])
      || value.totals.currency !== "USD"
      || !safeMinor(value.totals.subtotalMinor)
      || !safeMinor(value.totals.discountMinor)
      || !safeMinor(value.totals.netSubtotalMinor)
      || !safeMinor(value.totals.taxMinor)
      || !safeMinor(value.totals.totalMinor)
      || TAX_STATES.indexOf(value.totals.taxState) < 0
      || value.totals.netSubtotalMinor !==
        value.totals.subtotalMinor
          - value.totals.discountMinor
      || value.totals.totalMinor !==
        value.totals.netSubtotalMinor
          + value.totals.taxMinor
      || value.totals.subtotalMinor !==
        value.lines[0].amountMinor
      || value.totals.discountMinor !== (
        value.credits.length === 1
          ? value.credits[0].amountMinor
          : 0
      )
      || !exactKeys(value.settlement, [
        "providerInvoiceRecorded",
        "settledAt",
        "settlementDigest",
        "state"
      ])
      || value.settlement.state !== "settled"
      || value.settlement.settledAt !== value.settledAt
      || typeof value.settlement.providerInvoiceRecorded
        !== "boolean"
      || !SHA256.test(
        text(value.settlement.settlementDigest)
      )
      || !exactKeys(value.catalog, [
        "catalogVersion",
        "termsVersion"
      ])
      || text(value.catalog.catalogVersion).length === 0
      || text(value.catalog.termsVersion).length === 0
    ) return null;
    return clone(value);
  }

  /**
   * A-03. One settled Alakazam payment, ready to show as a plain invoice.
   */
  function alakazamInvoicePresentation(
    value,
    projectId,
    receiptId
  ) {
    var invoice = verifiedAlakazamInvoice(
      value,
      projectId,
      receiptId
    );
    if (!invoice) return null;
    var rows = [
      {
        label: invoice.lines[0].description,
        value: usd(invoice.lines[0].amountMinor),
        kind: "line"
      }
    ];
    if (invoice.credits.length === 1) {
      rows.push({
        label: invoice.credits[0].description,
        value: "-" + usd(invoice.credits[0].amountMinor),
        kind: "credit"
      });
    }
    rows.push({
      label: invoice.totals.taxState === "automatic"
        ? "Sales tax"
        : "Sales tax (not charged)",
      value: usd(invoice.totals.taxMinor),
      kind: "tax"
    });
    return Object.freeze({
      invoice: invoice,
      heading: "Alakazam payment receipt",
      summary: "Paid on "
        + day(invoice.settledAt)
        + " for "
        + invoice.tier.name
        + ".",
      reference: invoice.invoiceNumber,
      rows: rows,
      totalLabel: "Total paid",
      totalValue: usd(invoice.totals.totalMinor),
      note: "Keep this reference if you ever need to ask about this payment."
    });
  }

  function verifiedCancellationWebsite(value) {
    return exactKeys(value, [
      "afterEnd",
      "hostname",
      "publishedUntil",
      "state",
      "url"
    ])
      && value.afterEnd === "not_published"
      && nullableIso(value.publishedUntil)
      && text(value.state).length > 0;
  }

  function verifiedCancellationRenewal(value) {
    if (value === null) return true;
    return exactKeys(value, [
      "amountMinor",
      "chargedIfCancelled",
      "currency",
      "currentTierId",
      "dueAt",
      "tierId"
    ])
      && safeMinor(value.amountMinor)
      && value.currency === "USD"
      && value.chargedIfCancelled === false
      && safeIso(value.dueAt);
  }

  function verifiedCancellationEffect(value) {
    if (value === null) return true;
    return exactKeys(value, [
      "alreadyScheduled",
      "endsAt",
      "keepsAccessUntil",
      "receiptsKept",
      "refund",
      "renewalStopped",
      "savedSetupKept",
      "website"
    ])
      && typeof value.alreadyScheduled === "boolean"
      && safeIso(value.endsAt)
      && value.keepsAccessUntil === value.endsAt
      && value.savedSetupKept === true
      && value.receiptsKept === true
      && verifiedCancellationWebsite(value.website)
      && verifiedCancellationRenewal(value.renewalStopped)
      && exactKeys(value.refund, [
        "cashRefundMinor",
        "providerProration",
        "state"
      ])
      && value.refund.state === "owner_review_required"
      && value.refund.cashRefundMinor === null
      && value.refund.providerProration === null;
  }

  function verifiedAlakazamCancellationPreview(
    value,
    projectId
  ) {
    if (
      !exactKeys(value, [
        "accountState",
        "actions",
        "effect",
        "policy",
        "projectId",
        "schema",
        "state",
        "subscription"
      ])
      || value.schema !== CANCELLATION_PREVIEW_SCHEMA
      || text(value.projectId) !== text(projectId)
      || PREVIEW_STATES.indexOf(value.state) < 0
      || !verifiedCancellationEffect(value.effect)
      || (value.state === "not_applicable") !==
        (value.effect === null)
      || (value.state === "not_applicable") !==
        (value.subscription === null)
      || (
        value.effect !== null
        && value.effect.alreadyScheduled !==
          (value.state === "already_scheduled")
      )
      || !exactKeys(value.policy, [
        "cancellationPolicy",
        "releaseBlocker",
        "released"
      ])
      || value.policy.cancellationPolicy !==
        "owner_review_required_before_release"
      || value.policy.released !== false
      || value.policy.releaseBlocker !==
        "cancellation_policy"
      || !exactKeys(value.actions, [
        "billingPortal",
        "confirmCancellation",
        "reason"
      ])
      || !exactKeys(value.actions.confirmCancellation, [
        "available",
        "reason"
      ])
      || value.actions.confirmCancellation.available
        !== false
      || !exactKeys(value.actions.billingPortal, [
        "available",
        "reason",
        "state"
      ])
      || value.actions.billingPortal.available !== false
      || value.actions.billingPortal.state !== "held"
      || PREVIEW_REASONS.indexOf(value.actions.reason) < 0
    ) return null;
    if (value.subscription !== null && !exactKeys(
      value.subscription,
      [
        "amountMinor",
        "currency",
        "currentPeriodEndsAt",
        "name",
        "status",
        "tierId"
      ]
    )) return null;
    return clone(value);
  }

  /**
   * E-08. What cancelling would do, before anything is done. The money terms
   * are deliberately absent: the Alakazam cancellation policy is still an
   * owner decision, so the preview says so instead of guessing.
   */
  function alakazamCancellationPreviewPresentation(
    value,
    projectId
  ) {
    var preview = verifiedAlakazamCancellationPreview(
      value,
      projectId
    );
    if (!preview) return null;
    if (preview.state === "not_applicable") {
      return Object.freeze({
        preview: preview,
        heading: "There is no Alakazam plan to cancel.",
        summary: "When you have an active plan, this is where you will see exactly what cancelling would do before you do it.",
        facts: [],
        policyNote: "",
        portalNote: "",
        confirmAvailable: false
      });
    }
    var endsOn = day(preview.effect.endsAt);
    var facts = [
      {
        label: "Your plan keeps working until",
        value: endsOn
      },
      {
        label: "Your website",
        value: preview.effect.website.state === "live"
          ? "Stays published until " + endsOn + ", then comes down."
          : "Is not published now, and would stay unpublished."
      },
      {
        label: "Your saved website setup",
        value: "Stays in your account."
      },
      {
        label: "Your past receipts",
        value: "Stay in your account."
      }
    ];
    if (preview.effect.renewalStopped) {
      facts.splice(1, 0, {
        label: "The "
          + usd(preview.effect.renewalStopped.amountMinor)
          + " renewal on "
          + day(preview.effect.renewalStopped.dueAt),
        value: "Would not be charged."
      });
    }
    return Object.freeze({
      preview: preview,
      heading: preview.state === "already_scheduled"
        ? "Your Alakazam plan is already set to end."
        : "What cancelling would do",
      summary: preview.state === "already_scheduled"
        ? "Nothing more happens until " + endsOn + "."
        : "Read this before you decide. Nothing changes until you confirm.",
      facts: facts,
      policyNote: "We have not published the refund terms for cancelling yet, so we cannot take a cancellation here. Contact us and we will handle it with you directly.",
      portalNote: "The billing portal is not open yet.",
      confirmAvailable: false
    });
  }

  function verifiedBillingStatesRetry(value) {
    return exactKeys(value, [
      "active",
      "graceEndsAt",
      "startedAt"
    ])
      && typeof value.active === "boolean"
      && nullableIso(value.startedAt)
      && nullableIso(value.graceEndsAt);
  }

  function verifiedAlakazamBillingStates(
    value,
    projectId
  ) {
    if (
      !exactKeys(value, [
        "display",
        "observedAt",
        "payment",
        "projectId",
        "providerObservedAt",
        "reconciliation",
        "replay",
        "revision",
        "schema"
      ])
      || value.schema !== BILLING_STATES_SCHEMA
      || text(value.projectId) !== text(projectId)
      || !safeIso(value.observedAt)
      || !Number.isSafeInteger(value.revision)
      || value.revision < 0
      || !nullableIso(value.providerObservedAt)
      || !exactKeys(value.payment, [
        "retry",
        "state",
        "subscriptionStatus"
      ])
      || PAYMENT_STATES.indexOf(value.payment.state) < 0
      || !verifiedBillingStatesRetry(value.payment.retry)
      || value.payment.retry.active !==
        (value.payment.state === "retrying")
      || !exactKeys(value.replay, [
        "duplicateSuppressed",
        "failed",
        "lastEventAt",
        "maximumAttempts",
        "outstanding",
        "processedThrough",
        "state"
      ])
      || REPLAY_STATES.indexOf(value.replay.state) < 0
      || value.replay.duplicateSuppressed !== true
      || !safeMinor(value.replay.outstanding)
      || !safeMinor(value.replay.failed)
      || !safeMinor(value.replay.maximumAttempts)
      || value.replay.failed > value.replay.outstanding
      || !nullableIso(value.replay.processedThrough)
      || !nullableIso(value.replay.lastEventAt)
      || !exactKeys(value.reconciliation, [
        "kind",
        "since",
        "state"
      ])
      || ["none", "required"].indexOf(
        value.reconciliation.state
      ) < 0
      || (value.reconciliation.state === "required") !==
        (RECONCILIATION_KINDS.indexOf(
          value.reconciliation.kind
        ) >= 0)
      || (value.reconciliation.kind === null) !==
        (value.reconciliation.since === null)
      || !exactKeys(value.display, [
        "attentionRequired",
        "settled"
      ])
      || typeof value.display.attentionRequired !==
        "boolean"
      || typeof value.display.settled !== "boolean"
      || value.display.settled !== (
        value.payment.state !== "retrying"
        && value.replay.state === "settled"
        && value.reconciliation.state === "none"
      )
    ) return null;
    return clone(value);
  }

  /**
   * E-09. The anti-stale rule. A replayed webhook, or a slow response that
   * lands after a newer one, must never move the account view backwards.
   */
  function alakazamBillingStatesAreNewer(next, current) {
    if (!record(current)) return record(next);
    if (!record(next)) return false;
    if (next.revision !== current.revision) {
      return next.revision > current.revision;
    }
    return Date.parse(next.observedAt)
      > Date.parse(current.observedAt);
  }

  function mergeAlakazamBillingStates(current, next) {
    return alakazamBillingStatesAreNewer(next, current)
      ? next
      : current;
  }

  function paymentCopy(states) {
    var retry = states.payment.retry;
    return {
      none: {
        tone: "neutral",
        title: "No Alakazam plan yet.",
        detail: "Nothing is being charged."
      },
      pending: {
        tone: "waiting",
        title: "We are confirming your first payment.",
        detail: "This usually takes a moment."
      },
      current: {
        tone: "good",
        title: "Your payments are up to date.",
        detail: "Nothing needs your attention."
      },
      retrying: {
        tone: "attention",
        title: "A payment did not go through.",
        detail: retry.graceEndsAt
          ? "We will keep trying until "
            + day(retry.graceEndsAt)
            + ". Your website stays up until then."
          : "We will try again shortly."
      },
      suspended: {
        tone: "attention",
        title: "This plan is paused.",
        detail: "A payment did not go through in time."
      },
      ended: {
        tone: "neutral",
        title: "This plan has ended.",
        detail: "Your saved setup and receipts stay in your account."
      }
    }[states.payment.state];
  }

  function replayCopy(states) {
    return {
      settled: null,
      verifying: {
        tone: "waiting",
        title: "A payment update is still being confirmed.",
        detail: "What you see below may change in a moment."
      },
      attention_required: {
        tone: "attention",
        title: "A payment update did not finish.",
        detail: "We are looking into it. Nothing has been charged twice."
      }
    }[states.replay.state];
  }

  function reconciliationCopy(states) {
    if (states.reconciliation.state === "none") {
      return null;
    }
    return {
      tone: "waiting",
      title: states.reconciliation.kind === "tier_change"
        ? "We are checking a plan change with our payment provider."
        : "We are checking a scheduled plan change with our payment provider.",
      detail: "It will show here as soon as it is confirmed."
    };
  }

  /**
   * E-09. The account view's true billing state: what is being retried, what
   * is still being confirmed, and what is waiting on the payment provider.
   */
  function alakazamBillingStatesPresentation(
    value,
    projectId
  ) {
    var states = verifiedAlakazamBillingStates(
      value,
      projectId
    );
    if (!states) return null;
    var notices = [paymentCopy(states)];
    var replay = replayCopy(states);
    if (replay) notices.push(replay);
    var reconciliation = reconciliationCopy(states);
    if (reconciliation) notices.push(reconciliation);
    return Object.freeze({
      states: states,
      heading: "Your billing",
      notices: notices,
      settled: states.display.settled,
      attentionRequired:
        states.display.attentionRequired,
      asOf: "Checked " + day(states.observedAt) + ".",
      revision: states.revision
    });
  }

  return Object.freeze({
    alakazamBillingStatesAreNewer:
      alakazamBillingStatesAreNewer,
    alakazamBillingStatesPresentation:
      alakazamBillingStatesPresentation,
    alakazamCancellationPreviewPresentation:
      alakazamCancellationPreviewPresentation,
    alakazamInvoicePresentation:
      alakazamInvoicePresentation,
    billingStatesSchema: BILLING_STATES_SCHEMA,
    cancellationPreviewSchema:
      CANCELLATION_PREVIEW_SCHEMA,
    invoiceSchema: INVOICE_SCHEMA,
    mergeAlakazamBillingStates:
      mergeAlakazamBillingStates,
    verifiedAlakazamBillingStates:
      verifiedAlakazamBillingStates,
    verifiedAlakazamCancellationPreview:
      verifiedAlakazamCancellationPreview,
    verifiedAlakazamInvoice: verifiedAlakazamInvoice
  });
}));
