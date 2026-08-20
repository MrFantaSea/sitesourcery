import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  canonicalJson,
  sha256Bytes
} from "../immutable-evidence.mjs";
import {
  HOSTED_LOAD_SLO_HELD_AUTHORITY,
  HOSTED_LOAD_SLO_OPEN_GATES,
  LOCAL_HOSTED_LOAD_SLO_PROFILE,
  validateHostedLoadSloReceipt
} from "../hosted-load-slo-runtime.mjs";
import {
  main,
  runHostedLoadSloAcceptance
} from "../hosted-load-slo.mjs";

const SOURCE = Object.freeze({
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  nodeVersion: "24.18.0",
  classification: "caller_supplied_local_fixture_identity"
});
const OBSERVED_AT = "2026-08-11T18:00:00.000Z";
const RUN_ID = "load-slo-local-20260811";
const execFileAsync = promisify(execFile);

let receiptPromise = null;

function acceptedReceipt() {
  receiptPromise ??= runHostedLoadSloAcceptance({
    runId: RUN_ID,
    observedAt: OBSERVED_AT,
    source: SOURCE
  });
  return receiptPromise;
}

function resign(value) {
  const selected = structuredClone(value);
  delete selected.digest;
  return {
    ...selected,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(selected)}\n`, "utf8")
    )
  };
}

test("local hosted load acceptance composes every existing bounded runtime primitive", async () => {
  const receipt = await acceptedReceipt();
  assert.deepEqual(validateHostedLoadSloReceipt(receipt), receipt);
  assert.deepEqual(receipt.profile, LOCAL_HOSTED_LOAD_SLO_PROFILE);
  assert.deepEqual(receipt.authority, HOSTED_LOAD_SLO_HELD_AUTHORITY);
  assert.deepEqual(receipt.openGates, HOSTED_LOAD_SLO_OPEN_GATES);
  assert.equal(receipt.result.localContractAccepted, true);
  assert.equal(receipt.result.productionReady, false);
  assert.equal(receipt.observations.ingress.busyRequests, 3);
  assert.equal(receipt.observations.ingress.deadlineStatus, 504);
  assert.equal(receipt.observations.apiPool.processConnectionBudget, 1);
  assert.equal(receipt.observations.workerPool.processConnectionBudget, 2);
  assert.equal(receipt.observations.readiness.dependencyCalls, 1);
  assert.equal(receipt.observations.shutdown.reverseOrder, true);
  assert.equal(receipt.observations.shutdown.deadlineEnforced, true);
  assert.doesNotMatch(
    canonicalJson(receipt),
    /(?:https?:\/\/|postgresql:|sk_(?:live|test)|whsec_|customer@)/u
  );
});

test("receipt validation rejects semantic drift even when its unkeyed local digest is recomputed", async () => {
  const receipt = await acceptedReceipt();
  const mutations = [
    {
      change(value) {
        value.authority.payment = "approved";
      },
      message: /authority must remain wholly held/u
    },
    {
      change(value) {
        value.source.classification = "git_verified";
      },
      message: /Load source classification drifted/u
    },
    {
      change(value) {
        value.observations.ingress.busyRequests -= 1;
      },
      message: /Ingress busy requests drifted/u
    },
    {
      change(value) {
        value.observations.apiPool.workerReservedConnections -= 1;
      },
      message: /api worker pool reserve drifted/u
    },
    {
      change(value) {
        value.observations.readiness.dependencyCalls = 2;
      },
      message: /Readiness dependency calls drifted/u
    },
    {
      change(value) {
        value.openGates.productionQueueBackpressure = "closed";
      },
      message: /must keep production queue and deployment gates open/u
    },
    {
      change(value) {
        value.observations.shutdown.reverseOrder = false;
      },
      message: /Worker reverse shutdown order drifted/u
    },
    {
      change(value) {
        value.result.productionReady = true;
      },
      message: /Production load readiness result drifted/u
    }
  ];
  for (const mutation of mutations) {
    const selected = structuredClone(receipt);
    mutation.change(selected);
    assert.throws(
      () => validateHostedLoadSloReceipt(resign(selected)),
      mutation.message
    );
  }
});

test("receipt validation rejects source, digest, extra-field, and profile substitution", async () => {
  const receipt = await acceptedReceipt();
  const sourceDrift = structuredClone(receipt);
  sourceDrift.source.commitSha = "c".repeat(40);
  assert.throws(
    () => validateHostedLoadSloReceipt(sourceDrift),
    /digest is invalid/u
  );

  const extra = structuredClone(receipt);
  extra.observations.ingress.secret = "must-not-exist";
  assert.throws(
    () => validateHostedLoadSloReceipt(resign(extra)),
    /Ingress observation must contain only its exact fields/u
  );

  const profileDrift = structuredClone(receipt);
  profileDrift.profile.ingress.maxConcurrentRequests += 1;
  assert.throws(
    () => validateHostedLoadSloReceipt(resign(profileDrift)),
    /exact local-only profile/u
  );
});

test("CLI retains one immutable receipt and refuses overwrite", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-hosted-load-slo-")
  );
  const output = path.join(fixture, "receipt.json");
  const writes = [];
  let calls = 0;
  const argv = [
    "run",
    "--output",
    output,
    "--run-id",
    RUN_ID,
    "--observed-at",
    OBSERVED_AT,
    "--source-commit",
    SOURCE.commitSha,
    "--source-tree",
    SOURCE.treeSha
  ];
  try {
    const receipt = await main({
      argv,
      async runAcceptance(input) {
        calls += 1;
        assert.deepEqual(input, {
          runId: RUN_ID,
          observedAt: OBSERVED_AT,
          source: SOURCE
        });
        return acceptedReceipt();
      },
      write(value) {
        writes.push(value);
      }
    });
    assert.deepEqual(
      validateHostedLoadSloReceipt(
        JSON.parse(await readFile(output, "utf8"))
      ),
      receipt
    );
    assert.equal(calls, 1);
    assert.equal(writes.length, 1);
    assert.match(writes[0], /"externalEffects":"none"/u);
    assert.match(writes[0], /"productionReady":false/u);
    await assert.rejects(
      main({
        argv,
        runAcceptance: async () => {
          calls += 1;
          return receipt;
        }
      }),
      /output already exists/u
    );
    assert.equal(calls, 1);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("documented relative CLI invocation stays alive through its deadline proof", async () => {
  const fixture = await mkdtemp(
    path.join(os.tmpdir(), "ss-hosted-load-slo-cli-")
  );
  const output = path.join(fixture, "receipt.json");
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        "ops/hosted-load-slo.mjs",
        "run",
        "--output",
        output,
        "--run-id",
        RUN_ID,
        "--observed-at",
        OBSERVED_AT,
        "--source-commit",
        SOURCE.commitSha,
        "--source-tree",
        SOURCE.treeSha
      ],
      {
        cwd: repositoryRoot,
        timeout: 10_000
      }
    );
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.ok, true);
    assert.equal(summary.path, output);
    assert.equal(summary.productionReady, false);
    assert.equal(summary.externalEffects, "none");
    const receipt = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(validateHostedLoadSloReceipt(receipt), receipt);
    assert.equal(receipt.observations.ingress.deadlineStatus, 504);
    assert.equal(receipt.observations.ingress.deadlineCode,
      "REQUEST_DEADLINE_EXCEEDED");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("harness is local-only and imports the reviewed production boundaries", async () => {
  const source = await readFile(
    new URL("../hosted-load-slo.mjs", import.meta.url),
    "utf8"
  );
  for (const required of [
    "../server/hosted/node-handler.mjs",
    "../server/hosted/repository-postgres.mjs",
    "../server/hosted/readiness-snapshot.mjs",
    "../server/hosted/worker-supervisor.mjs",
    "writeImmutableEvidence"
  ]) {
    assert.ok(source.includes(required), required);
  }
  assert.doesNotMatch(
    source,
    /globalThis\.fetch|https:\/\/|stripe|resend|cloudflare|spaceship/iu
  );
  assert.doesNotMatch(source, /probeQueue|LOAD_QUEUE_BACKPRESSURE/u);
});

test("operator runbook preserves the local-only claim and production blockers", async () => {
  const runbook = await readFile(
    new URL("../SITESOURCERY-HOSTED-LOAD-SLO-HELD.md", import.meta.url),
    "utf8"
  );
  for (const required of [
    "local fixture only",
    "productionReady: false",
    "No network",
    "owner-approved production SLO",
    "exact deployed release",
    "queue-depth and oldest-age telemetry",
    "OPEN"
  ]) {
    assert.ok(runbook.includes(required), required);
  }
});
