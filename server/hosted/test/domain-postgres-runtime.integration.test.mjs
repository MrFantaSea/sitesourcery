import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

import { createPostgresDomainRuntime } from "../domain-postgres-runtime.mjs";
import { createCanonicalPostgresAuthority } from "../repository-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_DOMAIN_TEST_URL ?? null;
const NOW = "2026-07-29T12:00:00.000Z";
const MIGRATIONS = new URL(
  "../../data-plane/supabase/migrations/",
  import.meta.url
);

async function migrateEmptyDatabase(pool) {
  const names = (await readdir(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    await pool.query(
      await readFile(new URL(name, MIGRATIONS), "utf8")
    );
  }
}

async function seedDomainAuthority(pool) {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const billingPolicyId = randomUUID();
  const agentDocumentId = randomUUID();
  const renewalDocumentId = randomUUID();
  await pool.query(
    `insert into auth.users (id, email)
     values ($1, $2)`,
    [userId, `domain-owner-${userId}@example.test`]
  );
  await pool.query(
    `insert into ss.billing_policies (
       id, policy_key, grace_period, retention_period,
       effective_at
     ) values (
       $1, $2, interval '14 days', interval '90 days',
       '2026-01-01T00:00:00.000Z'
     )`,
    [billingPolicyId, `domain-test-${billingPolicyId}`]
  );
  await pool.query(
    `insert into ss.organizations (
       id, created_by_user_id, name
     ) values ($1, $2, 'Domain Runtime Test')`,
    [organizationId, userId]
  );
  await pool.query(
    `insert into ss.organization_memberships (
       organization_id, user_id, role, state, accepted_at
     ) values ($1, $2, 'owner', 'active', $3)`,
    [organizationId, userId, NOW]
  );
  await pool.query(
    `insert into ss.projects (
       id, organization_id, created_by_user_id,
       billing_policy_id, name
     ) values ($1, $2, $3, $4, 'Domain Project')`,
    [
      projectId,
      organizationId,
      userId,
      billingPolicyId
    ]
  );
  for (const [id, kind, version] of [
    [
      agentDocumentId,
      "domain_agent",
      "domain-agent.test-v1"
    ],
    [
      renewalDocumentId,
      "domain_renewal",
      "domain-renewal.test-v1"
    ]
  ]) {
    await pool.query(
      `insert into ss.legal_documents (
         id, kind, version, content_digest,
         content_uri, effective_at
       ) values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        kind,
        version,
        kind === "domain_agent"
          ? "a".repeat(64)
          : "b".repeat(64),
        `https://sitesourcery.test/legal/${kind}`,
        "2026-01-01T00:00:00.000Z"
      ]
    );
  }
  await pool.query(
    `update ss.domain_procurement_control
        set purchasing_enabled = true,
            live_mode = false,
            active_provider_code = 'spaceship',
            agent_legal_document_id = $1,
            renewal_legal_document_id = $2,
            enabled_at = $3,
            enabled_by_user_id = $4`,
    [
      agentDocumentId,
      renewalDocumentId,
      NOW,
      userId
    ]
  );
  return {
    actor: { userId },
    userId,
    organizationId,
    projectId
  };
}

