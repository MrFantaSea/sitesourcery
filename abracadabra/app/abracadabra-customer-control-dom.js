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
    "sitesourcery.alakazam-account/v1";
  var ALAKAZAM_ACCOUNT_STATES = [
    "available",
    "activation_pending",
    "active",
    "attention_required",
    "ended"
  ];
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

  function verifiedAlakazamAccount(value, projectId) {
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
      || !exactKeys(
        value.actions,
        [
          "cancel",
          "changeTier",
          "manageBilling",
          "reason",
          "start"
        ]
      )
      || value.actions.start !== false
      || value.actions.changeTier !== false
      || value.actions.manageBilling !== false
      || value.actions.cancel !== false
      || value.actions.reason !==
        "customer_commands_not_composed"
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
      available: {
        heading: "Alakazam is available for this project.",
        summary:
          "There is no Alakazam subscription on this project."
      },
      activation_pending: {
        heading: "Alakazam activation is in progress.",
        summary:
          "The selected Alakazam tier is waiting to become active."
      },
      active: {
        heading: "Alakazam is active.",
        summary:
          "The current plan and renewal details are shown below."
      },
      attention_required: {
        heading: "This Alakazam account needs attention.",
        summary:
          "The payment state and any grace date are shown below."
      },
      ended: {
        heading: "This Alakazam subscription has ended.",
        summary:
          "The last recorded plan and receipts remain visible below."
      }
    }[account.state];
    return Object.freeze({
      account: account,
      heading: copy.heading,
      summary: copy.summary
    });
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
    row.append(
      accountElement(documentRef, "dt", "", label),
      accountElement(documentRef, "dd", "", value)
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

  function renderAlakazamAccountBody(
    documentRef,
    body,
    presentation
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

    if (!account.subscription) {
      var tiers = accountElement(
        documentRef,
        "section",
        "customer-alakazam-tiers"
      );
      var tierHeading = accountElement(
        documentRef,
        "h4",
        "",
        "Available tiers"
      );
      var tierList = accountElement(
        documentRef,
        "ul",
        "customer-alakazam-tier-list"
      );
      tierList.setAttribute(
        "aria-label",
        "Available Alakazam tiers"
      );
      account.catalog.tiers.forEach(function (tier) {
        var item = accountElement(
          documentRef,
          "li",
          "customer-alakazam-tier"
        );
        item.append(
          accountElement(
            documentRef,
            "strong",
            "",
            tier.name
          ),
          accountElement(
            documentRef,
            "span",
            "",
            accountMoney(tier.price) + " a month"
          )
        );
        tierList.appendChild(item);
      });
      tiers.append(tierHeading, tierList);
      body.appendChild(tiers);
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
    body.appendChild(
      accountElement(
        documentRef,
        "p",
        "customer-alakazam-actions-note",
        "Plan changes and billing management are not available in this panel yet."
      )
    );
  }

  function createAlakazamAccountPanel(
    documentRef,
    retry
  ) {
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
      "Project billing"
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
      "Try loading billing again"
    );
    retryButton.type = "button";
    retryButton.hidden = true;
    retryButton.setAttribute("data-alakazam-retry", "");
    retryButton.addEventListener("click", function () {
      if (typeof retry === "function") retry();
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
          String(readState.phase === "loading")
        );
        retryButton.disabled =
          readState.phase === "loading";
        retryButton.hidden =
          readState.phase !== "error";
        if (readState.phase === "loading") {
          status.textContent =
            "Loading this project's Alakazam details…";
          body.replaceChildren(
            accountElement(
              documentRef,
              "p",
              "customer-alakazam-placeholder",
              "Tier, renewal, credit, and receipt details are loading."
            )
          );
          return;
        }
        if (readState.phase === "error") {
          status.textContent =
            "Billing details could not be loaded.";
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
        status.textContent = "Billing details loaded.";
        renderAlakazamAccountBody(
          documentRef,
          body,
          readState.presentation
        );
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
    var alakazamReadSequence = 0;
    var alakazamRead = {
      projectId: "",
      phase: "idle",
      presentation: null
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

    var alakazamPanel =
      createAlakazamAccountPanel(
        documentRef,
        function () {
          var projectId = idOf(
            lastState && lastState.project
          );
          if (lastState.account && projectId) {
            requestAlakazamAccount(projectId);
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
      var sequence = ++alakazamReadSequence;
      alakazamRead = {
        projectId: selectedProjectId,
        phase: "loading",
        presentation: null
      };
      alakazamPanel.render(alakazamRead);
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
        alakazamPanel.render(alakazamRead);
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
          alakazamPanel.render(alakazamRead);
          return presentation.account;
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
          alakazamPanel.render(alakazamRead);
          return null;
        });
    }

    function renderAlakazamAccount(state) {
      var projectId = state.account
        ? idOf(state.project)
        : "";
      if (!projectId) {
        if (alakazamRead.projectId) {
          alakazamReadSequence += 1;
          alakazamRead = {
            projectId: "",
            phase: "idle",
            presentation: null
          };
        }
        alakazamPanel.render(alakazamRead);
        return;
      }
      if (alakazamRead.projectId !== projectId) {
        requestAlakazamAccount(projectId);
        return;
      }
      alakazamPanel.render(alakazamRead);
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
      renderAlakazamAccount(state);

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
    recoveryOutcome: recoveryOutcome,
    recoveryTokenFromLocation:
      recoveryTokenFromLocation,
    registrationOutcome:
      registrationOutcome,
    registrationTokenFromLocation:
      registrationTokenFromLocation,
    safeCheckoutDestination:
      safeCheckoutDestination,
    verifiedAlakazamAccount:
      verifiedAlakazamAccount,
    versionLabel: versionLabel,
    verifiedDownloadQuote:
      verifiedDownloadQuote
  });
}));
