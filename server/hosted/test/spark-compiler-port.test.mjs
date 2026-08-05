import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import {
  SPARK_COMPILER_SCHEMA,
  SPARK_COMPILER_PROVENANCE_SCHEMA,
  createSparkCompilerPort
} from "../spark-compiler-port.mjs";
import { createAlakazamFulfillmentAuthority } from "../../commerce-v2/alakazam-fulfillment.mjs";

const compilerUrl = new URL(
  "../../../abracadabra/app/abracadabra-compiler.js",
  import.meta.url
);
const IDS = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  customerId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
  subscriptionId: "44444444-4444-4444-8444-444444444444"
});

function authority(tierId) {
  return createAlakazamFulfillmentAuthority({
    tenantId: IDS.tenantId,
    customerId: IDS.customerId,
    projectId: IDS.projectId,
    subscription: {
      ...IDS,
      tierId,
      status: "active",
      revision: 7,
      currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
      currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      scheduledTierId: null,
      scheduledEffectiveAt: null
    },
    expectedSubscriptionRevision: 7,
    now: "2026-08-04T18:00:00.000Z"
  });
}

function facts(overrides = {}) {
  return {
    theme: "clear",
    businessName: "Cedar & Stone",
    summary: "Local stonework with careful cleanup.",
    about: "Repairs and installations for nearby homes.",
    offerings: ["Repairs", "Installation"],
    location: "Richmond, Virginia",
    hours: "Monday through Friday",
    phone: "",
    email: "hello@example.com",
    website: "",
    primaryAction: "email",
    ...overrides
  };
}

async function browserCompiler() {
  const source = await readFile(compilerUrl, "utf8");
  const context = vm.createContext({});
  new vm.Script(source, { filename: "abracadabra-compiler.js" }).runInContext(
    context
  );
  return context.AbracadabraCompiler;
}

test("Node compiler port emits the canonical browser compiler's exact bytes", async () => {
  const [port, browser] = await Promise.all([
    createSparkCompilerPort(),
    browserCompiler()
  ]);
  const server = port.compile(facts());
  const client = browser.compileSite(facts());
  assert.equal(port.schema, SPARK_COMPILER_SCHEMA);
  assert.equal(server.html, client.html);
  assert.equal(server.artifactDigest, client.artifactDigest);
  assert.equal(server.contentDigest, client.contentDigest);
  assert.equal(server.normalizedDigest, client.normalizedDigest);
  assert.equal(
    server.artifactDigest,
    createHash("sha256").update(server.htmlBytes).digest("hex")
  );
  assert.match(port.revision, /^sha256:[a-f0-9]{64}$/u);
});

test("compiler port rejects unapproved source revisions and invalid facts", async () => {
  await assert.rejects(
    createSparkCompilerPort({ expectedSourceDigest: "0".repeat(64) }),
    (error) => error?.code === "COMPILER_REVISION_MISMATCH"
  );
  const port = await createSparkCompilerPort();
  assert.throws(
    () => port.compile({ businessName: "Incomplete" }),
    (error) =>
      error?.code === "SPARK_FACTS_INVALID" &&
      Array.isArray(error.details?.fields)
  );
});

test("customer-supplied artifact fields cannot influence server output", async () => {
  const port = await createSparkCompilerPort();
  const ordinary = port.compile(facts());
  const attemptedOverride = port.compile(
    facts({
      artifact: {
        html: "<script>customer authority</script>",
        digest: "0".repeat(64)
      },
      html: "<script>customer authority</script>",
      artifactDigest: "0".repeat(64)
    })
  );
  assert.equal(attemptedOverride.html, ordinary.html);
  assert.equal(attemptedOverride.artifactDigest, ordinary.artifactDigest);
  assert.doesNotMatch(attemptedOverride.html, /customer authority/u);
});

