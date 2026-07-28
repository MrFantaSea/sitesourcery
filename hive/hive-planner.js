(function (global) {
  "use strict";

  if (!global || global.SiteSourceryHivePlanner) return;

  var SCHEMA = "sitesourcery.hive-blueprint.v1";
  var STATUS = "planning_only";
  var NOTICE = "Planning blueprint only. No Hive integration, message, booking, review request, invoice action, or provider connection is active.";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  var CELLS = deepFreeze([
    {
      id: "missed-call",
      label: "Missed-call responder",
      problem: "A legitimate caller reaches the business when nobody can answer, and the reason for the call may be lost.",
      trigger: "An inbound call ends unanswered during an explicitly configured coverage window.",
      allowedActions: [
        "Classify the unanswered-call event against approved business hours and routing rules.",
        "Prepare one approved acknowledgement for an eligible, consented contact route.",
        "Create a bounded follow-up item with the original event identity and no invented urgency."
      ],
      hardBoundary: "Never claim an emergency response, diagnose intent, record or transcribe a call without a separate lawful basis, promise availability, or contact a person through an unapproved channel.",
      dataConsentConcern: "A caller number and call metadata are personal data. Purpose, channel permission, retention, suppression, and any provider role must be explicit before an outbound effect.",
      fallbackHumanHandoff: "If consent, urgency, identity, routing, or the approved response is uncertain, prepare a human-review item and make no outbound contact.",
      killSwitch: "A cell-level pause blocks every new outbound effect while preserving the minimum event evidence needed for review and duplicate suppression."
    },
    {
      id: "booking",
      label: "Booking guide",
      problem: "A person wants an appointment but may not know which service, duration, location, or available time applies.",
      trigger: "A customer starts an approved booking-help path or an eligible inquiry is deliberately routed to booking.",
      allowedActions: [
        "Ask only the released service, location, timing, and contact questions required by the booking policy.",
        "Read approved availability without creating or changing an appointment.",
        "Prepare a booking request or provider handoff that keeps all unconfirmed details visibly provisional."
      ],
      hardBoundary: "Never invent availability, overbook, select a service with safety consequences, mutate a calendar, take payment, or state that a booking is confirmed without an exact provider receipt.",
      dataConsentConcern: "Contact details, requested service, location, and schedule may reveal personal information. Collect the minimum fields for the stated booking purpose and honor deletion and suppression rules.",
      fallbackHumanHandoff: "Route conflicts, accessibility needs, special requests, provider uncertainty, and any high-risk service choice to a named human before confirmation.",
      killSwitch: "A booking pause disables new provider mutations and confirmations while leaving a truthful call-or-email fallback visible."
    },
    {
      id: "review-request",
      label: "Review request",
      problem: "Satisfied customers may never be invited to share honest feedback, while careless automation can become spam or manipulate reviews.",
      trigger: "A separately evidenced customer job reaches an eligible completed state and the approved review-request delay expires.",
      allowedActions: [
        "Check completion, contact permission, suppression, timing, and duplicate-request rules.",
        "Prepare one neutral request for honest feedback using approved language and destination.",
        "Record the request outcome needed to prevent repeated or contradictory outreach."
      ],
      hardBoundary: "Never fabricate a review, screen out negative sentiment, offer an undisclosed incentive, ask employees or ineligible parties, or imply that a favorable rating is required.",
      dataConsentConcern: "The customer relationship and contact route cannot be reused for review outreach without the documented purpose, permission, retention, and opt-out behavior.",
      fallbackHumanHandoff: "Disputes, refunds, unresolved work, uncertain eligibility, complaints, and ambiguous consent stop the request and route the record to a human.",
      killSwitch: "A review-request pause stops all queued requests immediately and preserves suppression and prior-send evidence."
    },
    {
      id: "after-hours",
      label: "After-hours information",
      problem: "People need accurate basic information when the business is closed, but an automated answer can easily overstate facts or mishandle urgent situations.",
      trigger: "An approved information request arrives outside the configured staffed window.",
      allowedActions: [
        "Retrieve only current facts from the approved business-information set.",
        "Answer a bounded factual question with source and freshness rules applied.",
        "Offer the approved next staffed contact path when no approved answer is present or the facts remain uncertain."
      ],
      hardBoundary: "Never provide emergency, medical, legal, financial, or safety advice; invent hours, prices, policies, availability, or credentials; or pretend a person is presently responding.",
      dataConsentConcern: "Ordinary public-information questions should not require identity. Any retained contact or conversation data needs a separate purpose, minimum retention, and disclosed provider path.",
      fallbackHumanHandoff: "Uncertain facts, urgent language, sensitive topics, account-specific requests, and unsupported questions receive a safe limitation message plus the approved human route.",
      killSwitch: "A knowledge or incident pause disables generated answers and leaves only the reviewed closure notice and human contact route."
    },
    {
      id: "follow-up",
      label: "Follow-up",
      problem: "A promised next step can disappear during a busy day, causing a real customer or lead to be forgotten.",
      trigger: "An approved lead, customer, or task record reaches a specifically scheduled follow-up time.",
      allowedActions: [
        "Check the exact purpose, owner, due time, consent, suppression, and prior-contact history.",
        "Prepare the approved follow-up for the permitted channel.",
        "Create a visible exception item when the record is stale, incomplete, duplicated, or contradicted."
      ],
      hardBoundary: "Never create a new marketing purpose, continue after opt-out, invent prior conversations, make an offer or promise without authority, or contact an unrelated person.",
      dataConsentConcern: "Lead and customer facts remain purpose-scoped. Source, consent, channel, retention, access, correction, and suppression must survive every follow-up revision.",
      fallbackHumanHandoff: "Complaints, sensitive content, stale facts, repeated nonresponse, uncertain identity, and any requested decision route to the accountable human.",
      killSwitch: "A campaign, tenant, channel, or global pause blocks queued follow-ups before any provider effect and retains suppression state."
    },
    {
      id: "getting-paid",
      label: "Getting-paid reminder",
      problem: "An accepted invoice may become overdue without a clear, respectful reminder and dispute path.",
      trigger: "An exact accepted invoice reaches a configured due or overdue milestone without a reconciled payment, credit, dispute, or pause.",
      allowedActions: [
        "Reconcile the invoice identity, balance, due state, prior reminders, credits, disputes, and approved contact route.",
        "Prepare a factual reminder using the exact invoice amount and customer-safe payment destination already on record.",
        "Record delivery or uncertainty so duplicate reminders and contradictory balances fail closed."
      ],
      hardBoundary: "Never create or alter an invoice, charge a payment method, add a fee, threaten collection or legal action, disclose debt to another party, or continue while the amount or dispute state is uncertain.",
      dataConsentConcern: "Invoice and contact records are confidential business data. Access, delivery destination, retention, dispute handling, and any processor role must be exact and minimized.",
      fallbackHumanHandoff: "Disputes, hardship, partial payment, refund or credit questions, delivery uncertainty, identity mismatch, and repeated lateness pause automation for human review.",
      killSwitch: "An account, invoice, dispute, or global pause blocks every reminder before delivery while preserving reconciliation and suppression evidence."
    }
  ]);

  var CELL_BY_ID = Object.create(null);
  CELLS.forEach(function (cell) {
    CELL_BY_ID[cell.id] = cell;
  });
  Object.freeze(CELL_BY_ID);

  function requireCell(cellId) {
    if (
      typeof cellId !== "string" ||
      !Object.prototype.hasOwnProperty.call(CELL_BY_ID, cellId)
    ) {
      throw new TypeError("Unknown Hive cell: " + String(cellId));
    }
    return CELL_BY_ID[cellId];
  }

  function createBlueprint(cellId) {
    var cell = requireCell(cellId);
    return deepFreeze({
      schema: SCHEMA,
      status: STATUS,
      liveIntegration: false,
      notice: NOTICE,
      cell: {
        id: cell.id,
        label: cell.label
      },
      problem: cell.problem,
      trigger: cell.trigger,
      allowedActions: cell.allowedActions.slice(),
      hardBoundary: cell.hardBoundary,
      dataConsentConcern: cell.dataConsentConcern,
      fallbackHumanHandoff: cell.fallbackHumanHandoff,
      killSwitch: cell.killSwitch
    });
  }

  function exportBlueprint(cellId) {
    return JSON.stringify(createBlueprint(cellId), null, 2) + "\n";
  }

  function rootsWithin(scope) {
    if (!scope) return [];
    if (
      typeof scope.matches === "function" &&
      scope.matches("[data-hive-planner]")
    ) {
      return [scope];
    }
    if (typeof scope.querySelectorAll !== "function") return [];
    return Array.prototype.slice.call(
      scope.querySelectorAll("[data-hive-planner]")
    );
  }

  function enhanceRoot(root) {
    if (
      typeof root.getAttribute === "function" &&
      root.getAttribute("data-hive-planner-ready") === "true"
    ) {
      return false;
    }

    var output = root.querySelector("[data-hive-output]");
    var controls = Array.prototype.slice.call(
      root.querySelectorAll("[data-hive-cell]")
    );
    var fields = {
      status: root.querySelector("[data-hive-status]"),
      live: root.querySelector("[data-hive-live]"),
      title: root.querySelector("[data-hive-title]"),
      problem: root.querySelector("[data-hive-problem]"),
      trigger: root.querySelector("[data-hive-trigger]"),
      boundary: root.querySelector("[data-hive-boundary]"),
      consent: root.querySelector("[data-hive-consent]"),
      handoff: root.querySelector("[data-hive-handoff]"),
      killSwitch: root.querySelector("[data-hive-kill-switch]"),
      pause: root.querySelector("[data-hive-pause]"),
      pauseStatus: root.querySelector("[data-hive-pause-status]"),
      download: root.querySelector("[data-hive-download]")
    };
    var actionFields = Array.prototype.slice.call(
      root.querySelectorAll("[data-hive-action]")
    );
    var validControls = [];
    var pausedCells = Object.create(null);

    controls.forEach(function (control) {
      var cellId = control.getAttribute("data-hive-cell");
      if (!Object.prototype.hasOwnProperty.call(CELL_BY_ID, cellId)) {
        control.setAttribute("aria-disabled", "true");
        return;
      }
      validControls.push(control);
    });

    var plannerReady = Boolean(
      output
      && validControls.length > 0
      && actionFields.length === 3
      && !Object.keys(fields).some(function (key) { return !fields[key]; })
    );
    if (!plannerReady) return false;

    validControls.forEach(function (control) {
      control.disabled = !plannerReady;
      control.removeAttribute("aria-disabled");
    });
    fields.pause.disabled = !plannerReady;
    fields.download.disabled = !plannerReady;

    function renderPause(cellId) {
      var paused = pausedCells[cellId] === true;
      root.setAttribute("data-hive-paused", String(paused));
      fields.pause.setAttribute("aria-pressed", String(paused));
      fields.pause.textContent = paused ? "Resume this cell" : "Pause this cell";
      fields.pauseStatus.textContent = paused
        ? "Cell paused. No next effect would be allowed until a person resumes it."
        : "This planning cell is open for inspection. Nothing is connected or running.";
    }

    function renderBlueprint(cellId) {
      var blueprint = createBlueprint(cellId);
      fields.status.textContent = "Planning blueprint · no live effects";
      fields.title.textContent = blueprint.cell.label;
      fields.problem.textContent = blueprint.problem;
      fields.trigger.textContent = blueprint.trigger;
      fields.boundary.textContent = blueprint.hardBoundary;
      fields.consent.textContent = blueprint.dataConsentConcern;
      fields.handoff.textContent = blueprint.fallbackHumanHandoff;
      fields.killSwitch.textContent = blueprint.killSwitch;
      actionFields.forEach(function (field, index) {
        field.textContent = blueprint.allowedActions[index];
      });
      renderPause(cellId);
    }

    function select(cellId) {
      requireCell(cellId);
      validControls.forEach(function (control) {
        var selected = control.getAttribute("data-hive-cell") === cellId;
        control.setAttribute("aria-pressed", String(selected));
        if (selected) control.setAttribute("data-hive-selected", "true");
        else control.removeAttribute("data-hive-selected");
      });
      root.setAttribute("data-hive-active", cellId);
      output.setAttribute("data-hive-output-cell", cellId);
      renderBlueprint(cellId);
      fields.live.textContent = createBlueprint(cellId).cell.label + " selected.";
    }

    validControls.forEach(function (control) {
      var cellId = control.getAttribute("data-hive-cell");
      control.setAttribute("aria-pressed", "false");
      control.addEventListener("click", function (event) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        select(cellId);
      });
    });

    fields.pause.addEventListener("click", function () {
      var cellId = root.getAttribute("data-hive-active");
      requireCell(cellId);
      pausedCells[cellId] = pausedCells[cellId] !== true;
      renderPause(cellId);
    });

    fields.download.addEventListener("click", function () {
      var cellId = root.getAttribute("data-hive-active");
      requireCell(cellId);
      if (
        !global.Blob
        || !global.URL
        || typeof global.URL.createObjectURL !== "function"
        || !global.document
        || typeof global.document.createElement !== "function"
      ) {
        fields.pauseStatus.textContent = "This browser could not prepare the local plan file.";
        return;
      }
      var file = new global.Blob([exportBlueprint(cellId)], { type: "application/json;charset=utf-8" });
      var objectUrl = global.URL.createObjectURL(file);
      var link = global.document.createElement("a");
      link.href = objectUrl;
      link.download = "hive-" + cellId + "-blueprint.json";
      link.hidden = true;
      global.document.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(function () { global.URL.revokeObjectURL(objectUrl); }, 1000);
      fields.pauseStatus.textContent = "Plan download prepared. No workflow was activated.";
    });

    var preferred = root.getAttribute("data-hive-active");
    if (global.location && typeof global.location.hash === "string") {
      var requestedByHash = global.location.hash.replace(/^#/u, "");
      if (Object.prototype.hasOwnProperty.call(CELL_BY_ID, requestedByHash)) {
        preferred = requestedByHash;
      }
    }
    if (!Object.prototype.hasOwnProperty.call(CELL_BY_ID, preferred)) {
      preferred = validControls[0].getAttribute("data-hive-cell");
    }
    select(preferred);
    root.setAttribute("data-hive-planner-ready", "true");
    return true;
  }

  function enhance(scope) {
    return rootsWithin(scope).reduce(function (count, root) {
      return count + (enhanceRoot(root) ? 1 : 0);
    }, 0);
  }

  var api = Object.freeze({
    schema: SCHEMA,
    status: STATUS,
    cells: CELLS,
    createBlueprint: createBlueprint,
    exportBlueprint: exportBlueprint,
    enhance: enhance
  });

  Object.defineProperty(global, "SiteSourceryHivePlanner", {
    value: api,
    enumerable: true,
    configurable: false,
    writable: false
  });

  var doc = global.document;
  if (doc && typeof doc.addEventListener === "function") {
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", function () {
        enhance(doc);
      }, { once: true });
    } else {
      enhance(doc);
    }
  }
})(typeof globalThis === "object" ? globalThis : this);
