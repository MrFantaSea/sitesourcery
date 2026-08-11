import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deadManFromEnvironment
} from "../independent-dead-man.mjs";
import {
  independentMonitorConfiguration,
  independentMonitorFromEnvironment
} from "../independent-monitor.mjs";
import {
  createIndependentEdgeProbes
} from "../independent-monitor-ports.mjs";
import {
  INDEPENDENT_DEAD_MAN_REPORT_SCHEMA,
  createIndependentMonitorHeartbeat,
  createIndependentProbeResult,
  evaluateIndependentDeadMan,
  releaseIdentityFromEpoch,
  runIndependentMonitor,
  validateIndependentDeadManReport,
  validateIndependentMonitorReport
} from "../independent-monitor-runtime.mjs";
import {
  INDEPENDENT_MONITOR_APPROVAL_SCHEMA,
  independentMonitorApprovalDigest,
  validateIndependentMonitorApproval
} from "../independent-monitor-state.mjs";
import {
  FINAL_RELEASE_EPOCH_V2_SCHEMA,
  finalReleaseEpochV2Digest,
  releaseIdentityFromFinalEpochV2,
  validateFinalReleaseEpochV2
} from "../final-release-epoch-v2.mjs";
import {
  ORIGIN_HELD_AUTHORITY
} from "../origin-seal-runtime.mjs";

const NOW = "2026-08-10T12:00:00.000Z";
const LATER = "2026-08-10T12:02:00.000Z";
const opsRoot = new URL("../", import.meta.url);
const epoch = JSON.parse(
  await readFile(
    new URL(
      "releases/shape-epoch-2026-08-10/release-epoch.json",
      opsRoot
    ),
    "utf8"
  )
);
const releaseIdentity = releaseIdentityFromEpoch(epoch);
const v2EpochPayload = {
  schema: FINAL_RELEASE_EPOCH_V2_SCHEMA,
  epochId: "final-epoch-v2-monitor-fixture",
  state: "verified_held",
  bindingSha256: "1".repeat(64),
  evidence: {
    originReleaseInputDigest: "2".repeat(64),
    originSuccessorBindingSha256: "3".repeat(64),
    ciFinalReceiptDigest: "4".repeat(64),
    originSealSha256: "5".repeat(64),
    originInstalledReadbackDigest: "6".repeat(64),
    originInstalledReadbackReceiptSha256: "7".repeat(64)
  },
  identity: {
    sourceCommitSha: "a".repeat(40),
    sourceTreeSha: "b".repeat(40),
    artifactManifestSha256: "8".repeat(64),
    unitManifestSha256: "9".repeat(64),
    environmentSchemaManifestSha256: "a".repeat(64),
    environmentClassificationSha256: "b".repeat(64),
    workerManifestSha256: "c".repeat(64),
    workerContractSha256: "d".repeat(64),
    migrationCount: 67,
    latestMigration: "202608100117_direct_custom_reversal_normalization.sql",
    migrationManifestSha256: "e".repeat(64),
    legalAuthorityDigest: "f".repeat(64),
    legalManifestSha256: "1".repeat(64),
    ingressManifestSha256: "2".repeat(64)
  },
  legalV4Pages: {
    fileCount: 7,
    manifestSha256: "3".repeat(64)
  },
  privacyArtifact: {
    version: epoch.binding.legal.privacyVersion,
    sha256: epoch.binding.artifact.privacySha256,
    byteCount: epoch.binding.artifact.privacyByteCount
  },
  rollback: {
    predecessorCommitSha: "c".repeat(40),
    predecessorTreeSha: "d".repeat(40),
    predecessorArtifactManifestSha256: "4".repeat(64)
  },
  authority: structuredClone(ORIGIN_HELD_AUTHORITY)
};
const v2Epoch = validateFinalReleaseEpochV2({
  ...v2EpochPayload,
  digest: finalReleaseEpochV2Digest(v2EpochPayload)
});
const v2ReleaseIdentity = releaseIdentityFromEpoch(v2Epoch);
const hostedReleaseIdentity =
  releaseIdentityFromFinalEpochV2(v2Epoch);

function healthyProbes() {
  return Object.fromEntries(
    ["apex", "content", "tls", "tunnel"].map((name) => [
      name,
      async () => createIndependentProbeResult(name, {
        ok: true,
        evidence: { verified: true, contract: name }
      })
    ])
  );
}

