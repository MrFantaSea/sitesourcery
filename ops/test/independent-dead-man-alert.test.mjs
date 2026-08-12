import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INDEPENDENT_DEAD_MAN_ALERT_CONTROL_HELD,
  INDEPENDENT_DEAD_MAN_ALERT_CONTROL_LOCAL_FIXTURE,
  createIndependentDeadManAlertAdapter,
  createIndependentDeadManAlertPortReceipt,
  createIndependentHeartbeatEvidence,
  independentHeartbeatEvidenceDigest,
  runIndependentDeadManAlertCycle,
  validateIndependentDeadManAlertReceipt,
  validateIndependentDeadManState,
  validateIndependentHeartbeatEvidence
} from "../independent-dead-man-alert.mjs";
import {
  INDEPENDENT_RELEASE_IDENTITY_SCHEMA,
  createIndependentMonitorHeartbeat,
  createIndependentProbeResult,
  runIndependentMonitor
} from "../independent-monitor-runtime.mjs";
import {
  canonicalJson,
  sha256Bytes
} from "../immutable-evidence.mjs";

const releaseIdentity = Object.freeze({
  schema: INDEPENDENT_RELEASE_IDENTITY_SCHEMA,
  epochId: "shape-epoch-monitor-fixture",
  bindingSha256: "a".repeat(64),
  publicArtifactCommitSha: "b".repeat(40)
});
const sourceFailureDomainId = "primary-observer-fixture";
const observerFailureDomainId = "secondary-observer-fixture";
const maximumAgeMs = 180_000;
const START = new Date("2026-08-11T18:00:00.000Z");

function clone(value) {
  return structuredClone(value);
}

function successfulProbe(name, marker = name) {
  return async () => createIndependentProbeResult(name, {
    ok: true,
    evidence: { marker }
  });
}

async function heartbeat(sequence, observedAt, marker = "current") {
  const report = await runIndependentMonitor({
    releaseIdentity,
    probes: {
      apex: successfulProbe("apex", marker),
      content: successfulProbe("content", marker),
      tls: successfulProbe("tls", marker),
      tunnel: successfulProbe("tunnel", marker)
    },
    now: () => new Date(observedAt)
  });
  return createIndependentMonitorHeartbeat(report, sequence);
}

async function evidence(sequence, observedAt, marker = "current") {
  return createIndependentHeartbeatEvidence({
    heartbeat: await heartbeat(sequence, observedAt, marker),
    sourceFailureDomainId,
    observerFailureDomainId,
    receivedAt: observedAt
  });
}

function memoryStatePort() {
  let state = null;
  const writes = [];
  return {
    kind: "memory-state-fixture",
    externalEffects: false,
    async load() {
      return state;
    },
    async compareAndSwap({ expectedDigest, nextState }) {
      const actual = state?.digest ?? null;
      if (actual !== expectedDigest) return false;
      state = validateIndependentDeadManState(nextState);
      writes.push(state.digest);
      return true;
    },
    current() {
      return state;
    },
    writes
  };
}

function fakeAlertPort(acceptedAt = "2026-08-11T18:10:00.000Z") {
  const envelopes = [];
  return {
    kind: "memory-alert-fixture",
    externalEffects: false,
    envelopes,
    async deliver(envelope) {
      envelopes.push(envelope);
      return createIndependentDeadManAlertPortReceipt({
        transitionId: envelope.transitionId,
        acceptedAt,
        deliveryRefSha256: sha256Bytes(
          Buffer.from(`fixture:${envelope.transitionId}`, "utf8")
        )
      });
    }
  };
}

function fixtureAdapter(port) {
  return createIndependentDeadManAlertAdapter({
    control: INDEPENDENT_DEAD_MAN_ALERT_CONTROL_LOCAL_FIXTURE,
    port
  });
}

async function cycle({
  statePort,
  alertAdapter,
  heartbeatEvidence = null,
  now
}) {
  return runIndependentDeadManAlertCycle({
    statePort,
    alertAdapter,
    releaseIdentity,
    sourceFailureDomainId,
    observerFailureDomainId,
    heartbeatEvidence,
    maximumAgeMs,
    now: () => new Date(now)
  });
}

test("digest-binds heartbeat and distinct failure-domain identity without PII", async () => {
  const selected = await evidence(1, START.toISOString());
  assert.equal(
    selected.heartbeatSha256,
    sha256Bytes(
      Buffer.from(`${canonicalJson(selected.heartbeat)}\n`, "utf8")
    )
  );
  assert.deepEqual(validateIndependentHeartbeatEvidence(selected), selected);
  assert.equal(selected.digest, independentHeartbeatEvidenceDigest(selected));
  assert.equal(Object.isFrozen(selected), true);
  assert.doesNotMatch(
    JSON.stringify(selected),
    /@|email|phone|customer|127\.0\.0\.1|https?:/iu
  );

  const tampered = clone(selected);
  tampered.heartbeat.sequence = 2;
  assert.throws(
    () => validateIndependentHeartbeatEvidence(tampered),
    /heartbeat evidence digest/u
  );
  const extra = clone(selected);
  extra.email = "hidden@example.test";
  extra.digest = independentHeartbeatEvidenceDigest(extra);
  assert.throws(
    () => validateIndependentHeartbeatEvidence(extra),
    /only its exact fields/u
  );
  assert.throws(
    () => createIndependentHeartbeatEvidence({
      heartbeat: selected.heartbeat,
      sourceFailureDomainId,
      observerFailureDomainId: sourceFailureDomainId,
      receivedAt: START.toISOString()
    }),
    /identity is invalid/u
  );
});

