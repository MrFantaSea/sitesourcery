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
      if (isObject(source[key])) rejectClaimedAuthority(source[key]);
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

    function listOrganizations() {
      return request("GET", "/organizations");
    }

    function listProjects(organizationId) {
      return request("GET", "/organizations/" + segment(organizationId, "Organization ID") + "/projects");
    }

    function getProject(projectId) {
      return request("GET", "/projects/" + segment(projectId, "Project ID"));
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
      signIn: signIn,
      signOut: signOut,
      requestRecovery: requestRecovery,
      completeRecovery: completeRecovery,
      me: me,
      listOrganizations: listOrganizations,
      listProjects: listProjects,
      getProject: getProject,
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
