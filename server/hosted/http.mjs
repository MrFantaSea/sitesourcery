import { MAX_BODY_BYTES, WRITE_METHODS } from "./constants.mjs";
import { HostedError, invariant, publicError } from "./errors.mjs";
import { digest, randomToken } from "./security.mjs";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!key || Object.hasOwn(cookies, key)) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Invalid cookies are treated as absent.
    }
  }
  return cookies;
}

function sessionCookie(token) {
  return [
    `ss_session=${encodeURIComponent(token)}`,
    "Path=/api/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=2592000"
  ].join("; ");
}

function clearSessionCookie() {
  return [
    "ss_session=",
    "Path=/api/v1",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ");
}

function csrfCookie(token) {
  return [
    `ss_csrf=${encodeURIComponent(token)}`,
    "Path=/api/v1",
    "Secure",
    "SameSite=Strict",
    "Max-Age=3600"
  ].join("; ");
}

function currentCsrfToken(cookies, nextCsrfToken) {
  const existing = cookies.ss_csrf;
  if (
    typeof existing === "string" &&
    existing.length >= 32 &&
    existing.length <= 256
  ) {
    return existing;
  }
  return nextCsrfToken();
}

async function readJson(request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  invariant(
    !Number.isFinite(contentLength) || contentLength <= MAX_BODY_BYTES,
    "REQUEST_TOO_LARGE",
    "Request body is too large.",
    { status: 413 }
  );
  const text = await request.text();
  invariant(
    Buffer.byteLength(text) <= MAX_BODY_BYTES,
    "REQUEST_TOO_LARGE",
    "Request body is too large.",
    { status: 413 }
  );
  if (!text) return {};
  invariant(
    String(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json"),
    "UNSUPPORTED_MEDIA_TYPE",
    "JSON is required.",
    { status: 415 }
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HostedError("INVALID_JSON", "Request body is invalid JSON.", { status: 400 });
  }
  invariant(
    value && typeof value === "object" && !Array.isArray(value),
    "INVALID_JSON",
    "Request body must be a JSON object.",
    { status: 400 }
  );
  return value;
}

async function readRawWebhook(request) {
  const contentLength = Number(
    request.headers.get("content-length") ?? 0
  );
  invariant(
    !Number.isFinite(contentLength) ||
      contentLength <= MAX_BODY_BYTES,
    "REQUEST_TOO_LARGE",
    "Request body is too large.",
    { status: 413 }
  );
  invariant(
    String(
      request.headers.get("content-type") ?? ""
    )
      .toLowerCase()
      .startsWith("application/json"),
    "UNSUPPORTED_MEDIA_TYPE",
    "Stripe webhook JSON is required.",
    { status: 415 }
  );
  const bytes = Buffer.from(
    await request.arrayBuffer()
  );
  invariant(
    bytes.byteLength > 0 &&
      bytes.byteLength <= MAX_BODY_BYTES,
    bytes.byteLength === 0
      ? "STRIPE_WEBHOOK_BODY_REQUIRED"
      : "REQUEST_TOO_LARGE",
    bytes.byteLength === 0
      ? "Stripe webhook body is required."
      : "Request body is too large.",
    { status: bytes.byteLength === 0 ? 400 : 413 }
  );
  return bytes;
}

function match(pathname, pattern) {
  const result = pattern.exec(pathname);
  if (!result) return null;
  return result.slice(1).map((value) => decodeURIComponent(value));
}

function commandId(request) {
  return request.headers.get("idempotency-key");
}

function expectedRevision(request) {
  const value = request.headers.get("if-match");
  return value === null ? Number.NaN : Number(value.replace(/^"|"$/gu, ""));
}

function requireSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  invariant(
    !origin || origin === url.origin,
    "CROSS_ORIGIN_REQUEST_REJECTED",
    "Cross-origin requests are not allowed.",
    { status: 403 }
  );
}

function requireCsrf(request, cookies) {
  const cookie = cookies.ss_csrf;
  const header = request.headers.get("x-csrf-token");
  invariant(
    typeof cookie === "string" &&
      cookie.length >= 32 &&
      typeof header === "string" &&
      digest(cookie) === digest(header),
    "CSRF_TOKEN_REQUIRED",
    "Refresh this page before trying that action again.",
    { status: 403 }
  );
}

export function createHostedApi(service, { requestIds, csrfTokens } = {}) {
  invariant(service && typeof service.authenticate === "function", "RUNTIME_CONFIGURATION_ERROR", "Hosted service is required.", {
    status: 500
  });
  const nextRequestId =
    requestIds?.next?.bind(requestIds) ??
    (() => `req_${randomToken(12)}`);
  const nextCsrfToken =
    typeof csrfTokens === "function" ? csrfTokens : () => randomToken(32);

  return Object.freeze({
    async fetch(request) {
      const requestId = nextRequestId("request");
      try {
        const url = new URL(request.url);
        const method = request.method.toUpperCase();
        const pathname = url.pathname.replace(/\/+$/u, "") || "/";
        const cookies = parseCookies(request.headers.get("cookie"));
        requireSameOrigin(request, url);

        if (
          method === "GET" &&
          pathname === "/api/v1/health"
        ) {
          return json(
            {
              ok: true,
              service:
                "sitesourcery-hosted-runtime"
            },
            200,
            { "X-Request-Id": requestId }
          );
        }

        if (
          method === "GET" &&
          pathname === "/api/v1/ready"
        ) {
          invariant(
            typeof service.readiness === "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Hosted readiness is unavailable.",
            { status: 500 }
          );
          const readiness =
            await service.readiness();
          const ready = readiness?.ready === true;
          return json(
            {
              ready,
              service:
                "sitesourcery-hosted-runtime"
            },
            ready ? 200 : 503,
            { "X-Request-Id": requestId }
          );
        }

        if (method === "GET" && pathname === "/api/v1/csrf") {
          const csrfToken = currentCsrfToken(cookies, nextCsrfToken);
          return json(
            { csrfToken },
            200,
            {
              "Set-Cookie": csrfCookie(csrfToken),
              "X-Request-Id": requestId
            }
          );
        }

        if (
          method === "POST" &&
          pathname === "/api/v1/webhooks/stripe"
        ) {
          invariant(
            typeof service.ingestStripeWebhook ===
              "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Stripe webhook ingestion is unavailable.",
            { status: 500 }
          );
          const result =
            await service.ingestStripeWebhook({
              rawBody: await readRawWebhook(request),
              signature: request.headers.get(
                "stripe-signature"
              )
            });
          return json(result, 200, {
            "X-Request-Id": requestId
          });
        }

        if (WRITE_METHODS.has(method)) {
          requireCsrf(request, cookies);
          invariant(
            typeof commandId(request) === "string",
            "IDEMPOTENCY_KEY_REQUIRED",
            "An idempotency key is required.",
            { status: 400 }
          );
        }

        const actor = await service.authenticate(cookies.ss_session);
        const body = WRITE_METHODS.has(method) ? await readJson(request) : {};
        const write = { ...body, commandId: commandId(request) };
        let route;
        let result;
        let status = 200;
        let headers = { "X-Request-Id": requestId };

        if (method === "POST" && pathname === "/api/v1/auth/register") {
          const created = await service.register(write);
          const { sessionToken, ...safe } = created;
          result = safe;
          status = 201;
          headers["Set-Cookie"] = sessionCookie(sessionToken);
        } else if (method === "POST" && pathname === "/api/v1/auth/sessions") {
          const signedIn = await service.signIn(write);
          const { sessionToken, ...safe } = signedIn;
          result = safe;
          status = 201;
          headers["Set-Cookie"] = sessionCookie(sessionToken);
        } else if (
          method === "DELETE" &&
          pathname === "/api/v1/auth/sessions/current"
        ) {
          result = await service.signOut(actor, write.commandId);
          headers["Set-Cookie"] = clearSessionCookie();
        } else if (method === "POST" && pathname === "/api/v1/auth/recovery") {
          result = await service.requestRecovery(write);
          status = 202;
        } else if (
          method === "POST" &&
          pathname === "/api/v1/auth/recovery/complete"
        ) {
          result = await service.completeRecovery(write);
        } else if (method === "GET" && pathname === "/api/v1/me") {
          const csrfToken = currentCsrfToken(cookies, nextCsrfToken);
          result = actor ? await service.me(actor) : { user: null };
          result = { ...result, csrfToken };
          headers["Set-Cookie"] = csrfCookie(csrfToken);
        } else if (method === "GET" && pathname === "/api/v1/organizations") {
          result = await service.listOrganizations(actor);
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/organizations\/([^/]+)\/projects$/u))
        ) {
          result = await service.listProjects(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/organizations\/([^/]+)\/projects$/u))
        ) {
          result = await service.createProject(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)$/u))
        ) {
          result = await service.getProject(actor, route[0]);
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/draft$/u))
        ) {
          result = await service.saveDraft(actor, route[0], {
            ...write,
            expectedRevision: expectedRevision(request)
          });
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/versions$/u))
        ) {
          result = await service.createVersion(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/ready$/u
          ))
        ) {
          result = await service.markVersionReady(actor, route[0], route[1], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/accept$/u
          ))
        ) {
          result = await service.acceptVersion(actor, route[0], route[1], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/addresses\/(licensed|custom)$/u
          ))
        ) {
          result = await service.selectAddress(actor, route[0], {
            ...write,
            kind: route[1]
          });
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/addresses\/([^/]+)\/verification-requests$/u
          ))
        ) {
          result = await service.requestAddressVerification(
            actor,
            route[0],
            route[1],
            write
          );
          status = 202;
        } else if (
          method === "GET" &&
          (pathname === "/api/v1/offers" || pathname === "/api/v1/offer-catalog")
        ) {
          result = await service.getOfferCatalog();
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/(?:quotes|commerce-quotes)$/u
          ))
        ) {
          result = await service.createCommerceQuote(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/(?:quotes|commerce-quotes)\/([^/]+)$/u
          ))
        ) {
          result = await service.getCommerceQuote(actor, route[0], route[1]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/commerce-quotes\/([^/]+)\/checkout$/u
          ))
        ) {
          result = await service.createCheckout(actor, route[0], {
            ...write,
            quoteId: route[1]
          });
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/checkout-intents$/u
          ))
        ) {
          invariant(
            !Object.hasOwn(write, "priceId"),
            "CLIENT_PRICE_AUTHORITY_REJECTED",
            "Checkout requires an authoritative server quote, not a browser price ID.",
            { status: 400 }
          );
          result = await service.createCheckout(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/billing-portal-sessions$/u
          ))
        ) {
          result = await service.createBillingPortal(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription$/u
          ))
        ) {
          result = await service.getSubscription(actor, route[0]);
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription\/cancellation-preview$/u
          ))
        ) {
          result = await service.getCancellationPreview(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/subscription\/cancel$/u
          ))
        ) {
          result = await service.cancelSubscription(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/release-requests$/u
          ))
        ) {
          result = await service.requestRelease(actor, route[0], write);
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/rollback$/u
          ))
        ) {
          result = await service.rollbackRelease(
            actor,
            route[0],
            route[1],
            write
          );
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/unpublish$/u))
        ) {
          result = await service.unpublish(actor, route[0], write);
          status = 202;
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/visibility$/u))
        ) {
          result = await service.setVisibility(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/support-tickets$/u
          ))
        ) {
          result = await service.createSupportTicket(actor, route[0], write);
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)\/exports$/u))
        ) {
          result = await service.requestExport(actor, route[0], write);
          status = 202;
          const exportId = result.export.exportId;
          queueMicrotask(() => {
            service.processExport(exportId).catch(() => {});
          });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)$/u
          ))
        ) {
          result = await service.getExport(actor, route[0], route[1]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)\/retry$/u
          ))
        ) {
          result = await service.retryExport(actor, route[0], route[1], write);
          status = 202;
          const exportId = result.export.exportId;
          queueMicrotask(() => {
            service.processExport(exportId).catch(() => {});
          });
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/exports\/([^/]+)\/download$/u
          ))
        ) {
          const download = await service.downloadExport(
            actor,
            route[0],
            route[1],
            url.searchParams.get("token")
          );
          return new Response(download.bytes, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition": `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/gu, "_")}"`,
              "Content-Type": "application/zip",
              "Digest": `sha-256=${Buffer.from(download.sha256, "hex").toString("base64")}`,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
        } else if (
          method === "DELETE" &&
          (route = match(pathname, /^\/api\/v1\/projects\/([^/]+)$/u))
        ) {
          result = await service.deleteProject(actor, route[0], write);
        } else if (method === "GET" && pathname === "/api/v1/domains/search") {
          result = await service.searchDomains(actor, url.searchParams.get("query"));
        } else if (method === "POST" && pathname === "/api/v1/domain-quotes") {
          result = await service.createDomainQuote(actor, write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/organizations\/([^/]+)\/registrant-contacts$/u
          ))
        ) {
          result = await service.saveRegistrantContact(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-quotes\/([^/]+)\/consents$/u
          ))
        ) {
          result = await service.acceptDomainConsent(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/domain-orders$/u
          ))
        ) {
          result = await service.createDomainOrder(actor, route[0], write);
          status = 201;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/payment$/u
          ))
        ) {
          const redirect =
            await service.getDomainPaymentRedirect(
              actor,
              route[0],
              url.searchParams.get("projectId")
            );
          return new Response(null, {
            status: 303,
            headers: {
              "Cache-Control": "no-store",
              "Location": redirect.url,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domain-orders\/([^/]+)$/u))
        ) {
          result = await service.getDomainOrder(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/domain-orders$/u
          ))
        ) {
          result = await service.listDomainOrders(actor, route[0]);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/price-checks$/u
          ))
        ) {
          result = await service.refreshDomainPrice(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domain-orders\/([^/]+)\/registration-requests$/u
          ))
        ) {
          result = await service.requestDomainRegistration(actor, route[0], write);
          status = 202;
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/organizations\/([^/]+)\/domains$/u
          ))
        ) {
          result = await service.listDomains(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)$/u))
        ) {
          result = await service.getDomain(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "GET" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)\/dns-records$/u))
        ) {
          result = await service.listDnsRecords(
            actor,
            route[0],
            url.searchParams.get("projectId")
          );
        } else if (
          method === "PUT" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/dns-records\/([^/]+)$/u
          ))
        ) {
          result = await service.upsertDnsRecord(actor, route[0], route[1], write);
        } else if (
          method === "DELETE" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/dns-records\/([^/]+)$/u
          ))
        ) {
          result = await service.deleteDnsRecord(actor, route[0], route[1], write);
        } else if (
          method === "PUT" &&
          (route = match(pathname, /^\/api\/v1\/domains\/([^/]+)\/auto-renew$/u))
        ) {
          result = await service.setDomainAutoRenew(actor, route[0], write);
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/renewal-quotes$/u
          ))
        ) {
          result = await service.requestDomainRenewalQuote(actor, route[0], write);
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/domains\/([^/]+)\/transfer-out-requests$/u
          ))
        ) {
          result = await service.requestDomainTransferOut(actor, route[0], write);
          status = 202;
        } else {
          throw new HostedError("NOT_FOUND", "The requested route was not found.", {
            status: 404
          });
        }

        return json(result, status, headers);
      } catch (error) {
        const presented = publicError(error, requestId);
        return json(presented.body, presented.status, {
          "X-Request-Id": requestId
        });
      }
    }
  });
}