function response(url, body, status = 200, contentType = "text/plain") {
  const selected = new Response(body, {
    status,
    headers: { "Content-Type": contentType }
  });
  Object.defineProperty(selected, "url", { value: url });
  return selected;
}

test("current release epoch binds every independent report and heartbeat", async () => {
  assert.deepEqual(releaseIdentity, {
    schema: "sitesourcery.independent-release-identity/v1",
    epochId: "shape-epoch-20260810",
    bindingSha256:
      "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6",
    publicArtifactCommitSha:
      "69ad11c682dda9d6f792492d322b662dcbc98b4b"
  });
  const report = await runIndependentMonitor({
    probes: healthyProbes(),
    releaseIdentity,
    now: () => new Date(NOW)
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 4);
  assert.equal(report.alerts.length, 0);
  assert.deepEqual(validateIndependentMonitorReport(report), report);
  const heartbeat = createIndependentMonitorHeartbeat(report, 7);
  assert.equal(heartbeat.sequence, 7);
  assert.equal(
    heartbeat.monitorTelemetrySha256,
    report.telemetrySha256
  );
  const serialized = JSON.stringify({ report, heartbeat });
  assert.doesNotMatch(
    serialized,
    /@|https?:|(?:\d{1,3}\.){3}\d{1,3}|recipient|responseBody|errorMessage/iu
  );
});

test("probe failures collapse to fixed PII-free telemetry codes", async () => {
  const probes = healthyProbes();
  probes.apex = async () => {
    throw new Error(
      "private.person@example.test at 192.0.2.44 returned private bytes"
    );
  };
  probes.content = async () =>
    createIndependentProbeResult("content", {
      ok: false,
      code: "CONTENT_ARTIFACT_MISMATCH",
      evidence: null
    });
  const report = await runIndependentMonitor({
    probes,
    releaseIdentity,
    now: () => new Date(NOW)
  });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.checks.map(({ name, code }) => [name, code]),
    [
      ["apex", "APEX_PROBE_UNAVAILABLE"],
      ["content", "CONTENT_ARTIFACT_MISMATCH"],
      ["tls", null],
      ["tunnel", null]
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /private\.person|192\.0\.2\.44|private bytes/u
  );
});

test("apex content TLS and tunnel ports verify exact bounded evidence", async () => {
  const contentBytes = Buffer.from("sealed-current-content", "utf8");
  const apexUrl = "https://sitesourcery.example/";
  const contentUrl =
    "https://sitesourcery.example/legal/privacy/current/";
  const tunnelUrl =
    "https://sitesourcery.example/api/v1/live";
  const requests = [];
  const probes = createIndependentEdgeProbes({
    releaseIdentity: v2ReleaseIdentity,
    expectedHostedReleaseIdentity:
      hostedReleaseIdentity,
    apexUrl,
    contentUrl,
    tunnelUrl,
    tlsHostname: "sitesourcery.example",
    expectedContentSha256:
      createHash("sha256").update(contentBytes).digest("hex"),
    expectedContentByteCount: contentBytes.length,
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (url.toString() === apexUrl) {
        return response(apexUrl, "apex", 200, "text/html");
      }
      if (url.toString() === contentUrl) {
        return response(contentUrl, contentBytes, 200, "text/html");
      }
      return response(
        tunnelUrl,
        JSON.stringify({
          schema: "sitesourcery.hosted-liveness/v1",
          live: true,
          service: "sitesourcery-hosted-runtime",
          release: hostedReleaseIdentity
        }),
        200,
        "application/json"
      );
    },
    tlsProbeImpl: async () => ({
      authorized: true,
      protocol: "TLSv1.3",
      notAfter: "2026-10-10T12:00:00.000Z",
      certificateSha256: "a".repeat(64)
    }),
    now: () => new Date(NOW)
  });
  const report = await runIndependentMonitor({
    probes,
    releaseIdentity: v2ReleaseIdentity,
    now: () => new Date(NOW)
  });
  assert.equal(report.ok, true);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [apexUrl, contentUrl, tunnelUrl]
  );
  assert.equal(
    requests.every(({ options }) =>
      options.redirect === "error" &&
      options.cache === "no-store"
    ),
    true
  );

  for (const body of [
    {
      ok: true,
      service: "sitesourcery-hosted-runtime"
    },
    {
      schema: "sitesourcery.hosted-liveness/v1",
      live: true,
      service: "sitesourcery-hosted-runtime",
      release: {
        ...hostedReleaseIdentity,
        candidateCommitSha: "f".repeat(40)
      }
    }
  ]) {
    const mismatched = createIndependentEdgeProbes({
      releaseIdentity: v2ReleaseIdentity,
      expectedHostedReleaseIdentity:
        hostedReleaseIdentity,
      apexUrl,
      contentUrl,
      tunnelUrl,
      tlsHostname: "sitesourcery.example",
      expectedContentSha256:
        createHash("sha256").update(contentBytes).digest("hex"),
      expectedContentByteCount: contentBytes.length,
      fetchImpl: async () => response(
        tunnelUrl,
        JSON.stringify(body),
        200,
        "application/json"
      ),
      tlsProbeImpl: async () => {
        throw new Error("not used");
      }
    });
    assert.deepEqual(await mismatched.tunnel(), {
      schema: "sitesourcery.independent-probe-result/v1",
      name: "tunnel",
      ok: false,
      code: "TUNNEL_READINESS_INVALID",
      evidenceSha256: null
    });
  }
});

