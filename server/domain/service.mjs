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
  const resolvedConfig = { ...DEFAULTS, ...config };
  return new DomainOrchestrator(
    validatePorts(ports, { legacyRegistrarOfRecord: resolvedConfig.registrarDisplayName }),
    resolvedConfig
  );
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
        schemaVersion: 2,
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
          provider: null,
          registrarOfRecord: null,
          customerIsRegistrant: true,
          siteSourceryRole: "authorized_agent_and_account_operator",
          contactIds: null,
          contactProvider: null,
          quoteRoute: null,
          providerPin: null
        },
        consent: null,
        quote: null,
        acceptedQuote: null,
        payment: null,
        registration: {
          status: "not_started",
          attemptId: null,
          operationId: null,
          mutationState: "not_started",
          attemptedProvider: null,
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
          attemptId: null,
          mutationState: "not_started",
          provider: null,
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
        projectId: order.projectId,
        providerCode: null,
        providerSelection: "unselected"
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
        registrarDisclosed: null,
        registrarDisclosureTiming: "selected_provider_disclosed_before_price_acceptance",
        agreements,
        recordedAt: this.#now()
      };
      resetProviderQuoteCycle(order);
      order.quote = null;
      order.acceptedQuote = null;
      order.state = ORDER_STATES.AGENCY_CONSENTED;
      return this.#save(order, command, "domain.agency.consent_recorded", {
        actorId: auth.actorId,
        evidenceId: order.consent.evidenceId,
        agreementKeys: agreements.map(({ key }) => key),
        providerCode: null,
        providerSelection: "unselected_until_quote"
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

      // FINAL_QUOTED and REQUOTE_REQUIRED are explicit fresh quote cycles. Any
      // prior provider contacts and route are discarded before unlocked,
      // no-charge preflight so a healthy contingency provider may be chosen.
      if ([ORDER_STATES.FINAL_QUOTED, ORDER_STATES.REQUOTE_REQUIRED].includes(order.state)) {
        resetProviderQuoteCycle(order, { resetRegistration: true });
        order.quote = null;
        order.acceptedQuote = null;
      }

      if (!order.registrar.quoteRoute) {
        const preflight = await this.ports.registrarProviders.contingency.preflightRegistration({
          input: registrationProviderInput(order)
        });
        requireAvailablePreflight(preflight);
        applyProviderRoute(order, preflight.route);
        order = await this.#save(
          order,
          command,
          "domain.quote.provider_selected",
          {
            actorId: auth.actorId,
            ...providerAudit(order),
            preflightFallbackUsed: preflight.fallbackUsed === true,
            contactsPrepared: false
          },
          { complete: false, returnInternal: true }
        );
      }

      const route = requireProviderRoute(order);
      const provider = this.ports.registrarProviders.get(route.providerCode);
      const contactIds = await provider.registrar.ensureContacts({
        tenantId: order.tenantId,
        customerId: order.customerId,
        domain: order.domain,
        registrantProfileRef: order.consent.registrantProfileRef,
        registrantProfileDigest: order.consent.registrantProfileDigest,
        consentEvidenceId: order.consent.evidenceId,
        customerIsRegistrant: true
      });
      validateContactIds(contactIds);
      const preflight = await this.ports.registrarProviders.contingency.preflightRegistration({
        input: registrationProviderInput(order, contactIds),
        lockedProviderCode: route.providerCode
      });
      requireAvailablePreflight(preflight);
      invariant(
        preflight.route.providerCode === route.providerCode,
        "domain_provider_route_mismatch",
        "provider changed after contact preparation",
        { status: 409 }
      );
      const now = this.#now();
      order.registrar.contactIds = structuredClone(contactIds);
      order.registrar.contactProvider = route.providerCode;
      applyProviderRoute(order, preflight.route);
      order.quote = quoteFromRoute(preflight.route, now, this.config.quoteTtlMs);
      order.acceptedQuote = null;
      order.state = ORDER_STATES.FINAL_QUOTED;
      return this.#save(order, command, "domain.quote.prepared", {
        actorId: auth.actorId,
        ...providerAudit(order),
        amountMinor: order.quote.price.amountMinor,
        currency: order.quote.price.currency,
        expiresAt: order.quote.expiresAt,
        contactsPrepared: true
      });
    });
  }

  async acceptQuote(input) {
    return this.#orderCommand(input, "acceptQuote", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.FINAL_QUOTED]);
      requireFresh(order.quote, this.#now());
      const route = requireProviderRoute(order);
      requireProviderContacts(order, route.providerCode);
      const acceptedAmountMinor = requiredInteger(input.acceptedAmountMinor, "acceptedAmountMinor");
      invariant(
        acceptedAmountMinor === order.quote.price.amountMinor,
        "price_mismatch",
        "accepted amount does not match the current registrar preview"
      );
      order.acceptedQuote = {
        providerCode: route.providerCode,
        registrarOfRecord: route.registrarOfRecord,
        providerRouteFingerprint: route.fingerprint,
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
        ...providerAudit(order),
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
        {
          actorId: auth.actorId,
          ...providerAudit(order),
          amountMinor: expected.amountMinor,
          purposeDigest
        },
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
          ...providerAudit(order),
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
        ...providerAudit(order),
        amountMinor: expected.amountMinor,
        purposeDigest
      });
    });
  }

  async revalidateBeforeConfirm(input) {
    return this.#orderCommand(input, "revalidateBeforeConfirm", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.PAYMENT_AUTHORIZED]);
      requireAuthorizationFresh(order.payment, this.#now(), this.config);
      const route = requireProviderRoute(order);
      requireAcceptedProvider(order, route);
      requireProviderContacts(order, route.providerCode);
      let preflight;
      try {
        preflight = await this.ports.registrarProviders.contingency.preflightRegistration({
          input: registrationProviderInput(order, order.registrar.contactIds),
          lockedProviderCode: route.providerCode
        });
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "domain_providers_unavailable") {
          throw error;
        }
        return this.#voidAndRequote(
          order,
          command,
          auth,
          null,
          "registration_price_unavailable_on_revalidation"
        );
      }
      if (preflight.status !== "ready") {
        return this.#voidAndRequote(
          order,
          command,
          auth,
          null,
          "registration_unavailable_on_revalidation"
        );
      }
      const replacementRoute = preflight.route;
      invariant(
        replacementRoute.providerCode === route.providerCode,
        "domain_provider_route_mismatch",
        "revalidation changed the selected provider",
        { status: 409 }
      );
      const price = exactMoney(replacementRoute.expectedPrice, "registration revalidation");
      if (!sameMoney(price, order.acceptedQuote.registrarPrice)) {
        return this.#voidAndRequote(
          order,
          command,
          auth,
          replacementRoute,
          "registration_price_changed_before_confirmation"
        );
      }
      const now = this.#now();
      applyProviderRoute(order, replacementRoute);
      order.quote = quoteFromRoute(replacementRoute, now, this.config.quoteTtlMs);
      order.state = ORDER_STATES.READY_TO_CONFIRM;
      return this.#save(order, command, "domain.registration.revalidated", {
        actorId: auth.actorId,
        ...providerAudit(order),
        amountMinor: price.amountMinor
      });
    });
  }

  async submitRegistration(input) {
    return this.#orderCommand(input, "submitRegistration", async (order, command, auth) => {
      requireState(order, [ORDER_STATES.READY_TO_CONFIRM]);
      requireFresh(order.quote, this.#now());
      requireAuthorizationFresh(order.payment, this.#now(), this.config);
      const route = requireProviderRoute(order);
      requireAcceptedProvider(order, route);
      requireProviderContacts(order, route.providerCode);
      requireExecutionApproval(input.executionApproval, order, this.config, "domain_registration");

      const attemptId = await this.ports.ids.next("registration_attempt");
      order.state = ORDER_STATES.CONFIRM_DISPATCHING;
      order.registration.status = "dispatching";
      order.registration.attemptId = attemptId;
      order.registration.attemptedProvider = route.providerCode;
      // Persisting `submitted` before the call is deliberate: after a crash,
      // recovery must assume the mutation may have reached this one provider.
      order.registration.mutationState = "submitted";
      order = await this.#save(
        order,
        command,
        "domain.registration.dispatching",
        {
          actorId: auth.actorId,
          ...providerAudit(order),
          attemptId,
          expectedAmountMinor: order.quote.price.amountMinor
        },
        { complete: false, returnInternal: true }
      );

      const response = await this.ports.registrarProviders.contingency.submitRegistration({
        route,
        mutationState: "not_started",
        input: {
          tenantId: order.tenantId,
          attemptId,
          domain: order.domain,
          years: order.years,
          autoRenew: false,
          privacy: { level: "high", userConsent: true },
          contacts: order.registrar.contactIds,
          expectedPrice: order.quote.price
        }
      });

      if (response.status === "held") {
        order.registration.operationId = response.operationId ?? null;
        order.registration.mutationState =
          response.effect === "not_submitted" ? "not_started" : "uncertain";
        if (response.effect === "not_submitted" && response.reconciliationRequired === false) {
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
            ...providerAudit(order),
            attemptId,
            providerErrorCode: response.providerErrorCode,
            automaticProviderSwitch: false,
            authorizationVoided: voided
          });
        }
        order.state = ORDER_STATES.CONFIRM_UNKNOWN;
        order.registration.status = "unknown";
        order.review = {
          reason: response.reason,
          openedAt: this.#now(),
          instruction:
            "Do not retry or switch providers. Reconcile only the attempted registrar's operation, portfolio, registrant contacts, and billing before payment capture or void."
        };
        return this.#save(order, command, "domain.registration.unknown", {
          actorId: auth.actorId,
          ...providerAudit(order),
          attemptId,
          providerErrorCode: response.providerErrorCode,
          automaticProviderSwitch: false,
          noAutomaticRetry: true
        });
      }

      order.registration.operationId = response.operationId;
      order.registration.mutationState = "submitted";
      order.registration.status = "pending";
      order.registration.providerPrice = hasExactMoney(response.providerPrice)
        ? exactMoney(response.providerPrice, "provider confirmation price")
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
        ...providerAudit(order),
        attemptId,
        operationId: response.operationId,
        exactProviderPrice: exactMatch,
        automaticProviderSwitch: response.automaticProviderSwitch
      });
    });
  }

  async pollRegistration(input) {
    return this.#orderCommand(input, "pollRegistration", async (order, command, auth) => {
      requireState(order, [
        ORDER_STATES.REGISTRATION_PENDING,
        ORDER_STATES.REGISTRATION_PENDING_REVIEW,
        ORDER_STATES.CONFIRM_UNKNOWN
      ]);
      requiredString(
        order.registration.operationId,
        "registration.operationId",
        256
      );
      const route = requireProviderRoute(order);
      invariant(
        order.registration.attemptedProvider === route.providerCode,
        "domain_provider_route_mismatch",
        "registration attempt is not bound to its provider route",
        { status: 409 }
      );
      const reconciliation =
        await this.ports.registrarProviders.contingency.reconcileRegistration({
          route,
          operationId: order.registration.operationId,
          expectedRegistrantContactId: order.registrar.contactIds.registrant
        });
      if (reconciliation.status === "pending") {
        return this.#save(order, command, "domain.registration.polled", {
          actorId: auth.actorId,
          ...providerAudit(order),
          status: "pending",
          automaticProviderSwitch: false
        });
      }
      if (reconciliation.status === "held") {
        const providerReportedFailure =
          reconciliation.reason === "registration_failed_billing_requires_reconciliation";
        const providerReportedActive = reconciliation.reason.startsWith("registered_domain_");
        order.state = providerReportedFailure
          ? ORDER_STATES.REGISTRATION_FAILED_REVIEW
          : providerReportedActive
            ? ORDER_STATES.ACTIVE_PAYMENT_REVIEW
            : ORDER_STATES.REGISTRATION_PENDING_REVIEW;
        order.registration.status = providerReportedFailure
          ? "failed"
          : providerReportedActive
            ? "success"
            : "pending";
        order.review = {
          reason: reconciliation.reason,
          openedAt: this.#now(),
          instruction: providerReportedActive
            ? "Do not capture. Reconcile this registrar's domain and customer registrant mapping."
            : "Reconcile only the attempted registrar's operation, billing, and portfolio before payment capture or void."
        };
        return this.#save(order, command, "domain.registration.reconciliation_review", {
          actorId: auth.actorId,
          ...providerAudit(order),
          operationId: order.registration.operationId,
          reconciliationReason: reconciliation.reason,
          automaticProviderSwitch: false
        });
      }

      installProviderPin(order, reconciliation.providerPin);
      order.state = ORDER_STATES.ACTIVE_PAYMENT_PENDING;
      order.registration.status = "success";
      order = await this.#save(
        order,
        command,
        "domain.registration.verification_pending",
        {
          actorId: auth.actorId,
          ...providerAudit(order),
          operationId: order.registration.operationId,
          captureStarted: false
        },
        { complete: false, returnInternal: true }
      );
      const readback = await this.ports.registrarProviders.contingency.readPinned({
        pin: requireProviderPin(order),
        operation: "getDomain",
        input: {
          tenantId: order.tenantId,
          domain: order.domain
        }
      });
      if (readback.status !== "ok") {
        order.state = ORDER_STATES.ACTIVE_PAYMENT_REVIEW;
        order.review = {
          reason: readback.reason,
          openedAt: this.#now(),
          instruction:
            "Do not capture or switch providers. Reconcile the pinned registrar's domain and customer contact mapping."
        };
        return this.#save(order, command, "domain.registration.active_review", {
          actorId: auth.actorId,
          ...providerAudit(order),
          readbackAvailable: false,
          captureStarted: false,
          automaticProviderSwitch: false
        });
      }
      const domain = readback.result;
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
          ...providerAudit(order),
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
          ...providerAudit(order),
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
          ...providerAudit(order),
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
        ...providerAudit(order),
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
        ...providerAudit(order),
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
          { actorId: auth.actorId, ...providerAudit(order), amountMinor },
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
            ...providerAudit(order),
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
          ...providerAudit(order),
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
      const pin = requireProviderPin(order);
      const assessed = await this.ports.registrarProviders.contingency.readPinned({
        pin,
        operation: "assessTransferOut",
        input: {
          tenantId: order.tenantId,
          domain: order.domain,
          registrationDate: order.registration.registrationDate
        }
      });
      invariant(
        assessed.status === "ok",
        "transfer_assessment_unavailable",
        "the registrar of record could not confirm transfer eligibility",
        { details: { providerCode: pin.providerCode, reason: assessed.reason } }
      );
      const assessment = assessed.result;
      invariant(
        assessment?.eligible === true,
        "transfer_not_eligible",
        "registrar or registry rules currently block transfer-out",
        { details: { reason: assessment?.reason ?? "unknown" } }
      );
      const attemptId = await this.ports.ids.next("transfer_attempt");
      order.state = ORDER_STATES.TRANSFER_DISPATCHING;
      order.transfer.status = "dispatching";
      order.transfer.attemptId = attemptId;
      order.transfer.mutationState = "submitted";
      order.transfer.provider = pin.providerCode;
      order.transfer.requestedAt = this.#now();
      order.transfer.consentEvidenceId = input.transferConsentEvidenceId;
      order = await this.#save(
        order,
        command,
        "domain.transfer.dispatching",
        { actorId: auth.actorId, ...providerAudit(order), attemptId },
        { complete: false, returnInternal: true }
      );
      try {
        const unlocked = await this.ports.registrarProviders.contingency.mutatePinned({
          pin,
          operation: "setTransferLock",
          mutationState: "not_started",
          input: {
            tenantId: order.tenantId,
            domain: order.domain,
            locked: false,
            attemptId
          }
        });
        if (unlocked.status !== "submitted") {
          order.state = ORDER_STATES.TRANSFER_REVIEW;
          order.transfer.status = "manual_review";
          order.transfer.mutationState =
            unlocked.effect === "not_submitted" ? "not_started" : "uncertain";
          order.review = {
            reason: unlocked.reason,
            openedAt: this.#now(),
            instruction:
              "Do not retry or switch providers. Reconcile the transfer lock only with the pinned registrar."
          };
          return this.#save(order, command, "domain.transfer.review", {
            actorId: auth.actorId,
            ...providerAudit(order),
            attemptId,
            providerErrorCode: unlocked.providerErrorCode,
            automaticProviderSwitch: false,
            rawAuthCodeStored: false
          });
        }
        const authCodeRead = await this.ports.registrarProviders.contingency.readPinned({
          pin,
          operation: "getAuthCode",
          input: {
            tenantId: order.tenantId,
            domain: order.domain
          }
        });
        invariant(
          authCodeRead.status === "ok",
          "transfer_auth_code_unavailable",
          "the registrar of record did not return a transfer auth code"
        );
        const response = authCodeRead.result;
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
        order.transfer.mutationState = "submitted";
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
          ...providerAudit(order),
          attemptId,
          authCodeExpiresAt: expiresAt,
          rawAuthCodeStored: false,
          deliveredThroughOneTimeSecretPort: true
        });
      } catch (error) {
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
          ...providerAudit(order),
          attemptId,
          providerErrorCode:
            typeof error?.code === "string" && error.code.length <= 128 ? error.code : null,
          automaticProviderSwitch: false,
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

  async #voidAndRequote(order, command, auth, replacementRoute, reason) {
    const voided = await this.#tryVoid(order, reason);
    const now = this.#now();
    if (replacementRoute) {
      applyProviderRoute(order, replacementRoute);
      order.quote = quoteFromRoute(replacementRoute, now, this.config.quoteTtlMs);
    } else {
      order.registrar.quoteRoute = null;
      order.quote = null;
    }
    order.acceptedQuote = null;
    resetRegistrationAttempt(order);
    order.state = voided ? ORDER_STATES.REQUOTE_REQUIRED : ORDER_STATES.PAYMENT_VOID_REVIEW;
    order.review = {
      reason: voided ? reason : "authorization_void_unknown",
      openedAt: now,
      registrationSubmitted: false
    };
    return this.#save(order, command, "domain.registration.requote_required", {
      actorId: auth.actorId,
      ...providerAudit(order),
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

function registrationProviderInput(order, contactIds = null) {
  return {
    tenantId: order.tenantId,
    domain: order.domain,
    years: order.years,
    autoRenew: false,
    privacy: { level: "high", userConsent: true },
    contacts: contactIds === null ? null : structuredClone(contactIds)
  };
}

function requireAvailablePreflight(value) {
  invariant(
    value?.status === "ready" && value.route,
    "domain_unavailable",
    "the selected domain is unavailable for registration",
    {
      status: 409,
      details: {
        providerCode: value?.providerCode ?? null,
        registrarOfRecord: value?.registrarOfRecord ?? null,
        reason: value?.reason ?? "unavailable"
      }
    }
  );
  return value;
}

function applyProviderRoute(order, route) {
  invariant(route && typeof route === "object", "domain_provider_route_required", "provider route is required", {
    status: 409
  });
  const providerCode = requiredString(route.providerCode, "route.providerCode", 64);
  const registrarOfRecord = requiredString(
    route.registrarOfRecord,
    "route.registrarOfRecord",
    128
  );
  requiredString(route.fingerprint, "route.fingerprint", 128);
  invariant(
    route.domain === order.domain && route.years === order.years,
    "domain_provider_route_mismatch",
    "provider route does not match this domain order",
    { status: 409 }
  );
  invariant(
    !order.registrar.contactProvider || order.registrar.contactProvider === providerCode,
    "domain_provider_contact_mismatch",
    "provider contacts cannot move to another registrar",
    { status: 409 }
  );
  order.registrar.provider = providerCode;
  order.registrar.registrarOfRecord = registrarOfRecord;
  order.registrar.quoteRoute = structuredClone(route);
}

function requireProviderRoute(order) {
  const route = order.registrar?.quoteRoute;
  invariant(route, "domain_provider_route_required", "provider quote route is required", {
    status: 409
  });
  invariant(
    route.providerCode === order.registrar.provider &&
      route.registrarOfRecord === order.registrar.registrarOfRecord &&
      route.domain === order.domain &&
      route.years === order.years,
    "domain_provider_route_mismatch",
    "provider quote route does not match this order",
    { status: 409 }
  );
  return route;
}

function requireProviderContacts(order, providerCode) {
  validateContactIds(order.registrar?.contactIds);
  invariant(
    order.registrar.contactProvider === providerCode,
    "domain_provider_contact_mismatch",
    "registrar contacts do not belong to the selected provider",
    { status: 409 }
  );
}

function requireAcceptedProvider(order, route) {
  invariant(order.acceptedQuote, "quote_required", "an accepted registrar quote is required");
  invariant(
    order.acceptedQuote.providerCode === route.providerCode &&
      order.acceptedQuote.registrarOfRecord === route.registrarOfRecord &&
      sameMoney(order.acceptedQuote.registrarPrice, route.expectedPrice),
    "domain_provider_quote_acceptance_mismatch",
    "customer acceptance does not match the selected provider and price",
    { status: 409 }
  );
}

function quoteFromRoute(route, now, quoteTtlMs) {
  const localExpiry = Date.parse(now) + quoteTtlMs;
  let expiresAtMs = localExpiry;
  if (route.expiresAt !== null && route.expiresAt !== undefined) {
    iso(route.expiresAt, "route.expiresAt");
    const providerExpiry = Date.parse(route.expiresAt);
    invariant(
      providerExpiry > Date.parse(now),
      "quote_expired",
      "provider quote expired; request a fresh quote"
    );
    expiresAtMs = Math.min(expiresAtMs, providerExpiry);
  }
  const observedAt = route.observedAt ? iso(route.observedAt, "route.observedAt") : now;
  return {
    providerCode: route.providerCode,
    registrarOfRecord: route.registrarOfRecord,
    providerRouteFingerprint: route.fingerprint,
    observedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    price: exactMoney(route.expectedPrice, "registration preview"),
    quoteId: requiredString(route.quoteId, "route.quoteId", 256),
    providerDoesNotReservePrice: true
  };
}

function resetProviderQuoteCycle(order, { resetRegistration = false } = {}) {
  invariant(
    !order.registrar.providerPin,
    "domain_provider_pin_immutable",
    "an acquired domain cannot restart registrar selection",
    { status: 409 }
  );
  order.registrar.provider = null;
  order.registrar.registrarOfRecord = null;
  order.registrar.contactIds = null;
  order.registrar.contactProvider = null;
  order.registrar.quoteRoute = null;
  if (resetRegistration) resetRegistrationAttempt(order);
}

function resetRegistrationAttempt(order) {
  order.registration.status = "not_started";
  order.registration.attemptId = null;
  order.registration.operationId = null;
  order.registration.mutationState = "not_started";
  order.registration.attemptedProvider = null;
  order.registration.providerPrice = null;
  order.registration.registrationDate = null;
  order.registration.expirationDate = null;
  order.registration.verificationStatus = null;
}

function installProviderPin(order, pin) {
  invariant(pin && typeof pin === "object", "domain_provider_pin_required", "provider pin is required", {
    status: 409
  });
  requiredString(pin.fingerprint, "providerPin.fingerprint", 128);
  invariant(
    pin.providerCode === order.registrar.provider &&
      pin.registrarOfRecord === order.registrar.registrarOfRecord &&
      pin.domain === order.domain,
    "domain_provider_pin_mismatch",
    "provider pin does not match the acquired domain",
    { status: 409 }
  );
  if (order.registrar.providerPin) {
    invariant(
      order.registrar.providerPin.fingerprint === pin.fingerprint,
      "domain_provider_pin_immutable",
      "registrar of record cannot change without an authoritative transfer",
      { status: 409 }
    );
    return;
  }
  order.registrar.providerPin = structuredClone(pin);
}

function requireProviderPin(order) {
  const pin = order.registrar?.providerPin;
  invariant(pin, "domain_provider_pin_required", "registrar-of-record pin is required", {
    status: 409
  });
  invariant(
    pin.providerCode === order.registrar.provider &&
      pin.registrarOfRecord === order.registrar.registrarOfRecord &&
      pin.domain === order.domain,
    "domain_provider_pin_mismatch",
    "registrar-of-record pin does not match this domain",
    { status: 409 }
  );
  return pin;
}

function providerAudit(order) {
  return {
    providerCode: order.registrar?.provider ?? null,
    registrarOfRecord: order.registrar?.registrarOfRecord ?? null,
    providerRouteFingerprint: order.registrar?.quoteRoute?.fingerprint ?? null,
    providerPinFingerprint: order.registrar?.providerPin?.fingerprint ?? null
  };
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
      providerCode: order.registrar.provider,
      registrarOfRecord: order.registrar.registrarOfRecord,
      customerIsRegistrant: true,
      siteSourceryRole: order.registrar.siteSourceryRole,
      contactsPrepared: Boolean(order.registrar.contactIds),
      quoteRouteEvidence: publicRouteEvidence(order.registrar.quoteRoute),
      providerPinEvidence: publicPinEvidence(order.registrar.providerPin)
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
      providerCode: order.registration.attemptedProvider,
      providerPrice: order.registration.providerPrice,
      registrationDate: order.registration.registrationDate,
      expirationDate: order.registration.expirationDate,
      verificationStatus: order.registration.verificationStatus
    },
    renewal: order.renewal,
    transfer: {
      status: order.transfer.status,
      providerCode: order.transfer.provider,
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
    schema: "sitesourcery.domain-custody-export.v2",
    exportedAt: order.updatedAt,
    tenantId: order.tenantId,
    customerId: order.customerId,
    projectId: order.projectId,
    orderId: order.id,
    domain: order.domain,
    state: order.state,
    registrar: {
      provider: order.registrar.provider,
      providerCode: order.registrar.provider,
      registrarOfRecord: order.registrar.registrarOfRecord,
      customerIsRegistrant: true,
      siteSourceryRole: order.registrar.siteSourceryRole,
      quoteRouteEvidence: publicRouteEvidence(order.registrar.quoteRoute),
      providerPinEvidence: publicPinEvidence(order.registrar.providerPin),
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
          registrarDisclosureTiming: order.consent.registrarDisclosureTiming,
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
      providerCode: order.transfer.provider,
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

function publicRouteEvidence(route) {
  if (!route) return null;
  return {
    schema: route.schema,
    providerCode: route.providerCode,
    registrarOfRecord: route.registrarOfRecord,
    fingerprint: route.fingerprint
  };
}

function publicPinEvidence(pin) {
  if (!pin) return null;
  return {
    schema: pin.schema,
    providerCode: pin.providerCode,
    registrarOfRecord: pin.registrarOfRecord,
    domain: pin.domain,
    fingerprint: pin.fingerprint
  };
}
