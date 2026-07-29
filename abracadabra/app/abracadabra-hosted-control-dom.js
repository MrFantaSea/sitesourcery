(function () {
  "use strict";

  function recoveryRequestOutcome(result) {
    var source = result && typeof result === "object" ? result : {};
    if (source.delivery === "email" && source.emailSent === true) {
      return Object.freeze({
        emailSent: true,
        message: "If that account exists, a recovery email was sent.",
        supportRequired: false
      });
    }
    if (source.emailSent === false) {
      return Object.freeze({
        emailSent: false,
        message: "No recovery email was sent. Use the Contact page below for account recovery.",
        supportRequired: true
      });
    }
    return Object.freeze({
      emailSent: false,
      message:
        "We could not confirm that a recovery email was sent. "
        + "Use the Contact page below for account recovery.",
      supportRequired: true
    });
  }

  if (typeof module === "object" && module && module.exports) {
    module.exports = Object.freeze({
      recoveryRequestOutcome: recoveryRequestOutcome
    });
    return;
  }

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
  var exportPollTimer = null;
  var hostedRecoveryToken = null;
  var renderedProjectId = null;
  var lastState = control.getState();
  var domainUI = null;
  var syncHostedOffer = null;

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

  function exportIdOf(entity) {
    return text(entity && (entity.exportId || entity.id));
  }

  function projectAddress(project) {
    return project && project.address ? project.address : {};
  }

  function projectAddressBinding(project) {
    var address = projectAddress(project);
    return {
      mode: address.kind === "licensed"
        ? "licensed"
        : (
            address.kind === "custom" || address.mode === "mode_b"
              ? "customer_owned"
              : ""
          ),
      revision: text(
        address.revision != null
          ? address.revision
          : address.version != null
            ? address.version
            : address.updatedAt
      )
    };
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
    var subscriptionStatus = text(subscription.status || subscription.state).toLowerCase();
    var addressStatus = text(
      address.verificationStatus || address.state || address.status
    ).toLowerCase();
    var planReady = ["active", "current", "paid"].includes(subscriptionStatus);
    var addressReady = ["active", "configured", "connected", "ready", "verified"].includes(
      addressStatus
    );
    one("[data-selected-release-title]").textContent = selected
      ? "Version · " + text(selected.rawFacts && selected.rawFacts.businessName || idOf(selected))
      : "No accepted version selected";
    one("[data-selected-release-summary]").textContent = selected
      ? "This is the version you chose to publish."
      : "Make and review a version below, or choose a saved version.";
    one("[data-publish]").disabled = !selected
      || !planReady
      || !addressReady
      || operationPending("requestRelease");
    one("[data-unpublish]").hidden = !(project.serving && project.serving.state === "live");
    one("[data-release-copy]").textContent = !selected
      ? "Choose a saved version before publishing."
      : !planReady
        ? "Review and complete payment before publishing."
        : !addressReady
          ? "Finish and verify the address before publishing."
          : "This exact paid version and verified address are ready for a final server check.";
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

  function renderExport(state) {
    var prepareButton = one("[data-export-project]");
    var refreshButton = one("[data-refresh-export]");
    var downloadButton = one("[data-download-export]");
    var retryButton = one("[data-retry-export]");
    var stateCopy = one("[data-export-state]");
    if (
      !prepareButton
      || !refreshButton
      || !downloadButton
      || !retryButton
      || !stateCopy
    ) return;
    if (exportPollTimer != null) {
      window.clearTimeout(exportPollTimer);
      exportPollTimer = null;
    }
    var job = state.exportJob;
    var exportStatus = text(job && job.status).toLowerCase();
    prepareButton.disabled = ["queued", "working"].includes(exportStatus)
      || operationPending("requestExport");
    refreshButton.hidden = !["queued", "working", "ready"].includes(exportStatus);
    downloadButton.hidden = exportStatus !== "ready";
    retryButton.hidden = !["failed", "expired"].includes(exportStatus);
    if (!job) {
      stateCopy.textContent = "No export prepared.";
      return;
    }
    if (exportStatus === "queued") {
      stateCopy.textContent = "Export queued. The page will keep checking here.";
    } else if (exportStatus === "working") {
      stateCopy.textContent = "Building the project, website, and domain manifest archive.";
    } else if (exportStatus === "ready") {
      stateCopy.textContent = "Export ready"
        + (job.filename ? ": " + text(job.filename) : "")
        + (job.download && job.download.expiresAt
          ? " · download link expires " + new Date(job.download.expiresAt).toLocaleString()
          : "")
        + ".";
    } else if (exportStatus === "failed") {
      stateCopy.textContent = "The export could not be prepared. No project data was deleted. Try again.";
    } else if (exportStatus === "expired") {
      stateCopy.textContent = "That one-time export link is no longer usable. Prepare a new one.";
    } else {
      stateCopy.textContent = "The export status could not be verified.";
    }
    if (
      ["queued", "working"].includes(exportStatus)
      && !operationPending("getExport")
      && state.project
    ) {
      var projectId = idOf(state.project);
      var exportId = exportIdOf(job);
      exportPollTimer = window.setTimeout(function () {
        if (
          !lastState.project
          || idOf(lastState.project) !== projectId
          || exportIdOf(lastState.exportJob) !== exportId
        ) return;
        control.getExport().catch(function (error) {
          announce(explain(error, "We couldn’t refresh the export yet."), "error");
        });
      }, 2500);
    }
  }

  function render(state) {
    lastState = state;
    renderRetry(state);
    renderExport(state);
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
    if (typeof syncHostedOffer === "function") syncHostedOffer();
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

  function domainPriceCheckReady(priceCheck) {
    return Boolean(
      priceCheck
      && priceCheck.status === "ready_to_confirm"
      && priceCheck.available === true
      && priceCheck.finalPrice
      && Number.isSafeInteger(Number(priceCheck.finalPrice.amountMinor))
      && Number(priceCheck.finalPrice.amountMinor) >= 0
      && /^[A-Z]{3}$/u.test(text(priceCheck.finalPrice.currency).toUpperCase())
      && Number.isFinite(Date.parse(priceCheck.expiresAt))
      && Date.parse(priceCheck.expiresAt) > Date.now()
    );
  }

  function domainPriceCheckCopy(priceCheck) {
    if (!priceCheck) return "";
    if (priceCheck.status === "unavailable") {
      return "That domain is no longer available. No registration was submitted. Search again.";
    }
    if (priceCheck.status === "changed") {
      return "The final domain price changed. No registration was submitted. Request a new quote and approve it again.";
    }
    if (!domainPriceCheckReady(priceCheck)) {
      return "The final domain check is not usable. Check the price and availability again.";
    }
    var amount = Number(priceCheck.finalPrice.amountMinor);
    var currency = text(priceCheck.finalPrice.currency).toUpperCase();
    var price;
    try {
      price = new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency
      }).format(amount / 100);
    } catch (_error) {
      price = amount + " " + currency + " minor units";
    }
    return "Final check: available at " + price
      + " · expires " + new Date(priceCheck.expiresAt).toLocaleString() + ".";
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
    var finalCheckCopy = domainPriceCheckCopy(state.domainPriceCheck);
    domainUI.quoteState.textContent = state.domainQuote
      ? quoteCopy(state.domainQuote)
      : finalCheckCopy || quoteCopy(null);

    var quoteReady = Boolean(idOf(state.domainQuote));
    var contactReady = Boolean(idOf(state.registrantContact));
    var consentReady = Boolean(idOf(state.domainConsent));
    var orderReady = Boolean(idOf(state.domainOrder));
    var priceCheckReady = domainPriceCheckReady(state.domainPriceCheck);
    var domainQuote = state.domainQuote || {};
    var registrant = state.registrantContact || {};
    var domainTerms = domainQuote.terms && typeof domainQuote.terms === "object"
      ? domainQuote.terms
      : {};
    var domainTermsVersion = text(
      domainQuote.termsVersion || configuration.catalog.domainTermsVersion
    );
    var domainTermsReady = Boolean(
      domainTermsVersion
      && domainTerms.renewal
      && domainTerms.cancellation
      && domainTerms.ownership
      && (domainQuote.registrar || domainTerms.registrar)
    );
    var quotedMoney = domainQuote.price && typeof domainQuote.price === "object"
      ? domainQuote.price
      : {
          amountMinor: domainQuote.amountMinor,
          currency: domainQuote.currency
        };
    var quotedAmount = Number(quotedMoney.amountMinor);
    var quotedCurrency = text(quotedMoney.currency).toUpperCase();
    var quotedPrice = "Not ready";
    if (
      Number.isSafeInteger(quotedAmount)
      && quotedAmount >= 0
      && /^[A-Z]{3}$/u.test(quotedCurrency)
    ) {
      try {
        quotedPrice = new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: quotedCurrency
        }).format(quotedAmount / 100);
      } catch (_error) {
        quotedPrice = quotedAmount + " " + quotedCurrency + " minor units";
      }
    }
    var ownerAddress = [
      registrant.addressLine1,
      registrant.addressLine2,
      registrant.city,
      registrant.region,
      registrant.postalCode,
      registrant.countryCode
    ].map(text).filter(Boolean).join(", ");
    domainUI.reviewValues.hostname.textContent = text(
      domainQuote.hostname || domainQuote.domain || "Not ready"
    );
    domainUI.reviewValues.term.textContent = domainQuote.years
      ? domainQuote.years + (Number(domainQuote.years) === 1 ? " year" : " years")
      : "Not ready";
    domainUI.reviewValues.price.textContent = quotedPrice
      + (domainQuote.expiresAt
        ? " · expires " + new Date(domainQuote.expiresAt).toLocaleString()
        : "");
    domainUI.reviewValues.owner.textContent = text(
      registrant.name || registrant.legalName || "Not ready"
    ) + (registrant.organization ? " · " + text(registrant.organization) : "");
    domainUI.reviewValues.contact.textContent = [
      registrant.email,
      registrant.phone,
      ownerAddress
    ].map(text).filter(Boolean).join(" · ") || "Not ready";
    domainUI.reviewValues.terms.textContent = domainTermsReady
      ? [
          text(domainQuote.registrar || domainTerms.registrar),
          "version " + domainTermsVersion,
          text(domainTerms.renewal),
          text(domainTerms.cancellation),
          text(domainTerms.ownership)
        ].filter(Boolean).join(" · ")
      : "A complete registrar, renewal, cancellation, and ownership disclosure is required.";
    var unlockedStage = orderReady || consentReady
      ? 4
      : quoteReady && contactReady
        ? 3
        : quoteReady
          ? 2
          : 1;
    domainUI.stages.forEach(function (stage) {
      var active = Number(stage.getAttribute("data-domain-stage")) === unlockedStage;
      stage.hidden = !active;
      if (active) stage.removeAttribute("inert");
      else stage.setAttribute("inert", "");
    });
    domainUI.progress.forEach(function (item) {
      var itemStep = Number(item.getAttribute("data-domain-progress"));
      if (itemStep === unlockedStage) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      item.classList.toggle("is-complete", itemStep < unlockedStage);
    });
    domainUI.contactButton.disabled = !quoteReady;
    domainUI.consentButton.disabled = !quoteReady
      || !contactReady
      || !domainTermsReady;
    domainUI.paymentButton.disabled = !consentReady || !state.project || orderReady;
    var orderStatus = text(
      state.domainOrder && (state.domainOrder.status || state.domainOrder.state)
    ).toLowerCase();
    var orderPaid = ["paid", "payment_authorized", "authorized", "ready_for_registration"]
      .includes(orderStatus);
    domainUI.priceCheckButton.disabled = !orderPaid;
    domainUI.registerButton.disabled = !priceCheckReady
      || domainUI.irreversible.checked !== true;
    if (!priceCheckReady) domainUI.irreversible.checked = false;
    domainUI.pollButton.disabled = !orderReady;
    domainUI.resumeOrdersButton.disabled = !state.project;
    domainUI.registerBackButton.hidden = orderReady;
    domainUI.registerBackButton.disabled = orderReady;

    var order = state.domainOrder;
    domainUI.orderState.textContent = finalCheckCopy || (order
      ? "Registration · " + stateLabel(
        order.state || order.status || order.registrationState || "pending"
      )
      : "No domain order selected.");

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
      node("h4", {}, "Buy a domain without leaving Site Sourcery."),
      node(
        "p",
        {},
        "You are the owner. Finish one step to open the next."
      )
    );

    var domainProgress = node("ol", {
      class: "platform-setup-progress",
      "data-domain-progress-list": "",
      "aria-label": "Domain purchase progress"
    });
    [
      ["1", "Find"],
      ["2", "Owner"],
      ["3", "Review"],
      ["4", "Register"]
    ].forEach(function (definition) {
      var item = node("li", { "data-domain-progress": definition[0] });
      item.append(node("span", {}, definition[0]), document.createTextNode(definition[1]));
      domainProgress.appendChild(item);
    });
    panel.appendChild(domainProgress);

    var searchStage = node("div", {
      class: "platform-domain-step",
      "data-domain-stage": "1"
    });
    searchStage.append(
      node("h5", {}, "1. Find the name"),
      node("p", {}, "Search first. Availability and price are checked again before registration.")
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
    searchStage.append(searchField.label, searchActions, quoteState);
    panel.appendChild(searchStage);

    var ownerStage = node("div", {
      class: "platform-domain-step",
      "data-domain-stage": "2",
      hidden: "",
      inert: ""
    });
    var registrantHeading = node("h5", {}, "Domain owner details");
    var registrantCopy = node(
      "p",
      {},
      "2. Enter the person or business that will own the domain."
    );
    ownerStage.append(registrantHeading, registrantCopy);
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
      ownerStage.appendChild(field.label);
    });
    var ownerBackButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Change domain"
    );
    var contactButton = node("button", { type: "button", class: "spark-button spark-button-primary" }, "Save owner details");
    var ownerActions = node("div", { class: "platform-actions platform-actions-left" });
    ownerActions.append(ownerBackButton, contactButton);
    ownerStage.appendChild(ownerActions);
    panel.appendChild(ownerStage);

    var reviewStage = node("div", {
      class: "platform-domain-step",
      "data-domain-stage": "3",
      hidden: "",
      inert: ""
    });
    reviewStage.append(
      node("h5", {}, "3. Review the name, price, and owner"),
      node("p", {}, "Read each item before you continue.")
    );
    var domainTermsLink = node(
      "a",
      {
        class: "spark-button",
        href: "/legal/website-terms/#customer-domains",
        target: "_blank",
        rel: "noopener"
      },
      "Read domain terms"
    );
    var reviewFacts = node("dl", {
      class: "platform-domain-review-facts",
      "data-domain-review-facts": ""
    });
    var reviewValues = {};
    [
      ["Domain", "hostname"],
      ["Term", "term"],
      ["Price today", "price"],
      ["Registered owner", "owner"],
      ["Owner contact", "contact"],
      ["Agreement", "terms"]
    ].forEach(function (definition) {
      var row = node("div");
      var valueNode = node("dd", { "data-domain-review-value": definition[1] }, "Not ready");
      row.append(node("dt", {}, definition[0]), valueNode);
      reviewValues[definition[1]] = valueNode;
      reviewFacts.appendChild(row);
    });
    reviewStage.append(reviewFacts, domainTermsLink);
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
    autoRenewLabel.append(initialAutoRenew, node("span", {}, "Turn on automatic renewal after registration."));
    var reviewDomainButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Change domain"
    );
    var reviewOwnerButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Change owner details"
    );
    var consentButton = node("button", { type: "button", class: "spark-button spark-button-primary" }, "Approve these details");
    var reviewActions = node("div", { class: "platform-actions platform-actions-left" });
    reviewActions.append(reviewDomainButton, reviewOwnerButton, consentButton);
    reviewStage.append(agreementLabel, certificationLabel, autoRenewLabel, reviewActions);
    panel.appendChild(reviewStage);

    var registerStage = node("div", {
      class: "platform-domain-step",
      "data-domain-stage": "4",
      hidden: "",
      inert: ""
    });
    registerStage.append(
      node("h5", {}, "4. Pay and register"),
      node("p", {}, "Payment is authorized first. We check the name, price, and owner again before submitting the registration.")
    );
    var registerBackButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Change reviewed details"
    );
    var paymentButton = node("button", { type: "button", class: "spark-button" }, "Continue to domain payment");
    var priceCheckButton = node(
      "button",
      { type: "button", class: "spark-button" },
      "Check the final price"
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
    var pollButton = node("button", { type: "button", class: "spark-button" }, "Refresh progress");
    var orderState = node("p", { "data-hosted-domain-order-state": "", role: "status", "aria-live": "polite" }, "Payment has not started.");
    var purchaseActions = node("div", { class: "platform-actions platform-actions-left" });
    purchaseActions.append(
      registerBackButton,
      paymentButton,
      priceCheckButton,
      registerButton,
      resumeOrdersButton,
      pollButton
    );
    registerStage.append(
      irreversibleLabel,
      purchaseActions,
      orderState
    );
    panel.appendChild(registerStage);

    var managementDetails = node("details", {
      class: "platform-domain-management",
      "data-domain-management": ""
    });
    var managementSummary = node("summary");
    managementSummary.append(
      node("span", {}, "Already own a domain here?"),
      node("strong", {}, "Manage DNS, renewal, or transfer")
    );
    var managementBody = node("div", { class: "platform-details-body" });
    managementDetails.append(managementSummary, managementBody);
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
    managementBody.append(
      managementActions,
      managementState,
      dnsName.label,
      dnsContent.label,
      dnsTtl.label,
      domainActions,
      records
    );
    panel.appendChild(managementDetails);

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
    ownerBackButton.addEventListener("click", function () {
      run(ownerBackButton, "domainRestart", function () {
        return control.restartDomainPurchase("search");
      }, "Choose a domain and request a new price.").catch(function () {});
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
    reviewDomainButton.addEventListener("click", function () {
      run(reviewDomainButton, "domainRestart", function () {
        return control.restartDomainPurchase("search");
      }, "Choose a domain and request a new price.").catch(function () {});
    });
    reviewOwnerButton.addEventListener("click", function () {
      run(reviewOwnerButton, "domainRestart", function () {
        return control.restartDomainPurchase("owner");
      }, "Update the domain owner details.").catch(function () {});
    });
    consentButton.addEventListener("click", function () {
      run(consentButton, "domainConsent", function () {
        return control.acceptDomainConsent({
          termsVersion: text(
            lastState.domainQuote && lastState.domainQuote.termsVersion
            || configuration.catalog.domainTermsVersion
          ),
          registrationAgreementAccepted: agreement.checked,
          registrantCertificationAccepted: certification.checked,
          autoRenewRequested: initialAutoRenew.checked
        });
      }, "Domain consent recorded for this quote and registrant.").catch(function () {});
    });
    registerBackButton.addEventListener("click", function () {
      run(registerBackButton, "domainRestart", function () {
        return control.restartDomainPurchase("review");
      }, "Review the domain details again.").catch(function () {});
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
      }, null).then(function (priceCheck) {
        if (domainPriceCheckReady(priceCheck)) {
          announce(domainPriceCheckCopy(priceCheck) + " Review it, then confirm registration.", "success");
        } else {
          announce(domainPriceCheckCopy(priceCheck), "error");
        }
      }).catch(function () {});
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
      records: records,
      stages: all("[data-domain-stage]", panel),
      progress: all("[data-domain-progress]", panel),
      reviewValues: reviewValues,
      ownerBackButton: ownerBackButton,
      reviewDomainButton: reviewDomainButton,
      reviewOwnerButton: reviewOwnerButton,
      registerBackButton: registerBackButton
    };
  }

  function installHostedBillingControls() {
    var offerAnchor = one("[data-hosted-offer-anchor]");
    var actions = offerAnchor.parentElement;
    var catalog = configuration.catalog || {};
    var offers = catalog.offers || {};
    var products = catalog.products || {};
    var tenures = catalog.tenures || {};
    var offerIds = Object.keys(offers);
    var axisReady = Boolean(offerIds.length
      && Object.keys(products).length
      && Object.keys(tenures).length);
    var picker = node("div", { class: "platform-offer-picker", "data-hosted-offer-picker": "" });
    picker.append(
      node("h5", {}, "Choose the website, then choose how to keep it."),
      node(
        "p",
        {},
        "The website version and ownership plan are separate choices. A domain is priced separately."
      )
    );
    var selector = document.createElement("select");
    selector.setAttribute("data-hosted-offer", "");
    selector.setAttribute("aria-label", "Approved website offer");
    var offerState = node("p", { "data-hosted-offer-state": "", role: "status", "aria-live": "polite" });
    var productSelector = null;
    var tenureSelector = null;
    var reviewedOfferId = "";
    var offerContextKey = "";

    function appendAxisOptions(target, definitions) {
      Object.keys(definitions).forEach(function (id) {
        var option = document.createElement("option");
        option.value = id;
        option.textContent = definitions[id].label;
        target.appendChild(option);
      });
    }

    function selectedOfferId() {
      if (!axisReady) return selector.value;
      var binding = projectAddressBinding(lastState.project);
      var match = offerIds.find(function (id) {
        return offers[id].productId === productSelector.value
          && offers[id].tenureId === tenureSelector.value
          && Array.isArray(offers[id].eligibleAddressModes)
          && offers[id].eligibleAddressModes.includes(binding.mode);
      });
      return match || "";
    }

    function syncOffer(forceReset) {
      var binding = projectAddressBinding(lastState.project);
      var nextContextKey = text(lastState.project && idOf(lastState.project))
        + "|" + binding.mode + "|" + binding.revision;
      var contextChanged = nextContextKey !== offerContextKey;
      offerContextKey = nextContextKey;
      if (axisReady && productSelector && tenureSelector) {
        Array.prototype.forEach.call(tenureSelector.options, function (option) {
          option.disabled = !offerIds.some(function (id) {
            return offers[id].productId === productSelector.value
              && offers[id].tenureId === option.value
              && Array.isArray(offers[id].eligibleAddressModes)
              && offers[id].eligibleAddressModes.includes(binding.mode);
          });
        });
        if (tenureSelector.selectedOptions[0] && tenureSelector.selectedOptions[0].disabled) {
          var firstEligibleTenure = Array.prototype.find.call(
            tenureSelector.options,
            function (option) { return !option.disabled; }
          );
          if (firstEligibleTenure) tenureSelector.value = firstEligibleTenure.value;
        }
      }
      var offerId = selectedOfferId();
      selector.value = offerId;
      if (forceReset === true || contextChanged) {
        reviewedOfferId = "";
        quoteReview.hidden = true;
        quoteReview.setAttribute("inert", "");
        acceptance.checked = false;
        checkoutButton.disabled = true;
      }
      quoteButton.disabled = !offerId;
      var product = axisReady ? products[productSelector.value] : null;
      var tenure = axisReady ? tenures[tenureSelector.value] : null;
      offerState.textContent = !lastState.project
        ? "Choose a project and finish its address before reviewing a price."
        : offerId
        ? product.label + " · " + tenure.label
          + ". Review the exact price, renewal terms, ownership, and hosting before payment. "
          + "Choices that do not work with this address are disabled."
        : "No approved ownership choice works with this project address. Change the address or choose another way to keep the site.";
    }

    if (axisReady) {
      productSelector = document.createElement("select");
      productSelector.setAttribute("aria-label", "Website version");
      productSelector.setAttribute("data-hosted-product", "");
      tenureSelector = document.createElement("select");
      tenureSelector.setAttribute("aria-label", "How to keep the website");
      tenureSelector.setAttribute("data-hosted-tenure", "");
      appendAxisOptions(productSelector, products);
      appendAxisOptions(tenureSelector, tenures);
      selector.hidden = true;
      picker.append(
        node("label", { class: "spark-field" }, null),
        node("label", { class: "spark-field" }, null)
      );
      var axisLabels = all("label", picker);
      axisLabels[0].append(node("span", {}, "Website version"), productSelector);
      axisLabels[1].append(node("span", {}, "How do you want to keep it?"), tenureSelector);
      offerIds.forEach(function (id) {
        selector.appendChild(node("option", { value: id }, id));
      });
      productSelector.addEventListener("change", function () { syncOffer(true); });
      tenureSelector.addEventListener("change", function () { syncOffer(true); });
    } else {
      var held = document.createElement("option");
      held.value = "";
      held.textContent = "Online payment isn’t open yet";
      selector.appendChild(held);
      selector.disabled = true;
      picker.appendChild(selector);
    }
    picker.append(offerState);

    function moneyCopy(value) {
      var amount = Number(value && value.amountMinor);
      var currency = text(value && value.currency).toUpperCase();
      if (!Number.isSafeInteger(amount) || amount < 0 || !/^[A-Z]{3}$/u.test(currency)) {
        return "Price unavailable";
      }
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency
        }).format(amount / 100);
      } catch (_error) {
        return amount + " " + currency + " minor units";
      }
    }

    function validMoney(value) {
      return Boolean(
        value
        && Number.isSafeInteger(Number(value.amountMinor))
        && Number(value.amountMinor) >= 0
        && /^[A-Z]{3}$/u.test(text(value.currency).toUpperCase())
      );
    }

    function termCopy(label, value) {
      return value ? label + ": " + text(value) : "";
    }

    var quoteButton = node(
      "button",
      { type: "button", class: "spark-button", "data-hosted-quote": "" },
      "See exact price and terms"
    );
    quoteButton.disabled = true;
    var quoteReview = node("section", {
      class: "platform-offer-review",
      "data-hosted-quote-review": "",
      hidden: "",
      inert: "",
      "aria-labelledby": "hosted-quote-heading"
    });
    quoteReview.append(
      node("h5", { id: "hosted-quote-heading" }, "Review this exact order"),
      node(
        "p",
        {},
        "Nothing is charged on this screen. Check every price and term before secure payment opens."
      )
    );
    var quoteLines = node("div", { class: "platform-quote-lines", "data-hosted-quote-lines": "" });
    var quoteTotals = node("p", { class: "platform-quote-totals", "data-hosted-quote-totals": "" });
    var quoteExpiry = node("p", { "data-hosted-quote-expiry": "" });
    var acceptanceLabel = node("label", { class: "spark-confirmation" });
    var acceptance = node("input", {
      type: "checkbox",
      name: "hostedQuoteAccepted",
      "data-hosted-quote-accepted": ""
    });
    acceptanceLabel.append(
      acceptance,
      node(
        "span",
        {},
        "I reviewed this exact price, renewal, cancellation, ownership, hosting, and domain order."
      )
    );
    var checkoutButton = node(
      "button",
      { type: "button", class: "spark-button spark-button-primary", "data-hosted-checkout": "" },
      "Accept quote and continue to secure payment"
    );
    checkoutButton.disabled = true;
    quoteReview.append(quoteLines, quoteTotals, quoteExpiry, acceptanceLabel, checkoutButton);

    function renderQuote(quote) {
      var lines = quote && Array.isArray(quote.lineItems) ? quote.lineItems : [];
      var totals = quote && quote.totals || {};
      var recurringTotals = Array.isArray(totals.recurring) ? totals.recurring : [];
      if (
        !quote
        || !quote.quoteId
        || !quote.disclosureDigest
        || !lines.length
        || !validMoney(totals.oneTime)
        || recurringTotals.some(function (row) {
          return !validMoney(row) || !["month", "year"].includes(text(row.interval));
        })
        || !quote.expiresAt
        || !Number.isFinite(Date.parse(quote.expiresAt))
        || Date.parse(quote.expiresAt) <= Date.now()
      ) {
        throw new Error("We couldn’t verify that price.");
      }
      quoteLines.replaceChildren();
      lines.forEach(function (line) {
        var section = node("section", { class: "platform-quote-line" });
        var priceParts = [];
        if (line.oneTime) priceParts.push(moneyCopy(line.oneTime) + " once");
        if (line.recurring) {
          priceParts.push(
            moneyCopy(line.recurring) + " per " + text(line.recurring.interval || "billing period")
          );
        }
        section.append(
          node("h6", {}, text(line.label || "Order item")),
          node("p", {}, priceParts.join(" + ") || "No charge listed")
        );
        var terms = line.terms || {};
        [
          termCopy("Renewal", terms.renewal),
          termCopy("Cancellation", terms.cancellation),
          termCopy("Ownership", terms.ownership),
          termCopy("Hosting", terms.hosting)
        ].filter(Boolean).forEach(function (copy) {
          section.appendChild(node("p", {}, copy));
        });
        if (Number.isSafeInteger(terms.paymentGraceDays)) {
          section.appendChild(node("p", {}, "Payment grace: " + terms.paymentGraceDays + " days"));
        }
        if (Number.isSafeInteger(terms.retentionAndExportDays)) {
          section.appendChild(
            node("p", {}, "Export and retention: " + terms.retentionAndExportDays + " days")
          );
        }
        quoteLines.appendChild(section);
      });
      var totalParts = ["Due now: " + moneyCopy(totals.oneTime)];
      recurringTotals.forEach(function (row) {
        totalParts.push(moneyCopy(row) + " per " + text(row.interval));
      });
      quoteTotals.textContent = totalParts.join(" · ");
      quoteExpiry.textContent = quote.expiresAt
        ? "This quote expires " + new Date(quote.expiresAt).toLocaleString() + "."
        : "This quote has no verified expiry. Request a new one.";
      reviewedOfferId = text(quote.offerId);
      acceptance.checked = false;
      checkoutButton.disabled = true;
      quoteReview.hidden = false;
      quoteReview.removeAttribute("inert");
      quoteReview.focus();
    }

    quoteReview.tabIndex = -1;
    quoteButton.addEventListener("click", function () {
      var offerId = selectedOfferId();
      run(quoteButton, "commerceQuote", function () {
        return control.quoteOffer(offerId).then(function (quote) {
          renderQuote(quote);
          return quote;
        });
      }, "Exact price and terms are ready below.").catch(function () {});
    });
    acceptance.addEventListener("change", function () {
      checkoutButton.disabled = acceptance.checked !== true
        || reviewedOfferId !== selectedOfferId();
    });
    checkoutButton.addEventListener("click", function () {
      if (acceptance.checked !== true || reviewedOfferId !== selectedOfferId()) {
        announce("Review and accept the current exact quote first.", "error");
        return;
      }
      run(checkoutButton, "commerceCheckout", function () {
        return control.checkoutQuotedOffer(reviewedOfferId).then(function (result) {
          var destination = result && (
            result.url
            || result.checkoutUrl
            || result.checkout && result.checkout.url
            || result.quote && result.quote.checkout && result.quote.checkout.url
          );
          if (!destination) throw new Error("We couldn’t open payment.");
          var parsed = new URL(destination, window.location.origin);
          var trustedHost = parsed.origin === window.location.origin
            || parsed.hostname === "checkout.stripe.com";
          if (parsed.protocol !== "https:" || !trustedHost) {
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
          var trustedHost = parsed.origin === window.location.origin
            || parsed.hostname === "billing.stripe.com";
          if (parsed.protocol !== "https:" || !trustedHost) {
            throw new Error("The billing destination was not secure.");
          }
          window.location.assign(parsed.href);
          return result;
        });
      }, null).catch(function () {});
    });
    actions.prepend(picker, quoteButton, quoteReview, portalButton);
    syncHostedOffer = function () { syncOffer(false); };
    syncOffer(true);
    one("[data-billing-copy]").textContent = quoteButton.disabled
      ? "Payment is not available until prices are set."
      : "Choose both parts, review the exact order, then continue to secure payment.";
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
    }).then(function (result) {
      var outcome = recoveryRequestOutcome(result);
      one("[data-recovery-support]").hidden = !outcome.supportRequired;
      announce(outcome.message, outcome.emailSent ? "success" : "");
    }).catch(function () {});
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
  one("[data-save-address]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    var mode = value("manageAddressMode");
    var address = mode === "mode_a"
      ? { kind: "licensed", label: value("manageAddressLabel") }
      : {
          kind: "custom",
          path: value("manageDomainPath") === "purchase" ? "purchase" : "connect",
          hostname: value("manageOwnedDomain")
        };
    run(button, "selectAddress", function () {
      return control.selectAddress(address);
    }, "Address saved. Finish any required verification before publishing.").catch(function () {});
  });
  one("[data-save-access]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "setVisibility", function () {
      return control.setVisibility({
        visibility: value("manageVisibility"),
        accessPassword: value("manageAccessPassword")
      });
    }, "Access setting saved.").then(function () {
      one("[data-project-settings]").hidden = true;
    }).catch(function () {});
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
    }, "Export preparation started. Its progress is shown below.").catch(function () {});
  });
  one("[data-refresh-export]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "getExport", function () {
      return control.getExport();
    }, "Export status refreshed.").catch(function () {});
  });
  one("[data-retry-export]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "retryExport", function () {
      return control.retryExport();
    }, "A new export is being prepared.").catch(function () {});
  });
  one("[data-download-export]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "downloadExport", async function () {
      var result = await control.downloadExport();
      var objectUrl = "";
      var link = null;
      try {
        if (!result || !result.blob || typeof URL.createObjectURL !== "function") {
          throw new Error("The browser could not open the export archive.");
        }
        objectUrl = URL.createObjectURL(result.blob);
        link = document.createElement("a");
        link.href = objectUrl;
        link.download = text(result.filename || "sitesourcery-project-export.zip");
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        link = null;
        window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
        objectUrl = "";
        return result;
      } catch (_error) {
        throw new Error("The download did not start. Prepare a new one-time export and try again.");
      } finally {
        if (link) link.remove();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }, "Download started. Check your Downloads folder.").catch(function () {});
  });

  one("[data-cancel-project]").addEventListener("click", function (event) {
    var button = event.currentTarget;
    run(button, "cancellationPreview", function () {
      return control.previewCancellation();
    }, null).then(function (preview) {
      if (!preview) return null;
      var effective = new Date(preview.effectiveAt).toLocaleString();
      var retention = new Date(preview.retentionEndsAt).toLocaleString();
      var confirmed = window.confirm(
        "Review cancellation\n\n"
        + "Service ends: " + effective + "\n"
        + "Export and retained project access end: " + retention + "\n\n"
        + "No change has been made yet. Confirm cancellation?"
      );
      if (!confirmed) {
        announce("Cancellation was not submitted.", "success");
        return null;
      }
      return run(button, "cancelSubscription", function () {
        return control.cancelSubscription();
      }, "Cancellation confirmed. The exact dates remain in your account.");
    }).catch(function () {});
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
