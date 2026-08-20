import { createHash } from 'node:crypto';

export const APPROVED_SOURCE_FILE_SHA256 = '9398d025b12f96ad1989620226cd153dabd39ee81d2ba11d1f03badf1cad2ee1';
export const APPROVED_SOURCE_CATALOG_DIGEST = '0474cd8a48b0b28760e6aa1696eb0021de02f5420646a44efae625bba6a74bcc';

export const CATALOG_VERSION = 'SS-COMMERCIAL-2026.6';
export const TIER_CATALOG_ID = 'SS-TIERS-2026.6';
export const ADDON_CATALOG_ID = 'SS-ADDONS-2026.6';
export const CARE_CATALOG_ID = 'SS-CARE-2026.6';
export const PROFESSIONAL_SERVICE_CATALOG_ID = 'SS-PROFESSIONAL-2026.2';

export const COMMERCIAL_AUTHORITY = Object.freeze({
  state: 'hold',
  reason: 'Founder rollup Gate 10/11 remain open.',
  allows: Object.freeze({
    internalEstimate: true,
    privateDemo: true,
    customerQuote: false,
    agreement: false,
    production: false,
    invoice: false,
    payment: false,
    careActivation: false,
    publicCommercialPublish: false,
  }),
});

const tier = (id, label, priceCents, limits, baseEffortMinutes) => Object.freeze({
  id,
  label,
  priceCents,
  limits: Object.freeze(limits),
  baseEffortMinutes,
});

// These are delivered-footprint ceilings, not cumulative capability bundles.
// Higher tiers may serve a smaller page count when content/layout density requires it.
export const BUILD_TIERS = Object.freeze([
  tier('card', 'Card', 35000, {
    craftedPages: 1, sections: 5, uniqueLayouts: 1, contentWords: 500,
    suppliedMedia: 2, includedForms: 0, includedConnections: 1, revisions: 1,
  }, 240),
  tier('card-plus', 'Card Plus', 60000, {
    craftedPages: 1, sections: 8, uniqueLayouts: 1, contentWords: 900,
    suppliedMedia: 8, includedForms: 0, includedConnections: 1, revisions: 1,
  }, 420),
  tier('site', 'Site', 100000, {
    craftedPages: 4, sections: 16, uniqueLayouts: 4, contentWords: 1800,
    suppliedMedia: 12, includedForms: 1, includedConnections: 1, revisions: 2,
  }, 720),
  tier('site-plus', 'Site Plus', 160000, {
    craftedPages: 7, sections: 28, uniqueLayouts: 7, contentWords: 3000,
    suppliedMedia: 24, includedForms: 1, includedConnections: 1, revisions: 2,
  }, 1140),
  tier('signature', 'Signature', 240000, {
    craftedPages: 10, sections: 40, uniqueLayouts: 10, contentWords: 4500,
    suppliedMedia: 36, includedForms: 1, includedConnections: 1, revisions: 3,
  }, 1680),
  tier('flagship', 'Flagship', 360000, {
    craftedPages: 15, sections: 60, uniqueLayouts: 15, contentWords: 7000,
    suppliedMedia: 60, includedForms: 1, includedConnections: 1, revisions: 4,
  }, 2520),
]);

export const BUILD_TIER_BY_ID = Object.freeze(Object.fromEntries(BUILD_TIERS.map((item) => [item.id, item])));

export const CUSTOM_PAYMENT_TERMS = Object.freeze({
  id: 'SS-CUSTOM-PAYMENTS-2026.1',
  ownershipTransfersOn: 'final_payment',
  fullPaymentTierIds: Object.freeze(['card', 'card-plus']),
  depositTierIds: Object.freeze(['site', 'site-plus', 'signature', 'flagship', 'scale']),
  fullPayment: Object.freeze({
    dueBeforeStartBasisPoints: 10000,
    dueOnCompletionBasisPoints: 0,
  }),
  deposit: Object.freeze({
    dueBeforeStartBasisPoints: 5000,
    dueOnCompletionBasisPoints: 5000,
  }),
  boundary: 'Card and Card Plus require full payment before work starts. Site through Scale require a 50% deposit before work starts and the remaining 50% on completion. Ownership transfers only after final payment.',
});

