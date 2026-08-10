#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  createIndependentMonitorHeartbeat,
  releaseIdentityFromEpoch,
  runIndependentMonitor
} from "./independent-monitor-runtime.mjs";
import {
  createIndependentEdgeProbes
} from "./independent-monitor-ports.mjs";
import {
  readIndependentMonitorApproval,
  readIndependentMonitorHeartbeat,
  writeIndependentMonitorHeartbeat
} from "./independent-monitor-state.mjs";

function required(environment, field) {
  const value = environment?.[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function absolute(environment, field) {
  const value = required(environment, field);
  if (!path.isAbsolute(value)) {
    throw new Error(`${field} must be absolute.`);
  }
  return path.resolve(value);
}

function integer(environment, field, fallback, minimum, maximum) {
  const raw = environment?.[field] ?? String(fallback);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new Error(`${field} must be an unsigned decimal integer.`);
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${field} is outside its reviewed bound.`);
  }
  return value;
}

export function independentMonitorConfiguration(
  environment,
  epoch
) {
  const releaseIdentity = releaseIdentityFromEpoch(epoch);
  const apexUrl = required(
    environment,
    "SITESOURCERY_INDEPENDENT_APEX_URL"
  );
  let apex;
  try {
    apex = new URL(apexUrl);
  } catch {
    throw new Error("Independent monitor apex URL is invalid.");
  }
  const expectedContentUrl = new URL(
    `/legal/privacy/versions/${epoch.binding.legal.privacyVersion}/`,
    apex
  ).toString();
  const expectedTunnelUrl = new URL(
    "/api/v1/health",
    apex
  ).toString();
  const configuration = {
    apexUrl,
    contentUrl: required(
      environment,
      "SITESOURCERY_INDEPENDENT_CONTENT_URL"
    ),
    tunnelUrl: required(
      environment,
      "SITESOURCERY_INDEPENDENT_TUNNEL_URL"
    ),
    tlsHostname: required(
      environment,
      "SITESOURCERY_INDEPENDENT_TLS_HOSTNAME"
    ),
    tlsPort: integer(
      environment,
      "SITESOURCERY_INDEPENDENT_TLS_PORT",
      443,
      1,
      65535
    ),
    timeoutMs: integer(
      environment,
      "SITESOURCERY_INDEPENDENT_TIMEOUT_MS",
      3000,
      250,
      30_000
    ),
    minimumTlsValidityMs: integer(
      environment,
      "SITESOURCERY_INDEPENDENT_TLS_MIN_VALIDITY_MS",
      21 * 24 * 60 * 60 * 1000,
      60_000,
      180 * 24 * 60 * 60 * 1000
    )
  };
  if (
    configuration.contentUrl !== expectedContentUrl ||
    configuration.tunnelUrl !== expectedTunnelUrl ||
    configuration.tlsHostname !== apex.hostname
  ) {
    throw new Error(
      "Independent monitor endpoints do not match the selected release epoch."
    );
  }
  const configurationSha256 = sha256Bytes(
    Buffer.from(
      `${canonicalJson({
        releaseBindingSha256: releaseIdentity.bindingSha256,
        ...configuration
      })}\n`,
      "utf8"
    )
  );
  return Object.freeze({
    releaseIdentity,
    configuration: Object.freeze(configuration),
    configurationSha256
  });
}

export async function independentMonitorFromEnvironment(
  environment = process.env,
  {
    fetchImpl = globalThis.fetch,
    tlsProbeImpl,
    readEpoch = readJsonObject,
    readApproval = readIndependentMonitorApproval,
    readHeartbeat = readIndependentMonitorHeartbeat,
    writeHeartbeat = writeIndependentMonitorHeartbeat,
    now = () => new Date()
  } = {}
) {
  if (
    required(
      environment,
      "SITESOURCERY_INDEPENDENT_MONITOR_MODE"
    ) !== "approved_read_only" ||
    required(
      environment,
      "SITESOURCERY_OPERATIONS_PROVIDER_EGRESS"
    ) !== "held"
  ) {
    throw new Error(
      "Independent monitoring remains held without exact read-only approval."
    );
  }
  const epochPath = absolute(
    environment,
    "SITESOURCERY_RELEASE_EPOCH_FILE"
  );
  const epoch = await readEpoch(epochPath, "Release epoch");
  const selected = independentMonitorConfiguration(
    environment,
    epoch
  );
  await readApproval(
    absolute(
      environment,
      "SITESOURCERY_INDEPENDENT_MONITOR_APPROVAL_FILE"
    ),
    {
      releaseBindingSha256:
        selected.releaseIdentity.bindingSha256,
      configurationSha256:
        selected.configurationSha256,
      now: now()
    }
  );
  const probes = createIndependentEdgeProbes({
    fetchImpl,
    ...(tlsProbeImpl ? { tlsProbeImpl } : {}),
    releaseIdentity: selected.releaseIdentity,
    ...selected.configuration,
    expectedContentSha256:
      epoch.binding.artifact.privacySha256,
    expectedContentByteCount:
      epoch.binding.artifact.privacyByteCount,
    now
  });
  const report = await runIndependentMonitor({
    probes,
    releaseIdentity: selected.releaseIdentity,
    now
  });
  const heartbeatPath = absolute(
    environment,
    "SITESOURCERY_INDEPENDENT_HEARTBEAT_FILE"
  );
  let sequence = 1;
  try {
    const previous = await readHeartbeat(heartbeatPath);
    if (
      canonicalJson(previous.release) !==
        canonicalJson(selected.releaseIdentity)
    ) {
      throw new Error(
        "Independent monitor heartbeat release identity drifted."
      );
    }
    sequence = previous.sequence + 1;
    if (!Number.isSafeInteger(sequence)) {
      throw new Error(
        "Independent monitor heartbeat sequence exhausted."
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const heartbeat = createIndependentMonitorHeartbeat(
    report,
    sequence
  );
  const receipt = await writeHeartbeat(
    heartbeatPath,
    heartbeat
  );
  return Object.freeze({ report, heartbeat, receipt });
}

async function main() {
  const result = await independentMonitorFromEnvironment();
  process.stdout.write(
    `${canonicalJson({
      report: result.report,
      heartbeat: result.heartbeat,
      heartbeatReceiptSha256: result.receipt.sha256
    })}\n`
  );
  if (!result.report.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.independent-monitor-failure/v1","ok":false,"code":"INDEPENDENT_MONITOR_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
