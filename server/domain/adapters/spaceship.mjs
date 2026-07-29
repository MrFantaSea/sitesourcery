import { isIP } from "node:net";
import { digest, normalizeDomain } from "../canonical.mjs";
import { ExternalEffectError, invariant } from "../errors.mjs";
import { createHeldExternalPorts } from "./held.mjs";

export const SPACESHIP_API_ORIGIN = "https://spaceship.dev";
export const SPACESHIP_API_PREFIX = "/api/v1";
export const SPACESHIP_ASYNC_OPERATION_HEADER = "spaceship-async-operationid";
export const SPACESHIP_MCP_PREVIEW_SOURCE =
  "spaceship-mcp.domain_register.preview/2026-07-22";

const CONTACT_ROLES = Object.freeze(["registrant", "admin", "tech", "billing"]);
const CONTACT_ID = /^[a-zA-Z0-9]{27,32}$/u;
const OPERATION_ID = /^[a-zA-Z0-9]{1,36}$/u;
const OPERATION_STATUSES = new Set(["pending", "success", "failed"]);
const AVAILABILITY_RESULTS = new Set([
  "available",
  "taken",
  "invalidDomainName",
  "tldNotSupported",
  "unexpectedError"
]);
const DOMAIN_LIFECYCLE_STATUSES = new Set([
  "creating",
  "registered",
  "grace1",
  "grace2",
  "redemption"
]);
const TRANSFER_BLOCKING_STATUSES = new Set([
  "clientHold",
  "serverHold",
  "pendingDelete",
  "pendingTransfer",
  "redemptionPeriod",
  "serverTransferProhibited"
]);
const REQUIRED_VAULT_METHODS = Object.freeze([
  "readProviderCredentials",
  "readRegistrantProfile",
  "claimProviderContact",
  "completeProviderContact",
  "releaseProviderContactClaim",
  "markProviderContactUnknown"
]);
const SAFE_LIVE_ENVIRONMENTS = new Set(["staging", "production"]);

const DEFAULTS = Object.freeze({
  timeoutMs: 8_000,
  maxBodyBytes: 64 * 1024,
  previewMaxAgeMs: 30_000,
  previewFutureSkewMs: 5_000
});

/**
 * Creates the concrete Spaceship registrar adapter.
 *
 * The default is deliberately held. Contract tests must inject a non-network
 * fetch implementation and opt in with `testOnly: true`. Live construction
 * requires an explicit, environment-bound approval object; this repository
 * never constructs that object.
 */
