(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAlakazam50 = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var SNAPSHOT_SCHEMA = "sitesourcery.alakazam-50-snapshot/v1";
  var CONFIGURATION_SCHEMA = "sitesourcery.alakazam-50-configuration/v1";
  var HOLD_REASON = "commercial_cutover_not_authorized";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[a-f0-9]{64}$/u;
  var HANDLE = /^[A-Za-z0-9_.-]{1,30}$/u;
  var TARGETS = Object.freeze(["about", "offerings", "practical", "contact"]);
  var DEFAULT_LABELS = Object.freeze({
    about: "About",
    offerings: "Offerings",
    practical: "Details",
    contact: "Contact"
  });

  function record(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function exactKeys(value, expected) {
    return record(value) && JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(expected.slice().sort());
  }

  function exactIso(value) {
    var parsed = typeof value === "string" ? new Date(value) : null;
    return Boolean(
      parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    );
  }

  function verifiedMenu(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
    var seen = new Set();
    var selected = [];
    for (var index = 0; index < value.length; index += 1) {
      var item = value[index];
      if (!exactKeys(item, ["label", "target"])
        || !TARGETS.includes(item.target)
        || seen.has(item.target)
        || typeof item.label !== "string"
        || item.label !== item.label.trim()
        || item.label.length < 1
        || item.label.length > 32) return false;
      seen.add(item.target);
      selected.push(Object.freeze({ target: item.target, label: item.label }));
    }
    return Object.freeze(selected);
  }

  function verifiedConfiguration(value) {
    if (value === null) return null;
    if (!exactKeys(value, [
      "borderChoiceId", "cashAppHandle", "commandId", "configurationDigest",
      "configurationRevision", "configuredAt", "fontChoiceId", "holdReason",
      "menu", "projectId", "schema", "state", "subscriptionId",
      "subscriptionRevision", "venmoHandle"
    ])
      || value.schema !== CONFIGURATION_SCHEMA
      || !UUID.test(value.commandId)
      || !UUID.test(value.projectId)
      || !UUID.test(value.subscriptionId)
      || !Number.isSafeInteger(value.subscriptionRevision)
      || value.subscriptionRevision < 1
      || !Number.isSafeInteger(value.configurationRevision)
      || value.configurationRevision < 1
      || !["inherit", "editorial", "studio"].includes(value.fontChoiceId)
      || !["soft", "sharp", "ornate"].includes(value.borderChoiceId)
      || (value.cashAppHandle !== null && !HANDLE.test(value.cashAppHandle))
      || (value.venmoHandle !== null && !HANDLE.test(value.venmoHandle))
      || !DIGEST.test(value.configurationDigest)
      || value.state !== "held"
      || value.holdReason !== HOLD_REASON
      || !exactIso(value.configuredAt)) return false;
    var menu = verifiedMenu(value.menu);
    if (!menu) return false;
    return Object.freeze({
      configurationRevision: value.configurationRevision,
      cashAppHandle: value.cashAppHandle,
      venmoHandle: value.venmoHandle,
      fontChoiceId: value.fontChoiceId,
      borderChoiceId: value.borderChoiceId,
      menu: menu
    });
  }

  function verifiedChoices(value, id, expected) {
    if (!Array.isArray(value) || value.length !== expected.length) return false;
    if (!value.every(function (entry, index) {
      return exactKeys(entry, [id, "label"])
        && entry[id] === expected[index]
        && typeof entry.label === "string"
        && entry.label.length > 0;
    })) return false;
    return Object.freeze(value.map(function (entry) {
      return Object.freeze(Object.assign({}, entry));
    }));
  }

  function verifiedSnapshot(value, projectId) {
    if (!record(value)
      || value.schema !== SNAPSHOT_SCHEMA
      || value.state !== "held"
      || value.providerEffects !== false
      || value.holdReason !== HOLD_REASON
      || value.projectId !== projectId
      || !record(value.subscription)
      || value.subscription.tierId !== "alakazam_50"
      || !["active", "grace"].includes(value.subscription.status)
      || !Number.isSafeInteger(value.subscription.revision)
      || value.subscription.revision < 1
      || !record(value.controls)
      || value.controls.cashApp !== true
      || value.controls.venmo !== true
      || JSON.stringify(value.controls.menuTargets) !== JSON.stringify(TARGETS)
      || value.controls.careClass !== "more"
      || !record(value.care)
      || value.care.state !== "held"
      || !Number.isSafeInteger(value.care.requestCount)
      || value.care.requestCount < 0) return false;
    var fonts = verifiedChoices(
      value.controls.fonts,
      "fontChoiceId",
      ["inherit", "editorial", "studio"]
    );
    var borders = verifiedChoices(
      value.controls.borders,
      "borderChoiceId",
      ["soft", "sharp", "ornate"]
    );
    var configuration = verifiedConfiguration(value.configuration);
    if (!fonts || !borders || configuration === false) return false;
    if (value.care.lastRequestedAt !== null && !exactIso(value.care.lastRequestedAt)) {
      return false;
    }
    return Object.freeze({
      projectId: value.projectId,
      subscription: Object.freeze(Object.assign({}, value.subscription)),
      controls: Object.freeze({ fonts: fonts, borders: borders }),
      configuration: configuration,
      care: Object.freeze({
        requestCount: value.care.requestCount,
        lastRequestedAt: value.care.lastRequestedAt
      })
    });
  }

  function commandId(cryptoObject) {
    var value = cryptoObject && typeof cryptoObject.randomUUID === "function"
      ? cryptoObject.randomUUID()
      : "";
    if (!UUID.test(value)) throw new Error("This browser cannot safely identify the Alakazam command.");
    return value;
  }

  function createClient(options) {
    options = options || {};
    var fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(root) : null);
    var apiBase = String(options.apiBase || "/api/v1").replace(/\/$/u, "");
    var csrfToken = "";
    if (typeof fetchImpl !== "function") throw new Error("Fetch is required.");

    async function request(method, path, body, idempotencyKey) {
      if (method !== "GET" && !csrfToken) {
        var csrfResponse = await request("GET", "/csrf", null, "");
        csrfToken = String(csrfResponse.csrfToken || "");
        if (!csrfToken) throw new Error("The write-safety token is unavailable.");
      }
      var headers = { Accept: "application/json" };
      if (body !== null) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      var response = await fetchImpl(apiBase + path, {
        method: method,
        credentials: "same-origin",
        headers: headers,
        body: body === null ? undefined : JSON.stringify(body)
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        if (payload.code === "CSRF_TOKEN_REQUIRED") csrfToken = "";
        throw new Error(payload.message || "Alakazam controls could not complete the request.");
      }
      return payload;
    }

    function projectPath(projectId) {
      if (!UUID.test(projectId)) throw new Error("The Alakazam project is invalid.");
      return "/projects/" + encodeURIComponent(projectId) + "/alakazam/50";
    }

    return Object.freeze({
      getSnapshot: function (projectId) {
        return request("GET", projectPath(projectId), null, "");
      },
      saveConfiguration: function (projectId, input) {
        return request("POST", projectPath(projectId) + "/configurations", {
          expectedCurrentRevision: input.expectedCurrentRevision,
          cashAppHandle: input.cashAppHandle,
          venmoHandle: input.venmoHandle,
          fontChoiceId: input.fontChoiceId,
          borderChoiceId: input.borderChoiceId,
          menu: input.menu
        }, input.commandId);
      },
      requestCare: function (projectId, input) {
        return request("POST", projectPath(projectId) + "/care-requests", {
          message: input.message
        }, input.commandId);
      }
    });
  }

  function element(documentRef, name, className, text) {
    var selected = documentRef.createElement(name);
    if (className) selected.className = className;
    if (text) selected.textContent = text;
    return selected;
  }

  function mount(options) {
    options = options || {};
    var documentRef = options.documentRef || document;
    var container = options.container;
    var projectId = options.projectId;
    var client = options.client || createClient(options);
    var cryptoObject = options.cryptoObject || root.crypto;
    if (!container || typeof container.append !== "function" || !UUID.test(projectId)) {
      throw new Error("The Alakazam $50 panel mount is invalid.");
    }
    var panel = element(documentRef, "section", "alakazam-50-panel");
    panel.setAttribute("data-alakazam-50", "");
    panel.setAttribute("aria-labelledby", "alakazam-50-title");
    var eyebrow = element(documentRef, "p", "alakazam-50-eyebrow", "$50 tier fulfillment");
    var heading = element(documentRef, "h4", "", "Payments, menu, extended style & more care");
    heading.id = "alakazam-50-title";
    var hold = element(documentRef, "p", "alakazam-50-hold",
      "Built and account-bound, but commercially held. Choices become immutable evidence; no Stripe, publication, or provider effect is available here.");
    var status = element(documentRef, "p", "alakazam-50-status", "Loading $50 controls…");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var controls = element(documentRef, "div", "alakazam-50-controls");
    panel.append(eyebrow, heading, hold, status, controls);
    container.append(panel);
    var snapshot = null;
    var busy = false;

    function setStatus(message, error) {
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(error));
    }

    function button(label, action, className) {
      var selected = element(documentRef, "button", "spark-button " + (className || ""), label);
      selected.type = "button";
      selected.addEventListener("click", action);
      return selected;
    }

    function execute(label, work) {
      if (busy) return;
      busy = true;
      panel.setAttribute("aria-busy", "true");
      setStatus(label, false);
      Promise.resolve().then(work).then(function (value) {
        var verified = verifiedSnapshot(value, projectId);
        if (!verified) throw new Error("The Alakazam $50 response could not be verified.");
        snapshot = verified;
        setStatus("Saved as held account evidence. No provider effect ran.", false);
        render();
      }).catch(function (error) {
        setStatus(error.message || "The held control could not be saved.", true);
      }).finally(function () {
        busy = false;
        panel.setAttribute("aria-busy", "false");
      });
    }

    function labelInput(label, className) {
      var wrapper = element(documentRef, "label", "alakazam-50-label", label);
      var input = element(documentRef, "input", className || "alakazam-50-input");
      input.type = "text";
      wrapper.append(input);
      return { wrapper: wrapper, input: input };
    }

    function choice(label, values, id, selectedValue) {
      var wrapper = element(documentRef, "label", "alakazam-50-label", label);
      var select = element(documentRef, "select", "alakazam-50-select");
      values.forEach(function (value) {
        var option = element(documentRef, "option", "", value.label);
        option.value = value[id];
        select.append(option);
      });
      select.value = selectedValue;
      wrapper.append(select);
      return { wrapper: wrapper, select: select };
    }

    function render() {
      controls.replaceChildren();
      if (!snapshot) return;
      var configured = snapshot.configuration;
      var paymentBlock = element(documentRef, "section", "alakazam-50-block");
      paymentBlock.append(element(documentRef, "h5", "", "Payment links"));
      paymentBlock.append(element(documentRef, "p", "alakazam-50-help",
        "Bare Cash App and Venmo handles only. Links render from server-authorized $50 evidence."));
      var cash = labelInput("Cash App handle");
      var venmo = labelInput("Venmo handle");
      cash.input.maxLength = 30;
      venmo.input.maxLength = 30;
      cash.input.value = configured && configured.cashAppHandle || "";
      venmo.input.value = configured && configured.venmoHandle || "";
      paymentBlock.append(cash.wrapper, venmo.wrapper);

      var styleBlock = element(documentRef, "section", "alakazam-50-block");
      styleBlock.append(element(documentRef, "h5", "", "Extended style"));
      var font = choice("Font", snapshot.controls.fonts, "fontChoiceId",
        configured ? configured.fontChoiceId : "inherit");
      var border = choice("Borders", snapshot.controls.borders, "borderChoiceId",
        configured ? configured.borderChoiceId : "soft");
      styleBlock.append(font.wrapper, border.wrapper);

      var menuBlock = element(documentRef, "section", "alakazam-50-block alakazam-50-menu-block");
      menuBlock.append(element(documentRef, "h5", "", "Configurable menu"));
      menuBlock.append(element(documentRef, "p", "alakazam-50-help",
        "Choose visible destinations, labels, and exact order. Hidden $35 sections cannot be linked at fulfillment."));
      var configuredMenu = configured ? configured.menu : TARGETS.map(function (target) {
        return { target: target, label: DEFAULT_LABELS[target] };
      });
      var menuRows = {};
      TARGETS.forEach(function (target) {
        var existingIndex = configuredMenu.findIndex(function (item) {
          return item.target === target;
        });
        var row = element(documentRef, "div", "alakazam-50-menu-row");
        var enabledLabel = element(documentRef, "label", "alakazam-50-check");
        var enabled = element(documentRef, "input");
        enabled.type = "checkbox";
        enabled.checked = existingIndex >= 0;
        enabledLabel.append(enabled, documentRef.createTextNode(DEFAULT_LABELS[target]));
        var menuLabel = labelInput("Menu label", "alakazam-50-input");
        menuLabel.input.maxLength = 32;
        menuLabel.input.value = existingIndex >= 0
          ? configuredMenu[existingIndex].label
          : DEFAULT_LABELS[target];
        var orderLabel = element(documentRef, "label", "alakazam-50-label", "Order");
        var order = element(documentRef, "select", "alakazam-50-select");
        for (var position = 1; position <= 4; position += 1) {
          var orderOption = element(documentRef, "option", "", String(position));
          orderOption.value = String(position);
          order.append(orderOption);
        }
        order.value = String(existingIndex >= 0 ? existingIndex + 1 : TARGETS.indexOf(target) + 1);
        orderLabel.append(order);
        row.append(enabledLabel, menuLabel.wrapper, orderLabel);
        menuRows[target] = { enabled: enabled, label: menuLabel.input, order: order };
        menuBlock.append(row);
      });
      var save = button("Save held $50 choices", function () {
        var menu = TARGETS.filter(function (target) {
          return menuRows[target].enabled.checked;
        }).map(function (target) {
          return {
            target: target,
            label: menuRows[target].label.value.trim(),
            order: Number(menuRows[target].order.value)
          };
        }).sort(function (left, right) {
          return left.order - right.order || TARGETS.indexOf(left.target) - TARGETS.indexOf(right.target);
        }).map(function (item) {
          return { target: item.target, label: item.label };
        });
        if (menu.length === 0 || menu.some(function (item) { return !item.label; })) {
          setStatus("Choose at least one labeled menu destination.", true);
          return;
        }
        execute("Recording exact $50 choices…", function () {
          return client.saveConfiguration(projectId, {
            commandId: commandId(cryptoObject),
            expectedCurrentRevision: configured ? configured.configurationRevision : 0,
            cashAppHandle: cash.input.value.trim() || null,
            venmoHandle: venmo.input.value.trim() || null,
            fontChoiceId: font.select.value,
            borderChoiceId: border.select.value,
            menu: menu
          });
        });
      }, "spark-button-primary");
      menuBlock.append(save);

      var careBlock = element(documentRef, "section", "alakazam-50-block");
      careBlock.append(element(documentRef, "h5", "", "More care"));
      careBlock.append(element(documentRef, "p", "alakazam-50-help",
        "Accounted requests: " + snapshot.care.requestCount + ". “More” defines the tier class only—no response time, edit count, or provider action is promised while held."));
      var careLabel = element(documentRef, "label", "alakazam-50-label", "Care request");
      var message = element(documentRef, "textarea", "alakazam-50-care");
      message.maxLength = 1000;
      message.rows = 4;
      careLabel.append(message);
      var request = button("Record held more-care request", function () {
        var selected = message.value.trim();
        if (!selected) {
          setStatus("Describe the requested help before recording it.", true);
          return;
        }
        execute("Accounting for the held care request…", function () {
          return client.requestCare(projectId, {
            commandId: commandId(cryptoObject),
            message: selected
          });
        });
      });
      careBlock.append(careLabel, request);
      controls.append(paymentBlock, styleBlock, menuBlock, careBlock);
    }

    function load() {
      setStatus("Loading $50 controls…", false);
      return client.getSnapshot(projectId).then(function (value) {
        var verified = verifiedSnapshot(value, projectId);
        if (!verified) throw new Error("The Alakazam $50 response could not be verified.");
        snapshot = verified;
        setStatus("Held controls ready. No provider effects are available.", false);
        render();
        return verified;
      }).catch(function (error) {
        setStatus(error.message || "The held controls could not load.", true);
        throw error;
      });
    }

    load();
    return Object.freeze({
      element: panel,
      load: load,
      destroy: function () { panel.remove(); },
      snapshot: function () { return snapshot; }
    });
  }

  return Object.freeze({
    holdReason: HOLD_REASON,
    snapshotSchema: SNAPSHOT_SCHEMA,
    createClient: createClient,
    mount: mount,
    verifiedSnapshot: verifiedSnapshot
  });
}));
