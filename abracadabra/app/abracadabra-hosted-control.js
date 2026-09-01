(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraHostedControl = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function ControlError(input) {
    var source = input || {};
    this.name = "AbracadabraHostedControlError";
    this.message = source.message || "That request could not be completed.";
    this.code = source.code || "CONTROL_FAILED";
    this.retryable = source.retryable === true;
    this.requestId = source.requestId || null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ControlError);
  }
  ControlError.prototype = Object.create(Error.prototype);
  ControlError.prototype.constructor = ControlError;

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function arrayFrom(payload, key) {
    if (Array.isArray(payload)) return payload;
    return payload && Array.isArray(payload[key]) ? payload[key] : [];
  }

  function entityFrom(payload, key) {
    if (!payload) return null;
    return isObject(payload[key]) ? payload[key] : isObject(payload) ? payload : null;
  }

  function idOf(value) {
    return String(value && (
      value.id
      || value.projectId
      || value.versionId
      || value.quoteId
      || value.registrantContactId
      || value.contactId
      || value.consentId
      || value.domainOrderId
      || value.orderId
      || value.priceCheckId
      || value.domainId
    ) || "");
  }

  function commerceQuoteIdOf(value) {
    return String(value && (value.quoteId || value.id) || "");
  }

  function cancellationPreviewIdOf(value) {
    return String(value && (value.previewId || value.id) || "");
  }

  function domainPriceCheckIdOf(value) {
    return String(value && (value.priceCheckId || value.id) || "");
  }

  function projectIdOf(value) {
    return String(value && value.projectId || "");
  }

  function projectBound(value, projectId, label) {
    if (!value || projectIdOf(value) !== projectId) {
      throw new ControlError({
        code: "DOMAIN_PROJECT_RESPONSE_INVALID",
        message: "The " + label + " did not match the selected project."
      });
    }
    return value;
  }

  function projectBoundList(values, projectId, label) {
    if (!Array.isArray(values) || values.some(function (value) {
      return projectIdOf(value) !== projectId;
    })) {
      throw new ControlError({
        code: "DOMAIN_PROJECT_RESPONSE_INVALID",
        message: "The " + label + " did not match the selected project."
      });
    }
    return values;
  }

  function exactDomainPaymentPath(order) {
    var orderId = idOf(order);
    var projectId = projectIdOf(order);
    var destination = String(order && (order.paymentUrl || order.checkoutUrl) || "");
    if (!orderId || !projectId || !destination) return "";
    var expected = "/api/v1/domain-orders/" + encodeURIComponent(orderId) + "/payment"
      + "?projectId=" + encodeURIComponent(projectId);
    return destination === expected ? destination : "";
  }

  function exportIdOf(value) {
    return String(value && (value.exportId || value.id) || "");
  }

  function addressBindingOf(project) {
    var address = project && project.address || {};
    var mode = address.kind === "licensed"
      ? "licensed"
      : (
          address.kind === "custom" || address.mode === "mode_b"
            ? "customer_owned"
            : ""
        );
    var revision = address.revision != null
      ? address.revision
      : address.version != null
        ? address.version
        : address.updatedAt;
    return Object.freeze({
      mode: mode,
      revision: revision == null ? "" : String(revision)
    });
  }

  function validMoney(value) {
    return Boolean(
      value
      && Number.isSafeInteger(Number(value.amountMinor))
      && Number(value.amountMinor) >= 0
      && /^[A-Z]{3}$/u.test(String(value.currency || "").toUpperCase())
    );
  }

  function readyDomainPriceCheck(value, now) {
    return Boolean(
      value
      && domainPriceCheckIdOf(value)
      && value.status === "ready_to_confirm"
      && value.available === true
      && validMoney(value.finalPrice)
      && Number.isFinite(Date.parse(value.checkedAt))
      && Number.isFinite(Date.parse(value.expiresAt))
      && Date.parse(value.expiresAt) > Number(now)
    );
  }

  function revisionOf(project) {
    if (!project) return null;
    if (project.draft && project.draft.revision != null) return project.draft.revision;
    if (project.draftRevision != null) return project.draftRevision;
    if (project.revision != null) return project.revision;
    return null;
  }

  function safeError(error, fallback) {
    return Object.freeze({
      code: error && error.code ? String(error.code) : "REQUEST_FAILED",
      message: error && error.message ? String(error.message) : fallback,
      retryable: Boolean(error && error.retryable),
      requestId: error && error.requestId ? String(error.requestId) : null
    });
  }

  function defaultIdempotencyKey() {
    var cryptoObject = typeof globalThis === "object" ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return cryptoObject.randomUUID();
    }
    throw new ControlError({
      code: "IDEMPOTENCY_UNAVAILABLE",
      message: "Please update your browser before saving changes."
    });
  }

  function operationSnapshot(operations) {
    var result = {};
    Object.keys(operations).forEach(function (name) {
      var operation = operations[name];
      result[name] = Object.freeze({
        status: operation.status,
        attempt: operation.attempt,
        error: operation.error ? Object.freeze(Object.assign({}, operation.error)) : null
      });
    });
    return Object.freeze(result);
  }

  function createHostedControl(options) {
    var config = options || {};
    var api = config.api;
    if (!api || typeof api.me !== "function") {
      throw new ControlError({
        code: "API_REQUIRED",
        message: "Saved projects could not connect securely."
      });
    }
    var idempotencyFactory = config.idempotencyFactory || defaultIdempotencyKey;
    var configuredCatalog = config.catalog && isObject(config.catalog)
      ? config.catalog
      : { catalogVersion: null, products: {}, tenures: {}, offers: {} };
    var catalogProducts = {};
    var catalogTenures = {};
    var catalogOffers = {};
    Object.keys(configuredCatalog.products || {}).forEach(function (key) {
      var product = configuredCatalog.products[key];
      if (
        key !== "spark"
        || !product
        || !product.label
        || product.implementationContract !== "abracadabra.spark/v1"
      ) return;
      catalogProducts[key] = Object.freeze({
        label: String(product.label),
        summary: String(product.summary || ""),
        implementationContract: "abracadabra.spark/v1"
      });
    });
    Object.keys(configuredCatalog.tenures || {}).forEach(function (key) {
      var tenure = configuredCatalog.tenures[key];
      if (!tenure || !tenure.label) return;
      catalogTenures[key] = Object.freeze({
        label: String(tenure.label),
        summary: String(tenure.summary || "")
      });
    });
    Object.keys(configuredCatalog.offers || {}).forEach(function (key) {
      var offer = configuredCatalog.offers[key];
      var eligibleAddressModes = offer && Array.isArray(offer.eligibleAddressModes)
        ? offer.eligibleAddressModes.filter(function (mode, index, rows) {
            return (mode === "licensed" || mode === "customer_owned")
              && rows.indexOf(mode) === index;
          })
        : [];
      if (
        !offer
        || !catalogProducts[offer.productId]
        || !catalogTenures[offer.tenureId]
        || eligibleAddressModes.length === 0
      ) return;
      catalogOffers[key] = Object.freeze({
        productId: String(offer.productId),
        tenureId: String(offer.tenureId),
        eligibleAddressModes: Object.freeze(eligibleAddressModes.slice().sort())
      });
    });
    var catalog = Object.freeze({
      catalogVersion: configuredCatalog.catalogVersion || configuredCatalog.revision || null,
      products: Object.freeze(catalogProducts),
      tenures: Object.freeze(catalogTenures),
      offers: Object.freeze(catalogOffers)
    });
    var listeners = new Set();
    var operations = Object.create(null);
    var retryTasks = Object.create(null);
    var operationSequence = 0;
    var selectionEpoch = 0;
    var sessionEpoch = 0;
    var legalAuthorityEpoch = 0;
    var commerceEpoch = 0;
    var downloadCommerceEpoch = 0;
    var domainSearchEpoch = 0;
    var domainSelectionEpoch = 0;
    var domainOrderEpoch = 0;
    var domainPurchaseEpoch = 0;
    var state = {
      phase: "idle",
      account: null,
      projectLegalAuthority: null,
      projectLegalAuthorityStatus: "idle",
      projectLegalAuthorityError: null,
      projectLegalAcceptanceEpoch: 0,
      organizations: [],
      organizationId: null,
      projects: [],
      project: null,
      selectedVersionId: null,
      subscription: null,
      cancellationPreview: null,
      exportJob: null,
      commerceQuote: null,
      downloadQuote: null,
      domainSearchResults: [],
      domainQuote: null,
      registrantContact: null,
      domainConsent: null,
      domainOrder: null,
      domainPriceCheck: null,
      domains: [],
      selectedDomain: null,
      dnsRecords: [],
      hostedMutationStarted: false,
      operations: Object.freeze({})
    };

    function snapshot() {
      return Object.freeze({
        phase: state.phase,
        account: clone(state.account),
        projectLegalAuthority:
          clone(state.projectLegalAuthority),
        projectLegalAuthorityStatus:
          state.projectLegalAuthorityStatus,
        projectLegalAuthorityError:
          clone(state.projectLegalAuthorityError),
        projectLegalAcceptanceEpoch:
          state.projectLegalAcceptanceEpoch,
        organizations: clone(state.organizations),
        organizationId: state.organizationId,
        projects: clone(state.projects),
        project: clone(state.project),
        selectedVersionId: state.selectedVersionId,
        subscription: clone(state.subscription),
        cancellationPreview: clone(state.cancellationPreview),
        exportJob: clone(state.exportJob),
        commerceQuote: clone(state.commerceQuote),
        downloadQuote: clone(state.downloadQuote),
        domainSearchResults: clone(state.domainSearchResults),
        domainQuote: clone(state.domainQuote),
        registrantContact: clone(state.registrantContact),
        domainConsent: clone(state.domainConsent),
        domainOrder: clone(state.domainOrder),
        domainPriceCheck: clone(state.domainPriceCheck),
        domains: clone(state.domains),
        selectedDomain: clone(state.selectedDomain),
        dnsRecords: clone(state.dnsRecords),
        hostedMutationStarted: state.hostedMutationStarted,
        localFallbackAllowed: !state.hostedMutationStarted,
        catalogRevision: catalog.catalogVersion || null,
        catalogOffers: Object.freeze(Object.keys(catalog.offers || {}).map(function (key) {
          var offer = catalog.offers[key];
          return Object.freeze({
            id: key,
            productId: offer.productId,
            tenureId: offer.tenureId,
            eligibleAddressModes: Object.freeze(offer.eligibleAddressModes.slice())
          });
        })),
        checkoutEnabled: Object.keys(catalog.offers || {}).length > 0
          && typeof api.createCommerceQuote === "function"
          && typeof api.createCommerceCheckout === "function",
        operations: operationSnapshot(operations)
      });
    }

    function emit() {
      state.operations = operationSnapshot(operations);
      var current = snapshot();
      listeners.forEach(function (listener) {
        try {
          listener(current);
        } catch (_error) {
          // Rendering failures cannot change hosted state.
        }
      });
      return current;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") {
        throw new ControlError({ code: "LISTENER_REQUIRED", message: "A state listener is required." });
      }
      listeners.add(listener);
      listener(snapshot());
      return function () { listeners.delete(listener); };
    }

    function beginWrite() {
      state.hostedMutationStarted = true;
    }

    function invalidateProjectLegalAcceptance() {
      state.projectLegalAcceptanceEpoch += 1;
    }

    function clearSessionState() {
      selectionEpoch += 1;
      state.phase = "signed-out";
      state.account = null;
      state.organizations = [];
      state.organizationId = null;
      state.projects = [];
      state.project = null;
      state.selectedVersionId = null;
      state.subscription = null;
      state.cancellationPreview = null;
      state.exportJob = null;
      resetDomains();
    }

    function resetDomainPurchase() {
      domainPurchaseEpoch += 1;
      domainOrderEpoch += 1;
      state.domainQuote = null;
      state.domainConsent = null;
      state.domainOrder = null;
      state.domainPriceCheck = null;
    }

    function restartDomainPurchase(stage) {
      var target = String(stage || "");
      if (!["search", "owner", "review"].includes(target)) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_STAGE_INVALID",
          message: "Choose a valid domain step."
        }));
      }
      if (idOf(state.domainOrder)) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_ORDER_LOCKED",
          message: "Payment has started. Finish or resume this order before changing its details."
        }));
      }
      domainPurchaseEpoch += 1;
      domainOrderEpoch += 1;
      state.domainConsent = null;
      state.domainOrder = null;
      state.domainPriceCheck = null;
      if (target === "owner" || target === "search") {
        state.registrantContact = null;
      }
      if (target === "search") {
        domainSearchEpoch += 1;
        state.domainQuote = null;
      }
      emit();
      return Promise.resolve(snapshot());
    }

    function resetDomains() {
      domainSearchEpoch += 1;
      domainSelectionEpoch += 1;
      resetDomainPurchase();
      state.domainSearchResults = [];
      state.registrantContact = null;
      state.domains = [];
      state.selectedDomain = null;
      state.dnsRecords = [];
      state.commerceQuote = null;
      downloadCommerceEpoch += 1;
      state.downloadQuote = null;
    }

    function validatedExport(payload, projectId, expectedExportId) {
      var job = entityFrom(payload, "export");
      var exportId = exportIdOf(job);
      var status = String(job && job.status || "");
      if (
        !job
        || !exportId
        || String(job.projectId || "") !== projectId
        || (expectedExportId && exportId !== expectedExportId)
        || !["queued", "working", "ready", "failed", "expired"].includes(status)
        || !Number.isFinite(Date.parse(job.createdAt))
        || !Number.isFinite(Date.parse(job.updatedAt))
      ) {
        throw new ControlError({
          code: "EXPORT_RESPONSE_INVALID",
          message: "The project export status could not be verified."
        });
      }
      if (status === "ready") {
        var download = job.download;
        if (
          !job.filename
          || !download
          || !download.token
          || !Number.isFinite(Date.parse(download.expiresAt))
          || Date.parse(download.expiresAt) <= Date.now()
        ) {
          throw new ControlError({
            code: "EXPORT_RESPONSE_INVALID",
            message: "The project export is not ready for a secure download."
          });
        }
      }
      return job;
    }

    function task(name, action, settings) {
      var taskSettings = settings || {};
      var prior = operations[name];
      var attempt = prior ? prior.attempt + 1 : 1;
      var token = ++operationSequence;
      operations[name] = { status: "pending", attempt: attempt, error: null, token: token };
      if (taskSettings.write) beginWrite();
      if (taskSettings.retry) retryTasks[name] = taskSettings.retry;
      emit();
      return Promise.resolve()
        .then(action)
        .then(function (result) {
          if (operations[name] && operations[name].token === token) {
            operations[name] = { status: "success", attempt: attempt, error: null, token: token };
            emit();
          }
          return result;
        })
        .catch(function (error) {
          var presented = safeError(error, "That request could not be completed.");
          if (operations[name] && operations[name].token === token) {
            if (
              Number(error && error.status) === 401
              || [
                "AUTHENTICATION_REQUIRED",
                "REAUTHENTICATION_REQUIRED"
              ].includes(presented.code)
            ) {
              sessionEpoch += 1;
              invalidateProjectLegalAcceptance();
              clearSessionState();
            }
            operations[name] = {
              status: "error",
              attempt: attempt,
              error: presented,
              token: token
            };
            if (!presented.retryable) delete retryTasks[name];
            emit();
          }
          throw error;
        });
    }

    function projectLegalAcceptance() {
      var authority = state.projectLegalAuthority;
      if (
        state.projectLegalAuthorityStatus !== "ready"
        || !authority
      ) {
        throw new ControlError({
          code: "LEGAL_CONFIGURATION_REQUIRED",
          message: "The reviewed project documents are not available yet."
        });
      }
      var acceptanceSchema =
        authority.schema === "sitesourcery.project-legal-authority/v7"
          ? "sitesourcery.project-legal-acceptance/v7"
          : authority.schema === "sitesourcery.project-legal-authority/v5"
            ? "sitesourcery.project-legal-acceptance/v5"
            : authority.schema === "sitesourcery.project-legal-authority/v4"
              ? "sitesourcery.project-legal-acceptance/v4"
              : authority.schema === "sitesourcery.project-legal-authority/v3"
                ? "sitesourcery.project-legal-acceptance/v3"
                : null;
      if (!acceptanceSchema) {
        throw new ControlError({
          code: "LEGAL_CONFIGURATION_REQUIRED",
          message: "The reviewed project documents use an unsupported authority."
        });
      }
      return Object.freeze({
        schema: acceptanceSchema,
        acceptanceStatement:
          authority.acceptanceStatement,
        authorityDigest: authority.authorityDigest,
        documents: Object.freeze(
          authority.documents.map(function (document) {
            return Object.freeze(Object.assign({}, document));
          })
        )
      });
    }

    function captureProjectLegalAcceptance() {
      return Object.freeze({
        epoch: state.projectLegalAcceptanceEpoch,
        legalAcceptance: projectLegalAcceptance()
      });
    }

    function refreshProjectLegalAuthority() {
      var expectedAuthorityEpoch = ++legalAuthorityEpoch;
      invalidateProjectLegalAcceptance();
      state.projectLegalAuthority = null;
      state.projectLegalAuthorityStatus = "loading";
      state.projectLegalAuthorityError = null;
      return task("projectLegalAuthority", async function () {
        if (typeof api.getProjectLegalAuthority !== "function") {
          throw new ControlError({
            code: "LEGAL_CONFIGURATION_REQUIRED",
            message: "The reviewed project documents could not be loaded."
          });
        }
        var authority = await api.getProjectLegalAuthority();
        if (expectedAuthorityEpoch !== legalAuthorityEpoch) return null;
        state.projectLegalAuthority = authority;
        state.projectLegalAuthorityStatus = "ready";
        state.projectLegalAuthorityError = null;
        return authority;
      }).catch(function (error) {
        if (expectedAuthorityEpoch === legalAuthorityEpoch) {
          state.projectLegalAuthority = null;
          state.projectLegalAuthorityStatus = "held";
          state.projectLegalAuthorityError = safeError(
            error,
            "The reviewed project documents could not be loaded."
          );
          emit();
        }
        return null;
      });
    }

    function retry(name) {
      var retryTask = retryTasks[name];
      var operation = operations[name];
      if (!retryTask || !operation || operation.status !== "error" || !operation.error.retryable) {
        return Promise.reject(new ControlError({
          code: "RETRY_UNAVAILABLE",
          message: "Please start that step again."
        }));
      }
      return retryTask();
    }

    function assertProject() {
      if (!state.project || !idOf(state.project)) {
        throw new ControlError({ code: "PROJECT_REQUIRED", message: "Choose a project first." });
      }
      return idOf(state.project);
    }

    function assertOrganization() {
      if (!state.organizationId) {
        throw new ControlError({ code: "ORGANIZATION_REQUIRED", message: "Choose an organization first." });
      }
      return state.organizationId;
    }

    function replaceProject(project) {
      if (!project || !idOf(project)) return;
      state.project = project;
      state.projects = state.projects.map(function (candidate) {
        return idOf(candidate) === idOf(project) ? project : candidate;
      });
    }

    async function refreshProjectsFor(organizationId, expectedSessionEpoch) {
      var payload = await api.listProjects(organizationId);
      if (expectedSessionEpoch !== sessionEpoch || organizationId !== state.organizationId) return null;
      state.projects = arrayFrom(payload, "projects");
      return state.projects;
    }

    async function refreshProject(projectId, expectedSelectionEpoch) {
      var payload = await api.getProject(projectId);
      if (
        expectedSelectionEpoch !== selectionEpoch
        || !state.project
        || idOf(state.project) !== projectId
      ) return null;
      var project = entityFrom(payload, "project");
      if (project) replaceProject(project);
      return project;
    }

    async function loadAccountData(mePayload, expectedSessionEpoch) {
      if (expectedSessionEpoch !== sessionEpoch) return null;
      var account = mePayload && isObject(mePayload.user)
        ? mePayload.user
        : mePayload && isObject(mePayload.account)
          ? mePayload.account
          : mePayload && idOf(mePayload)
            ? mePayload
            : null;
      state.account = account;
      if (!account) {
        clearSessionState();
        return null;
      }
      state.project = null;
      state.selectedVersionId = null;
      state.subscription = null;
      state.cancellationPreview = null;
      state.exportJob = null;
      resetDomains();
      var organizationPayload = await api.listOrganizations();
      if (expectedSessionEpoch !== sessionEpoch) return null;
      state.organizations = arrayFrom(organizationPayload, "organizations");
      state.organizationId = state.organizations[0] ? idOf(state.organizations[0]) : null;
      state.projects = state.organizationId
        ? await refreshProjectsFor(state.organizationId, expectedSessionEpoch) || []
        : [];
      state.phase = "ready";
      return account;
    }

    function boot() {
      var expectedSessionEpoch = ++sessionEpoch;
      invalidateProjectLegalAcceptance();
      state.phase = "loading";
      var authorityRequest = refreshProjectLegalAuthority();
      var sessionRequest = task("session", async function () {
        try {
          var payload = await api.me();
          return await loadAccountData(payload, expectedSessionEpoch);
        } catch (error) {
          if (error && error.status === 401 && expectedSessionEpoch === sessionEpoch) {
            clearSessionState();
            return null;
          }
          if (expectedSessionEpoch === sessionEpoch) state.phase = "error";
          throw error;
        }
      });
      return Promise.all([authorityRequest, sessionRequest])
        .then(function (results) { return results[1]; });
    }

    function authenticate(operationName, call) {
      var expectedSessionEpoch = ++sessionEpoch;
      invalidateProjectLegalAcceptance();
      var key = idempotencyFactory();
      var retryCall = function () {
        return task(operationName, async function () {
          await call({ idempotencyKey: key });
          var payload = await api.me();
          return loadAccountData(payload, expectedSessionEpoch);
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function register(input) {
      return authenticate("register", function (requestOptions) {
        return api.register({
          name: input && input.name,
          organizationName: input && input.organizationName,
          email: input && input.email,
          password: input && input.password
        }, requestOptions);
      });
    }

    function beginRegistration(input) {
      if (typeof api.register !== "function") {
        return Promise.reject(new ControlError({
          code: "REGISTRATION_UNAVAILABLE",
          message: "Account creation is not available yet."
        }));
      }
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("beginRegistration", function () {
          return api.register({
            name: input && input.name,
            organizationName:
              input && input.organizationName,
            email: input && input.email,
            password: input && input.password
          }, { idempotencyKey: key });
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function completeRegistration(input) {
      if (
        typeof api.completeRegistration !==
        "function"
      ) {
        return Promise.reject(new ControlError({
          code: "REGISTRATION_ACTIVATION_UNAVAILABLE",
          message: "Account activation is not available yet."
        }));
      }
      return authenticate(
        "completeRegistration",
        function (requestOptions) {
          return api.completeRegistration({
            token: input && input.token
          }, requestOptions);
        }
      );
    }

    function signIn(input) {
      return authenticate("signIn", function (requestOptions) {
        return api.signIn({
          email: input && input.email,
          password: input && input.password
        }, requestOptions);
      });
    }

    function signOut() {
      var expectedSessionEpoch = ++sessionEpoch;
      invalidateProjectLegalAcceptance();
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("signOut", async function () {
          await api.signOut({ idempotencyKey: key });
          if (expectedSessionEpoch !== sessionEpoch) return null;
          clearSessionState();
          return null;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function requestRecovery(input) {
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("requestRecovery", function () {
          return api.requestRecovery({ email: input && input.email }, { idempotencyKey: key });
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function refreshSession() {
      var selectedProjectId = idOf(state.project);
      return boot().then(function () {
        if (
          !state.account
          || !selectedProjectId
          || !state.projects.some(function (project) {
            return idOf(project) === selectedProjectId;
          })
        ) return snapshot();
        return selectProject(selectedProjectId)
          .then(function () {
            return snapshot();
          });
      });
    }

    function completeRecovery(input) {
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("completeRecovery", function () {
          return api.completeRecovery({
            token: input && input.token,
            password: input && input.password
          }, { idempotencyKey: key });
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function selectOrganization(organizationId) {
      var selected = String(organizationId || "");
      var expectedSessionEpoch = sessionEpoch;
      invalidateProjectLegalAcceptance();
      state.organizationId = selected;
      state.project = null;
      state.selectedVersionId = null;
      state.subscription = null;
      state.cancellationPreview = null;
      state.exportJob = null;
      resetDomains();
      selectionEpoch += 1;
      return task("projects", function () {
        return refreshProjectsFor(selected, expectedSessionEpoch);
      });
    }

    function selectProject(
      projectId,
      confirmOpen
    ) {
      var selected = String(projectId || "");
      var expectedSelectionEpoch = ++selectionEpoch;
      return task("project", async function () {
        var projectPayload = await api.getProject(selected);
        if (expectedSelectionEpoch !== selectionEpoch) return null;
        var project = entityFrom(projectPayload, "project");
        if (!project || idOf(project) !== selected) {
          throw new ControlError({ code: "PROJECT_RESPONSE_INVALID", message: "The project response was invalid." });
        }
        if (
          typeof confirmOpen === "function"
          && confirmOpen(project) !== true
        ) {
          return null;
        }
        if (expectedSelectionEpoch !== selectionEpoch) return null;
        state.selectedVersionId = null;
        state.subscription = null;
        state.cancellationPreview = null;
        state.exportJob = null;
        resetDomains();
        replaceProject(project);
        return project;
      });
    }

    function refreshSelectedProject() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      return task("projectRefresh", function () {
        return refreshProject(
          projectId,
          expectedSelectionEpoch
        );
      });
    }

    function createProject(input) {
      var organizationId = assertOrganization();
      var capturedEpoch = Number(input && input.legalAcceptanceEpoch);
      var acceptance = input && input.legalAcceptance;
      var currentAcceptance;
      try {
        currentAcceptance = projectLegalAcceptance();
      } catch (error) {
        return Promise.reject(error);
      }
      if (
        !Number.isSafeInteger(capturedEpoch)
        || capturedEpoch !== state.projectLegalAcceptanceEpoch
        || JSON.stringify(acceptance) !==
          JSON.stringify(currentAcceptance)
      ) {
        return Promise.reject(new ControlError({
          code: "LEGAL_AUTHORITY_CHANGED",
          message: "The reviewed project documents changed. Review and accept them again."
        }));
      }
      var key = idempotencyFactory();
      var expectedSessionEpoch = sessionEpoch;
      var retryCall = function () {
        return task("createProject", async function () {
          var request = {
            organizationId: organizationId,
            name: input && input.name,
            legalAcceptance: clone(acceptance)
          };
          if (
            input &&
            Object.prototype.hasOwnProperty.call(
              input,
              "address"
            )
          ) {
            request.address = input.address;
          }
          if (
            input &&
            Object.prototype.hasOwnProperty.call(
              input,
              "visibility"
            )
          ) {
            request.visibility = input.visibility;
            if (
              Object.prototype.hasOwnProperty.call(
                input,
                "accessPassword"
              )
            ) {
              request.accessPassword =
                input.accessPassword;
            }
          }
          var payload = await api.createProject(
            request,
            { idempotencyKey: key }
          );
          if (expectedSessionEpoch !== sessionEpoch) return null;
          var project = entityFrom(payload, "project");
          await refreshProjectsFor(organizationId, expectedSessionEpoch);
          if (project && idOf(project)) {
            invalidateProjectLegalAcceptance();
            resetDomains();
            state.project = project;
            state.cancellationPreview = null;
            state.exportJob = null;
            selectionEpoch += 1;
          }
          return project;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function saveDraft(rawFacts) {
      var projectId = assertProject();
      var revision = revisionOf(state.project);
      if (revision == null) {
        return Promise.reject(new ControlError({
          code: "DRAFT_REVISION_REQUIRED",
          message: "Reload this project before saving its draft."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("saveDraft", async function () {
          var payload = await api.saveDraft({
            projectId: projectId,
            revision: revision,
            rawFacts: rawFacts
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var project = payload && isObject(payload.project)
            ? payload.project
            : payload && idOf(payload) === projectId
              ? payload
              : null;
          if (project) {
            replaceProject(project);
          } else {
            var nextRevision = payload && payload.revision != null
              ? payload.revision
              : payload && payload.draft && payload.draft.revision;
            if (nextRevision != null) {
              var next = clone(state.project);
              next.draft = Object.assign({}, next.draft || {}, {
                revision: nextRevision,
                rawFacts: clone(rawFacts)
              });
              replaceProject(next);
            }
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function acceptMadeVersion(detail) {
      var projectId = assertProject();
      var keyCreate = idempotencyFactory();
      var keyReady = idempotencyFactory();
      var keyAccept = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("acceptVersion", async function () {
          var createdPayload = await api.createVersion({
            projectId: projectId,
            rawFacts: detail && detail.raw,
            previewDigest: detail && detail.result && detail.result.artifactDigest,
            reviewAttested: detail && detail.reviewAttested === true
          }, { idempotencyKey: keyCreate });
          var version = entityFrom(createdPayload, "version");
          var versionId = idOf(version);
          if (!versionId) {
            throw new ControlError({ code: "VERSION_RESPONSE_INVALID", message: "The version response was invalid." });
          }
          await api.markVersionReady(projectId, versionId, { idempotencyKey: keyReady });
          var acceptedPayload = await api.acceptVersion(projectId, versionId, {
            idempotencyKey: keyAccept
          });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.selectedVersionId = versionId;
          downloadCommerceEpoch += 1;
          state.downloadQuote = null;
          await refreshProject(projectId, expectedSelectionEpoch);
          return entityFrom(acceptedPayload, "version") || version;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function selectVersion(versionId) {
      var selected = String(versionId || "") || null;
      if (selected !== state.selectedVersionId) {
        downloadCommerceEpoch += 1;
        state.downloadQuote = null;
      }
      state.selectedVersionId = selected;
      emit();
    }

    function mutateProject(name, invoke) {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task(name, async function () {
          var payload = await invoke(projectId, { idempotencyKey: key });
          if (
            expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
          ) {
            var project = entityFrom(payload, "project");
            if (project && idOf(project) === projectId) replaceProject(project);
            else await refreshProject(projectId, expectedSelectionEpoch);
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function selectAddress(input) {
      commerceEpoch += 1;
      state.commerceQuote = null;
      return mutateProject("selectAddress", function (projectId, requestOptions) {
        return api.selectAddress(projectId, {
          kind: input && input.kind,
          label: input && input.label,
          path: input && input.path,
          hostname: input && input.hostname
        }, requestOptions);
      });
    }

    function requestDomainVerification(input) {
      var addressId = String(input && input.addressId || "");
      return mutateProject("requestDomainVerification", function (projectId, requestOptions) {
        return api.requestDomainVerification(projectId, addressId, {
          method: input && input.method,
          reference: input && input.reference
        }, requestOptions);
      });
    }

    function quoteOffer(offerId, domainQuoteId) {
      var projectId = assertProject();
      var catalogId = String(offerId || "");
      var projectAddressBinding = addressBindingOf(state.project);
      var selectedOffer = catalog.offers[catalogId];
      if (
        !selectedOffer
        || typeof api.createCommerceQuote !== "function"
      ) {
        return Promise.reject(new ControlError({
          code: "CHECKOUT_HELD",
          message: "Online payment stays closed until this exact website choice is approved."
        }));
      }
      if (
        !projectAddressBinding.revision
        || !selectedOffer.eligibleAddressModes.includes(projectAddressBinding.mode)
      ) {
        return Promise.reject(new ControlError({
          code: "OFFER_ADDRESS_INELIGIBLE",
          message: "That ownership choice does not work with this project address."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedCommerceEpoch = commerceEpoch;
      var retryCall = function () {
        return task("commerceQuote", async function () {
          var payload = await api.createCommerceQuote(projectId, {
            offerId: catalogId,
            domainQuoteId: domainQuoteId || null
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedCommerceEpoch !== commerceEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var quote = entityFrom(payload, "quote");
          var quoteAddressBinding = quote && quote.addressBinding || {};
          if (
            !quote
            || !commerceQuoteIdOf(quote)
            || !quote.disclosureDigest
            || String(quote.offerId || "") !== catalogId
            || String(quoteAddressBinding.mode || "") !== projectAddressBinding.mode
            || String(quoteAddressBinding.revision || "") !== projectAddressBinding.revision
          ) {
            throw new ControlError({
              code: "QUOTE_RESPONSE_INVALID",
              message: "That price could not be verified. Please try again."
            });
          }
          state.commerceQuote = quote;
          return quote;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function checkoutQuotedOffer(expectedOfferId) {
      var projectId = assertProject();
      var quote = state.commerceQuote;
      var quoteId = commerceQuoteIdOf(quote);
      var acceptedDisclosureDigest = String(quote && quote.disclosureDigest || "");
      var currentAddressBinding = addressBindingOf(state.project);
      var quotedAddressBinding = quote && quote.addressBinding || {};
      var currentOffer = catalog.offers[String(quote && quote.offerId || "")];
      if (
        !quoteId
        || !acceptedDisclosureDigest
        || (
          expectedOfferId
          && String(quote && quote.offerId || "") !== String(expectedOfferId)
        )
        || !currentOffer
        || !currentOffer.eligibleAddressModes.includes(currentAddressBinding.mode)
        || String(quotedAddressBinding.mode || "") !== currentAddressBinding.mode
        || String(quotedAddressBinding.revision || "") !== currentAddressBinding.revision
        || typeof api.createCommerceCheckout !== "function"
      ) {
        return Promise.reject(new ControlError({
          code: "QUOTE_REVIEW_REQUIRED",
          message: "Review a current exact price before continuing to payment."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("commerceCheckout", async function () {
          var payload = await api.createCommerceCheckout(
            projectId,
            quoteId,
            { acceptedDisclosureDigest: acceptedDisclosureDigest },
            { idempotencyKey: key }
          );
          if (
            expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
          ) {
            var updated = entityFrom(payload, "quote");
            if (updated && commerceQuoteIdOf(updated) === quoteId) state.commerceQuote = updated;
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function quoteDownload(versionId) {
      var projectId = assertProject();
      var selectedVersionId = String(
        versionId || state.selectedVersionId || ""
      );
      if (!selectedVersionId) {
        return Promise.reject(new ControlError({
          code: "VERSION_REQUIRED",
          message: "Choose the exact saved version before reviewing Download."
        }));
      }
      if (typeof api.createDownloadQuote !== "function") {
        return Promise.reject(new ControlError({
          code: "DOWNLOAD_COMMERCE_HELD",
          message: "Download purchasing is not available yet."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedDownloadEpoch = ++downloadCommerceEpoch;
      state.downloadQuote = null;
      var retryCall = function () {
        return task("downloadQuote", async function () {
          var payload = await api.createDownloadQuote(
            projectId,
            { versionId: selectedVersionId },
            { idempotencyKey: key }
          );
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedDownloadEpoch !== downloadCommerceEpoch
            || !state.project
            || idOf(state.project) !== projectId
            || state.selectedVersionId !== selectedVersionId
          ) return null;
          var quote = entityFrom(payload, "quote");
          if (
            !quote
            || !commerceQuoteIdOf(quote)
            || String(quote.offerId || "") !== "spark_download"
            || String(quote.entitlementKind || "") !== "spark_download"
            || String(quote.project && quote.project.projectId || "") !== projectId
            || String(quote.version && quote.version.versionId || "") !== selectedVersionId
            || !quote.price
            || Number(quote.price.amountMinor) !== 2000
            || String(quote.price.currency || "").toUpperCase() !== "USD"
            || String(quote.price.billing || "") !== "one_time"
            || String(quote.disclosureDigest || "").length !== 64
            || String(quote.snapshotDigest || "").length !== 64
            || !Number.isFinite(Date.parse(quote.expiresAt))
            || Date.parse(quote.expiresAt) <= Date.now()
          ) {
            throw new ControlError({
              code: "DOWNLOAD_QUOTE_RESPONSE_INVALID",
              message: "The $20 Download quote could not be verified. Try again."
            });
          }
          state.downloadQuote = quote;
          return quote;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function prepareDownloadCheckout() {
      var projectId = assertProject();
      var quote = state.downloadQuote;
      var quoteId = commerceQuoteIdOf(quote);
      var versionId = String(
        quote && quote.version && quote.version.versionId || ""
      );
      var acceptedDisclosureDigest = String(
        quote && quote.disclosureDigest || ""
      );
      if (
        !quoteId
        || !acceptedDisclosureDigest
        || String(quote && quote.offerId || "") !== "spark_download"
        || String(quote && quote.project && quote.project.projectId || "") !== projectId
        || !versionId
        || versionId !== state.selectedVersionId
        || !Number.isFinite(Date.parse(quote.expiresAt))
        || Date.parse(quote.expiresAt) <= Date.now()
        || typeof api.prepareDownloadCheckout !== "function"
      ) {
        return Promise.reject(new ControlError({
          code: "DOWNLOAD_QUOTE_REVIEW_REQUIRED",
          message: "Review the current $20 Download quote before continuing."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedDownloadEpoch = downloadCommerceEpoch;
      var retryCall = function () {
        return task("downloadCheckout", async function () {
          var payload = await api.prepareDownloadCheckout(
            projectId,
            quoteId,
            {
              acceptedDisclosureDigest:
                acceptedDisclosureDigest,
              purchaseTermsAccepted: true
            },
            { idempotencyKey: key }
          );
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedDownloadEpoch !== downloadCommerceEpoch
          ) return null;
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function billingPortal() {
      return mutateProject("billingPortal", function (projectId, requestOptions) {
        return api.billingPortal(projectId, requestOptions);
      });
    }

    function refreshSubscription() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      return task("subscription", async function () {
        var payload = await api.subscription(projectId);
        if (
          expectedSelectionEpoch === selectionEpoch
          && state.project
          && idOf(state.project) === projectId
        ) state.subscription = entityFrom(payload, "subscription");
        return state.subscription;
      });
    }

    function previewCancellation() {
      var projectId = assertProject();
      if (typeof api.cancellationPreview !== "function") {
        return Promise.reject(new ControlError({
          code: "CANCELLATION_PREVIEW_UNAVAILABLE",
          message: "Cancellation is closed until the exact end and retention dates can be shown."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      return task("cancellationPreview", async function () {
        var payload = await api.cancellationPreview(projectId);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        var preview = entityFrom(payload, "preview");
        if (
          !preview
          || !cancellationPreviewIdOf(preview)
          || !preview.disclosureDigest
          || !Number.isFinite(Date.parse(preview.effectiveAt))
          || !Number.isFinite(Date.parse(preview.retentionEndsAt))
        ) {
          throw new ControlError({
            code: "CANCELLATION_PREVIEW_INVALID",
            message: "The cancellation dates could not be verified."
          });
        }
        state.cancellationPreview = preview;
        return preview;
      });
    }

    function cancelSubscription() {
      var projectId = assertProject();
      var preview = state.cancellationPreview;
      var previewId = cancellationPreviewIdOf(preview);
      var acceptedDisclosureDigest = String(preview && preview.disclosureDigest || "");
      if (!previewId || !acceptedDisclosureDigest) {
        return Promise.reject(new ControlError({
          code: "CANCELLATION_PREVIEW_REQUIRED",
          message: "Review the exact cancellation dates before confirming."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("cancelSubscription", async function () {
          var payload = await api.cancelSubscription(projectId, {
            previewId: previewId,
            acceptedDisclosureDigest: acceptedDisclosureDigest
          }, { idempotencyKey: key });
          var subscriptionPayload = await api.subscription(projectId);
          if (
            expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
          ) {
            state.subscription = entityFrom(subscriptionPayload, "subscription");
            state.cancellationPreview = null;
            await refreshProject(projectId, expectedSelectionEpoch);
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function requestRelease(versionId) {
      var selected = String(versionId || state.selectedVersionId || "");
      if (!selected) {
        return Promise.reject(new ControlError({
          code: "VERSION_REQUIRED",
          message: "Choose the exact accepted version before requesting publication."
        }));
      }
      var subscriptionStatus = String(
        state.subscription && (state.subscription.status || state.subscription.state) || ""
      ).toLowerCase();
      if (!["active", "current", "paid"].includes(subscriptionStatus)) {
        return Promise.reject(new ControlError({
          code: "PAID_ENTITLEMENT_REQUIRED",
          message: "Review and complete payment before publishing."
        }));
      }
      var address = state.project && state.project.address || {};
      var addressStatus = String(
        address.verificationStatus || address.state || address.status || ""
      ).toLowerCase();
      if (!["active", "configured", "connected", "ready", "verified"].includes(addressStatus)) {
        return Promise.reject(new ControlError({
          code: "VERIFIED_ADDRESS_REQUIRED",
          message: "Finish and verify the address before publishing."
        }));
      }
      return mutateProject("requestRelease", function (projectId, requestOptions) {
        return api.requestRelease(projectId, selected, requestOptions);
      });
    }

    function unpublish() {
      return mutateProject("unpublish", function (projectId, requestOptions) {
        return api.unpublish(projectId, requestOptions);
      });
    }

    function setVisibility(input) {
      return mutateProject("setVisibility", function (projectId, requestOptions) {
        return api.setVisibility(projectId, {
          visibility: input && input.visibility,
          accessPassword: input && input.accessPassword
        }, requestOptions);
      });
    }

    function createSupportTicket(input) {
      return mutateProject("createSupportTicket", function (projectId, requestOptions) {
        return api.createSupportTicket(projectId, {
          subject: input && input.subject,
          message: input && input.message
        }, requestOptions);
      });
    }

    function requestExport() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("requestExport", async function () {
          var payload = await api.requestExport(projectId, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.exportJob = validatedExport(payload, projectId);
          return state.exportJob;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function getExport() {
      var projectId = assertProject();
      var exportId = exportIdOf(state.exportJob);
      if (!exportId || typeof api.getExport !== "function") {
        return Promise.reject(new ControlError({
          code: "EXPORT_REQUIRED",
          message: "Prepare a project export first."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      return task("getExport", async function () {
        var payload = await api.getExport(projectId, exportId);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        state.exportJob = validatedExport(payload, projectId, exportId);
        return state.exportJob;
      });
    }

    function retryExport() {
      var projectId = assertProject();
      var exportId = exportIdOf(state.exportJob);
      if (
        !exportId
        || !state.exportJob
        || !["failed", "expired"].includes(String(state.exportJob.status || ""))
        || typeof api.retryExport !== "function"
      ) {
        return Promise.reject(new ControlError({
          code: "EXPORT_RETRY_UNAVAILABLE",
          message: "This export cannot be retried yet."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("retryExport", async function () {
          var payload = await api.retryExport(projectId, exportId, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.exportJob = validatedExport(payload, projectId);
          return state.exportJob;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function downloadExport() {
      var projectId = assertProject();
      var job = state.exportJob;
      var exportId = exportIdOf(job);
      var token = String(job && job.download && job.download.token || "");
      if (
        !exportId
        || !token
        || String(job.status || "") !== "ready"
        || !Number.isFinite(Date.parse(job.download.expiresAt))
        || Date.parse(job.download.expiresAt) <= Date.now()
        || typeof api.downloadExport !== "function"
      ) {
        return Promise.reject(new ControlError({
          code: "EXPORT_DOWNLOAD_UNAVAILABLE",
          message: "Refresh or prepare the export before downloading it."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      return task("downloadExport", async function () {
        var download = await api.downloadExport(projectId, exportId, token);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        state.exportJob = Object.assign({}, job, {
          status: "expired",
          updatedAt: new Date().toISOString(),
          download: null
        });
        return download;
      }, { write: true });
    }

    function deleteProject() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("deleteProject", async function () {
          var payload = await api.deleteProject(projectId, { idempotencyKey: key });
          if (
            expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
          ) {
            state.projects = state.projects.filter(function (project) {
              return idOf(project) !== projectId;
            });
            state.project = null;
            state.selectedVersionId = null;
            state.subscription = null;
            state.cancellationPreview = null;
            state.exportJob = null;
            resetDomains();
            selectionEpoch += 1;
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function localFallbackAllowed() {
      return !state.hostedMutationStarted;
    }

    function searchDomains(query) {
      var expectedEpoch = ++domainSearchEpoch;
      return task("domainSearch", async function () {
        var payload = await api.searchDomains(query);
        if (expectedEpoch !== domainSearchEpoch) return null;
        state.domainSearchResults = arrayFrom(payload, "results");
        resetDomainPurchase();
        return state.domainSearchResults;
      });
    }

    function createDomainQuote(input) {
      var projectId = assertProject();
      var key = idempotencyFactory();
      var expectedEpoch = domainSearchEpoch;
      var expectedPurchaseEpoch = domainPurchaseEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("domainQuote", async function () {
          var payload = await api.createDomainQuote(projectId, {
            hostname: input && input.hostname,
            years: input && input.years,
            purpose: input && input.purpose
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedEpoch !== domainSearchEpoch
            || expectedPurchaseEpoch !== domainPurchaseEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var quote = projectBound(
            entityFrom(payload, "quote"),
            projectId,
            "domain quote"
          );
          resetDomainPurchase();
          state.domainQuote = quote;
          return state.domainQuote;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function saveRegistrantContact(input) {
      var organizationId = assertOrganization();
      var projectId = assertProject();
      var key = idempotencyFactory();
      var expectedSessionEpoch = sessionEpoch;
      var expectedPurchaseEpoch = domainPurchaseEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("registrantContact", async function () {
          var payload = await api.saveRegistrantContact(organizationId, projectId, {
            name: input && input.name,
            organization: input && input.organization,
            email: input && input.email,
            phone: input && input.phone,
            addressLine1: input && input.addressLine1,
            addressLine2: input && input.addressLine2,
            city: input && input.city,
            region: input && input.region,
            postalCode: input && input.postalCode,
            countryCode: input && input.countryCode
          }, { idempotencyKey: key });
          if (
            expectedSessionEpoch !== sessionEpoch
            || expectedPurchaseEpoch !== domainPurchaseEpoch
            || expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.registrantContact = projectBound(
            entityFrom(payload, "registrantContact"),
            projectId,
            "domain owner details"
          );
          return state.registrantContact;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function acceptDomainConsent(input) {
      var projectId = assertProject();
      var quoteId = idOf(state.domainQuote);
      var contactId = idOf(state.registrantContact);
      var quoteTermsVersion = String(
        state.domainQuote && state.domainQuote.termsVersion || ""
      );
      if (!quoteId || !contactId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_CONSENT_PREREQUISITES_REQUIRED",
          message: "Save the current quote and customer registrant details before accepting domain terms."
        }));
      }
      projectBound(state.domainQuote, projectId, "domain quote");
      projectBound(
        state.registrantContact,
        projectId,
        "domain owner details"
      );
      if (
        !input
        || input.registrationAgreementAccepted !== true
        || input.registrantCertificationAccepted !== true
      ) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_CONSENT_REQUIRED",
          message: "The customer must accept the registration agreement and certify the registrant details."
        }));
      }
      if (
        !quoteTermsVersion
        || String(input.termsVersion || "") !== quoteTermsVersion
      ) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_TERMS_MISMATCH",
          message: "Request a new domain price and review its current agreement before continuing."
        }));
      }
      var key = idempotencyFactory();
      var expectedEpoch = domainSearchEpoch;
      var expectedPurchaseEpoch = domainPurchaseEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("domainConsent", async function () {
          var payload = await api.acceptDomainConsent(projectId, quoteId, {
            registrantContactId: contactId,
            termsVersion: quoteTermsVersion,
            registrationAgreementAccepted: true,
            registrantCertificationAccepted: true,
            autoRenewRequested: input.autoRenewRequested === true
          }, { idempotencyKey: key });
          if (
            expectedEpoch !== domainSearchEpoch
            || expectedPurchaseEpoch !== domainPurchaseEpoch
            || expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.domainConsent = projectBound(
            entityFrom(payload, "consent"),
            projectId,
            "domain consent"
          );
          return state.domainConsent;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function createDomainOrder() {
      var projectId = assertProject();
      var quoteId = idOf(state.domainQuote);
      var consentId = idOf(state.domainConsent);
      if (!quoteId || !consentId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_ORDER_PREREQUISITES_REQUIRED",
          message: "A current quote and recorded customer consent are required before payment."
        }));
      }
      projectBound(state.domainQuote, projectId, "domain quote");
      projectBound(state.domainConsent, projectId, "domain consent");
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedPurchaseEpoch = domainPurchaseEpoch;
      var retryCall = function () {
        return task("domainOrder", async function () {
          var payload = await api.createDomainOrder(projectId, {
            quoteId: quoteId,
            consentId: consentId
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedPurchaseEpoch !== domainPurchaseEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var order = projectBound(
            entityFrom(payload, "domainOrder"),
            projectId,
            "domain order"
          );
          if (!exactDomainPaymentPath(order)) {
            throw new ControlError({
              code: "DOMAIN_PAYMENT_RELAY_INVALID",
              message: "The domain payment link could not be verified."
            });
          }
          state.domainOrder = order;
          state.domainPriceCheck = null;
          domainOrderEpoch += 1;
          return state.domainOrder;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function pollDomainOrder(orderId) {
      var projectId = assertProject();
      var selectedOrderId = String(orderId || idOf(state.domainOrder));
      if (!selectedOrderId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_ORDER_REQUIRED",
          message: "A domain order is required before checking its progress."
        }));
      }
      var expectedSelectionEpoch = selectionEpoch;
      var expectedOrderEpoch = domainOrderEpoch;
      return task("domainOrderPoll", async function () {
        var payload = await api.getDomainOrder(projectId, selectedOrderId);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || expectedOrderEpoch !== domainOrderEpoch
          || idOf(state.domainOrder) !== selectedOrderId
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        var order = projectBound(
          entityFrom(payload, "domainOrder"),
          projectId,
          "domain order status"
        );
        if (order && idOf(order) === selectedOrderId) state.domainOrder = order;
        return order;
      });
    }

    function listDomainOrders() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      return task("domainOrders", async function () {
        var payload = await api.listDomainOrders(projectId);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        var orders = projectBoundList(
          arrayFrom(payload, "domainOrders"),
          projectId,
          "domain order history"
        );
        state.domainOrder = orders[0] || null;
        state.domainPriceCheck = null;
        domainOrderEpoch += 1;
        return orders;
      });
    }

    function refreshDomainPrice() {
      var projectId = assertProject();
      var orderId = idOf(state.domainOrder);
      if (!orderId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_ORDER_REQUIRED",
          message: "Pay for the domain before checking its final price."
        }));
      }
      var orderStatus = String(
        state.domainOrder && (state.domainOrder.status || state.domainOrder.state) || ""
      ).toLowerCase();
      if (!["paid", "payment_authorized", "authorized", "ready_for_registration"].includes(orderStatus)) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_PAYMENT_REQUIRED",
          message: "Finish domain payment before checking the final price."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedOrderEpoch = domainOrderEpoch;
      var retryCall = function () {
        return task("domainPriceCheck", async function () {
          var payload = await api.refreshDomainPrice(
            projectId,
            orderId,
            { idempotencyKey: key }
          );
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedOrderEpoch !== domainOrderEpoch
            || idOf(state.domainOrder) !== orderId
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var priceCheck = projectBound(
            entityFrom(payload, "priceCheck"),
            projectId,
            "final domain price"
          );
          var priceStatus = String(priceCheck && priceCheck.status || "");
          var structurallyValid = Boolean(
            priceCheck
            && domainPriceCheckIdOf(priceCheck)
            && String(priceCheck.orderId || "") === orderId
            && ["ready_to_confirm", "changed", "unavailable"].includes(priceStatus)
            && Number.isFinite(Date.parse(priceCheck.checkedAt))
            && Number.isFinite(Date.parse(priceCheck.expiresAt))
            && (
              priceStatus === "unavailable"
                ? priceCheck.available === false && priceCheck.finalPrice == null
                : priceCheck.available === true && validMoney(priceCheck.finalPrice)
            )
          );
          if (!structurallyValid) {
            throw new ControlError({
              code: "DOMAIN_PRICE_CHECK_INVALID",
              message: "The final domain price and availability could not be verified."
            });
          }
          state.domainPriceCheck = priceCheck;
          if (priceStatus !== "ready_to_confirm") {
            state.domainQuote = null;
            state.domainConsent = null;
            state.domainOrder = null;
            domainPurchaseEpoch += 1;
            domainOrderEpoch += 1;
          }
          return state.domainPriceCheck;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function requestDomainRegistration(input) {
      var projectId = assertProject();
      var orderId = idOf(state.domainOrder);
      var priceCheckId = domainPriceCheckIdOf(state.domainPriceCheck);
      var orderStatus = String(
        state.domainOrder && (state.domainOrder.status || state.domainOrder.state) || ""
      ).toLowerCase();
      if (
        !orderId
        || !priceCheckId
        || !["paid", "payment_authorized", "authorized", "ready_for_registration"].includes(orderStatus)
        || String(state.domainPriceCheck.orderId || "") !== orderId
        || !readyDomainPriceCheck(state.domainPriceCheck, Date.now())
      ) {
        return Promise.reject(new ControlError({
          code: "FRESH_DOMAIN_PRICE_REQUIRED",
          message: "Check the domain’s price and availability again before registering it."
        }));
      }
      if (!input || input.irreversibleRegistrationAccepted !== true) {
        return Promise.reject(new ControlError({
          code: "IRREVERSIBLE_REGISTRATION_CONSENT_REQUIRED",
          message: "Confirm that domain registration is an irreversible purchase before continuing."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedOrderEpoch = domainOrderEpoch;
      var retryCall = function () {
        return task("domainRegistration", async function () {
          var payload = await api.requestDomainRegistration(projectId, orderId, {
            priceCheckId: priceCheckId,
            irreversibleRegistrationAccepted: true
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedOrderEpoch !== domainOrderEpoch
            || idOf(state.domainOrder) !== orderId
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          var order = projectBound(
            entityFrom(payload, "domainOrder"),
            projectId,
            "domain registration status"
          );
          if (order && idOf(order) === orderId) state.domainOrder = order;
          return order || payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function listDomains() {
      var organizationId = assertOrganization();
      var projectId = assertProject();
      var expectedSessionEpoch = sessionEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      return task("domains", async function () {
        var payload = await api.listDomains(
          organizationId,
          projectId
        );
        if (
          expectedSessionEpoch !== sessionEpoch
          || expectedSelectionEpoch !== selectionEpoch
          || organizationId !== state.organizationId
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        state.domains = projectBoundList(
          arrayFrom(payload, "domains"),
          projectId,
          "customer domains"
        );
        return state.domains;
      });
    }

    function selectDomain(domainId) {
      var projectId = assertProject();
      var selected = String(domainId || "");
      var expectedEpoch = ++domainSelectionEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      return task("domain", async function () {
        var domainPayload = await api.getDomain(projectId, selected);
        var recordsPayload =
          await api.listDnsRecords(projectId, selected);
        if (
          expectedEpoch !== domainSelectionEpoch
          || expectedSelectionEpoch !== selectionEpoch
          || !state.project
          || idOf(state.project) !== projectId
        ) return null;
        var domain = projectBound(
          entityFrom(domainPayload, "domain"),
          projectId,
          "customer domain"
        );
        if (!domain || idOf(domain) !== selected) {
          throw new ControlError({
            code: "DOMAIN_RESPONSE_INVALID",
            message: "That domain could not be loaded."
          });
        }
        state.selectedDomain = domain;
        state.dnsRecords = projectBoundList(
          arrayFrom(recordsPayload, "records"),
          projectId,
          "DNS records"
        );
        return domain;
      });
    }

    function mutateDomain(name, invoke) {
      var projectId = assertProject();
      var domainId = idOf(state.selectedDomain);
      if (!domainId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_REQUIRED",
          message: "Choose a customer-owned domain first."
        }));
      }
      var expectedEpoch = domainSelectionEpoch;
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task(name, async function () {
          var payload = await invoke(projectId, domainId, { idempotencyKey: key });
          if (
            expectedEpoch === domainSelectionEpoch
            && expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
            && idOf(state.selectedDomain) === domainId
          ) {
            var domainPayload =
              await api.getDomain(projectId, domainId);
            var recordsPayload =
              await api.listDnsRecords(projectId, domainId);
            if (
              expectedEpoch === domainSelectionEpoch
              && expectedSelectionEpoch === selectionEpoch
              && state.project
              && idOf(state.project) === projectId
            ) {
              state.selectedDomain = projectBound(
                entityFrom(domainPayload, "domain"),
                projectId,
                "customer domain"
              );
              state.dnsRecords = projectBoundList(
                arrayFrom(recordsPayload, "records"),
                projectId,
                "DNS records"
              );
            }
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function upsertDnsRecord(input) {
      return mutateDomain("upsertDnsRecord", function (projectId, domainId, requestOptions) {
        return api.upsertDnsRecord(projectId, domainId, {
          recordId: input && input.recordId,
          type: input && input.type,
          name: input && input.name,
          content: input && input.content,
          ttl: input && input.ttl
        }, requestOptions);
      });
    }

    function deleteDnsRecord(recordId) {
      return mutateDomain("deleteDnsRecord", function (projectId, domainId, requestOptions) {
        return api.deleteDnsRecord(projectId, domainId, recordId, requestOptions);
      });
    }

    function setDomainAutoRenew(enabled) {
      return mutateDomain("setDomainAutoRenew", function (projectId, domainId, requestOptions) {
        return api.setDomainAutoRenew(projectId, domainId, enabled === true, requestOptions);
      });
    }

    function requestDomainRenewalQuote(years) {
      return mutateDomain("domainRenewalQuote", function (projectId, domainId, requestOptions) {
        return api.requestDomainRenewalQuote(projectId, domainId, years, requestOptions);
      });
    }

    function requestDomainTransferOut() {
      return mutateDomain("domainTransferOut", function (projectId, domainId, requestOptions) {
        return api.requestDomainTransferOut(projectId, domainId, requestOptions);
      });
    }

    return Object.freeze({
      getState: snapshot,
      subscribe: subscribe,
      retry: retry,
      boot: boot,
      register: register,
      beginRegistration: beginRegistration,
      completeRegistration:
        completeRegistration,
      signIn: signIn,
      signOut: signOut,
      refreshSession: refreshSession,
      requestRecovery: requestRecovery,
      completeRecovery: completeRecovery,
      selectOrganization: selectOrganization,
      selectProject: selectProject,
      refreshSelectedProject:
        refreshSelectedProject,
      captureProjectLegalAcceptance:
        captureProjectLegalAcceptance,
      refreshProjectLegalAuthority:
        refreshProjectLegalAuthority,
      createProject: createProject,
      saveDraft: saveDraft,
      acceptMadeVersion: acceptMadeVersion,
      selectVersion: selectVersion,
      selectAddress: selectAddress,
      requestDomainVerification: requestDomainVerification,
      quoteOffer: quoteOffer,
      checkoutQuotedOffer: checkoutQuotedOffer,
      quoteDownload: quoteDownload,
      prepareDownloadCheckout:
        prepareDownloadCheckout,
      billingPortal: billingPortal,
      refreshSubscription: refreshSubscription,
      previewCancellation: previewCancellation,
      cancelSubscription: cancelSubscription,
      requestRelease: requestRelease,
      unpublish: unpublish,
      setVisibility: setVisibility,
      createSupportTicket: createSupportTicket,
      requestExport: requestExport,
      getExport: getExport,
      retryExport: retryExport,
      downloadExport: downloadExport,
      deleteProject: deleteProject,
      searchDomains: searchDomains,
      restartDomainPurchase: restartDomainPurchase,
      createDomainQuote: createDomainQuote,
      saveRegistrantContact: saveRegistrantContact,
      acceptDomainConsent: acceptDomainConsent,
      createDomainOrder: createDomainOrder,
      pollDomainOrder: pollDomainOrder,
      listDomainOrders: listDomainOrders,
      refreshDomainPrice: refreshDomainPrice,
      requestDomainRegistration: requestDomainRegistration,
      listDomains: listDomains,
      selectDomain: selectDomain,
      upsertDnsRecord: upsertDnsRecord,
      deleteDnsRecord: deleteDnsRecord,
      setDomainAutoRenew: setDomainAutoRenew,
      requestDomainRenewalQuote: requestDomainRenewalQuote,
      requestDomainTransferOut: requestDomainTransferOut,
      localFallbackAllowed: localFallbackAllowed
    });
  }

  return Object.freeze({
    ControlError: ControlError,
    createHostedControl: createHostedControl
  });
}));
