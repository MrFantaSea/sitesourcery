import { Readable } from "node:stream";

export function createNodeHandler(api) {
  if (!api || typeof api.fetch !== "function") {
    throw new TypeError("A hosted API runtime is required.");
  }
  return async function nodeHandler(incoming, outgoing) {
    try {
      const authority = incoming.headers.host;
      if (typeof authority !== "string") {
        outgoing.statusCode = 404;
        outgoing.end("Not Found");
        return;
      }
      const method = String(incoming.method ?? "GET").toUpperCase();
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
      const init = { method, headers };
      if (method !== "GET" && method !== "HEAD") {
        init.body = Readable.toWeb(incoming);
        init.duplex = "half";
      }
      const request = new Request(
        `${protocol}://${authority}${incoming.url ?? "/"}`,
        init
      );
      const response = await api.fetch(request);
      outgoing.statusCode = response.status;
      for (const [name, value] of response.headers) outgoing.setHeader(name, value);
      if (!response.body || method === "HEAD") {
        outgoing.end();
        return;
      }
      Readable.fromWeb(response.body).pipe(outgoing);
    } catch {
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500;
        outgoing.setHeader("Content-Type", "application/json; charset=utf-8");
        outgoing.setHeader("Cache-Control", "no-store");
      }
      outgoing.end(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: "The Site Sourcery service could not complete this request."
          }
        })
      );
    }
  };
}
