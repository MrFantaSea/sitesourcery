#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADDON_CATALOG_ID,
  APPROVED_SOURCE_CATALOG_DIGEST,
  APPROVED_SOURCE_FILE_SHA256,
  ARCHITECTURE_BANDS,
  BUILD_ADDONS,
  BUILD_TIERS,
  CARE_CATALOG_ID,
  CARE_PLANS,
  CATALOG_DIGEST,
  CATALOG_VERSION,
  CREATIVITY_LEVELS,
  CUSTOM_PAYMENT_TERMS,
  MIGRATION_RULE,
  PROFESSIONAL_SERVICE_CATALOG_ID,
  PROFESSIONAL_SERVICES,
  SCALE_RULE,
  TIER_CATALOG_ID,
  stableStringify,
} from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_CATALOG_PATH = resolve(HERE, '../site/data/public-catalog.json');

function publicAddon(item) {
  return {
    id: item.id,
    label: item.label,
    priceCents: item.priceCents,
    maxQuantity: item.maxQuantity,
    unit: item.unit || null,
    eligibleTiers: item.eligibleTiers || null,
    tierPricesCents: item.tierPricesCents || null,
    boundary: item.boundary,
  };
}

export function publicCatalogProjection() {
  const value = {
    version: CATALOG_VERSION,
    currency: 'USD',
    offerState: 'inquiry-only',
    notice: 'Non-binding pricing preview. Verified scope and written acceptance are required; inquiry does not authorize work or billing.',
    sourceCatalogDigest: CATALOG_DIGEST,
    approvedSourceCatalogDigest: APPROVED_SOURCE_CATALOG_DIGEST,
    approvedSourceFileSha256: APPROVED_SOURCE_FILE_SHA256,
    tierCatalogId: TIER_CATALOG_ID,
    addonCatalogId: ADDON_CATALOG_ID,
    careCatalogId: CARE_CATALOG_ID,
    professionalServiceCatalogId: PROFESSIONAL_SERVICE_CATALOG_ID,
    buildTiers: BUILD_TIERS.map((item) => ({
      id: item.id, label: item.label, priceCents: item.priceCents, limits: item.limits,
    })),
    customPaymentTerms: CUSTOM_PAYMENT_TERMS,
    scaleRule: {
      id: SCALE_RULE.id,
      label: SCALE_RULE.label,
      baseTierId: SCALE_RULE.baseTierId,
      minimumCapacityUnits: SCALE_RULE.minimumCapacityUnits,
      maximumCapacityUnits: SCALE_RULE.maximumCapacityUnits,
      maximumCraftedPages: SCALE_RULE.maximumCraftedPages,
      unitPriceCents: SCALE_RULE.unitPriceCents,
      allowancePerUnit: SCALE_RULE.allowancePerUnit,
      boundary: SCALE_RULE.boundary,
    },
    creativityLevels: CREATIVITY_LEVELS.map((item) => ({
      id: item.id,
      label: item.label,
      premiumBasisPoints: item.premiumBasisPoints,
      minimumPremiumCents: item.minimumPremiumCents,
      maximumMotionComponents: item.maximumMotionComponents,
      boundary: item.boundary,
    })),
    buildAddons: Object.values(BUILD_ADDONS).map(publicAddon),
    architectureBands: ARCHITECTURE_BANDS.map(({ min, max, priceCents }) => ({ min, max, priceCents })),
    migration: {
      firstRecords: MIGRATION_RULE.firstRecords,
      firstPriceCents: MIGRATION_RULE.firstPriceCents,
      nextRecords: MIGRATION_RULE.nextRecords,
      nextPriceCents: MIGRATION_RULE.nextPriceCents,
      maxRecords: MIGRATION_RULE.maxRecords,
    },
    carePlans: CARE_PLANS.map(({ id, label, monthlyCents, includedMinutes, editCap, overflow = null }) => ({
      id,
      label,
      monthlyCents,
      includedMinutes,
      editCap,
      overflow: overflow ? { ...overflow } : null,
    })),
    professionalServices: PROFESSIONAL_SERVICES,
  };
  value.projectionDigest = createHash('sha256').update(stableStringify(value)).digest('hex');
  return value;
}

export const PUBLIC_PROJECTION_DIGEST = publicCatalogProjection().projectionDigest;

export function writePublicCatalog(file = PUBLIC_CATALOG_PATH) {
  const projection = publicCatalogProjection();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(projection, null, 2)}\n`, 'utf8');
  return { file, digest: projection.projectionDigest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = writePublicCatalog();
  console.log(`Wrote public catalog ${result.digest} to ${result.file}`);
}
