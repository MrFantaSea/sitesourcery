import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publicFileAllowlist } from "./build-pages.mjs";
import {
  heldAlakazamArtifactExcludedFiles,
  heldAlakazamExecutableSemantics,
} from "./hosted-truth/manifest.mjs";

const root = process.cwd();
const errors = [];
const SEALED_FIVE_DOLLAR_LEGAL_V5_FILES = new Set([
  "legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html",
  "legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-07-30-V2/index.html",
]);
const UNPUBLISHED_LEGAL_DRAFT_FILES = new Set([
  "legal/index.html",
  "legal/privacy/index.html",
  "legal/website-terms/index.html",
]);
const publicCatalog = JSON.parse(await readFile(path.join(root, "data/public-catalog.json"), "utf8"));
const {
  OFFER_AVAILABILITY,
  RAIL_NEEDS_SERVER,
  SELLABLE,
  sellableNow,
} = await import(path.join(root, "server/commerce/rails.mjs"));
const EXPECTED_CATALOG_IDENTITY = Object.freeze({
  version: "SS-COMMERCIAL-2026.6",
  tierCatalogId: "SS-TIERS-2026.6",
  addonCatalogId: "SS-ADDONS-2026.6",
  careCatalogId: "SS-CARE-2026.6",
  professionalServiceCatalogId: "SS-PROFESSIONAL-2026.2",
  sourceCatalogDigest: "3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0",
  approvedSourceCatalogDigest: "0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc",
  approvedSourceFileSha256: "9398d025b12f96ad1989620226cd153dabd39ee81d2ba11d1f03badf1cad2ee1",
  projectionDigest: "61904ce2fc6a6346babe43adbf902675f3a002c6e179b1aae883df498b8e91db",
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
for (const field of [
  "sourceCatalogDigest", "approvedSourceCatalogDigest",
  "approvedSourceFileSha256", "projectionDigest",
]) {
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
  const catalogPath = path.resolve(root, "commercial/catalog.mjs");
  const projectionPath = path.resolve(root, "commercial/public-catalog.mjs");
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
      approvedSourceCatalogDigest: catalogModule.APPROVED_SOURCE_CATALOG_DIGEST,
      approvedSourceFileSha256: catalogModule.APPROVED_SOURCE_FILE_SHA256,
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

const publicHtmlFiles = publicFileAllowlist.filter((file) =>
  file.endsWith(".html") && file !== "flyer.html"
);
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
if (publicFileAllowlist.includes("domains/domain-prices.json")) {
  errors.push("domains/domain-prices.json: held domain retail prices entered the public artifact allowlist");
}
for (const file of heldAlakazamArtifactExcludedFiles) {
  if (publicFileAllowlist.includes(file)) {
    errors.push(`${file}: held Alakazam source entered the public artifact allowlist`);
  }
}

const availabilityValues = new Set(Object.values(OFFER_AVAILABILITY));
const offerIds = new Set();
for (const offer of SELLABLE) {
  if (offerIds.has(offer.id)) {
    errors.push(`server/commerce/rails.mjs: duplicate offer id ${JSON.stringify(offer.id)}`);
  }
  offerIds.add(offer.id);
  if (!availabilityValues.has(offer.availability)) {
    errors.push(
      `server/commerce/rails.mjs: ${offer.id} must declare an exact per-offer availability`
    );
  }
}
const expectedOfferAvailability = {
  "abracadabra.preview": OFFER_AVAILABILITY.ACCOUNT_ONLY,
  "alacazam.hosting": OFFER_AVAILABILITY.HELD,
  "domain.purchase": OFFER_AVAILABILITY.INQUIRY_ONLY,
  "domain.purchase.plus": OFFER_AVAILABILITY.INQUIRY_ONLY,
  assessment: OFFER_AVAILABILITY.ACCOUNT_ONLY,
  responder: OFFER_AVAILABILITY.CONTACT_TO_START,
  "custom.build": OFFER_AVAILABILITY.INQUIRY_ONLY,
};
const actualOfferAvailability = Object.fromEntries(
  SELLABLE.map((offer) => [offer.id, offer.availability])
);
if (JSON.stringify(actualOfferAvailability) !== JSON.stringify(expectedOfferAvailability)) {
  errors.push(
    `server/commerce/rails.mjs: exact offer availability mapping changed; received ${JSON.stringify(actualOfferAvailability)}`
  );
}
for (const offer of SELLABLE) {
  if (
    offer.availability !== OFFER_AVAILABILITY.PUBLIC_CHECKOUT
    && offer.checkoutUrl !== null
  ) {
    errors.push(`server/commerce/rails.mjs: non-public ${offer.id} cannot retain a direct Checkout URL`);
  }
  if (
    offer.availability === OFFER_AVAILABILITY.ACCOUNT_ONLY
    && RAIL_NEEDS_SERVER[offer.rail] !== true
  ) {
    errors.push(`server/commerce/rails.mjs: account-only ${offer.id} must use a server Checkout rail`);
  }
  if (
    offer.availability === OFFER_AVAILABILITY.HELD
    && offer.amountCents !== null
  ) {
    errors.push(`server/commerce/rails.mjs: held ${offer.id} cannot expose active price authority`);
  }
}
const publicCheckoutOffers = sellableNow();
if (publicCatalog.offerState === "inquiry-only" && publicCheckoutOffers.length !== 0) {
  errors.push(
    `server/commerce/rails.mjs: inquiry-only public catalog cannot release ${publicCheckoutOffers.length} public checkout offers`
  );
}
for (const id of ["domain.purchase", "domain.purchase.plus"]) {
  const offer = SELLABLE.find((candidate) => candidate.id === id);
  if (
    !offer
    || offer.availability !== OFFER_AVAILABILITY.INQUIRY_ONLY
    || offer.checkoutUrl !== null
    || offer.productRef !== null
    || offer.priceRef !== null
  ) {
    errors.push(
      `server/commerce/rails.mjs: ${id} must remain inquiry-only with no direct provider checkout authority`
    );
  }
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

const publicTextFiles = publicFileAllowlist.filter((file) =>
  /\.(?:html|js|json|xml|txt)$/u.test(file)
);
for (const file of publicTextFiles) {
  const source = Object.hasOwn(files, file)
    ? files[file]
    : await readFile(path.join(root, file), "utf8");
  for (const pattern of [
    /https:\/\/buy\.stripe\.com\//u,
    /straight on to Stripe|existing account pays directly|paid right in the maker/iu,
  ]) {
    const match = source.match(pattern);
    if (match) {
      errors.push(`${file}: contains direct public payment authority ${JSON.stringify(match[0])}`);
    }
  }
  if (file.endsWith(".js")) {
    for (const semantic of heldAlakazamExecutableSemantics) {
      const match = source.match(new RegExp(semantic.pattern, "u"));
      if (match) {
        errors.push(
          `${file}: contains held Alakazam executable semantics `
          + `${semantic.id} ${JSON.stringify(match[0])}`
        );
      }
    }
  }
}

const offerById = new Map(SELLABLE.map((offer) => [offer.id, offer]));
const availabilityClaimRules = [
  {
    id: "alacazam.hosting",
    state: OFFER_AVAILABILITY.HELD,
    label: "held Alakazam sale",
    patterns: [
      /Abracadabra builds it\. Alakazam keeps it live/iu,
      /Free to See-\$5 to Download-\$25 a Month Keeps It Live/iu,
      /Alakazam is the service that keeps it and puts it online/iu,
      /Live at your own address/iu,
      /(?:the\s+)?\$5 comes off (?:your first month|Alakazam)/iu,
      /leaving costs nothing/iu,
      /Alakazam is (?:active|on)\b/iu,
    ],
  },
  {
    id: "assessment",
    state: OFFER_AVAILABILITY.ACCOUNT_ONLY,
    label: "account-only assessment sale",
    patterns: [
      /assessment that comes off any build/iu,
      /full \$200 comes off any build/iu,
      /Book (?:the|an|your) assessment/iu,
    ],
  },
];
for (const [file, source] of Object.entries(files)) {
  for (const rule of availabilityClaimRules) {
    if (offerById.get(rule.id)?.availability !== rule.state) continue;
    for (const pattern of rule.patterns) {
      const match = source.match(pattern);
      if (match) {
        errors.push(`${file}: contains ${rule.label} claim ${JSON.stringify(match[0])}`);
      }
    }
  }
}
for (const file of [
  "abracadabra/index.html",
  "abracadabra/how/index.html",
  "alakazam/index.html",
  "faq/index.html",
]) {
  if (!files[file].match(/Alakazam[^<\n]{0,120}(?:coming soon|not open yet)|(?:coming soon|not open yet)[^<\n]{0,120}Alakazam/iu)) {
    errors.push(`${file}: must plainly say that Alakazam sign-up or hosting is coming soon`);
  }
  forbidRegex(file, /Alakazam[^<\n]{0,100}\$25(?!\d)|\$25(?!\d)[^<\n]{0,100}Alakazam/iu, "unreleased Alakazam price");
}

const domainPage = files["domains/index.html"] ?? "";
const domainSearch = await readFile(path.join(root, "domains/domain-search.js"), "utf8");
for (const marker of [
  "You approve the name and price before anything is bought.",
  "It does not reserve the name or prove that it can be bought.",
  "I check again right before purchase and buy only after you approve the details.",
]) {
  if (!domainPage.includes(marker)) {
    errors.push(`domains/index.html: missing customer purchase boundary ${JSON.stringify(marker)}`);
  }
}
for (const [sourceName, source, forbidden] of [
  ["domains/index.html", domainPage, "$40"],
  ["domains/index.html", domainPage, "$45"],
  ["domains/index.html", domainPage, "Buy prices, flat"],
  ["domains/index.html", domainPage, "live immediately"],
  ["domains/domain-search.js", domainSearch, "buy.stripe.com"],
  ["domains/domain-search.js", domainSearch, "CHECKOUT_BY_BAND"],
  ["domains/domain-search.js", domainSearch, "domain-prices.json"],
  ["domains/domain-search.js", domainSearch, "refund in full"],
  ["domains/domain-search.js", domainSearch, "rent an address instead"],
]) {
  if (source.includes(forbidden)) {
    errors.push(`${sourceName}: contains held domain storefront authority ${JSON.stringify(forbidden)}`);
  }
}
for (const marker of [
  "Ask to verify ",
  "not a reservation, registrar result, quote, or authorization to buy",
]) {
  if (!domainSearch.includes(marker)) {
    errors.push(`domains/domain-search.js: missing inquiry-only preflight boundary ${JSON.stringify(marker)}`);
  }
}

const assessment = publicCatalog.professionalServices?.find((service) =>
  service.id === "website-assessment");
if (
  !assessment ||
  assessment.priceCents !== 35000 ||
  assessment.scopeState !== "must_be_stated_before_sale" ||
  assessment.turnaroundState !== "must_be_stated_before_sale" ||
  assessment.buildCredit?.basisPoints !== 10000 ||
  assessment.buildCredit?.maximumCents !== 35000 ||
  assessment.buildCredit?.eligibleSuccessor !==
    "any_accepted_site_sourcery_build"
) {
  errors.push(
    "data/public-catalog.json: website-assessment must match the approved exact $350 source offer and full non-cash accepted-build credit"
  );
} else {
  const allowedDollarDisplays = new Set();
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
  collectCatalogAmounts({
    buildTiers: publicCatalog.buildTiers,
    customPaymentTerms: publicCatalog.customPaymentTerms,
    scaleRule: publicCatalog.scaleRule,
    creativityLevels: publicCatalog.creativityLevels,
    buildAddons: publicCatalog.buildAddons,
    architectureBands: publicCatalog.architectureBands,
    migration: publicCatalog.migration,
    carePlans: publicCatalog.carePlans,
    professionalServices: publicCatalog.professionalServices,
  });
  for (const offer of SELLABLE) {
    if (
      offer.amountCents !== null
      && offer.availability !== OFFER_AVAILABILITY.HELD
    ) allowedDollarDisplays.add(offer.amountCents / 100);
    for (const amount of offer.displayAmountsCents ?? []) {
      if (offer.availability !== OFFER_AVAILABILITY.HELD) {
        allowedDollarDisplays.add(amount / 100);
      }
    }
  }
  const observedDisplays = [];
  for (const file of publicHtmlFiles) {
    // These checked-in sources are explicit unsealed review drafts. The build
    // replaces them with the exact sealed current legal artifacts, which the
    // generated-artifact gate checks separately.
    if (UNPUBLISHED_LEGAL_DRAFT_FILES.has(file)) continue;
    const source = files[file];
    for (const match of source.matchAll(/\$\s?\d[\d,.]*/gu)) {
      observedDisplays.push(`${file}:${match[0].replace(/\s/gu, "")}`);
    }
  }
  const invalidDisplays = observedDisplays.filter((entry) => {
    const separator = entry.lastIndexOf(":");
    const file = entry.slice(0, separator);
    const amount = entry.slice(separator + 1).replace(/[$,]/gu, "");
    if (Number(amount) === 5 && SEALED_FIVE_DOLLAR_LEGAL_V5_FILES.has(file)) {
      return false;
    }
    return !allowedDollarDisplays.has(Number(amount));
  });
  if (invalidDisplays.length > 0) {
    errors.push(`public HTML dollar displays must match the current catalog; received ${JSON.stringify(invalidDisplays.sort())}`);
  }
  if (!files["abracadabra/index.html"].includes("$20")) {
    errors.push("abracadabra/index.html: missing the reviewed $20 project Download proposition");
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
  console.log(`Pitch-safe catalog checks passed: ${publicCatalog.version}/${publicCatalog.tierCatalogId}/${publicCatalog.addonCatalogId}/${publicCatalog.careCatalogId} lineage verified; Custom scope and public dollar copy match approved records; every commerce offer has explicit availability; direct checkout, Offer data, and price-bearing attributes remain absent.`);
}
