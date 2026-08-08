import {
  deepFreeze,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "../commerce-v2/canonical.mjs";
import {
  getBrowserSafeAlakazamCatalog
} from "../commerce-v2/alakazam.mjs";

export const ALAKAZAM_INVOICE_SCHEMA =
  "sitesourcery.alakazam-invoice/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INVOICE_NUMBER_PREFIX = "SSAK-";
const RECEIPT_KINDS = new Set([
  "start_payment",
  "upgrade_difference",
  "renewal_payment"
]);
const TAX_MODES = new Set([
  "automatic",
  "disabled_by_owner"
]);
const DOWNLOAD_CREDIT_MINOR = 500;
const LINE_DESCRIPTIONS = Object.freeze({
  start_payment: "Alakazam first month",
  upgrade_difference: "Alakazam upgrade difference",
  renewal_payment: "Alakazam monthly renewal"
});

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactUuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "invalid_input",
    `${field} is invalid`
  );
  return selected;
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return value;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "repository_conflict",
    `${field} is unavailable`,
    { status: 500 }
  );
  return value;
}

export function exactAlakazamBillingScope(value, field) {
  exactKeys(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    field
  );
  const actorId = exactUuid(
    value.actorId,
    `${field}.actorId`
  );
  const customerId = exactUuid(
    value.customerId,
    `${field}.customerId`
  );
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer billing project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: exactUuid(
      value.tenantId,
      `${field}.tenantId`
    ),
    customerId,
    actorId,
    projectId: exactUuid(
      value.projectId,
      `${field}.projectId`
    )
  });
}

/**
 * The Alakazam receipt table carries no stored invoice number and this lane
 * adds no migration, so the customer reference is derived from the receipt
 * identity with the same rule the stored service-invoice numbers use
 * ('SSA-' || upper(replace(id::text, '-', ''))). The reference is therefore
 * stable and reproducible while no provider identifier ever leaves the
 * runtime.
 */
export function alakazamInvoiceNumber(receiptId) {
  return `${INVOICE_NUMBER_PREFIX}${
    exactUuid(receiptId, "receiptId")
      .replaceAll("-", "")
      .toUpperCase()
  }`;
}

/**
 * A start or upgrade receipt is bound to the change quote that produced it, so
 * its tier is read straight from the durable quote. A renewal receipt has no
 * quote; its tier is the one whose catalogued monthly price is exactly the
 * amount charged, and the catalog prices are distinct, so the match is exact.
 */
function catalogTier(catalog, tierId, subtotalMinor, kind) {
  if (tierId === null) {
    invariant(
      kind === "renewal_payment",
      "repository_conflict",
      "the customer Alakazam invoice tier is unavailable",
      { status: 500 }
    );
    const matches = catalog.tiers.filter(
      (candidate) =>
        candidate.price.amountMinor === subtotalMinor
    );
    invariant(
      matches.length === 1,
      "repository_conflict",
      "the customer Alakazam tier is unavailable",
      { status: 500 }
    );
    return matches[0];
  }
  const selected = requiredText(
    tierId,
    "invoice.tierId",
    100
  );
  const tier = catalog.tiers.find(
    (candidate) => candidate.tierId === selected
  );
  invariant(
    tier,
    "repository_conflict",
    "the customer Alakazam tier is unavailable",
    { status: 500 }
  );
  return tier;
}

function exactRepositoryInvoice(value, scope, receiptId) {
  invariant(
    value !== null && value !== undefined,
    "invoice_unavailable",
    "the customer Alakazam invoice is unavailable",
    { status: 404 }
  );
  exactKeys(
    value,
    [
      "currency",
      "discountMinor",
      "kind",
      "netSubtotalMinor",
      "projectId",
      "providerInvoiceRecorded",
      "receiptId",
      "settledAt",
      "settlementDigest",
      "subtotalMinor",
      "taxMinor",
      "taxMode",
      "tierId",
      "totalMinor"
    ],
    "invoice"
  );
  invariant(
    value.projectId === scope.projectId &&
      value.receiptId === receiptId &&
      value.currency === "USD" &&
      typeof value.providerInvoiceRecorded === "boolean",
    "repository_conflict",
    "the customer Alakazam invoice binding changed",
    { status: 500 }
  );
  return value;
}