export function createSpaceshipRegistrarAdapter(options = {}) {
  const mode = options.mode ?? "held";
  if (mode === "held") return createHeldExternalPorts().registrar;

  invariant(
    mode === "contract_test" || mode === "approved_live",
    "spaceship_mode_invalid",
    "Spaceship mode must be held, contract_test, or approved_live",
    { status: 500 }
  );

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (mode === "contract_test") {
    invariant(
      options.testOnly === true && typeof options.fetchImpl === "function",
      "spaceship_test_mode_invalid",
      "Spaceship contract_test mode requires an injected mock fetch and testOnly=true",
      { status: 500 }
    );
    invariant(
      options.fetchImpl !== globalThis.fetch,
      "spaceship_test_mode_network_forbidden",
      "Spaceship contract_test mode cannot use the process network fetch",
      { status: 500 }
    );
  } else {
    validateLiveApproval(options.liveApproval);
  }

  invariant(typeof fetchImpl === "function", "spaceship_fetch_missing", "fetch is required", {
    status: 500
  });
  const clock = validateClock(options.clock);
  const vault = validateVault(options.vault);
  const pricePreview = validatePricePreview(options.pricePreview);
  const config = validateConfig({ ...DEFAULTS, ...options.config });
  const eventSink = typeof options.eventSink === "function" ? options.eventSink : () => {};
  const liveCapabilities =
    mode === "approved_live" ? new Set(options.liveApproval.capabilities) : null;

  const transport = createTransport({
    fetchImpl,
    clock,
    vault,
    config,
    eventSink
  });

  function requireCapability(capability) {
    if (liveCapabilities === null) return;
    invariant(
      liveCapabilities.has(capability),
      "spaceship_capability_not_approved",
      `Spaceship live capability ${capability} is not approved`,
      { status: 500 }
    );
  }

  async function readContact(contactId) {
    const id = normalizeContactId(contactId);
    const response = await transport.request({
      method: "GET",
      path: `${SPACESHIP_API_PREFIX}/contacts/${id}`,
      effect: "read",
      successStatuses: [200],
      responseKind: "json"
    });
    return normalizeContact(response);
  }

  async function readDomain(domain) {
    requireCapability("domains:read");
    const name = normalizeDomain(domain);
    const response = await transport.request({
      method: "GET",
      path: `${SPACESHIP_API_PREFIX}/domains/${name}`,
      effect: "read",
      successStatuses: [200],
      responseKind: "json"
    });
    return normalizeDomainReadback(response, name);
  }

  async function listDnsRecordsPage({ domain, take = 500, skip = 0, orderBy } = {}) {
    requireCapability("dnsrecords:read");
    const name = normalizeDomain(domain);
    const size = integer(take, "take", 1, 500);
    const offset = integer(skip, "skip", 0, 2_147_483_647);
    invariant(
      orderBy === undefined || ["type", "-type", "name", "-name"].includes(orderBy),
      "spaceship_dns_order_invalid",
      "DNS record ordering is invalid",
      { status: 400 }
    );
    const query = new URLSearchParams({
      take: String(size),
      skip: String(offset)
    });
    if (orderBy) query.set("orderBy", orderBy);
    const response = await transport.request({
      method: "GET",
      path: `${SPACESHIP_API_PREFIX}/dns/records/${name}?${query}`,
      effect: "read",
      successStatuses: [200],
      responseKind: "json"
    });
    invariant(
      Array.isArray(response?.items) &&
        Number.isSafeInteger(response?.total) &&
        response.total >= 0,
      "spaceship_dns_response_invalid",
      "Spaceship returned an invalid DNS record list",
      { status: 502 }
    );
    return {
      items: response.items.map(normalizeDnsReadbackRecord),
      total: response.total
    };
  }

  const registrar = {
    async ensureContacts({
      tenantId,
      customerId,
      registrantProfileRef,
      registrantProfileDigest
    } = {}) {
      requireCapability("contacts:write");
      requireCapability("contacts:read");
      const scope = {
        tenantId: opaque(tenantId, "tenantId", 128),
        customerId: opaque(customerId, "customerId", 128),
        profileRef: opaque(registrantProfileRef, "registrantProfileRef", 256),
        profileDigest: opaque(registrantProfileDigest, "registrantProfileDigest", 128)
      };
      let profile;
      try {
        profile = await vault.readRegistrantProfile({
          tenantId: scope.tenantId,
          customerId: scope.customerId,
          reference: scope.profileRef
        });
      } catch {
        throw external(
          "spaceship_contact_vault_unavailable",
          "Registrant contact data is unavailable from the encrypted vault",
          "not_submitted"
        );
      }
      invariant(
        profile?.digest === scope.profileDigest,
        "spaceship_contact_profile_changed",
        "Registrant contact evidence no longer matches the encrypted profile",
        { status: 409 }
      );
      invariant(
        profile.roles && typeof profile.roles === "object",
        "spaceship_contact_profile_invalid",
        "Registrant contact roles are missing from the encrypted profile",
        { status: 409 }
      );

      const result = {};
      for (const role of CONTACT_ROLES) {
        const contact = normalizeContact(profile.roles[role] ?? profile.roles.registrant);
        const fingerprint = digest(contact);
        let claim;
        try {
          claim = await vault.claimProviderContact({
            provider: "spaceship",
            tenantId: scope.tenantId,
            customerId: scope.customerId,
            profileDigest: scope.profileDigest,
            contactFingerprint: fingerprint,
            role
          });
        } catch {
          throw external(
            "spaceship_contact_claim_unavailable",
            "Provider contact claim state is unavailable",
            "not_submitted"
          );
        }

        if (claim?.state === "ready") {
          const contactId = normalizeContactId(claim.contactId);
          const readback = await readContact(contactId);
          invariant(
            contactsEqual(contact, readback),
            "spaceship_contact_readback_mismatch",
            "Saved registrar contact does not match the encrypted customer profile",
            { status: 409 }
          );
          result[role] = contactId;
          continue;
        }

        if (claim?.state === "pending" || claim?.state === "unknown") {
          throw external(
            "spaceship_contact_effect_unknown",
            "A prior registrar contact save must be reconciled before another attempt",
            "ambiguous"
          );
        }

        invariant(
          claim?.state === "claimed" &&
            typeof claim.claimId === "string" &&
            claim.claimId.length > 0 &&
            claim.claimId.length <= 256,
          "spaceship_contact_claim_invalid",
          "Provider contact claim state is invalid",
          { status: 500 }
        );

        let contactId;
        let saveAccepted = false;
        try {
          const saved = await transport.request({
            method: "PUT",
            path: `${SPACESHIP_API_PREFIX}/contacts`,
            body: contactRequest(contact),
            effect: "mutation",
            successStatuses: [200],
            responseKind: "json"
          });
          saveAccepted = true;
          contactId = normalizeContactId(saved?.contactId, {
            effectCertainty: "ambiguous"
          });
          const readback = await readContact(contactId);
          if (!contactsEqual(contact, readback)) {
            throw external(
              "spaceship_contact_readback_mismatch",
              "Saved registrar contact did not read back exactly",
              "ambiguous"
            );
          }
          await vault.completeProviderContact({
            provider: "spaceship",
            claimId: claim.claimId,
            contactId
          });
        } catch (error) {
          if (
            saveAccepted === false &&
            error instanceof ExternalEffectError &&
            error.certainty === "not_submitted"
          ) {
            await safelyCall(() =>
              vault.releaseProviderContactClaim({
                provider: "spaceship",
                claimId: claim.claimId
              })
            );
            throw error;
          }
          await safelyCall(() =>
            vault.markProviderContactUnknown({
              provider: "spaceship",
              claimId: claim.claimId
            })
          );
          throw external(
            "spaceship_contact_effect_unknown",
            "Registrar contact save or readback is ambiguous; do not retry automatically",
            "ambiguous"
          );
        }
        result[role] = contactId;
      }

      const attributes = profile.attributeContactIds;
      if (attributes !== undefined && attributes !== null) {
        invariant(
          Array.isArray(attributes) && attributes.length <= 5,
          "spaceship_contact_attributes_invalid",
          "Registrar contact attributes are invalid",
          { status: 409 }
        );
        result.attributes = attributes.map((value) => normalizeContactId(value));
      }
      return Object.freeze(result);
    },

    async previewRegistration({
      tenantId,
      domain,
      years,
      autoRenew,
      privacy,
      contacts
    } = {}) {
      requireCapability("domains:read");
      const name = normalizeDomain(domain);
      const period = integer(years, "years", 1, 10);
      validateRegistrationOptions({ autoRenew, privacy, contacts });
      const availability = await transport.request({
        method: "GET",
        path: `${SPACESHIP_API_PREFIX}/domains/${name}/available`,
        effect: "read",
        successStatuses: [200],
        responseKind: "json"
      });
      invariant(
        normalizeDomain(availability?.domain) === name &&
          AVAILABILITY_RESULTS.has(availability?.result),
        "spaceship_availability_response_invalid",
        "Spaceship returned invalid availability data",
        { status: 502 }
      );
      if (availability.result !== "available") {
        return Object.freeze({
          status: "unavailable",
          domain: name,
          reason: availability.result
        });
      }

      let preview;
      try {
        preview = await pricePreview.previewRegistration({
          tenantId: opaque(tenantId, "tenantId", 128),
          domain: name,
          years: period,
          autoRenew,
          privacy: structuredClone(privacy),
          contacts: structuredClone(contacts)
        });
      } catch (error) {
        if (error instanceof ExternalEffectError) throw error;
        throw external(
          "spaceship_price_preview_unavailable",
          "A documented no-charge Spaceship price preview is unavailable",
          "not_submitted"
        );
      }
      const normalized = validateExactPreview(preview, {
        domain: name,
        years: period,
        nowMs: clockNowMs(clock),
        config
      });
      return Object.freeze({
        status: "confirmation_required",
        domain: name,
        price: normalized.price,
        quoteId: normalized.evidenceId,
        observedAt: normalized.observedAt,
        priceSource: SPACESHIP_MCP_PREVIEW_SOURCE,
        noCharge: true
      });
    },

    async confirmRegistration({
      domain,
      years,
      autoRenew,
      privacy,
      contacts,
      expectedPrice
    } = {}) {
      requireCapability("domains:billing");
      const name = normalizeDomain(domain);
      const period = integer(years, "years", 1, 10);
      validateRegistrationOptions({ autoRenew, privacy, contacts });
      validateExpectedPrice(expectedPrice);
      const response = await transport.request({
        method: "POST",
        path: `${SPACESHIP_API_PREFIX}/domains/${name}`,
        body: {
          autoRenew,
          years: period,
          privacyProtection: {
            level: privacy.level,
            userConsent: privacy.userConsent
          },
          contacts: normalizeContactIds(contacts)
        },
        effect: "irreversible",
        successStatuses: [202],
        responseKind: "optional_json",
        asyncOperationHeaderRequired: true
      });
      return Object.freeze({
        operationId: response.operationId,
        // The ordinary API's 202 contract does not return the final charge.
        // Never echo expectedPrice as provider-observed money.
        price: null
      });
    },

    async getOperation({ operationId } = {}) {
      requireCapability("asyncoperations:read");
      const id = normalizeOperationId(operationId);
      const response = await transport.request({
        method: "GET",
        path: `${SPACESHIP_API_PREFIX}/async-operations/${id}`,
        effect: "read",
        successStatuses: [200],
        responseKind: "json"
      });
      invariant(
        OPERATION_STATUSES.has(response?.status),
        "spaceship_operation_response_invalid",
        "Spaceship returned an invalid async operation status",
        { status: 502 }
      );
      return Object.freeze({
        status: response.status,
        type: nullableString(response.type, 128),
        details: response.details === undefined ? null : structuredClone(response.details),
        createdAt: nullableIso(response.createdAt),
        modifiedAt: nullableIso(response.modifiedAt)
      });
    },

    async getDomain({ domain } = {}) {
      return readDomain(domain);
    },

    async assessTransferOut({ domain, registrationDate } = {}) {
      requireCapability("domains:read");
      const item = await readDomain(domain);
      if (item.lifecycleStatus !== "registered") {
        return Object.freeze({
          eligible: false,
          reason: `lifecycle_${item.lifecycleStatus}`
        });
      }
      if (item.suspensions.length > 0) {
        return Object.freeze({ eligible: false, reason: "domain_suspended" });
      }
      const blocking = item.eppStatuses.find((status) =>
        TRANSFER_BLOCKING_STATUSES.has(status)
      );
      if (blocking) {
        return Object.freeze({ eligible: false, reason: `epp_${blocking}` });
      }
      if (registrationDate !== undefined && registrationDate !== null) {
        invariant(
          Date.parse(registrationDate) === Date.parse(item.registrationDate ?? ""),
          "spaceship_transfer_evidence_changed",
          "Stored registration evidence no longer matches registrar readback",
          { status: 409 }
        );
      }
      const registeredAt = Date.parse(item.registrationDate ?? "");
      if (!Number.isFinite(registeredAt)) {
        return Object.freeze({
          eligible: false,
          reason: "registration_date_unavailable"
        });
      }
      if (clockNowMs(clock) - registeredAt < 60 * 24 * 60 * 60 * 1000) {
        return Object.freeze({
          eligible: false,
          reason: "initial_60_day_transfer_lock"
        });
      }
      return Object.freeze({
        eligible: true,
        locked: item.eppStatuses.includes("clientTransferProhibited"),
        providerEvidence: "domain_readback",
        manualPolicyChecksStillRequired: [
          "recent_transfer_60_day_lock",
          "registrant_identity_dispute",
          "bankruptcy",
          "unpaid_fees"
        ]
      });
    },

    async setTransferLock({ domain, locked } = {}) {
      requireCapability("domains:read");
      requireCapability("domains:transfer");
      invariant(typeof locked === "boolean", "invalid_input", "locked is invalid", {
        status: 400
      });
      const name = normalizeDomain(domain);
      const before = await readDomain(name);
      const current = before.eppStatuses.includes("clientTransferProhibited");
      if (current === locked) return Object.freeze({ locked, changed: false });
      if (
        locked === false &&
        before.eppStatuses.includes("serverTransferProhibited")
      ) {
        throw external(
          "spaceship_server_transfer_lock",
          "The registry or registrar has a server transfer lock",
          "not_submitted"
        );
      }
      const response = await transport.request({
        method: "PUT",
        path: `${SPACESHIP_API_PREFIX}/domains/${name}/transfer/lock`,
        body: { isLocked: locked },
        effect: "mutation",
        successStatuses: [200],
        responseKind: "json"
      });
      if (response?.isLocked !== locked) {
        throw external(
          "spaceship_transfer_lock_response_ambiguous",
          "Spaceship did not confirm the requested transfer lock state",
          "ambiguous"
        );
      }
      const after = await readDomain(name);
      const observed = after.eppStatuses.includes("clientTransferProhibited");
      if (observed !== locked) {
        throw external(
          "spaceship_transfer_lock_readback_ambiguous",
          "Transfer lock readback did not match the requested state",
          "ambiguous"
        );
      }
      return Object.freeze({ locked, changed: true });
    },

    async getAuthCode({ domain } = {}) {
      requireCapability("domains:transfer");
      const name = normalizeDomain(domain);
      const response = await transport.request({
        method: "GET",
        path: `${SPACESHIP_API_PREFIX}/domains/${name}/transfer/auth-code`,
        effect: "read",
        successStatuses: [200],
        responseKind: "json"
      });
      const authCode = secretString(response?.authCode, "authCode", 50);
      const expiresAt = requiredIso(response?.expires, "auth code expiry");
      invariant(
        Date.parse(expiresAt) > clockNowMs(clock),
        "spaceship_auth_code_expired",
        "Spaceship returned an expired transfer auth code",
        { status: 502 }
      );
      return Object.freeze({ authCode, expiresAt });
    },

    async getNameservers({ domain } = {}) {
      const item = await readDomain(domain);
      return structuredClone(item.nameservers);
    },

    async setNameservers({ domain, provider, hosts } = {}) {
      requireCapability("domains:read");
      requireCapability("domains:write");
      const name = normalizeDomain(domain);
      const desired = normalizeNameservers({ provider, hosts }, { forWrite: true });
      const before = await readDomain(name);
      if (nameserversEqual(before.nameservers, desired)) {
        return Object.freeze({ ...desired, changed: false });
      }
      await transport.request({
        method: "PUT",
        path: `${SPACESHIP_API_PREFIX}/domains/${name}/nameservers`,
        body:
          desired.provider === "basic"
            ? { provider: "basic" }
            : { provider: "custom", hosts: desired.hosts },
        effect: "mutation",
        successStatuses: [200],
        responseKind: "json"
      });
      const after = await readDomain(name);
      if (!nameserversEqual(after.nameservers, desired)) {
        throw external(
          "spaceship_nameserver_readback_ambiguous",
          "Nameserver readback did not match the requested state",
          "ambiguous"
        );
      }
      return Object.freeze({ ...desired, changed: true });
    },

    async listDnsRecords(input = {}) {
      return listDnsRecordsPage(input);
    },

    async saveDnsRecords({ domain, records, force = false } = {}) {
      requireCapability("dnsrecords:write");
      requireCapability("dnsrecords:read");
      const name = normalizeDomain(domain);
      invariant(typeof force === "boolean", "invalid_input", "force is invalid", {
        status: 400
      });
      const desired = normalizeDnsWriteRecords(records, { includeTtl: true });
      await transport.request({
        method: "PUT",
        path: `${SPACESHIP_API_PREFIX}/dns/records/${name}`,
        body: { force, items: desired },
        effect: "mutation",
        successStatuses: [204],
        responseKind: "none"
      });
      const readback = await listDnsRecordsPage({ domain: name, take: 500, skip: 0 });
      if (!desired.every((record) => dnsRecordIncluded(readback.items, record))) {
        throw external(
          "spaceship_dns_save_readback_ambiguous",
          "DNS record readback did not contain every requested record",
          "ambiguous"
        );
      }
      return Object.freeze({ saved: desired.length });
    },

    async deleteDnsRecords({ domain, records } = {}) {
      requireCapability("dnsrecords:write");
      requireCapability("dnsrecords:read");
      const name = normalizeDomain(domain);
      const desired = normalizeDnsWriteRecords(records, { includeTtl: false });
      await transport.request({
        method: "DELETE",
        path: `${SPACESHIP_API_PREFIX}/dns/records/${name}`,
        body: desired,
        effect: "mutation",
        successStatuses: [204],
        responseKind: "none"
      });
      const readback = await listDnsRecordsPage({ domain: name, take: 500, skip: 0 });
      if (desired.some((record) => dnsRecordIncluded(readback.items, record))) {
        throw external(
          "spaceship_dns_delete_readback_ambiguous",
          "DNS record readback still contains a requested deletion",
          "ambiguous"
        );
      }
      return Object.freeze({ deleted: desired.length });
    }
  };

  return Object.freeze(registrar);
}

