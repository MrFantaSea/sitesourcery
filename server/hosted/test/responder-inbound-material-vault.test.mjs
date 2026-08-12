import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";

import {
  createResponderInboundMaterialVault
} from "../responder-inbound-material-vault.mjs";

const KEY = Buffer.alloc(32, 3).toString("base64url");
const PRIOR_KEY = Buffer.alloc(32, 5).toString("base64url");
const FROM = "+18565550100";

function digester(address) {
  return createHmac("sha256", "test-caller-key")
    .update(String(address), "utf8")
    .digest("hex");
}

function vault(overrides = {}) {
  return createResponderInboundMaterialVault({
    currentKeyVersion: "2026-08",
    currentKey: KEY,
    fromRouteDigestCandidates: (address) => [digester(address)],
    ...overrides
  });
}

function authority(overrides = {}) {
  return {
    inboundEventId: "10000000-0000-4000-8000-00000000000a",
    organizationId: "10000000-0000-4000-8000-00000000000b",
    projectId: "10000000-0000-4000-8000-00000000000c",
    channel: "sms",
    fromRouteDigest: digester(FROM),
    payloadDigest: "1".repeat(64),
    ...overrides
  };
}

test("inbound SMS material seals and opens only under its exact authority", async () => {
  const selected = vault();
  const body = "Please call me back about the fence quote 🙂";
  const sealed = await selected.sealInboundMaterial(
    authority(),
    { from: FROM, body }
  );
  assert.equal(sealed.keyVersion, "2026-08");
  assert.equal(sealed.nonce.length, 12);
  assert.equal(sealed.authenticationTag.length, 16);
  assert.deepEqual(
    await selected.openInboundMaterial(authority(), sealed),
    { from: FROM, body }
  );
  await assert.rejects(
    selected.openInboundMaterial(
      authority({ organizationId: randomUUID() }),
      sealed
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE"
  );
  await assert.rejects(
    selected.openInboundMaterial(
      authority({ inboundEventId: randomUUID() }),
      sealed
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE"
  );
});

test("voice caller material carries the forwarded line and nothing else", async () => {
  const selected = vault();
  const voiceAuthority = authority({ channel: "voice" });
  const sealed = await selected.sealInboundMaterial(voiceAuthority, {
    from: FROM,
    forwardedFrom: "+18565550111"
  });
  assert.deepEqual(
    await selected.openInboundMaterial(voiceAuthority, sealed),
    { from: FROM, forwardedFrom: "+18565550111" }
  );
  await assert.rejects(
    selected.sealInboundMaterial(voiceAuthority, {
      from: FROM,
      forwardedFrom: "not-a-number"
    }),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_INVALID"
  );
  await assert.rejects(
    selected.sealInboundMaterial(voiceAuthority, {
      from: FROM,
      body: "voice has no body",
      forwardedFrom: null
    }),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_INVALID"
  );
});

test("the injected keyed digester binds the caller route", async () => {
  const selected = vault();
  await assert.rejects(
    selected.sealInboundMaterial(
      authority({ fromRouteDigest: "2".repeat(64) }),
      { from: FROM, body: "hello" }
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_INVALID"
  );
});

test("bounded bodies: empty allowed, 1600 allowed, longer and NUL rejected", async () => {
  const selected = vault();
  const okEmpty = await selected.sealInboundMaterial(
    authority(),
    { from: FROM, body: "" }
  );
  assert.equal(
    (await selected.openInboundMaterial(authority(), okEmpty)).body,
    ""
  );
  await selected.sealInboundMaterial(
    authority(),
    { from: FROM, body: "a".repeat(1600) }
  );
  await assert.rejects(
    selected.sealInboundMaterial(
      authority(),
      { from: FROM, body: "a".repeat(1601) }
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_INVALID"
  );
  await assert.rejects(
    selected.sealInboundMaterial(
      authority(),
      { from: FROM, body: `bad${String.fromCharCode(0)}byte` }
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_INVALID"
  );
});

test("prior-key envelopes open during rotation; unknown versions fail closed", async () => {
  const rotated = vault({
    priorKeyVersion: "2026-07",
    priorKey: PRIOR_KEY
  });
  const old = createResponderInboundMaterialVault({
    currentKeyVersion: "2026-07",
    currentKey: PRIOR_KEY,
    fromRouteDigestCandidates: (address) => [digester(address)]
  });
  const sealed = await old.sealInboundMaterial(
    authority(),
    { from: FROM, body: "sealed under the prior key" }
  );
  assert.equal(
    (await rotated.openInboundMaterial(authority(), sealed)).body,
    "sealed under the prior key"
  );
  await assert.rejects(
    vault().openInboundMaterial(authority(), sealed),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE"
  );
  const readiness = await rotated.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.priorKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(readiness), /base64|[0-9a-f]{40}/iu);
});

test("route digests sealed under a rotated-out pepper still validate via candidates", async () => {
  const oldPepperDigest = (address) => digester(`old-pepper:${address}`);
  const sealedUnderOldPepper = await createResponderInboundMaterialVault({
    currentKeyVersion: "2026-08",
    currentKey: KEY,
    fromRouteDigestCandidates: (address) => [oldPepperDigest(address)]
  }).sealInboundMaterial(
    authority({ fromRouteDigest: oldPepperDigest(FROM) }),
    { from: FROM, body: "sealed before the pepper rotated" }
  );
  const rotatedKeyring = vault({
    fromRouteDigestCandidates: (address) => [
      digester(address),
      oldPepperDigest(address)
    ]
  });
  assert.equal(
    (await rotatedKeyring.openInboundMaterial(
      authority({ fromRouteDigest: oldPepperDigest(FROM) }),
      sealedUnderOldPepper
    )).body,
    "sealed before the pepper rotated"
  );
  await assert.rejects(
    vault().openInboundMaterial(
      authority({ fromRouteDigest: oldPepperDigest(FROM) }),
      sealedUnderOldPepper
    ),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_UNAVAILABLE",
    "a keyring that no longer produces the sealed digest fails closed"
  );
});

test("configuration requires the digester and one exact 32-byte key", () => {
  assert.throws(
    () => createResponderInboundMaterialVault({
      currentKeyVersion: "2026-08",
      currentKey: KEY
    }),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => vault({ currentKey: "short" }),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => vault({ priorKeyVersion: "2026-08", priorKey: PRIOR_KEY }),
    (error) => error?.code === "RESPONDER_INBOUND_MATERIAL_CONFIGURATION_REQUIRED"
  );
});
