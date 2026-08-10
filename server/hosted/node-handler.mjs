import { isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DEFAULT_INGRESS_POLICY,
  validateIngressPolicy
} from "./ingress-policy.mjs";

const DEADLINE = Symbol("request-deadline");

function sendJson(outgoing, status, code, message, retryAfter = null) {
  if (outgoing.destroyed) return;
  if (!outgoing.headersSent) {
    outgoing.statusCode = status;
    outgoing.setHeader("Content-Type", "application/json; charset=utf-8");
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    if (retryAfter !== null) {
      outgoing.setHeader("Retry-After", String(retryAfter));
    }
  }
  outgoing.end(JSON.stringify({ error: { code, message } }));
}

function canonicalAddress(value) {
  const selected = String(value ?? "").trim().toLowerCase();
  const mapped = selected.startsWith("::ffff:")
    ? selected.slice("::ffff:".length)
    : selected;
  return isIP(mapped) > 0 ? mapped : null;
}

function loopback(address) {
  return address === "::1" || address?.startsWith("127.");
}

function clientAddress(incoming) {
  const remote = canonicalAddress(incoming.socket?.remoteAddress);
  if (loopback(remote)) {
    const forwarded = incoming.headers["x-real-ip"];
    if (typeof forwarded === "string" && !forwarded.includes(",")) {
      const selected = canonicalAddress(forwarded);
      if (selected) return selected;
    }
  }
  return remote ?? "unavailable";
}

function declaredLength(incoming) {
  const value = incoming.headers["content-length"];
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value)
  ) {
    return "invalid";
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

export function createNodeHandler(
  api,
  ingressPolicy = DEFAULT_INGRESS_POLICY
) {
  if (!api || typeof api.fetch !== "function") {
    throw new TypeError("A hosted API runtime is required.");
  }
  const ingress = validateIngressPolicy(ingressPolicy);
  const maximumBodyBytes = Math.max(
    ingress.body.jsonBytes,
    ingress.body.webhookBytes
  );
  let activeRequests = 0;

  return async function nodeHandler(incoming, outgoing) {
    if (activeRequests >= ingress.node.maxConcurrentRequests) {
      sendJson(
        outgoing,
        503,
        "SERVER_BUSY",
        "Site Sourcery is busy. Retry this request shortly.",
        1
      );
      return;
    }
    activeRequests += 1;
    let releaseInFinally = true;
    let deadlineTimer = null;
    const controller = new AbortController();
    const abortForDisconnect = () => {
      controller.abort(new Error("client disconnected"));
    };
    incoming.once?.("aborted", abortForDisconnect);
    try {
      const authority = incoming.headers.host;
      if (typeof authority !== "string") {
        outgoing.statusCode = 404;
        outgoing.end("Not Found");
        return;
      }
      const method = String(incoming.method ?? "GET").toUpperCase();
      const contentLength = declaredLength(incoming);
      if (contentLength === "invalid") {
        sendJson(
          outgoing,
          400,
          "INVALID_CONTENT_LENGTH",
          "Content-Length is invalid."
        );
        return;
      }
      if (contentLength !== null && contentLength > maximumBodyBytes) {
        sendJson(
          outgoing,
          413,
          "REQUEST_TOO_LARGE",
          "Request body is too large."
        );
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      const forwarded = String(incoming.headers["x-forwarded-proto"] ?? "")
        .split(",", 1)[0]
        .trim()
        .toLowerCase();
      const protocol =
        forwarded === "https" || incoming.socket?.encrypted ? "https" : "http";
      const init = { method, headers, signal: controller.signal };
      if (method !== "GET" && method !== "HEAD") {
        init.body = Readable.toWeb(incoming);
        init.duplex = "half";
      }
      const request = new Request(
        `${protocol}://${authority}${incoming.url ?? "/"}`,
        init
      );
      const fetchPromise = Promise.resolve().then(() =>
        api.fetch(request, {
          clientAddress: clientAddress(incoming)
        })
      );
      const deadlinePromise = new Promise((resolve) => {
        deadlineTimer = setTimeout(
          () => resolve(DEADLINE),
          ingress.node.requestDeadlineMs
        );
        deadlineTimer.unref?.();
      });
      const selected = await Promise.race([
        fetchPromise,
        deadlinePromise
      ]);
      if (selected === DEADLINE) {
        controller.abort(new Error("request deadline exceeded"));
        releaseInFinally = false;
        void fetchPromise.finally(() => {
          activeRequests -= 1;
        }).catch(() => {});
        sendJson(
          outgoing,
          504,
          "REQUEST_DEADLINE_EXCEEDED",
          "The request took too long. Retry with the same idempotency key.",
          1
        );
        return;
      }
      const response = selected;
      if (!(response instanceof Response)) {
        throw new TypeError("Hosted API returned an invalid response.");
      }
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) {
        outgoing.setHeader(name, value);
      }
      if (!response.body || method === "HEAD") {
        outgoing.end();
        return;
      }
      await pipeline(
        Readable.fromWeb(response.body),
        outgoing
      );
    } catch {
      if (!outgoing.destroyed && !outgoing.writableEnded) {
        sendJson(
          outgoing,
          500,
          "INTERNAL_ERROR",
          "The Site Sourcery service could not complete this request."
        );
      }
    } finally {
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      incoming.off?.("aborted", abortForDisconnect);
      if (releaseInFinally) activeRequests -= 1;
    }
  };
}
