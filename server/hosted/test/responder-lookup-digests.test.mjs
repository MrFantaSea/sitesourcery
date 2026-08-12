import assert from "node:assert/strict";
import test from "node:test";

import {
  createResponderLookupDigests
} from "../responder-lookup-digests.mjs";

const CURRENT = Buffer.alloc(32, 7);
const PRIOR = Buffer.alloc(32, 9);

function digests(overrides = {}) {
  return createResponderLookupDigests({
    pepper: CURRENT,
    pepperVersion: "v2",
    previousPeppers: { v1: PRIOR },
    ...overrides
  });
}

test("phone-derived lookups are keyed, purpose-bound, and deterministic", async () => {
  const selected = digests();
  const number = selected.numberLookupDigest("+18562441220");
  assert.match(number.digest, /^[0-9a-f]{64}$/u);
  assert.equal(number.keyVersion, "v2");
  assert.deepEqual(selected.numberLookupDigest("+18562441220"), number);

  const caller = selected.callerRouteDigest("+18562441220");
  assert.match(caller.digest, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    caller.digest,
    number.digest,
    "number and caller purposes must derive distinct keys"
  );
  assert.notEqual(
    selected.numberLookupDigest("+18562441221").digest,
    number.digest
  );
});

test("candidates cover the current and every prior pepper version in order", () => {
  const selected = digests();
  const candidates = selected.numberLookupCandidates("+18562441220");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].keyVersion, "v2");
  assert.equal(candidates[1].keyVersion, "v1");
  assert.equal(
    candidates[0].digest,
    selected.numberLookupDigest("+18562441220").digest
  );
  const prior = createResponderLookupDigests({
    pepper: PRIOR,
    pepperVersion: "v1"
  });
  assert.equal(
    candidates[1].digest,
    prior.numberLookupDigest("+18562441220").digest,
    "the prior candidate must equal the prior pepper's writer digest"
  );
  const callerCandidates = selected.callerRouteCandidates("+18562441220");
  assert.equal(callerCandidates.length, 2);
  assert.equal(
    callerCandidates[0].digest,
    selected.callerRouteDigest("+18562441220").digest
  );
  assert.equal(
    callerCandidates[1].digest,
    prior.callerRouteDigest("+18562441220").digest,
    "caller-route candidates must cover prior peppers for sealed material"
  );
  assert.notEqual(callerCandidates[0].digest, candidates[0].digest);
  assert.deepEqual(selected.verifierVersions, ["v2", "v1"]);
  assert.equal(selected.writerVersion, "v2");
});

test("readiness redacts secret material and reports versions only", async () => {
  const readiness = await digests().readiness();
  assert.deepEqual(readiness, {
    ready: true,
    verified: true,
    kind: "responder-lookup-digests",
    providerEffects: false,
    writerVersion: "v2",
    verifierVersions: ["v2", "v1"],
    secretMaterial: "redacted"
  });
  assert.doesNotMatch(JSON.stringify(readiness), /[0-9a-f]{32}/u);
});

test("weak peppers, duplicate versions, and invalid addresses fail closed", () => {
  assert.throws(
    () => createResponderLookupDigests({
      pepper: Buffer.alloc(16, 1),
      pepperVersion: "v1"
    }),
    (error) => error?.code === "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => createResponderLookupDigests({
      pepper: CURRENT,
      pepperVersion: "V1"
    }),
    (error) => error?.code === "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED"
  );
  assert.throws(
    () => digests({ previousPeppers: { v2: PRIOR } }),
    (error) => error?.code === "RESPONDER_LOOKUP_DIGEST_CONFIGURATION_REQUIRED"
  );
  for (const address of ["", "a".repeat(65), "+1 856", "x\r\ny", null]) {
    assert.throws(
      () => digests().numberLookupDigest(address),
      (error) => error?.code === "RESPONDER_LOOKUP_DIGEST_INVALID"
    );
  }
});
