import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production root composes durable, verified, effect-held Care surfaces", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  for (const constructor of [
    "createPostgresCareCoreRepository",
    "createPostgresCareSurfaceRepository",
    "createCareMailReservationInterface",
    "createCareSurfacesService"
  ]) {
    assert.match(source, new RegExp(`\\b${constructor}\\b`, "u"));
  }
  assert.match(
    source,
    /const careCoreRepository = createPostgresCareCoreRepository\(\{ authority \}\)/u
  );
  assert.match(
    source,
    /coreRepository: careCoreRepository/u
  );
  assert.match(
    source,
    /mailReservations: createCareMailReservationInterface\(\{\s*lifecycle: mailLifecycle,\s*clock: commerceV2[.]clock\s*\}\)/u
  );
  assert.match(source, /const careReadiness = await careSurfaces[.]readiness\(\)/u);
  assert.match(
    source,
    /careReadiness[.]providerEffects !== false/u
  );
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?careSurfaces,[\s\S]*?operatorWorkQueue:/u
  );
});