export function createHeldSpaceshipPricePreview() {
  return Object.freeze({
    async previewRegistration() {
      throw external(
        "spaceship_price_preview_unconfigured",
        "No documented no-charge Spaceship exact-price preview is configured",
        "not_submitted"
      );
    }
  });
}

function createTransport({ fetchImpl, clock, vault, config, eventSink }) {
  async function credentials() {
    let value;
    try {
      value = await vault.readProviderCredentials({ provider: "spaceship" });
    } catch {
      throw external(
        "spaceship_credentials_unavailable",
        "Spaceship credentials are unavailable from the secret vault",
        "not_submitted"
      );
    }
    invariant(
      typeof value?.apiKey === "string" &&
        value.apiKey.length > 0 &&
        value.apiKey.length <= 512 &&
        typeof value?.apiSecret === "string" &&
        value.apiSecret.length > 0 &&
        value.apiSecret.length <= 1024,
      "spaceship_credentials_invalid",
      "Spaceship secret-vault credentials are invalid",
      { status: 500 }
    );
    return value;
  }

  async function request({
    method,
    path,
    body,
    effect,
    successStatuses,
    responseKind,
    asyncOperationHeaderRequired = false
  }) {
    invariant(
      typeof path === "string" && path.startsWith(`${SPACESHIP_API_PREFIX}/`),
      "spaceship_path_invalid",
      "Spaceship API path is invalid",
      { status: 500 }
    );
    const url = new URL(path, SPACESHIP_API_ORIGIN);
    invariant(
      url.origin === SPACESHIP_API_ORIGIN,
      "spaceship_origin_invalid",
      "Spaceship API origin cannot be changed",
      { status: 500 }
    );
    const secret = await credentials();
    const controller = new AbortController();
    const setTimer =
      typeof clock.setTimeout === "function"
        ? clock.setTimeout.bind(clock)
        : globalThis.setTimeout.bind(globalThis);
    const clearTimer =
      typeof clock.clearTimeout === "function"
        ? clock.clearTimeout.bind(clock)
        : globalThis.clearTimeout.bind(globalThis);
    const timer = setTimer(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": secret.apiKey,
          "X-API-Secret": secret.apiSecret
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      emitSafe(eventSink, {
        provider: "spaceship",
        method,
        path: url.pathname,
        result: "transport_error",
        certainty: effect === "read" ? "not_submitted" : "ambiguous",
        at: clockNowIso(clock)
      });
      throw external(
        effect === "read"
          ? "spaceship_read_transport_failed"
          : "spaceship_effect_transport_ambiguous",
        effect === "read"
          ? "Spaceship read request failed"
          : "Spaceship mutation transport failed; the provider effect is ambiguous",
        effect === "read" ? "not_submitted" : "ambiguous"
      );
    } finally {
      clearTimer(timer);
    }

    invariant(
      response &&
        Number.isSafeInteger(response.status) &&
        response.headers &&
        typeof response.headers.get === "function",
      "spaceship_transport_response_invalid",
      "Spaceship transport returned an invalid response",
      { status: 502 }
    );
    emitSafe(eventSink, {
      provider: "spaceship",
      method,
      path: url.pathname,
      status: response.status,
      result: successStatuses.includes(response.status) ? "accepted" : "rejected",
      at: clockNowIso(clock)
    });

    if (!successStatuses.includes(response.status)) {
      await safelyCall(() => readBoundedBody(response, config.maxBodyBytes));
      const authoritative4xx = response.status >= 400 && response.status < 500;
      const certainty =
        authoritative4xx || effect === "read" ? "not_submitted" : "ambiguous";
      throw external(
        `spaceship_http_${response.status}`,
        certainty === "not_submitted"
          ? "Spaceship authoritatively rejected the request before submission"
          : "Spaceship returned a response that leaves the provider effect ambiguous",
        certainty,
        { providerStatus: response.status }
      );
    }

    let bytes;
    try {
      bytes = await readBoundedBody(response, config.maxBodyBytes);
    } catch {
      throw external(
        "spaceship_response_too_large",
        "Spaceship response exceeded the configured safety limit",
        effect === "read" ? "not_submitted" : "ambiguous"
      );
    }

    let operationId = null;
    if (asyncOperationHeaderRequired) {
      operationId = response.headers.get(SPACESHIP_ASYNC_OPERATION_HEADER);
      if (!OPERATION_ID.test(operationId ?? "")) {
        throw external(
          "spaceship_confirmation_operation_missing",
          "Spaceship accepted the irreversible request without a valid async operation ID",
          "ambiguous"
        );
      }
    }

    if (responseKind === "none") {
      if (bytes.byteLength !== 0) {
        throw external(
          "spaceship_response_contract_invalid",
          "Spaceship returned an unexpected response body",
          effect === "read" ? "not_submitted" : "ambiguous"
        );
      }
      return operationId ? { operationId } : null;
    }

    if (responseKind === "optional_json" && bytes.byteLength === 0) {
      return operationId ? { operationId } : null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/\b(?:application\/json|application\/problem\+json)\b/iu.test(contentType)) {
      throw external(
        "spaceship_response_content_type_invalid",
        "Spaceship response was not JSON",
        effect === "read" ? "not_submitted" : "ambiguous"
      );
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw external(
        "spaceship_response_json_invalid",
        "Spaceship returned malformed JSON",
        effect === "read" ? "not_submitted" : "ambiguous"
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw external(
        "spaceship_response_shape_invalid",
        "Spaceship returned an invalid JSON response",
        effect === "read" ? "not_submitted" : "ambiguous"
      );
    }
    return operationId ? { ...parsed, operationId } : parsed;
  }

  return Object.freeze({ request });
}

async function readBoundedBody(response, maximum) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximum) {
      throw new Error("response body limit");
    }
  }
  if (!response.body) return new Uint8Array();
  if (typeof response.body.getReader !== "function") {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > maximum) throw new Error("response body limit");
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await safelyCall(() => reader.cancel());
        throw new Error("response body limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateExactPreview(value, { domain, years, nowMs, config }) {
  invariant(
    value?.source === SPACESHIP_MCP_PREVIEW_SOURCE &&
      value?.noCharge === true &&
      value?.status === "confirmation_required" &&
      normalizeDomain(value?.domain) === domain &&
      value?.years === years,
    "spaceship_price_preview_untrusted",
    "Spaceship price preview provenance or scope is invalid",
    { status: 502 }
  );
  invariant(
    value.price &&
      Number.isSafeInteger(value.price.amountMinor) &&
      value.price.amountMinor >= 0 &&
      value.price.currency === "USD",
    "spaceship_price_preview_invalid",
    "Spaceship exact integer USD price is unavailable",
    { status: 502 }
  );
  const observedAt = requiredIso(value.observedAt, "price preview observation time");
  const observedMs = Date.parse(observedAt);
  invariant(
    nowMs - observedMs <= config.previewMaxAgeMs &&
      observedMs - nowMs <= config.previewFutureSkewMs,
    "spaceship_price_preview_stale",
    "Spaceship price preview is not current",
    { status: 409 }
  );
  const evidenceId =
    value.evidenceId === undefined || value.evidenceId === null
      ? null
      : opaque(value.evidenceId, "price preview evidenceId", 256);
  return Object.freeze({
    price: Object.freeze({
      amountMinor: value.price.amountMinor,
      currency: "USD"
    }),
    observedAt,
    evidenceId
  });
}

