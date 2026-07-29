import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DataPlaneError,
  SiteSourceryD1Repository,
  sha256Hex,
} from "../src/repository.mjs";
import { D1SqliteAdapter } from "./d1-sqlite-adapter.mjs";

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIRECTORY, "..");
const MIGRATIONS = readdirSync(path.join(ROOT, "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(path.join(ROOT, "migrations", name), "utf8"));
const SCHEMA_INVARIANTS = readFileSync(
  path.join(DIRECTORY, "schema-invariants.sql"),
  "utf8",
);
const POSTGRES_DOMAIN_MIGRATION = readFileSync(
  path.resolve(
    ROOT,
    "..",
    "supabase",
    "migrations",
    "202607280006_domain_procurement.sql",
  ),
  "utf8",
);
const NOW = "2026-07-28T12:00:00.000Z";
const POLICY_ID = "00000000-0000-4000-8000-000000000014";

function id(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const IDS = Object.freeze({
  user1: id(1),
  user2: id(2),
  org1: id(11),
  org2: id(12),
  project1: id(21),
  project2: id(22),
  plan: id(31),
  variant: id(32),
  entitlement: id(33),
  price: id(34),
  customerReceipt: id(40),
  subscriptionReceipt: id(41),
  customer: id(42),
  subscription: id(43),
});

const DOMAIN_IDS = Object.freeze({
  agentDocument: id(100),
  renewalDocument: id(101),
  agentAcceptance: id(102),
  quoteReceipt: id(103),
  quote: id(104),
  registrantSnapshot: id(105),
  agentConsent: id(106),
  stripePaymentReceipt: id(107),
  paymentAllocation: id(108),
});

function setup() {
  const db = new D1SqliteAdapter();
  for (const migration of MIGRATIONS) db.exec(migration);
  const repository = new SiteSourceryD1Repository(db, {
    clock: () => new Date(NOW),
  });
  return { db, repository };
}

function run(db, sql, ...bindings) {
  return db.raw.prepare(sql).run(...bindings);
}

function get(db, sql, ...bindings) {
  return db.raw.prepare(sql).get(...bindings);
}

function seedTenants(db) {
  run(
    db,
    `INSERT INTO users (id, state, display_name, created_at, updated_at)
     VALUES (?, 'active', 'Owner One', ?, ?),
            (?, 'active', 'Owner Two', ?, ?)`,
    IDS.user1,
    NOW,
    NOW,
    IDS.user2,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO organizations (
       id, created_by_user_id, name, state, created_at, updated_at
     ) VALUES
       (?, ?, 'Organization One', 'active', ?, ?),
       (?, ?, 'Organization Two', 'active', ?, ?)`,
    IDS.org1,
    IDS.user1,
    NOW,
    NOW,
    IDS.org2,
    IDS.user2,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO organization_memberships (
       organization_id, user_id, role, state, accepted_at, created_at, updated_at
     ) VALUES
       (?, ?, 'owner', 'active', ?, ?, ?),
       (?, ?, 'owner', 'active', ?, ?, ?)`,
    IDS.org1,
    IDS.user1,
    NOW,
    NOW,
    NOW,
    IDS.org2,
    IDS.user2,
    NOW,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO projects (
       id, organization_id, created_by_user_id, billing_policy_id,
       name, lifecycle, revision, created_at, updated_at
     ) VALUES
       (?, ?, ?, ?, 'Project One', 'active', 1, ?, ?),
       (?, ?, ?, ?, 'Project Two', 'active', 1, ?, ?)`,
    IDS.project1,
    IDS.org1,
    IDS.user1,
    POLICY_ID,
    NOW,
    NOW,
    IDS.project2,
    IDS.org2,
    IDS.user2,
    POLICY_ID,
    NOW,
    NOW,
  );
  for (const [orgId, projectId] of [
    [IDS.org1, IDS.project1],
    [IDS.org2, IDS.project2],
  ]) {
    run(
      db,
      `INSERT INTO project_safety_projection (
         organization_id, project_id, state, updated_at
       ) VALUES (?, ?, 'clear', ?)`,
      orgId,
      projectId,
      NOW,
    );
    run(
      db,
      `INSERT INTO project_access_projection (
         organization_id, project_id, visibility, updated_at
       ) VALUES (?, ?, 'public', ?)`,
      orgId,
      projectId,
      NOW,
    );
    run(
      db,
      `INSERT INTO project_address_projection (
         organization_id, project_id, current_address_id, updated_at
       ) VALUES (?, ?, NULL, ?)`,
      orgId,
      projectId,
      NOW,
    );
    run(
      db,
      `INSERT INTO project_serving_projection (
         organization_id, project_id, state, resume_state, updated_at
       ) VALUES (?, ?, 'unpublished', 'unpublished', ?)`,
      orgId,
      projectId,
      NOW,
    );
  }
}

function seedCatalogAndSubscription(db) {
  run(
    db,
    `INSERT INTO catalog_plans (
       id, plan_key, catalog_version, display_name, active_from, created_at
     ) VALUES (?, 'hosted-site', 'test-only-v1', 'Hosted site fixture', ?, ?)`,
    IDS.plan,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO catalog_variants (
       id, plan_id, variant_key, display_name, configuration_json,
       active_from, created_at
     ) VALUES (?, ?, 'fixture', 'Fixture variant', '{}', ?, ?)`,
    IDS.variant,
    IDS.plan,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO catalog_entitlements (
       id, variant_id, entitlement_key, value_json, created_at
     ) VALUES (?, ?, 'hosted_project_count', '1', ?)`,
    IDS.entitlement,
    IDS.variant,
    NOW,
  );
  run(
    db,
    `INSERT INTO catalog_prices (
       id, variant_id, currency, unit_amount_minor, cadence,
       approved_at, active_from, created_at
     ) VALUES (?, ?, 'USD', 12345, 'month', ?, ?, ?)`,
    IDS.price,
    IDS.variant,
    NOW,
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO provider_receipts (
       id, organization_id, project_id, provider_code, receipt_kind,
       external_object_ref, source_event_ref, facts_json, facts_digest,
       occurred_at, recorded_at
     ) VALUES (?, ?, NULL, 'stripe', 'customer_verified',
               'cus_fixture', 'evt_customer', '{}', ?, ?, ?)`,
    IDS.customerReceipt,
    IDS.org1,
    "a".repeat(64),
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO stripe_customers (
       id, organization_id, stripe_customer_id, created_from_receipt_id, created_at
     ) VALUES (?, ?, 'cus_fixture', ?, ?)`,
    IDS.customer,
    IDS.org1,
    IDS.customerReceipt,
    NOW,
  );
  run(
    db,
    `INSERT INTO provider_receipts (
       id, organization_id, project_id, provider_code, receipt_kind,
       external_object_ref, source_event_ref, facts_json, facts_digest,
       occurred_at, recorded_at
     ) VALUES (?, ?, ?, 'stripe', 'subscription_created',
               'sub_fixture', 'evt_subscription', '{}', ?, ?, ?)`,
    IDS.subscriptionReceipt,
    IDS.org1,
    IDS.project1,
    "b".repeat(64),
    NOW,
    NOW,
  );
  run(
    db,
    `INSERT INTO stripe_subscriptions (
       id, organization_id, project_id, stripe_customer_row_id,
       stripe_subscription_id, stripe_price_id, catalog_price_id,
       billing_policy_id, current_receipt_id, status, currency,
       amount_minor, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'sub_fixture', 'price_fixture', ?, ?, ?,
               'active', 'USD', 12345, ?, ?)`,
    IDS.subscription,
    IDS.org1,
    IDS.project1,
    IDS.customer,
    IDS.price,
    POLICY_ID,
    IDS.subscriptionReceipt,
    NOW,
    NOW,
  );
}

function seedDomainRegistrationEvidence(db) {
  const quotedAt = "2026-07-28T11:55:00.000Z";
  const expiresAt = "2026-07-28T13:00:00.000Z";
  const renewalDisclosure =
    "Renewal is optional and will use a newly disclosed price before charge.";
  const renewalDisclosureDigest = "d".repeat(64);
  const quoteDigest = "e".repeat(64);
  const quoteFacts = {
    domainName: "fixture-domain.example",
    currency: "USD",
    customerPriceMinor: 1200,
    registrarCostMinor: 800,
    renewalPriceMinor: 1400,
    termYears: 1,
    renewalDisclosureDigest,
    quoteDigest,
    expiresAt,
  };
  run(
    db,
    `INSERT INTO legal_documents (
       id, kind, version, content_digest, content_uri,
       effective_at, created_at
     ) VALUES
       (?, 'domain_agent', 'domain-agent/test-v1', ?, 'legal://domain-agent/test-v1',
        '2026-07-28T00:00:00.000Z', ?),
       (?, 'domain_renewal', 'domain-renewal/test-v1', ?,
        'legal://domain-renewal/test-v1', '2026-07-28T00:00:00.000Z', ?)`,
    DOMAIN_IDS.agentDocument,
    "a".repeat(64),
    NOW,
    DOMAIN_IDS.renewalDocument,
    "b".repeat(64),
    NOW,
  );
  run(
    db,
    `INSERT INTO term_acceptances (
       id, organization_id, project_id, user_id, document_id,
       accepted_at, request_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    DOMAIN_IDS.agentAcceptance,
    IDS.org1,
    IDS.project1,
    IDS.user1,
    DOMAIN_IDS.agentDocument,
    NOW,
    id(109),
    NOW,
  );
  run(
    db,
    `INSERT INTO provider_receipts (
       id, organization_id, project_id, provider_code, receipt_kind,
       external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
     ) VALUES (?, ?, ?, 'registrar-fixture', 'domain_quote',
               'quote-fixture-registration-1', ?, ?, ?, ?)`,
    DOMAIN_IDS.quoteReceipt,
    IDS.org1,
    IDS.project1,
    JSON.stringify(quoteFacts),
    "c".repeat(64),
    quotedAt,
    quotedAt,
  );
  run(
    db,
    `INSERT INTO domain_quotes (
       id, organization_id, project_id, provider_code, provider_quote_ref,
       quote_kind, domain_name, currency, customer_price_minor,
       registrar_cost_minor, renewal_price_minor, term_years,
       renewal_disclosure, renewal_disclosure_digest, quote_digest,
       provider_receipt_id, quoted_at, expires_at, status, created_at
     ) VALUES (?, ?, ?, 'registrar-fixture', 'quote-fixture-registration-1',
               'registration', 'fixture-domain.example', 'USD', 1200,
               800, 1400, 1, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    DOMAIN_IDS.quote,
    IDS.org1,
    IDS.project1,
    renewalDisclosure,
    renewalDisclosureDigest,
    quoteDigest,
    DOMAIN_IDS.quoteReceipt,
    quotedAt,
    expiresAt,
    quotedAt,
  );
  run(
    db,
    `INSERT INTO domain_registrant_snapshots (
       id, organization_id, project_id, user_id, schema_version,
       encryption_algorithm, encryption_key_version, contact_ciphertext,
       contact_digest, country_code, customer_is_registrant, captured_at
     ) VALUES (?, ?, ?, ?, 'registrant/v1', 'AES-256-GCM', 'test-key-v1',
               ?, ?, 'US', 1, ?)`,
    DOMAIN_IDS.registrantSnapshot,
    IDS.org1,
    IDS.project1,
    IDS.user1,
    new Uint8Array([1, 7, 3, 9, 4]),
    "f".repeat(64),
    NOW,
  );
  run(
    db,
    `INSERT INTO domain_agent_consents (
       id, organization_id, project_id, user_id, quote_id,
       registrant_snapshot_id, legal_document_id, term_acceptance_id,
       agent_role, customer_remains_registrant,
       authorization_statement_digest, irreversible_disclosure_digest,
       request_id, consented_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,
               'authorized_registration_agent', 1, ?, ?, ?, ?)`,
    DOMAIN_IDS.agentConsent,
    IDS.org1,
    IDS.project1,
    IDS.user1,
    DOMAIN_IDS.quote,
    DOMAIN_IDS.registrantSnapshot,
    DOMAIN_IDS.agentDocument,
    DOMAIN_IDS.agentAcceptance,
    "1".repeat(64),
    "2".repeat(64),
    id(110),
    NOW,
  );
  run(
    db,
    `INSERT INTO provider_receipts (
       id, organization_id, project_id, provider_code, receipt_kind,
       external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
     ) VALUES (?, ?, ?, 'stripe', 'domain_payment_captured',
               'pi_fixture_domain_registration', ?, ?, ?, ?)`,
    DOMAIN_IDS.stripePaymentReceipt,
    IDS.org1,
    IDS.project1,
    JSON.stringify({
      quoteId: DOMAIN_IDS.quote,
      currency: "USD",
      amountMinor: 1200,
    }),
    "3".repeat(64),
    NOW,
    NOW,
  );
  assert.throws(
    () =>
      run(
        db,
        `INSERT INTO domain_payment_allocations (
           id, organization_id, project_id, quote_id, stripe_provider_receipt_id,
           stripe_payment_reference, currency, amount_minor, state, recorded_at
         ) VALUES (?, ?, ?, ?, ?, 'pi_blocked_while_disabled',
                   'USD', 1200, 'captured', ?)`,
        id(198),
        IDS.org1,
        IDS.project1,
        DOMAIN_IDS.quote,
        DOMAIN_IDS.stripePaymentReceipt,
        NOW,
      ),
    /separate exact Stripe evidence/u,
  );
  run(
    db,
    `UPDATE domain_procurement_control
        SET purchasing_enabled = 1,
            active_provider_code = 'registrar-fixture',
            agent_legal_document_id = ?,
            renewal_legal_document_id = ?,
            enabled_at = ?,
            enabled_by_user_id = ?,
            updated_at = ?
      WHERE singleton = 1`,
    DOMAIN_IDS.agentDocument,
    DOMAIN_IDS.renewalDocument,
    NOW,
    IDS.user1,
    NOW,
  );
  run(
    db,
    `INSERT INTO domain_payment_allocations (
       id, organization_id, project_id, quote_id, stripe_provider_receipt_id,
       stripe_payment_reference, currency, amount_minor, state, recorded_at
     ) VALUES (?, ?, ?, ?, ?, 'pi_fixture_domain_registration',
               'USD', 1200, 'captured', ?)`,
    DOMAIN_IDS.paymentAllocation,
    IDS.org1,
    IDS.project1,
    DOMAIN_IDS.quote,
    DOMAIN_IDS.stripePaymentReceipt,
    NOW,
  );
  return {
    quotedAt,
    expiresAt,
    renewalDisclosureDigest,
    quoteDigest,
  };
}

async function createVersion(repository) {
  return repository.saveCompiledVersion({
    organizationId: IDS.org1,
    projectId: IDS.project1,
    userId: IDS.user1,
    normalizedFacts: {
      schema: "abracadabra.spark/v1",
      theme: "clear",
      businessName: "Fixture Studio",
      summary: "A complete deterministic website fixture.",
      about: "A supplied factual paragraph.",
      location: "",
      hours: "",
      phone: null,
      email: { display: "owner@example.com", href: "mailto:owner@example.com" },
      website: null,
      primaryAction: "email",
    },
    contentFacts: {
      schema: "abracadabra.spark/v1",
      businessName: "Fixture Studio",
      summary: "A complete deterministic website fixture.",
      about: "A supplied factual paragraph.",
      offerings: ["Inspection"],
      location: "",
      hours: "",
      phone: null,
      email: { display: "owner@example.com", href: "mailto:owner@example.com" },
      website: null,
      primaryAction: "email",
    },
    offerings: ["Inspection"],
    rawFacts: { businessName: "Fixture Studio" },
    html:
      "<!doctype html><html><head><title>Fixture Studio</title></head>" +
      "<body><main><h1>Fixture Studio</h1><p>A complete artifact.</p></main></body></html>",
    compilerSchema: "abracadabra.spark/v1",
    compilerRevision: "test-fixture",
  });
}

test("all D1 migrations and static launch invariants execute", () => {
  const { db } = setup();
  try {
    db.exec(SCHEMA_INVARIANTS);
    assert.equal(
      get(db, "SELECT count(*) AS count FROM invariant_results").count,
      12,
    );
    assert.equal(get(db, "SELECT count(*) AS count FROM catalog_prices").count, 0);
    assert.equal(
      get(db, "SELECT checkout_enabled FROM commerce_control WHERE singleton = 1")
        .checkout_enabled,
      0,
    );
    assert.deepEqual(db.raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("PostgreSQL portability migration carries the full provider-neutral domain contract", () => {
  const requiredTables = [
    "domain_procurement_control",
    "domain_quotes",
    "domain_registrant_snapshots",
    "domain_agent_consents",
    "domain_payment_allocations",
    "domain_registration_intents",
    "domain_irreversible_confirmations",
    "domain_provider_operations",
    "domain_provider_operation_events",
    "domain_registrar_debits",
    "domain_registrations",
    "domain_dns_change_sets",
    "domain_dns_records",
    "domain_renewal_intents",
    "domain_transfer_out_requests",
    "domain_transfer_exports",
    "domain_manual_reviews",
  ];
  for (const table of requiredTables) {
    assert.match(
      POSTGRES_DOMAIN_MIGRATION,
      new RegExp(`create table ss\\.${table} \\(`, "u"),
      `${table} is missing from PostgreSQL migration`,
    );
  }
  for (const barrier of [
    "domain_irreversible_confirmation_barrier",
    "domain_provider_operation_subject_barrier",
    "domain_registration_exact_provider_result",
    "domain_registrar_debit_not_stripe",
    "domain_transfer_export_ready",
  ]) {
    assert.match(POSTGRES_DOMAIN_MIGRATION, new RegExp(barrier, "u"));
  }
  assert.match(
    POSTGRES_DOMAIN_MIGRATION,
    /alter table ss\.%I enable row level security/u,
  );
  assert.match(
    POSTGRES_DOMAIN_MIGRATION,
    /alter table ss\.%I force row level security/u,
  );
  assert.doesNotMatch(
    POSTGRES_DOMAIN_MIGRATION,
    /\b(spaceship|cloudflare|namecheap|godaddy)\b/iu,
  );
  assert.doesNotMatch(
    POSTGRES_DOMAIN_MIGRATION,
    /insert into ss\.(domain_quotes|domain_registration_intents|domain_provider_operations|domain_registrations)\b/iu,
  );
});

test("tenant predicates and optimistic draft revisions fail closed", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    await assert.rejects(
      repository.getProject(IDS.org1, IDS.project2),
      (error) => error instanceof DataPlaneError && error.code === "PROJECT_NOT_FOUND",
    );
    assert.deepEqual(
      await repository.saveDraft({
        organizationId: IDS.org1,
        projectId: IDS.project1,
        userId: IDS.user1,
        expectedRevision: 0,
        rawFacts: { businessName: "One" },
      }),
      {
        organizationId: IDS.org1,
        projectId: IDS.project1,
        revision: 1,
        updatedAt: NOW,
      },
    );
    await assert.rejects(
      repository.saveDraft({
        organizationId: IDS.org1,
        projectId: IDS.project1,
        userId: IDS.user1,
        expectedRevision: 0,
        rawFacts: { businessName: "Stale" },
      }),
      (error) => error instanceof DataPlaneError && error.code === "REVISION_CONFLICT",
    );
    await assert.rejects(
      repository.saveDraft({
        organizationId: IDS.org2,
        projectId: IDS.project1,
        userId: IDS.user2,
        expectedRevision: 1,
        rawFacts: { businessName: "Cross tenant" },
      }),
      (error) => error instanceof DataPlaneError && error.code === "REVISION_CONFLICT",
    );
    assert.equal(
      JSON.parse(
        get(
          db,
          `SELECT raw_facts_json
             FROM project_drafts
            WHERE organization_id = ? AND project_id = ?`,
          IDS.org1,
          IDS.project1,
        ).raw_facts_json,
      ).businessName,
      "One",
    );
  } finally {
    db.close();
  }
});

test("idempotency rejects body drift and replays exact requests", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    const first = await repository.reserveIdempotency({
      organizationId: IDS.org1,
      principalId: IDS.user1,
      routeKey: "POST:/projects",
      idempotencyKey: "fixture-key-0001",
      requestBody: { name: "One" },
    });
    assert.equal(first.replay, false);
    const replay = await repository.reserveIdempotency({
      organizationId: IDS.org1,
      principalId: IDS.user1,
      routeKey: "POST:/projects",
      idempotencyKey: "fixture-key-0001",
      requestBody: { name: "One" },
    });
    assert.equal(replay.replay, true);
    await assert.rejects(
      repository.reserveIdempotency({
        organizationId: IDS.org1,
        principalId: IDS.user1,
        routeKey: "POST:/projects",
        idempotencyKey: "fixture-key-0001",
        requestBody: { name: "Changed" },
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "IDEMPOTENCY_MISMATCH",
    );
  } finally {
    db.close();
  }
});

test("domain purchase is evidence-bound before any registrar operation", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    const evidence = seedDomainRegistrationEvidence(db);
    const request = {
      organizationId: IDS.org1,
      projectId: IDS.project1,
      userId: IDS.user1,
      quoteId: DOMAIN_IDS.quote,
      registrantSnapshotId: DOMAIN_IDS.registrantSnapshot,
      agentConsentId: DOMAIN_IDS.agentConsent,
      paymentAllocationId: DOMAIN_IDS.paymentAllocation,
      idempotencyKey: "domain-register-fixture-001",
    };
    const intent = await repository.createDomainRegistrationIntent(request);
    assert.equal(intent.replay, false);
    assert.equal(intent.state, "awaiting_confirmation");
    assert.equal(
      get(
        db,
        `SELECT customer_is_registrant
           FROM domain_registrant_snapshots
          WHERE id = ?`,
        DOMAIN_IDS.registrantSnapshot,
      ).customer_is_registrant,
      1,
    );
    const intentReplay = await repository.createDomainRegistrationIntent(request);
    assert.equal(intentReplay.replay, true);
    assert.equal(intentReplay.registrationIntentId, intent.registrationIntentId);
    await assert.rejects(
      repository.createDomainRegistrationIntent({
        ...request,
        paymentAllocationId: id(999),
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "IDEMPOTENCY_MISMATCH",
    );
    await assert.rejects(
      repository.createDomainRegistrationIntent({
        ...request,
        organizationId: IDS.org2,
        projectId: IDS.project2,
        userId: IDS.user2,
        idempotencyKey: "domain-register-cross-tenant",
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "DOMAIN_QUOTE_NOT_FOUND",
    );

    assert.throws(
      () =>
        run(
          db,
          `INSERT INTO domain_provider_operations (
             id, organization_id, project_id, subject_kind, subject_id,
             operation_kind, provider_code, idempotency_key, request_digest,
             state, requested_at, updated_at
           ) VALUES (?, ?, ?, 'registration', ?, 'register',
                     'registrar-fixture', 'before-confirmation', ?,
                     'queued', ?, ?)`,
          id(111),
          IDS.org1,
          IDS.project1,
          intent.registrationIntentId,
          "4".repeat(64),
          NOW,
          NOW,
        ),
      /irreversible confirmation/u,
    );

    run(
      db,
      `UPDATE domain_procurement_control
          SET purchasing_enabled = 0, updated_at = ?
        WHERE singleton = 1`,
      NOW,
    );
    await assert.rejects(
      repository.confirmDomainRegistration({
        organizationId: IDS.org1,
        projectId: IDS.project1,
        userId: IDS.user1,
        registrationIntentId: intent.registrationIntentId,
        confirmationStatementVersion: "domain-register/test-v1",
        confirmationEvidence: { checked: true, action: "buy-domain-now" },
      }),
      (error) =>
        error instanceof DataPlaneError
        && error.code === "IRREVERSIBLE_CONFIRMATION_REJECTED",
    );
    run(
      db,
      `UPDATE domain_procurement_control
          SET purchasing_enabled = 1, updated_at = ?
        WHERE singleton = 1`,
      NOW,
    );

    const expiredRepository = new SiteSourceryD1Repository(db, {
      clock: () => new Date("2026-07-28T14:00:00.000Z"),
    });
    await assert.rejects(
      expiredRepository.confirmDomainRegistration({
        organizationId: IDS.org1,
        projectId: IDS.project1,
        userId: IDS.user1,
        registrationIntentId: intent.registrationIntentId,
        confirmationStatementVersion: "domain-register/test-v1",
        confirmationEvidence: { checked: true, action: "buy-domain-now" },
      }),
      (error) =>
        error instanceof DataPlaneError
        && error.code === "IRREVERSIBLE_CONFIRMATION_REJECTED",
    );
    assert.equal(
      get(
        db,
        `SELECT count(*) AS count
           FROM domain_irreversible_confirmations
          WHERE registration_intent_id = ?`,
        intent.registrationIntentId,
      ).count,
      0,
    );

    const confirmationRequest = {
      organizationId: IDS.org1,
      projectId: IDS.project1,
      userId: IDS.user1,
      registrationIntentId: intent.registrationIntentId,
      confirmationStatementVersion: "domain-register/test-v1",
      confirmationEvidence: {
        checked: true,
        action: "buy-domain-now",
        customerRemainsRegistrant: true,
      },
    };
    const confirmation =
      await repository.confirmDomainRegistration(confirmationRequest);
    assert.equal(confirmation.replay, false);
    assert.equal(confirmation.state, "confirmed");
    assert.equal(
      get(
        db,
        `SELECT quote_digest
           FROM domain_irreversible_confirmations
          WHERE id = ?`,
        confirmation.confirmationId,
      ).quote_digest,
      evidence.quoteDigest,
    );
    assert.equal(
      (await repository.confirmDomainRegistration(confirmationRequest)).replay,
      true,
    );
    assert.throws(
      () =>
        run(
          db,
          `UPDATE domain_registration_intents
              SET quote_id = quote_id
            WHERE id = ?`,
          intent.registrationIntentId,
        ),
      /confirmed registration evidence is immutable/u,
    );

    const providerRequest = {
      registrationIntentId: intent.registrationIntentId,
      contactEnvelope: "resolved-at-worker-runtime",
    };
    const operation = await repository.enqueueConfirmedDomainRegistration({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      registrationIntentId: intent.registrationIntentId,
      idempotencyKey: "registrar-operation-fixture-001",
      providerRequest,
    });
    assert.equal(operation.replay, false);
    assert.equal(operation.state, "queued");
    assert.equal(
      get(
        db,
        `SELECT state
           FROM domain_registration_intents
          WHERE id = ?`,
        intent.registrationIntentId,
      ).state,
      "submitted",
    );
    assert.equal(
      (
        await repository.enqueueConfirmedDomainRegistration({
          organizationId: IDS.org1,
          projectId: IDS.project1,
          registrationIntentId: intent.registrationIntentId,
          idempotencyKey: "registrar-operation-fixture-001",
          providerRequest,
        })
      ).replay,
      true,
    );
    await assert.rejects(
      repository.enqueueConfirmedDomainRegistration({
        organizationId: IDS.org1,
        projectId: IDS.project1,
        registrationIntentId: intent.registrationIntentId,
        idempotencyKey: "registrar-operation-fixture-001",
        providerRequest: { changed: true },
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "IDEMPOTENCY_MISMATCH",
    );

    const providerResultReceipt = id(112);
    const registeredAt = NOW;
    const registrationExpiresAt = "2027-07-28T12:00:00.000Z";
    const providerDomainRef = "provider-domain-fixture-001";
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'registrar-fixture', 'domain_operation_result',
                 'operation-result-fixture-001', ?, ?, ?, ?)`,
      providerResultReceipt,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        operationId: operation.operationId,
        state: "succeeded",
        domainName: "fixture-domain.example",
        providerDomainRef,
        registeredAt,
        expiresAt: registrationExpiresAt,
      }),
      "5".repeat(64),
      NOW,
      NOW,
    );
    const registration = await repository.recordDomainRegistrationSuccess({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      operationId: operation.operationId,
      providerReceiptId: providerResultReceipt,
      providerDomainRef,
      registeredAt,
      expiresAt: registrationExpiresAt,
    });
    assert.equal(registration.replay, false);
    assert.equal(registration.state, "active");
    const registrationOwnership = get(
      db,
      `SELECT customer_is_registrant, site_sourcery_role
         FROM domain_registrations
        WHERE id = ?`,
      registration.registrationId,
    );
    assert.equal(registrationOwnership.customer_is_registrant, 1);
    assert.equal(registrationOwnership.site_sourcery_role, "authorized_agent");
    assert.equal(
      (
        await repository.recordDomainRegistrationSuccess({
          organizationId: IDS.org1,
          projectId: IDS.project1,
          operationId: operation.operationId,
          providerReceiptId: providerResultReceipt,
          providerDomainRef,
          registeredAt,
          expiresAt: registrationExpiresAt,
        })
      ).replay,
      true,
    );

    const registrarDebitReceipt = id(113);
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'registrar-fixture', 'registrar_debit',
                 'registrar-debit-fixture-001', ?, ?, ?, ?)`,
      registrarDebitReceipt,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        operationId: operation.operationId,
        currency: "USD",
        amountMinor: 800,
      }),
      "6".repeat(64),
      NOW,
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_registrar_debits (
         id, organization_id, project_id, operation_id,
         registrar_provider_receipt_id, registrar_debit_reference,
         currency, amount_minor, debited_at
       ) VALUES (?, ?, ?, ?, ?, 'registrar-debit-fixture-001',
                 'USD', 800, ?)`,
      id(114),
      IDS.org1,
      IDS.project1,
      operation.operationId,
      registrarDebitReceipt,
      NOW,
    );
    assert.throws(
      () =>
        run(
          db,
          `INSERT INTO domain_registrar_debits (
             id, organization_id, project_id, operation_id,
             registrar_provider_receipt_id, registrar_debit_reference,
             currency, amount_minor, debited_at
           ) VALUES (?, ?, ?, ?, ?, 'stripe-is-not-registrar',
                     'USD', 1200, ?)`,
          id(115),
          IDS.org1,
          IDS.project1,
          operation.operationId,
          DOMAIN_IDS.stripePaymentReceipt,
          NOW,
        ),
      /separate non-Stripe evidence/u,
    );

    const dnsChangeSetId = id(116);
    run(
      db,
      `INSERT INTO domain_dns_change_sets (
         id, organization_id, project_id, registration_id,
         requested_by_user_id, state, idempotency_key, request_digest,
         requested_at
       ) VALUES (?, ?, ?, ?, ?, 'queued', 'dns-change-fixture-001', ?, ?)`,
      dnsChangeSetId,
      IDS.org1,
      IDS.project1,
      registration.registrationId,
      IDS.user1,
      "7".repeat(64),
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_dns_records (
         id, organization_id, project_id, change_set_id, record_type,
         name, value, ttl_seconds, state
       ) VALUES (?, ?, ?, ?, 'A', '@', '192.0.2.10', 300, 'desired')`,
      id(117),
      IDS.org1,
      IDS.project1,
      dnsChangeSetId,
    );
    assert.throws(
      () =>
        run(
          db,
          `INSERT INTO domain_provider_operations (
             id, organization_id, project_id, subject_kind, subject_id,
             operation_kind, provider_code, idempotency_key, request_digest,
             state, requested_at, updated_at
           ) VALUES (?, ?, ?, 'dns', ?, 'configure_dns',
                     'registrar-fixture', 'dns-operation-bad-subject', ?,
                     'queued', ?, ?)`,
          id(118),
          IDS.org1,
          IDS.project1,
          id(999),
          "8".repeat(64),
          NOW,
          NOW,
        ),
      /subject is outside project scope/u,
    );

    const renewalAcceptanceId = id(119);
    run(
      db,
      `INSERT INTO term_acceptances (
         id, organization_id, project_id, user_id, document_id,
         accepted_at, request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      renewalAcceptanceId,
      IDS.org1,
      IDS.project1,
      IDS.user1,
      DOMAIN_IDS.renewalDocument,
      NOW,
      id(120),
      NOW,
    );
    const renewalQuoteReceipt = id(121);
    const renewalQuoteId = id(122);
    const renewalQuoteDigest = "9".repeat(64);
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'registrar-fixture', 'domain_quote',
                 'quote-fixture-renewal-1', ?, ?, ?, ?)`,
      renewalQuoteReceipt,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        domainName: "fixture-domain.example",
        currency: "USD",
        customerPriceMinor: 1400,
        registrarCostMinor: 900,
        renewalPriceMinor: 1500,
        termYears: 1,
        renewalDisclosureDigest: evidence.renewalDisclosureDigest,
        quoteDigest: renewalQuoteDigest,
        expiresAt: evidence.expiresAt,
      }),
      "a".repeat(64),
      NOW,
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_quotes (
         id, organization_id, project_id, provider_code, provider_quote_ref,
         quote_kind, domain_name, currency, customer_price_minor,
         registrar_cost_minor, renewal_price_minor, term_years,
         renewal_disclosure, renewal_disclosure_digest, quote_digest,
         provider_receipt_id, quoted_at, expires_at, status, created_at
       ) VALUES (?, ?, ?, 'registrar-fixture', 'quote-fixture-renewal-1',
                 'renewal', 'fixture-domain.example', 'USD', 1400,
                 900, 1500, 1,
                 'Renewal is optional and requires this current disclosed price.',
                 ?, ?, ?, ?, ?, 'open', ?)`,
      renewalQuoteId,
      IDS.org1,
      IDS.project1,
      evidence.renewalDisclosureDigest,
      renewalQuoteDigest,
      renewalQuoteReceipt,
      NOW,
      evidence.expiresAt,
      NOW,
    );
    const renewalPaymentReceipt = id(123);
    const renewalPaymentAllocation = id(124);
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'stripe', 'domain_payment_captured',
                 'pi_fixture_domain_renewal', ?, ?, ?, ?)`,
      renewalPaymentReceipt,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        quoteId: renewalQuoteId,
        currency: "USD",
        amountMinor: 1400,
      }),
      "b".repeat(64),
      NOW,
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_payment_allocations (
         id, organization_id, project_id, quote_id, stripe_provider_receipt_id,
         stripe_payment_reference, currency, amount_minor, state, recorded_at
       ) VALUES (?, ?, ?, ?, ?, 'pi_fixture_domain_renewal',
                 'USD', 1400, 'captured', ?)`,
      renewalPaymentAllocation,
      IDS.org1,
      IDS.project1,
      renewalQuoteId,
      renewalPaymentReceipt,
      NOW,
    );
    const renewalIntentId = id(125);
    assert.throws(
      () =>
        run(
          db,
          `INSERT INTO domain_renewal_intents (
             id, organization_id, project_id, registration_id, quote_id,
             payment_allocation_id, requested_by_user_id, legal_document_id,
             term_acceptance_id, renewal_disclosure_digest, acknowledged_at,
             state, idempotency_key, request_digest, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     'queued', 'renew-domain-fixture-001', ?, ?)`,
          renewalIntentId,
          IDS.org1,
          IDS.project1,
          registration.registrationId,
          renewalQuoteId,
          renewalPaymentAllocation,
          IDS.user1,
          DOMAIN_IDS.renewalDocument,
          renewalAcceptanceId,
          "0".repeat(64),
          NOW,
          "c".repeat(64),
          NOW,
        ),
      /renewal must match/u,
    );
    run(
      db,
      `INSERT INTO domain_renewal_intents (
         id, organization_id, project_id, registration_id, quote_id,
         payment_allocation_id, requested_by_user_id, legal_document_id,
         term_acceptance_id, renewal_disclosure_digest, acknowledged_at,
         state, idempotency_key, request_digest, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 'queued', 'renew-domain-fixture-001', ?, ?)`,
      renewalIntentId,
      IDS.org1,
      IDS.project1,
      registration.registrationId,
      renewalQuoteId,
      renewalPaymentAllocation,
      IDS.user1,
      DOMAIN_IDS.renewalDocument,
      renewalAcceptanceId,
      evidence.renewalDisclosureDigest,
      NOW,
      "c".repeat(64),
      NOW,
    );
    const renewalOperationId = id(126);
    run(
      db,
      `INSERT INTO domain_provider_operations (
         id, organization_id, project_id, subject_kind, subject_id,
         operation_kind, provider_code, idempotency_key, request_digest,
         state, requested_at, updated_at
       ) VALUES (?, ?, ?, 'renewal', ?, 'renew', 'registrar-fixture',
                 'renew-operation-fixture', ?, 'queued', ?, ?)`,
      renewalOperationId,
      IDS.org1,
      IDS.project1,
      renewalIntentId,
      "d".repeat(64),
      NOW,
      NOW,
    );

    const transferRequestId = id(127);
    run(
      db,
      `INSERT INTO domain_transfer_out_requests (
         id, organization_id, project_id, registration_id,
         requested_by_user_id, state, idempotency_key, request_digest,
         auth_code_ciphertext, auth_code_digest, requested_at
       ) VALUES (?, ?, ?, ?, ?, 'export_ready',
                 'transfer-domain-fixture-001', ?, ?, ?, ?)`,
      transferRequestId,
      IDS.org1,
      IDS.project1,
      registration.registrationId,
      IDS.user1,
      "e".repeat(64),
      new Uint8Array([8, 6, 7, 5, 3, 0, 9]),
      "f".repeat(64),
      NOW,
    );
    const transferOperationId = id(128);
    run(
      db,
      `INSERT INTO domain_provider_operations (
         id, organization_id, project_id, subject_kind, subject_id,
         operation_kind, provider_code, idempotency_key, request_digest,
         state, requested_at, updated_at
       ) VALUES (?, ?, ?, 'transfer_out', ?, 'request_auth_code',
                 'registrar-fixture', 'transfer-operation-fixture', ?,
                 'queued', ?, ?)`,
      transferOperationId,
      IDS.org1,
      IDS.project1,
      transferRequestId,
      "1".repeat(64),
      NOW,
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_transfer_exports (
         id, organization_id, project_id, transfer_request_id,
         manifest_digest, object_key, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'domain-transfer/fixture-export.json',
                 '2026-07-29T12:00:00.000Z', ?)`,
      id(129),
      IDS.org1,
      IDS.project1,
      transferRequestId,
      "2".repeat(64),
      NOW,
    );
    run(
      db,
      `INSERT INTO domain_manual_reviews (
         id, organization_id, project_id, subject_kind, subject_id,
         reason_code, state, detail_ciphertext, opened_at
       ) VALUES (?, ?, ?, 'provider_operation', ?,
                 'provider-response-ambiguous', 'open', ?, ?)`,
      id(130),
      IDS.org1,
      IDS.project1,
      transferOperationId,
      new Uint8Array([4, 2]),
      NOW,
    );

    assert.equal(
      get(
        db,
        `SELECT count(*) AS count
           FROM transactional_outbox
          WHERE aggregate_type LIKE 'domain_%'`,
      ).count,
      4,
    );
    assert.equal(
      get(
        db,
        `SELECT count(*) AS count
           FROM audit_events
          WHERE action LIKE 'domain.%'`,
      ).count,
      4,
    );
    assert.deepEqual(db.raw.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("verified Stripe webhook and outbox commit atomically and deduplicate", async () => {
  const { db, repository } = setup();
  try {
    const first = await repository.recordVerifiedStripeWebhook({
      stripeEventId: "evt_fixture_001",
      eventType: "invoice.paid",
      livemode: false,
      payload: { id: "evt_fixture_001", type: "invoice.paid" },
      signatureVerifiedAt: NOW,
    });
    assert.equal(first.duplicate, false);
    assert.equal(get(db, "SELECT count(*) AS count FROM stripe_events").count, 1);
    assert.equal(
      get(
        db,
        `SELECT count(*) AS count
           FROM transactional_outbox
          WHERE event_type = 'stripe.event_received'`,
      ).count,
      1,
    );
    const duplicate = await repository.recordVerifiedStripeWebhook({
      stripeEventId: "evt_fixture_001",
      eventType: "invoice.paid",
      livemode: false,
      payload: { id: "evt_fixture_001", type: "invoice.paid" },
      signatureVerifiedAt: NOW,
    });
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(
      repository.recordVerifiedStripeWebhook({
        stripeEventId: "evt_fixture_001",
        eventType: "invoice.failed",
        livemode: false,
        payload: { id: "evt_fixture_001", type: "invoice.failed" },
        signatureVerifiedAt: NOW,
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "STRIPE_EVENT_COLLISION",
    );
    assert.equal(get(db, "SELECT count(*) AS count FROM stripe_events").count, 1);
  } finally {
    db.close();
  }
});

test("catalog variants constrain entitlements and checkout stays disabled", () => {
  const { db } = setup();
  try {
    seedTenants(db);
    seedCatalogAndSubscription(db);
    run(
      db,
      `INSERT INTO subscription_entitlements (
         id, organization_id, project_id, subscription_id, variant_id,
         entitlement_key, value_json, source_receipt_id, granted_at
       ) VALUES (?, ?, ?, ?, ?, 'hosted_project_count', '1', ?, ?)`,
      id(50),
      IDS.org1,
      IDS.project1,
      IDS.subscription,
      IDS.variant,
      IDS.subscriptionReceipt,
      NOW,
    );
    assert.throws(() =>
      run(
        db,
        `INSERT INTO subscription_entitlements (
           id, organization_id, project_id, subscription_id, variant_id,
           entitlement_key, value_json, source_receipt_id, granted_at
         ) VALUES (?, ?, ?, ?, ?, 'hosted_project_count', '2', ?, ?)`,
        id(51),
        IDS.org1,
        IDS.project1,
        IDS.subscription,
        IDS.variant,
        IDS.subscriptionReceipt,
        NOW,
      ),
    );
    assert.throws(
      () =>
        run(
          db,
          `INSERT INTO checkout_intents (
             id, organization_id, project_id, catalog_price_id, currency,
             amount_minor, state, created_by_user_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'USD', 12345, 'created', ?, ?, ?)`,
          id(52),
          IDS.org1,
          IDS.project1,
          IDS.price,
          IDS.user1,
          NOW,
          NOW,
        ),
      /CHECKOUT_DISABLED/u,
    );
  } finally {
    db.close();
  }
});

test("artifact identity, accepted release, and deployment receipt stay exact", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    seedCatalogAndSubscription(db);
    const addressId = id(60);
    run(
      db,
      `INSERT INTO project_addresses (
         id, organization_id, project_id, kind, ownership, label,
         serving_hostname, state, allocated_at, configured_at
       ) VALUES (?, ?, ?, 'licensed', 'licensed', 'fixture',
                 'fixture.sitesourcery.me', 'configured', ?, ?)`,
      addressId,
      IDS.org1,
      IDS.project1,
      NOW,
      NOW,
    );
    run(
      db,
      `UPDATE project_address_projection
          SET current_address_id = ?, updated_at = ?
        WHERE organization_id = ? AND project_id = ?`,
      addressId,
      NOW,
      IDS.org1,
      IDS.project1,
    );
    const version = await createVersion(repository);
    assert.equal(
      version.artifactDigest,
      await sha256Hex(
        "<!doctype html><html><head><title>Fixture Studio</title></head>" +
          "<body><main><h1>Fixture Studio</h1><p>A complete artifact.</p></main></body></html>",
      ),
    );
    assert.throws(
      () =>
        run(
          db,
          "UPDATE artifacts SET artifact_digest = ? WHERE id = ?",
          "f".repeat(64),
          version.artifactId,
        ),
      /immutable/u,
    );
    await repository.transitionVersion({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      versionId: version.versionId,
      userId: IDS.user1,
      nextState: "ready",
    });
    const attestationId = id(61);
    const acceptanceScreenId = id(62);
    run(
      db,
      `INSERT INTO version_attestations (
         id, organization_id, project_id, version_id, user_id,
         statement_version, attested_at, request_id
       ) VALUES (?, ?, ?, ?, ?, 'release-review/v1', ?, ?)`,
      attestationId,
      IDS.org1,
      IDS.project1,
      version.versionId,
      IDS.user1,
      NOW,
      id(63),
    );
    run(
      db,
      `INSERT INTO release_screenings (
         id, organization_id, project_id, version_id, stage, method,
         passed, artifact_digest, findings_json, checker_revision, checked_at
       ) VALUES (?, ?, ?, ?, 'pre_acceptance', 'self-contained-release-screen/v1',
                 1, ?, '[]', 'fixture', ?)`,
      acceptanceScreenId,
      IDS.org1,
      IDS.project1,
      version.versionId,
      version.artifactDigest,
      NOW,
    );
    await repository.transitionVersion({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      versionId: version.versionId,
      userId: IDS.user1,
      nextState: "accepted_release",
      screeningId: acceptanceScreenId,
      attestationId,
    });
    const publishScreenId = id(64);
    run(
      db,
      `INSERT INTO release_screenings (
         id, organization_id, project_id, version_id, stage, method,
         passed, artifact_digest, findings_json, checker_revision, checked_at
       ) VALUES (?, ?, ?, ?, 'pre_publication', 'self-contained-release-screen/v1',
                 1, ?, '[]', 'fixture', ?)`,
      publishScreenId,
      IDS.org1,
      IDS.project1,
      version.versionId,
      version.artifactDigest,
      NOW,
    );
    const releaseRequestId = id(65);
    run(
      db,
      `INSERT INTO release_requests (
         id, organization_id, project_id, version_id, address_id,
         requested_by_user_id, prepublication_screening_id, requested_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      releaseRequestId,
      IDS.org1,
      IDS.project1,
      version.versionId,
      addressId,
      IDS.user1,
      publishScreenId,
      NOW,
    );
    const badReceiptId = id(66);
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'hosting', 'deployment_verified', 'bad-deploy',
                 ?, ?, ?, ?)`,
      badReceiptId,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        projectId: IDS.project1,
        versionId: version.versionId,
        artifactDigest: "0".repeat(64),
        hostname: "fixture.sitesourcery.me",
      }),
      "c".repeat(64),
      NOW,
      NOW,
    );
    assert.throws(() =>
      run(
        db,
        `INSERT INTO releases (
           id, organization_id, project_id, release_request_id, version_id,
           artifact_id, artifact_digest, hostname, deployment_receipt_id, released_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'fixture.sitesourcery.me', ?, ?)`,
        id(67),
        IDS.org1,
        IDS.project1,
        releaseRequestId,
        version.versionId,
        version.artifactId,
        version.artifactDigest,
        badReceiptId,
        NOW,
      ),
    );
    const goodReceiptId = id(68);
    run(
      db,
      `INSERT INTO provider_receipts (
         id, organization_id, project_id, provider_code, receipt_kind,
         external_object_ref, facts_json, facts_digest, occurred_at, recorded_at
       ) VALUES (?, ?, ?, 'hosting', 'deployment_verified', 'good-deploy',
                 ?, ?, ?, ?)`,
      goodReceiptId,
      IDS.org1,
      IDS.project1,
      JSON.stringify({
        projectId: IDS.project1,
        versionId: version.versionId,
        artifactDigest: version.artifactDigest,
        hostname: "fixture.sitesourcery.me",
      }),
      "d".repeat(64),
      NOW,
      NOW,
    );
    const releaseId = id(69);
    run(
      db,
      `INSERT INTO releases (
         id, organization_id, project_id, release_request_id, version_id,
         artifact_id, artifact_digest, hostname, deployment_receipt_id, released_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'fixture.sitesourcery.me', ?, ?)`,
      releaseId,
      IDS.org1,
      IDS.project1,
      releaseRequestId,
      version.versionId,
      version.artifactId,
      version.artifactDigest,
      goodReceiptId,
      NOW,
    );
    run(
      db,
      `UPDATE project_serving_projection
          SET state = 'live', current_release_id = ?, resume_state = 'live', updated_at = ?
        WHERE organization_id = ? AND project_id = ?`,
      releaseId,
      NOW,
      IDS.org1,
      IDS.project1,
    );
    const resolved = await repository.resolvePublicSite("fixture.sitesourcery.me");
    assert.equal(resolved.artifact_digest, version.artifactDigest);
    assert.throws(
      () => run(db, "UPDATE releases SET hostname = 'other.example' WHERE id = ?", releaseId),
      /immutable/u,
    );
  } finally {
    db.close();
  }
});

test("licensed hostname uniqueness ends exactly when allocation is released", () => {
  const { db } = setup();
  try {
    seedTenants(db);
    run(
      db,
      `INSERT INTO project_addresses (
         id, organization_id, project_id, kind, ownership, label,
         serving_hostname, state, allocated_at, configured_at
       ) VALUES (?, ?, ?, 'licensed', 'licensed', 'shared',
                 'shared.sitesourcery.me', 'configured', ?, ?)`,
      id(70),
      IDS.org1,
      IDS.project1,
      NOW,
      NOW,
    );
    assert.throws(() =>
      run(
        db,
        `INSERT INTO project_addresses (
           id, organization_id, project_id, kind, ownership, label,
           serving_hostname, state, allocated_at, configured_at
         ) VALUES (?, ?, ?, 'licensed', 'licensed', 'shared',
                   'shared.sitesourcery.me', 'configured', ?, ?)`,
        id(71),
        IDS.org2,
        IDS.project2,
        NOW,
        NOW,
      ),
    );
    run(
      db,
      `UPDATE project_addresses
          SET state = 'released', serving_hostname = NULL, label = NULL, released_at = ?
        WHERE organization_id = ? AND id = ?`,
      NOW,
      IDS.org1,
      id(70),
    );
    run(
      db,
      `INSERT INTO project_addresses (
         id, organization_id, project_id, kind, ownership, label,
         serving_hostname, state, allocated_at, configured_at
       ) VALUES (?, ?, ?, 'licensed', 'licensed', 'shared',
                 'shared.sitesourcery.me', 'configured', ?, ?)`,
      id(71),
      IDS.org2,
      IDS.project2,
      NOW,
      NOW,
    );
    assert.equal(
      get(
        db,
        `SELECT project_id
           FROM project_addresses
          WHERE serving_hostname = 'shared.sitesourcery.me'`,
      ).project_id,
      IDS.project2,
    );
  } finally {
    db.close();
  }
});

test("support and export are tenant-scoped and export enqueues durable work", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    const support = await repository.createSupportTicket({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      userId: IDS.user1,
      subject: "Fixture support request",
      message: "This is a complete support message for testing.",
    });
    assert.ok(support.ticketId);
    await assert.rejects(
      repository.createSupportTicket({
        organizationId: IDS.org2,
        projectId: IDS.project1,
        userId: IDS.user2,
        subject: "Cross tenant",
        message: "This cross tenant request must not be written.",
      }),
      (error) =>
        error instanceof DataPlaneError && error.code === "TENANT_ACCESS_DENIED",
    );
    const exported = await repository.requestExport({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      userId: IDS.user1,
    });
    assert.equal(exported.state, "queued");
    assert.equal(
      get(
        db,
        `SELECT count(*) AS count
           FROM transactional_outbox
          WHERE organization_id = ?
            AND event_type = 'export.build_requested'`,
        IDS.org1,
      ).count,
      1,
    );
  } finally {
    db.close();
  }
});

test("terminal purge seals access, waits for object deletion, and leaves minimal tombstone", async () => {
  const { db, repository } = setup();
  try {
    seedTenants(db);
    const version = await createVersion(repository);
    const customAddressId = id(80);
    run(
      db,
      `INSERT INTO project_addresses (
         id, organization_id, project_id, kind, ownership, retained_domain,
         serving_hostname, state, allocated_at, configured_at
       ) VALUES (?, ?, ?, 'customer_byod', 'customer', 'owned.example',
                 'owned.example', 'configured', ?, ?)`,
      customAddressId,
      IDS.org1,
      IDS.project1,
      NOW,
      NOW,
    );
    run(
      db,
      `UPDATE project_address_projection
          SET current_address_id = ?, updated_at = ?
        WHERE organization_id = ? AND project_id = ?`,
      customAddressId,
      NOW,
      IDS.org1,
      IDS.project1,
    );
    run(
      db,
      `INSERT INTO artifact_replicas (
         id, organization_id, artifact_id, provider_code, object_key,
         replica_digest, verified_at
       ) VALUES (?, ?, ?, 'r2', 'org/project/artifact.html', ?, ?)`,
      id(81),
      IDS.org1,
      version.artifactId,
      version.artifactDigest,
      NOW,
    );
    await repository.createSupportTicket({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      userId: IDS.user1,
      subject: "Delete this ticket",
      message: "This support narrative must be terminally removed.",
    });
    const sealed = await repository.beginTerminalPurge({
      organizationId: IDS.org1,
      projectId: IDS.project1,
      policyVersion: "abracadabra-terminal-delete/v1",
      systemAuthority: true,
    });
    assert.equal(sealed.state, "purging");
    assert.equal(
      get(
        db,
        "SELECT lifecycle FROM projects WHERE organization_id = ? AND id = ?",
        IDS.org1,
        IDS.project1,
      ).lifecycle,
      "deleting",
    );
    assert.equal(
      get(
        db,
        "SELECT count(*) AS count FROM site_versions WHERE organization_id = ? AND project_id = ?",
        IDS.org1,
        IDS.project1,
      ).count,
      0,
    );
    assert.equal(
      get(
        db,
        "SELECT count(*) AS count FROM support_tickets WHERE organization_id = ? AND project_id = ?",
        IDS.org1,
        IDS.project1,
      ).count,
      0,
    );
    await assert.rejects(
      repository.finalizeTerminalPurge({
        organizationId: IDS.org1,
        projectId: IDS.project1,
      }),
      (error) =>
        error instanceof DataPlaneError &&
        error.code === "OBJECT_DELETION_INCOMPLETE",
    );
    await repository.markDeletionObjectSucceeded({
      organizationId: IDS.org1,
      deletionRequestId: sealed.deletionRequestId,
      objectKey: "org/project/artifact.html",
    });
    const finalized = await repository.finalizeTerminalPurge({
      organizationId: IDS.org1,
      projectId: IDS.project1,
    });
    assert.deepEqual(finalized, {
      projectId: IDS.project1,
      state: "deleted",
      replay: false,
    });
    const project = get(
      db,
      "SELECT lifecycle, name FROM projects WHERE organization_id = ? AND id = ?",
      IDS.org1,
      IDS.project1,
    );
    assert.equal(project.lifecycle, "deleted");
    assert.equal(project.name, null);
    const address = get(
      db,
      `SELECT state, retained_domain, serving_hostname
         FROM project_addresses
        WHERE organization_id = ? AND id = ?`,
      IDS.org1,
      customAddressId,
    );
    assert.equal(address.state, "detached");
    assert.equal(address.retained_domain, "owned.example");
    assert.equal(address.serving_hostname, null);
    const tombstone = get(
      db,
      `SELECT retained_customer_domains_json, removal_counts_json
         FROM project_deletion_tombstones
        WHERE organization_id = ? AND project_id = ?`,
      IDS.org1,
      IDS.project1,
    );
    assert.deepEqual(JSON.parse(tombstone.retained_customer_domains_json), [
      "owned.example",
    ]);
    assert.equal(JSON.parse(tombstone.removal_counts_json).versions, 1);
    assert.deepEqual(
      await repository.finalizeTerminalPurge({
        organizationId: IDS.org1,
        projectId: IDS.project1,
      }),
      { projectId: IDS.project1, state: "deleted", replay: true },
    );
  } finally {
    db.close();
  }
});
