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
        result: "A missed call becomes a follow-up with a clear owner.",
        when: "A call is missed during the hours you name.",
        human: "A person steps in for urgency, uncertainty, or missing permission.",
        permission: "Use only the contact route the caller gave you.",
        limit: "No guessed intent, emergency promise, recording, or unapproved contact.",
        pause: "Stop every new reply before it leaves."
      }
    },
    {
      id: "booking",
      label: "Booking guide",
      customer: {
        result: "The right questions are gathered before anyone confirms a time.",
        when: "A customer asks to book a service.",
        human: "A person steps in for conflicts, access needs, or special requests.",
        permission: "Ask only for the details needed to request the booking.",
        limit: "No invented opening, calendar change, payment, or false confirmation.",
        pause: "Stop booking changes and show your phone and email."
      }
    },
    {
      id: "review-request",
      label: "Review request",
      customer: {
        result: "One fair request goes out after finished work, with an easy stop.",
        when: "The work is complete and the agreed wait has passed.",
        human: "A person steps in for complaints, refunds, or unfinished work.",
        permission: "Ask only customers who may be contacted for this reason.",
        limit: "No made-up review, pressure, hidden complaint, or requested rating.",
        pause: "Stop every waiting review request before it leaves."
      }
    },
    {
      id: "after-hours",
      label: "After-hours information",
      customer: {
        result: "Basic questions get a checked answer or a clear path to a person.",
        when: "A basic question arrives while your team is closed.",
        human: "A person steps in for urgency, private details, or an unchecked answer.",
        permission: "Do not ask for a name when a public answer is enough.",
        limit: "No sensitive advice, made-up fact, or claim that a person replied.",
        pause: "Show only your checked closed-hours note and contact details."
      }
    },
    {
      id: "follow-up",
      label: "Follow-up",
      customer: {
        result: "A promised next step gets a due time and a clear owner.",
        when: "The promised date and time arrive.",
        human: "A person steps in for complaints, private topics, or unclear records.",
        permission: "Keep the reason, allowed contact method, and responsible person.",
        limit: "No new marketing, contact after a stop, or invented conversation.",
        pause: "Stop every waiting follow-up before it leaves."
      }
    },
    {
      id: "getting-paid",
      label: "Getting-paid reminder",
      customer: {
        result: "An overdue invoice gets a respectful reminder and a way to question it.",
        when: "The right invoice reaches its due or overdue date.",
        human: "A person steps in for a dispute, hardship, credit, or unclear balance.",
        permission: "Check the invoice, balance, payment, and correct contact first.",
        limit: "No changed invoice, card charge, fee, threat, or shared debt.",
        pause: "Stop every waiting reminder before it leaves."
      }
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
    fields.status.textContent = "Conversation only · nothing starts here";

    function renderPause() {
      root.setAttribute("data-hive-paused", String(paused));
      fields.pause.setAttribute("aria-pressed", String(paused));
      fields.pause.textContent = paused
        ? "Unmark this stop note"
        : "Mark this stop note";
      fields.pauseStatus.textContent = paused
        ? "Marked for the conversation. This page still does nothing outside your browser."
        : "Local note only. No task is running.";
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
        "These notes stay in your browser unless you download them.";
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
        3: "← Back to outcome",
        4: "← Back to handoff",
        5: "← Back to boundaries"
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
          ? "Step 1 of 5 is ready. Choose one stuck moment."
          : "Choose one stuck moment to begin.";
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
        ? "Stop note marked for the conversation."
        : "Stop note unmarked.";
    });

    fields.download.addEventListener("click", function () {
      var cellId = root.getAttribute("data-hive-active");
      if (!cellId || currentStage !== 5) return;
      downloadBlueprint(cellId, global, {
        button: fields.download,
        filename: "hive-" + cellId + "-conversation-notes.json",
        status: fields.downloadStatus,
        successMessage: "Conversation notes downloaded. Nothing was sent or started."
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
