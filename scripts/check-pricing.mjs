import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const errors = [];
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const EXPECTED_CATALOG_IDENTITY = Object.freeze({
  version: "SS-COMMERCIAL-2026.4",
  tierCatalogId: "SS-TIERS-2026.4",
  addonCatalogId: "SS-ADDONS-2026.4",
  careCatalogId: "SS-CARE-2026.4",
  sourceCatalogDigest: "5664632f3682c625ea9fff9836a8c113aff85769789872bec070b739d15bc335",
  projectionDigest: "655f1dba4e4825568d517b290affce1e8ceeb926d6849653a63af5e2c27201f5",
});
const {
  addonCatalogId: ADDON_CATALOG_ID,
  architectureBands: ARCHITECTURE_BANDS,
  buildAddons: BUILD_ADDONS,
  buildTiers: BUILD_TIERS,
  careCatalogId: CARE_CATALOG_ID,
  carePlans: CARE_PLANS,
  creativityLevels: CREATIVITY_LEVELS,
  migration: MIGRATION_RULE,
  offerState: OFFER_STATE,
  projectionDigest: PROJECTION_DIGEST,
  scaleRule: SCALE_RULE,
  sourceCatalogDigest: SOURCE_CATALOG_DIGEST,
  tierCatalogId: TIER_CATALOG_ID,
  version: CATALOG_VERSION,
} = publicCatalog;

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
for (const [label, value] of [
  ["sourceCatalogDigest", SOURCE_CATALOG_DIGEST],
  ["projectionDigest", PROJECTION_DIGEST],
]) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ""))) {
    errors.push(`data/public-catalog.json: ${label} must be a lowercase SHA-256 digest`);
  }
}
const { projectionDigest: ignoredProjectionDigest, ...projectionPayload } = publicCatalog;
const recomputedProjectionDigest = sha256(stableStringify(projectionPayload));
if (PROJECTION_DIGEST !== recomputedProjectionDigest) {
  errors.push(`data/public-catalog.json: projectionDigest does not match the independently recomputed semantic projection digest ${recomputedProjectionDigest}`);
}

