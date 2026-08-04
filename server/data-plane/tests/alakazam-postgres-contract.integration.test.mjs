import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamProviderMetadata
} from "../../commerce-v2/alakazam.mjs";
import {
  digest as canonicalDigest
} from "../../commerce-v2/canonical.mjs";
import {
  createPostgresAlakazamRepository
} from "../../hosted/alakazam-postgres.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_TEST_URL ?? null;
const CATALOG_VERSION = "alakazam.2026-08-02.v1";
const TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertRow(client, table, row) {
  assert.match(table, /^[a-z0-9_]+$/u);
  const entries = Object.entries(row);
  for (const [column] of entries) {
    assert.match(column, /^[a-z_]+$/u);
  }
  const columns = entries.map(([column]) => column).join(", ");
  const parameters = entries
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  await client.query(
    `insert into ss.${table} (${columns}) values (${parameters})`,
    entries.map(([, value]) => value)
  );
}

async function flushConstraints(client) {
  await client.query("set constraints all immediate");
  await client.query("set constraints all deferred");
}

async function expectRejected(client, action, pattern) {
  await client.query("savepoint expected_rejection");
  await assert.rejects(async () => {
    await action();
    await client.query("set constraints all immediate");
  }, pattern);
  await client.query("rollback to savepoint expected_rejection");
  await client.query("set constraints all deferred");
}

async function seedAuthority(
  client,
  {
    withStripeCustomer = true,
    stripeCustomerId = "cus_alakazam_contract"
  } = {}
) {
  const authority = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    billingPolicyId: randomUUID(),
    projectId: randomUUID(),
    stripeCustomerRowId: randomUUID(),
    stripeCustomerId
  };
  await client.query(
    "insert into auth.users (id, email) values ($1, $2)",
    [
      authority.userId,
      `alakazam-${authority.userId}@example.test`
    ]
  );
  await insertRow(client, "billing_policies", {
    id: authority.billingPolicyId,
    policy_key: `alakazam-test-${authority.billingPolicyId}`,
    grace_period: "14 days",
    retention_period: "90 days",
    effective_at: "2026-01-01T00:00:00.000Z"
  });
  await insertRow(client, "organizations", {
    id: authority.organizationId,
    created_by_user_id: authority.userId,
    name: "Alakazam Contract Test"
  });
  await insertRow(client, "organization_memberships", {
    organization_id: authority.organizationId,
    user_id: authority.userId,
    role: "owner",
    state: "active",
    accepted_at: "2026-08-02T11:55:00.000Z"
  });
  await insertRow(client, "projects", {
    id: authority.projectId,
    organization_id: authority.organizationId,
    created_by_user_id: authority.userId,
    billing_policy_id: authority.billingPolicyId,
    name: "Alakazam Project"
  });
  if (withStripeCustomer) {
    await insertRow(client, "stripe_customers", {
      id: authority.stripeCustomerRowId,
      organization_id: authority.organizationId,
      stripe_customer_id: authority.stripeCustomerId
    });
  }
  return authority;
}

test(
  "Alakazam quote repository commits and replays one exact migration-backed transaction",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query("begin");
      transactionOpen = true;
      await client.query("set constraints all deferred");
      const seeded = await seedAuthority(client);
      const repository =
        createPostgresAlakazamRepository({
          authority: {
            async service(context, work) {
              assert.deepEqual(context, {
                userId: seeded.userId,
                organizationId: seeded.organizationId
              });
              return work(client);
            }
          }
        });
      const quoteId = randomUUID();
      const input = {
        tenantId: seeded.organizationId,
        customerId: seeded.userId,
        projectId: seeded.projectId,
        quoteId,
        targetTierId: "alakazam_35",
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z",
        taxMode: "disabled_by_owner"
      };
      const quote = await repository.createQuote(input);
      assert.equal(quote.changeKind, "start");
      assert.equal(quote.state, "quoted");
      assert.equal(quote.providerEffectsAuthorized, true);
      assert.equal(quote.dueNow.subtotalMinor, 3500);
      assert.equal(quote.dueNow.taxMinor, 0);
      assert.equal(quote.dueNow.totalMinor, 3500);

      const replay = await repository.createQuote({
        ...input,
        issuedAt: "2026-08-02T12:01:00.000Z",
        expiresAt: "2026-08-02T12:31:00.000Z"
      });
      assert.deepEqual(replay, quote);
      await flushConstraints(client);
      const stored = await client.query(
        `select state, provider_effects_authorized,
                target_tier_id, target_amount_minor,
                due_now_subtotal_minor, tax_state,
                disclosure_digest, quote_digest
           from ss.alakazam_change_quotes
          where organization_id = $1 and id = $2`,
        [seeded.organizationId, quoteId]
      );
      assert.equal(stored.rowCount, 1);
      assert.deepEqual(
        {
          state: stored.rows[0].state,
          authorized:
            stored.rows[0].provider_effects_authorized,
          targetTierId: stored.rows[0].target_tier_id,
          targetAmountMinor: Number(
            stored.rows[0].target_amount_minor
          ),
          dueNowSubtotalMinor: Number(
            stored.rows[0].due_now_subtotal_minor
          ),
          taxState: stored.rows[0].tax_state,
          disclosureDigest:
            stored.rows[0].disclosure_digest,
          quoteDigest: stored.rows[0].quote_digest
        },
        {
          state: "quoted",
          authorized: true,
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          dueNowSubtotalMinor: 3500,
          taxState: "disabled_by_owner",
          disclosureDigest: quote.disclosureDigest,
          quoteDigest: quote.quoteDigest
        }
      );
    } finally {
      if (transactionOpen) {
        await client.query("rollback");
      }
      client.release();
      await pool.end();
    }
  }
);

