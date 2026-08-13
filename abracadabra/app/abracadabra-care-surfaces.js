(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryCareSurfaces = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "sitesourcery.care-surface-dashboard/v1";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[0-9a-f]{64}$/u;

  function record(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function exactKeys(value, keys) {
    return record(value) && JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(keys.slice().sort());
  }

  function exactInstant(value) {
    var parsed = typeof value === "string" ? new Date(value) : null;
    return Boolean(
      parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    );
  }

  function exactDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
      new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value;
  }

  function verifiedCapacity(value) {
    if (!exactKeys(value, [
      "carried", "included", "remaining", "usedCarried", "usedIncluded"
    ])) return null;
    var keys = ["carried", "included", "remaining", "usedCarried", "usedIncluded"];
    if (!keys.every(function (key) {
      return Number.isSafeInteger(value[key]) && value[key] >= 0;
    }) || value.remaining !== value.carried + value.included -
      value.usedCarried - value.usedIncluded) return null;
    return Object.freeze(Object.assign({}, value));
  }

  function verifiedPeriod(value) {
    if (!exactKeys(value, [
      "authorityState", "capacity", "endsOn", "id", "projectId",
      "providerEffects", "revision", "startsOn", "state"
    ]) || !UUID.test(value.id) || !UUID.test(value.projectId) ||
      !exactDate(value.startsOn) || !exactDate(value.endsOn) ||
      !["open", "closed"].includes(value.state) ||
      value.authorityState !== "held" || value.providerEffects !== false ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
    var capacity = verifiedCapacity(value.capacity);
    if (!capacity) return null;
    return Object.freeze({
      id: value.id,
      projectId: value.projectId,
      startsOn: value.startsOn,
      endsOn: value.endsOn,
      state: value.state,
      revision: value.revision,
      capacity: capacity
    });
  }

  function verifiedTicket(value) {
    if (!exactKeys(value, [
      "allocatedUnits", "basis", "closedAt", "effects", "id", "openedAt",
      "periodId", "projectId", "resolvedAt", "revision", "state",
      "workScopeDigest"
    ]) || !UUID.test(value.id) || !UUID.test(value.periodId) ||
      !UUID.test(value.projectId) || !DIGEST.test(value.workScopeDigest) ||
      !exactKeys(value.basis, ["kind", "referenceDigest"]) ||
      !DIGEST.test(value.basis.referenceDigest) ||
      !["assessment_finding", "customer_request", "monitoring_incident",
        "rescue_scope"].includes(value.basis.kind) ||
      !exactKeys(value.effects, ["mail", "provider"]) ||
      value.effects.mail !== false || value.effects.provider !== false ||
      !["open", "in_progress", "waiting_customer", "resolved", "closed"]
        .includes(value.state) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Number.isSafeInteger(value.allocatedUnits) || value.allocatedUnits < 0 ||
      !exactInstant(value.openedAt) ||
      !(value.resolvedAt === null || exactInstant(value.resolvedAt)) ||
      !(value.closedAt === null || exactInstant(value.closedAt))) return null;
    return Object.freeze({
      id: value.id,
      periodId: value.periodId,
      projectId: value.projectId,
      basisKind: value.basis.kind,
      basisReferenceDigest: value.basis.referenceDigest,
      workScopeDigest: value.workScopeDigest,
      state: value.state,
      revision: value.revision,
      allocatedUnits: value.allocatedUnits,
      openedAt: value.openedAt
    });
  }

  function verifiedContract(value, audience) {
    var keys = [
      "authorityState", "catalog", "contractKind", "effects", "id", "periods",
      "projectId", "tickets"
    ];
    if (audience === "operator") keys.push("customerId");
    if (!exactKeys(value, keys) || !UUID.test(value.id) ||
      !UUID.test(value.projectId) ||
      (audience === "operator" && !UUID.test(value.customerId)) ||
      !["rescue", "custom_care", "outside_management", "alakazam_care"]
        .includes(value.contractKind) || value.authorityState !== "held" ||
      !exactKeys(value.effects, ["customer", "payment", "provider"]) ||
      value.effects.customer !== false || value.effects.payment !== false ||
      value.effects.provider !== false ||
      !exactKeys(value.catalog, [
        "billingCadence", "capacityUnitKind", "catalogVersion",
        "commercialAuthorityState", "serviceKey"
      ]) || !Array.isArray(value.periods) || !Array.isArray(value.tickets)) {
      return null;
    }
    var periods = value.periods.map(verifiedPeriod);
    var tickets = value.tickets.map(verifiedTicket);
    if (periods.includes(null) || tickets.includes(null)) return null;
    return Object.freeze({
      id: value.id,
      projectId: value.projectId,
      customerId: audience === "operator" ? value.customerId : null,
      kind: value.contractKind,
      serviceKey: String(value.catalog.serviceKey),
      cadence: String(value.catalog.billingCadence),
      capacityUnitKind: String(value.catalog.capacityUnitKind),
      commercialAuthorityState: String(value.catalog.commercialAuthorityState),
      periods: Object.freeze(periods),
      tickets: Object.freeze(tickets)
    });
  }

  function verify(value, audience) {
    if (!exactKeys(value, [
      "audience", "contracts", "held", "observedAt", "organizationId", "schema"
    ]) || value.schema !== SCHEMA || value.audience !== audience ||
      !UUID.test(value.organizationId) || !exactInstant(value.observedAt) ||
      !exactKeys(value.held, [
        "commercialRelease", "customerEffects", "mailDelivery",
        "paymentEffects", "providerEffects"
      ]) || !Object.keys(value.held).every(function (key) {
        return value.held[key] === true;
      }) || !Array.isArray(value.contracts) || value.contracts.length > 100) {
      throw new Error("The held Care projection is invalid.");
    }
    var contracts = value.contracts.map(function (contract) {
      return verifiedContract(contract, audience);
    });
    if (contracts.includes(null)) {
      throw new Error("The held Care projection is invalid.");
    }
    return Object.freeze({
      audience: audience,
      organizationId: value.organizationId,
      observedAt: value.observedAt,
      contracts: Object.freeze(contracts)
    });
  }

  function title(value) {
    return value.replaceAll("_", " ").replace(/\b\w/gu, function (letter) {
      return letter.toUpperCase();
    });
  }

  function presentation(value, audience) {
    var verified = verify(value, audience);
    var periods = verified.contracts.reduce(function (count, contract) {
      return count + contract.periods.length;
    }, 0);
    var tickets = verified.contracts.reduce(function (count, contract) {
      return count + contract.tickets.length;
    }, 0);
    var capacity = verified.contracts.reduce(function (count, contract) {
      return count + contract.periods.reduce(function (sum, period) {
        return sum + period.capacity.remaining;
      }, 0);
    }, 0);
    return Object.freeze({
      audience: audience,
      heading: audience === "customer" ? "Your Care work" : "Care operations",
      summary: verified.contracts.length === 0
        ? "No held Care contract is attached to this account."
        : verified.contracts.length + " held Care contract" +
          (verified.contracts.length === 1 ? "" : "s") + ", " + periods +
          " period" + (periods === 1 ? "" : "s") + ", and " + tickets +
          " ticket" + (tickets === 1 ? "" : "s") + ".",
      holdNotice:
        "Quotes, payment, mail delivery, customer release, and provider work remain held.",
      remainingCapacity: capacity,
      observedAt: verified.observedAt,
      contracts: Object.freeze(verified.contracts.map(function (contract) {
        return Object.freeze({
          id: contract.id,
          projectId: contract.projectId,
          title: title(contract.kind),
          service: title(contract.serviceKey),
          cadence: title(contract.cadence),
          commercialState: title(contract.commercialAuthorityState),
          periods: contract.periods,
          tickets: contract.tickets
        });
      }))
    });
  }

  function element(documentRef, name, className, text) {
    var selected = documentRef.createElement(name);
    if (className) selected.className = className;
    if (text !== undefined) selected.textContent = text;
    return selected;
  }

  function action(documentRef, label, value, onCommand) {
    var button = element(documentRef, "button", "care-surface-action", label);
    button.type = "button";
    button.addEventListener("click", function () {
      onCommand(Object.freeze(value));
    });
    return button;
  }

  function ticketTransitions(state) {
    if (state === "open") return [["start", "Start work"]];
    if (state === "in_progress") return [
      ["wait", "Wait for customer"],
      ["resolve", "Resolve ticket"]
    ];
    if (state === "waiting_customer") return [["resume", "Resume work"]];
    if (state === "resolved") return [
      ["reopen", "Reopen ticket"],
      ["close", "Close ticket"]
    ];
    return [];
  }

  function mount(options) {
    options = options || {};
    var documentRef = options.documentRef || document;
    var container = options.container;
    var audience = options.audience;
    var shown = presentation(options.snapshot, audience);
    var onCommand = typeof options.onCommand === "function"
      ? options.onCommand
      : function () {};
    if (!container || typeof container.append !== "function") {
      throw new Error("The Care panel mount is invalid.");
    }
    var panel = element(documentRef, "section", "care-surface");
    panel.setAttribute("data-care-surface", audience);
    var heading = element(documentRef, "h2", "care-surface-heading", shown.heading);
    heading.id = "care-surface-" + audience;
    panel.setAttribute("aria-labelledby", heading.id);
    var summary = element(documentRef, "p", "care-surface-summary", shown.summary);
    var hold = element(documentRef, "p", "care-surface-hold", shown.holdNotice);
    hold.setAttribute("role", "status");
    var metrics = element(documentRef, "dl", "care-surface-metrics");
    [
      ["Remaining capacity", String(shown.remainingCapacity)],
      ["Evidence refreshed", shown.observedAt.slice(0, 10)]
    ].forEach(function (fact) {
      var card = element(documentRef, "div", "care-surface-metric");
      card.append(
        element(documentRef, "dt", "", fact[0]),
        element(documentRef, "dd", "", fact[1])
      );
      metrics.append(card);
    });
    var contracts = element(documentRef, "div", "care-surface-contracts");
    shown.contracts.forEach(function (contract) {
      var card = element(documentRef, "article", "care-surface-contract");
      var titleNode = element(documentRef, "h3", "", contract.title);
      var meta = element(
        documentRef,
        "p",
        "care-surface-meta",
        contract.service + " · " + contract.cadence + " · " + contract.commercialState
      );
      var periodList = element(documentRef, "ul", "care-surface-list");
      contract.periods.forEach(function (period) {
        var item = element(
          documentRef,
          "li",
          "care-surface-item",
          period.startsOn + " to " + period.endsOn + ": " +
            period.capacity.remaining + " remaining (" + period.state + ")"
        );
        if (audience === "operator" && period.state === "open") {
          item.append(action(documentRef, "Close held period", {
            action: "close-period",
            periodId: period.id,
            projectId: period.projectId,
            expectedRevision: period.revision
          }, onCommand));
        }
        periodList.append(item);
      });
      var ticketList = element(documentRef, "ul", "care-surface-list");
      contract.tickets.forEach(function (ticket) {
        var item = element(
          documentRef,
          "li",
          "care-surface-item",
          title(ticket.basisKind) + " · " + ticket.state.replaceAll("_", " ") +
            " · digest " + ticket.basisReferenceDigest.slice(0, 12)
        );
        if (audience === "operator") {
          var controls = element(documentRef, "div", "care-surface-controls");
          ticketTransitions(ticket.state).forEach(function (transition) {
            controls.append(action(documentRef, transition[1], {
              action: "transition-ticket",
              ticketId: ticket.id,
              projectId: ticket.projectId,
              expectedRevision: ticket.revision,
              transition: transition[0]
            }, onCommand));
          });
          if (ticket.state !== "closed") {
            controls.append(
              action(documentRef, "Allocate held capacity", {
                action: "allocate-capacity",
                periodId: ticket.periodId,
                ticketId: ticket.id,
                projectId: ticket.projectId
              }, onCommand),
              action(documentRef, "Reserve held notice", {
                action: "reserve-mail",
                ticketId: ticket.id
              }, onCommand)
            );
          }
          item.append(controls);
        }
        ticketList.append(item);
      });
      card.append(titleNode, meta, periodList, ticketList);
      if (audience === "operator") {
        var prepare = action(
          documentRef,
          "Prepare new held Care record",
          {
            action: "prepare",
            contractId: contract.id,
            projectId: contract.projectId
          },
          onCommand
        );
        card.append(prepare);
      }
      contracts.append(card);
    });
    if (audience === "customer") {
      var heldAction = element(
        documentRef,
        "button",
        "care-surface-action",
        "New Care request unavailable"
      );
      heldAction.type = "button";
      heldAction.disabled = true;
      heldAction.setAttribute("aria-disabled", "true");
      panel.append(heading, summary, hold, metrics, contracts, heldAction);
    } else {
      panel.append(heading, summary, hold, metrics, contracts);
    }
    container.append(panel);
    return Object.freeze({ element: panel, presentation: shown });
  }

  return Object.freeze({
    customerPresentation: function (snapshot) {
      return presentation(snapshot, "customer");
    },
    operatorPresentation: function (snapshot) {
      return presentation(snapshot, "operator");
    },
    mount: mount
  });
}));
