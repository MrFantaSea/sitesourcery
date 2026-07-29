import { digest, exactMoney, iso, requiredString } from "../domain/canonical.mjs";
import { ExternalEffectError, invariant } from "../domain/errors.mjs";
import { resolveOffer, toBrowserSafeCatalog, validateOfferCatalog } from "./catalog.mjs";
import { QUOTE_SCHEMA, QUOTE_STATES, QUOTE_TTL_MS } from "./constants.mjs";
import { validateCommercePorts } from "./ports.mjs";

function sumMoney(rows, field) {
  return rows.reduce((total, row) => total + (row[field]?.amountMinor ?? 0), 0);
}

function publicLine(line) {
  return {
    lineItemId: line.lineItemId,
    receiptGroupId: line.receiptGroupId,
    kind: line.kind,
    label: line.label,
    ...(line.domain ? { domain: line.domain } : {}),
    ...(line.oneTime ? { oneTime: structuredClone(line.oneTime) } : {}),
    ...(line.recurring ? { recurring: structuredClone(line.recurring) } : {}),
    terms: structuredClone(line.terms)
  };
}

function publicQuote(quote) {
  return Object.freeze({
    schema: QUOTE_SCHEMA,
    quoteId: quote.id,
    projectId: quote.projectId,
    catalogVersion: quote.catalogVersion,
    termsVersion: quote.termsVersion,
    offerId: quote.offerId,
    product: structuredClone(quote.product),
    tenure: structuredClone(quote.tenure),
    currency: "USD",
    lineItems: quote.lines.map(publicLine),
    receiptGroups: quote.lines.map((line) => ({
      receiptGroupId: line.receiptGroupId,
      kind: line.kind,
      lineItemIds: [line.lineItemId]
    })),
    totals: structuredClone(quote.totals),
    issuedAt: quote.issuedAt,
    expiresAt: quote.expiresAt,
    disclosureDigest: quote.disclosureDigest,
    status: quote.state,
    ...(quote.checkout
      ? {
          checkout: {
            checkoutId: quote.checkout.checkoutId,
            url: quote.checkout.url,
            expiresAt: quote.checkout.expiresAt
          }
        }
      : {})
  });
}

function commandRecord({ tenantId, commandId, operation, purpose }) {
  return {
    tenantId,
    commandId: requiredString(commandId, "commandId", 200),
    operation,
    fingerprint: digest(purpose)
  };
}

async function claim(repository, command) {
  const result = await repository.claimCommand(command);
  invariant(result.status !== "conflict", "idempotency_conflict", "command ID was already used for another purpose", {
    status: 409
  });
  invariant(result.status !== "pending", "command_in_progress", "command outcome requires reconciliation", {
    status: 409
  });
  return result;
}

function eventRecords({ ids, quote, eventType, occurredAt, actorId, details }) {
  const eventId = ids.next("commerce_event");
  return {
    audit: {
      eventId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      quoteVersion: quote.version,
      eventType,
      occurredAt,
      actorId,
      details: structuredClone(details)
    },
    outbox: {
      outboxId: eventId,
      tenantId: quote.tenantId,
      quoteId: quote.id,
      eventType,
      occurredAt,
      payload: { quoteId: quote.id, quoteVersion: quote.version, ...structuredClone(details) }
    }
  };
}

