(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryResponderSurfaces = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "sitesourcery.responder-surface-dashboard/v1";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[0-9a-f]{64}$/u;

  function record(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function exactKeys(value, keys) {
    return record(value) && JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(keys.slice().sort());
  }

  function instant(value) {
    var parsed = typeof value === "string" ? new Date(value) : null;
    return Boolean(
      parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    );
  }

  function verifiedContact(value) {
    if (!exactKeys(value, [
      "consentBasis", "consentedAt", "customerUserId", "id", "optedOutAt",
      "projectId", "purpose", "revision", "routeDigest", "routeKind", "state"
    ]) || !UUID.test(value.id) || !UUID.test(value.projectId) ||
      !UUID.test(value.customerUserId) || !DIGEST.test(value.routeDigest) ||
      value.routeKind !== "sms" || value.purpose !== "missed_call_response" ||
      !["inbound_call", "inbound_message", "explicit_service_request"]
        .includes(value.consentBasis) ||
      !["active", "opted_out", "revoked"].includes(value.state) ||
      !instant(value.consentedAt) ||
      !(value.optedOutAt === null || instant(value.optedOutAt)) ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
    return Object.freeze(Object.assign({}, value));
  }

  function verifiedEvent(value, interactionId) {
    if (!exactKeys(value, [
      "eventKind", "id", "interactionId", "messageIntent", "occurredAt",
      "providerEffects", "recordedAt", "state"
    ]) || !UUID.test(value.id) || value.interactionId !== interactionId ||
      !["missed_call", "message_received"].includes(value.eventKind) ||
      !["not_applicable", "message", "stop", "handoff"]
        .includes(value.messageIntent) || value.state !== "applied" ||
      !instant(value.occurredAt) || !instant(value.recordedAt) ||
      value.providerEffects !== false) return null;
    return Object.freeze(Object.assign({}, value));
  }

  function verifiedCommand(value, interactionId) {
    if (!exactKeys(value, [
      "contactAuthorityId", "deliveryClaimed", "heldReason", "id",
      "interactionId", "messageKind", "providerEffects", "requestedAt", "state"
    ]) || !UUID.test(value.id) || value.interactionId !== interactionId ||
      !UUID.test(value.contactAuthorityId) ||
      !["missed_call_ack", "human_handoff_ack"].includes(value.messageKind) ||
      value.state !== "held" ||
      !["global_kill", "production_hold", "opted_out", "human_handoff"]
        .includes(value.heldReason) || !instant(value.requestedAt) ||
      value.providerEffects !== false || value.deliveryClaimed !== false) {
      return null;
    }
    return Object.freeze(Object.assign({}, value));
  }

  function verifiedInteraction(value) {
    if (!exactKeys(value, [
      "contactAuthorityId", "events", "handoffReason", "heldCommands", "id",
      "lastEventAt", "openedAt", "projectId", "revision", "routeDigest",
      "sourceKind", "state"
    ]) || !UUID.test(value.id) || !UUID.test(value.projectId) ||
      !(value.contactAuthorityId === null || UUID.test(value.contactAuthorityId)) ||
      !DIGEST.test(value.routeDigest) ||
      !["missed_call", "message_received"].includes(value.sourceKind) ||
      !["open", "handoff_required", "opted_out", "closed"].includes(value.state) ||
      !(value.handoffReason === null || [
        "missing_authority", "customer_request", "uncertain_intent", "urgent",
        "operator_review"
      ].includes(value.handoffReason)) || !instant(value.openedAt) ||
      !instant(value.lastEventAt) || !Number.isSafeInteger(value.revision) ||
      value.revision < 1 || !Array.isArray(value.events) ||
      !Array.isArray(value.heldCommands)) return null;
    var events = value.events.map(function (item) {
      return verifiedEvent(item, value.id);
    });
    var commands = value.heldCommands.map(function (item) {
      return verifiedCommand(item, value.id);
    });
    if (events.includes(null) || commands.includes(null)) return null;
    return Object.freeze(Object.assign({}, value, {
      events: Object.freeze(events),
      heldCommands: Object.freeze(commands)
    }));
  }

  function verify(value, audience) {
    if (!exactKeys(value, [
      "audience", "billingEffects", "contacts", "globalKillEngaged",
      "interactions", "mode", "observedAt", "organizationId",
      "providerEffects", "schema", "sellable"
    ]) || value.schema !== SCHEMA || value.audience !== audience ||
      !UUID.test(value.organizationId) || !instant(value.observedAt) ||
      value.mode !== "held" || value.globalKillEngaged !== true ||
      value.sellable !== false || value.billingEffects !== false ||
      value.providerEffects !== false || !Array.isArray(value.contacts) ||
      value.contacts.length > 100 || !Array.isArray(value.interactions) ||
      value.interactions.length > 200) {
      throw new Error("The held Responder projection is invalid.");
    }
    var contacts = value.contacts.map(verifiedContact);
    var interactions = value.interactions.map(verifiedInteraction);
    if (contacts.includes(null) || interactions.includes(null)) {
      throw new Error("The held Responder projection is invalid.");
    }
    return Object.freeze({
      audience: audience,
      organizationId: value.organizationId,
      observedAt: value.observedAt,
      contacts: Object.freeze(contacts),
      interactions: Object.freeze(interactions)
    });
  }

  function title(value) {
    return value.replaceAll("_", " ").replace(/\b\w/gu, function (letter) {
      return letter.toUpperCase();
    });
  }

  function presentation(value, audience) {
    var selected = verify(value, audience);
    var events = selected.interactions.reduce(function (count, interaction) {
      return count + interaction.events.length;
    }, 0);
    var commands = selected.interactions.reduce(function (count, interaction) {
      return count + interaction.heldCommands.length;
    }, 0);
    return Object.freeze({
      audience: audience,
      heading: audience === "customer"
        ? "Your held Responder"
        : "Responder operations",
      summary: selected.contacts.length + " consent route" +
        (selected.contacts.length === 1 ? "" : "s") + ", " +
        selected.interactions.length + " conversation" +
        (selected.interactions.length === 1 ? "" : "s") + ", and " +
        events + " event" + (events === 1 ? "" : "s") + ".",
      holdNotice:
        "Global kill is engaged. Messages, telephony, billing, and provider work remain off.",
      observedAt: selected.observedAt,
      heldCommands: commands,
      contacts: selected.contacts,
      interactions: selected.interactions
    });
  }

  function element(documentRef, name, className, text) {
    var selected = documentRef.createElement(name);
    if (className) selected.className = className;
    if (text !== undefined) selected.textContent = text;
    return selected;
  }

  function action(documentRef, label, value, onCommand, disabled) {
    var button = element(documentRef, "button", "responder-surface-action", label);
    button.type = "button";
    button.disabled = disabled === true;
    button.setAttribute("aria-disabled", disabled === true ? "true" : "false");
    if (!button.disabled) {
      button.addEventListener("click", function () {
        onCommand(Object.freeze(value));
      });
    }
    return button;
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
      throw new Error("The Responder panel mount is invalid.");
    }
    var panel = element(documentRef, "section", "responder-surface");
    panel.setAttribute("data-responder-surface", audience);
    var heading = element(
      documentRef,
      "h2",
      "responder-surface-heading",
      shown.heading
    );
    heading.id = "responder-surface-" + audience;
    panel.setAttribute("aria-labelledby", heading.id);
    var summary = element(
      documentRef,
      "p",
      "responder-surface-summary",
      shown.summary
    );
    var hold = element(
      documentRef,
      "p",
      "responder-surface-hold",
      shown.holdNotice
    );
    hold.setAttribute("role", "status");
    var metrics = element(documentRef, "dl", "responder-surface-metrics");
    [
      ["Held commands", String(shown.heldCommands)],
      ["Evidence refreshed", shown.observedAt.slice(0, 10)]
    ].forEach(function (fact) {
      var card = element(documentRef, "div", "responder-surface-metric");
      card.append(
        element(documentRef, "dt", "", fact[0]),
        element(documentRef, "dd", "", fact[1])
      );
      metrics.append(card);
    });
    var contacts = element(documentRef, "div", "responder-surface-grid");
    shown.contacts.forEach(function (contact) {
      var card = element(documentRef, "article", "responder-surface-card");
      card.append(
        element(documentRef, "h3", "", "SMS consent · " + title(contact.state)),
        element(
          documentRef,
          "p",
          "responder-surface-meta",
          title(contact.consentBasis) + " · route digest " +
            contact.routeDigest.slice(0, 12)
        ),
        action(documentRef, "Record STOP", {
          action: "stop",
          contactAuthorityId: contact.id,
          projectId: contact.projectId,
          routeDigest: contact.routeDigest
        }, onCommand, contact.state !== "active")
      );
      contacts.append(card);
    });
    var conversations = element(documentRef, "div", "responder-surface-grid");
    shown.interactions.forEach(function (interaction) {
      var card = element(documentRef, "article", "responder-surface-card");
      card.append(
        element(documentRef, "h3", "", title(interaction.state)),
        element(
          documentRef,
          "p",
          "responder-surface-meta",
          title(interaction.sourceKind) + " · " + interaction.events.length +
            " durable event" + (interaction.events.length === 1 ? "" : "s")
        )
      );
      var events = element(documentRef, "ul", "responder-surface-events");
      interaction.events.forEach(function (event) {
        events.append(element(
          documentRef,
          "li",
          "",
          title(event.eventKind) + " · " + title(event.messageIntent) +
            " · " + event.occurredAt.slice(0, 10)
        ));
      });
      card.append(events);
      var controls = element(documentRef, "div", "responder-surface-controls");
      controls.append(
        action(documentRef, "Request human handoff", {
          action: "handoff",
          interactionId: interaction.id,
          projectId: interaction.projectId,
          expectedRevision: interaction.revision
        }, onCommand, interaction.state !== "open"),
        action(documentRef, "Reserve held acknowledgment", {
          action: "held-message",
          interactionId: interaction.id,
          projectId: interaction.projectId,
          contactAuthorityId: interaction.contactAuthorityId
        }, onCommand, interaction.contactAuthorityId === null)
      );
      card.append(controls);
      conversations.append(card);
    });
    var globalControls = element(
      documentRef,
      "div",
      "responder-surface-controls"
    );
    globalControls.append(action(
      documentRef,
      audience === "operator"
        ? "Reassert organization kill"
        : "Prepare consent evidence",
      { action: audience === "operator" ? "global-kill" : "prepare-consent" },
      onCommand,
      false
    ));
    if (audience === "operator") {
      globalControls.append(action(
        documentRef,
        "Record consent evidence",
        { action: "operator-consent" },
        onCommand,
        false
      ));
    }
    panel.append(
      heading,
      summary,
      hold,
      metrics,
      globalControls,
      contacts,
      conversations
    );
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
