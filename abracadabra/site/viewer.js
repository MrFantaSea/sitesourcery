(function () {
  "use strict";

  var STORE_KEY = "sitesourcery.abracadabra.platform.v1";
  var STORE_SCHEMA = "sitesourcery.abracadabra.platform/v1";
  var VIEWER_SESSION_KEY = "sitesourcery.abracadabra.viewer-session.v1";
  var PRIVATE_VALUES = new Set(["private", "access-controlled", "access_controlled"]);
  var LIVE_SERVING_VALUES = new Set(["live", "frozen"]);
  var EXPORT_STATES = new Set(["live", "grace", "suspended", "retained", "cancelled"]);

  var elements = {
    accessError: document.getElementById("access-error"),
    accessForm: document.getElementById("access-form"),
    detailProject: document.getElementById("detail-project"),
    detailRetention: document.getElementById("detail-retention"),
    exportButtons: Array.from(document.querySelectorAll("[data-export]")),
    passphrase: document.getElementById("site-passphrase"),
    projectName: document.getElementById("project-name"),
    publishedSite: document.getElementById("published-site"),
    retentionDetail: document.getElementById("retention-detail"),
    siteStage: document.getElementById("site-stage"),
    siteStageTitle: document.getElementById("site-stage-title"),
    stateChip: document.getElementById("state-chip"),
    statusActions: document.getElementById("status-actions"),
    statusCopy: document.getElementById("status-copy"),
    statusDetails: document.getElementById("status-details"),
    statusKicker: document.getElementById("status-kicker"),
    statusStage: document.getElementById("status-stage"),
    statusTitle: document.getElementById("status-title")
  };

  var runtime = {
    accessGranted: false,
    accessPassword: "",
    exportRecord: null,
    normalized: null,
    platform: null,
    projectId: "",
    snapshot: null
  };

  /*
   * Read-only boundary for the durable platform snapshot. The viewer consumes
   * the v1 array schema and normalizes the few fields needed to decide what may
   * be shown. Published bytes still go through resolveSite() whenever the
   * platform module is present.
   */
  var PlatformAdapter = Object.freeze({
    readSnapshot: function (storage) {
      var parsed;
      try {
        var raw = storage.getItem(STORE_KEY);
        if (!raw) return { kind: "empty", snapshot: null };
        parsed = JSON.parse(raw);
      } catch (_error) {
        return { kind: "invalid", snapshot: null };
      }
      if (
        !parsed
        || parsed.schema !== STORE_SCHEMA
        || !Array.isArray(parsed.projects)
      ) {
        return { kind: "invalid", snapshot: null };
      }
      return { kind: "ready", snapshot: parsed };
    },

    findProject: function (snapshot, projectId) {
      if (!snapshot || !Array.isArray(snapshot.projects)) return null;
      return snapshot.projects.find(function (project) {
        return project && String(project.id || "") === projectId;
      }) || null;
    },

    normalizeProject: function (project) {
      var billing = project && project.billing && typeof project.billing === "object"
        ? project.billing
        : {};
      var serving = project && project.serving && typeof project.serving === "object"
        ? project.serving
        : {};
      var access = project && project.access && typeof project.access === "object"
        ? project.access
        : {};
      var address = project && project.address && typeof project.address === "object"
        ? project.address
        : {};
      var lifecycle = lower(project && (project.lifecycle || project.lifecycleState));
      var billingState = lower(billing.state);
      var servingState = lower(serving.state);
      var visibility = lower(access.visibility || access.mode || project.visibility || "public");
      var versions = Array.isArray(project && project.versions) ? project.versions : [];
      var currentVersionId = String(
        serving.currentVersionId
        || project.currentVersionId
        || ""
      );
      var currentVersion = versions.find(function (version) {
        return version && String(version.id || "") === currentVersionId;
      }) || null;
      var artifact = currentVersion && currentVersion.artifact && typeof currentVersion.artifact === "object"
        ? currentVersion.artifact
        : {};

      return Object.freeze({
        accessCredential: normalizeCredential(access.credential || project.accessCredential),
        billingState: billingState,
        currentVersion: currentVersion,
        digest: String(artifact.digest || currentVersion && currentVersion.artifactDigest || "").toLowerCase(),
        displayName: cleanLabel(project && (project.name || project.displayName)) || "Abracadabra website",
        html: typeof artifact.html === "string"
          ? artifact.html
          : typeof (currentVersion && currentVersion.artifactHtml) === "string"
            ? currentVersion.artifactHtml
            : "",
        hostname: cleanHostname(address.hostname || project.hostname),
        id: String(project && project.id || ""),
        lifecycle: lifecycle,
        retentionEndsAt: billing.retentionEndsAt
          || serving.retentionEndsAt
          || project.retentionEndsAt
          || null,
        servingState: servingState,
        state: deriveViewerState(lifecycle, billingState, servingState),
        visibility: PRIVATE_VALUES.has(visibility) ? "private" : "public"
      });
    },

    directResolution: async function (normalized) {
      if (
        !normalized
        || !LIVE_SERVING_VALUES.has(normalized.servingState)
        || normalized.lifecycle !== "active"
        || !["current", "grace"].includes(normalized.billingState)
        || !acceptedVersion(normalized.currentVersion)
        || !normalized.html
        || !validSha256(normalized.digest)
      ) {
        throw new Error("Published version did not pass the local read contract.");
      }
      var actualDigest = await sha256Hex(normalized.html);
      if (!constantTimeEqual(actualDigest, normalized.digest)) {
        throw new Error("Published version digest did not match.");
      }
      return Object.freeze({
        artifactDigest: normalized.digest,
        html: normalized.html,
        hostname: normalized.hostname,
        projectId: normalized.id,
        versionId: String(normalized.currentVersion.id)
      });
    }
  });

  function lower(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function cleanLabel(value) {
    return String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, 120);
  }

  function cleanHostname(value) {
    var candidate = lower(value).replace(/\.$/u, "");
    return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(candidate)
      ? candidate
      : "";
  }

  function acceptedVersion(version) {
    var state = lower(version && (version.candidateState || version.state));
    return state === "accepted_release" || state === "accepted-release";
  }

  function validSha256(value) {
    return /^[a-f0-9]{64}$/u.test(String(value || ""));
  }

  function normalizeCredential(credential) {
    if (!credential || typeof credential !== "object") return null;
    var algorithm = lower(credential.algorithm || "sha256-salted-v1");
    var salt = lower(credential.saltHex || credential.salt);
    var digest = lower(credential.digestHex || credential.digest || credential.hash);
    if (!validSha256(digest)) return null;
    if (algorithm === "sha256-salted-v1" && !/^[a-f0-9]{16,256}$/u.test(salt)) return null;
    if (!["sha256-salted-v1", "sha256"].includes(algorithm)) return null;
    return Object.freeze({ algorithm: algorithm, digest: digest, salt: salt });
  }

  function deriveViewerState(lifecycle, billingState, servingState) {
    if (
      lifecycle === "deleted"
      || billingState === "deleted"
      || servingState === "deleted"
    ) return "deleted";
    if (
      lifecycle === "cancelled"
      || lifecycle === "canceled"
      || lifecycle === "cancel_at_term"
      || billingState === "cancelled"
      || billingState === "canceled"
      || billingState === "cancel_at_term"
    ) return "cancelled";
    if (
      lifecycle === "retained"
      || billingState === "retention"
      || billingState === "canceled_retained"
      || billingState === "cancelled_retained"
      || servingState === "expired"
    ) return "retained";
    if (billingState === "suspended" || servingState === "dark") return "suspended";
    if (billingState === "grace" && LIVE_SERVING_VALUES.has(servingState)) return "grace";
    if (LIVE_SERVING_VALUES.has(servingState)) return "live";
    return "draft";
  }

  function projectIdFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var value = String(params.get("project") || params.get("id") || "").trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) ? value : "";
  }

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setState(state, chipLabel) {
    document.body.dataset.viewerState = state;
    setText(elements.stateChip, chipLabel);
  }

  function setProjectIdentity(normalized) {
    var name = normalized ? normalized.displayName : "Abracadabra";
    setText(elements.projectName, name);
    setText(elements.detailProject, name);
    document.title = name + " · Site Sourcery";
  }

  function setExportAvailable(available) {
    elements.exportButtons.forEach(function (button) {
      button.hidden = !available;
      button.disabled = false;
    });
  }

  function showStatus(config) {
    elements.siteStage.hidden = true;
    elements.statusStage.hidden = false;
    elements.accessForm.hidden = true;
    elements.accessError.hidden = true;
    elements.statusDetails.hidden = config.details === false;
    elements.retentionDetail.hidden = !config.retention;
    elements.statusActions.hidden = config.actions === false;
    setText(elements.statusKicker, config.kicker || "Site Sourcery · Abracadabra");
    setText(elements.statusTitle, config.title);
    setText(elements.statusCopy, config.copy);
    setText(elements.detailRetention, config.retention || "—");
    setState(config.state, config.chip);
    setExportAvailable(Boolean(config.exportAllowed));
    elements.statusStage.focus({ preventScroll: true });
  }

  function showAccessGate(normalized, message) {
    elements.siteStage.hidden = true;
    elements.statusStage.hidden = false;
    elements.statusDetails.hidden = false;
    elements.retentionDetail.hidden = true;
    elements.statusActions.hidden = true;
    elements.accessForm.hidden = false;
    elements.accessError.hidden = true;
    setText(elements.statusKicker, "Site Sourcery · Access controlled");
    setText(elements.statusTitle, "Enter the site passphrase.");
    setText(
      elements.statusCopy,
      message || "This website opens only after its saved access passphrase is verified."
    );
    setState("access", "Locked");
    setExportAvailable(false);
    window.requestAnimationFrame(function () {
      elements.passphrase.focus();
    });
  }

  function showAccessError(message) {
    setText(elements.accessError, message);
    elements.accessError.hidden = false;
    elements.passphrase.setAttribute("aria-invalid", "true");
    elements.passphrase.select();
  }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function statusFor(normalized, canExport) {
    var retention = formatDate(normalized.retentionEndsAt);
    switch (normalized.state) {
      case "draft":
        return {
          actions: true,
          chip: "Draft",
          copy: "No published version is attached to this project on this device.",
          details: true,
          exportAllowed: false,
          state: "draft",
          title: "This project is still a draft."
        };
      case "suspended":
        return {
          actions: true,
          chip: "Paused",
          copy: "The public website is paused while its saved version remains retained. Its owner can keep a copy without republishing it.",
          details: true,
          exportAllowed: canExport,
          retention: retention,
          state: "suspended",
          title: "This website is paused."
        };
      case "retained":
        return {
          actions: true,
          chip: "Retained",
          copy: "The website is no longer being served. A saved version remains available for export on this device until deletion is completed.",
          details: true,
          exportAllowed: canExport,
          retention: retention,
          state: "retained",
          title: "This website has ended."
        };
      case "cancelled":
        return {
          actions: true,
          chip: "Cancelled",
          copy: "Serving has ended for this project. Its retained website can still be exported on this device until deletion is completed.",
          details: true,
          exportAllowed: canExport,
          retention: retention,
          state: "cancelled",
          title: "This website has been cancelled."
        };
      case "deleted":
        return {
          actions: true,
          chip: "Deleted",
          copy: "The project and its published website have been removed from this device. No saved website is exposed here.",
          details: false,
          exportAllowed: false,
          state: "deleted",
          title: "This website has been deleted."
        };
      default:
        return {
          actions: true,
          chip: "Closed",
          copy: "The published website is not exposed in this project state.",
          details: true,
          exportAllowed: false,
          state: "draft",
          title: "This website is not open."
        };
    }
  }

  async function sha256Hex(value) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder !== "function") {
      throw new Error("Secure local hashing is not supported by this browser.");
    }
    var bytes = new TextEncoder().encode(String(value));
    var digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function constantTimeEqual(left, right) {
    var a = String(left || "");
    var b = String(right || "");
    var mismatch = a.length ^ b.length;
    var length = Math.max(a.length, b.length);
    for (var index = 0; index < length; index += 1) {
      mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return mismatch === 0;
  }

  async function verifyCredential(passphrase, credential) {
    if (!credential) return false;
    var normalizedPassphrase = String(passphrase || "").normalize("NFC");
    var material = credential.algorithm === "sha256-salted-v1"
      ? credential.salt + ":" + normalizedPassphrase
      : credential.salt
        ? credential.salt + ":" + normalizedPassphrase
        : normalizedPassphrase;
    var actual = await sha256Hex(material);
    return constantTimeEqual(actual, credential.digest);
  }

  function credentialFingerprint(credential) {
    if (!credential) return "";
    return credential.algorithm + ":" + credential.salt + ":" + credential.digest;
  }

  function readViewerSession() {
    try {
      var raw = window.sessionStorage.getItem(VIEWER_SESSION_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.schema !== "sitesourcery.abracadabra.viewer-session/v1") return {};
      return parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {};
    } catch (_error) {
      return {};
    }
  }

  function hasViewerGrant(normalized) {
    var projects = readViewerSession();
    var saved = projects[normalized.id];
    return Boolean(
      saved
      && saved.credentialFingerprint === credentialFingerprint(normalized.accessCredential)
    );
  }

  function rememberViewerGrant(normalized) {
    try {
      var projects = readViewerSession();
      projects[normalized.id] = {
        credentialFingerprint: credentialFingerprint(normalized.accessCredential),
        verifiedAt: new Date().toISOString()
      };
      window.sessionStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify({
        schema: "sitesourcery.abracadabra.viewer-session/v1",
        projects: projects
      }));
    } catch (_error) {
      // A verified passphrase remains valid for this page even if storage is blocked.
    }
  }

  function createPlatform() {
    var module = window.SiteSourceryAbracadabraPlatform;
    if (!module || typeof module.createPlatform !== "function") return null;
    try {
      return module.createPlatform({ storage: window.localStorage });
    } catch (_error) {
      return null;
    }
  }

  async function resolvePublishedSite(normalized, accessPassword) {
    if (
      runtime.platform
      && normalized.hostname
      && (normalized.visibility === "public" || accessPassword)
    ) {
      var resolved = await Promise.resolve(runtime.platform.resolveSite({
        accessPassword: accessPassword || undefined,
        hostname: normalized.hostname
      }));
      if (
        !resolved
        || String(resolved.projectId || "") !== normalized.id
        || typeof resolved.html !== "string"
        || !validSha256(resolved.artifactDigest)
      ) {
        throw new Error("Platform returned an invalid published-site result.");
      }
      var resolvedDigest = await sha256Hex(resolved.html);
      if (!constantTimeEqual(resolvedDigest, lower(resolved.artifactDigest))) {
        throw new Error("Published-site result did not match its digest.");
      }
      return resolved;
    }
    return PlatformAdapter.directResolution(normalized);
  }

  function inertPublishedHtml(source) {
    var documentCopy = new DOMParser().parseFromString(String(source), "text/html");
    documentCopy.querySelectorAll("script,iframe,frame,object,embed,base").forEach(function (element) {
      element.remove();
    });
    documentCopy.querySelectorAll("meta[http-equiv]").forEach(function (element) {
      var directive = lower(element.getAttribute("http-equiv"));
      if (directive === "refresh" || directive === "content-security-policy") element.remove();
    });
    documentCopy.querySelectorAll("*").forEach(function (element) {
      Array.from(element.attributes).forEach(function (attribute) {
        if (/^on/iu.test(attribute.name)) element.removeAttribute(attribute.name);
      });
    });
    var policy = documentCopy.createElement("meta");
    policy.setAttribute("http-equiv", "Content-Security-Policy");
    policy.setAttribute(
      "content",
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"
    );
    documentCopy.head.prepend(policy);
    return "<!doctype html>\n" + documentCopy.documentElement.outerHTML;
  }

  function showPublishedSite(normalized, resolved) {
    var label = normalized.state === "grace"
      ? "Published · grace"
      : normalized.servingState === "frozen"
        ? "Published · protected"
        : "Published";
    setState(normalized.state, label);
    setText(elements.siteStageTitle, normalized.displayName + " published website");
    elements.publishedSite.title = normalized.displayName + " published website";
    elements.publishedSite.srcdoc = inertPublishedHtml(resolved.html);
    elements.statusStage.hidden = true;
    elements.siteStage.hidden = false;
    runtime.exportRecord = {
      digest: lower(resolved.artifactDigest),
      html: resolved.html,
      name: normalized.displayName
    };
    setExportAvailable(true);
  }

  async function verifiedExportRecord(normalized) {
    if (
      !normalized
      || !normalized.html
      || !acceptedVersion(normalized.currentVersion)
      || !validSha256(normalized.digest)
    ) return null;
    var actualDigest = await sha256Hex(normalized.html);
    if (!constantTimeEqual(actualDigest, normalized.digest)) return null;
    return {
      digest: normalized.digest,
      html: normalized.html,
      name: normalized.displayName
    };
  }

  function safeFilename(value) {
    var stem = String(value || "website")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60);
    return (stem || "website") + ".html";
  }

  function downloadExport(record) {
    if (!record || typeof record.html !== "string") return;
    var blob = new Blob([record.html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = safeFilename(record.name);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function prepareStatus(normalized) {
    var mayExport = EXPORT_STATES.has(normalized.state);
    runtime.exportRecord = mayExport ? await verifiedExportRecord(normalized) : null;
    showStatus(statusFor(normalized, Boolean(runtime.exportRecord)));
  }

  async function openCurrentProject() {
    runtime.projectId = projectIdFromLocation();
    runtime.accessGranted = false;
    runtime.accessPassword = "";
    runtime.exportRecord = null;
    elements.publishedSite.removeAttribute("srcdoc");
    elements.passphrase.value = "";
    elements.passphrase.removeAttribute("aria-invalid");

    if (!runtime.projectId) {
      setProjectIdentity(null);
      showStatus({
        actions: true,
        chip: "Not found",
        copy: "Use the exact local published-site link created for an Abracadabra project.",
        details: false,
        exportAllowed: false,
        state: "missing",
        title: "No published project was selected."
      });
      return;
    }

    var read = PlatformAdapter.readSnapshot(window.localStorage);
    runtime.snapshot = read.snapshot;
    if (read.kind !== "ready") {
      setProjectIdentity(null);
      showStatus({
        actions: true,
        chip: "Not found",
        copy: "This device does not contain a readable Abracadabra project store.",
        details: false,
        exportAllowed: false,
        state: "missing",
        title: "The published project was not found."
      });
      return;
    }

    var project = PlatformAdapter.findProject(runtime.snapshot, runtime.projectId);
    if (!project) {
      setProjectIdentity(null);
      showStatus({
        actions: true,
        chip: "Not found",
        copy: "No project on this device matches this published-site link.",
        details: false,
        exportAllowed: false,
        state: "missing",
        title: "The published project was not found."
      });
      return;
    }

    runtime.normalized = PlatformAdapter.normalizeProject(project);
    runtime.platform = createPlatform();
    setProjectIdentity(runtime.normalized.state === "deleted" ? null : runtime.normalized);

    if (
      runtime.normalized.visibility === "private"
      && !["draft", "deleted"].includes(runtime.normalized.state)
    ) {
      if (!runtime.normalized.accessCredential) {
        showStatus({
          actions: true,
          chip: "Locked",
          copy: "This access-controlled project does not have a complete local access record, so its saved website remains sealed.",
          details: true,
          exportAllowed: false,
          state: "access",
          title: "This website remains locked."
        });
        return;
      }
      if (hasViewerGrant(runtime.normalized)) {
        runtime.accessGranted = true;
      } else {
        showAccessGate(runtime.normalized);
        return;
      }
    }

    if (["live", "grace"].includes(runtime.normalized.state)) {
      try {
        var resolved = await resolvePublishedSite(runtime.normalized, runtime.accessPassword);
        showPublishedSite(runtime.normalized, resolved);
      } catch (_error) {
        showStatus({
          actions: true,
          chip: "Closed",
          copy: "The saved publication record did not pass the local serving checks. No website bytes were exposed.",
          details: true,
          exportAllowed: false,
          state: "missing",
          title: "This published website could not be opened."
        });
      }
      return;
    }

    await prepareStatus(runtime.normalized);
  }

  async function handleAccessSubmit() {
    var normalized = runtime.normalized;
    if (!normalized || !normalized.accessCredential) {
      showAccessError("This project does not contain a valid access record.");
      return;
    }
    var submit = elements.accessForm.querySelector("[data-open-access]");
    submit.disabled = true;
    elements.passphrase.removeAttribute("aria-invalid");
    elements.accessError.hidden = true;
    try {
      var verified = await verifyCredential(elements.passphrase.value, normalized.accessCredential);
      if (!verified) {
        showAccessError("That passphrase did not open this website.");
        return;
      }
      runtime.accessGranted = true;
      runtime.accessPassword = elements.passphrase.value;
      rememberViewerGrant(normalized);
      elements.passphrase.value = "";
      if (["live", "grace"].includes(normalized.state)) {
        var resolved = await resolvePublishedSite(normalized, runtime.accessPassword);
        showPublishedSite(normalized, resolved);
      } else {
        await prepareStatus(normalized);
      }
    } catch (_error) {
      showAccessError("The passphrase could not be checked. Reload this page and try again.");
    } finally {
      runtime.accessPassword = "";
      submit.disabled = false;
    }
  }

  elements.accessForm.querySelector("[data-open-access]").addEventListener("click", handleAccessSubmit);
  elements.passphrase.addEventListener("keydown", function (event) {
    if (event.key === "Enter") handleAccessSubmit();
  });
  elements.exportButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      downloadExport(runtime.exportRecord);
    });
  });

  window.addEventListener("storage", function (event) {
    if (event.key === STORE_KEY) openCurrentProject();
  });

  openCurrentProject();
}());