function validateDomainQuote(row, { tenantId, customerId, projectId, now }) {
  invariant(row && typeof row === "object", "domain_quote_unavailable", "domain quote is unavailable");
  invariant(
    row.tenantId === tenantId && row.customerId === customerId && row.projectId === projectId,
    "domain_quote_unavailable",
    "domain quote is unavailable",
    { status: 404 }
  );
  invariant(row.kind === "registration" || row.kind === "renewal", "domain_quote_unavailable", "domain quote kind invalid");
  iso(row.expiresAt, "domainQuote.expiresAt");
  invariant(Date.parse(row.expiresAt) > Date.parse(now), "domain_quote_expired", "domain quote has expired");
  const money = exactMoney(row.amount, "domain quote amount");
  requiredString(row.domain, "domainQuote.domain", 253);
  requiredString(row.label, "domainQuote.label", 300);
  invariant(row.terms && typeof row.terms === "object", "domain_quote_unavailable", "domain terms are unavailable");
  for (const field of ["renewal", "cancellation", "ownership", "hosting"]) {
    requiredString(row.terms[field], `domainQuote.terms.${field}`, 1000);
  }
  invariant(row.stripePriceData && typeof row.stripePriceData === "object", "domain_quote_unavailable", "domain checkout data missing");
  invariant(
    row.stripePriceData.currency === "usd" && row.stripePriceData.unitAmount === money.amountMinor,
    "domain_quote_unavailable",
    "domain checkout data does not match the disclosed amount"
  );
  return {
    lineItemId: `domain:${row.id}`,
    receiptGroupId: `domain:${row.id}`,
    kind: row.kind === "registration" ? "domain_registration" : "domain_renewal",
    label: row.label,
    domain: row.domain,
    oneTime: money,
    terms: structuredClone(row.terms),
    checkoutAuthority: {
      type: "server_price_data",
      priceData: structuredClone(row.stripePriceData),
      sourceQuoteId: row.id,
      sourceExpiresAt: row.expiresAt
    }
  };
}

