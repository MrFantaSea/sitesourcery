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
        "Calculated later on the separate invoice, if applicable"
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
              ? "Accepted. Site Sourcery will issue the separate invoice next; work does not begin before payment."
              : quoteState.actions.acceptQuote.message
          )
        );
      }
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
        if (!request || !quote) {
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
      projectId: "",
      phase: "idle",
      request: null,
      quote: null,
      command: "",
      error: ""
    };
    var ownerQuoteRead = {
      accountId: "",
      phase: "idle",
      queue: null,
      busyCaseId: "",
      error: ""
    };
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
    var checkoutReturn =
      downloadCheckoutReturnFromLocation(
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
          assessmentPanel.element
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

    function renderAssessmentPanel() {
      assessmentPanel.render(assessmentRead);
    }

    function assessmentReadIsCurrent(sequence, projectId) {
      return sequence === assessmentReadSequence
        && Boolean(lastState.account)
        && idOf(lastState.project) === projectId;
    }

    function requestAssessment(projectId) {
      var selectedProjectId = text(projectId);
      if (!selectedProjectId) return Promise.resolve(null);
      var sequence = ++assessmentReadSequence;
      assessmentRead = {
        projectId: selectedProjectId,
        phase: "loading",
        request: null,
        quote: null,
        command: "",
        error: ""
      };
      renderAssessmentPanel();
      if (
        typeof client.getCustomServicesAssessmentRequest !== "function"
        || typeof client.getCustomServicesAssessmentQuote !== "function"
      ) {
        assessmentRead.phase = "error";
        assessmentRead.error =
          "Assessment requests are unavailable in this build.";
        renderAssessmentPanel();
        return Promise.resolve(null);
      }
      return Promise.all([
        client.getCustomServicesAssessmentRequest(selectedProjectId),
        client.getCustomServicesAssessmentQuote(selectedProjectId)
      ]).then(function (results) {
        if (!assessmentReadIsCurrent(sequence, selectedProjectId)) {
          return null;
        }
        assessmentRead = {
          projectId: selectedProjectId,
          phase: "ready",
          request: results[0],
          quote: results[1],
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
          projectId: selectedProjectId,
          phase: "error",
          request: null,
          quote: null,
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

    function renderAssessmentAccount(state) {
      var projectId = state.account ? idOf(state.project) : "";
      if (!projectId) {
        if (assessmentRead.projectId) {
          assessmentReadSequence += 1;
          assessmentRead = {
            projectId: "",
            phase: "idle",
            request: null,
            quote: null,
            command: "",
            error: ""
          };
        }
        renderAssessmentPanel();
        return;
      }
      if (assessmentRead.projectId !== projectId) {
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
        locationWithoutDownloadCheckoutReturn(
          windowRef.location
        )
      );
    }

    function reconcileCheckoutReturn(selectedReturn) {
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

    function maybeReconcileCheckoutReturn(state) {
      if (
        !checkoutReturn
        || checkoutReturnStarted
        || !state.account
      ) return;
      checkoutReturnStarted = true;
      windowRef.setTimeout(function () {
        reconcileCheckoutReturn(checkoutReturn);
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
      renderAlakazamAccount(state);
      syncOwnerAssessmentAccount(state);

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
        } else if (checkoutReturn) {
          announce(
            "Sign in to finish confirming the payment and open your Download."
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
    confirmedAlakazamDowngradeProjection:
      confirmedAlakazamDowngradeProjection,
    alakazamAccountPresentation:
      alakazamAccountPresentation,
    bindAcceptedVersion: bindAcceptedVersion,
    boot: boot,
    downloadCheckoutReturnFromLocation:
      downloadCheckoutReturnFromLocation,
    downloadEntitlement:
      downloadEntitlement,
    locationWithoutDownloadCheckoutReturn:
      locationWithoutDownloadCheckoutReturn,
    ownerReviewTargets:
      ownerReviewTargets,
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
    versionLabel: versionLabel,
    verifiedDownloadQuote:
      verifiedDownloadQuote,
    verifiedOwnerAssessmentQueue:
      verifiedOwnerAssessmentQueue
  });
}));
