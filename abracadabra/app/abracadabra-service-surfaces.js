(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraServiceSurfaces = api;
    api.boot(root);
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[0-9a-f]{64}$/u;

  function element(documentRef, name, className, copy) {
    var selected = documentRef.createElement(name);
    if (className) selected.className = className;
    if (copy !== undefined) selected.textContent = copy;
    return selected;
  }

  function field(documentRef, label, control) {
    var wrapper = element(documentRef, "label", "service-surface-field");
    wrapper.append(element(documentRef, "span", "", label), control);
    return wrapper;
  }

  function input(documentRef, name, type, options) {
    var selected = element(documentRef, "input");
    selected.name = name;
    selected.type = type;
    selected.required = true;
    if (options && options.pattern) selected.pattern = options.pattern;
    if (options && options.maxLength) selected.maxLength = options.maxLength;
    if (options && options.value) selected.value = options.value;
    selected.autocomplete = "off";
    return selected;
  }

  function select(documentRef, name, values) {
    var selected = element(documentRef, "select");
    selected.name = name;
    selected.required = true;
    values.forEach(function (entry) {
      var option = element(documentRef, "option", "", entry.label);
      option.value = entry.value;
      selected.append(option);
    });
    return selected;
  }

  function value(form, name) {
    var control = form.elements.namedItem(name);
    return String(control && control.value || "").trim();
  }

  function exactDigest(form, name) {
    var selected = value(form, name);
    if (!DIGEST.test(selected)) throw new Error("Enter an exact lowercase SHA-256 digest.");
    return selected;
  }

  function exactInstant(form, name) {
    var parsed = new Date(value(form, name));
    if (!Number.isFinite(parsed.getTime())) throw new Error("Enter an exact evidence time.");
    return parsed.toISOString();
  }

  function projectOptions(state) {
    return (Array.isArray(state.projects) ? state.projects : [])
      .map(function (project) {
        var id = String(project && (project.id || project.projectId) || "");
        if (!UUID.test(id)) return null;
        return {
          value: id,
          label: String(project.name || project.label || "Project") + " · " + id
        };
      })
      .filter(Boolean);
  }

  function createShell(documentRef, controlRoom) {
    var root = element(
      documentRef,
      "section",
      "platform-control hosted-service-surfaces"
    );
    root.id = "hosted-service-surfaces";
    root.hidden = true;
    root.setAttribute("aria-labelledby", "hosted-service-surfaces-title");
    var shell = element(documentRef, "div", "site-shell");
    var header = element(documentRef, "header", "service-surfaces-heading");
    var kicker = element(documentRef, "p", "spark-kicker", "Held services");
    var title = element(
      documentRef, "h2", "", "Care and Responder evidence"
    );
    title.id = "hosted-service-surfaces-title";
    var copy = element(
      documentRef,
      "p",
      "",
      "Review durable Care and Responder state for the selected organization. Provider delivery, billing, and commercial release remain off."
    );
    header.append(kicker, title, copy);
    var status = element(
      documentRef,
      "p",
      "service-surfaces-status",
      "Waiting for a signed-in organization."
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var panels = element(documentRef, "div", "service-surfaces-grid");
    var care = element(documentRef, "div", "service-surfaces-panel");
    care.dataset.customerCareSurface = "true";
    var responder = element(documentRef, "div", "service-surfaces-panel");
    responder.dataset.customerResponderSurface = "true";
    panels.append(care, responder);
    var command = element(documentRef, "div", "service-surfaces-command");
    command.dataset.responderCommand = "true";
    command.hidden = true;
    shell.append(header, status, panels, command);
    root.append(shell);
    controlRoom.after(root);
    return { root: root, status: status, care: care, responder: responder,
      command: command };
  }

  function responderCommandForm(documentRef, action, state, submit) {
    var form = element(documentRef, "form", "service-surface-command-form");
    var heading = element(
      documentRef,
      "h3",
      "",
      ({
        "prepare-consent": "Record consent evidence",
        stop: "Record STOP evidence",
        handoff: "Request human handoff",
        "held-message": "Reserve a held acknowledgment"
      })[action.action] || "Responder evidence"
    );
    form.append(heading);
    var digestOptions = { pattern: "[a-f0-9]{64}", maxLength: 64 };
    if (action.action === "prepare-consent") {
      var projects = projectOptions(state);
      if (projects.length === 0) {
        form.append(element(documentRef, "p", "", "Create or select a project first."));
      } else {
        form.append(
          field(documentRef, "Project", select(documentRef, "projectId", projects)),
          field(documentRef, "Consent basis", select(documentRef, "consentBasis", [
            { value: "inbound_call", label: "Inbound call" },
            { value: "inbound_message", label: "Inbound message" },
            { value: "explicit_service_request", label: "Explicit service request" }
          ])),
          field(documentRef, "Route SHA-256", input(
            documentRef, "routeDigest", "text", digestOptions
          )),
          field(documentRef, "Consent evidence SHA-256", input(
            documentRef, "consentEvidenceDigest", "text", digestOptions
          )),
          field(documentRef, "Consented at", input(
            documentRef, "occurredAt", "datetime-local",
            { value: new Date().toISOString().slice(0, 16) }
          ))
        );
      }
    } else if (action.action === "stop") {
      form.append(
        field(documentRef, "Provider event ID SHA-256", input(
          documentRef, "providerEventIdDigest", "text", digestOptions
        )),
        field(documentRef, "STOP payload SHA-256", input(
          documentRef, "payloadDigest", "text", digestOptions
        )),
        field(documentRef, "Occurred at", input(
          documentRef, "occurredAt", "datetime-local",
          { value: new Date().toISOString().slice(0, 16) }
        ))
      );
    } else if (action.action === "handoff") {
      form.append(
        field(documentRef, "Reason", select(documentRef, "reason", [
          { value: "customer_request", label: "Customer request" },
          { value: "uncertain_intent", label: "Uncertain intent" },
          { value: "urgent", label: "Urgent" },
          { value: "operator_review", label: "Operator review" }
        ])),
        field(documentRef, "Evidence SHA-256", input(
          documentRef, "evidenceDigest", "text", digestOptions
        ))
      );
    } else if (action.action === "held-message") {
      form.append(
        field(documentRef, "Message kind", select(documentRef, "messageKind", [
          { value: "missed_call_ack", label: "Missed-call acknowledgment" },
          { value: "human_handoff_ack", label: "Human-handoff acknowledgment" }
        ])),
        field(documentRef, "Content SHA-256", input(
          documentRef, "contentDigest", "text", digestOptions
        ))
      );
    }
    var controls = element(documentRef, "div", "service-surface-command-controls");
    var cancel = element(documentRef, "button", "spark-button", "Cancel");
    cancel.type = "button";
    cancel.dataset.cancelResponderCommand = "true";
    var save = element(
      documentRef,
      "button",
      "spark-button spark-button-primary",
      "Record held evidence"
    );
    save.type = "submit";
    save.disabled = action.action === "prepare-consent" &&
      projectOptions(state).length === 0;
    controls.append(cancel, save);
    form.append(controls);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submit(form, action, save);
    });
    return form;
  }

  function commandRequest(client, organizationId, form, action) {
    var options = {
      headers: { "X-SiteSourcery-Organization-Id": organizationId }
    };
    if (action.action === "prepare-consent") {
      options.body = {
        consentBasis: value(form, "consentBasis"),
        consentEvidenceDigest: exactDigest(form, "consentEvidenceDigest"),
        consentedAt: exactInstant(form, "occurredAt"),
        projectId: value(form, "projectId"),
        routeDigest: exactDigest(form, "routeDigest")
      };
      return client.request("POST", "/responder/contacts", options);
    }
    if (action.action === "stop") {
      options.body = {
        occurredAt: exactInstant(form, "occurredAt"),
        payloadDigest: exactDigest(form, "payloadDigest"),
        projectId: action.projectId,
        providerEventIdDigest: exactDigest(form, "providerEventIdDigest"),
        routeDigest: action.routeDigest
      };
      return client.request(
        "POST",
        "/responder/contacts/" + encodeURIComponent(action.contactAuthorityId) +
          "/stop",
        options
      );
    }
    if (action.action === "handoff") {
      options.body = {
        evidenceDigest: exactDigest(form, "evidenceDigest"),
        expectedRevision: action.expectedRevision,
        projectId: action.projectId,
        reason: value(form, "reason")
      };
      return client.request(
        "POST",
        "/responder/interactions/" + encodeURIComponent(action.interactionId) +
          "/handoff",
        options
      );
    }
    if (action.action === "held-message") {
      options.body = {
        contactAuthorityId: action.contactAuthorityId,
        contentDigest: exactDigest(form, "contentDigest"),
        messageKind: value(form, "messageKind"),
        projectId: action.projectId
      };
      return client.request(
        "POST",
        "/responder/interactions/" + encodeURIComponent(action.interactionId) +
          "/held-messages",
        options
      );
    }
    return Promise.reject(new Error("That Responder action is unavailable."));
  }

  function boot(windowRef) {
    var documentRef = windowRef && windowRef.document;
    var session = windowRef &&
      windowRef.SiteSourceryAbracadabraHostedSession;
    var api = windowRef && windowRef.SiteSourceryAbracadabraAPI;
    var careModule = windowRef && windowRef.SiteSourceryCareSurfaces;
    var responderModule = windowRef && windowRef.SiteSourceryResponderSurfaces;
    var controlRoom = documentRef && documentRef.getElementById("control-room");
    if (!documentRef || !session || typeof session.subscribe !== "function" ||
      !api || typeof api.createClient !== "function" ||
      !careModule || !responderModule || !controlRoom) return false;

    var shell = createShell(documentRef, controlRoom);
    var client = api.createClient({ baseUrl: "/api/v1" });
    var currentState = session.getState();
    var selectedOrganization = "";
    var sequence = 0;

    function status(copy, error) {
      shell.status.textContent = copy;
      shell.status.classList.toggle("is-error", error === true);
    }

    function closeCommand() {
      shell.command.hidden = true;
      shell.command.replaceChildren();
    }

    function openCommand(action) {
      closeCommand();
      shell.command.hidden = false;
      var form = responderCommandForm(
        documentRef,
        action,
        currentState,
        function (selectedForm, selectedAction, button) {
          button.disabled = true;
          status("Recording held Responder evidence…", false);
          Promise.resolve().then(function () {
            return commandRequest(
              client, selectedOrganization, selectedForm, selectedAction
            );
          }).then(function () {
            closeCommand();
            status(
              "Held evidence recorded. No provider delivery or billing effect was opened.",
              false
            );
            return load(selectedOrganization, true);
          }).catch(function (error) {
            status(error && error.message
              ? error.message
              : "The held Responder evidence could not be recorded.", true);
          }).finally(function () { button.disabled = false; });
        }
      );
      shell.command.append(form);
      form.querySelector("[data-cancel-responder-command]")
        .addEventListener("click", closeCommand);
      form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function load(organizationId, retainStatus) {
      var selectedSequence = ++sequence;
      if (!retainStatus) status("Loading held Care and Responder evidence…", false);
      var requestOptions = {
        headers: { "X-SiteSourcery-Organization-Id": organizationId }
      };
      var results = await Promise.allSettled([
        client.request("GET", "/care", requestOptions),
        client.request("GET", "/responder", requestOptions)
      ]);
      if (selectedSequence !== sequence || organizationId !== selectedOrganization) {
        return;
      }
      shell.care.replaceChildren();
      shell.responder.replaceChildren();
      var failures = [];
      if (results[0].status === "fulfilled") {
        careModule.mount({
          audience: "customer",
          container: shell.care,
          documentRef: documentRef,
          snapshot: results[0].value
        });
      } else {
        failures.push("Care");
        shell.care.append(element(
          documentRef, "p", "service-surfaces-error", "Care evidence is unavailable."
        ));
      }
      if (results[1].status === "fulfilled") {
        responderModule.mount({
          audience: "customer",
          container: shell.responder,
          documentRef: documentRef,
          snapshot: results[1].value,
          onCommand: openCommand
        });
      } else {
        failures.push("Responder");
        shell.responder.append(element(
          documentRef, "p", "service-surfaces-error",
          "Responder evidence is unavailable."
        ));
      }
      if (failures.length > 0) {
        status(failures.join(" and ") + " could not be opened.", true);
      } else if (!retainStatus) {
        status("Held Care and Responder evidence is current.", false);
      }
    }

    session.subscribe(function (state) {
      currentState = state;
      var organizationId = String(state && state.organizationId || "");
      if (!state || !state.account || !UUID.test(organizationId)) {
        sequence += 1;
        selectedOrganization = "";
        shell.root.hidden = true;
        closeCommand();
        return;
      }
      shell.root.hidden = false;
      if (organizationId !== selectedOrganization) {
        selectedOrganization = organizationId;
        closeCommand();
        load(organizationId, false);
      }
    });
    return true;
  }

  return Object.freeze({ boot: boot, commandRequest: commandRequest });
}));
