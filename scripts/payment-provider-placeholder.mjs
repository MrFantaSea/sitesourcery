/*
 * Deliberately source-only payment seam.
 *
 * The public site has no checkout control and this module is excluded from the
 * built artifact. A real provider adapter must replace this exact null slot in
 * a separately reviewed release; no page may infer payment capability from
 * the existence of this record.
 */
export const PAYMENT_PROVIDER_SLOT = Object.freeze({
  schema: "sitesourcery.payment-provider-slot.v1",
  provider: null,
  adapter: null,
  checkout: null,
  liveMode: false,
});