test(
  "Alakazam direct start reserves one Customer effect and confirms only with exact durable binding",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client, {
        withStripeCustomer: false
      });
      const quoteId = await insertQuote(client, authority, {
        changeKind: "start",
        targetTierId: "alakazam_25",
        targetAmountMinor: 2500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 2500,
        effectiveRule:
          "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      const repository = createPostgresAlakazamRepository({
        authority: {
          async service(context, work) {
            assert.deepEqual(context, {
              userId: authority.userId,
              organizationId: authority.organizationId
            });
            return work(client);
          }
        }
      });
      const unusedProvisionId = randomUUID();
      const unused = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId: unusedProvisionId,
        claimedAt: "2026-08-02T12:01:00.000Z"
      });
      assert.equal(unused.status, "create");
      assert.deepEqual(
        await repository.releaseCustomerProvision({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId,
          provisionId: unusedProvisionId,
          purposeDigest: unused.provision.purposeDigest
        }),
        { status: "released" }
      );

      const provisionId = randomUUID();
      const claimed = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId,
        claimedAt: "2026-08-02T12:02:00.000Z"
      });
      assert.equal(claimed.status, "create");
      assert.equal(
        claimed.provision.provisionId,
        provisionId
      );
      const purposeDigest =
        claimed.provision.purposeDigest;
      const pending = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId: randomUUID(),
        claimedAt: "2026-08-02T12:02:30.000Z"
      });
      assert.equal(pending.status, "pending");
      assert.equal(pending.provisionId, provisionId);
      await flushConstraints(client);

      await expectRejected(
        client,
        () => insertRow(
          client,
          "commerce_v2_download_dispatches",
          {
            organization_id: authority.organizationId,
            preparation_command_id:
              `blocked-${provisionId}`,
            quote_id: randomUUID(),
            customer_user_id: authority.userId,
            project_id: authority.projectId,
            version_id: randomUUID(),
            provider: "stripe",
            state: "dispatching",
            purpose_digest: digest("blocked-purpose"),
            accepted_disclosure_digest:
              digest("blocked-disclosure"),
            quote_snapshot_digest:
              digest("blocked-quote"),
            lease_expires_at:
              "2026-08-02T12:03:00.000Z",
            created_at: "2026-08-02T12:01:00.000Z",
            updated_at: "2026-08-02T12:01:00.000Z"
          }
        ),
        /Download Checkout waits for Alakazam Customer reconciliation/iu
      );

      const ambiguous =
        await repository.markCustomerProvisionAmbiguous({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId,
          provisionId,
          purposeDigest,
          stripeCustomerId:
            "cus_alakazam_direct_start",
          errorCode:
            "stripe_alakazam_customer_readback_unknown"
        });
      assert.equal(
        ambiguous.status,
        "reconciliation_required"
      );
      await flushConstraints(client);
      await expectRejected(
        client,
        () => client.query(
          `delete from ss.alakazam_customer_provisions
            where id = $1`,
          [provisionId]
        ),
        /durable Alakazam Customer evidence is immutable/iu
      );

      const providerCreatedAt =
        "2026-08-02T12:02:05.000Z";
      const facts = {
        schema:
          "sitesourcery.stripe-alakazam-customer/v1",
        stripeCustomerId:
          "cus_alakazam_direct_start",
        organizationId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId,
        providerCreatedAt,
        purposeDigest
      };
      const providerFactsDigest = canonicalDigest(facts);
      const binding =
        await repository.confirmCustomerProvision({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId,
          provisionId,
          purposeDigest,
          providerFacts: {
            ...facts,
            providerFactsDigest
          },
          confirmedAt: "2026-08-02T12:02:10.000Z"
        });
      assert.deepEqual(binding, {
        status: "bound",
        provider: "stripe",
        stripeCustomerId:
          "cus_alakazam_direct_start",
        provisionId
      });
      await flushConstraints(client);
      const confirmed = await client.query(
        `select provision.state,
                provision.provider_effect_certainty,
                provision.stripe_customer_id,
                customer.organization_id as bound_organization_id
           from ss.alakazam_customer_provisions provision
           join ss.stripe_customers customer
             on customer.organization_id =
                provision.organization_id
            and customer.stripe_customer_id =
                provision.stripe_customer_id
          where provision.id = $1`,
        [provisionId]
      );
      assert.deepEqual(confirmed.rows[0], {
        state: "confirmed",
        provider_effect_certainty: "confirmed",
        stripe_customer_id:
          "cus_alakazam_direct_start",
        bound_organization_id: authority.organizationId
      });
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "an interrupted Alakazam Customer worker fences the reservation instead of authorizing a second create",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client, {
        withStripeCustomer: false
      });
      const quoteId = await insertQuote(client, authority, {
        changeKind: "start",
        targetTierId: "alakazam_35",
        targetAmountMinor: 3500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 3500,
        effectiveRule:
          "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      const repository = createPostgresAlakazamRepository({
        authority: {
          async service(_context, work) {
            return work(client);
          }
        }
      });
      const firstProvisionId = randomUUID();
      const first = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId: firstProvisionId,
        claimedAt: "2026-08-02T12:01:00.000Z"
      });
      assert.equal(first.status, "create");

      const interrupted =
        await repository.claimCustomerProvision({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId,
          provisionId: randomUUID(),
          claimedAt: "2026-08-02T12:03:00.000Z"
        });
      assert.deepEqual(interrupted, {
        status: "reconciliation_required",
        provider: "stripe",
        provisionId: firstProvisionId,
        stripeCustomerId: null,
        code: "alakazam_customer_provision_interrupted"
      });
      const replay = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId: randomUUID(),
        claimedAt: "2026-08-02T12:04:00.000Z"
      });
      assert.deepEqual(replay, interrupted);
      const rows = await client.query(
        `select id, state, provider_effect_certainty
           from ss.alakazam_customer_provisions
          where organization_id = $1`,
        [authority.organizationId]
      );
      assert.deepEqual(rows.rows, [
        {
          id: firstProvisionId,
          state: "reconciliation_required",
          provider_effect_certainty: "ambiguous"
        }
      ]);
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

