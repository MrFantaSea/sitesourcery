import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CUSTOM_SERVICES_CONTRACT_DIGEST,
  CUSTOM_SERVICES_CONTRACT_ID
} from "../../commercial/custom-services-contract.mjs";

const catalog = JSON.parse(
  await readFile(
    new URL("../../data/public-catalog.json", import.meta.url),
    "utf8"
  )
);
test("the successor assessment is exactly $350 with one full non-cash accepted-build credit", () => {
  const assessment = catalog.professionalServices.find(
    (service) => service.id === "website-assessment"
  );
  assert.ok(assessment);
  assert.equal(assessment.priceCents, 35_000);
  assert.equal(CUSTOM_SERVICES_CONTRACT_ID, "SS-CUSTOM-SERVICES-2026-08-19.2");
  assert.equal(
    CUSTOM_SERVICES_CONTRACT_DIGEST,
    "0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d"
  );
  assert.equal(assessment.scopeState, "must_be_stated_before_sale");
  assert.equal(assessment.turnaroundState, "must_be_stated_before_sale");
  assert.deepEqual(assessment.buildCredit, {
    basisPoints: 10_000,
    maximumCents: 35_000,
    eligibleSuccessor: "any_accepted_site_sourcery_build"
  });
  assert.ok(
    assessment.buildCredit.maximumCents <=
      assessment.priceCents
  );
});