test("content streaming fails closed once its exact byte bound is exceeded", async () => {
  const bytes = Buffer.from("12345", "utf8");
  const probes = createIndependentEdgeProbes({
    releaseIdentity: v2ReleaseIdentity,
    expectedHostedReleaseIdentity:
      hostedReleaseIdentity,
    apexUrl: "https://sitesourcery.example/",
    contentUrl: "https://sitesourcery.example/content/",
    tunnelUrl: "https://sitesourcery.example/api/v1/live",
    tlsHostname: "sitesourcery.example",
    expectedContentSha256:
      createHash("sha256").update(bytes).digest("hex"),
    expectedContentByteCount: 4,
    fetchImpl: async (url) => response(url.toString(), bytes),
    tlsProbeImpl: async () => {
      throw new Error("not used");
    }
  });
  await assert.rejects(
    probes.content(),
    /body exceeded its bound/u
  );
});

test("dead-man distinguishes fresh, stale, invalid, and wrong-release heartbeats", async () => {
  const report = await runIndependentMonitor({
    probes: healthyProbes(),
    releaseIdentity,
    now: () => new Date(NOW)
  });
  const heartbeat = createIndependentMonitorHeartbeat(report, 4);
  const fresh = evaluateIndependentDeadMan({
    heartbeat,
    releaseIdentity,
    maximumAgeMs: 180_000,
    now: () => new Date(LATER)
  });
  assert.equal(fresh.schema, INDEPENDENT_DEAD_MAN_REPORT_SCHEMA);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.code, null);
  assert.deepEqual(validateIndependentDeadManReport(fresh), fresh);
  const stale = evaluateIndependentDeadMan({
    heartbeat,
    releaseIdentity,
    maximumAgeMs: 60_000,
    now: () => new Date(LATER)
  });
  assert.equal(stale.code, "DEAD_MAN_HEARTBEAT_STALE");
  const invalid = evaluateIndependentDeadMan({
    heartbeat: { email: "hidden@example.test" },
    releaseIdentity,
    maximumAgeMs: 180_000,
    now: () => new Date(LATER)
  });
  assert.equal(invalid.code, "DEAD_MAN_HEARTBEAT_INVALID");
  assert.doesNotMatch(JSON.stringify(invalid), /hidden@example/u);

  const alternateRelease = {
    ...releaseIdentity,
    bindingSha256: "b".repeat(64)
  };
  const alternateReport = await runIndependentMonitor({
    probes: healthyProbes(),
    releaseIdentity: alternateRelease,
    now: () => new Date(NOW)
  });
  const drift = evaluateIndependentDeadMan({
    heartbeat: createIndependentMonitorHeartbeat(alternateReport, 1),
    releaseIdentity,
    maximumAgeMs: 180_000,
    now: () => new Date(LATER)
  });
  assert.equal(drift.code, "DEAD_MAN_RELEASE_IDENTITY_DRIFT");
});

test("read-only monitor approval binds the exact release and probe configuration", () => {
  const configurationSha256 = "c".repeat(64);
  const approval = {
    schema: INDEPENDENT_MONITOR_APPROVAL_SCHEMA,
    approvalId: "ops-mon-01-fixture",
    state: "approved_read_only",
    releaseBindingSha256: releaseIdentity.bindingSha256,
    configurationSha256,
    approvedAt: "2026-08-10T11:00:00.000Z",
    expiresAt: "2026-08-11T11:00:00.000Z"
  };
  approval.digest = independentMonitorApprovalDigest(approval);
  assert.equal(
    validateIndependentMonitorApproval(approval, {
      releaseBindingSha256: releaseIdentity.bindingSha256,
      configurationSha256,
      now: new Date(NOW)
    }).approvalId,
    approval.approvalId
  );
  assert.throws(
    () => validateIndependentMonitorApproval(approval, {
      releaseBindingSha256: releaseIdentity.bindingSha256,
      configurationSha256: "d".repeat(64),
      now: new Date(NOW)
    }),
    /invalid or expired/u
  );
});

