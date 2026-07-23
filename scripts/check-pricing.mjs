import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const errors = [];
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const {
  addonCatalogId: ADDON_CATALOG_ID,
  architectureBands: ARCHITECTURE_BANDS,
  buildAddons: BUILD_ADDONS,
  buildTiers: BUILD_TIERS,
  careCatalogId: CARE_CATALOG_ID,
  carePlans: CARE_PLANS,
  migration: MIGRATION_RULE,
  offerState: OFFER_STATE,
  tierCatalogId: TIER_CATALOG_ID,
} = publicCatalog;

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

for (const tier of BUILD_TIERS) {
  const price = displayMoney(tier.priceCents);
  const limits = tier.limits;
  requireText("pricing.html", `<h3>${tier.label}</h3>`);
  requireText("pricing.html", `<span class="num">${price}</span>`);
  requireText("pricing.html", `data-tier-id="${tier.id}" data-price-cents="${tier.priceCents}" data-page-cap="${limits.craftedPages}" data-section-cap="${limits.sections}" data-word-cap="${limits.contentWords}" data-media-cap="${limits.suppliedMedia}" data-form-cap="${limits.includedForms}" data-revision-cap="${limits.revisions}"`);
  requireText("start/index.html", `value="${tier.label} — ${price}"`);
  requireText("start/index.html", `data-tier-id="${tier.id}" data-price-cents="${tier.priceCents}" data-page-cap="${limits.craftedPages}" data-section-cap="${limits.sections}" data-included-forms="${limits.includedForms}"`);
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
requireText("pricing.html", "Partner approved extra hour");
requireText("pricing.html", `data-care-overflow-id="partner" data-price-cents="${CARE_PLANS.find((plan) => plan.id === "partner").approvedOverflowCentsPerHour}"`);
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
  "SS-TIERS-2026.1",
  "SS-TIERS-2026.2",
  "SS-ADDONS-2026.1",
  "SS-ADDONS-2026.2",
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
  console.log(`Pricing contract checks passed against ${TIER_CATALOG_ID}, ${ADDON_CATALOG_ID}, ${CARE_CATALOG_ID}, and public offer state=${OFFER_STATE}.`);
}
