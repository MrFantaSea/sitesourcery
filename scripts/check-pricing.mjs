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
const HELD_ALAKAZAM_PRICE_DISCLOSURE =
  "The planned $25, $35, and $50 Alakazam plans are not available.";
const HELD_ALAKAZAM_PRICE_DISCLOSURE_FILES = new Set([
  "faq/index.html",
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
  responder: OFFER_AVAILABILITY.HELD,
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
      /\$25[^<\n]{0,40}(?:month|mo)\b/iu,
      /(?:the\s+)?\$5 comes off (?:your first month|Alakazam)/iu,
      /leaving costs nothing/iu,
      /Alakazam is (?:active|on)\b/iu,
    ],
  },
  {
    id: "responder",
    state: OFFER_AVAILABILITY.HELD,
    label: "held Responder sale",
    patterns: [
      /\$300\s+setup/iu,
      /\$250\s+(?:a|per)\s+month/iu,
      /The Responder[^<\n]{0,80}texts them back/iu,
      /Answers in seconds|Sent 4 seconds|Switch it off any time/iu,
    ],
  },
  {
    id: "domain.purchase",
    state: OFFER_AVAILABILITY.INQUIRY_ONLY,
    label: "inquiry-only domain sale",
    patterns: [/Buy a domain/iu, /rent an address instead/iu],
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

const domainPage = files["domains/index.html"] ?? "";
const domainSearch = await readFile(path.join(root, "domains/domain-search.js"), "utf8");
for (const marker of [
  "Domain registration is inquiry-only.",
  "public-DNS preflight",
  "This page cannot accept payment.",
]) {
  if (!domainPage.includes(marker)) {
    errors.push(`domains/index.html: missing inquiry-only boundary ${JSON.stringify(marker)}`);
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
    professionalServices: publicCatalog.professionalServices,
  });
  for (const offer of SELLABLE) {
    if (
      offer.amountCents !== null
      && offer.availability !== OFFER_AVAILABILITY.HELD
    ) allowedDollarDisplays.add(offer.amountCents / 100);
  }
  const observedDisplays = [];
  for (const file of publicHtmlFiles) {
    let source = files[file];
    if (HELD_ALAKAZAM_PRICE_DISCLOSURE_FILES.has(file)) {
      const disclosureCount = source.split(
        HELD_ALAKAZAM_PRICE_DISCLOSURE
      ).length - 1;
      if (disclosureCount !== 1) {
        errors.push(
          `${file}: held Alakazam price disclosure must appear exactly once; received ${disclosureCount}`
        );
      } else {
        source = source.replace(HELD_ALAKAZAM_PRICE_DISCLOSURE, "");
      }
    }
    for (const match of source.matchAll(/\$\s?\d[\d,.]*/gu)) {
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
  console.log(`Pitch-safe catalog checks passed: ${publicCatalog.version}/${publicCatalog.tierCatalogId}/${publicCatalog.addonCatalogId}/${publicCatalog.careCatalogId} lineage verified; Custom scope records and public dollar copy match the private projection; all commerce offers have explicit availability; Domains is inquiry/preflight-only; checkout endpoints, Offer data, price-bearing attributes, and Care plan offers are absent.`);
}
