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
    /(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery[ _-]?code|private[ _-]?key|seed[ _-]?phrase)/iu;
  var MAXIMUM_ASSESSMENT_EVIDENCE_BYTES = 700 * 1024;
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
      selected.length < minimum
      || selected.length > maximum
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
    if (CUSTOM_BUILD_CREDENTIAL.test(selected)) {
      throw new APIError({
        code: "INVALID_INPUT",
        message: field
          + " must not contain passwords, verification codes, API keys, tokens, or other credentials."
      });
    }
    return selected;
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
