(function () {
  "use strict";

  var modeModule = window.SiteSourceryAbracadabraControlMode;
  var apiModule = window.SiteSourceryAbracadabraAPI;
  var controlModule = window.SiteSourceryAbracadabraHostedControl;
  var maker = window.SiteSourceryAbracadabraMaker;
  var configuration = modeModule ? modeModule.resolve(document) : { held: true };
  if (!configuration.hosted) return;

  var status = document.getElementById("platform-status");
  var auth = document.getElementById("platform-auth");
  var dashboard = document.getElementById("platform-dashboard");
  var workroom = document.getElementById("workroom");
  var controlRoom = document.getElementById("control-room");
  if (
    !apiModule
    || !controlModule
    || !maker
    || !status
    || !auth
    || !dashboard
    || !workroom
    || !controlRoom
  ) {
    if (status) {
      status.hidden = false;
      status.textContent = "We couldn’t open saved projects. Your preview is still here.";
      status.classList.add("is-error");
    }
    return;
  }

  // The hosted and local controls are mutually exclusive. Once hosted mode is
  // selected, this module never constructs or falls back to the browser store.
  var api = apiModule.createClient({ baseUrl: "/api/v1" });
  var control = controlModule.createHostedControl({
    api: api,
    catalog: configuration.catalog
  });
  window.SiteSourceryAbracadabraHostedSession = control;

  workroom.after(controlRoom);
  var pendingGuestCandidate = null;
  var draftTimer = null;
  var queuedDraft = null;
  var draftSaving = false;
  var hostedRecoveryToken = null;
  var renderedProjectId = null;
  var lastState = control.getState();
  var domainUI = null;

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function text(value) {
    return String(value == null ? "" : value);
  }

  function value(name) {
    var field = one('[name="' + name + '"]');
    return field ? field.value : "";
  }

  function checked(name) {
    var field = one('[name="' + name + '"]:checked');
    return field ? field.value : "";
  }

  function idOf(entity) {
    return text(entity && (
      entity.id
      || entity.projectId
      || entity.versionId
      || entity.quoteId
      || entity.registrantContactId
      || entity.contactId
      || entity.consentId
      || entity.domainOrderId
      || entity.orderId
      || entity.priceCheckId
      || entity.domainId
    ));
  }

  function projectAddress(project) {
    return project && project.address ? project.address : {};
  }

  function projectVersions(project) {
    return project && Array.isArray(project.versions) ? project.versions : [];
  }

  function acceptedVersions(project) {
    return projectVersions(project).filter(function (version) {
      return ["accepted", "accepted_release", "ready_for_release"].includes(
        text(version.candidateState || version.state || version.status)
      );
    });
  }

  function announce(message, kind) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function explain(error, fallback) {
    var message = error && error.message ? error.message : fallback;
    var requestId = error && error.requestId ? " Request " + error.requestId + "." : "";
    return message + requestId;
  }

  function operationPending(name) {
    return Boolean(
      lastState.operations
      && lastState.operations[name]
      && lastState.operations[name].status === "pending"
    );
  }

  function run(button, operationName, action, successMessage) {
    if (button) button.disabled = true;
    announce("Working…");
    return Promise.resolve()
      .then(action)
      .then(function (result) {
        if (successMessage) announce(successMessage, "success");
        return result;
      })
      .catch(function (error) {
        announce(explain(error, "We couldn’t complete that request."), "error");
        throw error;
      })
      .finally(function () {
        if (button && !operationPending(operationName)) button.disabled = false;
        renderDomainStorefront(lastState);
      });
  }

  function flushDraft() {
    if (draftSaving || !queuedDraft || !lastState.project) return;
    var queued = queuedDraft;
    queuedDraft = null;
    if (queued.projectId !== idOf(lastState.project)) return;
    draftSaving = true;
    control.saveDraft(queued.raw).catch(function (error) {
      announce(explain(error, "We couldn’t save this draft. Your work is still in the maker."), "error");
    }).finally(function () {
      draftSaving = false;
      if (queuedDraft) flushDraft();
    });
  }

  function setAuthMode(mode) {
    all("[data-auth-mode]").forEach(function (button) {
      var selected = button.getAttribute("data-auth-mode") === mode;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    all("[data-auth-panel]").forEach(function (panel) {
      var selected = panel.getAttribute("data-auth-panel") === mode;
      panel.hidden = !selected;
      panel.setAttribute("aria-hidden", String(!selected));
    });
  }

  function revealControlRoom(mode) {
    controlRoom.hidden = false;
    setAuthMode(mode || "create");
    controlRoom.scrollIntoView({ block: "start" });
  }

  function renderChoices() {
    var mode = checked("addressMode");
    one("[data-address-mode-a]").hidden = mode !== "mode_a";
    one("[data-address-mode-b]").hidden = mode !== "mode_b";
    one("[data-access-password]").hidden = checked("visibility") !== "private";
  }

  function renderManagementChoices() {
    var mode = value("manageAddressMode");
    one("[data-manage-mode-a]").hidden = mode !== "mode_a";
    one("[data-manage-mode-b]").hidden = mode !== "mode_b";
    one("[data-manage-passphrase]").hidden = value("manageVisibility") !== "private";
  }

  function renderProjectList(state) {
    var list = one("[data-project-list]");
    list.replaceChildren();
    state.projects.forEach(function (project) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      var title = document.createElement("strong");
      var detail = document.createElement("span");
      button.type = "button";
      button.className = "platform-project-button";
      title.textContent = text(project.name || "Website project");
      detail.textContent = text(project.lifecycle || project.state || "Project");
      if (state.project && idOf(state.project) === idOf(project)) {
        button.setAttribute("aria-current", "true");
      }
      button.append(title, detail);
      button.addEventListener("click", function () {
        run(button, "project", function () {
          return control.selectProject(idOf(project)).then(function (selected) {
            if (selected && !maker.loadProject(selected)) {
              announce(
                "Your project opened, but we kept your unsaved maker changes.",
                "error"
              );
            }
          });
        }, null).catch(function () {});
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    one("[data-project-empty]").hidden = state.projects.length !== 0;
  }

  function stateLabel(valueToFormat) {
    return text(valueToFormat || "pending")
      .replace(/_/gu, " ")
      .replace(/\b\w/gu, function (letter) { return letter.toUpperCase(); });
  }

  function renderReleaseList(state) {
    var list = one("[data-release-list]");
    list.replaceChildren();
    var versions = acceptedVersions(state.project);
    if (!versions.length) {
      var empty = document.createElement("li");
      empty.textContent = "No saved versions yet.";
      list.appendChild(empty);
      return;
    }
    versions.slice().reverse().forEach(function (version, reverseIndex) {
      var item = document.createElement("li");
      var title = document.createElement("strong");
      var button = document.createElement("button");
      var versionId = idOf(version);
      var ordinal = versions.length - reverseIndex;
      title.textContent = "Version " + ordinal + " · "
        + text(version.rawFacts && version.rawFacts.businessName || "Website");
      button.type = "button";
      button.className = "spark-button";
      button.textContent = state.selectedVersionId === versionId ? "Selected" : "Review this version";
      button.disabled = state.selectedVersionId === versionId;
      button.addEventListener("click", function () {
        if (!maker.selectPlatformVersion(versionId)) {
          announce("We couldn’t open that saved version.", "error");
          return;
        }
        control.selectVersion(versionId);
        announce("Version selected.", "success");
      });
      item.append(title, button);
      list.appendChild(item);
    });
  }

  function addressCopy(address) {
    return text(address.hostname || address.domain || address.label || "Not connected yet");
  }

  function renderProject(state) {
    var project = state.project;
    one("[data-active-project]").hidden = !project;
    if (!project) {
      renderedProjectId = null;
      return;
    }
    var address = projectAddress(project);
    var subscription = state.subscription || {};
    if (renderedProjectId !== idOf(project)) {
      renderedProjectId = idOf(project);
      var customerDomain = address.kind === "custom" || address.mode === "mode_b";
      one('[name="manageAddressMode"]').value = customerDomain ? "mode_b" : "mode_a";
      one('[name="manageAddressLabel"]').value = text(address.label || "");
      one('[name="manageDomainPath"]').value = address.path === "purchase" ? "purchase" : "byod";
      one('[name="manageOwnedDomain"]').value = text(address.hostname || address.domain || "");
      one('[name="manageVisibility"]').value = text(
        project.visibility || project.access && project.access.visibility || "public"
      );
      one('[name="manageAccessPassword"]').value = "";
      renderManagementChoices();
    }
    one("[data-project-name]").textContent = text(project.name || "Website project");
    one("[data-project-address]").textContent = addressCopy(address);
    one("[data-plan-state]").textContent = stateLabel(
      subscription.status || project.plan && project.plan.status || "not active"
    );
    one("[data-address-state]").textContent = stateLabel(address.state || address.status || "pending");
    one("[data-visibility-state]").textContent = stateLabel(
      project.visibility || project.access && project.access.visibility || "public"
    );
    one("[data-serving-state]").textContent = stateLabel(
      project.serving && project.serving.state || project.publicationState || "draft"
    );

    var openSite = one("[data-open-site]");
    openSite.hidden = !(address.hostname && project.serving && project.serving.state === "live");
    if (!openSite.hidden) openSite.href = "https://" + address.hostname + "/";

    var selected = acceptedVersions(project).find(function (version) {
      return idOf(version) === state.selectedVersionId;
    });
    one("[data-selected-release-title]").textContent = selected
      ? "Version · " + text(selected.rawFacts && selected.rawFacts.businessName || idOf(selected))
      : "No accepted version selected";
    one("[data-selected-release-summary]").textContent = selected
      ? "This is the version you chose to publish."
      : "Make and review a version below, or choose a saved version.";
    one("[data-publish]").disabled = !selected || operationPending("requestRelease");
    one("[data-unpublish]").hidden = !(project.serving && project.serving.state === "live");
    one("[data-release-copy]").textContent = selected
      ? "We’ll confirm this exact version is ready before it goes live."
      : "Choose a saved version before publishing.";
    renderReleaseList(state);

    var addressId = idOf(address);
    one("[data-domain-review-status]").hidden = !(address.kind === "custom" || address.mode === "mode_b");
    one("[data-request-domain-review]").disabled = !addressId;
    one("[data-domain-review-title]").textContent = addressCopy(address);
    one("[data-domain-review-state]").textContent = stateLabel(
      address.verificationStatus || address.state || "pending"
    );
    one("[data-domain-review-receipt]").textContent = text(
      address.verificationRequestId || "Not sent yet"
    );
    one("[data-domain-review-proof]").textContent = "We’ll check the proof before connecting the domain.";
    one("[data-domain-review-time]").textContent = text(address.updatedAt || "Not verified");
    one("[data-domain-review-copy]").textContent =
      "Send your proof here. We’ll let you know when the domain is connected.";
  }

  function renderRetry(state) {
    var existing = one("[data-hosted-retry]");
    var failedName = Object.keys(state.operations).find(function (name) {
      var operation = state.operations[name];
      return operation.status === "error" && operation.error && operation.error.retryable;
    });
    if (!failedName) {
      if (existing) existing.remove();
      return;
    }
    var button = existing || document.createElement("button");
    button.type = "button";
    button.className = "spark-button";
    button.setAttribute("data-hosted-retry", "");
    button.textContent = "Try again";
    button.onclick = function () {
      run(button, failedName, function () {
        return control.retry(failedName);
      }, "Done.").catch(function () {});
    };
    if (!existing) status.insertAdjacentElement("afterend", button);
  }

  function render(state) {
    lastState = state;
    renderRetry(state);
    var signedIn = Boolean(state.account);
    auth.hidden = signedIn;
    dashboard.hidden = !signedIn;
    renderDomainStorefront(state);
    if (!signedIn) return;
    one("[data-account-name]").textContent = text(state.account.name || state.account.displayName || "Account");
    one("[data-account-email]").textContent = text(state.account.email || "");
    var organization = state.organizations.find(function (candidate) {
      return idOf(candidate) === state.organizationId;
    });
    one("[data-organization-name]").textContent = text(
      organization && organization.name || "Organization"
    );
    renderProjectList(state);
    renderProject(state);
  }

  function node(tagName, attributes, copy) {
    var element = document.createElement(tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      element.setAttribute(name, attributes[name]);
    });
    if (copy != null) element.textContent = copy;
    return element;
  }

  function hostedField(labelCopy, name, type) {
    var label = node("label", { class: "spark-field" });
    label.appendChild(node("span", {}, labelCopy));
    var input = node("input", {
      name: name,
      type: type || "text",
      autocomplete: "off"
    });
    label.appendChild(input);
    return { label: label, input: input };
  }

  function quoteCopy(quote) {
    if (!quote) return "Search for a domain, then check today’s price.";
    var hostname = text(quote.hostname || quote.domain || "Selected domain");
    var amount = Number(quote.amountMinor);
    var currency = text(quote.currency).toUpperCase();
    var price = "";
    if (Number.isInteger(amount) && amount >= 0 && /^[A-Z]{3}$/u.test(currency)) {
      try {
        price = new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency
        }).format(amount / 100);
      } catch (_error) {
        price = amount + " " + currency + " minor units";
      }
    }
    var expiry = quote.expiresAt ? " · expires " + new Date(quote.expiresAt).toLocaleString() : "";
    return hostname + (price ? " · " + price : "") + expiry
      + ". We’ll check again right before registration.";
  }

  function domainResultHostname(result) {
    return text(result && (result.hostname || result.domain || result.name));
  }

  function renderDomainStorefront(state) {
    if (!domainUI) return;
    var priorResult = domainUI.results.value;
    domainUI.results.replaceChildren();
    state.domainSearchResults.forEach(function (result) {
      var hostname = domainResultHostname(result);
      if (!hostname) return;
      var option = node("option", { value: hostname }, hostname);
      domainUI.results.appendChild(option);
    });
    if (priorResult && all("option", domainUI.results).some(function (option) {
      return option.value === priorResult;
    })) domainUI.results.value = priorResult;
    domainUI.results.disabled = !domainUI.results.options.length;
    domainUI.quoteButton.disabled = domainUI.results.disabled;
    domainUI.quoteState.textContent = quoteCopy(state.domainQuote);

    var quoteReady = Boolean(idOf(state.domainQuote));
    var contactReady = Boolean(idOf(state.registrantContact));
    var consentReady = Boolean(idOf(state.domainConsent));
    var orderReady = Boolean(idOf(state.domainOrder));
    var priceCheckReady = Boolean(idOf(state.domainPriceCheck));
    domainUI.contactButton.disabled = !quoteReady;
    domainUI.consentButton.disabled = !quoteReady
      || !contactReady
      || !configuration.catalog.domainTermsVersion;
    domainUI.paymentButton.disabled = !consentReady || !state.project;
    domainUI.priceCheckButton.disabled = !orderReady;
    domainUI.registerButton.disabled = !priceCheckReady
      || domainUI.irreversible.checked !== true;
    domainUI.pollButton.disabled = !orderReady;
    domainUI.resumeOrdersButton.disabled = !state.project;

    var order = state.domainOrder;
    domainUI.orderState.textContent = order
      ? "Registration · " + stateLabel(
        order.state || order.status || order.registrationState || "pending"
      )
      : "No domain order selected.";

    var priorDomain = domainUI.domains.value;
    domainUI.domains.replaceChildren();
    state.domains.forEach(function (domain) {
      var option = node(
        "option",
        { value: idOf(domain) },
        text(domain.hostname || domain.domain || idOf(domain))
      );
      domainUI.domains.appendChild(option);
    });
    if (priorDomain && all("option", domainUI.domains).some(function (option) {
      return option.value === priorDomain;
    })) domainUI.domains.value = priorDomain;
    domainUI.domains.disabled = !domainUI.domains.options.length;
    domainUI.openDomainButton.disabled = domainUI.domains.disabled;

    var selectedDomain = state.selectedDomain;
    domainUI.managementState.textContent = selectedDomain
      ? text(selectedDomain.hostname || selectedDomain.domain || idOf(selectedDomain))
        + " · you own this domain · " + stateLabel(
          selectedDomain.state || selectedDomain.status || "managed"
        )
      : "Load and choose a customer-owned domain to manage it here.";
    [
      domainUI.dnsButton,
      domainUI.autoRenewButton,
      domainUI.renewButton,
      domainUI.transferButton
    ].forEach(function (button) { button.disabled = !selectedDomain; });
    domainUI.records.replaceChildren();
    state.dnsRecords.forEach(function (record) {
      var item = node("li");
      var copy = node(
        "span",
        {},
        text(record.type) + " " + text(record.name) + " → " + text(record.content)
      );
      var remove = node("button", { type: "button", class: "spark-button" }, "Remove");
      remove.addEventListener("click", function () {
        run(remove, "deleteDnsRecord", function () {
          return control.deleteDnsRecord(idOf(record));
        }, "DNS record removal request completed.").catch(function () {});
      });
      item.append(copy, remove);
      domainUI.records.appendChild(item);
    });
  }

  function installDomainStorefront() {
    var panel = node("section", {
      class: "platform-panel",
      "data-hosted-domain-storefront": ""
    });
    panel.append(
      node("p", { class: "spark-kicker" }, "Customer-owned domains"),
      node("h4", {}, "You own the domain. Search, pay, register, and manage it here."),
      node(
        "p",
        {},
        "Your name goes on the registration. Site Sourcery handles the setup for you."
      )
    );

    var searchField = hostedField("Find a domain", "hostedDomainSearch", "search");
    var searchButton = node("button", { type: "button", class: "spark-button" }, "Search domains");
    var results = node("select", {
      "data-hosted-domain-results": "",
      "aria-label": "Available domain result"
    });
    var years = node("select", {
      "data-hosted-domain-years": "",
      "aria-label": "Registration term"
    });
    for (var year = 1; year <= 10; year += 1) {
      years.appendChild(node("option", { value: String(year) }, year + (year === 1 ? " year" : " years")));
    }
    var quoteButton = node("button", { type: "button", class: "spark-button" }, "Get current quote");
    var quoteState = node("p", { "data-hosted-domain-quote-state": "" });
    var searchActions = node("div", { class: "platform-actions platform-actions-left" });
    searchActions.append(searchButton, results, years, quoteButton);
    panel.append(searchField.label, searchActions, quoteState);

    var registrantHeading = node("h5", {}, "Domain owner details");
    var registrantCopy = node(
      "p",
      {},
      "We’ll register the domain in your name."
    );
    var fields = {};
    [
      ["Legal name", "hostedRegistrantName"],
      ["Organization", "hostedRegistrantOrganization"],
      ["Email", "hostedRegistrantEmail", "email"],
      ["Phone", "hostedRegistrantPhone", "tel"],
      ["Street address", "hostedRegistrantAddress1"],
      ["Address line 2", "hostedRegistrantAddress2"],
      ["City", "hostedRegistrantCity"],
      ["State or region", "hostedRegistrantRegion"],
      ["Postal code", "hostedRegistrantPostal"],
      ["Two-letter country code", "hostedRegistrantCountry"]
    ].forEach(function (definition) {
      var field = hostedField(definition[0], definition[1], definition[2]);
      fields[definition[1]] = field.input;
      panel.appendChild(field.label);
    });
    var contactButton = node("button", { type: "button", class: "spark-button" }, "Save registrant details");
    panel.insertBefore(registrantCopy, fields.hostedRegistrantName.parentElement);
    panel.insertBefore(registrantHeading, registrantCopy);
    panel.appendChild(contactButton);

    var agreementLabel = node("label", { class: "spark-confirmation" });
    var agreement = node("input", { type: "checkbox", name: "hostedDomainAgreementAccepted" });
    agreementLabel.append(
      agreement,
      node("span", {}, "I accept the domain agreement for this name and price.")
    );
    var certificationLabel = node("label", { class: "spark-confirmation" });
    var certification = node("input", { type: "checkbox", name: "hostedRegistrantCertified" });
    certificationLabel.append(
      certification,
      node("span", {}, "I certify that the customer registrant details are accurate.")
    );
    var autoRenewLabel = node("label", { class: "spark-confirmation" });
    var initialAutoRenew = node("input", { type: "checkbox", name: "hostedDomainInitialAutoRenew" });
    autoRenewLabel.append(initialAutoRenew, node("span", {}, "Request automatic renewal."));
    var consentButton = node("button", { type: "button", class: "spark-button" }, "Record domain consent");
    var paymentButton = node("button", { type: "button", class: "spark-button" }, "Pay for this domain");
    var priceCheckButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Run fresh availability and price check"
    );
    var irreversibleLabel = node("label", { class: "spark-confirmation" });
    var irreversible = node("input", { type: "checkbox", name: "hostedDomainIrreversible" });
    irreversibleLabel.append(
      irreversible,
      node("span", {}, "I understand that a completed domain registration cannot be undone.")
    );
    var registerButton = node(
      "button",
      { type: "button", class: "spark-button spark-button-primary" },
      "Register this domain"
    );
    var resumeOrdersButton = node("button", { type: "button", class: "spark-button" }, "Resume latest order");
    var pollButton = node("button", { type: "button", class: "spark-button" }, "Check registration progress");
    var orderState = node("p", { "data-hosted-domain-order-state": "" }, "No domain order selected.");
    var purchaseActions = node("div", { class: "platform-actions platform-actions-left" });
    purchaseActions.append(
      consentButton,
      paymentButton,
      priceCheckButton,
      registerButton,
      resumeOrdersButton,
      pollButton
    );
    panel.append(
      agreementLabel,
      certificationLabel,
      autoRenewLabel,
      irreversibleLabel,
      purchaseActions,
      orderState
    );

    panel.append(
      node("h5", {}, "Manage registered domains"),
      node(
        "p",
        {},
        "Update DNS, renew the domain, or move it to another registrar from this account."
      )
    );
    var loadDomainsButton = node("button", { type: "button", class: "spark-button" }, "Load my domains");
    var domains = node("select", {
      "data-hosted-domains": "",
      "aria-label": "Customer domain"
    });
    var openDomainButton = node("button", { type: "button", class: "spark-button" }, "Manage selected domain");
    var managementActions = node("div", { class: "platform-actions platform-actions-left" });
    managementActions.append(loadDomainsButton, domains, openDomainButton);
    var managementState = node("p", { "data-hosted-domain-management-state": "" });

    var dnsType = node("select", { "aria-label": "DNS record type" });
    ["A", "AAAA", "CNAME", "TXT", "MX"].forEach(function (type) {
      dnsType.appendChild(node("option", { value: type }, type));
    });
    var dnsName = hostedField("DNS name", "hostedDnsName");
    var dnsContent = hostedField("DNS value", "hostedDnsContent");
    var dnsTtl = hostedField("DNS TTL seconds", "hostedDnsTtl", "number");
    dnsTtl.input.value = "3600";
    var dnsButton = node("button", { type: "button", class: "spark-button" }, "Save DNS record");
    var records = node("ol", { class: "platform-ticket-list", "data-hosted-dns-records": "" });

    var autoRenewChoice = node("select", { "aria-label": "Automatic renewal setting" });
    autoRenewChoice.append(
      node("option", { value: "on" }, "Automatic renewal on"),
      node("option", { value: "off" }, "Automatic renewal off")
    );
    var autoRenewButton = node("button", { type: "button", class: "spark-button" }, "Save renewal setting");
    var renewYears = node("select", { "aria-label": "Renewal term" });
    for (var renewYear = 1; renewYear <= 10; renewYear += 1) {
      renewYears.appendChild(node(
        "option",
        { value: String(renewYear) },
        renewYear + (renewYear === 1 ? " year" : " years")
      ));
    }
    var renewButton = node("button", { type: "button", class: "spark-button" }, "Get renewal quote");
    var transferButton = node("button", { type: "button", class: "spark-button" }, "Request transfer out");
    var domainActions = node("div", { class: "platform-actions platform-actions-left" });
    domainActions.append(dnsType, dnsButton, autoRenewChoice, autoRenewButton, renewYears, renewButton, transferButton);
    panel.append(
      managementActions,
      managementState,
      dnsName.label,
      dnsContent.label,
      dnsTtl.label,
      domainActions,
      records
    );

    one(".platform-command-grid").appendChild(panel);

    searchButton.addEventListener("click", function () {
      run(searchButton, "domainSearch", function () {
        return control.searchDomains(searchField.input.value);
      }, "Domain search completed. Availability is still rechecked before registration.")
        .catch(function () {});
    });
    quoteButton.addEventListener("click", function () {
      run(quoteButton, "domainQuote", function () {
        return control.createDomainQuote({
          hostname: results.value,
          years: Number(years.value),
          purpose: "register"
        });
      }, "Price saved for this step.").catch(function () {});
    });
    contactButton.addEventListener("click", function () {
      run(contactButton, "registrantContact", function () {
        return control.saveRegistrantContact({
          name: fields.hostedRegistrantName.value,
          organization: fields.hostedRegistrantOrganization.value,
          email: fields.hostedRegistrantEmail.value,
          phone: fields.hostedRegistrantPhone.value,
          addressLine1: fields.hostedRegistrantAddress1.value,
          addressLine2: fields.hostedRegistrantAddress2.value,
          city: fields.hostedRegistrantCity.value,
          region: fields.hostedRegistrantRegion.value,
          postalCode: fields.hostedRegistrantPostal.value,
          countryCode: fields.hostedRegistrantCountry.value
        });
      }, "Domain owner details saved.").catch(function () {});
    });
    consentButton.addEventListener("click", function () {
      run(consentButton, "domainConsent", function () {
        return control.acceptDomainConsent({
          termsVersion: configuration.catalog.domainTermsVersion,
          registrationAgreementAccepted: agreement.checked,
          registrantCertificationAccepted: certification.checked,
          autoRenewRequested: initialAutoRenew.checked
        });
      }, "Domain consent recorded for this quote and registrant.").catch(function () {});
    });
    paymentButton.addEventListener("click", function () {
      run(paymentButton, "domainOrder", function () {
        return control.createDomainOrder().then(function (order) {
          var destination = order && (order.paymentUrl || order.checkoutUrl);
          if (!destination) return order;
          var parsed = new URL(destination, window.location.origin);
          if (parsed.protocol !== "https:" || parsed.origin !== window.location.origin) {
            throw new Error("Domain payment must stay inside the Site Sourcery account.");
          }
          window.location.assign(parsed.href);
          return order;
        });
      }, "Domain payment order created.").catch(function () {});
    });
    resumeOrdersButton.addEventListener("click", function () {
      run(resumeOrdersButton, "domainOrders", function () {
        return control.listDomainOrders();
      }, "Latest domain order loaded.").catch(function () {});
    });
    priceCheckButton.addEventListener("click", function () {
      run(priceCheckButton, "domainPriceCheck", function () {
        return control.refreshDomainPrice();
      }, "Price and availability checked.").catch(function () {});
    });
    irreversible.addEventListener("change", function () { renderDomainStorefront(lastState); });
    registerButton.addEventListener("click", function () {
      run(registerButton, "domainRegistration", function () {
        return control.requestDomainRegistration({
          irreversibleRegistrationAccepted: irreversible.checked
        });
      }, "We’re registering your domain. Check progress here.")
        .then(function () { window.setTimeout(function () { pollButton.click(); }, 1500); })
        .catch(function () {});
    });
    pollButton.addEventListener("click", function () {
      run(pollButton, "domainOrderPoll", function () {
        return control.pollDomainOrder();
      }, "Domain progress updated.").catch(function () {});
    });
    loadDomainsButton.addEventListener("click", function () {
      run(loadDomainsButton, "domains", function () {
        return control.listDomains();
      }, "Customer domains loaded.").catch(function () {});
    });
    openDomainButton.addEventListener("click", function () {
      run(openDomainButton, "domain", function () {
        return control.selectDomain(domains.value);
      }, "Domain controls are ready.").catch(function () {});
    });
    dnsButton.addEventListener("click", function () {
      run(dnsButton, "upsertDnsRecord", function () {
        return control.upsertDnsRecord({
          type: dnsType.value,
          name: dnsName.input.value,
          content: dnsContent.input.value,
          ttl: Number(dnsTtl.input.value)
        });
      }, "DNS record request completed.").catch(function () {});
    });
    autoRenewButton.addEventListener("click", function () {
      run(autoRenewButton, "setDomainAutoRenew", function () {
        return control.setDomainAutoRenew(autoRenewChoice.value === "on");
      }, "Automatic renewal preference saved.").catch(function () {});
    });
    renewButton.addEventListener("click", function () {
      run(renewButton, "domainRenewalQuote", function () {
        return control.requestDomainRenewalQuote(Number(renewYears.value));
      }, "Current renewal quote requested.").catch(function () {});
    });
    transferButton.addEventListener("click", function () {
      if (!window.confirm("Move this domain to another registrar?")) return;
      run(transferButton, "domainTransferOut", function () {
        return control.requestDomainTransferOut();
      }, "Transfer request started.").catch(function () {});
    });

    return {
      results: results,
      quoteButton: quoteButton,
      quoteState: quoteState,
      contactButton: contactButton,
      consentButton: consentButton,
      paymentButton: paymentButton,
      priceCheckButton: priceCheckButton,
      irreversible: irreversible,
      registerButton: registerButton,
      resumeOrdersButton: resumeOrdersButton,
      pollButton: pollButton,
      orderState: orderState,
      domains: domains,
      openDomainButton: openDomainButton,
      managementState: managementState,
      dnsButton: dnsButton,
      autoRenewButton: autoRenewButton,
      renewButton: renewButton,
      transferButton: transferButton,
      records: records
    };
  }

  function installHostedBillingControls() {
    var localActivation = one("[data-activate-plan]");
    localActivation.hidden = true;
    one("[data-payment-failure]").hidden = true;
    one("[data-advance-suspension]").hidden = true;
    one("[data-advance-deletion]").hidden = true;

    var actions = localActivation.parentElement;
    var selector = document.createElement("select");
    selector.setAttribute("data-hosted-variant", "");
    selector.setAttribute("aria-label", "Service option");
    if (!configuration.catalog || !Object.keys(configuration.catalog.variants).length) {
      var held = document.createElement("option");
      held.value = "";
      held.textContent = "Online payment isn’t open yet";
      selector.appendChild(held);
      selector.disabled = true;
    } else {
      Object.keys(configuration.catalog.variants).forEach(function (id) {
        var option = document.createElement("option");
        option.value = id;
        option.textContent = configuration.catalog.variants[id].label;
        selector.appendChild(option);
      });
    }
    var checkoutButton = document.createElement("button");
    checkoutButton.type = "button";
    checkoutButton.className = "spark-button";
    checkoutButton.setAttribute("data-hosted-checkout", "");
    checkoutButton.textContent = "Continue to secure payment";
    checkoutButton.disabled = selector.disabled;
    checkoutButton.addEventListener("click", function () {
      run(checkoutButton, "checkout", function () {
        return control.checkout(selector.value).then(function (result) {
          var destination = result && (result.url || result.checkoutUrl);
          if (!destination) throw new Error("We couldn’t open payment.");
          var parsed = new URL(destination, window.location.origin);
          if (parsed.protocol !== "https:") {
            throw new Error("The payment destination was not secure.");
          }
          window.location.assign(parsed.href);
          return result;
        });
      }, null).catch(function () {});
    });
    var portalButton = document.createElement("button");
    portalButton.type = "button";
    portalButton.className = "spark-button";
    portalButton.textContent = "Manage billing";
    portalButton.setAttribute("data-hosted-portal", "");
    portalButton.addEventListener("click", function () {
      run(portalButton, "billingPortal", function () {
        return control.billingPortal().then(function (result) {
          var destination = result && (result.url || result.portalUrl);
          if (!destination) throw new Error("We couldn’t open billing.");
          var parsed = new URL(destination, window.location.origin);
          if (parsed.protocol !== "https:") throw new Error("The billing destination was not secure.");
          window.location.assign(parsed.href);
          return result;
        });
      }, null).catch(function () {});
    });
    actions.prepend(selector, checkoutButton, portalButton);
    one("[data-billing-copy]").textContent = selector.disabled
      ? "Payment is not available until prices are set."
      : "Your plan updates after payment is confirmed.";
    one("[data-cancel-project]").textContent = "Cancel subscription";
  }

  installHostedBillingControls();
  domainUI = installDomainStorefront();
  control.subscribe(render);

  all("[data-auth-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      setAuthMode(button.getAttribute("data-auth-mode"));
    });
  });
  one(".platform-tabs").addEventListener("keydown", function (event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    var tabs = all("[data-auth-mode]");
    var current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    var target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[target].focus();
    setAuthMode(tabs[target].getAttribute("data-auth-mode"));
  });

  one("[data-create-account]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "register", function () {
      return control.register({
        name: value("accountName"),
        organizationName: value("organizationName"),
        email: value("accountEmail"),
        password: value("accountPassword")
      });
    }, "Account created.").catch(function () {});
  });

  one("[data-sign-in]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "signIn", function () {
      return control.signIn({
        email: value("signInEmail"),
        password: value("signInPassword")
      });
    }, "Signed in.").catch(function () {});
  });

  one("[data-request-recovery]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "requestRecovery", function () {
      return control.requestRecovery({ email: value("recoveryEmail") });
    }, "If that account exists, recovery instructions have been sent.").catch(function () {});
  });
  try {
    hostedRecoveryToken = new URLSearchParams(window.location.hash.slice(1)).get("recovery");
  } catch (_error) {
    hostedRecoveryToken = null;
  }
  one("[data-recovery-message]").hidden = !hostedRecoveryToken;
  if (hostedRecoveryToken) {
    one("[data-recovery-token]").textContent = "Secure recovery link loaded.";
    setAuthMode("recover");
  }
  one("[data-reset-password]").addEventListener("click", function (event) {
    if (!hostedRecoveryToken) {
      announce("Open the secure recovery link from your email first.", "error");
      return;
    }
    var button = event.currentTarget;
    run(button, "completeRecovery", function () {
      return control.completeRecovery({
        token: hostedRecoveryToken,
        password: value("recoveryPassword")
      });
    }, "Password reset. Sign in with the new password.").then(function () {
      hostedRecoveryToken = null;
      one("[data-recovery-message]").hidden = true;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setAuthMode("sign-in");
    }).catch(function () {});
  });

  one("[data-sign-out]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "signOut", function () {
      return control.signOut();
    }, "Signed out.").catch(function () {});
  });

  all("[data-new-project]").forEach(function (button) {
    button.addEventListener("click", function () {
      one("[data-project-empty]").hidden = true;
      one("[data-active-project]").hidden = true;
      one("[data-project-creator]").hidden = false;
      one('[name="projectName"]').focus();
    });
  });
  one("[data-cancel-project-create]").addEventListener("click", function () {
    one("[data-project-creator]").hidden = true;
    render(lastState);
  });
  all('[name="addressMode"],[name="visibility"]').forEach(function (field) {
    field.addEventListener("change", renderChoices);
  });
  one("[data-create-project]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    var mode = checked("addressMode");
    var address = mode === "mode_a"
      ? { kind: "licensed", label: value("addressLabel") }
      : {
          kind: "custom",
          path: checked("domainPath") === "purchase" ? "purchase" : "connect",
          hostname: value("ownedDomain")
        };
    run(button, "createProject", function () {
      return control.createProject({
        name: value("projectName"),
        address: address,
        visibility: checked("visibility"),
        accessPassword: value("accessPassword"),
        acceptedTerms: one('[name="projectTermsAccepted"]').checked === true
      }).then(async function (project) {
        one("[data-project-creator]").hidden = true;
        if (project && idOf(project)) await control.selectProject(idOf(project));
        if (pendingGuestCandidate) {
          var candidate = pendingGuestCandidate;
          await control.acceptMadeVersion(candidate);
          maker.markCurrentPlatformVersion(control.getState().selectedVersionId);
          pendingGuestCandidate = null;
        }
        return project;
      });
    }, "Project saved to your account.").catch(function () {});
  });

  one("[data-toggle-settings]").addEventListener("click", function () {
    var panel = one("[data-project-settings]");
    panel.hidden = !panel.hidden;
  });
  one('[name="manageAddressMode"]').addEventListener("change", renderManagementChoices);
  one('[name="manageVisibility"]').addEventListener("change", renderManagementChoices);
  one("[data-save-settings]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    var mode = value("manageAddressMode");
    var address = mode === "mode_a"
      ? { kind: "licensed", label: value("manageAddressLabel") }
      : {
          kind: "custom",
          path: value("manageDomainPath") === "purchase" ? "purchase" : "connect",
          hostname: value("manageOwnedDomain")
        };
    run(button, "selectAddress", async function () {
      await control.selectAddress(address);
      await control.setVisibility({
        visibility: value("manageVisibility"),
        accessPassword: value("manageAccessPassword")
      });
      one("[data-project-settings]").hidden = true;
    }, "Address and privacy settings saved.").catch(function () {});
  });

  one("[data-request-domain-review]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    var address = projectAddress(lastState.project);
    run(button, "requestDomainVerification", function () {
      return control.requestDomainVerification({
        addressId: idOf(address),
        method: value("manageDomainProofMethod"),
        reference: value("manageDomainProofReference")
      });
    }, "We received your domain proof. We’ll check it before connecting the domain.").catch(function () {});
  });

  one("[data-publish]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "requestRelease", function () {
      return control.requestRelease();
    }, "We got your publish request. This page will show when the site is live.")
      .catch(function () {});
  });
  one("[data-unpublish]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "unpublish", function () {
      return control.unpublish();
    }, "Unpublish request completed.").catch(function () {});
  });

  one("[data-create-ticket]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "createSupportTicket", function () {
      return control.createSupportTicket({
        subject: value("supportSubject"),
        message: value("supportMessage")
      });
    }, "Support request sent.").then(function () {
      one('[name="supportSubject"]').value = "";
      one('[name="supportMessage"]').value = "";
    }).catch(function () {});
  });

  one("[data-export-project]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "requestExport", function () {
      return control.requestExport();
    }, "Export requested. We’ll show it here when it’s ready.").catch(function () {});
  });

  one("[data-cancel-project]").addEventListener("click", function (event) {
    if (!window.confirm("Cancel this plan? We’ll show the exact end date before anything is removed.")) return;
    var button = event.currentTarget;
    run(button, "cancelSubscription", function () {
      return control.cancelSubscription();
    }, "Cancellation request completed.").catch(function () {});
  });

  one("[data-delete-project]").addEventListener("click", function (event) {
    if (!window.confirm("Delete this project and all saved website content? This cannot be undone.")) return;
    var button = event.currentTarget;
    run(button, "deleteProject", function () {
      return control.deleteProject();
    }, "Project deleted.").catch(function () {});
  });

  one("[data-detach-domain]").hidden = true;
  one("[data-submit-safety-appeal]").hidden = true;
  one("[data-safety-appeal-field]").hidden = true;
  one("[data-safety-copy]").textContent =
    "Site Sourcery may pause a site for safety review. Contact support if you think a pause is a mistake.";

  window.addEventListener("abracadabra:draftchange", function (event) {
    if (!lastState.project) return;
    window.clearTimeout(draftTimer);
    queuedDraft = {
      projectId: idOf(lastState.project),
      raw: event.detail && event.detail.raw ? event.detail.raw : maker.getDraft()
    };
    draftTimer = window.setTimeout(function () {
      flushDraft();
    }, 350);
  });

  window.addEventListener("abracadabra:versionmade", function (event) {
    if (!event.detail) return;
    if (!lastState.account || !lastState.project) {
      pendingGuestCandidate = JSON.parse(JSON.stringify(event.detail));
      announce(
        "Preview ready. Create an account or sign in when you want to save it.",
        "success"
      );
      return;
    }
    control.acceptMadeVersion(event.detail).then(function (version) {
      maker.markCurrentPlatformVersion(idOf(version));
      announce("Version saved to your account.", "success");
    }).catch(function (error) {
      announce(explain(error, "We couldn’t save that version."), "error");
    });
  });

  window.addEventListener("abracadabra:versionselected", function (event) {
    control.selectVersion(event.detail && event.detail.platformVersionId);
  });

  one("[data-save-direction]").addEventListener("click", function () {
    revealControlRoom(lastState.account ? "sign-in" : "create");
    announce(
      lastState.account
        ? "Create a project to save this preview."
        : "Create an account or sign in to save this preview."
    );
  });

  var openAccount = one("[data-open-account]");
  openAccount.disabled = false;
  openAccount.addEventListener("click", function () {
    revealControlRoom("sign-in");
    announce("Sign in to your Site Sourcery account.");
  });

  var boundary = one(".platform-boundary");
  boundary.querySelector("strong").textContent = "Saved securely";
  boundary.querySelector("span").textContent =
    "Save projects to your account, manage billing and domains, and choose exactly what goes live.";
  all(".platform-proof-note").forEach(function (note) {
    note.textContent =
      "Send your proof here. We’ll check it before connecting the domain.";
  });

  renderChoices();
  renderManagementChoices();
  setAuthMode(hostedRecoveryToken ? "recover" : "create");
  announce("Opening your account…");
  controlRoom.setAttribute("data-control-ready", "hosted");
  document.documentElement.setAttribute("data-abracadabra-control-ready", "hosted");
  control.boot().then(function () {
    if (control.getState().account) announce("Account ready.", "success");
    else announce("Guest preview is ready. Sign in only when you want to save.");
  }).catch(function (error) {
    announce(explain(error, "We couldn’t open your account. Your guest preview still works."), "error");
  });
}());
