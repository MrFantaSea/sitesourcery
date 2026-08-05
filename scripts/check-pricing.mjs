import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publicFileAllowlist } from "./build-pages.mjs";

const root = process.cwd();
const errors = [];
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const EXPECTED_CATALOG_IDENTITY = Object.freeze({
  version: "SS-COMMERCIAL-2026.5",
  tierCatalogId: "SS-TIERS-2026.5",
  addonCatalogId: "SS-ADDONS-2026.5",
  careCatalogId: "SS-CARE-2026.5",
  professionalServiceCatalogId: "SS-PROFESSIONAL-2026.1",
  sourceCatalogDigest: "0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc",
  projectionDigest: "5276e2f38096625428814677518ffaaf6063f07f78169be20b8bf4ac5d511225",
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

for (const [field, expected] of Object.entries(EXPECTED_CATALOG_IDENTITY)) {
  if (publicCatalog[field] !== expected) {
    errors.push(`data/public-catalog.json: ${field} must be ${expected}; received ${publicCatalog[field] ?? "missing"}`);
  }
}
for (const field of ["sourceCatalogDigest", "projectionDigest"]) {
  if (!/^[a-f0-9]{64}$/.test(String(publicCatalog[field] || ""))) {
    errors.push(`data/public-catalog.json: ${field} must be a lowercase SHA-256 digest`);
  }
}
const { projectionDigest: ignoredProjectionDigest, ...projectionPayload } = publicCatalog;
const recomputedProjectionDigest = sha256(stableStringify(projectionPayload));
if (publicCatalog.projectionDigest !== recomputedProjectionDigest) {
  errors.push(`data/public-catalog.json: projectionDigest does not match independently recomputed ${recomputedProjectionDigest}`);
}

async function verifyRootCatalogLineage({ required = false } = {}) {
  const catalogPath = path.resolve(root, "../commercial/catalog.mjs");
  const projectionPath = path.resolve(root, "../commercial/public-catalog.mjs");
  try {
    await Promise.all([access(catalogPath), access(projectionPath)]);
  } catch {
    if (required) errors.push("root catalog lineage is required but the canonical modules are absent");
    return;
  }

  try {
    const nonce = `${Date.now()}-${Math.random()}`;
    const catalogModule = await import(`${pathToFileURL(catalogPath).href}?site_lineage=${nonce}`);
    const projectionModule = await import(`${pathToFileURL(projectionPath).href}?site_lineage=${nonce}`);
    const sourceDigest = sha256(stableStringify(catalogModule.CATALOG));
    if (catalogModule.CATALOG_DIGEST !== sourceDigest) {
      errors.push("root commercial catalog digest does not match its recomputed semantic digest");
    }
    const sourceIdentity = {
      version: catalogModule.CATALOG_VERSION,
      tierCatalogId: catalogModule.TIER_CATALOG_ID,
      addonCatalogId: catalogModule.ADDON_CATALOG_ID,
      careCatalogId: catalogModule.CARE_CATALOG_ID,
      professionalServiceCatalogId: catalogModule.PROFESSIONAL_SERVICE_CATALOG_ID,
      sourceCatalogDigest: catalogModule.CATALOG_DIGEST,
    };
    for (const [field, expected] of Object.entries(EXPECTED_CATALOG_IDENTITY)) {
      if (field === "projectionDigest") continue;
      if (sourceIdentity[field] !== expected) {
        errors.push(`root commercial source ${field} must be ${expected}; received ${sourceIdentity[field] ?? "missing"}`);
      }
    }
    if (typeof projectionModule.publicCatalogProjection !== "function") {
      errors.push("root public-catalog module does not export publicCatalogProjection()");
    } else if (stableStringify(projectionModule.publicCatalogProjection()) !== stableStringify(publicCatalog)) {
      errors.push("data/public-catalog.json does not exactly match the root source-derived projection");
    }
  } catch (error) {
    errors.push(`root catalog lineage could not be verified: ${error.message}`);
  }
}

await verifyRootCatalogLineage({ required: process.argv.includes("--require-root-lineage") });

const forbiddenPublicCatalogKeys = new Set([
  "baseEffortMinutes",
  "effortMinutes",
  "fixedScopeLimits",
  "minimumRealizedRateCentsPerHour",
  "risk",
]);
function inspectPublicProjection(value, trail = "data/public-catalog.json") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPublicCatalogKeys.has(key)) {
      errors.push(`${trail}: private commercial field ${JSON.stringify(key)} must not appear`);
    }
    inspectPublicProjection(child, `${trail}.${key}`);
  }
}
inspectPublicProjection(publicCatalog);

