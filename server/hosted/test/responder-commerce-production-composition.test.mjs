import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production root composes durable held Responder commerce with complete capability truth", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  for (const constructor of [
    "createPostgresResponderCoreRepository",
    "createPostgresResponderSurfaceRepository",
    "createResponderCore",
    "createResponderSurfacesService",
    "createPostgresResponderCommerceRepository",
    "createHeldResponderCommerceService"
  ]) {
    assert.match(source, new RegExp(`\\b${constructor}\\b`, "u"));
  }
  assert.match(
    source,
    /const responderCommerce = createHeldResponderCommerceService\(\{\s*repository: createPostgresResponderCommerceRepository\(\{ authority \}\),\s*ids: commerceV2[.]ids,\s*clock: commerceV2[.]clock\s*\}\)/u
  );
  assert.match(
    source,
    /responderCommerceReadiness\s*\] = await Promise[.]all\(\[\s*responderCore[.]readiness\(\),\s*responderSurfaces[.]readiness\(\),\s*responderCommerce[.]readiness\(\)/u
  );
  for (const field of [
    "ready",
    "verified",
    "durableCommercialState",
    "catalogAuthorityVerified"
  ]) {
    assert.match(
      source,
      new RegExp(`responderCommerceReadiness[.]${field} !== true`, "u")
    );
  }
  for (const field of [
    "taxPurposeReleased",
    "sellable",
    "commercialEffects",
    "customerEffects",
    "mailDeliveryEffects",
    "paymentEffects",
    "providerEffects"
  ]) {
    assert.match(
      source,
      new RegExp(`responderCommerceReadiness[.]${field} !== false`, "u")
    );
  }
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?responderSurfaces,\s*responderCommerce,[\s\S]*?operatorWorkQueue:/u
  );
});
