export const ORDER_STATES = Object.freeze({
  CREATED: "created",
  AGENCY_CONSENTED: "agency_consented",
  FINAL_QUOTED: "final_quoted",
  QUOTE_ACCEPTED: "quote_accepted",
  PAYMENT_AUTHORIZING: "payment_authorizing",
  PAYMENT_AUTHORIZED: "payment_authorized",
  READY_TO_CONFIRM: "ready_to_confirm",
  REQUOTE_REQUIRED: "requote_required",
  CONFIRM_DISPATCHING: "confirm_dispatching",
  CONFIRM_UNKNOWN: "confirm_unknown",
  REGISTRATION_PENDING: "registration_pending",
  REGISTRATION_PENDING_REVIEW: "registration_pending_review",
  REGISTRATION_FAILED_REVIEW: "registration_failed_review",
  ACTIVE_PAYMENT_PENDING: "active_payment_pending",
  ACTIVE: "active",
  ACTIVE_RECONCILIATION: "active_reconciliation",
  ACTIVE_PAYMENT_REVIEW: "active_payment_review",
  PAYMENT_VOID_REVIEW: "payment_void_review",
  REFUND_DISPATCHING: "refund_dispatching",
  REFUND_UNKNOWN: "refund_unknown",
  TRANSFER_DISPATCHING: "transfer_dispatching",
  TRANSFER_READY: "transfer_ready",
  TRANSFER_REVIEW: "transfer_review",
  TRANSFERRED_OUT: "transferred_out"
});

export const REQUIRED_AGREEMENTS = Object.freeze([
  "agency_authorization",
  "spaceship_disclosure",
  "customer_is_registrant",
  "irreversible_registration",
  "domain_price",
  "privacy_processing",
  "transfer_rights"
]);

export const PROVIDER_FACTS = Object.freeze({
  asOf: "2026-07-28",
  provider: "spaceship",
  registrarOfRecord: "Spaceship, Inc.",
  atomicRegistrationMaximumPriceDocumented: false,
  registrationIdempotencyKeyDocumented: false,
  standardRenewalPreviewDocumented: false,
  customerPortfolioSubaccountsDocumented: false,
  registrationConfirmIrreversible: true,
  registrationConfirmMayLackPrice: true,
  sharedProviderAccountBlastRadius: true
});
