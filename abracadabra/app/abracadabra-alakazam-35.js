(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAlakazam35 = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function (root) {
  "use strict";

  var SNAPSHOT_SCHEMA = "sitesourcery.alakazam-35-snapshot/v1";
  var HOLD_REASON = "commercial_cutover_not_authorized";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var DIGEST = /^[a-f0-9]{64}$/u;
  var SECTION_IDS = Object.freeze([
    "about", "offerings", "practical", "contact"
  ]);

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

  function verifiedPhoto(value) {
    if (value === null) return null;
    if (!exactKeys(value, [
      "assetDigest", "assetId", "assetPath", "byteCount", "height",
      "mediaType", "uploadedAt", "width"
    ])) return false;
    var extension = value.mediaType === "image/png"
      ? "png"
      : value.mediaType === "image/jpeg"
        ? "jpg"
        : "";
    return UUID.test(value.assetId)
      && DIGEST.test(value.assetDigest)
      && value.assetPath ===
        "assets/alakazam-header-" + value.assetDigest + "." + extension
      && Number.isSafeInteger(value.byteCount)
      && value.byteCount >= 1
      && value.byteCount <= 2000000
      && Number.isSafeInteger(value.width)
      && value.width >= 320
      && value.width <= 4096
      && Number.isSafeInteger(value.height)
      && value.height >= 160
      && value.height <= 2160
      && exactIso(value.uploadedAt)
      ? Object.freeze(Object.assign({}, value))
      : false;
  }

  function verifiedSections(value) {
    if (!exactKeys(value, SECTION_IDS)) return false;
    if (!SECTION_IDS.every(function (sectionId) {
      return typeof value[sectionId] === "boolean";
    })) return false;
    return Object.freeze(Object.assign({}, value));
  }

  function verifiedConfiguration(value) {
    if (value === null) return null;
    if (!record(value)
      || value.schema !== "sitesourcery.alakazam-35-configuration/v1"
      || !UUID.test(value.commandId)
      || !Number.isSafeInteger(value.configurationRevision)
      || value.configurationRevision < 1
      || !["standard", "alt"].includes(value.fontChoiceId)
      || !DIGEST.test(value.configurationDigest)
      || value.state !== "held"
      || value.holdReason !== HOLD_REASON
      || !exactIso(value.configuredAt)) return false;
    var sections = verifiedSections(value.sections);
    var photo = verifiedPhoto(value.photo);
    if (!sections || photo === false) return false;
    return Object.freeze({
      configurationRevision: value.configurationRevision,
      configurationDigest: value.configurationDigest,
      fontChoiceId: value.fontChoiceId,
      sections: sections,
      photo: photo,
      configuredAt: value.configuredAt
    });
  }

  function verifiedSnapshot(value, projectId) {
    if (!record(value)
      || value.schema !== SNAPSHOT_SCHEMA
      || value.state !== "held"
      || value.providerEffects !== false
      || value.holdReason !== HOLD_REASON
      || value.projectId !== projectId
      || !record(value.subscription)
      || !["alakazam_35", "alakazam_50"].includes(value.subscription.tierId)
      || !["active", "grace"].includes(value.subscription.status)
      || !Number.isSafeInteger(value.subscription.revision)
      || value.subscription.revision < 1
      || !record(value.controls)
      || value.controls.versionHistoryLimit !== 3
      || value.controls.careClass !== "modest"
      || !record(value.controls.photoHeader)
      || value.controls.photoHeader.enabled !== true
      || value.controls.photoHeader.maxBytes !== 2000000
      || !Array.isArray(value.controls.fonts)
      || value.controls.fonts.length !== 2
      || !Array.isArray(value.controls.sections)
      || JSON.stringify(value.controls.sections) !== JSON.stringify(SECTION_IDS)
      || !Array.isArray(value.history)
      || value.history.length > 3
      || !record(value.care)
      || value.care.state !== "held"
      || !Number.isSafeInteger(value.care.requestCount)
      || value.care.requestCount < 0) return false;
    var photo = verifiedPhoto(value.controls.photoHeader.photo);
    var configuration = verifiedConfiguration(value.configuration);
    if (photo === false || configuration === false) return false;
    if (!value.controls.fonts.every(function (font) {
      return exactKeys(font, ["fontChoiceId", "label"])
        && ["standard", "alt"].includes(font.fontChoiceId)
        && typeof font.label === "string"
        && font.label.length > 0;
    })) return false;
    if (!value.history.every(function (entry) {
      return exactKeys(entry, [
        "acceptedAt", "artifactDigest", "isCurrent", "versionId", "versionNumber"
      ]) && UUID.test(entry.versionId)
        && DIGEST.test(entry.artifactDigest)
        && Number.isSafeInteger(entry.versionNumber)
        && entry.versionNumber > 0
        && typeof entry.isCurrent === "boolean"
        && exactIso(entry.acceptedAt);
    })) return false;
    if (value.history.filter(function (entry) { return entry.isCurrent; }).length > 1) {
      return false;
    }
    return Object.freeze({
      projectId: value.projectId,
      subscription: Object.freeze(Object.assign({}, value.subscription)),
      controls: Object.freeze({
        photo: photo,
        fonts: Object.freeze(value.controls.fonts.map(function (font) {
          return Object.freeze(Object.assign({}, font));
        })),
        sections: SECTION_IDS,
        maxPhotoBytes: 2000000
      }),
      configuration: configuration,
      history: Object.freeze(value.history.map(function (entry) {
        return Object.freeze(Object.assign({}, entry));
      })),
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
      return "/projects/" + encodeURIComponent(projectId) + "/alakazam/35";
    }

    return Object.freeze({
      getSnapshot: function (projectId) {
        return request("GET", projectPath(projectId), null, "");
      },
      uploadPhoto: function (projectId, input) {
        return request("POST", projectPath(projectId) + "/photos", {
          mediaType: input.mediaType,
          mediaBase64: input.mediaBase64
        }, input.commandId);
      },
      saveConfiguration: function (projectId, input) {
        return request("POST", projectPath(projectId) + "/configurations", {
          expectedCurrentRevision: input.expectedCurrentRevision,
          fontChoiceId: input.fontChoiceId,
          photoAssetId: input.photoAssetId,
          sections: input.sections
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

  function fileBase64(file) {
    return file.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      var binary = "";
      for (var index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    });
  }

  function mount(options) {
    options = options || {};
    var documentRef = options.documentRef || document;
    var container = options.container;
    var projectId = options.projectId;
    var client = options.client || createClient(options);
    var cryptoObject = options.cryptoObject || root.crypto;
    if (!container || typeof container.append !== "function" || !UUID.test(projectId)) {
      throw new Error("The Alakazam $35 panel mount is invalid.");
    }

    var panel = element(documentRef, "section", "alakazam-35-panel");
    panel.setAttribute("data-alakazam-35", "");
    panel.setAttribute("aria-labelledby", "alakazam-35-title");
    var eyebrow = element(documentRef, "p", "alakazam-35-eyebrow", "$35 tier fulfillment");
    var heading = element(documentRef, "h4", "", "Photo, fonts, sections, history & care");
    heading.id = "alakazam-35-title";
    var hold = element(documentRef, "p", "alakazam-35-hold",
      "Built and account-bound, but held: these controls record exact choices and cannot publish or trigger a provider effect before Alakazam cutover.");
    var status = element(documentRef, "p", "alakazam-35-status", "Loading $35 controls…");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    var controls = element(documentRef, "div", "alakazam-35-controls");
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
        if (!verified) throw new Error("The Alakazam $35 response could not be verified.");
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

    function renderHistory() {
      var section = element(documentRef, "section", "alakazam-35-block");
      section.append(element(documentRef, "h5", "", "Three-version history"));
      var list = element(documentRef, "ol", "alakazam-35-history");
      if (snapshot.history.length === 0) {
        list.append(element(documentRef, "li", "", "No accepted versions are available yet."));
      } else snapshot.history.forEach(function (entry) {
        var item = element(documentRef, "li", "",
          "Version " + entry.versionNumber + (entry.isCurrent ? " · current" : ""));
        item.setAttribute("data-version-id", entry.versionId);
        list.append(item);
      });
      section.append(list);
      return section;
    }

    function render() {
      controls.replaceChildren();
      if (!snapshot) return;
      var configured = snapshot.configuration;
      var photoBlock = element(documentRef, "section", "alakazam-35-block");
      photoBlock.append(element(documentRef, "h5", "", "Photo header"));
      var photoHelp = element(documentRef, "p", "alakazam-35-help",
        snapshot.controls.photo
          ? "Uploaded immutable photo: " + snapshot.controls.photo.width + "×" + snapshot.controls.photo.height + "."
          : "Choose one PNG or JPEG up to 2 MB. Uploading records immutable bytes; saving chooses it for the header.");
      var file = element(documentRef, "input", "alakazam-35-file");
      file.type = "file";
      file.accept = "image/png,image/jpeg";
      file.setAttribute("aria-label", "Choose header photo");
      var upload = button("Upload held photo", function () {
        var selected = file.files && file.files[0];
        if (!selected) {
          setStatus("Choose a PNG or JPEG before uploading.", true);
          return;
        }
        if (!["image/png", "image/jpeg"].includes(selected.type)
          || selected.size < 1 || selected.size > 2000000) {
          setStatus("Choose one PNG or JPEG no larger than 2 MB.", true);
          return;
        }
        execute("Recording immutable photo bytes…", function () {
          return fileBase64(selected).then(function (mediaBase64) {
            return client.uploadPhoto(projectId, {
              commandId: commandId(cryptoObject),
              mediaType: selected.type,
              mediaBase64: mediaBase64
            });
          });
        });
      });
      photoBlock.append(photoHelp, file, upload);

      var configBlock = element(documentRef, "section", "alakazam-35-block");
      configBlock.append(element(documentRef, "h5", "", "Font and sections"));
      var fontLabel = element(documentRef, "label", "alakazam-35-label", "Font choice");
      var font = element(documentRef, "select", "alakazam-35-select");
      snapshot.controls.fonts.forEach(function (choice) {
        var option = element(documentRef, "option", "", choice.label);
        option.value = choice.fontChoiceId;
        font.append(option);
      });
      font.value = configured ? configured.fontChoiceId : "standard";
      fontLabel.append(font);
      var sectionSet = element(documentRef, "fieldset", "alakazam-35-sections");
      sectionSet.append(element(documentRef, "legend", "", "Visible sections"));
      var sectionInputs = {};
      SECTION_IDS.forEach(function (sectionId) {
        var label = element(documentRef, "label", "alakazam-35-check");
        var input = element(documentRef, "input");
        input.type = "checkbox";
        input.checked = configured ? configured.sections[sectionId] : true;
        label.append(input, documentRef.createTextNode(
          sectionId === "practical" ? "Location & hours" :
            sectionId.charAt(0).toUpperCase() + sectionId.slice(1)
        ));
        sectionInputs[sectionId] = input;
        sectionSet.append(label);
      });
      var save = button("Save held website choices", function () {
        var selectedSections = {};
        SECTION_IDS.forEach(function (sectionId) {
          selectedSections[sectionId] = sectionInputs[sectionId].checked;
        });
        execute("Recording font and section choices…", function () {
          return client.saveConfiguration(projectId, {
            commandId: commandId(cryptoObject),
            expectedCurrentRevision: configured ? configured.configurationRevision : 0,
            fontChoiceId: font.value,
            photoAssetId: snapshot.controls.photo ? snapshot.controls.photo.assetId : null,
            sections: selectedSections
          });
        });
      }, "spark-button-primary");
      configBlock.append(fontLabel, sectionSet, save);

      var careBlock = element(documentRef, "section", "alakazam-35-block");
      careBlock.append(element(documentRef, "h5", "", "Modest care"));
      careBlock.append(element(documentRef, "p", "alakazam-35-help",
        "Accounted requests: " + snapshot.care.requestCount + ". No response time, edit allowance, or provider action is promised while held."));
      var careLabel = element(documentRef, "label", "alakazam-35-label", "Care request");
      var message = element(documentRef, "textarea", "alakazam-35-care");
      message.maxLength = 1000;
      message.rows = 4;
      careLabel.append(message);
      var request = button("Record held care request", function () {
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
      controls.append(photoBlock, configBlock, renderHistory(), careBlock);
    }

    function load() {
      setStatus("Loading $35 controls…", false);
      return client.getSnapshot(projectId).then(function (value) {
        var verified = verifiedSnapshot(value, projectId);
        if (!verified) throw new Error("The Alakazam $35 response could not be verified.");
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
