(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraAPI = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  var SHA256 = /^[a-f0-9]{64}$/u;
  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var SAFE_PAGE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/u;
  var SAFE_PAGE_TYPE = /^[a-z][a-z0-9_]{1,79}$/u;
  var CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
  var CUSTOM_BUILD_CREDENTIAL =
    /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase|bearer\s+[a-z0-9._~-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|:\/\/[^/\s:@]+:[^@\s]+@|[?&](?:token|key|secret|password)=)/iu;
  var CUSTOM_BUILD_RAW_PROVIDER_IDENTIFIER =
    /(^|[^a-z0-9_])(?:cs|pi|ch|cus|evt|pm|seti|src|tok|sub|price|prod|re)_[a-z0-9][a-z0-9_-]{5,}($|[^a-z0-9_])/iu;
  var MAXIMUM_ASSESSMENT_EVIDENCE_BYTES = 700 * 1024;
  var CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA =
    "sitesourcery.custom-build-change-completion/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA =
    "sitesourcery.custom-build-change-invoice/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA =
    "sitesourcery.custom-build-change-checkout/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_OWNER_SCHEMA =
    "sitesourcery.custom-build-change-payments-owner/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_SCHEMA =
    "sitesourcery.custom-build-change-payment-reconciliation-command/v1";
  var CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA =
    "sitesourcery.custom-build-change-settlement/v1";
  var CUSTOM_BUILD_FINAL_STATE_SCHEMA =
    "sitesourcery.custom-build-final-handoff/v1";
  var CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA =
    "sitesourcery.custom-build-final-checkout/v1";
  var CUSTOM_BUILD_FINAL_PAYMENTS_OWNER_SCHEMA =
    "sitesourcery.custom-build-final-payments-owner/v1";
  var CUSTOM_BUILD_HANDOFF_OWNER_READINESS_SCHEMA =
    "sitesourcery.custom-build-handoff-owner-readiness/v1";
  var CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA =
    "sitesourcery.custom-build-handoff-document/v1";
  var CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA =
    "sitesourcery.custom-build-handoff-command/v1";
  var CUSTOM_BUILD_FINAL_OWNER_RECONCILIATION_SCHEMA =
    "sitesourcery.custom-build-final-payment-reconciliation-command/v1";
  var CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA =
    "sitesourcery.custom-build-final-settlement/v1";
  var CUSTOM_BUILD_FINAL_INVOICE_NUMBER =
    /^SSCB-FINAL-[0-9A-F]{32}$/u;
  var CUSTOM_BUILD_CHANGE_PAYMENT_STATES = [
    "not_available",
    "payment_held",
    "checkout_available",
    "checkout_ready",
    "checkout_expired",
    "reconciliation_required",
    "paid",
    "voided"
  ];
  var CUSTOM_BUILD_CHANGE_CHECKOUT_ATTEMPT_STATES = [
    "provider_pending",
    "ready",
    "failed",
    "persistence_unknown",
    "expired",
    "paid"
  ];
  var CUSTOM_BUILD_CHANGE_CHECKOUT_EVENT_STATES = [
    "pending",
    "processed",
    "reconciliation_required"
  ];
  var CUSTOM_BUILD_CHANGE_INVOICE_NUMBER =
    /^SSCB-CHG-[0-9A-F]{32}$/u;
  var CUSTOM_BUILD_CHANGE_STRIPE_EVENT_ID = /^evt_[A-Za-z0-9_]+$/u;
  var CUSTOM_BUILD_CHANGE_SAFE_PROVIDER_CODE =
    /^[A-Za-z0-9._:-]{1,200}$/u;
  var CUSTOM_BUILD_CHANGE_COMPLETION_STATES = [
    "not_available",
    "building",
    "change_order_review",
    "change_order_payment_required",
    "ready_for_final_payment",
    "ready_for_delivery"
  ];
  var CUSTOM_BUILD_CHANGE_ORDER_STATES = [
    "issued",
    "accepted_payment_required",
    "effective",
    "declined",
    "expired",
    "voided"
  ];
  var CUSTOM_BUILD_COMPLETION_STATES = [
    "ready_for_final_payment",
    "ready_for_delivery"
  ];
  var CUSTOM_BUILD_EVIDENCE_MEDIA_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];
  var FORBIDDEN_AUTHORITY_FIELDS = new Set([
    "amount",
    "amountMinor",
    "available",
    "availability",
    "currency",
    "domainOrderPaid",
    "entitlement",
    "externalCheckoutRef",
    "externalSubscriptionRef",
    "lineItems",
    "paymentReceipt",
    "price",
    "priceId",
    "providerReference",
    "providerReceipt",
    "published",
    "registered",
    "registrarReference",
    "registrationState",
    "renewed",
    "signatureVerified",
    "stripePriceId",
    "stripePriceRefs",
    "subscriptionId",
    "subscriptionState",
    "totals",
    "verified"
  ]);
  var FORBIDDEN_AUTHORITY_FIELDS_NORMALIZED = new Set(
    Array.from(FORBIDDEN_AUTHORITY_FIELDS, function (field) {
      return field.toLowerCase();
    })
  );

  function APIError(input) {
    var source = input || {};
    this.name = "AbracadabraAPIError";
    this.message = source.message || "The Site Sourcery service could not complete this request.";
    this.code = source.code || "REQUEST_FAILED";
    this.status = Number(source.status) || 0;
    this.requestId = source.requestId || null;
    this.retryable = source.retryable === true;
    if (Error.captureStackTrace) Error.captureStackTrace(this, APIError);
  }
  APIError.prototype = Object.create(Error.prototype);
  APIError.prototype.constructor = APIError;

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function requiredText(value, field, maximum) {
    var text = String(value == null ? "" : value).trim();
    if (!text || text.length > maximum) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " is required and must be " + maximum + " characters or fewer."
      });
    }
    return text;
  }

  function optionalText(value, maximum) {
    var text = String(value == null ? "" : value).trim();
    if (text.length > maximum) {
      throw new APIError({ code: "INVALID_INPUT", message: "A supplied value is too long." });
    }
    return text || null;
  }

  function nullableDigest(value, field) {
    if (value === null) return null;
    if (typeof value !== "string" || !SHA256.test(value)) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " must be an exact SHA-256 digest."
      });
    }
    return value;
  }

  function requiredDigest(value, field) {
    var selected = nullableDigest(value, field);
    if (selected === null) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " is required."
      });
    }
    return selected;
  }

  function integerBetween(value, field, minimum, maximum) {
    var number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " must be between " + minimum + " and " + maximum + "."
      });
    }
    return number;
  }

  function segment(value, field) {
    return encodeURIComponent(requiredText(value, field, 200));
  }

  function oneOf(value, field, allowed) {
    var selected = String(value == null ? "" : value);
    if (!allowed.includes(selected)) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " is invalid."
      });
    }
    return selected;
  }

  function exactInput(value, expected, field) {
    if (
      !isObject(value)
      || JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify(expected.slice().sort())
    ) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " contains unsupported fields."
      });
    }
    return value;
  }

  function requiredUuid(value, field) {
    var selected = requiredText(value, field, 36);
    if (!UUID.test(selected)) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " is invalid."
      });
    }
    return selected;
  }

  function boundedText(value, field, minimum, maximum) {
    var selected = String(value == null ? "" : value).trim();
    if (
      Array.from(selected).length < minimum
      || Array.from(selected).length > maximum
      || CONTROL_CHARACTER.test(selected)
    ) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " must be between " + minimum + " and "
          + maximum + " characters."
      });
    }
    return selected;
  }

  function customBuildSafeText(value, field, minimum, maximum) {
    var selected = boundedText(value, field, minimum, maximum);
    if (
      CUSTOM_BUILD_CREDENTIAL.test(selected)
      || CUSTOM_BUILD_RAW_PROVIDER_IDENTIFIER.test(selected)
    ) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field
          + " must not contain passwords, verification codes, API keys, tokens, or other credentials."
      });
    }
    return selected;
  }

  function customBuildCanonicalJson(value) {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return "[" + value.map(customBuildCanonicalJson).join(",") + "]";
    }
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + customBuildCanonicalJson(value[key]);
    }).join(",") + "}";
  }

  function customBuildUtf8ByteLength(value) {
    if (typeof TextEncoder !== "function") {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "This browser cannot safely size the handoff document."
      });
    }
    return new TextEncoder().encode(value).byteLength;
  }

  function portableCustomBuildLabelKey(value) {
    return value.replace(/[A-Z]/gu, function (character) {
      return character.toLowerCase();
    });
  }

  function requiredDate(value, field) {
    var selected = requiredText(value, field, 10);
    var match = selected.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    var parsed = match
      ? new Date(Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3])
        ))
      : null;
    if (!parsed || parsed.toISOString().slice(0, 10) !== selected) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " must be an exact calendar date."
      });
    }
    return selected;
  }

  function requiredIso(value, field) {
    var selected = requiredText(value, field, 40);
    var parsed = new Date(selected);
    if (
      !Number.isFinite(parsed.getTime())
      || parsed.toISOString() !== selected
    ) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " must be an exact UTC date and time."
      });
    }
    return selected;
  }

  function customBuildFootprint(tierId, source) {
    var maxima = {
      "card": [1, 5, 1, 500, 2],
      "card-plus": [1, 8, 1, 900, 8],
      "site": [4, 16, 4, 1800, 12],
      "site-plus": [7, 28, 7, 3000, 24],
      "signature": [10, 40, 10, 4500, 36],
      "flagship": [15, 60, 15, 7000, 60],
      "scale": [30, 120, 30, 14500, 120]
    };
    var maximum = maxima[tierId];
    var footprint = {
      craftedPages: integerBetween(
        source.craftedPages,
        "Crafted pages",
        1,
        maximum[0]
      ),
      sections: integerBetween(
        source.sections,
        "Sections",
        1,
        maximum[1]
      ),
      uniqueLayouts: integerBetween(
        source.uniqueLayouts,
        "Unique layouts",
        1,
        maximum[2]
      ),
      contentWords: integerBetween(
        source.contentWords,
        "Content words",
        0,
        maximum[3]
      ),
      suppliedMedia: integerBetween(
        source.suppliedMedia,
        "Supplied media",
        0,
        maximum[4]
      )
    };
    if (tierId === "scale") {
      var scaleUnits = Math.max(
        Math.max(footprint.craftedPages - 15, 0),
        Math.ceil(Math.max(footprint.sections - 60, 0) / 4),
        Math.max(footprint.uniqueLayouts - 15, 0),
        Math.ceil(Math.max(footprint.contentWords - 7000, 0) / 500),
        Math.ceil(Math.max(footprint.suppliedMedia - 60, 0) / 4)
      );
      if (scaleUnits < 1 || scaleUnits > 15) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Scale must use between one and fifteen capacity units beyond Flagship."
        });
      }
    }
    return footprint;
  }

  function assessmentTarget(value, field) {
    var selected = exactInput(value, ["kind", "value"], field);
    var kind = oneOf(
      selected.kind,
      field + " kind",
      ["page", "page_type"]
    );
    var targetValue = boundedText(
      selected.value,
      field,
      1,
      154
    );
    var valid = kind === "page"
      ? SAFE_PAGE_PATH.test(targetValue)
        && !/(^|\/)\.\.?($|\/)/u.test(targetValue)
      : SAFE_PAGE_TYPE.test(targetValue);
    if (!valid) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field + " is invalid."
      });
    }
    return { kind: kind, value: targetValue };
  }

  function assessmentViewports(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Choose desktop, phone, or both for this finding."
      });
    }
    var selected = value.map(function (entry) {
      return oneOf(entry, "Assessment viewport", ["desktop", "phone"]);
    }).sort();
    if (new Set(selected).size !== selected.length) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Each assessment viewport may be chosen once."
      });
    }
    return selected;
  }

  function assessmentEvidenceIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Choose between one and ten evidence images."
      });
    }
    var selected = value.map(function (entry) {
      return requiredUuid(entry, "Assessment evidence ID");
    }).sort();
    if (new Set(selected).size !== selected.length) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Each evidence image may be chosen once."
      });
    }
    return selected;
  }

  function assessmentEvidenceBase64(value) {
    if (
      typeof value !== "string"
      || value.length < 4
      || value.length % 4 !== 0
      || value.length >
        Math.ceil(MAXIMUM_ASSESSMENT_EVIDENCE_BYTES / 3) * 4 + 4
      || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
    ) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Assessment evidence is invalid or larger than 700 KiB."
      });
    }
    var padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    var byteCount = Math.floor(value.length * 3 / 4) - padding;
    if (byteCount < 1 || byteCount > MAXIMUM_ASSESSMENT_EVIDENCE_BYTES) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: "Assessment evidence is invalid or larger than 700 KiB."
      });
    }
    return value;
  }

  function invalidCustomBuildChangeCompletionResponse() {
    return new APIError({
      code: "INVALID_CUSTOM_BUILD_CHANGE_COMPLETION_RESPONSE",
      message:
        "Site Sourcery returned an invalid Custom-build update. Refresh before replacing the information already shown.",
      retryable: true
    });
  }

  function projectionInvariant(condition) {
    if (!condition) {
      throw invalidCustomBuildChangeCompletionResponse();
    }
  }

  function projectionObject(value, expected) {
    projectionInvariant(
      isObject(value)
      && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null)
      && JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.slice().sort())
    );
    return value;
  }

  function projectionArray(value, minimum, maximum) {
    projectionInvariant(
      Array.isArray(value)
      && value.length >= minimum
      && value.length <= maximum
    );
    return value;
  }

  function projectionText(value, minimum, maximum, safe) {
    projectionInvariant(
      typeof value === "string"
      && value === value.trim()
      && value.length >= minimum
      && value.length <= maximum
      && !CONTROL_CHARACTER.test(value)
      && (safe !== true || !CUSTOM_BUILD_CREDENTIAL.test(value))
    );
    return value;
  }

  function projectionUuid(value) {
    projectionInvariant(typeof value === "string" && UUID.test(value));
    return value;
  }

  function projectionDigest(value) {
    projectionInvariant(typeof value === "string" && SHA256.test(value));
    return value;
  }

  function projectionInteger(value, minimum, maximum) {
    projectionInvariant(
      typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= minimum
      && value <= maximum
    );
    return value;
  }

  function projectionDate(value) {
    var parsed = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? new Date(value + "T00:00:00.000Z")
      : null;
    projectionInvariant(
      parsed !== null
      && Number.isFinite(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value
    );
    return value;
  }

  function projectionIso(value) {
    var parsed = typeof value === "string" ? new Date(value) : null;
    projectionInvariant(
      parsed !== null
      && Number.isFinite(parsed.getTime())
      && parsed.toISOString() === value
    );
    return value;
  }

  function projectionNullableIso(value) {
    return value === null ? null : projectionIso(value);
  }

  function deepFreezeProjection(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return value;
    }
    Object.keys(value).forEach(function (key) {
      deepFreezeProjection(value[key]);
    });
    return Object.freeze(value);
  }

  function base64FromBytes(value) {
    var alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    for (var index = 0; index < value.length; index += 3) {
      var first = value[index];
      var second = index + 1 < value.length ? value[index + 1] : 0;
      var third = index + 2 < value.length ? value[index + 2] : 0;
      output += alphabet[first >> 2];
      output += alphabet[((first & 3) << 4) | (second >> 4)];
      output += index + 1 < value.length
        ? alphabet[((second & 15) << 2) | (third >> 6)]
        : "=";
      output += index + 2 < value.length ? alphabet[third & 63] : "=";
    }
    return output;
  }

  function hexFromBytes(value) {
    return Array.from(value, function (entry) {
      return entry.toString(16).padStart(2, "0");
    }).join("");
  }

  function customBuildChangePricingProjection(value) {
    var source = projectionObject(value, [
      "currency",
      "paymentRequirement",
      "subtotalMinor",
      "taxState",
      "unitAmountMinor",
      "unitCount"
    ]);
    var unitCount = projectionInteger(source.unitCount, 1, 40);
    var unitAmountMinor = projectionInteger(
      source.unitAmountMinor,
      12500,
      12500
    );
    var subtotalMinor = projectionInteger(
      source.subtotalMinor,
      12500,
      40 * 12500
    );
    projectionInvariant(
      subtotalMinor === unitCount * unitAmountMinor
      && source.currency === "USD"
      && source.taxState === "automatic_tax_pending"
      && source.paymentRequirement === "due_before_changed_work"
    );
    return {
      unitCount: unitCount,
      unitAmountMinor: unitAmountMinor,
      subtotalMinor: subtotalMinor,
      currency: "USD",
      taxState: "automatic_tax_pending",
      paymentRequirement: "due_before_changed_work"
    };
  }

  function customBuildChangeOrderProjection(value, owner) {
    var fields = [
      "acceptedAt",
      "addedScope",
      "changeNumber",
      "changeOrderId",
      "declinedAt",
      "disclosureDigest",
      "expiredAt",
      "expiresAt",
      "issuedAt",
      "pricing",
      "quoteDigest",
      "state",
      "targetCompletionDate",
      "void"
    ];
    if (owner) fields.push("createdByOperatorUserId");
    var source = projectionObject(value, fields);
    var state = projectionText(source.state, 1, 80, false);
    projectionInvariant(CUSTOM_BUILD_CHANGE_ORDER_STATES.includes(state));
    var issuedAt = projectionIso(source.issuedAt);
    var expiresAt = projectionIso(source.expiresAt);
    var acceptedAt = projectionNullableIso(source.acceptedAt);
    var declinedAt = projectionNullableIso(source.declinedAt);
    var expiredAt = projectionNullableIso(source.expiredAt);
    var selectedVoid = null;
    if (source.void !== null) {
      var voidSource = projectionObject(source.void, ["reason", "voidedAt"]);
      selectedVoid = {
        reason: projectionText(voidSource.reason, 20, 500, true),
        voidedAt: projectionIso(voidSource.voidedAt)
      };
    }
    projectionInvariant(Date.parse(expiresAt) > Date.parse(issuedAt));
    if (state === "issued") {
      projectionInvariant(
        acceptedAt === null && declinedAt === null && expiredAt === null
        && selectedVoid === null
      );
    } else if (
      state === "accepted_payment_required" || state === "effective"
    ) {
      projectionInvariant(
        acceptedAt !== null && declinedAt === null && expiredAt === null
        && selectedVoid === null
      );
    } else if (state === "declined") {
      projectionInvariant(
        acceptedAt === null && declinedAt !== null && expiredAt === null
        && selectedVoid === null
      );
    } else if (state === "voided") {
      projectionInvariant(
        declinedAt === null && expiredAt === null && selectedVoid !== null
      );
    } else if (state === "expired") {
      projectionInvariant(
        acceptedAt === null && declinedAt === null && expiredAt !== null
        && Date.parse(expiredAt) >= Date.parse(expiresAt)
        && selectedVoid === null
      );
    }
    [acceptedAt, declinedAt, expiredAt, selectedVoid && selectedVoid.voidedAt]
      .filter(Boolean)
      .forEach(function (recordedAt) {
        projectionInvariant(Date.parse(recordedAt) >= Date.parse(issuedAt));
      });
    var selected = {
      changeOrderId: projectionUuid(source.changeOrderId),
      changeNumber: projectionInteger(
        source.changeNumber,
        1,
        Number.MAX_SAFE_INTEGER
      ),
      state: state,
      addedScope: projectionText(source.addedScope, 20, 2000, true),
      pricing: customBuildChangePricingProjection(source.pricing),
      targetCompletionDate: projectionDate(source.targetCompletionDate),
      quoteDigest: projectionDigest(source.quoteDigest),
      disclosureDigest: projectionDigest(source.disclosureDigest),
      issuedAt: issuedAt,
      expiresAt: expiresAt,
      acceptedAt: acceptedAt,
      declinedAt: declinedAt,
      expiredAt: expiredAt,
      void: selectedVoid
    };
    if (owner) {
      selected.createdByOperatorUserId = projectionUuid(
        source.createdByOperatorUserId
      );
    }
    return selected;
  }

  function customBuildCompletionEvidenceProjection(value, owner) {
    var fields = [
      "accessibleDescription",
      "byteCount",
      "capturedAt",
      "contentDigest",
      "evidenceId",
      "imageHeight",
      "imageWidth",
      "mediaType",
      "viewport"
    ];
    if (owner) {
      fields.push(
        "createdByOperatorUserId",
        "effectiveScopeDigest",
        "progressRevision"
      );
    }
    var source = projectionObject(value, fields);
    var selected = {
      evidenceId: projectionUuid(source.evidenceId),
      viewport: projectionText(source.viewport, 1, 20, false),
      accessibleDescription: projectionText(
        source.accessibleDescription,
        10,
        500,
        true
      ),
      mediaType: projectionText(source.mediaType, 1, 80, false),
      byteCount: projectionInteger(
        source.byteCount,
        1,
        MAXIMUM_ASSESSMENT_EVIDENCE_BYTES
      ),
      contentDigest: projectionDigest(source.contentDigest),
      imageWidth: projectionInteger(source.imageWidth, 240, 2048),
      imageHeight: projectionInteger(source.imageHeight, 1, 5000),
      capturedAt: projectionIso(source.capturedAt)
    };
    projectionInvariant(
      ["desktop", "phone"].includes(selected.viewport)
      && CUSTOM_BUILD_EVIDENCE_MEDIA_TYPES.includes(selected.mediaType)
      && (
        (selected.viewport === "desktop" && selected.imageWidth >= 768)
        || (selected.viewport === "phone" && selected.imageWidth <= 767)
      )
      && selected.imageWidth * selected.imageHeight <= 2048 * 5000
    );
    if (owner) {
      selected.progressRevision = projectionInteger(
        source.progressRevision,
        1,
        Number.MAX_SAFE_INTEGER
      );
      selected.effectiveScopeDigest = projectionDigest(
        source.effectiveScopeDigest
      );
      selected.createdByOperatorUserId = projectionUuid(
        source.createdByOperatorUserId
      );
    }
    return selected;
  }

  function customBuildCompletionChecksProjection(value) {
    var source = projectionObject(value, [
      "accessibilityBasics",
      "contactActions",
      "desktop",
      "links",
      "phone",
      "scope"
    ]);
    projectionInvariant(Object.keys(source).every(function (key) {
      return source[key] === true;
    }));
    return {
      scope: true,
      desktop: true,
      phone: true,
      links: true,
      contactActions: true,
      accessibilityBasics: true
    };
  }

  function customBuildCustomerCompletionProjection(value) {
    if (value === null) return null;
    var source = projectionObject(value, [
      "checks",
      "customerSummary",
      "evidence",
      "preparedAt",
      "state"
    ]);
    var evidence = projectionArray(source.evidence, 2, 12).map(function (entry) {
      return customBuildCompletionEvidenceProjection(entry, false);
    });
    var evidenceIds = evidence.map(function (entry) {
      return entry.evidenceId;
    });
    projectionInvariant(
      new Set(evidenceIds).size === evidenceIds.length
      && JSON.stringify(evidenceIds) ===
        JSON.stringify(evidenceIds.slice().sort())
      && evidence.some(function (entry) { return entry.viewport === "desktop"; })
      && evidence.some(function (entry) { return entry.viewport === "phone"; })
      && !evidence.some(function (desktop) {
        return desktop.viewport === "desktop"
          && evidence.some(function (phone) {
            return phone.viewport === "phone"
              && phone.contentDigest === desktop.contentDigest;
          });
      })
    );
    var state = projectionText(source.state, 1, 80, false);
    projectionInvariant(CUSTOM_BUILD_COMPLETION_STATES.includes(state));
    return {
      state: state,
      customerSummary: projectionText(
        source.customerSummary,
        20,
        1000,
        true
      ),
      checks: customBuildCompletionChecksProjection(source.checks),
      preparedAt: projectionIso(source.preparedAt),
      evidence: evidence
    };
  }

  function customBuildOwnerCompletionProjection(value, evidence) {
    if (value === null) return null;
    var source = projectionObject(value, [
      "baseScopeDigest",
      "checks",
      "completionId",
      "createdByOperatorUserId",
      "customerSummary",
      "effectiveChangeOrderDigests",
      "effectiveScopeDigest",
      "evidenceIds",
      "packageDigest",
      "preparedAt",
      "progressRevision",
      "state"
    ]);
    var evidenceIds = projectionArray(source.evidenceIds, 2, 12)
      .map(projectionUuid);
    projectionInvariant(
      new Set(evidenceIds).size === evidenceIds.length
      && JSON.stringify(evidenceIds) ===
        JSON.stringify(evidenceIds.slice().sort())
    );
    var selectedEvidence = new Map(evidence.map(function (entry) {
      return [entry.evidenceId, entry];
    }));
    projectionInvariant(evidenceIds.every(function (id) {
      return selectedEvidence.has(id);
    }));
    var packagedEvidence = evidenceIds.map(function (id) {
      return selectedEvidence.get(id);
    });
    projectionInvariant(
      packagedEvidence.some(function (entry) { return entry.viewport === "desktop"; })
      && packagedEvidence.some(function (entry) { return entry.viewport === "phone"; })
      && !packagedEvidence.some(function (desktop) {
        return desktop.viewport === "desktop"
          && packagedEvidence.some(function (phone) {
            return phone.viewport === "phone"
              && phone.contentDigest === desktop.contentDigest;
          });
      })
    );
    var state = projectionText(source.state, 1, 80, false);
    projectionInvariant(CUSTOM_BUILD_COMPLETION_STATES.includes(state));
    return {
      state: state,
      customerSummary: projectionText(
        source.customerSummary,
        20,
        1000,
        true
      ),
      checks: customBuildCompletionChecksProjection(source.checks),
      preparedAt: projectionIso(source.preparedAt),
      completionId: projectionUuid(source.completionId),
      progressRevision: projectionInteger(
        source.progressRevision,
        1,
        Number.MAX_SAFE_INTEGER
      ),
      evidenceIds: evidenceIds,
      baseScopeDigest: projectionDigest(source.baseScopeDigest),
      effectiveChangeOrderDigests: projectionArray(
        source.effectiveChangeOrderDigests,
        0,
        Number.MAX_SAFE_INTEGER
      ).map(projectionDigest),
      effectiveScopeDigest: projectionDigest(source.effectiveScopeDigest),
      packageDigest: projectionDigest(source.packageDigest),
      createdByOperatorUserId: projectionUuid(
        source.createdByOperatorUserId
      )
    };
  }

  function validateCustomBuildCustomerChangeCompletion(value) {
    var source = projectionObject(value, [
      "changeOrders",
      "completion",
      "schema",
      "state"
    ]);
    projectionInvariant(source.schema === CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA);
    var state = projectionText(source.state, 1, 80, false);
    projectionInvariant(CUSTOM_BUILD_CHANGE_COMPLETION_STATES.includes(state));
    var orderSource = projectionObject(source.changeOrders, ["active", "history"]);
    var active = orderSource.active === null
      ? null
      : customBuildChangeOrderProjection(orderSource.active, false);
    var history = projectionArray(
      orderSource.history,
      0,
      Number.MAX_SAFE_INTEGER
    ).map(function (entry) {
      return customBuildChangeOrderProjection(entry, false);
    });
    var completion = customBuildCustomerCompletionProjection(source.completion);
    var allOrders = history.concat(active === null ? [] : [active]);
    var orderIds = allOrders.map(function (entry) { return entry.changeOrderId; });
    var changeNumbers = allOrders.map(function (entry) { return entry.changeNumber; });
    projectionInvariant(
      new Set(orderIds).size === orderIds.length
      && new Set(changeNumbers).size === changeNumbers.length
      && history.every(function (entry) {
        return !["issued", "accepted_payment_required"].includes(entry.state);
      })
    );
    if (state === "not_available") {
      projectionInvariant(
        active === null && history.length === 0 && completion === null
      );
    } else if (state === "building") {
      projectionInvariant(active === null && completion === null);
    } else if (state === "change_order_review") {
      projectionInvariant(
        active !== null && active.state === "issued" && completion === null
      );
    } else if (state === "change_order_payment_required") {
      projectionInvariant(
        active !== null
        && active.state === "accepted_payment_required"
        && completion === null
      );
    } else {
      projectionInvariant(
        active === null && completion !== null && completion.state === state
      );
    }
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
      state: state,
      changeOrders: { active: active, history: history },
      completion: completion
    });
  }

  function validateCustomBuildOwnerChangeCompletion(
    value,
    expectedJobId,
    expectedOrganizationId
  ) {
    var source = projectionObject(value, [
      "changeOrders",
      "completion",
      "evidence",
      "job",
      "proofBinding",
      "schema",
      "state"
    ]);
    projectionInvariant(source.schema === CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA);
    var state = projectionText(source.state, 1, 80, false);
    projectionInvariant(
      CUSTOM_BUILD_CHANGE_COMPLETION_STATES.includes(state)
      && state !== "not_available"
    );
    var jobSource = projectionObject(source.job, [
      "caseId",
      "currency",
      "customerId",
      "finalDueMinor",
      "jobId",
      "openedAt",
      "organizationId",
      "projectId",
      "state",
      "targetCompletionDate"
    ]);
    var job = {
      jobId: projectionUuid(jobSource.jobId),
      organizationId: projectionUuid(jobSource.organizationId),
      projectId: projectionUuid(jobSource.projectId),
      caseId: projectionUuid(jobSource.caseId),
      customerId: projectionUuid(jobSource.customerId),
      state: projectionText(jobSource.state, 1, 40, false),
      targetCompletionDate: projectionDate(jobSource.targetCompletionDate),
      finalDueMinor: projectionInteger(
        jobSource.finalDueMinor,
        0,
        Number.MAX_SAFE_INTEGER
      ),
      currency: projectionText(jobSource.currency, 3, 3, false),
      openedAt: projectionIso(jobSource.openedAt)
    };
    projectionInvariant(
      job.jobId === expectedJobId
      && job.organizationId === expectedOrganizationId
      && job.state === "open"
      && job.currency === "USD"
    );
    var proofBinding = null;
    if (source.proofBinding !== null) {
      var bindingSource = projectionObject(source.proofBinding, [
        "effectiveScopeDigest",
        "progressRevision"
      ]);
      proofBinding = {
        progressRevision: projectionInteger(
          bindingSource.progressRevision,
          1,
          Number.MAX_SAFE_INTEGER
        ),
        effectiveScopeDigest: projectionDigest(
          bindingSource.effectiveScopeDigest
        )
      };
    }
    var changeOrders = projectionArray(
      source.changeOrders,
      0,
      Number.MAX_SAFE_INTEGER
    ).map(function (entry) {
      return customBuildChangeOrderProjection(entry, true);
    });
    var evidence = projectionArray(source.evidence, 0, 12).map(function (entry) {
      return customBuildCompletionEvidenceProjection(entry, true);
    });
    for (var index = 1; index < changeOrders.length; index += 1) {
      projectionInvariant(
        changeOrders[index - 1].changeNumber < changeOrders[index].changeNumber
      );
    }
    for (var evidenceIndex = 1; evidenceIndex < evidence.length; evidenceIndex += 1) {
      var prior = evidence[evidenceIndex - 1];
      var current = evidence[evidenceIndex];
      projectionInvariant(
        prior.capturedAt < current.capturedAt
        || (
          prior.capturedAt === current.capturedAt
          && prior.evidenceId < current.evidenceId
        )
      );
    }
    projectionInvariant(
      new Set(changeOrders.map(function (entry) {
        return entry.changeOrderId;
      })).size === changeOrders.length
      && new Set(evidence.map(function (entry) {
        return entry.evidenceId;
      })).size === evidence.length
      && changeOrders.filter(function (entry) {
        return ["issued", "accepted_payment_required"].includes(entry.state);
      }).length <= 1
    );
    var completion = customBuildOwnerCompletionProjection(
      source.completion,
      evidence
    );
    var active = changeOrders.find(function (entry) {
      return ["issued", "accepted_payment_required"].includes(entry.state);
    }) || null;
    if (completion !== null) {
      var effectiveDigests = changeOrders
        .filter(function (entry) { return entry.state === "effective"; })
        .map(function (entry) { return entry.quoteDigest; });
      projectionInvariant(
        JSON.stringify(completion.effectiveChangeOrderDigests) ===
          JSON.stringify(effectiveDigests)
        && proofBinding !== null
        && completion.progressRevision === proofBinding.progressRevision
        && completion.effectiveScopeDigest ===
          proofBinding.effectiveScopeDigest
        && completion.evidenceIds.every(function (evidenceId) {
          var selectedEvidence = evidence.find(function (entry) {
            return entry.evidenceId === evidenceId;
          });
          return selectedEvidence
            && selectedEvidence.progressRevision ===
              proofBinding.progressRevision
            && selectedEvidence.effectiveScopeDigest ===
              proofBinding.effectiveScopeDigest;
        })
      );
    }
    if (state === "building") {
      projectionInvariant(active === null && completion === null);
    } else if (state === "change_order_review") {
      projectionInvariant(
        active !== null && active.state === "issued" && completion === null
      );
    } else if (state === "change_order_payment_required") {
      projectionInvariant(
        active !== null
        && active.state === "accepted_payment_required"
        && completion === null
      );
    } else {
      projectionInvariant(
        active === null && completion !== null && completion.state === state
      );
    }
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_CHANGE_COMPLETION_SCHEMA,
      state: state,
      job: job,
      proofBinding: proofBinding,
      changeOrders: changeOrders,
      evidence: evidence,
      completion: completion
    });
  }

  function invalidCustomBuildChangePaymentResponse() {
    return new APIError({
      code: "INVALID_CUSTOM_BUILD_CHANGE_PAYMENT_RESPONSE",
      message:
        "Site Sourcery returned invalid added-work payment information. Refresh before replacing the information already shown.",
      retryable: true
    });
  }

  function changePaymentInvariant(condition) {
    if (!condition) throw invalidCustomBuildChangePaymentResponse();
  }

  function changePaymentObject(value, expected) {
    changePaymentInvariant(
      isObject(value)
      && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null)
      && JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.slice().sort())
    );
    return value;
  }

  function changePaymentArray(value, minimum, maximum) {
    changePaymentInvariant(
      Array.isArray(value)
      && value.length >= minimum
      && value.length <= maximum
    );
    return value;
  }

  function changePaymentText(value, minimum, maximum) {
    changePaymentInvariant(
      typeof value === "string"
      && value === value.trim()
      && value.length >= minimum
      && value.length <= maximum
      && !CONTROL_CHARACTER.test(value)
    );
    return value;
  }

  function changePaymentUuid(value) {
    changePaymentInvariant(typeof value === "string" && UUID.test(value));
    return value;
  }

  function changePaymentNullableUuid(value) {
    return value === null ? null : changePaymentUuid(value);
  }

  function changePaymentDigest(value) {
    changePaymentInvariant(typeof value === "string" && SHA256.test(value));
    return value;
  }

  function changePaymentInteger(value, minimum, maximum) {
    changePaymentInvariant(
      typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= minimum
      && value <= maximum
    );
    return value;
  }

  function changePaymentDate(value) {
    var parsed = typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? new Date(value + "T00:00:00.000Z")
      : null;
    changePaymentInvariant(
      parsed !== null
      && Number.isFinite(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value
    );
    return value;
  }

  function changePaymentIso(value) {
    var parsed = typeof value === "string" ? new Date(value) : null;
    changePaymentInvariant(
      parsed !== null
      && Number.isFinite(parsed.getTime())
      && parsed.toISOString() === value
    );
    return value;
  }

  function changePaymentNullableIso(value) {
    return value === null ? null : changePaymentIso(value);
  }

  function changePaymentNullableProviderCode(value) {
    changePaymentInvariant(
      value === null
      || (
        typeof value === "string"
        && CUSTOM_BUILD_CHANGE_SAFE_PROVIDER_CODE.test(value)
      )
    );
    return value;
  }

  function changePaymentCheckoutUrl(value, expiresAt) {
    changePaymentInvariant(
      typeof value === "string"
      && value.length >= 20
      && value.length <= 2000
    );
    var parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      parsed = null;
    }
    changePaymentInvariant(
      parsed !== null
      && parsed.protocol === "https:"
      && parsed.hostname === "checkout.stripe.com"
      && parsed.port === ""
      && !parsed.username
      && !parsed.password
      && Date.parse(expiresAt) > Date.now()
    );
    return value;
  }

  function customBuildChangeInvoiceRecord(value, state) {
    var source = changePaymentObject(value, [
      "acceptedDisclosureDigest",
      "acceptedQuoteDigest",
      "changeAcceptanceId",
      "changeNumber",
      "changeOrderId",
      "invoiceDigest",
      "invoiceId",
      "invoiceNumber",
      "issuedAt",
      "lines",
      "payment",
      "subtotal",
      "targetCompletionDate",
      "tax",
      "total"
    ]);
    var invoiceId = changePaymentUuid(source.invoiceId);
    var invoiceNumber = changePaymentText(
      source.invoiceNumber,
      41,
      41
    );
    changePaymentInvariant(
      CUSTOM_BUILD_CHANGE_INVOICE_NUMBER.test(invoiceNumber)
      && invoiceNumber === "SSCB-CHG-"
        + invoiceId.replace(/-/gu, "").toUpperCase()
    );
    var changeNumber = changePaymentInteger(
      source.changeNumber,
      1,
      100000
    );
    var lines = changePaymentArray(source.lines, 1, 1).map(function (entry) {
      var line = changePaymentObject(entry, [
        "amountMinor",
        "componentKey",
        "currency",
        "displayName",
        "lineNumber",
        "quantity",
        "unitAmountMinor"
      ]);
      var quantity = changePaymentInteger(line.quantity, 1, 40);
      var unitAmountMinor = changePaymentInteger(
        line.unitAmountMinor,
        12500,
        12500
      );
      var amountMinor = changePaymentInteger(
        line.amountMinor,
        12500,
        40 * 12500
      );
      changePaymentInvariant(
        line.lineNumber === 1
        && line.componentKey === "custom_build_change_units"
        && line.displayName === "Custom build change #" + changeNumber
          + " — added-work units"
        && amountMinor === quantity * unitAmountMinor
        && line.currency === "USD"
      );
      return {
        lineNumber: 1,
        componentKey: "custom_build_change_units",
        displayName: line.displayName,
        quantity: quantity,
        unitAmountMinor: unitAmountMinor,
        amountMinor: amountMinor,
        currency: "USD"
      };
    });
    var subtotalSource = changePaymentObject(
      source.subtotal,
      ["amountMinor", "currency"]
    );
    var subtotalMinor = changePaymentInteger(
      subtotalSource.amountMinor,
      12500,
      40 * 12500
    );
    changePaymentInvariant(
      subtotalSource.currency === "USD"
      && subtotalMinor === lines[0].amountMinor
    );
    var taxSource = changePaymentObject(source.tax, ["amountMinor", "state"]);
    var totalSource = changePaymentObject(
      source.total,
      ["amountMinor", "currency", "state"]
    );
    var paymentSource = changePaymentObject(source.payment, [
      "chargeOccurred",
      "checkoutExpiresAt",
      "checkoutUrl",
      "settledAt"
    ]);
    var issuedAt = changePaymentIso(source.issuedAt);
    var tax;
    var total;
    var payment;
    if (state === "paid") {
      var taxMinor = changePaymentInteger(
        taxSource.amountMinor,
        0,
        99999999
      );
      var totalMinor = changePaymentInteger(
        totalSource.amountMinor,
        subtotalMinor,
        Number.MAX_SAFE_INTEGER
      );
      var settledAt = changePaymentIso(paymentSource.settledAt);
      changePaymentInvariant(
        taxSource.state === "settled"
        && totalSource.currency === "USD"
        && totalSource.state === "settled"
        && totalMinor === subtotalMinor + taxMinor
        && paymentSource.chargeOccurred === true
        && paymentSource.checkoutUrl === null
        && paymentSource.checkoutExpiresAt === null
        && Date.parse(settledAt) >= Date.parse(issuedAt)
      );
      tax = { amountMinor: taxMinor, state: "settled" };
      total = {
        amountMinor: totalMinor,
        currency: "USD",
        state: "settled"
      };
      payment = {
        chargeOccurred: true,
        checkoutUrl: null,
        checkoutExpiresAt: null,
        settledAt: settledAt
      };
    } else {
      changePaymentInvariant(
        taxSource.amountMinor === null
        && taxSource.state === "calculated_at_checkout"
        && totalSource.amountMinor === null
        && totalSource.currency === "USD"
        && totalSource.state === "shown_at_checkout"
        && paymentSource.chargeOccurred === false
        && paymentSource.settledAt === null
      );
      var checkoutExpiresAt = null;
      var checkoutUrl = null;
      if (state === "checkout_ready") {
        checkoutExpiresAt = changePaymentIso(
          paymentSource.checkoutExpiresAt
        );
        checkoutUrl = changePaymentCheckoutUrl(
          paymentSource.checkoutUrl,
          checkoutExpiresAt
        );
        changePaymentInvariant(
          Date.parse(checkoutExpiresAt) > Date.parse(issuedAt)
        );
      } else {
        changePaymentInvariant(
          paymentSource.checkoutUrl === null
          && paymentSource.checkoutExpiresAt === null
        );
      }
      tax = { amountMinor: null, state: "calculated_at_checkout" };
      total = {
        amountMinor: null,
        currency: "USD",
        state: "shown_at_checkout"
      };
      payment = {
        chargeOccurred: false,
        checkoutUrl: checkoutUrl,
        checkoutExpiresAt: checkoutExpiresAt,
        settledAt: null
      };
    }
    return {
      invoiceId: invoiceId,
      invoiceNumber: invoiceNumber,
      invoiceDigest: changePaymentDigest(source.invoiceDigest),
      changeOrderId: changePaymentUuid(source.changeOrderId),
      changeAcceptanceId: changePaymentUuid(source.changeAcceptanceId),
      changeNumber: changeNumber,
      acceptedQuoteDigest: changePaymentDigest(source.acceptedQuoteDigest),
      acceptedDisclosureDigest: changePaymentDigest(
        source.acceptedDisclosureDigest
      ),
      issuedAt: issuedAt,
      targetCompletionDate: changePaymentDate(
        source.targetCompletionDate
      ),
      lines: lines,
      subtotal: { amountMinor: subtotalMinor, currency: "USD" },
      tax: tax,
      total: total,
      payment: payment
    };
  }

  function expectedCustomBuildChangeOrder(value) {
    if (value === null || value === undefined) return null;
    try {
      return customBuildChangeOrderProjection(value, false);
    } catch (_error) {
      throw invalidCustomBuildChangePaymentResponse();
    }
  }

  function validateCustomBuildChangeInvoice(
    value,
    expectedChangeOrderInput
  ) {
    var source = changePaymentObject(value, [
      "action",
      "invoice",
      "schema",
      "state"
    ]);
    var state = changePaymentText(source.state, 1, 80);
    changePaymentInvariant(
      source.schema === CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA
      && CUSTOM_BUILD_CHANGE_PAYMENT_STATES.includes(state)
    );
    var actionSource = changePaymentObject(
      source.action,
      ["available", "reason"]
    );
    changePaymentInvariant(
      typeof actionSource.available === "boolean"
      && actionSource.available === (state === "checkout_available")
      && actionSource.reason === (
        state === "checkout_available"
          ? null
          : state === "not_available" ? "invoice_not_available" : state
      )
    );
    var expectedOrder = expectedCustomBuildChangeOrder(
      expectedChangeOrderInput
    );
    if (state === "not_available") {
      changePaymentInvariant(source.invoice === null);
      if (expectedOrder !== null) {
        changePaymentInvariant(
          ["issued", "declined", "expired"].includes(expectedOrder.state)
          || (
            expectedOrder.state === "voided"
            && expectedOrder.acceptedAt === null
          )
        );
      }
      return deepFreezeProjection({
        schema: CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA,
        state: state,
        invoice: null,
        action: { available: false, reason: "invoice_not_available" }
      });
    }
    var invoice = customBuildChangeInvoiceRecord(source.invoice, state);
    if (expectedOrder !== null) {
      changePaymentInvariant(
        invoice.changeOrderId === expectedOrder.changeOrderId
        && invoice.changeNumber === expectedOrder.changeNumber
        && invoice.acceptedQuoteDigest === expectedOrder.quoteDigest
        && invoice.acceptedDisclosureDigest ===
          expectedOrder.disclosureDigest
        && invoice.targetCompletionDate ===
          expectedOrder.targetCompletionDate
        && invoice.lines[0].quantity === expectedOrder.pricing.unitCount
        && invoice.subtotal.amountMinor ===
          expectedOrder.pricing.subtotalMinor
        && expectedOrder.acceptedAt !== null
        && invoice.issuedAt === expectedOrder.acceptedAt
      );
      if (expectedOrder.state === "accepted_payment_required") {
        changePaymentInvariant([
          "payment_held",
          "checkout_available",
          "checkout_ready",
          "checkout_expired",
          "reconciliation_required"
        ].includes(state));
      } else if (expectedOrder.state === "effective") {
        changePaymentInvariant(state === "paid");
      } else if (expectedOrder.state === "voided") {
        changePaymentInvariant(state === "voided");
      } else {
        changePaymentInvariant(false);
      }
    }
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_CHANGE_PAYMENT_INVOICE_SCHEMA,
      state: state,
      invoice: invoice,
      action: {
        available: actionSource.available,
        reason: actionSource.reason
      }
    });
  }

  function checkoutExpectationInvoice(value) {
    if (value === null || value === undefined) return null;
    var projection = validateCustomBuildChangeInvoice(value);
    changePaymentInvariant(projection.invoice !== null);
    return projection.invoice;
  }

  function validateCustomBuildChangeCheckout(value, expectationInput) {
    var source = changePaymentObject(value, ["checkout", "schema", "state"]);
    changePaymentInvariant(
      source.schema === CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA
      && source.state === "ready"
    );
    var checkoutSource = changePaymentObject(source.checkout, [
      "changeOrderId",
      "chargeOccurred",
      "expiresAt",
      "invoiceId",
      "invoiceNumber",
      "subtotal",
      "tax",
      "total",
      "url"
    ]);
    var invoiceId = changePaymentUuid(checkoutSource.invoiceId);
    var invoiceNumber = changePaymentText(
      checkoutSource.invoiceNumber,
      41,
      41
    );
    var expiresAt = changePaymentIso(checkoutSource.expiresAt);
    var subtotalSource = changePaymentObject(
      checkoutSource.subtotal,
      ["amountMinor", "currency"]
    );
    var subtotalMinor = changePaymentInteger(
      subtotalSource.amountMinor,
      12500,
      40 * 12500
    );
    var taxSource = changePaymentObject(
      checkoutSource.tax,
      ["amountMinor", "state"]
    );
    var totalSource = changePaymentObject(
      checkoutSource.total,
      ["amountMinor", "currency", "state"]
    );
    var selected = {
      schema: CUSTOM_BUILD_CHANGE_PAYMENT_CHECKOUT_SCHEMA,
      state: "ready",
      checkout: {
        invoiceId: invoiceId,
        invoiceNumber: invoiceNumber,
        changeOrderId: changePaymentUuid(checkoutSource.changeOrderId),
        url: changePaymentCheckoutUrl(checkoutSource.url, expiresAt),
        expiresAt: expiresAt,
        subtotal: { amountMinor: subtotalMinor, currency: "USD" },
        tax: { amountMinor: null, state: "calculated_at_checkout" },
        total: {
          amountMinor: null,
          currency: "USD",
          state: "shown_at_checkout"
        },
        chargeOccurred: false
      }
    };
    changePaymentInvariant(
      CUSTOM_BUILD_CHANGE_INVOICE_NUMBER.test(invoiceNumber)
      && invoiceNumber === "SSCB-CHG-"
        + invoiceId.replace(/-/gu, "").toUpperCase()
      && subtotalSource.currency === "USD"
      && subtotalMinor % 12500 === 0
      && taxSource.amountMinor === null
      && taxSource.state === "calculated_at_checkout"
      && totalSource.amountMinor === null
      && totalSource.currency === "USD"
      && totalSource.state === "shown_at_checkout"
      && checkoutSource.chargeOccurred === false
    );
    var expectation = checkoutExpectationInvoice(expectationInput);
    if (expectation !== null) {
      changePaymentInvariant(
        selected.checkout.invoiceId === expectation.invoiceId
        && selected.checkout.invoiceNumber === expectation.invoiceNumber
        && selected.checkout.changeOrderId === expectation.changeOrderId
        && selected.checkout.subtotal.amountMinor ===
          expectation.subtotal.amountMinor
      );
    }
    return deepFreezeProjection(selected);
  }

  function customBuildChangeOwnerPayment(value) {
    var source = changePaymentObject(value, [
      "action",
      "invoice",
      "owner",
      "schema",
      "state"
    ]);
    var invoice = validateCustomBuildChangeInvoice({
      schema: source.schema,
      state: source.state,
      invoice: source.invoice,
      action: source.action
    });
    changePaymentInvariant(invoice.invoice !== null);
    var ownerSource = changePaymentObject(source.owner, [
      "attemptId",
      "attemptState",
      "canReconcileCreation",
      "canReconcileSettlement",
      "eventId",
      "eventState",
      "providerEffectCertainty",
      "providerErrorCode",
      "providerRequestExpiresAt",
      "receiptSource",
      "reconciliationCode"
    ]);
    var attemptId = changePaymentNullableUuid(ownerSource.attemptId);
    var attemptState = ownerSource.attemptState;
    var providerEffectCertainty = ownerSource.providerEffectCertainty;
    var providerErrorCode = changePaymentNullableProviderCode(
      ownerSource.providerErrorCode
    );
    var providerRequestExpiresAt = changePaymentNullableIso(
      ownerSource.providerRequestExpiresAt
    );
    var receiptSource = ownerSource.receiptSource;
    changePaymentInvariant(
      attemptState === null
      || CUSTOM_BUILD_CHANGE_CHECKOUT_ATTEMPT_STATES.includes(attemptState)
    );
    changePaymentInvariant(
      providerEffectCertainty === null
      || ["not_submitted", "confirmed", "ambiguous"].includes(
        providerEffectCertainty
      )
    );
    if (attemptState === null) {
      changePaymentInvariant(
        attemptId === null
        && providerEffectCertainty === null
        && providerErrorCode === null
        && providerRequestExpiresAt === null
        && receiptSource === null
      );
    } else {
      changePaymentInvariant(
        attemptId !== null && providerRequestExpiresAt !== null
      );
      if (attemptState === "provider_pending") {
        changePaymentInvariant(
          providerEffectCertainty === "not_submitted"
          && providerErrorCode === null
        );
      } else if (attemptState === "ready") {
        changePaymentInvariant(
          providerEffectCertainty === "confirmed"
          && providerErrorCode === null
        );
      } else if (attemptState === "failed") {
        changePaymentInvariant(
          providerEffectCertainty === "not_submitted"
          && providerErrorCode !== null
        );
      } else if (attemptState === "persistence_unknown") {
        changePaymentInvariant(
          providerEffectCertainty === "ambiguous"
          && providerErrorCode !== null
        );
      } else {
        changePaymentInvariant(providerEffectCertainty === "confirmed");
      }
    }
    changePaymentInvariant(
      typeof ownerSource.canReconcileCreation === "boolean"
      && ownerSource.canReconcileCreation ===
        ["provider_pending", "persistence_unknown"].includes(
          attemptState
        )
      && typeof ownerSource.canReconcileSettlement === "boolean"
      && ownerSource.canReconcileSettlement === (attemptState === "ready")
      && [null, "stripe_event", "provider_readback"].includes(
        receiptSource
      )
    );
    var eventId = ownerSource.eventId;
    var eventState = ownerSource.eventState;
    var reconciliationCode = changePaymentNullableProviderCode(
      ownerSource.reconciliationCode
    );
    if (eventId === null) {
      changePaymentInvariant(
        eventState === null && reconciliationCode === null
      );
    } else {
      changePaymentInvariant(
        typeof eventId === "string"
        && CUSTOM_BUILD_CHANGE_STRIPE_EVENT_ID.test(eventId)
        && CUSTOM_BUILD_CHANGE_CHECKOUT_EVENT_STATES.includes(eventState)
        && (
          eventState === "reconciliation_required"
            ? reconciliationCode !== null
            : reconciliationCode === null
        )
        && ["ready", "paid"].includes(attemptState)
      );
    }
    if (
      attemptState === "paid"
      || eventState === "processed"
      || receiptSource !== null
    ) changePaymentInvariant(invoice.state === "paid");
    if (invoice.state === "paid") {
      changePaymentInvariant(
        invoice.state === "paid"
        && attemptState === "paid"
        && ["stripe_event", "provider_readback"].includes(receiptSource)
        && (
          receiptSource === "provider_readback"
            ? eventId === null
            : eventState === "processed"
        )
      );
    } else changePaymentInvariant(receiptSource === null);
    if (eventState === "pending") {
      changePaymentInvariant(
        attemptState === "ready"
        && ["checkout_ready", "checkout_expired"].includes(invoice.state)
      );
    }
    if (eventState === "reconciliation_required") {
      changePaymentInvariant(
        attemptState === "ready"
        && invoice.state === "reconciliation_required"
      );
    }
    if (
      ["provider_pending", "persistence_unknown"].includes(attemptState)
      || eventState === "reconciliation_required"
    ) {
      changePaymentInvariant(invoice.state === "reconciliation_required");
    }
    if (invoice.state === "reconciliation_required") {
      changePaymentInvariant(
        ["provider_pending", "persistence_unknown"].includes(attemptState)
        || eventState === "reconciliation_required"
      );
    }
    if (["checkout_ready", "checkout_expired"].includes(invoice.state)) {
      changePaymentInvariant(attemptState === "ready");
    }
    if (["checkout_available", "payment_held"].includes(invoice.state)) {
      changePaymentInvariant(
        [null, "provider_pending", "failed", "expired"].includes(
          attemptState
        )
      );
    }
    if (invoice.state === "voided") {
      changePaymentInvariant(
        [null, "failed", "expired"].includes(attemptState)
        && eventId === null
      );
    }
    return deepFreezeProjection({
      schema: invoice.schema,
      state: invoice.state,
      invoice: invoice.invoice,
      action: invoice.action,
      owner: {
        attemptId: attemptId,
        attemptState: attemptState,
        providerEffectCertainty: providerEffectCertainty,
        providerErrorCode: providerErrorCode,
        eventId: eventId,
        eventState: eventState,
        reconciliationCode: reconciliationCode,
        receiptSource: receiptSource,
        canReconcileCreation: ownerSource.canReconcileCreation,
        canReconcileSettlement: ownerSource.canReconcileSettlement,
        providerRequestExpiresAt: providerRequestExpiresAt
      }
    });
  }

  function validateCustomBuildChangeOwnerPayments(
    value,
    expectedJobId,
    expectedOrganizationId
  ) {
    var source = changePaymentObject(value, [
      "jobId",
      "organizationId",
      "payments",
      "schema"
    ]);
    var jobId = changePaymentUuid(source.jobId);
    var organizationId = changePaymentUuid(source.organizationId);
    changePaymentInvariant(
      source.schema === CUSTOM_BUILD_CHANGE_PAYMENT_OWNER_SCHEMA
      && jobId === expectedJobId
      && organizationId === expectedOrganizationId
    );
    var payments = changePaymentArray(source.payments, 0, 100000).map(
      customBuildChangeOwnerPayment
    );
    for (var index = 1; index < payments.length; index += 1) {
      changePaymentInvariant(
        payments[index - 1].invoice.changeNumber <
          payments[index].invoice.changeNumber
      );
    }
    changePaymentInvariant(
      new Set(payments.map(function (entry) {
        return entry.invoice.invoiceId;
      })).size === payments.length
      && new Set(payments.map(function (entry) {
        return entry.invoice.changeOrderId;
      })).size === payments.length
      && new Set(payments.map(function (entry) {
        return entry.invoice.changeAcceptanceId;
      })).size === payments.length
      && new Set(payments.map(function (entry) {
        return entry.owner.attemptId;
      }).filter(Boolean)).size === payments.filter(function (entry) {
        return entry.owner.attemptId !== null;
      }).length
    );
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_CHANGE_PAYMENT_OWNER_SCHEMA,
      organizationId: organizationId,
      jobId: jobId,
      payments: payments
    });
  }

  function validateCustomBuildChangeOwnerReconciliation(
    value,
    expected
  ) {
    var source = changePaymentObject(value, [
      "action",
      "attemptId",
      "changeOrderId",
      "checkout",
      "invoiceId",
      "jobId",
      "next",
      "organizationId",
      "reason",
      "schema",
      "settlement",
      "status"
    ]);
    var status = changePaymentText(source.status, 1, 80);
    var state = {
      checkout_ready: ["creation_reconciled", "customer_checkout"],
      payment_settled: [
        "settlement_reconciled",
        "custom_build_changed_work"
      ],
      checkout_expired: ["attempt_expired", "new_checkout_command"],
      reconciliation_required: ["retry_required", "owner_retry"]
    }[status];
    changePaymentInvariant(
      source.schema === CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_SCHEMA
      && state
      && changePaymentUuid(source.organizationId) ===
        expected.organizationId
      && changePaymentUuid(source.jobId) === expected.jobId
      && changePaymentUuid(source.attemptId) === expected.attemptId
      && changePaymentUuid(source.invoiceId) ===
        expected.payment.invoice.invoiceId
      && changePaymentUuid(source.changeOrderId) ===
        expected.payment.invoice.changeOrderId
      && source.action === state[0]
      && source.next === state[1]
    );
    var reason = changePaymentNullableProviderCode(source.reason);
    var checkout = null;
    if (status === "checkout_ready") {
      checkout = validateCustomBuildChangeCheckout(
        source.checkout,
        {
          schema: expected.payment.schema,
          state: expected.payment.state,
          invoice: expected.payment.invoice,
          action: expected.payment.action
        }
      );
      changePaymentInvariant(source.settlement === null);
    } else changePaymentInvariant(source.checkout === null);
    var settlement = null;
    if (status === "payment_settled") {
      var settlementSource = changePaymentObject(source.settlement, [
        "changeOrderId",
        "invoiceId",
        "next",
        "projectId",
        "receiptId",
        "schema",
        "status"
      ]);
      changePaymentInvariant(
        settlementSource.schema ===
          CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA
        && settlementSource.status === "payment_settled"
        && settlementSource.next === "custom_build_changed_work"
        && changePaymentUuid(settlementSource.projectId) ===
          expected.projectId
        && changePaymentUuid(settlementSource.changeOrderId) ===
          expected.payment.invoice.changeOrderId
        && changePaymentUuid(settlementSource.invoiceId) ===
          expected.payment.invoice.invoiceId
      );
      settlement = {
        schema: CUSTOM_BUILD_CHANGE_PAYMENT_SETTLEMENT_SCHEMA,
        status: "payment_settled",
        projectId: settlementSource.projectId,
        changeOrderId: settlementSource.changeOrderId,
        invoiceId: settlementSource.invoiceId,
        receiptId: changePaymentUuid(settlementSource.receiptId),
        next: "custom_build_changed_work"
      };
    } else changePaymentInvariant(source.settlement === null);
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_CHANGE_PAYMENT_RECONCILIATION_SCHEMA,
      status: status,
      organizationId: source.organizationId,
      jobId: source.jobId,
      attemptId: source.attemptId,
      invoiceId: source.invoiceId,
      changeOrderId: source.changeOrderId,
      action: source.action,
      next: source.next,
      reason: reason,
      checkout: checkout,
      settlement: settlement
    });
  }

  function invalidCustomBuildFinalResponse() {
    return new APIError({
      code: "INVALID_CUSTOM_BUILD_FINAL_RESPONSE",
      message:
        "Site Sourcery returned invalid final-payment or handoff information. Refresh before replacing the last verified information.",
      retryable: true
    });
  }

  function finalInvariant(condition) {
    if (!condition) throw invalidCustomBuildFinalResponse();
  }

  function finalObject(value, expected) {
    finalInvariant(
      isObject(value)
      && (Object.getPrototypeOf(value) === Object.prototype
        || Object.getPrototypeOf(value) === null)
      && JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expected.slice().sort())
    );
    return value;
  }

  function finalUuid(value) {
    finalInvariant(typeof value === "string" && UUID.test(value));
    return value;
  }

  function finalDigest(value) {
    finalInvariant(typeof value === "string" && SHA256.test(value));
    return value;
  }

  function finalIso(value) {
    finalInvariant(
      typeof value === "string"
      && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value
    );
    return value;
  }

  function finalInteger(value, minimum, maximum) {
    finalInvariant(
      typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= minimum
      && value <= maximum
    );
    return value;
  }

  function finalMoney(value, allowZero) {
    var source = finalObject(value, ["amountMinor", "currency"]);
    return {
      amountMinor: finalInteger(
        source.amountMinor,
        allowZero ? 0 : 1,
        Number.MAX_SAFE_INTEGER
      ),
      currency: source.currency === "USD" ? "USD" : finalInvariant(false)
    };
  }

  function finalWorkmanship(value) {
    var source = finalObject(
      value,
      ["coverage", "endsAt", "startsAt", "termDays"]
    );
    var startsAt = finalIso(source.startsAt);
    var endsAt = finalIso(source.endsAt);
    finalInvariant(
      source.coverage === "[start,end)"
      && source.termDays === 30
      && Date.parse(endsAt) - Date.parse(startsAt) ===
        30 * 24 * 60 * 60 * 1000
    );
    return {
      coverage: "[start,end)",
      termDays: 30,
      startsAt: startsAt,
      endsAt: endsAt
    };
  }

  function finalResponseHasRawProviderIdentifiers(value) {
    var forbidden = new Set([
      "chargeId",
      "checkoutSessionId",
      "eventId",
      "paymentIntentId",
      "stripeCustomerId"
    ]);
    function visit(selected) {
      if (Array.isArray(selected)) return selected.some(visit);
      if (!isObject(selected)) return false;
      return Object.keys(selected).some(function (key) {
        return forbidden.has(key) || visit(selected[key]);
      });
    }
    return visit(value);
  }

  function validateCustomBuildFinalState(value, expectedProjectId) {
    var source = finalObject(value, [
      "action",
      "completion",
      "handoff",
      "invoice",
      "jobId",
      "obligation",
      "payment",
      "projectId",
      "schema",
      "state"
    ]);
    var projectId = finalUuid(source.projectId);
    var states = [
      "completion_required",
      "checkout_held",
      "checkout_available",
      "checkout_ready",
      "checkout_expired",
      "payment_reconciliation_required",
      "paid_handoff_pending",
      "cleared_no_balance_handoff_pending",
      "handed_off"
    ];
    finalInvariant(
      source.schema === CUSTOM_BUILD_FINAL_STATE_SCHEMA
      && states.includes(source.state)
      && (!expectedProjectId || projectId === expectedProjectId)
      && !finalResponseHasRawProviderIdentifiers(source)
    );
    var actionSource = finalObject(
      source.action,
      ["checkoutAvailable", "handoffAvailable", "reason"]
    );
    finalInvariant(
      typeof actionSource.checkoutAvailable === "boolean"
      && typeof actionSource.handoffAvailable === "boolean"
      && actionSource.checkoutAvailable ===
        (source.state === "checkout_available")
      && actionSource.handoffAvailable === false
      && (actionSource.reason === null
        || (typeof actionSource.reason === "string"
          && actionSource.reason.length <= 100))
    );
    if (source.state === "completion_required") {
      var unavailable = finalObject(
        source.handoff,
        ["documentId", "state", "workmanshipEndsAt", "workmanshipStartsAt"]
      );
      finalInvariant(
        source.jobId === null
        && source.completion === null
        && source.obligation === null
        && source.invoice === null
        && source.payment === null
        && unavailable.state === "unavailable"
        && unavailable.documentId === null
        && unavailable.workmanshipStartsAt === null
        && unavailable.workmanshipEndsAt === null
      );
      return deepFreezeProjection(structuredClone(source));
    }

    var jobId = finalUuid(source.jobId);
    var completionSource = finalObject(
      source.completion,
      ["completedAt", "packageDigest", "packageId"]
    );
    var completion = {
      packageId: finalUuid(completionSource.packageId),
      packageDigest: finalDigest(completionSource.packageDigest),
      completedAt: finalIso(completionSource.completedAt)
    };
    var obligationSource = finalObject(source.obligation, [
      "amount",
      "boundAt",
      "installmentNumber",
      "obligationDigest",
      "obligationId",
      "workmanshipCorrectionDays"
    ]);
    var obligation = {
      obligationId: finalUuid(obligationSource.obligationId),
      obligationDigest: finalDigest(obligationSource.obligationDigest),
      amount: finalMoney(obligationSource.amount, true),
      installmentNumber: obligationSource.installmentNumber,
      workmanshipCorrectionDays: obligationSource.workmanshipCorrectionDays,
      boundAt: finalIso(obligationSource.boundAt)
    };
    finalInvariant(
      obligation.workmanshipCorrectionDays === 30
      && (obligation.installmentNumber === null
        || obligation.installmentNumber === 2)
      && (obligation.amount.amountMinor === 0
        ? obligation.installmentNumber === null
        : obligation.installmentNumber === 2)
    );

    var invoice = null;
    if (source.invoice !== null) {
      var invoiceSource = finalObject(source.invoice, [
        "credit",
        "invoiceDigest",
        "invoiceId",
        "invoiceNumber",
        "issuedAt",
        "lines",
        "purpose",
        "subtotal",
        "tax",
        "total"
      ]);
      finalInvariant(
        invoiceSource.purpose === "custom_build_final"
        && CUSTOM_BUILD_FINAL_INVOICE_NUMBER.test(invoiceSource.invoiceNumber)
        && invoiceSource.invoiceNumber === "SSCB-FINAL-"
          + finalUuid(invoiceSource.invoiceId).replace(/-/gu, "").toUpperCase()
        && finalDigest(invoiceSource.invoiceDigest)
        && Array.isArray(invoiceSource.lines)
        && invoiceSource.lines.length === 1
      );
      var lineSource = finalObject(invoiceSource.lines[0], [
        "amountMinor",
        "componentKey",
        "creditMinor",
        "currency",
        "displayName",
        "lineNumber",
        "quantity",
        "unitAmountMinor"
      ]);
      var subtotal = finalMoney(invoiceSource.subtotal, false);
      var credit = finalMoney(invoiceSource.credit, true);
      finalInvariant(
        lineSource.lineNumber === 1
        && lineSource.componentKey === "custom_build_final_installment"
        && lineSource.displayName ===
          "Custom website build final installment"
        && lineSource.quantity === 1
        && lineSource.currency === "USD"
        && lineSource.creditMinor === 0
        && lineSource.unitAmountMinor === obligation.amount.amountMinor
        && lineSource.amountMinor === obligation.amount.amountMinor
        && subtotal.amountMinor === obligation.amount.amountMinor
        && credit.amountMinor === 0
      );
      var taxSource = finalObject(
        invoiceSource.tax,
        ["amountMinor", "state"]
      );
      var totalSource = finalObject(
        invoiceSource.total,
        ["amountMinor", "currency", "state"]
      );
      finalInvariant(
        totalSource.currency === "USD"
        && (
          (taxSource.state === "calculated_at_checkout"
            && taxSource.amountMinor === null
            && totalSource.state === "shown_at_checkout"
            && totalSource.amountMinor === null)
          || (taxSource.state === "settled"
            && finalInteger(taxSource.amountMinor, 0, Number.MAX_SAFE_INTEGER) >= 0
            && totalSource.state === "settled"
            && finalInteger(totalSource.amountMinor, 1, Number.MAX_SAFE_INTEGER) ===
              obligation.amount.amountMinor + taxSource.amountMinor)
        )
      );
      invoice = {
        invoiceId: invoiceSource.invoiceId,
        invoiceNumber: invoiceSource.invoiceNumber,
        invoiceDigest: invoiceSource.invoiceDigest,
        purpose: "custom_build_final",
        issuedAt: finalIso(invoiceSource.issuedAt),
        lines: [structuredClone(lineSource)],
        subtotal: subtotal,
        credit: credit,
        tax: structuredClone(taxSource),
        total: structuredClone(totalSource)
      };
    }

    var payment;
    if (obligation.amount.amountMinor === 0) {
      var zeroSource = finalObject(
        source.payment,
        ["chargeOccurred", "state", "zeroBalanceClearance"]
      );
      var clearanceSource = finalObject(
        zeroSource.zeroBalanceClearance,
        ["clearanceDigest", "clearanceId", "clearedAt"]
      );
      finalInvariant(
        invoice === null
        && zeroSource.state === "cleared_no_balance"
        && zeroSource.chargeOccurred === false
        && source.state !== "paid_handoff_pending"
      );
      payment = {
        state: "cleared_no_balance",
        chargeOccurred: false,
        zeroBalanceClearance: {
          clearanceId: finalUuid(clearanceSource.clearanceId),
          clearanceDigest: finalDigest(clearanceSource.clearanceDigest),
          clearedAt: finalIso(clearanceSource.clearedAt)
        }
      };
    } else {
      finalInvariant(invoice !== null);
      var paymentSource = finalObject(source.payment, [
        "chargeOccurred",
        "checkoutExpiresAt",
        "checkoutUrl",
        "settledAt",
        "state"
      ]);
      finalInvariant(
        [
          "held",
          "checkout_available",
          "checkout_ready",
          "checkout_expired",
          "reconciliation_required",
          "paid"
        ].includes(paymentSource.state)
        && typeof paymentSource.chargeOccurred === "boolean"
        && paymentSource.chargeOccurred === (paymentSource.state === "paid")
      );
      if (paymentSource.state === "checkout_ready") {
        finalIso(paymentSource.checkoutExpiresAt);
        changePaymentCheckoutUrl(
          paymentSource.checkoutUrl,
          paymentSource.checkoutExpiresAt
        );
      } else {
        finalInvariant(
          paymentSource.checkoutUrl === null
          && paymentSource.checkoutExpiresAt === null
        );
      }
      finalInvariant(
        paymentSource.state === "paid"
          ? Boolean(finalIso(paymentSource.settledAt))
          : paymentSource.settledAt === null
      );
      payment = structuredClone(paymentSource);
    }

    var handoff;
    if (source.state === "handed_off") {
      var handedSource = finalObject(source.handoff, [
        "contentDigest",
        "documentId",
        "handedOffAt",
        "state",
        "workmanshipEndsAt",
        "workmanshipStartsAt"
      ]);
      var handedOffAt = finalIso(handedSource.handedOffAt);
      var startsAt = finalIso(handedSource.workmanshipStartsAt);
      var endsAt = finalIso(handedSource.workmanshipEndsAt);
      finalInvariant(
        handedSource.state === "handed_off"
        && startsAt === handedOffAt
        && Date.parse(endsAt) - Date.parse(startsAt) ===
          30 * 24 * 60 * 60 * 1000
        && ["paid", "cleared_no_balance"].includes(payment.state)
      );
      handoff = {
        state: "handed_off",
        documentId: finalUuid(handedSource.documentId),
        contentDigest: finalDigest(handedSource.contentDigest),
        handedOffAt: handedOffAt,
        workmanshipStartsAt: startsAt,
        workmanshipEndsAt: endsAt
      };
    } else {
      var pendingSource = finalObject(
        source.handoff,
        ["documentId", "state", "workmanshipEndsAt", "workmanshipStartsAt"]
      );
      finalInvariant(
        ["pending", "unavailable"].includes(pendingSource.state)
        && pendingSource.documentId === null
        && pendingSource.workmanshipStartsAt === null
        && pendingSource.workmanshipEndsAt === null
      );
      handoff = structuredClone(pendingSource);
    }
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_FINAL_STATE_SCHEMA,
      state: source.state,
      projectId: projectId,
      jobId: jobId,
      completion: completion,
      obligation: obligation,
      invoice: invoice,
      payment: payment,
      handoff: handoff,
      action: {
        checkoutAvailable: actionSource.checkoutAvailable,
        handoffAvailable: false,
        reason: actionSource.reason
      }
    });
  }

  function validateCustomBuildFinalCheckout(value, expectedStateInput) {
    var source = finalObject(value, ["checkout", "schema", "state"]);
    finalInvariant(
      source.schema === CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA
      && source.state === "ready"
    );
    var checkoutSource = finalObject(source.checkout, [
      "chargeOccurred",
      "expiresAt",
      "invoiceId",
      "invoiceNumber",
      "subtotal",
      "tax",
      "total",
      "url"
    ]);
    var invoiceId = finalUuid(checkoutSource.invoiceId);
    var expiresAt = finalIso(checkoutSource.expiresAt);
    var subtotal = finalMoney(checkoutSource.subtotal, false);
    var tax = finalObject(checkoutSource.tax, ["amountMinor", "state"]);
    var total = finalObject(
      checkoutSource.total,
      ["amountMinor", "currency", "state"]
    );
    finalInvariant(
      CUSTOM_BUILD_FINAL_INVOICE_NUMBER.test(checkoutSource.invoiceNumber)
      && checkoutSource.invoiceNumber === "SSCB-FINAL-"
        + invoiceId.replace(/-/gu, "").toUpperCase()
      && tax.amountMinor === null
      && tax.state === "calculated_at_checkout"
      && total.amountMinor === null
      && total.currency === "USD"
      && total.state === "shown_at_checkout"
      && checkoutSource.chargeOccurred === false
    );
    var expectedState = expectedStateInput === undefined
      ? null
      : validateCustomBuildFinalState(expectedStateInput);
    if (expectedState !== null) {
      finalInvariant(
        expectedState.state === "checkout_available"
        && expectedState.invoice.invoiceId === invoiceId
        && expectedState.invoice.invoiceNumber === checkoutSource.invoiceNumber
        && expectedState.invoice.subtotal.amountMinor === subtotal.amountMinor
      );
    }
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_FINAL_CHECKOUT_SCHEMA,
      state: "ready",
      checkout: {
        invoiceId: invoiceId,
        invoiceNumber: checkoutSource.invoiceNumber,
        url: changePaymentCheckoutUrl(checkoutSource.url, expiresAt),
        expiresAt: expiresAt,
        subtotal: subtotal,
        tax: { amountMinor: null, state: "calculated_at_checkout" },
        total: {
          amountMinor: null,
          currency: "USD",
          state: "shown_at_checkout"
        },
        chargeOccurred: false
      }
    });
  }

  function validateCustomBuildHandoffOwnerReadiness(value, expected) {
    var source = finalObject(value, [
      "action",
      "completion",
      "finalObligation",
      "financialClearance",
      "handoff",
      "jobId",
      "organizationId",
      "projectId",
      "schema",
      "state"
    ]);
    finalInvariant(
      source.schema === CUSTOM_BUILD_HANDOFF_OWNER_READINESS_SCHEMA
      && source.organizationId === expected.organizationId
      && source.jobId === expected.jobId
      && source.projectId === expected.projectId
      && ["handoff_available", "handoff_not_ready", "handed_off"]
        .includes(source.state)
      && !finalResponseHasRawProviderIdentifiers(source)
    );
    var completion = finalObject(
      source.completion,
      ["completedAt", "packageDigest", "packageId"]
    );
    var obligation = finalObject(
      source.finalObligation,
      ["obligationDigest", "obligationId"]
    );
    completion = {
      packageId: finalUuid(completion.packageId),
      packageDigest: finalDigest(completion.packageDigest),
      completedAt: finalIso(completion.completedAt)
    };
    obligation = {
      obligationId: finalUuid(obligation.obligationId),
      obligationDigest: finalDigest(obligation.obligationDigest)
    };
    var clearance = null;
    if (source.financialClearance !== null) {
      var clearanceSource = finalObject(
        source.financialClearance,
        ["clearedAt"]
      );
      clearance = {
        clearedAt: finalIso(clearanceSource.clearedAt)
      };
    }
    var action = finalObject(
      source.action,
      ["handoffAvailable", "reason"]
    );
    finalInvariant(
      typeof action.handoffAvailable === "boolean"
      && (action.reason === null || typeof action.reason === "string")
    );
    var retainedHandoff = null;
    if (source.handoff !== null) {
      var handoffSource = finalObject(source.handoff, [
        "contentDigest",
        "documentId",
        "handedOffAt",
        "workmanship"
      ]);
      retainedHandoff = {
        documentId: finalUuid(handoffSource.documentId),
        contentDigest: finalDigest(handoffSource.contentDigest),
        handedOffAt: finalIso(handoffSource.handedOffAt),
        workmanship: finalWorkmanship(handoffSource.workmanship)
      };
      finalInvariant(
        retainedHandoff.workmanship.startsAt === retainedHandoff.handedOffAt
      );
    }
    finalInvariant(
      source.state === "handed_off"
        ? retainedHandoff !== null
          && clearance !== null
          && action.handoffAvailable === false
          && action.reason === "handed_off"
        : source.state === "handoff_available"
          ? retainedHandoff === null
            && clearance !== null
            && action.handoffAvailable === true
            && action.reason === "financial_clearance_confirmed"
          : retainedHandoff === null
            && action.handoffAvailable === false
            && (clearance === null
              ? action.reason === "financial_clearance_required"
              : action.reason === "handoff_boundary_not_ready")
    );
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_HANDOFF_OWNER_READINESS_SCHEMA,
      state: source.state,
      organizationId: source.organizationId,
      projectId: source.projectId,
      jobId: source.jobId,
      completion: structuredClone(completion),
      finalObligation: structuredClone(obligation),
      financialClearance: clearance,
      handoff: retainedHandoff,
      action: {
        handoffAvailable: action.handoffAvailable,
        reason: action.reason
      }
    });
  }

  function validateCustomBuildFinalPaymentsOwner(value, expected) {
    var source = finalObject(value, [
      "finalPayment",
      "jobId",
      "organizationId",
      "owner",
      "schema"
    ]);
    finalInvariant(
      source.schema === CUSTOM_BUILD_FINAL_PAYMENTS_OWNER_SCHEMA
      && source.organizationId === expected.organizationId
      && source.jobId === expected.jobId
    );
    var finalPayment = validateCustomBuildFinalState(
      source.finalPayment,
      expected.projectId
    );
    var ownerSource = finalObject(source.owner, [
      "attemptId",
      "attemptState",
      "canReconcileCreation",
      "canReconcileSettlement",
      "eventId",
      "eventState",
      "providerEffectCertainty",
      "providerErrorCode",
      "providerRequestExpiresAt",
      "receiptSource",
      "reconciliationCode"
    ]);
    finalInvariant(
      (ownerSource.attemptId === null || UUID.test(ownerSource.attemptId))
      && typeof ownerSource.canReconcileCreation === "boolean"
      && typeof ownerSource.canReconcileSettlement === "boolean"
      && (ownerSource.providerRequestExpiresAt === null
        || Boolean(finalIso(ownerSource.providerRequestExpiresAt)))
      && (ownerSource.receiptSource === null
        || ["stripe_event", "provider_readback"].includes(
          ownerSource.receiptSource
        ))
    );
    return deepFreezeProjection({
      schema: CUSTOM_BUILD_FINAL_PAYMENTS_OWNER_SCHEMA,
      organizationId: source.organizationId,
      jobId: source.jobId,
      finalPayment: finalPayment,
      owner: structuredClone(ownerSource)
    });
  }

  function validateCustomBuildHandoffDocument(value, expected) {
    var source = finalObject(value, [
      "byteCount",
      "contentDigest",
      "documentId",
      "mediaType",
      "payload",
      "schema"
    ]);
    finalInvariant(
      source.schema === CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA
      && source.mediaType === "application/json"
      && finalUuid(source.documentId) === expected.documentId
      && finalDigest(source.contentDigest) === expected.contentDigest
      && finalInteger(source.byteCount, 1, 64 * 1024) >= 1
      && !finalResponseHasRawProviderIdentifiers(source)
    );
    var payload = finalObject(source.payload, [
      "completion",
      "customerSummary",
      "deliveryManifest",
      "finalObligation",
      "financialClearance",
      "handoff",
      "jobId",
      "projectId",
      "schema",
      "state"
    ]);
    var completion = finalObject(
      payload.completion,
      ["packageDigest", "packageId"]
    );
    var obligation = finalObject(
      payload.finalObligation,
      ["obligationDigest", "obligationId"]
    );
    var clearance = finalObject(
      payload.financialClearance,
      ["clearedAt", "kind", "referenceId"]
    );
    var handoff = finalObject(
      payload.handoff,
      ["documentId", "handedOffAt", "receiptId", "workmanship"]
    );
    finalInvariant(
      payload.schema === CUSTOM_BUILD_HANDOFF_DOCUMENT_SCHEMA
      && payload.state === "handed_off"
      && payload.projectId === expected.projectId
      && payload.jobId === expected.jobId
      && handoff.documentId === source.documentId
      && finalUuid(handoff.receiptId)
      && finalIso(handoff.handedOffAt)
      && finalWorkmanship(handoff.workmanship).startsAt === handoff.handedOffAt
      && finalUuid(completion.packageId)
      && finalDigest(completion.packageDigest)
      && finalUuid(obligation.obligationId)
      && finalDigest(obligation.obligationDigest)
      && [
        "provider_confirmed_final_payment",
        "zero_balance_clearance"
      ].includes(clearance.kind)
      && finalUuid(clearance.referenceId)
      && finalIso(clearance.clearedAt)
      && customBuildSafeText(
        payload.customerSummary,
        "Custom-build handoff summary",
        20,
        2000
      )
      && Array.isArray(payload.deliveryManifest)
      && payload.deliveryManifest.length >= 1
      && payload.deliveryManifest.length <= 40
    );
    var labels = new Set();
    payload.deliveryManifest.forEach(function (entry) {
      var item = finalObject(entry, ["description", "label"]);
      var label = customBuildSafeText(
        item.label,
        "Handoff item label",
        2,
        120
      );
      customBuildSafeText(
        item.description,
        "Handoff item description",
        2,
        500
      );
      var labelKey = portableCustomBuildLabelKey(label);
      finalInvariant(!labels.has(labelKey));
      labels.add(labelKey);
    });
    return deepFreezeProjection(structuredClone(source));
  }

  function validateCustomBuildHandoffCommand(value, expected) {
    var source = finalObject(value, [
      "completionPackageDigest",
      "documentDigest",
      "documentId",
      "financialClearance",
      "finalObligationDigest",
      "handedOffAt",
      "jobId",
      "organizationId",
      "projectId",
      "receiptId",
      "schema",
      "state",
      "workmanship"
    ]);
    var clearance = finalObject(
      source.financialClearance,
      ["clearedAt", "kind", "referenceId"]
    );
    finalInvariant(
      source.schema === CUSTOM_BUILD_HANDOFF_COMMAND_SCHEMA
      && source.state === "handed_off"
      && source.organizationId === expected.organizationId
      && source.projectId === expected.projectId
      && source.jobId === expected.jobId
      && source.completionPackageDigest ===
        expected.expectedCompletionPackageDigest
      && source.finalObligationDigest ===
        expected.expectedFinalObligationDigest
      && finalUuid(source.receiptId)
      && finalUuid(source.documentId)
      && finalDigest(source.documentDigest)
      && finalIso(source.handedOffAt)
      && finalWorkmanship(source.workmanship).startsAt === source.handedOffAt
      && [
        "provider_confirmed_final_payment",
        "zero_balance_clearance"
      ].includes(clearance.kind)
      && finalUuid(clearance.referenceId)
      && finalIso(clearance.clearedAt)
    );
    return deepFreezeProjection(structuredClone(source));
  }

  function validateCustomBuildFinalOwnerReconciliation(value, expected) {
    var source = finalObject(value, [
      "action",
      "attemptId",
      "checkout",
      "invoiceId",
      "jobId",
      "next",
      "organizationId",
      "reason",
      "schema",
      "settlement",
      "status"
    ]);
    finalInvariant(
      source.schema === CUSTOM_BUILD_FINAL_OWNER_RECONCILIATION_SCHEMA
      && source.organizationId === expected.organizationId
      && source.jobId === expected.jobId
      && source.attemptId === expected.attemptId
      && source.invoiceId === expected.invoiceId
      && [
        "checkout_ready",
        "payment_settled",
        "checkout_expired",
        "reconciliation_required"
      ].includes(source.status)
      && (source.reason === null
        || (typeof source.reason === "string" && source.reason.length <= 200))
    );
    if (source.status === "checkout_ready") {
      validateCustomBuildFinalCheckout(source.checkout);
      finalInvariant(source.settlement === null);
    } else if (source.status === "payment_settled") {
      var settlement = finalObject(source.settlement, [
        "completionPackageId",
        "invoiceId",
        "jobId",
        "next",
        "receiptId",
        "schema",
        "status"
      ]);
      finalInvariant(
        source.checkout === null
        && settlement.schema === CUSTOM_BUILD_FINAL_SETTLEMENT_SCHEMA
        && settlement.status === "payment_settled"
        && settlement.invoiceId === expected.invoiceId
        && settlement.jobId === expected.jobId
        && settlement.next === "custom_build_handoff"
        && finalUuid(settlement.completionPackageId)
        && finalUuid(settlement.receiptId)
      );
    } else {
      finalInvariant(source.checkout === null && source.settlement === null);
    }
    return deepFreezeProjection(structuredClone(source));
  }

  function rejectClaimedAuthority(source) {
    if (Array.isArray(source)) {
      source.forEach(rejectClaimedAuthority);
      return;
    }
    if (!isObject(source)) return;
    Object.keys(source).forEach(function (key) {
      if (FORBIDDEN_AUTHORITY_FIELDS_NORMALIZED.has(key.toLowerCase())) {
        throw new APIError({
          code: "OWNER_AUTHORITY_REJECTED",
          message: "Payment, domain, plan, and publishing results are confirmed by Site Sourcery."
        });
      }
      if (isObject(source[key]) || Array.isArray(source[key])) {
        rejectClaimedAuthority(source[key]);
      }
    });
  }

  function defaultIdempotencyKey() {
    var cryptoObject = typeof globalThis === "object" ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return cryptoObject.randomUUID();
    }
    throw new APIError({
      code: "IDEMPOTENCY_UNAVAILABLE",
      message: "This browser cannot safely identify a write request. Update the browser and try again."
    });
  }

  function createClient(options) {
    var config = options || {};
    var fetchImpl = config.fetch || (typeof globalThis === "object" && globalThis.fetch);
    var cryptoImpl = config.crypto
      || (typeof globalThis === "object" && globalThis.crypto);
    if (typeof fetchImpl !== "function") {
      throw new APIError({ code: "FETCH_UNAVAILABLE", message: "A secure network client is required." });
    }
    var configuredBaseUrl = String(config.baseUrl || "/api/v1");
    if (!/^\/api\/v1\/?$/u.test(configuredBaseUrl)) {
      throw new APIError({
        code: "SAME_ORIGIN_API_REQUIRED",
        message: "Saved projects could not connect securely."
      });
    }
    var baseUrl = configuredBaseUrl.replace(/\/+$/u, "");
    var idempotencyFactory = config.idempotencyFactory || defaultIdempotencyKey;
    var csrfToken = null;
    var csrfBootstrap = null;

    async function verifyCustomBuildHandoffDocumentIntegrity(documentValue) {
      var canonical = customBuildCanonicalJson(documentValue.payload);
      var bytes;
      try {
        bytes = new TextEncoder().encode(canonical);
      } catch (_error) {
        throw invalidCustomBuildFinalResponse();
      }
      finalInvariant(bytes.byteLength === documentValue.byteCount);
      if (
        !cryptoImpl
        || !cryptoImpl.subtle
        || typeof cryptoImpl.subtle.digest !== "function"
      ) {
        throw new APIError({
          code: "HANDOFF_INTEGRITY_UNAVAILABLE",
          message:
            "This browser cannot verify the immutable handoff record. Update the browser and try again."
        });
      }
      var calculated;
      try {
        calculated = new Uint8Array(
          await cryptoImpl.subtle.digest("SHA-256", bytes)
        );
      } catch (_error) {
        throw invalidCustomBuildFinalResponse();
      }
      finalInvariant(hexFromBytes(calculated) === documentValue.contentDigest);
      return documentValue;
    }

    async function ensureCsrf() {
      if (csrfToken) return;
      if (!csrfBootstrap) csrfBootstrap = request("GET", "/csrf");
      try {
        await csrfBootstrap;
      } finally {
        csrfBootstrap = null;
      }
      if (!csrfToken) {
        throw new APIError({
          code: "CSRF_UNAVAILABLE",
          message: "Refresh this page before saving changes."
        });
      }
    }

    async function request(method, path, optionsForRequest) {
      var requestOptions = optionsForRequest || {};
      var upperMethod = String(method || "GET").toUpperCase();
      var headers = Object.assign({ Accept: "application/json" }, requestOptions.headers || {});
      var body;
      if (WRITE_METHODS.has(upperMethod) && !csrfToken) {
        await ensureCsrf();
      }
      if (Object.prototype.hasOwnProperty.call(requestOptions, "body")) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(requestOptions.body);
      }
      if (WRITE_METHODS.has(upperMethod)) {
        headers["Idempotency-Key"] = requestOptions.idempotencyKey || idempotencyFactory();
        if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      }
      if (requestOptions.revision != null) headers["If-Match"] = String(requestOptions.revision);

      var response;
      try {
        response = await fetchImpl(baseUrl + path, {
          method: upperMethod,
          headers: headers,
          body: body,
          credentials: "include",
          redirect: "error",
          signal: requestOptions.signal
        });
      } catch (error) {
        throw new APIError({
          code: "NETWORK_ERROR",
          message: "Site Sourcery could not reach its secure service. Check the connection and try again.",
          retryable: true
        });
      }

      var requestId = response.headers && response.headers.get
        ? response.headers.get("x-request-id")
        : null;
      var contentType = response.headers && response.headers.get
        ? String(response.headers.get("content-type") || "")
        : "";
      var payload = null;
      if (response.status !== 204) {
        if (contentType.includes("application/json")) {
          try {
            payload = await response.json();
          } catch (_error) {
            payload = null;
          }
        } else {
          try {
            await response.text();
          } catch (_error) {
            // Discard non-JSON provider and proxy diagnostics.
          }
          if (response.ok) {
            throw new APIError({
              status: response.status,
              code: "INVALID_RESPONSE",
              message: "The Site Sourcery service returned an invalid response.",
              requestId: requestId,
              retryable: true
            });
          }
        }
      }
      if (!response.ok) {
        var errorBody = payload && isObject(payload.error) ? payload.error : payload;
        var serverMessage = errorBody && typeof errorBody.message === "string"
          ? errorBody.message.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 500)
          : "";
        if (errorBody && errorBody.code === "CSRF_TOKEN_REQUIRED") csrfToken = null;
        throw new APIError({
          status: response.status,
          code: errorBody && errorBody.code,
          message: serverMessage || "The Site Sourcery service could not complete this request.",
          requestId: (errorBody && errorBody.requestId) || requestId,
          retryable: response.status === 409 || response.status === 429 || response.status >= 500
        });
      }
      if (payload && typeof payload.csrfToken === "string") csrfToken = payload.csrfToken;
      return payload;
    }

    async function requestBinary(path, requestOptions) {
      var response;
      try {
        response = await fetchImpl(baseUrl + path, {
          method: "GET",
          headers: { Accept: "application/zip, application/octet-stream" },
          credentials: "include",
          redirect: "error",
          signal: requestOptions && requestOptions.signal
        });
      } catch (_error) {
        throw new APIError({
          code: "NETWORK_ERROR",
          message: "Site Sourcery could not reach its secure service. Check the connection and try again.",
          retryable: true
        });
      }
      var requestId = response.headers && response.headers.get
        ? response.headers.get("x-request-id")
        : null;
      var contentType = response.headers && response.headers.get
        ? String(response.headers.get("content-type") || "").toLowerCase()
        : "";
      if (!response.ok) {
        var payload = null;
        if (contentType.includes("application/json")) {
          try {
            payload = await response.json();
          } catch (_error) {
            payload = null;
          }
        }
        var errorBody = payload && isObject(payload.error) ? payload.error : payload;
        throw new APIError({
          status: response.status,
          code: errorBody && errorBody.code,
          message: errorBody && typeof errorBody.message === "string"
            ? errorBody.message.slice(0, 500)
            : "The project export could not be downloaded.",
          requestId: (errorBody && errorBody.requestId) || requestId,
          retryable: response.status === 409 || response.status === 429 || response.status >= 500
        });
      }
      if (
        !contentType.includes("application/zip")
        && !contentType.includes("application/octet-stream")
      ) {
        throw new APIError({
          status: response.status,
          code: "INVALID_EXPORT_RESPONSE",
          message: "The project export response was not a downloadable archive.",
          requestId: requestId,
          retryable: true
        });
      }
      var statedLength = Number(
        response.headers && response.headers.get
          ? response.headers.get("content-length")
          : NaN
      );
      if (Number.isFinite(statedLength) && (statedLength < 1 || statedLength > 50 * 1024 * 1024)) {
        throw new APIError({
          code: "INVALID_EXPORT_SIZE",
          message: "The project export size was outside the safe download limit.",
          requestId: requestId
        });
      }
      var blob;
      try {
        blob = await response.blob();
      } catch (_error) {
        throw new APIError({
          code: "INVALID_EXPORT_RESPONSE",
          message: "The project export archive could not be read.",
          requestId: requestId,
          retryable: true
        });
      }
      if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 50 * 1024 * 1024) {
        throw new APIError({
          code: "INVALID_EXPORT_SIZE",
          message: "The project export size was outside the safe download limit.",
          requestId: requestId
        });
      }
      var disposition = response.headers && response.headers.get
        ? String(response.headers.get("content-disposition") || "")
        : "";
      var filenameMatch = disposition.match(/filename="?([^";]+)"?/iu);
      var filename = String(filenameMatch && filenameMatch[1] || "sitesourcery-project-export.zip")
        .replace(/[^a-z0-9._-]+/giu, "-")
        .slice(0, 160);
      return Object.freeze({ blob: blob, filename: filename });
    }

    async function requestPrivateEvidence(path, requestOptions) {
      var response;
      try {
        response = await fetchImpl(baseUrl + path, {
          method: "GET",
          headers: {
            Accept: CUSTOM_BUILD_EVIDENCE_MEDIA_TYPES.join(", ")
          },
          credentials: "include",
          redirect: "error",
          signal: requestOptions && requestOptions.signal
        });
      } catch (_error) {
        throw new APIError({
          code: "NETWORK_ERROR",
          message: "Site Sourcery could not reach its secure service. Check the connection and try again.",
          retryable: true
        });
      }
      var requestId = response.headers && response.headers.get
        ? response.headers.get("x-request-id")
        : null;
      var contentTypeHeader = response.headers && response.headers.get
        ? String(response.headers.get("content-type") || "").toLowerCase()
        : "";
      if (!response.ok) {
        var payload = null;
        if (contentTypeHeader.includes("application/json")) {
          try {
            payload = await response.json();
          } catch (_error) {
            payload = null;
          }
        }
        var errorBody = payload && isObject(payload.error)
          ? payload.error
          : payload;
        var serverMessage = errorBody && typeof errorBody.message === "string"
          ? errorBody.message.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 500)
          : "";
        throw new APIError({
          status: response.status,
          code: errorBody && errorBody.code,
          message: serverMessage
            || "The Custom-build completion evidence could not be opened.",
          requestId: (errorBody && errorBody.requestId) || requestId,
          retryable:
            response.status === 409
            || response.status === 429
            || response.status >= 500
        });
      }
      var mediaType = contentTypeHeader.split(";", 1)[0].trim();
      var lengthHeader = response.headers && response.headers.get
        ? String(response.headers.get("content-length") || "")
        : "";
      var digestHeader = response.headers && response.headers.get
        ? String(response.headers.get("digest") || "")
        : "";
      var cacheControl = response.headers && response.headers.get
        ? String(response.headers.get("cache-control") || "").toLowerCase()
        : "";
      var contentTypeOptions = response.headers && response.headers.get
        ? String(response.headers.get("x-content-type-options") || "").toLowerCase()
        : "";
      var byteCount = /^\d+$/u.test(lengthHeader)
        ? Number(lengthHeader)
        : NaN;
      if (
        !CUSTOM_BUILD_EVIDENCE_MEDIA_TYPES.includes(mediaType)
        || !Number.isSafeInteger(byteCount)
        || byteCount < 1
        || byteCount > MAXIMUM_ASSESSMENT_EVIDENCE_BYTES
        || !/^sha-256=[A-Za-z0-9+/]{43}=$/u.test(digestHeader)
        || !cacheControl.split(",").map(function (entry) {
          return entry.trim();
        }).includes("private")
        || !cacheControl.split(",").map(function (entry) {
          return entry.trim();
        }).includes("no-store")
        || contentTypeOptions !== "nosniff"
      ) {
        throw invalidCustomBuildChangeCompletionResponse();
      }
      var blob;
      try {
        blob = await response.blob();
      } catch (_error) {
        throw invalidCustomBuildChangeCompletionResponse();
      }
      projectionInvariant(
        blob
        && Number.isSafeInteger(blob.size)
        && blob.size === byteCount
      );
      var bytes;
      try {
        bytes = new Uint8Array(await blob.arrayBuffer());
      } catch (_error) {
        throw invalidCustomBuildChangeCompletionResponse();
      }
      if (
        !cryptoImpl
        || !cryptoImpl.subtle
        || typeof cryptoImpl.subtle.digest !== "function"
      ) {
        throw new APIError({
          code: "EVIDENCE_INTEGRITY_UNAVAILABLE",
          message:
            "This browser cannot verify private completion evidence. Update the browser and try again."
        });
      }
      var calculated;
      try {
        calculated = new Uint8Array(
          await cryptoImpl.subtle.digest("SHA-256", bytes)
        );
      } catch (_error) {
        throw invalidCustomBuildChangeCompletionResponse();
      }
      projectionInvariant(
        digestHeader === "sha-256=" + base64FromBytes(calculated)
      );
      return Object.freeze({
        blob: blob,
        mediaType: mediaType,
        byteCount: byteCount,
        contentDigest: hexFromBytes(calculated)
      });
    }

    function register(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("POST", "/auth/register", {
        body: {
          name: requiredText(source.name, "Name", 100),
          organizationName: requiredText(source.organizationName, "Organization name", 120),
          email: requiredText(source.email, "Email", 254),
          password: requiredText(source.password, "Password", 256)
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function completeRegistration(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("POST", "/auth/register/complete", {
        body: {
          token: requiredText(
            source.token,
            "Activation code",
            512
          )
        },
        idempotencyKey:
          requestOptions &&
          requestOptions.idempotencyKey
      });
    }

    function signIn(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("POST", "/auth/sessions", {
        body: {
          email: requiredText(source.email, "Email", 254),
          password: requiredText(source.password, "Password", 256)
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function signOut(requestOptions) {
      return request("DELETE", "/auth/sessions/current", {
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function requestRecovery(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("POST", "/auth/recovery", {
        body: { email: requiredText(source.email, "Email", 254) },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function completeRecovery(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("POST", "/auth/recovery/complete", {
        body: {
          token: requiredText(source.token, "Recovery token", 512),
          password: requiredText(source.password, "Password", 256)
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function me() {
      return request("GET", "/me");
    }

    function capabilities() {
      return request("GET", "/capabilities");
    }

    function listOrganizations() {
      return request("GET", "/organizations");
    }

    function listProjects(organizationId) {
      return request("GET", "/organizations/" + segment(organizationId, "Organization ID") + "/projects");
    }

    function getProject(projectId) {
      return request("GET", "/projects/" + segment(projectId, "Project ID"));
    }

    function getAlakazamAccount(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID") + "/alakazam",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamInvoice(projectId, receiptId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/invoices/"
          + segment(receiptId, "Alakazam receipt ID"),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamPublication(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/publication",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamCancellationPreview(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/cancellation-preview",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamBillingStates(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/billing-states",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function requestAlakazamPublication(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      var action = oneOf(
        source.action,
        "Publication action",
        ["publish", "rollback", "unpublish"]
      );
      var targetReleaseId = source.targetReleaseId == null
        ? null
        : requiredText(
            source.targetReleaseId,
            "Rollback release ID",
            36
          );
      if (
        (action === "rollback") !==
          (targetReleaseId !== null)
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message:
            "An exact prior release is required only for rollback."
        });
      }
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/publication-commands",
        {
          body: {
            action: action,
            snapshotDigest: requiredDigest(
              source.snapshotDigest,
              "Publication snapshot digest"
            ),
            targetReleaseId: targetReleaseId
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getCustomServicesAssessmentRequest(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-request",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function saveCustomServicesAssessmentRequest(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      var allowedComplexity = [
        "authenticated_area",
        "commerce",
        "forms",
        "large_content_set",
        "multilingual",
        "regulated_content",
        "third_party_integrations",
        "unknown_platform"
      ];
      var complexityFlags = Array.isArray(source.complexityFlags)
        ? source.complexityFlags.map(function (value) {
            return oneOf(value, "Website complexity", allowedComplexity);
          }).filter(function (value, index, rows) {
            return rows.indexOf(value) === index;
          }).sort()
        : [];
      var platformFamily = source.platformFamily == null
        ? null
        : oneOf(
            source.platformFamily,
            "Website platform",
            ["custom", "other", "shopify", "squarespace", "unknown", "wix", "wordpress"]
          );
      return request(
        "PUT",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-request",
        {
          body: {
            approximatePublicSize: oneOf(
              source.approximatePublicSize,
              "Public website size",
              ["one_to_ten", "eleven_to_fifty", "more_than_fifty", "application_or_unknown"]
            ),
            businessName: optionalText(source.businessName, 120),
            complexityFlags: complexityFlags,
            customerObservation: optionalText(source.customerObservation, 1000),
            customerOwnershipAffirmed: source.customerOwnershipAffirmed === true,
            expectedDraftRevision: integerBetween(
              source.expectedDraftRevision == null ? 0 : source.expectedDraftRevision,
              "Assessment draft revision",
              0,
              Number.MAX_SAFE_INTEGER
            ),
            importantDate: optionalText(source.importantDate, 10),
            platformFamily: platformFamily,
            primaryGoal: requiredText(source.primaryGoal, "Primary goal", 500),
            publicUrl: requiredText(source.publicUrl, "Public website URL", 2048),
            siteDisplayName: requiredText(source.siteDisplayName, "Website name", 120)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function submitCustomServicesAssessmentRequest(projectId, draftRevision, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-request/submission",
        {
          body: {
            draftRevision: integerBetween(
              draftRevision,
              "Assessment draft revision",
              1,
              Number.MAX_SAFE_INTEGER
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function withdrawCustomServicesAssessmentRequest(projectId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-request/withdrawal",
        {
          body: {},
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getCustomServicesAssessmentQuote(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-quote",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getCustomServicesAssessmentInvoice(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-invoice",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function createCustomServicesAssessmentCheckout(
      projectId,
      invoiceId,
      input,
      requestOptions
    ) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-invoices/"
          + segment(invoiceId, "Assessment invoice ID")
          + "/checkout-command",
        {
          body: {
            invoiceDigest: requiredDigest(
              source.invoiceDigest,
              "Assessment invoice digest"
            )
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function acceptCustomServicesAssessmentQuote(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-quote/acceptance",
        {
          body: {
            acceptanceStatement: requiredText(
              source.acceptanceStatement,
              "Assessment quote acceptance",
              200
            ),
            acceptedDisclosureDigest: requiredDigest(
              source.acceptedDisclosureDigest,
              "Assessment disclosure digest"
            ),
            acceptedQuoteDigest: requiredDigest(
              source.acceptedQuoteDigest,
              "Assessment quote digest"
            ),
            quoteId: requiredText(source.quoteId, "Assessment quote ID", 36),
            quoteRevision: integerBetween(
              source.quoteRevision,
              "Assessment quote revision",
              1,
              Number.MAX_SAFE_INTEGER
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function listOwnerAssessmentRequests(requestOptions) {
      return request(
        "GET",
        "/operator/custom-services/assessment-requests",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function issueOwnerAssessmentQuote(caseId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      var reviewTargets = Array.isArray(source.reviewTargets)
        ? source.reviewTargets.map(function (target) {
            var selected = isObject(target) ? target : {};
            return {
              kind: oneOf(
                selected.kind,
                "Review target kind",
                ["page", "page_type"]
              ),
              value: requiredText(
                selected.value,
                "Review target",
                154
              )
            };
          })
        : [];
      if (reviewTargets.length < 1 || reviewTargets.length > 5) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Choose between one and five representative pages or page types."
        });
      }
      return request(
        "POST",
        "/operator/custom-services/assessment-requests/"
          + segment(caseId, "Assessment request ID")
          + "/quote",
        {
          body: {
            organizationId: requiredText(
              source.organizationId,
              "Organization ID",
              36
            ),
            deliveryDate: requiredText(
              source.deliveryDate,
              "Delivery date",
              10
            ),
            reviewTargets: reviewTargets
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function listOwnerAssessmentJobs(requestOptions) {
      return request(
        "GET",
        "/operator/custom-services/assessment-jobs",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function uploadOwnerAssessmentEvidence(
      jobId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        [
          "accessibleDescription",
          "bytesBase64",
          "mediaType",
          "organizationId",
          "reviewTarget",
          "viewport"
        ],
        "Assessment evidence"
      );
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/operator/custom-services/assessment-jobs/"
          + segment(requiredUuid(jobId, "Assessment job ID"), "Assessment job ID")
          + "/evidence",
        {
          body: {
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            reviewTarget: assessmentTarget(
              source.reviewTarget,
              "Review target"
            ),
            viewport: oneOf(
              source.viewport,
              "Assessment viewport",
              ["desktop", "phone"]
            ),
            accessibleDescription: boundedText(
              source.accessibleDescription,
              "Accessible evidence description",
              10,
              500
            ),
            mediaType: oneOf(
              source.mediaType,
              "Evidence image type",
              ["image/jpeg", "image/png", "image/webp"]
            ),
            bytesBase64: assessmentEvidenceBase64(
              source.bytesBase64
            )
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function putOwnerAssessmentFinding(
      jobId,
      priority,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        [
          "category",
          "evidenceIds",
          "expectedRevision",
          "included",
          "organizationId",
          "primaryTarget",
          "recommendation",
          "severity",
          "summary",
          "viewports"
        ],
        "Assessment finding"
      );
      rejectClaimedAuthority(source);
      if (typeof source.included !== "boolean") {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Assessment finding inclusion is invalid."
        });
      }
      return request(
        "PUT",
        "/operator/custom-services/assessment-jobs/"
          + segment(requiredUuid(jobId, "Assessment job ID"), "Assessment job ID")
          + "/findings/"
          + integerBetween(priority, "Assessment finding priority", 1, 10),
        {
          body: {
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            expectedRevision: integerBetween(
              source.expectedRevision,
              "Assessment finding revision",
              0,
              Number.MAX_SAFE_INTEGER
            ),
            included: source.included,
            severity: oneOf(
              source.severity,
              "Assessment severity",
              ["critical", "high", "moderate", "low", "positive"]
            ),
            category: oneOf(
              source.category,
              "Assessment category",
              [
                "accessibility",
                "content",
                "functionality",
                "performance",
                "responsive_design",
                "search_visibility",
                "security_observation",
                "usability",
                "visual_design"
              ]
            ),
            primaryTarget: assessmentTarget(
              source.primaryTarget,
              "Primary target"
            ),
            viewports: assessmentViewports(source.viewports),
            summary: boundedText(
              source.summary,
              "Assessment finding summary",
              10,
              240
            ),
            recommendation: boundedText(
              source.recommendation,
              "Assessment recommendation",
              10,
              1500
            ),
            evidenceIds: assessmentEvidenceIds(source.evidenceIds)
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function deliverOwnerAssessmentReport(
      jobId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["expectedWorkDigest", "organizationId", "overallSummary"],
        "Assessment report delivery"
      );
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/operator/custom-services/assessment-jobs/"
          + segment(requiredUuid(jobId, "Assessment job ID"), "Assessment job ID")
          + "/delivery",
        {
          body: {
            expectedWorkDigest: requiredDigest(
              source.expectedWorkDigest,
              "Assessment work digest"
            ),
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            overallSummary: boundedText(
              source.overallSummary,
              "Assessment report summary",
              20,
              2000
            )
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getCustomServicesAssessmentReport(
      projectId,
      requestOptions
    ) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/assessment-report",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function listOwnerCustomBuildOpportunities(requestOptions) {
      return request(
        "GET",
        "/operator/custom-services/custom-build-opportunities",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function listOwnerCustomBuildJobs(requestOptions) {
      var selectedCursor = requestOptions && requestOptions.cursor;
      var path = "/operator/custom-services/custom-build-jobs";
      if (selectedCursor != null) {
        selectedCursor = boundedText(
          selectedCursor,
          "Paid Custom-build job cursor",
          72,
          96
        );
        var cursorParts = selectedCursor.split("|");
        var cursorDate = cursorParts.length === 3
          ? Date.parse(cursorParts[1])
          : NaN;
        if (
          cursorParts.length !== 3
          || !/^\d{4}-\d{2}-\d{2}$/u.test(cursorParts[0])
          || !Number.isFinite(cursorDate)
          || new Date(cursorDate).toISOString() !== cursorParts[1]
          || !UUID.test(cursorParts[2])
        ) {
          throw new APIError({
            code: "INVALID_INPUT",
            message: "Paid Custom-build job cursor is invalid."
          });
        }
        path += "?cursor=" + encodeURIComponent(selectedCursor);
      }
      return request(
        "GET",
        path,
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getOwnerCustomBuildProgress(
      jobId,
      organizationId,
      requestOptions
    ) {
      return request(
        "GET",
        "/operator/custom-services/custom-build-jobs/"
          + segment(
            requiredUuid(jobId, "Custom-build job ID"),
            "Custom-build job ID"
          )
          + "/progress?organizationId="
          + encodeURIComponent(
            requiredUuid(organizationId, "Organization ID")
          ),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function recordOwnerCustomBuildProgress(jobId, input) {
      var source = exactInput(
        input,
        [
          "commandId",
          "customerSummary",
          "expectedRevision",
          "milestones",
          "nextStep",
          "organizationId",
          "stage"
        ],
        "Custom-build progress update"
      );
      rejectClaimedAuthority(source);
      var milestones = exactInput(
        source.milestones,
        ["content", "quality", "responsive", "structure"],
        "Custom-build milestones"
      );
      var commandId = requiredUuid(
        source.commandId,
        "Custom-build progress command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(
            requiredUuid(jobId, "Custom-build job ID"),
            "Custom-build job ID"
          )
          + "/progress",
        {
          body: {
            commandId: commandId,
            customerSummary: customBuildSafeText(
              source.customerSummary,
              "Customer progress summary",
              10,
              500
            ),
            expectedRevision: integerBetween(
              source.expectedRevision,
              "Expected progress revision",
              0,
              Number.MAX_SAFE_INTEGER
            ),
            milestones: {
              content: oneOf(
                milestones.content,
                "Content milestone",
                ["pending", "in_progress", "done"]
              ),
              quality: oneOf(
                milestones.quality,
                "Quality milestone",
                ["pending", "in_progress", "done"]
              ),
              responsive: oneOf(
                milestones.responsive,
                "Phone and accessibility milestone",
                ["pending", "in_progress", "done"]
              ),
              structure: oneOf(
                milestones.structure,
                "Structure milestone",
                ["pending", "in_progress", "done"]
              )
            },
            nextStep: customBuildSafeText(
              source.nextStep,
              "Customer next step",
              5,
              500
            ),
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            stage: oneOf(
              source.stage,
              "Custom-build stage",
              ["preparing", "building", "checking"]
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function ownerCustomBuildAccess(value, requestKind) {
      if (requestKind !== "delegated_access") {
        if (value !== null) {
          throw new APIError({
            code: "INVALID_INPUT",
            message: "Delegated access details are only available for a delegated-access request."
          });
        }
        return null;
      }
      var source = exactInput(
        value,
        ["accountLabel", "delegatedRole", "expiresAt", "providerLabel"],
        "Delegated access labels"
      );
      return {
        accountLabel: customBuildSafeText(
          source.accountLabel,
          "Safe account or user label",
          1,
          254
        ),
        delegatedRole: customBuildSafeText(
          source.delegatedRole,
          "Delegated role",
          1,
          254
        ),
        expiresAt: requiredIso(
          source.expiresAt,
          "Delegated access expiration"
        ),
        providerLabel: customBuildSafeText(
          source.providerLabel,
          "Provider label",
          1,
          254
        )
      };
    }

    function openOwnerCustomBuildRequest(jobId, input) {
      var source = exactInput(
        input,
        [
          "access",
          "commandId",
          "customerMessage",
          "expectedProgressRevision",
          "organizationId",
          "requestKind",
          "safeInstructions",
          "targetDateImpact",
          "title"
        ],
        "Custom-build customer request"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom-build request command ID"
      );
      var requestKind = oneOf(
        source.requestKind,
        "Custom-build request kind",
        [
          "customer_content",
          "customer_decision",
          "delegated_access",
          "outside_dependency"
        ]
      );
      var targetDateImpact = oneOf(
        source.targetDateImpact,
        "Target-date impact",
        ["none", "under_review"]
      );
      if (
        requestKind === "outside_dependency"
        && targetDateImpact !== "under_review"
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "An outside dependency must place the target date under review."
        });
      }
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(
            requiredUuid(jobId, "Custom-build job ID"),
            "Custom-build job ID"
          )
          + "/requests",
        {
          body: {
            access: ownerCustomBuildAccess(source.access, requestKind),
            commandId: commandId,
            customerMessage: customBuildSafeText(
              source.customerMessage,
              "Customer request message",
              10,
              1000
            ),
            expectedProgressRevision: integerBetween(
              source.expectedProgressRevision,
              "Expected progress revision",
              0,
              Number.MAX_SAFE_INTEGER
            ),
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            requestKind: requestKind,
            safeInstructions: customBuildSafeText(
              source.safeInstructions,
              "Safe customer instructions",
              10,
              1000
            ),
            targetDateImpact: targetDateImpact,
            title: customBuildSafeText(
              source.title,
              "Customer request title",
              5,
              120
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function resolveOwnerCustomBuildRequest(
      jobId,
      requestId,
      input
    ) {
      var source = exactInput(
        input,
        [
          "commandId",
          "expectedRevision",
          "organizationId",
          "resolutionNote",
          "state"
        ],
        "Custom-build request resolution"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom-build resolution command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(
            requiredUuid(jobId, "Custom-build job ID"),
            "Custom-build job ID"
          )
          + "/requests/"
          + segment(
            requiredUuid(requestId, "Custom-build request ID"),
            "Custom-build request ID"
          )
          + "/resolution",
        {
          body: {
            commandId: commandId,
            expectedRevision: integerBetween(
              source.expectedRevision,
              "Expected request revision",
              1,
              Number.MAX_SAFE_INTEGER
            ),
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            resolutionNote: customBuildSafeText(
              source.resolutionNote,
              "Request resolution note",
              5,
              500
            ),
            state: oneOf(
              source.state,
              "Request resolution",
              ["resolved", "withdrawn"]
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function issueOwnerCustomBuildQuote(jobId, input) {
      var source = exactInput(
        input,
        [
          "commandId",
          "organizationId",
          "tierId",
          "craftedPages",
          "sections",
          "uniqueLayouts",
          "contentWords",
          "suppliedMedia",
          "scopeStatement",
          "targetCompletionDate",
          "expiresAt"
        ],
        "Custom website quote"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom website quote command ID"
      );
      var tierId = oneOf(
        source.tierId,
        "Custom website tier",
        [
          "card",
          "card-plus",
          "site",
          "site-plus",
          "signature",
          "flagship",
          "scale"
        ]
      );
      var footprint = customBuildFootprint(tierId, source);
      return request(
        "POST",
        "/operator/custom-services/assessment-jobs/"
          + segment(requiredUuid(jobId, "Assessment job ID"), "Assessment job ID")
          + "/custom-build-quote",
        {
          body: {
            commandId: commandId,
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            tierId: tierId,
            craftedPages: footprint.craftedPages,
            sections: footprint.sections,
            uniqueLayouts: footprint.uniqueLayouts,
            contentWords: footprint.contentWords,
            suppliedMedia: footprint.suppliedMedia,
            scopeStatement: boundedText(
              source.scopeStatement,
              "Custom website scope",
              20,
              2000
            ),
            targetCompletionDate: requiredDate(
              source.targetCompletionDate,
              "Target completion date"
            ),
            expiresAt: requiredIso(
              source.expiresAt,
              "Custom website quote expiration"
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function voidOwnerCustomBuildQuote(quoteId, input) {
      var source = exactInput(
        input,
        ["commandId", "organizationId", "reason"],
        "Custom website quote void"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom website quote void command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-quotes/"
          + segment(requiredUuid(quoteId, "Custom website quote ID"), "Custom website quote ID")
          + "/void",
        {
          body: {
            commandId: commandId,
            organizationId: requiredUuid(
              source.organizationId,
              "Organization ID"
            ),
            reason: boundedText(
              source.reason,
              "Custom website quote void reason",
              10,
              500
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function getCustomServicesCustomBuildQuote(
      projectId,
      requestOptions
    ) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-quote",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getCustomServicesCustomBuildInvoice(
      projectId,
      requestOptions
    ) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-invoice",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getCustomServicesCustomBuildProgress(
      projectId,
      requestOptions
    ) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-progress",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getCustomServicesCustomBuildChangeCompletion(
      projectId,
      requestOptions
    ) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-change-completion",
        { signal: requestOptions && requestOptions.signal }
      ).then(validateCustomBuildCustomerChangeCompletion);
    }

    function getCustomServicesCustomBuildChangeInvoice(
      projectId,
      requestOptions
    ) {
      var options = requestOptions || {};
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-change-invoice",
        { signal: options.signal }
      ).then(function (value) {
        return validateCustomBuildChangeInvoice(
          value,
          options.expectedChangeOrder
        );
      });
    }

    function getCustomServicesCustomBuildFinalHandoff(
      projectId,
      requestOptions
    ) {
      var selectedProjectId = requiredUuid(
        projectId,
        "Custom-build project ID"
      );
      return request(
        "GET",
        "/projects/" + segment(selectedProjectId, "Project ID")
          + "/custom-services/custom-build-final-handoff",
        { signal: requestOptions && requestOptions.signal }
      ).then(function (value) {
        return validateCustomBuildFinalState(value, selectedProjectId);
      });
    }

    function createCustomServicesCustomBuildFinalCheckout(
      projectId,
      invoiceId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["commandId", "invoiceDigest"],
        "Custom-build final payment"
      );
      rejectClaimedAuthority(source);
      var selectedProjectId = requiredUuid(
        projectId,
        "Custom-build project ID"
      );
      var selectedInvoiceId = requiredUuid(
        invoiceId,
        "Custom-build final invoice ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build final payment command ID"
      );
      var invoiceDigest = requiredDigest(
        source.invoiceDigest,
        "Custom-build final invoice digest"
      );
      var options = requestOptions || {};
      var expectedState = validateCustomBuildFinalState(
        options.expectedState,
        selectedProjectId
      );
      finalInvariant(
        expectedState.state === "checkout_available"
        && expectedState.invoice.invoiceId === selectedInvoiceId
        && expectedState.invoice.invoiceDigest === invoiceDigest
      );
      return request(
        "POST",
        "/projects/" + segment(selectedProjectId, "Project ID")
          + "/custom-services/custom-build-final-invoices/"
          + segment(selectedInvoiceId, "Custom-build final invoice ID")
          + "/checkout-command",
        {
          body: {
            commandId: commandId,
            invoiceDigest: invoiceDigest
          },
          idempotencyKey: commandId,
          signal: options.signal
        }
      ).then(function (value) {
        return validateCustomBuildFinalCheckout(value, expectedState);
      });
    }

    function getCustomServicesCustomBuildHandoffDocument(
      projectId,
      documentId,
      requestOptions
    ) {
      var selectedProjectId = requiredUuid(
        projectId,
        "Custom-build project ID"
      );
      var selectedDocumentId = requiredUuid(
        documentId,
        "Custom-build handoff document ID"
      );
      var options = requestOptions || {};
      var expectedState = validateCustomBuildFinalState(
        options.expectedState,
        selectedProjectId
      );
      finalInvariant(
        expectedState.state === "handed_off"
        && expectedState.handoff.documentId === selectedDocumentId
      );
      return request(
        "GET",
        "/projects/" + segment(selectedProjectId, "Project ID")
          + "/custom-services/custom-build-handoff-documents/"
          + segment(selectedDocumentId, "Custom-build handoff document ID"),
        { signal: options.signal }
      ).then(function (value) {
        var documentValue = validateCustomBuildHandoffDocument(value, {
          projectId: selectedProjectId,
          jobId: expectedState.jobId,
          documentId: selectedDocumentId,
          contentDigest: expectedState.handoff.contentDigest
        });
        return verifyCustomBuildHandoffDocumentIntegrity(documentValue);
      });
    }

    function getOwnerCustomBuildFinalPayments(
      jobId,
      organizationId,
      requestOptions
    ) {
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedOrganizationId = requiredUuid(
        organizationId,
        "Organization ID"
      );
      var options = requestOptions || {};
      var expectedProjectId = requiredUuid(
        options.expectedProjectId,
        "Custom-build project ID"
      );
      return request(
        "GET",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/final-payments?organizationId="
          + encodeURIComponent(selectedOrganizationId),
        { signal: options.signal }
      ).then(function (value) {
        return validateCustomBuildFinalPaymentsOwner(value, {
          organizationId: selectedOrganizationId,
          projectId: expectedProjectId,
          jobId: selectedJobId
        });
      });
    }

    function getOwnerCustomBuildFinalHandoff(
      jobId,
      organizationId,
      requestOptions
    ) {
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedOrganizationId = requiredUuid(
        organizationId,
        "Organization ID"
      );
      var options = requestOptions || {};
      var expectedProjectId = requiredUuid(
        options.expectedProjectId,
        "Custom-build project ID"
      );
      return request(
        "GET",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/final-handoff?organizationId="
          + encodeURIComponent(selectedOrganizationId),
        { signal: options.signal }
      ).then(function (value) {
        return validateCustomBuildHandoffOwnerReadiness(value, {
          organizationId: selectedOrganizationId,
          projectId: expectedProjectId,
          jobId: selectedJobId
        });
      });
    }

    function reconcileOwnerCustomBuildFinalCheckout(
      jobId,
      attemptId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["commandId", "organizationId"],
        "Custom-build final Checkout reconciliation"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedAttemptId = requiredUuid(
        attemptId,
        "Custom-build final Checkout attempt ID"
      );
      var selectedOrganizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build final Checkout reconciliation command ID"
      );
      var options = requestOptions || {};
      var expected = validateCustomBuildFinalPaymentsOwner(
        options.expectedState,
        {
          organizationId: selectedOrganizationId,
          projectId: options.expectedProjectId,
          jobId: selectedJobId
        }
      );
      finalInvariant(
        expected.owner.attemptId === selectedAttemptId
        && (expected.owner.canReconcileCreation
          || expected.owner.canReconcileSettlement)
        && expected.finalPayment.invoice !== null
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/final-payments/"
          + segment(selectedAttemptId, "Custom-build final attempt ID")
          + "/checkout-reconciliation",
        {
          body: {
            commandId: commandId,
            organizationId: selectedOrganizationId
          },
          idempotencyKey: commandId,
          signal: options.signal
        }
      ).then(function (value) {
        return validateCustomBuildFinalOwnerReconciliation(value, {
          organizationId: selectedOrganizationId,
          jobId: selectedJobId,
          attemptId: selectedAttemptId,
          invoiceId: expected.finalPayment.invoice.invoiceId
        });
      });
    }

    function createOwnerCustomBuildHandoff(
      jobId,
      input,
      requestOptions
    ) {
      var source = exactInput(input, [
        "commandId",
        "customerSummary",
        "deliveryManifest",
        "expectedCompletionPackageDigest",
        "expectedFinalObligationDigest",
        "organizationId"
      ], "Custom-build handoff");
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedOrganizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build handoff command ID"
      );
      var manifest = Array.isArray(source.deliveryManifest)
        ? source.deliveryManifest.map(function (entry, index) {
            var item = exactInput(
              entry,
              ["description", "label"],
              "Custom-build handoff item " + String(index + 1)
            );
            return {
              label: customBuildSafeText(
                item.label,
                "Handoff item label",
                2,
                120
              ),
              description: customBuildSafeText(
                item.description,
                "Handoff item description",
                2,
                500
              )
            };
          })
        : [];
      if (manifest.length < 1 || manifest.length > 40) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Include between one and forty exact handoff items."
        });
      }
      if (
        new Set(manifest.map(function (entry) {
          return portableCustomBuildLabelKey(entry.label);
        })).size !== manifest.length
        || customBuildUtf8ByteLength(customBuildCanonicalJson({
          items: manifest
        })) > 30 * 1024
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message:
            "Handoff labels must be unique and the exact manifest must be 30 KiB or smaller."
        });
      }
      var body = {
        commandId: commandId,
        customerSummary: customBuildSafeText(
          source.customerSummary,
          "Customer handoff summary",
          20,
          2000
        ),
        deliveryManifest: manifest,
        expectedCompletionPackageDigest: requiredDigest(
          source.expectedCompletionPackageDigest,
          "Expected completion-package digest"
        ),
        expectedFinalObligationDigest: requiredDigest(
          source.expectedFinalObligationDigest,
          "Expected final-obligation digest"
        ),
        organizationId: selectedOrganizationId
      };
      var options = requestOptions || {};
      var expected = validateCustomBuildHandoffOwnerReadiness(
        options.expectedState,
        {
          organizationId: selectedOrganizationId,
          projectId: options.expectedProjectId,
          jobId: selectedJobId
        }
      );
      finalInvariant(
        expected.action.handoffAvailable === true
        && expected.completion.packageDigest ===
          body.expectedCompletionPackageDigest
        && expected.finalObligation.obligationDigest ===
          body.expectedFinalObligationDigest
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/handoff",
        {
          body: body,
          idempotencyKey: commandId,
          signal: options.signal
        }
      ).then(function (value) {
        return validateCustomBuildHandoffCommand(value, {
          organizationId: selectedOrganizationId,
          projectId: options.expectedProjectId,
          jobId: selectedJobId,
          expectedCompletionPackageDigest:
            body.expectedCompletionPackageDigest,
          expectedFinalObligationDigest:
            body.expectedFinalObligationDigest
        });
      });
    }

    function getCustomServicesCustomBuildCompletionEvidence(
      projectId,
      evidenceId,
      requestOptions
    ) {
      return requestPrivateEvidence(
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-completion-evidence/"
          + segment(
            requiredUuid(evidenceId, "Custom-build completion evidence ID"),
            "Custom-build completion evidence ID"
          ),
        requestOptions
      );
    }

    function customBuildChangeCommandId(value, field) {
      return customBuildSafeText(value, field, 8, 200);
    }

    function customBuildCompletionEvidenceBase64(value) {
      if (
        typeof value !== "string"
        || value.length < 4
        || value.length % 4 !== 0
        || value.length >
          Math.ceil(MAXIMUM_ASSESSMENT_EVIDENCE_BYTES / 3) * 4 + 4
        || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message:
            "Custom-build completion evidence is invalid or larger than 700 KiB."
        });
      }
      var padding = value.endsWith("==")
        ? 2
        : value.endsWith("=") ? 1 : 0;
      var byteCount = Math.floor(value.length * 3 / 4) - padding;
      if (
        byteCount < 1
        || byteCount > MAXIMUM_ASSESSMENT_EVIDENCE_BYTES
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message:
            "Custom-build completion evidence is invalid or larger than 700 KiB."
        });
      }
      return value;
    }

    function canonicalCustomBuildCompletionEvidenceIds(value) {
      if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Choose between two and twelve completion evidence images."
        });
      }
      var selected = value.map(function (entry) {
        return requiredUuid(entry, "Custom-build completion evidence ID");
      });
      if (
        new Set(selected).size !== selected.length
        || JSON.stringify(selected) !== JSON.stringify(selected.slice().sort())
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message:
            "Completion evidence must be unique and kept in canonical order."
        });
      }
      return selected;
    }

    function acceptCustomServicesCustomBuildChangeOrder(
      projectId,
      changeOrderId,
      input
    ) {
      var source = exactInput(
        input,
        [
          "acceptanceStatement",
          "acceptedDisclosureDigest",
          "acceptedQuoteDigest",
          "commandId"
        ],
        "Custom-build change-order acceptance"
      );
      rejectClaimedAuthority(source);
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change-order acceptance command ID"
      );
      if (
        source.acceptanceStatement !==
          "accepted_exact_change_order_and_payment_requirement"
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Custom-build change-order acceptance is invalid."
        });
      }
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-change-orders/"
          + segment(
            requiredUuid(changeOrderId, "Custom-build change-order ID"),
            "Custom-build change-order ID"
          )
          + "/acceptance",
        {
          body: {
            acceptanceStatement:
              "accepted_exact_change_order_and_payment_requirement",
            acceptedDisclosureDigest: requiredDigest(
              source.acceptedDisclosureDigest,
              "Accepted change-order disclosure digest"
            ),
            acceptedQuoteDigest: requiredDigest(
              source.acceptedQuoteDigest,
              "Accepted change-order quote digest"
            ),
            commandId: commandId
          },
          idempotencyKey: commandId
        }
      ).then(validateCustomBuildCustomerChangeCompletion);
    }

    function declineCustomServicesCustomBuildChangeOrder(
      projectId,
      changeOrderId,
      input
    ) {
      var source = exactInput(
        input,
        [
          "commandId",
          "declineStatement",
          "declinedDisclosureDigest",
          "declinedQuoteDigest"
        ],
        "Custom-build change-order decline"
      );
      rejectClaimedAuthority(source);
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change-order decline command ID"
      );
      if (
        source.declineStatement !==
          "declined_exact_custom_build_change_quote"
      ) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Custom-build change-order decline is invalid."
        });
      }
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-change-orders/"
          + segment(
            requiredUuid(changeOrderId, "Custom-build change-order ID"),
            "Custom-build change-order ID"
          )
          + "/decline",
        {
          body: {
            commandId: commandId,
            declineStatement: "declined_exact_custom_build_change_quote",
            declinedDisclosureDigest: requiredDigest(
              source.declinedDisclosureDigest,
              "Declined change-order disclosure digest"
            ),
            declinedQuoteDigest: requiredDigest(
              source.declinedQuoteDigest,
              "Declined change-order quote digest"
            )
          },
          idempotencyKey: commandId
        }
      ).then(validateCustomBuildCustomerChangeCompletion);
    }

    function createCustomServicesCustomBuildChangeCheckout(
      projectId,
      invoiceId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["commandId", "invoiceDigest"],
        "Custom-build change payment"
      );
      rejectClaimedAuthority(source);
      var selectedInvoiceId = requiredUuid(
        invoiceId,
        "Custom-build change invoice ID"
      );
      var invoiceDigest = requiredDigest(
        source.invoiceDigest,
        "Custom-build change invoice digest"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change payment command ID"
      );
      var options = requestOptions || {};
      var expectedInvoice = options.expectedInvoice === undefined
        ? null
        : validateCustomBuildChangeInvoice(options.expectedInvoice);
      if (expectedInvoice !== null) {
        changePaymentInvariant(
          expectedInvoice.state === "checkout_available"
          && expectedInvoice.action.available === true
          && expectedInvoice.invoice !== null
          && expectedInvoice.invoice.invoiceId === selectedInvoiceId
          && expectedInvoice.invoice.invoiceDigest === invoiceDigest
        );
      }
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-change-invoices/"
          + segment(
            selectedInvoiceId,
            "Custom-build change invoice ID"
          )
          + "/checkout-command",
        {
          body: {
            commandId: commandId,
            invoiceDigest: invoiceDigest
          },
          idempotencyKey: commandId,
          signal: options.signal
        }
      ).then(function (value) {
        var checkout = validateCustomBuildChangeCheckout(
          value,
          expectedInvoice
        );
        changePaymentInvariant(
          checkout.checkout.invoiceId === selectedInvoiceId
        );
        return checkout;
      });
    }

    function getOwnerCustomBuildChangeCompletion(
      jobId,
      organizationId,
      requestOptions
    ) {
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedOrganizationId = requiredUuid(
        organizationId,
        "Organization ID"
      );
      return request(
        "GET",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-completion?organizationId="
          + encodeURIComponent(selectedOrganizationId),
        { signal: requestOptions && requestOptions.signal }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          selectedOrganizationId
        );
      });
    }

    function getOwnerCustomBuildChangePayments(
      jobId,
      organizationId,
      requestOptions
    ) {
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedOrganizationId = requiredUuid(
        organizationId,
        "Organization ID"
      );
      return request(
        "GET",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-payments?organizationId="
          + encodeURIComponent(selectedOrganizationId),
        { signal: requestOptions && requestOptions.signal }
      ).then(function (value) {
        return validateCustomBuildChangeOwnerPayments(
          value,
          selectedJobId,
          selectedOrganizationId
        );
      });
    }

    function reconcileOwnerCustomBuildChangeCheckout(
      jobId,
      attemptId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["commandId", "organizationId"],
        "Custom-build change Checkout reconciliation"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedAttemptId = requiredUuid(
        attemptId,
        "Custom-build change Checkout attempt ID"
      );
      var selectedOrganizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change Checkout reconciliation command ID"
      );
      var options = requestOptions || {};
      var expectedPayment = options.expectedPayment === undefined
        ? null
        : customBuildChangeOwnerPayment(options.expectedPayment);
      var expectedProjectId = requiredUuid(
        options.expectedProjectId,
        "Custom-build project ID"
      );
      changePaymentInvariant(
        expectedPayment !== null
        && expectedPayment.owner.attemptId === selectedAttemptId
        && (
          expectedPayment.owner.canReconcileCreation
          || expectedPayment.owner.canReconcileSettlement
        )
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-payments/"
          + segment(
            selectedAttemptId,
            "Custom-build change Checkout attempt ID"
          )
          + "/checkout-reconciliation",
        {
          body: {
            commandId: commandId,
            organizationId: selectedOrganizationId
          },
          idempotencyKey: commandId,
          signal: options.signal
        }
      ).then(function (value) {
        return validateCustomBuildChangeOwnerReconciliation(
          value,
          {
            organizationId: selectedOrganizationId,
            projectId: expectedProjectId,
            jobId: selectedJobId,
            attemptId: selectedAttemptId,
            payment: expectedPayment
          }
        );
      });
    }

    function issueOwnerCustomBuildChangeOrder(jobId, input) {
      var source = exactInput(
        input,
        [
          "addedScope",
          "commandId",
          "expiresAt",
          "organizationId",
          "targetCompletionDate",
          "unitCount"
        ],
        "Custom-build change order"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var organizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change-order command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-orders",
        {
          body: {
            addedScope: customBuildSafeText(
              source.addedScope,
              "Added Custom-build scope",
              20,
              2000
            ),
            commandId: commandId,
            expiresAt: requiredIso(
              source.expiresAt,
              "Custom-build change-order expiration"
            ),
            organizationId: organizationId,
            targetCompletionDate: requiredDate(
              source.targetCompletionDate,
              "Custom-build target completion date"
            ),
            unitCount: integerBetween(
              source.unitCount,
              "Custom-build change-work units",
              1,
              40
            )
          },
          idempotencyKey: commandId
        }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          organizationId
        );
      });
    }

    function voidOwnerCustomBuildChangeOrder(
      jobId,
      changeOrderId,
      input
    ) {
      var source = exactInput(
        input,
        ["commandId", "expectedQuoteDigest", "organizationId", "reason"],
        "Custom-build change-order void"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedChangeOrderId = requiredUuid(
        changeOrderId,
        "Custom-build change-order ID"
      );
      var organizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change-order void command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-orders/"
          + segment(selectedChangeOrderId, "Custom-build change-order ID")
          + "/void",
        {
          body: {
            commandId: commandId,
            expectedQuoteDigest: requiredDigest(
              source.expectedQuoteDigest,
              "Expected change-order quote digest"
            ),
            organizationId: organizationId,
            reason: customBuildSafeText(
              source.reason,
              "Custom-build change-order void reason",
              20,
              500
            )
          },
          idempotencyKey: commandId
        }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          organizationId
        );
      });
    }

    function expireOwnerCustomBuildChangeOrder(
      jobId,
      changeOrderId,
      input
    ) {
      var source = exactInput(
        input,
        ["commandId", "expectedQuoteDigest", "organizationId"],
        "Custom-build change-order expiration"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var selectedChangeOrderId = requiredUuid(
        changeOrderId,
        "Custom-build change-order ID"
      );
      var organizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build change-order expiration command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/change-orders/"
          + segment(selectedChangeOrderId, "Custom-build change-order ID")
          + "/expiration",
        {
          body: {
            commandId: commandId,
            expectedQuoteDigest: requiredDigest(
              source.expectedQuoteDigest,
              "Expected change-order quote digest"
            ),
            organizationId: organizationId
          },
          idempotencyKey: commandId
        }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          organizationId
        );
      });
    }

    function uploadOwnerCustomBuildCompletionEvidence(jobId, input) {
      var source = exactInput(
        input,
        [
          "accessibleDescription",
          "commandId",
          "dataBase64",
          "mediaType",
          "organizationId",
          "viewport"
        ],
        "Custom-build completion evidence"
      );
      rejectClaimedAuthority(source);
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var organizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build completion-evidence command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/completion-evidence",
        {
          body: {
            accessibleDescription: customBuildSafeText(
              source.accessibleDescription,
              "Accessible completion-evidence description",
              10,
              500
            ),
            commandId: commandId,
            dataBase64: customBuildCompletionEvidenceBase64(
              source.dataBase64
            ),
            mediaType: oneOf(
              source.mediaType,
              "Completion evidence image type",
              CUSTOM_BUILD_EVIDENCE_MEDIA_TYPES
            ),
            organizationId: organizationId,
            viewport: oneOf(
              source.viewport,
              "Completion evidence viewport",
              ["desktop", "phone"]
            )
          },
          idempotencyKey: commandId
        }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          organizationId
        );
      });
    }

    function recordOwnerCustomBuildCompletion(jobId, input) {
      var source = exactInput(
        input,
        [
          "checks",
          "commandId",
          "customerSummary",
          "evidenceIds",
          "organizationId"
        ],
        "Custom-build completion"
      );
      rejectClaimedAuthority(source);
      var checks = exactInput(
        source.checks,
        [
          "accessibilityBasics",
          "contactActions",
          "desktop",
          "links",
          "phone",
          "scope"
        ],
        "Custom-build completion checks"
      );
      if (!Object.keys(checks).every(function (key) {
        return checks[key] === true;
      })) {
        throw new APIError({
          code: "INVALID_INPUT",
          message: "Every Custom-build completion check must be confirmed."
        });
      }
      var selectedJobId = requiredUuid(jobId, "Custom-build job ID");
      var organizationId = requiredUuid(
        source.organizationId,
        "Organization ID"
      );
      var commandId = customBuildChangeCommandId(
        source.commandId,
        "Custom-build completion command ID"
      );
      return request(
        "POST",
        "/operator/custom-services/custom-build-jobs/"
          + segment(selectedJobId, "Custom-build job ID")
          + "/completion",
        {
          body: {
            checks: {
              accessibilityBasics: true,
              contactActions: true,
              desktop: true,
              links: true,
              phone: true,
              scope: true
            },
            commandId: commandId,
            customerSummary: customBuildSafeText(
              source.customerSummary,
              "Custom-build completion summary",
              20,
              1000
            ),
            evidenceIds: canonicalCustomBuildCompletionEvidenceIds(
              source.evidenceIds
            ),
            organizationId: organizationId
          },
          idempotencyKey: commandId
        }
      ).then(function (value) {
        return validateCustomBuildOwnerChangeCompletion(
          value,
          selectedJobId,
          organizationId
        );
      });
    }

    function respondToCustomServicesCustomBuildRequest(
      projectId,
      requestId,
      input
    ) {
      var source = exactInput(
        input,
        ["commandId", "expectedRevision", "responseKind", "responseNote"],
        "Custom-build customer response"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom-build response command ID"
      );
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-requests/"
          + segment(
            requiredUuid(requestId, "Custom-build request ID"),
            "Custom-build request ID"
          )
          + "/response",
        {
          body: {
            commandId: commandId,
            expectedRevision: integerBetween(
              source.expectedRevision,
              "Expected request revision",
              1,
              Number.MAX_SAFE_INTEGER
            ),
            responseKind: oneOf(
              source.responseKind,
              "Custom-build response",
              ["provided", "cannot_provide"]
            ),
            responseNote: customBuildSafeText(
              source.responseNote,
              "Safe response note",
              1,
              1000
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function createCustomServicesCustomBuildCheckout(
      projectId,
      invoiceId,
      input,
      requestOptions
    ) {
      var source = exactInput(
        input,
        ["invoiceDigest"],
        "Custom website payment"
      );
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-invoices/"
          + segment(invoiceId, "Custom website invoice ID")
          + "/checkout-command",
        {
          body: {
            invoiceDigest: requiredDigest(
              source.invoiceDigest,
              "Custom website invoice digest"
            )
          },
          idempotencyKey:
            requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function acceptCustomServicesCustomBuildQuote(projectId, input) {
      var source = exactInput(
        input,
        [
          "acceptanceStatement",
          "acceptedDisclosureDigest",
          "acceptedQuoteDigest",
          "commandId",
          "quoteId",
          "quoteRevision"
        ],
        "Custom website quote acceptance"
      );
      rejectClaimedAuthority(source);
      var commandId = requiredUuid(
        source.commandId,
        "Custom website quote acceptance command ID"
      );
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/custom-services/custom-build-quote/acceptance",
        {
          body: {
            acceptanceStatement: oneOf(
              source.acceptanceStatement,
              "Custom website quote acceptance",
              ["accepted_exact_custom_build_quote"]
            ),
            acceptedDisclosureDigest: requiredDigest(
              source.acceptedDisclosureDigest,
              "Custom website disclosure digest"
            ),
            acceptedQuoteDigest: requiredDigest(
              source.acceptedQuoteDigest,
              "Custom website quote digest"
            ),
            commandId: commandId,
            quoteId: requiredUuid(
              source.quoteId,
              "Custom website quote ID"
            ),
            quoteRevision: integerBetween(
              source.quoteRevision,
              "Custom website quote revision",
              1,
              Number.MAX_SAFE_INTEGER
            )
          },
          idempotencyKey: commandId
        }
      );
    }

    function createProject(input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      var body = {
        name: requiredText(source.name, "Project name", 120),
        acceptedTerms: source.acceptedTerms === true
      };
      if (Object.prototype.hasOwnProperty.call(source, "visibility")) {
        body.visibility = oneOf(source.visibility, "Visibility", ["public", "private"]);
        body.accessPassword = optionalText(source.accessPassword, 256);
      }
      if (Object.prototype.hasOwnProperty.call(source, "address")) {
        var address = isObject(source.address) ? source.address : {};
        var kind = oneOf(address.kind, "Address kind", ["licensed", "custom"]);
        body.address = kind === "licensed"
          ? {
              kind: kind,
              label: requiredText(address.label, "Address label", 63)
            }
          : {
              kind: kind,
              path: oneOf(address.path, "Customer domain path", ["purchase", "connect"]),
              hostname: requiredText(address.hostname, "Domain", 253).toLowerCase()
            };
      }
      return request(
        "POST",
        "/organizations/" + segment(source.organizationId, "Organization ID") + "/projects",
        {
          body: body,
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function saveDraft(input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("PUT", "/projects/" + segment(source.projectId, "Project ID") + "/draft", {
        body: { rawFacts: source.rawFacts },
        revision: source.revision,
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function createVersion(input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request("POST", "/projects/" + segment(source.projectId, "Project ID") + "/versions", {
        body: {
          rawFacts: source.rawFacts,
          previewDigest: optionalText(source.previewDigest, 64),
          reviewAttested: source.reviewAttested === true
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function markVersionReady(projectId, versionId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/versions/" + segment(versionId, "Version ID") + "/ready",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function acceptVersion(projectId, versionId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/versions/" + segment(versionId, "Version ID") + "/accept",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function selectAddress(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      var kind = oneOf(source.kind, "Address kind", ["licensed", "custom"]);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/addresses/" + kind,
        {
          body: kind === "licensed"
            ? { label: requiredText(source.label, "Address label", 63) }
            : {
                path: oneOf(source.path, "Customer domain path", ["purchase", "connect"]),
                hostname: requiredText(source.hostname, "Domain", 253)
              },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestDomainVerification(projectId, addressId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/addresses/" + segment(addressId, "Address ID") + "/verification-requests",
        {
          body: {
            method: requiredText(source.method, "Verification method", 40),
            reference: requiredText(source.reference, "Proof reference", 1000)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getOfferCatalog(requestOptions) {
      return request("GET", "/offers", {
        signal: requestOptions && requestOptions.signal
      });
    }

    function createCommerceQuote(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      var body = {
        offerId: requiredText(source.offerId, "Offer ID", 100)
      };
      var domainQuoteId = optionalText(source.domainQuoteId, 200);
      if (domainQuoteId) body.domainQuoteId = domainQuoteId;
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/commerce-quotes",
        {
          body: body,
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getCommerceQuote(projectId, quoteId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/commerce-quotes/" + segment(quoteId, "Commerce quote ID"),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function createCommerceCheckout(projectId, quoteId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/commerce-quotes/" + segment(quoteId, "Commerce quote ID") + "/checkout",
        {
          body: {
            acceptedDisclosureDigest: requiredText(
              source.acceptedDisclosureDigest,
              "Accepted quote digest",
              100
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function createDownloadQuote(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/download-quotes",
        {
          body: {
            versionId: requiredText(source.versionId, "Version ID", 200)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function prepareDownloadCheckout(projectId, quoteId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/download-quotes/" + segment(quoteId, "Download quote ID")
          + "/checkout-command",
        {
          body: {
            acceptedDisclosureDigest: requiredText(
              source.acceptedDisclosureDigest,
              "Accepted Download quote digest",
              100
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function createAlakazamQuote(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/alakazam-quotes",
        {
          body: {
            targetTierId: requiredText(source.targetTierId, "Target tier ID", 100)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function createAlakazamCheckout(projectId, quoteId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam-quotes/" + segment(quoteId, "Alakazam quote ID")
          + "/checkout-command",
        {
          body: {
            acceptedDisclosureDigest: requiredText(
              source.acceptedDisclosureDigest,
              "Accepted Alakazam disclosure digest",
              100
            ),
            siteSetupDigest: nullableDigest(
              source.siteSetupDigest,
              "Alakazam site setup digest"
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function scheduleAlakazamDowngrade(projectId, quoteId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam-quotes/" + segment(quoteId, "Alakazam quote ID")
          + "/downgrade-schedule-command",
        {
          body: {
            acceptedDisclosureDigest: requiredText(
              source.acceptedDisclosureDigest,
              "Accepted Alakazam disclosure digest",
              100
            ),
            quoteDigest: requiredText(
              source.quoteDigest,
              "Alakazam quote digest",
              100
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function billingPortal(projectId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/billing-portal-sessions",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function subscription(projectId) {
      return request("GET", "/projects/" + segment(projectId, "Project ID") + "/subscription");
    }

    function cancellationPreview(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID") + "/subscription/cancellation-preview",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function cancelSubscription(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/subscription/cancel",
        {
          body: {
            previewId: requiredText(source.previewId, "Cancellation preview ID", 200),
            acceptedDisclosureDigest: requiredText(
              source.acceptedDisclosureDigest,
              "Accepted cancellation digest",
              100
            )
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestRelease(projectId, versionId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/release-requests",
        {
          body: { versionId: requiredText(versionId, "Version ID", 200) },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function rollbackRelease(projectId, versionId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/versions/" + segment(versionId, "Version ID") + "/rollback",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function unpublish(projectId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/unpublish",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function setVisibility(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request("PUT", "/projects/" + segment(projectId, "Project ID") + "/visibility", {
        body: {
          visibility: requiredText(source.visibility, "Visibility", 20),
          accessPassword: optionalText(source.accessPassword, 256)
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function createSupportTicket(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/support-tickets",
        {
          body: {
            subject: requiredText(source.subject, "Subject", 120),
            message: requiredText(source.message, "Message", 4000)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestExport(projectId, requestOptions) {
      return request("POST", "/projects/" + segment(projectId, "Project ID") + "/exports", {
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function getExport(projectId, exportId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/exports/" + segment(exportId, "Export ID"),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function retryExport(projectId, exportId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID")
          + "/exports/" + segment(exportId, "Export ID") + "/retry",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
      );
    }

    function downloadExport(projectId, exportId, token, requestOptions) {
      return requestBinary(
        "/projects/" + segment(projectId, "Project ID")
          + "/exports/" + segment(exportId, "Export ID")
          + "/download?token=" + encodeURIComponent(requiredText(token, "Export download token", 512)),
        requestOptions
      );
    }

    function deleteProject(projectId, requestOptions) {
      return request("DELETE", "/projects/" + segment(projectId, "Project ID"), {
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function searchDomains(query, requestOptions) {
      var name = requiredText(query, "Domain search", 253).toLowerCase();
      return request(
        "GET",
        "/domains/search?query=" + encodeURIComponent(name),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function createDomainQuote(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request("POST", "/domain-quotes", {
        body: {
          projectId: requiredText(projectId, "Project ID", 200),
          hostname: requiredText(source.hostname, "Domain", 253).toLowerCase(),
          years: integerBetween(source.years == null ? 1 : source.years, "Registration term", 1, 10),
          purpose: source.purpose == null
            ? "register"
            : oneOf(source.purpose, "Domain quote purpose", ["register", "renew"])
        },
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
    }

    function saveRegistrantContact(organizationId, projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/organizations/" + segment(organizationId, "Organization ID") + "/registrant-contacts",
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            name: requiredText(source.name, "Registrant name", 100),
            organization: optionalText(source.organization, 120),
            email: requiredText(source.email, "Registrant email", 254),
            phone: requiredText(source.phone, "Registrant phone", 40),
            addressLine1: requiredText(source.addressLine1, "Street address", 120),
            addressLine2: optionalText(source.addressLine2, 120),
            city: requiredText(source.city, "City", 100),
            region: requiredText(source.region, "State or region", 100),
            postalCode: requiredText(source.postalCode, "Postal code", 30),
            countryCode: (function () {
              var country = requiredText(source.countryCode, "Country code", 2).toUpperCase();
              if (!/^[A-Z]{2}$/u.test(country)) {
                throw new APIError({
                  code: "INVALID_INPUT",
                  message: "Country code must contain exactly two letters."
                });
              }
              return country;
            }())
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function acceptDomainConsent(projectId, quoteId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/domain-quotes/" + segment(quoteId, "Domain quote ID") + "/consents",
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            registrantContactId: requiredText(
              source.registrantContactId,
              "Registrant contact ID",
              200
            ),
            termsVersion: requiredText(source.termsVersion, "Domain terms version", 100),
            registrationAgreementAccepted: source.registrationAgreementAccepted === true,
            registrantCertificationAccepted: source.registrantCertificationAccepted === true,
            autoRenewRequested: source.autoRenewRequested === true
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function createDomainOrder(projectId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/domain-orders",
        {
          body: {
            quoteId: requiredText(source.quoteId, "Domain quote ID", 200),
            consentId: requiredText(source.consentId, "Domain consent ID", 200)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function getDomainOrder(projectId, orderId, requestOptions) {
      return request(
        "GET",
        "/domain-orders/" + segment(orderId, "Domain order ID")
          + "?projectId=" + segment(projectId, "Project ID"),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function listDomainOrders(projectId) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID") + "/domain-orders"
      );
    }

    function refreshDomainPrice(projectId, orderId, requestOptions) {
      return request(
        "POST",
        "/domain-orders/" + segment(orderId, "Domain order ID") + "/price-checks",
        {
          body: { projectId: requiredText(projectId, "Project ID", 200) },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestDomainRegistration(projectId, orderId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "POST",
        "/domain-orders/" + segment(orderId, "Domain order ID") + "/registration-requests",
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            priceCheckId: requiredText(source.priceCheckId, "Fresh price check ID", 200),
            irreversibleRegistrationAccepted: source.irreversibleRegistrationAccepted === true
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function listDomains(organizationId, projectId) {
      return request(
        "GET",
        "/organizations/" + segment(organizationId, "Organization ID") + "/domains"
          + "?projectId=" + segment(projectId, "Project ID")
      );
    }

    function getDomain(projectId, domainId) {
      return request(
        "GET",
        "/domains/" + segment(domainId, "Domain ID")
          + "?projectId=" + segment(projectId, "Project ID")
      );
    }

    function listDnsRecords(projectId, domainId) {
      return request(
        "GET",
        "/domains/" + segment(domainId, "Domain ID") + "/dns-records"
          + "?projectId=" + segment(projectId, "Project ID")
      );
    }

    function upsertDnsRecord(projectId, domainId, input, requestOptions) {
      var source = isObject(input) ? input : {};
      rejectClaimedAuthority(source);
      return request(
        "PUT",
        "/domains/" + segment(domainId, "Domain ID") + "/dns-records/"
          + segment(source.recordId || "new", "DNS record ID"),
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            type: requiredText(source.type, "DNS record type", 10).toUpperCase(),
            name: requiredText(source.name, "DNS record name", 253),
            content: requiredText(source.content, "DNS record value", 2000),
            ttl: integerBetween(source.ttl == null ? 3600 : source.ttl, "DNS TTL", 60, 86400)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function deleteDnsRecord(projectId, domainId, recordId, requestOptions) {
      return request(
        "DELETE",
        "/domains/" + segment(domainId, "Domain ID") + "/dns-records/"
          + segment(recordId, "DNS record ID"),
        {
          body: { projectId: requiredText(projectId, "Project ID", 200) },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function setDomainAutoRenew(projectId, domainId, enabled, requestOptions) {
      return request(
        "PUT",
        "/domains/" + segment(domainId, "Domain ID") + "/auto-renew",
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            enabled: enabled === true
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestDomainRenewalQuote(projectId, domainId, years, requestOptions) {
      return request(
        "POST",
        "/domains/" + segment(domainId, "Domain ID") + "/renewal-quotes",
        {
          body: {
            projectId: requiredText(projectId, "Project ID", 200),
            years: integerBetween(years == null ? 1 : years, "Renewal term", 1, 10)
          },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    function requestDomainTransferOut(projectId, domainId, requestOptions) {
      return request(
        "POST",
        "/domains/" + segment(domainId, "Domain ID") + "/transfer-out-requests",
        {
          body: { projectId: requiredText(projectId, "Project ID", 200) },
          idempotencyKey: requestOptions && requestOptions.idempotencyKey
        }
      );
    }

    return Object.freeze({
      request: request,
      register: register,
      completeRegistration:
        completeRegistration,
      signIn: signIn,
      signOut: signOut,
      requestRecovery: requestRecovery,
      completeRecovery: completeRecovery,
      me: me,
      capabilities: capabilities,
      listOrganizations: listOrganizations,
      listProjects: listProjects,
      getProject: getProject,
      getAlakazamAccount: getAlakazamAccount,
      getAlakazamInvoice: getAlakazamInvoice,
      getAlakazamCancellationPreview:
        getAlakazamCancellationPreview,
      getAlakazamBillingStates:
        getAlakazamBillingStates,
      getAlakazamPublication: getAlakazamPublication,
      requestAlakazamPublication:
        requestAlakazamPublication,
      getCustomServicesAssessmentRequest:
        getCustomServicesAssessmentRequest,
      saveCustomServicesAssessmentRequest:
        saveCustomServicesAssessmentRequest,
      submitCustomServicesAssessmentRequest:
        submitCustomServicesAssessmentRequest,
      withdrawCustomServicesAssessmentRequest:
        withdrawCustomServicesAssessmentRequest,
      getCustomServicesAssessmentQuote:
        getCustomServicesAssessmentQuote,
      getCustomServicesAssessmentInvoice:
        getCustomServicesAssessmentInvoice,
      createCustomServicesAssessmentCheckout:
        createCustomServicesAssessmentCheckout,
      acceptCustomServicesAssessmentQuote:
        acceptCustomServicesAssessmentQuote,
      listOwnerAssessmentRequests:
        listOwnerAssessmentRequests,
      issueOwnerAssessmentQuote:
        issueOwnerAssessmentQuote,
      listOwnerAssessmentJobs:
        listOwnerAssessmentJobs,
      uploadOwnerAssessmentEvidence:
        uploadOwnerAssessmentEvidence,
      putOwnerAssessmentFinding:
        putOwnerAssessmentFinding,
      deliverOwnerAssessmentReport:
        deliverOwnerAssessmentReport,
      getCustomServicesAssessmentReport:
        getCustomServicesAssessmentReport,
      listOwnerCustomBuildOpportunities:
        listOwnerCustomBuildOpportunities,
      listOwnerCustomBuildJobs:
        listOwnerCustomBuildJobs,
      getOwnerCustomBuildProgress:
        getOwnerCustomBuildProgress,
      recordOwnerCustomBuildProgress:
        recordOwnerCustomBuildProgress,
      openOwnerCustomBuildRequest:
        openOwnerCustomBuildRequest,
      resolveOwnerCustomBuildRequest:
        resolveOwnerCustomBuildRequest,
      issueOwnerCustomBuildQuote:
        issueOwnerCustomBuildQuote,
      voidOwnerCustomBuildQuote:
        voidOwnerCustomBuildQuote,
      getCustomServicesCustomBuildQuote:
        getCustomServicesCustomBuildQuote,
      getCustomServicesCustomBuildInvoice:
        getCustomServicesCustomBuildInvoice,
      getCustomServicesCustomBuildProgress:
        getCustomServicesCustomBuildProgress,
      getCustomServicesCustomBuildChangeCompletion:
        getCustomServicesCustomBuildChangeCompletion,
      getCustomServicesCustomBuildChangeInvoice:
        getCustomServicesCustomBuildChangeInvoice,
      getCustomServicesCustomBuildFinalHandoff:
        getCustomServicesCustomBuildFinalHandoff,
      createCustomServicesCustomBuildFinalCheckout:
        createCustomServicesCustomBuildFinalCheckout,
      getCustomServicesCustomBuildHandoffDocument:
        getCustomServicesCustomBuildHandoffDocument,
      getCustomServicesCustomBuildCompletionEvidence:
        getCustomServicesCustomBuildCompletionEvidence,
      acceptCustomServicesCustomBuildChangeOrder:
        acceptCustomServicesCustomBuildChangeOrder,
      declineCustomServicesCustomBuildChangeOrder:
        declineCustomServicesCustomBuildChangeOrder,
      createCustomServicesCustomBuildChangeCheckout:
        createCustomServicesCustomBuildChangeCheckout,
      getOwnerCustomBuildChangeCompletion:
        getOwnerCustomBuildChangeCompletion,
      getOwnerCustomBuildChangePayments:
        getOwnerCustomBuildChangePayments,
      reconcileOwnerCustomBuildChangeCheckout:
        reconcileOwnerCustomBuildChangeCheckout,
      getOwnerCustomBuildFinalHandoff:
        getOwnerCustomBuildFinalHandoff,
      getOwnerCustomBuildFinalPayments:
        getOwnerCustomBuildFinalPayments,
      reconcileOwnerCustomBuildFinalCheckout:
        reconcileOwnerCustomBuildFinalCheckout,
      createOwnerCustomBuildHandoff:
        createOwnerCustomBuildHandoff,
      issueOwnerCustomBuildChangeOrder:
        issueOwnerCustomBuildChangeOrder,
      voidOwnerCustomBuildChangeOrder:
        voidOwnerCustomBuildChangeOrder,
      expireOwnerCustomBuildChangeOrder:
        expireOwnerCustomBuildChangeOrder,
      uploadOwnerCustomBuildCompletionEvidence:
        uploadOwnerCustomBuildCompletionEvidence,
      recordOwnerCustomBuildCompletion:
        recordOwnerCustomBuildCompletion,
      respondToCustomServicesCustomBuildRequest:
        respondToCustomServicesCustomBuildRequest,
      createCustomServicesCustomBuildCheckout:
        createCustomServicesCustomBuildCheckout,
      acceptCustomServicesCustomBuildQuote:
        acceptCustomServicesCustomBuildQuote,
      createProject: createProject,
      saveDraft: saveDraft,
      createVersion: createVersion,
      markVersionReady: markVersionReady,
      acceptVersion: acceptVersion,
      selectAddress: selectAddress,
      requestDomainVerification: requestDomainVerification,
      getOfferCatalog: getOfferCatalog,
      createCommerceQuote: createCommerceQuote,
      getCommerceQuote: getCommerceQuote,
      createCommerceCheckout: createCommerceCheckout,
      createDownloadQuote: createDownloadQuote,
      prepareDownloadCheckout: prepareDownloadCheckout,
      createAlakazamQuote: createAlakazamQuote,
      createAlakazamCheckout: createAlakazamCheckout,
      scheduleAlakazamDowngrade: scheduleAlakazamDowngrade,
      billingPortal: billingPortal,
      subscription: subscription,
      cancellationPreview: cancellationPreview,
      cancelSubscription: cancelSubscription,
      requestRelease: requestRelease,
      rollbackRelease: rollbackRelease,
      unpublish: unpublish,
      setVisibility: setVisibility,
      createSupportTicket: createSupportTicket,
      requestExport: requestExport,
      getExport: getExport,
      retryExport: retryExport,
      downloadExport: downloadExport,
      deleteProject: deleteProject,
      searchDomains: searchDomains,
      createDomainQuote: createDomainQuote,
      saveRegistrantContact: saveRegistrantContact,
      acceptDomainConsent: acceptDomainConsent,
      createDomainOrder: createDomainOrder,
      getDomainOrder: getDomainOrder,
      listDomainOrders: listDomainOrders,
      refreshDomainPrice: refreshDomainPrice,
      requestDomainRegistration: requestDomainRegistration,
      listDomains: listDomains,
      getDomain: getDomain,
      listDnsRecords: listDnsRecords,
      upsertDnsRecord: upsertDnsRecord,
      deleteDnsRecord: deleteDnsRecord,
      setDomainAutoRenew: setDomainAutoRenew,
      requestDomainRenewalQuote: requestDomainRenewalQuote,
      requestDomainTransferOut: requestDomainTransferOut
    });
  }

  return Object.freeze({
    APIError: APIError,
    createClient: createClient
  });
}));
