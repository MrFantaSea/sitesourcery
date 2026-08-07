(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraCustomerControl = api;
    api.boot(root);
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return value == null
      ? value
      : JSON.parse(JSON.stringify(value));
  }

  function idOf(value) {
    return text(value && (
      value.id
      || value.projectId
      || value.versionId
      || value.quoteId
    ));
  }

  var ALAKAZAM_ACCOUNT_SCHEMA =
    "sitesourcery.alakazam-account/v2";
  var ALAKAZAM_QUOTE_SCHEMA =
    "sitesourcery.alakazam-tier-change-quote.v1";
  var ALAKAZAM_DISCLOSURE_SCHEMA =
    "sitesourcery.alakazam-tier-change-disclosure.v1";
  var ALAKAZAM_CHECKOUT_SCHEMA =
    "sitesourcery.alakazam-checkout-ready/v1";
  var ALAKAZAM_DOWNGRADE_SCHEMA =
    "sitesourcery.alakazam-downgrade-scheduled/v1";
  var ALAKAZAM_ACCOUNT_STATES = [
    "available",
    "activation_pending",
    "active",
    "attention_required",
    "ended"
  ];
  var ALAKAZAM_SITE_STATES = [
    "setup_required",
    "ready_for_checkout",
    "payment_pending",
    "publishing",
    "live",
    "attention_required"
  ];
  var ALAKAZAM_PUBLIC_LOOKS = [
    { lookId: "look_crystal", label: "Crystal" },
    { lookId: "look_hearth", label: "Hearth" },
    { lookId: "look_midnight", label: "Midnight" }
  ];
  var ALAKAZAM_ACTION_REASONS = [
    "site_setup_required",
    "only_start_composed",
    "site_payment_pending",
    "site_publishing",
    "only_tier_change_composed",
    "site_attention_required",
    "customer_commands_not_composed"
  ];
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var SHA256 = /^[a-f0-9]{64}$/u;
  var ASSESSMENT_PAGE_PATH =
    /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u;
  var ASSESSMENT_PAGE_TYPE = /^[a-z][a-z0-9_]{1,79}$/u;
  var ASSESSMENT_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
  var ASSESSMENT_MAXIMUM_EVIDENCE_BYTES = 700 * 1024;
  var ASSESSMENT_ELIGIBLE_TIER_IDS = [
    "card",
    "card-plus",
    "site",
    "site-plus",
    "signature",
    "flagship",
    "scale"
  ];
  var CUSTOM_BUILD_COMMERCIAL_CONTRACT_ID =
    "SS-CUSTOM-SERVICES-2026-08-05.1";
  var CUSTOM_BUILD_COMMERCIAL_CONTRACT_DIGEST =
    "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8";
  var CUSTOM_BUILD_LEGAL_DOCUMENT_ID =
    "00000000-0000-4000-8000-000000000342";
  var CUSTOM_BUILD_PROGRESS_SCHEMA =
    "sitesourcery.custom-build-progress/v1";
  var CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA =
    "sitesourcery.custom-build-change-completion/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA =
    "sitesourcery.custom-build-change-invoice/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA =
    "sitesourcery.custom-build-change-checkout/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_OWNER_SCHEMA =
    "sitesourcery.custom-build-change-payments-owner/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_SCHEMA =
    "sitesourcery.custom-build-change-payment-reconciliation-command/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA =
    "sitesourcery.custom-build-change-settlement/v1";
  var CUSTOM_BUILD_CHANGE_UNIT_MINOR = 12500;
  var CUSTOM_BUILD_COMPLETION_CHECKS = Object.freeze([
    Object.freeze(["scope", "Approved scope"]),
    Object.freeze(["desktop", "Desktop view"]),
    Object.freeze(["phone", "Phone view"]),
    Object.freeze(["links", "Links"]),
    Object.freeze(["contactActions", "Contact actions"]),
    Object.freeze(["accessibilityBasics", "Accessibility basics"])
  ]);
  var CUSTOM_BUILD_PROGRESS_STAGES = Object.freeze({
    preparing: "Preparing",
    building: "Building",
    checking: "Checking the work"
  });
  var CUSTOM_BUILD_PROGRESS_MILESTONES = Object.freeze([
    Object.freeze(["structure", "Plan and structure"]),
    Object.freeze(["content", "Pages and content"]),
    Object.freeze(["responsive", "Phone and accessibility"]),
    Object.freeze(["quality", "Final checks"])
  ]);
  var CUSTOM_BUILD_PROGRESS_CREDENTIAL =
    /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase)/iu;
  var CUSTOM_BUILD_TIERS = Object.freeze([
    Object.freeze({
      id: "card",
      label: "Card",
      amountMinor: 40000,
      defaults: [1, 5, 1, 500, 2],
      maxima: [1, 5, 1, 500, 2]
    }),
    Object.freeze({
      id: "card-plus",
      label: "Card Plus",
      amountMinor: 65000,
      defaults: [1, 8, 1, 900, 8],
      maxima: [1, 8, 1, 900, 8]
    }),
    Object.freeze({
      id: "site",
      label: "Site",
      amountMinor: 120000,
      defaults: [4, 16, 4, 1800, 12],
      maxima: [4, 16, 4, 1800, 12]
    }),
    Object.freeze({
      id: "site-plus",
      label: "Site Plus",
      amountMinor: 180000,
      defaults: [7, 28, 7, 3000, 24],
      maxima: [7, 28, 7, 3000, 24]
    }),
    Object.freeze({
      id: "signature",
      label: "Signature",
      amountMinor: 280000,
      defaults: [10, 40, 10, 4500, 36],
      maxima: [10, 40, 10, 4500, 36]
    }),
    Object.freeze({
      id: "flagship",
      label: "Flagship",
      amountMinor: 400000,
      defaults: [15, 60, 15, 7000, 60],
      maxima: [15, 60, 15, 7000, 60]
    }),
    Object.freeze({
      id: "scale",
      label: "Scale",
      amountMinor: null,
      defaults: [16, 64, 16, 7500, 64],
      maxima: [30, 120, 30, 14500, 120]
    })
  ]);
  var ASSESSMENT_SEVERITIES = [
    "critical",
    "high",
    "moderate",
    "low",
    "positive"
  ];
  var ASSESSMENT_CATEGORIES = [
    "accessibility",
    "content",
    "functionality",
    "performance",
    "responsive_design",
    "search_visibility",
    "security_observation",
    "usability",
    "visual_design"
  ];
  var ALAKAZAM_PAYMENT_STATES = {
    pending: "pending",
    active: "paid",
    grace: "attention_required",
    suspended: "suspended",
    cancelled: "cancelled",
    ended: "ended"
  };

  function record(value) {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value);
  }

  function exactKeys(value, expected) {
    return record(value)
      && JSON.stringify(Object.keys(value).sort())
        === JSON.stringify(expected.slice().sort());
  }

  function safeMinor(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function safeCurrency(value) {
    return /^[A-Z]{3}$/u.test(text(value));
  }

  function safeIso(value) {
    return typeof value === "string"
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value;
  }

  function nullableIso(value) {
    return value === null || safeIso(value);
  }

  function safeAlakazamAddressLabel(value) {
    return typeof value === "string"
      && value.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
        .test(value);
  }

  function verifiedAlakazamLook(value) {
    if (value === null) return true;
    if (!exactKeys(value, ["label", "lookId"])) {
      return false;
    }
    return ALAKAZAM_PUBLIC_LOOKS.some(function (look) {
      return value.lookId === look.lookId
        && value.label === look.label;
    });
  }

  function safeAlakazamSiteUrl(value) {
    if (
      !record(value)
      || value.state !== "live"
      || !safeAlakazamAddressLabel(value.addressLabel)
      || value.hostname !==
        value.addressLabel + ".sitesourcery.me"
      || value.url !== "https://" + value.hostname + "/"
    ) return null;
    try {
      var parsed = new URL(value.url);
      return parsed.protocol === "https:"
        && parsed.username === ""
        && parsed.password === ""
        && parsed.port === ""
        && parsed.hostname === value.hostname
        && parsed.pathname === "/"
        && parsed.search === ""
        && parsed.hash === ""
        ? value.url
        : null;
    } catch (error) {
      return null;
    }
  }

  function verifiedAlakazamSite(value) {
    if (
      !exactKeys(
        value,
        [
          "acceptedVersionId",
          "addressLabel",
          "hostname",
          "look",
          "setupDigest",
          "state",
          "updatedAt",
          "url"
        ]
      )
      || !ALAKAZAM_SITE_STATES.includes(value.state)
      || !verifiedAlakazamLook(value.look)
    ) return false;
    var hasVersion = value.acceptedVersionId !== null;
    var hasAddress = value.addressLabel !== null;
    var setupReady = hasVersion && hasAddress;
    if (
      hasVersion !== (value.look !== null)
      || (
        hasVersion
          ? !UUID.test(text(value.acceptedVersionId))
          : value.acceptedVersionId !== null
      )
      || hasAddress !== (value.hostname !== null)
      || (
        hasAddress
          ? !safeAlakazamAddressLabel(value.addressLabel)
            || value.hostname !==
              value.addressLabel + ".sitesourcery.me"
          : value.hostname !== null
      )
      || setupReady !== (value.setupDigest !== null)
      || (
        value.setupDigest !== null
        && !SHA256.test(value.setupDigest)
      )
      || (
        setupReady
          ? value.state === "setup_required"
          : ![
              "setup_required",
              "attention_required"
            ].includes(value.state)
      )
      || (
        hasVersion
        || hasAddress
        || value.state === "attention_required"
          ? !safeIso(value.updatedAt)
          : value.updatedAt !== null
      )
      || (
        value.state === "live"
          ? safeAlakazamSiteUrl(value) !== value.url
          : value.url !== null
      )
    ) return false;
    return true;
  }

  function verifiedAlakazamPrice(value) {
    return exactKeys(
      value,
      ["amountMinor", "billing", "currency", "interval"]
    )
      && safeMinor(value.amountMinor)
      && safeCurrency(value.currency)
      && value.billing === "recurring"
      && value.interval === "month";
  }

  function verifiedAlakazamTier(value) {
    return exactKeys(
      value,
      [
        "capabilities",
        "limits",
        "name",
        "price",
        "rank",
        "tierId"
      ]
    )
      && text(value.tierId)
      && text(value.name)
      && Number.isSafeInteger(value.rank)
      && value.rank > 0
      && verifiedAlakazamPrice(value.price)
      && Array.isArray(value.capabilities)
      && value.capabilities.every(function (capability) {
        return Boolean(text(capability));
      })
      && record(value.limits);
  }

  function matchingCatalogTier(catalog, tier) {
    if (!verifiedAlakazamTier(tier)) return false;
    var stored = catalog.tiers.find(function (candidate) {
      return candidate.tierId === tier.tierId;
    });
    return Boolean(stored)
      && JSON.stringify(stored) === JSON.stringify(tier);
  }

  function verifiedAlakazamCatalog(value) {
    if (
      !exactKeys(
        value,
        [
          "catalogVersion",
          "ladder",
          "product",
          "schema",
          "state",
          "termsVersion",
          "tiers"
        ]
      )
      || value.schema !==
        "sitesourcery.alakazam-public-tier-catalog.v1"
      || !text(value.catalogVersion)
      || !text(value.termsVersion)
      || value.state !== "held"
      || !exactKeys(
        value.product,
        ["name", "productId", "scope"]
      )
      || value.product.productId !== "alakazam_hosting"
      || value.product.name !== "Alakazam"
      || value.product.scope !== "one_editor_project"
      || !exactKeys(
        value.ladder,
        [
          "downgradeRule",
          "downloadCreditMinor",
          "premiumConfiguration",
          "upgradeRule"
        ]
      )
      || value.ladder.downloadCreditMinor !== 500
      || value.ladder.upgradeRule !==
        "fixed_target_minus_current_tier"
      || value.ladder.downgradeRule !==
        "renewal_boundary_no_refund_or_proration"
      || value.ladder.premiumConfiguration !==
        "preserved_when_inactive"
      || !Array.isArray(value.tiers)
      || value.tiers.length !== 3
      || !value.tiers.every(verifiedAlakazamTier)
    ) return false;
    var ids = value.tiers.map(function (tier) {
      return tier.tierId;
    });
    return JSON.stringify(ids) === JSON.stringify([
      "alakazam_25",
      "alakazam_35",
      "alakazam_50"
    ])
      && value.tiers.every(function (tier, index) {
        var amount = [2500, 3500, 5000][index];
        return tier.rank === index + 1
          && tier.price.amountMinor === amount
          && tier.price.currency === "USD";
      });
  }

  function verifiedAlakazamSubscription(value, catalog) {
    if (value === null) return true;
    if (
      !exactKeys(
        value,
        [
          "cancelAtPeriodEnd",
          "currentPeriod",
          "firstFailedAt",
          "graceEndsAt",
          "paymentState",
          "price",
          "revision",
          "status",
          "tier"
        ]
      )
      || !matchingCatalogTier(catalog, value.tier)
      || !verifiedAlakazamPrice(value.price)
      || value.price.amountMinor !==
        value.tier.price.amountMinor
      || value.price.currency !==
        value.tier.price.currency
      || ![
        "pending",
        "active",
        "grace",
        "suspended",
        "cancelled",
        "ended"
      ].includes(value.status)
      || ![
        "pending",
        "paid",
        "attention_required",
        "suspended",
        "cancelled",
        "ended"
      ].includes(value.paymentState)
      || !Number.isSafeInteger(value.revision)
      || value.revision < 1
      || typeof value.cancelAtPeriodEnd !== "boolean"
      || !nullableIso(value.firstFailedAt)
      || !nullableIso(value.graceEndsAt)
      || value.paymentState !==
        ALAKAZAM_PAYMENT_STATES[value.status]
      || (
        value.graceEndsAt !== null
        && value.firstFailedAt === null
      )
    ) return false;
    if (value.currentPeriod === null) {
      return value.status === "pending";
    }
    return value.status !== "pending"
      && exactKeys(
      value.currentPeriod,
      ["endsAt", "startsAt"]
    )
      && safeIso(value.currentPeriod.startsAt)
      && safeIso(value.currentPeriod.endsAt)
      && Date.parse(value.currentPeriod.endsAt)
        > Date.parse(value.currentPeriod.startsAt);
  }

  function verifiedAlakazamPendingChange(value, catalog) {
    if (value === null) return true;
    return exactKeys(
      value,
      ["changeKind", "effectiveAt", "state", "targetTier"]
    )
      && [
        "start",
        "upgrade",
        "downgrade",
        "cancellation"
      ].includes(value.changeKind)
      && [
        "activation_pending",
        "payment_pending",
        "provider_change_pending",
        "schedule_dispatching",
        "scheduled",
        "cancellation_scheduled",
        "reconciliation_required"
      ].includes(value.state)
      && nullableIso(value.effectiveAt)
      && (
        !["downgrade", "cancellation"]
          .includes(value.changeKind)
        || value.effectiveAt !== null
      )
      && (
        value.changeKind === "cancellation"
          ? value.targetTier === null
          : matchingCatalogTier(catalog, value.targetTier)
      );
  }

  function verifiedAlakazamRenewal(value, catalog) {
    if (value === null) return true;
    var tier = catalog.tiers.find(function (candidate) {
      return candidate.tierId === value.tierId;
    });
    return exactKeys(
      value,
      ["amountMinor", "currency", "dueAt", "state", "tierId"]
    )
      && Boolean(tier)
      && safeMinor(value.amountMinor)
      && value.amountMinor === tier.price.amountMinor
      && value.currency === tier.price.currency
      && safeIso(value.dueAt)
      && ["scheduled", "attention_required"]
        .includes(value.state);
  }

  function verifiedAlakazamReceipt(value) {
    return exactKeys(
      value,
      [
        "currency",
        "discountMinor",
        "invoiceAvailable",
        "kind",
        "receiptId",
        "settledAt",
        "subtotalMinor",
        "taxMinor",
        "totalMinor"
      ]
    )
      && UUID.test(text(value.receiptId))
      && [
        "start_payment",
        "upgrade_difference",
        "renewal_payment"
      ].includes(value.kind)
      && safeMinor(value.subtotalMinor)
      && safeMinor(value.discountMinor)
      && safeMinor(value.taxMinor)
      && safeMinor(value.totalMinor)
      && value.subtotalMinor - value.discountMinor
        + value.taxMinor === value.totalMinor
      && value.currency === "USD"
      && safeIso(value.settledAt)
      && typeof value.invoiceAvailable === "boolean";
  }

  function verifiedAlakazamRelationships(value) {
    var subscription = value.subscription;
    var pending = value.pendingChange;
    var renewal = value.nextRenewal;
    if (!subscription) {
      return pending === null && renewal === null;
    }
    if (subscription.status === "pending") {
      return renewal === null
        && Boolean(pending)
        && pending.changeKind === "start"
        && pending.state === "activation_pending"
        && pending.targetTier.tierId ===
          subscription.tier.tierId;
    }
    if (subscription.cancelAtPeriodEnd) {
      return renewal === null
        && Boolean(pending)
        && pending.changeKind === "cancellation"
        && pending.state === "cancellation_scheduled"
        && pending.effectiveAt ===
          subscription.currentPeriod.endsAt;
    }
    if (["cancelled", "ended"].includes(
      subscription.status
    )) {
      return renewal === null;
    }
    if (!renewal) return false;
    var scheduledTier =
      pending
      && pending.changeKind === "downgrade"
      && pending.state === "scheduled"
        ? pending.targetTier
        : subscription.tier;
    return renewal.tierId === scheduledTier.tierId
      && renewal.amountMinor ===
        scheduledTier.price.amountMinor
      && renewal.currency === "USD"
      && renewal.dueAt ===
        subscription.currentPeriod.endsAt
      && renewal.state === (
        ["grace", "suspended"].includes(
          subscription.status
        )
          ? "attention_required"
          : "scheduled"
      );
  }

  function alakazamTierChangeEligible(account) {
    if (
      !record(account)
      || !record(account.catalog)
      || !Array.isArray(account.catalog.tiers)
    ) return false;
    var subscription = account.subscription;
    return record(subscription)
      && record(subscription.tier)
      && Number.isSafeInteger(subscription.tier.rank)
      && subscription.status === "active"
      && subscription.paymentState === "paid"
      && record(subscription.currentPeriod)
      && subscription.cancelAtPeriodEnd === false
      && account.pendingChange === null
      && record(account.site)
      && account.site.state === "live"
      && account.catalog.tiers.some(function (tier) {
        return record(tier)
          && Number.isSafeInteger(tier.rank)
          && tier.rank !== subscription.tier.rank;
      });
  }

  function expectedAlakazamActions(account) {
    if (!record(account) || !record(account.site)) {
      return null;
    }
    var configureSite = Boolean(
      account.subscription === null
      && account.pendingChange === null
      && [
        "setup_required",
        "ready_for_checkout"
      ].includes(account.site.state)
    );
    var start = configureSite
      && account.site.state === "ready_for_checkout";
    var changeTier =
      alakazamTierChangeEligible(account);
    var reason =
      account.site.state === "setup_required"
      && configureSite
        ? "site_setup_required"
        : start
          ? "only_start_composed"
          : account.site.state === "payment_pending"
            ? "site_payment_pending"
            : account.site.state === "publishing"
              ? "site_publishing"
              : changeTier
                ? "only_tier_change_composed"
                : account.site.state ===
                    "attention_required"
                  ? "site_attention_required"
                  : "customer_commands_not_composed";
    return Object.freeze({
      configureSite: configureSite,
      start: start,
      changeTier: changeTier,
      reason: reason
    });
  }

  function verifiedAlakazamAccount(value, projectId) {
    var expectedActions =
      expectedAlakazamActions(value);
    if (
      !exactKeys(
        value,
        [
          "actions",
          "catalog",
          "downloadCredit",
          "nextRenewal",
          "pendingChange",
          "projectId",
          "receipts",
          "schema",
          "site",
          "state",
          "subscription"
        ]
      )
      || value.schema !== ALAKAZAM_ACCOUNT_SCHEMA
      || text(value.projectId) !== text(projectId)
      || !ALAKAZAM_ACCOUNT_STATES.includes(value.state)
      || !verifiedAlakazamCatalog(value.catalog)
      || !exactKeys(
        value.downloadCredit,
        ["amountMinor", "available", "currency"]
      )
      || typeof value.downloadCredit.available !== "boolean"
      || value.downloadCredit.amountMinor !== (
        value.downloadCredit.available
          ? value.catalog.ladder.downloadCreditMinor
          : 0
      )
      || value.downloadCredit.currency !== "USD"
      || !verifiedAlakazamSubscription(
        value.subscription,
        value.catalog
      )
      || (
        value.subscription !== null
        && value.downloadCredit.available
      )
      || !verifiedAlakazamPendingChange(
        value.pendingChange,
        value.catalog
      )
      || !verifiedAlakazamRenewal(
        value.nextRenewal,
        value.catalog
      )
      || !Array.isArray(value.receipts)
      || value.receipts.length > 50
      || !value.receipts.every(verifiedAlakazamReceipt)
      || !verifiedAlakazamSite(value.site)
      || !expectedActions
      || !exactKeys(
        value.actions,
        [
          "cancel",
          "changeTier",
          "configureSite",
          "manageBilling",
          "reason",
          "start"
        ]
      )
      || value.actions.configureSite !==
        expectedActions.configureSite
      || value.actions.start !== expectedActions.start
      || value.actions.changeTier !==
        expectedActions.changeTier
      || value.actions.manageBilling !== false
      || value.actions.cancel !== false
      || !ALAKAZAM_ACTION_REASONS.includes(
        value.actions.reason
      )
      || value.actions.reason !== expectedActions.reason
      || !verifiedAlakazamRelationships(value)
    ) return null;
    var status = value.subscription
      && value.subscription.status;
    var stateMatches = {
      available: value.subscription === null,
      activation_pending: status === "pending",
      active: status === "active",
      attention_required:
        status === "grace" || status === "suspended",
      ended: status === "cancelled" || status === "ended"
    }[value.state];
    return stateMatches ? clone(value) : null;
  }

  function alakazamAccountPresentation(value, projectId) {
    var account = verifiedAlakazamAccount(
      value,
      projectId
    );
    if (!account) return null;
    var copy = {
      setup_required: {
        heading: "Finish your Alakazam website setup.",
        summary:
          "Use the accepted Maker look and choose its Site Sourcery address before checkout."
      },
      ready_for_checkout: {
        heading: "Your Alakazam website is ready for checkout.",
        summary:
          "The accepted look and hosted address are locked into the setup shown below."
      },
      payment_pending: {
        heading: "Alakazam payment is being confirmed.",
        summary:
          "Your setup is saved. Site Sourcery will publish automatically after payment and activation are confirmed."
      },
      publishing: {
        heading: "Your Alakazam website is publishing.",
        summary:
          "The accepted setup is being prepared at the hosted address shown below."
      },
      live: {
        heading: "Alakazam is active.",
        summary:
          "Your website is live. The current plan and renewal details are shown below."
      },
      attention_required: {
        heading: "This Alakazam website needs attention.",
        summary:
          "The website is not shown as live. Your saved setup and billing details remain visible below."
      }
    }[account.site.state];
    if (account.state === "attention_required") {
      copy = {
        heading: "This Alakazam account needs attention.",
        summary:
          "The website, payment state, and any grace date are shown below."
      };
    } else if (account.state === "ended") {
      copy = {
        heading: "This Alakazam subscription has ended.",
        summary:
          "The saved website setup, last plan, and receipts remain visible below."
      };
    }
    return Object.freeze({
      account: account,
      heading: copy.heading,
      summary: copy.summary
    });
  }

  function verifiedAlakazamDueNow(value) {
    if (
      !exactKeys(
        value,
        [
          "currency",
          "subtotalMinor",
          "taxMinor",
          "taxState",
          "totalMinor"
        ]
      )
      || !safeMinor(value.subtotalMinor)
      || value.currency !== "USD"
      || ![
        "automatic",
        "disabled_by_owner"
      ].includes(value.taxState)
    ) return false;
    return value.taxState === "disabled_by_owner"
      ? value.taxMinor === 0
        && value.totalMinor === value.subtotalMinor
      : value.taxMinor === null
        && value.totalMinor === null;
  }

  function verifiedAlakazamAppliedValue(
    value,
    account,
    changeKind
  ) {
    if (
      !exactKeys(value, ["amountMinor", "kind"])
      || !safeMinor(value.amountMinor)
    ) return false;
    if (changeKind === "upgrade") {
      return Boolean(account.subscription)
        && value.kind === "current_paid_tier"
        && value.amountMinor ===
          account.subscription.price.amountMinor;
    }
    if (changeKind === "downgrade") {
      return Boolean(account.subscription)
        && value.kind === "none"
        && value.amountMinor === 0;
    }
    return changeKind === "start"
      && (
        account.downloadCredit.available
          ? value.kind === "download_purchase"
            && value.amountMinor ===
              account.catalog.ladder.downloadCreditMinor
          : value.kind === "none"
            && value.amountMinor === 0
      );
  }

  function expectedAlakazamQuoteChange(
    account,
    targetTierId
  ) {
    if (
      !record(account)
      || !record(account.catalog)
      || !Array.isArray(account.catalog.tiers)
    ) return null;
    var target = account.catalog.tiers.find(
      function (tier) {
        return tier.tierId === text(targetTierId);
      }
    );
    if (!target) return null;
    if (
      account.subscription === null
      && account.actions.start === true
    ) {
      return Object.freeze({
        changeKind: "start",
        currentTierId: null,
        target: target
      });
    }
    if (
      account.subscription
      && account.actions.changeTier === true
      && record(account.subscription.tier)
      && target.rank !== account.subscription.tier.rank
    ) {
      return Object.freeze({
        changeKind: target.rank > account.subscription.tier.rank
          ? "upgrade"
          : "downgrade",
        currentTierId:
          account.subscription.tier.tierId,
        target: target
      });
    }
    return null;
  }

  function verifiedAlakazamQuote(
    value,
    projectId,
    accountValue,
    targetTierId,
    observedAt
  ) {
    var account = verifiedAlakazamAccount(
      accountValue,
      projectId
    );
    var expected = expectedAlakazamQuoteChange(
      account,
      targetTierId
    );
    var observed = safeIso(observedAt)
      ? Date.parse(observedAt)
      : Date.now();
    var downgrade = Boolean(
      expected && expected.changeKind === "downgrade"
    );
    var expectedSubtotal = downgrade
      ? 0
      : expected
        ? expected.target.price.amountMinor
          - (value && value.appliedValue
            ? value.appliedValue.amountMinor
            : 0)
        : null;
    var expectedEffectiveAt = downgrade
      && account
      && account.subscription
      && account.subscription.currentPeriod
        ? account.subscription.currentPeriod.endsAt
        : "after_payment_and_provider_confirmation";
    if (
      !account
      || !expected
      || !exactKeys(
        value,
        [
          "appliedValue",
          "catalogVersion",
          "changeKind",
          "disclosure",
          "disclosureDigest",
          "dueNow",
          "effectiveAt",
          "expiresAt",
          "issuedAt",
          "nextRenewal",
          "noMidPeriodRefundOrProration",
          "premiumConfiguration",
          "projectId",
          "quoteDigest",
          "quoteId",
          "schema",
          "state",
          "targetTier",
          "termsVersion"
        ]
      )
      || value.schema !== ALAKAZAM_QUOTE_SCHEMA
      || !UUID.test(text(value.quoteId))
      || text(value.projectId) !== text(projectId)
      || value.catalogVersion !==
        account.catalog.catalogVersion
      || value.termsVersion !==
        account.catalog.termsVersion
      || value.state !== "quoted"
      || value.changeKind !== expected.changeKind
      || !matchingCatalogTier(
        account.catalog,
        value.targetTier
      )
      || value.targetTier.tierId !==
        text(targetTierId)
      || !verifiedAlakazamDueNow(value.dueNow)
      || !verifiedAlakazamAppliedValue(
        value.appliedValue,
        account,
        expected.changeKind
      )
      || value.dueNow.subtotalMinor !==
        expectedSubtotal
      || value.effectiveAt !==
        expectedEffectiveAt
      || !exactKeys(
        value.nextRenewal,
        ["amountMinor", "currency", "interval", "tierId"]
      )
      || value.nextRenewal.tierId !==
        value.targetTier.tierId
      || value.nextRenewal.amountMinor !==
        value.targetTier.price.amountMinor
      || value.nextRenewal.currency !== "USD"
      || value.nextRenewal.interval !== "month"
      || value.noMidPeriodRefundOrProration !== downgrade
      || value.premiumConfiguration !==
        "preserved_when_inactive"
      || !safeIso(value.issuedAt)
      || !safeIso(value.expiresAt)
      || Date.parse(value.expiresAt) <= observed
      || Date.parse(value.expiresAt) <=
        Date.parse(value.issuedAt)
      || Date.parse(value.expiresAt)
        - Date.parse(value.issuedAt) > 30 * 60 * 1000
      || !SHA256.test(text(value.disclosureDigest))
      || !SHA256.test(text(value.quoteDigest))
      || !exactKeys(
        value.disclosure,
        [
          "appliedValue",
          "cancellationPolicy",
          "changeKind",
          "currentTierId",
          "downgrade",
          "dueNow",
          "effectiveAt",
          "premiumConfiguration",
          "renewal",
          "schema",
          "targetTierId"
        ]
      )
      || value.disclosure.schema !==
        ALAKAZAM_DISCLOSURE_SCHEMA
      || value.disclosure.changeKind !==
        expected.changeKind
      || value.disclosure.currentTierId !==
        expected.currentTierId
      || value.disclosure.targetTierId !==
        value.targetTier.tierId
      || JSON.stringify(value.disclosure.dueNow) !==
        JSON.stringify(value.dueNow)
      || JSON.stringify(
        value.disclosure.appliedValue
      ) !== JSON.stringify(value.appliedValue)
      || value.disclosure.effectiveAt !==
        value.effectiveAt
      || JSON.stringify(value.disclosure.renewal) !==
        JSON.stringify(value.nextRenewal)
      || !exactKeys(
        value.disclosure.downgrade,
        [
          "cashRefundMinor",
          "currentTierKeptThroughPeriod",
          "providerProration"
        ]
      )
      || value.disclosure.downgrade.cashRefundMinor !== 0
      || value.disclosure.downgrade.providerProration !== false
      || value.disclosure.downgrade
        .currentTierKeptThroughPeriod !== downgrade
      || value.disclosure.premiumConfiguration !==
        value.premiumConfiguration
      || value.disclosure.cancellationPolicy !==
        "owner_review_required_before_release"
    ) return null;
    return clone(value);
  }

  function verifiedAlakazamCheckout(
    value,
    projectId,
    quoteId,
    commandId,
    observedAt
  ) {
    var observed = safeIso(observedAt)
      ? Date.parse(observedAt)
      : Date.now();
    if (
      !exactKeys(
        value,
        [
          "checkoutUrl",
          "commandId",
          "expiresAt",
          "projectId",
          "purposeDigest",
          "quoteId",
          "schema",
          "state"
        ]
      )
      || value.schema !== ALAKAZAM_CHECKOUT_SCHEMA
      || text(value.commandId) !== text(commandId)
      || !UUID.test(text(value.commandId))
      || text(value.projectId) !== text(projectId)
      || text(value.quoteId) !== text(quoteId)
      || !UUID.test(text(value.quoteId))
      || value.state !== "ready"
      || !SHA256.test(text(value.purposeDigest))
      || !safeIso(value.expiresAt)
      || Date.parse(value.expiresAt) <= observed
      || !safeCheckoutDestination(value)
    ) return null;
    return clone(value);
  }

  function verifiedAlakazamDowngrade(
    value,
    projectId,
    quote,
    commandId
  ) {
    if (
      !quote
      || quote.changeKind !== "downgrade"
      || !exactKeys(
        value,
        [
          "cashRefundMinor",
          "chargeNowMinor",
          "commandId",
          "currentTierKeptThroughPeriod",
          "effectiveAt",
          "priorTierId",
          "projectId",
          "providerProration",
          "quoteId",
          "schema",
          "state",
          "targetTierId"
        ]
      )
      || value.schema !== ALAKAZAM_DOWNGRADE_SCHEMA
      || text(value.commandId) !== text(commandId)
      || !UUID.test(text(value.commandId))
      || text(value.projectId) !== text(projectId)
      || text(value.quoteId) !== text(quote.quoteId)
      || value.state !== "scheduled"
      || value.priorTierId !==
        quote.disclosure.currentTierId
      || value.targetTierId !==
        quote.targetTier.tierId
      || value.effectiveAt !== quote.effectiveAt
      || value.chargeNowMinor !== 0
      || value.cashRefundMinor !== 0
      || value.providerProration !== false
      || value.currentTierKeptThroughPeriod !== true
    ) return null;
    return clone(value);
  }

  function confirmedAlakazamDowngradeProjection(
    account,
    scheduled
  ) {
    var subscription = account
      && account.subscription;
    var pending = account
      && account.pendingChange;
    var renewal = account
      && account.nextRenewal;
    return Boolean(
      record(account)
      && record(scheduled)
      && text(account.projectId) ===
        text(scheduled.projectId)
      && record(subscription)
      && record(subscription.tier)
      && subscription.tier.tierId ===
        scheduled.priorTierId
      && record(subscription.currentPeriod)
      && subscription.currentPeriod.endsAt ===
        scheduled.effectiveAt
      && record(pending)
      && pending.changeKind === "downgrade"
      && pending.state === "scheduled"
      && record(pending.targetTier)
      && pending.targetTier.tierId ===
        scheduled.targetTierId
      && pending.effectiveAt ===
        scheduled.effectiveAt
      && record(renewal)
      && renewal.tierId ===
        scheduled.targetTierId
      && renewal.dueAt === scheduled.effectiveAt
      && account.actions
      && account.actions.changeTier === false
    );
  }

  function accountElement(
    documentRef,
    name,
    className,
    copy
  ) {
    var element = documentRef.createElement(name);
    if (className) element.className = className;
    if (copy != null) element.textContent = copy;
    return element;
  }

  function accountWords(value) {
    var words = text(value).replaceAll("_", " ");
    return words
      ? words.charAt(0).toUpperCase() + words.slice(1)
      : "Not listed";
  }

  function accountMoney(value) {
    if (
      !value
      || !safeMinor(value.amountMinor)
      || !safeCurrency(value.currency)
    ) return "Not listed";
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: value.currency
    }).format(value.amountMinor / 100)
      + " " + value.currency;
  }

  function accountReceiptMoney(receipt) {
    return accountMoney({
      amountMinor: receipt && receipt.totalMinor,
      currency: receipt && receipt.currency
    });
  }

  function accountDate(value) {
    return safeIso(value)
      ? new Date(value).toLocaleString()
      : "Not listed";
  }

  function appendAccountFact(
    documentRef,
    list,
    label,
    value
  ) {
    var row = accountElement(
      documentRef,
      "div",
      "customer-alakazam-fact"
    );
    var detail = accountElement(
      documentRef,
      "dd",
      ""
    );
    if (
      value
      && typeof value === "object"
      && typeof detail.appendChild === "function"
    ) {
      detail.appendChild(value);
    } else {
      detail.textContent = value;
    }
    row.append(
      accountElement(documentRef, "dt", "", label),
      detail
    );
    list.appendChild(row);
  }

  function catalogTierName(account, tierId) {
    var tier = account.catalog.tiers.find(
      function (candidate) {
        return candidate.tierId === tierId;
      }
    );
    return tier ? tier.name : text(tierId);
  }

  function renderAlakazamSiteSetup(
    documentRef,
    body,
    account,
    command,
    actions
  ) {
    if (account.actions.configureSite !== true) return;
    var section = accountElement(
      documentRef,
      "section",
      "customer-alakazam-site-setup"
    );
    section.setAttribute(
      "aria-labelledby",
      "customer-alakazam-site-setup-title"
    );
    var heading = accountElement(
      documentRef,
      "h4",
      "",
      "Site Sourcery address"
    );
    heading.id = "customer-alakazam-site-setup-title";
    var help = accountElement(
      documentRef,
      "p",
      "customer-alakazam-site-help",
      account.site.acceptedVersionId
        ? "Choose the platform label for the accepted "
          + (account.site.look
            ? account.site.look.label
            : "Maker")
          + " look. Saving a different address clears any quote currently under review."
        : "Accept a Maker look before choosing its hosted address."
    );
    help.id = "customer-alakazam-site-help";
    var form = accountElement(
      documentRef,
      "form",
      "customer-alakazam-site-form"
    );
    form.setAttribute("data-alakazam-site-form", "");
    var label = accountElement(
      documentRef,
      "label",
      "",
      "Platform address label"
    );
    label.setAttribute(
      "for",
      "customer-alakazam-address-label"
    );
    var address = accountElement(
      documentRef,
      "div",
      "customer-alakazam-site-address"
    );
    var input = accountElement(
      documentRef,
      "input",
      ""
    );
    input.id = "customer-alakazam-address-label";
    input.name = "alakazamAddressLabel";
    input.type = "text";
    input.value = command.setupCommandId
      && safeAlakazamAddressLabel(command.setupLabel)
        ? command.setupLabel
        : account.site.addressLabel || "";
    input.maxLength = 63;
    input.required = true;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "none");
    input.setAttribute("inputmode", "url");
    input.setAttribute(
      "pattern",
      "[a-z0-9](?:[a-z0-9\\-]{0,61}[a-z0-9])?"
    );
    input.setAttribute(
      "aria-describedby",
      "customer-alakazam-site-suffix customer-alakazam-site-help"
    );
    input.setAttribute("data-alakazam-address-label", "");
    var suffix = accountElement(
      documentRef,
      "span",
      "",
      ".sitesourcery.me"
    );
    suffix.id = "customer-alakazam-site-suffix";
    var save = accountElement(
      documentRef,
      "button",
      "spark-button spark-button-primary",
      command.phase === "configuring"
        ? "Saving address…"
        : "Save hosted address"
    );
    save.type = "submit";
    save.setAttribute("data-alakazam-save-address", "");
    function syncSave() {
      save.disabled =
        !account.site.acceptedVersionId
        || !safeAlakazamAddressLabel(
          text(input.value)
        )
        || command.phase === "configuring";
    }
    input.addEventListener("input", syncSave);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var addressLabel = text(input.value);
      if (
        !save.disabled
        && typeof actions.configure === "function"
      ) actions.configure(addressLabel);
    });
    address.append(input, suffix);
    form.append(label, address, save);
    section.append(heading, help, form);
    if (command.setupCommandId && command.error) {
      var error = accountElement(
        documentRef,
        "p",
        "customer-alakazam-command-error",
        command.error
      );
      error.setAttribute("role", "alert");
      section.appendChild(error);
    } else if (command.phase === "configuring") {
      var pending = accountElement(
        documentRef,
        "p",
        "customer-alakazam-command-state",
        "Saving the address and refreshing exact website setup…"
      );
      pending.setAttribute("role", "status");
      pending.setAttribute("aria-live", "polite");
      section.appendChild(pending);
    }
    syncSave();
    body.appendChild(section);
  }

  function renderAlakazamQuoteReview(
    documentRef,
    body,
    account,
    command,
    capabilities,
    actions
  ) {
    var selected = command || {};
    if (selected.error && !selected.setupCommandId) {
      var error = accountElement(
        documentRef,
        "p",
        "customer-alakazam-command-error",
        selected.error
      );
      error.setAttribute("role", "alert");
      body.appendChild(error);
    }
    if (!selected.quote) {
      if (selected.phase === "quoting") {
        var pending = accountElement(
          documentRef,
          "p",
          "customer-alakazam-command-state",
          "Requesting the exact server quote…"
        );
        pending.setAttribute("role", "status");
        body.appendChild(pending);
      }
      return;
    }

    var quote = selected.quote;
    var upgrade = quote.changeKind === "upgrade";
    var downgrade = quote.changeKind === "downgrade";
    var review = accountElement(
      documentRef,
      "section",
      "customer-alakazam-quote-review"
    );
    review.setAttribute("data-alakazam-quote-review", "");
    review.setAttribute(
      "aria-labelledby",
      "customer-alakazam-quote-title"
    );
    var heading = accountElement(
      documentRef,
      "h4",
      "",
      downgrade
        ? "Review the exact downgrade schedule"
        : upgrade
          ? "Review the exact upgrade quote"
          : "Review the exact subscription quote"
    );
    heading.id = "customer-alakazam-quote-title";
    var facts = accountElement(
      documentRef,
      "dl",
      "customer-alakazam-quote-facts"
    );
    if (upgrade || downgrade) {
      appendAccountFact(
        documentRef,
        facts,
        "Current tier",
        account.subscription.tier.name + " · "
          + accountMoney(account.subscription.price)
          + (downgrade
            ? " kept through "
              + accountDate(quote.effectiveAt)
            : " already paid this period")
      );
    }
    appendAccountFact(
      documentRef,
      facts,
      "Selected tier",
      quote.targetTier.name + " · "
        + accountMoney(quote.targetTier.price)
        + " a month"
    );
    appendAccountFact(
      documentRef,
      facts,
      downgrade
        ? "Cash refund now"
        : upgrade
          ? "Current plan credit"
          : "Download credit",
      downgrade
        ? accountMoney({
          amountMinor:
            quote.disclosure.downgrade.cashRefundMinor,
          currency: "USD"
        }) + " · no mid-period refund"
        : quote.appliedValue.amountMinor > 0
          ? "−" + accountMoney({
            amountMinor: quote.appliedValue.amountMinor,
            currency: "USD"
          }) + (
            upgrade
              ? " already paid this period"
              : " applied once"
          )
          : "No credit applied"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Due now",
      downgrade
        ? accountMoney({
          amountMinor: quote.dueNow.subtotalMinor,
          currency: quote.dueNow.currency
        }) + " · no charge and no proration"
        : quote.dueNow.taxState === "automatic"
        ? accountMoney({
          amountMinor: quote.dueNow.subtotalMinor,
          currency: quote.dueNow.currency
        }) + " plus tax calculated at secure checkout"
        : accountMoney({
          amountMinor: quote.dueNow.totalMinor,
          currency: quote.dueNow.currency
        })
    );
    appendAccountFact(
      documentRef,
      facts,
      "Next renewal",
      accountMoney({
        amountMinor: quote.nextRenewal.amountMinor,
        currency: quote.nextRenewal.currency
      }) + " each month" + (downgrade
        ? " beginning " + accountDate(quote.effectiveAt)
        : "")
    );
    appendAccountFact(
      documentRef,
      facts,
      downgrade ? "Takes effect" : "Starts",
      downgrade
        ? accountDate(quote.effectiveAt)
          + " · current tier stays active until then"
        : upgrade
          ? "After difference payment and subscription confirmation"
          : "After payment and subscription confirmation"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Quote expires",
      accountDate(quote.expiresAt)
    );

    if (
      downgrade
      && selected.phase === "scheduled"
      && record(selected.scheduled)
    ) {
      var confirmation = accountElement(
        documentRef,
        "p",
        "customer-alakazam-command-success",
        selected.refreshState === "error"
          ? "Downgrade scheduled for "
            + accountDate(selected.scheduled.effectiveAt)
            + ". $0 was charged and $0 was refunded. Updated billing details could not be loaded. Try loading billing again; the Schedule command will not be sent again."
          : selected.refreshState === "loading"
            ? "Downgrade scheduled for "
              + accountDate(selected.scheduled.effectiveAt)
              + ". $0 was charged and $0 was refunded. Refreshing billing details…"
            : "Downgrade scheduled for "
              + accountDate(selected.scheduled.effectiveAt)
              + ". $0 was charged and $0 was refunded. Billing details are updated below."
      );
      confirmation.setAttribute(
        "data-alakazam-downgrade-confirmation",
        ""
      );
      confirmation.setAttribute("role", "status");
      confirmation.setAttribute("aria-live", "polite");
      confirmation.setAttribute("tabindex", "-1");
      review.append(heading, facts, confirmation);
      body.appendChild(review);
      return;
    }

    var acceptance = accountElement(
      documentRef,
      "label",
      "customer-alakazam-acceptance"
    );
    var checkbox = accountElement(
      documentRef,
      "input",
      ""
    );
    checkbox.type = "checkbox";
    checkbox.setAttribute("data-alakazam-accept", "");
    var acceptanceCopy = accountElement(
      documentRef,
      "span",
      "",
      downgrade
        ? "I reviewed and accept $0 charged now, $0 refunded now, my current tier through the paid period, and the lower monthly renewal shown above."
        : upgrade
          ? "I reviewed and accept the difference due now and the new monthly renewal shown above."
          : "I reviewed and accept the amount due now and monthly renewal shown above."
    );
    acceptance.append(checkbox, acceptanceCopy);

    var continueButton = accountElement(
      documentRef,
      "button",
      "spark-button spark-button-primary",
      downgrade
        ? selected.phase === "scheduling"
          ? "Scheduling downgrade…"
          : "Schedule downgrade"
        : selected.phase === "checkout"
          ? "Opening secure payment…"
          : "Continue to secure payment"
    );
    continueButton.type = "button";
    continueButton.setAttribute(
      downgrade
        ? "data-alakazam-schedule-downgrade"
        : "data-alakazam-checkout",
      ""
    );
    function syncContinue() {
      continueButton.disabled =
        checkbox.checked !== true
        || (downgrade
          ? capabilities.alakazamDowngrade !== true
          : capabilities.alakazamCheckout !== true)
        || selected.phase === "checkout"
        || selected.phase === "scheduling";
    }
    checkbox.addEventListener("change", syncContinue);
    continueButton.addEventListener("click", function () {
      if (
        checkbox.checked === true
        && typeof (
          downgrade ? actions.downgrade : actions.checkout
        ) === "function"
      ) {
        if (downgrade) actions.downgrade();
        else actions.checkout();
      }
    });
    syncContinue();

    review.append(heading, facts, acceptance);
    if (
      downgrade
        ? capabilities.alakazamDowngrade !== true
        : capabilities.alakazamCheckout !== true
    ) {
      review.appendChild(
        accountElement(
          documentRef,
          "p",
          "customer-alakazam-command-state",
          downgrade
            ? "The exact downgrade schedule is available for review, but scheduling is not open yet."
            : upgrade
              ? "The exact upgrade quote is available for review, but secure upgrade payment is not open yet."
              : "The exact quote is available for review, but secure subscription payment is not open yet."
        )
      );
    }
    review.appendChild(continueButton);
    body.appendChild(review);
  }

  function renderAlakazamAccountBody(
    documentRef,
    body,
    presentation,
    command,
    capabilities,
    actions
  ) {
    var account = presentation.account;
    body.replaceChildren();
    body.append(
      accountElement(
        documentRef,
        "h4",
        "customer-alakazam-state-title",
        presentation.heading
      ),
      accountElement(
        documentRef,
        "p",
        "customer-alakazam-summary",
        presentation.summary
      )
    );

    var facts = accountElement(
      documentRef,
      "dl",
      "customer-alakazam-facts"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Website status",
      accountWords(account.site.state)
    );
    appendAccountFact(
      documentRef,
      facts,
      "Accepted look",
      account.site.look
        ? account.site.look.label
        : "No accepted Maker look yet"
    );
    var liveUrl = safeAlakazamSiteUrl(account.site);
    if (liveUrl) {
      var liveLink = accountElement(
        documentRef,
        "a",
        "customer-alakazam-live-link",
        account.site.hostname
      );
      liveLink.href = liveUrl;
      appendAccountFact(
        documentRef,
        facts,
        "Hosted address",
        liveLink
      );
    } else {
      appendAccountFact(
        documentRef,
        facts,
        "Hosted address",
        account.site.hostname || "Not chosen yet"
      );
    }
    appendAccountFact(
      documentRef,
      facts,
      "Setup updated",
      account.site.updatedAt
        ? accountDate(account.site.updatedAt)
        : "Not saved yet"
    );
    if (account.subscription) {
      appendAccountFact(
        documentRef,
        facts,
        "Current tier",
        account.subscription.tier.name
          + " · "
          + accountMoney(account.subscription.price)
          + " a month"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Subscription state",
        accountWords(account.subscription.status)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Payment state",
        accountWords(account.subscription.paymentState)
      );
      if (account.subscription.currentPeriod) {
        appendAccountFact(
          documentRef,
          facts,
          "Current period",
          accountDate(
            account.subscription.currentPeriod.startsAt
          ) + " – " + accountDate(
            account.subscription.currentPeriod.endsAt
          )
        );
      }
      if (account.subscription.cancelAtPeriodEnd) {
        appendAccountFact(
          documentRef,
          facts,
          "Cancellation",
          "Scheduled for the end of the current period"
        );
      }
      if (account.subscription.firstFailedAt) {
        appendAccountFact(
          documentRef,
          facts,
          "Payment first needed attention",
          accountDate(account.subscription.firstFailedAt)
        );
      }
      if (account.subscription.graceEndsAt) {
        appendAccountFact(
          documentRef,
          facts,
          "Grace period ends",
          accountDate(account.subscription.graceEndsAt)
        );
      }
    } else {
      appendAccountFact(
        documentRef,
        facts,
        "Current tier",
        "No subscription"
      );
    }

    appendAccountFact(
      documentRef,
      facts,
      "Download credit",
      account.downloadCredit.available
        ? accountMoney(account.downloadCredit)
          + " available"
        : "Not available · "
          + accountMoney(account.downloadCredit)
    );

    if (account.nextRenewal) {
      appendAccountFact(
        documentRef,
        facts,
        "Next renewal",
        catalogTierName(
          account,
          account.nextRenewal.tierId
        ) + " · "
          + accountMoney(account.nextRenewal)
          + " · "
          + accountDate(account.nextRenewal.dueAt)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Renewal state",
        accountWords(account.nextRenewal.state)
      );
    } else {
      appendAccountFact(
        documentRef,
        facts,
        "Next renewal",
        "No renewal is currently listed"
      );
    }

    if (account.pendingChange) {
      var target = account.pendingChange.targetTier
        ? " to " + account.pendingChange.targetTier.name
        : "";
      appendAccountFact(
        documentRef,
        facts,
        "Pending change",
        accountWords(account.pendingChange.changeKind)
          + target
      );
      appendAccountFact(
        documentRef,
        facts,
        "Change state",
        accountWords(account.pendingChange.state)
      );
      if (account.pendingChange.effectiveAt) {
        appendAccountFact(
          documentRef,
          facts,
          "Change takes effect",
          accountDate(account.pendingChange.effectiveAt)
        );
      }
    }
    body.appendChild(facts);
    renderAlakazamSiteSetup(
      documentRef,
      body,
      account,
      command,
      actions
    );

    var commandKind = account.subscription
      ? account.actions.changeTier === true
        ? "change"
        : ""
      : account.actions.start === true
        ? "start"
        : "";
    var selectableTiers = account.catalog.tiers.filter(
      function (tier) {
        return Boolean(expectedAlakazamQuoteChange(
          account,
          tier.tierId
        ));
      }
    );

    if (selectableTiers.length > 0) {
      var tiers = accountElement(
        documentRef,
        "section",
        "customer-alakazam-tiers"
      );
      var tierHeading = accountElement(
        documentRef,
        "h4",
        "",
        commandKind === "change"
          ? "Change tier options"
          : "Available tiers"
      );
      var tierList = accountElement(
        documentRef,
        "ul",
        "customer-alakazam-tier-list"
      );
      tierList.setAttribute(
        "aria-label",
        commandKind === "change"
          ? "Available Alakazam tier changes"
          : "Available Alakazam tiers"
      );
      selectableTiers.forEach(function (tier) {
        var tierChange = expectedAlakazamQuoteChange(
          account,
          tier.tierId
        );
        var item = accountElement(
          documentRef,
          "li",
          "customer-alakazam-tier"
        );
        var tierDetails = accountElement(
          documentRef,
          "span",
          "",
          accountMoney(tier.price) + " a month"
        );
        tierDetails.id =
          "customer-alakazam-tier-" + tier.tierId;
        var quoteButton = accountElement(
          documentRef,
          "button",
          "spark-button",
          command.phase === "quoting"
            && command.selectedTierId === tier.tierId
            ? "Requesting exact quote…"
            : tierChange
              && tierChange.changeKind === "upgrade"
              ? "Review upgrade quote"
              : tierChange
                && tierChange.changeKind === "downgrade"
                ? "Review downgrade schedule"
              : "Review exact quote"
        );
        quoteButton.type = "button";
        quoteButton.setAttribute(
          "data-alakazam-quote-tier",
          tier.tierId
        );
        quoteButton.setAttribute(
          "aria-describedby",
          tierDetails.id
        );
        quoteButton.disabled =
          (
            commandKind === "start"
              ? account.actions.start !== true
              : account.actions.changeTier !== true
          )
          || capabilities.alakazamQuote !== true
          || command.phase === "quoting"
          || command.phase === "checkout"
          || command.phase === "scheduling"
          || command.phase === "scheduled";
        quoteButton.addEventListener("click", function () {
          if (typeof actions.quote === "function") {
            actions.quote(tier.tierId);
          }
        });
        item.append(
          accountElement(
            documentRef,
            "strong",
            "",
            tier.name
          ),
          tierDetails,
          quoteButton
        );
        tierList.appendChild(item);
      });
      tiers.append(tierHeading, tierList);
      body.appendChild(tiers);
      renderAlakazamQuoteReview(
        documentRef,
        body,
        account,
        command,
        capabilities,
        actions
      );
    }

    var receipts = accountElement(
      documentRef,
      "section",
      "customer-alakazam-receipts"
    );
    var receiptsHeading = accountElement(
      documentRef,
      "h4",
      "",
      "Receipts"
    );
    receipts.appendChild(receiptsHeading);
    if (account.receipts.length === 0) {
      receipts.appendChild(
        accountElement(
          documentRef,
          "p",
          "",
          "No settled Alakazam receipts are listed."
        )
      );
    } else {
      var receiptList = accountElement(
        documentRef,
        "ol",
        "customer-alakazam-receipt-list"
      );
      account.receipts.forEach(function (receipt) {
        var item = accountElement(
          documentRef,
          "li",
          "customer-alakazam-receipt"
        );
        item.append(
          accountElement(
            documentRef,
            "strong",
            "",
            accountReceiptMoney(receipt)
          ),
          accountElement(
            documentRef,
            "span",
            "",
            accountWords(receipt.kind)
              + " · " + accountDate(receipt.settledAt)
              + " · "
              + (receipt.invoiceAvailable
                ? "Invoice recorded"
                : "No invoice recorded")
          )
        );
        receiptList.appendChild(item);
      });
      receipts.appendChild(receiptList);
    }
    body.appendChild(receipts);
    var actionNote = {
      site_setup_required:
        "Finish the accepted Maker setup above before reviewing a subscription quote.",
      site_payment_pending:
        "Payment is being confirmed. Site Sourcery will not start another charge from this status panel.",
      site_publishing:
        "Publication is automatic. This page will show the verified live address when it is ready.",
      site_attention_required:
        "The saved website needs attention. No manual publish, rollback, or unpublish action is available here."
    }[account.actions.reason];
    if (!actionNote) {
      actionNote = account.subscription
        ? account.actions.changeTier === true
          ? capabilities.alakazamQuote === true
            ? "Choose a different tier and review the exact terms. Upgrades use secure payment; downgrades charge and refund $0 now and take effect at renewal."
            : "Tier-change quotes are not open yet. Nothing can be charged or scheduled."
          : "Tier changes and billing management are not available in this panel yet."
        : capabilities.alakazamQuote === true
          ? "Choose a tier, review the exact quote, and accept it before secure payment."
          : "Subscription checkout is not open yet. Nothing can be charged.";
    }
    body.appendChild(
      accountElement(
        documentRef,
        "p",
        "customer-alakazam-actions-note",
        actionNote
      )
    );
  }

  function assessmentText(value, minimum, maximum) {
    return typeof value === "string"
      && value === value.trim()
      && value.length >= minimum
      && value.length <= maximum
      && !ASSESSMENT_CONTROL_CHARACTER.test(value);
  }

  function assessmentDate(value) {
    return typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      && !Number.isNaN(Date.parse(value + "T00:00:00.000Z"));
  }

  function assessmentCreditWindowIsNinetyDays(
    deliveredAt,
    acceptanceCutoff
  ) {
    var difference = Date.parse(acceptanceCutoff)
      - Date.parse(deliveredAt);
    var ninetyDays = 90 * 24 * 60 * 60 * 1000;
    var daylightSavingAllowance = 2 * 60 * 60 * 1000;
    return Number.isFinite(difference)
      && difference >= ninetyDays - daylightSavingAllowance
      && difference <= ninetyDays + daylightSavingAllowance;
  }

  function safeAssessmentTarget(value) {
    if (
      !exactKeys(value, ["kind", "value"])
      || !assessmentText(value.value, 1, 154)
    ) return false;
    if (value.kind === "page") {
      return ASSESSMENT_PAGE_PATH.test(value.value)
        && !/(^|\/)\.\.?($|\/)/u.test(value.value);
    }
    return value.kind === "page_type"
      && ASSESSMENT_PAGE_TYPE.test(value.value);
  }

  function assessmentTargetKey(value) {
    return safeAssessmentTarget(value)
      ? value.kind + ":" + value.value
      : "";
  }

  function sameAssessmentList(value, expected) {
    return Array.isArray(value)
      && JSON.stringify(value) === JSON.stringify(expected);
  }

  function safeAssessmentViewports(value) {
    return Array.isArray(value)
      && value.length >= 1
      && value.length <= 2
      && new Set(value).size === value.length
      && value.every(function (entry) {
        return ["desktop", "phone"].includes(entry);
      })
      && JSON.stringify(value) ===
        JSON.stringify(value.slice().sort());
  }

  function safeAssessmentCredit(value, expected) {
    var expectation = expected || {};
    if (
      !exactKeys(
        value,
        [
          "acceptanceCutoff",
          "amountMinor",
          "applicationScope",
          "creditDigest",
          "creditId",
          "currency",
          "deliveredAt",
          "eligibleTierIds",
          "maximumApplications",
          "nonCash",
          "state"
        ]
      )
      || !UUID.test(text(value.creditId))
      || value.amountMinor !== 20000
      || value.currency !== "USD"
      || value.applicationScope !== "custom_base_build"
      || !sameAssessmentList(
        value.eligibleTierIds,
        ASSESSMENT_ELIGIBLE_TIER_IDS
      )
      || value.maximumApplications !== 1
      || value.nonCash !== true
      || !safeIso(value.deliveredAt)
      || !safeIso(value.acceptanceCutoff)
      || !assessmentCreditWindowIsNinetyDays(
        value.deliveredAt,
        value.acceptanceCutoff
      )
      || ![
        "available",
        "expired",
        "reserved",
        "settled",
        "reconciliation_required"
      ].includes(value.state)
      || !SHA256.test(text(value.creditDigest))
    ) return false;
    return (!expectation.deliveredAt
        || value.deliveredAt === expectation.deliveredAt)
      && (!expectation.acceptanceCutoff
        || value.acceptanceCutoff === expectation.acceptanceCutoff);
  }

  function customBuildTier(tierId) {
    return CUSTOM_BUILD_TIERS.find(function (tier) {
      return tier.id === tierId;
    }) || null;
  }

  function customBuildScaleUnits(footprint) {
    if (!record(footprint)) return null;
    var values = [
      footprint.craftedPages,
      footprint.sections,
      footprint.uniqueLayouts,
      footprint.contentWords,
      footprint.suppliedMedia
    ];
    if (!values.every(Number.isSafeInteger)) return null;
    return Math.max(
      Math.max(footprint.craftedPages - 15, 0),
      Math.ceil(Math.max(footprint.sections - 60, 0) / 4),
      Math.max(footprint.uniqueLayouts - 15, 0),
      Math.ceil(Math.max(footprint.contentWords - 7000, 0) / 500),
      Math.ceil(Math.max(footprint.suppliedMedia - 60, 0) / 4)
    );
  }

  function customBuildPublicEstimate(tierId, footprint) {
    var tier = customBuildTier(tierId);
    if (
      !tier
      || !exactKeys(
        footprint,
        [
          "contentWords",
          "craftedPages",
          "sections",
          "suppliedMedia",
          "uniqueLayouts"
        ]
      )
    ) return null;
    var values = [
      footprint.craftedPages,
      footprint.sections,
      footprint.uniqueLayouts,
      footprint.contentWords,
      footprint.suppliedMedia
    ];
    var minima = [1, 1, 1, 0, 0];
    if (!values.every(function (value, index) {
      return Number.isSafeInteger(value)
        && value >= minima[index]
        && value <= tier.maxima[index];
    })) return null;
    var scaleUnits = tier.id === "scale"
      ? customBuildScaleUnits(footprint)
      : null;
    if (
      tier.id === "scale"
      && (!Number.isSafeInteger(scaleUnits)
        || scaleUnits < 1
        || scaleUnits > 15)
    ) return null;
    var serviceAmountMinor = tier.id === "scale"
      ? 400000 + scaleUnits * 27000
      : tier.amountMinor;
    var paymentSchedule = ["card", "card-plus"]
      .includes(tier.id)
      ? "full_before_work"
      : "half_before_work_half_before_handoff";
    var startValueMinor = paymentSchedule === "full_before_work"
      ? serviceAmountMinor
      : Math.floor(serviceAmountMinor / 2);
    return Object.freeze({
      serviceAmountMinor: serviceAmountMinor,
      creditAmountMinor: 20000,
      customerAmountMinor: serviceAmountMinor - 20000,
      paymentSchedule: paymentSchedule,
      scaleUnits: scaleUnits,
      startValueMinor: startValueMinor,
      startCreditMinor: 20000,
      startDueMinor: startValueMinor - 20000,
      finalDueMinor: serviceAmountMinor - startValueMinor
    });
  }

  function customBuildTermsRules(paymentSchedule) {
    var paymentRule = paymentSchedule === "full_before_work"
      ? "The remaining balance is due before build work begins."
      : "The remaining first installment is due before build work begins; the final installment is due before final launch or handoff.";
    return [
      "This quote covers only the scope and footprint shown here. Added or changed work requires a separate written change order.",
      "The assessment credit is non-cash, same-project, one-use value applied only to this Custom base build's first required installment.",
      paymentRule,
      "Tax and any separately stated third-party provider charges are not included in the base price and are shown before payment.",
      "Build work does not begin until the required first payment is verified.",
      "The 30-day workmanship correction covers reproducible defects in the accepted deliverables, not new content, features, changed decisions, third-party changes, or ongoing management."
    ];
  }

  function safeCustomBuildCredit(value) {
    return exactKeys(
      value,
      [
        "acceptanceCutoff",
        "amountMinor",
        "creditId",
        "currency",
        "state"
      ]
    )
      && UUID.test(text(value.creditId))
      && value.amountMinor === 20000
      && value.currency === "USD"
      && [
        "available",
        "reserved",
        "released",
        "settled",
        "expired",
        "reconciliation_required"
      ].includes(value.state)
      && safeIso(value.acceptanceCutoff);
  }

  function safeCustomBuildInstallments(value, estimate) {
    var expected = [{
      number: 1,
      kind: "start",
      grossValueMinor: estimate.startValueMinor,
      creditAmountMinor: estimate.startCreditMinor,
      amountDueMinor: estimate.startDueMinor,
      dueTrigger: "before_work"
    }];
    if (estimate.finalDueMinor > 0) {
      expected.push({
        number: 2,
        kind: "final",
        grossValueMinor: estimate.finalDueMinor,
        creditAmountMinor: 0,
        amountDueMinor: estimate.finalDueMinor,
        dueTrigger: "before_handoff"
      });
    }
    return Array.isArray(value)
      && value.length === expected.length
      && value.every(function (entry, index) {
        var exact = expected[index];
        return exactKeys(
          entry,
          [
            "amountDueMinor",
            "creditAmountMinor",
            "dueTrigger",
            "grossValueMinor",
            "kind",
            "number"
          ]
        )
          && entry.number === exact.number
          && entry.kind === exact.kind
          && entry.grossValueMinor === exact.grossValueMinor
          && entry.creditAmountMinor === exact.creditAmountMinor
          && entry.amountDueMinor === exact.amountDueMinor
          && entry.dueTrigger === exact.dueTrigger;
      });
  }

  function safeCustomBuildTerms(value, paymentSchedule) {
    return exactKeys(
      value,
      [
        "commercialContractDigest",
        "commercialContractId",
        "legalDocumentId",
        "rules",
        "schema"
      ]
    )
      && value.schema === "sitesourcery.custom-build-quote-terms/v1"
      && value.commercialContractId ===
        CUSTOM_BUILD_COMMERCIAL_CONTRACT_ID
      && value.commercialContractDigest ===
        CUSTOM_BUILD_COMMERCIAL_CONTRACT_DIGEST
      && value.legalDocumentId === CUSTOM_BUILD_LEGAL_DOCUMENT_ID
      && sameAssessmentList(
        value.rules,
        customBuildTermsRules(paymentSchedule)
      );
  }

  function safeCustomBuildAcceptance(value, quote) {
    return exactKeys(
      value,
      [
        "acceptedAt",
        "acceptedDisclosureDigest",
        "acceptedQuoteDigest",
        "commercialContractDigest",
        "commercialContractId",
        "legalDocumentId",
        "schema"
      ]
    )
      && value.schema ===
        "sitesourcery.custom-build-quote-acceptance-receipt/v1"
      && safeIso(value.acceptedAt)
      && value.acceptedQuoteDigest === quote.quoteDigest
      && value.acceptedDisclosureDigest === quote.disclosureDigest
      && value.commercialContractId ===
        quote.terms.commercialContractId
      && value.commercialContractDigest ===
        quote.terms.commercialContractDigest
      && value.legalDocumentId === quote.terms.legalDocumentId;
  }

  function safeCustomBuildQuote(value) {
    if (
      !exactKeys(
        value,
        [
          "acceptance",
          "creditAcceptanceCutoff",
          "disclosureDigest",
          "expiresAt",
          "issuedAt",
          "pricing",
          "quoteDigest",
          "quoteId",
          "quoteRevision",
          "scopeStatement",
          "state",
          "targetCompletionDate",
          "terms",
          "tier",
          "workmanshipCorrectionDays"
        ]
      )
      || !UUID.test(text(value.quoteId))
      || !Number.isSafeInteger(value.quoteRevision)
      || value.quoteRevision < 1
      || !SHA256.test(text(value.quoteDigest))
      || !SHA256.test(text(value.disclosureDigest))
      || !["issued", "accepted", "voided"].includes(value.state)
      || !assessmentText(value.scopeStatement, 20, 2000)
      || value.workmanshipCorrectionDays !== 30
      || !assessmentDate(value.targetCompletionDate)
      || !safeIso(value.issuedAt)
      || !safeIso(value.expiresAt)
      || !safeIso(value.creditAcceptanceCutoff)
      || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
      || Date.parse(value.expiresAt) >
        Date.parse(value.creditAcceptanceCutoff)
      || Date.parse(value.expiresAt) >
        Date.parse(value.issuedAt) + 30 * 24 * 60 * 60 * 1000
      || Date.parse(value.targetCompletionDate + "T00:00:00.000Z") <=
        Date.parse(value.issuedAt.slice(0, 10) + "T00:00:00.000Z")
      || Date.parse(value.targetCompletionDate + "T00:00:00.000Z") >
        Date.parse(value.issuedAt.slice(0, 10) + "T00:00:00.000Z")
          + 730 * 24 * 60 * 60 * 1000
      || !exactKeys(
        value.tier,
        ["footprint", "id", "label", "scaleUnits"]
      )
      || !exactKeys(
        value.tier.footprint,
        [
          "contentWords",
          "craftedPages",
          "sections",
          "suppliedMedia",
          "uniqueLayouts"
        ]
      )
    ) return false;
    var tier = customBuildTier(value.tier.id);
    var estimate = customBuildPublicEstimate(
      value.tier.id,
      value.tier.footprint
    );
    if (
      !tier
      || !estimate
      || value.tier.label !== tier.label
      || value.tier.scaleUnits !== estimate.scaleUnits
      || !exactKeys(
        value.pricing,
        [
          "creditAmountMinor",
          "currency",
          "customerAmountMinor",
          "finalDueMinor",
          "installments",
          "paymentSchedule",
          "serviceAmountMinor",
          "startCreditMinor",
          "startDueMinor",
          "startValueMinor",
          "taxState"
        ]
      )
      || value.pricing.serviceAmountMinor !==
        estimate.serviceAmountMinor
      || value.pricing.creditAmountMinor !==
        estimate.creditAmountMinor
      || value.pricing.customerAmountMinor !==
        estimate.customerAmountMinor
      || value.pricing.currency !== "USD"
      || value.pricing.taxState !== "calculation_required"
      || value.pricing.paymentSchedule !==
        estimate.paymentSchedule
      || value.pricing.startValueMinor !==
        estimate.startValueMinor
      || value.pricing.startCreditMinor !==
        estimate.startCreditMinor
      || value.pricing.startDueMinor !==
        estimate.startDueMinor
      || value.pricing.finalDueMinor !==
        estimate.finalDueMinor
      || !safeCustomBuildInstallments(
        value.pricing.installments,
        estimate
      )
      || !safeCustomBuildTerms(
        value.terms,
        value.pricing.paymentSchedule
      )
    ) return false;
    if (value.state === "issued" && value.acceptance !== null) {
      return false;
    }
    if (
      value.state === "accepted"
      && !safeCustomBuildAcceptance(value.acceptance, value)
    ) return false;
    if (
      value.state === "voided"
      && value.acceptance !== null
      && !safeCustomBuildAcceptance(value.acceptance, value)
    ) return false;
    return true;
  }

  function verifiedCustomerCustomBuildQuote(
    value,
    expectedProjectId
  ) {
    if (
      !exactKeys(
        value,
        [
          "credit",
          "customerId",
          "projectId",
          "quote",
          "schema",
          "state"
        ]
      )
      || value.schema !==
        "sitesourcery.custom-services-custom-build-quote/v1"
      || ![
        "not_available",
        "issued",
        "accepted",
        "voided"
      ].includes(value.state)
      || !UUID.test(text(value.projectId))
      || (expectedProjectId && value.projectId !== expectedProjectId)
      || !UUID.test(text(value.customerId))
      || (value.credit !== null
        && !safeCustomBuildCredit(value.credit))
    ) return null;
    if (value.state === "not_available") {
      return value.quote === null ? value : null;
    }
    if (
      !safeCustomBuildQuote(value.quote)
      || value.quote.state !== value.state
      || !safeCustomBuildCredit(value.credit)
      || value.quote.creditAcceptanceCutoff !==
        value.credit.acceptanceCutoff
      || value.quote.pricing.creditAmountMinor !==
        value.credit.amountMinor
    ) return null;
    if (
      value.state === "issued"
      && !["available", "expired"].includes(value.credit.state)
    ) return null;
    if (
      value.state === "accepted"
      && ![
        "reserved",
        "reconciliation_required",
        "settled"
      ].includes(value.credit.state)
    ) return null;
    if (
      value.state === "voided"
      && !["available", "released", "expired"]
        .includes(value.credit.state)
    ) return null;
    return value;
  }

  function customBuildInvoiceExpectation(snapshot) {
    var selected = verifiedCustomerCustomBuildQuote(
      snapshot,
      snapshot && snapshot.projectId
    );
    if (
      !selected
      || selected.state !== "accepted"
      || !selected.quote.acceptance
    ) return null;
    return Object.freeze({
      acceptedDisclosureDigest:
        selected.quote.disclosureDigest,
      acceptedQuoteDigest: selected.quote.quoteDigest,
      creditMinor: selected.quote.pricing.startCreditMinor,
      finalHandoffMinor: selected.quote.pricing.finalDueMinor,
      grossStartMinor: selected.quote.pricing.startValueMinor,
      issuedAt: selected.quote.acceptance.acceptedAt,
      quoteId: selected.quote.quoteId,
      subtotalMinor: selected.quote.pricing.startDueMinor,
      tierId: selected.quote.tier.id
    });
  }

  function safeCustomBuildInvoiceExpectation(value) {
    return exactKeys(
      value,
      [
        "acceptedDisclosureDigest",
        "acceptedQuoteDigest",
        "creditMinor",
        "finalHandoffMinor",
        "grossStartMinor",
        "issuedAt",
        "quoteId",
        "subtotalMinor",
        "tierId"
      ]
    )
      && SHA256.test(text(value.acceptedDisclosureDigest))
      && SHA256.test(text(value.acceptedQuoteDigest))
      && value.creditMinor === 20000
      && safeMinor(value.finalHandoffMinor)
      && safeMinor(value.grossStartMinor)
      && value.grossStartMinor > value.creditMinor
      && safeIso(value.issuedAt)
      && UUID.test(text(value.quoteId))
      && safeMinor(value.subtotalMinor)
      && value.subtotalMinor ===
        value.grossStartMinor - value.creditMinor
      && Boolean(customBuildTier(value.tierId));
  }

  function safeCustomBuildPendingMoney(value, currency) {
    return exactKeys(value, ["amountMinor", "currency", "state"])
      && value.amountMinor === null
      && value.currency === currency
      && value.state === "shown_at_checkout";
  }

  function safeCustomBuildJob(value) {
    if (
      !exactKeys(
        value,
        [
          "finalHandoff",
          "firstPayment",
          "footprint",
          "jobId",
          "openedAt",
          "scopeStatement",
          "state",
          "targetCompletionDate",
          "tierId"
        ]
      )
      || !UUID.test(text(value.jobId))
      || value.state !== "open"
      || !safeIso(value.openedAt)
      || !assessmentText(value.scopeStatement, 20, 2000)
      || !assessmentDate(value.targetCompletionDate)
      || !exactKeys(
        value.footprint,
        [
          "contentWords",
          "craftedPages",
          "sections",
          "suppliedMedia",
          "uniqueLayouts"
        ]
      )
      || !exactKeys(
        value.firstPayment,
        ["creditMinor", "currency", "grossMinor", "paidSubtotalMinor"]
      )
      || !exactKeys(
        value.finalHandoff,
        ["amountMinor", "currency", "state"]
      )
    ) return false;
    var estimate = customBuildPublicEstimate(
      value.tierId,
      value.footprint
    );
    return Boolean(estimate)
      && value.firstPayment.grossMinor === estimate.startValueMinor
      && value.firstPayment.creditMinor === estimate.startCreditMinor
      && value.firstPayment.paidSubtotalMinor === estimate.startDueMinor
      && value.firstPayment.currency === "USD"
      && value.finalHandoff.amountMinor === estimate.finalDueMinor
      && value.finalHandoff.currency === "USD"
      && value.finalHandoff.state ===
        (estimate.finalDueMinor === 0 ? "not_required" : "unpaid");
  }

  function verifiedCustomerCustomBuildInvoice(value, expectation) {
    var states = [
      "not_available",
      "checkout_available",
      "checkout_ready",
      "payment_held",
      "payment_window_expired",
      "reconciliation_required",
      "paid"
    ];
    if (
      !exactKeys(value, ["action", "invoice", "job", "schema", "state"])
      || value.schema !== "sitesourcery.custom-build-start-invoice/v1"
      || !states.includes(value.state)
      || !exactKeys(value.action, ["available", "reason"])
    ) return null;
    if (value.state === "not_available") {
      return value.invoice === null
        && value.job === null
        && value.action.available === false
        && value.action.reason === "invoice_not_available"
        ? value
        : null;
    }
    if (!safeCustomBuildInvoiceExpectation(expectation)) return null;
    var invoice = value.invoice;
    if (
      !exactKeys(
        invoice,
        [
          "acceptedDisclosureDigest",
          "acceptedQuoteDigest",
          "credit",
          "finalHandoff",
          "invoiceDigest",
          "invoiceId",
          "invoiceNumber",
          "issuedAt",
          "lines",
          "payment",
          "paymentDeadline",
          "quoteId",
          "subtotal",
          "tax",
          "tierId",
          "total"
        ]
      )
      || !UUID.test(text(invoice.invoiceId))
      || !/^SSCB-[0-9A-F]{32}$/u.test(text(invoice.invoiceNumber))
      || !SHA256.test(text(invoice.invoiceDigest))
      || invoice.quoteId !== expectation.quoteId
      || invoice.tierId !== expectation.tierId
      || invoice.acceptedQuoteDigest !==
        expectation.acceptedQuoteDigest
      || invoice.acceptedDisclosureDigest !==
        expectation.acceptedDisclosureDigest
      || invoice.issuedAt !== expectation.issuedAt
      || !safeIso(invoice.paymentDeadline)
      || Date.parse(invoice.paymentDeadline) !==
        Date.parse(invoice.issuedAt) + 7 * 24 * 60 * 60 * 1000
      || !Array.isArray(invoice.lines)
      || invoice.lines.length !== 2
    ) return null;
    var gross = invoice.lines[0];
    var creditLine = invoice.lines[1];
    if (
      !exactKeys(
        gross,
        [
          "amountMinor",
          "componentKey",
          "currency",
          "displayName",
          "lineNumber"
        ]
      )
      || gross.lineNumber !== 1
      || gross.componentKey !== "custom_build_start"
      || !assessmentText(gross.displayName, 3, 120)
      || gross.amountMinor !== expectation.grossStartMinor
      || gross.currency !== "USD"
      || !exactKeys(
        creditLine,
        [
          "amountMinor",
          "componentKey",
          "currency",
          "displayName",
          "lineNumber"
        ]
      )
      || creditLine.lineNumber !== 2
      || creditLine.componentKey !== "assessment_build_credit"
      || creditLine.displayName !== "Website assessment build credit"
      || creditLine.amountMinor !== -expectation.creditMinor
      || creditLine.currency !== "USD"
      || !exactKeys(invoice.subtotal, ["amountMinor", "currency"])
      || invoice.subtotal.amountMinor !== expectation.subtotalMinor
      || invoice.subtotal.currency !== "USD"
      || invoice.subtotal.amountMinor !==
        gross.amountMinor + creditLine.amountMinor
      || !exactKeys(invoice.tax, ["amountMinor", "state"])
      || invoice.tax.amountMinor !== null
      || invoice.tax.state !== "calculated_at_checkout"
      || !safeCustomBuildPendingMoney(invoice.total, "USD")
      || !exactKeys(invoice.credit, ["amountMinor", "state"])
      || invoice.credit.amountMinor !== expectation.creditMinor
      || !exactKeys(invoice.finalHandoff, ["amountMinor", "state"])
      || invoice.finalHandoff.amountMinor !==
        expectation.finalHandoffMinor
      || invoice.finalHandoff.state !==
        (expectation.finalHandoffMinor === 0
          ? "not_required"
          : "due_before_handoff")
      || !exactKeys(
        invoice.payment,
        ["chargeOccurred", "checkoutExpiresAt", "checkoutUrl"]
      )
    ) return null;
    var paid = value.state === "paid";
    var ready = value.state === "checkout_ready";
    var expectedCreditStates = paid
      ? ["settled"]
      : value.state === "reconciliation_required"
        ? ["reserved", "reconciliation_required"]
        : ["reserved"];
    if (
      !expectedCreditStates.includes(invoice.credit.state)
      || invoice.payment.chargeOccurred !== paid
      || value.action.available !==
        (value.state === "checkout_available")
      || value.action.reason !==
        (value.state === "checkout_available" ? null : value.state)
    ) return null;
    if (ready) {
      if (
        safeCheckoutDestination({
          checkoutUrl: invoice.payment.checkoutUrl
        }) !== invoice.payment.checkoutUrl
        || !safeIso(invoice.payment.checkoutExpiresAt)
      ) return null;
    } else if (
      invoice.payment.checkoutUrl !== null
      || invoice.payment.checkoutExpiresAt !== null
    ) return null;
    if (!paid) return value.job === null ? value : null;
    if (
      !safeCustomBuildJob(value.job)
      || value.job.tierId !== expectation.tierId
      || value.job.firstPayment.grossMinor !==
        expectation.grossStartMinor
      || value.job.firstPayment.creditMinor !== expectation.creditMinor
      || value.job.firstPayment.paidSubtotalMinor !==
        expectation.subtotalMinor
      || value.job.finalHandoff.amountMinor !==
        expectation.finalHandoffMinor
      || Date.parse(value.job.openedAt) < Date.parse(invoice.issuedAt)
    ) return null;
    return value;
  }

  function verifiedCustomerCustomBuildCheckout(
    value,
    invoice,
    nowInput
  ) {
    var now = safeIso(nowInput) ? Date.parse(nowInput) : Date.now();
    if (
      !exactKeys(value, ["checkout", "schema", "state"])
      || value.schema !== "sitesourcery.custom-build-start-checkout/v1"
      || value.state !== "ready"
      || !record(invoice)
      || !exactKeys(
        value.checkout,
        [
          "chargeOccurred",
          "expiresAt",
          "invoiceId",
          "invoiceNumber",
          "subtotal",
          "tax",
          "total",
          "url"
        ]
      )
    ) return null;
    var checkout = value.checkout;
    if (
      checkout.invoiceId !== invoice.invoiceId
      || checkout.invoiceNumber !== invoice.invoiceNumber
      || safeCheckoutDestination({ checkoutUrl: checkout.url }) !==
        checkout.url
      || !safeIso(checkout.expiresAt)
      || Date.parse(checkout.expiresAt) <= now
      || !exactKeys(checkout.subtotal, ["amountMinor", "currency"])
      || checkout.subtotal.amountMinor !== invoice.subtotal.amountMinor
      || checkout.subtotal.currency !== "USD"
      || !exactKeys(checkout.tax, ["amountMinor", "state"])
      || checkout.tax.amountMinor !== null
      || checkout.tax.state !== "calculated_at_checkout"
      || !safeCustomBuildPendingMoney(checkout.total, "USD")
      || checkout.chargeOccurred !== false
    ) return null;
    return value;
  }

  function verifiedOwnerCustomBuildOpportunities(value) {
    if (
      !exactKeys(value, ["opportunities", "schema"])
      || value.schema !==
        "sitesourcery.custom-services-owner-custom-build-opportunities/v1"
      || !Array.isArray(value.opportunities)
      || value.opportunities.length > 100
    ) return null;
    var jobIds = new Set();
    var valid = value.opportunities.every(function (entry) {
      if (
        !exactKeys(
          entry,
          [
            "assessment",
            "caseId",
            "credit",
            "currentQuote",
            "customer",
            "organizationId",
            "organizationName",
            "projectId",
            "projectName"
          ]
        )
        || !UUID.test(text(entry.organizationId))
        || !assessmentText(entry.organizationName, 1, 200)
        || !UUID.test(text(entry.projectId))
        || !assessmentText(entry.projectName, 1, 200)
        || !UUID.test(text(entry.caseId))
        || !exactKeys(
          entry.assessment,
          ["deliveredAt", "jobId", "reportId"]
        )
        || !UUID.test(text(entry.assessment.jobId))
        || jobIds.has(entry.assessment.jobId)
        || !UUID.test(text(entry.assessment.reportId))
        || !safeIso(entry.assessment.deliveredAt)
        || !exactKeys(
          entry.customer,
          ["customerId", "email", "name"]
        )
        || !UUID.test(text(entry.customer.customerId))
        || !assessmentText(entry.customer.name, 1, 200)
        || !assessmentText(entry.customer.email, 3, 320)
        || !safeCustomBuildCredit(entry.credit)
        || (entry.currentQuote !== null
          && !safeCustomBuildQuote(entry.currentQuote))
        || (entry.currentQuote
          && entry.currentQuote.creditAcceptanceCutoff !==
            entry.credit.acceptanceCutoff)
        || (entry.currentQuote
          && entry.currentQuote.state === "accepted"
          && entry.credit.state !== "reserved")
        || (entry.currentQuote
          && entry.currentQuote.state === "issued"
          && !["available", "expired"].includes(entry.credit.state))
        || (entry.currentQuote
          && entry.currentQuote.state === "voided"
          && !["available", "released", "expired"]
            .includes(entry.credit.state))
      ) return false;
      jobIds.add(entry.assessment.jobId);
      return true;
    });
    return valid ? value : null;
  }

  function verifiedOwnerCustomBuildJobs(value) {
    if (
      !exactKeys(value, ["hasMore", "jobs", "nextCursor", "schema"])
      || value.schema !==
        "sitesourcery.custom-services-owner-custom-build-jobs/v1"
      || typeof value.hasMore !== "boolean"
      || !Array.isArray(value.jobs)
      || value.jobs.length > 100
    ) return null;
    var jobIds = new Set();
    var valid = value.jobs.every(function (entry) {
      if (
        !exactKeys(
          entry,
          [
            "caseId",
            "customer",
            "job",
            "organizationId",
            "organizationName",
            "projectId",
            "projectName"
          ]
        )
        || !UUID.test(text(entry.organizationId))
        || !assessmentText(entry.organizationName, 1, 200)
        || !UUID.test(text(entry.projectId))
        || !assessmentText(entry.projectName, 1, 200)
        || !UUID.test(text(entry.caseId))
        || !exactKeys(
          entry.customer,
          ["customerId", "email", "name"]
        )
        || !UUID.test(text(entry.customer.customerId))
        || !assessmentText(entry.customer.name, 1, 200)
        || !assessmentText(entry.customer.email, 3, 320)
        || !safeCustomBuildJob(entry.job)
        || jobIds.has(entry.job.jobId)
      ) return false;
      jobIds.add(entry.job.jobId);
      return true;
    });
    if (!valid) return null;
    if (!value.hasMore) {
      return value.nextCursor === null ? value : null;
    }
    if (value.jobs.length !== 100 || typeof value.nextCursor !== "string") {
      return null;
    }
    var cursorParts = value.nextCursor.split("|");
    var lastJob = value.jobs[value.jobs.length - 1].job;
    return cursorParts.length === 3
      && assessmentDate(cursorParts[0])
      && safeIso(cursorParts[1])
      && UUID.test(cursorParts[2])
      && value.nextCursor === [
        lastJob.targetCompletionDate,
        lastJob.openedAt,
        lastJob.jobId
      ].join("|")
      ? value
      : null;
  }

  function customBuildProgressText(value, minimum, maximum) {
    return assessmentText(value, minimum, maximum)
      && !CUSTOM_BUILD_PROGRESS_CREDENTIAL.test(value);
  }

  function safeCustomBuildProgressRequest(value) {
    if (value === null) return true;
    if (
      !exactKeys(
        value,
        [
          "access",
          "createdAt",
          "kind",
          "message",
          "requestId",
          "response",
          "responseRequired",
          "revision",
          "safeInstructions",
          "state",
          "targetDateImpact",
          "title",
          "updatedAt"
        ]
      )
      || !UUID.test(text(value.requestId))
      || !Number.isSafeInteger(value.revision)
      || value.revision < 1
      || ![
        "customer_content",
        "customer_decision",
        "delegated_access",
        "outside_dependency"
      ].includes(value.kind)
      || !customBuildProgressText(value.title, 5, 120)
      || !customBuildProgressText(value.message, 10, 1000)
      || !customBuildProgressText(value.safeInstructions, 10, 1000)
      || !["none", "under_review"].includes(value.targetDateImpact)
      || typeof value.responseRequired !== "boolean"
      || value.responseRequired !== (value.kind !== "outside_dependency")
      || !["open", "answered"].includes(value.state)
      || !safeIso(value.createdAt)
      || !safeIso(value.updatedAt)
      || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
      || (value.kind === "outside_dependency"
        && value.targetDateImpact !== "under_review")
    ) return false;
    if (value.state === "open") {
      if (value.response !== null) return false;
    } else if (
      !exactKeys(value.response, ["answeredAt", "kind", "note"])
      || !["provided", "cannot_provide"].includes(value.response.kind)
      || !customBuildProgressText(value.response.note, 1, 1000)
      || !safeIso(value.response.answeredAt)
    ) return false;
    if (value.kind !== "delegated_access") {
      return value.access === null;
    }
    return exactKeys(
      value.access,
      ["accountLabel", "delegatedRole", "expiresAt", "providerLabel"]
    )
      && customBuildProgressText(value.access.providerLabel, 1, 254)
      && customBuildProgressText(value.access.accountLabel, 1, 254)
      && customBuildProgressText(value.access.delegatedRole, 1, 254)
      && safeIso(value.access.expiresAt);
  }

  function verifiedCustomBuildProgress(value, expectedJobId) {
    if (
      !exactKeys(
        value,
        [
          "activeRequest",
          "jobId",
          "progress",
          "schema",
          "state",
          "status",
          "targetCompletionDate",
          "targetDateUnderReview"
        ]
      )
      || value.schema !== CUSTOM_BUILD_PROGRESS_SCHEMA
    ) return null;
    if (value.state === "not_available") {
      return value.jobId === null
        && value.targetCompletionDate === null
        && value.targetDateUnderReview === false
        && value.status === null
        && value.progress === null
        && value.activeRequest === null
        ? value
        : null;
    }
    if (
      value.state !== "active"
      || !UUID.test(text(value.jobId))
      || (expectedJobId && value.jobId !== expectedJobId)
      || !assessmentDate(value.targetCompletionDate)
      || typeof value.targetDateUnderReview !== "boolean"
      || !exactKeys(
        value.progress,
        [
          "milestones",
          "nextStep",
          "revision",
          "stage",
          "stageLabel",
          "summary",
          "updatedAt"
        ]
      )
      || !Number.isSafeInteger(value.progress.revision)
      || value.progress.revision < 0
      || !Object.prototype.hasOwnProperty.call(
        CUSTOM_BUILD_PROGRESS_STAGES,
        value.progress.stage
      )
      || value.progress.stageLabel !==
        CUSTOM_BUILD_PROGRESS_STAGES[value.progress.stage]
      || !customBuildProgressText(value.progress.summary, 10, 500)
      || !customBuildProgressText(value.progress.nextStep, 5, 500)
      || !safeIso(value.progress.updatedAt)
      || !Array.isArray(value.progress.milestones)
      || value.progress.milestones.length !==
        CUSTOM_BUILD_PROGRESS_MILESTONES.length
      || !value.progress.milestones.every(function (milestone, index) {
        var expected = CUSTOM_BUILD_PROGRESS_MILESTONES[index];
        return exactKeys(milestone, ["key", "label", "state"])
          && milestone.key === expected[0]
          && milestone.label === expected[1]
          && ["pending", "in_progress", "done"]
            .includes(milestone.state);
      })
      || !safeCustomBuildProgressRequest(value.activeRequest)
      || !exactKeys(value.status, ["kind", "label"])
    ) return null;
    var expectedStatus = {
      kind: value.progress.stage,
      label: value.progress.stageLabel
    };
    if (value.activeRequest) {
      if (value.activeRequest.kind === "outside_dependency") {
        expectedStatus = {
          kind: "waiting_on_dependency",
          label: "Waiting on an outside dependency"
        };
      } else if (value.activeRequest.state === "answered") {
        expectedStatus = {
          kind: "reviewing_response",
          label: "Site Sourcery is reviewing your response"
        };
      } else {
        expectedStatus = {
          kind: "action_needed",
          label: "Action needed from you"
        };
      }
    }
    return value.status.kind === expectedStatus.kind
      && value.status.label === expectedStatus.label
      && value.targetDateUnderReview === Boolean(
        value.activeRequest
        && value.activeRequest.targetDateImpact === "under_review"
      )
      ? value
      : null;
  }

  function safeCustomBuildChangeOrder(value, owner) {
    var expectedKeys = [
      "acceptedAt",
      "addedScope",
      "changeNumber",
      "changeOrderId",
      "declinedAt",
      "disclosureDigest",
      "expiredAt",
      "expiresAt",
      "issuedAt",
      "pricing",
      "quoteDigest",
      "state",
      "targetCompletionDate",
      "void"
    ];
    if (owner) expectedKeys.push("createdByOperatorUserId");
    if (
      !exactKeys(value, expectedKeys)
      || !UUID.test(text(value.changeOrderId))
      || !Number.isSafeInteger(value.changeNumber)
      || value.changeNumber < 1
      || ![
        "issued",
        "accepted_payment_required",
        "effective",
        "declined",
        "expired",
        "voided"
      ].includes(value.state)
      || !customBuildProgressText(value.addedScope, 20, 2000)
      || !exactKeys(
        value.pricing,
        [
          "currency",
          "paymentRequirement",
          "subtotalMinor",
          "taxState",
          "unitAmountMinor",
          "unitCount"
        ]
      )
      || !Number.isSafeInteger(value.pricing.unitCount)
      || value.pricing.unitCount < 1
      || value.pricing.unitCount > 40
      || value.pricing.unitAmountMinor !== CUSTOM_BUILD_CHANGE_UNIT_MINOR
      || value.pricing.subtotalMinor !==
        value.pricing.unitCount * CUSTOM_BUILD_CHANGE_UNIT_MINOR
      || value.pricing.currency !== "USD"
      || value.pricing.taxState !== "automatic_tax_pending"
      || value.pricing.paymentRequirement !==
        "due_before_changed_work"
      || !assessmentDate(value.targetCompletionDate)
      || !SHA256.test(text(value.quoteDigest))
      || !SHA256.test(text(value.disclosureDigest))
      || !safeIso(value.issuedAt)
      || !safeIso(value.expiresAt)
      || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
      || !nullableIso(value.acceptedAt)
      || !nullableIso(value.declinedAt)
      || !nullableIso(value.expiredAt)
      || (owner && !UUID.test(text(value.createdByOperatorUserId)))
    ) return false;
    if (
      value.void !== null
      && (
        !exactKeys(value.void, ["reason", "voidedAt"])
        || !customBuildProgressText(value.void.reason, 20, 500)
        || !safeIso(value.void.voidedAt)
      )
    ) return false;
    if (value.state === "issued") {
      return value.acceptedAt === null
        && value.declinedAt === null
        && value.void === null
        && value.expiredAt === null;
    }
    if (
      value.state === "accepted_payment_required"
      || value.state === "effective"
    ) {
      return safeIso(value.acceptedAt)
        && value.declinedAt === null
        && value.void === null
        && value.expiredAt === null;
    }
    if (value.state === "declined") {
      return value.acceptedAt === null
        && safeIso(value.declinedAt)
        && value.void === null
        && value.expiredAt === null;
    }
    if (value.state === "expired") {
      return value.acceptedAt === null
        && value.declinedAt === null
        && value.void === null
        && safeIso(value.expiredAt)
        && Date.parse(value.expiredAt) >= Date.parse(value.expiresAt);
    }
    return value.expiredAt === null
      && value.declinedAt === null
      && value.void !== null;
  }

  function safeCustomBuildCompletionEvidence(value, owner) {
    var expectedKeys = [
      "accessibleDescription",
      "byteCount",
      "capturedAt",
      "contentDigest",
      "evidenceId",
      "imageHeight",
      "imageWidth",
      "mediaType",
      "viewport"
    ];
    if (owner) {
      expectedKeys.push(
        "createdByOperatorUserId",
        "effectiveScopeDigest",
        "progressRevision"
      );
    }
    return exactKeys(value, expectedKeys)
      && UUID.test(text(value.evidenceId))
      && ["desktop", "phone"].includes(value.viewport)
      && customBuildProgressText(
        value.accessibleDescription,
        10,
        500
      )
      && ["image/jpeg", "image/png", "image/webp"]
        .includes(value.mediaType)
      && Number.isSafeInteger(value.byteCount)
      && value.byteCount >= 1
      && value.byteCount <= ASSESSMENT_MAXIMUM_EVIDENCE_BYTES
      && SHA256.test(text(value.contentDigest))
      && Number.isSafeInteger(value.imageWidth)
      && value.imageWidth >= 240
      && value.imageWidth <= 2048
      && Number.isSafeInteger(value.imageHeight)
      && value.imageHeight >= 1
      && value.imageHeight <= 5000
      && (
        (value.viewport === "desktop" && value.imageWidth >= 768)
        || (value.viewport === "phone" && value.imageWidth <= 767)
      )
      && value.imageWidth * value.imageHeight <= 2048 * 5000
      && safeIso(value.capturedAt)
      && (
        !owner
        || (
          UUID.test(text(value.createdByOperatorUserId))
          && Number.isSafeInteger(value.progressRevision)
          && value.progressRevision >= 1
          && SHA256.test(text(value.effectiveScopeDigest))
        )
      );
  }

  function safeCustomBuildCompletion(value, owner, evidence) {
    if (value === null) return true;
    var expectedKeys = [
      "checks",
      "customerSummary",
      "preparedAt",
      "state"
    ];
    if (owner) {
      expectedKeys.push(
        "baseScopeDigest",
        "completionId",
        "createdByOperatorUserId",
        "effectiveChangeOrderDigests",
        "effectiveScopeDigest",
        "evidenceIds",
        "packageDigest",
        "progressRevision"
      );
    } else {
      expectedKeys.push("evidence");
    }
    if (
      !exactKeys(value, expectedKeys)
      || ![
        "ready_for_final_payment",
        "ready_for_delivery"
      ].includes(value.state)
      || !customBuildProgressText(value.customerSummary, 20, 1000)
      || !exactKeys(
        value.checks,
        CUSTOM_BUILD_COMPLETION_CHECKS.map(function (entry) {
          return entry[0];
        })
      )
      || !CUSTOM_BUILD_COMPLETION_CHECKS.every(function (entry) {
        return value.checks[entry[0]] === true;
      })
      || !safeIso(value.preparedAt)
    ) return false;
    if (!owner) {
      return Array.isArray(value.evidence)
        && value.evidence.length >= 2
        && value.evidence.length <= 12
        && value.evidence.every(function (entry) {
          return safeCustomBuildCompletionEvidence(entry, false);
        })
        && new Set(value.evidence.map(function (entry) {
          return entry.evidenceId;
        })).size === value.evidence.length
        && JSON.stringify(value.evidence.map(function (entry) {
          return entry.evidenceId;
        })) === JSON.stringify(value.evidence.map(function (entry) {
          return entry.evidenceId;
        }).slice().sort())
        && ["desktop", "phone"].every(function (viewport) {
          return value.evidence.some(function (entry) {
            return entry.viewport === viewport;
          });
        })
        && !value.evidence.some(function (desktop) {
          return desktop.viewport === "desktop"
            && value.evidence.some(function (phone) {
              return phone.viewport === "phone"
                && phone.contentDigest === desktop.contentDigest;
            });
        });
    }
    if (
      !UUID.test(text(value.completionId))
      || !Number.isSafeInteger(value.progressRevision)
      || value.progressRevision < 1
      || !Array.isArray(value.evidenceIds)
      || value.evidenceIds.length < 2
      || value.evidenceIds.length > 12
      || !value.evidenceIds.every(function (id) {
        return UUID.test(text(id));
      })
      || JSON.stringify(value.evidenceIds) !==
        JSON.stringify(value.evidenceIds.slice().sort())
      || new Set(value.evidenceIds).size !== value.evidenceIds.length
      || !SHA256.test(text(value.baseScopeDigest))
      || !Array.isArray(value.effectiveChangeOrderDigests)
      || !value.effectiveChangeOrderDigests.every(function (digest) {
        return SHA256.test(text(digest));
      })
      || !SHA256.test(text(value.effectiveScopeDigest))
      || !SHA256.test(text(value.packageDigest))
      || !UUID.test(text(value.createdByOperatorUserId))
    ) return false;
    var evidenceById = new Map(evidence.map(function (entry) {
      return [entry.evidenceId, entry];
    }));
    var selected = value.evidenceIds.map(function (id) {
      return evidenceById.get(id);
    });
    return selected.every(Boolean)
      && selected.every(function (entry) {
        return entry.progressRevision === value.progressRevision
          && entry.effectiveScopeDigest === value.effectiveScopeDigest;
      })
      && ["desktop", "phone"].every(function (viewport) {
        return selected.some(function (entry) {
          return entry.viewport === viewport;
        });
      })
      && !selected.some(function (desktop) {
        return desktop.viewport === "desktop"
          && selected.some(function (phone) {
            return phone.viewport === "phone"
              && phone.contentDigest === desktop.contentDigest;
          });
      });
  }

  function customBuildChangeCompletionState(active, completion) {
    if (completion) return completion.state;
    if (active && active.state === "issued") {
      return "change_order_review";
    }
    if (active && active.state === "accepted_payment_required") {
      return "change_order_payment_required";
    }
    return "building";
  }

  function verifiedCustomerCustomBuildChangeCompletion(value) {
    if (
      !exactKeys(
        value,
        ["changeOrders", "completion", "schema", "state"]
      )
      || value.schema !== CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA
      || ![
        "not_available",
        "building",
        "change_order_review",
        "change_order_payment_required",
        "ready_for_final_payment",
        "ready_for_delivery"
      ].includes(value.state)
      || !exactKeys(value.changeOrders, ["active", "history"])
      || !Array.isArray(value.changeOrders.history)
      || value.changeOrders.history.length > 100
      || !value.changeOrders.history.every(function (entry) {
        return safeCustomBuildChangeOrder(entry, false)
          && !["issued", "accepted_payment_required"]
            .includes(entry.state);
      })
      || new Set(value.changeOrders.history.map(function (entry) {
        return entry.changeOrderId;
      })).size !== value.changeOrders.history.length
      || (
        value.changeOrders.active !== null
        && !safeCustomBuildChangeOrder(
          value.changeOrders.active,
          false
        )
      )
      || (
        value.changeOrders.active !== null
        && !["issued", "accepted_payment_required"]
          .includes(value.changeOrders.active.state)
      )
      || !safeCustomBuildCompletion(value.completion, false, [])
    ) return null;
    var active = value.changeOrders.active;
    var ids = value.changeOrders.history.map(function (entry) {
      return entry.changeOrderId;
    });
    if (active && ids.includes(active.changeOrderId)) return null;
    if (value.state === "not_available") {
      return active === null
        && value.changeOrders.history.length === 0
        && value.completion === null
        ? value
        : null;
    }
    return value.state === customBuildChangeCompletionState(
      active,
      value.completion
    )
      && (!value.completion || active === null)
      ? value
      : null;
  }

  function verifiedOwnerCustomBuildChangeCompletion(
    value,
    expectedEntry
  ) {
    if (
      !exactKeys(
        value,
        [
          "changeOrders",
          "completion",
          "evidence",
          "job",
          "proofBinding",
          "schema",
          "state"
        ]
      )
      || value.schema !== CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA
      || !record(value.job)
      || !exactKeys(
        value.job,
        [
          "caseId",
          "currency",
          "customerId",
          "finalDueMinor",
          "jobId",
          "openedAt",
          "organizationId",
          "projectId",
          "state",
          "targetCompletionDate"
        ]
      )
      || !UUID.test(text(value.job.jobId))
      || !UUID.test(text(value.job.organizationId))
      || !UUID.test(text(value.job.projectId))
      || !UUID.test(text(value.job.caseId))
      || !UUID.test(text(value.job.customerId))
      || value.job.state !== "open"
      || !assessmentDate(value.job.targetCompletionDate)
      || !safeMinor(value.job.finalDueMinor)
      || value.job.currency !== "USD"
      || !safeIso(value.job.openedAt)
      || !Array.isArray(value.changeOrders)
      || value.changeOrders.length > 100
      || !value.changeOrders.every(function (entry, index, entries) {
        return safeCustomBuildChangeOrder(entry, true)
          && (
            index === 0
            || entries[index - 1].changeNumber < entry.changeNumber
          );
      })
      || new Set(value.changeOrders.map(function (entry) {
        return entry.changeOrderId;
      })).size !== value.changeOrders.length
      || value.changeOrders.filter(function (entry) {
        return ["issued", "accepted_payment_required"]
          .includes(entry.state);
      }).length > 1
      || !Array.isArray(value.evidence)
      || value.evidence.length > 12
      || !value.evidence.every(function (entry) {
        return safeCustomBuildCompletionEvidence(entry, true);
      })
      || new Set(value.evidence.map(function (entry) {
        return entry.evidenceId;
      })).size !== value.evidence.length
      || !safeCustomBuildCompletion(
        value.completion,
        true,
        value.evidence
      )
    ) return null;
    if (
      value.proofBinding !== null
      && (
        !exactKeys(
          value.proofBinding,
          ["effectiveScopeDigest", "progressRevision"]
        )
        || !Number.isSafeInteger(value.proofBinding.progressRevision)
        || value.proofBinding.progressRevision < 1
        || !SHA256.test(text(value.proofBinding.effectiveScopeDigest))
      )
    ) return null;
    if (
      expectedEntry
      && (
        value.job.jobId !== text(expectedEntry.job && expectedEntry.job.jobId)
        || value.job.organizationId !== text(expectedEntry.organizationId)
        || value.job.projectId !== text(expectedEntry.projectId)
        || value.job.caseId !== text(expectedEntry.caseId)
        || value.job.customerId !== text(
          expectedEntry.customer && expectedEntry.customer.customerId
        )
        || value.job.targetCompletionDate !== text(
          expectedEntry.job && expectedEntry.job.targetCompletionDate
        )
      )
    ) return null;
    var active = value.changeOrders.find(function (entry) {
      return ["issued", "accepted_payment_required"]
        .includes(entry.state);
    }) || null;
    if (
      value.completion
      && (
        value.proofBinding === null
        || value.completion.progressRevision !==
          value.proofBinding.progressRevision
        || value.completion.effectiveScopeDigest !==
          value.proofBinding.effectiveScopeDigest
      )
    ) return null;
    return value.state === customBuildChangeCompletionState(
      active,
      value.completion
    )
      && (!value.completion || active === null)
      ? value
      : null;
  }

  function customBuildChangeOrderForInvoice(snapshot, invoice) {
    var verified = verifiedCustomerCustomBuildChangeCompletion(snapshot);
    if (!verified || !invoice) return null;
    return verified.changeOrders.history.concat(
      verified.changeOrders.active ? [verified.changeOrders.active] : []
    ).find(function (order) {
      return order.changeOrderId === invoice.changeOrderId;
    }) || null;
  }

  function safeCustomBuildChangeInvoiceProjection(
    value,
    order,
    ownerOrder
  ) {
    var states = [
      "checkout_available",
      "checkout_expired",
      "checkout_ready",
      "paid",
      "payment_held",
      "reconciliation_required",
      "voided"
    ];
    if (
      !exactKeys(value, ["action", "invoice", "schema", "state"])
      || value.schema !== CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA
      || !states.includes(value.state)
      || !exactKeys(value.action, ["available", "reason"])
      || value.action.available !== (value.state === "checkout_available")
      || value.action.reason !== (
        value.state === "checkout_available" ? null : value.state
      )
      || !exactKeys(
        value.invoice,
        [
          "acceptedDisclosureDigest",
          "acceptedQuoteDigest",
          "changeAcceptanceId",
          "changeNumber",
          "changeOrderId",
          "invoiceDigest",
          "invoiceId",
          "invoiceNumber",
          "issuedAt",
          "lines",
          "payment",
          "subtotal",
          "targetCompletionDate",
          "tax",
          "total"
        ]
      )
    ) return null;
    var invoice = value.invoice;
    if (
      !UUID.test(text(invoice.invoiceId))
      || !/^SSCB-CHG-[0-9A-F]{32}$/u.test(text(invoice.invoiceNumber))
      || !SHA256.test(text(invoice.invoiceDigest))
      || !UUID.test(text(invoice.changeOrderId))
      || !UUID.test(text(invoice.changeAcceptanceId))
      || !Number.isSafeInteger(invoice.changeNumber)
      || invoice.changeNumber < 1
      || !SHA256.test(text(invoice.acceptedQuoteDigest))
      || !SHA256.test(text(invoice.acceptedDisclosureDigest))
      || !safeIso(invoice.issuedAt)
      || !assessmentDate(invoice.targetCompletionDate)
      || !Array.isArray(invoice.lines)
      || invoice.lines.length !== 1
      || !exactKeys(
        invoice.lines[0],
        [
          "amountMinor",
          "componentKey",
          "currency",
          "displayName",
          "lineNumber",
          "quantity",
          "unitAmountMinor"
        ]
      )
    ) return null;
    var line = invoice.lines[0];
    if (
      line.lineNumber !== 1
      || line.componentKey !== "custom_build_change_units"
      || line.displayName !== "Custom build change #"
        + invoice.changeNumber + " — added-work units"
      || !Number.isSafeInteger(line.quantity)
      || line.quantity < 1
      || line.quantity > 40
      || line.unitAmountMinor !== CUSTOM_BUILD_CHANGE_UNIT_MINOR
      || line.amountMinor !== line.quantity * line.unitAmountMinor
      || line.currency !== "USD"
      || !exactKeys(invoice.subtotal, ["amountMinor", "currency"])
      || invoice.subtotal.amountMinor !== line.amountMinor
      || invoice.subtotal.currency !== "USD"
      || !exactKeys(invoice.tax, ["amountMinor", "state"])
      || !exactKeys(invoice.total, ["amountMinor", "currency", "state"])
      || invoice.total.currency !== "USD"
      || !exactKeys(
        invoice.payment,
        ["chargeOccurred", "checkoutExpiresAt", "checkoutUrl", "settledAt"]
      )
    ) return null;
    var paid = value.state === "paid";
    var ready = value.state === "checkout_ready";
    if (paid) {
      if (
        !safeMinor(invoice.tax.amountMinor)
        || invoice.tax.state !== "settled"
        || !safeMinor(invoice.total.amountMinor)
        || invoice.total.amountMinor !==
          invoice.subtotal.amountMinor + invoice.tax.amountMinor
        || invoice.total.state !== "settled"
        || invoice.payment.chargeOccurred !== true
        || invoice.payment.checkoutUrl !== null
        || invoice.payment.checkoutExpiresAt !== null
        || !safeIso(invoice.payment.settledAt)
      ) return null;
    } else if (
      invoice.tax.amountMinor !== null
      || invoice.tax.state !== "calculated_at_checkout"
      || invoice.total.amountMinor !== null
      || invoice.total.state !== "shown_at_checkout"
      || invoice.payment.chargeOccurred !== false
      || invoice.payment.settledAt !== null
    ) return null;
    if (ready) {
      if (
        safeCheckoutDestination({ checkoutUrl: invoice.payment.checkoutUrl })
          !== invoice.payment.checkoutUrl
        || !safeIso(invoice.payment.checkoutExpiresAt)
      ) return null;
    } else if (
      invoice.payment.checkoutUrl !== null
      || invoice.payment.checkoutExpiresAt !== null
    ) return null;
    if (order) {
      if (
        !safeCustomBuildChangeOrder(order, ownerOrder === true)
        || invoice.changeOrderId !== order.changeOrderId
        || invoice.changeNumber !== order.changeNumber
        || invoice.acceptedQuoteDigest !== order.quoteDigest
        || invoice.acceptedDisclosureDigest !== order.disclosureDigest
        || invoice.targetCompletionDate !== order.targetCompletionDate
        || invoice.subtotal.amountMinor !== order.pricing.subtotalMinor
        || !safeIso(order.acceptedAt)
        || Date.parse(invoice.issuedAt) < Date.parse(order.acceptedAt)
        || (paid && order.state !== "effective")
        || (value.state === "voided" && order.state !== "voided")
        || (
          !paid
          && value.state !== "voided"
          && order.state !== "accepted_payment_required"
        )
      ) return null;
    }
    return value;
  }

  function verifiedCustomerCustomBuildChangeInvoice(value, snapshot) {
    if (
      !exactKeys(value, ["action", "invoice", "schema", "state"])
      || value.schema !== CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA
      || !exactKeys(value.action, ["available", "reason"])
    ) return null;
    if (value.state === "not_available") {
      return value.invoice === null
        && value.action.available === false
        && value.action.reason === "invoice_not_available"
        ? value
        : null;
    }
    var order = customBuildChangeOrderForInvoice(snapshot, value.invoice);
    return order
      ? safeCustomBuildChangeInvoiceProjection(value, order)
      : null;
  }

  function verifiedCustomerCustomBuildChangeCheckout(
    value,
    invoiceState,
    nowInput
  ) {
    var invoiceProjection = invoiceState
      && invoiceState.schema === CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA
      ? invoiceState
      : null;
    var invoice = invoiceProjection && invoiceProjection.invoice;
    var now = safeIso(nowInput) ? Date.parse(nowInput) : Date.now();
    if (
      !invoice
      || !exactKeys(value, ["checkout", "schema", "state"])
      || value.schema !== CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA
      || value.state !== "ready"
      || !exactKeys(
        value.checkout,
        [
          "chargeOccurred",
          "changeOrderId",
          "expiresAt",
          "invoiceId",
          "invoiceNumber",
          "subtotal",
          "tax",
          "total",
          "url"
        ]
      )
    ) return null;
    var checkout = value.checkout;
    if (
      checkout.invoiceId !== invoice.invoiceId
      || checkout.invoiceNumber !== invoice.invoiceNumber
      || checkout.changeOrderId !== invoice.changeOrderId
      || safeCheckoutDestination({ checkoutUrl: checkout.url }) !== checkout.url
      || !safeIso(checkout.expiresAt)
      || Date.parse(checkout.expiresAt) <= now
      || !exactKeys(checkout.subtotal, ["amountMinor", "currency"])
      || checkout.subtotal.amountMinor !== invoice.subtotal.amountMinor
      || checkout.subtotal.currency !== "USD"
      || !exactKeys(checkout.tax, ["amountMinor", "state"])
      || checkout.tax.amountMinor !== null
      || checkout.tax.state !== "calculated_at_checkout"
      || !safeCustomBuildPendingMoney(checkout.total, "USD")
      || checkout.chargeOccurred !== false
    ) return null;
    return value;
  }

  function verifiedOwnerCustomBuildChangePayments(
    value,
    expectedEntry,
    changeCompletionInput
  ) {
    if (
      !exactKeys(
        value,
        ["jobId", "organizationId", "payments", "schema"]
      )
      || value.schema !== CUSTOM_BUILD_CHANGE_PAYMENT_OWNER_SCHEMA
      || !UUID.test(text(value.organizationId))
      || !UUID.test(text(value.jobId))
      || !Array.isArray(value.payments)
      || value.payments.length > 100
      || (
        expectedEntry
        && (
          value.organizationId !== text(expectedEntry.organizationId)
          || value.jobId !== text(
            expectedEntry.job && expectedEntry.job.jobId
          )
        )
      )
    ) return null;
    var changeCompletion = changeCompletionInput
      ? verifiedOwnerCustomBuildChangeCompletion(
          changeCompletionInput,
          expectedEntry
        )
      : null;
    if (changeCompletionInput && !changeCompletion) return null;
    var invoiceIds = new Set();
    var orderIds = new Set();
    var acceptanceIds = new Set();
    var attemptIds = new Set();
    var priorChangeNumber = 0;
    var valid = value.payments.every(function (payment) {
      if (
        !exactKeys(
          payment,
          ["action", "invoice", "owner", "schema", "state"]
        )
        || !payment.invoice
      ) return false;
      var order = changeCompletion
        ? changeCompletion.changeOrders.find(function (candidate) {
            return candidate.changeOrderId === payment.invoice.changeOrderId;
          })
        : null;
      if (changeCompletion && !order) return false;
      var invoiceProjection = safeCustomBuildChangeInvoiceProjection(
        {
          schema: payment.schema,
          state: payment.state,
          invoice: payment.invoice,
          action: payment.action
        },
        order,
        true
      );
      if (!invoiceProjection) return false;
      var invoice = payment.invoice;
      if (
        invoice.changeNumber <= priorChangeNumber
        || invoiceIds.has(invoice.invoiceId)
        || orderIds.has(invoice.changeOrderId)
        || acceptanceIds.has(invoice.changeAcceptanceId)
      ) return false;
      priorChangeNumber = invoice.changeNumber;
      invoiceIds.add(invoice.invoiceId);
      orderIds.add(invoice.changeOrderId);
      acceptanceIds.add(invoice.changeAcceptanceId);
      if (
        !exactKeys(
          payment.owner,
          [
            "attemptId",
            "attemptState",
            "canReconcileCreation",
            "canReconcileSettlement",
            "eventId",
            "eventState",
            "providerEffectCertainty",
            "providerErrorCode",
            "providerRequestExpiresAt",
            "receiptSource",
            "reconciliationCode"
          ]
        )
      ) return false;
      var owner = payment.owner;
      var attemptStates = [
        "provider_pending",
        "ready",
        "failed",
        "persistence_unknown",
        "expired",
        "paid"
      ];
      var eventStates = [
        "pending",
        "reconciliation_required",
        "processed"
      ];
      var safeCode = function (selected) {
        return selected === null
          || /^[A-Za-z0-9._:-]{1,200}$/u.test(text(selected));
      };
      if (
        (owner.attemptId !== null && !UUID.test(text(owner.attemptId)))
        || (
          owner.attemptState !== null
          && !attemptStates.includes(owner.attemptState)
        )
        || (
          owner.providerEffectCertainty !== null
          && !["not_submitted", "confirmed", "ambiguous"]
            .includes(owner.providerEffectCertainty)
        )
        || !safeCode(owner.providerErrorCode)
        || !safeCode(owner.reconciliationCode)
        || ![null, "stripe_event", "provider_readback"]
          .includes(owner.receiptSource)
        || typeof owner.canReconcileCreation !== "boolean"
        || typeof owner.canReconcileSettlement !== "boolean"
      ) return false;
      if (owner.attemptState === null) {
        if (
          owner.attemptId !== null
          || owner.providerEffectCertainty !== null
          || owner.providerErrorCode !== null
          || owner.providerRequestExpiresAt !== null
          || owner.eventId !== null
          || owner.eventState !== null
          || owner.reconciliationCode !== null
          || owner.receiptSource !== null
          || owner.canReconcileCreation
          || owner.canReconcileSettlement
        ) return false;
      } else {
        if (
          !UUID.test(text(owner.attemptId))
          || !safeIso(owner.providerRequestExpiresAt)
          || attemptIds.has(owner.attemptId)
        ) return false;
        attemptIds.add(owner.attemptId);
        if (
          owner.canReconcileCreation !== [
            "provider_pending",
            "persistence_unknown"
          ].includes(owner.attemptState)
          || owner.canReconcileSettlement !==
            (owner.attemptState === "ready")
        ) return false;
        if (
          owner.attemptState === "provider_pending"
          && owner.providerEffectCertainty !== "not_submitted"
        ) return false;
        if (
          owner.attemptState === "persistence_unknown"
          && (
            owner.providerEffectCertainty !== "ambiguous"
            || owner.providerErrorCode === null
          )
        ) return false;
        if (
          ["ready", "expired", "paid"].includes(owner.attemptState)
          && owner.providerEffectCertainty !== "confirmed"
        ) return false;
        if (
          owner.attemptState === "failed"
          && (
            owner.providerEffectCertainty !== "not_submitted"
            || owner.providerErrorCode === null
          )
        ) return false;
      }
      if (owner.eventId === null) {
        if (
          owner.eventState !== null
          || owner.reconciliationCode !== null
        ) return false;
      } else if (
        !/^evt_[A-Za-z0-9_]+$/u.test(text(owner.eventId))
        || !eventStates.includes(owner.eventState)
        || (
          owner.eventState === "reconciliation_required"
            ? owner.reconciliationCode === null
            : owner.reconciliationCode !== null
        )
      ) return false;
      if (payment.state === "paid") {
        if (
          owner.attemptState !== "paid"
          || !["stripe_event", "provider_readback"]
            .includes(owner.receiptSource)
          || (
            owner.receiptSource === "stripe_event"
            && owner.eventState !== "processed"
          )
        ) return false;
      } else if (owner.receiptSource !== null) return false;
      if (
        payment.state === "reconciliation_required"
        && !owner.canReconcileCreation
        && !owner.canReconcileSettlement
      ) return false;
      if (
        owner.canReconcileCreation
        && payment.state !== "reconciliation_required"
      ) return false;
      return true;
    });
    return valid ? value : null;
  }

  function verifiedOwnerCustomBuildChangePaymentReconciliation(
    value,
    expectedEntry,
    expectedPayment
  ) {
    if (
      !exactKeys(
        value,
        [
          "action",
          "attemptId",
          "changeOrderId",
          "checkout",
          "invoiceId",
          "jobId",
          "next",
          "organizationId",
          "reason",
          "schema",
          "settlement",
          "status"
        ]
      )
      || value.schema !==
        CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_SCHEMA
      || !expectedEntry
      || !expectedPayment
      || value.organizationId !== text(expectedEntry.organizationId)
      || value.jobId !== text(expectedEntry.job && expectedEntry.job.jobId)
      || value.attemptId !== expectedPayment.owner.attemptId
      || value.invoiceId !== expectedPayment.invoice.invoiceId
      || value.changeOrderId !== expectedPayment.invoice.changeOrderId
      || (
        value.reason !== null
        && !/^[A-Za-z0-9._:-]{1,200}$/u.test(text(value.reason))
      )
    ) return null;
    var expectedState = {
      checkout_ready: [
        "creation_reconciled",
        "customer_checkout"
      ],
      payment_settled: [
        "settlement_reconciled",
        "custom_build_changed_work"
      ],
      checkout_expired: [
        "attempt_expired",
        "new_checkout_command"
      ],
      reconciliation_required: [
        "retry_required",
        "owner_retry"
      ]
    }[value.status];
    if (
      !expectedState
      || value.action !== expectedState[0]
      || value.next !== expectedState[1]
    ) return null;
    if (value.status === "checkout_ready") {
      var invoiceState = {
        schema: expectedPayment.schema,
        state: expectedPayment.state,
        invoice: expectedPayment.invoice,
        action: expectedPayment.action
      };
      if (
        !verifiedCustomerCustomBuildChangeCheckout(
          value.checkout,
          invoiceState
        )
        || value.settlement !== null
      ) return null;
    } else if (value.checkout !== null) return null;
    if (value.status === "payment_settled") {
      if (
        !exactKeys(
          value.settlement,
          [
            "changeOrderId",
            "invoiceId",
            "next",
            "projectId",
            "receiptId",
            "schema",
            "status"
          ]
        )
        || value.settlement.schema !==
          CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA
        || value.settlement.status !== "payment_settled"
        || value.settlement.next !== "custom_build_changed_work"
        || value.settlement.projectId !== text(expectedEntry.projectId)
        || value.settlement.changeOrderId !==
          expectedPayment.invoice.changeOrderId
        || value.settlement.invoiceId !== expectedPayment.invoice.invoiceId
        || !UUID.test(text(value.settlement.receiptId))
      ) return null;
    } else if (value.settlement !== null) return null;
    return value;
  }

  function currentOwnerCustomBuildCompletionEvidence(snapshot, progressRead) {
    var progress = progressRead && verifiedCustomBuildProgress(
      progressRead.snapshot
    );
    var binding = snapshot && snapshot.proofBinding;
    if (
      !progress
      || !binding
      || !progress.progress
      || progress.progress.revision !== binding.progressRevision
    ) return [];
    return snapshot.evidence.filter(function (entryEvidence) {
      return entryEvidence.progressRevision === binding.progressRevision
        && entryEvidence.effectiveScopeDigest === binding.effectiveScopeDigest;
    });
  }

  function customerCustomBuildCompletionEvidenceUrl(
    projectId,
    evidenceId
  ) {
    if (!UUID.test(text(projectId)) || !UUID.test(text(evidenceId))) {
      return null;
    }
    return "/api/v1/projects/" + projectId
      + "/custom-services/custom-build-completion-evidence/"
      + evidenceId;
  }

  function customBuildEvidenceDimensions(value) {
    return Number.isSafeInteger(value && value.imageWidth)
      && Number.isSafeInteger(value && value.imageHeight)
      ? value.imageWidth + " × " + value.imageHeight + " pixels"
      : "";
  }

  function verifiedOwnerCustomBuildQuoteReceipt(value) {
    if (
      !exactKeys(
        value,
        [
          "credit",
          "caseId",
          "customerId",
          "jobId",
          "organizationId",
          "projectId",
          "quote",
          "reportId",
          "schema",
          "state"
        ]
      )
      || value.schema !==
        "sitesourcery.custom-services-owner-custom-build-quote/v1"
      || !["issued", "voided"].includes(value.state)
      || !UUID.test(text(value.organizationId))
      || !UUID.test(text(value.projectId))
      || !UUID.test(text(value.caseId))
      || !UUID.test(text(value.customerId))
      || !UUID.test(text(value.jobId))
      || !UUID.test(text(value.reportId))
      || !safeCustomBuildCredit(value.credit)
      || !safeCustomBuildQuote(value.quote)
      || value.quote.creditAcceptanceCutoff !==
        value.credit.acceptanceCutoff
      || value.quote.state !== value.state
      || (value.state === "issued"
        && !["available", "expired"].includes(value.credit.state))
      || (value.state === "voided"
        && !["available", "released", "expired"]
          .includes(value.credit.state))
    ) return null;
    return value;
  }

  function safeOwnerAssessmentEvidence(value, expectedJobId) {
    return exactKeys(
      value,
      [
        "accessibleDescription",
        "byteCount",
        "capturedAt",
        "evidenceId",
        "jobId",
        "mediaType",
        "reviewTarget",
        "viewport"
      ]
    )
      && UUID.test(text(value.evidenceId))
      && UUID.test(text(value.jobId))
      && (!expectedJobId || value.jobId === expectedJobId)
      && safeAssessmentTarget(value.reviewTarget)
      && ["desktop", "phone"].includes(value.viewport)
      && assessmentText(value.accessibleDescription, 10, 500)
      && ["image/jpeg", "image/png", "image/webp"]
        .includes(value.mediaType)
      && Number.isSafeInteger(value.byteCount)
      && value.byteCount >= 1
      && value.byteCount <= ASSESSMENT_MAXIMUM_EVIDENCE_BYTES
      && safeIso(value.capturedAt);
  }

  function safeOwnerAssessmentFinding(value, expectedJobId) {
    return exactKeys(
      value,
      [
        "category",
        "evidenceIds",
        "findingDigest",
        "findingId",
        "included",
        "jobId",
        "primaryTarget",
        "priority",
        "recommendation",
        "revision",
        "severity",
        "summary",
        "updatedAt",
        "viewports"
      ]
    )
      && UUID.test(text(value.findingId))
      && UUID.test(text(value.jobId))
      && (!expectedJobId || value.jobId === expectedJobId)
      && Number.isSafeInteger(value.priority)
      && value.priority >= 1
      && value.priority <= 10
      && typeof value.included === "boolean"
      && ASSESSMENT_SEVERITIES.includes(value.severity)
      && ASSESSMENT_CATEGORIES.includes(value.category)
      && safeAssessmentTarget(value.primaryTarget)
      && safeAssessmentViewports(value.viewports)
      && assessmentText(value.summary, 10, 240)
      && assessmentText(value.recommendation, 10, 1500)
      && Array.isArray(value.evidenceIds)
      && value.evidenceIds.length >= 1
      && value.evidenceIds.length <= 10
      && new Set(value.evidenceIds).size === value.evidenceIds.length
      && value.evidenceIds.every(function (evidenceId) {
        return UUID.test(text(evidenceId));
      })
      && Number.isSafeInteger(value.revision)
      && value.revision >= 1
      && SHA256.test(text(value.findingDigest))
      && safeIso(value.updatedAt);
  }

  function verifiedOwnerAssessmentDelivery(value, expectedJobId) {
    if (
      !exactKeys(
        value,
        [
          "credit",
          "deliveredAt",
          "findingCount",
          "jobId",
          "overallSummary",
          "reportId",
          "schema",
          "state"
        ]
      )
      || value.schema !==
        "sitesourcery.custom-services-owner-assessment-delivery/v1"
      || value.state !== "delivered"
      || !UUID.test(text(value.jobId))
      || (expectedJobId && value.jobId !== expectedJobId)
      || !UUID.test(text(value.reportId))
      || !safeIso(value.deliveredAt)
      || !assessmentText(value.overallSummary, 20, 2000)
      || !Number.isSafeInteger(value.findingCount)
      || value.findingCount < 0
      || value.findingCount > 10
      || !safeAssessmentCredit(value.credit, {
        deliveredAt: value.deliveredAt
      })
    ) return null;
    return value;
  }

  function verifiedOwnerAssessmentEvidence(value, expectedJobId) {
    return exactKeys(value, ["evidence", "schema"])
      && value.schema ===
        "sitesourcery.custom-services-owner-assessment-evidence/v1"
      && safeOwnerAssessmentEvidence(value.evidence, expectedJobId)
      ? value
      : null;
  }

  function verifiedOwnerAssessmentFinding(
    value,
    expectedJobId,
    expectedPriority
  ) {
    return exactKeys(value, ["finding", "schema"])
      && value.schema ===
        "sitesourcery.custom-services-owner-assessment-finding/v1"
      && safeOwnerAssessmentFinding(value.finding, expectedJobId)
      && (
        expectedPriority === undefined
        || value.finding.priority === expectedPriority
      )
      ? value
      : null;
  }

  function verifiedOwnerAssessmentJobs(value) {
    if (
      !exactKeys(value, ["jobs", "schema"])
      || value.schema !==
        "sitesourcery.custom-services-owner-assessment-jobs/v1"
      || !Array.isArray(value.jobs)
      || value.jobs.length > 100
    ) return null;
    var jobIds = new Set();
    var valid = value.jobs.every(function (job) {
      if (
        !exactKeys(
          job,
          [
            "caseId",
            "customer",
            "delivery",
            "deliveryDate",
            "evidence",
            "findings",
            "jobId",
            "openedAt",
            "organizationId",
            "organizationName",
            "projectId",
            "projectName",
            "scope",
            "state",
            "workDigest"
          ]
        )
        || !UUID.test(text(job.jobId))
        || jobIds.has(job.jobId)
        || !UUID.test(text(job.organizationId))
        || !assessmentText(job.organizationName, 1, 200)
        || !UUID.test(text(job.projectId))
        || !assessmentText(job.projectName, 1, 200)
        || !UUID.test(text(job.caseId))
        || !exactKeys(
          job.customer,
          ["customerId", "email", "name"]
        )
        || !UUID.test(text(job.customer.customerId))
        || !assessmentText(job.customer.name, 1, 200)
        || !assessmentText(job.customer.email, 3, 320)
        || !["open", "delivered"].includes(job.state)
        || !safeIso(job.openedAt)
        || !assessmentDate(job.deliveryDate)
        || !SHA256.test(text(job.workDigest))
        || !exactKeys(
          job.scope,
          [
            "maximumFindings",
            "maximumRepresentativePagesOrTypes",
            "maximumWebsites",
            "requiredViewports",
            "reviewTargets"
          ]
        )
        || job.scope.maximumWebsites !== 1
        || job.scope.maximumRepresentativePagesOrTypes !== 5
        || job.scope.maximumFindings !== 10
        || !sameAssessmentList(
          job.scope.requiredViewports,
          ["desktop", "phone"]
        )
        || !Array.isArray(job.scope.reviewTargets)
        || job.scope.reviewTargets.length < 1
        || job.scope.reviewTargets.length > 5
        || !job.scope.reviewTargets.every(safeAssessmentTarget)
        || new Set(job.scope.reviewTargets.map(assessmentTargetKey))
          .size !== job.scope.reviewTargets.length
        || !Array.isArray(job.evidence)
        || job.evidence.length > 250
        || !job.evidence.every(function (entry) {
          return safeOwnerAssessmentEvidence(entry, job.jobId);
        })
        || new Set(job.evidence.map(function (entry) {
          return entry.evidenceId;
        })).size !== job.evidence.length
        || !Array.isArray(job.findings)
        || job.findings.length > 10
        || !job.findings.every(function (entry) {
          return safeOwnerAssessmentFinding(entry, job.jobId);
        })
        || new Set(job.findings.map(function (entry) {
          return entry.priority;
        })).size !== job.findings.length
        || !job.findings.every(function (entry, index, findings) {
          return index === 0
            || findings[index - 1].priority < entry.priority;
        })
      ) return false;
      jobIds.add(job.jobId);
      var targetKeys = new Set(
        job.scope.reviewTargets.map(assessmentTargetKey)
      );
      var evidenceById = new Map(
        job.evidence.map(function (entry) {
          return [entry.evidenceId, entry];
        })
      );
      var scoped = job.evidence.every(function (entry) {
        return targetKeys.has(
          assessmentTargetKey(entry.reviewTarget)
        );
      }) && job.findings.every(function (finding) {
        if (
          !targetKeys.has(
            assessmentTargetKey(finding.primaryTarget)
          )
        ) return false;
        var selected = finding.evidenceIds.map(function (id) {
          return evidenceById.get(id);
        });
        return selected.every(Boolean)
          && finding.viewports.every(function (viewport) {
            return selected.some(function (entry) {
              return entry.viewport === viewport;
            });
          });
      });
      var delivery = job.delivery === null
        ? null
        : verifiedOwnerAssessmentDelivery(
            job.delivery,
            job.jobId
          );
      var includedCount = job.findings.filter(function (finding) {
        return finding.included;
      }).length;
      return scoped
        && (job.state === "delivered") === Boolean(delivery)
        && (!delivery || delivery.findingCount === includedCount);
    });
    return valid ? value : null;
  }

  function customerAssessmentEvidenceUrl(
    value,
    projectId,
    evidenceId
  ) {
    var expected = "/api/v1/projects/" + projectId
      + "/custom-services/assessment-evidence/" + evidenceId;
    return value === expected ? expected : null;
  }

  function ownerAssessmentEvidenceUrl(jobId, evidenceId) {
    if (!UUID.test(text(jobId)) || !UUID.test(text(evidenceId))) {
      return null;
    }
    return "/api/v1/operator/custom-services/assessment-jobs/"
      + jobId + "/evidence/" + evidenceId;
  }

  function safeAssessmentReportBuildCredit(
    value,
    deliveredAt
  ) {
    return exactKeys(
      value,
      [
        "acceptanceCutoff",
        "amountMinor",
        "applicationScope",
        "currency",
        "deliveredAt",
        "eligibleTierIds",
        "maximumApplications",
        "nonCash",
        "sameOrganizationAndProjectOnly"
      ]
    )
      && value.amountMinor === 20000
      && value.currency === "USD"
      && value.applicationScope === "custom_base_build"
      && sameAssessmentList(
        value.eligibleTierIds,
        ASSESSMENT_ELIGIBLE_TIER_IDS
      )
      && value.maximumApplications === 1
      && value.nonCash === true
      && value.sameOrganizationAndProjectOnly === true
      && value.deliveredAt === deliveredAt
      && safeIso(value.deliveredAt)
      && safeIso(value.acceptanceCutoff)
      && assessmentCreditWindowIsNinetyDays(
        value.deliveredAt,
        value.acceptanceCutoff
      );
  }

  function safeCustomerAssessmentJob(value) {
    return exactKeys(
      value,
      ["deliveryDate", "jobId", "openedAt", "scope", "state"]
    )
      && UUID.test(text(value.jobId))
      && ["open", "delivered"].includes(value.state)
      && safeIso(value.openedAt)
      && assessmentDate(value.deliveryDate)
      && exactKeys(
        value.scope,
        ["maximumFindings", "requiredViewports", "reviewTargets"]
      )
      && value.scope.maximumFindings === 10
      && sameAssessmentList(
        value.scope.requiredViewports,
        ["desktop", "phone"]
      )
      && Array.isArray(value.scope.reviewTargets)
      && value.scope.reviewTargets.length >= 1
      && value.scope.reviewTargets.length <= 5
      && value.scope.reviewTargets.every(safeAssessmentTarget)
      && new Set(value.scope.reviewTargets.map(assessmentTargetKey))
        .size === value.scope.reviewTargets.length;
  }

  function safeAssessmentReportDocument(
    value,
    job,
    expectedProjectId
  ) {
    if (
      !exactKeys(
        value,
        [
          "buildCredit",
          "coverage",
          "deliveredAt",
          "findings",
          "jobId",
          "overallSummary",
          "project",
          "reportId",
          "schema",
          "scope"
        ]
      )
      || value.schema !== "sitesourcery.assessment-report/v1"
      || !UUID.test(text(value.reportId))
      || value.jobId !== job.jobId
      || !exactKeys(
        value.project,
        [
          "organizationId",
          "organizationName",
          "projectId",
          "projectName"
        ]
      )
      || !UUID.test(text(value.project.organizationId))
      || !assessmentText(value.project.organizationName, 1, 200)
      || !UUID.test(text(value.project.projectId))
      || value.project.projectId !== expectedProjectId
      || !assessmentText(value.project.projectName, 1, 200)
      || !safeIso(value.deliveredAt)
      || !assessmentText(value.overallSummary, 20, 2000)
      || !exactKeys(
        value.scope,
        [
          "expandedAssessmentState",
          "maximumFindings",
          "maximumWebsites",
          "requiredViewports",
          "reviewTargets"
        ]
      )
      || value.scope.maximumWebsites !== 1
      || value.scope.maximumFindings !== 10
      || value.scope.expandedAssessmentState !== "separately_quoted"
      || !sameAssessmentList(
        value.scope.requiredViewports,
        ["desktop", "phone"]
      )
      || JSON.stringify(value.scope.reviewTargets)
        !== JSON.stringify(job.scope.reviewTargets)
      || !safeAssessmentReportBuildCredit(
        value.buildCredit,
        value.deliveredAt
      )
      || !Array.isArray(value.coverage)
      || value.coverage.length !==
        value.scope.reviewTargets.length * 2
      || !Array.isArray(value.findings)
      || value.findings.length > 10
    ) return false;
    var targetKeys = new Set(
      value.scope.reviewTargets.map(assessmentTargetKey)
    );
    var coverageKeys = new Set();
    var exposedEvidence = new Set();
    var validCoverage = value.coverage.every(function (entry) {
      if (
        !exactKeys(
          entry,
          [
            "accessibleDescription",
            "capturedAt",
            "evidenceId",
            "reviewTarget",
            "url",
            "viewport"
          ]
        )
        || !UUID.test(text(entry.evidenceId))
        || !safeAssessmentTarget(entry.reviewTarget)
        || !targetKeys.has(assessmentTargetKey(entry.reviewTarget))
        || !["desktop", "phone"].includes(entry.viewport)
        || !assessmentText(entry.accessibleDescription, 10, 500)
        || !safeIso(entry.capturedAt)
        || !customerAssessmentEvidenceUrl(
          entry.url,
          expectedProjectId,
          entry.evidenceId
        )
      ) return false;
      var coverageKey = assessmentTargetKey(entry.reviewTarget)
        + ":" + entry.viewport;
      if (coverageKeys.has(coverageKey)) return false;
      coverageKeys.add(coverageKey);
      exposedEvidence.add(entry.evidenceId);
      return true;
    });
    if (!validCoverage) return false;
    var validFindings = value.findings.every(function (finding, index) {
      if (
        !exactKeys(
          finding,
          [
            "category",
            "evidence",
            "findingDigest",
            "findingId",
            "primaryTarget",
            "priority",
            "recommendation",
            "revision",
            "severity",
            "summary",
            "viewports"
          ]
        )
        || !UUID.test(text(finding.findingId))
        || !Number.isSafeInteger(finding.revision)
        || finding.revision < 1
        || !SHA256.test(text(finding.findingDigest))
        || finding.priority !== index + 1
        || !ASSESSMENT_SEVERITIES.includes(finding.severity)
        || !ASSESSMENT_CATEGORIES.includes(finding.category)
        || !safeAssessmentTarget(finding.primaryTarget)
        || !targetKeys.has(
          assessmentTargetKey(finding.primaryTarget)
        )
        || !safeAssessmentViewports(finding.viewports)
        || !assessmentText(finding.summary, 10, 240)
        || !assessmentText(finding.recommendation, 10, 1500)
        || !Array.isArray(finding.evidence)
        || finding.evidence.length < 1
        || finding.evidence.length > 10
      ) return false;
      var evidenceIds = new Set();
      var validEvidence = finding.evidence.every(function (entry) {
        if (
          !exactKeys(
            entry,
            [
              "accessibleDescription",
              "evidenceId",
              "url",
              "viewport"
            ]
          )
          || !UUID.test(text(entry.evidenceId))
          || evidenceIds.has(entry.evidenceId)
          || !["desktop", "phone"].includes(entry.viewport)
          || !assessmentText(entry.accessibleDescription, 10, 500)
          || !customerAssessmentEvidenceUrl(
            entry.url,
            expectedProjectId,
            entry.evidenceId
          )
        ) return false;
        evidenceIds.add(entry.evidenceId);
        exposedEvidence.add(entry.evidenceId);
        return true;
      });
      return validEvidence
        && finding.viewports.every(function (viewport) {
          return finding.evidence.some(function (entry) {
            return entry.viewport === viewport;
          });
        });
    });
    return validFindings
      && targetKeys.size * 2 === coverageKeys.size
      && exposedEvidence.size <= 110;
  }

  function verifiedCustomerAssessmentReport(value, expectedProjectId) {
    if (
      !exactKeys(
        value,
        ["credit", "job", "report", "schema", "state"]
      )
      || value.schema !==
        "sitesourcery.custom-services-assessment-report/v1"
      || !["not_available", "in_progress", "delivered"]
        .includes(value.state)
    ) return null;
    if (value.state === "not_available") {
      return value.job === null
        && value.report === null
        && value.credit === null
        ? value
        : null;
    }
    if (
      !UUID.test(text(expectedProjectId))
      || !safeCustomerAssessmentJob(value.job)
    ) return null;
    if (value.state === "in_progress") {
      return value.job.state === "open"
        && value.report === null
        && value.credit === null
        ? value
        : null;
    }
    if (
      value.job.state !== "delivered"
      || !safeAssessmentReportDocument(
        value.report,
        value.job,
        expectedProjectId
      )
      || !safeAssessmentCredit(value.credit, {
        deliveredAt: value.report.deliveredAt,
        acceptanceCutoff:
          value.report.buildCredit.acceptanceCutoff
      })
      || value.credit.amountMinor !==
        value.report.buildCredit.amountMinor
      || value.credit.currency !==
        value.report.buildCredit.currency
      || JSON.stringify(value.credit.eligibleTierIds)
        !== JSON.stringify(
          value.report.buildCredit.eligibleTierIds
        )
    ) return null;
    return value;
  }

  function verifiedAssessmentRequest(value) {
    if (
      !record(value)
      || value.schema !==
        "sitesourcery.custom-services-assessment-request/v1"
      || ![
        "not_started",
        "draft",
        "submitted",
        "withdrawn"
      ].includes(value.state)
      || !record(value.actions)
    ) return null;
    if (value.state === "not_started") return value;
    if (!UUID.test(text(value.caseId))) return null;
    if (value.website !== null && !record(value.website)) {
      return null;
    }
    if (value.facts !== null && !record(value.facts)) {
      return null;
    }
    if (
      value.state === "draft"
      && (!Number.isSafeInteger(value.draftRevision)
        || value.draftRevision < 1)
    ) return null;
    return value;
  }

  function verifiedAssessmentQuote(value) {
    if (
      !record(value)
      || value.schema !==
        "sitesourcery.custom-services-assessment-quote/v1"
      || ![
        "not_available",
        "review_required",
        "expired",
        "changes_required",
        "accepted"
      ].includes(value.state)
      || !record(value.actions)
      || !record(value.actions.acceptQuote)
    ) return null;
    if (value.state === "not_available") {
      return value.quote === null ? value : null;
    }
    var quote = value.quote;
    if (
      !record(quote)
      || !UUID.test(text(quote.quoteId))
      || !Number.isSafeInteger(quote.revision)
      || quote.revision < 1
      || !SHA256.test(text(quote.quoteDigest))
      || !SHA256.test(text(quote.disclosureDigest))
      || !record(quote.servicePrice)
      || quote.servicePrice.amountMinor !== 20000
      || quote.servicePrice.currency !== "USD"
      || quote.servicePrice.formatted !== "$200.00"
      || !record(quote.tax)
      || quote.tax.state !== "calculation_required"
      || !record(quote.payment)
      || quote.payment.schedule !== "full_before_work"
      || quote.payment.invoice !== "later_separate_invoice"
      || !record(quote.scope)
      || quote.scope.maximumWebsites !== 1
      || quote.scope.maximumFindings !== 10
      || !Array.isArray(quote.scope.reviewTargets)
      || quote.scope.reviewTargets.length > 5
      || !record(quote.dates)
      || !safeIso(quote.dates.issuedAt)
      || !safeIso(quote.dates.expiresAt)
      || typeof quote.dates.deliveryDate !== "string"
    ) return null;
    return value;
  }

  function verifiedAssessmentInvoice(value) {
    var states = [
      "not_available",
      "tax_calculation_pending",
      "checkout_available",
      "payment_verifying",
      "payment_attention",
      "paid_job_open"
    ];
    var checkoutAvailable = record(value)
      && value.state === "checkout_available";
    if (
      !exactKeys(
        value,
        ["actions", "invoice", "job", "schema", "state"]
      )
      || value.schema !==
        "sitesourcery.custom-services-assessment-invoice/v2"
      || !states.includes(value.state)
      || !exactKeys(value.actions, ["checkout"])
      || !exactKeys(
        value.actions.checkout,
        ["available", "message", "reason"]
      )
      || value.actions.checkout.available !== checkoutAvailable
      || typeof value.actions.checkout.message !== "string"
      || value.actions.checkout.message.length < 1
    ) return null;
    if (value.state === "not_available") {
      return value.invoice === null
        && value.job === null
        && value.actions.checkout.reason ===
          "accepted_quote_required"
        ? value
        : null;
    }
    var invoice = value.invoice;
    var paid = value.state === "paid_job_open";
    var verifying = value.state === "payment_verifying";
    var attention = value.state === "payment_attention";
    var expectedPaymentState = paid
      ? "paid"
      : verifying
        ? "verifying"
        : attention
          ? "attention"
          : checkoutAvailable
            ? "checkout_available"
            : "held";
    var expectedActionReason = paid
      ? "already_paid"
      : verifying
        ? "payment_verifying"
        : attention
          ? "payment_attention"
          : checkoutAvailable
            ? null
            : value.actions.checkout.reason;
    if (
      !exactKeys(
        invoice,
        [
          "createdAt",
          "invoiceDigest",
          "invoiceId",
          "invoiceNumber",
          "issuedAt",
          "line",
          "payment",
          "purpose",
          "quote",
          "subtotal",
          "tax",
          "total"
        ]
      )
      || !UUID.test(text(invoice.invoiceId))
      || !/^SSA-[0-9A-F]{32}$/u.test(text(invoice.invoiceNumber))
      || invoice.purpose !== "assessment"
      || !exactKeys(
        invoice.quote,
        [
          "acceptedAt",
          "acceptedDisclosureDigest",
          "acceptedQuoteDigest",
          "quoteId",
          "quoteRevision"
        ]
      )
      || !UUID.test(text(invoice.quote.quoteId))
      || !Number.isSafeInteger(invoice.quote.quoteRevision)
      || invoice.quote.quoteRevision < 1
      || !safeIso(invoice.quote.acceptedAt)
      || !SHA256.test(text(invoice.quote.acceptedQuoteDigest))
      || !SHA256.test(text(invoice.quote.acceptedDisclosureDigest))
      || !exactKeys(
        invoice.line,
        ["name", "quantity", "unit", "unitAmount"]
      )
      || invoice.line.name !== "Website assessment"
      || invoice.line.quantity !== 1
      || invoice.line.unit !== "assessment"
      || !exactKeys(
        invoice.line.unitAmount,
        ["amountMinor", "currency", "formatted"]
      )
      || invoice.line.unitAmount.amountMinor !== 20000
      || invoice.line.unitAmount.currency !== "USD"
      || invoice.line.unitAmount.formatted !== "$200.00"
      || !exactKeys(
        invoice.subtotal,
        ["amountMinor", "currency", "formatted"]
      )
      || invoice.subtotal.amountMinor !== 20000
      || invoice.subtotal.currency !== "USD"
      || invoice.subtotal.formatted !== "$200.00"
      || !exactKeys(invoice.tax, ["amountMinor", "message", "state"])
      || typeof invoice.tax.message !== "string"
      || invoice.tax.message.length < 1
      || !exactKeys(
        invoice.total,
        ["amountMinor", "currency", "formatted", "state"]
      )
      || invoice.total.currency !== "USD"
      || !exactKeys(
        invoice.payment,
        [
          "chargeOccurred",
          "checkoutAvailable",
          "message",
          "paidAt",
          "receiptId",
          "settledAt",
          "state"
        ]
      )
      || invoice.payment.state !== expectedPaymentState
      || invoice.payment.checkoutAvailable !== checkoutAvailable
      || typeof invoice.payment.message !== "string"
      || invoice.payment.message.length < 1
      || value.actions.checkout.reason !== expectedActionReason
      || !SHA256.test(text(invoice.invoiceDigest))
      || !safeIso(invoice.issuedAt)
      || !safeIso(invoice.createdAt)
    ) return null;
    if (paid) {
      if (
        invoice.payment.chargeOccurred !== true
        || !UUID.test(text(invoice.payment.receiptId))
        || !safeIso(invoice.payment.paidAt)
        || !safeIso(invoice.payment.settledAt)
        || invoice.tax.state !== "calculated"
        || !safeMinor(invoice.tax.amountMinor)
        || invoice.total.state !== "final"
        || !safeMinor(invoice.total.amountMinor)
        || invoice.total.amountMinor !==
          20000 + invoice.tax.amountMinor
        || invoice.total.formatted !==
          "$" + (invoice.total.amountMinor / 100).toFixed(2)
        || !exactKeys(
          value.job,
          ["deliveryDate", "jobId", "openedAt", "state"]
        )
        || !UUID.test(text(value.job.jobId))
        || value.job.state !== "open"
        || !safeIso(value.job.openedAt)
        || !/^\d{4}-\d{2}-\d{2}$/u.test(
          text(value.job.deliveryDate)
        )
      ) return null;
    } else if (
      value.job !== null
      || invoice.tax.state !== "calculation_required"
      || invoice.tax.amountMinor !== null
      || invoice.total.state !== "pending_tax"
      || invoice.total.amountMinor !== null
      || invoice.total.formatted !== null
      || invoice.payment.receiptId !== null
      || invoice.payment.paidAt !== null
      || invoice.payment.settledAt !== null
      || invoice.payment.chargeOccurred !== (
        verifying || attention ? null : false
      )
      || (
        value.state === "tax_calculation_pending"
        && ![
          "checkout_not_available",
          "payment_release_held",
          "reconciliation_required"
        ].includes(value.actions.checkout.reason)
      )
    ) return null;
    return value;
  }

  function verifiedAssessmentCheckout(
    value,
    expectedInvoice,
    observedAt
  ) {
    var checkout = value && value.checkout;
    var observed = safeIso(observedAt)
      ? Date.parse(observedAt)
      : Date.now();
    var destination = safeCheckoutDestination(value);
    if (
      !exactKeys(value, ["checkout", "schema", "state"])
      || value.schema !==
        "sitesourcery.custom-services-assessment-checkout/v1"
      || value.state !== "ready"
      || !record(expectedInvoice)
      || !exactKeys(
        checkout,
        [
          "chargeOccurred",
          "expiresAt",
          "invoiceId",
          "invoiceNumber",
          "subtotal",
          "tax",
          "total",
          "url"
        ]
      )
      || checkout.invoiceId !== expectedInvoice.invoiceId
      || checkout.invoiceNumber !== expectedInvoice.invoiceNumber
      || !UUID.test(text(checkout.invoiceId))
      || !/^SSA-[0-9A-F]{32}$/u.test(text(checkout.invoiceNumber))
      || !safeIso(checkout.expiresAt)
      || Date.parse(checkout.expiresAt) <= observed
      || !destination
      || destination !== checkout.url
      || !exactKeys(
        checkout.subtotal,
        ["amountMinor", "currency", "formatted"]
      )
      || checkout.subtotal.amountMinor !== 20000
      || checkout.subtotal.currency !== "USD"
      || checkout.subtotal.formatted !== "$200.00"
      || !exactKeys(checkout.tax, ["amountMinor", "state"])
      || checkout.tax.state !== "calculated_at_checkout"
      || checkout.tax.amountMinor !== null
      || !exactKeys(
        checkout.total,
        ["amountMinor", "currency", "state"]
      )
      || checkout.total.state !== "shown_at_checkout"
      || checkout.total.amountMinor !== null
      || checkout.total.currency !== "USD"
      || checkout.chargeOccurred !== false
    ) return null;
    return clone(value);
  }

  function assessmentField(
    documentRef,
    name,
    labelCopy,
    value,
    options
  ) {
    var config = options || {};
    var label = accountElement(
      documentRef,
      "label",
      "spark-field"
    );
    label.appendChild(
      accountElement(documentRef, "span", "", labelCopy)
    );
    var field = accountElement(
      documentRef,
      config.multiline ? "textarea" : "input",
      ""
    );
    field.name = name;
    if (!config.multiline) field.type = config.type || "text";
    field.value = value == null ? "" : String(value);
    if (config.required) field.required = true;
    if (config.maximum) field.maxLength = config.maximum;
    if (config.minimumLength) field.minLength = config.minimumLength;
    if (config.minimumValue != null) field.min = String(config.minimumValue);
    if (config.maximumValue != null) field.max = String(config.maximumValue);
    if (config.step != null) field.step = String(config.step);
    if (config.placeholder) field.placeholder = config.placeholder;
    if (config.autocomplete) field.autocomplete = config.autocomplete;
    label.appendChild(field);
    return label;
  }

  function assessmentSelect(
    documentRef,
    name,
    labelCopy,
    selected,
    choices
  ) {
    var label = accountElement(
      documentRef,
      "label",
      "spark-field"
    );
    label.appendChild(
      accountElement(documentRef, "span", "", labelCopy)
    );
    var select = accountElement(documentRef, "select", "");
    select.name = name;
    choices.forEach(function (choice) {
      var option = accountElement(
        documentRef,
        "option",
        "",
        choice[1]
      );
      option.value = choice[0];
      option.selected = choice[0] === selected;
      select.appendChild(option);
    });
    label.appendChild(select);
    return label;
  }

  function customBuildMoney(amountMinor) {
    if (!safeMinor(amountMinor)) return "—";
    var fixed = (amountMinor / 100).toFixed(2).split(".");
    return "$" + fixed[0].replace(
      /\B(?=(\d{3})+(?!\d))/gu,
      ","
    ) + "." + fixed[1];
  }

  function customBuildFootprintLine(footprint) {
    return footprint.craftedPages + " crafted page"
      + (footprint.craftedPages === 1 ? "" : "s")
      + " · " + footprint.sections + " sections"
      + " · " + footprint.uniqueLayouts + " unique layout"
      + (footprint.uniqueLayouts === 1 ? "" : "s")
      + " · up to " + footprint.contentWords + " content words"
      + " · " + footprint.suppliedMedia + " supplied media items";
  }

  function customBuildScheduleLine(pricing) {
    return pricing.paymentSchedule === "full_before_work"
      ? customBuildMoney(pricing.startDueMinor)
        + " due before work begins after the $200 assessment credit"
      : customBuildMoney(pricing.startDueMinor)
        + " due before work begins after the $200 assessment credit; "
        + customBuildMoney(pricing.finalDueMinor)
        + " due before final handoff";
  }

  function customBuildQuoteFacts(documentRef, quote) {
    var review = accountElement(
      documentRef,
      "div",
      "customer-custom-build-contract"
    );
    var facts = accountElement(
      documentRef,
      "dl",
      "customer-custom-build-facts"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Build",
      quote.tier.label
        + (quote.tier.scaleUnits === null
          ? ""
          : " · " + quote.tier.scaleUnits + " capacity unit"
            + (quote.tier.scaleUnits === 1 ? "" : "s"))
    );
    appendAccountFact(
      documentRef,
      facts,
      "Gross price",
      customBuildMoney(quote.pricing.serviceAmountMinor) + " USD"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Assessment credit",
      "−" + customBuildMoney(quote.pricing.creditAmountMinor)
        + " · one use · non-cash"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Amount remaining",
      customBuildMoney(quote.pricing.customerAmountMinor) + " before tax"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Payment timing",
      customBuildScheduleLine(quote.pricing)
    );
    appendAccountFact(
      documentRef,
      facts,
      "Tax",
      "Calculated later at secure checkout, if applicable"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Bound footprint",
      customBuildFootprintLine(quote.tier.footprint)
    );
    appendAccountFact(
      documentRef,
      facts,
      "Workmanship correction",
      quote.workmanshipCorrectionDays
        + " days for in-scope workmanship corrections"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Target completion",
      quote.targetCompletionDate
    );
    appendAccountFact(
      documentRef,
      facts,
      "Quote expires",
      accountDate(quote.expiresAt)
    );
    appendAccountFact(
      documentRef,
      facts,
      "Credit deadline",
      accountDate(quote.creditAcceptanceCutoff)
    );
    var termsHeading = accountElement(
      documentRef,
      "h5",
      "customer-custom-build-terms-heading",
      "Terms included in this exact quote"
    );
    var terms = accountElement(
      documentRef,
      "ul",
      "customer-custom-build-terms"
    );
    quote.terms.rules.forEach(function (rule) {
      terms.appendChild(accountElement(documentRef, "li", "", rule));
    });
    review.append(
      facts,
      termsHeading,
      terms,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-note customer-custom-build-contract-version",
        "Commercial terms version "
          + quote.terms.commercialContractId
          + " is bound to this quote and retained with its acceptance receipt."
      )
    );
    if (quote.acceptance) {
      review.appendChild(
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note customer-custom-build-acceptance-receipt",
          "Acceptance receipt retained · accepted "
            + accountDate(quote.acceptance.acceptedAt)
            + " · exact quote and disclosure digests recorded."
        )
      );
    }
    return review;
  }

  function customBuildJobFacts(documentRef, job, options) {
    var owner = Boolean(options && options.owner);
    var tier = customBuildTier(job.tierId);
    var section = accountElement(
      documentRef,
      "div",
      "customer-custom-build-contract customer-custom-build-owner-review"
    );
    var facts = accountElement(
      documentRef,
      "dl",
      "customer-custom-build-facts"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Build",
      tier.label
    );
    appendAccountFact(
      documentRef,
      facts,
      "Scope",
      job.scopeStatement
    );
    appendAccountFact(
      documentRef,
      facts,
      "Bound footprint",
      customBuildFootprintLine(job.footprint)
    );
    appendAccountFact(
      documentRef,
      facts,
      "Target completion",
      job.targetCompletionDate
    );
    appendAccountFact(
      documentRef,
      facts,
      "Opened",
      accountDate(job.openedAt)
    );
    if (owner) {
      appendAccountFact(
        documentRef,
        facts,
        "First payment subtotal",
        customBuildMoney(job.firstPayment.paidSubtotalMinor)
          + " USD before Checkout tax · $200 assessment credit applied"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Final handoff payment",
        job.finalHandoff.state === "not_required"
          ? "Not required"
          : customBuildMoney(job.finalHandoff.amountMinor)
            + " USD due before final launch or handoff"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Job ID",
        job.jobId
      );
    }
    section.appendChild(facts);
    return section;
  }

  function createCustomerCustomBuildPanel(documentRef, actions) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-custom-services customer-custom-build-quote"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "customer-custom-build-title"
    );
    panel.setAttribute("data-custom-build-quote", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Custom website quote"
    );
    heading.id = "customer-custom-build-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-assessment-status customer-custom-build-status",
      "Choose a project to review its Custom website quote."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var body = accountElement(
      documentRef,
      "div",
      "customer-assessment-body customer-custom-build-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Assessment-backed Custom build"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "After your assessment report is delivered, review one exact Custom website quote here. The server—not this browser—sets the price, credit, installments, and tax state."
      ),
      status,
      body
    );

    function renderAcceptedInvoice(snapshot, read, busy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-invoice customer-quote-review customer-custom-build-owner-review"
      );
      section.setAttribute("data-custom-build-invoice", "");
      section.appendChild(
        accountElement(
          documentRef,
          "h4",
          "",
          "Custom build first payment"
        )
      );
      if (!read.invoice) {
        status.textContent = read.command === "loading first-payment invoice"
          ? "Preparing your exact first-payment invoice…"
          : "Your exact Custom website quote is accepted.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            read.command === "loading first-payment invoice"
              ? "The accepted quote is saved. Loading its exact payment details now; nothing has been charged and work has not started."
              : "The accepted quote is saved, but its payment details could not be shown yet. Nothing has been charged and work has not started."
          )
        );
        return section;
      }
      var selected = verifiedCustomerCustomBuildInvoice(
        read.invoice,
        customBuildInvoiceExpectation(snapshot)
      );
      if (!selected) {
        status.textContent =
          "The first-payment invoice response could not be verified.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-owner-quote-form-error",
            "Payment details were hidden because they did not match your accepted quote. Nothing was charged."
          )
        );
        return section;
      }
      if (selected.state === "not_available") {
        status.textContent =
          "Your quote is accepted, but payment is not available yet.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            "Your accepted quote is safe. The first-payment invoice is not available yet; nothing was charged and work has not started."
          )
        );
        return section;
      }
      var invoice = selected.invoice;
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-custom-build-facts"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Invoice",
        invoice.invoiceNumber
      );
      appendAccountFact(
        documentRef,
        facts,
        "Gross first installment",
        customBuildMoney(invoice.lines[0].amountMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Assessment credit",
        "−" + customBuildMoney(invoice.credit.amountMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Net subtotal",
        customBuildMoney(invoice.subtotal.amountMinor)
          + " USD before Checkout tax"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        "Calculated securely at Checkout"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Payment deadline",
        accountDate(invoice.paymentDeadline)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Final handoff amount",
        invoice.finalHandoff.state === "not_required"
          ? "No final payment required"
          : customBuildMoney(invoice.finalHandoff.amountMinor)
            + " USD · due before final launch or handoff"
      );
      section.appendChild(facts);
      if (selected.state === "checkout_available") {
        status.textContent =
          "Your exact first-payment invoice is ready.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Review the net subtotal above. Stripe will calculate any applicable tax and show the exact total before payment."
          )
        );
        var start = accountElement(
          documentRef,
          "button",
          "spark-button spark-button-primary",
          "Continue to secure payment"
        );
        start.type = "button";
        start.disabled = busy;
        start.addEventListener("click", function () {
          if (typeof actions.checkout === "function") {
            actions.checkout(selected);
          }
        });
        section.appendChild(start);
      } else if (selected.state === "checkout_ready") {
        status.textContent = "Your secure payment page is ready.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "A secure payment page is already reserved for this invoice. No new payment request is needed. It expires "
              + accountDate(invoice.payment.checkoutExpiresAt) + "."
          )
        );
        var destination = safeCheckoutDestination({
          checkoutUrl: invoice.payment.checkoutUrl
        });
        var retained = accountElement(
          documentRef,
          "a",
          "spark-button spark-button-primary",
          "Open retained secure payment page"
        );
        retained.href = destination;
        retained.rel = "noopener noreferrer";
        section.appendChild(retained);
      } else if (selected.state === "payment_held") {
        status.textContent = "Secure payment is not open yet.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            "Nothing has been charged, and work has not started. Site Sourcery will open secure payment when this invoice is ready."
          )
        );
      } else if (selected.state === "payment_window_expired") {
        status.textContent = "This payment window has ended.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            "The seven-day payment window ended before payment was verified. Contact Site Sourcery for the next step; do not send payment from an old link."
          )
        );
      } else if (selected.state === "reconciliation_required") {
        status.textContent = "Site Sourcery is confirming payment status.";
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            "Please do not try another payment. Site Sourcery is checking the earlier attempt first and will help if anything else is needed."
          )
        );
      } else {
        status.textContent = "Your Custom website project is open.";
        section.append(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note customer-custom-build-payment-pending",
            "First payment verified; the $200 assessment credit was applied."
          ),
          customBuildJobFacts(documentRef, selected.job)
        );
      }
      return section;
    }

    function render(readState) {
      var read = readState || {};
      body.replaceChildren();
      panel.hidden = read.phase === "idle";
      if (read.phase === "idle") {
        status.textContent =
          "Choose a project to review its Custom website quote.";
        return;
      }
      if (read.phase === "loading") {
        status.textContent = "Loading this project's Custom website quote…";
        return;
      }
      if (read.phase === "error") {
        status.textContent = read.error
          || "The Custom website quote could not be loaded.";
        var retry = accountElement(
          documentRef,
          "button",
          "spark-button",
          "Try loading the Custom quote again"
        );
        retry.type = "button";
        retry.addEventListener("click", function () {
          if (typeof actions.retry === "function") actions.retry();
        });
        body.appendChild(retry);
        return;
      }
      var snapshot = verifiedCustomerCustomBuildQuote(
        read.snapshot,
        read.projectId
      );
      if (!snapshot) {
        status.textContent =
          "The Custom website quote response could not be verified. Nothing was accepted.";
        return;
      }
      var busy = Boolean(read.command);
      if (read.error) {
        body.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-owner-quote-form-error",
            read.error
          )
        );
      }
      if (snapshot.state === "not_available") {
        status.textContent = snapshot.credit
          ? "Your assessment credit is ready, but no Custom website quote has been issued yet."
          : "No assessment-backed Custom website quote is available yet.";
        if (snapshot.credit) {
          var creditFacts = accountElement(documentRef, "dl", "");
          appendAccountFact(
            documentRef,
            creditFacts,
            "Assessment credit",
            customBuildMoney(snapshot.credit.amountMinor)
              + " · " + accountWords(snapshot.credit.state)
          );
          appendAccountFact(
            documentRef,
            creditFacts,
            "Accept a quote by",
            accountDate(snapshot.credit.acceptanceCutoff)
          );
          var creditSection = accountElement(
            documentRef,
            "section",
            "customer-assessment-invoice customer-quote-review"
          );
          creditSection.append(
            accountElement(
              documentRef,
              "h4",
              "",
              "$200 Custom base-build credit"
            ),
            creditFacts,
            accountElement(
              documentRef,
              "p",
              "customer-assessment-note",
              "This same-project credit is one use and non-cash. Site Sourcery will apply it only to an accepted eligible Custom base-build quote."
            )
          );
          body.appendChild(creditSection);
        }
        var check = accountElement(
          documentRef,
          "button",
          "spark-button",
          "Check for a Custom website quote"
        );
        check.type = "button";
        check.addEventListener("click", function () {
          if (typeof actions.retry === "function") actions.retry();
        });
        body.appendChild(check);
        return;
      }

      var quote = snapshot.quote;
      var review = accountElement(
        documentRef,
        "section",
        "customer-assessment-invoice customer-quote-review customer-custom-build-review"
      );
      review.append(
        accountElement(
          documentRef,
          "h4",
          "",
          quote.tier.label + " Custom website build"
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note customer-custom-build-scope",
          quote.scopeStatement
        ),
        customBuildQuoteFacts(documentRef, quote)
      );
      if (snapshot.state === "issued") {
        var expired = Date.parse(quote.expiresAt) <= Date.now();
        status.textContent = busy
          ? "Accepting the exact Custom website quote…"
          : expired
            ? "This Custom website quote has expired. Ask Site Sourcery for a fresh quote."
            : "Review the exact scope, money, timing, and credit before accepting.";
        var acceptance = accountElement(
          documentRef,
          "label",
          "customer-assessment-authority customer-custom-build-acceptance"
        );
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.disabled = busy || expired;
        acceptance.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            "I reviewed and accept the exact scope, footprint, price, credit, payment schedule, dates, and terms shown above."
          )
        );
        var accept = accountElement(
          documentRef,
          "button",
          "spark-button spark-button-primary",
          "Accept exact Custom website quote"
        );
        accept.type = "button";
        accept.disabled = true;
        checkbox.addEventListener("change", function () {
          accept.disabled = busy || expired || !checkbox.checked;
        });
        accept.addEventListener("click", function () {
          if (
            checkbox.checked
            && !expired
            && typeof actions.accept === "function"
          ) actions.accept(snapshot);
        });
        review.append(acceptance, accept);
      } else if (snapshot.state === "accepted") {
        review.appendChild(
          renderAcceptedInvoice(snapshot, read, busy)
        );
      } else {
        status.textContent = "This Custom website quote was voided.";
        review.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            snapshot.credit.state === "available"
              || snapshot.credit.state === "released"
              ? "The quote is no longer active. Its unconsumed $200 assessment credit is available for a replacement eligible quote before the credit deadline."
              : "The quote is no longer active. The credit status shown here is authoritative."
          )
        );
      }
      body.appendChild(review);
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        status.focus();
      },
      render: render
    });
  }

  function customBuildMilestoneStateLabel(state) {
    return {
      pending: "Not started",
      in_progress: "In progress",
      done: "Complete"
    }[state] || "Unavailable";
  }

  function customBuildProgressMilestones(documentRef, progress) {
    var list = accountElement(
      documentRef,
      "ul",
      "customer-custom-build-progress-milestones"
    );
    progress.milestones.forEach(function (milestone) {
      var item = accountElement(
        documentRef,
        "li",
        "customer-custom-build-progress-milestone"
      );
      item.setAttribute("data-milestone-state", milestone.state);
      item.append(
        accountElement(documentRef, "span", "", milestone.label),
        accountElement(
          documentRef,
          "strong",
          "",
          customBuildMilestoneStateLabel(milestone.state)
        )
      );
      list.appendChild(item);
    });
    return list;
  }

  function customBuildProgressSummary(documentRef, snapshot) {
    var overview = accountElement(
      documentRef,
      "div",
      "customer-custom-build-progress-overview"
    );
    var facts = accountElement(
      documentRef,
      "dl",
      "customer-custom-build-progress-facts"
    );
    appendAccountFact(
      documentRef,
      facts,
      "Current stage",
      snapshot.progress.stageLabel
    );
    appendAccountFact(
      documentRef,
      facts,
      "Target completion",
      snapshot.targetDateUnderReview
        ? "Under review"
        : snapshot.targetCompletionDate
    );
    appendAccountFact(
      documentRef,
      facts,
      "Latest update",
      accountDate(snapshot.progress.updatedAt)
    );
    overview.append(
      facts,
      accountElement(
        documentRef,
        "h4",
        "",
        "Latest update"
      ),
      accountElement(
        documentRef,
        "p",
        "customer-custom-build-progress-copy",
        snapshot.progress.summary
      ),
      accountElement(
        documentRef,
        "h4",
        "",
        "Next step"
      ),
      accountElement(
        documentRef,
        "p",
        "customer-custom-build-progress-copy",
        snapshot.progress.nextStep
      ),
      accountElement(
        documentRef,
        "h4",
        "",
        "Milestones"
      ),
      customBuildProgressMilestones(documentRef, snapshot.progress)
    );
    return overview;
  }

  function createCustomerCustomBuildProgressPanel(documentRef, actions) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-custom-services customer-custom-build-progress"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "customer-custom-build-progress-title"
    );
    panel.setAttribute("data-customer-custom-build-progress", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Your Custom-build project"
    );
    heading.id = "customer-custom-build-progress-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-assessment-status customer-custom-build-progress-status"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var refresh = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Refresh project progress"
    );
    refresh.type = "button";
    refresh.addEventListener("click", function () {
      if (typeof actions.refresh === "function") actions.refresh();
    });
    var body = accountElement(
      documentRef,
      "div",
      "customer-assessment-body customer-custom-build-progress-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Paid Custom build"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "See the current stage, completed milestones, latest update, and any one action Site Sourcery needs from you."
      ),
      status,
      refresh,
      body
    );

    function renderRequest(snapshot, busy) {
      var request = snapshot.activeRequest;
      if (!request) return null;
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-progress-request"
      );
      section.setAttribute("data-custom-build-active-request", request.kind);
      section.append(
        accountElement(documentRef, "h4", "", snapshot.status.label),
        accountElement(
          documentRef,
          "h5",
          "customer-custom-build-progress-request-title",
          request.title
        ),
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-progress-copy",
          request.message
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          request.safeInstructions
        )
      );
      if (request.access) {
        var accessFacts = accountElement(
          documentRef,
          "dl",
          "customer-custom-build-progress-access"
        );
        appendAccountFact(
          documentRef,
          accessFacts,
          "Provider",
          request.access.providerLabel
        );
        appendAccountFact(
          documentRef,
          accessFacts,
          "Account or user label",
          request.access.accountLabel
        );
        appendAccountFact(
          documentRef,
          accessFacts,
          "Requested role",
          request.access.delegatedRole
        );
        appendAccountFact(
          documentRef,
          accessFacts,
          "Sharing window ends",
          accountDate(request.access.expiresAt)
        );
        section.append(
          accessFacts,
          accountElement(
            documentRef,
            "p",
            "customer-custom-build-credential-warning",
            "Use the provider's own sharing or delegated-user controls. Never paste passwords, verification codes, API keys, access tokens, or other credentials here."
          )
        );
      }
      if (!request.responseRequired) {
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "No response is needed right now. Site Sourcery will update this project when the outside dependency changes."
          )
        );
        return section;
      }
      if (request.state === "answered") {
        section.append(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Your response is saved and Site Sourcery is reviewing it. A response does not by itself confirm that provider access works."
          ),
          accountElement(
            documentRef,
            "p",
            "customer-custom-build-progress-copy",
            request.response.note
          )
        );
        return section;
      }
      var form = accountElement(
        documentRef,
        "form",
        "customer-custom-build-progress-response"
      );
      form.setAttribute("data-custom-build-response-form", request.requestId);
      var responseKind = assessmentSelect(
        documentRef,
        "responseKind",
        "Response",
        "provided",
        [
          ["provided", "I completed or provided this"],
          ["cannot_provide", "I cannot provide this"]
        ]
      );
      responseKind.querySelector("select").required = true;
      var responseNote = assessmentField(
        documentRef,
        "responseNote",
        "Safe response note — no credentials",
        "",
        {
          required: true,
          minimumLength: 1,
          maximum: 1000,
          multiline: true,
          placeholder:
            "Describe what you shared or why you cannot provide it."
        }
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Saving your response…" : "Send safe response"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        responseKind,
        responseNote,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "Do not enter passwords, verification codes, API keys, tokens, or raw credentials. Site Sourcery checks access separately after you respond."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var data = new FormData(form);
        if (typeof actions.respond === "function") {
          actions.respond(snapshot, {
            responseKind: text(data.get("responseKind")),
            responseNote: text(data.get("responseNote"))
          });
        }
      });
      section.appendChild(form);
      return section;
    }

    function render(readState) {
      var read = readState || {};
      body.replaceChildren();
      refresh.disabled = read.phase === "loading" || Boolean(read.command);
      panel.setAttribute(
        "aria-busy",
        String(read.phase === "loading" || Boolean(read.command))
      );
      if (["idle", "not_available"].includes(read.phase)) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      if (read.phase === "loading") {
        status.textContent = "Loading your Custom-build progress…";
        return;
      }
      if (read.phase === "error") {
        status.textContent = read.error
          || "Project progress could not be loaded. Refresh and try again.";
        return;
      }
      var snapshot = verifiedCustomBuildProgress(read.snapshot);
      if (!snapshot || snapshot.state !== "active") {
        status.textContent =
          "Project progress could not be verified. Refresh before responding.";
        return;
      }
      status.textContent = read.command
        ? "Saving your response safely…"
        : snapshot.status.label;
      if (read.error) {
        body.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-owner-quote-form-error",
            read.error
          )
        );
      }
      body.appendChild(customBuildProgressSummary(documentRef, snapshot));
      var request = renderRequest(snapshot, Boolean(read.command));
      if (request) body.appendChild(request);
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        if (typeof status.focus === "function") status.focus();
      },
      render: render
    });
  }

  function prepareCustomBuildCompletionEvidenceFile(file, environment) {
    var runtime = environment || (
      typeof globalThis === "object" ? globalThis : {}
    );
    if (
      !file
      || !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || !Number.isSafeInteger(file.size)
      || file.size < 1
      || file.size > ASSESSMENT_MAXIMUM_EVIDENCE_BYTES
      || typeof runtime.FileReader !== "function"
    ) {
      return Promise.reject(new Error(
        "Choose a JPEG, PNG, or WebP screenshot no larger than 700 KiB."
      ));
    }
    return new Promise(function (resolve, reject) {
      var reader = new runtime.FileReader();
      reader.onerror = function () {
        reject(new Error("That completion screenshot could not be read."));
      };
      reader.onload = function () {
        var result = typeof reader.result === "string"
          ? reader.result
          : "";
        var prefix = "data:" + file.type + ";base64,";
        var dataBase64 = result.startsWith(prefix)
          ? result.slice(prefix.length)
          : "";
        if (
          !dataBase64
          || dataBase64.length > Math.ceil(
            ASSESSMENT_MAXIMUM_EVIDENCE_BYTES / 3
          ) * 4 + 4
          || !/^[A-Za-z0-9+/]+={0,2}$/u.test(dataBase64)
        ) {
          reject(new Error(
            "That completion screenshot could not be prepared safely."
          ));
          return;
        }
        resolve(Object.freeze({
          dataBase64: dataBase64,
          mediaType: file.type
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  function createCustomerCustomBuildChangeCompletionPanel(
    documentRef,
    actions
  ) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-custom-services customer-custom-build-change-completion"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "customer-custom-build-change-completion-title"
    );
    panel.setAttribute(
      "data-customer-custom-build-change-completion",
      ""
    );
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Added work and completion proof"
    );
    heading.id = "customer-custom-build-change-completion-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-assessment-status customer-custom-build-change-status"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var refresh = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Refresh added work and completion proof"
    );
    refresh.type = "button";
    refresh.setAttribute("data-customer-change-completion-refresh", "");
    refresh.addEventListener("click", function () {
      if (typeof actions.refresh === "function") actions.refresh();
    });
    var body = accountElement(
      documentRef,
      "div",
      "customer-custom-build-change-completion-body"
    );
    panel.append(
      accountElement(documentRef, "p", "spark-kicker", "Your paid project"),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "Review added work separately from the original scope, then see the bounded proof Site Sourcery prepared when the approved work is ready."
      ),
      status,
      refresh,
      body
    );

    function renderChangeOrder(order, busy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-change-card"
      );
      section.setAttribute("data-customer-change-order", order.state);
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-custom-build-change-facts"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Added scope",
        order.addedScope
      );
      appendAccountFact(
        documentRef,
        facts,
        "Added-work units",
        String(order.pricing.unitCount) + " of 40"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Price per unit",
        customBuildMoney(order.pricing.unitAmountMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Added-work subtotal",
        customBuildMoney(order.pricing.subtotalMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        "Calculated before payment"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Payment timing",
        "Due before changed work begins"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Updated target date",
        order.targetCompletionDate
      );
      appendAccountFact(
        documentRef,
        facts,
        "Review by",
        accountDate(order.expiresAt)
      );
      section.append(
        accountElement(
          documentRef,
          "h4",
          "",
          "Added-work change " + order.changeNumber
        ),
        facts,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "Your original approved scope remains in place. This change covers added work only, and that added work does not begin until its payment is confirmed."
        )
      );
      if (order.state !== "issued") return section;
      var expired = Date.parse(order.expiresAt) <= Date.now();
      var controls = accountElement(
        documentRef,
        "div",
        "customer-custom-build-change-actions"
      );
      var acceptLabel = accountElement(
        documentRef,
        "label",
        "customer-assessment-authority"
      );
      var acceptCheck = accountElement(documentRef, "input", "");
      acceptCheck.type = "checkbox";
      acceptCheck.disabled = busy || expired;
      acceptLabel.append(
        acceptCheck,
        accountElement(
          documentRef,
          "span",
          "",
          "I accept this exact added scope, unit count, subtotal, target date, and the requirement to pay before changed work begins."
        )
      );
      var accept = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Saving exact decision…" : "Accept exact added work"
      );
      accept.type = "button";
      accept.disabled = true;
      acceptCheck.addEventListener("change", function () {
        accept.disabled = busy || expired || !acceptCheck.checked;
      });
      accept.addEventListener("click", function () {
        if (
          acceptCheck.checked
          && !expired
          && typeof actions.accept === "function"
        ) actions.accept(order);
      });
      var declineLabel = accountElement(
        documentRef,
        "label",
        "customer-assessment-authority"
      );
      var declineCheck = accountElement(documentRef, "input", "");
      declineCheck.type = "checkbox";
      declineCheck.disabled = busy;
      declineLabel.append(
        declineCheck,
        accountElement(
          documentRef,
          "span",
          "",
          "I decline this exact added-work change. My original approved scope remains in place."
        )
      );
      var decline = accountElement(
        documentRef,
        "button",
        "spark-button",
        busy ? "Saving exact decision…" : "Decline added work"
      );
      decline.type = "button";
      decline.disabled = true;
      declineCheck.addEventListener("change", function () {
        decline.disabled = busy || !declineCheck.checked;
      });
      decline.addEventListener("click", function () {
        if (
          declineCheck.checked
          && typeof actions.decline === "function"
        ) actions.decline(order);
      });
      controls.append(acceptLabel, accept, declineLabel, decline);
      if (expired) {
        controls.appendChild(accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "This review window has ended. Ask Site Sourcery for a current change order before accepting added work."
        ));
      }
      section.appendChild(controls);
      return section;
    }

    function renderChangePayment(invoiceState, busy, actionAvailable) {
      if (!invoiceState || invoiceState.state === "not_available") {
        return null;
      }
      var invoice = invoiceState.invoice;
      var line = invoice.lines[0];
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-change-card customer-custom-build-change-payment"
      );
      section.setAttribute(
        "data-customer-custom-build-change-payment",
        invoiceState.state
      );
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-custom-build-change-facts"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Invoice",
        invoice.invoiceNumber
      );
      appendAccountFact(
        documentRef,
        facts,
        "Added work",
        line.quantity + " × $125.00"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Subtotal",
        customBuildMoney(invoice.subtotal.amountMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        invoiceState.state === "paid"
          ? customBuildMoney(invoice.tax.amountMinor) + " USD · Settled"
          : "Calculated by Stripe before confirmation"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Exact total",
        invoiceState.state === "paid"
          ? customBuildMoney(invoice.total.amountMinor) + " USD"
          : "Shown by Stripe before confirmation"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Changed work",
        invoiceState.state === "paid"
          ? "Payment confirmed; added scope is effective"
          : "Paused until exact payment is verified"
      );
      section.append(
        accountElement(
          documentRef,
          "h4",
          "",
          "Added-work payment"
        ),
        facts
      );
      var note = {
        checkout_available:
          "No charge has occurred. Stripe will show automatic tax and the exact total before you confirm payment.",
        checkout_ready:
          "No charge is recorded here yet. Your retained Stripe payment page is available until the time shown.",
        checkout_expired:
          "That Stripe payment page expired. Refresh this panel before requesting one safe replacement.",
        payment_held:
          "New payment pages are held in this runtime. No charge occurred and the changed work remains paused.",
        reconciliation_required:
          "Do not try another payment. A prior payment-page result is uncertain and requires Site Sourcery owner review.",
        paid:
          "Stripe payment was verified against this exact invoice. The changed work may now proceed.",
        voided:
          "This invoice was voided without a recorded charge. It cannot be paid."
      }[invoiceState.state];
      section.appendChild(accountElement(
        documentRef,
        "p",
        invoiceState.state === "reconciliation_required"
          ? "customer-custom-build-credential-warning"
          : "customer-assessment-note",
        note
      ));
      if (
        invoiceState.state === "checkout_available"
        && actionAvailable === true
      ) {
        var checkout = accountElement(
          documentRef,
          "button",
          "spark-button spark-button-primary",
          busy ? "Opening secure payment…" : "Continue to secure payment"
        );
        checkout.type = "button";
        checkout.disabled = busy;
        checkout.setAttribute(
          "data-customer-custom-build-change-checkout",
          ""
        );
        checkout.addEventListener("click", function () {
          if (!busy && typeof actions.checkout === "function") {
            actions.checkout(invoiceState);
          }
        });
        section.appendChild(checkout);
      } else if (invoiceState.state === "checkout_ready") {
        appendAccountFact(
          documentRef,
          facts,
          "Payment page expires",
          accountDate(invoice.payment.checkoutExpiresAt)
        );
        var reopen = accountElement(
          documentRef,
          "a",
          "spark-button spark-button-primary",
          "Open retained secure payment"
        );
        reopen.href = invoice.payment.checkoutUrl;
        reopen.rel = "noopener noreferrer";
        reopen.setAttribute(
          "data-customer-custom-build-change-checkout-ready",
          ""
        );
        section.appendChild(reopen);
      } else if (invoiceState.state === "paid") {
        appendAccountFact(
          documentRef,
          facts,
          "Settled",
          accountDate(invoice.payment.settledAt)
        );
      }
      return section;
    }

    function renderCompletion(completion, projectId, busy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-completion-card"
      );
      section.setAttribute("data-customer-custom-build-completion", "");
      var checks = accountElement(
        documentRef,
        "ul",
        "customer-custom-build-completion-checks"
      );
      CUSTOM_BUILD_COMPLETION_CHECKS.forEach(function (entry) {
        checks.appendChild(accountElement(
          documentRef,
          "li",
          "",
          entry[1] + " · Passed"
        ));
      });
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-custom-build-change-facts"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Prepared",
        accountDate(completion.preparedAt)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Next step",
        completion.state === "ready_for_final_payment"
          ? "Final payment is required before delivery"
          : "Ready for delivery"
      );
      var evidence = accountElement(
        documentRef,
        "div",
        "customer-custom-build-completion-evidence"
      );
      completion.evidence.forEach(function (entry) {
        var url = customerCustomBuildCompletionEvidenceUrl(
          projectId,
          entry.evidenceId
        );
        var figure = accountElement(documentRef, "figure", "");
        var image = accountElement(documentRef, "img", "");
        image.src = url;
        image.alt = entry.accessibleDescription;
        image.loading = "lazy";
        image.decoding = "async";
        var open = accountElement(
          documentRef,
          "a",
          "spark-button customer-custom-build-evidence-link",
          "Open authenticated " + entry.viewport + " proof"
        );
        open.href = url;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.setAttribute("data-completion-evidence-control", entry.viewport);
        if (typeof actions.evidence === "function") {
          open.addEventListener("click", function (event) {
            event.preventDefault();
            if (!busy) actions.evidence(entry, url);
          });
        }
        figure.append(
          image,
          accountElement(
            documentRef,
            "figcaption",
            "",
            accountWords(entry.viewport) + " · "
              + entry.accessibleDescription
              + (customBuildEvidenceDimensions(entry)
                ? " · " + customBuildEvidenceDimensions(entry)
                : "")
          ),
          open
        );
        evidence.appendChild(figure);
      });
      section.append(
        accountElement(
          documentRef,
          "h4",
          "",
          "Completion proof is prepared"
        ),
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-progress-copy",
          completion.customerSummary
        ),
        facts,
        accountElement(documentRef, "h5", "", "Checks completed"),
        checks,
        evidence,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "This proof records completed checks. It is not payment, delivery, launch, or the start of the 30-day workmanship-correction clock."
        )
      );
      return section;
    }

    function render(readState) {
      var read = readState || {};
      var snapshot = verifiedCustomerCustomBuildChangeCompletion(
        read.snapshot
      );
      var invoiceState = snapshot
        && verifiedCustomerCustomBuildChangeInvoice(
          read.invoice,
          snapshot
        );
      body.replaceChildren();
      panel.hidden = read.phase === "idle";
      if (read.phase === "idle") return;
      refresh.disabled = read.phase === "loading" || Boolean(read.command);
      panel.setAttribute(
        "aria-busy",
        String(read.phase === "loading" || Boolean(read.command))
      );
      if (!snapshot) {
        status.textContent = read.phase === "loading"
          ? "Loading added work and completion proof…"
          : read.error
            || "Added work and completion proof could not be verified. Refresh before deciding anything.";
        return;
      }
      if (read.error) {
        body.appendChild(accountElement(
          documentRef,
          "p",
          "customer-owner-quote-form-error",
          read.error
        ));
      }
      if (read.phase === "loading") {
        status.textContent =
          "Refreshing added work and completion proof. The last verified information remains below.";
      } else if (read.command) {
        status.textContent = "Saving one exact added-work decision…";
      } else {
        status.textContent = {
          not_available: "No paid Custom build is open for this project.",
          building: "Your approved Custom build is in progress.",
          change_order_review: "An added-work change is ready for your review.",
          change_order_payment_required:
            "The added work is accepted and waiting for confirmed payment.",
          ready_for_final_payment:
            "Completion proof is ready; final payment comes before delivery.",
          ready_for_delivery: "Completion proof is ready for delivery."
        }[snapshot.state];
      }
      if (snapshot.changeOrders.active) {
        body.appendChild(renderChangeOrder(
          snapshot.changeOrders.active,
          Boolean(read.command)
        ));
      } else if (snapshot.state === "building") {
        body.appendChild(accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "There is no added-work decision waiting for you. Your original approved scope remains the active build."
        ));
      } else if (snapshot.state === "not_available") {
        body.appendChild(accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "This project does not currently have paid Custom-build change or completion records."
        ));
      }
      if (invoiceState && invoiceState.state !== "not_available") {
        body.appendChild(renderChangePayment(
          invoiceState,
          Boolean(read.command),
          !read.error
        ));
      } else if (snapshot.state === "change_order_payment_required") {
        body.appendChild(accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          read.command === "loading added-work invoice"
            ? "Loading the exact added-work invoice…"
            : "The exact added-work invoice is not verified yet. Do not send payment outside this account panel."
        ));
      }
      snapshot.changeOrders.history.filter(function (order) {
        return order.state === "expired";
      }).forEach(function (order) {
        var expired = accountElement(
          documentRef,
          "section",
          "customer-custom-build-change-card customer-custom-build-change-expired"
        );
        expired.setAttribute("data-customer-expired-change-order", "");
        expired.append(
          accountElement(
            documentRef,
            "h4",
            "",
            "Added-work change " + order.changeNumber + " · Expired"
          ),
          accountElement(
            documentRef,
            "p",
            "customer-custom-build-progress-copy",
            order.addedScope
          ),
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Its review window ended " + accountDate(order.expiresAt)
              + (order.expiredAt
                ? " and expiration was recorded "
                  + accountDate(order.expiredAt)
                : "")
              + ". It did not add work or change your original approved scope."
          )
        );
        body.appendChild(expired);
      });
      if (snapshot.completion) {
        body.appendChild(renderCompletion(
          snapshot.completion,
          read.projectId,
          Boolean(read.command)
        ));
      }
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        if (typeof status.focus === "function") status.focus();
      },
      render: render
    });
  }

  function customBuildLocalDateTime(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    function two(number) {
      return String(number).padStart(2, "0");
    }
    return date.getFullYear() + "-"
      + two(date.getMonth() + 1) + "-"
      + two(date.getDate()) + "T"
      + two(date.getHours()) + ":"
      + two(date.getMinutes());
  }

  function customBuildFutureDate(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  function createOwnerCustomBuildPanel(documentRef, actions) {
    actions = actions || {};
    var issueDrafts = new Map();
    var voidDrafts = new Map();
    var panel = accountElement(
      documentRef,
      "section",
      "customer-owner-quote-desk customer-owner-custom-build"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "owner-custom-build-title"
    );
    panel.setAttribute("data-owner-custom-build", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Owner Custom website quote desk"
    );
    heading.id = "owner-custom-build-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-owner-quote-status customer-owner-custom-build-status",
      "Private Site Sourcery tools."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var refresh = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Refresh Custom build opportunities"
    );
    refresh.type = "button";
    refresh.addEventListener("click", function () {
      if (typeof actions.refresh === "function") actions.refresh();
    });
    var body = accountElement(
      documentRef,
      "div",
      "customer-owner-quote-body customer-owner-custom-build-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Private Site Sourcery tools"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "After an assessment report is delivered, bind one exact Custom base-build scope to its same-project $200 credit. The browser shows a public estimate; the server remains the only monetary authority."
      ),
      status,
      refresh,
      body
    );

    function numericField(name, labelCopy, value, maximum) {
      return assessmentField(
        documentRef,
        name,
        labelCopy,
        value,
        {
          required: true,
          type: "number",
          minimumValue: ["contentWords", "suppliedMedia"]
            .includes(name) ? 0 : 1,
          maximumValue: maximum,
          step: 1
        }
      );
    }

    function renderQuote(entry, busy) {
      var quote = entry.currentQuote;
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-review customer-quote-review"
      );
      section.append(
        accountElement(
          documentRef,
          "h5",
          "",
          (quote.state === "voided" ? "Previous " : "Current ")
            + quote.tier.label + " quote · "
            + accountWords(quote.state)
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          quote.scopeStatement
        ),
        customBuildQuoteFacts(documentRef, quote)
      );
      if (quote.state === "voided") {
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Safe void is confirmed. An unconsumed released credit may be used on one corrected replacement quote before its deadline."
          )
        );
        return section;
      }
      var voidForm = accountElement(
        documentRef,
        "form",
        "customer-owner-custom-build-void"
      );
      var reason = assessmentField(
        documentRef,
        "voidReason",
        "Reason for safely voiding this quote",
        voidDrafts.get(quote.quoteId) || "",
        {
          required: true,
          minimumLength: 10,
          maximum: 500,
          multiline: true,
          placeholder:
            "Explain why this exact quote is being replaced or withdrawn."
        }
      );
      var note = accountElement(
        documentRef,
        "p",
        "customer-assessment-note",
        "Safe void asks the server to release only an unconsumed assessment credit. The server must refuse if payment is settled or uncertain."
      );
      var button = accountElement(
        documentRef,
        "button",
        "spark-button customer-custom-build-void-button",
        "Safely void Custom build quote"
      );
      button.type = "submit";
      var acceptedConfirmation = null;
      if (quote.state === "accepted") {
        acceptedConfirmation = accountElement(
          documentRef,
          "label",
          "customer-assessment-authority customer-custom-build-void-confirmation"
        );
        var acceptedConfirmationBox = accountElement(
          documentRef,
          "input",
          ""
        );
        acceptedConfirmationBox.type = "checkbox";
        acceptedConfirmationBox.disabled = busy;
        acceptedConfirmation.append(
          acceptedConfirmationBox,
          accountElement(
            documentRef,
            "span",
            "",
            "I understand this accepted quote will be voided and only an unsettled credit reservation may be released."
          )
        );
        acceptedConfirmationBox.addEventListener(
          "change",
          function () {
            button.disabled = busy || !acceptedConfirmationBox.checked;
          }
        );
      }
      button.disabled = busy || Boolean(acceptedConfirmation);
      reason.querySelector("textarea").addEventListener(
        "input",
        function (event) {
          voidDrafts.set(quote.quoteId, event.target.value);
        }
      );
      voidForm.append(reason, note);
      if (acceptedConfirmation) {
        voidForm.appendChild(acceptedConfirmation);
      }
      voidForm.appendChild(button);
      voidForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (
          acceptedConfirmation
          && !acceptedConfirmation.querySelector("input").checked
        ) return;
        if (typeof actions.void !== "function") return;
        var data = new FormData(voidForm);
        actions.void(entry, text(data.get("voidReason")));
      });
      section.appendChild(voidForm);
      return section;
    }

    function renderIssueForm(entry, busy) {
      var draftKey = entry.assessment.jobId;
      var savedDraft = issueDrafts.get(draftKey) || null;
      var startingTier = customBuildTier(
        savedDraft && savedDraft.tierId
      ) || CUSTOM_BUILD_TIERS[0];
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-owner-custom-build-form"
      );
      form.setAttribute(
        "data-owner-custom-build-form",
        entry.assessment.jobId
      );
      var tierField = assessmentSelect(
        documentRef,
        "tierId",
        "Custom build tier",
        startingTier.id,
        CUSTOM_BUILD_TIERS.map(function (tier) {
          return [
            tier.id,
            tier.label + (tier.amountMinor === null
              ? " · $4,000 + capacity"
              : " · " + customBuildMoney(tier.amountMinor))
          ];
        })
      );
      var selectedTier = tierField.querySelector("select");
      var pages = numericField(
        "craftedPages",
        "Crafted pages",
        savedDraft ? savedDraft.craftedPages : startingTier.defaults[0],
        startingTier.maxima[0]
      );
      var sections = numericField(
        "sections",
        "Sections",
        savedDraft ? savedDraft.sections : startingTier.defaults[1],
        startingTier.maxima[1]
      );
      var layouts = numericField(
        "uniqueLayouts",
        "Unique layouts",
        savedDraft ? savedDraft.uniqueLayouts : startingTier.defaults[2],
        startingTier.maxima[2]
      );
      var words = numericField(
        "contentWords",
        "Customer-supplied content words",
        savedDraft ? savedDraft.contentWords : startingTier.defaults[3],
        startingTier.maxima[3]
      );
      var media = numericField(
        "suppliedMedia",
        "Customer-supplied media items",
        savedDraft ? savedDraft.suppliedMedia : startingTier.defaults[4],
        startingTier.maxima[4]
      );
      var scope = assessmentField(
        documentRef,
        "scopeStatement",
        "Exact included build scope",
        savedDraft ? savedDraft.scopeStatement : "",
        {
          required: true,
          minimumLength: 20,
          maximum: 2000,
          multiline: true,
          placeholder:
            "Name the exact pages, sections, content responsibilities, integrations, exclusions, review rounds, and handoff boundary."
        }
      );
      var target = assessmentField(
        documentRef,
        "targetCompletionDate",
        "Target completion date",
        savedDraft
          ? savedDraft.targetCompletionDate
          : customBuildFutureDate(30),
        { required: true, type: "date" }
      );
      var targetInput = target.querySelector("input");
      targetInput.min = customBuildFutureDate(1);
      targetInput.max = customBuildFutureDate(730);
      var cutoff = Date.parse(entry.credit.acceptanceCutoff);
      var maximumExpiry = Math.min(
        Date.now() + 30 * 24 * 60 * 60 * 1000,
        cutoff
      );
      var defaultExpiry = Math.min(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
        maximumExpiry
      );
      var expiry = assessmentField(
        documentRef,
        "expiresAt",
        "Quote expiration",
        savedDraft
          ? savedDraft.expiresAt
          : customBuildLocalDateTime(defaultExpiry),
        { required: true, type: "datetime-local" }
      );
      var expiryInput = expiry.querySelector("input");
      expiryInput.min = customBuildLocalDateTime(
        Date.now() + 5 * 60 * 1000
      );
      expiryInput.max = customBuildLocalDateTime(maximumExpiry);
      var estimate = accountElement(
        documentRef,
        "p",
        "customer-custom-build-estimate customer-assessment-note",
        ""
      );
      estimate.setAttribute("role", "status");
      estimate.setAttribute("aria-live", "polite");
      var error = accountElement(
        documentRef,
        "p",
        "customer-owner-quote-form-error",
        ""
      );
      error.setAttribute("role", "alert");
      var issue = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        "Issue exact Custom website quote"
      );
      issue.type = "submit";
      issue.disabled = busy;
      form.append(
        tierField,
        pages,
        sections,
        layouts,
        words,
        media,
        scope,
        target,
        expiry,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-scale-note",
          "Scale is $4,000 + $270 per computed capacity unit (1–15). Capacity is the greatest overage beyond Flagship: each extra crafted page or unique layout, each four extra sections or media items, or each 500 extra content words."
        ),
        estimate,
        error,
        issue
      );

      var footprintInputs = {
        craftedPages: pages.querySelector("input"),
        sections: sections.querySelector("input"),
        uniqueLayouts: layouts.querySelector("input"),
        contentWords: words.querySelector("input"),
        suppliedMedia: media.querySelector("input")
      };

      function currentFootprint() {
        return {
          craftedPages: Number(footprintInputs.craftedPages.value),
          sections: Number(footprintInputs.sections.value),
          uniqueLayouts: Number(footprintInputs.uniqueLayouts.value),
          contentWords: Number(footprintInputs.contentWords.value),
          suppliedMedia: Number(footprintInputs.suppliedMedia.value)
        };
      }

      function storeDraft() {
        issueDrafts.set(draftKey, {
          tierId: selectedTier.value,
          craftedPages: Number(footprintInputs.craftedPages.value),
          sections: Number(footprintInputs.sections.value),
          uniqueLayouts: Number(footprintInputs.uniqueLayouts.value),
          contentWords: Number(footprintInputs.contentWords.value),
          suppliedMedia: Number(footprintInputs.suppliedMedia.value),
          scopeStatement: form.querySelector(
            '[name="scopeStatement"]'
          ).value,
          targetCompletionDate: targetInput.value,
          expiresAt: expiryInput.value
        });
      }

      function updateEstimate() {
        var publicEstimate = customBuildPublicEstimate(
          selectedTier.value,
          currentFootprint()
        );
        if (!publicEstimate) {
          estimate.textContent = selectedTier.value === "scale"
            ? "Scale must exceed Flagship in at least one capacity and remain within 1–15 computed units."
            : "Enter a footprint inside this tier's published boundary.";
          issue.disabled = true;
          return null;
        }
        var scaleCopy = publicEstimate.scaleUnits === null
          ? ""
          : " ($4,000.00 + $270.00 × "
            + publicEstimate.scaleUnits + " capacity unit"
            + (publicEstimate.scaleUnits === 1 ? "" : "s") + ")";
        estimate.textContent = "Calculated public estimate: "
          + customBuildMoney(publicEstimate.serviceAmountMinor)
          + scaleCopy + " gross; −$200.00 assessment credit; "
          + customBuildMoney(publicEstimate.customerAmountMinor)
          + " remaining before tax. The issued server quote is authoritative.";
        issue.disabled = busy;
        return publicEstimate;
      }

      function applyTierDefaults() {
        var tier = customBuildTier(selectedTier.value);
        Object.keys(footprintInputs).forEach(function (name, index) {
          footprintInputs[name].value = String(tier.defaults[index]);
          footprintInputs[name].max = String(tier.maxima[index]);
        });
        storeDraft();
        updateEstimate();
      }

      selectedTier.addEventListener("change", applyTierDefaults);
      Object.keys(footprintInputs).forEach(function (name) {
        footprintInputs[name].addEventListener("input", function () {
          storeDraft();
          updateEstimate();
        });
      });
      [
        form.querySelector('[name="scopeStatement"]'),
        targetInput,
        expiryInput
      ].forEach(function (field) {
        field.addEventListener("input", storeDraft);
      });
      updateEstimate();

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        error.textContent = "";
        var publicEstimate = updateEstimate();
        if (!publicEstimate || !form.reportValidity()) return;
        storeDraft();
        var expiresAt = new Date(expiryInput.value);
        if (!Number.isFinite(expiresAt.getTime())) {
          error.textContent = "Choose an exact quote expiration.";
          return;
        }
        if (typeof actions.issue !== "function") return;
        actions.issue(entry, {
          organizationId: entry.organizationId,
          tierId: selectedTier.value,
          craftedPages: currentFootprint().craftedPages,
          sections: currentFootprint().sections,
          uniqueLayouts: currentFootprint().uniqueLayouts,
          contentWords: currentFootprint().contentWords,
          suppliedMedia: currentFootprint().suppliedMedia,
          scopeStatement: text(
            form.querySelector('[name="scopeStatement"]').value
          ),
          targetCompletionDate: targetInput.value,
          expiresAt: expiresAt.toISOString()
        });
      });
      return form;
    }

    function renderOpportunity(entry, busy) {
      var card = accountElement(
        documentRef,
        "article",
        "customer-owner-quote-card customer-owner-custom-build-card"
      );
      card.setAttribute(
        "data-custom-build-job",
        entry.assessment.jobId
      );
      card.append(
        accountElement(
          documentRef,
          "h4",
          "",
          entry.projectName + " · " + entry.organizationName
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          entry.customer.name + " · " + entry.customer.email
        )
      );
      var sourceFacts = accountElement(documentRef, "dl", "");
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Assessment report",
        entry.assessment.reportId + " · delivered "
          + accountDate(entry.assessment.deliveredAt)
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Assessment job",
        entry.assessment.jobId
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Build credit",
        customBuildMoney(entry.credit.amountMinor) + " · "
          + accountWords(entry.credit.state)
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Credit deadline",
        accountDate(entry.credit.acceptanceCutoff)
      );
      card.appendChild(sourceFacts);
      if (entry.currentQuote) {
        if (entry.currentQuote.state !== "voided") {
          issueDrafts.delete(entry.assessment.jobId);
        } else {
          voidDrafts.delete(entry.currentQuote.quoteId);
        }
        card.appendChild(renderQuote(entry, busy));
      }
      if (
        (!entry.currentQuote
          || entry.currentQuote.state === "voided")
        && ["available", "released"].includes(entry.credit.state)
      ) {
        card.appendChild(renderIssueForm(entry, busy));
      } else if (!entry.currentQuote) {
        card.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "A new quote cannot be issued while this credit is "
              + accountWords(entry.credit.state) + "."
          )
        );
      }
      return card;
    }

    function render(readState) {
      var read = readState || {};
      body.replaceChildren();
      if (["idle", "unavailable"].includes(read.phase)) {
        panel.hidden = true;
        return;
      }
      panel.hidden = false;
      refresh.disabled = read.phase === "loading"
        || Boolean(read.busyKey);
      if (read.phase === "loading") {
        status.textContent = "Loading delivered assessment opportunities…";
        return;
      }
      if (read.phase === "error") {
        status.textContent = read.error
          || "Custom build opportunities could not be loaded.";
        return;
      }
      var queue = verifiedOwnerCustomBuildOpportunities(
        read.opportunities
      );
      if (!queue) {
        status.textContent =
          "The Custom build opportunity response could not be verified. No owner action is available.";
        return;
      }
      status.textContent = read.busyKey
        ? "Saving one exact Custom build command…"
        : queue.opportunities.length === 0
          ? "No delivered assessment is waiting for a Custom build quote."
          : queue.opportunities.length + " delivered assessment "
            + (queue.opportunities.length === 1
              ? "opportunity"
              : "opportunities") + " ready.";
      if (read.error) {
        body.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-owner-quote-form-error",
            read.error
          )
        );
      }
      queue.opportunities.forEach(function (entry) {
        body.appendChild(renderOpportunity(
          entry,
          Boolean(read.busyKey)
        ));
      });
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        status.focus();
      },
      render: render
    });
  }

  function createOwnerCustomBuildWorkPanel(documentRef, actions) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-owner-quote-desk customer-owner-custom-build"
    );
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "owner-custom-build-work-title");
    panel.setAttribute("data-owner-custom-build-work", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Paid Custom website jobs"
    );
    heading.id = "owner-custom-build-work-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-owner-quote-status customer-owner-custom-build-status"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var refresh = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Refresh paid build jobs"
    );
    refresh.type = "button";
    refresh.addEventListener("click", function () {
      if (typeof actions.refresh === "function") actions.refresh();
    });
    var nextCursor = "";
    var nextPage = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Open next paid jobs"
    );
    nextPage.type = "button";
    nextPage.hidden = true;
    nextPage.addEventListener("click", function () {
      if (nextCursor && typeof actions.next === "function") {
        actions.next(nextCursor);
      }
    });
    var body = accountElement(
      documentRef,
      "div",
      "customer-owner-quote-body customer-owner-custom-build-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Private Site Sourcery tools"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "Nothing on this screen changes the job's paid scope or billing facts. The controls only append one customer-safe update or manage one active request."
      ),
      status,
      refresh,
      body,
      nextPage
    );

    function remainingChoices(order, selected, labels) {
      var start = Math.max(0, order.indexOf(selected));
      return order.slice(start).map(function (value) {
        return [value, labels[value]];
      });
    }

    function renderProgressForm(entry, snapshot, busy) {
      var details = accountElement(
        documentRef,
        "details",
        "customer-custom-build-owner-control"
      );
      details.appendChild(
        accountElement(
          documentRef,
          "summary",
          "customer-owner-assessment-job-summary",
          "Post a progress update"
        )
      );
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-progress-form"
      );
      form.setAttribute("data-owner-progress-form", entry.job.jobId);
      var stage = assessmentSelect(
        documentRef,
        "stage",
        "Customer-facing stage",
        snapshot.progress.stage,
        remainingChoices(
          ["preparing", "building", "checking"],
          snapshot.progress.stage,
          CUSTOM_BUILD_PROGRESS_STAGES
        )
      );
      var milestoneFields = {};
      var milestoneLabels = {
        pending: "Not started",
        in_progress: "In progress",
        done: "Complete"
      };
      snapshot.progress.milestones.forEach(function (milestone) {
        milestoneFields[milestone.key] = assessmentSelect(
          documentRef,
          "milestone-" + milestone.key,
          milestone.label,
          milestone.state,
          remainingChoices(
            ["pending", "in_progress", "done"],
            milestone.state,
            milestoneLabels
          )
        );
      });
      var summary = assessmentField(
        documentRef,
        "customerSummary",
        "Safe customer summary",
        snapshot.progress.summary,
        {
          required: true,
          minimumLength: 10,
          maximum: 500,
          multiline: true
        }
      );
      var nextStep = assessmentField(
        documentRef,
        "nextStep",
        "Next step",
        snapshot.progress.nextStep,
        {
          required: true,
          minimumLength: 5,
          maximum: 500,
          multiline: true
        }
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Saving update…" : "Post progress update"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        stage,
        milestoneFields.structure,
        milestoneFields.content,
        milestoneFields.responsive,
        milestoneFields.quality,
        summary,
        nextStep,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "Keep this customer-safe. Do not include passwords, verification codes, API keys, tokens, or raw credentials."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var data = new FormData(form);
        if (typeof actions.progress === "function") {
          actions.progress(entry, snapshot, {
            customerSummary: text(data.get("customerSummary")),
            milestones: {
              content: text(data.get("milestone-content")),
              quality: text(data.get("milestone-quality")),
              responsive: text(data.get("milestone-responsive")),
              structure: text(data.get("milestone-structure"))
            },
            nextStep: text(data.get("nextStep")),
            stage: text(data.get("stage"))
          });
        }
      });
      details.appendChild(form);
      return details;
    }

    function renderOpenRequestForm(entry, snapshot, busy) {
      var details = accountElement(
        documentRef,
        "details",
        "customer-custom-build-owner-control"
      );
      details.appendChild(
        accountElement(
          documentRef,
          "summary",
          "customer-owner-assessment-job-summary",
          "Open one customer request"
        )
      );
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-request-form"
      );
      form.setAttribute("data-owner-request-form", entry.job.jobId);
      var kind = assessmentSelect(
        documentRef,
        "requestKind",
        "Request type",
        "customer_content",
        [
          ["customer_content", "Customer content"],
          ["customer_decision", "Customer decision"],
          ["delegated_access", "Delegated provider access"],
          ["outside_dependency", "Outside dependency"]
        ]
      );
      var kindSelect = kind.querySelector("select");
      var title = assessmentField(
        documentRef,
        "title",
        "Short request title",
        "",
        { required: true, minimumLength: 5, maximum: 120 }
      );
      var message = assessmentField(
        documentRef,
        "customerMessage",
        "Customer message",
        "",
        {
          required: true,
          minimumLength: 10,
          maximum: 1000,
          multiline: true
        }
      );
      var instructions = assessmentField(
        documentRef,
        "safeInstructions",
        "Safe instructions",
        "",
        {
          required: true,
          minimumLength: 10,
          maximum: 1000,
          multiline: true
        }
      );
      var impact = assessmentSelect(
        documentRef,
        "targetDateImpact",
        "Target completion date",
        "none",
        [
          ["none", "No change"],
          ["under_review", "Under review"]
        ]
      );
      var impactSelect = impact.querySelector("select");
      var accessFields = accountElement(
        documentRef,
        "fieldset",
        "customer-custom-build-access-fields"
      );
      accessFields.appendChild(
        accountElement(
          documentRef,
          "legend",
          "",
          "Safe delegated-access labels"
        )
      );
      var provider = assessmentField(
        documentRef,
        "providerLabel",
        "Provider",
        "",
        { required: true, maximum: 254 }
      );
      var account = assessmentField(
        documentRef,
        "accountLabel",
        "Account or user label",
        "",
        { required: true, maximum: 254 }
      );
      var role = assessmentField(
        documentRef,
        "delegatedRole",
        "Requested delegated role",
        "",
        { required: true, maximum: 254 }
      );
      var expires = assessmentField(
        documentRef,
        "accessExpiresAt",
        "Sharing window ends",
        customBuildLocalDateTime(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
        { required: true, type: "datetime-local" }
      );
      var expiresInput = expires.querySelector("input");
      expiresInput.min = customBuildLocalDateTime(
        Date.now() + 5 * 60 * 1000
      );
      expiresInput.max = customBuildLocalDateTime(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      );
      accessFields.append(
        provider,
        account,
        role,
        expires,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "Ask the customer to use the provider's own delegated-user controls. Never request or store a password, verification code, API key, token, or raw credential."
        )
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Opening request…" : "Open customer request"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        kind,
        title,
        message,
        instructions,
        impact,
        accessFields,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "All request copy must be customer-safe and contain no credentials."
        ),
        submit
      );

      function syncRequestKind() {
        var delegated = kindSelect.value === "delegated_access";
        accessFields.hidden = !delegated;
        Array.prototype.forEach.call(
          accessFields.querySelectorAll("input"),
          function (field) {
            field.disabled = !delegated;
          }
        );
        if (kindSelect.value === "outside_dependency") {
          impactSelect.value = "under_review";
          impactSelect.disabled = true;
        } else {
          impactSelect.disabled = false;
        }
      }
      kindSelect.addEventListener("change", syncRequestKind);
      syncRequestKind();
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        syncRequestKind();
        if (busy || !form.reportValidity()) return;
        var data = new FormData(form);
        var requestKind = kindSelect.value;
        var access = null;
        if (requestKind === "delegated_access") {
          var expiresAt = new Date(expiresInput.value);
          if (!Number.isFinite(expiresAt.getTime())) return;
          access = {
            accountLabel: text(data.get("accountLabel")),
            delegatedRole: text(data.get("delegatedRole")),
            expiresAt: expiresAt.toISOString(),
            providerLabel: text(data.get("providerLabel"))
          };
        }
        if (typeof actions.request === "function") {
          actions.request(entry, snapshot, {
            access: access,
            customerMessage: text(data.get("customerMessage")),
            requestKind: requestKind,
            safeInstructions: text(data.get("safeInstructions")),
            targetDateImpact: requestKind === "outside_dependency"
              ? "under_review"
              : impactSelect.value,
            title: text(data.get("title"))
          });
        }
      });
      details.appendChild(form);
      return details;
    }

    function renderActiveRequest(entry, snapshot, busy) {
      var request = snapshot.activeRequest;
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-request"
      );
      section.setAttribute("data-owner-active-request", request.requestId);
      section.append(
        accountElement(documentRef, "h6", "", request.title),
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-progress-copy",
          request.message
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          request.safeInstructions
        )
      );
      var facts = accountElement(documentRef, "dl", "");
      appendAccountFact(
        documentRef,
        facts,
        "Request type",
        accountWords(request.kind)
      );
      appendAccountFact(
        documentRef,
        facts,
        "State",
        request.state === "answered" ? "Response received" : "Open"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Target date",
        request.targetDateImpact === "under_review"
          ? "Under review"
          : "No change"
      );
      if (request.response) {
        appendAccountFact(
          documentRef,
          facts,
          "Customer response",
          request.response.note
        );
      }
      if (request.access) {
        appendAccountFact(
          documentRef,
          facts,
          "Delegated access",
          request.access.providerLabel + " · "
            + request.access.accountLabel + " · "
            + request.access.delegatedRole
        );
      }
      section.append(
        facts,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          request.access
            ? "A customer response does not verify provider access. Check it separately before resolving this request."
            : "Review the customer response or outside dependency before closing this request."
        )
      );
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-resolution-form"
      );
      form.setAttribute("data-owner-resolution-form", request.requestId);
      var state = assessmentSelect(
        documentRef,
        "resolutionState",
        "Close request as",
        "resolved",
        [
          ["resolved", "Resolved after review"],
          ["withdrawn", "Withdrawn"]
        ]
      );
      var note = assessmentField(
        documentRef,
        "resolutionNote",
        "Safe resolution note",
        "",
        {
          required: true,
          minimumLength: 5,
          maximum: 500,
          multiline: true
        }
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button",
        busy ? "Closing request…" : "Close this request"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(state, note, submit);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var data = new FormData(form);
        if (typeof actions.resolve === "function") {
          actions.resolve(entry, snapshot, {
            resolutionNote: text(data.get("resolutionNote")),
            state: text(data.get("resolutionState"))
          });
        }
      });
      section.appendChild(form);
      return section;
    }

    function renderJobProgress(entry, read, globallyBusy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-progress"
      );
      section.setAttribute("data-owner-job-progress", entry.job.jobId);
      var progressStatus = accountElement(
        documentRef,
        "p",
        "customer-assessment-status customer-custom-build-progress-status"
      );
      progressStatus.setAttribute("role", "status");
      progressStatus.setAttribute("aria-live", "polite");
      var refreshProgress = accountElement(
        documentRef,
        "button",
        "spark-button",
        "Refresh this project's progress"
      );
      refreshProgress.type = "button";
      refreshProgress.disabled = Boolean(globallyBusy) || Boolean(
        read && (read.phase === "loading" || read.busy)
      );
      refreshProgress.addEventListener("click", function () {
        if (typeof actions.refreshProgress === "function") {
          actions.refreshProgress(entry);
        }
      });
      section.append(
        accountElement(documentRef, "h5", "", "Project progress"),
        progressStatus,
        refreshProgress
      );
      if (!read || read.phase === "loading") {
        progressStatus.textContent = "Loading this paid project's progress…";
        return section;
      }
      if (read.phase === "error") {
        progressStatus.textContent = read.error
          || "Progress changed or could not be loaded. Refresh this project before trying again.";
        return section;
      }
      var snapshot = verifiedCustomBuildProgress(
        read.snapshot,
        entry.job.jobId
      );
      if (!snapshot || snapshot.state !== "active") {
        progressStatus.textContent =
          "This paid project's progress response could not be verified. Refresh before making a change.";
        return section;
      }
      var busy = Boolean(read.busy) || Boolean(globallyBusy);
      progressStatus.textContent = read.busy
        ? "Saving one bounded project command…"
        : snapshot.status.label;
      if (read.error) {
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-owner-quote-form-error",
            read.error
          )
        );
      }
      section.append(
        customBuildProgressSummary(documentRef, snapshot),
        renderProgressForm(entry, snapshot, busy)
      );
      if (snapshot.activeRequest) {
        section.appendChild(
          renderActiveRequest(entry, snapshot, busy)
        );
      } else {
        section.appendChild(
          renderOpenRequestForm(entry, snapshot, busy)
        );
      }
      return section;
    }

    function ownerCompletionProgressReady(read) {
      var snapshot = read && verifiedCustomBuildProgress(
        read.snapshot
      );
      return Boolean(snapshot)
        && snapshot.state === "active"
        && snapshot.progress.stage === "checking"
        && snapshot.activeRequest === null
        && snapshot.progress.milestones.every(function (milestone) {
          return milestone.state === "done";
        });
    }

    function renderOwnerChangeOrder(entry, order, busy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-change"
      );
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-custom-build-change-facts"
      );
      appendAccountFact(documentRef, facts, "State", accountWords(order.state));
      appendAccountFact(documentRef, facts, "Added scope", order.addedScope);
      appendAccountFact(
        documentRef,
        facts,
        "Units",
        String(order.pricing.unitCount) + " × $125"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Server subtotal",
        customBuildMoney(order.pricing.subtotalMinor) + " USD"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        "Automatic calculation pending"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Target completion",
        order.targetCompletionDate
      );
      appendAccountFact(
        documentRef,
        facts,
        "Expires",
        accountDate(order.expiresAt)
      );
      section.append(
        accountElement(
          documentRef,
          "h6",
          "",
          "Active added-work change " + order.changeNumber
        ),
        facts,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          order.state === "accepted_payment_required"
            ? "Accepted added work remains paused until its payment is confirmed."
            : "Added work remains separate from the original scope and cannot begin before customer acceptance and confirmed payment."
        )
      );
      if (
        order.state === "issued"
        && Date.parse(order.expiresAt) <= Date.now()
      ) {
        var expire = accountElement(
          documentRef,
          "button",
          "spark-button customer-custom-build-change-expire",
          busy ? "Recording expiration…" : "Record this change as expired"
        );
        expire.type = "button";
        expire.disabled = busy;
        expire.setAttribute("data-owner-change-order-expire", "");
        expire.addEventListener("click", function () {
          if (typeof actions.expireChange === "function") {
            actions.expireChange(entry, order);
          }
        });
        section.append(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "The recorded review deadline has passed. Expiring it confirms that no added work became effective and does not alter the original scope."
          ),
          expire
        );
      }
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-change-void-form"
      );
      form.setAttribute("data-owner-change-order-void", order.state);
      var reason = assessmentField(
        documentRef,
        "changeVoidReason",
        "Bounded reason for voiding this change",
        "",
        {
          required: true,
          minimumLength: 20,
          maximum: 500,
          multiline: true,
          placeholder:
            "Explain why this exact added-work change is being withdrawn or replaced."
        }
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button",
        busy ? "Voiding exact change…" : "Void this exact change"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        reason,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "The retained server quote digest identifies the exact change. This control cannot alter money, tax, credit, or the original scope."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        if (typeof actions.voidChange === "function") {
          var data = new FormData(form);
          actions.voidChange(entry, order, {
            reason: text(data.get("changeVoidReason"))
          });
        }
      });
      section.appendChild(form);
      return section;
    }

    function renderOwnerChangeIssue(entry, snapshot, busy) {
      var details = accountElement(
        documentRef,
        "details",
        "customer-custom-build-owner-control"
      );
      details.appendChild(accountElement(
        documentRef,
        "summary",
        "customer-owner-assessment-job-summary",
        "Issue one added-work change"
      ));
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-change-issue-form"
      );
      form.setAttribute("data-owner-change-order-form", entry.job.jobId);
      var addedScope = assessmentField(
        documentRef,
        "addedScope",
        "Added scope only",
        "",
        {
          required: true,
          minimumLength: 20,
          maximum: 2000,
          multiline: true,
          placeholder:
            "Describe only the work being added; do not rewrite the accepted base scope."
        }
      );
      var units = assessmentField(
        documentRef,
        "unitCount",
        "Added-work units",
        "1",
        {
          required: true,
          type: "number",
          minimumValue: 1,
          maximumValue: 40,
          step: 1
        }
      );
      var target = assessmentField(
        documentRef,
        "changeTargetCompletionDate",
        "Updated target completion date",
        entry.job.targetCompletionDate,
        { required: true, type: "date" }
      );
      var targetInput = target.querySelector("input");
      targetInput.min = entry.job.targetCompletionDate;
      targetInput.max = customBuildFutureDate(730);
      var defaultExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
      var expiry = assessmentField(
        documentRef,
        "changeExpiresAt",
        "Customer review window ends",
        customBuildLocalDateTime(defaultExpiry),
        { required: true, type: "datetime-local" }
      );
      var expiryInput = expiry.querySelector("input");
      expiryInput.min = customBuildLocalDateTime(
        Date.now() + 5 * 60 * 1000
      );
      expiryInput.max = customBuildLocalDateTime(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      );
      var preview = accountElement(
        documentRef,
        "p",
        "customer-custom-build-change-preview"
      );
      function updatePreview() {
        var count = Number(units.querySelector("input").value);
        preview.textContent = Number.isInteger(count)
          && count >= 1
          && count <= 40
          ? count + " × $125 = "
            + customBuildMoney(count * CUSTOM_BUILD_CHANGE_UNIT_MINOR)
            + " USD before tax. The database derives the authoritative subtotal."
          : "Choose between 1 and 40 added-work units.";
      }
      units.querySelector("input").addEventListener("input", updatePreview);
      updatePreview();
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Issuing exact change…" : "Issue exact added-work change"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        addedScope,
        units,
        target,
        expiry,
        preview,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "Keep the added scope customer-safe. Do not include passwords, verification codes, API keys, tokens, or raw credentials."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var data = new FormData(form);
        var expiresAt = new Date(expiryInput.value);
        if (!Number.isFinite(expiresAt.getTime())) return;
        if (typeof actions.issueChange === "function") {
          actions.issueChange(entry, snapshot, {
            addedScope: text(data.get("addedScope")),
            expiresAt: expiresAt.toISOString(),
            targetCompletionDate: text(
              data.get("changeTargetCompletionDate")
            ),
            unitCount: Number(data.get("unitCount"))
          });
        }
      });
      details.appendChild(form);
      return details;
    }

    function renderOwnerCompletionEvidence(entry, snapshot, busy) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-evidence"
      );
      section.appendChild(accountElement(
        documentRef,
        "h6",
        "",
        "Desktop and phone completion evidence"
      ));
      if (snapshot.evidence.length) {
        var list = accountElement(
          documentRef,
          "ul",
          "customer-custom-build-owner-evidence-list"
        );
        snapshot.evidence.forEach(function (entryEvidence) {
          var current = snapshot.proofBinding
            && entryEvidence.progressRevision ===
              snapshot.proofBinding.progressRevision
            && entryEvidence.effectiveScopeDigest ===
              snapshot.proofBinding.effectiveScopeDigest;
          list.appendChild(accountElement(
            documentRef,
            "li",
            "",
            (current ? "Current proof · " : "Older proof · ")
              + accountWords(entryEvidence.viewport) + " · "
              + entryEvidence.accessibleDescription + " · "
              + (customBuildEvidenceDimensions(entryEvidence)
                ? customBuildEvidenceDimensions(entryEvidence) + " · "
                : "")
              + accountDate(entryEvidence.capturedAt)
          ));
        });
        section.appendChild(list);
      }
      if (snapshot.completion) return section;
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-evidence-form"
      );
      form.setAttribute("data-owner-completion-evidence-form", entry.job.jobId);
      var file = assessmentField(
        documentRef,
        "completionEvidenceFile",
        "JPEG, PNG, or WebP proof",
        "",
        { required: true, type: "file" }
      );
      var fileInput = file.querySelector("input");
      fileInput.accept = "image/jpeg,image/png,image/webp";
      var viewport = assessmentSelect(
        documentRef,
        "completionEvidenceViewport",
        "Viewport",
        "desktop",
        [["desktop", "Desktop"], ["phone", "Phone"]]
      );
      var description = assessmentField(
        documentRef,
        "completionEvidenceDescription",
        "Safe evidence description",
        "",
        {
          required: true,
          minimumLength: 10,
          maximum: 500,
          multiline: true,
          placeholder:
            "Describe the customer-visible screen and what it proves."
        }
      );
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button",
        busy ? "Uploading proof…" : "Upload completion proof"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        file,
        viewport,
        description,
        accountElement(
          documentRef,
          "p",
          "customer-custom-build-credential-warning",
          "Upload only customer-visible proof. Never include passwords, codes, keys, tokens, private dashboards, or raw credentials."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var selectedFile = fileInput.files && fileInput.files[0];
        submit.disabled = true;
        submit.textContent = "Preparing proof…";
        prepareCustomBuildCompletionEvidenceFile(selectedFile)
          .then(function (prepared) {
            if (typeof actions.evidence === "function") {
              var data = new FormData(form);
              return actions.evidence(entry, snapshot, {
                accessibleDescription: text(
                  data.get("completionEvidenceDescription")
                ),
                dataBase64: prepared.dataBase64,
                mediaType: prepared.mediaType,
                viewport: text(data.get("completionEvidenceViewport"))
              });
            }
            return null;
          })
          .catch(function (error) {
            if (typeof actions.localError === "function") {
              actions.localError(entry, error);
            }
          })
          .finally(function () {
            if (submit.isConnected) {
              submit.disabled = busy;
              submit.textContent = "Upload completion proof";
            }
          });
      });
      section.appendChild(form);
      return section;
    }

    function renderOwnerCompletionForm(
      entry,
      snapshot,
      progressRead,
      busy
    ) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-completion"
      );
      section.setAttribute("data-owner-completion-control", entry.job.jobId);
      if (snapshot.completion) {
        var selected = new Map(snapshot.evidence.map(function (entryEvidence) {
          return [entryEvidence.evidenceId, entryEvidence];
        }));
        var proof = accountElement(
          documentRef,
          "ul",
          "customer-custom-build-owner-evidence-list"
        );
        snapshot.completion.evidenceIds.forEach(function (id) {
          var evidence = selected.get(id);
          if (evidence) {
            proof.appendChild(accountElement(
              documentRef,
              "li",
              "",
              accountWords(evidence.viewport) + " · "
                + evidence.accessibleDescription
                + (customBuildEvidenceDimensions(evidence)
                  ? " · " + customBuildEvidenceDimensions(evidence)
                  : "")
            ));
          }
        });
        section.append(
          accountElement(documentRef, "h6", "", "Completion prepared"),
          accountElement(
            documentRef,
            "p",
            "customer-custom-build-progress-copy",
            snapshot.completion.customerSummary
          ),
          proof,
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Completion proof is immutable. It is not payment, delivery, launch, handoff, or the start of the 30-day workmanship-correction clock."
          )
        );
        return section;
      }
      var progressReady = ownerCompletionProgressReady(progressRead);
      var eligibleEvidence = currentOwnerCustomBuildCompletionEvidence(
        snapshot,
        progressRead
      );
      var hasActiveChange = snapshot.changeOrders.some(function (order) {
        return ["issued", "accepted_payment_required"].includes(order.state);
      });
      var hasDesktop = eligibleEvidence.some(function (entryEvidence) {
        return entryEvidence.viewport === "desktop";
      });
      var hasPhone = eligibleEvidence.some(function (entryEvidence) {
        return entryEvidence.viewport === "phone";
      });
      var hasDistinctViewportProof = eligibleEvidence.some(function (desktop) {
        return desktop.viewport === "desktop"
          && eligibleEvidence.some(function (phone) {
            return phone.viewport === "phone"
              && phone.contentDigest !== desktop.contentDigest;
          });
      });
      var eligible = progressReady
        && !hasActiveChange
        && hasDesktop
        && hasPhone
        && hasDistinctViewportProof
        && eligibleEvidence.length >= 2;
      section.appendChild(accountElement(
        documentRef,
        "h6",
        "",
        "Prepare immutable completion proof"
      ));
      if (!eligible) {
        section.appendChild(accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          hasActiveChange
            ? "Resolve the active added-work change before preparing completion."
            : !progressReady
              ? "Completion requires Checking the work, all four milestones complete, and no active customer request."
              : "Upload current, distinct desktop and phone proof before preparing completion."
        ));
        return section;
      }
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form customer-custom-build-completion-form"
      );
      form.setAttribute("data-owner-completion-form", entry.job.jobId);
      var evidenceChoices = accountElement(
        documentRef,
        "fieldset",
        "customer-custom-build-completion-evidence-choices"
      );
      evidenceChoices.appendChild(accountElement(
        documentRef,
        "legend",
        "",
        "Canonical customer proof"
      ));
      eligibleEvidence.forEach(function (entryEvidence) {
        var label = accountElement(
          documentRef,
          "label",
          "customer-assessment-authority"
        );
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.name = "completionEvidenceId";
        checkbox.value = entryEvidence.evidenceId;
        label.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            accountWords(entryEvidence.viewport) + " · "
              + entryEvidence.accessibleDescription
          )
        );
        evidenceChoices.appendChild(label);
      });
      var summary = assessmentField(
        documentRef,
        "completionCustomerSummary",
        "Customer completion summary",
        "",
        {
          required: true,
          minimumLength: 20,
          maximum: 1000,
          multiline: true,
          placeholder:
            "Summarize the approved work and the completed customer-visible checks."
        }
      );
      var confirmations = accountElement(
        documentRef,
        "fieldset",
        "customer-custom-build-completion-confirmations"
      );
      confirmations.appendChild(accountElement(
        documentRef,
        "legend",
        "",
        "Confirm every completed check"
      ));
      CUSTOM_BUILD_COMPLETION_CHECKS.forEach(function (entryCheck) {
        var label = accountElement(
          documentRef,
          "label",
          "customer-assessment-authority"
        );
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.name = "completionCheck" + entryCheck[0];
        checkbox.required = true;
        label.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            entryCheck[1] + " passed"
          )
        );
        confirmations.appendChild(label);
      });
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        busy ? "Preparing completion…" : "Prepare exact completion proof"
      );
      submit.type = "submit";
      submit.disabled = busy;
      form.append(
        evidenceChoices,
        summary,
        confirmations,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "This records proof only. It cannot claim payment, delivery, launch, handoff, job completion, or start the 30-day clock."
        ),
        submit
      );
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        var selectedIds = Array.prototype.map.call(
          form.querySelectorAll(
            'input[name="completionEvidenceId"]:checked'
          ),
          function (field) { return field.value; }
        ).sort();
        var selectedEvidence = eligibleEvidence.filter(function (entryEvidence) {
          return selectedIds.includes(entryEvidence.evidenceId);
        });
        if (
          selectedIds.length < 2
          || selectedIds.length > 12
          || !["desktop", "phone"].every(function (viewportValue) {
            return selectedEvidence.some(function (entryEvidence) {
              return entryEvidence.viewport === viewportValue;
            });
          })
          || selectedEvidence.some(function (desktop) {
            return desktop.viewport === "desktop"
              && selectedEvidence.some(function (phone) {
                return phone.viewport === "phone"
                  && phone.contentDigest === desktop.contentDigest;
              });
          })
        ) return;
        if (typeof actions.complete === "function") {
          var data = new FormData(form);
          actions.complete(entry, snapshot, {
            checks: {
              accessibilityBasics: true,
              contactActions: true,
              desktop: true,
              links: true,
              phone: true,
              scope: true
            },
            customerSummary: text(data.get("completionCustomerSummary")),
            evidenceIds: selectedIds
          });
        }
      });
      section.appendChild(form);
      return section;
    }

    function renderOwnerChangePayments(
      entry,
      read,
      changeCompletion,
      globallyBusy
    ) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-change customer-custom-build-owner-change-payments"
      );
      section.setAttribute(
        "data-owner-custom-build-change-payments",
        entry.job.jobId
      );
      var status = accountElement(
        documentRef,
        "p",
        "customer-assessment-status customer-custom-build-change-payment-status"
      );
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("tabindex", "-1");
      var refresh = accountElement(
        documentRef,
        "button",
        "spark-button",
        "Refresh added-work payments"
      );
      refresh.type = "button";
      refresh.setAttribute(
        "data-owner-custom-build-change-payments-refresh",
        ""
      );
      refresh.disabled = Boolean(globallyBusy)
        || Boolean(read && (read.phase === "loading" || read.busy));
      refresh.addEventListener("click", function () {
        if (typeof actions.refreshChangePayments === "function") {
          actions.refreshChangePayments(entry);
        }
      });
      section.append(
        accountElement(documentRef, "h6", "", "Added-work payments"),
        status,
        refresh
      );
      var snapshot = changeCompletion
        && read
        && verifiedOwnerCustomBuildChangePayments(
          read.snapshot,
          entry,
          changeCompletion
        );
      if (!snapshot) {
        status.textContent = read && read.phase === "error"
          ? read.error
            || "Added-work payment records could not be verified."
          : "Loading exact added-work payment records…";
        return section;
      }
      if (read.phase === "loading") {
        status.textContent =
          "Refreshing exact payment records. The last verified records remain below.";
      } else if (read.busy) {
        status.textContent =
          "Reconciling one exact Stripe payment result…";
      } else if (read.notice) {
        status.textContent = read.notice;
      } else {
        status.textContent = snapshot.payments.length
          ? snapshot.payments.length + " exact added-work payment record"
            + (snapshot.payments.length === 1 ? " is" : "s are")
            + " retained."
          : "No accepted-change payment invoice is retained for this project.";
      }
      if (read.error) {
        section.appendChild(accountElement(
          documentRef,
          "p",
          "customer-owner-quote-form-error",
          read.error
        ));
      }
      snapshot.payments.forEach(function (payment) {
        var invoice = payment.invoice;
        var owner = payment.owner;
        var line = invoice.lines[0];
        var card = accountElement(
          documentRef,
          "section",
          "customer-custom-build-change-card customer-custom-build-owner-change-payment"
        );
        card.setAttribute(
          "data-owner-custom-build-change-payment",
          payment.state
        );
        var facts = accountElement(
          documentRef,
          "dl",
          "customer-custom-build-change-facts"
        );
        appendAccountFact(
          documentRef,
          facts,
          "Invoice",
          invoice.invoiceNumber
        );
        appendAccountFact(
          documentRef,
          facts,
          "Added work",
          line.quantity + " × $125.00"
        );
        appendAccountFact(
          documentRef,
          facts,
          "Subtotal",
          customBuildMoney(invoice.subtotal.amountMinor) + " USD"
        );
        appendAccountFact(
          documentRef,
          facts,
          "Invoice state",
          accountWords(payment.state)
        );
        appendAccountFact(
          documentRef,
          facts,
          "Stripe effect certainty",
          owner.providerEffectCertainty === null
            ? "No payment-page attempt"
            : accountWords(owner.providerEffectCertainty)
        );
        appendAccountFact(
          documentRef,
          facts,
          "Receipt source",
          owner.receiptSource === null
            ? "No verified payment receipt"
            : owner.receiptSource === "stripe_event"
              ? "Verified Stripe event"
              : "Verified Stripe readback"
        );
        card.append(
          accountElement(
            documentRef,
            "h6",
            "",
            "Added-work change " + invoice.changeNumber
          ),
          facts
        );
        var note = {
          checkout_available:
            "The customer may request one exact Stripe payment page.",
          checkout_ready:
            "The customer’s retained Stripe payment page is ready. This owner control cannot mark it paid.",
          checkout_expired:
            "The retained Stripe payment page is expired. A fresh customer command is required.",
          payment_held:
            "Payment-page creation is held. No owner action can mark this invoice paid.",
          reconciliation_required:
            "The Stripe result is uncertain. Reconcile the retained provider evidence before any retry.",
          paid:
            "Provider-confirmed payment is retained and the accepted added work is effective.",
          voided:
            "The invoice is voided and no payment action is available."
        }[payment.state];
        card.appendChild(accountElement(
          documentRef,
          "p",
          payment.state === "reconciliation_required"
            ? "customer-custom-build-credential-warning"
            : "customer-assessment-note",
          note
        ));
        if (
          owner.canReconcileCreation
          || owner.canReconcileSettlement
        ) {
          var reconcile = accountElement(
            documentRef,
            "button",
            "spark-button spark-button-primary",
            read.busy
              ? "Reconciling exact Stripe result…"
              : owner.canReconcileSettlement
                ? "Verify retained Stripe payment"
                : "Reconcile uncertain payment page"
          );
          reconcile.type = "button";
          reconcile.disabled = Boolean(globallyBusy) || Boolean(read.busy);
          reconcile.setAttribute(
            "data-owner-custom-build-change-payment-reconcile",
            owner.attemptId
          );
          reconcile.setAttribute(
            "data-owner-custom-build-change-payment-reconcile-kind",
            owner.canReconcileSettlement ? "settlement" : "creation"
          );
          reconcile.addEventListener("click", function () {
            if (
              !globallyBusy
              && !read.busy
              && typeof actions.reconcileChangePayment === "function"
            ) actions.reconcileChangePayment(entry, payment);
          });
          card.appendChild(reconcile);
        }
        section.appendChild(card);
      });
      return section;
    }

    function renderJobChangeCompletion(
      entry,
      read,
      paymentRead,
      progressRead,
      globallyBusy
    ) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-custom-build-owner-change-completion"
      );
      section.setAttribute("data-owner-job-change-completion", entry.job.jobId);
      var changeStatus = accountElement(
        documentRef,
        "p",
        "customer-assessment-status customer-custom-build-change-status"
      );
      changeStatus.setAttribute("role", "status");
      changeStatus.setAttribute("aria-live", "polite");
      var refreshChange = accountElement(
        documentRef,
        "button",
        "spark-button",
        "Refresh added work and completion"
      );
      refreshChange.type = "button";
      refreshChange.setAttribute("data-owner-change-completion-refresh", "");
      refreshChange.disabled = Boolean(globallyBusy)
        || Boolean(read && (read.phase === "loading" || read.busy));
      refreshChange.addEventListener("click", function () {
        if (typeof actions.refreshChangeCompletion === "function") {
          actions.refreshChangeCompletion(entry);
        }
      });
      section.append(
        accountElement(documentRef, "h5", "", "Added work and completion"),
        changeStatus,
        refreshChange
      );
      var snapshot = read && verifiedOwnerCustomBuildChangeCompletion(
        read.snapshot,
        entry
      );
      if (!snapshot) {
        changeStatus.textContent = read && read.phase === "error"
          ? read.error
            || "Added work and completion could not be verified."
          : "Loading this paid project's added work and completion…";
        return section;
      }
      var busy = Boolean(globallyBusy) || Boolean(read.busy);
      changeStatus.textContent = read.phase === "loading"
        ? "Refreshing this project. Last verified change and completion data remains below."
        : read.busy
          ? "Saving one exact change or completion command…"
          : {
              building: "No added-work decision is waiting.",
              change_order_review: "One added-work change is awaiting review.",
              change_order_payment_required:
                "One accepted change is awaiting confirmed payment.",
              ready_for_final_payment:
                "Completion proof is ready for final payment.",
              ready_for_delivery: "Completion proof is ready for delivery."
            }[snapshot.state];
      if (read.error) {
        section.appendChild(accountElement(
          documentRef,
          "p",
          "customer-owner-quote-form-error",
          read.error
        ));
      }
      section.appendChild(renderOwnerChangePayments(
        entry,
        paymentRead,
        snapshot,
        busy
      ));
      var active = snapshot.changeOrders.find(function (order) {
        return ["issued", "accepted_payment_required"].includes(order.state);
      });
      if (active) {
        section.appendChild(renderOwnerChangeOrder(entry, active, busy));
      } else if (!snapshot.completion) {
        section.appendChild(renderOwnerChangeIssue(entry, snapshot, busy));
      }
      snapshot.changeOrders.filter(function (order) {
        return order.state === "expired";
      }).forEach(function (order) {
        var expired = accountElement(
          documentRef,
          "section",
          "customer-custom-build-owner-change customer-custom-build-change-expired"
        );
        expired.setAttribute("data-owner-expired-change-order", "");
        expired.append(
          accountElement(
            documentRef,
            "h6",
            "",
            "Added-work change " + order.changeNumber + " · Expired"
          ),
          accountElement(
            documentRef,
            "p",
            "customer-custom-build-progress-copy",
            order.addedScope
          ),
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "The review window ended " + accountDate(order.expiresAt)
              + (order.expiredAt
                ? " and expiration was recorded "
                  + accountDate(order.expiredAt)
                : "")
              + ". No added work became effective, and the base scope remains unchanged."
          )
        );
        section.appendChild(expired);
      });
      section.appendChild(renderOwnerCompletionEvidence(
        entry,
        snapshot,
        busy
      ));
      section.appendChild(renderOwnerCompletionForm(
        entry,
        snapshot,
        progressRead,
        busy
      ));
      return section;
    }

    function renderJob(
      entry,
      progressRead,
      changeCompletionRead,
      changePaymentRead,
      globallyBusy
    ) {
      var card = accountElement(
        documentRef,
        "details",
        "customer-owner-quote-card customer-owner-custom-build-card"
      );
      card.setAttribute("data-paid-custom-build-job", entry.job.jobId);
      card.style.minWidth = "0";
      card.appendChild(
        accountElement(
          documentRef,
          "summary",
          "customer-owner-assessment-job-summary",
          entry.projectName + " · " + entry.customer.name
        )
      );
      var sourceFacts = accountElement(documentRef, "dl", "");
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Organization",
        entry.organizationName
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Customer",
        entry.customer.email
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Service case",
        entry.caseId
      );
      appendAccountFact(
        documentRef,
        sourceFacts,
        "Project ID",
        entry.projectId
      );
      card.append(
        sourceFacts,
        customBuildJobFacts(documentRef, entry.job, { owner: true }),
        renderJobProgress(entry, progressRead, globallyBusy),
        renderJobChangeCompletion(
          entry,
          changeCompletionRead,
          changePaymentRead,
          progressRead,
          globallyBusy
        )
      );
      body.appendChild(card);
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        if (typeof status.focus === "function") status.focus();
      },
      focusChangePaymentStatus: function (jobId) {
        var payment = body.querySelector(
          '[data-owner-custom-build-change-payments="'
            + text(jobId) + '"]'
        );
        var paymentStatus = payment && payment.querySelector(
          ".customer-custom-build-change-payment-status"
        );
        if (
          paymentStatus
          && typeof paymentStatus.focus === "function"
        ) paymentStatus.focus();
      },
      render: function (state) {
        var visible = Boolean(state && state.revealed === true);
        panel.hidden = !visible;
        body.replaceChildren();
        nextCursor = "";
        nextPage.hidden = true;
        if (!visible) return;
        var interfaceBusy = Boolean(state.busyKey);
        refresh.disabled = state.phase === "loading" || interfaceBusy;
        nextPage.disabled = state.phase === "loading" || interfaceBusy;
        panel.setAttribute(
          "aria-busy",
          String(state.phase === "loading" || interfaceBusy)
        );
        var jobs = verifiedOwnerCustomBuildJobs(state.jobs);
        if (!jobs) {
          status.textContent =
            "The paid Custom website job response could not be verified. No private job details are shown.";
          return;
        }
        var pageLabel = state.pageNumber > 1
          ? "Page " + state.pageNumber + " · "
          : "";
        if (state.phase === "loading") {
          status.textContent = state.loadingMore
            ? "Opening the next paid Custom website jobs…"
            : "Refreshing paid Custom website jobs…";
        } else if (state.phase === "error") {
          status.textContent = state.error
            || "Paid Custom website jobs could not be refreshed.";
        } else {
          status.textContent = jobs.jobs.length === 0
            ? "No paid Custom website jobs are open."
            : pageLabel + jobs.jobs.length + " paid Custom website job"
              + (jobs.jobs.length === 1 ? " is" : "s are")
              + " open"
              + (jobs.hasMore ? " on this page." : ".");
        }
        jobs.jobs.forEach(function (entry) {
          renderJob(
            entry,
            state.progressByJob
              && state.progressByJob[entry.job.jobId],
            state.changeCompletionByJob
              && state.changeCompletionByJob[entry.job.jobId],
            state.changePaymentsByJob
              && state.changePaymentsByJob[entry.job.jobId],
            interfaceBusy
          );
        });
        if (jobs.hasMore) {
          nextCursor = jobs.nextCursor;
          nextPage.hidden = false;
        }
      }
    });
  }

  function createAssessmentPanel(documentRef, actions) {
    actions = actions || {};
    var authorityField = "customerO" + "wnershipAffirmed";
    var panel = accountElement(
      documentRef,
      "section",
      "customer-custom-services"
    );
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "customer-assessment-title");
    panel.setAttribute("data-custom-services-assessment", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Website assessment"
    );
    heading.id = "customer-assessment-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-assessment-status",
      "Choose a project to request an assessment."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var body = accountElement(
      documentRef,
      "div",
      "customer-assessment-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Custom website help"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "Tell Site Sourcery about one public website. The bounded assessment is $200; larger sites receive a separately priced expanded assessment."
      ),
      status,
      body
    );

    function renderForm(request, busy) {
      var website = request.website || {};
      var facts = request.facts || {};
      var form = accountElement(
        documentRef,
        "form",
        "customer-assessment-form"
      );
      form.setAttribute("data-assessment-form", "");
      var fields = accountElement(
        documentRef,
        "div",
        "platform-fields"
      );
      fields.append(
        assessmentField(
          documentRef,
          "siteDisplayName",
          "Website name",
          website.displayName,
          { required: true, maximum: 120 }
        ),
        assessmentField(
          documentRef,
          "publicUrl",
          "Public website URL",
          website.publicUrl,
          {
            required: true,
            maximum: 2048,
            placeholder: "https://example.com/",
            type: "url"
          }
        ),
        assessmentField(
          documentRef,
          "businessName",
          "Business name (optional)",
          facts.businessName,
          { maximum: 120, autocomplete: "organization" }
        ),
        assessmentSelect(
          documentRef,
          "platformFamily",
          "Website platform",
          website.platformFamily || "unknown",
          [
            ["unknown", "I do not know"],
            ["wordpress", "WordPress"],
            ["shopify", "Shopify"],
            ["squarespace", "Squarespace"],
            ["wix", "Wix"],
            ["custom", "Custom"],
            ["other", "Another platform"]
          ]
        ),
        assessmentField(
          documentRef,
          "primaryGoal",
          "What should improve?",
          facts.primaryGoal,
          { required: true, maximum: 500, multiline: true }
        ),
        assessmentField(
          documentRef,
          "customerObservation",
          "What have you noticed? (optional)",
          facts.customerObservation,
          { maximum: 1000, multiline: true }
        ),
        assessmentSelect(
          documentRef,
          "approximatePublicSize",
          "Approximate public size",
          facts.approximatePublicSize || "one_to_ten",
          [
            ["one_to_ten", "1–10 public pages"],
            ["eleven_to_fifty", "11–50 public pages"],
            ["more_than_fifty", "More than 50 public pages"],
            ["application_or_unknown", "Application-like or unknown"]
          ]
        ),
        assessmentField(
          documentRef,
          "importantDate",
          "Important date (optional)",
          facts.importantDate,
          { type: "date", maximum: 10 }
        )
      );
      var complexity = accountElement(
        documentRef,
        "fieldset",
        "customer-assessment-complexity platform-field-wide"
      );
      complexity.appendChild(
        accountElement(
          documentRef,
          "legend",
          "",
          "Website features (choose any)"
        )
      );
      var selectedFlags = Array.isArray(facts.complexityFlags)
        ? facts.complexityFlags
        : [];
      [
        ["authenticated_area", "Membership or sign-in"],
        ["commerce", "Ecommerce"],
        ["forms", "Forms"],
        ["large_content_set", "Large content set"],
        ["multilingual", "Multiple languages"],
        ["regulated_content", "Regulated subject matter"],
        ["third_party_integrations", "Third-party integrations"],
        ["unknown_platform", "Unknown platform"]
      ].forEach(function (choice) {
        var label = accountElement(documentRef, "label", "");
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.name = "complexityFlags";
        checkbox.value = choice[0];
        checkbox.checked = selectedFlags.includes(choice[0]);
        label.append(
          checkbox,
          accountElement(documentRef, "span", "", choice[1])
        );
        complexity.appendChild(label);
      });
      fields.appendChild(complexity);
      var authority = accountElement(
        documentRef,
        "label",
        "customer-assessment-authority"
      );
      var authorityBox = accountElement(documentRef, "input", "");
      authorityBox.type = "checkbox";
      authorityBox.name = authorityField;
      authorityBox.checked = website[authorityField] === true;
      authority.append(
        authorityBox,
        accountElement(
          documentRef,
          "span",
          "",
          "I own this website or have authority to request work for it."
        )
      );
      var controls = accountElement(
        documentRef,
        "div",
        "platform-actions"
      );
      var save = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        request.state === "draft" ? "Save changes" : "Save assessment draft"
      );
      save.type = "submit";
      save.disabled = busy;
      controls.appendChild(save);
      form.append(fields, authority, controls);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (typeof actions.save !== "function") return;
        var data = new FormData(form);
        var saveInput = {
          approximatePublicSize: text(data.get("approximatePublicSize")),
          businessName: text(data.get("businessName")) || null,
          complexityFlags: data.getAll("complexityFlags").map(text).sort(),
          customerObservation: text(data.get("customerObservation")) || null,
          expectedDraftRevision:
            request.state === "draft" ? request.draftRevision : 0,
          importantDate: text(data.get("importantDate")) || null,
          platformFamily: text(data.get("platformFamily")) || null,
          primaryGoal: text(data.get("primaryGoal")),
          publicUrl: text(data.get("publicUrl")),
          siteDisplayName: text(data.get("siteDisplayName"))
        };
        saveInput[authorityField] = authorityBox.checked;
        actions.save(saveInput);
      });
      body.appendChild(form);
    }

    function renderQuote(quoteState, busy) {
      if (!quoteState || quoteState.state === "not_available") return;
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-quote customer-quote-review"
      );
      section.appendChild(
        accountElement(
          documentRef,
          "h4",
          "",
          quoteState.state === "accepted"
            ? "$200 assessment quote accepted"
            : "$200 assessment quote"
        )
      );
      var quote = quoteState.quote;
      var facts = accountElement(documentRef, "dl", "");
      appendAccountFact(documentRef, facts, "Price", "$200.00 USD");
      appendAccountFact(
        documentRef,
        facts,
        "Payment",
        "Separate invoice · paid in full before work"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Bound",
        "1 website · up to 5 targets · up to 10 findings"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Delivery",
        quote.dates.deliveryDate
      );
      appendAccountFact(
        documentRef,
        facts,
        "Quote expires",
        accountDate(quote.dates.expiresAt)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        "Shown by Stripe at secure checkout, if applicable"
      );
      section.appendChild(facts);
      if (quoteState.state === "review_required") {
        var acceptance = accountElement(
          documentRef,
          "label",
          "customer-assessment-authority"
        );
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        acceptance.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            "I accept this exact scope, $200 price, invoice timing, tax disclosure, expiration, and delivery date."
          )
        );
        var accept = accountElement(
          documentRef,
          "button",
          "spark-button spark-button-primary",
          "Accept $200 assessment quote"
        );
        accept.type = "button";
        accept.disabled = true;
        checkbox.addEventListener("change", function () {
          accept.disabled = busy || !checkbox.checked;
        });
        accept.addEventListener("click", function () {
          if (
            checkbox.checked
            && typeof actions.acceptQuote === "function"
          ) actions.acceptQuote(quoteState);
        });
        section.append(acceptance, accept);
      } else {
        section.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            quoteState.state === "accepted"
              ? "Accepted. The exact assessment invoice appears below; work does not begin before payment."
              : quoteState.actions.acceptQuote.message
          )
        );
      }
      body.appendChild(section);
    }

    function renderInvoice(invoiceState, busy) {
      if (!invoiceState || invoiceState.state === "not_available") return;
      var invoice = invoiceState.invoice;
      var checkoutAvailable =
        invoiceState.state === "checkout_available"
        && invoiceState.actions.checkout.available === true;
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-invoice customer-quote-review"
      );
      section.appendChild(
        accountElement(
          documentRef,
          "h4",
          "",
          "Assessment invoice · " + invoice.invoiceNumber
        )
      );
      var facts = accountElement(documentRef, "dl", "");
      appendAccountFact(documentRef, facts, "Assessment", "$200.00 USD");
      appendAccountFact(
        documentRef,
        facts,
        "Tax",
        invoiceState.state === "paid_job_open"
          ? "$" + (invoice.tax.amountMinor / 100).toFixed(2) + " USD"
          : "Shown by Stripe at secure checkout, if applicable"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Total",
        invoiceState.state === "paid_job_open"
          ? invoice.total.formatted + " USD"
          : "Shown by Stripe before payment"
      );
      var paymentLabel = checkoutAvailable
        ? "Secure checkout available"
        : invoiceState.state === "paid_job_open"
          ? "Paid and verified"
          : invoiceState.state === "payment_verifying"
            ? "Verifying payment"
            : invoiceState.state === "payment_attention"
              ? "Needs Site Sourcery review"
              : "Not open";
      appendAccountFact(
        documentRef,
        facts,
        "Payment",
        paymentLabel
      );
      if (invoiceState.job) {
        appendAccountFact(
          documentRef,
          facts,
          "Assessment work",
          "Open · delivery by " + invoiceState.job.deliveryDate
        );
      }
      var statusMessage = checkoutAvailable
        ? "Stripe will show tax, if applicable, and the exact total before you confirm payment. Work begins only after Site Sourcery verifies payment."
        : invoiceState.state === "paid_job_open"
          ? "Payment is verified. Your assessment is queued for delivery by "
            + invoiceState.job.deliveryDate + "."
          : invoiceState.state === "payment_verifying"
            ? "Payment verification is in progress. Do not pay again while Site Sourcery confirms it."
            : invoiceState.state === "payment_attention"
              ? "Payment needs Site Sourcery review. Do not submit another payment."
              : "Secure payment is not available yet, and nothing has been charged. When checkout opens, Stripe will show tax, if applicable, and the exact total before payment.";
      section.append(
        facts,
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          statusMessage
        )
      );
      if (checkoutAvailable) {
        var checkout = accountElement(
          documentRef,
          "button",
          "spark-button spark-button-primary customer-assessment-checkout",
          "Pay secure $200 assessment invoice"
        );
        checkout.type = "button";
        checkout.disabled = busy;
        checkout.addEventListener("click", function () {
          if (typeof actions.checkout === "function") {
            actions.checkout(invoiceState);
          }
        });
        section.appendChild(checkout);
      }
      body.appendChild(section);
    }

    function renderReport(reportState) {
      if (!reportState || reportState.state === "not_available") {
        return;
      }
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-invoice customer-assessment-report customer-quote-review"
      );
      section.setAttribute("data-assessment-report", reportState.state);
      if (reportState.state === "in_progress") {
        section.append(
          accountElement(
            documentRef,
            "h4",
            "",
            "Assessment in progress"
          ),
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Your paid assessment is being completed for delivery by "
              + reportState.job.deliveryDate
              + ". Draft findings stay private until the complete report is delivered."
          )
        );
        var progressFacts = accountElement(documentRef, "dl", "");
        appendAccountFact(
          documentRef,
          progressFacts,
          "Review targets",
          String(reportState.job.scope.reviewTargets.length)
        );
        appendAccountFact(
          documentRef,
          progressFacts,
          "Evidence coverage",
          "Desktop and phone for every target"
        );
        appendAccountFact(
          documentRef,
          progressFacts,
          "Findings",
          "Up to 10 in the delivered report"
        );
        var refreshReport = accountElement(
          documentRef,
          "button",
          "spark-button",
          "Check for delivered report"
        );
        refreshReport.type = "button";
        refreshReport.addEventListener("click", function () {
          if (typeof actions.retry === "function") actions.retry();
        });
        section.append(progressFacts, refreshReport);
        body.appendChild(section);
        return;
      }

      var report = reportState.report;
      section.append(
        accountElement(
          documentRef,
          "h4",
          "",
          "Delivered website assessment"
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          report.overallSummary
        )
      );
      var reportFacts = accountElement(documentRef, "dl", "");
      appendAccountFact(
        documentRef,
        reportFacts,
        "Delivered",
        accountDate(report.deliveredAt)
      );
      appendAccountFact(
        documentRef,
        reportFacts,
        "Bound scope",
        "1 website · " + report.scope.reviewTargets.length
          + " targets · " + report.findings.length + " findings"
      );
      appendAccountFact(
        documentRef,
        reportFacts,
        "Expanded assessment",
        "Separately quoted when a larger review is needed"
      );
      section.appendChild(reportFacts);

      var coverage = accountElement(
        documentRef,
        "section",
        "customer-assessment-report-coverage"
      );
      coverage.appendChild(
        accountElement(documentRef, "h5", "", "Desktop and phone evidence")
      );
      var coverageGrid = accountElement(
        documentRef,
        "div",
        "customer-assessment-evidence-grid"
      );
      coverageGrid.style.display = "grid";
      coverageGrid.style.gap = "1rem";
      coverageGrid.style.gridTemplateColumns =
        "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))";
      report.coverage.forEach(function (entry) {
        var figure = accountElement(
          documentRef,
          "figure",
          "customer-assessment-evidence"
        );
        var image = accountElement(documentRef, "img", "");
        image.src = entry.url;
        image.alt = entry.accessibleDescription;
        image.loading = "lazy";
        image.decoding = "async";
        image.style.display = "block";
        image.style.width = "100%";
        image.style.height = "auto";
        figure.append(
          image,
          accountElement(
            documentRef,
            "figcaption",
            "",
            accountWords(entry.viewport) + " · "
              + ownerTargetLine(entry.reviewTarget) + " · "
              + entry.accessibleDescription
          )
        );
        coverageGrid.appendChild(figure);
      });
      coverage.appendChild(coverageGrid);
      section.appendChild(coverage);

      var findings = accountElement(
        documentRef,
        "ol",
        "customer-assessment-report-findings"
      );
      report.findings.forEach(function (finding) {
        var item = accountElement(
          documentRef,
          "li",
          "customer-assessment-report-finding"
        );
        item.append(
          accountElement(
            documentRef,
            "h5",
            "",
            "Finding " + finding.priority + " · "
              + accountWords(finding.severity)
          ),
          accountElement(
            documentRef,
            "p",
            "",
            finding.summary
          ),
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Recommendation: " + finding.recommendation
          ),
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Target " + ownerTargetLine(finding.primaryTarget)
              + " · " + finding.viewports.map(accountWords).join(" and ")
          )
        );
        var evidenceLinks = accountElement(
          documentRef,
          "ul",
          "customer-assessment-finding-evidence"
        );
        finding.evidence.forEach(function (entry) {
          var evidenceItem = accountElement(documentRef, "li", "");
          var link = accountElement(
            documentRef,
            "a",
            "",
            accountWords(entry.viewport) + " evidence · "
              + entry.accessibleDescription
          );
          link.href = entry.url;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          evidenceItem.appendChild(link);
          evidenceLinks.appendChild(evidenceItem);
        });
        item.appendChild(evidenceLinks);
        findings.appendChild(item);
      });
      section.appendChild(findings);

      var credit = reportState.credit;
      var creditMessages = {
        available:
          "It is available for an eligible Custom base build accepted through "
            + accountDate(credit.acceptanceCutoff) + ".",
        expired:
          "Its acceptance window expired on "
            + accountDate(credit.acceptanceCutoff) + ".",
        reserved:
          "It is reserved by your accepted Custom build quote and has not been applied as payment yet.",
        settled:
          "It has been applied once to your Custom base build.",
        reconciliation_required:
          "Its payment application is under review; it cannot be used again while that review is open."
      };
      var creditSection = accountElement(
        documentRef,
        "section",
        "customer-assessment-build-credit"
      );
      creditSection.append(
        accountElement(
          documentRef,
          "h5",
          "",
          "$200 Custom build credit"
        ),
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "This is a one-use, non-cash $200 credit toward an eligible Custom base build for this same organization and project. "
            + creditMessages[credit.state]
        )
      );
      section.appendChild(creditSection);
      body.appendChild(section);
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        if (typeof status.focus === "function") status.focus();
      },
      render: function (readState) {
        var selected = Boolean(readState && readState.projectId);
        panel.hidden = !selected;
        body.replaceChildren();
        if (!selected) return;
        var busy = readState.phase === "loading"
          || Boolean(readState.command);
        panel.setAttribute("aria-busy", String(busy));
        if (readState.phase === "loading") {
          status.textContent = "Loading this project's assessment request…";
          return;
        }
        if (readState.phase === "error") {
          status.textContent = readState.error
            || "The assessment request could not be loaded.";
          var retry = accountElement(
            documentRef,
            "button",
            "spark-button",
            "Try loading the assessment again"
          );
          retry.type = "button";
          retry.addEventListener("click", function () {
            if (typeof actions.retry === "function") actions.retry();
          });
          body.appendChild(retry);
          return;
        }
        var request = verifiedAssessmentRequest(readState.request);
        var quote = verifiedAssessmentQuote(readState.quote);
        var invoice = verifiedAssessmentInvoice(readState.invoice);
        var report = readState.report === null
          ? null
          : verifiedCustomerAssessmentReport(
              readState.report,
              readState.projectId
            );
        if (!request || !quote || !invoice) {
          status.textContent =
            "The assessment response could not be verified. Nothing was changed.";
          return;
        }
        status.textContent = readState.error
          || (readState.command
            ? accountWords(readState.command) + "…"
            : "Assessment request loaded.");
        if (["not_started", "draft", "withdrawn"].includes(request.state)) {
          renderForm(request, busy);
        }
        if (request.state === "submitted" && quote.state === "not_available") {
          body.appendChild(
            accountElement(
              documentRef,
              "p",
              "customer-assessment-note",
              "Request submitted. Site Sourcery is reviewing it and will place the bounded $200 quote here."
            )
          );
        }
        if (request.state === "draft") {
          var submit = accountElement(
            documentRef,
            "button",
            "spark-button spark-button-primary",
            "Submit assessment request"
          );
          submit.type = "button";
          submit.disabled = busy || request.actions.submit.available !== true;
          submit.addEventListener("click", function () {
            if (typeof actions.submit === "function") {
              actions.submit(request.draftRevision);
            }
          });
          body.appendChild(submit);
        }
        if (["draft", "submitted"].includes(request.state)) {
          var withdraw = accountElement(
            documentRef,
            "button",
            "spark-button customer-assessment-withdraw",
            "Withdraw current request"
          );
          withdraw.type = "button";
          withdraw.disabled = busy || request.actions.withdraw.available !== true;
          withdraw.addEventListener("click", function () {
            if (typeof actions.withdraw === "function") actions.withdraw();
          });
          body.appendChild(withdraw);
        }
        renderQuote(quote, busy);
        renderInvoice(invoice, busy);
        if (report) {
          renderReport(report);
        } else {
          body.appendChild(
            accountElement(
              documentRef,
              "p",
              "customer-assessment-note",
              readState.reportError
                || "The assessment report response could not be verified. Existing request, quote, invoice, and payment details remain available."
            )
          );
        }
      }
    });
  }

  function safeOwnerWebsiteUrl(value) {
    try {
      var parsed = new URL(text(value));
      return ["http:", "https:"].includes(parsed.protocol)
        && parsed.username === ""
        && parsed.password === ""
        && parsed.port === ""
        && parsed.pathname === "/"
        && parsed.search === ""
        && parsed.hash === "";
    } catch (error) {
      return false;
    }
  }

  function verifiedOwnerAssessmentQueue(value) {
    if (
      !record(value)
      || value.schema !==
        "sitesourcery.custom-services-owner-assessment-queue/v1"
      || !Array.isArray(value.requests)
      || value.requests.length > 100
    ) return null;
    var valid = value.requests.every(function (entry) {
      if (
        !record(entry)
        || !UUID.test(text(entry.caseId))
        || !UUID.test(text(entry.organizationId))
        || !text(entry.organizationName)
        || !UUID.test(text(entry.projectId))
        || !text(entry.projectName)
        || !safeIso(entry.submittedAt)
        || !record(entry.customer)
        || !UUID.test(text(entry.customer.customerId))
        || !text(entry.customer.name)
        || !text(entry.customer.email)
        || !record(entry.website)
        || !text(entry.website.displayName)
        || !safeOwnerWebsiteUrl(entry.website.publicUrl)
        || !record(entry.request)
        || !text(entry.request.primaryGoal)
      ) return false;
      var quote = entry.currentQuote;
      return quote === null || (
        record(quote)
        && UUID.test(text(quote.quoteId))
        && Number.isSafeInteger(quote.quoteRevision)
        && quote.quoteRevision > 0
        && typeof quote.deliveryDate === "string"
        && safeIso(quote.expiresAt)
        && safeIso(quote.issuedAt)
        && Array.isArray(quote.reviewTargets)
        && quote.reviewTargets.length >= 1
        && quote.reviewTargets.length <= 5
        && quote.reviewTargets.every(function (target) {
          return record(target)
            && ["page", "page_type"].includes(target.kind)
            && Boolean(text(target.value));
        })
      );
    });
    return valid ? value : null;
  }

  function ownerTargetLine(target) {
    return target.kind === "page"
      ? text(target.value)
      : "type:" + text(target.value);
  }

  function defaultOwnerDeliveryDate() {
    return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  function ownerReviewTargets(value) {
    var lines = text(value)
      .split(/\r?\n/u)
      .map(text)
      .filter(Boolean);
    if (lines.length < 1 || lines.length > 5) {
      throw new Error(
        "Enter between one and five pages or page types, one per line."
      );
    }
    var unique = new Set(lines);
    if (unique.size !== lines.length) {
      throw new Error("Each review target must be listed once.");
    }
    return lines.map(function (line) {
      if (line.startsWith("/")) {
        return { kind: "page", value: line };
      }
      if (/^type:[a-z][a-z0-9_]{1,79}$/u.test(line)) {
        return {
          kind: "page_type",
          value: line.slice(5)
        };
      }
      throw new Error(
        "Use a page path like /about or a page type like type:product."
      );
    });
  }

  function assessmentImageBytesMatch(bytes, mediaType) {
    var jpeg = bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
    var png = bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
    var webp = bytes.length >= 12
      && String.fromCharCode(
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3]
      ) === "RIFF"
      && String.fromCharCode(
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11]
      ) === "WEBP";
    return (mediaType === "image/jpeg" && jpeg)
      || (mediaType === "image/png" && png)
      || (mediaType === "image/webp" && webp);
  }

  function assessmentBytesToBase64(bytes, environment) {
    var runtime = environment || (
      typeof globalThis === "object" ? globalThis : {}
    );
    var binary = "";
    for (var offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length))
      );
    }
    if (typeof runtime.btoa === "function") {
      return runtime.btoa(binary);
    }
    if (typeof Buffer === "function") {
      return Buffer.from(bytes).toString("base64");
    }
    throw new Error(
      "This browser cannot safely prepare screenshot evidence."
    );
  }

  function assessmentCanvasBlob(canvas, mediaType, quality) {
    return new Promise(function (resolve) {
      if (!canvas || typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob(resolve, mediaType, quality);
    });
  }

  function assessmentDecodedImage(file, runtime) {
    if (typeof runtime.createImageBitmap === "function") {
      return runtime.createImageBitmap(file).then(function (bitmap) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: function () {
            if (typeof bitmap.close === "function") bitmap.close();
          }
        };
      });
    }
    var documentRef = runtime.document;
    var URLRef = runtime.URL;
    if (
      typeof runtime.Image !== "function"
      || !URLRef
      || typeof URLRef.createObjectURL !== "function"
      || typeof URLRef.revokeObjectURL !== "function"
      || !documentRef
    ) {
      return Promise.reject(new Error(
        "This browser cannot safely prepare screenshot evidence."
      ));
    }
    return new Promise(function (resolve, reject) {
      var objectUrl = URLRef.createObjectURL(file);
      var image = new runtime.Image();
      image.onload = function () {
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          release: function () {
            URLRef.revokeObjectURL(objectUrl);
          }
        });
      };
      image.onerror = function () {
        URLRef.revokeObjectURL(objectUrl);
        reject(new Error("That screenshot could not be opened."));
      };
      image.src = objectUrl;
    });
  }

  async function prepareAssessmentEvidenceFile(file, environment) {
    var runtime = environment || (
      typeof globalThis === "object" ? globalThis : {}
    );
    if (
      !file
      || !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      || typeof file.arrayBuffer !== "function"
    ) {
      throw new Error("Choose a JPEG, PNG, or WebP screenshot.");
    }
    if (
      Number.isFinite(file.size)
      && (file.size < 1 || file.size > 25 * 1024 * 1024)
    ) {
      throw new Error(
        "Choose a screenshot between 1 byte and 25 MiB."
      );
    }
    var original = new Uint8Array(await file.arrayBuffer());
    if (
      original.length < 1
      || original.length > 25 * 1024 * 1024
      || !assessmentImageBytesMatch(original, file.type)
    ) {
      throw new Error("That screenshot does not match its image type.");
    }
    var decoded = await assessmentDecodedImage(file, runtime);
    try {
      if (
        !Number.isFinite(decoded.width)
        || !Number.isFinite(decoded.height)
        || decoded.width < 1
        || decoded.height < 1
      ) throw new Error("That screenshot has invalid dimensions.");
      var documentRef = runtime.document;
      var canvas = documentRef
        && typeof documentRef.createElement === "function"
        ? documentRef.createElement("canvas")
        : null;
      var context = canvas
        && typeof canvas.getContext === "function"
        ? canvas.getContext("2d", { alpha: false })
        : null;
      if (!canvas || !context || typeof context.drawImage !== "function") {
        throw new Error(
          "This browser cannot safely prepare screenshot evidence."
        );
      }
      var scale = Math.min(
        1,
        2048 / decoded.width,
        5000 / decoded.height
      );
      var qualities = [0.86, 0.74, 0.62, 0.5, 0.4];
      for (var pass = 0; pass < 8; pass += 1) {
        canvas.width = Math.max(1, Math.round(decoded.width * scale));
        canvas.height = Math.max(1, Math.round(decoded.height * scale));
        context.drawImage(
          decoded.source,
          0,
          0,
          canvas.width,
          canvas.height
        );
        for (var index = 0; index < qualities.length; index += 1) {
          var quality = qualities[index];
          var blob = await assessmentCanvasBlob(
            canvas,
            "image/webp",
            quality
          );
          if (
            !blob
            || !["image/webp", "image/jpeg"].includes(blob.type)
          ) {
            blob = await assessmentCanvasBlob(
              canvas,
              "image/jpeg",
              quality
            );
          }
          if (
            !blob
            || !["image/webp", "image/jpeg"].includes(blob.type)
            || blob.size < 1
            || blob.size > ASSESSMENT_MAXIMUM_EVIDENCE_BYTES
            || typeof blob.arrayBuffer !== "function"
          ) continue;
          var compressed = new Uint8Array(await blob.arrayBuffer());
          if (
            compressed.length === blob.size
            && assessmentImageBytesMatch(compressed, blob.type)
          ) {
            return Object.freeze({
              bytesBase64: assessmentBytesToBase64(
                compressed,
                runtime
              ),
              byteCount: compressed.length,
              mediaType: blob.type
            });
          }
        }
        scale *= 0.78;
      }
      throw new Error(
        "That screenshot could not be reduced below 700 KiB. Crop it and try again."
      );
    } finally {
      decoded.release();
    }
  }

  function createOwnerAssessmentPanel(documentRef, actions) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-owner-quote-desk"
    );
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", "owner-quote-desk-title");
    panel.setAttribute("data-owner-quote-desk", "");
    var status = accountElement(
      documentRef,
      "p",
      "customer-owner-quote-status"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var body = accountElement(
      documentRef,
      "div",
      "customer-owner-quote-body"
    );
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Owner assessment quote desk"
    );
    heading.id = "owner-quote-desk-title";
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Private Site Sourcery tools"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "Review submitted requests and issue the fixed $200 assessment quote. Price, scope limits, tax state, payment timing, contract, and quote expiration are set by the server."
      ),
      status,
      body
    );

    function renderRequest(entry, busyCaseId) {
      var quote = entry.currentQuote;
      var card = accountElement(
        documentRef,
        "article",
        "customer-owner-quote-card"
      );
      card.appendChild(
        accountElement(
          documentRef,
          "h4",
          "",
          entry.website.displayName
        )
      );
      var facts = accountElement(
        documentRef,
        "dl",
        "customer-alakazam-facts"
      );
      appendAccountFact(
        documentRef,
        facts,
        "Customer",
        entry.customer.name + " · " + entry.customer.email
      );
      appendAccountFact(
        documentRef,
        facts,
        "Organization",
        entry.organizationName
      );
      var siteLink = accountElement(
        documentRef,
        "a",
        "",
        entry.website.publicUrl
      );
      siteLink.href = entry.website.publicUrl;
      siteLink.target = "_blank";
      siteLink.rel = "noreferrer noopener";
      appendAccountFact(documentRef, facts, "Website", siteLink);
      appendAccountFact(
        documentRef,
        facts,
        "Submitted",
        accountDate(entry.submittedAt)
      );
      appendAccountFact(
        documentRef,
        facts,
        "Goal",
        entry.request.primaryGoal
      );
      if (text(entry.request.customerObservation)) {
        appendAccountFact(
          documentRef,
          facts,
          "Customer noticed",
          entry.request.customerObservation
        );
      }
      if (quote) {
        appendAccountFact(
          documentRef,
          facts,
          "Current quote",
          "Revision " + quote.quoteRevision
            + " · delivery " + quote.deliveryDate
            + " · expires " + accountDate(quote.expiresAt)
        );
      }
      card.appendChild(facts);

      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-quote-form"
      );
      form.append(
        assessmentField(
          documentRef,
          "deliveryDate",
          "Promised delivery date",
          quote ? quote.deliveryDate : defaultOwnerDeliveryDate(),
          { required: true, type: "date", maximum: 10 }
        ),
        assessmentField(
          documentRef,
          "reviewTargets",
          "Pages or page types (one per line)",
          quote
            ? quote.reviewTargets.map(ownerTargetLine).join("\n")
            : "/",
          {
            required: true,
            multiline: true,
            maximum: 800,
            placeholder: "/\n/about\ntype:product"
          }
        )
      );
      form.appendChild(
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          "Use paths such as / or /about. Use type:product for a representative page type. Choose 1–5 total."
        )
      );
      var formError = accountElement(
        documentRef,
        "p",
        "customer-owner-quote-form-error"
      );
      formError.setAttribute("role", "alert");
      form.appendChild(formError);
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        quote ? "Update $200 quote" : "Issue $200 quote"
      );
      submit.type = "submit";
      submit.disabled = busyCaseId === entry.caseId;
      form.appendChild(submit);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        formError.textContent = "";
        var data = new FormData(form);
        try {
          var input = {
            organizationId: entry.organizationId,
            deliveryDate: text(data.get("deliveryDate")),
            reviewTargets: ownerReviewTargets(
              data.get("reviewTargets")
            )
          };
          if (typeof actions.issue === "function") {
            actions.issue(entry, input);
          }
        } catch (error) {
          formError.textContent = error.message;
        }
      });
      card.appendChild(form);
      body.appendChild(card);
    }

    return Object.freeze({
      element: panel,
      render: function (state) {
        var queue = state && state.queue
          ? verifiedOwnerAssessmentQueue(state.queue)
          : null;
        panel.hidden = !queue;
        body.replaceChildren();
        if (!queue) return;
        panel.setAttribute(
          "aria-busy",
          String(Boolean(state.busyCaseId))
        );
        status.textContent = state.error
          || (queue.requests.length === 0
            ? "No submitted assessment requests are waiting."
            : queue.requests.length + " assessment request"
              + (queue.requests.length === 1 ? " is" : "s are")
              + " ready for owner review.");
        queue.requests.forEach(function (entry) {
          renderRequest(entry, state.busyCaseId);
        });
      }
    });
  }

  function ownerAssessmentCoverageComplete(job) {
    if (!job || !job.scope || !Array.isArray(job.evidence)) return false;
    return job.scope.reviewTargets.every(function (target) {
      var targetKey = assessmentTargetKey(target);
      return ["desktop", "phone"].every(function (viewport) {
        return job.evidence.some(function (entry) {
          return assessmentTargetKey(entry.reviewTarget) === targetKey
            && entry.viewport === viewport;
        });
      });
    });
  }

  function ownerAssessmentFindingsReady(job) {
    if (!job || !Array.isArray(job.findings)) return false;
    var included = job.findings.filter(function (finding) {
      return finding.included;
    }).sort(function (left, right) {
      return left.priority - right.priority;
    });
    return included.every(function (finding, index) {
      return finding.priority === index + 1;
    });
  }

  function ownerAssessmentTargetSelect(
    documentRef,
    name,
    labelCopy,
    targets,
    selected
  ) {
    return assessmentSelect(
      documentRef,
      name,
      labelCopy,
      assessmentTargetKey(selected || targets[0]),
      targets.map(function (target) {
        return [assessmentTargetKey(target), ownerTargetLine(target)];
      })
    );
  }

  function selectedOwnerAssessmentTarget(job, key) {
    return job.scope.reviewTargets.find(function (target) {
      return assessmentTargetKey(target) === key;
    }) || null;
  }

  function ownerAssessmentEvidenceSignature(job, input) {
    var source = text(job && job.jobId) + "\n" + JSON.stringify(input);
    var first = 0x811c9dc5;
    var second = 0x9e3779b9;
    for (var index = 0; index < source.length; index += 1) {
      var code = source.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193) >>> 0;
      second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
    }
    return source.length + ":" + first.toString(16).padStart(8, "0")
      + ":" + second.toString(16).padStart(8, "0");
  }

  function createOwnerAssessmentWorkPanel(documentRef, actions) {
    actions = actions || {};
    var expandedJobIds = new Set();
    var panel = accountElement(
      documentRef,
      "section",
      "customer-owner-quote-desk customer-owner-assessment-workbench"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "owner-assessment-workbench-title"
    );
    panel.setAttribute("data-owner-assessment-workbench", "");
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Owner assessment workbench"
    );
    heading.id = "owner-assessment-workbench-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-owner-quote-status customer-owner-assessment-status"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("tabindex", "-1");
    var refresh = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Refresh assessment jobs"
    );
    refresh.type = "button";
    refresh.addEventListener("click", function () {
      if (typeof actions.refresh === "function") actions.refresh();
    });
    var body = accountElement(
      documentRef,
      "div",
      "customer-owner-quote-body customer-owner-assessment-body"
    );
    panel.append(
      accountElement(
        documentRef,
        "p",
        "spark-kicker",
        "Private Site Sourcery tools"
      ),
      heading,
      accountElement(
        documentRef,
        "p",
        "customer-assessment-intro",
        "Complete the paid, bounded assessment from Mac or Pixel: add desktop and phone screenshot evidence, author up to ten customer-safe findings, then deliver one immutable report and its one-use $200 Custom build credit."
      ),
      status,
      refresh,
      body
    );

    function busyFor(state, jobId) {
      return Boolean(state.busyKey);
    }

    function renderEvidence(job, state, card) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-form customer-owner-assessment-evidence"
      );
      section.appendChild(
        accountElement(documentRef, "h5", "", "Screenshot evidence")
      );
      var coverageComplete = ownerAssessmentCoverageComplete(job);
      section.appendChild(
        accountElement(
          documentRef,
          "p",
          "customer-assessment-note",
          coverageComplete
            ? "Coverage complete: every paid target has desktop and phone evidence."
            : "Coverage incomplete: add both desktop and phone evidence for every paid target."
        )
      );
      if (job.evidence.length > 0) {
        var evidenceGrid = accountElement(
          documentRef,
          "div",
          "customer-owner-assessment-evidence-grid"
        );
        evidenceGrid.style.display = "grid";
        evidenceGrid.style.gap = "1rem";
        evidenceGrid.style.gridTemplateColumns =
          "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))";
        job.evidence.forEach(function (entry) {
          var figure = accountElement(documentRef, "figure", "");
          var image = accountElement(documentRef, "img", "");
          image.src = ownerAssessmentEvidenceUrl(
            job.jobId,
            entry.evidenceId
          );
          image.alt = entry.accessibleDescription;
          image.loading = "lazy";
          image.decoding = "async";
          image.style.display = "block";
          image.style.width = "100%";
          image.style.height = "auto";
          figure.append(
            image,
            accountElement(
              documentRef,
              "figcaption",
              "",
              accountWords(entry.viewport) + " · "
                + ownerTargetLine(entry.reviewTarget) + " · "
                + entry.accessibleDescription
            )
          );
          evidenceGrid.appendChild(figure);
        });
        section.appendChild(evidenceGrid);
      }
      if (job.state === "delivered") {
        card.appendChild(section);
        return;
      }
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-assessment-evidence-form"
      );
      form.style.display = "grid";
      form.style.gap = "0.75rem";
      form.style.gridTemplateColumns = "minmax(0, 1fr)";
      form.append(
        ownerAssessmentTargetSelect(
          documentRef,
          "reviewTarget",
          "Paid review target",
          job.scope.reviewTargets,
          job.scope.reviewTargets[0]
        ),
        assessmentSelect(
          documentRef,
          "viewport",
          "Viewport",
          "desktop",
          [
            ["desktop", "Desktop"],
            ["phone", "Phone"]
          ]
        ),
        assessmentField(
          documentRef,
          "accessibleDescription",
          "Accessible screenshot description",
          "",
          {
            required: true,
            maximum: 500,
            multiline: true,
            placeholder:
              "Describe what the screenshot shows and why it matters."
          }
        )
      );
      var fileLabel = accountElement(
        documentRef,
        "label",
        "spark-field"
      );
      fileLabel.appendChild(
        accountElement(
          documentRef,
          "span",
          "",
          "Screenshot file"
        )
      );
      var file = accountElement(documentRef, "input", "");
      file.type = "file";
      file.name = "evidenceFile";
      file.accept = "image/jpeg,image/png,image/webp";
      file.required = true;
      fileLabel.appendChild(file);
      var formStatus = accountElement(
        documentRef,
        "p",
        "customer-owner-assessment-form-status"
      );
      formStatus.setAttribute("role", "status");
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        "Prepare and upload screenshot"
      );
      submit.type = "submit";
      submit.disabled = busyFor(state, job.jobId);
      form.append(fileLabel, formStatus, submit);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (typeof actions.evidence !== "function") return;
        var data = new FormData(form);
        var selectedTarget = selectedOwnerAssessmentTarget(
          job,
          text(data.get("reviewTarget"))
        );
        if (!selectedTarget || !file.files || file.files.length !== 1) {
          formStatus.textContent = "Choose one paid target and one screenshot.";
          return;
        }
        submit.disabled = true;
        formStatus.textContent =
          "Preparing a private image no larger than 700 KiB…";
        prepareAssessmentEvidenceFile(file.files[0])
          .then(function (prepared) {
            return actions.evidence(job, {
              accessibleDescription: text(
                data.get("accessibleDescription")
              ),
              bytesBase64: prepared.bytesBase64,
              mediaType: prepared.mediaType,
              organizationId: job.organizationId,
              reviewTarget: selectedTarget,
              viewport: text(data.get("viewport"))
            });
          })
          .catch(function (error) {
            formStatus.textContent = error && error.message
              ? error.message
              : "The screenshot could not be prepared.";
            submit.disabled = false;
          });
      });
      section.appendChild(form);
      card.appendChild(section);
    }

    function renderFindingForm(job, priority, state, container) {
      var existing = job.findings.find(function (finding) {
        return finding.priority === priority;
      }) || null;
      var details = accountElement(
        documentRef,
        "details",
        "customer-owner-assessment-finding"
      );
      var summary = accountElement(
        documentRef,
        "summary",
        "",
        "Finding " + priority + " · "
          + (existing
            ? existing.summary
            : "Not authored")
      );
      details.appendChild(summary);
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-assessment-finding-form"
      );
      form.style.display = "grid";
      form.style.gap = "0.75rem";
      form.style.gridTemplateColumns = "minmax(0, 1fr)";
      var includedLabel = accountElement(documentRef, "label", "");
      var included = accountElement(documentRef, "input", "");
      included.type = "checkbox";
      included.name = "included";
      included.checked = existing ? existing.included : true;
      includedLabel.append(
        included,
        accountElement(
          documentRef,
          "span",
          "",
          "Include this finding in the delivered customer report"
        )
      );
      var primaryTargetField = ownerAssessmentTargetSelect(
        documentRef,
        "primaryTarget",
        "Primary paid target",
        job.scope.reviewTargets,
        existing
          ? existing.primaryTarget
          : job.scope.reviewTargets[0]
      );
      var primaryTargetSelect = primaryTargetField.querySelector("select");
      form.append(
        includedLabel,
        assessmentSelect(
          documentRef,
          "severity",
          "Severity",
          existing ? existing.severity : "moderate",
          ASSESSMENT_SEVERITIES.map(function (entry) {
            return [entry, accountWords(entry)];
          })
        ),
        assessmentSelect(
          documentRef,
          "category",
          "Category",
          existing ? existing.category : "usability",
          ASSESSMENT_CATEGORIES.map(function (entry) {
            return [entry, accountWords(entry)];
          })
        ),
        primaryTargetField
      );
      var viewportGroup = accountElement(
        documentRef,
        "fieldset",
        "customer-owner-assessment-viewports"
      );
      viewportGroup.appendChild(
        accountElement(documentRef, "legend", "", "Affected viewports")
      );
      ["desktop", "phone"].forEach(function (viewport) {
        var label = accountElement(documentRef, "label", "");
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.name = "viewports";
        checkbox.value = viewport;
        checkbox.checked = existing
          ? existing.viewports.includes(viewport)
          : true;
        label.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            accountWords(viewport)
          )
        );
        viewportGroup.appendChild(label);
      });
      form.append(
        viewportGroup,
        assessmentField(
          documentRef,
          "summary",
          "Customer-safe finding summary",
          existing ? existing.summary : "",
          { required: true, maximum: 240, multiline: true }
        ),
        assessmentField(
          documentRef,
          "recommendation",
          "Customer-safe recommendation",
          existing ? existing.recommendation : "",
          { required: true, maximum: 1500, multiline: true }
        )
      );
      var evidenceGroup = accountElement(
        documentRef,
        "fieldset",
        "customer-owner-assessment-finding-evidence"
      );
      evidenceGroup.appendChild(
        accountElement(
          documentRef,
          "legend",
          "",
          "Supporting screenshot evidence"
        )
      );
      if (job.evidence.length === 0) {
        evidenceGroup.appendChild(
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            "Upload screenshot evidence before authoring findings."
          )
        );
      }
      var evidenceOptions = [];
      job.evidence.forEach(function (entry) {
        var label = accountElement(documentRef, "label", "");
        var checkbox = accountElement(documentRef, "input", "");
        checkbox.type = "checkbox";
        checkbox.name = "evidenceIds";
        checkbox.value = entry.evidenceId;
        checkbox.checked = Boolean(
          existing
          && existing.evidenceIds.includes(entry.evidenceId)
        );
        label.append(
          checkbox,
          accountElement(
            documentRef,
            "span",
            "",
            accountWords(entry.viewport) + " · "
              + ownerTargetLine(entry.reviewTarget) + " · "
              + entry.accessibleDescription
          )
        );
        evidenceOptions.push({
          checkbox: checkbox,
          label: label,
          targetKey: assessmentTargetKey(entry.reviewTarget),
          viewport: entry.viewport
        });
        evidenceGroup.appendChild(label);
      });
      function syncFindingEvidenceChoices() {
        var selectedTargetKey = text(
          primaryTargetSelect && primaryTargetSelect.value
        );
        evidenceOptions.forEach(function (option) {
          var matches = option.targetKey === selectedTargetKey;
          option.label.hidden = !matches;
          option.checkbox.disabled = !matches;
          if (!matches) option.checkbox.checked = false;
        });
      }
      if (primaryTargetSelect) {
        primaryTargetSelect.addEventListener(
          "change",
          syncFindingEvidenceChoices
        );
      }
      syncFindingEvidenceChoices();
      var formError = accountElement(
        documentRef,
        "p",
        "customer-owner-assessment-form-status"
      );
      formError.setAttribute("role", "alert");
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        existing ? "Save finding revision" : "Save finding"
      );
      submit.type = "submit";
      submit.disabled = busyFor(state, job.jobId)
        || job.evidence.length === 0;
      form.append(evidenceGroup, formError, submit);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        formError.textContent = "";
        if (typeof actions.finding !== "function") return;
        var data = new FormData(form);
        var target = selectedOwnerAssessmentTarget(
          job,
          text(data.get("primaryTarget"))
        );
        var viewports = data.getAll("viewports").map(text).sort();
        var evidenceIds = data.getAll("evidenceIds").map(text).sort();
        var targetKey = target ? assessmentTargetKey(target) : "";
        var selectedEvidence = job.evidence.filter(function (entry) {
          return evidenceIds.includes(entry.evidenceId)
            && assessmentTargetKey(entry.reviewTarget) === targetKey;
        });
        var evidenceCoversViewports = viewports.every(function (viewport) {
          return selectedEvidence.some(function (entry) {
            return entry.viewport === viewport;
          });
        });
        if (
          !target
          || viewports.length < 1
          || evidenceIds.length < 1
          || selectedEvidence.length !== evidenceIds.length
          || !evidenceCoversViewports
        ) {
          formError.textContent =
            "Choose evidence from this paid target for every affected viewport.";
          return;
        }
        actions.finding(job, priority, {
          category: text(data.get("category")),
          evidenceIds: evidenceIds,
          expectedRevision: existing ? existing.revision : 0,
          included: included.checked,
          organizationId: job.organizationId,
          primaryTarget: target,
          recommendation: text(data.get("recommendation")),
          severity: text(data.get("severity")),
          summary: text(data.get("summary")),
          viewports: viewports
        });
      });
      details.appendChild(form);
      container.appendChild(details);
    }

    function renderDelivery(job, state, card) {
      var section = accountElement(
        documentRef,
        "section",
        "customer-assessment-form customer-owner-assessment-delivery"
      );
      section.appendChild(
        accountElement(documentRef, "h5", "", "Report delivery")
      );
      if (job.delivery) {
        var deliveredFacts = accountElement(documentRef, "dl", "");
        appendAccountFact(
          documentRef,
          deliveredFacts,
          "Delivered",
          accountDate(job.delivery.deliveredAt)
        );
        appendAccountFact(
          documentRef,
          deliveredFacts,
          "Findings",
          String(job.delivery.findingCount)
        );
        appendAccountFact(
          documentRef,
          deliveredFacts,
          "Build credit",
          "$200.00 USD · one use · non-cash · "
            + accountWords(job.delivery.credit.state)
            + (job.delivery.credit.state === "available"
              ? " through "
              : " on ")
            + accountDate(job.delivery.credit.acceptanceCutoff)
        );
        section.append(
          deliveredFacts,
          accountElement(
            documentRef,
            "p",
            "customer-assessment-note",
            job.delivery.overallSummary
          )
        );
        card.appendChild(section);
        return;
      }
      var coverageComplete = ownerAssessmentCoverageComplete(job);
      var findingsReady = ownerAssessmentFindingsReady(job);
      var form = accountElement(
        documentRef,
        "form",
        "customer-owner-assessment-delivery-form"
      );
      form.style.display = "grid";
      form.style.gap = "0.75rem";
      form.style.gridTemplateColumns = "minmax(0, 1fr)";
      form.appendChild(
        assessmentField(
          documentRef,
          "overallSummary",
          "Customer-facing overall summary",
          "",
          { required: true, maximum: 2000, multiline: true }
        )
      );
      var confirmation = accountElement(documentRef, "label", "");
      var confirmationBox = accountElement(documentRef, "input", "");
      confirmationBox.type = "checkbox";
      confirmation.append(
        confirmationBox,
        accountElement(
          documentRef,
          "span",
          "",
          "I reviewed the complete desktop and phone evidence and understand delivery freezes the customer report and issues exactly one non-cash $200 same-project Custom build credit."
        )
      );
      var readiness = accountElement(
        documentRef,
        "p",
        "customer-assessment-note",
        !coverageComplete
          ? "Delivery is locked until every target has desktop and phone evidence."
          : !findingsReady
            ? "Delivery is locked until included findings use consecutive priorities beginning with 1."
            : "Coverage and finding order are ready for final review."
      );
      var formError = accountElement(
        documentRef,
        "p",
        "customer-owner-assessment-form-status"
      );
      formError.setAttribute("role", "alert");
      var submit = accountElement(
        documentRef,
        "button",
        "spark-button spark-button-primary",
        "Deliver immutable assessment report"
      );
      submit.type = "submit";
      function updateDeliveryButton() {
        submit.disabled = busyFor(state, job.jobId)
          || !coverageComplete
          || !findingsReady
          || !confirmationBox.checked;
      }
      confirmationBox.addEventListener("change", updateDeliveryButton);
      updateDeliveryButton();
      form.append(confirmation, readiness, formError, submit);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        formError.textContent = "";
        if (
          !coverageComplete
          || !findingsReady
          || !confirmationBox.checked
          || typeof actions.deliver !== "function"
        ) return;
        var data = new FormData(form);
        var overallSummary = text(data.get("overallSummary"));
        if (overallSummary.length < 20) {
          formError.textContent =
            "Write an overall summary of at least 20 characters.";
          return;
        }
        actions.deliver(job, {
          expectedWorkDigest: job.workDigest,
          organizationId: job.organizationId,
          overallSummary: overallSummary
        });
      });
      section.appendChild(form);
      card.appendChild(section);
    }

    function renderJob(job, state) {
      var card = accountElement(
        documentRef,
        "details",
        "customer-owner-quote-card customer-owner-assessment-job"
      );
      card.setAttribute("data-assessment-job", job.jobId);
      card.style.minWidth = "0";
      var jobSummary = accountElement(
        documentRef,
        "summary",
        "customer-owner-assessment-job-summary",
        job.projectName + " · " + accountWords(job.state)
      );
      card.appendChild(jobSummary);
      var rendered = false;
      function renderJobContents() {
        if (rendered) return;
        rendered = true;
        var contents = accountElement(
          documentRef,
          "div",
          "customer-owner-assessment-job-contents"
        );
        var facts = accountElement(
          documentRef,
          "dl",
          "customer-alakazam-facts"
        );
        appendAccountFact(
          documentRef,
          facts,
          "Customer",
          job.customer.name + " · " + job.customer.email
        );
        appendAccountFact(
          documentRef,
          facts,
          "Organization",
          job.organizationName
        );
        appendAccountFact(
          documentRef,
          facts,
          "Delivery date",
          job.deliveryDate
        );
        appendAccountFact(
          documentRef,
          facts,
          "Paid scope",
          "1 website · " + job.scope.reviewTargets.length
            + " targets · up to 10 findings"
        );
        contents.appendChild(facts);
        renderEvidence(job, state, contents);
        if (job.state === "open") {
          var findings = accountElement(
            documentRef,
            "section",
            "customer-owner-assessment-findings"
          );
          findings.appendChild(
            accountElement(
              documentRef,
              "h5",
              "",
              "Customer-safe findings (up to 10)"
            )
          );
          for (var priority = 1; priority <= 10; priority += 1) {
            renderFindingForm(job, priority, state, findings);
          }
          contents.appendChild(findings);
        }
        renderDelivery(job, state, contents);
        card.appendChild(contents);
      }
      card.addEventListener("toggle", function () {
        if (card.open) {
          expandedJobIds.add(job.jobId);
          renderJobContents();
        } else {
          expandedJobIds.delete(job.jobId);
        }
      });
      if (expandedJobIds.has(job.jobId)) {
        card.open = true;
        renderJobContents();
      }
      body.appendChild(card);
    }

    return Object.freeze({
      element: panel,
      focusStatus: function () {
        if (typeof status.focus === "function") status.focus();
      },
      render: function (state) {
        var visible = Boolean(
          state
          && !["idle", "unavailable"].includes(state.phase)
        );
        panel.hidden = !visible;
        body.replaceChildren();
        if (!visible) return;
        refresh.disabled = state.phase === "loading"
          || Boolean(state.busyKey);
        panel.setAttribute(
          "aria-busy",
          String(refresh.disabled)
        );
        if (state.phase === "loading") {
          status.textContent = "Loading paid assessment jobs…";
          return;
        }
        var jobs = verifiedOwnerAssessmentJobs(state.jobs);
        if (!jobs) {
          status.textContent = state.error
            || "The assessment job response could not be verified. No owner action is available.";
          return;
        }
        status.textContent = state.error
          || (jobs.jobs.length === 0
            ? "No paid assessment jobs are open."
            : jobs.jobs.length + " paid assessment job"
              + (jobs.jobs.length === 1 ? " is" : "s are")
              + " available.");
        jobs.jobs.forEach(function (job) {
          renderJob(job, state);
        });
      }
    });
  }

  function createAlakazamAccountPanel(
    documentRef,
    actions
  ) {
    actions = actions || {};
    var panel = accountElement(
      documentRef,
      "section",
      "customer-alakazam-account"
    );
    panel.hidden = true;
    panel.setAttribute(
      "aria-labelledby",
      "customer-alakazam-account-title"
    );
    panel.setAttribute("data-alakazam-account", "");
    var eyebrow = accountElement(
      documentRef,
      "p",
      "spark-kicker",
      "Project website & billing"
    );
    var heading = accountElement(
      documentRef,
      "h3",
      "",
      "Alakazam account"
    );
    heading.id = "customer-alakazam-account-title";
    var status = accountElement(
      documentRef,
      "p",
      "customer-alakazam-load-state",
      "Choose a project to see its billing details."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("data-alakazam-load-state", "");
    status.setAttribute("tabindex", "-1");
    var body = accountElement(
      documentRef,
      "div",
      "customer-alakazam-body"
    );
    body.setAttribute("data-alakazam-body", "");
    var retryButton = accountElement(
      documentRef,
      "button",
      "spark-button",
      "Try loading website and billing again"
    );
    retryButton.type = "button";
    retryButton.hidden = true;
    retryButton.setAttribute("data-alakazam-retry", "");
    retryButton.addEventListener("click", function () {
      if (typeof actions.retry === "function") {
        actions.retry();
      }
    });
    panel.append(
      eyebrow,
      heading,
      status,
      body,
      retryButton
    );

    return Object.freeze({
      element: panel,
      render: function (readState) {
        var selected = Boolean(
          readState && readState.projectId
        );
        var command = readState
          && readState.command
          || {};
        var confirmedDowngrade =
          command.phase === "scheduled"
          && record(command.scheduled);
        var downgradeRefreshFailed =
          confirmedDowngrade
          && command.refreshState === "error";
        panel.hidden = !selected;
        if (!selected) {
          panel.removeAttribute("data-account-state");
          panel.removeAttribute("aria-busy");
          body.replaceChildren();
          retryButton.hidden = true;
          return;
        }
        panel.setAttribute(
          "data-account-state",
          readState.phase
        );
        panel.setAttribute(
          "aria-busy",
          String(
            readState.phase === "loading"
            || command.phase === "configuring"
          )
        );
        retryButton.disabled =
          readState.phase === "loading";
        retryButton.hidden =
          readState.phase !== "error"
          && !downgradeRefreshFailed;
        if (readState.phase === "loading") {
          status.textContent =
            "Loading this project's Alakazam details…";
          body.replaceChildren(
            accountElement(
              documentRef,
              "p",
              "customer-alakazam-placeholder",
              "Website setup, tier, renewal, credit, and receipt details are loading."
            )
          );
          return;
        }
        if (readState.phase === "error") {
          status.textContent =
            "Website and billing details could not be loaded.";
          body.replaceChildren(
            accountElement(
              documentRef,
              "p",
              "customer-alakazam-error",
              "No account, payment, or plan data was changed. Try loading those details again."
            )
          );
          return;
        }
        status.textContent =
          command.phase === "configuring"
            ? "Saving the hosted address and refreshing website setup…"
            : command.phase === "scheduling"
            ? "Scheduling the accepted downgrade…"
            : confirmedDowngrade
              ? command.refreshState === "error"
                ? "Downgrade scheduled. Updated billing details could not be loaded."
                : command.refreshState === "loading"
                  ? "Downgrade scheduled. Refreshing billing details…"
                  : "Downgrade scheduled. Billing details updated."
              : "Website and billing details loaded.";
        renderAlakazamAccountBody(
          documentRef,
          body,
          readState.presentation,
          readState.command || {},
          readState.capabilities || {},
          actions
        );
      },
      focusStatus: function () {
        if (typeof status.focus === "function") {
          status.focus();
        }
      }
    });
  }

  function fragmentToken(locationObject, key) {
    var hash = text(locationObject && locationObject.hash);
    var prefix = "#" + key + "=";
    if (!hash.startsWith(prefix)) return "";
    try {
      return decodeURIComponent(hash.slice(prefix.length));
    } catch (_error) {
      return "";
    }
  }

  function downloadCheckoutReturnFromLocation(
    locationObject
  ) {
    var parameters;
    try {
      parameters = new URLSearchParams(
        text(locationObject && locationObject.search)
      );
    } catch (_error) {
      return null;
    }
    var checkoutValues =
      parameters.getAll("checkout");
    var projectValues =
      parameters.getAll("download_project");
    if (
      checkoutValues.length !== 1
      || projectValues.length !== 1
      || parameters.has("assessment_project")
      || parameters.has("assessment_invoice")
    ) return null;
    var checkoutSessionId = text(checkoutValues[0]);
    var projectId = text(projectValues[0]);
    if (
      !/^cs_[A-Za-z0-9_]+$/u.test(
        checkoutSessionId
      )
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(projectId)
    ) return null;
    return Object.freeze({
      checkoutSessionId: checkoutSessionId,
      projectId: projectId
    });
  }

  function assessmentCheckoutReturnFromLocation(
    locationObject
  ) {
    var parameters;
    try {
      parameters = new URLSearchParams(
        text(locationObject && locationObject.search)
      );
    } catch (_error) {
      return null;
    }
    var checkoutValues = parameters.getAll("checkout");
    var projectValues =
      parameters.getAll("assessment_project");
    var invoiceValues =
      parameters.getAll("assessment_invoice");
    if (
      checkoutValues.length !== 1
      || projectValues.length !== 1
      || invoiceValues.length !== 1
      || parameters.has("download_project")
    ) return null;
    var checkoutSessionId = text(checkoutValues[0]);
    var projectId = text(projectValues[0]);
    var invoiceId = text(invoiceValues[0]);
    if (
      !/^cs_[A-Za-z0-9_]+$/u.test(checkoutSessionId)
      || !UUID.test(projectId)
      || !UUID.test(invoiceId)
    ) return null;
    return Object.freeze({
      checkoutSessionId: checkoutSessionId,
      invoiceId: invoiceId,
      projectId: projectId
    });
  }

  function locationWithoutDownloadCheckoutReturn(
    locationObject
  ) {
    var parameters;
    try {
      parameters = new URLSearchParams(
        text(locationObject && locationObject.search)
      );
    } catch (_error) {
      parameters = new URLSearchParams();
    }
    parameters.delete("checkout");
    parameters.delete("download_project");
    var query = parameters.toString();
    return (
      text(locationObject && locationObject.pathname)
        || "/"
    ) + (query ? "?" + query : "")
      + text(locationObject && locationObject.hash);
  }

  function locationWithoutCheckoutReturn(locationObject) {
    var parameters;
    try {
      parameters = new URLSearchParams(
        text(locationObject && locationObject.search)
      );
    } catch (_error) {
      parameters = new URLSearchParams();
    }
    [
      "assessment_invoice",
      "assessment_project",
      "checkout",
      "download_project"
    ].forEach(function (field) {
      parameters.delete(field);
    });
    var query = parameters.toString();
    return (
      text(locationObject && locationObject.pathname)
        || "/"
    ) + (query ? "?" + query : "")
      + text(locationObject && locationObject.hash);
  }

  function registrationTokenFromLocation(locationObject) {
    return fragmentToken(
      locationObject,
      "verify-registration"
    );
  }

  function recoveryTokenFromLocation(locationObject) {
    return fragmentToken(locationObject, "recovery");
  }

  function registrationOutcome(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    if (
      source.accepted === true
      && source.verificationRequired === true
      && source.delivery === "email"
      && source.emailSent === true
    ) {
      return Object.freeze({
        activationReady: true,
        supportRequired: false,
        message:
          "Check your email and open the Site Sourcery activation link."
      });
    }
    return Object.freeze({
      activationReady: false,
      supportRequired: true,
      message:
        "The activation email could not be confirmed. Nothing was created or charged. Contact Site Sourcery for help."
    });
  }

  function recoveryOutcome(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    if (
      source.delivery === "email"
      && source.emailSent === true
    ) {
      return Object.freeze({
        supportRequired: false,
        message:
          "If that account exists, a recovery email was sent."
      });
    }
    return Object.freeze({
      supportRequired: true,
      message:
        "No recovery email was confirmed. Use the Contact link for account recovery."
    });
  }

  function safeCheckoutDestination(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    var candidate = text(
      source.checkoutUrl
      || source.checkout && source.checkout.url
      || source.payment && source.payment.url
    );
    if (!candidate) return "";
    try {
      var parsed = new URL(candidate);
      if (
        parsed.protocol !== "https:"
        || parsed.hostname !==
          "checkout.stripe.com"
        || parsed.port
        || parsed.username
        || parsed.password
        || parsed.hash
      ) return "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  }

  function acceptedVersionId(version) {
    if (
      !version
      || typeof version !== "object"
      || typeof version.id !== "string"
    ) return "";
    return version.id.trim();
  }

  function bindAcceptedVersion(
    maker,
    originDigest,
    version
  ) {
    var digest = text(originDigest);
    var versionId = acceptedVersionId(version);
    if (
      !digest
      || !versionId
      || !maker
      || typeof maker.markPlatformVersion !==
        "function"
    ) return false;
    return maker.markPlatformVersion(
      digest,
      versionId
    ) === true;
  }

  function acceptedProjectVersion(project) {
    var versions =
      project && Array.isArray(project.versions)
        ? project.versions
        : [];
    var servingId = text(
      project
      && project.serving
      && project.serving.currentVersionId
    );
    var accepted = versions.filter(function (version) {
      return [
        "accepted",
        "accepted_release",
        "ready_for_release"
      ].includes(
        text(
          version
          && (
            version.candidateState
            || version.state
            || version.status
          )
        ).toLowerCase()
      );
    });
    return (
      accepted.find(function (version) {
        return idOf(version) === servingId;
      })
      || accepted[accepted.length - 1]
      || null
    );
  }

  function versionLabel(project, versionId) {
    var selectedId = text(versionId);
    var versions =
      project && Array.isArray(project.versions)
        ? project.versions
        : [];
    var index = versions.findIndex(
      function (version) {
        return idOf(version) === selectedId;
      }
    );
    return index >= 0
      ? "Version " + (index + 1)
      : "Saved version";
  }

  function verifiedDownloadQuote(
    quote,
    projectId,
    versionId,
    now
  ) {
    var currentTime =
      Number.isFinite(Number(now))
        ? Number(now)
        : Date.now();
    if (
      !quote
      || !idOf(quote)
      || text(quote.offerId) !== "spark_download"
      || text(quote.entitlementKind) !==
        "spark_download"
      || text(
        quote.project && quote.project.projectId
      ) !== text(projectId)
      || text(
        quote.version && quote.version.versionId
      ) !== text(versionId)
      || !quote.price
      || Number(quote.price.amountMinor) !== 500
      || text(quote.price.currency).toUpperCase()
        !== "USD"
      || text(quote.price.billing) !== "one_time"
      || text(quote.disclosureDigest).length !== 64
      || text(quote.snapshotDigest).length !== 64
      || !Number.isFinite(
        Date.parse(quote.expiresAt)
      )
      || Date.parse(quote.expiresAt) <= currentTime
    ) return null;
    return Object.freeze({
      quoteId: idOf(quote),
      projectId: text(projectId),
      versionId: text(versionId),
      price: "$5.00 USD",
      expiresAt: quote.expiresAt,
      disclosure:
        text(
          quote.disclosure
          && quote.disclosure.terms
          && quote.disclosure.terms.projectScope
        )
        || "One Download entitlement applies to this editor project and is not used up by another click."
    });
  }

  function downloadEntitlement(
    project,
    versionId
  ) {
    var projectId = idOf(project);
    var selectedVersionId = text(versionId);
    var selectedVersion =
      project
      && Array.isArray(project.versions)
        ? project.versions.find(function (version) {
            return (
              idOf(version) === selectedVersionId
              && [
                "accepted",
                "accepted_release"
              ].includes(
                text(
                  version
                  && (
                    version.state
                    || version.status
                  )
                ).toLowerCase()
              )
            );
          })
        : null;
    if (
      !projectId
      || !selectedVersion
    ) return null;
    var expectedDownloadUrl =
      "/api/v1/projects/"
      + encodeURIComponent(projectId)
      + "/versions/"
      + encodeURIComponent(selectedVersionId)
      + "/download";
    var entitlements =
      project && Array.isArray(project.entitlements)
        ? project.entitlements
        : [];
    return entitlements.find(function (entry) {
      var payment =
        entry
        && typeof entry.payment === "object"
          ? entry.payment
          : {};
      return (
        text(
          entry
          && (entry.id || entry.entitlementId)
        )
        && text(entry.projectId) === projectId
        && text(entry.scope) === "editor_project"
        && text(entry && (entry.kind || entry.entitlementKind))
          === "spark_download"
        && text(
          entry && (entry.state || entry.status)
        ).toLowerCase() === "active"
        && Number.isFinite(
          Date.parse(entry.activatedAt)
        )
        && entry.expiresAt === null
        && /^[a-f0-9]{64}$/u.test(
          text(entry.acceptedDisclosureDigest)
        )
        && text(payment.status) === "paid"
        && text(payment.provider) === "stripe"
        && text(payment.receiptId)
        && Number(payment.amountMinor) === 500
        && text(payment.currency).toUpperCase()
          === "USD"
        && Number.isFinite(
          Date.parse(payment.settledAt)
        )
        && text(entry.downloadUrl)
          === expectedDownloadUrl
      );
    }) || null;
  }

  function boot(windowObject) {
    var windowRef = windowObject;
    var documentRef =
      windowRef && windowRef.document;
    if (!documentRef) return false;

    var modeModule =
      windowRef.SiteSourceryAbracadabraControlMode;
    var apiModule =
      windowRef.SiteSourceryAbracadabraAPI;
    var controlModule =
      windowRef.SiteSourceryAbracadabraHostedControl;
    var maker =
      windowRef.SiteSourceryAbracadabraMaker;
    var configuration = modeModule
      ? modeModule.resolve(documentRef)
      : { hosted: false };
    if (!configuration.hosted) return false;

    var controlRoom =
      documentRef.getElementById("control-room");
    var status =
      documentRef.getElementById("platform-status");
    var workroom =
      documentRef.getElementById("workroom");
    if (
      !apiModule
      || !controlModule
      || !maker
      || !controlRoom
      || !status
      || !workroom
    ) {
      if (status) {
        status.hidden = false;
        status.textContent =
          "Your account options could not open. Your free preview is still here.";
        status.classList.add("is-error");
      }
      return false;
    }

    var client = apiModule.createClient({
      baseUrl: "/api/v1"
    });
    var control =
      controlModule.createHostedControl({
        api: client,
        catalog: {}
      });
    windowRef
      .SiteSourceryAbracadabraHostedSession =
      control;

    workroom.after(controlRoom);

    var pendingGuestCandidate = null;
    var draftTimer = null;
    var queuedDraft = null;
    var draftSaving = false;
    var lastState = control.getState();
    var activeQuote = null;
    var activeEntitlement = null;
    var quoteExpiryTimer = null;
    var assessmentReadSequence = 0;
    var assessmentRead = {
      accountId: "",
      projectId: "",
      phase: "idle",
      request: null,
      quote: null,
      invoice: null,
      report: null,
      reportError: "",
      command: "",
      error: ""
    };
    var assessmentCheckoutAttempt = {
      projectId: "",
      invoiceId: "",
      invoiceDigest: "",
      commandId: ""
    };
    var ownerQuoteRead = {
      accountId: "",
      phase: "idle",
      queue: null,
      busyCaseId: "",
      error: ""
    };
    var ownerWorkReadSequence = 0;
    var ownerWorkRead = {
      accountId: "",
      phase: "idle",
      jobs: null,
      busyKey: "",
      error: ""
    };
    var customBuildReadSequence = 0;
    var customBuildRead = {
      accountId: "",
      projectId: "",
      phase: "idle",
      snapshot: null,
      invoice: null,
      command: "",
      error: ""
    };
    var customBuildProgressReadSequence = 0;
    var customBuildProgressRead = {
      accountId: "",
      projectId: "",
      phase: "idle",
      snapshot: null,
      command: "",
      error: ""
    };
    var customBuildChangeCompletionReadSequence = 0;
    var customBuildChangeCompletionRead = {
      accountId: "",
      projectId: "",
      phase: "idle",
      snapshot: null,
      invoice: null,
      command: "",
      error: ""
    };
    var ownerCustomBuildReadSequence = 0;
    var ownerCustomBuildRead = {
      accountId: "",
      phase: "idle",
      opportunities: null,
      busyKey: "",
      error: ""
    };
    var ownerCustomBuildWorkReadSequence = 0;
    var ownerCustomBuildWorkRead = {
      accountId: "",
      phase: "idle",
      revealed: false,
      jobs: null,
      progressByJob: {},
      changeCompletionByJob: {},
      changePaymentsByJob: {},
      busyKey: "",
      pageNumber: 0,
      loadingMore: false,
      error: ""
    };
    var ownerEvidenceAttemptStorageKey =
      "sitesourcery.owner-assessment-evidence-attempt/v1";
    var customBuildAttemptStorageKey =
      "sitesourcery.custom-build-command-attempt/v1";

    function emptyOwnerEvidenceAttempt() {
      return {
        accountId: "",
        jobId: "",
        signature: "",
        commandId: ""
      };
    }

    function readOwnerEvidenceAttempt() {
      try {
        var stored = windowRef.sessionStorage
          && windowRef.sessionStorage.getItem(
            ownerEvidenceAttemptStorageKey
          );
        var parsed = stored ? JSON.parse(stored) : null;
        return parsed
          && exactKeys(
            parsed,
            ["accountId", "commandId", "jobId", "signature"]
          )
          && UUID.test(text(parsed.accountId))
          && UUID.test(text(parsed.commandId))
          && UUID.test(text(parsed.jobId))
          && /^[0-9]+:[a-f0-9]{8}:[a-f0-9]{8}$/u.test(
            text(parsed.signature)
          )
          ? parsed
          : emptyOwnerEvidenceAttempt();
      } catch (error) {
        return emptyOwnerEvidenceAttempt();
      }
    }

    function storeOwnerEvidenceAttempt(attempt) {
      try {
        if (!windowRef.sessionStorage) return;
        if (attempt.accountId && attempt.jobId) {
          windowRef.sessionStorage.setItem(
            ownerEvidenceAttemptStorageKey,
            JSON.stringify(attempt)
          );
        } else {
          windowRef.sessionStorage.removeItem(
            ownerEvidenceAttemptStorageKey
          );
        }
      } catch (error) {
        // A blocked storage API leaves safe in-memory retry identity intact.
      }
    }

    var ownerEvidenceAttempt = readOwnerEvidenceAttempt();

    function emptyCustomBuildAttempt() {
      return {
        accountId: "",
        commandId: "",
        operation: "",
        signature: "",
        subjectId: ""
      };
    }

    function readCustomBuildAttempt() {
      try {
        var stored = windowRef.sessionStorage
          && windowRef.sessionStorage.getItem(
            customBuildAttemptStorageKey
          );
        var parsed = stored ? JSON.parse(stored) : null;
        return parsed
          && exactKeys(
            parsed,
            [
              "accountId",
              "commandId",
              "operation",
              "signature",
              "subjectId"
            ]
          )
          && UUID.test(text(parsed.accountId))
          && UUID.test(text(parsed.commandId))
          && UUID.test(text(parsed.subjectId))
          && [
            "accept",
            "checkout",
            "change-checkout",
            "issue",
            "void",
            "progress",
            "reconcile-change-payment",
            "request",
            "respond",
            "resolve",
            "withdraw"
          ]
            .includes(parsed.operation)
          && /^[a-f0-9]{8}$/u.test(text(parsed.signature))
          ? parsed
          : emptyCustomBuildAttempt();
      } catch (error) {
        return emptyCustomBuildAttempt();
      }
    }

    function storeCustomBuildAttempt(attempt) {
      try {
        if (!windowRef.sessionStorage) return;
        if (attempt.accountId && attempt.subjectId) {
          windowRef.sessionStorage.setItem(
            customBuildAttemptStorageKey,
            JSON.stringify(attempt)
          );
        } else {
          windowRef.sessionStorage.removeItem(
            customBuildAttemptStorageKey
          );
        }
      } catch (error) {
        // Safe in-memory retry identity remains available.
      }
    }

    function customBuildAttemptSignature(input) {
      var source = JSON.stringify(input);
      var hash = 2166136261;
      for (var index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    var customBuildAttempt = readCustomBuildAttempt();

    function customBuildCommandId(
      accountId,
      operation,
      subjectId,
      input
    ) {
      var signature = customBuildAttemptSignature(input);
      if (
        customBuildAttempt.accountId === accountId
        && customBuildAttempt.operation === operation
        && customBuildAttempt.subjectId === subjectId
        && customBuildAttempt.signature === signature
        && UUID.test(text(customBuildAttempt.commandId))
      ) return customBuildAttempt.commandId;
      var cryptoObject = windowRef.crypto;
      var commandId = cryptoObject
        && typeof cryptoObject.randomUUID === "function"
        ? cryptoObject.randomUUID()
        : "";
      if (!UUID.test(text(commandId))) {
        throw new Error(
          "This browser cannot safely identify the Custom website quote command. Update it and try again."
        );
      }
      customBuildAttempt = {
        accountId: accountId,
        commandId: commandId,
        operation: operation,
        signature: signature,
        subjectId: subjectId
      };
      storeCustomBuildAttempt(customBuildAttempt);
      return commandId;
    }

    function clearCustomBuildAttempt(commandId) {
      if (customBuildAttempt.commandId !== commandId) return;
      customBuildAttempt = emptyCustomBuildAttempt();
      storeCustomBuildAttempt(customBuildAttempt);
    }
    var alakazamReadSequence = 0;
    var alakazamRead = {
      projectId: "",
      phase: "idle",
      presentation: null
    };
    var alakazamReadAcceptedVersionId = "";
    var alakazamCommandSequence = 0;
    var alakazamCommand = {
      projectId: "",
      selectedTierId: "",
      phase: "idle",
      quote: null,
      quoteCommandId: "",
      checkoutCommandId: "",
      scheduleCommandId: "",
      setupCommandId: "",
      setupLabel: "",
      error: ""
    };
    var downloadCheckoutReturn =
      downloadCheckoutReturnFromLocation(
        windowRef.location
      );
    var assessmentCheckoutReturn =
      assessmentCheckoutReturnFromLocation(
        windowRef.location
      );
    var checkoutReturnStarted = false;
    var capabilities = Object.freeze({
      accountRegistration: false,
      accountRecoveryEmail: false,
      downloadQuote: false,
      downloadPayment: false,
      alakazamQuote: false,
      alakazamCheckout: false,
      alakazamDowngrade: false,
      domainPurchase: false,
      publishing: false
    });
    var activationToken =
      registrationTokenFromLocation(
        windowRef.location
      );
    var recoveryToken =
      recoveryTokenFromLocation(
        windowRef.location
      );
    if (
      (activationToken || recoveryToken)
      && windowRef.history
      && typeof windowRef.history.replaceState ===
        "function"
    ) {
      windowRef.history.replaceState(
        null,
        "",
        windowRef.location.pathname
          + windowRef.location.search
      );
    }

    function one(selector, rootNode) {
      return (rootNode || documentRef)
        .querySelector(selector);
    }

    function all(selector, rootNode) {
      return Array.prototype.slice.call(
        (rootNode || documentRef)
          .querySelectorAll(selector)
      );
    }

    var assessmentPanel =
      createAssessmentPanel(
        documentRef,
        {
          retry: function () {
            requestAssessment(
              idOf(lastState && lastState.project)
            );
          },
          save: function (input) {
            runAssessmentCommand(
              "saving",
              function (projectId) {
                return client
                  .saveCustomServicesAssessmentRequest(
                    projectId,
                    input
                  );
              }
            );
          },
          submit: function (draftRevision) {
            runAssessmentCommand(
              "submitting",
              function (projectId) {
                return client
                  .submitCustomServicesAssessmentRequest(
                    projectId,
                    draftRevision
                  );
              }
            );
          },
          withdraw: function () {
            runAssessmentCommand(
              "withdrawing",
              function (projectId) {
                return client
                  .withdrawCustomServicesAssessmentRequest(
                    projectId
                  );
              }
            );
          },
          acceptQuote: function (quoteState) {
            runAssessmentCommand(
              "accepting quote",
              function (projectId) {
                return client
                  .acceptCustomServicesAssessmentQuote(
                    projectId,
                    {
                      acceptanceStatement:
                        quoteState.actions.acceptQuote
                          .acceptanceStatement,
                      acceptedDisclosureDigest:
                        quoteState.quote.disclosureDigest,
                      acceptedQuoteDigest:
                        quoteState.quote.quoteDigest,
                      quoteId: quoteState.quote.quoteId,
                      quoteRevision:
                        quoteState.quote.revision
                    }
                  );
              }
            );
          },
          checkout: function (invoiceState) {
            requestAssessmentCheckout(invoiceState);
          }
        }
      );
    var ownerAssessmentPanel =
      createOwnerAssessmentPanel(
        documentRef,
        {
          issue: function (entry, input) {
            runOwnerAssessmentQuote(entry, input);
          }
        }
      );
    var ownerAssessmentWorkPanel =
      createOwnerAssessmentWorkPanel(
        documentRef,
        {
          refresh: function () {
            requestOwnerAssessmentJobs(
              text(lastState.account && lastState.account.id)
            );
          },
          evidence: function (job, input) {
            return runOwnerAssessmentEvidence(job, input);
          },
          finding: function (job, priority, input) {
            return runOwnerAssessmentFinding(
              job,
              priority,
              input
            );
          },
          deliver: function (job, input) {
            return runOwnerAssessmentDelivery(job, input);
          }
        }
      );
    var ownerCustomBuildPanel =
      createOwnerCustomBuildPanel(
        documentRef,
        {
          refresh: function () {
            requestOwnerCustomBuildOpportunities(
              text(lastState.account && lastState.account.id)
            );
          },
          issue: function (entry, input) {
            runOwnerCustomBuildIssue(entry, input);
          },
          void: function (entry, reason) {
            runOwnerCustomBuildVoid(entry, reason);
          }
        }
      );
    var ownerCustomBuildWorkPanel =
      createOwnerCustomBuildWorkPanel(
        documentRef,
        {
          refresh: function () {
            requestOwnerCustomBuildJobs(
              text(lastState.account && lastState.account.id)
            );
          },
          next: function (cursor) {
            requestOwnerCustomBuildJobs(
              text(lastState.account && lastState.account.id),
              cursor
            );
          },
          refreshProgress: function (entry) {
            return requestOwnerCustomBuildProgress(entry);
          },
          progress: function (entry, snapshot, input) {
            return runOwnerCustomBuildProgressCommand(
              "progress",
              entry,
              snapshot,
              input
            );
          },
          request: function (entry, snapshot, input) {
            return runOwnerCustomBuildProgressCommand(
              "request",
              entry,
              snapshot,
              input
            );
          },
          resolve: function (entry, snapshot, input) {
            return runOwnerCustomBuildProgressCommand(
              input.state === "withdrawn" ? "withdraw" : "resolve",
              entry,
              snapshot,
              input
            );
          },
          refreshChangeCompletion: function (entry) {
            return requestOwnerCustomBuildChangeCompletion(entry);
          },
          refreshChangePayments: function (entry) {
            return requestOwnerCustomBuildChangePayments(entry);
          },
          reconcileChangePayment: function (entry, payment) {
            return runOwnerCustomBuildChangePaymentReconciliation(
              entry,
              payment
            );
          },
          issueChange: function (entry, snapshot, input) {
            return runOwnerCustomBuildChangeCompletionCommand(
              "issue-change",
              entry,
              snapshot,
              input
            );
          },
          voidChange: function (entry, order, input) {
            return runOwnerCustomBuildChangeCompletionCommand(
              "void-change",
              entry,
              null,
              Object.assign({}, input, { order: order })
            );
          },
          expireChange: function (entry, order) {
            return runOwnerCustomBuildChangeCompletionCommand(
              "expire-change",
              entry,
              null,
              { order: order }
            );
          },
          evidence: function (entry, snapshot, input) {
            return runOwnerCustomBuildChangeCompletionCommand(
              "evidence",
              entry,
              snapshot,
              input
            );
          },
          complete: function (entry, snapshot, input) {
            return runOwnerCustomBuildChangeCompletionCommand(
              "complete",
              entry,
              snapshot,
              input
            );
          },
          localError: function (entry, error) {
            setOwnerCustomBuildChangeCompletionError(entry, error);
          }
        }
      );
    var customerCustomBuildPanel =
      createCustomerCustomBuildPanel(
        documentRef,
        {
          retry: function () {
            requestCustomerCustomBuildQuote(
              idOf(lastState && lastState.project)
            );
          },
          accept: function (snapshot) {
            runCustomerCustomBuildAcceptance(snapshot);
          },
          checkout: function (invoiceState) {
            requestCustomerCustomBuildCheckout(invoiceState);
          }
        }
      );
    var customerCustomBuildProgressPanel =
      createCustomerCustomBuildProgressPanel(
        documentRef,
        {
          refresh: function () {
            return requestCustomerCustomBuildProgress(
              idOf(lastState && lastState.project)
            );
          },
          respond: function (snapshot, input) {
            return runCustomerCustomBuildProgressResponse(
              snapshot,
              input
            );
          }
        }
      );
    var customerCustomBuildChangeCompletionPanel =
      createCustomerCustomBuildChangeCompletionPanel(
        documentRef,
        {
          refresh: function () {
            return requestCustomerCustomBuildChangeCompletion(
              idOf(lastState && lastState.project)
            );
          },
          accept: function (order) {
            return runCustomerCustomBuildChangeDecision(
              "accept",
              order
            );
          },
          decline: function (order) {
            return runCustomerCustomBuildChangeDecision(
              "decline",
              order
            );
          },
          checkout: function (invoiceState) {
            return requestCustomerCustomBuildChangeCheckout(
              invoiceState
            );
          },
          evidence: function (entry, fallbackUrl) {
            return openCustomerCustomBuildCompletionEvidence(
              entry,
              fallbackUrl
            );
          }
        }
      );
    var alakazamPanel =
      createAlakazamAccountPanel(
        documentRef,
        {
          retry: function () {
            var projectId = idOf(
              lastState && lastState.project
            );
            if (lastState.account && projectId) {
              if (
                alakazamCommand.phase === "scheduled"
                && record(alakazamCommand.scheduled)
              ) {
                refreshAlakazamAccountAfterDowngrade(
                  projectId,
                  alakazamCommand.scheduled
                );
              } else {
                requestAlakazamAccount(projectId);
              }
            }
          },
          quote: function (tierId) {
            requestAlakazamQuote(tierId);
          },
          checkout: function () {
            requestAlakazamCheckout();
          },
          downgrade: function () {
            requestAlakazamDowngrade();
          },
          configure: function (addressLabel) {
            requestAlakazamSiteSetup(addressLabel);
          }
        }
      );
    var alakazamAnchor =
      one(".customer-separate-help");
    if (
      alakazamAnchor
      && alakazamAnchor.parentNode
    ) {
      alakazamAnchor.parentNode.insertBefore(
        assessmentPanel.element,
        alakazamAnchor
      );
      alakazamAnchor.parentNode.insertBefore(
        ownerAssessmentPanel.element,
        assessmentPanel.element
      );
      alakazamAnchor.parentNode.insertBefore(
        ownerAssessmentWorkPanel.element,
        assessmentPanel.element
      );
      alakazamAnchor.parentNode.insertBefore(
        ownerCustomBuildPanel.element,
        assessmentPanel.element
      );
      alakazamAnchor.parentNode.insertBefore(
        ownerCustomBuildWorkPanel.element,
        assessmentPanel.element
      );
      alakazamAnchor.parentNode.insertBefore(
        customerCustomBuildPanel.element,
        alakazamAnchor
      );
      alakazamAnchor.parentNode.insertBefore(
        customerCustomBuildProgressPanel.element,
        alakazamAnchor
      );
      alakazamAnchor.parentNode.insertBefore(
        customerCustomBuildChangeCompletionPanel.element,
        alakazamAnchor
      );
    }
    if (
      alakazamAnchor
      && alakazamAnchor.parentNode
    ) {
      alakazamAnchor.parentNode.insertBefore(
        alakazamPanel.element,
        alakazamAnchor
      );
    } else {
      var controlShell = one(
        ".site-shell",
        controlRoom
      );
      if (controlShell) {
        controlShell.appendChild(
          ownerAssessmentPanel.element
        );
        controlShell.appendChild(
          ownerAssessmentWorkPanel.element
        );
        controlShell.appendChild(
          ownerCustomBuildPanel.element
        );
        controlShell.appendChild(
          ownerCustomBuildWorkPanel.element
        );
        controlShell.appendChild(
          assessmentPanel.element
        );
        controlShell.appendChild(
          customerCustomBuildPanel.element
        );
        controlShell.appendChild(
          customerCustomBuildProgressPanel.element
        );
        controlShell.appendChild(
          customerCustomBuildChangeCompletionPanel.element
        );
        controlShell.appendChild(
          alakazamPanel.element
        );
      }
    }

    function value(name) {
      var field = one('[name="' + name + '"]');
      return field ? field.value : "";
    }

    function announce(message, kind) {
      status.hidden = false;
      status.textContent = message;
      status.classList.toggle(
        "is-error",
        kind === "error"
      );
      status.classList.toggle(
        "is-success",
        kind === "success"
      );
    }

    function explain(error, fallback) {
      var message =
        error && error.message
          ? error.message
          : fallback;
      var requestId =
        error && error.requestId
          ? " Request " + error.requestId + "."
          : "";
      return message + requestId;
    }

    function renderOwnerAssessmentPanel() {
      ownerAssessmentPanel.render(ownerQuoteRead);
    }

    function requestOwnerAssessmentQueue(accountId) {
      var selectedAccountId = text(accountId);
      if (
        !selectedAccountId
        || typeof client.listOwnerAssessmentRequests !== "function"
      ) return Promise.resolve(null);
      ownerQuoteRead = {
        accountId: selectedAccountId,
        phase: "loading",
        queue: null,
        busyCaseId: "",
        error: ""
      };
      renderOwnerAssessmentPanel();
      return client.listOwnerAssessmentRequests()
        .then(function (queue) {
          if (
            ownerQuoteRead.accountId !== selectedAccountId
            || !lastState.account
          ) return null;
          ownerQuoteRead = {
            accountId: selectedAccountId,
            phase: "ready",
            queue: queue,
            busyCaseId: "",
            error: ""
          };
          renderOwnerAssessmentPanel();
          return queue;
        })
        .catch(function (error) {
          if (ownerQuoteRead.accountId !== selectedAccountId) {
            return null;
          }
          ownerQuoteRead = {
            accountId: selectedAccountId,
            phase:
              error && [401, 403, 503].includes(error.status)
                ? "unavailable"
                : "error",
            queue: null,
            busyCaseId: "",
            error: ""
          };
          renderOwnerAssessmentPanel();
          return null;
        });
    }

    function runOwnerAssessmentQuote(entry, input) {
      if (
        !entry
        || !ownerQuoteRead.queue
        || ownerQuoteRead.busyCaseId
        || typeof client.issueOwnerAssessmentQuote !== "function"
      ) return Promise.resolve(null);
      var selectedAccountId = ownerQuoteRead.accountId;
      ownerQuoteRead = Object.assign({}, ownerQuoteRead, {
        busyCaseId: entry.caseId,
        error: ""
      });
      renderOwnerAssessmentPanel();
      return client.issueOwnerAssessmentQuote(
        entry.caseId,
        input
      )
        .then(function () {
          if (ownerQuoteRead.accountId !== selectedAccountId) {
            return null;
          }
          return requestOwnerAssessmentQueue(selectedAccountId);
        })
        .catch(function (error) {
          if (ownerQuoteRead.accountId !== selectedAccountId) {
            return null;
          }
          ownerQuoteRead = Object.assign({}, ownerQuoteRead, {
            busyCaseId: "",
            error: explain(
              error,
              "The assessment quote could not be issued."
            )
          });
          renderOwnerAssessmentPanel();
          return null;
        });
    }

    function syncOwnerAssessmentAccount(state) {
      var nextAccountId = text(
        state && state.account && state.account.id
      );
      if (!nextAccountId) {
        if (ownerQuoteRead.accountId) {
          ownerQuoteRead = {
            accountId: "",
            phase: "idle",
            queue: null,
            busyCaseId: "",
            error: ""
          };
          renderOwnerAssessmentPanel();
        }
        return;
      }
      if (ownerQuoteRead.accountId !== nextAccountId) {
        requestOwnerAssessmentQueue(nextAccountId);
      }
    }

    function renderOwnerAssessmentWorkPanel() {
      ownerAssessmentWorkPanel.render(ownerWorkRead);
    }

    function ownerAssessmentWorkIsCurrent(sequence, accountId) {
      return sequence === ownerWorkReadSequence
        && ownerWorkRead.accountId === accountId
        && text(lastState.account && lastState.account.id) === accountId;
    }

    function requestOwnerAssessmentJobs(accountId) {
      var selectedAccountId = text(accountId);
      var sequence = ++ownerWorkReadSequence;
      if (
        !selectedAccountId
        || typeof client.listOwnerAssessmentJobs !== "function"
      ) {
        ownerWorkRead = {
          accountId: selectedAccountId,
          phase: "unavailable",
          jobs: null,
          busyKey: "",
          error: ""
        };
        renderOwnerAssessmentWorkPanel();
        return Promise.resolve(null);
      }
      ownerWorkRead = {
        accountId: selectedAccountId,
        phase: "loading",
        jobs: null,
        busyKey: "",
        error: ""
      };
      renderOwnerAssessmentWorkPanel();
      return client.listOwnerAssessmentJobs()
        .then(function (jobs) {
          if (!ownerAssessmentWorkIsCurrent(sequence, selectedAccountId)) {
            return null;
          }
          if (!verifiedOwnerAssessmentJobs(jobs)) {
            throw new Error(
              "The assessment job response could not be verified."
            );
          }
          ownerWorkRead = {
            accountId: selectedAccountId,
            phase: "ready",
            jobs: jobs,
            busyKey: "",
            error: ""
          };
          renderOwnerAssessmentWorkPanel();
          return jobs;
        })
        .catch(function (error) {
          if (!ownerAssessmentWorkIsCurrent(sequence, selectedAccountId)) {
            return null;
          }
          ownerWorkRead = {
            accountId: selectedAccountId,
            phase: error && [401, 403, 503].includes(error.status)
              ? "unavailable"
              : "error",
            jobs: null,
            busyKey: "",
            error: error && [401, 403, 503].includes(error.status)
              ? ""
              : explain(
                  error,
                  "Paid assessment jobs could not be loaded."
                )
          };
          renderOwnerAssessmentWorkPanel();
          return null;
        });
    }

    function freshOwnerAssessmentCommandId() {
      var cryptoObject = windowRef.crypto;
      var commandId = cryptoObject
        && typeof cryptoObject.randomUUID === "function"
        ? cryptoObject.randomUUID()
        : "";
      if (!UUID.test(text(commandId))) {
        throw new Error(
          "This browser cannot safely identify the assessment work request. Update it and try again."
        );
      }
      return commandId;
    }

    function currentOwnerAssessmentJob(job) {
      var jobs = verifiedOwnerAssessmentJobs(ownerWorkRead.jobs);
      if (!jobs || !job) return null;
      return jobs.jobs.find(function (entry) {
        return entry.jobId === job.jobId
          && entry.organizationId === job.organizationId;
      }) || null;
    }

    function runOwnerAssessmentWork(
      job,
      action,
      invoke,
      verify,
      fallback
    ) {
      var current = currentOwnerAssessmentJob(job);
      if (
        !current
        || current.state !== "open"
        || ownerWorkRead.phase !== "ready"
        || ownerWorkRead.busyKey
      ) return Promise.resolve(null);
      var selectedAccountId = ownerWorkRead.accountId;
      var sequence = ownerWorkReadSequence;
      var busyKey = current.jobId + ":" + action;
      ownerWorkRead = Object.assign({}, ownerWorkRead, {
        busyKey: busyKey,
        error: ""
      });
      renderOwnerAssessmentWorkPanel();
      return Promise.resolve()
        .then(invoke)
        .then(function (result) {
          if (
            !ownerAssessmentWorkIsCurrent(sequence, selectedAccountId)
            || ownerWorkRead.busyKey !== busyKey
          ) return null;
          if (!verify(result)) {
            throw new Error(
              "The assessment work response could not be verified. Nothing else was changed."
            );
          }
          return requestOwnerAssessmentJobs(selectedAccountId)
            .then(function () {
              return result;
            });
        })
        .catch(function (error) {
          if (!ownerAssessmentWorkIsCurrent(sequence, selectedAccountId)) {
            return null;
          }
          if (error && [401, 403, 503].includes(error.status)) {
            ownerWorkRead = {
              accountId: selectedAccountId,
              phase: "unavailable",
              jobs: null,
              busyKey: "",
              error: ""
            };
          } else {
            ownerWorkRead = Object.assign({}, ownerWorkRead, {
              busyKey: "",
              error: explain(error, fallback)
            });
          }
          renderOwnerAssessmentWorkPanel();
          ownerAssessmentWorkPanel.focusStatus();
          return null;
        });
    }

    function runOwnerAssessmentEvidence(job, input) {
      if (
        typeof client.uploadOwnerAssessmentEvidence !== "function"
      ) return Promise.resolve(null);
      var signature = ownerAssessmentEvidenceSignature(job, input);
      var commandId;
      try {
        commandId = ownerEvidenceAttempt.accountId === ownerWorkRead.accountId
          && ownerEvidenceAttempt.jobId === job.jobId
          && ownerEvidenceAttempt.signature === signature
          && UUID.test(text(ownerEvidenceAttempt.commandId))
          ? ownerEvidenceAttempt.commandId
          : freshOwnerAssessmentCommandId();
      } catch (error) {
        ownerWorkRead = Object.assign({}, ownerWorkRead, {
          error: explain(
            error,
            "The screenshot upload could not start."
          )
        });
        renderOwnerAssessmentWorkPanel();
        return Promise.resolve(null);
      }
      ownerEvidenceAttempt = {
        accountId: ownerWorkRead.accountId,
        jobId: job.jobId,
        signature: signature,
        commandId: commandId
      };
      storeOwnerEvidenceAttempt(ownerEvidenceAttempt);
      return runOwnerAssessmentWork(
        job,
        "uploading evidence",
        function () {
          return client.uploadOwnerAssessmentEvidence(
            job.jobId,
            input,
            { idempotencyKey: commandId }
          );
        },
        function (result) {
          var verified = verifiedOwnerAssessmentEvidence(
            result,
            job.jobId
          );
          if (verified) {
            ownerEvidenceAttempt = emptyOwnerEvidenceAttempt();
            storeOwnerEvidenceAttempt(ownerEvidenceAttempt);
          }
          return Boolean(verified);
        },
        "The screenshot evidence could not be uploaded safely."
      );
    }

    function runOwnerAssessmentFinding(job, priority, input) {
      if (
        typeof client.putOwnerAssessmentFinding !== "function"
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = freshOwnerAssessmentCommandId();
      } catch (error) {
        ownerWorkRead = Object.assign({}, ownerWorkRead, {
          error: explain(error, "The finding could not be saved.")
        });
        renderOwnerAssessmentWorkPanel();
        return Promise.resolve(null);
      }
      return runOwnerAssessmentWork(
        job,
        "saving finding " + priority,
        function () {
          return client.putOwnerAssessmentFinding(
            job.jobId,
            priority,
            input,
            { idempotencyKey: commandId }
          );
        },
        function (result) {
          return Boolean(verifiedOwnerAssessmentFinding(
            result,
            job.jobId,
            priority
          ));
        },
        "The assessment finding could not be saved safely."
      );
    }

    function runOwnerAssessmentDelivery(job, input) {
      var current = currentOwnerAssessmentJob(job);
      if (
        !current
        || !ownerAssessmentCoverageComplete(current)
        || !ownerAssessmentFindingsReady(current)
        || typeof client.deliverOwnerAssessmentReport !== "function"
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = freshOwnerAssessmentCommandId();
      } catch (error) {
        ownerWorkRead = Object.assign({}, ownerWorkRead, {
          error: explain(
            error,
            "The assessment report delivery could not start."
          )
        });
        renderOwnerAssessmentWorkPanel();
        return Promise.resolve(null);
      }
      return runOwnerAssessmentWork(
        job,
        "delivering report",
        function () {
          return client.deliverOwnerAssessmentReport(
            job.jobId,
            input,
            { idempotencyKey: commandId }
          );
        },
        function (result) {
          return Boolean(verifiedOwnerAssessmentDelivery(
            result,
            job.jobId
          ));
        },
        "The immutable assessment report could not be delivered safely."
      ).then(function (result) {
        if (result && ownerWorkRead.accountId) {
          requestOwnerCustomBuildOpportunities(
            ownerWorkRead.accountId
          );
        }
        return result;
      });
    }

    function syncOwnerAssessmentWorkAccount(state) {
      var nextAccountId = text(
        state && state.account && state.account.id
      );
      if (!nextAccountId) {
        if (ownerWorkRead.accountId) {
          ownerWorkReadSequence += 1;
          ownerWorkRead = {
            accountId: "",
            phase: "idle",
            jobs: null,
            busyKey: "",
            error: ""
          };
          ownerEvidenceAttempt = emptyOwnerEvidenceAttempt();
          storeOwnerEvidenceAttempt(ownerEvidenceAttempt);
          renderOwnerAssessmentWorkPanel();
        }
        return;
      }
      if (ownerWorkRead.accountId !== nextAccountId) {
        ownerEvidenceAttempt = emptyOwnerEvidenceAttempt();
        storeOwnerEvidenceAttempt(ownerEvidenceAttempt);
        requestOwnerAssessmentJobs(nextAccountId);
      }
    }

    function renderOwnerCustomBuildPanel() {
      ownerCustomBuildPanel.render(ownerCustomBuildRead);
    }

    function ownerCustomBuildReadIsCurrent(sequence, accountId) {
      return sequence === ownerCustomBuildReadSequence
        && ownerCustomBuildRead.accountId === accountId
        && text(lastState.account && lastState.account.id) === accountId;
    }

    function requestOwnerCustomBuildOpportunities(accountId) {
      var selectedAccountId = text(accountId);
      var sequence = ++ownerCustomBuildReadSequence;
      if (
        !selectedAccountId
        || typeof client.listOwnerCustomBuildOpportunities !== "function"
      ) {
        ownerCustomBuildRead = {
          accountId: selectedAccountId,
          phase: "unavailable",
          opportunities: null,
          busyKey: "",
          error: ""
        };
        renderOwnerCustomBuildPanel();
        return Promise.resolve(null);
      }
      ownerCustomBuildRead = {
        accountId: selectedAccountId,
        phase: "loading",
        opportunities: null,
        busyKey: "",
        error: ""
      };
      renderOwnerCustomBuildPanel();
      return client.listOwnerCustomBuildOpportunities()
        .then(function (result) {
          if (!ownerCustomBuildReadIsCurrent(
            sequence,
            selectedAccountId
          )) return null;
          if (!verifiedOwnerCustomBuildOpportunities(result)) {
            throw new Error(
              "The Custom build opportunity response could not be verified."
            );
          }
          ownerCustomBuildRead = {
            accountId: selectedAccountId,
            phase: "ready",
            opportunities: result,
            busyKey: "",
            error: ""
          };
          renderOwnerCustomBuildPanel();
          return result;
        })
        .catch(function (error) {
          if (!ownerCustomBuildReadIsCurrent(
            sequence,
            selectedAccountId
          )) return null;
          ownerCustomBuildRead = {
            accountId: selectedAccountId,
            phase: error && [401, 403, 503].includes(error.status)
              ? "unavailable"
              : "error",
            opportunities: null,
            busyKey: "",
            error: error && [401, 403, 503].includes(error.status)
              ? ""
              : explain(
                  error,
                  "Custom build opportunities could not be loaded."
                )
          };
          renderOwnerCustomBuildPanel();
          return null;
        });
    }

    function currentOwnerCustomBuildOpportunity(entry) {
      var queue = verifiedOwnerCustomBuildOpportunities(
        ownerCustomBuildRead.opportunities
      );
      if (!queue || !entry) return null;
      return queue.opportunities.find(function (candidate) {
        return candidate.assessment.jobId === entry.assessment.jobId
          && candidate.projectId === entry.projectId
          && candidate.assessment.reportId === entry.assessment.reportId
          && candidate.organizationId === entry.organizationId;
      }) || null;
    }

    function runOwnerCustomBuildIssue(entry, input) {
      var current = currentOwnerCustomBuildOpportunity(entry);
      var accountId = ownerCustomBuildRead.accountId;
      if (
        !current
        || (current.currentQuote !== null
          && current.currentQuote.state !== "voided")
        || !["available", "released"].includes(current.credit.state)
        || ownerCustomBuildRead.busyKey
        || typeof client.issueOwnerCustomBuildQuote !== "function"
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "issue",
          current.assessment.jobId,
          input
        );
      } catch (error) {
        ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
          error: explain(
            error,
            "The Custom build quote command could not start."
          )
        });
        renderOwnerCustomBuildPanel();
        return Promise.resolve(null);
      }
      var sequence = ownerCustomBuildReadSequence;
      ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
        busyKey: "issue:" + current.assessment.jobId,
        error: ""
      });
      renderOwnerCustomBuildPanel();
      return Promise.resolve().then(function () {
        return client.issueOwnerCustomBuildQuote(
          current.assessment.jobId,
          Object.assign({}, input, { commandId: commandId })
        );
      }).then(function (result) {
        if (!ownerCustomBuildReadIsCurrent(sequence, accountId)) {
          return null;
        }
        var receipt = verifiedOwnerCustomBuildQuoteReceipt(result);
        if (
          !receipt
          || receipt.state !== "issued"
          || receipt.organizationId !== current.organizationId
          || receipt.projectId !== current.projectId
          || receipt.customerId !== current.customer.customerId
          || receipt.caseId !== current.caseId
          || receipt.jobId !== current.assessment.jobId
          || receipt.reportId !== current.assessment.reportId
          || receipt.quote.tier.id !== input.tierId
        ) {
          throw new Error(
            "The issued Custom build quote receipt could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        return requestOwnerCustomBuildOpportunities(accountId);
      }).catch(function (error) {
        if (!ownerCustomBuildReadIsCurrent(sequence, accountId)) {
          return null;
        }
        ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
          busyKey: "",
          error: explain(
            error,
            "The exact Custom build quote could not be issued. The same command can be retried safely."
          )
        });
        renderOwnerCustomBuildPanel();
        ownerCustomBuildPanel.focusStatus();
        return null;
      });
    }

    function runOwnerCustomBuildVoid(entry, reason) {
      var current = currentOwnerCustomBuildOpportunity(entry);
      var accountId = ownerCustomBuildRead.accountId;
      var quote = current && current.currentQuote;
      var input = {
        organizationId: current && current.organizationId,
        reason: text(reason)
      };
      if (
        !current
        || !quote
        || ownerCustomBuildRead.busyKey
        || typeof client.voidOwnerCustomBuildQuote !== "function"
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "void",
          quote.quoteId,
          input
        );
      } catch (error) {
        ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
          error: explain(
            error,
            "The safe quote void could not start."
          )
        });
        renderOwnerCustomBuildPanel();
        return Promise.resolve(null);
      }
      var sequence = ownerCustomBuildReadSequence;
      ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
        busyKey: "void:" + quote.quoteId,
        error: ""
      });
      renderOwnerCustomBuildPanel();
      return Promise.resolve().then(function () {
        return client.voidOwnerCustomBuildQuote(
          quote.quoteId,
          Object.assign({}, input, { commandId: commandId })
        );
      }).then(function (result) {
        if (!ownerCustomBuildReadIsCurrent(sequence, accountId)) {
          return null;
        }
        var receipt = verifiedOwnerCustomBuildQuoteReceipt(result);
        if (
          !receipt
          || receipt.state !== "voided"
          || receipt.organizationId !== current.organizationId
          || receipt.projectId !== current.projectId
          || receipt.quote.quoteId !== quote.quoteId
          || receipt.quote.quoteDigest !== quote.quoteDigest
        ) {
          throw new Error(
            "The safely voided Custom build quote receipt could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        return requestOwnerCustomBuildOpportunities(accountId);
      }).catch(function (error) {
        if (!ownerCustomBuildReadIsCurrent(sequence, accountId)) {
          return null;
        }
        ownerCustomBuildRead = Object.assign({}, ownerCustomBuildRead, {
          busyKey: "",
          error: explain(
            error,
            "The quote was not confirmed void. The same command can be retried safely."
          )
        });
        renderOwnerCustomBuildPanel();
        ownerCustomBuildPanel.focusStatus();
        return null;
      });
    }

    function syncOwnerCustomBuildAccount(state) {
      var nextAccountId = text(
        state && state.account && state.account.id
      );
      if (!nextAccountId) {
        if (ownerCustomBuildRead.accountId) {
          ownerCustomBuildReadSequence += 1;
          ownerCustomBuildRead = {
            accountId: "",
            phase: "idle",
            opportunities: null,
            busyKey: "",
            error: ""
          };
          renderOwnerCustomBuildPanel();
        }
        return;
      }
      if (ownerCustomBuildRead.accountId !== nextAccountId) {
        requestOwnerCustomBuildOpportunities(nextAccountId);
      }
    }

    function renderOwnerCustomBuildWorkPanel() {
      ownerCustomBuildWorkPanel.render(ownerCustomBuildWorkRead);
    }

    function ownerCustomBuildWorkReadIsCurrent(sequence, accountId) {
      return sequence === ownerCustomBuildWorkReadSequence
        && ownerCustomBuildWorkRead.accountId === accountId
        && text(lastState.account && lastState.account.id) === accountId;
    }

    function ownerCustomBuildProgressEntryIsCurrent(entry) {
      var jobs = verifiedOwnerCustomBuildJobs(
        ownerCustomBuildWorkRead.jobs
      );
      return Boolean(jobs) && jobs.jobs.some(function (candidate) {
        return candidate.job.jobId === entry.job.jobId
          && candidate.organizationId === entry.organizationId;
      });
    }

    function setOwnerCustomBuildProgress(jobId, value) {
      var next = Object.assign(
        {},
        ownerCustomBuildWorkRead.progressByJob || {}
      );
      next[jobId] = value;
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { progressByJob: next }
      );
      renderOwnerCustomBuildWorkPanel();
    }

    function requestOwnerCustomBuildProgress(entry) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      if (
        !accountId
        || !jobId
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
      ) return Promise.resolve(null);
      if (typeof client.getOwnerCustomBuildProgress !== "function") {
        setOwnerCustomBuildProgress(jobId, {
          phase: "error",
          snapshot: null,
          busy: "",
          error: "Paid project progress is unavailable in this build."
        });
        return Promise.resolve(null);
      }
      var retained = ownerCustomBuildWorkRead.progressByJob
        && ownerCustomBuildWorkRead.progressByJob[jobId];
      setOwnerCustomBuildProgress(jobId, {
        phase: "loading",
        snapshot: retained && retained.snapshot || null,
        busy: "",
        error: ""
      });
      return client.getOwnerCustomBuildProgress(
        jobId,
        entry.organizationId
      ).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var snapshot = verifiedCustomBuildProgress(result, jobId);
        if (
          !snapshot
          || snapshot.state !== "active"
          || snapshot.targetCompletionDate !==
            entry.job.targetCompletionDate
        ) {
          throw new Error(
            "The paid project's progress response could not be verified."
          );
        }
        setOwnerCustomBuildProgress(jobId, {
          phase: "ready",
          snapshot: snapshot,
          busy: "",
          error: ""
        });
        return snapshot;
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        setOwnerCustomBuildProgress(jobId, {
          phase: "error",
          snapshot: retained && retained.snapshot || null,
          busy: "",
          error: explain(
            error,
            "Progress could not be loaded. Refresh this project before making a change."
          )
        });
        return null;
      });
    }

    function requestOwnerCustomBuildProgressBatch(entries) {
      var pending = entries.slice();
      function next() {
        var entry = pending.shift();
        if (!entry) return Promise.resolve(null);
        return requestOwnerCustomBuildProgress(entry).then(next);
      }
      return Promise.all(
        entries.slice(0, 4).map(function () { return next(); })
      );
    }

    function setOwnerCustomBuildChangeCompletion(jobId, value) {
      var next = Object.assign(
        {},
        ownerCustomBuildWorkRead.changeCompletionByJob || {}
      );
      next[jobId] = value;
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { changeCompletionByJob: next }
      );
      renderOwnerCustomBuildWorkPanel();
    }

    function setOwnerCustomBuildChangeCompletionError(entry, error) {
      if (!ownerCustomBuildProgressEntryIsCurrent(entry)) return;
      var jobId = entry.job.jobId;
      var read = ownerCustomBuildWorkRead.changeCompletionByJob
        && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
      setOwnerCustomBuildChangeCompletion(jobId, {
        phase: read && read.snapshot ? "ready" : "error",
        snapshot: read && read.snapshot || null,
        busy: "",
        error: explain(
          error,
          "That completion proof could not be prepared safely."
        )
      });
    }

    function requestOwnerCustomBuildChangeCompletion(entry) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      if (
        !accountId
        || !jobId
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
      ) return Promise.resolve(null);
      var retainedRead = ownerCustomBuildWorkRead.changeCompletionByJob
        && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
      var retained = retainedRead
        && verifiedOwnerCustomBuildChangeCompletion(
          retainedRead.snapshot,
          entry
        );
      if (
        typeof client.getOwnerCustomBuildChangeCompletion !== "function"
      ) {
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "error",
          snapshot: retained,
          busy: "",
          error:
            "Added-work and completion controls are unavailable in this build."
        });
        return Promise.resolve(null);
      }
      setOwnerCustomBuildChangeCompletion(jobId, {
        phase: "loading",
        snapshot: retained,
        busy: "",
        error: ""
      });
      return client.getOwnerCustomBuildChangeCompletion(
        jobId,
        entry.organizationId
      ).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var snapshot = verifiedOwnerCustomBuildChangeCompletion(
          result,
          entry
        );
        if (!snapshot) {
          throw new Error(
            "The paid project's added-work and completion response could not be verified."
          );
        }
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "ready",
          snapshot: snapshot,
          busy: "",
          error: ""
        });
        return snapshot;
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var held = text(error && error.code) ===
          "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
          || Number(error && error.status) === 503;
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "error",
          snapshot: retained,
          busy: "",
          error: held
            ? "Added-work and completion tools are held or unavailable. Nothing changed and no action is available."
            : explain(
                error,
                "Added work and completion could not be loaded. The last verified information remains available."
              )
        });
        return null;
      });
    }

    function requestOwnerCustomBuildChangeCompletionBatch(entries) {
      var pending = entries.slice();
      function next() {
        var entry = pending.shift();
        if (!entry) return Promise.resolve(null);
        return requestOwnerCustomBuildChangeCompletion(entry).then(next);
      }
      return Promise.all(
        entries.slice(0, 4).map(function () { return next(); })
      );
    }

    function setOwnerCustomBuildChangePayments(jobId, value) {
      var next = Object.assign(
        {},
        ownerCustomBuildWorkRead.changePaymentsByJob || {}
      );
      next[jobId] = value;
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { changePaymentsByJob: next }
      );
      renderOwnerCustomBuildWorkPanel();
    }

    function requestOwnerCustomBuildChangePayments(entry) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      if (
        !accountId
        || !jobId
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
      ) return Promise.resolve(null);
      var changeRead = ownerCustomBuildWorkRead.changeCompletionByJob
        && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
      var changeCompletion = changeRead
        && verifiedOwnerCustomBuildChangeCompletion(
          changeRead.snapshot,
          entry
        );
      var retainedRead = ownerCustomBuildWorkRead.changePaymentsByJob
        && ownerCustomBuildWorkRead.changePaymentsByJob[jobId];
      var retained = retainedRead
        && verifiedOwnerCustomBuildChangePayments(
          retainedRead.snapshot,
          entry,
          changeCompletion
        );
      var retainedNotice = text(retainedRead && retainedRead.notice);
      if (
        typeof client.getOwnerCustomBuildChangePayments !== "function"
      ) {
        setOwnerCustomBuildChangePayments(jobId, {
          phase: "error",
          snapshot: retained,
          busy: "",
          notice: retainedNotice,
          error:
            "Added-work payment reconciliation is unavailable in this build."
        });
        return Promise.resolve(null);
      }
      setOwnerCustomBuildChangePayments(jobId, {
        phase: "loading",
        snapshot: retained,
        busy: "",
        notice: retainedNotice,
        error: ""
      });
      return client.getOwnerCustomBuildChangePayments(
        jobId,
        entry.organizationId
      ).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var currentChangeRead =
          ownerCustomBuildWorkRead.changeCompletionByJob
          && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
        var currentChange = currentChangeRead
          && verifiedOwnerCustomBuildChangeCompletion(
            currentChangeRead.snapshot,
            entry
          );
        var snapshot = verifiedOwnerCustomBuildChangePayments(
          result,
          entry,
          currentChange
        );
        if (!snapshot) {
          throw new Error(
            "The exact added-work payment records could not be verified."
          );
        }
        setOwnerCustomBuildChangePayments(jobId, {
          phase: "ready",
          snapshot: snapshot,
          busy: "",
          notice: retainedNotice,
          error: ""
        });
        return snapshot;
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var held = [401, 403, 503].includes(Number(error && error.status))
          || [
            "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
            "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE"
          ].includes(text(error && error.code));
        setOwnerCustomBuildChangePayments(jobId, {
          phase: "error",
          snapshot: retained,
          busy: "",
          notice: retainedNotice,
          error: held
            ? "Added-work payment reconciliation is held or unavailable. No provider action was taken."
            : explain(
                error,
                "Added-work payment records could not be refreshed. The last verified records remain below."
              )
        });
        ownerCustomBuildWorkPanel.focusChangePaymentStatus(jobId);
        return null;
      });
    }

    function requestOwnerCustomBuildChangePaymentsBatch(entries) {
      var pending = entries.slice();
      function next() {
        var entry = pending.shift();
        if (!entry) return Promise.resolve(null);
        return requestOwnerCustomBuildChangePayments(entry).then(next);
      }
      return Promise.all(
        entries.slice(0, 4).map(function () { return next(); })
      );
    }

    function runOwnerCustomBuildChangePaymentReconciliation(
      entry,
      paymentInput
    ) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      var changeRead = jobId
        && ownerCustomBuildWorkRead.changeCompletionByJob
        && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
      var changeCompletion = changeRead
        && verifiedOwnerCustomBuildChangeCompletion(
          changeRead.snapshot,
          entry
        );
      var read = jobId
        && ownerCustomBuildWorkRead.changePaymentsByJob
        && ownerCustomBuildWorkRead.changePaymentsByJob[jobId];
      var payments = changeCompletion
        && read
        && verifiedOwnerCustomBuildChangePayments(
          read.snapshot,
          entry,
          changeCompletion
        );
      var selectedAttemptId = text(
        paymentInput && paymentInput.owner
          && paymentInput.owner.attemptId
      );
      var selectedInvoiceId = text(
        paymentInput && paymentInput.invoice
          && paymentInput.invoice.invoiceId
      );
      var selectedInvoiceDigest = text(
        paymentInput && paymentInput.invoice
          && paymentInput.invoice.invoiceDigest
      );
      var payment = payments && payments.payments.find(function (candidate) {
        return candidate.owner.attemptId ===
            selectedAttemptId
          && candidate.invoice.invoiceId ===
            selectedInvoiceId
          && candidate.invoice.invoiceDigest ===
            selectedInvoiceDigest;
      });
      if (
        !accountId
        || !jobId
        || !payment
        || Boolean(read.busy)
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
        || (
          !payment.owner.canReconcileCreation
          && !payment.owner.canReconcileSettlement
        )
      ) return Promise.resolve(null);
      if (
        typeof client.reconcileOwnerCustomBuildChangeCheckout !==
          "function"
      ) {
        setOwnerCustomBuildChangePayments(
          jobId,
          Object.assign({}, read, {
            error:
              "Exact Stripe reconciliation is unavailable in this build."
          })
        );
        return Promise.resolve(null);
      }
      var commandBody = {
        organizationId: entry.organizationId
      };
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "reconcile-change-payment",
          payment.owner.attemptId,
          commandBody
        );
      } catch (error) {
        setOwnerCustomBuildChangePayments(
          jobId,
          Object.assign({}, read, {
            error: explain(
              error,
              "Exact Stripe reconciliation could not start safely."
            )
          })
        );
        return Promise.resolve(null);
      }
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { busyKey: jobId + ":reconcile-change-payment" }
      );
      setOwnerCustomBuildChangePayments(jobId, {
        phase: "ready",
        snapshot: payments,
        busy: payment.owner.canReconcileSettlement
          ? "settlement"
          : "creation",
        notice: text(read.notice),
        error: ""
      });
      return client.reconcileOwnerCustomBuildChangeCheckout(
        jobId,
        payment.owner.attemptId,
        {
          commandId: commandId,
          organizationId: entry.organizationId
        },
        {
          expectedPayment: payment,
          expectedProjectId: entry.projectId
        }
      ).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var reconciled =
          verifiedOwnerCustomBuildChangePaymentReconciliation(
            result,
            entry,
            payment
          );
        if (!reconciled) {
          throw new Error(
            "The exact Stripe reconciliation result could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        var notice = {
          checkout_ready:
            "The exact Stripe payment page is reconciled and retained for the customer.",
          payment_settled:
            "Provider-confirmed payment is retained and the accepted added work is effective.",
          checkout_expired:
            "Stripe confirmed that page expired. A new customer command is required.",
          reconciliation_required:
            "Stripe remains uncertain. The exact owner result is retained for a reviewed retry."
        }[reconciled.status];
        setOwnerCustomBuildChangePayments(jobId, {
          phase: "ready",
          snapshot: payments,
          busy: "",
          notice: notice,
          error: ""
        });
        return Promise.all([
          requestOwnerCustomBuildChangePayments(entry),
          requestOwnerCustomBuildChangeCompletion(entry)
        ]).then(function () {
          ownerCustomBuildWorkPanel.focusChangePaymentStatus(jobId);
          return reconciled;
        });
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        setOwnerCustomBuildChangePayments(jobId, {
          phase: "ready",
          snapshot: payments,
          busy: "",
          notice: text(read.notice),
          error: explain(
            error,
            "Stripe reconciliation remains uncertain. The exact command can be replayed safely."
          )
        });
        ownerCustomBuildWorkPanel.focusChangePaymentStatus(jobId);
        return null;
      });
    }

    function sameCustomBuildMilestones(value, expected) {
      return ["content", "quality", "responsive", "structure"]
        .every(function (key) {
          var milestone = value.progress.milestones.find(
            function (entry) { return entry.key === key; }
          );
          return milestone && milestone.state === expected[key];
        });
    }

    function runOwnerCustomBuildProgressCommand(
      operation,
      entry,
      snapshotInput,
      input
    ) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      var read = jobId && ownerCustomBuildWorkRead.progressByJob
        && ownerCustomBuildWorkRead.progressByJob[jobId];
      var current = read && verifiedCustomBuildProgress(
        read.snapshot,
        jobId
      );
      var selected = verifiedCustomBuildProgress(snapshotInput, jobId);
      if (
        !accountId
        || !jobId
        || !current
        || !selected
        || current.progress.revision !== selected.progress.revision
        || Boolean(read.busy)
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
      ) return Promise.resolve(null);
      var body;
      var subjectId = jobId;
      var invoke;
      if (operation === "progress") {
        body = {
          customerSummary: input.customerSummary,
          expectedRevision: current.progress.revision,
          milestones: input.milestones,
          nextStep: input.nextStep,
          organizationId: entry.organizationId,
          stage: input.stage
        };
        invoke = function (commandId) {
          return client.recordOwnerCustomBuildProgress(
            jobId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      } else if (operation === "request") {
        if (current.activeRequest !== null) return Promise.resolve(null);
        body = {
          access: input.access,
          customerMessage: input.customerMessage,
          expectedProgressRevision: current.progress.revision,
          organizationId: entry.organizationId,
          requestKind: input.requestKind,
          safeInstructions: input.safeInstructions,
          targetDateImpact: input.targetDateImpact,
          title: input.title
        };
        invoke = function (commandId) {
          return client.openOwnerCustomBuildRequest(
            jobId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      } else {
        if (!current.activeRequest) return Promise.resolve(null);
        subjectId = current.activeRequest.requestId;
        body = {
          expectedRevision: current.activeRequest.revision,
          organizationId: entry.organizationId,
          resolutionNote: input.resolutionNote,
          state: operation === "withdraw" ? "withdrawn" : "resolved"
        };
        invoke = function (commandId) {
          return client.resolveOwnerCustomBuildRequest(
            jobId,
            subjectId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      }
      var requiredMethod = {
        progress: "recordOwnerCustomBuildProgress",
        request: "openOwnerCustomBuildRequest",
        resolve: "resolveOwnerCustomBuildRequest",
        withdraw: "resolveOwnerCustomBuildRequest"
      }[operation];
      if (!requiredMethod || typeof client[requiredMethod] !== "function") {
        setOwnerCustomBuildProgress(jobId, Object.assign({}, read, {
          error: "That paid project control is unavailable in this build."
        }));
        return Promise.resolve(null);
      }
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          operation,
          subjectId,
          body
        );
      } catch (error) {
        setOwnerCustomBuildProgress(jobId, Object.assign({}, read, {
          error: explain(
            error,
            "That project command could not start safely."
          )
        }));
        return Promise.resolve(null);
      }
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { busyKey: jobId + ":" + operation }
      );
      setOwnerCustomBuildProgress(jobId, {
        phase: "ready",
        snapshot: current,
        busy: operation,
        error: ""
      });
      return Promise.resolve().then(function () {
        return invoke(commandId);
      }).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var settled = verifiedCustomBuildProgress(result, jobId);
        if (!settled || settled.state !== "active") {
          throw new Error(
            "The saved project response could not be verified."
          );
        }
        if (settled.targetCompletionDate !== current.targetCompletionDate) {
          throw new Error(
            "The saved project response changed the target date unexpectedly."
          );
        }
        if (
          operation === "progress"
          && (
            settled.progress.revision !== current.progress.revision + 1
            || settled.progress.stage !== body.stage
            || settled.progress.summary !== body.customerSummary
            || settled.progress.nextStep !== body.nextStep
            || !sameCustomBuildMilestones(settled, body.milestones)
          )
        ) {
          throw new Error(
            "The saved progress update did not match this command."
          );
        }
        if (
          operation === "request"
          && (
            !settled.activeRequest
            || settled.activeRequest.state !== "open"
            || settled.activeRequest.kind !== body.requestKind
            || settled.activeRequest.title !== body.title
          )
        ) {
          throw new Error(
            "The opened customer request did not match this command."
          );
        }
        if (
          ["resolve", "withdraw"].includes(operation)
          && settled.activeRequest !== null
        ) {
          throw new Error(
            "The customer request was not confirmed closed."
          );
        }
        clearCustomBuildAttempt(commandId);
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        setOwnerCustomBuildProgress(jobId, {
          phase: "ready",
          snapshot: settled,
          busy: "",
          error: ""
        });
        return settled;
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        setOwnerCustomBuildProgress(jobId, {
          phase: "ready",
          snapshot: current,
          busy: "",
          error: explain(
            error,
            "This project may have changed. Refresh it before trying the same safe command again."
          )
        });
        return null;
      });
    }

    function runOwnerCustomBuildChangeCompletionCommand(
      operation,
      entry,
      snapshotInput,
      input
    ) {
      var accountId = ownerCustomBuildWorkRead.accountId;
      var sequence = ownerCustomBuildWorkReadSequence;
      var jobId = entry && entry.job && entry.job.jobId;
      var read = jobId
        && ownerCustomBuildWorkRead.changeCompletionByJob
        && ownerCustomBuildWorkRead.changeCompletionByJob[jobId];
      var current = read && verifiedOwnerCustomBuildChangeCompletion(
        read.snapshot,
        entry
      );
      var selected = snapshotInput
        && verifiedOwnerCustomBuildChangeCompletion(snapshotInput, entry);
      if (
        !accountId
        || !jobId
        || !current
        || Boolean(read.busy)
        || ownerCustomBuildWorkRead.busyKey
        || !ownerCustomBuildProgressEntryIsCurrent(entry)
        || (snapshotInput && selected !== current)
      ) return Promise.resolve(null);
      var source = input || {};
      var subjectId = jobId;
      var body;
      var invoke;
      var order = null;
      if (operation === "issue-change") {
        if (
          current.completion
          || current.changeOrders.some(function (candidate) {
            return ["issued", "accepted_payment_required"]
              .includes(candidate.state);
          })
        ) return Promise.resolve(null);
        body = {
          addedScope: source.addedScope,
          expiresAt: source.expiresAt,
          organizationId: entry.organizationId,
          targetCompletionDate: source.targetCompletionDate,
          unitCount: source.unitCount
        };
        invoke = function (commandId) {
          return client.issueOwnerCustomBuildChangeOrder(
            jobId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      } else if (
        operation === "void-change"
        || operation === "expire-change"
      ) {
        var suppliedOrder = source.order;
        order = suppliedOrder && current.changeOrders.find(
          function (candidate) {
            return candidate.changeOrderId === suppliedOrder.changeOrderId
              && candidate.quoteDigest === suppliedOrder.quoteDigest;
          }
        );
        if (
          !order
          || !["issued", "accepted_payment_required"].includes(order.state)
          || (
            operation === "expire-change"
            && (
              order.state !== "issued"
              || Date.parse(order.expiresAt) > Date.now()
            )
          )
        ) return Promise.resolve(null);
        subjectId = order.changeOrderId;
        body = {
          expectedQuoteDigest: order.quoteDigest,
          organizationId: entry.organizationId
        };
        if (operation === "void-change") body.reason = source.reason;
        invoke = operation === "expire-change"
          ? function (commandId) {
              return client.expireOwnerCustomBuildChangeOrder(
                jobId,
                order.changeOrderId,
                Object.assign({}, body, { commandId: commandId })
              );
            }
          : function (commandId) {
              return client.voidOwnerCustomBuildChangeOrder(
                jobId,
                order.changeOrderId,
                Object.assign({}, body, { commandId: commandId })
              );
            };
      } else if (operation === "evidence") {
        if (current.completion) return Promise.resolve(null);
        body = {
          accessibleDescription: source.accessibleDescription,
          dataBase64: source.dataBase64,
          mediaType: source.mediaType,
          organizationId: entry.organizationId,
          viewport: source.viewport
        };
        invoke = function (commandId) {
          return client.uploadOwnerCustomBuildCompletionEvidence(
            jobId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      } else if (operation === "complete") {
        if (current.completion) return Promise.resolve(null);
        body = {
          checks: source.checks,
          customerSummary: source.customerSummary,
          evidenceIds: source.evidenceIds,
          organizationId: entry.organizationId
        };
        invoke = function (commandId) {
          return client.recordOwnerCustomBuildCompletion(
            jobId,
            Object.assign({}, body, { commandId: commandId })
          );
        };
      } else {
        return Promise.resolve(null);
      }
      var requiredMethod = {
        "issue-change": "issueOwnerCustomBuildChangeOrder",
        "void-change": "voidOwnerCustomBuildChangeOrder",
        "expire-change": "expireOwnerCustomBuildChangeOrder",
        evidence: "uploadOwnerCustomBuildCompletionEvidence",
        complete: "recordOwnerCustomBuildCompletion"
      }[operation];
      if (typeof client[requiredMethod] !== "function") {
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "ready",
          snapshot: current,
          busy: "",
          error: operation === "expire-change"
            ? "The bounded Expire action is unavailable in this build. Nothing changed."
            : "That added-work or completion control is unavailable in this build. Nothing changed."
        });
        return Promise.resolve(null);
      }
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          operation,
          subjectId,
          body
        );
      } catch (error) {
        setOwnerCustomBuildChangeCompletionError(entry, error);
        return Promise.resolve(null);
      }
      ownerCustomBuildWorkRead = Object.assign(
        {},
        ownerCustomBuildWorkRead,
        { busyKey: jobId + ":" + operation }
      );
      setOwnerCustomBuildChangeCompletion(jobId, {
        phase: "ready",
        snapshot: current,
        busy: operation,
        error: ""
      });
      return Promise.resolve().then(function () {
        return invoke(commandId);
      }).then(function (result) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        var settled = verifiedOwnerCustomBuildChangeCompletion(
          result,
          entry
        );
        if (!settled) {
          throw new Error(
            "The saved added-work or completion response could not be verified."
          );
        }
        if (operation === "issue-change") {
          var issued = settled.changeOrders.find(function (candidate) {
            return candidate.state === "issued";
          });
          if (
            !issued
            || issued.addedScope !== body.addedScope
            || issued.pricing.unitCount !== body.unitCount
            || issued.pricing.subtotalMinor !==
              body.unitCount * CUSTOM_BUILD_CHANGE_UNIT_MINOR
            || issued.targetCompletionDate !== body.targetCompletionDate
            || issued.expiresAt !== body.expiresAt
          ) throw new Error("The issued added-work change did not match.");
        } else if (
          operation === "void-change"
          || operation === "expire-change"
        ) {
          var closed = settled.changeOrders.find(function (candidate) {
            return candidate.changeOrderId === order.changeOrderId;
          });
          var expectedState = operation === "expire-change"
            ? "expired"
            : "voided";
          if (
            !closed
            || closed.state !== expectedState
            || closed.quoteDigest !== order.quoteDigest
          ) throw new Error("The exact change was not confirmed closed.");
        } else if (operation === "evidence") {
          var added = settled.evidence.find(function (candidate) {
            return candidate.accessibleDescription ===
                body.accessibleDescription
              && candidate.mediaType === body.mediaType
              && candidate.viewport === body.viewport;
          });
          if (!added) {
            throw new Error("The uploaded completion proof did not match.");
          }
        } else if (
          !settled.completion
          || settled.completion.customerSummary !== body.customerSummary
          || JSON.stringify(settled.completion.evidenceIds) !==
            JSON.stringify(body.evidenceIds)
        ) {
          throw new Error("The exact completion proof did not match.");
        }
        clearCustomBuildAttempt(commandId);
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "ready",
          snapshot: settled,
          busy: "",
          error: ""
        });
        return settled;
      }).catch(function (error) {
        if (
          !ownerCustomBuildWorkReadIsCurrent(sequence, accountId)
          || !ownerCustomBuildProgressEntryIsCurrent(entry)
        ) return null;
        ownerCustomBuildWorkRead = Object.assign(
          {},
          ownerCustomBuildWorkRead,
          { busyKey: "" }
        );
        var held = text(error && error.code) ===
          "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
          || Number(error && error.status) === 503;
        setOwnerCustomBuildChangeCompletion(jobId, {
          phase: "ready",
          snapshot: current,
          busy: "",
          error: held
            ? "Added-work and completion tools are held or unavailable. Nothing changed and no action was taken."
            : explain(
                error,
                "This project may have changed. Refresh it before retrying the same exact command."
              )
        });
        return null;
      });
    }

    function requestOwnerCustomBuildJobs(accountId, cursorValue) {
      var selectedAccountId = text(accountId);
      var selectedCursor = text(cursorValue);
      if (ownerCustomBuildWorkRead.busyKey) {
        return Promise.resolve(null);
      }
      var sequence = ++ownerCustomBuildWorkReadSequence;
      var retainedJobs = ownerCustomBuildWorkRead.accountId ===
          selectedAccountId
          && ownerCustomBuildWorkRead.revealed
        ? verifiedOwnerCustomBuildJobs(ownerCustomBuildWorkRead.jobs)
        : null;
      var continuing = Boolean(
        selectedCursor
        && retainedJobs
        && retainedJobs.nextCursor === selectedCursor
      );
      if (selectedCursor && !continuing) return Promise.resolve(null);
      var retainedPageNumber = retainedJobs
        ? ownerCustomBuildWorkRead.pageNumber
        : 0;
      if (
        !selectedAccountId
        || typeof client.listOwnerCustomBuildJobs !== "function"
      ) {
        ownerCustomBuildWorkRead = {
          accountId: selectedAccountId,
          phase: "unavailable",
          revealed: false,
          jobs: null,
          progressByJob: {},
          changeCompletionByJob: {},
          changePaymentsByJob: {},
          busyKey: "",
          pageNumber: 0,
          loadingMore: false,
          error: ""
        };
        renderOwnerCustomBuildWorkPanel();
        return Promise.resolve(null);
      }
      ownerCustomBuildWorkRead = {
        accountId: selectedAccountId,
        phase: "loading",
        revealed: Boolean(retainedJobs),
        jobs: retainedJobs,
        progressByJob: ownerCustomBuildWorkRead.progressByJob || {},
        changeCompletionByJob:
          ownerCustomBuildWorkRead.changeCompletionByJob || {},
        changePaymentsByJob:
          ownerCustomBuildWorkRead.changePaymentsByJob || {},
        busyKey: "",
        pageNumber: retainedPageNumber,
        loadingMore: continuing,
        error: ""
      };
      renderOwnerCustomBuildWorkPanel();
      return client.listOwnerCustomBuildJobs(
        selectedCursor ? { cursor: selectedCursor } : undefined
      )
        .then(function (result) {
          if (!ownerCustomBuildWorkReadIsCurrent(
            sequence,
            selectedAccountId
          )) return null;
          if (!verifiedOwnerCustomBuildJobs(result)) {
            throw new Error(
              "The paid Custom website job response could not be verified."
            );
          }
          var progressByJob = {};
          var changeCompletionByJob = {};
          var changePaymentsByJob = {};
          result.jobs.forEach(function (entry) {
            progressByJob[entry.job.jobId] = {
              phase: "loading",
              snapshot: null,
              busy: "",
              error: ""
            };
            changeCompletionByJob[entry.job.jobId] = {
              phase: "loading",
              snapshot: null,
              busy: "",
              error: ""
            };
            changePaymentsByJob[entry.job.jobId] = {
              phase: "loading",
              snapshot: null,
              busy: "",
              error: ""
            };
          });
          ownerCustomBuildWorkRead = {
            accountId: selectedAccountId,
            phase: "ready",
            revealed: true,
            jobs: result,
            progressByJob: progressByJob,
            changeCompletionByJob: changeCompletionByJob,
            changePaymentsByJob: changePaymentsByJob,
            busyKey: "",
            pageNumber: continuing ? retainedPageNumber + 1 : 1,
            loadingMore: false,
            error: ""
          };
          renderOwnerCustomBuildWorkPanel();
          return Promise.all([
            requestOwnerCustomBuildProgressBatch(result.jobs),
            requestOwnerCustomBuildChangeCompletionBatch(result.jobs),
            requestOwnerCustomBuildChangePaymentsBatch(result.jobs)
          ]).then(function () { return result; });
        })
        .catch(function (error) {
          if (!ownerCustomBuildWorkReadIsCurrent(
            sequence,
            selectedAccountId
          )) return null;
          var unavailable = error
            && [401, 403, 503].includes(error.status);
          ownerCustomBuildWorkRead = {
            accountId: selectedAccountId,
            phase: unavailable ? "unavailable" : "error",
            revealed: unavailable ? false : Boolean(retainedJobs),
            jobs: unavailable ? null : retainedJobs,
            progressByJob: unavailable
              ? {}
              : ownerCustomBuildWorkRead.progressByJob || {},
            changeCompletionByJob: unavailable
              ? {}
              : ownerCustomBuildWorkRead.changeCompletionByJob || {},
            changePaymentsByJob: unavailable
              ? {}
              : ownerCustomBuildWorkRead.changePaymentsByJob || {},
            busyKey: "",
            pageNumber: unavailable ? 0 : retainedPageNumber,
            loadingMore: false,
            error: unavailable
              ? ""
              : explain(
                  error,
                  "Paid Custom website jobs could not be loaded."
                )
          };
          renderOwnerCustomBuildWorkPanel();
          if (!unavailable && ownerCustomBuildWorkRead.revealed) {
            ownerCustomBuildWorkPanel.focusStatus();
          }
          return null;
        });
    }

    function syncOwnerCustomBuildWorkAccount(state) {
      var nextAccountId = text(
        state && state.account && state.account.id
      );
      if (!nextAccountId) {
        if (ownerCustomBuildWorkRead.accountId) {
          ownerCustomBuildWorkReadSequence += 1;
          ownerCustomBuildWorkRead = {
            accountId: "",
            phase: "idle",
            revealed: false,
            jobs: null,
            progressByJob: {},
            changeCompletionByJob: {},
            changePaymentsByJob: {},
            busyKey: "",
            pageNumber: 0,
            loadingMore: false,
            error: ""
          };
          renderOwnerCustomBuildWorkPanel();
        }
        return;
      }
      if (ownerCustomBuildWorkRead.accountId !== nextAccountId) {
        requestOwnerCustomBuildJobs(nextAccountId);
      }
    }

    function renderCustomerCustomBuildPanel() {
      customerCustomBuildPanel.render(customBuildRead);
    }

    function customerCustomBuildReadIsCurrent(sequence, projectId) {
      return sequence === customBuildReadSequence
        && customBuildRead.projectId === projectId
        && customBuildRead.accountId === text(
          lastState.account && lastState.account.id
        )
        && idOf(lastState.project) === projectId;
    }

    function requestCustomerCustomBuildInvoice(
      sequence,
      projectId,
      accountId,
      snapshot
    ) {
      if (
        !customerCustomBuildReadIsCurrent(sequence, projectId)
        || !customBuildInvoiceExpectation(snapshot)
      ) return Promise.resolve(null);
      if (
        typeof client.getCustomServicesCustomBuildInvoice !== "function"
      ) {
        customBuildRead = Object.assign({}, customBuildRead, {
          invoice: null,
          command: "",
          error: "Custom website payment details are unavailable in this build."
        });
        renderCustomerCustomBuildPanel();
        return Promise.resolve(null);
      }
      customBuildRead = Object.assign({}, customBuildRead, {
        invoice: null,
        command: "loading first-payment invoice",
        error: ""
      });
      renderCustomerCustomBuildPanel();
      return client.getCustomServicesCustomBuildInvoice(projectId)
        .then(function (result) {
          if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
            return null;
          }
          var current = verifiedCustomerCustomBuildQuote(
            customBuildRead.snapshot,
            projectId
          );
          if (
            !current
            || current.state !== "accepted"
            || current.quote.quoteId !== snapshot.quote.quoteId
            || !verifiedCustomerCustomBuildInvoice(
              result,
              customBuildInvoiceExpectation(current)
            )
          ) {
            throw new Error(
              "The Custom website first-payment invoice response could not be verified."
            );
          }
          customBuildRead = {
            accountId: accountId,
            projectId: projectId,
            phase: "ready",
            snapshot: current,
            invoice: result,
            command: "",
            error: ""
          };
          renderCustomerCustomBuildPanel();
          return result;
        })
        .catch(function (error) {
          if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
            return null;
          }
          customBuildRead = Object.assign({}, customBuildRead, {
            invoice: null,
            command: "",
            error: explain(
              error,
              "The Custom website first-payment invoice could not be loaded."
            )
          });
          renderCustomerCustomBuildPanel();
          customerCustomBuildPanel.focusStatus();
          return null;
        });
    }

    function requestCustomerCustomBuildQuote(projectId) {
      var selectedProjectId = text(projectId);
      var selectedAccountId = text(
        lastState.account && lastState.account.id
      );
      var sequence = ++customBuildReadSequence;
      if (!selectedProjectId || !selectedAccountId) {
        return Promise.resolve(null);
      }
      customBuildRead = {
        accountId: selectedAccountId,
        projectId: selectedProjectId,
        phase: "loading",
        snapshot: null,
        invoice: null,
        command: "",
        error: ""
      };
      renderCustomerCustomBuildPanel();
      if (
        typeof client.getCustomServicesCustomBuildQuote !== "function"
      ) {
        customBuildRead.phase = "error";
        customBuildRead.error =
          "Custom website quotes are unavailable in this build.";
        renderCustomerCustomBuildPanel();
        return Promise.resolve(null);
      }
      return client.getCustomServicesCustomBuildQuote(selectedProjectId)
        .then(function (result) {
          if (!customerCustomBuildReadIsCurrent(
            sequence,
            selectedProjectId
          )) return null;
          if (!verifiedCustomerCustomBuildQuote(
            result,
            selectedProjectId
          )) {
            throw new Error(
              "The Custom website quote response could not be verified."
            );
          }
          customBuildRead = {
            accountId: selectedAccountId,
            projectId: selectedProjectId,
            phase: "ready",
            snapshot: result,
            invoice: null,
            command: "",
            error: ""
          };
          renderCustomerCustomBuildPanel();
          if (result.state === "accepted") {
            return requestCustomerCustomBuildInvoice(
              sequence,
              selectedProjectId,
              selectedAccountId,
              result
            );
          }
          return customBuildRead;
        })
        .catch(function (error) {
          if (!customerCustomBuildReadIsCurrent(
            sequence,
            selectedProjectId
          )) return null;
          customBuildRead = {
            accountId: selectedAccountId,
            projectId: selectedProjectId,
            phase: "error",
            snapshot: null,
            invoice: null,
            command: "",
            error: explain(
              error,
              "The Custom website quote could not be loaded."
            )
          };
          renderCustomerCustomBuildPanel();
          customerCustomBuildPanel.focusStatus();
          return null;
        });
    }

    function runCustomerCustomBuildAcceptance(snapshotInput) {
      var projectId = customBuildRead.projectId;
      var accountId = customBuildRead.accountId;
      var current = verifiedCustomerCustomBuildQuote(
        customBuildRead.snapshot,
        projectId
      );
      var selected = verifiedCustomerCustomBuildQuote(
        snapshotInput,
        projectId
      );
      if (
        !current
        || !selected
        || current.state !== "issued"
        || selected.state !== "issued"
        || current.quote.quoteId !== selected.quote.quoteId
        || current.quote.quoteRevision !== selected.quote.quoteRevision
        || current.quote.quoteDigest !== selected.quote.quoteDigest
        || customBuildRead.command
        || typeof client.acceptCustomServicesCustomBuildQuote !== "function"
      ) return Promise.resolve(null);
      var acceptance = {
        acceptanceStatement: "accepted_exact_custom_build_quote",
        acceptedDisclosureDigest: current.quote.disclosureDigest,
        acceptedQuoteDigest: current.quote.quoteDigest,
        quoteId: current.quote.quoteId,
        quoteRevision: current.quote.quoteRevision
      };
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "accept",
          current.quote.quoteId,
          acceptance
        );
      } catch (error) {
        customBuildRead = Object.assign({}, customBuildRead, {
          error: explain(
            error,
            "The Custom website quote acceptance could not start."
          )
        });
        renderCustomerCustomBuildPanel();
        return Promise.resolve(null);
      }
      var sequence = customBuildReadSequence;
      customBuildRead = Object.assign({}, customBuildRead, {
        command: "accepting quote",
        error: ""
      });
      renderCustomerCustomBuildPanel();
      return Promise.resolve().then(function () {
        return client.acceptCustomServicesCustomBuildQuote(
          projectId,
          Object.assign({}, acceptance, { commandId: commandId })
        );
      }).then(function (result) {
        if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
          return null;
        }
        var settled = verifiedCustomerCustomBuildQuote(
          result,
          projectId
        );
        if (
          !settled
          || !["accepted", "voided"].includes(settled.state)
          || settled.customerId !== current.customerId
          || settled.quote.quoteId !== current.quote.quoteId
          || settled.quote.quoteRevision !==
            current.quote.quoteRevision
          || settled.quote.quoteDigest !== current.quote.quoteDigest
        ) {
          throw new Error(
            "The accepted Custom website quote response could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        customBuildRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: settled,
          invoice: null,
          command: "",
          error: ""
        };
        renderCustomerCustomBuildPanel();
        customerCustomBuildPanel.focusStatus();
        if (settled.state === "accepted") {
          return requestCustomerCustomBuildInvoice(
            sequence,
            projectId,
            accountId,
            settled
          ).then(function () {
            return settled;
          });
        }
        return settled;
      }).catch(function (error) {
        if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
          return null;
        }
        customBuildRead = Object.assign({}, customBuildRead, {
          command: "",
          error: explain(
            error,
            "The quote was not confirmed accepted. The same command can be retried safely."
          )
        });
        renderCustomerCustomBuildPanel();
        customerCustomBuildPanel.focusStatus();
        return null;
      });
    }

    function requestCustomerCustomBuildCheckout(invoiceState) {
      var projectId = customBuildRead.projectId;
      var accountId = customBuildRead.accountId;
      var expectation = customBuildInvoiceExpectation(
        customBuildRead.snapshot
      );
      var selected = verifiedCustomerCustomBuildInvoice(
        invoiceState,
        expectation
      );
      var current = verifiedCustomerCustomBuildInvoice(
        customBuildRead.invoice,
        expectation
      );
      if (
        !projectId
        || !accountId
        || customBuildRead.phase !== "ready"
        || customBuildRead.command
        || !selected
        || !current
        || selected.state !== "checkout_available"
        || current.state !== "checkout_available"
        || selected.invoice.invoiceId !== current.invoice.invoiceId
        || selected.invoice.invoiceDigest !== current.invoice.invoiceDigest
      ) return Promise.resolve(null);
      var input = { invoiceDigest: current.invoice.invoiceDigest };
      var commandId;
      try {
        if (
          typeof client.createCustomServicesCustomBuildCheckout !==
            "function"
        ) {
          throw new Error(
            "Custom website secure payment is unavailable in this build."
          );
        }
        commandId = customBuildCommandId(
          accountId,
          "checkout",
          current.invoice.invoiceId,
          input
        );
      } catch (error) {
        customBuildRead = Object.assign({}, customBuildRead, {
          command: "",
          error: explain(
            error,
            "Custom website secure payment could not start."
          )
        });
        renderCustomerCustomBuildPanel();
        customerCustomBuildPanel.focusStatus();
        return Promise.resolve(null);
      }
      var sequence = customBuildReadSequence;
      customBuildRead = Object.assign({}, customBuildRead, {
        command: "opening secure payment",
        error: ""
      });
      renderCustomerCustomBuildPanel();
      return client.createCustomServicesCustomBuildCheckout(
        projectId,
        current.invoice.invoiceId,
        input,
        { idempotencyKey: commandId }
      ).then(function (result) {
        if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
          return null;
        }
        var checkout = verifiedCustomerCustomBuildCheckout(
          result,
          current.invoice,
          new Date().toISOString()
        );
        var destination = safeCheckoutDestination(checkout);
        if (!checkout || !destination) {
          throw new Error(
            "The Custom website secure payment destination could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        windowRef.location.assign(destination);
        return checkout;
      }).catch(function (error) {
        if (!customerCustomBuildReadIsCurrent(sequence, projectId)) {
          return null;
        }
        if (
          [
            "CUSTOM_BUILD_PAYMENT_UNAVAILABLE",
            "CUSTOM_BUILD_CHECKOUT_REQUIRES_NEW_COMMAND"
          ].includes(text(error && error.code))
        ) clearCustomBuildAttempt(commandId);
        customBuildRead = Object.assign({}, customBuildRead, {
          command: "",
          error: explain(
            error,
            "Custom website secure payment could not open. The same request can be tried safely."
          )
        });
        renderCustomerCustomBuildPanel();
        customerCustomBuildPanel.focusStatus();
        return null;
      });
    }

    function renderCustomerCustomBuildAccount(state) {
      var accountId = text(state.account && state.account.id);
      var projectId = accountId ? idOf(state.project) : "";
      if (!projectId) {
        if (customBuildRead.projectId || customBuildRead.accountId) {
          customBuildReadSequence += 1;
          customBuildRead = {
            accountId: "",
            projectId: "",
            phase: "idle",
            snapshot: null,
            invoice: null,
            command: "",
            error: ""
          };
        }
        renderCustomerCustomBuildPanel();
        return;
      }
      if (
        customBuildRead.accountId !== accountId
        || customBuildRead.projectId !== projectId
      ) {
        requestCustomerCustomBuildQuote(projectId);
        return;
      }
      renderCustomerCustomBuildPanel();
    }

    function renderCustomerCustomBuildProgressPanel() {
      customerCustomBuildProgressPanel.render(customBuildProgressRead);
    }

    function customerCustomBuildProgressReadIsCurrent(
      sequence,
      projectId
    ) {
      return sequence === customBuildProgressReadSequence
        && customBuildProgressRead.projectId === projectId
        && customBuildProgressRead.accountId === text(
          lastState.account && lastState.account.id
        )
        && idOf(lastState.project) === projectId;
    }

    function requestCustomerCustomBuildProgress(projectId) {
      var selectedProjectId = text(projectId);
      var selectedAccountId = text(
        lastState.account && lastState.account.id
      );
      var sequence = ++customBuildProgressReadSequence;
      if (!selectedProjectId || !selectedAccountId) {
        return Promise.resolve(null);
      }
      customBuildProgressRead = {
        accountId: selectedAccountId,
        projectId: selectedProjectId,
        phase: "loading",
        snapshot: null,
        command: "",
        error: ""
      };
      renderCustomerCustomBuildProgressPanel();
      if (
        typeof client.getCustomServicesCustomBuildProgress !== "function"
      ) {
        customBuildProgressRead.phase = "error";
        customBuildProgressRead.error =
          "Custom-build project progress is unavailable in this build.";
        renderCustomerCustomBuildProgressPanel();
        return Promise.resolve(null);
      }
      return client.getCustomServicesCustomBuildProgress(
        selectedProjectId
      ).then(function (result) {
        if (!customerCustomBuildProgressReadIsCurrent(
          sequence,
          selectedProjectId
        )) return null;
        var snapshot = verifiedCustomBuildProgress(result);
        if (!snapshot) {
          throw new Error(
            "The Custom-build progress response could not be verified."
          );
        }
        customBuildProgressRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: snapshot.state === "not_available"
            ? "not_available"
            : "ready",
          snapshot: snapshot,
          command: "",
          error: ""
        };
        renderCustomerCustomBuildProgressPanel();
        return snapshot;
      }).catch(function (error) {
        if (!customerCustomBuildProgressReadIsCurrent(
          sequence,
          selectedProjectId
        )) return null;
        customBuildProgressRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: "error",
          snapshot: null,
          command: "",
          error: explain(
            error,
            "Project progress could not be loaded. Refresh and try again."
          )
        };
        renderCustomerCustomBuildProgressPanel();
        customerCustomBuildProgressPanel.focusStatus();
        return null;
      });
    }

    function runCustomerCustomBuildProgressResponse(
      snapshotInput,
      input
    ) {
      var projectId = customBuildProgressRead.projectId;
      var accountId = customBuildProgressRead.accountId;
      var current = verifiedCustomBuildProgress(
        customBuildProgressRead.snapshot
      );
      var selected = verifiedCustomBuildProgress(snapshotInput);
      if (
        !projectId
        || !accountId
        || customBuildProgressRead.phase !== "ready"
        || customBuildProgressRead.command
        || !current
        || !selected
        || current.jobId !== selected.jobId
        || !current.activeRequest
        || current.activeRequest.state !== "open"
        || !current.activeRequest.responseRequired
        || !selected.activeRequest
        || selected.activeRequest.requestId !==
          current.activeRequest.requestId
        || typeof client.respondToCustomServicesCustomBuildRequest !==
          "function"
      ) return Promise.resolve(null);
      var request = current.activeRequest;
      var body = {
        expectedRevision: request.revision,
        responseKind: input.responseKind,
        responseNote: input.responseNote
      };
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "respond",
          request.requestId,
          body
        );
      } catch (error) {
        customBuildProgressRead = Object.assign(
          {},
          customBuildProgressRead,
          {
            error: explain(
              error,
              "Your response could not start safely."
            )
          }
        );
        renderCustomerCustomBuildProgressPanel();
        return Promise.resolve(null);
      }
      var sequence = customBuildProgressReadSequence;
      customBuildProgressRead = Object.assign(
        {},
        customBuildProgressRead,
        { command: "respond", error: "" }
      );
      renderCustomerCustomBuildProgressPanel();
      return Promise.resolve().then(function () {
        return client.respondToCustomServicesCustomBuildRequest(
          projectId,
          request.requestId,
          Object.assign({}, body, { commandId: commandId })
        );
      }).then(function (result) {
        if (!customerCustomBuildProgressReadIsCurrent(
          sequence,
          projectId
        )) return null;
        var settled = verifiedCustomBuildProgress(result);
        if (
          !settled
          || settled.state !== "active"
          || settled.jobId !== current.jobId
          || settled.targetCompletionDate !==
            current.targetCompletionDate
          || !settled.activeRequest
          || settled.activeRequest.requestId !== request.requestId
          || settled.activeRequest.state !== "answered"
          || settled.activeRequest.revision !== request.revision + 1
          || settled.activeRequest.response.kind !== body.responseKind
          || settled.activeRequest.response.note !== body.responseNote
        ) {
          throw new Error(
            "The saved customer response could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        customBuildProgressRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: settled,
          command: "",
          error: ""
        };
        renderCustomerCustomBuildProgressPanel();
        customerCustomBuildProgressPanel.focusStatus();
        return settled;
      }).catch(function (error) {
        if (!customerCustomBuildProgressReadIsCurrent(
          sequence,
          projectId
        )) return null;
        customBuildProgressRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: current,
          command: "",
          error: explain(
            error,
            "This request may have changed. Refresh it before retrying the same safe response."
          )
        };
        renderCustomerCustomBuildProgressPanel();
        customerCustomBuildProgressPanel.focusStatus();
        return null;
      });
    }

    function renderCustomerCustomBuildProgressAccount(state) {
      var accountId = text(state.account && state.account.id);
      var projectId = accountId ? idOf(state.project) : "";
      if (!projectId) {
        if (
          customBuildProgressRead.projectId
          || customBuildProgressRead.accountId
        ) {
          customBuildProgressReadSequence += 1;
          customBuildProgressRead = {
            accountId: "",
            projectId: "",
            phase: "idle",
            snapshot: null,
            command: "",
            error: ""
          };
        }
        renderCustomerCustomBuildProgressPanel();
        return;
      }
      if (
        customBuildProgressRead.accountId !== accountId
        || customBuildProgressRead.projectId !== projectId
      ) {
        requestCustomerCustomBuildProgress(projectId);
        return;
      }
      renderCustomerCustomBuildProgressPanel();
    }

    function renderCustomerCustomBuildChangeCompletionPanel() {
      customerCustomBuildChangeCompletionPanel.render(
        customBuildChangeCompletionRead
      );
    }

    function customerCustomBuildChangeCompletionReadIsCurrent(
      sequence,
      projectId
    ) {
      return sequence === customBuildChangeCompletionReadSequence
        && customBuildChangeCompletionRead.projectId === projectId
        && customBuildChangeCompletionRead.accountId === text(
          lastState.account && lastState.account.id
        )
        && idOf(lastState.project) === projectId;
    }

    function requestCustomerCustomBuildChangeInvoice(
      sequence,
      projectId,
      accountId,
      snapshot
    ) {
      if (
        !customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )
        || !verifiedCustomerCustomBuildChangeCompletion(snapshot)
      ) return Promise.resolve(null);
      var retainedInvoice = verifiedCustomerCustomBuildChangeInvoice(
        customBuildChangeCompletionRead.invoice,
        snapshot
      );
      if (
        typeof client.getCustomServicesCustomBuildChangeInvoice !==
          "function"
      ) {
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          {
            phase: "ready",
            invoice: retainedInvoice,
            command: "",
            error:
              "Added-work payment details are unavailable in this build. No payment action is available."
          }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return Promise.resolve(null);
      }
      customBuildChangeCompletionRead = Object.assign(
        {},
        customBuildChangeCompletionRead,
        {
          phase: "ready",
          snapshot: snapshot,
          invoice: retainedInvoice,
          command: "loading added-work invoice",
          error: ""
        }
      );
      renderCustomerCustomBuildChangeCompletionPanel();
      return client.getCustomServicesCustomBuildChangeInvoice(projectId)
        .then(function (result) {
          if (!customerCustomBuildChangeCompletionReadIsCurrent(
            sequence,
            projectId
          )) return null;
          var current = verifiedCustomerCustomBuildChangeCompletion(
            customBuildChangeCompletionRead.snapshot
          );
          var invoice = current
            && verifiedCustomerCustomBuildChangeInvoice(result, current);
          if (!invoice) {
            throw new Error(
              "The exact added-work invoice response could not be verified."
            );
          }
          customBuildChangeCompletionRead = {
            accountId: accountId,
            projectId: projectId,
            phase: "ready",
            snapshot: current,
            invoice: invoice,
            command: "",
            error: ""
          };
          renderCustomerCustomBuildChangeCompletionPanel();
          return invoice;
        })
        .catch(function (error) {
          if (!customerCustomBuildChangeCompletionReadIsCurrent(
            sequence,
            projectId
          )) return null;
          var held = text(error && error.code) ===
            "CUSTOM_BUILD_CHANGE_PAYMENT_HELD"
            || Number(error && error.status) === 503;
          customBuildChangeCompletionRead = Object.assign(
            {},
            customBuildChangeCompletionRead,
            {
              phase: "ready",
              invoice: verifiedCustomerCustomBuildChangeInvoice(
                customBuildChangeCompletionRead.invoice,
                snapshot
              ) || retainedInvoice,
              command: "",
              error: held
                ? "Added-work payment is held or unavailable. No charge occurred and no payment action is available."
                : explain(
                    error,
                    "The exact added-work invoice could not be loaded. No payment action is available."
                  )
            }
          );
          renderCustomerCustomBuildChangeCompletionPanel();
          customerCustomBuildChangeCompletionPanel.focusStatus();
          return null;
        });
    }

    function requestCustomerCustomBuildChangeCompletion(projectId) {
      var selectedProjectId = text(projectId);
      var selectedAccountId = text(
        lastState.account && lastState.account.id
      );
      if (!selectedProjectId || !selectedAccountId) {
        return Promise.resolve(null);
      }
      var sequence = ++customBuildChangeCompletionReadSequence;
      var retained = customBuildChangeCompletionRead.accountId ===
          selectedAccountId
          && customBuildChangeCompletionRead.projectId === selectedProjectId
        ? verifiedCustomerCustomBuildChangeCompletion(
            customBuildChangeCompletionRead.snapshot
          )
        : null;
      var retainedInvoice = retained
        ? verifiedCustomerCustomBuildChangeInvoice(
            customBuildChangeCompletionRead.invoice,
            retained
          )
        : null;
      customBuildChangeCompletionRead = {
        accountId: selectedAccountId,
        projectId: selectedProjectId,
        phase: "loading",
        snapshot: retained,
        invoice: retainedInvoice,
        command: "",
        error: ""
      };
      renderCustomerCustomBuildChangeCompletionPanel();
      if (
        typeof client.getCustomServicesCustomBuildChangeCompletion !==
          "function"
      ) {
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          {
            phase: "error",
            error:
              "Added-work and completion tools are unavailable in this build. Nothing changed."
          }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return Promise.resolve(null);
      }
      return client.getCustomServicesCustomBuildChangeCompletion(
        selectedProjectId
      ).then(function (result) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          selectedProjectId
        )) return null;
        var snapshot = verifiedCustomerCustomBuildChangeCompletion(result);
        if (!snapshot) {
          throw new Error(
            "The added-work and completion response could not be verified."
          );
        }
        customBuildChangeCompletionRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: "ready",
          snapshot: snapshot,
          invoice: verifiedCustomerCustomBuildChangeInvoice(
            retainedInvoice,
            snapshot
          ),
          command: "",
          error: ""
        };
        renderCustomerCustomBuildChangeCompletionPanel();
        return requestCustomerCustomBuildChangeInvoice(
          sequence,
          selectedProjectId,
          selectedAccountId,
          snapshot
        ).then(function () { return snapshot; });
      }).catch(function (error) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          selectedProjectId
        )) return null;
        var held = text(error && error.code) ===
          "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
          || Number(error && error.status) === 503;
        customBuildChangeCompletionRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: "error",
          snapshot: retained,
          invoice: retainedInvoice,
          command: "",
          error: held
            ? "Added-work and completion tools are held or unavailable. Nothing changed and no action is available."
            : explain(
                error,
                "Added work and completion could not be refreshed. The last verified information remains below."
              )
        };
        renderCustomerCustomBuildChangeCompletionPanel();
        customerCustomBuildChangeCompletionPanel.focusStatus();
        return null;
      });
    }

    function runCustomerCustomBuildChangeDecision(operation, orderInput) {
      var projectId = customBuildChangeCompletionRead.projectId;
      var accountId = customBuildChangeCompletionRead.accountId;
      var current = verifiedCustomerCustomBuildChangeCompletion(
        customBuildChangeCompletionRead.snapshot
      );
      var order = current && current.changeOrders.active;
      if (
        !projectId
        || !accountId
        || customBuildChangeCompletionRead.command
        || !current
        || !order
        || order !== orderInput
        || order.state !== "issued"
        || (operation === "accept" && Date.parse(order.expiresAt) <= Date.now())
      ) return Promise.resolve(null);
      var method = operation === "accept"
        ? "acceptCustomServicesCustomBuildChangeOrder"
        : "declineCustomServicesCustomBuildChangeOrder";
      if (typeof client[method] !== "function") {
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          {
            error: "That exact decision is unavailable in this build. Nothing changed."
          }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return Promise.resolve(null);
      }
      var body = operation === "accept"
        ? {
            acceptanceStatement:
              "accepted_exact_change_order_and_payment_requirement",
            acceptedDisclosureDigest: order.disclosureDigest,
            acceptedQuoteDigest: order.quoteDigest
          }
        : {
            declineStatement:
              "declined_exact_custom_build_change_quote",
            declinedDisclosureDigest: order.disclosureDigest,
            declinedQuoteDigest: order.quoteDigest
          };
      var commandId;
      try {
        commandId = customBuildCommandId(
          accountId,
          "change-" + operation,
          order.changeOrderId,
          body
        );
      } catch (error) {
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          { error: explain(error, "That decision could not start safely.") }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return Promise.resolve(null);
      }
      var sequence = customBuildChangeCompletionReadSequence;
      customBuildChangeCompletionRead = Object.assign(
        {},
        customBuildChangeCompletionRead,
        { command: operation, error: "" }
      );
      renderCustomerCustomBuildChangeCompletionPanel();
      return client[method](
        projectId,
        order.changeOrderId,
        Object.assign({}, body, { commandId: commandId })
      ).then(function (result) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        var settled = verifiedCustomerCustomBuildChangeCompletion(result);
        if (!settled) {
          throw new Error("The saved exact decision could not be verified.");
        }
        if (operation === "accept") {
          if (
            settled.state !== "change_order_payment_required"
            || !settled.changeOrders.active
            || settled.changeOrders.active.changeOrderId !== order.changeOrderId
            || settled.changeOrders.active.quoteDigest !== order.quoteDigest
            || settled.changeOrders.active.state !==
              "accepted_payment_required"
          ) throw new Error("The exact acceptance was not confirmed.");
        } else {
          var declined = settled.changeOrders.history.find(function (entry) {
            return entry.changeOrderId === order.changeOrderId;
          });
          if (!declined || declined.state !== "declined") {
            throw new Error("The exact decline was not confirmed.");
          }
        }
        clearCustomBuildAttempt(commandId);
        customBuildChangeCompletionRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: settled,
          invoice: null,
          command: "",
          error: ""
        };
        renderCustomerCustomBuildChangeCompletionPanel();
        customerCustomBuildChangeCompletionPanel.focusStatus();
        return requestCustomerCustomBuildChangeInvoice(
          sequence,
          projectId,
          accountId,
          settled
        ).then(function () { return settled; });
      }).catch(function (error) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        var held = text(error && error.code) ===
          "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
          || Number(error && error.status) === 503;
        customBuildChangeCompletionRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: current,
          invoice: verifiedCustomerCustomBuildChangeInvoice(
            customBuildChangeCompletionRead.invoice,
            current
          ),
          command: "",
          error: held
            ? "Added-work decisions are held or unavailable. Nothing changed and no action was taken."
            : explain(
                error,
                "This change may have been updated. Refresh before retrying the same exact decision."
              )
        };
        renderCustomerCustomBuildChangeCompletionPanel();
        customerCustomBuildChangeCompletionPanel.focusStatus();
        return null;
      });
    }

    function requestCustomerCustomBuildChangeCheckout(invoiceInput) {
      var projectId = customBuildChangeCompletionRead.projectId;
      var accountId = customBuildChangeCompletionRead.accountId;
      var snapshot = verifiedCustomerCustomBuildChangeCompletion(
        customBuildChangeCompletionRead.snapshot
      );
      var current = snapshot
        && verifiedCustomerCustomBuildChangeInvoice(
          customBuildChangeCompletionRead.invoice,
          snapshot
        );
      var selected = snapshot
        && verifiedCustomerCustomBuildChangeInvoice(
          invoiceInput,
          snapshot
        );
      if (
        !projectId
        || !accountId
        || !snapshot
        || !current
        || !selected
        || customBuildChangeCompletionRead.command
        || current.state !== "checkout_available"
        || selected.state !== "checkout_available"
        || current.invoice.invoiceId !== selected.invoice.invoiceId
        || current.invoice.invoiceDigest !== selected.invoice.invoiceDigest
      ) return Promise.resolve(null);
      var input = { invoiceDigest: current.invoice.invoiceDigest };
      var commandId;
      try {
        if (
          typeof client.createCustomServicesCustomBuildChangeCheckout !==
            "function"
        ) {
          throw new Error(
            "Secure added-work payment is unavailable in this build."
          );
        }
        commandId = customBuildCommandId(
          accountId,
          "change-checkout",
          current.invoice.invoiceId,
          input
        );
      } catch (error) {
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          {
            command: "",
            error: explain(
              error,
              "Secure added-work payment could not start."
            )
          }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        customerCustomBuildChangeCompletionPanel.focusStatus();
        return Promise.resolve(null);
      }
      var sequence = customBuildChangeCompletionReadSequence;
      customBuildChangeCompletionRead = Object.assign(
        {},
        customBuildChangeCompletionRead,
        { command: "opening added-work payment", error: "" }
      );
      renderCustomerCustomBuildChangeCompletionPanel();
      return client.createCustomServicesCustomBuildChangeCheckout(
        projectId,
        current.invoice.invoiceId,
        {
          commandId: commandId,
          invoiceDigest: current.invoice.invoiceDigest
        },
        { expectedInvoice: current }
      ).then(function (result) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        var checkout = verifiedCustomerCustomBuildChangeCheckout(
          result,
          current,
          new Date().toISOString()
        );
        var destination = safeCheckoutDestination(checkout);
        if (!checkout || !destination) {
          throw new Error(
            "The secure added-work payment destination could not be verified."
          );
        }
        clearCustomBuildAttempt(commandId);
        windowRef.location.assign(destination);
        return checkout;
      }).catch(function (error) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        if (
          [
            "CUSTOM_BUILD_CHANGE_CHECKOUT_REQUIRES_NEW_COMMAND",
            "CUSTOM_BUILD_CHANGE_PAYMENT_HELD",
            "CUSTOM_BUILD_CHANGE_PAYMENT_UNAVAILABLE"
          ].includes(text(error && error.code))
        ) clearCustomBuildAttempt(commandId);
        customBuildChangeCompletionRead = {
          accountId: accountId,
          projectId: projectId,
          phase: "ready",
          snapshot: snapshot,
          invoice: current,
          command: "",
          error: text(error && error.code) ===
            "CUSTOM_BUILD_CHANGE_CHECKOUT_RECONCILIATION_REQUIRED"
            ? "Do not try another payment. The payment-page result is uncertain and Site Sourcery must reconcile it first."
            : explain(
                error,
                "Secure added-work payment could not open. Refresh the exact invoice before trying again."
              )
        };
        renderCustomerCustomBuildChangeCompletionPanel();
        customerCustomBuildChangeCompletionPanel.focusStatus();
        return null;
      });
    }

    function openCustomerCustomBuildCompletionEvidence(
      evidenceInput,
      fallbackUrl
    ) {
      var projectId = customBuildChangeCompletionRead.projectId;
      var current = verifiedCustomerCustomBuildChangeCompletion(
        customBuildChangeCompletionRead.snapshot
      );
      var evidence = current && current.completion
        && current.completion.evidence.find(function (entry) {
          return entry === evidenceInput;
        });
      if (
        !projectId
        || !evidence
        || fallbackUrl !== customerCustomBuildCompletionEvidenceUrl(
          projectId,
          evidence.evidenceId
        )
        || typeof client.getCustomServicesCustomBuildCompletionEvidence !==
          "function"
      ) return Promise.resolve(null);
      var sequence = customBuildChangeCompletionReadSequence;
      customBuildChangeCompletionRead = Object.assign(
        {},
        customBuildChangeCompletionRead,
        { command: "evidence", error: "" }
      );
      renderCustomerCustomBuildChangeCompletionPanel();
      return client.getCustomServicesCustomBuildCompletionEvidence(
        projectId,
        evidence.evidenceId
      ).then(function (result) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        if (
          !result
          || !result.blob
          || result.mediaType !== evidence.mediaType
          || result.byteCount !== evidence.byteCount
          || result.contentDigest !== evidence.contentDigest
        ) throw new Error("The private completion proof did not match.");
        var URLRef = windowRef.URL;
        if (!URLRef || typeof URLRef.createObjectURL !== "function") {
          throw new Error("This browser cannot open private completion proof.");
        }
        var objectUrl = URLRef.createObjectURL(result.blob);
        var link = documentRef.createElement("a");
        link.href = objectUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.hidden = true;
        documentRef.body.appendChild(link);
        link.click();
        link.remove();
        windowRef.setTimeout(function () {
          URLRef.revokeObjectURL(objectUrl);
        }, 60000);
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          { command: "", error: "" }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return result;
      }).catch(function (error) {
        if (!customerCustomBuildChangeCompletionReadIsCurrent(
          sequence,
          projectId
        )) return null;
        var held = text(error && error.code) ===
          "CUSTOM_BUILD_CHANGE_COMPLETION_HELD"
          || Number(error && error.status) === 503;
        customBuildChangeCompletionRead = Object.assign(
          {},
          customBuildChangeCompletionRead,
          {
            command: "",
            error: held
              ? "Private completion proof is held or unavailable. Nothing changed."
              : explain(
                  error,
                  "Private completion proof could not be opened safely."
                )
          }
        );
        renderCustomerCustomBuildChangeCompletionPanel();
        return null;
      });
    }

    function renderCustomerCustomBuildChangeCompletionAccount(state) {
      var accountId = text(state.account && state.account.id);
      var projectId = accountId ? idOf(state.project) : "";
      if (!projectId) {
        if (
          customBuildChangeCompletionRead.projectId
          || customBuildChangeCompletionRead.accountId
        ) {
          customBuildChangeCompletionReadSequence += 1;
          customBuildChangeCompletionRead = {
            accountId: "",
            projectId: "",
            phase: "idle",
            snapshot: null,
            invoice: null,
            command: "",
            error: ""
          };
        }
        renderCustomerCustomBuildChangeCompletionPanel();
        return;
      }
      if (
        customBuildChangeCompletionRead.accountId !== accountId
        || customBuildChangeCompletionRead.projectId !== projectId
      ) {
        requestCustomerCustomBuildChangeCompletion(projectId);
        return;
      }
      renderCustomerCustomBuildChangeCompletionPanel();
    }

    function renderAssessmentPanel() {
      assessmentPanel.render(assessmentRead);
    }

    function assessmentReadIsCurrent(sequence, projectId) {
      return sequence === assessmentReadSequence
        && text(lastState.account && lastState.account.id) ===
          assessmentRead.accountId
        && idOf(lastState.project) === projectId;
    }

    function requestAssessment(projectId) {
      var selectedProjectId = text(projectId);
      var selectedAccountId = text(
        lastState.account && lastState.account.id
      );
      if (!selectedProjectId || !selectedAccountId) {
        return Promise.resolve(null);
      }
      var sequence = ++assessmentReadSequence;
      assessmentRead = {
        accountId: selectedAccountId,
        projectId: selectedProjectId,
        phase: "loading",
        request: null,
        quote: null,
        invoice: null,
        report: null,
        reportError: "",
        command: "",
        error: ""
      };
      renderAssessmentPanel();
      if (
        typeof client.getCustomServicesAssessmentRequest !== "function"
        || typeof client.getCustomServicesAssessmentQuote !== "function"
        || typeof client.getCustomServicesAssessmentInvoice !== "function"
        || typeof client.getCustomServicesAssessmentReport !== "function"
      ) {
        assessmentRead.phase = "error";
        assessmentRead.error =
          "Assessment requests are unavailable in this build.";
        renderAssessmentPanel();
        return Promise.resolve(null);
      }
      return Promise.all([
        client.getCustomServicesAssessmentRequest(selectedProjectId),
        client.getCustomServicesAssessmentQuote(selectedProjectId),
        client.getCustomServicesAssessmentInvoice(selectedProjectId),
        client.getCustomServicesAssessmentReport(selectedProjectId)
          .then(function (report) {
            return { error: "", value: report };
          })
          .catch(function (error) {
            return {
              error: explain(
                error,
                "The assessment report status could not be loaded."
              ),
              value: null
            };
          })
      ]).then(function (results) {
        if (!assessmentReadIsCurrent(sequence, selectedProjectId)) {
          return null;
        }
        assessmentRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: "ready",
          request: results[0],
          quote: results[1],
          invoice: results[2],
          report: results[3].value,
          reportError: results[3].error,
          command: "",
          error: ""
        };
        renderAssessmentPanel();
        return assessmentRead;
      }).catch(function (error) {
        if (!assessmentReadIsCurrent(sequence, selectedProjectId)) {
          return null;
        }
        assessmentRead = {
          accountId: selectedAccountId,
          projectId: selectedProjectId,
          phase: "error",
          request: null,
          quote: null,
          invoice: null,
          report: null,
          reportError: "",
          command: "",
          error: explain(
            error,
            "The assessment request could not be loaded."
          )
        };
        renderAssessmentPanel();
        assessmentPanel.focusStatus();
        return null;
      });
    }

    function runAssessmentCommand(command, invoke) {
      var projectId = idOf(lastState && lastState.project);
      if (!projectId || assessmentRead.phase !== "ready") {
        return Promise.resolve(null);
      }
      var sequence = assessmentReadSequence;
      assessmentRead = Object.assign({}, assessmentRead, {
        command: command,
        error: ""
      });
      renderAssessmentPanel();
      return Promise.resolve()
        .then(function () {
          return invoke(projectId);
        })
        .then(function () {
          if (!assessmentReadIsCurrent(sequence, projectId)) return null;
          return requestAssessment(projectId);
        })
        .catch(function (error) {
          if (!assessmentReadIsCurrent(sequence, projectId)) return null;
          assessmentRead = Object.assign({}, assessmentRead, {
            command: "",
            error: explain(
              error,
              "The assessment request could not be changed."
            )
          });
          renderAssessmentPanel();
          assessmentPanel.focusStatus();
          return null;
        });
    }

    function assessmentCheckoutCommandId(projectId, invoice) {
      if (
        assessmentCheckoutAttempt.projectId === projectId
        && assessmentCheckoutAttempt.invoiceId === invoice.invoiceId
        && assessmentCheckoutAttempt.invoiceDigest === invoice.invoiceDigest
        && UUID.test(text(assessmentCheckoutAttempt.commandId))
      ) return assessmentCheckoutAttempt.commandId;
      var cryptoObject = windowRef.crypto;
      var commandId = cryptoObject
        && typeof cryptoObject.randomUUID === "function"
        ? cryptoObject.randomUUID()
        : "";
      if (!UUID.test(text(commandId))) {
        throw new Error(
          "This browser cannot safely identify the assessment payment request. Update it and try again."
        );
      }
      assessmentCheckoutAttempt = {
        projectId: projectId,
        invoiceId: invoice.invoiceId,
        invoiceDigest: invoice.invoiceDigest,
        commandId: commandId
      };
      return commandId;
    }

    function requestAssessmentCheckout(invoiceState) {
      var projectId = idOf(lastState && lastState.project);
      var selected = verifiedAssessmentInvoice(invoiceState);
      var current = verifiedAssessmentInvoice(assessmentRead.invoice);
      if (
        !projectId
        || assessmentRead.phase !== "ready"
        || !selected
        || selected.state !== "checkout_available"
        || !current
        || current.state !== "checkout_available"
        || selected.invoice.invoiceId !== current.invoice.invoiceId
        || selected.invoice.invoiceDigest !== current.invoice.invoiceDigest
      ) return Promise.resolve(null);
      var commandId;
      try {
        if (
          typeof client.createCustomServicesAssessmentCheckout
            !== "function"
        ) {
          throw new Error(
            "Assessment payment is unavailable in this build."
          );
        }
        commandId = assessmentCheckoutCommandId(
          projectId,
          selected.invoice
        );
      } catch (error) {
        assessmentRead = Object.assign({}, assessmentRead, {
          command: "",
          error: explain(
            error,
            "Secure assessment payment could not start."
          )
        });
        renderAssessmentPanel();
        assessmentPanel.focusStatus();
        return Promise.resolve(null);
      }
      var sequence = assessmentReadSequence;
      assessmentRead = Object.assign({}, assessmentRead, {
        command: "opening secure payment",
        error: ""
      });
      renderAssessmentPanel();
      return client.createCustomServicesAssessmentCheckout(
        projectId,
        selected.invoice.invoiceId,
        { invoiceDigest: selected.invoice.invoiceDigest },
        { idempotencyKey: commandId }
      ).then(function (result) {
        if (!assessmentReadIsCurrent(sequence, projectId)) {
          return null;
        }
        var checkout = verifiedAssessmentCheckout(
          result,
          selected.invoice,
          new Date().toISOString()
        );
        var destination = safeCheckoutDestination(checkout);
        if (!checkout || !destination) {
          throw new Error(
            "The secure assessment payment destination could not be verified."
          );
        }
        windowRef.location.assign(destination);
        return checkout;
      }).catch(function (error) {
        if (!assessmentReadIsCurrent(sequence, projectId)) {
          return null;
        }
        if (
          [
            "ASSESSMENT_PAYMENT_UNAVAILABLE",
            "ASSESSMENT_CHECKOUT_REQUIRES_NEW_COMMAND"
          ].includes(text(error && error.code))
          && assessmentCheckoutAttempt.projectId === projectId
          && assessmentCheckoutAttempt.invoiceId ===
            selected.invoice.invoiceId
          && assessmentCheckoutAttempt.commandId === commandId
        ) {
          assessmentCheckoutAttempt = {
            projectId: "",
            invoiceId: "",
            invoiceDigest: "",
            commandId: ""
          };
        }
        assessmentRead = Object.assign({}, assessmentRead, {
          command: "",
          error: explain(
            error,
            "Secure assessment payment could not open. The same request can be tried safely."
          )
        });
        renderAssessmentPanel();
        assessmentPanel.focusStatus();
        return null;
      });
    }

    function renderAssessmentAccount(state) {
      var accountId = text(state.account && state.account.id);
      var projectId = accountId ? idOf(state.project) : "";
      if (!projectId) {
        if (assessmentRead.projectId || assessmentRead.accountId) {
          assessmentReadSequence += 1;
          assessmentRead = {
            accountId: "",
            projectId: "",
            phase: "idle",
            request: null,
            quote: null,
            invoice: null,
            report: null,
            reportError: "",
            command: "",
            error: ""
          };
        }
        renderAssessmentPanel();
        return;
      }
      if (
        assessmentRead.accountId !== accountId
        || assessmentRead.projectId !== projectId
      ) {
        requestAssessment(projectId);
        return;
      }
      renderAssessmentPanel();
    }

    function freshAlakazamCommandId() {
      var cryptoObject = windowRef.crypto;
      var commandId = cryptoObject
        && typeof cryptoObject.randomUUID === "function"
        ? cryptoObject.randomUUID()
        : "";
      if (!UUID.test(text(commandId))) {
        throw new Error(
          "This browser cannot safely identify the subscription request. Update it and try again."
        );
      }
      return commandId;
    }

    function renderAlakazamPanel() {
      alakazamPanel.render({
        projectId: alakazamRead.projectId,
        phase: alakazamRead.phase,
        presentation: alakazamRead.presentation,
        command: alakazamCommand,
        capabilities: capabilities
      });
    }

    function resetAlakazamCommand(projectId) {
      alakazamCommandSequence += 1;
      alakazamCommand = {
        projectId: text(projectId),
        selectedTierId: "",
        phase: "idle",
        quote: null,
        quoteCommandId: "",
        checkoutCommandId: "",
        scheduleCommandId: "",
        setupCommandId: "",
        setupLabel: "",
        error: ""
      };
    }

    function currentAlakazamAccount(projectId) {
      return alakazamRead.presentation
        && alakazamRead.projectId === projectId
        ? alakazamRead.presentation.account
        : null;
    }

    function alakazamCommandIsCurrent(
      sequence,
      projectId,
      tierId
    ) {
      return sequence === alakazamCommandSequence
        && Boolean(lastState.account)
        && idOf(lastState.project) === projectId
        && alakazamRead.phase === "ready"
        && Boolean(currentAlakazamAccount(projectId))
        && (
          tierId === undefined
          || alakazamCommand.selectedTierId === tierId
        );
    }

    function alakazamReadIsCurrent(
      sequence,
      projectId
    ) {
      return sequence === alakazamReadSequence
        && Boolean(lastState.account)
        && idOf(lastState.project) === projectId;
    }

    function requestAlakazamAccount(projectId) {
      var selectedProjectId = text(projectId);
      var requestedAcceptedVersionId = idOf(
        acceptedProjectVersion(
          lastState && lastState.project
        )
      );
      alakazamReadAcceptedVersionId =
        requestedAcceptedVersionId;
      var sequence = ++alakazamReadSequence;
      resetAlakazamCommand(selectedProjectId);
      alakazamRead = {
        projectId: selectedProjectId,
        phase: "loading",
        presentation: null
      };
      renderAlakazamPanel();
      if (
        !client
        || typeof client.getAlakazamAccount !==
          "function"
      ) {
        alakazamRead = {
          projectId: selectedProjectId,
          phase: "error",
          presentation: null
        };
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      return client
        .getAlakazamAccount(selectedProjectId)
        .then(function (result) {
          if (
            !alakazamReadIsCurrent(
              sequence,
              selectedProjectId
            )
          ) return null;
          if (
            idOf(acceptedProjectVersion(
              lastState && lastState.project
            )) !== requestedAcceptedVersionId
          ) {
            return requestAlakazamAccount(
              selectedProjectId
            );
          }
          var presentation =
            alakazamAccountPresentation(
              result,
              selectedProjectId
            );
          if (!presentation) {
            throw new Error(
              "The Alakazam account response was invalid."
            );
          }
          alakazamRead = {
            projectId: selectedProjectId,
            phase: "ready",
            presentation: presentation
          };
          renderAlakazamPanel();
          return presentation.account;
        })
        .catch(function () {
          if (
            !alakazamReadIsCurrent(
              sequence,
              selectedProjectId
            )
          ) return null;
          if (
            idOf(acceptedProjectVersion(
              lastState && lastState.project
            )) !== requestedAcceptedVersionId
          ) {
            return requestAlakazamAccount(
              selectedProjectId
            );
          }
          alakazamRead = {
            projectId: selectedProjectId,
            phase: "error",
            presentation: null
          };
          renderAlakazamPanel();
          return null;
        });
    }

    function refreshAlakazamAccountAfterSetup(
      projectId,
      addressLabel,
      acceptedVersionId,
      priorAddressLabel,
      priorSetupDigest
    ) {
      var selectedProjectId = text(projectId);
      var selectedLabel = text(addressLabel);
      var sequence = ++alakazamReadSequence;
      resetAlakazamCommand(selectedProjectId);
      alakazamRead = {
        projectId: selectedProjectId,
        phase: "loading",
        presentation: null
      };
      renderAlakazamPanel();
      alakazamPanel.focusStatus();
      if (
        !client
        || typeof client.getAlakazamAccount !==
          "function"
      ) {
        alakazamRead = {
          projectId: selectedProjectId,
          phase: "error",
          presentation: null
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return Promise.resolve(null);
      }
      return client
        .getAlakazamAccount(selectedProjectId)
        .then(function (result) {
          if (
            !alakazamReadIsCurrent(
              sequence,
              selectedProjectId
            )
          ) return null;
          var presentation =
            alakazamAccountPresentation(
              result,
              selectedProjectId
            );
          var refreshed = presentation
            && presentation.account;
          if (
            !refreshed
            || refreshed.site.acceptedVersionId !==
              acceptedVersionId
            || refreshed.site.addressLabel !==
              selectedLabel
            || refreshed.site.hostname !==
              selectedLabel + ".sitesourcery.me"
            || !SHA256.test(
              text(refreshed.site.setupDigest)
            )
            || (
              priorAddressLabel !== selectedLabel
              && priorSetupDigest
              && refreshed.site.setupDigest ===
                priorSetupDigest
            )
          ) {
            throw new Error(
              "The refreshed website setup did not match the saved address."
            );
          }
          alakazamRead = {
            projectId: selectedProjectId,
            phase: "ready",
            presentation: presentation
          };
          renderAlakazamPanel();
          alakazamPanel.focusStatus();
          return refreshed;
        })
        .catch(function () {
          if (
            !alakazamReadIsCurrent(
              sequence,
              selectedProjectId
            )
          ) return null;
          alakazamRead = {
            projectId: selectedProjectId,
            phase: "error",
            presentation: null
          };
          renderAlakazamPanel();
          alakazamPanel.focusStatus();
          return null;
        });
    }

    function requestAlakazamSiteSetup(addressLabelInput) {
      var projectId = idOf(lastState.project);
      var account = currentAlakazamAccount(projectId);
      var addressLabel = text(addressLabelInput);
      var accepted = acceptedProjectVersion(
        lastState.project
      );
      var acceptedVersionId = idOf(accepted);
      if (
        !projectId
        || !account
        || account.actions.configureSite !== true
        || !account.site
        || !acceptedVersionId
        || account.site.acceptedVersionId !==
          acceptedVersionId
        || !safeAlakazamAddressLabel(addressLabel)
        || !client
        || typeof client.selectAddress !== "function"
      ) return Promise.resolve(null);

      var canReuse =
        alakazamCommand.projectId === projectId
        && alakazamCommand.setupLabel === addressLabel
        && UUID.test(alakazamCommand.setupCommandId);
      var commandId;
      try {
        commandId = canReuse
          ? alakazamCommand.setupCommandId
          : freshAlakazamCommandId();
      } catch (error) {
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: "",
          phase: "idle",
          quote: null,
          quoteCommandId: "",
          checkoutCommandId: "",
          scheduleCommandId: "",
          setupCommandId: "",
          setupLabel: addressLabel,
          error: explain(
            error,
            "The hosted address could not be saved."
          )
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return Promise.resolve(null);
      }
      var priorAddressLabel = account.site.addressLabel;
      var priorSetupDigest = account.site.setupDigest;
      var sequence = ++alakazamCommandSequence;
      alakazamCommand = {
        projectId: projectId,
        selectedTierId: "",
        phase: "configuring",
        quote: null,
        quoteCommandId: "",
        checkoutCommandId: "",
        scheduleCommandId: "",
        setupCommandId: commandId,
        setupLabel: addressLabel,
        error: ""
      };
      renderAlakazamPanel();
      alakazamPanel.focusStatus();
      return client.selectAddress(
        projectId,
        { kind: "licensed", label: addressLabel },
        { idempotencyKey: commandId }
      ).then(function () {
        var currentAccepted = acceptedProjectVersion(
          lastState.project
        );
        if (
          !alakazamCommandIsCurrent(
            sequence,
            projectId
          )
          || idOf(currentAccepted) !== acceptedVersionId
        ) return null;
        return refreshAlakazamAccountAfterSetup(
          projectId,
          addressLabel,
          acceptedVersionId,
          priorAddressLabel,
          priorSetupDigest
        );
      }).catch(function (error) {
        if (!alakazamCommandIsCurrent(
          sequence,
          projectId
        )) return null;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: "",
          phase: "idle",
          quote: null,
          quoteCommandId: "",
          checkoutCommandId: "",
          scheduleCommandId: "",
          setupCommandId: commandId,
          setupLabel: addressLabel,
          error: explain(
            error,
            "The hosted address could not be saved. No billing request was sent."
          )
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return null;
      });
    }

    function refreshAlakazamAccountAfterDowngrade(
      projectId,
      scheduledInput
    ) {
      var selectedProjectId = text(projectId);
      var scheduled = clone(scheduledInput);
      if (
        !selectedProjectId
        || !record(scheduled)
        || scheduled.projectId !== selectedProjectId
      ) return Promise.resolve(null);
      var sequence = ++alakazamReadSequence;
      alakazamCommand = {
        projectId: selectedProjectId,
        selectedTierId: alakazamCommand.selectedTierId,
        phase: "scheduled",
        quote: alakazamCommand.quote,
        quoteCommandId: alakazamCommand.quoteCommandId,
        checkoutCommandId: "",
        scheduleCommandId:
          alakazamCommand.scheduleCommandId,
        scheduled: scheduled,
        refreshState: "loading",
        error: ""
      };
      renderAlakazamPanel();
      alakazamPanel.focusStatus();

      function failRefresh() {
        if (
          !alakazamReadIsCurrent(
            sequence,
            selectedProjectId
          )
        ) return scheduled;
        alakazamCommand = {
          projectId: selectedProjectId,
          selectedTierId:
            alakazamCommand.selectedTierId,
          phase: "scheduled",
          quote: alakazamCommand.quote,
          quoteCommandId:
            alakazamCommand.quoteCommandId,
          checkoutCommandId: "",
          scheduleCommandId:
            alakazamCommand.scheduleCommandId,
          scheduled: scheduled,
          refreshState: "error",
          error:
            "The downgrade is scheduled. Updated billing details could not be loaded. No second Schedule request was sent."
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return scheduled;
      }

      if (
        !client
        || typeof client.getAlakazamAccount !==
          "function"
      ) return Promise.resolve(failRefresh());
      return client
        .getAlakazamAccount(selectedProjectId)
        .then(function (result) {
          if (
            !alakazamReadIsCurrent(
              sequence,
              selectedProjectId
            )
          ) return scheduled;
          var presentation =
            alakazamAccountPresentation(
              result,
              selectedProjectId
            );
          if (
            !presentation
            || !confirmedAlakazamDowngradeProjection(
              presentation.account,
              scheduled
            )
          ) {
            throw new Error(
              "The scheduled downgrade is not in the refreshed account projection."
            );
          }
          alakazamRead = {
            projectId: selectedProjectId,
            phase: "ready",
            presentation: presentation
          };
          alakazamCommand = {
            projectId: selectedProjectId,
            selectedTierId:
              scheduled.targetTierId,
            phase: "scheduled",
            quote: alakazamCommand.quote,
            quoteCommandId:
              alakazamCommand.quoteCommandId,
            checkoutCommandId: "",
            scheduleCommandId:
              alakazamCommand.scheduleCommandId,
            scheduled: scheduled,
            refreshState: "complete",
            error: ""
          };
          renderAlakazamPanel();
          alakazamPanel.focusStatus();
          return scheduled;
        })
        .catch(function () {
          return failRefresh();
        });
    }

    function requestAlakazamQuote(tierIdInput) {
      var projectId = idOf(lastState.project);
      var account = currentAlakazamAccount(projectId);
      var tierId = text(tierIdInput);
      var expectedChange = expectedAlakazamQuoteChange(
        account,
        tierId
      );
      if (
        !projectId
        || !account
        || !expectedChange
        || capabilities.alakazamQuote !== true
        || !client
        || typeof client.createAlakazamQuote !== "function"
      ) return Promise.resolve(null);

      var canReuse =
        alakazamCommand.projectId === projectId
        && alakazamCommand.selectedTierId === tierId
        && !alakazamCommand.quote
        && UUID.test(alakazamCommand.quoteCommandId);
      var commandId;
      try {
        commandId = canReuse
          ? alakazamCommand.quoteCommandId
          : freshAlakazamCommandId();
      } catch (error) {
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: tierId,
          phase: "idle",
          quote: null,
          quoteCommandId: "",
          checkoutCommandId: "",
          scheduleCommandId: "",
          error: explain(
            error,
            "The subscription quote could not start."
          )
        };
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      var sequence = ++alakazamCommandSequence;
      alakazamCommand = {
        projectId: projectId,
        selectedTierId: tierId,
        phase: "quoting",
        quote: null,
        quoteCommandId: commandId,
        checkoutCommandId: "",
        scheduleCommandId: "",
        error: ""
      };
      renderAlakazamPanel();
      return client.createAlakazamQuote(
        projectId,
        { targetTierId: tierId },
        { idempotencyKey: commandId }
      ).then(function (result) {
        if (
          !alakazamCommandIsCurrent(
            sequence,
            projectId,
            tierId
          )
          || capabilities.alakazamQuote !== true
        ) return null;
        var quote = verifiedAlakazamQuote(
          result,
          projectId,
          currentAlakazamAccount(projectId),
          tierId,
          new Date().toISOString()
        );
        if (!quote) {
          alakazamCommand = {
            projectId: projectId,
            selectedTierId: tierId,
            phase: "idle",
            quote: null,
            quoteCommandId: "",
            checkoutCommandId: "",
            scheduleCommandId: "",
            error:
              "The subscription quote expired or could not be verified. Request a fresh quote."
          };
          renderAlakazamPanel();
          return null;
        }
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: tierId,
          phase: "quoted",
          quote: quote,
          quoteCommandId: commandId,
          checkoutCommandId: "",
          scheduleCommandId: "",
          error: ""
        };
        renderAlakazamPanel();
        return quote;
      }).catch(function (error) {
        if (!alakazamCommandIsCurrent(
          sequence,
          projectId,
          tierId
        )) return null;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: tierId,
          phase: "idle",
          quote: null,
          quoteCommandId: commandId,
          checkoutCommandId: "",
          scheduleCommandId: "",
          error: explain(
            error,
            "The subscription quote could not be loaded. Nothing was charged."
          )
        };
        renderAlakazamPanel();
        return null;
      });
    }

    function requestAlakazamCheckout() {
      var projectId = idOf(lastState.project);
      var account = currentAlakazamAccount(projectId);
      var selected = alakazamCommand;
      var quote = verifiedAlakazamQuote(
        selected.quote,
        projectId,
        account,
        selected.selectedTierId,
        new Date().toISOString()
      );
      if (!quote && selected.quote) {
        alakazamCommandSequence += 1;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: selected.selectedTierId,
          phase: "idle",
          quote: null,
          quoteCommandId: "",
          checkoutCommandId: "",
          scheduleCommandId: "",
          error:
            "This subscription quote expired. Request a fresh quote before continuing."
        };
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      if (
        !quote
        || !["start", "upgrade"].includes(
          quote.changeKind
        )
        || selected.phase !== "quoted"
        || capabilities.alakazamCheckout !== true
        || !client
        || typeof client.createAlakazamCheckout !==
          "function"
      ) return Promise.resolve(null);
      var siteSetupDigest = quote.changeKind === "start"
        ? account.site.setupDigest
        : null;
      if (
        quote.changeKind === "start"
        && !SHA256.test(text(siteSetupDigest))
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = UUID.test(
          selected.checkoutCommandId
        )
          ? selected.checkoutCommandId
          : freshAlakazamCommandId();
      } catch (error) {
        alakazamCommand.error = explain(
          error,
          "Secure payment could not start."
        );
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      var sequence = ++alakazamCommandSequence;
      alakazamCommand = {
        projectId: projectId,
        selectedTierId: selected.selectedTierId,
        phase: "checkout",
        quote: quote,
        quoteCommandId: selected.quoteCommandId,
        checkoutCommandId: commandId,
        scheduleCommandId: "",
        error: ""
      };
      renderAlakazamPanel();
      return client.createAlakazamCheckout(
        projectId,
        quote.quoteId,
        {
          acceptedDisclosureDigest:
            quote.disclosureDigest,
          siteSetupDigest: siteSetupDigest
        },
        { idempotencyKey: commandId }
      ).then(function (result) {
        if (
          !alakazamCommandIsCurrent(
            sequence,
            projectId,
            selected.selectedTierId
          )
          || capabilities.alakazamCheckout !== true
        ) return null;
        var checkout = verifiedAlakazamCheckout(
          result,
          projectId,
          quote.quoteId,
          commandId,
          new Date().toISOString()
        );
        var destination =
          safeCheckoutDestination(checkout);
        if (!checkout || !destination) {
          throw new Error(
            "The secure payment destination could not be verified."
          );
        }
        windowRef.location.assign(destination);
        return checkout;
      }).catch(function (error) {
        if (!alakazamCommandIsCurrent(
          sequence,
          projectId,
          selected.selectedTierId
        )) return null;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: selected.selectedTierId,
          phase: "quoted",
          quote: quote,
          quoteCommandId: selected.quoteCommandId,
          checkoutCommandId: commandId,
          scheduleCommandId: "",
          error: explain(
            error,
            "Secure payment could not open. The same request can be tried safely."
          )
        };
        renderAlakazamPanel();
        return null;
      });
    }

    function requestAlakazamDowngrade() {
      var projectId = idOf(lastState.project);
      var account = currentAlakazamAccount(projectId);
      var selected = alakazamCommand;
      var quote = verifiedAlakazamQuote(
        selected.quote,
        projectId,
        account,
        selected.selectedTierId,
        new Date().toISOString()
      );
      if (!quote && selected.quote) {
        alakazamCommandSequence += 1;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: selected.selectedTierId,
          phase: "idle",
          quote: null,
          quoteCommandId: "",
          checkoutCommandId: "",
          scheduleCommandId: "",
          error:
            "This downgrade quote expired. Request a fresh quote before continuing."
        };
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      if (
        !quote
        || quote.changeKind !== "downgrade"
        || selected.phase !== "quoted"
        || capabilities.alakazamDowngrade !== true
        || !client
        || typeof client.scheduleAlakazamDowngrade !==
          "function"
      ) return Promise.resolve(null);
      var commandId;
      try {
        commandId = UUID.test(
          selected.scheduleCommandId
        )
          ? selected.scheduleCommandId
          : freshAlakazamCommandId();
      } catch (error) {
        alakazamCommand.error = explain(
          error,
          "The downgrade schedule could not start."
        );
        renderAlakazamPanel();
        return Promise.resolve(null);
      }
      var sequence = ++alakazamCommandSequence;
      alakazamCommand = {
        projectId: projectId,
        selectedTierId: selected.selectedTierId,
        phase: "scheduling",
        quote: quote,
        quoteCommandId: selected.quoteCommandId,
        checkoutCommandId: "",
        scheduleCommandId: commandId,
        error: ""
      };
      renderAlakazamPanel();
      alakazamPanel.focusStatus();
      return client.scheduleAlakazamDowngrade(
        projectId,
        quote.quoteId,
        {
          acceptedDisclosureDigest:
            quote.disclosureDigest,
          quoteDigest: quote.quoteDigest
        },
        { idempotencyKey: commandId }
      ).then(function (result) {
        if (
          !alakazamCommandIsCurrent(
            sequence,
            projectId,
            selected.selectedTierId
          )
          || capabilities.alakazamDowngrade !== true
        ) return null;
        var scheduled = verifiedAlakazamDowngrade(
          result,
          projectId,
          quote,
          commandId
        );
        if (!scheduled) {
          throw new Error(
            "The downgrade schedule could not be verified."
          );
        }
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: selected.selectedTierId,
          phase: "scheduled",
          quote: quote,
          quoteCommandId: selected.quoteCommandId,
          checkoutCommandId: "",
          scheduleCommandId: commandId,
          scheduled: scheduled,
          refreshState: "loading",
          error: ""
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return refreshAlakazamAccountAfterDowngrade(
          projectId,
          scheduled
        );
      }).catch(function (error) {
        if (!alakazamCommandIsCurrent(
          sequence,
          projectId,
          selected.selectedTierId
        )) return null;
        alakazamCommand = {
          projectId: projectId,
          selectedTierId: selected.selectedTierId,
          phase: "quoted",
          quote: quote,
          quoteCommandId: selected.quoteCommandId,
          checkoutCommandId: "",
          scheduleCommandId: commandId,
          error: explain(
            error,
            "The downgrade could not be confirmed. The same request can be retried safely."
          )
        };
        renderAlakazamPanel();
        alakazamPanel.focusStatus();
        return null;
      });
    }

    function renderAlakazamAccount(state) {
      var projectId = state.account
        ? idOf(state.project)
        : "";
      if (!projectId) {
        alakazamReadAcceptedVersionId = "";
        if (alakazamRead.projectId) {
          alakazamReadSequence += 1;
          alakazamRead = {
            projectId: "",
            phase: "idle",
            presentation: null
          };
        }
        if (alakazamCommand.projectId) {
          resetAlakazamCommand("");
        }
        renderAlakazamPanel();
        return;
      }
      if (alakazamRead.projectId !== projectId) {
        requestAlakazamAccount(projectId);
        return;
      }
      if (
        alakazamRead.phase === "error"
        && idOf(acceptedProjectVersion(state.project)) !==
          alakazamReadAcceptedVersionId
      ) {
        requestAlakazamAccount(projectId);
        return;
      }
      if (
        alakazamRead.phase === "ready"
        && alakazamRead.presentation
        && idOf(acceptedProjectVersion(state.project)) !==
          text(
            alakazamRead.presentation.account.site
              .acceptedVersionId
          )
      ) {
        requestAlakazamAccount(projectId);
        return;
      }
      renderAlakazamPanel();
    }

    function reducedMotion() {
      return (
        typeof windowRef.matchMedia === "function"
        && windowRef
          .matchMedia(
            "(prefers-reduced-motion: reduce)"
          )
          .matches
      );
    }

    function pause(milliseconds) {
      return new Promise(function (resolve) {
        windowRef.setTimeout(resolve, milliseconds);
      });
    }

    function clearCheckoutReturnLocation() {
      if (
        !windowRef.history
        || typeof windowRef.history.replaceState !==
          "function"
      ) return;
      windowRef.history.replaceState(
        null,
        "",
        locationWithoutCheckoutReturn(
          windowRef.location
        )
      );
    }

    function reconcileDownloadCheckoutReturn(selectedReturn) {
      clearCheckoutReturnLocation();
      announce(
        "Checking Stripe for your payment and secure Download…"
      );
      return control
        .selectProject(
          selectedReturn.projectId,
          function (project) {
            return maker.loadProject(project);
          }
        )
        .then(function (project) {
          if (!project) {
            throw new Error(
              "The paid project could not be opened in this account."
            );
          }
          var accepted =
            acceptedProjectVersion(project);
          if (!accepted) {
            throw new Error(
              "The paid project has no accepted version to Download."
            );
          }
          control.selectVersion(idOf(accepted));
          var delays = [
            0,
            500,
            1000,
            1500,
            2500,
            4000,
            6000
          ];
          var attempt = 0;

          function check() {
            var current = control.getState();
            var entitlement = downloadEntitlement(
              current.project,
              current.selectedVersionId
            );
            if (entitlement) {
              return Promise.resolve(entitlement);
            }
            if (attempt >= delays.length) {
              return Promise.resolve(null);
            }
            var delay = delays[attempt];
            attempt += 1;
            return pause(delay)
              .then(function () {
                return control
                  .refreshSelectedProject();
              })
              .then(function (refreshed) {
                var nextAccepted =
                  acceptedProjectVersion(refreshed);
                if (nextAccepted) {
                  control.selectVersion(
                    idOf(nextAccepted)
                  );
                }
                return check();
              });
          }

          return check();
        })
        .then(function (entitlement) {
          if (entitlement) {
            revealControlRoom();
            announce(
              "Payment confirmed. Your Download is ready.",
              "success"
            );
            return entitlement;
          }
          announce(
            "Stripe is still confirming the payment. This page will not start another charge. Reopen this project in a moment to see the Download."
          );
          return null;
        })
        .catch(function (error) {
          announce(
            explain(
              error,
              "Payment confirmation could not be loaded. This page will not start another charge. Open your account project again in a moment."
            ),
            "error"
          );
          return null;
        });
    }

    function reconcileAssessmentCheckoutReturn(selectedReturn) {
      clearCheckoutReturnLocation();
      assessmentCheckoutAttempt = {
        projectId: "",
        invoiceId: "",
        invoiceDigest: "",
        commandId: ""
      };
      announce(
        "Checking Stripe for your assessment payment…"
      );
      return control
        .selectProject(
          selectedReturn.projectId,
          function (project) {
            return maker.loadProject(project);
          }
        )
        .then(function (project) {
          if (!project) {
            throw new Error(
              "The assessment project could not be opened in this account."
            );
          }
          revealControlRoom();
          var delays = [
            0,
            500,
            1000,
            1500,
            2500,
            4000,
            6000
          ];
          var attempt = 0;

          function check() {
            if (attempt >= delays.length) {
              return Promise.resolve(null);
            }
            var delay = delays[attempt];
            attempt += 1;
            return pause(delay)
              .then(function () {
                return requestAssessment(
                  selectedReturn.projectId
                );
              })
              .then(function (readState) {
                var projection = verifiedAssessmentInvoice(
                  readState && readState.invoice
                );
                if (
                  projection
                  && projection.state !== "not_available"
                  && projection.invoice.invoiceId !==
                    selectedReturn.invoiceId
                ) {
                  throw new Error(
                    "The returned assessment invoice does not match this project."
                  );
                }
                if (
                  projection
                  && [
                    "paid_job_open",
                    "payment_attention"
                  ].includes(projection.state)
                ) return projection;
                return check();
              });
          }

          return check();
        })
        .then(function (projection) {
          if (projection?.state === "paid_job_open") {
            announce(
              "Payment confirmed. Your assessment work is queued.",
              "success"
            );
            return projection;
          }
          if (projection?.state === "payment_attention") {
            announce(
              "Your assessment payment needs Site Sourcery review. Do not pay again.",
              "error"
            );
            return projection;
          }
          announce(
            "Stripe is still confirming the assessment payment. This page will not start another charge. Reopen this project in a moment to see its status."
          );
          return null;
        })
        .catch(function (error) {
          announce(
            explain(
              error,
              "Assessment payment confirmation could not be loaded. This page will not start another charge. Open the project again in a moment."
            ),
            "error"
          );
          return null;
        });
    }

    function maybeReconcileCheckoutReturn(state) {
      if (
        (!downloadCheckoutReturn && !assessmentCheckoutReturn)
        || checkoutReturnStarted
        || !state.account
      ) return;
      checkoutReturnStarted = true;
      windowRef.setTimeout(function () {
        if (assessmentCheckoutReturn) {
          reconcileAssessmentCheckoutReturn(
            assessmentCheckoutReturn
          );
        } else {
          reconcileDownloadCheckoutReturn(
            downloadCheckoutReturn
          );
        }
      }, 0);
    }

    function revealControlRoom(mode) {
      controlRoom.hidden = false;
      if (mode) setAuthMode(mode);
      controlRoom.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "start"
      });
    }

    function setAuthMode(mode) {
      var selectedMode = text(mode) || "create";
      var selectedTabMode =
        selectedMode === "activate"
          ? "create"
          : selectedMode;
      all("[data-auth-mode]").forEach(
        function (button) {
          var selected =
            button.getAttribute(
              "data-auth-mode"
            ) === selectedTabMode;
          button.setAttribute(
            "aria-selected",
            String(selected)
          );
          button.tabIndex = selected ? 0 : -1;
          if (
            button.getAttribute(
              "data-auth-mode"
            ) === "create"
          ) {
            button.setAttribute(
              "aria-controls",
              selectedMode === "activate"
                ? "auth-activate"
                : "auth-create"
            );
          }
        }
      );
      all("[data-auth-panel]").forEach(
        function (panel) {
          var selected =
            panel.getAttribute(
              "data-auth-panel"
            ) === selectedMode;
          panel.hidden = !selected;
          panel.setAttribute(
            "aria-hidden",
            String(!selected)
          );
        }
      );
    }

    function setStage(name) {
      all("[data-customer-stage]").forEach(
        function (stage) {
          stage.hidden =
            stage.getAttribute(
              "data-customer-stage"
            ) !== name;
        }
      );
      all("[data-customer-progress]").forEach(
        function (item) {
          if (
            item.getAttribute(
              "data-customer-progress"
            ) === name
          ) {
            item.setAttribute(
              "aria-current",
              "step"
            );
          } else {
            item.removeAttribute("aria-current");
          }
        }
      );
    }

    function accountName(account) {
      return text(
        account
        && (
          account.name
          || account.displayName
          || account.email
        )
      ) || "Site Sourcery account";
    }

    function renderProjects(state) {
      var list = one("[data-project-list]");
      if (!list) return;
      list.replaceChildren();
      state.projects.forEach(function (project) {
        var item = documentRef.createElement("li");
        var button =
          documentRef.createElement("button");
        var name =
          documentRef.createElement("strong");
        var detail =
          documentRef.createElement("span");
        button.type = "button";
        name.textContent =
          text(project.name) || "Website project";
        detail.textContent =
          idOf(project) === idOf(state.project)
            ? "Selected"
            : project.updatedAt
              ? "Open project · Last changed "
                + new Date(
                  project.updatedAt
                ).toLocaleString()
              : "Open project";
        if (
          idOf(project) === idOf(state.project)
        ) {
          button.setAttribute(
            "aria-current",
            "true"
          );
        }
        button.append(name, detail);
        button.addEventListener(
          "click",
          function () {
            run(
              button,
              function () {
                return control
                  .selectProject(
                    idOf(project),
                    function (selected) {
                      return maker.loadProject(
                        selected
                      );
                    }
                  )
                  .then(function (selected) {
                    if (!selected) return null;
                    pendingGuestCandidate = null;
                    var version =
                      acceptedProjectVersion(selected);
                    control.selectVersion(
                      idOf(version)
                    );
                    return selected;
                  });
              },
              "Project opened."
            );
          }
        );
        item.appendChild(button);
        list.appendChild(item);
      });
    }

    function renderQuote(state) {
      if (quoteExpiryTimer) {
        windowRef.clearTimeout(
          quoteExpiryTimer
        );
        quoteExpiryTimer = null;
      }
      var review =
        one("[data-download-quote-review]");
      var accepted =
        one("[data-accept-download-quote]");
      var continueButton =
        one("[data-continue-download-payment]");
      var view =
        state.downloadQuote
          ? verifiedDownloadQuote(
              state.downloadQuote,
              idOf(state.project),
              state.selectedVersionId,
              Date.now()
            )
          : null;
      activeQuote = view;
      if (!review) return;
      review.hidden = !view;
      if (!view) {
        if (accepted) accepted.checked = false;
        if (continueButton) {
          continueButton.disabled = true;
        }
        return;
      }
      one("[data-download-price]").textContent =
        view.price;
      one("[data-download-project]").textContent =
        text(state.project && state.project.name)
        || "Selected project";
      one("[data-download-version]").textContent =
        versionLabel(
          state.project,
          view.versionId
        );
      one("[data-download-expiry]").textContent =
        new Date(view.expiresAt).toLocaleString();
      one("[data-download-disclosure]")
        .textContent = view.disclosure;
      if (accepted) accepted.checked = false;
      if (continueButton) {
        continueButton.disabled = true;
      }
      quoteExpiryTimer =
        windowRef.setTimeout(
          function () {
            quoteExpiryTimer = null;
            render(control.getState());
            if (!activeQuote) {
              announce(
                "That quote expired. Get a new exact $5 quote before continuing."
              );
            }
          },
          Math.max(
            0,
            Math.min(
              2147483647,
              Date.parse(view.expiresAt)
                - Date.now()
                + 25
            )
          )
        );
    }

    function renderCapabilities(state) {
      var createButton =
        one("[data-create-account]");
      var registrationCopy =
        one("[data-registration-availability]");
      createButton.disabled =
        !capabilities.accountRegistration;
      registrationCopy.textContent =
        capabilities.accountRegistration
          ? "Account activation email is ready."
          : "New account email is not open yet. Existing customers can still sign in.";

      var recoveryButton =
        one("[data-request-recovery]");
      var recoveryCopy =
        one("[data-recovery-availability]");
      recoveryButton.disabled =
        !capabilities.accountRecoveryEmail;
      recoveryCopy.textContent =
        capabilities.accountRecoveryEmail
          ? "Account recovery email is ready."
          : "Recovery email is not open yet. Contact Site Sourcery for help.";

      var projectButton =
        one("[data-create-project]");
      var projectCopy =
        one("[data-project-availability]");
      projectButton.disabled =
        !pendingGuestCandidate;
      projectCopy.textContent =
        pendingGuestCandidate
          ? "Your reviewed preview is ready to save."
          : "Make and review a preview before creating its project.";

      var quoteButton =
        one("[data-request-download-quote]");
      var downloadCopy =
        one("[data-download-availability]");
      quoteButton.disabled = !(
        capabilities.downloadQuote
        && state.project
        && state.selectedVersionId
      );
      if (!capabilities.downloadQuote) {
        downloadCopy.textContent =
          "The $5 quote service is not open yet. Nothing can be charged.";
      } else if (
        !state.project
        || !state.selectedVersionId
      ) {
        downloadCopy.textContent =
          "Save and choose a version before requesting the quote.";
      } else if (!capabilities.downloadPayment) {
        downloadCopy.textContent =
          "The exact quote is available for review. Secure payment is not open yet.";
      } else {
        downloadCopy.textContent =
          "The exact quote and secure payment are ready.";
      }
    }

    function render(state) {
      lastState = state;
      var account = state.account;
      var sessionBar = one("[data-session-bar]");
      sessionBar.hidden = !account;
      if (account) {
        one("[data-account-name]").textContent =
          accountName(account);
        one("[data-account-email]").textContent =
          text(account.email);
      }
      renderProjects(state);
      renderQuote(state);
      renderCapabilities(state);
      renderAssessmentAccount(state);
      renderCustomerCustomBuildAccount(state);
      renderCustomerCustomBuildProgressAccount(state);
      renderCustomerCustomBuildChangeCompletionAccount(state);
      renderAlakazamAccount(state);
      syncOwnerAssessmentAccount(state);
      syncOwnerAssessmentWorkAccount(state);
      syncOwnerCustomBuildAccount(state);
      syncOwnerCustomBuildWorkAccount(state);

      var entitlement =
        downloadEntitlement(
          state.project,
          state.selectedVersionId
        );
      activeEntitlement = entitlement;
      var downloadButton =
        one("[data-download-html]");
      if (entitlement) {
        setStage("download");
        downloadButton.disabled =
          !text(
            entitlement.downloadUrl
            || entitlement.downloadToken
          );
        one("[data-download-ready-copy]")
          .textContent = downloadButton.disabled
            ? "Payment is confirmed. The secure file is still being prepared."
            : "Your project Download is ready.";
      } else if (!account) {
        setStage("account");
      } else if (
        !state.project
        || !state.selectedVersionId
      ) {
        setStage("project");
      } else {
        setStage("quote");
        one("[data-selected-version]")
          .textContent =
            "The exact quote will use "
            + versionLabel(
              state.project,
              state.selectedVersionId
            ).toLowerCase()
            + ".";
      }
      maybeReconcileCheckoutReturn(state);
    }

    function run(
      button,
      action,
      successMessage
    ) {
      if (button) button.disabled = true;
      announce("Working…");
      return Promise.resolve()
        .then(action)
        .then(function (result) {
          if (
            successMessage
            && result !== null
            && result !== undefined
          ) {
            announce(successMessage, "success");
          }
          return result;
        })
        .catch(function (error) {
          announce(
            explain(
              error,
              "That request could not be completed."
            ),
            "error"
          );
          return null;
        })
        .finally(function () {
          if (button) button.disabled = false;
          render(control.getState());
        });
    }

    function saveCandidate(candidate) {
      if (
        !candidate
        || !lastState.account
        || !lastState.project
      ) return Promise.resolve(null);
      var originDigest = text(
        candidate.result
        && candidate.result.artifactDigest
      );
      return control
        .acceptMadeVersion(candidate)
        .then(function (version) {
          if (
            !bindAcceptedVersion(
              maker,
              originDigest,
              version
            )
          ) {
            throw new Error(
              "That saved version no longer matches the preview in this tab."
            );
          }
          pendingGuestCandidate = null;
          announce(
            "Preview saved to this project.",
            "success"
          );
          return version;
        });
    }

    function flushDraft() {
      if (
        draftSaving
        || !queuedDraft
        || !lastState.project
      ) return;
      var queued = queuedDraft;
      queuedDraft = null;
      if (
        queued.projectId !==
        idOf(lastState.project)
      ) return;
      draftSaving = true;
      control
        .saveDraft(queued.raw)
        .catch(function (error) {
          announce(
            explain(
              error,
              "This draft could not be saved. Your preview is still in this tab."
            ),
            "error"
          );
        })
        .finally(function () {
          draftSaving = false;
          if (queuedDraft) flushDraft();
        });
    }

    all("[data-auth-mode]").forEach(
      function (button) {
        button.addEventListener(
          "click",
          function () {
            setAuthMode(
              button.getAttribute(
                "data-auth-mode"
              )
            );
          }
        );
      }
    );

    one("[data-create-account]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          return control.beginRegistration({
            name: value("accountName"),
            organizationName:
              value("organizationName"),
            email: value("accountEmail"),
            password: value("accountPassword")
          }).then(function (result) {
            var outcome =
              registrationOutcome(result);
            announce(
              outcome.message,
              outcome.activationReady
                ? "success"
                : "error"
            );
            if (outcome.activationReady) {
              setAuthMode("activate");
            }
            return result;
          });
        });
      });

    one("[data-complete-registration]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(
          button,
          function () {
            return control.completeRegistration({
              token: value("activationToken")
            });
          },
          "Account activated."
        );
      });

    one("[data-return-to-create]")
      .addEventListener("click", function () {
        one('[name="activationToken"]').value = "";
        setAuthMode("create");
        announce(
          "Enter the email you want tied to this account."
        );
      });

    one("[data-sign-in]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.signIn({
              email: value("signInEmail"),
              password: value("signInPassword")
            });
          },
          "Signed in."
        );
      });

    one("[data-sign-out]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            pendingGuestCandidate = null;
            return control
              .signOut()
              .then(function () {
                return { signedOut: true };
              });
          },
          "Signed out."
        );
      });

    one("[data-request-recovery]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          return control.requestRecovery({
            email: value("recoveryEmail")
          }).then(function (result) {
            var outcome = recoveryOutcome(result);
            one("[data-recovery-support]").hidden =
              !outcome.supportRequired;
            announce(
              outcome.message,
              outcome.supportRequired
                ? "error"
                : "success"
            );
            return result;
          });
        });
      });

    one("[data-complete-recovery]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.completeRecovery({
              token: value("recoveryToken"),
              password:
                value("recoveryPassword")
            });
          },
          "Password reset. Sign in with the new password."
        ).then(function (result) {
          if (result) setAuthMode("sign-in");
        });
      });

    one("[data-create-project]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          if (
            !one('[name="acceptedProjectTerms"]')
              .checked
          ) {
            throw new Error(
              "Accept the website terms before saving this project."
            );
          }
          if (!pendingGuestCandidate) {
            throw new Error(
              "Make and review a preview before saving its project."
            );
          }
          return control.createProject({
            name: value("projectName"),
            acceptedTerms: true
          }).then(function (project) {
            if (!project) return null;
            if (pendingGuestCandidate) {
              return saveCandidate(
                pendingGuestCandidate
              );
            }
            return project;
          });
        }, "Project saved.");
      });

    one("[data-request-download-quote]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.quoteDownload();
          },
          "Exact $5 quote ready."
        ).then(function () {
          var review =
            one("[data-download-quote-review]");
          if (!review.hidden) review.focus();
        });
      });

    one("[data-accept-download-quote]")
      .addEventListener("change", function (event) {
      one("[data-continue-download-payment]")
          .disabled = !(
            activeQuote
            && Date.parse(
              activeQuote.expiresAt
            ) > Date.now()
            && event.currentTarget.checked
            && capabilities.downloadPayment
          );
      });

    one("[data-continue-download-payment]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          if (
            !activeQuote
            || !one(
              "[data-accept-download-quote]"
            ).checked
          ) {
            throw new Error(
              "Review and accept the current $5 quote first."
            );
          }
          return control
            .prepareDownloadCheckout()
            .then(function (result) {
              var destination =
                safeCheckoutDestination(result);
              if (destination) {
                windowRef.location.assign(
                  destination
                );
                return result;
              }
              if (
                result
                && result.dispatchAuthorized ===
                  false
              ) {
                throw new Error(
                  "Secure payment is not open in this build. Nothing was charged."
                );
              }
              throw new Error(
                "The secure payment page was not verified. Nothing was charged."
              );
            });
        });
      });

    one("[data-download-html]")
      .addEventListener("click", function () {
        if (
          !activeEntitlement
          || !text(
            activeEntitlement.downloadUrl
          )
        ) {
          announce(
            "The secure HTML file is not ready yet.",
            "error"
          );
          return;
        }
        windowRef.location.assign(
          activeEntitlement.downloadUrl
        );
      });

    windowRef.addEventListener(
      "abracadabra:draftchange",
      function (event) {
        if (!lastState.project) return;
        windowRef.clearTimeout(draftTimer);
        queuedDraft = {
          projectId: idOf(lastState.project),
          raw:
            event.detail && event.detail.raw
              ? event.detail.raw
              : maker.getDraft()
        };
        draftTimer = windowRef.setTimeout(
          flushDraft,
          350
        );
      }
    );

    windowRef.addEventListener(
      "abracadabra:versionmade",
      function (event) {
        if (!event.detail) return;
        pendingGuestCandidate =
          clone(event.detail);
        render(control.getState());
        if (
          !lastState.account
          || !lastState.project
        ) {
          announce(
            "Preview ready. Create an account or sign in only when you want to save it.",
            "success"
          );
          return;
        }
        saveCandidate(pendingGuestCandidate)
          .catch(function (error) {
            announce(
              explain(
                error,
                "That version could not be saved."
              ),
              "error"
            );
          });
      }
    );

    windowRef.addEventListener(
      "abracadabra:versionselected",
      function (event) {
        control.selectVersion(
          event.detail
          && event.detail.platformVersionId
        );
      }
    );

    one("[data-save-direction]")
      .addEventListener("click", function () {
        revealControlRoom(
          lastState.account
            ? null
            : "create"
        );
        announce(
          lastState.account
            ? "Choose or create a project for this preview."
            : "Create an account or sign in to save this preview."
        );
      });

    var openAccount =
      one("[data-open-account]");
    if (openAccount) {
      openAccount.disabled = false;
      openAccount.addEventListener(
        "click",
        function () {
          revealControlRoom(
            lastState.account
              ? null
              : "sign-in"
          );
          announce(
            lastState.account
              ? "Your account is open."
              : "Sign in to your Site Sourcery account."
          );
        }
      );
    }

    if (activationToken) {
      one('[name="activationToken"]').value =
        activationToken;
      setAuthMode("activate");
      revealControlRoom("activate");
      announce(
        "Activation link opened. Select Activate account to finish."
      );
    } else if (recoveryToken) {
      one('[name="recoveryToken"]').value =
        recoveryToken;
      one("[data-recovery-complete]").hidden =
        false;
      setAuthMode("recover");
      revealControlRoom("recover");
      announce(
        "Recovery link opened. Choose a new password."
      );
    } else {
      setAuthMode("create");
    }

    control.subscribe(render);
    controlRoom.setAttribute(
      "data-control-ready",
      "hosted"
    );
    documentRef.documentElement.setAttribute(
      "data-abracadabra-control-ready",
      "hosted"
    );
    announce("Opening your account…");
    var capabilityRequest =
      typeof client.capabilities === "function"
        ? client.capabilities()
            .then(function (result) {
              var source =
                result
                && typeof result === "object"
                  ? result
                  : {};
              capabilities = Object.freeze({
                accountRegistration:
                  source.accountRegistration ===
                  true,
                accountRecoveryEmail:
                  source.accountRecoveryEmail ===
                  true,
                downloadQuote:
                  source.downloadQuote === true,
                downloadPayment:
                  source.downloadPayment === true,
                alakazamQuote:
                  source.alakazamQuote === true,
                alakazamCheckout:
                  source.alakazamCheckout === true,
                alakazamDowngrade:
                  source.alakazamDowngrade === true,
                domainPurchase:
                  source.domainPurchase === true,
                publishing:
                  source.publishing === true
              });
              render(control.getState());
              return capabilities;
            })
            .catch(function () {
              render(control.getState());
              return capabilities;
            })
        : Promise.resolve(capabilities);
    Promise.all([
      capabilityRequest,
      control.boot()
    ])
      .then(function () {
        if (control.getState().account) {
          announce("Account ready.", "success");
        } else if (
          downloadCheckoutReturn
          || assessmentCheckoutReturn
        ) {
          announce(
            assessmentCheckoutReturn
              ? "Sign in to finish confirming the assessment payment."
              : "Sign in to finish confirming the payment and open your Download."
          );
        } else if (!activationToken && !recoveryToken) {
          announce(
            "Your free preview is ready. Sign in only when you want to save it."
          );
        }
      })
      .catch(function (error) {
        announce(
          explain(
            error,
            "Your account could not open. Your free preview still works."
          ),
          "error"
        );
      });
    return true;
  }

  return Object.freeze({
    acceptedProjectVersion:
      acceptedProjectVersion,
    accountReceiptMoney:
      accountReceiptMoney,
    assessmentCheckoutReturnFromLocation:
      assessmentCheckoutReturnFromLocation,
    confirmedAlakazamDowngradeProjection:
      confirmedAlakazamDowngradeProjection,
    alakazamAccountPresentation:
      alakazamAccountPresentation,
    bindAcceptedVersion: bindAcceptedVersion,
    boot: boot,
    customBuildPublicEstimate:
      customBuildPublicEstimate,
    currentOwnerCustomBuildCompletionEvidence:
      currentOwnerCustomBuildCompletionEvidence,
    customerCustomBuildCompletionEvidenceUrl:
      customerCustomBuildCompletionEvidenceUrl,
    downloadCheckoutReturnFromLocation:
      downloadCheckoutReturnFromLocation,
    downloadEntitlement:
      downloadEntitlement,
    locationWithoutDownloadCheckoutReturn:
      locationWithoutDownloadCheckoutReturn,
    locationWithoutCheckoutReturn:
      locationWithoutCheckoutReturn,
    ownerReviewTargets:
      ownerReviewTargets,
    ownerAssessmentCoverageComplete:
      ownerAssessmentCoverageComplete,
    ownerAssessmentEvidenceUrl:
      ownerAssessmentEvidenceUrl,
    prepareAssessmentEvidenceFile:
      prepareAssessmentEvidenceFile,
    prepareCustomBuildCompletionEvidenceFile:
      prepareCustomBuildCompletionEvidenceFile,
    recoveryOutcome: recoveryOutcome,
    recoveryTokenFromLocation:
      recoveryTokenFromLocation,
    registrationOutcome:
      registrationOutcome,
    registrationTokenFromLocation:
      registrationTokenFromLocation,
    safeAlakazamSiteUrl:
      safeAlakazamSiteUrl,
    safeCheckoutDestination:
      safeCheckoutDestination,
    verifiedAlakazamAccount:
      verifiedAlakazamAccount,
    verifiedAlakazamCheckout:
      verifiedAlakazamCheckout,
    verifiedAlakazamDowngrade:
      verifiedAlakazamDowngrade,
    expectedAlakazamQuoteChange:
      expectedAlakazamQuoteChange,
    verifiedAlakazamQuote:
      verifiedAlakazamQuote,
    verifiedAssessmentCheckout:
      verifiedAssessmentCheckout,
    verifiedAssessmentInvoice:
      verifiedAssessmentInvoice,
    verifiedCustomerAssessmentReport:
      verifiedCustomerAssessmentReport,
    verifiedCustomerCustomBuildQuote:
      verifiedCustomerCustomBuildQuote,
    verifiedCustomerCustomBuildInvoice:
      verifiedCustomerCustomBuildInvoice,
    verifiedCustomerCustomBuildCheckout:
      verifiedCustomerCustomBuildCheckout,
    verifiedCustomBuildProgress:
      verifiedCustomBuildProgress,
    verifiedCustomerCustomBuildChangeCompletion:
      verifiedCustomerCustomBuildChangeCompletion,
    verifiedCustomerCustomBuildChangeInvoice:
      verifiedCustomerCustomBuildChangeInvoice,
    verifiedCustomerCustomBuildChangeCheckout:
      verifiedCustomerCustomBuildChangeCheckout,
    verifiedOwnerCustomBuildChangeCompletion:
      verifiedOwnerCustomBuildChangeCompletion,
    verifiedOwnerCustomBuildChangePayments:
      verifiedOwnerCustomBuildChangePayments,
    verifiedOwnerCustomBuildChangePaymentReconciliation:
      verifiedOwnerCustomBuildChangePaymentReconciliation,
    verifiedOwnerAssessmentDelivery:
      verifiedOwnerAssessmentDelivery,
    verifiedOwnerAssessmentEvidence:
      verifiedOwnerAssessmentEvidence,
    verifiedOwnerAssessmentFinding:
      verifiedOwnerAssessmentFinding,
    verifiedOwnerAssessmentJobs:
      verifiedOwnerAssessmentJobs,
    verifiedOwnerCustomBuildOpportunities:
      verifiedOwnerCustomBuildOpportunities,
    verifiedOwnerCustomBuildJobs:
      verifiedOwnerCustomBuildJobs,
    verifiedOwnerCustomBuildQuoteReceipt:
      verifiedOwnerCustomBuildQuoteReceipt,
    versionLabel: versionLabel,
    verifiedDownloadQuote:
      verifiedDownloadQuote,
    verifiedOwnerAssessmentQueue:
      verifiedOwnerAssessmentQueue
  });
}));
