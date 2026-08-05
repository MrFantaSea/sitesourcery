import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(
  await readFile(
    new URL("../../data/public-catalog.json", import.meta.url),
    "utf8"
  )
);
const contractBytes = await readFile(
  new URL(
    "../../ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md",
    import.meta.url
  )
);

test("the standard assessment is one bounded $200 offer with at most one $200 Custom build credit", () => {
  const assessment = catalog.professionalServices.find(
    (service) => service.id === "website-assessment"
  );
  assert.ok(assessment);
  assert.equal(assessment.priceCents, 20_000);
  assert.equal(
    assessment.contractId,
    "SS-CUSTOM-SERVICES-2026-08-05.1"
  );
  assert.equal(
    assessment.contractDigest,
    createHash("sha256").update(contractBytes).digest("hex")
  );
  assert.deepEqual(assessment.standardScope, {
    maximumWebsites: 1,
    maximumRepresentativePagesOrTypes: 5,
    requiredViewports: ["desktop", "phone"],
    maximumFindings: 10,
    expandedAssessmentState: "separately_quoted"
  });
  assert.deepEqual(assessment.buildCredit, {
    basisPoints: 10_000,
    maximumCents: 20_000,
    oneUse: true,
    acceptanceWindowDays: 90,
    sameOrganizationRequired: true,
    sameProjectRequired: true,
    cashValue: false,
    eligibleSuccessor:
      "custom_base_build_card_through_scale"
  });
  assert.ok(
    assessment.buildCredit.maximumCents <=
      assessment.priceCents
  );
});
