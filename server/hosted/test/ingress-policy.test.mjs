import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INGRESS_POLICY,
  ingressPolicyFromEnvironment
} from "../ingress-policy.mjs";

test("ingress policy uses conservative defaults and exact bounded overrides", () => {
  assert.deepEqual(ingressPolicyFromEnvironment({}), DEFAULT_INGRESS_POLICY);
  const selected = ingressPolicyFromEnvironment({
    SITESOURCERY_MAX_JSON_BODY_BYTES: "4096",
    SITESOURCERY_MAX_CONCURRENT_REQUESTS: "8",
    SITESOURCERY_REQUEST_DEADLINE_MS: "2500",
    SITESOURCERY_IDENTITY_IP_ATTEMPTS: "4",
    SITESOURCERY_COMPILE_ATTEMPTS: "3"
  });
  assert.equal(selected.body.jsonBytes, 4096);
  assert.equal(selected.node.maxConcurrentRequests, 8);
  assert.equal(selected.node.requestDeadlineMs, 2500);
  assert.equal(selected.identity.perIp.attempts, 4);
  assert.equal(selected.writes.compile.attempts, 3);
});

test("ingress policy fails closed on malformed or unsafe values", () => {
  for (const environment of [
    { SITESOURCERY_MAX_JSON_BODY_BYTES: "4096junk" },
    { SITESOURCERY_MAX_CONCURRENT_REQUESTS: "0" },
    { SITESOURCERY_REQUEST_DEADLINE_MS: "999" },
    { SITESOURCERY_COMPILE_ATTEMPTS: "10001" }
  ]) {
    assert.throws(
      () => ingressPolicyFromEnvironment(environment),
      (error) => error?.code === "INGRESS_POLICY_INVALID"
    );
  }
});
