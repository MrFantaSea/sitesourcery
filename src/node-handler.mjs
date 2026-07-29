export function createNodeHandler(runtime) {
  if (!runtime || typeof runtime.fetch !== "function") {
    throw new TypeError("A self-host runtime is required");
  }
  return async function nodeHandler(incoming, outgoing) {
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
    const request = new Request(
      `${protocol}://${authority}${incoming.url ?? "/"}`,
      { method, headers }
    );
    const result = await runtime.fetch(request);
    outgoing.statusCode = result.status;
    for (const [name, value] of result.headers) outgoing.setHeader(name, value);
    if (!result.body || method === "HEAD") {
      outgoing.end();
      return;
    }
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  };
}
