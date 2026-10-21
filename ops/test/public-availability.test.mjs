import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runPublicAvailability, availabilitySummary } from "../public-availability.mjs";

const now = () => new Date("2026-10-20T22:00:00.000Z");
const origin = "https://sitesourcery.com";
const privacy = Buffer.from("fixture immutable privacy artifact");
const target = JSON.parse(await readFile(new URL("../public-availability-target.json", import.meta.url), "utf8"));
target.privacyArtifact.sha256 = createHash("sha256").update(privacy).digest("hex");
target.privacyArtifact.byteCount = privacy.length;

function fixture({ mutateReady, mutateLive, content = privacy, tlsFailure = false, readyResponse } = {}) {
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, undefined); // GET only
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    let body;
    if (url.endsWith("/api/v1/ready")) {
      if (readyResponse) return readyResponse(url);
      body = { schema: "sitesourcery.hosted-readiness/v1", service: "sitesourcery-hosted-runtime",
        ready: true, state: "ready", code: "ready", ageMs: 0, release: structuredClone(target.hostedRelease) };
      mutateReady?.(body);
    } else if (url.endsWith("/api/v1/live")) {
      body = { schema: "sitesourcery.hosted-liveness/v1", service: "sitesourcery-hosted-runtime",
        live: true, release: structuredClone(target.hostedRelease) };
      mutateLive?.(body);
    } else if (url.includes("/legal/privacy/versions/")) {
      body = content;
    } else body = "homepage";
    const response = new Response(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const tlsProbeImpl = async ({ hostname, port }) => {
    assert.equal(hostname, "sitesourcery.com");
    assert.equal(port, 443);
    if (tlsFailure) throw new Error("private upstream detail");
    return { authorized: true, protocol: "TLSv1.3", notAfter: "2027-01-01T00:00:00.000Z", certificateSha256: "a".repeat(64) };
  };
  return { fetchImpl, tlsProbeImpl, now, calls };
}

test("healthy external observation proves all four edge checks and fresh exact database readiness", async () => {
  const ports = fixture();
  const report = await runPublicAvailability(target, ports);
  assert.equal(report.ok, true);
  assert.equal(report.edge.checks.length, 4);
  assert.equal(report.readiness.ok, true);
  assert.equal(ports.calls.length, 4);
  assert.match(availabilitySummary(report), /database readiness: PASS/u);
});

test("alive API cannot hide unavailable database, stale readiness or wrong installed schema", async () => {
  for (const mutateReady of [
    body => { body.ready = false; },
    body => { body.ageMs = 15_001; },
    body => { body.ageMs = -1; },
    body => { body.ageMs = "0"; },
    body => { body.state = "degraded"; },
    body => { body.release.migrationCount += 1; },
    body => { body.release.epochId = "automatic-service-mail-20261020"; },
    body => { body.release.bindingSha256 = "fc6bcb61ca897ab304b4c51d1e553c8283a968beb041a973accaea710fbb8f2d"; },
    body => { body.release.candidateCommitSha = "b".repeat(40); }
  ]) {
    const report = await runPublicAvailability(target, fixture({ mutateReady }));
    assert.equal(report.edge.ok, true);
    assert.equal(report.ok, false);
    assert.equal(report.readiness.code, "PUBLIC_READINESS_INVALID");
  }
});

test("readiness rejects redirects, non-200, malformed and oversized responses without logging bodies", async () => {
  const secret = "never-print-upstream-details";
  let cancelled = false;
  const responses = [
    () => { throw new Error(secret); },
    url => Object.defineProperty(new Response(secret, { status: 503 }), "url", { value: url }),
    url => Object.defineProperty(new Response(secret), "url", { value: url }),
    url => ({ status: 200, url, body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
      cancel() { cancelled = true; }
    }) }),
    url => Object.defineProperty(new Response(JSON.stringify({
      schema: "sitesourcery.hosted-readiness/v1", service: "sitesourcery-hosted-runtime",
      ready: true, state: "ready", code: "ready", ageMs: 0, release: target.hostedRelease
    })), "url", { value: `${url}/redirected` })
  ];
  for (const readyResponse of responses) {
    const report = await runPublicAvailability(target, fixture({ readyResponse }));
    assert.equal(report.ok, false);
    assert.doesNotMatch(JSON.stringify(report) + availabilitySummary(report), new RegExp(secret, "u"));
  }
  assert.equal(cancelled, true);
});

test("edge artifact, release and TLS failures remain visible even when database readiness passes", async () => {
  for (const options of [
    { content: Buffer.from("corrupt artifact") },
    { mutateLive: body => { body.release.candidateTreeSha = "b".repeat(40); } },
    { mutateLive: body => { body.release.epochId = "automatic-service-mail-20261020"; } },
    { mutateLive: body => { body.release.bindingSha256 = "fc6bcb61ca897ab304b4c51d1e553c8283a968beb041a973accaea710fbb8f2d"; } },
    { tlsFailure: true }
  ]) {
    const report = await runPublicAvailability(target, fixture(options));
    assert.equal(report.ok, false);
    assert.equal(report.readiness.ok, true);
    assert.ok(report.edge.alerts.length > 0);
    assert.doesNotMatch(JSON.stringify(report), /private upstream detail/u);
  }
});

test("bad target fails before network and cannot substitute a destination or accept unknown fields", async () => {
  for (const mutate of [
    value => { value.url = "https://example.com/"; },
    value => { value.privacyArtifact.version = "../../private"; },
    value => { value.privacyArtifact.sha256 = "x"; },
    value => { value.privacyArtifact.byteCount = 2 ** 22; },
    value => { value.hostedRelease.extra = "unexpected"; },
    value => { value.hostedRelease.candidateTreeSha = "invalid"; }
  ]) {
    const invalid = structuredClone(target);
    mutate(invalid);
    const ports = fixture();
    await assert.rejects(runPublicAvailability(invalid, ports));
    assert.equal(ports.calls.length, 0);
  }
});

test("observer workflow keeps its public-only standard runner and credential/storage boundary", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/public-availability.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.event\.repository\.private == false/u);
  assert.match(workflow, /github\.repository == 'MrFantaSea\/sitesourcery'/u);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 3/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.doesNotMatch(workflow, /secrets\.|: write\b|upload-artifact|actions\/cache|cache:|npm (?:ci|install)|self-hosted|pull_request_target/u);
  for (const line of workflow.split("\n").filter(item => item.includes("uses:"))) {
    assert.match(line, /@[a-f0-9]{40}\b/u);
  }
});
