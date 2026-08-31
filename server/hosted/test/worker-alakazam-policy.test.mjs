import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ALAKAZAM_WORKER_POLICY_READINESS_SCHEMA,
  alakazamWorkerPolicyReadiness
} from "../worker-alakazam-composition.mjs";
import {
  isReleasedAlakazamPolicyReadiness
} from "../alakazam-release-config.mjs";

const RELEASED = Object.freeze({
  schema: "sitesourcery.alakazam-policy-readiness/v1",
  ready: true,
  verified: true,
  state: "released",
  commercialEffects: true,
  providerEffects: true,
  publicationEffects: true,
  automaticRecoveryFromReversalEvidence: false
});

test("Alakazam workers fail closed for missing, held, stale, and mismatched policy", () => {
  const held = {
    ...RELEASED,
    state: "held",
    commercialEffects: false,
    providerEffects: false,
    publicationEffects: false
  };
  const stale = { ...RELEASED, ready: false, verified: false };
  const mismatches = [
    { ...RELEASED, schema: "sitesourcery.alakazam-policy-readiness/v0" },
    { ...RELEASED, commercialEffects: false },
    { ...RELEASED, providerEffects: false },
    { ...RELEASED, publicationEffects: false },
    { ...RELEASED, automaticRecoveryFromReversalEvidence: true }
  ];

  for (const value of [null, held, stale, ...mismatches]) {
    assert.equal(isReleasedAlakazamPolicyReadiness(value), false);
    assert.deepEqual(alakazamWorkerPolicyReadiness(value), {
      schema: ALAKAZAM_WORKER_POLICY_READINESS_SCHEMA,
      ready: false,
      state: "held",
      code: "ALAKAZAM_WORKER_POLICY_NOT_RELEASED",
      commercialEffects: false,
      providerEffects: false,
      publicationEffects: false,
      automaticRestoration: false
    });
  }
});

test("Alakazam workers accept only the API release gate's exact policy tuple", () => {
  assert.equal(isReleasedAlakazamPolicyReadiness(RELEASED), true);
  assert.deepEqual(alakazamWorkerPolicyReadiness(RELEASED), {
    schema: ALAKAZAM_WORKER_POLICY_READINESS_SCHEMA,
    ready: true,
    state: "released",
    code: "READY",
    commercialEffects: true,
    providerEffects: true,
    publicationEffects: true,
    automaticRestoration: false
  });
});

test("all external Alakazam workers consume only read-only policy readiness before enablement", async () => {
  const source = await readFile(
    new URL("../worker-alakazam-composition.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /createPostgresAlakazamPolicyAuthorityRepository/u
  );
  assert.match(
    source,
    /await repository\.readiness\(\)/u
  );
  assert.equal(
    [...source.matchAll(/shared\.workerPolicy\.ready === true/gu)].length,
    3
  );
  assert.match(source, /"alakazam-publication": publicationControl/u);
  assert.match(
    source,
    /SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER/u
  );
  assert.doesNotMatch(
    source,
    /policyRepository\.(?:policy|read|write|apply|synchronize|activate|release)\(/u
  );
  assert.doesNotMatch(
    source,
    /setInterval|setTimeout|while\s*\(/u
  );
});
