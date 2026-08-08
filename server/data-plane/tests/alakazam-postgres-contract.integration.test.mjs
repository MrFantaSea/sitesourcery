import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import pg from "pg";

import {
  ALAKAZAM_PAYMENT_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
  ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
  createAlakazamProviderMetadata
} from "../../commerce-v2/alakazam.mjs";
import {
  createAlakazamBillingRelease
} from "../../commerce-v2/alakazam-billing.mjs";
import {
  createAlakazamUpgradeService
} from "../../commerce-v2/alakazam-upgrade.mjs";
import {
  createAlakazamDowngradeService
} from "../../commerce-v2/alakazam-downgrade.mjs";
import {
  createAlakazamDowngradeActivationService
} from "../../commerce-v2/alakazam-downgrade-activation.mjs";
import {
  createAlakazamAccountService,
  createAlakazamSiteSetupDigest
} from "../../commerce-v2/alakazam-account.mjs";
import {
  createAlakazamPublicationService
} from "../../commerce-v2/alakazam-publication.mjs";
import {
  digest as canonicalDigest
} from "../../commerce-v2/canonical.mjs";
import {
  createPostgresAlakazamRepository
} from "../../hosted/alakazam-postgres.mjs";
import {
  createPostgresAlakazamPublicationRepository
} from "../../hosted/alakazam-publication-postgres.mjs";
import {
  createAlakazamFulfillmentWorker
} from "../../hosted/alakazam-fulfillment-worker.mjs";
import {
  createSelfHostPublicationPort
} from "../../hosted/selfhost-publication-port.mjs";
import {
  createSparkCompilerPort
} from "../../hosted/spark-compiler-port.mjs";
import { SelfHostRuntime } from "../../selfhost/src/index.mjs";

const { Pool } = pg;
const DATABASE_URL =
  process.env.SITESOURCERY_PG_ALAKAZAM_TEST_URL ?? null;
const CATALOG_VERSION = "alakazam.2026-08-02.v1";
const TERMS_VERSION =
  "alakazam-owner-contract.2026-08-02.v1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function disclosureDigestForQuote(quoteId) {
  return digest(`disclosure:${quoteId}`);
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