test("transitions fresh heartbeat through missed expiry alert and recovery receipts", async () => {
  const statePort = memoryStatePort();
  const alertPort = fakeAlertPort("2026-08-11T18:05:00.000Z");
  const alertAdapter = fixtureAdapter(alertPort);
  const firstEvidence = await evidence(1, START.toISOString());
  const baseline = await cycle({
    statePort,
    alertAdapter,
    heartbeatEvidence: firstEvidence,
    now: START.toISOString()
  });
  assert.equal(baseline.transition.kind, "baseline");
  assert.equal(baseline.transition.heartbeatDisposition, "accepted");
  assert.equal(baseline.state.status, "healthy");
  assert.equal(baseline.stateCommitted, true);
  assert.equal(baseline.alertReceipt.mode, "none");
  assert.equal(alertPort.envelopes.length, 0);

  const staleAt = "2026-08-11T18:04:00.000Z";
  const expired = await cycle({
    statePort,
    alertAdapter,
    now: staleAt
  });
  assert.equal(expired.transition.kind, "incident");
  assert.equal(expired.transition.code, "DEAD_MAN_HEARTBEAT_STALE");
  assert.equal(expired.transition.heartbeatDisposition, "missing");
  assert.equal(expired.alertReceipt.delivered, true);
  assert.equal(expired.alertReceipt.mode, "local_fixture");
  assert.equal(
    expired.alertReceipt.deadManTransitionDigest,
    expired.transition.digest
  );
  assert.equal(expired.state.status, "alerting");
  assert.equal(expired.stateCommitted, true);
  assert.equal(alertPort.envelopes.length, 1);

  const recoveredEvidence = await evidence(
    2,
    "2026-08-11T18:04:30.000Z"
  );
  const recovered = await cycle({
    statePort,
    alertAdapter,
    heartbeatEvidence: recoveredEvidence,
    now: "2026-08-11T18:04:30.000Z"
  });
  assert.equal(recovered.transition.kind, "recovery");
  assert.equal(recovered.transition.previousCode, "DEAD_MAN_HEARTBEAT_STALE");
  assert.equal(recovered.transition.code, null);
  assert.equal(recovered.alertReceipt.delivered, true);
  assert.equal(recovered.state.status, "healthy");
  assert.equal(recovered.state.revision, 3);
  assert.equal(alertPort.envelopes.length, 2);
  assert.deepEqual(
    alertPort.envelopes.map(({ kind }) => kind),
    ["incident", "recovery"]
  );
});

test("suppresses duplicates and rejects out-of-order and conflicting sequences monotonically", async () => {
  const statePort = memoryStatePort();
  const alertPort = fakeAlertPort();
  const alertAdapter = fixtureAdapter(alertPort);
  const current = await evidence(2, START.toISOString(), "first");
  await cycle({
    statePort,
    alertAdapter,
    heartbeatEvidence: current,
    now: START.toISOString()
  });
  const digestBefore = statePort.current().digest;
  const duplicate = await cycle({
    statePort,
    alertAdapter,
    heartbeatEvidence: current,
    now: "2026-08-11T18:01:00.000Z"
  });
  assert.equal(duplicate.transition.kind, "none");
  assert.equal(duplicate.transition.heartbeatDisposition, "duplicate");
  assert.equal(duplicate.stateCommitted, false);
  assert.equal(duplicate.state.digest, digestBefore);

  const older = await evidence(
    1,
    "2026-08-11T17:59:00.000Z",
    "older"
  );
  const outOfOrder = await cycle({
    statePort,
    alertAdapter,
    heartbeatEvidence: older,
    now: "2026-08-11T18:01:30.000Z"
  });
  assert.equal(outOfOrder.transition.kind, "incident");
  assert.equal(
    outOfOrder.transition.code,
    "DEAD_MAN_HEARTBEAT_OUT_OF_ORDER"
  );
  assert.equal(outOfOrder.state.lastHeartbeatEvidence.digest, current.digest);

  const conflictState = memoryStatePort();
  await cycle({
    statePort: conflictState,
    alertAdapter,
    heartbeatEvidence: current,
    now: START.toISOString()
  });
  const conflicting = await evidence(
    2,
    "2026-08-11T18:00:30.000Z",
    "conflict"
  );
  const conflict = await cycle({
    statePort: conflictState,
    alertAdapter,
    heartbeatEvidence: conflicting,
    now: "2026-08-11T18:01:30.000Z"
  });
  assert.equal(conflict.transition.kind, "incident");
  assert.equal(
    conflict.transition.code,
    "DEAD_MAN_HEARTBEAT_SEQUENCE_CONFLICT"
  );
  assert.equal(
    conflict.state.lastHeartbeatEvidence.digest,
    current.digest
  );
  assert.equal(alertPort.envelopes.length, 2);
});