export const SCALE_RULE = Object.freeze({
  id: 'scale',
  label: 'Scale',
  baseTierId: 'flagship',
  minimumCapacityUnits: 1,
  maximumCapacityUnits: 15,
  maximumCraftedPages: 30,
  unitPriceCents: 24000,
  unitEffortMinutes: 168,
  allowancePerUnit: Object.freeze({
    craftedPages: 1,
    sections: 4,
    uniqueLayouts: 1,
    contentWords: 500,
    suppliedMedia: 4,
  }),
  boundary: 'Automatically priced only through 30 delivered crafted pages and the matching normalized capacity. Larger or denser work requires a component-specific custom exception.',
});

export const CREATIVITY_LEVELS = Object.freeze([
  Object.freeze({
    id: 'essential',
    label: 'Essential',
    premiumBasisPoints: 0,
    minimumPremiumCents: 0,
    maximumMotionComponents: 0,
    risk: 0,
    boundary: 'Polished custom layout system, typography, color, responsive behavior, accessibility, performance, and restrained functional interactions; no bespoke art direction or motion system.',
  }),
  Object.freeze({
    id: 'distinctive',
    label: 'Distinctive',
    premiumBasisPoints: 2500,
    minimumPremiumCents: 50000,
    maximumMotionComponents: 3,
    risk: 2,
    boundary: 'One original art direction, custom hero/compositions, supporting graphics, and up to three purposeful motion components in the approved footprint.',
  }),
  Object.freeze({
    id: 'atelier',
    label: 'Atelier',
    premiumBasisPoints: 5000,
    minimumPremiumCents: 120000,
    maximumMotionComponents: 8,
    risk: 5,
    boundary: 'Bespoke visual storytelling with several major compositions, a custom graphic system, and ambient or scroll-led motion with reduced-motion treatment; video, complex 3D, games, and application interfaces remain custom.',
  }),
]);

export const CREATIVITY_LEVEL_BY_ID = Object.freeze(Object.fromEntries(CREATIVITY_LEVELS.map((item) => [item.id, item])));

const addon = (id, label, price, options = {}) => Object.freeze({
  id,
  label,
  priceCents: typeof price === 'number' ? price : null,
  ...options,
});

export const BUILD_ADDONS = Object.freeze({
  basic_form: addon('basic_form', 'Basic contact form', 20000, {
    maxQuantity: 1, effortMinutes: 120, risk: 1, eligibleTiers: ['card', 'card-plus'],
    boundary: 'One recipient, at most five fields, no upload, branching, account, or automation.',
  }),
  standard_tool: addon('standard_tool', 'Standard interactive tool', 45000, {
    maxQuantity: 1, effortMinutes: 360, risk: 3,
    boundary: 'One documented input/output model within six implementation hours; basic forms and ordinary embeds are excluded.',
  }),
  hosted_provider: addon('hosted_provider', 'Hosted provider setup', 70000, {
    maxQuantity: 1, effortMinutes: 480, risk: 4,
    boundary: 'One client-owned account, one location or resource, at most five services/products, one journey, and test completion.',
  }),
  static_collection: addon('static_collection', 'Static collection', 30000, {
    maxQuantity: 1, effortMinutes: 210, risk: 2,
    boundary: 'One supplied collection in one reusable layout without detail URLs, CMS, filtering, or self-publishing.',
  }),
  copy_expansion: addon('copy_expansion', 'Additional content shaping', 20000, {
    maxQuantity: 3, effortMinutes: 150, risk: 1, unit: '500 supplied/approved words',
    boundary: 'Light drafting/editing from supplied approved facts; interviews, research, regulated claims, and substantial net-new writing are custom.',
  }),
  additional_connection: addon('additional_connection', 'Additional domain or provider connection', 20000, {
    maxQuantity: 2, effortMinutes: 120, risk: 2,
    boundary: 'One client-owned ordinary endpoint with at most five DNS changes, verification, redirect, and SSL check.',
  }),
  extra_revision_round: addon('extra_revision_round', 'Additional grouped revision round', null, {
    maxQuantity: 1, effortMinutes: 180, risk: 2,
    tierPricesCents: Object.freeze({
      card: 12500, 'card-plus': 17500, site: 25000,
      'site-plus': 30000, signature: 40000, flagship: 55000,
    }),
    boundary: 'Adjustments to the approved direction; replacement content, direction, pages, capabilities, or restructuring are new scope.',
  }),
  priority_production_window: addon('priority_production_window', 'Priority production window', null, {
    maxQuantity: 1, effortMinutes: 0, risk: 3,
    tierPricesCents: Object.freeze({
      card: 20000, 'card-plus': 30000, site: 45000,
      'site-plus': 65000, signature: 90000, flagship: 120000,
    }),
    boundary: 'Available only after capacity is confirmed and complete materials, acceptance, and required payment are present.',
  }),
});