test(
  "Alakazam Checkout dispatch replays, fences ambiguity, fails pre-effect, and stops an interrupted worker",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      max: 1
    });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");

      const ambiguousAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_ambiguous"
      });
      const ambiguousQuoteId = await insertQuote(
        client,
        ambiguousAuthority,
        {
          changeKind: "start",
          targetTierId: "alakazam_25",
          targetAmountMinor: 2500,
          appliedValueKind: "none",
          appliedValueMinor: 0,
          dueNowSubtotalMinor: 2500,
          effectiveRule:
            "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:00:00.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }
      );
      const ambiguousRepository =
        createPostgresAlakazamRepository({
          authority: {
            async service(_context, work) {
              return work(client);
            }
          }
        });
      const ambiguousDispatchId = randomUUID();
      const ambiguousClaim =
        await ambiguousRepository.claimCheckoutDispatch({
          tenantId: ambiguousAuthority.organizationId,
          customerId: ambiguousAuthority.userId,
          projectId: ambiguousAuthority.projectId,
          quoteId: ambiguousQuoteId,
          dispatchId: ambiguousDispatchId,
          stripeCustomerId:
            ambiguousAuthority.stripeCustomerId,
          claimedAt: "2026-08-02T12:01:00.000Z"
        });
      assert.equal(ambiguousClaim.status, "create");
      const pending =
        await ambiguousRepository.claimCheckoutDispatch({
          tenantId: ambiguousAuthority.organizationId,
          customerId: ambiguousAuthority.userId,
          projectId: ambiguousAuthority.projectId,
          quoteId: ambiguousQuoteId,
          dispatchId: randomUUID(),
          stripeCustomerId:
            ambiguousAuthority.stripeCustomerId,
          claimedAt: "2026-08-02T12:01:30.000Z"
        });
      assert.equal(pending.status, "pending");
      assert.equal(
        pending.dispatchId,
        ambiguousDispatchId
      );
      const ambiguousReference = {
        tenantId: ambiguousAuthority.organizationId,
        customerId: ambiguousAuthority.userId,
        projectId: ambiguousAuthority.projectId,
        quoteId: ambiguousQuoteId,
        dispatchId: ambiguousDispatchId,
        purposeDigest:
          ambiguousClaim.dispatch.purposeDigest
      };
      assert.equal(
        (
          await ambiguousRepository
            .markCheckoutDispatchUnknown({
              ...ambiguousReference,
              errorCode:
                "stripe_alakazam_checkout_effect_unknown"
            })
        ).status,
        "reconciliation_required"
      );
      const reconciled =
        await ambiguousRepository.confirmCheckoutDispatch({
          ...ambiguousReference,
          providerResult: {
            checkoutId: "cs_alakazam_reconciled",
            url:
              "https://checkout.stripe.com/c/pay/alakazam_reconciled",
            expiresAt: "2026-08-02T13:00:00.000Z"
          },
          dispatchedAt: "2026-08-02T12:02:00.000Z"
        });
      assert.equal(reconciled.status, "ready");
      assert.deepEqual(
        await ambiguousRepository.confirmCheckoutDispatch({
          ...ambiguousReference,
          providerResult: {
            checkoutId: "cs_alakazam_reconciled",
            url:
              "https://checkout.stripe.com/c/pay/alakazam_reconciled",
            expiresAt: "2026-08-02T13:00:00.000Z"
          },
          dispatchedAt: "2026-08-02T12:02:00.000Z"
        }),
        reconciled
      );

      const failedAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_failed"
      });
      const failedQuoteId = await insertQuote(
        client,
        failedAuthority,
        {
          changeKind: "start",
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          appliedValueKind: "none",
          appliedValueMinor: 0,
          dueNowSubtotalMinor: 3500,
          effectiveRule:
            "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:00:00.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }
      );
      const failedDispatchId = randomUUID();
      const failedClaim =
        await ambiguousRepository.claimCheckoutDispatch({
          tenantId: failedAuthority.organizationId,
          customerId: failedAuthority.userId,
          projectId: failedAuthority.projectId,
          quoteId: failedQuoteId,
          dispatchId: failedDispatchId,
          stripeCustomerId:
            failedAuthority.stripeCustomerId,
          claimedAt: "2026-08-02T12:01:00.000Z"
        });
      const failed =
        await ambiguousRepository.failCheckoutDispatch({
          tenantId: failedAuthority.organizationId,
          customerId: failedAuthority.userId,
          projectId: failedAuthority.projectId,
          quoteId: failedQuoteId,
          dispatchId: failedDispatchId,
          purposeDigest: failedClaim.dispatch.purposeDigest,
          errorCode: "stripe_configuration_unavailable"
        });
      assert.equal(failed.status, "failed");

      const staleAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_stale"
      });
      const staleQuoteId = await insertQuote(
        client,
        staleAuthority,
        {
          changeKind: "start",
          targetTierId: "alakazam_50",
          targetAmountMinor: 5000,
          appliedValueKind: "none",
          appliedValueMinor: 0,
          dueNowSubtotalMinor: 5000,
          effectiveRule:
            "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:00:00.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }
      );
      const staleDispatchId = randomUUID();
      await ambiguousRepository.claimCheckoutDispatch({
        tenantId: staleAuthority.organizationId,
        customerId: staleAuthority.userId,
        projectId: staleAuthority.projectId,
        quoteId: staleQuoteId,
        dispatchId: staleDispatchId,
        stripeCustomerId: staleAuthority.stripeCustomerId,
        claimedAt: "2026-08-02T12:01:00.000Z"
      });
      const interrupted =
        await ambiguousRepository.claimCheckoutDispatch({
          tenantId: staleAuthority.organizationId,
          customerId: staleAuthority.userId,
          projectId: staleAuthority.projectId,
          quoteId: staleQuoteId,
          dispatchId: randomUUID(),
          stripeCustomerId:
            staleAuthority.stripeCustomerId,
          claimedAt: "2026-08-02T12:03:00.000Z"
        });
      assert.deepEqual(
        {
          status: interrupted.status,
          dispatchId: interrupted.dispatchId,
          code: interrupted.code
        },
        {
          status: "reconciliation_required",
          dispatchId: staleDispatchId,
          code: "alakazam_checkout_dispatch_interrupted"
        }
      );
    } finally {
      await client.query("rollback");
      client.release();
      await pool.end();
    }
  }
);