function validateRegistrationOptions({ autoRenew, privacy, contacts }) {
  invariant(autoRenew === false, "spaceship_autorenew_forbidden", "Auto-renew must remain off", {
    status: 409
  });
  invariant(
    privacy?.level === "high" && privacy?.userConsent === true,
    "spaceship_privacy_consent_invalid",
    "High privacy and explicit customer consent are required",
    { status: 409 }
  );
  normalizeContactIds(contacts);
}

function validateExpectedPrice(value) {
  invariant(
    value &&
      Number.isSafeInteger(value.amountMinor) &&
      value.amountMinor >= 0 &&
      value.currency === "USD",
    "spaceship_expected_price_invalid",
    "An exact accepted USD price is required before confirmation",
    { status: 409 }
  );
}

function normalizeContactIds(value) {
  invariant(value && typeof value === "object", "invalid_contacts", "contacts are required", {
    status: 400
  });
  const output = {};
  for (const role of CONTACT_ROLES) output[role] = normalizeContactId(value[role]);
  if (value.attributes !== undefined && value.attributes !== null) {
    invariant(
      Array.isArray(value.attributes) && value.attributes.length <= 5,
      "invalid_contacts",
      "contact attributes are invalid",
      { status: 400 }
    );
    output.attributes = value.attributes.map((entry) => normalizeContactId(entry));
  }
  return output;
}

