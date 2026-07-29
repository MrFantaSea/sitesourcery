import {
  BILLING_SHAPES,
  CATALOG_SCHEMA,
  PRODUCT_IDS,
  PRODUCT_IMPLEMENTATIONS,
  PUBLIC_CATALOG_SCHEMA,
  TENURE_IDS
} from "./constants.mjs";
import { exactMoney, iso, requiredString } from "../domain/canonical.mjs";
import { invariant } from "../domain/errors.mjs";

function uniqueBy(rows, field, label) {
  const values = new Set();
  for (const row of rows) {
    const value = requiredString(row?.[field], `${label}.${field}`, 100);
    invariant(!values.has(value), "invalid_catalog", `duplicate ${label} ${value}`, { status: 500 });
    values.add(value);
  }
  return values;
}

function validateTerms(terms, tenureId) {
  invariant(terms && typeof terms === "object", "invalid_catalog", `terms missing for ${tenureId}`, {
    status: 500
  });
  requiredString(terms.renewal, `${tenureId}.terms.renewal`, 1000);
  requiredString(terms.ownership, `${tenureId}.terms.ownership`, 1000);
  requiredString(terms.hosting, `${tenureId}.terms.hosting`, 1000);
  requiredString(terms.cancellation, `${tenureId}.terms.cancellation`, 1000);
  invariant(
    terms.paymentGraceDays === null ||
      (Number.isSafeInteger(terms.paymentGraceDays) && terms.paymentGraceDays >= 0),
    "invalid_catalog",
    `payment grace invalid for ${tenureId}`,
    { status: 500 }
  );
  invariant(
    Number.isSafeInteger(terms.retentionAndExportDays) && terms.retentionAndExportDays >= 0,
    "invalid_catalog",
    `retention/export period invalid for ${tenureId}`,
    { status: 500 }
  );
  return Object.freeze(structuredClone(terms));
}

function validateAmountLine(line, label, recurring) {
  const money = exactMoney(line, label);
  if (recurring) {
    invariant(line.interval === "month" || line.interval === "year", "invalid_catalog", `${label}.interval invalid`, {
      status: 500
    });
  }
  return Object.freeze({
    ...money,
    ...(recurring ? { interval: line.interval } : {})
  });
}

function validateOffer(offer, products, tenures) {
  const offerId = requiredString(offer?.offerId, "offer.offerId", 100);
  const productId = requiredString(offer?.productId, "offer.productId", 100);
  const tenureId = requiredString(offer?.tenureId, "offer.tenureId", 100);
  invariant(products.has(productId), "invalid_catalog", `offer ${offerId} product is unknown`, { status: 500 });
  invariant(tenures.has(tenureId), "invalid_catalog", `offer ${offerId} tenure is unknown`, { status: 500 });
  invariant(offer.state === "approved", "invalid_catalog", `offer ${offerId} is not approved`, { status: 500 });
  const shape = BILLING_SHAPES[tenureId];
  invariant(Boolean(shape), "invalid_catalog", `offer ${offerId} tenure shape is unknown`, { status: 500 });
  invariant(
    Array.isArray(offer.eligibleAddressModes) &&
      offer.eligibleAddressModes.length > 0 &&
      offer.eligibleAddressModes.every(
        (mode) => mode === "licensed" || mode === "customer_owned"
      ),
    "invalid_catalog",
    `offer ${offerId} eligible address modes are invalid`,
    { status: 500 }
  );
  const eligibleAddressModes = [...new Set(offer.eligibleAddressModes)];
  invariant(
    tenureId !== "own" ||
      (eligibleAddressModes.length === 1 && eligibleAddressModes[0] === "customer_owned"),
    "invalid_catalog",
    `offer ${offerId} Own tenure must require a customer-owned address`,
    { status: 500 }
  );
  const amounts = {};
  const stripePriceRefs = {};
  for (const key of ["oneTime", "recurring"]) {
    const required = shape[key];
    invariant(
      required === Boolean(offer.amounts?.[key]),
      "invalid_catalog",
      `offer ${offerId} ${key} amount does not match tenure`,
      { status: 500 }
    );
    invariant(
      required === Boolean(offer.stripePriceRefs?.[key]),
      "invalid_catalog",
      `offer ${offerId} ${key} Stripe reference does not match tenure`,
      { status: 500 }
    );
    if (required) {
      amounts[key] = validateAmountLine(offer.amounts[key], `${offerId}.${key}`, key === "recurring");
      stripePriceRefs[key] = requiredString(
        offer.stripePriceRefs[key],
        `${offerId}.stripePriceRefs.${key}`,
        200
      );
    }
  }
  return Object.freeze({
    offerId,
    productId,
    tenureId,
    state: "approved",
    eligibleAddressModes: Object.freeze(eligibleAddressModes),
    amounts: Object.freeze(amounts),
    stripePriceRefs: Object.freeze(stripePriceRefs)
  });
}

