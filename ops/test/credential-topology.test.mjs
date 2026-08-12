import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CREDENTIAL_TOPOLOGY_CONTRACT,
  CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID,
  CREDENTIAL_TOPOLOGY_SCHEMA,
  createHeldCredentialTopologyTemplate,
  normalizeCredentialTopology,
  verifyCredentialTopology,
  STRIPE_RESTRICTED_KEY_CONTRACT
} from "../credential-topology.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS_ROOT = path.resolve(HERE, "..");
const NOW = "2026-08-10T16:00:00.000Z";

function evidence(name) {
  return createHash("sha256")
    .update(`non-secret-evidence:${name}`, "utf8")
    .digest("hex");
}

function completeTopology() {
  const input = structuredClone(
    createHeldCredentialTopologyTemplate()
  );
  for (const item of input.items) {
    if (item.kind === "rotation_control" || item.kind === "separation_control") {
      item.rotationState = "proven";
      item.materialPresent = false;
    } else if (
      item.name ===
      "stripe.provisioner.production.restricted"
    ) {
      item.rotationState = "ephemeral_revoked";
      item.materialPresent = false;
    } else if (
      item.name ===
      "stripe.standard.production.compromised"
    ) {
      item.rotationState = "compromised_revoked";
      item.materialPresent = false;
    } else if (
      item.name ===
      "resend.sender.historical-shared-full-access"
    ) {
      item.rotationState = "shared_revoked";
      item.materialPresent = false;
    } else if (
      item.name === "identity.pepper.production.prior" ||
      item.name === "stripe.webhook.production.prior" ||
      item.name === "responder.material.production.prior"
    ) {
      item.rotationState = "overlap";
      item.materialPresent = true;
    } else {
      item.rotationState = "active";
      item.materialPresent = true;
    }
    item.lastProvenAt = NOW;
    item.evidenceDigest = evidence(item.name);
  }
  const accountId = "acct_credential_topology";
  const runtime = item(
    input,
    "stripe.runtime.production.restricted"
  );
  runtime.scopes = [
    "checkout_sessions:write",
    "prices:read",
    "webhook_endpoints:read"
  ];
  runtime.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "restricted",
    keyVersion: "runtime-production-v1",
    keyFingerprint: evidence("stripe-runtime-fingerprint"),
    activatedAt: "2026-08-10T14:30:00.000Z",
    enabledPurposes: ["download"]
  };
  const provisioner = item(
    input,
    "stripe.provisioner.production.restricted"
  );
  provisioner.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "restricted",
    keyVersion: "provisioner-production-v1",
    keyFingerprint: evidence(
      "stripe-provisioner-fingerprint"
    ),
    activatedAt: "2026-08-10T14:00:00.000Z",
    revokedAt: "2026-08-10T14:40:00.000Z",
    scopeProvenAt: "2026-08-10T14:01:00.000Z",
    scopeEvidenceDigest: evidence(
      "stripe-provisioner-scope"
    )
  };
  const standard = item(
    input,
    "stripe.standard.production.compromised"
  );
  standard.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "standard_status_only",
    keyVersion: "standard-compromised-v1",
    keyFingerprint: evidence("stripe-standard-fingerprint"),
    revokedAt: "2026-08-10T14:35:00.000Z"
  };
  return input;
}

function item(input, name) {
  return input.items.find((entry) => entry.name === name);
}

function assertCode(expected, action) {
  assert.throws(action, (error) => error?.code === expected);
}

test("credential topology contract is exact, held, and sorted", () => {
  const template = createHeldCredentialTopologyTemplate();
  assert.equal(template.schema, CREDENTIAL_TOPOLOGY_SCHEMA);
  assert.equal(template.mode, "held");
  assert.equal(CREDENTIAL_TOPOLOGY_CONTRACT.effectsAllowed, false);
  assert.equal(template.items.length, 26);
  assert.deepEqual(
    template.items.map((entry) => entry.name),
    [...CREDENTIAL_TOPOLOGY_CONTRACT.names].sort()
  );
  assert.equal(
    item(
      template,
      "stripe.standard.production.compromised"
    ).rotationState,
    "compromised_pending_revocation"
  );
  assert.equal(
    template.items.every(
      (entry) => entry.materialPresent === false
    ),
    true
  );
  assert.deepEqual(
    item(
      template,
      "stripe.runtime.production.restricted"
    ).scopes,
    STRIPE_RESTRICTED_KEY_CONTRACT.allRuntimeScopes
  );
  assert.deepEqual(
    item(
      template,
      "stripe.provisioner.production.restricted"
    ).scopes,
    STRIPE_RESTRICTED_KEY_CONTRACT.provisionerScopes
  );
});

