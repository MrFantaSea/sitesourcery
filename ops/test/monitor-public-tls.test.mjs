import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import test from "node:test";

import { probeTlsAuthority } from "../independent-monitor-ports.mjs";
import { certificateConfigurationFromEnvironment } from "../monitor-held.mjs";
import { createProductionMonitoringProbes } from "../monitor-ports.mjs";

const HELD = Object.freeze({ publication: "held", dns: "held" });
const LIVE = Object.freeze({ publication: "approved", dns: "held" });
const HOSTNAME = "proof.sitesourcery.me";
const EXPIRY = "2027-01-15T00:00:00.000Z";
const EVIDENCE = Object.freeze({
  authorized: true, protocol: "TLSv1.3", notAfter: EXPIRY,
  certificateSha256: "a".repeat(64)
});

function production(options = {}) {
  return createProductionMonitoringProbes({
    databaseUrl: "postgresql://monitor:fixture@127.0.0.1:1/not_connected",
    dataRoot: os.tmpdir(), backupDestinationRoot: os.tmpdir(),
    sourceFailureDomainId: "monitor-tls-fixture", expectedOperationsState: LIVE,
    certificateMode: "public_tls", certificateHostname: HOSTNAME,
    ...options
  });
}

function connection({ event = "secureConnect", authorized = true, protocol = "TLSv1.3",
  certificate = { valid_to: EXPIRY, raw: Buffer.from("test-only-peer-certificate") } } = {}) {
  const socket = new EventEmitter();
  socket.authorized = authorized;
  socket.getProtocol = () => protocol;
  socket.getPeerCertificate = () => certificate;
  socket.destroy = () => { socket.destroyed = true; };
  const connectImpl = options => {
    socket.options = options;
    if (event) queueMicrotask(() => socket.emit(event,
      event === "error" ? new Error("certificate validation failed") : undefined));
    return socket;
  };
  return { socket, connectImpl };
}

test("public TLS requires explicit mode; held and legacy file environment selection stay intact", () => {
  const file = { SITESOURCERY_MONITOR_CERTIFICATE_FILE: "/etc/sitesourcery/certificate.pem",
    SITESOURCERY_MONITOR_CERTIFICATE_HOSTNAME: HOSTNAME };
  assert.deepEqual(certificateConfigurationFromEnvironment(file, LIVE), {
    certificateMode: "file", certificateFile: file.SITESOURCERY_MONITOR_CERTIFICATE_FILE,
    certificateHostname: HOSTNAME
  });
  assert.deepEqual(certificateConfigurationFromEnvironment({
    SITESOURCERY_MONITOR_CERTIFICATE_MODE: "public_tls",
    SITESOURCERY_MONITOR_CERTIFICATE_HOSTNAME: HOSTNAME
  }, LIVE), { certificateMode: "public_tls", certificateFile: null, certificateHostname: HOSTNAME });
  assert.deepEqual(certificateConfigurationFromEnvironment({}, HELD), {
    certificateMode: "file", certificateFile: null, certificateHostname: null
  });
  assert.throws(() => certificateConfigurationFromEnvironment({
    SITESOURCERY_MONITOR_CERTIFICATE_HOSTNAME: HOSTNAME
  }, LIVE), /CERTIFICATE_FILE is required/u);
  assert.throws(() => certificateConfigurationFromEnvironment({
    ...file, SITESOURCERY_MONITOR_CERTIFICATE_MODE: "automatic"
  }, LIVE), /CERTIFICATE_MODE is invalid/u);
  assert.throws(() => certificateConfigurationFromEnvironment({
    SITESOURCERY_MONITOR_CERTIFICATE_MODE: "public_tls"
  }, LIVE), /CERTIFICATE_HOSTNAME is required/u);
});

test("exactly held edges never connect, but either live edge dimension requires certificate configuration", async () => {
  const held = production({ expectedOperationsState: HELD, certificateHostname: null,
    tlsProbeImpl: () => assert.fail("held monitor must not connect") });
  try { assert.deepEqual(await held.probes.certificate(), { held: true }); }
  finally { await held.close(); }
  for (const state of [LIVE, { publication: "held", dns: "approved" }]) {
    assert.throws(() => production({ expectedOperationsState: state, certificateHostname: null }),
      /certificate monitoring configuration is required/u);
  }
});

