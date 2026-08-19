import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production root composes durable, verified, effect-held Care surfaces and commerce", async () => {
  const source = await readFile(
    new URL("../bin/server.mjs", import.meta.url),
    "utf8"
  );
  for (const constructor of [
    "createPostgresCareCoreRepository",
    "createPostgresCareSurfaceRepository",
    "createCareMailReservationInterface",
    "createCareSurfacesService",
    "createPostgresCareCommerceEligibility",
    "createPostgresCareCommerceRepository",
    "createCareCommerceMailReservationInterface",
    "createHeldCareCommerceService"
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
    /mailReservations: createCareMailReservationInterface\(\{\s*notifications: mailPurposeNotifications,\s*clock: commerceV2[.]clock\s*\}\)/u
  );
  assert.match(source, /const careReadiness = await careSurfaces[.]readiness\(\)/u);
  assert.match(
    source,
    /careReadiness[.]providerEffects !== false/u
  );
  assert.match(
    source,
    /const careCommerce = createHeldCareCommerceService\(\{\s*eligibility: createPostgresCareCommerceEligibility\(\{ authority \}\),\s*repository: createPostgresCareCommerceRepository\(\{ authority \}\),\s*ids: commerceV2[.]ids,\s*clock: commerceV2[.]clock,\s*mailReservations: createCareCommerceMailReservationInterface\(\{\s*notifications: mailPurposeNotifications,\s*clock: commerceV2[.]clock\s*\}\)\s*\}\)/u
  );
  assert.match(
    source,
    /const careCommerceReadiness = await careCommerce[.]readiness\(\)/u
  );
  for (const field of [
    "commercialReady", "taxPurposeReleased", "commercialEffects",
    "customerEffects", "mailDeliveryEffects", "paymentEffects",
    "providerEffects"
  ]) {
    assert.match(
      source,
      new RegExp(`careCommerceReadiness[.]${field} !== false`, "u")
    );
  }
  assert.match(
    source,
    /createHostedApi\(service, \{[\s\S]*?careSurfaces,\s*careCommerce,[\s\S]*?operatorWorkQueue:/u
  );
});