test("held environment stops before epoch, approval, state, or network ports", async () => {
  let calls = 0;
  await assert.rejects(
    independentMonitorFromEnvironment(
      {
        SITESOURCERY_INDEPENDENT_MONITOR_MODE: "held",
        SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held"
      },
      {
        async readEpoch() { calls += 1; },
        async readApproval() { calls += 1; },
        async readHeartbeat() { calls += 1; },
        async writeHeartbeat() { calls += 1; },
        async fetchImpl() { calls += 1; }
      }
    ),
    /remains held/u
  );
  assert.equal(calls, 0);
});

test("held dead-man stops before epoch or heartbeat state reads", async () => {
  let calls = 0;
  await assert.rejects(
    deadManFromEnvironment(
      {
        SITESOURCERY_DEAD_MAN_MODE: "held",
        SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held"
      },
      {
        async readEpoch() { calls += 1; },
        async readHeartbeat() { calls += 1; }
      }
    ),
    /remains held/u
  );
  assert.equal(calls, 0);
});

test("production monitor and dead-man reject retained V1 epoch authority", async () => {
  let calls = 0;
  await assert.rejects(
    independentMonitorFromEnvironment(
      {
        SITESOURCERY_INDEPENDENT_MONITOR_MODE: "approved_read_only",
        SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held",
        SITESOURCERY_RELEASE_EPOCH_FILE: "/fixture/release-epoch.json"
      },
      {
        readEpoch: async () => structuredClone(epoch),
        readApproval: async () => { calls += 1; },
        readHeartbeat: async () => { calls += 1; },
        writeHeartbeat: async () => { calls += 1; },
        fetchImpl: async () => { calls += 1; }
      }
    ),
    /Final release epoch/u
  );
  await assert.rejects(
    deadManFromEnvironment(
      {
        SITESOURCERY_DEAD_MAN_MODE: "approved_read_only",
        SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held",
        SITESOURCERY_RELEASE_EPOCH_FILE: "/fixture/release-epoch.json",
        SITESOURCERY_DEAD_MAN_MAXIMUM_AGE_MS: "180000"
      },
      {
        readEpoch: async () => structuredClone(epoch),
        readHeartbeat: async () => { calls += 1; }
      }
    ),
    /Final release epoch/u
  );
  assert.equal(calls, 0);
});

test("approved fixture composition emits one bound heartbeat without alert or provider ports", async () => {
  const environment = {
    SITESOURCERY_INDEPENDENT_MONITOR_MODE: "approved_read_only",
    SITESOURCERY_OPERATIONS_PROVIDER_EGRESS: "held",
    SITESOURCERY_RELEASE_EPOCH_FILE: "/fixture/release-epoch.json",
    SITESOURCERY_INDEPENDENT_MONITOR_APPROVAL_FILE:
      "/fixture/monitor-approved.json",
    SITESOURCERY_INDEPENDENT_APEX_URL: "https://sitesourcery.example/",
    SITESOURCERY_INDEPENDENT_CONTENT_URL:
      "https://sitesourcery.example/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/",
    SITESOURCERY_INDEPENDENT_TUNNEL_URL:
      "https://sitesourcery.example/api/v1/live",
    SITESOURCERY_INDEPENDENT_TLS_HOSTNAME: "sitesourcery.example",
    SITESOURCERY_INDEPENDENT_HEARTBEAT_FILE:
      "/fixture/current.json"
  };
  const contentBytes = await readFile(
    new URL(
      "releases/joint-legal-v4-2026-08-09T214211Z/hosted/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/index.html",
      opsRoot
    )
  );
  const selected = independentMonitorConfiguration(environment, v2Epoch);
  assert.deepEqual(
    selected.hostedReleaseIdentity,
    hostedReleaseIdentity
  );
  let approvalExpected;
  let written;
  const result = await independentMonitorFromEnvironment(
    environment,
    {
      readEpoch: async () => structuredClone(v2Epoch),
      readApproval: async (_path, expected) => {
        approvalExpected = expected;
      },
      readHeartbeat: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      writeHeartbeat: async (_path, heartbeat) => {
        written = heartbeat;
        return { sha256: "e".repeat(64), bytes: 1 };
      },
      fetchImpl: async (url) => {
        const value = url.toString();
        if (value.endsWith("/api/v1/live")) {
          return response(
            value,
            JSON.stringify({
              schema: "sitesourcery.hosted-liveness/v1",
              live: true,
              service: "sitesourcery-hosted-runtime",
              release: hostedReleaseIdentity
            }),
            200,
            "application/json"
          );
        }
        if (value.endsWith(
          "/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/"
        )) {
          return response(value, contentBytes, 200, "text/html");
        }
        return response(value, "apex", 200, "text/html");
      },
      tlsProbeImpl: async () => ({
        authorized: true,
        protocol: "TLSv1.3",
        notAfter: "2026-10-10T12:00:00.000Z",
        certificateSha256: "f".repeat(64)
      }),
      now: () => new Date(NOW)
    }
  );
  assert.equal(result.report.ok, true);
  assert.equal(written.sequence, 1);
  assert.equal(
    approvalExpected.configurationSha256,
    selected.configurationSha256
  );
  assert.equal(approvalExpected.now.toISOString(), NOW);
});