function normalizeContactId(value, { effectCertainty = null } = {}) {
  if (!CONTACT_ID.test(value ?? "")) {
    if (effectCertainty) {
      throw external(
        "spaceship_contact_id_missing",
        "Spaceship did not return a valid contact ID",
        effectCertainty
      );
    }
    invariant(false, "spaceship_contact_id_invalid", "Spaceship contact ID is invalid", {
      status: 400
    });
  }
  return value;
}

function normalizeOperationId(value) {
  invariant(
    OPERATION_ID.test(value ?? ""),
    "spaceship_operation_id_invalid",
    "Spaceship operation ID is invalid",
    { status: 400 }
  );
  return value;
}

function normalizeContact(value) {
  invariant(value && typeof value === "object", "spaceship_contact_invalid", "Contact is invalid", {
    status: 409
  });
  const required = {
    firstName: text(value.firstName, "firstName", 125),
    lastName: text(value.lastName, "lastName", 125),
    email: text(value.email, "email", 255).toLowerCase(),
    address1: text(value.address1, "address1", 255),
    city: text(value.city, "city", 255),
    country: text(value.country, "country", 2).toUpperCase(),
    phone: text(value.phone, "phone", 17)
  };
  invariant(
    /^[A-Z]{2}$/u.test(required.country) &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(required.email) &&
      /^\+\d{1,3}\.\d{4,}$/u.test(required.phone),
    "spaceship_contact_invalid",
    "Contact format is invalid",
    { status: 409 }
  );
  const optionalLimits = {
    organization: 255,
    address2: 255,
    stateProvince: 255,
    postalCode: 16,
    phoneExt: 7,
    fax: 17,
    faxExt: 7,
    taxNumber: 255
  };
  for (const [key, maximum] of Object.entries(optionalLimits)) {
    required[key] =
      value[key] === undefined || value[key] === null || value[key] === ""
        ? null
        : text(value[key], key, maximum);
  }
  if (required.fax !== null) {
    invariant(
      /^\+\d{1,3}\.\d{4,}$/u.test(required.fax),
      "spaceship_contact_invalid",
      "Contact fax format is invalid",
      { status: 409 }
    );
  }
  return Object.freeze(required);
}