test("default global hold and kill switch prevent all alert-port effects", async () => {
  const statePort = memoryStatePort();
  const selectedEvidence = await evidence(1, START.toISOString());
  await cycle({
    statePort,
    alertAdapter: createIndependentDeadManAlertAdapter(),
    heartbeatEvidence: selectedEvidence,
    now: START.toISOString()
  });
  let calls = 0;
  const port = {
    kind: "unused-alert-fixture",
    externalEffects: false,
    async deliver() {
      calls += 1;
      throw new Error("held adapter called its port");
    }
  };
  const held = createIndependentDeadManAlertAdapter({
    control: INDEPENDENT_DEAD_MAN_ALERT_CONTROL_HELD,
    port
  });
  const result = await cycle({
    statePort,
    alertAdapter: held,
    now: "2026-08-11T18:04:00.000Z"
  });
  assert.equal(result.transition.kind, "incident");
  assert.equal(result.alertReceipt.mode, "held");
  assert.equal(result.alertReceipt.code, "INDEPENDENT_ALERTS_HELD");
  assert.equal(result.alertReceipt.attempted, false);
  assert.equal(result.stateCommitted, false);
  assert.equal(result.state.status, "healthy");
  assert.equal(calls, 0);
  assert.deepEqual(
    validateIndependentDeadManAlertReceipt(result.alertReceipt),
    result.alertReceipt
  );
  assert.throws(
    () => createIndependentDeadManAlertAdapter({
      control: INDEPENDENT_DEAD_MAN_ALERT_CONTROL_LOCAL_FIXTURE,
      port: {
        kind: "external-port",
        externalEffects: true,
        deliver: async () => null
      }
    }),
    /local fixture port is invalid/u
  );

  const chronologyState = memoryStatePort();
  await cycle({
    statePort: chronologyState,
    alertAdapter: createIndependentDeadManAlertAdapter(),
    heartbeatEvidence: selectedEvidence,
    now: START.toISOString()
  });
  await assert.rejects(
    cycle({
      statePort: chronologyState,
      alertAdapter: fixtureAdapter(
        fakeAlertPort("2026-08-11T18:03:59.000Z")
      ),
      now: "2026-08-11T18:04:00.000Z"
    }),
    /predates its transition/u
  );
  assert.equal(chronologyState.current().status, "healthy");
});

test("held retry preserves one idempotent transition until a fake receipt commits it", async () => {
  const statePort = memoryStatePort();
  const firstEvidence = await evidence(1, START.toISOString());
  await cycle({
    statePort,
    alertAdapter: createIndependentDeadManAlertAdapter(),
    heartbeatEvidence: firstEvidence,
    now: START.toISOString()
  });
  const held = await cycle({
    statePort,
    alertAdapter: createIndependentDeadManAlertAdapter(),
    now: "2026-08-11T18:04:00.000Z"
  });
  const port = fakeAlertPort("2026-08-11T18:05:00.000Z");
  const delivered = await cycle({
    statePort,
    alertAdapter: fixtureAdapter(port),
    now: "2026-08-11T18:05:00.000Z"
  });
  assert.equal(held.transition.transitionId, delivered.transition.transitionId);
  assert.notEqual(held.transition.digest, delivered.transition.digest);
  assert.equal(held.stateCommitted, false);
  assert.equal(delivered.stateCommitted, true);
  assert.equal(delivered.alertReceipt.delivered, true);
  assert.equal(port.envelopes.length, 1);
});

test("module and runbook remain local, provider-neutral, and installation-held", async () => {
  const [source, runbook] = await Promise.all([
    readFile(new URL("../independent-dead-man-alert.mjs", import.meta.url), "utf8"),
    readFile(
      new URL("../SITESOURCERY-MONITOR-DEADMAN-02-HELD.md", import.meta.url),
      "utf8"
    )
  ]);
  assert.doesNotMatch(source, /node:(?:http|https|net|tls)|fetch\s*\(/u);
  assert.doesNotMatch(source, /resend|pager|twilio|email|sms/iu);
  for (const required of [
    "No migration is required",
    "actual second failure domain",
    "alert provider and destination",
    "on-call ownership",
    "installation and service activation",
    "network and alert effects remain held"
  ]) {
    assert.match(runbook, new RegExp(required, "iu"));
  }
});