export function createAbracadabraCommerceService(inputPorts, options = {}) {
  const ports = validateCommercePorts(inputPorts);
  const quoteTtlMs = options.quoteTtlMs ?? QUOTE_TTL_MS;
  invariant(Number.isSafeInteger(quoteTtlMs) && quoteTtlMs > 0, "invalid_config", "quote TTL invalid", {
    status: 500
  });

  async function catalog() {
    return validateOfferCatalog(await ports.catalog.current());
  }

  return Object.freeze({
    async getCatalog() {
      return toBrowserSafeCatalog(await catalog());
    },

    async createQuote({
      tenantId,
      customerId,
      projectId,
      actorId,
      offerId,
      domainQuoteId = null,
      commandId
    }) {
      requiredString(tenantId, "tenantId", 200);
      requiredString(customerId, "customerId", 200);
      requiredString(projectId, "projectId", 200);
      requiredString(actorId, "actorId", 200);
      const purpose = { tenantId, customerId, projectId, offerId, domainQuoteId };
      const command = commandRecord({ tenantId, commandId, operation: "create_quote", purpose });
      const claimed = await claim(ports.repository, command);
      if (claimed.status === "replay") return claimed.result;

      let quoteCommitted = false;
      try {
      const approvedCatalog = await catalog();
      const selected = resolveOffer(approvedCatalog, offerId);
      const now = ports.clock.now();
      iso(now, "clock.now");
      const project = await ports.projects.resolveForCommerce({
        tenantId,
        customerId,
        projectId,
        now
      });
      invariant(
        project?.tenantId === tenantId &&
          project?.customerId === customerId &&
          project?.projectId === projectId &&
          project?.purchasable === true,
        "project_not_found",
        "project not found",
        { status: 404 }
      );
      const websiteLine = {
        lineItemId: `website:${selected.offer.offerId}`,
        receiptGroupId: `website:${selected.offer.offerId}`,
        kind: "abracadabra_product",
        label: `${selected.product.name} — ${selected.tenure.name}`,
        ...(selected.offer.amounts.oneTime
          ? { oneTime: structuredClone(selected.offer.amounts.oneTime) }
          : {}),
        ...(selected.offer.amounts.recurring
          ? { recurring: structuredClone(selected.offer.amounts.recurring) }
          : {}),
        terms: structuredClone(selected.tenure.terms),
        checkoutAuthority: {
          type: "stripe_price_refs",
          refs: structuredClone(selected.offer.stripePriceRefs)
        }
      };
      const lines = [websiteLine];
      if (domainQuoteId !== null) {
        requiredString(domainQuoteId, "domainQuoteId", 200);
        lines.push(
          validateDomainQuote(
            await ports.domainQuotes.resolveForCommerce({
              tenantId,
              customerId,
              projectId,
              domainQuoteId,
              now
            }),
            { tenantId, customerId, projectId, now }
          )
        );
      }
      const recurring = lines
        .filter((line) => line.recurring)
        .map((line) => ({ ...line.recurring }));
      const intervals = [...new Set(recurring.map((row) => row.interval))];
      const totals = {
        oneTime: { amountMinor: sumMoney(lines, "oneTime"), currency: "USD" },
        recurring: intervals.map((interval) => ({
          amountMinor: recurring
            .filter((row) => row.interval === interval)
            .reduce((total, row) => total + row.amountMinor, 0),
          currency: "USD",
          interval
        }))
      };
      const quote = {
        id: ports.ids.next("commerce_quote"),
        tenantId,
        customerId,
        projectId,
        version: 1,
        state: QUOTE_STATES.QUOTED,
        catalogVersion: approvedCatalog.catalogVersion,
        termsVersion: approvedCatalog.termsVersion,
        offerId: selected.offer.offerId,
        product: structuredClone(selected.product),
        tenure: {
          tenureId: selected.tenure.tenureId,
          name: selected.tenure.name,
          billingShape: structuredClone(selected.tenure.billingShape),
          terms: structuredClone(selected.tenure.terms)
        },
        currency: "USD",
        lines,
        totals,
        issuedAt: now,
        expiresAt: new Date(Date.parse(now) + quoteTtlMs).toISOString(),
        checkout: null
      };
      quote.disclosureDigest = digest({
        quoteId: quote.id,
        projectId: quote.projectId,
        catalogVersion: quote.catalogVersion,
        termsVersion: quote.termsVersion,
        offerId: quote.offerId,
        product: quote.product,
        tenure: quote.tenure,
        lines: quote.lines.map(publicLine),
        totals: quote.totals,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt
      });
      const response = publicQuote(quote);
      const records = eventRecords({
        ids: ports.ids,
        quote,
        eventType: "commerce.quote_created",
        occurredAt: now,
        actorId,
        details: {
          offerId: quote.offerId,
          projectId: quote.projectId,
          catalogVersion: quote.catalogVersion,
          disclosureDigest: quote.disclosureDigest,
          domainIncluded: lines.length === 2
        }
      });
      await ports.repository.createQuote({
        quote,
        ...records,
        command: { ...command, result: response }
      });
      quoteCommitted = true;
      return response;
      } catch (error) {
        if (!quoteCommitted) await ports.repository.releaseCommand(command);
        throw error;
      }
    },

    async createCheckout({
      tenantId,
      customerId,
      projectId,
      actorId,
      quoteId,
      acceptedDisclosureDigest,
      commandId
    }) {
      requiredString(tenantId, "tenantId", 200);
      requiredString(customerId, "customerId", 200);
      requiredString(projectId, "projectId", 200);
      requiredString(actorId, "actorId", 200);
      requiredString(quoteId, "quoteId", 200);
      requiredString(acceptedDisclosureDigest, "acceptedDisclosureDigest", 100);
      const purpose = { tenantId, customerId, projectId, quoteId, acceptedDisclosureDigest };
      const command = commandRecord({ tenantId, commandId, operation: "create_checkout", purpose });
      const claimed = await claim(ports.repository, command);
      if (claimed.status === "replay") return claimed.result;

      let dispatched = false;
      try {
      const quote = await ports.repository.getQuote({ tenantId, quoteId });
      invariant(
        quote && quote.customerId === customerId && quote.projectId === projectId,
        "quote_not_found",
        "quote not found",
        { status: 404 }
      );
      invariant(quote.state === QUOTE_STATES.QUOTED, "quote_not_checkoutable", "quote is not checkoutable");
      const now = ports.clock.now();
      const project = await ports.projects.resolveForCommerce({
        tenantId,
        customerId,
        projectId,
        now
      });
      invariant(
        project?.tenantId === tenantId &&
          project?.customerId === customerId &&
          project?.projectId === projectId &&
          project?.purchasable === true,
        "project_not_found",
        "project not found",
        { status: 404 }
      );
      invariant(Date.parse(quote.expiresAt) > Date.parse(now), "quote_expired", "quote has expired");
      invariant(
        acceptedDisclosureDigest === quote.disclosureDigest,
        "quote_acceptance_mismatch",
        "accepted quote does not match the authoritative disclosure"
      );
      const readiness = await ports.stripe.readiness();
      invariant(readiness?.ready === true, "checkout_unavailable", "checkout provider is not configured", {
        status: 503
      });

      const dispatching = {
        ...quote,
        version: quote.version + 1,
        state: QUOTE_STATES.CHECKOUT_DISPATCHING
      };
      const dispatchRecords = eventRecords({
        ids: ports.ids,
        quote: dispatching,
        eventType: "commerce.checkout_dispatching",
        occurredAt: now,
        actorId,
        details: {
          projectId: quote.projectId,
          disclosureDigest: quote.disclosureDigest,
          commandId: command.commandId
        }
      });
      const began = await ports.repository.commit({
        tenantId,
        quoteId,
        expectedVersion: quote.version,
        quote: dispatching,
        ...dispatchRecords
      });
      invariant(began, "write_conflict", "quote changed; retry with a new command");
      dispatched = true;

      const checkoutPurpose = {
        tenantId,
        customerId,
        projectId,
        quoteId,
        quoteVersion: dispatching.version,
        catalogVersion: quote.catalogVersion,
        offerId: quote.offerId,
        disclosureDigest: quote.disclosureDigest,
        lines: quote.lines.map((line) => ({
          lineItemId: line.lineItemId,
          receiptGroupId: line.receiptGroupId,
          amounts: {
            ...(line.oneTime ? { oneTime: line.oneTime } : {}),
            ...(line.recurring ? { recurring: line.recurring } : {})
          },
          authority: line.checkoutAuthority
        }))
      };
      let providerResult;
      try {
        providerResult = await ports.stripe.createCheckout({
          idempotencyKey: `commerce:${tenantId}:${command.commandId}`,
          purposeDigest: digest(checkoutPurpose),
          purpose: checkoutPurpose
        });
      } catch (error) {
        if (error instanceof ExternalEffectError && error.certainty === "ambiguous") {
          throw error;
        }
        throw error;
      }
      requiredString(providerResult?.checkoutId, "provider.checkoutId", 300);
      requiredString(providerResult?.url, "provider.url", 2000);
      let checkoutUrl;
      try {
        checkoutUrl = new URL(providerResult.url);
      } catch {
        invariant(false, "invalid_provider_response", "provider checkout URL is invalid", { status: 503 });
      }
      invariant(checkoutUrl.protocol === "https:", "invalid_provider_response", "provider checkout URL must use HTTPS", {
        status: 503
      });
      iso(providerResult?.expiresAt, "provider.expiresAt");
      const completedAt = ports.clock.now();
      const ready = {
        ...dispatching,
        version: dispatching.version + 1,
        state: QUOTE_STATES.CHECKOUT_READY,
        checkout: {
          checkoutId: providerResult.checkoutId,
          url: checkoutUrl.toString(),
          expiresAt: providerResult.expiresAt,
          purposeDigest: digest(checkoutPurpose)
        }
      };
      const response = publicQuote(ready);
      const readyRecords = eventRecords({
        ids: ports.ids,
        quote: ready,
        eventType: "commerce.checkout_ready",
        occurredAt: completedAt,
        actorId,
        details: {
          projectId: ready.projectId,
          checkoutId: providerResult.checkoutId,
          purposeDigest: ready.checkout.purposeDigest
        }
      });
      const completed = await ports.repository.commit({
        tenantId,
        quoteId,
        expectedVersion: dispatching.version,
        quote: ready,
        ...readyRecords,
        command: { ...command, result: response }
      });
      invariant(completed, "manual_reconciliation_required", "checkout was created but local commit failed", {
        status: 503
      });
      return response;
      } catch (error) {
        if (!dispatched) await ports.repository.releaseCommand(command);
        throw error;
      }
    },

    async getQuote({ tenantId, customerId, projectId, quoteId }) {
      const quote = await ports.repository.getQuote({ tenantId, quoteId });
      invariant(
        quote && quote.customerId === customerId && quote.projectId === projectId,
        "quote_not_found",
        "quote not found",
        { status: 404 }
      );
      return publicQuote(quote);
    }
  });
}