function fakeProviders() {
  const calls = [];
  const dns = [];
  let checkout = null;
  let authorizationStatus = "pending";
  let checkoutUrl =
    "https://checkout.stripe.com/c/pay/domain-contract";
  const contacts = {
    registrant: "a".repeat(27),
    admin: "b".repeat(27),
    tech: "c".repeat(27),
    billing: "d".repeat(27)
  };
  const registrar = {
    mode: "contract_test",
    async readiness() {
      return {
        ready: true,
        mode: "contract_test",
        provider: "spaceship"
      };
    },
    async searchDomains({ query }) {
      calls.push("search");
      return {
        results: [
          {
            hostname: query,
            available: true,
            result: "available"
          }
        ]
      };
    },
    async quoteRegistration({ domain, years }) {
      calls.push("quote");
      return {
        status: "confirmation_required",
        domain,
        years,
        price: { amountMinor: 1200, currency: "USD" },
        renewalPrice: {
          amountMinor: 1400,
          currency: "USD"
        },
        renewalDisclosure:
          "Renews manually after a fresh exact quote and customer approval.",
        quoteId: `spaceship-quote-${domain}`,
        observedAt: NOW,
        expiresAt: "2026-07-29T12:30:00.000Z"
      };
    },
    async ensureContacts() {
      calls.push("contacts");
      return structuredClone(contacts);
    },
    async previewRegistration({ domain }) {
      calls.push("reprice");
      return {
        status: "confirmation_required",
        domain,
        price: { amountMinor: 1200, currency: "USD" },
        quoteId: "spaceship-price-check-contract-001",
        observedAt: NOW,
        expiresAt: "2026-07-29T12:05:00.000Z"
      };
    },
    async confirmRegistration() {
      calls.push("register");
      return {
        operationId: "spaceship-operation-contract-001",
        price: { amountMinor: 1200, currency: "USD" }
      };
    },
    async getOperation() {
      calls.push("operation-readback");
      return { status: "success" };
    },
    async getDomain({ domain }) {
      calls.push("domain-readback");
      return {
        name: domain,
        providerDomainRef: "spaceship-domain-contract-001",
        debitReference: "spaceship-debit-contract-001",
        lifecycleStatus: "registered",
        contacts: { registrant: contacts.registrant },
        registrationDate: "2026-07-29T12:01:00.000Z",
        expirationDate: "2027-07-29T12:01:00.000Z",
        verificationStatus: "verified"
      };
    },
    async saveDnsRecords({ records }) {
      calls.push("dns-save-readback");
      dns.push(structuredClone(records[0]));
      return { saved: records.length };
    },
    async deleteDnsRecords({ records }) {
      calls.push("dns-delete-readback");
      const expected = records[0];
      const index = dns.findIndex(
        (entry) =>
          entry.type === expected.type &&
          entry.name === expected.name
      );
      if (index >= 0) dns.splice(index, 1);
      return { deleted: records.length };
    }
  };
  const payments = {
    mode: "contract_test",
    async readiness() {
      return {
        ready: true,
        mode: "contract_test",
        provider: "stripe"
      };
    },
    async createDomainAuthorizationCheckout(input) {
      calls.push("checkout-create");
      checkout = structuredClone(input);
      return {
        status: "open",
        checkoutSessionId: "cs_test_domain_contract_001",
        url: checkoutUrl,
        expiresAt: "2026-07-29T12:30:00.000Z",
        amountMinor: input.amountMinor,
        currency: input.currency,
        captureMethod: "manual",
        purposeDigest: input.purposeDigest
      };
    },
    async retrieveDomainAuthorization(input) {
      calls.push("authorization-readback");
      assert.equal(input.orderId, checkout.orderId);
      const result = {
        status: authorizationStatus,
        checkoutSessionId: input.checkoutSessionId,
        paymentIntentId:
          authorizationStatus === "authorized"
            ? "pi_domain_contract_001"
            : null,
        amountMinor: checkout.amountMinor,
        currency: checkout.currency,
        captureMethod: "manual",
        purposeDigest: checkout.purposeDigest
      };
      if (authorizationStatus === "authorized") {
        result.authorizedAt = NOW;
        result.authorizationExpiresAt =
          "2026-07-29T13:00:00.000Z";
      }
      return result;
    },
    async captureDomainAuthorization(input) {
      calls.push("capture");
      assert.equal(
        calls.at(-2),
        "domain-readback",
        "capture must follow customer-registrant readback"
      );
      return {
        status: "captured",
        paymentIntentId: input.paymentIntentId,
        captureId: "py_domain_contract_001",
        amountMinor: input.amountMinor,
        currency: input.currency,
        purposeDigest: input.purposeDigest,
        capturedAt: "2026-07-29T12:02:00.000Z"
      };
    }
  };
  const contactVault = {
    async seal({ payload }) {
      calls.push("contact-seal");
      return {
        vaultRef: `sealed:test:${Buffer.from(
          JSON.stringify(payload)
        ).toString("base64url")}`,
        keyVersion: "test-v1"
      };
    }
  };
  return {
    registrar,
    payments,
    contactVault,
    calls,
    dns,
    setAuthorizationStatus(value) {
      authorizationStatus = value;
    },
    setCheckoutUrl(value) {
      checkoutUrl = value;
    }
  };
}

