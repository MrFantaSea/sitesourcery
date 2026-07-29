import { randomUUID as systemRandomUUID } from "node:crypto";

import { ExternalEffectError } from "../domain/errors.mjs";
import { HostedError, invariant } from "./errors.mjs";
import {
  digest,
  normalizeHostname,
  optionalText,
  requiredText
} from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOMAIN_ROLES = new Set(["owner", "admin", "billing"]);
const MODES = new Set(["held", "contract_test", "approved_live"]);
const MINIMUM_AUTHORIZATION_REMAINING_MS = 15 * 60 * 1000;
const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "TXT"]);

function held(capability) {
  throw new HostedError(
    `${capability.toUpperCase()}_HELD`,
    `${capability.replaceAll("_", " ")} is held until its provider and owner approvals are installed.`,
    { status: 503 }
  );
}

function uuid(value, field) {
  const selected = String(value ?? "");
  invariant(UUID.test(selected), "INVALID_INPUT", `${field} is invalid.`, {
    status: 400
  });
  return selected;
}

function commandId(value) {
  const selected = String(value ?? "");
  invariant(
    selected.length >= 8 && selected.length <= 200,
    "IDEMPOTENCY_KEY_REQUIRED",
    "A valid idempotency key is required.",
    { status: 400 }
  );
  return selected;
}

function integer(value, field, minimum, maximum) {
  const selected = Number(value);
  invariant(
    Number.isSafeInteger(selected) &&
      selected >= minimum &&
      selected <= maximum,
    "INVALID_INPUT",
    `${field} is invalid.`,
    { status: 400 }
  );
  return selected;
}

function money(value, field = "Price") {
  invariant(
    value &&
      Number.isSafeInteger(value.amountMinor) &&
      value.amountMinor >= 0 &&
      value.currency === "USD",
    "DOMAIN_PROVIDER_RESPONSE_INVALID",
    `${field} is not exact USD money.`,
    { status: 502 }
  );
  return Object.freeze({
    amountMinor: value.amountMinor,
    currency: "USD"
  });
}

function exactIso(value, field) {
  const milliseconds = Date.parse(value ?? "");
  invariant(
    Number.isFinite(milliseconds),
    "DOMAIN_PROVIDER_RESPONSE_INVALID",
    `${field} is invalid.`,
    { status: 502 }
  );
  return new Date(milliseconds).toISOString();
}

function exactStripeCheckoutUrl(value) {
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    // The invariant below emits the stable hosted-runtime error.
  }
  invariant(
    typeof value === "string" &&
      value.length <= 2000 &&
      parsed?.protocol === "https:" &&
      parsed.hostname === "checkout.stripe.com" &&
      parsed.username === "" &&
      parsed.password === "",
    "DOMAIN_PAYMENT_PROVIDER_RESPONSE_INVALID",
    "Stripe did not return a valid Checkout URL.",
    { status: 502 }
  );
  return value;
}

function now(clock) {
  return exactIso(clock.now(), "Runtime clock");
}

function actorId(actor) {
  invariant(
    actor?.userId && UUID.test(actor.userId),
    "AUTHENTICATION_REQUIRED",
    "Sign in to continue.",
    { status: 401 }
  );
  return actor.userId;
}

function canonicalDomain(value) {
  return normalizeHostname(requiredText(value, "Domain", 253));
}

function purposeFor({
  organizationId,
  projectId,
  customerId,
  orderId,
  quoteId,
  domain,
  years,
  amountMinor
}) {
  return Object.freeze({
    schema: "sitesourcery.domain-authorization.v1",
    organizationId,
    projectId,
    customerId,
    orderId,
    quoteId,
    domain,
    years,
    amount: Object.freeze({
      amountMinor,
      currency: "USD"
    }),
    captureMethod: "manual"
  });
}

function providerFailure(error, capability) {
  if (
    error instanceof ExternalEffectError &&
    error.certainty === "not_submitted"
  ) {
    return new HostedError(
      `${capability.toUpperCase()}_NOT_SUBMITTED`,
      `${capability.replaceAll("_", " ")} was not submitted.`,
      { status: 503 }
    );
  }
  return new HostedError(
    `${capability.toUpperCase()}_RECONCILIATION_REQUIRED`,
    `${capability.replaceAll("_", " ")} has an uncertain provider result. It will not be retried automatically.`,
    { status: 409 }
  );
}

function validateMode({
  mode,
  testOnly,
  liveApproval,
  registrar,
  payments
}) {
  invariant(
    MODES.has(mode),
    "DOMAIN_RUNTIME_CONFIGURATION_REQUIRED",
    "Domain runtime mode is invalid.",
    { status: 500 }
  );
  if (mode === "held") return;
  if (mode === "contract_test") {
    invariant(
      testOnly === true &&
        registrar?.mode === "contract_test" &&
        payments?.mode === "contract_test",
      "DOMAIN_RUNTIME_CONFIGURATION_REQUIRED",
      "Contract-test domain runtime requires injected non-network test providers.",
      { status: 500 }
    );
    return;
  }
  const requiredCapabilities = [
    "domain:search",
    "domain:quote",
    "domain:contacts",
    "domain:authorize",
    "domain:register",
    "domain:readback",
    "domain:capture",
    "domain:dns"
  ];
  invariant(
    liveApproval?.approved === true &&
      ["staging", "production"].includes(liveApproval.environment) &&
      liveApproval.providerCode === "spaceship" &&
      Number.isFinite(Date.parse(liveApproval.approvedAt)) &&
      Number.isFinite(Date.parse(liveApproval.expiresAt)) &&
      Date.parse(liveApproval.expiresAt) > Date.now() &&
      requiredCapabilities.every((entry) =>
        liveApproval.capabilities?.includes(entry)
      ),
    "DOMAIN_LIVE_APPROVAL_REQUIRED",
    "Exact owner approval for the live domain provider capabilities is required.",
    { status: 500 }
  );
}

function validatePorts(mode, registrar, payments, contactVault) {
  if (mode === "held") return;
  for (const [name, target, methods] of [
    [
      "registrar",
      registrar,
      [
        "searchDomains",
        "quoteRegistration",
        "ensureContacts",
        "previewRegistration",
        "confirmRegistration",
        "getOperation",
        "getDomain",
        "saveDnsRecords",
        "deleteDnsRecords"
      ]
    ],
    [
      "payments",
      payments,
      [
        "createDomainAuthorizationCheckout",
        "retrieveDomainAuthorization",
        "captureDomainAuthorization"
      ]
    ],
    ["contact vault", contactVault, ["seal"]]
  ]) {
    invariant(
      target &&
        methods.every(
          (method) => typeof target[method] === "function"
        ),
      "DOMAIN_RUNTIME_CONFIGURATION_REQUIRED",
      `${name} is missing a required domain capability.`,
      { status: 500 }
    );
  }
}

