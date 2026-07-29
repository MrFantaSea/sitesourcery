(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraControlMode = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var HOLD = "hold";
  var LOCAL = "local-rehearsal";
  var HOSTED = "hosted";
  var MODES = new Set([HOLD, LOCAL, HOSTED]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function configuredMode(documentObject) {
    if (!documentObject || typeof documentObject.querySelector !== "function") return HOLD;
    var meta = documentObject.querySelector(
      'meta[name="sitesourcery-abracadabra-control-mode"]'
    );
    var value = meta && typeof meta.getAttribute === "function"
      ? text(meta.getAttribute("content")).toLowerCase()
      : "";
    return MODES.has(value) ? value : HOLD;
  }

  function parseCatalog(documentObject) {
    if (!documentObject || typeof documentObject.getElementById !== "function") {
      return Object.freeze({
        revision: null,
        domainTermsVersion: null,
        variants: Object.freeze({})
      });
    }
    var element = documentObject.getElementById("abracadabra-hosted-catalog");
    if (!element) {
      return Object.freeze({
        revision: null,
        domainTermsVersion: null,
        variants: Object.freeze({})
      });
    }
    try {
      var raw = JSON.parse(String(element.textContent || "{}"));
      var variants = raw && raw.variants && typeof raw.variants === "object"
        ? raw.variants
        : {};
      var safeVariants = {};
      Object.keys(variants).forEach(function (key) {
        var candidate = variants[key];
        if (!candidate || typeof candidate !== "object") return;
        var priceId = text(candidate.priceId);
        var label = text(candidate.label);
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(key) || !label || !priceId) return;
        safeVariants[key] = Object.freeze({
          id: key,
          label: label.slice(0, 100),
          priceId: priceId.slice(0, 200)
        });
      });
      return Object.freeze({
        revision: text(raw.revision) || null,
        domainTermsVersion: text(raw.domainTermsVersion) || null,
        variants: Object.freeze(safeVariants)
      });
    } catch (_error) {
      return Object.freeze({
        revision: null,
        domainTermsVersion: null,
        variants: Object.freeze({})
      });
    }
  }

  function resolve(documentObject) {
    var mode = configuredMode(documentObject);
    return Object.freeze({
      mode: mode,
      hosted: mode === HOSTED,
      localRehearsal: mode === LOCAL,
      held: mode === HOLD,
      catalog: parseCatalog(documentObject)
    });
  }

  return Object.freeze({
    HOLD: HOLD,
    LOCAL_REHEARSAL: LOCAL,
    HOSTED: HOSTED,
    configuredMode: configuredMode,
    parseCatalog: parseCatalog,
    resolve: resolve
  });
}));
