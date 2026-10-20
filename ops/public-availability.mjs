#!/usr/bin/env node

import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "./immutable-evidence.mjs";
import { createIndependentEdgeProbes } from "./independent-monitor-ports.mjs";
import { runIndependentMonitor } from "./independent-monitor-runtime.mjs";

const ORIGIN = "https://sitesourcery.com";
const TIMEOUT_MS = 10_000;
const MAXIMUM_READY_BYTES = 64 * 1024;

function exactKeys(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson(keys.sort());
}

export function publicAvailabilityConfiguration(target) {
  if (!exactKeys(target, ["schema", "hostedRelease", "privacyArtifact"]) ||
      target.schema !== "sitesourcery.public-availability-target/v1" ||
      !exactKeys(target.privacyArtifact, ["version", "sha256", "byteCount"]) ||
      !/^SS-HOSTED-PRIVACY-[0-9]{4}-[0-9]{2}-[0-9]{2}-V[0-9]+$/u.test(target.privacyArtifact.version)) {
    throw new Error("Public availability target is invalid.");
  }
  const release = target.hostedRelease;
  const releaseIdentity = {
    schema: "sitesourcery.independent-release-identity/v1",
    epochId: release?.epochId,
    bindingSha256: release?.bindingSha256,
    publicArtifactCommitSha: release?.candidateCommitSha
  };
  return {
    releaseIdentity,
    expectedHostedReleaseIdentity: release,
    apexUrl: `${ORIGIN}/`,
    contentUrl: `${ORIGIN}/legal/privacy/versions/${target.privacyArtifact.version}/`,
    tunnelUrl: `${ORIGIN}/api/v1/live`,
    tlsHostname: "sitesourcery.com",
    tlsPort: 443,
    expectedContentSha256: target.privacyArtifact.sha256,
    expectedContentByteCount: target.privacyArtifact.byteCount,
    minimumTlsValidityMs: 21 * 24 * 60 * 60 * 1000,
    timeoutMs: TIMEOUT_MS
  };
}

async function probeReadiness(expectedRelease, fetchImpl) {
  try {
    const url = `${ORIGIN}/api/v1/ready`;
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    let bytes = 0;
    const chunks = [];
    if (!response.body) throw new Error("Missing body.");
    const reader = response.body.getReader();
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > MAXIMUM_READY_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error("Body bound exceeded.");
        }
        chunks.push(Buffer.from(item.value));
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    const ok = response.status === 200 && response.url === url &&
      body?.schema === "sitesourcery.hosted-readiness/v1" &&
      body.service === "sitesourcery-hosted-runtime" &&
      body.ready === true && body.state === "ready" && body.code === "ready" &&
      Number.isSafeInteger(body.ageMs) && body.ageMs >= 0 && body.ageMs <= 15_000 &&
      canonicalJson(body.release) === canonicalJson(expectedRelease);
    return { ok, code: ok ? null : "PUBLIC_READINESS_INVALID" };
  } catch {
    // Response bodies, headers and exception text never enter public logs.
    return { ok: false, code: "PUBLIC_READINESS_UNAVAILABLE" };
  }
}

export async function runPublicAvailability(target, {
  fetchImpl = globalThis.fetch,
  tlsProbeImpl,
  now = () => new Date()
} = {}) {
  const configuration = publicAvailabilityConfiguration(target);
  // Reuse the existing bounded HTTPS, exact artifact/release and TLS contracts.
  // Construction validates the full target before any request can occur.
  const probes = createIndependentEdgeProbes({ ...configuration, fetchImpl, tlsProbeImpl, now });
  const [edge, readiness] = await Promise.all([
    runIndependentMonitor({ probes, releaseIdentity: configuration.releaseIdentity, now }),
    probeReadiness(configuration.expectedHostedReleaseIdentity, fetchImpl)
  ]);
  return {
    schema: "sitesourcery.public-availability-report/v1",
    observedAt: edge.observedAt,
    ok: edge.ok && readiness.ok,
    edge,
    readiness
  };
}

export function availabilitySummary(report) {
  const checks = [...report.edge.checks, { name: "database readiness", ...report.readiness }];
  return [
    `Site Sourcery public availability: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    `Observed: ${report.observedAt}`,
    `Expected deployed release: ${report.edge.release.publicArtifactCommitSha}`,
    "",
    ...checks.map(({ name, ok, code }) => `- ${name}: ${ok ? "PASS" : code}`),
    "",
    "Read-only external observation. No customer action, deployment or alert email was sent.",
    "A missing or stale workflow run is unknown, not healthy. GitHub scheduling and notification delivery are not guaranteed.",
    ""
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Arguments are not supported.");
    const target = JSON.parse(await readFile(new URL("./public-availability-target.json", import.meta.url), "utf8"));
    const report = await runPublicAvailability(target);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, availabilitySummary(report));
    }
    process.exitCode = report.ok ? 0 : 1;
  } catch {
    process.stderr.write("PUBLIC_AVAILABILITY_CONFIGURATION_OR_EXECUTION_FAILED\n");
    process.exitCode = 1;
  }
}