test("configuration rejects content or tunnel authority drift from the release epoch", () => {
  const environment = {
    SITESOURCERY_INDEPENDENT_APEX_URL: "https://sitesourcery.example/",
    SITESOURCERY_INDEPENDENT_CONTENT_URL:
      "https://sitesourcery.example/legal/privacy/current/",
    SITESOURCERY_INDEPENDENT_TUNNEL_URL:
      "https://sitesourcery.example/api/v1/live",
    SITESOURCERY_INDEPENDENT_TLS_HOSTNAME: "sitesourcery.example"
  };
  assert.throws(
    () => independentMonitorConfiguration(environment, v2Epoch),
    /do not match the selected release epoch/u
  );
  environment.SITESOURCERY_INDEPENDENT_CONTENT_URL =
    "https://sitesourcery.example/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-09-V4/";
  environment.SITESOURCERY_INDEPENDENT_TUNNEL_URL =
    "https://sitesourcery.example/api/v1/health";
  assert.throws(
    () => independentMonitorConfiguration(environment, v2Epoch),
    /do not match the selected release epoch/u
  );
  environment.SITESOURCERY_INDEPENDENT_TUNNEL_URL =
    "https://sitesourcery.example/api/v1/other";
  assert.throws(
    () => independentMonitorConfiguration(environment, v2Epoch),
    /do not match the selected release epoch/u
  );
});

test("held unit candidates have no runtime, database, backup-mount, or provider dependency", async () => {
  const [monitor, deadMan, monitorEnvironment, deadManEnvironment] =
    await Promise.all([
      readFile(new URL("sitesourcery-monitor.service.held", opsRoot), "utf8"),
      readFile(
        new URL("sitesourcery-monitor-dead-man.service.held", opsRoot),
        "utf8"
      ),
      readFile(new URL("independent-monitor.env.example", opsRoot), "utf8"),
      readFile(new URL("independent-dead-man.env.example", opsRoot), "utf8")
    ]);
  assert.match(monitor, /ops\/independent-monitor\.mjs/u);
  assert.doesNotMatch(
    monitor,
    /Requires=.*sitesourcery|After=.*sitesourcery|BACKUP_QUIESCE|backup-mount|hosted\.env|SITESOURCERY_DATABASE_URL|\/mnt\/sitesourcery-backups/u
  );
  assert.match(deadMan, /^RestrictAddressFamilies=AF_UNIX$/mu);
  assert.doesNotMatch(deadMan, /AF_INET|network-online|ExecStart=.*curl/u);
  for (const environment of [monitorEnvironment, deadManEnvironment]) {
    assert.match(environment, /MODE=held/u);
    assert.match(
      environment,
      /^SITESOURCERY_OPERATIONS_PROVIDER_EGRESS=held$/mu
    );
    assert.doesNotMatch(
      environment,
      /SITESOURCERY_DATABASE_URL|sk_(?:live|test)_|whsec_|api[_-]?key|recipient|@/iu
    );
  }
  assert.match(
    monitorEnvironment,
    /^SITESOURCERY_INDEPENDENT_TUNNEL_URL=https:\/\/sitesourcery\.com\/api\/v1\/live$/mu
  );
  assert.doesNotMatch(
    monitorEnvironment,
    /\/api\/v1\/(?:health|ready)/u
  );
});
