import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production root composes durable, verified, kill-engaged Responder surfaces", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  for (const constructor of [
    "createPostgresResponderCoreRepository",
    "createFakeResponderProvider",
    "createResponderCore",
    "createPostgresResponderSurfaceRepository",
    "createResponderSurfacesService"
  ]) {
    assert.match(source, new RegExp(`\\b${constructor}\\b`, "u"));
  }
  assert.match(
    source,
    /const responderCore = createResponderCore\(\{\s*repository: createPostgresResponderCoreRepository\(\{ authority \}\),\s*provider: createFakeResponderProvider\(\),\s*clock: commerceV2[.]clock\s*\}\)/u
  );
  assert.match(
    source,
    /repository: createPostgresResponderSurfaceRepository\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /responderCoreReadiness[.]globalKillEngagedByDefault !== true/u
  );
  assert.match(source, /responderReadiness[.]providerEffects !== false/u);
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?careSurfaces,\s*responderSurfaces,\s*operatorWorkQueue:/u
  );
});
