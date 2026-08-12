import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STRIPE_RESTRICTED_KEY_CONTRACT,
  STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE,
  STRIPE_RUNTIME_API_SCOPES_BY_PURPOSE,
  createHeldCredentialTopologyTemplate,
  normalizeCredentialTopology,
  verifyStripeCredentialReadiness
} from "../credential-topology.mjs";

const NOW = "2026-08-11T16:10:00.000Z";

function evidence(label) {
  return createHash("sha256")
    .update(`stripe-credential-topology:${label}`, "utf8")
    .digest("hex");
}

function item(input, name) {
  return input.items.find((entry) => entry.name === name);
}

function topology() {
  const input = structuredClone(
    createHeldCredentialTopologyTemplate()
  );
  const accountId = "acct_topology_contract";
  const runtime = item(
    input,
    "stripe.runtime.production.restricted"
  );
  runtime.rotationState = "active";
  runtime.materialPresent = true;
  runtime.lastProvenAt = "2026-08-11T16:00:00.000Z";
  runtime.evidenceDigest = evidence("runtime-scope-readback");
  runtime.scopes = [
    ...STRIPE_RUNTIME_API_SCOPES_BY_PURPOSE.download
  ];
  runtime.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "restricted",
    keyVersion: "runtime-production-v1",
    keyFingerprint: evidence("runtime-fingerprint"),
    activatedAt: "2026-08-11T14:30:00.000Z",
    enabledPurposes: ["download"]
  };

  const provisioner = item(
    input,
    "stripe.provisioner.production.restricted"
  );
  provisioner.rotationState = "ephemeral_revoked";
  provisioner.materialPresent = false;
  provisioner.lastProvenAt =
    "2026-08-11T14:41:00.000Z";
  provisioner.evidenceDigest = evidence(
    "provisioner-revocation"
  );
  provisioner.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "restricted",
    keyVersion: "provisioner-production-v1",
    keyFingerprint: evidence("provisioner-fingerprint"),
    activatedAt: "2026-08-11T14:00:00.000Z",
    revokedAt: "2026-08-11T14:40:00.000Z",
    scopeProvenAt: "2026-08-11T14:01:00.000Z",
    scopeEvidenceDigest: evidence(
      "provisioner-scope-readback"
    )
  };

  const standard = item(
    input,
    "stripe.standard.production.compromised"
  );
  standard.rotationState = "compromised_revoked";
  standard.materialPresent = false;
  standard.lastProvenAt = "2026-08-11T14:36:00.000Z";
  standard.evidenceDigest = evidence("standard-revocation");
  standard.providerBinding = {
    provider: "stripe",
    environment: "production",
    livemode: true,
    accountId,
    keyClass: "standard_status_only",
    keyVersion: "standard-compromised-v1",
    keyFingerprint: evidence("standard-fingerprint"),
    revokedAt: "2026-08-11T14:35:00.000Z"
  };
  return input;
}

function readiness(input = topology(), options = {}) {
  return verifyStripeCredentialReadiness(input, {
    now: NOW,
    environment: "production",
    livemode: true,
    runtimeFingerprint: evidence("runtime-fingerprint"),
    ...options
  });
}

function code(expected, action) {
  assert.throws(action, (error) => error?.code === expected);
}

test("authoritative credential topology derives exact current adapter operations and excludes Domains", () => {
  assert.deepEqual(
    Object.keys(STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE),
    [
      "alakazam",
      "customBuildChange",
      "customBuildFinal",
      "customBuildStart",
      "download",
      "serviceAssessment"
    ]
  );
  assert.deepEqual(
    STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE.download,
    [
      "checkout.sessions.create",
      "checkout.sessions.retrieve",
      "prices.retrieve",
      "webhookEndpoints.retrieve"
    ]
  );
  assert.ok(
    STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE
      .serviceAssessment.includes("charges.retrieve")
  );
  assert.ok(
    STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE
      .customBuildFinal.includes("refunds.list")
  );
  assert.ok(
    STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE
      .alakazam.includes("subscriptionSchedules.update")
  );
  assert.equal(
    JSON.stringify(
      STRIPE_RUNTIME_API_OPERATIONS_BY_PURPOSE
    ).includes("paymentIntents"),
    false
  );
  assert.equal(STRIPE_RESTRICTED_KEY_CONTRACT.domainsHeld, true);
});

