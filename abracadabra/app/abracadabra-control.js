(function () {
  "use strict";

  var platformModule = window.SiteSourceryAbracadabraPlatform;
  var maker = window.SiteSourceryAbracadabraMaker;
  var modeModule = window.SiteSourceryAbracadabraControlMode;
  var controlConfiguration = modeModule
    ? modeModule.resolve(document)
    : { held: true, localRehearsal: false };
  var status = document.getElementById("platform-status");
  var auth = document.getElementById("platform-auth");
  var dashboard = document.getElementById("platform-dashboard");
  var workroom = document.getElementById("workroom");
  var controlRoom = document.getElementById("control-room");
  if (!platformModule || !maker || !status || !auth || !dashboard || !workroom || !controlRoom) {
    if (status) status.textContent = "The control room could not open. Reload the page to try again.";
    return;
  }
  if (!controlConfiguration.localRehearsal) return;

  // Keep reading, keyboard, and rendered order aligned with the guest-first journey.
  workroom.after(controlRoom);

  var platform;
  try {
    // OWNER RULING (2026-08-01): work does not persist without an account.
    // sessionStorage survives a refresh inside the tab and dies with it -
    // no silent cross-visit memory of anyone's business details.
    platform = platformModule.createPlatform({ storage: window.sessionStorage });
  } catch (_error) {
    status.textContent = "Saved projects are blocked in this browser. Allow local site data, then reload.";
    status.classList.add("is-error");
    return;
  }

  var state = {
    account: null,
    project: null,
    selectedVersionId: null,
    recoveryMessage: null,
    pendingGuestCandidate: null,
    draftTimers: Object.create(null)
  };

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function reducedMotionRequested() {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function scrollToElement(element) {
    element.scrollIntoView({
      behavior: reducedMotionRequested() ? "auto" : "smooth",
      block: "start"
    });
  }

  function focusAndScroll(element) {
    element.focus({ preventScroll: true });
    scrollToElement(element);
  }

  function value(name) {
    var control = one('[name="' + name + '"]');
    return control ? control.value : "";
  }

  function checked(name) {
    var control = one('[name="' + name + '"]:checked');
    return control ? control.value : "";
  }

  function resetProjectScopedTransients() {
    one("[data-project-settings]").hidden = true;
    [
      "manageAddressLabel",
      "manageOwnedDomain",
      "manageDomainProofReference",
      "manageAccessPassword",
      "supportSubject",
      "supportMessage",
      "safetyAppeal"
    ].forEach(function (name) {
      var control = one('[name="' + name + '"]');
      if (control) control.value = "";
    });
    ["manageAddressMode", "manageDomainPath", "manageDomainProofMethod", "manageVisibility"]
      .forEach(function (name) {
        var control = one('[name="' + name + '"]');
        if (control) control.selectedIndex = 0;
      });
    renderManagementChoices();
  }

  function hydrateProjectScopedFields(project) {
    if (!project) return;
    one('[name="manageAddressMode"]').value = project.address.mode;
    one('[name="manageAddressLabel"]').value = project.address.label || "";
    one('[name="manageDomainPath"]').value = project.address.path === "licensed"
      ? "purchase"
      : project.address.path;
    one('[name="manageOwnedDomain"]').value = project.address.domain || "";
    one('[name="manageVisibility"]').value = project.access.visibility;
    one('[name="manageAccessPassword"]').value = "";
    one('[name="manageDomainProofReference"]').value = "";
    one('[name="supportSubject"]').value = "";
    one('[name="supportMessage"]').value = "";
    one('[name="safetyAppeal"]').value = "";
    renderManagementChoices();
  }

  function setProjectContext(project) {
    var currentId = state.project ? state.project.id : "";
    var nextId = project ? project.id : "";
    var changed = currentId !== nextId;
    if (changed) {
      resetProjectScopedTransients();
      state.selectedVersionId = null;
    }
    state.project = project || null;
    if (changed && project) hydrateProjectScopedFields(project);
    return changed;
  }

  function captureProjectContext() {
    if (!state.account || !state.project) return null;
    return Object.freeze({
      accountId: state.account.id,
      projectId: state.project.id
    });
  }

  function requireProjectContext(context) {
    if (
      !context
      || !state.account
      || !state.project
      || state.account.id !== context.accountId
      || state.project.id !== context.projectId
    ) {
      throw new Error(
        "The selected project changed before this action finished. Review the newly selected project and try again."
      );
    }
    return context;
  }

  function announce(message, kind) {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function explain(error, fallback) {
    return error && typeof error.message === "string" ? error.message : fallback;
  }

  function setSession() {
    try {
      window.sessionStorage.removeItem("sitesourcery.abracadabra.account-session.v1");
    } catch (_error) {
      // Sign-in remains page-scoped if session storage is blocked.
    }
  }

  function readSession() {
    return "";
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
    scrollToElement(controlRoom);
  }

  function showAuth(mode) {
    state.account = null;
    setProjectContext(null);
    dashboard.hidden = true;
    auth.hidden = false;
    workroom.hidden = false;
    setAuthMode(mode || "create");
    announce(
      state.pendingGuestCandidate
        ? "Your reviewed preview is ready to carry into the first saved project."
        : "Preview above first. Create an account here only when you want to save a project."
    );
  }

  function signInto(account) {
    state.account = account;
    setProjectContext(null);
    setSession();
    auth.hidden = true;
    dashboard.hidden = false;
    one("[data-account-name]").textContent = account.name;
    one("[data-account-email]").textContent = account.email;
    var organizations = platform.listOrganizations({ accountId: account.id });
    one("[data-organization-name]").textContent = organizations[0] ? organizations[0].name : "Organization";
    renderProjectList();
    announce("Signed in. Choose a project or create a new one.", "success");
  }

  function projectLabel(project) {
    if (project.lifecycle === "deleted") return "Deleted";
    if (project.safety && project.safety.state === "appeal_pending") return "Safety review";
    if (project.safety && project.safety.state === "held") return "Safety hold";
    if (project.lifecycle === "cancelled") return "Retained";
    if (project.billing.state === "suspended") return "Suspended";
    if (project.billing.state === "grace") return "Live grace";
    if (project.serving.state === "live") return "Live";
    return "Draft";
  }

  function renderProjectList() {
    var list = one("[data-project-list]");
    list.replaceChildren();
    var projects = platform.listProjects({ accountId: state.account.id });
    projects.forEach(function (project) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      var name = document.createElement("strong");
      var detail = document.createElement("span");
      button.type = "button";
      button.className = "platform-project-button";
      button.dataset.projectId = project.id;
      if (state.project && state.project.id === project.id) button.setAttribute("aria-current", "true");
      name.textContent = project.lifecycle === "deleted" ? "Deleted project" : project.name;
      detail.textContent = projectLabel(project);
      button.append(name, detail);
      button.addEventListener("click", function () { openProject(project.id); });
      item.appendChild(button);
      list.appendChild(item);
    });
    one("[data-project-empty]").hidden = projects.length !== 0;
  }

  function acceptedVersions(project) {
    return project.versions.filter(function (version) {
      return version.candidateState === "accepted_release";
    });
  }

  function addressCopy(project) {
    if (!project.address) return "No address selected";
    if (project.address.mode === "mode_a") {
      return project.address.hostname + " · monthly licensed address";
    }
    if (project.address.state === "detached") {
      return project.address.domain + " · customer-owned · detached from this project";
    }
    var path = project.address.path === "purchase"
      ? (
        project.address.state === "configured"
          ? "customer-owned · registrar proof reviewed"
          : "customer-owned · purchase pending"
      )
      : (
        project.address.state === "configured"
          ? "customer-owned · connected"
          : "customer-owned · connection pending"
      );
    return project.address.hostname + " · " + path;
  }

  function stateTitle(valueToFormat) {
    return String(valueToFormat || "")
      .replace(/_/gu, " ")
      .replace(/\b\w/gu, function (letter) { return letter.toUpperCase(); });
  }

  function versionNumber(project, version) {
    return project.versions.findIndex(function (item) { return item.id === version.id; }) + 1;
  }

  function versionTheme(version) {
    return stateTitle(version.rawFacts && version.rawFacts.theme || "clear");
  }

  function versionBusinessName(version) {
    return String(version.rawFacts && version.rawFacts.businessName || "Website");
  }

  function versionSummary(version) {
    var summary = String(version.rawFacts && version.rawFacts.summary || "");
    return summary.length > 72 ? summary.slice(0, 71).trimEnd() + "…" : summary;
  }

  function versionIdentity(project, version) {
    return "Version " + versionNumber(project, version) + " · "
      + versionTheme(version) + " · " + versionBusinessName(version);
  }

  function renderReleaseList(project) {
    var list = one("[data-release-list]");
    list.replaceChildren();
    var versions = acceptedVersions(project).slice().reverse();
    if (!versions.length) {
      var empty = document.createElement("li");
      empty.textContent = "No accepted versions yet.";
      list.appendChild(empty);
      return;
    }
    versions.forEach(function (version) {
      var item = document.createElement("li");
      var copy = document.createElement("div");
      var title = document.createElement("strong");
      var summary = document.createElement("span");
      var stateCopy = document.createElement("small");
      var button = document.createElement("button");
      var current = project.serving.currentVersionId === version.id;
      var selected = state.selectedVersionId === version.id;
      title.textContent = versionIdentity(project, version);
      summary.textContent = versionSummary(version);
      stateCopy.textContent = current && project.serving.state === "live"
        ? "Published now"
        : "Accepted " + new Date(version.createdAt).toLocaleString();
      copy.append(title, summary, stateCopy);
      button.type = "button";
      button.className = "spark-button";
      button.textContent = selected ? "Selected in preview" : "Review this version";
      button.disabled = selected;
      if (selected) item.setAttribute("data-selected", "true");
      button.addEventListener("click", function () {
        if (!maker.selectPlatformVersion(version.id)) {
          announce("That accepted version could not be restored in the maker.", "error");
          return;
        }
        state.selectedVersionId = version.id;
        renderProject();
        announce(versionIdentity(project, version) + " selected. Verify its preview before publishing.", "success");
        focusAndScroll(workroom);
      });
      item.append(copy, button);
      list.appendChild(item);
    });
  }

  function renderTickets(project) {
    var list = one("[data-ticket-list]");
    list.replaceChildren();
    if (project.lifecycle === "deleted") return;
    platform.listSupportTickets({
      accountId: state.account.id,
      projectId: project.id
    }).slice().reverse().forEach(function (ticket) {
      var item = document.createElement("li");
      var subject = document.createElement("strong");
      var detail = document.createElement("span");
      subject.textContent = ticket.subject;
      detail.textContent = stateTitle(ticket.state) + " · " + new Date(ticket.createdAt).toLocaleString();
      item.append(subject, detail);
      list.appendChild(item);
    });
  }

  function renderDomainReview(project) {
    var panel = one("[data-domain-review-status]");
    var isCustomerDomain = project.address && project.address.mode === "mode_b";
    panel.hidden = !isCustomerDomain;
    if (!isCustomerDomain) return;
    var requests = Array.isArray(project.address.verificationRequests)
      ? project.address.verificationRequests
      : [];
    var latest = requests[requests.length - 1] || null;
    var verification = project.address.verification;
    one("[data-domain-review-title]").textContent = project.address.domain || "Customer-owned domain";
    if (project.lifecycle === "deleted") {
      one("[data-domain-review-state]").textContent = "Detached · ownership retained";
      one("[data-domain-review-receipt]").textContent = "Removed at project deletion";
      one("[data-domain-review-proof]").textContent = "Proof reference removed";
      one("[data-domain-review-time]").textContent = project.address.detachedAt
        ? new Date(project.address.detachedAt).toLocaleString()
        : "Detached";
      one("[data-domain-review-copy]").textContent = "The customer-owned domain name remains as an ownership fact. "
        + "Its serving hostname and saved proof references were removed from this device.";
      return;
    }
    one("[data-domain-review-state]").textContent = verification
      ? "Reviewed and configured"
      : latest
        ? "Handoff saved locally"
        : "Proof handoff required";
    one("[data-domain-review-receipt]").textContent = verification && verification.requestId
      ? verification.requestId
      : latest
        ? latest.id
        : "None saved";
    one("[data-domain-review-proof]").textContent = verification
      ? stateTitle(verification.method) + " · " + verification.reference
      : latest
        ? stateTitle(latest.method) + " · " + latest.reference
        : "Not supplied";
    one("[data-domain-review-time]").textContent = verification
      ? new Date(verification.verifiedAt).toLocaleString()
      : latest
        ? new Date(latest.requestedAt).toLocaleString()
        : "Not saved";
    one("[data-domain-review-copy]").textContent = verification
      ? "A separate domain reviewer approved this exact proof reference. The address is configured."
      : latest
        ? "This private build saved the handoff receipt for export. No reviewer was contacted and the address remains pending."
        : "Prepare the proof handoff below before a separate domain reviewer can configure this address.";
  }

  function renderProject() {
    if (!state.project) return;
    var project = platform.getProject({
      accountId: state.account.id,
      projectId: state.project.id
    });
    setProjectContext(project);
    var deleted = project.lifecycle === "deleted";
    var active = project.lifecycle === "active";
    var accepted = acceptedVersions(project);
    var latest = accepted[accepted.length - 1] || null;
    var makerVersion = maker.getCurrentVersion();
    var makerVersionId = makerVersion && makerVersion.platformVersionId
      ? makerVersion.platformVersionId
      : null;
    var selected = accepted.find(function (version) {
      return version.id === makerVersionId;
    }) || accepted.find(function (version) {
      return version.id === state.selectedVersionId;
    }) || null;
    state.selectedVersionId = selected ? selected.id : null;
    var canPublish = active
      && project.safety.state === "clear"
      && project.plan.status === "active"
      && project.address.state === "configured"
      && ["current", "grace"].includes(project.billing.state)
      && Boolean(selected);

    one("[data-project-name]").textContent = deleted ? "Deleted project" : project.name;
    one("[data-project-address]").textContent = deleted
      ? "The saved content has been removed."
      : addressCopy(project);
    one("[data-plan-state]").textContent = stateTitle(project.plan.status);
    one("[data-address-state]").textContent = stateTitle(project.address.state);
    one("[data-visibility-state]").textContent = stateTitle(project.access.visibility);
    one("[data-serving-state]").textContent = projectLabel(project);
    renderDomainReview(project);

    var settingsPanel = one("[data-project-settings]");
    one("[data-toggle-settings]").hidden = deleted;
    if (deleted) {
      resetProjectScopedTransients();
    } else if (settingsPanel.hidden) {
      hydrateProjectScopedFields(project);
    }

    var openSite = one("[data-open-site]");
    openSite.href = "/abracadabra/site/?project=" + encodeURIComponent(project.id);
    openSite.hidden = deleted || project.serving.state !== "live";

    var activatePlan = one("[data-activate-plan]");
    activatePlan.hidden = !active || project.plan.status === "active";
    var publishButton = one("[data-publish]");
    var selectedIsLive = Boolean(
      selected
      && project.serving.state === "live"
      && project.serving.currentVersionId === selected.id
    );
    publishButton.disabled = !canPublish || selectedIsLive;
    publishButton.hidden = !active;
    var selectedTitle = one("[data-selected-release-title]");
    var selectedSummary = one("[data-selected-release-summary]");
    if (selected) {
      selectedTitle.textContent = versionIdentity(project, selected);
      selectedSummary.textContent = versionSummary(selected)
        + (selectedIsLive ? " · This exact version is published now." : " · Accepted and ready for release.");
      var currentIndex = project.versions.findIndex(function (version) {
        return version.id === project.serving.currentVersionId;
      });
      var selectedIndex = project.versions.findIndex(function (version) {
        return version.id === selected.id;
      });
      publishButton.textContent = selectedIsLive
        ? "Selected version is published"
        : (
          currentIndex > selectedIndex && project.serving.currentVersionId
            ? "Roll back to Version " + versionNumber(project, selected)
            : "Publish Version " + versionNumber(project, selected)
        );
    } else {
      selectedTitle.textContent = "No accepted version selected";
      selectedSummary.textContent = "Make and review a version below, or choose one from the release history.";
      publishButton.textContent = "Publish this version";
    }
    var unpublish = one("[data-unpublish]");
    unpublish.hidden = !active || project.serving.state !== "live";

    var releaseCopy = one("[data-release-copy]");
    if (!latest) {
      releaseCopy.textContent = "Make and review a version in the builder below.";
    } else if (!selected) {
      releaseCopy.textContent = "Choose a reviewed version before publishing.";
    } else if (!canPublish) {
      releaseCopy.textContent = versionIdentity(project, selected)
        + " is selected. Finish the plan and address steps to publish it.";
    } else {
      releaseCopy.textContent = versionIdentity(project, selected)
        + " is selected. The current live version stays in your history.";
    }

    var failure = one("[data-payment-failure]");
    failure.hidden = !active || project.plan.status !== "active" || project.billing.state !== "current";
    one("[data-advance-suspension]").hidden = project.billing.state !== "grace";
    one("[data-advance-deletion]").hidden = !["suspended", "retention"].includes(project.billing.state);
    one("[data-cancel-project]").hidden = !active;
    one("[data-delete-project]").hidden = deleted;
    one("[data-export-project]").hidden = deleted;
    one("[data-detach-domain]").hidden = deleted
      || project.address.mode !== "mode_b"
      || project.address.ownership !== "customer"
      || project.address.state === "detached";

    var billingCopy = one("[data-billing-copy]");
    if (project.billing.state === "grace") {
      billingCopy.textContent = "The site remains live through "
        + new Date(project.billing.graceEndsAt).toLocaleString()
        + ". Suspension begins when that 14-day grace period ends.";
    } else if (project.billing.state === "suspended" || project.billing.state === "retention") {
      billingCopy.textContent = "Serving is paused. The project and export are retained through "
        + new Date(project.billing.retentionEndsAt).toLocaleString()
        + ". Restoration requires a separately verified billing event.";
    } else if (project.billing.state === "deleted") {
      billingCopy.textContent = "The project reached terminal deletion. Its former release cannot be restored.";
    } else {
      billingCopy.textContent = "Service is current. A simulated failure starts 14 live grace days; day 15 pauses serving and starts 90 retained days.";
    }

    var safetyCopy = one("[data-safety-copy]");
    one("[data-safety-panel]").hidden = deleted
      || !["held", "appeal_pending"].includes(project.safety.state);
    if (deleted) {
      safetyCopy.textContent = "Safety review closed with the project. Its hold and appeal text were removed; only the text-free event timeline remains.";
    } else if (project.safety.state === "held") {
      safetyCopy.textContent = "Serving is paused for review. Reason: " + project.safety.reason;
    } else if (project.safety.state === "appeal_pending") {
      safetyCopy.textContent = "The appeal is attached to this hold for human review. Serving remains paused until the review is completed.";
    } else if (project.safety.restoredAt) {
      safetyCopy.textContent = "The previous hold was reviewed and cleared at "
        + new Date(project.safety.restoredAt).toLocaleString() + ".";
    } else {
      safetyCopy.textContent = "No safety hold is active. Holds preserve the project and release while serving is paused for human review.";
    }
    one("[data-safety-appeal-field]").hidden = deleted || project.safety.state !== "held";
    one("[data-submit-safety-appeal]").hidden = deleted || project.safety.state !== "held";
    one("[data-create-ticket]").hidden = deleted;

    renderReleaseList(project);
    renderTickets(project);
    renderProjectList();
    one("[data-active-project]").hidden = false;
    one("[data-project-empty]").hidden = true;
    one("[data-project-creator]").hidden = true;
    workroom.hidden = deleted;
  }

  function openProject(projectId) {
    var project = platform.getProject({
      accountId: state.account.id,
      projectId: projectId
    });
    if (project.lifecycle === "active" && !maker.loadProject(project)) {
      announce("The saved project could not be loaded into the maker. No project state was changed.", "error");
      return;
    }
    setProjectContext(project);
    renderProject();
    announce((project.lifecycle === "deleted" ? "Deleted project" : project.name) + " opened.", "success");
    focusAndScroll(one("[data-active-project]"));
  }

  function openProjectCreator() {
    one("[data-project-empty]").hidden = true;
    one("[data-active-project]").hidden = true;
    one("[data-project-creator]").hidden = false;
    one('[name="projectName"]').focus();
  }

  function closeProjectCreator() {
    one("[data-project-creator]").hidden = true;
    one("[data-active-project]").hidden = !state.project;
    one("[data-project-empty]").hidden = Boolean(state.project)
      || platform.listProjects({ accountId: state.account.id }).length !== 0;
  }

  function renderProjectChoices() {
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

  function createProject() {
    var mode = checked("addressMode");
    var address = mode === "mode_a"
      ? { mode: "mode_a", label: value("addressLabel") }
      : { mode: "mode_b", path: checked("domainPath"), domain: value("ownedDomain") };
    try {
      var project = platform.createProject({
        accountId: state.account.id,
        name: value("projectName"),
        address: address,
        visibility: checked("visibility"),
        accessPassword: value("accessPassword"),
        acceptedTerms: Boolean(one('[name="projectTermsAccepted"]').checked)
      });
      one('[name="projectTermsAccepted"]').checked = false;
      setProjectContext(project);
      if (state.pendingGuestCandidate) {
        var adopted = acceptMadeVersion(state.pendingGuestCandidate);
        if (adopted) {
          state.pendingGuestCandidate = null;
          announce(
            "Project created and the reviewed guest preview was carried into it. Choose the release controls when you are ready.",
            "success"
          );
        } else {
          renderProject();
          announce(
            "The project was created, but its guest preview was not saved. The preview remains open below so you can make it again.",
            "error"
          );
        }
        if (!adopted) focusAndScroll(workroom);
        return;
      }
      if (!maker.loadProject(project)) {
        platform.deleteProject({ accountId: state.account.id, projectId: project.id });
        setProjectContext(null);
        renderProjectList();
        throw new Error("The maker could not open the new project. The empty project was removed.");
      }
      renderProject();
      announce("Project created. Build the page below, then return here to publish it.", "success");
      focusAndScroll(workroom);
    } catch (error) {
      announce(explain(error, "The project could not be created."), "error");
    }
  }

  function saveDraft(raw) {
    if (!state.account || !state.project || state.project.lifecycle !== "active") return;
    var accountId = state.account.id;
    var projectId = state.project.id;
    window.clearTimeout(state.draftTimers[projectId]);
    state.draftTimers[projectId] = window.setTimeout(function () {
      delete state.draftTimers[projectId];
      try {
        platform.saveDraft({
          accountId: accountId,
          projectId: projectId,
          rawFacts: raw
        });
        if (
          state.account
          && state.account.id === accountId
          && state.project
          && state.project.id === projectId
        ) {
          state.project = platform.getProject({
            accountId: accountId,
            projectId: projectId
          });
        }
      } catch (_error) {
        announce("This draft could not be saved. Your work remains in the open maker.", "error");
      }
    }, 350);
  }

  function acceptMadeVersion(detail) {
    if (!state.account || !state.project || state.project.lifecycle !== "active") return false;
    var context = captureProjectContext();
    try {
      requireProjectContext(context);
      var version = platform.saveVersion({
        accountId: context.accountId,
        projectId: context.projectId,
        rawFacts: detail.raw,
        releaseAttestation: detail.reviewAttested === true,
        artifact: {
          html: detail.result.html,
          digest: detail.result.artifactDigest
        }
      });
      if (version.candidateState === "draft") {
        requireProjectContext(context);
        version = platform.markVersionReady({
          accountId: context.accountId,
          projectId: context.projectId,
          versionId: version.id
        });
      }
      if (version.candidateState === "ready") {
        requireProjectContext(context);
        version = platform.acceptVersion({
          accountId: context.accountId,
          projectId: context.projectId,
          versionId: version.id
        });
      }
      requireProjectContext(context);
      /*
       * Mark the exact version this acceptance began from. Even here the
       * platform calls above sit between the make and the mark, so binding to
       * the current selection could stamp a version the customer made in the
       * meantime.
       */
      var originDigest = detail && detail.result && detail.result.artifactDigest
        ? String(detail.result.artifactDigest)
        : "";
      var savedId = version && version.id != null ? String(version.id) : "";
      if (!originDigest || savedId.trim() === "") {
        announce("That version could not be saved.", "error");
        return false;
      }
      if (!maker.markPlatformVersion(originDigest, savedId)) {
        announce("That preview is no longer open, so it was not marked saved.", "error");
        return false;
      }
      renderProject();
      announce("Reviewed version saved and accepted. It is ready for the release controls.", "success");
      focusAndScroll(one("[data-active-project]"));
      return true;
    } catch (error) {
      announce(explain(error, "The reviewed version could not be saved."), "error");
      return false;
    }
  }

  function publishVersion(versionId, context) {
    if (!context) return;
    try {
      requireProjectContext(context);
      var project = platform.getProject({
        accountId: context.accountId,
        projectId: context.projectId
      });
      var accepted = acceptedVersions(project);
      var target = accepted.find(function (version) {
        return version.id === versionId;
      });
      if (!target) {
        announce("Choose the exact accepted website version before publishing.", "error");
        return;
      }
      requireProjectContext(context);
      platform.publish({
        accountId: context.accountId,
        projectId: context.projectId,
        versionId: target.id
      });
      renderProject();
      announce(versionIdentity(project, target) + " published locally. Open the site to verify the exact release.", "success");
    } catch (error) {
      announce(explain(error, "The accepted version could not be published."), "error");
    }
  }

  function downloadJson(valueToDownload, filename) {
    var blob = new Blob([JSON.stringify(valueToDownload, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

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

  one("[data-create-account]").addEventListener("click", function () {
    try {
      var account = platform.createAccount({
        name: value("accountName"),
        organizationName: value("organizationName"),
        email: value("accountEmail"),
        password: value("accountPassword")
      });
      signInto(account);
      announce("Account created. Start the first website project.", "success");
      openProjectCreator();
    } catch (error) {
      announce(explain(error, "The account could not be created."), "error");
    }
  });

  one("[data-sign-in]").addEventListener("click", function () {
    try {
      signInto(platform.signIn({
        email: value("signInEmail"),
        password: value("signInPassword")
      }));
    } catch (error) {
      announce(explain(error, "Sign-in failed."), "error");
    }
  });

  one("[data-request-recovery]").addEventListener("click", function () {
    try {
      var result = platform.requestRecovery({ email: value("recoveryEmail") });
      try {
        state.recoveryMessage = platform.readLocalMail({
          email: value("recoveryEmail"),
          requestId: result.requestId
        });
      } catch (_mailError) {
        state.recoveryMessage = null;
        one("[data-recovery-message]").hidden = true;
        announce("If that account exists, a recovery message is now in the local mail sink.");
        return;
      }
      one("[data-recovery-token]").textContent = state.recoveryMessage.recoveryToken;
      one("[data-recovery-message]").hidden = false;
      announce("Recovery message opened from the local mail sink.", "success");
    } catch (error) {
      announce(explain(error, "Recovery could not be started."), "error");
    }
  });

  one("[data-reset-password]").addEventListener("click", function () {
    if (!state.recoveryMessage) return;
    try {
      platform.resetPassword({
        token: state.recoveryMessage.recoveryToken,
        password: value("recoveryPassword")
      });
      one('[name="signInEmail"]').value = value("recoveryEmail");
      one('[name="signInPassword"]').value = "";
      state.recoveryMessage = null;
      one("[data-recovery-message]").hidden = true;
      setAuthMode("sign-in");
      announce("Password reset. Sign in with the new password.", "success");
    } catch (error) {
      announce(explain(error, "The password could not be reset."), "error");
    }
  });

  one("[data-sign-out]").addEventListener("click", function () {
    setSession("");
    showAuth("sign-in");
    announce("Signed out. Your projects remain saved in this browser.", "success");
  });

  all("[data-new-project]").forEach(function (button) {
    button.addEventListener("click", openProjectCreator);
  });
  one("[data-cancel-project-create]").addEventListener("click", closeProjectCreator);
  one("[data-create-project]").addEventListener("click", createProject);
  all('[name="addressMode"],[name="visibility"]').forEach(function (control) {
    control.addEventListener("change", renderProjectChoices);
  });
  one("[data-toggle-settings]").addEventListener("click", function () {
    var panel = one("[data-project-settings]");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) one('[name="manageAddressMode"]').focus();
  });
  one('[name="manageAddressMode"]').addEventListener("change", renderManagementChoices);
  one('[name="manageVisibility"]').addEventListener("change", renderManagementChoices);
  one("[data-save-address]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      var mode = value("manageAddressMode");
      var address = mode === "mode_a"
        ? { mode: "mode_a", label: value("manageAddressLabel") }
        : {
            mode: "mode_b",
            path: value("manageDomainPath"),
            domain: value("manageOwnedDomain")
          };
      var currentAddress = state.project.address;
      var addressChanged = mode !== currentAddress.mode
        || (mode === "mode_a" && value("manageAddressLabel") !== currentAddress.label)
        || (
          mode === "mode_b"
          && (
            value("manageDomainPath") !== currentAddress.path
            || value("manageOwnedDomain").trim().toLowerCase() !== currentAddress.domain
          )
        );
      if (addressChanged) {
        requireProjectContext(context);
        platform.setAddress({
          accountId: context.accountId,
          projectId: context.projectId,
          address: address
        });
      }
      renderProject();
      announce(
        addressChanged
          ? "Address saved. Complete any connection step before publishing again."
          : "The address is already saved.",
        "success"
      );
    } catch (error) {
      announce(explain(error, "The address could not be saved."), "error");
    }
  });
  one("[data-save-access]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      var visibility = value("manageVisibility");
      var passphrase = value("manageAccessPassword");
      var visibilityChanged = visibility !== state.project.access.visibility;
      if (visibilityChanged || passphrase) {
        if (visibility === "private" && !passphrase) {
          throw new Error("Enter a new site passphrase when switching this project to private.");
        }
        requireProjectContext(context);
        platform.setVisibility({
          accountId: context.accountId,
          projectId: context.projectId,
          visibility: visibility,
          accessPassword: passphrase
        });
      }
      one("[data-project-settings]").hidden = true;
      renderProject();
      announce("Access setting saved.", "success");
    } catch (error) {
      announce(explain(error, "The access setting could not be saved."), "error");
    }
  });

  one("[data-activate-plan]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      platform.activatePlan({
        accountId: context.accountId,
        projectId: context.projectId,
        localRehearsalAcknowledged: true
      });
      renderProject();
      announce(
        "Plan activated only in this non-transactional local rehearsal. No charge, subscription, receipt, or provider event was created.",
        "success"
      );
    } catch (error) {
      announce(explain(error, "The local plan could not be activated."), "error");
    }
  });

  one("[data-request-domain-review]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!state.project || !state.project.address || state.project.address.mode !== "mode_b") {
      announce("Save the customer-owned domain choice before preparing its proof handoff.", "error");
      return;
    }
    var visiblePath = value("manageDomainPath");
    var visibleDomain = value("manageOwnedDomain").trim().toLowerCase();
    if (
      visiblePath !== state.project.address.path
      || visibleDomain !== state.project.address.domain
    ) {
      announce("Save the changed customer-owned domain before preparing proof for it.", "error");
      return;
    }
    try {
      requireProjectContext(context);
      var receipt = platform.requestAddressVerification({
        accountId: context.accountId,
        projectId: context.projectId,
        method: value("manageDomainProofMethod"),
        reference: value("manageDomainProofReference")
      });
      one('[name="manageDomainProofReference"]').value = "";
      renderProject();
      announce(
        "Domain-review handoff " + receipt.id
          + " saved locally. No reviewer was contacted and the address remains pending.",
        "success"
      );
    } catch (error) {
      announce(explain(error, "The domain-review handoff could not be saved."), "error");
    }
  });

  one("[data-publish]").addEventListener("click", function () {
    var context = captureProjectContext();
    var versionId = state.selectedVersionId;
    publishVersion(versionId, context);
  });
  one("[data-unpublish]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      platform.unpublish({ accountId: context.accountId, projectId: context.projectId });
      renderProject();
      announce("Publication paused. The accepted release remains available.", "success");
    } catch (error) {
      announce(explain(error, "Publication could not be paused."), "error");
    }
  });

  one("[data-payment-failure]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      platform.recordPaymentFailure({ accountId: context.accountId, projectId: context.projectId });
      renderProject();
      announce("Missed payment recorded. The website remains live for 14 grace days.", "success");
    } catch (error) {
      announce(explain(error, "The billing rehearsal could not start."), "error");
    }
  });

  one("[data-advance-suspension]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    var graceEndsAt = state.project.billing.graceEndsAt;
    try {
      requireProjectContext(context);
      platform.advanceBilling({
        accountId: context.accountId,
        projectId: context.projectId,
        at: graceEndsAt
      });
      renderProject();
      announce("Day 15 reached. Serving is suspended and 90-day retention has begun.", "success");
    } catch (error) {
      announce(explain(error, "The suspension rehearsal could not advance."), "error");
    }
  });

  one("[data-advance-deletion]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    var retentionEndsAt = state.project.billing.retentionEndsAt;
    if (!window.confirm("Complete the retention clock and delete this project’s saved content?")) return;
    try {
      requireProjectContext(context);
      platform.advanceBilling({
        accountId: context.accountId,
        projectId: context.projectId,
        at: retentionEndsAt
      });
      renderProject();
      announce("Retention ended. Project content reached terminal deletion.", "success");
    } catch (error) {
      announce(explain(error, "The retention rehearsal could not advance."), "error");
    }
  });

  one("[data-submit-safety-appeal]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    var message = value("safetyAppeal");
    try {
      requireProjectContext(context);
      platform.submitSafetyAppeal({
        accountId: context.accountId,
        projectId: context.projectId,
        message: message
      });
      renderProject();
      announce("Appeal attached to the hold for review.", "success");
    } catch (error) {
      announce(explain(error, "The appeal could not be submitted."), "error");
    }
  });

  one("[data-create-ticket]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    var subject = value("supportSubject");
    var message = value("supportMessage");
    try {
      requireProjectContext(context);
      platform.createSupportTicket({
        accountId: context.accountId,
        projectId: context.projectId,
        subject: subject,
        message: message
      });
      one('[name="supportSubject"]').value = "";
      one('[name="supportMessage"]').value = "";
      renderProject();
      announce("Local support note saved with this project. No person was contacted.", "success");
    } catch (error) {
      announce(explain(error, "The local support note could not be saved."), "error");
    }
  });

  window.addEventListener("abracadabra:versionselected", function (event) {
    if (!state.project || !event.detail) return;
    state.selectedVersionId = event.detail.platformVersionId || null;
    renderProject();
  });

  one("[data-export-project]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    try {
      requireProjectContext(context);
      var exported = platform.exportProject({
        accountId: context.accountId,
        projectId: context.projectId
      });
      requireProjectContext(context);
      downloadJson(exported, "abracadabra-" + context.projectId + "-export.json");
      announce("Project export prepared.", "success");
    } catch (error) {
      announce(explain(error, "The project could not be exported."), "error");
    }
  });

  one("[data-detach-domain]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    if (!window.confirm("Detach this customer-owned domain from this Abracadabra project? The customer keeps the domain.")) return;
    try {
      requireProjectContext(context);
      platform.detachDomain({
        accountId: context.accountId,
        projectId: context.projectId
      });
      renderProject();
      announce("Customer-owned domain detached. Ownership remains with the customer.", "success");
    } catch (error) {
      announce(explain(error, "The customer-owned domain could not be detached."), "error");
    }
  });

  one("[data-cancel-project]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    var effectiveAt = new Date();
    var retentionEndsAt = new Date(
      effectiveAt.getTime() + platformModule.BILLING.retentionDays * 24 * 60 * 60 * 1000
    );
    if (!window.confirm(
      "Review cancellation\n\n"
      + "Local serving ends: " + effectiveAt.toLocaleString() + "\n"
      + "Local export and retained project access end: " + retentionEndsAt.toLocaleString()
      + "\n\nNo change has been made yet. Confirm cancellation?"
    )) {
      announce("Cancellation was not submitted.", "success");
      return;
    }
    try {
      requireProjectContext(context);
      platform.cancelProject({ accountId: context.accountId, projectId: context.projectId });
      renderProject();
      announce("Project cancelled. Export remains available during retention.", "success");
    } catch (error) {
      announce(explain(error, "The project could not be cancelled."), "error");
    }
  });

  one("[data-delete-project]").addEventListener("click", function () {
    var context = captureProjectContext();
    if (!context) return;
    if (!window.confirm(
      "Delete this project’s content, releases, access credential, proof references, safety narratives, and support notes now? "
      + "This does not delete the browser-local account and cannot be undone."
    )) return;
    try {
      requireProjectContext(context);
      if (!maker.loadProject({ draft: null, versions: [], serving: { currentVersionId: null } })) {
        announce("Project deletion was cancelled because the maker still has unsaved edits.", "error");
        return;
      }
      platform.deleteProject({ accountId: context.accountId, projectId: context.projectId });
      renderProject();
      announce(
        "Project content deleted from this browser. The local account remains; a customer-owned domain remains the customer’s.",
        "success"
      );
    } catch (error) {
      announce(explain(error, "The project could not be deleted."), "error");
    }
  });

  window.addEventListener("abracadabra:draftchange", function (event) {
    saveDraft(event.detail && event.detail.raw ? event.detail.raw : maker.getDraft());
  });
  window.addEventListener("abracadabra:versionmade", function (event) {
    if (!event.detail) return;
    if (!state.account || !state.project) {
      state.pendingGuestCandidate = JSON.parse(JSON.stringify(event.detail));
      announce(
        "Private preview made. Keep experimenting, download it, or save this direction when you are ready.",
        "success"
      );
      return;
    }
    acceptMadeVersion(event.detail);
  });

  one("[data-save-direction]").addEventListener("click", function () {
    revealControlRoom(state.account ? "sign-in" : "create");
    if (state.account) {
      announce("You are signed in. Create a project to carry this reviewed preview forward.", "success");
      openProjectCreator();
      return;
    }
    announce("Create an account to save this reviewed preview and choose its address.");
    one('[name="accountName"]').focus({ preventScroll: true });
  });

  var openAccountButton = one("[data-open-account]");
  openAccountButton.disabled = !platform;
  openAccountButton.addEventListener("click", function () {
    revealControlRoom("sign-in");
    announce("Sign in to return to projects saved in this browser.");
    one('[name="signInEmail"]').focus({ preventScroll: true });
  });

  renderProjectChoices();
  readSession();
  showAuth("create");
  controlRoom.setAttribute("data-control-ready", "true");
  document.documentElement.setAttribute("data-abracadabra-control-ready", "true");
}());

