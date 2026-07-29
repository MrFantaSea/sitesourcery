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
    this.message = source.message || "The hosted control could not complete this request.";
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
      message: "This browser cannot safely identify a hosted write."
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
        message: "The same-origin hosted API client is required."
      });
    }
    var idempotencyFactory = config.idempotencyFactory || defaultIdempotencyKey;
    var configuredCatalog = config.catalog && isObject(config.catalog.variants)
      ? config.catalog
      : { revision: null, variants: {} };
    var catalogVariants = {};
    Object.keys(configuredCatalog.variants).forEach(function (key) {
      var variant = configuredCatalog.variants[key];
      if (!variant || !variant.priceId) return;
      catalogVariants[key] = Object.freeze({
        label: String(variant.label || key),
        priceId: String(variant.priceId)
      });
    });
    var catalog = Object.freeze({
      revision: configuredCatalog.revision || null,
      variants: Object.freeze(catalogVariants)
    });
    var listeners = new Set();
    var operations = Object.create(null);
    var retryTasks = Object.create(null);
    var operationSequence = 0;
    var selectionEpoch = 0;
    var sessionEpoch = 0;
    var domainSearchEpoch = 0;
    var domainSelectionEpoch = 0;
    var domainOrderEpoch = 0;
    var state = {
      phase: "idle",
      account: null,
      organizations: [],
      organizationId: null,
      projects: [],
      project: null,
      selectedVersionId: null,
      subscription: null,
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
        organizations: clone(state.organizations),
        organizationId: state.organizationId,
        projects: clone(state.projects),
        project: clone(state.project),
        selectedVersionId: state.selectedVersionId,
        subscription: clone(state.subscription),
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
        catalogRevision: catalog.revision || null,
        catalogVariants: Object.freeze(Object.keys(catalog.variants || {}).map(function (key) {
          var variant = catalog.variants[key];
          return Object.freeze({ id: key, label: String(variant.label || key) });
        })),
        checkoutEnabled: Object.keys(catalog.variants || {}).some(function (key) {
          return Boolean(catalog.variants[key] && catalog.variants[key].priceId);
        }),
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

    function resetDomainPurchase() {
      domainOrderEpoch += 1;
      state.domainQuote = null;
      state.domainConsent = null;
      state.domainOrder = null;
      state.domainPriceCheck = null;
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
          var presented = safeError(error, "The hosted request failed.");
          if (operations[name] && operations[name].token === token) {
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

    function retry(name) {
      var retryTask = retryTasks[name];
      var operation = operations[name];
      if (!retryTask || !operation || operation.status !== "error" || !operation.error.retryable) {
        return Promise.reject(new ControlError({
          code: "RETRY_UNAVAILABLE",
          message: "That hosted action cannot be retried."
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
        state.phase = "signed-out";
        state.organizations = [];
        state.organizationId = null;
        state.projects = [];
        state.project = null;
        state.subscription = null;
        resetDomains();
        return null;
      }
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
      state.phase = "loading";
      return task("session", async function () {
        try {
          var payload = await api.me();
          return await loadAccountData(payload, expectedSessionEpoch);
        } catch (error) {
          if (error && error.status === 401 && expectedSessionEpoch === sessionEpoch) {
            state.phase = "signed-out";
            state.account = null;
            state.organizations = [];
            state.organizationId = null;
            state.projects = [];
            state.project = null;
            state.subscription = null;
            resetDomains();
            return null;
          }
          if (expectedSessionEpoch === sessionEpoch) state.phase = "error";
          throw error;
        }
      });
    }

    function authenticate(operationName, call) {
      var expectedSessionEpoch = ++sessionEpoch;
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
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("signOut", async function () {
          await api.signOut({ idempotencyKey: key });
          if (expectedSessionEpoch !== sessionEpoch) return null;
          selectionEpoch += 1;
          state.phase = "signed-out";
          state.account = null;
          state.organizations = [];
          state.organizationId = null;
          state.projects = [];
          state.project = null;
          state.selectedVersionId = null;
          state.subscription = null;
          resetDomains();
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
      state.organizationId = selected;
      state.project = null;
      state.selectedVersionId = null;
      state.subscription = null;
      resetDomains();
      selectionEpoch += 1;
      return task("projects", function () {
        return refreshProjectsFor(selected, expectedSessionEpoch);
      });
    }

    function selectProject(projectId) {
      var selected = String(projectId || "");
      var expectedSelectionEpoch = ++selectionEpoch;
      state.project = { id: selected };
      state.selectedVersionId = null;
      state.subscription = null;
      resetDomainPurchase();
      return task("project", async function () {
        var projectPayload = await api.getProject(selected);
        if (expectedSelectionEpoch !== selectionEpoch) return null;
        var project = entityFrom(projectPayload, "project");
        if (!project || idOf(project) !== selected) {
          throw new ControlError({ code: "PROJECT_RESPONSE_INVALID", message: "The project response was invalid." });
        }
        replaceProject(project);
        var subscriptionPayload = await api.subscription(selected);
        if (expectedSelectionEpoch !== selectionEpoch) return null;
        state.subscription = entityFrom(subscriptionPayload, "subscription");
        return project;
      });
    }

    function createProject(input) {
      var organizationId = assertOrganization();
      var key = idempotencyFactory();
      var expectedSessionEpoch = sessionEpoch;
      var retryCall = function () {
        return task("createProject", async function () {
          var payload = await api.createProject({
            organizationId: organizationId,
            name: input && input.name,
            address: input && input.address,
            visibility: input && input.visibility,
            accessPassword: input && input.accessPassword,
            acceptedTerms: input && input.acceptedTerms === true
          }, { idempotencyKey: key });
          if (expectedSessionEpoch !== sessionEpoch) return null;
          var project = entityFrom(payload, "project");
          await refreshProjectsFor(organizationId, expectedSessionEpoch);
          if (project && idOf(project)) {
            state.project = project;
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
          await refreshProject(projectId, expectedSelectionEpoch);
          return entityFrom(acceptedPayload, "version") || version;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function selectVersion(versionId) {
      state.selectedVersionId = String(versionId || "") || null;
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

    function checkout(variantId) {
      var projectId = assertProject();
      var variant = catalog.variants && catalog.variants[String(variantId || "")];
      if (!variant || !variant.priceId) {
        return Promise.reject(new ControlError({
          code: "CHECKOUT_HELD",
          message: "Secure payment stays disabled until this service option has an approved catalog price."
        }));
      }
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("checkout", function () {
          return api.checkout(projectId, variant.priceId, { idempotencyKey: key });
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

    function cancelSubscription() {
      var projectId = assertProject();
      var expectedSelectionEpoch = selectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task("cancelSubscription", async function () {
          var payload = await api.cancelSubscription(projectId, { idempotencyKey: key });
          var subscriptionPayload = await api.subscription(projectId);
          if (
            expectedSelectionEpoch === selectionEpoch
            && state.project
            && idOf(state.project) === projectId
          ) {
            state.subscription = entityFrom(subscriptionPayload, "subscription");
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
      return mutateProject("requestExport", function (projectId, requestOptions) {
        return api.requestExport(projectId, requestOptions);
      });
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
            resetDomainPurchase();
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
      var key = idempotencyFactory();
      var expectedEpoch = domainSearchEpoch;
      var retryCall = function () {
        return task("domainQuote", async function () {
          var payload = await api.createDomainQuote({
            hostname: input && input.hostname,
            years: input && input.years,
            purpose: input && input.purpose
          }, { idempotencyKey: key });
          if (expectedEpoch !== domainSearchEpoch) return null;
          resetDomainPurchase();
          state.domainQuote = entityFrom(payload, "quote");
          return state.domainQuote;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function saveRegistrantContact(input) {
      var organizationId = assertOrganization();
      var key = idempotencyFactory();
      var expectedSessionEpoch = sessionEpoch;
      var retryCall = function () {
        return task("registrantContact", async function () {
          var payload = await api.saveRegistrantContact(organizationId, {
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
          if (expectedSessionEpoch !== sessionEpoch) return null;
          state.registrantContact = entityFrom(payload, "registrantContact");
          return state.registrantContact;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function acceptDomainConsent(input) {
      var quoteId = idOf(state.domainQuote);
      var contactId = idOf(state.registrantContact);
      if (!quoteId || !contactId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_CONSENT_PREREQUISITES_REQUIRED",
          message: "Save the current quote and customer registrant details before accepting domain terms."
        }));
      }
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
      var key = idempotencyFactory();
      var expectedEpoch = domainSearchEpoch;
      var retryCall = function () {
        return task("domainConsent", async function () {
          var payload = await api.acceptDomainConsent(quoteId, {
            registrantContactId: contactId,
            termsVersion: input.termsVersion,
            registrationAgreementAccepted: true,
            registrantCertificationAccepted: true,
            autoRenewRequested: input.autoRenewRequested === true
          }, { idempotencyKey: key });
          if (expectedEpoch !== domainSearchEpoch) return null;
          state.domainConsent = entityFrom(payload, "consent");
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
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var retryCall = function () {
        return task("domainOrder", async function () {
          var payload = await api.createDomainOrder(projectId, {
            quoteId: quoteId,
            consentId: consentId
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || !state.project
            || idOf(state.project) !== projectId
          ) return null;
          state.domainOrder = entityFrom(payload, "domainOrder");
          state.domainPriceCheck = null;
          domainOrderEpoch += 1;
          return state.domainOrder;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function pollDomainOrder(orderId) {
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
        var payload = await api.getDomainOrder(selectedOrderId);
        if (
          expectedSelectionEpoch !== selectionEpoch
          || expectedOrderEpoch !== domainOrderEpoch
          || idOf(state.domainOrder) !== selectedOrderId
        ) return null;
        var order = entityFrom(payload, "domainOrder");
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
        var orders = arrayFrom(payload, "domainOrders");
        state.domainOrder = orders[0] || null;
        state.domainPriceCheck = null;
        domainOrderEpoch += 1;
        return orders;
      });
    }

    function refreshDomainPrice() {
      var orderId = idOf(state.domainOrder);
      if (!orderId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_ORDER_REQUIRED",
          message: "Complete domain payment before requesting the mandatory fresh price check."
        }));
      }
      var key = idempotencyFactory();
      var expectedSelectionEpoch = selectionEpoch;
      var expectedOrderEpoch = domainOrderEpoch;
      var retryCall = function () {
        return task("domainPriceCheck", async function () {
          var payload = await api.refreshDomainPrice(orderId, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedOrderEpoch !== domainOrderEpoch
            || idOf(state.domainOrder) !== orderId
          ) return null;
          state.domainPriceCheck = entityFrom(payload, "priceCheck");
          return state.domainPriceCheck;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function requestDomainRegistration(input) {
      var orderId = idOf(state.domainOrder);
      var priceCheckId = idOf(state.domainPriceCheck);
      if (!orderId || !priceCheckId) {
        return Promise.reject(new ControlError({
          code: "FRESH_DOMAIN_PRICE_REQUIRED",
          message: "Run the mandatory fresh availability and price check immediately before registration."
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
          var payload = await api.requestDomainRegistration(orderId, {
            priceCheckId: priceCheckId,
            irreversibleRegistrationAccepted: true
          }, { idempotencyKey: key });
          if (
            expectedSelectionEpoch !== selectionEpoch
            || expectedOrderEpoch !== domainOrderEpoch
            || idOf(state.domainOrder) !== orderId
          ) return null;
          var order = entityFrom(payload, "domainOrder");
          if (order && idOf(order) === orderId) state.domainOrder = order;
          return order || payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function listDomains() {
      var organizationId = assertOrganization();
      var expectedSessionEpoch = sessionEpoch;
      return task("domains", async function () {
        var payload = await api.listDomains(organizationId);
        if (expectedSessionEpoch !== sessionEpoch || organizationId !== state.organizationId) return null;
        state.domains = arrayFrom(payload, "domains");
        return state.domains;
      });
    }

    function selectDomain(domainId) {
      var selected = String(domainId || "");
      var expectedEpoch = ++domainSelectionEpoch;
      return task("domain", async function () {
        var domainPayload = await api.getDomain(selected);
        var recordsPayload = await api.listDnsRecords(selected);
        if (expectedEpoch !== domainSelectionEpoch) return null;
        var domain = entityFrom(domainPayload, "domain");
        if (!domain || idOf(domain) !== selected) {
          throw new ControlError({
            code: "DOMAIN_RESPONSE_INVALID",
            message: "The hosted domain response was invalid."
          });
        }
        state.selectedDomain = domain;
        state.dnsRecords = arrayFrom(recordsPayload, "records");
        return domain;
      });
    }

    function mutateDomain(name, invoke) {
      var domainId = idOf(state.selectedDomain);
      if (!domainId) {
        return Promise.reject(new ControlError({
          code: "DOMAIN_REQUIRED",
          message: "Choose a customer-owned domain first."
        }));
      }
      var expectedEpoch = domainSelectionEpoch;
      var key = idempotencyFactory();
      var retryCall = function () {
        return task(name, async function () {
          var payload = await invoke(domainId, { idempotencyKey: key });
          if (expectedEpoch === domainSelectionEpoch && idOf(state.selectedDomain) === domainId) {
            var domainPayload = await api.getDomain(domainId);
            var recordsPayload = await api.listDnsRecords(domainId);
            if (expectedEpoch === domainSelectionEpoch) {
              state.selectedDomain = entityFrom(domainPayload, "domain");
              state.dnsRecords = arrayFrom(recordsPayload, "records");
            }
          }
          return payload;
        }, { write: true, retry: retryCall });
      };
      return retryCall();
    }

    function upsertDnsRecord(input) {
      return mutateDomain("upsertDnsRecord", function (domainId, requestOptions) {
        return api.upsertDnsRecord(domainId, {
          recordId: input && input.recordId,
          type: input && input.type,
          name: input && input.name,
          content: input && input.content,
          ttl: input && input.ttl
        }, requestOptions);
      });
    }

    function deleteDnsRecord(recordId) {
      return mutateDomain("deleteDnsRecord", function (domainId, requestOptions) {
        return api.deleteDnsRecord(domainId, recordId, requestOptions);
      });
    }

    function setDomainAutoRenew(enabled) {
      return mutateDomain("setDomainAutoRenew", function (domainId, requestOptions) {
        return api.setDomainAutoRenew(domainId, enabled === true, requestOptions);
      });
    }

    function requestDomainRenewalQuote(years) {
      return mutateDomain("domainRenewalQuote", function (domainId, requestOptions) {
        return api.requestDomainRenewalQuote(domainId, years, requestOptions);
      });
    }

    function requestDomainTransferOut() {
      return mutateDomain("domainTransferOut", function (domainId, requestOptions) {
        return api.requestDomainTransferOut(domainId, requestOptions);
      });
    }

    return Object.freeze({
      getState: snapshot,
      subscribe: subscribe,
      retry: retry,
      boot: boot,
      register: register,
      signIn: signIn,
      signOut: signOut,
      requestRecovery: requestRecovery,
      completeRecovery: completeRecovery,
      selectOrganization: selectOrganization,
      selectProject: selectProject,
      createProject: createProject,
      saveDraft: saveDraft,
      acceptMadeVersion: acceptMadeVersion,
      selectVersion: selectVersion,
      selectAddress: selectAddress,
      requestDomainVerification: requestDomainVerification,
      checkout: checkout,
      billingPortal: billingPortal,
      refreshSubscription: refreshSubscription,
      cancelSubscription: cancelSubscription,
      requestRelease: requestRelease,
      unpublish: unpublish,
      setVisibility: setVisibility,
      createSupportTicket: createSupportTicket,
      requestExport: requestExport,
      deleteProject: deleteProject,
      searchDomains: searchDomains,
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
