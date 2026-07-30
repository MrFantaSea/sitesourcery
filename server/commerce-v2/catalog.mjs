import {
  CATALOG_VERSION,
  LEGACY_TENURE_IDS,
  OFFER_DEFINITIONS,
  OFFER_IDS,
  PRIVATE_CATALOG_SCHEMA,
  TERMS_VERSION
} from "./constants.mjs";
import {
  clone,
  deepFreeze,
  invariant,
  requiredText
} from "./canonical.mjs";

const catalog = deepFreeze({
  schema: PRIVATE_CATALOG_SCHEMA,
  catalogVersion: CATALOG_VERSION,
  termsVersion: TERMS_VERSION,
  visibility: "private",
  state: "held",
  productContract: "abracadabra.spark/v1",
  providerEffectsAuthorized: false,
  offers: OFFER_IDS.map((offerId) =>
    clone(OFFER_DEFINITIONS[offerId])
  )
});

export function getPrivateHeldCatalog() {
  return deepFreeze(clone(catalog));
}

export function resolveHeldOffer(offerId) {
  const selectedId = requiredText(offerId, "offerId", 100);
  invariant(
    !LEGACY_TENURE_IDS.includes(selectedId) &&
      !selectedId.startsWith("spark."),
    "legacy_tenure_rejected",
    "v1 tenure identifiers are not valid v2 offers",
    { status: 400 }
  );
  const offer = OFFER_DEFINITIONS[selectedId];
  invariant(
    Boolean(offer),
    "offer_unavailable",
    "the private v2 offer is unavailable",
    { status: 404 }
  );
  return deepFreeze(clone(offer));
}