async function insertQuote(client, authority, input) {
  const id = input.id ?? randomUUID();
  await insertRow(client, "alakazam_change_quotes", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    customer_user_id: authority.userId,
    catalog_version: CATALOG_VERSION,
    terms_version: TERMS_VERSION,
    change_kind: input.changeKind,
    current_subscription_id: input.currentSubscriptionId ?? null,
    current_subscription_revision:
      input.currentSubscriptionRevision ?? null,
    current_tier_id: input.currentTierId ?? null,
    current_amount_minor: input.currentAmountMinor ?? null,
    current_period_ends_at: input.currentPeriodEndsAt ?? null,
    target_tier_id: input.targetTierId,
    target_amount_minor: input.targetAmountMinor,
    applied_value_kind: input.appliedValueKind,
    applied_value_minor: input.appliedValueMinor,
    download_entitlement_id: input.downloadEntitlementId ?? null,
    due_now_subtotal_minor: input.dueNowSubtotalMinor,
    next_renewal_amount_minor: input.targetAmountMinor,
    currency: "USD",
    effective_rule: input.effectiveRule,
    effective_at: input.effectiveAt ?? null,
    no_mid_period_refund: input.noMidPeriodRefund,
    provider_proration_enabled: false,
    premium_configuration_policy: "preserved_when_inactive",
    tax_state: "disabled_by_owner",
    disclosure: {
      test: true,
      changeKind: input.changeKind,
      targetTierId: input.targetTierId
    },
    disclosure_digest: digest(`disclosure:${id}`),
    quote_digest: digest(`quote:${id}`),
    state: "quoted",
    provider_effects_authorized: true,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    created_by_user_id: authority.userId
  });
  return id;
}

async function openCheckout(
  client,
  authority,
  {
    quoteId,
    mode,
    subtotalMinor,
    creditMinor,
    suffix,
    claimedAt,
    dispatchedAt
  }
) {
  const repository = createPostgresAlakazamRepository({
    authority: {
      async service(_context, work) {
        return work(client);
      }
    }
  });
  const dispatchId = randomUUID();
  const claim = await repository.claimCheckoutDispatch({
    tenantId: authority.organizationId,
    customerId: authority.userId,
    projectId: authority.projectId,
    quoteId,
    dispatchId,
    stripeCustomerId: authority.stripeCustomerId,
    claimedAt
  });
  assert.equal(claim.status, "create");
  assert.equal(claim.dispatch.mode, mode);
  assert.equal(
    claim.dispatch.expectedSubtotalMinor,
    subtotalMinor
  );
  assert.equal(
    claim.dispatch.expectedCreditMinor,
    creditMinor
  );
  const ready = await repository.confirmCheckoutDispatch({
    tenantId: authority.organizationId,
    customerId: authority.userId,
    projectId: authority.projectId,
    quoteId,
    dispatchId,
    purposeDigest: claim.dispatch.purposeDigest,
    providerResult: {
      checkoutId: `cs_${suffix}`,
      url: `https://checkout.stripe.com/c/pay/${suffix}`,
      expiresAt: "2026-08-02T13:00:00.000Z"
    },
    dispatchedAt
  });
  assert.equal(ready.status, "ready");
  return dispatchId;
}

