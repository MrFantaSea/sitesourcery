import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serverSourceUrl = new URL(
  "../bin/server.mjs",
  import.meta.url
);

test("production releases change and completion only through the PostgreSQL authority after H1N settlement exists", async () => {
  const source = await readFile(serverSourceUrl, "utf8");

  assert.match(
    source,
    /import\s*\{\s*createPostgresCustomServicesCustomBuildChangeCompletion\s*\}\s*from\s*"\.\.\/custom-services-custom-build-change-completion-postgres\.mjs";/u
  );
  assert.match(
    source,
    /const customServicesCustomBuildChangeCompletion\s*=\s*createPostgresCustomServicesCustomBuildChangeCompletion\(\{\s*authority,\s*clock:\s*commerceV2\.clock,\s*randomUUID:\s*\(\)\s*=>\s*commerceV2\.ids\.next\("custom_build_change_completion"\)\s*\}\);/u
  );
  assert.doesNotMatch(
    source,
    /createHeldCustomServicesCustomBuildChangeCompletion/u
  );
  assert.match(
    source,
    /await customServicesCustomBuildChangeCompletion\.readiness\(\);/u
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
