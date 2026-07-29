#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeHandler, SelfHostRuntime } from "../src/index.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const holdPaths = [
  path.join(repositoryRoot, "PUBLICATION_HOLD"),
  "/etc/sitesourcery/PUBLICATION_HOLD"
];
const approvalPath = "/etc/sitesourcery/PUBLICATION_APPROVED";
const dataRoot = path.resolve(
  process.env.SITESOURCERY_DATA_ROOT ?? "/var/lib/sitesourcery/tenant"
);
const bind = process.env.SITESOURCERY_BIND ?? "127.0.0.1";
const port = Number(process.env.SITESOURCERY_PORT ?? "8080");
const controlHost = process.env.SITESOURCERY_CONTROL_HOST ?? "127.0.0.1";
const maximumFileBytes = Number(
  process.env.SITESOURCERY_MAX_FILE_BYTES ?? String(10 * 1024 * 1024)
);
const maximumReleaseBytes = Number(
  process.env.SITESOURCERY_MAX_RELEASE_BYTES ?? String(100 * 1024 * 1024)
);

if (!["127.0.0.1", "::1"].includes(bind)) {
  throw new Error("The Node tenant runtime may bind only to loopback behind Caddy.");
}
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("SITESOURCERY_PORT must be an unprivileged TCP port.");
}

const runtime = await SelfHostRuntime.open({
  root: dataRoot,
  publicationHeld: () =>
    !existsSync(approvalPath) || holdPaths.some((target) => existsSync(target)),
  controlHost,
  maximumFileBytes,
  maximumReleaseBytes
});

const handler = createNodeHandler(runtime);
const server = createServer((request, response) => {
  handler(request, response).catch(() => {
    if (!response.headersSent) response.statusCode = 503;
    response.end("Temporarily unavailable");
  });
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.listen({ host: bind, port }, () => {
  const held =
    !existsSync(approvalPath) || holdPaths.some((target) => existsSync(target));
  process.stdout.write(
    `${JSON.stringify({
      event: "sitesourcery.selfhost.started",
      bind,
      port,
      publicationHeld: held
    })}\n`
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