function contactsEqual(left, right) {
  return digest(normalizeContact(left)) === digest(normalizeContact(right));
}

function contactRequest(value) {
  return Object.fromEntries(
    Object.entries(normalizeContact(value)).filter(([, entry]) => entry !== null)
  );
}

function normalizeDomainReadback(value, expectedDomain) {
  invariant(
    value && typeof value === "object" && normalizeDomain(value.name) === expectedDomain,
    "spaceship_domain_readback_invalid",
    "Spaceship domain readback is invalid",
    { status: 502 }
  );
  invariant(
    DOMAIN_LIFECYCLE_STATUSES.has(value.lifecycleStatus) &&
      Array.isArray(value.eppStatuses) &&
      Array.isArray(value.suspensions),
    "spaceship_domain_readback_invalid",
    "Spaceship domain state is invalid",
    { status: 502 }
  );
  const contacts = normalizeDomainContacts(value.contacts);
  return Object.freeze({
    name: expectedDomain,
    unicodeName: nullableString(value.unicodeName, 253),
    lifecycleStatus: value.lifecycleStatus,
    registrationDate: nullableIso(value.registrationDate),
    expirationDate: nullableIso(value.expirationDate),
    verificationStatus: nullableString(value.verificationStatus, 64),
    autoRenew: value.autoRenew === true,
    isPremium: value.isPremium === true,
    eppStatuses: Object.freeze(
      value.eppStatuses.map((entry) => text(entry, "eppStatus", 128))
    ),
    suspensions: Object.freeze(
      value.suspensions.map((entry) =>
        Object.freeze({ reasonCode: text(entry?.reasonCode, "suspension reason", 128) })
      )
    ),
    contacts,
    nameservers: normalizeNameservers(value.nameservers),
    privacyProtection:
      value.privacyProtection && typeof value.privacyProtection === "object"
        ? Object.freeze({
            level: value.privacyProtection.level,
            contactForm: value.privacyProtection.contactForm === true
          })
        : null
  });
}

