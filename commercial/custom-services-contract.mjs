import { createHash } from "node:crypto";

import {
  CATALOG_DIGEST,
  CATALOG_VERSION,
  CUSTOM_PAYMENT_TERMS,
  PROFESSIONAL_SERVICE_BY_ID,
  stableStringify,
} from "./catalog.mjs";

export const CUSTOM_SERVICES_CONTRACT_ID =
  "SS-CUSTOM-SERVICES-2026-08-19.2";

const assessment = PROFESSIONAL_SERVICE_BY_ID["website-assessment"];

export const CUSTOM_SERVICES_CONTRACT = Object.freeze({
  schema: "sitesourcery.custom-services-commercial-contract/v2",
  contractId: CUSTOM_SERVICES_CONTRACT_ID,
  catalogVersion: CATALOG_VERSION,
  catalogDigest: CATALOG_DIGEST,
  currency: "USD",
  seller: Object.freeze({
    legalName: "Desiderata Labs LLC",
    filedAlternateName: "SITESOURCERY",
    publicBrand: "Site Sourcery",
  }),
  tax: Object.freeze({
    display: "exclusive",
    state: "disabled_by_owner",
  }),
  assessment: Object.freeze({
    serviceId: assessment.id,
    amountMinor: assessment.priceCents,
    credit: Object.freeze({
      basisPoints: assessment.buildCredit.basisPoints,
      maximumMinor: assessment.buildCredit.maximumCents,
      maximumApplications: 1,
      nonCash: true,
      applicationScope: "custom_base_build",
      sameOrganizationAndProjectOnly: true,
    }),
  }),
  paymentTerms: Object.freeze({
    id: CUSTOM_PAYMENT_TERMS.id,
    fullPaymentTierIds: CUSTOM_PAYMENT_TERMS.fullPaymentTierIds,
    depositTierIds: CUSTOM_PAYMENT_TERMS.depositTierIds,
    fullPayment: CUSTOM_PAYMENT_TERMS.fullPayment,
    deposit: CUSTOM_PAYMENT_TERMS.deposit,
    ownershipTransfersOn: CUSTOM_PAYMENT_TERMS.ownershipTransfersOn,
  }),
  authority: Object.freeze({
    state: "hold",
    publicCommercialPublish: false,
    customerQuote: false,
    agreement: false,
    invoice: false,
    payment: false,
    careActivation: false,
    production: false,
  }),
});

export const CUSTOM_SERVICES_CONTRACT_DIGEST = createHash("sha256")
  .update(stableStringify(CUSTOM_SERVICES_CONTRACT))
  .digest("hex");

export function assertCustomServicesContract() {
  if (
    CATALOG_DIGEST !==
      "3416befc73dccbf2f8dc0f40233d4cd7c1833e4e329bd1047ce8bf41fd2e4de0"
    || CUSTOM_SERVICES_CONTRACT_DIGEST !==
      "0b6fcad1c2fab2904a223fc95ebeb88da1aca680a5c56c1e3d2327486fac1d4d"
    || assessment.priceCents !== 35_000
    || assessment.buildCredit.maximumCents !== 35_000
  ) {
    throw new Error("successor Custom commercial contract changed");
  }
  return true;
}

assertCustomServicesContract();
