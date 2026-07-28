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
    "currency",
    "entitlement",
    "externalCheckoutRef",
    "externalSubscriptionRef",
    "paymentReceipt",
    "providerReference",
    "providerReceipt",
    "published",
    "signatureVerified",
    "subscriptionId",
    "subscriptionState",
    "verified"
  ]);

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

  function segment(value, field) {
    return encodeURIComponent(requiredText(value, field, 200));
  }

  function copyAllowed(source, fields) {
    var result = {};
    fields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    });
    return result;
  }

  function rejectClaimedAuthority(source) {
    if (!isObject(source)) return;
    Object.keys(source).forEach(function (key) {
      if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
        throw new APIError({
          code: "OWNER_AUTHORITY_REJECTED",
          message: "Payment, subscription, verification, and publication authority comes from verified providers."
        });
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
    var baseUrl = String(config.baseUrl || "/api/v1").replace(/\/+$/u, "");
    var idempotencyFactory = config.idempotencyFactory || defaultIdempotencyKey;
    var csrfToken = null;

    async function request(method, path, optionsForRequest) {
      var requestOptions = optionsForRequest || {};
      var upperMethod = String(method || "GET").toUpperCase();
      var headers = Object.assign({ Accept: "application/json" }, requestOptions.headers || {});
      var body;
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
        try {
          payload = contentType.includes("application/json")
            ? await response.json()
            : { message: await response.text() };
        } catch (_error) {
          payload = null;
        }
      }
      if (!response.ok) {
        var errorBody = payload && isObject(payload.error) ? payload.error : payload;
        throw new APIError({
          status: response.status,
          code: errorBody && errorBody.code,
          message: errorBody && errorBody.message,
          requestId: (errorBody && errorBody.requestId) || requestId,
          retryable: response.status === 409 || response.status === 429 || response.status >= 500
        });
      }
      if (payload && typeof payload.csrfToken === "string") csrfToken = payload.csrfToken;
      return payload;
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
      var body = copyAllowed(source, [
        "name",
        "address",
        "visibility",
        "accessPassword",
        "acceptedTerms"
      ]);
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
      var kind = source.kind === "licensed" ? "licensed" : "custom";
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/addresses/" + kind,
        {
          body: kind === "licensed"
            ? { label: requiredText(source.label, "Address label", 63) }
            : {
                path: source.path === "purchase" ? "purchase" : "connect",
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

    function checkout(projectId, priceId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/checkout-intents",
        {
          body: { priceId: requiredText(priceId, "Price ID", 200) },
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

    function cancelSubscription(projectId, requestOptions) {
      return request(
        "POST",
        "/projects/" + segment(projectId, "Project ID") + "/subscription/cancel",
        { idempotencyKey: requestOptions && requestOptions.idempotencyKey }
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

    function deleteProject(projectId, requestOptions) {
      return request("DELETE", "/projects/" + segment(projectId, "Project ID"), {
        idempotencyKey: requestOptions && requestOptions.idempotencyKey
      });
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
      checkout: checkout,
      billingPortal: billingPortal,
      subscription: subscription,
      cancelSubscription: cancelSubscription,
      requestRelease: requestRelease,
      unpublish: unpublish,
      setVisibility: setVisibility,
      createSupportTicket: createSupportTicket,
      requestExport: requestExport,
      deleteProject: deleteProject
    });
  }

  return Object.freeze({
    APIError: APIError,
    createClient: createClient
  });
}));