test("operation inventory covers every current Stripe SDK call and isolates the Domain-only write set", async () => {
  const source = (
    await readFile(
      new URL(
        "../../server/commerce/adapters/stripe.mjs",
        import.meta.url
      ),
      "utf8"
    )
  ).replace(/\s+/gu, " ");
  const observed = [
    ...new Set(
      [...source.matchAll(
        /await client\.([A-Za-z]+(?:\.[A-Za-z]+){1,2})\s*\(/gu
      )].map((match) => match[1])
    )
  ].sort();
  const domainHeld = [
    "paymentIntents.cancel",
    "paymentIntents.capture",
    "paymentIntents.retrieve",
    "refunds.create"
  ];
  assert.deepEqual(
    observed,
    [
      ...new Set([
        ...STRIPE_RESTRICTED_KEY_CONTRACT
          .allRuntimeOperations,
        ...domainHeld
      ])
    ].sort()
  );
  assert.equal(
    STRIPE_RESTRICTED_KEY_CONTRACT.allRuntimeOperations.some(
      (operation) => domainHeld.includes(operation)
    ),
    false
  );
});

test("the existing three Stripe records produce bound non-secret readiness", () => {
  const result = readiness(topology(), {
    purpose: "download"
  });
  assert.equal(result.ready, true);
  assert.equal(result.mode, "held");
  assert.equal(result.selection, "stripe");
  assert.equal(result.provisionerRevoked, true);
  assert.equal(result.compromisedStandardRevoked, true);
  assert.equal(result.domainsHeld, true);
  assert.equal(result.effectsAllowed, false);
  assert.deepEqual(result.enabledPurposes, ["download"]);
  assert.equal(result.runtimeScopeCount, 3);
  assert.equal(result.runtimeOperationCount, 4);
  assert.doesNotMatch(
    JSON.stringify(result),
    /credentialValue|providerToken|secretPrefix/u
  );
});

test("missing, extra, or write-upgraded runtime scope fails closed", () => {
  for (const scopes of [
    ["checkout_sessions:write", "prices:read"],
    [
      "checkout_sessions:write",
      "prices:read",
      "webhook_endpoints:read",
      "accounts:read"
    ],
    [
      "checkout_sessions:write",
      "prices:read",
      "webhook_endpoints:write"
    ]
  ]) {
    const input = topology();
    item(
      input,
      "stripe.runtime.production.restricted"
    ).scopes = scopes;
    code(
      "CREDENTIAL_TOPOLOGY_SCOPE_MISMATCH",
      () => normalizeCredentialTopology(input)
    );
  }
});

test("Standard, full-access, and shared runtime identities are unusable", () => {
  const standard = topology();
  item(
    standard,
    "stripe.runtime.production.restricted"
  ).providerBinding.keyClass = "standard";
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
    () => normalizeCredentialTopology(standard)
  );

  const full = topology();
  item(
    full,
    "stripe.runtime.production.restricted"
  ).scopes = ["account:full_access"];
  code(
    "CREDENTIAL_TOPOLOGY_FULL_ACCESS_FORBIDDEN",
    () => normalizeCredentialTopology(full)
  );

  const shared = topology();
  item(
    shared,
    "stripe.provisioner.production.restricted"
  ).providerBinding.keyFingerprint = evidence(
    "runtime-fingerprint"
  );
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_SHARED",
    () => readiness(shared)
  );
});

test("account, mode, fingerprint, and evidence reuse drift fail closed", () => {
  const account = topology();
  item(
    account,
    "stripe.provisioner.production.restricted"
  ).providerBinding.accountId = "acct_other";
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_MISMATCH",
    () => readiness(account)
  );

  const mode = topology();
  item(
    mode,
    "stripe.runtime.production.restricted"
  ).providerBinding.livemode = false;
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
    () => normalizeCredentialTopology(mode)
  );

  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_MISMATCH",
    () =>
      readiness(topology(), {
        runtimeFingerprint: evidence("another-runtime")
      })
  );

  const reused = topology();
  item(
    reused,
    "stripe.standard.production.compromised"
  ).evidenceDigest = item(
    reused,
    "stripe.provisioner.production.restricted"
  ).evidenceDigest;
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_IDENTITY_SHARED",
    () => readiness(reused)
  );
});

test("stale or unrevoked provisioner evidence cannot authorize readiness", () => {
  const longLived = topology();
  item(
    longLived,
    "stripe.provisioner.production.restricted"
  ).providerBinding.activatedAt =
    "2026-08-10T00:00:00.000Z";
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_CHRONOLOGY_INVALID",
    () => readiness(longLived)
  );

  const unrevoked = topology();
  const provisioner = item(
    unrevoked,
    "stripe.provisioner.production.restricted"
  );
  provisioner.rotationState = "unproven";
  provisioner.materialPresent = false;
  provisioner.lastProvenAt = null;
  provisioner.evidenceDigest = null;
  provisioner.providerBinding = null;
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_NOT_READY",
    () => readiness(unrevoked)
  );

  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_SCOPE_STALE",
    () =>
      readiness(topology(), {
        now: "2026-08-11T16:15:00.001Z"
      })
  );
});

test("compromised Standard-key revocation evidence is mandatory", () => {
  const input = topology();
  const standard = item(
    input,
    "stripe.standard.production.compromised"
  );
  standard.rotationState = "compromised_pending_revocation";
  standard.lastProvenAt = null;
  standard.evidenceDigest = null;
  standard.providerBinding = null;
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_NOT_READY",
    () => readiness(input)
  );
});

test("Domain purpose and Payment Intent or Refund write expansion remain held", () => {
  const purpose = topology();
  item(
    purpose,
    "stripe.runtime.production.restricted"
  ).providerBinding.enabledPurposes = [
    "domainRegistration",
    "download"
  ];
  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_BINDING_INVALID",
    () => normalizeCredentialTopology(purpose)
  );

  for (const scope of [
    "payment_intents:write",
    "refunds:write"
  ]) {
    const input = topology();
    item(
      input,
      "stripe.runtime.production.restricted"
    ).scopes.push(scope);
    code(
      "CREDENTIAL_TOPOLOGY_SCOPE_MISMATCH",
      () => normalizeCredentialTopology(input)
    );
  }

  code(
    "CREDENTIAL_TOPOLOGY_STRIPE_PURPOSE_HELD",
    () => readiness(topology(), { purpose: "serviceAssessment" })
  );
});

test("bounded provisioner inventory cannot lose scope or borrow runtime scope", () => {
  for (const scopes of [
    STRIPE_RESTRICTED_KEY_CONTRACT.provisionerScopes.slice(1),
    [
      ...STRIPE_RESTRICTED_KEY_CONTRACT.provisionerScopes,
      "checkout_sessions:write"
    ]
  ]) {
    const input = topology();
    item(
      input,
      "stripe.provisioner.production.restricted"
    ).scopes = scopes;
    code(
      "CREDENTIAL_TOPOLOGY_SCOPE_MISMATCH",
      () => normalizeCredentialTopology(input)
    );
  }
});
