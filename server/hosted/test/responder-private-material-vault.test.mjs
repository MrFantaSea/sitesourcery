import assert from "node:assert/strict";
import test from "node:test";

import { digest } from "../security.mjs";
import {
  createResponderPrivateMaterialVault,
  responderPrivateMaterialVaultFromEnvironment
} from "../responder-private-material-vault.mjs";

const TO = "+18562441220";
const BODY = "Sorry we missed you - this is Site Sourcery. Reply STOP to opt out.";
const AUTHORITY = Object.freeze({
  operationId: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  projectId: "10000000-0000-4000-8000-000000000003",
  interactionId: "10000000-0000-4000-8000-000000000004",
  contactAuthorityId: "10000000-0000-4000-8000-000000000005",
  messageKind: "missed_call_ack",
  routeDigest: digest({ routeKind: "sms", address: TO }),
  contentDigest: digest({ contentKind: "sms", body: BODY })
});
const CURRENT_KEY = Buffer.alloc(32, 7);
const PRIOR_KEY = Buffer.alloc(32, 9);

function vault(overrides = {}) {
  return createResponderPrivateMaterialVault({
    currentKeyVersion: "responder-2026-08",
    currentKey: CURRENT_KEY,
    randomBytes: () => Buffer.alloc(12, 3),
    ...overrides
  });
}

test("Responder private material round-trips only under exact operation authority", async () => {
  const selected = vault();
  const envelope = await selected.sealSmsMaterial(
    AUTHORITY,
    { to: TO, body: BODY }
  );
  assert.deepEqual(Object.keys(envelope), [
    "keyVersion", "nonce", "authenticationTag", "ciphertext"
  ]);
  assert.equal(envelope.keyVersion, "responder-2026-08");
  assert.equal(envelope.nonce.length, 12);
  assert.equal(envelope.authenticationTag.length, 16);
  assert.equal(envelope.ciphertext.includes(Buffer.from(TO)), false);
  assert.equal(envelope.ciphertext.includes(Buffer.from(BODY)), false);
  assert.deepEqual(
    await selected.openSmsMaterial(AUTHORITY, envelope),
    { to: TO, body: BODY }
  );
  const status = await selected.readiness();
  assert.equal(status.ready, true);
  assert.equal(JSON.stringify(status).includes("responder-2026-08"), false);
  assert.equal(JSON.stringify(status).includes(CURRENT_KEY.toString("base64url")), false);
});

test("AAD, ciphertext, route, and content drift fail closed without material leakage", async () => {
  const selected = vault();
  const envelope = await selected.sealSmsMaterial(
    AUTHORITY,
    { to: TO, body: BODY }
  );
  const cases = [
    [
      { ...AUTHORITY, operationId: "20000000-0000-4000-8000-000000000001" },
      envelope
    ],
    [
      AUTHORITY,
      { ...envelope, ciphertext: Buffer.from(envelope.ciphertext).fill(4, 0, 1) }
    ]
  ];
  for (const [selectedAuthority, selectedEnvelope] of cases) {
    await assert.rejects(
      selected.openSmsMaterial(selectedAuthority, selectedEnvelope),
      (error) =>
        error?.code === "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE" &&
        !error.message.includes(TO) &&
        !error.message.includes(BODY)
    );
  }
  await assert.rejects(
    selected.sealSmsMaterial(
      { ...AUTHORITY, routeDigest: "a".repeat(64) },
      { to: TO, body: BODY }
    ),
    (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_INVALID"
  );
  await assert.rejects(
    selected.sealSmsMaterial(
      { ...AUTHORITY, contentDigest: digest({ contentKind: "sms", body: "drift" }) },
      { to: TO, body: BODY }
    ),
    (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_INVALID"
  );
});

test("one prior key supports bounded rotation while all other versions fail", async () => {
  const priorVault = vault({
    currentKeyVersion: "responder-2026-07",
    currentKey: PRIOR_KEY
  });
  const priorEnvelope = await priorVault.sealSmsMaterial(
    AUTHORITY,
    { to: TO, body: BODY }
  );
  const rotating = vault({
    priorKeyVersion: "responder-2026-07",
    priorKey: PRIOR_KEY
  });
  assert.deepEqual(
    await rotating.openSmsMaterial(AUTHORITY, priorEnvelope),
    { to: TO, body: BODY }
  );
  assert.equal((await rotating.readiness()).priorKeyConfigured, true);
  await assert.rejects(
    vault().openSmsMaterial(AUTHORITY, priorEnvelope),
    (error) => error?.code === "RESPONDER_PRIVATE_MATERIAL_UNAVAILABLE"
  );
});

test("environment configuration requires exact current and paired prior material", () => {
  const current = CURRENT_KEY.toString("base64url");
  const prior = PRIOR_KEY.toString("base64url");
  assert.equal(
    responderPrivateMaterialVaultFromEnvironment({
      SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "responder-2026-08",
      SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL: current
    }).kind,
    "responder-private-material-vault"
  );
  for (const environment of [
    {},
    {
      SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "bad version",
      SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL: current
    },
    {
      SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "responder-2026-08",
      SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL: "short"
    },
    {
      SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "responder-2026-08",
      SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL: current,
      SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_VERSION: "responder-2026-07"
    },
    {
      SITESOURCERY_RESPONDER_MATERIAL_KEY_VERSION: "responder-2026-08",
      SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL: current,
      SITESOURCERY_RESPONDER_MATERIAL_PRIOR_KEY_BASE64URL: prior
    }
  ]) {
    assert.throws(
      () => responderPrivateMaterialVaultFromEnvironment(environment),
      (error) => error?.code ===
        "RESPONDER_PRIVATE_MATERIAL_CONFIGURATION_REQUIRED"
    );
  }
});
