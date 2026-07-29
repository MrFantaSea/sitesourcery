import { digest, exactMoney, hashSecret, iso, normalizeDomain, requiredInteger, requiredString, sameMoney } from "./canonical.mjs";
import { ORDER_STATES, PROVIDER_FACTS, REQUIRED_AGREEMENTS } from "./constants.mjs";
import { DomainError, ExternalEffectError, fail, invariant } from "./errors.mjs";
import { validatePorts } from "./ports.mjs";

const DEFAULTS = Object.freeze({
  quoteTtlMs: 5 * 60 * 1000,
  minimumAuthorizationRemainingMs: 15 * 60 * 1000,
  serviceFeeMinor: 0,
  mutationMode: "held",
  registrarDisplayName: PROVIDER_FACTS.registrarOfRecord
});

export function createDomainOrchestrator({ ports, config = {} } = {}) {
  return new DomainOrchestrator(validatePorts(ports), { ...DEFAULTS, ...config });
}

export class DomainOrchestrator {
  constructor(ports, config) {
    this.ports = ports;
    this.config = validateConfig(config);
  }

  async createOrder(input) {
    return this.#command(input, "createOrder", async (command) => {
      const auth = requireCustomer(input);
      const now = this.#now();
      const order = {
        schemaVersion: 1,
        id: await this.ports.ids.next("domain_order"),
        version: 1,
        tenantId: auth.tenantId,
        customerId: auth.customerId,
        projectId: requiredString(input.projectId, "projectId", 128),
        domain: normalizeDomain(input.domain),
        years: requiredInteger(input.years ?? 1, "years", { minimum: 1, maximum: 10 }),
        state: ORDER_STATES.CREATED,
        createdAt: now,
        updatedAt: now,
        registrar: {
          provider: "spaceship",
          registrarOfRecord: this.config.registrarDisplayName,
          customerIsRegistrant: true,
          siteSourceryRole: "authorized_agent_and_account_operator",
          contactIds: null
        },
        consent: null,
        quote: null,
        acceptedQuote: null,
        payment: null,
        registration: {
          status: "not_started",
          attemptId: null,
          operationId: null,
          providerPrice: null,
          registrationDate: null,
          expirationDate: null,
          verificationStatus: null
        },
        renewal: {
          status: "idle",
          requestedAt: null,
          reviewReason: null
        },
        transfer: {
          status: "not_requested",
          authCodeDigest: null,
          authCodeExpiresAt: null,
          deliveryReceiptId: null
        },
        refund: {
          status: "none",
          refundedAmountMinor: 0,
          refundId: null
        },
        review: null
      };
      const audit = await this.#event(order, "domain.order.created", {
        actorId: auth.actorId,
        projectId: order.projectId
      });
      const result = publicOrder(order);
      await this.ports.repository.createOrder({
        order,
        audit,
        outbox: outboxFrom(audit),
        command: completedCommand(command, result)
      });
      return result;
    });
  }

  async recordAgencyConsent(input) {
    return this.#orderCommand(input, "recordAgencyConsent", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.CREATED, ORDER_STATES.AGENCY_CONSENTED]);
      const agreements = validateAgreements(input.agreements);
      order.consent = {
        evidenceId: requiredString(input.consentEvidenceId, "consentEvidenceId", 128),
        actorCustomerId: auth.customerId,
        actorSessionId: requiredString(input.actorSessionId, "actorSessionId", 128),
        ipHash: requiredString(input.ipHash, "ipHash", 128),
        userAgentHash: requiredString(input.userAgentHash, "userAgentHash", 128),
        registrantProfileRef: requiredString(
          input.registrantProfileRef,
          "registrantProfileRef",
          256
        ),
        registrantProfileDigest: requiredString(
          input.registrantProfileDigest,
          "registrantProfileDigest",
          128
        ),
        registrarDisclosed: this.config.registrarDisplayName,
        agreements,
        recordedAt: this.#now()
      };
      order.quote = null;
      order.acceptedQuote = null;
      order.state = ORDER_STATES.AGENCY_CONSENTED;
      return this.#save(order, command, "domain.agency.consent_recorded", {
        actorId: auth.actorId,
        evidenceId: order.consent.evidenceId,
        agreementKeys: agreements.map(({ key }) => key)
      });
    });
  }

  async prepareQuote(input) {
    return this.#orderCommand(input, "prepareQuote", async (order, command, auth) => {
      requireState(order, [
        ORDER_STATES.AGENCY_CONSENTED,
        ORDER_STATES.REQUOTE_REQUIRED,
        ORDER_STATES.FINAL_QUOTED
      ]);
      invariant(order.consent, "consent_required", "agency consent is required");
      const contactIds = await this.ports.registrar.ensureContacts({
        tenantId: order.tenantId,
        customerId: order.customerId,
        domain: order.domain,
        registrantProfileRef: order.consent.registrantProfileRef,
        registrantProfileDigest: order.consent.registrantProfileDigest,
        consentEvidenceId: order.consent.evidenceId,
        customerIsRegistrant: true
      });
      validateContactIds(contactIds);
      const preview = await this.ports.registrar.previewRegistration({
        tenantId: order.tenantId,
        domain: order.domain,
        years: order.years,
        autoRenew: false,
        privacy: { level: "high", userConsent: true },
        contacts: contactIds
      });
      invariant(
        preview?.status === "confirmation_required",
        "unsafe_registrar_preview",
        "registrar did not return a no-charge confirmation preview"
      );
      const price = exactMoney(preview.price, "registration preview");
      const now = this.#now();
      order.registrar.contactIds = structuredClone(contactIds);
      order.quote = {
        observedAt: now,
        expiresAt: addMs(now, this.config.quoteTtlMs),
        price,
        quoteId: preview.quoteId ?? null,
        providerDoesNotReservePrice: true
      };
      order.acceptedQuote = null;
      order.state = ORDER_STATES.FINAL_QUOTED;
      return this.#save(order, command, "domain.quote.prepared", {
        actorId: auth.actorId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        expiresAt: order.quote.expiresAt
      });
    });
  }

  async acceptQuote(input) {
    return this.#orderCommand(input, "acceptQuote", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.FINAL_QUOTED]);
      requireFresh(order.quote, this.#now());
      const acceptedAmountMinor = requiredInteger(input.acceptedAmountMinor, "acceptedAmountMinor");
      invariant(
        acceptedAmountMinor === order.quote.price.amountMinor,
        "price_mismatch",
        "accepted amount does not match the current registrar preview"
      );
      order.acceptedQuote = {
        registrarPrice: structuredClone(order.quote.price),
        serviceFeeMinor: this.config.serviceFeeMinor,
        total: {
          amountMinor: order.quote.price.amountMinor + this.config.serviceFeeMinor,
          currency: "USD"
        },
        acceptedAt: this.#now(),
        actorCustomerId: auth.customerId,
        evidenceId: requiredString(input.priceConsentEvidenceId, "priceConsentEvidenceId", 128)
      };
      order.state = ORDER_STATES.QUOTE_ACCEPTED;
      return this.#save(order, command, "domain.quote.accepted", {
        actorId: auth.actorId,
        amountMinor: acceptedAmountMinor,
        serviceFeeMinor: this.config.serviceFeeMinor,
        evidenceId: order.acceptedQuote.evidenceId
      });
    });
  }

  async authorizePayment(input) {
    return this.#orderCommand(input, "authorizePayment", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.QUOTE_ACCEPTED]);
      requireFresh(order.quote, this.#now());
      const purpose = paymentPurpose(order, "domain_registration");
      const purposeDigest = digest(purpose);
      const expected = order.acceptedQuote.total;
      const paymentMethodRef = requiredString(input.paymentMethodRef, "paymentMethodRef", 256);
      order.state = ORDER_STATES.PAYMENT_AUTHORIZING;
      order.payment = {
        status: "authorizing",
        amount: structuredClone(expected),
        purposeDigest,
        authorizationId: null,
        authorizedAt: null,
        expiresAt: null,
        captureId: null,
        capturedAmount: null
      };
      order = await this.#save(
        order,
        command,
        "domain.payment.authorizing",
        { actorId: auth.actorId, amountMinor: expected.amountMinor, purposeDigest },
        { complete: false, returnInternal: true }
      );
      let authorization;
      try {
        authorization = await this.ports.payments.authorize({
          tenantId: order.tenantId,
          customerId: order.customerId,
          orderId: order.id,
          amountMinor: expected.amountMinor,
          currency: expected.currency,
          paymentMethodRef,
          captureMode: "manual",
          purpose,
          purposeDigest,
          idempotencyKey: `domain-auth:${order.tenantId}:${order.id}:${command.commandId}`
        });
        validateAuthorization(authorization, expected, purposeDigest, this.#now(), this.config);
      } catch {
        order.state = ORDER_STATES.PAYMENT_VOID_REVIEW;
        order.payment.status = "authorization_unknown";
        order.review = {
          reason: "payment_authorization_failed_or_ambiguous",
          openedAt: this.#now(),
          instruction:
            "Reconcile the idempotent payment authorization before issuing another authorization."
        };
        return this.#save(order, command, "domain.payment.authorization_review", {
          actorId: auth.actorId,
          purposeDigest,
          noAutomaticRetry: true
        });
      }
      order.payment = {
        status: "authorized",
        authorizationId: authorization.authorizationId,
        amount: structuredClone(expected),
        purposeDigest,
        authorizedAt: this.#now(),
        expiresAt: authorization.expiresAt,
        captureId: null,
        capturedAmount: null
      };
      order.state = ORDER_STATES.PAYMENT_AUTHORIZED;
      return this.#save(order, command, "domain.payment.authorized", {
        actorId: auth.actorId,
        amountMinor: expected.amountMinor,
        purposeDigest
      });
    });
  }

  async revalidateBeforeConfirm(input) {
    return this.#orderCommand(input, "revalidateBeforeConfirm", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.PAYMENT_AUTHORIZED]);
      requireAuthorizationFresh(order.payment, this.#now(), this.config);
      const preview = await this.ports.registrar.previewRegistration({
        tenantId: order.tenantId,
        domain: order.domain,
        years: order.years,
        autoRenew: false,
        privacy: { level: "high", userConsent: true },
        contacts: order.registrar.contactIds
      });
      if (
        preview?.status !== "confirmation_required" ||
        !preview.price ||
        preview.price.currency !== "USD" ||
        !Number.isSafeInteger(preview.price.amountMinor)
      ) {
        return this.#voidAndRequote(
          order,
          command,
          auth,
          null,
          "registration_price_unavailable_on_revalidation"
        );
      }
      const price = exactMoney(preview.price, "registration revalidation");
      if (!sameMoney(price, order.acceptedQuote.registrarPrice)) {
        return this.#voidAndRequote(
          order,
          command,
          auth,
          preview,
          "registration_price_changed_before_confirmation"
        );
      }
      const now = this.#now();
      order.quote = {
        observedAt: now,
        expiresAt: addMs(now, this.config.quoteTtlMs),
        price,
        quoteId: preview.quoteId ?? null,
        providerDoesNotReservePrice: true
      };
      order.state = ORDER_STATES.READY_TO_CONFIRM;
      return this.#save(order, command, "domain.registration.revalidated", {
        actorId: auth.actorId,
        amountMinor: price.amountMinor
      });
    });
  }

  async submitRegistration(input) {
    return this.#orderCommand(input, "submitRegistration", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.READY_TO_CONFIRM]);
      requireFresh(order.quote, this.#now());
      requireAuthorizationFresh(order.payment, this.#now(), this.config);
      requireExecutionApproval(input.executionApproval, order, this.config, "domain_registration");

      const attemptId = await this.ports.ids.next("registration_attempt");
      order.state = ORDER_STATES.CONFIRM_DISPATCHING;
      order.registration.status = "dispatching";
      order.registration.attemptId = attemptId;
      order = await this.#save(
        order,
        command,
        "domain.registration.dispatching",
        {
          actorId: auth.actorId,
          attemptId,
          expectedAmountMinor: order.quote.price.amountMinor
        },
        { complete: false, returnInternal: true }
      );

      let response;
      try {
        response = await this.ports.registrar.confirmRegistration({
          tenantId: order.tenantId,
          attemptId,
          domain: order.domain,
          years: order.years,
          autoRenew: false,
          privacy: { level: "high", userConsent: true },
          contacts: order.registrar.contactIds,
          expectedPrice: order.quote.price
        });
      } catch (error) {
        if (
          error instanceof ExternalEffectError &&
          error.certainty === "not_submitted"
        ) {
          const voided = await this.#tryVoid(order, "registration_not_submitted");
          order.state = voided ? ORDER_STATES.REQUOTE_REQUIRED : ORDER_STATES.PAYMENT_VOID_REVIEW;
          order.registration.status = "not_submitted";
          order.review = {
            reason: voided ? "registrar_rejected_before_submission" : "authorization_void_unknown",
            openedAt: this.#now(),
            instruction: voided
              ? "Request a fresh quote before any new attempt."
              : "Reconcile payment authorization before any new registration attempt."
          };
          return this.#save(order, command, "domain.registration.not_submitted", {
            actorId: auth.actorId,
            attemptId,
            providerCode: error.code,
            authorizationVoided: voided
          });
        }
        order.state = ORDER_STATES.CONFIRM_UNKNOWN;
        order.registration.status = "unknown";
        order.review = {
          reason: "ambiguous_irreversible_confirmation",
          openedAt: this.#now(),
          instruction:
            "Do not retry. Reconcile the registrar portfolio, registrant contacts, and registrar billing before payment capture or void."
        };
        return this.#save(order, command, "domain.registration.unknown", {
          actorId: auth.actorId,
          attemptId,
          noAutomaticRetry: true
        });
      }

      if (typeof response?.operationId !== "string" || !response.operationId) {
        order.state = ORDER_STATES.CONFIRM_UNKNOWN;
        order.registration.status = "unknown";
        order.review = {
          reason: "confirmation_missing_operation_id",
          openedAt: this.#now(),
          instruction: "Do not retry the billed confirmation."
        };
        return this.#save(order, command, "domain.registration.unknown", {
          actorId: auth.actorId,
          attemptId,
          noAutomaticRetry: true
        });
      }

      order.registration.operationId = response.operationId;
      order.registration.status = "pending";
      order.registration.providerPrice = hasExactMoney(response.price)
        ? exactMoney(response.price, "provider confirmation price")
        : null;
      const exactMatch = sameMoney(
        order.registration.providerPrice,
        order.acceptedQuote.registrarPrice
      );
      order.state = exactMatch
        ? ORDER_STATES.REGISTRATION_PENDING
        : ORDER_STATES.REGISTRATION_PENDING_REVIEW;
      order.review = exactMatch
        ? null
        : {
            reason: "provider_price_unavailable_or_changed_at_irreversible_confirm",
            openedAt: this.#now(),
            instruction: "Do not capture until the registrar charge is known."
          };
      return this.#save(order, command, "domain.registration.submitted", {
        actorId: auth.actorId,
        attemptId,
        operationId: response.operationId,
        exactProviderPrice: exactMatch
      });
    });
  }

  async pollRegistration(input) {
    return this.#orderCommand(input, "pollRegistration", async (order, command, auth) => {
      requireState(order, [
        ORDER_STATES.REGISTRATION_PENDING,
        ORDER_STATES.REGISTRATION_PENDING_REVIEW
      ]);
      const operation = await this.ports.registrar.getOperation({
        tenantId: order.tenantId,
        operationId: order.registration.operationId
      });
      invariant(
        ["pending", "success", "failed"].includes(operation?.status),
        "invalid_provider_response",
        "registrar returned an unknown operation status"
      );
      if (operation.status === "pending") {
        return this.#save(order, command, "domain.registration.polled", {
          actorId: auth.actorId,
          status: "pending"
        });
      }
      if (operation.status === "failed") {
        order.state = ORDER_STATES.REGISTRATION_FAILED_REVIEW;
        order.registration.status = "failed";
        order.review = {
          reason: "async_registration_failed_billing_unknown",
          openedAt: this.#now(),
          instruction:
            "Reconcile registrar billing and portfolio before voiding the customer authorization."
        };
        return this.#save(order, command, "domain.registration.failed_review", {
          actorId: auth.actorId,
          operationId: order.registration.operationId
        });
      }

      order.state = ORDER_STATES.ACTIVE_PAYMENT_PENDING;
      order.registration.status = "success";
      order = await this.#save(
        order,
        command,
        "domain.registration.verification_pending",
        {
          actorId: auth.actorId,
          operationId: order.registration.operationId,
          captureStarted: false
        },
        { complete: false, returnInternal: true }
      );
      let domain;
      try {
        domain = await this.ports.registrar.getDomain({
          tenantId: order.tenantId,
          domain: order.domain
        });
      } catch {
        order.state = ORDER_STATES.ACTIVE_PAYMENT_REVIEW;
        order.review = {
          reason: "registered_domain_readback_unavailable",
          openedAt: this.#now(),
          instruction:
            "Do not capture. Reconcile the registered domain and customer contact mapping."
        };
        return this.#save(order, command, "domain.registration.active_review", {
          actorId: auth.actorId,
          readbackAvailable: false,
          captureStarted: false
        });
      }
      if (
        domain?.name?.toLowerCase() !== order.domain ||
        domain.lifecycleStatus !== "registered" ||
        domain.contacts?.registrant !== order.registrar.contactIds.registrant
      ) {
        order.state = ORDER_STATES.ACTIVE_PAYMENT_REVIEW;
        order.review = {
          reason: "customer_registrant_mapping_not_verified",
          openedAt: this.#now(),
          instruction:
            "Do not capture. Reconcile the registrar contact mapping and protect the customer's claim."
        };
        return this.#save(order, command, "domain.registration.active_review", {
          actorId: auth.actorId,
          registrantVerified: false
        });
      }
      order.registration.registrationDate = domain.registrationDate ?? null;
      order.registration.expirationDate = domain.expirationDate ?? null;
      order.registration.verificationStatus = domain.verificationStatus ?? null;

      if (!order.registration.providerPrice) {
        order.state = ORDER_STATES.ACTIVE_PAYMENT_REVIEW;
        order.review = {
          reason: "active_domain_provider_charge_unknown",
          openedAt: this.#now(),
          instruction: "Verify the registrar charge before customer capture."
        };
        return this.#save(order, command, "domain.registration.active_review", {
          actorId: auth.actorId,
          registrantVerified: true,
          providerPriceKnown: false
        });
      }

      const approved = order.acceptedQuote.registrarPrice.amountMinor;
      const provider = order.registration.providerPrice.amountMinor;
      const captureAmountMinor = Math.min(approved, provider) + this.config.serviceFeeMinor;
      try {
        const capture = await this.ports.payments.capture({
          tenantId: order.tenantId,
          authorizationId: order.payment.authorizationId,
          amountMinor: captureAmountMinor,
          currency: "USD",
          purposeDigest: order.payment.purposeDigest,
          idempotencyKey:
            `domain-capture:${order.tenantId}:${order.id}:${order.registration.operationId}`
        });
        validateCapture(capture, captureAmountMinor, order.payment.purposeDigest);
        order.payment.status = "captured";
        order.payment.captureId = capture.captureId;
        order.payment.capturedAmount = { amountMinor: captureAmountMinor, currency: "USD" };
      } catch {
        order.state = ORDER_STATES.ACTIVE_PAYMENT_REVIEW;
        order.review = {
          reason: "domain_active_customer_capture_failed_or_ambiguous",
          openedAt: this.#now(),
          instruction:
            "Reconcile the idempotent payment capture. Never delete or transfer the customer's domain as recovery."
        };
        return this.#save(order, command, "domain.payment.capture_review", {
          actorId: auth.actorId,
          domainRemainsCustomerOwned: true
        });
      }

      order.state =
        provider === approved ? ORDER_STATES.ACTIVE : ORDER_STATES.ACTIVE_RECONCILIATION;
      order.review =
        provider === approved
          ? null
          : {
              reason: "registrar_price_race_absorbed_or_customer_capture_reduced",
              openedAt: this.#now(),
              customerMustNotBeSurcharged: true
            };
      return this.#save(order, command, "domain.registration.active", {
        actorId: auth.actorId,
        registrantVerified: true,
        capturedAmountMinor: captureAmountMinor,
        providerAmountMinor: provider
      });
    });
  }

  async requestRenewalReview(input) {
    return this.#orderCommand(input, "requestRenewalReview", async (order, command, auth) => {
      requireActive(order);
      order.renewal = {
        status: "manual_review",
        requestedAt: this.#now(),
        reviewReason: "standard_renewal_price_preview_not_publicly_documented"
      };
      order.review = {
        reason: "manual_fail_closed_renewal",
        openedAt: this.#now(),
        instruction:
          "Do not call a billed renewal endpoint. Obtain an exact no-charge quote contract, fresh customer consent, and payment authorization first."
      };
      return this.#save(order, command, "domain.renewal.manual_review_requested", {
        actorId: auth.actorId,
        expirationDate: order.registration.expirationDate,
        billedRenewalSubmitted: false
      });
    });
  }

  async refundPayment(input) {
    return this.#orderCommand(
      input,
      "refundPayment",
      async (order, command, auth) => {
        requireOperator(auth, "domain_refund_operator");
        requireActive(order);
        invariant(order.payment?.status === "captured", "nothing_to_refund", "payment is not captured");
        const amountMinor = requiredInteger(input.amountMinor, "amountMinor", { minimum: 1 });
        const reason = requiredString(input.reason, "reason", 256);
        const operatorEvidenceId = requiredString(
          input.operatorEvidenceId,
          "operatorEvidenceId",
          256
        );
        const captured = order.payment.capturedAmount.amountMinor;
        invariant(
          amountMinor <= captured - order.refund.refundedAmountMinor,
          "refund_too_large",
          "refund exceeds the remaining captured amount"
        );
        const priorState = order.state;
        order.state = ORDER_STATES.REFUND_DISPATCHING;
        order.refund.status = "dispatching";
        order.refund.priorState = priorState;
        order = await this.#save(
          order,
          command,
          "domain.refund.dispatching",
          { actorId: auth.actorId, amountMinor },
          { complete: false, returnInternal: true }
        );

        let result;
        try {
          result = await this.ports.payments.refund({
            tenantId: order.tenantId,
            captureId: order.payment.captureId,
            amountMinor,
            currency: "USD",
            purposeDigest: order.payment.purposeDigest,
            reason,
            operatorEvidenceId,
            idempotencyKey:
              `domain-refund:${order.tenantId}:${order.id}:${command.commandId}`
          });
          validateRefund(result, amountMinor, order.payment.purposeDigest);
        } catch (error) {
          if (
            error instanceof ExternalEffectError &&
            error.certainty === "not_submitted"
          ) {
            order.state = priorState;
            order.refund.status = "not_submitted";
            order.review = {
              reason: "refund_not_submitted",
              openedAt: this.#now(),
              instruction: "A new reviewed refund command may be issued."
            };
          } else {
            order.state = ORDER_STATES.REFUND_UNKNOWN;
            order.refund.status = "unknown";
            order.review = {
              reason: "refund_effect_ambiguous",
              openedAt: this.#now(),
              instruction: "Reconcile the payment provider. Do not blindly retry."
            };
          }
          return this.#save(order, command, "domain.refund.review", {
            actorId: auth.actorId,
            amountMinor,
            noAutomaticRetry: order.state === ORDER_STATES.REFUND_UNKNOWN
          });
        }
        order.refund.status = "settled";
        order.refund.refundId = result.refundId;
        order.refund.refundedAmountMinor += amountMinor;
        order.state =
          priorState === ORDER_STATES.ACTIVE_PAYMENT_REVIEW
            ? ORDER_STATES.ACTIVE_PAYMENT_REVIEW
            : ORDER_STATES.ACTIVE_RECONCILIATION;
        order.review = {
          reason: "customer_payment_refunded_domain_remains_customer_owned",
          openedAt: this.#now(),
          domainRemainsCustomerOwned: true
        };
        return this.#save(order, command, "domain.refund.settled", {
          actorId: auth.actorId,
          amountMinor,
          operatorEvidenceId,
          domainRemainsCustomerOwned: true
        });
      },
      { customerOnly: false }
    );
  }

  async requestTransferOut(input) {
    return this.#orderCommand(input, "requestTransferOut", async (order, command, auth) => {
      requireActive(order);
      requiredString(input.transferConsentEvidenceId, "transferConsentEvidenceId", 256);
      const assessment = await this.ports.registrar.assessTransferOut({
        tenantId: order.tenantId,
        domain: order.domain,
        registrationDate: order.registration.registrationDate
      });
      invariant(
        assessment?.eligible === true,
        "transfer_not_eligible",
        "registrar or registry rules currently block transfer-out",
        { details: { reason: assessment?.reason ?? "unknown" } }
      );
      order.state = ORDER_STATES.TRANSFER_DISPATCHING;
      order.transfer.status = "dispatching";
      order.transfer.requestedAt = this.#now();
      order.transfer.consentEvidenceId = input.transferConsentEvidenceId;
      order = await this.#save(
        order,
        command,
        "domain.transfer.dispatching",
        { actorId: auth.actorId },
        { complete: false, returnInternal: true }
      );
      try {
        await this.ports.registrar.setTransferLock({
          tenantId: order.tenantId,
          domain: order.domain,
          locked: false
        });
        const response = await this.ports.registrar.getAuthCode({
          tenantId: order.tenantId,
          domain: order.domain
        });
        const authCode = requiredString(response.authCode, "authCode", 256);
        const expiresAt = iso(response.expiresAt, "authCodeExpiresAt");
        const delivery = await this.ports.secrets.issueOneTime({
          tenantId: order.tenantId,
          customerId: order.customerId,
          secret: authCode,
          purpose: "domain_transfer_auth_code",
          expiresAt
        });
        order.transfer.status = "ready";
        order.transfer.authCodeDigest = hashSecret(authCode);
        order.transfer.authCodeExpiresAt = expiresAt;
        order.transfer.deliveryReceiptId = requiredString(
          delivery.receiptId,
          "deliveryReceiptId",
          256
        );
        order.state = ORDER_STATES.TRANSFER_READY;
        order.review = null;
        return this.#save(order, command, "domain.transfer.ready", {
          actorId: auth.actorId,
          authCodeExpiresAt: expiresAt,
          rawAuthCodeStored: false,
          deliveredThroughOneTimeSecretPort: true
        });
      } catch {
        order.state = ORDER_STATES.TRANSFER_REVIEW;
        order.transfer.status = "manual_review";
        order.review = {
          reason: "transfer_unlock_or_secret_delivery_failed",
          openedAt: this.#now(),
          instruction:
            "Inspect the transfer lock and one-time delivery receipt before retrying any registrar mutation."
        };
        return this.#save(order, command, "domain.transfer.review", {
          actorId: auth.actorId,
          rawAuthCodeStored: false
        });
      }
    });
  }

  async exportCustody(input) {
    const auth = requireCustomer(input);
    const order = await this.#ownedOrder(auth, requiredString(input.orderId, "orderId", 128));
    const audit = await this.ports.repository.listAudit({
      tenantId: auth.tenantId,
      orderId: order.id
    });
    return custodyExport(order, audit);
  }

  async getOrder(input) {
    const auth = requireCustomer(input);
    return publicOrder(
      await this.#ownedOrder(auth, requiredString(input.orderId, "orderId", 128))
    );
  }

  async listOutbox(input) {
    const auth = requireAuth(input);
    requireOperator(auth, "domain_audit_operator");
    return this.ports.repository.listOutbox({ tenantId: auth.tenantId });
  }

  async #orderCommand(input, operation, handler, { customerOnly = true } = {}) {
    return this.#command(input, operation, async (command) => {
      const auth = customerOnly ? requireCustomer(input) : requireAuth(input);
      const order = await this.#ownedOrder(
        auth,
        requiredString(input.orderId, "orderId", 128),
        { requireCustomerOwnership: customerOnly }
      );
      return handler(structuredClone(order), command, auth);
    });
  }

  async #command(input, operation, handler) {
    const auth = requireAuth(input);
    const commandId = requiredString(input.commandId, "commandId", 128);
    const fingerprint = digest({
      operation,
      tenantId: auth.tenantId,
      actorId: auth.actorId,
      input: { ...input, commandId: undefined }
    });
    const command = { tenantId: auth.tenantId, commandId, operation, fingerprint };
    const claim = await this.ports.repository.claimCommand(command);
    if (claim.status === "conflict") {
      fail("idempotency_conflict", "command ID was reused with different input");
    }
    if (claim.status === "pending") {
      fail(
        "command_in_progress",
        "command is already in progress; external effects must not be repeated"
      );
    }
    if (claim.status === "replay") {
      if (claim.result?.error) throw restoreError(claim.result.error);
      return structuredClone(claim.result.value);
    }
    try {
      return await handler(command);
    } catch (error) {
      await this.ports.repository.finishCommand({
        ...command,
        result: { error: serializeError(error) }
      });
      throw error;
    }
  }

  async #ownedOrder(auth, orderId, { requireCustomerOwnership = true } = {}) {
    const order = await this.ports.repository.getOrder({
      tenantId: auth.tenantId,
      orderId
    });
    invariant(order, "order_not_found", "domain order not found", { status: 404 });
    if (requireCustomerOwnership) {
      invariant(
        order.customerId === auth.customerId,
        "order_not_found",
        "domain order not found",
        { status: 404 }
      );
    }
    return order;
  }

  async #save(
    order,
    command,
    type,
    detail,
    { complete = true, returnInternal = false } = {}
  ) {
    const expectedVersion = order.version;
    order.version += 1;
    order.updatedAt = this.#now();
    const audit = await this.#event(order, type, detail);
    const result = publicOrder(order);
    const committed = await this.ports.repository.commit({
      tenantId: order.tenantId,
      orderId: order.id,
      expectedVersion,
      order,
      audit,
      outbox: outboxFrom(audit),
      command: complete ? completedCommand(command, result) : null
    });
    invariant(committed, "concurrent_transition", "order changed concurrently; nothing applied");
    return returnInternal ? structuredClone(order) : result;
  }

  async #event(order, type, detail) {
    return {
      eventId: await this.ports.ids.next("domain_event"),
      tenantId: order.tenantId,
      orderId: order.id,
      orderVersion: order.version,
      type,
      occurredAt: this.#now(),
      detail: structuredClone(detail)
    };
  }

  async #voidAndRequote(order, command, auth, preview, reason) {
    const voided = await this.#tryVoid(order, reason);
    const now = this.#now();
    order.quote =
      preview?.status === "confirmation_required" && hasExactMoney(preview.price)
        ? {
            observedAt: now,
            expiresAt: addMs(now, this.config.quoteTtlMs),
            price: exactMoney(preview.price, "replacement registration preview"),
            quoteId: preview.quoteId ?? null,
            providerDoesNotReservePrice: true
          }
        : null;
    order.acceptedQuote = null;
    order.state = voided ? ORDER_STATES.REQUOTE_REQUIRED : ORDER_STATES.PAYMENT_VOID_REVIEW;
    order.review = {
      reason: voided ? reason : "authorization_void_unknown",
      openedAt: now,
      registrationSubmitted: false
    };
    return this.#save(order, command, "domain.registration.requote_required", {
      actorId: auth.actorId,
      reason,
      authorizationVoided: voided,
      registrationSubmitted: false
    });
  }

  async #tryVoid(order, reason) {
    if (order.payment?.status !== "authorized") return true;
    try {
      const response = await this.ports.payments.voidAuthorization({
        tenantId: order.tenantId,
        authorizationId: order.payment.authorizationId,
        purposeDigest: order.payment.purposeDigest,
        reason,
        idempotencyKey:
          `domain-void:${order.tenantId}:${order.id}:${order.payment.authorizationId}`
      });
      requiredString(response.voidId, "voidId", 256);
      invariant(
        response.purposeDigest === order.payment.purposeDigest,
        "payment_purpose_mismatch",
        "void response purpose does not match the order"
      );
      order.payment.status = "voided";
      order.payment.voidId = response.voidId;
      return true;
    } catch {
      order.payment.status = "void_unknown";
      return false;
    }
  }

  #now() {
    return iso(this.ports.clock.now(), "clock.now");
  }
}

