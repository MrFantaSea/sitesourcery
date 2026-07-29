import { ExternalEffectError } from "../errors.mjs";

export function createFakeDomainPorts({
  now = "2026-07-28T16:00:00.000Z",
  priceMinor = 1200
} = {}) {
  let currentNow = now;
  let sequence = 0;
  const calls = {
    ensureContacts: 0,
    preview: 0,
    confirm: 0,
    operation: 0,
    domain: 0,
    authorize: 0,
    void: 0,
    capture: 0,
    refund: 0,
    assessTransfer: 0,
    unlock: 0,
    authCode: 0,
    secretDelivery: 0
  };
  const state = {
    preview: {
      status: "confirmation_required",
      price: { amountMinor: priceMinor, currency: "USD" },
      quoteId: "fake_quote_1"
    },
    confirm: {
      operationId: "fake_registration_operation_1",
      price: { amountMinor: priceMinor, currency: "USD" }
    },
    confirmError: null,
    operation: { status: "success" },
    registrarDomain: null,
    authorizationError: null,
    captureError: null,
    refundError: null,
    transferAssessment: { eligible: true },
    transferError: null,
    onAuthorize: null,
    onConfirm: null,
    onGetDomain: null,
    onCapture: null,
    purposeMismatch: false,
    deliveredSecret: null,
    lastRegistration: null,
    lastAuthorization: null,
    lastCapture: null,
    lastRefund: null
  };

  const ids = {
    async next(prefix) {
      sequence += 1;
      return `${prefix}_${String(sequence).padStart(6, "0")}`;
    }
  };

  const clock = {
    now() {
      return currentNow;
    }
  };

  const registrar = {
    async ensureContacts({ tenantId, customerId, registrantProfileDigest }) {
      calls.ensureContacts += 1;
      const suffix = `${tenantId}_${customerId}_${registrantProfileDigest}`.replace(
        /[^a-zA-Z0-9]/gu,
        ""
      );
      return {
        registrant: `registrant_${suffix}`,
        admin: `admin_${suffix}`,
        tech: `tech_${suffix}`,
        billing: `billing_${suffix}`
      };
    },

    async previewRegistration() {
      calls.preview += 1;
      return structuredClone(state.preview);
    },

    async confirmRegistration(input) {
      calls.confirm += 1;
      state.lastRegistration = structuredClone(input);
      if (state.onConfirm) await state.onConfirm(structuredClone(input));
      if (state.confirmError) throw state.confirmError;
      return structuredClone(state.confirm);
    },

    async getOperation() {
      calls.operation += 1;
      return structuredClone(state.operation);
    },

    async getDomain({ domain }) {
      calls.domain += 1;
      if (state.onGetDomain) await state.onGetDomain({ domain });
      if (state.registrarDomain) return structuredClone(state.registrarDomain);
      return {
        name: domain,
        lifecycleStatus: "registered",
        contacts: {
          registrant: state.lastRegistration?.contacts?.registrant ?? null
        },
        registrationDate: "2026-07-28T16:01:00.000Z",
        expirationDate: "2027-07-28T16:01:00.000Z",
        verificationStatus: "verified"
      };
    },

    async assessTransferOut() {
      calls.assessTransfer += 1;
      return structuredClone(state.transferAssessment);
    },

    async setTransferLock() {
      calls.unlock += 1;
      if (state.transferError) throw state.transferError;
      return { locked: false };
    },

    async getAuthCode() {
      calls.authCode += 1;
      if (state.transferError) throw state.transferError;
      return {
        authCode: "fake-secret-epp-code",
        expiresAt: "2026-07-29T16:00:00.000Z"
      };
    }
  };

  const payments = {
    async authorize(input) {
      calls.authorize += 1;
      state.lastAuthorization = structuredClone({
        ...input,
        paymentMethodRef: "[redacted]"
      });
      if (state.onAuthorize) await state.onAuthorize(structuredClone(input));
      if (state.authorizationError) throw state.authorizationError;
      return {
        status: "authorized",
        authorizationId: "fake_authorization_1",
        amountMinor: input.amountMinor,
        currency: input.currency,
        captureMode: input.captureMode,
        purposeDigest: state.purposeMismatch ? "wrong-purpose" : input.purposeDigest,
        expiresAt: "2026-07-28T17:00:00.000Z"
      };
    },

    async voidAuthorization(input) {
      calls.void += 1;
      return {
        voidId: "fake_void_1",
        purposeDigest: input.purposeDigest
      };
    },

    async capture(input) {
      calls.capture += 1;
      state.lastCapture = structuredClone(input);
      if (state.onCapture) await state.onCapture(structuredClone(input));
      if (state.captureError) throw state.captureError;
      return {
        captureId: "fake_capture_1",
        amountMinor: input.amountMinor,
        currency: input.currency,
        purposeDigest: state.purposeMismatch ? "wrong-purpose" : input.purposeDigest
      };
    },

    async refund(input) {
      calls.refund += 1;
      state.lastRefund = structuredClone(input);
      if (state.refundError) throw state.refundError;
      return {
        refundId: `fake_refund_${calls.refund}`,
        amountMinor: input.amountMinor,
        currency: input.currency,
        purposeDigest: state.purposeMismatch ? "wrong-purpose" : input.purposeDigest
      };
    }
  };

  const secrets = {
    async issueOneTime({ secret }) {
      calls.secretDelivery += 1;
      state.deliveredSecret = secret;
      return { receiptId: `fake_secret_receipt_${calls.secretDelivery}` };
    }
  };

  const controls = Object.freeze({
    setNow(value) {
      currentNow = value;
    },
    setPreview(value) {
      state.preview = structuredClone(value);
    },
    setConfirm(value) {
      state.confirm = structuredClone(value);
      state.confirmError = null;
    },
    setConfirmError(error) {
      state.confirmError = error;
    },
    setOperation(value) {
      state.operation = structuredClone(value);
    },
    setRegistrarDomain(value) {
      state.registrarDomain = structuredClone(value);
    },
    setAuthorizationError(error) {
      state.authorizationError = error;
    },
    onAuthorize(callback) {
      state.onAuthorize = callback;
    },
    onConfirm(callback) {
      state.onConfirm = callback;
    },
    onGetDomain(callback) {
      state.onGetDomain = callback;
    },
    onCapture(callback) {
      state.onCapture = callback;
    },
    setCaptureError(error) {
      state.captureError = error;
    },
    setRefundError(error) {
      state.refundError = error;
    },
    setPurposeMismatch(value = true) {
      state.purposeMismatch = value;
    },
    setTransferAssessment(value) {
      state.transferAssessment = structuredClone(value);
    },
    setTransferError(error) {
      state.transferError = error;
    }
  });

  return Object.freeze({
    registrar,
    payments,
    secrets,
    clock,
    ids,
    calls,
    state,
    controls
  });
}

export function ambiguousFakeEffect(message = "simulated ambiguous provider result") {
  return new ExternalEffectError("fake_ambiguous", message, { certainty: "ambiguous" });
}

export function notSubmittedFakeEffect(message = "simulated authoritative rejection") {
  return new ExternalEffectError("fake_not_submitted", message, {
    certainty: "not_submitted"
  });
}