async function receipt(
  client,
  {
    randomUUID,
    organizationId,
    projectId,
    providerCode,
    kind,
    externalRef,
    facts,
    occurredAt
  }
) {
  const id = randomUUID();
  await client.query(
    `insert into ss.provider_receipts (
       id, organization_id, project_id, provider_code,
       receipt_kind, external_object_ref, facts, facts_digest,
       occurred_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      id,
      organizationId,
      projectId,
      providerCode,
      kind,
      externalRef,
      JSON.stringify(facts),
      digest(facts),
      occurredAt
    ]
  );
  return id;
}

async function writeAudit(
  client,
  {
    organizationId,
    projectId,
    actor,
    action,
    targetType,
    targetId,
    requestId = null,
    metadata = {}
  }
) {
  await client.query(
    `select ss.write_audit_event(
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
     )`,
    [
      organizationId,
      projectId,
      actor === "system" ? "system" : "user",
      actor,
      action,
      targetType,
      targetId,
      requestId,
      JSON.stringify(metadata)
    ]
  );
}

function publicQuote(row) {
  return {
    id: row.id,
    quoteId: row.id,
    projectId: row.project_id,
    hostname: row.domain_name,
    years: Number(row.term_years),
    registrar: "Spaceship",
    customerIsRegistrant: true,
    siteSourceryRole: "authorized_agent",
    price: {
      amountMinor: Number(row.customer_price_minor),
      currency: row.currency
    },
    renewalPrice: {
      amountMinor: Number(row.renewal_price_minor),
      currency: row.currency
    },
    renewalDisclosure: row.renewal_disclosure,
    termsVersion: row.terms_version,
    issuedAt: new Date(row.quoted_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    quoteDigest: row.quote_digest
  };
}

function publicContact(row) {
  return {
    id: row.id,
    registrantContactId: row.id,
    projectId: row.project_id,
    name: row.display_name,
    organization: row.display_organization,
    email: row.display_email,
    phone: row.display_phone,
    addressLine1: row.display_address_line_1,
    addressLine2: row.display_address_line_2,
    city: row.display_city,
    region: row.display_region,
    postalCode: row.display_postal_code,
    countryCode: row.country_code,
    customerIsRegistrant: true,
    capturedAt: new Date(row.captured_at).toISOString()
  };
}

function paymentPath(orderId) {
  return `/api/v1/domain-orders/${encodeURIComponent(orderId)}/payment`;
}

function publicOrder(row) {
  const intentState = row.intent_state ?? null;
  const state = row.registration_id
    ? "active"
    : row.attempt_state === "manual_review"
      ? "manual_review"
      : row.attempt_state === "dispatching"
        ? "payment_starting"
        : !row.registration_intent_id
          ? "awaiting_payment"
          : intentState === "awaiting_confirmation"
            ? "authorized"
            : intentState;
  const redirect = row.stripe_checkout_session_ref
    ? paymentPath(row.order_id)
    : null;
  return {
    id: row.order_id,
    orderId: row.order_id,
    projectId: row.project_id,
    quoteId: row.quote_id,
    hostname: row.domain_name,
    years: Number(row.term_years),
    state,
    status: state,
    customerIsRegistrant: true,
    registrar: "Spaceship",
    payment: {
      status: row.payment_state ?? (
        row.stripe_checkout_session_ref
          ? "awaiting_customer"
          : "starting"
      ),
      amountMinor: Number(row.customer_price_minor),
      currency: row.currency,
      captureMode: "manual"
    },
    ...(redirect
      ? {
          paymentUrl: redirect,
          checkoutUrl: redirect,
          checkoutExpiresAt: row.checkout_expires_at
            ? new Date(row.checkout_expires_at).toISOString()
            : null
        }
      : {}),
    ...(row.price_check_id
      ? {
          priceCheck: {
            id: row.price_check_id,
            priceCheckId: row.price_check_id,
            status: row.price_check_status,
            expiresAt: new Date(
              row.price_check_expires_at
            ).toISOString()
          }
        }
      : {}),
    ...(row.registration_id
      ? {
          domainId: row.registration_id,
          expiresAt: new Date(
            row.registration_expires_at
          ).toISOString()
        }
      : {})
  };
}

export function createHeldDomainRuntime() {
  const names = [
    "searchDomains",
    "createDomainQuote",
    "saveRegistrantContact",
    "acceptDomainConsent",
    "createDomainOrder",
    "getDomainOrder",
    "listDomainOrders",
    "getDomainPaymentRedirect",
    "resumeDomainAuthorization",
    "refreshDomainPrice",
    "requestDomainRegistration",
    "reconcileDomainOrder",
    "listDnsRecords",
    "upsertDnsRecord",
    "deleteDnsRecord",
    "setDomainAutoRenew",
    "requestDomainRenewalQuote",
    "requestDomainTransferOut"
  ];
  const runtime = {
    mode: "held",
    async readiness() {
      return {
        ready: false,
        mode: "held",
        provider: "spaceship",
        payments: "held",
        registrar: "held",
        dns: "held"
      };
    }
  };
  for (const name of names) {
    runtime[name] = async () => held(
      name.replace(/[A-Z]/gu, (value) => `_${value.toLowerCase()}`)
    );
  }
  return Object.freeze(runtime);
}

export function createPostgresDomainRuntime({
  authority,
  registrar,
  payments,
  contactVault,
  secretDelivery = null,
  mode = "held",
  testOnly = false,
  liveApproval = null,
  clock = { now: () => new Date().toISOString() },
  randomUUID = systemRandomUUID,
  serviceFeeMinor = 0,
  successUrl = "https://sitesourcery.com/abracadabra/app/?domainPayment=success",
  cancelUrl = "https://sitesourcery.com/abracadabra/app/?domainPayment=cancelled"
} = {}) {
  invariant(
    authority?.kind === "canonical-postgres" &&
      typeof authority.service === "function",
    "DOMAIN_RUNTIME_CONFIGURATION_REQUIRED",
    "Canonical PostgreSQL authority is required.",
    { status: 500 }
  );
  validateMode({
    mode,
    testOnly,
    liveApproval,
    registrar,
    payments
  });
  if (mode === "held") return createHeldDomainRuntime();
  validatePorts(mode, registrar, payments, contactVault);
  integer(serviceFeeMinor, "Domain service fee", 0, 1_000_000);
  for (const [field, value] of [
    ["Domain payment success URL", successUrl],
    ["Domain payment cancel URL", cancelUrl]
  ]) {
    const parsed = new URL(value);
    invariant(
      parsed.protocol === "https:" &&
        parsed.hostname.endsWith("sitesourcery.com"),
      "DOMAIN_RUNTIME_CONFIGURATION_REQUIRED",
      `${field} must be an HTTPS Site Sourcery URL.`,
      { status: 500 }
    );
  }

  async function projectScope(actor, projectId) {
    const userId = actorId(actor);
    const id = uuid(projectId, "Project ID");
    return authority.service(
      { userId, readOnly: true },
      async (client) => {
        const selected = await client.query(
          `select project.organization_id, membership.role
             from ss.projects project
             join ss.organization_memberships membership
               on membership.organization_id =
                    project.organization_id
              and membership.user_id = $2
              and membership.state = 'active'
            where project.id = $1
              and project.lifecycle = 'active'`,
          [id, userId]
        );
        invariant(
          selected.rowCount === 1,
          "NOT_FOUND",
          "The requested item was not found.",
          { status: 404 }
        );
        invariant(
          DOMAIN_ROLES.has(selected.rows[0].role),
          "FORBIDDEN",
          "This account cannot manage domain billing.",
          { status: 403 }
        );
        return {
          projectId: id,
          organizationId:
            selected.rows[0].organization_id,
          userId
        };
      }
    );
  }

  async function requireControl(client, providerCode) {
    const selected = await client.query(
      `select *
         from ss.domain_procurement_control
        where singleton`,
    );
    const control = selected.rows[0];
    invariant(
      control?.purchasing_enabled === true &&
        control.active_provider_code === providerCode &&
        (
          mode !== "approved_live" ||
          control.live_mode === true
        ),
      "DOMAIN_PROCUREMENT_HELD",
      "Domain purchasing is held until the exact provider, terms, and owner approval are installed.",
      { status: 503 }
    );
    return control;
  }

  async function loadOrder(client, orderId, userId) {
    const selected = await client.query(
      `select
         attempt.id as order_id,
         attempt.organization_id,
         attempt.project_id,
         attempt.quote_id,
         attempt.state as attempt_state,
         attempt.stripe_checkout_session_ref,
         attempt.provider_checkout_url,
         attempt.checkout_expires_at,
         attempt.request_digest,
         attempt.registration_intent_id,
         quote.domain_name,
         quote.term_years,
         quote.currency,
         quote.customer_price_minor,
         intent.state as intent_state,
         payment.state as payment_state,
         price_check.id as price_check_id,
         price_check.status as price_check_status,
         price_check.expires_at as price_check_expires_at,
         registration.id as registration_id,
         registration.expires_at as registration_expires_at
       from ss.domain_payment_authorization_attempts attempt
       join ss.organization_memberships membership
         on membership.organization_id = attempt.organization_id
        and membership.user_id = $2
        and membership.state = 'active'
       join ss.domain_quotes quote
         on quote.organization_id = attempt.organization_id
        and quote.id = attempt.quote_id
       left join ss.domain_registration_intents intent
         on intent.organization_id = attempt.organization_id
        and intent.id = attempt.registration_intent_id
       left join ss.domain_payment_allocations payment
         on payment.organization_id = intent.organization_id
        and payment.id = intent.payment_allocation_id
       left join lateral (
         select checked.*
           from ss.domain_price_checks checked
          where checked.registration_intent_id = intent.id
          order by checked.checked_at desc, checked.id desc
          limit 1
       ) price_check on true
       left join ss.domain_registrations registration
         on registration.organization_id = intent.organization_id
        and registration.registration_intent_id = intent.id
      where attempt.id = $1`,
      [orderId, userId]
    );
    invariant(
      selected.rowCount === 1,
      "NOT_FOUND",
      "The requested item was not found.",
      { status: 404 }
    );
    return selected.rows[0];
  }

  async function orderScope(actor, orderId) {
    const userId = actorId(actor);
    const id = uuid(orderId, "Domain order ID");
    const row = await authority.service(
      { userId, readOnly: true },
      (client) => loadOrder(client, id, userId)
    );
    return {
      orderId: id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      userId,
      row
    };
  }

  async function domainScope(actor, domainId) {
    const userId = actorId(actor);
    const id = uuid(domainId, "Domain ID");
    const row = await authority.service(
      { userId, readOnly: true },
      async (client) => {
        const selected = await client.query(
          `select registration.*, membership.role
             from ss.domain_registrations registration
             join ss.organization_memberships membership
               on membership.organization_id =
                    registration.organization_id
              and membership.user_id = $2
              and membership.state = 'active'
            where registration.id = $1`,
          [id, userId]
        );
        invariant(
          selected.rowCount === 1,
          "NOT_FOUND",
          "The requested item was not found.",
          { status: 404 }
        );
        invariant(
          DOMAIN_ROLES.has(selected.rows[0].role),
          "FORBIDDEN",
          "This account cannot manage that domain.",
          { status: 403 }
        );
        return selected.rows[0];
      }
    );
    return {
      domainId: id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      userId,
      row
    };
  }

  const runtime = {
    mode,

    async searchDomains(actor, query) {
      actorId(actor);
      const domain = canonicalDomain(query);
      const memberships = await authority.service(
        { userId: actor.userId, readOnly: true },
        (client) =>
          client.query(
            `select 1
               from ss.organization_memberships
              where user_id = $1
                and state = 'active'
              limit 1`,
            [actor.userId]
          )
      );
      invariant(
        memberships.rowCount === 1,
        "NOT_FOUND",
        "The requested item was not found.",
        { status: 404 }
      );
      try {
        const found = await registrar.searchDomains({
          query: domain
        });
        invariant(
          Array.isArray(found?.results),
          "DOMAIN_PROVIDER_RESPONSE_INVALID",
          "The registrar returned an invalid search result.",
          { status: 502 }
        );
        return {
          results: found.results.map((entry) => ({
            hostname: canonicalDomain(
              entry.hostname ?? entry.domain
            ),
            available: entry.available === true,
            result: String(entry.result ?? (
              entry.available ? "available" : "taken"
            )),
            registrar: "Spaceship",
            customerIsRegistrant: true
          }))
        };
      } catch (error) {
        if (error instanceof HostedError) throw error;
        throw providerFailure(error, "domain_search");
      }
    },

    async createDomainQuote(actor, input) {
      invariant(
        input?.projectId,
        "DOMAIN_PROJECT_REQUIRED",
        "Choose a project before requesting a domain price.",
        { status: 400 }
      );
      const scope = await projectScope(
        actor,
        input.projectId
      );
      const domain = canonicalDomain(input.hostname);
      const years = integer(
        input.years ?? 1,
        "Registration term",
        1,
        10
      );
      invariant(
        (input.purpose ?? "register") === "register",
        "DOMAIN_RENEWAL_HELD",
        "Renewal pricing is held until its exact no-charge provider quote is installed.",
        { status: 503 }
      );
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        (client) => requireControl(client, "spaceship")
      );
      let providerQuote;
      try {
        providerQuote = await registrar.quoteRegistration({
          tenantId: scope.organizationId,
          domain,
          years
        });
      } catch (error) {
        throw providerFailure(error, "domain_quote");
      }
      invariant(
        providerQuote?.status === "confirmation_required" &&
          providerQuote.domain === domain,
        "DOMAIN_UNAVAILABLE",
        "That domain is not available to register.",
        { status: 409 }
      );
      const registrarPrice = money(
        providerQuote.price,
        "Registration price"
      );
      const renewalPrice = money(
        providerQuote.renewalPrice,
        "Renewal price"
      );
      const renewalDisclosure = requiredText(
        providerQuote.renewalDisclosure,
        "Renewal disclosure",
        2_000,
        20
      );
      const quotedAt = exactIso(
        providerQuote.observedAt,
        "Quote observation time"
      );
      const expiresAt = exactIso(
        providerQuote.expiresAt,
        "Quote expiry"
      );
      invariant(
        Date.parse(expiresAt) > Date.parse(now(clock)),
        "DOMAIN_QUOTE_EXPIRED",
        "The registrar quote already expired.",
        { status: 409 }
      );
      const quoteId = randomUUID();
      const customerPriceMinor =
        registrarPrice.amountMinor + serviceFeeMinor;
      const renewalDisclosureDigest =
        digest(renewalDisclosure);
      const quoteFacts = {
        schema: "sitesourcery.domain-quote.v1",
        quoteId,
        providerQuoteRef: requiredText(
          providerQuote.quoteId,
          "Provider quote reference",
          256
        ),
        domainName: domain,
        termYears: years,
        currency: "USD",
        registrarCostMinor:
          registrarPrice.amountMinor,
        customerPriceMinor,
        renewalPriceMinor: renewalPrice.amountMinor,
        renewalDisclosureDigest,
        quotedAt,
        expiresAt
      };
      const quoteDigest = digest(quoteFacts);
      quoteFacts.quoteDigest = quoteDigest;
      return authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const control = await requireControl(
            client,
            "spaceship"
          );
          const providerReceiptId = await receipt(client, {
            randomUUID,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            providerCode: "spaceship",
            kind: "domain_quote",
            externalRef: quoteFacts.providerQuoteRef,
            facts: quoteFacts,
            occurredAt: quotedAt
          });
          await client.query(
            `insert into ss.domain_quotes (
               id, organization_id, project_id, provider_code,
               provider_quote_ref, quote_kind, domain_name,
               currency, customer_price_minor,
               registrar_cost_minor, renewal_price_minor,
               term_years, renewal_disclosure,
               renewal_disclosure_digest, quote_digest,
               provider_receipt_id, quoted_at, expires_at
             ) values (
               $1, $2, $3, 'spaceship', $4, 'registration',
               $5, 'USD', $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15
             )`,
            [
              quoteId,
              scope.organizationId,
              scope.projectId,
              quoteFacts.providerQuoteRef,
              domain,
              customerPriceMinor,
              registrarPrice.amountMinor,
              renewalPrice.amountMinor,
              years,
              renewalDisclosure,
              renewalDisclosureDigest,
              quoteDigest,
              providerReceiptId,
              quotedAt,
              expiresAt
            ]
          );
          const row = (
            await client.query(
              `select quote.*, document.version as terms_version
                 from ss.domain_quotes quote
                 join ss.legal_documents document
                   on document.id = $2
                where quote.id = $1`,
              [quoteId, control.agent_legal_document_id]
            )
          ).rows[0];
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action: "domain.quote.created",
            targetType: "domain_quote",
            targetId: quoteId,
            metadata: {
              domain,
              years,
              quoteDigest,
              customerIsRegistrant: true
            }
          });
          return { quote: publicQuote(row) };
        }
      );
    },

    async saveRegistrantContact(actor, organizationId, input) {
      const userId = actorId(actor);
      const orgId = uuid(
        organizationId,
        "Organization ID"
      );
      invariant(
        input?.projectId,
        "DOMAIN_PROJECT_REQUIRED",
        "Choose a project before saving domain owner details.",
        { status: 400 }
      );
      const scope = await projectScope(actor, input.projectId);
      invariant(
        scope.organizationId === orgId,
        "NOT_FOUND",
        "The requested item was not found.",
        { status: 404 }
      );
      const profile = {
        name: requiredText(input.name, "Registrant name", 100),
        organization: optionalText(
          input.organization,
          120
        ),
        email: requiredText(
          input.email,
          "Registrant email",
          254
        ).toLowerCase(),
        phone: requiredText(
          input.phone,
          "Registrant phone",
          40
        ),
        addressLine1: requiredText(
          input.addressLine1,
          "Street address",
          120
        ),
        addressLine2: optionalText(
          input.addressLine2,
          120
        ),
        city: requiredText(input.city, "City", 100),
        region: requiredText(
          input.region,
          "State or region",
          100
        ),
        postalCode: requiredText(
          input.postalCode,
          "Postal code",
          30
        ),
        countryCode: requiredText(
          input.countryCode,
          "Country code",
          2
        ).toUpperCase()
      };
      invariant(
        /^[A-Z]{2}$/u.test(profile.countryCode),
        "INVALID_INPUT",
        "Country code must contain exactly two letters.",
        { status: 400 }
      );
      const sealed = await contactVault.seal({
        tenantId: orgId,
        customerId: userId,
        purpose: "domain_registrant_profile",
        payload: profile
      });
      invariant(
        typeof sealed?.vaultRef === "string" &&
          sealed.vaultRef.length > 0,
        "CONTACT_VAULT_ERROR",
        "Domain owner details could not be sealed.",
        { status: 503 }
      );
      const snapshotId = randomUUID();
      const capturedAt = now(clock);
      await authority.service(
        {
          userId,
          organizationId: orgId
        },
        async (client) => {
          await requireControl(client, "spaceship");
          await client.query(
            `insert into ss.domain_registrant_snapshots (
               id, organization_id, project_id, user_id,
               schema_version, encryption_algorithm,
               encryption_key_version, contact_ciphertext,
               contact_digest, country_code,
               customer_is_registrant, captured_at
             ) values (
               $1, $2, $3, $4,
               'sitesourcery.registrant.v1', 'aes-256-gcm',
               $5, $6, $7, $8, true, $9
             )`,
            [
              snapshotId,
              orgId,
              scope.projectId,
              userId,
              `vault:${sealed.keyVersion ?? "unknown"}`,
              Buffer.from(sealed.vaultRef, "utf8"),
              digest(profile),
              profile.countryCode,
              capturedAt
            ]
          );
          await writeAudit(client, {
            organizationId: orgId,
            projectId: scope.projectId,
            actor: userId,
            action: "domain.registrant.saved",
            targetType: "domain_registrant_snapshot",
            targetId: snapshotId,
            metadata: {
              customerIsRegistrant: true,
              contactDigest: digest(profile)
            }
          });
        }
      );
      return {
        registrantContact: publicContact({
          id: snapshotId,
          project_id: scope.projectId,
          display_name: profile.name,
          display_organization: profile.organization,
          display_email: profile.email,
          display_phone: profile.phone,
          display_address_line_1: profile.addressLine1,
          display_address_line_2: profile.addressLine2,
          display_city: profile.city,
          display_region: profile.region,
          display_postal_code: profile.postalCode,
          country_code: profile.countryCode,
          captured_at: capturedAt
        })
      };
    },

    async acceptDomainConsent(actor, quoteId, input) {
      const userId = actorId(actor);
      const selectedQuoteId = uuid(
        quoteId,
        "Domain quote ID"
      );
      invariant(
        input?.registrationAgreementAccepted === true &&
          input?.registrantCertificationAccepted === true,
        "DOMAIN_CONSENT_REQUIRED",
        "Accept the registration agreement and certify the customer’s domain owner details.",
        { status: 400 }
      );
      const snapshotId = uuid(
        input.registrantContactId,
        "Registrant contact ID"
      );
      const selected = await authority.service(
        { userId, readOnly: true },
        async (client) => {
          const result = await client.query(
            `select
               quote.*,
               document.id as legal_document_id,
               document.version as terms_version,
               registrant.id as registrant_snapshot_id
             from ss.domain_quotes quote
             join ss.organization_memberships membership
               on membership.organization_id =
                    quote.organization_id
              and membership.user_id = $3
              and membership.state = 'active'
              and membership.role in ('owner', 'admin', 'billing')
             join ss.domain_procurement_control control
               on control.singleton
              and control.purchasing_enabled
              and control.active_provider_code =
                   quote.provider_code
             join ss.legal_documents document
               on document.id =
                    control.agent_legal_document_id
              and document.kind = 'domain_agent'
              and document.retired_at is null
             join ss.domain_registrant_snapshots registrant
               on registrant.organization_id =
                    quote.organization_id
              and registrant.project_id = quote.project_id
              and registrant.id = $2
              and registrant.user_id = $3
              and registrant.customer_is_registrant
            where quote.id = $1
              and quote.status = 'open'
              and quote.expires_at > $4`,
            [
              selectedQuoteId,
              snapshotId,
              userId,
              now(clock)
            ]
          );
          invariant(
            result.rowCount === 1,
            "DOMAIN_CONSENT_PREREQUISITES_REQUIRED",
            "The current quote and customer domain owner details are required.",
            { status: 409 }
          );
          return result.rows[0];
        }
      );
      invariant(
        requiredText(
          input.termsVersion,
          "Domain terms version",
          120
        ) === selected.terms_version,
        "DOMAIN_TERMS_MISMATCH",
        "Request a new domain price and review its current agreement.",
        { status: 409 }
      );
      const organizationId = selected.organization_id;
      const projectId = selected.project_id;
      const selectedCommandId = commandId(
        input.commandId
      );
      const requestDigest = digest({
        route: "domain.consent",
        quoteId: selectedQuoteId,
        snapshotId,
        termsVersion: selected.terms_version,
        autoRenewRequested:
          input.autoRenewRequested === true,
        customerIsRegistrant: true
      });
      return authority.service(
        { userId, organizationId },
        async (client) => {
          const replay = await client.query(
            `select consent.*
               from ss.domain_agent_consents consent
              where consent.organization_id = $1
                and consent.quote_id = $2
                and consent.user_id = $3
                and consent.request_id = (
                  select id
                    from ss.idempotency_keys
                   where principal_id = $3
                     and route_key = 'domain.consent'
                     and idempotency_key = $4
                )`,
            [
              organizationId,
              selectedQuoteId,
              userId,
              selectedCommandId
            ]
          );
          if (replay.rowCount === 1) {
            const row = replay.rows[0];
            return {
              consent: {
                id: row.id,
                consentId: row.id,
                quoteId: row.quote_id,
                registrantContactId:
                  row.registrant_snapshot_id,
                customerRemainsRegistrant: true,
                termsVersion: selected.terms_version,
                autoRenewRequested:
                  input.autoRenewRequested === true,
                consentedAt: new Date(
                  row.consented_at
                ).toISOString()
              }
            };
          }
          const requestId = randomUUID();
          await client.query(
            `insert into ss.idempotency_keys (
               id, organization_id, principal_id, route_key,
               idempotency_key, request_digest, state,
               created_at, expires_at
             ) values (
               $1, $2, $3, 'domain.consent', $4, $5,
               'running', $6, $6::timestamptz + interval '24 hours'
             )`,
            [
              requestId,
              organizationId,
              userId,
              selectedCommandId,
              requestDigest,
              now(clock)
            ]
          );
          const acceptanceId = randomUUID();
          const consentId = randomUUID();
          const consentedAt = now(clock);
          await client.query(
            `insert into ss.term_acceptances (
               id, organization_id, project_id, user_id,
               document_id, accepted_at, request_id
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              acceptanceId,
              organizationId,
              projectId,
              userId,
              selected.legal_document_id,
              consentedAt,
              requestId
            ]
          );
          await client.query(
            `insert into ss.domain_agent_consents (
               id, organization_id, project_id, user_id,
               quote_id, registrant_snapshot_id,
               legal_document_id, term_acceptance_id,
               agent_role, customer_remains_registrant,
               authorization_statement_digest,
               irreversible_disclosure_digest,
               request_id, consented_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               'authorized_registration_agent', true,
               $9, $10, $11, $12
             )`,
            [
              consentId,
              organizationId,
              projectId,
              userId,
              selectedQuoteId,
              snapshotId,
              selected.legal_document_id,
              acceptanceId,
              digest({
                schema:
                  "sitesourcery.domain-agent-consent.v1",
                quoteDigest: selected.quote_digest,
                customerRemainsRegistrant: true,
                siteSourceryRole: "authorized_agent",
                termsVersion: selected.terms_version
              }),
              digest({
                schema:
                  "sitesourcery.domain-registration-disclosure.v1",
                domain: selected.domain_name,
                amountMinor: Number(
                  selected.customer_price_minor
                ),
                currency: selected.currency,
                registrar: "Spaceship",
                noCancellationAfterSubmission: true
              }),
              requestId,
              consentedAt
            ]
          );
          const response = {
            consent: {
              id: consentId,
              consentId,
              quoteId: selectedQuoteId,
              registrantContactId: snapshotId,
              customerRemainsRegistrant: true,
              termsVersion: selected.terms_version,
              autoRenewRequested:
                input.autoRenewRequested === true,
              consentedAt
            }
          };
          await client.query(
            `update ss.idempotency_keys
                set state = 'completed',
                    response_status = 201,
                    response_body = $2::jsonb
              where id = $1`,
            [requestId, JSON.stringify(response)]
          );
          await writeAudit(client, {
            organizationId,
            projectId,
            actor: userId,
            action: "domain.consent.accepted",
            targetType: "domain_agent_consent",
            targetId: consentId,
            requestId,
            metadata: {
              quoteId: selectedQuoteId,
              customerRemainsRegistrant: true
            }
          });
          return response;
        }
      );
    },

    async createDomainOrder(actor, projectId, input) {
      const scope = await projectScope(actor, projectId);
      const selectedQuoteId = uuid(
        input.quoteId,
        "Domain quote ID"
      );
      const consentId = uuid(
        input.consentId,
        "Domain consent ID"
      );
      const selectedCommandId = commandId(
        input.commandId
      );
      const staged = await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await requireControl(client, "spaceship");
          const existing = await client.query(
            `select attempt.*
               from ss.domain_payment_authorization_attempts attempt
              where attempt.organization_id = $1
                and attempt.idempotency_key = $2
              for update`,
            [
              scope.organizationId,
              selectedCommandId
            ]
          );
          if (existing.rowCount === 1) {
            const row = existing.rows[0];
            invariant(
              row.quote_id === selectedQuoteId &&
                row.agent_consent_id === consentId,
              "IDEMPOTENCY_CONFLICT",
              "That idempotency key was used for another domain order.",
              { status: 409 }
            );
            invariant(
              row.state !== "dispatching",
              "DOMAIN_PAYMENT_RECONCILIATION_REQUIRED",
              "The earlier payment session creation has an uncertain result and will not be retried automatically.",
              { status: 409 }
            );
            return {
              replay: true,
              orderId: row.id,
              quoteId: row.quote_id
            };
          }
          const exact = await client.query(
            `select
               quote.*,
               consent.registrant_snapshot_id,
               consent.user_id as consent_user_id
             from ss.domain_quotes quote
             join ss.domain_agent_consents consent
               on consent.organization_id =
                    quote.organization_id
              and consent.project_id = quote.project_id
              and consent.quote_id = quote.id
              and consent.id = $4
              and consent.user_id = $3
              and consent.customer_remains_registrant
            where quote.organization_id = $1
              and quote.project_id = $2
              and quote.id = $5
              and quote.quote_kind = 'registration'
              and quote.status = 'open'
              and quote.expires_at > $6`,
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              consentId,
              selectedQuoteId,
              now(clock)
            ]
          );
          invariant(
            exact.rowCount === 1,
            "DOMAIN_ORDER_PREREQUISITES_REQUIRED",
            "A current quote and matching customer consent are required.",
            { status: 409 }
          );
          const quote = exact.rows[0];
          const orderId = randomUUID();
          const purpose = purposeFor({
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            customerId: scope.userId,
            orderId,
            quoteId: quote.id,
            domain: quote.domain_name,
            years: Number(quote.term_years),
            amountMinor: Number(
              quote.customer_price_minor
            )
          });
          await client.query(
            `insert into ss.domain_payment_authorization_attempts (
               id, organization_id, project_id,
               requested_by_user_id, quote_id,
               agent_consent_id, idempotency_key,
               request_digest, state, requested_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               'dispatching', $9
             )`,
            [
              orderId,
              scope.organizationId,
              scope.projectId,
              scope.userId,
              quote.id,
              consentId,
              selectedCommandId,
              digest(purpose),
              now(clock)
            ]
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action:
              "domain.payment_checkout.dispatching",
            targetType:
              "domain_payment_authorization_attempt",
            targetId: orderId,
            metadata: {
              quoteId: quote.id,
              purposeDigest: digest(purpose)
            }
          });
          return {
            replay: false,
            orderId,
            quoteId: quote.id,
            domain: quote.domain_name,
            years: Number(quote.term_years),
            amountMinor: Number(
              quote.customer_price_minor
            ),
            currency: quote.currency,
            purpose,
            purposeDigest: digest(purpose)
          };
        }
      );
      if (staged.replay) {
        return runtime.getDomainOrder(
          actor,
          staged.orderId
        );
      }
      let checkout;
      let providerCheckoutUrl;
      try {
        checkout =
          await payments.createDomainAuthorizationCheckout({
            orderId: staged.orderId,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            customerId: scope.userId,
            quoteId: staged.quoteId,
            domain: staged.domain,
            years: staged.years,
            amountMinor: staged.amountMinor,
            currency: staged.currency,
            purposeDigest: staged.purposeDigest,
            successUrl,
            cancelUrl,
            idempotencyKey:
              `domain-checkout:${scope.organizationId}:${staged.orderId}`
          });
        providerCheckoutUrl =
          exactStripeCheckoutUrl(checkout?.url);
        invariant(
          checkout?.status === "open" &&
            typeof checkout.checkoutSessionId ===
              "string" &&
            checkout.checkoutSessionId.length > 0 &&
            checkout.captureMethod === "manual" &&
            checkout.amountMinor === staged.amountMinor &&
            checkout.currency === staged.currency &&
            checkout.purposeDigest ===
              staged.purposeDigest,
          "DOMAIN_PAYMENT_PROVIDER_RESPONSE_INVALID",
          "Stripe did not return the exact held domain authorization Checkout.",
          { status: 502 }
        );
      } catch (error) {
        const uncertain = !(
          error instanceof ExternalEffectError &&
          error.certainty === "not_submitted"
        );
        await authority.service(
          {
            userId: scope.userId,
            organizationId: scope.organizationId
          },
          (client) =>
            client.query(
              `update ss.domain_payment_authorization_attempts
                  set state = $2,
                      failure_code = $3
                where id = $1
                  and state = 'dispatching'`,
              [
                staged.orderId,
                uncertain
                  ? "manual_review"
                  : "not_submitted",
                error?.code ??
                  "stripe_checkout_creation_failed"
              ]
            )
        );
        if (error instanceof HostedError) throw error;
        throw providerFailure(
          error,
          "domain_payment_checkout"
        );
      }
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const updated = await client.query(
            `update ss.domain_payment_authorization_attempts
                set state = 'checkout_created',
                    stripe_checkout_session_ref = $2,
                    provider_checkout_url = $3,
                    checkout_expires_at = $4
              where id = $1
                and state = 'dispatching'
            returning id`,
            [
              staged.orderId,
              checkout.checkoutSessionId,
              providerCheckoutUrl,
              exactIso(
                checkout.expiresAt,
                "Checkout expiry"
              )
            ]
          );
          invariant(
            updated.rowCount === 1,
            "DOMAIN_PAYMENT_RECONCILIATION_REQUIRED",
            "The domain payment session requires reconciliation.",
            { status: 409 }
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action: "domain.payment_checkout.created",
            targetType:
              "domain_payment_authorization_attempt",
            targetId: staged.orderId,
            metadata: {
              checkoutSessionId:
                checkout.checkoutSessionId,
              purposeDigest: staged.purposeDigest
            }
          });
        }
      );
      return runtime.getDomainOrder(
        actor,
        staged.orderId
      );
    },

    async getDomainOrder(actor, orderId) {
      const scope = await orderScope(actor, orderId);
      return { domainOrder: publicOrder(scope.row) };
    },

    async listDomainOrders(actor, projectId) {
      const scope = await projectScope(actor, projectId);
      const rows = await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => {
          const ids = await client.query(
            `select id
               from ss.domain_payment_authorization_attempts
              where organization_id = $1
                and project_id = $2
              order by requested_at desc, id desc`,
            [
              scope.organizationId,
              scope.projectId
            ]
          );
          const output = [];
          for (const row of ids.rows) {
            output.push(
              publicOrder(
                await loadOrder(
                  client,
                  row.id,
                  scope.userId
                )
              )
            );
          }
          return output;
        }
      );
      return { domainOrders: rows };
    },

    async getDomainPaymentRedirect(actor, orderId) {
      const scope = await orderScope(actor, orderId);
      invariant(
        scope.row.attempt_state === "checkout_created" &&
        scope.row.stripe_checkout_session_ref &&
          scope.row.provider_checkout_url &&
          Date.parse(scope.row.checkout_expires_at ?? "") >
            Date.parse(now(clock)) &&
          !scope.row.registration_intent_id,
        "DOMAIN_PAYMENT_ALREADY_HANDLED",
        "That domain payment session is no longer open.",
        { status: 409 }
      );
      const result =
        await payments.retrieveDomainAuthorization({
          checkoutSessionId:
            scope.row.stripe_checkout_session_ref,
          orderId: scope.orderId,
          purposeDigest: scope.row.request_digest
        });
      invariant(
        result?.status === "pending" &&
          result.checkoutSessionId ===
            scope.row.stripe_checkout_session_ref &&
          result.amountMinor ===
            Number(scope.row.customer_price_minor) &&
          result.currency === scope.row.currency &&
          result.captureMethod === "manual" &&
          result.purposeDigest ===
            scope.row.request_digest,
        "DOMAIN_PAYMENT_ALREADY_HANDLED",
        "That domain payment session is no longer open.",
        { status: 409 }
      );
      return {
        url: exactStripeCheckoutUrl(
          scope.row.provider_checkout_url
        )
      };
    },

    async resumeDomainAuthorization({
      checkoutSessionId,
      verifiedEventId = null,
      verifiedAt = null
    } = {}) {
      const sessionId = requiredText(
        checkoutSessionId,
        "Checkout session ID",
        256
      );
      const staged = await authority.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select
               attempt.*,
               quote.domain_name,
               quote.term_years,
               quote.currency,
               quote.customer_price_minor,
               quote.provider_code,
               consent.registrant_snapshot_id
             from ss.domain_payment_authorization_attempts attempt
             join ss.domain_quotes quote
               on quote.organization_id =
                    attempt.organization_id
              and quote.id = attempt.quote_id
             join ss.domain_agent_consents consent
               on consent.organization_id =
                    attempt.organization_id
              and consent.id = attempt.agent_consent_id
            where attempt.stripe_checkout_session_ref = $1`,
            [sessionId]
          );
          invariant(
            selected.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          return selected.rows[0];
        }
      );
      if (
        staged.state === "completed" &&
        staged.registration_intent_id
      ) {
        return {
          orderId: staged.id,
          state: "authorized",
          registrationIntentId:
            staged.registration_intent_id,
          replay: true
        };
      }
      invariant(
        staged.state === "checkout_created",
        "DOMAIN_PAYMENT_RECONCILIATION_REQUIRED",
        "That domain payment is not in an authorizable state.",
        { status: 409 }
      );
      const purpose = purposeFor({
        organizationId: staged.organization_id,
        projectId: staged.project_id,
        customerId: staged.requested_by_user_id,
        orderId: staged.id,
        quoteId: staged.quote_id,
        domain: staged.domain_name,
        years: Number(staged.term_years),
        amountMinor: Number(
          staged.customer_price_minor
        )
      });
      const purposeDigest = digest(purpose);
      invariant(
        purposeDigest === staged.request_digest,
        "DOMAIN_PAYMENT_AUTHORITY_CHANGED",
        "The saved domain payment purpose no longer matches.",
        { status: 409 }
      );
      let authorization;
      try {
        authorization =
          await payments.retrieveDomainAuthorization({
            checkoutSessionId: sessionId,
            orderId: staged.id,
            purposeDigest
          });
      } catch (error) {
        throw providerFailure(
          error,
          "domain_payment_authorization"
        );
      }
      if (authorization?.status === "pending") {
        return {
          orderId: staged.id,
          state: "awaiting_payment",
          replay: false
        };
      }
      invariant(
        authorization?.status === "authorized" &&
          typeof authorization.paymentIntentId ===
            "string" &&
          authorization.paymentIntentId.length > 0 &&
          authorization.checkoutSessionId === sessionId &&
          authorization.amountMinor ===
            Number(staged.customer_price_minor) &&
          authorization.currency === staged.currency &&
          authorization.captureMethod === "manual" &&
          authorization.purposeDigest === purposeDigest,
        "DOMAIN_PAYMENT_AUTHORIZATION_INVALID",
        "Stripe did not verify the exact manual domain authorization.",
        { status: 409 }
      );
      const authorizedAt = exactIso(
        authorization.authorizedAt,
        "Authorization time"
      );
      const authorizationExpiresAt = exactIso(
        authorization.authorizationExpiresAt,
        "Authorization expiry"
      );
      invariant(
        Date.parse(authorizationExpiresAt) -
          Date.parse(now(clock)) >=
          MINIMUM_AUTHORIZATION_REMAINING_MS,
        "DOMAIN_PAYMENT_AUTHORIZATION_TOO_SHORT",
        "The payment authorization expires too soon to register safely.",
        { status: 409 }
      );
      const allocationId = randomUUID();
      const intentId = randomUUID();
      return authority.service(
        {
          userId: staged.requested_by_user_id,
          organizationId: staged.organization_id
        },
        async (client) => {
          await requireControl(
            client,
            staged.provider_code
          );
          const locked = await client.query(
            `select *
               from ss.domain_payment_authorization_attempts
              where id = $1
              for update`,
            [staged.id]
          );
          if (
            locked.rows[0]?.state === "completed" &&
            locked.rows[0].registration_intent_id
          ) {
            return {
              orderId: staged.id,
              state: "authorized",
              registrationIntentId:
                locked.rows[0].registration_intent_id,
              replay: true
            };
          }
          invariant(
            locked.rows[0]?.state ===
              "checkout_created",
            "DOMAIN_PAYMENT_RECONCILIATION_REQUIRED",
            "That domain payment changed while authorization was being verified.",
            { status: 409 }
          );
          const facts = {
            schema:
              "sitesourcery.domain-payment-authorization.v1",
            quoteId: staged.quote_id,
            orderId: staged.id,
            checkoutSessionId: sessionId,
            paymentIntentId:
              authorization.paymentIntentId,
            amountMinor: Number(
              staged.customer_price_minor
            ),
            currency: staged.currency,
            captureMethod: "manual",
            purposeDigest,
            authorizedAt,
            authorizationExpiresAt,
            verifiedEventId,
            verifiedAt
          };
          const paymentReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: staged.organization_id,
              projectId: staged.project_id,
              providerCode: "stripe",
              kind: "domain_payment_authorized",
              externalRef:
                authorization.paymentIntentId,
              facts,
              occurredAt: authorizedAt
            }
          );
          await client.query(
            `insert into ss.domain_payment_allocations (
               id, organization_id, project_id, quote_id,
               stripe_provider_receipt_id,
               stripe_payment_reference, currency,
               amount_minor, state, recorded_at,
               authorized_at, authorization_expires_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               'authorized', $9, $10, $11
             )`,
            [
              allocationId,
              staged.organization_id,
              staged.project_id,
              staged.quote_id,
              paymentReceiptId,
              authorization.paymentIntentId,
              staged.currency,
              Number(staged.customer_price_minor),
              now(clock),
              authorizedAt,
              authorizationExpiresAt
            ]
          );
          await client.query(
            `insert into ss.domain_registration_intents (
               id, organization_id, project_id,
               requested_by_user_id, quote_id,
               registrant_snapshot_id, agent_consent_id,
               payment_allocation_id, domain_name,
               provider_code, state, idempotency_key,
               request_digest, created_at, updated_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, 'awaiting_confirmation', $11, $12,
               $13, $13
             )`,
            [
              intentId,
              staged.organization_id,
              staged.project_id,
              staged.requested_by_user_id,
              staged.quote_id,
              staged.registrant_snapshot_id,
              staged.agent_consent_id,
              allocationId,
              staged.domain_name,
              staged.provider_code,
              `domain-order:${staged.id}`,
              purposeDigest,
              now(clock)
            ]
          );
          await client.query(
            `update ss.domain_payment_authorization_attempts
                set state = 'completed',
                    stripe_payment_reference = $2,
                    stripe_provider_receipt_id = $3,
                    registration_intent_id = $4
              where id = $1`,
            [
              staged.id,
              authorization.paymentIntentId,
              paymentReceiptId,
              intentId
            ]
          );
          await writeAudit(client, {
            organizationId: staged.organization_id,
            projectId: staged.project_id,
            actor: "system",
            action: "domain.payment.authorized",
            targetType: "domain_registration_intent",
            targetId: intentId,
            metadata: {
              orderId: staged.id,
              purposeDigest,
              verifiedEventId,
              customerCharged: false
            }
          });
          return {
            orderId: staged.id,
            state: "authorized",
            registrationIntentId: intentId,
            replay: false
          };
        }
      );
    },

    async refreshDomainPrice(actor, orderId, input) {
      const scope = await orderScope(actor, orderId);
      const selectedCommandId = commandId(
        input.commandId
      );
      invariant(
        scope.row.registration_intent_id &&
          scope.row.payment_state === "authorized",
        "DOMAIN_PAYMENT_AUTHORIZATION_REQUIRED",
        "Complete the held payment authorization before the final domain price check.",
        { status: 409 }
      );
      const evidence = await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) => {
          const selected = await client.query(
            `select
               intent.*,
               quote.registrar_cost_minor,
               quote.customer_price_minor,
               quote.currency,
               quote.term_years,
               quote.quote_digest,
               quote.expires_at as quote_expires_at,
               registrant.contact_ciphertext,
               registrant.contact_digest,
               payment.authorization_expires_at
             from ss.domain_registration_intents intent
             join ss.domain_quotes quote
               on quote.organization_id =
                    intent.organization_id
              and quote.id = intent.quote_id
             join ss.domain_registrant_snapshots registrant
               on registrant.organization_id =
                    intent.organization_id
              and registrant.id =
                    intent.registrant_snapshot_id
             join ss.domain_payment_allocations payment
               on payment.organization_id =
                    intent.organization_id
              and payment.id =
                    intent.payment_allocation_id
            where intent.id = $1
              and intent.state = 'awaiting_confirmation'
              and payment.state = 'authorized'`,
            [scope.row.registration_intent_id]
          );
          invariant(
            selected.rowCount === 1,
            "DOMAIN_ORDER_NOT_READY",
            "That domain order is not ready for a price check.",
            { status: 409 }
          );
          return selected.rows[0];
        }
      );
      invariant(
        Date.parse(evidence.authorization_expires_at) -
          Date.parse(now(clock)) >=
          MINIMUM_AUTHORIZATION_REMAINING_MS,
        "DOMAIN_PAYMENT_AUTHORIZATION_TOO_SHORT",
        "The payment authorization expires too soon to register safely.",
        { status: 409 }
      );
      let contacts;
      let preview;
      try {
        contacts = await registrar.ensureContacts({
          tenantId: scope.organizationId,
          customerId: scope.userId,
          domain: evidence.domain_name,
          registrantProfileRef:
            Buffer.from(
              evidence.contact_ciphertext
            ).toString("utf8"),
          registrantProfileDigest:
            evidence.contact_digest,
          customerIsRegistrant: true
        });
        preview = await registrar.previewRegistration({
          tenantId: scope.organizationId,
          domain: evidence.domain_name,
          years: Number(evidence.term_years),
          autoRenew: false,
          privacy: {
            level: "high",
            userConsent: true
          },
          contacts
        });
      } catch (error) {
        throw providerFailure(
          error,
          "domain_price_check"
        );
      }
      invariant(
        preview?.status === "confirmation_required" &&
          preview.domain === evidence.domain_name,
        "DOMAIN_PRICE_CHANGED",
        "The domain is no longer available at the accepted price.",
        { status: 409 }
      );
      const exactPrice = money(
        preview.price,
        "Final registration price"
      );
      const checkedAt = exactIso(
        preview.observedAt ?? now(clock),
        "Price check time"
      );
      const expiresAt = exactIso(
        preview.expiresAt ??
          new Date(
            Date.parse(checkedAt) + 5 * 60 * 1000
          ).toISOString(),
        "Price check expiry"
      );
      const status =
        exactPrice.amountMinor ===
          Number(evidence.registrar_cost_minor)
          ? "ready"
          : "changed";
      const contactDigest = digest(contacts);
      const priceCheckId = randomUUID();
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          let contactSet = await client.query(
            `select id
               from ss.domain_provider_contact_sets
              where registrant_snapshot_id = $1
                and provider_code = 'spaceship'`,
            [evidence.registrant_snapshot_id]
          );
          if (contactSet.rowCount === 0) {
            const facts = {
              schema:
                "sitesourcery.domain-provider-contacts.v1",
              registrantSnapshotId:
                evidence.registrant_snapshot_id,
              customerIsRegistrant: true,
              contactReferencesDigest: contactDigest
            };
            const providerReceiptId = await receipt(
              client,
              {
                randomUUID,
                organizationId: scope.organizationId,
                projectId: scope.projectId,
                providerCode: "spaceship",
                kind: "domain_contact_set",
                externalRef:
                  `${scope.organizationId}:${contactDigest}`,
                facts,
                occurredAt: checkedAt
              }
            );
            const contactSetId = randomUUID();
            await client.query(
              `insert into ss.domain_provider_contact_sets (
                 id, organization_id, project_id,
                 registrant_snapshot_id, provider_code,
                 provider_receipt_id, contact_references,
                 contact_references_digest, created_at
               ) values (
                 $1, $2, $3, $4, 'spaceship', $5,
                 $6::jsonb, $7, $8
               )`,
              [
                contactSetId,
                scope.organizationId,
                scope.projectId,
                evidence.registrant_snapshot_id,
                providerReceiptId,
                JSON.stringify(contacts),
                contactDigest,
                checkedAt
              ]
            );
            contactSet = { rows: [{ id: contactSetId }] };
          }
          const quoteFacts = {
            schema:
              "sitesourcery.domain-price-check.v1",
            orderId: scope.orderId,
            registrationIntentId:
              evidence.id,
            providerQuoteRef: requiredText(
              preview.quoteId,
              "Provider price-check reference",
              256
            ),
            domainName: evidence.domain_name,
            currency: "USD",
            registrarCostMinor:
              exactPrice.amountMinor,
            acceptedRegistrarCostMinor: Number(
              evidence.registrar_cost_minor
            ),
            status,
            quoteDigest: evidence.quote_digest,
            checkedAt,
            expiresAt
          };
          const providerReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              providerCode: "spaceship",
              kind: "domain_price_check",
              externalRef:
                quoteFacts.providerQuoteRef,
              facts: quoteFacts,
              occurredAt: checkedAt
            }
          );
          await client.query(
            `insert into ss.domain_price_checks (
               id, organization_id, project_id,
               registration_intent_id, provider_receipt_id,
               provider_quote_ref, currency,
               registrar_cost_minor, quote_digest, status,
               checked_at, expires_at
             ) values (
               $1, $2, $3, $4, $5, $6, 'USD', $7,
               $8, $9, $10, $11
             )`,
            [
              priceCheckId,
              scope.organizationId,
              scope.projectId,
              evidence.id,
              providerReceiptId,
              quoteFacts.providerQuoteRef,
              exactPrice.amountMinor,
              evidence.quote_digest,
              status,
              checkedAt,
              expiresAt
            ]
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action: "domain.price.rechecked",
            targetType: "domain_price_check",
            targetId: priceCheckId,
            metadata: {
              orderId: scope.orderId,
              status,
              amountMinor: exactPrice.amountMinor
            }
          });
        }
      );
      return {
        priceCheck: {
          id: priceCheckId,
          priceCheckId,
          orderId: scope.orderId,
          status,
          ready: status === "ready",
          price: exactPrice,
          expiresAt,
          ...(status === "changed"
            ? {
                instruction:
                  "Do not register or capture. Void the authorization and request a new quote."
              }
            : {})
        }
      };
    },

    async requestDomainRegistration(actor, orderId, input) {
      const scope = await orderScope(actor, orderId);
      const priceCheckId = uuid(
        input.priceCheckId,
        "Fresh price check ID"
      );
      invariant(
        input.irreversibleRegistrationAccepted ===
          true,
        "DOMAIN_REGISTRATION_CONFIRMATION_REQUIRED",
        "Confirm that registration is irreversible before submitting it.",
        { status: 400 }
      );
      const selectedCommandId = commandId(
        input.commandId
      );
      const staged = await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await requireControl(client, "spaceship");
          const exact = await client.query(
            `select
               intent.*,
               quote.quote_digest,
               quote.customer_price_minor,
               quote.registrar_cost_minor,
               quote.currency,
               quote.term_years,
               payment.state as payment_state,
               payment.authorization_expires_at,
               price_check.id as price_check_id,
               price_check.status as price_check_status,
               price_check.expires_at as price_check_expires_at,
               contact_set.contact_references
             from ss.domain_registration_intents intent
             join ss.domain_quotes quote
               on quote.organization_id =
                    intent.organization_id
              and quote.id = intent.quote_id
             join ss.domain_payment_allocations payment
               on payment.organization_id =
                    intent.organization_id
              and payment.id =
                    intent.payment_allocation_id
             join ss.domain_price_checks price_check
               on price_check.organization_id =
                    intent.organization_id
              and price_check.registration_intent_id =
                    intent.id
              and price_check.id = $2
             join ss.domain_provider_contact_sets contact_set
               on contact_set.organization_id =
                    intent.organization_id
              and contact_set.registrant_snapshot_id =
                    intent.registrant_snapshot_id
              and contact_set.provider_code =
                    intent.provider_code
            where intent.id = $1
            for update of intent`,
            [
              scope.row.registration_intent_id,
              priceCheckId
            ]
          );
          invariant(
            exact.rowCount === 1,
            "DOMAIN_PRICE_CHECK_REQUIRED",
            "A fresh exact price check is required.",
            { status: 409 }
          );
          const row = exact.rows[0];
          if (
            [
              "confirmed",
              "submitted",
              "processing",
              "registered"
            ].includes(row.state)
          ) {
            const prior = await client.query(
              `select *
                 from ss.domain_provider_operations
                where subject_kind = 'registration'
                  and subject_id = $1
                  and operation_kind = 'register'
                order by requested_at desc
                limit 1`,
              [row.id]
            );
            invariant(
              prior.rowCount === 1,
              "DOMAIN_REGISTRATION_RECONCILIATION_REQUIRED",
              "The registration state requires operator reconciliation.",
              { status: 409 }
            );
            return {
              replay: true,
              operationId: prior.rows[0].id,
              externalOperationId:
                prior.rows[0].external_operation_ref
            };
          }
          invariant(
            row.state === "awaiting_confirmation" &&
              row.payment_state === "authorized" &&
              row.price_check_status === "ready" &&
              Date.parse(row.price_check_expires_at) >
                Date.parse(now(clock)) &&
              Date.parse(
                row.authorization_expires_at
              ) -
                Date.parse(now(clock)) >=
                MINIMUM_AUTHORIZATION_REMAINING_MS,
            "DOMAIN_ORDER_NOT_READY",
            "The quote, authorization, or final price check is no longer safe to submit.",
            { status: 409 }
          );
          const confirmationId = randomUUID();
          const operationId = randomUUID();
          const confirmedAt = now(clock);
          const evidence = {
            schema:
              "sitesourcery.domain-irreversible-confirmation.v1",
            orderId: scope.orderId,
            registrationIntentId: row.id,
            priceCheckId,
            quoteDigest: row.quote_digest,
            accepted: true,
            customerIsRegistrant: true,
            confirmedAt
          };
          await client.query(
            `insert into ss.domain_irreversible_confirmations (
               id, organization_id, project_id,
               registration_intent_id,
               confirmed_by_user_id,
               confirmation_statement_version,
               confirmation_evidence_digest, quote_digest,
               confirmed_at
             ) values (
               $1, $2, $3, $4, $5,
               'sitesourcery.domain-confirmation.v1',
               $6, $7, $8
             )`,
            [
              confirmationId,
              scope.organizationId,
              scope.projectId,
              row.id,
              scope.userId,
              digest(evidence),
              row.quote_digest,
              confirmedAt
            ]
          );
          await client.query(
            `update ss.domain_registration_intents
                set state = 'confirmed',
                    irreversible_confirmed_at = $2,
                    confirmed_by_user_id = $3,
                    updated_at = $2
              where id = $1`,
            [row.id, confirmedAt, scope.userId]
          );
          const requestDigest = digest({
            schema:
              "sitesourcery.domain-registration-operation.v1",
            orderId: scope.orderId,
            intentId: row.id,
            priceCheckId,
            domain: row.domain_name,
            years: Number(row.term_years),
            registrarPriceMinor: Number(
              row.registrar_cost_minor
            ),
            contactReferencesDigest: digest(
              row.contact_references
            )
          });
          await client.query(
            `insert into ss.domain_provider_operations (
               id, organization_id, project_id,
               subject_kind, subject_id, operation_kind,
               provider_code, idempotency_key,
               request_digest, state, requested_at
             ) values (
               $1, $2, $3, 'registration', $4,
               'register', 'spaceship', $5, $6,
               'queued', $7
             )`,
            [
              operationId,
              scope.organizationId,
              scope.projectId,
              row.id,
              selectedCommandId,
              requestDigest,
              confirmedAt
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, occurred_at
             ) values ($1, $2, $3, $4, 'queued', $5)`,
            [
              randomUUID(),
              scope.organizationId,
              scope.projectId,
              operationId,
              confirmedAt
            ]
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action:
              "domain.registration.dispatching",
            targetType: "domain_provider_operation",
            targetId: operationId,
            metadata: {
              orderId: scope.orderId,
              priceCheckId,
              customerCharged: false
            }
          });
          return {
            replay: false,
            intentId: row.id,
            operationId,
            domain: row.domain_name,
            years: Number(row.term_years),
            registrarPrice: {
              amountMinor: Number(
                row.registrar_cost_minor
              ),
              currency: row.currency
            },
            contacts: row.contact_references
          };
        }
      );
      if (!staged.replay) {
        let submitted;
        try {
          submitted =
            await registrar.confirmRegistration({
              tenantId: scope.organizationId,
              attemptId: staged.operationId,
              domain: staged.domain,
              years: staged.years,
              autoRenew: false,
              privacy: {
                level: "high",
                userConsent: true
              },
              contacts: staged.contacts,
              expectedPrice: staged.registrarPrice
            });
          invariant(
            typeof submitted?.operationId ===
              "string" &&
              submitted.operationId.length > 0,
            "DOMAIN_REGISTRATION_PROVIDER_RESPONSE_INVALID",
            "The registrar did not return an operation reference.",
            { status: 502 }
          );
        } catch (error) {
          const notSubmitted =
            error instanceof ExternalEffectError &&
            error.certainty === "not_submitted";
          await authority.service(
            {
              userId: scope.userId,
              organizationId: scope.organizationId
            },
            async (client) => {
              await client.query(
                `update ss.domain_provider_operations
                    set state = $2,
                        failure_code = $3
                  where id = $1
                    and state = 'queued'`,
                [
                  staged.operationId,
                  notSubmitted
                    ? "failed"
                    : "manual_review",
                  error?.code ??
                    "registrar_confirmation_failed"
                ]
              );
              await client.query(
                `insert into ss.domain_provider_operation_events (
                   id, organization_id, project_id,
                   operation_id, state, failure_code,
                   occurred_at
                 ) values ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  randomUUID(),
                  scope.organizationId,
                  scope.projectId,
                  staged.operationId,
                  notSubmitted
                    ? "failed"
                    : "manual_review",
                  error?.code ??
                    "registrar_confirmation_failed",
                  now(clock)
                ]
              );
              await client.query(
                `update ss.domain_registration_intents
                    set state = $2,
                        failure_code = $3,
                        updated_at = $4
                  where id = $1`,
                [
                  staged.intentId,
                  notSubmitted
                    ? "failed"
                    : "manual_review",
                  error?.code ??
                    "registrar_confirmation_failed",
                  now(clock)
                ]
              );
            }
          );
          if (error instanceof HostedError) throw error;
          throw providerFailure(
            error,
            "domain_registration"
          );
        }
        const providerPrice =
          submitted.price === null ||
          submitted.price === undefined
            ? null
            : money(
                submitted.price,
                "Registrar confirmation price"
              );
        await authority.service(
          {
            userId: scope.userId,
            organizationId: scope.organizationId
          },
          async (client) => {
            await client.query(
              `update ss.domain_provider_operations
                  set state = 'submitted',
                      external_operation_ref = $2,
                      provider_price_minor = $3,
                      provider_currency = $4,
                      attempt_count = attempt_count + 1
                where id = $1
                  and state = 'queued'`,
              [
                staged.operationId,
                submitted.operationId,
                providerPrice?.amountMinor ?? null,
                providerPrice?.currency ?? null
              ]
            );
            await client.query(
              `insert into ss.domain_provider_operation_events (
                 id, organization_id, project_id,
                 operation_id, state, occurred_at
               ) values ($1, $2, $3, $4, 'submitted', $5)`,
              [
                randomUUID(),
                scope.organizationId,
                scope.projectId,
                staged.operationId,
                now(clock)
              ]
            );
            await client.query(
              `update ss.domain_registration_intents
                  set state = 'submitted',
                      updated_at = $2
                where id = $1`,
              [staged.intentId, now(clock)]
            );
          }
        );
      }
      return runtime.reconcileDomainOrder({
        orderId: scope.orderId
      });
    },

    async reconcileDomainOrder({ orderId } = {}) {
      const selectedOrderId = uuid(
        orderId,
        "Domain order ID"
      );
      const staged = await authority.service(
        { readOnly: true },
        async (client) => {
          const selected = await client.query(
            `select
               attempt.id as order_id,
               attempt.organization_id,
               attempt.project_id,
               attempt.requested_by_user_id,
               attempt.stripe_checkout_session_ref,
               intent.*,
               quote.registrar_cost_minor,
               quote.customer_price_minor,
               quote.currency,
               quote.term_years,
               quote.renewal_disclosure_digest,
               payment.id as payment_allocation_id,
               payment.stripe_payment_reference,
               payment.state as payment_state,
               payment.authorization_expires_at,
               operation.id as operation_id,
               operation.external_operation_ref,
               operation.state as operation_state,
               operation.provider_price_minor,
               operation.provider_currency,
               contact_set.contact_references
             from ss.domain_payment_authorization_attempts attempt
             join ss.domain_registration_intents intent
               on intent.organization_id =
                    attempt.organization_id
              and intent.id =
                    attempt.registration_intent_id
             join ss.domain_quotes quote
               on quote.organization_id =
                    intent.organization_id
              and quote.id = intent.quote_id
             join ss.domain_payment_allocations payment
               on payment.organization_id =
                    intent.organization_id
              and payment.id =
                    intent.payment_allocation_id
             join ss.domain_provider_operations operation
               on operation.organization_id =
                    intent.organization_id
              and operation.subject_kind = 'registration'
              and operation.subject_id = intent.id
              and operation.operation_kind = 'register'
             join ss.domain_provider_contact_sets contact_set
               on contact_set.organization_id =
                    intent.organization_id
              and contact_set.registrant_snapshot_id =
                    intent.registrant_snapshot_id
              and contact_set.provider_code =
                    intent.provider_code
            where attempt.id = $1`,
            [selectedOrderId]
          );
          invariant(
            selected.rowCount === 1,
            "NOT_FOUND",
            "The requested item was not found.",
            { status: 404 }
          );
          return selected.rows[0];
        }
      );
      if (staged.state === "registered") {
        return {
          domainOrder: {
            id: selectedOrderId,
            orderId: selectedOrderId,
            state: "active"
          }
        };
      }
      invariant(
        ["submitted", "processing"].includes(
          staged.state
        ) &&
          ["submitted", "processing"].includes(
            staged.operation_state
          ),
        "DOMAIN_REGISTRATION_RECONCILIATION_REQUIRED",
        "That registration is not safe for automatic reconciliation.",
        { status: 409 }
      );
      let operation;
      try {
        operation = await registrar.getOperation({
          tenantId: staged.organization_id,
          operationId: staged.external_operation_ref
        });
      } catch (error) {
        throw providerFailure(
          error,
          "domain_registration_readback"
        );
      }
      invariant(
        ["pending", "success", "failed"].includes(
          operation?.status
        ),
        "DOMAIN_REGISTRATION_PROVIDER_RESPONSE_INVALID",
        "The registrar returned an invalid operation state.",
        { status: 502 }
      );
      if (operation.status === "pending") {
        await authority.service(
          {
            userId: staged.requested_by_user_id,
            organizationId: staged.organization_id
          },
          async (client) => {
            await client.query(
              `update ss.domain_provider_operations
                  set state = 'processing'
                where id = $1
                  and state = 'submitted'`,
              [staged.operation_id]
            );
            await client.query(
              `update ss.domain_registration_intents
                  set state = 'processing',
                      updated_at = $2
                where id = $1
                  and state = 'submitted'`,
              [staged.id, now(clock)]
            );
          }
        );
        return {
          domainOrder: {
            id: selectedOrderId,
            orderId: selectedOrderId,
            state: "processing",
            customerCharged: false
          }
        };
      }
      if (operation.status === "failed") {
        await authority.service(
          {
            userId: staged.requested_by_user_id,
            organizationId: staged.organization_id
          },
          async (client) => {
            await client.query(
              `update ss.domain_provider_operations
                  set state = 'manual_review',
                      failure_code =
                        'registrar_failed_billing_unknown'
                where id = $1`,
              [staged.operation_id]
            );
            await client.query(
              `update ss.domain_registration_intents
                  set state = 'manual_review',
                      failure_code =
                        'registrar_failed_billing_unknown',
                      updated_at = $2
                where id = $1`,
              [staged.id, now(clock)]
            );
          }
        );
        throw new HostedError(
          "DOMAIN_REGISTRATION_RECONCILIATION_REQUIRED",
          "The registrar reported failure. Billing and portfolio evidence must be reconciled before the authorization is voided.",
          { status: 409 }
        );
      }
      let domain;
      try {
        domain = await registrar.getDomain({
          tenantId: staged.organization_id,
          domain: staged.domain_name
        });
      } catch (error) {
        throw providerFailure(
          error,
          "domain_registration_readback"
        );
      }
      const contactReferences =
        staged.contact_references;
      const providerPrice =
        staged.provider_price_minor === null
          ? null
          : {
              amountMinor: Number(
                staged.provider_price_minor
              ),
              currency: staged.provider_currency
            };
      invariant(
        domain?.name === staged.domain_name &&
          domain.lifecycleStatus === "registered" &&
          domain.contacts?.registrant ===
            contactReferences.registrant,
        "DOMAIN_REGISTRANT_READBACK_MISMATCH",
        "The registrar readback does not prove the customer is the registrant. Payment remains uncaptured.",
        { status: 409 }
      );
      invariant(
        providerPrice &&
          providerPrice.currency === staged.currency &&
          providerPrice.amountMinor <=
            Number(staged.registrar_cost_minor),
        "DOMAIN_REGISTRAR_CHARGE_UNKNOWN",
        "The registrar’s exact final charge is unavailable or exceeds the accepted amount. Payment remains uncaptured.",
        { status: 409 }
      );
      const registeredAt = exactIso(
        domain.registrationDate,
        "Registration time"
      );
      const expiresAt = exactIso(
        domain.expirationDate,
        "Registration expiry"
      );
      invariant(
        Date.parse(expiresAt) > Date.parse(registeredAt),
        "DOMAIN_REGISTRATION_PROVIDER_RESPONSE_INVALID",
        "The registrar returned an invalid registration period.",
        { status: 502 }
      );
      const purpose = purposeFor({
        organizationId: staged.organization_id,
        projectId: staged.project_id,
        customerId: staged.requested_by_user_id,
        orderId: selectedOrderId,
        quoteId: staged.quote_id,
        domain: staged.domain_name,
        years: Number(staged.term_years),
        amountMinor: Number(
          staged.customer_price_minor
        )
      });
      const purposeDigest = digest(purpose);
      const captureAmountMinor =
        providerPrice.amountMinor + serviceFeeMinor;
      let capture;
      try {
        capture =
          await payments.captureDomainAuthorization({
            checkoutSessionId:
              staged.stripe_checkout_session_ref,
            paymentIntentId:
              staged.stripe_payment_reference,
            orderId: selectedOrderId,
            amountMinor: captureAmountMinor,
            currency: staged.currency,
            purposeDigest,
            idempotencyKey:
              `domain-capture:${staged.organization_id}:${selectedOrderId}:${staged.external_operation_ref}`
          });
        invariant(
          capture?.status === "captured" &&
            capture.paymentIntentId ===
              staged.stripe_payment_reference &&
            capture.amountMinor === captureAmountMinor &&
            capture.currency === staged.currency &&
            capture.purposeDigest === purposeDigest,
          "DOMAIN_PAYMENT_CAPTURE_INVALID",
          "Stripe did not confirm the exact purpose-bound capture.",
          { status: 409 }
        );
      } catch (error) {
        throw providerFailure(
          error,
          "domain_payment_capture"
        );
      }
      const capturedAt = exactIso(
        capture.capturedAt,
        "Capture time"
      );
      const registrationId = randomUUID();
      await authority.service(
        {
          userId: staged.requested_by_user_id,
          organizationId: staged.organization_id
        },
        async (client) => {
          const operationFacts = {
            schema:
              "sitesourcery.domain-operation-result.v1",
            operationId: staged.operation_id,
            externalOperationId:
              staged.external_operation_ref,
            state: "succeeded",
            domainName: staged.domain_name,
            providerDomainRef:
              domain.providerDomainRef ??
              staged.domain_name,
            registeredAt,
            expiresAt,
            customerIsRegistrant: true,
            registrantContactRef:
              contactReferences.registrant,
            verificationStatus:
              domain.verificationStatus ?? null
          };
          const operationReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: staged.organization_id,
              projectId: staged.project_id,
              providerCode: "spaceship",
              kind: "domain_operation_result",
              externalRef:
                staged.external_operation_ref,
              facts: operationFacts,
              occurredAt: registeredAt
            }
          );
          const debitFacts = {
            schema:
              "sitesourcery.registrar-debit.v1",
            operationId: staged.operation_id,
            externalOperationId:
              staged.external_operation_ref,
            amountMinor:
              providerPrice.amountMinor,
            currency: staged.currency,
            debitedAt: registeredAt
          };
          const debitRef =
            domain.debitReference ??
            `${staged.external_operation_ref}:debit`;
          const debitReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: staged.organization_id,
              projectId: staged.project_id,
              providerCode: "spaceship",
              kind: "registrar_debit",
              externalRef: debitRef,
              facts: debitFacts,
              occurredAt: registeredAt
            }
          );
          const captureFacts = {
            schema:
              "sitesourcery.domain-payment-capture.v1",
            quoteId: staged.quote_id,
            orderId: selectedOrderId,
            checkoutSessionId:
              staged.stripe_checkout_session_ref,
            paymentIntentId:
              staged.stripe_payment_reference,
            captureId: capture.captureId,
            amountMinor: captureAmountMinor,
            currency: staged.currency,
            purposeDigest,
            capturedAt
          };
          const captureReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: staged.organization_id,
              projectId: staged.project_id,
              providerCode: "stripe",
              kind: "domain_payment_captured",
              externalRef:
                staged.stripe_payment_reference,
              facts: captureFacts,
              occurredAt: capturedAt
            }
          );
          await client.query(
            `update ss.domain_payment_allocations
                set state = 'captured',
                    stripe_provider_receipt_id = $2,
                    captured_at = $3
              where id = $1
                and state = 'authorized'`,
            [
              staged.payment_allocation_id,
              captureReceiptId,
              capturedAt
            ]
          );
          await client.query(
            `update ss.domain_provider_operations
                set state = 'succeeded',
                    provider_receipt_id = $2,
                    completed_at = $3
              where id = $1
                and state in ('submitted', 'processing')`,
            [
              staged.operation_id,
              operationReceiptId,
              registeredAt
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, provider_receipt_id,
               occurred_at
             ) values ($1, $2, $3, $4, 'succeeded', $5, $6)`,
            [
              randomUUID(),
              staged.organization_id,
              staged.project_id,
              staged.operation_id,
              operationReceiptId,
              registeredAt
            ]
          );
          await client.query(
            `insert into ss.domain_registrar_debits (
               id, organization_id, project_id,
               operation_id, registrar_provider_receipt_id,
               registrar_debit_reference, currency,
               amount_minor, debited_at
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8, $9
             )`,
            [
              randomUUID(),
              staged.organization_id,
              staged.project_id,
              staged.operation_id,
              debitReceiptId,
              debitRef,
              staged.currency,
              providerPrice.amountMinor,
              registeredAt
            ]
          );
          await client.query(
            `insert into ss.domain_registrations (
               id, organization_id, project_id,
               registration_intent_id, provider_operation_id,
               registrant_snapshot_id, provider_code,
               provider_domain_ref, domain_name, state,
               customer_is_registrant, site_sourcery_role,
               auto_renew, registered_at, expires_at,
               current_provider_receipt_id,
               renewal_disclosure_digest
             ) values (
               $1, $2, $3, $4, $5, $6, 'spaceship',
               $7, $8, 'active', true, 'authorized_agent',
               false, $9, $10, $11, $12
             )`,
            [
              registrationId,
              staged.organization_id,
              staged.project_id,
              staged.id,
              staged.operation_id,
              staged.registrant_snapshot_id,
              domain.providerDomainRef ??
                staged.domain_name,
              staged.domain_name,
              registeredAt,
              expiresAt,
              operationReceiptId,
              staged.renewal_disclosure_digest
            ]
          );
          await client.query(
            `update ss.domain_registration_intents
                set state = 'registered',
                    updated_at = $2
              where id = $1`,
            [staged.id, capturedAt]
          );
          await writeAudit(client, {
            organizationId: staged.organization_id,
            projectId: staged.project_id,
            actor: "system",
            action: "domain.registration.active",
            targetType: "domain_registration",
            targetId: registrationId,
            metadata: {
              orderId: selectedOrderId,
              customerIsRegistrant: true,
              captureAmountMinor,
              registrarCostMinor:
                providerPrice.amountMinor
            }
          });
        }
      );
      return {
        domainOrder: {
          id: selectedOrderId,
          orderId: selectedOrderId,
          state: "active",
          status: "active",
          domainId: registrationId,
          hostname: staged.domain_name,
          customerIsRegistrant: true,
          customerCharged: true,
          capturedAmountMinor:
            captureAmountMinor,
          currency: staged.currency,
          expiresAt
        }
      };
    },

    async listDnsRecords(actor, domainId) {
      const scope = await domainScope(actor, domainId);
      const records = await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId,
          readOnly: true
        },
        async (client) =>
          (
            await client.query(
              `select *
                 from (
                   select distinct on (
                     record.record_type,
                     record.name
                   )
                     record.*,
                     change_set.requested_at
                   from ss.domain_dns_records record
                   join ss.domain_dns_change_sets change_set
                     on change_set.organization_id =
                          record.organization_id
                    and change_set.id =
                          record.change_set_id
                  where change_set.registration_id = $1
                    and change_set.state = 'applied'
                  order by
                    record.record_type,
                    record.name,
                    change_set.requested_at desc,
                    record.id desc
                 ) latest
                where latest.state = 'applied'
                order by record_type, name, id`,
              [scope.domainId]
            )
          ).rows
      );
      return {
        records: records.map((row) => ({
          id: row.id,
          recordId: row.id,
          domainId: scope.domainId,
          type: row.record_type,
          name: row.name,
          content: row.value,
          value: row.value,
          ttl: Number(row.ttl_seconds),
          priority:
            row.priority === null
              ? null
              : Number(row.priority),
          state: row.state
        }))
      };
    },

    async upsertDnsRecord(
      actor,
      domainId,
      recordId,
      input
    ) {
      const scope = await domainScope(actor, domainId);
      const selectedCommandId = commandId(
        input.commandId
      );
      const type = requiredText(
        input.type,
        "DNS record type",
        10
      ).toUpperCase();
      invariant(
        DNS_TYPES.has(type),
        "DNS_RECORD_TYPE_HELD",
        "Hosted DNS writes currently support A, AAAA, CNAME, and TXT records.",
        { status: 409 }
      );
      const name = requiredText(
        input.name,
        "DNS record name",
        253
      ).toLowerCase();
      const content = requiredText(
        input.content,
        "DNS record value",
        2_000
      );
      const ttl = integer(
        input.ttl ?? 3600,
        "DNS TTL",
        60,
        86_400
      );
      const existingRecordId =
        recordId === "new"
          ? null
          : uuid(recordId, "DNS record ID");
      if (existingRecordId) {
        const existing = await runtime.listDnsRecords(
          actor,
          domainId
        );
        invariant(
          existing.records.some(
            (entry) => entry.id === existingRecordId
          ),
          "NOT_FOUND",
          "The requested item was not found.",
          { status: 404 }
        );
      }
      const record = {
        type,
        name,
        content,
        ttl
      };
      const providerRecord =
        type === "A" || type === "AAAA"
          ? {
              type,
              name,
              address: content,
              ttl
            }
          : type === "CNAME"
            ? {
                type,
                name,
                cname: canonicalDomain(content),
                ttl
              }
            : {
                type,
                name,
                value: content,
                ttl
              };
      const changeSetId = randomUUID();
      const operationId = randomUUID();
      const desiredRecordId = randomUUID();
      const requestedAt = now(clock);
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await requireControl(client, "spaceship");
          await client.query(
            `insert into ss.domain_dns_change_sets (
               id, organization_id, project_id,
               registration_id, requested_by_user_id,
               state, idempotency_key, request_digest,
               requested_at, change_kind
             ) values (
               $1, $2, $3, $4, $5, 'queued', $6, $7,
               $8, 'upsert'
             )`,
            [
              changeSetId,
              scope.organizationId,
              scope.projectId,
              scope.domainId,
              scope.userId,
              selectedCommandId,
              digest({
                schema:
                  "sitesourcery.domain-dns-change.v1",
                domainId: scope.domainId,
                action: "upsert",
                replacesRecordId:
                  existingRecordId,
                record
              }),
              requestedAt
            ]
          );
          await client.query(
            `insert into ss.domain_dns_records (
               id, organization_id, project_id,
               change_set_id, record_type, name,
               value, ttl_seconds, priority, state
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               null, 'desired'
             )`,
            [
              desiredRecordId,
              scope.organizationId,
              scope.projectId,
              changeSetId,
              type,
              name,
              content,
              ttl
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operations (
               id, organization_id, project_id,
               subject_kind, subject_id, operation_kind,
               provider_code, idempotency_key,
               request_digest, state, requested_at
             ) values (
               $1, $2, $3, 'dns', $4,
               'configure_dns', 'spaceship', $5, $6,
               'queued', $7
             )`,
            [
              operationId,
              scope.organizationId,
              scope.projectId,
              changeSetId,
              selectedCommandId,
              digest({
                changeSetId,
                hostname: scope.row.domain_name,
                action: "upsert",
                record
              }),
              requestedAt
            ]
          );
          await client.query(
            `update ss.domain_dns_change_sets
                set provider_operation_id = $2
              where id = $1`,
            [changeSetId, operationId]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, occurred_at
             ) values ($1, $2, $3, $4, 'queued', $5)`,
            [
              randomUUID(),
              scope.organizationId,
              scope.projectId,
              operationId,
              requestedAt
            ]
          );
        }
      );
      try {
        await registrar.saveDnsRecords({
          domain: scope.row.domain_name,
          records: [providerRecord],
          force: false
        });
      } catch (error) {
        await authority.service(
          {
            userId: scope.userId,
            organizationId: scope.organizationId
          },
          (client) =>
            client.query(
              `update ss.domain_provider_operations
                  set state = 'manual_review',
                      failure_code = $2
                where id = $1`,
              [
                operationId,
                error?.code ?? "dns_write_ambiguous"
              ]
            )
        );
        throw providerFailure(error, "dns_upsert");
      }
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const facts = {
            schema:
              "sitesourcery.domain-operation-result.v1",
            operationId,
            state: "succeeded",
            domainName: scope.row.domain_name,
            action: "upsert",
            recordDigest: digest(record)
          };
          const providerReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              providerCode: "spaceship",
              kind: "domain_operation_result",
              externalRef:
                `dns:${changeSetId}`,
              facts,
              occurredAt: now(clock)
            }
          );
          await client.query(
            `update ss.domain_provider_operations
                set state = 'succeeded',
                    provider_receipt_id = $2,
                    completed_at = $3
              where id = $1`,
            [
              operationId,
              providerReceiptId,
              now(clock)
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, provider_receipt_id,
               occurred_at
             ) values (
               $1, $2, $3, $4, 'succeeded', $5, $6
             )`,
            [
              randomUUID(),
              scope.organizationId,
              scope.projectId,
              operationId,
              providerReceiptId,
              now(clock)
            ]
          );
          await client.query(
            `update ss.domain_dns_change_sets
                set state = 'applied',
                    applied_at = $2
              where id = $1`,
            [changeSetId, now(clock)]
          );
          await client.query(
            `update ss.domain_dns_records record
                set state = 'deleted'
               from ss.domain_dns_change_sets prior
              where prior.organization_id =
                    record.organization_id
                and prior.id = record.change_set_id
                and prior.registration_id = $1
                and record.record_type = $2
                and record.name = $3
                and record.id <> $4
                and record.state = 'applied'`,
            [
              scope.domainId,
              type,
              name,
              desiredRecordId
            ]
          );
          await client.query(
            `update ss.domain_dns_records
                set state = 'applied'
              where id = $1`,
            [desiredRecordId]
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action: "domain.dns.applied",
            targetType: "domain_dns_change_set",
            targetId: changeSetId,
            metadata: {
              domainId: scope.domainId,
              action: "upsert",
              recordDigest: digest(record)
            }
          });
        }
      );
      return {
        record: {
          id: desiredRecordId,
          recordId: desiredRecordId,
          domainId: scope.domainId,
          ...record,
          state: "applied"
        }
      };
    },

    async deleteDnsRecord(
      actor,
      domainId,
      recordId,
      input
    ) {
      const scope = await domainScope(actor, domainId);
      const selectedRecordId = uuid(
        recordId,
        "DNS record ID"
      );
      const selectedCommandId = commandId(
        input.commandId
      );
      const current = (
        await runtime.listDnsRecords(
          actor,
          domainId
        )
      ).records.find(
        (entry) => entry.id === selectedRecordId
      );
      invariant(
        current,
        "NOT_FOUND",
        "The requested item was not found.",
        { status: 404 }
      );
      const providerRecord =
        current.type === "A" ||
        current.type === "AAAA"
          ? {
              type: current.type,
              name: current.name,
              address: current.content
            }
          : current.type === "CNAME"
            ? {
                type: current.type,
                name: current.name,
                cname: current.content
              }
            : {
                type: current.type,
                name: current.name,
                value: current.content
              };
      const changeSetId = randomUUID();
      const operationId = randomUUID();
      const tombstoneId = randomUUID();
      const requestedAt = now(clock);
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          await client.query(
            `insert into ss.domain_dns_change_sets (
               id, organization_id, project_id,
               registration_id, requested_by_user_id,
               state, idempotency_key, request_digest,
               requested_at, change_kind
             ) values (
               $1, $2, $3, $4, $5, 'queued', $6, $7,
               $8, 'delete'
             )`,
            [
              changeSetId,
              scope.organizationId,
              scope.projectId,
              scope.domainId,
              scope.userId,
              selectedCommandId,
              digest({
                schema:
                  "sitesourcery.domain-dns-change.v1",
                domainId: scope.domainId,
                action: "delete",
                recordId: selectedRecordId,
                record: current
              }),
              requestedAt
            ]
          );
          await client.query(
            `insert into ss.domain_dns_records (
               id, organization_id, project_id,
               change_set_id, record_type, name,
               value, ttl_seconds, priority, state
             ) values (
               $1, $2, $3, $4, $5, $6, $7, $8,
               null, 'desired'
             )`,
            [
              tombstoneId,
              scope.organizationId,
              scope.projectId,
              changeSetId,
              current.type,
              current.name,
              current.content,
              current.ttl
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operations (
               id, organization_id, project_id,
               subject_kind, subject_id, operation_kind,
               provider_code, idempotency_key,
               request_digest, state, requested_at
             ) values (
               $1, $2, $3, 'dns', $4,
               'configure_dns', 'spaceship', $5, $6,
               'queued', $7
             )`,
            [
              operationId,
              scope.organizationId,
              scope.projectId,
              changeSetId,
              selectedCommandId,
              digest({
                changeSetId,
                action: "delete",
                record: current
              }),
              requestedAt
            ]
          );
          await client.query(
            `update ss.domain_dns_change_sets
                set provider_operation_id = $2
              where id = $1`,
            [changeSetId, operationId]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, occurred_at
             ) values ($1, $2, $3, $4, 'queued', $5)`,
            [
              randomUUID(),
              scope.organizationId,
              scope.projectId,
              operationId,
              requestedAt
            ]
          );
        }
      );
      try {
        await registrar.deleteDnsRecords({
          domain: scope.row.domain_name,
          records: [providerRecord]
        });
      } catch (error) {
        throw providerFailure(error, "dns_delete");
      }
      await authority.service(
        {
          userId: scope.userId,
          organizationId: scope.organizationId
        },
        async (client) => {
          const facts = {
            schema:
              "sitesourcery.domain-operation-result.v1",
            operationId,
            state: "succeeded",
            domainName: scope.row.domain_name,
            action: "delete",
            recordDigest: digest(current)
          };
          const providerReceiptId = await receipt(
            client,
            {
              randomUUID,
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              providerCode: "spaceship",
              kind: "domain_operation_result",
              externalRef:
                `dns:${changeSetId}`,
              facts,
              occurredAt: now(clock)
            }
          );
          await client.query(
            `update ss.domain_provider_operations
                set state = 'succeeded',
                    provider_receipt_id = $2,
                    completed_at = $3
              where id = $1`,
            [
              operationId,
              providerReceiptId,
              now(clock)
            ]
          );
          await client.query(
            `insert into ss.domain_provider_operation_events (
               id, organization_id, project_id,
               operation_id, state, provider_receipt_id,
               occurred_at
             ) values (
               $1, $2, $3, $4, 'succeeded', $5, $6
             )`,
            [
              randomUUID(),
              scope.organizationId,
              scope.projectId,
              operationId,
              providerReceiptId,
              now(clock)
            ]
          );
          await client.query(
            `update ss.domain_dns_change_sets
                set state = 'applied',
                    applied_at = $2
              where id = $1`,
            [changeSetId, now(clock)]
          );
          await client.query(
            `update ss.domain_dns_records record
                set state = 'deleted'
               from ss.domain_dns_change_sets prior
              where prior.organization_id =
                    record.organization_id
                and prior.id = record.change_set_id
                and prior.registration_id = $1
                and record.record_type = $2
                and record.name = $3`,
            [
              scope.domainId,
              current.type,
              current.name
            ]
          );
          await writeAudit(client, {
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            actor: scope.userId,
            action: "domain.dns.deleted",
            targetType: "domain_dns_change_set",
            targetId: changeSetId,
            metadata: {
              domainId: scope.domainId,
              recordId: selectedRecordId
            }
          });
        }
      );
      return {
        deleted: true,
        recordId: selectedRecordId,
        domainId: scope.domainId
      };
    },

    async setDomainAutoRenew() {
      held("domain_auto_renew");
    },

    async requestDomainRenewalQuote() {
      held("domain_renewal");
    },

    async requestDomainTransferOut() {
      held("domain_transfer");
    },

    async readiness() {
      const database = await authority.readiness();
      let control = null;
      try {
        control = await authority.service(
          { readOnly: true },
          async (client) =>
            (
              await client.query(
                `select
                   purchasing_enabled,
                   live_mode,
                   active_provider_code,
                   agent_legal_document_id is not null
                     as agent_terms_ready,
                   renewal_legal_document_id is not null
                     as renewal_terms_ready
                 from ss.domain_procurement_control
                where singleton`
              )
            ).rows[0]
        );
      } catch {
        control = null;
      }
      const registrarStatus =
        typeof registrar.readiness === "function"
          ? await registrar.readiness()
          : {
              ready: true,
              mode: registrar.mode,
              provider: "spaceship"
            };
      const paymentStatus =
        typeof payments.readiness === "function"
          ? await payments.readiness()
          : {
              ready: true,
              mode: payments.mode,
              provider: "stripe"
            };
      const approved =
        control?.purchasing_enabled === true &&
        control.active_provider_code === "spaceship" &&
        control.agent_terms_ready === true &&
        control.renewal_terms_ready === true &&
        (
          mode !== "approved_live" ||
          control.live_mode === true
        );
      return {
        ready:
          database.ready === true &&
          approved &&
          registrarStatus.ready !== false &&
          paymentStatus.ready !== false,
        mode,
        provider: "spaceship",
        database,
        control: control ?? {
          purchasing_enabled: false,
          live_mode: false,
          active_provider_code: null
        },
        registrar: registrarStatus,
        payments: paymentStatus,
        dns:
          approved &&
          registrarStatus.ready !== false
            ? "ready"
            : "held",
        unsupported: {
          autoRenew: "held",
          renewal: "held",
          transferOut: secretDelivery
            ? "held_pending_persistent_worker"
            : "held_pending_one_time_secret_delivery"
        }
      };
    }
  };

  return Object.freeze(runtime);
}
