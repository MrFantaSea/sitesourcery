# STRIPE-SLICES-01 wiring notes

This packet makes Stripe provider readiness purpose-aware without enabling a
payment purpose, changing credentials, calling Stripe, or changing the existing
global readiness contract.

- `readinessForPurpose(purpose)` accepts only the eight exact purpose names in
  `STRIPE_READINESS_PURPOSES`.
- Download readiness proves its webhook ingress contract and purpose-bound tax
  authority without reading Alakazam Products, Prices, Coupon, Portal,
  Subscriptions, or Schedules.
- The Download service requires this exact purpose readiness port. A generic
  readiness result can no longer accidentally satisfy its release gate.
- Alakazam purpose readiness still requires the complete Product/Price/Coupon/
  Portal readback. Domain readiness remains separate from webhook and hosted
  payment dependencies.
- Existing `readiness()` remains the full configured-provider reconciliation
  used by legacy callers. Subsequent purpose release packets should move their
  own service boundary to `readinessForPurpose` before being enabled.

All release controls, purpose modes, provider effects, and live configuration
remain held. This packet performs no provider or production action.
