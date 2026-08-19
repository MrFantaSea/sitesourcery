import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ALAKAZAM_35_CLAIM_BINDING,
  createAlakazam35FulfillmentRepository,
  createAlakazam35TierCompiler
} from "../alakazam-35-fulfillment.mjs";
import {
  createAlakazam35PublicationPort
} from "../alakazam-35-publication-port.mjs";

function claimed(tierId = "alakazam_35") {
  return Object.freeze({
    status: "claimed",
    tenantId: "10000000-0000-4000-8000-000000000001",
    customerId: "20000000-0000-4000-8000-000000000001",
    projectId: "30000000-0000-4000-8000-000000000001",
    subscriptionRevision: 4,
    authority: { policy: { tierId } },
    configuredFacts: { theme: "clear", businessName: "F03" }
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

test("claim decorator binds exact revisioned $35 configuration without a customer-injectable JSON field", async () => {
  const calls = [];
  const binding = Object.freeze({
    configuration: Object.freeze({ configurationDigest: "a".repeat(64) }),
    mediaAsset: Object.freeze({ assetDigest: "b".repeat(64) })
  });
  const repository = createAlakazam35FulfillmentRepository({
    baseRepository: baseRepository(claimed()),
    tierRepository: {
      async readCompilationBinding(input) {
        calls.push(input);
        return binding;
      }
    }
  });
  const selected = await repository.claimNextFulfillment({});
  assert.equal(selected.configuredFacts[ALAKAZAM_35_CLAIM_BINDING], binding);
  assert.equal(Object.keys(selected.configuredFacts).includes(
    String(ALAKAZAM_35_CLAIM_BINDING)
  ), false);
  assert.equal(JSON.stringify(selected.configuredFacts).includes(
    "claim-binding"
  ), false);
  assert.deepEqual(calls, [{
    tenantId: selected.tenantId,
    customerId: selected.customerId,
    actorId: selected.customerId,
    projectId: selected.projectId,
    expectedSubscriptionRevision: 4
  }]);
});

test("claim decorator leaves $25 fulfillment unchanged", async () => {
  const original = claimed("alakazam_25");
  const repository = createAlakazam35FulfillmentRepository({
    baseRepository: baseRepository(original),
    tierRepository: {
      async readCompilationBinding() {
        assert.fail("$25 must not read $35 configuration");
      }
    }
  });
  assert.equal(await repository.claimNextFulfillment({}), original);
});

test("tier compiler sends bound $35 facts to the multi-file compiler and delegates $25", () => {
  const inputs = [];
  const compiler = createAlakazam35TierCompiler({
    baseCompiler: {
      compileAlakazam(input) {
        inputs.push(["base", input]);
        return { kind: "base" };
      }
    },
    alakazam35Compiler: {
      compile(input) {
        inputs.push(["35", input]);
        return { kind: "35" };
      }
    }
  });
  const facts = { theme: "clear" };
  Object.defineProperty(facts, ALAKAZAM_35_CLAIM_BINDING, {
    enumerable: false,
    value: {
      configuration: { configurationDigest: "a".repeat(64) },
      mediaAsset: null
    }
  });
  assert.deepEqual(compiler.compileAlakazam({
    authority: { policy: { tierId: "alakazam_35" } },
    configuredFacts: facts
  }), { kind: "35" });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      inputs[0][1].configuredFacts,
      ALAKAZAM_35_CLAIM_BINDING
    ),
    false
  );
  assert.deepEqual(compiler.compileAlakazam({
    authority: { policy: { tierId: "alakazam_25" } },
    configuredFacts: { theme: "clear" }
  }), { kind: "base" });
});

test("multi-file publication adapter installs exact referenced photo bytes with HTML", async () => {
  const bytes = Buffer.from("immutable PNG test bytes");
  const assetDigest = createHash("sha256").update(bytes).digest("hex");
  const assetPath = `assets/alakazam-header-${assetDigest}.png`;
  const installs = [];
  const runtime = {
    control: {},
    async readiness() { return { ready: true }; },
    releases: {
      async getManifest() {
        return { manifestDigest: "m", files: [] };
      }
    },
    async installRelease(input) {
      installs.push(input);
      return { manifestDigest: "m", files: input.files };
    }
  };
  const port = createAlakazam35PublicationPort({
    runtime,
    assetRepository: {
      async readPublicationAsset(input) {
        assert.deepEqual(input, {
          organizationId: "organization-one",
          projectId: "project-one",
          assetDigest,
          assetPath
        });
        return {
          assetDigest,
          assetPath,
          mediaType: "image/png",
          bytes
        };
      }
    },
    createBasePort({ runtime: selectedRuntime }) {
      return {
        async readiness() { return { ready: true, held: true }; },
        async request(proof) {
          await selectedRuntime.installRelease({
            projectId: proof.projectId,
            releaseId: proof.releaseId,
            files: [{
              path: "index.html",
              bytes: proof.artifact.htmlBytes,
              contentType: "text/html; charset=utf-8"
            }]
          });
          return { status: "held", published: false };
        },
        async rollback(proof) { return this.request(proof); },
        async unpublish() { return { status: "unpublished" }; }
      };
    }
  });
  const proof = {
    organizationId: "organization-one",
    projectId: "project-one",
    releaseId: "release-one",
    artifact: {
      htmlBytes: Buffer.from(
        `<html><img src="/${assetPath}" alt=""></html>`
      )
    }
  };
  assert.deepEqual(await port.request(proof), {
    status: "held",
    published: false
  });
  assert.equal(installs.length, 1);
  assert.equal(installs[0].files.length, 2);
  assert.equal(installs[0].files[1].path, assetPath);
  assert.deepEqual(installs[0].files[1].bytes, bytes);
});

test("multi-file publication adapter rejects substituted asset bytes before install", async () => {
  const expectedBytes = Buffer.from("expected");
  const assetDigest = createHash("sha256")
    .update(expectedBytes)
    .digest("hex");
  let baseCalls = 0;
  const port = createAlakazam35PublicationPort({
    runtime: {
      control: {},
      releases: { async getManifest() {} },
      async readiness() { return { ready: true }; },
      async installRelease() {}
    },
    assetRepository: {
      async readPublicationAsset() {
        return {
          assetDigest,
          assetPath: `assets/alakazam-header-${assetDigest}.png`,
          mediaType: "image/png",
          bytes: Buffer.from("substituted")
        };
      }
    },
    createBasePort() {
      return {
        readiness() {},
        request() { baseCalls += 1; },
        rollback() { baseCalls += 1; },
        unpublish() {}
      };
    }
  });
  await assert.rejects(port.request({
    organizationId: "organization-one",
    projectId: "project-one",
    releaseId: "release-one",
    artifact: {
      htmlBytes: Buffer.from(
        `<img src="/assets/alakazam-header-${assetDigest}.png">`
      )
    }
  }), /failed exact verification/u);
  assert.equal(baseCalls, 0);
});
