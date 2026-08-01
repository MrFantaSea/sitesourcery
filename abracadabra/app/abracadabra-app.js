(function () {
  "use strict";

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
      if (options.target) link.target = options.target;
      if (options.rel) link.rel = options.rel;
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

  function openLocalPreview(environment, options) {
    var objectUrl = "";
    var openedWindow = null;
    var revokeScheduled = false;
    var opened = false;
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
        || typeof environment.open !== "function"
        || !options
        || !Array.isArray(options.parts)
      ) {
        throw new Error("Local preview opening is not supported.");
      }

      var file = new environment.Blob(options.parts, { type: options.type });
      objectUrl = environment.URL.createObjectURL(file);
      if (typeof objectUrl !== "string" || objectUrl.length === 0) {
        throw new Error("The browser did not create a local preview address.");
      }

      openedWindow = environment.open(objectUrl, "_blank");
      if (!openedWindow) {
        throw new Error("The browser blocked the preview window.");
      }
      try {
        openedWindow.opener = null;
      } catch (_error) {
        // The generated page is inert; opener cleanup cannot change the truthful open result.
      }
      opened = true;

      if (typeof environment.setTimeout === "function") {
        revokeScheduled = true;
        try {
          environment.setTimeout(function () {
            safeRevokeObjectUrl(environment, objectUrl);
          }, options.revokeDelay || 60000);
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
      opened = false;
    } finally {
      if (objectUrl && !revokeScheduled) {
        safeRevokeObjectUrl(environment, objectUrl);
      }
      if (button) button.disabled = false;
    }

    if (status) {
      status.textContent = opened
        ? options.successMessage
        : options.failureMessage;
    }
    return opened;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({
      deliverLocalFile: deliverLocalFile,
      openLocalPreview: openLocalPreview
    });
    return;
  }

  var compiler = window.AbracadabraCompiler;
  var maker = document.getElementById("spark-maker");
  var bootStatus = document.getElementById("spark-boot-status");
  if (!compiler || !maker || !bootStatus) {
    if (bootStatus) {
      bootStatus.textContent = "Abracadabra could not open. Reload this page to try again; the maker remains locked.";
    }
    return;
  }

  var steps = Array.prototype.slice.call(maker.querySelectorAll("[data-step]"));
  var progress = Array.prototype.slice.call(maker.querySelectorAll("[data-progress-step]"));
  var errorsBox = document.getElementById("spark-errors");
  var errorsList = errorsBox.querySelector("ul");
  var truthReview = document.getElementById("spark-truth-review");
  var truthConfirmed = document.getElementById("truth-confirmed");
  var preview = document.getElementById("spark-preview");
  var versionStatus = document.getElementById("spark-version-status");
  var versionList = document.getElementById("spark-version-list");
  var undoButton = document.getElementById("previous-version");
  var openButton = document.getElementById("open-version");
  var makeButton = document.getElementById("make-preview");
  var returnBar = maker.querySelector("[data-return-bar]");
  var returnButton = maker.querySelector("[data-return-preview]");
  var sampleButton = maker.querySelector("[data-load-sample]");
  var clearDraftButton = maker.querySelector("[data-clear-draft]");
  var versions = [];
  var currentVersionIndex = -1;
  var currentStep = "vibe";
  var previewObjectUrl = null;
  var reviewedDigest = "";
  var reviewedRaw = null;
  var cleanDraftFingerprint = "";
  var draftHasTrustedEdits = false;

  var labels = Object.freeze({
    businessName: "Business name",
    summary: "What the business does",
    about: "About",
    offerings: "Offerings",
    location: "Location or service area",
    hours: "Hours",
    phone: "Phone",
    email: "Email",
    website: "Outside website",
    primaryAction: "Emphasized contact action",
    theme: "Look",
    truthConfirmed: "Review confirmation",
    pageDetails: "Supporting page detail",
    contact: "Visitor next step"
  });

  function cloneRaw(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function element(name) {
    return maker.querySelector('[name="' + name + '"]');
  }

  function value(name) {
    var control = element(name);
    return control ? control.value : "";
  }

  function collectRawFacts() {
    var selectedTheme = maker.querySelector('input[name="theme"]:checked');
    return {
      businessName: value("businessName"),
      summary: value("summary"),
      about: value("about"),
      offerings: value("offerings"),
      location: value("location"),
      hours: value("hours"),
      phone: value("phone"),
      email: value("email"),
      website: value("website"),
      primaryAction: value("primaryAction"),
      theme: selectedTheme ? selectedTheme.value : "",
      accent: (maker.querySelector('input[name="accent"]:checked') || { value: "none" }).value,
      fontPair: (maker.querySelector('input[name="fontPair"]:checked') || { value: "standard" }).value,
      borderStyle: (maker.querySelector('input[name="borderStyle"]:checked') || { value: "soft" }).value,
      cashapp: value("cashapp"),
      venmo: value("venmo")
    };
  }

  function comparableRaw(raw) {
    var comparable = {};
    Object.keys(raw).forEach(function (name) {
      comparable[name] = typeof raw[name] === "string"
        ? raw[name].replace(/\r\n?/gu, "\n").trim()
        : raw[name];
    });
    return comparable;
  }

  function draftFingerprint(raw) {
    try {
      return "normalized:" + normalizedDigest(compiler.normalizeFacts(raw));
    } catch (_error) {
      return "raw:" + compiler.stableStringify(comparableRaw(raw));
    }
  }

  function markDraftClean() {
    cleanDraftFingerprint = draftFingerprint(collectRawFacts());
    draftHasTrustedEdits = false;
  }

  function hasMeaningfulUnsavedChanges() {
    return draftHasTrustedEdits
      && draftFingerprint(collectRawFacts()) !== cleanDraftFingerprint;
  }

  /*
   * A version counts as durable only when the platform gave it a real id.
   * Anything else -- null, "", or whitespace -- means the acceptance did not
   * land, so the version still exists nowhere but this tab.
   */
  function isDurableVersionId(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  /*
   * A made version is destroyed by unload only while it exists nowhere but this
   * tab. Once the platform has accepted it, platformVersionId is set and the
   * version survives a refresh, so warning about it would be a false alarm for
   * a signed-in customer whose work is already durable.
   */
  function hasUnsavedMadeVersion() {
    return versions.some(function (version) {
      return !isDurableVersionId(version.platformVersionId);
    });
  }

  /*
   * Unload is the only action that destroys in-memory versions, and making one
   * marks the draft clean -- so the draft-level predicate alone goes quiet at
   * exactly the point the customer has the most to lose.
   *
   * Draft-replacement prompts deliberately keep using
   * hasMeaningfulUnsavedChanges instead: loading a sample, clearing the draft,
   * undoing, and opening a project are in-tab actions that made versions
   * survive, so they must keep warning only about unsaved draft edits.
   */
  function hasWorkDestroyedByUnload() {
    return hasUnsavedMadeVersion() || hasMeaningfulUnsavedChanges();
  }

  function confirmDraftReplacement(message) {
    return !hasMeaningfulUnsavedChanges() || window.confirm(message);
  }

  /* The review attests the customer's CLAIMS - words, contact, payment
     handles. Style garments (accent, type, edges) may change freely after
     review without re-attesting facts that did not move. */
  function factsDigest(normalized) {
    var stripped = Object.assign({}, normalized, { accent: null, fontPair: null, borderStyle: null });
    return normalizedDigest(stripped);
  }

  function normalizedDigest(normalized) {
    return compiler.sha256(compiler.stableStringify(normalized));
  }

  function clearReviewedSnapshot() {
    reviewedDigest = "";
    reviewedRaw = null;
    truthConfirmed.checked = false;
  }

  function clearErrors() {
    errorsList.replaceChildren();
    errorsBox.hidden = true;
    maker.querySelectorAll("input,textarea,select,button").forEach(function (control) {
      if (control && control.removeAttribute) control.removeAttribute("aria-invalid");
    });
  }

  function showErrors(errors) {
    clearErrors();
    errors.forEach(function (error) {
      var item = document.createElement("li");
      var name = labels[error.field] || error.field;
      item.textContent = name + ": " + error.message;
      errorsList.appendChild(item);
      var control = element(error.field);
      if (control && control.setAttribute) control.setAttribute("aria-invalid", "true");
    });
    errorsBox.hidden = false;
    errorsBox.focus();
  }

  function validate(raw) {
    try {
      return compiler.normalizeFacts(raw);
    } catch (error) {
      if (error && Array.isArray(error.errors)) {
        showErrors(error.errors);
        return null;
      }
      showErrors([{ field: "facts", message: "Abracadabra could not validate these business details." }]);
      return null;
    }
  }

  function validateProgressStep(name, raw) {
    var errors = [];
    if (name === "facts") {
      if (!String(raw.businessName || "").trim()) {
        errors.push({ field: "businessName", message: "Add the business name." });
      }
      if (!String(raw.summary || "").trim()) {
        errors.push({ field: "summary", message: "Add one plain sentence about the business." });
      }
    }
    if (name === "facts") {
      // Every field lives on this one screen now; gate on the whole truth.
      if (errors.length) { showErrors(errors); return false; }
      return Boolean(validate(raw));
    }
    if (errors.length) {
      showErrors(errors);
      return false;
    }
    return true;
  }

  function setStep(name, options) {
    var settings = options || {};
    currentStep = name;
    steps.forEach(function (step) { step.hidden = step.getAttribute("data-step") !== name; });
    progress.forEach(function (item) {
      if (item.getAttribute("data-progress-step") === name) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    returnBar.hidden = currentVersionIndex < 0 || name === "preview";
    clearErrors();
    if (name === "truth") {
      var raw = collectRawFacts();
      var normalized = validate(raw);
      if (!normalized) {
        setStep("facts", { focus: false });
        return;
      }
      truthConfirmed.checked = false;
      reviewedRaw = cloneRaw(raw);
      reviewedDigest = factsDigest(normalized);
      renderTruth(normalized);
    }
    if (settings.focus !== false) {
      var active = steps.find(function (step) { return step.getAttribute("data-step") === name; });
      if (active) {
        active.setAttribute("tabindex", "-1");
        active.focus();
      }
    }
  }

  function reviewRow(term, description) {
    var group = document.createElement("div");
    var title = document.createElement("dt");
    var body = document.createElement("dd");
    title.textContent = term;
    body.textContent = description;
    group.append(title, body);
    return group;
  }

  function renderTruth(normalized) {
    var list = document.createElement("dl");
    list.append(reviewRow("Business name", normalized.businessName));
    list.append(reviewRow("What it does", normalized.summary));
    list.append(reviewRow("Look", normalized.theme.charAt(0).toUpperCase() + normalized.theme.slice(1)));
    if (normalized.about) list.append(reviewRow("About", normalized.about));
    if (normalized.offerings.length) list.append(reviewRow("Offerings", normalized.offerings.join(" · ")));
    if (normalized.location) list.append(reviewRow("Location or service area", normalized.location));
    if (normalized.hours) list.append(reviewRow("Hours", normalized.hours));
    if (normalized.phone) list.append(reviewRow("Phone", normalized.phone.display));
    if (normalized.email) list.append(reviewRow("Email", normalized.email.display));
    if (normalized.website) list.append(reviewRow("Outside website", normalized.website.display));
    var actionLabels = {
      none: "Keep supplied contact actions equal",
      phone: "Phone",
      email: "Email",
      website: "Outside website"
    };
    list.append(reviewRow("Emphasized contact action", actionLabels[normalized.primaryAction]));
    if (normalized.accent && normalized.accent !== "none") {
      list.append(reviewRow("Accent color", normalized.accent.charAt(0).toUpperCase() + normalized.accent.slice(1)));
    }
    if (normalized.fontPair === "alt") list.append(reviewRow("Type pairing", "The alternate"));
    if (normalized.borderStyle && normalized.borderStyle !== "soft") {
      list.append(reviewRow("Edges", normalized.borderStyle.charAt(0).toUpperCase() + normalized.borderStyle.slice(1)));
    }
    if (normalized.cashapp) list.append(reviewRow("Cash App", "$" + normalized.cashapp.display));
    if (normalized.venmo) list.append(reviewRow("Venmo", "@" + normalized.venmo.display));
    truthReview.replaceChildren(list);
  }

  function fillForm(raw) {
    [
      "businessName",
      "summary",
      "about",
      "offerings",
      "location",
      "hours",
      "phone",
      "email",
      "website",
      "primaryAction"
    ].forEach(function (name) {
      var control = element(name);
      if (control) control.value = raw[name] || (name === "primaryAction" ? "none" : "");
    });
    var theme = maker.querySelector('input[name="theme"][value="' + raw.theme + '"]');
    if (theme) theme.checked = true;
    ["cashapp", "venmo"].forEach(function (name) {
      var control = element(name);
      if (control) control.value = raw[name] || "";
    });
    var accent = maker.querySelector('input[name="accent"][value="' + (raw.accent || "none") + '"]');
    if (accent) accent.checked = true;
    var pair = maker.querySelector('input[name="fontPair"][value="' + (raw.fontPair || "standard") + '"]');
    if (pair) pair.checked = true;
    var border = maker.querySelector('input[name="borderStyle"][value="' + (raw.borderStyle || "soft") + '"]');
    if (border) border.checked = true;
    clearReviewedSnapshot();
    markDraftClean();
  }

  function emitDraftChanged() {
    window.dispatchEvent(new CustomEvent("abracadabra:draftchange", {
      detail: { raw: cloneRaw(collectRawFacts()) }
    }));
  }

  function emitVersionMade(version, reviewAttested) {
    window.dispatchEvent(new CustomEvent("abracadabra:versionmade", {
      detail: {
        raw: cloneRaw(version.raw),
        result: cloneRaw(version.result),
        reviewAttested: reviewAttested === true
      }
    }));
  }

  function emitVersionSelected(version) {
    window.dispatchEvent(new CustomEvent("abracadabra:versionselected", {
      detail: {
        platformVersionId: version && version.platformVersionId
          ? String(version.platformVersionId)
          : null
      }
    }));
  }

  function loadProjectState(project) {
    if (!confirmDraftReplacement(
      "Open this project? Your unsaved draft edits will be replaced."
    )) return false;
    var savedVersions = project && Array.isArray(project.versions) ? project.versions : [];
    versions = savedVersions.map(function (saved) {
      if (!saved || !saved.rawFacts || !saved.artifact) return null;
      try {
        var result = compiler.compileSite(saved.rawFacts);
        if (
          result.artifactDigest !== saved.artifact.digest
          || result.html !== saved.artifact.html
        ) return null;
        return {
          platformVersionId: saved.id,
          raw: cloneRaw(saved.rawFacts),
          result: result
        };
      } catch (_error) {
        return null;
      }
    }).filter(Boolean);
    var currentId = project && project.serving ? project.serving.currentVersionId : null;
    currentVersionIndex = versions.findIndex(function (version) {
      return version.platformVersionId === currentId;
    });
    if (currentVersionIndex < 0 && versions.length) currentVersionIndex = versions.length - 1;
    var draft = project && project.draft && project.draft.rawFacts
      ? project.draft.rawFacts
      : currentVersionIndex >= 0
        ? versions[currentVersionIndex].raw
        : { theme: "clear", primaryAction: "none" };
    fillForm(draft);
    if (currentVersionIndex >= 0) {
      renderCurrentVersion("Resumed.");
      setStep("preview", { focus: false });
    } else {
      preview.removeAttribute("srcdoc");
      preview.removeAttribute("src");
      versionList.replaceChildren();
      renderCurrentVersion();
      setStep("vibe", { focus: false });
    }
    markDraftClean();
    return true;
  }

  function themeLabel(theme) {
    return String(theme).charAt(0).toUpperCase() + String(theme).slice(1);
  }

  function versionSummary(version) {
    var summary = version && version.result && version.result.facts
      ? String(version.result.facts.summary || "")
      : "";
    return summary.length > 58 ? summary.slice(0, 57).trimEnd() + "…" : summary;
  }

  function renderCurrentVersion(message) {
    var current = versions[currentVersionIndex];
    var hasCurrentVersion = Boolean(current);
    openButton.disabled = !hasCurrentVersion;
    if (!current) {
      preview.removeAttribute("srcdoc");
      versionStatus.textContent = "No version has been made.";
      undoButton.disabled = true;
      return;
    }
    // The preview is a blob document, not srcdoc: about:srcdoc frames repaint
    // unreliably on reassignment AND mishandle in-page anchor clicks. A blob
    // URL is a real address - Offerings/About/Contact scroll like normal.
    if (previewObjectUrl) {
      try { URL.revokeObjectURL(previewObjectUrl); } catch (_e) { /* gone */ }
    }
    previewObjectUrl = URL.createObjectURL(new Blob([current.result.html], { type: "text/html" }));
    preview.removeAttribute("srcdoc");
    preview.src = previewObjectUrl;
    versionStatus.textContent = (message ? message + " " : "")
      + "Version " + (currentVersionIndex + 1) + " · "
      + themeLabel(current.result.theme) + " · "
      + current.result.facts.businessName + ".";
    undoButton.disabled = currentVersionIndex <= 0;
    renderHistory();
  }

  function renderHistory() {
    versionList.replaceChildren();
    versions.forEach(function (version, index) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      var active = index === currentVersionIndex;
      button.type = "button";
      button.textContent = "Version " + (index + 1) + " · " + themeLabel(version.result.theme)
        + " · " + version.result.facts.businessName + " — " + versionSummary(version);
      if (active) button.setAttribute("aria-current", "true");
      button.addEventListener("click", function () {
        if (!confirmDraftReplacement(
          "Restore this made version? Your unsaved draft edits will be replaced."
        )) return;
        currentVersionIndex = index;
        fillForm(version.raw);
        renderCurrentVersion("Restored.");
        setStep("preview");
        emitVersionSelected(version);
      });
      item.appendChild(button);
      versionList.appendChild(item);
    });
  }

  function makePreview() {
    clearErrors();
    var raw = collectRawFacts();
    var normalized = validate(raw);
    if (!normalized) return;
    var currentDigest = factsDigest(normalized);
    if (!reviewedDigest || !reviewedRaw || currentDigest !== reviewedDigest) {
      reviewedRaw = cloneRaw(raw);
      reviewedDigest = currentDigest;
      truthConfirmed.checked = false;
      renderTruth(normalized);
      showErrors([{
        field: "truthConfirmed",
        message: "The business details changed after review. Read the updated review and confirm it again."
      }]);
      truthConfirmed.setAttribute("aria-invalid", "true");
      return;
    }
    if (!truthConfirmed.checked) {
      showErrors([{ field: "truthConfirmed", message: "Confirm the reviewed business details before making the preview." }]);
      truthConfirmed.setAttribute("aria-invalid", "true");
      truthConfirmed.focus();
      return;
    }
    var reviewAttested = truthConfirmed.checked === true;
    /* Facts compile from the attested review snapshot; the style kit rides
       the room as it stands - garments are not claims. */
    var dressed = cloneRaw(reviewedRaw);
    dressed.accent = raw.accent;
    dressed.fontPair = raw.fontPair;
    dressed.borderStyle = raw.borderStyle;
    var result;
    try {
      result = compiler.compileSite(dressed);
    } catch (error) {
      showErrors(error && Array.isArray(error.errors)
        ? error.errors
        : [{ field: "facts", message: "Abracadabra could not make this preview." }]);
      return;
    }

    var existingIndex = versions.findIndex(function (version) {
      return version.result.artifactDigest === result.artifactDigest;
    });
    if (existingIndex !== -1) {
      currentVersionIndex = existingIndex;
      fillForm(versions[existingIndex].raw);
      renderCurrentVersion("That version already exists; restored.");
      setStep("preview");
      if (
        isDurableVersionId(
          versions[existingIndex]
            .platformVersionId
        )
      ) {
        emitVersionSelected(
          versions[existingIndex]
        );
      } else {
        emitVersionMade(
          versions[existingIndex],
          reviewAttested
        );
      }
      return;
    }
    versions.push({ raw: cloneRaw(dressed), result: result, platformVersionId: null });
    currentVersionIndex = versions.length - 1;
    markDraftClean();
    renderCurrentVersion("Your page is ready. Open it or edit it below.");
    setStep("preview");
    emitVersionMade(versions[currentVersionIndex], reviewAttested);
  }

  function openCurrentPreview() {
    var current = versions[currentVersionIndex];
    if (!current) {
      versionStatus.textContent = "Make a version before opening it. Then try again.";
      return;
    }
    openLocalPreview(window, {
      button: openButton,
      failureMessage: "The working page could not open. Nothing was changed. Select Open again to retry.",
      parts: [current.result.html],
      revokeDelay: 60000,
      status: versionStatus,
      successMessage: "Working page opened in a new tab.",
      type: "text/html;charset=utf-8"
    });
  }

  function loadFictionalSample() {
    if (!confirmDraftReplacement(
      "Load the fictional sample? Your unsaved draft edits will be replaced, and your made versions will stay available."
    )) return;
    fillForm({
      businessName: "Juniper & Clay",
      summary: "Plants, pottery, and useful objects for calmer rooms.",
      about: "Juniper & Clay is a fictional neighborhood shop used to demonstrate this maker.\n\nThe sample contains no real customer or business claims.",
      offerings: "Indoor plants\nHandmade pottery\nPlant care supplies",
      location: "South Jersey",
      hours: "Tuesday–Saturday, 10–6",
      phone: "(856) 555-0142",
      email: "",
      website: "",
      primaryAction: "phone",
      // The sample fills the WORDS. The look you already chose stays yours.
      theme: (maker.querySelector('input[name="theme"]:checked') || { value: "warm" }).value
    });
    emitDraftChanged();
    bootStatus.hidden = false;
    bootStatus.textContent = "Fictional sample loaded. Replace any detail before using the result.";
    element("businessName").focus();
  }

  function clearDraft() {
    if (!confirmDraftReplacement(
      "Clear this draft? Your unsaved edits will be removed, and your made versions will stay available."
    )) return;
    fillForm({ theme: "clear", primaryAction: "none" });
    emitDraftChanged();
    setStep("vibe", { focus: false });
    bootStatus.hidden = false;
    bootStatus.textContent = currentVersionIndex < 0
      ? "Draft cleared."
      : "Draft cleared. Your made versions are still available.";
    element("businessName").focus();
  }

  function handleDraftEdit(event) {
    clearErrors();
    if (event.isTrusted && event.target !== truthConfirmed) {
      draftHasTrustedEdits = draftFingerprint(collectRawFacts()) !== cleanDraftFingerprint;
    }
    if (currentStep === "truth" && event.target !== truthConfirmed) {
      clearReviewedSnapshot();
    }
    if (event.target !== truthConfirmed) emitDraftChanged();
  }

  maker.addEventListener("input", handleDraftEdit);
  maker.addEventListener("change", handleDraftEdit);

  maker.querySelectorAll("[data-next]").forEach(function (button) {
    button.addEventListener("click", function () {
      var raw = collectRawFacts();
      var progressStep = button.getAttribute("data-validate-step");
      // A next-button gates only what it names. The full-form gate lives on
      // the contact step's button; un-named advances (the Look) are free.
      if (progressStep) {
        if (!validateProgressStep(progressStep, raw)) return;
      }
      setStep(button.getAttribute("data-next"));
    });
  });
  maker.querySelectorAll("[data-back]").forEach(function (button) {
    button.addEventListener("click", function () { setStep(button.getAttribute("data-back")); });
  });
  maker.querySelector("[data-edit-facts]").addEventListener("click", function () {
    setStep("facts");
  });
  var editDetailsButton = maker.querySelector("[data-edit-details]");
  if (editDetailsButton) {
    editDetailsButton.addEventListener("click", function () {
      setStep("details");
    });
  }
  var editContactButton = maker.querySelector("[data-edit-contact]");
  if (editContactButton) {
    editContactButton.addEventListener("click", function () {
      setStep("contact");
    });
  }
  maker.querySelector("[data-edit-look]").addEventListener("click", function () {
    setStep("vibe");
  });

  makeButton.addEventListener("click", makePreview);
  undoButton.addEventListener("click", function () {
    if (currentVersionIndex <= 0) return;
    if (!confirmDraftReplacement(
      "Restore the previous made version? Your unsaved draft edits will be replaced."
    )) return;
    currentVersionIndex -= 1;
    fillForm(versions[currentVersionIndex].raw);
    renderCurrentVersion("Undone.");
    emitVersionSelected(versions[currentVersionIndex]);
  });
  var applyStyleButton = maker.querySelector("[data-apply-style]");
  if (applyStyleButton) applyStyleButton.addEventListener("click", makePreview);
  openButton.addEventListener("click", openCurrentPreview);
  returnButton.addEventListener("click", function () { setStep("preview"); });
  sampleButton.addEventListener("click", loadFictionalSample);
  clearDraftButton.addEventListener("click", clearDraft);
  window.addEventListener("beforeunload", function (event) {
    if (!hasWorkDestroyedByUnload()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  maker.inert = false;
  maker.removeAttribute("inert");
  maker.setAttribute("aria-disabled", "false");
  /* sitesourcery:truth-slot:abracadabra-app-ready:start */
  bootStatus.textContent = "Abracadabra ready. Your local draft stays in this tab.";
  bootStatus.hidden = false;
  /* sitesourcery:truth-slot:abracadabra-app-ready:end */
  markDraftClean();
  setStep("vibe", { focus: false });
  window.SiteSourceryAbracadabraMaker = Object.freeze({
    getCurrentVersion: function () {
      return currentVersionIndex >= 0 ? cloneRaw(versions[currentVersionIndex]) : null;
    },
    getDraft: function () {
      return cloneRaw(collectRawFacts());
    },
    loadProject: loadProjectState,
    /*
     * Bind platform acceptance to the exact local version it started from.
     *
     * Acceptance is asynchronous, so the customer can make another version
     * while one is in flight. Stamping whichever version happens to be current
     * when the promise settles would give the newer version the older one's id
     * -- both would look durable and the unload guard would disarm while the
     * newer version had never been saved.
     *
     * artifactDigest is the maker's own dedupe identity, is deterministic, and
     * is carried in the versionmade detail, so callers can hold it across the
     * wait. Returns false when that exact version is no longer here; never
     * falls back to the current selection and never touches another version.
     */
    markPlatformVersion: function (localArtifactDigest, platformVersionId) {
      var digest = String(localArtifactDigest == null ? "" : localArtifactDigest);
      if (!digest) return false;
      var target = versions.findIndex(function (version) {
        return version.result && version.result.artifactDigest === digest;
      });
      if (target < 0) return false;

      // A non-durable id means the acceptance did not land. Refuse it outright
      // rather than writing a value the guard would then have to disbelieve.
      var next = String(platformVersionId == null ? "" : platformVersionId);
      if (!isDurableVersionId(next)) return false;

      // An already-bound version keeps its first id. Re-reporting the same id
      // is an idempotent success; a different one is a conflict, not an update.
      var existing = versions[target].platformVersionId;
      if (isDurableVersionId(existing)) return existing === next;

      versions[target].platformVersionId = next;
      return true;
    },
    selectPlatformVersion: function (versionId) {
      var target = versions.findIndex(function (version) {
        return version.platformVersionId === String(versionId || "");
      });
      if (target < 0) return false;
      currentVersionIndex = target;
      fillForm(versions[target].raw);
      renderCurrentVersion("Selected for release.");
      setStep("preview");
      emitVersionSelected(versions[target]);
      return true;
    }
  });
}());
