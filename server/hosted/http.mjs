import { MAX_BODY_BYTES, WRITE_METHODS } from "./constants.mjs";
import { HostedError, invariant, publicError } from "./errors.mjs";
import { digest, randomToken } from "./security.mjs";
import {
  createHeldHostedAlakazamAccount
} from "../commerce-v2/hosted-alakazam-account.mjs";
import {
  createHeldHostedAlakazamBilling
} from "../commerce-v2/hosted-alakazam-billing.mjs";
import {
  createHeldHostedDownloadCommerce
} from "../commerce-v2/hosted-download.mjs";
import {
  createHeldHostedCustomServicesAccount
} from "./custom-services-account-hosted.mjs";

const JSON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});
const SESSIONLESS_IDENTITY_WRITES = new Set([
  "/api/v1/auth/register",
  "/api/v1/auth/register/complete",
  "/api/v1/auth/sessions",
  "/api/v1/auth/recovery",
  "/api/v1/auth/recovery/complete"
]);
const HOSTED_OPERATIONS_STATE_SCHEMA =
  "sitesourcery.hosted-operations-state/v1";
const HOSTED_OPERATIONS_STATE_VALUES =
  Object.freeze({
    stripeMode: new Set([
      "held",
      "approved_live"
    ]),
    registrationMailMode: new Set([
      "held",
      "production"
    ]),
    recoveryMailMode: new Set([
      "held",
      "production"
    ]),
    publication: new Set(["held", "approved"]),
    domainRuntime: new Set([
      "held",
      "approved_live"
    ]),
    dns: new Set(["held", "approved_live"])
  });

