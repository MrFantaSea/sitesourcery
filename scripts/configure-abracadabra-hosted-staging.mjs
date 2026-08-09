const APP_SCRIPT = '<script src="/abracadabra/app/abracadabra-app.js" defer></script>';
const APP_STYLESHEET =
  '<link rel="stylesheet" href="/abracadabra/app/abracadabra-app.css">';
const ALAKAZAM_35_STYLESHEET =
  '<link rel="stylesheet" href="/abracadabra/app/abracadabra-alakazam-35.css">';
const ALAKAZAM_50_STYLESHEET =
  '<link rel="stylesheet" href="/abracadabra/app/abracadabra-alakazam-50.css">';
const ALAKAZAM_RETAINED_PREMIUM_STYLESHEET =
  '<link rel="stylesheet" href="/abracadabra/app/abracadabra-alakazam-retained-premium.css">';
const HOLD_META =
  '<meta name="sitesourcery-abracadabra-control-mode" content="hold">';
const HOSTED_META =
  '<meta name="sitesourcery-abracadabra-control-mode" content="hosted">';
const IMPLEMENTED_PRODUCT_CONTRACT = "abracadabra.spark/v1";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function safeId(value) {
  const candidate = text(value);
  return /^[a-z0-9][a-z0-9_.-]{0,99}$/u.test(candidate) ? candidate : "";
}

function safeAxis(input, idField, nameField, descriptionField) {
  const output = {};
  const entries = Array.isArray(input)
    ? input.map((candidate) => [candidate && candidate[idField], candidate])
    : Object.entries(input || {});
  for (const [rawId, candidate] of entries) {
    const id = safeId(rawId);
    if (
      !id
      || !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
    ) continue;
    const label = text(candidate[nameField] || candidate.label || candidate.name);
    if (!label) continue;
    output[id] = {
      label: label.slice(0, 100),
      summary: text(candidate[descriptionField] || candidate.summary || candidate.description).slice(0, 240),
    };
  }
  return output;
}

function safeProducts(input) {
  const output = {};
  const entries = Array.isArray(input)
    ? input.map((candidate) => [candidate && candidate.productId, candidate])
    : Object.entries(input || {});
  for (const [rawId, candidate] of entries) {
    const id = safeId(rawId);
    if (
      id !== "spark"
      || !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
      || text(candidate.implementationContract) !== IMPLEMENTED_PRODUCT_CONTRACT
    ) continue;
    const label = text(candidate.name || candidate.label);
    if (!label) continue;
    output[id] = {
      label: label.slice(0, 100),
      summary: text(candidate.description || candidate.summary).slice(0, 240),
      implementationContract: IMPLEMENTED_PRODUCT_CONTRACT,
    };
  }
  return output;
}

function safeAddressModes(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(text))]
    .filter((mode) => mode === "licensed" || mode === "customer_owned")
    .sort();
}

const PRIVATE_PRICE_FIELDS = /^(?:amount|amountMinor|price|priceId|stripePriceId|stripePriceRefs|lineItems|totals)$/iu;

function rejectPrivatePriceAuthority(candidate, path = "catalog") {
  if (!candidate || typeof candidate !== "object") return;
  for (const [key, value] of Object.entries(candidate)) {
    if (PRIVATE_PRICE_FIELDS.test(key)) {
      throw new Error(`${path}.${key} is private server price authority`);
    }
    rejectPrivatePriceAuthority(value, `${path}.${key}`);
  }
}

function safeCatalog(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  rejectPrivatePriceAuthority(source);
  const products = safeProducts(source.products);
  const tenures = safeAxis(source.tenures, "tenureId", "name", "summary");
  const offers = {};
  const offerEntries = Array.isArray(source.offers)
    ? source.offers.map((candidate) => [candidate && candidate.offerId, candidate])
    : Object.entries(source.offers || {});
  for (const [rawId, candidate] of offerEntries) {
    const id = safeId(rawId);
    if (
      !id
      || !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
    ) continue;
    const productId = safeId(candidate.productId);
    const tenureId = safeId(candidate.tenureId);
    const eligibleAddressModes = safeAddressModes(candidate.eligibleAddressModes);
    if (
      !products[productId]
      || !tenures[tenureId]
      || eligibleAddressModes.length === 0
    ) continue;
    offers[id] = {
      productId,
      tenureId,
      eligibleAddressModes,
    };
  }
  return {
    schema: text(source.schema) || null,
    catalogVersion: text(source.catalogVersion || source.revision) || null,
    termsVersion: text(source.termsVersion) || null,
    domainTermsVersion: text(source.domainTermsVersion) || null,
    products,
    tenures,
    offers,
  };
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function configureHostedAbracadabraHtml(sourceHtml, options = {}) {
  const source = String(sourceHtml || "");
  if (!source.includes(APP_SCRIPT)) {
    throw new Error("Abracadabra app script marker is missing");
  }
  if (!source.includes(APP_STYLESHEET)) {
    throw new Error("Abracadabra app stylesheet marker is missing");
  }
  if (!source.includes(HOLD_META)) {
    throw new Error("Abracadabra held-mode marker is missing");
  }
  if ((source.match(new RegExp(APP_SCRIPT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) || []).length !== 1) {
    throw new Error("Abracadabra app script marker must be unique");
  }
  if ((source.match(new RegExp(APP_STYLESHEET.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) || []).length !== 1) {
    throw new Error("Abracadabra app stylesheet marker must be unique");
  }
  if (
    source.includes("abracadabra-hosted-control.js")
    || source.includes("abracadabra-customer-control-dom.js")
  ) {
    throw new Error("Abracadabra source is already configured for a hosted control");
  }
  if ((source.match(new RegExp(HOLD_META, "gu")) || []).length !== 1) {
    throw new Error("Abracadabra held-mode marker must be unique");
  }

  safeCatalog(options.catalog);
  const hostedScripts = [
    '<script src="/abracadabra/app/abracadabra-api.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-hosted-control.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-billing-views.js" defer></script>',
    APP_SCRIPT,
    '<script src="/abracadabra/app/abracadabra-alakazam-35.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-alakazam-50.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-alakazam-retained-premium.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-customer-control-dom.js" defer></script>',
  ].join("\n  ");

  return source
    .replace(HOLD_META, HOSTED_META)
    .replace(
      APP_STYLESHEET,
      `${APP_STYLESHEET}\n  ${ALAKAZAM_35_STYLESHEET}\n  ${ALAKAZAM_50_STYLESHEET}\n  ${ALAKAZAM_RETAINED_PREMIUM_STYLESHEET}`
    )
    .replace(APP_SCRIPT, hostedScripts);
}

export const hostedStagingAssets = Object.freeze([
  "abracadabra/app/abracadabra-alakazam-35.css",
  "abracadabra/app/abracadabra-alakazam-35.js",
  "abracadabra/app/abracadabra-alakazam-50.css",
  "abracadabra/app/abracadabra-alakazam-50.js",
  "abracadabra/app/abracadabra-alakazam-retained-premium.css",
  "abracadabra/app/abracadabra-alakazam-retained-premium.js",
  "abracadabra/app/abracadabra-api.js",
  "abracadabra/app/abracadabra-billing-views.js",
  "abracadabra/app/abracadabra-control-mode.js",
  "abracadabra/app/abracadabra-customer-control-dom.js",
  "abracadabra/app/abracadabra-hosted-control.js",
]);