export const ARCHITECTURE_BANDS = Object.freeze([
  Object.freeze({ min: 3, max: 5, priceCents: 35000, effortMinutes: 240 }),
  Object.freeze({ min: 6, max: 10, priceCents: 65000, effortMinutes: 480 }),
  Object.freeze({ min: 11, max: 15, priceCents: 95000, effortMinutes: 720 }),
]);

export const MIGRATION_RULE = Object.freeze({
  firstRecords: 100,
  firstPriceCents: 35000,
  nextRecords: 100,
  nextPriceCents: 20000,
  maxRecords: 1000,
  firstEffortMinutes: 240,
  nextEffortMinutes: 120,
});

export const FIXED_SCOPE_LIMITS = Object.freeze({
  maxCapabilityMinutes: 1200,
  maxPrimarySystems: 2,
  maxRiskScore: 14,
  minimumRealizedRateCentsPerHour: 7500,
});

export const CARE_PLANS = Object.freeze([
  Object.freeze({ id: 'host', label: 'Host', monthlyCents: 2500, includedMinutes: 0, editCap: 0 }),
  Object.freeze({ id: 'care-lite', label: 'Care Lite', monthlyCents: 6900, includedMinutes: 30, editCap: 3 }),
  Object.freeze({ id: 'care', label: 'Care', monthlyCents: 11900, includedMinutes: 60, editCap: 6 }),
  Object.freeze({ id: 'care-plus', label: 'Care Plus', monthlyCents: 19900, includedMinutes: 120, editCap: 10 }),
  Object.freeze({
    id: 'partner',
    label: 'Partner',
    monthlyCents: 34900,
    includedMinutes: 240,
    editCap: 16,
    overflow: Object.freeze({
      billingMode: 'metered_started_minute',
      rateCentsPerStartedMinute: 250,
      maximumCents: 15000,
      maximumMinutes: 60,
    }),
  }),
]);

export const CARE_PLAN_BY_ID = Object.freeze(Object.fromEntries(CARE_PLANS.map((item) => [item.id, item])));

export const PROFESSIONAL_SERVICES = Object.freeze([
  Object.freeze({
    id: 'website-assessment',
    mechanismId: 'DL-02',
    label: 'Website assessment',
    priceCents: 35000,
    deliverable: 'A written assessment of the customer’s existing website with screenshot evidence and real findings ranked by severity.',
    scopeState: 'must_be_stated_before_sale',
    turnaroundState: 'must_be_stated_before_sale',
    buildCredit: Object.freeze({
      basisPoints: 10000,
      maximumCents: 35000,
      eligibleSuccessor: 'any_accepted_site_sourcery_build',
    }),
    boundary: 'The assessment diagnoses the existing website. Remediation is a separately accepted build or service scope.',
    placements: Object.freeze(['services', 'studio', 'custom-diagnostic-entry']),
  }),
]);

export const PROFESSIONAL_SERVICE_BY_ID = Object.freeze(
  Object.fromEntries(PROFESSIONAL_SERVICES.map((item) => [item.id, item])),
);

export const CATALOG = Object.freeze({
  version: CATALOG_VERSION,
  currency: 'USD',
  tierCatalogId: TIER_CATALOG_ID,
  addonCatalogId: ADDON_CATALOG_ID,
  careCatalogId: CARE_CATALOG_ID,
  professionalServiceCatalogId: PROFESSIONAL_SERVICE_CATALOG_ID,
  buildTiers: BUILD_TIERS,
  customPaymentTerms: CUSTOM_PAYMENT_TERMS,
  scaleRule: SCALE_RULE,
  creativityLevels: CREATIVITY_LEVELS,
  buildAddons: BUILD_ADDONS,
  architectureBands: ARCHITECTURE_BANDS,
  migrationRule: MIGRATION_RULE,
  fixedScopeLimits: FIXED_SCOPE_LIMITS,
  carePlans: CARE_PLANS,
  professionalServices: PROFESSIONAL_SERVICES,
});

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const CATALOG_DIGEST = createHash('sha256').update(stableStringify(CATALOG)).digest('hex');

export function money(cents) {
  if (!Number.isInteger(cents)) throw new TypeError('money requires integer cents');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
