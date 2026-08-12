(function (root, factory) {
  "use strict";

  var desk = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = desk;
  } else {
    root.SiteSourceryOperatorDesk = desk;
    if (root.document) {
      desk.mount(root.document, root.SiteSourceryAbracadabraAPI);
    }
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var SHA256 = /^[a-f0-9]{64}$/u;
  var SAFE_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
  var QUEUE_KINDS = new Set([
    "payment_reconciliation", "reversal_reconciliation", "assessment_job",
    "custom_job", "support_case", "privacy_case", "publication_hold",
    "domain_failure", "care_hold", "mail_exception",
    "invoice_finalization_failure"
  ]);
  var QUEUE_SEVERITIES = new Set(["low", "normal", "high", "critical"]);
  var QUEUE_STATES = new Set(["open", "in_progress", "blocked"]);
  var CASE_KINDS = new Set([
    "support", "access", "correction", "export", "deletion", "appeal"
  ]);
  var CASE_STATES = new Set([
    "open", "assigned", "in_review", "responded", "denied",
    "appeal_pending", "closed"
  ]);

  function responseError() {
    var error = new Error("The operations service returned an invalid response.");
    error.code = "OPERATOR_RESPONSE_INVALID";
    return error;
  }

  function check(condition) {
    if (!condition) throw responseError();
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function exact(value, keys) {
    check(
      isObject(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort())
    );
    return value;
  }

  function text(value, maximum) {
    check(typeof value === "string" && value.length > 0 && value.length <= maximum);
    return value;
  }

  function uuid(value, nullable) {
    if (nullable && value === null) return null;
    check(typeof value === "string" && UUID.test(value));
    return value;
  }

  function digest(value, nullable) {
    if (nullable && value === null) return null;
    check(typeof value === "string" && SHA256.test(value));
    return value;
  }

  function instant(value, nullable) {
    if (nullable && value === null) return null;
    check(
      typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value
    );
    return value;
  }

  function integer(value, minimum) {
    check(Number.isSafeInteger(value) && value >= minimum);
    return value;
  }

  function optionalText(value, maximum) {
    return value === null ? null : text(value, maximum);
  }

  function validateOrganizationPayload(value) {
    exact(value, ["organizations"]);
    check(Array.isArray(value.organizations) && value.organizations.length <= 100);
    return Object.freeze(value.organizations.map(function (entry) {
      exact(entry, ["createdAt", "id", "name", "role", "state"]);
      return Object.freeze({
        id: uuid(entry.id),
        name: text(entry.name, 120),
        role: text(entry.role, 64),
        state: text(entry.state, 64),
        createdAt: instant(entry.createdAt)
      });
    }));
  }

  function validateQueueSource(value) {
    exact(value, ["digest", "id", "revision", "state", "table"]);
    return Object.freeze({
      table: text(value.table, 100),
      id: (check(SAFE_SOURCE.test(value.id)), value.id),
      revision: integer(value.revision, 0),
      digest: digest(value.digest),
      state: text(value.state, 64)
    });
  }

  function validateQueueItem(value) {
    exact(value, [
      "deadlineAt", "digest", "id", "kind", "openedAt", "organizationId",
      "projectId", "repair", "revision", "schema", "severity", "source",
      "status", "updatedAt"
    ]);
    check(
      value.schema === "sitesourcery.operator-work-queue-item/v1" &&
      QUEUE_KINDS.has(value.kind) &&
      QUEUE_SEVERITIES.has(value.severity) &&
      QUEUE_STATES.has(value.status)
    );
    var repair = null;
    if (value.repair !== null) {
      exact(value.repair, ["kind"]);
      check(value.repair.kind === "professional_reversal_reconcile");
      repair = Object.freeze({ kind: value.repair.kind });
    }
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      source: validateQueueSource(value.source),
      organizationId: uuid(value.organizationId, true),
      projectId: uuid(value.projectId, true),
      kind: value.kind,
      severity: value.severity,
      status: value.status,
      deadlineAt: instant(value.deadlineAt, true),
      repair: repair,
      openedAt: instant(value.openedAt),
      revision: integer(value.revision, 1),
      digest: digest(value.digest),
      updatedAt: instant(value.updatedAt)
    });
  }

  function validateQueue(value) {
    exact(value, ["genericRepair", "items", "schema", "sourceAuthoritative"]);
    check(
      value.schema === "sitesourcery.operator-work-queue/v1" &&
      value.sourceAuthoritative === true &&
      value.genericRepair === false &&
      Array.isArray(value.items) && value.items.length <= 200
    );
    var items = value.items.map(validateQueueItem);
    check(new Set(items.map(function (item) { return item.id; })).size === items.length);
    return Object.freeze({
      schema: value.schema,
      sourceAuthoritative: true,
      genericRepair: false,
      items: Object.freeze(items)
    });
  }

  function validateScope(value) {
    exact(value, ["kind", "organizationId", "projectId"]);
    check(["general", "account", "project"].includes(value.kind));
    return Object.freeze({
      kind: value.kind,
      organizationId: uuid(value.organizationId, true),
      projectId: uuid(value.projectId, true)
    });
  }

  function validateDeadline(value) {
    exact(value, ["dueAt", "status"]);
    check(["unassigned", "active", "met", "overdue"].includes(value.status));
    return Object.freeze({ dueAt: instant(value.dueAt, true), status: value.status });
  }

  function validateDecision(value) {
    if (value === null) return null;
    check(isObject(value) && ["response", "denial"].includes(value.kind));
    if (value.kind === "response") {
      exact(value, ["digest", "kind", "recordedAt"]);
      return Object.freeze({
        kind: value.kind,
        digest: digest(value.digest),
        recordedAt: instant(value.recordedAt)
      });
    }
    exact(value, ["explanationDigest", "kind", "reasonCode", "recordedAt"]);
    return Object.freeze({
      kind: value.kind,
      reasonCode: text(value.reasonCode, 64),
      explanationDigest: digest(value.explanationDigest),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateAppeal(value) {
    exact(value, ["available", "caseId", "dueAt", "state"]);
    check(typeof value.available === "boolean");
    return Object.freeze({
      available: value.available,
      dueAt: instant(value.dueAt, true),
      caseId: uuid(value.caseId, true),
      state: optionalText(value.state, 64)
    });
  }

  function validateNotification(value) {
    exact(value, ["kind", "reservedAt", "state"]);
    check(value.state === "reserved");
    return Object.freeze({
      kind: text(value.kind, 64),
      state: value.state,
      reservedAt: instant(value.reservedAt)
    });
  }

  function validateAudit(value) {
    exact(value, [
      "actorKind", "eventDigest", "evidenceDigest", "kind", "occurredAt",
      "sequence"
    ]);
    check(["customer", "operator", "system"].includes(value.actorKind));
    return Object.freeze({
      sequence: integer(value.sequence, 1),
      kind: text(value.kind, 64),
      actorKind: value.actorKind,
      evidenceDigest: digest(value.evidenceDigest),
      occurredAt: instant(value.occurredAt),
      eventDigest: digest(value.eventDigest)
    });
  }

  function validateEvidence(value) {
    exact(value, ["digest", "kind", "recordedAt", "sourceKind"]);
    return Object.freeze({
      kind: text(value.kind, 64),
      sourceKind: text(value.sourceKind, 64),
      digest: digest(value.digest),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateOperatorCase(value) {
    exact(value, [
      "appeal", "appealBasisDigest", "assigned", "assignedOperatorId", "audit",
      "closedAt", "closureReasonCode", "deadline", "deadlineBasisDigest",
      "decision", "evidence", "id", "identityEvidenceDigest", "identityState",
      "intakeChannel", "openedAt", "parentCaseId", "requestKind",
      "requesterReferenceDigest", "requesterUserId", "revision", "schema", "scope",
      "state", "notifications"
    ]);
    check(
      value.schema === "sitesourcery.support-case-operator-read/v1" &&
      CASE_KINDS.has(value.requestKind) &&
      CASE_STATES.has(value.state) &&
      typeof value.assigned === "boolean" &&
      Array.isArray(value.notifications) && value.notifications.length <= 200 &&
      Array.isArray(value.audit) && value.audit.length <= 1000 &&
      Array.isArray(value.evidence) && value.evidence.length <= 1000
    );
    var audit = value.audit.map(validateAudit);
    check(audit.every(function (event, index) { return event.sequence === index + 1; }));
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      requestKind: value.requestKind,
      scope: validateScope(value.scope),
      state: value.state,
      identityState: text(value.identityState, 64),
      assigned: value.assigned,
      deadline: validateDeadline(value.deadline),
      decision: validateDecision(value.decision),
      appeal: validateAppeal(value.appeal),
      notifications: Object.freeze(value.notifications.map(validateNotification)),
      audit: Object.freeze(audit),
      openedAt: instant(value.openedAt),
      closedAt: instant(value.closedAt, true),
      revision: integer(value.revision, 1),
      intakeChannel: text(value.intakeChannel, 64),
      requesterUserId: uuid(value.requesterUserId, true),
      requesterReferenceDigest: digest(value.requesterReferenceDigest),
      parentCaseId: uuid(value.parentCaseId, true),
      assignedOperatorId: uuid(value.assignedOperatorId, true),
      identityEvidenceDigest: digest(value.identityEvidenceDigest, true),
      deadlineBasisDigest: digest(value.deadlineBasisDigest, true),
      appealBasisDigest: digest(value.appealBasisDigest, true),
      closureReasonCode: optionalText(value.closureReasonCode, 64),
      evidence: Object.freeze(value.evidence.map(validateEvidence))
    });
  }

  function validateCaseList(value) {
    exact(value, ["cases", "schema"]);
    check(
      value.schema === "sitesourcery.support-case-operator-list/v1" &&
      Array.isArray(value.cases) && value.cases.length <= 200
    );
    var cases = value.cases.map(validateOperatorCase);
    check(new Set(cases.map(function (entry) { return entry.id; })).size === cases.length);
    return Object.freeze({ schema: value.schema, cases: Object.freeze(cases) });
  }

  function human(value) {
    var words = String(value == null ? "" : value).replaceAll("_", " ");
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not recorded";
  }

  function formatDate(value) {
    if (!value) return "Not assigned";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function shortDigest(value) {
    return value ? value.slice(0, 12) + "…" : "Not recorded";
  }

  function localInstant(value) {
    check(typeof value === "string" && value.length > 0);
    var parsed = new Date(value);
    check(Number.isFinite(parsed.getTime()));
    return parsed.toISOString();
  }

  function formValue(form, name) {
    var control = form.elements.namedItem(name);
    return String(control && control.value || "").trim();
  }

  function createElement(documentRef, name, className, copy) {
    var element = documentRef.createElement(name);
    if (className) element.className = className;
    if (copy !== undefined) element.textContent = copy;
    return element;
  }

  function mount(documentRef, publicApi) {
    var board = documentRef.getElementById("operator-board");
    if (!board) return null;
    var sessionStatus = documentRef.getElementById("operator-session-status");
    var organizationSelect = documentRef.getElementById("operator-organization");
    var refreshButton = documentRef.getElementById("operator-refresh");
    var queueRoot = documentRef.getElementById("operator-queue");
    var casesRoot = documentRef.getElementById("operator-cases");
    var queueCount = documentRef.getElementById("queue-count");
    var caseCount = documentRef.getElementById("case-count");
    var errorRoot = documentRef.getElementById("operator-error");
    var noticeRoot = documentRef.getElementById("operator-notice");
    var detailRoot = documentRef.getElementById("operator-case-detail");
    var detailTitle = documentRef.getElementById("case-detail-title");
    var factsRoot = documentRef.getElementById("case-facts");
    var auditRoot = documentRef.getElementById("case-audit");
    var actionsRoot = documentRef.getElementById("case-actions");
    var state = {
      client: null,
      actorId: null,
      organizations: [],
      organizationId: null,
      queue: [],
      cases: [],
      selectedCase: null,
      busy: false
    };

    function showError(error) {
      var message = error && error.message
        ? error.message
        : "The operations desk could not complete that request.";
      errorRoot.textContent = message;
      errorRoot.hidden = false;
      noticeRoot.hidden = true;
      errorRoot.focus();
    }

    function showNotice(message) {
      noticeRoot.textContent = message;
      noticeRoot.hidden = false;
      errorRoot.hidden = true;
    }

    function clearMessages() {
      errorRoot.hidden = true;
      noticeRoot.hidden = true;
    }

    function setBusy(value) {
      state.busy = value;
      board.setAttribute("aria-busy", value ? "true" : "false");
      refreshButton.disabled = value || !state.organizationId;
      organizationSelect.disabled = value || state.organizations.length === 0;
      Array.from(actionsRoot.querySelectorAll("button, input, select")).forEach(
        function (control) { control.disabled = value; }
      );
    }

    function empty(root, message) {
      root.replaceChildren(createElement(documentRef, "p", "operator-empty", message));
    }

    function meta(values) {
      var row = createElement(documentRef, "div", "operator-meta");
      values.forEach(function (value) {
        row.appendChild(createElement(documentRef, "span", "", value));
      });
      return row;
    }

    function renderRepair(item, card) {
      if (!item.repair) return;
      var template = documentRef.getElementById("operator-repair-template");
      check(template && template.content);
      var details = template.content.firstElementChild.cloneNode(true);
      var form = details.querySelector("form");
      form.dataset.queueRepair = item.id;
      card.appendChild(details);
    }

    function renderQueue() {
      queueCount.textContent = String(state.queue.length);
      if (state.queue.length === 0) {
        empty(queueRoot, "No canonical source records currently require operator work.");
        return;
      }
      var fragment = documentRef.createDocumentFragment();
      state.queue.forEach(function (item) {
        var card = createElement(documentRef, "article", "operator-card");
        var top = createElement(documentRef, "div", "operator-card-top");
        top.append(
          createElement(documentRef, "span", "operator-card-title", human(item.kind)),
          createElement(documentRef, "span", "operator-badge", item.severity)
        );
        top.lastChild.dataset.severity = item.severity;
        card.append(
          top,
          meta([
            "State: " + human(item.source.state),
            "Deadline: " + formatDate(item.deadlineAt),
            "Revision " + item.revision
          ]),
          meta([
            "Source: " + item.source.table,
            "Digest: " + shortDigest(item.digest)
          ])
        );
        renderRepair(item, card);
        fragment.appendChild(card);
      });
      queueRoot.replaceChildren(fragment);
    }

    function renderCases() {
      caseCount.textContent = String(state.cases.length);
      if (state.cases.length === 0) {
        empty(casesRoot, "No support or privacy cases are open in this operator scope.");
        return;
      }
      var fragment = documentRef.createDocumentFragment();
      state.cases.forEach(function (entry) {
        var button = createElement(documentRef, "button", "operator-card");
        button.type = "button";
        button.dataset.caseId = entry.id;
        var top = createElement(documentRef, "span", "operator-card-top");
        top.append(
          createElement(documentRef, "span", "operator-card-title", human(entry.requestKind) + " case"),
          createElement(documentRef, "span", "operator-badge", human(entry.state))
        );
        button.append(
          top,
          meta([
            "Identity: " + human(entry.identityState),
            "Deadline: " + human(entry.deadline.status),
            "Revision " + entry.revision
          ]),
          meta(["Opened " + formatDate(entry.openedAt), "Case " + entry.id])
        );
        fragment.appendChild(button);
      });
      casesRoot.replaceChildren(fragment);
    }

    function fact(label, value) {
      var row = createElement(documentRef, "dl", "operator-fact");
      row.append(
        createElement(documentRef, "dt", "", label),
        createElement(documentRef, "dd", "", value)
      );
      return row;
    }

    function renderDetail() {
      var entry = state.selectedCase;
      if (!entry) {
        detailRoot.hidden = true;
        return;
      }
      detailTitle.textContent = human(entry.requestKind) + " case · " + entry.id;
      factsRoot.replaceChildren(
        fact("State", human(entry.state)),
        fact("Identity", human(entry.identityState)),
        fact("Assigned operator", entry.assignedOperatorId || "Unassigned"),
        fact("Scope", human(entry.scope.kind)),
        fact("Deadline", formatDate(entry.deadline.dueAt) + " · " + human(entry.deadline.status)),
        fact("Revision", String(entry.revision)),
        fact("Requester reference", shortDigest(entry.requesterReferenceDigest)),
        fact("Opening", formatDate(entry.openedAt)),
        fact("Decision", entry.decision ? human(entry.decision.kind) : "Not recorded")
      );
      if (entry.audit.length === 0) {
        auditRoot.replaceChildren(createElement(documentRef, "li", "", "No audit events."));
      } else {
        auditRoot.replaceChildren.apply(auditRoot, entry.audit.map(function (event) {
          return createElement(
            documentRef,
            "li",
            "",
            event.sequence + ". " + human(event.kind) + " · " + human(event.actorKind) +
              " · " + formatDate(event.occurredAt) + " · " + shortDigest(event.eventDigest)
          );
        }));
      }
      actionsRoot.hidden = entry.state === "closed";
      detailRoot.hidden = false;
      detailRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function refreshAll(options) {
      if (!state.organizationId) return;
      clearMessages();
      setBusy(true);
      try {
        var organization = encodeURIComponent(state.organizationId);
        var values = await Promise.all([
          state.client.request(
            "GET",
            "/operator/work-queue?operatorOrganizationId=" + organization
          ),
          state.client.request(
            "GET",
            "/operator/support-cases?operatorOrganizationId=" + organization
          )
        ]);
        state.queue = validateQueue(values[0]).items;
        state.cases = validateCaseList(values[1]).cases;
        if (state.selectedCase) {
          state.selectedCase = state.cases.find(function (entry) {
            return entry.id === state.selectedCase.id;
          }) || null;
        }
        renderQueue();
        renderCases();
        renderDetail();
        if (options && options.notice) showNotice(options.notice);
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    async function refreshSources() {
      if (!state.organizationId) return;
      clearMessages();
      setBusy(true);
      try {
        var refreshed = await state.client.request(
          "POST",
          "/operator/work-queue/refresh",
          { body: { operatorOrganizationId: state.organizationId } }
        );
        state.queue = validateQueue(refreshed).items;
        renderQueue();
        await refreshAll({ notice: "Canonical sources and case state refreshed." });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    async function mutateCase(suffix, body, notice) {
      var selected = state.selectedCase;
      if (!selected) return;
      clearMessages();
      setBusy(true);
      try {
        var result = await state.client.request(
          "POST",
          "/operator/support-cases/" + encodeURIComponent(selected.id) + suffix,
          {
            body: Object.assign({
              expectedRevision: selected.revision,
              operatorOrganizationId: state.organizationId
            }, body)
          }
        );
        state.selectedCase = validateOperatorCase(result);
        state.cases = state.cases.map(function (entry) {
          return entry.id === state.selectedCase.id ? state.selectedCase : entry;
        });
        renderCases();
        renderDetail();
        showNotice(notice);
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    casesRoot.addEventListener("click", function (event) {
      var button = event.target.closest("[data-case-id]");
      if (!button) return;
      state.selectedCase = state.cases.find(function (entry) {
        return entry.id === button.dataset.caseId;
      }) || null;
      renderDetail();
    });

    queueRoot.addEventListener("submit", async function (event) {
      var form = event.target.closest("[data-queue-repair]");
      if (!form) return;
      event.preventDefault();
      var item = state.queue.find(function (entry) {
        return entry.id === form.dataset.queueRepair;
      });
      if (!item || !item.repair) return;
      try {
        var facts = JSON.parse(formValue(form, "verifiedFacts"));
        check(isObject(facts));
        var resolution = formValue(form, "resolution");
        setBusy(true);
        var result = await state.client.request(
          "POST",
          "/operator/work-queue/" + encodeURIComponent(item.id) +
            "/repairs/professional-reversal",
          {
            body: {
              operatorOrganizationId: state.organizationId,
              expectedQueueRevision: item.revision,
              resolution: resolution,
              confirmedOutcome: resolution === "confirmed"
                ? formValue(form, "confirmedOutcome")
                : null,
              verifiedFacts: facts,
              verifiedFactsDigest: formValue(form, "verifiedFactsDigest"),
              verifiedObservedAt: localInstant(formValue(form, "verifiedObservedAt"))
            }
          }
        );
        exact(result, ["kind", "queue", "queueItemId", "result", "schema"]);
        check(
          result.schema === "sitesourcery.operator-work-queue-repair-result/v1" &&
          result.kind === "professional_reversal_reconcile" &&
          result.queueItemId === item.id
        );
        state.queue = validateQueue(result.queue).items;
        renderQueue();
        showNotice("Bounded reversal evidence was reconciled and the queue was rebuilt.");
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    actionsRoot.addEventListener("click", function (event) {
      var button = event.target.closest("[data-case-action]");
      if (!button || state.busy) return;
      if (button.dataset.caseAction === "assign") {
        mutateCase("/assignment", { assignedOperatorId: state.actorId }, "Case assigned.");
      } else if (button.dataset.caseAction === "review") {
        mutateCase("/review", {}, "Formal review started.");
      }
    });

    actionsRoot.addEventListener("change", function (event) {
      if (event.target.name !== "appealAvailable") return;
      var form = event.target.closest("[data-case-form=\"denial\"]");
      var fields = form.querySelector("[data-appeal-fields]");
      fields.hidden = !event.target.checked;
      Array.from(fields.querySelectorAll("input")).forEach(function (input) {
        input.required = event.target.checked;
      });
    });

    actionsRoot.addEventListener("submit", function (event) {
      var form = event.target.closest("[data-case-form]");
      if (!form) return;
      event.preventDefault();
      var kind = form.dataset.caseForm;
      try {
        if (kind === "identity") {
          mutateCase("/identity", {
            identityState: formValue(form, "identityState"),
            evidenceDigest: formValue(form, "evidenceDigest")
          }, "Identity evidence recorded.");
        } else if (kind === "deadline") {
          mutateCase("/deadline", {
            responseDueAt: localInstant(formValue(form, "responseDueAt")),
            basisDigest: formValue(form, "basisDigest")
          }, "Response deadline recorded.");
        } else if (kind === "evidence") {
          mutateCase("/evidence", {
            evidenceKind: formValue(form, "evidenceKind"),
            evidenceDigest: formValue(form, "evidenceDigest")
          }, "Case evidence digest recorded.");
        } else if (kind === "response") {
          mutateCase("/response", {
            responseDigest: formValue(form, "responseDigest")
          }, "Response digest recorded; no customer message was sent.");
        } else if (kind === "denial") {
          var appeal = form.elements.namedItem("appealAvailable").checked;
          mutateCase("/denial", {
            denialReasonCode: formValue(form, "denialReasonCode"),
            denialExplanationDigest: formValue(form, "denialExplanationDigest"),
            appealAvailable: appeal,
            appealDueAt: appeal ? localInstant(formValue(form, "appealDueAt")) : null,
            appealBasisDigest: appeal ? formValue(form, "appealBasisDigest") : null
          }, "Denial evidence recorded; no customer message was sent.");
        } else if (kind === "closure") {
          mutateCase("/closure", {
            closureReasonCode: formValue(form, "closureReasonCode"),
            closureEvidenceDigest: formValue(form, "closureEvidenceDigest")
          }, "Case closure recorded.");
        }
      } catch (error) {
        showError(error);
      }
    });

    documentRef.getElementById("case-detail-close").addEventListener("click", function () {
      state.selectedCase = null;
      renderDetail();
    });
    refreshButton.addEventListener("click", refreshSources);
    organizationSelect.addEventListener("change", function () {
      state.organizationId = organizationSelect.value;
      state.selectedCase = null;
      refreshAll();
    });

    async function boot() {
      if (!publicApi || typeof publicApi.createClient !== "function") {
        showError(new Error("The secure Site Sourcery client is unavailable."));
        return;
      }
      state.client = publicApi.createClient();
      setBusy(true);
      try {
        var account = await state.client.me();
        if (!account || !account.user) {
          sessionStatus.textContent = "Sign in through the Assessment and Custom tools to continue.";
          board.setAttribute("aria-busy", "false");
          return;
        }
        state.actorId = uuid(account.user.id);
        state.organizations = validateOrganizationPayload(
          await state.client.listOrganizations()
        );
        if (state.organizations.length === 0) {
          throw new Error("This account does not have an active operator organization.");
        }
        organizationSelect.replaceChildren.apply(
          organizationSelect,
          state.organizations.map(function (organization) {
            var option = createElement(
              documentRef,
              "option",
              "",
              organization.name + " · " + human(organization.role)
            );
            option.value = organization.id;
            return option;
          })
        );
        state.organizationId = state.organizations[0].id;
        organizationSelect.value = state.organizationId;
        sessionStatus.textContent = "Authenticated. Database capability checks remain authoritative for every request.";
        await refreshAll();
      } catch (error) {
        if (error && error.status === 401) {
          sessionStatus.textContent = "Sign in through the Assessment and Custom tools to continue.";
        } else {
          showError(error);
        }
      } finally {
        setBusy(false);
      }
    }

    boot();
    return Object.freeze({ refresh: refreshAll });
  }

  return Object.freeze({
    mount: mount,
    validateCaseList: validateCaseList,
    validateOperatorCase: validateOperatorCase,
    validateOrganizationPayload: validateOrganizationPayload,
    validateQueue: validateQueue
  });
}));
