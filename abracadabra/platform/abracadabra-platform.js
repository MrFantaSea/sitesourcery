(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SiteSourceryAbracadabraPlatform = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORE_KEY = "sitesourcery.abracadabra.platform.v1";
  var STORE_SCHEMA = "sitesourcery.abracadabra.platform/v1";
  var DAY_MS = 24 * 60 * 60 * 1000;
  var GRACE_DAYS = 14;
  var RETENTION_DAYS = 90;
  var CREDENTIAL_ROUNDS = 12000;
  var PLAN_ID = "abracadabra-website";
  var STORAGE_MODE = "local_rehearsal_nontransactional";
  var CONCURRENCY_POLICY = "multi_tab_unsupported_not_prevented";
  var TERMS = freeze({
    product: "abracadabra-product-2026-07-27",
    privacy: "site-sourcery-privacy-2026-07-27",
    website: "site-sourcery-website-terms-2026-07-27"
  });
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  var HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
  var LABEL = /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
  var DIGEST = /^[a-f0-9]{64}$/u;

  function PlatformError(code, message) {
    this.name = "AbracadabraPlatformError";
    this.code = code;
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, PlatformError);
  }
  PlatformError.prototype = Object.create(Error.prototype);
  PlatformError.prototype.constructor = PlatformError;

  function fail(code, message) {
    throw new PlatformError(code, message);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(function (key) { freeze(value[key]); });
    return value;
  }

  function frozenCopy(value) {
    return freeze(clone(value));
  }

  function cleanText(value, maximum) {
    return String(value == null ? "" : value).replace(/\s+/gu, " ").trim().slice(0, maximum);
  }

  function cleanEmail(value) {
    var candidate = String(value == null ? "" : value).trim().toLowerCase();
    if (!EMAIL.test(candidate) || candidate.length > 254) fail("INVALID_EMAIL", "Enter a valid email address.");
    return candidate;
  }

  function cleanPassword(value) {
    var password = String(value == null ? "" : value).normalize("NFC");
    if (password.length < 10 || password.length > 256) {
      fail("INVALID_PASSWORD", "Use a password between 10 and 256 characters.");
    }
    return password;
  }

  function cleanHostname(value) {
    var candidate = String(value == null ? "" : value).trim().toLowerCase().replace(/\.$/u, "");
    if (!HOSTNAME.test(candidate)) fail("INVALID_HOSTNAME", "Enter a complete domain name.");
    return candidate;
  }

  function cleanLabel(value) {
    var candidate = String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 63);
    if (!LABEL.test(candidate)) fail("INVALID_ADDRESS_LABEL", "Choose a short address using letters, numbers, and hyphens.");
    return candidate;
  }

  function iso(value) {
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) fail("INVALID_TIME", "A valid date and time is required.");
    return date.toISOString();
  }

  function addDays(value, days) {
    return new Date(new Date(value).getTime() + (days * DAY_MS)).toISOString();
  }

  function utf8Bytes(value) {
    var bytes = [];
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        var next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          var point = 0x10000 + (((code - 0xd800) << 10) | (next - 0xdc00));
          bytes.push(
            0xf0 | (point >>> 18),
            0x80 | ((point >>> 12) & 0x3f),
            0x80 | ((point >>> 6) & 0x3f),
            0x80 | (point & 0x3f)
          );
          index += 1;
        } else {
          bytes.push(0xef, 0xbf, 0xbd);
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        bytes.push(0xef, 0xbf, 0xbd);
      } else {
        bytes.push(
          0xe0 | (code >>> 12),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256(value) {
    var constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = utf8Bytes(String(value));
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var high = Math.floor(bitLength / 0x100000000);
    var low = bitLength >>> 0;
    for (var highShift = 24; highShift >= 0; highShift -= 8) bytes.push((high >>> highShift) & 0xff);
    for (var lowShift = 24; lowShift >= 0; lowShift -= 8) bytes.push((low >>> lowShift) & 0xff);
    var words = new Array(64);
    for (var offset = 0; offset < bytes.length; offset += 64) {
      for (var wordIndex = 0; wordIndex < 16; wordIndex += 1) {
        var byteIndex = offset + (wordIndex * 4);
        words[wordIndex] = (
          (bytes[byteIndex] << 24)
          | (bytes[byteIndex + 1] << 16)
          | (bytes[byteIndex + 2] << 8)
          | bytes[byteIndex + 3]
        ) >>> 0;
      }
      for (var scheduleIndex = 16; scheduleIndex < 64; scheduleIndex += 1) {
        var previous15 = words[scheduleIndex - 15];
        var previous2 = words[scheduleIndex - 2];
        var sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
        var sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
        words[scheduleIndex] = (
          words[scheduleIndex - 16] + sigma0 + words[scheduleIndex - 7] + sigma1
        ) >>> 0;
      }
      var a = hash[0];
      var b = hash[1];
      var c = hash[2];
      var d = hash[3];
      var e = hash[4];
      var f = hash[5];
      var g = hash[6];
      var h = hash[7];
      for (var round = 0; round < 64; round += 1) {
        var sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        var choice = (e & f) ^ ((~e) & g);
        var temporary1 = (h + sum1 + choice + constants[round] + words[round]) >>> 0;
        var sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(function (word) { return word.toString(16).padStart(8, "0"); }).join("");
  }

  function secureRandomHex(bytes) {
    var cryptoObject = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      fail("SECURE_RANDOM_UNAVAILABLE", "This browser does not support secure local random values.");
    }
    var values = new Uint8Array(bytes);
    cryptoObject.getRandomValues(values);
    return Array.from(values, function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }

  function memoryStorage() {
    var values = Object.create(null);
    return {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      setItem: function (key, value) {
        values[key] = String(value);
      },
      removeItem: function (key) {
        delete values[key];
      }
    };
  }

  function initialSnapshot(now) {
    return {
      schema: STORE_SCHEMA,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      accounts: [],
      organizations: [],
      recoveryRequests: [],
      mail: [],
      projects: [],
      supportTickets: []
    };
  }

  function validateSnapshot(snapshot) {
    if (
      !snapshot
      || snapshot.schema !== STORE_SCHEMA
      || !Number.isInteger(snapshot.revision)
      || !Array.isArray(snapshot.accounts)
      || !Array.isArray(snapshot.organizations)
      || !Array.isArray(snapshot.recoveryRequests)
      || !Array.isArray(snapshot.mail)
      || !Array.isArray(snapshot.projects)
      || !Array.isArray(snapshot.supportTickets)
    ) {
      fail("INVALID_STORE", "The Abracadabra project store is not readable.");
    }
    return snapshot;
  }

  function clearSafetyState() {
    return {
      state: "clear",
      reason: null,
      heldAt: null,
      heldBy: null,
      appealMessage: null,
      appealedAt: null,
      restoredAt: null,
      restoredBy: null,
      previousServingState: null
    };
  }

  function createPlatform(options) {
    var settings = options || {};
    var storage = settings.storage || memoryStorage();
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      fail("INVALID_STORAGE", "Abracadabra requires a storage adapter.");
    }
    var clock = typeof settings.clock === "function" ? settings.clock : function () { return new Date(); };
    var randomHex = typeof settings.randomHex === "function" ? settings.randomHex : secureRandomHex;
    var safetyOperatorDigest = settings.safetyOperatorSecret
      ? sha256("abracadabra-safety-operator:" + cleanPassword(settings.safetyOperatorSecret))
      : null;
    var billingOperatorDigest = settings.billingOperatorSecret
      ? sha256("abracadabra-billing-operator:" + cleanPassword(settings.billingOperatorSecret))
      : null;
    var domainOperatorDigest = settings.domainOperatorSecret
      ? sha256("abracadabra-domain-operator:" + cleanPassword(settings.domainOperatorSecret))
      : null;
    var safetyOperatorGrants = Object.create(null);
    var billingOperatorGrants = Object.create(null);
    var domainOperatorGrants = Object.create(null);
    var sequence = 0;
    var idFactory = typeof settings.idFactory === "function"
      ? settings.idFactory
      : function (prefix) {
        sequence += 1;
        return prefix + "_" + randomHex(8) + "_" + sequence.toString(36);
      };

    function now() {
      return iso(clock());
    }

    function migrateSnapshot(snapshot) {
      if (!Array.isArray(snapshot.organizations)) snapshot.organizations = [];
      snapshot.accounts.forEach(function (account) {
        if (!Array.isArray(account.organizationIds) || account.organizationIds.length === 0) {
          var legacyOrganizationId = "org_legacy_" + account.id;
          if (!snapshot.organizations.some(function (item) { return item.id === legacyOrganizationId; })) {
            snapshot.organizations.push({
              id: legacyOrganizationId,
              name: cleanText(account.name + " workspace", 120),
              accountIds: [account.id],
              createdAt: account.createdAt,
              updatedAt: account.updatedAt
            });
          }
          account.organizationIds = [legacyOrganizationId];
        }
      });
      snapshot.projects.forEach(function (project) {
        var account = snapshot.accounts.find(function (item) { return item.id === project.accountId; });
        if (!project.organizationId && account && account.organizationIds[0]) {
          project.organizationId = account.organizationIds[0];
        }
        if (!Object.prototype.hasOwnProperty.call(project, "terms")) project.terms = null;
        if (project.plan) {
          project.plan.activationScope = STORAGE_MODE;
          project.plan.providerReference = null;
          project.plan.paymentReceipt = null;
          project.plan.subscriptionId = null;
        }
        if (project.billing) {
          project.billing.authority = STORAGE_MODE;
          project.billing.providerReference = null;
          project.billing.paymentReceipt = null;
          project.billing.subscriptionId = null;
        }
        if (project.billingRestoration) {
          project.billingRestoration.evidenceScope = STORAGE_MODE;
          project.billingRestoration.providerEvent = false;
        }
        if (!project.safety) project.safety = clearSafetyState();
        if (!Array.isArray(project.safetyHistory)) project.safetyHistory = [];
        if (!Array.isArray(project.screeningAttempts)) project.screeningAttempts = [];
        if (
          project.address
          && project.address.mode === "mode_b"
          && !Object.prototype.hasOwnProperty.call(project.address, "verification")
        ) {
          project.address.verification = project.address.state === "configured"
            ? {
                method: "legacy_local_rehearsal",
                reference: "migrated-before-verification-gate",
                verifiedAt: project.updatedAt,
                operatorId: "legacy-migration"
              }
            : null;
        }
        if (!project.serving) return;
        if (!Object.prototype.hasOwnProperty.call(project.serving, "resumeState")) {
          project.serving.resumeState = project.serving.state === "live" ? "live" : "unpublished";
        }
        if (!Object.prototype.hasOwnProperty.call(project, "exit")) {
          project.exit = {
            cancelledAt: project.plan && project.plan.cancelledAt ? project.plan.cancelledAt : null,
            domainDetachedAt: null
          };
        }
      });
      return snapshot;
    }

    function read() {
      var raw = storage.getItem(STORE_KEY);
      if (!raw) return initialSnapshot(now());
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        fail("INVALID_STORE", "The Abracadabra project store contains invalid data.");
      }
      return validateSnapshot(migrateSnapshot(parsed));
    }

    function write(snapshot, expectedRevision) {
      validateSnapshot(snapshot);
      if (read().revision !== expectedRevision) {
        fail(
          "STORE_CONFLICT",
          "The local project store changed since this operation began. Reload the current project before continuing. Multi-tab writes are unsupported.",
        );
      }
      snapshot.revision = expectedRevision + 1;
      snapshot.updatedAt = now();
      storage.setItem(STORE_KEY, JSON.stringify(snapshot));
    }

    function mutate(operation) {
      var snapshot = clone(read());
      var expectedRevision = snapshot.revision;
      var result = operation(snapshot);
      write(snapshot, expectedRevision);
      return frozenCopy(result);
    }

    function accountById(snapshot, accountId) {
      var account = snapshot.accounts.find(function (item) { return item.id === accountId; });
      if (!account) fail("ACCOUNT_NOT_FOUND", "The account was not found.");
      return account;
    }

    function organizationById(snapshot, organizationId) {
      var organization = snapshot.organizations.find(function (item) { return item.id === organizationId; });
      if (!organization) fail("ORGANIZATION_NOT_FOUND", "The organization was not found.");
      return organization;
    }

    function requireOrganization(snapshot, account, organizationId) {
      var targetId = organizationId || account.organizationIds[0];
      if (!account.organizationIds.includes(targetId)) {
        fail("ORGANIZATION_NOT_FOUND", "The organization was not found.");
      }
      return organizationById(snapshot, targetId);
    }

    function projectById(snapshot, projectId) {
      var project = snapshot.projects.find(function (item) { return item.id === projectId; });
      if (!project) fail("PROJECT_NOT_FOUND", "The project was not found.");
      return project;
    }

    function requireOwner(snapshot, projectId, accountId) {
      var project = projectById(snapshot, projectId);
      if (project.accountId !== accountId) fail("PROJECT_NOT_FOUND", "The project was not found.");
      return project;
    }

    function publicAccount(account) {
      return {
        id: account.id,
        name: account.name,
        email: account.email,
        organizationIds: clone(account.organizationIds),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt
      };
    }

    function iteratedDigest(password, salt, rounds) {
      var digest = sha256(salt + ":" + cleanPassword(password));
      for (var round = 1; round < rounds; round += 1) {
        digest = sha256(salt + ":" + digest + ":" + round.toString(16));
      }
      return digest;
    }

    function credential(password) {
      var salt = randomHex(16).toLowerCase();
      return {
        algorithm: "sha256-iterated-v2",
        rounds: CREDENTIAL_ROUNDS,
        salt: salt,
        digest: iteratedDigest(password, salt, CREDENTIAL_ROUNDS)
      };
    }

    function passwordMatches(password, saved) {
      if (!saved) return false;
      var actual;
      if (saved.algorithm === "sha256-iterated-v2" && Number.isInteger(saved.rounds)) {
        actual = iteratedDigest(password, saved.salt, saved.rounds);
      } else if (saved.algorithm === "sha256-salted-v1") {
        actual = sha256(saved.salt + ":" + String(password == null ? "" : password).normalize("NFC"));
      } else {
        return false;
      }
      var mismatch = actual.length ^ String(saved.digest || "").length;
      for (var index = 0; index < Math.max(actual.length, String(saved.digest || "").length); index += 1) {
        mismatch |= (actual.charCodeAt(index) || 0) ^ (String(saved.digest || "").charCodeAt(index) || 0);
      }
      return mismatch === 0;
    }

    function screenRelease(artifact, attested) {
      var findings = [];
      var html = artifact && typeof artifact.html === "string" ? artifact.html : "";
      var digest = String(artifact && artifact.digest || "").toLowerCase();
      if (attested !== true) findings.push("release_attestation_missing");
      if (!DIGEST.test(digest) || sha256(html) !== digest) findings.push("artifact_integrity_failed");
      if (html.length > 250000) findings.push("artifact_size_exceeded");
      if (/<(?:script|iframe|object|embed|form|input|button|textarea|select|base)\b/iu.test(html)) {
        findings.push("active_markup_detected");
      }
      if (/\son[a-z]+\s*=/iu.test(html)) findings.push("inline_event_handler_detected");
      if (/(?:href|src)\s*=\s*["']\s*(?:javascript|data):/iu.test(html)) {
        findings.push("unsafe_resource_scheme_detected");
      }
      return {
        state: findings.length ? "rejected" : "passed",
        method: "self-contained-release-screen/v1",
        artifactDigest: digest,
        findings: findings
      };
    }

    function screeningAttempt(stage, versionId, result, at) {
      return {
        id: idFactory("screening"),
        stage: stage,
        versionId: versionId || null,
        state: result.state,
        method: result.method,
        artifactDigest: result.artifactDigest,
        findings: clone(result.findings),
        checkedAt: at
      };
    }

    function openOperatorSession(input, configuration) {
      var request = input || {};
      if (!configuration.digest) {
        fail(configuration.missingCode, configuration.missingMessage);
      }
      var candidate = sha256(configuration.salt + cleanPassword(request.secret));
      if (candidate !== configuration.digest) {
        fail(configuration.deniedCode, configuration.deniedMessage);
      }
      var grant = configuration.prefix + "_" + randomHex(24).toLowerCase();
      configuration.grants[grant] = {
        openedAt: now(),
        operatorId: cleanText(request.operatorId || "local-reviewer", 100)
      };
      return frozenCopy({
        grant: grant,
        operatorId: configuration.grants[grant].operatorId,
        openedAt: configuration.grants[grant].openedAt
      });
    }

    function requireOperator(input, grants, code, message) {
      var request = input || {};
      var session = grants[String(request.operatorGrant || "")];
      if (!session) {
        fail(code, message);
      }
      return session;
    }

    function openSafetyOperatorSession(input) {
      return openOperatorSession(input, {
        digest: safetyOperatorDigest,
        salt: "abracadabra-safety-operator:",
        grants: safetyOperatorGrants,
        prefix: "safety",
        missingCode: "SAFETY_OPERATOR_NOT_CONFIGURED",
        missingMessage: "Safety review authority is not configured in this client.",
        deniedCode: "SAFETY_OPERATOR_DENIED",
        deniedMessage: "Safety review authority was not accepted."
      });
    }

    function requireSafetyOperator(input) {
      return requireOperator(
        input,
        safetyOperatorGrants,
        "SAFETY_OPERATOR_REQUIRED",
        "A separate safety-review grant is required."
      );
    }

    function openBillingOperatorSession(input) {
      return openOperatorSession(input, {
        digest: billingOperatorDigest,
        salt: "abracadabra-billing-operator:",
        grants: billingOperatorGrants,
        prefix: "billing",
        missingCode: "BILLING_OPERATOR_NOT_CONFIGURED",
        missingMessage: "Billing restoration authority is not configured in this client.",
        deniedCode: "BILLING_OPERATOR_DENIED",
        deniedMessage: "Billing restoration authority was not accepted."
      });
    }

    function requireBillingOperator(input) {
      return requireOperator(
        input,
        billingOperatorGrants,
        "BILLING_OPERATOR_REQUIRED",
        "A separate verified-billing grant is required."
      );
    }

    function openDomainOperatorSession(input) {
      return openOperatorSession(input, {
        digest: domainOperatorDigest,
        salt: "abracadabra-domain-operator:",
        grants: domainOperatorGrants,
        prefix: "domain",
        missingCode: "DOMAIN_OPERATOR_NOT_CONFIGURED",
        missingMessage: "Domain verification authority is not configured in this client.",
        deniedCode: "DOMAIN_OPERATOR_DENIED",
        deniedMessage: "Domain verification authority was not accepted."
      });
    }

    function requireDomainOperator(input) {
      return requireOperator(
        input,
        domainOperatorGrants,
        "DOMAIN_OPERATOR_REQUIRED",
        "A separate registrar or DNS verification grant is required."
      );
    }

    function normalizeAddress(input) {
      var address = input || {};
      if (address.mode === "mode_a") {
        var label = cleanLabel(address.label);
        return {
          mode: "mode_a",
          path: "licensed",
          label: label,
          hostname: label + ".sitesourcery.me",
          ownership: "licensed",
          state: "configured"
        };
      }
      if (address.mode === "mode_b") {
        if (!["purchase", "byod"].includes(address.path)) {
          fail("INVALID_ADDRESS_PATH", "Choose whether to buy a domain through Site Sourcery or connect one you own.");
        }
        var domain = cleanHostname(address.domain || address.hostname);
        return {
          mode: "mode_b",
          path: address.path,
          domain: domain,
          hostname: domain,
          ownership: "customer",
          state: address.path === "purchase" ? "order_pending" : "connection_pending",
          verification: null,
          verificationRequests: []
        };
      }
      fail("INVALID_ADDRESS_MODE", "Choose a Site Sourcery address or a customer-owned domain.");
    }

    function normalizeAccess(visibility, accessPassword) {
      if (visibility === "public") return { visibility: "public", credential: null };
      if (visibility !== "private") fail("INVALID_VISIBILITY", "Choose public or access-controlled private.");
      return { visibility: "private", credential: credential(accessPassword) };
    }

    function assertHostnameAvailable(snapshot, hostname, exceptProjectId) {
      var collision = snapshot.projects.find(function (item) {
        return item.id !== exceptProjectId
          && item.lifecycle !== "deleted"
          && item.address
          && item.address.hostname === hostname;
      });
      if (collision) fail("ADDRESS_TAKEN", "That website address is already attached to another project.");
    }

    function createAccount(input) {
      var request = input || {};
      var email = cleanEmail(request.email);
      var name = cleanText(request.name, 100);
      if (name.length < 2) fail("INVALID_NAME", "Enter the account holder’s name.");
      var organizationName = cleanText(request.organizationName, 120);
      if (organizationName.length < 2) fail("INVALID_ORGANIZATION_NAME", "Enter the business or organization name.");
      var password = cleanPassword(request.password);
      return mutate(function (snapshot) {
        if (snapshot.accounts.some(function (item) { return item.email === email; })) {
          fail("EMAIL_EXISTS", "An account already uses that email address.");
        }
        var createdAt = now();
        var accountId = idFactory("acct");
        var organizationId = idFactory("org");
        var account = {
          id: accountId,
          name: name,
          email: email,
          password: credential(password),
          organizationIds: [organizationId],
          createdAt: createdAt,
          updatedAt: createdAt
        };
        var organization = {
          id: organizationId,
          name: organizationName,
          accountIds: [accountId],
          createdAt: createdAt,
          updatedAt: createdAt
        };
        snapshot.accounts.push(account);
        snapshot.organizations.push(organization);
        return publicAccount(account);
      });
    }

    function signIn(input) {
      var request = input || {};
      var email = cleanEmail(request.email);
      var snapshot = read();
      var account = snapshot.accounts.find(function (item) { return item.email === email; });
      if (!account || !passwordMatches(request.password, account.password)) {
        fail("SIGN_IN_FAILED", "The email and password did not match.");
      }
      return frozenCopy(publicAccount(account));
    }

    function getAccount(input) {
      var request = input || {};
      return frozenCopy(publicAccount(accountById(read(), request.accountId)));
    }

    function listOrganizations(input) {
      var request = input || {};
      var snapshot = read();
      var account = accountById(snapshot, request.accountId);
      return frozenCopy(snapshot.organizations.filter(function (organization) {
        return account.organizationIds.includes(organization.id)
          && organization.accountIds.includes(account.id);
      }));
    }

    function requestRecovery(input) {
      var request = input || {};
      var email = cleanEmail(request.email);
      return mutate(function (snapshot) {
        var requestId = idFactory("recovery_request");
        var account = snapshot.accounts.find(function (item) { return item.email === email; });
        if (!account) return { accepted: true, requestId: requestId };
        var token = randomHex(24).toLowerCase();
        var requestedAt = now();
        snapshot.recoveryRequests.forEach(function (item) {
          if (item.accountId !== account.id || item.usedAt || !item.tokenDigest) return;
          item.tokenDigest = null;
          item.supersededAt = requestedAt;
        });
        snapshot.mail.forEach(function (item) {
          if (
            item.accountId !== account.id
            || item.kind !== "password_recovery"
            || item.consumedAt
            || !item.recoveryToken
          ) return;
          item.recoveryToken = null;
          item.supersededAt = requestedAt;
        });
        var recovery = {
          id: requestId,
          accountId: account.id,
          tokenDigest: sha256(token),
          requestedAt: requestedAt,
          expiresAt: addDays(requestedAt, 1),
          usedAt: null
        };
        var message = {
          id: idFactory("mail"),
          accountId: account.id,
          to: account.email,
          kind: "password_recovery",
          subject: "Reset your Abracadabra password",
          recoveryRequestId: requestId,
          recoveryToken: token,
          createdAt: requestedAt,
          consumedAt: null
        };
        snapshot.recoveryRequests.push(recovery);
        snapshot.mail.push(message);
        return { accepted: true, requestId: requestId };
      });
    }

    function listMail(input) {
      var request = input || {};
      var snapshot = read();
      accountById(snapshot, request.accountId);
      return frozenCopy(snapshot.mail.filter(function (item) { return item.accountId === request.accountId; }));
    }

    function readLocalMail(input) {
      var request = input || {};
      var email = cleanEmail(request.email);
      var snapshot = read();
      var account = snapshot.accounts.find(function (item) { return item.email === email; });
      if (!account) fail("MAIL_NOT_FOUND", "The local recovery message was not found.");
      var message = snapshot.mail.find(function (item) {
        return item.recoveryRequestId === request.requestId && item.accountId === account.id;
      });
      if (!message) fail("MAIL_NOT_FOUND", "The local recovery message was not found.");
      return frozenCopy(message);
    }

    function resetPassword(input) {
      var request = input || {};
      var password = cleanPassword(request.password);
      var tokenDigest = sha256(String(request.token || "").trim().toLowerCase());
      return mutate(function (snapshot) {
        var currentTime = new Date(now()).getTime();
        var recovery = snapshot.recoveryRequests.find(function (item) {
          return item.tokenDigest === tokenDigest
            && !item.usedAt
            && new Date(item.expiresAt).getTime() > currentTime;
        });
        if (!recovery) fail("RECOVERY_FAILED", "That recovery link is invalid or expired.");
        var account = accountById(snapshot, recovery.accountId);
        account.password = credential(password);
        account.updatedAt = now();
        recovery.usedAt = now();
        recovery.tokenDigest = null;
        snapshot.mail.forEach(function (message) {
          if (message.recoveryRequestId === recovery.id) {
            message.recoveryToken = null;
            message.consumedAt = recovery.usedAt;
          }
        });
        return publicAccount(account);
      });
    }

    function createProject(input) {
      var request = input || {};
      var name = cleanText(request.name, 120);
      if (name.length < 2) fail("INVALID_PROJECT_NAME", "Enter a project name.");
      if (request.acceptedTerms !== true) {
        fail("TERMS_REQUIRED", "Accept the Abracadabra product, privacy, and website terms to create this project.");
      }
      return mutate(function (snapshot) {
        var account = accountById(snapshot, request.accountId);
        var organization = requireOrganization(snapshot, account, request.organizationId);
        var address = normalizeAddress(request.address);
        assertHostnameAvailable(snapshot, address.hostname, null);
        var createdAt = now();
        var project = {
          id: idFactory("project"),
          accountId: request.accountId,
          organizationId: organization.id,
          name: name,
          lifecycle: "active",
          createdAt: createdAt,
          updatedAt: createdAt,
          terms: {
            product: TERMS.product,
            privacy: TERMS.privacy,
            website: TERMS.website,
            acceptedAt: createdAt
          },
          address: address,
          access: normalizeAccess(request.visibility || "public", request.accessPassword),
          plan: {
            id: PLAN_ID,
            status: "selected",
            selectedAt: createdAt,
            activatedAt: null,
            cancelledAt: null,
            activationScope: STORAGE_MODE,
            providerReference: null,
            paymentReceipt: null,
            subscriptionId: null
          },
          billing: {
            state: "current",
            authority: STORAGE_MODE,
            providerReference: null,
            paymentReceipt: null,
            subscriptionId: null,
            firstFailedAt: null,
            graceEndsAt: null,
            suspendedAt: null,
            retentionEndsAt: null,
            deletedAt: null
          },
          draft: null,
          versions: [],
          publicationAttempts: [],
          screeningAttempts: [],
          serving: {
            state: "unpublished",
            currentVersionId: null,
            previousVersionId: null,
            publishedAt: null,
            updatedAt: createdAt,
            resumeState: "unpublished"
          },
          safety: clearSafetyState(),
          safetyHistory: [],
          supportTicketIds: [],
          exit: {
            cancelledAt: null,
            domainDetachedAt: null
          }
        };
        snapshot.projects.push(project);
        return project;
      });
    }

    function listProjects(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        accountById(snapshot, request.accountId);
        var currentTime = now();
        return snapshot.projects.filter(function (item) {
          return item.accountId === request.accountId;
        }).map(function (project) {
          advanceProjectClock(project, currentTime);
          return project;
        });
      });
    }

    function getProject(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        advanceProjectClock(project, now());
        return project;
      });
    }

    function saveDraft(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project cannot accept draft changes.");
        project.draft = {
          rawFacts: clone(request.rawFacts || {}),
          updatedAt: now()
        };
        project.updatedAt = now();
        return project.draft;
      });
    }

    function saveVersion(input) {
      var request = input || {};
      var artifact = request.artifact || {};
      if (typeof artifact.html !== "string" || artifact.html.length < 64) {
        fail("INVALID_ARTIFACT", "A complete website artifact is required.");
      }
      var digest = String(artifact.digest || "").toLowerCase();
      if (!DIGEST.test(digest) || sha256(artifact.html) !== digest) {
        fail("INVALID_ARTIFACT", "The website artifact did not match its digest.");
      }
      var screening = screenRelease({ html: artifact.html, digest: digest }, request.releaseAttestation);
      var result = mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project cannot accept new versions.");
        var createdAt = now();
        var attempt = screeningAttempt("pre_acceptance", null, screening, createdAt);
        project.screeningAttempts.push(attempt);
        if (screening.state !== "passed") {
          project.updatedAt = createdAt;
          return { rejected: true, findings: screening.findings };
        }
        var rawFacts = clone(request.rawFacts || {});
        var duplicate = project.versions.find(function (item) {
          return item.artifact.digest === digest;
        });
        project.draft = {
          rawFacts: rawFacts,
          updatedAt: createdAt
        };
        if (
          duplicate
          && JSON.stringify(duplicate.rawFacts) === JSON.stringify(rawFacts)
        ) {
          attempt.versionId = duplicate.id;
          project.updatedAt = createdAt;
          return { rejected: false, version: duplicate };
        }
        var version = {
          id: idFactory("version"),
          createdAt: createdAt,
          updatedAt: createdAt,
          candidateState: "draft",
          rawFacts: rawFacts,
          releaseScreening: {
            state: screening.state,
            method: screening.method,
            artifactDigest: screening.artifactDigest,
            findings: clone(screening.findings),
            checkedAt: createdAt
          },
          artifact: {
            html: artifact.html,
            digest: digest
          }
        };
        attempt.versionId = version.id;
        project.versions.push(version);
        project.updatedAt = createdAt;
        return { rejected: false, version: version };
      });
      if (result.rejected) {
        fail("RELEASE_SCREENING_REJECTED", "The release screen rejected this version: " + result.findings.join(", ") + ".");
      }
      return frozenCopy(result.version);
    }

    function transitionVersion(input, expected, next) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") {
          fail("PROJECT_CLOSED", "This project cannot change release readiness.");
        }
        var version = project.versions.find(function (item) { return item.id === request.versionId; });
        if (!version) fail("VERSION_NOT_FOUND", "The website version was not found.");
        if (
          next === "accepted_release"
          && (!version.releaseScreening || version.releaseScreening.state !== "passed")
        ) {
          fail("RELEASE_SCREENING_REQUIRED", "This website version did not pass the release screen.");
        }
        if (!expected.includes(version.candidateState)) {
          fail("INVALID_VERSION_STATE", "That website version cannot make this transition.");
        }
        version.candidateState = next;
        version.updatedAt = now();
        return version;
      });
    }

    function activatePlan(input) {
      var request = input || {};
      if (request.localRehearsalAcknowledged !== true) {
        fail(
          "LOCAL_REHEARSAL_ACKNOWLEDGEMENT_REQUIRED",
          "Confirm that this plan activation changes only the non-transactional local rehearsal."
        );
      }
      if (
        request.operatorGrant
        || request.providerReference
        || request.paymentReceipt
        || request.subscriptionId
      ) {
        fail(
          "PROVIDER_AUTHORITY_FORBIDDEN",
          "The owner-side rehearsal cannot accept provider, payment, receipt, or subscription authority."
        );
      }
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project is closed.");
        if (project.plan.status === "active") {
          if (project.billing.state !== "current") {
            fail("BILLING_RESTORE_REQUIRED", "Plan activation cannot clear a billing failure.");
          }
          return project;
        }
        if (project.plan.status !== "selected") {
          fail("PLAN_ACTIVATION_REJECTED", "This project cannot activate that plan state.");
        }
        project.plan.status = "active";
        project.plan.activatedAt = project.plan.activatedAt || now();
        project.plan.cancelledAt = null;
        project.plan.activationScope = STORAGE_MODE;
        project.plan.providerReference = null;
        project.plan.paymentReceipt = null;
        project.plan.subscriptionId = null;
        project.billing = {
          state: "current",
          authority: STORAGE_MODE,
          providerReference: null,
          paymentReceipt: null,
          subscriptionId: null,
          firstFailedAt: null,
          graceEndsAt: null,
          suspendedAt: null,
          retentionEndsAt: null,
          deletedAt: null
        };
        project.serving.resumeState = project.serving.state === "live" ? "live" : "unpublished";
        project.updatedAt = now();
        return project;
      });
    }

    function completeAddress(input) {
      var request = input || {};
      var suppliedProof;
      var operator;
      if (request.proof) {
        suppliedProof = {
          method: cleanText(request.proof.method, 80),
          reference: cleanText(request.proof.reference, 200)
        };
      }
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project is closed.");
        if (!project.address || project.address.mode !== "mode_b") {
          fail("ADDRESS_ALREADY_CONFIGURED", "This address does not require outside domain verification.");
        }
        if (
          project.address.state === "detached"
          || !project.address.hostname
        ) {
          fail("DOMAIN_DETACHED", "Reconnect the customer-owned domain before verification.");
        }
        if (!["order_pending", "connection_pending"].includes(project.address.state)) {
          fail("ADDRESS_ALREADY_CONFIGURED", "This address does not require outside domain verification.");
        }
        operator = requireDomainOperator(request);
        var requests = Array.isArray(project.address.verificationRequests)
          ? project.address.verificationRequests
          : [];
        var savedRequest = request.proofRequestId
          ? requests.find(function (item) { return item.id === request.proofRequestId; })
          : requests.slice().reverse().find(function (item) { return item.state === "pending_review"; });
        var verification = suppliedProof || (savedRequest ? {
          method: savedRequest.method,
          reference: savedRequest.reference
        } : null);
        if (!verification || verification.method.length < 3 || verification.reference.length < 6) {
          fail("DOMAIN_PROOF_REQUIRED", "Add the reviewed registrar or DNS verification reference.");
        }
        if (request.proofRequestId && (!savedRequest || savedRequest.state !== "pending_review")) {
          fail("DOMAIN_PROOF_REQUEST_NOT_AVAILABLE", "That domain-proof handoff is not pending review.");
        }
        project.address.state = "configured";
        project.address.verification = {
          method: verification.method,
          reference: verification.reference,
          verifiedAt: now(),
          operatorId: operator.operatorId,
          requestId: savedRequest ? savedRequest.id : null
        };
        if (savedRequest) {
          savedRequest.state = "approved";
          savedRequest.reviewedAt = project.address.verification.verifiedAt;
          savedRequest.operatorId = operator.operatorId;
        }
        project.updatedAt = now();
        return project.address;
      });
    }

    function requestAddressVerification(input) {
      var request = input || {};
      var method = cleanText(request.method, 80);
      var reference = cleanText(request.reference, 200);
      if (!["registrar_receipt", "dns_challenge"].includes(method)) {
        fail("INVALID_DOMAIN_PROOF_METHOD", "Choose a registrar receipt or DNS challenge.");
      }
      if (reference.length < 6) {
        fail("DOMAIN_PROOF_REQUIRED", "Add the registrar receipt or DNS verification reference.");
      }
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project is closed.");
        if (!project.address || project.address.mode !== "mode_b") {
          fail("DOMAIN_PROOF_NOT_AVAILABLE", "This project does not use a customer-owned domain.");
        }
        if (
          project.address.state === "detached"
          || !project.address.hostname
        ) {
          fail("DOMAIN_DETACHED", "Reconnect the customer-owned domain before preparing proof.");
        }
        if (!["order_pending", "connection_pending"].includes(project.address.state)) {
          fail("ADDRESS_ALREADY_CONFIGURED", "This address does not require outside domain verification.");
        }
        var requestedAt = now();
        var requests = Array.isArray(project.address.verificationRequests)
          ? project.address.verificationRequests
          : [];
        requests.forEach(function (item) {
          if (item.state !== "pending_review") return;
          item.state = "superseded";
          item.supersededAt = requestedAt;
        });
        var proofRequest = {
          id: idFactory("domain_proof"),
          method: method,
          reference: reference,
          state: "pending_review",
          requestedAt: requestedAt,
          reviewedAt: null,
          operatorId: null,
          supersededAt: null
        };
        requests.push(proofRequest);
        project.address.verificationRequests = requests;
        project.updatedAt = requestedAt;
        return proofRequest;
      });
    }

    function setAddress(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project is closed.");
        var address = normalizeAddress(request.address);
        assertHostnameAvailable(snapshot, address.hostname, project.id);
        project.address = address;
        if (project.serving.state === "live") project.serving.state = "unpublished";
        project.updatedAt = now();
        return project.address;
      });
    }

    function setVisibility(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active") fail("PROJECT_CLOSED", "This project is closed.");
        project.access = normalizeAccess(request.visibility, request.accessPassword);
        project.updatedAt = now();
        return project.access;
      });
    }

    function placeSafetyHold(input) {
      var request = input || {};
      var operator = requireSafetyOperator(request);
      var reason = cleanText(request.reason, 500);
      if (reason.length < 8) fail("INVALID_SAFETY_REASON", "State the reason for the safety hold.");
      var heldAt = request.at ? iso(request.at) : now();
      return mutate(function (snapshot) {
        var project = projectById(snapshot, request.projectId);
        if (project.lifecycle === "deleted") fail("PROJECT_DELETED", "This project is deleted.");
        if (project.safety.state === "clear") {
          project.safety.previousServingState = project.serving.state;
        }
        project.safety.state = "held";
        project.safety.reason = reason;
        project.safety.heldAt = heldAt;
        project.safety.heldBy = operator.operatorId;
        project.safety.appealMessage = null;
        project.safety.appealedAt = null;
        project.safety.restoredAt = null;
        project.safety.restoredBy = null;
        project.serving.state = "dark";
        project.serving.updatedAt = heldAt;
        project.updatedAt = heldAt;
        project.safetyHistory.push({
          id: idFactory("safety_event"),
          kind: "hold",
          at: heldAt,
          operatorId: operator.operatorId,
          reason: reason,
          previousServingState: project.safety.previousServingState
        });
        return project.safety;
      });
    }

    function submitSafetyAppeal(input) {
      var request = input || {};
      var message = String(request.message == null ? "" : request.message).trim().slice(0, 4000);
      if (message.length < 20) {
        fail("INVALID_SAFETY_APPEAL", "Explain the issue and why the website should be restored.");
      }
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (!["held", "appeal_pending"].includes(project.safety.state)) {
          fail("SAFETY_APPEAL_NOT_AVAILABLE", "This project does not have an active safety hold.");
        }
        project.safety.state = "appeal_pending";
        project.safety.appealMessage = message;
        project.safety.appealedAt = now();
        project.updatedAt = now();
        project.safetyHistory.push({
          id: idFactory("safety_event"),
          kind: "appeal",
          at: project.safety.appealedAt,
          accountId: request.accountId,
          message: message
        });
        return project.safety;
      });
    }

    function restoreSafetyHold(input) {
      var request = input || {};
      var operator = requireSafetyOperator(request);
      return mutate(function (snapshot) {
        var project = projectById(snapshot, request.projectId);
        if (!["held", "appeal_pending"].includes(project.safety.state)) {
          fail("SAFETY_RESTORE_NOT_AVAILABLE", "This project does not have an active safety hold.");
        }
        var restoredAt = request.at ? iso(request.at) : now();
        var wasLive = project.safety.previousServingState === "live";
        project.safety = clearSafetyState();
        project.safety.restoredAt = restoredAt;
        project.safety.restoredBy = operator.operatorId;
        project.serving.state = (
          wasLive
          && project.lifecycle === "active"
          && project.plan.status === "active"
          && ["current", "grace"].includes(project.billing.state)
          && Boolean(project.serving.currentVersionId)
        ) ? "live" : "unpublished";
        project.serving.updatedAt = restoredAt;
        project.updatedAt = restoredAt;
        project.safetyHistory.push({
          id: idFactory("safety_event"),
          kind: "restore",
          at: restoredAt,
          operatorId: operator.operatorId,
          servingState: project.serving.state
        });
        return project.safety;
      });
    }

    function publish(input) {
      var request = input || {};
      var result = mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        var attempt = {
          id: idFactory("publish"),
          versionId: request.versionId,
          requestedAt: now(),
          outcome: "rejected",
          reason: null
        };
        project.publicationAttempts.push(attempt);
        if (project.lifecycle !== "active") attempt.reason = "project_closed";
        else if (project.safety.state !== "clear") attempt.reason = "safety_hold";
        else if (project.plan.status !== "active") attempt.reason = "plan_inactive";
        else if (!["current", "grace"].includes(project.billing.state)) attempt.reason = "billing_not_serving";
        else if (!project.address || project.address.state !== "configured") attempt.reason = "address_not_configured";
        var version = project.versions.find(function (item) { return item.id === request.versionId; });
        if (!attempt.reason && !version) attempt.reason = "version_missing";
        if (!attempt.reason && version.candidateState !== "accepted_release") attempt.reason = "version_not_accepted";
        if (!attempt.reason) {
          var releaseScreen = screenRelease(version.artifact, true);
          project.screeningAttempts.push(
            screeningAttempt("pre_publication", version.id, releaseScreen, attempt.requestedAt)
          );
          if (releaseScreen.state !== "passed") attempt.reason = "release_screening";
        }
        if (attempt.reason) {
          project.updatedAt = attempt.requestedAt;
          return { rejected: true, reason: attempt.reason };
        }
        attempt.outcome = "published";
        if (project.serving.currentVersionId !== version.id) {
          project.serving.previousVersionId = project.serving.currentVersionId;
          project.serving.currentVersionId = version.id;
        }
        project.serving.state = "live";
        project.serving.publishedAt = now();
        project.serving.updatedAt = now();
        project.updatedAt = now();
        project.serving.resumeState = "live";
        return { rejected: false, value: { attempt: attempt, project: project } };
      });
      if (result.rejected) {
        fail("PUBLISH_REJECTED", "Publish was rejected: " + result.reason.replace(/_/gu, " ") + ".");
      }
      return frozenCopy(result.value);
    }

    function unpublish(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle === "deleted") fail("PROJECT_DELETED", "This project is deleted.");
        project.serving.state = "unpublished";
        project.serving.resumeState = "unpublished";
        project.serving.updatedAt = now();
        project.updatedAt = now();
        return project.serving;
      });
    }

    function recordPaymentFailure(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle !== "active" || project.plan.status !== "active") {
          fail("BILLING_NOT_ACTIVE", "This project does not have an active plan.");
        }
        if (project.billing.state === "current") {
          var failedAt = request.at ? iso(request.at) : now();
          project.billing.state = "grace";
          project.billing.firstFailedAt = failedAt;
          project.billing.graceEndsAt = addDays(failedAt, GRACE_DAYS);
        }
        project.updatedAt = now();
        return project.billing;
      });
    }

    function advanceProjectClock(project, at) {
      var atTime = new Date(at).getTime();
      if (
        project.lifecycle !== "deleted"
        && project.billing.state === "grace"
        && project.billing.graceEndsAt
        && atTime >= new Date(project.billing.graceEndsAt).getTime()
      ) {
        project.billing.state = "suspended";
        project.billing.suspendedAt = project.billing.graceEndsAt;
        project.billing.retentionEndsAt = addDays(project.billing.suspendedAt, RETENTION_DAYS);
        project.serving.resumeState = project.serving.state === "live" ? "live" : "unpublished";
        project.serving.state = "dark";
        project.serving.updatedAt = at;
        project.updatedAt = at;
      }
      if (
        project.lifecycle !== "deleted"
        && ["suspended", "retention"].includes(project.billing.state)
        && project.billing.retentionEndsAt
        && atTime >= new Date(project.billing.retentionEndsAt).getTime()
      ) {
        terminalDelete(project, at);
      }
      return project;
    }

    function advanceBilling(input) {
      var request = input || {};
      var at = request.at ? iso(request.at) : now();
      return mutate(function (snapshot) {
        accountById(snapshot, request.accountId);
        var projects = request.projectId
          ? [requireOwner(snapshot, request.projectId, request.accountId)]
          : snapshot.projects.filter(function (project) {
            return project.accountId === request.accountId;
          });
        projects.forEach(function (project) {
          advanceProjectClock(project, at);
        });
        return projects;
      });
    }

    function restoreService(input) {
      var request = input || {};
      var operator = requireBillingOperator(request);
      var restorationReference = cleanText(request.reference, 200);
      if (restorationReference.length < 6) {
        fail("BILLING_PROOF_REQUIRED", "Add the verified billing event reference.");
      }
      var result = mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        var currentTime = now();
        advanceProjectClock(project, currentTime);
        if (project.lifecycle === "deleted" || project.billing.state === "deleted") {
          return { expired: true };
        }
        if (!["grace", "suspended", "retention"].includes(project.billing.state)) {
          fail("RESTORE_NOT_AVAILABLE", "This project is not in a restorable billing state.");
        }
        var resumeState = project.serving.resumeState === "live" ? "live" : "unpublished";
        project.lifecycle = "active";
        project.plan.status = "active";
        project.plan.cancelledAt = null;
        project.billing = {
          state: "current",
          authority: STORAGE_MODE,
          providerReference: null,
          paymentReceipt: null,
          subscriptionId: null,
          firstFailedAt: null,
          graceEndsAt: null,
          suspendedAt: null,
          retentionEndsAt: null,
          deletedAt: null
        };
        project.serving.state = project.safety.state !== "clear"
          ? "dark"
          : (resumeState === "live" && project.serving.currentVersionId ? "live" : "unpublished");
        project.serving.resumeState = resumeState;
        project.serving.updatedAt = currentTime;
        project.updatedAt = currentTime;
        project.billingRestoration = {
          restoredAt: currentTime,
          operatorId: operator.operatorId,
          reference: restorationReference,
          evidenceScope: STORAGE_MODE,
          providerEvent: false
        };
        return { expired: false, project: project };
      });
      if (result.expired) {
        fail("RESTORE_NOT_AVAILABLE", "The retention period has ended and the project was deleted.");
      }
      return frozenCopy(result.project);
    }

    function cancelProject(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle === "deleted") fail("PROJECT_DELETED", "This project is deleted.");
        if (project.lifecycle === "cancelled") return project;
        var cancelledAt = now();
        var proposedRetentionEnd = addDays(cancelledAt, RETENTION_DAYS);
        var existingRetentionEnd = project.billing.retentionEndsAt;
        project.lifecycle = "cancelled";
        project.plan.status = "cancelled";
        project.plan.cancelledAt = cancelledAt;
        project.exit.cancelledAt = cancelledAt;
        project.billing.state = "retention";
        project.billing.suspendedAt = project.billing.suspendedAt || cancelledAt;
        project.billing.retentionEndsAt = (
          existingRetentionEnd
          && new Date(existingRetentionEnd).getTime() < new Date(proposedRetentionEnd).getTime()
        ) ? existingRetentionEnd : proposedRetentionEnd;
        project.serving.resumeState = project.serving.state === "live" ? "live" : "unpublished";
        project.serving.state = "dark";
        project.serving.updatedAt = cancelledAt;
        project.updatedAt = cancelledAt;
        return project;
      });
    }

    function detachCustomerDomain(project, at) {
      if (!project.address || project.address.mode !== "mode_b" || project.address.ownership !== "customer") {
        fail("DOMAIN_DETACH_NOT_AVAILABLE", "This project does not use a customer-owned domain.");
      }
      if (project.address.state === "detached") return project.address;
      project.address.hostname = null;
      project.address.state = "detached";
      project.address.detachedAt = at;
      project.exit.domainDetachedAt = at;
      if (project.serving.state === "live") project.serving.state = "unpublished";
      project.serving.resumeState = "unpublished";
      project.serving.updatedAt = at;
      project.updatedAt = at;
      return project.address;
    }

    function detachDomain(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle === "deleted") {
          fail("PROJECT_DELETED", "This project is deleted.");
        }
        return detachCustomerDomain(project, now());
      });
    }

    function terminalDelete(project, at) {
      if (
        project.address
        && project.address.mode === "mode_b"
        && project.address.ownership === "customer"
        && project.address.state !== "detached"
      ) {
        detachCustomerDomain(project, at);
      }
      project.lifecycle = "deleted";
      project.plan.status = "cancelled";
      project.billing.state = "deleted";
      project.billing.deletedAt = at;
      project.serving = {
        state: "deleted",
        currentVersionId: null,
        previousVersionId: null,
        publishedAt: null,
        updatedAt: at,
        resumeState: "unpublished"
      };
      project.access = { visibility: "public", credential: null };
      project.draft = null;
      project.versions = [];
      project.updatedAt = at;
    }

    function deleteProject(input) {
      var request = input || {};
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        terminalDelete(project, now());
        return project;
      });
    }

    function exportProject(input) {
      var request = input || {};
      var result = mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        var exportedAt = now();
        advanceProjectClock(project, exportedAt);
        if (project.lifecycle === "deleted" || project.billing.state === "deleted") {
          return { notAvailable: true };
        }
        var currentVersion = project.versions.find(function (item) {
          return item.id === project.serving.currentVersionId;
        }) || project.versions[project.versions.length - 1] || null;
        var payload = {
          schema: "sitesourcery.abracadabra.export/v2",
          exportedAt: exportedAt,
          project: {
            id: project.id,
            organizationId: project.organizationId,
            name: project.name,
            lifecycle: project.lifecycle,
            terms: project.terms,
            address: project.address,
            access: { visibility: project.access.visibility },
            plan: project.plan,
            billing: project.billing,
            serving: project.serving,
            safety: project.safety,
            safetyHistory: project.safetyHistory,
            exit: project.exit,
            billingRestoration: project.billingRestoration || null
          },
          draft: project.draft,
          versions: clone(project.versions),
          version: currentVersion,
          publicationAttempts: clone(project.publicationAttempts),
          screeningAttempts: clone(project.screeningAttempts),
          supportTickets: snapshot.supportTickets.filter(function (ticket) {
            return ticket.accountId === request.accountId && ticket.projectId === project.id;
          }),
          source: {
            selfContainedArtifacts: true,
            assets: []
          }
        };
        payload.receipt = {
          schema: "sitesourcery.abracadabra.export-receipt/v1",
          id: idFactory("export"),
          projectId: project.id,
          accountId: request.accountId,
          exportedAt: exportedAt,
          authorityScope: STORAGE_MODE,
          hostedReady: false,
          providerEvent: false,
          storeRevision: snapshot.revision,
          versionCount: project.versions.length,
          draftIncluded: Boolean(project.draft),
          manifestDigest: sha256(JSON.stringify(payload))
        };
        return { notAvailable: false, payload: payload };
      });
      if (result.notAvailable) {
        fail("EXPORT_NOT_AVAILABLE", "Deleted project content is not available for export.");
      }
      return frozenCopy(result.payload);
    }

    function createSupportTicket(input) {
      var request = input || {};
      var subject = cleanText(request.subject, 120);
      var message = String(request.message == null ? "" : request.message).trim().slice(0, 4000);
      if (subject.length < 3 || message.length < 10) {
        fail("INVALID_SUPPORT_TICKET", "Add a short subject and enough detail to understand the request.");
      }
      return mutate(function (snapshot) {
        var project = requireOwner(snapshot, request.projectId, request.accountId);
        if (project.lifecycle === "deleted") fail("PROJECT_DELETED", "Deleted projects cannot open support tickets.");
        var ticket = {
          id: idFactory("ticket"),
          accountId: request.accountId,
          projectId: project.id,
          subject: subject,
          message: message,
          state: "open",
          createdAt: now(),
          updatedAt: now()
        };
        snapshot.supportTickets.push(ticket);
        project.supportTicketIds.push(ticket.id);
        return ticket;
      });
    }

    function listSupportTickets(input) {
      var request = input || {};
      var snapshot = read();
      requireOwner(snapshot, request.projectId, request.accountId);
      return frozenCopy(snapshot.supportTickets.filter(function (item) {
        return item.projectId === request.projectId && item.accountId === request.accountId;
      }));
    }

    function resolveSite(input) {
      var request = input || {};
      var hostname = cleanHostname(request.hostname);
      var result = mutate(function (snapshot) {
        var project = snapshot.projects.find(function (item) {
          return item.address && item.address.hostname === hostname;
        });
        if (!project) return { error: "SITE_NOT_FOUND" };
        advanceProjectClock(project, now());
        if (
          project.lifecycle !== "active"
          || project.serving.state !== "live"
          || !["current", "grace"].includes(project.billing.state)
        ) {
          return { error: "SITE_NOT_SERVING" };
        }
        if (
          project.access.visibility === "private"
          && !passwordMatches(request.accessPassword, project.access.credential)
        ) {
          return { error: "ACCESS_DENIED" };
        }
        var version = project.versions.find(function (item) {
          return item.id === project.serving.currentVersionId;
        });
        if (
          !version
          || version.candidateState !== "accepted_release"
          || !DIGEST.test(version.artifact.digest)
          || sha256(version.artifact.html) !== version.artifact.digest
        ) {
          return { error: "SITE_NOT_SERVING" };
        }
        return {
          value: {
            projectId: project.id,
            hostname: project.address.hostname,
            visibility: project.access.visibility,
            versionId: version.id,
            artifactDigest: version.artifact.digest,
            html: version.artifact.html
          }
        };
      });
      if (result.error === "SITE_NOT_FOUND") {
        fail("SITE_NOT_FOUND", "The website was not found.");
      }
      if (result.error === "ACCESS_DENIED") {
        fail("ACCESS_DENIED", "The passphrase did not open this website.");
      }
      if (result.error) {
        fail("SITE_NOT_SERVING", "The website is not currently being served.");
      }
      return frozenCopy(result.value);
    }

    return freeze({
      activatePlan: activatePlan,
      acceptVersion: function (input) { return transitionVersion(input, ["ready"], "accepted_release"); },
      advanceBilling: advanceBilling,
      cancelProject: cancelProject,
      completeAddress: completeAddress,
      createAccount: createAccount,
      createProject: createProject,
      createSupportTicket: createSupportTicket,
      deleteProject: deleteProject,
      detachDomain: detachDomain,
      exportProject: exportProject,
      getAccount: getAccount,
      getProject: getProject,
      listMail: listMail,
      listOrganizations: listOrganizations,
      listProjects: listProjects,
      listSupportTickets: listSupportTickets,
      markVersionReady: function (input) { return transitionVersion(input, ["draft"], "ready"); },
      openBillingOperatorSession: openBillingOperatorSession,
      openDomainOperatorSession: openDomainOperatorSession,
      openSafetyOperatorSession: openSafetyOperatorSession,
      placeSafetyHold: placeSafetyHold,
      publish: publish,
      readLocalMail: readLocalMail,
      recordPaymentFailure: recordPaymentFailure,
      requestAddressVerification: requestAddressVerification,
      requestRecovery: requestRecovery,
      resetPassword: resetPassword,
      resolveSite: resolveSite,
      restoreSafetyHold: restoreSafetyHold,
      restoreService: restoreService,
      saveDraft: saveDraft,
      saveVersion: saveVersion,
      setAddress: setAddress,
      setVisibility: setVisibility,
      signIn: signIn,
      submitSafetyAppeal: submitSafetyAppeal,
      unpublish: unpublish,
      concurrencyPolicy: CONCURRENCY_POLICY,
      storageMode: STORAGE_MODE
    });
  }

  return freeze({
    BILLING: freeze({
      graceDays: GRACE_DAYS,
      retentionDays: RETENTION_DAYS
    }),
    PLAN_ID: PLAN_ID,
    CREDENTIAL_ROUNDS: CREDENTIAL_ROUNDS,
    TERMS: TERMS,
    STORE_KEY: STORE_KEY,
    STORE_SCHEMA: STORE_SCHEMA,
    CONCURRENCY_POLICY: CONCURRENCY_POLICY,
    STORAGE_MODE: STORAGE_MODE,
    PlatformError: PlatformError,
    createMemoryStorage: memoryStorage,
    createPlatform: createPlatform,
    sha256: sha256
  });
}));
