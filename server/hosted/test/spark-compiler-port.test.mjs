import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import {
  SPARK_COMPILER_SCHEMA,
  createSparkCompilerPort
} from "../spark-compiler-port.mjs";

const compilerUrl = new URL(
  "../../../abracadabra/app/abracadabra-compiler.js",
  import.meta.url
);

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
