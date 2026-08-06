import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSourceUrl = new URL(
  "../bin/server.mjs",
  import.meta.url
);

test("production holds H1M change and completion until H1N settlement exists", async () => {
  const source = await readFile(serverSourceUrl, "utf8");

  assert.match(
    source,
    /import\s*\{\s*createHeldCustomServicesCustomBuildChangeCompletion\s*\}\s*from\s*"\.\.\/custom-services-custom-build-change-completion-postgres\.mjs";/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildChangeCompletion\s*=\s*createHeldCustomServicesCustomBuildChangeCompletion\(\);/u
  );
  assert.doesNotMatch(
    source,
    /createPostgresCustomServicesCustomBuildChangeCompletion/u
  );
  assert.doesNotMatch(
    source,
    /customServicesCustomBuildChangeCompletion\.readiness\(\)/u
  );
  assert.match(
    source,
    /createHostedCustomServicesAccount\(\{[\s\S]*customBuildChangeCompletion:\s*customServicesCustomBuildChangeCompletion,/u
  );
  assert.match(
    source,
    /createHostedApi\(service,\s*\{[\s\S]*customServicesCustomBuildChangeCompletion,/u
  );
});