test("public TLS refuses URLs, wildcards, IPs, malformed DNS names and unbounded handshakes", () => {
  for (const certificateHostname of ["", "localhost", "127.0.0.1", "::1", "*.sitesourcery.me",
    "https://sitesourcery.me", "sitesourcery.me:443", "sitesourcery.me/path", "a@sitesourcery.me",
    "sitesourcery.me.", "Sitesourcery.me", " sitesourcery.me", "a..me", "-a.me", "a-.me",
    "a_b.me", `${"a".repeat(64)}.me`, `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`]) {
    assert.throws(() => production({ certificateHostname }), /certificate monitoring configuration/u);
  }
  for (const timeoutMs of [0, 249, 30_001, Infinity, NaN, "3000"]) {
    assert.throws(() => production({ timeoutMs }), /certificate monitoring configuration/u);
  }
  assert.throws(() => production({ certificateMode: "unknown" }), /certificate monitoring configuration/u);
  assert.throws(() => production({ tlsProbeImpl: null }), /certificate monitoring configuration/u);
});

test("public TLS adapts only authenticated live evidence and never reads a local leaf", async () => {
  const calls = [];
  const monitor = production({ certificateFile: "/does-not-exist/no-static-leaf.pem", timeoutMs: 10_000,
    tlsProbeImpl: async options => { calls.push(options); return EVIDENCE; } });
  try {
    assert.deepEqual(await monitor.probes.certificate(), { valid: true, notAfter: EXPIRY });
    assert.deepEqual(calls, [{ hostname: HOSTNAME, port: 443, timeoutMs: 10_000 }]);
  } finally { await monitor.close(); }
  for (const evidence of [null, { ...EVIDENCE, authorized: false }, { ...EVIDENCE, protocol: "TLSv1" },
    { ...EVIDENCE, notAfter: null }, { ...EVIDENCE, notAfter: "invalid" },
    { ...EVIDENCE, certificateSha256: "" }]) {
    const invalid = production({ tlsProbeImpl: async () => evidence });
    try { await assert.rejects(invalid.probes.certificate(), /TLS certificate authority is invalid/u); }
    finally { await invalid.close(); }
  }
});

test("the shared handshake sends exact SNI and requires normal CA/hostname authorization", async () => {
  const { socket, connectImpl } = connection();
  const monitor = production({ tlsProbeImpl: options => probeTlsAuthority({ ...options, connectImpl }) });
  try {
    assert.deepEqual(await monitor.probes.certificate(), { valid: true, notAfter: EXPIRY });
    assert.deepEqual(socket.options, {
      host: HOSTNAME, port: 443, servername: HOSTNAME, rejectUnauthorized: true
    });
    assert.equal(socket.destroyed, true);
  } finally { await monitor.close(); }
  // Node's unmodified TLS default validates CA chain and servername before secureConnect.
  for (const override of [{ event: "error" }, { authorized: false }, { protocol: "TLSv1" },
    { certificate: {} }, { certificate: { raw: Buffer.from("peer"), valid_to: "invalid" } }]) {
    const failed = connection(override);
    await assert.rejects(probeTlsAuthority({ hostname: HOSTNAME, connectImpl: failed.connectImpl }));
    assert.equal(failed.socket.destroyed, true);
  }
});

test("the shared handshake deadline destroys a stalled connection without sending application data", async () => {
  const { socket, connectImpl } = connection({ event: null });
  // The real socket keeps the process alive; this inert socket needs an equivalent test-only handle.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(probeTlsAuthority({ hostname: HOSTNAME, timeoutMs: 250, connectImpl }), /timed out/u);
    assert.equal(socket.destroyed, true);
    assert.equal(socket.write, undefined);
  } finally { clearTimeout(keepAlive); }
});

test("legacy file mode still checks the configured file and hostname without any TLS connection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sitesourcery-monitor-certificate-"));
  const certificateFile = path.join(directory, "fixture.pem");
  await writeFile(certificateFile, rootCertificates[0], { mode: 0o600 });
  const monitor = production({ certificateMode: "file", certificateFile,
    tlsProbeImpl: () => assert.fail("file monitor must not connect") });
  try {
    const certificate = new X509Certificate(rootCertificates[0]);
    assert.deepEqual(await monitor.probes.certificate(), {
      valid: Boolean(certificate.checkHost(HOSTNAME)), notAfter: new Date(certificate.validTo).toISOString()
    });
  } finally {
    await monitor.close();
    await rm(directory, { recursive: true, force: true });
  }
});