test("held template makes no presence or readiness claim", () => {
  const result = verifyCredentialTopology(
    createHeldCredentialTopologyTemplate(),
    { now: new Date(NOW) }
  );
  assert.equal(result.mode, "held");
  assert.equal(result.effectsAllowed, false);
  assert.equal(result.topologyEvidenceComplete, false);
  assert.equal(result.itemCount, 26);
  assert.match(result.topologyDigest, /^[a-f0-9]{64}$/u);
  assert.ok(
    result.blockers.includes(
      "stripe_standard_compromised_revocation_not_proven"
    )
  );
  assert.ok(
    result.blockers.includes(
      "stripe_webhook_overlap_or_revocation_not_proven"
    )
  );
  assert.ok(
    result.blockers.includes(
      "operator_recovery_dual_control_not_proven"
    )
  );
  assert.ok(
    result.blockers.includes(
      "resend_shared_full_access_revocation_not_proven"
    )
  );
});

test("complete non-secret topology evidence remains held", () => {
  const input = completeTopology();
  const normalized = normalizeCredentialTopology(input);
  const result = verifyCredentialTopology(normalized, {
    now: new Date(NOW)
  });
  assert.equal(result.topologyEvidenceComplete, true);
  assert.equal(result.effectsAllowed, false);
  assert.deepEqual(result.blockers, []);
  assert.doesNotMatch(
    JSON.stringify(result),
    /credentialValue|materialValue|providerToken/iu
  );
});

test("full-access provider scope fails closed", () => {
  const input = completeTopology();
  item(
    input,
    "resend.sender.production.restricted"
  ).scopes = ["account:full_access"];
  assertCode(
    "CREDENTIAL_TOPOLOGY_FULL_ACCESS_FORBIDDEN",
    () => normalizeCredentialTopology(input)
  );
});

test("a sole co-located backup identity and ciphertext fail closed", () => {
  const input = completeTopology();
  item(
    input,
    "backup.age.identity.recovery"
  ).storageBoundary =
    "zen-off-machine-ciphertext-store";
  assertCode(
    "CREDENTIAL_TOPOLOGY_BINDING_MISMATCH",
    () => verifyCredentialTopology(input, { now: new Date(NOW) })
  );
});

test("one-operator recovery fails the exact inventory", () => {
  const input = completeTopology();
  input.items = input.items.filter(
    (entry) => entry.name !== "operator.recovery.approver"
  );
  assertCode(
    "CREDENTIAL_TOPOLOGY_INVALID",
    () => verifyCredentialTopology(input, { now: new Date(NOW) })
  );
});

test("operator recovery requires independent requester approver and control evidence", () => {
  const input = completeTopology();
  const sharedDigest = evidence("one-operator-recovery");
  for (const name of [
    "control.operator.recovery.dual-control",
    "operator.recovery.approver",
    "operator.recovery.requester"
  ]) {
    item(input, name).evidenceDigest = sharedDigest;
  }
  const result = verifyCredentialTopology(input, {
    now: new Date(NOW)
  });
  assert.equal(result.topologyEvidenceComplete, false);
  assert.ok(
    result.blockers.includes(
      "operator_recovery_independent_evidence_not_proven"
    )
  );
});

test("Resend production and staging cannot share custody", () => {
  const input = completeTopology();
  item(
    input,
    "resend.sender.staging.restricted"
  ).storageBoundary =
    "dell-hosted-production-secret-store";
  assertCode(
    "CREDENTIAL_TOPOLOGY_BINDING_MISMATCH",
    () => verifyCredentialTopology(input, { now: new Date(NOW) })
  );
});

test("historical shared Resend authority stays status-only until revoked", () => {
  const input = completeTopology();
  const shared = item(
    input,
    "resend.sender.historical-shared-full-access"
  );
  shared.rotationState = "shared_pending_revocation";
  shared.materialPresent = false;
  const result = verifyCredentialTopology(input, {
    now: new Date(NOW)
  });
  assert.equal(result.topologyEvidenceComplete, false);
  assert.ok(
    result.blockers.includes(
      "resend_shared_full_access_revocation_not_proven"
    )
  );
});

test("rotation states require overlap or revocation evidence", () => {
  const missingEvidence = completeTopology();
  const prior = item(
    missingEvidence,
    "stripe.webhook.production.prior"
  );
  prior.rotationState = "revoked";
  prior.materialPresent = false;
  prior.lastProvenAt = null;
  prior.evidenceDigest = null;
  assertCode(
    "CREDENTIAL_TOPOLOGY_EVIDENCE_REQUIRED",
    () => normalizeCredentialTopology(missingEvidence)
  );

  const missingControl = completeTopology();
  const control = item(
    missingControl,
    "control.identity.pepper.rotation"
  );
  control.rotationState = "unproven";
  control.lastProvenAt = null;
  control.evidenceDigest = null;
  const result = verifyCredentialTopology(missingControl, {
    now: new Date(NOW)
  });
  assert.equal(result.topologyEvidenceComplete, false);
  assert.ok(
    result.blockers.includes(
      "identity_pepper_overlap_or_revocation_not_proven"
    )
  );
});

test("future-dated evidence cannot complete topology", () => {
  const input = completeTopology();
  item(input, "cloudflare.tunnel.production.connector").lastProvenAt =
    "2026-08-10T16:00:00.001Z";
  const result = verifyCredentialTopology(input, {
    now: new Date(NOW)
  });
  assert.equal(result.topologyEvidenceComplete, false);
  assert.ok(
    result.blockers.includes(
      "evidence_in_future:cloudflare.tunnel.production.connector"
    )
  );
});