test(
  "normalized PostgreSQL domain purchase authorizes before registrar and captures after exact readback",
  { skip: !DATABASE_URL, timeout: 60_000 },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
      await migrateEmptyDatabase(pool);
      const seeded = await seedDomainAuthority(pool);
      const otherProjectId = randomUUID();
      await pool.query(
        `insert into ss.projects (
           id, organization_id, created_by_user_id,
           billing_policy_id, name
         )
         select
           $1, organization_id, created_by_user_id,
           billing_policy_id, 'Other Domain Project'
           from ss.projects
          where id = $2`,
        [otherProjectId, seeded.projectId]
      );
      const providers = fakeProviders();
      const authority = createCanonicalPostgresAuthority({
        pool
      });
      assert.equal((await authority.assertReady()).ready, true);
      const runtime = createPostgresDomainRuntime({
        authority,
        registrar: providers.registrar,
        payments: providers.payments,
        contactVault: providers.contactVault,
        mode: "contract_test",
        testOnly: true,
        clock: { now: () => NOW }
      });

      const search = await runtime.searchDomains(
        seeded.actor,
        "customer-example.com"
      );
      assert.equal(search.results[0].available, true);

      const { quote } = await runtime.createDomainQuote(
        seeded.actor,
        {
          projectId: seeded.projectId,
          hostname: "customer-example.com",
          years: 1,
          purpose: "register"
        }
      );
      assert.equal(quote.projectId, seeded.projectId);
      assert.equal(quote.price.amountMinor, 1200);
      assert.equal(quote.renewalPrice.amountMinor, 1400);
      assert.deepEqual(Object.keys(quote.terms).sort(), [
        "cancellation",
        "ownership",
        "registrar",
        "renewal"
      ]);

      const { registrantContact } =
        await runtime.saveRegistrantContact(
          seeded.actor,
          seeded.organizationId,
          {
            projectId: seeded.projectId,
            name: "Customer Owner",
            organization: "Customer Company",
            email: "owner@example.test",
            phone: "+1 212 555 0100",
            addressLine1: "100 Main Street",
            addressLine2: "",
            city: "New York",
            region: "NY",
            postalCode: "10001",
            countryCode: "US",
            commandId: "domain-contact-contract-001"
          }
        );
      assert.equal(
        registrantContact.projectId,
        seeded.projectId
      );

      await assert.rejects(
        runtime.acceptDomainConsent(
          seeded.actor,
          quote.id,
          {
            projectId: otherProjectId,
            registrantContactId: registrantContact.id,
            termsVersion: quote.termsVersion,
            registrationAgreementAccepted: true,
            registrantCertificationAccepted: true,
            autoRenewRequested: false,
            commandId:
              "domain-cross-project-consent-001"
          }
        ),
        (error) => error?.code === "NOT_FOUND"
      );

      const { consent } = await runtime.acceptDomainConsent(
        seeded.actor,
        quote.id,
        {
          projectId: seeded.projectId,
          registrantContactId: registrantContact.id,
          termsVersion: quote.termsVersion,
          registrationAgreementAccepted: true,
          registrantCertificationAccepted: true,
          autoRenewRequested: false,
          commandId: "domain-consent-contract-001"
        }
      );
      assert.equal(consent.projectId, seeded.projectId);

      const { domainOrder } =
        await runtime.createDomainOrder(
          seeded.actor,
          seeded.projectId,
          {
            quoteId: quote.id,
            consentId: consent.id,
            commandId: "domain-order-contract-001"
          }
        );
      assert.equal(domainOrder.state, "awaiting_payment");
      assert.equal(
        domainOrder.paymentUrl,
        `/api/v1/domain-orders/${domainOrder.id}/payment` +
          `?projectId=${seeded.projectId}`
      );
      assert.equal(
        Object.values(domainOrder).includes(
          "https://checkout.stripe.com/c/pay/domain-contract"
        ),
        false,
        "the public order must not disclose the provider URL"
      );
      assert.equal(providers.calls.includes("capture"), false);
      await assert.rejects(
        runtime.getDomainOrder(
          seeded.actor,
          domainOrder.id,
          otherProjectId
        ),
        (error) => error?.code === "NOT_FOUND"
      );

      await assert.rejects(
        runtime.getDomainPaymentRedirect(
          { userId: randomUUID() },
          domainOrder.id,
          seeded.projectId
        ),
        (error) => error?.code === "NOT_FOUND"
      );
      await assert.rejects(
        runtime.getDomainPaymentRedirect(
          seeded.actor,
          domainOrder.id,
          otherProjectId
        ),
        (error) => error?.code === "NOT_FOUND"
      );
      assert.deepEqual(
        await runtime.getDomainPaymentRedirect(
          seeded.actor,
          domainOrder.id,
          seeded.projectId
        ),
        {
          url: "https://checkout.stripe.com/c/pay/domain-contract"
        }
      );
      await pool.query(
        `update ss.domain_payment_authorization_attempts
            set checkout_expires_at = $2
          where id = $1`,
        [domainOrder.id, "2026-07-29T11:59:59.000Z"]
      );
      await assert.rejects(
        runtime.getDomainPaymentRedirect(
          seeded.actor,
          domainOrder.id,
          seeded.projectId
        ),
        (error) =>
          error?.code ===
          "DOMAIN_PAYMENT_ALREADY_HANDLED"
      );
      await pool.query(
        `update ss.domain_payment_authorization_attempts
            set checkout_expires_at = $2
          where id = $1`,
        [domainOrder.id, "2026-07-29T12:30:00.000Z"]
      );
      for (const terminalState of [
        "expired",
        "manual_review",
        "authorized",
        "captured",
        "voided",
        "refunded"
      ]) {
        providers.setAuthorizationStatus(terminalState);
        await assert.rejects(
          runtime.getDomainPaymentRedirect(
            seeded.actor,
            domainOrder.id,
            seeded.projectId
          ),
          (error) =>
            error?.code ===
            "DOMAIN_PAYMENT_ALREADY_HANDLED"
        );
      }
      providers.setAuthorizationStatus("authorized");
      await runtime.resumeDomainAuthorization({
        checkoutSessionId: "cs_test_domain_contract_001",
        verifiedEventId: "evt_domain_contract_001",
        verifiedAt: NOW
      });
      await assert.rejects(
        runtime.refreshDomainPrice(
          seeded.actor,
          domainOrder.id,
          {
            projectId: otherProjectId,
            commandId:
              "domain-cross-project-price-001"
          }
        ),
        (error) => error?.code === "NOT_FOUND"
      );
      const { priceCheck } =
        await runtime.refreshDomainPrice(
          seeded.actor,
          domainOrder.id,
          {
            projectId: seeded.projectId,
            commandId: "domain-price-contract-001"
          }
        );
      assert.equal(priceCheck.ready, true);
      assert.equal(priceCheck.status, "ready_to_confirm");
      assert.equal(priceCheck.projectId, seeded.projectId);
      assert.deepEqual(
        priceCheck.finalPrice,
        priceCheck.price
      );

      const active =
        await runtime.requestDomainRegistration(
          seeded.actor,
          domainOrder.id,
          {
            projectId: seeded.projectId,
            priceCheckId: priceCheck.id,
            irreversibleRegistrationAccepted: true,
            commandId:
              "domain-registration-contract-001"
          }
      );
      assert.equal(active.domainOrder.state, "active");
      await assert.rejects(
        runtime.listDnsRecords(
          seeded.actor,
          active.domainOrder.domainId,
          otherProjectId
        ),
        (error) => error?.code === "NOT_FOUND"
      );
      await assert.rejects(
        runtime.upsertDnsRecord(
          seeded.actor,
          active.domainOrder.domainId,
          "new",
          {
            projectId: otherProjectId,
            type: "A",
            name: "@",
            content: "192.0.2.99",
            ttl: 3600,
            commandId:
              "domain-cross-project-dns-001"
          }
        ),
        (error) => error?.code === "NOT_FOUND"
      );
      assert.deepEqual(
        providers.calls.slice(
          providers.calls.indexOf("register"),
          providers.calls.indexOf("capture") + 1
        ),
        [
          "register",
          "operation-readback",
          "domain-readback",
          "capture"
        ]
      );

      const saved = await runtime.upsertDnsRecord(
        seeded.actor,
        active.domainOrder.domainId,
        "new",
        {
          projectId: seeded.projectId,
          type: "A",
          name: "@",
          content: "192.0.2.44",
          ttl: 3600,
          commandId: "domain-dns-upsert-contract-001"
        }
      );
      assert.equal(saved.record.state, "applied");
      assert.equal(saved.record.projectId, seeded.projectId);
      assert.equal(
        (
          await runtime.listDnsRecords(
            seeded.actor,
            active.domainOrder.domainId,
            seeded.projectId
          )
        ).records.length,
        1
      );
      await runtime.deleteDnsRecord(
        seeded.actor,
        active.domainOrder.domainId,
        saved.record.id,
        {
          projectId: seeded.projectId,
          commandId: "domain-dns-delete-contract-001"
        }
      );
      assert.deepEqual(
        (
          await runtime.listDnsRecords(
            seeded.actor,
            active.domainOrder.domainId,
            seeded.projectId
          )
        ).records,
        []
      );

      const evidence = await pool.query(
        `select
           allocation.state as payment_state,
           intent.state as intent_state,
           registration.customer_is_registrant,
           registration.site_sourcery_role,
           operation.state as operation_state
         from ss.domain_registration_intents intent
         join ss.domain_payment_allocations allocation
           on allocation.id = intent.payment_allocation_id
         join ss.domain_registrations registration
           on registration.registration_intent_id = intent.id
         join ss.domain_provider_operations operation
           on operation.id =
                registration.provider_operation_id`
      );
      assert.deepEqual(evidence.rows[0], {
        payment_state: "captured",
        intent_state: "registered",
        customer_is_registrant: true,
        site_sourcery_role: "authorized_agent",
        operation_state: "succeeded"
      });

      const { quote: rejectedQuote } =
        await runtime.createDomainQuote(seeded.actor, {
          projectId: seeded.projectId,
          hostname: "untrusted-checkout.example",
          years: 1,
          purpose: "register"
        });
      const { consent: rejectedConsent } =
        await runtime.acceptDomainConsent(
          seeded.actor,
          rejectedQuote.id,
          {
            projectId: seeded.projectId,
            registrantContactId: registrantContact.id,
            termsVersion: rejectedQuote.termsVersion,
            registrationAgreementAccepted: true,
            registrantCertificationAccepted: true,
            autoRenewRequested: false,
            commandId:
              "domain-untrusted-consent-contract-001"
          }
        );
      providers.setCheckoutUrl(
        "https://checkout.stripe.example/steal"
      );
      await assert.rejects(
        runtime.createDomainOrder(
          seeded.actor,
          seeded.projectId,
          {
            quoteId: rejectedQuote.id,
            consentId: rejectedConsent.id,
            commandId:
              "domain-untrusted-order-contract-001"
          }
        ),
        (error) =>
          error?.code ===
          "DOMAIN_PAYMENT_PROVIDER_RESPONSE_INVALID"
      );
      const rejected = await pool.query(
        `select state, provider_checkout_url
           from ss.domain_payment_authorization_attempts
          where quote_id = $1`,
        [rejectedQuote.id]
      );
      assert.deepEqual(rejected.rows[0], {
        state: "manual_review",
        provider_checkout_url: null
      });
    } finally {
      await pool.end();
    }
  }
);
