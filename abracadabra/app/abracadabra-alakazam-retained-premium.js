(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAlakazamRetainedPremium = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  var SNAPSHOT_SCHEMA =
    "sitesourcery.alakazam-retained-premium-snapshot/v1";
  var EXPORT_SCHEMA =
    "sitesourcery.alakazam-retained-premium-export/v1";
  var POLICY_ID = "SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1";
  var HOLD_REASON = "commercial_cutover_not_authorized";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[a-f0-9]{64}$/u;

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
      parsed && Number.isFinite(parsed.getTime()) &&
      parsed.toISOString() === value
    );
  }

  function verifiedValues(value) {
    if (value === null) return null;
    if (!exactKeys(value, [
      "borderChoiceId", "cashAppHandle", "configurationDigest",
      "configurationRevision", "configuredAt", "fontChoiceId",
      "menu", "venmoHandle"
    ])
      || !Number.isSafeInteger(value.configurationRevision)
      || value.configurationRevision < 1
      || !DIGEST.test(value.configurationDigest)
      || !exactIso(value.configuredAt)
      || !Array.isArray(value.menu)
      || value.menu.length < 1
      || value.menu.length > 4) return false;
    if (!value.menu.every(function (entry) {
      return exactKeys(entry, ["label", "target"])
        && typeof entry.label === "string"
        && entry.label === entry.label.trim()
        && entry.label.length > 0
        && entry.label.length <= 32
        && ["about", "offerings", "practical", "contact"].includes(entry.target);
    })) return false;
    return Object.freeze({
      configurationRevision: value.configurationRevision,
      configurationDigest: value.configurationDigest,
      cashAppHandle: value.cashAppHandle,
      venmoHandle: value.venmoHandle,
      fontChoiceId: value.fontChoiceId,
      borderChoiceId: value.borderChoiceId,
      menu: Object.freeze(value.menu.map(function (entry) {
        return Object.freeze({ target: entry.target, label: entry.label });
      })),
      configuredAt: value.configuredAt
    });
  }

  function verifiedSnapshot(value, projectId) {
    if (!exactKeys(value, [
      "actions", "holdReason", "lifecycle", "policyId", "premium",
      "projectId", "providerEffects", "restoration", "schema", "state",
      "subscription"
    ])
      || value.schema !== SNAPSHOT_SCHEMA
      || value.policyId !== POLICY_ID
      || value.state !== "held"
      || value.providerEffects !== false
      || value.holdReason !== HOLD_REASON
      || value.projectId !== projectId
      || !exactKeys(value.lifecycle, [
        "care", "customerExport", "edit", "privateRead", "publish",
        "retentionEndsAt", "state"
      ])
      || !["active", "scheduled_to_cancel_active", "payment_grace",
        "retained_exit", "purged"].includes(value.lifecycle.state)
      || !exactKeys(value.subscription, [
        "cancelAtPeriodEnd", "revision", "status", "tierId"
      ])
      || !["alakazam_25", "alakazam_35", "alakazam_50"].includes(
        value.subscription.tierId
      )
      || !["active", "grace", "suspended", "cancelled", "ended"].includes(
        value.subscription.status
      )
      || !Number.isSafeInteger(value.subscription.revision)
      || value.subscription.revision < 1
      || typeof value.subscription.cancelAtPeriodEnd !== "boolean"
      || !exactKeys(value.premium, [
        "configurationDigest", "configurationRevision", "configured",
        "effectiveOutput", "values"
      ])
      || typeof value.premium.configured !== "boolean"
      || !["available", "masked"].includes(value.premium.effectiveOutput)
      || !exactKeys(value.restoration, [
        "available", "required", "sourceConfigurationDigest",
        "sourceConfigurationRevision"
      ])
      || !exactKeys(value.actions, [
        "care", "edit", "export", "publish", "restore"
      ])
      || !["privateRead", "customerExport", "edit", "publish", "care"].every(
        function (key) { return typeof value.lifecycle[key] === "boolean"; }
      )
      || !["edit", "restore", "export", "publish", "care"].every(
        function (key) { return typeof value.actions[key] === "boolean"; }
      )) return false;
    var values = verifiedValues(value.premium.values);
    if (values === false) return false;
    var lowerTier = value.subscription.tierId !== "alakazam_50";
    var readOnly = ["payment_grace", "retained_exit"].includes(
      value.lifecycle.state
    );
    if ((value.premium.configured &&
        (!Number.isSafeInteger(value.premium.configurationRevision)
          || value.premium.configurationRevision < 1
          || !DIGEST.test(value.premium.configurationDigest)))
      || (!value.premium.configured &&
        (value.premium.configurationRevision !== null
          || value.premium.configurationDigest !== null
          || values !== null))
      || (lowerTier && value.lifecycle.state !== "retained_exit"
        && values !== null)
      || (value.premium.effectiveOutput === "available" && values === null)
      || (readOnly && (value.actions.edit || value.actions.restore
        || value.actions.publish || value.actions.care))
      || (value.restoration.available && !value.restoration.required)
      || (value.restoration.required
        && (!DIGEST.test(value.restoration.sourceConfigurationDigest)
          || !Number.isSafeInteger(
            value.restoration.sourceConfigurationRevision
          )))) return false;
    return Object.freeze({
      projectId: value.projectId,
      lifecycle: Object.freeze(Object.assign({}, value.lifecycle)),
      subscription: Object.freeze(Object.assign({}, value.subscription)),
      premium: Object.freeze({
        configured: value.premium.configured,
        configurationRevision: value.premium.configurationRevision,
        configurationDigest: value.premium.configurationDigest,
        effectiveOutput: value.premium.effectiveOutput,
        values: values
      }),
      restoration: Object.freeze(Object.assign({}, value.restoration)),
      actions: Object.freeze(Object.assign({}, value.actions))
    });
  }

  function commandId(cryptoObject) {
    var value = cryptoObject && typeof cryptoObject.randomUUID === "function"
      ? cryptoObject.randomUUID()
      : "";
    if (!UUID.test(value)) {
      throw new Error("This browser cannot safely identify the restoration command.");
    }
    return value;
  }

  function createClient(options) {
    options = options || {};
    var fetchImpl = options.fetchImpl ||
      (typeof fetch === "function" ? fetch.bind(root) : null);
    var apiBase = String(options.apiBase || "/api/v1").replace(/\/$/u, "");
    var csrfToken = "";
    if (typeof fetchImpl !== "function") throw new Error("Fetch is required.");

    async function request(method, path, body, idempotencyKey) {
      if (method !== "GET" && !csrfToken) {
        var csrf = await request("GET", "/csrf", null, "");
        csrfToken = String(csrf.csrfToken || "");
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
        throw new Error(
          payload.message || "Retained premium controls could not complete the request."
        );
      }
      return payload;
    }

    function projectPath(projectId) {
      if (!UUID.test(projectId)) throw new Error("The Alakazam project is invalid.");
      return "/projects/" + encodeURIComponent(projectId) +
        "/alakazam/premium";
    }

    return Object.freeze({
      getSnapshot: function (projectId) {
        return request("GET", projectPath(projectId), null, "");
      },
      getExport: function (projectId) {
        return request("GET", projectPath(projectId) + "/export", null, "");
      },
      restoreConfiguration: function (projectId, input) {
        return request("POST", projectPath(projectId) + "/restorations", {
          expectedSourceConfigurationDigest:
            input.expectedSourceConfigurationDigest,
          expectedSubscriptionRevision: input.expectedSubscriptionRevision
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
    var onExport = typeof options.onExport === "function"
      ? options.onExport
      : function () {};
    if (!container || typeof container.append !== "function"
      || !UUID.test(projectId)) {
      throw new Error("The retained premium panel mount is invalid.");
    }
    var panel = element(documentRef, "section", "alakazam-premium-panel");
    panel.setAttribute("data-alakazam-retained-premium", "");
    var titleId = "alakazam-premium-" + projectId;
    panel.setAttribute("aria-labelledby", titleId);
    var eyebrow = element(
      documentRef,
      "p",
      "alakazam-premium-eyebrow",
      "Retained premium configuration"
    );
    var heading = element(
      documentRef,
      "h4",
      "",
      "Your $50 choices stay yours"
    );
    heading.id = titleId;
    var hold = element(
      documentRef,
      "p",
      "alakazam-premium-hold",
      "Commercial release remains held. These controls never publish, bill, contact Stripe, request care, or run a provider effect."
    );
    var status = element(
      documentRef,
      "p",
      "alakazam-premium-status",
      "Loading retained premium state…"
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var body = element(documentRef, "div", "alakazam-premium-body");
    panel.append(eyebrow, heading, hold, status, body);
    container.append(panel);
    var snapshot = null;
    var busy = false;

    function setStatus(message, error) {
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(error));
    }

    function run(label, work) {
      if (busy) return;
      busy = true;
      panel.setAttribute("aria-busy", "true");
      setStatus(label, false);
      Promise.resolve().then(work).then(function (value) {
        var verified = verifiedSnapshot(value, projectId);
        if (!verified) throw new Error("The retained premium response is invalid.");
        snapshot = verified;
        setStatus("Held account evidence refreshed. No provider effect ran.", false);
        render();
      }).catch(function (error) {
        setStatus(error.message || "The held control could not complete.", true);
      }).finally(function () {
        busy = false;
        panel.setAttribute("aria-busy", "false");
      });
    }

    function button(label, className, action) {
      var selected = element(
        documentRef,
        "button",
        "spark-button " + (className || ""),
        label
      );
      selected.type = "button";
      selected.addEventListener("click", action);
      return selected;
    }

    function fact(list, label, value) {
      var item = element(documentRef, "div", "alakazam-premium-fact");
      item.append(
        element(documentRef, "dt", "", label),
        element(documentRef, "dd", "", value)
      );
      list.append(item);
    }

    function render() {
      body.replaceChildren();
      if (!snapshot) return;
      var badges = element(documentRef, "div", "alakazam-premium-badges");
      badges.append(
        element(
          documentRef,
          "span",
          "alakazam-premium-badge",
          snapshot.subscription.tierId.replace("alakazam_", "$") + " tier"
        ),
        element(
          documentRef,
          "span",
          "alakazam-premium-badge",
          snapshot.lifecycle.state.replaceAll("_", " ")
        )
      );
      body.append(badges);
      if (!snapshot.premium.configured) {
        body.append(element(
          documentRef,
          "p",
          "alakazam-premium-notice",
          "No retained premium configuration is present."
        ));
      } else if (!snapshot.premium.values) {
        body.append(element(
          documentRef,
          "p",
          "alakazam-premium-notice is-masked",
          "Premium choices are retained privately. Lower tiers receive only masked effective output."
        ));
      } else {
        var values = element(documentRef, "dl", "alakazam-premium-values");
        fact(values, "Cash App", snapshot.premium.values.cashAppHandle || "Not set");
        fact(values, "Venmo", snapshot.premium.values.venmoHandle || "Not set");
        fact(values, "Font", snapshot.premium.values.fontChoiceId);
        fact(values, "Borders", snapshot.premium.values.borderChoiceId);
        fact(
          values,
          "Menu",
          snapshot.premium.values.menu.map(function (item) {
            return item.label;
          }).join(" · ")
        );
        body.append(values);
      }
      if (["payment_grace", "retained_exit"].includes(
        snapshot.lifecycle.state
      )) {
        body.append(element(
          documentRef,
          "p",
          "alakazam-premium-notice is-read-only",
          "Private read and export only. Edit, restoration, publication, and care are unavailable in this state."
        ));
      }
      if (snapshot.restoration.required) {
        body.append(element(
          documentRef,
          "p",
          "alakazam-premium-notice",
          snapshot.restoration.available
            ? "Exact provider readback and tier-change evidence are ready. Restore the retained values before editing."
            : "Restoration is held until exact provider readback and tier-change evidence agree."
        ));
      } else if (snapshot.actions.edit) {
        body.append(element(
          documentRef,
          "p",
          "alakazam-premium-notice is-restored",
          "Premium edit access is restored in the $50 controls."
        ));
      }
      var actions = element(documentRef, "div", "alakazam-premium-actions");
      if (snapshot.actions.export) {
        actions.append(button("Export my premium choices", "", function () {
          if (busy) return;
          busy = true;
          panel.setAttribute("aria-busy", "true");
          setStatus("Preparing bounded customer export…", false);
          Promise.resolve(client.getExport(projectId)).then(function (value) {
            if (!record(value) || value.schema !== EXPORT_SCHEMA
              || value.projectId !== projectId
              || value.providerEffects !== false
              || !DIGEST.test(value.exportDigest)
              || !Number.isSafeInteger(value.byteCount)
              || value.byteCount < 1
              || value.byteCount > 32768) {
              throw new Error("The retained premium export is invalid.");
            }
            onExport(value);
            setStatus("Bounded customer-owned export prepared.", false);
          }).catch(function (error) {
            setStatus(error.message || "Export could not be prepared.", true);
          }).finally(function () {
            busy = false;
            panel.setAttribute("aria-busy", "false");
          });
        }));
      }
      if (snapshot.actions.restore) {
        actions.append(button(
          "Restore retained $50 choices",
          "spark-button-primary",
          function () {
            var id = commandId(cryptoObject);
            run("Checking exact restoration evidence…", function () {
              return client.restoreConfiguration(projectId, {
                commandId: id,
                expectedSourceConfigurationDigest:
                  snapshot.restoration.sourceConfigurationDigest,
                expectedSubscriptionRevision: snapshot.subscription.revision
              });
            });
          }
        ));
      }
      body.append(actions);
    }

    Promise.resolve(client.getSnapshot(projectId)).then(function (value) {
      var verified = verifiedSnapshot(value, projectId);
      if (!verified) throw new Error("The retained premium response is invalid.");
      snapshot = verified;
      setStatus("Retained premium authority loaded. No provider effect ran.", false);
      render();
    }).catch(function (error) {
      setStatus(error.message || "Retained premium state is unavailable.", true);
    });
    return Object.freeze({
      refresh: function () {
        return client.getSnapshot(projectId).then(function (value) {
          snapshot = verifiedSnapshot(value, projectId);
          if (!snapshot) throw new Error("The retained premium response is invalid.");
          render();
          return snapshot;
        });
      }
    });
  }

  return Object.freeze({
    verifiedSnapshot: verifiedSnapshot,
    createClient: createClient,
    mount: mount
  });
}));