function subscriptionPaymentFacts(
  reservation,
  {
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripePriceId,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
    providerObservedAt
  }
) {
  const facts = {
    schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripeCustomerId: reservation.stripeCustomerId,
    stripePriceId,
    stripeScheduleId: null,
    tierId: reservation.purpose.targetTierId,
    amountMinor: reservation.purpose.targetAmountMinor,
    currency: "USD",
    providerStatus: "active",
    cancelAtPeriodEnd: false,
    currentPeriodStartsAt,
    currentPeriodEndsAt,
    billingCycleAnchor: currentPeriodStartsAt,
    providerObservedAt,
    metadata: createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    })
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function checkoutPaymentFacts(
  reservation,
  {
    checkoutSessionId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripePriceId,
    stripeInvoiceId = null,
    stripePaymentIntentId,
    providerPaymentTime,
    currentPeriodStartsAt = null,
    currentPeriodEndsAt = null
  }
) {
  const start = reservation.purpose.changeKind === "start";
  const subscription = start
    ? subscriptionPaymentFacts(reservation, {
        stripeSubscriptionId,
        stripeSubscriptionItemId,
        stripePriceId,
        currentPeriodStartsAt,
        currentPeriodEndsAt,
        providerObservedAt: providerPaymentTime
      })
    : null;
  const facts = {
    schema: ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
    provider: "stripe",
    changeKind: reservation.purpose.changeKind,
    checkoutSessionId,
    stripeCustomerId: reservation.stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionItemId,
    stripePriceId,
    stripeInvoiceId: start ? stripeInvoiceId : null,
    stripePaymentIntentId,
    targetTierId: reservation.purpose.targetTierId,
    listSubtotalMinor: start
      ? reservation.purpose.targetAmountMinor
      : reservation.purpose.dueNowSubtotalMinor,
    providerDiscountMinor:
      reservation.purpose.downloadCredit?.amountMinor ?? 0,
    netSubtotalMinor: reservation.purpose.dueNowSubtotalMinor,
    taxMinor: 0,
    totalMinor: reservation.purpose.dueNowSubtotalMinor,
    taxMode: "disabled_by_owner",
    currency: "USD",
    paymentStatus: "paid",
    purposeDigest: reservation.purposeDigest,
    providerPaymentTime,
    subscription
  };
  return {
    ...facts,
    providerFactsDigest: canonicalDigest(facts)
  };
}

function checkoutPaymentEvent(
  reservation,
  {
    checkoutSessionId,
    suffix,
    occurredAt,
    signatureVerifiedAt
  }
) {
  return {
    stripeEventId: `evt_${suffix}`,
    eventType: "checkout.session.completed",
    livemode: false,
    apiVersion: "2026-06-24.dahlia",
    checkoutSessionId,
    metadata: createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    }),
    payloadDigest: digest(`payload:${suffix}`),
    signatureVerifiedAt,
    occurredAt
  };
}

async function insertStripeEvent(client, authority, input) {
  const id = randomUUID();
  await insertRow(client, "alakazam_stripe_events", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    quote_id: input.quoteId ?? null,
    subscription_id: input.subscriptionId,
    stripe_event_id: `evt_${input.suffix}`,
    event_type: input.eventType,
    livemode: false,
    api_version: "2026-06-24.dahlia",
    provider_object_id: input.providerObjectId,
    payload_digest: digest(`payload:${input.suffix}`),
    facts: { test: true, suffix: input.suffix },
    signature_verified_at: input.occurredAt,
    occurred_at: input.occurredAt
  });
  await client.query(
    `update ss.alakazam_stripe_events
        set state = 'processing', attempt_count = 1
      where id = $1`,
    [id]
  );
  await client.query(
    `update ss.alakazam_stripe_events
        set state = 'processed', processed_at = $2
      where id = $1`,
    [id, input.processedAt]
  );
  return id;
}

async function insertTierEvent(client, authority, input) {
  const id = randomUUID();
  await insertRow(client, "alakazam_tier_change_events", {
    id,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    subscription_id: input.subscriptionId,
    quote_id: input.quoteId ?? null,
    stripe_event_row_id: input.stripeEventRowId ?? null,
    payment_receipt_id: input.paymentReceiptId ?? null,
    downgrade_schedule_id: input.downgradeScheduleId ?? null,
    download_reversal_event_id: null,
    result_subscription_revision:
      input.resultSubscriptionRevision ?? null,
    event_kind: input.eventKind,
    prior_tier_id: input.priorTierId ?? null,
    result_tier_id: input.resultTierId,
    occurred_at: input.occurredAt,
    facts: { test: true, eventKind: input.eventKind },
    facts_digest: digest(`tier-event:${id}`)
  });
  return id;
}