async function verifyRootCatalogLineage({ required = false } = {}) {
  const catalogPath = path.resolve(root, "../commercial/catalog.mjs");
  const projectionPath = path.resolve(root, "../commercial/public-catalog.mjs");
  try {
    await Promise.all([access(catalogPath), access(projectionPath)]);
  } catch {
    if (required) {
      errors.push("root catalog lineage is required, but ../commercial/catalog.mjs and ../commercial/public-catalog.mjs are not present in this checkout");
    }
    return;
  }

  try {
    const nonce = `${Date.now()}-${Math.random()}`;
    const catalogModule = await import(`${pathToFileURL(catalogPath).href}?site_lineage=${nonce}`);
    const projectionModule = await import(`${pathToFileURL(projectionPath).href}?site_lineage=${nonce}`);
    const sourceDigest = sha256(stableStringify(catalogModule.CATALOG));
    if (catalogModule.CATALOG_DIGEST !== sourceDigest) {
      errors.push("root commercial catalog digest does not match its independently recomputed semantic source digest");
    }
    for (const [field, expected] of Object.entries(EXPECTED_CATALOG_IDENTITY)) {
      if (field === "projectionDigest") continue;
      const actual = field === "sourceCatalogDigest"
        ? catalogModule.CATALOG_DIGEST
        : field === "version"
          ? catalogModule.CATALOG_VERSION
          : field === "tierCatalogId"
            ? catalogModule.TIER_CATALOG_ID
            : field === "addonCatalogId"
              ? catalogModule.ADDON_CATALOG_ID
              : catalogModule.CARE_CATALOG_ID;
      if (actual !== expected) errors.push(`root commercial source ${field} must be ${expected}; received ${actual ?? "missing"}`);
    }
    if (typeof projectionModule.publicCatalogProjection !== "function") {
      errors.push("root public-catalog module does not export publicCatalogProjection()");
      return;
    }
    const generatedProjection = projectionModule.publicCatalogProjection();
    if (stableStringify(generatedProjection) !== stableStringify(publicCatalog)) {
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
    if (forbiddenPublicCatalogKeys.has(key)) errors.push(`${trail}: private commercial field ${JSON.stringify(key)} must not appear in the public projection`);
    inspectPublicProjection(child, `${trail}.${key}`);
  }
}
inspectPublicProjection(publicCatalog);

const rootHtml = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
  .map((entry) => entry.name);
const publicFiles = [...rootHtml, "start/index.html"].sort();
const files = Object.fromEntries(await Promise.all(publicFiles.map(async (file) => [
  file,
  await readFile(path.join(root, file), "utf8"),
])));

const requireText = (file, value) => {
  if (!files[file].includes(value)) errors.push(`${file}: missing ${JSON.stringify(value)}`);
};

const forbidText = (file, value, label = "retired or unsafe text") => {
  if (files[file].includes(value)) errors.push(`${file}: contains ${label} ${JSON.stringify(value)}`);
};

const displayMoney = (cents) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(cents / 100);

for (const marker of [TIER_CATALOG_ID, ADDON_CATALOG_ID]) {
  for (const file of ["pricing.html", "start/index.html", "terms.html", "privacy.html"]) {
    requireText(file, marker);
  }
}
requireText("pricing.html", CARE_CATALOG_ID);

const formCatalogBindings = [
  ["Website commercial catalog ID", CATALOG_VERSION],
  ["Website tier catalog ID", TIER_CATALOG_ID],
  ["Website add-on catalog ID", ADDON_CATALOG_ID],
  ["Website Care catalog ID", CARE_CATALOG_ID],
  ["Website source catalog digest", SOURCE_CATALOG_DIGEST],
  ["Website projection digest", PROJECTION_DIGEST],
];
for (const [name, value] of formCatalogBindings) {
  requireText("start/index.html", `<input type="hidden" name="${name}" value="${value}">`);
}
for (const [attribute, value] of [
  ["data-commercial-catalog-id", CATALOG_VERSION],
  ["data-tier-catalog-id", TIER_CATALOG_ID],
  ["data-addon-catalog-id", ADDON_CATALOG_ID],
  ["data-care-catalog-id", CARE_CATALOG_ID],
  ["data-source-catalog-digest", SOURCE_CATALOG_DIGEST],
  ["data-projection-digest", PROJECTION_DIGEST],
]) {
  requireText("start/index.html", `${attribute}="${value}"`);
}

for (const tier of BUILD_TIERS) {
  const price = displayMoney(tier.priceCents);
  const limits = tier.limits;
  requireText("pricing.html", `<h3>${tier.label}</h3>`);
  requireText("pricing.html", `<span class="num">${price}</span>`);
  requireText("pricing.html", `data-tier-id="${tier.id}" data-price-cents="${tier.priceCents}" data-page-cap="${limits.craftedPages}" data-section-cap="${limits.sections}" data-word-cap="${limits.contentWords}" data-media-cap="${limits.suppliedMedia}" data-form-cap="${limits.includedForms}" data-revision-cap="${limits.revisions}"`);
  requireText("start/index.html", `value="${tier.label} — ${price}"`);
  requireText("start/index.html", `data-tier-id="${tier.id}" data-price-cents="${tier.priceCents}" data-page-cap="${limits.craftedPages}" data-section-cap="${limits.sections}" data-included-forms="${limits.includedForms}"`);
}

requireText(
  "pricing.html",
  `data-scale-id="${SCALE_RULE.id}" data-base-tier-id="${SCALE_RULE.baseTierId}" data-unit-price-cents="${SCALE_RULE.unitPriceCents}" data-max-units="${SCALE_RULE.maximumCapacityUnits}" data-page-cap="${SCALE_RULE.maximumCraftedPages}"`,
);
requireText(
  "start/index.html",
  `data-tier-id="${SCALE_RULE.id}" data-page-cap="${SCALE_RULE.maximumCraftedPages}"`,
);
for (const level of CREATIVITY_LEVELS) {
  const marker = `data-creativity-level="${level.id}" data-premium-basis-points="${level.premiumBasisPoints}" data-minimum-premium-cents="${level.minimumPremiumCents}" data-max-motion-components="${level.maximumMotionComponents}"`;
  requireText("pricing.html", marker);
  requireText("start/index.html", marker);
}
for (const retiredCreativeAddon of ["bespoke_visual", "motion_system"]) {
  forbidText("pricing.html", `data-addon-id="${retiredCreativeAddon}"`, "retired creative add-on");
  forbidText("start/index.html", `data-addon-id="${retiredCreativeAddon}"`, "retired creative add-on");
}

for (const addon of BUILD_ADDONS) {
  requireText("pricing.html", `data-addon-id="${addon.id}"`);
  requireText("start/index.html", `data-addon-id="${addon.id}"`);
  const pricingDataPrefix = `data-addon-id="${addon.id}"${Number.isInteger(addon.priceCents) ? ` data-price-cents="${addon.priceCents}"` : ""} data-max-quantity="${addon.maxQuantity}"`;
  requireText("pricing.html", pricingDataPrefix);
  requireText("start/index.html", `data-addon-id="${addon.id}" data-max-quantity="${addon.maxQuantity}"`);
  if (Number.isInteger(addon.priceCents)) {
    requireText("pricing.html", `data-addon-id="${addon.id}" data-price-cents="${addon.priceCents}"`);
  }
  if (addon.tierPricesCents) {
    const tierPrices = Object.entries(addon.tierPricesCents).map(([id, cents]) => `${id}:${cents}`).join(",");
    requireText("pricing.html", `data-tier-prices="${tierPrices}"`);
    requireText("start/index.html", `data-tier-prices="${tierPrices}"`);
  }
  if (addon.eligibleTiers) {
    const eligible = addon.eligibleTiers.join(",");
    requireText("pricing.html", `data-eligible-tiers="${eligible}"`);
    requireText("start/index.html", `data-eligible-tiers="${eligible}"`);
  }
}

const architectureData = ARCHITECTURE_BANDS
  .map((band) => `${band.min}-${band.max}:${band.priceCents}`)
  .join(",");
requireText("pricing.html", `data-addon-id="architecture_redirect" data-band-prices="${architectureData}"`);
requireText("start/index.html", `data-addon-id="architecture_redirect"`);

const migrationData = `first_100:${MIGRATION_RULE.firstPriceCents},next_100:${MIGRATION_RULE.nextPriceCents},max_entries:${MIGRATION_RULE.maxRecords}`;
requireText("pricing.html", `data-addon-id="structured_data_migration" data-migration-prices="${migrationData}"`);
requireText("start/index.html", `data-addon-id="structured_data_migration"`);

for (const plan of CARE_PLANS) {
  const price = `${displayMoney(plan.monthlyCents)}/mo`;
  requireText("start/index.html", `value="${plan.label} — ${price}"`);
  requireText("start/index.html", `data-care-plan-id="${plan.id}" data-monthly-cents="${plan.monthlyCents}" data-edit-cap="${plan.editCap}" data-included-minutes="${plan.includedMinutes}"`);
  requireText("pricing.html", `<h3>${plan.label}</h3>`);
  requireText("pricing.html", `<span class="num">${displayMoney(plan.monthlyCents)}</span><span class="per">/mo</span>`);
  requireText("pricing.html", `data-care-plan-id="${plan.id}" data-monthly-cents="${plan.monthlyCents}" data-edit-cap="${plan.editCap}" data-included-minutes="${plan.includedMinutes}"`);
}

requireText("pricing.html", "Communication, research, editing, QA, reporting, calls, and deployment all count inside the stated time cap.");
const partnerOverflow = CARE_PLANS.find((plan) => plan.id === "partner")?.overflow;
if (stableStringify(partnerOverflow) !== stableStringify({
  billingMode: "metered_started_minute",
  rateCentsPerStartedMinute: 250,
  maximumCents: 15000,
  maximumMinutes: 60,
})) {
  errors.push("data/public-catalog.json: Partner overflow must be the exact metered-started-minute policy");
}
requireText("pricing.html", "Partner metered extra time");
requireText("pricing.html", `data-care-overflow-id="partner" data-billing-mode="${partnerOverflow?.billingMode}" data-rate-cents-per-started-minute="${partnerOverflow?.rateCentsPerStartedMinute}" data-maximum-cents="${partnerOverflow?.maximumCents}" data-maximum-minutes="${partnerOverflow?.maximumMinutes}"`);
requireText("pricing.html", "$2.50 per started minute");
requireText("pricing.html", "capped at $150 and 60 additional minutes per website per paid month");
requireText("faq.html", "$2.50 per started minute, capped at $150 and 60 additional minutes per website per paid month");
requireText("terms.html", "$2.50 per started minute, capped at $150 and 60 additional minutes per website per paid month");
forbidText("pricing.html", "$150</span> once that month", "flat-pack Care overflow wording");
for (const retiredOverflow of ["care_lite", "care", "care_plus"]) {
  forbidText("pricing.html", `data-care-overflow-id="${retiredOverflow}"`, "retired lower-tier Care overflow");
}

for (const phrase of [
  "Each current URL must have a written keep, merge, redirect, or retire disposition.",
  "A concept or teaser page is not the quoted footprint.",
]) requireText("terms.html", phrase);

requireText("start/index.html", "Current public pages or URLs");
requireText("start/index.html", "Expected sections on a one-page site");
requireText("faq.html", "Every current URL gets a written keep, merge, redirect, or retire decision.");
requireText("pricing.html", "client-supplied words/facts");
requireText("pricing.html", "Card or Card Plus only");
requireText("start/index.html", "data-eligible-tiers=\"card,card-plus\"");

const forbiddenCatalogText = [
  "SS-COMMERCIAL-2026.1",
  "SS-COMMERCIAL-2026.2",
  "SS-COMMERCIAL-2026.3",
  "SS-TIERS-2026.1",
  "SS-TIERS-2026.2",
  "SS-TIERS-2026.3",
  "SS-ADDONS-2026.1",
  "SS-ADDONS-2026.2",
  "SS-ADDONS-2026.3",
  "SS-CARE-2026.1",
  "SS-CARE-2026.2",
  "SS-CARE-2026.3",
  "Card — $200",
  "Card Plus — $350",
  "Site — $600",
  "Site Plus — $900",
  "Pro — $1,300",
  "Pro Plus — $1,800",
  "Flagship — $3,000",
  "Care Lite — $49/mo",
  "Care — $89/mo",
  "Care Plus — $149/mo",
  "Partner — $249/mo",
  "Care Lite · $49/mo",
  "Care · $89/mo",
  "Care Plus · $149/mo",
  "Partner · $249/mo",
  "from&nbsp;$200",
  "From $200 · buy once",
  "data-scope-expansion",
];

for (const file of publicFiles) {
  for (const value of forbiddenCatalogText) forbidText(file, value);
  for (const value of [
    "Start your site",
    "Website commissions are open",
    "Live website offer",
    "LIVE OFFER / WEBSITE BUILDS",
    "You own everything",
    "own every file",
    "Every file, the domain",
    "api.web3forms.com",
    "name=\"access_key\"",
  ]) forbidText(file, value);
}

if (OFFER_STATE === "inquiry-only") {
  requireText("start/index.html", "data-commercial-state=\"hold\"");
  requireText("contact.html", "data-commercial-state=\"hold\"");
  requireText("start/index.html", "Brief submission held");
  requireText("contact.html", "Note submission held");
  requireText("pricing.html", "Website pricing preview &middot; inquiry only");
  forbidText("pricing.html", "\"@type\":\"Offer\"", "active Offer structured data while commercial authority is held");
}

if (errors.length) {
  console.error(`Pricing contract checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Pricing contract checks passed against ${CATALOG_VERSION}, ${TIER_CATALOG_ID}, ${ADDON_CATALOG_ID}, ${CARE_CATALOG_ID}, source=${SOURCE_CATALOG_DIGEST}, projection=${PROJECTION_DIGEST}, and public offer state=${OFFER_STATE}.`);
}