test("unknown secret-bearing fields are rejected without echo", () => {
  for (const field of [
    "credentialValue",
    "environmentValue",
    "keychainContents",
    "providerToken",
    "secretPrefix"
  ]) {
    const input = completeTopology();
    const selected = item(
      input,
      "stripe.runtime.production.restricted"
    );
    selected[field] = "must-not-be-accepted-or-echoed";
    assert.throws(
      () => normalizeCredentialTopology(input),
      (error) => {
        assert.equal(
          error?.code,
          "CREDENTIAL_TOPOLOGY_ITEM_INVALID"
        );
        assert.doesNotMatch(
          String(error?.message ?? ""),
          /must-not-be-accepted-or-echoed/u
        );
        return true;
      }
    );
  }
});

test("JSON schema exposes only the reviewed metadata vocabulary", async () => {
  const schema = JSON.parse(
    await readFile(
      path.join(OPS_ROOT, "credential-topology.schema.json"),
      "utf8"
    )
  );
  assert.equal(schema.$id, CREDENTIAL_TOPOLOGY_JSON_SCHEMA_ID);
  assert.equal(schema.properties.mode.const, "held");
  assert.equal(schema.properties.items.minItems, 26);
  assert.equal(schema.properties.items.maxItems, 26);
  assert.deepEqual(
    schema.$defs.item.properties.name.enum,
    CREDENTIAL_TOPOLOGY_CONTRACT.names
  );
  assert.ok(
    schema.$defs.item.required.includes("providerBinding")
  );
  const bytes = JSON.stringify(schema);
  assert.doesNotMatch(
    bytes,
    /credentialValue|environmentValue|keychainContents|providerToken|secretPrefix/u
  );
});

test("OPS-SECRETS packet bytes contain no credential-shaped value", async () => {
  const packetPaths = [
    "OPS-SECRETS-01A-HELD-CREDENTIAL-TOPOLOGY-RUNBOOK-2026-08-10.md",
    "WIRING-NOTES-OPS-SECRETS-01A-2026-08-10.md",
    "credential-topology.mjs",
    "credential-topology.schema.json",
    "test/credential-topology.test.mjs",
    "test/stripe-restricted-key-topology.test.mjs",
    "verify-credential-topology.mjs"
  ];
  const source = (
    await Promise.all(
      packetPaths.map((name) =>
        readFile(path.join(OPS_ROOT, name), "utf8")
      )
    )
  ).join("\n");
  const credentialPrefixes = [
    ["r", "k_", "live_"].join(""),
    ["s", "k_", "live_"].join(""),
    ["w", "hsec_"].join(""),
    ["r", "e_"].join("")
  ];
  for (const prefix of credentialPrefixes) {
    assert.doesNotMatch(
      source,
      new RegExp(
        `(?:^|[^A-Za-z0-9])${prefix}[A-Za-z0-9._-]{8,}`,
        "u"
      )
    );
  }
  assert.doesNotMatch(
    source,
    /-----BEGIN (?:OPENSSH|PRIVATE) KEY-----/u
  );
  assert.doesNotMatch(
    source,
    /(?:CLOUDFLARE_API_TOKEN|TUNNEL_TOKEN)=[A-Za-z0-9._-]+/u
  );
});

test("read-only verifier accepts only one explicit absolute JSON path", async (t) => {
  const verifierPath = path.join(
    OPS_ROOT,
    "verify-credential-topology.mjs"
  );
  const verifierSource = await readFile(verifierPath, "utf8");
  assert.doesNotMatch(
    verifierSource,
    /process\.env|fetch\s*\(|node:child_process|osascript|security\s+find|keychain/iu
  );

  const root = await mkdtemp(
    path.join(tmpdir(), "sitesourcery-credential-topology-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, "topology.json");
  await writeFile(
    inputPath,
    `${JSON.stringify(completeTopology())}\n`,
    { mode: 0o600 }
  );
  const result = spawnSync(
    process.execPath,
    [verifierPath, "--input", inputPath],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.topologyEvidenceComplete, true);
  assert.equal(output.effectsAllowed, false);

  const heldPath = path.join(root, "held-topology.json");
  await writeFile(
    heldPath,
    `${JSON.stringify(createHeldCredentialTopologyTemplate())}\n`,
    { mode: 0o600 }
  );
  const held = spawnSync(
    process.execPath,
    [verifierPath, "--input", heldPath],
    { encoding: "utf8" }
  );
  assert.equal(held.status, 2, held.stderr || held.stdout);
  assert.equal(
    JSON.parse(held.stdout).topologyEvidenceComplete,
    false
  );

  const refused = spawnSync(
    process.execPath,
    [verifierPath, "--input", "relative.json"],
    { encoding: "utf8" }
  );
  assert.equal(refused.status, 1);
  assert.deepEqual(JSON.parse(refused.stdout), {
    schema: "sitesourcery.credential-topology-verification/v1",
    mode: "held",
    effectsAllowed: false,
    topologyEvidenceComplete: false,
    code: "CREDENTIAL_TOPOLOGY_ARGUMENT_INVALID"
  });
});