test(
  "Alakazam PostgreSQL contract proves start, fixed upgrade, and boundary downgrade",
  { skip: !DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const subscriptionId = randomUUID();
      const settlementRepository =
        createPostgresAlakazamRepository({
          authority: {
            async service(_context, work) {
              return work(client);
            }
          }
        });

      await expectRejected(
        client,
        () => insertQuote(client, authority, {
          changeKind: "start",
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          appliedValueKind: "none",
          appliedValueMinor: 0,
          dueNowSubtotalMinor: 1500,
          effectiveRule: "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:00:00.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }),
        /alakazam_change_quotes|check constraint/iu
      );

      const startQuoteId = await insertQuote(client, authority, {
        changeKind: "start",
        targetTierId: "alakazam_25",
        targetAmountMinor: 2500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 2500,
        effectiveRule: "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:00:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      const startDispatchId = await openCheckout(
        client,
        authority,
        {
          quoteId: startQuoteId,
          mode: "subscription_start",
          subtotalMinor: 2500,
          creditMinor: 0,
          suffix: "alakazam_start",
          claimedAt: "2026-08-02T12:01:00.000Z",
          dispatchedAt: "2026-08-02T12:01:05.000Z"
        }
      );
      const startResolved =
        await settlementRepository
          .findCheckoutDispatchBySession({
            checkoutSessionId: "cs_alakazam_start"
          });
      assert.equal(startResolved.status, "ready");
      assert.equal(
        startResolved.reservation.dispatchId,
        startDispatchId
      );
      const startPayment = checkoutPaymentFacts(
        startResolved.reservation,
        {
          checkoutSessionId: "cs_alakazam_start",
          stripeSubscriptionId: "sub_alakazam_contract",
          stripeSubscriptionItemId: "si_alakazam_contract",
          stripePriceId: "price_alakazam_25",
          stripeInvoiceId: "in_alakazam_start",
          stripePaymentIntentId: "pi_alakazam_start",
          providerPaymentTime: "2026-08-02T12:02:00.000Z",
          currentPeriodStartsAt:
            "2026-08-02T12:02:00.000Z",
          currentPeriodEndsAt:
            "2026-09-02T12:02:00.000Z"
        }
      );
      const startPaymentEventId = randomUUID();
      const startReceiptId = randomUUID();
      const startSettlement =
        await settlementRepository.settleCheckoutPayment({
          reservation: startResolved.reservation,
          checkout: startResolved.checkout,
          event: checkoutPaymentEvent(
            startResolved.reservation,
            {
              checkoutSessionId: "cs_alakazam_start",
              suffix: "alakazam_start_payment",
              occurredAt: "2026-08-02T12:02:00.000Z",
              signatureVerifiedAt:
                "2026-08-02T12:02:05.000Z"
            }
          ),
          payment: startPayment,
          eventRowId: startPaymentEventId,
          receiptId: startReceiptId,
          subscriptionId,
          creditApplicationId: null,
          tierEventId: null
        });
      assert.deepEqual(startSettlement, {
        status: "payment_settled",
        provider: "stripe",
        changeKind: "start",
        dispatchId: startDispatchId,
        projectId: authority.projectId,
        quoteId: startQuoteId,
        subscriptionId,
        receiptId: startReceiptId,
        paymentProviderFactsDigest:
          startPayment.providerFactsDigest,
        next: "subscription_confirmation"
      });
      await flushConstraints(client);
      const stagedStart = await client.query(
        `select subscription.status,
                subscription.activation_receipt_id,
                subscription.current_period_starts_at,
                subscription.current_period_ends_at,
                quote.state as quote_state,
                dispatch.state as dispatch_state
           from ss.alakazam_subscriptions subscription
           join ss.alakazam_change_quotes quote
             on quote.id = subscription.initial_quote_id
           join ss.alakazam_checkout_dispatches dispatch
             on dispatch.quote_id = quote.id
          where subscription.id = $1`,
        [subscriptionId]
      );
      assert.deepEqual(stagedStart.rows[0], {
        status: "pending",
        activation_receipt_id: null,
        current_period_starts_at: null,
        current_period_ends_at: null,
        quote_state: "payment_settled",
        dispatch_state: "settled"
      });
      const startReplay =
        await settlementRepository
          .findCheckoutDispatchBySession({
            checkoutSessionId: "cs_alakazam_start"
          });
      assert.equal(startReplay.status, "settled");
      assert.deepEqual(
        startReplay.settlement,
        startSettlement
      );

      const startProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: startQuoteId,
          subscriptionId,
          suffix: "alakazam_start_provider",
          eventType: "customer.subscription.created",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-08-02T12:03:00.000Z",
          processedAt: "2026-08-02T12:03:05.000Z"
        }
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: startQuoteId,
        stripeEventRowId: startProviderEventId,
        paymentReceiptId: startReceiptId,
        resultSubscriptionRevision: 2,
        eventKind: "start_applied",
        resultTierId: "alakazam_25",
        occurredAt: "2026-08-02T12:03:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set activation_receipt_id = $2,
                status = 'active',
                current_period_starts_at = $3,
                current_period_ends_at = $4,
                provider_observed_at = $5,
                provider_facts_digest = $6
          where id = $1`,
        [
          subscriptionId,
          startReceiptId,
          "2026-08-02T12:03:00.000Z",
          "2026-09-02T12:03:00.000Z",
          "2026-08-02T12:04:00.000Z",
          digest("subscription:active-25")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [startQuoteId]
      );
      await flushConstraints(client);

      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_subscriptions
              set tier_id = 'alakazam_35',
                  amount_minor = 3500,
                  stripe_price_id = 'price_alakazam_35',
                  provider_observed_at = $2,
                  provider_facts_digest = $3
            where id = $1`,
          [
            subscriptionId,
            "2026-08-02T12:05:00.000Z",
            digest("subscription:unproved-upgrade")
          ]
        ),
        /lacks exact revision evidence/iu
      );

      const upgradeQuoteId = await insertQuote(client, authority, {
        changeKind: "upgrade",
        currentSubscriptionId: subscriptionId,
        currentSubscriptionRevision: 2,
        currentTierId: "alakazam_25",
        currentAmountMinor: 2500,
        currentPeriodEndsAt: "2026-09-02T12:03:00.000Z",
        targetTierId: "alakazam_35",
        targetAmountMinor: 3500,
        appliedValueKind: "current_paid_tier",
        appliedValueMinor: 2500,
        dueNowSubtotalMinor: 1000,
        effectiveRule: "after_payment_and_provider_confirmation",
        noMidPeriodRefund: false,
        issuedAt: "2026-08-02T12:10:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      const upgradeDispatchId = await openCheckout(
        client,
        authority,
        {
          quoteId: upgradeQuoteId,
          mode: "upgrade_difference",
          subtotalMinor: 1000,
          creditMinor: 0,
          suffix: "alakazam_upgrade_25_35",
          claimedAt: "2026-08-02T12:11:00.000Z",
          dispatchedAt: "2026-08-02T12:11:05.000Z"
        }
      );
      const upgradeResolved =
        await settlementRepository
          .findCheckoutDispatchBySession({
            checkoutSessionId:
              "cs_alakazam_upgrade_25_35"
          });
      assert.equal(upgradeResolved.status, "ready");
      assert.equal(
        upgradeResolved.reservation.dispatchId,
        upgradeDispatchId
      );
      const upgradePayment = checkoutPaymentFacts(
        upgradeResolved.reservation,
        {
          checkoutSessionId:
            "cs_alakazam_upgrade_25_35",
          stripeSubscriptionId: "sub_alakazam_contract",
          stripeSubscriptionItemId: "si_alakazam_contract",
          stripePriceId: "price_alakazam_35",
          stripePaymentIntentId: "pi_alakazam_upgrade",
          providerPaymentTime:
            "2026-08-02T12:12:00.000Z"
        }
      );
      const upgradePaymentEventId = randomUUID();
      const upgradeReceiptId = randomUUID();
      const upgradePaymentTierEventId = randomUUID();
      const upgradeSettlement =
        await settlementRepository.settleCheckoutPayment({
          reservation: upgradeResolved.reservation,
          checkout: upgradeResolved.checkout,
          event: checkoutPaymentEvent(
            upgradeResolved.reservation,
            {
              checkoutSessionId:
                "cs_alakazam_upgrade_25_35",
              suffix: "alakazam_upgrade_payment",
              occurredAt: "2026-08-02T12:12:00.000Z",
              signatureVerifiedAt:
                "2026-08-02T12:12:05.000Z"
            }
          ),
          payment: upgradePayment,
          eventRowId: upgradePaymentEventId,
          receiptId: upgradeReceiptId,
          subscriptionId,
          creditApplicationId: null,
          tierEventId: upgradePaymentTierEventId
        });
      assert.deepEqual(upgradeSettlement, {
        status: "payment_settled",
        provider: "stripe",
        changeKind: "upgrade",
        dispatchId: upgradeDispatchId,
        projectId: authority.projectId,
        quoteId: upgradeQuoteId,
        subscriptionId,
        receiptId: upgradeReceiptId,
        paymentProviderFactsDigest:
          upgradePayment.providerFactsDigest,
        next: "provider_change"
      });
      await flushConstraints(client);
      const stagedUpgrade = await client.query(
        `select subscription.tier_id,
                subscription.amount_minor,
                subscription.revision,
                quote.state as quote_state,
                tier.event_kind
           from ss.alakazam_subscriptions subscription
           join ss.alakazam_change_quotes quote
             on quote.current_subscription_id = subscription.id
           join ss.alakazam_tier_change_events tier
             on tier.quote_id = quote.id
          where subscription.id = $1
            and quote.id = $2
            and tier.id = $3`,
        [
          subscriptionId,
          upgradeQuoteId,
          upgradePaymentTierEventId
        ]
      );
      assert.deepEqual(
        {
          tierId: stagedUpgrade.rows[0].tier_id,
          amountMinor: Number(
            stagedUpgrade.rows[0].amount_minor
          ),
          revision: Number(stagedUpgrade.rows[0].revision),
          quoteState: stagedUpgrade.rows[0].quote_state,
          eventKind: stagedUpgrade.rows[0].event_kind
        },
        {
          tierId: "alakazam_25",
          amountMinor: 2500,
          revision: 2,
          quoteState: "provider_change_pending",
          eventKind: "upgrade_payment_settled"
        }
      );
      const upgradeReplay =
        await settlementRepository
          .findCheckoutDispatchBySession({
            checkoutSessionId:
              "cs_alakazam_upgrade_25_35"
          });
      assert.equal(upgradeReplay.status, "settled");
      assert.deepEqual(
        upgradeReplay.settlement,
        upgradeSettlement
      );
      const upgradeProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: upgradeQuoteId,
          subscriptionId,
          suffix: "alakazam_upgrade_provider",
          eventType: "customer.subscription.updated",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-08-02T12:13:00.000Z",
          processedAt: "2026-08-02T12:13:05.000Z"
        }
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: upgradeQuoteId,
        stripeEventRowId: upgradeProviderEventId,
        paymentReceiptId: upgradeReceiptId,
        resultSubscriptionRevision: 3,
        eventKind: "upgrade_applied",
        priorTierId: "alakazam_25",
        resultTierId: "alakazam_35",
        occurredAt: "2026-08-02T12:13:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set tier_id = 'alakazam_35',
                amount_minor = 3500,
                stripe_price_id = 'price_alakazam_35',
                provider_observed_at = $2,
                provider_facts_digest = $3
          where id = $1`,
        [
          subscriptionId,
          "2026-08-02T12:14:00.000Z",
          digest("subscription:active-35")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [upgradeQuoteId]
      );
      await flushConstraints(client);

      const downgradeQuoteId = await insertQuote(client, authority, {
        changeKind: "downgrade",
        currentSubscriptionId: subscriptionId,
        currentSubscriptionRevision: 3,
        currentTierId: "alakazam_35",
        currentAmountMinor: 3500,
        currentPeriodEndsAt: "2026-09-02T12:03:00.000Z",
        targetTierId: "alakazam_25",
        targetAmountMinor: 2500,
        appliedValueKind: "none",
        appliedValueMinor: 0,
        dueNowSubtotalMinor: 0,
        effectiveRule: "current_period_end",
        effectiveAt: "2026-09-02T12:03:00.000Z",
        noMidPeriodRefund: true,
        issuedAt: "2026-08-02T12:20:00.000Z",
        expiresAt: "2026-08-02T12:30:00.000Z"
      });
      await flushConstraints(client);
      await client.query(
        `update ss.alakazam_change_quotes
            set state = 'schedule_dispatching'
          where id = $1`,
        [downgradeQuoteId]
      );
      const downgradeScheduleId = randomUUID();
      await insertRow(client, "alakazam_downgrade_schedules", {
        id: downgradeScheduleId,
        organization_id: authority.organizationId,
        project_id: authority.projectId,
        subscription_id: subscriptionId,
        quote_id: downgradeQuoteId,
        current_tier_id: "alakazam_35",
        target_tier_id: "alakazam_25",
        current_stripe_price_id: "price_alakazam_35",
        target_stripe_price_id: "price_alakazam_25",
        effective_at: "2026-09-02T12:03:00.000Z",
        provider_idempotency_key: "alakazam-downgrade-35-25",
        purpose_digest: digest("downgrade:35:25"),
        state: "dispatching"
      });
      await client.query(
        `update ss.alakazam_downgrade_schedules
            set state = 'scheduled',
                stripe_schedule_id = 'sub_sched_alakazam_35_25',
                provider_facts = '{"test":true}'::jsonb,
                provider_facts_digest = $2,
                scheduled_at = $3
          where id = $1`,
        [
          downgradeScheduleId,
          digest("schedule:35:25"),
          "2026-08-02T12:21:00.000Z"
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'scheduled' where id = $1",
        [downgradeQuoteId]
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: downgradeQuoteId,
        downgradeScheduleId,
        eventKind: "downgrade_scheduled",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_25",
        occurredAt: "2026-08-02T12:21:00.000Z"
      });
      await flushConstraints(client);

      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_subscriptions
              set tier_id = 'alakazam_25',
                  amount_minor = 2500,
                  stripe_price_id = 'price_alakazam_25',
                  provider_observed_at = $2,
                  provider_facts_digest = $3
            where id = $1`,
          [
            subscriptionId,
            "2026-08-02T12:22:00.000Z",
            digest("subscription:early-downgrade")
          ]
        ),
        /renewal boundary/iu
      );

      const downgradeProviderEventId = await insertStripeEvent(
        client,
        authority,
        {
          quoteId: downgradeQuoteId,
          subscriptionId,
          suffix: "alakazam_downgrade_provider",
          eventType: "customer.subscription.updated",
          providerObjectId: "sub_alakazam_contract",
          occurredAt: "2026-09-02T12:03:00.000Z",
          processedAt: "2026-09-02T12:03:05.000Z"
        }
      );
      await client.query(
        `update ss.alakazam_downgrade_schedules
            set state = 'applied', applied_at = $2
          where id = $1`,
        [downgradeScheduleId, "2026-09-02T12:03:00.000Z"]
      );
      await insertTierEvent(client, authority, {
        subscriptionId,
        quoteId: downgradeQuoteId,
        stripeEventRowId: downgradeProviderEventId,
        downgradeScheduleId,
        resultSubscriptionRevision: 4,
        eventKind: "downgrade_applied",
        priorTierId: "alakazam_35",
        resultTierId: "alakazam_25",
        occurredAt: "2026-09-02T12:03:00.000Z"
      });
      await client.query(
        `update ss.alakazam_subscriptions
            set tier_id = 'alakazam_25',
                amount_minor = 2500,
                stripe_price_id = 'price_alakazam_25',
                current_period_starts_at = $2,
                current_period_ends_at = $3,
                provider_observed_at = $4,
                provider_facts_digest = $5
          where id = $1`,
        [
          subscriptionId,
          "2026-09-02T12:03:00.000Z",
          "2026-10-02T12:03:00.000Z",
          "2026-09-02T12:04:00.000Z",
          digest("subscription:renewed-25")
        ]
      );
      await client.query(
        "update ss.alakazam_change_quotes set state = 'applied' where id = $1",
        [downgradeQuoteId]
      );
      await flushConstraints(client);

      const proof = await client.query(
        `select
           subscription.tier_id,
           subscription.amount_minor,
           subscription.revision,
           upgrade.due_now_subtotal_minor as upgrade_due,
           downgrade.due_now_subtotal_minor as downgrade_due,
           downgrade.no_mid_period_refund,
           downgrade.provider_proration_enabled,
           schedule.effective_at,
           schedule.applied_at
         from ss.alakazam_subscriptions subscription
         join ss.alakazam_change_quotes upgrade on upgrade.id = $2
         join ss.alakazam_change_quotes downgrade on downgrade.id = $3
         join ss.alakazam_downgrade_schedules schedule
           on schedule.id = $4
        where subscription.id = $1`,
        [
          subscriptionId,
          upgradeQuoteId,
          downgradeQuoteId,
          downgradeScheduleId
        ]
      );
      assert.deepEqual(
        {
          tier: proof.rows[0].tier_id,
          amount: Number(proof.rows[0].amount_minor),
          revision: Number(proof.rows[0].revision),
          upgradeDue: Number(proof.rows[0].upgrade_due),
          downgradeDue: Number(proof.rows[0].downgrade_due),
          noMidPeriodRefund:
            proof.rows[0].no_mid_period_refund,
          providerProration:
            proof.rows[0].provider_proration_enabled,
          effectiveAt:
            proof.rows[0].effective_at.toISOString(),
          appliedAt: proof.rows[0].applied_at.toISOString()
        },
        {
          tier: "alakazam_25",
          amount: 2500,
          revision: 4,
          upgradeDue: 1000,
          downgradeDue: 0,
          noMidPeriodRefund: true,
          providerProration: false,
          effectiveAt: "2026-09-02T12:03:00.000Z",
          appliedAt: "2026-09-02T12:03:00.000Z"
        }
      );

      const grants = await client.query(`
        select
          has_table_privilege(
            'authenticated',
            'ss.alakazam_subscriptions',
            'select'
          ) as authenticated_select,
          has_table_privilege(
            'anon',
            'ss.alakazam_change_quotes',
            'insert'
          ) as anon_insert
      `);
      assert.deepEqual(grants.rows[0], {
        authenticated_select: false,
        anon_insert: false
      });
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
      await pool.end();
    }
  }
);