const publicHtmlFiles = publicFileAllowlist.filter((file) => file.endsWith(".html"));
const files = Object.fromEntries(await Promise.all(publicHtmlFiles.map(async (file) => [
  file,
  await readFile(path.join(root, file), "utf8"),
])));

const requireText = (file, value) => {
  if (!Object.hasOwn(files, file)) {
    errors.push(`${file}: is not an allowlisted public HTML file`);
    return;
  }
  if (!files[file].includes(value)) errors.push(`${file}: missing ${JSON.stringify(value)}`);
};
const forbidText = (file, value, label = "retired or unsafe text") => {
  if (files[file].includes(value)) errors.push(`${file}: contains ${label} ${JSON.stringify(value)}`);
};
const forbidRegex = (file, expression, label) => {
  const match = files[file].match(expression);
  if (match) errors.push(`${file}: contains ${label} ${JSON.stringify(match[0])}`);
};

if (publicFileAllowlist.includes("data/public-catalog.json")) {
  errors.push("data/public-catalog.json: private price-bearing projection entered the public artifact allowlist");
}

const scopeFile = "custom/scope/index.html";
for (const tier of publicCatalog.buildTiers) {
  const limits = tier.limits;
  requireText(
    scopeFile,
    `data-custom-tier="${tier.id}" data-pages="${limits.craftedPages}" data-sections="${limits.sections}" data-layouts="${limits.uniqueLayouts}" data-words="${limits.contentWords}" data-media="${limits.suppliedMedia}" data-forms="${limits.includedForms}" data-revisions="${limits.revisions}"`,
  );
}
const scale = publicCatalog.scaleRule;
requireText(
  scopeFile,
  `data-custom-tier="${scale.id}" data-pages="${scale.maximumCraftedPages}" data-scale-base="${scale.baseTierId}" data-scale-min-units="${scale.minimumCapacityUnits}" data-scale-max-units="${scale.maximumCapacityUnits}" data-scale-unit-pages="${scale.allowancePerUnit.craftedPages}" data-scale-unit-sections="${scale.allowancePerUnit.sections}" data-scale-unit-layouts="${scale.allowancePerUnit.uniqueLayouts}" data-scale-unit-words="${scale.allowancePerUnit.contentWords}" data-scale-unit-media="${scale.allowancePerUnit.suppliedMedia}"`,
);
for (const level of publicCatalog.creativityLevels) {
  requireText(scopeFile, `data-creative-level="${level.id}" data-motion="${level.maximumMotionComponents}"`);
}
for (const addon of publicCatalog.buildAddons) {
  requireText(scopeFile, `data-custom-component="${addon.id}"`);
}

for (const file of publicHtmlFiles) {
  forbidRegex(file, /\bdata-(?:price|monthly|minimum-premium|premium-basis|tier-prices|band-prices|migration-prices|rate-cents|maximum-cents)[a-z-]*=/, "public price-bearing data attribute");
  forbidText(file, "\"@type\":\"Offer\"", "active Offer structured data");
  for (const value of [
    "api.web3forms.com",
    "name=\"access_key\"",
    "buy.stripe.com",
    "checkout.stripe.com",
    "js.stripe.com",
    "paypal.com/checkout",
  ]) forbidText(file, value);
}

