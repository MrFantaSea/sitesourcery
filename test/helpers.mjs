import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SelfHostRuntime } from "../src/index.mjs";

export const NOW = "2026-07-28T20:00:00.000Z";

export async function testRuntime({ held = false, root = null } = {}) {
  const selectedRoot =
    root ?? (await mkdtemp(path.join(os.tmpdir(), "sitesourcery-selfhost-test-")));
  const runtime = await SelfHostRuntime.open({
    root: selectedRoot,
    publicationHeld: held,
    clock: () => NOW,
    platformBaseDomain: "sites.sitesourcery.me"
  });
  return { runtime, root: selectedRoot };
}

export function files(label) {
  return [
    {
      path: "index.html",
      bytes: Buffer.from(`<!doctype html><h1>${label}</h1>`, "utf8"),
      contentType: "text/html; charset=utf-8"
    },
    {
      path: "assets/app.js",
      bytes: Buffer.from(`globalThis.release=${JSON.stringify(label)};`, "utf8"),
      contentType: "text/javascript; charset=utf-8"
    },
    {
      path: "assets/style.css",
      bytes: Buffer.from(`body::before{content:${JSON.stringify(label)}}`, "utf8"),
      contentType: "text/css; charset=utf-8"
    }
  ];
}

export async function installAndActivate(
  runtime,
  {
    projectId = "project-one",
    releaseId = "release-one",
    hostname = "customer.example",
    source = "custom",
    label = "one",
    tlsState = "approved"
  } = {}
) {
  await runtime.installRelease({
    projectId,
    releaseId,
    files: files(label)
  });
  await runtime.reserveHostname({
    hostname,
    projectId,
    source,
    tlsState
  });
  let binding = runtime.control.lookup(hostname);
  await runtime.activate({
    hostname,
    releaseId,
    expectedRevision: binding.revision
  });
  binding = runtime.control.lookup(hostname);
  await runtime.setHostnameGate({
    hostname,
    expectedRevision: binding.revision,
    status: "active"
  });
  return runtime.control.lookup(hostname);
}

export function tenantRequest(hostname, pathname = "/", options = {}) {
  return new Request(`https://${hostname}${pathname}`, {
    ...options,
    headers: { host: hostname, ...options.headers }
  });
}

export function controlRequest(pathname) {
  return new Request(`http://127.0.0.1:8080${pathname}`, {
    headers: { host: "127.0.0.1:8080" }
  });
}
