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
  var IMPLEMENTED_PRODUCT_CONTRACT = "abracadabra.spark/v1";
  var MODES = new Set([HOLD, LOCAL, HOSTED]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function safeId(value) {
    var candidate = text(value);
    return /^[a-z0-9][a-z0-9_.-]{0,99}$/u.test(candidate) ? candidate : "";
  }

  function parseAxis(input) {
    var output = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return output;
    Object.keys(input).forEach(function (key) {
      var id = safeId(key);
      var candidate = input[key];
      if (!id || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      var label = text(candidate.label);
      if (!label) return;
      output[id] = Object.freeze({
        id: id,
        label: label.slice(0, 100),
        summary: text(candidate.summary).slice(0, 240)
      });
    });
    return output;
  }

  function parseProducts(input) {
    var output = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return output;
    Object.keys(input).forEach(function (key) {
      var id = safeId(key);
      var candidate = input[key];
      if (
        id !== "spark"
        || !candidate
        || typeof candidate !== "object"
        || Array.isArray(candidate)
        || text(candidate.implementationContract) !== IMPLEMENTED_PRODUCT_CONTRACT
      ) return;
      var label = text(candidate.label);
      if (!label) return;
      output[id] = Object.freeze({
        id: id,
        label: label.slice(0, 100),
        summary: text(candidate.summary).slice(0, 240),
        implementationContract: IMPLEMENTED_PRODUCT_CONTRACT
      });
    });
    return output;
  }

  function emptyCatalog() {
    return Object.freeze({
      schema: null,
      catalogVersion: null,
      termsVersion: null,
      domainTermsVersion: null,
      products: Object.freeze({}),
      tenures: Object.freeze({}),
      offers: Object.freeze({})
    });
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
      return emptyCatalog();
    }
    var element = documentObject.getElementById("abracadabra-hosted-catalog");
    if (!element) {
      return emptyCatalog();
    }
    try {
      var raw = JSON.parse(String(element.textContent || "{}"));
      var safeProducts = parseProducts(raw && raw.products);
      var safeTenures = parseAxis(raw && raw.tenures);
      var safeOffers = {};
      var offers = raw && raw.offers && typeof raw.offers === "object"
        ? raw.offers
        : {};
      Object.keys(offers).forEach(function (key) {
        var id = safeId(key);
        var candidate = offers[key];
        if (!id || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
        var productId = safeId(candidate.productId);
        var tenureId = safeId(candidate.tenureId);
        var eligibleAddressModes = Array.isArray(candidate.eligibleAddressModes)
          ? candidate.eligibleAddressModes.map(text).filter(function (mode, index, rows) {
              return (mode === "licensed" || mode === "customer_owned")
                && rows.indexOf(mode) === index;
            }).sort()
          : [];
        if (
          !safeProducts[productId]
          || !safeTenures[tenureId]
          || eligibleAddressModes.length === 0
        ) return;
        safeOffers[id] = Object.freeze({
          id: id,
          productId: productId,
          tenureId: tenureId,
          eligibleAddressModes: Object.freeze(eligibleAddressModes)
        });
      });
      return Object.freeze({
        schema: text(raw.schema) || null,
        catalogVersion: text(raw.catalogVersion || raw.revision) || null,
        termsVersion: text(raw.termsVersion) || null,
        domainTermsVersion: text(raw.domainTermsVersion) || null,
        products: Object.freeze(safeProducts),
        tenures: Object.freeze(safeTenures),
        offers: Object.freeze(safeOffers)
      });
    } catch (_error) {
      return emptyCatalog();
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