for (const file of publicHtmlFiles) {
  forbidRegex(file, /\b(?:Host|Care Lite|Care Plus|Partner)\b[^<\n]{0,60}(?:\/mo|per month|\$\d)/i, "Care plan offer");
}

const assessment = publicCatalog.professionalServices?.find((service) =>
  service.id === "website-assessment");
if (
  !assessment ||
  assessment.priceCents !== 20000 ||
  assessment.contractId !==
    "SS-CUSTOM-SERVICES-2026-08-05.1" ||
  assessment.contractDigest !==
    "9bb93ae1f7ed2bb7015a7d995dabdb014bd94b9362b44727a67b3580f9af57c8" ||
  assessment.standardScope?.maximumWebsites !== 1 ||
  assessment.standardScope?.maximumRepresentativePagesOrTypes !== 5 ||
  JSON.stringify(assessment.standardScope?.requiredViewports) !==
    JSON.stringify(["desktop", "phone"]) ||
  assessment.standardScope?.maximumFindings !== 10 ||
  assessment.standardScope?.expandedAssessmentState !==
    "separately_quoted" ||
  assessment.buildCredit?.basisPoints !== 10000 ||
  assessment.buildCredit?.maximumCents !== 20000 ||
  assessment.buildCredit?.oneUse !== true ||
  assessment.buildCredit?.acceptanceWindowDays !== 90 ||
  assessment.buildCredit?.sameOrganizationRequired !== true ||
  assessment.buildCredit?.sameProjectRequired !== true ||
  assessment.buildCredit?.cashValue !== false ||
  assessment.buildCredit?.eligibleSuccessor !==
    "custom_base_build_card_through_scale"
) {
  errors.push(
    "data/public-catalog.json: website-assessment must be the bounded exact $200 offer with one-use same-project $200 Custom build credit"
  );
} else {
  const allowedDollarDisplays = new Set([5]);
  const collectCatalogAmounts = (value, key = null) => {
    if (Array.isArray(value)) {
      value.forEach((item) => collectCatalogAmounts(item, key));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, child]) =>
        collectCatalogAmounts(child, childKey)
      );
      return;
    }
    if (
      typeof value === "number" &&
      /cents$/iu.test(key ?? "")
    ) {
      allowedDollarDisplays.add(value / 100);
    }
  };
  collectCatalogAmounts(publicCatalog);
  const observedDisplays = [];
  for (const file of publicHtmlFiles) {
    for (const match of files[file].matchAll(/\$\s?\d[\d,.]*/gu)) {
      observedDisplays.push(`${file}:${match[0].replace(/\s/gu, "")}`);
    }
  }
  const invalidDisplays = observedDisplays.filter((entry) => {
    const amount = entry.slice(entry.lastIndexOf(":") + 1).replace(/[$,]/gu, "");
    return !allowedDollarDisplays.has(Number(amount));
  });
  if (invalidDisplays.length > 0) {
    errors.push(`public HTML dollar displays must match the current catalog; received ${JSON.stringify(invalidDisplays.sort())}`);
  }
  if (!files["abracadabra/index.html"].includes("$5")) {
    errors.push("abracadabra/index.html: missing the reviewed $5 project Download proposition");
  }
}

if (publicCatalog.offerState !== "inquiry-only") {
  errors.push(`data/public-catalog.json: offerState must remain inquiry-only; received ${publicCatalog.offerState}`);
}

if (errors.length) {
  console.error(`Pitch-safe pricing contract checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Pitch-safe catalog checks passed: ${publicCatalog.version}/${publicCatalog.tierCatalogId}/${publicCatalog.addonCatalogId}/${publicCatalog.careCatalogId} lineage verified; Custom scope records and public dollar copy match the private projection; checkout endpoints, Offer data, price-bearing attributes, and Care plan offers are absent.`);
}