function normalizeDomainContacts(value) {
  invariant(
    value && typeof value === "object",
    "spaceship_domain_contacts_invalid",
    "Spaceship domain contacts are invalid",
    { status: 502 }
  );
  const output = { registrant: normalizeContactId(value.registrant) };
  for (const role of ["admin", "tech", "billing"]) {
    output[role] =
      value[role] === null || value[role] === undefined
        ? null
        : normalizeContactId(value[role]);
  }
  output.attributes =
    value.attributes === null || value.attributes === undefined
      ? []
      : value.attributes.map((entry) => normalizeContactId(entry));
  return Object.freeze(output);
}

function normalizeNameservers(value, { forWrite = false } = {}) {
  invariant(
    value && ["basic", "custom"].includes(value.provider),
    "spaceship_nameservers_invalid",
    "Nameserver configuration is invalid",
    { status: 400 }
  );
  if (value.provider === "basic") {
    const suppliedHosts =
      value.hosts === undefined || value.hosts === null ? [] : value.hosts;
    invariant(
      Array.isArray(suppliedHosts) &&
        (!forWrite || suppliedHosts.length === 0),
      "spaceship_nameservers_invalid",
      "Basic nameserver writes cannot include custom hosts",
      { status: 400 }
    );
    return Object.freeze({
      provider: "basic",
      hosts: Object.freeze(suppliedHosts.map((host) => normalizeDomain(host)))
    });
  }
  invariant(
    Array.isArray(value.hosts) &&
      value.hosts.length >= 2 &&
      value.hosts.length <= 12,
    "spaceship_nameservers_invalid",
    "Custom nameservers require 2 to 12 hosts",
    { status: 400 }
  );
  const hosts = value.hosts.map((host) => normalizeDomain(host));
  invariant(
    new Set(hosts).size === hosts.length,
    "spaceship_nameservers_invalid",
    "Custom nameservers must be unique",
    { status: 400 }
  );
  return Object.freeze({ provider: "custom", hosts: Object.freeze(hosts) });
}

function nameserversEqual(left, right) {
  const a = normalizeNameservers(left);
  const b = normalizeNameservers(right);
  if (a.provider === "basic" && b.provider === "basic") return true;
  return a.provider === b.provider && digest(a.hosts) === digest(b.hosts);
}

function normalizeDnsWriteRecords(value, { includeTtl }) {
  invariant(
    Array.isArray(value) && value.length >= 1 && value.length <= 500,
    "spaceship_dns_records_invalid",
    "DNS records must contain 1 to 500 items",
    { status: 400 }
  );
  return value.map((record) => normalizeDnsWriteRecord(record, { includeTtl }));
}

function normalizeDnsWriteRecord(record, { includeTtl }) {
  invariant(
    record && typeof record === "object",
    "spaceship_dns_record_invalid",
    "DNS record is invalid",
    { status: 400 }
  );
  const type = text(record.type, "DNS type", 16).toUpperCase();
  const name = normalizeDnsRecordName(record.name);
  const output = { type, name };
  if (includeTtl && record.ttl !== undefined) {
    output.ttl = integer(record.ttl, "ttl", 60, 3600);
  }
  if (type === "A" || type === "AAAA") {
    const address = text(record.address, "DNS address", 64);
    invariant(
      isIP(address) === (type === "A" ? 4 : 6),
      "spaceship_dns_record_invalid",
      `${type} record address is invalid`,
      { status: 400 }
    );
    output.address = address;
  } else if (type === "CNAME") {
    output.cname = normalizeDomain(record.cname);
  } else if (type === "ALIAS") {
    output.aliasName = normalizeDomain(record.aliasName);
  } else if (type === "TXT") {
    output.value = text(record.value, "TXT value", 4096);
  } else {
    invariant(
      false,
      "spaceship_dns_record_type_unsupported",
      "Hosted setup supports only A, AAAA, CNAME, ALIAS, and TXT writes",
      { status: 400 }
    );
  }
  return Object.freeze(output);
}

function normalizeDnsReadbackRecord(record) {
  invariant(
    record &&
      typeof record === "object" &&
      typeof record.type === "string" &&
      typeof record.name === "string",
    "spaceship_dns_response_invalid",
    "Spaceship returned an invalid DNS record",
    { status: 502 }
  );
  return Object.freeze(structuredClone(record));
}