async function makeDirectoriesOwnerWritable(target) {
  const details = await lstat(target);
  if (!details.isDirectory()) return;
  await chmod(target, 0o700);
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await makeDirectoriesOwnerWritable(
        path.join(target, entry.name)
      );
    }
  }
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
  await insertRow(client, "project_safety_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    state: "clear",
    updated_at: "2026-08-02T11:55:00.000Z"
  });
  await insertRow(client, "project_address_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    current_address_id: null,
    updated_at: "2026-08-02T11:55:00.000Z"
  });
  await insertRow(client, "project_serving_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    state: "unpublished",
    resume_state: "unpublished",
    updated_at: "2026-08-02T11:55:00.000Z"
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

async function seedAcceptedPlatformSite(
  client,
  authority,
  { compiler, theme = "clear" }
) {
  const rawFacts = {
    schema: "abracadabra.spark/v1",
    theme,
    businessName: `Alakazam ${theme} proof`,
    summary: "A paid Site Sourcery website with exact fulfillment evidence.",
    about: "Built once, accepted once, and published from durable facts.",
    offerings: ["Focused service", "Clear follow-through"],
    location: "Richmond, Virginia",
    hours: "Monday through Friday, 9-5",
    phone: "(804) 555-0100",
    email: `hello-${theme}@example.test`,
    website: "",
    primaryAction: "email"
  };
  const compiled = compiler.compile(rawFacts);
  const factSetId = randomUUID();
  const artifactId = randomUUID();
  const versionId = randomUUID();
  const screeningId = randomUUID();
  const attestationId = randomUUID();
  const stateEventId = randomUUID();
  const addressId = randomUUID();
  const label = `alakazam-${authority.projectId.slice(0, 8)}`;
  const hostname = `${label}.sitesourcery.me`;
  const facts = compiled.contentFacts;
  const normalized = compiled.normalizedFacts;
  const acceptedAt = "2026-08-02T11:58:00.000Z";

  await insertRow(client, "fact_sets", {
    id: factSetId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    schema_version: compiled.schema,
    theme: normalized.theme,
    business_name: facts.businessName,
    summary: facts.summary,
    about: facts.about,
    offerings_count: compiled.offerings.length,
    location: facts.location,
    hours: facts.hours,
    phone_display: facts.phone?.display ?? null,
    phone_href: facts.phone?.href ?? null,
    email_display: facts.email?.display ?? null,
    email_href: facts.email?.href ?? null,
    website_display: facts.website?.display ?? null,
    website_href: facts.website?.href ?? null,
    primary_action: facts.primaryAction,
    content_digest: compiled.contentDigest,
    normalized_digest: compiled.normalizedDigest,
    created_at: acceptedAt
  });
  for (const [index, offering] of compiled.offerings.entries()) {
    await insertRow(client, "fact_offerings", {
      organization_id: authority.organizationId,
      fact_set_id: factSetId,
      position: index + 1,
      offering
    });
  }
  await insertRow(client, "artifacts", {
    id: artifactId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    html_bytes: compiled.htmlBytes,
    created_at: acceptedAt
  });
  await insertRow(client, "site_versions", {
    id: versionId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    version_number: 1,
    fact_set_id: factSetId,
    artifact_id: artifactId,
    raw_facts: rawFacts,
    compiler_schema: compiled.schema,
    compiler_revision: compiled.compilerRevision,
    created_by_user_id: authority.userId,
    created_at: acceptedAt
  });
  await insertRow(client, "release_screenings", {
    id: screeningId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    version_id: versionId,
    stage: "pre_acceptance",
    method: "canonical_compile",
    passed: true,
    artifact_digest: compiled.artifactDigest,
    findings: JSON.stringify([]),
    checker_revision: compiled.compilerRevision,
    checked_at: acceptedAt
  });
  await insertRow(client, "version_attestations", {
    id: attestationId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    version_id: versionId,
    user_id: authority.userId,
    statement_version: "abracadabra.exact-preview/v1",
    attested_at: acceptedAt,
    request_id: randomUUID()
  });
  await insertRow(client, "version_state_events", {
    id: stateEventId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    version_id: versionId,
    state: "accepted_release",
    screening_id: screeningId,
    attestation_id: attestationId,
    actor_user_id: authority.userId,
    occurred_at: acceptedAt
  });
  await insertRow(client, "version_state_projection", {
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    version_id: versionId,
    state: "accepted_release",
    last_event_id: stateEventId,
    updated_at: acceptedAt
  });
  await insertRow(client, "project_addresses", {
    id: addressId,
    organization_id: authority.organizationId,
    project_id: authority.projectId,
    kind: "licensed",
    ownership: "licensed",
    label,
    retained_domain: null,
    serving_hostname: hostname,
    state: "configured",
    allocated_at: acceptedAt,
    configured_at: acceptedAt
  });
  await client.query(
    `update ss.project_address_projection
        set current_address_id = $3,
            updated_at = $4
      where organization_id = $1
        and project_id = $2`,
    [
      authority.organizationId,
      authority.projectId,
      addressId,
      acceptedAt
    ]
  );
  return Object.freeze({
    rawFacts,
    compiled,
    versionId,
    addressId,
    label,
    hostname
  });
}

function siteSetupDigestFor(authority, site) {
  return createAlakazamSiteSetupDigest({
    tenantId: authority.organizationId,
    customerId: authority.userId,
    projectId: authority.projectId,
    acceptedVersionId: site.versionId,
    artifactDigest: site.compiled.artifactDigest,
    configuredLook: site.rawFacts.theme,
    addressId: site.addressId,
    addressLabel: site.label,
    hostname: site.hostname
  });
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
      const compiler = await createSparkCompilerPort();
      await seedAcceptedPlatformSite(client, seeded, {
        compiler,
        theme: "clear"
      });
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
      const compiler = await createSparkCompilerPort();
      const acceptedSite = await seedAcceptedPlatformSite(
        client,
        authority,
        { compiler, theme: "clear" }
      );
      const siteSetupDigest = siteSetupDigestFor(
        authority,
        acceptedSite
      );
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
      await assert.rejects(
        repository.claimCustomerProvision({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId,
          provisionId: unusedProvisionId,
          acceptedDisclosureDigest: "f".repeat(64),
          siteSetupDigest,
          claimedAt: "2026-08-02T12:00:30.000Z"
        }),
        (error) => error.code === "alakazam_change_unavailable"
      );
      const unused = await repository.claimCustomerProvision({
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId,
        provisionId: unusedProvisionId,
        acceptedDisclosureDigest:
          disclosureDigestForQuote(quoteId),
        siteSetupDigest,
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
        acceptedDisclosureDigest:
          disclosureDigestForQuote(quoteId),
        siteSetupDigest,
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
        acceptedDisclosureDigest:
          disclosureDigestForQuote(quoteId),
        siteSetupDigest,
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
      const compiler = await createSparkCompilerPort();
      const acceptedSite = await seedAcceptedPlatformSite(
        client,
        authority,
        { compiler, theme: "warm" }
      );
      const siteSetupDigest = siteSetupDigestFor(
        authority,
        acceptedSite
      );
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
        acceptedDisclosureDigest:
          disclosureDigestForQuote(quoteId),
        siteSetupDigest,
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
          acceptedDisclosureDigest:
            disclosureDigestForQuote(quoteId),
          siteSetupDigest,
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
        acceptedDisclosureDigest:
          disclosureDigestForQuote(quoteId),
        siteSetupDigest,
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
      const compiler = await createSparkCompilerPort();

      const ambiguousAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_ambiguous"
      });
      const ambiguousSite = await seedAcceptedPlatformSite(
        client,
        ambiguousAuthority,
        { compiler, theme: "clear" }
      );
      const ambiguousSiteSetupDigest = siteSetupDigestFor(
        ambiguousAuthority,
        ambiguousSite
      );
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
      await assert.rejects(
        ambiguousRepository.claimCheckoutDispatch({
          tenantId: ambiguousAuthority.organizationId,
          customerId: ambiguousAuthority.userId,
          projectId: ambiguousAuthority.projectId,
          quoteId: ambiguousQuoteId,
          dispatchId: ambiguousDispatchId,
          stripeCustomerId:
            ambiguousAuthority.stripeCustomerId,
          acceptedDisclosureDigest: "f".repeat(64),
          siteSetupDigest: ambiguousSiteSetupDigest,
          claimedAt: "2026-08-02T12:00:30.000Z"
        }),
        (error) => error.code === "alakazam_change_unavailable"
      );
      await assert.rejects(
        ambiguousRepository.claimCheckoutDispatch({
          tenantId: ambiguousAuthority.organizationId,
          customerId: ambiguousAuthority.userId,
          projectId: ambiguousAuthority.projectId,
          quoteId: ambiguousQuoteId,
          dispatchId: ambiguousDispatchId,
          stripeCustomerId:
            ambiguousAuthority.stripeCustomerId,
          acceptedDisclosureDigest:
            disclosureDigestForQuote(ambiguousQuoteId),
          siteSetupDigest: "0".repeat(64),
          claimedAt: "2026-08-02T12:00:45.000Z"
        }),
        (error) => error.code === "alakazam_site_setup_changed"
      );
      const ambiguousClaim =
        await ambiguousRepository.claimCheckoutDispatch({
          tenantId: ambiguousAuthority.organizationId,
          customerId: ambiguousAuthority.userId,
          projectId: ambiguousAuthority.projectId,
          quoteId: ambiguousQuoteId,
          dispatchId: ambiguousDispatchId,
          stripeCustomerId:
            ambiguousAuthority.stripeCustomerId,
          acceptedDisclosureDigest:
            disclosureDigestForQuote(ambiguousQuoteId),
          siteSetupDigest: ambiguousSiteSetupDigest,
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
          acceptedDisclosureDigest:
            disclosureDigestForQuote(ambiguousQuoteId),
          siteSetupDigest: ambiguousSiteSetupDigest,
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
      const ambiguousAccount = createAlakazamAccountService({
        repository: ambiguousRepository
      });
      const ambiguousAccountScope = {
        tenantId: ambiguousAuthority.organizationId,
        customerId: ambiguousAuthority.userId,
        actorId: ambiguousAuthority.userId,
        projectId: ambiguousAuthority.projectId
      };
      assert.equal(
        (await ambiguousAccount.read(ambiguousAccountScope))
          .site.state,
        "attention_required"
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
      assert.equal(
        (await ambiguousAccount.read(ambiguousAccountScope))
          .site.state,
        "attention_required"
      );

      const failedAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_failed"
      });
      const failedSite = await seedAcceptedPlatformSite(client, failedAuthority, {
        compiler,
        theme: "warm"
      });
      const failedSiteSetupDigest = siteSetupDigestFor(
        failedAuthority,
        failedSite
      );
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
          acceptedDisclosureDigest:
            disclosureDigestForQuote(failedQuoteId),
          siteSetupDigest: failedSiteSetupDigest,
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
      const failedFulfillment = await client.query(
        `select intent.state,
                exists (
                  select 1
                    from ss.alakazam_fulfillment_projection projection
                   where projection.organization_id = intent.organization_id
                     and projection.project_id = intent.project_id
                     and projection.intent_id = intent.id
                ) as projection_exists
           from ss.alakazam_fulfillment_intents intent
          where intent.organization_id = $1
            and intent.quote_id = $2`,
        [failedAuthority.organizationId, failedQuoteId]
      );
      assert.deepEqual(
        failedFulfillment.rows,
        [
          {
            state: "superseded",
            projection_exists: false
          }
        ]
      );

      const staleAuthority = await seedAuthority(client, {
        stripeCustomerId: "cus_alakazam_stale"
      });
      const staleSite = await seedAcceptedPlatformSite(client, staleAuthority, {
        compiler,
        theme: "arcane"
      });
      const staleSiteSetupDigest = siteSetupDigestFor(
        staleAuthority,
        staleSite
      );
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
        acceptedDisclosureDigest:
          disclosureDigestForQuote(staleQuoteId),
        siteSetupDigest: staleSiteSetupDigest,
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
          acceptedDisclosureDigest:
            disclosureDigestForQuote(staleQuoteId),
          siteSetupDigest: staleSiteSetupDigest,
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
    dispatchedAt,
    siteSetupDigest
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
    acceptedDisclosureDigest:
      disclosureDigestForQuote(quoteId),
    siteSetupDigest,
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
    providerObservedAt,
    metadata = null
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
    metadata:
      metadata ??
      createAlakazamProviderMetadata({
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

function subscriptionActivationEvent(
  reservation,
  {
    stripeSubscriptionId,
    suffix,
    occurredAt,
    signatureVerifiedAt
  }
) {
  return {
    stripeEventId: `evt_${suffix}`,
    eventType: "customer.subscription.created",
    livemode: false,
    apiVersion: "2026-06-24.dahlia",
    stripeSubscriptionId,
    metadata: createAlakazamProviderMetadata({
      purpose: reservation.purpose,
      purposeDigest: reservation.purposeDigest
    }),
    payloadDigest: digest(`payload:${suffix}`),
    signatureVerifiedAt,
    occurredAt
  };
}

function upgradeActivationWebhookEvent(
  reservation,
  application,
  {
    stripeSubscriptionId,
    suffix,
    occurredAt
  }
) {
  return {
    id: `evt_${suffix}`,
    type: "customer.subscription.updated",
    livemode: false,
    api_version: "2026-06-24.dahlia",
    created: Date.parse(occurredAt) / 1000,
    data: {
      object: {
        id: stripeSubscriptionId,
        metadata: {
          ...createAlakazamProviderMetadata({
            purpose: reservation.purpose,
            purposeDigest: reservation.purposeDigest
          }),
          payment_receipt_id: application.receiptId,
          payment_facts_digest:
            application.paymentProviderFactsDigest
        }
      }
    }
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
    const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
    const client = await pool.connect();
    let runtimeRoot = null;
    let runtime = null;
    let worker = null;
    let workerNow = null;
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const authority = await seedAuthority(client);
      const compiler = await createSparkCompilerPort();
      const acceptedSite = await seedAcceptedPlatformSite(
        client,
        authority,
        { compiler, theme: "clear" }
      );
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
          dispatchedAt: "2026-08-02T12:01:05.000Z",
          siteSetupDigest: siteSetupDigestFor(
            authority,
            acceptedSite
          )
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

      const pendingActivation =
        await settlementRepository
          .findStartActivationBySubscription({
            stripeSubscriptionId:
              "sub_alakazam_contract"
          });
      assert.equal(pendingActivation.status, "pending");
      assert.equal(
        pendingActivation.pending.subscriptionId,
        subscriptionId
      );
      assert.equal(
        pendingActivation.pending.receiptId,
        startReceiptId
      );
      const startActivationFacts =
        subscriptionPaymentFacts(
          startResolved.reservation,
          {
            stripeSubscriptionId:
              "sub_alakazam_contract",
            stripeSubscriptionItemId:
              "si_alakazam_contract",
            stripePriceId: "price_alakazam_25",
            currentPeriodStartsAt:
              "2026-08-02T12:03:00.000Z",
            currentPeriodEndsAt:
              "2026-09-02T12:03:00.000Z",
            providerObservedAt:
              "2026-08-02T12:04:00.000Z"
          }
        );
      const startActivation =
        await settlementRepository.activateStartSubscription({
          reservation: pendingActivation.reservation,
          subscriptionId,
          receiptId: startReceiptId,
          event: subscriptionActivationEvent(
            pendingActivation.reservation,
            {
              stripeSubscriptionId:
                "sub_alakazam_contract",
              suffix: "alakazam_start_provider",
              occurredAt: "2026-08-02T12:03:00.000Z",
              signatureVerifiedAt:
                "2026-08-02T12:03:05.000Z"
            }
          ),
          subscription: startActivationFacts,
          eventRowId: randomUUID(),
          tierEventId: randomUUID()
        });
      assert.deepEqual(startActivation, {
        status: "active",
        provider: "stripe",
        changeKind: "start",
        projectId: authority.projectId,
        quoteId: startQuoteId,
        subscriptionId,
        receiptId: startReceiptId,
        tierId: "alakazam_25",
        revision: 2,
        currentPeriodStartsAt:
          "2026-08-02T12:03:00.000Z",
        currentPeriodEndsAt:
          "2026-09-02T12:03:00.000Z",
        subscriptionProviderFactsDigest:
          startActivationFacts.providerFactsDigest
      });
      await flushConstraints(client);
      const activeReplay =
        await settlementRepository
          .findStartActivationBySubscription({
            stripeSubscriptionId:
              "sub_alakazam_contract"
          });
      assert.equal(activeReplay.status, "active");
      assert.deepEqual(
        activeReplay.activation,
        startActivation
      );

      const fulfillmentOperationId = randomUUID();
      const queuedFulfillment =
        await settlementRepository.enqueueStartFulfillment({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId: startQuoteId,
          subscriptionId,
          subscriptionRevision: startActivation.revision,
          tierId: startActivation.tierId,
          operationId: fulfillmentOperationId,
          enqueuedAt: "2026-08-02T12:05:00.000Z"
        });
      assert.equal(queuedFulfillment.status, "queued");
      assert.equal(
        queuedFulfillment.operationId,
        fulfillmentOperationId
      );
      await flushConstraints(client);

      runtimeRoot = await mkdtemp(
        path.join(os.tmpdir(), "sitesourcery-alakazam-pg-")
      );
      workerNow = "2026-08-02T12:06:00.000Z";
      runtime = await SelfHostRuntime.open({
        root: path.join(runtimeRoot, "tenant"),
        publicationHeld: false,
        platformBaseDomain: "sitesourcery.me",
        clock: () => workerNow
      });
      worker = createAlakazamFulfillmentWorker({
        repository: settlementRepository,
        compiler,
        publicationPort: createSelfHostPublicationPort({
          runtime,
          clock: { now: () => workerNow }
        }),
        clock: { now: () => workerNow },
        ids: { next: () => randomUUID() },
        workerId: "alakazam-postgres-contract-worker"
      });
      const live = await worker.runOnce();
      assert.equal(live.status, "live");
      assert.equal(live.operationId, fulfillmentOperationId);
      assert.equal(live.projectId, authority.projectId);
      assert.equal(live.subscriptionId, subscriptionId);
      assert.equal(live.subscriptionRevision, 2);
      assert.equal(live.tierId, "alakazam_25");
      assert.equal(live.hostname, acceptedSite.hostname);
      assert.equal(live.sourceVersionId, acceptedSite.versionId);
      await flushConstraints(client);

      const durable = await client.query(
        `select
           operation.state as operation_state,
           projection.state as projection_state,
           serving.state as serving_state,
           artifact.html_bytes,
           artifact.artifact_digest
         from ss.alakazam_fulfillment_operations operation
         join ss.alakazam_fulfillment_projection projection
           on projection.organization_id = operation.organization_id
          and projection.operation_id = operation.id
         join ss.project_serving_projection serving
           on serving.organization_id = operation.organization_id
          and serving.project_id = operation.project_id
         join ss.artifacts artifact
           on artifact.organization_id = operation.organization_id
          and artifact.id = operation.effective_artifact_id
        where operation.id = $1`,
        [fulfillmentOperationId]
      );
      assert.equal(durable.rowCount, 1);
      assert.deepEqual(
        {
          operation: durable.rows[0].operation_state,
          projection: durable.rows[0].projection_state,
          serving: durable.rows[0].serving_state
        },
        {
          operation: "published",
          projection: "live",
          serving: "live"
        }
      );
      assert.equal(
        durable.rows[0].artifact_digest,
        live.artifactDigest
      );

      const response = await runtime.fetch(
        new Request(`https://${acceptedSite.hostname}/`, {
          headers: { host: acceptedSite.hostname }
        })
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        Buffer.from(durable.rows[0].html_bytes)
      );
      assert.equal((await worker.runOnce()).status, "idle");

      const enqueueReplay =
        await settlementRepository.enqueueStartFulfillment({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId: startQuoteId,
          subscriptionId,
          subscriptionRevision: startActivation.revision,
          tierId: startActivation.tierId,
          operationId: randomUUID(),
          enqueuedAt: "2026-08-02T12:07:00.000Z"
        });
      assert.equal(
        enqueueReplay.operationId,
        fulfillmentOperationId
      );
      assert.equal(enqueueReplay.status, "published");

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
      const competingUpgradeQuoteId = await insertQuote(
        client,
        authority,
        {
          changeKind: "upgrade",
          currentSubscriptionId: subscriptionId,
          currentSubscriptionRevision: 2,
          currentTierId: "alakazam_25",
          currentAmountMinor: 2500,
          currentPeriodEndsAt:
            "2026-09-02T12:03:00.000Z",
          targetTierId: "alakazam_50",
          targetAmountMinor: 5000,
          appliedValueKind: "current_paid_tier",
          appliedValueMinor: 2500,
          dueNowSubtotalMinor: 2500,
          effectiveRule:
            "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-08-02T12:10:30.000Z",
          expiresAt: "2026-08-02T12:30:00.000Z"
        }
      );
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
          dispatchedAt: "2026-08-02T12:11:05.000Z",
          siteSetupDigest: null
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
      const competingDispatchId = randomUUID();
      await assert.rejects(
        settlementRepository.claimCheckoutDispatch({
          tenantId: authority.organizationId,
          customerId: authority.userId,
          projectId: authority.projectId,
          quoteId: competingUpgradeQuoteId,
          dispatchId: competingDispatchId,
          stripeCustomerId: authority.stripeCustomerId,
          acceptedDisclosureDigest:
            disclosureDigestForQuote(
              competingUpgradeQuoteId
            ),
          siteSetupDigest: null,
          claimedAt: "2026-08-02T12:12:06.000Z"
        }),
        (error) =>
          error.code === "alakazam_change_pending" &&
          error.status === 409
      );
      const competingUpgrade = await client.query(
        `select quote.state,
                count(dispatch.id)::integer
                  as dispatch_count
           from ss.alakazam_change_quotes quote
           left join ss.alakazam_checkout_dispatches dispatch
             on dispatch.quote_id = quote.id
          where quote.id = $1
          group by quote.state`,
        [competingUpgradeQuoteId]
      );
      assert.deepEqual(competingUpgrade.rows, [
        {
          state: "quoted",
          dispatch_count: 0
        }
      ]);
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
      assert.equal(
        await settlementRepository.findUpgradeApplication({
          settlement: upgradeSettlement,
          observedAt: "2026-08-02T12:12:10.000Z"
        }),
        null
      );
      const upgradeApplicationId = randomUUID();
      const claimedUpgrade =
        await settlementRepository.claimUpgradeApplication({
          settlement: upgradeSettlement,
          applicationId: upgradeApplicationId,
          claimedAt: "2026-08-02T12:13:00.000Z"
        });
      assert.equal(claimedUpgrade.status, "claimed");
      assert.equal(
        claimedUpgrade.application.applicationId,
        upgradeApplicationId
      );
      const interruptedUpgrade =
        await settlementRepository.findUpgradeApplication({
          settlement: upgradeSettlement,
          observedAt: "2026-08-02T12:15:00.000Z"
        });
      assert.equal(
        interruptedUpgrade.status,
        "reconciliation_required"
      );
      assert.equal(
        interruptedUpgrade.application.applicationId,
        upgradeApplicationId
      );
      const upgradeProviderFacts =
        subscriptionPaymentFacts(
          claimedUpgrade.reservation,
          {
            stripeSubscriptionId:
              "sub_alakazam_contract",
            stripeSubscriptionItemId:
              "si_alakazam_contract",
            stripePriceId: "price_alakazam_35",
            currentPeriodStartsAt:
              "2026-08-02T12:03:00.000Z",
            currentPeriodEndsAt:
              "2026-09-02T12:03:00.000Z",
            providerObservedAt:
              "2026-08-02T12:15:02.000Z",
            metadata: {
              ...createAlakazamProviderMetadata({
                purpose:
                  claimedUpgrade.reservation.purpose,
                purposeDigest:
                  claimedUpgrade.reservation
                    .purposeDigest
              }),
              payment_receipt_id: upgradeReceiptId,
              payment_facts_digest:
                upgradePayment.providerFactsDigest
            }
          }
        );
      const upgradeActivationFacts =
        subscriptionPaymentFacts(
          claimedUpgrade.reservation,
          {
            stripeSubscriptionId:
              "sub_alakazam_contract",
            stripeSubscriptionItemId:
              "si_alakazam_contract",
            stripePriceId: "price_alakazam_35",
            currentPeriodStartsAt:
              "2026-08-02T12:03:00.000Z",
            currentPeriodEndsAt:
              "2026-09-02T12:03:00.000Z",
            providerObservedAt:
              "2026-08-02T12:16:06.000Z",
            metadata: {
              ...createAlakazamProviderMetadata({
                purpose:
                  claimedUpgrade.reservation.purpose,
                purposeDigest:
                  claimedUpgrade.reservation
                    .purposeDigest
              }),
              payment_receipt_id: upgradeReceiptId,
              payment_facts_digest:
                upgradePayment.providerFactsDigest
            }
          }
        );
      const upgradeProviderCalls = {
        applies: 0,
        reads: 0,
        ids: 0
      };
      let upgradeClockCalls = 0;
      const upgradeActivationIds = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID()
      ];
      const upgradeFulfillmentOperationId =
        upgradeActivationIds[2];
      const upgradeService = createAlakazamUpgradeService({
        repository: settlementRepository,
        provider: {
          async readiness() {
            return {
              ready: true,
              provider: "stripe",
              alakazam: true,
              taxMode: "disabled_by_owner",
              livemode: false
            };
          },
          async applyAlakazamUpgrade() {
            upgradeProviderCalls.applies += 1;
            throw new Error(
              "an interrupted mutation must not be submitted again"
            );
          },
          async retrieveAlakazamSubscription() {
            upgradeProviderCalls.reads += 1;
            return structuredClone(
              upgradeProviderCalls.reads === 1
                ? upgradeProviderFacts
                : upgradeActivationFacts
            );
          }
        },
        clock: {
          now() {
            upgradeClockCalls += 1;
            return [
              "2026-08-02T12:15:03.000Z",
              "2026-08-02T12:15:04.000Z",
              "2026-08-02T12:16:05.000Z",
              "2026-08-02T12:16:06.000Z",
              "2026-08-02T12:16:07.000Z",
              "2026-08-02T12:16:08.000Z",
              "2026-09-02T12:05:00.000Z",
              "2026-09-02T12:05:01.000Z"
            ][upgradeClockCalls - 1];
          }
        },
        ids: {
          next(label) {
            upgradeProviderCalls.ids += 1;
            assert.ok(
              [
                "alakazam_upgrade_subscription_event",
                "alakazam_upgrade_tier_event",
                "alakazam_tier_fulfillment_operation"
              ].includes(label)
            );
            return upgradeActivationIds.shift();
          }
        },
        release: createAlakazamBillingRelease({
          approved: true,
          taxMode: "disabled_by_owner"
        })
      });
      const providerConfirmedUpgrade =
        await upgradeService.applyPaidUpgrade(
          upgradeSettlement
        );
      assert.deepEqual(upgradeProviderCalls, {
        applies: 0,
        reads: 1,
        ids: 0
      });
      assert.deepEqual(providerConfirmedUpgrade, {
        status: "provider_confirmed",
        provider: "stripe",
        changeKind: "upgrade",
        applicationId: upgradeApplicationId,
        projectId: authority.projectId,
        quoteId: upgradeQuoteId,
        subscriptionId,
        receiptId: upgradeReceiptId,
        priorTierId: "alakazam_25",
        targetTierId: "alakazam_35",
        currentRevision: 2,
        currentPeriodStartsAt:
          "2026-08-02T12:03:00.000Z",
        currentPeriodEndsAt:
          "2026-09-02T12:03:00.000Z",
        paymentProviderFactsDigest:
          upgradePayment.providerFactsDigest,
        subscriptionProviderFactsDigest:
          upgradeProviderFacts.providerFactsDigest,
        reconciliation: "readback_after_ambiguity",
        next: "subscription_event_confirmation"
      });
      const providerStagedUpgrade = await client.query(
        `select application.state as application_state,
                quote.state as quote_state,
                subscription.tier_id,
                subscription.revision
           from ss.alakazam_upgrade_applications application
           join ss.alakazam_change_quotes quote
             on quote.id = application.quote_id
           join ss.alakazam_subscriptions subscription
             on subscription.id = application.subscription_id
          where application.id = $1`,
        [upgradeApplicationId]
      );
      assert.deepEqual(
        {
          applicationState:
            providerStagedUpgrade.rows[0]
              .application_state,
          quoteState:
            providerStagedUpgrade.rows[0].quote_state,
          tierId: providerStagedUpgrade.rows[0].tier_id,
          revision: Number(
            providerStagedUpgrade.rows[0].revision
          )
        },
        {
          applicationState: "provider_confirmed",
          quoteState: "provider_change_pending",
          tierId: "alakazam_25",
          revision: 2
        }
      );
      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_upgrade_applications
              set state = 'applied', applied_at = $2
            where id = $1`,
          [
            upgradeApplicationId,
            "2026-08-02T12:15:05.000Z"
          ]
        ),
        /lacks exact atomic activation evidence/iu
      );
      const providerConfirmationReplay =
        await settlementRepository.findUpgradeApplication({
          settlement: upgradeSettlement,
          observedAt: "2026-08-02T12:15:04.000Z"
        });
      assert.equal(
        providerConfirmationReplay.status,
        "provider_confirmed"
      );
      assert.deepEqual(
        providerConfirmationReplay.confirmation,
        providerConfirmedUpgrade
      );
      const upgradeActivationEvent =
        upgradeActivationWebhookEvent(
          claimedUpgrade.reservation,
          claimedUpgrade.application,
          {
            stripeSubscriptionId:
              "sub_alakazam_contract",
            suffix: "alakazam_upgrade_provider",
            occurredAt: "2026-08-02T12:16:00.000Z"
          }
        );
      const activatedUpgrade =
        await upgradeService.ingestStripeEvent(
          upgradeActivationEvent
        );
      assert.deepEqual(activatedUpgrade, {
        status: "active",
        provider: "stripe",
        changeKind: "upgrade",
        applicationId: upgradeApplicationId,
        projectId: authority.projectId,
        quoteId: upgradeQuoteId,
        subscriptionId,
        receiptId: upgradeReceiptId,
        priorTierId: "alakazam_25",
        targetTierId: "alakazam_35",
        revision: 3,
        currentPeriodStartsAt:
          "2026-08-02T12:03:00.000Z",
        currentPeriodEndsAt:
          "2026-09-02T12:03:00.000Z",
        paymentProviderFactsDigest:
          upgradePayment.providerFactsDigest,
        subscriptionProviderFactsDigest:
          upgradeActivationFacts.providerFactsDigest,
        next: "complete"
      });
      assert.deepEqual(upgradeProviderCalls, {
        applies: 0,
        reads: 2,
        ids: 3
      });
      assert.deepEqual(
        await upgradeService.ingestStripeEvent(
          upgradeActivationEvent
        ),
        activatedUpgrade
      );
      assert.deepEqual(upgradeProviderCalls, {
        applies: 0,
        reads: 2,
        ids: 4
      });
      await flushConstraints(client);

      workerNow = "2026-08-02T12:16:09.000Z";
      const upgradedLive = await worker.runOnce();
      assert.equal(upgradedLive.status, "live");
      assert.equal(
        upgradedLive.operationId,
        upgradeFulfillmentOperationId
      );
      assert.equal(upgradedLive.projectId, authority.projectId);
      assert.equal(upgradedLive.subscriptionId, subscriptionId);
      assert.equal(upgradedLive.subscriptionRevision, 3);
      assert.equal(upgradedLive.tierId, "alakazam_35");
      assert.equal(upgradedLive.hostname, acceptedSite.hostname);
      assert.equal(
        upgradedLive.sourceVersionId,
        acceptedSite.versionId
      );
      await flushConstraints(client);
      assert.equal((await worker.runOnce()).status, "idle");

      const publicationTimes = [
        "2026-08-02T12:17:00.000Z",
        "2026-08-02T12:17:01.000Z",
        "2026-08-02T12:17:02.000Z",
        "2026-08-02T12:17:03.000Z",
        "2026-08-02T12:17:04.000Z",
        "2026-08-02T12:17:05.000Z"
      ];
      const publicationRepository =
        createPostgresAlakazamPublicationRepository({
          authority: {
            async service(_context, work) {
              return work(client);
            }
          }
        });
      const publication = createAlakazamPublicationService({
        repository: publicationRepository,
        clock: {
          now() {
            return new Date(publicationTimes.shift());
          }
        }
      });
      const publicationScope = {
        tenantId: authority.organizationId,
        customerId: authority.userId,
        actorId: authority.userId,
        projectId: authority.projectId
      };
      const publicationReady =
        await publicationRepository.readiness();
      assert.deepEqual(
        {
          authorization: publicationReady.authorization,
          providerEffects: publicationReady.providerEffects,
          state: publicationReady.state
        },
        {
          authorization: true,
          providerEffects: false,
          state: "held"
        }
      );
      await client.query(
        `grant select on table
           ss.alakazam_customer_publication_commands
         to authenticated`
      );
      await assert.rejects(
        publicationRepository.readiness(),
        /table privileges is not ready/iu
      );
      await client.query(
        `revoke select on table
           ss.alakazam_customer_publication_commands
         from authenticated`
      );
      await client.query(
        `grant select (snapshot_digest) on
           ss.alakazam_customer_publication_commands
         to authenticated`
      );
      await assert.rejects(
        publicationRepository.readiness(),
        /column privileges is not ready/iu
      );
      await client.query(
        `revoke select (snapshot_digest) on
           ss.alakazam_customer_publication_commands
         from authenticated`
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         disable trigger
           alakazam_customer_publication_commands_immutable`
      );
      await assert.rejects(
        publicationRepository.readiness(),
        /triggers is not ready/iu
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         enable trigger
           alakazam_customer_publication_commands_immutable`
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         drop constraint alakazam_publication_state_check`
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         add constraint alakazam_publication_state_check
         check (state in ('held', 'rogue'))`
      );
      await assert.rejects(
        publicationRepository.readiness(),
        /constraints is not ready/iu
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         drop constraint alakazam_publication_state_check`
      );
      await client.query(
        `alter table ss.alakazam_customer_publication_commands
         add constraint alakazam_publication_state_check
         check (state = 'held')`
      );
      assert.equal(
        (await publicationRepository.readiness()).ready,
        true
      );
      const livePublication =
        await publication.read(publicationScope);
      assert.equal(
        livePublication.site.currentReleaseId,
        upgradedLive.releaseId
      );
      assert.equal(livePublication.history.length, 2);
      assert.deepEqual(livePublication.actions, {
        publish: false,
        rollback: true,
        unpublish: true,
        rollbackTargetReleaseId: live.releaseId
      });
      const beforeHeldCommands = await client.query(
        `select
           serving.state as serving_state,
           serving.current_release_id,
           projection.state as projection_state,
           projection.current_release_id as projection_release_id,
           (select count(*)::integer
              from ss.releases release
             where release.organization_id = $1
               and release.project_id = $2) as release_count
         from ss.project_serving_projection serving
         join ss.alakazam_fulfillment_projection projection
           on projection.organization_id = serving.organization_id
          and projection.project_id = serving.project_id
        where serving.organization_id = $1
          and serving.project_id = $2`,
        [authority.organizationId, authority.projectId]
      );
      const rollbackCommandId = randomUUID();
      const heldRollback = await publication.request(
        publicationScope,
        {
          commandId: rollbackCommandId,
          action: "rollback",
          snapshotDigest: livePublication.snapshotDigest,
          targetReleaseId: live.releaseId
        }
      );
      assert.equal(heldRollback.command.state, "held");
      assert.equal(
        heldRollback.command.targetReleaseId,
        live.releaseId
      );
      await flushConstraints(client);
      assert.equal(
        (await publication.request(publicationScope, {
          commandId: rollbackCommandId,
          action: "rollback",
          snapshotDigest: livePublication.snapshotDigest,
          targetReleaseId: live.releaseId
        })).command.commandDigest,
        heldRollback.command.commandDigest
      );
      await assert.rejects(
        publication.request(publicationScope, {
          commandId: randomUUID(),
          action: "rollback",
          snapshotDigest: "f".repeat(64),
          targetReleaseId: live.releaseId
        }),
        (error) =>
          error.code === "publication_authority_changed" &&
          error.status === 409
      );
      const heldUnpublish = await publication.request(
        publicationScope,
        {
          commandId: randomUUID(),
          action: "unpublish",
          snapshotDigest: livePublication.snapshotDigest,
          targetReleaseId: null
        }
      );
      assert.equal(heldUnpublish.command.state, "held");
      assert.equal(heldUnpublish.command.targetVersionId, null);
      await flushConstraints(client);

      await client.query(
        `update ss.alakazam_fulfillment_projection
            set state = 'dark',
                current_release_id = null,
                updated_at = $3
          where organization_id = $1
            and project_id = $2`,
        [
          authority.organizationId,
          authority.projectId,
          "2026-08-02T12:17:10.000Z"
        ]
      );
      const darkPublication =
        await publication.read(publicationScope);
      assert.deepEqual(darkPublication.actions, {
        publish: true,
        rollback: false,
        unpublish: false,
        rollbackTargetReleaseId: null
      });
      const heldPublish = await publication.request(
        publicationScope,
        {
          commandId: randomUUID(),
          action: "publish",
          snapshotDigest: darkPublication.snapshotDigest,
          targetReleaseId: null
        }
      );
      assert.equal(heldPublish.command.state, "held");
      assert.equal(
        heldPublish.command.targetVersionId,
        acceptedSite.versionId
      );
      await flushConstraints(client);
      await assert.rejects(
        publication.read({
          ...publicationScope,
          projectId: randomUUID()
        }),
        (error) =>
          error.code === "project_unavailable" &&
          error.status === 404
      );
      const heldProof = await client.query(
        `select
           (select count(*)::integer
              from ss.alakazam_customer_publication_commands
             where organization_id = $1
               and project_id = $2) as command_count,
           (select count(*)::integer
              from ss.releases release
             where release.organization_id = $1
               and release.project_id = $2) as release_count,
           serving.state as serving_state,
           serving.current_release_id
         from ss.project_serving_projection serving
        where serving.organization_id = $1
          and serving.project_id = $2`,
        [authority.organizationId, authority.projectId]
      );
      assert.deepEqual(
        {
          commandCount: heldProof.rows[0].command_count,
          releaseCount: heldProof.rows[0].release_count,
          servingState: heldProof.rows[0].serving_state,
          currentReleaseId:
            heldProof.rows[0].current_release_id
        },
        {
          commandCount: 3,
          releaseCount:
            beforeHeldCommands.rows[0].release_count,
          servingState:
            beforeHeldCommands.rows[0].serving_state,
          currentReleaseId:
            beforeHeldCommands.rows[0].current_release_id
        }
      );
      await client.query(
        `update ss.alakazam_fulfillment_projection
            set state = 'live',
                current_release_id = $3,
                updated_at = $4
          where organization_id = $1
            and project_id = $2`,
        [
          authority.organizationId,
          authority.projectId,
          upgradedLive.releaseId,
          "2026-08-02T12:17:20.000Z"
        ]
      );
      await flushConstraints(client);
      const changedAfterHeldCommand =
        await publication.read(publicationScope);
      assert.equal(changedAfterHeldCommand.command, null);
      await assert.rejects(
        publication.request(publicationScope, {
          commandId: heldPublish.command.commandId,
          action: "publish",
          snapshotDigest: darkPublication.snapshotDigest,
          targetReleaseId: null
        }),
        (error) =>
          error.code === "publication_authority_changed" &&
          error.status === 409
      );

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
      const downgradeQuote = await client.query(
        `select disclosure_digest, quote_digest
           from ss.alakazam_change_quotes
          where id = $1`,
        [downgradeQuoteId]
      );
      assert.equal(downgradeQuote.rowCount, 1);
      const downgradeCommand = {
        tenantId: authority.organizationId,
        customerId: authority.userId,
        projectId: authority.projectId,
        quoteId: downgradeQuoteId,
        acceptedDisclosureDigest:
          downgradeQuote.rows[0].disclosure_digest,
        quoteDigest: downgradeQuote.rows[0].quote_digest
      };
      const downgradeProviderCalls = {
        schedules: 0,
        reads: 0,
        ids: 0
      };
      let downgradeClockCalls = 0;
      const downgradeIds = [randomUUID(), randomUUID()];
      function downgradeScheduleFacts(
        purpose,
        providerObservedAt =
          "2026-08-02T12:21:02.000Z"
      ) {
        const facts = {
          schema: ALAKAZAM_SCHEDULE_PROVIDER_FACTS_SCHEMA,
          stripeScheduleId:
            "sub_sched_alakazam_35_25",
          stripeSubscriptionId:
            purpose.currentSubscription
              .stripeSubscriptionId,
          stripeCustomerId: purpose.stripeCustomerId,
          currentTierId:
            purpose.currentSubscription.tierId,
          targetTierId: purpose.targetTierId,
          currentPriceId:
            purpose.currentSubscription.stripePriceId,
          targetPriceId: "price_alakazam_25",
          effectiveAt:
            purpose.currentSubscription.currentPeriodEndsAt,
          endBehavior: "release",
          providerProration: false,
          providerObservedAt
        };
        return {
          ...facts,
          providerFactsDigest: canonicalDigest(facts)
        };
      }
      await expectRejected(
        client,
        async () => {
          await client.query(
            `update ss.alakazam_fulfillment_projection
                set state = 'dark'
              where organization_id = $1
                and project_id = $2`,
            [
              authority.organizationId,
              authority.projectId
            ]
          );
          await settlementRepository
            .claimDowngradeApplication({
              command: downgradeCommand,
              scheduleId: randomUUID(),
              claimedAt:
                "2026-08-02T12:20:29.000Z"
            });
        },
        /durable Alakazam downgrade binding changed/iu
      );
      await expectRejected(
        client,
        async () => {
          const unsupported =
            await settlementRepository
              .claimDowngradeApplication({
                command: downgradeCommand,
                scheduleId: randomUUID(),
                claimedAt:
                  "2026-08-02T12:20:30.000Z"
              });
          const unsupportedFacts =
            downgradeScheduleFacts(
              unsupported.application.purpose,
              "2026-08-02T12:20:31.000Z"
            );
          await client.query(
            `update ss.alakazam_downgrade_schedules
                set state = 'scheduled',
                    target_stripe_price_id = $2,
                    stripe_schedule_id = $3,
                    provider_effect_certainty = 'confirmed',
                    provider_facts = $4::jsonb,
                    provider_facts_digest = $5,
                    provider_reconciliation = 'confirmed',
                    scheduled_at = $6
              where id = $1`,
            [
              unsupported.application.scheduleId,
              unsupportedFacts.targetPriceId,
              unsupportedFacts.stripeScheduleId,
              JSON.stringify(unsupportedFacts),
              unsupportedFacts.providerFactsDigest,
              "2026-08-02T12:20:32.000Z"
            ]
          );
          await client.query(
            `update ss.alakazam_change_quotes
                set state = 'scheduled'
              where id = $1`,
            [downgradeQuoteId]
          );
        },
        /lacks exact atomic local evidence/iu
      );
      const downgradeService =
        createAlakazamDowngradeService({
          repository: settlementRepository,
          provider: {
            async readiness() {
              return {
                ready: true,
                provider: "stripe",
                alakazam: true,
                taxMode: "disabled_by_owner",
                livemode: false
              };
            },
            async scheduleAlakazamDowngrade(input) {
              downgradeProviderCalls.schedules += 1;
              throw Object.assign(
                new Error("Schedule update response lost"),
                {
                  code: "stripe_schedule_update_unknown",
                  details: {
                    stripeScheduleId:
                      "sub_sched_alakazam_35_25"
                  }
                }
              );
            },
            async retrieveAlakazamSchedule(input) {
              downgradeProviderCalls.reads += 1;
              assert.equal(
                input.stripeScheduleId,
                "sub_sched_alakazam_35_25"
              );
              return downgradeScheduleFacts(input.purpose);
            }
          },
          clock: {
            now() {
              downgradeClockCalls += 1;
              return [
                "2026-08-02T12:21:00.000Z",
                "2026-08-02T12:21:01.000Z",
                "2026-08-02T12:21:02.000Z",
                "2026-08-02T12:21:03.000Z",
                "2026-08-02T12:21:04.000Z"
              ][downgradeClockCalls - 1];
            }
          },
          ids: {
            next(label) {
              downgradeProviderCalls.ids += 1;
              assert.ok(
                [
                  "alakazam_downgrade_application",
                  "alakazam_downgrade_tier_event"
                ].includes(label)
              );
              return downgradeIds.shift();
            }
          },
          release: createAlakazamBillingRelease({
            approved: true,
            taxMode: "disabled_by_owner"
          })
        });
      await assert.rejects(
        downgradeService.scheduleDowngrade(
          downgradeCommand
        ),
        (error) =>
          error.code ===
            "alakazam_downgrade_reconciliation_required" &&
          error.status === 409
      );
      assert.deepEqual(downgradeProviderCalls, {
        schedules: 1,
        reads: 0,
        ids: 1
      });
      const scheduledDowngrade =
        await downgradeService.scheduleDowngrade(
          downgradeCommand
        );
      const downgradeScheduleId =
        scheduledDowngrade.scheduleId;
      assert.deepEqual(downgradeProviderCalls, {
        schedules: 1,
        reads: 1,
        ids: 2
      });
      assert.equal(scheduledDowngrade.status, "scheduled");
      assert.equal(
        scheduledDowngrade.effectiveAt,
        "2026-09-02T12:03:00.000Z"
      );
      assert.equal(
        scheduledDowngrade.next,
        "boundary_confirmation"
      );
      assert.deepEqual(
        await downgradeService.scheduleDowngrade(
          downgradeCommand
        ),
        scheduledDowngrade
      );
      assert.deepEqual(downgradeProviderCalls, {
        schedules: 1,
        reads: 1,
        ids: 2
      });
      await flushConstraints(client);

      const account = createAlakazamAccountService({
        repository: settlementRepository
      });
      const accountScope = {
        tenantId: authority.organizationId,
        customerId: authority.userId,
        actorId: authority.userId,
        projectId: authority.projectId
      };
      const scheduledAccount = await account.read(
        accountScope
      );
      assert.deepEqual(
        {
          state: scheduledAccount.state,
          tierId:
            scheduledAccount.subscription.tier.tierId,
          amountMinor:
            scheduledAccount.subscription.price
              .amountMinor,
          pendingKind:
            scheduledAccount.pendingChange.changeKind,
          pendingTierId:
            scheduledAccount.pendingChange.targetTier
              .tierId,
          pendingState:
            scheduledAccount.pendingChange.state,
          renewalTierId:
            scheduledAccount.nextRenewal.tierId,
          renewalAmountMinor:
            scheduledAccount.nextRenewal.amountMinor,
          renewalDueAt:
            scheduledAccount.nextRenewal.dueAt,
          receiptTotals: scheduledAccount.receipts.map(
            (receipt) => receipt.totalMinor
          )
        },
        {
          state: "active",
          tierId: "alakazam_35",
          amountMinor: 3500,
          pendingKind: "downgrade",
          pendingTierId: "alakazam_25",
          pendingState: "scheduled",
          renewalTierId: "alakazam_25",
          renewalAmountMinor: 2500,
          renewalDueAt:
            "2026-09-02T12:03:00.000Z",
          receiptTotals: [1000, 2500]
        }
      );
      assert.doesNotMatch(
        JSON.stringify(scheduledAccount),
        /(?:cs_|cus_|in_|pi_|price_|si_|sub_)/u
      );
      const otherMemberId = randomUUID();
      await client.query(
        "insert into auth.users (id, email) values ($1, $2)",
        [
          otherMemberId,
          `alakazam-member-${otherMemberId}@example.test`
        ]
      );
      await insertRow(client, "organization_memberships", {
        organization_id: authority.organizationId,
        user_id: otherMemberId,
        role: "editor",
        state: "active",
        accepted_at: "2026-08-02T12:22:00.000Z"
      });
      const otherMemberAccount = createAlakazamAccountService({
        repository: createPostgresAlakazamRepository({
          authority: {
            async service(_context, work) {
              return work(client);
            }
          }
        })
      });
      await assert.rejects(
        otherMemberAccount.read({
          tenantId: authority.organizationId,
          customerId: otherMemberId,
          actorId: otherMemberId,
          projectId: authority.projectId
        }),
        (error) =>
          error.code === "project_unavailable" &&
          error.status === 404
      );
      for (const unavailableScope of [
        {
          ...accountScope,
          tenantId: randomUUID()
        },
        {
          ...accountScope,
          projectId: randomUUID()
        }
      ]) {
        await assert.rejects(
          account.read(unavailableScope),
          (error) =>
            error.code === "project_unavailable" &&
            error.status === 404
        );
      }

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

      const scheduledActivation =
        await settlementRepository
          .findDowngradeActivationBySubscription({
            stripeSubscriptionId:
              "sub_alakazam_contract",
            subscriptionId,
            quoteId: downgradeQuoteId
          });
      assert.equal(scheduledActivation.status, "scheduled");
      await expectRejected(
        client,
        () => client.query(
          `update ss.alakazam_downgrade_schedules
              set state = 'applied', applied_at = $2
            where id = $1`,
          [
            downgradeScheduleId,
            "2026-09-02T12:03:00.000Z"
          ]
        ),
        /lacks exact atomic activation evidence/iu
      );
      const downgradeMetadata =
        createAlakazamProviderMetadata({
          purpose: scheduledActivation.application.purpose,
          purposeDigest:
            scheduledActivation.application.purposeDigest
        });
      const downgradeSubscriptionCore = {
        schema: ALAKAZAM_SUBSCRIPTION_PROVIDER_FACTS_SCHEMA,
        stripeSubscriptionId: "sub_alakazam_contract",
        stripeSubscriptionItemId: "si_alakazam_contract",
        stripeCustomerId: authority.stripeCustomerId,
        stripePriceId: "price_alakazam_25",
        stripeScheduleId: "sub_sched_alakazam_35_25",
        tierId: "alakazam_25",
        amountMinor: 2500,
        currency: "USD",
        providerStatus: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStartsAt:
          "2026-09-02T12:03:00.000Z",
        currentPeriodEndsAt:
          "2026-10-02T12:03:00.000Z",
        billingCycleAnchor: "2026-08-02T12:03:00.000Z",
        providerObservedAt: "2026-09-02T12:04:00.000Z",
        metadata: downgradeMetadata
      };
      const downgradeSubscription = {
        ...downgradeSubscriptionCore,
        providerFactsDigest:
          canonicalDigest(downgradeSubscriptionCore)
      };
      const downgradeActivationEvent = {
        id: "evt_alakazam_downgrade_provider",
        type: "customer.subscription.updated",
        livemode: false,
        api_version: "2026-07-29.preview",
        created:
          Date.parse("2026-09-02T12:03:00.000Z") / 1000,
        data: {
          object: {
            id: "sub_alakazam_contract",
            metadata: downgradeMetadata
          }
        }
      };
      const downgradeActivationCalls = {
        reads: 0,
        ids: 0
      };
      const downgradeActivationIds = [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID()
      ];
      const downgradeFulfillmentOperationId =
        downgradeActivationIds[2];
      const downgradeActivationService =
        createAlakazamDowngradeActivationService({
          repository: settlementRepository,
          provider: {
            async readiness() {
              return {
                ready: true,
                provider: "stripe",
                alakazam: true,
                taxMode: "disabled_by_owner",
                livemode: false
              };
            },
            async retrieveAlakazamSubscription() {
              downgradeActivationCalls.reads += 1;
              return structuredClone(
                downgradeSubscription
              );
            }
          },
          clock: {
            now() {
              return "2026-09-02T12:03:05.000Z";
            }
          },
          ids: {
            next(label) {
              downgradeActivationCalls.ids += 1;
              assert.ok(
                [
                  "alakazam_downgrade_subscription_event",
                  "alakazam_downgrade_activation_tier_event",
                  "alakazam_tier_fulfillment_operation"
                ].includes(label)
              );
              return downgradeActivationIds.shift();
            }
          },
          release: createAlakazamBillingRelease({
            approved: true,
            taxMode: "disabled_by_owner"
          })
        });
      const activatedDowngrade =
        await downgradeActivationService.ingestStripeEvent(
          downgradeActivationEvent
        );
      assert.deepEqual(activatedDowngrade, {
        status: "active",
        provider: "stripe",
        changeKind: "downgrade",
        scheduleId: downgradeScheduleId,
        projectId: authority.projectId,
        quoteId: downgradeQuoteId,
        subscriptionId,
        priorTierId: "alakazam_35",
        targetTierId: "alakazam_25",
        revision: 4,
        currentPeriodStartsAt:
          "2026-09-02T12:03:00.000Z",
        currentPeriodEndsAt:
          "2026-10-02T12:03:00.000Z",
        scheduleProviderFactsDigest:
          scheduledActivation.schedule.providerFactsDigest,
        subscriptionProviderFactsDigest:
          downgradeSubscription.providerFactsDigest,
        next: "complete"
      });
      assert.deepEqual(downgradeActivationCalls, {
        reads: 1,
        ids: 3
      });
      assert.deepEqual(
        await downgradeActivationService.ingestStripeEvent(
          downgradeActivationEvent
        ),
        activatedDowngrade
      );
      assert.deepEqual(downgradeActivationCalls, {
        reads: 1,
        ids: 4
      });
      await flushConstraints(client);

      const publishingAccount = await account.read(accountScope);
      assert.deepEqual(
        {
          state: publishingAccount.state,
          tierId:
            publishingAccount.subscription.tier.tierId,
          amountMinor:
            publishingAccount.subscription.price.amountMinor,
          pendingChange: publishingAccount.pendingChange,
          renewalTierId:
            publishingAccount.nextRenewal.tierId,
          renewalAmountMinor:
            publishingAccount.nextRenewal.amountMinor,
          renewalDueAt:
            publishingAccount.nextRenewal.dueAt,
          receiptCount: publishingAccount.receipts.length,
          siteState: publishingAccount.site.state,
          actions: publishingAccount.actions
        },
        {
          state: "active",
          tierId: "alakazam_25",
          amountMinor: 2500,
          pendingChange: null,
          renewalTierId: "alakazam_25",
          renewalAmountMinor: 2500,
          renewalDueAt:
            "2026-10-02T12:03:00.000Z",
          receiptCount: 2,
          siteState: "publishing",
          actions: {
            configureSite: false,
            start: false,
            changeTier: false,
            manageBilling: false,
            cancel: false,
            reason: "site_publishing"
          }
        }
      );
      assert.doesNotMatch(
        JSON.stringify(publishingAccount),
        /(?:cs_|cus_|in_|pi_|price_|si_|sub_)/u
      );

      assert.deepEqual(
        await upgradeService.ingestStripeEvent(
          upgradeActivationEvent
        ),
        activatedUpgrade
      );
      assert.deepEqual(upgradeProviderCalls, {
        applies: 0,
        reads: 2,
        ids: 5
      });

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

      const laterUpgradeQuoteId = await insertQuote(
        client,
        authority,
        {
          changeKind: "upgrade",
          currentSubscriptionId: subscriptionId,
          currentSubscriptionRevision: 4,
          currentTierId: "alakazam_25",
          currentAmountMinor: 2500,
          currentPeriodEndsAt:
            "2026-10-02T12:03:00.000Z",
          targetTierId: "alakazam_35",
          targetAmountMinor: 3500,
          appliedValueKind: "current_paid_tier",
          appliedValueMinor: 2500,
          dueNowSubtotalMinor: 1000,
          effectiveRule:
            "after_payment_and_provider_confirmation",
          noMidPeriodRefund: false,
          issuedAt: "2026-09-02T12:06:00.000Z",
          expiresAt: "2026-09-02T12:36:00.000Z"
        }
      );
      await expectRejected(
        client,
        () => settlementRepository.claimCheckoutDispatch({
            tenantId: authority.organizationId,
            customerId: authority.userId,
            projectId: authority.projectId,
            quoteId: laterUpgradeQuoteId,
            dispatchId: randomUUID(),
            stripeCustomerId: authority.stripeCustomerId,
            acceptedDisclosureDigest:
              disclosureDigestForQuote(laterUpgradeQuoteId),
            siteSetupDigest: null,
            claimedAt: "2026-09-02T12:07:00.000Z"
          }),
        /finish publishing before changing tiers/iu
      );
      const prematureUpgradeDispatch = await client.query(
        `select count(*)::integer as count
           from ss.alakazam_checkout_dispatches
          where organization_id = $1
            and quote_id = $2`,
        [authority.organizationId, laterUpgradeQuoteId]
      );
      assert.equal(
        prematureUpgradeDispatch.rows[0].count,
        0
      );
      await flushConstraints(client);

      workerNow = "2026-09-02T12:08:00.000Z";
      const downgradedLive = await worker.runOnce();
      assert.equal(downgradedLive.status, "live");
      assert.equal(
        downgradedLive.operationId,
        downgradeFulfillmentOperationId
      );
      assert.equal(
        downgradedLive.projectId,
        authority.projectId
      );
      assert.equal(downgradedLive.subscriptionId, subscriptionId);
      assert.equal(downgradedLive.subscriptionRevision, 4);
      assert.equal(downgradedLive.tierId, "alakazam_25");
      assert.equal(downgradedLive.hostname, acceptedSite.hostname);
      assert.equal(
        downgradedLive.sourceVersionId,
        acceptedSite.versionId
      );
      await flushConstraints(client);
      assert.equal((await worker.runOnce()).status, "idle");

      const renewedAccount = await account.read(accountScope);
      assert.deepEqual(
        {
          state: renewedAccount.state,
          tierId: renewedAccount.subscription.tier.tierId,
          amountMinor:
            renewedAccount.subscription.price.amountMinor,
          pendingChange: renewedAccount.pendingChange,
          renewalTierId: renewedAccount.nextRenewal.tierId,
          renewalAmountMinor:
            renewedAccount.nextRenewal.amountMinor,
          renewalDueAt: renewedAccount.nextRenewal.dueAt,
          receiptCount: renewedAccount.receipts.length,
          siteState: renewedAccount.site.state,
          siteUrl: renewedAccount.site.url,
          actions: renewedAccount.actions
        },
        {
          state: "active",
          tierId: "alakazam_25",
          amountMinor: 2500,
          pendingChange: null,
          renewalTierId: "alakazam_25",
          renewalAmountMinor: 2500,
          renewalDueAt: "2026-10-02T12:03:00.000Z",
          receiptCount: 2,
          siteState: "live",
          siteUrl: `https://${acceptedSite.hostname}/`,
          actions: {
            configureSite: false,
            start: false,
            changeTier: true,
            manageBilling: false,
            cancel: false,
            reason: "only_tier_change_composed"
          }
        }
      );
      assert.doesNotMatch(
        JSON.stringify(renewedAccount),
        /(?:cs_|cus_|in_|pi_|price_|si_|sub_)/u
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
      await client.query("commit");

      const concurrentRepository =
        createPostgresAlakazamPublicationRepository({
          authority: {
            async service(context, work) {
              assert.equal(context.userId, authority.userId);
              assert.equal(
                context.organizationId,
                authority.organizationId
              );
              if (context.readOnly !== true) {
                assert.equal(
                  context.isolation,
                  "read-committed"
                );
              }
              const isolated = await pool.connect();
              try {
                await isolated.query(
                  "begin isolation level read committed"
                );
                await isolated.query(
                  "set constraints all deferred"
                );
                const result = await work(isolated);
                await isolated.query(
                  "set constraints all immediate"
                );
                await isolated.query("commit");
                return result;
              } catch (error) {
                await isolated.query("rollback").catch(() => {});
                throw error;
              } finally {
                isolated.release();
              }
            }
          }
        });
      const concurrentPublication =
        createAlakazamPublicationService({
          repository: concurrentRepository,
          clock: {
            now() {
              return new Date(
                "2026-09-02T12:09:00.000Z"
              );
            }
          }
        });
      const concurrentSnapshot =
        await concurrentPublication.read(publicationScope);
      const concurrentCommandId = randomUUID();
      const concurrentRequest = {
        commandId: concurrentCommandId,
        action: "rollback",
        snapshotDigest: concurrentSnapshot.snapshotDigest,
        targetReleaseId:
          concurrentSnapshot.actions.rollbackTargetReleaseId
      };
      const concurrentResults = await Promise.all([
        concurrentPublication.request(
          publicationScope,
          concurrentRequest
        ),
        concurrentPublication.request(
          publicationScope,
          concurrentRequest
        )
      ]);
      assert.equal(
        concurrentResults[0].command.commandDigest,
        concurrentResults[1].command.commandDigest
      );
      const concurrentRows = await client.query(
        `select count(*)::integer as count
           from ss.alakazam_customer_publication_commands
          where organization_id = $1
            and id = $2`,
        [authority.organizationId, concurrentCommandId]
      );
      assert.equal(concurrentRows.rows[0].count, 1);
    } finally {
      await client.query("rollback").catch(() => {});
      client.release();
      await pool.end();
      if (runtimeRoot !== null) {
        await makeDirectoriesOwnerWritable(runtimeRoot);
        await rm(runtimeRoot, { recursive: true, force: true });
      }
    }
  }
);