test("Alakazam compilation masks injected fields and matches the canonical browser compiler", async () => {
  const [port, browser] = await Promise.all([
    createSparkCompilerPort(),
    browserCompiler()
  ]);
  const configured = facts({
    accent: "plum",
    fontPair: "alt",
    borderStyle: "ornate",
    cashapp: "Cedar.Pay",
    venmo: "Cedar-Pay",
    menu: ["browser-claimed-menu"],
    photoHeader: { artifactId: "browser-claimed-photo" },
    sectionToggles: { about: false },
    providerPriceId: "price_browser_claim",
    provenance: { policyDigest: "f".repeat(64) }
  });
  const before = structuredClone(configured);
  const base = port.compileAlakazam({
    configuredFacts: configured,
    authority: authority("alakazam_25")
  });
  const expanded = port.compileAlakazam({
    configuredFacts: configured,
    authority: authority("alakazam_35")
  });
  const browserBase = browser.compileSiteWithProvenance(
    base.effectiveFacts,
    base.provenance
  );

  assert.deepEqual(configured, before);
  assert.equal(base.provenance.schema, SPARK_COMPILER_PROVENANCE_SCHEMA);
  assert.equal(base.html, browserBase.html);
  assert.equal(base.artifactDigest, browserBase.artifactDigest);
  assert.equal(base.provenanceDigest, browserBase.provenanceDigest);
  assert.equal(base.contentDigest, expanded.contentDigest);
  assert.equal(base.normalizedDigest, expanded.normalizedDigest);
  assert.notEqual(base.provenanceDigest, expanded.provenanceDigest);
  assert.notEqual(base.artifactDigest, expanded.artifactDigest);
  assert.notEqual(base.versionId, expanded.versionId);
  assert.equal(base.normalizedFacts.fontPair, "standard");
  assert.equal(base.normalizedFacts.borderStyle, "soft");
  assert.equal(Object.hasOwn(base.effectiveFacts, "cashapp"), false);
  assert.equal(Object.hasOwn(base.effectiveFacts, "venmo"), false);
  assert.doesNotMatch(base.html, /Cash App|Venmo/u);
  assert.doesNotMatch(base.html, /outline:3px double/u);
  assert.doesNotMatch(
    base.html,
    /body\{font-family:Georgia,"Times New Roman",serif\}\.eyebrow/u
  );
  assert.doesNotMatch(base.html, /browser-claimed/u);
});

test("only canonical $50 authority enables implemented Cash App and Venmo output", async () => {
  const port = await createSparkCompilerPort();
  const configured = facts({
    fontPair: "alt",
    borderStyle: "ornate",
    cashapp: "Cedar.Pay",
    venmo: "Cedar-Pay"
  });
  const expanded = port.compileAlakazam({
    configuredFacts: configured,
    authority: authority("alakazam_35")
  });
  const rich = port.compileAlakazam({
    configuredFacts: configured,
    authority: authority("alakazam_50")
  });

  assert.doesNotMatch(expanded.html, /Cash App|Venmo/u);
  assert.match(rich.html, /Cash App \$Cedar\.Pay/u);
  assert.match(rich.html, /Venmo @Cedar-Pay/u);
  assert.equal(rich.normalizedFacts.fontPair, "standard");
  assert.equal(rich.normalizedFacts.borderStyle, "soft");
  assert.doesNotMatch(rich.html, /outline:3px double/u);
  assert.doesNotMatch(
    rich.html,
    /body\{font-family:Georgia,"Times New Roman",serif\}\.eyebrow/u
  );
});

test("policy-aware compilation creates distinct artifacts for Crystal, Hearth, and Midnight", async () => {
  const port = await createSparkCompilerPort();
  const selectedAuthority = authority("alakazam_25");
  const results = ["clear", "warm", "arcane"].map((theme) =>
    port.compileAlakazam({
      configuredFacts: facts({ theme }),
      authority: selectedAuthority
    })
  );
  assert.equal(
    new Set(results.map((result) => result.artifactDigest)).size,
    3
  );
  assert.equal(
    new Set(results.map((result) => result.provenanceDigest)).size,
    1
  );
  assert.deepEqual(
    results.map((result) => result.normalizedFacts.theme),
    ["clear", "warm", "arcane"]
  );
});
