const APP_SCRIPT = '<script src="/abracadabra/app/abracadabra-app.js" defer></script>';
const HOSTED_META =
  '<meta name="sitesourcery-abracadabra-control-mode" content="hosted">';

function text(value) {
  return String(value == null ? "" : value).trim();
}

function safeCatalog(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const variants = {};
  for (const [id, candidate] of Object.entries(source.variants || {})) {
    if (
      !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id)
      || !candidate
      || typeof candidate !== "object"
      || Array.isArray(candidate)
    ) continue;
    const label = text(candidate.label);
    const priceId = text(candidate.priceId);
    if (!label || !priceId) continue;
    if (
      Object.hasOwn(candidate, "amount")
      || Object.hasOwn(candidate, "amountMinor")
      || Object.hasOwn(candidate, "currency")
    ) {
      throw new Error("hosted staging catalog accepts provider price IDs, never browser price authority");
    }
    variants[id] = {
      label: label.slice(0, 100),
      priceId: priceId.slice(0, 200),
    };
  }
  return {
    revision: text(source.revision) || null,
    domainTermsVersion: text(source.domainTermsVersion) || null,
    variants,
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
  if (!source.includes('<meta name="theme-color" content="#100b19">')) {
    throw new Error("Abracadabra head configuration marker is missing");
  }
  if ((source.match(new RegExp(APP_SCRIPT.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")) || []).length !== 1) {
    throw new Error("Abracadabra app script marker must be unique");
  }
  if (
    source.includes("sitesourcery-abracadabra-control-mode")
    || source.includes("abracadabra-hosted-control.js")
    || source.includes("abracadabra-hosted-control-dom.js")
  ) {
    throw new Error("Abracadabra source is already configured for a hosted control");
  }

  const catalog = safeCatalog(options.catalog);
  const hostedScripts = [
    '<script src="/abracadabra/app/abracadabra-api.js" defer></script>',
    '<script src="/abracadabra/app/abracadabra-control-mode.js" defer></script>',
    `<script id="abracadabra-hosted-catalog" type="application/json">${scriptJson(catalog)}</script>`,
    '<script src="/abracadabra/app/abracadabra-hosted-control.js" defer></script>',
    APP_SCRIPT,
    '<script src="/abracadabra/app/abracadabra-hosted-control-dom.js" defer></script>',
  ].join("\n  ");

  return source
    .replace(
      '<meta name="theme-color" content="#100b19">',
      '<meta name="theme-color" content="#100b19">\n  ' + HOSTED_META,
    )
    .replace(APP_SCRIPT, hostedScripts);
}

export const hostedStagingAssets = Object.freeze([
  "abracadabra/app/abracadabra-api.js",
  "abracadabra/app/abracadabra-control-mode.js",
  "abracadabra/app/abracadabra-hosted-control-dom.js",
  "abracadabra/app/abracadabra-hosted-control.js",
]);