/**
 * A-03. Projects one settled Alakazam receipt into the customer-safe invoice
 * document. The document is produced entirely from durable Site Sourcery
 * evidence: no provider call is made and no provider identifier
 * (customer, subscription, invoice, payment intent, event) is exposed.
 */
export function projectAlakazamInvoice(
  storedInput,
  scopeInput,
  receiptIdInput
) {
  const scope = exactAlakazamBillingScope(
    scopeInput,
    "scope"
  );
  const receiptId = exactUuid(receiptIdInput, "receiptId");
  const catalog = getBrowserSafeAlakazamCatalog();
  const stored = exactRepositoryInvoice(
    storedInput,
    scope,
    receiptId
  );
  const kind = requiredText(stored.kind, "invoice.kind", 50);
  const taxMode = requiredText(
    stored.taxMode,
    "invoice.taxMode",
    50
  );
  invariant(
    RECEIPT_KINDS.has(kind) && TAX_MODES.has(taxMode),
    "repository_conflict",
    "the customer Alakazam invoice changed",
    { status: 500 }
  );
  const subtotalMinor = positiveInteger(
    stored.subtotalMinor,
    "invoice.subtotalMinor"
  );
  const tier = catalogTier(
    catalog,
    stored.tierId,
    subtotalMinor,
    kind
  );
  const discountMinor = nonnegativeInteger(
    stored.discountMinor,
    "invoice.discountMinor"
  );
  const netSubtotalMinor = nonnegativeInteger(
    stored.netSubtotalMinor,
    "invoice.netSubtotalMinor"
  );
  const taxMinor = nonnegativeInteger(
    stored.taxMinor,
    "invoice.taxMinor"
  );
  const totalMinor = nonnegativeInteger(
    stored.totalMinor,
    "invoice.totalMinor"
  );
  invariant(
    netSubtotalMinor === subtotalMinor - discountMinor &&
      totalMinor === netSubtotalMinor + taxMinor &&
      (
        discountMinor === 0 ||
        (
          discountMinor === DOWNLOAD_CREDIT_MINOR &&
          kind === "start_payment"
        )
      ) &&
      (taxMode === "automatic" || taxMinor === 0),
    "repository_conflict",
    "the customer Alakazam invoice total changed",
    { status: 500 }
  );
  const settledAt = requiredIso(
    stored.settledAt,
    "invoice.settledAt"
  );
  return deepFreeze({
    schema: ALAKAZAM_INVOICE_SCHEMA,
    projectId: scope.projectId,
    receiptId,
    invoiceNumber: alakazamInvoiceNumber(receiptId),
    state: "settled",
    kind,
    tier: {
      tierId: tier.tierId,
      name: tier.name
    },
    issuedAt: settledAt,
    settledAt,
    currency: "USD",
    lines: [
      {
        lineNumber: 1,
        description: LINE_DESCRIPTIONS[kind],
        quantity: 1,
        unitAmountMinor: subtotalMinor,
        amountMinor: subtotalMinor
      }
    ],
    credits: discountMinor === 0
      ? []
      : [
          {
            kind: "download_purchase",
            description: "Download purchase credit",
            amountMinor: discountMinor
          }
        ],
    totals: {
      subtotalMinor,
      discountMinor,
      netSubtotalMinor,
      taxMinor,
      taxState: taxMode,
      totalMinor,
      currency: "USD"
    },
    settlement: {
      state: "settled",
      settledAt,
      providerInvoiceRecorded:
        stored.providerInvoiceRecorded,
      settlementDigest: requiredDigest(
        stored.settlementDigest,
        "invoice.settlementDigest"
      )
    },
    catalog: {
      catalogVersion: catalog.catalogVersion,
      termsVersion: catalog.termsVersion
    }
  });
}