function requireAuth(input) {
  invariant(input && typeof input === "object", "authentication_required", "session is required", {
    status: 401
  });
  return {
    tenantId: requiredString(input.tenantId, "tenantId", 128),
    customerId:
      typeof input.customerId === "string" && input.customerId
        ? requiredString(input.customerId, "customerId", 128)
        : null,
    actorId: requiredString(input.actorId, "actorId", 128),
    roles: Array.isArray(input.roles) ? [...input.roles] : []
  };
}

function requireCustomer(input) {
  const auth = requireAuth(input);
  invariant(auth.customerId, "authentication_required", "customer session is required", {
    status: 401
  });
  invariant(
    auth.actorId === auth.customerId,
    "customer_identity_mismatch",
    "customer actor does not match the authenticated customer",
    { status: 403 }
  );
  return auth;
}

function requireOperator(auth, role) {
  invariant(auth.roles.includes(role), "operator_forbidden", "operator role is required", {
    status: 403
  });
}

function validateAgreements(values) {
  invariant(Array.isArray(values), "consent_incomplete", "agreement evidence is required");
  const byKey = new Map();
  for (const value of values) {
    const key = requiredString(value?.key, "agreement.key", 80);
    invariant(!byKey.has(key), "consent_incomplete", "agreement keys must be unique");
    byKey.set(key, {
      key,
      documentVersion: requiredString(value.documentVersion, "documentVersion", 80),
      documentDigest: requiredString(value.documentDigest, "documentDigest", 128),
      acceptedAt: iso(value.acceptedAt, "agreement.acceptedAt")
    });
  }
  for (const required of REQUIRED_AGREEMENTS) {
    invariant(byKey.has(required), "consent_incomplete", `missing agreement ${required}`);
  }
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function validateContactIds(value) {
  invariant(value && typeof value === "object", "invalid_contacts", "registrar contacts are missing");
  for (const role of ["registrant", "admin", "tech", "billing"]) {
    requiredString(value[role], `contacts.${role}`, 128);
  }
}

function requireFresh(quote, now) {
  invariant(quote, "quote_required", "a registrar quote is required");
  invariant(
    Date.parse(now) < Date.parse(quote.expiresAt),
    "quote_expired",
    "registrar quote expired; request a fresh quote"
  );
}

function paymentPurpose(order, kind) {
  return Object.freeze({
    schema: "sitesourcery.domain-payment-purpose.v1",
    kind,
    tenantId: order.tenantId,
    customerId: order.customerId,
    orderId: order.id,
    projectId: order.projectId,
    domain: order.domain,
    quoteEvidenceId: order.acceptedQuote.evidenceId,
    acceptedRegistrarPrice: order.acceptedQuote.registrarPrice,
    serviceFeeMinor: order.acceptedQuote.serviceFeeMinor,
    total: order.acceptedQuote.total
  });
}

function validateAuthorization(value, expected, purposeDigest, now, config) {
  invariant(value?.status === "authorized", "payment_not_authorized", "payment was not authorized");
  requiredString(value.authorizationId, "authorizationId", 256);
  invariant(value.captureMode === "manual", "unsafe_capture_mode", "payment must use manual capture");
  invariant(
    value.amountMinor === expected.amountMinor && value.currency === expected.currency,
    "payment_amount_mismatch",
    "payment authorization does not match the customer-approved total"
  );
  invariant(
    value.purposeDigest === purposeDigest,
    "payment_purpose_mismatch",
    "payment authorization purpose does not match this exact domain order"
  );
  iso(value.expiresAt, "authorization.expiresAt");
  invariant(
    Date.parse(value.expiresAt) - Date.parse(now) >= config.minimumAuthorizationRemainingMs,
    "authorization_too_short",
    "payment authorization expires too soon for safe registration"
  );
}

function requireAuthorizationFresh(payment, now, config) {
  invariant(payment?.status === "authorized", "payment_not_authorized", "authorization is required");
  invariant(
    Date.parse(payment.expiresAt) - Date.parse(now) >= config.minimumAuthorizationRemainingMs,
    "authorization_expired",
    "payment authorization is no longer safe to use"
  );
}

function validateCapture(value, amountMinor, purposeDigest) {
  requiredString(value?.captureId, "captureId", 256);
  invariant(
    value.amountMinor === amountMinor && value.currency === "USD",
    "payment_amount_mismatch",
    "captured amount does not match the safe amount"
  );
  invariant(
    value.purposeDigest === purposeDigest,
    "payment_purpose_mismatch",
    "capture purpose does not match this exact domain order"
  );
}

function validateRefund(value, amountMinor, purposeDigest) {
  requiredString(value?.refundId, "refundId", 256);
  invariant(
    value.amountMinor === amountMinor && value.currency === "USD",
    "refund_amount_mismatch",
    "refund amount does not match the request"
  );
  invariant(
    value.purposeDigest === purposeDigest,
    "payment_purpose_mismatch",
    "refund purpose does not match this exact domain order"
  );
}

function requireExecutionApproval(approval, order, config, scope) {
  invariant(config.mutationMode === "fake", "external_mutation_held", "external mutations are held");
  invariant(approval && typeof approval === "object", "approval_required", "execution approval is required");
  requiredString(approval.approvalId, "executionApproval.approvalId", 128);
  requiredString(approval.approvedBy, "executionApproval.approvedBy", 128);
  iso(approval.approvedAt, "executionApproval.approvedAt");
  invariant(
    approval.scope === scope &&
      approval.environment === "fake" &&
      approval.tenantId === order.tenantId &&
      approval.orderId === order.id &&
      approval.domain === order.domain &&
      approval.quoteDigest === digest(order.acceptedQuote),
    "approval_scope_mismatch",
    "execution approval does not match this exact fake order and accepted quote"
  );
}

function requireState(order, allowed) {
  invariant(
    allowed.includes(order.state),
    "invalid_order_state",
    `operation is not allowed from ${order.state}`
  );
}

function requireActive(order) {
  requireState(order, [
    ORDER_STATES.ACTIVE,
    ORDER_STATES.ACTIVE_RECONCILIATION,
    ORDER_STATES.ACTIVE_PAYMENT_REVIEW
  ]);
}

function hasExactMoney(value) {
  return (
    value &&
    Number.isSafeInteger(value.amountMinor) &&
    value.amountMinor >= 0 &&
    value.currency === "USD"
  );
}

function addMs(value, milliseconds) {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function validateConfig(config) {
  requiredInteger(config.quoteTtlMs, "quoteTtlMs", { minimum: 1_000 });
  requiredInteger(config.minimumAuthorizationRemainingMs, "minimumAuthorizationRemainingMs", {
    minimum: 1_000
  });
  requiredInteger(config.serviceFeeMinor, "serviceFeeMinor");
  invariant(
    ["held", "fake"].includes(config.mutationMode),
    "invalid_config",
    "mutationMode must be held or fake",
    { status: 500 }
  );
  requiredString(config.registrarDisplayName, "registrarDisplayName", 128);
  return Object.freeze({ ...config });
}

function completedCommand(command, value) {
  return { ...command, status: "completed", result: { value: structuredClone(value) } };
}

function outboxFrom(audit) {
  return {
    outboxId: audit.eventId,
    tenantId: audit.tenantId,
    orderId: audit.orderId,
    type: audit.type,
    occurredAt: audit.occurredAt,
    payload: {
      eventId: audit.eventId,
      orderVersion: audit.orderVersion,
      detail: structuredClone(audit.detail)
    }
  };
}

function serializeError(error) {
  return {
    name: error.name,
    code: error.code ?? "domain_error",
    message: error.message,
    status: error.status ?? 409,
    details: error.details ?? null
  };
}

function restoreError(value) {
  return new DomainError(value.code, value.message, {
    status: value.status,
    details: value.details
  });
}

function redactReference(value) {
  if (typeof value !== "string" || value.length < 8) return "redacted";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function publicOrder(order) {
  return structuredClone({
    schemaVersion: order.schemaVersion,
    id: order.id,
    version: order.version,
    tenantId: order.tenantId,
    customerId: order.customerId,
    projectId: order.projectId,
    domain: order.domain,
    years: order.years,
    state: order.state,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    registrar: {
      provider: order.registrar.provider,
      registrarOfRecord: order.registrar.registrarOfRecord,
      customerIsRegistrant: true,
      siteSourceryRole: order.registrar.siteSourceryRole,
      contactsPrepared: Boolean(order.registrar.contactIds)
    },
    quote: order.quote,
    acceptedQuote: order.acceptedQuote,
    payment: order.payment
      ? {
          status: order.payment.status,
          amount: order.payment.amount,
          capturedAmount: order.payment.capturedAmount,
          purposeDigest: order.payment.purposeDigest
        }
      : null,
    registration: {
      status: order.registration.status,
      providerPrice: order.registration.providerPrice,
      registrationDate: order.registration.registrationDate,
      expirationDate: order.registration.expirationDate,
      verificationStatus: order.registration.verificationStatus
    },
    renewal: order.renewal,
    transfer: {
      status: order.transfer.status,
      authCodeDigest: order.transfer.authCodeDigest,
      authCodeExpiresAt: order.transfer.authCodeExpiresAt,
      deliveryReceiptId: order.transfer.deliveryReceiptId
        ? redactReference(order.transfer.deliveryReceiptId)
        : null
    },
    refund: {
      status: order.refund.status,
      refundedAmountMinor: order.refund.refundedAmountMinor
    },
    review: order.review
  });
}

function custodyExport(order, audit) {
  return {
    schema: "sitesourcery.domain-custody-export.v1",
    exportedAt: order.updatedAt,
    tenantId: order.tenantId,
    customerId: order.customerId,
    projectId: order.projectId,
    orderId: order.id,
    domain: order.domain,
    state: order.state,
    registrar: {
      provider: order.registrar.provider,
      registrarOfRecord: order.registrar.registrarOfRecord,
      customerIsRegistrant: true,
      siteSourceryRole: order.registrar.siteSourceryRole,
      contactReferences: order.registrar.contactIds
        ? Object.fromEntries(
            Object.entries(order.registrar.contactIds).map(([key, value]) => [
              key,
              redactReference(value)
            ])
          )
        : null
    },
    consent: order.consent
      ? {
          evidenceId: order.consent.evidenceId,
          recordedAt: order.consent.recordedAt,
          agreements: order.consent.agreements.map(
            ({ key, documentVersion, documentDigest }) => ({
              key,
              documentVersion,
              documentDigest
            })
          )
        }
      : null,
    pricing: {
      accepted: order.acceptedQuote,
      providerPriceAtConfirmation: order.registration.providerPrice
    },
    registration: {
      status: order.registration.status,
      registrationDate: order.registration.registrationDate,
      expirationDate: order.registration.expirationDate,
      verificationStatus: order.registration.verificationStatus,
      autoRenew: false
    },
    renewal: order.renewal,
    transfer: {
      status: order.transfer.status,
      authCodeDigest: order.transfer.authCodeDigest,
      authCodeExpiresAt: order.transfer.authCodeExpiresAt,
      rawAuthCode: null,
      deliveryToken: null
    },
    audit: audit.map(({ eventId, orderVersion, type, occurredAt, detail }) => ({
      eventId,
      orderVersion,
      type,
      occurredAt,
      detail
    }))
  };
}