function operationsStateProjection(readiness) {
  const domains =
    readiness?.providers?.domains ?? {};
  const state = {
    stripeMode: readiness?.payments?.mode,
    registrationMailMode:
      readiness?.registration?.mode,
    recoveryMailMode:
      readiness?.recovery?.mode,
    publication:
      readiness?.publication?.held === true
        ? "held"
        : readiness?.publication?.held === false
          ? "approved"
          : null,
    domainRuntime: domains.mode,
    dns:
      domains.dns === "ready"
        ? "approved_live"
        : domains.dns
  };
  invariant(
    Object.entries(
      HOSTED_OPERATIONS_STATE_VALUES
    ).every(([field, values]) =>
      values.has(state[field])
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted operations state is incomplete or invalid.",
    { status: 500 }
  );
  return Object.freeze(state);
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function publicAuthenticationResult(value) {
  const safe = { ...(value ?? {}) };
  delete safe.sessionToken;
  delete safe.session;
  return safe;
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

function exactRouteBody(value, expected, code, message) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    code,
    message,
    { status: 400 }
  );
  return value;
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

export function createHostedApi(
  service,
  {
    requestIds,
    csrfTokens,
    downloadCommerce = null,
    alakazamAccount = null,
    alakazamBilling = null,
    customServicesAccount = null,
    stripeWebhook = null
  } = {}
) {
  invariant(service && typeof service.authenticate === "function", "RUNTIME_CONFIGURATION_ERROR", "Hosted service is required.", {
    status: 500
  });
  const downloadBoundary =
    downloadCommerce ??
    createHeldHostedDownloadCommerce();
  invariant(
    typeof downloadBoundary.createQuote ===
      "function" &&
      typeof downloadBoundary.prepareCheckout ===
        "function" &&
      typeof downloadBoundary.download === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Download commerce boundary is invalid.",
    { status: 500 }
  );
  const stripeWebhookBoundary =
    stripeWebhook ?? service;
  const alakazamAccountBoundary =
    alakazamAccount ??
    createHeldHostedAlakazamAccount();
  invariant(
    typeof alakazamAccountBoundary.getSnapshot ===
      "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam account boundary is invalid.",
    { status: 500 }
  );
  const alakazamBillingBoundary =
    alakazamBilling ??
    createHeldHostedAlakazamBilling();
  invariant(
    typeof alakazamBillingBoundary.readiness ===
      "function" &&
      typeof alakazamBillingBoundary.createQuote ===
      "function" &&
      typeof alakazamBillingBoundary.createCheckout ===
        "function" &&
      typeof alakazamBillingBoundary.scheduleDowngrade ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing boundary is invalid.",
    { status: 500 }
  );
  const customServicesAccountBoundary =
    customServicesAccount ??
    createHeldHostedCustomServicesAccount();
  invariant(
    typeof customServicesAccountBoundary.getSnapshot === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted custom-services account boundary is invalid.",
    { status: 500 }
  );
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
          pathname ===
            "/_sitesourcery/operations-state"
        ) {
          invariant(
            typeof service.readiness === "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Hosted operations state is unavailable.",
            { status: 500 }
          );
          const readiness =
            await service.readiness();
          return json(
            {
              schema:
                HOSTED_OPERATIONS_STATE_SCHEMA,
              operationsState:
                operationsStateProjection(
                  readiness
                )
            },
            readiness?.ready === true ? 200 : 503,
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

        if (
          method === "GET" &&
          pathname === "/api/v1/capabilities"
        ) {
          invariant(
            typeof service.readiness === "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Hosted capabilities are unavailable.",
            { status: 500 }
          );
          const readiness =
            await service.readiness();
          const download =
            typeof downloadBoundary.readiness ===
              "function"
              ? await downloadBoundary.readiness()
              : {
                  quote: false,
                  payment: false
                };
          const alakazam =
            await alakazamBillingBoundary.readiness();
          const registration =
            readiness?.registration ?? {};
          const recovery =
            readiness?.recovery ?? {};
          const domains =
            readiness?.providers?.domains ?? {};
          return json(
            {
              accountRegistration:
                registration.ready === true &&
                registration.verified === true,
              accountRecoveryEmail:
                recovery.ready === true &&
                recovery.verified === true,
              downloadQuote:
                download.quote === true,
              downloadPayment:
                download.payment === true,
              alakazamQuote:
                alakazam.quote === true,
              alakazamCheckout:
                alakazam.checkout === true,
              alakazamDowngrade:
                alakazam.downgrade === true,
              domainPurchase:
                domains.ready === true &&
                domains.registrar === "ready",
              publishing:
                readiness?.publication?.ready ===
                  true &&
                readiness?.publication?.held ===
                  false
            },
            200,
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
            typeof stripeWebhookBoundary
              .ingestStripeWebhook ===
              "function",
            "RUNTIME_CONFIGURATION_ERROR",
            "Stripe webhook ingestion is unavailable.",
            { status: 500 }
          );
          const result =
            await stripeWebhookBoundary.ingestStripeWebhook({
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

        const actor =
          method === "POST" &&
          SESSIONLESS_IDENTITY_WRITES.has(pathname)
            ? null
            : await service.authenticate(
                cookies.ss_session
              );
        const body = WRITE_METHODS.has(method) ? await readJson(request) : {};
        const write = { ...body, commandId: commandId(request) };
        let route;
        let result;
        let status = 200;
        let headers = { "X-Request-Id": requestId };

        if (method === "POST" && pathname === "/api/v1/auth/register") {
          const staged = await service.register(write);
          const { sessionToken, ...safe } = staged;
          invariant(
            sessionToken === undefined,
            "RUNTIME_CONFIGURATION_ERROR",
            "Unverified registration must not create a session.",
            { status: 500 }
          );
          result = safe;
          status = 202;
        } else if (
          method === "POST" &&
          pathname ===
            "/api/v1/auth/register/complete"
        ) {
          const created =
            await service.completeRegistration(write);
          const sessionToken = created?.sessionToken;
          invariant(
            typeof sessionToken === "string" &&
              sessionToken.length >= 32,
            "RUNTIME_CONFIGURATION_ERROR",
            "Registration activation did not create a valid session.",
            { status: 500 }
          );
          result = publicAuthenticationResult(created);
          status = 201;
          headers["Set-Cookie"] =
            sessionCookie(sessionToken);
        } else if (method === "POST" && pathname === "/api/v1/auth/sessions") {
          const signedIn = await service.signIn(write);
          const sessionToken = signedIn?.sessionToken;
          invariant(
            typeof sessionToken === "string" &&
              sessionToken.length >= 32,
            "RUNTIME_CONFIGURATION_ERROR",
            "Sign-in did not create a valid session.",
            { status: 500 }
          );
          result = publicAuthenticationResult(signedIn);
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
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Alakazam billing.",
            { status: 401 }
          );
          result =
            await alakazamAccountBoundary.getSnapshot(
              actor,
              route[0]
            );
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/custom-services$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing custom services.",
            { status: 401 }
          );
          result =
            await customServicesAccountBoundary.getSnapshot(
              actor,
              route[0]
            );
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
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/download$/u
          ))
        ) {
          const download =
            await downloadBoundary.download(
              actor,
              route[0],
              route[1]
            );
          return new Response(download.bytes, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition":
                `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/gu, "_")}"`,
              "Content-Type":
                "text/html; charset=utf-8",
              "Digest":
                `sha-256=${Buffer.from(download.sha256, "hex").toString("base64")}`,
              "Referrer-Policy": "no-referrer",
              "X-Content-Type-Options": "nosniff",
              "X-Request-Id": requestId
            }
          });
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
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes$/u
          ))
        ) {
          result = await alakazamBillingBoundary.createQuote(
            actor,
            route[0],
            write
          );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes\/([^/]+)\/downgrade-schedule-command$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before using Alakazam billing.",
            { status: 401 }
          );
          const downgradeBody = exactRouteBody(
            body,
            [
              "acceptedDisclosureDigest",
              "quoteDigest"
            ],
            "ALAKAZAM_ROUTE_BINDING_REJECTED",
            "Alakazam downgrade scheduling accepts only the accepted disclosure and quote proof."
          );
          result =
            await alakazamBillingBoundary.scheduleDowngrade(
              actor,
              route[0],
              route[1],
              {
                ...downgradeBody,
                commandId: write.commandId
              }
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam-quotes\/([^/]+)\/checkout-command$/u
          ))
        ) {
          result =
            await alakazamBillingBoundary.createCheckout(
              actor,
              route[0],
              route[1],
              write
            );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/download-quotes$/u
          ))
        ) {
          result = await downloadBoundary.createQuote(
            actor,
            route[0],
            write
          );
          status = 201;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/download-quotes\/([^/]+)\/checkout-command$/u
          ))
        ) {
          result =
            await downloadBoundary.prepareCheckout(
              actor,
              route[0],
              route[1],
              write
            );
          status = 201;
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