export function validateOfferCatalog(input) {
  invariant(input?.schema === CATALOG_SCHEMA, "invalid_catalog", "catalog schema is unsupported", { status: 500 });
  const catalogVersion = requiredString(input.catalogVersion, "catalogVersion", 100);
  invariant(input.state === "approved", "catalog_unavailable", "offer catalog is not owner-approved", {
    status: 503
  });
  invariant(input.currency === "USD", "invalid_catalog", "catalog currency must be USD", { status: 500 });
  requiredString(input.approvedBy, "approvedBy", 200);
  iso(input.approvedAt, "approvedAt");
  requiredString(input.termsVersion, "termsVersion", 100);
  invariant(Array.isArray(input.products), "invalid_catalog", "catalog products missing", { status: 500 });
  invariant(Array.isArray(input.tenures), "invalid_catalog", "catalog tenures missing", { status: 500 });
  invariant(Array.isArray(input.offers), "invalid_catalog", "catalog offers missing", { status: 500 });

  const productIds = uniqueBy(input.products, "productId", "product");
  const tenureIds = uniqueBy(input.tenures, "tenureId", "tenure");
  invariant(
    PRODUCT_IDS.every((id) => productIds.has(id)) && productIds.size === PRODUCT_IDS.length,
    "invalid_catalog",
    "catalog must define exactly business, presence, and spark products",
    { status: 500 }
  );
  invariant(
    TENURE_IDS.every((id) => tenureIds.has(id)) && tenureIds.size === TENURE_IDS.length,
    "invalid_catalog",
    "catalog must define exactly rent, own, and owned_managed tenures",
    { status: 500 }
  );

  const products = input.products.map((product) => {
    const expectedImplementation = PRODUCT_IMPLEMENTATIONS[product.productId];
    const releaseState = product.releaseState;
    invariant(
      releaseState === "implemented" || releaseState === "held",
      "invalid_catalog",
      `${product.productId}.releaseState is invalid`,
      { status: 500 }
    );
    invariant(
      expectedImplementation === null
        ? releaseState === "held" && product.implementationContract === null
        : releaseState === "implemented" && product.implementationContract === expectedImplementation,
      "invalid_catalog",
      `${product.productId} implementation contract is not approved`,
      { status: 500 }
    );
    return Object.freeze({
      productId: product.productId,
      name: requiredString(product.name, `${product.productId}.name`, 200),
      description: requiredString(product.description, `${product.productId}.description`, 1000),
      releaseState,
      implementationContract: product.implementationContract
    });
  });
  const tenures = input.tenures.map((tenure) =>
    Object.freeze({
      tenureId: tenure.tenureId,
      name: requiredString(tenure.name, `${tenure.tenureId}.name`, 200),
      billingShape: Object.freeze({ ...BILLING_SHAPES[tenure.tenureId] }),
      terms: validateTerms(tenure.terms, tenure.tenureId)
    })
  );
  const offers = input.offers.map((offer) => validateOffer(offer, productIds, tenureIds));
  invariant(offers.length > 0, "catalog_unavailable", "catalog has no approved implemented offers", {
    status: 503
  });
  uniqueBy(offers, "offerId", "offer");
  const pairs = new Set();
  for (const offer of offers) {
    const pair = `${offer.productId}\u0000${offer.tenureId}`;
    invariant(!pairs.has(pair), "invalid_catalog", `duplicate product/tenure pair ${pair}`, { status: 500 });
    pairs.add(pair);
  }
  for (const offer of offers) {
    const product = products.find((row) => row.productId === offer.productId);
    invariant(
      product.releaseState === "implemented" &&
        typeof product.implementationContract === "string",
      "invalid_catalog",
      `offer ${offer.offerId} references an unimplemented product`,
      { status: 500 }
    );
  }
  return Object.freeze({
    schema: CATALOG_SCHEMA,
    catalogVersion,
    state: "approved",
    currency: "USD",
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
    termsVersion: input.termsVersion,
    products: Object.freeze(products),
    tenures: Object.freeze(tenures),
    offers: Object.freeze(offers)
  });
}

export function resolveOffer(catalog, offerId) {
  const id = requiredString(offerId, "offerId", 100);
  const offer = catalog.offers.find((candidate) => candidate.offerId === id);
  invariant(offer, "offer_unavailable", "offer is missing or unresolved", { status: 409 });
  return Object.freeze({
    offer,
    product: catalog.products.find((row) => row.productId === offer.productId),
    tenure: catalog.tenures.find((row) => row.tenureId === offer.tenureId)
  });
}

export function toBrowserSafeCatalog(catalog) {
  const visibleProductIds = new Set(catalog.offers.map((row) => row.productId));
  const visibleTenureIds = new Set(catalog.offers.map((row) => row.tenureId));
  return Object.freeze({
    schema: PUBLIC_CATALOG_SCHEMA,
    catalogVersion: catalog.catalogVersion,
    currency: catalog.currency,
    termsVersion: catalog.termsVersion,
    products: catalog.products
      .filter((row) => visibleProductIds.has(row.productId))
      .map(({ productId, name, description, implementationContract }) => ({
        productId,
        name,
        description,
        implementationContract
      })),
    tenures: catalog.tenures
      .filter((row) => visibleTenureIds.has(row.tenureId))
      .map(({ tenureId, name, billingShape }) => ({
        tenureId,
        name,
        billingShape: { ...billingShape }
      })),
    offers: catalog.offers.map(({ offerId, productId, tenureId, eligibleAddressModes }) => ({
      offerId,
      productId,
      tenureId,
      eligibleAddressModes: [...eligibleAddressModes]
    }))
  });
}
