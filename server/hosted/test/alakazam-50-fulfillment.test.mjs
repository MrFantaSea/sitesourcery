import assert from "node:assert/strict";
import test from "node:test";

import {
  ALAKAZAM_50_CLAIM_BINDING,
  createAlakazam50FulfillmentRepository,
  createAlakazam50TierCompiler
} from "../alakazam-50-fulfillment.mjs";

const INHERITED_BINDING = Symbol.for("sitesourcery.alakazam-35-claim-binding/v1");

function claimed(tierId = "alakazam_50") {
  const configuredFacts = { theme: "clear", businessName: "F04" };
  Object.defineProperty(configuredFacts, INHERITED_BINDING, {
    enumerable: false,
    value: { configuration: { kind: "35" } }
  });
  Object.freeze(configuredFacts);
  return Object.freeze({
    status: "claimed",
    tenantId: "10000000-0000-4000-8000-000000000001",
    customerId: "20000000-0000-4000-8000-000000000001",
    projectId: "30000000-0000-4000-8000-000000000001",
    subscriptionRevision: 7,
    authority: { policy: { tierId } },
    configuredFacts
  });
}

function baseRepository(selected) {
  return {
    async claimNextFulfillment() { return selected; },
    async bindFulfillmentDecision() {},
    async finalizeFulfillmentPublication() {},
    async markFulfillmentDark() {},
    async stageFulfillmentPublication() {}
  };
}

test("$50 claim decorator preserves inherited $35 binding and adds exact non-JSON $50 evidence", async () => {
  const selectedBinding = Object.freeze({
    configuration: Object.freeze({ configurationDigest: "a".repeat(64) })
  });
  const repository = createAlakazam50FulfillmentRepository({
    baseRepository: baseRepository(claimed()),
    tierRepository: {
      async readCompilationBinding(input) {
        assert.equal(input.expectedSubscriptionRevision, 7);
        return selectedBinding;
      }
    }
  });
  const selected = await repository.claimNextFulfillment({});
  assert.deepEqual(selected.configuredFacts[INHERITED_BINDING], {
    configuration: { kind: "35" }
  });
  assert.equal(
    selected.configuredFacts[ALAKAZAM_50_CLAIM_BINDING],
    selectedBinding
  );
  assert.equal(JSON.stringify(selected.configuredFacts).includes("claim-binding"), false);
});

test("$50 claim decorator leaves lower-tier fulfillment unchanged", async () => {
  const original = claimed("alakazam_35");
  const repository = createAlakazam50FulfillmentRepository({
    baseRepository: baseRepository(original),
    tierRepository: {
      async readCompilationBinding() { assert.fail("must not read $50 evidence"); }
    }
  });
  assert.equal(await repository.claimNextFulfillment({}), original);
});

test("tier compiler requires internal $50 evidence and delegates lower tiers", () => {
  const calls = [];
  const compiler = createAlakazam50TierCompiler({
    baseCompiler: {
      compileAlakazam(input) { calls.push(["base", input]); return "base"; }
    },
    alakazam50Compiler: {
      compile(input) { calls.push(["50", input]); return "50"; }
    }
  });
  const facts = { theme: "clear" };
  Object.defineProperty(facts, ALAKAZAM_50_CLAIM_BINDING, {
    enumerable: false,
    value: { configuration: { configurationDigest: "a".repeat(64) } }
  });
  assert.equal(compiler.compileAlakazam({
    authority: { policy: { tierId: "alakazam_50" } },
    configuredFacts: facts
  }), "50");
  assert.equal(compiler.compileAlakazam({
    authority: { policy: { tierId: "alakazam_35" } },
    configuredFacts: { theme: "clear" }
  }), "base");
  assert.deepEqual(calls.map((entry) => entry[0]), ["50", "base"]);
  assert.throws(() => compiler.compileAlakazam({
    authority: { policy: { tierId: "alakazam_50" } },
    configuredFacts: { theme: "clear" }
  }), /exact Alakazam \$50 configuration/u);
});