function normalizeDnsRecordName(value) {
  const name = text(value, "DNS record name", 253);
  invariant(
    name === "@" ||
      name === "*" ||
      /^(?:_[a-z0-9-]+|[a-z0-9*](?:[a-z0-9*-]*[a-z0-9*])?)(?:\.(?:_[a-z0-9-]+|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))*$/iu.test(
        name
      ),
    "spaceship_dns_record_invalid",
    "DNS record name is invalid",
    { status: 400 }
  );
  return name.toLowerCase();
}

function dnsRecordIncluded(items, expected) {
  return items.some((candidate) => {
    if (
      String(candidate.type).toUpperCase() !== expected.type ||
      String(candidate.name).toLowerCase() !== expected.name
    ) {
      return false;
    }
    const key = {
      A: "address",
      AAAA: "address",
      CNAME: "cname",
      ALIAS: "aliasName",
      TXT: "value"
    }[expected.type];
    return candidate[key] === expected[key];
  });
}

function validateLiveApproval(value) {
  invariant(
    value?.provider === "spaceship" &&
      value?.approved === true &&
      SAFE_LIVE_ENVIRONMENTS.has(value?.environment) &&
      typeof value?.approvalId === "string" &&
      value.approvalId.length >= 8 &&
      value.approvalId.length <= 256 &&
      typeof value?.providerWrittenResaleConsentRef === "string" &&
      value.providerWrittenResaleConsentRef.length >= 8 &&
      value.providerWrittenResaleConsentRef.length <= 256 &&
      Number.isFinite(Date.parse(value?.approvedAt)) &&
      Array.isArray(value?.capabilities),
    "spaceship_live_approval_missing",
    "An explicit environment-bound Spaceship live approval is required",
    { status: 500 }
  );
  const capabilities = new Set(value.capabilities);
  invariant(
    capabilities.size === value.capabilities.length &&
      [...capabilities].every(
        (entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 64
      ),
    "spaceship_live_approval_invalid",
    "Spaceship live approval capabilities are invalid",
    { status: 500 }
  );
}

function validateVault(value) {
  invariant(value && typeof value === "object", "spaceship_vault_missing", "vault is required", {
    status: 500
  });
  for (const method of REQUIRED_VAULT_METHODS) {
    invariant(
      typeof value[method] === "function",
      "spaceship_vault_invalid",
      `vault.${method} is required`,
      { status: 500 }
    );
  }
  return value;
}

function validatePricePreview(value) {
  if (value === undefined || value === null) return createHeldSpaceshipPricePreview();
  invariant(
    typeof value.previewRegistration === "function",
    "spaceship_price_preview_invalid",
    "pricePreview.previewRegistration is required",
    { status: 500 }
  );
  return value;
}

function validateClock(value) {
  invariant(
    value && typeof value.now === "function",
    "spaceship_clock_invalid",
    "clock.now is required",
    { status: 500 }
  );
  clockNowMs(value);
  return value;
}

function validateConfig(value) {
  return Object.freeze({
    timeoutMs: integer(value.timeoutMs, "timeoutMs", 50, 60_000),
    maxBodyBytes: integer(value.maxBodyBytes, "maxBodyBytes", 1024, 1024 * 1024),
    previewMaxAgeMs: integer(value.previewMaxAgeMs, "previewMaxAgeMs", 1_000, 5 * 60_000),
    previewFutureSkewMs: integer(
      value.previewFutureSkewMs,
      "previewFutureSkewMs",
      0,
      60_000
    )
  });
}

function clockNowMs(clock) {
  const value = clock.now();
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  invariant(
    Number.isFinite(milliseconds),
    "spaceship_clock_invalid",
    "clock.now returned an invalid time",
    { status: 500 }
  );
  return milliseconds;
}

function clockNowIso(clock) {
  return new Date(clockNowMs(clock)).toISOString();
}

function integer(value, label, minimum, maximum) {
  invariant(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    "invalid_input",
    `${label} is invalid`,
    { status: 400 }
  );
  return value;
}

function opaque(value, label, maximum) {
  invariant(
    typeof value === "string" && value.length > 0 && value.length <= maximum,
    "invalid_input",
    `${label} is required`,
    { status: 400 }
  );
  return value;
}

function text(value, label, maximum) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\u0000-\u001f\u007f]/u.test(value),
    "invalid_input",
    `${label} is invalid`,
    { status: 400 }
  );
  return value;
}

function secretString(value, label, maximum) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      !/[\r\n\u0000]/u.test(value),
    "spaceship_secret_response_invalid",
    `Spaceship ${label} response is invalid`,
    { status: 502 }
  );
  return value;
}

function requiredIso(value, label) {
  invariant(
    typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)),
    "spaceship_time_invalid",
    `${label} is invalid`,
    { status: 502 }
  );
  return value;
}

function nullableIso(value) {
  return value === null || value === undefined ? null : requiredIso(value, "provider timestamp");
}

function nullableString(value, maximum) {
  return value === null || value === undefined ? null : text(value, "provider value", maximum);
}

function external(code, message, certainty, details = null) {
  return new ExternalEffectError(code, message, { certainty, details });
}

function emitSafe(sink, event) {
  try {
    sink(Object.freeze({ ...event }));
  } catch {
    // Observability must never change provider semantics.
  }
}

async function safelyCall(callback) {
  try {
    return await callback();
  } catch {
    return undefined;
  }
}