(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraProgressive = api;
    api.install(root.document, root);
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var STEP_COPY = Object.freeze({
    1: "Step 1 of 3 · Name the project.",
    2: "Step 2 of 3 · Choose the address.",
    3: "Step 3 of 3 · Choose who can open it."
  });

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function validAddressLabel(value) {
    return /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(
      text(value).toLowerCase()
    );
  }

  function validDomain(value) {
    var domain = text(value).toLowerCase();
    if (domain.length > 253 || !domain.includes(".") || domain.endsWith(".")) return false;
    return domain.split(".").every(function (label) {
      return /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label);
    });
  }

  function projectStepError(step, values) {
    if (step === 1 && !text(values.projectName)) {
      return "Give the project a name to continue.";
    }
    if (step === 2 && values.addressMode === "mode_a" && !validAddressLabel(values.addressLabel)) {
      return "Use letters, numbers, or single hyphens for the Site Sourcery address.";
    }
    if (step === 2 && values.addressMode === "mode_b" && !validDomain(values.ownedDomain)) {
      return "Enter a full domain, such as example.com.";
    }
    if (step === 3 && values.visibility === "private" && text(values.accessPassword).length < 10) {
      return "Use at least 10 characters for the site passphrase.";
    }
    if (step === 3 && values.termsAccepted !== true) {
      return "Accept the website terms and privacy notice to create the project.";
    }
    return "";
  }

  function domainUnlockedStep(state) {
    var source = state || {};
    if (source.domainOrder) return 4;
    if (source.domainConsent) return 4;
    if (source.registrantContact) return 3;
    if (source.domainQuote) return 2;
    return 1;
  }

  function install(documentObject, windowObject) {
    if (!documentObject || typeof documentObject.querySelector !== "function") return false;
    var creator = documentObject.querySelector("[data-project-creator]");
    if (!creator) return false;

    var currentStep = 1;
    var status = creator.querySelector("[data-project-step-status]");
    var createButton = creator.querySelector("[data-create-project]");

    function one(selector) {
      return creator.querySelector(selector);
    }

    function all(selector) {
      return Array.prototype.slice.call(creator.querySelectorAll(selector));
    }

    function selected(name) {
      var field = one('[name="' + name + '"]:checked');
      return field ? field.value : "";
    }

    function value(name) {
      var field = one('[name="' + name + '"]');
      return field ? field.value : "";
    }

    function values() {
      var terms = one('[name="projectTermsAccepted"]');
      return {
        projectName: value("projectName"),
        addressMode: selected("addressMode"),
        addressLabel: value("addressLabel"),
        ownedDomain: value("ownedDomain"),
        visibility: selected("visibility"),
        accessPassword: value("accessPassword"),
        termsAccepted: Boolean(terms && terms.checked)
      };
    }

    function setInteractive(element, active) {
      element.hidden = !active;
      if (active) element.removeAttribute("inert");
      else element.setAttribute("inert", "");
    }

    function refreshButtons() {
      all("[data-project-step-next]").forEach(function (button) {
        var fromStep = Number(button.closest("[data-project-create-step]").dataset.projectCreateStep);
        button.disabled = Boolean(projectStepError(fromStep, values()));
      });
      if (createButton) createButton.disabled = Boolean(projectStepError(3, values()));
    }

    function showError(message) {
      status.textContent = message;
      status.classList.add("is-error");
    }

    function showStep(step, options) {
      var target = Math.max(1, Math.min(3, Number(step) || 1));
      currentStep = target;
      all("[data-project-create-step]").forEach(function (section) {
        setInteractive(section, Number(section.dataset.projectCreateStep) === target);
      });
      all("[data-project-progress]").forEach(function (item) {
        var itemStep = Number(item.dataset.projectProgress);
        if (itemStep === target) item.setAttribute("aria-current", "step");
        else item.removeAttribute("aria-current");
        item.classList.toggle("is-complete", itemStep < target);
      });
      status.textContent = STEP_COPY[target];
      status.classList.remove("is-error");
      creator.dataset.currentProjectStep = String(target);
      refreshButtons();

      if (!options || options.updateHash !== false) {
        var hash = "#project-step-" + target;
        if (windowObject && windowObject.history && windowObject.location.hash !== hash) {
          windowObject.history.replaceState(null, "", hash);
        }
      }
      if (!options || options.focus !== false) {
        var firstField = one('[data-project-create-step="' + target + '"] input:not([type="radio"]):not([type="checkbox"]), '
          + '[data-project-create-step="' + target + '"] input[type="radio"]');
        if (firstField) firstField.focus({ preventScroll: true });
      }
    }

    all("[data-project-step-next]").forEach(function (button) {
      button.addEventListener("click", function () {
        var error = projectStepError(currentStep, values());
        if (error) {
          showError(error);
          return;
        }
        showStep(Number(button.dataset.projectStepNext));
      });
    });

    all("[data-project-step-back]").forEach(function (button) {
      button.addEventListener("click", function () {
        showStep(Number(button.dataset.projectStepBack));
      });
    });

    creator.addEventListener("input", function () {
      refreshButtons();
      if (currentStep > 1 && projectStepError(1, values())) showStep(1);
      else if (currentStep > 2 && projectStepError(2, values())) showStep(2);
    });
    creator.addEventListener("change", refreshButtons);

    var Observer = windowObject && windowObject.MutationObserver;
    if (typeof Observer === "function") {
      new Observer(function (records) {
        records.forEach(function (record) {
          if (record.attributeName === "hidden" && !creator.hidden) {
            showStep(1, { focus: false, updateHash: false });
          }
        });
      }).observe(creator, { attributes: true, attributeFilter: ["hidden"] });
    }

    showStep(1, { focus: false, updateHash: false });
    documentObject.documentElement.setAttribute("data-abracadabra-progressive-ready", "true");
    return true;
  }

  return Object.freeze({
    STEP_COPY: STEP_COPY,
    validAddressLabel: validAddressLabel,
    validDomain: validDomain,
    projectStepError: projectStepError,
    domainUnlockedStep: domainUnlockedStep,
    install: install
  });
}));
