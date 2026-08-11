import { createHash } from "node:crypto";
import tls from "node:tls";

import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  HOSTED_RELEASE_IDENTITY_V2_SCHEMA
} from "./final-release-epoch-v2.mjs";
import {
  createIndependentProbeResult,
  validateIndependentReleaseIdentity
} from "./independent-monitor-runtime.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_CONTENT_BYTES = 1024 * 1024;
const MAXIMUM_TUNNEL_BYTES = 4096;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;

function exactHostedReleaseIdentity(value, release) {
  const fields = [
    "schema",
    "state",
    "epochId",
    "bindingSha256",
    "candidateCommitSha",
    "candidateTreeSha",
    "migrationCount",
    "latestMigration"
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...fields].sort()) ||
    value.schema !== HOSTED_RELEASE_IDENTITY_V2_SCHEMA ||
    value.state !== "verified_held" ||
    value.epochId !== release.epochId ||
    value.bindingSha256 !== release.bindingSha256 ||
    value.candidateCommitSha !== release.publicArtifactCommitSha ||
    !COMMIT_SHA.test(value.candidateTreeSha) ||
    !Number.isSafeInteger(value.migrationCount) ||
    value.migrationCount < 1 ||
    typeof value.latestMigration !== "string" ||
    !MIGRATION.test(value.latestMigration)
  ) {
    throw new Error(
      "Independent hosted release identity is invalid."
    );
  }
  return Object.freeze(structuredClone(value));
}

function exactHttpsUrl(value, field, { apex = false } = {}) {
  let selected;
  try {
    selected = new URL(value);
  } catch {
    throw new Error(`${field} must be an exact HTTPS URL.`);
  }
  if (
    selected.protocol !== "https:" ||
    selected.username ||
    selected.password ||
    selected.hash ||
    selected.search ||
    (apex && selected.pathname !== "/")
  ) {
    throw new Error(`${field} must be an exact HTTPS URL.`);
  }
  return selected;
}

function timeout(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < 250 ||
    value > 30_000
  ) {
    throw new Error(
      "Independent probe timeout must be from 250 through 30000 milliseconds."
    );
  }
  return value;
}

async function boundedBody(response, maximumBytes) {
  if (!response?.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      byteCount += chunk.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel("independent probe body limit exceeded").catch(() => {});
        throw new Error("Independent probe body exceeded its bound.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteCount);
}

async function fetchExact(fetchImpl, url, timeoutMs, accept) {
  return fetchImpl(url, {
    cache: "no-store",
    headers: { Accept: accept },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs)
  });
}

export function probeTlsAuthority({
  hostname,
  port = 443,
  timeoutMs = 3000,
  connectImpl = tls.connect
}) {
  if (
    typeof hostname !== "string" ||
    hostname.length < 1 ||
    hostname.length > 253 ||
    /[^a-z0-9.-]/u.test(hostname) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof connectImpl !== "function"
  ) {
    throw new Error("Independent TLS probe configuration is invalid.");
  }
  const selectedTimeout = timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connectImpl({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: true
    });
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error("Independent TLS probe timed out."));
    }, selectedTimeout);
    timer.unref?.();
    socket.once("error", (error) => finish(error));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      const notAfter = new Date(certificate?.valid_to);
      const raw = Buffer.from(certificate?.raw ?? []);
      if (
        socket.authorized !== true ||
        !["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol()) ||
        Number.isNaN(notAfter.valueOf()) ||
        raw.byteLength === 0
      ) {
        finish(new Error("Independent TLS authority is invalid."));
        return;
      }
      finish(null, {
        authorized: true,
        protocol: socket.getProtocol(),
        notAfter: notAfter.toISOString(),
        certificateSha256:
          createHash("sha256").update(raw).digest("hex")
      });
    });
  });
}

