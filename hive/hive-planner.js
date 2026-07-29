(function (global) {
  "use strict";

  if (!global || global.SiteSourceryHivePlanner) return;

  var SCHEMA = "sitesourcery.hive-blueprint.v1";
  var STATUS = "planning_only";
  var NOTICE = "Planning only. This file did not send a message, change a calendar or invoice, save customer data, or connect another tool.";
  var HISTORY_KEY = "siteSourceryHivePlanner";
  var HISTORY_VERSION = 1;

  function safeRevokeObjectUrl(environment, objectUrl) {
    if (
      !objectUrl
      || !environment
      || !environment.URL
      || typeof environment.URL.revokeObjectURL !== "function"
    ) return;
    try {
      environment.URL.revokeObjectURL(objectUrl);
    } catch (_error) {
      // The delivery outcome must stay truthful even when browser cleanup fails.
    }
  }

  function deliverLocalFile(environment, options) {
    var objectUrl = "";
    var link = null;
    var revokeScheduled = false;
    var delivered = false;
    var button = options && options.button;
    var status = options && options.status;

    if (button) button.disabled = true;
    try {
      if (
        !environment
        || typeof environment.Blob !== "function"
        || !environment.URL
        || typeof environment.URL.createObjectURL !== "function"
        || typeof environment.URL.revokeObjectURL !== "function"
        || !environment.document
        || !environment.document.body
        || typeof environment.document.body.appendChild !== "function"
        || typeof environment.document.createElement !== "function"
        || !options
        || !Array.isArray(options.parts)
      ) {
        throw new Error("Local file delivery is not supported.");
      }

      var file = new environment.Blob(options.parts, { type: options.type });
      objectUrl = environment.URL.createObjectURL(file);
      if (typeof objectUrl !== "string" || objectUrl.length === 0) {
        throw new Error("The browser did not create a local file address.");
      }

      link = environment.document.createElement("a");
      if (!link || typeof link.click !== "function") {
        throw new Error("The browser did not create a local file link.");
      }
      link.href = objectUrl;
      if (options.filename) link.download = options.filename;
      link.hidden = true;
      environment.document.body.appendChild(link);
      link.click();
      delivered = true;

      if (typeof environment.setTimeout === "function") {
        revokeScheduled = true;
        try {
          environment.setTimeout(function () {
            safeRevokeObjectUrl(environment, objectUrl);
          }, options.revokeDelay || 1000);
        } catch (_error) {
          revokeScheduled = false;
          safeRevokeObjectUrl(environment, objectUrl);
          objectUrl = "";
        }
      } else {
        safeRevokeObjectUrl(environment, objectUrl);
        objectUrl = "";
      }
    } catch (_error) {
      delivered = false;
    } finally {
      if (link) {
        try {
          if (typeof link.remove === "function") link.remove();
          else if (
            link.parentNode
            && typeof link.parentNode.removeChild === "function"
          ) link.parentNode.removeChild(link);
        } catch (_error) {
          // The object URL is still revoked below.
        }
      }
      if (objectUrl && !revokeScheduled) {
        safeRevokeObjectUrl(environment, objectUrl);
      }
      if (button) button.disabled = false;
    }

    if (status) {
      status.textContent = delivered
        ? options.successMessage
        : options.failureMessage;
    }
    return delivered;
  }

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
      customer: {
        result: "A missed call becomes a clear follow-up for your team, so the reason for calling is less likely to get lost.",
        when: "After a call is missed during the hours you choose.",
        human: "A team member takes over if the caller may need urgent help, the number is unclear, or permission to reply is missing.",
        permission: "Use only a contact route the caller gave or your business is allowed to use. Keep only the call details needed for follow-up.",
        limit: "It will not promise emergency help, guess why someone called, record a call, or contact an unapproved number.",
        pause: "A real pause would stop new replies before they are sent while keeping enough detail for your team to review the missed call."
      },
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
      customer: {
        result: "A customer gets the right booking questions, then a person or booking tool confirms the details.",
        when: "When a customer asks for help booking a service.",
        human: "A team member takes over for a conflict, special request, access need, or service choice that needs care.",
        permission: "Ask only for the contact, service, place, and time details needed for the booking request.",
        limit: "It will not invent an open time, change a calendar, take payment, or say a booking is confirmed without proof.",
        pause: "A real pause would stop new booking changes and show the customer how to call or email your team."
      },
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
      customer: {
        result: "An eligible customer gets one fair request for honest feedback after the job is complete.",
        when: "After the job is complete and the wait time you choose has passed.",
        human: "A team member takes over for a complaint, refund, unfinished job, or unclear permission to ask.",
        permission: "Ask only customers who may be contacted for this reason. Give them a clear way to stop more requests.",
        limit: "It will not make up a review, hide unhappy customers, pressure anyone, or ask for a certain rating.",
        pause: "A real pause would stop all waiting review requests before they are sent."
      },
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
      customer: {
        result: "A customer gets approved basic information and a clear way to reach a person.",
        when: "When a customer asks a basic question while your team is closed.",
        human: "A team member takes over for urgent words, private account questions, or anything without a checked answer.",
        permission: "Public questions should not need a name. Save contact or chat details only when there is a clear reason.",
        limit: "It will not give safety, medical, legal, or money advice, make up facts, or pretend a person is replying.",
        pause: "A real pause would stop automatic answers and show only your checked closed-hours message and contact details."
      },
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
      customer: {
        result: "A promised next step gets a due time and owner, so it is less likely to be forgotten.",
        when: "At the date and time set for a promised next step.",
        human: "A team member takes over for a complaint, private topic, old record, unclear person, or decision that needs judgment.",
        permission: "Keep the original reason for contact, the allowed contact method, and the person responsible for the next step.",
        limit: "It will not turn one request into marketing, keep contacting someone who said stop, or invent an old conversation.",
        pause: "A real pause would stop waiting follow-ups before they are sent while keeping the do-not-contact list."
      },
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
      customer: {
        result: "An overdue invoice gets a clear, respectful reminder and an easy path to ask about a problem.",
        when: "When the right invoice reaches a due or overdue date.",
        human: "A team member takes over for a dispute, hardship, part payment, refund, credit, wrong person, or unclear balance.",
        permission: "Use the right invoice, balance, and customer contact. Keep those details private and check for payments before sending.",
        limit: "It will not make or change an invoice, charge a card, add a fee, make a threat, or share debt with someone else.",
        pause: "A real pause would stop every waiting reminder before it is sent while keeping the payment and dispute record clear."
      },
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

  var PUBLIC_CELLS = deepFreeze(CELLS.map(function (cell) {
    return {
      id: cell.id,
      label: cell.label,
      customer: cell.customer
    };
  }));

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
        label: cell.label,
        customer: cell.customer
      }
    });
  }

  function exportBlueprint(cellId) {
    return JSON.stringify(createBlueprint(cellId), null, 2) + "\n";
  }

  function downloadBlueprint(cellId, environment, controls) {
    requireCell(cellId);
    var ui = controls || {};
    return deliverLocalFile(environment, {
      button: ui.button,
      failureMessage: ui.failureMessage
        || "The plan download could not start. Nothing was downloaded. Select Download again to retry.",
      filename: ui.filename || "hive-" + cellId + "-blueprint.json",
      parts: [exportBlueprint(cellId)],
      revokeDelay: 1000,
      status: ui.status,
      successMessage: ui.successMessage
        || "Plan download started. No workflow was activated.",
      type: "application/json;charset=utf-8"
    });
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
    var stages = Array.prototype.slice.call(
      root.querySelectorAll("[data-hive-stage]")
    );
    var indicators = Array.prototype.slice.call(
      root.querySelectorAll("[data-hive-step-indicator]")
    );
    var nextButtons = Array.prototype.slice.call(
      root.querySelectorAll("[data-hive-next]")
    );
    var fields = {
      start: root.querySelector("[data-hive-start]"),
      status: root.querySelector("[data-hive-status]"),
      live: root.querySelector("[data-hive-live]"),
      title: root.querySelector("[data-hive-title]"),
      result: root.querySelector("[data-hive-result]"),
      when: root.querySelector("[data-hive-when]"),
      human: root.querySelector("[data-hive-human]"),
      permission: root.querySelector("[data-hive-permission]"),
      limit: root.querySelector("[data-hive-limit]"),
      pauseCopy: root.querySelector("[data-hive-pause-copy]"),
      pause: root.querySelector("[data-hive-pause]"),
      pauseStatus: root.querySelector("[data-hive-pause-status]"),
      back: root.querySelector("[data-hive-back]"),
      download: root.querySelector("[data-hive-download]"),
      downloadStatus: root.querySelector("[data-hive-download-status]"),
      reviewLabel: root.querySelector("[data-hive-review-label]"),
      reviewResult: root.querySelector("[data-hive-review-result]"),
      reviewWhen: root.querySelector("[data-hive-review-when]"),
      reviewHuman: root.querySelector("[data-hive-review-human]"),
      reviewPermission: root.querySelector("[data-hive-review-permission]"),
      reviewLimit: root.querySelector("[data-hive-review-limit]"),
      reviewPause: root.querySelector("[data-hive-review-pause]")
    };
    var validControls = [];
    var stageByNumber = Object.create(null);
    var currentStage = 1;
    var activeCellId = null;
    var paused = false;
    var historyDepth = 0;
    var lastKnownHash = "";

    controls.forEach(function (control) {
      var cellId = control.getAttribute("data-hive-cell");
      if (!Object.prototype.hasOwnProperty.call(CELL_BY_ID, cellId)) {
        control.setAttribute("aria-disabled", "true");
        control.disabled = true;
        return;
      }
      validControls.push(control);
    });

    stages.forEach(function (stage) {
      var stageNumber = Number(stage.getAttribute("data-hive-stage"));
      if (
        Number.isInteger(stageNumber)
        && stageNumber >= 1
        && stageNumber <= 5
        && !stageByNumber[stageNumber]
      ) {
        stageByNumber[stageNumber] = stage;
      }
    });

    var plannerReady = Boolean(
      output
      && validControls.length === CELLS.length
      && Object.keys(stageByNumber).length === 5
      && indicators.length === 5
      && nextButtons.length === 3
      && !Object.keys(fields).some(function (key) { return !fields[key]; })
    );
    if (!plannerReady) return false;

    validControls.forEach(function (control, index) {
      control.disabled = !plannerReady;
      control.removeAttribute("aria-disabled");
      control.removeAttribute("aria-pressed");
      control.setAttribute("role", "radio");
      control.setAttribute("aria-checked", "false");
      control.setAttribute("tabindex", index === 0 ? "0" : "-1");
    });
    fields.pause.disabled = true;
    fields.back.disabled = true;
    fields.back.hidden = true;
    fields.download.disabled = true;
    fields.status.textContent = "Plan only · nothing is connected";

    function renderPause() {
      root.setAttribute("data-hive-paused", String(paused));
      fields.pause.setAttribute("aria-pressed", String(paused));
      fields.pause.textContent = paused ? "End pause demo" : "Try the pause";
      fields.pauseStatus.textContent = paused
        ? "Pause demo on. A real system would stop before its next action. Nothing is connected here."
        : "Demo only: nothing is connected or running.";
    }

    function renderCustomerPlan(cellId) {
      var cell = requireCell(cellId);
      var customer = cell.customer;
      fields.title.textContent = cell.label;
      fields.result.textContent = customer.result;
      fields.when.textContent = customer.when;
      fields.human.textContent = customer.human;
      fields.permission.textContent = customer.permission;
      fields.limit.textContent = customer.limit;
      fields.pauseCopy.textContent = customer.pause;
      fields.reviewLabel.textContent = cell.label;
      fields.reviewResult.textContent = customer.result;
      fields.reviewWhen.textContent = customer.when;
      fields.reviewHuman.textContent = customer.human;
      fields.reviewPermission.textContent = customer.permission;
      fields.reviewLimit.textContent = customer.limit;
      fields.reviewPause.textContent = customer.pause;
      fields.downloadStatus.textContent =
        "This plan stays in your browser until you download it.";
      renderPause();
    }

    function renderProgress() {
      indicators.forEach(function (indicator) {
        var step = Number(indicator.getAttribute("data-hive-step-indicator"));
        var state = step < currentStage
          ? "complete"
          : step === currentStage
            ? "current"
            : "locked";
        indicator.setAttribute("data-hive-step-state", state);
        if (state === "current") {
          indicator.setAttribute("aria-current", "step");
        } else {
          indicator.removeAttribute("aria-current");
        }
      });
    }

    function stageHeading() {
      var container = currentStage === 1
        ? fields.start
        : stageByNumber[currentStage];
      return container && container.querySelector(
        "[data-hive-stage-heading]"
      );
    }

    function renderStage(options) {
      var settings = options || {};
      var backLabels = {
        2: "← Back to choose",
        3: "← Back to result",
        4: "← Back to timing",
        5: "← Back to rules"
      };
      root.setAttribute("data-hive-stage-current", String(currentStage));
      stages.forEach(function (stage) {
        var stageNumber = Number(stage.getAttribute("data-hive-stage"));
        var visible = stageNumber === 1 || stageNumber === currentStage;
        stage.hidden = !visible;
        stage.inert = !visible;
        stage.setAttribute("aria-hidden", String(!visible));
      });
      fields.start.hidden = currentStage !== 1;
      fields.start.inert = currentStage !== 1;
      fields.start.setAttribute("aria-hidden", String(currentStage !== 1));
      fields.back.hidden = currentStage === 1;
      fields.back.disabled = currentStage === 1;
      fields.back.textContent = backLabels[currentStage] || "← Back";
      nextButtons.forEach(function (button) {
        var target = Number(button.getAttribute("data-hive-next"));
        button.disabled = !activeCellId || target !== currentStage + 1;
      });
      fields.pause.disabled = !activeCellId || currentStage !== 4;
      fields.download.disabled = !activeCellId || currentStage !== 5;
      renderProgress();
      if (settings.focus === true) {
        var heading = stageHeading();
        if (heading && typeof heading.focus === "function") heading.focus();
      }
      if (settings.announce === true) {
        fields.live.textContent = "Step " + currentStage + " of 5 is ready.";
      }
    }

    function plannerState(cellId, stage, pauseState, depth) {
      var envelope = {};
      envelope[HISTORY_KEY] = {
        version: HISTORY_VERSION,
        cellId: cellId || null,
        stage: stage,
        paused: pauseState === true,
        depth: depth
      };
      return envelope;
    }

    function stateDetails(state) {
      var details = state && state[HISTORY_KEY];
      if (
        !details
        || details.version !== HISTORY_VERSION
        || !Number.isInteger(details.stage)
        || details.stage < 1
        || details.stage > 5
        || !Number.isInteger(details.depth)
        || details.depth < 0
      ) return null;
      if (details.stage === 1) {
        return {
          cellId: null,
          stage: 1,
          paused: false,
          depth: details.depth
        };
      }
      if (!Object.prototype.hasOwnProperty.call(CELL_BY_ID, details.cellId)) {
        return null;
      }
      return {
        cellId: details.cellId,
        stage: details.stage,
        paused: details.paused === true,
        depth: details.depth
      };
    }

    function baseUrl() {
      if (!global.location) return "";
      return String(global.location.pathname || "")
        + String(global.location.search || "");
    }

    function urlForCell(cellId) {
      return baseUrl() + (cellId ? "#" + encodeURIComponent(cellId) : "");
    }

    function currentUrl() {
      return baseUrl() + (
        global.location && typeof global.location.hash === "string"
          ? global.location.hash
          : ""
      );
    }

    function hasHistory(method) {
      var methodName = method === "back" ? "back" : method + "State";
      return Boolean(
        global.history
        && typeof global.history[methodName] === "function"
        && global.location
      );
    }

    function writeHistory(method, details, url) {
      if (!hasHistory(method)) return false;
      try {
        global.history[method + "State"](
          plannerState(
            details.cellId,
            details.stage,
            details.paused,
            details.depth
          ),
          "",
          url
        );
        lastKnownHash = String(global.location.hash || "");
        return true;
      } catch (_error) {
        return false;
      }
    }

    function renderState(details, options) {
      var settings = options || {};
      currentStage = details.stage;
      historyDepth = details.depth;
      if (currentStage === 1) {
        activeCellId = null;
        paused = false;
        validControls.forEach(function (control, index) {
          control.setAttribute("aria-checked", "false");
          control.setAttribute("tabindex", index === 0 ? "0" : "-1");
          control.removeAttribute("data-hive-selected");
        });
        root.removeAttribute("data-hive-active");
        output.removeAttribute("data-hive-output-cell");
        renderPause();
        renderStage({ focus: settings.focus === true });
        fields.live.textContent = settings.announce === true
          ? "Step 1 of 5 is ready. Choose one business problem."
          : "Choose one business problem to begin.";
        return;
      }

      var cell = requireCell(details.cellId);
      activeCellId = cell.id;
      paused = details.paused === true;
      validControls.forEach(function (control) {
        var selected = control.getAttribute("data-hive-cell") === cell.id;
        control.setAttribute("aria-checked", String(selected));
        control.setAttribute("tabindex", selected ? "0" : "-1");
        if (selected) control.setAttribute("data-hive-selected", "true");
        else control.removeAttribute("data-hive-selected");
      });
      root.setAttribute("data-hive-active", cell.id);
      output.setAttribute("data-hive-output-cell", cell.id);
      renderCustomerPlan(cell.id);
      renderStage({
        focus: settings.focus === true,
        announce: settings.announce === true
      });
      if (settings.selectionAnnouncement === true) {
        fields.live.textContent =
          cell.label + " selected. Step 2 of 5 is ready.";
      }
    }

    function selectFromControl(cellId, options) {
      var settings = options || {};
      requireCell(cellId);
      if (
        currentStage !== 1
        && hasHistory("replace")
        && hasHistory("push")
      ) {
        writeHistory("replace", {
          cellId: null,
          stage: 1,
          paused: false,
          depth: 0
        }, urlForCell(null));
      }
      var details = {
        cellId: cellId,
        stage: 2,
        paused: false,
        depth: 1
      };
      renderState(details, {
        focus: settings.focusHeading === true,
        selectionAnnouncement: true
      });
      if (!writeHistory("push", details, urlForCell(cellId))) {
        historyDepth = 0;
      }
      if (settings.focusControl && typeof settings.focusControl.focus === "function") {
        settings.focusControl.focus();
      }
    }

    validControls.forEach(function (control, controlIndex) {
      var cellId = control.getAttribute("data-hive-cell");
      control.addEventListener("click", function (event) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        selectFromControl(cellId, { focusHeading: true });
      });
      control.addEventListener("keydown", function (event) {
        if (!event || typeof event.key !== "string") return;
        var targetIndex = controlIndex;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          targetIndex = (controlIndex + 1) % validControls.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          targetIndex =
            (controlIndex - 1 + validControls.length) % validControls.length;
        } else if (event.key === "Home") {
          targetIndex = 0;
        } else if (event.key === "End") {
          targetIndex = validControls.length - 1;
        } else {
          return;
        }
        if (typeof event.preventDefault === "function") event.preventDefault();
        var targetControl = validControls[targetIndex];
        selectFromControl(
          targetControl.getAttribute("data-hive-cell"),
          { focusControl: targetControl }
        );
      });
    });

    nextButtons.forEach(function (button) {
      var target = Number(button.getAttribute("data-hive-next"));
      button.addEventListener("click", function () {
        if (!activeCellId || target !== currentStage + 1) return;
        var details = {
          cellId: activeCellId,
          stage: target,
          paused: paused,
          depth: historyDepth + 1
        };
        renderState(details, { focus: true, announce: true });
        if (!writeHistory("push", details, urlForCell(activeCellId))) {
          historyDepth = 0;
        }
      });
    });

    fields.back.addEventListener("click", function () {
      if (currentStage === 1) return;
      if (historyDepth > 0 && hasHistory("back")) {
        try {
          global.history.back();
          return;
        } catch (_error) {
          // Fall back to an in-place stage change below.
        }
      }
      var target = currentStage - 1;
      var details = {
        cellId: target === 1 ? null : activeCellId,
        stage: target,
        paused: target === 1 ? false : paused,
        depth: Math.max(0, historyDepth - 1)
      };
      renderState(details, { focus: true, announce: true });
      writeHistory(
        "replace",
        details,
        target === 1 ? urlForCell(null) : urlForCell(activeCellId)
      );
    });

    fields.pause.addEventListener("click", function () {
      if (!activeCellId || currentStage !== 4) return;
      paused = !paused;
      renderPause();
      writeHistory("replace", {
        cellId: activeCellId,
        stage: currentStage,
        paused: paused,
        depth: historyDepth
      }, urlForCell(activeCellId));
      fields.live.textContent = paused
        ? "Pause demo on. Nothing is connected."
        : "Pause demo ended. Nothing is connected.";
    });

    fields.download.addEventListener("click", function () {
      var cellId = root.getAttribute("data-hive-active");
      if (!cellId || currentStage !== 5) return;
      downloadBlueprint(cellId, global, {
        button: fields.download,
        filename: "hive-" + cellId + "-plan.json",
        status: fields.downloadStatus,
        successMessage: "Your plan file is ready. Nothing was sent or connected."
      });
    });

    function cellFromHash() {
      if (!global.location || typeof global.location.hash !== "string") {
        return null;
      }
      var requested = global.location.hash.replace(/^#/u, "");
      try {
        requested = decodeURIComponent(requested);
      } catch (_error) {
        return null;
      }
      return Object.prototype.hasOwnProperty.call(CELL_BY_ID, requested)
        ? requested
        : null;
    }

    var preferred = cellFromHash();
    if (preferred && hasHistory("replace") && hasHistory("push")) {
      var startDetails = {
        cellId: null,
        stage: 1,
        paused: false,
        depth: 0
      };
      writeHistory("replace", startDetails, urlForCell(null));
      var preferredDetails = {
        cellId: preferred,
        stage: 2,
        paused: false,
        depth: 1
      };
      renderState(preferredDetails);
      if (!writeHistory("push", preferredDetails, urlForCell(preferred))) {
        historyDepth = 0;
      }
    } else if (preferred) {
      renderState({
        cellId: preferred,
        stage: 2,
        paused: false,
        depth: 0
      });
      lastKnownHash = String(global.location && global.location.hash || "");
    } else {
      var initialDetails = {
        cellId: null,
        stage: 1,
        paused: false,
        depth: 0
      };
      renderState(initialDetails);
      writeHistory("replace", initialDetails, currentUrl());
      lastKnownHash = String(global.location && global.location.hash || "");
    }

    if (typeof global.addEventListener === "function") {
      global.addEventListener("popstate", function (event) {
        var details = stateDetails(event && event.state);
        if (!details) {
          var requested = cellFromHash();
          details = requested
            ? {
                cellId: requested,
                stage: 2,
                paused: false,
                depth: 1
              }
            : {
                cellId: null,
                stage: 1,
                paused: false,
                depth: 0
              };
        }
        lastKnownHash = String(global.location && global.location.hash || "");
        renderState(details, { focus: true, announce: true });
        if (typeof global.setTimeout === "function") {
          var expectedStage = details.stage;
          global.setTimeout(function () {
            if (currentStage !== expectedStage) return;
            var heading = stageHeading();
            if (heading && typeof heading.focus === "function") heading.focus();
          }, 0);
        }
      });
      global.addEventListener("hashchange", function () {
        var hash = String(global.location && global.location.hash || "");
        if (hash === lastKnownHash) return;
        var requested = cellFromHash();
        var details = requested
          ? {
              cellId: requested,
              stage: 2,
              paused: false,
              depth: Math.max(1, historyDepth + 1)
            }
          : {
              cellId: null,
              stage: 1,
              paused: false,
              depth: 0
            };
        renderState(details, {
          focus: true,
          selectionAnnouncement: Boolean(requested)
        });
        writeHistory("replace", details, currentUrl());
      });
    }

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
    cells: PUBLIC_CELLS,
    createBlueprint: createBlueprint,
    deliverLocalFile: deliverLocalFile,
    downloadBlueprint: downloadBlueprint,
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
