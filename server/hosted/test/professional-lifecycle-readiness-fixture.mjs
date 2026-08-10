export const PROFESSIONAL_LIFECYCLE_READY = Object.freeze({
  schema:
    "sitesourcery.professional-lifecycle-production-readiness/v1",
  ready: true,
  mode: "held",
  engagement: "ready",
  professionalReversal: "ready_monotonic_direct_held",
  notifications: "mail_reserved_held",
  mail: "reservation_ready",
  operatorQueue: "bounded_reversal_repair_only",
  accounting: "projection_only",
  sourceAuthoritative: true,
  providerEffects: false,
  automaticRestoration: false,
  genericRepair: false,
  authoritativeAccounting: false,
  code: "READY"
});