export function createIndependentEdgeProbes({
  fetchImpl = globalThis.fetch,
  tlsProbeImpl = probeTlsAuthority,
  releaseIdentity,
  expectedHostedReleaseIdentity,
  apexUrl,
  contentUrl,
  tunnelUrl,
  tlsHostname,
  tlsPort = 443,
  expectedContentSha256,
  expectedContentByteCount,
  minimumTlsValidityMs = 21 * 24 * 60 * 60 * 1000,
  timeoutMs = 3000,
  now = () => new Date()
}) {
  if (
    typeof fetchImpl !== "function" ||
    typeof tlsProbeImpl !== "function"
  ) {
    throw new Error("Independent probe ports are required.");
  }
  const release = validateIndependentReleaseIdentity(releaseIdentity);
  const hostedReleaseIdentity = exactHostedReleaseIdentity(
    expectedHostedReleaseIdentity,
    release
  );
  const apex = exactHttpsUrl(apexUrl, "Apex probe URL", { apex: true });
  const content = exactHttpsUrl(contentUrl, "Content probe URL");
  const tunnel = exactHttpsUrl(tunnelUrl, "Tunnel probe URL");
  if (
    content.hostname !== apex.hostname ||
    tunnel.hostname !== apex.hostname ||
    tlsHostname !== apex.hostname ||
    typeof expectedContentSha256 !== "string" ||
    !SHA256.test(expectedContentSha256) ||
    !Number.isSafeInteger(expectedContentByteCount) ||
    expectedContentByteCount < 1 ||
    expectedContentByteCount > MAXIMUM_CONTENT_BYTES ||
    !Number.isSafeInteger(minimumTlsValidityMs) ||
    minimumTlsValidityMs < 60_000 ||
    minimumTlsValidityMs > 180 * 24 * 60 * 60 * 1000
  ) {
    throw new Error("Independent edge probe configuration is invalid.");
  }
  const selectedTimeout = timeout(timeoutMs);

  return Object.freeze({
    async apex() {
      const response = await fetchExact(
        fetchImpl,
        apex,
        selectedTimeout,
        "text/html"
      );
      await response.body?.cancel().catch(() => {});
      const ok =
        response.status === 200 &&
        response.url === apex.toString();
      return createIndependentProbeResult("apex", {
        ok,
        code: ok ? null : "APEX_CANONICAL_RESPONSE_INVALID",
        evidence: ok
          ? { status: 200, canonical: true }
          : null
      });
    },

    async content() {
      const response = await fetchExact(
        fetchImpl,
        content,
        selectedTimeout,
        "text/html"
      );
      const bytes = await boundedBody(response, expectedContentByteCount);
      const actualSha256 =
        createHash("sha256").update(bytes).digest("hex");
      const ok =
        response.status === 200 &&
        response.url === content.toString() &&
        bytes.byteLength === expectedContentByteCount &&
        actualSha256 === expectedContentSha256;
      return createIndependentProbeResult("content", {
        ok,
        code: ok ? null : "CONTENT_ARTIFACT_MISMATCH",
        evidence: ok
          ? {
              status: 200,
              byteCount: bytes.byteLength,
              contentSha256: actualSha256,
              releaseBindingSha256: release.bindingSha256
            }
          : null
      });
    },

    async tls() {
      const observedAt = now();
      if (
        !(observedAt instanceof Date) ||
        Number.isNaN(observedAt.valueOf())
      ) {
        throw new Error("Independent TLS clock is invalid.");
      }
      const evidence = await tlsProbeImpl({
        hostname: tlsHostname,
        port: tlsPort,
        timeoutMs: selectedTimeout
      });
      const notAfter = new Date(evidence?.notAfter);
      const ok =
        evidence?.authorized === true &&
        ["TLSv1.2", "TLSv1.3"].includes(evidence?.protocol) &&
        typeof evidence?.certificateSha256 === "string" &&
        SHA256.test(evidence.certificateSha256) &&
        !Number.isNaN(notAfter.valueOf()) &&
        notAfter - observedAt >= minimumTlsValidityMs;
      return createIndependentProbeResult("tls", {
        ok,
        code: ok ? null : "TLS_AUTHORITY_INVALID",
        evidence: ok
          ? {
              authorized: true,
              protocol: evidence.protocol,
              notAfter: notAfter.toISOString(),
              certificateSha256: evidence.certificateSha256
            }
          : null
      });
    },

    async tunnel() {
      const response = await fetchExact(
        fetchImpl,
        tunnel,
        selectedTimeout,
        "application/json"
      );
      const bytes = await boundedBody(response, MAXIMUM_TUNNEL_BYTES);
      let body = null;
      try {
        body = JSON.parse(bytes.toString("utf8"));
      } catch {
        // The fixed failure code deliberately omits response details.
      }
      const expectedBody = {
        schema: "sitesourcery.hosted-liveness/v1",
        live: true,
        service: "sitesourcery-hosted-runtime",
        release: hostedReleaseIdentity
      };
      const ok =
        response.status === 200 &&
        response.url === tunnel.toString() &&
        canonicalJson(body) === canonicalJson(expectedBody);
      return createIndependentProbeResult("tunnel", {
        ok,
        code: ok ? null : "TUNNEL_READINESS_INVALID",
        evidence: ok
          ? {
              status: 200,
              live: true,
              serviceContract: "sitesourcery-hosted-runtime",
              hostedReleaseIdentitySha256: sha256Bytes(
                Buffer.from(
                  `${canonicalJson(hostedReleaseIdentity)}\n`,
                  "utf8"
                )
              )
            }
          : null
      });
    }
  });
}
