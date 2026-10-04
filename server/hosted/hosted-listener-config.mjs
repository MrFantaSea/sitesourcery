export function createHostedListenerConfiguration({
  host = "127.0.0.1",
  port = 8788
} = {}) {
  if (host !== "127.0.0.1") {
    throw new Error(
      "The hosted API must bind to loopback behind the reviewed reverse proxy."
    );
  }
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      "SITESOURCERY_HOSTED_PORT must be an unprivileged TCP port."
    );
  }
  return Object.freeze({ host, port, listener: `${host}:${port}` });
}
